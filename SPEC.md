# Workbench Spec

Workbench is a local-first benchmark system with optional Workbench Cloud remotes. The model is intentionally close to git plus GitHub: local projects can be run, inspected, checkpointed, pushed, pulled, cloned, forked, and starred; hosted execution and hosted resource inspection live under `workbench cloud`.

## Public Concepts

- Workbench project: a directory containing `benchmark.yaml`, `candidates/<name>/candidate.yaml`, optional `optimizers/<name>.yaml`, tasks, environment files, and local `.workbench/` state.
- Benchmark: the comparable task/environment/grading contract in `benchmark.yaml`.
- Benchmark fingerprint: the comparability boundary. Candidates from different benchmark fingerprints are not compared as peers.
- Candidate: one runner manifest plus mounted files at `candidates/<name>/files/`.
- Optimizer: optional improve configuration used to create child candidates.
- Run: chronological evidence for running tasks, grading tasks, or improving candidates.
- Remote: a Workbench Cloud origin used by `clone`, `fetch`, `pull`, and `push`.

## YAML Shape

`benchmark.yaml` owns tasks, environment, adapter sources, and grading:

```yaml
version: 1
name: invoice-review
description: Evaluate invoice review behavior.
tasks: tasks
environment:
  dockerfile: environment/Dockerfile
grade:
  use: rubric
  with:
    judge:
      use: codex
```

`candidates/<name>/candidate.yaml` owns how to run the candidate. Candidate files are implied by the sibling `files/` directory.

```yaml
version: 1
name: Codex
run:
  use: codex
  with:
    instructions: Use /workspace/input/candidate and write outputs to /workspace/output.
```

`optimizers/<name>.yaml` owns candidate-relative edit paths and improve behavior:

```yaml
version: 1
name: Codex optimizer
edits:
  - SKILL.md
improve:
  use: codex
```

## CLI Surface

```bash
workbench init [DIR] --skill NAME --agent ADAPTER [--from PATH] [--example] [--json]
workbench init [DIR] --pipeline NAME --agent ADAPTER [--from PATH] [--example] [--json]
workbench init [DIR] --command NAME [--from PATH] [--example] [--json]
workbench check [SOURCE] [--dir DIR] [--json]
workbench adapters create PATH [--dir DIR] [--json]
workbench adapters list [--dir DIR] [--json]
workbench adapters inspect ID [--dir DIR] [--json]
workbench adapters test ID|SOURCE [--dir DIR] [--request PATH] [--output DIR] [--json]
workbench eval [SOURCE] [--dir DIR] [--candidate ID] [--samples N] [--json]
workbench improve [SOURCE] [--dir DIR] [--from CANDIDATE_ID] [--optimizer OPTIMIZER_YAML] [--budget N] [--samples N] [--json]
workbench open [SOURCE] [--dir DIR] [--host HOST] [--port N] [--no-open] [--json]
workbench checkpoint [--dir DIR] [--json]
workbench restore [--dir DIR] [--candidate ID] [--dry-run] [--yes] [--json]
workbench runs list [--dir DIR] [--json]
workbench runs show RUN_ID [--dir DIR] [--json]
workbench candidates list [--dir DIR] [--json]
workbench candidates show CANDIDATE_ID [--dir DIR] [--json]
workbench candidates files [--dir DIR] [--candidate ID] [--json]
workbench candidates preview --path PATH [--dir DIR] [--candidate ID] [--output PATH|-] [--json]
workbench login [--base-url URL] [--no-open] [--json]
workbench logout [--json]
workbench whoami [--dir DIR] [--json]
workbench clone OWNER/BENCHMARK[@REF] [DIR] [--dry-run] [--json]
workbench remote show [--dir DIR] [--json]
workbench remote add origin OWNER/BENCHMARK[@REF] [--dir DIR] [--json]
workbench remote set-url origin OWNER/BENCHMARK[@REF] [--dir DIR] [--json]
workbench remote remove origin [--dir DIR] [--json]
workbench fetch [--dir DIR] [--json]
workbench pull [--dir DIR] [--dry-run] [--json]
workbench push [SOURCE] [--dir DIR] [--tag TAG] [--visibility public|private] [--dry-run] [--json]
workbench cloud fork OWNER/BENCHMARK[@REF] [NAME] [--json]
workbench cloud star OWNER/BENCHMARK [--json]
workbench cloud unstar OWNER/BENCHMARK [--json]
workbench cloud eval [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--base CANDIDATE_ID] [--samples N] [--watch] [--dry-run] [--json]
workbench cloud improve [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--base CANDIDATE_ID] [--optimizer OPTIMIZER_YAML] [--budget N] [--samples N] [--watch] [--dry-run] [--json]
workbench cloud open [OWNER/BENCHMARK[@REF]|RUN_ID|CANDIDATE_ID] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--no-open] [--json]
workbench cloud watch RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--interval-ms N] [--timeout-ms N] [--json]
workbench cloud logs RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]
workbench cloud benchmarks|runs|candidates <command> [options]
workbench auth connect ADAPTER[/SLOT] [--dir DIR] [--method METHOD] [--profile PROFILE] [--profile-root DIR] [--local-only] [--json]
workbench auth disconnect ADAPTER[/SLOT] [--profile PROFILE] [--local-only] [--json]
```

## Behavior

`workbench eval` runs the selected candidate locally, records task and grading evidence under `.workbench/runtime`, and makes the evaluated candidate active.

`workbench improve` improves the current candidate by default. If the parent has no eval evidence for the current benchmark fingerprint, Workbench runs an eval first. `--from` selects an explicit parent.

`workbench open` starts the local read-only Workbench UI and keeps serving it until stopped.

`workbench push` creates or updates a hosted benchmark version from local source and writes `.workbench/origin.json`. `workbench fetch` downloads remote source to `.workbench/fetch` without changing project files. `workbench pull` updates managed project files from the origin.

`workbench adapters test` validates an adapter manifest. With `--request`, it locally replays the adapter command against a `workbench.adapter.v1` request fixture and checks phase-required outputs.

`workbench cloud eval` and `workbench cloud improve` are the hosted execution entrypoints. Hosted resource inspection, candidate visibility, logs, and cancellation stay under `workbench cloud`.

## Browser

Workbench Cloud is benchmark-first. The master pane is benchmark-owned and shows benchmark version selection plus Overview, Manifest, and Files. Candidate tabs show local or hosted candidates, results, lineage, and runs for the selected benchmark fingerprint. Candidate detail owns Evaluation, Manifest, and Files.
