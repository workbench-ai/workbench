import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  Json,
  UsageSummary,
  WorkbenchResult,
  WorkbenchSkillPatch,
} from "@workbench-ai/workbench-contract";

import {
  normalizeWorkbenchEngineResolveResult,
  type WorkbenchEngineResolveResult,
} from "./engine-resolve-result.ts";
import type {
  WorkbenchAdapterOperation,
} from "./adapter-manifest.ts";
import {
  normalizeWorkbenchAdapterOperation,
} from "./adapter-manifest.ts";
import {
  normalizeSurfaceSnapshotFiles,
} from "./snapshot-files.ts";

export const WORKBENCH_ADAPTER_PROTOCOL = "workbench.adapter.v3";
export const WORKBENCH_ADAPTER_RESULT_PROTOCOL = "workbench.adapter-result.v1";
export const WORKBENCH_ADAPTER_RESULT_FILE = "workbench-result.json";

export interface WorkbenchAdapterOperationRequest {
  protocol: typeof WORKBENCH_ADAPTER_PROTOCOL;
  id: string;
  jobId?: string;
  progress?: WorkbenchAdapterProgress;
  operation: WorkbenchAdapterOperation;
  invocation: {
    use: string;
    with?: Json;
    auth?: Json;
  };
  auth?: Json;
  context?: {
    eval?: {
      name?: string;
      description?: string;
    };
    skill?: {
      id?: string;
      path?: string;
      prepare?: {
        command: string;
      };
      run?: {
        use: string;
        with?: Json;
        auth?: Json;
        command?: string;
      };
    };
    improve?: {
      edits?: string[];
    };
    attempt?: {
      attemptIndex?: number;
      sampleIndex?: number;
      caseId?: string;
    };
    case?: {
      id?: string;
      prompt?: string;
    };
  };
  paths: {
    workspace: string;
    output: string;
    result: string;
    case?: string;
    traces?: string;
    skill?: string;
    skills?: string;
    enginePrivate?: string;
  };
}

export interface WorkbenchAdapterProgress {
  projectId: string;
  runId: string;
  jobId: string;
  executionId: string;
  attempt: number;
  target: WorkbenchAdapterProgressTarget;
}

export interface WorkbenchAdapterProgressTarget {
  url: string;
  token: string;
  ownerUserId?: string;
  flushWindowMs?: number;
  transport?: "http" | "stdout" | "both";
}

export type WorkbenchAdapterOperationResultValue =
  | WorkbenchEngineResolveResult
  | WorkbenchResult
  | WorkbenchSkillPatch
  | Json
  | null;

export interface WorkbenchAdapterOperationResult<TValue extends WorkbenchAdapterOperationResultValue = WorkbenchAdapterOperationResultValue> {
  protocol: typeof WORKBENCH_ADAPTER_RESULT_PROTOCOL;
  operation: WorkbenchAdapterOperation;
  ok?: boolean;
  value?: TValue;
  summary?: string;
  feedback?: Json;
  usage?: UsageSummary;
}

export async function readWorkbenchAdapterOperationRequest(
  configuredPath?: string,
): Promise<WorkbenchAdapterOperationRequest> {
  const requestPath = configuredPath ?? process.env.WORKBENCH_ADAPTER_REQUEST;
  if (!requestPath) {
    throw new Error("WORKBENCH_ADAPTER_REQUEST is required.");
  }
  const parsed = JSON.parse(await fs.readFile(requestPath, "utf8")) as unknown;
  return normalizeWorkbenchAdapterOperationRequest(parsed);
}

export function normalizeWorkbenchAdapterOperationRequest(
  value: unknown,
): WorkbenchAdapterOperationRequest {
  const record = requiredJsonRecord(value, "adapter request");
  if (record.protocol !== WORKBENCH_ADAPTER_PROTOCOL) {
    throw new Error(`Adapter request protocol must be ${WORKBENCH_ADAPTER_PROTOCOL}.`);
  }
  const invocation = requiredJsonRecord(record.invocation, "adapter request invocation");
  const paths = requiredJsonRecord(record.paths, "adapter request paths");
  rejectUnknownJsonKeys(paths, "adapter request paths", [
    "workspace",
    "output",
    "result",
    "skill",
    "skills",
    "case",
    "traces",
    "enginePrivate",
  ]);
  const operation = requiredOperation(record.operation, "adapter request operation");
  const use = requiredString(invocation.use, "adapter request invocation.use");
  return {
    protocol: WORKBENCH_ADAPTER_PROTOCOL,
    id: requiredString(record.id, "adapter request id"),
    ...(typeof record.jobId === "string" ? { jobId: record.jobId } : {}),
    ...(record.progress !== undefined ? { progress: normalizeAdapterProgress(record.progress) } : {}),
    operation,
    invocation: {
      use,
      with: invocation.with !== undefined ? invocation.with as Json : {},
      ...(invocation.auth !== undefined ? { auth: invocation.auth as Json } : {}),
    },
    ...(record.auth !== undefined ? { auth: record.auth as Json } : {}),
    ...(record.context !== undefined ? { context: normalizeAdapterRequestContext(record.context) } : {}),
    paths: {
      workspace: requiredString(paths.workspace, "adapter request paths.workspace"),
      output: requiredString(paths.output, "adapter request paths.output"),
      result: requiredString(paths.result, "adapter request paths.result"),
      ...(typeof paths.case === "string" ? { case: paths.case } : {}),
      ...(typeof paths.traces === "string" ? { traces: paths.traces } : {}),
      ...(typeof paths.skill === "string" ? { skill: paths.skill } : {}),
      ...(typeof paths.skills === "string" ? { skills: paths.skills } : {}),
      ...(typeof paths.enginePrivate === "string" ? { enginePrivate: paths.enginePrivate } : {}),
    },
  };
}

function normalizeAdapterProgress(value: unknown): WorkbenchAdapterProgress {
  const record = requiredJsonRecord(value, "adapter request progress");
  return {
    projectId: requiredString(record.projectId, "adapter request progress.projectId"),
    runId: requiredString(record.runId, "adapter request progress.runId"),
    jobId: requiredString(record.jobId, "adapter request progress.jobId"),
    executionId: requiredString(record.executionId, "adapter request progress.executionId"),
    attempt: requiredPositiveInteger(record.attempt, "adapter request progress.attempt"),
    target: normalizeAdapterProgressTarget(record.target),
  };
}

function normalizeAdapterProgressTarget(value: unknown): WorkbenchAdapterProgressTarget {
  const record = requiredJsonRecord(value, "adapter request progress.target");
  const target: WorkbenchAdapterProgressTarget = {
    url: requiredString(record.url, "adapter request progress.target.url"),
    token: requiredString(record.token, "adapter request progress.target.token"),
  };
  if (record.ownerUserId !== undefined) {
    target.ownerUserId = requiredString(record.ownerUserId, "adapter request progress.target.ownerUserId");
  }
  if (record.flushWindowMs !== undefined) {
    target.flushWindowMs = requiredNonNegativeNumber(record.flushWindowMs, "adapter request progress.target.flushWindowMs");
  }
  if (record.transport !== undefined) {
    if (record.transport !== "http" && record.transport !== "stdout" && record.transport !== "both") {
      throw new Error("adapter request progress.target.transport must be http, stdout, or both.");
    }
    target.transport = record.transport;
  }
  return target;
}

export async function ensureWorkbenchAdapterOutputDir(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  await fs.mkdir(request.paths.output, { recursive: true });
}

export function workbenchAdapterOperationResultPath(outputRoot: string): string {
  return path.join(outputRoot, WORKBENCH_ADAPTER_RESULT_FILE);
}

export async function writeWorkbenchAdapterOperationResult<TValue extends WorkbenchAdapterOperationResultValue>(
  outputRoot: string,
  result: WorkbenchAdapterOperationResult<TValue>,
): Promise<void> {
  const normalized = normalizeWorkbenchAdapterOperationResult(result);
  const resultPath = workbenchAdapterOperationResultPath(outputRoot);
  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(normalized, null, 2)}\n`);
}

export async function readWorkbenchAdapterOperationResult(
  outputRoot: string,
  operation?: WorkbenchAdapterOperation,
): Promise<WorkbenchAdapterOperationResult> {
  const parsed = JSON.parse(
    await fs.readFile(workbenchAdapterOperationResultPath(outputRoot), "utf8"),
  ) as unknown;
  return normalizeWorkbenchAdapterOperationResult(parsed, operation);
}

export function normalizeWorkbenchAdapterOperationResult(
  value: unknown,
  operation?: WorkbenchAdapterOperation,
): WorkbenchAdapterOperationResult {
  const record = requiredJsonRecord(value, WORKBENCH_ADAPTER_RESULT_FILE);
  if (record.protocol !== WORKBENCH_ADAPTER_RESULT_PROTOCOL) {
    throw new Error(`${WORKBENCH_ADAPTER_RESULT_FILE}.protocol must be ${WORKBENCH_ADAPTER_RESULT_PROTOCOL}.`);
  }
  const resultOperation = requiredOperation(record.operation, `${WORKBENCH_ADAPTER_RESULT_FILE}.operation`);
  const expectedOperation = operation
    ? normalizeWorkbenchAdapterOperation(operation, "expected adapter result operation")
    : undefined;
  if (expectedOperation && resultOperation !== expectedOperation) {
    throw new Error(`${WORKBENCH_ADAPTER_RESULT_FILE}.operation must be ${expectedOperation}.`);
  }
  return {
    protocol: WORKBENCH_ADAPTER_RESULT_PROTOCOL,
    operation: resultOperation,
    ...(record.ok === true || record.ok === false ? { ok: record.ok } : {}),
    ...(record.value !== undefined
      ? { value: normalizeOperationResultValue(resultOperation, record.value) }
      : {}),
    ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
    ...(record.feedback !== undefined ? { feedback: record.feedback as Json } : {}),
    ...(record.usage !== undefined ? { usage: normalizeUsageSummary(record.usage) } : {}),
  };
}

export function assertWorkbenchAdapterOperationResultOk(
  result: WorkbenchAdapterOperationResult,
  label = "Adapter operation",
): void {
  if (result.ok !== false) {
    return;
  }
  throw new Error(
    `${label} returned ok false${result.summary ? `: ${result.summary}` : "."}`,
  );
}

function normalizeOperationResultValue(
  operation: WorkbenchAdapterOperation,
  value: unknown,
): WorkbenchAdapterOperationResultValue {
  if (operation === "engine.resolve") {
    return normalizeWorkbenchEngineResolveResult(value);
  }
  if (operation === "engine.run") {
    return normalizeResult(value, `${WORKBENCH_ADAPTER_RESULT_FILE}.value`);
  }
  if (operation === "skill.improve") {
    return normalizeSkillPatch(value, `${WORKBENCH_ADAPTER_RESULT_FILE}.value`);
  }
  if (value === undefined || value === null) {
    return null;
  }
  return value as Json;
}

function normalizeAdapterRequestContext(
  value: unknown,
): NonNullable<WorkbenchAdapterOperationRequest["context"]> {
  const record = requiredJsonRecord(value, "adapter request context");
  return {
    ...(record.eval !== undefined ? { eval: normalizeEvalContext(record.eval) } : {}),
    ...(record.skill !== undefined ? { skill: normalizeSkillContext(record.skill) } : {}),
    ...(record.improve !== undefined ? { improve: normalizeImproveContext(record.improve) } : {}),
    ...(record.attempt !== undefined ? { attempt: normalizeAttemptContext(record.attempt) } : {}),
    ...(record.case !== undefined ? { case: normalizeCaseContext(record.case) } : {}),
  };
}

function normalizeEvalContext(value: unknown): NonNullable<NonNullable<WorkbenchAdapterOperationRequest["context"]>["eval"]> {
  const record = requiredJsonRecord(value, "adapter request context.eval");
  return {
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    ...(typeof record.description === "string" ? { description: record.description } : {}),
  };
}

function normalizeSkillContext(value: unknown): NonNullable<NonNullable<WorkbenchAdapterOperationRequest["context"]>["skill"]> {
  const record = requiredJsonRecord(value, "adapter request context.skill");
  return {
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    ...(typeof record.path === "string" ? { path: record.path } : {}),
    ...(record.prepare !== undefined ? { prepare: normalizeSkillPrepareContext(record.prepare) } : {}),
    ...(record.run !== undefined ? { run: normalizeContextInvocation(record.run, "adapter request context.skill.run") } : {}),
  };
}

function normalizeSkillPrepareContext(
  value: unknown,
): NonNullable<NonNullable<NonNullable<WorkbenchAdapterOperationRequest["context"]>["skill"]>["prepare"]> {
  const record = requiredJsonRecord(value, "adapter request context.skill.prepare");
  return {
    command: requiredString(record.command, "adapter request context.skill.prepare.command"),
  };
}

function normalizeContextInvocation(
  value: unknown,
  label: string,
): NonNullable<NonNullable<NonNullable<WorkbenchAdapterOperationRequest["context"]>["skill"]>["run"]> {
  const record = requiredJsonRecord(value, label);
  const use = requiredString(record.use, `${label}.use`);
  return {
    use,
    with: record.with !== undefined ? record.with as Json : {},
    ...(record.auth !== undefined ? { auth: record.auth as Json } : {}),
    ...(typeof record.command === "string" && record.command.trim() ? { command: record.command } : {}),
  };
}

function normalizeImproveContext(value: unknown): NonNullable<NonNullable<WorkbenchAdapterOperationRequest["context"]>["improve"]> {
  const record = requiredJsonRecord(value, "adapter request context.improve");
  return {
    edits: Array.isArray(record.edits)
      ? record.edits.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

function normalizeAttemptContext(value: unknown): NonNullable<NonNullable<WorkbenchAdapterOperationRequest["context"]>["attempt"]> {
  const record = requiredJsonRecord(value, "adapter request context.attempt");
  return {
    ...(typeof record.attemptIndex === "number" ? { attemptIndex: record.attemptIndex } : {}),
    ...(typeof record.sampleIndex === "number" ? { sampleIndex: record.sampleIndex } : {}),
    ...(typeof record.caseId === "string" ? { caseId: record.caseId } : {}),
  };
}

function normalizeCaseContext(value: unknown): NonNullable<NonNullable<WorkbenchAdapterOperationRequest["context"]>["case"]> {
  const record = requiredJsonRecord(value, "adapter request context.case");
  return {
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    ...(typeof record.prompt === "string" ? { prompt: record.prompt } : {}),
  };
}

function normalizeResult(value: unknown, label: string): WorkbenchResult {
  const record = requiredJsonRecord(value, label);
  if (typeof record.score !== "number" || !Number.isFinite(record.score)) {
    throw new Error(`${label}.score must be a finite number.`);
  }
  return {
    score: record.score,
    ...(isNumberRecord(record.metrics) ? { metrics: record.metrics } : {}),
    ...(Array.isArray(record.cases) ? { cases: record.cases as unknown as WorkbenchResult["cases"] } : {}),
    ...(record.usage !== undefined ? { usage: normalizeUsageSummary(record.usage) } : {}),
    ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
    ...(record.feedback !== undefined ? { feedback: record.feedback as Json } : {}),
  };
}

function normalizeSkillPatch(value: unknown, label: string): WorkbenchSkillPatch {
  const record = requiredJsonRecord(value, label);
  if (!Array.isArray(record.fileChanges) || !record.fileChanges.every((entry) => typeof entry === "string")) {
    throw new Error(`${label}.fileChanges must be a string array.`);
  }
  return {
    files: normalizeSurfaceSnapshotFiles(record.files, `${label}.files`),
    fileChanges: [...record.fileChanges],
    ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
    ...(record.feedback !== undefined ? { feedback: record.feedback as Json } : {}),
  };
}

function normalizeUsageSummary(value: unknown): UsageSummary {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UsageSummary
    : {};
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function requiredJsonRecord(
  value: unknown,
  label: string,
): Record<string, Json> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, Json>;
}

function rejectUnknownJsonKeys(
  record: Record<string, unknown>,
  label: string,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} includes unsupported fields: ${unknown.join(", ")}.`);
  }
}

function requiredOperation(
  value: unknown,
  label: string,
): WorkbenchAdapterOperation {
  return normalizeWorkbenchAdapterOperation(value, label);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function requiredNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}
