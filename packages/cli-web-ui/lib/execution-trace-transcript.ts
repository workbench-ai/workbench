import type { BadgeTone } from "./badge";
import type {
  ExecutionTrace,
  JsonValue,
  TraceEvent,
  TraceSpan,
  TraceSpanStatus,
  TraceSummary,
} from "@workbench-ai/agent-driver";

export type ExecutionTranscriptRowKind =
  | "session"
  | "user"
  | "assistant"
  | "tool"
  | "file"
  | "system"
  | "error";

export interface ExecutionTranscriptBlock {
  text: string;
  format: "markdown" | "text";
}

export interface ExecutionTranscriptRow {
  id: string;
  kind: ExecutionTranscriptRowKind;
  label: string;
  tone: BadgeTone;
  title: string;
  body?: ExecutionTranscriptBlock;
  detail: string | null;
  monospace: boolean;
  at: string;
  durationMs: number | null;
  usage: string | null;
  live: boolean;
}

export interface ExecutionTranscriptGroup {
  id: string;
  title: string;
  status: TraceSpan["status"] | null;
  startedAt: string;
  durationMs: number;
  rows: ExecutionTranscriptRow[];
}

export interface ExecutionTraceTranscript {
  id: string;
  groups: ExecutionTranscriptGroup[];
}

const ROW_LABEL_BY_KIND: Record<ExecutionTranscriptRowKind, string> = {
  assistant: "Assistant",
  error: "Error",
  file: "File",
  session: "Session",
  system: "System",
  tool: "Tool",
  user: "User",
};

const ROW_TONE_BY_KIND: Record<ExecutionTranscriptRowKind, BadgeTone> = {
  assistant: "accent",
  error: "destructive",
  file: "success",
  session: "outline",
  system: "outline",
  tool: "secondary",
  user: "outline",
};

const STATUS_RANK: Record<TraceSpanStatus, number> = {
  canceled: 1,
  completed: 0,
  failed: 4,
  running: 2,
  warning: 3,
};

interface StageBucket {
  key: string;
  stageId: string | null;
  stageRunIndex: number | null;
  summary: TraceSummary | null;
  spans: TraceSpan[];
  events: TraceEvent[];
}

interface SortableRow {
  row: ExecutionTranscriptRow;
  sortAt: string;
  kindOrder: number;
  order: number;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatLabel(value: string | null | undefined): string {
  return String(value ?? "").replaceAll(/[_-]+/g, " ");
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "n/a";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "0s";
  }
  if (durationMs < 1_000) {
    return `${Math.round(durationMs)}ms`;
  }
  return `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
}

export function buildExecutionTraceTranscript(
  input: { trace: ExecutionTrace | null | undefined } | null | undefined,
): ExecutionTraceTranscript {
  const trace = input?.trace ?? null;
  if (!trace) {
    return emptyTranscript();
  }

  const attemptNumber = inferLatestAttemptNumber(trace);
  const spans = filterAttempt(trace.spans ?? [], attemptNumber).sort(compareSpans);
  const events = filterAttempt(trace.events ?? [], attemptNumber).sort(compareEvents);
  const summaries = filterAttempt(trace.summaries ?? [], attemptNumber).sort(compareSummaries);
  const buckets = buildStageBuckets(spans, events, summaries);
  const eventsBySpan = groupBy(events, (event) => event.span_id);

  const groups = [...buckets.values()]
    .sort((left, right) => bucketStartedAt(left).localeCompare(bucketStartedAt(right)) || left.key.localeCompare(right.key))
    .map((bucket) => buildTranscriptGroup(bucket, eventsBySpan));

  return {
    id: trace.trace_id,
    groups,
  };
}

function emptyTranscript(): ExecutionTraceTranscript {
  return {
    id: "execution-trace",
    groups: [],
  };
}

function buildStageBuckets(
  spans: TraceSpan[],
  events: TraceEvent[],
  summaries: TraceSummary[],
): Map<string, StageBucket> {
  const buckets = new Map<string, StageBucket>();
  const ensure = (
    stageId: string | null,
    stageRunIndex: number | null,
  ): StageBucket => {
    const key = stageKey(stageId, stageRunIndex);
    const existing = buckets.get(key);
    if (existing) {
      return existing;
    }
    const bucket = {
      key,
      stageId,
      stageRunIndex,
      summary: null,
      spans: [],
      events: [],
    };
    buckets.set(key, bucket);
    return bucket;
  };

  for (const summary of summaries) {
    ensure(summary.stage_id, summary.stage_run_index).summary = summary;
  }
  for (const span of spans) {
    ensure(span.stage_id, span.stage_run_index).spans.push(span);
  }
  for (const event of events) {
    ensure(event.stage_id, event.stage_run_index).events.push(event);
  }
  return buckets;
}

function buildTranscriptGroup(
  bucket: StageBucket,
  eventsBySpan: Map<string, TraceEvent[]>,
): ExecutionTranscriptGroup {
  const consumedEventIds = new Set<string>();
  const rows: SortableRow[] = [];
  let order = 0;

  for (const span of bucket.spans) {
    if (span.kind === "turn") {
      const promptRow = promptTranscriptRow(span);
      if (promptRow) {
        order = appendRow(rows, promptRow, order);
      }
      continue;
    }
    if (span.kind === "stage" || span.kind === "usage") {
      continue;
    }

    const relatedEvents = eventsBySpan.get(span.id) ?? [];
    const row =
      span.kind === "assistant_output"
        ? assistantTranscriptRow(span, relatedEvents)
        : shouldRenderSpan(span)
          ? spanTranscriptRow(span, relatedEvents)
          : null;
    if (!row) {
      continue;
    }
    for (const event of relatedEvents) {
      consumedEventIds.add(event.id);
    }
    order = appendRow(rows, row, order);
  }

  for (const event of bucket.events) {
    if (consumedEventIds.has(event.id) || !shouldRenderEvent(event)) {
      continue;
    }
    order = appendRow(rows, eventTranscriptRow(event), order);
  }

  const orderedRows = rows
    .sort((left, right) =>
      left.sortAt.localeCompare(right.sortAt) ||
      left.kindOrder - right.kindOrder ||
      left.order - right.order
    )
    .map((entry) => entry.row);
  const usage = usageTranscriptInfo(
    bucket.spans.filter((span) => span.kind === "usage"),
    bucket.summary,
  );
  if (usage && orderedRows.length > 0) {
    orderedRows[orderedRows.length - 1]!.usage ??= usage;
  }

  const visibleRows = orderedRows.length > 0
    ? orderedRows
    : [emptyStageRow(bucket)];
  return {
    id: bucket.key,
    title: stageTitle(bucket),
    status: bucket.summary?.status ?? dominantStatus(bucket.spans),
    startedAt: bucketStartedAt(bucket),
    durationMs: bucketDurationMs(bucket, visibleRows),
    rows: visibleRows,
  };
}

function promptTranscriptRow(span: TraceSpan): ExecutionTranscriptRow | null {
  const prompt = readString(span.attributes, "prompt_text");
  if (!prompt) {
    return null;
  }
  const format = span.attributes.prompt_format === "markdown" ? "markdown" : "text";
  return createRow({
    id: `${span.id}:prompt`,
    kind: "user",
    title: firstLine(prompt),
    body: prompt,
    format,
    at: span.started_at,
  });
}

function assistantTranscriptRow(
  span: TraceSpan,
  events: TraceEvent[],
): ExecutionTranscriptRow | null {
  const output = assistantOutput(events);
  if (!output.text) {
    return null;
  }
  return createRow({
    id: `${span.id}:assistant`,
    kind: "assistant",
    title: firstLine(output.text),
    body: output.text,
    format: "markdown",
    status: span.status,
    at: output.at ?? span.ended_at ?? span.started_at,
    durationMs: spanDuration(span),
    live: output.live,
  });
}

function spanTranscriptRow(
  span: TraceSpan,
  events: TraceEvent[],
): ExecutionTranscriptRow {
  const kind = rowKindForSpan(span, events);
  const body = spanBody(span, events);
  return createRow({
    id: span.id,
    kind,
    label: span.kind === "tool_call" && kind !== "error" ? toolLabel(span) : undefined,
    title: span.title,
    body,
    detail: spanDetail(span, body),
    status: span.status,
    at: span.started_at,
    durationMs: spanDuration(span),
    monospace: kind === "tool" || kind === "file" || bodyLooksCodeLike(body),
  });
}

function eventTranscriptRow(event: TraceEvent): ExecutionTranscriptRow {
  const kind = rowKindForEvent(event);
  const paths = readStringArray(event.attributes, "paths");
  const body = kind === "file" && paths.length > 0
    ? paths.slice(0, 3).join("\n")
    : event.message;
  return createRow({
    id: event.id,
    kind,
    title: firstLine(event.message),
    body,
    detail: eventDetail(event, body),
    status: kind === "error" ? "failed" : null,
    at: event.at,
    monospace: kind === "file" || bodyLooksCodeLike(body),
  });
}

function emptyStageRow(bucket: StageBucket): ExecutionTranscriptRow {
  return createRow({
    id: `${bucket.key}:empty`,
    kind: "system",
    title: "No step evidence recorded",
    body: "No step evidence recorded for this stage.",
    at: bucketStartedAt(bucket),
  });
}

function createRow(args: {
  id: string;
  kind: ExecutionTranscriptRowKind;
  title: string;
  body: string;
  at: string;
  label?: string;
  detail?: string | null;
  durationMs?: number | null;
  format?: "markdown" | "text";
  live?: boolean;
  monospace?: boolean;
  status?: TraceSpan["status"] | null;
}): ExecutionTranscriptRow {
  const body = args.body.trim();
  const kind = args.status === "failed" ? "error" : args.kind;
  return {
    id: args.id,
    kind,
    label: args.label ?? ROW_LABEL_BY_KIND[kind],
    tone: toneForRow(kind, args.status ?? null),
    title: args.title,
    ...(body ? { body: { text: body, format: args.format ?? "text" } } : {}),
    detail: args.detail ?? null,
    monospace: args.monospace ?? false,
    at: args.at,
    durationMs: args.durationMs ?? null,
    usage: null,
    live: args.live ?? false,
  };
}

function appendRow(
  rows: SortableRow[],
  row: ExecutionTranscriptRow,
  order: number,
): number {
  rows.push({
    row,
    sortAt: row.at,
    kindOrder: rowKindOrder(row.kind),
    order,
  });
  return order + 1;
}

function assistantOutput(events: TraceEvent[]): { text: string | null; at: string | null; live: boolean } {
  let finalText: string | null = null;
  let finalAt: string | null = null;
  let cumulative = "";
  let latestMessage: string | null = null;
  let latestAt: string | null = null;

  for (const event of events.sort(compareEvents)) {
    const deltaText = readString(event.attributes, "delta_text");
    if (deltaText) {
      cumulative += deltaText;
      latestAt = event.at;
    }
    const outputText = readString(event.attributes, "output_text");
    if (outputText) {
      finalText = outputText;
      finalAt = event.at;
    } else if (event.kind === "output" && event.message.trim()) {
      latestMessage = event.message;
      latestAt = event.at;
    }
  }

  const liveText = cumulative.trim() || latestMessage;
  return finalText
    ? { text: finalText, at: finalAt, live: false }
    : { text: liveText, at: latestAt, live: Boolean(cumulative) };
}

function usageTranscriptInfo(
  usageSpans: TraceSpan[],
  summary: TraceSummary | null,
): string | null {
  const usageSpan = usageSpans.at(-1) ?? null;
  const inputTokens =
    readNumber(usageSpan?.attributes ?? {}, "input_tokens") ??
    summary?.input_tokens ??
    null;
  const outputTokens =
    readNumber(usageSpan?.attributes ?? {}, "output_tokens") ??
    summary?.output_tokens ??
    null;
  if (inputTokens == null && outputTokens == null) {
    return null;
  }
  return `${formatCount(inputTokens ?? 0)} in / ${formatCount(outputTokens ?? 0)} out`;
}

function rowKindForSpan(span: TraceSpan, events: TraceEvent[]): ExecutionTranscriptRowKind {
  if (span.status === "failed" || span.kind === "error" || events.some((event) => event.kind === "error")) {
    return "error";
  }
  if (events.some(isFileEvent)) {
    return "file";
  }
  if (span.kind === "tool_call") {
    return "tool";
  }
  return "system";
}

function rowKindForEvent(event: TraceEvent): ExecutionTranscriptRowKind {
  if (event.kind === "error") {
    return "error";
  }
  if (isFileEvent(event)) {
    return "file";
  }
  return event.message === "Model session started" ? "session" : "system";
}

function spanBody(span: TraceSpan, events: TraceEvent[]): string {
  if (span.kind === "tool_call") {
    return firstText(
      readString(span.attributes, "tool_subject"),
      readString(span.attributes, "command"),
      readString(span.attributes, "query"),
      readString(span.attributes, "url"),
      readString(span.attributes, "path"),
      readString(span.attributes, "pattern"),
      readString(span.attributes, "tool_input_preview"),
      latestMeaningfulEventMessage(span, events),
      readString(span.attributes, "tool_operation"),
      span.title,
    );
  }
  return firstText(
    latestMeaningfulEventMessage(span, events),
    readString(span.attributes, "message"),
    readString(span.attributes, "error_message"),
    readString(span.attributes, "command"),
    span.title,
  );
}

function spanDetail(span: TraceSpan, body: string): string | null {
  return secondaryText(
    body,
    readString(span.attributes, "cwd") ? `cwd ${readString(span.attributes, "cwd")}` : null,
    readString(span.attributes, "result_preview"),
    readString(span.attributes, "error_message"),
  );
}

function eventDetail(event: TraceEvent, body: string): string | null {
  return secondaryText(
    body,
    readString(event.attributes, "provider"),
    readString(event.attributes, "model"),
    readString(event.attributes, "cwd") ? `cwd ${readString(event.attributes, "cwd")}` : null,
    readString(event.attributes, "path"),
    readString(event.attributes, "query"),
    readString(event.attributes, "url"),
  );
}

function latestMeaningfulEventMessage(
  span: TraceSpan,
  events: TraceEvent[],
): string | null {
  for (const event of [...events].sort(compareEvents).reverse()) {
    if (
      event.kind === "usage" ||
      event.kind === "status" ||
      event.message === `${span.title} started` ||
      event.message === `${span.title} completed`
    ) {
      continue;
    }
    return event.message;
  }
  return null;
}

function shouldRenderSpan(span: TraceSpan): boolean {
  if (span.kind === "hook") {
    return span.stage_id !== null || span.status !== "completed";
  }
  if (span.kind === "gate") {
    return !isAcceptedGate(span);
  }
  return true;
}

function shouldRenderEvent(event: TraceEvent): boolean {
  if (event.kind === "usage" || event.kind === "output" || event.kind === "status") {
    return false;
  }
  return ![
    "Model turn started",
    "Model turn completed",
    "Task started",
    "Task completed",
  ].includes(event.message);
}

function isAcceptedGate(span: TraceSpan): boolean {
  const decision = readString(span.attributes, "decision")?.toLowerCase();
  return span.kind === "gate" && (
    decision === "accepted" ||
    (decision == null && span.status === "completed" && span.title.toLowerCase().includes("accepted"))
  );
}

function isFileEvent(event: TraceEvent): boolean {
  return (
    readStringArray(event.attributes, "paths").length > 0 ||
    typeof event.attributes.change_count === "number"
  );
}

function toolLabel(span: TraceSpan): string {
  const toolName = readString(span.attributes, "tool_name");
  if (toolName === "shell") {
    return "Bash";
  }
  return firstText(
    formatToolText(readString(span.attributes, "tool_operation")),
    formatToolText(readString(span.attributes, "tool_raw_name")),
    formatToolText(toolName ?? stripToolPrefix(span.title)),
    "Tool",
  );
}

function toneForRow(
  kind: ExecutionTranscriptRowKind,
  status: TraceSpan["status"] | null,
): BadgeTone {
  if (kind === "error") {
    return "destructive";
  }
  return status === "warning" ? "warning" : ROW_TONE_BY_KIND[kind];
}

function rowKindOrder(kind: ExecutionTranscriptRowKind): number {
  if (kind === "user") {
    return 0;
  }
  return kind === "assistant" ? 3 : 2;
}

function stageTitle(bucket: StageBucket): string {
  if (!bucket.stageId) {
    return "Execution activity";
  }
  const label = capitalize(formatLabel(bucket.stageId));
  return bucket.stageRunIndex == null
    ? label
    : `${label} · pass ${bucket.stageRunIndex + 1}`;
}

function bucketStartedAt(bucket: StageBucket): string {
  return (
    bucket.summary?.started_at ??
    bucket.spans[0]?.started_at ??
    bucket.events[0]?.at ??
    new Date(0).toISOString()
  );
}

function bucketDurationMs(
  bucket: StageBucket,
  rows: ExecutionTranscriptRow[],
): number {
  if (bucket.summary?.duration_ms != null) {
    return bucket.summary.duration_ms;
  }
  const startedAt = bucketStartedAt(bucket);
  const endedAt =
    bucket.summary?.ended_at ??
    bucket.spans
      .map((span) => span.ended_at ?? span.started_at)
      .sort()
      .at(-1) ??
    rows.at(-1)?.at ??
    startedAt;
  return durationBetween(startedAt, endedAt);
}

function dominantStatus(spans: TraceSpan[]): TraceSpan["status"] {
  return spans.reduce<TraceSpan["status"]>(
    (current, span) => STATUS_RANK[span.status] > STATUS_RANK[current] ? span.status : current,
    "completed",
  );
}

function spanDuration(span: TraceSpan): number | null {
  return span.ended_at ? durationBetween(span.started_at, span.ended_at) : null;
}

function durationBetween(startedAt: string, endedAt: string): number {
  const duration = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(duration) ? Math.max(duration, 0) : 0;
}

function stageKey(stageId: string | null, stageRunIndex: number | null): string {
  return `${stageId ?? "attempt"}:${stageRunIndex ?? "none"}`;
}

function inferLatestAttemptNumber(trace: ExecutionTrace): number | null {
  const attempts = [
    ...trace.spans.map((span) => span.attempt_number),
    ...trace.events.map((event) => event.attempt_number),
    ...trace.summaries.map((summary) => summary.attempt_number),
  ].filter(Number.isFinite);
  return attempts.length > 0 ? Math.max(...attempts) : null;
}

function filterAttempt<T extends { attempt_number: number }>(
  values: T[],
  attemptNumber: number | null,
): T[] {
  return attemptNumber == null
    ? values
    : values.filter((value) => value.attempt_number === attemptNumber);
}

function groupBy<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    grouped.set(key, [...(grouped.get(key) ?? []), value]);
  }
  return grouped;
}

function compareSpans(left: TraceSpan, right: TraceSpan): number {
  return left.started_at.localeCompare(right.started_at) || left.id.localeCompare(right.id);
}

function compareEvents(left: TraceEvent, right: TraceEvent): number {
  return left.at.localeCompare(right.at) || left.id.localeCompare(right.id);
}

function compareSummaries(left: TraceSummary, right: TraceSummary): number {
  return left.started_at.localeCompare(right.started_at) ||
    stageKey(left.stage_id, left.stage_run_index).localeCompare(stageKey(right.stage_id, right.stage_run_index));
}

function readString(
  attributes: Record<string, JsonValue>,
  key: string,
): string | null {
  const value = attributes[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(
  attributes: Record<string, JsonValue>,
  key: string,
): number | null {
  const value = attributes[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(
  attributes: Record<string, JsonValue>,
  key: string,
): string[] {
  const value = attributes[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function firstLine(value: string): string {
  return value.split(/\r\n|\n|\r/u).map((line) => line.trim()).find(Boolean) ?? value;
}

function firstText(...values: Array<string | null | undefined>): string {
  return values.map((value) => value?.trim()).find(Boolean) ?? "";
}

function secondaryText(
  primary: string | null | undefined,
  ...values: Array<string | null | undefined>
): string | null {
  const normalizedPrimary = primary?.trim() ?? "";
  return values.map((value) => value?.trim()).find((value) => value && value !== normalizedPrimary) ?? null;
}

function bodyLooksCodeLike(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^(\$ |mkdir\b|cat\b|git\b|pnpm\b|npm\b|node\b|python\b|printf\b|echo\b|cp\b|mv\b|rm\b|find\b|sed\b|awk\b|chmod\b|touch\b|export\b|cd\b)/u.test(trimmed) ||
    trimmed.includes("/") ||
    trimmed.includes("{") ||
    trimmed.includes("}")
  );
}

function stripToolPrefix(value: string): string | null {
  const stripped = value.replace(/^Tool call:\s*/iu, "").trim();
  return stripped || null;
}

function formatToolText(value: string | null): string | null {
  return value ? capitalize(formatLabel(value)) : null;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}
