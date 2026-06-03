import type {
  AuthoredWorkbenchSourceDocument,
  CandidateCaseReview,
  CandidatePreviewMode,
  CandidateRecord,
  CandidateWorkspaceFilePreview,
  CandidateWorkspaceFileSummary,
  EvaluationScorecard,
  BenchmarkSnapshot,
} from "../types";
import type { WorkbenchRoute } from "./routes";

export interface WorkbenchFileSurfaceResponse {
  files: CandidateWorkspaceFileSummary[];
  preview: CandidateWorkspaceFilePreview | null;
}

export interface WorkbenchWorkspaceInitialData {
  snapshot?: BenchmarkSnapshot | null;
  spec?: AuthoredWorkbenchSourceDocument | null;
  benchmarkFileSurface?: WorkbenchFileSurfaceResponse | null;
  candidateRecord?: CandidateRecord | null;
  candidateFileSurface?: {
    candidateId: string;
    files: CandidateWorkspaceFileSummary[];
    preview: CandidateWorkspaceFilePreview | null;
  } | null;
  evaluation?: EvaluationScorecard | null;
  caseReview?: {
    candidateId: string;
    runId: string;
    caseId: string;
    review: CandidateCaseReview;
  } | null;
}

export interface WorkbenchInspectionReader {
  snapshot(): Promise<BenchmarkSnapshot>;
  spec(input?: { fingerprint?: string | null }): Promise<AuthoredWorkbenchSourceDocument>;
  candidate(input: { id: string }): Promise<CandidateRecord>;
  candidateFileSurface(input: {
    id: string;
    path?: string | null;
    view?: CandidatePreviewMode;
  }): Promise<WorkbenchFileSurfaceResponse>;
  sourceFileSurface(input?: {
    fingerprint?: string | null;
    path?: string | null;
    view?: CandidatePreviewMode;
  }): Promise<WorkbenchFileSurfaceResponse>;
  evaluation(input: { id: string }): Promise<EvaluationScorecard>;
  caseReview(input: {
    candidateId: string;
    runId: string;
    caseId: string;
  }): Promise<CandidateCaseReview>;
}

export async function loadWorkbenchWorkspaceInitialData({
  inspection,
  route,
  snapshot,
}: {
  inspection: WorkbenchInspectionReader;
  route: WorkbenchRoute;
  snapshot?: BenchmarkSnapshot | null;
}): Promise<WorkbenchWorkspaceInitialData> {
  const resolvedSnapshot = snapshot ?? await optional(inspection.snapshot());
  if (!resolvedSnapshot) {
    return {};
  }

  const candidateId = route.kind === "candidate" ? route.candidateId : null;
  const listedCandidateSummary = candidateId
    ? resolvedSnapshot.summaries.find((candidate) => candidate.id === candidateId) ?? null
    : null;
  const listedEvaluationSummary = route.kind === "evaluation"
    ? resolvedSnapshot.evaluations.find((evaluation) => evaluation.id === route.evaluationId) ?? null
    : null;
  const fingerprint =
    (route.kind !== "not-found" ? normalizeFingerprint(route.benchmarkFingerprint) : null) ??
    normalizeFingerprint(listedCandidateSummary?.benchmarkFingerprint) ??
    normalizeFingerprint(listedEvaluationSummary?.benchmarkFingerprint) ??
    initialBenchmarkFingerprint(resolvedSnapshot);
  const sourceFingerprint = fingerprint === normalizeFingerprint(resolvedSnapshot.currentBenchmarkFingerprint)
    ? null
    : fingerprint;

  const [spec, benchmarkFileSurface, candidateRecord, candidateFileSurface, evaluation] = await Promise.all([
    optional(inspection.spec({ fingerprint: sourceFingerprint })),
    optional(route.kind !== "not-found" && route.benchmarkView === "files"
      ? inspection.sourceFileSurface({
          fingerprint: sourceFingerprint,
          path: route.benchmarkFilePath,
          view: route.benchmarkPreviewMode,
        })
      : null),
    optional(route.kind === "candidate" && route.view === "manifest" && candidateId
      ? inspection.candidate({ id: candidateId })
      : null),
    optional(route.kind === "candidate" && route.view === "files" && candidateId
      ? inspection.candidateFileSurface({
          id: candidateId,
          path: route.filePath,
          view: route.previewMode,
        })
      : null),
    optional(route.kind === "evaluation"
      ? inspection.evaluation({ id: route.evaluationId })
      : null),
  ]);
  const caseReview = route.kind === "evaluation" && route.caseId && evaluation
    ? await optional(inspection.caseReview({
        candidateId: evaluation.candidateId,
        runId: evaluation.runId,
        caseId: route.caseId,
      }))
    : null;

  return {
    snapshot: resolvedSnapshot,
    spec,
    benchmarkFileSurface,
    candidateRecord: candidateRecord ? stripCandidateOwnerUserId(candidateRecord) : candidateRecord,
    candidateFileSurface: candidateId && candidateFileSurface
      ? {
          candidateId,
          files: candidateFileSurface.files,
          preview: candidateFileSurface.preview,
        }
      : null,
    evaluation,
    caseReview: route.kind === "evaluation" && route.caseId && evaluation && caseReview
      ? {
          candidateId: evaluation.candidateId,
          runId: evaluation.runId,
          caseId: route.caseId,
          review: caseReview,
        }
      : null,
  };
}

function stripCandidateOwnerUserId(candidate: CandidateRecord): CandidateRecord {
  const { ownerUserId: _ownerUserId, ...rest } = candidate;
  return rest;
}

function initialBenchmarkFingerprint(snapshot: BenchmarkSnapshot): string | null {
  const active = snapshot.activeId
    ? snapshot.summaries.find((summary) => summary.id === snapshot.activeId)
    : null;
  return normalizeFingerprint(active?.benchmarkFingerprint) ??
    normalizeFingerprint(snapshot.currentBenchmarkFingerprint);
}

async function optional<T>(promise: Promise<T> | null): Promise<T | null> {
  if (!promise) {
    return null;
  }
  try {
    return await promise;
  } catch {
    return null;
  }
}

function normalizeFingerprint(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}
