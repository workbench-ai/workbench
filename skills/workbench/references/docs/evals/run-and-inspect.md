# Run And Inspect

Use this loop after writing `benchmark.yaml`, at least one candidate directory such as `candidates/codex/`, candidate files, optional candidate-owned improve settings, and case source such as native Workbench tasks.

## Local Development

```bash
workbench check
workbench eval candidates/codex --samples 1 --json
workbench eval candidates/codex --runs all --samples 1 --json
workbench improve candidates/codex --budget 1 --samples 1 --json
workbench retry TARGET_ID --json
workbench open --json --no-open
```

Fix validation errors before running. Run one sample first; use `workbench eval --runs all` when you want to compare every run declared by the candidate. `workbench eval` and `workbench improve` reuse completed work only when the candidate, run configuration, source, adapters, benchmark, and requested samples/budget match; pass `--rerun` only when you intentionally want to spend on another measurement or improvement attempt. `workbench improve` uses one selected run, defaulting to the candidate default; pass `--runs <run-id>` to override that, and use `--from <candidate-id>` only when improving a specific historical local candidate. If the parent candidate has not already been evaluated for the current benchmark fingerprint, Workbench evaluates it first, then records the improve and engine attempt events chronologically.

Use `workbench retry <run-id-or-evaluation-id>` only for failed local history. It leaves the failed record inspectable and reuses completed repair work when the same retry has already succeeded.

Runtime candidates are versioned automatically. A manifest named `Skill` appears as `Skill v1`; successful improvement produces `Skill v2`, then `Skill v3`. Run configurations and samples sit under that candidate version.

Once an active candidate exists, eval records scores without moving that active pointer. Improve JSON uses explicit candidate ids: `outputCandidateId` is the version produced by the improve run, while `activeCandidateId` is the current best evaluated candidate after scoring. These can differ when a newly produced version underperforms the incumbent.

## Cloud Deployment

```bash
workbench login
workbench whoami --json
workbench push --tag v1
workbench cloud eval candidates/codex --samples 1 --watch --json
workbench cloud improve candidates/codex --base CANDIDATE_ID --budget 1 --samples 1 --watch --json
workbench cloud retry TARGET_ID --watch --json
workbench cloud open --json --no-open
```

If the hosted benchmark already exists, run from the directory containing `.workbench/origin.json` or pass `--benchmark OWNER/BENCHMARK[@REF]` to `workbench cloud` eval, runs, and hosted inspection commands. Internal `wb_...` ids are accepted for owner-only commands when needed. If the runtime is custom, keep `engine.with.environment.dockerfile` pointed at the local Dockerfile; `workbench push` builds or reuses the benchmark environment version from that Dockerfile.

Additional note for agents: if a hosted command returns `urls` and an embedded browser is available, navigate the browser to the returned benchmark URL. For custom Dockerfile runtimes, verify the hosted environment is ready before starting a run.

`--samples` counts repeat attempts over the selected case set. If a benchmark has ten cases and you run `--samples 1`, Workbench should report one completed sample for the candidate while the case table shows one scored case per case id. Samples do not create candidates; they aggregate evidence for the same candidate version and run configuration.

Cost metrics are sample-based in evaluations. Evaluation cost is engine attempt cost per sample. Candidate totals also include improve execution cost. If a provider reports cost directly, Workbench uses that value; otherwise it estimates from the checked-in LiteLLM model price snapshot when the adapter reports enough token detail.

For hosted validation, use `workbench cloud eval ... --watch --json` first. Use the returned candidate id as `--base` for a hosted improve run when you want to test the improvement loop. Use `workbench cloud retry <run-id-or-evaluation-id> --watch --json` for failed hosted history. Use the returned id fields, `runId`, and `urls` from watched JSON output. Open the evaluation URL for scorecard detail, candidate files, case evidence, attempts, traces, and files. If a run is still pending and no candidate id exists yet, use `workbench cloud runs show <run-id> --json` for operational status and `workbench cloud open --json --no-open` for the benchmark route.

If the sample errors, inspect the improve execution, candidate runner, scoring helper, runtime environment, and output-writing logic. Most first-pass errors are one of:

- the workflow path assumes a different working directory
- the configured scoring helper does not publish `/workspace/output/workbench-result.json`
- the `tests` scoring helper writes no valid reward file under `$WORKBENCH_TESTS_VERIFIER_DIR`
- an adapter hard-codes `/tests`, invented log roots, or source paths instead of reading `paths` from `WORKBENCH_ADAPTER_REQUEST`
- the evaluation is missing a finite numeric `score`
- the Dockerfile runtime is missing a parser or renderer for the produced files

## Inspect The Candidate

```bash
workbench candidates list --json
workbench candidates files --candidate <candidate> --json
workbench candidates preview --candidate <candidate> --path SKILL.md --output -
workbench open --json --no-open
```

Use the first run to verify that verifier files, durable artifacts, traces, and candidate file changes are all understandable before increasing budget or samples. The web view is read-only inspection; execution, retry, cancellation, and sync remain CLI actions.
