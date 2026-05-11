# Workbench YAML Syntax

Workbench source is split by responsibility:

- `benchmark.yaml` defines what is measured: tasks, environment, score adapter, and benchmark-owned adapter sources.
- Subject manifests define how to run the subject. Subject files are the sibling `files/` directory next to `subject.yaml`.
- Task packages define instructions, public files, verifier tests, and optional task-specific environment overrides.
- Optimizer YAML files are only required for improve runs: subject-relative edit paths and improve behavior.

`workbench check --dir <source-dir>` validates the combined source. `workbench eval subjects/foo` runs the named local subject. `workbench improve --optimizer optimizers/foo.yaml` improves the current subject and evaluates it first if needed. Use `--from SUBJECT_ID` only when improving an explicit historical subject snapshot.

## Minimal Shape

```yaml
# benchmark.yaml
version: 2
name: workflow-quality
description: Evaluate whether a workflow completes representative tasks with useful inspectable outputs.
tasks: tasks
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
run:
  use: codex
  with:
    instructions: Use the staged subject files, task files, and writable workspace.
    model: gpt-5.4-mini
```

```yaml
# tasks/smoke/task.yaml
task: Create a concise report at report.md.
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

`benchmark.yaml` requires `version: 2`, `name`, `description`, `tasks`, `environment`, and `score`.

A subject manifest requires `version: 2`, `name`, and `run`.

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

- `benchmark.tasks` can point to a task directory or to a task-source adapter invocation.
- Use one subject directory per runnable subject choice, for example `subjects/claude/` and `subjects/codex/`.
- Subject files are mounted from `subjects/<name>/files/`; this path is implied and is not authored in YAML.
- `benchmark.tasks`, adapter sources, and `benchmark.environment.dockerfile` are relative to the YAML file that declares them.
- `optimizer.edits[]` entries are resolved inside the subject `files/` directory; edit `SKILL.md`, not `subjects/<name>/files/SKILL.md`.

## Tasks

Each task case contains a root `task.yaml` or `instruction.md`, optional public `files/`, optional verifier-only `tests/`, optional oracle-only `solution/`, and optional task `environment`.

`task.yaml` is control-plane task text and is not staged as a source file. Public task `files/` are copied into the trial working directory before the subject runs. `tests/` is injected at `/tests` only after the subject run, then the score adapter runs in the same mutated environment.

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

The Harbor task-source adapter maps `instruction.md`, `task.toml`, `environment/`, `tests/`, and `solution/` into normalized Workbench tasks. Workbench core still runs the generic trial lifecycle; it does not call `harbor run`.

## Scoring

Score adapters emit a finite numeric `score`. The built-in `tests` scorer also accepts Harbor-style reward files under `/logs/verifier`. Duration and cost remain built-in operational metrics in the UI.

## External Adapters

Built-in adapters are available by id: `codex`, `claude`, `pi`, `command`, `rubric`, `tests`, and `harbor`. Custom adapters can be listed in YAML under `adapters` and referenced by manifest id. Adapter sources can be benchmark-contained paths, `npm:` package specifiers, or `git:` URLs. Unversioned `npm:` sources resolve to npm's default tag, usually `latest`; exact npm versions use `npm:pkg@1.2.3`. `git:url` resolves the current default branch; `git:url#branch` can float with that branch; `git:url#<commit>` records an exact commit. A custom adapter whose manifest id matches a built-in intentionally overrides that built-in for the project. Workbench reports the authored source, resolved source, stability, and overrides in `workbench check` and adapter inspection commands. See [adapters.md](adapters.md) for the manifest, auth, nested-ref, task-source, and local replay contract.
