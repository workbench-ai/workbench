export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export interface SurfaceSnapshotFile {
  path: string;
  kind?: "text" | "binary";
  encoding?: "utf8" | "base64";
  content: string;
  executable?: boolean;
}

const WORKBENCH_METADATA_DIRS = new Set([
  "objects",
  "refs",
  "sync",
  "tmp",
  "logs",
  "locks",
]);

const WORKBENCH_METADATA_FILES = new Set([
  ".gitignore",
  "remotes.yaml",
]);

export function normalizeWorkbenchSourcePath(filePath: string): string {
  const normalized = filePath.replace(/\\/gu, "/");
  if (!normalized || normalized.includes("\0")) {
    throw new Error("Workbench source paths must be non-empty relative paths.");
  }
  if (normalized.startsWith("/")) {
    throw new Error(`Unsafe Workbench source path: ${filePath}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Unsafe Workbench source path: ${filePath}`);
  }
  return normalized;
}

export function normalizeWorkbenchSourceRequestPath(filePath: string): string {
  return normalizeWorkbenchSourcePath(filePath.replace(/^\/+/u, ""));
}

export function normalizeWorkbenchSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
}

export function isWorkbenchLocalMetadataPath(filePath: string): boolean {
  const parts = normalizeWorkbenchSourcePath(filePath).split("/");
  return parts[0] === ".workbench" && (
    WORKBENCH_METADATA_DIRS.has(parts[1] ?? "") ||
    WORKBENCH_METADATA_FILES.has(parts[1] ?? "")
  );
}

export type WorkbenchInspectionFileOwnerKind = "version" | "trace" | "artifact";

export interface WorkbenchInspectionFileContent {
  path: string;
  kind?: SurfaceSnapshotFile["kind"];
  encoding?: SurfaceSnapshotFile["encoding"];
  executable?: boolean;
  content?: string;
  unavailableReason?: string;
}

export function workbenchInspectionFileContentUnavailableReason(
  file: Pick<SurfaceSnapshotFile, "kind" | "encoding">,
): string | null {
  if (file.kind === "binary") {
    return "Binary file content is not rendered.";
  }
  if (file.encoding === "base64") {
    return "Base64 file content is not rendered.";
  }
  return null;
}

export function workbenchInspectionFileContent(
  file: SurfaceSnapshotFile,
): WorkbenchInspectionFileContent {
  const metadata = workbenchInspectionFileMetadata(file);
  const unavailableReason = workbenchInspectionFileContentUnavailableReason(file);
  return unavailableReason
    ? { ...metadata, unavailableReason }
    : { ...metadata, content: file.content };
}

export function workbenchInspectionFileManifest(file: SurfaceSnapshotFile): SurfaceSnapshotFile {
  return {
    ...file,
    content: "",
  };
}

function workbenchInspectionFileMetadata(
  file: SurfaceSnapshotFile,
): WorkbenchInspectionFileContent {
  return {
    path: file.path,
    ...(file.kind ? { kind: file.kind } : {}),
    ...(file.encoding ? { encoding: file.encoding } : {}),
    ...(file.executable !== undefined ? { executable: file.executable } : {}),
  };
}

export interface WorkbenchAgent {
  name: string;
  adapter: string;
  model?: string;
  config: Record<string, Json>;
}

export interface WorkbenchAgentSnapshot {
  hash: string;
  agent: WorkbenchAgent;
}

export type WorkbenchSkillSourceKind = "local" | "remote" | "none";
export type WorkbenchSkillIncludeKind = Exclude<WorkbenchSkillSourceKind, "none">;

export interface WorkbenchSkillInclude {
  name: string;
  kind: WorkbenchSkillIncludeKind;
  path?: string;
  from?: string;
  ref?: string;
  resolvedRef?: string;
  hash?: string;
  files?: SurfaceSnapshotFile[];
}

export interface WorkbenchSkillSource {
  name: string;
  kind: WorkbenchSkillSourceKind;
  path?: string;
  from?: string;
  ref?: string;
  resolvedRef?: string;
  hash?: string;
  includes?: WorkbenchSkillInclude[];
}

export interface WorkbenchSkillBundleSnapshot {
  hash: string;
  skillName: string;
  entryName: string;
  source: WorkbenchSkillSource;
  files: SurfaceSnapshotFile[];
  includedSkills: WorkbenchSkillInclude[];
  createdAt: string;
}

export interface WorkbenchVersion {
  id: string;
  hash: string;
  message: string;
  parentIds: string[];
  createdAt: string;
  files: SurfaceSnapshotFile[];
}

export interface WorkbenchEvalSnapshot {
  hash: string;
  files: SurfaceSnapshotFile[];
  caseCount: number;
  createdAt: string;
  updatedAt: string;
  scoreAdapter: string;
}

export type WorkbenchRunKind = "eval" | "improve" | "compare";
export type WorkbenchRunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type WorkbenchJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type WorkbenchArtifactKind = "file" | "directory" | "log" | "scorecard";

export interface WorkbenchRun {
  id: string;
  kind: WorkbenchRunKind;
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
  status: WorkbenchRunStatus;
  score?: number;
  costUsd?: number;
  latencyMs?: number;
  jobIds?: string[];
  traceIds: string[];
  createdAt: string;
  finishedAt?: string;
  parentRunId?: string;
  outputVersionId?: string;
  error?: string;
}

export interface WorkbenchJob {
  id: string;
  runId: string;
  kind: WorkbenchRunKind;
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
  caseId: string;
  sample: number;
  status: WorkbenchJobStatus;
  score?: number;
  command?: string;
  dockerImage?: string;
  exitCode?: number;
  artifactIds: string[];
  traceIds: string[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
}

export interface WorkbenchArtifact {
  id: string;
  runId: string;
  jobId: string;
  kind: WorkbenchArtifactKind;
  path: string;
  createdAt: string;
  files: SurfaceSnapshotFile[];
}

export interface WorkbenchTrace {
  id: string;
  runId: string;
  jobId?: string;
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash?: string;
  agentName: string;
  agentHash?: string;
  createdAt: string;
  request: Json;
  result: Json;
  files: SurfaceSnapshotFile[];
}

export interface WorkbenchLineageEdge {
  parentId: string;
  childId: string;
  runId?: string;
  reason: "version" | "improve";
  createdAt: string;
  message?: string;
}

export type WorkbenchRemoteKind = "workbench-cloud" | "file";

export interface WorkbenchRemote {
  name: string;
  url: string;
  kind: WorkbenchRemoteKind;
}

export interface WorkbenchRefs {
  current?: string;
  [name: string]: string | undefined;
}

export interface WorkbenchProjectState {
  schema: "workbench.skill.state.v1";
  root: string;
  refs: WorkbenchRefs;
  remotes: Record<string, WorkbenchRemote>;
  versions: WorkbenchVersion[];
  skillSources: WorkbenchSkillSource[];
  skillBundles: WorkbenchSkillBundleSnapshot[];
  evals: WorkbenchEvalSnapshot[];
  agents: WorkbenchAgent[];
  runs: WorkbenchRun[];
  jobs: WorkbenchJob[];
  traces: WorkbenchTrace[];
  executionEvents: WorkbenchExecutionEventBatch[];
  artifacts: WorkbenchArtifact[];
  lineage: WorkbenchLineageEdge[];
}

export interface WorkbenchStatus {
  root: string;
  initialized: boolean;
  createdPaths?: string[];
  defaultAgentSelection?: WorkbenchDefaultAgentSelection;
  currentSkillHash?: string;
  currentVersionId?: string;
  defaultSkill?: string;
  defaultAgent?: string;
  versionCount: number;
  skillCount: number;
  agentCount: number;
  runCount: number;
  remoteCount: number;
  pendingSyncCount?: number;
  lastScore?: number;
}

export interface WorkbenchDefaultAgentSelection {
  name: string;
  adapter: string;
  model?: string;
  auth?: string;
  kind: "provider" | "deterministic";
  reason: string;
  readiness: {
    state: "ready" | "partial" | "missing" | "deterministic";
    executable?: boolean;
    workbenchAuth?: "connected" | "missing";
    nativeAuth?: "present" | "partial" | "missing";
    setupCommands: string[];
    warnings: string[];
  };
}

export interface WorkbenchRemoteSyncState {
  schema: "workbench.remote-sync-state.v1";
  remote: string;
  url: string;
  status: "synced" | "error";
  localHash?: string;
  lastSyncedAt?: string;
  lastAttemptAt: string;
  lastError?: {
    code: string;
    message: string;
  } | null;
  pushed?: number;
  pulled?: number;
}

export interface WorkbenchStatusSnapshot {
  schema: "workbench.status.v1";
  ok: true;
  project: {
    root: string;
    initialized: boolean;
    currentVersionId?: string;
    defaultSkill?: string;
    defaultAgent?: string;
  };
  worktree: {
    latestVersionId?: string;
  };
  runs: {
    total: number;
    lastRunId?: string;
    lastStatus?: WorkbenchRunStatus;
    lastScore?: number;
  };
  remotes: Array<{
    name: string;
    kind: WorkbenchRemoteKind;
    url: string;
    sync: {
      status: "up_to_date" | "local_changes" | "error" | "never";
      lastSyncedAt?: string;
      lastAttemptAt?: string;
      lastError?: {
        code: string;
        message: string;
      } | null;
    };
    publication: {
      status: "published" | "unpublished";
      visibility?: string;
      versionId?: string;
      installUrl?: string;
      pinnedInstallUrl?: string;
    };
  }>;
  auth?: {
    workbenchCloud: {
      status: "authenticated" | "not_authenticated";
      baseUrl?: string;
      username?: string;
    };
    adapters: Array<{
      adapter: string;
      slot?: string;
      profile: string;
      status: string;
      method?: string;
      updatedAt?: string;
    }>;
  };
  next: string | null;
}

export interface WorkbenchComparisonCell {
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
  runId?: string;
  status?: WorkbenchRunStatus;
  score?: number;
  costUsd?: number;
  latencyMs?: number;
  error?: string;
}

export interface WorkbenchComparison {
  evalHash?: string;
  versions: WorkbenchVersion[];
  skills: WorkbenchSkillBundleSnapshot[];
  agents: WorkbenchAgentSnapshot[];
  cells: WorkbenchComparisonCell[];
}

export interface WorkbenchInspectionSnapshot {
  root: string;
  status: WorkbenchStatus;
  versions: WorkbenchVersion[];
  skillSources: WorkbenchSkillSource[];
  skillBundles: WorkbenchSkillBundleSnapshot[];
  evals: WorkbenchEvalSnapshot[];
  agents: WorkbenchAgentSnapshot[];
  comparison?: WorkbenchComparison;
  runs: WorkbenchRun[];
  jobs: WorkbenchJob[];
  traces: WorkbenchTrace[];
  executionEvents: WorkbenchExecutionEventBatch[];
  artifacts: WorkbenchArtifact[];
  lineage: WorkbenchLineageEdge[];
  remotes: WorkbenchRemote[];
  refs: WorkbenchRefs;
  publication?: WorkbenchPublication;
}

export interface WorkbenchPublication {
  versionId: string;
  installUrl: string;
  pinnedInstallUrl: string;
}

export interface WorkbenchObjectPack {
  schema: "workbench.object-pack.v1";
  createdAt: string;
  refs: WorkbenchRefs;
  versions: WorkbenchVersion[];
  skillSources: WorkbenchSkillSource[];
  skillBundles: WorkbenchSkillBundleSnapshot[];
  evals: WorkbenchEvalSnapshot[];
  agents: WorkbenchAgent[];
  runs: WorkbenchRun[];
  jobs: WorkbenchJob[];
  traces: WorkbenchTrace[];
  executionEvents: WorkbenchExecutionEventBatch[];
  artifacts: WorkbenchArtifact[];
  lineage: WorkbenchLineageEdge[];
}

export interface WorkbenchFilePreview {
  path: string;
  source?: SurfaceSnapshotFile;
  renderedText?: string;
  diff?: string;
}

export interface WorkbenchFileSurface {
  files: SurfaceSnapshotFile[];
  preview: WorkbenchFilePreview | null;
}

export interface WorkbenchSpecValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
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

export interface EngineResolveBinding {
  engine: string;
  resolver: {
    use: string;
    withFingerprint: string;
  };
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
  skill: {
    tenantId: string;
    projectId: string;
    runId: string;
    versionId?: string;
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
  | "workbench.skill_patch.v1"
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
  versionId?: string;
  purpose: WorkbenchExecutionPurpose;
  adapter: WorkbenchAdapterInvocation;
  sandbox: WorkbenchSandboxTemplate;
  inputs: WorkbenchExecutionInputRef[];
  outputs: WorkbenchExecutionOutputContract[];
  policy: WorkbenchExecutionPolicy;
  metadata: Record<string, Json>;
}

export interface BlobObjectRef {
  bucket: string;
  key: string;
  byteLength: number;
  sha256: string;
}

export interface WorkbenchSkillPatch {
  files: SurfaceSnapshotFile[];
  fileChanges: string[];
  summary?: string;
  feedback?: Json;
}

export interface WorkbenchCaseCriterionScore {
  criterion_id: string;
  label: string;
  score: number;
  pass: boolean;
  errors?: string[];
  rationale?: string;
}

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

export interface EvalCaseResult {
  id: string;
  label?: string;
  split?: string;
  status?: EvalCaseStatus;
  durationMs?: number;
  metrics: Record<string, number>;
  source?: EvalCaseSource;
  feedback?: Json;
  criteria?: WorkbenchCaseCriterionScore[];
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
  reasoningOutputTokens?: MetricStats;
  outputTokens?: MetricStats;
  totalTokens?: MetricStats;
  costUsd?: MetricStats;
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

export type RemoteWorkbenchJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type RemoteWorkbenchJobKind = "execute";

export interface RemoteWorkbenchJob {
  id: string;
  projectId: string;
  runId: string;
  versionId?: string;
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

export interface WorkbenchExecutionEvidence {
  id: string;
  kind: string;
  executionId: string | null;
  role: WorkbenchExecutionEventRole;
  status: RemoteWorkbenchJobStatus;
  jobIds: string[];
  executionIds: string[];
  versionId?: string;
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
