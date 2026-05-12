---
name: workbench
description: Use this skill for configuring, authoring, running, inspecting, improving, syncing, or exporting Workbench benchmarks and subjects with the `workbench` CLI.
---

# Workbench

Use `workbench` as a local-first benchmark CLI. Normal `eval`, `improve`, `open`, `runs`, and `subjects` commands operate on the local Workbench project. Workbench Cloud is the optional remote layer for hosted execution, `clone`, `fetch`, `pull`, `push`, cloud-scoped forks, and stars.

## Install And Auth

Before using the CLI, verify it is installed:

```bash
npm install -g @workbench-ai/workbench
workbench --version
```

For Workbench Cloud operations, authenticate with `workbench login`. If npm cannot access the `@workbench-ai` scope, report the registry/auth blocker and stop cleanly.

## Source Model

Workbench source uses split YAML:

- `benchmark.yaml` owns environment, score adapter, benchmark-owned adapters, and optional task-source selection.
- `subjects/<name>/subject.yaml` owns subject name, run behavior, and subject-owned adapters.
- `subjects/<name>/subject.yaml` declares subject files explicitly with `files: { path: files }`; those files are copied into the trial workspace.
- `tasks/<case>/task.yaml` includes `version: 2`, task text, and optional explicit `files`, `tests`, and `solution` path objects.
- `optimizers/<name>.yaml` owns subject-relative edit paths and improve behavior.

Subjects are the things Workbench evaluates or improves. A subject can be a file-backed skill, prompt directory, script-backed workflow, or agent/model configuration. Use separate subject directories for distinct runnable choices, for example `subjects/claude/` and `subjects/codex/`.

If `benchmark.tasks` is omitted, Workbench uses the built-in task-source adapter `path` with `with.path: tasks`. Explicit task sources always use `tasks: { use: ..., with: ... }`, for example `tasks: { use: harbor, with: { path: ... } }` or `tasks: { use: path, with: { path: tasks } }`. Task-source adapters implement `tasks.resolve` and write `workbench-result.json` with protocol `workbench.adapter-result.v1`; core runs trials over those returned bundles and does not parse native Workbench task directories or Harbor directories directly.

Default to `score: use: rubric` for qualitative or judgment-based scoring. Use `score: use: tests` for deterministic checks or an existing programmatic scorer. Harbor task interop should be expressed as `tasks: { use: harbor, with: ... }`; it is a task-source adapter that normalizes tasks before trials, not a Harbor-specific runtime mode.

## Local Flow

```bash
workbench init --skill my-eval --agent codex
workbench check
workbench eval subjects/codex --samples 1
workbench improve --budget 1 --samples 1
workbench open --json --no-open
```

`workbench improve` uses the current subject by default and evaluates it first if needed. Use `--from SUBJECT_ID` only when improving a specific historical subject snapshot.

Use `workbench open --json --no-open` to start the local read-only Workbench UI. Keep that process running while the page is in use; stopping it stops the preview server.

## Remote And Hosted Flow

```bash
workbench login
workbench push --tag v1
workbench cloud eval subjects/codex --benchmark owner/name@v1 --samples 1 --watch
workbench cloud improve subjects/codex --base subject_123 --optimizer optimizers/codex.yaml --budget 1 --samples 1 --watch
workbench cloud open --json --no-open
```

Use `workbench push` to sync benchmark source. Use `workbench cloud eval subjects/foo --benchmark owner/name@v1` to submit subject-owned source/files to an existing benchmark version without mutating benchmark source. Hosted storage ids are opaque `subject_...` resources.

Use `workbench clone OWNER/BENCHMARK[@REF]` to download benchmark source, `workbench cloud fork OWNER/BENCHMARK[@REF] [NAME]` to change benchmark source, and `workbench cloud star` / `workbench cloud unstar` for public benchmark markers.

Hosted commands return or print Workbench Cloud URLs. Prefer the `urls` object from JSON output. When an embedded browser is available, navigate it to the relevant Workbench URL so the user can inspect results.

## Adapters

Built-in adapters include `path` and `harbor` for `tasks.resolve`, `codex`, `claude`, and `pi` for `subject.run` and `subject.improve`, and `tests` and `rubric` for `trial.score`. Custom adapters can be workspace paths, `npm:` package specifiers, or `git:` refs. Unversioned npm and branch-like git refs float; exact npm versions and git commits are pinned by editing the YAML source. A custom adapter whose manifest id matches a built-in intentionally overrides that built-in for the project. Use `workbench adapters test ID|SOURCE` to validate a manifest, and add `--request PATH --output DIR` to replay a local `workbench.adapter.v2` operation fixture. TypeScript adapter authors can use `defineAdapter`, operation helpers, and `runDefinedAdapter` from `@workbench-ai/workbench-protocol`; raw adapters can still implement the JSON protocol directly. Command scorers must publish `workbench-result.json` for `trial.score`.

`benchmark.environment.dockerfile` owns task tools and should include `ca-certificates` when HTTPS tools are needed. Adapter setup owns adapter CLI dependencies.

## Eval Authoring References

When creating or editing Workbench evals, load only the relevant authored references:

- `references/docs/evals/README.md` for the overall eval-authoring flow.
- `references/docs/evals/spec-syntax.md` for split `benchmark.yaml`, subject manifests, task packages, the `TaskBundle` boundary, score adapters, and optimizer YAML.
- `references/docs/evals/runner-contract.md` for trials, staged paths, same-environment scoring, and scorecards.
- `references/docs/evals/adapters.md` for custom adapter manifests, built-in overrides, auth, slots, task-source adapters, and local replay.
- `references/docs/evals/from-existing-workflow.md` when wrapping an existing benchmark, smoke test, script, or manual scoring workflow.
- `references/docs/evals/from-file-outputs.md` when tasks or outputs involve `.docx`, `.xlsx`, `.pdf`, `.pptx`, or similar files.
