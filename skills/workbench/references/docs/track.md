# Results

Results show the recorded scorecard for real evaluated versions, agents, cases, and samples. Inspect results before you evaluate again, improve, or publish.

See [Runs and jobs](track-runs-jobs.md) for lifecycle state, [Traces, artifacts, and files](track-files.md) for raw evidence, and [Versions and lineage](track-versions.md) for source history.

## Results command

Use `results` to review recorded graded evidence:

```bash
workbench results
workbench results --versions all --agents all
workbench results --json
```

Human output is optimized for scanning Quality, Coverage, Latency, Cost, versions, agents, cases, and samples. Use `--json` in automation.

## What results tell you

Results show recorded evaluation evidence rows. Human tables omit selected rows that have not run; JSON preserves the full selected set. Cases matrix runs are real run evidence because Cases operates on authored cases and configurations.

Use results to check:

- Which package version was evaluated.
- Which agent and model produced the outcome.
- Which case and sample produced which score and status.
- Whether quality, latency, cost, or errors changed enough to act.

## Next steps

- [Runs and jobs](track-runs-jobs.md) explains `status`, `watch`, `cancel`, and `retry`.
- [Traces, artifacts, and files](track-files.md) explains `show REF` and `show REF:PATH`.
- [Versions and lineage](track-versions.md) explains `log`, `versions`, `diff`, and `switch`.

## Browser results

Open the local web view when evidence is easier to inspect visually:

```bash
workbench open
```

The browser UI reads the same inspection data as CLI commands. It can show files, Results, the Cases matrix, Runs, run details, job timelines, and output files. Adding a row in Cases creates an authored case, and cell submissions create durable runs, jobs, and trace-backed evidence for that case.
