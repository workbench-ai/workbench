# CLI Web UI Architecture

This root owns the shared web presentation layer used by Flow web, hosted Workbench Cloud and Workbench, legacy `chat-web`, `products/agent-ui`, and embedded Flow surfaces in the monorepo.

## Ownership

- `DESIGN.md`: the human- and agent-readable visual-system canon for the shared web surfaces.
- `shadcn.foundation.json`: the preset metadata that declares the active preset id and scaffold template for this package.
- `components.json`: the checked-in shadcn project configuration for this package.
- `components/ui/`: generic UI primitives that are product-neutral.
- `hooks/use-mobile.ts`: generated shadcn infrastructure that belongs to the foundation layer.
- `components/shared/`: reusable shell helpers plus the shared read-only file preview stack (`streaming-markdown`, `markdown-document-view`, `ai-code-view`, `preview-panel`, `tabular-preview`, `pdf-preview`, `files-browser`, `view-switch`, `spreadsheet-viewer`, `execution-trace-timeline`, and related list helpers).
- `lib/`: shared helpers such as class-name merging, source-format detection, tabular preview parsing, spreadsheet viewer parsing/runtime helpers, and the product-neutral execution trace timeline projection.
- `spreadsheet-viewer.ts`: the ergonomic package entrypoint that re-exports the spreadsheet viewer component plus its parser/runtime types for shared consumers.
- `styles/preset.css`: the preset-owned CSS-variable theme and base font layer regenerated from the active preset.
- `styles/extensions.css`: repo-owned semantic token and utility extensions that sit on top of the preset layer.
- `styles/base.css`: repo-owned resets and behavior styles for markdown, previews, and shared chrome.
- `styles.css` and `chat-web.css`: consumer entrypoints that import the shared style layers and declare their own Tailwind `@source` scope. Current products use `styles.css`; `chat-web.css` is the legacy chat-specific scanner entrypoint.

## Boundaries

- Chat-specific conversation composition stays in `products/agent-ui`.
- Flow-specific branding, navigation, route composition, and runtime-backed views stay in `products/flow-cli`.
- Workbench-specific archive views, lineage projections, and runtime-backed views stay in `products/workbench`.
- Workbench Cloud and hosted Workbench routing, session handling, API semantics, and deployment ownership stay in `products/workbench-cloud`.
- Legacy chat routing, session handling, and product semantics stay in `products/chat-web`.
- This root should not own product semantics, API clients, or route state.

## Invariants

- `products/cli-web-ui` is the design-system canon for shared web surfaces, with `DESIGN.md`, `components.json`, shared styles, and the shadcn foundation verifier describing one source of truth.
- The preset-enforced shadcn foundation under `components.json`, `styles/preset.css`, `components/ui/`, and `hooks/use-mobile.ts` is the canonical base layer and should not carry product-specific behavior.
- Shared compositions under `components/shared/` may add reusable behavior or layout, but they must stay product-neutral.
- Shared components must stay semantic and keyboard accessible.
- Shared styles should avoid hard-coded product branding and keep preset-owned versus repo-owned layers explicit.
