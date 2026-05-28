export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export interface HostedWorkbenchProject {
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

export interface HostedWorkbenchProjectSummary {
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
  latestRun: HostedWorkbenchRun | null;
}

export interface WorkbenchSpecValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface HostedWorkbenchSpecVersion {
  id: string;
  projectId: string;
  ordinal: number;
  sourceYaml: string;
  createdAt: string;
  updatedAt: string;
  validation: WorkbenchSpecValidation;
}

export interface HostedWorkbenchEnvironment {
  id: string;
  name: string;
  description: string;
  currentVersionId: string;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HostedWorkbenchEnvironmentVersion {
  id: string;
  environmentId: string;
  name: string;
  spec: HostedWorkbenchEnvironmentSpec;
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

export interface HostedWorkbenchEnvironmentSpec {
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

export type HostedWorkbenchSnapshotKind =
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

export interface HostedWorkbenchFileInput {
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

export interface HostedWorkbenchSnapshotBase {
  files: SurfaceSnapshotFile[];
  updatedAt: string;
}

export interface HostedWorkbenchEngineResolveSnapshot
  extends HostedWorkbenchSnapshotBase {
  kind: "engineResolve";
  engineResolveBinding: EngineResolveBinding;
}

export interface HostedWorkbenchStandardSnapshot
  extends HostedWorkbenchSnapshotBase {
  kind: Exclude<HostedWorkbenchSnapshotKind, "engineResolve">;
}

export type HostedWorkbenchSnapshot =
  | HostedWorkbenchEngineResolveSnapshot
  | HostedWorkbenchStandardSnapshot;

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
  durationMs?: MetricStats;
  usage?: EvaluationUsageStats;
  error?: string;
}

export interface EvaluationScorecard extends EvaluationSummary {
  evaluation: EvaluationRecord;
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
  status: HostedWorkbenchJobStatus;
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
  status?: EvalCaseStatus | HostedWorkbenchJobStatus;
  metrics: Record<string, number>;
  durationMs?: number;
  source?: EvalCaseSource;
  feedback?: Json;
  executions: CandidateCaseExecutionRef[];
  criteria_results: CandidateCaseCriterionResult[];
}

export type RunStatus = "queued" | "running" | "finished";
export type RunOutcome = "ok" | "error" | "cancelled";
export type HostedRunWorkflow = "eval" | "improve";

export interface RunSummary {
  id: string;
  workflow: HostedRunWorkflow;
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
  status?: CandidateStatus | HostedWorkbenchJobStatus;
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

export interface AuthoredWorkbenchCandidateRunSpec extends WorkbenchAuthoredAdapterSpec {
  name: string;
}

export interface AuthoredWorkbenchCandidateImproveSpec extends WorkbenchAuthoredAdapterSpec {
  edits: string[];
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
  status: HostedWorkbenchJobStatus;
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

export type HostedWorkbenchJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type HostedWorkbenchJobKind = "execute";

export interface HostedWorkbenchJob {
  id: string;
  projectId: string;
  runId: string;
  candidateId?: string;
  kind: HostedWorkbenchJobKind;
  status: HostedWorkbenchJobStatus;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  leaseUntil?: string;
  wakeupLeaseUntil?: string;
  hostId?: string;
  workerId?: string;
  claimTokenHash?: string;
  input: Json;
  output?: Json;
  error?: string;
}

export interface HostedWorkbenchRun extends RunSummary {
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
