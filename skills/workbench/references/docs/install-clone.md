# Install and clone

Install a published package when someone needs an agent-visible Skill. Clone a Skill when they need editable Workbench files, Evals, and future improvement loops.

See [Publish](share.md) for package publication before handoff and [Skill packages](skills.md) for the installable boundary.

## Install

Use `install` for an agent-visible skill package:

```bash
workbench skill install OWNER/SKILL
workbench skill install OWNER/SKILL@VERSION
```

`install` copies the Agent Skills package only: `SKILL.md`, scripts, references, assets, `dist/**`, and support files. It does not copy `.workbench` eval controls or runtime state.

External Agent Skill sources can still install through Workbench. Workbench-only behavior such as clone, eval evidence, improvement lineage, and Cloud visibility does not apply to external installs.

## Clone

Use `clone` for an editable Workbench Skill, Evals, and future improvements:

```bash
workbench skill clone OWNER/SKILL ./local-copy
```

Use `install` for an agent-visible package. Use `clone` for a Skill that needs Workbench Evals, evidence, and future improvement loops.
