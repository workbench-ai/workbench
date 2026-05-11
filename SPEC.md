# Workbench Spec

Workbench is a local-first benchmark workbench built on three public primitives:

- Subject: the thing being evaluated or improved. A subject can be files, a command wrapper, or agent/model configuration.
- Trial: one subject attempt on one task in one mutable environment.
- Scorecard: the normalized score, metrics, feedback, traces, and artifacts for a trial.

The core runtime is generic. Harbor enters only through adapters: `tasks.use: harbor` resolves Harbor-shaped task directories into Workbench task packages, and `score.use: tests` runs verifier tests in the same mutated environment.

## Source Shape

```text
benchmark.yaml
subjects/<name>/subject.yaml
subjects/<name>/files/        # optional
optimizers/<name>.yaml        # optional
tasks/<case>/task.yaml
tasks/<case>/files/           # public seed files copied into the trial cwd
tasks/<case>/tests/           # verifier-only files injected before scoring
```

`benchmark.yaml`:

```yaml
version: 2
name: tiny-terminal
description: Evaluate terminal subjects.
tasks: tasks
environment:
  dockerfile: environment/Dockerfile
score:
  use: tests
```

`subjects/<name>/subject.yaml`:

```yaml
version: 2
name: command subject
run:
  use: command
  with:
    command: "printf '42\n' > answer.txt"
```

`tasks/<case>/task.yaml`:

```yaml
task: Write the answer to answer.txt.
```

Harbor task-source adapter:

```yaml
version: 2
name: harbor-terminal
description: Run subjects on a local Harbor dataset.
tasks:
  use: harbor
  with:
    path: ../harbor-dataset
score:
  use: tests
```

The Harbor adapter maps `instruction.md`, `task.toml`, `environment/`, `tests/`, and `solution/` into normalized Workbench task packages. Workbench does not call `harbor run` in its core runtime.

## Trial Lifecycle

For each subject/task/sample, Workbench:

1. Starts one environment from the benchmark or task Dockerfile.
2. Copies task `files/` and subject files into the current working directory.
3. Runs the subject adapter in that working directory.
4. Injects task `tests/` at `/tests` and creates `/logs`.
5. Runs the score adapter in the same mutated environment.
6. Reads `scorecard.json`, `/logs/verifier/reward.json`, or `/logs/verifier/reward.txt` and records a Workbench scorecard.

Verifier files are not present during the subject run. This keeps hidden expected data private while preserving Harbor-style same-environment verification.

## CLI Surface

```bash
workbench init [DIR] --command NAME
workbench check [SOURCE] [--dir DIR] [--json]
workbench eval [SOURCE] [--dir DIR] [--subject ID] [--samples N] [--json]
workbench improve [SOURCE] [--dir DIR] [--from SUBJECT_ID] [--optimizer OPTIMIZER_YAML] [--budget N] [--samples N] [--json]
workbench subjects list|show|files|preview ...
workbench open [SOURCE] [--dir DIR] [--no-open] [--json]
```

Internal archives still preserve historical candidate ids for older local state and hosted compatibility, but the authored model and CLI guidance are subject/trial/scorecard.
