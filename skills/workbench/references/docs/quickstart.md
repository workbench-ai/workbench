# Quickstart

Build a measured skill. Create a project, add one eval case, run it, review the evidence, improve, and publish.

## What you'll build

This guide creates:

- a local Workbench skill project
- one representative eval case
- one recorded eval run
- evidence you can inspect
- a published handle you can install or clone

## Prerequisites

- Node.js and npm
- Provider login for provider-backed evals, such as Codex or Claude
- Workbench Cloud login when you publish or run hosted operations

## Install

```bash
npm install -g @workbench-ai/workbench
workbench --help
```

Provider-backed evals also need the provider CLI login for the agent you use.

## Create a skill

```bash
workbench skill new ./earnings-prep
cd ./earnings-prep
```

Edit `SKILL.md` so it describes the workflow the agent should perform. Replace the generated trigger description, inputs, workflow, output, and quality criteria before treating eval results as meaningful evidence.

## Add one case

Create a representative case:

```bash
workbench eval case draft investor-focus
```

Edit `.workbench/cases/investor-focus/case.yaml`. A provider-backed case can be as small as a prompt plus grading criteria:

```yaml
prompt: Create an earnings prep note for GOOGL.
grade:
  with:
    criteria:
      - id: investor-focus
        description: Explains the likely investor focus areas.
      - id: supported-facts
        description: Avoids claims not supported by the case context.
```

## Run and review

```bash
workbench eval run
workbench eval grade
workbench eval list
workbench eval results
workbench eval show RUN_ID
```

`workbench eval run` records output before grading. `workbench eval grade` judges existing output. Workbench keeps the two actions explicit so you can iterate on prompts and judgment independently.
`workbench eval list` lists eval identities, including the current draft and immutable historical eval versions created from authored eval source.

## Improve

After below-perfect, failed, or reviewed evidence exists:

```bash
workbench skill improve
workbench eval run
workbench eval grade
```

`improve` edits the skill package, proves the candidate with eval evidence, and switches only when the proof beats the current version.

## Publish and share

```bash
workbench login
workbench skill publish --public
```

The publish output prints the install command to share:

```bash
workbench skill install OWNER/SKILL
```

Use `workbench skill clone OWNER/SKILL ./local-copy` when the recipient needs editable source, evals, and future improvements.

## Next steps

- [Evaluation basics](evals.md) explains the project files.
- [Cases and grading](cases-grading.md) explains cases and grading criteria.
- [Agents and models](agents-models.md) explains agent and model setup.
- [Improve from evidence](improve.md) explains evidence-driven changes.
- [Results](track.md) explains scorecards.
- [Publish](share.md) explains source publication.
- [CLI reference](cli.md) lists command syntax and flags.
