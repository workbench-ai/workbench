import type { JsonValue } from "@workbench-ai/contracts";

export interface PiRpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: JsonValue;
  error?: string;
}

export interface PiRpcState {
  sessionFile?: string;
  sessionId?: string;
  thinkingLevel?: string;
  model?: {
    provider?: string;
    id?: string;
  } | null;
}

export type PiAssistantMessageEvent =
  | {
      type:
        | "start"
        | "text_start"
        | "text_end"
        | "thinking_start"
        | "thinking_end"
        | "toolcall_start"
        | "toolcall_end";
      contentIndex?: number;
      delta?: string;
      content?: string;
      partial?: PiAssistantMessage;
      toolCall?: JsonValue;
    }
  | {
      type: "text_delta" | "thinking_delta" | "toolcall_delta";
      contentIndex?: number;
      delta: string;
      partial?: PiAssistantMessage;
    }
  | {
      type: "done" | "error";
      message?: PiAssistantMessage;
      error?: PiAssistantMessage;
      reason?: string;
    };

export interface PiUserMessage {
  role: "user";
  content?: JsonValue;
  timestamp?: number;
}

export interface PiAssistantMessage {
  role: "assistant";
  content?: JsonValue;
  provider?: string;
  model?: string;
  responseId?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    cost?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      total?: number;
    };
  };
  stopReason?: string;
  errorMessage?: string;
  timestamp?: number;
}

export interface PiToolResultMessage {
  role: "toolResult";
  toolCallId?: string;
  toolName?: string;
  content?: JsonValue;
  isError?: boolean;
  timestamp?: number;
}

export type PiMessage = PiUserMessage | PiAssistantMessage | PiToolResultMessage;

export type PiAgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages?: PiMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message?: PiMessage; toolResults?: JsonValue }
  | { type: "message_start"; message: PiMessage }
  | {
      type: "message_update";
      message: PiMessage;
      assistantMessageEvent: PiAssistantMessageEvent;
    }
  | { type: "message_end"; message: PiMessage }
  | {
      type: "tool_execution_start";
      toolCallId?: string;
      toolName?: string;
      args?: JsonValue;
    }
  | {
      type: "tool_execution_update";
      toolCallId?: string;
      toolName?: string;
      args?: JsonValue;
      partialResult?: JsonValue;
    }
  | {
      type: "tool_execution_end";
      toolCallId?: string;
      toolName?: string;
      result?: JsonValue;
      isError?: boolean;
    };

export type PiParsedLine =
  | { kind: "response"; response: PiRpcResponse }
  | { kind: "event"; event: PiAgentEvent }
  | { kind: "extension_ui"; request: Record<string, JsonValue> }
  | { kind: "unknown"; value: JsonValue };

export function parsePiRpcLine(line: string): PiParsedLine {
  const value = JSON.parse(line) as JsonValue;
  if (!isJsonObject(value) || typeof value.type !== "string") {
    return { kind: "unknown", value };
  }
  if (value.type === "response") {
    return {
      kind: "response",
      response: {
        id: typeof value.id === "string" ? value.id : undefined,
        type: "response",
        command: typeof value.command === "string" ? value.command : "unknown",
        success: value.success === true,
        data: value.data,
        error: typeof value.error === "string" ? value.error : undefined,
      },
    };
  }
  if (value.type === "extension_ui_request") {
    return { kind: "extension_ui", request: value };
  }
  return {
    kind: "event",
    event: value as unknown as PiAgentEvent,
  };
}

export function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}
