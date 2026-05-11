---
name: workbench
description: Use this skill for configuring, authoring, running, inspecting, improving, syncing, or exporting Workbench benchmarks and candidates with the `workbench` CLI.
---

# Workbench

Use `workbench` as a local-first benchmark CLI. Normal `eval`, `improve`, `open`, `runs`, and `candidates` commands operate on the local Workbench project. Workbench Cloud is the optional remote layer for hosted execution, `clone`, `fetch`, `pull`, `push`, cloud-scoped forks, and stars.

## Install And Auth

Before using the CLI, verify it is installed:

```bash
npm install -g @workbench-ai/workbench
workbench --version
```

For Workbench Cloud operations, authenticate with `workbench login`. If npm cannot access the `@workbench-ai` scope, report the registry/auth blocker and stop cleanly.

## Source Model

Workbench source uses split YAML:

- `benchmark.yaml` owns tasks, environment, grading, and benchmark-owned adapters.
- `candidates/<name>/candidate.yaml` owns candidate name, run behavior, and candidate-owned adapters.
- `candidates/<name>/files/` contains the mounted candidate files.
- `optimizers/<name>.yaml` owns candidate-relative edit paths and improve behavior.

Candidate manifests do not declare a benchmark or path. Use separate candidate directories for custom candidates or runner switches, for example `candidates/claude/` and `candidates/codex/`.

Default to `grade: use: rubric` for qualitative or judgment-based scoring. Use `grade: use: command` only for deterministic checks, an existing scorer, or an explicitly requested programmatic grading contract.

## Local Flow

```bash
workbench init --skill my-eval --agent codex
workbench check
workbench eval candidates/codex --samples 1
workbench improve --budget 1 --samples 1
workbench open --json --no-open
```

`workbench improve` uses the current candidate by default and evaluates it first if needed. Use `--from CANDIDATE_ID` only when improving a specific historical candidate.

Use `workbench open --json --no-open` to start the local read-only Workbench UI. Keep that process running while the page is in use; stopping it stops the preview server.

## Remote And Hosted Flow

```bash
workbench login
workbench push --tag v1
workbench cloud eval candidates/codex --benchmark owner/name@v1 --samples 1 --watch
workbench cloud improve candidates/codex --base cand_123 --optimizer optimizers/codex.yaml --budget 1 --samples 1 --watch
workbench cloud open --json --no-open
```

Use `workbench push` to sync benchmark source. Use `workbench cloud eval candidates/foo --benchmark owner/name@v1` to submit candidate-owned source/files to an existing benchmark version without mutating benchmark source. Candidate submissions are private until `workbench cloud candidates publish CANDIDATE_ID`.

Use `workbench clone OWNER/BENCHMARK[@REF]` to download benchmark source, `workbench cloud fork OWNER/BENCHMARK[@REF] [NAME]` to change benchmark source, and `workbench cloud star` / `workbench cloud unstar` for public benchmark markers.

Hosted commands return or print Workbench Cloud URLs. Prefer the `urls` object from JSON output. When an embedded browser is available, navigate it to the relevant Workbench URL so the user can inspect results.

## Adapters

Built-in adapters include `codex`, `claude`, `pi`, `command`, and `rubric`. Custom adapters can be workspace paths, `npm:` package specifiers, or `git:` refs. Unversioned npm and branch-like git refs float; exact npm versions and git commits are pinned by editing the YAML source. A custom adapter whose manifest id matches a built-in intentionally overrides that built-in for the project. Use `workbench adapters test ID|SOURCE` to validate a manifest, and add `--request PATH --output DIR` to replay a local `workbench.adapter.v1` fixture.

`benchmark.environment.dockerfile` owns task tools and should include `ca-certificates` when HTTPS tools are needed. Adapter setup owns adapter CLI dependencies.

## Eval Authoring References

When creating or editing Workbench evals, load only the relevant authored references:

- `references/docs/evals/README.md` for the overall eval-authoring flow.
- `references/docs/evals/spec-syntax.md` for split `benchmark.yaml`, candidate manifests, candidate files, and optimizer YAML.
- `references/docs/evals/runner-contract.md` for improve, run, grade, staged input, `/workspace/output`, and `/workspace/output/scorecard.json` contracts.
- `references/docs/evals/adapters.md` for custom adapter manifests, built-in overrides, auth, nested refs, and local replay.
- `references/docs/evals/from-existing-workflow.md` when wrapping an existing benchmark, smoke test, script, or manual scoring workflow.
- `references/docs/evals/from-file-outputs.md` when tasks or outputs involve `.docx`, `.xlsx`, `.pdf`, `.pptx`, or similar files.
