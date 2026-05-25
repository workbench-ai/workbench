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

const CLAUDE_LOCAL_TRACE_PROVIDER = "claude";
const CLAUDE_LOCAL_TRACE_DISPLAY = "Anthropic Claude Code";

interface ClaudeSessionSummary {
  sessionId: string;
  sourcePath: string;
  indexPath?: string;
  title?: string;
  workspaceRoot?: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt?: string;
}

export const claudeLocalTraceAdapter: LocalTraceAdapter = {
  id: CLAUDE_LOCAL_TRACE_PROVIDER,
  displayName: CLAUDE_LOCAL_TRACE_DISPLAY,
  async discoverLocalTraces(context = {}) {
    const requested = parseClaudeTraceId(context.traceId);
    if (context.traceId && !requested) {
      return [];
    }
    const homeRoot = resolveClaudeHomeRoot(context.env);
    const projectsRoot = path.join(homeRoot, ".claude", "projects");
    const summaries = await readClaudeSessionSummaries(projectsRoot);
    const refs: LocalTraceRef[] = [];
    for (const summary of summaries) {
      if (
        requested &&
        (summary.sessionId !== requested.sessionId ||
          localTraceShortHash(summary.sourcePath) !== requested.sourceHash)
      ) {
        continue;
      }
      const ref = claudeSummaryToRef(homeRoot, summary);
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
    }
    const sorted = sortLocalTraceRefs(refs);
    return typeof context.limit === "number" && context.limit > 0
      ? sorted.slice(0, context.limit)
      : sorted;
  },
  async readLocalTraceDigest(ref, context = {}) {
    const records = await readLocalTraceJsonLines(ref.sourcePath);
    const maxTextChars = context.maxTextChars ?? 4_000;
    const maxToolOutputChars = context.maxToolOutputChars ?? Math.min(maxTextChars, 1_000);
    const timeline: AgentReadableTraceTimelineEntry[] = [];
    const toolEntryById = new Map<string, AgentReadableTraceTimelineEntry>();
    const artifacts = createEmptyTraceArtifacts();
    let goal: string | undefined;

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
      const type = traceString(record.type);
      const at = traceString(record.timestamp);
      if (type === "user" || type === "assistant") {
        const message = traceJsonObject(record.message);
        const role = traceString(message?.role);
        if (role !== "user" && role !== "assistant") {
          continue;
        }
        const text = truncateTraceText(extractClaudeMessageText(message), maxTextChars);
        if (text) {
          if (role === "user" && !goal) {
            goal = truncateTraceText(text, 300) ?? undefined;
          }
          pushEntry({
            type: role,
            ...(at ? { at } : {}),
            text,
            raw: { type },
          });
        }
        for (const tool of extractClaudeTools(message, role, maxTextChars, maxToolOutputChars)) {
          pushToolEntry(tool, at, type);
        }
        continue;
      }
      if (type === "system" && traceString(record.subtype) === "error") {
        const message = truncateTraceText(traceString(record.message), maxTextChars);
        if (message) {
          appendUnique(artifacts.errors, message);
          pushEntry({
            type: "error",
            ...(at ? { at } : {}),
            text: message,
            raw: { type: "system.error" },
          });
        }
      }
    }

    return buildAgentReadableTraceDigest({
      provider: CLAUDE_LOCAL_TRACE_PROVIDER,
      ref,
      ...(goal ? { goal } : {}),
      timeline,
      artifacts,
    });
  },
};

function parseClaudeTraceId(
  traceId: string | undefined,
): { sessionId: string; sourceHash: string } | null {
  if (!traceId) {
    return null;
  }
  const [provider, sessionId, sourceHash, ...extra] = traceId.split(":");
  if (
    provider !== CLAUDE_LOCAL_TRACE_PROVIDER ||
    !sessionId ||
    !sourceHash ||
    extra.length > 0
  ) {
    return null;
  }
  return { sessionId, sourceHash };
}

function resolveClaudeHomeRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.AGENT_RUNTIME_CLAUDE_HOME?.trim();
  if (explicit) {
    return path.resolve(expandLocalTraceHomePath(explicit, env));
  }
  return localTraceHomeDir(env);
}

async function readClaudeSessionSummaries(
  projectsRoot: string,
): Promise<ClaudeSessionSummary[]> {
  const projectEntries = await fs.readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
  const summaries: ClaudeSessionSummary[] = [];
  const seenPaths = new Set<string>();
  for (const entry of projectEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const projectRoot = path.join(projectsRoot, entry.name);
    const indexPath = path.join(projectRoot, "sessions-index.json");
    for (const summary of await readClaudeIndexSummaries(indexPath)) {
      if (seenPaths.has(summary.sourcePath)) {
        continue;
      }
      seenPaths.add(summary.sourcePath);
      summaries.push(summary);
    }
    const direct = await summarizeClaudeProjectJsonlFiles(projectRoot, seenPaths);
    summaries.push(...direct);
  }
  return summaries;
}

async function readClaudeIndexSummaries(
  indexPath: string,
): Promise<ClaudeSessionSummary[]> {
  const raw = await fs.readFile(indexPath, "utf8").catch(() => null);
  if (!raw) {
    return [];
  }
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(raw) as JsonValue;
  } catch {
    return [];
  }
  const entries = normalizeClaudeIndexEntries(parsed);
  const summaries: ClaudeSessionSummary[] = [];
  for (const entry of entries) {
    const sessionId = traceString(entry.sessionId);
    const sourcePath = traceString(entry.fullPath);
    if (!sessionId || !sourcePath || !(await pathExists(sourcePath))) {
      continue;
    }
    const title =
      truncateTraceText(traceString(entry.summary), 96) ??
      truncateTraceText(traceString(entry.firstPrompt), 96) ??
      undefined;
    summaries.push({
      sessionId,
      sourcePath,
      indexPath,
      ...(title ? { title } : {}),
      ...(traceString(entry.projectPath) ? { workspaceRoot: path.resolve(traceString(entry.projectPath) as string) } : {}),
      ...(traceString(entry.created) ? { startedAt: traceString(entry.created) as string } : {}),
      ...(traceString(entry.modified) ?? traceString(entry.created) ? { updatedAt: (traceString(entry.modified) ?? traceString(entry.created)) as string } : {}),
    });
  }
  return summaries;
}

function normalizeClaudeIndexEntries(value: JsonValue): JsonObject[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const record = traceJsonObject(entry);
      return record ? [record] : [];
    });
  }
  const record = traceJsonObject(value);
  return traceJsonArray(record?.entries).flatMap((entry) => {
    const item = traceJsonObject(entry);
    return item ? [item] : [];
  });
}

async function summarizeClaudeProjectJsonlFiles(
  projectRoot: string,
  seenPaths: Set<string>,
): Promise<ClaudeSessionSummary[]> {
  const entries = await fs.readdir(projectRoot, { withFileTypes: true }).catch(() => []);
  const summaries: ClaudeSessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const sourcePath = path.join(projectRoot, entry.name);
    if (seenPaths.has(sourcePath)) {
      continue;
    }
    const summary = await summarizeClaudeSessionFile(sourcePath);
    if (!summary) {
      continue;
    }
    seenPaths.add(sourcePath);
    summaries.push(summary);
  }
  return summaries;
}

async function summarizeClaudeSessionFile(
  sourcePath: string,
): Promise<ClaudeSessionSummary | null> {
  const records = await readLocalTraceJsonLines(sourcePath).catch(() => []);
  let sessionId: string | undefined;
  let workspaceRoot: string | undefined;
  let title: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  for (const record of records) {
    sessionId ??= traceString(record.sessionId) ?? undefined;
    const cwd = traceString(record.cwd);
    if (!workspaceRoot && cwd) {
      workspaceRoot = path.resolve(cwd);
    }
    const timestamp = traceString(record.timestamp);
    if (timestamp) {
      startedAt ??= timestamp;
      endedAt = timestamp;
    }
    if (title) {
      continue;
    }
    if (traceString(record.type) === "last-prompt") {
      title = truncateTraceText(traceString(record.lastPrompt), 96) ?? undefined;
      continue;
    }
    if (traceString(record.type) !== "user") {
      continue;
    }
    const message = traceJsonObject(record.message);
    if (traceString(message?.role) !== "user") {
      continue;
    }
    title = truncateTraceText(extractClaudeMessageText(message), 96) ?? undefined;
  }
  sessionId ??= path.basename(sourcePath, ".jsonl");
  const fallbackUpdatedAt = await fs.stat(sourcePath)
    .then((stat) => stat.mtime.toISOString())
    .catch(() => undefined);
  return {
    sessionId,
    sourcePath,
    ...(title ? { title } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    updatedAt: endedAt ?? fallbackUpdatedAt,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  return await fs.stat(filePath)
    .then(() => true)
    .catch(() => false);
}

function claudeSummaryToRef(
  homeRoot: string,
  summary: ClaudeSessionSummary,
): LocalTraceRef {
  return {
    provider: CLAUDE_LOCAL_TRACE_PROVIDER,
    traceId: `claude:${summary.sessionId}:${localTraceShortHash(summary.sourcePath)}`,
    sourcePath: summary.sourcePath,
    profileRoot: homeRoot,
    sessionId: summary.sessionId,
    ...(summary.indexPath ? { indexPath: summary.indexPath } : {}),
    ...(summary.title ? { title: summary.title } : {}),
    ...(summary.workspaceRoot ? { workspaceRoot: summary.workspaceRoot } : {}),
    ...(summary.startedAt ? { startedAt: summary.startedAt } : {}),
    ...(summary.endedAt ? { endedAt: summary.endedAt } : {}),
    ...(summary.updatedAt ? { updatedAt: summary.updatedAt } : {}),
  };
}

function extractClaudeMessageText(message: JsonObject | null): string | null {
  if (!message) {
    return null;
  }
  const direct = normalizeTraceText(traceString(message.content));
  if (direct) {
    return direct;
  }
  const chunks: string[] = [];
  for (const block of traceJsonArray(message.content)) {
    const item = traceJsonObject(block);
    if (traceString(item?.type) !== "text") {
      continue;
    }
    const text = normalizeTraceText(traceString(item?.text));
    if (text) {
      chunks.push(text);
    }
  }
  return chunks.length > 0 ? chunks.join("\n\n") : null;
}

function extractClaudeTools(
  message: JsonObject | null,
  role: "user" | "assistant",
  maxTextChars: number,
  maxToolOutputChars: number,
): LocalTraceTimelineTool[] {
  if (!message) {
    return [];
  }
  const tools: LocalTraceTimelineTool[] = [];
  for (const block of traceJsonArray(message.content)) {
    const item = traceJsonObject(block);
    const type = traceString(item?.type);
    if (role === "assistant" && type === "tool_use") {
      const rawInput = item?.input;
      const input = rawInput === undefined
        ? undefined
        : truncateTraceJsonValue(rawInput, { maxTextChars });
      const command = readToolCommand(rawInput);
      tools.push({
        status: "started",
        ...(traceString(item?.id) ? { id: traceString(item?.id) as string } : {}),
        ...(traceString(item?.name) ? { name: traceString(item?.name) as string } : {}),
        ...(input !== undefined ? { input } : {}),
        ...(command ? { command } : {}),
        ...(readToolCwd(input) ? { cwd: readToolCwd(input) as string } : {}),
      });
      continue;
    }
    if (role === "user" && type === "tool_result") {
      const output = truncateTraceText(extractClaudeToolResultText(item), maxToolOutputChars);
      const isError = item?.is_error === true || item?.isError === true;
      tools.push({
        status: "completed",
        ...(traceString(item?.tool_use_id) ?? traceString(item?.toolUseId)
          ? { id: (traceString(item?.tool_use_id) ?? traceString(item?.toolUseId)) as string }
          : {}),
        ...(output ? { output } : {}),
        ...(isError && output ? { error: output } : {}),
      });
    }
  }
  return tools;
}

function extractClaudeToolResultText(item: JsonObject | null): string | null {
  if (!item) {
    return null;
  }
  const direct = normalizeTraceText(traceString(item.content));
  if (direct) {
    return direct;
  }
  const chunks: string[] = [];
  for (const block of traceJsonArray(item.content)) {
    const record = traceJsonObject(block);
    if (traceString(record?.type) !== "text") {
      continue;
    }
    const text = normalizeTraceText(traceString(record?.text));
    if (text) {
      chunks.push(text);
    }
  }
  return chunks.length > 0 ? chunks.join("\n\n") : null;
}

function readToolCommand(input: JsonValue | undefined): string | undefined {
  const record = traceJsonObject(input);
  if (!record) {
    return undefined;
  }
  return traceString(record.command) ?? traceString(record.cmd) ?? undefined;
}

function readToolCwd(input: JsonValue | undefined): string | undefined {
  const record = traceJsonObject(input);
  if (!record) {
    return undefined;
  }
  return traceString(record.cwd) ??
    traceString(record.workdir) ??
    undefined;
}
