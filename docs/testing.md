# Testing

Use the repository root.

Root workspace commands live in [`../CONTRIBUTING.md`](../CONTRIBUTING.md). The exported Workbench skill lives at [`../skills/workbench/SKILL.md`](../skills/workbench/SKILL.md).

## CLI Validation

The standard product validation surface is:

- `pnpm build`
- `pnpm lint`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm cli-skill-evals:validate`

These commands exercise the open Workbench packages: `workbench-contract`, `workbench-protocol`, `workbench-core`, `workbench-built-in-adapters`, `workbench-ui`, and `workbench`.

Run `pnpm workbench:public-source:validate` from the monorepo root when package, docs, UI, adapter, or skill changes should be proven against the source-backed public repository layout.

Core tests cover split YAML parsing, benchmark fingerprints, execution graph planning, scoped sandbox execution, same-environment attempts, Docker local execution, candidate materialization, runs, lineage, traces, and the public sandbox adapter runner.

Useful manual spot checks:

- `pnpm cli --help`
- `tmpdir=$(mktemp -d); pnpm cli init "$tmpdir" --command smoke-command --json`
- `pnpm cli check --dir "$tmpdir" --json`
- `pnpm cli eval "$tmpdir/candidates/command" --samples 1 --json`
- `pnpm cli eval "$tmpdir/candidates/command" --runs all --samples 1 --json`
- `pnpm cli improve "$tmpdir/candidates/command" --budget 1 --samples 1 --json`
- `pnpm cli runs list --dir "$tmpdir" --json`
- `pnpm cli candidates list --dir "$tmpdir" --json`
- `pnpm cli open --dir "$tmpdir" --no-open --json`
- `pnpm cli push --help`
- `pnpm cli clone --help`
- `pnpm cli pull --help`
- `pnpm cli eval --help`
- `pnpm cli --version`

## External Harbor Engine Smoke

The open Workbench product does not bundle Harbor. To validate Harbor interop, first provide a Harbor engine adapter from a benchmark-contained path, npm package, or git ref. Then create or select a tiny Harbor task directory containing `instruction.md`, `task.toml`, `environment/Dockerfile`, and `tests/test.sh`. This smoke proves the external `harbor` engine adapter bridges Workbench to Harbor while Harbor itself owns source parsing, artifact handoff, verifier sandbox mode, MCP server config, health checks, and result semantics.

```yaml
adapters:
  - npm:@acme/workbench-harbor-engine@1.0.0
engine:
  use: harbor
  with:
    path: harbor-tasks
```

Run:

```bash
pnpm cli check --dir "$tmpdir" --json
pnpm cli eval "$tmpdir/candidates/command" --samples 1 --json
```

The score should come from Harbor's normalized result through the adapter. Harbor-specific reward conventions, artifact copying rules, verifier sandboxing, and health-check semantics stay in Harbor `task.toml` and the Harbor runtime. If no Harbor engine adapter source is declared, this smoke is expected to fail adapter resolution rather than fall back to a hidden built-in.

## Workbench Cloud Remote Checks

The open CLI includes Cloud remote commands, but hosted implementation is owned by `products/workbench-cloud`. With a local Workbench Cloud server running, source and state commands can be checked with:

```bash
WORKBENCH_API_URL=http://127.0.0.1:3000 pnpm cli push --json
WORKBENCH_API_URL=http://127.0.0.1:3000 pnpm cli pull --json
WORKBENCH_API_URL=http://127.0.0.1:3000 pnpm cli eval --hosted --samples 1 --dry-run --json
```

Hosted execution checks should use the Workbench Cloud smoke command:

```bash
AUTH_SECRET=test-secret \
NEXTAUTH_SECRET=test-secret \
WORKBENCH_WORKER_TOKEN=local-worker-token \
WORKBENCH_BUILDER_TOKEN=local-builder-token \
WORKBENCH_RUNTIME_REGISTRY=127.0.0.1:5050 \
pnpm --dir ../workbench-cloud smoke:local
```

That smoke command starts the cloud-owned builder, host supervisor, and sandbox host. The CLI docs intentionally do not describe worker internals or provider implementation details.

## Three-Statement Bench

Use the real benchmark package as a local regression target for version-4 benchmark/candidate source:

```bash
pnpm cli check --dir ../three-statement-bench --json
pnpm cli runs list --dir ../three-statement-bench --json
pnpm cli candidates list --dir ../three-statement-bench --json
pnpm cli open --dir ../three-statement-bench --no-open --json
```

When validating in a browser, open the URL returned by `workbench open`. The candidate-centric flow should move from `/candidates` to a candidate, open an evaluation in place, select a case, and inspect the attempt traces directly under that case. Also verify the benchmark master pane, the one-way details-pane collapse button in the benchmark master pane on object routes, version selector, Manifest and Files tabs, route-backed `/candidates`, `/candidates?view=lineage`, and `/evaluations` index pages, candidate detail Manifest and Files tabs, and breadcrumbs that navigate to the matching index route. Run ids remain operational CLI/API resources, but they are not a browser navigation surface.

## Release

The guarded release path is:

- `pnpm release:check`
- `pnpm release:publish`

`pnpm release:prepare <version>` rewrites the publishable Workbench package manifests. `pnpm release:check` compares the shared package version against public npm. `pnpm release:publish` requires `NPM_TOKEN`, reruns the configured build and test steps, and publishes pending public Workbench packages to `https://registry.npmjs.org/`.
