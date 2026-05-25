# From File Outputs

Use this path when case inputs, outputs, examples, or goldens are files such as `.docx`, `.xlsx`, `.pdf`, or `.pptx`. The subject is still only the mutable thing Workbench improves, such as a skill, prompt, script, template, command, or workflow. The benchmark selects an engine; the built-in `workbench` engine owns optional native task path selection, environment, and scoring. The subject manifest owns how to run the subject.

## Authoring Boundary

Keep the Workbench boundary simple:

- Put public supporting files under `tasks/<case>/files/`.
- Put private goldens, references, rubrics, tolerances, and task-specific scoring material under `tasks/<case>/tests/`.
- Keep the mutable workflow under `subjects/<name>/files/`; do not put eval-only goldens or scoring logic in the subject unless the evaluator itself is the product being improved.
- Put each runnable subject choice in its own subject directory, such as `subjects/codex/` or `subjects/command/`.
- Put improve settings in optimizer YAML; `workbench improve` uses the current subject by default.
- Have the subject write generated files into `/workspace` and copy durable diagnostics, artifacts, or traces into `/workspace/output`.
- Do not write a custom scoring helper just because a case produces binary files.
- Use `engine.with.score: { use: rubric }` for judgment-heavy quality; use `engine.with.score: { use: tests }` only for deterministic checks or an existing scoring workflow. Rubric scoring runs one judge turn per criterion; set `score.with.parallelism` when you need to throttle those criterion turns.

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

`task.yaml` contains `version: 3`, task text, and optional explicit `files`, `tests`, and `solution` path objects for the built-in `workbench` engine. Omitted `engine.with.tasks` makes the engine read `tasks/`; use `engine.with.tasks.path` only for a non-default native task directory. `task.yaml` is not staged as a source file. Subjects see task files from `files.path` through `paths.case`, normally `/workspace/input/case`. Engine-owned scoring helpers see the final mutated workspace plus verifier-private files exposed by the engine under `paths.enginePrivate`, normally `/workspace/private/engine`.

## Subject Layout

Keep the mutable surface narrow:

```text
subjects/
  codex/
    subject.yaml
    files/
      SKILL.md
```

`subject.yaml` declares the sibling files directory explicitly:

```yaml
version: 3
name: codex-file-workflow
files:
  path: files
prepare:
  command: sh input/subject/prepare.sh
run:
  use: codex
```

If Workbench should improve a source file, include that file in `optimizer.edits`. If Workbench should improve a prompt, skill, command runner, or generation script, keep examples and goldens in `tasks/` and include only the mutable subject-relative source paths under `optimizer.edits`.

For agent-facing generation workflows, prefer a skill subject unless the command-line workflow itself is clearly what should improve.

## Environment Essentials

File-output evals often need format-specific tools in `engine.with.environment.dockerfile`. Install only what the subject or scoring helper actually needs. When in doubt, choose the recipe for the primary output type:

- Word documents: [file-recipes/docx.md](file-recipes/docx.md)
- Excel workbooks: [file-recipes/xlsx.md](file-recipes/xlsx.md)
- PDFs: [file-recipes/pdf.md](file-recipes/pdf.md)
- PowerPoint decks: [file-recipes/pptx.md](file-recipes/pptx.md)

For mixed outputs, use the dominant output recipe and add only the extra prerequisites required by the secondary format.
