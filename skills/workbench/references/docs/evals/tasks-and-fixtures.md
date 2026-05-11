# Tasks And Fixtures

Tasks are part of the Workbench project and are pushed to Workbench Cloud by `workbench push` when hosted execution is needed. They are frozen onto each run, but Workbench mounts only phase-specific projections into spawned runtimes. `task.yaml` is the task instruction and is never mounted as a file. Runner phases receive the task instruction and may see `/workspace/input/task/input` when the task has supporting public files. Grader phases receive the task instruction, optional public input, `/workspace/input/task/expected` when present, and runner output files.

## Recommended Layout

```text
tasks/
  task-001/
    task.yaml
    expected/
      golden.docx
      checks.json
      rubric.md
  task-002/
    task.yaml
    input/
      source.docx
    expected/
      text.txt
```

Use stable, descriptive task folder names when possible:

```text
tasks/
  monthly-board-deck/
  debt-schedule-workbook/
  redline-contract/
```

## What Belongs In Tasks

Task roots may contain only `task.yaml`, optional `input/`, and optional `expected/`.

`task.yaml` contains the task instruction. Do not duplicate that instruction into `input/request.md` unless a command runner specifically needs an ordinary file.

`input/` contains optional public files the candidate workflow may consume:

- source files supplied to the workflow
- small fixture data that is not an answer key

`expected/` contains optional grader-only files the candidate should not see:

- golden outputs
- extracted text or structural JSON
- scoring rubrics
- task-specific grader scripts for intentional command graders
- expected values and tolerances

Keep answer keys, extracted goldens, private rubrics, tolerances, and grading scripts out of `input/`. If a candidate can read the file and directly copy the target answer, the eval is measuring lookup behavior rather than task performance. Public inputs should be the same materials a real workflow would receive; private expected files should contain only what the grader needs.

Do not put mutable prompts, templates, or scripts in tasks when Workbench should improve them. Put those files under the candidate root instead.

Every smoke task should contain at least one non-empty expected file, such as `expected/text.txt`, `expected/rubric.md`, or `expected/checks.json`. Empty expected folders are placeholders only; they should not be treated as passing tasks.

Hosted benchmark publication uploads binary files as base64 automatically, so tasks may contain real `.docx`, `.xlsx`, `.pdf`, or `.pptx` files alongside text, JSON, or rubric files.

## Task Count

Start with one or two smoke tasks. Add broader task coverage after the runner is stable. A small task set that catches the most important failure modes is better than a large set that is slow, flaky, or hard to explain.
