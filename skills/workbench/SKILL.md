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
workbench case draft case-001
# edit .workbench/cases/case-001/case.yaml and tests/test.sh
workbench eval --agents default -n 1
workbench compare
workbench log --versions
workbench versions
workbench show current:SKILL.md
```

`workbench new` creates an empty `.workbench/cases/` directory. Write representative workflow cases before running `workbench eval`; no-case evals fail with `no_eval_cases` and print `workbench case draft CASE_ID`, which creates a draft case plus an executable `tests/test.sh` harness that intentionally fails with score `0` until edited. Workbench creates source versions automatically when commands need current source. `versions` lists committed immutable source versions without reconciling edited files. Successful below-perfect evals print an executable next step: they point to `workbench improve` only when the selected agent can improve, otherwise they first teach `workbench agent add improver ...` and status advances to the improver rerun after that agent exists.

Use selector flags only when the user intentionally wants a broader or narrower matrix:

```bash
workbench eval --skills all --agents all -n 1
workbench compare --skills all --agents all --versions all
```

Run `workbench improve` only after scored below-perfect, failed, or reviewed eval evidence exists. Perfect eval runs are not enough, and a perfect current comparable eval for the selected proof agent suppresses older below-perfect traces for that same eval definition. Unscored runtime or auth failures are not enough. `improve` edits one skill and proves the candidate with one explicitly selected improvement-capable agent; there is no implicit provider scan or fallback improver. Evidence is selected by skill lineage and eval definition, not by exact eval-agent hash. If the current eval definition has not been run, the diagnostic points to `workbench eval`; if current evidence is perfect-only, it prints a draft-case creation command instead of an unconditional rerun command. Once actionable evidence exists, a non-improvement-capable selected agent gets staged setup remediation: the top-level `next` is the first command, and JSON `subject.setupCommands` carries provider auth capture, improver rerun, and improve. A switched one-sample proof should be followed by the printed higher-sample rerun before publishing. Use plural selector flags to narrow defaults when needed:

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
- `workbench clone OWNER/SKILL[@VERSION]|URL DIR` does not copy those runtime directories from the source project, but the new editable project initializes its own local objects and refs immediately.

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

`switch` materializes a recorded version into the working folder and does not invoke Git. The web view renders the same snapshot envelope as CLI inspection; full-access pages can start eval/improve through the shared operation endpoint, while source-only pages expose acquisition actions only. Use `log` and `show REF` for summary inspection. Use `show REF:PATH` for listed stdout, stderr, result files, captured artifacts, and version files. `versions` lists committed immutable source versions only and does not reconcile edited files; default `diff` reconciles current source for its implicit current-vs-parent range. Use `run watch RUN_ID` for an active or detached run, `run cancel RUN_ID` to request cancellation without deleting evidence, and `run retry RUN_ID` to start a new whole-run attempt from the selected run's stored operation plan. `run watch` exits `0` after it successfully reports any terminal run snapshot; inspect `run.status` for succeeded/failed/canceled semantics. Failed or canceled terminal watch output omits self-referential `next: workbench show RUN_ID`; succeeded eval watch/retry next commands preserve non-default skill or agent selectors, so a run evaluated with `--agents strict` points to `workbench compare --agents strict`. `show RUN_ID` uses the same progress snapshot and evidence count as watch/status, prints runnable `workbench show RUN_ID:PATH` file commands, and does not point failed or canceled run pages back to themselves. Human job sample labels are one-based like live progress. Terminal hosted runs already synced locally summarize without contacting Cloud; active hosted watch is the explicit network-follow path. Hosted retry validates the stored plan, creates a local watchable retry handle and progress line, then syncs or auto-links the Cloud skill before resolving the Cloud project and scheduling, so pre-accept canceled hosted runs do not require a manual publish first. In JSON mode, these lifecycle commands return one command envelope whose `run` field is the `workbench.run.v1` snapshot. Improve retry uses the original improve base version recorded in that plan, not the previous candidate proof version; missing or invalid stored plans fail before scheduling and point to a fresh eval or improve. Provider session refs printed by Workbench evidence, such as `codex:SESSION_ID` or `claude:SESSION_ID`, resolve through `show`; native local provider sessions resolve when local provider files exist. Run/job evidence uses canonical user-facing paths; internal `.workbench/` runtime paths and raw trace metadata files are not inspection targets.

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

If an eval adapter, command, auth materialization, or runtime fails after launch readiness passes, Workbench records failed run evidence with the error. Missing local provider auth is a launch-readiness blocker and fails before source-version persistence or run/job/evidence writes. Use `workbench compare` after failed runs because it shows recorded failure evidence instead of treating failures as absent score data; human compare output omits selected agent/version cells that have no run yet.

## Remotes, Publish, Auth

```bash
workbench login
workbench eval --cloud
workbench improve --cloud
workbench eval --dry-run --cloud
workbench improve --dry-run --cloud
workbench publish --as OWNER/SKILL
workbench publish
workbench publish --team
workbench publish --public
workbench unpublish VERSION
workbench install test/workbench-smoke
workbench install test/workbench-smoke@VERSION
workbench skills
workbench clone test/workbench-smoke[@VERSION] smoke
workbench run watch RUN_ID
workbench sync cloud
```

Remotes exchange Workbench object packs; they are not Git remotes. A logged-in `eval --cloud`, evidence-ready `improve --cloud`, or hosted `run retry RUN_ID` creates a local watchable live handle after the local source/evidence or stored retry plan is valid, then auto-links an unpublished Cloud skill project when needed, validates provider auth and hosted plan access, syncs objects before scheduling without uploading that handle as a run object, has Cloud accept the same run id, reports concrete progress so far while waiting, and replaces the handle with the authoritative Cloud run snapshot. Before Cloud accepts the run id, progress is labeled as preparing the Workbench Cloud run; JSON progress uses planning or syncing phase without reporting queued status, and queued plus hosted-worker wording is reserved for accepted Cloud run snapshots. Hosted compute requires an organization-owned Cloud skill under an active Team or Enterprise organization plan; personal Free skills can publish source but cannot start hosted eval or improve. If auto-link, provider auth, sync, plan validation, resolving, or scheduling fails before Cloud accepts the run, the local handle terminalizes with that error instead of staying queued. Before Cloud accepts the run id, `run watch RUN_ID` follows the local handle and `run cancel RUN_ID` cancels it locally so the original hosted command stops promptly before scheduling, even when pre-schedule sync is still running. Intentional cancel or detach during that window does not overwrite remote sync health with an abort error. Hosted runner capacity keeps five warm hosts for the common 20-sample eval loop and scales out in five-host increments for larger queues. Terminal evidence sync is its own progress phase before local state updates. A promoted hosted improve also reconciles the same Cloud remote after switching local source, so `status` and `sync cloud --dry-run` agree when the command exits. Progress shows planned/completed/scored work, labeled partial score, failures and cancellations, active job, evidence count, reported usage cost, and elapsed time; it does not show ETA. In JSON mode, progress lines after a durable run id exists are `workbench.run.v1` snapshots for that run; failed or canceled terminal snapshots and terminal `run watch` output omit self-referential `next: workbench show RUN_ID` hints. `eval --dry-run` and `improve --dry-run` preview selected launch facts and readiness for the same edited current source the real launch would reconcile, including would-create source versions for hosted dry-run, without writing versions, refs, runs, remotes, cancellation files, or sync state; hosted dry-run does not claim reusable local cached run ids. Missing local provider auth, Workbench Cloud auth, hosted provider auth, or hosted plan access appears as blocked readiness with command-shaped setup remediation; dry-run still preserves the no-write plan and top-level `next` is the first executable setup step, preferring immediate auth/setup commands before hosted plan remediation when both are blocked. Hosted improve validates local target and evidence before auto-linking or hosted progress; if the selected local agent cannot improve, that local readiness issue is reported before Cloud target checks. The first Ctrl-C detaches promptly with the local worker or hosted runner still active, aborts the attached Cloud wait, and prints `next: workbench run watch RUN_ID`; use `workbench run watch RUN_ID` to resume progress and sync terminal hosted evidence when needed. `publish` is the only command that exposes source for install or editable acquisition; it records the selected version in the published-version set and moves the current publication pointer. `publish --as OWNER/SKILL` sets or replaces the persisted handle when the derived one is wrong, and bare `publish` preserves the last explicit audience such as `--team` or `--public`. In JSON mode, publish keeps human progress prose off stderr. If the same version, handle, and visibility are current published source, bare `publish` reports `Already published` and prints the install command without republishing. `publish --team` requires an organization-owned skill and errors use team visibility wording. Published versions are addressed with `OWNER/SKILL@VERSION`, where `VERSION` may be the full version id or any unambiguous displayed prefix; use `workbench unpublish VERSION` only for prior exact versions that should no longer be installable. `unpublish` validates removability before printing destructive removal progress. Sharing means using `publish --team` for organization members or `publish --public` for anyone, then handing over `install OWNER/SKILL` for use or `clone OWNER/SKILL[@VERSION]|URL DIR` for editable source. Use unique handles for throwaway validation because hosted auto-link and publish create persistent Cloud skill projects. `sync` is explicit repair and portability plumbing for local source or local-only object changes; Cloud-owned hosted evidence imported by watch, hosted waits, or explicit sync does not dirty sync status or dry-run write deltas. If `sync --dry-run` reports changes while `status` is locally up to date, run the printed sync command; dry-run probes the remote without updating local sync status. Cloud skill deletion is not part of the taught CLI lifecycle.

`install OWNER/SKILL`, `install OWNER/SKILL@VERSION`, or `install URL` requires a source and writes only the agent skill package for the current coding agent and folder by default. The bare handle installs current published source; `@VERSION` installs a still-published version and may be the full id or an unambiguous displayed prefix. Use `--target codex|claude` to choose one coding-agent product, `--scope folder|global` to choose access scope, and `--yes` only when overwriting changed or unmanaged destination content; exact-version overwrite remediation preserves the `OWNER/SKILL@VERSION` source pin. Installing for both Codex and Claude is two explicit commands. `install` never copies `.workbench` controls into agent skill roots. Use `workbench skills` for read-only inventory: default is a broad Codex and Claude folder/global scan, `--target codex|claude` narrows the coding-agent product, and `--scope folder|global` narrows the access scope. A visible local Workbench project that was not installed from a handle reports status `project`, not `unmanaged`. Use `workbench clone OWNER/SKILL[@VERSION]|URL DIR` to get editable source with authored `.workbench` controls for eval or improve.

Use `workbench login` before authenticated Workbench Cloud operations. The production Cloud URL is the default; `--base-url` is for development or self-hosted targets. Shared Workbench test credentials prove Workbench Cloud login only; they do not include Codex or Claude provider OAuth and do not by themselves grant hosted compute. Real hosted eval/improve success requires provider auth for provider-backed agents plus an organization-owned Cloud skill under an active Team or Enterprise plan. For headless use, `workbench login --start-only` or `workbench login --no-open` records a pending device authorization and `workbench login --wait --timeout 120` resumes it with an explicit bound. Bare `workbench login` also uploads any locally connected provider auth bundles, so a user who ran `workbench login codex --method oauth` before Cloud login does not need to repeat provider login before hosted eval. For provider-backed validation, use OAuth only: run `codex login --device-auth` when `~/.codex/auth.json` is missing, then `workbench login codex --method oauth`. For Claude, run `claude setup-token` in an interactive shell, complete browser authorization, copy the OAuth token it prints, then run `CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth`. For isolated capture, `--profile-root DIR` reads native provider state from an alternate home root: Codex reads `DIR/.codex/auth.json`; Claude reads `DIR/.claude.json` plus `CLAUDE_CODE_OAUTH_TOKEN`. Once Workbench captures provider auth, native provider files in the current `HOME` are not required for Workbench runs. Use `workbench logout PROVIDER` before `workbench logout` when cleaning up provider-backed validation; `remoteAdapterAuth.status` reports the remote provider connection after cleanup and `remoteAdapterAuth.workbenchCloud.status` reports whether Cloud auth was available. Native provider CLI auth is separate and must be removed separately for clean-room tests. If `status` reports remote sync `local_changes`, run `workbench sync cloud` to push local source or local-only object changes; use `workbench run watch RUN_ID` to resume a known detached hosted run.

## What Belongs In The Skill Layer

Keep these in skills unless core runtime support is required: discovering cases from conversations or traces, drafting `.workbench/cases/*` files, drafting rubrics, choosing examples, writing workflow-specific checks, deciding improvement strategy, and explaining whether the evidence is good enough.

## References

Load only what is needed:

- `references/docs/jtbd.md` for the job-level command sequences users expect.
- `references/docs/cli.md` for command syntax.
- `references/docs/evals/README.md` for source shape and authoring loop.
- `references/SPEC.md` for the hard-cut product contract.
