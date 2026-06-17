import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  createWorkbenchReadOnlyInspectionSnapshot,
  initWorkbenchSkill,
  readWorkbenchReadOnlyInspectionCursor,
  waitForWorkbenchReadOnlyInspectionNotice,
  workbenchExecutionEventBatchId,
  type WorkbenchProjectState,
} from "../src/index.ts";
import {
  advanceLocalWorkbenchLiveState,
} from "../src/local-live-state.ts";

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

describe("local live inspection state", () => {
  test("execution-event-only object writes can invalidate read-only inspection", async () => {
    const root = await makeTempRoot("workbench-local-live-state-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    const cursor = await readWorkbenchReadOnlyInspectionCursor({ dir: root });
    const batch: WorkbenchProjectState["executionEvents"][number] = {
      projectId: "local",
      runId: "run_live",
      jobId: "job_live",
      executionId: "exec_live",
      attempt: 1,
      seqStart: 1,
      seqEnd: 1,
      emittedAt: "2026-06-15T00:00:00.000Z",
      events: [{
        seq: 1,
        at: "2026-06-15T00:00:00.000Z",
        source: "adapter",
        role: "engine",
        schema: "workbench.execution.step.v1",
        payload: { step: "case.script", status: "started" },
      }],
    };

    const objectDir = path.join(root, ".workbench", "objects", "execution-event");
    await fs.mkdir(objectDir, { recursive: true });
    await fs.writeFile(
      path.join(objectDir, `${workbenchExecutionEventBatchId(batch)}.json`),
      `${JSON.stringify(batch, null, 2)}\n`,
      "utf8",
    );
    await advanceLocalWorkbenchLiveState(root);

    await expect(waitForWorkbenchReadOnlyInspectionNotice({
      dir: root,
      cursor,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({
      schema: "workbench.state.notice.v1",
      type: "changed",
    });
    await expect(createWorkbenchReadOnlyInspectionSnapshot({ dir: root }))
      .resolves.toMatchObject({
        executionEvents: [expect.objectContaining({
          jobId: "job_live",
          executionId: "exec_live",
        })],
      });
  });
});
