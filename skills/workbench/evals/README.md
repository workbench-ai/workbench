# Workbench Skill-Eval Catalog

This product-local catalog checks whether the Workbench skill drives the hard-cut skill runtime correctly.

It rewards:

- using `SKILL.md`, `.workbench/eval.yaml`, `.workbench/cases`, `.workbench/agents.yaml`, and optional `.workbench/skills.yaml`
- running `workbench`, `workbench status`, `workbench log`, `workbench show`, `workbench eval`, `workbench improve`, and `workbench compare`
- treating versions as automatic source snapshots
- using agents for local command and provider-backed eval configurations
- treating the web UI as read-only inspection
- using Workbench object remotes with `workbench sync` and explicit source publication with `workbench publish`
- keeping workflow-specific authoring in the skill layer

Validate from `products/workbench` when the skill-eval runner is available:

```bash
pnpm cli-skill-evals:validate
```
