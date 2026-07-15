import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { WorkbenchTrace } from "@workbench-ai/workbench-contract";

import {
  listWorkbenchTraceRecords,
  writeWorkbenchTraceRecord,
} from "../src/trace-runtime.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("terminal Workbench trace storage", () => {
  test("writes and lists exact trace records", async () => {
    const projectRoot = await tempRoot();
    const trace = traceFixture({
      id: "trace-one",
      skillName: "reports",
      files: [{ path: "result.txt", content: "done" }],
    });
    await writeWorkbenchTraceRecord(trace, { projectRoot });

    expect(await listWorkbenchTraceRecords({ projectRoot })).toEqual([trace]);
    const files = await recursiveFiles(path.join(projectRoot, ".workbench", "traces"));
    expect(files.map((file) => path.basename(file))).toEqual(["trace.json"]);
  });

  test("keeps provider session metadata", async () => {
    const projectRoot = await tempRoot();
    const trace = traceFixture({
      source: { adapterId: "codex", sessionId: "provider-session" },
    });
    await writeWorkbenchTraceRecord(trace, { projectRoot });
    const [stored] = await listWorkbenchTraceRecords({ projectRoot });
    expect(stored?.source?.sessionId).toBe("provider-session");
  });
});

function traceFixture(overrides: Partial<WorkbenchTrace> = {}): WorkbenchTrace {
  return {
    id: "trace-one",
    runId: "run-one",
    versionId: "version-one",
    skillName: "skill-one",
    skillBundleHash: "bundle-one",
    agentName: "agent-one",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    request: {},
    result: {},
    files: [],
    status: "completed",
    ...overrides,
  };
}

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-trace-runtime-"));
  roots.push(root);
  return root;
}

async function recursiveFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(target);
      } else {
        files.push(target);
      }
    }
  };
  await walk(root);
  return files;
}
