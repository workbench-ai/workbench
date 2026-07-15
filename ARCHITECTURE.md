# Workbench Architecture

`docs/public/spec.md` defines the user-facing source and command contract. This document defines the open Workbench package boundary. Workbench Cloud lives in `products/workbench-cloud`; it consumes the same contracts for hosted execution, remotes, registry views, inspection, and web operations.

## Repository Shape

- `packages/cli`: the published `workbench` command, output formatting, command dispatch, and CLI tests.
- `packages/core`: the local Skill runtime. It owns initialization, validation, automatic package versions, Skill bundle snapshots, Eval snapshots, agent records, runs, trace-progress events, terminal traces, artifacts, lineage, repo-local object storage, Workbench remote sync, inspection snapshots, action capabilities, and local operation helpers.
- `packages/contract`: serializable DTOs shared by CLI, core, protocol, Cloud, and UI.
- `packages/protocol`: the adapter request/result and manifest protocol for provider execution, skill improvement, engine grading, and adapter auth metadata.
- `packages/built-in-adapters`: executable adapter shims and first-party manifest records.
- `packages/workbench-ui`: browser inspection and capability-driven action controls over the shared snapshot envelope.
- `skills/workbench/`: canonical authored agent skill source.
- `docs/public/`: canonical public docs for overview, quickstart, CLI, Sources, Evals, spec, and Skills.
- `plans/`: product plan history indexed by `plans/index.md`.

The public source repository intentionally has no root `SKILL.md`. The installable skill stays nested at `skills/workbench/SKILL.md`.

## Ownership Boundaries

- The CLI owns all write actions and must stay automation-friendly: stable JSON with `--json`, explicit flags, useful non-zero failures, and no hidden prompts.
- Core owns durable local semantics and must work outside Git repositories.
- Protocol owns adapter request/result DTOs. Adapter authors should not need UI or Cloud code.
- Built-in adapters are ordinary adapter shims. Core must not special-case default adapter ids.
- The UI is presentation-only and must not introduce separate write actions.
- Workbench Cloud provides hosted execution, remote object sync, registry views, source publication, and hosted inspection over the same primitives.

## Source Ingestion Boundary

Sources and Eval execution telemetry are separate systems. A Source is a deployment-owned evidence corpus and is never a child of a Skill, a `WorkbenchProjectState` member, or an object-pack object. The shared contract exposes one strict, versioned ingest envelope made from generic records, bounded semantic segments, and optional generic presentation blocks. It contains no adapter, provider, session, message, channel, span, task, or outcome fields.

Adapters live outside Source core. They own native discovery, credentials, cursors, native record boundaries, redaction, and conversion into the neutral envelope. The initial local Codex and Claude adapter reuses the streaming `AgentTrace` reducers from `@workbench-ai/agent-driver`, but `AgentTrace` is an input implementation detail rather than the Source schema. A future Slack or email adapter can choose different native boundaries without changing Source contracts, analysis, storage, or UI.

Sync is model-free. The CLI retains only its Source/deployment binding, adapter-owned cursor, and at most one resumable server sync id; it does not persist a normalized corpus, per-record remote hash map, or pending-record journal. Workbench Cloud verifies bounded content-addressed pages, publishes an immutable authoritative snapshot, and keeps evidence self-contained so citations remain readable after an adapter or native origin disappears. Model-backed analysis is a later explicit, cost-authorized action over an exact snapshot.

Source semantics are model-authored and source-neutral. Deterministic runtime code owns paging, content identity, exact citation verification, bounds, accounting, and publication; the LLM owns task changes, workflow grouping, taxonomy labels, and insights. No embedding participates in candidate retrieval, reconciliation, clustering, identity, or review. The optional Map may embed only final occurrence summaries, persist two-dimensional coordinates, and discard its vectors. Provider output-limit completion is an explicit metered result: extraction may repack the same whole persisted segments, while non-repackable semantic and Eval-draft stages fail closed rather than accept a partial payload.

Execution traces under project `.workbench/traces/`, normalized harness activity, spans, usage, and terminal Eval evidence remain the independent run observability model. Harness adapters may also return a neutral `AgentTrace`; Workbench stores its runner, judge, or improver relationship only as Eval evidence and never admits it to a Source automatically.

## Core Runtime Model

Raw local state lives inside a skill directory:

```text
SKILL.md
.workbench/eval.yaml
.workbench/cases/*/case.yaml
.workbench/agents.yaml
.workbench/versions.yaml
.workbench/remotes.yaml
.workbench/.gitignore
.workbench/objects/
.workbench/refs/
.workbench/sync/
.workbench/tmp/
.workbench/logs/
.workbench/locks/
```

Core reads source files from the project root and authored `.workbench` source files while excluding runtime object directories, `.git`, `node_modules`, and build output. Internal project snapshots and user-facing skill versions are created automatically at command boundaries. `eval` records evidence for a skill version, evaluation, measured skill bundle, and agent; every authored case with a valid public result file records its score. Historical smoke-labeled cases are metadata, not a separate scoring path. `improve` reads failed or reviewed historical traces, writes an improved `current` skill version, records lineage, reruns it, and switches only when the proof run beats the incumbent.

Agents are eval runtime configurations. `local` and `command` agents compare Docker-style command behavior across quality, readiness, latency, and cost. `codex` and `claude` agents run provider-backed skill execution through adapter auth. Core owns the skill-eval lifecycle: it runs the selected skill/agent, then invokes the configured grade adapter against the completed workspace, case files, traces, and output artifacts. Built-in and external adapters own only their primitive operation, such as `skill.run`, `skill.improve`, `engine.resolve`, or `grade.run`; they do not orchestrate first-party skill evals by running another selected agent. Cost is recorded when the runner or grader adapter returns usage.

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
.workbench/objects/artifact/<id>.json
.workbench/objects/lineage/<parent>-<child>.json
.workbench/traces/<id>/trace.json
.workbench/traces/<id>/events.ndjson
.workbench/traces/<id>/raw.ndjson
.workbench/refs/current
```

`.workbench/remotes.yaml` is local Workbench metadata and contains only schema-tagged remote URLs plus their Workbench remote kind. It behaves like git remote configuration: it is persisted in the project folder, ignored by the generated `.workbench/.gitignore`, and is not a versioned skill source file. Secrets live in CLI auth config or adapter auth stores, never in the project folder.

Local commands serialize project mutations through `.workbench/locks/project.lock`. State commits write object and ref snapshots into `.workbench/tmp/` first, then swap them into place with recoverable backups. This prevents concurrent commands from deleting newer evidence and prevents interrupted writes from exposing half-written object state. Local browser live-delivery state is an ignored cursor marker under `.workbench/live/`; it is not source, object-pack, remote, publication, or installable state.

Before Workbench Cloud accepts a hosted operation, the CLI stores only `.workbench/live/pending-cloud-operations/<id>.json` plus an optional cancellation request. Pending operations are not `WorkbenchRun` objects, never appear in inspection or object packs, and are cleared when Cloud accepts or preflight terminates. Once accepted, the ordinary durable Cloud run is the only lifecycle record used by watch, cancel, retry, and inspection.

Long-running local eval and improve commands persist a `running` run plus planned `queued` jobs before sandbox execution starts, then update job objects as they start and finish. Provider-backed adapters publish trace delta batches through the adapter progress target; local runtime writes those batches as `execution-event` objects and Workbench Cloud appends the same batch shape through the hosted progress endpoint. CLI progress wording is a separate projection over normalized runs, jobs, and orchestration phase, so Codex, Claude, command, local, and future adapters provide facts rather than user-facing progress semantics. The local browser server reads committed object state without taking the project lock and retries transient atomic-swap races instead of running recovery. Recovery remains owned by locked command paths.

`workbench skill sync` exchanges `workbench.object-pack.v1` objects and refs with a Workbench remote. File remotes are deterministic sync-only local transports and must use `file:///absolute/path`; HTTP remotes are Workbench Cloud skill endpoints and must use canonical `/skills/OWNER/SKILL` URLs. Each sync attempt records `.workbench/sync/<remote>.json` so status can report last success, last error, local source or object changes since the last success, Workbench Cloud publication state, and repair commands. Successful cloud sync records local-only remote-tracking publication refs under `.workbench/refs/remotes/<remote>/`, but strips those refs before writing to a remote. Current object packs require the unified executable job shape; stale runtime schemas are rejected rather than translated. Sync never invokes Git and never mutates the working tree.

`workbench skill publish` records a selected version under `publication/versions/VERSION`, moves `publication/current-version`, syncs, and asks Workbench Cloud to expose the installable package for that version. File remotes reject publish because they are object-pack sync endpoints, not package hosts. Workbench Cloud publication metadata is handle-first: every visibility records the canonical `OWNER/SKILL` install handle, while `/skills/<owner>/<skill>` and `/skills/<owner>/<skill>/versions/<version>` are exact package URLs behind that handle and accepted URL inputs. Public packages are backed by `skills` CLI-compatible well-known discovery. Plausible Workbench handles use the owner/name route through `workbench skill install OWNER/SKILL[@VERSION]|URL`, which checks Workbench Cloud first, attaches Workbench auth on success, and copies the Agent Skill package into detected or explicit Codex and Claude Skill roots with Workbench provenance. Explicit external sources, unauthenticated checks, missing Workbench packages, and unavailable checks fall back through the pinned upstream `skills add` CLI; those installs are ordinary external Agent Skills and do not create Workbench versions, Eval evidence, improve lineage, or cloneable Workbench projects. An editable Workbench Skill is acquired separately with `workbench skill clone OWNER/SKILL[@VERSION]|URL DIR`. `workbench skill unpublish VERSION` removes a prior exact package version from the published set; deleting a Cloud Skill project is a separate operation.

## Shared Read Interface

CLI object commands, the local browser UI, and the hosted browser UI all use `WorkbenchInspectionSnapshot`: status, Skill package inputs, Skill bundles, Eval snapshots, agents, versions, results, runs, jobs, trace-progress events, traces, artifacts, lineage, remotes, and refs. Browser and hosted wait surfaces receive it inside `WorkbenchInspectionSnapshotEnvelope`, whose cursor is delivery metadata outside `WorkbenchProjectState` and `WorkbenchObjectPack`, and whose required `actions` field describes the host's Eval, improve, and acquisition capabilities for that exact snapshot. Hosted Skill pages may boot from a compact snapshot index that preserves identity, status, refs, action capabilities, and file manifests while omitting historical evidence; evidence routes then request the full snapshot through the same contract. Selected hosted file reads are exact detail reads: the client names one owner object and path, and the host returns that file without hydrating the whole project aggregate. Live routes emit `WorkbenchStateNotice` invalidations only; clients refetch the snapshot on `changed` or `reset`, treat `progress` as focused trace evidence freshness, and ignore `heartbeat` except to keep the wait cursor current. Web identity is handle-first when publication or host context supplies `OWNER/SKILL`; package frontmatter remains package metadata and a fallback for unpublished local views. Package-file defaults are selected from the explicit URL version, project current ref, publication current ref, then newest version, so full-access and package-only hosted views stay aligned. User-facing web timestamps are formatted in the viewer's browser locale and timezone. Eval snapshots carry case count, grade adapter, first-observed `createdAt`, file-observed `updatedAt`, and typed authored case snapshots derived from `.workbench/cases/**`; selector labels, default selection, and `Latest` all use `createdAt` order. Results snapshots expose the public `Version`, `Evaluation`, `Agent`, and `Run` axes; project snapshots remain internal storage evidence and are not a user-facing scorecard axis. Execution-event batches carry live trace deltas and are converted into transient trace sessions until terminal trace files exist. Core owns the shared `WorkbenchProjectState` to `WorkbenchInspectionSnapshot` and action-capability projection; local and hosted surfaces add only storage-boundary concerns such as file manifests, publication URLs, cursor delivery, focused file-detail storage, and the local/cloud operation endpoint implementation. Eval-like mutations use one operation contract with case IDs, targets, and steps; authored Eval and case policy selects the grader. The browser keeps authored controls under Evals and Cases, and durable evidence under Results. Add new read data to the snapshot first, add new web actions to the capability contract first, then render them in CLI and UI.

## Invariants

- `workbench --help`, `docs/public/cli.md`, `docs/public/spec.md`, tests, and the authored `workbench` skill describe the same command surface.
- Raw local Workbench state does not require Git.
- Workbench never writes Git branches, Git tags, Git refs, commits, or remotes.
- Versions, runs, trace-progress events, traces, artifacts, refs, and lineage are preserved when syncing.
- A published install package contains Skill files plus authored Workbench controls, not runtime object directories.
- Web Workbench mutations use the shared operation contract; local and hosted variants may differ below the host boundary, but the shared UI must render from `WorkbenchActionCapabilities` rather than hardcoded command strings.
- Public packages are publishable without proprietary hosted infrastructure.
