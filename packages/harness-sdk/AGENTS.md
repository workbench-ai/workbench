# Harness SDK

- Owns the shared in-process harness provider contract, conformance helpers, trace helpers, and managed-runtime utilities.
- Start with `../../docs/extensions.md`, `../../docs/runtime.md`, `src/index.ts`, and `src/conformance.ts`.
- Keep provider-specific behavior out of this package; this package should only define reusable contracts and test helpers.
- Changes here should simplify first-party harness tests instead of adding new per-provider duplication.
- Validate with `pnpm --dir ../.. build -- @workbench-ai/harness-sdk` and `pnpm --dir ../.. test:focus -- @workbench-ai/runtime tests/harness-conformance.test.ts`.
