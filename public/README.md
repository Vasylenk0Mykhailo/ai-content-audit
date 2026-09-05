# Static assets

Vite serves files in this folder at the root of the deployed site
(e.g. `public/netpeak-header.png` → `https://<host>/netpeak-header.png`).

## Required brand assets for the PDF report

Save the two images supplied by the brand team here:

| File path                       | Description                                                              |
|---------------------------------|--------------------------------------------------------------------------|
| `public/netpeak-header.png`     | Wide blue banner (~1230×90 px) used in the PDF header on every page.    |
| `public/netpeak-footer-star.png`| Light-blue four-point star (~32×32 px) used in the PDF footer.          |

If these files are missing, the PDF generator falls back to drawing a plain
blue banner with the `netpeak / marketing partner` text — the report still
builds successfully, just without the brand texture.
