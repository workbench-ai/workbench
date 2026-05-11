# Product

## Register

product

## Users

Workbench and Flow builders use this shared UI system while creating, reviewing, and operating agent workflows, hosted evaluations, public docs, and embedded product surfaces. They include developers configuring CLI-backed hosted projects, operators inspecting runs and generated artifacts, readers evaluating Workbench from public marketing and documentation pages, and product engineers composing shared primitives into Flow, Workbench Cloud, agent chat, and embedded panels.

Their context alternates between dense authenticated tools and public entry points. In the app, they need compact controls, stable navigation, readable previews, and trustworthy status feedback while moving through specs, candidates, files, comparisons, executions, and task review. In public or logged-out Workbench surfaces, they need a bright, professional path from explanation to docs, setup, login, and hosted Workbench without leaving the shared design language.

## Product Purpose

`products/cli-web-ui` provides the canonical shared web presentation layer for Workbench, Flow, agent UI, legacy chat surfaces, and embedded Flow panels. It owns product-neutral shadcn primitives, semantic design tokens, shared workspace shells, preview surfaces, and helper components that consumer products compose without creating their own primitive or token systems.

Success means every Workbench and Flow web surface feels like one coherent product family while still leaving product-specific routing, branding, runtime state, and domain semantics in the owning product roots. Shared components should make the right product UI easier to build than a bespoke local variant.

## Brand Personality

Bright, professional, opinionated.

The interface should feel precise and capable without becoming cold. It should borrow the confidence and clean commercial polish of Stripe, the legible workspace calm of Notion, the crisp financial-product restraint of Mercury, and the developer-native polish of Vercel. It should express strong defaults through composition, density, and interaction quality rather than decorative chrome.

## Anti-references

Do not make shared surfaces look like generic SaaS marketing templates, dark terminal dashboards by default, heavy enterprise admin software, or a patchwork of product-local component systems. Avoid product-specific branding in `cli-web-ui`, bespoke primitives that duplicate shadcn, raw color literals, nested card layouts, decorative gradients, glass effects, and local restyling that fights the shared tokens.

Public Workbench marketing, docs, onboarding, and login surfaces may be more brand-forward than authenticated workspaces, but they still should not fork the visual system or turn shared UI into a marketing-only design language.

## Design Principles

1. Product-neutral by default: shared primitives and wrappers carry reusable structure, not Flow- or Workbench-specific semantics.
2. One coherent family: app workspaces, docs, marketing routes, login, and embedded panels should feel related even when their information density differs.
3. Opinionated composition: prefer sanctioned shadcn primitives, shared shells, semantic tokens, and existing wrappers before inventing local variants.
4. Compact confidence: dense operator views should stay scannable, calm, and exact through spacing, hierarchy, and status clarity.
5. Public paths stay real: landing, docs, onboarding, pricing, and logged-out states should guide users directly into setup or hosted Workbench without feeling detached from the product.

## Accessibility & Inclusion

Shared components must stay semantic, keyboard accessible, and compatible with assistive technology. Dialogs, sheets, drawers, and alert dialogs need accessible titles even when visually hidden. Navigation should expose active state with appropriate ARIA, controls should preserve native Radix/shadcn semantics, and loading, empty, error, success, and warning states should not rely on color alone.

Use restrained motion that respects reduced-motion preferences. Preserve legibility across dense workbench panes, documentation pages, and public surfaces with clear focus states, sufficient contrast, stable hit targets, and responsive layouts that do not clip text or controls.
