# CLI

`workbench` is local-first. Normal commands run, inspect, and serve the local project. Workbench Cloud is a remote layer for cloning, pushing, pulling, hosted execution, stars, and forks.

The project model is small:

- benchmark: `benchmark.yaml`, tasks, environment, and grading
- benchmark fingerprint: the comparability boundary
- candidate: `candidates/<name>/candidate.yaml` plus mounted files at `candidates/<name>/files/`
- optimizer: optional `optimizers/<name>.yaml` improve configuration
- run: chronological evidence for eval or improve work
- remote: Workbench Cloud origin used by `clone`, `fetch`, `pull`, and `push`

## Local Flow

```bash
workbench init --skill invoice-review --agent codex
workbench check
workbench eval candidates/codex --samples 1
workbench improve --budget 1 --samples 1
workbench candidates list
workbench runs list
workbench open
```

`workbench improve` uses the current candidate by default and evaluates it first if needed. Use `--from CANDIDATE_ID` only when improving a specific historical candidate.

`workbench open` starts a local read-only web server. Keep the command running while the page is open.

## Remote Flow

```bash
workbench login
workbench push --tag v1
workbench clone alice/invoice-review
workbench fetch
workbench pull
workbench cloud fork alice/invoice-review invoice-review-fork
workbench cloud star alice/invoice-review
```

`workbench push` creates or updates a hosted benchmark version and writes `.workbench/origin.json`. `workbench fetch` downloads remote source into `.workbench/fetch` without changing project files. `workbench pull` updates managed project files from the origin.

## Hosted Execution

```bash
workbench cloud eval candidates/codex --benchmark alice/invoice-review@v1 --samples 1 --watch
workbench cloud improve candidates/codex --base cand_123 --optimizer optimizers/codex.yaml --budget 1 --samples 1 --watch
workbench cloud open cand_123 --no-open --json
workbench cloud runs show run_123 --json
workbench cloud runs cancel run_123
workbench cloud candidates publish cand_123
```

Hosted watch commands are client-side polling only. Stopping the client does not cancel the hosted run; use `workbench cloud runs cancel RUN_ID`.

## CLI Surface

```bash
workbench init [DIR] --skill NAME --agent ADAPTER [--from PATH] [--example] [--json]
workbench init [DIR] --pipeline NAME --agent ADAPTER [--from PATH] [--example] [--json]
workbench init [DIR] --command NAME [--from PATH] [--example] [--json]
workbench check [SOURCE] [--dir DIR] [--json]
workbench adapters create PATH [--dir DIR] [--json]
workbench adapters list [--dir DIR] [--json]
workbench adapters inspect ID [--dir DIR] [--json]
workbench adapters test ID|SOURCE [--dir DIR] [--request PATH] [--output DIR] [--json]
workbench eval [SOURCE] [--dir DIR] [--candidate ID] [--samples N] [--json]
workbench improve [SOURCE] [--dir DIR] [--from CANDIDATE_ID] [--optimizer OPTIMIZER_YAML] [--budget N] [--samples N] [--json]
workbench open [SOURCE] [--dir DIR] [--host HOST] [--port N] [--no-open] [--json]
workbench checkpoint [--dir DIR] [--json]
workbench restore [--dir DIR] [--candidate ID] [--dry-run] [--yes] [--json]
workbench runs list [--dir DIR] [--json]
workbench runs show RUN_ID [--dir DIR] [--json]
workbench candidates list [--dir DIR] [--json]
workbench candidates show CANDIDATE_ID [--dir DIR] [--json]
workbench candidates files [--dir DIR] [--candidate ID] [--json]
workbench candidates preview --path PATH [--dir DIR] [--candidate ID] [--output PATH|-] [--json]
workbench login [--base-url URL] [--no-open] [--json]
workbench logout [--json]
workbench whoami [--dir DIR] [--json]
workbench clone OWNER/BENCHMARK[@REF] [DIR] [--dry-run] [--json]
workbench remote show [--dir DIR] [--json]
workbench remote add origin OWNER/BENCHMARK[@REF] [--dir DIR] [--json]
workbench remote set-url origin OWNER/BENCHMARK[@REF] [--dir DIR] [--json]
workbench remote remove origin [--dir DIR] [--json]
workbench fetch [--dir DIR] [--json]
workbench pull [--dir DIR] [--dry-run] [--json]
workbench push [SOURCE] [--dir DIR] [--tag TAG] [--visibility public|private] [--dry-run] [--json]
workbench cloud fork OWNER/BENCHMARK[@REF] [NAME] [--json]
workbench cloud star OWNER/BENCHMARK [--json]
workbench cloud unstar OWNER/BENCHMARK [--json]
workbench cloud eval [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--base CANDIDATE_ID] [--samples N] [--watch] [--dry-run] [--json]
workbench cloud improve [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--base CANDIDATE_ID] [--optimizer OPTIMIZER_YAML] [--budget N] [--samples N] [--watch] [--dry-run] [--json]
workbench cloud open [OWNER/BENCHMARK[@REF]|RUN_ID|CANDIDATE_ID] [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--no-open] [--json]
workbench cloud watch RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--interval-ms N] [--timeout-ms N] [--json]
workbench cloud logs RUN_ID [--dir DIR] [--benchmark OWNER/BENCHMARK[@REF]] [--json]
workbench cloud benchmarks|runs|candidates <command> [options]
workbench auth connect ADAPTER[/SLOT] [--dir DIR] [--method METHOD] [--profile PROFILE] [--profile-root DIR] [--local-only] [--json]
workbench auth disconnect ADAPTER[/SLOT] [--profile PROFILE] [--local-only] [--json]
```

## Source Shape

```text
benchmark.yaml
candidates/
  codex/
    candidate.yaml
    files/
      SKILL.md
optimizers/
  codex.yaml
tasks/
environment/
  Dockerfile
```

candidate.yaml does not declare a benchmark or path. The project benchmark is `benchmark.yaml`, and the candidate files are the sibling `files/` directory.

Adapter sources can be benchmark-contained paths, `npm:` package specifiers, or `git:` refs. Unversioned npm and branch-like git refs float; exact npm versions and git commits are pinned by the adapter resolver. A declared source whose manifest id matches a built-in id overrides that built-in for the project. Use `workbench adapters test` to validate a manifest, or add `--request` to replay an adapter command locally against a `workbench.adapter.v1` fixture.
