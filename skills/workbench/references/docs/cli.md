# Workbench CLI

The CLI is the canonical action surface for Workbench. It creates skill projects, runs evals, improves from evidence, publishes installable source, installs published skills, and opens the shared Workbench UI over committed Workbench objects. The web UI can start eval/improve through the same operation vocabulary, while CLI remains the scripted source of truth for command behavior and progress output.

[`jtbd.md`](jtbd.md) defines the jobs users complete with these commands and the exact steady-state sequences each job allows; this guide explains the commands themselves.

## Create

```bash
workbench new ./earnings-prep
cd ./earnings-prep
# edit SKILL.md and cases
workbench eval
cd ~/.claude/skills/existing-skill
workbench init
workbench clone test/workbench-smoke ./smoke
```

`new` writes `SKILL.md`, `.workbench/eval.yaml`, `.workbench/agents.yaml`, `.workbench/.gitignore`, and ignored runtime directories. It creates `.workbench/cases/` but no starter case; write at least one `.workbench/cases/*/case.yaml` before running `eval`. `init` adopts the current existing skill directory, requires `SKILL.md`, creates the same `.workbench` controls and runtime state, and does not rewrite `SKILL.md`. `clone OWNER/SKILL[@VERSION]|URL DIR` creates an editable Workbench project from published source: it hydrates the package plus authored `.workbench` controls when present, does not copy source runtime objects, refs, sync state, logs, locks, remotes, install ledgers, or `.agents` directories, and then initializes fresh local `.workbench/objects` and refs for the new project. Use `clone`, not `install`, when the goal is to evaluate or improve someone else's published skill.

Provider-backed cases can be prompt/rubric only. Local or command-backed cases additionally need either a top-level `command` in `case.yaml` or an executable `tests/test.sh` under the case directory, and shell tests write their public score to `$OUTPUT_DIR/result.json`. By default, new projects use a provider-backed Codex agent (`gpt-5.4-mini`, `auth=default`). Use `--agent claude`, `--agent local`, or `--agent command` to make that explicit, and use `--model` or `--auth` only with provider agents.
In JSON mode, `new` includes `createdPaths`, `defaultAgentSelection`, `setupCommands`, and `next`; while no workflow case exists, `next` is a headless command that creates a draft `.workbench/cases/case-001/case.yaml` plus an executable `tests/test.sh` harness. When `workbench new DIR` is run from outside the created project, the printed next command is scoped with `cd DIR && ...` so it is safe to run from the same shell.

Workbench creates source versions automatically at command boundaries. If the folder changed since the current version, the next command creates a content-derived version id before acting.

## Evaluate

```bash
workbench eval
workbench eval --agents all -n 5
workbench eval --skills all --agents all --samples 1 --rerun
workbench eval --dry-run --json
```

`eval` and `compare` use manifest defaults when selector flags are omitted. Use plural selectors only when intentionally broadening or narrowing the matrix:

```bash
workbench compare
workbench compare --skills all --agents all --versions all
workbench compare --versions 26059f9a..eac5699c
```

Human `compare` output reports average per-sample latency when a run has more than one sample, so a five-sample run is not displayed as a single inflated aggregate latency. Stored run evidence keeps the original aggregate timing.

`eval` prints the run summary, score deltas when available, and one executable `next:` command for the common next step. Below-perfect evidence points to `improve` only when the selected agent can run skill improvement; local or command agents without an `improveCommand` get the provider-backed improver setup chain instead. It always evaluates current source; inspect or switch historical versions with `show`, `diff`, `switch`, and `compare --versions`. `--rerun` bypasses cached evidence for the matrix selected by the current command; it does not remember selector or sample flags from a previous invocation. `--dry-run` resolves selectors, case count, sample count, cache reuse, location, and launch readiness for the same edited current source a real eval would reconcile, without creating versions, refs, runs, jobs, remote links, cancellation files, or sync state. Cloud dry-run previews would-create source versions in memory instead of requiring them to exist in local object state. When local provider auth, Workbench Cloud auth, hosted provider auth, or hosted organization-plan access is missing, dry-run still reports the no-write launch plan and marks readiness blocked with the setup command or plan remediation. During non-cached local and hosted runs, stderr reports sparse concrete progress so far from run/job state: phase, planned/completed/scored work, partial score when a nonterminal run has scored work, failures and cancellations, active job, evidence count, reported usage cost, and elapsed time. It never prints an ETA. `--cloud` resolves the current local plan, creates a local watchable live handle, then auto-links the Cloud skill if needed, validates provider auth and hosted plan access, syncs objects to Cloud without uploading that handle as a run object, and schedules hosted work with the same run id plus only the version id, selectors, and sample count. Hosted compute requires the linked Cloud skill to be organization-owned and backed by an active Team or Enterprise organization plan; personal Free skills can publish source but cannot start hosted eval or improve. If auto-link, provider auth, sync, plan validation, or scheduling fails before Cloud accepts the run, the local handle is terminalized with that error. It replaces the local live handle with the authoritative Cloud run snapshot when Cloud accepts the run, observes hosted inspection snapshot envelopes and state notices while it waits, then reports terminal evidence sync as its own progress phase before updating local `log`, `show`, and `compare` state. Press Ctrl-C once during an attached local or hosted wait to detach with exit 130; the run keeps running, the attached Cloud wait is aborted, and the CLI prints `next: workbench run watch RUN_ID`. Auto-linking does not publish installable source. Long-running JSON commands keep stdout to one JSON document and, after a run id exists, write `workbench.run.v1` snapshot JSON Lines to stderr.

## Improve

```bash
workbench improve
workbench improve --skills primary --agents default --budget 1 -n 1
workbench improve --dry-run --cloud --json
```

`improve` edits one mutable project skill package with one improvement-capable agent. The candidate may change `SKILL.md`, scripts, references, assets, and other package support files outside `.workbench/**`; ordinary improve does not rewrite `.workbench` eval or case controls. The flags stay plural to match `eval` and `compare`, but the selected values must resolve to exactly one skill and one agent. Run it only after scored below-perfect, failed, or reviewed eval evidence exists. Perfect eval runs are not meaningful improvement evidence. Unscored runtime or auth failures are not meaningful improvement evidence; historical scored smoke-labeled traces are still evidence. Evidence is selected by skill lineage and eval definition, not by exact eval-agent hash. The selected agent is both the improver and proof eval agent. Empty or perfect-only projects get evidence remediation first; perfect-only remediation creates the next unused draft case with a headless shell command instead of rerunning a perfect eval. Once actionable evidence exists, or a non-perfect terminal eval attempt already shows the selected agent is on the improve path, a non-improvement-capable selected agent gets setup remediation. When a one-sample proof run switches source, the printed next command is a higher-sample rerun before publishing. One-time provider setup for bare `workbench improve` is:

```bash
codex login --device-auth
workbench login codex --method oauth
workbench agent add default --adapter codex --model gpt-5.4-mini --with auth=default
```

`improve --dry-run` resolves the selected mutable skill, improvement/proof agent, evidence, incumbent, proof eval plan, location, auth readiness, and package write scope for the same edited current source a real improve would reconcile, without editing source, writing Workbench object state, scheduling proof work, syncing Cloud, or auto-linking a remote. Hosted `improve --cloud` validates that same local improve target and evidence before network sync, lets Cloud derive eval, skill bundle, agent, and evidence from Cloud's stored state, then syncs the accepted run locally before waiting and syncs the winning version back after terminal completion unless the local current version changed while the hosted run was in flight. When hosted improve switches the promoted version locally, it reconciles the same Cloud remote again before exit so `status` and `sync cloud --dry-run` agree. Perfect-only projects get a diagnostic with a draft-case command instead of an unconditional rerun command. If the selected eval agent cannot improve, Workbench suggests one provider-backed setup chain that captures provider auth, adds an improvement-capable agent, proves it, and then reruns improve; for hosted improve from a logged-out clean room, that chain begins with `workbench login`. Local and hosted improve progress uses the same stderr renderer as eval: evidence/improvement/patch phases first, then proof-eval work counters and partial proof score from run and job state.

## Run Operations

```bash
workbench run watch <run-id>
workbench run cancel <run-id>
workbench run retry <run-id>
```

`run` is the existing-run operation group. `run watch` resumes progress for a known local or hosted run and exits `0` when it successfully reports a terminal snapshot; read `run.status` to distinguish succeeded, failed, and canceled terminal outcomes. It exits `130` on user interrupt and nonzero when the run cannot be inspected or is still pending past the watch timeout. For active hosted runs, it observes Cloud state and syncs terminal evidence locally before returning; terminal hosted runs already synced locally summarize without contacting Cloud. `run cancel` requests cancellation without deleting evidence; local cancellation writes an ignored control request for the running command to observe at pending-job and cooperative running-job boundaries, pre-accept hosted cancellation terminalizes the local live handle before Cloud knows the run id, and accepted hosted cancellation calls the Cloud cancel API. `run retry` creates a new run from the selected run's stored operation plan and links it with `retryOfRunId`; it retries the whole run. Hosted retry validates that stored plan, creates a local watchable retry handle and progress line, then syncs or auto-links the Cloud skill before resolving the Cloud project and scheduling, so a canceled pre-accept hosted run can be retried without a manual publish. Improve retry uses the original improve base version recorded in that plan, not the previous candidate proof version. If the stored operation plan is missing or invalid, retry fails before scheduling and points to a fresh `eval` or `improve`. In `--json` mode, `run watch`, `run cancel`, and `run retry` return one command envelope whose `run` field is a `workbench.run.v1` snapshot; command-level `result`, `progress`, and `jobs` payloads are not part of the public lifecycle shape. Use fresh `eval` or `improve` when changing selectors, sample counts, budget, or location.

## Source And Selection

Simple projects do not need `.workbench/skills.yaml`; Workbench implicitly evaluates the root `SKILL.md` as `primary`. Add `.workbench/skills.yaml` only when comparing multiple measured skills or installing included skills beside a measured skill.

```yaml
default: all
skills:
  primary:
    path: .
    includes:
      - name: helper
        path: skills/helper
  no-skill:
    baseline: none
  upstream:
    from: github:anthropics/skills//skills/frontend-design
    ref: <commit-sha>
```

Top-level entries are measured skills. Each measured skill defines exactly one of `path`, `from`, or `baseline`; the only baseline value is `none`. Local paths must stay inside the project root. Nested `includes` are installed beside one measured skill and affect that bundle hash, but they are not comparison rows.

Agents use the same selector shape:

```yaml
default: default
agents:
  default:
    adapter: codex
    model: gpt-5.4-mini
    with:
      auth: default
```

`local` and `command` agents run Docker-style case tests directly. `codex` and `claude` agents run the provider as the skill executor and score the same cases through the configured score adapter. Connect provider auth before using provider-backed agents locally or in Cloud.

```bash
workbench agent add strict --adapter command --with command='sh "$CASE_DIR/tests/test.sh"'
codex login --device-auth
workbench login codex --method oauth
workbench agent add default --adapter codex --model gpt-5.4-mini --with auth=default
claude setup-token
CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth
workbench agent add opus --adapter claude --model opus --with auth=default
```

Quote command-valued `--with` assignments with single quotes so the shell does not expand Workbench runtime variables such as `$CASE_DIR`, `$OUTPUT_DIR`, or `$SKILL_DIR` before Workbench stores the command.

## Inspect

```bash
workbench
workbench status
workbench log
workbench log --runs
workbench log --versions
workbench versions
workbench show <run-id>
workbench show <job-id>
workbench show <version-id>:SKILL.md
workbench run watch <run-id>
workbench diff <base-version-id>..<improved-version-id>
workbench switch <version-id>
workbench open
```

Use `workbench show <run-id>` first after terminal multi-sample runs. It summarizes run facts, failed and canceled job groups, job ids, and copy-paste complete file commands such as `workbench show <run-id>:cases/.../output/result.json`; then use a specific job or trace ref such as `workbench show <job-id>:stderr.log` when that file is present. Use `workbench run watch <run-id>` for active runs.

Bare `workbench` is the same orientation view as `workbench status`. `status` is a local read and reports active runs with compact concrete progress and `workbench run watch RUN_ID` as the next command when a known run is queued or running. `log` shows one reverse-chronological timeline of versions and runs. `show REF` lists files for file-backed objects or shows interpreted run/job evidence; file lists print runnable `workbench show REF:PATH` commands and JSON file entries include both `path` and `ref`. `show RUN_ID` includes the same progress snapshot and evidence count used by watch/status before evidence details, and failed or canceled run pages omit self-referential `next: workbench show RUN_ID` hints. `show REF:PATH` reads one version, artifact, or run/job evidence file by exact path or unique canonical suffix. Internal `.workbench/` runtime files and raw trace metadata files such as `request.json`, `result.json`, and `trace.json` are not addressable evidence. Provider session refs printed by Workbench evidence, such as `codex:SESSION_ID` and `claude:SESSION_ID`, are resolved from that evidence through `show`; native local provider sessions are resolved when the local provider files exist.

`switch` materializes a recorded source version into the working folder and updates the current Workbench ref. It does not invoke Git.

`workbench open` serves the shared Workbench UI as a foreground server. `--port 0` is valid and prints the OS-assigned bound port plus the `Press Ctrl-C to stop` hint; pressing Ctrl-C closes the server and exits `0`. The browser receives snapshot envelopes and live state notices, so it can refresh when committed run state changes without active-run polling. It can start local eval/improve through the local operation endpoint; the endpoint starts the private local worker, returns a `workbench.run.v1` snapshot after durable run state is written, then the UI navigates to the returned run page while the worker continues. Use `log` and `show REF` for summary inspection, and `show REF:PATH` for content reads. The browser starts on `Files`, keeps comparison evidence under `Evaluation > Results`, lists authored eval definitions under `Evaluation > Cases`, and shows run history under `Activity`.

## Publish And Install

```bash
workbench login
workbench publish
workbench publish --as OWNER/SKILL
workbench publish --team
workbench publish --public
workbench unpublish <version-id>
workbench install test/workbench-smoke
workbench install test/workbench-smoke@<version-id>
workbench install test/workbench-smoke --target codex --scope global
workbench skills
workbench skills --target codex --scope global
```

`publish` links the project to a Workbench Cloud skill handle, records one source version in the published-version set, and moves the current publication pointer. The same version is exposed through two read surfaces: an installable agent skill package and editable Workbench source. The default handle is derived from the logged-in namespace and project folder; `--as OWNER/SKILL` sets or replaces it and is remembered for later bare `publish` commands. First publish defaults to `--private`; `--team` maps to organization-internal source visibility, and `--public` exposes source through the public discovery surface. Later bare `publish` preserves the last explicit audience. If Cloud already publishes the selected version with the requested handle and visibility as current, `publish` returns `Already published` after sync freshness checks instead of sending another publish mutation. `publish` returns the canonical `OWNER/SKILL` install handle and prints the exact `workbench install OWNER/SKILL` command; JSON exposes `installHandle`, not install URL fields, and keeps human progress prose off stderr. Prior published versions stay exact-addressable as `OWNER/SKILL@VERSION` until the owner runs `workbench unpublish VERSION`. `unpublish` cannot remove the current published version directly; publish another version first.

Sharing is the post-publish handoff. Use `workbench publish --team` for organization members or `workbench publish --public` for anyone, then send `workbench install OWNER/SKILL` to someone who only needs to use the skill or `workbench clone OWNER/SKILL[@VERSION]|URL DIR` to someone who needs editable source. Use `OWNER/SKILL@VERSION` when the recipient should pin to an exact still-published version.

`install` accepts the canonical `OWNER/SKILL` handle, `OWNER/SKILL@VERSION`, or a full Cloud URL and always requires that source argument. The bare handle installs the current published version; `@VERSION` installs an exact still-published version. With no flags, it installs the agent skill package for the current coding agent in the current folder. If the current coding agent cannot be detected, pass `--target codex` or `--target claude`. `--scope global` installs for the selected coding-agent target globally, and `--dir DIR` changes the folder-scope write root. Installing for both Codex and Claude is two explicit commands. Installs copy only package files such as `SKILL.md`, scripts, references, assets, and support files. They do not copy `.workbench` eval controls or runtime state into agent skill roots. Re-running the same handle over an unchanged Workbench-managed copy is idempotent. `--yes` permits overwriting changed or unmanaged destination content. `--dry-run --json` reports `result: "planned"` without writing package files or the root-local install ledger.

`skills` is the inventory command. With no flags, it scans Codex and Claude folder and global skill roots from the current directory. `--target codex|claude` narrows to one coding-agent product, `--scope folder|global` narrows to one access scope, and `--dir DIR` changes the folder-scope scan root. Inventory is read-only, performs no network access, and reports `current`, `modified`, `missing`, `unmanaged`, or `duplicate-name` status when visible.

Use `workbench clone OWNER/SKILL[@VERSION]|URL DIR` when the goal is to evaluate or improve someone else's published skill. That command creates editable project source with authored `.workbench` controls; `workbench install` only makes a package visible to a coding agent.

## Auth And Sync

```bash
workbench login
codex login --device-auth
workbench login codex --method oauth
claude setup-token
CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth
workbench login claude --method bedrock
workbench logout codex
workbench logout claude
workbench logout
workbench sync cloud
```

Bare `login` connects the CLI to Workbench Cloud and uploads any already-connected local provider auth bundles so hosted provider-backed work is ready even when `workbench login PROVIDER` was run first. For headless sessions, `login --start-only` or `login --no-open` records a pending device authorization and prints `workbench login --wait --timeout 120` as the bounded resume command. `login PROVIDER` captures provider adapter auth for local and hosted provider-backed agents. Shared Workbench test credentials prove Workbench Cloud login only; they do not include Codex or Claude provider OAuth and do not include an organization-plan hosted-compute entitlement by themselves. The validation path is provider OAuth only: when `~/.codex/auth.json` is missing, run `codex login --device-auth`, then `workbench login codex --method oauth`. For Claude, run `claude setup-token` in an interactive shell, complete browser authorization, copy the OAuth token it prints, then run `CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth`. For isolated validation, pass `--profile-root DIR` to read provider-native state from an alternate home root: Codex reads `DIR/.codex/auth.json`; Claude reads `DIR/.claude.json` plus `CLAUDE_CODE_OAUTH_TOKEN`. Once Workbench captures provider auth, provider-backed Workbench runs do not require the native provider files to exist in the current `HOME`. Real hosted eval/improve success additionally requires an organization-owned Cloud skill under an active Team or Enterprise plan. `status` reports Cloud auth, connected provider auth, linked publication state, active local run state, and per-remote sync health from local state in both project and non-project directories. Per-remote sync is local-only and may be `never`, `up_to_date`, `local_changes`, or `error`; `local_changes` means an explicit `workbench sync REMOTE` would push local source or local-only object changes. Cloud-owned hosted run evidence imported by a hosted wait or `run watch` does not dirty sync status, and intentional hosted cancel or detach during pre-schedule sync does not record the in-flight abort as a remote sync error. Read commands do not sync; use `workbench run watch RUN_ID` to resume a known detached run, syncing terminal hosted evidence when needed, and use explicit `workbench sync cloud` for object-exchange repair or portability. `sync --dry-run` is a remote probe; if it reports changes while `status` is locally up to date, run the printed sync command to reconcile remote state. Error `remediation` values and human `next:` lines are command-shaped, without prose prefixes such as "Run".

Bare `logout` logs out of Workbench Cloud and leaves provider credentials unchanged. `logout PROVIDER` removes Workbench's captured provider credentials even when Cloud auth is already absent; remote provider cleanup is best-effort when Cloud auth is available. In JSON output, `remoteAdapterAuth.status` describes the remote provider connection after cleanup (`disconnected`, `unchanged`, or `unknown`), while `remoteAdapterAuth.workbenchCloud.status` describes whether Workbench Cloud auth was available for that cleanup. Native provider CLI auth such as Codex or Claude profiles is owned by that provider and is not deleted by Workbench.

Remotes are Workbench object endpoints, not Git remotes. They are local metadata in `.workbench/remotes.yaml` and are normally created by `publish` or by the first logged-in `eval --cloud`/`improve --cloud`. `sync` is plumbing for repairing or testing object-pack exchange; the taught sharing path is `publish` and `install`.

## Cases

Cases live under `.workbench/cases`. Create, list, edit, and remove cases with the filesystem. To turn a failure into a regression case, inspect the evidence with `workbench show RUN_ID` and write the case files directly.
