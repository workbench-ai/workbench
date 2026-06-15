import type {
  WorkbenchJob,
  WorkbenchRun,
} from "@workbench-ai/workbench-contract";

export type WorkbenchProgressCommand = "eval" | "improve";
export type WorkbenchProgressPhase =
  | "preflight"
  | "provider_auth"
  | "sync"
  | "queued"
  | "running"
  | "improving"
  | "applying_patch"
  | "proof_eval"
  | "complete";

export interface ProgressSnapshot {
  command: WorkbenchProgressCommand;
  phase: WorkbenchProgressPhase;
  location: "local" | "cloud";
  runIds: string[];
  active?: ProgressActiveWork;
  casesTotal?: number;
  casesDone?: number;
  samplesTotal?: number;
  samplesDone?: number;
  failed?: number;
  elapsedMs: number;
}

interface ProgressActiveWork {
  jobId: string;
  caseId: string;
  sample: number;
  runningCount: number;
}

export interface ProgressSnapshotInput {
  command: WorkbenchProgressCommand;
  phase: WorkbenchProgressPhase;
  location: "local" | "cloud";
  runs: readonly WorkbenchRun[];
  jobs: readonly WorkbenchJob[];
  startedAtMs: number;
  nowMs?: number;
}

export interface ProgressRenderer {
  render(snapshot: ProgressSnapshot, options?: { force?: boolean }): void;
}

export function progressSnapshotFromRuns(input: ProgressSnapshotInput): ProgressSnapshot {
  const nowMs = input.nowMs ?? Date.now();
  const runIds = input.runs.map((run) => run.id);
  const runIdSet = new Set(runIds);
  const jobsForRuns = input.jobs.filter((job) => runIdSet.has(job.runId));
  const phase = progressPhaseForRuns(input.phase, input.runs, jobsForRuns);
  const counterJobs = progressCounterJobs(input.command, phase, jobsForRuns);
  const activeJobs = progressActiveJobs(input.command, phase, jobsForRuns, counterJobs);
  return {
    command: input.command,
    phase,
    location: input.location,
    runIds,
    ...progressActive(activeJobs),
    ...progressCounters(counterJobs),
    elapsedMs: Math.max(0, nowMs - input.startedAtMs),
  };
}

export function createProgressRenderer(input: {
  stderr: Pick<NodeJS.WritableStream, "write">;
  heartbeatMs?: number;
}): ProgressRenderer {
  const heartbeatMs = input.heartbeatMs ?? 60_000;
  let last: ProgressSnapshot | undefined;
  let lastPrintedAtMs: number | undefined;
  let queuedGuidanceRunId: string | undefined;
  let inspectionGuidanceKey: string | undefined;
  return {
    render(snapshot, options = {}) {
      const reason = progressRenderReason(last, snapshot, lastPrintedAtMs, heartbeatMs, options.force === true);
      if (!reason) {
        return;
      }
      input.stderr.write(`${formatProgressSnapshot(snapshot)}\n`);
      if (snapshot.location === "cloud" && snapshot.phase === "queued" && snapshot.runIds[0]) {
        if (reason === "heartbeat" || queuedGuidanceRunId !== snapshot.runIds[0]) {
          input.stderr.write(`${formatQueuedCloudGuidance(snapshot.command, snapshot.runIds[0])}\n`);
          queuedGuidanceRunId = snapshot.runIds[0];
        }
      }
      if (isInspectablePhase(snapshot.phase) && snapshot.runIds[0]) {
        const guidanceKey = `${snapshot.location}:${snapshot.runIds[0]}`;
        if (reason === "heartbeat" || inspectionGuidanceKey !== guidanceKey) {
          input.stderr.write(`${formatInspectableGuidance(snapshot.command, snapshot.runIds[0], snapshot.location)}\n`);
          inspectionGuidanceKey = guidanceKey;
        }
      }
      last = snapshot;
      lastPrintedAtMs = snapshot.elapsedMs;
    },
  };
}

export function formatProgressSnapshot(snapshot: ProgressSnapshot): string {
  const parts = [
    progressPhaseText(snapshot),
    ...progressCounterParts(snapshot),
    `elapsed ${formatElapsed(snapshot.elapsedMs)}`,
  ];
  return `workbench ${snapshot.command}: ${parts.join(", ")}.`;
}

export function formatQueuedCloudGuidance(command: WorkbenchProgressCommand, runId: string): string {
  return `workbench ${command}: queued runs are waiting for a hosted worker; press Ctrl-C to detach and resume with workbench show ${runId}.`;
}

export function formatInspectableGuidance(
  command: WorkbenchProgressCommand,
  runId: string,
  location: ProgressSnapshot["location"],
): string {
  if (location === "cloud") {
    return `workbench ${command}: press Ctrl-C to detach; inspect last local state with workbench show ${runId} and refresh later with workbench sync cloud.`;
  }
  return `workbench ${command}: inspect current evidence with workbench show ${runId}.`;
}

function isInspectablePhase(phase: WorkbenchProgressPhase): boolean {
  return phase === "running" || phase === "improving" || phase === "proof_eval";
}

function progressPhaseForRuns(
  phase: WorkbenchProgressPhase,
  runs: readonly WorkbenchRun[],
  jobs: readonly WorkbenchJob[],
): WorkbenchProgressPhase {
  if (phase === "preflight" || phase === "provider_auth" || phase === "sync") {
    return phase;
  }
  if (runs.length > 0 && runs.every(isTerminalRun)) {
    return "complete";
  }
  if (phase === "improving" || phase === "applying_patch" || phase === "proof_eval") {
    return phase;
  }
  if (runs.length > 0 && runs.every((run) => run.status === "queued") && jobs.every((job) => job.status === "queued")) {
    return "queued";
  }
  if (runs.length > 0) {
    return "running";
  }
  return phase;
}

function progressCounterJobs(
  command: WorkbenchProgressCommand,
  phase: WorkbenchProgressPhase,
  jobs: readonly WorkbenchJob[],
): WorkbenchJob[] {
  if (command !== "improve") {
    return [...jobs];
  }
  if (phase !== "proof_eval" && phase !== "complete") {
    return [];
  }
  return jobs.filter((job) => job.caseId !== "current");
}

function progressActiveJobs(
  command: WorkbenchProgressCommand,
  phase: WorkbenchProgressPhase,
  jobs: readonly WorkbenchJob[],
  counterJobs: readonly WorkbenchJob[],
): readonly WorkbenchJob[] {
  if (command === "improve" && (phase === "running" || phase === "improving" || phase === "applying_patch")) {
    return jobs;
  }
  return counterJobs;
}

function progressActive(jobs: readonly WorkbenchJob[]): Pick<ProgressSnapshot, "active"> {
  const runningJobs = jobs
    .filter((job) => job.status === "running")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const [active] = runningJobs;
  if (!active) {
    return {};
  }
  return {
    active: {
      jobId: active.id,
      caseId: active.caseId,
      sample: active.sample,
      runningCount: runningJobs.length,
    },
  };
}

function progressCounters(jobs: readonly WorkbenchJob[]): Partial<ProgressSnapshot> {
  if (jobs.length === 0) {
    return {};
  }
  let casesTotal = 0;
  let casesDone = 0;
  const jobsByRun = new Map<string, WorkbenchJob[]>();
  for (const job of jobs) {
    const existing = jobsByRun.get(job.runId) ?? [];
    existing.push(job);
    jobsByRun.set(job.runId, existing);
  }
  for (const runJobs of jobsByRun.values()) {
    const jobsByCase = new Map<string, WorkbenchJob[]>();
    for (const job of runJobs) {
      const existing = jobsByCase.get(job.caseId) ?? [];
      existing.push(job);
      jobsByCase.set(job.caseId, existing);
    }
    casesTotal += jobsByCase.size;
    for (const caseJobs of jobsByCase.values()) {
      if (caseJobs.every((job) => isTerminalJob(job))) {
        casesDone += 1;
      }
    }
  }
  return {
    casesTotal,
    casesDone,
    samplesTotal: jobs.length,
    samplesDone: jobs.filter(isTerminalJob).length,
    failed: jobs.filter((job) => job.status === "failed" || job.status === "canceled").length,
  };
}

function progressRenderReason(
  previous: ProgressSnapshot | undefined,
  next: ProgressSnapshot,
  lastPrintedAtMs: number | undefined,
  heartbeatMs: number,
  force: boolean,
): "changed" | "heartbeat" | null {
  if (force || !previous) {
    return "changed";
  }
  if (progressSignature(previous) !== progressSignature(next)) {
    return "changed";
  }
  if (lastPrintedAtMs !== undefined && next.elapsedMs - lastPrintedAtMs >= heartbeatMs) {
    return "heartbeat";
  }
  return null;
}

function progressSignature(snapshot: ProgressSnapshot): string {
  return JSON.stringify({
    command: snapshot.command,
    phase: snapshot.phase,
    location: snapshot.location,
    runIds: snapshot.runIds,
    casesDone: snapshot.casesDone,
    casesTotal: snapshot.casesTotal,
    samplesDone: snapshot.samplesDone,
    samplesTotal: snapshot.samplesTotal,
    failed: snapshot.failed,
    active: snapshot.active,
  });
}

function progressPhaseText(snapshot: ProgressSnapshot): string {
  switch (snapshot.phase) {
    case "preflight":
      return "preflight";
    case "provider_auth":
      return "checking provider auth";
    case "sync":
      return snapshot.location === "cloud" ? "sync with Workbench Cloud" : "sync";
    case "queued":
      return snapshot.location === "cloud" ? "queued on Workbench Cloud" : "queued";
    case "running":
      return "running";
    case "improving":
      return "running improvement adapter";
    case "applying_patch":
      return "applying patch";
    case "proof_eval":
      return "proof eval running";
    case "complete":
      return "complete";
  }
}

function progressCounterParts(snapshot: ProgressSnapshot): string[] {
  const parts: Array<string | undefined> = [];
  if (snapshot.samplesTotal === undefined || snapshot.samplesDone === undefined) {
    return activeProgressParts(snapshot);
  }
  parts.push(
    snapshot.casesTotal !== undefined && snapshot.casesDone !== undefined
      ? `cases ${snapshot.casesDone}/${snapshot.casesTotal}`
      : undefined,
    `samples ${snapshot.samplesDone}/${snapshot.samplesTotal} complete`,
    `failed ${snapshot.failed ?? 0}`,
  );
  parts.push(...activeProgressParts(snapshot));
  return parts.filter((entry): entry is string => Boolean(entry));
}

function activeProgressParts(snapshot: ProgressSnapshot): string[] {
  const active = snapshot.active;
  if (!active) {
    return [];
  }
  return [
    `active case=${active.caseId} sample=${active.sample + 1} job=${active.jobId}`,
    ...(active.runningCount > 1 ? [`running=${active.runningCount}`] : []),
  ];
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return remainderMinutes === 0 ? `${hours}h` : `${hours}h ${remainderMinutes}m`;
}

function isTerminalRun(run: WorkbenchRun): boolean {
  return run.status === "succeeded" || run.status === "failed" || run.status === "canceled";
}

function isTerminalJob(job: WorkbenchJob): boolean {
  return job.status === "succeeded" || job.status === "failed" || job.status === "canceled";
}
