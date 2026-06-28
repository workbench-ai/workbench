# Common workflows

Choose the shortest Workbench command path for common tasks.

Most workflows follow the same loop: author source, run or grade cases, inspect evidence, then publish or improve when the result is ready. See [CLI reference](cli.md) for exact syntax, [Evaluation basics](evals.md) for eval source, [Improve from evidence](improve.md) for improvement, [Results](track.md) for evidence inspection, and [Publish](share.md) for sharing.

## Choose a workflow

| Goal | Start with | Outcome |
| --- | --- | --- |
| Create a measured skill | `workbench new` | A local skill project with eval cases and recorded evidence. |
| Use a skill | `workbench install` | An agent-visible skill package in Codex or Claude. |
| Edit someone else's skill | `workbench clone` | Editable source in a fresh Workbench project. |
| Add evals to an existing skill | `workbench init` | Existing `SKILL.md` plus Workbench controls. |
| Build an eval interactively | `workbench run` then `workbench grade` | Prompt output and judgment evidence you can iterate on separately. |
| Review quality | `workbench eval` then `workbench results` | Quality, coverage, latency, cost, and run evidence by skill version, eval version, and agent. |
| Improve from evidence | `workbench improve` | Candidate source plus proof eval before switching. |
| Run hosted | `--cloud` | The same run graph executed by Workbench Cloud. |
| Inspect evidence | `workbench show` | Source, run, job, trace, artifact, or file evidence. |
| Capture live skill use | `workbench record on` | Plugin-captured live runs with low-level traces for review and case promotion. |

## Create and publish a skill

Create a Workbench-managed skill when you have a workflow that other people or agents should run.

```bash
workbench new earnings-prep
cd earnings-prep
# edit SKILL.md and .workbench/cases/
workbench eval
workbench publish
```

`new` writes `SKILL.md`, eval config, agent config, an environment Dockerfile, ignored runtime directories, and an empty `.workbench/cases/` directory.

For publishing, sign in with `workbench login`. Provider-backed evals also require provider auth. The default publish visibility is private; use `--team` for an organization skill or `--public` for public source.

After publish, hand off one of these commands:

```bash
workbench install acme/earnings-prep
workbench clone acme/earnings-prep earnings-prep
```

Use `install` when the recipient only needs the skill in their agent. Use `clone` when they need editable source, evals, and future improvements.

## Install or clone a skill

Install or clone a skill from a Workbench `OWNER/SKILL` handle, a GitHub-hosted Agent Skill, or a local skill package.

```bash
workbench install test/workbench-smoke
workbench install https://github.com/vercel-labs/skills/tree/main/skills/find-skills
workbench skills
workbench clone test/workbench-smoke smoke
```

`install` checks Workbench Cloud handles first. If a Workbench source is available, Workbench records the source handle and exact published version. For external sources, it delegates to `skills add`; Workbench-only features such as `clone`, eval evidence, improve lineage, and Cloud visibility do not apply.

`install` copies only the Agent Skill package: `SKILL.md`, scripts, references, assets, `dist/**`, and support files. It does not copy `.workbench` eval controls or runtime state. Add `--target codex` or `--target claude` when the current coding agent cannot be detected, and add `--scope global` for a global install.

`skills` scans configured Codex and Claude skill roots visible from the current directory. It also reports the current editable Workbench project when you are standing in one.

`clone` creates editable source in a fresh Workbench project. Clone when you need to evaluate, modify, or improve a published Workbench skill.

## Add evals to an existing skill

Adopt an existing `SKILL.md` folder when the skill is useful and needs Workbench evals.

```bash
workbench skills
cd PATH_TO_EXISTING_SKILL
workbench init
# edit .workbench/cases/
workbench eval
```

`init` requires `SKILL.md`, creates Workbench eval controls, and leaves the package source unchanged. It does not install, publish, clone, evaluate, improve, or generate cases.

## Define success criteria

Define success criteria before treating results as evidence.

Workbench keeps eval source under `.workbench/**`, separate from installable package source:

```text
.workbench/eval.yaml
.workbench/cases/<case-id>/case.yaml
.workbench/agents.yaml
.workbench/environment/Dockerfile
```

A minimal provider-backed case is prompt plus grading criteria:

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

## Build an eval from a prompt

Run one prompt, inspect the output, then add or tune judgment criteria.

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

`run` records output without invoking the grader. `grade` judges existing eligible output and never reruns the skill. `eval` combines both steps. Prompt, public case input, source, agent, and sample changes make execution stale; grade criteria changes make grading stale only.

## Review results

Review results to decide whether to evaluate again, improve, or publish.

```bash
workbench eval --dry-run
workbench run
workbench grade
workbench eval
workbench eval --agents all -n 5
workbench results
workbench evals
workbench results --eval eval-v1
workbench results --eval all
workbench results --versions all --agents all
```

`eval --dry-run` previews selectors, cases, samples, package source status, environment file, reusable evidence, and launch checks without writing state. Real `run`, `grade`, and `eval` use the same launch checks. Draft prompts block `run`, `grade`, and `eval`; draft grade criteria block `grade` and `eval` but still allow output-only `run`.

Results default to the current eval version. Use `workbench evals` and `--eval eval-vN` when a case, test, rubric, or environment edit changed the scoring standard and you need to inspect older evidence.

Use `--rerun` only when you need fresh evidence:

```bash
workbench run --rerun
workbench grade --rerun
workbench eval --rerun
```

`results` reads recorded local Workbench state. Human tables omit unrun selected rows; JSON preserves the full selected set.

## Run locally or in Workbench Cloud

Add `--cloud` to run the same operation in Workbench Cloud.

```bash
workbench run --cloud
workbench grade --cloud
workbench eval --cloud
workbench improve --cloud
workbench watch RUN_ID
workbench cancel RUN_ID
workbench retry RUN_ID
```

Hosted compute requires Workbench Cloud login, hosted provider auth for provider-backed agents, and an organization-owned Cloud skill under an active Team or Enterprise plan. Before Cloud accepts a run, progress appears as preparation. After acceptance, `watch`, `cancel`, and `retry` operate on the recorded run id.

Press Ctrl-C once during an attached wait to detach. The run continues, and the next command is `workbench watch RUN_ID`.

## Improve from evidence

Improve after below-perfect, failed, or reviewed graded evidence exists.

```bash
workbench improve
workbench improve --cloud
workbench improve --dry-run --cloud
workbench eval
workbench results
```

`improve` edits package source outside `.workbench/**`, proves the candidate with eval evidence, and switches only when the proof succeeds and beats the current version. Perfect-only projects prompt you to add or sharpen cases instead of making cosmetic source changes.

When a one-sample proof run switches source, run a higher-sample eval before publishing.

## Inspect evidence

Inspect state, history, and artifacts with read-only commands.

```bash
workbench
workbench status
workbench log
workbench versions
workbench show RUN_ID
workbench show JOB_ID
workbench show RUN_ID:cases/investor-focus/output/result.json
workbench diff <base-version-id>..<improved-version-id>
workbench switch <version-id> --dry-run
workbench switch <version-id> --yes
workbench open
```

`status` shows the next useful command. `log` shows recent versions and runs. `versions` lists recorded package versions. `show` reads project files, version files, run summaries, job evidence, trace artifacts, and exact `REF:PATH` file content. `switch --dry-run` previews a version restore, and `switch --yes` applies it after review. `open` serves the browser UI over the same inspection data.

## Capture live skill use

Turn on native host tracing, use a Workbench-managed skill in an agent host, then inspect the captured session as run/job evidence or promote the low-level trace into a case:

```bash
workbench record on
workbench open
workbench traces
workbench case promote TRACE_ID --id case-001
```

`record on` manages Workbench's Codex and Claude Code trace plugins through the hosts' plugin commands. Host hooks write to Workbench's local spool, and project-matched captures appear under `Runs` as live runs with agent-session jobs. `traces` is a low-level inventory for review and promotion. The shipped plugins record explicit leading `$skill` invocations; the generic hook also accepts exact host skill-claim events when a host integration emits them. Unrelated host turns are discarded. Workbench does not import provider session history implicitly; promotion creates a normal authored case under `.workbench/cases/` only after the trace is captured, terminal, and has captured input.

When a trace is reviewed as failed or deferred, add `--expected` with the corrected outcome before promotion so the case captures the intended behavior rather than the bad response.

Codex must be new enough to support `codex plugin add/list`, and Codex must load user plugin config for the trace hook to run. If Codex asks whether to trust the Workbench hook, approve it only after verifying the plugin source.
