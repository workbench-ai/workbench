import http from "node:http";
import https from "node:https";

import {
  isWorkbenchJson,
  type Json,
  type SurfaceSnapshotFile,
  type UsageSummary,
  type WorkbenchResult,
} from "@workbench-ai/workbench-contract";

import type {
  WorkbenchAdapterOperation,
} from "./adapter-manifest.ts";
import {
  isWorkbenchAdapterOperationResult,
  type WorkbenchAdapterOperationResult,
} from "./adapter-protocol.ts";

export const WORKBENCH_RUNTIME_CONTROL_URL_ENV = "WORKBENCH_RUNTIME_CONTROL_URL";
export const WORKBENCH_RUNTIME_CONTROL_TOKEN_ENV = "WORKBENCH_RUNTIME_CONTROL_TOKEN";
export const WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS_ENV = "WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS";
const DEFAULT_RUNTIME_CONTROL_TIMEOUT_MS = 30 * 60_000;

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
  skill?: readonly SurfaceSnapshotFile[];
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
  timeoutMs?: number;
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
  const timeoutMs = runtimeControlRequestTimeoutMs(options.timeoutMs);
  const response = options.fetch
    ? await postRuntimeControlJsonWithFetch(fetchImpl, endpoint, token, request, timeoutMs)
    : await postRuntimeControlJson(endpoint, token, request, timeoutMs);
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
  timeoutMs: number,
): Promise<{ status: number; payload: unknown }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    return {
      status: response.status,
      payload: await response.json().catch(() => null) as unknown,
    };
  } catch (error) {
    if (timedOut) {
      throw runtimeControlTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function postRuntimeControlJson(
  url: URL,
  token: string,
  request: WorkbenchRuntimeControlOperationSequenceRequest,
  timeoutMs: number,
): Promise<{ status: number; payload: unknown }> {
  const body = JSON.stringify(request);
  const client = url.protocol === "https:" ? https : http;
  return await new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      callback();
    };
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
        settle(() => resolve({
          status: incoming.statusCode ?? 0,
          payload,
        }));
      });
      incoming.on("error", (error) => settle(() => reject(error)));
    });
    outgoing.on("error", (error) => settle(() => reject(error)));
    timer = setTimeout(() => {
      outgoing.destroy(runtimeControlTimeoutError(timeoutMs));
    }, timeoutMs);
    outgoing.end(body);
  });
}

function runtimeControlRequestTimeoutMs(configured: number | undefined): number {
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  const raw = process.env[WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS_ENV];
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_RUNTIME_CONTROL_TIMEOUT_MS;
}

function runtimeControlTimeoutError(timeoutMs: number): Error {
  return new Error(`Workbench runtime-control request timed out after ${timeoutMs}ms.`);
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
    ...(record.feedback !== undefined && isWorkbenchJson(record.feedback) ? { feedback: record.feedback } : {}),
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

export function isSurfaceSnapshotFile(value: unknown): value is SurfaceSnapshotFile {
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
  return !!value && typeof value === "object" && !Array.isArray(value) && isWorkbenchJson(value);
}
