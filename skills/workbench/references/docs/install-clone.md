# Install and clone

Install published source when someone needs an agent-visible skill package. Clone source when they need editable Workbench files, evals, and future improvement loops.

See [Publish](share.md) for source publication before handoff and [Skill packages](skills.md) for the installable package boundary.

## Install

Use `install` for an agent-visible skill package:

```bash
workbench install OWNER/SKILL
workbench install OWNER/SKILL@VERSION
```

`install` copies the Agent Skills package only: `SKILL.md`, scripts, references, assets, `dist/**`, and support files. It does not copy `.workbench` eval controls or runtime state.

External Agent Skill sources can still install through Workbench. Workbench-only behavior such as clone, eval evidence, improvement lineage, and Cloud visibility does not apply to external installs.

## Clone

Use `clone` for editable Workbench source, evals, and future improvements:

```bash
workbench clone OWNER/SKILL ./local-copy
```

Use `install` for an agent-visible package. Use `clone` for source that needs Workbench evals, evidence, and future improvement loops.
