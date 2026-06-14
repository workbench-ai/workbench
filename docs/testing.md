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

## Release Contract

```bash
pnpm release:publish
```

`release:publish` is the Workbench release acceptance command. It runs the product build/test release checks, publishes or resumes the configured public npm packages, verifies the exact registry `@workbench-ai/workbench` artifact from npm in `/tmp` with a clean HOME, then refreshes the installed authored Workbench skill and verifies its JTBD reference matches `docs/jtbd.md`. Passing source tests or `release:check` is not release acceptance by itself.

`release:contract [version]` remains available for a manual registry-artifact audit. It checks the requested version against the current local release version, compares the npm package trees against the current built packages, installs the exact published CLI package into `/tmp`, verifies the installed `workbench` binary, and runs the JTBD command-flow audit.

## Local E2E

```bash
tmpdir=$(mktemp -d)
workbench new "$tmpdir/earnings-prep" --agent local
mkdir -p "$tmpdir/earnings-prep/.workbench/cases/case-001/tests"
cat > "$tmpdir/earnings-prep/.workbench/cases/case-001/case.yaml" <<'EOF'
version: 1
id: case-001
command: sh "$CASE_DIR/tests/test.sh"
EOF
cat > "$tmpdir/earnings-prep/.workbench/cases/case-001/tests/test.sh" <<'EOF'
#!/bin/sh
set -eu
mkdir -p "$OUTPUT_DIR"
printf '{"ok":true,"score":1}\n' > "$OUTPUT_DIR/result.json"
EOF
chmod +x "$tmpdir/earnings-prep/.workbench/cases/case-001/tests/test.sh"
workbench eval --dir "$tmpdir/earnings-prep" --agents default -n 1 --json
workbench log --dir "$tmpdir/earnings-prep" --versions
workbench compare --dir "$tmpdir/earnings-prep" --versions all --skills all --agents all
workbench open --dir "$tmpdir/earnings-prep"
workbench show --dir "$tmpdir/earnings-prep" current:SKILL.md
```

`workbench new` creates no starter cases. The local e2e above writes one deterministic case explicitly; run `workbench improve` only after a workflow-specific eval has produced scored below-perfect, failed, or reviewed eval evidence.

## Object Remote E2E

```bash
tmpdir=$(mktemp -d)
workbench new "$tmpdir/earnings-prep" --agent local
mkdir -p "$tmpdir/earnings-prep/.workbench/cases/case-001/tests"
cat > "$tmpdir/earnings-prep/.workbench/cases/case-001/case.yaml" <<'EOF'
version: 1
id: case-001
command: sh "$CASE_DIR/tests/test.sh"
EOF
cat > "$tmpdir/earnings-prep/.workbench/cases/case-001/tests/test.sh" <<'EOF'
#!/bin/sh
set -eu
mkdir -p "$OUTPUT_DIR"
printf '{"ok":true,"score":1}\n' > "$OUTPUT_DIR/result.json"
EOF
chmod +x "$tmpdir/earnings-prep/.workbench/cases/case-001/tests/test.sh"
workbench eval --dir "$tmpdir/earnings-prep" --agents default -n 1 --json
mkdir -p "$tmpdir/earnings-prep/.workbench"
cat > "$tmpdir/earnings-prep/.workbench/remotes.yaml" <<EOF
schema: workbench.remotes.v1
remotes:
  origin:
    url: file://$tmpdir/remote
    kind: file
EOF
workbench sync origin --dir "$tmpdir/earnings-prep"
find "$tmpdir/remote" -maxdepth 3 -type f | sort
```

The remote should contain `workbench.object-pack.v1` objects and refs. File remotes are sync-only; Workbench Cloud remotes are the source publication surface. Workbench must not create or mutate Git refs.
