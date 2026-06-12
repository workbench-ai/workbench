# Workbench CLI

The CLI is the action surface for Workbench. It creates skill projects, runs evals, improves from evidence, publishes installable source, installs published skills, and opens the read-only inspection UI over committed Workbench objects.

[`jtbd.md`](jtbd.md) defines the jobs users complete with these commands and the exact steady-state sequences each job allows; this guide explains the commands themselves.

## Create

```bash
workbench new ./earnings-prep
cd ./earnings-prep
# edit SKILL.md and cases
workbench eval
```

`new` writes `SKILL.md`, `.workbench/eval.yaml`, `.workbench/cases/case-001/case.yaml`, `.workbench/agents.yaml`, `.workbench/.gitignore`, and ignored runtime directories. The generated case is only a smoke check; replace it with workflow-specific cases before treating scores as skill quality.

Workbench creates source versions automatically at command boundaries. If the folder changed since the current version, the next command creates a content-derived version id before acting.

## Evaluate

```bash
workbench eval
workbench eval --agents all -n 5
workbench eval --skills all --agents all --samples 1 --rerun
```

`eval` and `compare` use manifest defaults when selector flags are omitted. Use plural selectors only when intentionally broadening or narrowing the matrix:

```bash
workbench compare
workbench compare --skills all --agents all --versions all
workbench compare --versions v017..v021
```

`eval` prints the run summary, score deltas when available, and one `next:` command for the common next step. `--cloud` runs on Workbench Cloud after auto-linking the logged-in project when needed, syncs local objects before scheduling, waits for the hosted run to finish, then syncs terminal evidence back for `log`, `show`, and `compare`. Auto-linking does not publish installable source.

## Improve

```bash
workbench improve
workbench improve --skills primary --agents patcher --budget 1 -n 1
```

`improve` edits one mutable project skill with one agent. The flags stay plural to match `eval` and `compare`, but the selected values must resolve to exactly one skill and one agent. Run it only after failed or reviewed trace evidence exists. Passing smoke traces are not meaningful improvement evidence. Workbench records the candidate version and proof run evidence; it switches only when the proof run succeeds and beats the incumbent. Hosted `improve --cloud` syncs the same winning version back and materializes it locally unless the local current version changed while the hosted run was in flight.

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
    adapter: local
    model: deterministic
    with: {}
```

`local` and `command` agents run Docker-style case tests directly. `codex` and `claude` agents run the provider as the skill executor and score the same cases through the configured score adapter. Connect provider auth before using provider-backed agents locally or in Cloud.

```bash
workbench agent add default --adapter local
workbench agent add strict --adapter command --with command='sh "$CASE_DIR/tests/test.sh"'
workbench agent add codex --adapter codex --model gpt-5.3-codex-spark --with auth=default
workbench login codex --method api-key
```

## Inspect

```bash
workbench
workbench status
workbench log
workbench log --runs
workbench log --versions
workbench show <run-id>
workbench show <run-id>:stderr.log
workbench show <version-id>:SKILL.md
workbench diff <base-version-id>..<improved-version-id>
workbench switch <version-id>
workbench open
workbench open --json
```

Bare `workbench` is the same orientation view as `workbench status`. `log` shows one reverse-chronological timeline of versions and runs. `show REF` lists files for file-backed objects or shows interpreted run/job evidence; `show REF:PATH` reads one version, trace, or artifact file. Native read-only sessions such as `codex:SESSION_ID` and `claude:SESSION_ID` are also resolved through `show`.

`switch` materializes a recorded source version into the working folder and updates the current Workbench ref. It does not invoke Git.

`workbench open` serves the shared read-only inspection model. The web `Compare` surface is the browser counterpart to `workbench compare`; write actions remain in the CLI.

## Publish And Install

```bash
workbench login --base-url https://v2.workbench.ai
workbench publish
workbench publish --as acme/earnings-prep
workbench publish --public
workbench install acme/earnings-prep
workbench install https://v2.workbench.ai/skills/acme/earnings-prep --to codex --yes
```

`publish` links the project to a Workbench Cloud skill handle and publishes installable source. The default handle is derived from the logged-in namespace and project folder; `--as OWNER/SKILL` sets or replaces it and is remembered for later bare `publish` commands. `--private` is the default audience, `--team` maps to organization-internal source visibility, and `--public` exposes source through the public discovery surface. `publish` returns a canonical `OWNER/SKILL` install command and pinned release URL.

`install` accepts the canonical `OWNER/SKILL` handle or a full Cloud URL. It installs into detected native targets by default; use repeated `--to codex|claude|local` flags for scripts and `--yes` for non-interactive use.

## Auth And Sync

```bash
workbench login
workbench login codex --method api-key
workbench login claude --method bedrock
workbench logout codex
workbench logout
workbench sync cloud
```

Bare `login` connects the CLI to Workbench Cloud. `login PROVIDER` captures provider adapter auth for local and hosted provider-backed agents. `status` reports Cloud auth, provider auth, linked publication state, and per-remote sync health.

Remotes are Workbench object endpoints, not Git remotes. They are local metadata in `.workbench/remotes.yaml` and are normally created by `publish` or by the first logged-in `eval --cloud`/`improve --cloud`. `sync` is plumbing for repairing or testing object-pack exchange; the taught sharing path is `publish` and `install`.

## Cases

```bash
workbench case list
workbench case add
workbench case add <run-id>
workbench case rm case-001
```

Cases live under `.workbench/cases`. `case add <run-id>` creates a run-backed draft that needs expert acceptance criteria and tests before it can pass.
