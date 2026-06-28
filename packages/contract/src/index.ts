export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export * from "./run-evidence.js";

export interface SurfaceSnapshotFile {
  path: string;
  kind?: "text" | "binary";
  encoding?: "utf8" | "base64";
  content: string;
  executable?: boolean;
}

const WORKBENCH_RUNTIME_METADATA_DIRS = new Set([
  "objects",
  "refs",
  "sync",
  "live",
  "tmp",
  "logs",
  "locks",
]);

const WORKBENCH_RUNTIME_METADATA_FILES = new Set([
  ".gitignore",
  "remotes.yaml",
]);

const WORKBENCH_AUTHORED_CONTROL_DIRS = new Set([
  "cases",
  "environment",
]);

const WORKBENCH_AUTHORED_CONTROL_FILES = new Set([
  "eval.yaml",
  "agents.yaml",
  "versions.yaml",
]);

const WORKBENCH_PACKAGE_SOURCE_IGNORED_DIRS = new Set([
  ".agents",
  ".git",
  ".workbench",
  "node_modules",
  "__pycache__",
]);

const WORKBENCH_PACKAGE_SOURCE_IGNORED_FILES = new Set([
  ".DS_Store",
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

export function isWorkbenchRuntimeMetadataPath(filePath: string): boolean {
  const parts = normalizeWorkbenchSourcePath(filePath).split("/");
  return parts[0] === ".workbench" && (
    WORKBENCH_RUNTIME_METADATA_DIRS.has(parts[1] ?? "") ||
    WORKBENCH_RUNTIME_METADATA_FILES.has(parts[1] ?? "")
  );
}

export function isWorkbenchAuthoredControlPath(filePath: string): boolean {
  const parts = normalizeWorkbenchSourcePath(filePath).split("/");
  return parts[0] === ".workbench" && (
    WORKBENCH_AUTHORED_CONTROL_DIRS.has(parts[1] ?? "") ||
    WORKBENCH_AUTHORED_CONTROL_FILES.has(parts[1] ?? "")
  );
}

export function isWorkbenchPackageSourcePath(filePath: string): boolean {
  const parts = normalizeWorkbenchSourcePath(filePath).split("/");
  return !parts.some((part) => WORKBENCH_PACKAGE_SOURCE_IGNORED_DIRS.has(part)) &&
    !WORKBENCH_PACKAGE_SOURCE_IGNORED_FILES.has(parts.at(-1) ?? "");
}

export function isWorkbenchLiveInspectableProjectPath(filePath: string): boolean {
  return isWorkbenchPackageSourcePath(filePath) || isWorkbenchAuthoredControlPath(filePath);
}

export type WorkbenchInspectionFileOwnerKind = "version" | "trace" | "artifact" | "case" | "evaluation";

const WORKBENCH_CASE_FILE_OWNER_SEPARATOR = ":";

export function workbenchInspectionFileOwnerKindFromRouteSegment(
  value: string,
): WorkbenchInspectionFileOwnerKind | null {
  if (value === "versions") {
    return "version";
  }
  if (value === "traces") {
    return "trace";
  }
  if (value === "artifacts") {
    return "artifact";
  }
  if (value === "cases") {
    return "case";
  }
  if (value === "evaluation") {
    return "evaluation";
  }
  return null;
}

export function workbenchInspectionFileOwnerRouteSegment(
  kind: WorkbenchInspectionFileOwnerKind,
): string {
  if (kind === "version") {
    return "versions";
  }
  if (kind === "trace") {
    return "traces";
  }
  if (kind === "artifact") {
    return "artifacts";
  }
  if (kind === "evaluation") {
    return "evaluation";
  }
  return "cases";
}

export function workbenchCaseFileOwnerId(evaluationHash: string, caseId: string): string {
  return `${evaluationHash}${WORKBENCH_CASE_FILE_OWNER_SEPARATOR}${caseId}`;
}

export function parseWorkbenchCaseFileOwnerId(
  ownerId: string,
): { evaluationHash: string; caseId: string } | null {
  const [evaluationHash, ...caseIdParts] = ownerId.split(WORKBENCH_CASE_FILE_OWNER_SEPARATOR);
  const caseId = caseIdParts.join(WORKBENCH_CASE_FILE_OWNER_SEPARATOR);
  return evaluationHash && caseId ? { evaluationHash, caseId } : null;
}

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
  source?: string;
  label?: string;
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
  source?: string;
  label?: string;
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
  cases: WorkbenchEvalCaseSnapshot[];
  caseCount: number;
  createdAt: string;
  updatedAt: string;
  gradeAdapter: string;
}

export interface WorkbenchEvalCaseGradePlan {
  adapter: string;
  label: string;
  summary: string;
  sources: WorkbenchGradePlanSource[];
  display: WorkbenchGradePlanDisplayBlock[];
}

export interface WorkbenchGradePlanSource {
  path: string;
  role: "global" | "case" | "derived";
  note?: string;
}

export type WorkbenchGradePlanDisplayBlock =
  | { kind: "text"; title?: string; text: string }
  | { kind: "key_value"; title?: string; items: WorkbenchGradePlanKeyValue[] }
  | { kind: "list"; title?: string; items: WorkbenchGradePlanListItem[] }
  | { kind: "files"; title?: string; files: WorkbenchGradePlanFileRef[] };

export interface WorkbenchGradePlanKeyValue {
  label: string;
  value: string;
}

export interface WorkbenchGradePlanListItem {
  label: string;
  description?: string;
  meta?: string;
}

export interface WorkbenchGradePlanFileRef {
  path: string;
  role?: string;
}

export interface WorkbenchEvalCaseSnapshot {
  id: string;
  path: string;
  title?: string;
  description?: string;
  command?: string;
  grade: WorkbenchEvalCaseGradePlan;
  files: SurfaceSnapshotFile[];
}

export type WorkbenchCaseRunKind = "run" | "grade" | "eval";
export type WorkbenchRunKind = WorkbenchCaseRunKind | "improve" | "live";
export type WorkbenchRunLocation = "local" | "cloud";
export type WorkbenchRunStatus = "queued" | "running" | "canceling" | "succeeded" | "failed" | "canceled";
export type WorkbenchJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type WorkbenchArtifactKind = "file" | "directory" | "log" | "result";
export type WorkbenchOperationKind = "eval" | "improve";
export type WorkbenchOperationVariant = WorkbenchRunLocation;
export type WorkbenchJobRole = "execute" | "grade" | "improve" | string;
export type WorkbenchOperationPhase = "execute" | "grade";

export interface WorkbenchOperationTarget {
  skill?: string;
  versionId?: string;
  agent?: string;
}

export type WorkbenchOperationGrader =
  | { kind: "none" }
  | { kind: "evaluation" };

export interface WorkbenchEvalOperationRequest {
  kind: "eval";
  variant: WorkbenchOperationVariant;
  runId?: string;
  caseIds: readonly string[];
  targets: readonly WorkbenchOperationTarget[];
  phases: readonly WorkbenchOperationPhase[];
  grader?: WorkbenchOperationGrader;
  samples?: number;
  rerun?: boolean;
  gradeOfRunId?: string;
  retryOfRunId?: string;
}

export interface WorkbenchImproveOperationRequest {
  kind: "improve";
  variant: WorkbenchOperationVariant;
  runId?: string;
  target?: WorkbenchOperationTarget;
  versionId?: string;
  evalHash?: string;
  samples?: number;
  budget?: number;
  evidenceTraceIds?: readonly string[];
  retryOfRunId?: string;
}

export type WorkbenchOperationRequest = WorkbenchEvalOperationRequest | WorkbenchImproveOperationRequest;

export interface WorkbenchCaseMutationRequest {
  title?: string;
  prompt: string;
  expected?: string;
  metadata?: Json;
}

export interface WorkbenchCaseMutationResponse {
  caseId: string;
  path: string;
  evaluationHash?: string;
}

export interface WorkbenchOperationSelection {
  name: string;
  hash?: string;
}

export interface WorkbenchOperationPreview {
  kind: WorkbenchOperationKind;
  variant: WorkbenchOperationVariant;
  caseIds?: readonly string[];
  targets?: readonly WorkbenchOperationTarget[];
  phases?: readonly WorkbenchOperationPhase[];
  grader?: WorkbenchOperationGrader;
  canStart: boolean;
  versionId?: string;
  evalHash?: string;
  skills: readonly WorkbenchOperationSelection[];
  agents: readonly WorkbenchOperationSelection[];
  caseCount: number;
  samples: number;
  budget?: number;
  evidenceTraceIds?: readonly string[];
  evidenceCount?: number;
  disabledReason?: string;
  setupCommands?: readonly string[];
  cliEquivalent: string;
}

export interface WorkbenchOperationRouteTarget {
  kind: "run";
  runId: string;
}

export type WorkbenchRunPhase =
  | "planning"
  | "queued"
  | "syncing"
  | "running"
  | "improving"
  | "proof"
  | "materializing"
  | "canceling"
  | "complete";

export interface WorkbenchActiveJobSummary {
  jobId: string;
  caseId?: string;
  sample?: number;
  skillName?: string;
  agentName?: string;
  runningCount: number;
}

export interface WorkbenchRunProgressSummary {
  planned: number;
  completed: number;
  scored: number;
  failed: number;
  canceled: number;
  active?: WorkbenchActiveJobSummary;
  partialScore?: number;
  evidenceCount?: number;
  elapsedMs: number;
  lastProgressAt?: string;
}

export interface WorkbenchOperationPlanSummary {
  kind: WorkbenchRunKind;
  variant: WorkbenchOperationVariant;
  targets?: readonly WorkbenchOperationTarget[];
  phases?: readonly WorkbenchOperationPhase[];
  grader?: WorkbenchOperationGrader;
  versionId?: string;
  evalHash?: string;
  skills: readonly string[];
  agents: readonly string[];
  caseIds?: readonly string[];
  samples?: number;
  rerun?: boolean;
  budget?: number;
  retryOfRunId?: string;
}

export interface WorkbenchSampleCoverage {
  completed: number;
  planned: number;
}

export interface WorkbenchMeasurementSummary {
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
  runId: string;
  status: WorkbenchRunStatus;
  score?: number;
  coverage?: WorkbenchSampleCoverage;
  report?: WorkbenchJobReport;
  error?: string;
}

export interface WorkbenchRunSnapshot {
  schema: "workbench.run.v1";
  id: string;
  kind: WorkbenchRunKind;
  variant: WorkbenchRunLocation;
  status: WorkbenchRunStatus;
  phase: WorkbenchRunPhase;
  plan: WorkbenchOperationPlanSummary;
  progress: WorkbenchRunProgressSummary;
  report: WorkbenchJobReport;
  measurements: readonly WorkbenchMeasurementSummary[];
  result?: {
    score?: number;
    improvedVersionId?: string;
    switchedToVersionId?: string;
    error?: string;
  };
  retryOfRunId?: string;
  route: WorkbenchOperationRouteTarget;
  cursor?: string;
  cliEquivalent: string;
  next?: string;
}

export interface WorkbenchOperationCapability {
  enabled: boolean;
  defaultRequest: WorkbenchOperationRequest;
  preview?: WorkbenchOperationPreview;
  disabledReason?: string;
}

export interface WorkbenchAcquisitionOption {
  id: string;
  label: string;
  kind: "copy-command" | "copy-url" | "local-action";
  value: string;
}

export interface WorkbenchActionCapabilities {
  variant: WorkbenchOperationVariant;
  evidenceAccess: "full" | "source";
  run: WorkbenchOperationCapability;
  grade: WorkbenchOperationCapability;
  eval: WorkbenchOperationCapability;
  improve: WorkbenchOperationCapability;
  acquisition: readonly WorkbenchAcquisitionOption[];
}

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
  operationPlan?: WorkbenchOperationPlanSummary;
  jobIds?: string[];
  traceIds: string[];
  createdAt: string;
  finishedAt?: string;
  parentRunId?: string;
  location?: WorkbenchRunLocation;
  remoteName?: string;
  baseVersionId?: string;
  requestedSamples?: number;
  requestedBudget?: number;
  retryOfRunId?: string;
  cancelRequestedAt?: string;
  lastProgressAt?: string;
  outputVersionId?: string;
  error?: string;
}

export interface WorkbenchJob {
  id: string;
  runId: string;
  kind: WorkbenchRunKind;
  role?: WorkbenchJobRole;
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
  caseId: string;
  sample: number;
  status: WorkbenchJobStatus;
  adapter?: WorkbenchJobAdapterSummary;
  dependencies?: readonly WorkbenchJobDependency[];
  result?: WorkbenchJobResult;
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

export interface WorkbenchJobRoleReport {
  role: WorkbenchJobRole;
  jobCount: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  canceled: number;
  totalDurationMs?: number;
  costUsd?: number;
}

export interface WorkbenchJobReport {
  unitCount: number;
  jobCount: number;
  elapsedMs?: number;
  totalDurationMs?: number;
  roles: readonly WorkbenchJobRoleReport[];
}

export interface WorkbenchJobAdapterSummary {
  use: string;
  hash?: string;
}

export interface WorkbenchJobDependency {
  name: string;
  jobId?: string;
  artifactId?: string;
  traceIds?: readonly string[];
  mount: string;
  mode: "readonly" | "copy";
}

export interface WorkbenchResultItem {
  kind: "score" | "criterion" | "patch" | "metric" | "text" | "artifact" | string;
  id?: string;
  label?: string;
  value?: Json;
  score?: number;
  pass?: boolean;
  summary?: string;
  body?: string;
  path?: string;
  data?: Json;
}

export interface WorkbenchJobResult {
  summary?: string;
  error?: string;
  usage?: UsageSummary;
  items?: readonly WorkbenchResultItem[];
  payload?: Json;
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

export type WorkbenchTraceOrigin = "live" | "eval" | "imported";
export type WorkbenchTraceCaptureStatus = "capturing" | "captured" | "discarded";
export type WorkbenchTraceExecutionStatus = "running" | "completed" | "failed" | "canceled" | "unknown";
export type WorkbenchTraceGradeStatus = "ungraded" | "graded";
export type WorkbenchTraceReviewStatus = "unreviewed" | "passed" | "failed" | "deferred";
export type WorkbenchTracePromotionStatus = "none" | "promoted";

export interface WorkbenchTraceLifecycleStatus {
  capture: WorkbenchTraceCaptureStatus;
  execution: WorkbenchTraceExecutionStatus;
  grade: WorkbenchTraceGradeStatus;
  review: WorkbenchTraceReviewStatus;
  promotion: WorkbenchTracePromotionStatus;
}

export interface WorkbenchTraceSource {
  host?: string;
  sessionId?: string;
  turnId?: string;
  workspaceRoot?: string;
  command?: string;
}

export interface WorkbenchTraceSubject {
  type: "skill" | "case" | "agent" | "version" | "run" | "job";
  id: string;
  versionId?: string;
  confidence?: "exact" | "claimed" | "inferred";
  activation?: "workbench-owned" | "host-skill" | "explicit-invocation" | "manual" | "unknown";
}

export interface WorkbenchTraceLink {
  type: "run" | "job" | "case" | "version" | "agent" | "result" | "trace" | "promotion";
  id: string;
}

export interface WorkbenchTraceInput {
  prompt?: string;
  attachments?: SurfaceSnapshotFile[];
}

export interface WorkbenchTraceOutput {
  assistantText?: string;
  finalMessageId?: string;
}

export interface WorkbenchTraceReview {
  status: WorkbenchTraceReviewStatus;
  note?: string;
  tags?: string[];
  expected?: string;
  reviewedAt?: string;
  reviewer?: string;
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
  protocol?: "workbench.trace.v1";
  origin?: WorkbenchTraceOrigin;
  updatedAt?: string;
  source?: WorkbenchTraceSource;
  status?: WorkbenchTraceLifecycleStatus;
  subjects?: WorkbenchTraceSubject[];
  links?: WorkbenchTraceLink[];
  input?: WorkbenchTraceInput;
  output?: WorkbenchTraceOutput;
  spans?: WorkbenchTraceSpan[];
  events?: WorkbenchTraceEvent[];
  usage?: UsageSummary;
  artifacts?: SurfaceSnapshotFile[];
  review?: WorkbenchTraceReview;
  resultIds?: string[];
}

export type WorkbenchTracePromotionBlockerCode =
  | "trace_not_captured"
  | "trace_not_terminal"
  | "trace_prompt_required"
  | "trace_expected_required";

export type WorkbenchTracePromotionReadiness =
  | { ok: true }
  | {
      ok: false;
      code: WorkbenchTracePromotionBlockerCode;
      message: string;
      reviewStatus?: WorkbenchTraceReviewStatus;
    };

export interface WorkbenchTraceProjection {
  lifecycleStatus: string;
  reviewStatus: WorkbenchTraceReviewStatus;
  promotionStatus: WorkbenchTracePromotionStatus;
  prompt: string | null;
  output: string | null;
  promotionReadiness: WorkbenchTracePromotionReadiness;
}

export function workbenchTraceProjection(trace: WorkbenchTrace): WorkbenchTraceProjection {
  return {
    lifecycleStatus: workbenchTraceLifecycleStatus(trace),
    reviewStatus: workbenchTraceReviewStatus(trace),
    promotionStatus: trace.status?.promotion ?? "none",
    prompt: workbenchTracePrompt(trace),
    output: workbenchTraceOutputText(trace),
    promotionReadiness: workbenchTracePromotionReadiness(trace),
  };
}

export function workbenchTraceLifecycleStatus(trace: WorkbenchTrace): string {
  if (trace.status) {
    return `${trace.status.capture}/${trace.status.execution}/${trace.status.grade}`;
  }
  const result = traceObjectValue(trace.result);
  return typeof result?.status === "string" && result.status.trim()
    ? result.status.trim()
    : "unknown";
}

export function workbenchTraceReviewStatus(trace: WorkbenchTrace): WorkbenchTraceReviewStatus {
  const explicitReviewStatus = trace.review?.status;
  const lifecycleReviewStatus = trace.status?.review;
  return explicitReviewStatus && explicitReviewStatus !== "unreviewed"
    ? explicitReviewStatus
    : lifecycleReviewStatus ?? explicitReviewStatus ?? "unreviewed";
}

export function workbenchTracePrompt(trace: WorkbenchTrace): string | null {
  const inputPrompt = trimmedTraceString(trace.input?.prompt);
  if (inputPrompt) {
    return inputPrompt;
  }
  const request = traceObjectValue(trace.request);
  const requestInput = traceObjectValue(request?.input);
  const requestInputPrompt = trimmedTraceString(requestInput?.prompt);
  if (requestInputPrompt) {
    return requestInputPrompt;
  }
  const requestPrompt = trimmedTraceString(request?.prompt);
  if (requestPrompt) {
    return requestPrompt;
  }
  const promptEvent = trace.events?.find((event) => typeof event.attributes.prompt === "string");
  return trimmedTraceString(promptEvent?.attributes.prompt);
}

export function workbenchTraceOutputText(trace: WorkbenchTrace): string | null {
  const assistantText = trimmedTraceString(trace.output?.assistantText);
  if (assistantText) {
    return assistantText;
  }
  const result = traceObjectValue(trace.result);
  const resultOutput = traceObjectValue(result?.output);
  const resultAssistantText = trimmedTraceString(resultOutput?.assistantText);
  if (resultAssistantText) {
    return resultAssistantText;
  }
  return trimmedTraceString(result?.summary);
}

export function workbenchTracePromotionReadiness(trace: WorkbenchTrace): WorkbenchTracePromotionReadiness {
  if (trace.status?.capture && trace.status.capture !== "captured") {
    return {
      ok: false,
      code: "trace_not_captured",
      message: `Trace ${trace.id} is ${trace.status.capture}; promotion requires a captured trace.`,
    };
  }
  if (trace.status?.execution === "running") {
    return {
      ok: false,
      code: "trace_not_terminal",
      message: `Trace ${trace.id} is still running; promotion requires a terminal trace.`,
    };
  }
  if (!workbenchTracePrompt(trace)) {
    return {
      ok: false,
      code: "trace_prompt_required",
      message: `Trace ${trace.id} has no captured prompt; promotion requires trace input.`,
    };
  }
  const reviewStatus = workbenchTraceReviewStatus(trace);
  if ((reviewStatus === "failed" || reviewStatus === "deferred") && !trimmedTraceString(trace.review?.expected)) {
    return {
      ok: false,
      code: "trace_expected_required",
      message: `Trace ${trace.id} is reviewed as ${reviewStatus}; promotion requires an explicit expected correction.`,
      reviewStatus,
    };
  }
  return { ok: true };
}

function traceObjectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function trimmedTraceString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  environment?: WorkbenchEnvironmentStatus;
}

export interface WorkbenchEnvironmentStatus {
  path: string;
  state: "ready" | "missing" | "invalid";
  message?: string;
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
    workbenchProviderAuth?: "connected" | "missing";
    nativeAuth?: "present" | "partial" | "missing" | "not_required";
    setupCommands: string[];
    warnings: string[];
  };
}

interface WorkbenchRemoteSyncStateBase {
  schema: "workbench.remote-sync-state.v1";
  remote: string;
  url: string;
  lastAttemptAt: string;
  pushed?: number;
  pulled?: number;
}

export type WorkbenchRemoteSyncState = WorkbenchRemoteSyncedState | WorkbenchRemoteSyncErrorState;

export interface WorkbenchRemoteSyncedState extends WorkbenchRemoteSyncStateBase {
  status: "synced";
  localHash: string;
  lastSyncedAt: string;
  lastError: null;
}

export interface WorkbenchRemoteSyncErrorState extends WorkbenchRemoteSyncStateBase {
  status: "error";
  lastSyncedAt?: string;
  lastError: {
    code: string;
    message: string;
  } | null;
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
    sourceState?: "clean" | "edited" | "no_snapshot";
  };
  environment?: WorkbenchEnvironmentStatus;
  runs: {
    total: number;
    lastRunId?: string;
    lastStatus?: WorkbenchRunStatus;
    lastScore?: number;
    activeRuns?: Array<{
      id: string;
      kind: WorkbenchRunKind;
      location: WorkbenchRunLocation;
      status: WorkbenchRunStatus;
      skillName: string;
      agentName: string;
      failed: number;
      elapsedMs: number;
      lastProgressAt?: string;
      health: "healthy" | "stale_local_state" | "unknown";
      next: string;
    }>;
  };
  remotes: Array<{
    name: string;
    kind: WorkbenchRemoteKind;
    url: string;
    sync: {
      status: "up_to_date" | "local_changes" | "auth_required" | "error" | "never";
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
      currentVersionId?: string;
      publishedVersionIds?: string[];
      installHandle?: string;
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

export interface WorkbenchSkillVersion {
  id: string;
  label: string;
  source?: string;
  sourceKind?: WorkbenchSkillSourceKind;
  projectVersionId?: string;
  contentHash?: string;
  current?: boolean;
  published?: boolean;
  files?: SurfaceSnapshotFile[];
}

export interface WorkbenchAgentVersion {
  id: string;
  name: string;
  label: string;
  adapter: string;
  model?: string;
}

export interface WorkbenchEvalVersionSummary {
  id: string;
  hash: string;
  label: string;
  ordinal: number;
  current: boolean;
  caseCount: number;
  gradeAdapter: string;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  latestRunId?: string;
  latestQuality?: number;
}

export interface WorkbenchResultCell {
  skillVersionId: string;
  evalVersionId: string;
  agentVersionId: string;
  runId?: string;
  status?: WorkbenchRunStatus;
  quality?: number;
  coverage?: WorkbenchSampleCoverage;
  report?: WorkbenchJobReport;
  error?: string;
}

export interface WorkbenchResults {
  skillVersions: WorkbenchSkillVersion[];
  evalVersions: WorkbenchEvalVersionSummary[];
  agentVersions: WorkbenchAgentVersion[];
  cells: WorkbenchResultCell[];
}

export interface WorkbenchInspectionSnapshot {
  root: string;
  status: WorkbenchStatus;
  versions: WorkbenchVersion[];
  skillSources: WorkbenchSkillSource[];
  skillBundles: WorkbenchSkillBundleSnapshot[];
  evals: WorkbenchEvalSnapshot[];
  evalVersions: WorkbenchEvalVersionSummary[];
  evaluationFiles?: SurfaceSnapshotFile[];
  agents: WorkbenchAgentSnapshot[];
  results?: WorkbenchResults;
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

export interface WorkbenchInspectionSnapshotEnvelope {
  schema: "workbench.inspection.snapshot-envelope.v1";
  cursor: string;
  snapshot: WorkbenchInspectionSnapshot;
  actions: WorkbenchActionCapabilities;
}

export type WorkbenchStateNotice =
  | {
      schema: "workbench.state.notice.v1";
      type: "changed";
      cursor: string;
    }
  | {
      schema: "workbench.state.notice.v1";
      type: "reset";
      cursor: string;
    }
  | {
      schema: "workbench.state.notice.v1";
      type: "progress";
      cursor: string;
      runIds?: string[];
      jobIds?: string[];
    }
  | {
      schema: "workbench.state.notice.v1";
      type: "heartbeat";
      cursor: string;
    };

export interface WorkbenchPublication {
  currentVersionId: string;
  publishedVersionIds: string[];
  installHandle: string;
  visibility?: string;
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
