# Skills

This document owns the skill layout for the Workbench product tree.

## Source Of Truth

The canonical general public skill source lives under `skills/workbench/`. Keep that authored tree thin:

- `SKILL.md` is the agent-facing wrapper.
- `agents/openai.yaml` is the install metadata.
- `evals/` is the product-local ergonomics catalog.
- `skill.assets.json` declares which canonical docs are copied into the installed skill.

`docs/cli.md` owns the command and operator flow, `SPEC.md` owns the remote CLI contract, `docs/evals/` owns eval authoring and file-output task guidance, and `docs/testing.md` owns validation and remote e2e guidance. The authored skill should point to those canonical files instead of carrying its own product guide.

When the authored docs or skill mention tasks, preserve the engine boundary: `version: 4` `benchmark.yaml` selects an engine, the built-in `workbench` engine owns native task directories through its own `engine.with.tasks` path setting, native task manifests remain `version: 3`, and Harbor directories are parsed by the external `harbor` engine adapter.

Keep this ownership at the Workbench product root. The `packages/cli` package should not own product docs or skills; it owns the binary implementation and command tests. Workbench Cloud renders the product docs through its remote shell, but it should not duplicate the public docs content.

## Installable Skill Assembly

The installable Workbench skill is assembled from `skills/workbench/` by the shared skill asset sync helper. Product-local `skill.assets.json` keeps the authored skill thin while copying canonical docs into the published or installed skill tree.

The exported public source repository already contains the installable skill at `skills/workbench`. Private monorepo maintainers may use `pnpm skills:sync` before publishing to debug the same installed skill layout.

## Validation Boundary

This public source repository contains the exported `skills/workbench/` tree and the product-local eval catalog. The skill stays nested at `skills/workbench/SKILL.md` so `npx skills add workbench-ai/workbench` installs only the skill directory, not the source packages.

The local proof loop for the authored Workbench skill surface is:

- `pnpm cli-skill-evals:validate`
- `pnpm test`
- private maintainer source-export validation before publication

The `skills/workbench/evals/` directory is only the skill-ergonomics catalog used to test the public skill. It is not the public guide for Workbench benchmark eval authoring; that guide lives under `docs/evals/`.

## Installed Copies

Do not edit installed user-home skills directly. After changing authored source in the private monorepo, maintainers validate and republish this source snapshot, then refresh installed copies through the normal skill installer path, such as `npx skills add workbench-ai/workbench`.

## Public Source Export

Maintainers run these commands from the private monorepo root after changing Workbench source, shared `cli-web-ui`, first-party agent driver packages, or the authored Workbench skill:

- `pnpm workbench:public-source:build`
- `pnpm workbench:public-source:validate`

The generated source snapshot lives under `out/public-source/workbench`. It includes Workbench packages, `packages/cli-web-ui`, first-party agent driver packages, docs, environments, and `skills/workbench`. It intentionally excludes Workbench Cloud, remote auth, Terraform, generated output, `node_modules`, and root `SKILL.md`.
