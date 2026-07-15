import { normalizeWorkbenchSourcePath } from "./source-path.js";
import type {
  ExecutionTrace,
  TraceEvent,
  TraceSpan,
} from "@workbench-ai/agent-driver";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export interface WorkbenchCloudErrorBody {
  schema: "workbench.cloud.error.v1";
  code: string;
  message: string;
  retryable: boolean;
  remediation?: string;
  subject?: Record<string, Json>;
}

export function workbenchCloudErrorBody(
  error: Omit<WorkbenchCloudErrorBody, "schema">,
): WorkbenchCloudErrorBody {
  const remediation = error.remediation
    ? normalizeWorkbenchCommandRemediation(error.remediation)
    : undefined;
  return {
    schema: "workbench.cloud.error.v1",
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(remediation ? { remediation } : {}),
    ...(error.subject ? { subject: error.subject } : {}),
  };
}

export function parseWorkbenchCloudErrorBody(text: string): WorkbenchCloudErrorBody | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (record.schema !== "workbench.cloud.error.v1" || typeof record.code !== "string" || typeof record.message !== "string") {
      return null;
    }
    const subject = record.subject && typeof record.subject === "object" && !Array.isArray(record.subject)
      ? record.subject as Record<string, Json>
      : undefined;
    const remediation = typeof record.remediation === "string"
      ? normalizeWorkbenchCommandRemediation(record.remediation)
      : undefined;
    return workbenchCloudErrorBody({
      code: record.code,
      message: record.message,
      retryable: record.retryable === true,
      ...(remediation ? { remediation } : {}),
      ...(subject ? { subject } : {}),
    });
  } catch {
    return null;
  }
}

export function normalizeWorkbenchCommandRemediation(value: string): string | undefined {
  const trimmed = value.trim();
  return /^(?:workbench|codex|claude|npm|mkdir)\b/u.test(trimmed) || /^[A-Z_][A-Z0-9_]*=.*\bworkbench\b/u.test(trimmed)
    ? trimmed
    : undefined;
}

export * from "./run-evidence.js";
export * from "./ordering.js";
export * from "./source-evals.js";
export { normalizeWorkbenchSourcePath } from "./source-path.js";
export {
  parseWorkbenchProjectState,
  isWorkbenchJson,
  WorkbenchStateValidationError,
} from "./state-validation.js";

export interface SurfaceSnapshotFile {
  path: string;
  kind?: "text" | "binary";
  encoding?: "utf8" | "base64";
  content: string;
  executable?: boolean;
}

export interface WorkbenchSkillPackageSnapshot {
  schema: "workbench.skill-package.snapshot.v1";
  owner: string;
  name: string;
  versionId: string;
  files: Array<{
    path: string;
    kind?: SurfaceSnapshotFile["kind"];
    encoding?: SurfaceSnapshotFile["encoding"];
    executable?: boolean;
    content: string;
  }>;
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

export type WorkbenchInspectionFileOwnerKind = "version" | "trace" | "artifact" | "case";

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
  content: string;
}

export function workbenchInspectionFileContent(
  file: SurfaceSnapshotFile,
): WorkbenchInspectionFileContent {
  return { ...workbenchInspectionFileManifest(file), content: file.content };
}

export function workbenchInspectionFileManifest(file: SurfaceSnapshotFile): SurfaceSnapshotFile {
  return {
    path: file.path,
    content: "",
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
  grade: WorkbenchGradePlan;
  gradeAdapters: WorkbenchGradeAdapterOption[];
  cases: WorkbenchEvalCaseSnapshot[];
  caseCount: number;
  createdAt: string;
  updatedAt: string;
}

export type WorkbenchGradePlanAdapterSource = "eval" | "case";

export interface WorkbenchGradePlan {
  adapter: string;
  adapterSource: WorkbenchGradePlanAdapterSource;
  label: string;
  summary: string;
  sources: WorkbenchGradePlanSource[];
  display: WorkbenchGradePlanDisplayBlock[];
  authoring: WorkbenchGradePlanAuthoringControl[];
}

export interface WorkbenchGradeAdapterOption {
  adapter: string;
  label: string;
  authoring: WorkbenchGradePlanAuthoringControl[];
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

export interface WorkbenchGradePlanAuthoringBase {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
}

export interface WorkbenchGradePlanAuthoringChoiceOption {
  value: string;
  label: string;
  description?: string;
}

export type WorkbenchGradePlanAuthoringListField =
  | {
      kind: "text";
      name: string;
      label: string;
      description?: string;
      placeholder?: string;
      defaultValue?: string;
      required?: boolean;
      multiline?: boolean;
    }
  | {
      kind: "number";
      name: string;
      label: string;
      description?: string;
      defaultValue?: number;
      required?: boolean;
      min?: number;
      max?: number;
      step?: number;
    }
  | {
      kind: "choice";
      name: string;
      label: string;
      description?: string;
      defaultValue?: string;
      required?: boolean;
      options: readonly WorkbenchGradePlanAuthoringChoiceOption[];
    };

export type WorkbenchGradePlanAuthoringControl =
  | (WorkbenchGradePlanAuthoringBase & {
      kind: "text";
      placeholder?: string;
      defaultValue?: string;
      multiline?: boolean;
    })
  | (WorkbenchGradePlanAuthoringBase & {
      kind: "list";
      itemLabel?: string;
      minItems?: number;
      maxItems?: number;
      fields: readonly WorkbenchGradePlanAuthoringListField[];
      defaultItems?: readonly Record<string, Json>[];
    })
  | (WorkbenchGradePlanAuthoringBase & {
      kind: "choice";
      options: readonly WorkbenchGradePlanAuthoringChoiceOption[];
      defaultValue?: string;
    })
  | (WorkbenchGradePlanAuthoringBase & {
      kind: "file";
      path: string;
      language?: string;
      defaultValue?: string;
      executable?: boolean;
    })
  | {
      kind: "notice";
      name: string;
      label: string;
      message: string;
    };

export interface WorkbenchGradePlanAuthoringIssue {
  name: string;
  message: string;
  path?: readonly (string | number)[];
}

type WorkbenchGradePlanAuthoringListControl = Extract<WorkbenchGradePlanAuthoringControl, { kind: "list" }>;

export function workbenchGradePlanAuthoringListItemDefault(
  control: WorkbenchGradePlanAuthoringListControl,
): Record<string, Json> {
  const item: Record<string, Json> = {};
  for (const field of control.fields) {
    if (field.kind === "choice") {
      item[field.name] = field.defaultValue ?? field.options[0]?.value ?? "";
      continue;
    }
    if (field.kind === "number") {
      if (field.defaultValue !== undefined) {
        item[field.name] = field.defaultValue;
      }
      continue;
    }
    item[field.name] = field.defaultValue ?? "";
  }
  return item;
}

export function workbenchGradePlanAuthoringDefaults(
  controls: readonly WorkbenchGradePlanAuthoringControl[],
): Record<string, Json> {
  const values: Record<string, Json> = {};
  for (const control of controls) {
    if (control.kind === "notice") {
      continue;
    }
    if (control.kind === "list") {
      values[control.name] = control.defaultItems && control.defaultItems.length > 0
        ? control.defaultItems.map((entry) => copyJson(entry) as Record<string, Json>)
        : Array.from({ length: control.minItems ?? 0 }, () => workbenchGradePlanAuthoringListItemDefault(control));
      continue;
    }
    if (control.kind === "choice") {
      values[control.name] = control.defaultValue ?? control.options[0]?.value ?? "";
      continue;
    }
    values[control.name] = control.defaultValue ?? "";
  }
  return values;
}

export function workbenchGradePlanAuthoringValues(
  controls: readonly WorkbenchGradePlanAuthoringControl[],
  values: Record<string, Json> = {},
): Record<string, Json> {
  const effective = workbenchGradePlanAuthoringDefaults(controls);
  const declaredNames = new Set(controls
    .filter((control) => control.kind !== "notice")
    .map((control) => control.name));
  for (const [name, value] of Object.entries(values)) {
    if (declaredNames.has(name)) {
      effective[name] = copyJson(value);
    }
  }
  return effective;
}

export function workbenchGradePlanAuthoringIssues(
  controls: readonly WorkbenchGradePlanAuthoringControl[],
  values: Record<string, Json> = {},
  options: { pathLabel?: string } = {},
): WorkbenchGradePlanAuthoringIssue[] {
  const issues: WorkbenchGradePlanAuthoringIssue[] = [];
  const pathLabel = options.pathLabel ?? "Case grade.authoring";
  const declaredNames = new Set(controls
    .filter((control) => control.kind !== "notice")
    .map((control) => control.name));
  for (const name of Object.keys(values)) {
    if (!declaredNames.has(name)) {
      issues.push({
        name,
        message: `${pathLabel}.${name} is not supported by this grader.`,
        path: [name],
      });
    }
  }
  const effective = workbenchGradePlanAuthoringValues(controls, values);
  for (const control of controls) {
    validateWorkbenchGradePlanAuthoringControlValue(control, effective[control.name], issues);
  }
  return issues;
}

function validateWorkbenchGradePlanAuthoringControlValue(
  control: WorkbenchGradePlanAuthoringControl,
  value: Json | undefined,
  issues: WorkbenchGradePlanAuthoringIssue[],
): void {
  if (control.kind === "notice") {
    return;
  }
  if (control.kind === "list") {
    validateWorkbenchGradePlanAuthoringListValue(control, value, issues);
    return;
  }
  if (control.kind === "choice") {
    validateWorkbenchGradePlanAuthoringChoiceValue(control, value, issues);
    return;
  }
  if (typeof value !== "string") {
    if (control.required) {
      issues.push({ name: control.name, message: `${control.label} is required.`, path: [control.name] });
    }
    return;
  }
  if (control.required && !value.trim()) {
    issues.push({ name: control.name, message: `${control.label} is required.`, path: [control.name] });
  }
}

function validateWorkbenchGradePlanAuthoringChoiceValue(
  control: Extract<WorkbenchGradePlanAuthoringControl, { kind: "choice" }>,
  value: Json | undefined,
  issues: WorkbenchGradePlanAuthoringIssue[],
): void {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    if (control.required) {
      issues.push({ name: control.name, message: `${control.label} is required.`, path: [control.name] });
    }
    return;
  }
  if (!control.options.some((option) => option.value === text)) {
    issues.push({ name: control.name, message: `${control.label} has an unsupported value.`, path: [control.name] });
  }
}

function validateWorkbenchGradePlanAuthoringListValue(
  control: WorkbenchGradePlanAuthoringListControl,
  value: Json | undefined,
  issues: WorkbenchGradePlanAuthoringIssue[],
): void {
  if (!Array.isArray(value)) {
    issues.push({ name: control.name, message: `${control.label} must be a list.`, path: [control.name] });
    return;
  }
  let validItemCount = 0;
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push({ name: control.name, message: `${control.itemLabel ?? "Item"} ${index + 1} must be an object.`, path: [control.name, index] });
      return;
    }
    const item = entry as Record<string, Json>;
    if (!workbenchGradePlanAuthoringListItemHasContent(control, item)) {
      return;
    }
    const issueCount = issues.length;
    for (const field of control.fields) {
      validateWorkbenchGradePlanAuthoringListFieldValue(control, field, item[field.name], index, issues);
    }
    if (issues.length === issueCount) {
      validItemCount += 1;
    }
  });
  if ((control.minItems ?? 0) > validItemCount) {
    const itemLabel = (control.itemLabel ?? "item").toLowerCase();
    issues.push({
      name: control.name,
      message: `${control.label} requires at least ${control.minItems} ${itemLabel}${control.minItems === 1 ? "" : "s"}.`,
      path: [control.name],
    });
  }
}

function validateWorkbenchGradePlanAuthoringListFieldValue(
  control: WorkbenchGradePlanAuthoringListControl,
  field: WorkbenchGradePlanAuthoringListField,
  value: Json | undefined,
  index: number,
  issues: WorkbenchGradePlanAuthoringIssue[],
): void {
  if (field.kind === "number") {
    if (value === undefined || value === "") {
      if (field.required) {
        issues.push({ name: control.name, message: `${field.label} is required.`, path: [control.name, index, field.name] });
      }
      return;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push({ name: control.name, message: `${field.label} must be a number.`, path: [control.name, index, field.name] });
      return;
    }
    if (field.min !== undefined && value < field.min) {
      issues.push({ name: control.name, message: `${field.label} must be at least ${field.min}.`, path: [control.name, index, field.name] });
    }
    if (field.max !== undefined && value > field.max) {
      issues.push({ name: control.name, message: `${field.label} must be at most ${field.max}.`, path: [control.name, index, field.name] });
    }
    return;
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    if (field.required) {
      issues.push({ name: control.name, message: `${field.label} is required.`, path: [control.name, index, field.name] });
    }
    return;
  }
  if (field.kind === "choice" && !field.options.some((option) => option.value === text)) {
    issues.push({ name: control.name, message: `${field.label} has an unsupported value.`, path: [control.name, index, field.name] });
  }
}

function workbenchGradePlanAuthoringListItemHasContent(
  control: WorkbenchGradePlanAuthoringListControl,
  item: Record<string, Json>,
): boolean {
  return control.fields.some((field) => {
    const value = item[field.name];
    if (field.kind === "number") {
      return typeof value === "number" && Number.isFinite(value);
    }
    return typeof value === "string" && value.trim().length > 0;
  });
}

function copyJson(value: Json): Json {
  if (Array.isArray(value)) {
    return value.map(copyJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copyJson(entry)]));
  }
  return value;
}

export interface WorkbenchEvalCaseSnapshot {
  id: string;
  path: string;
  description?: string;
  command?: string;
  grade: WorkbenchGradePlan;
  files: SurfaceSnapshotFile[];
}

export type WorkbenchCaseRunKind = "run" | "grade" | "eval";
export type WorkbenchRunKind = WorkbenchCaseRunKind | "improve";
export type WorkbenchRunLocation = "local" | "cloud";
export type WorkbenchRunStatus = "queued" | "running" | "canceling" | "succeeded" | "failed" | "canceled";
export type WorkbenchJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export function isWorkbenchRunStatusTerminal(status: WorkbenchRunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

export function isWorkbenchJobStatusTerminal(status: WorkbenchJobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

export type WorkbenchOperationVariant = WorkbenchRunLocation;
export type WorkbenchJobRole = string;
export type WorkbenchOperationStep = "run" | "grade";

export function workbenchOperationStepsForRunKind(
  kind: WorkbenchCaseRunKind,
): WorkbenchOperationStep[] {
  if (kind === "run") {
    return ["run"];
  }
  if (kind === "grade") {
    return ["grade"];
  }
  return ["run", "grade"];
}

export function workbenchRunKindForOperationSteps(
  steps: readonly WorkbenchOperationStep[],
): WorkbenchCaseRunKind {
  const hasRun = steps.includes("run");
  const hasGrade = steps.includes("grade");
  if (hasRun && hasGrade) {
    return "eval";
  }
  return hasGrade ? "grade" : "run";
}

export interface WorkbenchOperationTarget {
  skill?: string;
  versionId?: string;
  agent?: string;
}

export interface WorkbenchEvalOperationRequest {
  kind: "eval";
  variant: WorkbenchOperationVariant;
  runId?: string;
  evalHash?: string;
  caseIds: readonly string[];
  targets: readonly WorkbenchOperationTarget[];
  steps: readonly WorkbenchOperationStep[];
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

export interface WorkbenchGradeMutationRequest {
  adapter: string;
  authoring?: Record<string, Json>;
}

export interface WorkbenchGradeMutationResponse {
  path: string;
  evaluationHash?: string;
}

export interface WorkbenchCaseMutationRequest {
  caseId?: string;
  title?: string;
  prompt: string;
  grade?: WorkbenchCaseGradeMutation;
  metadata?: Json;
}

export interface WorkbenchCaseGradeMutation {
  adapter?: string;
  authoring?: Record<string, Json>;
}

export interface WorkbenchCaseMutationResponse {
  caseId: string;
  path: string;
  evaluationHash?: string;
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
  steps?: readonly WorkbenchOperationStep[];
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
  evidenceAccess: "full" | "package";
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
  jobIds: string[];
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
  projectId?: string;
  runId: string;
  kind: WorkbenchRunKind;
  role: WorkbenchJobRole;
  inputHash: string;
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
  caseId: string;
  sample: number;
  status: WorkbenchJobStatus;
  attempt?: number;
  updatedAt?: string;
  input?: WorkbenchExecutionJobInput;
  output?: Json;
  adapter?: WorkbenchJobAdapterSummary;
  dependencies?: readonly WorkbenchJobDependency[];
  result?: WorkbenchJobResult;
  command?: string;
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
  createdAt: string;
  files: SurfaceSnapshotFile[];
}

export type WorkbenchTraceExecutionStatus = "running" | "completed" | "failed" | "canceled" | "unknown";

export interface WorkbenchTraceSource {
  adapterId?: string;
  sessionId?: string;
  turnId?: string;
  command?: string;
}

export interface WorkbenchTraceLink {
  type: "run" | "job" | "case" | "version" | "agent" | "result" | "trace";
  id: string;
}

export interface WorkbenchTraceInput {
  prompt?: string;
}

export interface WorkbenchTraceOutput {
  assistantText?: string;
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
  updatedAt?: string;
  source?: WorkbenchTraceSource;
  status?: WorkbenchTraceExecutionStatus;
  links?: WorkbenchTraceLink[];
  input?: WorkbenchTraceInput;
  output?: WorkbenchTraceOutput;
  spans?: WorkbenchTraceSpan[];
  events?: WorkbenchTraceEvent[];
}

export interface WorkbenchTraceProjection {
  lifecycleStatus: string;
  prompt: string | null;
  output: string | null;
}

export function workbenchTraceProjection(trace: WorkbenchTrace): WorkbenchTraceProjection {
  return {
    lifecycleStatus: workbenchTraceLifecycleStatus(trace),
    prompt: workbenchTracePrompt(trace),
    output: workbenchTraceOutputText(trace),
  };
}

export function workbenchTraceLifecycleStatus(trace: WorkbenchTrace): string {
  return trace.status ?? "unknown";
}

export function workbenchTracePrompt(trace: WorkbenchTrace): string | null {
  return trimmedTraceString(trace.input?.prompt);
}

export function workbenchTraceOutputText(trace: WorkbenchTrace): string | null {
  return trimmedTraceString(trace.output?.assistantText);
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
export type WorkbenchSkillVisibility = "private" | "internal" | "public";

export function isWorkbenchSkillVisibility(value: unknown): value is WorkbenchSkillVisibility {
  return value === "private" || value === "internal" || value === "public";
}

export interface WorkbenchRemote {
  name: string;
  url: string;
  kind: WorkbenchRemoteKind;
}

export function workbenchPublishedSkillVersionRefMatches(versionId: string, ref: string): boolean {
  const normalized = ref.trim();
  const withoutVersionPrefix = normalized.startsWith("v_") ? normalized.slice(2) : normalized;
  return versionId === normalized ||
    versionId.startsWith(normalized) ||
    versionId.startsWith(`v_${withoutVersionPrefix}`);
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
  currentVersionId?: string;
  defaultSkill?: string;
  defaultAgent?: string;
  runCount: number;
  pendingSyncCount?: number;
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
  jobIds?: readonly string[];
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

export function workbenchInspectionSnapshotManifest(
  snapshot: WorkbenchInspectionSnapshot,
  options: { includeEvidence?: boolean } = {},
): WorkbenchInspectionSnapshot {
  const fileManifests = (files: readonly SurfaceSnapshotFile[]) =>
    files.map(workbenchInspectionFileManifest);
  const authored = {
    ...snapshot,
    versions: snapshot.versions.map((version) => ({
      ...version,
      files: fileManifests(version.files),
    })),
    skillBundles: snapshot.skillBundles.map((bundle) => ({
      ...bundle,
      files: fileManifests(bundle.files),
    })),
    evals: snapshot.evals.map((evalSnapshot) => ({
      ...evalSnapshot,
      files: fileManifests(evalSnapshot.files),
      cases: evalSnapshot.cases.map((evalCase) => ({
        ...evalCase,
        files: fileManifests(evalCase.files),
      })),
    })),
  };
  if (options.includeEvidence === false) {
    return authored;
  }
  return {
    ...authored,
    ...(snapshot.results ? {
      results: {
        ...snapshot.results,
        skillVersions: snapshot.results.skillVersions.map((version) => ({
          ...version,
          ...(version.files ? { files: fileManifests(version.files) } : {}),
        })),
      },
    } : {}),
    traces: snapshot.traces.map((trace) => ({ ...trace, files: fileManifests(trace.files) })),
    artifacts: snapshot.artifacts.map((artifact) => ({ ...artifact, files: fileManifests(artifact.files) })),
  };
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

export function createWorkbenchStateNotice(
  type: WorkbenchStateNotice["type"],
  cursor: string,
  progress: { runIds?: readonly string[]; jobIds?: readonly string[] } = {},
): WorkbenchStateNotice {
  if (type === "progress") {
    return {
      schema: "workbench.state.notice.v1",
      type,
      cursor,
      ...(progress.runIds?.length ? { runIds: [...progress.runIds] } : {}),
      ...(progress.jobIds?.length ? { jobIds: [...progress.jobIds] } : {}),
    };
  }
  return { schema: "workbench.state.notice.v1", type, cursor };
}

export function clampWorkbenchInspectionWaitTimeout(timeoutMs: number | undefined): number {
  return timeoutMs === undefined || !Number.isFinite(timeoutMs)
    ? 25_000
    : Math.max(1_000, Math.min(30_000, Math.trunc(timeoutMs)));
}

export interface WorkbenchPublication {
  currentVersionId: string;
  publishedVersionIds: string[];
  installHandle: string;
  visibility?: WorkbenchSkillVisibility;
}

export interface WorkbenchObjectPack extends Omit<WorkbenchProjectState, "schema" | "root" | "remotes"> {
  schema: "workbench.object-pack.v1";
  createdAt: string;
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
  status: "succeeded" | "failed" | "canceled";
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

export type WorkbenchTraceSpan = TraceSpan;
export type WorkbenchTraceEvent = TraceEvent;
export type WorkbenchExecutionTrace = ExecutionTrace;

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

export interface WorkbenchPlannedExecutionJobInput {
  execution: WorkbenchExecutionSpec;
  dependsOn: readonly string[];
  versionId: string;
  attemptIndex: number;
  sampleIndex: number;
  caseId: string;
  baseFiles?: readonly SurfaceSnapshotFile[];
  traceFiles?: readonly SurfaceSnapshotFile[];
  baseId?: string;
  subjectJobId?: string;
  role?: WorkbenchJobRole;
  skillName?: string;
  skillBundleHash?: string;
  evalHash?: string;
  agentName?: string;
  smoke?: boolean;
  skillEval?: true;
  skillImprove?: true;
}

export interface WorkbenchWakeupExecutionJobInput {
  skillEval: true;
  skillId: string;
  runId: string;
  jobId: string;
  role: WorkbenchJobRole;
  caseId: string;
  sample: number;
}

export interface WorkbenchImproveWakeupExecutionJobInput {
  skillImprove: true;
  skillId: string;
  runId: string;
  jobId: string;
  role: "improve";
  caseId: string;
  sample: number;
}

export type WorkbenchExecutionJobInput =
  | WorkbenchPlannedExecutionJobInput
  | WorkbenchWakeupExecutionJobInput
  | WorkbenchImproveWakeupExecutionJobInput;

export type WorkbenchExecutionJob = WorkbenchJob & {
  projectId: string;
  attempt: number;
  updatedAt: string;
  input: WorkbenchExecutionJobInput;
};

export interface WorkbenchExecutionEvidence {
  id: string;
  kind: string;
  executionId: string | null;
  role: WorkbenchExecutionEventRole;
  status: WorkbenchJobStatus;
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

export type WorkbenchRemoteJobClaim<TInput> =
  | WorkbenchRemoteJobClaimGranted<TInput>
  | WorkbenchRemoteJobClaimMiss;

export interface WorkbenchRemoteJobClaimGranted<TInput> {
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
  job: WorkbenchExecutionJob;
  input: TInput;
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
  completedJob: WorkbenchExecutionJob;
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

export type WorkbenchAdapterAuthStatus =
  | "connected"
  | "reauth_required"
  | "disconnected";

export interface WorkbenchAdapterAuthTarget {
  adapterId: string;
  slot?: string;
  profile: string;
}

export interface WorkbenchAdapterAuthFile {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  mode?: number;
}

export interface WorkbenchAdapterAuthEnvVar {
  name: string;
  value: string;
}

export interface WorkbenchAdapterAuthBundle extends WorkbenchAdapterAuthTarget {
  method: string;
  status: "connected";
  version: number;
  files: WorkbenchAdapterAuthFile[];
  env?: WorkbenchAdapterAuthEnvVar[];
  updatedAt: string;
}

export interface WorkbenchAdapterAuthStatusRecord extends WorkbenchAdapterAuthTarget {
  status: WorkbenchAdapterAuthStatus;
  version: number;
  method?: string;
  updatedAt?: string;
  reason?: string;
}

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

export function normalizeWorkbenchAdapterAuthTarget(target: {
  adapterId: string;
  slot?: string;
  profile?: string;
}): WorkbenchAdapterAuthTarget {
  const adapterId = readWorkbenchAdapterAuthSegment(target.adapterId, "adapter id");
  const slot = target.slot === undefined
    ? undefined
    : readWorkbenchAdapterAuthSegment(target.slot, "auth slot");
  const profile = target.profile
    ? readWorkbenchAdapterAuthSegment(target.profile, "auth profile")
    : "default";
  return {
    adapterId,
    ...(slot ? { slot } : {}),
    profile,
  };
}

export function sanitizeWorkbenchAdapterAuthBundle(
  value: unknown,
): WorkbenchAdapterAuthBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Adapter auth bundle must be an object.");
  }
  const record = value as Record<string, unknown>;
  const target = normalizeWorkbenchAdapterAuthTarget({
    adapterId: readWorkbenchAdapterAuthString(record.adapterId, "adapterId"),
    ...(record.slot !== undefined
      ? { slot: readWorkbenchAdapterAuthString(record.slot, "slot") }
      : {}),
    profile: typeof record.profile === "string" ? record.profile : "default",
  });
  if (record.status !== "connected") {
    throw new Error("Adapter auth bundle must be connected.");
  }
  const method = readWorkbenchAdapterAuthSegment(
    readWorkbenchAdapterAuthString(record.method, "method"),
    "auth method",
  );
  const files = Array.isArray(record.files)
    ? record.files.map(sanitizeWorkbenchAdapterAuthFile)
    : [];
  const env = Array.isArray(record.env)
    ? record.env.map(sanitizeWorkbenchAdapterAuthEnvVar)
    : [];
  if (files.length === 0 && env.length === 0) {
    throw new Error("Adapter auth bundle must include files or env.");
  }
  return {
    ...target,
    method,
    status: "connected",
    version: typeof record.version === "number" && Number.isInteger(record.version)
      ? record.version
      : 1,
    files,
    ...(env.length > 0 ? { env } : {}),
    updatedAt: typeof record.updatedAt === "string"
      ? record.updatedAt
      : new Date().toISOString(),
  };
}

function sanitizeWorkbenchAdapterAuthFile(value: unknown): WorkbenchAdapterAuthFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Adapter auth file must be an object.");
  }
  const record = value as Record<string, unknown>;
  const filePath = readWorkbenchAdapterAuthString(record.path, "file.path")
    .replace(/\\/gu, "/")
    .replace(/^\/+|\/+$/gu, "");
  if (!filePath || filePath.split("/").some((part) => part === "." || part === ".." || !part)) {
    throw new Error(`Unsafe adapter auth file path: ${filePath}`);
  }
  return {
    path: filePath,
    content: readWorkbenchAdapterAuthString(record.content, "file.content"),
    encoding: record.encoding === "base64" ? "base64" : "utf8",
    ...(typeof record.mode === "number" && Number.isInteger(record.mode)
      ? { mode: record.mode }
      : {}),
  };
}

function sanitizeWorkbenchAdapterAuthEnvVar(value: unknown): WorkbenchAdapterAuthEnvVar {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Adapter auth env entry must be an object.");
  }
  const record = value as Record<string, unknown>;
  const name = readWorkbenchAdapterAuthString(record.name, "env.name");
  const envValue = readWorkbenchAdapterAuthString(record.value, "env.value");
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(name)) {
    throw new Error(`Adapter auth env var is invalid: ${name}`);
  }
  assertWorkbenchAdapterAuthEnvNameAllowed(name);
  if (!envValue.trim()) {
    throw new Error(`Adapter auth env var ${name} is empty.`);
  }
  return { name, value: envValue };
}

function readWorkbenchAdapterAuthString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Adapter auth ${label} must be a non-empty string.`);
  }
  return value;
}

function readWorkbenchAdapterAuthSegment(value: string, label: string): string {
  if (!/^[a-z][a-z0-9-]*$/u.test(value)) {
    throw new Error(`Adapter auth ${label} must be a lowercase identifier.`);
  }
  return value;
}
