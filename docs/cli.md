# CLI

`workbench` is local-first. Normal commands run, inspect, improve, and serve the local project. Workbench Cloud is an optional remote layer for cloning, pushing, pulling, hosted execution, stars, and forks.

The public project model is intentionally small:

- benchmark: `benchmark.yaml`, optional task-source adapter selection, environment, score adapter, and benchmark-owned adapter sources
- task bundle: structured task data emitted by a `tasks.resolve` adapter operation before core plans trials
- subject: `subjects/<name>/subject.yaml` plus optional files at `subjects/<name>/files/`
- trial: one subject attempt on one task in one mutable environment
- scorecard: normalized score, metrics, feedback, traces, and artifacts for a trial
- optimizer: optional `optimizers/<name>.yaml` improve configuration
- remote: Workbench Cloud origin used by `clone`, `fetch`, `pull`, and `push`

## Local Flow

```bash
workbench init --command smoke
workbench check
workbench eval subjects/command --samples 1
workbench improve --budget 1 --samples 1
workbench subjects list
workbench runs list
workbench open
```

`workbench eval` evaluates a subject against the current benchmark. `workbench improve` uses the current subject by default, evaluates it first if needed, then asks the optimizer to patch subject files. Use `--from SUBJECT_ID` only when improving a specific historical subject snapshot.

`workbench open` starts a local read-only web server. Keep the command running while the page is open.

## Remote Flow

```bash
workbench login
workbench push --tag v1
workbench clone alice/invoice-review
workbench fetch
workbench pull
workbench cloud fork alice/invoice-review invoice-review-fork
workbench cloud star alice/invoice-review
```

`workbench push` creates or updates a hosted benchmark version and writes `.workbench/origin.json`. `workbench fetch` downloads remote source into `.workbench/fetch` without changing project files. `workbench pull` updates managed project files from the origin.

## Hosted Execution

```bash
workbench cloud eval subjects/codex --benchmark alice/invoice-review@v1 --samples 1 --watch
workbench cloud improve subjects/codex --base SUBJECT_ID --optimizer optimizers/codex.yaml --budget 1 --samples 1 --watch
workbench cloud open SUBJECT_ID --no-open --json
workbench cloud runs show run_123 --json
workbench cloud runs cancel run_123
workbench cloud subjects publish SUBJECT_ID
```

Treat hosted resource ids as opaque subject ids.

Hosted watch commands are client-side polling only. Stopping the client does not cancel the hosted run; use `workbench cloud runs cancel RUN_ID`.

## CLI Surface

```bash
workbench init [DIR] --skill NAME --agent ADAPTER [--from PATH] [--example] [--json]
workbench init [DIR] --pipeline NAME --agent ADAPTER [--from PATH] [--example] [--json]
workbench init [DIR] --command NAME [--from PATH] [--example] [--json]
workbench check [SOURCE] [--dir DIR] [--json]
workbench adapters create PATH [--dir DIR] [--json]
workbench adapters list [--dir DIR] [--json]
workbench adapters inspect ID [--dir DIR] [--json]
workbench adapters test ID|SOURCE [--dir DIR] [--request PATH] [--output DIR] [--json]
workbench eval [SOURCE] [--dir DIR] [--subject ID] [--samples N] [--json]
workbench improve [SOURCE] [--dir DIR] [--from SUBJECT_ID] [--optimizer OPTIMIZER_YAML] [--budget N] [--samples N] [--json]
workbench open [SOURCE] [--dir DIR] [--host HOST] [--port N] [--no-open] [--json]
workbench checkpoint [--dir DIR] [--json]
workbench restore [--dir DIR] [--subject ID] [--dry-run] [--yes] [--json]
workbench runs list [--dir DIR] [--json]
workbench runs show RUN_ID [--dir DIR] [--json]
workbench subjects list [--dir DIR] [--json]
workbench subjects show SUBJECT_ID [--dir DIR] [--json]
workbench subjects files [--dir DIR] [--subject ID] [--json]
workbench subjects preview --path PATH [--dir DIR] [--subject ID] [--output PATH|-] [--json]
workbench login [--base-url URL] [--no-open] [--json]
workbench logout [--json]
workbench whoami [--dir DIR] [--json]
workbench clone OWNER/BENCHMARK[@REF] [DIR] [--dry-run] [--json]
workbench remote show [--dir DIR] [--json]
workbench remote add origin OWNER/BENCHMARK[@REF] [--dir DIR] [--json]
workbench remote set-url origin OWNER/BENCHMARK[@REF] [--dir DIR] [--json]
workbench remote remove origin [--dir DIR] [--json]
workbench fetch [--dir DIR] [--json]
workbench pull [--dir DIR] [--dry-run] [--json]
workbench push [SOURCE] [--dir DIR] [--tag TAG] [--visibility public|private] [--dry-run] [--json]
workbench cloud fork OWNER/BENCHMARK[@REF] [NAME] [--json]
workbench cloud star OWNER/BENCHMARK [--json]
workbench cloud unstar OWNER/BENCHMARK [--json]
workbench cloud eval [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--base SUBJECT_ID] [--samples N] [--watch] [--dry-run] [--json]
workbench cloud improve [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--base SUBJECT_ID] [--optimizer OPTIMIZER_YAML] [--budget N] [--samples N] [--watch] [--dry-run] [--json]
workbench cloud open [OWNER/BENCHMARK[@REF]|RUN_ID|SUBJECT_ID] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--no-open] [--json]
workbench cloud watch RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--interval-ms N] [--timeout-ms N] [--json]
workbench cloud logs RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]
workbench cloud benchmarks|runs|subjects <command> [options]
workbench auth connect ADAPTER[/SLOT] [--dir DIR] [--method METHOD] [--profile PROFILE] [--profile-root DIR] [--local-only] [--json]
workbench auth disconnect ADAPTER[/SLOT] [--profile PROFILE] [--local-only] [--json]
```

## Source Shape

This is the native Workbench task source shape parsed by the built-in `path` task-source adapter. Omitted `benchmark.tasks` selects that adapter with `with.path: tasks`.

```text
benchmark.yaml
subjects/
  codex/
    subject.yaml
    files/
      SKILL.md
optimizers/
  codex.yaml
tasks/
  task-001/
    task.yaml
    files/
    tests/
environment/
  Dockerfile
```

`subject.yaml` does not declare a benchmark. The project benchmark is `benchmark.yaml`, and subject files are declared explicitly with `files: { path: files }`.

Adapter sources can be benchmark-contained paths, `npm:` package specifiers, or `git:` refs. Unversioned npm and branch-like git refs float; exact npm versions and git commits are pinned by the adapter resolver. A declared source whose manifest id matches a built-in id overrides that built-in for the project. Use `workbench adapters test` to validate a manifest, or add `--request` to replay an adapter operation locally against a `workbench.adapter.v2` fixture.

## Harbor Tasks

Harbor interop is adapter-based:

```yaml
tasks:
  use: harbor
  with:
    path: ../terminal-bench-subset
score:
  use: tests
```

The Harbor task-source adapter resolves Harbor task directories into structured `TaskBundle` data through `tasks.resolve`. Core runs trials over those bundles and does not parse Harbor directories or native Workbench task directories directly. The `tests` scorer runs verifier scripts in the same mutated environment after the subject run and publishes a `trial.score` adapter result. It may read Harbor reward outputs at `/logs/verifier/reward.json` or `/logs/verifier/reward.txt` internally.
