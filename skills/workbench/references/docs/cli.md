# CLI Reference

The `workbench` CLI is the canonical action surface for local and hosted Workbench projects. Use [Quickstart](quickstart.md) for the first run and [Workflows](workflows.md) for task-oriented command paths. This page is the command reference.

<!-- workbench-cli-reference:start -->
## Command Surface

This section is generated from the same command metadata that renders `workbench help` and validates accepted flags.

### Lifecycle

#### `workbench new`

Creates a brand-new Workbench skill project.

Usage:

```bash
workbench new DIR [--agent codex|claude|command|local] [--model MODEL] [--auth PROFILE] [--json]
```

Flags:

`--json`, `--help`, `--agent VALUE`, `--auth VALUE`, `--model VALUE`

#### `workbench init`

Initializes the current skill directory as a Workbench-managed project without rewriting SKILL.md.

Usage:

```bash
workbench init [--agent codex|claude|command|local] [--model MODEL] [--auth PROFILE] [--json]
```

Flags:

`--json`, `--help`, `--agent VALUE`, `--auth VALUE`, `--model VALUE`

#### `workbench clone`

Creates editable Workbench source from a published skill.

Usage:

```bash
workbench clone OWNER/SKILL[@VERSION]|URL DIR [--json]
```

Flags:

`--json`, `--help`

#### `workbench run`

Runs the selected cases without running graders.

Usage:

```bash
workbench run [--versions all|LIST] [--agents all|LIST] [--cases LIST] [-n N|--samples N] [--rerun] [--cloud] [--dry-run] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`, `--agents VALUE`, `--cases VALUE`, `--cloud`, `--dry-run`, `--rerun`, `--versions VALUE`, `-n N, --samples N`

#### `workbench grade`

Grades existing execution jobs without rerunning them.

Usage:

```bash
workbench grade [--versions all|LIST] [--agents all|LIST] [--cases LIST] [--rerun] [--cloud] [--dry-run] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`, `--agents VALUE`, `--cases VALUE`, `--cloud`, `--dry-run`, `--rerun`, `--versions VALUE`

#### `workbench eval`

Runs execute and grade jobs for the selected skill versions and agents. Omitted selectors use manifest defaults.

Usage:

```bash
workbench eval [--versions all|LIST] [--agents all|LIST] [--cases LIST] [-n N|--samples N] [--rerun] [--cloud] [--dry-run] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`, `--agents VALUE`, `--cases VALUE`, `--cloud`, `--dry-run`, `--rerun`, `--versions VALUE`, `-n N, --samples N`

#### `workbench improve`

Creates one improved child skill version from evidence. The selected version and agent must resolve to exactly one entry each.

Usage:

```bash
workbench improve [--versions LIST] [--agents LIST] [--budget N] [-n N|--samples N] [--cloud] [--dry-run] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`, `--agents VALUE`, `--budget N`, `--cloud`, `--dry-run`, `-n N, --samples N`, `--versions VALUE`

#### `workbench skills`

Lists local skills accessible to Codex and Claude across folder and global scopes.

Usage:

```bash
workbench skills [--target codex|claude] [--scope folder|global] [--dir DIR] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`, `--scope VALUE`, `--target VALUE`

#### `workbench install`

Installs a Workbench Cloud source when available, otherwise delegates external Agent Skill sources to skills add.

Usage:

```bash
workbench install SOURCE [--target codex|claude] [--scope folder|global] [--dir DIR] [--yes] [--dry-run] [--json] [-- SKILLS_ARGS...]
```

Flags:

`--json`, `--dir VALUE`, `--help`, `--dry-run`, `--scope VALUE`, `--target VALUE`, `--yes`

### Inspect

#### `workbench results`

Shows recorded eval results across selected skill versions and agents.

Usage:

```bash
workbench results [--versions all|LIST] [--agents all|LIST] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`, `--agents VALUE`, `--versions VALUE`

#### `workbench status`

Reports project, worktree, run, per-remote sync/publication, and auth state. --json emits the workbench.status.v1 dashboard.

Usage:

```bash
workbench status [--dir DIR] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`

#### `workbench watch`

Follows progress for an existing run.

Usage:

```bash
workbench watch RUN_ID [--dir DIR] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`

#### `workbench cancel`

Requests cancellation for an active or detached run.

Usage:

```bash
workbench cancel RUN_ID [--dir DIR] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`

#### `workbench retry`

Starts a new attempt from the stored operation plan for a run.

Usage:

```bash
workbench retry RUN_ID [--dir DIR] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`

#### `workbench log`

Shows one reverse-chronological timeline of versions and runs.

Usage:

```bash
workbench log [--runs|--versions] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`, `--runs`, `--versions`

#### `workbench versions`

Lists recorded Workbench package versions.

Usage:

```bash
workbench versions [--dir DIR] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`

#### `workbench show`

Shows a Workbench object, lists files for file-backed objects, or prints one file.

Usage:

```bash
workbench show REF [--json]
workbench show REF:PATH [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`

#### `workbench diff`

Shows changed files between two Workbench package versions.

Usage:

```bash
workbench diff [A..B] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`

#### `workbench switch`

Switches the working skill source to a recorded Workbench version.

Usage:

```bash
workbench switch VERSION [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`

#### `workbench open`

Serves the local Workbench UI.

Usage:

```bash
workbench open [--host HOST] [--port PORT] [--no-open]
```

Flags:

`--dir VALUE`, `--help`, `--host VALUE`, `--no-open`, `--port PORT`

### Configure

#### `workbench case`

Creates a draft eval case. Local and command-backed projects also get a tests/test.sh harness.

Usage:

```bash
workbench case draft [ID] [--dir DIR] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`

#### `workbench agent`

Lists, adds, or removes eval agent configurations.

Usage:

```bash
workbench agent list [--json]
workbench agent add NAME --adapter X [--model M] [--with k=v]... [--json]
workbench agent rm NAME [--json]
```

Flags:

- `list`: `--json`, `--dir VALUE`, `--help`
- `add`: `--json`, `--dir VALUE`, `--help`, `--adapter VALUE`, `--model VALUE`, `--with VALUE`
- `rm`: `--json`, `--dir VALUE`, `--help`

### Share and auth

#### `workbench publish`

Publishes installable skill source to Workbench Cloud. --as sets the linked OWNER/SKILL handle.

Usage:

```bash
workbench publish [VERSION] [--as OWNER/SKILL] [--private|--team|--public] [--dry-run] [--dir DIR] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`, `--as VALUE`, `--dry-run`, `--private`, `--public`, `--team`

#### `workbench unpublish`

Removes exact source availability for a non-current published version.

Usage:

```bash
workbench unpublish VERSION [--dry-run] [--dir DIR] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`, `--dry-run`

#### `workbench delete`

Deletes an entire Workbench Cloud skill project. Use unpublish for one exact package version.

Usage:

```bash
workbench delete OWNER/SKILL|URL [--dry-run] [--yes] [--json]
```

Flags:

`--json`, `--help`, `--dry-run`, `--yes`

#### `workbench login`

Connects the CLI to Workbench Cloud or captures local adapter auth for a provider.

Usage:

```bash
workbench login [PROVIDER] [--method METHOD] [--profile PROFILE] [--profile-root DIR] [--base-url URL] [--start-only|--wait] [--timeout N] [--no-open] [--local-only] [--json]
workbench logout [PROVIDER] [--json]
```

Flags:

`--json`, `--help`, `--base-url VALUE`, `--local-only`, `--method VALUE`, `--no-open`, `--profile VALUE`, `--profile-root VALUE`, `--start-only`, `--timeout N`, `--wait`

#### `workbench logout`

With no provider, logs out of Workbench Cloud. With a provider such as codex or claude, removes local adapter auth.

Usage:

```bash
workbench logout [PROVIDER] [--json]
```

Flags:

`--json`, `--help`

#### `workbench sync`

Plumbing command: synchronizes local evidence and version objects with a Workbench remote.

Usage:

```bash
workbench sync [REMOTE] [--dry-run] [--dir DIR] [--json]
```

Flags:

`--json`, `--dir VALUE`, `--help`, `--dry-run`

### Remote URLs

- `https://HOST/skills/OWNER/SKILL  Workbench Cloud skill remote`
- `file:///absolute/path            local file remote for plumbing sync`
<!-- workbench-cli-reference:end -->

## Invocation Rules

Use [Workflows](workflows.md) for task paths such as creating, evaluating, improving, publishing, installing, and inspecting skills. Use this page when you need exact syntax, accepted flags, selectors, object references, or automation output behavior.

- Bare `workbench` is the same orientation read as `workbench status`.
- Use `--dir DIR` on commands that support it to target a project without changing directories.
- Use `workbench help COMMAND` for command-specific help and `workbench help --all` for the complete local help surface.
- Use `--json` when a command is part of automation. Human output is optimized for scanning and may include prose progress.

## Selectors And Reuse

- Omitted `--versions` and `--agents` use the corresponding manifest `default` selector.
- `--versions all` and `--agents all` expand the configured matrix.
- `--cases LIST` narrows run, grade, and eval work to specific case ids.
- `-n N` and `--samples N` apply to execution-producing commands such as `run`, `eval`, and `improve`; `grade` judges existing execution evidence and does not accept samples.
- `--rerun` bypasses reusable current evidence for the selected phase.
- `--dry-run` previews selectors, source state, readiness, and planned work without writing package versions, refs, runs, remotes, traces, artifacts, sync state, or cancellation files.

## Object References

- `OWNER/SKILL` names a published Workbench skill.
- `OWNER/SKILL@VERSION` pins an exact still-published source version for `install` or `clone`.
- `RUN_ID`, `JOB_ID`, trace ids, artifact ids, and version ids are emitted by commands such as `eval`, `log`, `results`, `show`, and `watch`.
- `workbench show REF` displays an object or live file.
- `workbench show REF:PATH` prints a file inside a version, run, job, trace, or artifact object.
- `workbench diff A..B` compares two Workbench package versions.
- Remote URL forms are listed in the generated command surface above. `sync` is explicit object-exchange repair and portability plumbing, not the normal follow-run command.

## Output And Scripting

- Use `--json` for stable automation.
- Long-running JSON commands keep stdout to one final schema-tagged JSON document.
- After a durable run id exists, progress JSON Lines on stderr are `workbench.run.v1` snapshots.
- Human `next:` and JSON `next` carry at most one command-shaped next step.
- Errors that can be fixed by a command report command-shaped remediation.
