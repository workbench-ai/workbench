# From File Outputs

Use this path when tasks, outputs, examples, or goldens are files such as `.docx`, `.xlsx`, `.pdf`, or `.pptx`. The subject is still only the mutable thing Workbench improves, such as a skill, pipeline, prompt, script, template, or workflow. The benchmark owns optional task-source selection, environment, and scoring; the subject manifest owns how to run the subject.

## Authoring Boundary

Keep the Workbench boundary simple:

- Put public supporting files under `tasks/<case>/files/`.
- Put private goldens, references, rubrics, tolerances, and task-specific scorer material under `tasks/<case>/tests/`.
- Keep the mutable workflow under `subjects/<name>/files/`; do not put eval-only goldens or scorer logic in the subject unless the evaluator itself is the product being improved.
- Put each runnable subject choice in its own subject directory, such as `subjects/claude/` or `subjects/codex/`.
- Put improve settings in optimizer YAML; `workbench improve` uses the current subject by default.
- Have the subject write generated files and any useful diagnostics into the trial workspace.
- Do not write a custom scorer just because a task produces binary files.
- Use `score: use: rubric` for judgment-heavy quality; use `score: use: tests` only for deterministic checks or an existing scorer.

## Task Layout

Use one folder per task:

```text
tasks/
  board-report-format/
    task.yaml
    files/
      source-notes.md
    tests/
      golden.docx
      rubric.md
      test.sh
  forecast-workbook/
    task.yaml
    files/
      draft.xlsx
    tests/
      golden.xlsx
      checks.json
      test.sh
```

`task.yaml` contains `version: 2`, task text, and optional explicit `files`, `tests`, and `solution` path objects for the built-in `path` task-source adapter. The adapter parses this native source into `TaskBundle` data before core plans trials. `task.yaml` is not staged as a source file. Subjects see task files from `files.path` in the trial workspace. Scorers see the final mutated workspace plus verifier files mounted at `/tests`.

## Subject Layout

Keep the mutable surface narrow:

```text
subjects/
  claude/
    subject.yaml
    files/
      SKILL.md
```

`subject.yaml` declares the sibling files directory explicitly:

```yaml
version: 2
name: claude-file-workflow
files:
  path: files
run:
  use: claude
```

If Workbench should improve a source file, include that file in `optimizer.edits`. If Workbench should improve a prompt, skill, pipeline, or generation script, keep examples and goldens in `tasks/` and include only the mutable subject-relative source paths under `optimizer.edits`.

For agent-facing generation workflows, prefer a skill subject unless the pipeline or command-line workflow itself is clearly what should improve.

## Environment Essentials

File-output evals often need format-specific tools in `benchmark.environment.dockerfile`. Install only what the subject or score phase actually needs. When in doubt, choose the recipe for the primary output type:

- Word documents: [file-recipes/docx.md](file-recipes/docx.md)
- Excel workbooks: [file-recipes/xlsx.md](file-recipes/xlsx.md)
- PDFs: [file-recipes/pdf.md](file-recipes/pdf.md)
- PowerPoint decks: [file-recipes/pptx.md](file-recipes/pptx.md)

For mixed outputs, use the dominant output recipe and add only the extra prerequisites required by the secondary format.
