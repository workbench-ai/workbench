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
  activeSubjectId?: string | null;
  sourceFingerprint?: string;
  starCount: number;
  forkCount: number;
  forkedFrom?: WorkbenchProjectForkRef;
}

export interface WorkbenchProjectForkRef {
  projectId: string;
  ownerUserId: string;
  ownerUsername: string;
  benchmarkName: string;
  sourceRevisionId: string;
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
  activeSubjectId?: string | null;
  subjectCount: number;
  runCount: number;
  starCount: number;
  forkCount: number;
  viewerHasStarred?: boolean;
  forkedFrom?: WorkbenchProjectForkRef;
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
  | "subject"
  | "tasks"
  | "adapters"
  | "runtime";

export type WorkspaceWriteEncoding = "utf8" | "base64";

export interface SurfaceSnapshotFile {
  path: string;
  kind: "text" | "binary";
  encoding: WorkspaceWriteEncoding;
  content: string;
  executable: boolean;
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

export interface HostedWorkbenchSnapshot {
  kind: HostedWorkbenchSnapshotKind;
  files: SurfaceSnapshotFile[];
  updatedAt: string;
}

export type SubjectStatus =
  | "running"
  | "evaluated"
  | "checkpointed"
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

export interface SubjectCaseCriterionScore {
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
  criteria?: SubjectCaseCriterionScore[];
}

export type ExecutionRole = "optimizer" | "runner" | "scorer";
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
  optimizer?: ExecutionUsage;
  runner?: ExecutionUsage;
  scorer?: ExecutionUsage;
}

export interface EvaluationSubjectSummary {
  id: string;
  kind: "subject";
  label?: string;
}

export type EvaluationSampleStatus = "planned" | "running" | "completed" | "error";
export type EvaluationStatus = EvaluationSampleStatus | "partial";

export interface EvaluationSampleRecord {
  id: string;
  index: number;
  subject: EvaluationSubjectSummary;
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
  optimizer?: ExecutionUsageStats;
  runner?: ExecutionUsageStats;
  scorer?: ExecutionUsageStats;
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
  subject: EvaluationSubjectSummary;
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

export interface EvaluationResultSummary {
  id: string;
  runId: string;
  benchmarkFingerprint: string;
  subjectFingerprint: string;
  subjectId: string;
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

export interface EvaluationResultRecord extends EvaluationResultSummary {
  evaluation: EvaluationRecord;
}

export interface SubjectSummary {
  id: string;
  ordinal: number;
  benchmarkFingerprint: string;
  subjectFingerprint: string;
  ownerUserId?: string;
  ownerUsername?: string;
  visibility?: "private" | "public";
  createdAt: string;
  baseId?: string;
  referenceIds: string[];
  status: SubjectStatus;
  fileChanges: string[];
  metrics?: Record<string, number>;
  usage?: UsageSummary;
}

export interface SubjectRecord extends SubjectSummary {
  eval?: EvaluationRecord;
  prompt?: string;
  meta?: Json;
}

export interface SubjectLineageNode {
  id: string;
  active: boolean;
  summary: SubjectSummary;
}

export interface SubjectLineageEdge {
  id: string;
  kind: "anchor";
  sourceId: string;
  targetId: string;
}

export interface SubjectLineageGraph {
  activeId: string | null;
  nodes: SubjectLineageNode[];
  edges: SubjectLineageEdge[];
}

export type SubjectPreviewMode = "diff" | "raw" | "rendered";
export type SubjectPreviewKind =
  | "text"
  | "markdown"
  | "table"
  | "spreadsheet"
  | "image"
  | "pdf"
  | "unsupported";

export type SubjectPreviewSourceEncoding = "utf8" | "base64";
export type SubjectFileStatus = "added" | "modified" | "unchanged";

export interface SubjectFileSummary {
  path: string;
  old_path: string | null;
  status: SubjectFileStatus;
  mime_type: string | null;
  preview_kind: SubjectPreviewKind;
  additions: number;
  deletions: number;
}

export interface SubjectFilePreviewSource {
  content: string;
  encoding: SubjectPreviewSourceEncoding;
}

export interface SubjectFilePreview {
  path: string;
  view: SubjectPreviewMode;
  mime_type: string | null;
  preview_kind: SubjectPreviewKind;
  diff: string | null;
  source: SubjectFilePreviewSource | null;
  rendered_html: string | null;
}

export interface SubjectCaseCriterionResult {
  criterion_id: string;
  pass: boolean;
  score: number;
  errors: string[];
  rationale?: string;
}

export type SubjectCasePhasePurpose = "trial";

export interface SubjectCasePhaseRef {
  runId: string;
  phase: SubjectCasePhasePurpose;
  role: "runner" | "scorer";
  status: HostedWorkbenchJobStatus;
  jobIds: string[];
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  sampleIndex?: number;
}

export interface SubjectCaseReview {
  subjectId: string;
  caseId: string;
  caseLabel: string;
  sampleId?: string;
  sampleIndex?: number;
  status?: EvalCaseStatus | HostedWorkbenchJobStatus;
  metrics: Record<string, number>;
  durationMs?: number;
  source?: EvalCaseSource;
  feedback?: Json;
  phases: SubjectCasePhaseRef[];
  criteria_results: SubjectCaseCriterionResult[];
}

export type RunStatus = "queued" | "running" | "finished";
export type RunOutcome = "ok" | "error" | "cancelled";
export type HostedRunWorkflow = "eval" | "improve";

export interface RunSummary {
  id: string;
  workflow: HostedRunWorkflow;
  benchmarkFingerprint: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  optimizer: string;
  score: string;
  strategy: string;
  budget: number;
  repairBudget: number;
  trialsRequested: number;
  trialsExecuted: number;
  samples: number;
  sampleConcurrency: number;
  stoppedReason?: "budget_exhausted" | "completed" | "dry_run" | "cancelled";
  outcome?: RunOutcome;
  error?: string;
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
    | "subject_created"
    | "subject_evaluated"
    | "active_changed"
    | "run_finished";
  runId?: string;
  jobId?: string;
  subjectId?: string;
  baseId?: string;
  activeId?: string;
  status?: SubjectStatus | HostedWorkbenchJobStatus;
  metrics?: Record<string, number>;
  detail?: Record<string, Json>;
}

export interface RuntimeSnapshot {
  workspaceRoot: string;
  activeId: string | null;
  currentBenchmarkFingerprint: string | null;
  summaries: SubjectSummary[];
  results: EvaluationResultSummary[];
  events: RuntimeEvent[];
  latestRun: RunSummary | null;
  runs: RunSummary[];
}

export interface AuthoredWorkbenchSubjectSpec {
  name: string;
  description?: string;
  files: WorkbenchPathRef;
  run: AuthoredWorkbenchRunSpec;
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
    egress?: "none" | "allowlist" | "open";
    allow?: string[];
  };
}

export type AuthoredWorkbenchImproveSpec = WorkbenchAuthoredAdapterSpec;

export type AuthoredWorkbenchRunSpec = WorkbenchAuthoredAdapterSpec;

export type AuthoredWorkbenchScoreSpec = WorkbenchAuthoredAdapterSpec;

export interface AuthoredWorkbenchBenchmarkSpec {
  name: string;
  description: string;
  tasks: WorkbenchPathRef;
  environment: AuthoredWorkbenchRuntimeSpec;
  score: AuthoredWorkbenchScoreSpec;
}

export interface AuthoredWorkbenchOptimizerSpec {
  name: string;
  description?: string;
  edits: string[];
  improve: AuthoredWorkbenchImproveSpec;
}

export interface AuthoredWorkbenchSourceSpec {
  version: 2;
  benchmark: AuthoredWorkbenchBenchmarkSpec;
  subject: AuthoredWorkbenchSubjectSpec;
  optimizer?: AuthoredWorkbenchOptimizerSpec;
}

export type WorkbenchExecutionPurpose = "improve" | "trial";

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
  subject: {
    tenantId: string;
    projectId: string;
    runId: string;
    subjectId?: string;
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
  | "workbench.subject_patch.v1"
  | "workbench.scorecard.v1"
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
  egress: "none" | "allowlist" | "open";
  allow?: string[];
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
  subjectId?: string;
  purpose: WorkbenchExecutionPurpose;
  adapter: WorkbenchAdapterInvocation;
  sandbox: WorkbenchSandboxTemplate;
  inputs: WorkbenchExecutionInputRef[];
  outputs: WorkbenchExecutionOutputContract[];
  policy: WorkbenchExecutionPolicy;
  metadata: Record<string, Json>;
}

export interface WorkbenchSubjectPatch {
  files: SurfaceSnapshotFile[];
  fileChanges: string[];
  summary?: string;
  feedback?: Json;
}

export interface WorkbenchScorecard {
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
export type WorkbenchExecutionEventRole = "optimizer" | "runner" | "scorer";
export type WorkbenchExecutionEventSchema =
  | "workbench.execution.phase.v1"
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

export interface WorkbenchTracePhase {
  phase: WorkbenchExecutionPurpose;
  executionId: string | null;
  role: WorkbenchExecutionEventRole;
  status: HostedWorkbenchJobStatus;
  jobIds: string[];
  subjectId?: string;
  caseId?: string;
  sampleIndex?: number;
  trialIndex?: number;
  trace: WorkbenchExecutionTrace;
}

export interface WorkbenchExecutionTraceDetail {
  projectId: string;
  runId: string;
  phases: WorkbenchTracePhase[];
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
  subjectId?: string;
  kind: HostedWorkbenchJobKind;
  status: HostedWorkbenchJobStatus;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  leaseUntil?: string;
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
  subjectId: string | null;
  input: {
    benchmarkFingerprint: string;
    subjectFingerprint: string;
    baseSubjectId: string | null;
    subjectOwnerUserId?: string;
    subjectOwnerUsername?: string;
    sourceYaml?: string;
    subjectSourceFiles?: SurfaceSnapshotFile[];
    baseFiles: SurfaceSnapshotFile[];
    taskSourceFiles: SurfaceSnapshotFile[];
  };
  jobCount: number;
  completedJobCount: number;
  failedJobCount: number;
}
