# Skill packages

Workbench publishes and installs standard [Agent Skills](https://agentskills.io/specification). A Skill package is what an agent can use directly: `SKILL.md` plus optional scripts, references, assets, `dist/**`, and support files.

Workbench adds evals, evidence, versions, improvement loops, and publishing around that package. Those project files are not part of the installed Agent Skill.

## Package boundary

| Agent Skill package | Workbench project |
| --- | --- |
| `SKILL.md` instructions | `.workbench/eval.yaml` grading standard |
| `scripts/`, `references/`, `assets/`, `dist/**` | `.workbench/cases/**` workflow cases |
| Files an agent needs at runtime | `.workbench/agents.yaml` agent configuration |
| Installable published package | Runs, traces, artifacts, results, versions, and lineage |

Keep reusable workflow instructions, scripts, reference material, and assets in the package. Keep evaluation criteria, cases, runtime configuration, and generated evidence in `.workbench/**`.

## Install

`workbench skill install` copies the Agent Skill package only:

```bash
workbench skill install OWNER/SKILL
workbench skill install OWNER/SKILL@VERSION
```

It does not copy `.workbench` Eval controls, run history, traces, artifacts, remotes, sync state, or local runtime files. For Workbench-published packages, Workbench records the Skill handle and exact published version. External Agent Skill locations can still install through Workbench. Workbench-only behavior such as clone, Eval evidence, improvement lineage, and Cloud visibility does not apply.

## Clone

`workbench skill clone` creates an editable Skill in a fresh Workbench project:

```bash
workbench skill clone OWNER/SKILL ./local-copy
```

Use `install` when the recipient only needs the Skill in an agent. Use `clone` when they need an editable Skill, Evals, and future improvement loops.

## Authoring

Use the upstream [skill creator best practices](https://agentskills.io/skill-creation/best-practices) for general Agent Skill authoring. Use Workbench when you need a measured development loop: representative cases, graded evidence, version history, improvement proofs, publishing, install, and clone.
