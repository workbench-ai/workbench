# Testing

Run checks from the repository root unless a command includes `--dir`.
Use [../CONTRIBUTING.md](../CONTRIBUTING.md) for repository commands. The exported Workbench skill lives at [../skills/workbench/SKILL.md](../skills/workbench/SKILL.md).

## Builds

```bash
pnpm build
```

Package-level builds are also valid when iterating:

```bash
pnpm --dir packages/core build
pnpm --dir packages/built-in-adapters build
pnpm --dir packages/cli build
```

## Tests

```bash
pnpm test
```

The tests assert the skill-first command surface, local runtime lifecycle, read-only UI helpers, minimal adapter protocol, automatic source versions, and Workbench object remote layout.

## Local E2E

```bash
tmpdir=$(mktemp -d)
workbench init "$tmpdir/earnings-prep"
workbench check --dir "$tmpdir/earnings-prep"
workbench eval --dir "$tmpdir/earnings-prep" --agents default --samples 1 --json
workbench versions --dir "$tmpdir/earnings-prep"
workbench compare --dir "$tmpdir/earnings-prep" --versions all --skills all --agents all
workbench open --dir "$tmpdir/earnings-prep"
workbench open --dir "$tmpdir/earnings-prep" --json
```

The init eval is a smoke check. Run `workbench improve` only after a workflow-specific eval has produced failed or reviewed trace evidence.

## Object Remote E2E

```bash
tmpdir=$(mktemp -d)
workbench init "$tmpdir/earnings-prep"
workbench eval --dir "$tmpdir/earnings-prep" --agents default --samples 1 --json
workbench remote add --name origin --url "file://$tmpdir/remote" --dir "$tmpdir/earnings-prep"
workbench sync origin --dir "$tmpdir/earnings-prep"
find "$tmpdir/remote" -maxdepth 3 -type f | sort
```

The remote should contain `workbench.object-pack.v1` objects and refs. File remotes are sync-only; Workbench Cloud remotes are the source publication surface. Workbench must not create or mutate Git refs.
