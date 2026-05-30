# CLI

`workbench` treats a benchmark directory as one repo-like project. The authored source lives in the working tree, local run history lives under `.workbench/`, and Workbench Cloud is an optional remote that can store the same project source, runtime history, and hosted execution.

The public project model is intentionally small:

- engine: the benchmark runtime selected by `benchmark.yaml`; the built-in `workbench` engine owns native tasks, environment, scoring, and result normalization
- candidate: `candidates/<name>/candidate.yaml` plus optional files at `candidates/<name>/files/`; the manifest owns prepare, runnable variants, the default run, and optional improve settings
- remote: the Workbench Cloud project used by `clone`, `pull`, `push`, and hosted `--hosted` execution

## Public Demo Flow

Use this path for the public three-statement demo. The public benchmark can be cloned and validated without a Workbench Cloud account. Sign in only when you are ready to push your checkout and run hosted auto-improvement.

```bash
workbench clone official/three-statement-demo
cd three-statement-demo
workbench check
workbench login
workbench push
workbench improve --hosted candidates/current --budget 1 --samples 1 --watch
```

The cloned public demo uses `candidates/current` and `candidates/current/candidate.yaml`. If a local or hosted run reports missing adapter auth, run `workbench whoami --json` and connect the preferred provider, usually Codex.

## Provider Selection

When an agent creates a benchmark, first run `workbench whoami --json` and inspect `adapterStatuses` plus `hostedAuth.adapters`. Choose the adapter in this order:

1. A connected `codex` profile.
2. Any other connected provider that fits the requested workflow.
3. `codex` as the default, then connect it with `workbench auth connect codex --method oauth` unless the user requested API-key billing.

Use the selected adapter consistently in `workbench init --skill NAME --agent ADAPTER`, the candidate path `candidates/ADAPTER`, and the candidate manifest's `runs` and `improve` blocks.

## Development Flow

```bash
workbench whoami --json
workbench init --skill smoke --agent codex
workbench auth connect codex --method oauth
workbench check
workbench eval candidates/codex --samples 1
workbench improve --budget 1 --samples 1
workbench candidates list
workbench runs list
workbench open
```

Skip `workbench auth connect ...` when `workbench whoami --json` already reports the selected adapter profile as connected.

`workbench eval` ensures a candidate has an evaluation for the current benchmark. Omit `--runs` for the candidate's default run, pass a comma-separated list for specific runs, or pass `--runs all` to evaluate every run declared in the candidate manifest. Completed evaluations for the same candidate, run configuration, source, adapters, benchmark, and sample count are reused by default; pass `--rerun` only when you intentionally want another measurement.

`workbench improve` ensures an improved candidate exists for the selected base candidate, run, budget, and sample count. It uses the evaluated active candidate by default when that candidate belongs to the current benchmark fingerprint; otherwise it evaluates and uses the authored current candidate. Improvement is anchored to one selected run; use `--runs RUN` to override the default and `--from CANDIDATE_ID` only when improving a specific local historical candidate snapshot. Completed improvements for the same base candidate, run configuration, source, adapters, benchmark, budget, and sample count are reused by default; pass `--rerun` only when you intentionally want another improvement attempt.

Add `--hosted` to run the same lifecycle against the configured remote or an explicit `--benchmark OWNER/BENCHMARK`:

```bash
workbench login
workbench push
workbench eval --hosted candidates/codex --samples 1 --watch --json
workbench improve --hosted candidates/codex --base CANDIDATE_ID --budget 1 --samples 1 --watch
workbench open --hosted --json --no-open
```

For hosted eval, use `--candidate CANDIDATE_ID` when evaluating an existing hosted candidate. For hosted improve, use `--base CANDIDATE_ID` when choosing the candidate to improve.

Runtime candidates are versioned automatically. If the candidate manifest is named `Skill`, the initial snapshot is shown as `Skill v1`; each successful improvement produces the next version in that family. Candidate run configurations stay nested under the candidate version.

Once an active candidate exists, eval records scores without moving that active pointer. Improve output distinguishes the candidate produced by that improve run from the active incumbent. `outputCandidateId` is the new version created by the run. `activeCandidateId` is the current best evaluated candidate after scoring, so it can remain on an older version when a new version scores lower.

Use `workbench retry TARGET_ID` to retry a failed local run or evaluation. Use `workbench retry --hosted TARGET_ID` for hosted records. Retry requires an explicit id and replays the recorded candidate, candidate run configuration, sample count, and improve budget. Reissuing the same retry reuses completed repair work when it already exists.

When a watched or reused hosted run reaches a terminal state from a checkout linked to the same remote project, Workbench imports the hosted project state back into local if local authored source still matches the remembered base. Explicit `--benchmark` runs against a different project leave the current checkout untouched.

`workbench open` starts a local read-only web server. Keep the command running while the page is open. `workbench open --hosted` prints or opens the hosted project URL. The browser UI is for inspection only: it supports navigating, filtering, selecting, expanding, and reviewing candidates, evaluations, cases, traces, scorecards, and files. Execution actions such as eval, improve, retry, push, and pull stay in the CLI.

## Remote Flow

```bash
workbench clone official/three-statement-demo
workbench pull
workbench push
```

`workbench clone` copies one hosted project state into a local working tree and remembers that remote. The state contains authored source, durable runtime history, and the last seen source/runtime fingerprints.

`workbench pull` refuses to overwrite local authored source if it has changed since the last clone, pull, or push. When local source still matches the remembered base, pull replaces authored source with the hosted source, merges runtime history as immutable facts, and updates `.workbench/origin.json`.

`workbench push` creates or updates the hosted benchmark from local project state. If the hosted source changed since the remembered base, push fails and asks you to pull first. `workbench push --dry-run` for a linked checkout first verifies that the signed-in account can read the remembered remote. Runtime history is merged idempotently; equal candidate facts are kept even when local and hosted read-model fields such as timestamps, versions, status, usage, owner, or visibility differ. New ids are added, and same-id different candidate files or immutable fingerprints fail instead of choosing a winner. Project-state sync exchanges source, candidate files, evaluations, runs, jobs, events, and the explicit active pointer; execution output file payloads stay in the local archive or hosted artifact store where they were produced. A successful push imports the accepted runtime state back into local, including the active candidate pointer.

Hosted project reads used by clone, pull, push dry-runs, and post-watch sync retry transient read failures. Mutating requests are not retried automatically.

The active candidate is explicit runtime state. Sync never chooses a replacement from the latest or best evaluated candidate. If the explicit active candidate belongs to a different benchmark fingerprint than the current source, active is `null`; when source returns to a fingerprint with explicit run active facts, that active candidate is restored.

`.workbench/origin.json` has one exact shape: `baseUrl`, `remote`, `projectId`, `sourceRevisionId`, `sourceFingerprint`, `runtimeFingerprint`, and `linkedAt`. It is a remote pointer plus the last exchanged base, not a second project model.

Hosted benchmark names cannot contain `/`, `?`, `#`, `@`, or `\`, so remote references use only `OWNER/BENCHMARK`.

## Adapter Auth

`workbench login` authenticates the Workbench Cloud account. It does not connect the agent adapter that will run Codex, Claude Code, or another candidate.

Use OAuth when you want Workbench to reuse a local subscription sign-in:

```bash
workbench auth connect codex --method oauth
workbench auth connect claude --method oauth
```

File-based OAuth profiles are mutable runtime auth. Local runs serialize jobs that share the same OAuth profile, and hosted runs hold a per-profile lease while forwarding refreshed auth files back to Workbench Cloud before the next job can claim that profile.

If a provider reports that an OAuth refresh token can no longer be refreshed, hosted execution marks that adapter connection `reauth_required` and finishes the run instead of reusing stale credentials for the remaining jobs. Reconnect the adapter with `workbench auth connect ADAPTER --method oauth` before retrying hosted work.

Use API-key auth when you want provider API-key billing instead:

```bash
OPENAI_API_KEY=... workbench auth connect codex --method api-key --local-only
ANTHROPIC_API_KEY=... workbench auth connect claude --method api-key --local-only
```

For other adapters, inspect supported methods with `workbench adapters inspect ADAPTER`, then run `workbench auth connect ADAPTER --method METHOD`. `workbench whoami` reports Workbench Cloud login state and required adapter-auth state for the current benchmark.

## CLI Surface

```bash
workbench init [DIR] --skill NAME --agent ADAPTER [--from PATH] [--example] [--json]
workbench init [DIR] --command NAME [--from PATH] [--example] [--json]
workbench check [SOURCE] [--dir DIR] [--json]
workbench adapters create PATH [--dir DIR] [--json]
workbench adapters list [--dir DIR] [--json]
workbench adapters inspect ID [--dir DIR] [--json]
workbench adapters test ID|SOURCE [--dir DIR] [--request PATH] [--output DIR] [--json]
workbench eval [SOURCE] [--dir DIR] [--candidate CANDIDATE_ID] [--runs RUNS|all] [--samples N] [--rerun] [--json]
workbench eval --hosted [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK] [--candidate CANDIDATE_ID] [--runs RUNS|all] [--samples N] [--rerun] [--watch] [--dry-run] [--json]
workbench improve [SOURCE] [--dir DIR] [--from CANDIDATE_ID] [--runs RUN] [--budget N] [--samples N] [--rerun] [--json]
workbench improve --hosted [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK] [--base CANDIDATE_ID] [--runs RUN] [--budget N] [--samples N] [--rerun] [--watch] [--dry-run] [--json]
workbench retry TARGET_ID [--dir DIR] [--hosted] [--benchmark OWNER/BENCHMARK] [--watch] [--interval-ms N] [--timeout-ms N] [--json]
workbench open [SOURCE|OWNER/BENCHMARK|RUN_ID|CANDIDATE_ID] [--dir DIR] [--hosted] [--benchmark OWNER/BENCHMARK] [--run RUN_ID] [--host HOST] [--port N] [--no-open] [--json]
workbench restore [--dir DIR] [--candidate CANDIDATE_ID] [--dry-run] [--yes] [--json]
workbench runs list [--dir DIR] [--json]
workbench runs show RUN_ID [--dir DIR] [--json]
workbench candidates list [--dir DIR] [--json]
workbench candidates show CANDIDATE_ID [--dir DIR] [--json]
workbench candidates files [--dir DIR] [--candidate CANDIDATE_ID] [--json]
workbench candidates preview --path PATH [--dir DIR] [--candidate CANDIDATE_ID] [--output PATH|-] [--json]
workbench traces collect [--providers codex,claude] [--since 30d] [--workspace DIR] [--limit N] [--json]
workbench traces list [--providers codex,claude] [--since 30d] [--workspace DIR] [--limit N] [--json]
workbench traces show TRACE_ID [--providers codex,claude] [--since 30d] [--workspace DIR] [--json]
workbench login [--base-url URL] [--no-open] [--json]
workbench logout [--json]
workbench whoami [--dir DIR] [--json]
workbench clone OWNER/BENCHMARK [DIR] [--dry-run] [--json]
workbench pull [--dir DIR] [--dry-run] [--json]
workbench push [SOURCE] [--dir DIR] [--visibility public|private] [--dry-run] [--json]
workbench auth connect ADAPTER[/SLOT] [--dir DIR] [--method METHOD] [--profile PROFILE] [--profile-root DIR] [--local-only] [--json]
workbench auth disconnect ADAPTER[/SLOT] [--profile PROFILE] [--local-only] [--json]
```

The `workbench traces` commands are read-only and stateless against installed agent homes. They currently inspect Codex and Claude Code local sessions. `workbench traces list` and `workbench traces collect` default to the latest three traces per provider and report when more matching traces exist than the requested per-provider limit. Use `workbench traces list` to choose trace ids, `workbench traces show TRACE_ID --json` to print one full standardized digest by exact id, and `workbench traces collect --json` when a caller needs the full batch payload. JSON outputs for list and collect include `limitPerProvider` and `limitedProviders` when relevant.

## Source Shape

This is the native Workbench source shape for the built-in `workbench` engine. Omitted `engine.with.tasks` makes the engine read `tasks/`; use `engine.with.tasks.path` only when the native task directory is not `tasks/`. Top-level `environment`, `tasks`, and `score` are not core source primitives.

```text
benchmark.yaml
candidates/
  codex/
    candidate.yaml
    files/
      SKILL.md
tasks/
  task-001/
    task.yaml
    files/
    tests/
environment/
  Dockerfile
```

`candidate.yaml` does not declare a benchmark. The project benchmark is `benchmark.yaml`, and candidate files are declared explicitly with `files: { path: files }`.

`benchmark.yaml` selects the engine:

```yaml
version: 4
name: invoice-review
description: Evaluate invoice review candidates.
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

At runtime, attempt jobs expose candidate source files at `/workspace/input/candidate`, public case files at `/workspace/input/case`, a mutable working directory at `/workspace`, verifier-private files under `/workspace/private/engine` only for engine-owned scoring operations, and durable results, artifacts, and traces under `/workspace/output`. Use candidate `prepare.command` when an attempt needs files copied into `/workspace`. Improve jobs instead start with candidate files in the mutable working directory and expose planner-selected prior attempt evidence under `/workspace/input/traces`. Adapter commands must discover operation-specific locations from `WORKBENCH_ADAPTER_REQUEST`; candidate adapters receive `paths.case` but not `paths.enginePrivate`.

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

The Harbor engine adapter should stay a thin bridge to Harbor. Harbor `task.toml` and the Harbor runtime own task parsing, MCP server config, health checks, environment interpretation, candidate invocation, artifact handoff, verifier/reward behavior, and same-sandbox versus separate-sandbox verifier topology. Workbench core does not parse Harbor directories or embed Harbor-specific runtime behavior. The adapter calls Harbor inspect/export and run APIs, exposes Workbench runtime-control as a sandbox provider when Harbor asks for sandboxes, and normalizes Harbor's final result for Workbench.
