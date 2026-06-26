# Traces, artifacts, and files

Trace records, captured files, stdout, stderr, generated outputs, and file evidence show the raw evidence behind a result.

Use [Results](track.md) to identify the row that matters. Use [Runs and jobs](track-runs-jobs.md) to find run and job ids.

## Show evidence

Use `show` to inspect source, run, job, trace, artifact, and file evidence:

```bash
workbench show RUN_ID
workbench show JOB_ID
workbench show RUN_ID:cases/investor-focus/output/result.json
```

If a suffix is ambiguous, Workbench prints exact `workbench show REF:PATH` commands.

## Inspection paths

Workbench shows stable inspection paths for evidence files. Runtime paths under `.workbench/**` and raw trace metadata files are hidden.

For generated files, put outputs and diagnostics under `/workspace/output`. Keep file-format checks in cases, tests, rubrics, scripts, or skill references. See [File formats](file-formats.md) for Office, PDF, and similar artifacts.

## Browser evidence

The browser UI reads the same inspection data as CLI commands. It can show source files, run details, trace evidence, and output files without changing project state.
