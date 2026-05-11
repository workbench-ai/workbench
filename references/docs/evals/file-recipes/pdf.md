# PDF

Use for rendered reports, filings, invoices, statements, and fixed-layout outputs.

## Runtime Essentials

- Include a PDF text parser such as `pypdf`, `pdfplumber`, or an equivalent when content extraction matters.
- Include `poppler-utils` when page rendering, image conversion, or bounding-box inspection matters.
- Add OCR tooling only when scanned PDFs are in scope.

## Essentials

- Treat born-digital PDFs and scanned PDFs differently; prefer direct text extraction for born-digital files.
- Use rendered pages when layout, blank pages, clipping, or visual placement matter.
- Invoices, statements, and forms often need explicit numeric tolerances for currency, rounding, and field placement.
- Do not score raw `.pdf` bytes; generated PDFs often include timestamps, object ids, compression differences, or renderer-specific metadata.
