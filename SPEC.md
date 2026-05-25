# Workbench Spec

Workbench is a local-first benchmark workbench built on `version: 3` source and three public authored primitives:

- Engine: the benchmark runtime and measurement contract. An engine owns tasks, environments, scoring, verifier visibility, and result normalization for its benchmark style.
- Subject: the thing being evaluated or improved. A subject can be files, a command wrapper, or agent/model configuration.
- Optimizer: the improve configuration that says which subject files may be edited and which adapter performs the improvement.

The built-in `workbench` engine is the native engine for task directories, Docker environments, rubric scoring, and test scoring. Its `engine.with` config owns `environment`, optional `tasks` path selection, and the `score` adapter slot. Score helpers such as `tests` and `rubric` are slot targets, not core adapter categories. Rubric scoring runs one judge agent turn per criterion and uses `score.with.parallelism` as the single configurable throttle for those criterion turns; the helper publishes each criterion judge as a trace session plus scorecard/result files under the parent attempt job. The core runtime records only the generic engine job result, trace sessions, trace files, and artifacts. Harbor interop is supplied by an external engine adapter declared from a benchmark-contained path, npm package, or git ref and selected with `engine.use: harbor`. Top-level `environment`, `tasks`, and `score` from older source shapes are not part of the target contract.

## Source Shape

```text
benchmark.yaml
subjects/<name>/subject.yaml
subjects/<name>/files/        # optional
optimizers/<name>.yaml        # optional
tasks/<case>/task.yaml
tasks/<case>/files/           # public case files staged at /workspace/input/case
tasks/<case>/tests/           # verifier-private files staged at /workspace/private/engine
tasks/<case>/solution/        # optional oracle-only material
```

`benchmark.yaml`:

```yaml
version: 3
name: tiny-terminal
description: Evaluate terminal subjects.
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

`subjects/<name>/subject.yaml`:

```yaml
version: 3
name: command subject
files:
  path: files
run:
  use: command
  with:
    command: "printf '42\n' > answer.txt"
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
version: 3
name: harbor-terminal
description: Run subjects on a local Harbor dataset.
adapters:
  - npm:@acme/workbench-harbor-engine@1.0.0
engine:
  use: harbor
  with:
    path: harbor-dataset
```

The Harbor engine adapter is a thin Workbench bridge to Harbor. Harbor itself owns `instruction.md`, `task.toml`, `environment/`, `tests/`, MCP server config, health checks, `solution/`, subject invocation, verifier/reward behavior, artifact handoff, and same-sandbox versus separate-sandbox verifier topology. Workbench YAML does not duplicate Harbor verifier, artifact, environment, or step configuration. Workbench core does not call `harbor run` directly or expose Harbor as a special core runtime mode. A Harbor adapter normally declares `operations.engine.run.executor: host`, calls Harbor's inspect/export or run entrypoint, offers Workbench runtime-control as a sandbox provider when Harbor asks for sandboxes, and normalizes Harbor's final result into the same `workbench.adapter.v3` request and `workbench.adapter-result.v1` result used by every engine. Core records metrics and criteria as separate normalized fields and does not infer one from the other. Use benchmark-contained paths for portable Cloud runs; if an engine reads outside the benchmark tree, its `engine.resolve` operation must emit inspectable resolved files.

## Cloud Source Boundary

The CLI resolves benchmark source locally, runs the selected resolver through `engine.resolve`, and uploads `subjectFiles`, `engineResolveFiles`, `engineResolveBinding`, adapter files, and Dockerfile source. Workbench Cloud validates that the binding matches the selected engine resolver in the uploaded source YAML, stores it beside the `engineResolve` snapshot, and plans runs only from the uploaded resolved cases. Cloud does not call `engine.resolve` itself and does not know Harbor, Workbench-native task layout, MCP servers, health checks, or grading internals.

## Native Workbench Engine Lifecycle

For each subject/task/sample, the built-in `workbench` engine is a host-side controller. Core schedules one generic `engine.run` attempt job, starts the trusted Workbench engine adapter, and exposes the same runtime-control endpoint available to external host engines. The adapter then chooses its child sandbox topology:

1. It reads the immutable subject source package, public task files, engine-private verifier files, and traces from the generic adapter request paths.
2. With default `engine.with.grading.isolation: shared`, it asks runtime-control to run one child sandbox sequence: optional subject `prepare.command`, the configured `subject.run` adapter, then the configured scoring helper `engine.run`.
3. With `engine.with.grading.isolation: separate`, it asks runtime-control for a runner child sandbox that runs prepare plus `subject.run`, collects the mutable workspace snapshot and output artifacts, then asks runtime-control for a grader child sandbox that receives those runner outputs plus engine-private files and runs the scoring helper.
4. It writes one normal `workbench.adapter-result.v1` `engine.run` result from the scoring helper and copies selected child artifacts/traces into the parent attempt output.
5. Core records one generic attempt job containing the normalized score, metrics, feedback, trace sessions, trace files, and artifacts emitted by the engine.

Verifier files are not present during subject prepare or in the subject adapter request. In shared mode they are staged only when the scoring operation starts. In separate mode they are never included in the runner child sandbox. Core does not copy subject files into the mutable workspace root; subjects that need a root working copy should declare `prepare.command` and copy from `/workspace/input/subject`. Runtime adapters must discover staged paths from `WORKBENCH_ADAPTER_REQUEST`; authored YAML and source paths are resolved before staging and are not a runtime mount contract.

## CLI Surface

```bash
workbench init [DIR] --command NAME
workbench check [SOURCE] [--dir DIR] [--json]
workbench eval [SOURCE] [--dir DIR] [--subject ID] [--samples N] [--json]
workbench improve [SOURCE] [--dir DIR] [--from SUBJECT_ID] [--optimizer OPTIMIZER_YAML] [--budget N] [--samples N] [--json]
workbench subjects list|show|files|preview ...
workbench traces collect|list [--providers codex,claude] [--since 30d] [--workspace DIR] [--limit N] [--json]
workbench traces show TRACE_ID [--providers codex,claude] [--since 30d] [--workspace DIR] [--json]
workbench open [SOURCE] [--dir DIR] [--no-open] [--json]
```
