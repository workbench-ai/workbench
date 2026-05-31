import type {
  EvaluationRecord,
  EvaluationScorecard,
  EvaluationSummary,
  MetricStats,
  RuntimeSnapshot,
  WorkbenchEvaluationMetricDescriptor,
} from "@workbench-ai/workbench-contract";

export type {
  CandidateCaseReview,
  CandidatePreviewMode,
  CandidatePreviewKind,
  CandidateRecord,
  CandidateStatus,
  CandidateSummary,
  EvaluationRecord,
  EvaluationSampleRecord,
  EvaluationCaseStats,
  EvaluationScorecard,
  EvaluationSummary,
  MetricStats,
  CandidateFileSummary as CandidateWorkspaceFileSummary,
  CandidateFilePreview as CandidateWorkspaceFilePreview,
  AuthoredWorkbenchSourceSpec,
  AuthoredWorkbenchSourceDocument,
  RemoteWorkbenchJob,
  RemoteWorkbenchRun,
  RunSummary,
  WorkbenchExecutionEvidence,
  WorkbenchExecutionTraceDetail,
} from "@workbench-ai/workbench-contract";

export type EvaluationMetricDescriptor = WorkbenchEvaluationMetricDescriptor;
export type EvaluationMetricDirection = WorkbenchEvaluationMetricDescriptor["direction"];
export type EvaluationMetricKind = WorkbenchEvaluationMetricDescriptor["kind"];
export type EvaluationMetricGroup = WorkbenchEvaluationMetricDescriptor["group"];
export type EvaluationMetricSemanticRole = NonNullable<WorkbenchEvaluationMetricDescriptor["semanticRole"]>;

export type EvaluationMetricStats = MetricStats;

export type BenchmarkSnapshot = RuntimeSnapshot;

export type LabeledEvaluationScorecard = EvaluationScorecard & {
  label: string;
  evaluation: EvaluationRecord;
};

export type LabeledEvaluationSummary = EvaluationSummary & {
  label: string;
  evaluation?: EvaluationRecord;
};
