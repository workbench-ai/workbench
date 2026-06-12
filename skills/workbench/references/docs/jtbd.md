# Workbench Jobs To Be Done

This document is the canonical ergonomics reference for Workbench. Each job names the complete steady-state command sequence a user runs to get it done. The sequences below are a product contract, not documentation of incidental behavior: if completing a job requires more commands, more flags, or more prior knowledge than written here, that is a defect. Docs, the CLI help, the authored `workbench` skill, and the web UX must stay consistent with this file.

How to read each job: "steady state" is what a returning user types after one-time setup is done. One-time setup is listed separately and may include login, the first publish, or the first hosted run depending on the job. Every command sequence assumes manifest defaults from `.workbench/agents.yaml` and the optional `.workbench/skills.yaml`; selector flags exist only to intentionally broaden or narrow the matrix. The contract grammar lives in [`../SPEC.md`](../SPEC.md); the operator guide is [`cli.md`](cli.md).

## Job 1: Get my expertise into a skill others can run

Create a skill, validate it against representative cases, and make it installable for a team or the public.

    workbench new earnings-prep
    cd earnings-prep
    # edit SKILL.md and .workbench/cases/
    workbench eval
    workbench publish

One-time setup: `workbench login` once per machine; the first `publish` derives the `OWNER/SKILL` handle from the logged-in namespace and project folder, links the Cloud skill project, and defaults to `--private`. `workbench publish --as OWNER/SKILL` is the one-time override when the derived handle is wrong, and later bare `publish` uses the persisted handle. Steady state after that is bare `workbench publish` with zero flags, like bare `git push` after `git push -u`. Audience is a flag, not a config file: `--private` (default), `--team` (organization members), `--public` (anyone, including the public `skills` CLI through well-known discovery). `publish` ends by printing the exact `workbench install OWNER/SKILL` line to hand to others. No URLs are ever typed and the words "remote" and "sync" do not appear in this job.

## Job 2: Use a skill someone else made

    workbench install acme/earnings-prep

The `OWNER/SKILL` handle is the universal identifier for published skills. `install` detects which native targets exist on the machine (Codex home, Claude home, or local folder) and installs into them; repeated `--to codex|claude|local` selects targets explicitly and is remembered for next time, and `--yes` permits overwrite for non-interactive use. Full Cloud URLs are accepted when pasted from a browser but are never required. Private and team skills use the same handle with Workbench Cloud auth.

## Job 3: Define what good means for this skill

Eval authoring is file editing, not command running — the same way git has no command for writing code. The authored surface is `SKILL.md`, `.workbench/eval.yaml` (the score adapter), `.workbench/cases/*/case.yaml` (representative workflow inputs with rubrics or tests), and `.workbench/agents.yaml` (runtime configurations). The only commands are evidence capture and bookkeeping:

    workbench case add RUN_ID     # draft a regression case from a real run's evidence
    workbench case list
    workbench case rm case-003

`case add RUN_ID` exists because the best cases come from observed failures: the run id is sitting in the eval output the user just read, and one positional argument turns it into a trace-backed draft case awaiting expert acceptance criteria.

## Job 4: Find out if it is actually good

    workbench eval
    workbench eval --agents all -n 5
    workbench eval --rerun

`eval` runs the manifest-default matrix, records run/job/trace/artifact evidence, prints per-run results plus the score delta against the incumbent version (for example `primary v019 0.84 (was 0.79)`), and ends with one `next:` suggestion. The inline delta means `compare` is not needed in the daily single-skill loop. `-n` is shorthand for `--samples`. Failed execution is recorded as failed evidence with the error, never as missing data.

## Job 5: Run anywhere — weave between local and hosted runners

    workbench eval --cloud
    workbench improve --cloud

`--cloud` is the entire local/remote story: the same command, executed by the Workbench Cloud hosted runner against the linked Cloud skill. Local objects sync up before scheduling, evidence syncs back automatically as the hosted run progresses and completes, and the resulting runs are ordinary objects — `log`, `show`, and `compare` are location-blind, so a user can eval locally, improve in the cloud, and compare both in one scorecard without ever running a sync command. Syncing is something Workbench does, not something users do. One-time setup: `workbench login` must be active; if no Cloud skill is linked yet, the first `eval --cloud` or `improve --cloud` auto-links an unpublished Cloud skill project. Publishing installable source remains a separate explicit `workbench publish` action.

## Job 6: Make it better from evidence

    workbench improve
    workbench improve --cloud

`improve` requires failed or reviewed trace evidence, edits the one mutable primary skill with one agent (same plural `--skills`/`--agents` grammar as `eval`; values must resolve to exactly one entry each, and the error names the exact corrected command when they do not), records the candidate version plus proof-run evidence, and switches only when the proof run succeeds and beats the incumbent. Hosted `improve --cloud` follows that same switch contract after terminal Cloud evidence syncs back. Passing smoke traces are not improvement evidence.

## Job 7: Decide which agent or version to ship

    workbench compare
    workbench compare --agents all
    workbench compare --versions v017..v021

`compare` renders one scorecard for one eval definition across selected skills, agents, and versions, including the `baseline: none` no-skill row and failed runs as visible failure evidence. The web `Compare` surface is the browser counterpart over the same snapshot.

## Job 8: Understand what happened

    workbench                     # bare invocation = status + the next useful command
    workbench log                 # one reverse-chronological timeline of versions and runs
    workbench show r4f2           # any object id: run, job, trace, version, artifact, session
    workbench show r4f2:stderr.log
    workbench open                # read-only browser UI over the same snapshot

Three universal read verbs cover all inspection: `status` (where am I — worktree, runs, publication, sync health, auth), `log` (what happened, filterable with `--runs` or `--versions`), and `show` (give me the thing — interpreted run/job evidence, file listings for file-backed objects, or one file via `REF:PATH`). All reads work without the project write lock, so they remain usable while an eval or improve is running, locally or hosted.

## Ergonomic invariants

These properties hold across every job and are checked when any of them changes:

- Zero flags on the happy path: each job's steady state needs no flags except `--cloud` (destination) and `--public`/`--team` (audience).
- One handle: `OWNER/SKILL` everywhere; URLs accepted, never required.
- One selector grammar: `--skills`/`--agents`/`--versions`, plural, manifest defaults, on every command that selects.
- The tool teaches itself: each command ends with at most one `next:` line; bare `workbench` always tells a new user what to do next.
- Six taught commands (`new`, `eval`, `improve`, `compare`, `publish`, `install`); everything else is plumbing behind `workbench help --all`.
- Location-blind evidence: a run is the same object whether it executed locally or hosted; no user-facing sync step exists in any job.
- Every command supports `--json` with a schema-tagged envelope, so agents complete the same jobs with the same sequences.
