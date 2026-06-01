import type {
  SurfaceSnapshotFile,
  WorkbenchExecutionPurpose,
} from "@workbench-ai/workbench-contract";

import {
  normalizeRelativePath,
  readSurfaceFiles,
} from "./runtime-utils.ts";

export const WORKBENCH_TRACE_ROOT = ".workbench/traces";

export async function readOutputTraceFiles(outputRoot: string, traceRoot: string): Promise<SurfaceSnapshotFile[]> {
  return (await readSurfaceFiles(outputRoot, { ignorePath: shouldSkipTraceDirectory }))
    .map((file) => ({
      ...file,
      path: normalizeRelativePath(`${traceRoot}/${file.path}`),
      executable: false,
    }));
}

export function traceFilePaths(files: readonly SurfaceSnapshotFile[]): string[] {
  return files
    .map((file) => file.path)
    .filter((filePath) => filePath.startsWith(`${WORKBENCH_TRACE_ROOT}/`))
    .sort();
}

export function workbenchTraceRunDirectory(args: {
  sequence: number;
  runId: string;
}): string {
  return `${WORKBENCH_TRACE_ROOT}/${workbenchTraceRunDirectoryName(args)}`;
}

export function workbenchTraceExecutionDirectory(args: {
  sequence: number;
  runId: string;
  purpose: WorkbenchExecutionPurpose;
}): string {
  return `${workbenchTraceRunDirectory(args)}/${String(tracePurposeSequence(args.purpose)).padStart(6, "0")}-${args.purpose}`;
}

export function workbenchTraceRunDirectoryName(args: {
  sequence: number;
  runId: string;
}): string {
  const sequence = Number.isSafeInteger(args.sequence) && args.sequence >= 0
    ? args.sequence
    : 0;
  return `${String(sequence).padStart(6, "0")}-${sanitizeTracePathSegment(args.runId)}`;
}

function shouldSkipTraceDirectory(relativeDirectory: string): boolean {
  return relativeDirectory === "session/home"
    || relativeDirectory.startsWith("session/home/")
    || relativeDirectory === "session/workspace"
    || relativeDirectory.startsWith("session/workspace/")
    || relativeDirectory.endsWith("/session/home")
    || relativeDirectory.includes("/session/home/")
    || relativeDirectory.endsWith("/session/workspace")
    || relativeDirectory.includes("/session/workspace/");
}

function sanitizeTracePathSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-z0-9_.-]+/giu, "_")
    .replace(/^_+|_+$/gu, "");
  return sanitized || "run";
}

function tracePurposeSequence(purpose: WorkbenchExecutionPurpose): number {
  if (purpose === "improve") {
    return 1;
  }
  return 2;
}
