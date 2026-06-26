# Results

Results show the recorded scorecard for evaluated versions, agents, cases, and samples. Inspect results before you evaluate again, improve, or publish.

See [Runs and jobs](track-runs-jobs.md) for lifecycle state, [Traces, artifacts, and files](track-files.md) for raw evidence, and [Versions and lineage](track-versions.md) for source history.

## Results command

Use `results` to review recorded graded evidence:

```bash
workbench results
workbench results --versions all --agents all
workbench results --json
```

Human output is optimized for scanning scores, latency, cost, versions, agents, cases, and samples. Use `--json` in automation.

## What results tell you

Results show recorded evidence rows. Human tables omit selected rows that have not run; JSON preserves the full selected set.

Use results to check:

- Which package version was evaluated.
- Which agent and model produced the outcome.
- Which case and sample passed or failed.
- Whether score, latency, cost, or errors changed enough to act.

## Next steps

- [Runs and jobs](track-runs-jobs.md) explains `status`, `watch`, `cancel`, and `retry`.
- [Traces, artifacts, and files](track-files.md) explains `show REF` and `show REF:PATH`.
- [Versions and lineage](track-versions.md) explains `log`, `versions`, `diff`, and `switch`.

## Browser results

Open the local web view when evidence is easier to inspect visually:

```bash
workbench open
```

The browser UI reads the same inspection data as CLI commands. It can show source, files, evaluation results, run details, trace evidence, and output files without changing project state.
