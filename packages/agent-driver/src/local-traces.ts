import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { JsonObject, JsonValue } from "./types.js";

export type LocalTraceTimelineEntryType =
  | "user"
  | "assistant"
  | "tool"
  | "system"
  | "error";

export interface LocalTraceDiscoveryContext {
  env?: NodeJS.ProcessEnv;
  traceId?: string;
  workspaceRoot?: string;
  since?: Date;
  limit?: number;
}

export interface LocalTraceReadContext {
  env?: NodeJS.ProcessEnv;
  maxTextChars?: number;
  maxToolOutputChars?: number;
}

export interface LocalTraceRef {
  provider: string;
  traceId: string;
  sourcePath: string;
  profileRoot?: string;
  indexPath?: string;
  sessionId?: string;
  title?: string;
  workspaceRoot?: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt?: string;
}

export interface LocalTraceTimelineTool {
  id?: string;
  name?: string;
  status?: "started" | "completed";
  input?: JsonValue;
  output?: JsonValue;
  error?: string;
  command?: string;
  cwd?: string;
  exitCode?: number;
  files?: string[];
}

export interface AgentReadableTraceTimelineEntry {
  index: number;
  type: LocalTraceTimelineEntryType;
  at?: string;
  text?: string;
  phase?: string;
  tool?: LocalTraceTimelineTool;
  raw?: {
    type?: string;
    source?: string;
  };
}

export interface AgentReadableTraceArtifacts {
  tools: string[];
  commands: string[];
  files: string[];
  urls: string[];
  errors: string[];
}

export interface AgentReadableTraceDigest {
  version: 1;
  provider: string;
  traceId: string;
  source: {
    kind: "local";
    path: string;
    profileRoot?: string;
    indexPath?: string;
  };
  sessionId?: string;
  title?: string;
  workspaceRoot?: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt?: string;
  goal?: string;
  timeline: AgentReadableTraceTimelineEntry[];
  artifacts: AgentReadableTraceArtifacts;
  counts: {
    timelineEntries: number;
    userMessages: number;
    assistantMessages: number;
    toolEvents: number;
    errors: number;
  };
}

export interface LocalTraceAdapter {
  readonly id: string;
  readonly displayName: string;
  discoverLocalTraces(context?: LocalTraceDiscoveryContext): Promise<LocalTraceRef[]>;
  readLocalTraceDigest(
    ref: LocalTraceRef,
    context?: LocalTraceReadContext,
  ): Promise<AgentReadableTraceDigest>;
}

export async function readLocalTraceJsonLines(filePath: string): Promise<JsonObject[]> {
  const text = await fs.readFile(filePath, "utf8");
  const records: JsonObject[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as JsonValue;
      const record = traceJsonObject(parsed);
      if (record) {
        records.push(record);
      }
    } catch {
      // Ignore malformed tail records from sessions that may still be active.
    }
  }
  return records;
}

export function traceJsonObject(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

export function traceJsonArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function traceString(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

export function traceNumber(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeTraceText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\r\n/gu, "\n").trim();
  return normalized.length > 0 ? normalized : null;
}

export function truncateTraceText(
  value: string | null | undefined,
  maxChars = 4_000,
): string | null {
  const normalized = normalizeTraceText(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxChars - 32)).trimEnd()}\n...[truncated]`;
}

export interface TraceJsonTruncationOptions {
  maxTextChars?: number;
  maxDepth?: number;
  maxArrayItems?: number;
  maxObjectEntries?: number;
}

export function truncateTraceJsonValue(
  value: JsonValue,
  options: TraceJsonTruncationOptions = {},
): JsonValue {
  const limits = {
    maxTextChars: options.maxTextChars ?? 4_000,
    maxDepth: options.maxDepth ?? 6,
    maxArrayItems: options.maxArrayItems ?? 50,
    maxObjectEntries: options.maxObjectEntries ?? 50,
  };
  return truncateTraceJsonValueInner(value, limits, 0);
}

function truncateTraceJsonValueInner(
  value: JsonValue,
  limits: Required<TraceJsonTruncationOptions>,
  depth: number,
): JsonValue {
  if (typeof value === "string") {
    return truncateTraceText(value, limits.maxTextChars) ?? "";
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (depth >= limits.maxDepth) {
    return "[truncated nested JSON]";
  }
  if (Array.isArray(value)) {
    const result = value
      .slice(0, limits.maxArrayItems)
      .map((entry) => truncateTraceJsonValueInner(entry, limits, depth + 1));
    if (value.length > limits.maxArrayItems) {
      result.push(`...[${value.length - limits.maxArrayItems} more item(s) truncated]`);
    }
    return result;
  }
  const result: JsonObject = {};
  const entries = Object.entries(value);
  for (const [key, entry] of entries.slice(0, limits.maxObjectEntries)) {
    result[key] = truncateTraceJsonValueInner(entry, limits, depth + 1);
  }
  if (entries.length > limits.maxObjectEntries) {
    result.__truncated = `${entries.length - limits.maxObjectEntries} more field(s) truncated`;
  }
  return result;
}

export function sortLocalTraceRefs(refs: readonly LocalTraceRef[]): LocalTraceRef[] {
  return [...refs].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt ?? left.endedAt ?? left.startedAt ?? "");
    const rightTime = Date.parse(right.updatedAt ?? right.endedAt ?? right.startedAt ?? "");
    const leftValue = Number.isFinite(leftTime) ? leftTime : 0;
    const rightValue = Number.isFinite(rightTime) ? rightTime : 0;
    return rightValue - leftValue || left.traceId.localeCompare(right.traceId);
  });
}

export function localTraceHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME?.trim() || os.homedir();
}

export function expandLocalTraceHomePath(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (value === "~") {
    return localTraceHomeDir(env);
  }
  if (value.startsWith("~/")) {
    return path.join(localTraceHomeDir(env), value.slice(2));
  }
  return value;
}

export function localTraceRefIsAtOrAfter(ref: LocalTraceRef, since: Date): boolean {
  const value = Date.parse(ref.updatedAt ?? ref.endedAt ?? ref.startedAt ?? "");
  return Number.isFinite(value) && value >= since.getTime();
}

export function localTraceRefMatchesWorkspace(
  ref: LocalTraceRef,
  workspaceRoot: string | undefined,
): boolean {
  if (!workspaceRoot) {
    return true;
  }
  if (!ref.workspaceRoot) {
    return false;
  }
  const requested = path.resolve(workspaceRoot);
  const candidate = path.resolve(ref.workspaceRoot);
  const relative = path.relative(requested, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function appendUnique(values: string[], value: string | null | undefined): void {
  const normalized = normalizeTraceText(value);
  if (!normalized || values.includes(normalized)) {
    return;
  }
  values.push(normalized);
}

export function createEmptyTraceArtifacts(): AgentReadableTraceArtifacts {
  return {
    tools: [],
    commands: [],
    files: [],
    urls: [],
    errors: [],
  };
}

export function collectTraceToolArtifacts(
  artifacts: AgentReadableTraceArtifacts,
  tool: LocalTraceTimelineTool,
): void {
  appendUnique(artifacts.tools, tool.name);
  appendUnique(artifacts.commands, tool.command);
  appendUnique(artifacts.files, tool.cwd);
  appendUnique(artifacts.errors, tool.error);
  for (const file of tool.files ?? []) {
    appendUnique(artifacts.files, file);
  }
  collectTraceJsonArtifacts(artifacts, tool.input);
  collectTraceJsonArtifacts(artifacts, tool.output);
}

export function mergeLocalTraceTimelineTool(
  existing: LocalTraceTimelineTool,
  next: LocalTraceTimelineTool,
): LocalTraceTimelineTool {
  const merged: LocalTraceTimelineTool = { ...existing };
  if (next.status) {
    merged.status = next.status;
  }
  if (next.id) {
    merged.id = next.id;
  }
  if (next.name) {
    merged.name = next.name;
  }
  if (next.input !== undefined) {
    merged.input = next.input;
  }
  if (next.output !== undefined) {
    merged.output = next.output;
  }
  if (next.error) {
    merged.error = next.error;
  }
  if (next.command) {
    merged.command = next.command;
  }
  if (next.cwd) {
    merged.cwd = next.cwd;
  }
  if (typeof next.exitCode === "number") {
    merged.exitCode = next.exitCode;
  }
  if (next.files?.length) {
    const files = [...(merged.files ?? [])];
    for (const file of next.files) {
      appendUnique(files, file);
    }
    merged.files = files;
  }
  return merged;
}

export function mergeLocalTraceRawType(existing: string | undefined, next: string): string {
  if (!existing || existing === next) {
    return next;
  }
  if (existing.split("+").includes(next)) {
    return existing;
  }
  return `${existing}+${next}`;
}

export function collectTraceJsonArtifacts(
  artifacts: AgentReadableTraceArtifacts,
  value: JsonValue | undefined,
): void {
  if (value == null) {
    return;
  }
  if (typeof value === "string") {
    collectTraceUrls(artifacts, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectTraceJsonArtifacts(artifacts, entry);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      if (/^(?:path|file|filename|cwd|workdir)$/iu.test(key)) {
        appendUnique(artifacts.files, entry);
      }
      if (/^(?:url|uri)$/iu.test(key)) {
        appendUnique(artifacts.urls, entry);
      }
      collectTraceUrls(artifacts, entry);
      continue;
    }
    collectTraceJsonArtifacts(artifacts, entry);
  }
}

export function collectTraceUrls(
  artifacts: AgentReadableTraceArtifacts,
  value: string,
): void {
  for (const match of value.matchAll(/https?:\/\/[^\s)"']+/gu)) {
    appendUnique(artifacts.urls, match[0]);
  }
}

export function buildAgentReadableTraceDigest(args: {
  provider: string;
  ref: LocalTraceRef;
  goal?: string;
  timeline: AgentReadableTraceTimelineEntry[];
  artifacts: AgentReadableTraceArtifacts;
}): AgentReadableTraceDigest {
  return {
    version: 1,
    provider: args.provider,
    traceId: args.ref.traceId,
    source: {
      kind: "local",
      path: args.ref.sourcePath,
      ...(args.ref.profileRoot ? { profileRoot: args.ref.profileRoot } : {}),
      ...(args.ref.indexPath ? { indexPath: args.ref.indexPath } : {}),
    },
    ...(args.ref.sessionId ? { sessionId: args.ref.sessionId } : {}),
    ...(args.ref.title ? { title: args.ref.title } : {}),
    ...(args.ref.workspaceRoot ? { workspaceRoot: args.ref.workspaceRoot } : {}),
    ...(args.ref.startedAt ? { startedAt: args.ref.startedAt } : {}),
    ...(args.ref.endedAt ? { endedAt: args.ref.endedAt } : {}),
    ...(args.ref.updatedAt ? { updatedAt: args.ref.updatedAt } : {}),
    ...(args.goal ? { goal: args.goal } : {}),
    timeline: args.timeline,
    artifacts: args.artifacts,
    counts: {
      timelineEntries: args.timeline.length,
      userMessages: args.timeline.filter((entry) => entry.type === "user").length,
      assistantMessages: args.timeline.filter((entry) => entry.type === "assistant").length,
      toolEvents: args.timeline.filter((entry) => entry.type === "tool").length,
      errors: args.timeline.filter((entry) => entry.type === "error").length,
    },
  };
}

export function localTraceShortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
