import { describe, expect, test } from "vitest";

import {
  buildCandidateCasePhaseRefs,
  buildWorkbenchTracePhases,
  finalizeWorkbenchExecutionTraceForJob,
  type HostedWorkbenchJob,
  type WorkbenchExecutionTrace,
} from "../src/index.ts";

describe("workbench execution phases", () => {
  test("groups runner and grader jobs into phases and selects the latest run", () => {
    const jobs = [
      executionJob({ id: "old_run", runId: "run_old", purpose: "run-task", minute: 0 }),
      executionJob({ id: "old_grade", runId: "run_old", purpose: "grade-task", minute: 1 }),
      executionJob({ id: "new_run", runId: "run_new", purpose: "run-task", minute: 2 }),
      executionJob({ id: "new_grade", runId: "run_new", purpose: "grade-task", minute: 3 }),
    ];

    expect(buildCandidateCasePhaseRefs({
      jobs,
      candidateId: "cand_123",
      caseId: "astera-labs",
      sampleIndex: 0,
    })).toMatchObject([
      {
        runId: "run_new",
        phase: "run-task",
        role: "runner",
        jobIds: ["new_run"],
        sampleIndex: 0,
      },
      {
        runId: "run_new",
        phase: "grade-task",
        role: "grader",
        jobIds: ["new_grade"],
        sampleIndex: 0,
      },
    ]);
  });

  test("merges trace jobs behind runner and grader phases", () => {
    const jobs = [
      executionJob({ id: "run_job", purpose: "run-task", minute: 0 }),
      executionJob({ id: "grade_job_1", purpose: "grade-task", minute: 1 }),
      executionJob({ id: "grade_job_2", purpose: "grade-task", minute: 2 }),
    ];

    const phases = buildWorkbenchTracePhases({
      jobs,
      traceIdPrefix: "test-phase",
      traceForJob: (job, role) => traceForJob(job.id, role),
    });

    expect(phases.map((phase) => phase.phase)).toEqual(["run-task", "grade-task"]);
    expect(phases.map((phase) => phase.role)).toEqual(["runner", "grader"]);
    expect(phases[1]?.jobIds).toEqual(["grade_job_1", "grade_job_2"]);
    expect(phases[1]?.trace.spans.map((span) => span.attributes.job_id)).toEqual([
      "grade_job_1",
      "grade_job_2",
    ]);
    expect(phases[1]?.trace.spans.map((span) => span.stage_id)).toEqual([
      "grade-task",
      "grade-task",
    ]);
    expect(phases[1]?.trace.spans.map((span) => span.stage_run_index)).toEqual([
      null,
      null,
    ]);
  });

  test("finalizes terminal job traces from durable job status", () => {
    const job = executionJob({ id: "grade_job", purpose: "grade-task", minute: 1 });
    const trace = finalizeWorkbenchExecutionTraceForJob({
      job,
      stageId: "grade-task",
      trace: {
        trace_id: "hosted-grade",
        spans: [{
          id: "tool",
          parent_id: null,
          attempt_number: 1,
          stage_id: "raw-grader",
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
          stage_id: "raw-grader",
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
      stage_id: "grade-task",
      stage_run_index: null,
      status: "completed",
      ended_at: "2026-05-05T00:01:00.000Z",
    });
    expect(trace.events[0]).toMatchObject({
      stage_id: "grade-task",
      stage_run_index: null,
    });
    expect(trace.summaries).toHaveLength(1);
    expect(trace.summaries[0]).toMatchObject({
      stage_id: "grade-task",
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
  purpose: "run-task" | "grade-task";
  minute: number;
}): HostedWorkbenchJob {
  const timestamp = `2026-05-05T00:${String(args.minute).padStart(2, "0")}:00.000Z`;
  return {
    id: args.id,
    projectId: "wb_test",
    runId: args.runId ?? "run_current",
    candidateId: "cand_123",
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
        purpose: args.purpose,
        metadata: {
          candidateId: "cand_123",
          caseId: "astera-labs",
          sampleIndex: 0,
        },
      },
    },
  };
}

function traceForJob(
  jobId: string,
  role: "optimizer" | "runner" | "grader",
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
