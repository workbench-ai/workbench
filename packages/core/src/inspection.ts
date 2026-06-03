import {
  buildCandidateLineage,
  buildWorkbenchEvaluationComparison,
  type WorkbenchEvaluationComparison,
} from "@workbench-ai/workbench-contract";
import type {
  AuthoredWorkbenchSourceDocument,
  CandidateCaseReview,
  CandidateFilePreview,
  CandidateFileSummary,
  CandidateLineageGraph,
  CandidateRecord,
  EvaluationScorecard,
  EvaluationSummary,
  RemoteWorkbenchJob,
  RemoteWorkbenchJobStatus,
  RunSummary,
  RuntimeSnapshot,
  WorkbenchExecutionEventRole,
  WorkbenchExecutionTrace,
  WorkbenchExecutionTraceDetail,
  WorkbenchTraceSession,
} from "@workbench-ai/workbench-contract";

import {
  buildCandidateCaseExecutionRefs,
  buildWorkbenchExecutionEvidence,
} from "./execution-evidence.ts";
import {
  candidateRecordWithoutDerivedFields,
  createCaseReview,
} from "./index.ts";

export interface WorkbenchInspectionErrorOptions {
  status?: number;
}

export class WorkbenchInspectionError extends Error {
  readonly status: number;
  readonly statusCode: number;

  constructor(message: string, options: WorkbenchInspectionErrorOptions = {}) {
    super(message);
    this.name = "WorkbenchInspectionError";
    this.status = options.status ?? 400;
    this.statusCode = this.status;
  }
}

export interface WorkbenchInspectionFileListInput {
  fingerprint?: string | null;
}

export interface WorkbenchInspectionFileSurface {
  files: CandidateFileSummary[];
  preview: CandidateFilePreview | null;
}

export interface WorkbenchInspectionFileSurfaceInput extends WorkbenchInspectionFileListInput {
  path?: string | null;
  view?: "diff" | "raw" | "rendered";
}

export interface WorkbenchInspectionCandidateInput {
  id: string;
}

export interface WorkbenchInspectionCandidateFileSurfaceInput extends WorkbenchInspectionCandidateInput {
  path?: string | null;
  view?: "diff" | "raw" | "rendered";
}

export interface WorkbenchInspectionEvaluationInput {
  id: string;
}

export interface WorkbenchInspectionCaseReviewInput {
  candidateId: string;
  caseId: string;
  runId: string;
  sampleIndex?: number;
}

export interface WorkbenchInspectionRunInput {
  id: string;
  includeJobs?: boolean;
}

export interface WorkbenchInspectionExecutionInput {
  runId: string;
  jobId: string;
}

export interface WorkbenchInspectionExecutionFileSurfaceInput extends WorkbenchInspectionExecutionInput {
  path?: string | null;
  view?: "diff" | "raw" | "rendered";
}

export interface WorkbenchInspectionRunDetail {
  run: RunSummary;
  jobs?: RemoteWorkbenchJob[];
}

export type WorkbenchFailureKind = "run" | "evaluation" | "sample" | "case" | "job";

export interface WorkbenchFailureDetail {
  kind: WorkbenchFailureKind;
  id: string;
  status?: string;
  runId?: string;
  candidateId?: string;
  evaluationId?: string;
  jobId?: string;
  caseId?: string;
  sampleIndex?: number;
  attemptIndex?: number;
  error?: string;
}

export interface WorkbenchFailureDiagnosis {
  targetId: string | null;
  failures: WorkbenchFailureDetail[];
  failedRunCount: number;
  failedEvaluationCount: number;
  failedJobCount: number;
}

export interface WorkbenchInspectionBackend {
  projectId: string;
  snapshot(): Promise<RuntimeSnapshot>;
  spec(input: WorkbenchInspectionFileListInput): Promise<AuthoredWorkbenchSourceDocument>;
  sourceFiles(input: WorkbenchInspectionFileListInput): Promise<CandidateFileSummary[]>;
  sourceFileSurface(input: WorkbenchInspectionFileSurfaceInput): Promise<WorkbenchInspectionFileSurface>;
  candidate(input: WorkbenchInspectionCandidateInput): Promise<CandidateRecord>;
  candidateFiles(input: WorkbenchInspectionCandidateInput): Promise<CandidateFileSummary[]>;
  candidateFileSurface(input: WorkbenchInspectionCandidateFileSurfaceInput): Promise<WorkbenchInspectionFileSurface>;
  evaluation(input: WorkbenchInspectionEvaluationInput): Promise<EvaluationScorecard>;
  run(input: WorkbenchInspectionRunInput): Promise<WorkbenchInspectionRunDetail>;
  jobInRun?(input: WorkbenchInspectionExecutionInput): Promise<RemoteWorkbenchJob>;
  executionFiles(input: WorkbenchInspectionExecutionInput): Promise<CandidateFileSummary[]>;
  executionFileSurface(input: WorkbenchInspectionExecutionFileSurfaceInput): Promise<WorkbenchInspectionFileSurface>;
  caseReview?(input: WorkbenchInspectionCaseReviewInput): Promise<CandidateCaseReview>;
  executionTrace?(input: WorkbenchInspectionExecutionInput): Promise<WorkbenchExecutionTraceDetail>;
  traceForJob?(
    job: RemoteWorkbenchJob,
    role: WorkbenchExecutionEventRole,
  ): WorkbenchExecutionTrace;
  traceSessionsForJob?(
    job: RemoteWorkbenchJob,
    role: WorkbenchExecutionEventRole,
  ): WorkbenchTraceSession[];
}

export interface WorkbenchInspection {
  snapshot(): Promise<RuntimeSnapshot>;
  spec(input?: WorkbenchInspectionFileListInput): Promise<AuthoredWorkbenchSourceDocument>;
  sourceFiles(input?: WorkbenchInspectionFileListInput): Promise<CandidateFileSummary[]>;
  sourceFileSurface(input?: WorkbenchInspectionFileSurfaceInput): Promise<WorkbenchInspectionFileSurface>;
  candidate(input: WorkbenchInspectionCandidateInput): Promise<CandidateRecord>;
  candidateFiles(input: WorkbenchInspectionCandidateInput): Promise<CandidateFileSummary[]>;
  candidateFileSurface(input: WorkbenchInspectionCandidateFileSurfaceInput): Promise<WorkbenchInspectionFileSurface>;
  evaluations(): Promise<WorkbenchEvaluationComparison>;
  evaluation(input: WorkbenchInspectionEvaluationInput): Promise<EvaluationScorecard>;
  caseReview(input: WorkbenchInspectionCaseReviewInput): Promise<CandidateCaseReview>;
  run(input: WorkbenchInspectionRunInput): Promise<WorkbenchInspectionRunDetail>;
  executionTrace(input: WorkbenchInspectionExecutionInput): Promise<WorkbenchExecutionTraceDetail>;
  executionFiles(input: WorkbenchInspectionExecutionInput): Promise<CandidateFileSummary[]>;
  executionFileSurface(input: WorkbenchInspectionExecutionFileSurfaceInput): Promise<WorkbenchInspectionFileSurface>;
  lineage(): Promise<CandidateLineageGraph>;
  diagnose(input?: { targetId?: string | null }): Promise<WorkbenchFailureDiagnosis>;
}

export function createWorkbenchInspection(
  backend: WorkbenchInspectionBackend,
): WorkbenchInspection {
  return {
    snapshot: () => backend.snapshot(),
    spec: (input = {}) => backend.spec(input),
    sourceFiles: (input = {}) => backend.sourceFiles(input),
    sourceFileSurface: (input = {}) => backend.sourceFileSurface(input),
    candidate: async (input) =>
      candidateRecordWithoutDerivedFields(await backend.candidate(input)),
    candidateFiles: (input) => backend.candidateFiles(input),
    candidateFileSurface: (input) => backend.candidateFileSurface(input),
    evaluations: async () => {
      const snapshot = await backend.snapshot();
      return buildWorkbenchEvaluationComparison(snapshot.evaluations);
    },
    evaluation: (input) => backend.evaluation(input),
    caseReview: async (input) => {
      if (backend.caseReview) {
        return await backend.caseReview(input);
      }
      const candidate = await backend.candidate({ id: input.candidateId });
      const jobs = (await backend.run({ id: input.runId, includeJobs: true })).jobs ?? [];
      return createCaseReview({
        candidate,
        caseId: input.caseId,
        executions: buildCandidateCaseExecutionRefs({
          jobs,
          candidateId: input.candidateId,
          caseId: input.caseId,
          sampleIndex: input.sampleIndex,
        }),
      });
    },
    run: (input) => backend.run(input),
    executionTrace: async (input) => {
      if (backend.executionTrace) {
        return await backend.executionTrace(input);
      }
      if (!backend.jobInRun || !backend.traceForJob) {
        throw new WorkbenchInspectionError(
          "Execution traces are not available for this Workbench inspection backend.",
          { status: 404 },
        );
      }
      const jobs = [await backend.jobInRun(input)];
      return {
        projectId: backend.projectId,
        runId: input.runId,
        executions: buildWorkbenchExecutionEvidence({
          jobs,
          traceIdPrefix: `${backend.projectId}-execution`,
          traceForJob: backend.traceForJob,
          traceSessionsForJob: backend.traceSessionsForJob,
        }),
      };
    },
    executionFiles: (input) => backend.executionFiles(input),
    executionFileSurface: (input) => backend.executionFileSurface(input),
    lineage: async () => {
      const snapshot = await backend.snapshot();
      return buildCandidateLineage({
        summaries: snapshot.summaries,
        activeId: snapshot.activeId,
      });
    },
    diagnose: async (input = {}) => {
      const snapshot = await backend.snapshot();
      return await diagnoseWorkbenchFailures({
        snapshot,
        backend,
        targetId: input.targetId?.trim() || null,
      });
    },
  };
}

export function selectedFilePath(
  requestedPath: string | null | undefined,
  files: readonly CandidateFileSummary[],
): string | null {
  const normalizedPath = requestedPath?.trim();
  if (normalizedPath && files.some((file) => file.path === normalizedPath)) {
    return normalizedPath;
  }
  return pickDefaultCandidateFilePath(files);
}

export function pickDefaultCandidateFilePath(
  files: readonly CandidateFileSummary[],
): string | null {
  return files
    .map((entry) => entry.path)
    .sort(compareCandidateFilePreference)[0] ?? null;
}

function compareCandidateFilePreference(left: string, right: string): number {
  const order = scoreCandidateFilePreference(left) - scoreCandidateFilePreference(right);
  return order === 0 ? left.localeCompare(right) : order;
}

function scoreCandidateFilePreference(path: string): number {
  if (path.endsWith("/SKILL.md") || path === "SKILL.md") {
    return 0;
  }
  if (path.endsWith(".md")) {
    return 1;
  }
  if (path.endsWith(".yaml") || path.endsWith(".yml")) {
    return 2;
  }
  return 3;
}

async function diagnoseWorkbenchFailures(args: {
  snapshot: RuntimeSnapshot;
  backend: WorkbenchInspectionBackend;
  targetId: string | null;
}): Promise<WorkbenchFailureDiagnosis> {
  const targetRun = args.targetId
    ? args.snapshot.runs.find((run) => run.id === args.targetId)
    : null;
  const targetEvaluation = args.targetId
    ? args.snapshot.evaluations.find((evaluation) => evaluation.id === args.targetId)
    : null;
  const failures: WorkbenchFailureDetail[] = [];
  if (args.targetId && targetRun) {
    const detail = await args.backend.run({ id: targetRun.id, includeJobs: true });
    failures.push(...runFailures(detail.run));
    failures.push(...jobFailures(detail.jobs ?? []));
  } else if (args.targetId && targetEvaluation) {
    const evaluation = await args.backend.evaluation({ id: targetEvaluation.id });
    failures.push(...evaluationFailures(evaluation));
  } else {
    for (const run of args.snapshot.runs) {
      failures.push(...runFailures(run));
    }
    for (const evaluation of args.snapshot.evaluations) {
      failures.push(...evaluationSummaryFailures(evaluation));
    }
  }
  return {
    targetId: args.targetId,
    failures,
    failedRunCount: failures.filter((failure) => failure.kind === "run").length,
    failedEvaluationCount: failures.filter((failure) => failure.kind === "evaluation").length,
    failedJobCount: failures.filter((failure) => failure.kind === "job").length,
  };
}

function runFailures(run: RunSummary): WorkbenchFailureDetail[] {
  if (run.status !== "finished" || (run.outcome !== "error" && run.outcome !== "cancelled")) {
    return [];
  }
  return [{
    kind: "run",
    id: run.id,
    runId: run.id,
    candidateId: run.outputCandidateId ?? run.candidateId ?? undefined,
    status: run.outcome,
    ...(run.error ? { error: run.error } : {}),
  }];
}

function evaluationSummaryFailures(
  evaluation: EvaluationSummary,
): WorkbenchFailureDetail[] {
  if (
    evaluation.status === "completed" &&
    evaluation.errorSampleCount === 0 &&
    !evaluation.error
  ) {
    return [];
  }
  return [{
    kind: "evaluation",
    id: evaluation.id,
    evaluationId: evaluation.id,
    runId: evaluation.runId,
    candidateId: evaluation.candidateId,
    status: evaluation.status,
    ...(evaluation.error ? { error: evaluation.error } : {}),
  }];
}

function evaluationFailures(evaluation: EvaluationScorecard): WorkbenchFailureDetail[] {
  const failures = evaluationSummaryFailures(evaluation);
  for (const sample of evaluation.evaluation.samples) {
    if (!sample.error && !(sample.cases ?? []).some((entry) => entry.status && entry.status !== "completed")) {
      continue;
    }
    failures.push({
      kind: "sample",
      id: `${evaluation.id}:sample:${sample.index}`,
      evaluationId: evaluation.id,
      runId: evaluation.runId,
      candidateId: evaluation.candidateId,
      sampleIndex: sample.index,
      status: sample.status,
      ...(sample.error ? { error: sample.error } : {}),
    });
    for (const result of sample.cases ?? []) {
      if (!result.status || result.status === "completed") {
        continue;
      }
      failures.push({
        kind: "case",
        id: `${evaluation.id}:case:${result.id}:sample:${sample.index}`,
        evaluationId: evaluation.id,
        runId: evaluation.runId,
        candidateId: evaluation.candidateId,
        caseId: result.id,
        sampleIndex: sample.index,
        status: result.status,
      });
    }
  }
  return failures;
}

function jobFailures(jobs: readonly RemoteWorkbenchJob[]): WorkbenchFailureDetail[] {
  return jobs
    .filter((job) => isFailedJobStatus(job.status))
    .map((job) => ({
      kind: "job",
      id: job.id,
      jobId: job.id,
      runId: job.runId,
      candidateId: job.candidateId,
      status: job.status,
      attemptIndex: typeof job.attempt === "number" ? job.attempt : undefined,
      ...(job.error ? { error: job.error } : {}),
    }));
}

function isFailedJobStatus(status: RemoteWorkbenchJobStatus): boolean {
  return status === "failed" || status === "cancelled";
}
