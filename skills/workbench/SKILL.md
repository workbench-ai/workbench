---
name: workbench
description: Use this skill for creating, evaluating, improving, inspecting, versioning, syncing, and publishing Workbench-managed agent skills with the `workbench` CLI.
---

# Workbench

Workbench is a local-first skill management runtime. It versions skill source automatically, runs evals with agents, records run/job/trace and artifact evidence, improves the mutable primary skill from scored below-perfect, failed, or reviewed eval evidence, syncs Workbench object remotes, and publishes installable source explicitly.

Assume the user is chatting with an agent that can edit files and run commands. Keep workflow-specific behavior in the managed skill. Use Workbench core for durable source versions, skill bundles, eval cases, agents, runs, traces, artifacts, lineage, object sync, source publication, and read-only inspection snapshots.

## Default Loop

Use the small loop first:

```bash
workbench new ./earnings-prep
cd ./earnings-prep
# run the printed next command, then edit .workbench/cases/case-001/case.yaml and tests/test.sh
workbench eval --agents default -n 1
workbench compare
workbench log --versions
workbench show current:SKILL.md
```

`workbench new` creates an empty `.workbench/cases/` directory. Write representative workflow cases before running `workbench eval`; no-case evals fail with `no_eval_cases` and print a headless command that creates a draft case plus an executable `tests/test.sh` harness. Workbench creates source versions automatically when commands observe changed source. Successful below-perfect evals print an executable next step: they point to `workbench improve` only when the selected agent can improve, otherwise they teach the provider-backed improver setup chain.

Use selector flags only when the user intentionally wants a broader or narrower matrix:

```bash
workbench eval --skills all --agents all -n 1
workbench compare --skills all --agents all --versions all
```

Run `workbench improve` only after scored below-perfect, failed, or reviewed eval evidence exists. Perfect eval runs are not enough. Unscored runtime or auth failures are not enough. `improve` edits one skill and proves the candidate with one explicitly selected improvement-capable agent; there is no implicit provider scan or fallback improver. Evidence is selected by skill lineage and eval definition, not by exact eval-agent hash. If the current eval definition has not been run, the diagnostic points to `workbench eval`; if current evidence is perfect-only, it prints a draft-case creation command instead of an unconditional rerun command. Once actionable evidence exists, or a non-perfect terminal eval attempt already shows the selected agent is on the improve path, a non-improvement-capable selected agent gets setup remediation that includes provider auth capture before adding the improver. A switched one-sample proof should be followed by the printed higher-sample rerun before publishing. Use plural selector flags to narrow defaults when needed:

```bash
codex login --device-auth
workbench login codex --method oauth
workbench agent add default --adapter codex --model gpt-5.4-mini --with auth=default
workbench improve --skills primary --agents default --budget 1 -n 1
```

## Source Shape

Use the skill-first layout:

- `SKILL.md` is the mutable primary skill.
- `.workbench/eval.yaml` describes what skill performance means.
- `.workbench/cases/*/case.yaml` contains representative workflow cases.
- `.workbench/agents.yaml` names runtime configurations and has top-level `default`.
- `.workbench/skills.yaml` is optional; add it only for multiple measured skills, `baseline: none`, or included skills.
- `.agents/` and `.workbench/remotes.yaml` are ignored local machine metadata and are not versioned skill source.
- `.workbench/objects`, `.workbench/refs`, `.workbench/sync`, `.workbench/tmp`, `.workbench/logs`, and `.workbench/locks` are Workbench-owned runtime directories ignored by Git.
- `workbench new DIR --from OWNER/SKILL` does not copy those runtime directories from the source project, but the new editable project initializes its own local objects and refs immediately.

Do not point local skill paths outside the project folder. Use `baseline: none` for a true no-skill baseline instead of creating a fake local no-skill directory. For external skills, use explicit remote refs in `.workbench/skills.yaml` or vendor the files into the project.

## Inspect

```bash
workbench status
workbench log
workbench log --runs
workbench show RUN_ID
workbench show JOB_ID
workbench show VERSION_ID:SKILL.md
workbench run watch RUN_ID
workbench run cancel RUN_ID
workbench run retry RUN_ID
workbench diff BASE_VERSION_ID..IMPROVED_VERSION_ID
workbench switch VERSION_ID
workbench open
```

`switch` materializes a recorded version into the working folder and does not invoke Git. The web view renders the same snapshot envelope as CLI inspection; full-access pages can start eval/improve through the shared operation endpoint, while source-only pages expose acquisition actions only. Use `log` and `show REF` for summary inspection. Use `show REF:PATH` for listed stdout, stderr, result files, captured artifacts, and version files. Use `run watch RUN_ID` for an active or detached run, `run cancel RUN_ID` to request cancellation without deleting evidence, and `run retry RUN_ID` to start a new whole-run attempt from the selected run's stored operation plan. `run watch` exits `0` after it successfully reports any terminal run snapshot; inspect `run.status` for succeeded/failed/canceled semantics. `show RUN_ID` uses the same progress snapshot and evidence count as watch/status, prints runnable `workbench show RUN_ID:PATH` file commands, and does not point failed or canceled run pages back to themselves. Terminal hosted runs already synced locally summarize without contacting Cloud; active hosted watch is the explicit network-follow path. Hosted retry validates the stored plan, creates a local watchable retry handle and progress line, then syncs or auto-links the Cloud skill before resolving the Cloud project and scheduling, so pre-accept canceled hosted runs do not require a manual publish first. In JSON mode, these lifecycle commands return one command envelope whose `run` field is the `workbench.run.v1` snapshot. Improve retry uses the original improve base version recorded in that plan, not the previous candidate proof version; missing or invalid stored plans fail before scheduling and point to a fresh eval or improve. Provider session refs printed by Workbench evidence, such as `codex:SESSION_ID` or `claude:SESSION_ID`, resolve through `show`; native local provider sessions resolve when local provider files exist. Run/job evidence uses canonical user-facing paths; internal `.workbench/` runtime paths and raw trace metadata files are not inspection targets.

## Agents And Skills

Use agents to compare runtime configurations. `local` and `command` agents run Docker-style case tests directly. `codex` and `claude` agents run the provider as the skill executor and score the same cases through the configured score adapter.

```bash
workbench agent add strict --adapter command --with command='sh "$CASE_DIR/tests/test.sh"'
codex login --device-auth
workbench login codex --method oauth
workbench agent add default --adapter codex --model gpt-5.4-mini --with auth=default
claude setup-token
CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth
workbench agent add opus --adapter claude --model opus --with auth=default
workbench eval --agents all -n 1
workbench compare --agents all --versions all
```

Use single quotes around command-valued `--with` assignments so `$CASE_DIR`, `$OUTPUT_DIR`, and `$SKILL_DIR` remain Workbench runtime variables instead of being expanded by the outer shell.

Top-level entries in `.workbench/skills.yaml` are measured skills. Nested `includes` are installed alongside one measured local or remote skill and are hashed into that bundle, but they are not comparison rows.

If an eval adapter, command, auth materialization, or runtime fails, Workbench records failed run evidence with the error. Use `workbench compare` after failed runs because it shows recorded failure evidence instead of treating failures as absent score data; human compare output omits selected agent/version cells that have no run yet.

## Remotes, Publish, Auth

```bash
workbench login
workbench eval --cloud
workbench improve --cloud
workbench eval --dry-run --cloud
workbench improve --dry-run --cloud
workbench publish --as OWNER/SKILL
workbench publish
workbench publish --public
workbench install test/workbench-smoke
workbench skills
workbench new smoke --from test/workbench-smoke
workbench run watch RUN_ID
workbench sync cloud
```

Remotes exchange Workbench object packs; they are not Git remotes. A logged-in `eval --cloud`, evidence-ready `improve --cloud`, or hosted `run retry RUN_ID` creates a local watchable live handle after the local source/evidence or stored retry plan is valid, then auto-links an unpublished Cloud skill project when needed, validates provider auth, syncs objects before scheduling without uploading that handle as a run object, has Cloud accept the same run id, reports concrete progress so far while waiting, and replaces the handle with the authoritative Cloud run snapshot. If auto-link, provider auth, sync, resolving, or scheduling fails before Cloud accepts the run, the local handle terminalizes with that error instead of staying queued. Before Cloud accepts the run id, `run watch RUN_ID` follows the local handle and `run cancel RUN_ID` cancels it locally so the original hosted command stops promptly before scheduling, even when pre-schedule sync is still running. Intentional cancel or detach during that window does not overwrite remote sync health with an abort error. Hosted runner capacity keeps five warm hosts for the common 20-sample eval loop and scales out in five-host increments for larger queues. Terminal evidence sync is its own progress phase before local state updates. A promoted hosted improve also reconciles the same Cloud remote after switching local source, so `status` and `sync cloud --dry-run` agree when the command exits. Progress shows planned/completed/scored work, labeled partial score, failures and cancellations, active job, evidence count, reported usage cost, and elapsed time; it does not show ETA. In JSON mode, progress lines after a durable run id exists are `workbench.run.v1` snapshots for that run. `eval --dry-run` and `improve --dry-run` preview selected launch facts and readiness for the same edited current source the real launch would reconcile, including would-create source versions for hosted dry-run, without writing versions, refs, runs, remotes, cancellation files, or sync state. Missing local provider auth, Workbench Cloud auth, or hosted provider auth appears as blocked readiness with a command-shaped setup remediation; dry-run still preserves the no-write plan. Hosted improve remediation preserves `--cloud`, and when Cloud auth is absent the setup chain begins with `workbench login`. `improve --cloud` validates local target and evidence before auto-linking or hosted progress. The first Ctrl-C detaches promptly with the local worker or hosted runner still active, aborts the attached Cloud wait, and prints `next: workbench run watch RUN_ID`; use `workbench run watch RUN_ID` to resume progress and sync terminal hosted evidence when needed. `publish` is the only command that exposes source for install or editable acquisition; `publish --as OWNER/SKILL` sets or replaces the persisted handle when the derived one is wrong, and bare `publish` preserves the last explicit audience such as `--public`. In JSON mode, publish keeps human progress prose off stderr. If the same version, handle, and visibility are already published, bare `publish` reports `Already published` and prints the install command without republishing. Use unique handles for throwaway validation because hosted auto-link and publish create persistent Cloud skill projects. `sync` is explicit repair and portability plumbing for local source or local-only object changes; Cloud-owned hosted evidence imported by watch, hosted waits, or explicit sync does not dirty sync status or dry-run write deltas. If `sync --dry-run` reports changes while `status` is locally up to date, run the printed sync command; dry-run probes the remote without updating local sync status. Cloud skill deletion is not part of the taught CLI lifecycle.

`install OWNER/SKILL` or `install URL` requires a source and writes only the agent skill package for the current coding agent and folder by default. Use `--global` for global access, `--for codex`, `--for claude`, or `--for all` to select supported coding-agent targets explicitly, and `--yes` only when overwriting changed or unmanaged destination content. `install` never copies `.workbench` controls into agent skill roots. Use `workbench skills` for read-only inventory: default is current coding agent in the current folder, `--global` is current-agent global access, `--for all` is Codex plus Claude in the folder, and `--for all --global` is Codex plus Claude global access. If Workbench cannot detect the current coding agent, pass `--for codex`, `--for claude`, or explicit `--for all`. Use `workbench new DIR --from OWNER/SKILL` to get editable source with authored `.workbench` controls for eval or improve.

Use `workbench login` before authenticated Workbench Cloud operations. The production Cloud URL is the default; `--base-url` is for development or self-hosted targets. Shared Workbench test credentials prove Workbench Cloud login only; they do not include Codex or Claude provider OAuth. For headless use, `workbench login --start-only` or `workbench login --no-open` records a pending device authorization and `workbench login --wait --timeout 120` resumes it with an explicit bound. Bare `workbench login` also uploads any locally connected provider auth bundles, so a user who ran `workbench login codex --method oauth` before Cloud login does not need to repeat provider login before hosted eval. For provider-backed validation, use OAuth only: run `codex login --device-auth` when `~/.codex/auth.json` is missing, then `workbench login codex --method oauth`. For Claude, run `claude setup-token` in an interactive shell, complete browser authorization, copy the OAuth token it prints, then run `CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth`. For isolated capture, `--profile-root DIR` reads native provider state from an alternate home root: Codex reads `DIR/.codex/auth.json`; Claude reads `DIR/.claude.json` plus `CLAUDE_CODE_OAUTH_TOKEN`. Once Workbench captures provider auth, native provider files in the current `HOME` are not required for Workbench runs. Use `workbench logout PROVIDER` before `workbench logout` when cleaning up provider-backed validation; `remoteAdapterAuth.status` reports the remote provider connection after cleanup and `remoteAdapterAuth.workbenchCloud.status` reports whether Cloud auth was available. Native provider CLI auth is separate and must be removed separately for clean-room tests. If `status` reports remote sync `local_changes`, run `workbench sync cloud` to push local source or local-only object changes; use `workbench run watch RUN_ID` to resume a known detached hosted run.

## What Belongs In The Skill Layer

Keep these in skills unless core runtime support is required: discovering cases from conversations or traces, drafting `.workbench/cases/*` files, drafting rubrics, choosing examples, writing workflow-specific checks, deciding improvement strategy, and explaining whether the evidence is good enough.

## References

Load only what is needed:

- `references/docs/jtbd.md` for the job-level command sequences users expect.
- `references/docs/cli.md` for command syntax.
- `references/docs/evals/README.md` for source shape and authoring loop.
- `references/SPEC.md` for the hard-cut product contract.
