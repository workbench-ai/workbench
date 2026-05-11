# From Existing Workflow

Use this path when there is already a script, test suite, benchmark command, Harbor task set, or manual scoring process. The goal is to wrap that workflow in the Workbench subject/trial/scorecard contract without changing it more than needed.

## Process

1. Identify the command that already produces output files or pass/fail signals.
2. Put mutable files under `subjects/<name>/files/`.
3. Put public fixtures under `tasks/<case>/files/` and hidden expected outputs, tolerances, or task-specific verifier scripts under `tasks/<case>/tests/`.
4. Write a subject command that executes the existing workflow from the trial working directory.
5. Reuse the existing deterministic scorer as a tests or command scorer when one exists, or use a rubric scorer when the workflow output needs qualitative review.
6. Validate the source, push the benchmark when needed, and run one eval sample from the subject directory.

## Adapter Pattern

The subject runner can preserve the existing command. A test script translates its result into Workbench scorecard JSON:

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

Put task-specific scoring logic under `tasks/<case>/tests/test.sh` or a helper called by it. The `tests` scorer runs after the subject run in the same mutated environment:

```sh
#!/bin/sh
set -eu
mkdir -p /logs/verifier /workspace/output
python /tests/score_workflow.py
```

```python
import json
from pathlib import Path

workflow_result = json.loads(Path("workflow-result.json").read_text())
score = 1.0 if workflow_result["exitCode"] == 0 else 0.0
(Path("/workspace/output") / "scorecard.json").write_text(json.dumps({
    "score": score,
    "summary": "Existing workflow reached full score." if score == 1.0 else "Existing workflow scored below full credit.",
    "feedback": workflow_result,
}, indent=2), encoding="utf8")
```

## Spec

# benchmark.yaml
```yaml
version: 2
name: existing-workflow
description: Evaluate whether the existing workflow wrapper completes representative tasks and emits scoreable output.
tasks: tasks
environment:
  dockerfile: environment/Dockerfile
score:
  use: tests
```

# subjects/command/subject.yaml
```yaml
version: 2
name: existing-workflow
run:
  use: command
  with:
    command: python scripts/run_existing_workflow.py
```

# optimizers/command.yaml
```yaml
version: 2
name: existing-workflow-optimizer
edits:
  - scripts/run_existing_workflow.py
improve:
  use: command
  with:
    command: python -c "import json; from pathlib import Path; p=Path('/workspace/input/candidate/scripts/run_existing_workflow.py'); content=p.read_text().rstrip() + '\n# Workbench subject revision.\n'; Path('/workspace/output/candidate_patch.json').write_text(json.dumps({'files':[{'path':'scripts/run_existing_workflow.py','content':content,'encoding':'utf-8'}],'fileChanges':['scripts/run_existing_workflow.py']}), encoding='utf-8')"
```

Put the subject script at `subjects/command/files/scripts/run_existing_workflow.py`.

Run the smoke loop with `workbench eval subjects/command --samples 1` before using `workbench improve subjects/command --optimizer optimizers/command.yaml --budget 1 --samples 1`.

Use [runner-contract.md](runner-contract.md) to keep the trial outputs valid.
