# Execution Contract

Workbench compiles `benchmark.yaml`, a subject manifest, optional subject files, task packages, and optional optimizer YAML into generic executions. Eval runs create one `trial` per subject/task/sample. Improve runs create an `improve` execution that patches subject files, then evaluate the improved subject with trials.

A trial has one runtime environment. Workbench stages public task files and subject files, runs the subject adapter, injects verifier tests, runs the score adapter in the same mutated environment, and normalizes the scorecard. This is the single runtime model for both Workbench-native tasks and Harbor-shaped tasks.

Built-in `codex`, `claude`, `pi`, and `command` adapters can run subjects. Built-in `rubric`, `tests`, and `command` adapters can score trials. External adapters, including project-declared overrides for built-in ids, run through the same `workbench.adapter.v1` request and output contract inside the composed Dockerfile environment declared by `benchmark.environment.dockerfile` plus adapter setup.

During hosted execution, command phases and agent adapters may publish live `job_progress` event batches before the terminal job output exists. These batches are best-effort UI progress and trace deltas. The completed job output remains the authoritative subject patch or scorecard.

Adapters may report execution usage on the completed job. Provider-reported cost is authoritative. When the provider does not report cost, Workbench estimates from its checked-in LiteLLM price snapshot using the exact model string emitted by the adapter.

## Staged Filesystem

Every trial receives a minimal filesystem:

- `/workspace`: the mutable working directory used by the subject and scorer.
- `/tests`: verifier-only files, injected after the subject run.
- `/logs`: shared log root used by test-based scorers and Harbor-compatible reward files.
- `/workspace/output`: adapter output directory for scorecards and metadata.

Adapter commands receive `WORKBENCH_ADAPTER_REQUEST`, which points to the phase request JSON, and `WORKBENCH_OUTPUT`, which points to `/workspace/output`. Simple command adapter users can ignore those helpers and work in the current directory directly.

Phase visibility is exact:

| Phase | Visible paths | Required output |
| --- | --- | --- |
| `improve` | subject files plus traces | `/workspace/output/candidate_patch.json` |
| trial runner | mutable working directory with subject files and task `files/` | mutations and optional artifacts |
| trial scorer | same mutated working directory plus `/tests` and `/logs` | `/workspace/output/scorecard.json` or Harbor-style reward file |

Verifier files are not present during the subject run. This preserves the hidden-data boundary while allowing the scorer to inspect the real final filesystem state.

No runtime phase receives benchmark/subject/optimizer YAML as source files. Adapter commands receive only the standard request JSON through `WORKBENCH_ADAPTER_REQUEST`. Auth material is scoped to the adapter invocation being executed.

Source references are resolved before staging:

- `benchmark.tasks`, `benchmark.environment.dockerfile`, and adapter sources are literal paths relative to the YAML file that declares them.
- Subject files are the sibling `files/` directory next to the selected `subject.yaml`.
- `optimizer.edits[]` entries are literal paths inside that subject `files/` directory.
- Workbench uses the whole subject files directory and the whole task package. At runtime, `files/` is subject-visible, `tests/` is scorer-only, and `solution/` is oracle-only.
- `improve`, `run`, and `score` identify adapters by `use`; all adapter-specific settings, including optional first-party `instructions`, live under `with`.
- Adapter manifest `refs` point at nested adapter-shaped values under `with` so Workbench can include sources and collect/default auth. They do not automatically execute nested adapters; the parent adapter owns any delegation behavior.

## Outputs

`candidate_patch.json` describes changes to subject files:

```json
{
  "files": [
    {
      "path": "run.py",
      "content": "print('updated')\n",
      "encoding": "utf-8"
    }
  ],
  "fileChanges": ["run.py"],
  "summary": "Updated runner behavior."
}
```

`fileChanges` is required and must list the changed subject-relative paths. The filename remains `candidate_patch.json` in adapter protocol v1 for existing adapter interoperability.

`scorecard.json` is the scorer result. `score` is required and must be finite.

```json
{
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
}
```

Fields:

- `score`: required numeric metric.
- `metrics`: optional additional numeric metrics. Keys prefixed with `criterion__` render as criteria metrics.
- `summary`: optional short human-readable result.
- `tasks`: optional task-level results, feedback, and criterion scores. Case status is operational: use `completed` for a valid scorecard and `error` only for scorer/runtime errors.
- `feedback`: optional structured JSON for diagnostics.

The `tests` scorer also accepts Harbor-compatible outputs:

- `/logs/verifier/reward.json`, preferably with `reward` or `score`
- `/logs/verifier/reward.txt`, containing a finite numeric reward

Adapters may write optional internal metadata to `/workspace/output/.workbench/result.json`:

```json
{
  "ok": true,
  "summary": "Completed.",
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
  },
  "feedback": {
    "adapter": "acme"
  }
}
```

This file is how external adapters report summary text, structured feedback, token usage, and provider cost without adding YAML fields.

If a phase exits non-zero, Workbench marks the execution failed. Scoring also fails when no valid scorecard or reward file is present.

## Inspectable Artifacts

If a generated report, normalized text dump, screenshot, workbook, or debug file should be inspectable after the trial, write it into the working directory or adapter output during the subject run. The scorer sees the same mutated environment, and Workbench records visible artifacts with the trial evidence.

A practical pattern is:

1. Subject creates the primary output and any supporting summaries in the working directory.
2. Tests or rubric scorer compares the final state against `/tests` and task criteria.
3. Scorer writes a scorecard or reward file.

## Command Shape

Prefer checked-in subject scripts and Dockerfile-pinned tools. Command phases have one command string and execute from the trial working directory. Put task dependencies in the environment Dockerfile instead of installing them during every evaluation job; adapter runtime dependencies belong in adapter `setup` commands.

```yaml
# subjects/command/subject.yaml
run:
  use: command
  with:
    command: python run.py
```

```yaml
# benchmark.yaml
score:
  use: tests
```

Use shell glue only inside the single command when it genuinely clarifies the phase.

## Adapter Request

External adapter commands read a single request file:

```json
{
  "protocol": "workbench.adapter.v1",
  "execution": {
    "purpose": "trial",
    "role": "runner",
    "candidateId": "subject_current",
    "trialIndex": 0,
    "sampleIndex": 0,
    "caseId": "task-001"
  },
  "adapter": {
    "use": "my-agent",
    "with": { "mode": "strict" }
  },
  "task": { "text": "Task text from task.yaml" },
  "paths": {
    "workspace": "/workspace",
    "cwd": "/workspace",
    "output": "/workspace/output",
    "subject": "/workspace/input/candidate",
    "tests": "/tests",
    "logs": "/logs",
    "scorecard": "/workspace/output/scorecard.json"
  }
}
```

The request carries adapter-specific `with` data and optional resolved auth, but the output rules do not change. A single adapter implementation may support improve, runner, scorer, or task-source capabilities by branching on `execution.purpose`, `execution.role`, and manifest capabilities.

Env-backed auth is injected as the manifest-declared environment variables for the matching execution. File-backed auth is materialized under a private per-execution root and listed in the request `auth` object with `filesRoot` plus the declared relative file names. The executing adapter keeps the short `auth.default` or `auth.<slot>` convenience shape; every materialized bundle is also namespaced under `auth.adapters[adapterId][slot]` so nested adapter refs cannot collide. Adapters should read only the env vars or files declared by their own manifest.
