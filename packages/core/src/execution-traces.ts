import type {
  Json,
  SurfaceSnapshotFile,
  WorkbenchExecutionTrace,
  WorkbenchTraceSession,
} from "@workbench-ai/workbench-contract";

export function buildWorkbenchTraceSessionsFromFiles(args: {
  job: { id: string };
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

function traceSessionLabel(
  filePath: string,
  role: WorkbenchTraceSession["role"],
): string {
  const innerPath = traceSessionInnerPath(filePath);
  if (innerPath === "runner/session") {
    return "Skill run";
  }
  if (innerPath === "improver/session") {
    return "Improver";
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
  let value: unknown;
  try {
    value = JSON.parse(file.content);
  } catch {
    return null;
  }
  return readWorkbenchExecutionTrace(value, "agent-trace");
}

export function readWorkbenchExecutionTrace(
  value: unknown,
  fallbackTraceId: string,
): WorkbenchExecutionTrace | null {
  const traceRecord = jsonRecord(value);
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
    trace_id: readString(traceRecord.trace_id) ?? fallbackTraceId,
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
  if (filePath.includes("/runner/") || filePath.includes("/improver/")) {
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
  if (filePath.includes("/improver/") || purpose === "improve") {
    return "improver";
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
    withoutTraceFile.indexOf("/improver/"),
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
    usage: readTraceUsage(record.usage),
    final_output_present: record.final_output_present === true,
    error_message: readString(record.error_message),
  };
}

function readTraceUsage(
  value: unknown,
): WorkbenchExecutionTrace["summaries"][number]["usage"] {
  const record = jsonRecord(value);
  if (!record) {
    return null;
  }
  return {
    provider: readString(record.provider),
    model: readString(record.model),
    input_tokens: readNonNegativeInteger(record.input_tokens),
    uncached_input_tokens: readNonNegativeInteger(record.uncached_input_tokens),
    cached_input_tokens: readNonNegativeInteger(record.cached_input_tokens),
    cache_creation_input_tokens: readNonNegativeInteger(record.cache_creation_input_tokens),
    cache_read_input_tokens: readNonNegativeInteger(record.cache_read_input_tokens),
    output_tokens: readNonNegativeInteger(record.output_tokens),
    reasoning_output_tokens: readNonNegativeInteger(record.reasoning_output_tokens),
    total_tokens: readNonNegativeInteger(record.total_tokens),
    total_cost_usd: readNonNegativeNumber(record.total_cost_usd),
    cost_source: readString(record.cost_source),
    pricing_source: readString(record.pricing_source),
  };
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

function readNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
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

export function traceSummaryKey(
  summary: WorkbenchExecutionTrace["summaries"][number],
): string {
  return [
    summary.attempt_number,
    summary.stage_id ?? "attempt",
    summary.stage_run_index ?? "none",
  ].join(":");
}
