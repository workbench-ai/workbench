# Workflows

Use this page when you know what you want to accomplish and need the shortest Workbench command path. Workbench still records internal run jobs, traces, and artifacts; this page uses "workflow" for the human task.

The pattern is the same across workflows: author source, run or grade cases, inspect evidence, then publish or improve when the result is ready. Detailed command semantics live in [CLI Reference](cli.md), eval source shape lives in [Evals](evals.md), and the full contract lives in [Spec](spec.md).

## Choose A Workflow

| Goal | Start with | Outcome |
| --- | --- | --- |
| Create a measured skill | `workbench new` | A local skill project with eval cases and recorded evidence. |
| Use a skill | `workbench install` | An agent-visible skill package in Codex or Claude. |
| Edit someone else's skill | `workbench clone` | Editable source in a fresh Workbench project. |
| Add evals to an existing skill | `workbench init` | Existing `SKILL.md` plus Workbench controls. |
| Build an eval interactively | `workbench run` then `workbench grade` | Prompt output and judgment evidence you can iterate on separately. |
| Review quality | `workbench eval` then `workbench results` | Score, latency, cost, and run evidence by version and agent. |
| Improve from evidence | `workbench improve` | Candidate source plus proof eval before switching. |
| Run hosted | `--cloud` | The same run graph executed by Workbench Cloud. |
| Understand what happened | `workbench show` | Source, run, job, trace, artifact, or file evidence. |

## Create And Publish A Skill

Use this when you have expertise you want other people or agents to run.

```bash
workbench new earnings-prep
cd earnings-prep
# edit SKILL.md and .workbench/cases/
workbench eval
workbench publish
```

`new` creates a brand-new Workbench skill project. It writes `SKILL.md`, `.workbench/eval.yaml`, `.workbench/agents.yaml`, `.workbench/environment/Dockerfile`, `.workbench/.gitignore`, ignored runtime directories, and an empty `.workbench/cases/` directory.

One-time setup is `workbench login` for Cloud publishing plus provider auth for provider-backed agents. The default publish visibility is private. Use `workbench publish --team` for an organization skill or `workbench publish --public` for public source.

After publish, hand off one of these commands:

```bash
workbench install acme/earnings-prep
workbench clone acme/earnings-prep earnings-prep
```

Use `install` when the recipient only needs the skill in their agent. Use `clone` when they need editable source, evals, and future improvements.

## Install Or Clone A Skill

Use this when someone gives you a Workbench `OWNER/SKILL` handle, a GitHub-hosted Agent Skill, or a local skill package.

```bash
workbench install test/workbench-smoke
workbench install https://github.com/vercel-labs/skills/tree/main/skills/find-skills
workbench skills
workbench clone test/workbench-smoke smoke
```

`install` checks plausible Workbench Cloud handles first. If a Workbench source is available, it installs with Workbench provenance and version identity. If the source is external, not found in Workbench Cloud, or cannot be checked because you are not logged in, it delegates to `skills add` and says the result is an external Agent Skill. Workbench-only features such as `clone`, eval evidence, improve lineage, and Workbench Cloud visibility do not apply to external installs.

`install` copies only the Agent Skills package: `SKILL.md`, scripts, references, assets, `dist/**`, and support files. It does not copy `.workbench` eval controls or runtime state. Re-running the same Workbench-managed install over an unchanged managed copy is idempotent. Add `--target codex` or `--target claude` when the current coding agent cannot be detected, and add `--scope global` when the package should be visible globally.

`skills` is read-only inventory. It scans configured Codex and Claude folder/global roots visible from the current directory and reports the current editable Workbench project when you are standing in one. It is not a general filesystem search.

`clone` creates editable source in a fresh Workbench project and remains Workbench-only. Use it when you want to evaluate, modify, or improve a published Workbench skill.

## Add Evals To An Existing Skill

Use this when you already have a useful `SKILL.md` folder.

```bash
workbench skills
cd PATH_TO_EXISTING_SKILL
workbench init
# edit .workbench/cases/
workbench eval
```

`init` adopts the current directory, requires `SKILL.md`, creates `.workbench/eval.yaml`, `.workbench/agents.yaml`, `.workbench/cases/`, and runtime state, and does not rewrite the package. It does not install, publish, clone, evaluate, improve, or generate cases.

## Design The Quality Bar

Use this when the question is "what should count as good?"

Workbench quality lives in `.workbench/**`, separate from installable package source:

```text
.workbench/eval.yaml
.workbench/cases/<case-id>/case.yaml
.workbench/agents.yaml
.workbench/environment/Dockerfile
```

A minimal provider-backed case is prompt plus rubric criteria:

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

Local or command-backed cases also need a top-level `command` or an executable `tests/test.sh`. Shell tests write their public result to `$OUTPUT_DIR/result.json`.

## Build An Eval From A Prompt

Use this when you want to run one prompt, inspect the output, then add or tune judgment criteria before grading.

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

`run` executes the selected case and records output without invoking the grade adapter. `grade` judges existing eligible execution evidence and never reruns the skill. `eval` is the combined path: it creates missing or stale execute work, then missing or stale grade work. Prompt, public case input, source, agent, and sample changes make execution stale; grade criteria and grader config make grading stale only.

## Review Results

Use this when you want the current answer to "is it good enough?"

```bash
workbench eval --dry-run
workbench run
workbench grade
workbench eval
workbench eval --agents all -n 5
workbench results
workbench results --versions all --agents all
```

`eval --dry-run` previews selectors, case count, sample count, source state, environment file, cacheability, and readiness without writing state. Real `run`, `grade`, and `eval` use the same readiness gate before scheduling. Draft prompts block `run`, `grade`, and `eval`; draft grade criteria block `grade` and `eval` but still allow output-only `run`.

Use `--rerun` only when you intentionally want fresh evidence:

```bash
workbench run --rerun
workbench grade --rerun
workbench eval --rerun
```

`results` is read-only over committed local Workbench state. It shows recorded evidence rows and keeps unrun selected rows out of human tables while preserving the selected matrix in JSON.

## Run Locally Or In Workbench Cloud

Use the same operation with `--cloud` when execution should happen in Workbench Cloud.

```bash
workbench run --cloud
workbench grade --cloud
workbench eval --cloud
workbench improve --cloud
workbench watch RUN_ID
workbench cancel RUN_ID
workbench retry RUN_ID
```

Hosted compute requires Workbench Cloud login, hosted provider auth for provider-backed agents, and an organization-owned Cloud skill under an active Team or Enterprise plan. Before Cloud accepts a run, progress is described as preparation. After acceptance, `watch`, `cancel`, and `retry` operate on the durable run id.

Press Ctrl-C once during an attached wait to detach. The run continues, and the next command is `workbench watch RUN_ID`.

## Improve From Evidence

Use this after below-perfect, failed, or reviewed graded evidence exists.

```bash
workbench improve
workbench improve --cloud
workbench improve --dry-run --cloud
workbench eval
workbench results
```

`improve` edits one mutable package version outside `.workbench/**`, proves the candidate with eval evidence, and switches only when the proof succeeds and beats the incumbent. Perfect-only projects get case-authoring remediation instead of cosmetic improvement.

When a one-sample proof run switches source, run a higher-sample eval before publishing.

## Inspect Evidence

Use these commands when you need to understand state, history, or a specific artifact.

```bash
workbench
workbench status
workbench log
workbench versions
workbench show RUN_ID
workbench show JOB_ID
workbench show RUN_ID:cases/investor-focus/output/result.json
workbench diff <base-version-id>..<improved-version-id>
workbench switch <version-id>
workbench open
```

`status` answers "what should I do next?" `log` shows a reverse-chronological timeline. `versions` lists immutable package snapshots without reconciling edited files. `show` reads live project files, version files, run summaries, job evidence, trace artifacts, and exact `REF:PATH` file content. `open` serves the browser UI over the same inspection snapshot.

## Invariants

- Happy paths teach one next command.
- `OWNER/SKILL` is the handle everywhere; `OWNER/SKILL@VERSION` pins exact still-published source.
- `install` mutates agent-visible skill roots; `skills` reads inventory.
- `run`, `grade`, `eval`, `improve`, and `retry` create or reuse one durable run id per accepted launch.
- `--dry-run` never writes package versions, refs, runs, remotes, cancellation files, sync state, traces, or artifacts.
- Human output is for scanning; use `--json` for stable automation.
