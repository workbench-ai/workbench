import { describe, expect, test } from "vitest";

import {
  DOCKER_SANDBOX_BACKEND,
  runWorkbenchExecutionDag,
  type HostedWorkbenchJob,
} from "../src/index.ts";

describe("workbench execution DAG scheduler", () => {
  test("starts independent jobs concurrently up to host capacity", async () => {
    const jobs = ["a", "b", "c", "d", "e"].map((id) => testJob(id));
    let active = 0;
    let maxActive = 0;

    const result = await runWorkbenchExecutionDag({
      jobs,
      sandboxProvider: DOCKER_SANDBOX_BACKEND,
      capacity: { cpu: 5, memoryGb: 5, diskGb: 5 },
      executeJob: async (job) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(25);
        active -= 1;
        return succeededJob(job);
      },
    });

    expect(result.startedJobCount).toBe(5);
    expect(result.maxConcurrency).toBe(5);
    expect(maxActive).toBe(5);
    expect(result.jobs.every((job) => job.status === "succeeded")).toBe(true);
  });

  test("starts dependents after prerequisites finish", async () => {
    const jobs = [
      testJob("runner"),
      testJob("score-a", ["runner"]),
      testJob("score-b", ["runner"]),
    ];
    const finished = new Set<string>();
    const dependentStartedAfterRunner: boolean[] = [];

    const result = await runWorkbenchExecutionDag({
      jobs,
      sandboxProvider: DOCKER_SANDBOX_BACKEND,
      capacity: { cpu: 3, memoryGb: 3, diskGb: 3 },
      executeJob: async (job) => {
        if (job.id.startsWith("score-")) {
          dependentStartedAfterRunner.push(finished.has("runner"));
        }
        await sleep(10);
        finished.add(job.id);
        return succeededJob(job);
      },
    });

    expect(result.maxConcurrency).toBe(2);
    expect(dependentStartedAfterRunner).toEqual([true, true]);
    expect(result.jobs.map((job) => job.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
  });

  test("uses resource admission instead of a parallelism knob", async () => {
    const jobs = ["a", "b", "c", "d"].map((id) => testJob(id));
    let active = 0;
    let maxActive = 0;

    const result = await runWorkbenchExecutionDag({
      jobs,
      sandboxProvider: DOCKER_SANDBOX_BACKEND,
      capacity: { cpu: 2, memoryGb: 2, diskGb: 2 },
      executeJob: async (job) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(15);
        active -= 1;
        return succeededJob(job);
      },
    });

    expect(result.maxConcurrency).toBe(2);
    expect(maxActive).toBe(2);
    expect(result.startedJobCount).toBe(4);
  });

  test("cancels jobs whose prerequisites fail", async () => {
    const jobs = [
      testJob("runner"),
      testJob("score", ["runner"]),
    ];

    const result = await runWorkbenchExecutionDag({
      jobs,
      sandboxProvider: DOCKER_SANDBOX_BACKEND,
      capacity: { cpu: 2, memoryGb: 2, diskGb: 2 },
      executeJob: async (job) =>
        job.id === "runner"
          ? failedJob(job, "runner failed")
          : succeededJob(job),
    });

    expect(result.startedJobCount).toBe(1);
    expect(result.cancelledJobCount).toBe(1);
    expect(result.jobs.map((job) => job.status)).toEqual(["failed", "cancelled"]);
    expect(result.jobs[1]?.error).toBe("Dependency failed.");
  });

  test("terminal prerequisite jobs satisfy queued dependents without re-execution", async () => {
    const subjectRevision = succeededJob(testJob("subject-revision"));
    const runner = testJob("runner", ["subject-revision"]);
    const started: string[] = [];

    const result = await runWorkbenchExecutionDag({
      jobs: [subjectRevision, runner],
      sandboxProvider: DOCKER_SANDBOX_BACKEND,
      capacity: { cpu: 1, memoryGb: 1, diskGb: 1 },
      executeJob: async (job) => {
        started.push(job.id);
        return succeededJob(job);
      },
    });

    expect(started).toEqual(["runner"]);
    expect(result.jobs.map((job) => job.status)).toEqual(["succeeded", "succeeded"]);
  });
});

function testJob(
  id: string,
  dependsOn: readonly string[] = [],
): HostedWorkbenchJob {
  return {
    id,
    projectId: "benchmark",
    runId: "run",
    subjectId: "subject",
    kind: "execute",
    status: "queued",
    attempt: 0,
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z",
    input: {
      dependsOn: [...dependsOn],
      execution: {
        id: `exec_${id}`,
        purpose: id.startsWith("score") ? "attempt" : "attempt",
        policy: {
          resources: {
            cpu: 1,
            memoryGb: 1,
            diskGb: 1,
            timeoutMinutes: 1,
          },
        },
      },
    },
  } as unknown as HostedWorkbenchJob;
}

function succeededJob(job: HostedWorkbenchJob): HostedWorkbenchJob {
  return {
    ...job,
    status: "succeeded",
    updatedAt: "2026-05-03T00:00:01.000Z",
    finishedAt: "2026-05-03T00:00:01.000Z",
  };
}

function failedJob(job: HostedWorkbenchJob, error: string): HostedWorkbenchJob {
  return {
    ...job,
    status: "failed",
    updatedAt: "2026-05-03T00:00:01.000Z",
    finishedAt: "2026-05-03T00:00:01.000Z",
    error,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
