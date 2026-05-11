import type {
  HostedWorkbenchJob,
  Json,
  WorkbenchExecutionTrace,
} from "@workbench-ai/workbench-contract";

export interface WorkbenchTraceMergeJob {
  id: string;
  trace: WorkbenchExecutionTrace;
}

export function finalizeWorkbenchExecutionTraceForJob(args: {
  job: HostedWorkbenchJob;
  stageId: string;
  trace: WorkbenchExecutionTrace;
}): WorkbenchExecutionTrace {
  const status = traceStatusForJob(args.job.status);
  const terminal = isTerminalTraceStatus(status);
  const attempt = Math.max(1, args.job.attempt || 1);
  const startedAt = args.job.startedAt ?? args.job.createdAt;
  const endedAt = terminal
    ? args.job.finishedAt ?? args.job.updatedAt ?? startedAt
    : null;
  const spans = args.trace.spans.map((span) => ({
    ...span,
    stage_id: args.stageId,
    stage_run_index: null,
    status: terminal && span.status === "running" ? status : span.status,
    ended_at: terminal && !span.ended_at ? endedAt : span.ended_at,
  }));
  const events = args.trace.events.map((event) => ({
    ...event,
    stage_id: args.stageId,
    stage_run_index: null,
  }));
  const summaries = args.trace.summaries.map((summary) =>
    finalizeTraceSummary({
      summary,
      job: args.job,
      status,
      terminal,
      attempt: Math.max(1, summary.attempt_number || attempt),
      stageId: args.stageId,
      startedAt,
      endedAt,
      spans,
    })
  );

  if (!summaries.some((summary) => sameSummaryStage(summary, attempt, args.stageId))) {
    summaries.push(finalizeTraceSummary({
      summary: null,
      job: args.job,
      status,
      terminal,
      attempt,
      stageId: args.stageId,
      startedAt,
      endedAt,
      spans,
    }));
  }

  return {
    trace_id: args.trace.trace_id,
    spans,
    events,
    summaries,
  };
}

export function mergeWorkbenchExecutionTracesByJob(args: {
  traceIdPrefix: string;
  stageId?: string | null;
  jobs: readonly WorkbenchTraceMergeJob[];
}): WorkbenchExecutionTrace {
  const spans: WorkbenchExecutionTrace["spans"] = [];
  const events: WorkbenchExecutionTrace["events"] = [];
  const summaries: WorkbenchExecutionTrace["summaries"] = [];

  for (const job of args.jobs) {
    const prefix = sanitizeTraceComponent(job.id);
    spans.push(...job.trace.spans.map((span) => ({
      ...span,
      id: `${prefix}:${span.id}`,
      parent_id: span.parent_id ? `${prefix}:${span.parent_id}` : null,
      stage_id: args.stageId ?? span.stage_id,
      stage_run_index: null,
      attributes: withTraceJobId(span.attributes, job.id),
    })));
    events.push(...job.trace.events.map((event) => ({
      ...event,
      id: `${prefix}:${event.id}`,
      span_id: `${prefix}:${event.span_id}`,
      stage_id: args.stageId ?? event.stage_id,
      stage_run_index: null,
      attributes: withTraceJobId(event.attributes, job.id),
    })));
    summaries.push(...job.trace.summaries.map((summary) => ({
      ...summary,
      stage_id: args.stageId ?? summary.stage_id,
      stage_run_index: null,
    })));
  }

  return {
    trace_id: `${args.traceIdPrefix}-${args.jobs.map((job) => sanitizeTraceComponent(job.id)).join("-")}`,
    spans: spans.sort(compareTraceSpans),
    events: events.sort(compareTraceEvents),
    summaries: summaries.sort(compareTraceSummaries),
  };
}

function withTraceJobId(
  attributes: Record<string, Json>,
  jobId: string,
): Record<string, Json> {
  return {
    ...attributes,
    job_id: jobId,
  };
}

function compareTraceSpans(
  left: WorkbenchExecutionTrace["spans"][number],
  right: WorkbenchExecutionTrace["spans"][number],
): number {
  return (
    left.started_at.localeCompare(right.started_at) ||
    left.id.localeCompare(right.id)
  );
}

function compareTraceEvents(
  left: WorkbenchExecutionTrace["events"][number],
  right: WorkbenchExecutionTrace["events"][number],
): number {
  return left.at.localeCompare(right.at) || left.id.localeCompare(right.id);
}

function compareTraceSummaries(
  left: WorkbenchExecutionTrace["summaries"][number],
  right: WorkbenchExecutionTrace["summaries"][number],
): number {
  return (
    left.started_at.localeCompare(right.started_at) ||
    traceSummaryKey(left).localeCompare(traceSummaryKey(right))
  );
}

function traceSummaryKey(
  summary: WorkbenchExecutionTrace["summaries"][number],
): string {
  return [
    summary.attempt_number,
    summary.stage_id ?? "attempt",
    summary.stage_run_index ?? "none",
  ].join(":");
}

function sanitizeTraceComponent(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_-]+/g, "-");
}

function finalizeTraceSummary(args: {
  summary: WorkbenchExecutionTrace["summaries"][number] | null;
  job: HostedWorkbenchJob;
  status: WorkbenchExecutionTrace["summaries"][number]["status"];
  terminal: boolean;
  attempt: number;
  stageId: string;
  startedAt: string;
  endedAt: string | null;
  spans: readonly WorkbenchExecutionTrace["spans"][number][];
}): WorkbenchExecutionTrace["summaries"][number] {
  const startedAt = args.summary?.started_at ?? args.startedAt;
  const endedAt = args.terminal ? args.summary?.ended_at ?? args.endedAt : args.summary?.ended_at ?? null;
  return {
    attempt_number: args.attempt,
    stage_id: args.stageId,
    stage_run_index: null,
    status: args.terminal ? args.status : args.summary?.status ?? args.status,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: endedAt
      ? durationBetween(startedAt, endedAt)
      : args.summary?.duration_ms ?? 0,
    tool_call_count: args.summary?.tool_call_count ??
      args.spans.filter((span) => span.kind === "tool_call").length,
    input_tokens: args.summary?.input_tokens ?? null,
    output_tokens: args.summary?.output_tokens ?? null,
    usage: args.summary?.usage ?? null,
    final_output_present: args.summary?.final_output_present ??
      Boolean(args.job.output),
    error_message: args.summary?.error_message ??
      (typeof args.job.error === "string" ? args.job.error : null),
  };
}

function sameSummaryStage(
  summary: WorkbenchExecutionTrace["summaries"][number],
  attempt: number,
  stageId: string,
): boolean {
  return summary.attempt_number === attempt &&
    (summary.stage_id == null || summary.stage_id === stageId) &&
    summary.stage_run_index == null;
}

function traceStatusForJob(
  status: HostedWorkbenchJob["status"],
): WorkbenchExecutionTrace["summaries"][number]["status"] {
  if (status === "succeeded") {
    return "completed";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "cancelled") {
    return "canceled";
  }
  return "running";
}

function isTerminalTraceStatus(
  status: WorkbenchExecutionTrace["summaries"][number]["status"],
): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

function durationBetween(startedAt: string, endedAt: string): number {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, end - start)
    : 0;
}
