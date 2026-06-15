# Workbench Jobs To Be Done

This document is the canonical ergonomics reference for Workbench. Each job names the complete steady-state command sequence a user runs to get it done. The sequences below are a product contract, not documentation of incidental behavior: if completing a job requires more commands, more flags, or more prior knowledge than written here, that is a defect. Docs, the CLI help, the authored `workbench` skill, and the web UX must stay consistent with this file.

How to read each job: "steady state" is what a returning user types after one-time setup is done. One-time setup is listed separately and may include login, the first publish, or the first hosted run depending on the job. Every command sequence assumes manifest defaults from `.workbench/agents.yaml` and the optional `.workbench/skills.yaml`; selector flags exist only to intentionally broaden or narrow the matrix. The contract grammar lives in [`../SPEC.md`](../SPEC.md); the operator guide is [`cli.md`](cli.md).

Live validation uses the Workbench device login against the shared test account `test@test.com` with password `Test123!Test`. In headless shells, `workbench login --no-open --json` starts the device flow and prints the same bounded resume command as `workbench login --start-only --no-open --json`. Disposable publish checks in the shared `test` namespace must use a unique first-publish handle such as `workbench publish --as test/earnings-prep-$(date +%s) --private`; handle conflicts are expected and the printed remediation is authoritative. Hosted auto-link and publish create persistent Cloud skill projects, so throwaway validation should use disposable names. Provider-backed validation uses OAuth only, never API keys: generate missing Codex auth with `codex login --device-auth`, then capture it with `workbench login codex --method oauth`. For Claude, run `claude setup-token` in an interactive shell, complete browser authorization, copy the OAuth token it prints, then capture it with `CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth`. Validators can pass `--profile-root DIR` for isolated provider capture; `DIR` is an alternate home root where Codex reads `DIR/.codex/auth.json` and Claude reads `DIR/.claude.json` plus the exported `CLAUDE_CODE_OAUTH_TOKEN`. Once Workbench provider auth is captured, native provider files in the current `HOME` are not required for Workbench runs. `workbench logout PROVIDER` removes Workbench's captured provider auth but intentionally leaves native provider CLI auth alone; remove native auth separately when a clean-room validation pass requires it. Validators must still verify Workbench's missing-token guidance from a throwaway `HOME`, and complete successful Claude capture only when the native flow can be authorized without guessing credentials.

## Job 1: Get my expertise into a skill others can run

Create a skill, validate it against representative cases, and make it installable for a team or the public.

    workbench new earnings-prep
    cd earnings-prep
    # edit SKILL.md and .workbench/cases/
    workbench eval
    workbench publish

One-time setup: `workbench login` once per machine for Cloud publish, plus provider auth for the scaffolded default Codex agent: `codex login --device-auth` if `~/.codex/auth.json` is missing, then `workbench login codex --method oauth`. If provider auth is captured before Cloud login, the successful bare `workbench login` uploads the connected provider bundle to Cloud automatically. Teams that want Claude as the default use `claude setup-token`, then `CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth`, then configure the default agent. The first `publish` derives the `OWNER/SKILL` handle from the logged-in namespace and project folder, links the Cloud skill project, and defaults to `--private`. `workbench publish --as OWNER/SKILL` is the one-time override when the derived handle is wrong, and later bare `publish` uses the persisted handle. Steady state after that is bare `workbench publish` with zero flags, like bare `git push` after `git push -u`. Audience changes only when an audience flag is provided: `--private`, `--team` (organization members), or `--public` (anyone, including the public `skills` CLI through well-known discovery). A later bare `publish` preserves the last explicit audience. `publish` exposes two read surfaces from the same source version: an installable agent skill package for `workbench install`, and editable Workbench source for `workbench new DIR --from OWNER/SKILL`. It ends by printing the exact `workbench install OWNER/SKILL` line to hand to people who only need to use the skill. No URLs are ever typed and the words "remote" and "sync" do not appear in this job. Deleting hosted Cloud skill projects is not part of this taught CLI lifecycle; disposable validation should use unique handles.

## Job 2: Use a skill someone else made

    workbench install test/workbench-smoke
    workbench skills

The maintained public validation fixture is `test/workbench-smoke`; real handoffs use the publisher's `OWNER/SKILL` handle. The `OWNER/SKILL` handle is the universal identifier for published skills. Full Cloud URLs are accepted when pasted from a browser but are never required. Private and team skills use the same handle with Workbench Cloud auth.

`workbench install OWNER/SKILL` is strictly mutating and requires a source argument. With no flags, it installs the agent skill package for the current coding agent in the current folder. If the current coding agent cannot be detected, it fails with one command-shaped remediation such as `workbench install OWNER/SKILL --for codex`. `--global` installs for that coding agent globally. `--for codex`, `--for claude`, and `--for all` override current-agent detection; `all` means exactly Codex plus Claude Code. The install target paths are implementation details. Re-running the same install command over an unchanged Workbench-managed copy is idempotent; changed or unmanaged destination content requires `--yes`.

Installed skill roots contain only the agent skill package: `SKILL.md`, scripts, references, assets, and package support files. `workbench install` never writes `.workbench/eval.yaml`, `.workbench/cases`, runtime objects, refs, logs, remotes, locks, or install metadata inside the package directory. This keeps "use this skill in my agent" separate from "work on this skill as a Workbench project."

`workbench skills` is the inventory command. With no flags, it answers "from my current coding agent in this folder, what skills do I have access to?" `workbench skills --global` answers the same question for global access. If the current coding agent cannot be detected, it fails with a command-shaped remediation such as `workbench skills --for codex`; `--for all` is the explicit cross-agent view. `workbench skills --for all` answers "across supported coding agents, what is accessible in this folder?" `workbench skills --for all --global` answers "across supported coding agents, what is accessible globally?" Inventory is read-only, takes no project lock, performs no network access by default, and shows `current`, `modified`, `missing`, `unmanaged`, or `duplicate-name` status when it can tell. It does not show a `not installed` universe because catalog search is a separate job. Removal is ordinary filesystem deletion from the visible skills root after checking inventory.

To get editable source and Workbench controls for evaluation or improvement, use `new --from`, not `install`:

    workbench new smoke --from test/workbench-smoke

`workbench new DIR --from OWNER/SKILL` creates a Workbench project containing the package plus authored `.workbench` controls when the source has them. It does not copy the source project's runtime objects, refs, sync state, logs, locks, remotes, install ledgers, or `.agents` directories, but it does initialize fresh local Workbench versioning state for the new project. If the source is package-only, it creates the package plus the normal minimal `.workbench` scaffold. `workbench eval` and `workbench improve` operate on that project source; installed global or folder copies do not affect them unless explicitly vendored or referenced in `.workbench/skills.yaml`.

## Job 3: Define what good means for this skill

Eval authoring is file editing, not command running — the same way git has no command for writing code. The authored, evaluated, and versioned agent skill package is everything outside `.workbench/**`: `SKILL.md`, scripts, references, assets, package metadata, helper files, and any other package support files. The authored Workbench control surface is `.workbench/eval.yaml` (the score adapter), `.workbench/cases/*/case.yaml` (representative workflow inputs with rubrics or tests), `.workbench/agents.yaml` (runtime configurations), and optional `.workbench/skills.yaml` or `.workbench/environment/`. Runtime `.workbench` directories such as objects, refs, sync, tmp, logs, and locks are not installable package source. A minimal provider-backed case is:

```yaml
version: 1
id: case-001
prompt: Create an earnings prep note for GOOGL.
rubric:
  - Explains the likely investor focus areas.
  - Avoids overclaiming facts not present in the context.
```

Local or command-backed test cases additionally need either a top-level `command` in `case.yaml` or an executable `tests/test.sh` under the case directory; shell tests write their public score to `$OUTPUT_DIR/result.json`. The best cases often come from observed failures: inspect a run with `workbench show RUN_ID`, then write or edit the case files directly. Creating a fresh case is creating a folder, listing is `ls .workbench/cases`, and removing is deleting the folder — safely, because authored source is versioned at every command boundary and recoverable via `switch`.

## Job 4: Find out if it is actually good

    workbench eval
    workbench eval --agents all -n 5
    workbench eval --rerun

`eval` runs the manifest-default matrix, records run/job/trace/artifact evidence, prints per-run results plus compact case/sample/job coverage and the score delta against the incumbent version when both sides are scored (for example `primary v019 0.84 (was 0.79)`), and ends with one `next:` suggestion. The inline delta means `compare` is not needed in the daily single-skill loop. `-n` is shorthand for `--samples`. Failed execution is recorded as failed evidence with the error, never as missing data.
`--rerun` bypasses cached evidence for the matrix selected by the current command; it does not remember selector or sample flags from a previous invocation.

## Job 5: Run anywhere — weave between local and hosted runners

    workbench eval --cloud
    workbench improve --cloud

`--cloud` is the hosted execution story: the same command, executed by the Workbench Cloud runner against the linked Cloud skill. Hosted commands validate selected provider auth, the improvement-capable agent, and required evidence before network sync; `improve --cloud` validates local target and evidence before Cloud auto-linking or hosted progress. Local objects sync up before scheduling, Cloud derives the runtime packet from its stored project state, and the CLI syncs once after Cloud accepts the run so `workbench show RUN_ID` works immediately. The wait loop then polls hosted run status, and terminal evidence sync is reported as an explicit progress phase before local state updates when the run finishes. Long-running eval and improve commands, local or hosted, write sparse run/job progress to stderr: phase, queued/running state, case and sample counters, failures, elapsed time, and a heartbeat only while unchanged. Stdout remains one parseable JSON document for `--json`. Ctrl-C detaches with exit 130, leaves the hosted run running, and prints `next: workbench show RUN_ID`. Read commands inspect local committed Workbench state only, so a detached run that finishes later is refreshed with explicit `workbench sync cloud`. One-time setup: `workbench login` must be active; if no Cloud skill is linked yet, the first `eval --cloud` or evidence-ready `improve --cloud` auto-links an unpublished Cloud skill project. Publishing installable source remains a separate explicit `workbench publish` action.

## Job 6: Make it better from evidence

    workbench improve
    workbench improve --cloud

`improve` requires scored below-perfect, failed, or reviewed eval evidence, edits the selected mutable package source outside `.workbench/**` with one explicitly selected improvement-capable agent (same plural `--skills`/`--agents` grammar as `eval`; values must resolve to exactly one entry each, and the error names the exact corrected command when they do not), records the candidate version plus proof-run evidence, and switches only when the proof run succeeds and beats the incumbent. The candidate may update `SKILL.md`, scripts, references, assets, or other package support files; ordinary improve reads `.workbench` evidence and controls but does not rewrite `.workbench/**`. The selected agent is both the improver and proof eval agent, so it appears in `compare` with the same status and score semantics as any other run. Hosted `improve --cloud` follows that same switch contract after terminal Cloud evidence syncs back. Perfect eval runs and unscored runtime/auth failures are not improvement evidence; historical scored smoke-labeled failures are still evidence. When a one-sample proof run switches the current source, the next command is a higher-sample rerun before publish. If the selected eval agent cannot improve, Workbench suggests adding a separate improvement-capable agent and proving it; provider login is suggested separately only when provider auth is actually missing. One-time setup for the taught bare Codex command is `codex login --device-auth` if `~/.codex/auth.json` is missing, then `workbench login codex --method oauth`, then `workbench agent add default --adapter codex --model gpt-5.4-mini --with auth=default`. The Claude equivalent is `claude setup-token` in an interactive shell, browser authorization, `CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth`, then `workbench agent add default --adapter claude --model sonnet --with auth=default`.

## Job 7: Decide which agent or version to ship

    workbench compare
    workbench compare --agents all
    workbench compare --versions 26059f9a..eac5699c

`compare` renders one scorecard for one eval definition across selected skills, agents, and versions, including the `baseline: none` no-skill row and failed runs as visible failure evidence. Human output is evidence-first: selected rows with no recorded run stay out of the table instead of printing `not-run` noise, while JSON keeps the full valid selected matrix for automation. Recorded run evidence remains comparable even if an unrelated historical source manifest is no longer parseable. When multiple runs match a cell, Workbench prefers the terminal run with the most case/sample evidence and uses recency only as a tie-breaker; human latency is average per sample for multi-sample runs. Version and run ids display as short unique prefixes everywhere and any unambiguous prefix is accepted wherever a REF is expected, so ranges are typed from what the previous command printed. The web `Compare` surface is the browser counterpart over the same snapshot.

## Job 8: Understand what happened

    workbench                     # bare invocation = status + the next useful command
    workbench log                 # one reverse-chronological timeline of versions and runs
    workbench show r4f2           # any object id: run, job, trace, version, artifact, session
    workbench show job_abc
    workbench open                # read-only browser UI over the same snapshot

Three universal read verbs cover all inspection: `status` (where am I — worktree, runs, publication, sync health, auth), `log` (what happened, filterable with `--runs` or `--versions`), and `show` (give me the thing — interpreted run/job evidence, file listings for file-backed objects, or one file via `REF:PATH`). Use `workbench show RUN_ID` first for multi-sample runs; then open a specific listed job stream such as `workbench show JOB_ID:stderr.log` when that file is present. `show RUN_ID` also previews public provider evidence when available: model output, evidence-backed provider session refs, rubric scores, and rubric rationales. Provider session refs printed by Workbench evidence resolve through `show`, and native local provider sessions resolve when the local provider files exist. `workbench open` serves the same read-only snapshot as a foreground server and prints the bound URL plus a `Press Ctrl-C to stop` hint. All reads use local committed Workbench state and work without the project write lock, so they remain usable while an eval or improve is running. `status` can report sync `local_changes` when local source or objects have changed since the last successful sync; explicit `workbench sync cloud` is the repair and refresh command. Network freshness is explicit through `workbench sync cloud`, `publish`, `install`, and hosted command scheduling.

## Ergonomic invariants

These properties hold across every job and are checked when any of them changes:

- Zero flags on the happy path: each job's steady state needs no flags except `--cloud` (destination) and `--public`/`--team` (audience).
- One handle: `OWNER/SKILL` everywhere; URLs accepted, never required.
- One evaluation selector grammar: `--skills`/`--agents`/`--versions`, plural, manifest defaults, on every eval, improve, or compare command that selects measured source, runtime agents, or versions. Skill accessibility uses `--for codex|claude|all` because it selects coding-agent products, not eval agents.
- One install/list split: `workbench install SOURCE` mutates agent-visible skill roots, and `workbench skills` reads accessible skill inventory. Bare `workbench install` is a usage error, not a list shortcut.
- Install targets are hidden until needed: default commands answer the user's accessibility question; `--for`, `--global`, and `--dir` are the only exposed target controls for Codex and Claude.
- Source is package-wide: Workbench versions, evaluates, improves, and publishes the whole agent skill package, not only `SKILL.md`. Installed packages exclude `.workbench`; editable Workbench source comes from `workbench new DIR --from OWNER/SKILL`.
- The tool teaches itself: human output ends with at most one `next:` line, JSON envelopes carry at most one `next`, and the suggestion follows the causal chain (auth before link before sync before publish; authoring before publishing); bare `workbench` always tells a new user what to do next.
- Error remediations are command-shaped: when human output renders `next:`, the value is the command to run, and JSON `remediation` carries the same command without a prose wrapper.
- Seven taught lifecycle commands (`new`, `eval`, `improve`, `compare`, `publish`, `skills`, `install`); everything else is inspection or plumbing behind `workbench help --all`.
- Location-clear network: a run is the same object whether it executed locally or hosted, but ordinary reads never hide network synchronization. Hosted waits sync terminal evidence once; detached or stale hosted state is refreshed with explicit `workbench sync cloud`.
- Scriptable commands support `--json` with a schema-tagged envelope, so agents complete the same jobs with the same sequences. `workbench open` is browser-server only; agents use `log`, `show REF`, and `show REF:PATH` for non-browser inspection.
- Long-running JSON commands keep stdout to one schema-tagged JSON document and write progress to stderr.
- Short ids: object ids display as short unique prefixes, and any unambiguous prefix resolves wherever a REF is accepted; full ids live in JSON.
- Summary-first JSON: envelopes embed file manifests, never file contents; `show REF:PATH` is the only content read.
- One evidence tree: every run/job evidence file has one canonical user-facing path; internal `.workbench/` runtime files and raw trace metadata files are not addressable run/job evidence.
- `--dry-run` never writes: a dry run that mutates state is a defect, everywhere.
- Errors teach too: selector errors enumerate the configured values, and remote errors never embed raw response bodies.
