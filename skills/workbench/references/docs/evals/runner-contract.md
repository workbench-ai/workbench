# Execution Contract

Workbench resolves `benchmark.yaml`, a subject manifest, optional subject files, task-source adapter output, and optional optimizer YAML into generic executions. Eval runs create one `trial` per subject/task/sample. Improve runs call `subject.improve` to patch subject files, then evaluate the improved subject with trials.

A trial has one runtime environment. Workbench stages public task files from resolved `TaskBundle` data and subject files, runs the `subject.run` adapter, injects verifier tests, runs the `trial.score` adapter in the same mutated environment, and normalizes the scorecard. This is the single runtime model for both Workbench-native tasks and Harbor-shaped tasks.

Built-in `path` and `harbor` adapters implement `tasks.resolve`. Built-in `codex`, `claude`, and `pi` adapters implement `subject.run` and `subject.improve`. Built-in `tests` and `rubric` adapters implement `trial.score`. External adapters, including project-declared overrides for built-in ids, run through the same `workbench.adapter.v2` request and `workbench.adapter-result.v1` result contract inside the composed Dockerfile environment declared by `benchmark.environment.dockerfile` plus adapter setup.

During hosted execution, agent adapters may publish live `job_progress` event batches before the terminal job output exists. These batches are best-effort UI progress and trace deltas. The completed adapter result remains authoritative.

Adapters may report execution usage on the completed result. Provider-reported cost is authoritative. When the provider does not report cost, Workbench estimates from its checked-in LiteLLM price snapshot using the exact model string emitted by the adapter.

## TaskBundle Boundary

A `TaskBundle` is the resolved representation of one task. It contains task text, task id, public files, verifier-only files, optional oracle files, and optional task environment defaults. Native Workbench task directories and Harbor task directories are source formats, not core runtime formats.

The built-in `path` task-source adapter parses native Workbench task directories such as `tasks/<case>/task.yaml`. The built-in `harbor` task-source adapter parses Harbor directories such as `instruction.md`, `task.toml`, `environment/`, `tests/`, and `solution/`. After `tasks.resolve`, core receives `TaskBundle` data from `workbench-result.json` and runs trials from that data. Core does not walk native Workbench task package directories or Harbor directories to decide what a trial means.

## Staged Filesystem

Every trial receives a minimal filesystem:

- `/workspace`: the mutable working directory used by the subject and scorer.
- `/tests`: verifier-only files, injected after the subject run.
- `/logs`: shared log root used by test-based scorers and Harbor-style reward files.
- `/workspace/output`: adapter output directory for `workbench-result.json` and inspectable metadata.

Adapter commands receive `WORKBENCH_ADAPTER_REQUEST`, which points to the operation request JSON, `WORKBENCH_OUTPUT`, which points to `/workspace/output`, and `WORKBENCH_RESULT`, which points to the expected `workbench-result.json` path.

Operation visibility is exact:

| Operation | Visible paths | Required result value |
| --- | --- | --- |
| `subject.improve` | subject files plus traces | subject patch |
| `subject.run` | mutable working directory with subject files and task `files/` | `null` or omitted value |
| `trial.score` | same mutated working directory plus `/tests` and `/logs` | Workbench scorecard |

Verifier files are not present during the subject run. This preserves the hidden-data boundary while allowing the scorer to inspect the real final filesystem state.

No runtime operation receives benchmark/subject/optimizer YAML as source files. Adapter commands receive only the standard request JSON through `WORKBENCH_ADAPTER_REQUEST`. Auth material is scoped to the adapter invocation being executed.

Source references are resolved before staging:

- Omitted `benchmark.tasks` reads the default `tasks/` directory through the built-in `path` adapter's `tasks.resolve` operation. Explicit task-source `with.path` values, `benchmark.environment.dockerfile`, and adapter sources are literal paths relative to the YAML file that declares them.
- Subject files are declared with `files.path`, normally `files` next to the selected `subject.yaml`.
- `optimizer.edits[]` entries are literal paths inside that subject `files/` directory.
- Workbench uses the whole subject files directory and the whole resolved `TaskBundle`. At runtime, bundle public files are subject-visible, verifier files are scorer-only, and solution files are oracle-only.
- `improve`, `run`, and `score` identify adapters by `use`; all adapter-specific settings, including optional first-party `instructions`, live under `with`.
- Adapter manifest `slots` point at nested adapter-shaped values under `with` and declare the required operation so Workbench can include sources, collect/default auth, and validate nested adapter support. They do not automatically execute nested adapters; the parent adapter owns any delegation behavior.

## Outputs

Every adapter operation writes `/workspace/output/workbench-result.json` with protocol `workbench.adapter-result.v1`:

```json
{
  "protocol": "workbench.adapter-result.v1",
  "operation": "trial.score",
  "ok": true,
  "value": {
    "score": 0.82,
    "metrics": {
      "format_similarity": 0.82,
      "criterion__required_tables": 1
    },
    "summary": "Matched required tables and headings; missed footer formatting.",
    "cases": [
      {
        "id": "task",
        "status": "completed",
        "metrics": { "format_similarity": 0.82 }
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

Result values are operation-specific:

- `tasks.resolve`: `{ "tasks": [...] }` plus optional task environment defaults.
- `subject.run`: `null` or omitted `value`.
- `trial.score`: a Workbench scorecard. `score` is required and must be finite.
- `subject.improve`: a subject patch with `files`, required `fileChanges`, and optional `summary`.

Scorecard fields:

- `score`: required numeric metric.
- `metrics`: optional additional numeric metrics. Keys prefixed with `criterion__` render as criteria metrics.
- `summary`: optional short human-readable result.
- `cases`: optional task-level results, feedback, and criterion scores. Case status is operational: use `completed` for a valid scorecard and `error` only for scorer/runtime errors.
- `feedback`: optional structured JSON for diagnostics.

The built-in `tests` scorer may read Harbor-style reward files under `/logs/verifier` internally before publishing the standard adapter result:

- `/logs/verifier/reward.json`, preferably with `reward` or `score`
- `/logs/verifier/reward.txt`, containing a finite numeric reward

If an operation command exits non-zero, Workbench marks the execution failed. Scoring also fails when no valid `trial.score` result value is present. The built-in `command` scorer is strict: a successful shell command must still publish `workbench-result.json` for `trial.score`.

## Inspectable Artifacts

If a generated report, normalized text dump, screenshot, workbook, or debug file should be inspectable after the trial, write it into the working directory or adapter output during the subject run. The scorer sees the same mutated environment, and Workbench records visible artifacts with the trial evidence.

A practical pattern is:

1. Subject creates the primary output and any supporting summaries in the working directory.
2. Tests or rubric scorer compares the final state against `/tests` and task criteria.
3. Scorer writes `workbench-result.json` with a scorecard value.

## Command Shape

Prefer checked-in subject scripts and Dockerfile-pinned tools. Operation commands execute from the operation working directory. Put task dependencies in the environment Dockerfile instead of installing them during every evaluation job; adapter runtime dependencies belong in adapter `setup` commands.

```yaml
# subjects/codex/subject.yaml
run:
  use: codex
  with:
    instructions: Run python run.py in the staged workspace.
```

```yaml
# benchmark.yaml
score:
  use: tests
```

Use shell glue only inside adapter-owned operation commands when it genuinely clarifies the operation.

## Adapter Request

External adapter commands read a single request file:

```json
{
  "protocol": "workbench.adapter.v2",
  "id": "exec_run_case_sample",
  "jobId": "job_exec_run_case_sample",
  "operation": "subject.run",
  "invocation": {
    "use": "my-agent",
    "with": { "mode": "strict" }
  },
  "context": {
    "benchmark": { "name": "example", "description": "Example benchmark" },
    "subject": { "id": "subject_current", "path": "subjects/my-agent/files" },
    "trial": { "trialIndex": 0, "sampleIndex": 0, "caseId": "task-001" },
    "task": { "text": "Task text from task.yaml" }
  },
  "paths": {
    "workspace": "/workspace",
    "cwd": "/workspace",
    "output": "/workspace/output",
    "result": "/workspace/output/workbench-result.json",
    "subject": "/workspace/input/subject",
    "tests": "/tests",
    "logs": "/logs"
  }
}
```

The request carries adapter-specific `with` data and optional resolved auth, but the output rules do not change. A single adapter implementation may support multiple operations by branching on `operation`.

Env-backed auth is injected as the manifest-declared environment variables for the matching operation. File-backed auth is materialized under a private per-execution root and listed in the request `auth` object with `filesRoot` plus the declared relative file names. The executing adapter keeps the short `auth.default` or `auth.<slot>` convenience shape; every materialized bundle is also namespaced under `auth.adapters[adapterId][slot]` so adapter slots cannot collide. Adapters should read only the env vars or files declared by their own manifest.
