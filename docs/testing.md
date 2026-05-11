# Testing

Use the repository root.

Root workspace commands live in [`../CONTRIBUTING.md`](../CONTRIBUTING.md). The exported Workbench skill lives at [`../skills/workbench/SKILL.md`](../skills/workbench/SKILL.md).

## CLI Validation

The standard product validation surface is:

- `pnpm build`
- `pnpm lint`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm skills:sync`
- `pnpm cli-skill-evals:validate`

These commands exercise the open Workbench packages: `workbench-contract`, `workbench-protocol`, `workbench-core`, `workbench-built-in-adapters`, `workbench-ui`, and `workbench`.

Core tests cover split YAML parsing, benchmark fingerprints, execution graph planning, scoped sandbox capabilities, phase-specific file staging, Docker local execution, candidate materialization, runs, lineage, traces, and the public sandbox adapter runner.

Useful manual spot checks:

- `pnpm cli --help`
- `tmpdir=$(mktemp -d); pnpm cli init "$tmpdir" --command smoke-command --json`
- `pnpm cli check --dir "$tmpdir" --json`
- `pnpm cli eval "$tmpdir/candidates/command" --samples 1 --json`
- `pnpm cli improve "$tmpdir/candidates/command" --optimizer "$tmpdir/optimizers/command.yaml" --budget 1 --samples 1 --json`
- `pnpm cli runs list --dir "$tmpdir" --json`
- `pnpm cli candidates list --dir "$tmpdir" --json`
- `pnpm cli open --dir "$tmpdir" --no-open --json`
- `pnpm cli push --help`
- `pnpm cli clone --help`
- `pnpm cli pull --help`
- `pnpm cli cloud eval --help`
- `pnpm cli --version`

## Workbench Cloud Client Checks

The open CLI includes Cloud client commands, but hosted implementation is owned by `products/workbench-cloud`. With a local Workbench Cloud server running, source and state commands can be checked with:

```bash
WORKBENCH_API_URL=http://127.0.0.1:3000 pnpm cli push --json
WORKBENCH_API_URL=http://127.0.0.1:3000 pnpm cli fetch --json
WORKBENCH_API_URL=http://127.0.0.1:3000 pnpm cli pull --json
```

Hosted execution checks should use the Workbench Cloud smoke harness:

```bash
AUTH_SECRET=test-secret \
NEXTAUTH_SECRET=test-secret \
WORKBENCH_WORKER_TOKEN=local-worker-token \
WORKBENCH_BUILDER_TOKEN=local-builder-token \
WORKBENCH_RUNTIME_REGISTRY=127.0.0.1:5050 \
pnpm --dir ../workbench-cloud smoke:local
```

That harness starts the cloud-owned builder, host supervisor, and sandbox host. The CLI docs intentionally do not describe worker internals or provider implementation details.

## Three-Statement Bench

Use the real benchmark package as a local regression target:

```bash
pnpm cli check --dir ../three-statement-bench --json
pnpm cli runs list --dir ../three-statement-bench --json
pnpm cli candidates list --dir ../three-statement-bench --json
pnpm cli open --dir ../three-statement-bench --no-open --json
```

When validating in a browser, open the URL returned by `workbench open`, verify the benchmark master pane, version selector, Manifest and Files tabs, candidate list, candidate detail Manifest and Files tabs, Runs, Results, and Lineage.

## Release

The guarded release path is:

- `pnpm publish:check-versions`
- `pnpm publish:build`
- `pnpm publish:test`
- `pnpm publish:local`

`pnpm publish:prepare <version>` rewrites the publishable Workbench package manifests. `pnpm publish:check-versions` compares the shared package version against GitHub Packages and fails when there is nothing new to publish. `pnpm publish:local` resolves GitHub Packages auth, reruns the guarded build and test steps, and publishes pending public Workbench packages with `--no-git-checks`.
