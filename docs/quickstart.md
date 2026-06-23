# Quickstart

Create a skill, evaluate it with one case, inspect the evidence, improve from that evidence, and publish the result.

## What You'll Build

By the end of this path you have:

- a local Workbench skill project
- one representative eval case
- one recorded eval run
- a result you can inspect
- a published handle you can install or clone

## Prerequisites

- Node.js and npm available locally.
- A provider login such as Codex or Claude for provider-backed evals.
- Workbench Cloud login only when you publish or run hosted operations.

## Install

```bash
npm install -g @workbench-ai/workbench
workbench --help
```

The CLI command is `workbench`. Provider-backed evals also need the provider CLI login for the agent you use, such as Codex or Claude.

## Create A Skill

```bash
workbench new ./earnings-prep
cd ./earnings-prep
```

Edit `SKILL.md` so it describes the workflow the agent should perform. Replace the generated trigger description, Inputs, Workflow, Output, and Quality Bar TODOs before treating eval results as evidence about the real workflow.

## Add One Case

Create a representative workflow case:

```bash
workbench case draft investor-focus
```

Edit `.workbench/cases/investor-focus/case.yaml`. A provider-backed case can be as small as a prompt plus rubric criteria:

```yaml
version: 1
id: investor-focus
prompt: Create an earnings prep note for GOOGL.
grade:
  with:
    criteria:
      - id: investor-focus
        description: Explains the likely investor focus areas.
      - id: supported-facts
        description: Avoids claims not supported by the case context.
```

## Run And Review

```bash
workbench eval
workbench results
workbench show RUN_ID
```

Use `workbench run` when you want execution output before grading, `workbench grade` when you want to judge existing execution evidence, and `workbench eval` for the combined execute-plus-grade path.

## Improve

After below-perfect, failed, or reviewed evidence exists:

```bash
workbench improve
workbench eval
```

`improve` edits the skill package, proves the candidate with eval evidence, and switches only when the proof result beats the incumbent.

## Publish And Share

```bash
workbench login
workbench publish --public
```

The publish output prints the install command to share:

```bash
workbench install OWNER/SKILL
```

Use `workbench clone OWNER/SKILL ./local-copy` when someone needs editable source for future evals and improvements.

## Next Reading

- [Evals](evals.md) explains the project files.
- [Workflows](workflows.md) shows the common command paths.
- [CLI Reference](cli.md) explains command behavior and flags.
