---
name: workbench
description: Create, evaluate, improve, inspect, version, sync, and publish Workbench-managed Agent Skills with the `workbench` CLI.
---

# Workbench

Workbench turns Agent Skills into evaluated, versioned workflows. Use it to create a skill, define eval cases, run and grade them with agents, inspect evidence, improve from failures or review notes, and publish installable source.

Assume the user is working in a repository where you can edit files and run commands. Keep workflow-specific instructions in the skill package. Use Workbench for eval source, package versions, agents, runs, traces, artifacts, lineage, Cloud sync, publishing, and read-only inspection.

Load only the reference docs needed for the task. Prefer [Common workflows](references/docs/workflows.md) for task paths and [CLI reference](references/docs/cli.md) for exact syntax.

## Default loop

Start with the smallest useful loop:

```bash
workbench new ./earnings-prep
cd ./earnings-prep
workbench case draft case-001
# edit .workbench/cases/case-001/case.yaml
workbench eval --agents default -n 1
workbench results
workbench show RUN_ID
```

`workbench new` creates `SKILL.md`, `.workbench/eval.yaml`, `.workbench/agents.yaml`, `.workbench/environment/Dockerfile`, and an empty `.workbench/cases/` directory. Add at least one representative case before running `run`, `grade`, or `eval`.

`run` records output without grading. `grade` judges existing output without rerunning the skill. `eval` runs both phases. Pass `--rerun` only when you need fresh evidence.

## Build an eval from a prompt

Run one prompt, inspect the output, then add or tune judgment criteria:

```bash
workbench new ./earnings-prep --agent codex --model gpt-5.4-mini
cd ./earnings-prep
codex login --device-auth
workbench login codex --method oauth
workbench case draft investor-focus
# edit .workbench/cases/investor-focus/case.yaml with the prompt
workbench run --agents default --cases investor-focus
workbench show RUN_ID
workbench show EXECUTE_JOB_ID
# add or edit grade.with.criteria in .workbench/cases/investor-focus/case.yaml
workbench grade --agents default --cases investor-focus
workbench show GRADE_JOB_ID
# edit grade.with.criteria again
workbench grade --agents default --cases investor-focus
workbench grade --agents default --cases investor-focus --rerun
workbench eval --agents default --cases investor-focus
```

## Evaluation source

Workbench keeps eval source under `.workbench/**` and installable package source outside it:

- `SKILL.md`: the current skill instructions.
- `.workbench/eval.yaml`: global grading config and shared criteria.
- `.workbench/cases/<case-id>/case.yaml`: workflow inputs and case-specific grading.
- `.workbench/cases/<case-id>/tests/test.sh`: optional local or command-backed shell test.
- `.workbench/agents.yaml`: agent and model configuration.
- `.workbench/environment/Dockerfile`: sandbox dependencies.
- `.workbench/versions.yaml`: optional measured versions, no-skill baselines, and included skills.

Editing `.workbench/**` changes the mutable eval draft. Editing package files outside `.workbench/**` changes the mutable skill draft that Workbench versions, evaluates, improves, and publishes. A real run, grade, or eval snapshots new eval draft content as `Eval vN` and new package draft content as `Skill vN`; identical content reuses the existing version.

Provider-backed cases can be prompt plus grading criteria. Local and command-backed cases need a top-level `command` or an executable `tests/test.sh`. Draft placeholders block launch until the prompt and required grading criteria are filled.

## Agents and selectors

Use agents to compare runtime configurations:

```bash
workbench agent add strict --adapter command --with command='sh "$CASE_DIR/tests/test.sh"'
codex login --device-auth
workbench login codex --method oauth
workbench agent add default --adapter codex --model gpt-5.4-mini --with auth=default
workbench eval --agents all -n 1
workbench evals
workbench results --agents all --versions all
workbench results --eval eval-v1
workbench results --eval all
```

`local` and `command` agents run case tests directly. `codex` and `claude` agents run provider-backed skill execution and then grade the same cases through the configured grader. Workbench passes provider `model` values through to the adapter; for Claude, use a Claude Code alias such as `opus` or `sonnet`, or a full Claude Code model id.

Use selector flags only when the user wants a broader or narrower selected set:

```bash
workbench eval --versions all --agents all -n 1
workbench results --versions all --agents all
workbench results --eval current
workbench results --eval eval-v2
workbench eval --agents default --cases investor-focus
```

`workbench results` defaults to the current eval version. Use `workbench evals` to list stored eval versions and `--eval eval-vN` when case, test, rubric, or environment edits changed the score meaning.

## Improve from evidence

Run `workbench improve` after below-perfect, failed, or reviewed graded evidence exists:

```bash
workbench results
workbench show RUN_ID
workbench improve --versions current --agents default --budget 1 -n 1
workbench results
```

Perfect-only projects need better cases, stricter criteria, or higher sample counts before improvement is useful. `improve` edits package source outside `.workbench/**`, proves the candidate with eval evidence, and switches only when the proof succeeds and beats the current version. After a one-sample proof switches source, run a higher-sample eval before publishing.

Review candidate changes before publishing:

```bash
workbench log
workbench versions
workbench diff <base-version-id>..<candidate-version-id>
workbench show RUN_ID
```

Improvement changes package source, not eval source. Treat `.workbench/**` changes as eval changes unless the user explicitly asked to change the grading standard.

## Inspect results and files

Use read-only commands to inspect state, results, versions, and evidence:

```bash
workbench status
workbench log
workbench versions
workbench results
workbench show RUN_ID
workbench show JOB_ID
workbench show RUN_ID:cases/investor-focus/output/result.json
workbench diff <base-version-id>..<candidate-version-id>
workbench switch <version-id> --dry-run
workbench switch <version-id> --yes
workbench open
```

`results` shows recorded scorecards across versions, agents, cases, and samples. `show REF` reads run, job, trace, artifact, source, and file evidence. `show REF:PATH` prints one file inside a version, run, job, trace, or artifact. If a suffix is ambiguous, Workbench prints exact `workbench show REF:PATH` commands.
Use `switch VERSION --dry-run` before materializing a saved version. If the dry run reports that unsaved local package source would be overwritten, pass `--yes` only after reviewing the change list.

Use `watch RUN_ID` for an active or detached run, `cancel RUN_ID` to request cancellation without deleting evidence, and `retry RUN_ID` to start a new whole-run attempt from the selected run's stored plan.

The browser UI reads the same inspection data as CLI commands. It shows source files, eval source, results, run details, job timelines, and output files without changing project state. Traces are underlying evidence records for timelines, raw debugging, review, and case promotion.

## Publish, install, clone, and Cloud

Publish source through Workbench Cloud when the skill is ready to share:

```bash
workbench login
workbench publish --private
workbench publish --team
workbench publish --public
workbench publish --as OWNER/SKILL
```

The default visibility is private. `--team` publishes an organization skill when the project is linked to an organization namespace. `--public` exposes installable public source. Publishing source does not grant access to full project evidence.

Hand off one of these commands after publishing:

```bash
workbench install OWNER/SKILL
workbench install OWNER/SKILL@VERSION
workbench clone OWNER/SKILL ./local-copy
```

Use `install` when the recipient needs only the Agent Skill package in their agent. Use `clone` when they need editable source, evals, and future improvement loops. External Agent Skill sources can still install through Workbench, but Workbench-only features such as clone, eval evidence, improvement lineage, and Cloud visibility do not apply.

Use hosted operations only when the project and organization plan support them:

```bash
workbench run --cloud
workbench grade --cloud
workbench eval --cloud
workbench improve --cloud
workbench watch RUN_ID
```

Hosted compute requires Workbench Cloud login, provider auth for provider-backed agents, and an organization-owned Cloud skill under an active Team or Enterprise plan. Press Ctrl-C once during an attached wait to detach; the run continues, and the next command is `workbench watch RUN_ID`.

Use `workbench sync cloud` as an explicit repair or portability command for local package source or evidence changes. It is not the normal way to follow a run.

Use `workbench unpublish VERSION` to remove one installable source version. Use `workbench delete OWNER/SKILL --yes` only for whole-project cleanup, such as disposable validation handles.

## File artifacts

When a workflow creates Office files, PDFs, or tabular exports, load [File formats](references/docs/file-formats.md) before designing cases or grading criteria. Put generated outputs and diagnostics under `/workspace/output`, put runtime tools in `.workbench/environment/Dockerfile`, and use structured parsers or rendered previews depending on what the case needs to judge.

For `.xlsx`, use spreadsheet parsers for workbook structure and LibreOffice/`soffice` when formula recalculation, PDF conversion, or visual fidelity matters. For `.docx` and `.pptx`, parse structure for content checks and render when layout matters. For `.pdf`, prefer text extraction for born-digital PDFs and rendered page images for layout checks.

## What belongs in the skill layer

Keep these tasks in the skill layer unless Workbench core support is required:

- discovering cases from conversations or traces
- drafting `.workbench/cases/*` files
- drafting grading criteria
- choosing examples
- writing workflow-specific checks
- deciding whether evidence is strong enough to improve or publish

## References

Load only what is needed:

- `references/docs/workflows.md` for common command paths.
- `references/docs/cli.md` for command syntax.
- `references/docs/evals.md` for evaluation basics and the run/grade/eval loop.
- `references/docs/cases-grading.md` for case files, grading criteria, and shell tests.
- `references/docs/agents-models.md` for agents, model labels, selectors, samples, and provider auth.
- `references/docs/file-formats.md` when cases or outputs involve `.xlsx`, `.docx`, `.pptx`, `.pdf`, or similar files.
- `references/docs/improve.md` when turning evidence into a candidate skill version.
- `references/docs/improve-review.md` when reviewing candidate diffs, proof evidence, and source boundaries.
- `references/docs/improve-rerun.md` when rerunning proof evals or retrying stored run plans.
- `references/docs/track.md` when reading result scorecards.
- `references/docs/track-runs-jobs.md` when inspecting run lifecycle state or job evidence.
- `references/docs/track-files.md` when inspecting artifacts, captured outputs, exact files, or low-level trace records.
- `references/docs/track-versions.md` when inspecting versions, lineage, diffs, or switching.
- `references/docs/share.md` when publishing source.
- `references/docs/install-clone.md` when installing packages or cloning editable source.
- `references/docs/visibility-cloud.md` when managing visibility, sync, unpublish/delete, login, or hosted operations.
