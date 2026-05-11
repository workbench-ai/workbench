# Workbench Architecture

`SPEC.md` defines the user-facing source and command contract. This document defines the open Workbench package boundary. Hosted control-plane implementation belongs to `products/workbench-cloud`.

## Repository Shape

Workbench is the open, local-first product surface:

- `packages/cli`: the published `workbench` command, command registry, local project commands, Workbench Cloud client commands, API client, config handling, output formatting, and CLI tests.
- `packages/protocol`: the public adapter protocol. It owns adapter manifests, adapter request parsing, adapter result metadata, and auth-requirement discovery for `workbench.adapter.v1`.
- `packages/contract`: serializable DTOs shared by the CLI, Workbench Cloud API, reusable UI, and execution helpers.
- `packages/core`: the public execution core. It owns split YAML validation, source resolution, benchmark fingerprints, candidate file snapshots, execution graph planning, Docker-backed local execution, sandbox capability validation, phase staging, candidate/evaluation materialization, runs, lineage, file previews, and trace DTO helpers.
- `packages/core/worker/sandbox-adapter-runner.cjs`: the small public runner copied into local Docker sandboxes. It validates scoped execution capability input and calls the core adapter runtime.
- `packages/built-in-adapters`: first-party adapter manifests and commands for `codex`, `claude`, `pi`, `command`, and `rubric`.
- `packages/workbench-ui`: the browser Workbench UX used by local `workbench open` and Workbench Cloud.
- `environments/`: Dockerfiles for built-in local execution images.
- `skills/workbench/`: canonical authored agent skill source.
- `docs/`: canonical public CLI and eval-authoring docs rendered by Workbench Cloud.
- `plans/`: product plan history indexed by `plans/index.md`.

`products/workbench-cloud/packages/cloud-runtime` is intentionally outside this product. It owns hosted worker entrypoints, Firecracker, Daytona, E2B, remote runtime overlays, environment builders, queue workers, and production sandbox-host behavior.

The `packages/cli` package owns the `workbench` binary implementation, command registry, output formatting, and command tests. It is not the documentation or skill ownership boundary. Product docs and skills stay at the Workbench product root so the same source describes the local engine, public adapter protocol, browser UI, and optional Workbench Cloud client commands without making those concepts look CLI-owned.

## Ownership Boundaries

- The CLI owns local project lifecycle commands and the open Cloud client surface: `login`, `clone`, `fetch`, `pull`, `push`, and `workbench cloud ...`.
- The protocol package owns the stable adapter contract. Adapter authors should not need to import Web or cloud-runtime code.
- The core package owns portable Workbench semantics and local Docker execution. It must not depend on Next.js, AWS SDKs, Stripe, Cognito, Daytona, E2B, Firecracker implementation code, Terraform, or hosted worker entrypoints.
- Built-in adapters are normal adapter packages. Core can execute adapters, but it does not special-case built-in adapter ids. A project-declared adapter source with a built-in id intentionally overrides that built-in for the project; wrapping is implemented by that replacement adapter delegating however it chooses.
- Workbench Cloud owns hosted persistence, billing, auth, Web routes, production infrastructure, queue workers, remote provider admission, and hosted sandbox providers.
- Shared UI stays presentation-only. It renders benchmark, candidate, run, result, lineage, file, and trace DTOs without owning execution rules.

This is a git/GitHub-style split: `workbench` is the open client and local engine; Workbench Cloud is an optional hosted service implemented by cloud-owned private packages.

## Public Source Repository

The public repository `workbench-ai/workbench` is generated from the open Workbench boundary. It contains the Workbench packages, the shared `cli-web-ui` source package needed by `packages/workbench-ui`, the first-party harness packages required by built-in agent adapters, docs, environments, and the installable skill at `skills/workbench/SKILL.md`.

The public source repository intentionally has no root `SKILL.md`. The upstream `skills` installer treats a root `SKILL.md` as the skill root, which would copy the entire source tree into `.agents/skills/workbench`. Keeping the skill nested preserves the install UX `npx skills add workbench-ai/workbench` while installing only the skill directory.

The source export is maintained by the root command `pnpm workbench:public-source:validate` and published with `pnpm workbench:public-source:publish`. `pnpm skills:public:publish` must not publish or force-push `workbench-ai/workbench`; source-backed public repositories publish through their product-specific source export wrappers.

## Core Execution Model

Runnable source uses version-1 split YAML:

- `benchmark.yaml` owns tasks, environment, adapters, and grading.
- `candidates/<name>/candidate.yaml` owns how to run one candidate.
- `candidates/<name>/files/` is the candidate file tree mounted at `/workspace/input/candidate`.
- `optimizers/<name>.yaml` owns candidate-relative edit paths and improve behavior.

The benchmark fingerprint is the comparability boundary. Candidates from different benchmark fingerprints are not compared as peers.

Core compiles eval and improve requests into generic execution phases:

- `improve` can read candidate files and ancestor traces, then write `/workspace/output/candidate_patch.json`.
- `run-task` can read candidate files and task input files, then write runner outputs under `/workspace/output`.
- `grade-task` can read task expected files plus runner outputs, then write `/workspace/output/scorecard.json`.

Local execution uses the public Docker sandbox backend in `packages/core/src/sandbox-backends/docker.ts`. The same sandbox-plane interface validates input scope, output scope, allocation metadata, handles, and execution capabilities before any adapter command runs. Remote provider implementations are private cloud-runtime code that wrap the public core execution function with hosted provider factories.

## Stores

Local project state lives under `.workbench/` inside the project:

- `.workbench/runtime` stores local runs, candidates, evaluations, traces, and file snapshots.
- `.workbench/origin.json` stores the configured Workbench Cloud origin.
- `.workbench/fetch` stores downloaded remote source before `pull` updates managed files.

Workbench Cloud stores hosted state separately. Production storage, queueing, billing, and sandbox-host state are not part of the public Workbench package boundary.

## Invariants

- Public packages are publishable without proprietary hosted infrastructure.
- Public package manifests must not depend on AWS SDKs, Next.js, NextAuth, Stripe, Daytona, E2B, or cloud-owned runtime packages.
- `workbench --help`, `docs/cli.md`, `SPEC.md`, tests, and the authored `workbench` skill must describe the same command surface.
- The CLI must work outside git repositories.
- The CLI must remain automation-friendly: stable JSON with `--json`, explicit flags, useful non-zero failures, and no hidden interactive prompts.
- Adapter commands receive the standard `WORKBENCH_ADAPTER_REQUEST` file and staged filesystem paths. They do not receive source YAML files, job claim tokens, worker tokens, queue credentials, hosted billing state, or sandbox control request internals.
- `workbench.adapter.v1` is additive within the protocol version: request fields may be added, but required phase output filenames and manifest meaning require a new protocol string if they need a breaking change.
