# PubMed Data Linker — Data Guide

This guide explains what types of data the extension detects, where they come from,
and what you can do with them.

---

## How data is found

The extension fetches the **PMC full-text XML** of the article (Open Access articles only)
and scans it with regular expressions for known accession number patterns. It does **not**
rely on author-submitted metadata or repository registration — it reads the actual text of
the paper, including the Methods, Data Availability, and Supplementary sections.

> **Limitation:** Only articles available as Open Access full text in PubMed Central (PMC)
> can be scanned. Paywalled articles will show a "full-text scan unavailable" message.

---

## Accession types detected

### Genomics & Sequencing

| Repository | Example | What it links to |
|---|---|---|
| **GEO Series** | `GSE109774` | A Gene Expression Omnibus study — typically contains RNA-seq, microarray, ChIP-seq, ATAC-seq, or single-cell expression data for multiple samples |
| **GEO Sample** | `GSM3261134` | An individual sample within a GEO Series |
| **SRA Study** | `SRP077839` | A Sequence Read Archive study — raw sequencing reads for a project |
| **SRA Run** | `SRR6062045` | A single sequencing run (FASTQ files) |
| **SRA Experiment** | `SRX3112345` | A sequencing experiment (library + instrument settings) |
| **BioProject** | `PRJNA294096` | An NCBI BioProject — umbrella record linking genome assemblies, SRA data, and BioSamples for a study |
| **BioSample** | `SAMN04014715` | Metadata for a biological sample (organism, tissue, collection info) |
| **NCBI Genome (RefSeq)** | `GCF_046573245.1` | A RefSeq genome assembly (curated) |
| **NCBI Genome (GenBank)** | `GCA_003260245.2` | A GenBank genome assembly (submitted) |
| **ENA** | `ERP123456`, `ERR789012` | European Nucleotide Archive — equivalent to SRA, commonly used for European sequencing projects |
| **ArrayExpress** | `E-MTAB-6128` | EBI ArrayExpress — functional genomics datasets (expression, epigenomics) |
| **dbGaP** | `phs002999` | Database of Genotypes and Phenotypes — controlled-access human genetic data (requires application for access) |
| **RefSeq RNA** | `NM_007294.4`, `NR_024540.1` | NCBI RefSeq curated mRNA/ncRNA sequences — cited when depositing or referencing specific transcripts |
| **RefSeq Protein** | `NP_009225.1`, `WP_010896559.1` | NCBI RefSeq curated protein sequences — cited in structural/functional studies |
| **RefSeq Genome** | `NC_000017.11`, `NZ_CP012124.1` | NCBI RefSeq chromosome/contig sequences — cited as reference sequences |
| **UniProt** | `P04637`, `Q5K651` | UniProt/Swiss-Prot protein entry — cited when referencing a specific protein's canonical sequence or annotation |
| **dbSNP** | `rs334`, `rs1799945` | NCBI dbSNP — single nucleotide polymorphisms and short variants |
| **ClinVar** | `RCV000003374`, `VCV000000001` | NCBI ClinVar — clinical significance of genetic variants |

### Data Repositories

| Repository | Example | What it links to |
|---|---|---|
| **Zenodo** | `zenodo.org/record/1234567` | General-purpose research data repository (CERN) — any file type: code, processed data, models, images |
| **Figshare** | `figshare.com/articles/...` or `doi.org/10.6084/m9.figshare.25869523` | General-purpose repository — figures, datasets, code, posters |
| **Dryad** | `datadryad.org/stash/dataset/doi:...` | Curated data repository focused on ecology, evolution, and biology |
| **OSF** | `osf.io/abc12` | Open Science Framework — preregistrations, data, analysis code |
| **PRIDE** | `PXD065050` | ProteomeXchange/PRIDE — mass spectrometry proteomics raw data and search results |
| **MetaboLights** | `MTBLS11801` | EBI MetaboLights — metabolomics studies including raw data, protocols, and metadata |
| **MassIVE** | `MSV000087190` | UCSD MassIVE — mass spectrometry data repository (proteomics and metabolomics) |

---

## What data types are most common by field

| Research area | Most common accession types |
|---|---|
| Transcriptomics / RNA-seq | GEO Series (GSE), SRA Study (SRP), ArrayExpress |
| Single-cell genomics | GEO Series (GSE), SRA Run (SRR) |
| Genome assembly / annotation | NCBI Genome (GCF_/GCA_), BioProject (PRJNA), BioSample (SAMN) |
| Metagenomics | SRA Study (SRP), BioProject (PRJNA), ENA (ERP) |
| GWAS / human genetics | dbGaP (phs) — note: requires access application |
| Epigenomics / ChIP-seq | GEO Series (GSE), ArrayExpress |
| Ecology / evolution | Dryad, Zenodo, OSF |
| Software / code | Zenodo, Figshare, OSF |
| Proteomics | PRIDE (`PXD`), MassIVE (`MSV`) |
| Metabolomics | MetaboLights (`MTBLS`), MassIVE (`MSV`) |
| Human genetics / GWAS | dbSNP (`rs`), ClinVar (`RCV`/`VCV`), dbGaP (`phs`) |
| Structural biology | UniProt (`P`/`Q`/`O` + digits), RefSeq Protein (`NP_`/`WP_`) |
| Reference sequences | RefSeq RNA (`NM_`/`NR_`), RefSeq Genome (`NC_`/`NZ_`) |

---

## Download support

The extension generates download commands for accession types supported by the
**NCBI Datasets CLI** and **SRA Toolkit**. Other repositories require manual download.

| Accession type | Download method | Notes |
|---|---|---|
| `GCF_` / `GCA_` | `datasets download genome accession` | Single CLI call; use `--preview` first to check size |
| `PRJNA` | `datasets download genome accession` | Mixed with GCF_/GCA_ in one call; ⚠️ warning shown if >50 genomes |
| `SRR` / `SRX` / `SRP` | `prefetch` + `fasterq-dump` (SRA Toolkit) | Downloads raw FASTQ files |
| `Zenodo` / `Figshare` / `Dryad` / `OSF` | `wget -c <url>` | Direct download |
| `PXD` / `MTBLS` / `MSV` | Manual — use repository website | PRIDE, MetaboLights, MassIVE require browser download |
| `NM_` / `NR_` / `NP_` / `WP_` / `NC_` / `NZ_` | Manual — use NCBI Nucleotide/Protein pages | RefSeq sequences; download via NCBI or `efetch` |
| UniProt (`P`/`Q`/`O`…) | Manual — use UniProt website | Download FASTA, annotation, or structure from uniprot.org |
| `GSE` / `GSM` | Manual — use GEO website or `GEOquery` R package | No simple CLI |
| `ERP` / `ERR` | Manual — use ENA browser or `enaBrowserTools` | No simple CLI |
| `phs` (dbGaP) | Manual — requires dbGaP access application | Controlled access |
| `SAMN` | Manual — links to BioSample metadata page | Find associated assembly via BioProject |

### NCBI Datasets CLI — REST API endpoints

The extension also provides direct REST API URLs for metadata inspection (no download):

| Accession type | Endpoint | Returns |
|---|---|---|
| `GCF_` / `GCA_` | `/genome/accession/{id}/dataset_report` | Assembly stats, organism, annotation info (JSON) |
| `PRJNA` | `/genome/bioproject/{id}/dataset_report` | All assemblies in the project with stats (JSON) |

These URLs can be opened in a browser or called with `curl` to inspect what is available
before committing to a download.

---

## What the extension does NOT detect

- **PRIDE / ProteomeXchange** — proteomics data (e.g., `PXD012345`) — planned
- **MetaboLights** — metabolomics data (e.g., `MTBLS123`) — planned
- **Supplementary files** — data deposited only as journal supplementary materials (no accession)
- **Paywalled full text** — articles not in PMC Open Access cannot be scanned
- **Data mentioned only in citations** — accessions in the reference list but not the main text may be missed

---

## Test articles

These articles are confirmed to work well with the extension:

| PMC ID | What to expect |
|---|---|
| [PMC12917157](https://pmc.ncbi.nlm.nih.gov/articles/PMC12917157/) | SRA runs + BioProject + 4× genome assemblies → consolidated `datasets` CLI command |
| [PMC12877864](https://pmc.ncbi.nlm.nih.gov/articles/PMC12877864/) | 2× GEO Series + ArrayExpress |
| [PMC12066770](https://pmc.ncbi.nlm.nih.gov/articles/PMC12066770/) | GEO + 4× BioProject + 2× ArrayExpress |
| [PMC12918441](https://pmc.ncbi.nlm.nih.gov/articles/PMC12918441/) | 4× ENA run accessions |
| [PMC12866024](https://pmc.ncbi.nlm.nih.gov/articles/PMC12866024/) | Figshare DOI + dbGaP |
| [PMC12931631](https://pmc.ncbi.nlm.nih.gov/articles/PMC12931631/) | PRIDE (`PXD065050`) + UniProt + RefSeq Protein |
| [PMC12272963](https://pmc.ncbi.nlm.nih.gov/articles/PMC12272963/) | MetaboLights (`MTBLS11801`) |
| [PMC12412648](https://pmc.ncbi.nlm.nih.gov/articles/PMC12412648/) | MassIVE (`MSV000087190`, `MSV000088324`) |
| [PMC12151212](https://pmc.ncbi.nlm.nih.gov/articles/PMC12151212/) | Single GCF_ genome assembly (also testable via [PMID 40496740](https://pubmed.ncbi.nlm.nih.gov/40496740/)) |
