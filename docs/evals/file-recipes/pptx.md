# PPTX

Use for PowerPoint decks, investor presentations, board decks, and slide templates.

## Runtime Essentials

- Include a presentation parser such as `python-pptx` or an equivalent when the runner or grader needs to inspect slide text, notes, tables, charts, images, or shape counts.
- Include LibreOffice/`soffice` when slide rendering, PDF conversion, or Office compatibility checks matter.
- Add `poppler-utils` only when converting rendered PDFs into slide images.

## Essentials

- Text extraction can miss layout, clipping, overlaps, and chart readability issues.
- Render slides when visual layout is part of the task.
- Speaker notes, theme/layout names, charts, and embedded media may need parser-specific checks.
- Do not score raw `.pptx` bytes; presentation package metadata and relationship ordering are not stable scoring surfaces.
