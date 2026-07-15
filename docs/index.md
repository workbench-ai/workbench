# Workbench Docs

Workbench mines reviewed workflows from Sources, turns them into Evals, and uses those Evals to improve and publish versioned [Agent Skills](https://agentskills.io/home).

## Choose a path

| Goal | Start here |
| --- | --- |
| Ingest evidence and discover workflows | [Sources](sources.md) |
| Build your first measured skill | [Quickstart](quickstart.md) |
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
| Publish a Skill package | [Publish](share.md) |
| Install or clone a skill | [Install and clone](install-clone.md) |
| Manage visibility and hosted operations | [Visibility and Cloud](visibility-cloud.md) |
| Look up command behavior | [CLI reference](cli.md) |
| Understand installable skill packages | [Skill packages](skills.md) |

## Core concepts

| Concept | Meaning |
| --- | --- |
| Source | An ingested evidence corpus with immutable snapshots, grounded workflow Analyses, and explicit human review. |
| Eval | The grading standard for a workflow: cases, grading config, agents, and runtime environment source under `.workbench/`. |
| Skill | A standards-compliant [Agent Skill](https://agentskills.io/specification) package with `SKILL.md` plus support files. |

Runs are Eval evidence; package versions and handles are Skill lifecycle records, not additional product roots.

## Daily loop

```bash
workbench skill new ./earnings-prep
cd ./earnings-prep
workbench eval case draft investor-focus
workbench eval run
workbench eval grade
workbench eval results
workbench skill improve
workbench skill publish
```

Start with [Quickstart](quickstart.md), then use the pages above for the Source, Eval, or Skill work you need to finish.
