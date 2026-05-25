# From Existing Workflow

Use this path when there is already a script, test suite, benchmark command, Harbor task set, or manual scoring process. The goal is to wrap that workflow in the Workbench engine/subject/optimizer contract without changing it more than needed.

## Process

1. Identify the command that already produces output files or pass/fail signals.
2. Put mutable files under `subjects/<name>/files/`.
3. Put public fixtures under `tasks/<case>/files/` and hidden expected outputs, tolerances, or task-specific verifier scripts under `tasks/<case>/tests/`.
4. Add `prepare.command` when the workflow files must be copied into `/workspace`; keep reusable workflow behavior in subject files and read public case inputs from `/workspace/input/case`.
5. Reuse the existing deterministic scoring workflow through the built-in Workbench engine's `tests` helper when one exists, or use rubric scoring when the workflow output needs qualitative review. Rubric scoring runs one judge turn per criterion; set `score.with.parallelism` to throttle those turns.
6. Validate the source, push the benchmark when needed, and run one eval sample from the subject directory.

## Adapter Pattern

The subject runner can preserve the existing workflow command. A verifier script translates its result into the reward file consumed by the built-in Workbench engine's `tests` scoring helper:

```python
import json
import subprocess
from pathlib import Path

workspace = Path.cwd()
completed = subprocess.run(
    ["python", "scripts/check.py"],
    cwd=workspace,
    text=True,
    capture_output=True,
)

(workspace / "workflow-result.json").write_text(json.dumps({
    "exitCode": completed.returncode,
    "stdout": completed.stdout[-4000:],
    "stderr": completed.stderr[-4000:],
}), encoding="utf8")
```

Put task-specific scoring logic under `tasks/<case>/tests/test.sh` or a helper called by it. The `tests` scoring helper runs after the subject run in the child sandbox owned by the built-in Workbench engine, with verifier files staged under `/workspace/private/engine`. If `engine.with.grading.isolation: separate` is set, the helper runs in a grader child sandbox seeded with the runner workspace and output artifacts:

```sh
#!/bin/sh
set -eu
verifier_output="${WORKBENCH_TESTS_VERIFIER_DIR:-/workspace/output/.workbench/internal/verifier}"
mkdir -p "$verifier_output" /workspace/output
python /workspace/private/engine/score_workflow.py
```

```python
import json
import os
from pathlib import Path

workflow_result = json.loads(Path("workflow-result.json").read_text())
score = 1.0 if workflow_result["exitCode"] == 0 else 0.0
verifier_output = Path(os.environ.get("WORKBENCH_TESTS_VERIFIER_DIR", "/workspace/output/.workbench/internal/verifier"))
verifier_output.mkdir(parents=True, exist_ok=True)
(verifier_output / "reward.json").write_text(json.dumps({
    "reward": score,
    "summary": "Existing workflow reached full score." if score == 1.0 else "Existing workflow scored below full credit.",
    "feedback": workflow_result,
}, indent=2), encoding="utf8")
```

## Spec

# benchmark.yaml
```yaml
version: 3
name: existing-workflow
description: Evaluate whether the existing workflow wrapper completes representative tasks and emits scoreable output.
engine:
  use: workbench
  with:
    environment:
      dockerfile: environment/Dockerfile
    score:
      use: tests
```

This native task layout uses the built-in `workbench` engine. Omitting `engine.with.tasks` makes the engine read the default `tasks/` directory; use `engine.with.tasks.path` only for a non-default task directory.

# subjects/codex/subject.yaml
```yaml
version: 3
name: existing-workflow
files:
  path: files
prepare:
  command: sh input/subject/prepare.sh
run:
  use: codex
  with:
    model: gpt-5.4-mini
```

# optimizers/codex.yaml
```yaml
version: 3
name: existing-workflow-optimizer
edits:
  - scripts/run_existing_workflow.py
improve:
  use: codex
  with:
    model: gpt-5.4-mini
```

Put the subject script at `subjects/codex/files/scripts/run_existing_workflow.py`, and add `subjects/codex/files/prepare.sh`:

```sh
#!/usr/bin/env sh
set -eu
cp -R input/subject/. .
```

Run the smoke loop with `workbench eval subjects/codex --samples 1` before using `workbench improve subjects/codex --optimizer optimizers/codex.yaml --budget 1 --samples 1`.

Use [runner-contract.md](runner-contract.md) to keep the engine attempt outputs valid.
