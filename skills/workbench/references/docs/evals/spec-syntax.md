# Workbench YAML Syntax

Workbench source is split by responsibility:

- `benchmark.yaml` defines what is measured by selecting an engine. The engine owns benchmark runtime behavior and measurement.
- Subject manifests define how to run the subject and explicitly point at their subject files.
- Native task packages define task text, public files, verifier tests, oracle material, and optional task-specific environment overrides for the built-in `workbench` engine.
- Optimizer YAML files are only required for improve runs: subject-relative edit paths and improve behavior.

`workbench check --dir <source-dir>` validates the combined source. `workbench eval subjects/foo` runs the named local subject. `workbench improve --optimizer optimizers/foo.yaml` improves the current subject and evaluates it first if needed. Use `--from SUBJECT_ID` only when improving an explicit historical subject snapshot.

## Minimal Shape

```yaml
# benchmark.yaml
version: 3
name: workflow-quality
description: Evaluate whether a workflow completes representative tasks with useful inspectable outputs.
engine:
  use: workbench
  with:
    environment:
      dockerfile: environment/Dockerfile
      network:
        egress: none
    score:
      use: rubric
      with:
        instructions: Score the final workspace state and artifacts against the task.
        parallelism: 2
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
version: 3
name: workflow-skill
files:
  path: files
prepare:
  command: sh input/subject/prepare.sh
run:
  use: codex
  with:
    model: gpt-5.4-mini
```

```yaml
# tasks/smoke/task.yaml
version: 3
task: Create a concise report at report.md.
files:
  path: files
tests:
  path: tests
```

```yaml
# optimizers/codex.yaml
version: 3
name: workflow-skill-optimizer
edits:
  - SKILL.md
improve:
  use: codex
  with:
    model: gpt-5.4-mini
```

## Required Fields

`benchmark.yaml` requires `version: 3`, `name`, `description`, and `engine`. Native Workbench evals use `engine: { use: workbench, with: ... }`; that engine config requires `environment` and `score`. `engine.with.tasks` is optional for the built-in `workbench` engine; when omitted, it reads the default `tasks/` directory. Use `engine.with.tasks.path` only when the native task directory is not the default. Harbor evals declare an external Harbor engine adapter source under `adapters` and use benchmark-contained paths such as `engine: { use: harbor, with: { path: terminal-bench-subset } }`; if an engine reads data outside the benchmark tree, its `engine.resolve` adapter must emit the resolved files needed by Cloud. Top-level `environment`, `tasks`, and `score` from older source shapes are not part of the target contract.

`engine.with.environment.network.egress` accepts only `open` or `none`. Omitted `network` defaults to `open`; use `none` to disable sandbox egress for contamination-sensitive benchmarks. Workbench does not support per-host allowlists, and `egress: none` may also block model/API clients used by the subject.

A subject manifest requires `version: 3`, `name`, `files`, and `run`. It may include `prepare.command` when the subject needs to copy or install its source files into the mutable workspace before running or improving. Prepare is a generic shell command from `/workspace`, not an adapter operation.

A task manifest requires `version: 3` and `task`. `files`, `tests`, and `solution` are optional explicit path objects.

An optimizer YAML file requires `version: 3`, `name`, `edits`, and `improve`. The improve command supplies the base subject, and that subject supplies the benchmark.

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

- Omitted `engine.with.tasks` points the built-in `workbench` engine at the default `tasks/` directory.
- Native task packages use `engine.with.tasks.path` when the task directory is not the default.
- Use one subject directory per runnable subject choice, for example `subjects/codex/` or `subjects/command/`.
- Subject files from `files.path`, normally `files` next to `subject.yaml`, are staged at `/workspace/input/subject`. Core does not copy them into `/workspace`; use `prepare.command` for any mutable working-copy setup.
- Engine `with` paths, adapter sources, subject `files.path`, task `files.path`, task `tests.path`, task `solution.path`, and `engine.with.environment.dockerfile` are relative to the YAML file that declares them.
- `optimizer.edits[]` entries are resolved inside the subject `files/` directory; edit `SKILL.md`, not `subjects/<name>/files/SKILL.md`.

## Tasks

For the built-in `workbench` engine, each native task case contains a root `task.yaml`, optional public `files/`, optional verifier-only `tests/`, optional oracle-only `solution/`, and optional task `environment`.

`task.yaml` is control-plane task text for native Workbench source and is not staged as a source file. The built-in `workbench` engine owns native task parsing and turns the directory into its internal task records.

Public task files from `files.path` are staged at `/workspace/input/case` before the subject runs. Verifier files from `tests.path` are staged at `/workspace/private/engine` and exposed only to engine-owned scoring after the subject run. By default the scoring helper runs in the same child sandbox after the subject; with `engine.with.grading.isolation: separate`, it runs in a second child sandbox seeded with runner workspace/output artifacts. Oracle material from `solution.path` is reserved for workflows that need reference answers and is not part of the public case input.

## Harbor Engine

Harbor interop is engine-shaped:

```yaml
adapters:
  - npm:@acme/workbench-harbor-engine@1.0.0
engine:
  use: harbor
  with:
    path: terminal-bench-subset
```

The Harbor engine adapter should be a thin bridge to Harbor. Harbor `task.toml` and the Harbor runtime read `instruction.md`, `environment/`, `tests/`, MCP server config, health checks, `solution/`, artifact handoff, subject invocation, verifier/reward behavior, and same-sandbox versus separate-sandbox verifier topology. Workbench core does not parse Harbor directories or call `harbor run` directly. The adapter calls Harbor inspect/export and run APIs, exposes Workbench runtime-control as a sandbox provider when Harbor asks for sandboxes, and returns normalized Workbench evaluation data.

## Scoring

For the built-in `workbench` engine, `engine.with.score` selects engine-owned scoring. The `rubric` helper supports qualitative scoring and the `tests` helper supports deterministic verifier scripts or existing scoring workflows. Rubric scoring fans out to one judge agent turn per configured criterion; each turn scores only that criterion, and the helper combines the criterion scores into one finite numeric `score`. `score.with.parallelism` is the rubric helper's only configurable concurrency throttle and limits how many criterion judge turns run at once. Criterion judging remains an engine implementation detail; Workbench records the judge agent trace files and scorecard/result files under the parent attempt job's generic trace/artifact bundle. Duration and cost remain built-in operational metrics in the UI.

## External Adapters

The CLI default adapter catalog includes `workbench` for the native engine and `codex`, `claude`, and `command` for subject, optimizer, or command-backed engine behavior. The built-in `workbench` engine owns native task loading and may use scoring helper ids named `tests` and `rubric` inside `engine.with.score`; those helper ids are adapter-protocol helpers scoped to the score slot, not extra top-level authoring primitives. Harbor is an external engine adapter selected with `engine.use: harbor` after its adapter source is declared. Custom adapters can be listed in YAML under `adapters` and referenced by manifest id. Adapter sources can be benchmark-contained paths, `npm:` package specifiers, or `git:` URLs. Unversioned `npm:` sources resolve to npm's default tag, usually `latest`; exact npm versions use `npm:pkg@1.2.3`. `git:url` resolves the current default branch; `git:url#branch` can float with that branch; `git:url#<commit>` records an exact commit. A custom adapter whose manifest id matches a default catalog adapter id overrides that default for the project; a custom adapter whose manifest id matches a Workbench-engine scoring helper id is used only where that helper is selected inside `engine.with.score`. Workbench reports the authored source, resolved source, stability, operations, and overrides in `workbench check` and adapter inspection commands. See [adapters.md](adapters.md) for the manifest, auth, slots, engine-owned helpers, and local replay contract.
