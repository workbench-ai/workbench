import { describe, expect, test } from "vitest";

import {
  workbenchJobReportTotalCostUsd,
  type WorkbenchJob,
  type WorkbenchRun,
  type WorkbenchRunSnapshot,
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
    const runA = run({ id: "run_a", status: "running", jobIds: ["job_a_0", "job_a_1"] });
    const runB = run({ id: "run_b", status: "running", jobIds: ["job_b_0"] });
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
          sample: 2,
          runningCount: 1,
        },
      },
    });
    expect(formatProgressSnapshot(snapshot, "run")).toBe("workbench eval run: running, jobs 2/3 complete, remaining 1, scored 1, partial score 1.000, failed 1, active case=case-001 sample=2 job=job_a_1, evidence 3, wall time 42s.");
    expect(formatProgressSnapshot(snapshot, "grade")).toMatch(/^workbench eval grade:/u);
  });

  test("projects concrete evidence and usage facts", () => {
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
      command: "eval",
      location: "local",
      phase: "running",
      runs: [run({ id: "run_usage", status: "running", jobIds: ["job_done", "job_running"] })],
      jobs: [
        job({
          id: "job_done",
          runId: "run_usage",
          status: "succeeded",
          score: 0.5,
          usageCostUsd: 0.1234,
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
      elapsedMs: 10_000,
    });
    expect(workbenchJobReportTotalCostUsd(snapshot.report)).toBe(0.1234);
    expect(formatProgressSummary(snapshot)).toContain("partial score 0.500");
    expect(formatProgressSummary(snapshot)).toContain("evidence 4");
    expect(formatProgressSummary(snapshot)).toContain("cost=$0.12 total");
    expect(formatProgressSummary({
      ...snapshot,
      report: {
        ...snapshot.report,
        roles: snapshot.report.roles.map((role) => role.costUsd === undefined ? role : { ...role, costUsd: 0.004 }),
      },
    })).toContain("cost=$0 total");
  });

  test("keeps eval progress planned totals stable before grade jobs exist", () => {
    const evalRun = run({
      id: "run_eval_plan",
      jobIds: Array.from({ length: 5 }, (_, sample) => `job_exec_${sample}`),
      requestedSamples: 5,
      operationPlan: {
        kind: "eval",
        variant: "local",
        versionId: "v001",
        evalHash: "eval_hash",
        skills: ["current"],
        agents: ["default"],
        caseIds: ["case-001"],
        samples: 5,
      },
    });
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
      command: "eval",
      location: "local",
      phase: "running",
      runs: [evalRun],
      jobs: Array.from({ length: 5 }, (_, sample) =>
        job({
          id: `job_exec_${sample}`,
          runId: evalRun.id,
          sample,
          status: sample === 0 ? "running" : "queued",
        })
      ),
      startedAtMs: 0,
      nowMs: 1_000,
    }));

    expect(snapshot.progress).toMatchObject({
      planned: 10,
      completed: 0,
      scored: 0,
      failed: 0,
    });
    expect(formatProgressSnapshot(snapshot)).toContain("jobs 0/10 complete");
    expect(formatProgressSnapshot(snapshot)).toContain("remaining 10");
  });

  test("uses durable finish time for terminal wall time", () => {
    const startedAt = Date.parse("2026-06-15T00:00:00.000Z");
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
      command: "watch",
      location: "local",
      phase: "running",
      runs: [
        run({
          id: "run_finished",
          jobIds: ["job_finished"],
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
    expect(formatProgressSnapshot(snapshot)).toContain("wall time 2m");
  });

  test("keeps failed and canceled counts separate in human progress", () => {
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
      command: "eval",
      location: "local",
      phase: "running",
      runs: [run({ id: "run_canceled", status: "running", jobIds: ["job_canceled"] })],
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
      .toBe("workbench eval run: running, jobs 1/1 complete, failed 0, canceled 1, evidence 1, wall time 15s.");
  });

  test("omits empty evidence from human progress", () => {
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
      command: "watch",
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
    const improveRun = run({ id: "run_improve", kind: "improve", status: "running", jobIds: ["job_improve", "job_proof"] });
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
      .toBe("workbench skill improve: proof eval running, jobs 0/1 complete, remaining 1, failed 0, evidence 2, wall time 8s.");
  });

  test("renders only meaningful changes and heartbeat intervals", () => {
    const stream = new MemoryStream();
    const renderer = createProgressRenderer({ stderr: stream, heartbeatMs: 60_000 });
    const queued = expectSnapshot(runProgressSnapshotFromRuns({
      command: "eval",
      location: "cloud",
      phase: "queued",
      runs: [run({ id: "run_cloud", status: "queued", jobIds: ["job_cloud"] })],
      jobs: [job({ id: "job_cloud", runId: "run_cloud", status: "queued" })],
      startedAtMs: 0,
      nowMs: 0,
    }));
    const unchanged = {
      ...queued,
      progress: { ...queued.progress, elapsedMs: 20_000 },
      report: { ...queued.report, elapsedMs: 20_000 },
    };
    const heartbeat = {
      ...queued,
      progress: { ...queued.progress, elapsedMs: 60_000 },
    };
    const running = expectSnapshot(runProgressSnapshotFromRuns({
      command: "eval",
      location: "cloud",
      phase: "running",
      runs: [run({ id: "run_cloud", status: "running", jobIds: ["job_cloud"] })],
      jobs: [job({ id: "job_cloud", runId: "run_cloud", status: "running" })],
      startedAtMs: 0,
      nowMs: 61_000,
    }));
    const complete = expectSnapshot(runProgressSnapshotFromRuns({
      command: "eval",
      location: "cloud",
      phase: "running",
      runs: [run({ id: "run_cloud", status: "succeeded", jobIds: ["job_cloud"] })],
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
      "workbench eval run: queued on Workbench Cloud, jobs 0/1 complete, remaining 1, failed 0, evidence 1, wall time 0s.",
      "workbench eval run: queued runs are waiting for a hosted worker; press Ctrl-C to detach and resume with workbench watch run_cloud.",
      "workbench eval run: queued on Workbench Cloud, jobs 0/1 complete, remaining 1, failed 0, evidence 1, wall time 1m.",
      "workbench eval run: queued runs are waiting for a hosted worker; press Ctrl-C to detach and resume with workbench watch run_cloud.",
      "workbench eval run: running, jobs 0/1 complete, remaining 1, failed 0, active case=case-001 sample=1 job=job_cloud, evidence 1, wall time 1m 1s.",
      "workbench eval run: press Ctrl-C to detach; resume with workbench watch run_cloud.",
      "workbench eval run: complete, jobs 1/1 complete, scored 1, failed 0, evidence 1, wall time 1m 20s.",
      "",
    ].join("\n"));
  });

  test("emits schema-tagged JSONL progress without human guidance in json mode", () => {
    const stream = new MemoryStream();
    const renderer = createProgressRenderer({ stderr: stream, json: true, heartbeatMs: 60_000 });
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
      command: "watch",
      location: "cloud",
      phase: "running",
      runs: [run({ id: "run_cloud", status: "running", jobIds: ["job_cloud"] })],
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
      runs: [run({ id: "run_local", status: "running", jobIds: ["job_local"] })],
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
      "workbench eval run: running, jobs 0/1 complete, remaining 1, failed 0, active case=case-001 sample=1 job=job_local, evidence 1, wall time 0s.",
      "workbench eval run: inspect current evidence with workbench eval show run_local.",
      "workbench eval run: running, jobs 0/1 complete, remaining 1, failed 0, active case=case-001 sample=1 job=job_local, evidence 1, wall time 1m.",
      "workbench eval run: inspect current evidence with workbench eval show run_local.",
      "",
    ].join("\n"));
  });

  test("keeps terminal cloud evidence sync visible as sync", () => {
    const snapshot = expectSnapshot(runProgressSnapshotFromRuns({
      command: "eval",
      location: "cloud",
      phase: "sync",
      runs: [run({ id: "run_cloud", status: "succeeded", jobIds: ["job_cloud"] })],
      jobs: [job({ id: "job_cloud", runId: "run_cloud", status: "succeeded", score: 1 })],
      startedAtMs: 0,
      nowMs: 90_000,
    }));

    expect(snapshot.phase).toBe("syncing");
    expect(formatProgressSnapshot(snapshot))
      .toBe("workbench eval run: sync with Workbench Cloud, jobs 1/1 complete, scored 1, failed 0, evidence 1, wall time 1m 30s.");
  });

  test("uses proof jobs for terminal improve sync counters", () => {
    const improveRun = run({ id: "run_improve_sync", kind: "improve", status: "succeeded", jobIds: ["job_patch", "job_proof"] });
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
      .toBe("workbench skill improve: sync with Workbench Cloud, jobs 1/1 complete, scored 1, failed 0, evidence 2, wall time 1m 30s.");
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

type ProgressJobOverrides = Partial<WorkbenchJob> & { score?: number; usageCostUsd?: number };

function job(overrides: ProgressJobOverrides): WorkbenchJob {
  const { score, usageCostUsd, ...rest } = overrides;
  return {
    id: "job_1",
    runId: "run_1",
    kind: "eval",
    role: score !== undefined ? "grade" : "run",
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
    ...(score !== undefined || usageCostUsd !== undefined ? {
      result: {
        ...(usageCostUsd !== undefined ? { usage: { total: { costUsd: usageCostUsd } } } : {}),
        ...(score !== undefined ? { items: [{ kind: "score" as const, score, value: score }] } : {}),
      },
    } : {}),
    ...rest,
  };
}
