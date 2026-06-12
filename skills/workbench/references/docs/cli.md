# Workbench CLI

The CLI is the action surface for Workbench. The web UI is read-only inspection over the same committed Workbench objects.

## Primary Loop

```bash
workbench init ./earnings-prep
cd ./earnings-prep
workbench check
workbench eval --agents default --samples 1
workbench compare
workbench improve --agent patcher --budget 1 --samples 1
```

`init` writes `SKILL.md`, `.workbench/eval.yaml`, `.workbench/cases/case-001/case.yaml`, `.workbench/agents.yaml`, `.workbench/.gitignore`, and ignored runtime directories. The generated case is a smoke check; replace it with workflow-specific cases before treating scores as skill quality.

Workbench creates source versions automatically at command boundaries. If the folder changed since the current version, the next command creates a content-derived version id before acting.

`eval` and `compare` use manifest defaults when selector flags are omitted. Use plural selectors only when you intentionally broaden or narrow the set:

```bash
workbench eval --skills all --agents all --samples 1
workbench compare --skills all --agents all --versions all
workbench eval --agents default --samples 1 --rerun
```

`improve` edits one mutable project skill with one agent. If defaults expand to more than one skill or agent, pass singular selectors:

```bash
workbench improve --skill primary --agent patcher --budget 1 --samples 1
```

Run `improve` only after failed or reviewed trace evidence exists. Passing smoke traces are not meaningful improvement evidence. Workbench records the candidate version and proof run evidence; it switches only when the proof run succeeds and beats the incumbent.

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

`local` and `command` agents run Docker-style case tests directly. `codex` and `claude` agents run the provider as the skill executor and score the same cases through the configured score adapter. Connect adapter auth before using provider-backed agents locally or in Cloud.

```bash
workbench agent add default --adapter local
workbench agent add strict --adapter command --with command='sh "$CASE_DIR/tests/test.sh"'
workbench agent add codex --adapter codex --model gpt-5.3-codex-spark --with auth=default
workbench auth connect codex --method api-key
workbench skills list
```

## Inspect

```bash
workbench status
workbench versions
workbench show <version-id>:SKILL.md
workbench files <version-id>
workbench diff <base-version-id>..<improved-version-id>
workbench switch <version-id>
workbench trace RUN_ID
workbench list runs
workbench list jobs
workbench list traces
workbench list artifacts
workbench list sessions
workbench show codex:SESSION_ID --json
workbench open
workbench open --json
```

`switch` materializes a recorded source version into the working folder and updates the current Workbench ref. It does not invoke Git.

`show REF:PATH` reads version files, trace files, and artifact files. `list runs`, `list jobs`, `list traces`, `list artifacts`, `trace`, `skills list`, and `open --json` read committed object state without taking the project write lock, so they remain usable while an eval or improve command is running. Summary commands omit file content; use `show REF:PATH` for content.

`workbench open` serves the shared read-only inspection model. The web `Compare` surface is the browser counterpart to `workbench compare`; write actions remain in the CLI.

## Remotes, Publish, Install

```bash
workbench remote add --name origin --url file:///tmp/earnings-prep-remote
workbench remote add --name cloud --url https://v2.workbench.ai/skills/acme/earnings-prep
workbench remote list
workbench sync origin
workbench publish --remote cloud --visibility private
workbench install --source https://v2.workbench.ai/skills/acme/earnings-prep --agent codex --yes
```

Remotes are Workbench object endpoints, not Git remotes. `remote add --name NAME --url URL` accepts explicit `file:///absolute/path` remotes and Workbench Cloud skill URLs like `https://v2.workbench.ai/skills/OWNER/SKILL`. Every sync attempt writes `.workbench/sync/<remote>.json`, which `workbench status --json` surfaces with per-remote status, last error, publication state, and next commands.

File remotes are sync-only. Workbench Cloud remotes can also publish installable source. `publish` returns canonical `/skills/OWNER/SKILL` install URLs plus pinned `/skills/OWNER/SKILL/releases/VERSION` URLs. `install --source URL` installs published source into explicit targets only: `--agent codex`, `--agent claude`, or `--local`. Public URLs remain compatible with the public `skills` CLI through well-known discovery.

## Auth

```bash
workbench login --base-url https://v2.workbench.ai
workbench login --start-only
workbench login --wait --timeout 120
workbench auth status
workbench auth connect codex --method api-key
workbench auth connect claude --method bedrock
workbench auth disconnect codex
workbench logout
```

`login` connects the CLI to Workbench Cloud. Headless flows use `login --start-only` to record a pending device authorization and `login --wait --timeout N` to poll it. `auth status --json` reports Workbench Cloud auth separately from adapter auth. When the CLI is logged in, `auth connect` and `auth disconnect` also update the matching Workbench Cloud adapter connection unless `--local-only` is passed.

## Cases

```bash
workbench case list
workbench case add
workbench case add --from TRACE_ID
workbench case show case-001
workbench case remove case-001
```

Cases live under `.workbench/cases`. `case add --from TRACE_ID` creates a trace-backed draft that needs expert acceptance criteria and tests before it can pass.
