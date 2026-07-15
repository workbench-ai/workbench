# Runs and jobs

Runs and jobs show lifecycle state for active, detached, completed, failed, canceled, and retried work.

See [Results](track.md) for scorecards and [Traces, artifacts, and files](track-files.md) for evidence content.

## Run lifecycle

Use lifecycle commands with recorded run ids:

```bash
workbench skill show
workbench watch RUN_ID
workbench cancel RUN_ID
workbench retry RUN_ID
```

`workbench skill show` shows the next useful command. `watch` follows an active or detached run. `cancel` requests cancellation without deleting evidence. `retry` creates a new whole-run attempt from the selected run's stored plan.

## Jobs

Runs contain jobs for step-specific work such as run, grade, improve, environment setup, and hosted operations. Use `eval show` to inspect a run or job:

```bash
workbench eval show RUN_ID
workbench eval show JOB_ID
```

Run pages show the measured skill, agent results, case results, jobs, status, duration, errors, and evidence counts.

## Hosted runs

Hosted runs use the same run ids after Cloud accepts the operation:

```bash
workbench eval run --cloud
workbench eval grade --cloud
workbench watch RUN_ID
```

Before Cloud accepts a run, progress appears as preparation. After acceptance, `watch`, `cancel`, and `retry` operate on the recorded run id.
