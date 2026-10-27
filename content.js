/**
 * PubMed Data Linker — content.js
 * Version : 1.5.1
 * Built   : 2026-02-26T00:00:00Z
 *
 * Supported pages:
 *   PubMed — pubmed.ncbi.nlm.nih.gov/<PMID>/
 *   PMC    — pmc.ncbi.nlm.nih.gov/articles/PMC<ID>/
 *
 * On click:
 *   1. Resolves PMCID from PMID if needed (via eUtils esummary)
 *   2. Fetches PMC full text XML (OA articles only)
 *   3. Scans for 15 data accession patterns
 *   4. Generates NCBI Datasets CLI commands + API URLs for supported accessions
 *   5. Displays results in a dropdown panel with copy buttons
 */

(function () {
  "use strict";

  const PDL_VERSION = "1.5.3";
  const PDL_BUILT   = "2026-02-26T00:00:00Z";

  // ── Detect page ─────────────────────────────────────────────────────────────

  const pageInfo = detectPage();
  if (!pageInfo) return;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => injectButton(pageInfo));
  } else {
    injectButton(pageInfo);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE DETECTION
  // ─────────────────────────────────────────────────────────────────────────

  function detectPage() {
    const { hostname, pathname } = window.location;
    if (hostname === "pubmed.ncbi.nlm.nih.gov") {
      const m = pathname.match(/^\/(\d+)\/?$/);
      return m ? { pmid: m[1], pmcid: null, site: "pubmed" } : null;
    }
    if (hostname === "pmc.ncbi.nlm.nih.gov") {
      const m = pathname.match(/^\/articles\/(PMC\d+)\/?/i);
      return m ? { pmid: null, pmcid: m[1], site: "pmc" } : null;
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BUTTON INJECTION
  // ─────────────────────────────────────────────────────────────────────────

  function injectButton(pageInfo) {
    if (document.getElementById("pdl-wrapper")) return;

    const container = findAnchor(pageInfo.site);
    if (!container) {
      console.warn("[PDL] No anchor element found for button injection");
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.id = "pdl-wrapper";

    const btn = document.createElement("button");
    btn.id = "pdl-btn";
    btn.textContent = "🔗 Find Data";
    btn.title = `PubMed Data Linker v${PDL_VERSION} — scan full text for data accessions`;
    btn.addEventListener("click", () => handleClick(pageInfo, btn, wrapper));

    wrapper.appendChild(btn);
    // On PubMed, inject BEFORE the h1 title so button appears at top of article.
    // On PMC, inject AFTER the actions bar (already near top).
    const position = pageInfo.site === "pubmed" ? "beforebegin" : "afterend";
    container.insertAdjacentElement(position, wrapper);
    console.log(`[PDL v${PDL_VERSION}] Button injected on ${pageInfo.site} (anchor: ${container.tagName}${container.id ? "#"+container.id : ""}${container.className ? "."+container.className.trim().split(/\s+/)[0] : ""})`);
  }

  function findAnchor(site) {
    if (site === "pmc") {
      return (
        document.querySelector(".pmc-actions-bar") ||
        document.querySelector(".front-matter")    ||
        document.querySelector("#article-container")
      );
    }
    if (site === "pubmed") {
      // Target the h1 title itself — we inject BEFORE it so the button
      // appears at the very top of the article content area.
      // Fallback chain for older PubMed layouts.
      return (
        document.querySelector("h1.heading-title")      ||
        document.querySelector("#full-view-heading")    ||
        document.querySelector(".full-view-interlinks") ||
        document.querySelector(".actions-bar")
      );
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CLICK HANDLER
  // ─────────────────────────────────────────────────────────────────────────

  async function handleClick(pageInfo, btn, wrapper) {
    const existing = document.getElementById("pdl-panel");
    if (existing) {
      existing.remove();
      btn.classList.remove("pdl-btn--active");
      return;
    }

    btn.classList.add("pdl-btn--active");
    btn.textContent = "⏳ Searching…";
    btn.disabled = true;

    try {
      const pmcid      = await resolvePMCID(pageInfo);
      // Run LinkOut + full-text scan in parallel — both are independent
      const [linkouts, accessions] = await Promise.all([
        fetchLinkOut(pageInfo.pmid || pageInfo.pmcid),
        pmcid ? scanFullText(pmcid) : Promise.resolve([]),
      ]);
      // Dedup: remove LinkOut entries whose URL already contains a full-text accession.
      // This avoids showing e.g. "NIAID Data Ecosystem → GSE134355" when GSE134355
      // is already listed under GEO Series in the accessions section.
      const accessionSet = new Set(
        (accessions || []).map(a => a.accession.toLowerCase())
      );
      const dedupedLinkouts = (linkouts || []).filter(item => {
        const urlLower = item.url.toLowerCase();
        return ![...accessionSet].some(acc => urlLower.includes(acc));
      });

      const commands   = buildDatasetsCommands(accessions);
      // Fetch BioProject genome counts in parallel while we prepare the panel
      const bpCounts   = commands?.bioprojectIds?.length > 0
        ? await fetchBioprojectCounts(commands.bioprojectIds)
        : {};
      renderPanel(accessions, commands, wrapper, pmcid, null, bpCounts, dedupedLinkouts);
    } catch (err) {
      renderPanel(null, null, wrapper, null, err.message, {});
    } finally {
      btn.textContent = "🔗 Find Data";
      btn.disabled = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ID RESOLUTION
  // ─────────────────────────────────────────────────────────────────────────

  async function resolvePMCID({ pmid, pmcid }) {
    if (pmcid) return pmcid;
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
      const articleIds = data?.result?.[pmid]?.articleids ?? [];
      const pmc = articleIds.find(x => x.idtype === "pmc");
      return pmc?.value ?? null;
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NCBI LINKOUT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch NCBI LinkOut entries for a PMID (or PMCID as fallback).
   * Uses cmd=llinks which returns provider-registered URLs for this article.
   * We keep only "Molecular Biology Databases" and "Research Materials" —
   * these are the categories that contain actual data repository links.
   * Returns array of { name, url, category } sorted by name.
   */
  const LINKOUT_DATA_CATEGORIES = new Set([
    "Molecular Biology Databases",
    "Research Materials",
  ]);

  async function fetchLinkOut(id) {
    if (!id) return [];
    // Prefer numeric PMID; strip PMC prefix if that's all we have
    const numericId = String(id).replace(/^PMC/i, "");
    try {
      const params = new URLSearchParams({
        dbfrom: "pubmed", id: numericId, cmd: "llinks",
        tool: "pubmed-data-linker", email: "pubmed-data-linker@extension",
      });
      const resp = await fetch(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi?${params}`
      );
      if (!resp.ok) return [];
      const text = await resp.text();
      // Parse XML with DOMParser (available in content scripts)
      const doc  = new DOMParser().parseFromString(text, "text/xml");
      const results = [];
      for (const obj of doc.querySelectorAll("ObjUrl")) {
        const category = obj.querySelector("Category")?.textContent?.trim() ?? "";
        if (!LINKOUT_DATA_CATEGORIES.has(category)) continue;
        const url  = obj.querySelector("Url")?.textContent?.trim();
        const name = obj.querySelector("Provider > Name")?.textContent?.trim()
                  || obj.querySelector("Provider > NameAbbr")?.textContent?.trim()
                  || obj.querySelector("LinkName")?.textContent?.trim()
                  || "LinkOut";
        if (url) results.push({ name, url, category });
      }
      // Sort: Molecular Biology Databases first, then alphabetically by name
      results.sort((a, b) => {
        if (a.category !== b.category) return a.category < b.category ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return results;
    } catch {
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACCESSION PATTERNS
  // ─────────────────────────────────────────────────────────────────────────

  const ACCESSION_TYPES = [
    { repo: "GEO Series",           pattern: /\bGSE\d{4,7}\b/g,                                url: id => `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${id}` },
    { repo: "GEO Sample",           pattern: /\bGSM\d{4,8}\b/g,                                url: id => `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${id}` },
    { repo: "SRA Study",            pattern: /\bSRP\d{4,8}\b/g,                                url: id => `https://www.ncbi.nlm.nih.gov/sra?term=${id}` },
    { repo: "SRA Run",              pattern: /\bSRR\d{4,8}\b/g,                                url: id => `https://www.ncbi.nlm.nih.gov/sra?term=${id}` },
    { repo: "SRA Experiment",       pattern: /\bSRX\d{4,8}\b/g,                                url: id => `https://www.ncbi.nlm.nih.gov/sra?term=${id}` },
    { repo: "ArrayExpress",         pattern: /\bE-[A-Z]{4}-\d{4,6}\b/g,                        url: id => `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${id}` },
    { repo: "dbGaP",                pattern: /\bphs\d{6}\b/gi,                                 url: id => `https://www.ncbi.nlm.nih.gov/projects/gap/cgi-bin/study.cgi?study_id=${id}` },
    { repo: "ENA",                  pattern: /\b(?:ERP|ERR|ERX|ERS|ERZ)\d{4,8}\b/g,           url: id => `https://www.ebi.ac.uk/ena/browser/view/${id}` },
    { repo: "BioProject",           pattern: /\bPRJN[A-Z]\d{4,8}\b/g,                         url: id => `https://www.ncbi.nlm.nih.gov/bioproject/${id}` },
    { repo: "BioSample",            pattern: /\bSAMN\d{7,10}\b/g,                              url: id => `https://www.ncbi.nlm.nih.gov/biosample/${id}` },
    { repo: "NCBI Genome (RefSeq)", pattern: /\bGC[FA]_\d{9}\.\d+\b/g,                        url: id => `https://www.ncbi.nlm.nih.gov/datasets/genome/${id}/` },
    { repo: "Zenodo",               pattern: /zenodo\.org\/(?:record|doi)\/(\d{4,8})/g,        url: id => `https://zenodo.org/record/${id}`,            captureGroup: 1 },
    { repo: "Figshare",             pattern: /figshare\.com\/articles\/\S+?\/(\d{6,10})/g,     url: id => `https://figshare.com/articles/${id}`,        captureGroup: 1 },
    { repo: "Figshare",             pattern: /doi\.org\/10\.6084\/m9\.figshare\.(\d{6,10})/g,  url: id => `https://figshare.com/articles/${id}`,        captureGroup: 1 },
    { repo: "Dryad",                pattern: /datadryad\.org\/stash\/dataset\/(doi:[^\s<"]+)/g, url: id => `https://datadryad.org/stash/dataset/${id}`,  captureGroup: 1 },
    { repo: "OSF",                  pattern: /osf\.io\/([a-z0-9]{5})\b/g,                      url: id => `https://osf.io/${id}`,                       captureGroup: 1 },
    // ── Proteomics / Metabolomics ──────────────────────────────────────────
    { repo: "PRIDE",                pattern: /\bPXD\d{6}\b/g,                                  url: id => `https://www.ebi.ac.uk/pride/archive/projects/${id}` },
    { repo: "MetaboLights",         pattern: /\bMTBLS\d{1,6}\b/g,                              url: id => `https://www.ebi.ac.uk/metabolights/${id}` },
    { repo: "MassIVE",              pattern: /\bMSV\d{9}\b/g,                                  url: id => `https://massive.ucsd.edu/ProteoSAFe/dataset.jsp?accession=${id}` },
    // ── RefSeq sequences (underscore makes these distinctive in text) ──────
    { repo: "RefSeq RNA",           pattern: /\b(?:NM|NR|XM|XR)_\d{6,9}(?:\.\d+)?\b/g,       url: id => `https://www.ncbi.nlm.nih.gov/nuccore/${id}` },
    { repo: "RefSeq Protein",       pattern: /\b(?:NP|XP|WP)_\d{6,9}(?:\.\d+)?\b/g,          url: id => `https://www.ncbi.nlm.nih.gov/protein/${id}` },
    { repo: "RefSeq Genome",        pattern: /\b(?:NC|NG|NT|NW|NZ)_\d{6,9}(?:\.\d+)?\b/g,    url: id => `https://www.ncbi.nlm.nih.gov/nuccore/${id}` },
    // ── Variants ───────────────────────────────────────────────────────────
    { repo: "dbSNP",                pattern: /\brs\d{4,12}\b/g,                                url: id => `https://www.ncbi.nlm.nih.gov/snp/${id}` },
    { repo: "ClinVar",              pattern: /\b(?:RCV|VCV)\d{9}\b/g,                          url: id => `https://www.ncbi.nlm.nih.gov/clinvar/${id}/` },
    // ── UniProt (Swiss-Prot/TrEMBL accession format) ──────────────────────
    { repo: "UniProt",              pattern: /\b[OPQ][0-9][A-Z0-9]{3}[0-9](?:[A-Z0-9]{2})?\b/g, url: id => `https://www.uniprot.org/uniprot/${id}` },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // FULL-TEXT SCAN
  // ─────────────────────────────────────────────────────────────────────────

  async function scanFullText(pmcid) {
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

    const found = [];
    const seen  = new Set();

    for (const { repo, pattern, url, captureGroup } of ACCESSION_TYPES) {
      pattern.lastIndex = 0;
      let match;
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
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BIOPROJECT GENOME COUNT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * For each PRJNA accession, fetch total_count from dataset_report.
   * Returns a map of { PRJNA123: 42, PRJNA456: 1200, ... }
   * Runs all requests in parallel; silently ignores failures.
   */
  async function fetchBioprojectCounts(bioprojectIds) {
    if (!bioprojectIds || bioprojectIds.length === 0) return {};
    const entries = await Promise.all(
      bioprojectIds.map(async id => {
        try {
          const resp = await fetch(
            `${DATASETS_API_BASE}/genome/bioproject/${id}/dataset_report`
          );
          if (!resp.ok) return [id, null];
          const data = await resp.json();
          return [id, data?.total_count ?? null];
        } catch {
          return [id, null];
        }
      })
    );
    return Object.fromEntries(entries);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NCBI DATASETS COMMAND GENERATOR
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * NCBI Datasets CLI v2:
   *   `datasets download genome accession` accepts GCF_, GCA_, PRJNA*, SAMN*
   *   all in a single space-separated list — no need to split by type.
   *
   * REST API: https://api.ncbi.nlm.nih.gov/datasets/v2/genome/accession/{ids}/download
   *   also accepts mixed GCF_/GCA_/PRJNA/SAMN accessions comma-separated.
   *
   * SRA: use `prefetch` (SRA Toolkit) for SRR/SRX/SRP
   * Other repos (GEO, ENA, Zenodo, etc.): wget/curl direct URLs
   */
  const DATASETS_API_BASE = "https://api.ncbi.nlm.nih.gov/datasets/v2";

  /**
   * CLI: `datasets download genome accession` accepts GCF_, GCA_, and PRJNA
   * mixed in a single space-separated list. No BioSample (SAMN) support in CLI.
   *
   * REST API has SEPARATE endpoints:
   *   /genome/accession/{GCF_/GCA_,...}/download  — assembly accessions only
   *   /genome/bioproject/{PRJNA,...}/download     — BioProject accessions only
   * SAMN has no direct Datasets REST endpoint — link to NCBI BioSample page only.
   *
   * Refs: https://www.ncbi.nlm.nih.gov/datasets/docs/v2/reference-docs/command-line/datasets/download/genome/datasets_download_genome_accession/
   */

  // Assembly accessions accepted by CLI + /genome/accession/ REST endpoint
  const DATASETS_ASSEMBLY_REPOS = new Set(["NCBI Genome (RefSeq)"]);
  // BioProject accessions: accepted by CLI (mixed with assemblies) + separate REST endpoint
  const DATASETS_BIOPROJECT_REPOS = new Set(["BioProject"]);
  // SRA Toolkit
  const SRA_REPOS = new Set(["SRA Run", "SRA Experiment", "SRA Study"]);

  /**
   * Build NCBI Datasets CLI command(s) and REST API URLs.
   * - CLI: one consolidated call mixing GCF_/GCA_ + PRJNA (both accepted)
   * - REST API: two separate URLs (assembly endpoint + bioproject endpoint)
   *
   * Returns: { datasetsCmd, assemblyApiUrl, bioprojectApiUrl,
   *            assemblyIds, bioprojectIds, sraIds, wgetLines, hasAny }
   */
  function buildDatasetsCommands(accessions) {
    if (!accessions || accessions.length === 0) return null;

    const assemblyIds   = [];  // GCF_ / GCA_
    const bioprojectIds = [];  // PRJNA
    const sraIds        = [];  // SRR / SRX / SRP
    const wgetLines     = [];  // Zenodo / Figshare / Dryad / OSF

    for (const item of accessions) {
      if (DATASETS_ASSEMBLY_REPOS.has(item.repo)) {
        assemblyIds.push(item.accession);
      } else if (DATASETS_BIOPROJECT_REPOS.has(item.repo)) {
        bioprojectIds.push(item.accession);
      } else if (SRA_REPOS.has(item.repo)) {
        sraIds.push(item.accession);
      } else if (["Zenodo","Figshare","Dryad","OSF"].includes(item.repo)) {
        wgetLines.push(`wget -c "${item.url}"  # ${item.repo}: ${item.accession}`);
      }
      // GEO, ENA, ArrayExpress, dbGaP, BioSample — links only
    }

    const allGenomicIds = [...assemblyIds, ...bioprojectIds];
    if (allGenomicIds.length === 0 && sraIds.length === 0 && wgetLines.length === 0) {
      return null;
    }

    // Single CLI command — GCF_/GCA_ and PRJNA can be mixed
    const datasetsCmd = allGenomicIds.length > 0
      ? `datasets download genome accession ${allGenomicIds.join(" ")} \\\n  --include genome,gff3,rna \\\n  --filename ncbi_dataset.zip`
      : null;

    // REST API URLs — use dataset_report (returns JSON metadata, no download triggered)
    // Download URLs use /download endpoint but dataset_report is safer for linking
    const assemblyApiUrl = assemblyIds.length > 0
      ? `${DATASETS_API_BASE}/genome/accession/${assemblyIds.join(",")}/dataset_report`
      : null;

    const bioprojectApiUrl = bioprojectIds.length > 0
      ? `${DATASETS_API_BASE}/genome/bioproject/${bioprojectIds.join(",")}/dataset_report`
      : null;

    return {
      datasetsCmd, assemblyApiUrl, bioprojectApiUrl,
      assemblyIds, bioprojectIds, allGenomicIds,
      sraIds, wgetLines, hasAny: true,
    };
  }

  /**
   * Build a complete shell download script combining all supported download methods.
   * Returns a string of shell script content.
   */
  function buildDownloadScript(accessions, pmcid) {
    const result = buildDatasetsCommands(accessions);
    const lines  = [];

    lines.push("#!/usr/bin/env bash");
    lines.push("# Auto-generated by PubMed Data Linker v" + PDL_VERSION);
    lines.push("# Article: " + (pmcid || "unknown") + "  |  " + new Date().toISOString());
    lines.push("# Requires: NCBI Datasets CLI (https://www.ncbi.nlm.nih.gov/datasets/docs/v2/download-and-install/)");
    lines.push("#           SRA Toolkit (https://github.com/ncbi/sra-tools/wiki/01.-Downloading-SRA-Toolkit)");
    lines.push("#           wget");
    lines.push("set -euo pipefail");
    lines.push("");

    if (result?.datasetsCmd) {
      const note = [
        result.assemblyIds.length > 0 ? `${result.assemblyIds.length} assembly accession(s)` : "",
        result.bioprojectIds.length > 0 ? `${result.bioprojectIds.length} BioProject(s)` : "",
      ].filter(Boolean).join(" + ");
      lines.push(`# ── NCBI Datasets CLI (${note}) ─────────────────────────────────────────`);
      // Preview first — shows what will be downloaded without downloading
      const previewCmd = result.datasetsCmd.replace("--include genome,gff3,rna \\\n  --filename ncbi_dataset.zip", "--preview");
      lines.push("# Step 1: preview what will be downloaded (no download)");
      lines.push(previewCmd);
      lines.push("");
      lines.push("# Step 2: download when ready");
      lines.push(result.datasetsCmd);
      lines.push("");

      // REST API URLs are separate per endpoint type
      if (result.assemblyApiUrl) {
        lines.push("# REST API — assembly metadata report (JSON, no download):");
        lines.push(`# curl "${result.assemblyApiUrl}" | python3 -m json.tool`);
        lines.push("");
      }
      if (result.bioprojectApiUrl) {
        lines.push("# REST API — BioProject metadata report (JSON, no download):");
        lines.push(`# curl "${result.bioprojectApiUrl}" | python3 -m json.tool`);
        lines.push("");
      }
    }

    if (result?.sraIds?.length > 0) {
      lines.push("# ── SRA Toolkit (sequencing runs) ───────────────────────────────────────");
      lines.push(`prefetch ${result.sraIds.join(" ")}`);
      lines.push(`fasterq-dump ${result.sraIds.join(" ")} --split-files`);
      lines.push("");
    }

    if (result?.wgetLines?.length > 0) {
      lines.push("# ── Direct downloads (Zenodo / Figshare / Dryad / OSF) ─────────────────");
      lines.push(result.wgetLines.join("\n"));
      lines.push("");
    }

    // Repos with no simple CLI — list as comments for manual download
    const manualRepos = ["GEO Series","GEO Sample","ENA","ArrayExpress","dbGaP","BioSample"];
    const manualItems = accessions.filter(a => manualRepos.includes(a.repo));
    if (manualItems.length > 0) {
      lines.push("# ── Manual download required ────────────────────────────────────────────");
      lines.push("# These repositories require browser access or repo-specific tools:");
      for (const item of manualItems) {
        lines.push(`#   ${item.repo}: ${item.accession}`);
        lines.push(`#     ${item.url}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER PANEL
  // ─────────────────────────────────────────────────────────────────────────

  function renderPanel(accessions, commands, wrapper, pmcid, errorMsg, bpCounts = {}, linkouts = []) {
    document.getElementById("pdl-panel")?.remove();

    const panel = document.createElement("div");
    panel.id = "pdl-panel";

    let html = "";

    if (errorMsg) {
      html = `<p class="pdl-error">⚠️ Could not scan article.<br><small>${escapeHtml(errorMsg)}</small></p>`;

    } else {
      // ── Section 0: NCBI LinkOut (shown in all non-error states) ──────────
      if (linkouts && linkouts.length > 0) {
        html += `<div class="pdl-section-title">NCBI LinkOut</div>
          <ul class="pdl-list">`;
        for (const item of linkouts) {
          html += `<li class="pdl-item">
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
              <span class="pdl-provider">${escapeHtml(item.name)}</span>
              <span class="pdl-url">${escapeHtml(item.url)}</span>
            </a></li>`;
        }
        html += `</ul>`;
      }

      if (!pmcid) {
        html += `<p class="pdl-empty">Full-text scan unavailable — this article is not in PubMed Central.<br>
          <small>Only Open Access articles in PMC can be scanned.</small></p>`;

      } else if (!accessions || accessions.length === 0) {
        html += `<p class="pdl-empty">No data accessions found in the full text.<br>
          <small>Data may be referenced only in supplementary materials.</small></p>`;

      } else {
      // ── Section 1: Accessions found ──────────────────────────────────────
      const grouped = {};
      for (const item of accessions) {
        (grouped[item.repo] ??= []).push(item);
      }
      const allIds = accessions.map(a => a.accession).join("\n");
      html += `<p class="pdl-count">${accessions.length} accession${accessions.length !== 1 ? "s" : ""} found in full text:
        <button class="pdl-copy-btn pdl-copy-all-btn" id="pdl-copy-all" title="Copy all accession IDs to clipboard">Copy all IDs</button>
      </p>`;
      for (const [repo, items] of Object.entries(grouped)) {
        html += `<div class="pdl-category">${escapeHtml(repo)}</div><ul class="pdl-list">`;
        for (const item of items) {
          html += `<li class="pdl-item">
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
              <span class="pdl-provider">${escapeHtml(item.accession)}</span>
              <span class="pdl-url">${escapeHtml(item.url)}</span>
            </a></li>`;
        }
        html += `</ul>`;
      }

      // ── Section 2: NCBI Datasets commands ────────────────────────────────
      if (commands && commands.hasAny) {
        html += `<div class="pdl-section-title">NCBI Datasets</div>
          <p class="pdl-datasets-intro">Download using the
            <a href="https://www.ncbi.nlm.nih.gov/datasets/docs/v2/command-line-tools/download-and-install/" target="_blank" rel="noopener noreferrer">NCBI Datasets CLI</a>
            or REST API:
          </p>`;

        if (commands.datasetsCmd) {
          const n = commands.allGenomicIds.length;
          const previewCmd = commands.datasetsCmd.replace("--include genome,gff3,rna \\\n  --filename ncbi_dataset.zip", "--preview");

          // Build warning for any BioProject with > 50 genomes
          const largeProjects = (commands.bioprojectIds || [])
            .filter(id => bpCounts[id] != null && bpCounts[id] > 50)
            .map(id => `${id} (${bpCounts[id].toLocaleString()} genomes)`);
          const warningHtml = largeProjects.length > 0 ? `
            <div class="pdl-warning">
              ⚠️ Large BioProject${largeProjects.length > 1 ? "s" : ""}: ${largeProjects.join(", ")}.
              Consider adding <code>--assembly-level complete,chromosome</code> to filter,
              or use <code>--dehydrated</code> to download a manifest first.
            </div>` : "";

          html += `
            ${warningHtml}
            <div class="pdl-cmd-block">
              <div class="pdl-cmd-label">CLI — ${n} accession${n !== 1 ? "s" : ""} (GCF_/GCA_ + PRJNA consolidated)</div>
              <div class="pdl-cmd-row">
                <code class="pdl-cmd">${escapeHtml(commands.datasetsCmd)}</code>
                <button class="pdl-copy-btn" data-copy="${escapeHtml(commands.datasetsCmd)}" title="Copy command">Copy</button>
              </div>
              <div class="pdl-cmd-label">Preview first (no download)</div>
              <div class="pdl-cmd-row">
                <code class="pdl-cmd">${escapeHtml(previewCmd)}</code>
                <button class="pdl-copy-btn" data-copy="${escapeHtml(previewCmd)}" title="Copy preview command">Copy</button>
              </div>
              ${commands.assemblyApiUrl ? `
              <div class="pdl-cmd-label">REST API — assembly metadata report (${commands.assemblyIds.length} accession${commands.assemblyIds.length !== 1 ? "s" : ""}, JSON)</div>
              <div class="pdl-cmd-row">
                <code class="pdl-cmd pdl-cmd--url">${escapeHtml(commands.assemblyApiUrl)}</code>
                <button class="pdl-copy-btn" data-copy="${escapeHtml(commands.assemblyApiUrl)}" title="Copy API URL">Copy</button>
              </div>` : ""}
              ${commands.bioprojectApiUrl ? `
              <div class="pdl-cmd-label">REST API — BioProject metadata report (${commands.bioprojectIds.length} accession${commands.bioprojectIds.length !== 1 ? "s" : ""}, JSON)</div>
              <div class="pdl-cmd-row">
                <code class="pdl-cmd pdl-cmd--url">${escapeHtml(commands.bioprojectApiUrl)}</code>
                <button class="pdl-copy-btn" data-copy="${escapeHtml(commands.bioprojectApiUrl)}" title="Copy API URL">Copy</button>
              </div>` : ""}
            </div>`;
        }

        if (commands.sraIds && commands.sraIds.length > 0) {
          const sraCmd = `prefetch ${commands.sraIds.join(" ")}\nfasterq-dump ${commands.sraIds.join(" ")} --split-files`;
          html += `
            <div class="pdl-cmd-block">
              <div class="pdl-cmd-label">SRA Toolkit — ${commands.sraIds.length} run${commands.sraIds.length !== 1 ? "s" : ""}</div>
              <div class="pdl-cmd-row">
                <code class="pdl-cmd">${escapeHtml(sraCmd)}</code>
                <button class="pdl-copy-btn" data-copy="${escapeHtml(sraCmd)}" title="Copy command">Copy</button>
              </div>
            </div>`;
        }

        // Download Script button
        html += `<button class="pdl-copy-btn pdl-script-btn" id="pdl-dl-script" title="Save a shell script with all download commands">⬇ Download .sh script</button>`;
      }
      } // end else (accessions found)
    } // end else (no error)

    html += `<p class="pdl-footer">PMC full-text scan &middot; v${PDL_VERSION} &middot; ${PDL_BUILT}</p>`;
    panel.innerHTML = html;

    // Attach copy button listeners after innerHTML is set
    panel.querySelectorAll(".pdl-copy-btn[data-copy]").forEach(btn => {
      btn.addEventListener("click", () => {
        const text = btn.getAttribute("data-copy");
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = "✓ Copied";
          btn.classList.add("pdl-copy-btn--done");
          setTimeout(() => {
            btn.textContent = "Copy";
            btn.classList.remove("pdl-copy-btn--done");
          }, 2000);
        });
      });
    });

    // Attach Copy All IDs button listener
    const copyAllBtn = panel.querySelector("#pdl-copy-all");
    if (copyAllBtn && accessions) {
      copyAllBtn.addEventListener("click", () => {
        const allIds = accessions.map(a => a.accession).join("\n");
        navigator.clipboard.writeText(allIds).then(() => {
          copyAllBtn.textContent = "✓ Copied";
          copyAllBtn.classList.add("pdl-copy-btn--done");
          setTimeout(() => {
            copyAllBtn.textContent = "Copy all IDs";
            copyAllBtn.classList.remove("pdl-copy-btn--done");
          }, 2000);
        });
      });
    }

    // Attach Download Script button listener
    const dlBtn = panel.querySelector("#pdl-dl-script");
    if (dlBtn && accessions) {
      dlBtn.addEventListener("click", () => {
        const script   = buildDownloadScript(accessions, pmcid);
        const blob     = new Blob([script], { type: "text/x-shellscript" });
        const url      = URL.createObjectURL(blob);
        const a        = document.createElement("a");
        a.href         = url;
        a.download     = `download_data_${pmcid || "article"}.sh`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    wrapper.appendChild(panel);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

})();
