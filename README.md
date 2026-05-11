# Workbench

Workbench is an open-source, local-first benchmark workbench for evaluating and improving agent candidates.

This public repository contains the Workbench CLI package, core benchmark engine, adapter protocol, reusable Workbench UI, the shared CLI Web UI package used by that UI, first-party harness packages used by the built-in adapters, documentation, environments, and the installable Workbench agent skill.

Hosted Workbench Cloud infrastructure, hosted persistence, billing, auth, worker fleet code, and Terraform are not part of this repository.

## Install The Agent Skill

```bash
npx skills add workbench-ai/workbench
```

The skill source lives at `skills/workbench/SKILL.md`. This repository intentionally has no root `SKILL.md`; keeping the skill nested ensures the installer copies only the skill directory, not the full source tree.

## Source Layout

- `packages/cli`: `@workbench-ai/workbench`, the `workbench` command package
- `packages/core`: local benchmark runtime and execution engine
- `packages/protocol`: adapter protocol helpers
- `packages/contract`: Workbench benchmark and result contract types
- `packages/built-in-adapters`: built-in command, rubric, Codex, Claude, and Pi adapters
- `packages/workbench-ui`: reusable Workbench UI surface
- `packages/cli-web-ui`: shared UI primitives and preview components used by Workbench UI
- `packages/harness-*` and `packages/contracts`: first-party harness packages used by built-in agent adapters
- `docs`, `SPEC.md`, and `ARCHITECTURE.md`: Workbench behavior and architecture references
- `environments`: reusable benchmark environment Dockerfiles
- `skills/workbench`: installable Workbench skill for AI coding agents

## Local Development

```bash
pnpm install
pnpm build
pnpm test
```

The exported source keeps package names unchanged so workspace imports match the published package names.
