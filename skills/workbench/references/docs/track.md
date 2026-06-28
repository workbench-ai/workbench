# Results

Results show the recorded scorecard for real evaluated skill versions, eval versions, agents, cases, and samples. Inspect results before you evaluate again, improve, or publish.

See [Runs and jobs](track-runs-jobs.md) for lifecycle state, [Traces, artifacts, and files](track-files.md) for raw evidence, and [Versions and lineage](track-versions.md) for source history.

## Results command

Use `results` to review recorded graded evidence:

```bash
workbench results
workbench evals
workbench results --eval eval-v1
workbench results --eval all
workbench results --versions all --agents all
workbench results --json
```

Human output is optimized for scanning Quality, Coverage, Latency, Cost, versions, agents, cases, and samples. Use `--json` in automation.

## What results tell you

Results show recorded evaluation evidence rows for the selected eval version. Human tables omit selected rows that have not run; JSON preserves the full selected set. Cases matrix runs are real run evidence because Cases operates on authored cases and configurations.

`workbench results` defaults to the current eval version. Use `workbench evals` to list stored eval versions, `--eval eval-vN` to inspect one historical score meaning, and `--eval all` only when you explicitly want to inspect all eval versions together. Scores from different eval versions are not one leaderboard because their cases, tests, or rubrics may differ.

Use results to check:

- Which package version was evaluated.
- Which eval version defined the cases, tests, and grading standard.
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

The browser UI reads the same inspection data as CLI commands. It can show files, Results, the Cases matrix, Runs, run details, job timelines, and output files. The Evaluation selector lists stored eval versions as `Eval vN` and defaults to the current eval version. Adding a row in Cases edits the current eval draft; cell submissions create durable runs, jobs, and trace-backed evidence for the selected case.
