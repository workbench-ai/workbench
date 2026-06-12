---
name: workbench
description: Use this skill for creating, evaluating, improving, inspecting, versioning, syncing, and publishing Workbench-managed agent skills with the `workbench` CLI.
---

# Workbench

Workbench is a local-first skill management runtime. It versions skill source automatically, runs evals with agents, records trace and artifact evidence, improves the mutable primary skill from failed or reviewed traces, syncs Workbench object remotes, and publishes installable source explicitly.

Assume the user is chatting with an agent that can edit files and run commands. Keep workflow-specific behavior in the managed skill. Use Workbench core for durable source versions, skill bundles, eval cases, agents, runs, traces, artifacts, lineage, object sync, source publication, and read-only inspection.

## Default Loop

Use the small loop first:

```bash
workbench init ./earnings-prep
cd ./earnings-prep
workbench check
workbench eval --agents default --samples 1
workbench compare
workbench versions
workbench show current:SKILL.md
```

The init case is only a smoke check. Replace it with representative workflow cases before treating scores as skill quality. Workbench creates source versions automatically when commands observe changed source.

Use selector flags only when the user intentionally wants a broader or narrower matrix:

```bash
workbench eval --skills all --agents all --samples 1
workbench compare --skills all --agents all --versions all
```

Run `workbench improve` only after failed or reviewed trace evidence exists. Passing smoke traces are not enough. `improve` edits one skill with one agent, so pass singular selectors when defaults expand to multiple entries:

```bash
workbench improve --skill primary --agent patcher --budget 1 --samples 1
```

## Source Shape

Use the skill-first layout:

- `SKILL.md` is the mutable primary skill.
- `.workbench/eval.yaml` describes what skill performance means.
- `.workbench/cases/*/case.yaml` contains representative workflow cases.
- `.workbench/agents.yaml` names runtime configurations and has top-level `default`.
- `.workbench/skills.yaml` is optional; add it only for multiple measured skills, `baseline: none`, or included skills.
- `.workbench/remotes.yaml` is ignored local remote configuration and is not versioned skill source.
- `.workbench/objects`, `.workbench/refs`, `.workbench/sync`, `.workbench/tmp`, `.workbench/logs`, and `.workbench/locks` are Workbench-owned runtime directories ignored by Git.

Do not point local skill paths outside the project folder. Use `baseline: none` for a true no-skill baseline instead of creating a fake local no-skill directory. For external skills, use explicit remote refs in `.workbench/skills.yaml` or vendor the files into the project.

## Inspect

```bash
workbench status
workbench versions
workbench list runs
workbench list traces
workbench trace RUN_ID
workbench show TRACE_ID:stderr.log
workbench show VERSION_ID:SKILL.md
workbench diff BASE_VERSION_ID..IMPROVED_VERSION_ID
workbench switch VERSION_ID
workbench open --json
```

`switch` materializes a recorded version into the working folder and does not invoke Git. The web view is read-only. Use `open --json` when the agent needs the inspection snapshot without starting the browser server. Use `show REF:PATH` for stdout, stderr, result files, captured artifacts, version files, and read-only native sessions such as `codex:SESSION_ID` or `claude:SESSION_ID`.

## Agents And Skills

Use agents to compare runtime configurations. `local` and `command` agents run Docker-style case tests directly. `codex` and `claude` agents run the provider as the skill executor and score the same cases through the configured score adapter.

```bash
workbench agent add default --adapter local
workbench agent add strict --adapter command --with command='sh "$CASE_DIR/tests/test.sh"'
workbench agent add codex --adapter codex --model gpt-5.3-codex-spark --with auth=default
workbench auth connect codex --method api-key
workbench eval --agents all --samples 1
workbench compare --agents all --versions all
```

Top-level entries in `.workbench/skills.yaml` are measured skills. Nested `includes` are installed alongside one measured local or remote skill and are hashed into that bundle, but they are not comparison rows.

If an eval adapter, command, auth materialization, or runtime fails, Workbench records failed run evidence with the error. Use `workbench compare` after failed runs because it shows failure evidence instead of treating the row as absent score data.

## Remotes, Publish, Auth

```bash
workbench remote add --name origin --url file:///tmp/earnings-prep-remote
workbench remote add --name cloud --url https://v2.workbench.ai/skills/acme/earnings-prep
workbench sync origin
workbench publish --remote cloud --visibility private
workbench install --source https://v2.workbench.ai/skills/acme/earnings-prep --agent codex --yes
```

Remotes exchange Workbench object packs; they are not Git remotes. File remotes are sync-only. Workbench Cloud remotes can publish installable source. `install --source URL` installs only into explicit native targets such as `--agent codex`, `--agent claude`, or `--local`.

Use `workbench login` before authenticated Workbench Cloud remotes. For headless use, `workbench login --start-only` records a pending device authorization and `workbench login --wait --timeout N` polls it. Use `workbench auth status|connect|disconnect` when provider-backed agents need explicit adapter auth.

## What Belongs In The Skill Layer

Keep these in skills unless core runtime support is required: discovering cases from conversations or traces, drafting rubrics, choosing examples, writing workflow-specific checks, deciding improvement strategy, and explaining whether the evidence is good enough.

## References

Load only what is needed:

- `references/docs/cli.md` for command syntax.
- `references/docs/evals/README.md` for source shape and authoring loop.
- `references/SPEC.md` for the hard-cut product contract.
