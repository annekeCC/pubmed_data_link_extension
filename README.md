# PubMed Data Linker

A browser extension (Manifest V3, Chrome / Edge / Brave / Firefox) that adds a **Find Data** button to PubMed and PMC article pages. On click it queries NCBI LinkOut, scans the PMC full text for 25 data accession types, and generates NCBI Datasets CLI and SRA Toolkit download commands, including a combined download script.

- **[INSTALL.md](INSTALL.md)** — installation, usage, test articles, privacy notes
- **[DATA_GUIDE.md](DATA_GUIDE.md)** — reference for every detected data type and how to download it

This project was built using Biomni.

## Files

| Path | Purpose |
|---|---|
| `manifest.json` | Extension config (Manifest V3) |
| `content.js` | Content script injected into PubMed / PMC pages |
| `styles.css` | Button and panel styles |
| `icons/` | Extension icons (16 / 48 / 128 px) |
| `PubMedDataLinker.tsx`, `PubMedDataLinker.module.css`, `mockup.png` | React design mockup of the panel UI |

## Quick install (Chrome / Edge)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open any PubMed or PMC article and click **Find Data** below the title.

No data is collected; the extension only makes read-only requests to public NCBI APIs.
