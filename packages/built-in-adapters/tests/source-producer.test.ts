import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { AgentTraceAdapter } from "@workbench-ai/agent-driver";
import { claudeAgentTraceAdapter } from "@workbench-ai/agent-driver-anthropic-claude-code";
import { codexAgentTraceAdapter } from "@workbench-ai/agent-driver-openai-codex";
import type { WorkbenchSourceEvidenceSegment, WorkbenchSourceRecordEntry, WorkbenchSourceRecordPagePayload, WorkbenchSourceRecordRef } from "@workbench-ai/workbench-contract";
import {
  builtinWorkbenchSourceProducers,
  streamWorkbenchBuiltinSource,
  type WorkbenchSourceProducerBase,
  type WorkbenchSourceProducerPage,
} from "../src/source-producer.js";

const tempRoots: string[] = [];

afterEach(async () => { await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("built-in Source producer", () => {
  test("streams changed pages, reuses checkpoints, and performs bounded record lookup", async () => {
    const fixture = mutableAdapter();
    const stored = inMemoryBase();
    const firstPages: WorkbenchSourceProducerPage[] = [];
    const firstRecords: WorkbenchSourceRecordEntry[] = [];
    const first = await streamWorkbenchBuiltinSource({
      adapterId: "fixture", adapters: [fixture.adapter], base: stored,
      onPage: (page) => { firstPages.push(page); stored.putPage(page); },
      onRecord: (record) => { firstRecords.push(record); stored.putRecord(record); },
    });
    expect(first.coverage).toMatchObject({ records: 1, segments: 3, omittedItems: 1 });
    expect(firstPages.find((page) => page.hash === firstRecords[0]?.bodyHash)?.payload).toMatchObject({
      kind: "manifest",
      segmentCount: first.coverage.segments,
      textBytes: first.coverage.bytes,
    });
    expect(firstPages.at(-1)?.payload.kind).toBe("manifest");
    expect(first.cursor.schema).toBe("workbench.builtin-source-cursor.v2");
    expect(Object.values(first.cursor.inputs)[0]).not.toHaveProperty("ref");
    expect(Object.values(first.cursor.inputs)[0]?.coverage).not.toHaveProperty("omittedItems");
    expect(Object.values(first.cursor.inputs)[0]?.coverage).not.toHaveProperty("omittedBytes");

    const unchangedPages: WorkbenchSourceProducerPage[] = [];
    const unchanged = await streamWorkbenchBuiltinSource({
      adapterId: "fixture", adapters: [fixture.adapter], cursor: first.cursor, base: stored,
      onPage: (page) => unchangedPages.push(page), onRecord: () => undefined,
    });
    expect(fixture.previousCheckpoints.at(-1)).toEqual({ offset: 42 });
    expect(stored.maximumLookup).toBeLessThanOrEqual(256);
    expect(unchangedPages).toEqual([]);
    expect(unchanged.coverage).toEqual(first.coverage);

    fixture.revision = 2;
    const appendPages: WorkbenchSourceProducerPage[] = [];
    const appendedRecords: WorkbenchSourceRecordEntry[] = [];
    const appended = await streamWorkbenchBuiltinSource({
      adapterId: "fixture", adapters: [fixture.adapter], cursor: unchanged.cursor, base: stored,
      onPage: (page) => appendPages.push(page), onRecord: (record) => appendedRecords.push(record),
    });
    expect(appendPages.map((page) => page.payload.kind)).toEqual(["segments", "manifest"]);
    expect(appended.coverage.segments).toBe(first.coverage.segments + 1);
    expect(appendPages.find((page) => page.hash === appendedRecords[0]?.bodyHash)?.payload).toMatchObject({
      kind: "manifest",
      segmentCount: appended.coverage.segments,
      textBytes: appended.coverage.bytes,
    });
  });

  test("deduplicates snapshot reuse across deterministic bounded discovery batches", async () => {
    const inputCount = 1_024;
    const adapter = manyInputsAdapter(inputCount);
    const stored = inMemoryBase();
    const firstRecordIds: string[] = [];
    const first = await streamWorkbenchBuiltinSource({
      adapterId: adapter.id,
      adapters: [adapter],
      base: stored,
      onPage: (page) => stored.putPage(page),
      onRecord: (record) => { firstRecordIds.push(record.id); stored.putRecord(record); },
    });
    expect(first.coverage.records).toBe(inputCount);
    expect(stored.lookupSizes).toEqual([]);

    const reusedRecordIds: string[] = [];
    const second = await streamWorkbenchBuiltinSource({
      adapterId: adapter.id,
      adapters: [adapter],
      cursor: first.cursor,
      base: stored,
      onPage: () => undefined,
      onRecord: (record) => reusedRecordIds.push(record.id),
    });

    expect(stored.lookupSizes).toEqual([256, 256, 256, 256]);
    expect(stored.maximumLookup).toBe(256);
    expect(reusedRecordIds).toEqual(firstRecordIds);
    expect(second.coverage).toEqual(first.coverage);
    expect(Object.keys(second.cursor.inputs)).toEqual(Array.from({ length: inputCount }, (_, index) => `input_${index.toString().padStart(4, "0")}`));
  });

  test("scopes native trace ids to their discovered input", async () => {
    const adapter: AgentTraceAdapter = {
      id: "duplicate-native-ids",
      displayName: "Duplicate native ids",
      async *discoverInputs() {
        yield { key: "input-a", value: { text: "Evidence A" } };
        yield { key: "input-b", value: { text: "Evidence B" } };
      },
      async reduceInput(ref, _previous, sink) {
        await sink.putTrace({ id: "shared-native-id" });
        await sink.putEvent("shared-native-id", visible("event", (ref.value as { text: string }).text));
        return { checkpoint: {}, diagnostics: [] };
      },
    };
    const records: WorkbenchSourceRecordEntry[] = [];
    const report = await streamWorkbenchBuiltinSource({
      adapterId: adapter.id,
      adapters: [adapter],
      onPage: () => undefined,
      onRecord: (record) => records.push(record),
    });

    expect(report.coverage.records).toBe(2);
    expect(new Set(records.map((record) => record.id)).size).toBe(2);
    expect(Object.values(report.cursor.inputs).map((input) => input.recordIds?.length)).toEqual([1, 1]);
  });

  test("does not retain a transient incomplete-event omission", async () => {
    const fixture = incompleteThenCompleteAdapter();
    const stored = inMemoryBase();
    const first = await run(fixture.adapter, stored);
    expect(first.coverage.omissions).toEqual([]);
    fixture.complete = true;
    const second = await run(fixture.adapter, stored, first.cursor);
    expect(second.coverage).toMatchObject({ segments: 1, omittedItems: 0 });
  });

  test("uses the real Codex stable-path checkpoint for no-change and append", async () => {
    const root = await temporaryDirectory("workbench-source-codex-");
      const sourcePath = path.join(root, "sessions", "session.jsonl");
      await fs.mkdir(path.dirname(sourcePath), { recursive: true });
      await fs.writeFile(sourcePath, jsonLine({ type: "session_meta", payload: { id: "incremental", cwd: "/tmp/source" } }) + jsonLine({ timestamp: "2026-07-14T00:00:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "First task." }] } }));
      const stored = inMemoryBase();
      const first = await run(codexAgentTraceAdapter, stored, undefined, { CODEX_HOME: root });
      const noChangePages: WorkbenchSourceProducerPage[] = [];
      const unchanged = await streamWorkbenchBuiltinSource({ adapterId: "codex", adapters: [codexAgentTraceAdapter], env: { CODEX_HOME: root }, cursor: first.cursor, base: stored, onPage: (page) => noChangePages.push(page), onRecord: () => undefined });
      expect(noChangePages).toEqual([]);
      await fs.appendFile(sourcePath, jsonLine({ timestamp: "2026-07-14T00:01:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Second task." }] } }));
      const pages: WorkbenchSourceProducerPage[] = [];
      const appended = await streamWorkbenchBuiltinSource({ adapterId: "codex", adapters: [codexAgentTraceAdapter], env: { CODEX_HOME: root }, cursor: unchanged.cursor, base: stored, onPage: (page) => pages.push(page), onRecord: () => undefined });
      expect(appended.coverage.segments).toBe(first.coverage.segments + 1);
      expect(pages[0]?.payload.kind).toBe("segments");
      expect(pages[0]?.payload.kind === "segments" && pages[0].payload.segments.some((segment) => segment.text.includes("Second task."))).toBe(true);
  });

  test("stages one input privately and emits only its committed last-write view", async () => {
    const eventCount = 512;
    let reducerComplete = false;
    let pagesBeforeComplete = 0;
    const adapter = generatedAdapter(eventCount, "x".repeat(16 * 1024), () => { reducerComplete = true; });
    let emittedPages = 0;
    const report = await streamWorkbenchBuiltinSource({
      adapterId: "generated", adapters: [adapter],
      onPage: () => { emittedPages += 1; if (!reducerComplete) pagesBeforeComplete += 1; },
      onRecord: () => undefined,
    });
    expect(report.coverage.segments).toBe(eventCount);
    expect(pagesBeforeComplete).toBe(0);
    expect(emittedPages).toBeGreaterThan(1);
  });

  test("bounds memory for a multi-record Codex input with a 9.64 MiB line and exact upserts", async () => {
    const fixture = await installLargeLineCodexFixture();
      const ids = new Set<string>();
      const giantOutputHash = createHash("sha256");
      let giantOutputBytes = 0;
      let duplicateEvidence = 0;
      let completedToolEvidence = 0;
      let records = 0;
      const rssBefore = process.memoryUsage().rss;
      let peakRss = rssBefore;
      const sampler = setInterval(() => {
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
      }, 1);
      sampler.unref();
      let report: Awaited<ReturnType<typeof streamWorkbenchBuiltinSource>> | undefined;
      try {
        report = await streamWorkbenchBuiltinSource({
          adapterId: "codex",
          adapters: [codexAgentTraceAdapter],
          env: { CODEX_HOME: fixture.home },
          onPage(page) {
            peakRss = Math.max(peakRss, process.memoryUsage().rss);
            if (page.payload.kind !== "segments") return;
            for (const segment of page.payload.segments) {
              expect(ids.has(segment.id)).toBe(false);
              ids.add(segment.id);
              if (/^(?:User\n)?x+$/u.test(segment.text)) {
                giantOutputHash.update(segment.text);
                giantOutputBytes += Buffer.byteLength(segment.text, "utf8");
              }
              if (segment.text.includes(fixture.duplicateText)) duplicateEvidence += 1;
              if (segment.text.includes('Output\n{"ok":true}')) completedToolEvidence += 1;
            }
          },
          onRecord() { records += 1; },
        });
      } finally {
        clearInterval(sampler);
      }

      expect(fixture.lineBytes).toBe(9_638_455);
      expect(records).toBe(2);
      expect(report!.coverage.records).toBe(2);
      expect(report!.coverage.segments).toBe(ids.size);
      expect(duplicateEvidence).toBe(1);
      expect(completedToolEvidence).toBe(1);
      expect(giantOutputBytes).toBe(fixture.giantEvidenceBytes);
      expect(giantOutputHash.digest("hex")).toBe(fixture.giantEvidenceHash);
      expect(peakRss - rssBefore).toBeLessThan(320 * 1024 * 1024);
  }, 30_000);

  test("coalesces Claude fragments and replaces the immutable tail on an incremental completion", async () => {
    const fixture = await installClaudeFixture();
      const stored = inMemoryBase();
      const first = await run(claudeAgentTraceAdapter, stored, undefined, { AGENT_RUNTIME_CLAUDE_HOME: fixture.home });
      expect(stored.segments().map((segment) => segment.text)).toEqual([
        "User\nSynthetic task.",
        "Assistant\nFirst fragment.",
      ]);

      await fs.appendFile(fixture.sessionPath, [
        claudeAssistantRecord("fragment-2", "Second fragment."),
        claudeUserRecord("follow-up", "Follow-up task."),
      ].map(jsonLine).join(""));
      const second = await run(claudeAgentTraceAdapter, stored, first.cursor, { AGENT_RUNTIME_CLAUDE_HOME: fixture.home });
      const segments = stored.segments();
      expect(second.coverage.segments).toBe(3);
      expect(new Set(segments.map((segment) => segment.id)).size).toBe(segments.length);
      expect(segments.map((segment) => segment.text)).toEqual([
        "User\nSynthetic task.",
        "Assistant\nFirst fragment.\n\nSecond fragment.",
        "User\nFollow-up task.",
      ]);
  });

  test("uses private staging permissions and cleans staging after reducer failure", async () => {
    const before = await stagingDirectories();
    let stagedDirectory = "";
    const adapter: AgentTraceAdapter = {
      id: "failing", displayName: "Failing",
      async *discoverInputs() { yield { key: "input", value: {} }; },
      async reduceInput(_ref, _previous, sink) {
        await sink.putTrace({ id: "trace" });
        await sink.putEvent("trace", visible("event", "sensitive evidence"));
        const during = (await stagingDirectories()).filter((entry) => !before.includes(entry));
        expect(during).toHaveLength(1);
        stagedDirectory = path.join(os.tmpdir(), during[0]!);
        expect((await fs.stat(stagedDirectory)).mode & 0o777).toBe(0o700);
        expect((await fs.stat(path.join(stagedDirectory, "segments.bin"))).mode & 0o777).toBe(0o600);
        throw new Error("synthetic reducer failure");
      },
    };
    await expect(streamWorkbenchBuiltinSource({ adapterId: adapter.id, adapters: [adapter], onPage: () => undefined, onRecord: () => undefined })).rejects.toThrow("synthetic reducer failure");
    await expect(fs.stat(stagedDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await stagingDirectories()).toEqual(before);
  });

  test.runIf(process.env.WORKBENCH_LONG_SOURCE_BENCHMARK === "1")(
    "keeps RSS bounded while streaming a roughly 512 MiB Codex JSONL session",
    async () => {
      const eventCount = Number(process.env.WORKBENCH_LONG_SOURCE_EVENTS ?? 32_768);
      const root = await temporaryDirectory("workbench-source-long-codex-");
        const sourcePath = path.join(root, "sessions", "long-session.jsonl");
        await fs.mkdir(path.dirname(sourcePath), { recursive: true });
        const writer = createWriteStream(sourcePath);
        writer.write(jsonLine({ type: "session_meta", payload: { id: "long-session", cwd: "/tmp/source" } }));
        const text = "x".repeat(16 * 1024);
        for (let index = 0; index < eventCount; index += 1) {
          if (!writer.write(jsonLine({
            timestamp: "2026-07-14T00:00:00.000Z",
            type: "response_item",
            payload: { type: "message", role: "user", content: [{ type: "input_text", text: `${index}:${text}` }] },
          }))) await once(writer, "drain");
        }
        writer.end();
        await once(writer, "close");
        const rssBefore = process.memoryUsage().rss;
        let peakRss = rssBefore;
        const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 2);
        sampler.unref();
        let report: Awaited<ReturnType<typeof streamWorkbenchBuiltinSource>>;
        let rootPage: WorkbenchSourceProducerPage | undefined;
        let record: WorkbenchSourceRecordEntry | undefined;
        let rootCount = 0;
        try {
          report = await streamWorkbenchBuiltinSource({
            adapterId: "codex",
            adapters: [codexAgentTraceAdapter],
            env: { CODEX_HOME: root },
            onPage: (page) => {
              peakRss = Math.max(peakRss, process.memoryUsage().rss);
              if (page.payload.kind === "manifest") { rootPage = page; rootCount += 1; }
            },
            onRecord: (next) => { record = next; },
          });
        } finally {
          clearInterval(sampler);
        }
        expect(report.coverage.segments).toBe(eventCount);
        expect(rootCount).toBe(1);
        expect(rootPage?.payload).toMatchObject({ kind: "manifest", segmentCount: report.coverage.segments, textBytes: report.coverage.bytes });
        expect(rootPage?.payload.kind === "manifest" ? rootPage.payload.segmentPageHashes.length : Infinity).toBeLessThanOrEqual(8_192);
        expect(record?.bodyHash).toBe(rootPage?.hash);
        const peakRssDelta = peakRss - rssBefore;
        console.info(`512 MiB Source producer peak RSS delta: ${(peakRssDelta / (1024 * 1024)).toFixed(1)} MiB`);
        expect(peakRssDelta).toBeLessThan(320 * 1024 * 1024);
    },
    120_000,
  );

  test("persists stable UTF-8 segments that each fit one analysis evidence pack", async () => {
    const pages: WorkbenchSourceProducerPage[] = [];
    const text = "🙂".repeat(8_000);
    const report = await streamWorkbenchBuiltinSource({
      adapterId: "generated",
      adapters: [generatedAdapter(1, text)],
      onPage: (page) => pages.push(page),
      onRecord: () => undefined,
    });
    const segments = pages.flatMap((page) => page.payload.kind === "segments" ? page.payload.segments : []);
    expect(report.coverage.segments).toBe(2);
    expect(segments).toHaveLength(2);
    expect(segments.every((segment) => Buffer.byteLength(segment.text, "utf8") <= 24 * 1024)).toBe(true);
  });

  test("bounds diagnostics while one record root remains within its 8192-page contract", async () => {
    const report = await streamWorkbenchBuiltinSource({ adapterId: "diagnostics", adapters: [diagnosticAdapter(500)], onPage: () => undefined, onRecord: () => undefined });
    expect(report.diagnostics).toMatchObject({ total: 500, truncated: 400 });
    expect(report.diagnostics.items).toHaveLength(100);
    const repeated = await streamWorkbenchBuiltinSource({ adapterId: "diagnostics", adapters: [diagnosticAdapter(500, true)], onPage: () => undefined, onRecord: () => undefined });
    expect(repeated.diagnostics).toEqual({ items: [{ code: "bad", message: "bad" }], total: 500, truncated: 499 });
  });
});

async function run(adapter: AgentTraceAdapter, stored: ReturnType<typeof inMemoryBase>, cursor?: Parameters<typeof streamWorkbenchBuiltinSource>[0]["cursor"], env?: NodeJS.ProcessEnv) {
  return await streamWorkbenchBuiltinSource({ adapterId: adapter.id, adapters: [adapter], env, cursor, base: stored, onPage: (page) => stored.putPage(page), onRecord: (record) => stored.putRecord(record) });
}

function mutableAdapter() {
  const fixture = { revision: 1, previousCheckpoints: [] as unknown[], adapter: undefined as unknown as AgentTraceAdapter };
  fixture.adapter = {
    id: "fixture", displayName: "Fixture",
    async *discoverInputs() { yield { key: "input_1", value: { path: "/stable/session.jsonl" } }; },
    async reduceInput(_ref, previous, sink) {
      fixture.previousCheckpoints.push(previous);
      await sink.putTrace({ id: "logical_record" });
      if (previous === undefined) {
        await sink.putEvent("logical_record", visible("user_1", "Prepare the invoice summary."));
        await sink.putEvent("logical_record", { id: "reasoning", kind: "message", role: "assistant", channel: "reasoning", text: "private" });
        await sink.putEvent("logical_record", { id: "tool", kind: "tool", name: "read_file", input: { path: "invoice.csv" }, output: { rows: 4 } });
        await sink.putEvent("logical_record", { id: "compact", kind: "compaction", summary: "Invoice work remains active." });
      } else if (fixture.revision === 2) await sink.putEvent("logical_record", visible("user_2", "Now draft the approval email."));
      return { checkpoint: { offset: fixture.revision === 2 ? 84 : 42 }, diagnostics: [] };
    },
  };
  return fixture;
}

function incompleteThenCompleteAdapter() {
  const fixture = { complete: false, adapter: undefined as unknown as AgentTraceAdapter };
  fixture.adapter = {
    id: "incomplete", displayName: "Incomplete",
    async *discoverInputs() { yield { key: "input", value: {} }; },
    async reduceInput(_ref, previous, sink) {
      await sink.putTrace({ id: "trace" });
      if (previous === undefined) await sink.putEvent("trace", { id: "tool", kind: "tool", name: "read", incomplete: true });
      else if (fixture.complete) await sink.putEvent("trace", { id: "tool", kind: "tool", name: "read", output: { ok: true } });
      return { checkpoint: { offset: fixture.complete ? 2 : 1 }, diagnostics: [] };
    },
  };
  return fixture;
}

function generatedAdapter(count: number, text: string, complete?: () => void): AgentTraceAdapter {
  return { id: "generated", displayName: "Generated", async *discoverInputs() { yield { key: "input", value: {} }; }, async reduceInput(_ref, _previous, sink) { await sink.putTrace({ id: "trace" }); for (let index = 0; index < count; index += 1) await sink.putEvent("trace", visible(`event_${index}`, text)); complete?.(); return { checkpoint: { count }, diagnostics: [] }; } };
}

function diagnosticAdapter(count: number, repeat = false): AgentTraceAdapter {
  return { id: "diagnostics", displayName: "Diagnostics", async *discoverInputs() { yield { key: "input", value: {} }; }, async reduceInput() { return { checkpoint: {}, diagnostics: Array.from({ length: count }, (_, index) => ({ code: "bad", message: repeat ? "bad" : `bad ${index}` })) }; } };
}

function manyInputsAdapter(count: number): AgentTraceAdapter {
  return {
    id: "many-inputs",
    displayName: "Many inputs",
    async *discoverInputs() {
      for (let index = 0; index < count; index += 1) yield { key: `input_${index.toString().padStart(4, "0")}`, value: { index } };
    },
    async reduceInput(ref, previous, sink) {
      const index = (ref.value as { index: number }).index;
      if (previous === undefined) {
        await sink.putTrace({ id: `trace_${index}` });
        await sink.putEvent(`trace_${index}`, visible(`event_${index}`, `Evidence ${index}`));
      }
      return { checkpoint: { index }, diagnostics: [] };
    },
  };
}

function visible(id: string, text: string) { return { id, kind: "message" as const, role: "user" as const, channel: "visible" as const, text }; }
function jsonLine(value: unknown): string { return `${JSON.stringify(value)}\n`; }

function inMemoryBase(): WorkbenchSourceProducerBase & { lookupSizes: number[]; maximumLookup: number; putPage(page: WorkbenchSourceProducerPage): void; putRecord(record: WorkbenchSourceRecordEntry): void; segments(): WorkbenchSourceEvidenceSegment[] } {
  const records = new Map<string, WorkbenchSourceRecordRef>();
  const pages = new Map<string, WorkbenchSourceRecordPagePayload>();
  return {
    lookupSizes: [],
    maximumLookup: 0,
    async records(ids) { this.lookupSizes.push(ids.length); this.maximumLookup = Math.max(this.maximumLookup, ids.length); return ids.flatMap((id) => records.get(id) ? [records.get(id)!] : []); },
    async page(hash) { return pages.get(hash) ?? null; },
    putPage(page) { pages.set(page.hash, page.payload); },
    putRecord(record) {
      const manifest = pages.get(record.bodyHash);
      if (!manifest || manifest.kind !== "manifest") throw new Error(`Missing manifest ${record.bodyHash}`);
      records.set(record.id, { ...record, segmentCount: manifest.segmentCount, textBytes: manifest.textBytes });
    },
    segments() {
      return [...records.values()].flatMap((record) => {
        const manifest = pages.get(record.bodyHash);
        if (!manifest || manifest.kind !== "manifest") throw new Error(`Missing manifest ${record.bodyHash}`);
        return manifest.segmentPageHashes.flatMap((pageHash) => {
          const page = pages.get(pageHash);
          if (!page || page.kind !== "segments") throw new Error(`Missing segments ${pageHash}`);
          return page.segments;
        });
      });
    },
  };
}

async function installClaudeFixture(): Promise<{ home: string; sessionPath: string }> {
  const home = await temporaryDirectory("workbench-source-claude-upsert-");
  const project = path.join(home, ".claude", "projects", "synthetic");
  const sessionPath = path.join(project, "session-upsert.jsonl");
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(sessionPath, [
    claudeUserRecord("initial", "Synthetic task."),
    claudeAssistantRecord("fragment-1", "First fragment."),
  ].map(jsonLine).join(""));
  await fs.writeFile(path.join(project, "sessions-index.json"), JSON.stringify({
    version: 1,
    entries: [{ sessionId: "session-upsert", fullPath: sessionPath, projectPath: "/sanitized/workspace", isSidechain: false }],
  }));
  return { home, sessionPath };
}

async function installLargeLineCodexFixture() {
  const home = await temporaryDirectory("workbench-source-codex-large-line-");
  const sourcePath = path.join(home, "sessions", "large-line.jsonl");
  await fs.mkdir(path.dirname(sourcePath), { recursive: true });
  const targetLineBytes = 9_638_455;
  const largeRecord = (text: string) => jsonLine({
    timestamp: "2026-07-15T00:00:01.000Z",
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  });
  const giantText = "x".repeat(targetLineBytes - Buffer.byteLength(largeRecord(""), "utf8"));
  const giantLine = largeRecord(giantText);
  const duplicateText = "One semantic event emitted through two native Codex shapes.";
  const prefix = [
    { type: "session_meta", payload: { id: "large-record-a", cwd: "/tmp/source-a" } },
    { type: "event_msg", payload: { type: "task_started", turn_id: "turn-a" } },
  ].map(jsonLine).join("");
  const suffix = [
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: duplicateText }] } },
    { type: "event_msg", payload: { type: "user_message", message: duplicateText } },
    { type: "response_item", payload: { type: "function_call", call_id: "call-a", name: "read_file", arguments: "{\"path\":\"input.txt\"}" } },
    { type: "response_item", payload: { type: "function_call_output", call_id: "call-a", output: "{\"ok\":true}" } },
    { type: "session_meta", payload: { id: "large-record-b", cwd: "/tmp/source-b" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Second logical task." }] } },
  ].map(jsonLine).join("");
  await fs.writeFile(sourcePath, prefix + giantLine + suffix, "utf8");
  const giantEvidence = `User\n${giantText}`;
  return {
    home,
    lineBytes: Buffer.byteLength(giantLine, "utf8"),
    giantEvidenceBytes: Buffer.byteLength(giantEvidence, "utf8"),
    giantEvidenceHash: createHash("sha256").update(giantEvidence).digest("hex"),
    duplicateText,
  };
}

function claudeUserRecord(uuid: string, text: string): unknown {
  return { parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content: text }, uuid, timestamp: "2026-07-15T00:00:00.000Z", cwd: "/sanitized/workspace", sessionId: "session-upsert" };
}

function claudeAssistantRecord(uuid: string, text: string): unknown {
  return { parentUuid: "initial", isSidechain: false, type: "assistant", message: { id: "message-upsert", role: "assistant", content: [{ type: "text", text }] }, requestId: "request-upsert", uuid, timestamp: "2026-07-15T00:00:01.000Z", cwd: "/sanitized/workspace", sessionId: "session-upsert" };
}

async function stagingDirectories(): Promise<string[]> {
  return (await fs.readdir(os.tmpdir())).filter((entry) => entry.startsWith("workbench-source-input-")).sort();
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}
