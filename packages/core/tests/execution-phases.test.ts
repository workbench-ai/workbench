import { describe, expect, test } from "vitest";

import {
  buildSubjectCasePhaseRefs,
  buildWorkbenchTracePhases,
  finalizeWorkbenchExecutionTraceForJob,
  type HostedWorkbenchJob,
  type WorkbenchExecutionTrace,
} from "../src/index.ts";

describe("workbench execution phases", () => {
  test("groups trial jobs into one phase and selects the latest run", () => {
    const jobs = [
      executionJob({ id: "old_trial", runId: "run_old", minute: 0 }),
      executionJob({ id: "new_trial", runId: "run_new", minute: 2 }),
    ];

    expect(buildSubjectCasePhaseRefs({
      jobs,
      subjectId: "subject_123",
      caseId: "astera-labs",
      sampleIndex: 0,
    })).toMatchObject([
      {
        runId: "run_new",
        phase: "trial",
        role: "runner",
        jobIds: ["new_trial"],
        sampleIndex: 0,
      },
    ]);
  });

  test("merges trace jobs behind the trial phase", () => {
    const jobs = [
      executionJob({ id: "trial_job_1", minute: 1 }),
      executionJob({ id: "trial_job_2", minute: 2 }),
    ];

    const phases = buildWorkbenchTracePhases({
      jobs,
      traceIdPrefix: "test-phase",
      traceForJob: (job, role) => traceForJob(job.id, role),
    });

    expect(phases.map((phase) => phase.phase)).toEqual(["trial"]);
    expect(phases.map((phase) => phase.role)).toEqual(["runner"]);
    expect(phases[0]?.jobIds).toEqual(["trial_job_1", "trial_job_2"]);
    expect(phases[0]?.trace.spans.map((span) => span.attributes.job_id)).toEqual([
      "trial_job_1",
      "trial_job_2",
    ]);
    expect(phases[0]?.trace.spans.map((span) => span.stage_id)).toEqual([
      "trial",
      "trial",
    ]);
    expect(phases[0]?.trace.spans.map((span) => span.stage_run_index)).toEqual([
      null,
      null,
    ]);
  });

  test("finalizes terminal job traces from durable job status", () => {
    const job = executionJob({ id: "trial_job", minute: 1 });
    const trace = finalizeWorkbenchExecutionTraceForJob({
      job,
      stageId: "trial",
      trace: {
        trace_id: "hosted-score",
        spans: [{
          id: "tool",
          parent_id: null,
          attempt_number: 1,
          stage_id: "raw-scorer",
          stage_run_index: 3,
          kind: "tool_call",
          title: "Tool call: shell",
          status: "running",
          started_at: "2026-05-05T00:01:00.000Z",
          ended_at: null,
          attributes: {},
        }],
        events: [{
          id: "event",
          span_id: "tool",
          attempt_number: 1,
          stage_id: "raw-scorer",
          stage_run_index: 3,
          kind: "status",
          at: "2026-05-05T00:01:00.000Z",
          message: "Tool started",
          attributes: {},
        }],
        summaries: [],
      },
    });

    expect(trace.spans[0]).toMatchObject({
      stage_id: "trial",
      stage_run_index: null,
      status: "completed",
      ended_at: "2026-05-05T00:01:00.000Z",
    });
    expect(trace.events[0]).toMatchObject({
      stage_id: "trial",
      stage_run_index: null,
    });
    expect(trace.summaries).toHaveLength(1);
    expect(trace.summaries[0]).toMatchObject({
      stage_id: "trial",
      stage_run_index: null,
      status: "completed",
      duration_ms: 0,
      tool_call_count: 1,
    });
  });
});

function executionJob(args: {
  id: string;
  runId?: string;
  minute: number;
}): HostedWorkbenchJob {
  const timestamp = `2026-05-05T00:${String(args.minute).padStart(2, "0")}:00.000Z`;
  return {
    id: args.id,
    projectId: "wb_test",
    runId: args.runId ?? "run_current",
    subjectId: "subject_123",
    kind: "execute",
    status: "succeeded",
    attempt: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    input: {
      execution: {
        id: `exec_${args.id}`,
        purpose: "trial",
        metadata: {
          subjectId: "subject_123",
          caseId: "astera-labs",
          sampleIndex: 0,
        },
      },
    },
  };
}

function traceForJob(
  jobId: string,
  role: "optimizer" | "runner" | "scorer",
): WorkbenchExecutionTrace {
  return {
    trace_id: `trace_${jobId}`,
    spans: [{
      id: "turn",
      parent_id: null,
      attempt_number: 1,
      stage_id: role,
      stage_run_index: 1,
      kind: "turn",
      title: `${role} turn`,
      status: "completed",
      started_at: "2026-05-05T00:00:00.000Z",
      ended_at: "2026-05-05T00:00:01.000Z",
      attributes: {},
    }],
    events: [],
    summaries: [],
  };
}
