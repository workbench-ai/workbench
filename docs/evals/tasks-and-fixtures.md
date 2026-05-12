# Tasks And Fixtures

Tasks are part of the Workbench project and are pushed to Workbench Cloud by `workbench push` when hosted execution is needed. They are frozen onto each run, but Workbench stages them with a simple trial rule: public files are copied into the subject's working directory before the subject runs, verifier files are injected only after that run, and the scorer then sees the same mutated environment.

Native Workbench task directories are source input for the built-in `path` task-source adapter. The adapter parses those directories and emits `TaskBundle` data, which is the structured task representation core uses for trials. Core does not parse native task package directories directly. For native task packages, omit `benchmark.tasks`; Workbench defaults to the built-in `path` task-source adapter reading `tasks/`. Use an explicit `tasks: { use: path, with: { path: ... } }` invocation only when the native task directory is not the default `tasks/`.

## Recommended Layout

```text
tasks/
  task-001/
    task.yaml
    files/
      source.docx
    tests/
      test.sh
      golden.txt
  task-002/
    task.yaml
    tests/
      test.sh
```

Use stable, descriptive task folder names when possible:

```text
tasks/
  monthly-board-deck/
  debt-schedule-workbook/
  redline-contract/
```

## What Belongs In Tasks

Native task roots parsed by the `path` adapter may contain:

- `task.yaml` for versioned task text and explicit file paths
- `files/` for public seed files copied into the trial workspace
- `tests/` for verifier-only files injected at `/tests`
- `solution/` for oracle or reference material imported from external task sets
- `environment/` or task environment metadata when a task needs a runtime override

Minimal task manifests include `version: 2` and `task`. Add explicit path objects for any sibling material the task owns:

```yaml
version: 2
task: Create the requested output file.
files:
  path: files
tests:
  path: tests
solution:
  path: solution
```

`files/` contains the materials a real workflow would receive: source documents, public data, starter files, or fixtures that are not answer keys.

`tests/` contains hidden scoring material:

- verifier scripts such as `test.sh` or `run.sh`
- golden outputs
- extracted text or structural JSON
- scoring rubrics
- expected values and tolerances

Keep answer keys, extracted goldens, private rubrics, tolerances, and scoring scripts out of `files/`. If a subject can read the file and directly copy the target answer, the eval is measuring lookup behavior rather than task performance.

Do not put mutable prompts, templates, or scripts in tasks when Workbench should improve them. Put those files under the subject root instead.

Every smoke task should contain a verifier that produces a scorecard or Harbor-style reward file. Empty `tests/` folders are placeholders only; they should not be treated as passing tasks.

Hosted benchmark publication uploads binary files as base64 automatically, so tasks may contain real `.docx`, `.xlsx`, `.pdf`, or `.pptx` files alongside text, JSON, or verifier scripts.

## Harbor Layout

The built-in Harbor task-source adapter accepts Harbor task directories with:

```text
instruction.md
task.toml
environment/
tests/
solution/
```

The `harbor` adapter parses this source and emits equivalent `TaskBundle` data. Harbor `instruction.md` supplies the task text, `tests/` remains verifier-only and is copied to `/tests` after the subject run, and `solution/` is preserved for oracle workflows but is not part of the normal subject-visible workspace. Core does not parse Harbor directories directly.

## Task Count

Start with one or two smoke tasks. Add broader task coverage after the subject runner and scorer are stable. A small task set that catches the most important failure modes is better than a large set that is slow, flaky, or hard to explain.
