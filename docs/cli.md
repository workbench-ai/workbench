# Workbench CLI

The CLI is the canonical action surface for Workbench. It creates skill projects, runs and grades eval cases, improves from evidence, publishes installable source, installs published skills, and opens the shared Workbench UI over committed Workbench objects. Local web UI can start run/grade/eval/improve through the same operation vocabulary, hosted web UI exposes the operation kinds Cloud can start, and CLI remains the scripted source of truth for command behavior and progress output.

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

`new` writes `SKILL.md`, `.workbench/eval.yaml`, `.workbench/agents.yaml`, `.workbench/.gitignore`, and ignored runtime directories. It creates `.workbench/cases/` but no starter case; write at least one `.workbench/cases/*/case.yaml` before running `run`, `grade`, or `eval`. `init` adopts the current existing skill directory, requires `SKILL.md`, creates the same `.workbench` controls and runtime state, and does not rewrite `SKILL.md`. `clone OWNER/SKILL[@VERSION]|URL DIR` creates an editable Workbench project from published source: it hydrates the package plus authored `.workbench` controls when present, does not copy source runtime objects, refs, sync state, logs, locks, remotes, install ledgers, or `.agents` directories, and then initializes fresh local `.workbench/objects`, `.workbench/refs`, and `.workbench/sync` state for the new project. Seeing those runtime directories after clone means the new project was initialized; it does not mean source runtime state was copied. Use `clone`, not `install`, when the goal is to evaluate or improve someone else's published skill.

Provider-backed cases can be prompt/rubric only. Local or command-backed cases additionally need either a top-level `command` in `case.yaml` or an executable `tests/test.sh` under the case directory, and shell tests write their public score to `$OUTPUT_DIR/result.json`. By default, new projects use a provider-backed Codex agent (`gpt-5.4-mini`, `auth=default`). Use `--agent claude`, `--agent local`, or `--agent command` to make that explicit, and use `--model` or `--auth` only with provider agents.
In JSON mode, `new` includes `createdPaths`, `defaultAgentSelection`, `setupCommands`, and `next`. While no workflow case exists, `next` is `workbench case draft CASE_ID`, which creates a draft `.workbench/cases/CASE_ID/case.yaml` plus an executable `tests/test.sh` harness. The case-draft `next` command opens both generated files because local and command-backed cases need both the prompt/rubric and the test harness to be replaced. Provider-backed setup remains visible in `setupCommands` and human output says that provider setup is still required before provider-backed eval. Draft placeholders are launch gates: `run` requires the prompt placeholder to be replaced, while `grade` and `eval` also require the rubric placeholder to be replaced before judgment evidence can be recorded. The generated harness intentionally fails with score `0` until the placeholder assertions are replaced. Real no-case evals fail before scheduling; `eval --dry-run` still returns a no-write preview with `cases=0` and any non-case launch readiness issues. When the next command is project-local and `workbench new DIR` is run from outside the created project, the printed command is scoped with `cd DIR && ...` so it is safe to run from the same shell.

Workbench creates source versions automatically when commands need current source. If the folder changed since the current version, commands such as `eval`, `improve`, `publish`, `show current`, `status`, and default `diff` create a content-derived version id before acting or reporting current source. `versions` is pure inspection: it lists committed versions without reconciling edited files.

## Evaluate

```bash
workbench run
workbench grade
workbench eval
workbench eval --agents all -n 5
workbench eval --versions all --agents all --samples 1 --rerun
workbench eval --dry-run --json
```

`run`, `grade`, `eval`, and `results` use manifest defaults when selector flags are omitted. Use plural selectors only when intentionally broadening or narrowing the matrix:

```bash
workbench results
workbench results --versions all --agents all
```

Human list output is optimized for scanning, not scripting. `results`, `skills`, `versions`, `agent list`, and `log` use plain aligned tables with lowercase headers. Use `--json` for stable automation; JSON output never includes terminal color.

`workbench run` executes selected cases only. It records execute jobs, runner traces, runner output artifacts, and workspace artifacts, and never invokes the grade adapter. `workbench grade` judges existing eligible execution jobs only; it starts each grade job from a clean workspace with subject output, workspace, traces, and result mounted read-only through dependencies. `workbench eval` combines both phases, creating missing or stale execute and grade jobs while reusing current evidence whenever possible. Scores are projected from grade job result items, not stored directly on runs or jobs.

For interactive eval development with the default Codex agent (`gpt-5.4-mini`), draft or edit one case, run it with `workbench run --agents default --cases CASE_ID`, inspect `workbench show RUN_ID` or `workbench show EXECUTE_JOB_ID`, add or edit the rubric, then call `workbench grade --agents default --cases CASE_ID`. Prompt, public case input, source, agent, or sample changes make execution stale; rubric, grade adapter, grader config, or private grader-file changes make grading stale only. Repeated `grade` reuses current eligible execute jobs, reuses current grade evidence including failed grade attempts, and never reruns Codex. If a rubric-only edit follows `workbench run`, `workbench eval` reuses the existing execute job and creates only the missing grade job. `grade --rerun` forces fresh grading only, while `eval --rerun` forces both selected execute and grade phases. Each grade job starts from a clean workspace and can read the subject output, workspace, traces, and result through read-only dependencies without inheriting prior grading state.

Human `results` output reports average per-sample latency when a run has more than one sample, so a five-sample run is not displayed as a single inflated aggregate latency. Stored run evidence keeps the original aggregate timing. Results tables stay evidence-first and omit selected cells with no run, but when the selected current version has no recorded results the human output says so and points back to `workbench eval`; JSON keeps the full selected matrix, gives each selected local source version a distinct ordinal label, and exposes the same top-level `next`. `results` is read-only over committed local Workbench state: it does not reconcile edited files, create missing versions, persist derived eval snapshots, or rewrite refs.

`eval` prints the run summary, score deltas when available, and one command-shaped `next:` command for the common next step. Below-perfect evidence points to `improve` only when the selected agent can run skill improvement; local or command agents without an `improveCommand` first get a provider-backed `workbench agent add improver ...` setup step when no improver exists, then provider setup for that improver, then status advances to the improver rerun after that agent is runnable. Bare `status` demotes optional provider setup for an already-added but unauthenticated improver to `workbench results` so ordinary local inspection and result review do not look blocked by provider auth; explicit `agent add`, `eval --agents improver`, and `improve` still print their concrete setup commands. Once cases exist and no current proof is available, bare `status` uses the same default eval launch readiness as dry-run, so a provider-backed default scaffold points to provider setup instead of `workbench eval` when that eval would immediately fail. Provider setup commands are native-aware: if the native Codex auth file or Claude OAuth material is already present, readiness output skips the native login step and starts at `workbench login PROVIDER --method oauth`. It always evaluates current source; inspect or switch historical source with `show`, `diff`, `switch`, and `results`. `--rerun` bypasses cached evidence for the matrix selected by the current command; for `eval`, it forces both selected execute and grade phases. It does not remember selector or sample flags from a previous invocation. `--dry-run` resolves selectors, case count, sample count, execute jobs, grade jobs, cached jobs, location, and launch readiness for the same edited current source a real eval would reconcile, without creating versions, refs, runs, jobs, remote links, cancellation files, or sync state. Hosted dry-run does not report reusable local `cachedRunIds`; Cloud must create hosted evidence. Cloud dry-run previews would-create source versions in memory instead of requiring them to exist in local object state. When draft placeholders, local provider auth, local Docker sandbox availability, Workbench Cloud auth, hosted provider auth, or hosted organization-plan access is missing, dry-run still reports the no-write launch plan and marks readiness blocked. A no-case dry-run keeps top-level `next` on `workbench case draft CASE_ID` because real eval cannot launch yet; draft prompt/rubric blockers point to the case file before provider or Docker setup. Other blocked dry-runs normally choose one command-shaped first setup step when one exists, preferring immediate auth/setup commands before hosted plan blockers. Hosted organization-plan blockers keep the full publish-and-rerun command with `ORG/SKILL` placeholders because publishing alone does not complete the requested hosted launch. JSON readiness issues keep full command setup sequences in `subject.setupCommands` when available. A real local run, grade, or eval uses the same readiness gate before scheduling; draft placeholders, missing provider auth, unavailable Docker, or an unready grade adapter stops before source-version persistence and run/job/evidence writes. During non-cached local and hosted runs, stderr reports sparse concrete progress so far from run/job state: phase, planned/completed/scored work, partial score when a nonterminal run has scored work, failures and cancellations, active job, evidence count, reported usage cost, and elapsed time. It never prints an ETA. `--cloud` resolves the current local plan, validates selected hosted provider auth and hosted plan access when knowable, creates a temporary local live handle, then auto-links the Cloud skill if needed, syncs objects to Cloud without uploading that handle as a run object, and schedules hosted work with the same run id plus only the version id, selectors, and sample count. Hosted eval creates execute jobs and grade jobs with explicit subject dependencies. Before Cloud accepts the run id, human progress is labeled as preparing the Workbench Cloud run; JSON mode suppresses `workbench.run.v1` progress until durable acceptance, and queued plus hosted-worker wording is reserved for accepted Cloud run snapshots. Hosted compute requires the linked Cloud skill to be organization-owned and backed by an active Team or Enterprise organization plan; personal Free skills can publish source but cannot start hosted eval or improve. Personal hosted-plan blockers that are knowable from the linked or derived target return before temporary handles, auto-linking, sync, or scheduling. If auto-link, sync, resolving, or scheduling fails before Cloud accepts the run after a temporary handle exists, Workbench clears the temporary handle and returns the setup error without adding failed run evidence to `log` or `show`; the cleared correlation id may appear as `subject.correlationRunId`, but it is not a top-level `runId` and is not watchable or showable. Pre-accept cancellation still terminalizes the local handle so the cancellation is inspectable. It replaces the local live handle with the authoritative Cloud run snapshot when Cloud accepts the run, observes hosted inspection snapshot envelopes and state notices while it waits, then reports terminal evidence sync as its own progress phase before updating local `log`, `show`, and `results` state. Press Ctrl-C once during an attached local or hosted wait to detach with exit 130; the run keeps running, the attached Cloud wait is aborted, and the CLI prints `next: workbench watch RUN_ID`. Auto-linking does not publish installable source. Long-running JSON commands keep stdout to one JSON document and, after a durable accepted run id exists, write `workbench.run.v1` snapshot JSON Lines to stderr. Terminal failed or canceled run snapshots and terminal `watch` output omit self-referential `next: workbench show RUN_ID` hints.

## Improve

```bash
workbench improve
workbench improve --versions current --agents default --budget 1 -n 1
workbench improve --dry-run --cloud --json
```

`improve` edits one mutable project skill version with one improvement-capable agent. The candidate may change `SKILL.md`, scripts, references, assets, and other package support files outside `.workbench/**`; ordinary improve does not rewrite `.workbench` eval or case controls. The flags stay plural to match `eval` and `results`, but the selected values must resolve to exactly one version and one agent. Run it only after graded below-perfect, failed, or reviewed eval evidence exists. Perfect eval runs are not meaningful improvement evidence, and a perfect current comparable eval for the selected proof agent suppresses older below-perfect traces for that same eval definition. Ungraded execution-only output, unscored runtime failures, and auth failures are not meaningful improvement evidence; historical scored smoke-labeled traces are still evidence. Evidence is selected by version lineage and eval definition, not by exact eval-agent hash. The selected agent is both the improver and proof eval agent. Empty or perfect-only projects get evidence remediation first; perfect-only remediation creates the next unused draft case with `workbench case draft CASE_ID` instead of rerunning a perfect eval. Once actionable evidence exists, a non-improvement-capable selected agent gets setup remediation. When a one-sample proof run switches source, the printed next command is a higher-sample rerun before publishing. One-time provider setup for bare `workbench improve` is:

```bash
codex login --device-auth
workbench login codex --method oauth
workbench agent add default --adapter codex --model gpt-5.4-mini --with auth=default
```

`improve --dry-run` resolves the selected mutable version, improvement/proof agent, evidence, incumbent, proof eval plan, location, auth plus local Docker sandbox readiness, and package write scope for the same edited current source a real improve would reconcile, without editing source, writing Workbench object state, scheduling proof work, syncing Cloud, or auto-linking a remote. Hosted `improve --cloud` validates that same local improve target and evidence before hosted plan checks, auto-linking, or network sync, lets Cloud derive eval, skill bundle, agent, and evidence from Cloud's stored state, then syncs the accepted run locally before waiting and syncs the winning version back after terminal completion unless the local current version changed while the hosted run was in flight. When hosted improve switches the promoted version locally, it reconciles the same Cloud remote again before exit so `status` and `sync cloud --dry-run` agree. Perfect-only projects get a diagnostic with a draft-case command instead of an unconditional rerun command. Once actionable evidence exists, if the selected eval agent cannot improve, Workbench reports `improve_adapter_required` for dry-run and real improve and suggests the first setup command; it reuses an existing improvement-capable `improver` when one is configured and only starts with `workbench agent add improver ...` when no improver exists. JSON `subject.setupCommands` includes the staged provider auth, improver rerun, and improve commands. For hosted improve from a logged-out clean room, Cloud auth is the first blocked readiness step. Local and hosted improve progress uses the same stderr renderer as eval: evidence/improvement/patch phases first, then proof-eval work counters and partial proof score from run and job state.

## Known Run Operations

```bash
workbench watch <run-id>
workbench cancel <run-id>
workbench retry <run-id>
```

Known-run lifecycle operations are top-level commands. `watch` resumes progress for a known local or hosted run and exits `0` when it successfully reports a terminal snapshot; read `run.status` to distinguish succeeded, failed, and canceled terminal outcomes. It exits `130` on user interrupt and nonzero when the run cannot be inspected or is still pending past the watch timeout. For active hosted runs, it observes Cloud state and syncs terminal evidence locally before returning; terminal hosted runs already synced locally summarize without contacting Cloud. Failed or canceled terminal watch output omits a self-referential `next: workbench show RUN_ID`; succeeded eval watch/retry still prints the next results command, preserving non-default version or agent selectors so a run evaluated with `--agents strict` points to `workbench results --agents strict` instead of bare results that would select the manifest default. `cancel` requests cancellation without deleting evidence; local cancellation writes an ignored control request for the running command to observe at pending-job and cooperative running-job boundaries, pre-accept hosted cancellation terminalizes the local live handle before Cloud knows the run id, and accepted hosted cancellation calls the Cloud cancel API. `retry` creates a new run from the selected run's stored operation plan and links it with `retryOfRunId`; it retries the whole run. Hosted retry validates that stored plan, creates a local watchable retry handle and progress line, then syncs or auto-links the Cloud skill before resolving the Cloud project and scheduling, so a canceled pre-accept hosted run can be retried without a manual publish. Improve retry uses the original improve base version recorded in that plan, not the previous candidate proof version. If the stored operation plan is missing or invalid, retry fails before scheduling and points to a fresh `run`, `grade`, `eval`, or `improve`. In `--json` mode, `watch`, `cancel`, and `retry` return one command envelope whose `run` field is a `workbench.run.v1` snapshot; command-level `result`, `progress`, and `jobs` payloads are not part of the public lifecycle shape. Use fresh `run`, `grade`, `eval`, or `improve` when changing selectors, sample counts, budget, or location.

## Source And Selection

Simple projects do not need `.workbench/versions.yaml`; Workbench implicitly evaluates the root `SKILL.md` as `current`. Add `.workbench/versions.yaml` only when evaluating multiple measured versions or installing included skills beside a measured version.

```yaml
default: all
versions:
  current:
    source: local:.
    includes:
      - name: helper
        source: local:skills/helper
  no-skill:
    source: none
    label: No skill
  upstream:
    source: github:anthropics/skills//skills/frontend-design@<40-character-commit-sha>
```

For the implicit root `current` version, result labels default to the `name` frontmatter in `SKILL.md` with a stable local source ordinal appended, so JSON consumers can distinguish multiple unrun local source snapshots even when filtering to one row. Use `label` only when a configured version needs an explicit display override.

Top-level entries are measured versions. Each measured version defines one `source:` string. `source: local:PATH` must stay inside the project root, `source: none` is the no-skill baseline, and external sources must be immutable pins such as `workbench:OWNER/SKILL@VERSION` or `github:OWNER/REPO//PATH@COMMIT`; GitHub `COMMIT` must be the full 40-character SHA, not a branch, tag, or short prefix. Nested `includes` are installed beside one measured version and affect that bundle hash, but they are not result rows.

Agents use the same selector shape. Agent configuration is snapshotted as the agent axis in eval results; changing `.workbench/agents.yaml` with `agent add`, `agent rm`, or `agent default` does not create a new skill-source version by itself.

```yaml
default: default
agents:
  default:
    adapter: codex
    model: gpt-5.4-mini
    with:
      auth: default
```

`local` and `command` agents run Docker-style case tests directly, and local provider-backed eval/improve still uses the Docker sandbox around the adapter runtime. `codex` and `claude` agents run the provider as the skill executor and grade the same cases through the configured grade adapter. Connect provider auth before using provider-backed agents locally or in Cloud.

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
workbench watch <run-id>
workbench diff <base-version-id>..<improved-version-id>
workbench switch <version-id>
workbench open
```

Use `workbench show <run-id>` first after terminal multi-sample runs. It summarizes run facts, failed and canceled job groups, job ids, and copy-paste complete file commands such as `workbench show <run-id>:cases/.../output/result.json`; then use a specific job or trace ref such as `workbench show <job-id>:stderr.log` when that file is present. Use `workbench watch <run-id>` for active runs.

Bare `workbench` is the same orientation view as `workbench status`. `status` is a local read and reports active runs with compact concrete progress and `workbench watch RUN_ID` as the next command when a known run is queued or running. It also hashes edited package source without committing it: JSON reports `worktree.sourceState: "would_create"` plus `worktree.wouldCreateVersionId`, and human output prints `Worktree source: edited (would create VERSION)`. Once cases exist, status normally points to `workbench eval`; when edited source has current scored evidence from one non-default eval agent, it preserves that selector as `workbench eval --agents AGENT`. If the selected or default eval is not launch-ready because provider auth or the local Docker sandbox is missing, status points to the first concrete setup step instead. `log` shows one reverse-chronological timeline of versions and runs. `versions` lists committed immutable source versions only; it does not create a new version for edited files. `show REF` lists files for file-backed objects or shows interpreted run/job evidence; file lists print runnable `workbench show REF:PATH` commands and JSON file entries include both `path` and `ref`. `show RUN_ID` includes the same progress snapshot and evidence count used by watch/status before evidence details, and failed or canceled run pages omit self-referential `next: workbench show RUN_ID` hints. Human job sample labels are one-based like live progress. `show REF:PATH` reads one version, artifact, or run/job evidence file by exact path or unique canonical suffix. Internal `.workbench/` runtime files and raw trace metadata files such as `request.json`, `result.json`, and `trace.json` are not addressable evidence. Provider session refs printed by Workbench evidence, such as `codex:SESSION_ID` and `claude:SESSION_ID`, are resolved from that evidence through `show`; native local provider sessions are resolved when the local provider files exist.

`results --versions all` keeps historical source snapshots visible, `results --versions current` narrows to the current source snapshot, and an unambiguous version-id prefix selects that exact result row. Human output renders recorded evidence rows and says when selected current or historical versions are unrun and omitted from the table; JSON keeps the full selected matrix. Canceled partial evals keep status and sample coverage but show `n/a` quality instead of treating the scored subset as the full result.

`switch` materializes a recorded source version into the working folder and updates the current Workbench ref. It does not invoke Git.

`workbench open` serves the shared Workbench UI as a foreground server. `--port 0` is valid and prints the OS-assigned bound port plus the `Press Ctrl-C to stop` hint; pressing Ctrl-C closes the server and exits `0`. The browser receives snapshot envelopes and live state notices, so it can refresh when committed run state changes without active-run polling. Local full-access pages can start run/grade/eval/improve through the local operation endpoint; hosted pages expose only the operation kinds the Cloud host can start. The endpoint starts the private local worker, returns a `workbench.run.v1` snapshot after durable run state is written, then the UI navigates to the returned run page while the worker continues. Use `log` and `show REF` for summary inspection, and `show REF:PATH` for content reads. The browser starts on `Files`, keeps result evidence under `Evaluation > Results`, lists authored eval definitions under `Evaluation > Cases`, and shows run history under `Runs`.

## Publish And Install

```bash
workbench login
workbench publish
workbench publish --as OWNER/SKILL
workbench publish --team
workbench publish --public
workbench unpublish <version-id> --dry-run
workbench unpublish <version-id>
workbench delete OWNER/SKILL --dry-run
workbench delete OWNER/SKILL --yes
workbench install test/workbench-smoke
workbench install test/workbench-smoke@<version-id>
workbench install test/workbench-smoke --target codex --scope global
workbench skills
workbench skills --target codex --scope global
```

`publish` links the project to a Workbench Cloud skill handle, records one source version in the published-version set, and moves the current publication pointer. After a successful publish, the persisted remote sync fingerprint includes those publication refs, so `status` reports the remote as `up_to_date` and `sync cloud --dry-run` reports no push or pull work unless additional local-owned changes exist. The same version is exposed through two read surfaces: an installable agent skill package and editable Workbench source. The default handle is derived from the logged-in namespace and project folder; `--as OWNER/SKILL` sets or replaces it and is remembered for later bare `publish` commands. First publish defaults to `--private`; `--team` maps to organization-internal source visibility, and `--public` exposes source through the public discovery surface. `--team` requires an organization-owned skill and user-facing errors say team visibility rather than leaking internal storage enum names. Later bare `publish` preserves the last explicit audience. If Cloud already publishes the selected version with the requested handle and visibility as current, `publish` returns `Already published` after sync freshness checks instead of sending another publish mutation. Real `publish` returns the canonical `OWNER/SKILL` install handle and prints the exact `workbench install OWNER/SKILL` command; dry-run keeps `next` on the exact non-dry-run publish command and exposes the future install handoff separately as JSON `installCommand` and human `after publish:`. JSON exposes `installHandle`, not install URL fields, and keeps human progress prose off stderr. Prior published versions stay addressable as `OWNER/SKILL@VERSION` until the owner runs `workbench unpublish VERSION`; `VERSION` may be the full version id or any unambiguous displayed prefix. `unpublish --dry-run` checks that the exact prior version is removable, reports the current published version, and prints the exact non-dry-run `workbench unpublish VERSION` follow-up without deleting source availability or rewriting local publication refs. Non-dry-run `unpublish` cannot remove the current published version directly; it validates that the target is a removable prior version before printing destructive removal progress. Current-version errors recommend `workbench publish VERSION` for a concrete still-published replacement when one is available, otherwise `workbench versions`. `workbench delete OWNER/SKILL --dry-run` previews deletion of the entire Cloud skill project; `workbench delete OWNER/SKILL --yes` removes that project, including published source, install package, hosted runs, and synced objects. When run from a project linked to that handle, delete also removes the dead Cloud remote and local publication refs. Use `unpublish` for one exact source version and `delete` only for whole-project cleanup such as disposable validation handles.

Sharing is the post-publish handoff. Use `workbench publish --team` for organization members or `workbench publish --public` for anyone, then send `workbench install OWNER/SKILL` to someone who only needs to use the skill or `workbench clone OWNER/SKILL[@VERSION]|URL DIR` to someone who needs editable source. Use `OWNER/SKILL@VERSION` when the recipient should pin to a still-published version; the version ref may be the full id or any unambiguous displayed prefix.

`install` accepts the canonical `OWNER/SKILL` handle, `OWNER/SKILL@VERSION`, or a full Cloud URL and always requires that source argument. The bare handle installs the current published version; `@VERSION` installs an exact still-published version. With no flags, it installs the agent skill package for the current coding agent in the current folder. If the current coding agent cannot be detected, pass `--target codex` or `--target claude`. `--scope global` installs for the selected coding-agent target globally, and `--dir DIR` changes the folder-scope write root. Installing for both Codex and Claude is two explicit commands. Installs copy only package files such as `SKILL.md`, scripts, references, assets, and support files. They do not copy `.workbench` eval controls or runtime state into agent skill roots. Re-running the same handle over an unchanged Workbench-managed copy is idempotent and reports `result: "unchanged"` in real and dry-run output. If the Cloud source version changed but the installable package bytes are the same, install reports `metadataChanged: true`, `filesCopied: 0`, and updates only the root-local install ledger on real runs. `--yes` permits overwriting changed or unmanaged destination content. Overwrite remediation preserves the source pin, scope, directory, and any explicit target flag from the attempted command, but omits target flags that were only inferred from the current coding agent. `--dry-run --json` writes no package files or install ledger, reports `result: "planned"` only when a real run would copy files or update metadata, keeps `filesCopied` at `0` because it is an actual-write count, and returns the exact non-dry-run install command as `next`; human planned dry-runs print the same command in `next:`. Scripts may use flag aliases for required inputs: `new --dest`, `clone --source --dest`, `install --source`, `publish|unpublish|switch --version`, `delete --source`, `show --ref`, `diff --range`, `sync --remote`, `case draft --id`, `agent add|rm --name`, and `watch|cancel|retry --run`.

`skills` is the inventory command. With no flags, it scans configured Codex and Claude folder and global skill roots visible from the current directory; it also reports the current editable Workbench project itself when the command is run from a folder containing `SKILL.md` and `.workbench` controls, even if that folder is not under an agent skill root. It does not search arbitrary sibling folders, and empty human output includes that hint with the `workbench init` path for sibling `SKILL.md` folders. `--target codex|claude` narrows to one coding-agent product, `--scope folder|global` narrows to one access scope, and `--dir DIR` changes the folder-scope scan root. Broad inventory sorts folder rows before global rows, managed/current or Workbench-project rows before unmanaged rows, and the detected current coding agent before other targets so the skill you just installed or are standing in is not buried by global skill sprawl. Broad inventory omits unmanaged global rows by default; request `--scope global` to inspect every global skill root entry. Inventory is read-only, performs no network access, and reports `current`, `modified`, `missing`, `project`, `unmanaged`, or `duplicate-name` status when visible. `project` means the local skill folder has Workbench project controls but was not installed from a published handle.

Use `workbench clone OWNER/SKILL[@VERSION]|URL DIR` when the goal is to evaluate or improve someone else's published skill. That command creates editable project source with authored `.workbench` controls; `workbench install` only makes a package visible to a coding agent. Installed package directories use the published handle's `SKILL` segment so the publish/install/clone handoff name stays consistent even if `SKILL.md` frontmatter contains a different display name. `install --dry-run` writes nothing; planned installs print the exact non-dry-run install command, unchanged targets report `unchanged`, package-unchanged version updates report `metadataChanged`, and modified or unmanaged destinations report `blocked`, `requiresOverwrite: true`, and the exact `--yes` retry command instead of implying the overwrite is already planned.

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

Bare `login` connects the CLI to Workbench Cloud and uploads any already-connected local provider auth bundles so hosted provider-backed work is ready even when `workbench login PROVIDER` was run first. For headless sessions, `login --start-only` or `login --no-open` records a pending device authorization and prints `workbench login --wait --timeout 120` as the bounded resume command; with `--json`, open `verificationUriComplete`, sign in and approve the device request, then run the printed resume command. `login PROVIDER` captures provider adapter auth for local and hosted provider-backed agents. Shared Workbench test credentials prove Workbench Cloud login only; they do not include Codex or Claude provider OAuth and do not include an organization-plan hosted-compute entitlement by themselves. The validation path is provider OAuth only: when `~/.codex/auth.json` is missing, run `codex login --device-auth`, then `workbench login codex --method oauth`. Empty or malformed Codex `auth.json` files are treated as missing native auth for readiness and rejected by `workbench login codex --method oauth` with `provider_oauth_invalid`. Profile-root Codex setup renders as a staged `setup:` block: create `DIR/.codex`, run `CODEX_HOME=DIR/.codex codex login --device-auth`, then capture with `workbench login codex --method oauth --profile-root DIR`; the executable `next:` remains the first provider CLI command. For Claude, run `claude setup-token` in an interactive shell, complete browser authorization, copy the OAuth token it prints, then run `CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth`. For isolated validation, pass `--profile-root DIR` to read provider-native state from an alternate home root: Codex reads `DIR/.codex/auth.json`; Claude reads `DIR/.claude.json` plus `CLAUDE_CODE_OAUTH_TOKEN`. Once Workbench captures provider auth, provider-backed Workbench runs and nested rubric judges do not require the native provider files to exist in the current `HOME` and must not fall back to API-key environment requirements such as `OPENAI_API_KEY`. Real hosted eval/improve success additionally requires an organization-owned Cloud skill under an active Team or Enterprise plan. `status` reports Cloud auth, connected provider auth, linked publication state, active local run state, and per-remote sync health from local state in both project and non-project directories. Per-remote sync is local-only and may be `never`, `up_to_date`, `local_changes`, `auth_required`, or `error`; `local_changes` means an explicit `workbench sync REMOTE` would push local source or local-only object changes, while `auth_required` means the linked Workbench Cloud remote cannot be reconciled until `workbench login` succeeds. When local changes exist but the primary workflow next step is still results, eval, or watch, status also exposes `syncNext` in JSON and `sync next: workbench sync REMOTE --dry-run` in human output. A logged-out published Cloud remote, or any logged-out Cloud remote whose local state needs reconciliation, reports `auth_required` even when the last authenticated sync was locally `up_to_date`. Cloud-owned hosted run evidence imported by a hosted wait or `watch` does not dirty sync status, and intentional hosted cancel or detach during pre-schedule sync does not record the in-flight abort as a remote sync error. Read commands do not sync; use `workbench watch RUN_ID` to resume a known detached run, syncing terminal hosted evidence when needed, and use explicit `workbench sync cloud` for object-exchange repair or portability. `sync --dry-run` is a remote probe; if it reports changes while `status` is locally up to date, run the printed sync command to reconcile remote state. Error `remediation` values and human `next:` lines are command-shaped, without prose prefixes such as "Run"; errors with staged `subject.setupCommands` also render a human `setup:` block.

Bare `logout` logs out of Workbench Cloud and leaves provider credentials unchanged. `logout PROVIDER` removes Workbench's captured provider credentials even when Cloud auth is already absent; if no captured provider record exists, it reports the local adapter as disconnected without creating an auth-store marker. Remote provider cleanup is best-effort when Cloud auth is available. In JSON output, `remoteAdapterAuth.status` describes the remote provider connection after cleanup (`disconnected`, `unchanged`, or `unknown`), while `remoteAdapterAuth.workbenchCloud.status` describes whether Workbench Cloud auth was available for that cleanup. Native provider CLI auth such as Codex or Claude profiles is owned by that provider and is not deleted by Workbench.

Remotes are Workbench object endpoints, not Git remotes. They are local metadata in `.workbench/remotes.yaml` and are normally created by `publish` or by the first logged-in `eval --cloud`/`improve --cloud`. `sync` is plumbing for repairing or testing object-pack exchange; the taught sharing path is `publish` and `install`.

## Cases

Cases live under `.workbench/cases`. Create, list, edit, and remove cases with the filesystem. To turn a failure into a regression case, inspect the evidence with `workbench show RUN_ID` and write the case files directly.
