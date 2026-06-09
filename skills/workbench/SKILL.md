---
name: workbench
description: Use this skill for creating, evaluating, improving, inspecting, versioning, syncing, and publishing Workbench-managed agent skills with the `workbench` CLI.
---

# Workbench

Workbench is a skill management runtime. It runs skills on evals with agents, records trace evidence, improves the mutable primary skill from failed or reviewed traces, creates source versions automatically, syncs evidence through Workbench object remotes, and publishes installable skill source explicitly.

Assume the user is chatting with an agent that can edit files and run commands. Keep workflow-specific behavior in the skill being managed. Use Workbench core for durable source versions, skill bundles, eval cases, agents, runs, traces, artifacts, lineage, object sync, source publication, and read-only inspection.

## Quick Flow

```bash
workbench init ./earnings-prep
cd ./earnings-prep
workbench check
workbench eval --agent default --samples 1
workbench compare --versions all --skills all --agents all
workbench versions
workbench show v001:SKILL.md
```

## Source Shape

Use the skill-first layout:

- `SKILL.md` is the mutable primary skill.
- `.workbench/eval.yaml` describes what skill performance means. The generated init case is only a smoke check until replaced.
- `.workbench/cases/*/case.yaml` contains representative workflow cases.
- `.workbench/agents.yaml` names runtime configurations.
- `.workbench/skills.yaml` is optional and defines measured skills plus included skills for advanced comparison/composition.
- `.workbench/remotes.yaml` is optional tracked source and contains non-secret Workbench remote URLs.
- `.workbench/objects`, `.workbench/refs`, `.workbench/queue`, `.workbench/tmp`, and `.workbench/logs` are Workbench-owned runtime directories ignored by Git.

Do not point local skill paths outside the project folder. For external skills, use explicit remote refs in `.workbench/skills.yaml` or vendor the files into the project. Remote `from:` entries may be pinned `github:OWNER/REPO//path` refs or Workbench source URLs returned by `workbench publish`.

## Versions And Inspection

```bash
workbench status
workbench versions
workbench list runs
workbench list traces
workbench list sessions
workbench trace RUN_ID
workbench show trace_job_000002:stderr.log
workbench show v002:SKILL.md
workbench diff v001..v002
workbench switch v001
workbench open
workbench open --json
```

Workbench versions are automatic. If the folder changed, the next Workbench command creates a new source version before acting. Use `workbench switch VERSION` when the user explicitly wants to materialize a prior or alternate version into the working folder. It does not invoke Git.

The web view is read-only. Use `workbench open --json` when the agent needs the snapshot without starting the local browser server. Run eval, improve, retry, switch, sync, and publish from the CLI. Use `workbench show TRACE_ID:PATH` for stdout, stderr, result files, and captured artifacts, and use `workbench list sessions` plus `workbench show codex:SESSION_ID` or `workbench show claude:SESSION_ID` to inspect read-only native session evidence.

## Agents And Skills

Use agents when comparing local command and provider-backed runtime configurations. `local` and `command` agents run Docker-style case tests directly; `codex` and `claude` agents run the provider as the skill executor and score the same cases through the configured score adapter.

```bash
workbench agent add default --adapter local
workbench agent add strict --adapter command --with command='sh "$CASE_DIR/tests/test.sh"'
workbench agent add networked --adapter command --with network=on
workbench agent add codex --adapter codex --model gpt-5.4-mini --with auth=default
workbench auth connect codex --method api-key
workbench eval --agent all --samples 1
workbench compare --versions all --skills all --agents all
```

Top-level entries in `.workbench/skills.yaml` are measured skills. Nested `includes` are installed alongside one measured skill and are hashed into that bundle, but they are not comparison rows.

Run `workbench improve` only after there is failed or reviewed trace evidence. Passing smoke traces are not enough for a meaningful improvement. For a substantive command-backed improvement, configure `improveCommand` on a `command` agent. Workbench runs that command in Docker with `SKILL_DIR`, `SKILLS_DIR`, `TRACE_DIR`, `OUTPUT_DIR`, and `WORKBENCH_SKILL_PATCH` set. Agents without `improveCommand` or a provider-backed skill-improvement adapter fail clearly.

## Remotes And Publish

```bash
workbench remote add origin file:///tmp/earnings-prep-remote
workbench sync
workbench publish --visibility private
```

Remotes are Workbench object endpoints, not Git remotes. `sync` merges source versions, runs, jobs, traces, artifacts, lineage, and refs. Workbench Cloud is the hosted remote, runner provider, registry, and source provider. File remotes are useful for local portability tests.

`publish` makes a selected version installable from the remote and returns install URLs. Ordinary sync shares evidence and source versions but does not change published visibility.

Use `workbench login` before authenticated Workbench Cloud remotes. Use `workbench auth status|connect|disconnect` when a provider-backed agent needs explicit adapter auth. Codex supports local `api-key` and `oauth` capture; Claude supports local `api-key`, `oauth`, and `bedrock` capture. When logged in, `connect` and `disconnect` update the matching Workbench Cloud adapter connection unless `--local-only` is passed.

## What Belongs In The Skill Layer

Keep these in skills unless core runtime support is required: discovering cases from conversations or traces, drafting rubrics, choosing examples, writing workflow-specific checks, deciding improvement strategy, and explaining whether the evidence is good enough.

## References

Load only what is needed:

- `references/docs/cli.md` for command syntax.
- `references/docs/evals/README.md` for source shape and authoring loop.
- `references/SPEC.md` for the hard-cut product contract.
