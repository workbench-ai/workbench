# Workbench

Create skill-first evals by default, use rubric grading for qualitative scoring, use pipeline or advanced command evals when clearly appropriate, and configure, run, inspect, sync, and export Workbench benchmarks and candidates with workbench.

This repository is a generated public skill for AI coding agents. It follows the [Agent Skills](https://agentskills.io) format with `SKILL.md` at the repository root.

## Installation

```bash
npx skills add workbench-ai/workbench
```

## Use When

- Verifying or installing the published `@workbench-ai/workbench` package before using Workbench Cloud
- Scaffolding ambiguous candidates with `workbench init --skill NAME --agent ADAPTER`, using `workbench init --pipeline NAME --agent ADAPTER` when the pipeline is clearly the candidate, and using `workbench init --command NAME` only when the command-line implementation itself is the candidate
- Authoring split Workbench benchmark, candidate, and optional optimizer YAML from existing workflows or file-output tasks with benchmark environment Dockerfiles, rubric grading by default, and command grading only for deterministic scoring contracts
- Pushing hosted benchmark source from `benchmark.yaml` with `workbench push --tag v1` and `.workbench/origin.json`
- Cloning, starring, and forking public benchmarks addressed as `owner/name[@ref]`
- Running local candidates such as `candidates/claude` with `workbench eval` and `workbench improve`
- Starting hosted eval and improve workflows with `workbench cloud`, watching completion, inspecting candidate files, and exporting selected candidates
- Keeping the local Workbench UI open in an embedded browser with `workbench open --json --no-open` while an agent drives the CLI

## Structure

`SKILL.md` is the installable skill. Supporting directories such as `agents/`, `references/`, and `evals/` are included only when declared by the authored product skill.
