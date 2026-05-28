# Tasks And Fixtures

Tasks are part of the Workbench project and are pushed to Workbench Cloud by `workbench push` when hosted execution is needed. They are frozen onto each run. For the built-in `workbench` engine, public files are staged under `/workspace/input/case` before the candidate runs, verifier files are staged under `/workspace/private/engine` only for scoring, and candidate adapters never receive `paths.enginePrivate`. The default shared grading mode scores the runner-mutated child sandbox; `engine.with.grading.isolation: separate` scores a second child sandbox seeded with runner workspace/output artifacts.

Native Workbench task directories are source input for the built-in `workbench` engine. The engine owns native task parsing. For native task packages, omit `engine.with.tasks` to use the default `tasks/` directory. Use explicit `engine.with.tasks.path` only when the native task directory is not the default.

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

Native task roots parsed by the built-in `workbench` engine may contain:

- `task.yaml` for versioned task text and explicit file paths
- `files/` for public case files staged at `/workspace/input/case`
- `tests/` for verifier-private files exposed only while the engine scores the final workspace
- `solution/` for oracle or reference material imported from external task sets
- `environment/` or task environment metadata when a task needs a runtime override

Minimal task manifests include `version: 3` and `task`. Add explicit path objects for any sibling material the task owns:

```yaml
version: 3
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

Keep answer keys, extracted goldens, private rubrics, tolerances, and scoring scripts out of `files/`. If a candidate can read the file and directly copy the target answer, the eval is measuring lookup behavior rather than task performance.

Do not put mutable prompts, templates, or scripts in tasks when Workbench should improve them. Put those files under the candidate root instead; candidates can copy or install them into `/workspace` with `prepare.command`. Do not depend on case files appearing in the workspace root.

Every smoke task should contain verifier material that lets the engine produce a numeric result. Empty `tests/` folders are placeholders only; they should not be treated as passing tasks.

Hosted benchmark publication uploads binary files as base64 automatically, so tasks may contain real `.docx`, `.xlsx`, `.pdf`, or `.pptx` files alongside text, JSON, or verifier scripts.

## Harbor Layout

The external Harbor engine adapter accepts Harbor task directories with:

```text
instruction.md
task.toml
environment/
tests/
solution/
```

The `harbor` engine adapter is only the Workbench bridge. Harbor itself parses this source and owns how Harbor tasks become attempts, including candidate invocation, artifact handoff, verifier/reward behavior, health checks, MCP server config, and same-sandbox versus separate-sandbox verification from `task.toml`. Harbor `instruction.md` supplies the task text, `tests/` remains verifier-private, and `solution/` is preserved for oracle workflows but is not part of the normal public case input. The adapter should call Harbor inspect/export and run APIs, expose Workbench runtime-control as a sandbox provider when Harbor asks for sandboxes, and normalize the final Harbor result; core does not infer criteria from metrics or parse Harbor directories directly.

## Task Count

Start with one or two smoke tasks. Add broader task coverage after the candidate runner and scoring helper are stable. A small task set that catches the most important failure modes is better than a large set that is slow, flaky, or hard to explain.
