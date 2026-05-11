# Workbench YAML Syntax

Workbench source is split by responsibility:

- `benchmark.yaml` defines what is measured: tasks, environment, and grading.
- Candidate manifests define how to run the candidate. Candidate files are the sibling `files/` directory next to `candidate.yaml`.
- Optimizer YAML files are only required for improve runs: candidate-relative edit paths and improve behavior.

`workbench check --dir <source-dir>` validates the combined source. `workbench eval candidates/foo` runs the named local candidate. `workbench improve --optimizer optimizers/foo.yaml` improves the current candidate and evaluates it first if needed. Use `--from cand_123` only when improving an explicit historical candidate.

## Minimal Shape

```yaml
# benchmark.yaml
version: 1
name: workflow-quality
description: Evaluate whether a workflow skill completes representative tasks with useful inspectable outputs.
tasks: tasks
environment:
  dockerfile: environment/Dockerfile
grade:
  use: rubric
  with:
    instructions: Grade from public task input, expected files, and runner output files.
    judge:
      use: codex
      with:
        model: gpt-5.4-mini
    criteria:
      - id: quality
        description: The result satisfies the task and is easy to inspect.
```

```yaml
# candidates/codex/candidate.yaml
version: 1
name: workflow-skill
run:
  use: codex
  with:
    instructions: Use /workspace/input/candidate, the task input, and /workspace/output.
    model: gpt-5.4-mini
```

```yaml
# optimizers/codex.yaml
version: 1
name: workflow-skill-optimizer
edits:
  - SKILL.md
improve:
  use: codex
  with:
    model: gpt-5.4-mini
```

## Required Fields

`benchmark.yaml` requires `version: 1`, `name`, `description`, `tasks`, `environment`, and `grade`.

A candidate manifest requires `version: 1`, `name`, and `run`.

An optimizer YAML file requires `version: 1`, `name`, `edits`, and `improve`. The improve command supplies the base candidate, and that candidate supplies the benchmark.

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

- `benchmark.tasks` points to a directory whose direct children are task cases.
- Use one candidate directory per runnable candidate/runner combination, for example `candidates/claude/` and `candidates/codex/`.
- Candidate files are mounted from `candidates/<name>/files/`; this path is implied and is not authored in YAML.
- `benchmark.tasks`, adapter sources, and `benchmark.environment.dockerfile` are relative to the YAML file that declares them.
- `optimizer.edits[]` entries are resolved inside the candidate `files/` directory; edit `SKILL.md`, not `candidates/<name>/files/SKILL.md`.

## Tasks

Each task case contains a root `task.yaml`, optional public `input/`, and optional grader-only `expected/`.

`task.yaml` is control-plane task text and is not mounted as a runtime file. Runners see public `input/`; graders see `input/`, `expected/`, and persisted runner output files.

## Scoring

Graders emit a finite numeric `score`. Duration and cost remain built-in operational metrics in the UI.

## External Adapters

Built-in adapters are available by id: `codex`, `claude`, `pi`, `command`, and `rubric`. Custom adapters can be listed in any of the three YAML files under `adapters` and referenced by manifest id. Adapter sources can be benchmark-contained paths, `npm:` package specifiers, or `git:` URLs. Unversioned `npm:` sources resolve to npm's default tag, usually `latest`; exact npm versions use `npm:pkg@1.2.3`. `git:url` resolves the current default branch; `git:url#branch` can float with that branch; `git:url#<commit>` records an exact commit. A custom adapter whose manifest id matches a built-in intentionally overrides that built-in for the project. Workbench reports the authored source, resolved source, stability, and overrides in `workbench check` and adapter inspection commands. See [adapters.md](adapters.md) for the manifest, auth, nested-ref, and local replay contract.
