# Evaluation basics

Use evals to decide whether a skill performs its workflow well enough to ship. Define the grading standard under `.workbench/**`; Workbench records versions, runs, jobs, traces, artifacts, scores, and lineage around it.

See [Cases and grading](cases-grading.md) for case authoring, [Agents and models](agents-models.md) for agent setup, and [File formats](file-formats.md) for Office, PDF, and other file artifacts. [Common workflows](workflows.md) maps tasks to command paths.

## Mental model

| Layer | Files | Purpose |
| --- | --- | --- |
| Skill package | `SKILL.md`, `scripts/`, `references/`, `assets/`, `dist/**`, support files | Installable source that agents use. |
| Eval definition | `.workbench/eval.yaml` | Global grading adapter and shared criteria. |
| Cases | `.workbench/cases/<case-id>/case.yaml` | Inputs and case-specific grading overrides. |
| Agents | `.workbench/agents.yaml` | Agent and model configuration for runs. |
| Runtime | `.workbench/environment/Dockerfile` | Project-owned sandbox dependencies. |

Editing `.workbench/**` changes the mutable eval draft. Editing package files outside `.workbench/**` changes the mutable skill draft that Workbench versions, evaluates, improves, and publishes.

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

## Eval versions

Each execution snapshots the current eval draft into an immutable eval version when the eval source content is new. Editing `.workbench/eval.yaml`, case files, case tests, or environment files creates a new draft; the next real `run`, `grade`, or `eval` records it as `Eval vN`. If the content matches an existing eval version, Workbench reuses that version instead of minting another ordinal.

Use `workbench evals` to list stored eval versions. `workbench results` selects the current eval version by default, `workbench results --eval eval-v1` inspects an older score meaning, and `workbench results --eval all` explicitly inspects all eval versions without treating their scores as one flat ranking.

Live captures use the same run/job evidence model as eval runs. `workbench record on` enables Workbench's native Codex and Claude Code trace plugins, project-matched captures appear in `Runs` as live agent-session jobs, and `workbench case promote TRACE_ID --id CASE_ID` turns a reviewed low-level trace into a normal case.

## Skill instructions

Keep the skill package self-contained. Workbench-published source follows the [Agent Skills package](https://agentskills.io/specification) shape, so `SKILL.md` points to the scripts, references, and assets the agent needs.

The installable skill package stays outside `.workbench/**`. The eval source measures that package but is not copied by `workbench install`.

## Next steps

- [Cases and grading](cases-grading.md) explains case files, global grading, case-specific criteria, shell tests, and draft gates.
- [Agents and models](agents-models.md) explains `.workbench/agents.yaml`, model labels, auth profiles, selectors, and samples.
- [File formats](file-formats.md) explains runtime tools and grading checks for Office, PDF, and similar artifacts.
- [Results](track.md) explains how to read recorded eval outcomes.
