import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, test } from "vitest";

import type { WorkbenchRun } from "@workbench-ai/workbench-contract";

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
  createWorkbenchRunSnapshotForRun,
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

  test("live traces project into runs when the workspace root is a realpath alias", async () => {
    const root = await makeTempRoot("workbench-trace-runtime-realpath-project-");
    const alias = `${root}-alias`;
    tempRoots.push(alias);
    const homeDir = await makeTempRoot("workbench-trace-runtime-realpath-home-");
    await fs.symlink(root, alias, "dir");
    await createNewWorkbenchSkillProject({ dir: root, agent: "local", homeDir });
    await writeWorkbenchTraceRecord(createWorkbenchTraceRecord({
      id: "tr_realpath_live",
      origin: "live",
      runId: "session-realpath",
      source: { host: "claude", sessionId: "session-realpath", turnId: "turn", workspaceRoot: alias },
      subjects: [{ type: "skill", id: "workbench-realpath", confidence: "exact", activation: "explicit-invocation" }],
      input: { prompt: "$workbench-realpath Capture this." },
      output: { assistantText: "Captured." },
      status: { capture: "captured", execution: "completed", review: "unreviewed" },
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:01.000Z",
    }), { homeDir });

    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root, homeDir });
    const liveRun = snapshot.runs.find((run) => run.id === "session-realpath");
    const liveJob = snapshot.jobs.find((job) => job.runId === "session-realpath");

    expect(liveRun).toMatchObject({
      id: "session-realpath",
      kind: "live",
      status: "succeeded",
      traceIds: ["tr_realpath_live"],
    });
    expect(liveJob).toMatchObject({
      role: "agent-session",
      status: "succeeded",
      traceIds: ["tr_realpath_live"],
    });
    if (!liveRun || !liveJob) {
      throw new Error("Expected projected live run and job.");
    }
    const runSnapshot = createWorkbenchRunSnapshotForRun(liveRun, [liveJob], { traces: snapshot.traces });
    expect(runSnapshot.kind).toBe("live");
    expect(runSnapshot.plan.kind).toBe("live");
    expect(runSnapshot.plan.phases).toBeUndefined();
    expect(runSnapshot.measurements).toEqual([]);
    expect(runSnapshot.cliEquivalent).toBe("workbench show session-realpath");
    expect(runSnapshot.next).toBeUndefined();
  });

  test("live traces with unknown lifecycle status remain active", async () => {
    const root = await makeTempRoot("workbench-trace-runtime-unknown-live-project-");
    const homeDir = await makeTempRoot("workbench-trace-runtime-unknown-live-home-");
    await createNewWorkbenchSkillProject({ dir: root, agent: "local", homeDir });
    await writeWorkbenchTraceRecord(createWorkbenchTraceRecord({
      id: "tr_unknown_live",
      origin: "live",
      runId: "session-unknown",
      source: { host: "codex", sessionId: "session-unknown", turnId: "turn", workspaceRoot: root },
      subjects: [{ type: "skill", id: "workbench-unknown", confidence: "exact", activation: "explicit-invocation" }],
      input: { prompt: "$workbench-unknown Capture this." },
      status: { capture: "captured", execution: "unknown", review: "unreviewed" },
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:01.000Z",
    }), { homeDir });

    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root, homeDir });
    const liveRun = snapshot.runs.find((run) => run.id === "session-unknown");
    const liveJob = snapshot.jobs.find((job) => job.runId === "session-unknown");

    expect(liveRun).toMatchObject({
      id: "session-unknown",
      kind: "live",
      status: "running",
      traceIds: ["tr_unknown_live"],
    });
    expect(liveJob).toMatchObject({
      role: "agent-session",
      status: "running",
      traceIds: ["tr_unknown_live"],
    });
    expect(liveRun?.finishedAt).toBeUndefined();
    expect(liveJob?.finishedAt).toBeUndefined();
    if (!liveRun || !liveJob) {
      throw new Error("Expected projected active live run and job.");
    }
    const runSnapshot = createWorkbenchRunSnapshotForRun(liveRun, [liveJob], { traces: snapshot.traces });
    expect(runSnapshot.next).toBe("workbench watch session-unknown");
  });

  test("persisted live run operation plans load through inspection", async () => {
    const root = await makeTempRoot("workbench-trace-runtime-live-plan-project-");
    const homeDir = await makeTempRoot("workbench-trace-runtime-live-plan-home-");
    await createNewWorkbenchSkillProject({ dir: root, agent: "local", homeDir });
    const run: WorkbenchRun = {
      id: "run_live_plan",
      kind: "live",
      versionId: "v_live",
      skillName: "current",
      skillBundleHash: "bundle_live",
      evalHash: "live",
      agentName: "claude",
      agentHash: "agent_live",
      status: "succeeded",
      operationPlan: {
        kind: "live",
        variant: "local",
        versionId: "v_live",
        evalHash: "live",
        skills: ["current"],
        agents: ["claude"],
        samples: 1,
      },
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-28T00:00:00.000Z",
      finishedAt: "2026-06-28T00:00:01.000Z",
      location: "local",
    };
    const runObjectDir = path.join(root, ".workbench", "objects", "run");
    await fs.mkdir(runObjectDir, { recursive: true });
    await fs.writeFile(path.join(runObjectDir, `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`, "utf8");

    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root, homeDir });
    const loadedRun = snapshot.runs.find((entry) => entry.id === run.id);

    expect(loadedRun).toMatchObject({
      id: run.id,
      kind: "live",
      operationPlan: { kind: "live" },
    });
    if (!loadedRun) {
      throw new Error("Expected persisted live run to load.");
    }
    const runSnapshot = createWorkbenchRunSnapshotForRun(loadedRun, [], { traces: snapshot.traces });
    expect(runSnapshot.kind).toBe("live");
    expect(runSnapshot.plan).toMatchObject({
      kind: "live",
      agents: ["claude"],
      samples: 1,
    });
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
