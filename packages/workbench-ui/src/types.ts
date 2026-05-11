import type {
  EvaluationRecord,
  EvaluationResultRecord,
  EvaluationResultSummary,
  MetricStats,
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
  EvaluationResultRecord,
  EvaluationResultSummary,
  MetricStats,
  CandidateFileSummary as CandidateWorkspaceFileSummary,
  CandidateFilePreview as CandidateWorkspaceFilePreview,
  AuthoredWorkbenchSourceSpec,
  AuthoredWorkbenchSourceDocument,
  HostedWorkbenchJob,
  HostedWorkbenchRun,
  RunOutcome,
  RunStatus,
  RunSummary,
  RuntimeEvent,
  RuntimeSnapshot,
  WorkbenchExecutionTraceDetail,
  WorkbenchTracePhase,
} from "@workbench-ai/workbench-contract";

export type ResultMetricDirection = "higher" | "lower";
export type ResultMetricKind = "number" | "duration_ms" | "currency_usd";
export type ResultMetricGroup = "metric" | "criteria" | "runtime" | "usage" | "other";
export type ResultMetricSemanticRole = "performance" | "speed" | "cost";

export interface ResultMetricDescriptor {
  id: string;
  label: string;
  direction: ResultMetricDirection;
  kind: ResultMetricKind;
  group: ResultMetricGroup;
  primary: boolean;
  semanticRole?: ResultMetricSemanticRole;
}

export type ResultMetricStats = MetricStats;

export type LabeledEvaluationResultRecord = EvaluationResultRecord & {
  label: string;
  evaluation: EvaluationRecord;
};
