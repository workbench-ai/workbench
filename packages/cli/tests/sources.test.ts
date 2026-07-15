import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  builtinWorkbenchSourceProducers,
  type WorkbenchSourceProducer,
} from "@workbench-ai/workbench-built-in-adapters";
import {
  workbenchSourceSyncEventCanonicalJson,
  type WorkbenchEvidenceSnapshot,
  type WorkbenchSource,
  type WorkbenchSourceSyncBatch,
  type WorkbenchSourceSyncSession,
} from "@workbench-ai/workbench-contract";
import {
  bindLocalWorkbenchSource,
  readLocalWorkbenchSourceBinding,
  readLocalWorkbenchSourceCheckpoint,
  syncLocalWorkbenchSource,
  type WorkbenchSourceApiRequest,
} from "../src/sources.ts";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
describe("local Source synchronization", () => {
  test("streams a namespaced Codex Source and persists the committed cursor", async () => {
    const fixture = await sourceFixture();
    const api = sourceApi();
    const progress: Array<{ phase: string; events: number; records: number }> = [];
    const result = await syncFixture(fixture, api.request, undefined, (event) => progress.push(event));
    expect(result).not.toHaveProperty("schema");
    expect(result.records).toBe(1);
    expect(result.uploadedPages).toBeGreaterThan(0);
    expect(result.namespace).toBe("acme");
    expect(api.paths.filter((entry) => entry.path.includes("/api/workbench/sources/"))
      .every((entry) => new URL(entry.path, "https://cloud.test").searchParams.get("namespace") === "acme"))
      .toBe(true);
    const checkpoint = await readLocalWorkbenchSourceCheckpoint(fixture.source.id, fixture.home);
    expect(checkpoint.activeSyncSessionId).toBeUndefined();
    expect(Object.keys(checkpoint.committedCursor?.inputs ?? {})).toHaveLength(1);
    expect(progress[0]?.phase).toBe("connecting");
    expect(progress.at(-1)).toMatchObject({ phase: "complete", events: result.uploadedPages + result.records + 1, records: 1 });
  });
  test("writes the cursor only after an acknowledged commit and converges through a replacement session", async () => {
    const fixture = await sourceFixture();
    const api = sourceApi();
    let loseCommit = true;
    const request: WorkbenchSourceApiRequest = async <T>(apiPath: string, options, baseUrl) => {
      if (loseCommit && /\/commit(?:\?|$)/u.test(apiPath)) {
        loseCommit = false;
        await api.request(apiPath, options, baseUrl);
        api.session.status = "committed";
        throw new Error("lost commit response");
      }
      if (api.session.status === "committed" && options?.method === "POST" && /\/syncs(?:\?|$)/u.test(apiPath)) {
        Object.assign(api.session, { id: "sync_2", status: "open", nextSequence: 0 });
        delete api.session.prefixHash;
      }
      return await api.request<T>(apiPath, options, baseUrl);
    };
    await expect(syncFixture(fixture, request)).rejects.toThrow(/lost commit response/u);
    expect((await readLocalWorkbenchSourceCheckpoint(fixture.source.id, fixture.home)).committedCursor).toBeUndefined();
    await expect(syncFixture(fixture, request)).resolves.toMatchObject({ records: 1 });
    expect(await readLocalWorkbenchSourceCheckpoint(fixture.source.id, fixture.home)).toMatchObject({ committedCursor: { inputs: expect.any(Object) } });
  });
  test("uploads one bounded ordered stream of page, record, and finish events", async () => {
    const fixture = await sourceFixture("generic");
    const api = sourceApi();
    await syncFixture(fixture, api.request, [recordProducer(17)]);
    const batches = api.paths.filter(isSyncBatchRequest).map((entry) => entry.body as WorkbenchSourceSyncBatch);
    expect(batches.map((batch) => batch.events.length)).toEqual([8, 8, 8, 8, 3]);
    expect(batches.map((batch) => batch.sequence)).toEqual([0, 8, 16, 24, 32]);
    expect(batches.flatMap((batch) => batch.events).at(-1)?.kind).toBe("finish");
    expect(batches.every((batch) => batch.schema === "workbench.source.sync-batch.v1")).toBe(true);
    expect((await readLocalWorkbenchSourceCheckpoint(fixture.source.id, fixture.home)).committedCursor).toEqual({ count: 17 });
  });
  test("repeats the same commit request until bounded server materialization completes", async () => {
    const fixture = await sourceFixture("generic");
    const api = sourceApi();
    let commitCalls = 0;
    const request: WorkbenchSourceApiRequest = async <T>(apiPath, options, baseUrl) => {
      if (/\/commit(?:\?|$)/u.test(apiPath) && commitCalls++ === 0) {
        return { schema: "workbench.source.sync-commit-progress.v1", processedRecords: 1, totalRecords: 2 } as T;
      }
      return await api.request<T>(apiPath, options, baseUrl);
    };
    await expect(syncFixture(fixture, request, [recordProducer(2)])).resolves.toMatchObject({ records: 2 });
    expect(commitCalls).toBe(2);
  });
  test.each([
    ["size", { payload: "x".repeat(1_024) }, { maximumBytes: 1_024, maximumJsonNodes: 1_000 }, /declared 1024-byte bound/u],
    ["structure", { items: Array.from({ length: 11 }, () => null) }, { maximumBytes: 1_024, maximumJsonNodes: 10 }, /structural bound/u],
  ])("rejects unsafe cursor %s before finishing or committing remotely", async (_name, cursor, cursorLimits, error) => {
    const fixture = await sourceFixture("unsafe-cursor");
    const api = sourceApi();
    await expect(syncFixture(fixture, api.request, [{ id: "unsafe-cursor", cursorLimits, async stream() { return { cursor, coverage: coverage(0), diagnostics: { items: [], total: 0, truncated: 0 } }; } }]))
      .rejects.toThrow(error);
    expect(api.paths.some((entry) => /\/commit(?:\?|$)/u.test(entry.path))).toBe(false);
    expect(api.paths.filter(isSyncBatchRequest).flatMap((entry) => (entry.body as WorkbenchSourceSyncBatch).events).some((event) => event.kind === "finish")).toBe(false);
    const checkpoint = await readLocalWorkbenchSourceCheckpoint(fixture.source.id, fixture.home);
    expect(checkpoint.activeSyncSessionId).toBe("sync_1");
    expect(checkpoint.committedCursor).toBeUndefined();
  }, 20_000);
  test("rejects a adapter cursor declaration the local binding cannot persist before opening a sync", async () => {
    const fixture = await sourceFixture("unsupported-cursor");
    const api = sourceApi();
    const producer: WorkbenchSourceProducer = {
      id: "unsupported-cursor",
      cursorLimits: { maximumBytes: 128 * 1024 * 1024 + 1, maximumJsonNodes: 1 },
      async stream() { throw new Error("producer must not run"); },
    };
    await expect(syncFixture(fixture, api.request, [producer])).rejects.toThrow(/declares unsupported cursor limits/u);
    expect(api.paths).toEqual([]);
  });
  test("locks one local Source sync process", async () => {
    const fixture = await sourceFixture(), lock = path.join(path.dirname(bindingFile(fixture)), "sync.lock");
    await fs.writeFile(lock, JSON.stringify({ pid: process.pid, hostname: os.hostname(), token: "live" }));
    await expect(syncFixture(fixture, async () => { throw new Error("API must not run"); })).rejects.toMatchObject({ code: "source_sync_locked" });
  });
  test("resumes a long interrupted producer from server sequences without replaying accepted pages", async () => {
    const fixture = await sourceFixture("generic");
    const api = interruptedSourceApi(296);
    await expect(syncFixture(fixture, api.request, [recordProducer(1_024)])).rejects.toThrow(/simulated interruption/u);
    expect((await readLocalWorkbenchSourceCheckpoint(fixture.source.id, fixture.home)).activeSyncSessionId).toBe("sync_1");
    api.batchSequences.length = 0;
    const resumed = await syncFixture(fixture, api.request, [recordProducer(1_024)]);
    expect(api.batchSequences[0]).toBe(304);
    expect(resumed.uploadedPages).toBe(872);
    expect(resumed.records).toBe(1_024);
  });
});
function syncFixture(
  fixture: Awaited<ReturnType<typeof sourceFixture>>,
  request: WorkbenchSourceApiRequest,
  producers = builtinWorkbenchSourceProducers(),
  onProgress?: Parameters<typeof syncLocalWorkbenchSource>[0]["onProgress"],
) {
  return syncLocalWorkbenchSource({
    sourceId: fixture.source.id,
    homeDir: fixture.home,
    env: { CODEX_HOME: fixture.codexHome },
    producers,
    request,
    ...(onProgress ? { onProgress } : {}),
  });
}
function recordProducer(count: number): WorkbenchSourceProducer {
  return {
    id: "generic",
    cursorLimits: { maximumBytes: 1024, maximumJsonNodes: 100 },
    async stream(args) {
      for (let index = 0; index < count; index += 1) {
        const ordinal = count - index;
        const id = `record_${ordinal.toString().padStart(6, "0")}`;
        const pageHash = hash(`page:${index}`);
        const bodyHash = hash(`body:${index}`);
        await args.onPage({ recordId: id, hash: pageHash, payload: { kind: "segments", segments: [{ id: `segment_${index}`, text: "x" }] } });
        await args.onRecord({ id, bodyHash });
      }
      return {
        cursor: { count },
        coverage: { records: count, segments: count, bytes: count, omittedItems: 0, omittedBytes: 0, omissions: [] },
        diagnostics: { items: [], total: 0, truncated: 0 },
      };
    },
  };
}
function coverage(records: number) { return { records, segments: records, bytes: records, omittedItems: 0, omittedBytes: 0, omissions: [] }; }
function bindingFile(fixture: Awaited<ReturnType<typeof sourceFixture>>) { return path.join(fixture.home, ".workbench", "sources", fixture.source.id, "binding.json"); }
async function sourceFixture(adapterId = "codex"): Promise<{ home: string; codexHome: string; source: WorkbenchSource }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-source-sync-"));
  roots.push(root);
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex");
  const sessionPath = path.join(codexHome, "sessions", "2026", "07", "14", "session.jsonl");
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  await fs.writeFile(sessionPath, [
    { type: "session_meta", payload: { id: "session_1", cwd: "/tmp/project" } },
    { timestamp: "2026-07-14T00:00:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Review the invoice." }] } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  const source = testSource();
  await bindLocalWorkbenchSource({ source, baseUrl: "https://cloud.test", namespace: "acme", adapterId, homeDir: home });
  return { home, codexHome, source };
}
function sourceApi(sessionStatus: WorkbenchSourceSyncSession["status"] = "open") {
  const paths: Array<{ path: string; method: string; body?: unknown }> = [];
  const source = testSource(sessionStatus === "committed" ? "snapshot_1" : undefined);
  const session: WorkbenchSourceSyncSession = {
    schema: "workbench.source.sync-session.v1",
    id: "sync_1",
    sourceId: source.id,
    nextSequence: 0,
    status: sessionStatus,
  };
  const snapshot = {
    schema: "workbench.source.evidence-snapshot.v1",
    id: "snapshot_1",
    sourceId: source.id,
  } as WorkbenchEvidenceSnapshot;
  const request: WorkbenchSourceApiRequest = async <T>(apiPath: string, options = {}) => {
    const method = options.method ?? "GET";
    paths.push({ path: apiPath, method, ...(options.body === undefined ? {} : { body: options.body }) });
    if (apiPath.includes("/records/lookup")) return { schema: "workbench.source.record-lookup-result.v1", records: [] } as T;
    if (apiPath.includes("/commit")) return { schema: "workbench.source.sync-commit-result.v1", source: { ...source, currentSnapshotId: snapshot.id }, snapshot } as T;
    if (/\/syncs\/sync_\d+(?:\?|$)/u.test(apiPath) && method === "GET") return { session } as T;
    if (/\/syncs(?:\?|$)/u.test(apiPath) && method === "POST") return { session: { ...session, status: "open" } } as T;
    if (method === "GET" && /\/sources\/source_1\?/u.test(apiPath)) {
      return { source: { source, recordCount: 0 }, records: { items: [] }, analyses: { items: [] }, capabilities: {} } as T;
    }
    return {} as T;
  };
  return { paths, request, session };
}
function interruptedSourceApi(failAtSequence: number) {
  const fallback = sourceApi();
  const { session } = fallback;
  const batchSequences: number[] = [];
  let failOnce = true;
  const request: WorkbenchSourceApiRequest = async <T>(apiPath: string, options = {}) => {
    const method = options.method ?? "GET";
    if (/\/syncs\/sync_1(?:\?|$)/u.test(apiPath) && method === "PUT") {
      const batch = options.body as WorkbenchSourceSyncBatch;
      expect(batch.sequence).toBe(session.nextSequence);
      batchSequences.push(batch.sequence);
      for (const event of batch.events) session.prefixHash = extendPrefix(session.prefixHash, hash(workbenchSourceSyncEventCanonicalJson(event)));
      session.nextSequence += batch.events.length;
      if (failOnce && batch.sequence === failAtSequence) {
        failOnce = false;
        throw new Error("simulated interruption");
      }
      return { session } as T;
    }
    return await fallback.request<T>(apiPath, options);
  };
  return { request, batchSequences };
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function extendPrefix(previous: string | undefined, canonicalHash: string): string {
  return hash(previous ? `${previous}\0${canonicalHash}` : canonicalHash);
}
function isSyncBatchRequest(entry: { path: string; method: string; body?: unknown }): boolean {
  return entry.method === "PUT" && /\/syncs\/sync_1(?:\?|$)/u.test(entry.path);
}
function testSource(currentSnapshotId?: string): WorkbenchSource {
  return { schema: "workbench.source.v1", id: "source_1", name: "Local Codex", namespaceId: "namespace_1", ...(currentSnapshotId ? { currentSnapshotId } : {}), createdAt: "2026-07-14T00:00:00.000Z", updatedAt: "2026-07-14T00:00:00.000Z" };
}
