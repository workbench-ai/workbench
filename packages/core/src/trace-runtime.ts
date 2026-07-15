import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  WorkbenchTrace,
} from "@workbench-ai/workbench-contract";
import { writeJsonFileAtomically } from "./atomic-files.ts";
import { fileErrorCode } from "./runtime-utils.ts";

const WORKBENCH_DIR = ".workbench";
const TRACE_RUNTIME_DIR = "traces";
const TRACE_FILE = "trace.json";

export interface WorkbenchTraceRuntimeOptions {
  projectRoot: string;
}

function workbenchProjectTraceRuntimeRoot(projectRoot: string): string {
  return path.join(projectRoot, WORKBENCH_DIR, TRACE_RUNTIME_DIR);
}

export async function listWorkbenchTraceRecords(
  options: WorkbenchTraceRuntimeOptions,
): Promise<WorkbenchTrace[]> {
  const traces = await readTraceBundlesFromDir(workbenchProjectTraceRuntimeRoot(options.projectRoot));
  return traces.sort((left, right) =>
    (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt) ||
    right.id.localeCompare(left.id)
  );
}

export async function writeWorkbenchTraceRecord(
  trace: WorkbenchTrace,
  options: WorkbenchTraceRuntimeOptions,
): Promise<WorkbenchTrace> {
  const normalized = normalizeTraceRecord(trace);
  await writeJsonFileAtomically(path.join(traceBundleDir(normalized.id, options), TRACE_FILE), normalized);
  return normalized;
}

function normalizeTraceRecord(trace: WorkbenchTrace): WorkbenchTrace {
  return {
    ...trace,
    updatedAt: trace.updatedAt ?? trace.createdAt,
    status: trace.status ?? "completed",
    files: structuredClone(trace.files),
    ...(trace.links ? { links: structuredClone(trace.links) } : {}),
    ...(trace.input ? { input: structuredClone(trace.input) } : {}),
    ...(trace.output ? { output: { ...trace.output } } : {}),
  };
}

async function readTraceBundlesFromDir(directory: string): Promise<WorkbenchTrace[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (fileErrorCode(error) === "ENOENT") {
      return [];
    }
    throw error;
  });
  const traces: WorkbenchTrace[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      continue;
    }
    const trace = await readTraceFile(path.join(directory, entry.name, TRACE_FILE));
    if (trace) {
      traces.push(trace);
    }
  }
  return traces;
}

async function readTraceFile(filePath: string): Promise<WorkbenchTrace | null> {
  try {
    const value = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    return isWorkbenchTraceRecord(value) ? normalizeTraceRecord(value) : null;
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isWorkbenchTraceRecord(value: unknown): value is WorkbenchTrace {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.createdAt === "string" && Array.isArray(record.files);
}

function traceBundleDir(traceId: string, options: WorkbenchTraceRuntimeOptions): string {
  return path.join(workbenchProjectTraceRuntimeRoot(options.projectRoot), safeStorageName(traceId));
}

function safeStorageName(value: string): string {
  return value.trim().replace(/[^a-z0-9_.-]+/giu, "_").replace(/^_+|_+$/gu, "") || "trace";
}
