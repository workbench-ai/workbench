export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

const RESERVED_ADAPTER_AUTH_ENV_NAMES = new Set([
  "BASH_ENV",
  "ENV",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_SYSTEM",
  "HOME",
  "IFS",
  "LD_AUDIT",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "LOGNAME",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PATH",
  "PWD",
  "PYTHONHOME",
  "PYTHONPATH",
  "SHELL",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
]);

const RESERVED_ADAPTER_AUTH_ENV_PREFIXES = [
  "DYLD_",
  "LD_",
  "npm_",
  "npm_config_",
  "WORKBENCH_",
];

export function isReservedWorkbenchAdapterAuthEnvName(name: string): boolean {
  const normalized = name.trim();
  return RESERVED_ADAPTER_AUTH_ENV_NAMES.has(normalized) ||
    RESERVED_ADAPTER_AUTH_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function assertWorkbenchAdapterAuthEnvNameAllowed(name: string): void {
  if (isReservedWorkbenchAdapterAuthEnvName(name)) {
    throw new Error(`Adapter auth env var is reserved: ${name}`);
  }
}

export interface RemoteWorkbenchProject {
  id: string;
  ownerUserId: string;
  ownerUsername: string;
  visibility: "private" | "public";
  createdAt: string;
  updatedAt: string;
  activeEnvironmentVersionId: string;
  currentSpecVersionId: string;
  activeCandidateId?: string | null;
  sourceFingerprint?: string;
  starCount: number;
}

export interface RemoteWorkbenchProjectSummary {
  id: string;
  ownerUsername: string;
  name: string;
  description: string;
  visibility: "private" | "public";
  updatedAt: string;
  currentSpecVersionId: string;
  activeEnvironmentVersionId: string;
  activeCandidateId?: string | null;
  candidateCount: number;
  evaluationCount: number;
  runCount: number;
  starCount: number;
  viewerHasStarred?: boolean;
}

export interface WorkbenchSpecValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface RemoteWorkbenchSpecVersion {
  id: string;
  projectId: string;
  ordinal: number;
  sourceYaml: string;
  createdAt: string;
  updatedAt: string;
  validation: WorkbenchSpecValidation;
}

export interface RemoteWorkbenchEnvironment {
  id: string;
  name: string;
  description: string;
  currentVersionId: string;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteWorkbenchEnvironmentVersion {
  id: string;
  environmentId: string;
  name: string;
  spec: RemoteWorkbenchEnvironmentSpec;
  imageRef: string;
  sourceHash: string;
  sourceType: "builtin" | "dockerfile";
  build?: {
    dockerfileRef?: BlobObjectRef;
    logRef?: BlobObjectRef;
    error?: string;
    startedAt?: string;
    finishedAt?: string;
  };
  status: "ready" | "building" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface RemoteWorkbenchEnvironmentSpec {
  base: string;
  resources: {
    cpu: number;
    memoryGb: number;
    diskGb: number;
    timeoutMinutes: number;
  };
  network: "off" | "on";
}

export interface BlobObjectRef {
  bucket: string;
  key: string;
  byteLength: number;
  sha256: string;
}

export type RemoteWorkbenchSnapshotKind =
  | "candidate"
  | "engineResolve"
  | "adapters"
  | "runtime";

export type WorkspaceWriteEncoding = "utf8" | "base64";

export interface SurfaceSnapshotFile {
  path: string;
  kind: "text" | "binary";
  encoding: WorkspaceWriteEncoding;
  content: string;
  executable: boolean;
  contentRedacted?: boolean;
}

export interface WorkbenchEngineCaseFiles {
  public?: SurfaceSnapshotFile[];
  private?: SurfaceSnapshotFile[];
  source?: SurfaceSnapshotFile[];
}

export interface SurfaceSnapshot {
  files: SurfaceSnapshotFile[];
}

export interface RemoteWorkbenchFileInput {
  path: string;
  content: string;
  encoding?: WorkspaceWriteEncoding;
  executable?: boolean;
}

export interface EngineResolveBinding {
  engine: string;
  resolver: {
    use: string;
    withFingerprint: string;
  };
}

export interface RemoteWorkbenchSnapshotBase {
  files: SurfaceSnapshotFile[];
  updatedAt: string;
}

export interface RemoteWorkbenchEngineResolveSnapshot
  extends RemoteWorkbenchSnapshotBase {
  kind: "engineResolve";
  engineResolveBinding: EngineResolveBinding;
}

export interface RemoteWorkbenchStandardSnapshot
  extends RemoteWorkbenchSnapshotBase {
  kind: Exclude<RemoteWorkbenchSnapshotKind, "engineResolve">;
}

export type RemoteWorkbenchSnapshot =
  | RemoteWorkbenchEngineResolveSnapshot
  | RemoteWorkbenchStandardSnapshot;

export type CandidateStatus =
  | "running"
  | "evaluated"
  | "repair_exhausted"
  | "eval_error"
  | "agent_error";

export interface MetricStats {
  count: number;
  mean: number;
  variance: number;
  stddev: number;
  min: number;
  max: number;
}

export type EvalCaseStatus = "completed" | "error";

export type EvalCaseSource = Record<string, Json>;

export interface CandidateCaseCriterionScore {
  criterion_id: string;
  label: string;
  score: number;
  pass: boolean;
  errors?: string[];
  rationale?: string;
}

export interface EvalCaseResult {
  id: string;
  label?: string;
  split?: string;
  status?: EvalCaseStatus;
  durationMs?: number;
  metrics: Record<string, number>;
  source?: EvalCaseSource;
  feedback?: Json;
  criteria?: CandidateCaseCriterionScore[];
}

export type ExecutionRole = "improver" | "runner" | "engine";
export type ExecutionUsageCostSource = "provider" | "estimated" | "mixed";

export interface ExecutionUsage {
  provider?: string;
  model?: string;
  inputTokens?: number;
  uncachedInputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  costSource?: ExecutionUsageCostSource;
  pricingSource?: string;
}

export interface UsageSummary {
  total?: ExecutionUsage;
  improver?: ExecutionUsage;
  runner?: ExecutionUsage;
  engine?: ExecutionUsage;
}

export interface EvaluationCandidateSummary {
  id: string;
  kind: "candidate";
  label?: string;
}

export type EvaluationSampleStatus = "planned" | "running" | "completed" | "error";
export type EvaluationStatus = EvaluationSampleStatus | "partial";

export interface EvaluationSampleRecord {
  id: string;
  index: number;
  candidate: EvaluationCandidateSummary;
  status: EvaluationSampleStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  metrics?: Record<string, number>;
  usage?: UsageSummary;
  error?: string;
  cases?: EvalCaseResult[];
  feedback?: Json;
}

export interface EvaluationCaseStats {
  id: string;
  label?: string;
  split?: string;
  status?: EvalCaseStatus;
  sampleCount: number;
  metrics: Record<string, MetricStats>;
  durationMs?: MetricStats;
}

export interface EvaluationUsageStats {
  total?: ExecutionUsageStats;
  improver?: ExecutionUsageStats;
  runner?: ExecutionUsageStats;
  engine?: ExecutionUsageStats;
}

export interface ExecutionUsageStats {
  inputTokens?: MetricStats;
  uncachedInputTokens?: MetricStats;
  cachedInputTokens?: MetricStats;
  cacheCreationInputTokens?: MetricStats;
  cacheReadInputTokens?: MetricStats;
  outputTokens?: MetricStats;
  reasoningOutputTokens?: MetricStats;
  totalTokens?: MetricStats;
  costUsd?: MetricStats;
}

export interface EvaluationRecord {
  candidate: EvaluationCandidateSummary;
  status: EvaluationStatus;
  sampleCount: number;
  completedSampleCount: number;
  errorSampleCount: number;
  startedAt?: string;
  finishedAt?: string;
  metrics?: Record<string, MetricStats>;
  durationMs?: MetricStats;
  usage?: EvaluationUsageStats;
  cases?: EvaluationCaseStats[];
  samples: EvaluationSampleRecord[];
  error?: string;
}

export interface EvaluationSummary {
  id: string;
  runId: string;
  benchmarkFingerprint: string;
  candidateFingerprint: string;
  candidateId: string;
  candidateName?: string;
  candidateVersion: number;
  candidateRunId?: string;
  candidateRunName?: string;
  createdAt: string;
  updatedAt: string;
  status: EvaluationStatus;
  sampleCount: number;
  completedSampleCount: number;
  errorSampleCount: number;
  metrics?: Record<string, MetricStats>;
  selectionMetric?: string;
  selectionLabel?: string;
  selectionScore?: MetricStats;
  durationMs?: MetricStats;
  usage?: EvaluationUsageStats;
  error?: string;
}

export interface EvaluationScorecard extends EvaluationSummary {
  evaluation: EvaluationRecord;
}

export interface WorkbenchEvaluationMetricDescriptor {
  id: string;
  label: string;
  direction: "higher" | "lower";
  kind: "number" | "duration_ms" | "currency_usd";
  group: "metric" | "execution" | "usage" | "other";
  primary: boolean;
  semanticRole?: "performance" | "speed" | "cost";
}

export interface WorkbenchEvaluationComparisonRow {
  evaluationId: string;
  runId: string;
  candidateId: string;
  candidateLabel: string;
  configurationLabel: string;
  status: EvaluationSummary["status"];
  score: number | null;
  metrics: Record<string, number>;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface WorkbenchCandidateEvaluationRollup {
  candidateId: string;
  candidateLabel: string;
  evaluationCount: number;
  completeEvaluationCount: number;
  scoredEvaluationCount: number;
  bestEvaluationId: string | null;
  bestScore: number | null;
  meanScore: number | null;
}

export interface WorkbenchEvaluationComparison {
  evaluations: EvaluationSummary[];
  rows: WorkbenchEvaluationComparisonRow[];
  candidates: WorkbenchCandidateEvaluationRollup[];
  metrics: WorkbenchEvaluationMetricDescriptor[];
}

export interface CandidateSummary {
  id: string;
  name?: string;
  version: number;
  ordinal: number;
  benchmarkFingerprint: string;
  candidateFingerprint: string;
  ownerUserId?: string;
  ownerUsername?: string;
  visibility?: "private" | "public";
  createdAt: string;
  baseId?: string;
  referenceIds: string[];
  status: CandidateStatus;
  fileChanges: string[];
  usage?: UsageSummary;
}

export interface CandidateRecord extends CandidateSummary {
  eval?: EvaluationRecord;
  prompt?: string;
  meta?: Json;
}

export interface CandidateLineageNode {
  id: string;
  active: boolean;
  summary: CandidateSummary;
}

export interface CandidateLineageEdge {
  id: string;
  kind: "anchor";
  sourceId: string;
  targetId: string;
}

export interface CandidateLineageGraph {
  activeId: string | null;
  nodes: CandidateLineageNode[];
  edges: CandidateLineageEdge[];
}

export function buildCandidateLineage(args: {
  summaries: readonly CandidateSummary[];
  activeId: string | null;
}): CandidateLineageGraph {
  const orderedSummaries = args.summaries.slice().sort((left, right) => {
    const createdAt = left.createdAt.localeCompare(right.createdAt);
    return createdAt !== 0 ? createdAt : left.id.localeCompare(right.id);
  });
  const summaryIds = new Set(orderedSummaries.map((summary) => summary.id));
  return {
    activeId: args.activeId,
    nodes: orderedSummaries.map((summary): CandidateLineageNode => ({
      id: summary.id,
      active: args.activeId === summary.id,
      summary,
    })),
    edges: orderedSummaries.flatMap((summary) =>
      buildLineageEdges(summary, summaryIds),
    ),
  };
}

export function buildWorkbenchEvaluationComparison(
  evaluations: readonly EvaluationSummary[],
): WorkbenchEvaluationComparison {
  const rows = evaluations.map(evaluationComparisonRow);
  const rollups = buildEvaluationRollups(evaluations);
  return {
    evaluations: evaluations.map((evaluation) => ({ ...evaluation })),
    rows,
    candidates: rollups,
    metrics: buildWorkbenchEvaluationMetricDescriptors(evaluations),
  };
}

export function buildWorkbenchEvaluationMetricDescriptors(
  evaluations: readonly EvaluationSummary[],
): WorkbenchEvaluationMetricDescriptor[] {
  const descriptors = new Map<string, WorkbenchEvaluationMetricDescriptor>();
  for (const evaluation of evaluations.filter(isCompleteEvaluationSummary)) {
    for (const metricId of Object.keys(evaluation.metrics ?? {})) {
      descriptors.set(metricId, metricDescriptor(metricId));
    }
    if (evaluation.selectionMetric && evaluation.selectionScore) {
      descriptors.set(evaluation.selectionMetric, metricDescriptor(evaluation.selectionMetric));
    }
    if (evaluation.durationMs) {
      descriptors.set("durationMs", {
        id: "durationMs",
        label: "Duration",
        direction: "lower",
        kind: "duration_ms",
        group: "execution",
        primary: true,
        semanticRole: "speed",
      });
    }
    if (evaluation.usage?.total?.costUsd) {
      descriptors.set("usage.total.costUsd", {
        id: "usage.total.costUsd",
        label: "Cost",
        direction: "lower",
        kind: "currency_usd",
        group: "usage",
        primary: true,
        semanticRole: "cost",
      });
    }
  }
  return [...descriptors.values()].sort(compareMetricDescriptors);
}

export function readEvaluationScore(evaluation: EvaluationSummary): number | null {
  const score = evaluation.selectionMetric === "score"
    ? evaluation.selectionScore?.mean ?? evaluation.metrics?.score?.mean
    : evaluation.metrics?.score?.mean;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

export function isCompleteEvaluationSummary(
  evaluation: Pick<EvaluationSummary, "status" | "sampleCount" | "completedSampleCount" | "errorSampleCount">,
): boolean {
  return evaluation.status === "completed" &&
    evaluation.errorSampleCount === 0 &&
    evaluation.completedSampleCount >= evaluation.sampleCount;
}

export function formatEvaluationConfigurationLabel(
  evaluation: Pick<EvaluationSummary, "candidateRunName" | "candidateRunId">,
): string {
  return evaluation.candidateRunName?.trim() ||
    evaluation.candidateRunId?.trim() ||
    "Default configuration";
}

function evaluationComparisonRow(
  evaluation: EvaluationSummary,
): WorkbenchEvaluationComparisonRow {
  return {
    evaluationId: evaluation.id,
    runId: evaluation.runId,
    candidateId: evaluation.candidateId,
    candidateLabel: candidateDisplayName(evaluation),
    configurationLabel: formatEvaluationConfigurationLabel(evaluation),
    status: evaluation.status,
    score: readEvaluationScore(evaluation),
    metrics: readEvaluationMetricMeans(evaluation),
    createdAt: evaluation.createdAt,
    updatedAt: evaluation.updatedAt,
    ...(evaluation.error ? { error: evaluation.error } : {}),
  };
}

function buildEvaluationRollups(
  evaluations: readonly EvaluationSummary[],
): WorkbenchCandidateEvaluationRollup[] {
  const byCandidate = new Map<string, EvaluationSummary[]>();
  for (const evaluation of evaluations) {
    const entries = byCandidate.get(evaluation.candidateId) ?? [];
    entries.push(evaluation);
    byCandidate.set(evaluation.candidateId, entries);
  }
  return [...byCandidate.entries()]
    .map(([candidateId, entries]) => candidateEvaluationRollup(candidateId, entries))
    .sort((left, right) =>
      (right.bestScore ?? Number.NEGATIVE_INFINITY) -
        (left.bestScore ?? Number.NEGATIVE_INFINITY) ||
      left.candidateLabel.localeCompare(right.candidateLabel) ||
      left.candidateId.localeCompare(right.candidateId)
    );
}

function candidateEvaluationRollup(
  candidateId: string,
  evaluations: readonly EvaluationSummary[],
): WorkbenchCandidateEvaluationRollup {
  const scored = evaluations
    .filter(isCompleteEvaluationSummary)
    .map((evaluation) => ({ evaluation, score: readEvaluationScore(evaluation) }))
    .filter((entry): entry is { evaluation: EvaluationSummary; score: number } =>
      entry.score !== null,
    );
  const best = scored.slice().sort((left, right) =>
    right.score - left.score ||
    right.evaluation.updatedAt.localeCompare(left.evaluation.updatedAt) ||
    right.evaluation.id.localeCompare(left.evaluation.id)
  )[0] ?? null;
  const labelEvaluation = best?.evaluation ?? evaluations[0];
  return {
    candidateId,
    candidateLabel: labelEvaluation ? candidateDisplayName(labelEvaluation) : candidateId,
    evaluationCount: evaluations.length,
    completeEvaluationCount: evaluations.filter(isCompleteEvaluationSummary).length,
    scoredEvaluationCount: scored.length,
    bestEvaluationId: best?.evaluation.id ?? null,
    bestScore: best?.score ?? null,
    meanScore: scored.length > 0
      ? scored.reduce((sum, entry) => sum + entry.score, 0) / scored.length
      : null,
  };
}

function metricDescriptor(metricId: string): WorkbenchEvaluationMetricDescriptor {
  const scoreMetric = metricId === "score";
  return {
    id: metricId,
    label: formatMetricLabel(metricId),
    direction: "higher",
    kind: "number",
    group: "metric",
    primary: scoreMetric,
    ...(scoreMetric ? { semanticRole: "performance" as const } : {}),
  };
}

function compareMetricDescriptors(
  left: WorkbenchEvaluationMetricDescriptor,
  right: WorkbenchEvaluationMetricDescriptor,
): number {
  const rank = (descriptor: WorkbenchEvaluationMetricDescriptor) =>
    descriptor.semanticRole === "performance"
      ? 0
      : descriptor.semanticRole === "speed"
        ? 1
        : descriptor.semanticRole === "cost"
          ? 2
          : descriptor.primary
            ? 3
            : 4;
  return rank(left) - rank(right) || left.label.localeCompare(right.label);
}

function formatMetricLabel(metricId: string): string {
  if (metricId === "durationMs") {
    return "Duration";
  }
  if (metricId === "usage.total.costUsd") {
    return "Cost";
  }
  return metricId
    .split(/[._-]+/u)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(" ");
}

function readEvaluationMetricMeans(
  evaluation: EvaluationSummary,
): Record<string, number> {
  const entries: Array<[string, MetricStats]> = [
    ...Object.entries(evaluation.metrics ?? {}),
    ...(evaluation.durationMs ? [["durationMs", evaluation.durationMs] as [string, MetricStats]] : []),
    ...(evaluation.usage?.total?.costUsd
      ? [["usage.total.costUsd", evaluation.usage.total.costUsd] as [string, MetricStats]]
      : []),
  ];
  return Object.fromEntries(
    entries
      .filter((entry) => Number.isFinite(entry[1].mean))
      .map(([key, value]) => [key, value.mean]),
  );
}

function candidateDisplayName(
  candidate: Pick<EvaluationSummary, "candidateName" | "candidateVersion" | "candidateId">,
): string {
  return candidate.candidateName?.trim() ||
    `Candidate v${candidate.candidateVersion}` ||
    candidate.candidateId;
}

function buildLineageEdges(
  summary: CandidateSummary,
  summaryIds: ReadonlySet<string>,
): CandidateLineageEdge[] {
  const edges: CandidateLineageEdge[] = [];
  if (summary.baseId && summary.baseId !== summary.id && summaryIds.has(summary.baseId)) {
    edges.push({
      id: `anchor:${summary.baseId}:${summary.id}`,
      kind: "anchor",
      sourceId: summary.baseId,
      targetId: summary.id,
    });
  }
  return edges;
}

export type CandidatePreviewMode = "diff" | "raw" | "rendered";
export type CandidatePreviewKind =
  | "text"
  | "markdown"
  | "table"
  | "spreadsheet"
  | "image"
  | "pdf"
  | "unsupported";

export type CandidatePreviewSourceEncoding = "utf8" | "base64";
export type CandidateFileStatus = "added" | "modified" | "unchanged";

export interface CandidateFileSummary {
  path: string;
  old_path: string | null;
  status: CandidateFileStatus;
  mime_type: string | null;
  preview_kind: CandidatePreviewKind;
  additions: number;
  deletions: number;
}

export interface CandidateFilePreviewSource {
  content: string;
  encoding: CandidatePreviewSourceEncoding;
}

export interface CandidateFilePreview {
  path: string;
  view: CandidatePreviewMode;
  mime_type: string | null;
  preview_kind: CandidatePreviewKind;
  diff: string | null;
  source: CandidateFilePreviewSource | null;
  rendered_html: string | null;
}

export interface CandidateCaseCriterionResult {
  criterion_id: string;
  pass: boolean;
  score: number;
  errors: string[];
  rationale?: string;
}

export interface CandidateCaseExecutionRef {
  runId: string;
  kind: string;
  role: WorkbenchExecutionEventRole;
  status: RemoteWorkbenchJobStatus;
  jobIds: string[];
  executionIds: string[];
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  caseId?: string;
  sampleIndex?: number;
  attemptIndex?: number;
}

export interface CandidateCaseReview {
  candidateId: string;
  caseId: string;
  caseLabel: string;
  sampleId?: string;
  sampleIndex?: number;
  status?: EvalCaseStatus | RemoteWorkbenchJobStatus;
  metrics: Record<string, number>;
  durationMs?: number;
  source?: EvalCaseSource;
  feedback?: Json;
  executions: CandidateCaseExecutionRef[];
  criteria_results: CandidateCaseCriterionResult[];
}

export type RunStatus = "queued" | "running" | "finished";
export type RunOutcome = "ok" | "error" | "cancelled";
export type RemoteRunWorkflow = "eval" | "improve";

export interface RunSummary {
  id: string;
  workflow: RemoteRunWorkflow;
  benchmarkFingerprint: string;
  status: RunStatus;
  candidateId?: string | null;
  candidateRunId?: string;
  candidateRunName?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  improver: string;
  engineRun: string;
  strategy: string;
  optimizeOn?: string;
  selectBy?: string;
  budget: number;
  repairBudget: number;
  attemptsRequested: number;
  attemptsExecuted: number;
  samples: number;
  executionFingerprint?: string;
  stoppedReason?: "budget_exhausted" | "completed" | "dry_run" | "cancelled";
  outcome?: RunOutcome;
  error?: string;
  activeCandidateId?: string | null;
  outputCandidateId?: string | null;
}

export interface WorkbenchRuntimeRun extends RunSummary {
  jobCount?: number;
  completedJobCount?: number;
  failedJobCount?: number;
}

export interface RuntimeEvent {
  id: string;
  at: string;
  type:
    | "run_started"
    | "job_queued"
    | "job_started"
    | "job_progress"
    | "sandbox_allocated"
    | "sandbox_stopped"
    | "candidate_created"
    | "candidate_evaluated"
    | "active_changed"
    | "run_finished";
  runId?: string;
  jobId?: string;
  candidateId?: string;
  baseId?: string;
  activeId?: string;
  status?: CandidateStatus | RemoteWorkbenchJobStatus;
  metrics?: Record<string, number>;
  detail?: Record<string, Json>;
}

export interface RuntimeSnapshot {
  workspaceRoot: string;
  activeId: string | null;
  currentBenchmarkFingerprint: string | null;
  summaries: CandidateSummary[];
  evaluations: EvaluationSummary[];
  runs: RunSummary[];
}

export interface WorkbenchRuntimeCandidateFiles {
  candidateId: string;
  files: SurfaceSnapshotFile[];
}

export interface WorkbenchRuntimeExecutionFiles {
  jobId: string;
  files: SurfaceSnapshotFile[];
}

export interface WorkbenchRuntimeBundle {
  schema: "workbench.runtime.bundle.v1";
  activeId: string | null;
  candidates: CandidateRecord[];
  candidateFiles: WorkbenchRuntimeCandidateFiles[];
  evaluations: EvaluationScorecard[];
  runs: WorkbenchRuntimeRun[];
  jobs: RemoteWorkbenchJob[];
  executionFiles: WorkbenchRuntimeExecutionFiles[];
  events: RuntimeEvent[];
}

export interface WorkbenchRuntimeBundleStats {
  candidates: number;
  candidateFiles: number;
  evaluations: number;
  runs: number;
  jobs: number;
  executionFiles: number;
  events: number;
  activeId: string | null;
}

export interface WorkbenchRuntimeImportResult {
  changed: boolean;
  stats: WorkbenchRuntimeBundleStats;
}

export interface WorkbenchProjectSourceResources {
  cpu?: number;
  memoryGb?: number;
  diskGb?: number;
  timeoutMinutes?: number;
}

export interface WorkbenchProjectStateSource {
  source: string;
  files: SurfaceSnapshotFile[];
  candidateFiles: SurfaceSnapshotFile[];
  engineResolveFiles: SurfaceSnapshotFile[];
  engineResolveBinding: EngineResolveBinding;
  adapterFiles: SurfaceSnapshotFile[];
  dockerfile: string;
  runtimeDockerfile: string;
  runtimeFiles: SurfaceSnapshotFile[];
  network: "off" | "on";
  resources: WorkbenchProjectSourceResources;
  revisionId?: string;
  fingerprint?: string;
}

export interface WorkbenchProjectStateBase {
  sourceRevisionId?: string;
  sourceFingerprint?: string;
  runtimeFingerprint?: string;
}

export interface WorkbenchProjectStateRemote {
  id: string;
  remote: string;
  ownerUsername: string;
  name: string;
  visibility: "private" | "public";
}

export interface WorkbenchProjectState {
  schema: "workbench.project.state.v1";
  project: WorkbenchProjectStateRemote;
  base: WorkbenchProjectStateBase;
  source: WorkbenchProjectStateSource;
  runtime: WorkbenchRuntimeBundle;
}

export interface WorkbenchProjectStateImportResult {
  changed: boolean;
  source: {
    changed: boolean;
    revisionId?: string;
    fingerprint?: string;
  };
  runtime: WorkbenchRuntimeImportResult;
  state: WorkbenchProjectState;
}

export type WorkbenchRemoteContractSchema =
  | "workbench.remote.capabilities.v1"
  | "workbench.remote.run.request.v1"
  | "workbench.remote.job.claim_request.v1"
  | "workbench.remote.job.claim.v1"
  | "workbench.remote.job.renewal.v1"
  | "workbench.remote.job.renewal_result.v1"
  | "workbench.remote.job.progress.v1"
  | "workbench.remote.job.completion.v1"
  | "workbench.remote.job.retry.v1";

export type WorkbenchRemoteProductionSandbox = "firecracker";
export type WorkbenchRemoteLocalSandbox = "docker";
export type WorkbenchRemoteNetworkPolicy = "open" | "none";

export interface WorkbenchRemoteCapabilities {
  schema: "workbench.remote.capabilities.v1";
  contractVersion: 1;
  projectState: {
    schema: WorkbenchProjectState["schema"];
    guardedSourceWrites: true;
    immutableRuntimeFacts: true;
  };
  execution: {
    fencedJobLeases: true;
    idempotentCompletion: true;
    progressIsBestEffort: true;
    maxJobsPerRun: number;
  };
  sandbox: {
    production: WorkbenchRemoteProductionSandbox;
    local: WorkbenchRemoteLocalSandbox;
    networkPolicies: WorkbenchRemoteNetworkPolicy[];
  };
  blobs: {
    contentAddressed: boolean;
    maxUploadBytes: number;
  };
}

export interface WorkbenchRemoteRunRequest {
  schema: "workbench.remote.run.request.v1";
  workflow: "eval" | "improve";
  budget?: number;
  samples: number;
  candidateId?: string;
  sourceYaml?: string;
  candidateFiles?: RemoteWorkbenchFileInput[];
  adapterFiles?: RemoteWorkbenchFileInput[];
  selectedSamples?: Array<{
    caseId: string;
    sampleIndex: number;
  }>;
  preserveActive?: boolean;
  rerun?: boolean;
}

export interface AuthoredWorkbenchCandidateRunSpec extends WorkbenchAuthoredAdapterSpec {
  name: string;
}

export interface WorkbenchCaseSelector {
  all?: true;
  split?: string;
}

export interface WorkbenchSelectionSpec {
  metric: string;
  cases?: WorkbenchCaseSelector;
}

export interface AuthoredWorkbenchCandidateImproveSpec extends WorkbenchAuthoredAdapterSpec {
  edits: string[];
  optimizeOn?: WorkbenchCaseSelector;
  selectBy?: WorkbenchSelectionSpec;
}

export interface AuthoredWorkbenchCandidateSpec {
  name: string;
  description?: string;
  files: WorkbenchPathRef;
  prepare?: WorkbenchCandidatePrepareSpec;
  defaultRun?: string;
  selectedRunId?: string;
  runs: Record<string, AuthoredWorkbenchCandidateRunSpec>;
  improve?: AuthoredWorkbenchCandidateImproveSpec;
}

export interface WorkbenchCandidatePrepareSpec {
  command: string;
}

export interface WorkbenchPathRef {
  path: string;
}

export interface WorkbenchAuthoredAdapterSpec {
  use: string;
  auth?: string | Record<string, string>;
  with?: Record<string, Json>;
}

export interface AuthoredWorkbenchRuntimeSpec {
  dockerfile: string;
  resources?: {
    cpu?: number;
    memoryGb?: number;
    diskGb?: number;
    timeoutMinutes?: number;
  };
  network?: {
    egress?: "none" | "open";
  };
}

export type AuthoredWorkbenchImproveSpec = WorkbenchAuthoredAdapterSpec;

export type AuthoredWorkbenchRunSpec = WorkbenchAuthoredAdapterSpec;

export type AuthoredWorkbenchScoreSpec = WorkbenchAuthoredAdapterSpec;

export interface AuthoredWorkbenchEngineConfig {
  tasks?: WorkbenchAuthoredAdapterSpec;
  environment: AuthoredWorkbenchRuntimeSpec;
  score: AuthoredWorkbenchScoreSpec;
}

export interface AuthoredWorkbenchEngineSpec {
  use: string;
  auth?: string | Record<string, string>;
  with?: AuthoredWorkbenchEngineConfig | Record<string, Json>;
}

export interface AuthoredWorkbenchBenchmarkSpec {
  name: string;
  description: string;
  engine: AuthoredWorkbenchEngineSpec;
}

export interface AuthoredWorkbenchSourceSpec {
  version: 4;
  benchmark: AuthoredWorkbenchBenchmarkSpec;
  candidate: AuthoredWorkbenchCandidateSpec;
}

export type WorkbenchExecutionPurpose = "improve" | "attempt";

export type WorkbenchSandboxTemplateKind = "snapshot" | "oci";

export interface WorkbenchAdapterInvocation {
  use: string;
  auth?: Json;
  with: Json;
}

export interface WorkbenchSandboxTemplate {
  kind: WorkbenchSandboxTemplateKind;
  ref: string;
}

export type WorkbenchSandboxAllocationStatus = "allocated" | "running" | "stopping" | "stopped";

export interface WorkbenchSandboxAllocation {
  sandboxId: string;
  executionId: string;
  lifecycleId: string;
  backend: string;
  runnerId: string;
  template: WorkbenchSandboxTemplate;
  network: WorkbenchExecutionNetworkPolicy;
  status: WorkbenchSandboxAllocationStatus;
  createdAt: string;
  expiresAt: string;
}

export interface WorkbenchExecutionCapability {
  executionId: string;
  candidate: {
    tenantId: string;
    projectId: string;
    runId: string;
    candidateId?: string;
  };
  inputs: WorkbenchExecutionInputRef[];
  outputPrefix: string;
  network: WorkbenchExecutionNetworkPolicy;
  expiresAt: string;
}

export interface WorkbenchSandboxHandle {
  sandboxId: string;
  lifecycleId: string;
  backend: string;
  executionId: string;
  template: WorkbenchSandboxTemplate;
  metadata?: Record<string, Json>;
}

export interface WorkbenchSandboxExecutionMetadata {
  backend: string;
  allocation: WorkbenchSandboxAllocation;
  capability: WorkbenchExecutionCapability;
  handle: WorkbenchSandboxHandle;
}

export interface WorkbenchExecutionInputRef {
  name: string;
  ref: string;
  mountPath: string;
  writable: boolean;
}

export type WorkbenchExecutionOutputSchema =
  | "workbench.candidate_patch.v1"
  | "workbench.result.v1"
  | string;

export interface WorkbenchExecutionOutputContract {
  name: string;
  schema: WorkbenchExecutionOutputSchema;
  required: boolean;
}

export interface WorkbenchExecutionResources {
  cpu: number;
  memoryGb: number;
  diskGb: number;
  timeoutMinutes: number;
}

export interface WorkbenchExecutionNetworkPolicy {
  egress: "none" | "open";
}

export const WORKBENCH_EXECUTION_NETWORK_EGRESS_VALUES = [
  "none",
  "open",
] as const satisfies readonly WorkbenchExecutionNetworkPolicy["egress"][];

export function isWorkbenchExecutionNetworkEgress(
  value: unknown,
): value is WorkbenchExecutionNetworkPolicy["egress"] {
  return typeof value === "string" &&
    (WORKBENCH_EXECUTION_NETWORK_EGRESS_VALUES as readonly string[]).includes(value);
}

export interface WorkbenchExecutionPolicy {
  tenantId: string;
  resources: WorkbenchExecutionResources;
  network: WorkbenchExecutionNetworkPolicy;
}

export interface WorkbenchExecutionSpec {
  id: string;
  projectId: string;
  runId: string;
  candidateId?: string;
  purpose: WorkbenchExecutionPurpose;
  adapter: WorkbenchAdapterInvocation;
  sandbox: WorkbenchSandboxTemplate;
  inputs: WorkbenchExecutionInputRef[];
  outputs: WorkbenchExecutionOutputContract[];
  policy: WorkbenchExecutionPolicy;
  metadata: Record<string, Json>;
}

export interface WorkbenchCandidatePatch {
  files: SurfaceSnapshotFile[];
  fileChanges: string[];
  summary?: string;
  feedback?: Json;
}

export interface WorkbenchResult {
  score: number;
  metrics?: Record<string, number>;
  cases?: EvalCaseResult[];
  usage?: UsageSummary;
  summary?: string;
  feedback?: Json;
}

export interface WorkbenchExecutionResult {
  executionId: string;
  status: "succeeded" | "failed" | "cancelled";
  startedAt: string;
  finishedAt: string;
  outputs: Record<string, BlobObjectRef>;
  error?: string;
  metadata?: Record<string, Json>;
}

export type WorkbenchExecutionEventSource = "sandbox" | "adapter" | "command";
export type WorkbenchExecutionEventRole = "improver" | "runner" | "engine";
export type WorkbenchExecutionEventSchema =
  | "workbench.execution.step.v1"
  | "workbench.trace.delta.v1";

export interface WorkbenchExecutionEvent {
  seq: number;
  at: string;
  source: WorkbenchExecutionEventSource;
  role?: WorkbenchExecutionEventRole;
  schema: WorkbenchExecutionEventSchema;
  payload: Json;
}

export interface WorkbenchExecutionEventBatch {
  projectId: string;
  runId: string;
  jobId: string;
  executionId: string;
  attempt: number;
  seqStart: number;
  seqEnd: number;
  emittedAt: string;
  events: WorkbenchExecutionEvent[];
}

export type WorkbenchTraceSpanKind =
  | "hook"
  | "stage"
  | "turn"
  | "tool_call"
  | "assistant_output"
  | "usage"
  | "gate"
  | "action"
  | "error";

export type WorkbenchTraceSpanStatus =
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "warning";

export type WorkbenchTraceEventKind =
  | "status"
  | "message"
  | "output"
  | "usage"
  | "error"
  | "note";

export interface WorkbenchTraceSpan {
  id: string;
  parent_id: string | null;
  attempt_number: number;
  stage_id: string | null;
  stage_run_index: number | null;
  kind: WorkbenchTraceSpanKind;
  title: string;
  status: WorkbenchTraceSpanStatus;
  started_at: string;
  ended_at: string | null;
  attributes: Record<string, Json>;
}

export interface WorkbenchTraceEvent {
  id: string;
  span_id: string;
  attempt_number: number;
  stage_id: string | null;
  stage_run_index: number | null;
  kind: WorkbenchTraceEventKind;
  at: string;
  message: string;
  attributes: Record<string, Json>;
}

export interface WorkbenchTraceUsageSummary {
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  uncached_input_tokens: number | null;
  cached_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_output_tokens: number | null;
  total_tokens: number | null;
  total_cost_usd: number | null;
  cost_source: string | null;
  pricing_source: string | null;
}

export interface WorkbenchTraceSummary {
  attempt_number: number;
  stage_id: string | null;
  stage_run_index: number | null;
  status: WorkbenchTraceSpanStatus;
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  tool_call_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  usage?: WorkbenchTraceUsageSummary | null;
  final_output_present: boolean;
  error_message: string | null;
}

export interface WorkbenchExecutionTrace {
  trace_id: string;
  spans: WorkbenchTraceSpan[];
  events: WorkbenchTraceEvent[];
  summaries: WorkbenchTraceSummary[];
}

export interface WorkbenchTraceSession {
  id: string;
  jobId: string;
  role: WorkbenchExecutionEventRole;
  kind: string;
  label: string;
  sourcePath: string | null;
  trace: WorkbenchExecutionTrace;
  metadata?: Record<string, Json>;
}

export interface WorkbenchExecutionEvidence {
  id: string;
  kind: string;
  executionId: string | null;
  role: WorkbenchExecutionEventRole;
  status: RemoteWorkbenchJobStatus;
  jobIds: string[];
  executionIds: string[];
  candidateId?: string;
  caseId?: string;
  sampleIndex?: number;
  attemptIndex?: number;
  sessions: WorkbenchTraceSession[];
  trace: WorkbenchExecutionTrace;
}

export interface WorkbenchExecutionTraceDetail {
  projectId: string;
  runId: string;
  executions: WorkbenchExecutionEvidence[];
}

export interface AuthoredWorkbenchCaseSummary {
  id: string;
  slug: string;
  path: string;
  name: string;
  split?: string;
  fileCount: number;
}

export interface AuthoredWorkbenchSourceFile {
  path: string;
  content: string;
}

export interface AuthoredWorkbenchSourceDocument {
  path: string;
  exists: boolean;
  source_yaml: string;
  source_files: AuthoredWorkbenchSourceFile[];
  spec: AuthoredWorkbenchSourceSpec | null;
  cases: AuthoredWorkbenchCaseSummary[];
}

export type RemoteWorkbenchJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type RemoteWorkbenchJobKind = "execute";

export interface RemoteWorkbenchJob {
  id: string;
  projectId: string;
  runId: string;
  candidateId?: string;
  kind: RemoteWorkbenchJobKind;
  status: RemoteWorkbenchJobStatus;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  input: Json;
  output?: Json;
  error?: string;
}

export interface WorkbenchRemoteJobClaimRequest {
  schema: "workbench.remote.job.claim_request.v1";
  ownerUserId: string;
  projectId: string;
  runId: string;
  jobId: string;
  hostId: string;
  workerId?: string;
}

export type WorkbenchRemoteJobClaimDisposition = "claimed" | "delete" | "retry";

export type WorkbenchRemoteJobClaim =
  | WorkbenchRemoteJobClaimGranted
  | WorkbenchRemoteJobClaimMiss;

export interface WorkbenchRemoteJobClaimGranted {
  schema: "workbench.remote.job.claim.v1";
  claimed: true;
  disposition: "claimed";
  reason: "claimed";
  ownerUserId: string;
  projectId: string;
  runId: string;
  jobId: string;
  leaseToken: string;
  leaseUntil: string;
  job: RemoteWorkbenchJob;
  input: Json;
}

export interface WorkbenchRemoteJobClaimMiss {
  schema: "workbench.remote.job.claim.v1";
  claimed: false;
  disposition: Exclude<WorkbenchRemoteJobClaimDisposition, "claimed">;
  reason: string;
}

export interface WorkbenchRemoteJobRenewal {
  schema: "workbench.remote.job.renewal.v1";
  ownerUserId: string;
  projectId: string;
  runId: string;
  jobId: string;
  leaseToken: string;
}

export interface WorkbenchRemoteJobRenewalResult {
  schema: "workbench.remote.job.renewal_result.v1";
  renewed: boolean;
  leaseUntil?: string;
}

export interface WorkbenchRemoteJobProgress {
  schema: "workbench.remote.job.progress.v1";
  ownerUserId: string;
  leaseToken: string;
  batch: WorkbenchExecutionEventBatch;
}

export interface WorkbenchRemoteJobCompletion {
  schema: "workbench.remote.job.completion.v1";
  ownerUserId: string;
  projectId: string;
  runId: string;
  jobId: string;
  leaseToken: string;
  completedJob: RemoteWorkbenchJob;
  adapterAuthProfiles?: Json[];
}

export interface WorkbenchRemoteJobRetry {
  schema: "workbench.remote.job.retry.v1";
  ownerUserId: string;
  projectId: string;
  runId: string;
  jobId: string;
  leaseToken: string;
  reason: string;
}

export interface RemoteWorkbenchRun extends WorkbenchRuntimeRun {
  projectId: string;
  environmentVersionId?: string;
  specVersionId: string;
  candidateId: string | null;
  activeCandidateId?: string | null;
  outputCandidateId?: string | null;
  input: {
    benchmarkFingerprint: string;
    candidateFingerprint: string;
    baseCandidateId: string | null;
    payerUserId?: string;
    candidateOwnerUserId?: string;
    candidateOwnerUsername?: string;
    preserveActiveCandidateId?: string | null;
    selectedSamples?: Array<{ caseId: string; sampleIndex: number }>;
    sourceYaml?: string;
    candidateSourceFiles?: SurfaceSnapshotFile[];
    baseFiles: SurfaceSnapshotFile[];
    engineResolveFiles: SurfaceSnapshotFile[];
  };
  jobCount: number;
  completedJobCount: number;
  failedJobCount: number;
}
