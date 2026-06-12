# Workbench Spec

Workbench is a skill management runtime. It runs skills on evals with agents, records trace evidence, improves skills from failed or reviewed traces, versions source automatically, and syncs the full evidence graph through Workbench remotes.

The CLI is the canonical action surface. The local and hosted web UX is read-only inspection over the same `WorkbenchInspectionSnapshot` used by CLI formatters. Workbench Cloud is the hosted Workbench remote, runner provider, team skill catalog, and hosted source provider.

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
.workbench/cases/case-001/case.yaml
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
    adapter: local
    model: docker
    with: {}
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

Authored Workbench source files are part of versions: `SKILL.md`, support files, `.workbench/eval.yaml`, `.workbench/cases/`, `.workbench/agents.yaml`, optional `.workbench/skills.yaml`, and optional `.workbench/environment/`. Runtime and local metadata under `.workbench/objects/`, `.workbench/refs/`, `.workbench/sync/`, `.workbench/tmp/`, `.workbench/logs/`, `.workbench/locks/`, `.workbench/remotes.yaml`, and `.workbench/.gitignore` are not versioned skill source and are not installable source.

## CLI Contract

The primary operator loop is `init`, `check`, `eval`, `compare`, and `improve`. The full CLI contract is larger because Workbench also exposes source inspection, low-level evidence reads, remotes, publication, installation, and auth.

```text
workbench init [DIR] [--json]
workbench status [--dir DIR] [--json]
workbench check [--dir DIR] [--json]
workbench versions [--dir DIR] [--json]
workbench switch VERSION [--dir DIR] [--json]
workbench diff [A..B] [--dir DIR] [--json]
workbench sync [REMOTE] [--dir DIR] [--dry-run] [--json]
workbench install --source SOURCE [--agent codex|claude]... [--local] [--yes] [--list] [--dry-run] [--json]
workbench eval [VERSION] [--skills all|LIST] [--agents all|LIST] [--samples N] [--rerun] [--json]
workbench improve [VERSION] [--skill SKILL] [--agent AGENT] [--budget N] [--samples N] [--json]
workbench compare [--skills all|LIST] [--agents all|LIST] [--versions all|A..B|LIST] [--json]
workbench show REF[:PATH] [--json]
workbench files REF [--json]
workbench list runs|jobs|traces|artifacts|sessions [--json]
workbench trace RUN_ID|JOB_ID|TRACE_ID [--json]
workbench remote add --name NAME --url URL [--replace] [--dry-run] [--dir DIR] [--json]
workbench remote list [--dir DIR] [--json]
workbench remote remove NAME [--dir DIR] [--json]
workbench agent list|add|show|default|remove ...
workbench skills list
workbench case list|add|show|remove ...
workbench publish [VERSION] [--visibility private|internal|public] [--remote REMOTE] [--dry-run] [--dir DIR] [--json]
workbench auth status|connect|disconnect ...
workbench login [--base-url URL] [--start-only|--wait] [--timeout N] [--no-open] [--json]
workbench logout [--json]
workbench open [--host HOST] [--port PORT] [--no-open] [--json]
```

The CLI surface above is the complete product contract. New docs and skills should teach the primary loop first and link to command help or this contract for lower-level inspection and sharing commands; do not add aliases for stale grammar.

## Runtime Behavior

Every command that reads or writes project state first reconciles the current folder into a source version. If the source hash already exists, Workbench reuses that version. If the source changed, Workbench creates a content-derived version id as a child of the current version. Editing an older switched version and running a command naturally creates a new lineage. Runtime evidence ids are collision-resistant object ids so isolated copies can create runs before syncing to the same remote.

`eval` resolves selected skills and agents, records runs, jobs, live trace-progress events, terminal traces, artifacts, eval snapshots, skill sources, and skill bundles. If `--skills` or `--agents` is omitted, Workbench uses the matching manifest `default` selector. Matching completed local eval evidence is reused unless `--rerun` is passed. Runs are identified by version, eval hash, skill name, skill bundle hash, agent name, and agent hash.

Eval jobs mount all resolved skills at `/workspace/input/skills`. `SKILL_DIR` points at the selected entry skill directory, `SKILLS_DIR` points at `/workspace/input/skills`, `CASE_DIR` points at the case files, and `OUTPUT_DIR` points at output files.

Command and local agents run eval jobs with isolated network unless configured with `network=on`, `network=open`, or `network=true`. Provider-backed Codex and Claude agents default to open egress because adapter execution must reach the provider. If a provider-backed agent is explicitly configured with isolated network, Workbench fails before scheduling the eval.

If an eval adapter, command, auth materialization, or runtime fails, Workbench records failed run, job, trace, and artifact evidence with the error. Failed execution is not treated as missing score data.

`improve` edits only the mutable `primary` project skill. It requires exactly one selected skill and one selected agent; if a default selector expands to multiple entries, pass `--skill primary --agent AGENT`. It requires failed or reviewed trace evidence for the selected skill and agent. Command agents must define `improveCommand`; provider-backed Codex and Claude agents use adapter auth. Passing smoke traces are not improvement evidence. Workbench records the proposed improved version and proof-run evidence. If the improve adapter cannot create a patch, or the proof eval fails at the adapter/runtime layer, `improve` fails clearly; a proof eval failure still leaves the candidate version and proof run available for inspection. Workbench switches to the improved version only when the proof run succeeds and beats the incumbent.

`switch` is the explicit command that materializes an older or alternate version into the working folder. It does not invoke Git.

`compare` defaults to the current eval snapshot and uses manifest skill and agent defaults unless `--skills` or `--agents` is passed. It never mixes measurements across eval hashes. CLI compare can render version, skill, and agent axes, including historical versions when `--versions` selects them. Included skills affect bundle hashes but do not appear as rows unless also defined as top-level measured skills. Comparison cells carry the latest matching run status and error even when no numeric score exists, so failed evals render as failed evidence instead of empty `n/a` rows.

## Remotes And Publish

Raw Workbench runtime state is not a Git repository. Git users keep using Git normally; Workbench does not call Git, write Git branches, create tags, commit, push, pull, or mutate Git refs. Workbench storage is repo-local and ignored, similar in spirit to `.git` but independent of Git.

`workbench remote add --name NAME --url URL` records a non-secret local Workbench remote URL in schema-tagged `.workbench/remotes.yaml`, analogous to git remote configuration. Accepted URLs are explicit `file:///absolute/path` remotes and Workbench Cloud skill URLs such as `https://v2.workbench.ai/skills/OWNER/SKILL`; bare paths and API implementation URLs are rejected. Adding or changing a remote does not create a skill version. `workbench sync` merges immutable object packs between local `.workbench/objects` and the remote and records each attempt in `.workbench/sync/<remote>.json`. File remotes are sync-only and are supported for local portability tests. Workbench Cloud remotes use the same object pack schema over HTTP and are the only remotes that can publish installable source.

When a remote exists, write commands perform best-effort post-sync and read commands may perform best-effort pre-sync. If a remote is unavailable, local objects remain usable, `workbench status --json` reports the per-remote error and next command, and explicit `workbench sync REMOTE` is the repair command.

`workbench publish [VERSION]` syncs the selected version to a Workbench Cloud remote, marks it as the published source version, and asks Workbench Cloud to expose installable source. Workbench Cloud publishes return one canonical install URL like `https://v2.workbench.ai/skills/OWNER/SKILL` plus a pinned release URL like `https://v2.workbench.ai/skills/OWNER/SKILL/releases/VERSION` for every source visibility. File remotes reject publish because they are object-pack sync endpoints, not source hosts. `workbench install --source URL` installs Workbench-aware source only to explicit native targets (`--agent codex`, `--agent claude`, or `--local`); public URLs also work with the public `skills` CLI through well-known discovery. Publication is explicit; ordinary sync shares evidence and source versions but does not change published visibility.

Workbench Cloud owns the `OWNER` namespace in those URLs. Personal namespaces are created from user profiles. Organization namespaces, teams, membership, and skill grants live only in Cloud. The CLI does not add commands for organization or team state, and no organization/team metadata is persisted in `.workbench`.

Published source visibility does not grant project evidence access. `private` source is readable only by users with project read access. `internal` source is readable by members of the owning organization and is valid only for organization-owned skills. `public` source is readable by anyone through the `/skills/OWNER/SKILL` well-known discovery surface, including the public `.well-known/skills` contract used by the upstream `skills` CLI. Internal and private installs use the same `/skills/OWNER/SKILL` URL with Workbench CLI auth. Runs, jobs, traces, artifacts, eval evidence, reviews, and improvement history require project read access regardless of source visibility.

## Web UX

`workbench open` serves the local read-only inspection UI from the last committed Workbench object state. It does not reconcile source or wait for a long-running eval or improve command; active runs, queued/running jobs, and live trace-progress batches are persisted as ordinary objects. `workbench open --json`, `workbench list runs|jobs|traces|artifacts`, `workbench trace`, and `workbench skills list` read the same committed inspection state without taking the project write lock. List commands are summary-first and omit file content; use `workbench show REF:PATH` to read version, trace, or artifact file content. Hosted skill pages use the same snapshot projection. The web UI may navigate, filter, and inspect, but write actions stay in the CLI. Run status, job status, and execution timelines can update while a command is still running. Captured files and terminal trace artifacts are attached when the job records terminal trace evidence.

Cloud source-only viewers still receive a `WorkbenchInspectionSnapshot`, but Cloud constructs it from the published version and publication refs only. Source-only snapshots intentionally omit runs, jobs, traces, artifacts, private eval evidence, and improvement history. Users with project read access receive the full snapshot for the same URL.

The primary web surfaces are `Overview`, `Compare`, `Improve`, `Source`, and `Release`. `Compare` is the quality decision surface: it renders one scorecard for one selected evaluation version, with exact skill version labels, state badges such as `Current` or `Published`, score/latency/cost columns when cost exists, primary metric bars, and score tradeoff charts. The selected evaluation version appears above the table with case count and grader type; if multiple eval definitions exist, a single selector switches the scorecard scope. Evaluation snapshots have required `createdAt`, `updatedAt`, and `scoreAdapter` metadata. The selector orders options by `createdAt`, assigns `Evaluation N` from that order, defaults to the newest option, and marks that same option `Latest`; older evaluations show `Created DATE` plus case count and grader type. `updatedAt` records when the authored eval source was observed but does not reorder evaluation history. The current active skill, no-skill baseline, alternate skills, and prior scored active-skill versions are rows in the same scorecard rather than separate page modes, but rows from different evaluation versions are not ranked together by default. Failed rows show `Failed` and a concise error summary while still opening the run evidence. If no visible rows have recorded cost, the web scorecard omits the cost column and explains missing cost in run details as failed before usage, not reported, or not tested. Historical source lineage and file-level version inspection live under `Source`; CLI `workbench compare --versions ...` remains the scriptable version-axis comparison surface. Runs, versions, skills, and agents open in contextual inspectors over the launching surface; jobs, traces, artifacts, and captured files are inspected inside that evidence context or through CLI object commands.
