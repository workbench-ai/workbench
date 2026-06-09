# Workbench CLI

The CLI is the action surface for skill management. The web UI is read-only inspection.

## Create

```bash
workbench init ./earnings-prep
cd ./earnings-prep
workbench check
workbench status
workbench versions
```

`init` writes `SKILL.md`, `.workbench/eval.yaml`, `.workbench/cases/case-001/case.yaml`, `.workbench/agents.yaml`, `.workbench/.gitignore`, and ignored runtime directories. The generated case is a smoke check for the harness; replace it with workflow-specific cases before treating scores as skill quality.

Simple projects do not need `.workbench/skills.yaml`; Workbench implicitly evaluates the root `SKILL.md` as `primary`. Add `.workbench/skills.yaml` only when comparing multiple measured skills or installing included skills beside the measured skill.

## Evaluate And Improve

```bash
workbench eval --agent default --samples 1
workbench eval --skill all --agent all --samples 1
workbench eval --agent default --samples 1 --rerun
workbench compare --skills all --agents all --versions all
workbench retry RUN_ID
workbench improve --agent patcher --budget 1 --samples 1
```

Workbench creates source versions automatically. If the folder changed since the current version, the next command creates the next `vNNN` before running.

Use agents to compare runtime configurations. `local` and `command` agents run Docker-style case tests directly. `codex` and `claude` agents run the provider as the skill executor and score the same cases through the configured score adapter; connect adapter auth before using them locally or in Cloud.

```bash
workbench agent add default --adapter local
workbench agent add strict --adapter command --with command='sh "$CASE_DIR/tests/test.sh"'
workbench agent add networked --adapter command --with network=on
workbench agent add codex --adapter codex --model gpt-5.4-mini --with auth=default
workbench auth connect codex --method api-key
workbench eval --agent all --samples 1
```

Local command agents use the same network vocabulary for eval and improve. `network=on`, `network=open`, and `network=true` mean open egress and run Docker with `bridge`; `network=off`, `network=none`, and `network=false` mean isolated egress and run Docker with `none`. Other non-empty strings are treated as custom Docker network names.

Run `workbench improve` only after failed or reviewed trace evidence exists. Passing smoke traces are not enough for a meaningful improvement. Workbench records the proposed improved version and proof evidence every time, but it switches to that version only when the proof run succeeds and beats the latest scored incumbent for the same skill bundle, eval hash, and agent.

Command-style agents can make improvement substantive by providing an `improveCommand`. Workbench runs it in Docker with the current skill mounted at `SKILL_DIR`, all installed skills under `SKILLS_DIR`, trace evidence mounted at `TRACE_DIR`, and output at `OUTPUT_DIR`. The command may edit files under `SKILL_DIR` directly or write a skill patch JSON to the protocol path in `WORKBENCH_SKILL_PATCH`. By default only `SKILL.md` is editable; pass `--with improveEdits=SKILL.md,assets` to allow supporting files.

```bash
workbench agent add patcher --adapter command --with 'improveCommand=printf "\nReview failure handling before final delivery.\n" >> "$SKILL_DIR/SKILL.md"'
workbench improve --agent patcher --budget 1 --samples 1
```

Agents without `improveCommand` or a provider-backed skill-improvement adapter fail clearly.

`workbench eval` reuses matching completed local evidence for the same version, skill bundle, agent, eval snapshot, and sample count. Pass `--rerun` to force new execution. `workbench retry RUN_ID` replays only failed jobs from the prior run, preserving the original version, skill, agent, case, and sample pairs. If a run has no failed jobs, use `workbench eval --rerun` to intentionally run it again.

## Skill Composition

Top-level entries in `.workbench/skills.yaml` are measured skills. Nested `includes` are installed beside one measured skill and are included in that bundle hash.

```yaml
skills:
  primary:
    path: .
    includes:
      - name: helper
        path: skills/helper
  upstream:
    from: github:anthropics/skills//skills/frontend-design
    ref: <commit-sha>
```

Local `path` values must stay inside the project root. Use remote refs or vendor a skill into the project instead of pointing at `../other-skill`.

## Versions

```bash
workbench versions
workbench show v002:SKILL.md
workbench files v002
workbench diff v001..v002
workbench switch v001
```

`versions` lists source history. `switch` materializes the selected source version into the working folder and updates the current Workbench ref. It does not invoke Git; Git users see ordinary file changes if the project is inside a Git repository.

## Remotes And Publish

```bash
workbench remote add origin file:///tmp/earnings-prep-remote
workbench sync
workbench publish --visibility private
```

Remotes are Workbench object endpoints, not Git remotes. `sync` merges versions, runs, jobs, traces, artifacts, lineage, and refs. File remotes are useful for local portability. Workbench Cloud remotes use HTTP and the same object pack schema after `workbench login`.

`publish` makes a selected version installable from the remote and returns install URLs. Publication is explicit; normal sync shares evidence and source versions but does not change published visibility.

## Inspect

```bash
workbench show trace_job_000002:stderr.log
workbench show artifact_000002:output/result.json
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

`show REF:PATH` works for version files, trace files, and artifact files. `list sessions` is read-only evidence discovery for native Codex and Claude session JSONL files; set `CODEX_HOME` or `CLAUDE_HOME` to point at non-default homes.

## Auth

```bash
workbench auth status
workbench auth status codex
workbench auth connect codex --method api-key
workbench auth connect codex --method oauth --profile-root "$HOME"
workbench auth connect claude --method api-key
workbench auth connect claude --method bedrock
workbench auth disconnect codex
workbench login --base-url https://v2.workbench.ai
workbench logout
```

Auth uses the local Workbench adapter-auth store so adapter credentials can be checked, captured, and disconnected by adapter and profile. Codex supports `api-key` via `OPENAI_API_KEY` and `oauth` via `.codex/auth.json` under `--profile-root`. Claude supports `api-key` via `ANTHROPIC_API_KEY`, `oauth` via `.claude.json`, and `bedrock` via the Claude/AWS environment variables. When the CLI is logged in, `auth connect` and `auth disconnect` also update the matching Workbench Cloud adapter connection unless `--local-only` is passed.

## Cases

```bash
workbench case list
workbench case add
workbench case add --from TRACE_ID
workbench case show case-001
workbench case remove case-001
```

Cases live under `.workbench/cases`. `case add --from TRACE_ID` records trace evidence and creates a draft that fails until expert acceptance criteria and tests are added.
