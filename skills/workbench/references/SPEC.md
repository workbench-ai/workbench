# Workbench Spec

Workbench is a skill management runtime. It runs skills on evals with agents, records trace evidence, improves skills from failed or reviewed traces, versions source automatically, and syncs the full evidence graph through Workbench remotes.

The CLI is the canonical action surface. The local and hosted web UX is read-only inspection over the same `WorkbenchInspectionSnapshot` used by CLI formatters. Workbench Cloud is the hosted Workbench remote, runner provider, registry, and hosted source provider.

## Vocabulary

- Skill: a measured agent skill. The implicit local skill is `primary`.
- Included skill: a skill installed beside a measured skill for one run. It is hashed into the measured skill bundle but is not a comparison row.
- Skill bundle: one measured entry skill plus its included skills and files.
- Version: an immutable source snapshot created automatically at command boundaries.
- Eval: the rubric and cases that measure skill performance.
- Case: one representative workflow input.
- Agent: one runtime configuration, such as adapter, model label, auth profile, and adapter config.
- Run: an eval, improve, or retry attempt.
- Trace: evidence produced by a run.
- Lineage: parent-child relationships between source versions.
- Remote: a Workbench object endpoint used for versions, runs, traces, artifacts, refs, and published source.
- Published source: an immutable source version exposed by Workbench Cloud as an installable skill.

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
.workbench/queue/        # ignored pending sync queue
.workbench/tmp/          # ignored temporary files
.workbench/logs/         # ignored runtime logs
```

When `.workbench/skills.yaml` is absent and `SKILL.md` exists, Workbench behaves as if this were configured:

```yaml
skills:
  primary:
    path: .
```

Advanced projects may add `.workbench/skills.yaml`:

```yaml
defaults:
  skills: all
skills:
  primary:
    path: .
    includes:
      - name: helper
        path: skills/helper
  upstream:
    from: github:anthropics/skills//skills/frontend-design
    ref: <commit-sha>
  hosted:
    from: https://workbench.ai/api/workbench/public/skills/acme/earnings-prep/source
    ref: v019
```

Top-level `skills` entries are measured skills. `includes` are dependencies for that measured skill. Local `path` values must stay inside the project root after realpath resolution; absolute paths, `..` escapes, and symlink escapes are invalid. External skills must use explicit remote refs or be vendored into the project.

Agents live in `.workbench/agents.yaml`:

```yaml
default: default
agents:
  default:
    adapter: local
    model: docker
    with: {}
```

Authored Workbench source files are part of versions: `SKILL.md`, support files, `.workbench/eval.yaml`, `.workbench/cases/`, `.workbench/agents.yaml`, optional `.workbench/skills.yaml`, optional `.workbench/environment/`, and optional `.workbench/remotes.yaml`. Runtime directories under `.workbench` are ignored and are not installable source.

## CLI Contract

```text
workbench init [DIR] [--json]
workbench status [--dir DIR] [--json]
workbench check [--dir DIR] [--json]
workbench versions [--dir DIR] [--json]
workbench switch VERSION [--dir DIR] [--json]
workbench diff [A..B] [--dir DIR] [--json]
workbench sync [REMOTE] [--dir DIR] [--json]
workbench eval [VERSION] [--skill SKILL|all] [--agent AGENT|all] [--samples N] [--rerun] [--json]
workbench improve [VERSION] [--skill primary] [--agent AGENT] [--budget N] [--samples N] [--json]
workbench compare [--skills all|LIST] [--agents all|LIST] [--versions all|A..B|LIST] [--json]
workbench retry RUN_ID [--json]
workbench show REF[:PATH] [--json]
workbench files REF [--json]
workbench list runs|jobs|traces|artifacts|sessions|remotes [--json]
workbench trace RUN_ID|JOB_ID|TRACE_ID [--json]
workbench remote add NAME URL [--dir DIR] [--json]
workbench remote list [--dir DIR] [--json]
workbench agent list|add|show|default|remove ...
workbench skills list
workbench case list|add|show|remove ...
workbench publish [VERSION] [--visibility private|public] [--dir DIR] [--json]
workbench auth status|connect|disconnect ...
workbench login [--base-url URL] [--no-open] [--json]
workbench logout [--json]
workbench open [--host HOST] [--port PORT] [--no-open] [--json]
```

This is a hard cut. There are no compatibility aliases for older source-management commands or hosted command flags.

## Runtime Behavior

Every command that reads or writes project state first reconciles the current folder into a source version. If the source hash already exists, Workbench reuses that version. If the source changed, Workbench creates the next sequential version as a child of the current version. Editing an older switched version and running a command naturally creates a new lineage.

`eval` resolves selected skills and agents, records runs, jobs, traces, artifacts, eval snapshots, skill sources, and skill bundles. Matching completed local eval evidence is reused unless `--rerun` is passed. Runs are identified by version, eval hash, skill name, skill bundle hash, agent name, and agent hash.

Eval jobs mount all resolved skills at `/workspace/input/skills`. `SKILL_DIR` points at the selected entry skill directory, `SKILLS_DIR` points at `/workspace/input/skills`, `CASE_DIR` points at the case files, and `OUTPUT_DIR` points at output files.

`improve` edits only the mutable `primary` project skill. It requires failed or reviewed trace evidence for the selected skill and agent. Command agents must define `improveCommand`; provider-backed Codex and Claude agents use adapter auth. Passing smoke traces are not improvement evidence. Workbench records the proposed improved version and proof-run evidence, and switches to the improved version only when the proof run succeeds and beats the incumbent.

`switch` is the explicit command that materializes an older or alternate version into the working folder. It does not invoke Git.

`compare` defaults to the current eval snapshot and never mixes measurements across eval hashes. It renders version, skill, and agent axes. Included skills affect bundle hashes but do not appear as rows unless also defined as top-level measured skills.

## Remotes And Publish

Raw Workbench runtime state is not a Git repository. Git users keep using Git normally; Workbench does not call Git, write Git branches, create tags, commit, push, pull, or mutate Git refs. Workbench storage is repo-local and ignored, similar in spirit to `.git` but independent of Git.

`workbench remote add NAME URL` records a non-secret Workbench remote URL in `.workbench/remotes.yaml`. `workbench sync` merges immutable object packs between local `.workbench/objects` and the remote. File remotes are supported for local portability tests. Workbench Cloud remotes use the same object pack schema over HTTP.

When a remote exists, write commands perform best-effort post-sync and read commands may perform best-effort pre-sync. If a remote is unavailable, local objects remain usable and explicit `workbench sync` is the repair command.

`workbench publish [VERSION]` syncs the selected version, marks it as the published source version, and asks the remote to expose installable source. Workbench Cloud returns an install URL and a pinned install URL. Publication is explicit; ordinary sync shares evidence and source versions but does not change published visibility.

## Web UX

`workbench open` serves the local read-only inspection UI. `workbench open --json` prints the same inspection snapshot without starting a browser server. Hosted skill pages use the same snapshot shape. The web UI may navigate, filter, and inspect, but write actions stay in the CLI.
