# CLI reference

Use the `workbench` CLI to create, evaluate, improve, inspect, and publish Workbench projects. Start with [Quickstart](quickstart.md) for the first run. This reference lists exact command syntax and behavior.

<!-- workbench-cli-reference:start -->
## Command surface

Generated from the same command metadata that renders `workbench help` and validates accepted flags.

### Sources

#### `workbench source`

Connects, syncs, analyzes, and reviews private evidence Sources.

Usage:

```bash
workbench source add NAME --adapter ID [--namespace OWNER] [--json]
workbench source list [--cursor CURSOR --limit N] [--namespace OWNER] [--json]
workbench source show SOURCE_ID [--analysis ANALYSIS_ID] [--page PAGE] [--node NODE_ID|--insight INSIGHT_ID|--workflow WORKFLOW_ID] [--decision kept|dismissed] [--cursor CURSOR --limit N] [--namespace OWNER] [--json]
workbench source evidence SOURCE_ID ANALYSIS_ID CITATION_ID [--namespace OWNER] [--json]
workbench source sync SOURCE_ID [--json]
workbench source analyze SOURCE_ID (--record-limit N [--record-offset N] | --all-records) [--map] [--snapshot SNAPSHOT_ID] [--namespace OWNER] [--confirm --max-cost USD --preflight-token TOKEN] [--json]
workbench source review SOURCE_ID ANALYSIS_ID --input PATH|- [--namespace OWNER] [--json]
workbench source delete SOURCE_ID --yes [--namespace OWNER] [--json]
```

Flags:

- `add`: `--json`, `--help`, `--adapter VALUE`, `--namespace VALUE`
- `list`: `--json`, `--help`, `--cursor VALUE`, `--limit N`, `--namespace VALUE`
- `show`: `--json`, `--help`, `--analysis VALUE`, `--cursor VALUE`, `--decision VALUE`, `--insight VALUE`, `--limit N`, `--namespace VALUE`, `--node VALUE`, `--page VALUE`, `--workflow VALUE`
- `evidence`: `--json`, `--help`, `--namespace VALUE`
- `sync`: `--json`, `--help`
- `analyze`: `--json`, `--help`, `--all-records`, `--confirm`, `--map`, `--max-cost VALUE`, `--namespace VALUE`, `--preflight-token VALUE`, `--record-limit N`, `--record-offset N`, `--snapshot VALUE`
- `review`: `--json`, `--help`, `--input VALUE`, `--namespace VALUE`
- `delete`: `--json`, `--help`, `--namespace VALUE`, `--yes`

### Evals

#### `workbench eval`

Authors, runs, grades, and inspects Evals.

Usage:

```bash
workbench eval list [--dir DIR] [--json]
workbench eval show REF[:PATH] [--dir DIR] [--json]
workbench eval draft --source SOURCE_ID --analysis ANALYSIS_ID --review-version N --review-hash HASH --workflows IDS --objective TEXT --destination local|OWNER/SKILL[/EVAL] [--namespace OWNER] [--dir DIR] [--confirm --max-cost USD --preflight-token TOKEN] [--json]
workbench eval apply DRAFT_ID [--dir DIR] --yes [--json]
workbench eval discard DRAFT_ID --yes [--json]
workbench eval run [--versions LIST] [--agents LIST] [--cases LIST] [-n N] [--rerun] [--cloud] [--dir DIR] [--json]
workbench eval grade [--versions LIST] [--agents LIST] [--cases LIST] [--rerun] [--cloud] [--dir DIR] [--json]
workbench eval results [--versions LIST] [--eval current|all|EVAL] [--agents LIST] [--dir DIR] [--json]
workbench eval case draft [ID] [--grader ADAPTER] [--dir DIR] [--json]
workbench eval grader [set ADAPTER] [--authoring key=value]... [--dir DIR] [--json]
workbench eval agent list|add|rm [ARGS] [--dir DIR] [--json]
```

Flags:

- `list`: `--json`, `--help`, `--dir VALUE`
- `show`: `--json`, `--help`, `--dir VALUE`
- `draft`: `--json`, `--help`, `--dir VALUE`, `--analysis VALUE`, `--confirm`, `--destination VALUE`, `--max-cost VALUE`, `--namespace VALUE`, `--objective VALUE`, `--preflight-token VALUE`, `--review-hash VALUE`, `--review-version N`, `--source VALUE`, `--workflows VALUE`
- `apply`: `--json`, `--help`, `--dir VALUE`, `--yes`
- `discard`: `--json`, `--help`, `--yes`
- `run`: `--json`, `--help`, `--dir VALUE`, `--agents VALUE`, `--cases VALUE`, `--cloud`, `--dry-run`, `--rerun`, `--versions VALUE`, `--samples N`
- `grade`: `--json`, `--help`, `--dir VALUE`, `--agents VALUE`, `--cases VALUE`, `--cloud`, `--dry-run`, `--rerun`, `--versions VALUE`
- `results`: `--json`, `--help`, `--dir VALUE`, `--agents VALUE`, `--eval VALUE`, `--versions VALUE`
- `case`: `--json`, `--help`, `--dir VALUE`, `--grader VALUE`
- `grader`: `--json`, `--help`, `--dir VALUE`, `--authoring VALUE`, `--authoring-file VALUE`, `--authoring-json VALUE`
- `agent`: `--json`, `--help`, `--dir VALUE`, `--adapter VALUE`, `--model VALUE`, `--with VALUE`

### Skills

#### `workbench skill`

Creates, improves, versions, syncs, and publishes Skills.

Usage:

```bash
workbench skill new DIR [--agent ADAPTER] [--model MODEL] [--json]
workbench skill init [--agent ADAPTER] [--model MODEL] [--json]
workbench skill clone OWNER/SKILL[@VERSION]|URL DIR [--json]
workbench skill list [--target codex|claude] [--scope folder|global] [--dir DIR] [--json]
workbench skill show [REF[:PATH]] [--dir DIR] [--json]
workbench skill install SOURCE [--target codex|claude] [--scope folder|global] [--dir DIR] [--json]
workbench skill improve [--versions LIST] [--agents LIST] [--budget N] [-n N] [--cloud] [--dir DIR] [--json]
workbench skill versions [--dir DIR] [--json]
workbench skill diff [A..B] [--dir DIR] [--json]
workbench skill switch VERSION [--dry-run] [--yes] [--dir DIR] [--json]
workbench skill sync [REMOTE] [--dry-run] [--dir DIR] [--json]
workbench skill publish [VERSION] --as OWNER/SKILL [--private|--team|--public] [--dir DIR] [--json]
workbench skill unpublish VERSION [--dry-run] [--dir DIR] [--json]
workbench skill delete OWNER/SKILL|URL --yes [--json]
```

Flags:

- `new`: `--json`, `--help`, `--agent VALUE`, `--auth VALUE`, `--model VALUE`
- `init`: `--json`, `--help`, `--agent VALUE`, `--auth VALUE`, `--model VALUE`
- `clone`: `--json`, `--help`
- `list`: `--json`, `--help`, `--dir VALUE`, `--scope VALUE`, `--target VALUE`
- `show`: `--json`, `--help`, `--dir VALUE`
- `install`: `--json`, `--help`, `--dir VALUE`, `--dry-run`, `--scope VALUE`, `--target VALUE`, `--yes`
- `improve`: `--json`, `--help`, `--dir VALUE`, `--agents VALUE`, `--budget N`, `--cloud`, `--dry-run`, `--samples N`, `--versions VALUE`
- `versions`: `--json`, `--help`, `--dir VALUE`
- `diff`: `--json`, `--help`, `--dir VALUE`
- `switch`: `--json`, `--help`, `--dir VALUE`, `--dry-run`, `--yes`
- `sync`: `--json`, `--help`, `--dir VALUE`, `--dry-run`
- `publish`: `--json`, `--help`, `--dir VALUE`, `--as VALUE`, `--dry-run`, `--private`, `--public`, `--team`
- `unpublish`: `--json`, `--help`, `--dir VALUE`, `--dry-run`
- `delete`: `--json`, `--help`, `--dry-run`, `--yes`

### Operations and auth

#### `workbench open`

Serves the local Workbench UI.

Usage:

```bash
workbench open [--host HOST] [--port PORT] [--dir DIR] [--no-open]
```

Flags:

`--dir VALUE`, `--help`, `--host VALUE`, `--no-open`, `--port N`

#### `workbench watch`

Watches an existing operation.

Usage:

```bash
workbench watch OPERATION_ID [--dir DIR] [--json]
```

Flags:

`--json`, `--help`, `--dir VALUE`

#### `workbench retry`

Retries an existing operation.

Usage:

```bash
workbench retry OPERATION_ID [--confirm --max-cost USD --preflight-token TOKEN] [--dir DIR] [--json]
```

Flags:

`--json`, `--help`, `--dir VALUE`, `--confirm`, `--max-cost VALUE`, `--preflight-token VALUE`

#### `workbench cancel`

Cancels an existing operation.

Usage:

```bash
workbench cancel OPERATION_ID [--dir DIR] [--json]
```

Flags:

`--json`, `--help`, `--dir VALUE`

#### `workbench login`

Connects the CLI to Workbench Cloud or captures provider auth.

Usage:

```bash
workbench login [PROVIDER] [--method METHOD] [--profile PROFILE] [--base-url URL] [--json]
```

Flags:

`--json`, `--help`, `--base-url VALUE`, `--local-only`, `--method VALUE`, `--no-open`, `--profile VALUE`, `--profile-root VALUE`, `--start-only`, `--timeout N`, `--wait`

#### `workbench logout`

Logs out of Workbench Cloud or removes local provider auth.

Usage:

```bash
workbench logout [PROVIDER] [--json]
```

Flags:

`--json`, `--help`

### Remote URLs

- `https://HOST/skills/OWNER/SKILL  Workbench Cloud skill remote`
- `file:///absolute/path            local file remote for explicit sync`
<!-- workbench-cli-reference:end -->

## Invocation rules

Use the Source, Eval, and Skill guides for product journeys. Use this reference for exact syntax, accepted flags, selectors, object references, and automation output.

- Bare `workbench` renders help; domain work starts from `source`, `eval`, or `skill`.
- Use `--dir DIR` on commands that support it to target a project without changing directories.
- Use `workbench help COMMAND` for command-specific help and `workbench help --all` for the complete local help surface.
- Use `--json` when a command is part of automation. Human output is optimized for scanning and may include prose progress.

## Selectors and reuse

- If you omit `--versions` or `--agents`, Workbench uses the corresponding manifest `default` selector.
- `--versions all` and `--agents all` expand the configured version and agent lists.
- `--cases LIST` narrows `eval run` or `eval grade` to specific case ids.
- `-n N` and `--samples N` apply to execution-producing commands such as `eval run` and `skill improve`; `eval grade` judges existing execution evidence and does not accept samples.
- `--rerun` bypasses reusable current evidence for the selected phase.
- `--dry-run` previews selectors, package source status, launch checks, and planned work without writing package versions, refs, runs, remotes, traces, artifacts, sync state, or cancellation files.

## Object references

- `OWNER/SKILL` names a published Workbench skill.
- `OWNER/SKILL@VERSION` pins an exact still-published package version for `install` or `clone`.
- `RUN_ID`, `JOB_ID`, execution-evidence ids, artifact ids, and version ids are emitted by nested Eval and Skill commands.
- `workbench eval show REF` displays Eval evidence; `workbench eval show REF:PATH` prints an exact evidence file.
- `workbench skill diff A..B` compares two Workbench package versions.
- Remote URL forms are listed in the generated command surface above. `skill sync` is an explicit repair and portability command, not the normal way to follow an operation.

## Output and scripting

- Use `--json` for stable automation.
- Long-running JSON commands keep stdout to one final JSON document.
- After a recorded run id exists, progress JSON Lines on stderr are `workbench.run.v1` snapshots.
- Human `next:` and JSON `next` carry at most one suggested next command.
- Errors that can be fixed by a command report the command to run next.
