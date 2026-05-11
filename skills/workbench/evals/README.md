# Workbench Skill-Eval Catalog

This directory holds the product-local ergonomics catalog for the `workbench` CLI skill. It tests whether the skill drives local project commands, Workbench Cloud commands, and eval-authoring docs correctly when creating benchmark evaluations.

It is not the public guide for creating Workbench benchmark evaluations. Eval authoring guidance lives under `products/workbench/docs/evals/` and is copied into installed skills as `references/docs/evals/`.

The evals intentionally cover the local-first CLI, Workbench Cloud layer, and eval-authoring entry points:

- configuring a Workbench Cloud API target
- verifying or installing the published Workbench package
- authoring evals from existing workflows
- authoring evals from `.docx`, `.xlsx`, `.pdf`, or `.pptx` file outputs
- creating a benchmark and pushing source
- idempotent pushes
- starting and watching eval/improve workflows
- opening or returning Workbench Cloud URLs so an agent can keep an embedded browser synchronized with CLI work
- inspecting, previewing, and exporting hosted subject snapshots

They should reward the public local workflow, hosted `workbench cloud` workflow, and eval-authoring behavior.

Validate the catalog from `products/workbench`:

```bash
pnpm cli-skill-evals:validate
```
