# Results

Results show the recorded scorecard for real evaluated skill versions, eval versions, agents, cases, and samples. Inspect results before you evaluate again, improve, or publish.

See [Runs and jobs](track-runs-jobs.md) for lifecycle state, [Traces, artifacts, and files](track-files.md) for raw evidence, and [Versions and lineage](track-versions.md) for source history.

## Results command

Use `results` to review recorded graded evidence:

```bash
workbench eval results
workbench eval list
workbench eval results --eval eval-v1
workbench eval results --eval all
workbench eval results --versions all --agents all
workbench eval results --json
```

Human output is optimized for scanning Quality, Coverage, Latency, Cost, versions, agents, cases, and samples. Use `--json` in automation.

## What results tell you

Results show current-compatible evaluation evidence rows for the selected eval version. Human tables omit selected rows that have not run; JSON preserves the full selected set. Cases matrix cells are projections over real run and grade jobs, matched by effective input hashes for the selected cases and configurations.

`workbench eval results` defaults to the current eval, including a current draft that has not been run yet. Use `workbench eval list` to list eval identities, `--eval eval-vN` to inspect one historical score meaning, and `--eval all` only when you explicitly want to inspect all eval versions together. Scores from different eval versions are not one leaderboard because their cases, tests, or rubrics may differ.

Use results to check:

- Which package version was evaluated.
- Which eval version defined the cases, tests, and grading standard.
- Which agent and model produced the outcome.
- Which case and sample produced which score and status.
- Whether quality, latency, cost, or errors changed enough to act.

## Next steps

- [Runs and jobs](track-runs-jobs.md) explains `skill show`, `watch`, `cancel`, and `retry`.
- [Traces, artifacts, and files](track-files.md) explains `eval show REF` and `eval show REF:PATH`.
- [Versions and lineage](track-versions.md) explains `skill versions`, `skill diff`, and `skill switch`.

## Browser results

Open the local web view when evidence is easier to inspect visually:

```bash
workbench open
```

The browser UI reads the same inspection data as CLI commands. It can show files, Results, the Cases matrix, Runs, run details, job timelines, and output files. The Eval selector lists eval identities as `Eval vN` and defaults to the current eval. Adding a row in Cases edits only the current eval draft; cell submissions create durable runs, jobs, and trace-backed evidence that can be reused by later eval versions when the effective inputs still match.
