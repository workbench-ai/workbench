# Rerun proof evals

Rerun proof evidence when a phase needs fresh output or an existing run needs a new attempt from its stored plan.

Use [Review candidate changes](improve-review.md) to decide whether a candidate is worth rerunning.

## Rerun fresh evidence

Use `--rerun` to force fresh evidence for the selected phase:

```bash
workbench run --rerun
workbench grade --rerun
workbench eval --rerun
```

`--rerun` bypasses reusable evidence for the selected phase. Use it when you need a result that does not depend on stale or noisy evidence.

## Retry a stored plan

Use `retry RUN_ID` to start a new attempt with the same selected version, agent, cases, and samples:

```bash
workbench retry RUN_ID
workbench watch RUN_ID
```

Retry starts a new run from the stored plan. It does not patch only failed jobs.

## Higher-sample proof

When a one-sample proof switches source, run a higher-sample eval before publishing:

```bash
workbench eval -n 5
workbench results
```

Use a sample count that matches the workflow risk. Skills that produce files, financial models, legal text, or other high-review artifacts need stronger proof than a one-shot smoke check.
