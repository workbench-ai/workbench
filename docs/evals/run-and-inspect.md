# Run And Inspect

Use this loop after writing `benchmark.yaml`, at least one subject directory such as `subjects/claude/`, optional optimizer YAML such as `optimizers/claude.yaml`, subject files, and tasks.

## Check And Push

```bash
workbench check
workbench push
```

If the hosted benchmark already exists, run from the directory containing `.workbench/origin.json` or pass `--benchmark OWNER/BENCHMARK[@REF]` to `workbench cloud` eval, runs, and hosted inspection commands. Internal `wb_...` ids are accepted for owner-only commands when needed. Fix validation errors before running. If the runtime is custom, keep `benchmark.environment.dockerfile` pointed at the local Dockerfile; `workbench push` builds or reuses the benchmark environment version from that Dockerfile.

Additional note for agents: if a hosted command returns `urls` and an embedded browser is available, navigate the browser to the returned benchmark URL. For custom Dockerfile runtimes, verify the hosted environment is ready before starting a run.

## Start Smoke Workflows

Run one sample first:

```bash
workbench eval subjects/claude --samples 1 --json
workbench improve subjects/claude --optimizer optimizers/claude.yaml --budget 1 --samples 1 --json
workbench open --json --no-open
```

Use `--from <subject-id>` only when improving a specific historical local subject. If the parent subject has not already been evaluated for the current benchmark fingerprint, Workbench evaluates it first, then records the improve and trial events chronologically.

`--samples` counts repeat attempts over the selected task set. If a benchmark has ten tasks and you run `--samples 1`, Workbench should report one completed sample for the subject while the task table shows one case result per task.

Cost metrics are sample-based in evaluation results. Result cost is trial cost per evaluation sample. Subject totals also include improve execution cost. If a provider reports cost directly, Workbench uses that value; otherwise it estimates from the checked-in LiteLLM model price snapshot when the adapter reports enough token detail.

For hosted validation, use `workbench cloud eval ... --watch --json` and `workbench cloud improve ... --watch --json`. Use the returned id fields, `runId`, and `urls` from watched JSON output. Open the evaluation URL for score, subject files, and task evidence; open `urls.run` or `workbench cloud open <run-id> --json --no-open` when validating traces. If a run is still pending and no subject id exists yet, use `workbench cloud runs show <run-id> --json` for operational status and `workbench cloud open --json --no-open` for the benchmark route.

If the sample errors, inspect the improve phase, subject runner, scorer, runtime environment, and output-writing logic. Most first-pass errors are one of:

- the workflow path assumes a different working directory
- the configured scorer does not publish `/workspace/output/workbench-result.json`
- the scorer writes no valid `/logs/verifier/reward.json` or `/logs/verifier/reward.txt`
- the result is missing finite numeric `score`
- the Dockerfile runtime is missing a parser or renderer for the produced files

## Inspect The Subject

```bash
workbench subjects list --json
workbench subjects files --subject <subject> --json
workbench subjects preview --subject <subject> --path SKILL.md --output -
workbench open --json --no-open
```

Use the first run to verify that verifier files, durable artifacts, traces, and subject file changes are all understandable before increasing budget or samples.
