# File Output Essentials

Use these notes to choose runtime prerequisites for file-output evals. They are intentionally short: install the tools a runner or grader needs, then keep the eval contract in [../from-file-outputs.md](../from-file-outputs.md).

## Shared Rules

- Avoid byte-for-byte scoring for generated Office and PDF files.
- Put generated files and diagnostics under `/workspace/output`.
- Put format tools in `benchmark.environment.dockerfile`.
- Use the smallest toolchain that can open, inspect, convert, or render the file types the eval actually depends on.
- When LibreOffice is available, `soffice --headless` is often useful for Office files: it can open, save, convert, and render `.xlsx`, `.docx`, and `.pptx` files. Treat it as a useful runtime capability, not a required scoring method.

## Runtime Prerequisites

| Format | Useful tools | Essential reminder |
| --- | --- | --- |
| `.xlsx` | LibreOffice/`soffice`, `openpyxl` or equivalent, optional `poppler-utils` | Spreadsheet libraries can preserve formulas without calculating them; use an Office engine when cached values or visual rendering matter. |
| `.docx` | LibreOffice/`soffice`, `python-docx` or equivalent, optional `poppler-utils` | Parse structure when content matters; render pages when layout matters. |
| `.pptx` | LibreOffice/`soffice`, `python-pptx` or equivalent, optional `poppler-utils` | Parse slide content when text matters; render slides when layout matters. |
| `.pdf` | `pypdf`, `pdfplumber` or equivalent, `poppler-utils`, optional OCR tooling | Prefer text extraction for born-digital PDFs; use OCR only for scanned inputs. |

## Recipes

- [docx.md](docx.md)
- [xlsx.md](xlsx.md)
- [pdf.md](pdf.md)
- [pptx.md](pptx.md)
