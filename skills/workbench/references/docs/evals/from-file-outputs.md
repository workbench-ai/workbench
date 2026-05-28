# From File Outputs

Use this path when case inputs, outputs, examples, or goldens are files such as `.docx`, `.xlsx`, `.pdf`, or `.pptx`. The candidate is still only the mutable thing Workbench improves, such as a skill, prompt, script, template, command, or workflow. The benchmark selects an engine; the built-in `workbench` engine owns optional native task path selection, environment, and scoring. The candidate manifest owns how to run the candidate.

## Authoring Boundary

Keep the Workbench boundary simple:

- Put public supporting files under `tasks/<case>/files/`.
- Put private goldens, references, rubrics, tolerances, and task-specific scoring material under `tasks/<case>/tests/`.
- Keep the mutable workflow under `candidates/<name>/files/`; do not put eval-only goldens or scoring logic in the candidate unless the evaluator itself is the product being improved.
- Put each runnable candidate choice in its own candidate directory, such as `candidates/codex/` or `candidates/command/`.
- Put improve settings in the candidate manifest; `workbench improve` uses the current candidate by default.
- Have the candidate write generated files into `/workspace` and copy durable diagnostics, artifacts, or traces into `/workspace/output`.
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

`task.yaml` contains `version: 3`, task text, and optional explicit `files`, `tests`, and `solution` path objects for the built-in `workbench` engine. Omitted `engine.with.tasks` makes the engine read `tasks/`; use `engine.with.tasks.path` only for a non-default native task directory. `task.yaml` is not staged as a source file. Candidates see task files from `files.path` through `paths.case`, normally `/workspace/input/case`. Engine-owned scoring helpers see the final mutated workspace plus verifier-private files exposed by the engine under `paths.enginePrivate`, normally `/workspace/private/engine`.

## Candidate Layout

Keep the mutable surface narrow:

```text
candidates/
  codex/
    candidate.yaml
    files/
      SKILL.md
```

`candidate.yaml` declares the sibling files directory explicitly:

```yaml
version: 4
name: codex-file-workflow
files:
  path: files
prepare:
  command: sh input/candidate/prepare.sh
runs:
  codex:
    name: Codex
    use: codex
defaultRun: codex
improve:
  edits:
    - SKILL.md
  use: codex
```

If Workbench should improve a source file, include that file in `candidate.improve.edits`. If Workbench should improve a prompt, skill, command runner, or generation script, keep examples and goldens in `tasks/` and include only the mutable candidate-relative source paths under `candidate.improve.edits`.

For agent-facing generation workflows, prefer a skill candidate unless the command-line workflow itself is clearly what should improve.

## Environment Essentials

File-output evals often need format-specific tools in `engine.with.environment.dockerfile`. Install only what the candidate or scoring helper actually needs. When in doubt, choose the recipe for the primary output type:

- Word documents: [file-recipes/docx.md](file-recipes/docx.md)
- Excel workbooks: [file-recipes/xlsx.md](file-recipes/xlsx.md)
- PDFs: [file-recipes/pdf.md](file-recipes/pdf.md)
- PowerPoint decks: [file-recipes/pptx.md](file-recipes/pptx.md)

For mixed outputs, use the dominant output recipe and add only the extra prerequisites required by the secondary format.
