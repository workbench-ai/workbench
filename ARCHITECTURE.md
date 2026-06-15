# Workbench Architecture

`SPEC.md` defines the user-facing source and command contract. This document defines the open Workbench package boundary. Workbench Cloud lives in `products/workbench-cloud`; it consumes the same contracts for hosted execution, remotes, registry views, and read-only inspection.

## Repository Shape

- `packages/cli`: the published `workbench` command, output formatting, command dispatch, and CLI tests.
- `packages/core`: the local skill runtime. It owns initialization, validation, automatic source versions, skill bundle snapshots, eval snapshots, agent records, runs, trace-progress events, terminal traces, artifacts, lineage, repo-local object storage, Workbench remote sync, and read-only inspection snapshots.
- `packages/contract`: serializable DTOs shared by CLI, core, protocol, Cloud, and UI.
- `packages/protocol`: the adapter request/result and manifest protocol for provider execution, skill improvement, engine scoring, and adapter auth metadata.
- `packages/built-in-adapters`: executable adapter shims and first-party manifest records.
- `packages/workbench-ui`: read-only browser inspection over the shared snapshot.
- `skills/workbench/`: canonical authored agent skill source.
- `docs/`: canonical public CLI and eval-authoring docs.
- `plans/`: product plan history indexed by `plans/index.md`.

The public source repository intentionally has no root `SKILL.md`. The installable skill stays nested at `skills/workbench/SKILL.md`.

## Ownership Boundaries

- The CLI owns all write actions and must stay automation-friendly: stable JSON with `--json`, explicit flags, useful non-zero failures, and no hidden prompts.
- Core owns durable local semantics and must work outside Git repositories.
- Protocol owns adapter request/result DTOs. Adapter authors should not need UI or Cloud code.
- Built-in adapters are ordinary adapter shims. Core must not special-case default adapter ids.
- The UI is presentation-only and must not introduce separate write actions.
- Workbench Cloud provides hosted execution, remote object sync, registry views, source publication, and hosted inspection over the same primitives.

## Core Runtime Model

Raw local state lives inside a skill directory:

```text
SKILL.md
.workbench/eval.yaml
.workbench/cases/*/case.yaml
.workbench/agents.yaml
.workbench/skills.yaml
.workbench/remotes.yaml
.workbench/.gitignore
.workbench/objects/
.workbench/refs/
.workbench/sync/
.workbench/tmp/
.workbench/logs/
.workbench/locks/
```

Core reads source files from the project root and authored `.workbench` source files while excluding runtime object directories, `.git`, `node_modules`, and build output. Source versions are created automatically at command boundaries. `eval` records evidence for a version, eval hash, measured skill bundle, and agent; every authored case with a valid public result file records its score. Historical smoke-labeled cases are metadata, not a separate scoring path. `improve` reads failed or reviewed historical traces, writes an improved primary skill version, records lineage, reruns it, and switches only when the proof run beats the incumbent.

Agents are eval runtime configurations. `local` and `command` agents compare Docker-style command behavior across performance, readiness, and latency. `codex` and `claude` agents run provider-backed skill execution through adapter auth. Core owns the skill-eval lifecycle: it runs the selected skill/agent, then invokes the configured score adapter against the completed workspace and private case files. Built-in and external adapters own only their primitive operation, such as `skill.run`, `skill.improve`, `engine.resolve`, or `engine.run`; they do not orchestrate first-party skill evals by running another selected agent. Cost is recorded when the runner or scorer adapter returns usage.

## Object Storage And Remotes

The object database is append-oriented and repo-local:

```text
.workbench/objects/version/<id>.json
.workbench/objects/skill-source/<name>.json
.workbench/objects/skill-bundle/<hash>.json
.workbench/objects/eval/<hash>.json
.workbench/objects/agent/<hash>.json
.workbench/objects/run/<id>.json
.workbench/objects/job/<id>.json
.workbench/objects/execution-event/<id>.json
.workbench/objects/trace/<id>.json
.workbench/objects/artifact/<id>.json
.workbench/objects/lineage/<parent>-<child>.json
.workbench/refs/current
```

`.workbench/remotes.yaml` is local Workbench metadata and contains only schema-tagged remote URLs plus their Workbench remote kind. It behaves like git remote configuration: it is persisted in the project folder, ignored by the generated `.workbench/.gitignore`, and is not a versioned skill source file. Secrets live in CLI auth config or adapter auth stores, never in the project folder.

Local commands serialize project mutations through `.workbench/locks/project.lock`. State commits write object and ref snapshots into `.workbench/tmp/` first, then swap them into place with recoverable backups. This prevents concurrent commands from deleting newer evidence and prevents interrupted writes from exposing half-written object state.

Long-running local eval and improve commands persist a `running` run plus planned `queued` jobs before sandbox execution starts, then update job objects as they start and finish. Provider-backed adapters publish trace delta batches through the adapter progress target; local runtime writes those batches as `execution-event` objects and Workbench Cloud appends the same batch shape through the hosted progress endpoint. CLI progress wording is a separate projection over normalized runs, jobs, and orchestration phase, so Codex, Claude, command, local, and future adapters provide facts rather than user-facing progress semantics. The local browser server reads committed object state without taking the project lock and retries transient atomic-swap races instead of running recovery. Recovery remains owned by locked command paths.

`workbench sync` exchanges `workbench.object-pack.v1` objects and refs with a Workbench remote. File remotes are deterministic sync-only local transports and must use `file:///absolute/path`; HTTP remotes are Workbench Cloud skill endpoints and must use canonical `/skills/OWNER/SKILL` URLs. Each sync attempt records `.workbench/sync/<remote>.json` so status can report last success, last error, local object changes since the last success, Workbench Cloud publication state, and repair commands. Successful cloud sync records local-only remote-tracking publication refs under `.workbench/refs/remotes/<remote>/`, but strips those refs before writing to a remote. Sync never invokes Git and never mutates the working tree.

`workbench publish` marks a selected version as published in Workbench Cloud refs, syncs, and asks Workbench Cloud to expose installable source for that version. File remotes reject publish because they are object-pack sync endpoints, not source hosts. For Workbench Cloud, every visibility returns the canonical `/skills/<owner>/<skill>` URL and pinned `/skills/<owner>/<skill>/releases/<version>` URL. Public URLs are backed by `skills` CLI-compatible well-known discovery. Internal and private URLs use the same address through `workbench install OWNER/SKILL|URL`, which attaches Workbench auth and copies the agent skill package into detected or explicit Codex and Claude skill roots. Editable Workbench source is acquired separately with `workbench new DIR --from OWNER/SKILL|URL`.

## Shared Read Interface

CLI object commands, the local browser UI, and the hosted browser UI all use `WorkbenchInspectionSnapshot`: status, skill sources, skill bundles, eval snapshots, agents, versions, runs, jobs, trace-progress events, traces, artifacts, lineage, remotes, and refs. Eval snapshots carry case count, scorer type, first-observed `createdAt`, and source-observed `updatedAt`; selector labels, default selection, and `Latest` all use `createdAt` order. Execution-event batches carry live trace deltas and are converted into transient trace sessions until terminal trace files exist. Core owns the shared `WorkbenchProjectState` to `WorkbenchInspectionSnapshot` projection; local and hosted surfaces add only storage-boundary concerns such as file manifests and publication URLs. Add new read data to that snapshot first, then render it in CLI and UI.

## Invariants

- `workbench --help`, `docs/cli.md`, `SPEC.md`, tests, and the authored `workbench` skill describe the same command surface.
- Raw local Workbench state does not require Git.
- Workbench never writes Git branches, Git tags, Git refs, commits, or remotes.
- Versions, runs, trace-progress events, traces, artifacts, refs, and lineage are preserved when syncing.
- Installable source contains skill files plus authored Workbench source files, not runtime object directories.
- Web Workbench is read-only; mutations stay in the CLI and API.
- Public packages are publishable without proprietary hosted infrastructure.
