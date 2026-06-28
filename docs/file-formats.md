# File formats

Add file-format guidance to the eval case when a workflow generates or inspects workbooks, documents, slide decks, PDFs, or tabular exports. Keep the main eval definition focused on workflow quality, then add the tools needed to inspect, convert, render, or validate the files.

## Shared rules

- Do not score generated Office, PDF, or archive-backed artifacts byte-for-byte. File metadata and ordering can change even when the artifact is acceptable.
- Put generated outputs and diagnostics under `/workspace/output`.
- Put runtime tools in `.workbench/environment/Dockerfile`.
- Use structured parsers for content and data checks.
- Render files when visual layout, pagination, slide composition, or Office-calculated values matter.
- Keep format-specific checks in case files, tests, grading criteria, scripts, or skill references.

## Runtime tools

| File type | Useful tools | Reminder |
| --- | --- | --- |
| `.xlsx` | LibreOffice/`soffice`, `openpyxl`, optional `poppler-utils` | Spreadsheet libraries can preserve formulas without calculating them; use an Office engine for formula caches, recalculation, PDF conversion, or visual rendering. |
| `.docx` | LibreOffice/`soffice`, `python-docx`, optional `poppler-utils` | Parse structure for content checks; render pages for layout, pagination, tables, headers, footers, or visual fidelity. |
| `.pptx` | LibreOffice/`soffice`, `python-pptx`, optional `poppler-utils` | Parse slide text and structure for content; render slides for positioning, charts, images, overflow, or brand fidelity. |
| `.pdf` | `pypdf`, `pdfplumber`, `poppler-utils`, optional OCR tooling | Prefer text extraction for born-digital PDFs; render pages for layout checks; use OCR only for scanned or image-only inputs. |

## XLSX

For workbooks, models, calculators, schedules, and exported tables:

- Include a workbook parser such as `openpyxl` when the runner or grader needs to inspect sheets, cells, formulas, tables, workbook structure, or visible values.
- Include LibreOffice/`soffice` when formula caches, Office fidelity checks, PDF conversion, or visual rendering matter.
- `openpyxl` can read and write formulas, but it does not calculate them.
- Cached formula values can be stale or missing unless an Office engine recalculates or refreshes the workbook.
- Financial-model evals need explicit checks for key outputs, check cells, formulas, statement links, model preservation, signs, units, and tie-outs such as balance sheet balance or cash flow linkage.
- Avoid circular references and formulas that depend on interactive or iterative calculation unless the environment and grader explicitly support them.

## DOCX

For memos, contracts, reports, letters, and structured narrative documents:

- Include a parser such as `python-docx` when text, headings, tables, styles, comments, or document structure drive the score.
- Include LibreOffice/`soffice` when page rendering, PDF conversion, or Office fidelity checks matter.
- Render to PDF or page images when pagination, headers, footers, tables, footnotes, images, or layout quality affect correctness.
- Score semantic content separately from visual presentation when both matter.

## PPTX

For slide decks, pitch materials, board updates, and presentation exports:

- Include a parser such as `python-pptx` when slide text, speaker notes, shape structure, or deck metadata drive the score.
- Include LibreOffice/`soffice` when slide rendering, PDF conversion, or visual fidelity checks matter.
- Render slides when grading depends on layout, alignment, charts, images, brand treatment, or overflow.
- Check slide order, missing required slides, malformed charts or tables, and text that is visually clipped or off-canvas.

## PDF

For generated reports, rendered Office artifacts, filings, invoices, forms, and scanned documents:

- Use text extraction for born-digital PDFs when content accuracy is the primary criterion.
- Use rendered page images when layout, pagination, table geometry, signatures, stamps, or visual fidelity matter.
- Use OCR only when the PDF is scanned or image-only, and treat OCR uncertainty as part of the grading design.
- For generated PDFs, keep source content checks and rendered-layout checks separate so a visual defect does not hide a content defect.
