# Workbench Docs

Workbench turns [Agent Skills](https://agentskills.io/home) into evaluated, versioned workflows. Create a skill, define eval cases, run and grade them with agents, improve from evidence, and publish installable source.

## Choose a path

| Goal | Start here |
| --- | --- |
| Build your first measured skill | [Quickstart](quickstart.md) |
| Choose a task path | [Common workflows](workflows.md) |
| Learn the eval source model | [Evaluation basics](evals.md) |
| Author cases and grading | [Cases and grading](cases-grading.md) |
| Configure agents and models | [Agents and models](agents-models.md) |
| Choose tools for Office, PDF, and other file artifacts | [File formats](file-formats.md) |
| Improve from failed or below-perfect evidence | [Improve from evidence](improve.md) |
| Review candidate changes | [Review candidate changes](improve-review.md) |
| Rerun proof evidence | [Rerun proof evals](improve-rerun.md) |
| Inspect results | [Results](track.md) |
| Follow runs and jobs | [Runs and jobs](track-runs-jobs.md) |
| Inspect traces, artifacts, and files | [Traces, artifacts, and files](track-files.md) |
| Review versions and lineage | [Versions and lineage](track-versions.md) |
| Publish source | [Publish](share.md) |
| Install or clone a skill | [Install and clone](install-clone.md) |
| Manage visibility and hosted operations | [Visibility and Cloud](visibility-cloud.md) |
| Look up command behavior | [CLI reference](cli.md) |
| Understand installable skill packages | [Skill packages](skills.md) |

## Core concepts

| Concept | Meaning |
| --- | --- |
| Skill | A standards-compliant [Agent Skill](https://agentskills.io/specification) package with `SKILL.md` plus support files. |
| Eval | The grading standard for a workflow: cases, grading config, agents, and runtime environment source under `.workbench/`. |
| Run | Recorded evidence: run state, jobs, traces, artifacts, result items, and score summaries. |
| Package version | The exact skill source Workbench evaluated, improved, or published. |
| Handle | A published identifier such as `acme/earnings-prep`, used for install and clone handoffs. |

## Daily loop

```bash
workbench new ./earnings-prep
cd ./earnings-prep
workbench case draft investor-focus
workbench eval
workbench results
workbench improve
workbench publish
```

Start with [Quickstart](quickstart.md). Use [Common workflows](workflows.md) when you already know the task you want to finish.
