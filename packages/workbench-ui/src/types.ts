import type {
  EvaluationRecord,
  EvaluationScorecard,
  EvaluationSummary,
  MetricStats,
  RuntimeSnapshot,
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
  HostedWorkbenchJob,
  HostedWorkbenchRun,
  RunSummary,
  WorkbenchExecutionEvidence,
  WorkbenchExecutionTraceDetail,
} from "@workbench-ai/workbench-contract";

export type EvaluationMetricDirection = "higher" | "lower";
export type EvaluationMetricKind = "number" | "duration_ms" | "currency_usd";
export type EvaluationMetricGroup = "metric" | "execution" | "usage" | "other";
export type EvaluationMetricSemanticRole = "performance" | "speed" | "cost";

export interface EvaluationMetricDescriptor {
  id: string;
  label: string;
  direction: EvaluationMetricDirection;
  kind: EvaluationMetricKind;
  group: EvaluationMetricGroup;
  primary: boolean;
  semanticRole?: EvaluationMetricSemanticRole;
}

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
