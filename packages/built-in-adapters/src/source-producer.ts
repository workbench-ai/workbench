import { createHash } from "node:crypto";
import { promises as fs, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AgentTraceCheckpointInvalidError,
  type AgentTraceAdapter,
  type AgentTraceDescriptor,
  type AgentTraceDiagnostic,
  type AgentTraceEvent,
  type AgentTraceInputRef,
  type AgentTraceSink,
  type JsonValue,
} from "@workbench-ai/agent-driver";
import {
  WORKBENCH_SOURCE_LIMITS,
  isWorkbenchJson,
  parseWorkbenchSourceRecordPagePayload,
  parseWorkbenchSourceSyncCoverage,
  workbenchSourceRecordPageCanonicalJson,
  type WorkbenchSourceEvidenceSegment,
  type WorkbenchSourceRecordEntry,
  type WorkbenchSourceRecordPagePayload,
  type WorkbenchSourceRecordRef,
  type WorkbenchSourceSyncCoverage,
  type Json,
} from "@workbench-ai/workbench-contract";

import { builtinAgentTraceAdapters } from "./agent-trace-adapters.js";

const SEGMENT_CONTENT_BYTES = WORKBENCH_SOURCE_LIMITS.segmentTextBytes;
const EMPTY_SEGMENT_PAGE_BYTES = Buffer.byteLength('{"kind":"segments","segments":[]}', "utf8");
const REUSE_BATCH_SIZE = 256;
const DIAGNOSTIC_LIMIT = 100;
const CURSOR_INPUT_LIMIT = 100_000;
const CURSOR_RECORDS_PER_INPUT_LIMIT = 4_096;
const WORKBENCH_BUILTIN_SOURCE_CURSOR_LIMITS = {
  maximumBytes: WORKBENCH_SOURCE_LIMITS.cursorBytes,
  maximumJsonNodes: WORKBENCH_SOURCE_LIMITS.cursorJsonNodes,
} as const;

interface WorkbenchBuiltinSourceCursorCoverage {
  records: number;
  segments: number;
  bytes: number;
  omissions?: WorkbenchSourceSyncCoverage["omissions"];
}

export interface WorkbenchBuiltinSourceCursor {
  schema: "workbench.builtin-source-cursor.v2";
  inputs: Record<string, {
    checkpoint: JsonValue;
    recordIds?: string[];
    coverage: WorkbenchBuiltinSourceCursorCoverage;
  }>;
}

export interface WorkbenchSourceProducerBase {
  records(recordIds: readonly string[]): Promise<WorkbenchSourceRecordRef[]>;
  page(pageHash: string): Promise<WorkbenchSourceRecordPagePayload | null>;
}

export interface WorkbenchSourceProducerPage {
  recordId: string;
  hash: string;
  payload: WorkbenchSourceRecordPagePayload;
}

export interface WorkbenchSourceProducerDiagnostic {
  code: string;
  message: string;
}

export interface WorkbenchSourceProducerReport {
  cursor: Json;
  coverage: WorkbenchSourceSyncCoverage;
  diagnostics: { items: WorkbenchSourceProducerDiagnostic[]; total: number; truncated: number };
}

export interface WorkbenchSourceProducer {
  readonly id: string;
  readonly cursorLimits: {
    maximumBytes: number;
    maximumJsonNodes: number;
  };
  stream(args: {
    env?: NodeJS.ProcessEnv;
    cursor?: Json;
    base?: WorkbenchSourceProducerBase;
    onPage(page: WorkbenchSourceProducerPage): Promise<void> | void;
    onRecord(entry: WorkbenchSourceRecordEntry): Promise<void> | void;
  }): Promise<WorkbenchSourceProducerReport>;
}

export interface WorkbenchBuiltinSourceReport extends Omit<WorkbenchSourceProducerReport, "cursor"> {
  cursor: WorkbenchBuiltinSourceCursor;
}

export function builtinWorkbenchSourceProducers(
  adapters: readonly AgentTraceAdapter[] = builtinAgentTraceAdapters(),
): WorkbenchSourceProducer[] {
  return adapters.map((adapter) => ({
    id: adapter.id,
    cursorLimits: WORKBENCH_BUILTIN_SOURCE_CURSOR_LIMITS,
    async stream(args): Promise<WorkbenchSourceProducerReport> {
      const report = await streamWorkbenchBuiltinSource({
        adapterId: adapter.id,
        adapters: [adapter],
        ...(args.env ? { env: args.env } : {}),
        ...(args.cursor === undefined ? {} : { cursor: parseBuiltinCursor(args.cursor) }),
        ...(args.base ? { base: args.base } : {}),
        onPage: args.onPage,
        onRecord: args.onRecord,
      });
      return { ...report, cursor: report.cursor as unknown as Json };
    },
  }));
}

export async function streamWorkbenchBuiltinSource(args: {
  adapterId: string;
  env?: NodeJS.ProcessEnv;
  cursor?: WorkbenchBuiltinSourceCursor;
  base?: WorkbenchSourceProducerBase;
  adapters?: readonly AgentTraceAdapter[];
  onPage(page: WorkbenchSourceProducerPage): Promise<void> | void;
  onRecord(entry: WorkbenchSourceRecordEntry): Promise<void> | void;
}): Promise<WorkbenchBuiltinSourceReport> {
  const adapter = (args.adapters ?? builtinAgentTraceAdapters()).find((candidate) => candidate.id === args.adapterId);
  if (!adapter) throw new Error(`Unsupported built-in Source adapter: ${args.adapterId}`);
  const inputs: WorkbenchBuiltinSourceCursor["inputs"] = {};
  const diagnostics = new BoundedDiagnostics();
  const coverage = emptyCoverage();
  let recordCount = 0;

  const processBatch = async (batch: readonly DiscoveredInput[]): Promise<void> => {
    const priorRecordIds = uniquePriorRecordIds(batch);
    const batchBaseRecords = args.base ? await lookupRecords(args.base, priorRecordIds) : new Map<string, WorkbenchSourceRecordRef>();
    for (const { input, previous } of batch) {
      const baseRecords = selectRecords(batchBaseRecords, previous?.recordIds ?? []);
      let incremental = previous !== undefined;
      let sink = new StreamingTraceSink(adapter.id, input.key, baseRecords, args.base, args.onPage);
      let commit;
      try {
        try {
          commit = await adapter.reduceInput(input, previous?.checkpoint, sink);
        } catch (error) {
          if (!(error instanceof AgentTraceCheckpointInvalidError) || !previous) throw error;
          await sink.dispose();
          incremental = false;
          sink = new StreamingTraceSink(adapter.id, input.key, new Map(), args.base, args.onPage);
          commit = await adapter.reduceInput(input, undefined, sink);
        }
        diagnostics.add(commit.diagnostics);
        const inputCoverage = incremental && previous ? expandCursorCoverage(previous.coverage) : emptyCoverage();
        const records = incremental ? new Map(baseRecords) : new Map<string, WorkbenchSourceRecordRef>();
        for (const result of await sink.finish()) {
          inputCoverage.segments += result.segmentDelta;
          inputCoverage.bytes += result.byteDelta;
          addCoverageOmissions(inputCoverage, result.omissions);
          if (result.removeRecord) records.delete(result.recordId);
          else if (result.ref) records.set(result.ref.id, result.ref);
        }
        for (const ref of [...records.values()].sort((left, right) => left.id.localeCompare(right.id))) {
          await args.onRecord(recordEntry(ref));
          recordCount += 1;
        }
        inputCoverage.records = records.size;
        addCoverage(coverage, inputCoverage);
        const recordIds = [...records.keys()].sort();
        inputs[input.key] = {
          checkpoint: commit.checkpoint,
          ...(recordIds.length ? { recordIds } : {}),
          coverage: compactCursorCoverage(inputCoverage),
        };
      } finally {
        await sink.dispose();
      }
    }
  };

  let batch: DiscoveredInput[] = [];
  let batchRecordIds = new Set<string>();
  for await (const input of adapter.discoverInputs({ env: args.env })) {
    const previous = args.cursor?.inputs[input.key];
    const nextIds = previous?.recordIds ?? [];
    const nextUniqueCount = nextIds.reduce((count, id) => count + (batchRecordIds.has(id) ? 0 : 1), 0);
    if (batch.length && (batch.length === REUSE_BATCH_SIZE || batchRecordIds.size + nextUniqueCount > REUSE_BATCH_SIZE)) {
      await processBatch(batch);
      batch = [];
      batchRecordIds = new Set();
    }
    batch.push({ input, ...(previous ? { previous } : {}) });
    for (const id of nextIds) batchRecordIds.add(id);
  }
  if (batch.length) await processBatch(batch);
  coverage.records = recordCount;
  const cursor: WorkbenchBuiltinSourceCursor = {
    schema: "workbench.builtin-source-cursor.v2",
    inputs,
  };
  assertCursorWithinLimits(cursor as unknown as Json, WORKBENCH_BUILTIN_SOURCE_CURSOR_LIMITS);
  return {
    cursor,
    coverage,
    diagnostics: diagnostics.result(),
  };
}

function assertCursorWithinLimits(
  cursor: Json,
  limits: WorkbenchSourceProducer["cursorLimits"],
): void {
  if (Buffer.byteLength(JSON.stringify(cursor), "utf8") > limits.maximumBytes) {
    throw new Error(`Source cursor exceeds its declared ${limits.maximumBytes}-byte bound.`);
  }
  const nodes = { value: 0 };
  const visit = (value: Json, depth = 0): void => {
    if (++nodes.value > limits.maximumJsonNodes || depth > 64) {
      throw new Error("Source cursor exceeds its declared structural bound.");
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
    } else if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) visit(item, depth + 1);
    }
  };
  visit(cursor);
}

type DiscoveredInput = {
  input: AgentTraceInputRef;
  previous?: WorkbenchBuiltinSourceCursor["inputs"][string];
};

function uniquePriorRecordIds(batch: readonly DiscoveredInput[]): string[] {
  const ids = new Set<string>();
  for (const { previous } of batch) for (const id of previous?.recordIds ?? []) ids.add(id);
  return [...ids];
}

function selectRecords(records: ReadonlyMap<string, WorkbenchSourceRecordRef>, ids: readonly string[]): Map<string, WorkbenchSourceRecordRef> {
  const selected = new Map<string, WorkbenchSourceRecordRef>();
  for (const id of ids) {
    const record = records.get(id);
    if (record) selected.set(id, record);
  }
  return selected;
}

class StreamingTraceSink implements AgentTraceSink {
  readonly #descriptors = new Map<string, AgentTraceDescriptor>();
  readonly #builders = new Map<string, Promise<StreamingRecordBuilder>>();
  readonly #spool = new InputSegmentSpool();

  constructor(
    private readonly adapterId: string,
    private readonly inputKey: string,
    private readonly baseRecords: ReadonlyMap<string, WorkbenchSourceRecordRef>,
    private readonly base: WorkbenchSourceProducerBase | undefined,
    private readonly onPage: (page: WorkbenchSourceProducerPage) => Promise<void> | void,
  ) {}

  async putTrace(descriptor: AgentTraceDescriptor): Promise<void> {
    this.#descriptors.set(descriptor.id, structuredClone(descriptor));
  }

  async putEvent(traceId: string, event: AgentTraceEvent): Promise<void> {
    await (await this.builder(traceId)).add(event);
  }

  async finish(): Promise<Array<{
    recordId: string;
    ref?: WorkbenchSourceRecordRef;
    removeRecord?: true;
    segmentDelta: number;
    byteDelta: number;
    omissions: Array<{ reason: string; items: number; bytes: number }>;
  }>> {
    const results = [];
    for (const [traceId, builder] of this.#builders) {
      results.push(await (await builder).finish(this.#descriptors.get(traceId)?.workspaceRoot));
    }
    return results;
  }

  async dispose(): Promise<void> {
    await this.#spool.dispose();
  }

  private builder(traceId: string): Promise<StreamingRecordBuilder> {
    let builder = this.#builders.get(traceId);
    if (!builder) {
      const recordId = stableId("record", this.adapterId, this.inputKey, traceId);
      builder = StreamingRecordBuilder.create({
        recordId,
        traceId,
        baseRef: this.baseRecords.get(recordId),
        base: this.base,
        onPage: this.onPage,
        spool: this.#spool,
      });
      this.#builders.set(traceId, builder);
    }
    return builder;
  }
}

class StreamingRecordBuilder {
  readonly #segments: WorkbenchSourceEvidenceSegment[] = [];
  readonly #events = new Map<string, StagedEvent>();
  readonly #segmentPageHashes: string[];
  readonly #knownBasePageHashes = new Set<string>();
  #nextEventOrder = 0;
  #baseTailSegmentBytes = 0;
  #baseTailSegmentCount = 0;
  #segmentBytes = 0;
  #segmentCount = 0;
  #segmentPageBytes = EMPTY_SEGMENT_PAGE_BYTES;
  #occurredAt?: string;

  private constructor(private readonly args: {
    recordId: string;
    traceId: string;
    baseRef?: WorkbenchSourceRecordRef;
    onPage: (page: WorkbenchSourceProducerPage) => Promise<void> | void;
    spool: InputSegmentSpool;
  }, manifest?: Extract<WorkbenchSourceRecordPagePayload, { kind: "manifest" }>, extractedHashes: readonly string[] = []) {
    this.#segmentPageHashes = manifest
      ? manifest.segmentPageHashes.slice(0, manifest.segmentPageHashes.length - extractedHashes.length)
      : [];
    if (args.baseRef) this.#knownBasePageHashes.add(args.baseRef.bodyHash);
    for (const hash of extractedHashes) this.#knownBasePageHashes.add(hash);
  }

  static async create(args: {
    recordId: string;
    traceId: string;
    baseRef?: WorkbenchSourceRecordRef;
    base?: WorkbenchSourceProducerBase;
    onPage: (page: WorkbenchSourceProducerPage) => Promise<void> | void;
    spool: InputSegmentSpool;
  }): Promise<StreamingRecordBuilder> {
    let manifest: Extract<WorkbenchSourceRecordPagePayload, { kind: "manifest" }> | undefined;
    const extracted: Array<{ hash: string; page: Extract<WorkbenchSourceRecordPagePayload, { kind: "segments" }> }> = [];
    if (args.baseRef && args.base) {
      const page = await args.base.page(args.baseRef.bodyHash);
      if (!page || page.kind !== "manifest") throw new Error(`Missing Source record manifest ${args.baseRef.bodyHash}.`);
      if (page.segmentCount !== args.baseRef.segmentCount || page.textBytes !== args.baseRef.textBytes) {
        throw new Error(`Source record manifest ${args.baseRef.bodyHash} does not match its record counts.`);
      }
      manifest = page;
      const hashes = [...manifest.segmentPageHashes];
      while (hashes.length) {
        const hash = hashes.pop()!;
        const tail = await args.base.page(hash);
        if (!tail || tail.kind !== "segments") throw new Error(`Missing Source record segment page ${hash}.`);
        extracted.unshift({ hash, page: tail });
        const first = tail.segments[0];
        const parsed = first ? parseStableSegmentId(first.id) : undefined;
        if (!parsed || parsed.index === 0) break;
      }
    }
    const builder = new StreamingRecordBuilder(args, manifest, extracted.map((entry) => entry.hash));
    for (const { page } of extracted) for (const segment of page.segments) await builder.stageExisting(segment);
    builder.#baseTailSegmentCount = extracted.reduce((total, entry) => total + entry.page.segments.length, 0);
    builder.#baseTailSegmentBytes = extracted.reduce((total, entry) => total + entry.page.segments.reduce((sum, segment) => sum + utf8Bytes(segment.text), 0), 0);
    return builder;
  }

  async add(event: AgentTraceEvent): Promise<void> {
    this.#occurredAt ??= event.at;
    const evidence = evidenceText(event);
    const key = `event:${stableEventGroup(this.args.traceId, event.id)}`;
    const current = this.#events.get(key);
    const staged: StagedSegment[] = [];
    if (evidence.text) {
      let index = 0;
      for (const text of splitText(evidence.text)) {
        const digest = sha256(text);
        const prior = current?.segments[index];
        staged.push({
          id: stableSegmentId(this.args.traceId, event.id, index),
          digest,
          slice: prior?.digest === digest ? prior.slice : await this.args.spool.append(text),
        });
        index += 1;
      }
    }
    const next: StagedEvent = {
      order: current?.order ?? this.#nextEventOrder++,
      segments: staged,
      ...(!evidence.text && evidence.reason !== "incomplete-event"
        ? { omission: { reason: evidence.reason, bytes: omittedEventBytes(event) } }
        : {}),
    };
    this.#events.set(key, next);
  }

  async finish(workspaceRoot?: string): Promise<{
    recordId: string;
    ref?: WorkbenchSourceRecordRef;
    removeRecord?: true;
    segmentDelta: number;
    byteDelta: number;
    omissions: Array<{ reason: string; items: number; bytes: number }>;
  }> {
    const omissions = new Map<string, { items: number; bytes: number }>();
    for (const event of [...this.#events.values()].sort((left, right) => left.order - right.order)) {
      if (event.omission) addOmission(omissions, event.omission.reason, 1, event.omission.bytes);
      for (const segment of event.segments) await this.addSegment({ id: segment.id, text: await this.args.spool.read(segment.slice) });
    }
    await this.flushSegments();
    if (!this.#segmentPageHashes.length) {
      return {
        recordId: this.args.recordId,
        ...(this.args.baseRef ? { removeRecord: true as const } : {}),
        segmentDelta: -this.#baseTailSegmentCount,
        byteDelta: -this.#baseTailSegmentBytes,
        omissions: omissionList(omissions),
      };
    }
    const segmentDelta = this.#segmentCount - this.#baseTailSegmentCount;
    const byteDelta = this.#segmentBytes - this.#baseTailSegmentBytes;
    const segmentCount = (this.args.baseRef?.segmentCount ?? 0) + segmentDelta;
    const textBytes = (this.args.baseRef?.textBytes ?? 0) + byteDelta;
    const bodyHash = await this.flushManifest(segmentCount, textBytes);
    const ref: WorkbenchSourceRecordRef = {
      id: this.args.recordId,
      bodyHash,
      segmentCount,
      textBytes,
      label: this.args.baseRef?.label ?? sourceRecordLabel(workspaceRoot, this.args.traceId),
      ...(this.args.baseRef?.occurredAt ?? this.#occurredAt ? { occurredAt: this.args.baseRef?.occurredAt ?? this.#occurredAt } : {}),
    };
    return {
      recordId: this.args.recordId,
      ref,
      segmentDelta,
      byteDelta,
      omissions: omissionList(omissions),
    };
  }

  private async stageExisting(segment: WorkbenchSourceEvidenceSegment): Promise<void> {
    const parsed = parseStableSegmentId(segment.id);
    const key = parsed ? `event:${parsed.group}` : `existing:${segment.id}`;
    let event = this.#events.get(key);
    if (!event) {
      event = { order: this.#nextEventOrder++, segments: [] };
      this.#events.set(key, event);
    }
    event.segments.push({ id: segment.id, digest: sha256(segment.text), slice: await this.args.spool.append(segment.text) });
  }

  private async addSegment(segment: WorkbenchSourceEvidenceSegment): Promise<void> {
    const segmentBytes = utf8Bytes(JSON.stringify(segment));
    const candidatePageBytes = this.#segmentPageBytes + segmentBytes + (this.#segments.length ? 1 : 0);
    if (this.#segments.length >= WORKBENCH_SOURCE_LIMITS.segmentsPerPage || candidatePageBytes > WORKBENCH_SOURCE_LIMITS.pageBytes) {
      await this.flushSegments();
    }
    this.#segments.push(segment);
    this.#segmentPageBytes += segmentBytes + (this.#segments.length > 1 ? 1 : 0);
    this.#segmentCount += 1;
    this.#segmentBytes += utf8Bytes(segment.text);
  }

  private async flushSegments(): Promise<void> {
    if (this.#segments.length === 0) return;
    const payload = parseWorkbenchSourceRecordPagePayload({ kind: "segments", segments: this.#segments.splice(0) });
    this.#segmentPageBytes = EMPTY_SEGMENT_PAGE_BYTES;
    const hash = sha256(workbenchSourceRecordPageCanonicalJson(payload));
    if (!this.#knownBasePageHashes.has(hash)) await this.args.onPage({ recordId: this.args.recordId, hash, payload });
    this.#segmentPageHashes.push(hash);
    if (this.#segmentPageHashes.length > WORKBENCH_SOURCE_LIMITS.segmentPagesPerRecord) {
      throw new Error(`Source record exceeds ${WORKBENCH_SOURCE_LIMITS.segmentPagesPerRecord} segment pages.`);
    }
  }

  private async flushManifest(segmentCount: number, textBytes: number): Promise<string> {
    const payload = parseWorkbenchSourceRecordPagePayload({
      kind: "manifest",
      segmentPageHashes: this.#segmentPageHashes,
      segmentCount,
      textBytes,
    });
    const hash = sha256(workbenchSourceRecordPageCanonicalJson(payload));
    if (!this.#knownBasePageHashes.has(hash)) await this.args.onPage({ recordId: this.args.recordId, hash, payload });
    return hash;
  }
}

interface SpoolSlice { offset: number; bytes: number }
interface StagedSegment { id: string; digest: string; slice: SpoolSlice }
interface StagedEvent {
  order: number;
  segments: StagedSegment[];
  omission?: { reason: string; bytes: number };
}

const activeSpoolDirectories = new Set<string>();
let spoolExitHookInstalled = false;

// AgentTraceSink events are upserts, while Source pages are immutable. Keep one
// input's latest event slices in a private journal, then page only the committed
// view. A failed or interrupted reducer can replay that input safely because no
// adapter cursor advances until the authoritative Source sync commits.
class InputSegmentSpool {
  #appendOffset = 0;
  #disposed = false;
  #open?: Promise<{ directory: string; handle: fs.FileHandle }>;
  #writes: Promise<void> = Promise.resolve();

  async append(text: string): Promise<SpoolSlice> {
    if (this.#disposed) throw new Error("Source input staging is closed.");
    const buffer = Buffer.from(text, "utf8");
    const slice = { offset: this.#appendOffset, bytes: buffer.length };
    this.#appendOffset += buffer.length;
    const write = this.#writes.then(async () => writeFully((await this.open()).handle, buffer, slice.offset));
    this.#writes = write;
    await write;
    return slice;
  }

  async read(slice: SpoolSlice): Promise<string> {
    await this.#writes;
    if (this.#disposed) throw new Error("Source input staging is closed.");
    const buffer = Buffer.allocUnsafe(slice.bytes);
    await readFully((await this.open()).handle, buffer, slice.offset);
    return buffer.toString("utf8");
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const opened = this.#open ? await this.#open.catch(() => undefined) : undefined;
    try {
      await this.#writes.catch(() => undefined);
      await opened?.handle.close().catch(() => undefined);
    } finally {
      if (opened) {
        activeSpoolDirectories.delete(opened.directory);
        await fs.rm(opened.directory, { recursive: true, force: true });
      }
      uninstallSpoolExitHookIfIdle();
    }
  }

  private async open(): Promise<{ directory: string; handle: fs.FileHandle }> {
    if (this.#disposed) throw new Error("Source input staging is closed.");
    this.#open ??= openInputSegmentSpool();
    return await this.#open;
  }
}

async function openInputSegmentSpool(): Promise<{ directory: string; handle: fs.FileHandle }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-source-input-"));
  await fs.chmod(directory, 0o700);
  try {
    const handle = await fs.open(path.join(directory, "segments.bin"), "w+", 0o600);
    activeSpoolDirectories.add(directory);
    installSpoolExitHook();
    return { directory, handle };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function writeFully(handle: fs.FileHandle, buffer: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.write(buffer, offset, buffer.length - offset, position + offset);
    if (result.bytesWritten <= 0) throw new Error("Source input staging write made no progress.");
    offset += result.bytesWritten;
  }
}

async function readFully(handle: fs.FileHandle, buffer: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (result.bytesRead <= 0) throw new Error("Source input staging ended unexpectedly.");
    offset += result.bytesRead;
  }
}

function installSpoolExitHook(): void {
  if (spoolExitHookInstalled) return;
  process.once("exit", removeActiveSpoolDirectoriesSync);
  spoolExitHookInstalled = true;
}

function uninstallSpoolExitHookIfIdle(): void {
  if (!spoolExitHookInstalled || activeSpoolDirectories.size) return;
  process.off("exit", removeActiveSpoolDirectoriesSync);
  spoolExitHookInstalled = false;
}

function removeActiveSpoolDirectoriesSync(): void {
  for (const directory of activeSpoolDirectories) rmSync(directory, { recursive: true, force: true });
  activeSpoolDirectories.clear();
}

async function lookupRecords(base: WorkbenchSourceProducerBase, ids: readonly string[]): Promise<Map<string, WorkbenchSourceRecordRef>> {
  const result = new Map<string, WorkbenchSourceRecordRef>();
  for (let offset = 0; offset < ids.length; offset += REUSE_BATCH_SIZE) {
    for (const record of await base.records(ids.slice(offset, offset + REUSE_BATCH_SIZE))) result.set(record.id, record);
  }
  return result;
}

function parseBuiltinCursor(value: unknown): WorkbenchBuiltinSourceCursor {
  const cursor = cursorObject(value, "Agent-session Source cursor");
  cursorExact(cursor, ["schema", "inputs"]);
  if (cursor.schema !== "workbench.builtin-source-cursor.v2") throw new Error("Agent-session Source cursor schema is invalid.");
  const rawInputs = cursorObject(cursor.inputs, "Agent-session Source cursor inputs");
  if (Object.keys(rawInputs).length > CURSOR_INPUT_LIMIT) throw new Error(`Agent-session Source cursor exceeds ${CURSOR_INPUT_LIMIT} inputs.`);
  const inputs: WorkbenchBuiltinSourceCursor["inputs"] = {};
  for (const [key, value] of Object.entries(rawInputs)) {
    if (!key || key.length > 512) throw new Error("Agent-session Source cursor input key is invalid.");
    const input = cursorObject(value, "Agent-session Source cursor input");
    cursorExact(input, ["checkpoint", "recordIds", "coverage"]);
    if (!isWorkbenchJson(input.checkpoint)) throw new Error("Agent-session Source cursor state must be JSON.");
    const rawRecordIds = input.recordIds ?? [];
    if (!Array.isArray(rawRecordIds) || rawRecordIds.length > CURSOR_RECORDS_PER_INPUT_LIMIT) {
      throw new Error(`Agent-session Source cursor record ids exceed ${CURSOR_RECORDS_PER_INPUT_LIMIT}.`);
    }
    const recordIds = rawRecordIds.map((id) => {
      if (typeof id !== "string" || id.length > WORKBENCH_SOURCE_LIMITS.idCharacters || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id)) {
        throw new Error("Agent-session Source cursor record id is invalid.");
      }
      return id;
    });
    if (new Set(recordIds).size !== recordIds.length) throw new Error("Agent-session Source cursor record ids must be unique.");
    inputs[key] = {
      checkpoint: input.checkpoint as JsonValue,
      ...(recordIds.length ? { recordIds } : {}),
      coverage: parseCursorCoverage(input.coverage),
    };
  }
  return { schema: "workbench.builtin-source-cursor.v2", inputs };
}

function compactCursorCoverage(coverage: WorkbenchSourceSyncCoverage): WorkbenchBuiltinSourceCursorCoverage {
  return {
    records: coverage.records,
    segments: coverage.segments,
    bytes: coverage.bytes,
    ...(coverage.omissions.length ? { omissions: structuredClone(coverage.omissions) } : {}),
  };
}

function expandCursorCoverage(coverage: WorkbenchBuiltinSourceCursorCoverage): WorkbenchSourceSyncCoverage {
  const omissions = coverage.omissions ?? [];
  return parseWorkbenchSourceSyncCoverage({
    records: coverage.records,
    segments: coverage.segments,
    bytes: coverage.bytes,
    omittedItems: omissions.reduce((total, omission) => total + omission.items, 0),
    omittedBytes: omissions.reduce((total, omission) => total + omission.bytes, 0),
    omissions,
  });
}

function parseCursorCoverage(value: unknown): WorkbenchBuiltinSourceCursorCoverage {
  const coverage = cursorObject(value, "Agent-session Source cursor coverage");
  cursorExact(coverage, ["records", "segments", "bytes", "omissions"]);
  const omissions = coverage.omissions === undefined ? [] : coverage.omissions;
  const omissionValues = Array.isArray(omissions) ? omissions : [];
  const full = parseWorkbenchSourceSyncCoverage({
    records: coverage.records,
    segments: coverage.segments,
    bytes: coverage.bytes,
    omittedItems: omissionValues.reduce((total, omission) => total + Number(cursorObject(omission, "Agent-session Source cursor omission").items), 0),
    omittedBytes: omissionValues.reduce((total, omission) => total + Number(cursorObject(omission, "Agent-session Source cursor omission").bytes), 0),
    omissions,
  });
  return compactCursorCoverage(full);
}

function cursorObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value as Record<string, unknown>;
}

function cursorExact(record: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  const extra = Object.keys(record).find((key) => !allowed.has(key));
  if (extra) throw new Error(`Agent-session Source cursor contains unsupported field ${extra}.`);
}

function evidenceText(event: AgentTraceEvent): { text?: string; reason: string } {
  if (event.kind === "message") return event.channel === "visible" && event.text ? { text: `${title(event.role)}\n${event.text}`, reason: "" } : { reason: "non-visible-message" };
  if (event.kind === "compaction") return event.summary ? { text: `Compaction\n${event.summary}`, reason: "" } : { reason: "empty-event" };
  if (event.incomplete) return { reason: "incomplete-event" };
  const fields = [event.name ? `Tool\n${event.name}` : "Tool", event.input === undefined ? null : `Input\n${stableJson(event.input)}`, event.output === undefined ? null : `Output\n${stableJson(event.output)}`, event.error ? `Error\n${event.error}` : null].filter((value): value is string => value !== null);
  return fields.length > 1 || event.name || event.error ? { text: fields.join("\n\n"), reason: "" } : { reason: "empty-event" };
}

function* splitText(text: string): Generator<string> {
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + SEGMENT_CONTENT_BYTES);
    if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end -= 1;
    while (utf8Bytes(text.slice(start, end)) > SEGMENT_CONTENT_BYTES) {
      end = start + Math.max(1, Math.floor((end - start) * 0.75));
      if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end -= 1;
    }
    yield text.slice(start, end);
    start = end;
  }
}

class BoundedDiagnostics {
  readonly items: WorkbenchSourceProducerDiagnostic[] = [];
  readonly #seen = new Set<string>();
  total = 0;
  add(values: readonly AgentTraceDiagnostic[]): void {
    this.total += values.length;
    for (const { code, message } of values) {
      const identity = `${code}\0${message}`;
      if (this.#seen.has(identity)) continue;
      this.#seen.add(identity);
      if (this.items.length < DIAGNOSTIC_LIMIT) this.items.push({ code, message });
    }
  }
  result() { return { items: this.items, total: this.total, truncated: this.total - this.items.length }; }
}

function emptyCoverage(): WorkbenchSourceSyncCoverage { return { records: 0, segments: 0, bytes: 0, omittedItems: 0, omittedBytes: 0, omissions: [] }; }
function addCoverage(target: WorkbenchSourceSyncCoverage, source: WorkbenchSourceSyncCoverage): void { target.records += source.records; target.segments += source.segments; target.bytes += source.bytes; addCoverageOmissions(target, source.omissions); }
function addCoverageOmissions(target: WorkbenchSourceSyncCoverage, omissions: readonly { reason: string; items: number; bytes: number }[]): void {
  const combined = new Map(target.omissions.map((entry) => [entry.reason, { items: entry.items, bytes: entry.bytes }]));
  for (const omission of omissions) addOmission(combined, omission.reason, omission.items, omission.bytes);
  target.omissions = omissionList(combined);
  target.omittedItems = target.omissions.reduce((total, entry) => total + entry.items, 0);
  target.omittedBytes = target.omissions.reduce((total, entry) => total + entry.bytes, 0);
}
function omissionList(values: Map<string, { items: number; bytes: number }>) { return [...values.entries()].map(([reason, counts]) => ({ reason, ...counts })); }
function addOmission(target: Map<string, { items: number; bytes: number }>, reason: string, items: number, bytes: number): void { const current = target.get(reason) ?? { items: 0, bytes: 0 }; target.set(reason, { items: current.items + items, bytes: current.bytes + bytes }); }
function recordEntry(ref: WorkbenchSourceRecordRef): WorkbenchSourceRecordEntry { return { id: ref.id, bodyHash: ref.bodyHash, ...(ref.label ? { label: ref.label } : {}), ...(ref.occurredAt ? { occurredAt: ref.occurredAt } : {}) }; }
function sourceRecordLabel(workspaceRoot: string | undefined, traceId: string): string { return `${workspaceRoot ? path.basename(workspaceRoot) : "Session"} · ${traceId.slice(-80)}`.slice(0, WORKBENCH_SOURCE_LIMITS.labelCharacters); }
function stableEventGroup(traceId: string, eventId: string): string { return sha256(`${traceId}\0${eventId}`); }
function stableSegmentId(traceId: string, eventId: string, index: number): string { return `segment_${stableEventGroup(traceId, eventId)}_${index.toString(36)}`; }
function parseStableSegmentId(id: string): { group: string; index: number } | undefined {
  const match = /^segment_([a-f0-9]{64})_([0-9a-z]+)$/u.exec(id);
  if (!match) return undefined;
  const index = Number.parseInt(match[2]!, 36);
  return Number.isSafeInteger(index) && index >= 0 ? { group: match[1]!, index } : undefined;
}
function stableId(prefix: string, ...parts: string[]): string { return `${prefix}_${sha256(parts.join("\0"))}`; }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function utf8Bytes(value: string): number { return Buffer.byteLength(value, "utf8"); }
function omittedEventBytes(event: AgentTraceEvent): number { return event.kind === "message" ? utf8Bytes(event.text) : event.kind === "compaction" ? utf8Bytes(event.summary ?? "") : utf8Bytes(event.error ?? event.name ?? ""); }
function stableJson(value: JsonValue): string { return JSON.stringify(sortJson(value)); }
function sortJson(value: JsonValue): JsonValue { return Array.isArray(value) ? value.map(sortJson) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortJson(item)])) : value; }
function title(value: string): string { return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`; }
function isLowSurrogate(value: number): boolean { return value >= 0xdc00 && value <= 0xdfff; }
