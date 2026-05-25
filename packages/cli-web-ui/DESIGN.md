---
version: alpha
name: Workbench Shared Web UI
description: Shared shadcn-native visual system for Workbench web surfaces.
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  card: "oklch(1 0 0)"
  card-foreground: "oklch(0.145 0 0)"
  primary: "oklch(0.508 0.118 165.612)"
  primary-foreground: "oklch(0.979 0.021 166.113)"
  secondary: "oklch(0.967 0.001 286.375)"
  secondary-foreground: "oklch(0.21 0.006 285.885)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  border: "oklch(0.922 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  success: "oklch(0.627 0.154 150.03)"
  warning: "oklch(0.795 0.163 82.84)"
  warning-foreground: "oklch(0.205 0 0)"
  chart-performance: "oklch(0.627 0.154 150.03)"
  chart-speed: "oklch(0.623 0.188 259.81)"
  chart-cost: "oklch(0.795 0.163 82.84)"
typography:
  heading:
    fontFamily: Geist Variable
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: Geist Variable
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Geist Variable
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.3
rounded:
  sm: 4px
  md: 8px
  lg: 10px
  xl: 14px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
components:
  button-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    height: 32px
    padding: "{spacing.sm}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    height: 32px
    padding: "{spacing.sm}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    height: 32px
    padding: "{spacing.sm}"
  button-ghost:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    height: 32px
    padding: "{spacing.sm}"
  button-link:
    backgroundColor: "{colors.background}"
    textColor: "{colors.primary}"
    typography: "{typography.body}"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.background}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    height: 32px
    padding: "{spacing.sm}"
  button-group:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    height: 32px
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    height: 32px
  textarea:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
  input-group:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    height: 32px
  select-trigger:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    height: 32px
  label:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
  switch:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.full}"
    height: 20px
  toggle:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    height: 32px
  toggle-active:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    height: 32px
  badge-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.full}"
    typography: "{typography.label}"
    height: 20px
  badge-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.full}"
    typography: "{typography.label}"
    height: 20px
  badge-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
    typography: "{typography.label}"
    height: 20px
  badge-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.background}"
    rounded: "{rounded.full}"
    typography: "{typography.label}"
    height: 20px
  badge-success:
    backgroundColor: "{colors.success}"
    rounded: "{rounded.full}"
    typography: "{typography.label}"
    height: 20px
  badge-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.warning-foreground}"
    rounded: "{rounded.full}"
    typography: "{typography.label}"
    height: 20px
  alert:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    padding: "{spacing.md}"
  alert-destructive:
    backgroundColor: "{colors.card}"
    textColor: "{colors.destructive}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    padding: "{spacing.md}"
  alert-dialog-content:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    typography: "{typography.body}"
    padding: "{spacing.md}"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    typography: "{typography.body}"
    padding: "{spacing.md}"
  dialog-content:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    typography: "{typography.body}"
    padding: "{spacing.md}"
  sheet-content:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    typography: "{typography.body}"
    padding: "{spacing.md}"
  drawer-content:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    typography: "{typography.body}"
    padding: "{spacing.md}"
  command-content:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    typography: "{typography.body}"
    padding: "{spacing.xs}"
  dropdown-menu-content:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    padding: "{spacing.xs}"
  tooltip-content:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.background}"
    rounded: "{rounded.md}"
    typography: "{typography.label}"
    padding: "{spacing.sm}"
  accordion:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
  collapsible:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
  breadcrumb:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body}"
  tabs-list:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    height: 32px
  tabs-trigger-active:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    typography: "{typography.body}"
  view-switch:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    height: 32px
  sidebar:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
  sidebar-menu-active:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.md}"
    typography: "{typography.body}"
    height: 32px
  scroll-area:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
  resizable-panel:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
  table:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
  table-header:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.label}"
  skeleton:
    backgroundColor: "{colors.muted}"
    rounded: "{rounded.md}"
  spinner:
    textColor: "{colors.muted-foreground}"
    size: 16px
  progress:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.full}"
    height: 8px
  avatar:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
    typography: "{typography.body}"
    size: 32px
  sonner-toast:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    padding: "{spacing.md}"
  chart-performance-swatch:
    backgroundColor: "{colors.chart-performance}"
    rounded: "{rounded.sm}"
  chart-speed-swatch:
    backgroundColor: "{colors.chart-speed}"
    rounded: "{rounded.sm}"
  chart-cost-swatch:
    backgroundColor: "{colors.chart-cost}"
    rounded: "{rounded.sm}"
  separator:
    backgroundColor: "{colors.border}"
    height: 1px
  workspace-root:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
  workspace-pane:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    padding: "{spacing.md}"
---

# Design System

## Overview

This is the canonical design-system document for the shared web surfaces in this monorepo: `products/cli-web-ui`, `products/agent-ui`, hosted Workbench Cloud and Workbench, and legacy `chat-web`.

The system is preset-first and shadcn-native. The primitive layer comes from the checked-in shadcn project defined by `products/cli-web-ui/shadcn.foundation.json` and materialized through the local shadcn sync flow. The current live foundation is preset `b2BVC6PHE`, which resolves to the `radix-nova` project. Product surfaces compose those primitives through thin shared wrappers and product-owned route shells.

The visual language stays neutral across products. It is compact enough for operator tooling, calm enough for end-user chat surfaces, and consistent between standalone apps and embedded panels. Density comes from disciplined spacing, semantic color roles, rounded containers, and border contrast instead of custom chrome or brand-specific primitives.

## Colors

The shared palette is defined by semantic CSS tokens in two layers. `styles/preset.css` is preset-owned and should stay replaceable from the active shadcn preset. `styles/extensions.css` is repo-owned and adds the small set of semantic tokens still needed by this repo, including `success`, `warning`, the full chart palette, semantic chart aliases, checkerboard colors, and Monaco shell background colors. The preset-owned layer still exposes shadcn’s `--chart-*` hooks, but the repo-owned layer now overrides the final `--chart-1` through `--chart-6` values and defines semantic aliases such as `--chart-performance`, `--chart-speed`, and `--chart-cost`. The values below are human-readable anchors for the current system; the CSS tokens remain the source of truth.

- **Primary** (`oklch(0.508 0.118 165.612)`): primary actions, active states, focused accents
- **Secondary** (`oklch(0.967 0.001 286.375)`): secondary fills, muted controls, low-emphasis surfaces
- **Background** (`oklch(1 0 0)`): page backgrounds and default light-mode surfaces
- **Foreground** (`oklch(0.145 0 0)`): primary text and high-contrast content
- **Border** (`oklch(0.922 0 0)`): separators, card framing, input borders, and outlines
- **Success** (`oklch(0.627 0.154 150.03)`): positive statuses and confirmations
- **Warning** (`oklch(0.795 0.163 82.84)`): cautionary states and warning badges
- **Error** (`oklch(0.577 0.245 27.325)`): destructive actions, failures, and invalid states

Dark mode uses the same semantic roles with alternate token values under `.dark`. Consumer code should use semantic classes such as `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, and `bg-primary` instead of raw color literals.

## Typography

- **Headline Font**: Geist Variable / Geist
- **Body Font**: Geist Variable / Geist
- **Label Font**: Geist Variable / Geist

Headlines, body copy, and labels all use the same sans-serif family so dense operator surfaces and chat surfaces feel like one system. Hierarchy comes from scale, spacing, and weight rather than switching font families.

Headlines generally use semi-bold weight. Body copy stays regular at compact UI sizes. Labels use compact sizes and medium weight; uppercase is reserved for small section metadata, not for default UI copy.

## Layout

Shared surfaces use compact, full-height workbench layouts rather than marketing-page sections. Route shells should compose `WorkspaceRoot`, `WorkspacePane`, and `DesktopWorkspaceSplit` for operator workspaces, with product routes owning the nouns, route state, and runtime data.

Spacing follows the Tailwind/shadcn rhythm exposed by the shared primitives: small control gaps, 16px default content padding, and 24px or 32px only when grouping large route regions. Keep panels scannable and avoid nested card frames when a border, separator, or muted surface step carries the hierarchy.

## Elevation

This system is low-elevation by default. Depth comes from border contrast, muted surface steps, rounded containers, and subtle background changes rather than heavy shadows.

Cards, panels, inspectors, and route shells should read as structured surfaces, not floating marketing tiles. Shadows are acceptable when a stock overlay primitive already provides them, but they are not the primary depth signal.

## Shapes

The shape language comes from the shadcn radius scale in `styles/preset.css`: compact controls use small-to-medium rounded corners, panels and dialogs use larger rounded containers, and badges or avatars may use fully rounded shapes. Do not use pill shapes as the default control style unless the stock primitive already does.

## Components

- **Foundation**: `components/ui/*` plus `hooks/use-mobile.ts` are the generated shadcn foundation. Buttons, cards, inputs, dialogs, sheets, tabs, toggles, tooltips, sidebars, charts, and related controls come from this layer and stay as close to generated source as possible.
- **Shared compositions**: `components/shared/*` adds behavior-heavy but product-neutral wrappers such as `FilesBrowser`, `PreviewPanel`, `RouteToolbar`, `ViewSwitch`, `WorkspaceRoot`, `WorkspacePane`, `DesktopWorkspaceSplit`, `SourceEditorDialogShell`, markdown and code rendering, and preview surfaces. `ViewSwitch` is the route-state wrapper for sibling-view navigation, but it should visually reuse the stock shadcn line-tabs treatment instead of inventing a second control style. `WorkspaceRoot`, `WorkspacePane`, and `DesktopWorkspaceSplit` are the shared shell contract for full-height operator workspaces; product routes should compose them instead of rebuilding pane headers, split dividers, or viewport roots locally.
- **Chat composition**: `products/agent-ui` composes the shared primitives into thread lists, conversation layouts, composer shells, and lightweight activity renderers.
- **Product composition**: Workbench Cloud/Workbench and legacy `chat-web` own route composition, runtime-backed views, and product semantics while importing their foundation and shared wrappers from `@workbench-ai/cli-web-ui`.

Use built-in variants, semantic tokens, and stock shadcn composition first. Higher layers should add behavior, information architecture, or product semantics, not a second primitive system.

The checked-in generated foundation currently contains these shadcn components:

- **Actions and toggles**: `button`, `button-group`, `toggle`, `toggle-group`, `switch`
- **Forms and inputs**: `input`, `textarea`, `input-group`, `select`, `label`
- **Navigation**: `breadcrumb`, `tabs`, `sidebar`
- **Disclosure and layout**: `accordion`, `collapsible`, `card`, `resizable`, `scroll-area`, `separator`, `table`
- **Feedback and status**: `alert`, `alert-dialog`, `badge`, `progress`, `skeleton`, `spinner`, `sonner`
- **Overlays and commands**: `command`, `dialog`, `drawer`, `dropdown-menu`, `sheet`, `tooltip`
- **Identity and visualization**: `avatar`, `chart`

Component composition rules:

- `Button` owns action styling. Use its built-in `variant` values (`default`, `outline`, `secondary`, `ghost`, `destructive`, `link`) and `size` values before adding local classes. Icons inside buttons should use `data-icon` placement and rely on the component's icon sizing.
- `ButtonGroup` is for adjacent controls that function as one command cluster. Do not recreate joined-button borders with manual negative margins or ad hoc rounded-corner overrides.
- `ToggleGroup` is the default for two-to-seven mutually exclusive or multi-select view, mode, and filter choices. Use a single `Toggle` only for standalone pressed state.
- `InputGroup` owns input adornments and embedded input actions. Use `InputGroupInput`, `InputGroupTextarea`, `InputGroupAddon`, `InputGroupButton`, and `InputGroupText` rather than placing raw inputs or buttons inside a styled wrapper.
- `SelectItem` belongs inside `SelectGroup`; command-palette rows belong inside `CommandGroup`; dropdown items belong inside `DropdownMenuGroup` when grouped. Keep Radix item/group semantics intact.
- `Card` should use the full `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, and `CardFooter` composition when a surface has a title, action, content, or footer. Do not use nested cards for page layout.
- `Tabs` are for content modes that own tab panels. Route-local sibling navigation uses shared `ViewSwitch`, which wraps `TabsList variant="line"` and `TabsTrigger`.
- `Sidebar` is the only primitive for app-side navigation and workspace navigation rails. Product roots may own menu structure and active-route semantics, but should not create another sidebar primitive.
- `Dialog`, `Sheet`, `Drawer`, and `AlertDialog` must include their title components for accessibility. Use visually hidden titles when a design does not show a heading.
- `Alert` is for inline callouts and errors; `AlertDialog` is for blocking confirmation. Use `sonner` for transient toast feedback.
- `Skeleton` is the loading placeholder primitive. Use it instead of one-off pulsing boxes.
- `Spinner` is the compact loading indicator for buttons, renderer initialization, and other small waits where a layout placeholder would be misleading.
- `Separator` is the separator primitive. Use it instead of raw `hr` elements or decorative border-only dividers.
- `Badge` owns compact labels and status marks. Use stock variants or the repo-owned semantic badge helper in `lib/badge.ts`; avoid bespoke colored spans.
- `Chart` wrappers own Recharts theming and tooltip/legend behavior. Product roots should pass data and semantic chart keys, not local chart chrome.
- `ScrollArea` and `Resizable` are low-level layout primitives. Prefer the shared `ViewportScrollArea` and `DesktopWorkspaceSplit` wrappers for product workspaces so scrolling and split-pane behavior stay consistent.

## Do's and Don'ts

- Do compose from existing `components/ui/*` and `components/shared/*` before creating new abstractions.
- Do use the shared `ViewSwitch` for route-local sibling-view navigation, and keep it visually aligned with `TabsList variant="line"` and `TabsTrigger`.
- Do keep `Tabs` for true content-mode panels that own tab content.
- Do use semantic tokens and built-in variants instead of raw color values or product-local restyling.
- Do keep route state, runtime wiring, and product semantics in consumer roots.
- Don't create a parallel product-local primitive or token layer.
- Don't hand-edit generated shadcn foundation files under `components/ui/*` or `hooks/use-mobile.ts`.
- Don't use the shared package to encode product-specific branding or navigation semantics.

## Source of Truth and Enforcement

`products/cli-web-ui/components.json` is the configuration canon for the shared shadcn project. The current checked-in facts are:

- preset code: `b2BVC6PHE`
- style: `radix-nova`
- base primitive library: `radix`
- Tailwind version: `v4`
- icon library: `lucide`

`products/cli-web-ui/shadcn.foundation.json` stores the opaque preset id and template used to regenerate preset-owned files. `components.json` stays as the operational shadcn project config for this package and intentionally points its Tailwind CSS entry at `styles/preset.css` instead of the public consumer entrypoints.

The raw foundation layer is checked by `products/cli-web-ui/scripts/verify-shadcn-foundation.mjs`, which is exposed through `pnpm --dir products/cli-web-ui foundation:check`. It intentionally stays out of routine `lint` and `build` because it regenerates upstream shadcn scaffold state through networked CLI calls.

The DESIGN.md token layer is linted through `pnpm --dir products/cli-web-ui design:lint`. The checked-in frontmatter intentionally uses OKLCH so it can mirror the Tailwind v4 and shadcn source tokens. The local lint wrapper preprocesses those OKLCH values to sRGB hex before invoking the current upstream `@google/design.md` linter, and reports any gamut clipping that occurs during conversion. Do not run the upstream `npx @google/design.md lint DESIGN.md` command directly for this package until the upstream spec accepts OKLCH color tokens.

`pnpm --dir products/cli-web-ui foundation:sync` is the sanctioned refresh path. It regenerates `components.json`, `styles/preset.css`, and the foundation files under `components/ui/*` plus `hooks/use-mobile.ts`, then reapplies the package-local import-path rewrite required by this package.

The verifier rejects drift in `components.json`, `styles/preset.css`, `components/ui/*`, and `hooks/use-mobile.ts` relative to generated shadcn source. The only sanctioned local difference inside foundation source files is the package-local import-path rewrite from `@/...` aliases to relative imports so `@workbench-ai/cli-web-ui` can export raw source files directly.

## Surface Mapping

`products/cli-web-ui/styles.css` is the shared stylesheet for Workbench Cloud and hosted Workbench. It imports `styles/preset.css`, `styles/extensions.css`, and `styles/base.css`, then adds the consumer-specific `@source` declarations for the shared package tree.

`products/cli-web-ui/chat-web.css` exists only for legacy `chat-web`, which needs widened Tailwind source scanning across both `products/chat-web` and `products/agent-ui`. It imports the same preset, extension, and base layers, then widens the `@source` surface for that app and the shared chat package. `chat-web` imports `@workbench-ai/cli-web-ui/chat-web.css`, while Workbench Cloud and hosted Workbench import `@workbench-ai/cli-web-ui/styles.css`.

`products/agent-ui` sits on top of the same primitive and token system. It contributes chat-specific composition, but its rendered styles are still part of the shared `cli-web-ui` design system rather than a second visual foundation.

## Ownership Boundaries

`products/cli-web-ui` owns primitive source, preset and extension theme layers, shared shell helpers, and preview or editor surfaces that are reusable across products.

`products/agent-ui` owns chat-specific composition on top of that base.

`products/workbench-cloud`, `products/workbench`, and legacy `products/chat-web` own routing, runtime-backed data, and product semantics. If a component exists only to restyle a primitive, it belongs back in the shared system or should be deleted.
