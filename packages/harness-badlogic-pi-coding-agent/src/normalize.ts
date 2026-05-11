import type { HarnessEvent, JsonValue } from "@workbench-ai/contracts";
import type { NormalizedHarnessActivity } from "@workbench-ai/harness-sdk";
import type { ActiveHarnessSession } from "@workbench-ai/harness-sdk";
import type { CanonicalToolCall } from "@workbench-ai/harness-sdk";
import { buildCanonicalToolCall } from "@workbench-ai/harness-sdk";
import { piCodingAgentHarnessManifest } from "./manifest.js";
import {
  isJsonObject,
  type PiAgentEvent,
  type PiAssistantMessage,
  type PiMessage,
} from "./rpc.js";

export interface PiNormalizationState {
  provider: string | null;
  model: string | null;
  sessionId: string | null;
  turnStarted: boolean;
  turnCompleted: boolean;
  lastAssistantText: string | null;
  lastAssistantStopReason: string | null;
  lastAssistantErrorMessage: string | null;
  lastUsageFingerprint: string | null;
  toolsById: Map<string, CanonicalToolCall>;
}

export function createPiNormalizationState(args: {
  provider?: string | null;
  model?: string | null;
  sessionId?: string | null;
} = {}): PiNormalizationState {
  return {
    provider: args.provider ?? null,
    model: args.model ?? null,
    sessionId: args.sessionId ?? null,
    turnStarted: false,
    turnCompleted: false,
    lastAssistantText: null,
    lastAssistantStopReason: null,
    lastAssistantErrorMessage: null,
    lastUsageFingerprint: null,
    toolsById: new Map(),
  };
}

export function resetPiTurnState(state: PiNormalizationState): void {
  state.turnStarted = false;
  state.turnCompleted = false;
  state.lastAssistantText = null;
  state.lastAssistantStopReason = null;
  state.lastAssistantErrorMessage = null;
  state.lastUsageFingerprint = null;
}

export function createPiHarnessEvent(
  session: ActiveHarnessSession["session"],
  payload: PiAgentEvent,
  at: string,
): HarnessEvent {
  return {
    at,
    attempt_number: session.attempt_number,
    stage_id: session.stage_id,
    stage_run_index: session.stage_run_index,
    phase: mapPiEventPhase(payload.type),
    name: `pi/${payload.type}`,
    payload: payload as unknown as Record<string, JsonValue>,
  };
}

export function createPiStderrHarnessEvent(
  session: ActiveHarnessSession["session"],
  at: string,
  text: string,
  severity: "warning" | "error",
): HarnessEvent {
  return {
    at,
    attempt_number: session.attempt_number,
    stage_id: session.stage_id,
    stage_run_index: session.stage_run_index,
    phase: severity === "error" ? "error" : "session",
    name: "pi/stderr",
    payload: {
      text,
      severity,
    },
  };
}

export function normalizePiEvent(
  state: PiNormalizationState,
  event: PiAgentEvent,
  at: string,
): NormalizedHarnessActivity[] {
  const activities: NormalizedHarnessActivity[] = [];

  if (event.type === "agent_start" || event.type === "turn_start") {
    if (!state.turnStarted) {
      state.turnStarted = true;
      activities.push({
        type: "turn.started",
        at,
        provider: piCodingAgentHarnessManifest.id,
        model: state.model,
        sessionId: state.sessionId,
      });
    }
    return activities;
  }

  if (event.type === "message_start" && event.message.role === "assistant") {
    activities.push({
      type: "assistant_output.started",
      at,
      phase: "response",
      itemId: readPiMessageId(event.message),
    });
    return activities;
  }

  if (event.type === "message_update" && event.message.role === "assistant") {
    const delta =
      event.assistantMessageEvent.type === "text_delta"
        ? event.assistantMessageEvent.delta
        : null;
    if (delta && delta.length > 0) {
      activities.push({
        type: "assistant_output.delta",
        at,
        phase: "response",
        itemId: readPiMessageId(event.message),
        delta,
      });
    }
    return activities;
  }

  if (event.type === "message_end" && event.message.role === "assistant") {
    const assistantMessage = event.message;
    const text = extractPiAssistantText(assistantMessage);
    const stopReason = assistantMessage.stopReason ?? null;
    const errorMessage = assistantMessage.errorMessage ?? null;
    state.provider = state.provider ?? assistantMessage.provider ?? null;
    state.model = state.model ?? assistantMessage.model ?? null;
    state.lastAssistantText = text;
    state.lastAssistantStopReason = stopReason;
    state.lastAssistantErrorMessage = errorMessage;

    if (text.length > 0) {
      activities.push({
        type: "assistant_output.completed",
        at,
        phase: "response",
        itemId: readPiMessageId(assistantMessage),
        text,
      });
    }

    const usage =
      stopReason === "toolUse" ? null : extractPiUsage(assistantMessage);
    if (usage) {
      const fingerprint = JSON.stringify(usage);
      if (fingerprint !== state.lastUsageFingerprint) {
        state.lastUsageFingerprint = fingerprint;
        activities.push({
          type: "usage.updated",
          at,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          attributes: usage.attributes,
        });
      }
    }

    if (stopReason === "error" && errorMessage) {
      activities.push({
        type: "error",
        at,
        message: errorMessage,
        attributes: {
          stop_reason: stopReason,
        },
      });
    }
    return activities;
  }

  if (event.type === "tool_execution_start") {
    const toolCall = buildPiToolCall({
      rawToolName: readString(event.toolName),
      args: event.args,
    });
    const toolId = readString(event.toolCallId);
    if (toolId) {
      state.toolsById.set(toolId, toolCall);
    }
    activities.push({
      type: "tool.started",
      at,
      toolId,
      toolName: toolCall.toolName,
      attributes: toolCall.attributes,
    });
    return activities;
  }

  if (event.type === "tool_execution_end") {
    const toolId = readString(event.toolCallId);
    const priorToolCall = toolId ? state.toolsById.get(toolId) ?? null : null;
    const preview = readPiResultPreview(event.result);
    activities.push({
      type: "tool.completed",
      at,
      toolId,
      toolName:
        priorToolCall?.toolName ??
        buildPiToolCall({
          rawToolName: readString(event.toolName),
        }).toolName,
      attributes:
        priorToolCall || preview || event.isError === true
          ? {
              ...(priorToolCall?.attributes ?? {}),
              ...(preview ? { result_preview: preview } : {}),
              ...(event.isError === true ? { is_error: true } : {}),
            }
          : undefined,
    });
    if (event.isError === true) {
      const message = readPiResultPreview(event.result);
      if (message) {
        activities.push({
          type: "error",
          at,
          message,
          attributes: {
            tool_name: event.toolName ?? null,
            tool_id: event.toolCallId ?? null,
          },
        });
      }
    }
    return activities;
  }

  if (event.type === "agent_end") {
    const fallbackAssistant = selectLastAssistantMessage(event.messages ?? []);
    if (fallbackAssistant) {
      state.provider = state.provider ?? fallbackAssistant.provider ?? null;
      state.model = state.model ?? fallbackAssistant.model ?? null;
      state.lastAssistantText =
        state.lastAssistantText ?? extractPiAssistantText(fallbackAssistant);
      state.lastAssistantStopReason =
        state.lastAssistantStopReason ?? fallbackAssistant.stopReason ?? null;
      state.lastAssistantErrorMessage =
        state.lastAssistantErrorMessage ?? fallbackAssistant.errorMessage ?? null;
    }
    if (!state.turnCompleted) {
      state.turnCompleted = true;
      activities.push({
        type: "turn.completed",
        at,
        provider: piCodingAgentHarnessManifest.id,
        model: state.model,
        sessionId: state.sessionId,
        status: mapPiTurnStatus(state.lastAssistantStopReason),
        errorMessage: state.lastAssistantErrorMessage,
        attributes: {
          stop_reason: state.lastAssistantStopReason,
        },
      });
    }
    return activities;
  }

  return activities;
}

export function redactPiEvent(value: JsonValue): JsonValue | null {
  if (Array.isArray(value)) {
    const next = value
      .map((entry) => redactPiEvent(entry))
      .filter((entry): entry is JsonValue => entry !== null);
    return next;
  }

  if (!isJsonObject(value)) {
    return value;
  }

  if (value.type === "thinking") {
    return null;
  }

  const next: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "thinking" || key === "signature" || key === "thoughtSignature") {
      continue;
    }
    if (
      key === "assistantMessageEvent" &&
      isJsonObject(entry) &&
      typeof entry.type === "string" &&
      entry.type.startsWith("thinking_")
    ) {
      next[key] = redactPiThinkingAssistantMessageEvent(entry);
      continue;
    }
    const redacted = redactPiEvent(entry);
    if (redacted !== null) {
      next[key] = redacted;
    }
  }
  return next;
}

export function classifyPiStderr(
  text: string,
): "empty" | "warning" | "error" {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "empty";
  }
  if (lines.every((line) => /\bWARN(?:ING)?\b/i.test(line))) {
    return "warning";
  }
  return "error";
}

function redactPiThinkingAssistantMessageEvent(
  value: Record<string, JsonValue>,
): Record<string, JsonValue> {
  return {
    ...value,
    ...(typeof value.delta === "string" ? { delta: "" } : {}),
    ...(typeof value.content === "string" ? { content: "" } : {}),
    ...(value.partial ? { partial: redactPiEvent(value.partial) } : {}),
  };
}

function extractPiAssistantText(message: PiAssistantMessage): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((entry) => {
      if (!isJsonObject(entry)) {
        return "";
      }
      return entry.type === "text" && typeof entry.text === "string"
        ? entry.text
        : "";
    })
    .join("");
}

function extractPiUsage(message: PiAssistantMessage): {
  input_tokens: number | null;
  output_tokens: number | null;
  attributes: Record<string, JsonValue> | undefined;
} | null {
  if (!message.usage) {
    return null;
  }
  const attributes: Record<string, JsonValue> = {};
  const cacheRead = readNumber(message.usage.cacheRead);
  const cacheWrite = readNumber(message.usage.cacheWrite);
  const totalTokens = readNumber(message.usage.totalTokens);
  const cost = isJsonObject(message.usage.cost) ? message.usage.cost : null;
  if (cacheRead != null) {
    attributes.cache_read_tokens = cacheRead;
  }
  if (cacheWrite != null) {
    attributes.cache_write_tokens = cacheWrite;
  }
  if (totalTokens != null) {
    attributes.total_tokens = totalTokens;
  }
  if (cost) {
    const input = readNumber(cost.input);
    const output = readNumber(cost.output);
    const cacheReadCost = readNumber(cost.cacheRead);
    const cacheWriteCost = readNumber(cost.cacheWrite);
    const total = readNumber(cost.total);
    if (input != null) {
      attributes.cost_input = input;
    }
    if (output != null) {
      attributes.cost_output = output;
    }
    if (cacheReadCost != null) {
      attributes.cost_cache_read = cacheReadCost;
    }
    if (cacheWriteCost != null) {
      attributes.cost_cache_write = cacheWriteCost;
    }
    if (total != null) {
      attributes.cost_total = total;
    }
  }
  return {
    input_tokens: readNumber(message.usage.input),
    output_tokens: readNumber(message.usage.output),
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
  };
}

function selectLastAssistantMessage(messages: readonly PiMessage[]): PiAssistantMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.role === "assistant") {
      return candidate;
    }
  }
  return null;
}

function buildPiToolCall(args: {
  rawToolName?: string | null;
  args?: JsonValue;
  result?: JsonValue;
  isError?: boolean;
}) {
  const preview = readPiResultPreview(args.result);
  return buildCanonicalToolCall({
    rawToolName: args.rawToolName,
    input: args.args,
    resultPreview: preview,
    attributes: args.isError === true ? { is_error: true } : undefined,
  });
}

function readPiResultPreview(value: JsonValue | undefined): string | null {
  if (typeof value === "string") {
    return value.trim().length > 0 ? truncatePiValue(value.trim(), 160) : null;
  }
  if (Array.isArray(value)) {
    const text = value
      .map((entry) => readPiResultPreview(entry))
      .filter((entry): entry is string => Boolean(entry))
      .join(" ");
    return text.length > 0 ? truncatePiValue(text, 160) : null;
  }
  if (isJsonObject(value)) {
    if (Array.isArray(value.content)) {
      const text = value.content
        .map((entry) => {
          if (!isJsonObject(entry)) {
            return "";
          }
          return entry.type === "text" && typeof entry.text === "string"
            ? entry.text
            : "";
        })
        .join(" ")
        .trim();
      if (text.length > 0) {
        return truncatePiValue(text, 160);
      }
    }
    if (typeof value.message === "string" && value.message.trim().length > 0) {
      return truncatePiValue(value.message.trim(), 160);
    }
    return truncatePiValue(JSON.stringify(value), 160);
  }
  return null;
}

function mapPiEventPhase(type: string): HarnessEvent["phase"] {
  if (type === "agent_start" || type === "agent_end") {
    return "session";
  }
  if (type === "turn_start" || type === "turn_end") {
    return "turn";
  }
  if (type.startsWith("tool_execution")) {
    return "tool";
  }
  if (type.startsWith("message_")) {
    return "item";
  }
  return "item";
}

function mapPiTurnStatus(stopReason: string | null): string {
  if (stopReason === "error") {
    return "failed";
  }
  if (stopReason === "aborted") {
    return "canceled";
  }
  return "completed";
}

function readPiMessageId(message: PiMessage): string | null {
  if ("responseId" in message && typeof message.responseId === "string") {
    return message.responseId;
  }
  if (typeof message.timestamp === "number") {
    return String(message.timestamp);
  }
  return null;
}

function readString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function truncatePiValue(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}
