# XLSX

Use for workbooks, models, calculators, schedules, and exported tables.

## Runtime Essentials

- Include a workbook parser such as `openpyxl` or an equivalent when the runner or grader needs to inspect sheets, cells, formulas, tables, or workbook structure.
- Include LibreOffice/`soffice` when formula caches, Office compatibility, PDF conversion, or visual rendering matter.
- Add `poppler-utils` only when converting rendered PDFs into page images.

## Essentials

- `openpyxl` can read and write formulas, but it does not calculate them.
- Cached formula values may be stale or missing unless an Office engine recalculates or refreshes the workbook.
- Financial-model evals usually need explicit checks for key outputs, check cells, and tie-outs such as balance sheet balance or cash flow linkage.
- Do not score raw `.xlsx` bytes; workbook metadata and package ordering can change even when the workbook is acceptable.
