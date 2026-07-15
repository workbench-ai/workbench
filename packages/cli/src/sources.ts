import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  WORKBENCH_SOURCE_LIMITS,
  workbenchSourceSyncEventCanonicalJson,
  type WorkbenchEvidenceSnapshot,
  type WorkbenchSource,
  type WorkbenchSourceRecordLookupRequest,
  type WorkbenchSourceRecordLookupResponse,
  type WorkbenchSourceRecordPagePayload,
  type WorkbenchSourceSyncBatch,
  type WorkbenchSourceSyncCommitRequest,
  type WorkbenchSourceSyncCommitResponse,
  type WorkbenchSourceSyncEvent,
  type WorkbenchSourceSyncSession,
  type Json,
} from "@workbench-ai/workbench-contract";
import type {
  WorkbenchSourceProducer,
  WorkbenchSourceProducerReport,
} from "@workbench-ai/workbench-built-in-adapters";
import { normalizeWorkbenchBackendUrl } from "./remote-targets.js";

const BINDING_SCHEMA = "workbench.source-binding.v2" as const;
const CHECKPOINT_SCHEMA = "workbench.source-checkpoint.v1" as const;
const MAX_CURSOR_BYTES = WORKBENCH_SOURCE_LIMITS.cursorBytes;
const MAX_BINDING_BYTES = 8 * 1024;
const MAX_CHECKPOINT_BYTES = MAX_CURSOR_BYTES + 64 * 1024;
const MAX_CURSOR_JSON_NODES = WORKBENCH_SOURCE_LIMITS.cursorJsonNodes;
const MAX_CHECKPOINT_JSON_NODES = MAX_CURSOR_JSON_NODES + 1_024;

export interface WorkbenchLocalSourceBinding {
  schema: typeof BINDING_SCHEMA;
  sourceId: string;
  baseUrl: string;
  namespace?: string;
  adapterId: string;
}

export interface WorkbenchLocalSourceCheckpoint {
  schema: typeof CHECKPOINT_SCHEMA;
  sourceId: string;
  committedCursor?: Json;
  activeSyncSessionId?: string;
}

export interface WorkbenchSourceApiRequest {
  <T>(apiPath: string, options?: { method?: string; body?: unknown; signal?: AbortSignal }, baseUrlOverride?: string): Promise<T>;
}

export interface WorkbenchSourceSyncProgress {
  phase: "connecting" | "streaming" | "committing" | "complete";
  events: number;
  uploadedPages: number;
  records: number;
}

export async function bindLocalWorkbenchSource(args: {
  source: WorkbenchSource;
  baseUrl: string;
  namespace?: string;
  adapterId: string;
  homeDir?: string;
}): Promise<void> {
  await writeBinding({ schema: BINDING_SCHEMA, sourceId: args.source.id, baseUrl: normalizeWorkbenchBackendUrl(args.baseUrl), ...(args.namespace ? { namespace: args.namespace } : {}), adapterId: args.adapterId }, args.homeDir);
}

export async function readLocalWorkbenchSourceBinding(sourceId: string, homeDir?: string): Promise<WorkbenchLocalSourceBinding> {
  const binding = await readOptionalLocalWorkbenchSourceBinding(sourceId, homeDir);
  if (!binding) throw new Error(`Source ${sourceId} has no local adapter binding.`);
  return binding;
}

export async function readOptionalLocalWorkbenchSourceBinding(sourceId: string, homeDir?: string): Promise<WorkbenchLocalSourceBinding | null> {
  const value = await readLocalSourceState(bindingPath(sourceId, homeDir), MAX_BINDING_BYTES, "binding");
  return value === null ? null : parseBinding(value, sourceId);
}

export async function readLocalWorkbenchSourceCheckpoint(sourceId: string, homeDir?: string): Promise<WorkbenchLocalSourceCheckpoint> {
  const value = await readLocalSourceState(checkpointPath(sourceId, homeDir), MAX_CHECKPOINT_BYTES, "checkpoint");
  return value === null ? { schema: CHECKPOINT_SCHEMA, sourceId } : parseCheckpoint(value, sourceId);
}

async function readLocalSourceState(file: string, maximumBytes: number, label: string): Promise<unknown | null> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Local Source ${label} is invalid.`);
    if (stat.size > maximumBytes) throw new Error(`Local Source ${label} exceeds ${maximumBytes} bytes.`);
    const content = await fs.readFile(file, "utf8");
    if (Buffer.byteLength(content) > maximumBytes) throw new Error(`Local Source ${label} exceeds ${maximumBytes} bytes.`);
    return JSON.parse(content) as unknown;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function removeLocalWorkbenchSourceBinding(sourceId: string, homeDir?: string): Promise<void> {
  await fs.rm(path.dirname(bindingPath(sourceId, homeDir)), { recursive: true, force: true });
}

export async function syncLocalWorkbenchSource(args: {
  sourceId: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  producers: readonly WorkbenchSourceProducer[];
  request: WorkbenchSourceApiRequest;
  onProgress?: (progress: WorkbenchSourceSyncProgress) => void;
}) {
  const release = await acquireSourceSyncLock(args.sourceId, args.homeDir);
  try {
    return await syncAttempt(args, false);
  } finally {
    await release();
  }
}

async function syncAttempt(args: Parameters<typeof syncLocalWorkbenchSource>[0], restarted: boolean): Promise<{
  source: WorkbenchSource;
  snapshot: WorkbenchEvidenceSnapshot;
  coverage: WorkbenchSourceProducerReport["coverage"];
  diagnostics: WorkbenchSourceProducerReport["diagnostics"];
  uploadedPages: number;
  records: number;
  namespace?: string;
}> {
  args.onProgress?.({ phase: "connecting", events: 0, uploadedPages: 0, records: 0 });
  const binding = await readLocalWorkbenchSourceBinding(args.sourceId, args.homeDir);
  let checkpoint = await readLocalWorkbenchSourceCheckpoint(args.sourceId, args.homeDir);
  const producer = requireSourceProducer(args.producers, binding.adapterId);
  requireSupportedCursorLimits(producer);
  if (checkpoint.committedCursor !== undefined) assertProducerCursor(checkpoint.committedCursor, producer);
  let session: WorkbenchSourceSyncSession | undefined;
  if (checkpoint.activeSyncSessionId) {
    try {
      session = (await args.request<{ session: WorkbenchSourceSyncSession }>(boundSourcePath(binding, `/syncs/${encodeURIComponent(checkpoint.activeSyncSessionId)}`), undefined, binding.baseUrl)).session;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      checkpoint = withoutActiveSession(checkpoint);
      await writeCheckpoint(checkpoint, args.homeDir);
    }
  }
  if (!session || session.status !== "open") {
    session = (await args.request<{ session: WorkbenchSourceSyncSession }>(boundSourcePath(binding, "/syncs"), { method: "POST" }, binding.baseUrl)).session;
    checkpoint = { ...checkpoint, activeSyncSessionId: session.id };
    await writeCheckpoint(checkpoint, args.homeDir);
  }

  const resume = syncSequenceResume("Source sync", session.nextSequence, session.prefixHash);
  let uploadedPages = 0;
  let recordCount = 0;
  let pendingEvents: WorkbenchSourceSyncEvent[] = [];
  let pendingSequence = 0;
  const progress = (phase: WorkbenchSourceSyncProgress["phase"]) => args.onProgress?.({ phase, events: resume.sequence, uploadedPages, records: recordCount });
  progress("streaming");
  try {
    const flushEvents = async () => {
      if (pendingEvents.length === 0) return;
      const events = pendingEvents;
      pendingEvents = [];
      const body: WorkbenchSourceSyncBatch = { schema: "workbench.source.sync-batch.v1", sequence: pendingSequence, events };
      await args.request(boundSourcePath(binding, `/syncs/${encodeURIComponent(session.id)}`), { method: "PUT", body }, binding.baseUrl);
      uploadedPages += events.filter((event) => event.kind === "page").length;
      progress("streaming");
    };
    const emit = async (event: WorkbenchSourceSyncEvent) => {
      const sequence = resume.sequence;
      if (!resume.shouldSend(sha256(workbenchSourceSyncEventCanonicalJson(event)))) { progress("streaming"); return; }
      if (pendingEvents.length === 0) pendingSequence = sequence;
      pendingEvents.push(event);
      if (pendingEvents.length === WORKBENCH_SOURCE_LIMITS.syncEventsPerBatch) await flushEvents();
    };
    const report = await produceLocalSource(args, binding, checkpoint, session, producer, async (page) => {
      await emit({ kind: "page", recordId: page.recordId, claimedPageHash: page.hash, payload: page.payload });
    }, async (entry) => {
      recordCount += 1;
      await emit({ kind: "record", record: entry });
    });
    if (report.coverage.records !== recordCount) {
      throw new Error(`Source producer reported ${report.coverage.records} records after emitting ${recordCount}.`);
    }
    assertProducerCursor(report.cursor, producer);
    const nextCheckpoint = { ...withoutActiveSession(checkpoint), committedCursor: report.cursor };
    const nextCheckpointJson = serializeCheckpoint(nextCheckpoint);
    await emit({ kind: "finish" });
    await flushEvents();
    resume.finish();
    progress("committing");
    const commit: WorkbenchSourceSyncCommitRequest = { schema: "workbench.source.sync-commit.v1", coverage: report.coverage };
    let committed: Extract<WorkbenchSourceSyncCommitResponse, { schema: "workbench.source.sync-commit-result.v1" }> | undefined;
    let committedRecords = -1;
    while (!committed) {
      const response = await args.request<WorkbenchSourceSyncCommitResponse>(boundSourcePath(binding, `/syncs/${encodeURIComponent(session.id)}/commit`), { method: "POST", body: commit }, binding.baseUrl);
      if (response.schema === "workbench.source.sync-commit-result.v1") committed = response;
      else if (response.schema !== "workbench.source.sync-commit-progress.v1" ||
        !Number.isSafeInteger(response.processedRecords) || response.processedRecords < 0 ||
        response.totalRecords !== report.coverage.records || response.processedRecords > response.totalRecords ||
        response.processedRecords <= committedRecords
      ) throw new Error("Source sync commit returned invalid progress.");
      else committedRecords = response.processedRecords;
    }
    await writeSerializedCheckpoint(nextCheckpoint.sourceId, nextCheckpointJson, args.homeDir);
    progress("complete");
    return {
      source: committed.source,
      snapshot: committed.snapshot,
      coverage: report.coverage,
      diagnostics: report.diagnostics,
      uploadedPages,
      records: recordCount,
      ...(binding.namespace ? { namespace: binding.namespace } : {}),
    };
  } catch (error) {
    // A server conflict means this exact active session is no longer a safe
    // continuation point (expired, advanced elsewhere, or divergent replay).
    // The per-Source process lock makes one fresh session retry deterministic.
    if (!restarted && (isConflict(error) || isNotFound(error))) {
      await writeCheckpoint(withoutActiveSession(checkpoint), args.homeDir);
      return await syncAttempt(args, true);
    }
    throw error;
  }
}

async function produceLocalSource(
  args: Parameters<typeof syncLocalWorkbenchSource>[0],
  binding: WorkbenchLocalSourceBinding,
  checkpoint: WorkbenchLocalSourceCheckpoint,
  session: WorkbenchSourceSyncSession,
  producer: WorkbenchSourceProducer,
  onPage: Parameters<WorkbenchSourceProducer["stream"]>[0]["onPage"],
  onRecord: Parameters<WorkbenchSourceProducer["stream"]>[0]["onRecord"],
) {
  return await producer.stream({
    env: args.env,
    ...(checkpoint.committedCursor === undefined ? {} : { cursor: checkpoint.committedCursor }),
    base: {
      async records(ids) {
        const body: WorkbenchSourceRecordLookupRequest = { schema: "workbench.source.record-lookup.v1", ids: [...ids] };
        return (await args.request<WorkbenchSourceRecordLookupResponse>(boundSourcePath(binding, "/records/lookup"), { method: "POST", body }, binding.baseUrl)).records;
      },
      async page(pageHash) {
        return (await args.request<{ payload: WorkbenchSourceRecordPagePayload }>(
          boundSourcePath(binding, `/syncs/${encodeURIComponent(session.id)}/pages/${encodeURIComponent(pageHash)}`),
          undefined,
          binding.baseUrl,
        )).payload;
      },
    },
    onPage,
    onRecord,
  });
}

function boundSourcePath(binding: WorkbenchLocalSourceBinding, suffix = ""): string {
  const query = new URLSearchParams();
  if (binding.namespace) query.set("namespace", binding.namespace);
  return `/api/workbench/sources/${encodeURIComponent(binding.sourceId)}${suffix}${query.size ? `?${query}` : ""}`;
}

function bindingPath(sourceId: string, homeDir?: string): string {
  return path.join(homeDir?.trim() || os.homedir(), ".workbench", "sources", encodeURIComponent(sourceId).replace(/%/gu, "_"), "binding.json");
}
function checkpointPath(sourceId: string, homeDir?: string): string { return path.join(path.dirname(bindingPath(sourceId, homeDir)), "checkpoint.json"); }

async function acquireSourceSyncLock(sourceId: string, homeDir?: string): Promise<() => Promise<void>> {
  const lockPath = path.join(path.dirname(bindingPath(sourceId, homeDir)), "sync.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const token = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const owner = { pid: process.pid, hostname: os.hostname(), token, createdAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(owner)}\n`);
      } finally {
        await handle.close();
      }
      return async () => {
        const current = await fs.readFile(lockPath, "utf8").then((value) => JSON.parse(value) as { token?: unknown }, () => undefined);
        if (current?.token === token) await fs.rm(lockPath, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await sourceSyncLockIsLive(lockPath)) {
        const locked = new Error(`Source ${sourceId} is already being synced by another process.`) as Error & { code?: string };
        locked.code = "source_sync_locked";
        throw locked;
      }
      const stalePath = `${lockPath}.stale-${token}`;
      try {
        await fs.rename(lockPath, stalePath);
        await fs.rm(stalePath, { force: true });
      } catch (renameError) {
        if ((renameError as NodeJS.ErrnoException).code !== "ENOENT") throw renameError;
      }
    }
  }
  throw new Error(`Could not acquire the Source ${sourceId} sync lock.`);
}

async function sourceSyncLockIsLive(lockPath: string): Promise<boolean> {
  try {
    const owner = JSON.parse(await fs.readFile(lockPath, "utf8")) as { pid?: unknown; hostname?: unknown };
    if (owner.hostname === os.hostname() && Number.isSafeInteger(owner.pid) && (owner.pid as number) > 0) {
      try {
        process.kill(owner.pid as number, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code !== "ESRCH";
      }
    }
    const stat = await fs.stat(lockPath);
    return Date.now() - stat.mtimeMs < 24 * 60 * 60 * 1_000;
  } catch {
    const stat = await fs.stat(lockPath).catch(() => undefined);
    return Boolean(stat && Date.now() - stat.mtimeMs < 60_000);
  }
}

async function writeBinding(binding: WorkbenchLocalSourceBinding, homeDir?: string): Promise<void> {
  await writeSerializedBinding(binding.sourceId, serializeBinding(binding), homeDir);
}

function serializeBinding(binding: WorkbenchLocalSourceBinding): string {
  const serialized = `${JSON.stringify(binding)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_BINDING_BYTES) {
    throw new Error(`Local Source binding exceeds ${MAX_BINDING_BYTES} bytes.`);
  }
  return serialized;
}

async function writeCheckpoint(checkpoint: WorkbenchLocalSourceCheckpoint, homeDir?: string): Promise<void> {
  await writeSerializedCheckpoint(checkpoint.sourceId, serializeCheckpoint(checkpoint), homeDir);
}

function serializeCheckpoint(checkpoint: WorkbenchLocalSourceCheckpoint): string {
  assertJson(checkpoint, { value: 0 }, 0, MAX_CHECKPOINT_JSON_NODES);
  const serialized = `${JSON.stringify(checkpoint)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_CHECKPOINT_BYTES) throw new Error(`Local Source checkpoint exceeds ${MAX_CHECKPOINT_BYTES} bytes.`);
  return serialized;
}

async function writeSerializedCheckpoint(sourceId: string, serialized: string, homeDir?: string): Promise<void> {
  const file = checkpointPath(sourceId, homeDir);
  await writePrivateFileAtomically(file, serialized);
}

async function writeSerializedBinding(sourceId: string, serialized: string, homeDir?: string): Promise<void> {
  const file = bindingPath(sourceId, homeDir);
  await writePrivateFileAtomically(file, serialized);
}

function requireSourceProducer(producers: readonly WorkbenchSourceProducer[], adapterId: string): WorkbenchSourceProducer {
  const producer = producers.find((candidate) => candidate.id === adapterId);
  if (!producer) throw new Error(`Source adapter ${adapterId} is not installed.`);
  return producer;
}

function requireSupportedCursorLimits(producer: WorkbenchSourceProducer): void {
  const { maximumBytes, maximumJsonNodes } = producer.cursorLimits;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 2 || maximumBytes > MAX_CURSOR_BYTES ||
    !Number.isSafeInteger(maximumJsonNodes) || maximumJsonNodes < 1 || maximumJsonNodes > MAX_CURSOR_JSON_NODES
  ) throw new Error(`Source adapter ${producer.id} declares unsupported cursor limits.`);
}

function assertProducerCursor(cursor: Json, producer: WorkbenchSourceProducer): void {
  const nodes = { value: 0 };
  assertJson(cursor, nodes, 0, producer.cursorLimits.maximumJsonNodes);
  if (Buffer.byteLength(JSON.stringify(cursor), "utf8") > producer.cursorLimits.maximumBytes) {
    throw new Error(`Source adapter ${producer.id} cursor exceeds its declared ${producer.cursorLimits.maximumBytes}-byte bound.`);
  }
}

function parseBinding(value: unknown, sourceId: string): WorkbenchLocalSourceBinding {
  const record = object(value, "Local Source binding");
  exact(record, ["schema", "sourceId", "baseUrl", "namespace", "adapterId"]);
  if (record.schema !== BINDING_SCHEMA || record.sourceId !== sourceId || typeof record.baseUrl !== "string") throw new Error(`Local Source binding for ${sourceId} is invalid.`);
  if (typeof record.adapterId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(record.adapterId)) throw new Error("Local Source adapter is invalid.");
  if (record.namespace !== undefined && (typeof record.namespace !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(record.namespace))) throw new Error("Local Source namespace is invalid.");
  return { schema: BINDING_SCHEMA, sourceId, baseUrl: normalizeWorkbenchBackendUrl(record.baseUrl), ...(record.namespace ? { namespace: record.namespace } : {}), adapterId: record.adapterId };
}

function parseCheckpoint(value: unknown, sourceId: string): WorkbenchLocalSourceCheckpoint {
  const record = object(value, "Local Source checkpoint");
  exact(record, ["schema", "sourceId", "committedCursor", "activeSyncSessionId"]);
  if (record.schema !== CHECKPOINT_SCHEMA || record.sourceId !== sourceId || (record.activeSyncSessionId !== undefined && typeof record.activeSyncSessionId !== "string")) throw new Error(`Local Source checkpoint for ${sourceId} is invalid.`);
  const checkpoint = { schema: CHECKPOINT_SCHEMA, sourceId, ...(record.committedCursor === undefined ? {} : { committedCursor: parseCursor(record.committedCursor) }), ...(record.activeSyncSessionId ? { activeSyncSessionId: record.activeSyncSessionId } : {}) } satisfies WorkbenchLocalSourceCheckpoint;
  assertJson(checkpoint, { value: 0 }, 0, MAX_CHECKPOINT_JSON_NODES);
  return checkpoint;
}

function parseCursor(value: unknown): Json {
  assertJson(value, { value: 0 }, 0, MAX_CURSOR_JSON_NODES);
  return value as Json;
}

function assertJson(value: unknown, nodes: { value: number }, depth = 0, maximumNodes: number = MAX_CHECKPOINT_JSON_NODES): void {
  if (++nodes.value > maximumNodes || depth > 64) throw new Error("Local Source cursor JSON exceeds its structural bound.");
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) { for (const item of value) assertJson(item, nodes, depth + 1, maximumNodes); return; }
  if (value && typeof value === "object") { for (const item of Object.values(value)) assertJson(item, nodes, depth + 1, maximumNodes); return; }
  throw new Error("Local Source cursor contains a non-JSON value.");
}

function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`); return value as Record<string, unknown>; }
function exact(record: Record<string, unknown>, keys: readonly string[]): void { const allowed = new Set(keys); const extra = Object.keys(record).find((key) => !allowed.has(key)); if (extra) throw new Error(`Local Source state contains unsupported field ${extra}.`); }
async function writePrivateFileAtomically(file: string, content: string): Promise<void> { const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`; await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); try { await fs.writeFile(temporary, content, { mode: 0o600 }); await fs.rename(temporary, file); } finally { await fs.rm(temporary, { force: true }); } }
function withoutActiveSession(checkpoint: WorkbenchLocalSourceCheckpoint): WorkbenchLocalSourceCheckpoint { const { activeSyncSessionId: _, ...rest } = checkpoint; return rest; }
function syncSequenceResume(label: string, nextSequence: number, expectedPrefixHash: string | undefined) {
  if (!Number.isSafeInteger(nextSequence) || nextSequence < 0) throw syncConflict(`${label} returned an invalid resume sequence.`);
  if (nextSequence === 0 && expectedPrefixHash !== undefined) throw syncConflict(`${label} returned a prefix hash for an empty prefix.`);
  if (nextSequence > 0 && !/^[a-f0-9]{64}$/u.test(expectedPrefixHash ?? "")) throw syncConflict(`${label} did not return its accepted prefix hash.`);
  let sequence = 0;
  let prefixHash: string | undefined;
  let verified = nextSequence === 0;
  return {
    get sequence() { return sequence; },
    shouldSend(canonicalHash: string) {
      const current = sequence++;
      prefixHash = sha256(prefixHash ? `${prefixHash}\0${canonicalHash}` : canonicalHash);
      if (current < nextSequence) {
        if (sequence === nextSequence) {
          if (prefixHash !== expectedPrefixHash) throw syncConflict(`${label} changed before its advertised resume position.`);
          verified = true;
        }
        return false;
      }
      if (!verified) throw syncConflict(`${label} could not verify its advertised resume position.`);
      return true;
    },
    finish() {
      if (!verified) throw syncConflict(`${label} ended before its advertised resume position.`);
    },
  };
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function syncConflict(message: string): Error & { code: string } { const error = new Error(message) as Error & { code: string }; error.code = "source_sync_conflict"; return error; }
function errorCode(error: unknown): string { return typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : ""; }
function isNotFound(error: unknown): boolean { return /not[_-]?found|expired/iu.test(errorCode(error)); }
function isConflict(error: unknown): boolean { return /conflict|sequence|idempot/iu.test(errorCode(error)); }
