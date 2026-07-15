import {
  isWorkbenchJobStatusTerminal,
  type WorkbenchExecutionJob,
} from "@workbench-ai/workbench-contract";

import {
  sandboxBackendAdmissionForResources,
  type SandboxBackendHostCost,
  type SandboxBackendRequestedResources,
  type WorkbenchSandboxBackendName,
} from "./sandbox-backends/index.ts";
import { jsonRecord } from "./runtime-utils.ts";

export interface WorkbenchExecutionDagCapacity {
  cpu: number;
  memoryGb: number;
  diskGb: number;
}

export interface WorkbenchExecutionDagResult {
  jobs: WorkbenchExecutionJob[];
  maxConcurrency: number;
  startedJobCount: number;
  cancelledJobCount: number;
}

type WorkbenchExecutionDagJobHook = (job: WorkbenchExecutionJob) => void | Promise<void>;

export interface WorkbenchExecutionDagJobControl {
  signal: AbortSignal;
}

export interface WorkbenchExecutionDagRunInput {
  jobs: readonly WorkbenchExecutionJob[];
  capacity: WorkbenchExecutionDagCapacity;
  sandboxBackend: WorkbenchSandboxBackendName;
  executeJob: (job: WorkbenchExecutionJob, control: WorkbenchExecutionDagJobControl) => Promise<WorkbenchExecutionJob>;
  shouldCancelJob?: (job: WorkbenchExecutionJob) => boolean | Promise<boolean>;
  now?: () => string;
  onJobQueued?: WorkbenchExecutionDagJobHook;
  onJobStarted?: WorkbenchExecutionDagJobHook;
  onJobFinished?: WorkbenchExecutionDagJobHook;
}

interface RunningJob {
  promise: Promise<void>;
}

const RESOURCE_EPSILON = 1e-9;

export async function runWorkbenchExecutionDag(
  args: WorkbenchExecutionDagRunInput,
): Promise<WorkbenchExecutionDagResult> {
  assertPositiveCapacity(args.capacity);
  const now = args.now ?? (() => new Date().toISOString());
  const jobsById = new Map<string, WorkbenchExecutionJob>();
  const pending = new Map<string, WorkbenchExecutionJob>();
  const terminal = new Map<string, WorkbenchExecutionJob>();
  const running = new Map<string, RunningJob>();
  const dependencies = new Map<string, string[]>();
  const results = new Map<string, WorkbenchExecutionJob>();
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
    if (isWorkbenchJobStatusTerminal(job.status)) {
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
      if (await args.shouldCancelJob?.(job)) {
        await cancelPendingJob(job, "canceled", "Run cancellation requested.");
        progressed = true;
        continue;
      }
      pending.delete(job.id);
      activeCost = addCapacity(activeCost, cost);
      const startedAt = now();
      const runningJob: WorkbenchExecutionJob = {
        ...job,
        status: "running",
        startedAt,
        updatedAt: startedAt,
      };
      startedJobCount += 1;
      maxConcurrency = Math.max(maxConcurrency, running.size + 1);
      await runJobHook(args.onJobStarted, runningJob);
      const abortController = new AbortController();
      const promise = finishJob(runningJob, cost, abortController);
      running.set(job.id, { promise });
      progressed = true;
    }
    return progressed;
  }

  function readyPendingJobs(): WorkbenchExecutionJob[] {
    return [...pending.values()].filter((job) => dependencyTerminalStatus(job) === "ready");
  }

  async function cancelTerminalBlockedPendingJobs(): Promise<boolean> {
    let cancelled = false;
    for (const job of [...pending.values()]) {
      const dependencyStatus = dependencyTerminalStatus(job);
      if (dependencyStatus !== "failed" && dependencyStatus !== "canceled") {
        continue;
      }
      await cancelPendingJob(job, dependencyStatus);
      cancelled = true;
    }
    return cancelled;
  }

  function dependencyTerminalStatus(job: WorkbenchExecutionJob): "ready" | "blocked" | "failed" | "canceled" {
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
      if (dependency.status === "canceled") {
        return "canceled";
      }
      if (dependency.status !== "succeeded") {
        blocked = true;
      }
    }
    return blocked ? "blocked" : "ready";
  }

  async function cancelPendingJob(
    job: WorkbenchExecutionJob,
    dependencyStatus: "failed" | "canceled",
    reason?: string,
  ): Promise<void> {
    pending.delete(job.id);
    const finishedAt = now();
    const cancelled: WorkbenchExecutionJob = {
      ...job,
      status: "canceled",
      updatedAt: finishedAt,
      finishedAt,
      error: reason ?? `Dependency ${dependencyStatus}.`,
    };
    cancelledJobCount += 1;
    terminal.set(job.id, cancelled);
    results.set(job.id, cancelled);
    await runJobHook(args.onJobFinished, cancelled);
  }

  async function finishJob(
    runningJob: WorkbenchExecutionJob,
    cost: WorkbenchExecutionDagCapacity,
    abortController: AbortController,
  ): Promise<void> {
    let completed: WorkbenchExecutionJob;
    const stopCancellationWatcher = watchRunningJobCancellation(runningJob, abortController);
    try {
      completed = await args.executeJob(runningJob, { signal: abortController.signal });
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
      stopCancellationWatcher();
      activeCost = subtractCapacity(activeCost, cost);
      running.delete(runningJob.id);
    }
    if (abortController.signal.aborted) {
      const finishedAt = completed.finishedAt ?? now();
      completed = {
        ...completed,
        status: "canceled",
        updatedAt: finishedAt,
        finishedAt,
        error: completed.error ?? "Run cancellation requested.",
      };
      cancelledJobCount += 1;
    }
    terminal.set(runningJob.id, completed);
    results.set(runningJob.id, completed);
    await runJobHook(args.onJobFinished, completed);
  }

  function watchRunningJobCancellation(
    runningJob: WorkbenchExecutionJob,
    abortController: AbortController,
  ): () => void {
    if (!args.shouldCancelJob) {
      return () => {};
    }
    let stopped = false;
    let checking = false;
    const check = async (): Promise<void> => {
      if (stopped || checking || abortController.signal.aborted) {
        return;
      }
      checking = true;
      try {
        if (await args.shouldCancelJob?.(runningJob)) {
          abortController.abort();
        }
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(() => {
      void check();
    }, 250);
    void check();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }
}

async function runJobHook(
  hook: WorkbenchExecutionDagJobHook | undefined,
  job: WorkbenchExecutionJob,
): Promise<void> {
  if (!hook) {
    return;
  }
  await hook(job);
}

export function workbenchJobDependencies(job: WorkbenchExecutionJob): string[] {
  const input = jsonRecord(job.input);
  const dependsOn = input.dependsOn;
  return Array.isArray(dependsOn)
    ? dependsOn.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function workbenchJobResources(
  job: WorkbenchExecutionJob,
): SandboxBackendRequestedResources {
  const resources = jsonRecord(jsonRecord(jsonRecord(job.input).execution).policy).resources;
  const record = jsonRecord(resources);
  return {
    cpu: readPositiveResource(record.cpu, job.id, "resources.cpu"),
    memoryGb: readPositiveResource(record.memoryGb, job.id, "resources.memoryGb"),
    diskGb: readPositiveResource(record.diskGb, job.id, "resources.diskGb"),
    timeoutMinutes: readPositiveResource(record.timeoutMinutes, job.id, "resources.timeoutMinutes"),
  };
}

export function workbenchJobHostCost(
  job: WorkbenchExecutionJob,
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

function formatCapacity(capacity: WorkbenchExecutionDagCapacity): string {
  return `${capacity.cpu} CPU, ${capacity.memoryGb} GiB memory, ${capacity.diskGb} GiB disk`;
}
