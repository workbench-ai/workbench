import type {
  BenchmarkSnapshot,
  CandidateSummary,
  EvaluationSummary,
  RunSummary,
} from "../types";

export interface WorkbenchRunCounts {
  queued: number;
  running: number;
  finished: number;
  ok: number;
  error: number;
  cancelled: number;
}

export interface CandidateRuntimeState {
  candidateId: string;
  runs: RunSummary[];
  activeRuns: RunSummary[];
  latestRun: RunSummary | null;
  label: string | null;
  active: boolean;
}

export type EvaluationRuntimeRow =
  | {
      kind: "evaluation";
      rowId: string;
      evaluation: EvaluationSummary;
      run: RunSummary | null;
      benchmarkFingerprint: string;
      candidateId: string;
      runId: string;
      createdAt: string;
      updatedAt: string;
      statusLabel: string;
    }
  | {
      kind: "run";
      rowId: string;
      evaluation: null;
      run: RunSummary;
      benchmarkFingerprint: string;
      candidateId: string;
      runId: string;
      createdAt: string;
      updatedAt: string;
      statusLabel: string;
    };

export interface WorkbenchRuntimeState {
  activeRuns: RunSummary[];
  recentRuns: RunSummary[];
  runById: Map<string, RunSummary>;
  runCounts: WorkbenchRunCounts;
  candidateStateById: Map<string, CandidateRuntimeState>;
  evaluationRows: EvaluationRuntimeRow[];
  hasActiveWork: boolean;
  lastUpdatedAt: string | null;
}

export function buildWorkbenchRuntimeState(
  snapshot: BenchmarkSnapshot | null,
): WorkbenchRuntimeState {
  const runs = snapshot?.runs ?? [];
  const runById = new Map(runs.map((run) => [run.id, run]));
  const runCounts = buildRunCounts(runs);
  const activeRuns = orderRunsMostRecent(runs.filter(isActiveRun));
  const recentRuns = orderRunsMostRecent(runs);
  const candidateStateById = buildCandidateRuntimeStateById(
    snapshot?.summaries ?? [],
    runs,
  );

  return {
    activeRuns,
    recentRuns,
    runById,
    runCounts,
    candidateStateById,
    evaluationRows: buildEvaluationRuntimeRows(snapshot?.evaluations ?? [], runs),
    hasActiveWork: activeRuns.length > 0,
    lastUpdatedAt: latestRuntimeTimestamp(snapshot),
  };
}

export function isActiveRun(run: Pick<RunSummary, "status">): boolean {
  return run.status === "queued" || run.status === "running";
}

export function runDisplayStatus(run: RunSummary): "queued" | "running" | "completed" | "error" | "cancelled" {
  if (run.status === "queued" || run.status === "running") {
    return run.status;
  }
  if (run.outcome === "error" || run.outcome === "cancelled") {
    return run.outcome;
  }
  return "completed";
}

export function runStatusLabel(run: RunSummary): string {
  const status = runDisplayStatus(run);
  if (status === "completed") {
    return run.workflow === "eval" ? "eval completed" : "improve completed";
  }
  if (status === "queued") {
    return run.workflow === "eval" ? "eval queued" : "improve queued";
  }
  if (status === "running") {
    return run.workflow === "eval" ? "eval running" : "improve running";
  }
  return run.workflow === "eval" ? `eval ${status}` : `improve ${status}`;
}

export function formatRunPolicyText(
  run: Pick<RunSummary, "optimizeOn" | "selectBy"> | null | undefined,
): string | null {
  if (!run || (!run.optimizeOn && !run.selectBy)) {
    return null;
  }
  return [
    run.optimizeOn ? `Optimize on ${run.optimizeOn}` : null,
    run.selectBy ? `Select winner by ${run.selectBy}` : null,
  ].filter(Boolean).join(" · ");
}

export function activeRunSummaryLabel(activeRuns: readonly RunSummary[]): string {
  if (activeRuns.length === 0) {
    return "No active runs";
  }
  const running = activeRuns.filter((run) => run.status === "running").length;
  const queued = activeRuns.filter((run) => run.status === "queued").length;
  if (running > 0 && queued > 0) {
    return `${running} running, ${queued} queued`;
  }
  if (running > 0) {
    return `${running} running`;
  }
  return `${queued} queued`;
}

function buildRunCounts(runs: readonly RunSummary[]): WorkbenchRunCounts {
  const counts: WorkbenchRunCounts = {
    queued: 0,
    running: 0,
    finished: 0,
    ok: 0,
    error: 0,
    cancelled: 0,
  };
  for (const run of runs) {
    if (run.status === "queued") {
      counts.queued += 1;
    } else if (run.status === "running") {
      counts.running += 1;
    } else {
      counts.finished += 1;
      if (run.outcome === "error") {
        counts.error += 1;
      } else if (run.outcome === "cancelled") {
        counts.cancelled += 1;
      } else {
        counts.ok += 1;
      }
    }
  }
  return counts;
}

function buildCandidateRuntimeStateById(
  candidates: readonly CandidateSummary[],
  runs: readonly RunSummary[],
): Map<string, CandidateRuntimeState> {
  const stateById = new Map<string, CandidateRuntimeState>();
  for (const candidate of candidates) {
    stateById.set(candidate.id, {
      candidateId: candidate.id,
      runs: [],
      activeRuns: [],
      latestRun: null,
      label: null,
      active: false,
    });
  }

  for (const run of runs) {
    for (const candidateId of candidateIdsForRun(run)) {
      const current = stateById.get(candidateId) ?? {
        candidateId,
        runs: [],
        activeRuns: [],
        latestRun: null,
        label: null,
        active: false,
      };
      current.runs.push(run);
      if (isActiveRun(run)) {
        current.activeRuns.push(run);
      }
      if (!current.latestRun || compareRunRecency(run, current.latestRun) < 0) {
        current.latestRun = run;
      }
      stateById.set(candidateId, current);
    }
  }

  for (const state of stateById.values()) {
    state.runs = orderRunsMostRecent(state.runs);
    state.activeRuns = orderRunsMostRecent(state.activeRuns);
    state.latestRun = state.runs[0] ?? null;
    state.active = state.activeRuns.length > 0;
    state.label = candidateRuntimeLabel(state);
  }

  return stateById;
}

function candidateIdsForRun(run: RunSummary): string[] {
  return uniqueStrings([
    run.candidateId ?? null,
    run.outputCandidateId ?? null,
  ]);
}

function candidateRuntimeLabel(state: CandidateRuntimeState): string | null {
  if (state.activeRuns.length === 0) {
    return state.latestRun ? runStatusLabel(state.latestRun) : null;
  }
  if (state.activeRuns.length === 1) {
    return runStatusLabel(state.activeRuns[0]!);
  }
  return activeRunSummaryLabel(state.activeRuns);
}

function buildEvaluationRuntimeRows(
  evaluations: readonly EvaluationSummary[],
  runs: readonly RunSummary[],
): EvaluationRuntimeRow[] {
  const runById = new Map(runs.map((run) => [run.id, run]));
  const evaluationRunIds = new Set(evaluations.map((evaluation) => evaluation.runId));
  const rows: EvaluationRuntimeRow[] = evaluations.map((evaluation) => ({
    kind: "evaluation",
    rowId: `evaluation:${evaluation.id}`,
    evaluation,
    run: runById.get(evaluation.runId) ?? null,
    benchmarkFingerprint: evaluation.benchmarkFingerprint,
    candidateId: evaluation.candidateId,
    runId: evaluation.runId,
    createdAt: evaluation.createdAt,
    updatedAt: evaluation.updatedAt,
    statusLabel: evaluation.status,
  }));

  for (const run of runs) {
    if (evaluationRunIds.has(run.id) || !shouldShowRunAsEvaluationRow(run)) {
      continue;
    }
    const candidateId = run.outputCandidateId ?? run.candidateId;
    if (!candidateId) {
      continue;
    }
    rows.push({
      kind: "run",
      rowId: `run:${run.id}`,
      evaluation: null,
      run,
      benchmarkFingerprint: run.benchmarkFingerprint,
      candidateId,
      runId: run.id,
      createdAt: run.startedAt,
      updatedAt: run.finishedAt ?? run.startedAt,
      statusLabel: runStatusLabel(run),
    });
  }

  return rows.sort(compareEvaluationRuntimeRows);
}

function shouldShowRunAsEvaluationRow(run: RunSummary): boolean {
  if (isActiveRun(run)) {
    return true;
  }
  return run.status === "finished" && (run.outcome === "error" || run.outcome === "cancelled");
}

function compareEvaluationRuntimeRows(
  left: EvaluationRuntimeRow,
  right: EvaluationRuntimeRow,
): number {
  const updatedOrder = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedOrder !== 0) {
    return updatedOrder;
  }
  return right.rowId.localeCompare(left.rowId);
}

function latestRuntimeTimestamp(snapshot: BenchmarkSnapshot | null): string | null {
  const timestamps = [
    ...(snapshot?.summaries ?? []).map((candidate) => candidate.createdAt),
    ...(snapshot?.evaluations ?? []).map((evaluation) => evaluation.updatedAt),
    ...(snapshot?.runs ?? []).map((run) => run.finishedAt ?? run.startedAt),
  ].filter(Boolean);
  return timestamps.sort().at(-1) ?? null;
}

function orderRunsMostRecent(runs: readonly RunSummary[]): RunSummary[] {
  return runs.slice().sort(compareRunRecency);
}

function compareRunRecency(left: RunSummary, right: RunSummary): number {
  const leftTime = left.finishedAt ?? left.startedAt;
  const rightTime = right.finishedAt ?? right.startedAt;
  const timeOrder = rightTime.localeCompare(leftTime);
  if (timeOrder !== 0) {
    return timeOrder;
  }
  return right.id.localeCompare(left.id);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
