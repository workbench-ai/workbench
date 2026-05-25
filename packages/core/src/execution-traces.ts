import type {
  HostedWorkbenchJob,
  Json,
  SurfaceSnapshotFile,
  WorkbenchExecutionTrace,
  WorkbenchTraceSession,
} from "@workbench-ai/workbench-contract";

export interface WorkbenchTraceMergeJob {
  id: string;
  jobId?: string;
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
    const traceJobId = job.jobId ?? job.id;
    spans.push(...job.trace.spans.map((span) => ({
      ...span,
      id: `${prefix}:${span.id}`,
      parent_id: span.parent_id ? `${prefix}:${span.parent_id}` : null,
      stage_id: args.stageId ?? span.stage_id,
      stage_run_index: null,
      attributes: withTraceJobId(span.attributes, traceJobId),
    })));
    events.push(...job.trace.events.map((event) => ({
      ...event,
      id: `${prefix}:${event.id}`,
      span_id: `${prefix}:${event.span_id}`,
      stage_id: args.stageId ?? event.stage_id,
      stage_run_index: null,
      attributes: withTraceJobId(event.attributes, traceJobId),
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

export function buildWorkbenchTraceSessionsFromFiles(args: {
  job: HostedWorkbenchJob;
  files: readonly SurfaceSnapshotFile[];
  purpose?: string | null;
  fallbackRole: WorkbenchTraceSession["role"];
}): WorkbenchTraceSession[] {
  return args.files
    .filter((file) => file.encoding === "utf8" && file.path.endsWith("/trace.json"))
    .sort((left, right) =>
      traceFileDisplayOrder(left.path) - traceFileDisplayOrder(right.path) ||
      left.path.localeCompare(right.path)
    )
    .flatMap((file, index) => {
      const trace = readWorkbenchExecutionTraceFile(file);
      if (!trace) {
        return [];
      }
      const prefix = traceFilePrefix(file.path, index);
      const role = traceRoleForFilePath(file.path, args.purpose ?? null, args.fallbackRole);
      return [{
        id: `${args.job.id}:${prefix}`,
        jobId: args.job.id,
        role,
        kind: traceSessionKindForFilePath(file.path, role),
        label: traceSessionLabel(file.path, role),
        sourcePath: file.path,
        trace: prefixTraceFileIds(trace, prefix),
        metadata: {
          trace_file: file.path,
        },
      }];
    });
}

export function combineWorkbenchTraceSessions(
  sessions: readonly WorkbenchTraceSession[],
): WorkbenchExecutionTrace {
  return {
    trace_id: sessions.length === 1 ? sessions[0]!.trace.trace_id : "combined-job-trace",
    spans: sessions.flatMap((session) => session.trace.spans).sort(compareTraceSpans),
    events: sessions.flatMap((session) => session.trace.events).sort(compareTraceEvents),
    summaries: sessions.flatMap((session) => session.trace.summaries).sort(compareTraceSummaries),
  };
}

export function readWorkbenchExecutionTraceFiles(
  files: readonly SurfaceSnapshotFile[],
): WorkbenchExecutionTrace | null {
  const traces = files
    .filter((file) => file.encoding === "utf8" && file.path.endsWith("/trace.json"))
    .sort((left, right) => left.path.localeCompare(right.path))
    .flatMap((file, index) => {
      const trace = readWorkbenchExecutionTraceFile(file);
      return trace ? [prefixTraceFileIds(trace, traceFilePrefix(file.path, index))] : [];
    });
  if (traces.length === 0) {
    return null;
  }
  return {
    trace_id: traces.length === 1 ? traces[0]!.trace_id : "combined-job-trace",
    spans: traces.flatMap((trace) => trace.spans).sort(compareTraceSpans),
    events: traces.flatMap((trace) => trace.events).sort(compareTraceEvents),
    summaries: traces.flatMap((trace) => trace.summaries).sort(compareTraceSummaries),
  };
}

export function traceSessionLabel(
  filePath: string,
  role: WorkbenchTraceSession["role"],
): string {
  const innerPath = traceSessionInnerPath(filePath);
  if (innerPath === "runner/session") {
    return "Subject runner";
  }
  if (innerPath === "optimizer/session") {
    return "Optimizer";
  }
  const parts = innerPath
    .split("/")
    .filter((part) => part.length > 0 && part !== "session");
  const label = parts.slice(-2).join(" ") || role;
  return formatTraceLabelText(label);
}

function traceSessionKindForFilePath(
  filePath: string,
  role: WorkbenchTraceSession["role"],
): string {
  const innerPath = traceSessionInnerPath(filePath);
  const parts = innerPath
    .split("/")
    .filter((part) => part.length > 0 && part !== "session");
  return parts.at(-1) ?? role;
}

function readWorkbenchExecutionTraceFile(file: SurfaceSnapshotFile): WorkbenchExecutionTrace | null {
  const traceRecord = parseJsonObject(file.content);
  if (!traceRecord) {
    return null;
  }
  const spans = Array.isArray(traceRecord.spans)
    ? traceRecord.spans.map(readTraceSpan).filter((span): span is WorkbenchExecutionTrace["spans"][number] => span !== null)
    : [];
  const events = Array.isArray(traceRecord.events)
    ? traceRecord.events.map(readTraceEvent).filter((event): event is WorkbenchExecutionTrace["events"][number] => event !== null)
    : [];
  const summaries = Array.isArray(traceRecord.summaries)
    ? traceRecord.summaries.map(readTraceSummary).filter((summary): summary is WorkbenchExecutionTrace["summaries"][number] => summary !== null)
    : [];
  if (spans.length === 0 && events.length === 0 && summaries.length === 0) {
    return null;
  }
  return {
    trace_id: readString(traceRecord.trace_id) ?? "agent-trace",
    spans,
    events,
    summaries,
  };
}

function prefixTraceFileIds(
  trace: WorkbenchExecutionTrace,
  prefix: string,
): WorkbenchExecutionTrace {
  return {
    trace_id: `${prefix}:${trace.trace_id}`,
    spans: trace.spans.map((span) => ({
      ...span,
      id: `${prefix}:${span.id}`,
      parent_id: span.parent_id ? `${prefix}:${span.parent_id}` : null,
      attributes: {
        ...span.attributes,
        trace_file: prefix,
      },
    })),
    events: trace.events.map((event) => ({
      ...event,
      id: `${prefix}:${event.id}`,
      span_id: `${prefix}:${event.span_id}`,
      attributes: {
        ...event.attributes,
        trace_file: prefix,
      },
    })),
    summaries: trace.summaries.map((summary) => ({ ...summary })),
  };
}

function traceFilePrefix(filePath: string, index: number): string {
  const safe = filePath
    .replace(/^\.workbench\/traces\//u, "")
    .replace(/\/trace\.json$/u, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || `trace-${index + 1}`;
}

function traceFileDisplayOrder(filePath: string): number {
  if (filePath.includes("/runner/") || filePath.includes("/optimizer/")) {
    return 0;
  }
  return 1;
}

function traceRoleForFilePath(
  filePath: string,
  purpose: string | null,
  fallbackRole: WorkbenchTraceSession["role"],
): WorkbenchTraceSession["role"] {
  if (filePath.includes("/runner/")) {
    return "runner";
  }
  if (filePath.includes("/optimizer/") || purpose === "improve") {
    return "optimizer";
  }
  if (filePath.includes("/engine/")) {
    return "engine";
  }
  return fallbackRole;
}

function traceSessionInnerPath(filePath: string): string {
  const withoutTraceFile = filePath.replace(/\/trace\.json$/u, "");
  const markerIndexes = [
    withoutTraceFile.indexOf("/runner/"),
    withoutTraceFile.indexOf("/optimizer/"),
    withoutTraceFile.indexOf("/engine/"),
  ].filter((index) => index >= 0);
  const firstMarker = Math.min(...markerIndexes);
  if (Number.isFinite(firstMarker)) {
    return withoutTraceFile.slice(firstMarker + 1);
  }
  return withoutTraceFile.replace(/^\.workbench\/traces\/[^/]+\//u, "");
}

function formatTraceLabelText(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/u, (match) => match.toUpperCase());
}

function readTraceSpan(value: unknown): WorkbenchExecutionTrace["spans"][number] | null {
  const record = jsonRecord(value);
  if (!record) {
    return null;
  }
  const id = readString(record.id);
  const kind = traceSpanKind(record.kind);
  const status = traceStatus(record.status);
  const startedAt = readString(record.started_at);
  if (!id || !kind || !status || !startedAt) {
    return null;
  }
  return {
    id,
    parent_id: readString(record.parent_id),
    attempt_number: readPositiveInteger(record.attempt_number) ?? 1,
    stage_id: readString(record.stage_id),
    stage_run_index: readInteger(record.stage_run_index),
    kind,
    title: readString(record.title) ?? id,
    status,
    started_at: startedAt,
    ended_at: readString(record.ended_at),
    attributes: (jsonRecord(record.attributes) ?? {}) as Record<string, Json>,
  };
}

function readTraceEvent(value: unknown): WorkbenchExecutionTrace["events"][number] | null {
  const record = jsonRecord(value);
  if (!record) {
    return null;
  }
  const id = readString(record.id);
  const spanId = readString(record.span_id);
  const kind = traceEventKind(record.kind);
  const at = readString(record.at);
  if (!id || !spanId || !kind || !at) {
    return null;
  }
  return {
    id,
    span_id: spanId,
    attempt_number: readPositiveInteger(record.attempt_number) ?? 1,
    stage_id: readString(record.stage_id),
    stage_run_index: readInteger(record.stage_run_index),
    kind,
    at,
    message: readString(record.message) ?? kind,
    attributes: (jsonRecord(record.attributes) ?? {}) as Record<string, Json>,
  };
}

function readTraceSummary(value: unknown): WorkbenchExecutionTrace["summaries"][number] | null {
  const record = jsonRecord(value);
  if (!record) {
    return null;
  }
  const status = traceStatus(record.status);
  const startedAt = readString(record.started_at);
  if (!status || !startedAt) {
    return null;
  }
  return {
    attempt_number: readPositiveInteger(record.attempt_number) ?? 1,
    stage_id: readString(record.stage_id),
    stage_run_index: readInteger(record.stage_run_index),
    status,
    started_at: startedAt,
    ended_at: readString(record.ended_at),
    duration_ms: readNonNegativeInteger(record.duration_ms) ?? 0,
    tool_call_count: readNonNegativeInteger(record.tool_call_count) ?? 0,
    input_tokens: readNonNegativeInteger(record.input_tokens),
    output_tokens: readNonNegativeInteger(record.output_tokens),
    usage: jsonRecord(record.usage) as WorkbenchExecutionTrace["summaries"][number]["usage"],
    final_output_present: record.final_output_present === true,
    error_message: readString(record.error_message),
  };
}

function parseJsonObject(source: string): Record<string, unknown> | null {
  try {
    return jsonRecord(JSON.parse(source));
  } catch {
    return null;
  }
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function readPositiveInteger(value: unknown): number | null {
  const integer = readInteger(value);
  return integer !== null && integer > 0 ? integer : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  const integer = readInteger(value);
  return integer !== null && integer >= 0 ? integer : null;
}

function traceSpanKind(value: unknown): WorkbenchExecutionTrace["spans"][number]["kind"] | null {
  return value === "hook" ||
    value === "stage" ||
    value === "turn" ||
    value === "tool_call" ||
    value === "assistant_output" ||
    value === "usage" ||
    value === "gate" ||
    value === "action" ||
    value === "error"
    ? value
    : null;
}

function traceEventKind(value: unknown): WorkbenchExecutionTrace["events"][number]["kind"] | null {
  return value === "status" ||
    value === "message" ||
    value === "output" ||
    value === "usage" ||
    value === "error" ||
    value === "note"
    ? value
    : null;
}

function traceStatus(value: unknown): WorkbenchExecutionTrace["spans"][number]["status"] | null {
  return value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "canceled" ||
    value === "warning"
    ? value
    : null;
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
