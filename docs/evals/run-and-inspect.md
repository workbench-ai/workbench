# Run And Inspect

Use this loop after writing `benchmark.yaml`, at least one subject directory such as `subjects/codex/`, optional optimizer YAML such as `optimizers/codex.yaml`, subject files, and case source such as native Workbench tasks.

## Local Development

```bash
workbench check
workbench eval subjects/codex --samples 1 --json
workbench improve subjects/codex --optimizer optimizers/codex.yaml --budget 1 --samples 1 --json
workbench open --json --no-open
```

Fix validation errors before running. Run one sample first; use `--from <subject-id>` only when improving a specific historical local subject. If the parent subject has not already been evaluated for the current benchmark fingerprint, Workbench evaluates it first, then records the improve and engine attempt events chronologically.

## Cloud Deployment

```bash
workbench login
workbench whoami --json
workbench push --tag v1
workbench cloud eval subjects/codex --samples 1 --watch --json
workbench cloud improve subjects/codex --base SUBJECT_ID --optimizer optimizers/codex.yaml --budget 1 --samples 1 --watch --json
workbench cloud open --json --no-open
```

If the hosted benchmark already exists, run from the directory containing `.workbench/origin.json` or pass `--benchmark OWNER/BENCHMARK[@REF]` to `workbench cloud` eval, runs, and hosted inspection commands. Internal `wb_...` ids are accepted for owner-only commands when needed. If the runtime is custom, keep `engine.with.environment.dockerfile` pointed at the local Dockerfile; `workbench push` builds or reuses the benchmark environment version from that Dockerfile.

Additional note for agents: if a hosted command returns `urls` and an embedded browser is available, navigate the browser to the returned benchmark URL. For custom Dockerfile runtimes, verify the hosted environment is ready before starting a run.

`--samples` counts repeat attempts over the selected case set. If a benchmark has ten cases and you run `--samples 1`, Workbench should report one completed sample for the subject while the case table shows one scored case per case id.

Cost metrics are sample-based in evaluations. Evaluation cost is engine attempt cost per sample. Subject totals also include improve execution cost. If a provider reports cost directly, Workbench uses that value; otherwise it estimates from the checked-in LiteLLM model price snapshot when the adapter reports enough token detail.

For hosted validation, use `workbench cloud eval ... --watch --json` first. Use the returned subject id as `--base` for a hosted improve run when you want to test the improvement loop. Use the returned id fields, `runId`, and `urls` from watched JSON output. Open the evaluation URL for scorecard detail, subject files, case evidence, attempts, traces, and files. If a run is still pending and no subject id exists yet, use `workbench cloud runs show <run-id> --json` for operational status and `workbench cloud open --json --no-open` for the benchmark route.

If the sample errors, inspect the optimizer execution, subject runner, scoring helper, runtime environment, and output-writing logic. Most first-pass errors are one of:

- the workflow path assumes a different working directory
- the configured scoring helper does not publish `/workspace/output/workbench-result.json`
- the `tests` scoring helper writes no valid reward file under `$WORKBENCH_TESTS_VERIFIER_DIR`
- an adapter hard-codes `/tests`, invented log roots, or source paths instead of reading `paths` from `WORKBENCH_ADAPTER_REQUEST`
- the evaluation is missing a finite numeric `score`
- the Dockerfile runtime is missing a parser or renderer for the produced files

## Inspect The Subject

```bash
workbench subjects list --json
workbench subjects files --subject <subject> --json
workbench subjects preview --subject <subject> --path SKILL.md --output -
workbench open --json --no-open
```

Use the first run to verify that verifier files, durable artifacts, traces, and subject file changes are all understandable before increasing budget or samples.
