---
name: workbench
description: Ingest Sources, create and run Evals, and improve, inspect, version, sync, or publish Agent Skills with the `workbench` CLI.
---

# Workbench

Workbench turns grounded evidence into reviewed workflows, Evals, and versioned Agent Skills. Use it to ingest Sources, keep or dismiss grounded candidates, create Evals with explicit human judgment, run and grade them, improve from evidence, and publish installable Skills.

Assume the user is working in a repository where you can edit files and run commands. Keep workflow-specific instructions in the skill package. Use Workbench for eval source, package versions, agents, runs, traces, artifacts, lineage, Cloud sync, publishing, and read-only inspection.

Load only the reference docs needed for the task. Prefer [Sources](references/docs/sources.md), [Evals](references/docs/evals.md), or [Skills](references/docs/skills.md) for product behavior and [CLI reference](references/docs/cli.md) for exact syntax.

## Default loop

Start with the smallest useful loop:

```bash
workbench skill new ./earnings-prep
cd ./earnings-prep
workbench eval grader
workbench eval case draft case-001
# use --grader rubric|tests|command when this case should override the eval default
# edit .workbench/cases/case-001/case.yaml
workbench eval run --agents default -n 1
workbench eval grade --agents default
workbench eval results
workbench eval show RUN_ID
```

`workbench skill new` creates `SKILL.md`, `.workbench/eval.yaml`, `.workbench/agents.yaml`, `.workbench/environment/Dockerfile`, and an empty `.workbench/cases/` directory. Add at least one representative case before running or grading.

`eval run` records output without grading. `eval grade` judges existing output without rerunning the Skill. Run the two commands in sequence for a complete Eval. Pass `--rerun` only when you need fresh evidence.

## Build an eval from a prompt

Run one prompt, inspect the output, then add or tune judgment criteria:

```bash
workbench skill new ./earnings-prep --agent codex
cd ./earnings-prep
workbench login codex
workbench eval case draft investor-focus
# edit .workbench/cases/investor-focus/case.yaml with the prompt
workbench eval run --agents default --cases investor-focus
workbench eval show RUN_ID
workbench eval show EXECUTE_JOB_ID
# add or edit the resolved grader inputs for the case
workbench eval grade --agents default --cases investor-focus
workbench eval show GRADE_JOB_ID
# edit the grader inputs again
workbench eval grade --agents default --cases investor-focus
workbench eval grade --agents default --cases investor-focus --rerun
workbench eval run --agents default --cases investor-focus
workbench eval grade --agents default --cases investor-focus
```

## Evaluation source

Workbench keeps eval source under `.workbench/**` and installable package source outside it:

- `SKILL.md`: the current skill instructions.
- `.workbench/eval.yaml`: default grading adapter and shared grading config.
- `.workbench/cases/<case-id>/case.yaml`: workflow inputs, grader config, and optional case-level grader overrides.
- `.workbench/cases/<case-id>/tests/test.sh`: tests-backed shell grader.
- `.workbench/agents.yaml`: agent and model configuration.
- `.workbench/environment/Dockerfile`: sandbox dependencies.
- `.workbench/versions.yaml`: optional measured versions, no-skill baselines, and included skills.

Editing `.workbench/**` changes the mutable Eval draft. Editing package files outside `.workbench/**` changes the mutable Skill draft that Workbench versions, evaluates, improves, and publishes. A real `eval run` or `eval grade` snapshots new Eval draft content as `Eval vN` and new package draft content as `Skill vN`; identical content reuses the existing version.

Cases inherit the eval default grader unless `case.yaml` sets `grade.adapter`. New projects default the eval grader to `none`, so a case is run-only until the eval or case selects `rubric`, `tests`, or `command`. `workbench eval case draft CASE_ID --grader rubric|tests|command` creates an explicit override. Rubric-backed cases can be prompt plus grading criteria. Tests-backed cases need an executable `tests/test.sh`. Command-backed cases need `grade.with.command`. Draft placeholders block launch until the prompt and required grader inputs are filled for cases that have a grader.

Use `workbench eval grader` to inspect the current default grader. Use `workbench eval grader set ADAPTER` with `--authoring key=value`, `--authoring-json JSON`, or `--authoring-file FILE` to update `.workbench/eval.yaml`; that file contains only `grade.adapter` and optional adapter-owned `grade.with` config.

## Agents and selectors

Use agents to compare runtime configurations:

```bash
workbench eval agent add strict --adapter command --with command='sh "$CASE_DIR/tests/test.sh"'
workbench login codex
workbench eval agent add default --adapter codex --with auth=default
workbench eval run --agents all -n 1
workbench eval grade --agents all
workbench eval list
workbench eval results --agents all --versions all
workbench eval results --eval eval-v1
workbench eval results --eval all
```

`local` and `command` agents run case tests directly. Harness-backed adapters run provider work and then grade the same cases through the configured grade adapter. Omit `model` to use the adapter's current default; an explicit model label is opaque adapter configuration.

Use selector flags only when the user wants a broader or narrower selected set:

```bash
workbench eval run --versions all --agents all -n 1
workbench eval grade --versions all --agents all
workbench eval results --versions all --agents all
workbench eval results --eval current
workbench eval results --eval eval-v2
workbench eval run --agents default --cases investor-focus
workbench eval grade --agents default --cases investor-focus
```

`workbench eval results` defaults to the current eval, including a current draft that has not been run yet. Use `workbench eval list` to list eval identities and `--eval eval-vN` when case, test, rubric, or environment edits changed the score meaning.

## Improve from evidence

Run `workbench skill improve` after below-perfect, failed, or reviewed graded evidence exists:

```bash
workbench eval results
workbench eval show RUN_ID
workbench skill improve --versions current --agents default --budget 1 -n 1
workbench eval results
```

Perfect-only projects need better cases, stricter criteria, or higher sample counts before improvement is useful. `workbench skill improve` edits package source outside `.workbench/**`, proves the candidate with eval evidence, and switches only when the proof succeeds and beats the current version. After a one-sample proof switches source, run a higher-sample eval before publishing.

Review candidate changes before publishing:

```bash
workbench skill versions
workbench skill diff <base-version-id>..<candidate-version-id>
workbench eval show RUN_ID
```

Improvement changes package source, not eval source. Treat `.workbench/**` changes as eval changes unless the user explicitly asked to change the grading standard.

## Inspect results and files

Use read-only commands to inspect state, results, versions, and evidence:

```bash
workbench skill show
workbench skill versions
workbench eval results
workbench eval show RUN_ID
workbench eval show JOB_ID
workbench eval show RUN_ID:cases/investor-focus/output/result.json
workbench skill diff <base-version-id>..<candidate-version-id>
workbench skill switch <version-id> --dry-run
workbench skill switch <version-id> --yes
workbench open
```

`eval results` shows recorded scorecards across versions, agents, cases, and samples. `eval show REF` reads Eval, run, job, execution trace, artifact, and file evidence. `skill show [REF[:PATH]]` reads current Skill/project/version state and package files. If a suffix is ambiguous, Workbench prints the exact owning command.
Use `workbench skill switch VERSION --dry-run` before materializing a saved version. If the dry run reports that unsaved local package source would be overwritten, pass `--yes` only after reviewing the change list.

Use `watch RUN_ID` for an active or detached run, `cancel RUN_ID` to request cancellation without deleting evidence, and `retry RUN_ID` to start a new whole-run attempt from the selected run's stored plan.

The browser UI reads the same inspection data as CLI commands. It shows source files, eval source, results, run details, job evidence transcripts, and output files without changing project state.

## Turn local sessions into reviewed Evals

Create a private Source for local Codex or Claude sessions, publish its current snapshot without running a model, then explicitly authorize analysis:

```bash
workbench login
workbench source add "Local Codex sessions" --adapter codex
workbench source sync SOURCE_ID
workbench source show SOURCE_ID
workbench source analyze SOURCE_ID --record-limit 1
# review the returned snapshot, locality, evidence-egress, token ceilings, and absolute cost ceiling; choose your own lower spend cap when appropriate
# choose an explicit spend cap, then rerun the same command with --confirm --max-cost USD and the returned --preflight-token; no executable default is generated
```

The adapter converts native sessions into bounded generic evidence segments. Source core does not assume that a record is a session, message thread, span, or task. Small local binding state keeps only deployment, namespace, and adapter identity; a separate atomic checkpoint keeps the committed cursor and resumable sync id. The LLM identifies task boundaries, workflows, and grounded insights from the complete selected evidence; deterministic code only validates transport, citations, bounds, and publication.

Use the Sources workspace to explore the resulting workflow taxonomy or optional hierarchical Map, inspect exact citations, and mark workflow leaves Keep or Dismiss. From the CLI, drill into the same generic data with `workbench source show SOURCE_ID --analysis ANALYSIS_ID --node NODE_ID`, page one workflow's grounded occurrences with `--workflow WORKFLOW_ID`, open one finding with `--insight INSIGHT_ID`, and read a returned citation with `workbench source evidence SOURCE_ID ANALYSIS_ID CITATION_ID`. Human review is required before Eval drafting. Insights are read-only evidence-grounded findings for shaping the objective; a draft captures only selected kept workflows and their exact evidence. Draft Eval first returns an explicit cost/egress preflight; applying a draft is a separate base-hash-guarded action and never starts an Eval run.

## Publish, install, clone, and Cloud

Publish source through Workbench Cloud when the skill is ready to share:

```bash
workbench login
workbench skill publish --private
workbench skill publish --team
workbench skill publish --public
workbench skill publish --as OWNER/SKILL
```

The default visibility is private. `--team` publishes an organization skill when the project is linked to an organization namespace. `--public` exposes installable public source. Publishing source does not grant access to full project evidence.

Hand off one of these commands after publishing:

```bash
workbench skill install OWNER/SKILL
workbench skill install OWNER/SKILL@VERSION
workbench skill clone OWNER/SKILL ./local-copy
```

Use `workbench skill install` when the recipient needs only the Agent Skill package in their agent. Use `workbench skill clone` when they need editable source, evals, and future improvement loops. External Agent Skill sources can still install through Workbench, but Workbench-only features such as clone, eval evidence, improvement lineage, and Cloud visibility do not apply.

Use hosted operations only when the project and organization plan support them:

```bash
workbench eval run --cloud
workbench eval grade --cloud
workbench skill improve --cloud
workbench watch RUN_ID
```

Hosted compute requires Workbench Cloud login, provider auth for provider-backed agents, and an organization-owned Cloud skill under an active Team or Enterprise plan. Press Ctrl-C once during an attached wait to detach; the run continues, and the next command is `workbench watch RUN_ID`.

Use `workbench skill sync cloud` as an explicit repair or portability command for local package source or evidence changes. It is not the normal way to follow a run.

Use `workbench skill unpublish VERSION` to remove one published package version. Use `workbench skill delete OWNER/SKILL --yes` only for whole-project cleanup, such as disposable validation handles.

## File artifacts

When a workflow creates Office files, PDFs, or tabular exports, load [File formats](references/docs/file-formats.md) before designing cases or grading criteria. Put generated outputs and diagnostics under `/workspace/output`, put runtime tools in `.workbench/environment/Dockerfile`, and use structured parsers or rendered previews depending on what the case needs to judge.

For `.xlsx`, use spreadsheet parsers for workbook structure and LibreOffice/`soffice` when formula recalculation, PDF conversion, or visual fidelity matters. For `.docx` and `.pptx`, parse structure for content checks and render when layout matters. For `.pdf`, prefer text extraction for born-digital PDFs and rendered page images for layout checks.

## What belongs in the skill layer

Keep these tasks in the skill layer unless Workbench core support is required:

- judging whether Source-derived workflows and insights are genuinely useful
- editing generated `.workbench/cases/*` files after an Eval draft is applied
- strengthening generated grading criteria with domain knowledge
- choosing examples
- writing workflow-specific checks
- deciding whether evidence is strong enough to improve or publish

## References

Load only what is needed:

- `references/docs/sources.md` for Source ingestion, analysis, review, and Eval drafting.
- `references/docs/cli.md` for command syntax.
- `references/docs/quickstart.md` for the shortest complete create-and-evaluate walkthrough.
- `references/docs/evals.md` for evaluation basics and the explicit run/grade loop.
- `references/docs/cases-grading.md` for case files, grading criteria, and shell tests.
- `references/docs/agents-models.md` for agents, model labels, selectors, samples, and provider auth.
- `references/docs/file-formats.md` when cases or outputs involve `.xlsx`, `.docx`, `.pptx`, `.pdf`, or similar files.
- `references/docs/improve.md` when turning evidence into a candidate skill version.
- `references/docs/improve-review.md` when reviewing candidate diffs, proof evidence, and source boundaries.
- `references/docs/improve-rerun.md` when rerunning proof evals or retrying stored run plans.
- `references/docs/track.md` when reading result scorecards.
- `references/docs/track-runs-jobs.md` when inspecting run lifecycle state or job evidence.
- `references/docs/track-files.md` when inspecting artifacts, exact files, or Eval run evidence.
- `references/docs/track-versions.md` when inspecting versions, lineage, diffs, or switching.
- `references/docs/share.md` when publishing source.
- `references/docs/install-clone.md` when installing packages or cloning editable source.
- `references/docs/skills.md` for authored skill source and installation boundaries.
- `references/docs/visibility-cloud.md` when managing visibility, sync, unpublish/delete, login, or hosted operations.
