# CLI

`workbench` is local-first. Normal commands run, inspect, improve, and serve the local project. Workbench Cloud is an optional remote layer for cloning, pushing, pulling, hosted execution, and stars.

The public project model is intentionally small:

- engine: the benchmark runtime selected by `benchmark.yaml`; the built-in `workbench` engine owns native tasks, environment, scoring, and result normalization
- subject: `subjects/<name>/subject.yaml` plus optional files at `subjects/<name>/files/`
- optimizer: optional `optimizers/<name>.yaml` improve configuration
- remote: Workbench Cloud origin used by `clone`, `fetch`, `pull`, and `push`

## Public Demo Flow

Use this path for the public three-statement demo. The public benchmark can be cloned and validated without a Workbench Cloud account. Sign in only when you are ready to push your local checkout and run hosted auto-improvement.

```bash
workbench clone official/three-statement-demo
cd three-statement-demo
workbench check
workbench login
workbench push
workbench cloud improve subjects/current --optimizer optimizers/current.yaml --budget 1 --samples 1 --watch
```

The cloned public demo uses `subjects/current` and `optimizers/current.yaml`. If a local or hosted run reports missing adapter auth, run `workbench whoami --json` and connect the preferred provider, usually Codex. When a checkout came from a public benchmark, `workbench push` creates a writable hosted benchmark under the signed-in user and keeps the original benchmark as upstream metadata in `.workbench/origin.json`. If the signed-in user owns the public origin, `workbench push` updates that benchmark instead.

## Provider Selection

When an agent creates a benchmark, first run `workbench whoami --json` and inspect `adapterStatuses` plus `hostedAuth.adapters`. Choose the adapter in this order:

1. A connected `codex` profile.
2. Any other connected provider that fits the requested workflow.
3. `codex` as the default, then connect it with `workbench auth connect codex --method oauth` unless the user requested API-key billing.

Use the selected adapter consistently in `workbench init --skill NAME --agent ADAPTER`, the subject path `subjects/ADAPTER`, and optimizer path `optimizers/ADAPTER.yaml`.

## Local Development Flow

```bash
workbench whoami --json
workbench init --skill smoke --agent codex
workbench auth connect codex --method oauth
workbench check
workbench eval subjects/codex --samples 1
workbench improve --budget 1 --samples 1
workbench subjects list
workbench runs list
workbench open
```

Skip `workbench auth connect ...` when `workbench whoami --json` already reports the selected adapter profile as connected.

`workbench eval` evaluates a subject against the current benchmark. `workbench improve` uses the current subject by default, evaluates it first if needed, then asks the optimizer to patch subject files. Use `--from SUBJECT_ID` only when improving a specific historical subject snapshot.

`workbench open` starts a local read-only web server. Keep the command running while the page is open.

## Cloud Deployment Flow

```bash
workbench login
workbench whoami --json
workbench push --tag v1
workbench cloud eval subjects/codex --samples 1 --watch --json
workbench cloud open --json --no-open
```

`workbench push` creates or updates a hosted benchmark version and writes `.workbench/origin.json`. Run it after `workbench check`; use a bounded local smoke eval first when local adapter auth and sandbox execution are already configured. Hosted commands return URLs in JSON output; open those URLs when an embedded browser is available.

## Remote Sync And Collaboration

```bash
workbench clone official/three-statement-demo
workbench fetch
workbench pull
workbench cloud star official/three-statement-demo
```

`workbench fetch` downloads remote source into `.workbench/fetch` without changing project files. `workbench pull` updates managed project files from the origin. `workbench push` creates a writable hosted benchmark when the current origin is a read-only public clone, updates the read-only origin when the signed-in user owns it, and updates the hosted benchmark after that. `workbench remote remove origin --json` is idempotent and reports `removed: true` only when an origin file existed.

## Adapter Auth

`workbench login` authenticates the Workbench Cloud account. It does not connect the agent adapter that will run Codex, Claude Code, or another subject.

Use OAuth when you want Workbench to reuse a local subscription sign-in:

```bash
workbench auth connect codex --method oauth
workbench auth connect claude --method oauth
```

Use API-key auth when you want provider API-key billing instead:

```bash
OPENAI_API_KEY=... workbench auth connect codex --method api-key --local-only
ANTHROPIC_API_KEY=... workbench auth connect claude --method api-key --local-only
```

For other adapters, inspect supported methods with `workbench adapters inspect ADAPTER`, then run `workbench auth connect ADAPTER --method METHOD`. `workbench whoami` reports Workbench Cloud login state and required adapter-auth state for the current benchmark.

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

Hosted dry-runs are local planning operations. For example, `workbench cloud eval --dry-run` and `workbench cloud benchmarks delete --dry-run` print the request or deletion plan from the supplied benchmark ref or local origin without starting a run or deleting remote state.

## CLI Surface

```bash
workbench init [DIR] --skill NAME --agent ADAPTER [--from PATH] [--example] [--json]
workbench init [DIR] --command NAME [--from PATH] [--example] [--json]
workbench check [SOURCE] [--dir DIR] [--json]
workbench adapters create PATH [--dir DIR] [--json]
workbench adapters list [--dir DIR] [--json]
workbench adapters inspect ID [--dir DIR] [--json]
workbench adapters test ID|SOURCE [--dir DIR] [--request PATH] [--output DIR] [--json]
workbench eval [SOURCE] [--dir DIR] [--subject ID] [--samples N] [--json]
workbench improve [SOURCE] [--dir DIR] [--from SUBJECT_ID] [--optimizer OPTIMIZER_YAML] [--budget N] [--samples N] [--json]
workbench open [SOURCE] [--dir DIR] [--run RUN_ID] [--host HOST] [--port N] [--no-open] [--json]
workbench restore [--dir DIR] [--subject ID] [--dry-run] [--yes] [--json]
workbench runs list [--dir DIR] [--json]
workbench runs show RUN_ID [--dir DIR] [--json]
workbench subjects list [--dir DIR] [--json]
workbench subjects show SUBJECT_ID [--dir DIR] [--json]
workbench subjects files [--dir DIR] [--subject ID] [--json]
workbench subjects preview --path PATH [--dir DIR] [--subject ID] [--output PATH|-] [--json]
workbench traces collect [--providers codex,claude] [--since 30d] [--workspace DIR] [--limit N] [--json]
workbench traces list [--providers codex,claude] [--since 30d] [--workspace DIR] [--limit N] [--json]
workbench traces show TRACE_ID [--providers codex,claude] [--since 30d] [--workspace DIR] [--json]
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

The `workbench traces` commands are read-only and stateless against installed agent homes. They currently inspect Codex and Claude Code local sessions. `workbench traces list` and `workbench traces collect` default to the latest three traces per provider and report when more matching traces exist than the requested per-provider limit. Use `workbench traces list` to choose trace ids, `workbench traces show TRACE_ID --json` to print one full standardized digest by exact id, and `workbench traces collect --json` when a caller needs the full batch payload. JSON outputs for list and collect include `limitPerProvider` and `limitedProviders` when relevant.

## Source Shape

This is the native Workbench source shape for the built-in `workbench` engine. Omitted `engine.with.tasks` makes the engine read `tasks/`; use `engine.with.tasks.path` only when the native task directory is not `tasks/`. Top-level `environment`, `tasks`, and `score` are not core source primitives.

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

`benchmark.yaml` selects the engine:

```yaml
version: 3
name: invoice-review
description: Evaluate invoice review subjects.
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
        instructions: Score the final workspace against the task.
        parallelism: 2
```

`engine.with.environment.network.egress` accepts `open` or `none`; omitted `network` defaults to `open`. Use `egress: none` for benchmarks that must prevent internet access. Workbench does not expose per-host allowlists because sandbox providers do not enforce them consistently.

Adapter sources can be benchmark-contained paths, `npm:` package specifiers, or `git:` refs. Unversioned npm and branch-like git refs float; exact npm versions and git commits are pinned by the adapter resolver. The CLI's default adapter catalog includes `workbench`, `codex`, `claude`, and `command`; score helpers such as `tests` and `rubric` are selected through the `workbench` engine's `score` slot. Rubric scoring runs one judge turn per criterion and uses `score.with.parallelism` as its only configurable throttle. Each judge trace is recorded as a trace session under the parent attempt job instead of creating core grader jobs. A declared source whose manifest id matches a default catalog id overrides that default for the project. Use `workbench adapters test` to validate a manifest, or add `--request` to replay an adapter operation locally against a `workbench.adapter.v3` fixture.

At runtime, the built-in `workbench` engine exposes subject source files at `/workspace/input/subject`, public case files at `/workspace/input/case`, a mutable working directory at `/workspace`, verifier-private files under `/workspace/private/engine` only for engine-owned scoring operations, and durable results, artifacts, and traces under `/workspace/output`. Use subject `prepare.command` when a subject needs files copied into `/workspace`. Adapter commands must discover operation-specific locations from `WORKBENCH_ADAPTER_REQUEST`; subject adapters receive `paths.case` but not `paths.enginePrivate`.

## Harbor Engine

Harbor interop is engine-adapter based:

```yaml
adapters:
  - npm:@acme/workbench-harbor-engine@1.0.0
engine:
  use: harbor
  with:
    path: terminal-bench-subset
```

The Harbor engine adapter should stay a thin bridge to Harbor. Harbor `task.toml` and the Harbor runtime own task parsing, MCP server config, health checks, environment interpretation, subject invocation, artifact handoff, verifier/reward behavior, and same-sandbox versus separate-sandbox verifier topology. Workbench core does not parse Harbor directories or embed Harbor-specific runtime behavior. The adapter calls Harbor inspect/export and run APIs, exposes Workbench runtime-control as a sandbox provider when Harbor asks for sandboxes, and normalizes Harbor's final result for Workbench.
