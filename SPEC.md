# Workbench Spec

Workbench is a local-first benchmark workbench built on `version: 4` benchmark/candidate source and two public authored primitives:

- Engine: the benchmark runtime and measurement contract. An engine owns tasks, environments, scoring, verifier visibility, and result normalization for its benchmark style.
- Candidate: the thing being evaluated or improved. A candidate can be files, a command wrapper, or agent/model configuration.

Candidate manifests own every choice about how that candidate runs and improves: files, prepare commands, runnable agent/model variants, the default run, and optional improve settings. The core benchmark stays focused on what is measured.

The built-in `workbench` engine is the native engine for task directories, Docker environments, rubric scoring, and test scoring. Its `engine.with` config owns `environment`, optional `tasks` path selection, and the `score` adapter slot. Score helpers such as `tests` and `rubric` are slot targets, not core adapter categories. Rubric scoring runs one judge agent turn per criterion and uses `score.with.parallelism` as the single configurable throttle for those criterion turns; the helper publishes each criterion judge as a trace session plus scorecard/result files under the parent attempt job. The core runtime records only the generic engine job result, trace sessions, trace files, and artifacts. Harbor interop is supplied by an external engine adapter declared from a benchmark-contained path, npm package, or git ref and selected with `engine.use: harbor`. Top-level `environment`, `tasks`, and `score` from older source shapes are not part of the target contract.

## Source Shape

```text
benchmark.yaml
candidates/<name>/candidate.yaml
candidates/<name>/files/        # optional
tasks/<case>/task.yaml
tasks/<case>/files/           # public case files staged at /workspace/input/case
tasks/<case>/tests/           # verifier-private files staged at /workspace/private/engine
tasks/<case>/solution/        # optional oracle-only material
```

`benchmark.yaml`:

```yaml
version: 4
name: tiny-terminal
description: Evaluate terminal candidates.
engine:
  use: workbench
  with:
    environment:
      dockerfile: environment/Dockerfile
      network:
        egress: none
    score:
      use: tests
```

`engine.with.environment.network.egress` is binary: `open` allows normal internet egress and `none` disables egress from the benchmark sandbox. Omitted `network` defaults to `open`. Workbench does not expose per-host network allowlists because provider support is inconsistent; benchmarks that need contamination protection should use `egress: none`, which may also block model and API clients.

Omitting `engine.with.tasks` is the canonical native task-package shape; the built-in `workbench` engine reads `tasks/`. Use `engine.with.tasks.path` only when the native task directory is not `tasks/`:

```yaml
engine:
  use: workbench
  with:
    environment:
      dockerfile: environment/Dockerfile
    tasks:
      path: alternate-tasks
    score:
      use: tests
```

`candidates/<name>/candidate.yaml`:

```yaml
version: 4
name: command candidate
files:
  path: files
defaultRun: main
runs:
  main:
    name: Command
    use: command
    with:
      command: "printf '42\n' > answer.txt"
improve:
  edits:
    - prompt.md
  use: codex
  with:
    model: gpt-5.4-mini
```

`tasks/<case>/task.yaml` for the built-in `workbench` engine:

```yaml
version: 3
task: Write the answer to answer.txt.
files:
  path: files
tests:
  path: tests
solution:
  path: solution
```

Explicit Harbor engine adapter:

```yaml
version: 4
name: harbor-terminal
description: Run candidates on a local Harbor dataset.
adapters:
  - npm:@acme/workbench-harbor-engine@1.0.0
engine:
  use: harbor
  with:
    path: harbor-dataset
```

The Harbor engine adapter is a thin Workbench bridge to Harbor. Harbor itself owns `instruction.md`, `task.toml`, `environment/`, `tests/`, MCP server config, health checks, `solution/`, candidate invocation, verifier/reward behavior, artifact handoff, and same-sandbox versus separate-sandbox verifier topology. Workbench YAML does not duplicate Harbor verifier, artifact, environment, or step configuration. Workbench core does not call `harbor run` directly or expose Harbor as a special core runtime mode. A Harbor adapter normally declares `operations.engine.run.executor: host`, calls Harbor's inspect/export or run entrypoint, offers Workbench runtime-control as a sandbox provider when Harbor asks for sandboxes, and normalizes Harbor's final result into the same `workbench.adapter.v3` request and `workbench.adapter-result.v1` result used by every engine. Core records metrics and criteria as separate normalized fields and does not infer one from the other. Use benchmark-contained paths for portable Cloud runs; if an engine reads outside the benchmark tree, its `engine.resolve` operation must emit inspectable resolved files.

## Cloud Source Boundary

The CLI resolves benchmark source locally, runs the selected resolver through `engine.resolve`, and uploads `candidateFiles`, `engineResolveFiles`, `engineResolveBinding`, adapter files, and Dockerfile source. Workbench Cloud validates that the binding matches the selected engine resolver in the uploaded source YAML, stores it beside the `engineResolve` snapshot, and plans runs only from the uploaded resolved cases. Cloud does not call `engine.resolve` itself and does not know Harbor, Workbench-native task layout, MCP servers, health checks, or grading internals.

## Native Workbench Engine Lifecycle

For each candidate/task/sample, the built-in `workbench` engine is a host-side controller. Core schedules one generic `engine.run` attempt job, starts the trusted Workbench engine adapter, and exposes the same runtime-control endpoint available to external host engines. The adapter then chooses its child sandbox topology:

1. It reads the immutable candidate source package, public task files, engine-private verifier files, and traces from the generic adapter request paths.
2. With default `engine.with.grading.isolation: shared`, it asks runtime-control to run one child sandbox sequence: optional candidate `prepare.command`, the configured `candidate.run` adapter, then the configured scoring helper `engine.run`.
3. With `engine.with.grading.isolation: separate`, it asks runtime-control for a runner child sandbox that runs prepare plus `candidate.run`, collects the mutable workspace snapshot and output artifacts, then asks runtime-control for a grader child sandbox that receives those runner outputs plus engine-private files and runs the scoring helper.
4. It writes one normal `workbench.adapter-result.v1` `engine.run` result from the scoring helper and copies selected child artifacts/traces into the parent attempt output.
5. Core records one generic attempt job containing the normalized score, metrics, feedback, trace sessions, trace files, and artifacts emitted by the engine.

Verifier files are not present during candidate prepare or in the candidate adapter request. In shared mode they are staged only when the scoring operation starts. In separate mode they are never included in the runner child sandbox. For attempt jobs, core does not copy candidate files into the mutable workspace root; candidates that need a root working copy should declare `prepare.command` and copy from `/workspace/input/candidate`. For improve jobs, the candidate files are the mutable workspace root and planner-selected prior attempt evidence is staged under `/workspace/input/traces`. Runtime adapters must discover staged paths from `WORKBENCH_ADAPTER_REQUEST`; authored YAML and source paths are resolved before staging and are not a runtime mount contract.

## CLI Surface

```bash
workbench init [DIR] --command NAME
workbench check [SOURCE] [--dir DIR] [--json]
workbench eval [SOURCE] [--dir DIR] [--candidate CANDIDATE_ID] [--runs RUNS|all] [--samples N] [--rerun] [--json]
workbench improve [SOURCE] [--dir DIR] [--from CANDIDATE_ID] [--runs RUN] [--budget N] [--samples N] [--rerun] [--json]
workbench retry TARGET_ID [--dir DIR] [--json]
workbench candidates list|show|files|preview ...
workbench traces collect|list [--providers codex,claude] [--since 30d] [--workspace DIR] [--limit N] [--json]
workbench traces show TRACE_ID [--providers codex,claude] [--since 30d] [--workspace DIR] [--json]
workbench open [SOURCE] [--dir DIR] [--run RUN_ID] [--host HOST] [--port N] [--no-open] [--json]
workbench cloud retry TARGET_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--watch] [--interval-ms N] [--timeout-ms N] [--json]
```

`workbench eval` and `workbench improve` reuse completed work only when the candidate, run configuration, source, adapters, benchmark, and requested samples/budget match; `--rerun` is the explicit duplicate-spend escape hatch. Runtime candidates are automatically versioned display snapshots such as `Skill v1`, `Skill v2`, and `Skill v3`; authored YAML owns the candidate family and run configurations, not version labels.

Once an active candidate exists, eval records scores without moving that active pointer. Improve output uses `outputCandidateId` for the produced version and `activeCandidateId` for the current best evaluated candidate after scoring. They can differ when a newer version scores below the incumbent.

`workbench open` and hosted browser routes are read-only inspection surfaces. They expose candidates, evaluations, cases, traces, scorecards, and files for review; execution actions such as eval, improve, retry, cancellation, push, and pull stay in the CLI.
