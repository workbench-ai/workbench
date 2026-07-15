# Workbench Skill-Eval Catalog

This product-local catalog checks whether the Workbench skill teaches the current Workbench CLI and source model correctly.

It checks:

- using `SKILL.md`, `.workbench/eval.yaml`, `.workbench/cases`, `.workbench/agents.yaml`, and optional `.workbench/versions.yaml`
- running `workbench skill show`, `workbench skill versions`, `workbench eval show`, `workbench eval run`, `workbench eval grade`, `workbench skill improve`, and `workbench eval results`
- treating versions as evaluated skill versions
- using agents for local command and provider-backed eval configurations
- treating the web UI as a snapshot-backed, capability-driven inspection and operation-start surface
- using `workbench skill sync` for explicit repair or portability and `workbench skill publish` for source publication
- keeping workflow-specific authoring in the skill layer

Validate from `products/workbench` when the skill-eval runner is available:

```bash
pnpm cli-skill-evals:validate
```
