import type {
  RemoteWorkbenchJob,
  Json,
} from "@workbench-ai/workbench-contract";

import {
  sandboxBackendAdmissionForResources,
  type SandboxBackendHostCost,
  type SandboxBackendRequestedResources,
  type WorkbenchSandboxBackendName,
} from "./sandbox-backends/index.ts";

export interface WorkbenchExecutionDagCapacity {
  cpu: number;
  memoryGb: number;
  diskGb: number;
}

export interface WorkbenchExecutionDagResult {
  jobs: RemoteWorkbenchJob[];
  maxConcurrency: number;
  startedJobCount: number;
  cancelledJobCount: number;
}

type WorkbenchExecutionDagJobHook = (job: RemoteWorkbenchJob) => void | Promise<void>;

export interface WorkbenchExecutionDagRunInput {
  jobs: readonly RemoteWorkbenchJob[];
  capacity: WorkbenchExecutionDagCapacity;
  sandboxBackend: WorkbenchSandboxBackendName;
  executeJob: (job: RemoteWorkbenchJob) => Promise<RemoteWorkbenchJob>;
  now?: () => string;
  onJobQueued?: WorkbenchExecutionDagJobHook;
  onJobStarted?: WorkbenchExecutionDagJobHook;
  onJobFinished?: WorkbenchExecutionDagJobHook;
}

interface RunningJob {
  cost: WorkbenchExecutionDagCapacity;
  promise: Promise<void>;
}

const RESOURCE_EPSILON = 1e-9;

export async function runWorkbenchExecutionDag(
  args: WorkbenchExecutionDagRunInput,
): Promise<WorkbenchExecutionDagResult> {
  assertPositiveCapacity(args.capacity);
  const now = args.now ?? (() => new Date().toISOString());
  const jobsById = new Map<string, RemoteWorkbenchJob>();
  const pending = new Map<string, RemoteWorkbenchJob>();
  const terminal = new Map<string, RemoteWorkbenchJob>();
  const running = new Map<string, RunningJob>();
  const dependencies = new Map<string, string[]>();
  const results = new Map<string, RemoteWorkbenchJob>();
  const originalOrder = args.jobs.map((job) => job.id);
  let activeCost: WorkbenchExecutionDagCapacity = emptyCapacity();
  let maxConcurrency = 0;
  let startedJobCount = 0;
  let cancelledJobCount = 0;

  for (const job of args.jobs) {
    if (jobsById.has(job.id)) {
      throw new Error(`Execution DAG includes duplicate job id ${job.id}.`);
    }
    jobsById.set(job.id, job);
  }

  for (const job of args.jobs) {
    const jobDependencies = workbenchJobDependencies(job);
    dependencies.set(job.id, jobDependencies);
    for (const dependencyId of jobDependencies) {
      if (!jobsById.has(dependencyId)) {
        throw new Error(`Job ${job.id} depends on unknown job ${dependencyId}.`);
      }
    }
    if (isTerminalJob(job)) {
      terminal.set(job.id, job);
      results.set(job.id, job);
      continue;
    }
    if (job.status !== "queued") {
      throw new Error(`Job ${job.id} has unsupported initial DAG status ${job.status}.`);
    }
    pending.set(job.id, job);
    await runJobHook(args.onJobQueued, job);
  }

  while (pending.size > 0 || running.size > 0) {
    const progressed = await startReadyJobs();
    if (running.size === 0) {
      if (pending.size === 0) {
        break;
      }
      if (await cancelTerminalBlockedPendingJobs()) {
        continue;
      }
      const ready = readyPendingJobs();
      if (ready.length > 0) {
        const blocked = ready[0]!;
        throw new Error(
          `Job ${blocked.id} requires ${formatCapacity(workbenchJobHostCost(blocked, args.sandboxBackend))}, ` +
          `which exceeds available dev capacity ${formatCapacity(args.capacity)}.`,
        );
      }
      throw new Error(
        `Execution DAG cannot make progress; remaining jobs have cyclic or blocked dependencies: ${[...pending.keys()].join(", ")}.`,
      );
    }
    if (!progressed || pending.size > 0) {
      await Promise.race([...running.values()].map((entry) => entry.promise));
    }
  }

  return {
    jobs: originalOrder.map((jobId) => {
      const result = results.get(jobId);
      if (!result) {
        throw new Error(`Execution DAG finished without result for job ${jobId}.`);
      }
      return result;
    }),
    maxConcurrency,
    startedJobCount,
    cancelledJobCount,
  };

  async function startReadyJobs(): Promise<boolean> {
    let progressed = false;
    for (const job of [...pending.values()]) {
      const dependencyStatus = dependencyTerminalStatus(job);
      if (dependencyStatus === "blocked") {
        continue;
      }
      if (dependencyStatus !== "ready") {
        await cancelPendingJob(job, dependencyStatus);
        progressed = true;
        continue;
      }
      const cost = workbenchJobHostCost(job, args.sandboxBackend);
      const available = subtractCapacity(args.capacity, activeCost);
      if (!capacityFits(available, cost)) {
        continue;
      }
      pending.delete(job.id);
      activeCost = addCapacity(activeCost, cost);
      const startedAt = now();
      const runningJob: RemoteWorkbenchJob = {
        ...job,
        status: "running",
        startedAt,
        updatedAt: startedAt,
      };
      startedJobCount += 1;
      maxConcurrency = Math.max(maxConcurrency, running.size + 1);
      await runJobHook(args.onJobStarted, runningJob);
      const promise = finishJob(runningJob, cost);
      running.set(job.id, { cost, promise });
      progressed = true;
    }
    return progressed;
  }

  function readyPendingJobs(): RemoteWorkbenchJob[] {
    return [...pending.values()].filter((job) => dependencyTerminalStatus(job) === "ready");
  }

  async function cancelTerminalBlockedPendingJobs(): Promise<boolean> {
    let cancelled = false;
    for (const job of [...pending.values()]) {
      const dependencyStatus = dependencyTerminalStatus(job);
      if (dependencyStatus !== "failed" && dependencyStatus !== "cancelled") {
        continue;
      }
      await cancelPendingJob(job, dependencyStatus);
      cancelled = true;
    }
    return cancelled;
  }

  function dependencyTerminalStatus(job: RemoteWorkbenchJob): "ready" | "blocked" | "failed" | "cancelled" {
    const jobDependencies = dependencies.get(job.id) ?? [];
    let blocked = false;
    for (const dependencyId of jobDependencies) {
      const dependency = terminal.get(dependencyId);
      if (!dependency) {
        blocked = true;
        continue;
      }
      if (dependency.status === "failed") {
        return "failed";
      }
      if (dependency.status === "cancelled") {
        return "cancelled";
      }
      if (dependency.status !== "succeeded") {
        blocked = true;
      }
    }
    return blocked ? "blocked" : "ready";
  }

  async function cancelPendingJob(
    job: RemoteWorkbenchJob,
    dependencyStatus: "failed" | "cancelled",
  ): Promise<void> {
    pending.delete(job.id);
    const finishedAt = now();
    const cancelled: RemoteWorkbenchJob = {
      ...job,
      status: "cancelled",
      updatedAt: finishedAt,
      finishedAt,
      error: `Dependency ${dependencyStatus}.`,
    };
    cancelledJobCount += 1;
    terminal.set(job.id, cancelled);
    results.set(job.id, cancelled);
    await runJobHook(args.onJobFinished, cancelled);
  }

  async function finishJob(
    runningJob: RemoteWorkbenchJob,
    cost: WorkbenchExecutionDagCapacity,
  ): Promise<void> {
    let completed: RemoteWorkbenchJob;
    try {
      completed = await args.executeJob(runningJob);
    } catch (error) {
      const finishedAt = now();
      completed = {
        ...runningJob,
        status: "failed",
        updatedAt: finishedAt,
        finishedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      activeCost = subtractCapacity(activeCost, cost);
      running.delete(runningJob.id);
    }
    terminal.set(runningJob.id, completed);
    results.set(runningJob.id, completed);
    await runJobHook(args.onJobFinished, completed);
  }
}

async function runJobHook(
  hook: WorkbenchExecutionDagJobHook | undefined,
  job: RemoteWorkbenchJob,
): Promise<void> {
  if (!hook) {
    return;
  }
  await hook(job);
}

export function workbenchJobDependencies(job: RemoteWorkbenchJob): string[] {
  const input = jsonRecord(job.input);
  const dependsOn = input.dependsOn;
  return Array.isArray(dependsOn)
    ? dependsOn.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function workbenchJobResources(
  job: RemoteWorkbenchJob,
): SandboxBackendRequestedResources {
  const input = jsonRecord(job.input);
  const resources = input.kind === "workbench.skill.eval.job.v1"
    ? input.resources
    : jsonRecord(jsonRecord(input.execution).policy).resources;
  const record = jsonRecord(resources);
  return {
    cpu: readPositiveResource(record.cpu, job.id, "resources.cpu"),
    memoryGb: readPositiveResource(record.memoryGb, job.id, "resources.memoryGb"),
    diskGb: readPositiveResource(record.diskGb, job.id, "resources.diskGb"),
    timeoutMinutes: readPositiveResource(record.timeoutMinutes, job.id, "resources.timeoutMinutes"),
  };
}

export function workbenchJobHostCost(
  job: RemoteWorkbenchJob,
  backend: WorkbenchSandboxBackendName,
): SandboxBackendHostCost {
  return sandboxBackendAdmissionForResources(backend, workbenchJobResources(job)).hostCost;
}

export function addCapacity(
  left: WorkbenchExecutionDagCapacity,
  right: WorkbenchExecutionDagCapacity,
): WorkbenchExecutionDagCapacity {
  return {
    cpu: left.cpu + right.cpu,
    memoryGb: left.memoryGb + right.memoryGb,
    diskGb: left.diskGb + right.diskGb,
  };
}

export function subtractCapacity(
  left: WorkbenchExecutionDagCapacity,
  right: WorkbenchExecutionDagCapacity,
): WorkbenchExecutionDagCapacity {
  return {
    cpu: left.cpu - right.cpu,
    memoryGb: left.memoryGb - right.memoryGb,
    diskGb: left.diskGb - right.diskGb,
  };
}

export function capacityFits(
  available: WorkbenchExecutionDagCapacity,
  cost: WorkbenchExecutionDagCapacity,
): boolean {
  return available.cpu + RESOURCE_EPSILON >= cost.cpu &&
    available.memoryGb + RESOURCE_EPSILON >= cost.memoryGb &&
    available.diskGb + RESOURCE_EPSILON >= cost.diskGb;
}

function emptyCapacity(): WorkbenchExecutionDagCapacity {
  return { cpu: 0, memoryGb: 0, diskGb: 0 };
}

function isTerminalJob(job: RemoteWorkbenchJob): boolean {
  return job.status === "succeeded" || job.status === "failed" || job.status === "cancelled";
}

function assertPositiveCapacity(capacity: WorkbenchExecutionDagCapacity): void {
  readPositiveNumber(capacity.cpu, "capacity.cpu");
  readPositiveNumber(capacity.memoryGb, "capacity.memoryGb");
  readPositiveNumber(capacity.diskGb, "capacity.diskGb");
}

function readPositiveResource(
  value: unknown,
  jobId: string,
  label: string,
): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Job ${jobId} ${label} must be a positive number.`);
  }
  return number;
}

function readPositiveNumber(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return number;
}

function jsonRecord(value: unknown): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json>
    : {};
}

function formatCapacity(capacity: WorkbenchExecutionDagCapacity): string {
  return `${capacity.cpu} CPU, ${capacity.memoryGb} GiB memory, ${capacity.diskGb} GiB disk`;
}
