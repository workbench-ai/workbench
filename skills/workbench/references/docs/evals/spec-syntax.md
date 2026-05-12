# Workbench YAML Syntax

Workbench source is split by responsibility:

- `benchmark.yaml` defines what is measured: environment, score adapter, benchmark-owned adapter sources, and optional task-source selection.
- Subject manifests define how to run the subject and explicitly point at their subject files.
- Native task packages define task text, public files, verifier tests, oracle material, and optional task-specific environment overrides for the built-in `path` task-source adapter.
- Optimizer YAML files are only required for improve runs: subject-relative edit paths and improve behavior.

`workbench check --dir <source-dir>` validates the combined source. `workbench eval subjects/foo` runs the named local subject. `workbench improve --optimizer optimizers/foo.yaml` improves the current subject and evaluates it first if needed. Use `--from SUBJECT_ID` only when improving an explicit historical subject snapshot.

## Minimal Shape

```yaml
# benchmark.yaml
version: 2
name: workflow-quality
description: Evaluate whether a workflow completes representative tasks with useful inspectable outputs.
environment:
  dockerfile: environment/Dockerfile
score:
  use: rubric
  with:
    instructions: Score the final workspace state and artifacts against the task.
    judge:
      use: codex
      with:
        model: gpt-5.4-mini
    criteria:
      - id: quality
        description: The result satisfies the task and is easy to inspect.
```

```yaml
# subjects/codex/subject.yaml
version: 2
name: workflow-skill
files:
  path: files
run:
  use: codex
  with:
    instructions: Use the staged subject files, task files, and writable workspace.
    model: gpt-5.4-mini
```

```yaml
# tasks/smoke/task.yaml
version: 2
task: Create a concise report at report.md.
files:
  path: files
tests:
  path: tests
```

```yaml
# optimizers/codex.yaml
version: 2
name: workflow-skill-optimizer
edits:
  - SKILL.md
improve:
  use: codex
  with:
    model: gpt-5.4-mini
```

## Required Fields

`benchmark.yaml` requires `version: 2`, `name`, `description`, `environment`, and `score`. `tasks` is optional; when omitted, Workbench uses the built-in task-source adapter `path` with `with.path: tasks`. Explicit task sources always use a `tasks` object with `use` and `with`, for example `tasks: { use: harbor, with: { path: ../terminal-bench-subset } }` or `tasks: { use: path, with: { path: tasks } }`. Every task source resolves to `TaskBundle` data through `tasks.resolve` before core plans trials.

A subject manifest requires `version: 2`, `name`, `files`, and `run`.

A task manifest requires `version: 2` and `task`. `files`, `tests`, and `solution` are optional explicit path objects.

An optimizer YAML file requires `version: 2`, `name`, `edits`, and `improve`. The improve command supplies the base subject, and that subject supplies the benchmark.

Adapter invocations always use the same shape:

```yaml
use: adapter-id
auth: optional-profile-or-slot-map
with:
  adapterOwnedSetting: value
```

The adapter position gives the purpose. Do not add role-specific wrapper fields.

## Paths

All authored paths are portable literals. They must not be absolute, empty, `.`/`..`, or globs.

- Omitted `benchmark.tasks` points at the default `tasks/` directory through the built-in `path` task-source adapter.
- Explicit task sources use a `benchmark.tasks` object with `use` and `with`; path-backed task packages use `tasks: { use: path, with: { path: tasks } }`.
- Use one subject directory per runnable subject choice, for example `subjects/claude/` and `subjects/codex/`.
- Subject files are mounted from the path declared by `files.path`, normally `files` next to `subject.yaml`.
- Task-source `with.path` values, adapter sources, subject `files.path`, task `files.path`, task `tests.path`, task `solution.path`, and `benchmark.environment.dockerfile` are relative to the YAML file that declares them.
- `optimizer.edits[]` entries are resolved inside the subject `files/` directory; edit `SKILL.md`, not `subjects/<name>/files/SKILL.md`.

## Tasks

For the built-in `path` task-source adapter, each native task case contains a root `task.yaml`, optional public `files/`, optional verifier-only `tests/`, optional oracle-only `solution/`, and optional task `environment`.

`task.yaml` is control-plane task text for native Workbench source and is not staged as a source file. The `path` adapter parses the native directory and emits a `TaskBundle`, which is the structured task record core receives: task id, task text, public files, verifier files, optional oracle files, and optional task environment defaults. Core runs trials over `TaskBundle` data and does not parse native task package directories directly.

Public task files from `files.path` are copied into the trial working directory before the subject runs. Verifier files from `tests.path` are injected at `/tests` only after the subject run, then the score adapter runs in the same mutated environment. Oracle material from `solution.path` is reserved for workflows that need reference answers and is not subject-visible.

## Harbor Task Sources

Harbor interop is adapter-shaped:

```yaml
tasks:
  use: harbor
  with:
    path: ../terminal-bench-subset
score:
  use: tests
```

Task-source adapters run before trials and emit structured `TaskBundle` data. The Harbor task-source adapter reads `instruction.md`, `task.toml`, `environment/`, `tests/`, and `solution/`, then emits equivalent Workbench task bundles. Workbench core still runs the generic trial lifecycle; it does not parse Harbor directories, native Workbench task directories, or call `harbor run`.

## Scoring

Score adapters return a finite numeric `score` as the `trial.score` result value. The built-in `tests` scorer may read Harbor-style reward files under `/logs/verifier` internally before publishing the standard adapter result. Duration and cost remain built-in operational metrics in the UI.

## External Adapters

Built-in adapters are available by id: `path` and `harbor` for `tasks.resolve`, `codex`, `claude`, and `pi` for `subject.run` and `subject.improve`, and `tests` and `rubric` for `trial.score`. Custom adapters can be listed in YAML under `adapters` and referenced by manifest id. Adapter sources can be benchmark-contained paths, `npm:` package specifiers, or `git:` URLs. Unversioned `npm:` sources resolve to npm's default tag, usually `latest`; exact npm versions use `npm:pkg@1.2.3`. `git:url` resolves the current default branch; `git:url#branch` can float with that branch; `git:url#<commit>` records an exact commit. A custom adapter whose manifest id matches a built-in intentionally overrides that built-in for the project. Workbench reports the authored source, resolved source, stability, operations, and overrides in `workbench check` and adapter inspection commands. See [adapters.md](adapters.md) for the manifest, auth, slots, task-source, and local replay contract.
