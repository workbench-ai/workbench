import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  addWorkbenchRemote,
  clearWorkbenchPendingCloudOperation,
  createWorkbenchReadOnlyInspectionSnapshot,
  createNewWorkbenchSkillProject,
  reconcileCurrentWorkbenchVersion,
  readWorkbenchPendingCloudOperation,
  recordWorkbenchPendingCloudOperation,
  resolveWorkbenchRunRetryRequest,
  syncWorkbenchRemote,
  switchWorkbenchVersion,
  WorkbenchCodedError,
  type WorkbenchObjectPack,
  type WorkbenchRun,
} from "../src/index.ts";

const tempRoots: string[] = [];

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function exists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then(() => true, () => false);
}

async function durableVersionFor(root: string) {
  return reconcileCurrentWorkbenchVersion({ dir: root });
}

function syncStateFile(root: string, remoteName: string): string {
  return path.join(root, ".workbench", "sync", `${remoteName}.json`);
}

async function readSyncState(root: string, remoteName: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(syncStateFile(root, remoteName), "utf8")) as Record<string, unknown>;
}

async function codedErrorFrom(promise: Promise<unknown>): Promise<WorkbenchCodedError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WorkbenchCodedError);
    return error as WorkbenchCodedError;
  }
  throw new Error("Expected promise to reject with a WorkbenchCodedError");
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })
  ));
});

describe("remote state lifecycle", () => {
  test("pending Cloud operations remain outside durable run state", async () => {
    const root = await makeTempRoot("workbench-pending-cloud-operation-");
    await createNewWorkbenchSkillProject({ dir: root });
    const operation = {
      schema: "workbench.pending-cloud-operation.v1" as const,
      id: "run_cloud_handle",
      command: "eval" as const,
      remoteName: "cloud",
      createdAt: "2026-06-16T00:00:00.000Z",
    };

    await recordWorkbenchPendingCloudOperation({ dir: root, operation });

    const live = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
    expect(live.runs.map((entry) => entry.id)).not.toContain(operation.id);
    expect(await readWorkbenchPendingCloudOperation({ dir: root, operationId: operation.id })).toEqual(operation);
    expect(await exists(path.join(root, ".workbench", "objects", "run", `${operation.id}.json`))).toBe(false);

    await clearWorkbenchPendingCloudOperation({ dir: root, operationId: operation.id });

    expect(await readWorkbenchPendingCloudOperation({ dir: root, operationId: operation.id })).toBeNull();
  });

  test("add is idempotent, conflicts are coded, and replace clears prior sync state", async () => {
    const root = await makeTempRoot("workbench-remote-add-");
    const remoteA = await makeTempRoot("workbench-remote-add-a-");
    const remoteB = await makeTempRoot("workbench-remote-add-b-");
    await createNewWorkbenchSkillProject({ dir: root });

    const added = await addWorkbenchRemote("origin", pathToFileURL(remoteA).toString(), { dir: root });
    expect(added.operation).toBe("added");

    const unchanged = await addWorkbenchRemote("origin", pathToFileURL(remoteA).toString(), { dir: root });
    expect(unchanged.operation).toBe("unchanged");

    const conflict = await codedErrorFrom(
      addWorkbenchRemote("origin", pathToFileURL(remoteB).toString(), { dir: root })
    );
    expect(conflict.code).toBe("remote_name_conflict");

    await syncWorkbenchRemote({ dir: root });
    const beforeReplace = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
    expect(beforeReplace.remotes).toContainEqual(expect.objectContaining({ name: "origin", url: pathToFileURL(remoteA).toString() }));
    expect(await exists(syncStateFile(root, "origin"))).toBe(true);
    const recordBefore = await readSyncState(root, "origin");
    expect(recordBefore.url).toContain(path.basename(remoteA));

    const dryRun = await addWorkbenchRemote("origin", pathToFileURL(remoteB).toString(), {
      dir: root,
      replace: true,
      dryRun: true,
    });
    expect(dryRun).toMatchObject({ operation: "replaced", dryRun: true });
    expect((await readSyncState(root, "origin")).url).toContain(path.basename(remoteA));

    const replaced = await addWorkbenchRemote("origin", pathToFileURL(remoteB).toString(), {
      dir: root,
      replace: true,
    });
    expect(replaced.operation).toBe("replaced");
    const afterReplace = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
    expect(Object.keys(afterReplace.refs).filter((name) => name.startsWith("remotes/origin/"))).toEqual([]);
    if (await exists(syncStateFile(root, "origin"))) {
      // Auto-sync after replace may write a fresh record, but never for the old URL.
      expect((await readSyncState(root, "origin")).url).toContain(path.basename(remoteB));
    }
  });


  test("sync writes a complete success record", async () => {
    const root = await makeTempRoot("workbench-sync-success-");
    const remote = await makeTempRoot("workbench-sync-success-remote-");
    await createNewWorkbenchSkillProject({ dir: root });
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: root });
    await syncWorkbenchRemote({ dir: root });

    const record = await readSyncState(root, "origin");
    expect(record.schema).toBe("workbench.remote-sync-state.v1");
    expect(record.remote).toBe("origin");
    expect(record.status).toBe("synced");
    expect(record.lastError).toBeNull();
    expect(typeof record.localHash).toBe("string");
    expect(typeof record.lastSyncedAt).toBe("string");
    expect(typeof record.lastAttemptAt).toBe("string");

  });

  test("sync detects local changes and returns to a no-op after reconciling", async () => {
    const root = await makeTempRoot("workbench-sync-local-changes-");
    const remote = await makeTempRoot("workbench-sync-local-changes-remote-");
    await createNewWorkbenchSkillProject({ dir: root });
    await durableVersionFor(root);
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: root });
    await syncWorkbenchRemote({ dir: root });

    await fs.appendFile(path.join(root, "SKILL.md"), "\nUnsynced local edit.\n");
    await durableVersionFor(root);

    const dryRun = await syncWorkbenchRemote({ dir: root, dryRun: true });
    expect(dryRun.pushed).toBeGreaterThan(0);

    await syncWorkbenchRemote({ dir: root });
    expect(await syncWorkbenchRemote({ dir: root, dryRun: true })).toMatchObject({ pushed: 0, pulled: 0, upToDate: true });
  });

  test("switching between already synced versions does not dirty remote sync", async () => {
    const root = await makeTempRoot("workbench-sync-switch-clean-");
    const remote = await makeTempRoot("workbench-sync-switch-clean-remote-");
    await createNewWorkbenchSkillProject({ dir: root });
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: root });
    const firstVersionId = (await durableVersionFor(root)).id;
    await syncWorkbenchRemote({ dir: root });
    expect(firstVersionId).toBeTruthy();

    await fs.appendFile(path.join(root, "SKILL.md"), "\nSecond synced version.\n");
    const secondVersionId = (await durableVersionFor(root)).id;
    await syncWorkbenchRemote({ dir: root });
    expect(secondVersionId).toBeTruthy();
    expect(secondVersionId).not.toBe(firstVersionId);

    await switchWorkbenchVersion(firstVersionId!, { dir: root });
    await switchWorkbenchVersion(secondVersionId!, { dir: root });

    const dryRun = await syncWorkbenchRemote({ dir: root, dryRun: true });
    expect(dryRun.pushed).toBe(0);
    expect(dryRun.pulled).toBe(0);
    expect(dryRun.upToDate).toBe(true);
  });

  test("sync failure writes a coded error record", async () => {
    const root = await makeTempRoot("workbench-sync-failure-");
    const remoteParent = await makeTempRoot("workbench-sync-failure-remote-");
    const remotePath = path.join(remoteParent, "not-a-directory");
    await fs.writeFile(remotePath, "plain file\n");
    await createNewWorkbenchSkillProject({ dir: root });
    await addWorkbenchRemote("origin", pathToFileURL(remotePath).toString(), { dir: root });

    await expect(syncWorkbenchRemote({ dir: root })).rejects.toThrow(/not a directory/u);

    const record = await readSyncState(root, "origin");
    expect(record.status).toBe("error");
    expect(record.lastError).toMatchObject({ code: "sync_failed" });
    expect((record.lastError as { message: string }).message).toMatch(/not a directory/u);

  });

  test("aborted cloud sync preserves previous sync health", async () => {
    const root = await makeTempRoot("workbench-sync-abort-preserves-health-");
    await createNewWorkbenchSkillProject({ dir: root });
    const createdAt = "2026-06-17T00:00:00.000Z";
    let remotePack = emptyPack(createdAt);
    let blockObjectRead = false;
    let objectReadStarted = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/api/workbench/skills") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "sync-abort" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && (init?.method ?? "GET") === "GET") {
        if (blockObjectRead) {
          objectReadStarted = true;
          await new Promise<void>((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("The operation was aborted.");
              error.name = "AbortError";
              reject(error);
            }, { once: true });
          });
        }
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { objectPack?: WorkbenchObjectPack };
        remotePack = mergeObjectPacks(remotePack, body.objectPack ?? emptyPack(createdAt));
        return jsonResponse({ skill: { id: "skill_cloud" }, objectPack: remotePack });
      }
      return jsonResponse({ message: `Unexpected ${init?.method ?? "GET"} ${url.pathname}` }, 404);
    }));

    await addWorkbenchRemote("cloud", "https://cloud.test/skills/alice/sync-abort", {
      dir: root,
      authToken: "token",
    });
    await syncWorkbenchRemote({ dir: root, authToken: "token" });
    const syncedRecord = await readSyncState(root, "cloud");

    blockObjectRead = true;
    const controller = new AbortController();
    const aborted = syncWorkbenchRemote({ dir: root, authToken: "token", signal: controller.signal });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (objectReadStarted) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(objectReadStarted).toBe(true);
    controller.abort();
    await expect(aborted).rejects.toThrow(/aborted/u);

    expect(await readSyncState(root, "cloud")).toEqual(syncedRecord);
  });

  test("invalid remote names are rejected with remote_invalid_name", async () => {
    const root = await makeTempRoot("workbench-remote-name-");
    await createNewWorkbenchSkillProject({ dir: root });
    const error = await codedErrorFrom(
      addWorkbenchRemote("Bad Name", "file:///tmp/workbench-remote", { dir: root })
    );
    expect(error.code).toBe("remote_invalid_name");
  });

  test("http remotes allow IPv6 loopback for local Cloud testing", async () => {
    const root = await makeTempRoot("workbench-remote-ipv6-loopback-");
    await createNewWorkbenchSkillProject({ dir: root });

    const added = await addWorkbenchRemote(
      "local",
      "http://[::1]:3000/skills/alice/local-skill",
      { dir: root, dryRun: true },
    );

    expect(added).toMatchObject({
      operation: "added",
      dryRun: true,
      remote: {
        name: "local",
        kind: "workbench-cloud",
        url: "http://[::1]:3000/skills/alice/local-skill",
      },
    });
  });

  test("cloud sync does not push lifecycle objects already owned by the remote", async () => {
    const root = await makeTempRoot("workbench-cloud-lifecycle-owner-");
    await createNewWorkbenchSkillProject({ dir: root });
    const versionId = (await durableVersionFor(root)).id;

    const createdAt = "2026-06-12T23:00:00.000Z";
    const localCloudRun = fakeRun("run_cloud_owned", versionId, "queued", createdAt);
    const localOnlyRun = fakeRun("run_local_only", versionId, "failed", createdAt);
    await writeWorkbenchObject(root, "run", localCloudRun.id, localCloudRun);
    await writeWorkbenchObject(root, "run", localOnlyRun.id, localOnlyRun);
    await writeWorkbenchObject(root, "execution-event", "evt_local_progress", {
      jobId: "job_cloud",
      executionId: "exec_cloud",
      emittedAt: createdAt,
      seqStart: 1,
      runId: localCloudRun.id,
      projectId: "skill_cloud",
      attempt: 1,
      seqEnd: 1,
      events: [{
        schema: "workbench.execution.step.v1",
        at: createdAt,
        source: "command",
        role: "runner",
        payload: { step: "command.run", status: "started" },
        seq: 1,
      }],
    });

    const remotePack = {
      ...emptyPack(createdAt),
      runs: [{
        ...localCloudRun,
        status: "running",
        jobIds: ["job_cloud"],
        traceIds: ["trace_cloud"],
      }],
    } satisfies WorkbenchObjectPack;
    const putPacks: WorkbenchObjectPack[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/api/workbench/skills") {
        expect(url.searchParams.get("owner")).toBe("alice");
        expect(url.searchParams.get("name")).toBe("smoke");
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "smoke" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { objectPack: WorkbenchObjectPack };
        putPacks.push(body.objectPack);
        return jsonResponse({ skill: { id: "skill_cloud" }, objectPack: remotePack });
      }
      return jsonResponse({ message: `Unexpected ${init?.method ?? "GET"} ${url.pathname}` }, 404);
    }));

    await addWorkbenchRemote("cloud", "https://cloud.test/skills/alice/smoke", {
      dir: root,
      authToken: "token",
    });
    await syncWorkbenchRemote({ dir: root, authToken: "token" });

    expect(putPacks.length).toBeGreaterThan(0);
    const pushedRuns = putPacks.flatMap((pack) => pack.runs.map((run) => run.id));
    expect(pushedRuns).toContain("run_local_only");
    expect(pushedRuns).not.toContain("run_cloud_owned");
    expect(putPacks.flatMap((pack) => pack.executionEvents)).toEqual([]);

    const after = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
    expect(after.runs.find((run) => run.id === "run_cloud_owned")).toMatchObject({
      status: "running",
      jobIds: ["job_cloud"],
      traceIds: ["trace_cloud"],
    });
  });

  test("cloud-owned lifecycle snapshots do not dirty sync", async () => {
    const root = await makeTempRoot("workbench-cloud-lifecycle-clean-status-");
    await createNewWorkbenchSkillProject({ dir: root });
    const versionId = (await durableVersionFor(root)).id;
    expect(versionId).toBeTruthy();

    const createdAt = "2026-06-17T00:00:00.000Z";
    let remotePack = emptyPack(createdAt);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/api/workbench/skills") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "clean-status" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { objectPack?: WorkbenchObjectPack };
        remotePack = mergeObjectPacks(remotePack, body.objectPack ?? emptyPack(createdAt));
        return jsonResponse({ skill: { id: "skill_cloud" }, objectPack: remotePack });
      }
      return jsonResponse({ message: `Unexpected ${init?.method ?? "GET"} ${url.pathname}` }, 404);
    }));

    await addWorkbenchRemote("cloud", "https://cloud.test/skills/alice/clean-status", {
      dir: root,
      authToken: "token",
    });
    await syncWorkbenchRemote({ dir: root, authToken: "token" });

    const cloudRun = {
      ...fakeRun("run_cloud_owned_status", versionId!, "succeeded", createdAt),
      location: "cloud" as const,
      remoteName: "cloud",
    };
    await writeWorkbenchObject(root, "run", cloudRun.id, cloudRun);
    const cloudLifecycleDryRun = await syncWorkbenchRemote({ dir: root, authToken: "token", dryRun: true });
    expect(cloudLifecycleDryRun).toMatchObject({
      pushed: 0,
      pulled: 0,
      upToDate: true,
      dryRun: true,
    });

    remotePack = {
      ...remotePack,
      runs: [{
        ...fakeRun("run_cloud_imported_status", versionId!, "succeeded", createdAt),
        location: "cloud" as const,
      }],
    };
    await syncWorkbenchRemote({ dir: root, authToken: "token" });
    const afterImported = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
    expect(afterImported.runs.find((run) => run.id === "run_cloud_imported_status")).toMatchObject({
      location: "cloud",
      remoteName: "cloud",
    });
    expect(await syncWorkbenchRemote({ dir: root, authToken: "token", dryRun: true })).toMatchObject({ pushed: 0, pulled: 0, upToDate: true });

    const localRun = fakeRun("run_local_unsynced_status", versionId!, "succeeded", createdAt);
    await writeWorkbenchObject(root, "run", localRun.id, localRun);
    expect((await syncWorkbenchRemote({ dir: root, authToken: "token", dryRun: true })).pushed).toBeGreaterThan(0);
  });

  test("cloud sync preserves local run location when portable evidence round-trips through Cloud", async () => {
    const root = await makeTempRoot("workbench-cloud-preserve-local-run-");
    await createNewWorkbenchSkillProject({ dir: root });
    const versionId = (await durableVersionFor(root)).id;
    expect(versionId).toBeTruthy();

    const createdAt = "2026-06-19T00:00:00.000Z";
    let remotePack = emptyPack(createdAt);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/api/workbench/skills") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "roundtrip" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { objectPack?: WorkbenchObjectPack };
        remotePack = mergeObjectPacks(remotePack, body.objectPack ?? emptyPack(createdAt));
        return jsonResponse({ skill: { id: "skill_cloud" }, objectPack: remotePack });
      }
      return jsonResponse({ message: `Unexpected ${init?.method ?? "GET"} ${url.pathname}` }, 404);
    }));

    const localRun: WorkbenchRun = {
      ...fakeRun("run_local_roundtrip", versionId!, "succeeded", createdAt),
      requestedSamples: 1,
      operationPlan: {
        kind: "eval",
        variant: "local",
        versionId: versionId!,
        evalHash: "eval_hash",
        skills: ["current"],
        agents: ["default"],
        samples: 1,
      },
    };
    await writeWorkbenchObject(root, "run", localRun.id, localRun);
    await addWorkbenchRemote("cloud", "https://cloud.test/skills/alice/roundtrip", {
      dir: root,
      authToken: "token",
    });

    await syncWorkbenchRemote({ dir: root, authToken: "token" });
    await syncWorkbenchRemote({ dir: root, authToken: "token" });

    const after = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
    expect(after.runs.find((run) => run.id === localRun.id)).toMatchObject({
      location: "local",
      operationPlan: expect.objectContaining({ variant: "local" }),
    });
    expect(after.runs.find((run) => run.id === localRun.id)).not.toHaveProperty("remoteName");
  });

  test("retry trusts the stored operation plan when stale location metadata disagrees", async () => {
    const root = await makeTempRoot("workbench-cloud-retry-plan-location-");
    await createNewWorkbenchSkillProject({ dir: root });
    const versionId = (await durableVersionFor(root)).id;
    expect(versionId).toBeTruthy();

    const run: WorkbenchRun = {
      ...fakeRun("run_retry_mismatched_location", versionId!, "succeeded", "2026-06-19T00:00:00.000Z"),
      location: "cloud",
      remoteName: "cloud",
      requestedSamples: 1,
      operationPlan: {
        kind: "eval",
        variant: "local",
        versionId: versionId!,
        evalHash: "eval_hash",
        skills: ["current"],
        agents: ["default"],
        steps: ["run", "grade"],
        samples: 1,
      },
    };
    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });

    expect(resolveWorkbenchRunRetryRequest(snapshot, run)).toMatchObject({
      kind: "eval",
      variant: "local",
      evalHash: "eval_hash",
      targets: [{ skill: "current", versionId, agent: "default" }],
      retryOfRunId: run.id,
    });
  });
});

function fakeRun(
  id: string,
  versionId: string,
  status: WorkbenchRun["status"],
  createdAt: string,
): WorkbenchRun {
  return {
    id,
    kind: "eval",
    versionId,
    skillName: "current",
    skillBundleHash: "skill_hash",
    evalHash: "eval_hash",
    agentName: "default",
    agentHash: "agent_hash",
    status,
    jobIds: [],
    traceIds: [],
    createdAt,
  };
}

function emptyPack(createdAt: string): WorkbenchObjectPack {
  return {
    schema: "workbench.object-pack.v1",
    createdAt,
    refs: {},
    versions: [],
    skillSources: [],
    skillBundles: [],
    evals: [],
    agents: [],
    runs: [],
    jobs: [],
    traces: [],
    executionEvents: [],
    artifacts: [],
    lineage: [],
  };
}

function mergeObjectPacks(left: WorkbenchObjectPack, right: WorkbenchObjectPack): WorkbenchObjectPack {
  return {
    ...left,
    refs: { ...left.refs, ...right.refs },
    versions: mergeBy(left.versions, right.versions, (entry) => entry.id),
    skillSources: mergeBy(left.skillSources, right.skillSources, (entry) => entry.name),
    skillBundles: mergeBy(left.skillBundles, right.skillBundles, (entry) => entry.hash),
    evals: mergeBy(left.evals, right.evals, (entry) => entry.hash),
    agents: [...left.agents, ...right.agents],
    runs: mergeBy(left.runs, right.runs, (entry) => entry.id),
    jobs: mergeBy(left.jobs, right.jobs, (entry) => entry.id),
    traces: mergeBy(left.traces, right.traces, (entry) => entry.id),
    executionEvents: [...left.executionEvents, ...right.executionEvents],
    artifacts: mergeBy(left.artifacts, right.artifacts, (entry) => entry.id),
    lineage: [...left.lineage, ...right.lineage],
  };
}

function mergeBy<T>(left: readonly T[], right: readonly T[], key: (entry: T) => string): T[] {
  const merged = new Map(left.map((entry) => [key(entry), entry]));
  for (const entry of right) {
    merged.set(key(entry), entry);
  }
  return [...merged.values()];
}

async function writeWorkbenchObject(root: string, type: string, id: string, value: unknown): Promise<void> {
  const dir = path.join(root, ".workbench", "objects", type);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
