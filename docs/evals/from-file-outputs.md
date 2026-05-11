# From File Outputs

Use this path when tasks, outputs, examples, or goldens are files such as `.docx`, `.xlsx`, `.pdf`, or `.pptx`. The candidate is still only the mutable thing Workbench improves, such as a skill, pipeline, prompt, script, template, or workflow. The benchmark owns tasks, environment, and grading; the candidate manifest owns how to run the candidate.

## Authoring Boundary

Keep the Workbench boundary simple:

- Put public supporting files under `tasks/<case>/input/`.
- Put private goldens, references, rubrics, tolerances, and task-specific command-grader material under `tasks/<case>/expected/`.
- Keep the mutable workflow under `candidates/<name>/files/`; do not put eval-only goldens or grader logic in the candidate unless the evaluator itself is the product being improved.
- Put each runnable candidate/runner choice in its own candidate directory, such as `candidates/claude/` or `candidates/codex/`.
- Put improve settings in optimizer YAML; `workbench improve` uses the current candidate by default.
- Have the runner write generated files and any useful diagnostics under `/workspace/output`.
- Do not write a custom grader just because a task produces binary files.
- Use `grade: use: rubric` for judgment-heavy quality; use `grade: use: command` only for deterministic checks or an existing scorer.

## Task Layout

Use one folder per task:

```text
tasks/
  board-report-format/
    task.yaml
    input/
      source-notes.md
    expected/
      golden.docx
      rubric.md
  forecast-workbook/
    task.yaml
    input/
      draft.xlsx
    expected/
      golden.xlsx
      checks.json
```

`task.yaml` contains the task instruction and is not mounted as a runtime file. Runners see optional `/workspace/input/task/input`; graders also see optional `/workspace/input/task/expected` and runner output files at `/workspace/input/runner-output`.

## Candidate Layout

Keep the mutable surface narrow:

```text
candidates/
  claude/
    candidate.yaml
    files/
      SKILL.md
```

If Workbench should improve a source file, include that file in `optimizer.edits`. If Workbench should improve a prompt, skill, pipeline, or generation script, keep examples and goldens in `tasks/` and include only the mutable candidate-relative source paths under `optimizer.edits`.

For agent-facing generation workflows, prefer a skill candidate unless the pipeline or command-line workflow itself is clearly what should improve.

## Environment Essentials

File-output evals often need format-specific tools in `benchmark.environment.dockerfile`. Install only what the run or grade phase actually needs. When in doubt, choose the recipe for the primary output type:

- Word documents: [file-recipes/docx.md](file-recipes/docx.md)
- Excel workbooks: [file-recipes/xlsx.md](file-recipes/xlsx.md)
- PDFs: [file-recipes/pdf.md](file-recipes/pdf.md)
- PowerPoint decks: [file-recipes/pptx.md](file-recipes/pptx.md)

For mixed outputs, use the dominant output recipe and add only the extra prerequisites required by the secondary format.
