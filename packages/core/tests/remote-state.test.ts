import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import {
  addWorkbenchRemote,
  createWorkbenchInspectionSnapshot,
  initWorkbenchSkill,
  listWorkbenchRemotes,
  publishWorkbenchVersion,
  removeWorkbenchRemote,
  syncWorkbenchRemote,
  WorkbenchCodedError,
  workbenchStatusSnapshot,
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
  await Promise.all(tempRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })
  ));
});

describe("remote state lifecycle", () => {
  test("add is idempotent, conflicts are coded, and replace clears prior sync state", async () => {
    const root = await makeTempRoot("workbench-remote-add-");
    const remoteA = await makeTempRoot("workbench-remote-add-a-");
    const remoteB = await makeTempRoot("workbench-remote-add-b-");
    await initWorkbenchSkill({ dir: root });

    const added = await addWorkbenchRemote("origin", pathToFileURL(remoteA).toString(), { dir: root });
    expect(added.operation).toBe("added");

    const unchanged = await addWorkbenchRemote("origin", pathToFileURL(remoteA).toString(), { dir: root });
    expect(unchanged.operation).toBe("unchanged");

    const conflict = await codedErrorFrom(
      addWorkbenchRemote("origin", pathToFileURL(remoteB).toString(), { dir: root })
    );
    expect(conflict.code).toBe("remote_name_conflict");

    await syncWorkbenchRemote({ dir: root });
    const beforeReplace = await createWorkbenchInspectionSnapshot({ dir: root });
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
    const afterReplace = await createWorkbenchInspectionSnapshot({ dir: root });
    expect(Object.keys(afterReplace.refs).filter((name) => name.startsWith("remotes/origin/"))).toEqual([]);
    if (await exists(syncStateFile(root, "origin"))) {
      // Auto-sync after replace may write a fresh record, but never for the old URL.
      expect((await readSyncState(root, "origin")).url).toContain(path.basename(remoteB));
    }
  });

  test("remove deletes the remote and its sync record", async () => {
    const root = await makeTempRoot("workbench-remote-remove-");
    const remote = await makeTempRoot("workbench-remote-remove-remote-");
    await initWorkbenchSkill({ dir: root });
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: root });
    await syncWorkbenchRemote({ dir: root });
    expect(await exists(syncStateFile(root, "origin"))).toBe(true);
    const before = await createWorkbenchInspectionSnapshot({ dir: root });
    expect(before.remotes).toContainEqual(expect.objectContaining({ name: "origin" }));

    const removed = await removeWorkbenchRemote("origin", { dir: root });
    expect(removed).toEqual({ remote: "origin", removed: true });
    expect(await exists(syncStateFile(root, "origin"))).toBe(false);
    const after = await createWorkbenchInspectionSnapshot({ dir: root });
    expect(Object.keys(after.refs).some((name) => name.startsWith("remotes/origin/"))).toBe(false);
    expect(await listWorkbenchRemotes({ dir: root })).toEqual([]);

    const again = await removeWorkbenchRemote("origin", { dir: root });
    expect(again.removed).toBe(false);
  });

  test("sync writes a success record and status reports the remote up to date", async () => {
    const root = await makeTempRoot("workbench-sync-success-");
    const remote = await makeTempRoot("workbench-sync-success-remote-");
    await initWorkbenchSkill({ dir: root });
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: root });
    await syncWorkbenchRemote({ dir: root });

    const record = await readSyncState(root, "origin");
    expect(record.schema).toBe("workbench.remote-sync-state.v1");
    expect(record.remote).toBe("origin");
    expect(record.status).toBe("synced");
    expect(record.lastError).toBeNull();
    expect(typeof record.lastSyncedAt).toBe("string");
    expect(typeof record.lastAttemptAt).toBe("string");

    const snapshot = await workbenchStatusSnapshot({ dir: root });
    const origin = snapshot.remotes.find((entry) => entry.name === "origin");
    expect(origin?.sync.status).toBe("up_to_date");
    expect(origin?.sync.lastError).toBeNull();
    expect(origin?.publication.status).toBe("unpublished");
    // Zero runs: eval comes first; synced-but-unpublished remote gets a publish suggestion.
    expect(snapshot.runs.total).toBe(0);
    expect(snapshot.next[0]).toBe("workbench eval");
    expect(snapshot.next.some((command) => command.startsWith("workbench publish"))).toBe(false);
    expect(snapshot.worktree.hasUnversionedChanges).toBe(false);
  });

  test("file remotes are sync-only and reject publication", async () => {
    const root = await makeTempRoot("workbench-file-remote-publish-");
    const remote = await makeTempRoot("workbench-file-remote-publish-remote-");
    await initWorkbenchSkill({ dir: root });
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: root });

    const error = await codedErrorFrom(publishWorkbenchVersion({ dir: root }));
    expect(error.code).toBe("publish_failed");
    expect(error.subject).toMatchObject({ remote: "origin", kind: "file" });
  });

  test("sync failure writes a coded error record and gates the publish suggestion", async () => {
    const root = await makeTempRoot("workbench-sync-failure-");
    const remoteParent = await makeTempRoot("workbench-sync-failure-remote-");
    const remotePath = path.join(remoteParent, "not-a-directory");
    await fs.writeFile(remotePath, "plain file\n");
    await initWorkbenchSkill({ dir: root });
    await addWorkbenchRemote("origin", pathToFileURL(remotePath).toString(), { dir: root });

    await expect(syncWorkbenchRemote({ dir: root })).rejects.toThrow(/not a directory/u);

    const record = await readSyncState(root, "origin");
    expect(record.status).toBe("error");
    expect(record.lastError).toMatchObject({ code: "sync_failed" });
    expect((record.lastError as { message: string }).message).toMatch(/not a directory/u);

    const snapshot = await workbenchStatusSnapshot({ dir: root });
    const origin = snapshot.remotes.find((entry) => entry.name === "origin");
    expect(origin?.sync.status).toBe("error");
    expect(origin?.sync.lastError).toMatchObject({ code: "sync_failed" });
    expect(origin?.sync.nextCommand).toBe("workbench sync origin");
    expect(snapshot.next).toContain("workbench sync origin");
    expect(snapshot.next.some((command) => command.startsWith("workbench publish"))).toBe(false);
  });

  test("a sync record for a different URL is ignored and the remote reads as never synced", async () => {
    const root = await makeTempRoot("workbench-sync-stale-url-");
    const remote = await makeTempRoot("workbench-sync-stale-url-remote-");
    await initWorkbenchSkill({ dir: root });
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: root });
    await syncWorkbenchRemote({ dir: root });

    const record = await readSyncState(root, "origin");
    await fs.writeFile(
      syncStateFile(root, "origin"),
      `${JSON.stringify({ ...record, url: "file:///somewhere/else" }, null, 2)}\n`,
    );

    const snapshot = await workbenchStatusSnapshot({ dir: root });
    const origin = snapshot.remotes.find((entry) => entry.name === "origin");
    expect(origin?.sync.status).toBe("never");
    expect(origin?.sync.lastError).toBeNull();
    expect(origin?.sync.nextCommand).toBe("workbench sync origin");
    expect(snapshot.next.some((command) => command.startsWith("workbench publish"))).toBe(false);
  });

  test("status snapshot reports unversioned worktree changes only when reconcile creates a version", async () => {
    const root = await makeTempRoot("workbench-status-worktree-");
    await initWorkbenchSkill({ dir: root });

    const clean = await workbenchStatusSnapshot({ dir: root });
    expect(clean.worktree.hasUnversionedChanges).toBe(false);

    await fs.appendFile(path.join(root, "SKILL.md"), "\nManual snapshot edit.\n");
    const dirty = await workbenchStatusSnapshot({ dir: root });
    expect(dirty.worktree.hasUnversionedChanges).toBe(true);
    expect(dirty.project.currentVersionId).toBe(dirty.worktree.latestVersionId);

    const settled = await workbenchStatusSnapshot({ dir: root });
    expect(settled.worktree.hasUnversionedChanges).toBe(false);
  });

  test("invalid remote names are rejected with remote_invalid_name", async () => {
    const root = await makeTempRoot("workbench-remote-name-");
    await initWorkbenchSkill({ dir: root });
    const error = await codedErrorFrom(
      addWorkbenchRemote("Bad Name", "file:///tmp/workbench-remote", { dir: root })
    );
    expect(error.code).toBe("remote_invalid_name");
  });

  test("http remotes allow IPv6 loopback for local Cloud testing", async () => {
    const root = await makeTempRoot("workbench-remote-ipv6-loopback-");
    await initWorkbenchSkill({ dir: root });

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
});
