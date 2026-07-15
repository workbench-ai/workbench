# Evaluation basics

Use evals to decide whether a skill performs its workflow well enough to ship. Define the grading standard under `.workbench/**`; Workbench records versions, runs, jobs, traces, artifacts, scores, and lineage around it.

See [Cases and grading](cases-grading.md) for case authoring, [Agents and models](agents-models.md) for agent setup, and [File formats](file-formats.md) for Office, PDF, and other file artifacts.

## Mental model

| Layer | Files | Purpose |
| --- | --- | --- |
| Skill package | `SKILL.md`, `scripts/`, `references/`, `assets/`, `dist/**`, support files | Installable source that agents use. |
| Eval definition | `.workbench/eval.yaml` | Default grading policy (`none` in new projects) and shared grading config. |
| Cases | `.workbench/cases/<case-id>/case.yaml` | Inputs, grader-specific files, and optional case-level grader overrides. |
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

`workbench skill new` creates an empty `.workbench/cases/` directory. Add at least one case before you run an eval.

## First eval loop

```bash
workbench skill new ./earnings-prep
cd ./earnings-prep
workbench eval case draft investor-focus
# edit .workbench/cases/investor-focus/case.yaml
workbench eval run --agents default --cases investor-focus
workbench eval grade --agents default --cases investor-focus
workbench eval run --agents default -n 1 --rerun
workbench eval grade --agents default --rerun
workbench eval results
```

`run` records output without grading. `grade` judges existing recorded output without rerunning it. Workbench intentionally has no combined run-and-grade command.

`eval run --dry-run` and `eval grade --dry-run` preview their selectors, cases, package state, environment, reusable evidence, and launch checks without writing state. Their corresponding real commands use the same launch checks.

## Eval versions

Each execution snapshots the current eval draft into an immutable eval version when the eval source content is new. Editing `.workbench/eval.yaml`, case files, case tests, or environment files changes the current draft immediately; the next real `eval run` or `eval grade` records that draft as `Eval vN`. If the content matches an existing eval version, Workbench reuses that version instead of minting another ordinal.

Eval versions are global source history; run and grade reuse is local to each cell. A stored job remains current for a later eval version only when its phase-specific effective input hash matches the selected package version, case, configuration, agent, sample, environment, and grader inputs. Editing grade-only inputs therefore creates a new eval version and `Needs grade` cells without rerunning compatible output.

Use `workbench eval list` to list eval identities, including the current draft even before it has result evidence. `workbench eval results` selects the current eval by default, `workbench eval results --eval eval-v1` inspects an older score meaning, and `workbench eval results --eval all` explicitly inspects all eval versions without treating their scores as one flat ranking.

Sources are not run or job evidence. A Source can ingest local agent sessions or another adapter's records, then produce human-reviewed workflows and read-only evidence-grounded insights. Insights help a user shape the objective; an Eval draft captures only selected kept workflows and their exact evidence. Applying that draft writes ordinary portable Eval files; it does not start a run. Eval execution traces remain separate span, usage, and artifact evidence.

Source-derived Eval drafts are immutable review objects, not mutable Eval definitions. The Evals index keeps ready drafts actionable and retains applied or discarded drafts as inspectable decisions. Apply checks the destination base hash and never starts a run; `workbench eval discard DRAFT_ID --yes` rejects a ready proposal without deleting its diff, citations, usage, or audit status.

## Skill instructions

Keep the Skill package self-contained. A Workbench-published package follows the [Agent Skills package](https://agentskills.io/specification) shape, so `SKILL.md` points to the scripts, references, and assets the agent needs.

The installable skill package stays outside `.workbench/**`. The eval source measures that package but is not copied by `workbench skill install`.

## Next steps

- [Cases and grading](cases-grading.md) explains case files, global grading, case-specific criteria, shell tests, and draft gates.
- [Agents and models](agents-models.md) explains `.workbench/agents.yaml`, model labels, auth profiles, selectors, and samples.
- [File formats](file-formats.md) explains runtime tools and grading checks for Office, PDF, and similar artifacts.
- [Results](track.md) explains how to read recorded eval outcomes.
