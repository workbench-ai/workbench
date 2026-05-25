# Agent Driver Core

- Owns the neutral in-process agent driver contract, conformance helpers, trace helpers, and managed-runtime utilities.
- Start with `../../README.md`, `src/index.ts`, and `src/conformance.ts`.
- Keep provider-specific behavior out of this package; this package should only define reusable driver contracts and test helpers.
- Changes here should simplify first-party driver tests instead of adding new per-provider duplication.
- Validate with `pnpm --dir ../.. build`.
