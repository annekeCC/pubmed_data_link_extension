import React, { useState, useCallback, useRef } from "react";
import styles from "./PubMedDataLinker.module.css";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AccessionLink {
  repo: string;
  accession: string;
  url: string;
}

interface DatasetsCommand {
  label: string;
  cli: string;
  apiUrl: string;
  accessions: string[];
}

type FetchState = "idle" | "loading" | "done" | "error";

// ── Accession patterns ────────────────────────────────────────────────────────

interface AccessionType {
  repo: string;
  pattern: RegExp;
  url: (id: string) => string;
  captureGroup?: number;
}

const ACCESSION_TYPES: AccessionType[] = [
  { repo: "GEO Series",           pattern: /\bGSE\d{4,7}\b/g,                              url: id => `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${id}` },
  { repo: "GEO Sample",           pattern: /\bGSM\d{4,8}\b/g,                              url: id => `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${id}` },
  { repo: "SRA Study",            pattern: /\bSRP\d{4,8}\b/g,                              url: id => `https://www.ncbi.nlm.nih.gov/sra?term=${id}` },
  { repo: "SRA Run",              pattern: /\bSRR\d{4,8}\b/g,                              url: id => `https://www.ncbi.nlm.nih.gov/sra?term=${id}` },
  { repo: "SRA Experiment",       pattern: /\bSRX\d{4,8}\b/g,                              url: id => `https://www.ncbi.nlm.nih.gov/sra?term=${id}` },
  { repo: "ArrayExpress",         pattern: /\bE-[A-Z]{4}-\d{4,6}\b/g,                      url: id => `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${id}` },
  { repo: "dbGaP",                pattern: /\bphs\d{6}\b/gi,                               url: id => `https://www.ncbi.nlm.nih.gov/projects/gap/cgi-bin/study.cgi?study_id=${id}` },
  { repo: "ENA",                  pattern: /\b(?:ERP|ERR|ERX|ERS|ERZ)\d{4,8}\b/g,         url: id => `https://www.ebi.ac.uk/ena/browser/view/${id}` },
  { repo: "BioProject",           pattern: /\bPRJN[A-Z]\d{4,8}\b/g,                       url: id => `https://www.ncbi.nlm.nih.gov/bioproject/${id}` },
  { repo: "BioSample",            pattern: /\bSAMN\d{7,10}\b/g,                            url: id => `https://www.ncbi.nlm.nih.gov/biosample/${id}` },
  { repo: "NCBI Genome (RefSeq)", pattern: /\bGC[FA]_\d{9}\.\d+\b/g,                      url: id => `https://www.ncbi.nlm.nih.gov/datasets/genome/${id}/` },
  { repo: "Zenodo",               pattern: /zenodo\.org\/(?:record|doi)\/(\d{4,8})/g,      url: id => `https://zenodo.org/record/${id}`,          captureGroup: 1 },
  { repo: "Figshare",             pattern: /figshare\.com\/articles\/\S+?\/(\d{6,10})/g,   url: id => `https://figshare.com/articles/${id}`,      captureGroup: 1 },
  { repo: "Dryad",                pattern: /datadryad\.org\/stash\/dataset\/(doi:[^\s<"]+)/g, url: id => `https://datadryad.org/stash/dataset/${id}`, captureGroup: 1 },
  { repo: "OSF",                  pattern: /osf\.io\/([a-z0-9]{5})\b/g,                    url: id => `https://osf.io/${id}`,                     captureGroup: 1 },
];

// ── NCBI Datasets command builder ─────────────────────────────────────────────

const DATASETS_API_BASE = "https://api.ncbi.nlm.nih.gov/datasets/v2";

const DATASETS_SUPPORT: Record<string, {
  cliType: string;
  apiPath: (ids: string[]) => string;
}> = {
  "NCBI Genome (RefSeq)": {
    cliType: "genome accession",
    apiPath: ids => `${DATASETS_API_BASE}/genome/accession/${ids.join(",")}/download?include_annotation_type=GENOME_FASTA&include_annotation_type=GENOME_GFF&hydrated=FULLY_HYDRATED`,
  },
  "BioProject": {
    cliType: "genome accession",
    apiPath: ids => `${DATASETS_API_BASE}/genome/bioproject/${ids.join(",")}/download?include_annotation_type=GENOME_FASTA&hydrated=FULLY_HYDRATED`,
  },
  "BioSample": {
    cliType: "genome accession",
    apiPath: ids => `${DATASETS_API_BASE}/genome/biosample/${ids.join(",")}/download?include_annotation_type=GENOME_FASTA&hydrated=FULLY_HYDRATED`,
  },
};

function buildDatasetsCommands(accessions: AccessionLink[]): DatasetsCommand[] {
  const byRepo: Record<string, string[]> = {};
  for (const item of accessions) {
    if (DATASETS_SUPPORT[item.repo]) {
      (byRepo[item.repo] ??= []).push(item.accession);
    }
  }
  return Object.entries(byRepo).map(([repo, ids]) => {
    const { cliType, apiPath } = DATASETS_SUPPORT[repo];
    return {
      label: repo,
      cli: `datasets download ${cliType} ${ids.join(" ")} --include genome,gff3,rna --filename ncbi_dataset_${repo.replace(/\s+/g, "_").toLowerCase()}.zip`,
      apiUrl: apiPath(ids),
      accessions: ids,
    };
  });
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function resolvePMCID(pmid: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      db: "pubmed", id: pmid, retmode: "json",
      tool: "pubmed-data-linker", email: "pubmed-data-linker@extension",
    });
    const resp = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${params}`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const articleIds: Array<{ idtype: string; value: string }> = data?.result?.[pmid]?.articleids ?? [];
    return articleIds.find(x => x.idtype === "pmc")?.value ?? null;
  } catch {
    return null;
  }
}

async function scanFullText(pmcid: string): Promise<AccessionLink[]> {
  try {
    const id = pmcid.replace(/^PMC/i, "");
    const params = new URLSearchParams({
      db: "pmc", id, rettype: "xml", retmode: "xml",
      tool: "pubmed-data-linker", email: "pubmed-data-linker@extension",
    });
    const resp = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${params}`
    );
    if (!resp.ok) return [];
    const text = await resp.text();
    if (text.length < 500) return [];

    const found: AccessionLink[] = [];
    const seen = new Set<string>();

    for (const { repo, pattern, url, captureGroup } of ACCESSION_TYPES) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const accession = captureGroup ? match[captureGroup] : match[0];
        const key = `${repo}:${accession.toUpperCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          found.push({ repo, accession: accession.toUpperCase(), url: url(accession) });
        }
      }
    }
    return found;
  } catch {
    return [];
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      className={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ""}`}
      onClick={handleCopy}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function AccessionItem({ item }: { item: AccessionLink }) {
  return (
    <li className={styles.item}>
      <a href={item.url} target="_blank" rel="noopener noreferrer">
        <span className={styles.provider}>{item.accession}</span>
        <span className={styles.url}>{item.url}</span>
      </a>
    </li>
  );
}

function GroupedAccessions({ accessions }: { accessions: AccessionLink[] }) {
  const grouped = accessions.reduce<Record<string, AccessionLink[]>>((acc, a) => {
    (acc[a.repo] ??= []).push(a);
    return acc;
  }, {});
  return (
    <>
      {Object.entries(grouped).map(([repo, items]) => (
        <div key={repo}>
          <div className={styles.category}>{repo}</div>
          <ul className={styles.list}>
            {items.map(item => <AccessionItem key={item.accession} item={item} />)}
          </ul>
        </div>
      ))}
    </>
  );
}

function DatasetsSection({ commands }: { commands: DatasetsCommand[] }) {
  if (commands.length === 0) return null;
  return (
    <>
      <div className={styles.sectionTitle}>NCBI Datasets</div>
      <p className={styles.datasetsIntro}>
        Download using the{" "}
        <a href="https://www.ncbi.nlm.nih.gov/datasets/docs/v2/command-line-tools/download-and-install/"
           target="_blank" rel="noopener noreferrer">
          NCBI Datasets CLI
        </a>{" "}or REST API:
      </p>
      {commands.map(cmd => (
        <div key={cmd.label} className={styles.cmdBlock}>
          <div className={styles.cmdLabel}>
            {cmd.label} — CLI ({cmd.accessions.length} accession{cmd.accessions.length !== 1 ? "s" : ""})
          </div>
          <div className={styles.cmdRow}>
            <code className={styles.cmd}>{cmd.cli}</code>
            <CopyButton text={cmd.cli} />
          </div>
          <div className={styles.cmdLabel}>API URL</div>
          <div className={styles.cmdRow}>
            <code className={`${styles.cmd} ${styles.cmdUrl}`}>{cmd.apiUrl}</code>
            <CopyButton text={cmd.apiUrl} />
          </div>
        </div>
      ))}
    </>
  );
}

function Results({
  accessions, commands,
}: {
  accessions: AccessionLink[];
  commands: DatasetsCommand[];
}) {
  if (accessions.length === 0) {
    return (
      <p className={styles.empty}>
        No data accessions found in the full text of this article.
        <br />
        <small>Data may be referenced only in supplementary materials.</small>
      </p>
    );
  }
  return (
    <>
      <p className={styles.count}>
        {accessions.length} accession{accessions.length !== 1 ? "s" : ""} found in full text:
      </p>
      <GroupedAccessions accessions={accessions} />
      <DatasetsSection commands={commands} />
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface PubMedDataLinkerProps {
  pmid?: string | null;
  pmcid?: string | null;
}

export function PubMedDataLinker({ pmid = null, pmcid = null }: PubMedDataLinkerProps) {
  const [state, setState]             = useState<FetchState>("idle");
  const [accessions, setAccessions]   = useState<AccessionLink[]>([]);
  const [commands, setCommands]       = useState<DatasetsCommand[]>([]);
  const [resolvedPMCID, setResolvedPMCID] = useState<string | null>(pmcid);
  const [error, setError]             = useState<string | null>(null);
  const [open, setOpen]               = useState(false);

  const handleClick = useCallback(async () => {
    if (open) { setOpen(false); return; }
    if (state === "done") { setOpen(true); return; }

    setOpen(true);
    setState("loading");
    setError(null);

    try {
      let effectivePMCID = pmcid;
      if (!effectivePMCID && pmid) effectivePMCID = await resolvePMCID(pmid);
      setResolvedPMCID(effectivePMCID);

      const found = effectivePMCID ? await scanFullText(effectivePMCID) : [];
      const cmds  = buildDatasetsCommands(found);
      setAccessions(found);
      setCommands(cmds);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }, [open, state, pmid, pmcid]);

  return (
    <div className={styles.wrapper}>
      <button
        className={`${styles.btn} ${open ? styles.btnActive : ""}`}
        onClick={handleClick}
        disabled={state === "loading"}
        aria-expanded={open}
        aria-label="Scan full text for data accession numbers"
      >
        {state === "loading" ? "⏳ Searching…" : "🔗 Find Data"}
      </button>

      {open && (
        <div className={styles.panel} role="region" aria-label="Linked datasets">
          {state === "loading" && (
            <p className={styles.empty}>Scanning full text…</p>
          )}
          {state === "error" && (
            <p className={styles.error}>
              ⚠️ Could not scan article.<br /><small>{error}</small>
            </p>
          )}
          {state === "done" && !resolvedPMCID && (
            <p className={styles.empty}>
              Full-text scan unavailable — this article is not in PubMed Central.
              <br /><small>Only Open Access articles in PMC can be scanned.</small>
            </p>
          )}
          {state === "done" && resolvedPMCID && (
            <Results accessions={accessions} commands={commands} />
          )}
          <p className={styles.footer}>
            Scanned via{" "}
            <a href="https://www.ncbi.nlm.nih.gov/pmc/" target="_blank" rel="noopener noreferrer">PMC</a>
            {" "}full text
          </p>
        </div>
      )}
    </div>
  );
}

export default PubMedDataLinker;
