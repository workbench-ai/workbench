# Improve from evidence

Use eval evidence to improve a skill. Workbench edits package source, proves the candidate with eval evidence, and records lineage for review.

See [Evaluation basics](evals.md) for eval setup, [Results](track.md) for evidence inspection, [Review candidate changes](improve-review.md) for candidate review, and [Rerun proof evals](improve-rerun.md) for another proof attempt.

## When to improve

Improve after below-perfect, failed, or reviewed graded evidence:

```bash
workbench results
workbench show RUN_ID
workbench improve --dry-run
workbench improve
workbench results
```

Perfect-only projects need better cases, stricter rubrics, or higher samples before improvement is useful. Add or tighten eval cases instead of asking for cosmetic source changes.

## Candidate and proof

`workbench improve` needs one package version and one agent. Use `--versions` and `--agents` when defaults would select more than one entry.

```bash
workbench improve --versions current --agents default
workbench improve --budget 2
workbench improve --cloud
```

The improver edits package source outside `.workbench/**`, runs proof evidence, and switches only when the proof succeeds and beats the current version. Improvement changes the skill package, not the grading standard.

## Next steps

- [Review candidate changes](improve-review.md) explains `log`, `versions`, `diff`, and evidence inspection for a candidate.
- [Rerun proof evals](improve-rerun.md) explains `--rerun`, `retry`, and higher-sample proof runs.
- [Publish](share.md) explains source publication after a candidate is ready.
