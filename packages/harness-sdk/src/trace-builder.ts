import type {
  JsonValue,
  TraceEvent,
  TraceEventKind,
  TraceSpan,
  TraceSpanStatus,
  TraceSummary,
} from "@workbench-ai/contracts";

import { createId, nowIso } from "./internal-utils.js";

export interface TraceBundle {
  spans: TraceSpan[];
  events: TraceEvent[];
  summaries: TraceSummary[];
}

interface ActiveToolSpan {
  spanId: string;
  startedAt: string;
  title: string;
  attributes: Record<string, JsonValue>;
}

export class HarnessTraceBuilder {
  private readonly spans: TraceSpan[] = [];
  private readonly events: TraceEvent[] = [];
  private readonly activeToolSpans = new Map<string, ActiveToolSpan>();
  private readonly dirtySpanIds = new Set<string>();
  private turnSpanId: string | null = null;
  private turnStartedAt: string | null = null;
  private outputSpanId: string | null = null;
  private outputStartedAt: string | null = null;
  private usageEventCount = 0;
  private flushedEventCount = 0;

  constructor(
    private readonly args: {
      attemptNumber: number;
      stageId: string;
      stageRunIndex: number;
      stageSpanId: string;
    },
  ) {}

  startTurn(args: {
    at?: string;
    provider?: string | null;
    model?: string | null;
    sessionId?: string | null;
    operationId?: string | null;
    promptText?: string | null;
    attributes?: Record<string, JsonValue>;
  }): void {
    const at = args.at ?? nowIso();
    this.turnSpanId = this.turnSpanId ?? createId("trace_span");
    this.turnStartedAt = this.turnStartedAt ?? at;
    const existing =
      this.turnSpanId != null
        ? this.spans.find((span) => span.id === this.turnSpanId) ?? null
        : null;
    this.upsertSpan(this.turnSpanId, {
      id: this.turnSpanId,
      parent_id: this.args.stageSpanId,
      attempt_number: this.args.attemptNumber,
      stage_id: this.args.stageId,
      stage_run_index: this.args.stageRunIndex,
      kind: "turn",
      title: "Model turn",
      status: "running",
      started_at: this.turnStartedAt,
      ended_at: null,
      attributes: {
        ...(existing?.attributes ?? {}),
        provider: args.provider ?? readTraceString(existing?.attributes, [["provider"]]) ?? null,
        model: args.model ?? readTraceString(existing?.attributes, [["model"]]) ?? null,
        session_id: args.sessionId ?? readTraceString(existing?.attributes, [["session_id"]]) ?? null,
        operation_id: args.operationId ?? readTraceString(existing?.attributes, [["operation_id"]]) ?? null,
        prompt_text: args.promptText ?? readTraceString(existing?.attributes, [["prompt_text"]]) ?? null,
        prompt_format: args.promptText ? "text" : readTraceString(existing?.attributes, [["prompt_format"]]) ?? null,
        prompt_source: args.promptText ? "rendered_stage_prompt" : readTraceString(existing?.attributes, [["prompt_source"]]) ?? null,
        ...(args.attributes ?? {}),
      },
    });
    this.appendEvent(
      createTraceEvent({
        spanId: this.turnSpanId,
        attemptNumber: this.args.attemptNumber,
        stageId: this.args.stageId,
        stageRunIndex: this.args.stageRunIndex,
        kind: "status",
        at,
        message: "Model turn started",
      }),
    );
  }

  completeTurn(args: {
    at?: string;
    status?: string | null;
    provider?: string | null;
    model?: string | null;
    sessionId?: string | null;
    operationId?: string | null;
    errorMessage?: string | null;
    attributes?: Record<string, JsonValue>;
  }): void {
    const at = args.at ?? nowIso();
    const status = normalizeTraceStatus(args.status ?? null);
    const existing =
      this.turnSpanId != null
        ? this.spans.find((span) => span.id === this.turnSpanId) ?? null
        : null;
    if (!this.turnSpanId) {
      this.turnSpanId = createId("trace_span");
      this.turnStartedAt = at;
    }
    this.upsertSpan(this.turnSpanId, {
      id: this.turnSpanId,
      parent_id: this.args.stageSpanId,
      attempt_number: this.args.attemptNumber,
      stage_id: this.args.stageId,
      stage_run_index: this.args.stageRunIndex,
      kind: "turn",
      title: "Model turn",
      status,
      started_at: this.turnStartedAt ?? at,
      ended_at: at,
      attributes: {
        ...(existing?.attributes ?? {}),
        provider: args.provider ?? readTraceString(existing?.attributes, [["provider"]]) ?? null,
        model: args.model ?? readTraceString(existing?.attributes, [["model"]]) ?? null,
        session_id: args.sessionId ?? readTraceString(existing?.attributes, [["session_id"]]) ?? null,
        operation_id: args.operationId ?? readTraceString(existing?.attributes, [["operation_id"]]) ?? null,
        error_message: args.errorMessage ?? null,
        ...(args.attributes ?? {}),
      },
    });
    this.appendEvent(
      createTraceEvent({
        spanId: this.turnSpanId,
        attemptNumber: this.args.attemptNumber,
        stageId: this.args.stageId,
        stageRunIndex: this.args.stageRunIndex,
        kind:
          status === "failed" || status === "canceled" ? "error" : "status",
        at,
        message:
          args.errorMessage ??
          (status === "completed"
            ? "Model turn completed"
            : `Model turn ${status}`),
      }),
    );
  }

  startToolCall(args: {
    at?: string;
    toolId?: string | null;
    toolName?: string | null;
    attributes?: Record<string, JsonValue>;
  }): void {
    const at = args.at ?? nowIso();
    const toolId = args.toolId?.trim() || createId("tool");
    if (this.activeToolSpans.has(toolId)) {
      return;
    }
    const spanId = createId("trace_span");
    const title = `Tool call: ${args.toolName?.trim() || "tool"}`;
    const attributes: Record<string, JsonValue> = {
      tool_name: args.toolName ?? null,
      tool_id: toolId,
      ...(args.attributes ?? {}),
    };
    this.activeToolSpans.set(toolId, {
      spanId,
      startedAt: at,
      title,
      attributes,
    });
    this.spans.push({
      id: spanId,
      parent_id: this.turnSpanId ?? this.args.stageSpanId,
      attempt_number: this.args.attemptNumber,
      stage_id: this.args.stageId,
      stage_run_index: this.args.stageRunIndex,
      kind: "tool_call",
      title,
      status: "running",
      started_at: at,
      ended_at: null,
      attributes,
    });
    this.dirtySpanIds.add(spanId);
    this.appendEvent(
      createTraceEvent({
        spanId,
        attemptNumber: this.args.attemptNumber,
        stageId: this.args.stageId,
        stageRunIndex: this.args.stageRunIndex,
        kind: "status",
        at,
        message: `${title} started`,
        attributes,
      }),
    );
  }

  completeToolCall(args: {
    at?: string;
    toolId?: string | null;
    toolName?: string | null;
    attributes?: Record<string, JsonValue>;
  }): void {
    const at = args.at ?? nowIso();
    const toolId = args.toolId?.trim() || createId("tool");
    if (!this.activeToolSpans.has(toolId)) {
      this.startToolCall({
        at,
        toolId,
        toolName: args.toolName,
        attributes: args.attributes,
      });
    }
    const tool = this.activeToolSpans.get(toolId);
    if (!tool) {
      return;
    }
    this.upsertSpan(tool.spanId, {
      id: tool.spanId,
      parent_id: this.turnSpanId ?? this.args.stageSpanId,
      attempt_number: this.args.attemptNumber,
      stage_id: this.args.stageId,
      stage_run_index: this.args.stageRunIndex,
      kind: "tool_call",
      title: tool.title,
      status: "completed",
      started_at: tool.startedAt,
      ended_at: at,
      attributes: {
        ...tool.attributes,
        ...(args.attributes ?? {}),
      },
    });
    this.appendEvent(
      createTraceEvent({
        spanId: tool.spanId,
        attemptNumber: this.args.attemptNumber,
        stageId: this.args.stageId,
        stageRunIndex: this.args.stageRunIndex,
        kind: "message",
        at,
        message: `${tool.title} completed`,
        attributes: {
          ...tool.attributes,
          ...(args.attributes ?? {}),
        },
      }),
    );
    this.activeToolSpans.delete(toolId);
  }

  startAssistantOutput(args: {
    at?: string;
    phase?: string | null;
    itemId?: string | null;
  }): void {
    this.ensureOutputSpan(args.at ?? nowIso(), {
      phase: args.phase ?? null,
      item_id: args.itemId ?? null,
    });
  }

  appendOutputDelta(args: {
    at?: string;
    delta: string;
    phase?: string | null;
    itemId?: string | null;
  }): void {
    const at = args.at ?? nowIso();
    this.ensureOutputSpan(at, {
      phase: args.phase ?? null,
      item_id: args.itemId ?? null,
    });
    if (!this.outputSpanId || !args.delta) {
      return;
    }
    this.appendEvent(
      createTraceEvent({
        spanId: this.outputSpanId,
        attemptNumber: this.args.attemptNumber,
        stageId: this.args.stageId,
        stageRunIndex: this.args.stageRunIndex,
        kind: "output",
        at,
        message: "Assistant streamed output",
        attributes: {
          delta_text: args.delta,
          delta_length: args.delta.length,
        },
      }),
    );
  }

  completeAssistantOutput(args: {
    at?: string;
    text: string;
    phase?: string | null;
    itemId?: string | null;
  }): void {
    this.completeOutputSpan(args.at ?? nowIso(), args.text, {
      phase: args.phase ?? null,
      item_id: args.itemId ?? null,
    });
  }

  recordUsage(args: {
    at?: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
    attributes?: Record<string, JsonValue>;
  }): void {
    const at = args.at ?? nowIso();
    const spanId = createId("trace_span");
    const usage = {
      input_tokens: args.inputTokens ?? null,
      output_tokens: args.outputTokens ?? null,
      ...(args.attributes ?? {}),
    };
    this.spans.push({
      id: spanId,
      parent_id: this.turnSpanId ?? this.args.stageSpanId,
      attempt_number: this.args.attemptNumber,
      stage_id: this.args.stageId,
      stage_run_index: this.args.stageRunIndex,
      kind: "usage",
      title: this.usageEventCount === 0 ? "Usage snapshot" : "Usage update",
      status: "completed",
      started_at: at,
      ended_at: at,
      attributes: usage,
    });
    this.dirtySpanIds.add(spanId);
    this.appendEvent(
      createTraceEvent({
        spanId,
        attemptNumber: this.args.attemptNumber,
        stageId: this.args.stageId,
        stageRunIndex: this.args.stageRunIndex,
        kind: "usage",
        at,
        message:
          `Usage updated${
            args.inputTokens != null || args.outputTokens != null
              ? ` · in ${args.inputTokens ?? 0} / out ${
                  args.outputTokens ?? 0
                }`
              : ""
          }`,
        attributes: usage,
      }),
    );
    this.usageEventCount += 1;
  }

  recordNote(
    message: string,
    at = nowIso(),
    attributes: Record<string, JsonValue> = {},
  ): void {
    this.appendEvent(
      createTraceEvent({
        spanId: this.turnSpanId ?? this.args.stageSpanId,
        attemptNumber: this.args.attemptNumber,
        stageId: this.args.stageId,
        stageRunIndex: this.args.stageRunIndex,
        kind: "note",
        at,
        message,
        attributes,
      }),
    );
  }

  recordError(
    message: string,
    at = nowIso(),
    attributes: Record<string, JsonValue> = {},
  ): void {
    const spanId = createId("trace_span");
    this.spans.push({
      id: spanId,
      parent_id: this.turnSpanId ?? this.args.stageSpanId,
      attempt_number: this.args.attemptNumber,
      stage_id: this.args.stageId,
      stage_run_index: this.args.stageRunIndex,
      kind: "error",
      title: "Runtime error",
      status: "failed",
      started_at: at,
      ended_at: at,
      attributes: {
        message,
        ...attributes,
      },
    });
    this.dirtySpanIds.add(spanId);
    this.appendEvent(
      createTraceEvent({
        spanId,
        attemptNumber: this.args.attemptNumber,
        stageId: this.args.stageId,
        stageRunIndex: this.args.stageRunIndex,
        kind: "error",
        at,
        message,
        attributes,
      }),
    );
  }

  flushBundle(): TraceBundle {
    const dirtySpanIds = [...this.dirtySpanIds];
    const spans = this.spans
      .filter((span) => dirtySpanIds.includes(span.id))
      .sort((left, right) => left.started_at.localeCompare(right.started_at));
    const events = this.events.slice(this.flushedEventCount);
    this.dirtySpanIds.clear();
    this.flushedEventCount = this.events.length;
    return {
      spans,
      events,
      summaries: [],
    };
  }

  buildBundle(finalOutput: string, endedAt = nowIso()): TraceBundle {
    if (this.outputSpanId) {
      this.completeOutputSpan(endedAt, finalOutput, {});
    }

    if (this.turnSpanId) {
      const existing = this.spans.find((span) => span.id === this.turnSpanId);
      if (existing && !existing.ended_at) {
        this.upsertSpan(this.turnSpanId, {
          ...existing,
          status:
            existing.status === "running" ? "completed" : existing.status,
          ended_at: endedAt,
        });
      }
    }

    for (const [toolId, tool] of this.activeToolSpans.entries()) {
      this.upsertSpan(tool.spanId, {
        id: tool.spanId,
        parent_id: this.turnSpanId ?? this.args.stageSpanId,
        attempt_number: this.args.attemptNumber,
        stage_id: this.args.stageId,
        stage_run_index: this.args.stageRunIndex,
        kind: "tool_call",
        title: tool.title,
        status: "warning",
        started_at: tool.startedAt,
        ended_at: endedAt,
        attributes: {
          ...tool.attributes,
          note: "tool span completed implicitly during bundle finalization",
        },
      });
      this.activeToolSpans.delete(toolId);
    }

    return {
      spans: [...this.spans].sort((left, right) =>
        left.started_at.localeCompare(right.started_at),
      ),
      events: [...this.events].sort((left, right) =>
        left.at.localeCompare(right.at),
      ),
      summaries: [],
    };
  }

  private ensureOutputSpan(
    at: string,
    attributes: Record<string, JsonValue>,
  ): void {
    if (this.outputSpanId) {
      return;
    }
    this.outputSpanId = createId("trace_span");
    this.outputStartedAt = at;
    this.spans.push({
      id: this.outputSpanId,
      parent_id: this.turnSpanId ?? this.args.stageSpanId,
      attempt_number: this.args.attemptNumber,
      stage_id: this.args.stageId,
      stage_run_index: this.args.stageRunIndex,
      kind: "assistant_output",
      title: "Assistant output",
      status: "running",
      started_at: at,
      ended_at: null,
      attributes,
    });
    this.dirtySpanIds.add(this.outputSpanId);
    this.appendEvent(
      createTraceEvent({
        spanId: this.outputSpanId,
        attemptNumber: this.args.attemptNumber,
        stageId: this.args.stageId,
        stageRunIndex: this.args.stageRunIndex,
        kind: "status",
        at,
        message: "Assistant output started",
      }),
    );
  }

  private completeOutputSpan(
    at: string,
    messageText: string,
    attributes: Record<string, JsonValue>,
  ): void {
    this.ensureOutputSpan(at, attributes);
    if (!this.outputSpanId) {
      return;
    }
    this.upsertSpan(this.outputSpanId, {
      id: this.outputSpanId,
      parent_id: this.turnSpanId ?? this.args.stageSpanId,
      attempt_number: this.args.attemptNumber,
      stage_id: this.args.stageId,
      stage_run_index: this.args.stageRunIndex,
      kind: "assistant_output",
      title: "Assistant output",
      status: "completed",
      started_at: this.outputStartedAt ?? at,
      ended_at: at,
      attributes: {
        ...attributes,
        output_length: messageText.length,
      },
    });
    this.appendEvent(
      createTraceEvent({
        spanId: this.outputSpanId,
        attemptNumber: this.args.attemptNumber,
        stageId: this.args.stageId,
        stageRunIndex: this.args.stageRunIndex,
        kind: "output",
        at,
        message: messageText
          ? truncateValue(messageText, 140)
          : "Assistant output completed",
        attributes: {
          output_length: messageText.length,
          output_text: messageText,
        },
      }),
    );
  }

  private upsertSpan(spanId: string, next: TraceSpan): void {
    const index = this.spans.findIndex((span) => span.id === spanId);
    if (index === -1) {
      this.spans.push(next);
      this.dirtySpanIds.add(spanId);
      return;
    }
    this.spans[index] = next;
    this.dirtySpanIds.add(spanId);
  }

  private appendEvent(event: TraceEvent): void {
    this.events.push(event);
  }
}

function createTraceEvent(args: {
  spanId: string;
  attemptNumber: number;
  stageId: string | null;
  stageRunIndex: number | null;
  kind: TraceEventKind;
  at: string;
  message: string;
  attributes?: Record<string, JsonValue>;
}): TraceEvent {
  return {
    id: createId("trace_event"),
    span_id: args.spanId,
    attempt_number: args.attemptNumber,
    stage_id: args.stageId,
    stage_run_index: args.stageRunIndex,
    kind: args.kind,
    at: args.at,
    message: args.message,
    attributes: args.attributes ?? {},
  };
}

function normalizeTraceStatus(rawStatus: string | null): TraceSpanStatus {
  if (!rawStatus) {
    return "completed";
  }
  if (["failed", "error"].includes(rawStatus)) {
    return "failed";
  }
  if (["interrupted", "canceled", "cancelled"].includes(rawStatus)) {
    return "canceled";
  }
  if (
    ["running", "inprogress", "in_progress", "started"].includes(
      rawStatus.toLowerCase(),
    )
  ) {
    return "running";
  }
  return "completed";
}

function readTraceString(value: Record<string, JsonValue> | undefined, paths: string[][]): string | null {
  if (!value) {
    return null;
  }
  for (const path of paths) {
    const current = readNestedValue(value, path);
    if (typeof current === "string" && current.length > 0) {
      return current;
    }
  }
  return null;
}

function readNestedValue(value: Record<string, JsonValue>, path: string[]): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const segment of path) {
    if (!current || Array.isArray(current) || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, JsonValue>)[segment];
  }
  return current;
}

function truncateValue(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}
