import { describe, expect, test } from "vitest";

import {
  createWorkbenchInspection,
  type CandidateRecord,
  type EvaluationScorecard,
  type RemoteWorkbenchJob,
  type RunSummary,
  type RuntimeSnapshot,
  type SurfaceSnapshotFile,
  type WorkbenchExecutionTrace,
  type WorkbenchInspectionBackend,
} from "../src/index.ts";

describe("workbench inspection", () => {
  test("builds comparison and diagnosis from generic runtime facts", async () => {
    const inspection = createWorkbenchInspection(testBackend());

    const comparison = await inspection.evaluations();
    expect(comparison.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evaluationId: "eval_1",
        candidateId: "candidate_1",
        score: 0.72,
      }),
    ]));
    expect(comparison.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidateId: "candidate_1",
        bestEvaluationId: "eval_1",
        bestScore: 0.72,
      }),
    ]));
    expect(comparison.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "score",
        semanticRole: "performance",
      }),
    ]));

    await expect(inspection.diagnose()).resolves.toMatchObject({
      failedRunCount: 1,
      failedEvaluationCount: 1,
      failures: [
        { kind: "run", id: "run_failed", status: "error" },
        { kind: "evaluation", id: "eval_failed", status: "error" },
      ],
    });
  });

  test("uses backend storage callbacks while keeping trace assembly generic", async () => {
    const inspection = createWorkbenchInspection(testBackend());

    await expect(inspection.candidateFiles({ id: "candidate_1" })).resolves.toEqual([{
      path: "SKILL.md",
      old_path: null,
      status: "added",
      mime_type: "text/markdown",
      preview_kind: "markdown",
      additions: 2,
      deletions: 0,
    }]);

    await expect(inspection.executionTrace({
      runId: "run_1",
      jobId: "job_1",
    })).resolves.toMatchObject({
      projectId: "test-project",
      runId: "run_1",
      executions: [{
        kind: "attempt",
        jobIds: ["job_1"],
        trace: {
          trace_id: "test-project-execution-job_1",
        },
      }],
    });
  });
});

function testBackend(): WorkbenchInspectionBackend {
  const files: SurfaceSnapshotFile[] = [{
    path: "SKILL.md",
    kind: "text",
    encoding: "utf8",
    content: "Skill text\n",
    executable: false,
  }];
  const candidate: CandidateRecord = {
    id: "candidate_1",
    name: "Skill",
    version: 1,
    ordinal: 1,
    benchmarkFingerprint: "bench_1",
    candidateFingerprint: "cand_1",
    createdAt: "2026-05-01T00:00:00.000Z",
    referenceIds: [],
    status: "evaluated",
    fileChanges: ["SKILL.md"],
    eval: evaluation.evaluation,
  };
  const run: RunSummary = {
    id: "run_1",
    workflow: "eval",
    benchmarkFingerprint: "bench_1",
    status: "finished",
    candidateId: "candidate_1",
    startedAt: "2026-05-01T00:00:00.000Z",
    finishedAt: "2026-05-01T00:01:00.000Z",
    improver: "generic-improver",
    engineRun: "default",
    strategy: "none",
    budget: 0,
    repairBudget: 0,
    attemptsRequested: 1,
    attemptsExecuted: 1,
    samples: 1,
    outcome: "ok",
  };
  const failedRun: RunSummary = {
    ...run,
    id: "run_failed",
    status: "finished",
    outcome: "error",
    error: "adapter process failed",
  };
  const job: RemoteWorkbenchJob = {
    id: "job_1",
    projectId: "test-project",
    runId: "run_1",
    candidateId: "candidate_1",
    kind: "execute",
    status: "succeeded",
    attempt: 1,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:01:00.000Z",
    startedAt: "2026-05-01T00:00:00.000Z",
    finishedAt: "2026-05-01T00:01:00.000Z",
    input: {
      execution: {
        id: "exec_1",
        purpose: "attempt",
        metadata: {
          candidateId: "candidate_1",
          caseId: "case_1",
          sampleIndex: 0,
        },
      },
    },
  };
  const snapshot: RuntimeSnapshot = {
    workspaceRoot: "test-workspace",
    activeId: "candidate_1",
    currentBenchmarkFingerprint: "bench_1",
    summaries: [candidate],
    evaluations: [evaluationSummary(evaluation), evaluationSummary(failedEvaluation)],
    runs: [run, failedRun],
  };
  return {
    projectId: "test-project",
    snapshot: async () => snapshot,
    spec: async () => ({
      path: "benchmark.yaml",
      exists: true,
      source_yaml: "version: 4\n",
      source_files: [],
      spec: null,
      cases: [],
    }),
    sourceFiles: async () => files,
    candidate: async () => candidate,
    candidateFiles: async () => ({ files, changedPaths: candidate.fileChanges }),
    evaluation: async (input) =>
      input.id === failedEvaluation.id ? failedEvaluation : evaluation,
    run: async (input) => ({
      run: input.id === "run_failed" ? failedRun : run,
      jobs: [job],
    }),
    jobInRun: async () => job,
    executionFiles: async () => files,
    traceForJob: (traceJob): WorkbenchExecutionTrace => ({
      trace_id: traceJob.id,
      spans: [],
      events: [],
      summaries: [],
    }),
  };
}

const evaluation: EvaluationScorecard = {
  id: "eval_1",
  runId: "run_1",
  benchmarkFingerprint: "bench_1",
  candidateFingerprint: "cand_1",
  candidateId: "candidate_1",
  candidateName: "Skill",
  candidateVersion: 1,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:01:00.000Z",
  status: "completed",
  sampleCount: 1,
  completedSampleCount: 1,
  errorSampleCount: 0,
  metrics: { score: stats(0.72) },
  evaluation: {
    candidate: {
      id: "candidate_1",
      kind: "candidate",
      label: "Skill",
    },
    status: "completed",
    sampleCount: 1,
    completedSampleCount: 1,
    errorSampleCount: 0,
    metrics: { score: stats(0.72) },
    samples: [],
  },
};

const failedEvaluation: EvaluationScorecard = {
  ...evaluation,
  id: "eval_failed",
  runId: "run_failed",
  status: "error",
  completedSampleCount: 0,
  errorSampleCount: 1,
  error: "scoring failed",
  evaluation: {
    ...evaluation.evaluation,
    status: "error",
    completedSampleCount: 0,
    errorSampleCount: 1,
    error: "scoring failed",
    samples: [{
      id: "sample_0",
      index: 0,
      candidate: {
        id: "candidate_1",
        kind: "candidate",
        label: "Skill",
      },
      status: "error",
      error: "scoring failed",
      metrics: {},
      cases: [],
    }],
  },
};

function evaluationSummary(scorecard: EvaluationScorecard) {
  const { evaluation: _evaluation, ...summary } = scorecard;
  return summary;
}

function stats(mean: number) {
  return {
    count: 1,
    mean,
    stddev: 0,
    min: mean,
    max: mean,
  };
}
