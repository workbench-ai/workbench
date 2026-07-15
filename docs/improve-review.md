# Review candidate changes

After `workbench skill improve` creates a candidate, review the source diff, proof evidence, and version lineage.

See [Improve from evidence](improve.md) for the improvement command and [Rerun proof evals](improve-rerun.md) for another proof attempt.

## Inspect history

Show the candidate, its base version, and proof evidence:

```bash
workbench skill versions
workbench skill diff <base-version-id>..<candidate-version-id>
workbench eval show RUN_ID
workbench eval show JOB_ID
```

`workbench skill versions` lists recorded package versions. `workbench skill diff` compares package files. `workbench eval show` reads run, job, trace, artifact, and file evidence.

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
workbench eval show RUN_ID
workbench eval show JOB_ID
workbench eval results
```

If proof evidence is too narrow, run a higher-sample eval or expand cases before publishing.
