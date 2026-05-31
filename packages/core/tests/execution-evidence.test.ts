import { describe, expect, test } from "vitest";

import {
  buildCandidateCaseExecutionRefs,
  buildWorkbenchExecutionEvidence,
  finalizeWorkbenchExecutionTraceForJob,
  type RemoteWorkbenchJob,
  type WorkbenchExecutionTrace,
} from "../src/index.ts";

describe("workbench execution evidence", () => {
  test("groups attempt jobs into one execution and selects the latest run", () => {
    const jobs = [
      executionJob({ id: "old_attempt", runId: "run_old", minute: 0 }),
      executionJob({ id: "new_attempt", runId: "run_new", minute: 2 }),
    ];

    expect(buildCandidateCaseExecutionRefs({
      jobs,
      candidateId: "candidate_123",
      caseId: "astera-labs",
      sampleIndex: 0,
    })).toMatchObject([
      {
        runId: "run_new",
        kind: "attempt",
        role: "engine",
        jobIds: ["new_attempt"],
        sampleIndex: 0,
      },
    ]);
  });

  test("merges trace jobs behind the attempt execution", () => {
    const jobs = [
      executionJob({ id: "attempt_job_1", minute: 1 }),
      executionJob({ id: "attempt_job_2", minute: 2 }),
    ];

    const executions = buildWorkbenchExecutionEvidence({
      jobs,
      traceIdPrefix: "test-execution",
      traceForJob: (job, role) => traceForJob(job.id, role),
      traceSessionsForJob: (job, role) => [{
        id: `${job.id}:session`,
        jobId: job.id,
        role,
        kind: "trace",
        label: "Trace",
        sourcePath: null,
        trace: traceForJob(job.id, role),
      }],
    });

    expect(executions.map((execution) => execution.kind)).toEqual(["attempt"]);
    expect(executions.map((execution) => execution.role)).toEqual(["engine"]);
    expect(executions[0]?.jobIds).toEqual(["attempt_job_1", "attempt_job_2"]);
    expect(executions[0]?.sessions.map((session) => session.jobId)).toEqual([
      "attempt_job_1",
      "attempt_job_2",
    ]);
    expect(executions[0]?.trace.spans.map((span) => span.attributes.job_id)).toEqual([
      "attempt_job_1",
      "attempt_job_1",
      "attempt_job_2",
      "attempt_job_2",
    ]);
    expect(executions[0]?.trace.spans.map((span) => span.stage_id)).toEqual([
      "attempt",
      "attempt",
      "attempt",
      "attempt",
    ]);
    expect(executions[0]?.trace.spans.map((span) => span.stage_run_index)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  test("does not expose baseline materialization jobs as improver trace evidence", () => {
    const jobs = [
      executionJob({ id: "baseline_job", minute: 0, purpose: "improve", baseline: true }),
      executionJob({ id: "attempt_job", minute: 1 }),
    ];

    const executions = buildWorkbenchExecutionEvidence({
      jobs,
      traceIdPrefix: "test-execution",
      traceForJob: (job, role) => traceForJob(job.id, role),
    });

    expect(executions.map((execution) => execution.kind)).toEqual(["attempt"]);
    expect(executions[0]?.jobIds).toEqual(["attempt_job"]);
  });

  test("finalizes terminal job traces from durable job status", () => {
    const job = executionJob({ id: "attempt_job", minute: 1 });
    const trace = finalizeWorkbenchExecutionTraceForJob({
      job,
      stageId: "attempt",
      trace: {
        trace_id: "remote-score",
        spans: [{
          id: "tool",
          parent_id: null,
          attempt_number: 1,
          stage_id: "raw-engine",
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
          stage_id: "raw-engine",
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
      stage_id: "attempt",
      stage_run_index: null,
      status: "completed",
      ended_at: "2026-05-05T00:01:00.000Z",
    });
    expect(trace.events[0]).toMatchObject({
      stage_id: "attempt",
      stage_run_index: null,
    });
    expect(trace.summaries).toHaveLength(1);
    expect(trace.summaries[0]).toMatchObject({
      stage_id: "attempt",
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
  purpose?: "attempt" | "improve";
  baseline?: boolean;
}): RemoteWorkbenchJob {
  const timestamp = `2026-05-05T00:${String(args.minute).padStart(2, "0")}:00.000Z`;
  return {
    id: args.id,
    projectId: "wb_test",
    runId: args.runId ?? "run_current",
    candidateId: "candidate_123",
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
        purpose: args.purpose ?? "attempt",
        metadata: {
          candidateId: "candidate_123",
          caseId: args.baseline ? "current" : "astera-labs",
          sampleIndex: 0,
          ...(args.baseline ? { baseline: true } : {}),
        },
      },
    },
  };
}

function traceForJob(
  jobId: string,
  role: "improver" | "runner" | "engine",
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
