# Workbench Spec

Workbench is a skill management runtime. It runs skills on evals with agents, records run/job/trace evidence, improves skills from scored below-perfect, failed, or reviewed eval evidence, versions source automatically, and syncs the full evidence graph through Workbench remotes.

The CLI is the canonical action surface. The local and hosted web UX is read-only inspection over the same `WorkbenchInspectionSnapshot` used by CLI formatters. Workbench Cloud is the hosted Workbench remote, runner provider, team skill catalog, and hosted source provider.

[`docs/jtbd.md`](docs/jtbd.md) is the jobs-to-be-done ergonomics contract: the complete steady-state command sequences users run to complete each job. Changes to the CLI contract below must keep those sequences true.

## Vocabulary

- Skill: a measured agent skill. The implicit local skill is `primary`.
- Included skill: a skill installed beside a measured skill for one run. It is hashed into the measured skill bundle but is not a comparison row.
- Skill bundle: one measured entry skill plus its included skills and files.
- Version: an immutable source snapshot created automatically at command boundaries.
- Eval: the rubric and cases that measure skill performance.
- Case: one representative workflow input.
- Agent: one runtime configuration, such as adapter, model label, auth profile, and adapter config.
- Run: an eval, improve, or compare attempt.
- Trace: evidence produced by a run.
- Lineage: parent-child relationships between source versions.
- Remote: a Workbench object endpoint used for versions, runs, trace progress, traces, artifacts, and refs.
- Namespace: a Workbench Cloud owner slug. A namespace can be a user or an organization and appears in URLs as `/skills/OWNER/SKILL`.
- Organization: a Cloud-only namespace with members and teams. Organization data is never written into local skill folders.
- Team: a Cloud-only group inside an organization used for project access grants.
- Published source: an immutable source version exposed by a remote as an installable skill.
- Source visibility: the install/list visibility of the published source version. It is separate from full project evidence access and is `private`, `internal`, or `public`.

## Source Shape

Simple skill projects need no `.workbench/skills.yaml`:

```text
SKILL.md
.workbench/eval.yaml
.workbench/cases/       # authored eval cases; empty after workbench new
.workbench/agents.yaml
.workbench/.gitignore
.workbench/objects/      # ignored runtime object database
.workbench/refs/         # ignored Workbench refs
.workbench/sync/         # ignored per-remote sync state
.workbench/tmp/          # ignored temporary files
.workbench/logs/         # ignored runtime logs
.workbench/locks/        # ignored local command locks
```

When `.workbench/skills.yaml` is absent and `SKILL.md` exists, Workbench behaves as if this were configured:

```yaml
skills:
  primary:
    path: .
```

Advanced projects may add `.workbench/skills.yaml`:

```yaml
default: all
skills:
  primary:
    path: .
    includes:
      - name: helper
        path: skills/helper
      - name: upstream
        from: github:anthropics/skills//skills/frontend-design
        ref: <commit-sha>
      - name: hosted
        from: https://workbench.ai/skills/acme/earnings-prep
        ref: v019
  no-skill:
    baseline: none
```

Top-level `skills` entries are measured skills. The top-level `default` selector must be `all` or a configured skill name; `all` is reserved and cannot be used as a skill name. Each measured skill defines exactly one of `path`, `from`, or `baseline`. `baseline: none` is the built-in no-skill baseline: Workbench runs the eval with no entry `SKILL.md`, records normal run evidence, and does not create installable source files for that row. `includes` are dependencies for a measured local or remote skill and are not allowed on `baseline: none`. Local `path` values must stay inside the project root after realpath resolution; absolute paths, `..` escapes, and symlink escapes are invalid. External skills must use explicit remote refs or be vendored into the project. When `primary` is `path: .`, other configured local skill source directories are excluded from the primary bundle so alternate skills do not become part of the active skill merely because they live in the same project.

Agents use the same top-level `default` selector shape in `.workbench/agents.yaml`; the selector must be `all` or a configured agent name, and `all` is reserved so it cannot be used as an agent name:

```yaml
default: default
agents:
  default:
    adapter: codex
    model: gpt-5.4-mini
    with:
      auth: default
```

`.workbench/eval.yaml` selects scoring directly:

```yaml
version: 1
name: earnings-prep
description: Measures whether the skill creates a useful earnings prep note.
score:
  adapter: tests
```

Workbench core runs the selected measured skill with the selected agent, then invokes the score adapter against the completed workspace, public case files, private case files, traces, and output artifacts. Scorers such as `tests` and `rubric` own scoring only. Provider-backed agents such as `codex` and `claude` own `skill.run` only. Engine adapters such as Harbor still own their own `engine.resolve` and `engine.run` behavior when used as external engines, but the first-party skill-eval path does not wrap agent execution inside the built-in Workbench engine.

Authored Workbench source files are part of versions: `SKILL.md`, support files, `.workbench/eval.yaml`, `.workbench/cases/`, `.workbench/agents.yaml`, optional `.workbench/skills.yaml`, and optional `.workbench/environment/`. Runtime, install, and local metadata under `.agents/`, `.workbench/objects/`, `.workbench/refs/`, `.workbench/sync/`, `.workbench/tmp/`, `.workbench/logs/`, `.workbench/locks/`, `.workbench/remotes.yaml`, and `.workbench/.gitignore` are not versioned skill source and are not installable source.

## CLI Contract

The taught operator loop is `new`, `eval`, `improve`, `compare`, `publish`, `skills`, and `install`. The full CLI contract also exposes status, inspection, source switching, agent configuration, auth, and plumbing sync.

```text
workbench [--json]
workbench new [DIR] [--from OWNER/SKILL|URL] [--agent codex|claude|command|local] [--model MODEL] [--auth PROFILE] [--json]
workbench status [--dir DIR] [--json]
workbench log [--runs|--versions] [--json]
workbench show REF[:PATH] [--json]
workbench switch VERSION [--dir DIR] [--json]
workbench diff [A..B] [--dir DIR] [--json]
workbench eval [--skills all|LIST] [--agents all|LIST] [-n N|--samples N] [--rerun] [--cloud] [--json]
workbench improve [--skills LIST] [--agents LIST] [--budget N] [-n N|--samples N] [--cloud] [--json]
workbench compare [--skills all|LIST] [--agents all|LIST] [--versions all|A..B|LIST] [--json]
workbench publish [VERSION] [--as OWNER/SKILL] [--private|--team|--public] [--dry-run] [--dir DIR] [--json]
workbench skills [--for codex|claude|all] [--global] [--dir DIR] [--json]
workbench install OWNER/SKILL|URL [--for codex|claude|all] [--global] [--dir DIR] [--yes] [--dry-run] [--json]
workbench agent add NAME --adapter X [--model M] [--with k=v]... | list | rm NAME [--json]
workbench login [PROVIDER] [--method METHOD] [--profile P] [--base-url URL] [--start-only|--wait] [--timeout N] [--no-open] [--local-only] [--json]
workbench logout [PROVIDER] [--json]
workbench sync [REMOTE] [--dir DIR] [--dry-run] [--json]
workbench open [--host HOST] [--port PORT] [--no-open]
workbench help [COMMAND] [--all]
```

Default help shows only orientation plus the six taught commands. `help --all` shows the complete product contract above. New docs and skills should teach the primary loop first and link to command help or this contract for lower-level inspection and sync commands; do not add aliases for stale grammar.

## Runtime Behavior

Every command that reads or writes project state first reconciles the current folder into a source version. If the source hash already exists, Workbench reuses that version. If the source changed, Workbench creates a content-derived version id as a child of the current version. Editing an older switched version and running a command naturally creates a new lineage. Runtime evidence ids are collision-resistant object ids so isolated copies can create runs before syncing to the same remote.

`eval` resolves selected skills and agents for the current source version, records runs, jobs, live trace-progress events, terminal traces, artifacts, eval snapshots, skill sources, and skill bundles. If no cases exist under `.workbench/cases`, it fails before scheduling with `no_eval_cases` and remediates to creating/editing `.workbench/cases/case-001/case.yaml`. Provider-backed cases can be prompt/rubric only. Local or command-backed cases additionally need either a top-level `command` in `case.yaml` or an executable `tests/test.sh` under the case directory. If `--skills` or `--agents` is omitted, Workbench uses the matching manifest `default` selector. Matching completed local eval evidence is reused unless `--rerun` is passed. Runs are identified by version, eval hash, skill name, skill bundle hash, agent name, and agent hash. During long-running non-cached work, CLI progress is derived from normalized run and job state and written sparsely to stderr with phase, queued/running state, case/sample counters, failures, elapsed time, and heartbeat. Evaluating an older version is not part of the execution command surface; use `show`, `diff`, `switch`, and `compare --versions` for historical inspection.

Eval jobs mount all resolved skills at `/workspace/input/skills`. `SKILL_DIR` points at the selected entry skill directory, `SKILLS_DIR` points at `/workspace/input/skills`, `CASE_DIR` points at the case files, and `OUTPUT_DIR` points at output files.

Command and local agents run eval jobs with isolated network unless configured with `network=on`, `network=open`, or `network=true`. Provider-backed Codex and Claude agents default to open egress because adapter execution must reach the provider. If a provider-backed agent is explicitly configured with isolated network, Workbench fails before scheduling the eval.

If an eval adapter, command, auth materialization, or runtime fails before producing a public result file, Workbench records failed run, job, trace, and artifact evidence with the error. When a shell test writes `$OUTPUT_DIR/result.json`, that public result file controls pass/fail and score even if the shell exits nonzero afterward; failed result-file evidence is not treated as missing score data.

`improve` edits only the mutable `primary` project skill package: any file outside `.workbench/**`, including `SKILL.md`, scripts, references, assets, agent metadata, and package support files. Ordinary improve may read `.workbench` eval/case/evidence state but must not rewrite `.workbench/**`; improving eval design is a separate future job, not hidden in skill improvement. `improve` requires exactly one selected skill and one selected agent; if a default selector expands to multiple entries, the usage error lists configured skills and agents and shows concrete commands such as `workbench improve --skills primary --agents default`. The selected agent must have a skill-improvement adapter before execution starts; the hard-cut setup path is to configure that selected agent directly, for example `codex login --device-auth` if `~/.codex/auth.json` is missing, `workbench login codex --method oauth`, and `workbench agent add default --adapter codex --model gpt-5.4-mini --with auth=default`. Claude setup is `claude setup-token` in an interactive shell, browser authorization, `CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth`, and `workbench agent add default --adapter claude --model sonnet --with auth=default`; Workbench captures the Claude profile plus OAuth token without implementing a second Claude browser authorization flow. Isolated validation can pass `--profile-root DIR` to read provider-native state from an alternate home root: Codex reads `DIR/.codex/auth.json`; Claude reads `DIR/.claude.json` plus `CLAUDE_CODE_OAUTH_TOKEN`. There is no implicit fallback improver: the selected agent is both the improver and proof eval agent. `improve` requires scored below-perfect, failed, or reviewed eval evidence for the selected skill and eval definition; perfect eval runs and unscored runtime/auth failures are not improvement evidence, and useful evidence is not rejected merely because it came from a different eval agent or a historical smoke-labeled case. Workbench checks for actionable evidence before telling users to configure an improvement-capable adapter, so perfect smoke runs get a no-evidence remediation instead of a provider setup detour. Workbench records the proposed improved version and proof-run evidence. Proof runs use the ordinary eval pipeline, eval hash, case set, samples, score adapter contract, and selected agent. If the improve adapter cannot create a patch, or the proof eval fails at the adapter/runtime layer, `improve` fails clearly; a proof eval failure still leaves the candidate version and proof run available for inspection and comparison. Workbench switches to the improved version only when the proof run succeeds and beats the incumbent for the same eval agent and eval hash, and the switched output points to a higher-sample rerun before publish when the proof was small. Hosted `improve --cloud` validates local target and evidence before Cloud auto-linking, sync, or scheduling, then follows the same local materialization rule after terminal Cloud evidence syncs back; if the local current version changed while the hosted run was in flight, Workbench refuses to overwrite it and leaves `workbench switch VERSION` as the explicit resolution.

`switch` is the explicit command that materializes an older or alternate version into the working folder. It does not invoke Git.

`compare` defaults to the current eval snapshot and uses manifest skill and agent defaults unless `--skills` or `--agents` is passed. It never mixes measurements across eval hashes. CLI compare can render version, skill, and agent axes, including historical versions when `--versions` selects them. Human compare output renders only cells with recorded run evidence; JSON keeps the full selected matrix, including cells with no run, when the selected source manifests are valid. Recorded run evidence remains comparable even if an unrelated historical source manifest is no longer parseable. Included skills affect bundle hashes but do not appear as rows unless also defined as top-level measured skills. Comparison cells carry the latest matching run status and error even when no numeric score exists. Failed evals with public result-file scores still show those scores; runtime failures with no result file render as failed evidence with `n/a`.

## Remotes And Publish

Raw Workbench runtime state is not a Git repository. Git users keep using Git normally; Workbench does not call Git, write Git branches, create tags, commit, push, pull, or mutate Git refs. Workbench storage is repo-local and ignored, similar in spirit to `.git` but independent of Git.

Workbench remotes are non-secret local Workbench object endpoints recorded in schema-tagged `.workbench/remotes.yaml`, analogous to git remote configuration but not exposed as taught CLI nouns. `publish` creates or updates the Cloud remote for the selected skill handle, and `eval --cloud` or `improve --cloud` auto-links the same Cloud skill project when a logged-in project has no linked Cloud remote yet. File remotes can be configured by editing `.workbench/remotes.yaml` for portability tests. Accepted URLs are explicit `file:///absolute/path` remotes and Workbench Cloud skill URLs such as `https://v2.workbench.ai/skills/OWNER/SKILL`; bare paths and API implementation URLs are rejected. Adding or changing a remote does not create a skill version. `workbench sync` merges immutable object packs between local `.workbench/objects` and the remote and records each attempt in `.workbench/sync/<remote>.json`. File remotes are sync-only. Workbench Cloud remotes use the same object pack schema over HTTP and are the only remotes that can publish installable source.

Network is explicit. Ordinary local reads and writes do not perform hidden remote synchronization. `workbench sync`, `publish`, `install`, `eval --cloud`, and `improve --cloud` are the network command surfaces. Hosted `eval --cloud` and `improve --cloud` first ensure the current local source has a version, sync that object graph to Cloud, and send only minimal scheduling input: version id, optional skill selector, optional agent selector, and limits such as samples or budget. Cloud derives the eval snapshot, skill bundle, selected agent, and improve evidence from Cloud's stored project state. After Cloud accepts a hosted run, the CLI syncs once so the queued run is committed locally and `workbench show RUN_ID` is immediately valid. Hosted waits then poll Cloud run details and feed the same sparse progress renderer used by local eval and improve. Once a hosted run reaches a terminal state, the CLI syncs Cloud evidence back once. Ctrl-C during that wait detaches with exit 130, leaves the hosted run running, and returns `next: workbench show RUN_ID`; because read commands are local-only, use explicit `workbench sync cloud` to refresh a detached run that finished later. If a remote is unavailable, local objects remain usable, `workbench status --json` reports the per-remote error as state, and explicit `workbench sync REMOTE` remains the repair command when auth and link prerequisites are already satisfied.

`workbench publish [VERSION]` syncs the selected version to a Workbench Cloud remote, marks it as the published source version, and asks Workbench Cloud to expose source through two read surfaces: an installable agent skill package and editable Workbench source. `--as OWNER/SKILL` sets or replaces the linked Cloud skill handle when publishing; dry-run preview derives the handle in memory and writes no files. Subsequent bare `publish` uses the persisted handle and preserves the last explicit source visibility. Workbench Cloud publishes return one canonical install handle like `OWNER/SKILL`, a canonical URL like `https://v2.workbench.ai/skills/OWNER/SKILL`, and a pinned release URL like `https://v2.workbench.ai/skills/OWNER/SKILL/releases/VERSION` for every source visibility. File remotes reject publish because they are object-pack sync endpoints, not source hosts. Public URLs also work with the public `skills` CLI through well-known discovery. Publication is explicit; ordinary sync and `--cloud` auto-linking share evidence and source versions but do not expose installable source or change published visibility.

`workbench install OWNER/SKILL|URL` is strictly mutating and requires a source. It installs only the agent skill package: `SKILL.md`, scripts, references, assets, agent metadata, and package support files. It never installs authored `.workbench` controls, runtime objects, refs, logs, remotes, locks, or install metadata inside the package directory. The package directory name comes from valid `SKILL.md` frontmatter `name`, falling back to the handle skill segment only when no valid package name exists. Re-running the same source over an unchanged Workbench-managed copy is idempotent; changed or unmanaged destination content requires `--yes`. `--dry-run` reports the resolved target set and planned writes without writing package files or the root-local `.workbench-installs.json` ledger. Bare `workbench install` is a usage error.

`workbench skills` is the read-only inventory command. With no flags it answers "from my current coding agent in this folder, what skills do I have access to?" `--global` asks the same question for global access. `--for codex`, `--for claude`, and `--for all` override current-agent detection; `all` means exactly Codex plus Claude Code. `workbench skills --for all` answers the folder-wide cross-agent question, and `workbench skills --for all --global` answers the global cross-agent question. Inventory performs no network access, takes no project write lock, writes no files, and reports `current`, `modified`, `missing`, `unmanaged`, or `duplicate-name` status from visible skill roots and Workbench install ledgers. It does not show a `not installed` universe because catalog search is a separate job.

For Codex folder scope, Workbench reads `.agents/skills` roots visible from the requested directory up to the Git root and writes to exactly `<dir>/.agents/skills`. For Codex global scope, Workbench writes to `$HOME/.agents/skills`; inventory also reads `$CODEX_HOME/skills` as deprecated accessible state when present, but Workbench does not write there. For Claude folder scope, Workbench reads and writes `<dir>/.claude/skills`. For Claude global scope, Workbench reads and writes `$CLAUDE_CONFIG_DIR/skills` when set, otherwise `$HOME/.claude/skills`. These target paths are implementation details in human output and are present in JSON for automation.

`workbench new DIR --from OWNER/SKILL|URL` is the editable-source acquisition path. It creates a Workbench project containing the agent skill package plus authored `.workbench` controls when the source has them: `.workbench/eval.yaml`, `.workbench/cases/`, `.workbench/agents.yaml`, optional `.workbench/skills.yaml`, and optional `.workbench/environment/`. Runtime object state, refs, sync state, logs, locks, remotes, install ledgers, and `.agents` pollution are not copied from the published source. If the source is package-only, `new --from` creates the package plus the normal minimal `.workbench` scaffold.

Workbench Cloud owns the `OWNER` namespace in those URLs. Personal namespaces are created from user profiles. Organization namespaces, teams, membership, and skill grants live only in Cloud. The CLI does not add commands for organization or team state, and no organization/team metadata is persisted in `.workbench`.

Published source visibility does not grant project evidence access. `private` source is readable only by users with project read access. `internal` source is readable by members of the owning organization and is valid only for organization-owned skills. `public` source is readable by anyone through the canonical `/skills/OWNER/SKILL/.well-known/skills/index.json` discovery URL used by the upstream `skills` CLI; the bare `/skills/OWNER/SKILL/.well-known/skills` route redirects there, and unsupported `.well-known` paths return JSON 404 responses. Internal and private installs use the same `/skills/OWNER/SKILL` URL with Workbench CLI auth. Runs, jobs, traces, artifacts, eval evidence, reviews, and improvement history require project read access regardless of source visibility.

## Web UX

`workbench open` serves the local read-only inspection UI from the last committed Workbench object state. `--port` accepts integers from 0 through 65535; port 0 asks the OS for an ephemeral port and the CLI prints the actual bound URL. It does not reconcile source or wait for a long-running eval or improve command; active runs, queued/running jobs, and live trace-progress batches are persisted as ordinary objects. `workbench log` and `workbench show` read committed inspection state without taking the project write lock. Timeline commands are summary-first and omit file content; use `workbench show REF:PATH` to read version, artifact, or run/job evidence content. Run/job evidence projections expose one canonical user-facing path per file, filter nested internal `.workbench` runtime paths, omit raw trace metadata files such as `request.json`, `result.json`, and `trace.json`, and resolve suffixes only after collapsing equivalent candidates. Direct trace inspection uses the same raw-metadata filter. Hosted skill pages use the same snapshot projection. The web UI may navigate, filter, and inspect, but write actions stay in the CLI. Run status starts as `queued` for hosted work waiting on environment or worker capacity, moves to `running` once work is claimed or proof work is pending, and becomes terminal when all jobs finish. Captured files and terminal trace artifacts are attached when the job records terminal trace evidence.

Cloud source-only viewers still receive a `WorkbenchInspectionSnapshot`, but Cloud constructs it from the published version and publication refs only. Source-only snapshots intentionally omit runs, jobs, traces, artifacts, private eval evidence, and improvement history. Users with project read access receive the full snapshot for the same URL.

The primary web surfaces are `Overview`, `Compare`, `Improve`, `Source`, and `Release`. `Compare` is the quality decision surface: it renders one scorecard for one selected evaluation version, with exact skill version labels, state badges such as `Current` or `Published`, score/latency/cost columns when cost exists, primary metric bars, and score tradeoff charts. The selected evaluation version appears above the table with case count and grader type; if multiple eval definitions exist, a single selector switches the scorecard scope. Evaluation snapshots have required `createdAt`, `updatedAt`, and `scoreAdapter` metadata. The selector orders options by `createdAt`, assigns `Evaluation N` from that order, defaults to the newest option, and marks that same option `Latest`; older evaluations show `Created DATE` plus case count and grader type. `updatedAt` records when the authored eval source was observed but does not reorder evaluation history. The current active skill, no-skill baseline, alternate skills, and prior scored active-skill versions are rows in the same scorecard rather than separate page modes, but rows from different evaluation versions are not ranked together by default. Failed rows show `Failed` and a concise error summary while still opening the run evidence. If no visible rows have recorded cost, the web scorecard omits the cost column and explains missing cost in run details as failed before usage, not reported, or not tested. Historical source lineage and file-level version inspection live under `Source`; CLI `workbench compare --versions ...` remains the scriptable version-axis comparison surface. Runs, versions, skills, and agents open in contextual inspectors over the launching surface; jobs, traces, artifacts, and captured files are inspected inside that evidence context or through CLI object commands.
