# Workbench Architecture

`SPEC.md` defines the user-facing source and command contract. This document defines the open Workbench package boundary. Hosted control-plane implementation belongs to `products/workbench-cloud`.

## Repository Shape

Workbench is the open, local-first product surface:

- `packages/cli`: the published `workbench` command, command registry, local project commands, Workbench Cloud client commands, API client, config handling, output formatting, and CLI tests.
- `packages/protocol`: the public adapter protocol. It owns adapter manifests, operation request and result parsing, adapter definition helpers, typed slots, and auth-requirement discovery for `workbench.adapter.v3`. Engine, subject, and optimizer adapters use this protocol; individual protocol operations are not public authored primitives.
- `packages/contract`: serializable DTOs shared by the CLI, Workbench Cloud API, reusable UI, and execution helpers.
- `packages/core`: the public execution core. It owns split YAML validation, source resolution, benchmark fingerprints, subject file snapshots, engine execution graph planning, Docker-backed local execution, sandbox capability validation, subject/evaluation materialization, runs, lineage, file previews, and generic trace DTO helpers.
- `packages/core/worker/sandbox-adapter-runner.cjs`: the small public runner copied into local Docker sandboxes. It validates scoped execution capability input and calls the core adapter runtime.
- `packages/built-in-adapters`: first-party adapter manifests and commands for the native `workbench` engine plus `codex`, `claude`, `command`, `rubric`, and `tests`. Harbor is packaged as an external engine adapter.
- `packages/workbench-ui`: the browser Workbench UX used by local `workbench open` and Workbench Cloud.
- `environments/`: Dockerfiles for built-in local execution images.
- `skills/workbench/`: canonical authored agent skill source.
- `docs/`: canonical public CLI and eval-authoring docs rendered by Workbench Cloud.
- `plans/`: product plan history indexed by `plans/index.md`.

`products/workbench-cloud/packages/cloud-runtime` is intentionally outside this product. It owns hosted worker entrypoints, Firecracker, Daytona, E2B, remote runtime overlays, environment builders, queue workers, and production sandbox-host behavior.

The `packages/cli` package owns the `workbench` binary implementation, command registry, output formatting, and command tests. It is not the documentation or skill ownership boundary. Product docs and skills stay at the Workbench product root so the same source describes the local engine, public adapter protocol, browser UI, and optional Workbench Cloud client commands without making those concepts look CLI-owned.

## Ownership Boundaries

- The CLI owns local project lifecycle commands and the open Cloud client surface: `login`, `clone`, `fetch`, `pull`, `push`, and `workbench cloud ...`.
- The protocol package owns the stable adapter contract. Engine, subject, and optimizer adapter authors should not need to import Web or cloud-runtime code.
- The core package owns portable Workbench semantics and local Docker execution. Its authored source model is engine, subject, and optimizer. It must not depend on Next.js, AWS SDKs, Stripe, Cognito, Daytona, E2B, Firecracker implementation code, Terraform, or hosted worker entrypoints.
- The CLI ships a default adapter catalog as ordinary adapter manifests. Core can execute adapters, but it does not special-case default adapter ids. A project-declared adapter source with the same id as a default adapter intentionally overrides that default for the project; wrapping is implemented by that replacement adapter delegating however it chooses.
- Workbench Cloud owns hosted persistence, billing, auth, Web routes, production infrastructure, queue workers, remote provider admission, and hosted sandbox providers.
- Shared UI stays presentation-only. It renders benchmark, subject, run, evaluation, lineage, file, and trace DTOs without owning execution rules.

This is a git/GitHub-style split: `workbench` is the open client and local engine; Workbench Cloud is an optional hosted service implemented by cloud-owned private packages.

## Public Source Repository

The public repository `workbench-ai/workbench` is generated from the open Workbench boundary. It contains the Workbench packages, the shared `cli-web-ui` source package needed by `packages/workbench-ui`, the first-party adapter packages required by built-in agent adapters, docs, environments, and the installable skill at `skills/workbench/SKILL.md`.

The public source repository intentionally has no root `SKILL.md`. The upstream `skills` installer treats a root `SKILL.md` as the skill root, which would copy the entire source tree into `.agents/skills/workbench`. Keeping the skill nested preserves the install UX `npx skills add workbench-ai/workbench` while installing only the skill directory.

The source export is maintained by the root command `pnpm workbench:public-source:validate` and published with `pnpm workbench:public-source:publish`. `pnpm skills:public:publish` must not publish or force-push `workbench-ai/workbench`; source-backed public repositories publish through their product-specific source export wrappers.

## Core Execution Model

Runnable source uses version-3 split YAML. The target design does not expose top-level `environment`, `tasks`, or `score` as core source primitives:

- `benchmark.yaml` owns benchmark metadata and `engine`. The engine is the benchmark runtime and measurement contract.
- `engine.use: workbench` selects the built-in Workbench-native engine. Its `engine.with` config owns `environment`, optional task path selection, and `score`.
- `subjects/<name>/subject.yaml` owns how to prepare and run one subject.
- `subjects/<name>/files/` is the subject source package staged at `/workspace/input/subject`; optional `subject.prepare.command` can copy or install those files into the mutable `/workspace`.
- `optimizers/<name>.yaml` owns subject-relative edit paths and improve behavior.
- `tasks/<case>/files/` is public case material staged by the built-in `workbench` engine at `/workspace/input/case`.
- `tasks/<case>/tests/` is verifier-private material staged at `/workspace/private/engine` and exposed only to scoring by the built-in `workbench` engine.

The benchmark fingerprint is the comparability boundary. Subjects from different benchmark fingerprints are not compared as peers.

Core compiles eval and improve requests into generic executions:

- `improve` reads subject files and ancestor traces, runs an `optimizer.improve` adapter operation, and validates the returned subject patch against optimizer edit paths.
- `eval` invokes the selected engine with the selected subject. For `engine.use: workbench`, the engine runs as a host controller and uses runtime-control to allocate child sandbox operation sequences. The default shared topology runs prepare, subject, and scoring in one child sandbox; `engine.with.grading.isolation: separate` runs subject and scoring in separate child sandboxes while passing only runner workspace/output artifacts to the grader.

Workbench-native task loading and `tests`/`rubric` scoring behavior belongs to the built-in `workbench` engine. Scoring helpers may be implemented through the adapter protocol, but they are not core adapter categories. Rubric scoring fans out to one judge agent turn per criterion and owns `parallelism` as the only configurable throttle for those criterion turns; the helper publishes each criterion judge as a trace session plus scorecard/result files under the parent attempt job, while the core runtime records one generic engine job result, trace-session set, trace-file set, and artifact bundle. Harbor is not a core runtime mode; `engine.use: harbor` selects an external engine adapter, declared from a local path, npm package, or git ref, that bridges Workbench to Harbor. Harbor itself owns Harbor task parsing, MCP server config, health checks, environment interpretation, subject invocation, artifact handoff, verifier topology, verifier/reward behavior, result semantics, and criteria semantics through its `task.toml` and runtime. Engines that need a trusted controller declare `operations.engine.run.executor: host`; Workbench runs that adapter controller in the trusted local or Cloud worker process through the same request/result protocol and the same runtime-control capability, without a Harbor-specific branch.

Local execution uses the public Docker sandbox backend in `packages/core/src/sandbox-backends/docker.ts` for sandbox-executor operations and runtime-control child operation sequences. The same sandbox-plane interface validates input scope, output scope, allocation metadata, handles, and execution capabilities before any sandboxed adapter command runs. Host-executor operations bypass Workbench sandbox allocation for the controller itself, but the controller can request child sandboxes through runtime-control. Remote provider implementations are private cloud-runtime code that wrap the public core execution function with hosted provider factories.

## Stores

Local project state lives under `.workbench/` inside the project:

- `.workbench/runtime` stores local runs, subjects, evaluations, traces, and file snapshots.
- `.workbench/origin.json` stores the configured Workbench Cloud origin.
- `.workbench/fetch` stores downloaded remote source before `pull` updates managed files.

Workbench Cloud stores hosted state separately. Production storage, queueing, billing, and sandbox-host state are not part of the public Workbench package boundary.

## Invariants

- Public packages are publishable without proprietary hosted infrastructure.
- Public package manifests must not depend on AWS SDKs, Next.js, NextAuth, Stripe, Daytona, E2B, or cloud-owned runtime packages.
- `workbench --help`, `docs/cli.md`, `SPEC.md`, tests, and the authored `workbench` skill must describe the same command surface.
- The CLI must work outside git repositories.
- The CLI must remain automation-friendly: stable JSON with `--json`, explicit flags, useful non-zero failures, and no hidden interactive prompts.
- Adapter commands receive the standard `WORKBENCH_ADAPTER_REQUEST` file and must rely only on its `paths` object for staged filesystem locations. They do not receive source YAML files, job claim tokens, worker tokens, queue credentials, hosted billing state, or sandbox control request internals.
- `workbench.adapter.v3` is the adapter manifest and request protocol. Adapter operations return one `workbench.adapter-result.v1` file, and operation-specific result values belong to that protocol boundary. Public authoring docs should expose engine, subject, and optimizer first; operation names are adapter-implementation details.
