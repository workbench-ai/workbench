import { describe, expect, test } from "vitest";

import {
  activeRunSummaryLabel,
  buildWorkbenchRuntimeState,
  formatRunPolicyText,
  runStatusLabel,
} from "../src/lib/runtime-state";
import type {
  BenchmarkSnapshot,
  CandidateSummary,
  EvaluationSummary,
  RunSummary,
} from "../src/types";

describe("runtime state", () => {
  test("surfaces active runs and candidate state from one snapshot", () => {
    const runningEval = runSummary({
      id: "run_eval",
      workflow: "eval",
      status: "running",
      candidateId: "candidate_a",
      startedAt: "2026-01-03T00:00:00.000Z",
    });
    const queuedImprove = runSummary({
      id: "run_improve",
      workflow: "improve",
      status: "queued",
      candidateId: "candidate_b",
      outputCandidateId: "candidate_c",
      startedAt: "2026-01-04T00:00:00.000Z",
    });

    const state = buildWorkbenchRuntimeState(snapshot({
      summaries: [
        candidateSummary("candidate_a"),
        candidateSummary("candidate_b"),
        candidateSummary("candidate_c", { status: "running" }),
      ],
      runs: [runningEval, queuedImprove],
    }));

    expect(state.hasActiveWork).toBe(true);
    expect(state.activeRuns.map((run) => run.id)).toEqual(["run_improve", "run_eval"]);
    expect(state.runCounts).toMatchObject({ queued: 1, running: 1, finished: 0 });
    expect(state.candidateStateById.get("candidate_a")?.label).toBe("eval running");
    expect(state.candidateStateById.get("candidate_c")?.label).toBe("improve queued");
    expect(activeRunSummaryLabel(state.activeRuns)).toBe("1 running, 1 queued");
  });

  test("adds active run rows to evaluations without duplicating completed scorecards", () => {
    const completedRun = runSummary({
      id: "run_completed",
      workflow: "eval",
      status: "finished",
      outcome: "ok",
      candidateId: "candidate_a",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z",
    });
    const activeRun = runSummary({
      id: "run_active",
      workflow: "eval",
      status: "running",
      candidateId: "candidate_a",
      startedAt: "2026-01-02T00:00:00.000Z",
    });
    const failedRun = runSummary({
      id: "run_failed",
      workflow: "improve",
      status: "finished",
      outcome: "error",
      candidateId: "candidate_b",
      outputCandidateId: "candidate_c",
      startedAt: "2026-01-03T00:00:00.000Z",
      finishedAt: "2026-01-03T00:02:00.000Z",
    });
    const evaluation = evaluationSummary({
      id: "eval_completed",
      runId: completedRun.id,
      candidateId: "candidate_a",
      updatedAt: "2026-01-01T00:01:00.000Z",
    });

    const state = buildWorkbenchRuntimeState(snapshot({
      evaluations: [evaluation],
      runs: [completedRun, activeRun, failedRun],
    }));

    expect(state.evaluationRows.map((row) => [row.kind, row.runId])).toEqual([
      ["run", "run_failed"],
      ["run", "run_active"],
      ["evaluation", "run_completed"],
    ]);
    expect(state.evaluationRows.filter((row) => row.runId === "run_completed")).toHaveLength(1);
    expect(state.evaluationRows[0]?.statusLabel).toBe("improve error");
    expect(state.evaluationRows[1]?.statusLabel).toBe("eval running");
  });

  test("does not attribute preserved active candidates to unrelated eval runs", () => {
    const run = runSummary({
      id: "run_eval",
      workflow: "eval",
      status: "running",
      candidateId: "candidate_eval",
      outputCandidateId: "candidate_eval",
      activeCandidateId: "candidate_active",
    });

    const state = buildWorkbenchRuntimeState(snapshot({
      summaries: [
        candidateSummary("candidate_active"),
        candidateSummary("candidate_eval"),
      ],
      runs: [run],
    }));

    expect(state.candidateStateById.get("candidate_active")?.active).toBe(false);
    expect(state.candidateStateById.get("candidate_eval")?.label).toBe("eval running");
    expect(state.evaluationRows).toMatchObject([{
      kind: "run",
      candidateId: "candidate_eval",
      runId: "run_eval",
    }]);
  });

  test("formats run labels from workflow and terminal outcome", () => {
    expect(runStatusLabel(runSummary({ workflow: "eval", status: "queued" }))).toBe("eval queued");
    expect(runStatusLabel(runSummary({ workflow: "improve", status: "running" }))).toBe("improve running");
    expect(runStatusLabel(runSummary({ workflow: "eval", status: "finished", outcome: "cancelled" })))
      .toBe("eval cancelled");
    expect(runStatusLabel(runSummary({ workflow: "improve", status: "finished", outcome: "ok" })))
      .toBe("improve completed");
  });

  test("formats split-aware improve policy text", () => {
    expect(formatRunPolicyText(runSummary({
      optimizeOn: "split=train",
      selectBy: "score on split=validation",
    }))).toBe("Optimize on split=train · Select winner by score on split=validation");
    expect(formatRunPolicyText(runSummary())).toBeNull();
  });
});

function snapshot(overrides: Partial<BenchmarkSnapshot> = {}): BenchmarkSnapshot {
  return {
    workspaceRoot: "workspace",
    activeId: null,
    currentBenchmarkFingerprint: "benchmark",
    summaries: [],
    evaluations: [],
    runs: [],
    ...overrides,
  };
}

function candidateSummary(
  id: string,
  overrides: Partial<CandidateSummary> = {},
): CandidateSummary {
  return {
    id,
    version: 1,
    ordinal: 1,
    benchmarkFingerprint: "benchmark",
    candidateFingerprint: `${id}-fingerprint`,
    createdAt: "2026-01-01T00:00:00.000Z",
    referenceIds: [],
    status: "evaluated",
    fileChanges: [],
    ...overrides,
  };
}

function evaluationSummary(
  overrides: Partial<EvaluationSummary> = {},
): EvaluationSummary {
  return {
    id: "eval",
    runId: "run",
    benchmarkFingerprint: "benchmark",
    candidateFingerprint: "candidate-fingerprint",
    candidateId: "candidate_a",
    candidateVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "completed",
    sampleCount: 1,
    completedSampleCount: 1,
    errorSampleCount: 0,
    ...overrides,
  };
}

function runSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "run",
    workflow: "eval",
    benchmarkFingerprint: "benchmark",
    status: "finished",
    startedAt: "2026-01-01T00:00:00.000Z",
    improver: "none",
    engineRun: "workbench",
    strategy: "direct",
    budget: 1,
    repairBudget: 0,
    attemptsRequested: 1,
    attemptsExecuted: 1,
    samples: 1,
    ...overrides,
  };
}
