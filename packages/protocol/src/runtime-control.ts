import http from "node:http";
import https from "node:https";

import type {
  Json,
  SurfaceSnapshotFile,
  UsageSummary,
  WorkbenchResult,
} from "@workbench-ai/workbench-contract";

import type {
  WorkbenchAdapterOperation,
} from "./adapter-manifest.ts";
import type {
  WorkbenchAdapterOperationResult,
} from "./adapter-protocol.ts";

export const WORKBENCH_RUNTIME_CONTROL_URL_ENV = "WORKBENCH_RUNTIME_CONTROL_URL";
export const WORKBENCH_RUNTIME_CONTROL_TOKEN_ENV = "WORKBENCH_RUNTIME_CONTROL_TOKEN";

export interface WorkbenchRuntimeControlInvocation {
  use: string;
  with?: Json;
  auth?: Json;
  command?: string;
}

export interface WorkbenchRuntimeControlOperation {
  operation: WorkbenchAdapterOperation;
  invocation: WorkbenchRuntimeControlInvocation;
  label?: string;
}

export interface WorkbenchRuntimeControlOperationInputs {
  subject?: readonly SurfaceSnapshotFile[];
  case?: readonly SurfaceSnapshotFile[];
  enginePrivate?: readonly SurfaceSnapshotFile[];
  traces?: readonly SurfaceSnapshotFile[];
  workspace?: readonly SurfaceSnapshotFile[];
  output?: readonly SurfaceSnapshotFile[];
}

export interface WorkbenchRuntimeControlOperationSequenceRequest {
  inputs?: WorkbenchRuntimeControlOperationInputs;
  operations: readonly WorkbenchRuntimeControlOperation[];
  prepare?: boolean;
  collectWorkspace?: boolean;
}

export interface WorkbenchRuntimeControlOperationSequenceResult {
  ok: boolean;
  files: SurfaceSnapshotFile[];
  fileChanges: string[];
  operationResults: WorkbenchAdapterOperationResult[];
  workspaceFiles?: SurfaceSnapshotFile[];
  result?: WorkbenchResult;
  usage?: UsageSummary;
  summary?: string;
  feedback?: Json;
  error?: string;
}

export interface RunWorkbenchRuntimeControlOptions {
  url?: string;
  token?: string;
  fetch?: typeof fetch;
}

export async function runWorkbenchRuntimeOperationSequence(
  request: WorkbenchRuntimeControlOperationSequenceRequest,
  options: RunWorkbenchRuntimeControlOptions = {},
): Promise<WorkbenchRuntimeControlOperationSequenceResult> {
  const url = (options.url ?? process.env[WORKBENCH_RUNTIME_CONTROL_URL_ENV] ?? "").trim();
  const token = (options.token ?? process.env[WORKBENCH_RUNTIME_CONTROL_TOKEN_ENV] ?? "").trim();
  if (!url || !token) {
    throw new Error("Workbench runtime-control is unavailable for this adapter operation.");
  }
  const fetchImpl = options.fetch ?? fetch;
  const endpoint = new URL("/v1/operation-sequence", url);
  const response = options.fetch
    ? await postRuntimeControlJsonWithFetch(fetchImpl, endpoint, token, request)
    : await postRuntimeControlJson(endpoint, token, request);
  if (response.status < 200 || response.status >= 300) {
    const message = readResponseError(response.payload) ?? `Workbench runtime-control request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return normalizeRuntimeControlOperationSequenceResult(response.payload);
}

async function postRuntimeControlJsonWithFetch(
  fetchImpl: typeof fetch,
  url: URL,
  token: string,
  request: WorkbenchRuntimeControlOperationSequenceRequest,
): Promise<{ status: number; payload: unknown }> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
  return {
    status: response.status,
    payload: await response.json().catch(() => null) as unknown,
  };
}

async function postRuntimeControlJson(
  url: URL,
  token: string,
  request: WorkbenchRuntimeControlOperationSequenceRequest,
): Promise<{ status: number; payload: unknown }> {
  const body = JSON.stringify(request);
  const client = url.protocol === "https:" ? https : http;
  return await new Promise((resolve, reject) => {
    const outgoing = client.request(url, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      incoming.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let payload: unknown = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = null;
        }
        resolve({
          status: incoming.statusCode ?? 0,
          payload,
        });
      });
    });
    outgoing.on("error", reject);
    outgoing.setTimeout(0);
    outgoing.end(body);
  });
}

function normalizeRuntimeControlOperationSequenceResult(
  value: unknown,
): WorkbenchRuntimeControlOperationSequenceResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workbench runtime-control response must be an object.");
  }
  const record = value as Record<string, unknown>;
  const files = Array.isArray(record.files)
    ? record.files.filter(isSurfaceSnapshotFile)
    : [];
  const fileChanges = Array.isArray(record.fileChanges)
    ? record.fileChanges.filter((entry): entry is string => typeof entry === "string")
    : files.map((file) => file.path);
  const operationResults = Array.isArray(record.operationResults)
    ? record.operationResults.filter(isWorkbenchAdapterOperationResult)
    : [];
  const workspaceFiles = Array.isArray(record.workspaceFiles)
    ? record.workspaceFiles.filter(isSurfaceSnapshotFile)
    : undefined;
  return {
    ok: record.ok !== false,
    files,
    fileChanges,
    operationResults,
    ...(workspaceFiles ? { workspaceFiles } : {}),
    ...(isJsonRecord(record.result) ? { result: record.result as unknown as WorkbenchResult } : {}),
    ...(isJsonRecord(record.usage) ? { usage: record.usage as unknown as UsageSummary } : {}),
    ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
    ...(record.feedback !== undefined && isJson(record.feedback) ? { feedback: record.feedback } : {}),
    ...(typeof record.error === "string" ? { error: record.error } : {}),
  };
}

function readResponseError(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && error.trim() ? error : null;
}

function isWorkbenchAdapterOperationResult(value: unknown): value is WorkbenchAdapterOperationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.protocol === "workbench.adapter-result.v1" &&
    typeof record.operation === "string";
}

function isSurfaceSnapshotFile(value: unknown): value is SurfaceSnapshotFile {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as SurfaceSnapshotFile).path === "string" &&
      ((value as SurfaceSnapshotFile).kind === "text" || (value as SurfaceSnapshotFile).kind === "binary") &&
      ((value as SurfaceSnapshotFile).encoding === "utf8" || (value as SurfaceSnapshotFile).encoding === "base64") &&
      typeof (value as SurfaceSnapshotFile).content === "string" &&
      typeof (value as SurfaceSnapshotFile).executable === "boolean",
  );
}

function isJsonRecord(value: unknown): value is Record<string, Json> {
  return !!value && typeof value === "object" && !Array.isArray(value) && isJson(value);
}

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJson);
  }
  if (value && typeof value === "object") {
    return Object.values(value).every(isJson);
  }
  return false;
}
