import { describe, expect, test } from "vitest";

import type {
  WorkbenchJob,
  WorkbenchRun,
} from "@workbench-ai/workbench-contract";

import {
  createProgressRenderer,
  formatProgressSnapshot,
  progressSnapshotFromRuns,
} from "../src/progress.ts";

class MemoryStream {
  value = "";

  write(chunk: string): boolean {
    this.value += chunk;
    return true;
  }
}

describe("Workbench CLI progress projection", () => {
  test("aggregates case and sample counters per run", () => {
    const runA = run({ id: "run_a", status: "running" });
    const runB = run({ id: "run_b", status: "running" });
    const snapshot = progressSnapshotFromRuns({
      command: "eval",
      location: "local",
      phase: "running",
      runs: [runA, runB],
      jobs: [
        job({ id: "job_a_0", runId: runA.id, caseId: "case-001", sample: 0, status: "succeeded" }),
        job({ id: "job_a_1", runId: runA.id, caseId: "case-001", sample: 1, status: "running" }),
        job({ id: "job_b_0", runId: runB.id, caseId: "case-001", sample: 0, status: "failed" }),
      ],
      startedAtMs: 0,
      nowMs: 42_000,
    });

    expect(snapshot).toMatchObject({
      phase: "running",
      runIds: ["run_a", "run_b"],
      casesTotal: 2,
      casesDone: 1,
      samplesTotal: 3,
      samplesDone: 2,
      failed: 1,
      elapsedMs: 42_000,
    });
    expect(formatProgressSnapshot(snapshot))
      .toBe("workbench eval: running, cases 1/2, samples 2/3 complete, failed 1, elapsed 42s.");
  });

  test("excludes improve adapter jobs from proof eval counters", () => {
    const improveRun = run({ id: "run_improve", kind: "improve", status: "running" });
    const snapshot = progressSnapshotFromRuns({
      command: "improve",
      location: "cloud",
      phase: "proof_eval",
      runs: [improveRun],
      jobs: [
        job({ id: "job_improve", runId: improveRun.id, kind: "improve", caseId: "current", sample: 0, status: "succeeded" }),
        job({ id: "job_proof", runId: improveRun.id, kind: "improve", caseId: "case-001", sample: 0, status: "queued" }),
      ],
      startedAtMs: 0,
      nowMs: 8_000,
    });

    expect(snapshot).toMatchObject({
      phase: "proof_eval",
      casesTotal: 1,
      casesDone: 0,
      samplesTotal: 1,
      samplesDone: 0,
      failed: 0,
    });
    expect(formatProgressSnapshot(snapshot))
      .toBe("workbench improve: proof eval running, cases 0/1, samples 0/1 complete, failed 0, elapsed 8s.");
  });

  test("renders only meaningful changes and heartbeat intervals", () => {
    const stream = new MemoryStream();
    const renderer = createProgressRenderer({ stderr: stream, heartbeatMs: 60_000 });
    const queued = progressSnapshotFromRuns({
      command: "eval",
      location: "cloud",
      phase: "queued",
      runs: [run({ id: "run_cloud", status: "queued" })],
      jobs: [job({ id: "job_cloud", runId: "run_cloud", status: "queued" })],
      startedAtMs: 0,
      nowMs: 0,
    });
    const unchanged = { ...queued, elapsedMs: 20_000 };
    const heartbeat = { ...queued, elapsedMs: 60_000 };
    const running = progressSnapshotFromRuns({
      command: "eval",
      location: "cloud",
      phase: "running",
      runs: [run({ id: "run_cloud", status: "running" })],
      jobs: [job({ id: "job_cloud", runId: "run_cloud", status: "running" })],
      startedAtMs: 0,
      nowMs: 61_000,
    });
    const complete = progressSnapshotFromRuns({
      command: "eval",
      location: "cloud",
      phase: "running",
      runs: [run({ id: "run_cloud", status: "succeeded" })],
      jobs: [job({ id: "job_cloud", runId: "run_cloud", status: "succeeded", score: 1 })],
      startedAtMs: 0,
      nowMs: 80_000,
    });

    renderer.render(queued);
    renderer.render(unchanged);
    renderer.render(heartbeat);
    renderer.render(running);
    renderer.render(complete);

    expect(stream.value).toBe([
      "workbench eval: queued on Workbench Cloud, cases 0/1, samples 0/1 complete, failed 0, elapsed 0s.",
      "workbench eval: queued runs are waiting for a hosted worker; press Ctrl-C to detach and resume with workbench show run_cloud.",
      "workbench eval: queued on Workbench Cloud, cases 0/1, samples 0/1 complete, failed 0, elapsed 1m.",
      "workbench eval: queued runs are waiting for a hosted worker; press Ctrl-C to detach and resume with workbench show run_cloud.",
      "workbench eval: running, cases 0/1, samples 0/1 complete, failed 0, elapsed 1m 1s.",
      "workbench eval: complete, cases 1/1, samples 1/1 complete, failed 0, elapsed 1m 20s.",
      "",
    ].join("\n"));
  });
});

function run(overrides: Partial<WorkbenchRun>): WorkbenchRun {
  return {
    id: "run_1",
    kind: "eval",
    versionId: "v001",
    skillName: "primary",
    skillBundleHash: "bundle_hash",
    evalHash: "eval_hash",
    agentName: "default",
    agentHash: "agent_hash",
    status: "running",
    jobIds: [],
    traceIds: [],
    createdAt: "2026-06-15T00:00:00.000Z",
    ...overrides,
  };
}

function job(overrides: Partial<WorkbenchJob>): WorkbenchJob {
  return {
    id: "job_1",
    runId: "run_1",
    kind: "eval",
    versionId: "v001",
    skillName: "primary",
    skillBundleHash: "bundle_hash",
    evalHash: "eval_hash",
    agentName: "default",
    agentHash: "agent_hash",
    caseId: "case-001",
    sample: 0,
    status: "queued",
    artifactIds: [],
    traceIds: [],
    createdAt: "2026-06-15T00:00:00.000Z",
    ...overrides,
  };
}
