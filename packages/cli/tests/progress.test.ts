import { describe, expect, test } from "vitest";

import type {
  WorkbenchJob,
  WorkbenchRun,
  WorkbenchRunSnapshot,
} from "@workbench-ai/workbench-contract";

import {
  createProgressRenderer,
  formatProgressSnapshot,
  formatProgressSummary,
  runProgressSnapshotFromRuns,
} from "../src/progress.ts";

class MemoryStream {
  value = "";

  write(chunk: string): boolean {
    this.value += chunk;
    return true;
  }
}

describe("Workbench CLI progress projection", () => {
  test("projects canonical run snapshots from run and job progress", () => {
    const runA = run({ id: "run_a", status: "running" });
    const runB = run({ id: "run_b", status: "running" });
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
      command: "eval",
      location: "local",
      phase: "running",
      runs: [runA, runB],
      jobs: [
        job({ id: "job_a_0", runId: runA.id, caseId: "case-001", sample: 0, status: "succeeded", score: 1 }),
        job({ id: "job_a_1", runId: runA.id, caseId: "case-001", sample: 1, status: "running" }),
        job({ id: "job_b_0", runId: runB.id, caseId: "case-001", sample: 0, status: "failed" }),
      ],
      startedAtMs: 0,
      nowMs: 42_000,
    }));

    expect(snapshot).toMatchObject({
      schema: "workbench.run.v1",
      id: "run_a",
      kind: "eval",
      phase: "running",
      status: "running",
      progress: {
        planned: 3,
        completed: 2,
        scored: 1,
        failed: 1,
        canceled: 0,
        partialScore: 1,
        elapsedMs: 42_000,
        active: {
          jobId: "job_a_1",
          caseId: "case-001",
          sample: 1,
          runningCount: 1,
        },
      },
    });
    expect(formatProgressSnapshot(snapshot))
      .toBe("workbench eval: running, work 2/3 complete, scored 1, partial score 1.000, failed 1, active case=case-001 sample=2 job=job_a_1, elapsed 42s.");
  });

  test("projects concrete evidence and usage facts", () => {
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
      command: "eval",
      location: "local",
      phase: "running",
      runs: [run({ id: "run_usage", status: "running", costUsd: 0.1234 })],
      jobs: [
        job({
          id: "job_done",
          runId: "run_usage",
          status: "succeeded",
          score: 0.5,
          artifactIds: ["artifact_1"],
          traceIds: ["trace_1"],
          finishedAt: "2026-06-15T00:00:05.000Z",
        }),
        job({ id: "job_running", runId: "run_usage", status: "running" }),
      ],
      evidence: {
        artifacts: 1,
        traces: 1,
        sessions: 1,
        resultFiles: 1,
      },
      startedAtMs: 0,
      nowMs: 10_000,
    }));

    expect(snapshot.progress).toMatchObject({
      planned: 2,
      completed: 1,
      scored: 1,
      failed: 0,
      canceled: 0,
      partialScore: 0.5,
      evidenceCount: 4,
      costUsd: 0.1234,
      elapsedMs: 10_000,
    });
    expect(formatProgressSummary(snapshot)).toContain("partial score 0.500");
    expect(formatProgressSummary(snapshot)).toContain("evidence 4");
    expect(formatProgressSummary(snapshot)).toContain("usage cost=$0.12");
  });

  test("uses durable finish time for terminal elapsed duration", () => {
    const startedAt = Date.parse("2026-06-15T00:00:00.000Z");
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
      command: "run watch",
      location: "local",
      phase: "running",
      runs: [
        run({
          id: "run_finished",
          status: "succeeded",
          createdAt: "2026-06-15T00:00:00.000Z",
          finishedAt: "2026-06-15T00:02:00.000Z",
        }),
      ],
      jobs: [
        job({
          id: "job_finished",
          runId: "run_finished",
          status: "succeeded",
          score: 1,
          createdAt: "2026-06-15T00:00:05.000Z",
          finishedAt: "2026-06-15T00:01:30.000Z",
        }),
      ],
      startedAtMs: startedAt,
    }));

    expect(snapshot).toMatchObject({
      phase: "complete",
      progress: {
        elapsedMs: 120_000,
        lastProgressAt: "2026-06-15T00:02:00.000Z",
      },
    });
    expect(formatProgressSnapshot(snapshot)).toContain("elapsed 2m");
  });

  test("keeps failed and canceled counts separate in human progress", () => {
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
      command: "eval",
      location: "local",
      phase: "running",
      runs: [run({ id: "run_canceled", status: "running" })],
      jobs: [
        job({
          id: "job_canceled",
          runId: "run_canceled",
          status: "canceled",
          finishedAt: "2026-06-15T00:00:10.000Z",
        }),
      ],
      startedAtMs: 0,
      nowMs: 15_000,
    }));

    expect(snapshot.progress).toMatchObject({
      failed: 0,
      canceled: 1,
    });
    expect(formatProgressSnapshot(snapshot))
      .toBe("workbench eval: running, work 1/1 complete, failed 0, canceled 1, elapsed 15s.");
  });

  test("omits empty evidence from human progress", () => {
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
      command: "run watch",
      location: "local",
      phase: "running",
      runs: [run({ id: "run_no_evidence", status: "running" })],
      jobs: [],
      evidence: {
        artifacts: 0,
        traces: 0,
        sessions: 0,
        resultFiles: 0,
      },
      startedAtMs: 0,
      nowMs: 1_000,
    }));

    expect(snapshot).not.toHaveProperty("evidence");
    expect(formatProgressSummary(snapshot)).not.toContain("evidence");
  });

  test("excludes improve adapter jobs from proof eval counters", () => {
    const improveRun = run({ id: "run_improve", kind: "improve", status: "running" });
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
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
    }));

    expect(snapshot).toMatchObject({
      phase: "proof",
      progress: {
        planned: 1,
        completed: 0,
        failed: 0,
      },
    });
    expect(formatProgressSnapshot(snapshot))
      .toBe("workbench improve: proof eval running, work 0/1 complete, failed 0, elapsed 8s.");
  });

  test("renders only meaningful changes and heartbeat intervals", () => {
    const stream = new MemoryStream();
    const renderer = createProgressRenderer({ stderr: stream, heartbeatMs: 60_000 });
    const queued = expectSnapshot(runProgressSnapshotFromRuns({
      command: "eval",
      location: "cloud",
      phase: "queued",
      runs: [run({ id: "run_cloud", status: "queued" })],
      jobs: [job({ id: "job_cloud", runId: "run_cloud", status: "queued" })],
      startedAtMs: 0,
      nowMs: 0,
    }));
    const unchanged = {
      ...queued,
      progress: { ...queued.progress, elapsedMs: 20_000 },
    };
    const heartbeat = {
      ...queued,
      progress: { ...queued.progress, elapsedMs: 60_000 },
    };
    const running = expectSnapshot(runProgressSnapshotFromRuns({
      command: "eval",
      location: "cloud",
      phase: "running",
      runs: [run({ id: "run_cloud", status: "running" })],
      jobs: [job({ id: "job_cloud", runId: "run_cloud", status: "running" })],
      startedAtMs: 0,
      nowMs: 61_000,
    }));
    const complete = expectSnapshot(runProgressSnapshotFromRuns({
      command: "eval",
      location: "cloud",
      phase: "running",
      runs: [run({ id: "run_cloud", status: "succeeded" })],
      jobs: [job({ id: "job_cloud", runId: "run_cloud", status: "succeeded", score: 1 })],
      startedAtMs: 0,
      nowMs: 80_000,
    }));

    renderer.render(queued);
    renderer.render(unchanged);
    renderer.render(heartbeat);
    renderer.render(running);
    renderer.render(complete);

    expect(stream.value).toBe([
      "workbench eval: queued on Workbench Cloud, work 0/1 complete, failed 0, elapsed 0s.",
      "workbench eval: queued runs are waiting for a hosted worker; press Ctrl-C to detach and resume with workbench run watch run_cloud.",
      "workbench eval: queued on Workbench Cloud, work 0/1 complete, failed 0, elapsed 1m.",
      "workbench eval: queued runs are waiting for a hosted worker; press Ctrl-C to detach and resume with workbench run watch run_cloud.",
      "workbench eval: running, work 0/1 complete, failed 0, active case=case-001 sample=1 job=job_cloud, elapsed 1m 1s.",
      "workbench eval: press Ctrl-C to detach; resume with workbench run watch run_cloud.",
      "workbench eval: complete, work 1/1 complete, scored 1, failed 0, elapsed 1m 20s.",
      "",
    ].join("\n"));
  });

  test("emits schema-tagged JSONL progress without human guidance in json mode", () => {
    const stream = new MemoryStream();
    const renderer = createProgressRenderer({ stderr: stream, json: true, heartbeatMs: 60_000 });
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
      command: "run watch",
      location: "cloud",
      phase: "running",
      runs: [run({ id: "run_cloud", status: "running" })],
      jobs: [job({ id: "job_cloud", runId: "run_cloud", status: "running" })],
      startedAtMs: 0,
      nowMs: 42_000,
    }));

    renderer.render(snapshot);

    expect(stream.value.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        schema: "workbench.run.v1",
        id: "run_cloud",
        kind: "eval",
        phase: "running",
        variant: "cloud",
        progress: expect.objectContaining({
          completed: 0,
          planned: 1,
          elapsedMs: 42_000,
        }),
      }),
    ]);
  });

  test("prints local inspection guidance while provider-backed work is running", () => {
    const stream = new MemoryStream();
    const renderer = createProgressRenderer({ stderr: stream, heartbeatMs: 60_000 });
    const running = expectSnapshot(runProgressSnapshotFromRuns({
      command: "eval",
      location: "local",
      phase: "running",
      runs: [run({ id: "run_local", status: "running" })],
      jobs: [job({ id: "job_local", runId: "run_local", status: "running" })],
      startedAtMs: 0,
      nowMs: 0,
    }));
    const heartbeat = {
      ...running,
      progress: { ...running.progress, elapsedMs: 60_000 },
    };

    renderer.render(running);
    renderer.render({
      ...running,
      progress: { ...running.progress, elapsedMs: 30_000 },
    });
    renderer.render(heartbeat);

    expect(stream.value).toBe([
      "workbench eval: running, work 0/1 complete, failed 0, active case=case-001 sample=1 job=job_local, elapsed 0s.",
      "workbench eval: inspect current evidence with workbench show run_local.",
      "workbench eval: running, work 0/1 complete, failed 0, active case=case-001 sample=1 job=job_local, elapsed 1m.",
      "workbench eval: inspect current evidence with workbench show run_local.",
      "",
    ].join("\n"));
  });

  test("keeps terminal cloud evidence sync visible as sync", () => {
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
      command: "eval",
      location: "cloud",
      phase: "sync",
      runs: [run({ id: "run_cloud", status: "succeeded" })],
      jobs: [job({ id: "job_cloud", runId: "run_cloud", status: "succeeded", score: 1 })],
      startedAtMs: 0,
      nowMs: 90_000,
    }));

    expect(snapshot.phase).toBe("syncing");
    expect(formatProgressSnapshot(snapshot))
      .toBe("workbench eval: sync with Workbench Cloud, work 1/1 complete, scored 1, failed 0, elapsed 1m 30s.");
  });

  test("uses proof jobs for terminal improve sync counters", () => {
    const improveRun = run({ id: "run_improve_sync", kind: "improve", status: "succeeded" });
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
      command: "improve",
      location: "cloud",
      phase: "sync",
      runs: [improveRun],
      jobs: [
        job({ id: "job_patch", runId: improveRun.id, kind: "improve", caseId: "current", sample: 0, status: "succeeded" }),
        job({ id: "job_proof", runId: improveRun.id, kind: "improve", caseId: "case-001", sample: 0, status: "succeeded", score: 1 }),
      ],
      startedAtMs: 0,
      nowMs: 90_000,
    }));

    expect(snapshot).toMatchObject({
      phase: "syncing",
      progress: {
        planned: 1,
        completed: 1,
        scored: 1,
        failed: 0,
      },
    });
    expect(formatProgressSnapshot(snapshot))
      .toBe("workbench improve: sync with Workbench Cloud, work 1/1 complete, scored 1, failed 0, elapsed 1m 30s.");
  });
});

function expectSnapshot(snapshot: WorkbenchRunSnapshot | undefined): WorkbenchRunSnapshot {
  expect(snapshot).toBeDefined();
  return snapshot as WorkbenchRunSnapshot;
}

function run(overrides: Partial<WorkbenchRun>): WorkbenchRun {
  return {
    id: "run_1",
    kind: "eval",
    versionId: "v001",
    skillName: "current",
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
    skillName: "current",
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
