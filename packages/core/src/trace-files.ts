import type {
  SurfaceSnapshotFile,
  WorkbenchExecutionPurpose,
} from "@workbench-ai/workbench-contract";

import {
  importNodeModule,
  nodeBuiltin,
} from "./runtime-utils.ts";

export const WORKBENCH_TRACE_ROOT = ".workbench/traces";

export async function readOutputTraceFiles(outputRoot: string, traceRoot: string): Promise<SurfaceSnapshotFile[]> {
  const fs = await importNodeModule<any>(nodeBuiltin("fs/promises"));
  const path = await importNodeModule<any>(nodeBuiltin("path"));
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files: SurfaceSnapshotFile[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const relativeDirectory = normalizeRelativePath(path.relative(outputRoot, absolutePath).replace(/\\/gu, "/"));
        if (shouldSkipTraceDirectory(relativeDirectory)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const body = await fs.readFile(absolutePath);
      const content = encodeTraceFileContent(body, decoder);
      files.push({
        path: normalizeRelativePath(`${traceRoot}/${path.relative(outputRoot, absolutePath).replace(/\\/gu, "/")}`),
        kind: content.encoding === "base64" ? "binary" : "text",
        encoding: content.encoding,
        content: content.content,
        executable: false,
      });
    }
  }
  await walk(outputRoot);
  return files;
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

function encodeTraceFileContent(body: Buffer, utf8Decoder: { decode(input?: Uint8Array): string }): { encoding: "utf8" | "base64"; content: string } {
  try {
    return {
      encoding: "utf8",
      content: utf8Decoder.decode(body),
    };
  } catch {
    return {
      encoding: "base64",
      content: body.toString("base64"),
    };
  }
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

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/gu, "/").replace(/^\/+/u, "").replace(/\/+/gu, "/");
}
