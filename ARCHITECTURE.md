# Workbench Architecture

`SPEC.md` defines the user-facing source and command contract. This document defines the open Workbench package boundary. Workbench Cloud lives in `products/workbench-cloud`; it consumes the same contracts for hosted execution, remotes, registry views, and read-only inspection.

## Repository Shape

- `packages/cli`: the published `workbench` command, output formatting, command dispatch, and CLI tests.
- `packages/core`: the local skill runtime. It owns initialization, validation, automatic source versions, skill bundle snapshots, eval snapshots, agent records, runs, traces, artifacts, lineage, repo-local object storage, Workbench remote sync, and read-only inspection snapshots.
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
- Workbench Cloud provides hosted execution, remote object sync, team registry views, source publication, and hosted inspection over the same primitives.

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
.workbench/queue/
.workbench/tmp/
.workbench/logs/
```

Core reads source files from the project root and authored `.workbench` compatibility files while excluding runtime object directories, `.git`, `node_modules`, and build output. Source versions are created automatically at command boundaries. `eval` records evidence for a version, eval hash, measured skill bundle, and agent; workflow-specific cases produce scores, while generated smoke cases stay unscored. `improve` reads failed or reviewed historical traces, writes an improved primary skill version, records lineage, reruns it, and switches only when the proof run beats the incumbent.

Agents are eval runtime configurations. `local` and `command` agents compare Docker-style command behavior across performance, readiness, and latency. `codex` and `claude` agents run provider-backed skill execution through adapter auth and score the same cases through the configured score adapter. Cost remains unavailable unless adapter usage data is propagated.

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
.workbench/objects/trace/<id>.json
.workbench/objects/artifact/<id>.json
.workbench/objects/lineage/<parent>-<child>.json
.workbench/refs/current
```

`.workbench/remotes.yaml` is tracked source and contains only remote URLs. Secrets live in CLI auth config or adapter auth stores, never in the project folder.

`workbench sync` exchanges `workbench.object-pack.v1` objects and refs with a Workbench remote. File remotes are the deterministic local transport. HTTP remotes are Workbench Cloud skill endpoints. Sync never invokes Git and never mutates the working tree.

`workbench publish` marks a selected version as published in refs, syncs, and asks the remote to expose installable source for that version. For file remotes, this writes `source/` and `releases/<version>/`; for Workbench Cloud, the hosted skill becomes the source provider.

## Shared Read Interface

CLI object commands, `workbench open --json`, local browser UI, and hosted browser UI all use `WorkbenchInspectionSnapshot`: status, skill sources, skill bundles, agents, versions, runs, jobs, traces, artifacts, lineage, remotes, and refs. Add new read data to that snapshot first, then render it in CLI and UI.

## Invariants

- `workbench --help`, `docs/cli.md`, `SPEC.md`, tests, and the authored `workbench` skill describe the same command surface.
- Raw local Workbench state does not require Git.
- Workbench never writes Git branches, Git tags, Git refs, commits, or remotes.
- Versions, runs, traces, artifacts, refs, and lineage are preserved when syncing.
- Installable source contains skill files plus authored Workbench compatibility files, not runtime object directories.
- Web Workbench is read-only; mutations stay in the CLI and API.
- Public packages are publishable without proprietary hosted infrastructure.
