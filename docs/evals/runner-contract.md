# Execution Contract

Workbench compiles `benchmark.yaml`, a candidate manifest, sibling candidate files, and optional optimizer YAML into improve, run-task, and grade-task executions. Hosted Workbench stores each executable node as one durable `execute` job with a `purpose` of `improve`, `run-task`, or `grade-task`.

Eval runs record `run-task` followed by `grade-task`. Improve runs record `improve`, `run-task`, and `grade-task` chronologically for each trial. Improve executions run once per trial and write a candidate patch. Run-task executions use the current candidate and one current task to write ordinary output files. Grade-task executions score the immutable run output files mounted from the run-task phase. Rubric grading uses one grade execution per run sample; the judge prompt contains the full rubric and the runtime validates that every criterion receives a score and rationale. Built-in `codex`, `claude`, `pi`, `command`, and `rubric` adapters are shipped as first-party adapter manifests and commands. External adapters run through the same `workbench.adapter.v1` request and output contract inside the composed Dockerfile environment declared by `benchmark.environment.dockerfile` plus adapter setup.

During hosted execution, command phases and agent harnesses may publish live `job_progress` event batches before the terminal job output exists. These batches are best-effort UI progress and trace deltas. The completed job output remains the authoritative candidate patch, runner files, or scorecard.

Adapters may report execution usage on the completed job. Provider-reported cost is authoritative. When the provider does not report cost, Workbench estimates from its checked-in LiteLLM price snapshot using the exact model string emitted by the adapter. Evaluation result cost is run plus grade cost per sample; candidate total cost also includes improve cost. Hosted billing uses completed job usage as an input to the configured Workbench hosted execution service fee. Users still pay the harness provider directly through their adapter auth. Workbench credit applies only to the Workbench hosted execution service fee and can be funded by the signup grant or Stripe top-ups.

## Staged Filesystem

Every execution receives a minimal filesystem:

- `/workspace/input/<name>`: read-only declared phase inputs.
- `/workspace/output`: writable output directory.

Adapter commands receive `WORKBENCH_ADAPTER_REQUEST`, which points to the phase request JSON, and `WORKBENCH_OUTPUT`, which points to `/workspace/output`. Simple command adapter users can ignore those helpers and read from the mounted paths directly.

Phase visibility is exact:

| Purpose | Visible inputs | Required output |
| --- | --- | --- |
| `improve` | `/workspace/input/candidate`, `/workspace/input/traces` | `/workspace/output/candidate_patch.json` |
| `run-task` | `/workspace/input/candidate`, `/workspace/input/task/input` | one or more non-internal files under `/workspace/output` |
| `grade-task` | `/workspace/input/task/input`, `/workspace/input/task/expected`, `/workspace/input/runner-output` | `/workspace/output/scorecard.json` |

No phase receives benchmark/candidate/optimizer YAML or `task.yaml` as a mounted file. `task.yaml` is parsed by Workbench as control-plane task text; command runners that need detailed task instructions should receive them as ordinary public files such as `/workspace/input/task/input/request.md`. No phase receives a broad archive, YAML source, job JSON, prompt file, optional support directory, or reward file. Adapter commands receive only the standard request JSON through `WORKBENCH_ADAPTER_REQUEST`. Inputs are read-only and mutations under `/workspace/input` are ignored.

This boundary is an authoring contract, not a scoring shortcut. Put only real workflow inputs under `input/`; put goldens, expected values, hidden rubrics, and task-specific grader code for intentional command graders under `expected/`. Runners should not be instructed to inspect `expected/`, and graders should not reward output that merely proves the runner copied private targets.

Agent prompt text is intentionally thin. Improve executions receive the benchmark description, candidate root, traces root, edit paths, and candidate patch output contract. First-party agent run adapters use adapter-owned `run.with.instructions`, candidate/task/output roots, and the rule that non-internal `/workspace/output` files are persisted for grading and inspection. The first-party rubric grade adapter uses adapter-owned `grade.with.instructions`, the active criterion list, task and runner-output roots, and the minimal score-plus-criteria JSON contract; Workbench wraps that result into `scorecard.json`. File contents are not interpolated into phase prompts; agents and commands inspect the mounted folders directly.

`/workspace/input/traces` is improve-only. It contains Workbench-provided generic event streams and job summaries, plus any completed trace files already emitted under `.workbench/traces/`. Runner and grader phases never receive this folder.

Source references are resolved before these directories are staged:

- `benchmark.tasks`, `benchmark.environment.dockerfile`, and adapter sources are literal paths relative to the YAML file that declares them.
- Candidate files are the sibling `files/` directory next to the selected `candidate.yaml`.
- `optimizer.edits[]` entries are literal paths inside that candidate `files/` directory.
- Workbench uses the whole candidate files directory and the whole tasks directory. At runtime, task files are projected by convention: `input/` is runner-visible, `expected/` is grader-only, and root task files other than `task.yaml` are invalid. There are no include globs.
- `improve`, `run`, and `grade` identify adapters by `use`; all adapter-specific settings, including optional first-party `instructions`, live under `with`.

## Outputs

`candidate_patch.json` describes changes to candidate files:

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

`fileChanges` is required and must list the changed candidate-relative paths.

Run-task executions do not write a user-facing manifest. Any non-internal file under `/workspace/output` is persisted, mounted into graders at `/workspace/input/runner-output`, and shown in the Files tab for inspection. Internal control files such as `.workbench/**`, `candidate_patch.json`, `scorecard.json`, sandbox metadata, command stdout/stderr logs, and exit-code files are filtered from the user-facing file set.

`scorecard.json` is the grader result. `score` is required and must be finite.

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
- `tasks`: optional task-level results, feedback, and criterion scores. Case status is operational: use `completed` for a valid scorecard and `error` only for grader/runtime errors. Low scores and criteria with `pass: false` stay in metrics and criteria, not case status. File inspection is handled by the runner output file set, not by case-level file references.
- `feedback`: optional structured JSON for diagnostics.

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

This file is how external adapters report summary text, structured feedback, token usage, and provider cost without adding YAML fields. Workbench assigns usage from the execution purpose.

If any phase exits non-zero, Workbench marks the execution failed. Command improve and grade-task executions also fail when the required phase JSON is missing or invalid. Run-task executions fail when they publish no non-internal files.

## Inspectable Files

If a generated report, normalized text dump, screenshot, workbook, or debug file should be inspectable after the run, write it into `/workspace/output` from the runner. Do not create a separate manifest to describe it. Workbench forwards those files to the grader at `/workspace/input/runner-output` and exposes the same file set in the browser.

A practical pattern is:

1. Runner creates the primary output and any supporting summaries under `/workspace/output`.
2. Rubric graders compare `/workspace/input/runner-output` against `/workspace/input/task/input`, `/workspace/input/task/expected`, and rubric criteria.
3. Command graders write `scorecard.json` only when the score is deterministic or wraps an existing scorer; rubric graders return score plus criterion results and the adapter writes the standard scorecard.

## Command Shape

Prefer checked-in runner scripts and Dockerfile-pinned tools. Command phases have one command string and always execute from `/workspace`; there are no Workbench `prepare`, `cwd`, or custom `env` fields. Grade commands are intentionally narrower than run commands: they see only public task input, grader-only expected files, and runner output files, so put task-specific grader code under `tasks/<case>/expected/` or bake reusable grader code into the Docker image. Use command grading only for deterministic checks or an existing scorer. For qualitative scoring, keep extraction and normalization in runner output files or expected files, then use a rubric grader.

```yaml
environment:
  dockerfile: environment/Dockerfile
run:
  use: command
  with:
    command: python /workspace/input/candidate/run.py
grade:
  use: command
  with:
    command: python /workspace/input/task/expected/grade.py
```

Use shell glue only inside the single command when it genuinely clarifies the phase. Put task dependencies in the environment Dockerfile instead of installing them during every evaluation job; adapter runtime dependencies belong in adapter `setup` commands.

## Adapter Request

External adapter commands read a single request file:

```json
{
  "protocol": "workbench.adapter.v1",
  "execution": {
    "purpose": "run-task",
    "role": "runner",
    "candidateId": "candidate_current",
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
    "input": "/workspace/input",
    "output": "/workspace/output",
    "candidate": "/workspace/input/candidate",
    "task": "/workspace/input/task",
    "runnerOutput": "/workspace/input/runner-output",
    "traces": "/workspace/input/traces"
  }
}
```

The request carries adapter-specific `with` data and optional resolved auth, but the phase output rules do not change. A single adapter implementation may support improve, run-task, grade-task, or any subset by branching on `execution.purpose`.

Env-backed auth is injected as the manifest-declared environment variables for the matching execution. File-backed auth is materialized under a private per-execution root and listed in the request `auth` object with `filesRoot` plus the declared relative file names. The executing adapter keeps the short `auth.default` or `auth.<slot>` convenience shape; every materialized bundle is also namespaced under `auth.adapters[adapterId][slot]` so nested adapter refs cannot collide. Adapters should read only the env vars or files declared by their own manifest.
