# Workbench

Workbench is an open-source, local-first skill management runtime for versioning, evaluating, improving, and syncing agent skills.

This public repository contains the Workbench CLI package, local skill runtime, adapter protocol, reusable Workbench UI, the shared CLI Web UI package used by that UI, documentation, and the installable Workbench agent skill.

Managed Workbench Cloud infrastructure, remote persistence, billing, auth, worker fleet code, and Terraform are not part of this repository.

## Install The Agent Skill

```bash
npx skills add workbench-ai/workbench
```

The skill source lives at `skills/workbench/SKILL.md`. This repository intentionally has no root `SKILL.md`; keeping the skill nested ensures the installer copies only the skill directory, not the full source tree.

## Source Layout

- `packages/cli`: `@workbench-ai/workbench`, the `workbench` command package
- `packages/core`: local eval runtime and execution engine
- `packages/protocol`: adapter protocol helpers
- `packages/contract`: Workbench eval and result contract types
- `packages/built-in-adapters`: first-party adapter manifests plus command, Codex, and Claude adapter shims
- `packages/workbench-ui`: reusable Workbench UI surface
- `packages/cli-web-ui`: shared UI primitives and preview components used by Workbench UI
- `docs`: public docs, starting with `docs/index.md` and `docs/quickstart.md`
- `ARCHITECTURE.md`: package boundaries and runtime ownership
- `skills/workbench`: installable Workbench skill for AI coding agents

## Local Development

Install dependencies, then run the standard build and test loop.

```bash
pnpm install
pnpm build
pnpm test
```

The exported source keeps package names unchanged so workspace imports match the published package names.
