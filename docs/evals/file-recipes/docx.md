# DOCX

Use for Word documents, contracts, reports, memos, and redlines.

## Runtime Essentials

- Include a DOCX parser such as `python-docx` or an equivalent when the runner or grader needs to inspect text, headings, tables, headers, footers, comments, or styles.
- Include LibreOffice/`soffice` when page rendering, PDF conversion, or Office compatibility checks matter.
- Add `poppler-utils` only when converting rendered PDFs into page images.

## Essentials

- Structural parsing and rendered layout checks answer different questions; use only the one the eval needs.
- Layout-sensitive tasks should verify that the output opens and renders with the intended toolchain.
- Comments, tracked changes, relationships, and timestamps may not be visible in rendered output, so inspect document structure when those features matter.
- Do not score raw `.docx` bytes; ids, timestamps, relationship ordering, and compression can change across valid outputs.
