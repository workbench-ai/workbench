import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  Json,
  UsageSummary,
  WorkbenchExecutionSpec,
} from "@workbench-ai/workbench-contract";

export interface WorkbenchAdapterCommandRequest {
  protocol: "workbench.adapter.v1";
  execution: {
    id: string;
    jobId?: string;
    purpose: WorkbenchExecutionSpec["purpose"];
    role: "optimizer" | "runner" | "grader";
    candidateId?: string;
    trialIndex?: number;
    sampleIndex?: number;
    caseId?: string;
  };
  adapter: {
    use: string;
    with?: Json;
    auth?: Json;
  };
  auth?: Json;
  benchmark?: {
    name?: string;
    description?: string;
  };
  candidate?: {
    path?: string;
  };
  optimizer?: {
    edits?: string[];
  };
  task?: {
    text?: string;
  };
  expectedOutputs?: Array<{
    name?: string;
    path?: string;
  }>;
  paths: {
    workspace: string;
    input?: string;
    output: string;
    candidate?: string;
    task?: string;
    runnerOutput?: string;
    traces?: string;
  };
}

export interface WorkbenchAdapterResultMetadata {
  ok?: boolean;
  summary?: string;
  feedback?: Json;
  usage?: UsageSummary;
}

export async function readWorkbenchAdapterCommandRequest(
  configuredPath?: string,
): Promise<WorkbenchAdapterCommandRequest> {
  const requestPath = configuredPath ?? process.env.WORKBENCH_ADAPTER_REQUEST;
  if (!requestPath) {
    throw new Error("WORKBENCH_ADAPTER_REQUEST is required.");
  }
  const parsed = JSON.parse(await fs.readFile(requestPath, "utf8")) as unknown;
  return normalizeWorkbenchAdapterCommandRequest(parsed);
}

export function normalizeWorkbenchAdapterCommandRequest(
  value: unknown,
): WorkbenchAdapterCommandRequest {
  const record = requiredJsonRecord(value, "adapter request");
  if (record.protocol !== "workbench.adapter.v1") {
    throw new Error("Adapter request protocol must be workbench.adapter.v1.");
  }
  const execution = requiredJsonRecord(record.execution, "adapter request execution");
  const adapter = requiredJsonRecord(record.adapter, "adapter request adapter");
  const paths = requiredJsonRecord(record.paths, "adapter request paths");
  const purpose = requiredPurpose(execution.purpose, "adapter request execution.purpose");
  const role = executionPurposeRole(purpose);
  const use = requiredString(adapter.use, "adapter request adapter.use");
  return {
    protocol: "workbench.adapter.v1",
    execution: {
      id: requiredString(execution.id, "adapter request execution.id"),
      ...(typeof execution.jobId === "string" ? { jobId: execution.jobId } : {}),
      purpose,
      role,
      ...(typeof execution.candidateId === "string" ? { candidateId: execution.candidateId } : {}),
      ...(typeof execution.trialIndex === "number" ? { trialIndex: execution.trialIndex } : {}),
      ...(typeof execution.sampleIndex === "number" ? { sampleIndex: execution.sampleIndex } : {}),
      ...(typeof execution.caseId === "string" ? { caseId: execution.caseId } : {}),
    },
    adapter: {
      use,
      with: adapter.with !== undefined ? adapter.with as Json : {},
      ...(adapter.auth !== undefined ? { auth: adapter.auth as Json } : {}),
    },
    ...(record.auth !== undefined ? { auth: record.auth as Json } : {}),
    ...(record.benchmark !== undefined ? { benchmark: normalizeAdapterCommandBenchmark(record.benchmark) } : {}),
    ...(record.candidate !== undefined ? { candidate: normalizeAdapterCommandCandidate(record.candidate) } : {}),
    ...(record.optimizer !== undefined ? { optimizer: normalizeAdapterCommandOptimizer(record.optimizer) } : {}),
    ...(record.task !== undefined ? { task: normalizeAdapterCommandTask(record.task) } : {}),
    ...(Array.isArray(record.expectedOutputs)
      ? { expectedOutputs: normalizeAdapterCommandExpectedOutputs(record.expectedOutputs) }
      : {}),
    paths: {
      workspace: requiredString(paths.workspace, "adapter request paths.workspace"),
      output: requiredString(paths.output, "adapter request paths.output"),
      ...(typeof paths.input === "string" ? { input: paths.input } : {}),
      ...(typeof paths.candidate === "string" ? { candidate: paths.candidate } : {}),
      ...(typeof paths.task === "string" ? { task: paths.task } : {}),
      ...(typeof paths.runnerOutput === "string" ? { runnerOutput: paths.runnerOutput } : {}),
      ...(typeof paths.traces === "string" ? { traces: paths.traces } : {}),
    },
  };
}

export async function ensureWorkbenchAdapterOutputDir(
  request: WorkbenchAdapterCommandRequest,
): Promise<void> {
  await fs.mkdir(request.paths.output, { recursive: true });
}

export function workbenchAdapterResultPath(outputRoot: string): string {
  return path.join(outputRoot, ".workbench", "result.json");
}

export async function writeWorkbenchAdapterResultMetadata(
  outputRoot: string,
  result: WorkbenchAdapterResultMetadata,
): Promise<void> {
  const resultPath = workbenchAdapterResultPath(outputRoot);
  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
}

export async function readWorkbenchAdapterResultMetadata(
  outputRoot: string,
): Promise<WorkbenchAdapterResultMetadata> {
  const source = await fs.readFile(workbenchAdapterResultPath(outputRoot), "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (source === null) {
    return {};
  }
  const parsed = JSON.parse(source) as unknown;
  const record = jsonRecord(parsed);
  return {
    ...(record.ok === true || record.ok === false ? { ok: record.ok } : {}),
    ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
    ...(record.feedback !== undefined ? { feedback: record.feedback as Json } : {}),
    ...(record.usage !== undefined ? { usage: normalizeUsageSummary(record.usage) } : {}),
  };
}

function normalizeAdapterCommandExpectedOutputs(
  value: readonly Json[],
): NonNullable<WorkbenchAdapterCommandRequest["expectedOutputs"]> {
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    return [{
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
      ...(typeof entry.path === "string" ? { path: entry.path } : {}),
    }];
  });
}

function normalizeAdapterCommandBenchmark(
  value: unknown,
): NonNullable<WorkbenchAdapterCommandRequest["benchmark"]> {
  const record = requiredJsonRecord(value, "adapter request benchmark");
  return {
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    ...(typeof record.description === "string" ? { description: record.description } : {}),
  };
}

function normalizeAdapterCommandCandidate(
  value: unknown,
): NonNullable<WorkbenchAdapterCommandRequest["candidate"]> {
  const record = requiredJsonRecord(value, "adapter request candidate");
  return {
    ...(typeof record.path === "string" ? { path: record.path } : {}),
  };
}

function normalizeAdapterCommandOptimizer(
  value: unknown,
): NonNullable<WorkbenchAdapterCommandRequest["optimizer"]> {
  const record = requiredJsonRecord(value, "adapter request optimizer");
  return {
    edits: Array.isArray(record.edits)
      ? record.edits.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

function normalizeAdapterCommandTask(
  value: unknown,
): NonNullable<WorkbenchAdapterCommandRequest["task"]> {
  const record = requiredJsonRecord(value, "adapter request task");
  return {
    ...(typeof record.text === "string" ? { text: record.text } : {}),
  };
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

function requiredPurpose(
  value: unknown,
  label: string,
): WorkbenchExecutionSpec["purpose"] {
  if (value === "improve" || value === "run-task" || value === "grade-task") {
    return value;
  }
  throw new Error(`${label} must be improve, run-task, or grade-task.`);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function executionPurposeRole(
  purpose: WorkbenchExecutionSpec["purpose"],
): "optimizer" | "runner" | "grader" {
  if (purpose === "improve") {
    return "optimizer";
  }
  if (purpose === "run-task") {
    return "runner";
  }
  return "grader";
}

function jsonRecord(value: unknown): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json>
    : {};
}

function normalizeUsageSummary(value: unknown): UsageSummary {
  const record = jsonRecord(value);
  return {
    ...(record.total !== undefined ? { total: normalizeExecutionUsage(record.total) } : {}),
    ...(record.optimizer !== undefined ? { optimizer: normalizeExecutionUsage(record.optimizer) } : {}),
    ...(record.runner !== undefined ? { runner: normalizeExecutionUsage(record.runner) } : {}),
    ...(record.grader !== undefined ? { grader: normalizeExecutionUsage(record.grader) } : {}),
  };
}

function normalizeExecutionUsage(value: unknown): NonNullable<UsageSummary["total"]> {
  const record = jsonRecord(value);
  return {
    ...(typeof record.provider === "string" ? { provider: record.provider } : {}),
    ...(typeof record.model === "string" ? { model: record.model } : {}),
    ...(typeof record.inputTokens === "number" ? { inputTokens: record.inputTokens } : {}),
    ...(typeof record.uncachedInputTokens === "number" ? { uncachedInputTokens: record.uncachedInputTokens } : {}),
    ...(typeof record.cachedInputTokens === "number" ? { cachedInputTokens: record.cachedInputTokens } : {}),
    ...(typeof record.cacheCreationInputTokens === "number" ? { cacheCreationInputTokens: record.cacheCreationInputTokens } : {}),
    ...(typeof record.cacheReadInputTokens === "number" ? { cacheReadInputTokens: record.cacheReadInputTokens } : {}),
    ...(typeof record.outputTokens === "number" ? { outputTokens: record.outputTokens } : {}),
    ...(typeof record.reasoningOutputTokens === "number" ? { reasoningOutputTokens: record.reasoningOutputTokens } : {}),
    ...(typeof record.totalTokens === "number" ? { totalTokens: record.totalTokens } : {}),
    ...(typeof record.costUsd === "number" ? { costUsd: record.costUsd } : {}),
    ...(record.costSource === "provider" || record.costSource === "estimated" || record.costSource === "mixed"
      ? { costSource: record.costSource }
      : {}),
    ...(typeof record.pricingSource === "string" ? { pricingSource: record.pricingSource } : {}),
  };
}
