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

## Live traces

Use `record` to capture live skill turns from supported agent hosts:

```bash
workbench record on
# use a Workbench skill in Codex or Claude Code
workbench traces
workbench show TRACE_ID
workbench trace review TRACE_ID --pass
workbench case promote TRACE_ID --id case-001
```

Live capture is plugin-based. Workbench installs or enables its own Codex and Claude Code trace plugins through official host plugin commands, then host hooks append events to Workbench's local spool under `~/.workbench/traces/spool/`. `traces`, `show`, review, and promotion compact pending spool events before reading trace records. The shipped plugins record explicit leading `$skill` invocations; the generic hook also accepts exact host skill-claim events when a host integration emits them. Unrelated host turns are discarded. Workbench does not scan provider session histories such as `~/.codex/sessions` as a hidden side effect.

Promotion requires a captured, terminal trace with captured input. Unfinished candidates stay inspectable as traces but cannot become cases until capture finishes.

For failed or deferred reviews, record the correction before promotion:

```bash
workbench trace review TRACE_ID --fail --expected "Correct expected outcome."
workbench case promote TRACE_ID --id corrected-case
```

Codex capture requires a plugin-capable Codex CLI and a trusted Workbench hook. Automation that runs Codex with `--ignore-user-config` does not load user-installed trace plugins; use normal Codex config loading, or Codex's hook-trust bypass only in automation that already vets the plugin source.

## Inspection paths

Workbench shows stable inspection paths for evidence files. Runtime paths under `.workbench/**` and raw trace metadata files are hidden.

For generated files, put outputs and diagnostics under `/workspace/output`. Keep file-format checks in cases, tests, grading criteria, scripts, or skill references. See [File formats](file-formats.md) for Office, PDF, and similar artifacts.

## Browser evidence

The browser UI reads the same inspection data as CLI commands. It can show source files, run details, trace evidence, and output files without changing project state.
