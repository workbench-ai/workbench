# CLI Web UI

Shared cross-product web UI package for Flow web, Workbench Cloud, hosted Workbench, legacy `chat-web`, `agent-ui`, and embedded Flow surfaces.

This root owns the reusable styling, shadcn-based primitives, shell helpers, and read-only file preview surfaces that shared consumers import. That shared preview layer now includes the Codex-style `.xlsx` spreadsheet viewer under `components/shared/spreadsheet-viewer.tsx` plus the OOXML parser, workbook model, and grid helpers under `lib/spreadsheet-viewer*.ts`, with a unified consumer entrypoint at `@workbench-ai/cli-web-ui/spreadsheet-viewer`. Product-specific behavior, routes, branding, and runtime semantics stay in the owning product roots.

Start with [AGENTS.md](AGENTS.md) for working instructions, [DESIGN.md](DESIGN.md) for the shared visual-system canon, [ARCHITECTURE.md](ARCHITECTURE.md) for ownership boundaries, [PLANS.md](PLANS.md) for the shared ExecPlan wrapper, and [plans/index.md](plans/index.md) for local plan history.
