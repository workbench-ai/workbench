import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, test } from "vitest";

import {
  appendWorkbenchTraceSpoolEvent,
  compactWorkbenchTraceSpool,
  createWorkbenchTraceRecord,
  writeWorkbenchTraceRecord,
  workbenchTraceSpoolPath,
} from "../src/trace-runtime.ts";
import {
  createNewWorkbenchSkillProject,
  createWorkbenchReadOnlyInspectionSnapshot,
} from "../src/index.ts";

const tempRoots: string[] = [];

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  ));
});

describe("trace runtime spool", () => {
  test("project trace records are exposed through the generic inspection snapshot", async () => {
    const root = await makeTempRoot("workbench-trace-runtime-project-");
    const homeDir = await makeTempRoot("workbench-trace-runtime-project-home-");
    await createNewWorkbenchSkillProject({ dir: root, agent: "local", homeDir });
    await writeWorkbenchTraceRecord(createWorkbenchTraceRecord({
      id: "tr_project_overlay",
      origin: "live",
      source: { host: "codex", sessionId: "session", turnId: "turn" },
      subjects: [{ type: "skill", id: "workbench", confidence: "exact" }],
      input: { prompt: "$workbench Capture this." },
      output: { assistantText: "Captured." },
      createdAt: "2026-06-28T00:00:00.000Z",
    }), { homeDir, projectRoot: root });

    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root, homeDir });

    expect(snapshot.traces.map((trace) => trace.id)).toContain("tr_project_overlay");
    expect(snapshot.traces.find((trace) => trace.id === "tr_project_overlay")?.input?.prompt)
      .toBe("$workbench Capture this.");
  });

  test("compaction does not create a lock when the spool is absent", async () => {
    const homeDir = await makeTempRoot("workbench-trace-runtime-empty-home-");
    const spoolPath = workbenchTraceSpoolPath({ homeDir });
    const lockPath = `${spoolPath}.lock`;

    await expect(compactWorkbenchTraceSpool({ homeDir })).resolves.toMatchObject({ read: 0, written: 0 });
    await expect(fs.access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("append waits for the canonical spool lock before writing", async () => {
    const homeDir = await makeTempRoot("workbench-trace-runtime-lock-home-");
    const spoolPath = workbenchTraceSpoolPath({ homeDir });
    const lockPath = `${spoolPath}.lock`;
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, "manual lock\n", "utf8");
    let settled = false;

    const append = appendWorkbenchTraceSpoolEvent({
      kind: "prompt",
      source: { host: "codex", sessionId: "session", turnId: "turn" },
      input: { prompt: "$workbench Locked append." },
    }, { homeDir }).then(() => {
      settled = true;
    });

    await delay(50);
    expect(settled).toBe(false);
    await fs.rm(lockPath, { force: true });
    await append;

    expect(await fs.readFile(spoolPath, "utf8")).toContain("$workbench Locked append.");
  });

  test("compaction waits for the same spool lock before moving events", async () => {
    const homeDir = await makeTempRoot("workbench-trace-runtime-compact-home-");
    const spoolPath = workbenchTraceSpoolPath({ homeDir });
    await appendWorkbenchTraceSpoolEvent({
      kind: "prompt",
      source: { host: "codex", sessionId: "session", turnId: "turn" },
      input: { prompt: "$workbench Locked compact." },
    }, { homeDir });
    const lockPath = `${spoolPath}.lock`;
    await fs.writeFile(lockPath, "manual lock\n", "utf8");
    let settled = false;

    const compact = compactWorkbenchTraceSpool({ homeDir }).then((stats) => {
      settled = true;
      return stats;
    });

    await delay(50);
    expect(settled).toBe(false);
    expect(await fs.readFile(spoolPath, "utf8")).toContain("$workbench Locked compact.");
    await fs.rm(lockPath, { force: true });

    await expect(compact).resolves.toMatchObject({ read: 1, written: 1 });
    await expect(fs.readFile(spoolPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
