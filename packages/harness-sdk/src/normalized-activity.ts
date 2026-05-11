import type { JsonValue } from "@workbench-ai/flow-contracts";

import { nowIso } from "./internal-utils.js";
import { HarnessTraceBuilder } from "./trace-builder.js";

export type NormalizedHarnessActivity =
  | {
      type: "session.started";
      at?: string;
      provider: string;
      model?: string | null;
      sessionId?: string | null;
      attributes?: Record<string, JsonValue>;
    }
  | {
      type: "turn.started";
      at?: string;
      provider: string;
      model?: string | null;
      sessionId?: string | null;
      operationId?: string | null;
      attributes?: Record<string, JsonValue>;
    }
  | {
      type: "turn.completed";
      at?: string;
      provider?: string | null;
      model?: string | null;
      sessionId?: string | null;
      operationId?: string | null;
      status?: string | null;
      errorMessage?: string | null;
      attributes?: Record<string, JsonValue>;
    }
  | {
      type: "assistant_output.started";
      at?: string;
      phase?: string | null;
      itemId?: string | null;
    }
  | {
      type: "assistant_output.delta";
      at?: string;
      phase?: string | null;
      itemId?: string | null;
      delta: string;
    }
  | {
      type: "assistant_output.completed";
      at?: string;
      phase?: string | null;
      itemId?: string | null;
      text: string;
    }
  | {
      type: "tool.started";
      at?: string;
      toolId?: string | null;
      toolName?: string | null;
      attributes?: Record<string, JsonValue>;
    }
  | {
      type: "tool.completed";
      at?: string;
      toolId?: string | null;
      toolName?: string | null;
      attributes?: Record<string, JsonValue>;
    }
  | {
      type: "usage.updated";
      at?: string;
      inputTokens?: number | null;
      outputTokens?: number | null;
      attributes?: Record<string, JsonValue>;
    }
  | {
      type: "note";
      at?: string;
      message: string;
      attributes?: Record<string, JsonValue>;
    }
  | {
      type: "error";
      at?: string;
      message: string;
      attributes?: Record<string, JsonValue>;
    };

export function applyNormalizedHarnessActivity(
  trace: HarnessTraceBuilder,
  activity: NormalizedHarnessActivity,
): void {
  const at = activity.at ?? nowIso();

  switch (activity.type) {
    case "session.started":
      trace.recordNote("Model session started", at, {
        provider: activity.provider,
        model: activity.model ?? null,
        session_id: activity.sessionId ?? null,
        ...(activity.attributes ?? {}),
      });
      return;
    case "turn.started":
      trace.startTurn({
        at,
        provider: activity.provider,
        model: activity.model ?? null,
        sessionId: activity.sessionId ?? null,
        operationId: activity.operationId ?? null,
        attributes: activity.attributes,
      });
      return;
    case "turn.completed":
      trace.completeTurn({
        at,
        provider: activity.provider ?? null,
        model: activity.model ?? null,
        sessionId: activity.sessionId ?? null,
        operationId: activity.operationId ?? null,
        status: activity.status ?? null,
        errorMessage: activity.errorMessage ?? null,
        attributes: activity.attributes,
      });
      return;
    case "assistant_output.started":
      trace.startAssistantOutput({
        at,
        phase: activity.phase ?? null,
        itemId: activity.itemId ?? null,
      });
      return;
    case "assistant_output.delta":
      trace.appendOutputDelta({
        at,
        delta: activity.delta,
        phase: activity.phase ?? null,
        itemId: activity.itemId ?? null,
      });
      return;
    case "assistant_output.completed":
      trace.completeAssistantOutput({
        at,
        text: activity.text,
        phase: activity.phase ?? null,
        itemId: activity.itemId ?? null,
      });
      return;
    case "tool.started":
      trace.startToolCall({
        at,
        toolId: activity.toolId ?? null,
        toolName: activity.toolName ?? null,
        attributes: activity.attributes,
      });
      return;
    case "tool.completed":
      trace.completeToolCall({
        at,
        toolId: activity.toolId ?? null,
        toolName: activity.toolName ?? null,
        attributes: activity.attributes,
      });
      return;
    case "usage.updated":
      trace.recordUsage({
        at,
        inputTokens: activity.inputTokens ?? null,
        outputTokens: activity.outputTokens ?? null,
        attributes: activity.attributes,
      });
      return;
    case "note":
      trace.recordNote(activity.message, at, activity.attributes);
      return;
    case "error":
      trace.recordError(activity.message, at, activity.attributes);
      return;
  }
}
