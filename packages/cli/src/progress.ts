import {
  isWorkbenchJobStatusTerminal,
  isWorkbenchRunStatusTerminal,
  workbenchOperationStepsForRunKind,
  workbenchJobReportTotalCostUsd,
  workbenchJobScore,
  type WorkbenchJob,
  type WorkbenchOperationRequest,
  type WorkbenchRun,
  type WorkbenchRunPhase,
  type WorkbenchRunSnapshot,
  type WorkbenchTrace,
} from "@workbench-ai/workbench-contract";
import { createWorkbenchRunSnapshot } from "@workbench-ai/workbench-core";

import { formatCostUsd } from "./human-format.js";

export type WorkbenchProgressCommand = "run" | "grade" | "eval" | "improve" | "watch" | "retry";
export type WorkbenchProgressPhase =
  | "preflight"
  | "provider_auth"
  | "sync"
  | "queued"
  | "running"
  | "canceling"
  | "improving"
  | "applying_patch"
  | "proof_eval"
  | "complete";

export interface ProgressEvidenceCounts {
  artifacts?: number;
  traces?: number;
  sessions?: number;
  resultFiles?: number;
}

interface ProgressRenderer {
  render(
    snapshot: WorkbenchRunSnapshot | undefined,
    options?: { force?: boolean; command?: WorkbenchProgressCommand },
  ): void;
}

interface RunProgressSnapshotInput {
  command: WorkbenchProgressCommand;
  phase: WorkbenchProgressPhase;
  location: "local" | "cloud";
  runs: readonly WorkbenchRun[];
  jobs: readonly WorkbenchJob[];
  traces?: readonly WorkbenchTrace[];
  startedAtMs: number;
  nowMs?: number;
  evidence?: ProgressEvidenceCounts;
  next?: string | null;
}

export function runProgressSnapshotFromRuns(input: RunProgressSnapshotInput): WorkbenchRunSnapshot | undefined {
  if (input.runs.length === 0) {
    return undefined;
  }
  const request = progressOperationRequest(input);
  if (!request) {
    return undefined;
  }
  const jobs = progressJobs(input.command, input.phase, input.jobs);
  const nowMs = input.nowMs ?? (input.phase === "complete" || input.runs.every((run) => isWorkbenchRunStatusTerminal(run.status))
    ? terminalProgressObservedAtMs("complete", input.runs, jobs)
    : undefined) ?? Date.now();
  const base = createWorkbenchRunSnapshot(request, input.runs, {
    jobs,
    traces: input.traces ?? [],
    now: new Date(nowMs).toISOString(),
  });
  const phase = runSnapshotPhase(input.phase, base.phase);
  const status = runSnapshotStatus(input, base);
  const measurements = status === "running" && base.status === "queued"
    ? base.measurements.map((measurement) =>
      measurement.status === "queued" ? { ...measurement, status } : measurement
    )
    : base.measurements;
  const elapsedMs = Math.max(0, nowMs - input.startedAtMs);
  const { next: baseNext, ...baseWithoutNext } = base;
  const partialScore = progressPartialScore(base, jobs);
  const evidenceCount = progressEvidenceCount(input.evidence);
  const next = progressSnapshotNext(input.next, baseNext, base);
  return {
    ...baseWithoutNext,
    status,
    phase,
    measurements,
    progress: {
      ...base.progress,
      ...(partialScore !== undefined ? { partialScore } : {}),
      ...(evidenceCount !== undefined ? { evidenceCount } : {}),
      elapsedMs,
    },
    ...(next ? { next } : {}),
  };
}

function runSnapshotStatus(
  input: RunProgressSnapshotInput,
  base: WorkbenchRunSnapshot,
): WorkbenchRunSnapshot["status"] {
  if (
    input.location === "cloud" &&
    base.status === "queued" &&
    (input.phase === "preflight" || input.phase === "provider_auth" || input.phase === "sync")
  ) {
    return "running";
  }
  return base.status;
}

function progressSnapshotNext(
  next: string | null | undefined,
  defaultNext: string | undefined,
  base: WorkbenchRunSnapshot,
): string | undefined {
  if (next === null) {
    return undefined;
  }
  const selected = next ?? defaultNext;
  if ((base.status === "failed" || base.status === "canceled") && /^workbench\s+show\b/u.test(selected ?? "")) {
    return undefined;
  }
  return selected;
}

export function createProgressRenderer(input: {
  stderr: Pick<NodeJS.WritableStream, "write">;
  heartbeatMs?: number;
  json?: boolean;
}): ProgressRenderer {
  const heartbeatMs = input.heartbeatMs ?? 60_000;
  let last: WorkbenchRunSnapshot | undefined;
  let lastPrintedAtMs: number | undefined;
  let queuedGuidanceRunId: string | undefined;
  let inspectionGuidanceKey: string | undefined;
  return {
    render(snapshot, options = {}) {
      if (!snapshot) {
        return;
      }
      const reason = progressRenderReason(last, snapshot, lastPrintedAtMs, heartbeatMs, options.force === true);
      if (!reason) {
        return;
      }
      if (input.json === true) {
        input.stderr.write(`${JSON.stringify(snapshot)}\n`);
        last = snapshot;
        lastPrintedAtMs = snapshot.progress.elapsedMs;
        return;
      }
      const command = options.command ?? progressCommandForSnapshot(snapshot);
      input.stderr.write(`${formatProgressSnapshot(snapshot, command)}\n`);
      if (snapshot.variant === "cloud" && snapshot.phase === "queued") {
        if (reason === "heartbeat" || queuedGuidanceRunId !== snapshot.id) {
          input.stderr.write(`${formatQueuedCloudGuidance(command, snapshot.id)}\n`);
          queuedGuidanceRunId = snapshot.id;
        }
      }
      if (isInspectablePhase(snapshot.phase)) {
        const guidanceKey = `${snapshot.variant}:${snapshot.id}`;
        if (reason === "heartbeat" || inspectionGuidanceKey !== guidanceKey) {
          input.stderr.write(`${formatInspectableGuidance(command, snapshot.id, snapshot.variant)}\n`);
          inspectionGuidanceKey = guidanceKey;
        }
      }
      last = snapshot;
      lastPrintedAtMs = snapshot.progress.elapsedMs;
    },
  };
}

export function formatProgressSnapshot(
  snapshot: WorkbenchRunSnapshot,
  command: WorkbenchProgressCommand = progressCommandForSnapshot(snapshot),
): string {
  const parts = formatProgressSummaryParts(snapshot);
  return `${workbenchOperationInvocation(command)}: ${parts.join(", ")}.`;
}

export function formatProgressSummary(
  snapshot: WorkbenchRunSnapshot,
): string {
  return formatProgressSummaryParts(snapshot).join(", ");
}

function formatQueuedCloudGuidance(command: WorkbenchProgressCommand, runId: string): string {
  return `${workbenchOperationInvocation(command)}: queued runs are waiting for a hosted worker; press Ctrl-C to detach and resume with workbench watch ${runId}.`;
}

function formatInspectableGuidance(
  command: WorkbenchProgressCommand,
  runId: string,
  location: "local" | "cloud",
): string {
  if (location === "cloud") {
    return `${workbenchOperationInvocation(command)}: press Ctrl-C to detach; resume with workbench watch ${runId}.`;
  }
  return `${workbenchOperationInvocation(command)}: inspect current evidence with workbench eval show ${runId}.`;
}

export function workbenchOperationInvocation(command: WorkbenchProgressCommand): string {
  if (command === "grade") return "workbench eval grade";
  if (command === "improve") return "workbench skill improve";
  if (command === "run" || command === "eval") return "workbench eval run";
  return `workbench ${command}`;
}

function formatProgressDuration(elapsedMs: number): string {
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

function progressOperationRequest(input: RunProgressSnapshotInput): WorkbenchOperationRequest | undefined {
  const firstRun = input.runs[0];
  if (!firstRun) {
    return undefined;
  }
  const storedPlan = firstRun.operationPlan;
  const kind = storedPlan?.kind ?? firstRun.kind;
  if (kind === "improve") {
    return {
      kind: "improve",
      variant: storedPlan?.variant ?? input.location,
      target: {
        ...(storedPlan?.versionId ?? firstRun.versionId ? { versionId: storedPlan?.versionId ?? firstRun.versionId } : {}),
        skill: storedPlan?.skills[0] ?? firstRun.skillName,
        agent: storedPlan?.agents[0] ?? firstRun.agentName,
      },
      versionId: storedPlan?.versionId ?? firstRun.versionId,
      evalHash: storedPlan?.evalHash ?? firstRun.evalHash,
      ...(storedPlan?.samples !== undefined ? { samples: storedPlan.samples } : firstRun.requestedSamples !== undefined ? { samples: firstRun.requestedSamples } : {}),
      ...(storedPlan?.budget !== undefined ? { budget: storedPlan.budget } : firstRun.requestedBudget !== undefined ? { budget: firstRun.requestedBudget } : {}),
      ...(storedPlan?.retryOfRunId ? { retryOfRunId: storedPlan.retryOfRunId } : firstRun.retryOfRunId ? { retryOfRunId: firstRun.retryOfRunId } : {}),
    };
  }
  const steps = storedPlan?.steps ?? workbenchOperationStepsForRunKind(kind);
  return {
    kind: "eval",
    variant: storedPlan?.variant ?? input.location,
    caseIds: storedPlan?.caseIds ?? [],
    targets: storedPlan?.targets ?? [...new Set(input.runs.map((run) => run.agentName))].map((agent) => ({
      ...(storedPlan?.versionId ?? firstRun.versionId ? { versionId: storedPlan?.versionId ?? firstRun.versionId } : {}),
      ...(storedPlan?.skills[0] ?? firstRun.skillName ? { skill: storedPlan?.skills[0] ?? firstRun.skillName } : {}),
      agent,
    })),
    steps,
    ...(storedPlan?.samples !== undefined ? { samples: storedPlan.samples } : firstRun.requestedSamples !== undefined ? { samples: firstRun.requestedSamples } : {}),
    ...(storedPlan?.rerun ? { rerun: true } : {}),
    ...(storedPlan?.retryOfRunId ? { retryOfRunId: storedPlan.retryOfRunId } : firstRun.retryOfRunId ? { retryOfRunId: firstRun.retryOfRunId } : {}),
  };
}

function runSnapshotPhase(
  phase: WorkbenchProgressPhase,
  fallback: WorkbenchRunPhase,
): WorkbenchRunPhase {
  if (phase === "preflight" || phase === "provider_auth") {
    return "planning";
  }
  if (fallback === "complete" && phase !== "sync") {
    return "complete";
  }
  if (fallback === "queued" && phase !== "sync") {
    return "queued";
  }
  if (phase === "sync") {
    return "syncing";
  }
  if (phase === "applying_patch") {
    return "materializing";
  }
  if (phase === "proof_eval") {
    return "proof";
  }
  if (phase === "queued") {
    return "queued";
  }
  if (phase === "running") {
    return "running";
  }
  if (phase === "improving") {
    return "improving";
  }
  if (phase === "complete") {
    return "complete";
  }
  return fallback;
}

function progressJobs(
  command: WorkbenchProgressCommand,
  phase: WorkbenchProgressPhase,
  jobs: readonly WorkbenchJob[],
): WorkbenchJob[] {
  if (!isImproveProgress(command, jobs)) {
    return jobs.filter((job) => job.caseId !== "current");
  }
  if (phase !== "proof_eval" && phase !== "complete" && phase !== "sync") {
    return jobs.filter((job) => job.caseId === "current");
  }
  return jobs.filter((job) => job.caseId !== "current");
}

function progressPartialScore(base: WorkbenchRunSnapshot, jobs: readonly WorkbenchJob[]): number | undefined {
  if (base.status !== "queued" && base.status !== "running" && base.status !== "canceling") {
    return undefined;
  }
  const scoredJobs = jobs.filter((job) => workbenchJobScore(job) !== undefined);
  if (scoredJobs.length > 0) {
    return Number((scoredJobs.reduce((sum, job) => sum + (workbenchJobScore(job) ?? 0), 0) / scoredJobs.length).toFixed(3));
  }
  if (typeof base.result?.score === "number") {
    return base.result.score;
  }
  return undefined;
}

function progressEvidenceCount(evidence: ProgressEvidenceCounts | undefined): number | undefined {
  if (!evidence) {
    return undefined;
  }
  const count = (evidence.artifacts ?? 0) +
    (evidence.traces ?? 0) +
    (evidence.sessions ?? 0) +
    (evidence.resultFiles ?? 0);
  return count > 0 ? count : undefined;
}

function isImproveProgress(command: WorkbenchProgressCommand, jobs: readonly WorkbenchJob[]): boolean {
  return command === "improve" || jobs.some((job) => job.kind === "improve");
}

function progressRenderReason(
  previous: WorkbenchRunSnapshot | undefined,
  next: WorkbenchRunSnapshot,
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
  if (lastPrintedAtMs !== undefined && next.progress.elapsedMs - lastPrintedAtMs >= heartbeatMs) {
    return "heartbeat";
  }
  return null;
}

function progressSignature(snapshot: WorkbenchRunSnapshot): string {
  const { elapsedMs: _elapsedMs, lastProgressAt: _lastProgressAt, ...stableProgress } = snapshot.progress;
  const { elapsedMs: _reportElapsedMs, ...stableReport } = snapshot.report;
  return JSON.stringify({
    id: snapshot.id,
    kind: snapshot.kind,
    variant: snapshot.variant,
    status: snapshot.status,
    phase: snapshot.phase,
    progress: stableProgress,
    report: stableReport,
    result: snapshot.result,
    next: snapshot.next,
  });
}

function progressCommandForSnapshot(snapshot: WorkbenchRunSnapshot): WorkbenchProgressCommand {
  return snapshot.kind === "improve" ? "improve" : snapshot.kind === "grade" ? "grade" : snapshot.kind === "run" ? "run" : "eval";
}

function isInspectablePhase(phase: WorkbenchRunPhase): boolean {
  return phase === "running" || phase === "improving" || phase === "proof";
}

function formatProgressSummaryParts(snapshot: WorkbenchRunSnapshot): string[] {
  return [
    progressPhaseText(snapshot),
    ...progressCounterParts(snapshot),
    ...activeProgressParts(snapshot),
    ...evidenceProgressParts(snapshot),
    ...usageProgressParts(snapshot),
    `wall time ${formatProgressDuration(snapshot.progress.elapsedMs)}`,
  ];
}

function progressPhaseText(snapshot: WorkbenchRunSnapshot): string {
  switch (snapshot.phase) {
    case "planning":
      return snapshot.variant === "cloud" ? "preparing Workbench Cloud run" : "preflight";
    case "queued":
      return snapshot.variant === "cloud" ? "queued on Workbench Cloud" : "queued";
    case "syncing":
      return snapshot.variant === "cloud" ? "sync with Workbench Cloud" : "sync";
    case "running":
      return "running";
    case "improving":
      return "running improvement adapter";
    case "proof":
      return "proof eval running";
    case "materializing":
      return "applying patch";
    case "canceling":
      return "canceling";
    case "complete":
      return "complete";
  }
}

function progressCounterParts(snapshot: WorkbenchRunSnapshot): string[] {
  const progress = snapshot.progress;
  const parts: Array<string | undefined> = [];
  if (progress.planned > 0) {
    parts.push(`jobs ${progress.completed}/${progress.planned} complete`);
    if (snapshot.phase !== "complete" && progress.completed < progress.planned) {
      parts.push(`remaining ${progress.planned - progress.completed}`);
    }
  }
  if (progress.scored > 0) {
    parts.push(`scored ${progress.scored}`);
  }
  if (progress.partialScore !== undefined) {
    const label = snapshot.kind === "improve" || snapshot.phase === "proof" ? "partial proof score" : "partial score";
    parts.push(`${label} ${formatScore(progress.partialScore)}`);
  }
  if (progress.planned > 0 || progress.failed > 0) {
    parts.push(`failed ${progress.failed}`);
  }
  if (progress.canceled > 0) {
    parts.push(`canceled ${progress.canceled}`);
  }
  return parts.filter((entry): entry is string => Boolean(entry));
}

function activeProgressParts(snapshot: WorkbenchRunSnapshot): string[] {
  const active = snapshot.progress.active;
  if (!active) {
    return [];
  }
  const details = [
    active.caseId ? `case=${active.caseId}` : undefined,
    active.sample !== undefined ? `sample=${active.sample}` : undefined,
    `job=${active.jobId}`,
  ].filter((entry): entry is string => Boolean(entry));
  return [
    `active ${details.join(" ")}`,
    ...(active.runningCount > 1 ? [`running=${active.runningCount}`] : []),
  ];
}

function evidenceProgressParts(snapshot: WorkbenchRunSnapshot): string[] {
  const evidenceCount = snapshot.progress.evidenceCount;
  return evidenceCount && evidenceCount > 0 ? [`evidence ${evidenceCount}`] : [];
}

function usageProgressParts(snapshot: WorkbenchRunSnapshot): string[] {
  const costUsd = workbenchJobReportTotalCostUsd(snapshot.report);
  return costUsd !== undefined ? [`cost=${formatCostUsd(costUsd)} total`] : [];
}

function terminalProgressObservedAtMs(
  phase: WorkbenchRunPhase,
  runs: readonly WorkbenchRun[],
  jobs: readonly WorkbenchJob[],
): number | undefined {
  if (phase !== "complete") {
    return undefined;
  }
  const timestamps = [
    ...runs.flatMap((run) => [
      run.finishedAt,
      isWorkbenchRunStatusTerminal(run.status) ? run.lastProgressAt : undefined,
    ]),
    ...jobs.filter((job) => isWorkbenchJobStatusTerminal(job.status)).flatMap((job) => [
      job.finishedAt,
      job.startedAt,
    ]),
  ]
    .map((value) => value === undefined ? undefined : timestampMs(value))
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => right - left);
  return timestamps[0];
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function formatScore(score: number): string {
  return score.toFixed(3);
}
