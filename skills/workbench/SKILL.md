---
name: workbench
description: Use this skill for configuring, authoring, running, inspecting, improving, cloning, pulling, or pushing Workbench benchmarks and candidates with the `workbench` CLI.
---

# Workbench

Use `workbench` as a repo-like benchmark CLI. Commands create, validate, evaluate, improve, inspect, and serve a Workbench project. Workbench Cloud is an optional remote reached through `login`, `clone`, `pull`, `push`, and hosted execution flags on the same lifecycle commands.

## Install

Verify the CLI before using it:

```bash
npm install -g @workbench-ai/workbench
workbench --version
```

If npm cannot access the `@workbench-ai` scope, report the registry/auth blocker and stop cleanly.

## Public Demo Flow

When the user asks to try the Workbench demo, start from the public three-statement benchmark:

```bash
workbench clone official/three-statement-demo
cd three-statement-demo
workbench check
workbench login
workbench push
workbench improve --hosted candidates/current --budget 1 --samples 1 --watch
```

The public benchmark is readable without Workbench Cloud login. It starts with three cases and an empty skill frontmatter. Its cloned paths are `candidates/current` and `candidates/current/candidate.yaml`. If a local or hosted run reports missing adapter auth, run `workbench whoami --json` and connect the preferred provider, usually Codex. `workbench clone`, `workbench pull`, and `workbench push` exchange one portable project state: authored source plus durable runtime history. Source updates are guarded by the last seen remote revision/fingerprint, while runtime history merges as immutable facts. The active candidate is explicit runtime state; sync does not infer a replacement from the latest evaluated candidate, and active is `null` when the explicit pointer is incompatible with current source. Stop cleanly when login or OAuth requires user approval.

## Provider And Auth

Before scaffolding a benchmark, run `workbench whoami --json`. Inspect `adapterStatuses` and `hostedAuth.adapters`. Prefer a connected `codex` profile. If Codex is not connected, use another connected provider that fits the requested workflow. If no provider is connected, default to `codex`.

Workbench Cloud auth and adapter auth are separate. Use `workbench login` before Cloud operations. Connect adapter auth before local or hosted runs when `whoami` reports the selected adapter as disconnected. Use `workbench auth connect codex --method oauth` or `workbench auth connect claude --method oauth` to reuse subscription sign-in. OAuth file profiles are mutable runtime auth: Workbench serializes jobs sharing a profile and saves refreshed auth before the next job claims it. Use `--method api-key` with `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` only when the user wants provider API-key billing. For other adapters, inspect methods with `workbench adapters inspect ADAPTER`.

## Create And Push A Benchmark

When the user asks to create, run, or push a benchmark, proceed with a small smoke benchmark unless required information is missing. Use the selected adapter consistently in `workbench init --skill NAME --agent ADAPTER`, `candidates/ADAPTER`, and the candidate manifest's `runs` and `improve` blocks.

Default to `engine.with.score: { use: rubric, ... }` for qualitative tasks. Use `engine.with.score: { use: tests }` only for deterministic checks or an existing scoring workflow. Start with one or two tasks that prove the candidate can run, score, and emit inspectable output.

Ask the user only when the benchmark objective, required files, scoring criteria, provider/billing choice, or public/private visibility cannot be inferred safely. Stop and report the blocker when auth requires user approval, credentials are unavailable, required files are missing, or validation fails for reasons that cannot be fixed from local context.

## Source Shape

Use split source files:

- `benchmark.yaml` selects the engine and describes what is measured.
- `candidates/<name>/candidate.yaml` owns prepare, run variants, default run, optional improve behavior, and candidate files with `files: { path: files }`.
- `tasks/<case>/task.yaml` owns task text plus optional `split`, public `files`, hidden `tests`, and `solution` paths for the built-in Workbench engine.

For train/validation-style improvement, use task `split` labels plus candidate `improve.optimizeOn` and `improve.selectBy`. `optimizeOn` controls optimizer evidence, `selectBy` controls active-candidate promotion, and omitted policy preserves all-case `score`. Do not create named case sets or separate optimizer files.

Use `engine.with.environment.dockerfile` when the benchmark needs OS packages, CLIs, Python/R/Node dependencies, or shared runtime setup. Include `ca-certificates` when the environment installs packages or calls HTTPS services.

For deeper source syntax, staged paths, custom adapters, Harbor interop, and file-output recipes, load the references listed below instead of re-deriving the contract from memory.

## Local Development Flow

Create and validate locally before pushing:

```bash
workbench whoami --json
workbench init --skill my-eval --agent codex
workbench auth connect codex --method oauth
workbench check
workbench eval candidates/codex --samples 1
workbench improve --budget 1 --samples 1
workbench retry RUN_OR_EVAL_ID --json
workbench open --json --no-open
```

Skip `workbench auth connect ...` when `workbench whoami --json` already shows the selected adapter profile as connected. `workbench eval` uses the candidate's default run unless `--runs RUNS|all` is supplied, reuses completed evaluations only for the same candidate, run configuration, source, adapters, benchmark, and samples, and does not move the active pointer once an active candidate exists. `workbench improve` uses the evaluated active candidate when it belongs to the current benchmark fingerprint; otherwise it evaluates and uses the authored current candidate. It uses one selected run, defaulting to the candidate default, and reuses completed improvements only for the same base, run configuration, source, adapters, benchmark, budget, and samples. Use `--rerun` only when intentionally spending on another measurement or improvement attempt. Use `--runs RUN` to override the improve run and `--from CANDIDATE_ID` only when improving a specific historical candidate snapshot. Runtime candidate labels are automatic versions such as `Skill v1`, `Skill v2`, and `Skill v3`; do not put version labels in authored YAML. Improve JSON distinguishes `outputCandidateId` for the version produced by the run from `activeCandidateId` for the current best evaluated candidate. Use `workbench retry RUN_OR_EVAL_ID` only for failed local history; it leaves the failed record inspectable and reuses completed repair work when the same retry has already succeeded. Keep `workbench open --json --no-open` running while the local UI is in use. The browser UI is read-only inspection; run eval, improve, retry, cancel, push, and pull actions from the CLI.

## Hosted Execution Flow

After `workbench check`, push and run hosted smoke workflows. Run a bounded local eval first when local adapter auth and sandbox execution are already configured:

```bash
workbench login
workbench whoami --json
workbench push
workbench eval --hosted candidates/codex --benchmark owner/name --runs all --samples 1 --watch
workbench improve --hosted candidates/codex --base candidate_123 --budget 1 --samples 1 --watch
workbench retry --hosted RUN_OR_EVAL_ID --benchmark owner/name --watch --json
workbench open --hosted --json --no-open
```

Use `workbench push` to push one project state to the remembered remote. Hosted eval and improve also reuse completed work only for the same candidate, run configuration, source, adapters, benchmark, and requested samples/budget; use `--rerun` only for an intentional duplicate run. Use `workbench retry --hosted RUN_OR_EVAL_ID` only for failed hosted history; it replays the recorded candidate, configuration, sample count, and budget, and reuses completed repair work when the same retry has already succeeded. Use the `urls` object from JSON output when present. When an embedded browser is available, navigate it to the benchmark, evaluation, or candidate URL so the user can inspect candidates, cases, traces, scorecards, and files. Hosted ids such as `candidate_...` are opaque, and hosted browser pages are also read-only inspection.

For hosted eval, pass `--candidate CANDIDATE_ID` when evaluating an existing hosted candidate. For hosted improve, pass `--base CANDIDATE_ID` when choosing the candidate to improve.

When a watched or reused hosted run reaches a terminal state from a checkout linked to the same remote project, Workbench imports the hosted project state back into local if local authored source still matches the remembered base. Explicit `--benchmark` runs against a different project leave the current checkout untouched.

For remote collaboration, use `workbench clone OWNER/BENCHMARK`, `workbench pull`, and `workbench push`. If source changed on both sides since the last exchange, pull or push fails instead of choosing a winner; resolve by pushing or restoring local source before pulling, or pulling hosted source before pushing. Linked `workbench push --dry-run` verifies that the active Workbench account can read the remembered remote before reporting an update plan. Runtime sync treats candidate timestamps, versions, status, usage, owner, visibility, and generated tool profile/cache directories as read-model details; candidate files, inspectable execution outputs, and immutable fingerprints remain the conflict guards.

## Local Trace Inspection

Use local traces only as evidence for task authoring, not as automatic task generation. These commands are read-only, stateless, and do not call an LLM:

```bash
workbench traces list --providers codex,claude
workbench traces show TRACE_ID --json
workbench traces collect --providers codex,claude --json
```

For keyword triage, pipe the JSON through standard tools:

```bash
workbench traces list --workspace "$PWD" --limit 50 | rg -i -C 2 "spreadsheet|excel|xlsx|workbook|three-statement"
workbench traces show TRACE_ID --workspace "$PWD" --json \
  | jq '.trace.timeline[] | select(.type == "user" or .type == "assistant") | {type, text}'
```

## Eval Authoring References

When creating or editing Workbench evals, load only the relevant authored references:

- `references/docs/cli.md` for provider selection, auth, command syntax, runs, clone/pull/push remotes, and hosted execution flags.
- `references/docs/evals/README.md` for the overall eval-authoring flow.
- `references/docs/evals/spec-syntax.md` for split `benchmark.yaml`, candidate manifests, native task packages, engine-owned scoring, and candidate-owned improve settings.
- `references/docs/evals/runner-contract.md` for engine attempts, staged paths, same-environment scoring, and result records.
- `references/docs/evals/adapters.md` for custom adapter manifests, default catalog overrides, auth, slots, engine-owned helpers, and local replay.
- `references/docs/evals/tasks-and-fixtures.md` for task layout, public files, hidden verifier files, and Harbor imports.
- `references/docs/evals/from-existing-workflow.md` when wrapping an existing benchmark, smoke test, script, or manual scoring workflow.
- `references/docs/evals/from-file-outputs.md` when tasks or outputs involve `.docx`, `.xlsx`, `.pdf`, `.pptx`, or similar files.
- `references/docs/evals/run-and-inspect.md` for local smoke runs, hosted execution, hosted URLs, and run inspection.
