import type { BadgeTone } from "./badge";

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export type TraceSpanKind =
  | "hook"
  | "stage"
  | "turn"
  | "tool_call"
  | "assistant_output"
  | "usage"
  | "gate"
  | "action"
  | "error";

export type TraceSpanStatus =
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "warning";

export type TraceEventKind =
  | "status"
  | "message"
  | "output"
  | "usage"
  | "error"
  | "note";

export interface TraceSpan {
  id: string;
  parent_id: string | null;
  attempt_number: number;
  stage_id: string | null;
  stage_run_index: number | null;
  kind: TraceSpanKind;
  title: string;
  status: TraceSpanStatus;
  started_at: string;
  ended_at: string | null;
  attributes: Record<string, JsonValue>;
}

export interface TraceEvent {
  id: string;
  span_id: string;
  attempt_number: number;
  stage_id: string | null;
  stage_run_index: number | null;
  kind: TraceEventKind;
  at: string;
  message: string;
  attributes: Record<string, JsonValue>;
}

export interface TraceUsageSummary {
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  uncached_input_tokens: number | null;
  cached_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_output_tokens: number | null;
  total_tokens: number | null;
  total_cost_usd: number | null;
  cost_source: string | null;
  pricing_source: string | null;
}

export interface TraceSummary {
  attempt_number: number;
  stage_id: string | null;
  stage_run_index: number | null;
  status: TraceSpanStatus;
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  tool_call_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  usage?: TraceUsageSummary | null;
  final_output_present: boolean;
  error_message: string | null;
}

export interface ExecutionTrace {
  trace_id: string;
  spans: TraceSpan[];
  events: TraceEvent[];
  summaries: TraceSummary[];
}

export interface ExecutionTraceTimelineInput {
  trace: ExecutionTrace | null | undefined;
  selectedAttemptNumber?: number | null;
}

export type ExecutionTimelineRowKind =
  | "session"
  | "user"
  | "agent"
  | "tool"
  | "write"
  | "note"
  | "error";

export interface ExecutionTimelineUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  label: string;
}

export interface ExecutionTimelineRow {
  id: string;
  anchorId: string;
  stageKey: string;
  turnId: string | null;
  kind: ExecutionTimelineRowKind;
  label: string;
  tone: BadgeTone;
  title: string;
  body: string;
  detail: string | null;
  format: "markdown" | "text";
  monospace: boolean;
  status: TraceSpan["status"] | null;
  at: string;
  durationMs: number | null;
  usage: ExecutionTimelineUsage | null;
  live: boolean;
}

export interface ExecutionTimelineGroup {
  id: string;
  title: string;
  status: TraceSpan["status"] | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  rowCount: number;
  defaultExpanded: boolean;
  rows: ExecutionTimelineRow[];
}

export interface ExecutionStageMapSegment {
  id: string;
  targetRowId: string;
  label: string;
  tone: BadgeTone;
  startedAt: string;
  durationMs: number | null;
  flexWeight: number;
  title: string;
  detail: string | null;
}

export interface ExecutionStageMap {
  id: string;
  title: string;
  status: TraceSpan["status"] | null;
  durationMs: number;
  defaultExpanded: boolean;
  segments: ExecutionStageMapSegment[];
}

export interface ExecutionTimeline {
  groups: ExecutionTimelineGroup[];
  stageMaps: ExecutionStageMap[];
}

interface StageContext {
  key: string;
  stageId: string | null;
  title: string;
  status: TraceSpan["status"] | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
}

interface SortableTimelineRow {
  row: ExecutionTimelineRow;
  sortAt: string;
  kindOrder: number;
  sortOrder: number;
}

interface OutputTimeline {
  finalText: string | null;
  finalAt: string | null;
  outputDurationMs: number | null;
  liveText: string | null;
  liveAt: string | null;
  liveDurationMs: number | null;
}

const STEP_MAP_MIN_WEIGHT = 1.25;
const STEP_MAP_MAX_WEIGHT = 24;

export function capitalize(value: string): string {
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

export function truncateLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

export function buildExecutionTraceTimeline(
  input: ExecutionTraceTimelineInput | null | undefined,
): ExecutionTimeline {
  if (!input?.trace) {
    return { groups: [], stageMaps: [] };
  }

  const attemptNumber =
    input.selectedAttemptNumber ?? inferLatestAttemptNumber(input.trace);
  const trace = input.trace;
  const spans = (trace.spans ?? [])
    .filter((span) =>
      attemptNumber == null ? true : span.attempt_number === attemptNumber,
    )
    .sort(
      (left, right) =>
        left.started_at.localeCompare(right.started_at) ||
        left.id.localeCompare(right.id),
    );
  const summaries = (trace.summaries ?? [])
    .filter((summary) =>
      attemptNumber == null ? true : summary.attempt_number === attemptNumber,
    )
    .sort(
      (left, right) =>
        left.started_at.localeCompare(right.started_at) ||
        stageKey(left.stage_id, left.stage_run_index).localeCompare(
          stageKey(right.stage_id, right.stage_run_index),
        ),
    );
  const events = (trace.events ?? [])
    .filter((event) =>
      attemptNumber == null ? true : event.attempt_number === attemptNumber,
    )
    .sort((left, right) => left.at.localeCompare(right.at));
  const spansByGroup = new Map<string, TraceSpan[]>();
  for (const span of spans) {
    const key = stageKey(span.stage_id, span.stage_run_index);
    const current = spansByGroup.get(key) ?? [];
    current.push(span);
    spansByGroup.set(key, current);
  }

  const summariesByGroup = new Map<string, TraceSummary>();
  for (const summary of summaries) {
    summariesByGroup.set(
      stageKey(summary.stage_id, summary.stage_run_index),
      summary,
    );
  }

  const groupOrder = stableUnique(
    [
      ...summaries.map((summary) =>
        stageKey(summary.stage_id, summary.stage_run_index),
      ),
      ...spans.map((span) => stageKey(span.stage_id, span.stage_run_index)),
    ].sort((left, right) => {
      const leftSummary = summariesByGroup.get(left) ?? null;
      const rightSummary = summariesByGroup.get(right) ?? null;
      const leftStart =
        leftSummary?.started_at ??
        spansByGroup.get(left)?.[0]?.started_at ??
        new Date(0).toISOString();
      const rightStart =
        rightSummary?.started_at ??
        spansByGroup.get(right)?.[0]?.started_at ??
        new Date(0).toISOString();
      return leftStart.localeCompare(rightStart) || left.localeCompare(right);
    }),
  );

  const groups: ExecutionTimelineGroup[] = [];
  const stageMaps: ExecutionStageMap[] = [];

  for (const key of groupOrder) {
    const groupSpans = spansByGroup.get(key) ?? [];
    const summary = summariesByGroup.get(key) ?? null;
    const stage = buildStageContext(key, groupSpans, summary);
    if (stage.stageId == null) {
      continue;
    }
    const turnSpans = groupSpans
      .filter((span) => span.kind === "turn")
      .sort((left, right) => left.started_at.localeCompare(right.started_at));
    const turnIds = new Set(turnSpans.map((span) => span.id));
    const stageSpanIds = new Set(
      groupSpans.filter((span) => span.kind === "stage").map((span) => span.id),
    );
    const childSpansByParentId = new Map<string, TraceSpan[]>();
    for (const span of groupSpans) {
      if (!span.parent_id) {
        continue;
      }
      const current = childSpansByParentId.get(span.parent_id) ?? [];
      current.push(span);
      childSpansByParentId.set(span.parent_id, current);
    }

    const handledEventIds = new Set<string>();
    const rows: SortableTimelineRow[] = [];
    let nextSortOrder = 0;

    for (const turnSpan of turnSpans) {
      const turnRows = buildTurnRows({
        stage,
        turnSpan,
        childSpans: childSpansByParentId.get(turnSpan.id) ?? [],
        events,
        handledEventIds,
        summary: turnSpans.length === 1 ? summary : null,
        nextSortOrder,
      });
      nextSortOrder = turnRows.nextSortOrder;
      rows.push(...turnRows.rows);
    }

    const detachedSpans = groupSpans
      .filter((span) => span.kind !== "stage" && span.kind !== "turn")
      .filter((span) => {
        if (!span.parent_id) {
          return true;
        }
        return !turnIds.has(span.parent_id);
      })
      .sort((left, right) => left.started_at.localeCompare(right.started_at));

    for (const span of detachedSpans) {
      if (span.kind === "assistant_output" || span.kind === "usage") {
        continue;
      }
      if (!shouldRenderTimelineSpan(span)) {
        continue;
      }
      const detachedRows = buildSpanRows({
        stage,
        span,
        turnId: null,
        events,
        handledEventIds,
        nextSortOrder,
      });
      nextSortOrder = detachedRows.nextSortOrder;
      rows.push(...detachedRows.rows);
    }

    const stageEventRows = buildEventRows({
      stage,
      turnId: null,
      handledEventIds,
      nextSortOrder,
      events: events
        .filter((event) => !handledEventIds.has(event.id))
        .filter((event) => !isOutputLikeEvent(event))
        .filter((event) => stageSpanIds.has(event.span_id))
        .sort((left, right) => left.at.localeCompare(right.at)),
    });
    nextSortOrder = stageEventRows.nextSortOrder;
    rows.push(...stageEventRows.rows);

    const orderedRows = rows
      .sort(
        (left, right) =>
          left.sortAt.localeCompare(right.sortAt) ||
          left.kindOrder - right.kindOrder ||
          left.sortOrder - right.sortOrder,
      )
      .map((entry) => entry.row);

    const finalizedRows =
      orderedRows.length > 0 ? orderedRows : [createEmptyStageRow(stage)];
    attachDetachedUsage(finalizedRows, detachedSpans, summary);
    const groupDurationMs =
      stage.durationMs ?? deriveGroupDurationFromRows(finalizedRows);
    const groupStartedAt =
      stage.startedAt ?? finalizedRows[0]?.at ?? new Date(0).toISOString();
    const groupEndedAt =
      stage.endedAt ?? finalizedRows.at(-1)?.at ?? finalizedRows[0]?.at ?? null;

    groups.push({
      id: stage.key,
      title: stage.title,
      status: stage.status,
      startedAt: groupStartedAt,
      endedAt: groupEndedAt,
      durationMs: groupDurationMs,
      rowCount: finalizedRows.length,
      defaultExpanded: true,
      rows: finalizedRows,
    });
    stageMaps.push({
      id: stage.key,
      title: stage.title,
      status: stage.status,
      durationMs: groupDurationMs,
      defaultExpanded: true,
      segments: buildStageMapSegments(finalizedRows, groupEndedAt),
    });
  }

  return { groups, stageMaps };
}

function buildTurnRows(args: {
  stage: StageContext;
  turnSpan: TraceSpan;
  childSpans: TraceSpan[];
  events: TraceEvent[];
  handledEventIds: Set<string>;
  summary: TraceSummary | null;
  nextSortOrder: number;
}): { rows: SortableTimelineRow[]; nextSortOrder: number } {
  const rows: SortableTimelineRow[] = [];
  let nextSortOrder = args.nextSortOrder;
  const prompt = readStringAttribute(args.turnSpan.attributes, "prompt_text");
  const promptFormat = readPromptFormat(args.turnSpan.attributes);

  if (prompt) {
    const promptRow = createRow({
      id: `${args.turnSpan.id}:prompt`,
      stage: args.stage,
      turnId: args.turnSpan.id,
      kind: "user",
      label: "User",
      tone: "outline",
      title: truncateLabel(firstLine(prompt), 64),
      body: prompt,
      detail: null,
      format: promptFormat,
      monospace: promptFormat === "text" && looksLikeCommandTranscript(prompt),
      status: null,
      at: args.turnSpan.started_at,
      durationMs: null,
      usage: null,
      live: false,
    });
    rows.push({
      row: promptRow,
      sortAt: promptRow.at,
      kindOrder: rowKindOrder(promptRow.kind),
      sortOrder: nextSortOrder++,
    });
  }

  const outputTimeline = buildOutputTimeline({
    childSpans: args.childSpans,
    events: args.events,
  });

  const processSpans = args.childSpans
    .filter(
      (span) =>
        span.kind !== "assistant_output" &&
        span.kind !== "usage" &&
        shouldRenderTimelineSpan(span),
    )
    .sort((left, right) => left.started_at.localeCompare(right.started_at));

  for (const span of processSpans) {
    const spanRows = buildSpanRows({
      stage: args.stage,
      span,
      turnId: args.turnSpan.id,
      events: args.events,
      handledEventIds: args.handledEventIds,
      nextSortOrder,
    });
    nextSortOrder = spanRows.nextSortOrder;
    rows.push(...spanRows.rows);
  }

  const turnEventRows = buildEventRows({
    stage: args.stage,
    turnId: args.turnSpan.id,
    handledEventIds: args.handledEventIds,
    nextSortOrder,
    events: selectTimelineEventsForSpan({
      events: args.events,
      spanId: args.turnSpan.id,
      suppressTurnLifecycle: true,
    }),
  });
  nextSortOrder = turnEventRows.nextSortOrder;
  rows.push(...turnEventRows.rows);

  const assistantRow =
    outputTimeline.finalText != null
      ? createRow({
          id: `${args.turnSpan.id}:assistant`,
          stage: args.stage,
          turnId: args.turnSpan.id,
          kind: "agent",
          label: "Agent",
          tone: "accent",
          title: truncateLabel(firstLine(outputTimeline.finalText), 64),
          body: outputTimeline.finalText,
          detail: null,
          format: "markdown",
          monospace: false,
          status: args.turnSpan.status,
          at:
            outputTimeline.finalAt ??
            args.turnSpan.ended_at ??
            args.turnSpan.started_at,
          durationMs: outputTimeline.outputDurationMs,
          usage: null,
          live: false,
        })
      : outputTimeline.liveText != null
        ? createRow({
            id: `${args.turnSpan.id}:draft`,
            stage: args.stage,
            turnId: args.turnSpan.id,
            kind: "agent",
            label: "Agent",
            tone: "accent",
            title: truncateLabel(firstLine(outputTimeline.liveText), 64),
            body: outputTimeline.liveText,
            detail: null,
            format: "markdown",
            monospace: false,
            status: args.turnSpan.status,
            at: outputTimeline.liveAt ?? args.turnSpan.started_at,
            durationMs: outputTimeline.liveDurationMs,
            usage: null,
            live: true,
          })
        : null;

  if (assistantRow) {
    rows.push({
      row: assistantRow,
      sortAt: assistantRow.at,
      kindOrder: rowKindOrder(assistantRow.kind),
      sortOrder: nextSortOrder++,
    });
  }

  const usage = buildUsageInfo(
    args.childSpans.filter((span) => span.kind === "usage"),
    args.summary,
  );
  if (usage) {
    const turnRows = rows
      .map((entry) => entry.row)
      .filter((row) => row.turnId === args.turnSpan.id);
    const usageTarget =
      [...turnRows].reverse().find((row) => row.kind === "agent") ??
      turnRows.at(-1) ??
      null;
    if (usageTarget) {
      usageTarget.usage = usage;
    }
  }

  return { rows, nextSortOrder };
}

function buildSpanRows(args: {
  stage: StageContext;
  span: TraceSpan;
  turnId: string | null;
  events: TraceEvent[];
  handledEventIds: Set<string>;
  nextSortOrder: number;
}): { rows: SortableTimelineRow[]; nextSortOrder: number } {
  const rows: SortableTimelineRow[] = [];
  let nextSortOrder = appendSortableRow(
    rows,
    buildSpanRow(args.span, args.events, args.stage, args.turnId),
    args.nextSortOrder,
  );

  const spanEventRows = buildEventRows({
    stage: args.stage,
    turnId: args.turnId,
    handledEventIds: args.handledEventIds,
    nextSortOrder,
    events: selectTimelineEventsForSpan({
      events: args.events,
      spanId: args.span.id,
      suppressTurnLifecycle: false,
    }),
  });
  nextSortOrder = spanEventRows.nextSortOrder;
  rows.push(...spanEventRows.rows);

  return { rows, nextSortOrder };
}

function buildEventRows(args: {
  stage: StageContext;
  turnId: string | null;
  events: TraceEvent[];
  handledEventIds: Set<string>;
  nextSortOrder: number;
}): { rows: SortableTimelineRow[]; nextSortOrder: number } {
  const rows: SortableTimelineRow[] = [];
  let nextSortOrder = args.nextSortOrder;

  for (const event of args.events) {
    args.handledEventIds.add(event.id);
    nextSortOrder = appendSortableRow(
      rows,
      buildEventRow(event, args.stage, args.turnId),
      nextSortOrder,
    );
  }

  return { rows, nextSortOrder };
}

function appendSortableRow(
  rows: SortableTimelineRow[],
  row: ExecutionTimelineRow,
  sortOrder: number,
): number {
  rows.push({
    row,
    sortAt: row.at,
    kindOrder: rowKindOrder(row.kind),
    sortOrder,
  });
  return sortOrder + 1;
}

function selectTimelineEventsForSpan(args: {
  events: TraceEvent[];
  spanId: string;
  suppressTurnLifecycle: boolean;
}): TraceEvent[] {
  return args.events
    .filter((event) => event.span_id === args.spanId)
    .filter((event) => !isOutputLikeEvent(event))
    .filter(
      (event) => !args.suppressTurnLifecycle || !isSuppressedTurnEvent(event),
    )
    .sort((left, right) => left.at.localeCompare(right.at));
}

function buildOutputTimeline(args: {
  childSpans: TraceSpan[];
  events: TraceEvent[];
}): OutputTimeline {
  const outputSpans = args.childSpans
    .filter((span) => span.kind === "assistant_output")
    .sort((left, right) => left.started_at.localeCompare(right.started_at));
  const latestOutputSpan = outputSpans.at(-1) ?? null;
  if (!latestOutputSpan) {
    return {
      finalText: null,
      finalAt: null,
      outputDurationMs: null,
      liveText: null,
      liveAt: null,
      liveDurationMs: null,
    };
  }

  const outputEvents = args.events
    .filter(
      (event) =>
        event.span_id === latestOutputSpan.id && event.kind === "output",
    )
    .sort((left, right) => left.at.localeCompare(right.at));

  let finalText: string | null = null;
  let finalAt: string | null = null;
  let liveText: string | null = null;
  let liveAt: string | null = null;
  let cumulative = "";

  for (const event of outputEvents) {
    const deltaText = readStringAttribute(event.attributes, "delta_text");
    if (deltaText) {
      cumulative += deltaText;
      const trimmed = cumulative.trim();
      if (trimmed) {
        liveText = trimmed;
        liveAt = event.at;
      }
    }

    const outputText = readStringAttribute(event.attributes, "output_text");
    if (outputText) {
      finalText = outputText.trim() || null;
      finalAt = event.at;
    }
  }

  return {
    finalText,
    finalAt,
    outputDurationMs: durationBetween(
      latestOutputSpan.started_at,
      latestOutputSpan.ended_at ?? latestOutputSpan.started_at,
    ),
    liveText: finalText ? null : liveText,
    liveAt: finalText ? null : liveAt,
    liveDurationMs:
      latestOutputSpan.status === "running"
        ? durationBetween(
            latestOutputSpan.started_at,
            latestOutputSpan.ended_at ?? liveAt ?? latestOutputSpan.started_at,
          )
        : null,
  };
}

function buildSpanRow(
  span: TraceSpan,
  events: TraceEvent[],
  stage: StageContext,
  turnId: string | null,
): ExecutionTimelineRow {
  const relatedEvents = events
    .filter((event) => event.span_id === span.id)
    .sort((left, right) => left.at.localeCompare(right.at));
  const timelineKind = timelineKindForSpan(span, relatedEvents);
  const durationMs =
    span.ended_at != null
      ? durationBetween(span.started_at, span.ended_at)
      : null;
  const summary = summarizeSpan(span, relatedEvents);

  if (span.kind === "tool_call") {
    const toolName =
      readStringAttribute(span.attributes, "tool_name") ??
      stripToolPrefix(span.title) ??
      "tool";
    const rawToolName = readStringAttribute(span.attributes, "tool_raw_name");
    const operation = readStringAttribute(span.attributes, "tool_operation");
    const subject = readStringAttribute(span.attributes, "tool_subject");
    const subjectKind = readStringAttribute(
      span.attributes,
      "tool_subject_kind",
    );
    const toolInputPreview = readStringAttribute(
      span.attributes,
      "tool_input_preview",
    );
    const command = readStringAttribute(span.attributes, "command");
    const query = readStringAttribute(span.attributes, "query");
    const url = readStringAttribute(span.attributes, "url");
    const path = readStringAttribute(span.attributes, "path");
    const pattern = readStringAttribute(span.attributes, "pattern");
    const detail = buildToolDetail(span, summary);
    const body =
      subject ??
      command ??
      query ??
      url ??
      path ??
      pattern ??
      toolInputPreview ??
      summary ??
      formatToolFallback(toolName, rawToolName, operation);
    const label = buildToolLabel(toolName, rawToolName, operation);

    return createRow({
      id: span.id,
      stage,
      turnId,
      kind: timelineKind,
      label,
      tone: timelineKind === "error" ? "destructive" : "secondary",
      title: truncateLabel(span.title, 64),
      body,
      detail: detail === body ? null : detail,
      format: "text",
      monospace:
        toolBodyUsesMonospace(subjectKind, body) ||
        bodyLooksCodeLike(detail ?? ""),
      status: span.status,
      at: span.started_at,
      durationMs,
      usage: null,
      live: false,
    });
  }

  const body = summary ?? span.title;
  const detail = buildSpanDetail(span);

  return createRow({
    id: span.id,
    stage,
    turnId,
    kind: timelineKind,
    label: rowLabelForKind(timelineKind),
    tone: toneForRowKind(timelineKind, span.status),
    title: truncateLabel(span.title, 64),
    body,
    detail: detail === body ? null : detail,
    format: "text",
    monospace: bodyLooksCodeLike(body) || bodyLooksCodeLike(detail ?? ""),
    status: span.status,
    at: span.started_at,
    durationMs,
    usage: null,
    live: false,
  });
}

function buildEventRow(
  event: TraceEvent,
  stage: StageContext,
  turnId: string | null,
): ExecutionTimelineRow {
  const timelineKind = timelineKindForEvent(event);
  const writePaths = readStringArray(event.attributes, "paths");
  const isWrite = timelineKind === "write";
  const body =
    isWrite && writePaths.length > 0
      ? writePaths.slice(0, 3).join("\n")
      : event.message;
  const detail = isWrite
    ? secondaryText(body, event.message, buildEventAttributeSummary(event))
    : buildEventDetail(event);

  return createRow({
    id: event.id,
    stage,
    turnId,
    kind: timelineKind,
    label: rowLabelForKind(timelineKind),
    tone: toneForRowKind(
      timelineKind,
      timelineKind === "error" ? "failed" : null,
    ),
    title: truncateLabel(firstLine(event.message), 64),
    body,
    detail: detail === body ? null : detail,
    format: "text",
    monospace:
      isWrite || bodyLooksCodeLike(body) || bodyLooksCodeLike(detail ?? ""),
    status: timelineKind === "error" ? "failed" : null,
    at: event.at,
    durationMs: null,
    usage: null,
    live: false,
  });
}

function buildStageMapSegments(
  rows: ExecutionTimelineRow[],
  stageEndedAt: string | null,
): ExecutionStageMapSegment[] {
  return rows.map((row, index) => {
    const nextRow = rows[index + 1] ?? null;
    const derivedDurationMs =
      row.durationMs ??
      deriveSegmentDuration(row.at, nextRow?.at ?? stageEndedAt ?? null);
    const detailParts = [row.detail, row.usage?.label].filter(
      (value): value is string => Boolean(value),
    );

    return {
      id: `${row.id}:segment`,
      targetRowId: row.anchorId,
      label: row.label,
      tone: toneForStageSegment(row),
      startedAt: row.at,
      durationMs: derivedDurationMs,
      flexWeight: durationToWeight(derivedDurationMs),
      title: row.title,
      detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
    };
  });
}

function attachDetachedUsage(
  rows: ExecutionTimelineRow[],
  detachedSpans: TraceSpan[],
  summary: TraceSummary | null,
): void {
  if (rows.length === 0) {
    return;
  }
  const usage = buildUsageInfo(
    detachedSpans.filter((span) => span.kind === "usage"),
    summary,
  );
  if (!usage) {
    return;
  }
  rows[rows.length - 1]!.usage = rows[rows.length - 1]!.usage ?? usage;
}

function buildUsageInfo(
  usageSpans: TraceSpan[],
  summary: TraceSummary | null,
): ExecutionTimelineUsage | null {
  const latestUsageSpan = usageSpans.at(-1) ?? null;
  const inputTokens =
    readNumberAttribute(latestUsageSpan?.attributes ?? {}, "input_tokens") ??
    summary?.input_tokens ??
    null;
  const outputTokens =
    readNumberAttribute(latestUsageSpan?.attributes ?? {}, "output_tokens") ??
    summary?.output_tokens ??
    null;
  if (inputTokens == null && outputTokens == null) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    label: `${formatCount(inputTokens ?? 0)} in / ${formatCount(outputTokens ?? 0)} out`,
  };
}

function buildStageContext(
  key: string,
  spans: TraceSpan[],
  summary: TraceSummary | null,
): StageContext {
  const startedAt =
    summary?.started_at ?? spans[0]?.started_at ?? new Date(0).toISOString();
  const endedAt =
    summary?.ended_at ??
    spans
      .map((span) => span.ended_at ?? span.started_at)
      .sort((left, right) => left.localeCompare(right))
      .at(-1) ??
    null;
  const durationMs =
    summary?.duration_ms ?? (endedAt ? durationBetween(startedAt, endedAt) : 0);

  return {
    key,
    stageId: summary?.stage_id ?? spans[0]?.stage_id ?? null,
    title: formatStageTitle(
      summary?.stage_id ?? spans[0]?.stage_id ?? null,
      summary?.stage_run_index ?? spans[0]?.stage_run_index ?? null,
    ),
    status: summary?.status ?? dominantGroupStatus(spans),
    startedAt,
    endedAt,
    durationMs,
  };
}

function createEmptyStageRow(stage: StageContext): ExecutionTimelineRow {
  return createRow({
    id: `${stage.key}:empty`,
    stage,
    turnId: null,
    kind: "note",
    label: "Note",
    tone: "outline",
    title: "No step evidence recorded",
    body: "No step evidence recorded for this stage.",
    detail: null,
    format: "text",
    monospace: false,
    status: null,
    at: stage.startedAt,
    durationMs: stage.durationMs || null,
    usage: null,
    live: false,
  });
}

function createRow(args: {
  id: string;
  stage: StageContext;
  turnId: string | null;
  kind: ExecutionTimelineRowKind;
  label: string;
  tone: BadgeTone;
  title: string;
  body: string;
  detail: string | null;
  format: "markdown" | "text";
  monospace: boolean;
  status: TraceSpan["status"] | null;
  at: string;
  durationMs: number | null;
  usage: ExecutionTimelineUsage | null;
  live: boolean;
}): ExecutionTimelineRow {
  return {
    id: args.id,
    anchorId: `timeline-row-${sanitizeId(args.id)}`,
    stageKey: args.stage.key,
    turnId: args.turnId,
    kind: args.kind,
    label: args.label,
    tone: args.tone,
    title: args.title,
    body: args.body,
    detail: args.detail,
    format: args.format,
    monospace: args.monospace,
    status: args.status,
    at: args.at,
    durationMs: args.durationMs,
    usage: args.usage,
    live: args.live,
  };
}

function timelineKindForSpan(
  span: TraceSpan,
  events: TraceEvent[] | null,
): ExecutionTimelineRowKind {
  if (span.kind === "tool_call") {
    return span.status === "failed" ? "error" : "tool";
  }
  if (span.kind === "error") {
    return "error";
  }
  if (span.kind === "gate" && span.status === "warning") {
    return "note";
  }
  if (events?.some(isWriteEvent) ?? false) {
    return "write";
  }
  return span.status === "failed" ? "error" : "note";
}

function timelineKindForEvent(event: TraceEvent): ExecutionTimelineRowKind {
  if (isWriteEvent(event)) {
    return "write";
  }
  if (event.kind === "error") {
    return "error";
  }
  if (event.message === "Model session started") {
    return "session";
  }
  return "note";
}

function shouldRenderTimelineSpan(span: TraceSpan): boolean {
  if (span.kind === "hook") {
    return span.stage_id !== null || span.status !== "completed";
  }
  if (span.kind === "gate") {
    return !isAcceptedGateSpan(span);
  }
  return true;
}

function isAcceptedGateSpan(span: TraceSpan): boolean {
  if (span.kind !== "gate") {
    return false;
  }
  const decision = readStringAttribute(
    span.attributes,
    "decision",
  )?.toLowerCase();
  if (decision) {
    return decision === "accepted";
  }
  return (
    span.status === "completed" && span.title.toLowerCase().includes("accepted")
  );
}

function isSuppressedTurnEvent(event: TraceEvent): boolean {
  if (event.kind === "status") {
    return true;
  }
  return (
    event.message === "Model turn started" ||
    event.message === "Model turn completed" ||
    event.message === "Task started" ||
    event.message === "Task completed"
  );
}

function isOutputLikeEvent(event: TraceEvent): boolean {
  return (
    event.kind === "output" || event.kind === "usage" || event.kind === "status"
  );
}

function isWriteEvent(event: TraceEvent): boolean {
  return (
    readStringArray(event.attributes, "paths").length > 0 ||
    typeof event.attributes.change_count === "number"
  );
}

function buildSpanDetail(span: TraceSpan): string | null {
  return secondaryText(
    span.title,
    readStringAttribute(span.attributes, "tool_subject"),
    readStringAttribute(span.attributes, "command"),
    readStringAttribute(span.attributes, "query"),
    readStringAttribute(span.attributes, "url"),
    readStringAttribute(span.attributes, "path"),
    readStringAttribute(span.attributes, "pattern"),
    readStringAttribute(span.attributes, "message"),
    readStringAttribute(span.attributes, "error_message"),
  );
}

function buildToolDetail(
  span: TraceSpan,
  summary: string | null,
): string | null {
  const command = readStringAttribute(span.attributes, "command");
  const query = readStringAttribute(span.attributes, "query");
  const url = readStringAttribute(span.attributes, "url");
  const path = readStringAttribute(span.attributes, "path");
  const pattern = readStringAttribute(span.attributes, "pattern");
  const subject = readStringAttribute(span.attributes, "tool_subject");
  const cwd = readStringAttribute(span.attributes, "cwd");
  const resultPreview = readStringAttribute(span.attributes, "result_preview");
  const toolInputPreview = readStringAttribute(
    span.attributes,
    "tool_input_preview",
  );
  const descriptor = buildToolDescriptor(
    readStringAttribute(span.attributes, "tool_name"),
    readStringAttribute(span.attributes, "tool_raw_name"),
    readStringAttribute(span.attributes, "tool_operation"),
  );

  return secondaryText(
    subject ?? command ?? query ?? url ?? path ?? pattern,
    descriptor,
    cwd ? `cwd ${cwd}` : null,
    toolInputPreview,
    summary,
    resultPreview,
  );
}

function buildEventDetail(event: TraceEvent): string | null {
  if (event.message === "Model session started") {
    const detail = [
      readStringAttribute(event.attributes, "provider"),
      readStringAttribute(event.attributes, "model"),
    ].filter((value): value is string => Boolean(value));
    return detail.length > 0 ? detail.join(" · ") : null;
  }
  return buildEventAttributeSummary(event);
}

function buildEventAttributeSummary(event: TraceEvent): string | null {
  const parts: string[] = [];
  const provider = readStringAttribute(event.attributes, "provider");
  if (provider) {
    parts.push(provider);
  }
  const model = readStringAttribute(event.attributes, "model");
  if (model) {
    parts.push(model);
  }
  const cwd = readStringAttribute(event.attributes, "cwd");
  if (cwd) {
    parts.push(`cwd ${cwd}`);
  }
  const path = readStringAttribute(event.attributes, "path");
  if (path) {
    parts.push(path);
  }
  const query = readStringAttribute(event.attributes, "query");
  if (query) {
    parts.push(query);
  }
  const url = readStringAttribute(event.attributes, "url");
  if (url) {
    parts.push(url);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function summarizeSpan(span: TraceSpan, events: TraceEvent[]): string | null {
  if (span.kind === "tool_call") {
    return distinctText(
      readStringAttribute(span.attributes, "tool_subject"),
      readStringAttribute(span.attributes, "command"),
      readStringAttribute(span.attributes, "query"),
      readStringAttribute(span.attributes, "url"),
      readStringAttribute(span.attributes, "path"),
      readStringAttribute(span.attributes, "pattern"),
      readStringAttribute(span.attributes, "tool_input_preview"),
      span.title,
      latestMeaningfulEventMessage(span, events),
      readStringAttribute(span.attributes, "tool_operation"),
      readStringAttribute(span.attributes, "tool_raw_name"),
      readStringAttribute(span.attributes, "tool_name"),
    );
  }
  return distinctText(
    latestMeaningfulEventMessage(span, events),
    readStringAttribute(span.attributes, "message"),
    readStringAttribute(span.attributes, "error_message"),
    readStringAttribute(span.attributes, "command"),
    span.title,
  );
}

function latestMeaningfulEventMessage(
  span: TraceSpan,
  events: TraceEvent[],
): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) {
      continue;
    }
    if (
      event.message === `${span.title} started` ||
      event.message === `${span.title} completed`
    ) {
      continue;
    }
    return event.message;
  }
  return null;
}

function rowLabelForKind(kind: ExecutionTimelineRowKind): string {
  switch (kind) {
    case "session":
      return "Session";
    case "user":
      return "User";
    case "agent":
      return "Agent";
    case "tool":
      return "Tool";
    case "write":
      return "Write";
    case "error":
      return "Error";
    case "note":
      return "Note";
  }
}

function toneForRowKind(
  kind: ExecutionTimelineRowKind,
  status: TraceSpan["status"] | null,
): BadgeTone {
  if (kind === "error") {
    return "destructive";
  }
  if (status === "warning") {
    return "warning";
  }
  switch (kind) {
    case "agent":
      return "accent";
    case "user":
      return "outline";
    case "write":
      return "success";
    case "tool":
      return "secondary";
    case "session":
    case "note":
    default:
      return "outline";
  }
}

function rowKindOrder(kind: ExecutionTimelineRowKind): number {
  switch (kind) {
    case "user":
      return 0;
    case "session":
      return 1;
    case "tool":
    case "write":
    case "note":
    case "error":
      return 2;
    case "agent":
      return 3;
  }
}

function toneForStageSegment(row: ExecutionTimelineRow): BadgeTone {
  switch (row.kind) {
    case "user":
    case "agent":
      return "accent";
    case "tool":
      return "secondary";
    case "write":
      return "success";
    case "error":
      return "destructive";
    case "note":
      return row.status === "warning" ? "warning" : "outline";
    case "session":
    default:
      return "outline";
  }
}

function deriveSegmentDuration(
  currentAt: string,
  nextAt: string | null,
): number | null {
  if (!nextAt) {
    return null;
  }
  const durationMs = durationBetween(currentAt, nextAt);
  return durationMs > 0 ? durationMs : null;
}

function durationToWeight(durationMs: number | null): number {
  if (durationMs == null || durationMs <= 0) {
    return STEP_MAP_MIN_WEIGHT;
  }
  const seconds = durationMs / 1_000;
  return Math.max(STEP_MAP_MIN_WEIGHT, Math.min(seconds, STEP_MAP_MAX_WEIGHT));
}

function deriveGroupDurationFromRows(rows: ExecutionTimelineRow[]): number {
  const firstAt = rows[0]?.at ?? null;
  const lastAt = rows.at(-1)?.at ?? null;
  return firstAt && lastAt ? durationBetween(firstAt, lastAt) : 0;
}

function durationBetween(startedAt: string, endedAt: string): number {
  return Math.max(
    new Date(endedAt).getTime() - new Date(startedAt).getTime(),
    0,
  );
}

function firstLine(value: string): string {
  return (
    value
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? value
  );
}

function bodyLooksCodeLike(value: string): boolean {
  if (!value.trim()) {
    return false;
  }
  return (
    /^(\$ |mkdir\b|cat\b|git\b|pnpm\b|npm\b|node\b|python\b|printf\b|echo\b|cp\b|mv\b|rm\b|find\b|sed\b|awk\b|chmod\b|touch\b|export\b|cd\b)/.test(
      value.trim(),
    ) ||
    value.includes("/") ||
    value.includes("{") ||
    value.includes("}")
  );
}

function looksLikeCommandTranscript(value: string): boolean {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 3) {
    return false;
  }
  let commandLikeLines = 0;
  for (const line of lines) {
    if (
      /^(\$ |mkdir\b|cat\b|git\b|pnpm\b|npm\b|node\b|python\b|printf\b|echo\b|cp\b|mv\b|rm\b|find\b|sed\b|awk\b|chmod\b|touch\b|export\b|cd\b)/.test(
        line,
      ) ||
      /<<['"]?\w+['"]?$/.test(line) ||
      /[|><]{1,2}/.test(line)
    ) {
      commandLikeLines += 1;
    }
  }
  return commandLikeLines >= Math.min(3, lines.length);
}

function stageKey(
  stageId: string | null,
  stageRunIndex: number | null,
): string {
  return `${stageId ?? "attempt"}:${stageRunIndex ?? "none"}`;
}

function formatStageTitle(
  stageId: string | null,
  stageRunIndex: number | null,
): string {
  if (!stageId) {
    return "Execution activity";
  }
  const label = capitalize(formatLabel(stageId));
  return stageRunIndex === null ? label : `${label} · run ${stageRunIndex + 1}`;
}

function dominantGroupStatus(spans: TraceSpan[]): TraceSpan["status"] {
  return spans.reduce<TraceSpan["status"]>((current, span) => {
    return statusRank(span.status) > statusRank(current)
      ? span.status
      : current;
  }, "completed");
}

function statusRank(status: TraceSpan["status"]): number {
  if (status === "failed") return 4;
  if (status === "warning") return 3;
  if (status === "running") return 2;
  if (status === "canceled") return 1;
  return 0;
}

function readStringAttribute(
  attributes: Record<string, JsonValue>,
  key: string,
): string | null {
  const value = attributes[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumberAttribute(
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
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function readPromptFormat(
  attributes: Record<string, JsonValue>,
): "markdown" | "text" {
  return attributes.prompt_format === "markdown" ? "markdown" : "text";
}

function inferLatestAttemptNumber(trace: ExecutionTrace): number | null {
  const attempts = [
    ...trace.spans.map((span) => span.attempt_number),
    ...trace.events.map((event) => event.attempt_number),
    ...trace.summaries.map((summary) => summary.attempt_number),
  ].filter((attempt) => Number.isFinite(attempt));
  return attempts.length > 0 ? Math.max(...attempts) : null;
}

function sanitizeId(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_-]+/g, "-");
}

function stripToolPrefix(value: string): string | null {
  const next = value.replace(/^Tool call:\s*/u, "").trim();
  return next.length > 0 ? next : null;
}

function distinctText(
  ...values: Array<string | null | undefined>
): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    return trimmed;
  }
  return null;
}

function buildToolLabel(
  toolName: string | null,
  rawToolName: string | null,
  operation: string | null,
): string {
  if (toolName === "shell") {
    return "Bash";
  }
  return (
    formatToolText(operation) ??
    formatToolText(rawToolName) ??
    formatToolText(toolName) ??
    "Tool"
  );
}

function formatToolFallback(
  toolName: string | null,
  rawToolName: string | null,
  operation: string | null,
): string {
  return (
    formatToolText(operation) ??
    formatToolText(rawToolName) ??
    formatToolText(toolName) ??
    "Tool"
  );
}

function buildToolDescriptor(
  toolName: string | null,
  rawToolName: string | null,
  operation: string | null,
): string | null {
  if (toolName === "shell") {
    return null;
  }
  const familyLabel = formatToolText(toolName);
  const operationLabel = formatToolText(operation);
  const rawLabel = formatToolText(rawToolName);
  return distinctText(
    familyLabel && operationLabel
      ? `${familyLabel} · ${operationLabel}`
      : familyLabel,
    rawLabel,
  );
}

function formatToolText(value: string | null): string | null {
  return value ? capitalize(formatLabel(value)) : null;
}

function toolBodyUsesMonospace(
  subjectKind: string | null,
  body: string,
): boolean {
  if (
    subjectKind === "command" ||
    subjectKind === "path" ||
    subjectKind === "pattern"
  ) {
    return true;
  }
  return bodyLooksCodeLike(body);
}

function secondaryText(
  primary: string | null | undefined,
  ...candidates: Array<string | null | undefined>
): string | null {
  const normalizedPrimary = primary?.trim() ?? "";
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const trimmed = candidate.trim();
    if (!trimmed || trimmed === normalizedPrimary) {
      continue;
    }
    return trimmed;
  }
  return null;
}

function stableUnique(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

export function describeTimelineStageMeta(
  group: ExecutionTimelineGroup,
): string {
  const parts = [
    `${group.rowCount} ${group.rowCount === 1 ? "step" : "steps"}`,
  ];
  if (group.durationMs > 0) {
    parts.push(formatDuration(group.durationMs));
  }
  return parts.join(" · ");
}
