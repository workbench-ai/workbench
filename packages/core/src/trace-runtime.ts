import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  Json,
  SurfaceSnapshotFile,
  UsageSummary,
  WorkbenchTrace,
  WorkbenchTraceEvent,
  WorkbenchTraceInput,
  WorkbenchTraceLifecycleStatus,
  WorkbenchTraceLink,
  WorkbenchTraceOrigin,
  WorkbenchTraceOutput,
  WorkbenchTraceReview,
  WorkbenchTraceReviewStatus,
  WorkbenchTraceSource,
  WorkbenchTraceSpan,
  WorkbenchTraceSubject,
} from "@workbench-ai/workbench-contract";

const WORKBENCH_DIR = ".workbench";
const TRACE_RUNTIME_DIR = "traces";
const TRACE_RECORDS_DIR = "records";
const TRACE_CANDIDATES_DIR = "candidates";
const TRACE_SPOOL_DIR = "spool";
const TRACE_SPOOL_EVENTS_FILE = "events.jsonl";
const TRACE_SPOOL_LOCK_FILE = "events.jsonl.lock";
const TRACE_RECORDING_CONFIG_FILE = "recording.json";
const TRACE_PROTOCOL = "workbench.trace.v1";
const RECORDING_PROTOCOL = "workbench.trace-recording.v1";
const TRACE_SPOOL_PROTOCOL = "workbench.trace-spool.v1";
const TRACE_SPOOL_LOCK_TIMEOUT_MS = 5_000;
const TRACE_SPOOL_LOCK_STALE_MS = 30_000;
const TRACE_SPOOL_LOCK_RETRY_MS = 10;

export interface WorkbenchTraceRuntimeOptions {
  homeDir?: string;
  projectRoot?: string;
}

export interface WorkbenchTraceRecordingConfig {
  schema: typeof RECORDING_PROTOCOL;
  enabled: boolean;
  hosts: string[];
  updatedAt: string;
  command?: string;
}

export interface WorkbenchTraceSpoolEvent {
  schema: typeof TRACE_SPOOL_PROTOCOL;
  id: string;
  at: string;
  source: WorkbenchTraceSource;
  kind: "prompt" | "claim" | "stop" | "discard" | "event";
  message?: string;
  input?: WorkbenchTraceInput;
  output?: WorkbenchTraceOutput;
  subject?: WorkbenchTraceSubject;
  status?: WorkbenchTraceCandidateCloseInput["status"];
  attributes?: Record<string, Json>;
  raw?: Json;
}

export interface WorkbenchTraceSpoolStats {
  read: number;
  written: number;
  closed: number;
  discarded: number;
  invalid: number;
}

export interface WorkbenchTraceRecordInput {
  id?: string;
  origin: WorkbenchTraceOrigin;
  source?: WorkbenchTraceSource;
  subjects?: readonly WorkbenchTraceSubject[];
  links?: readonly WorkbenchTraceLink[];
  input?: WorkbenchTraceInput;
  output?: WorkbenchTraceOutput;
  request?: Json;
  result?: Json;
  files?: readonly SurfaceSnapshotFile[];
  artifacts?: readonly SurfaceSnapshotFile[];
  usage?: UsageSummary;
  review?: WorkbenchTraceReview;
  status?: Partial<WorkbenchTraceLifecycleStatus>;
  createdAt?: string;
  updatedAt?: string;
  runId?: string;
  jobId?: string;
  versionId?: string;
  skillName?: string;
  skillBundleHash?: string;
  evalHash?: string;
  agentName?: string;
  agentHash?: string;
}

export interface WorkbenchTraceCandidateKeyInput {
  source: WorkbenchTraceSource;
}

export interface WorkbenchTraceCandidateEventInput {
  source: WorkbenchTraceSource;
  kind: WorkbenchTraceEvent["kind"];
  message: string;
  attributes?: Record<string, Json>;
  at?: string;
}

export interface WorkbenchTraceCandidateCloseInput {
  source: WorkbenchTraceSource;
  output?: WorkbenchTraceOutput;
  result?: Json;
  status?: "completed" | "failed" | "canceled" | "unknown";
  at?: string;
}

export interface WorkbenchTraceReviewInput {
  traceId: string;
  status: WorkbenchTraceReviewStatus;
  note?: string;
  tags?: readonly string[];
  expected?: string;
  reviewer?: string;
}

export type WorkbenchTraceReviewUpdate = Omit<WorkbenchTraceReviewInput, "traceId"> & {
  reviewedAt?: string;
};

export function workbenchTraceRuntimeRoot(options: WorkbenchTraceRuntimeOptions = {}): string {
  return path.join(options.homeDir ?? os.homedir(), WORKBENCH_DIR, TRACE_RUNTIME_DIR);
}

export function workbenchProjectTraceRuntimeRoot(projectRoot: string): string {
  return path.join(projectRoot, WORKBENCH_DIR, TRACE_RUNTIME_DIR);
}

export function createWorkbenchTraceId(): string {
  return `tr_${randomBytes(6).toString("hex")}`;
}

export function createWorkbenchTraceRecord(args: WorkbenchTraceRecordInput): WorkbenchTrace {
  const createdAt = args.createdAt ?? args.updatedAt ?? new Date().toISOString();
  const id = args.id ?? createWorkbenchTraceId();
  const subjects = args.subjects?.map(copyTraceSubject) ?? [];
  const skillSubject = subjects.find((subject) => subject.type === "skill");
  const agentSubject = subjects.find((subject) => subject.type === "agent");
  const links = args.links?.map(copyTraceLink) ?? [];
  const source = args.source ? { ...args.source } : undefined;
  const input = args.input ? copyTraceInput(args.input) : undefined;
  const output = args.output ? { ...args.output } : undefined;
  const artifacts = args.artifacts?.map(copyFile) ?? [];
  const files = args.files?.map(copyFile) ?? [];
  const status = defaultWorkbenchTraceStatus(args.origin, args.status);
  const turnSpan = createTurnSpan(id, createdAt, source);
  const request = args.request ?? {
    protocol: TRACE_PROTOCOL,
    origin: args.origin,
    ...(source ? { source: source as unknown as Json } : {}),
    ...(input ? { input: input as unknown as Json } : {}),
    ...(subjects.length > 0 ? { subjects: subjects as unknown as Json } : {}),
    ...(links.length > 0 ? { links: links as unknown as Json } : {}),
  } satisfies Record<string, Json>;
  const result = args.result ?? {
    status: status.execution,
    ...(output ? { output: output as unknown as Json } : {}),
    ...(args.usage ? { usage: args.usage as unknown as Json } : {}),
  } satisfies Record<string, Json>;
  return {
    id,
    runId: args.runId ?? firstLinkId(links, "run") ?? source?.sessionId ?? "live",
    ...(args.jobId ?? firstLinkId(links, "job") ? { jobId: args.jobId ?? firstLinkId(links, "job") } : {}),
    versionId: args.versionId ?? skillSubject?.versionId ?? firstLinkId(links, "version") ?? "unknown",
    skillName: args.skillName ?? skillSubject?.id ?? "unknown",
    skillBundleHash: args.skillBundleHash ?? "unknown",
    ...(args.evalHash ? { evalHash: args.evalHash } : {}),
    agentName: args.agentName ?? agentSubject?.id ?? source?.host ?? "unknown",
    ...(args.agentHash ? { agentHash: args.agentHash } : {}),
    createdAt,
    request,
    result,
    files,
    protocol: TRACE_PROTOCOL,
    origin: args.origin,
    updatedAt: args.updatedAt ?? createdAt,
    ...(source ? { source } : {}),
    status,
    ...(subjects.length > 0 ? { subjects } : {}),
    ...(links.length > 0 ? { links } : {}),
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    spans: [turnSpan],
    events: [],
    ...(args.usage ? { usage: JSON.parse(JSON.stringify(args.usage)) as UsageSummary } : {}),
    ...(artifacts.length > 0 ? { artifacts } : {}),
    review: args.review ? copyTraceReview(args.review) : { status: "unreviewed" },
    resultIds: [],
  };
}

export async function readWorkbenchTraceRecordingConfig(
  options: WorkbenchTraceRuntimeOptions = {},
): Promise<WorkbenchTraceRecordingConfig> {
  const config = await readJsonFile<WorkbenchTraceRecordingConfig>(recordingConfigPath(options));
  if (config?.schema === RECORDING_PROTOCOL) {
    return {
      schema: RECORDING_PROTOCOL,
      enabled: config.enabled === true,
      hosts: Array.isArray(config.hosts) ? config.hosts.filter((host) => typeof host === "string") : [],
      updatedAt: typeof config.updatedAt === "string" ? config.updatedAt : new Date(0).toISOString(),
      ...(typeof config.command === "string" ? { command: config.command } : {}),
    };
  }
  return {
    schema: RECORDING_PROTOCOL,
    enabled: false,
    hosts: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export async function writeWorkbenchTraceRecordingConfig(
  config: Omit<WorkbenchTraceRecordingConfig, "schema" | "updatedAt"> & { updatedAt?: string },
  options: WorkbenchTraceRuntimeOptions = {},
): Promise<WorkbenchTraceRecordingConfig> {
  const next: WorkbenchTraceRecordingConfig = {
    schema: RECORDING_PROTOCOL,
    enabled: config.enabled,
    hosts: [...new Set(config.hosts)].sort(),
    updatedAt: config.updatedAt ?? new Date().toISOString(),
    ...(config.command ? { command: config.command } : {}),
  };
  await writeJsonFileAtomic(recordingConfigPath(options), next);
  return next;
}

export function workbenchTraceSpoolPath(options: WorkbenchTraceRuntimeOptions = {}): string {
  return path.join(spoolDir(workbenchTraceRuntimeRoot(options)), TRACE_SPOOL_EVENTS_FILE);
}

export async function appendWorkbenchTraceSpoolEvent(
  event: Omit<WorkbenchTraceSpoolEvent, "schema" | "id" | "at"> & { id?: string; at?: string },
  options: WorkbenchTraceRuntimeOptions = {},
): Promise<WorkbenchTraceSpoolEvent> {
  const next: WorkbenchTraceSpoolEvent = {
    schema: TRACE_SPOOL_PROTOCOL,
    id: event.id ?? `sp_${randomBytes(8).toString("hex")}`,
    at: event.at ?? new Date().toISOString(),
    source: { ...event.source },
    kind: event.kind,
    ...(event.message ? { message: event.message } : {}),
    ...(event.input ? { input: copyTraceInput(event.input) } : {}),
    ...(event.output ? { output: { ...event.output } } : {}),
    ...(event.subject ? { subject: copyTraceSubject(event.subject) } : {}),
    ...(event.status ? { status: event.status } : {}),
    ...(event.attributes ? { attributes: { ...event.attributes } } : {}),
    ...(event.raw !== undefined ? { raw: event.raw } : {}),
  };
  const filePath = workbenchTraceSpoolPath(options);
  await withTraceSpoolLock(options, async () => {
    await fs.appendFile(filePath, `${JSON.stringify(next)}\n`, "utf8");
  });
  return next;
}

export async function compactWorkbenchTraceSpool(
  options: WorkbenchTraceRuntimeOptions = {},
): Promise<WorkbenchTraceSpoolStats> {
  const stats: WorkbenchTraceSpoolStats = {
    read: 0,
    written: 0,
    closed: 0,
    discarded: 0,
    invalid: 0,
  };
  const filePath = workbenchTraceSpoolPath(options);
  const processingPath = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.processing`;
  if (!await fileExists(filePath)) {
    return stats;
  }
  const hasSpool = await withTraceSpoolLock(options, async () => {
    try {
      await fs.rename(filePath, processingPath);
      return true;
    } catch (error) {
      if (fileErrorCode(error) === "ENOENT") {
        return false;
      }
      throw error;
    }
  });
  if (!hasSpool) {
    return stats;
  }
  try {
    const text = await fs.readFile(processingPath, "utf8");
    for (const line of text.split(/\r?\n/u)) {
      if (!line.trim()) {
        continue;
      }
      stats.read += 1;
      const event = parseTraceSpoolEvent(line);
      if (!event) {
        stats.invalid += 1;
        continue;
      }
      await applyTraceSpoolEvent(event, options, stats);
    }
  } finally {
    await removeFileIfExists(processingPath);
  }
  return stats;
}

export async function listWorkbenchTraceRecords(
  options: WorkbenchTraceRuntimeOptions & { includeCandidates?: boolean; includeHome?: boolean } = {},
): Promise<WorkbenchTrace[]> {
  const includeHome = options.includeHome !== false;
  const roots = [
    ...(options.projectRoot ? [recordsDir(workbenchProjectTraceRuntimeRoot(options.projectRoot))] : []),
    ...(options.includeCandidates && options.projectRoot ? [candidatesDir(workbenchProjectTraceRuntimeRoot(options.projectRoot))] : []),
    ...(includeHome ? [recordsDir(workbenchTraceRuntimeRoot(options))] : []),
    ...(includeHome && options.includeCandidates ? [candidatesDir(workbenchTraceRuntimeRoot(options))] : []),
  ];
  const traces: WorkbenchTrace[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const trace of await readTraceRecordsFromDir(root)) {
      if (seen.has(trace.id)) {
        continue;
      }
      seen.add(trace.id);
      traces.push(trace);
    }
  }
  return traces.sort((left, right) =>
    (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt) ||
    right.id.localeCompare(left.id)
  );
}

export async function readWorkbenchTraceRecord(
  traceId: string,
  options: WorkbenchTraceRuntimeOptions = {},
): Promise<WorkbenchTrace | null> {
  const roots = [
    ...(options.projectRoot ? [recordsDir(workbenchProjectTraceRuntimeRoot(options.projectRoot))] : []),
    recordsDir(workbenchTraceRuntimeRoot(options)),
    candidatesDir(workbenchTraceRuntimeRoot(options)),
  ];
  for (const root of roots) {
    const trace = await readTraceFile(path.join(root, `${safeStorageName(traceId)}.json`));
    if (trace) {
      return trace;
    }
  }
  return null;
}

export async function writeWorkbenchTraceRecord(
  trace: WorkbenchTrace,
  options: WorkbenchTraceRuntimeOptions = {},
): Promise<WorkbenchTrace> {
  const normalized = normalizeTraceRecord(trace);
  await writeJsonFileAtomic(path.join(traceRecordWriteDir(options), `${safeStorageName(normalized.id)}.json`), normalized);
  return normalized;
}

export async function openWorkbenchTraceCandidate(
  args: WorkbenchTraceRecordInput & { source: WorkbenchTraceSource },
  options: WorkbenchTraceRuntimeOptions = {},
): Promise<WorkbenchTrace> {
  const key = workbenchTraceCandidateKey({ source: args.source });
  const candidatePath = path.join(candidatesDir(workbenchTraceRuntimeRoot(options)), `${key}.json`);
  const existing = await readTraceFile(candidatePath);
  const now = new Date().toISOString();
  const timestamp = args.updatedAt ?? args.createdAt ?? now;
  if (existing) {
    const next = normalizeTraceRecord({
      ...existing,
      updatedAt: latestTimestamp(existing.updatedAt ?? existing.createdAt, timestamp),
      source: { ...existing.source, ...args.source },
      input: mergeTraceInput(existing.input, args.input),
      subjects: mergeTraceSubjects(existing.subjects ?? [], args.subjects ?? []),
      links: mergeTraceLinks(existing.links ?? [], args.links ?? []),
      status: defaultWorkbenchTraceStatus(args.origin, { ...existing.status, capture: "capturing", execution: "running" }),
    });
    await writeJsonFileAtomic(candidatePath, next);
    return next;
  }
  const trace = createWorkbenchTraceRecord({
    ...args,
    origin: args.origin,
    status: { ...args.status, capture: "capturing", execution: "running", grade: "ungraded", review: "unreviewed", promotion: "none" },
  });
  await writeJsonFileAtomic(candidatePath, trace);
  return trace;
}

export async function appendWorkbenchTraceCandidateEvent(
  args: WorkbenchTraceCandidateEventInput,
  options: WorkbenchTraceRuntimeOptions = {},
): Promise<WorkbenchTrace | null> {
  const key = workbenchTraceCandidateKey({ source: args.source });
  const candidatePath = path.join(candidatesDir(workbenchTraceRuntimeRoot(options)), `${key}.json`);
  const trace = await readTraceFile(candidatePath);
  if (!trace) {
    return null;
  }
  const now = args.at ?? new Date().toISOString();
  const span = trace.spans?.[0] ?? createTurnSpan(trace.id, trace.createdAt, trace.source);
  const event: WorkbenchTraceEvent = {
    id: `ev_${randomBytes(5).toString("hex")}`,
    span_id: span.id,
    attempt_number: 1,
    stage_id: null,
    stage_run_index: null,
    kind: args.kind,
    at: now,
    message: args.message,
    attributes: args.attributes ?? {},
  };
  const next = normalizeTraceRecord({
    ...trace,
    updatedAt: latestTimestamp(trace.updatedAt ?? trace.createdAt, now),
    spans: trace.spans && trace.spans.length > 0 ? trace.spans : [span],
    events: [...(trace.events ?? []), event],
  });
  await writeJsonFileAtomic(candidatePath, next);
  return next;
}

export async function claimWorkbenchTraceCandidateSubject(
  args: { source: WorkbenchTraceSource; subject: WorkbenchTraceSubject; at?: string },
  options: WorkbenchTraceRuntimeOptions = {},
): Promise<WorkbenchTrace | null> {
  const key = workbenchTraceCandidateKey({ source: args.source });
  const candidatePath = path.join(candidatesDir(workbenchTraceRuntimeRoot(options)), `${key}.json`);
  const trace = await readTraceFile(candidatePath);
  if (!trace) {
    return null;
  }
  const now = args.at ?? new Date().toISOString();
  const next = normalizeTraceRecord({
    ...trace,
    updatedAt: latestTimestamp(trace.updatedAt ?? trace.createdAt, now),
    subjects: mergeTraceSubjects(trace.subjects ?? [], [args.subject]),
  });
  await writeJsonFileAtomic(candidatePath, next);
  return next;
}

export async function closeWorkbenchTraceCandidate(
  args: WorkbenchTraceCandidateCloseInput,
  options: WorkbenchTraceRuntimeOptions = {},
): Promise<WorkbenchTrace | null> {
  const key = workbenchTraceCandidateKey({ source: args.source });
  const runtimeRoot = workbenchTraceRuntimeRoot(options);
  const candidatePath = path.join(candidatesDir(runtimeRoot), `${key}.json`);
  const trace = await readTraceFile(candidatePath);
  if (!trace) {
    return null;
  }
  if ((trace.origin ?? "live") === "live" && !hasDurableSkillSubject(trace)) {
    await removeFileIfExists(candidatePath);
    return null;
  }
  const now = latestTimestamp(trace.updatedAt ?? trace.createdAt, args.at ?? new Date().toISOString());
  const spans = closeTraceSpans(trace.spans ?? [], now, args.status ?? "completed");
  const output = args.output ? { ...trace.output, ...args.output } : trace.output;
  const status = defaultWorkbenchTraceStatus(trace.origin ?? "live", {
    ...trace.status,
    capture: "captured",
    execution: args.status ?? "completed",
  });
  const result = args.result ?? {
    status: status.execution,
    ...(output ? { output: output as unknown as Json } : {}),
    ...(trace.usage ? { usage: trace.usage as unknown as Json } : {}),
  } satisfies Record<string, Json>;
  const next = normalizeTraceRecord({
    ...trace,
    updatedAt: now,
    output,
    result,
    status,
    spans,
  });
  await writeJsonFileAtomic(path.join(recordsDir(runtimeRoot), `${safeStorageName(next.id)}.json`), next);
  await removeFileIfExists(candidatePath);
  return next;
}

export async function discardWorkbenchTraceCandidate(
  source: WorkbenchTraceSource,
  options: WorkbenchTraceRuntimeOptions = {},
): Promise<boolean> {
  const key = workbenchTraceCandidateKey({ source });
  const candidatePath = path.join(candidatesDir(workbenchTraceRuntimeRoot(options)), `${key}.json`);
  const trace = await readTraceFile(candidatePath);
  if (!trace) {
    return false;
  }
  await removeFileIfExists(candidatePath);
  return true;
}

export async function reviewWorkbenchTraceRecord(
  args: WorkbenchTraceReviewInput,
  options: WorkbenchTraceRuntimeOptions = {},
): Promise<WorkbenchTrace | null> {
  const roots = [
    ...(options.projectRoot ? [recordsDir(workbenchProjectTraceRuntimeRoot(options.projectRoot))] : []),
    recordsDir(workbenchTraceRuntimeRoot(options)),
  ];
  for (const root of roots) {
    const tracePath = path.join(root, `${safeStorageName(args.traceId)}.json`);
    const trace = await readTraceFile(tracePath);
    if (!trace) {
      continue;
    }
    const next = reviewWorkbenchTrace(trace, args);
    await writeJsonFileAtomic(tracePath, next);
    return next;
  }
  return null;
}

export function reviewWorkbenchTrace(trace: WorkbenchTrace, args: WorkbenchTraceReviewUpdate): WorkbenchTrace {
  const now = args.reviewedAt ?? new Date().toISOString();
  const origin = trace.origin ?? "eval";
  return normalizeTraceRecord({
    ...trace,
    updatedAt: now,
    status: defaultWorkbenchTraceStatus(origin, { ...trace.status, review: args.status }),
    review: {
      status: args.status,
      ...(args.note ? { note: args.note } : trace.review?.note ? { note: trace.review.note } : {}),
      ...(args.tags && args.tags.length > 0 ? { tags: [...args.tags] } : trace.review?.tags ? { tags: [...trace.review.tags] } : {}),
      ...(args.expected ? { expected: args.expected } : trace.review?.expected ? { expected: trace.review.expected } : {}),
      ...(args.reviewer ? { reviewer: args.reviewer } : trace.review?.reviewer ? { reviewer: trace.review.reviewer } : {}),
      reviewedAt: now,
    },
  });
}

export function workbenchTraceCandidateKey(args: WorkbenchTraceCandidateKeyInput): string {
  const source = args.source;
  return safeStorageName([
    source.host ?? "host",
    source.sessionId ?? "session",
    source.turnId ?? "turn",
  ].join("__"));
}

function recordingConfigPath(options: WorkbenchTraceRuntimeOptions): string {
  return path.join(workbenchTraceRuntimeRoot(options), TRACE_RECORDING_CONFIG_FILE);
}

function recordsDir(root: string): string {
  return path.join(root, TRACE_RECORDS_DIR);
}

function traceRecordWriteDir(options: WorkbenchTraceRuntimeOptions): string {
  return recordsDir(options.projectRoot
    ? workbenchProjectTraceRuntimeRoot(options.projectRoot)
    : workbenchTraceRuntimeRoot(options));
}

function candidatesDir(root: string): string {
  return path.join(root, TRACE_CANDIDATES_DIR);
}

function spoolDir(root: string): string {
  return path.join(root, TRACE_SPOOL_DIR);
}

function workbenchTraceSpoolLockPath(options: WorkbenchTraceRuntimeOptions = {}): string {
  return path.join(spoolDir(workbenchTraceRuntimeRoot(options)), TRACE_SPOOL_LOCK_FILE);
}

async function withTraceSpoolLock<T>(
  options: WorkbenchTraceRuntimeOptions,
  action: () => Promise<T>,
): Promise<T> {
  const lockPath = workbenchTraceSpoolLockPath(options);
  const deadline = Date.now() + TRACE_SPOOL_LOCK_TIMEOUT_MS;
  let lockHandle: Awaited<ReturnType<typeof fs.open>> | null = null;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  while (!lockHandle) {
    try {
      lockHandle = await fs.open(lockPath, "wx");
      await lockHandle.writeFile(`${JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
      })}\n`, "utf8");
      break;
    } catch (error) {
      if (lockHandle) {
        await lockHandle.close().catch(() => undefined);
        lockHandle = null;
        await removeFileIfExists(lockPath);
      }
      if (fileErrorCode(error) !== "EEXIST") {
        throw error;
      }
      await removeStaleTraceSpoolLock(lockPath);
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for Workbench trace spool lock: ${lockPath}`);
      }
      await sleep(TRACE_SPOOL_LOCK_RETRY_MS);
    }
  }
  try {
    return await action();
  } finally {
    await lockHandle.close().catch(() => undefined);
    await removeFileIfExists(lockPath);
  }
}

async function removeStaleTraceSpoolLock(lockPath: string): Promise<void> {
  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs <= TRACE_SPOOL_LOCK_STALE_MS) {
      return;
    }
    await fs.rm(lockPath, { force: true });
  } catch (error) {
    if (fileErrorCode(error) !== "ENOENT") {
      throw error;
    }
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTraceSpoolEvent(line: string): WorkbenchTraceSpoolEvent | null {
  try {
    const value = JSON.parse(line) as unknown;
    if (!value || typeof value !== "object") {
      return null;
    }
    const record = value as Record<string, unknown>;
    const source = record.source && typeof record.source === "object" && !Array.isArray(record.source)
      ? record.source as WorkbenchTraceSource
      : null;
    if (
      record.schema !== TRACE_SPOOL_PROTOCOL ||
      typeof record.id !== "string" ||
      typeof record.at !== "string" ||
      !source ||
      !isTraceSpoolEventKind(record.kind)
    ) {
      return null;
    }
    return {
      schema: TRACE_SPOOL_PROTOCOL,
      id: record.id,
      at: record.at,
      source: { ...source },
      kind: record.kind,
      ...(typeof record.message === "string" ? { message: record.message } : {}),
      ...(isTraceInput(record.input) ? { input: copyTraceInput(record.input) } : {}),
      ...(isTraceOutput(record.output) ? { output: { ...record.output } } : {}),
      ...(isTraceSubject(record.subject) ? { subject: copyTraceSubject(record.subject) } : {}),
      ...(isTraceCloseStatus(record.status) ? { status: record.status } : {}),
      ...(isJsonObject(record.attributes) ? { attributes: record.attributes } : {}),
      ...(isJsonValue(record.raw) ? { raw: record.raw } : {}),
    };
  } catch {
    return null;
  }
}

async function applyTraceSpoolEvent(
  event: WorkbenchTraceSpoolEvent,
  options: WorkbenchTraceRuntimeOptions,
  stats: WorkbenchTraceSpoolStats,
): Promise<void> {
  if (event.kind === "prompt") {
    await openWorkbenchTraceCandidate({
      origin: "live",
      source: event.source,
      input: event.input,
      subjects: event.subject ? [event.subject] : undefined,
      createdAt: event.at,
      updatedAt: event.at,
    }, options);
    if (event.input?.prompt) {
      await appendWorkbenchTraceCandidateEvent({
        source: event.source,
        kind: "message",
        message: event.message ?? "user prompt",
        attributes: { prompt: event.input.prompt },
        at: event.at,
      }, options);
    }
    stats.written += 1;
    return;
  }
  if (event.kind === "claim" && event.subject) {
    await openWorkbenchTraceCandidate({
      origin: "live",
      source: event.source,
      subjects: [event.subject],
      createdAt: event.at,
      updatedAt: event.at,
    }, options);
    await claimWorkbenchTraceCandidateSubject({
      source: event.source,
      subject: event.subject,
      at: event.at,
    }, options);
    stats.written += 1;
    return;
  }
  if (event.kind === "stop") {
    const trace = await closeWorkbenchTraceCandidate({
      source: event.source,
      output: event.output,
      status: event.status,
      at: event.at,
    }, options);
    if (trace) {
      stats.closed += 1;
      await appendClosedTraceEvent(trace, event, options);
    }
    return;
  }
  if (event.kind === "discard") {
    if (await discardWorkbenchTraceCandidate(event.source, options)) {
      stats.discarded += 1;
    }
    return;
  }
  await appendWorkbenchTraceCandidateEvent({
    source: event.source,
    kind: traceEventKindFromAttributes(event.attributes),
    message: event.message ?? "event",
    attributes: event.attributes,
    at: event.at,
  }, options);
  stats.written += 1;
}

async function appendClosedTraceEvent(
  trace: WorkbenchTrace,
  event: WorkbenchTraceSpoolEvent,
  options: WorkbenchTraceRuntimeOptions,
): Promise<void> {
  const span = trace.spans?.[0] ?? createTurnSpan(trace.id, trace.createdAt, trace.source);
  await writeWorkbenchTraceRecord({
    ...trace,
    updatedAt: latestTimestamp(trace.updatedAt ?? trace.createdAt, event.at),
    spans: trace.spans && trace.spans.length > 0 ? trace.spans : [span],
    events: [
      ...(trace.events ?? []),
      {
        id: `ev_${randomBytes(5).toString("hex")}`,
        span_id: span.id,
        attempt_number: 1,
        stage_id: null,
        stage_run_index: null,
        kind: "status",
        at: event.at,
        message: event.message ?? "Stop",
        attributes: event.attributes ?? {},
      },
    ],
  }, options);
}

function traceEventKindFromAttributes(attributes: Record<string, Json> | undefined): WorkbenchTraceEvent["kind"] {
  const kind = attributes?.kind;
  return kind === "error" || kind === "usage" || kind === "output" || kind === "message" || kind === "status" || kind === "note"
    ? kind
    : "note";
}

function latestTimestamp(left: string, right: string): string {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime)) {
    return right;
  }
  if (!Number.isFinite(rightTime)) {
    return left;
  }
  return rightTime >= leftTime ? right : left;
}

function defaultWorkbenchTraceStatus(
  origin: WorkbenchTraceOrigin,
  overrides: Partial<WorkbenchTraceLifecycleStatus> = {},
): WorkbenchTraceLifecycleStatus {
  return {
    capture: origin === "live" ? "capturing" : "captured",
    execution: origin === "live" ? "running" : "completed",
    grade: "ungraded",
    review: "unreviewed",
    promotion: "none",
    ...overrides,
  };
}

function createTurnSpan(id: string, startedAt: string, source: WorkbenchTraceSource | undefined): WorkbenchTraceSpan {
  return {
    id: `span_${id}`,
    parent_id: null,
    attempt_number: 1,
    stage_id: null,
    stage_run_index: null,
    kind: "turn",
    title: source?.host ? `${source.host} turn` : "agent turn",
    status: "running",
    started_at: startedAt,
    ended_at: null,
    attributes: {
      ...(source?.host ? { host: source.host } : {}),
      ...(source?.sessionId ? { sessionId: source.sessionId } : {}),
      ...(source?.turnId ? { turnId: source.turnId } : {}),
      ...(source?.workspaceRoot ? { workspaceRoot: source.workspaceRoot } : {}),
    },
  };
}

function closeTraceSpans(
  spans: readonly WorkbenchTraceSpan[],
  endedAt: string,
  status: WorkbenchTraceCandidateCloseInput["status"],
): WorkbenchTraceSpan[] {
  const spanStatus = status === "failed" ? "failed" : status === "canceled" ? "canceled" : "completed";
  return spans.map((span) => ({
    ...span,
    status: span.ended_at ? span.status : spanStatus,
    ended_at: span.ended_at ?? endedAt,
  }));
}

function normalizeTraceRecord(trace: WorkbenchTrace): WorkbenchTrace {
  const origin = trace.origin ?? "eval";
  return {
    ...trace,
    protocol: TRACE_PROTOCOL,
    origin,
    updatedAt: trace.updatedAt ?? trace.createdAt,
    status: defaultWorkbenchTraceStatus(origin, trace.status),
    files: trace.files.map(copyFile),
    ...(trace.artifacts ? { artifacts: trace.artifacts.map(copyFile) } : {}),
    ...(trace.subjects ? { subjects: trace.subjects.map(copyTraceSubject) } : {}),
    ...(trace.links ? { links: trace.links.map(copyTraceLink) } : {}),
    ...(trace.input ? { input: copyTraceInput(trace.input) } : {}),
    ...(trace.output ? { output: { ...trace.output } } : {}),
    ...(trace.review ? { review: copyTraceReview(trace.review) } : { review: { status: "unreviewed" } }),
    ...(trace.resultIds ? { resultIds: [...trace.resultIds] } : { resultIds: [] }),
  };
}

function mergeTraceInput(left: WorkbenchTraceInput | undefined, right: WorkbenchTraceInput | undefined): WorkbenchTraceInput | undefined {
  if (!left) {
    return right ? copyTraceInput(right) : undefined;
  }
  if (!right) {
    return copyTraceInput(left);
  }
  return {
    prompt: right.prompt ?? left.prompt,
    attachments: [...(left.attachments ?? []), ...(right.attachments ?? [])].map(copyFile),
  };
}

function mergeTraceSubjects(
  left: readonly WorkbenchTraceSubject[],
  right: readonly WorkbenchTraceSubject[],
): WorkbenchTraceSubject[] {
  const byKey = new Map<string, WorkbenchTraceSubject>();
  for (const subject of [...left, ...right]) {
    const key = `${subject.type}:${subject.id}:${subject.versionId ?? ""}`;
    const existing = byKey.get(key);
    if (!existing || traceSubjectEvidenceRank(subject) >= traceSubjectEvidenceRank(existing)) {
      byKey.set(key, copyTraceSubject(subject));
    }
  }
  return [...byKey.values()];
}

function traceSubjectEvidenceRank(subject: WorkbenchTraceSubject): number {
  const confidence = subject.confidence === "exact"
    ? 30
    : subject.confidence === "claimed"
      ? 20
      : subject.confidence === "inferred"
        ? 10
        : 0;
  const activation = subject.activation === "explicit-invocation"
    ? 5
    : subject.activation === "workbench-owned"
      ? 4
      : subject.activation === "manual"
        ? 3
        : subject.activation === "host-skill"
          ? 2
          : subject.activation === "unknown"
            ? 1
            : 0;
  return confidence + activation;
}

function mergeTraceLinks(left: readonly WorkbenchTraceLink[], right: readonly WorkbenchTraceLink[]): WorkbenchTraceLink[] {
  const byKey = new Map<string, WorkbenchTraceLink>();
  for (const link of [...left, ...right]) {
    byKey.set(`${link.type}:${link.id}`, copyTraceLink(link));
  }
  return [...byKey.values()];
}

function hasDurableSkillSubject(trace: WorkbenchTrace): boolean {
  return trace.subjects?.some((subject) =>
    subject.type === "skill" &&
    (subject.confidence === "exact" || subject.confidence === "claimed")
  ) ?? false;
}

function firstLinkId(links: readonly WorkbenchTraceLink[], type: WorkbenchTraceLink["type"]): string | undefined {
  return links.find((link) => link.type === type)?.id;
}

async function readTraceRecordsFromDir(dir: string): Promise<WorkbenchTrace[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") {
      return [];
    }
    throw error;
  }
  const traces: WorkbenchTrace[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const trace = await readTraceFile(path.join(dir, entry));
    if (trace) {
      traces.push(trace);
    }
  }
  return traces;
}

async function readTraceFile(filePath: string): Promise<WorkbenchTrace | null> {
  const value = await readJsonFile<unknown>(filePath);
  return isWorkbenchTraceRecord(value) ? normalizeTraceRecord(value) : null;
}

function isWorkbenchTraceRecord(value: unknown): value is WorkbenchTrace {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" &&
    typeof record.createdAt === "string" &&
    Array.isArray(record.files);
}

function isTraceSpoolEventKind(value: unknown): value is WorkbenchTraceSpoolEvent["kind"] {
  return value === "prompt" || value === "claim" || value === "stop" || value === "discard" || value === "event";
}

function isTraceInput(value: unknown): value is WorkbenchTraceInput {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isTraceOutput(value: unknown): value is WorkbenchTraceOutput {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isTraceSubject(value: unknown): value is WorkbenchTraceSubject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.type === "string" && typeof record.id === "string";
}

function isTraceCloseStatus(value: unknown): value is WorkbenchTraceCandidateCloseInput["status"] {
  return value === "completed" || value === "failed" || value === "canceled" || value === "unknown";
}

function isJsonObject(value: unknown): value is Record<string, Json> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isJsonObject(value);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch (error) {
    if (fileErrorCode(error) !== "ENOENT") {
      throw error;
    }
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function copyTraceSubject(subject: WorkbenchTraceSubject): WorkbenchTraceSubject {
  return { ...subject };
}

function copyTraceLink(link: WorkbenchTraceLink): WorkbenchTraceLink {
  return { ...link };
}

function copyTraceInput(input: WorkbenchTraceInput): WorkbenchTraceInput {
  return {
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(input.attachments ? { attachments: input.attachments.map(copyFile) } : {}),
  };
}

function copyTraceReview(review: WorkbenchTraceReview): WorkbenchTraceReview {
  return {
    status: review.status,
    ...(review.note ? { note: review.note } : {}),
    ...(review.tags ? { tags: [...review.tags] } : {}),
    ...(review.expected ? { expected: review.expected } : {}),
    ...(review.reviewedAt ? { reviewedAt: review.reviewedAt } : {}),
    ...(review.reviewer ? { reviewer: review.reviewer } : {}),
  };
}

function copyFile(file: SurfaceSnapshotFile): SurfaceSnapshotFile {
  return { ...file };
}

function safeStorageName(value: string): string {
  return value.trim().replace(/[^a-z0-9_.-]+/giu, "_").replace(/^_+|_+$/gu, "") || "trace";
}

function fileErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
