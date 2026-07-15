# Traces, artifacts, and files

Trace records, captured files, stdout, stderr, generated outputs, and file evidence show the raw evidence behind a result.

Use [Results](track.md) to identify the row that matters. Use [Runs and jobs](track-runs-jobs.md) to find run and job ids.

## Show evidence

Use `workbench eval show` to inspect Eval, run, job, trace, artifact, and file evidence:

```bash
workbench eval show RUN_ID
workbench eval show JOB_ID
workbench eval show eval-v2
workbench eval show eval-v2:cases/investor-focus/case.yaml
workbench eval show RUN_ID:cases/investor-focus/output/result.json
```

If a suffix is ambiguous, Workbench prints exact `workbench eval show REF:PATH` commands.
Use `eval-vN` refs to inspect the exact historical eval definition that produced a result.

## Source evidence is separate

Sources hold evidence ingested from local agent sessions or other adapters. They are deployment-owned corpora, not project execution traces, and do not enter a Skill object pack automatically. The Sources workspace renders exact generic citation blocks from immutable snapshots; Eval execution evidence on this page continues to describe only runs and jobs.

## Inspection paths

Workbench shows stable inspection paths for evidence files. Runtime paths under `.workbench/**` and raw trace metadata files are hidden.

For generated files, put outputs and diagnostics under `/workspace/output`. Keep file-format checks in cases, tests, grading criteria, scripts, or skill references. See [File formats](file-formats.md) for Office, PDF, and similar artifacts.

## Browser evidence

The browser UI reads the same inspection data as CLI commands. It can show source files, run details, job timelines, and output files without changing project state.
