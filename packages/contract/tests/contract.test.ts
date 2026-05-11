import { describe, expect, test } from "vitest";

import type { HostedWorkbenchJob, RuntimeSnapshot, WorkbenchExecutionSpec } from "../src/index";

describe("workbench contract", () => {
  test("keeps hosted jobs and browser snapshots as plain serializable DTOs", () => {
    const job = {
      id: "job_1",
      projectId: "wb_1",
      runId: "run_1",
      kind: "execute",
      status: "queued",
      attempt: 0,
      createdAt: "2026-04-23T00:00:00.000Z",
      updatedAt: "2026-04-23T00:00:00.000Z",
      input: { sample: 1 },
    } satisfies HostedWorkbenchJob;
    const snapshot = {
      workspaceRoot: "hosted:wb_1",
      activeId: null,
      currentBenchmarkFingerprint: null,
      summaries: [],
      results: [],
      events: [],
      latestRun: null,
      runs: [],
    } satisfies RuntimeSnapshot;

    expect(JSON.parse(JSON.stringify({ job, snapshot }))).toMatchObject({
      job: { kind: "execute", status: "queued" },
      snapshot: { workspaceRoot: "hosted:wb_1" },
    });
  });

  test("uses fingerprint-only candidate comparability and typed execution phases", () => {
    const execution = {
      id: "exec_1",
      projectId: "wb_1",
      runId: "run_1",
      purpose: "run-task",
      adapter: { use: "command", with: {} },
      sandbox: { kind: "oci", ref: "dockerfile://environment/Dockerfile" },
      inputs: [],
      outputs: [],
      policy: {
        tenantId: "user_1",
        resources: { cpu: 1, memoryGb: 1, diskGb: 1, timeoutMinutes: 1 },
        network: { egress: "none" },
      },
      metadata: {},
    } satisfies WorkbenchExecutionSpec;

    expect(execution.purpose).toBe("run-task");
  });
});
