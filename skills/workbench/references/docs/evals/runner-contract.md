# Execution Contract

Workbench resolves `benchmark.yaml`, a candidate manifest, optional candidate files, the selected engine config, and optional candidate improve config into generic executions. Eval runs ask the selected engine to evaluate one candidate. Improve runs call the improve's improve adapter to patch candidate files, then evaluate the improved candidate with the same engine.

For the built-in `workbench` engine, each attempt is one top-level `engine.run` job owned by a host controller. The default child topology is shared: the engine asks runtime-control to run optional `candidate.prepare.command`, the candidate adapter, and engine-owned scoring in one child sandbox. With `engine.with.grading.isolation: separate`, the engine runs the candidate in one child sandbox, collects the mutable workspace and `/workspace/output` artifacts, then scores them in a second child sandbox with verifier files mounted under `/workspace/private/engine`. Harbor uses an external Harbor engine adapter; Harbor `task.toml` and the Harbor runtime decide whether its verifier uses the same sandbox or a separate sandbox, while the adapter only bridges Harbor's sandbox requests to Workbench runtime-control when needed.

Default catalog adapters such as `codex` and `claude` implement candidate run and candidate improve behavior. The built-in `workbench` engine owns native task loading plus `tests` and `rubric` scoring helpers. The rubric helper runs one judge agent turn per criterion and owns `parallelism` as the only configurable throttle for those criterion turns; core runtime remains generic and records the normalized engine result. Harbor is an external engine adapter. External adapters, including project-declared overrides for default catalog ids, run through the same `workbench.adapter.v3` request and `workbench.adapter-result.v1` result contract inside the composed environment declared by the engine plus adapter setup.

During hosted execution, agent adapters may publish live `job_progress` event batches before the terminal job output exists. These batches are best-effort UI progress and trace deltas. The completed adapter result remains authoritative.

Adapters may report execution usage on the completed result. Provider-reported cost is authoritative. When the provider does not report cost, Workbench estimates from its checked-in LiteLLM price snapshot using the exact model string emitted by the adapter.

## Engine Boundary

The selected engine is the boundary for case parsing, environment setup, scoring, and result normalization. Core chooses an engine from `benchmark.yaml`, gives it the selected candidate, and records the engine's normalized output.

The built-in `workbench` engine parses native Workbench task directories such as `tasks/<case>/task.yaml`. Harbor directories such as `instruction.md`, `task.toml`, `environment/`, `tests/`, MCP server config, health checks, and `solution/` are parsed by Harbor itself behind the Harbor engine adapter. Core does not walk native Workbench task package directories or Harbor directories to decide what an eval means.

## Staged Filesystem

Every built-in Workbench engine attempt receives a minimal filesystem:

- `/workspace`: the mutable working directory. It starts without an implicit candidate copy; optional `candidate.prepare.command` may copy or install files here.
- `/workspace/input/candidate`: immutable candidate baseline.
- `/workspace/input/case`: public case files from the selected task.
- `/workspace/private/engine`: engine-only verifier and private files, hidden from candidate adapters and available only while scoring.
- `/workspace/output`: the only durable output directory for adapter results, inspectable artifacts, and traces.

Improve jobs use a smaller surface. The mutable candidate files start directly in `/workspace`, and planner-selected prior attempt evidence is staged under `/workspace/input/traces`. Improve jobs do not receive a separate `/workspace/input/candidate` contract.

The trace input is a generic archive, not an engine-specific summary. It contains `index.json` plus `executions/<sequence>/request.json`, `executions/<sequence>/result.json`, and `executions/<sequence>/files/...` for the latest matching baseline evaluation attempts plus completed terminal attempts from the current improve run so far. It excludes baseline candidate materialization, prior optimizer turns, unrelated run configurations, and synthetic optimizer-only files such as `evaluation.json` or trace manifests.

Adapter commands receive `WORKBENCH_ADAPTER_REQUEST`, which points to the operation request JSON, `WORKBENCH_OUTPUT`, which points to `/workspace/output`, and `WORKBENCH_RESULT`, which points to the expected `workbench-result.json` path. Adapters must use the request's `paths` object instead of assuming hard-coded mounts. `candidate.prepare.command` is not an adapter operation; it runs from `/workspace`, sees the fixed input folders, and receives `WORKBENCH_OUTPUT` for logs if needed.

Operation visibility for built-in Workbench engine helpers is exact:

| Operation | Visible paths | Required result value |
| --- | --- | --- |
| `engine.resolve` | project source paths available during source resolution | resolved engine cases and optional environment defaults |
| `candidate.improve` | mutable candidate workspace, prior adapter executions, and output | candidate patch |
| `candidate.run` | mutable candidate workspace, immutable candidate baseline, public case files, and output | `null` or omitted value |
| `engine.run` | mutable candidate workspace, public case files, engine-private verifier files, and output | Workbench result record |

Verifier files are not present in the candidate adapter request. The built-in Workbench engine passes `paths.case` to nested candidate adapters and does not pass `paths.enginePrivate`. This preserves the hidden-data boundary while allowing the engine-owned scoring helper to inspect the real final filesystem state.

No runtime operation receives benchmark/candidate/candidate improve config as source files. Adapter commands receive only the standard request JSON through `WORKBENCH_ADAPTER_REQUEST`. Auth material is scoped to the adapter invocation being executed.

Source references are resolved before staging:

- Omitted `engine.with.tasks` reads the default `tasks/` directory through the built-in `workbench` engine. Explicit engine paths, `engine.with.environment.dockerfile`, and adapter sources are literal paths relative to the YAML file that declares them.
- Candidate files are declared with `files.path`, normally `files` next to the selected `candidate.yaml`. Attempt jobs stage them at `/workspace/input/candidate`; improve jobs stage them as the mutable `/workspace` working directory.
- Optional `candidate.prepare.command` runs from `/workspace` before candidate execution and before engine-private files are staged. Use it to copy or install candidate files into the mutable workspace for attempts.
- `candidate.improve.edits[]` entries are literal paths inside that candidate `files/` directory.
- Workbench uses the whole candidate files directory and the selected engine's resolved case data. For the built-in `workbench` engine, public files are staged at `paths.case`, verifier files are scoring-only under `paths.enginePrivate`, and solution files are oracle-only.
- `improve`, `run`, and `score` identify adapters by `use`; all adapter-specific settings, including optional first-party `instructions`, live under `with`.
- Adapter manifest `slots` point at nested adapter-shaped values under `with` and declare the required operation so Workbench can include sources, collect/default auth, and validate nested adapter support. They do not automatically execute nested adapters; the parent adapter owns any delegation behavior.

## Outputs

Every adapter operation writes `/workspace/output/workbench-result.json` with protocol `workbench.adapter-result.v1`:

```json
{
  "protocol": "workbench.adapter-result.v1",
  "operation": "engine.run",
  "ok": true,
  "value": {
    "score": 0.82,
    "metrics": {
      "format_similarity": 0.82
    },
    "summary": "Matched required tables and headings; missed footer formatting.",
    "cases": [
      {
        "id": "task",
        "status": "completed",
        "metrics": { "format_similarity": 0.82 },
        "criteria": [
          {
            "criterion_id": "required_tables",
            "label": "Required tables",
            "score": 1,
            "pass": true,
            "rationale": "All required tables were present."
          }
        ]
      }
    ],
    "feedback": {
      "notes": "Footer was missing."
    }
  },
  "usage": {
    "total": {
      "provider": "acme",
      "model": "agent-v2",
      "inputTokens": 1200,
      "outputTokens": 300,
      "totalTokens": 1500,
      "costUsd": 0.12,
      "costSource": "provider"
    }
  }
}
```

Result values are operation-specific protocol details:

- `candidate.run`: `null` or omitted `value`.
- `engine.run`: a Workbench result record. `score` is required and must be finite.
- `candidate.improve`: a candidate patch with `files`, required `fileChanges`, and optional `summary`.

Result record fields:

- `score`: required numeric metric.
- `metrics`: optional additional numeric metrics. Metrics remain generic; checks that should appear as criteria are emitted in case `criteria`.
- `summary`: optional short human-readable result.
- `cases`: optional case-level results, feedback, and criterion scores. Case status is operational: use `completed` for a valid result record and `error` only for scoring/runtime errors.
- `feedback`: optional structured JSON for diagnostics.

The built-in `workbench` engine's `tests` helper reads reward files from its adapter-owned verifier output directory before publishing the standard adapter result. The helper sets `WORKBENCH_TESTS_VERIFIER_DIR`; if needed, scripts can derive the same path from `paths.output/.workbench/internal/verifier`.

The built-in `workbench` engine's `rubric` helper runs one judge turn per criterion and may use verifier-private files while scoring. Those criterion turns are not core jobs. The helper publishes each selected judge `trace.json` as a trace session plus criterion result files and an aggregate scorecard under the parent attempt job's trace/artifact bundle. It does not publish raw event logs, request files, or `.workbench/internal` state.

- `$WORKBENCH_TESTS_VERIFIER_DIR/reward.json`, preferably with `reward` or `score`
- `$WORKBENCH_TESTS_VERIFIER_DIR/reward.txt`, containing a finite numeric reward

If an operation command exits non-zero, Workbench marks the execution failed. Engine scoring also fails when no valid result value is present. Command-based scoring helpers used by the built-in `workbench` engine must still publish `workbench-result.json`.

## Inspectable Artifacts

If a generated report, normalized text dump, screenshot, workbook, trace, or debug file should be inspectable after the attempt, copy it into `/workspace/output` during the candidate run or engine run. The engine-owned scoring helper sees those output artifacts in both shared and separate grading modes, and Workbench records durable artifacts from output.

A practical pattern is:

1. Candidate creates the primary output in `/workspace` and copies durable summaries or artifacts into `/workspace/output`.
2. The built-in `workbench` engine's tests helper compares the final state against deterministic verifier files, or its rubric helper runs one judge turn per criterion against the final state and engine-private verifier files.
3. The scoring helper writes `workbench-result.json` with a result value.

## Command Shape

Prefer checked-in candidate scripts and Dockerfile-pinned tools. Operation commands execute from the operation working directory. Put case dependencies in the environment Dockerfile instead of installing them during every evaluation job; adapter runtime dependencies belong in adapter `setup` commands.

```yaml
# candidates/codex/candidate.yaml
run:
  use: codex
  with:
    model: gpt-5.4-mini
```

```yaml
# benchmark.yaml
engine:
  use: workbench
  with:
    score:
      use: tests
```

Use shell glue only inside adapter-owned operation commands when it genuinely clarifies the operation.

## Adapter Request

External adapter commands read a single request file:

```json
{
  "protocol": "workbench.adapter.v3",
  "id": "exec_run_case_sample",
  "jobId": "job_exec_run_case_sample",
  "operation": "engine.run",
  "invocation": {
    "use": "my-engine",
    "with": { "mode": "strict" }
  },
  "context": {
    "benchmark": { "name": "example", "description": "Example benchmark" },
    "candidate": { "id": "candidate_current", "path": "candidates/my-agent/files" },
    "attempt": { "attemptIndex": 0, "sampleIndex": 0, "caseId": "task-001" },
    "case": { "prompt": "Case prompt from task.yaml" }
  },
  "paths": {
    "workspace": "/workspace",
    "output": "/workspace/output",
    "result": "/workspace/output/workbench-result.json",
    "candidate": "/workspace/input/candidate",
    "case": "/workspace/input/case",
    "traces": "/workspace/input/traces",
    "enginePrivate": "/workspace/private/engine"
  }
}
```

The request carries adapter-specific `with` data and optional resolved auth, but the output rules do not change. A single adapter implementation may support multiple operations by branching on `operation`. The built-in Workbench engine omits `paths.enginePrivate` from nested candidate adapter requests; candidate adapters should treat absent paths as unavailable, not infer them from the filesystem.

Env-backed auth is injected as the manifest-declared environment variables for the matching operation. File-backed auth is materialized under a private per-execution root and listed in the request `auth` object with `filesRoot` plus the declared relative file names. The executing adapter keeps the short `auth.default` or `auth.<slot>` convenience shape; every materialized bundle is also namespaced under `auth.adapters[adapterId][slot]` so adapter slots cannot collide. Adapters should read only the env vars or files declared by their own manifest.
