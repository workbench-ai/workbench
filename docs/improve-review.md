# Review candidate changes

After `workbench improve` creates a candidate, review the source diff, proof evidence, and version lineage.

See [Improve from evidence](improve.md) for the improvement command and [Rerun proof evals](improve-rerun.md) for another proof attempt.

## Inspect history

Show the candidate, its base version, and proof evidence:

```bash
workbench log
workbench versions
workbench diff <base-version-id>..<candidate-version-id>
workbench show RUN_ID
workbench show JOB_ID
```

`log` shows recent versions and runs. `versions` lists recorded package versions. `diff` compares package files. `show` reads run, job, trace, artifact, and file evidence.

## Review the diff

Improvement changes package source, not eval source. Files under `.workbench/**` are the grading standard; changes there are eval changes, not skill improvements.

Look for:

- Changes that address the failing evidence directly.
- New instructions, references, scripts, or assets that remain self-contained in the skill package.
- Removal of brittle or unrelated source changes.
- No accidental edits to `.workbench/**` unless you changed the eval on purpose.

## Review proof evidence

Proof evidence needs to show the candidate beating the current version on the selected evidence. Inspect the run and job details before publishing:

```bash
workbench show RUN_ID
workbench show JOB_ID
workbench results
```

If proof evidence is too narrow, run a higher-sample eval or expand cases before publishing.
