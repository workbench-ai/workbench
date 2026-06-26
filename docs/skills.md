# Skill packages

Workbench publishes and installs standard [Agent Skills](https://agentskills.io/specification). A skill package is the source an agent can use directly: `SKILL.md` plus optional scripts, references, assets, `dist/**`, and support files.

Workbench adds evals, evidence, versions, improvement loops, and publishing around that package. Those project files are not part of the installed Agent Skill.

## Package boundary

| Agent Skill package | Workbench project |
| --- | --- |
| `SKILL.md` instructions | `.workbench/eval.yaml` grading standard |
| `scripts/`, `references/`, `assets/`, `dist/**` | `.workbench/cases/**` workflow cases |
| Files an agent needs at runtime | `.workbench/agents.yaml` agent configuration |
| Installable published source | Runs, traces, artifacts, results, versions, and lineage |

Keep reusable workflow instructions, scripts, reference material, and assets in the package. Keep evaluation criteria, cases, runtime configuration, and generated evidence in `.workbench/**`.

## Install

`workbench install` copies the Agent Skill package only:

```bash
workbench install OWNER/SKILL
workbench install OWNER/SKILL@VERSION
```

It does not copy `.workbench` eval controls, run history, traces, artifacts, remotes, sync state, or local runtime files. For Workbench-published packages, Workbench records the source handle and exact published version. External Agent Skill sources can still install through Workbench. Workbench-only behavior such as clone, eval evidence, improvement lineage, and Cloud visibility does not apply.

## Clone

`workbench clone` creates editable source in a fresh Workbench project:

```bash
workbench clone OWNER/SKILL ./local-copy
```

Use `install` when the recipient only needs the skill in an agent. Use `clone` when they need editable source, evals, and future improvement loops.

## Authoring

Use the upstream [skill creator best practices](https://agentskills.io/skill-creation/best-practices) for general Agent Skill authoring. Use Workbench when you need a measured development loop: representative cases, graded evidence, version history, improvement proofs, publishing, install, and clone.
