import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  Json,
  UsageSummary,
  WorkbenchScorecard,
  WorkbenchSubjectPatch,
} from "@workbench-ai/workbench-contract";

import {
  normalizeWorkbenchTaskSourceResult,
  type WorkbenchTaskSourceResult,
} from "./task-source-result.ts";
import type {
  WorkbenchAdapterOperation,
} from "./adapter-manifest.ts";

export const WORKBENCH_ADAPTER_PROTOCOL = "workbench.adapter.v2";
export const WORKBENCH_ADAPTER_RESULT_PROTOCOL = "workbench.adapter-result.v1";
export const WORKBENCH_ADAPTER_RESULT_FILE = "workbench-result.json";

export interface WorkbenchAdapterOperationRequest {
  protocol: typeof WORKBENCH_ADAPTER_PROTOCOL;
  id: string;
  jobId?: string;
  operation: WorkbenchAdapterOperation;
  invocation: {
    use: string;
    with?: Json;
    auth?: Json;
  };
  auth?: Json;
  context?: {
    benchmark?: {
      name?: string;
      description?: string;
    };
    subject?: {
      id?: string;
      path?: string;
    };
    optimizer?: {
      edits?: string[];
    };
    trial?: {
      trialIndex?: number;
      sampleIndex?: number;
      caseId?: string;
    };
    task?: {
      text?: string;
    };
  };
  paths: {
    workspace: string;
    output: string;
    result: string;
    input?: string;
    task?: string;
    traces?: string;
    cwd?: string;
    subject?: string;
    tests?: string;
    logs?: string;
    artifacts?: string;
  };
}

export type WorkbenchAdapterOperationResultValue =
  | WorkbenchTaskSourceResult
  | WorkbenchScorecard
  | WorkbenchSubjectPatch
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
  const operation = requiredOperation(record.operation, "adapter request operation");
  const use = requiredString(invocation.use, "adapter request invocation.use");
  return {
    protocol: WORKBENCH_ADAPTER_PROTOCOL,
    id: requiredString(record.id, "adapter request id"),
    ...(typeof record.jobId === "string" ? { jobId: record.jobId } : {}),
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
      ...(typeof paths.input === "string" ? { input: paths.input } : {}),
      ...(typeof paths.task === "string" ? { task: paths.task } : {}),
      ...(typeof paths.traces === "string" ? { traces: paths.traces } : {}),
      ...(typeof paths.cwd === "string" ? { cwd: paths.cwd } : {}),
      ...(typeof paths.subject === "string" ? { subject: paths.subject } : {}),
      ...(typeof paths.tests === "string" ? { tests: paths.tests } : {}),
      ...(typeof paths.logs === "string" ? { logs: paths.logs } : {}),
      ...(typeof paths.artifacts === "string" ? { artifacts: paths.artifacts } : {}),
    },
  };
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
  if (operation && resultOperation !== operation) {
    throw new Error(`${WORKBENCH_ADAPTER_RESULT_FILE}.operation must be ${operation}.`);
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
  if (operation === "tasks.resolve") {
    return normalizeWorkbenchTaskSourceResult(value);
  }
  if (operation === "trial.score") {
    return normalizeScorecard(value, `${WORKBENCH_ADAPTER_RESULT_FILE}.value`);
  }
  if (operation === "subject.improve") {
    return normalizeSubjectPatch(value, `${WORKBENCH_ADAPTER_RESULT_FILE}.value`);
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
    ...(record.benchmark !== undefined ? { benchmark: normalizeBenchmarkContext(record.benchmark) } : {}),
    ...(record.subject !== undefined ? { subject: normalizeSubjectContext(record.subject) } : {}),
    ...(record.optimizer !== undefined ? { optimizer: normalizeOptimizerContext(record.optimizer) } : {}),
    ...(record.trial !== undefined ? { trial: normalizeTrialContext(record.trial) } : {}),
    ...(record.task !== undefined ? { task: normalizeTaskContext(record.task) } : {}),
  };
}

function normalizeBenchmarkContext(value: unknown): NonNullable<NonNullable<WorkbenchAdapterOperationRequest["context"]>["benchmark"]> {
  const record = requiredJsonRecord(value, "adapter request context.benchmark");
  return {
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    ...(typeof record.description === "string" ? { description: record.description } : {}),
  };
}

function normalizeSubjectContext(value: unknown): NonNullable<NonNullable<WorkbenchAdapterOperationRequest["context"]>["subject"]> {
  const record = requiredJsonRecord(value, "adapter request context.subject");
  return {
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    ...(typeof record.path === "string" ? { path: record.path } : {}),
  };
}

function normalizeOptimizerContext(value: unknown): NonNullable<NonNullable<WorkbenchAdapterOperationRequest["context"]>["optimizer"]> {
  const record = requiredJsonRecord(value, "adapter request context.optimizer");
  return {
    edits: Array.isArray(record.edits)
      ? record.edits.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

function normalizeTrialContext(value: unknown): NonNullable<NonNullable<WorkbenchAdapterOperationRequest["context"]>["trial"]> {
  const record = requiredJsonRecord(value, "adapter request context.trial");
  return {
    ...(typeof record.trialIndex === "number" ? { trialIndex: record.trialIndex } : {}),
    ...(typeof record.sampleIndex === "number" ? { sampleIndex: record.sampleIndex } : {}),
    ...(typeof record.caseId === "string" ? { caseId: record.caseId } : {}),
  };
}

function normalizeTaskContext(value: unknown): NonNullable<NonNullable<WorkbenchAdapterOperationRequest["context"]>["task"]> {
  const record = requiredJsonRecord(value, "adapter request context.task");
  return {
    ...(typeof record.text === "string" ? { text: record.text } : {}),
  };
}

function normalizeScorecard(value: unknown, label: string): WorkbenchScorecard {
  const record = requiredJsonRecord(value, label);
  if (typeof record.score !== "number" || !Number.isFinite(record.score)) {
    throw new Error(`${label}.score must be a finite number.`);
  }
  return {
    score: record.score,
    ...(isNumberRecord(record.metrics) ? { metrics: record.metrics } : {}),
    ...(Array.isArray(record.cases) ? { cases: record.cases as unknown as WorkbenchScorecard["cases"] } : {}),
    ...(record.usage !== undefined ? { usage: normalizeUsageSummary(record.usage) } : {}),
    ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
    ...(record.feedback !== undefined ? { feedback: record.feedback as Json } : {}),
  };
}

function normalizeSubjectPatch(value: unknown, label: string): WorkbenchSubjectPatch {
  const record = requiredJsonRecord(value, label);
  if (!Array.isArray(record.files)) {
    throw new Error(`${label}.files must be an array.`);
  }
  if (!Array.isArray(record.fileChanges) || !record.fileChanges.every((entry) => typeof entry === "string")) {
    throw new Error(`${label}.fileChanges must be a string array.`);
  }
  return {
    files: record.files as unknown as WorkbenchSubjectPatch["files"],
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

function requiredOperation(
  value: unknown,
  label: string,
): WorkbenchAdapterOperation {
  if (
    value === "tasks.resolve" ||
    value === "subject.run" ||
    value === "trial.score" ||
    value === "subject.improve"
  ) {
    return value;
  }
  throw new Error(`${label} must be tasks.resolve, subject.run, trial.score, or subject.improve.`);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}
