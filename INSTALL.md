# PubMed Data Linker v1.5.2 — Installation Guide

Adds a **"🔗 Find Data"** button to PubMed and PMC article pages. On click it:

1. Queries **NCBI LinkOut** for repository-registered dataset links for the article
2. Fetches the **PMC full text** (Open Access articles only) and scans for **25 accession types**
3. Generates **NCBI Datasets CLI commands** and **SRA Toolkit commands**
4. Offers a **⬇ Download .sh script** combining all download commands in one file

See **DATA_GUIDE.md** for a full explanation of all detected data types and download methods.

---

## Detected accession types (26 total)

| Category | Types detected |
|---|---|
| Gene expression | GEO Series (`GSE`), GEO Sample (`GSM`), ArrayExpress (`E-XXXX-NNNN`) |
| Sequencing | SRA Study (`SRP`), Run (`SRR`), Experiment (`SRX`), ENA (`ERP`/`ERR`/`ERX`/`ERS`/`ERZ`) |
| Genomes & samples | BioProject (`PRJNA`), BioSample (`SAMN`), NCBI Genome (`GCF_`/`GCA_`) |
| RefSeq sequences | RNA (`NM_`/`NR_`/`XM_`/`XR_`), Protein (`NP_`/`XP_`/`WP_`), Genome (`NC_`/`NG_`/`NT_`/`NW_`/`NZ_`) |
| Variants | dbSNP (`rs`), ClinVar (`RCV`/`VCV`), dbGaP (`phs`) |
| Proteomics / metabolomics | PRIDE (`PXD`), MetaboLights (`MTBLS`), MassIVE (`MSV`), UniProt |
| Repositories | Zenodo, Figshare (URL + DOI), Dryad, OSF |

---

## File structure

```
pubmed_data_link_extension/
├── manifest.json               ← extension config (Manifest V3)
├── content.js                  ← injected content script
├── styles.css                  ← button & panel styles
├── DATA_GUIDE.md               ← full data types reference
├── INSTALL.md                  ← this file
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Install in Chrome / Edge / Brave

1. Unzip the downloaded file if needed.
2. Open **chrome://extensions** (or **edge://extensions**).
3. Enable **Developer mode** (toggle, top-right).
4. Click **"Load unpacked"**.
5. Select the `pubmed_data_link_extension/` folder.
6. Navigate to any PubMed or PMC article page.
7. The **🔗 Find Data** button will appear below the article heading.

---

## Install in Firefox

1. Open **about:debugging#/runtime/this-firefox**.
2. Click **"Load Temporary Add-on…"**.
3. Select the `manifest.json` file inside the extension folder.
4. The extension is active until Firefox is restarted.

### Permanent install (Firefox Developer Edition / Nightly only)
1. Open **about:config** → set `xpinstall.signatures.required` to `false`.
2. Zip the extension folder contents (not the folder itself):
   ```bash
   cd pubmed_data_link_extension
   zip -r ../pubmed_data_linker.zip .
   ```
3. Open **about:addons** → gear icon → **"Install Add-on From File…"** → select the zip.

---

## Usage

1. Go to any PubMed or PMC article page.
2. Click **🔗 Find Data** — the button appears just below the article title.
3. The panel opens showing:
   - **NCBI LinkOut** — dataset links registered by repositories against this PMID (deduplicated against full-text results)
   - **Accessions found** — grouped by repository type, each linking to the repository page
   - **NCBI Datasets** — CLI commands and REST API URLs for genome/BioProject accessions
   - **⬇ Download .sh script** — saves a shell script with all download commands
4. Click any accession link to open it in a new tab.
5. Click **🔗 Find Data** again to close the panel.

### NCBI Datasets CLI commands

For articles with genome assemblies (`GCF_`/`GCA_`) or BioProject (`PRJNA`) accessions:

- **CLI command** — consolidated `datasets download genome accession` call (GCF_/GCA_ and PRJNA mixed)
- **Preview command** — same with `--preview` flag (shows what would be downloaded, no files saved)
- **REST API metadata report** — JSON endpoint for assembly stats before downloading
- **⚠️ Warning** — shown if a BioProject contains >50 genomes, with suggestions to filter by assembly level or use `--dehydrated`

Requires the [NCBI Datasets CLI](https://www.ncbi.nlm.nih.gov/datasets/docs/v2/download-and-install/).

### Download script

The **⬇ Download .sh script** button saves a `download_data_<PMCID>.sh` file containing:
- `datasets download genome accession` for genome assemblies and BioProjects
- `prefetch` + `fasterq-dump` for SRA runs (requires [SRA Toolkit](https://github.com/ncbi/sra-tools))
- `wget` for Zenodo, Figshare, Dryad, OSF
- Commented URLs for GEO, ENA, ArrayExpress, dbGaP, PRIDE, MetaboLights, MassIVE (require manual or tool-specific download)

---

## Test articles

| URL | What to expect |
|---|---|
| [PMC12917157](https://pmc.ncbi.nlm.nih.gov/articles/PMC12917157/) | SRA + BioProject + 4 genome assemblies → consolidated `datasets` CLI |
| [PMC12877864](https://pmc.ncbi.nlm.nih.gov/articles/PMC12877864/) | GEO Series + ArrayExpress |
| [PMC12066770](https://pmc.ncbi.nlm.nih.gov/articles/PMC12066770/) | GEO + 4 BioProjects + ArrayExpress |
| [PMC12918441](https://pmc.ncbi.nlm.nih.gov/articles/PMC12918441/) | ENA run accessions |
| [PMC12866024](https://pmc.ncbi.nlm.nih.gov/articles/PMC12866024/) | Figshare DOI + dbGaP |
| [PMC12931631](https://pmc.ncbi.nlm.nih.gov/articles/PMC12931631/) | PRIDE + UniProt + RefSeq Protein |
| [PMC12272963](https://pmc.ncbi.nlm.nih.gov/articles/PMC12272963/) | MetaboLights |
| [PMC12412648](https://pmc.ncbi.nlm.nih.gov/articles/PMC12412648/) | MassIVE |
| [PMID 32214235](https://pubmed.ncbi.nlm.nih.gov/32214235/) | NCBI LinkOut results (tests PubMed→LinkOut path) |
| [PMID 40496740](https://pubmed.ncbi.nlm.nih.gov/40496740/) | Single GCF_ genome (tests PubMed→PMC resolution) |

---

## Privacy

No data is collected. The extension makes read-only requests to public APIs only:

| Host | Purpose |
|---|---|
| `eutils.ncbi.nlm.nih.gov` | Fetch PMC full text; resolve PMID→PMCID; fetch LinkOut entries |
| `api.ncbi.nlm.nih.gov` | BioProject genome count lookup (`dataset_report`) |
