import type {
  WorkbenchJob,
  WorkbenchRun,
} from "@workbench-ai/workbench-contract";

export type WorkbenchProgressCommand = "eval" | "improve";
export type WorkbenchProgressPhase =
  | "preflight"
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
  casesTotal?: number;
  casesDone?: number;
  samplesTotal?: number;
  samplesDone?: number;
  failed?: number;
  elapsedMs: number;
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
  return {
    command: input.command,
    phase,
    location: input.location,
    runIds,
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

function progressPhaseForRuns(
  phase: WorkbenchProgressPhase,
  runs: readonly WorkbenchRun[],
  jobs: readonly WorkbenchJob[],
): WorkbenchProgressPhase {
  if (runs.length > 0 && runs.every(isTerminalRun)) {
    return "complete";
  }
  if (phase === "preflight" || phase === "sync" || phase === "improving" || phase === "applying_patch" || phase === "proof_eval") {
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
  });
}

function progressPhaseText(snapshot: ProgressSnapshot): string {
  switch (snapshot.phase) {
    case "preflight":
      return "preflight";
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
  if (snapshot.samplesTotal === undefined || snapshot.samplesDone === undefined) {
    return [];
  }
  return [
    snapshot.casesTotal !== undefined && snapshot.casesDone !== undefined
      ? `cases ${snapshot.casesDone}/${snapshot.casesTotal}`
      : undefined,
    `samples ${snapshot.samplesDone}/${snapshot.samplesTotal} complete`,
    `failed ${snapshot.failed ?? 0}`,
  ].filter((entry): entry is string => Boolean(entry));
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
