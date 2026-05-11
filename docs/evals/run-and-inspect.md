# Run And Inspect

Use this loop after writing `benchmark.yaml`, at least one candidate directory such as `candidates/claude/`, optional optimizer YAML such as `optimizers/claude.yaml`, candidate files, and tasks.

## Check And Push

```bash
workbench check
workbench push
```

If the hosted benchmark already exists, run from the directory containing `.workbench/origin.json` or pass `--benchmark OWNER/BENCHMARK[@REF]` to `workbench cloud` eval, runs, and candidate inspection commands. Internal `wb_...` ids are accepted for owner-only commands when needed. Fix validation errors before running. If the runtime is custom, keep `benchmark.environment.dockerfile` pointed at the local Dockerfile; `workbench push` builds or reuses the benchmark environment version from that Dockerfile.

Additional note for agents: if a hosted command returns `urls` and an embedded browser is available, navigate the browser to the returned benchmark URL. For custom Dockerfile runtimes, verify the hosted environment is ready before starting a run.

## Start Smoke Workflows

Run one sample first:

```bash
workbench eval candidates/claude --samples 1 --json
workbench improve candidates/claude --optimizer optimizers/claude.yaml --budget 1 --samples 1 --json
workbench open --json --no-open
```

Use `--from <candidate-id>` only when improving a specific historical local candidate. If the parent candidate has not already been evaluated for the current benchmark fingerprint, Workbench evaluates it first, then records the improve, run-task, and grade-task events chronologically.

`--samples` counts repeat attempts over the selected task set. If a benchmark has ten tasks and you run `--samples 1`, Workbench should report one completed sample for the candidate while the task table shows one case result per task.

Cost metrics are sample-based in evaluation results. Result cost is run plus grade execution cost for each evaluation sample. Candidate totals also include improve execution cost. If a provider reports cost directly, Workbench uses that value; otherwise it estimates from the checked-in LiteLLM model price snapshot when the adapter reports enough token detail.

For hosted validation, use `workbench cloud eval ... --watch --json` and `workbench cloud improve ... --watch --json`. Use the `candidateId`, `runId`, and `urls` from watched JSON output. Open `urls.candidateEvaluation` for score, candidate files, and task evidence; open `urls.run` or `workbench cloud open <run-id> --json --no-open` when validating runner and grader traces. If a run is still pending and no candidate id exists yet, use `workbench cloud runs show <run-id> --json` for operational status and `workbench cloud open --json --no-open` for the benchmark route.

If the sample errors, inspect the improve, runner, grader, runtime environment, and output-writing logic. Most first-pass errors are one of:

- the command path assumes a different working directory
- the configured command grader writes score JSON somewhere other than `/workspace/output/scorecard.json`
- the result is missing finite numeric `score`
- the Dockerfile runtime is missing a parser or renderer for the produced files
- the runner writes no non-internal files under `/workspace/output`

## Inspect The Candidate

```bash
workbench candidates list --json
workbench candidates files --candidate <candidate> --json
workbench candidates preview --candidate <candidate> --path SKILL.md --output -
workbench open --json --no-open
```

Use the first run to verify that task expected files, durable runner files, traces, and candidate file changes are all understandable before increasing budget or samples.
