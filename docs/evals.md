# Evaluation basics

Use evals to decide whether a skill performs its workflow well enough to ship. Define the grading standard under `.workbench/**`; Workbench records versions, runs, jobs, traces, artifacts, scores, and lineage around it.

See [Cases and rubrics](cases-rubrics.md) for case authoring, [Agents and models](agents-models.md) for agent setup, and [File formats](file-formats.md) for Office, PDF, and other file artifacts. [Common workflows](workflows.md) maps tasks to command paths.

## Mental model

| Layer | Files | Purpose |
| --- | --- | --- |
| Skill package | `SKILL.md`, `scripts/`, `references/`, `assets/`, `dist/**`, support files | Installable source that agents use. |
| Eval definition | `.workbench/eval.yaml` | Global grading adapter and shared criteria. |
| Cases | `.workbench/cases/<case-id>/case.yaml` | Inputs and case-specific grading overrides. |
| Agents | `.workbench/agents.yaml` | Agent and model configuration for runs. |
| Runtime | `.workbench/environment/Dockerfile` | Project-owned sandbox dependencies. |

Editing `.workbench/**` changes the eval. Editing files outside `.workbench/**` changes the package that Workbench versions, evaluates, improves, and publishes.

## Starter layout

```text
SKILL.md
.workbench/eval.yaml
.workbench/cases/
.workbench/agents.yaml
.workbench/environment/Dockerfile
.workbench/.gitignore
```

`workbench new` creates an empty `.workbench/cases/` directory. Add at least one case before you run an eval.

## First eval loop

```bash
workbench new ./earnings-prep
cd ./earnings-prep
workbench case draft investor-focus
# edit .workbench/cases/investor-focus/case.yaml
workbench run --agents default --cases investor-focus
workbench grade --agents default --cases investor-focus
workbench eval --agents default -n 1
workbench results
```

`run` records output before you finalize grade criteria. `grade` judges existing output. `eval` combines both steps.

`eval --dry-run` previews selectors, cases, samples, package source status, environment file, reusable evidence, and launch checks without writing state. Real `run`, `grade`, and `eval` use the same launch checks.

## Skill instructions

Keep the skill package self-contained. Workbench-published source follows the [Agent Skills package](https://agentskills.io/specification) shape, so `SKILL.md` points to the scripts, references, and assets the agent needs.

The installable skill package stays outside `.workbench/**`. The eval source measures that package but is not copied by `workbench install`.

## Next steps

- [Cases and rubrics](cases-rubrics.md) explains case files, global grading, case-specific criteria, shell tests, and draft gates.
- [Agents and models](agents-models.md) explains `.workbench/agents.yaml`, model labels, auth profiles, selectors, and samples.
- [File formats](file-formats.md) explains runtime tools and grading checks for Office, PDF, and similar artifacts.
- [Results](track.md) explains how to read recorded eval outcomes.
