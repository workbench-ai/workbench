import { promises as fs } from "node:fs";
import path from "node:path";

import {
  appendUnique,
  buildAgentReadableTraceDigest,
  collectTraceToolArtifacts,
  createEmptyTraceArtifacts,
  expandLocalTraceHomePath,
  localTraceHomeDir,
  localTraceRefIsAtOrAfter,
  localTraceRefMatchesWorkspace,
  localTraceShortHash,
  mergeLocalTraceRawType,
  mergeLocalTraceTimelineTool,
  normalizeTraceText,
  readLocalTraceJsonLines,
  sortLocalTraceRefs,
  traceJsonArray,
  traceJsonObject,
  traceNumber,
  traceString,
  truncateTraceJsonValue,
  truncateTraceText,
  type AgentReadableTraceTimelineEntry,
  type JsonObject,
  type JsonValue,
  type LocalTraceAdapter,
  type LocalTraceDiscoveryContext,
  type LocalTraceReadContext,
  type LocalTraceRef,
  type LocalTraceTimelineTool,
} from "@workbench-ai/agent-driver";

const CODEX_LOCAL_TRACE_PROVIDER = "codex";
const CODEX_LOCAL_TRACE_DISPLAY = "OpenAI Codex";

interface CodexIndexRecord {
  title?: string;
  updatedAt?: string;
}

interface CodexSessionSummary {
  threadId: string;
  title?: string;
  workspaceRoot?: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt?: string;
}

interface CodexSessionFile {
  sourcePath: string;
  mtimeMs: number;
}

export const codexLocalTraceAdapter: LocalTraceAdapter = {
  id: CODEX_LOCAL_TRACE_PROVIDER,
  displayName: CODEX_LOCAL_TRACE_DISPLAY,
  async discoverLocalTraces(context = {}) {
    const requested = parseCodexTraceId(context.traceId);
    if (context.traceId && !requested) {
      return [];
    }
    const codexHome = resolveCodexHome(context.env);
    const indexPath = path.join(codexHome, "session_index.jsonl");
    const index = await readCodexIndex(indexPath);
    const files = await listCodexSessionFiles(codexHome);
    const refs: LocalTraceRef[] = [];
    for (const file of files) {
      if (requested && localTraceShortHash(file.sourcePath) !== requested.sourceHash) {
        continue;
      }
      const summary = await summarizeCodexSessionFile(file.sourcePath, index, file.mtimeMs);
      if (!summary) {
        continue;
      }
      if (requested && summary.threadId !== requested.sessionId) {
        continue;
      }
      const ref = codexSummaryToRef(codexHome, indexPath, file.sourcePath, summary);
      if (!localTraceRefMatchesWorkspace(ref, context.workspaceRoot)) {
        continue;
      }
      if (context.since && !localTraceRefIsAtOrAfter(ref, context.since)) {
        continue;
      }
      refs.push(ref);
      if (requested) {
        break;
      }
      if (typeof context.limit === "number" && context.limit > 0 && refs.length >= context.limit) {
        break;
      }
    }
    const sorted = sortLocalTraceRefs(refs);
    return sorted;
  },
  async readLocalTraceDigest(ref, context = {}) {
    const records = await readLocalTraceJsonLines(ref.sourcePath);
    const maxTextChars = context.maxTextChars ?? 4_000;
    const maxToolOutputChars = context.maxToolOutputChars ?? Math.min(maxTextChars, 1_000);
    const timeline: AgentReadableTraceTimelineEntry[] = [];
    const toolEntryById = new Map<string, AgentReadableTraceTimelineEntry>();
    const artifacts = createEmptyTraceArtifacts();
    let goal: string | undefined;
    let activeThreadId: string | null = null;

    const pushEntry = (
      entry: Omit<AgentReadableTraceTimelineEntry, "index">,
    ): AgentReadableTraceTimelineEntry => {
      const timelineEntry: AgentReadableTraceTimelineEntry = {
        index: timeline.length,
        ...entry,
      };
      timeline.push(timelineEntry);
      return timelineEntry;
    };

    const pushToolEntry = (
      tool: LocalTraceTimelineTool,
      at: string | null,
      rawType: string,
    ): void => {
      collectTraceToolArtifacts(artifacts, tool);
      const existing = tool.id ? toolEntryById.get(tool.id) : undefined;
      if (existing?.tool) {
        existing.tool = mergeLocalTraceTimelineTool(existing.tool, tool);
        existing.raw = { type: mergeLocalTraceRawType(existing.raw?.type, rawType) };
        return;
      }
      const entry = pushEntry({
        type: "tool",
        ...(at ? { at } : {}),
        tool,
        raw: { type: rawType },
      });
      if (tool.id) {
        toolEntryById.set(tool.id, entry);
      }
    };

    for (const record of records) {
      const recordType = traceString(record.type);
      const payload = traceJsonObject(record.payload);
      const at = traceString(record.timestamp);
      if (recordType === "session_meta") {
        activeThreadId = traceString(payload?.id);
        continue;
      }
      if (!payload || (ref.sessionId && activeThreadId && activeThreadId !== ref.sessionId)) {
        continue;
      }
      if (recordType === "response_item") {
        const payloadType = traceString(payload.type);
        if (payloadType === "message") {
          const role = traceString(payload.role);
          if (role !== "user" && role !== "assistant") {
            continue;
          }
          const text = extractCodexMessageText(traceJsonArray(payload.content), role);
          const truncated = truncateTraceText(text, maxTextChars);
          if (!truncated || (role === "user" && isCodexSyntheticUserText(truncated))) {
            continue;
          }
          if (role === "user" && !goal) {
            goal = truncateTraceText(truncated, 300) ?? undefined;
          }
          pushEntry({
            type: role,
            ...(at ? { at } : {}),
            text: truncated,
            ...(traceString(payload.phase) ? { phase: traceString(payload.phase) as string } : {}),
            raw: { type: "response_item.message" },
          });
          continue;
        }
        if (payloadType === "function_call") {
          const tool = codexToolFromPayload(payload, "started", maxTextChars, maxToolOutputChars);
          pushToolEntry(tool, at, "response_item.function_call");
          continue;
        }
        if (payloadType === "function_call_output") {
          const tool = codexToolFromPayload(payload, "completed", maxTextChars, maxToolOutputChars);
          pushToolEntry(tool, at, "response_item.function_call_output");
        }
        continue;
      }
      if (recordType !== "event_msg") {
        continue;
      }
      const eventType = traceString(payload.type);
      if (eventType === "error") {
        const message = truncateTraceText(traceString(payload.message), maxTextChars);
        if (message) {
          appendUnique(artifacts.errors, message);
          pushEntry({
            type: "error",
            ...(at ? { at } : {}),
            text: message,
            raw: { type: "event_msg.error" },
          });
        }
        continue;
      }
      if (eventType !== "exec_command_end" && eventType !== "mcp_tool_call_end") {
        continue;
      }
      const tool = codexToolFromPayload(payload, "completed", maxTextChars, maxToolOutputChars);
      pushToolEntry(tool, at, `event_msg.${eventType}`);
    }

    return buildAgentReadableTraceDigest({
      provider: CODEX_LOCAL_TRACE_PROVIDER,
      ref,
      ...(goal ? { goal } : {}),
      timeline,
      artifacts,
    });
  },
};

function parseCodexTraceId(
  traceId: string | undefined,
): { sessionId: string; sourceHash: string } | null {
  if (!traceId) {
    return null;
  }
  const [provider, sessionId, sourceHash, ...extra] = traceId.split(":");
  if (
    provider !== CODEX_LOCAL_TRACE_PROVIDER ||
    !sessionId ||
    !sourceHash ||
    extra.length > 0
  ) {
    return null;
  }
  return { sessionId, sourceHash };
}

function resolveCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.CODEX_HOME?.trim();
  if (explicit) {
    return path.resolve(expandLocalTraceHomePath(explicit, env));
  }
  return path.join(localTraceHomeDir(env), ".codex");
}

async function readCodexIndex(indexPath: string): Promise<Map<string, CodexIndexRecord>> {
  const index = new Map<string, CodexIndexRecord>();
  const records = await readLocalTraceJsonLines(indexPath).catch(() => []);
  for (const record of records) {
    const id = traceString(record.id);
    if (!id) {
      continue;
    }
    const entry: CodexIndexRecord = {};
    const title = traceString(record.thread_name);
    const updatedAt = traceString(record.updated_at);
    if (title && !isCodexSyntheticUserText(title)) {
      entry.title = title;
    }
    if (updatedAt) {
      entry.updatedAt = updatedAt;
    }
    index.set(id, entry);
  }
  return index;
}

async function listCodexSessionFiles(codexHome: string): Promise<CodexSessionFile[]> {
  const roots = [
    path.join(codexHome, "sessions"),
    path.join(codexHome, "archived_sessions"),
  ];
  const files: CodexSessionFile[] = [];
  for (const root of roots) {
    await collectJsonlFiles(root, files);
  }
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs || left.sourcePath.localeCompare(right.sourcePath));
}

async function collectJsonlFiles(root: string, files: CodexSessionFile[]): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await collectJsonlFiles(entryPath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const stat = await fs.stat(entryPath).catch(() => null);
      files.push({
        sourcePath: entryPath,
        mtimeMs: stat?.mtimeMs ?? 0,
      });
    }
  }
}

async function summarizeCodexSessionFile(
  sourcePath: string,
  index: Map<string, CodexIndexRecord>,
  fallbackMtimeMs?: number,
): Promise<CodexSessionSummary | null> {
  const records = await readLocalTraceJsonLines(sourcePath).catch(() => []);
  let threadId: string | null = null;
  let workspaceRoot: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let title: string | undefined;
  for (const record of records) {
    const timestamp = traceString(record.timestamp);
    if (timestamp) {
      startedAt ??= timestamp;
      endedAt = timestamp;
    }
    const recordType = traceString(record.type);
    const payload = traceJsonObject(record.payload);
    if (recordType === "session_meta" && payload) {
      threadId ??= traceString(payload.id);
      const cwd = traceString(payload.cwd);
      if (cwd) {
        workspaceRoot = path.resolve(cwd);
      }
      startedAt ??= traceString(payload.timestamp) ?? timestamp ?? undefined;
      continue;
    }
    if (title || recordType !== "response_item" || !payload) {
      continue;
    }
    if (traceString(payload.type) !== "message" || traceString(payload.role) !== "user") {
      continue;
    }
    const text = extractCodexMessageText(traceJsonArray(payload.content), "user");
    if (!text || isCodexSyntheticUserText(text)) {
      continue;
    }
    title = truncateTraceText(text, 96) ?? undefined;
  }
  if (!threadId) {
    return null;
  }
  const indexEntry = index.get(threadId);
  const fallbackUpdatedAt = typeof fallbackMtimeMs === "number" && fallbackMtimeMs > 0
    ? new Date(fallbackMtimeMs).toISOString()
    : await fs.stat(sourcePath)
      .then((stat) => stat.mtime.toISOString())
      .catch(() => undefined);
  return {
    threadId,
    ...(indexEntry?.title || title ? { title: indexEntry?.title ?? title } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    updatedAt: indexEntry?.updatedAt ?? endedAt ?? fallbackUpdatedAt,
  };
}

function codexSummaryToRef(
  codexHome: string,
  indexPath: string,
  sourcePath: string,
  summary: CodexSessionSummary,
): LocalTraceRef {
  return {
    provider: CODEX_LOCAL_TRACE_PROVIDER,
    traceId: `codex:${summary.threadId}:${localTraceShortHash(sourcePath)}`,
    sourcePath,
    profileRoot: codexHome,
    indexPath,
    sessionId: summary.threadId,
    ...(summary.title ? { title: summary.title } : {}),
    ...(summary.workspaceRoot ? { workspaceRoot: summary.workspaceRoot } : {}),
    ...(summary.startedAt ? { startedAt: summary.startedAt } : {}),
    ...(summary.endedAt ? { endedAt: summary.endedAt } : {}),
    ...(summary.updatedAt ? { updatedAt: summary.updatedAt } : {}),
  };
}

function extractCodexMessageText(
  content: JsonValue[],
  role: "user" | "assistant",
): string | null {
  const chunks: string[] = [];
  for (const entry of content) {
    const block = traceJsonObject(entry);
    const type = traceString(block?.type);
    if (role === "user" && type === "input_text") {
      const text = normalizeTraceText(traceString(block?.text));
      if (text) {
        chunks.push(text);
      }
    }
    if (role === "assistant" && type === "output_text") {
      const text = normalizeTraceText(traceString(block?.text));
      if (text) {
        chunks.push(text);
      }
    }
  }
  return chunks.length > 0 ? chunks.join("\n\n") : null;
}

function isCodexSyntheticUserText(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith("<user_instructions>") ||
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("# AGENTS.md instructions for ") ||
    trimmed.startsWith("# AGENTS instructions for ")
  );
}

function codexToolFromPayload(
  payload: JsonObject,
  status: "started" | "completed",
  maxTextChars: number,
  maxToolOutputChars: number,
): LocalTraceTimelineTool {
  const input = readCodexToolInput(payload, maxTextChars);
  const output = readCodexToolOutput(payload, maxToolOutputChars);
  const error = truncateTraceText(readCodexToolError(payload), maxTextChars) ?? undefined;
  const command = readToolCommand(payload, input);
  const cwd = readCodexString(payload, [["cwd"], ["item", "cwd"]]) ?? readToolCwd(input);
  const exitCode =
    traceNumber(payload.exit_code) ??
    traceNumber(payload.exitCode) ??
    traceNumber(readCodexValue(payload, ["result", "exit_code"])) ??
    traceNumber(readCodexValue(payload, ["result", "exitCode"])) ??
    undefined;
  return {
    status,
    ...(readCodexToolId(payload) ? { id: readCodexToolId(payload) as string } : {}),
    ...(readCodexToolName(payload) ? { name: readCodexToolName(payload) as string } : {}),
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(error ? { error } : {}),
    ...(command ? { command } : {}),
    ...(cwd ? { cwd } : {}),
    ...(typeof exitCode === "number" ? { exitCode } : {}),
  };
}

function readCodexValue(
  payload: JsonObject | null | undefined,
  segments: string[],
): JsonValue | undefined {
  let current: JsonValue | undefined = payload ?? undefined;
  for (const segment of segments) {
    if (!current || Array.isArray(current) || typeof current !== "object") {
      return undefined;
    }
    current = (current as JsonObject)[segment];
  }
  return current;
}

function readCodexString(
  payload: JsonObject | null | undefined,
  paths: string[][],
): string | null {
  for (const itemPath of paths) {
    const value = readCodexValue(payload, itemPath);
    const text = traceString(value);
    if (text) {
      return text;
    }
  }
  return null;
}

function readCodexToolId(payload: JsonObject): string | null {
  return readCodexString(payload, [
    ["id"],
    ["item", "id"],
    ["call_id"],
    ["callId"],
    ["toolCall", "id"],
    ["tool_call", "id"],
    ["call", "id"],
  ]);
}

function readCodexToolName(payload: JsonObject): string | null {
  return readCodexString(payload, [
    ["name"],
    ["item", "name"],
    ["toolName"],
    ["tool_name"],
    ["tool", "name"],
    ["call", "name"],
    ["invocation", "tool"],
    ["item", "invocation", "tool"],
    ["title"],
    ["item", "title"],
  ]);
}

function readCodexToolInput(payload: JsonObject, maxTextChars: number): JsonValue | undefined {
  const raw =
    readCodexValue(payload, ["arguments"]) ??
    readCodexValue(payload, ["item", "arguments"]) ??
    readCodexValue(payload, ["invocation", "arguments"]) ??
    readCodexValue(payload, ["item", "invocation", "arguments"]) ??
    readCodexValue(payload, ["input"]) ??
    readCodexValue(payload, ["item", "input"]);
  if (raw !== undefined) {
    return truncateTraceJsonValue(normalizeCodexJsonValue(raw), { maxTextChars });
  }
  const command = readCodexValue(payload, ["command"]);
  const cwd = traceString(payload.cwd);
  const fallback: JsonObject = {};
  if (command !== undefined) {
    fallback.command = command;
  }
  if (cwd) {
    fallback.cwd = cwd;
  }
  return Object.keys(fallback).length > 0
    ? truncateTraceJsonValue(fallback, { maxTextChars })
    : undefined;
}

function readCodexToolOutput(
  payload: JsonObject,
  maxTextChars: number,
): JsonValue | undefined {
  const result =
    readCodexValue(payload, ["result"]) ??
    readCodexValue(payload, ["item", "result"]) ??
    readCodexValue(payload, ["output"]) ??
    readCodexValue(payload, ["item", "output"]);
  if (result !== undefined) {
    return truncateTraceJsonValue(normalizeCodexJsonValue(result), { maxTextChars });
  }
  const aggregatedOutput = readCodexString(payload, [
    ["aggregated_output"],
    ["aggregatedOutput"],
    ["item", "aggregatedOutput"],
  ]);
  return truncateTraceText(aggregatedOutput, maxTextChars) ?? undefined;
}

function readCodexToolError(payload: JsonObject): string | null {
  const status = readCodexString(payload, [["status"], ["item", "status"]]);
  const errorText = readCodexString(payload, [
    ["error"],
    ["errorText"],
    ["stderr"],
    ["formatted_output"],
    ["formattedOutput"],
  ]);
  if (errorText) {
    return errorText;
  }
  if (status === "failed" || status === "error") {
    return readCodexString(payload, [
      ["aggregated_output"],
      ["aggregatedOutput"],
      ["output"],
    ]);
  }
  return null;
}

function normalizeCodexJsonValue(value: JsonValue): JsonValue {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!/^[\[{"]/u.test(trimmed)) {
    return value;
  }
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return value;
  }
}

function readToolCommand(
  payload: JsonObject,
  input: JsonValue | undefined,
): string | undefined {
  const direct = readCodexValue(payload, ["command"]);
  if (Array.isArray(direct)) {
    return direct.map((part) => String(part)).join(" ");
  }
  if (typeof direct === "string") {
    return direct;
  }
  const inputRecord = traceJsonObject(input);
  const command = traceString(inputRecord?.cmd) ?? traceString(inputRecord?.command);
  if (command) {
    return command;
  }
  const commandArray = inputRecord?.command;
  if (Array.isArray(commandArray)) {
    return commandArray.map((part) => String(part)).join(" ");
  }
  return undefined;
}

function readToolCwd(input: JsonValue | undefined): string | undefined {
  const inputRecord = traceJsonObject(input);
  return traceString(inputRecord?.cwd) ??
    traceString(inputRecord?.workdir) ??
    undefined;
}
