import { createHash } from "node:crypto";

import type { SurfaceSnapshotFile } from "@workbench-ai/workbench-contract";

export function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function hashFiles(files: readonly SurfaceSnapshotFile[]): string {
  return hashJson(files.map((file) => ({
    path: file.path,
    encoding: file.encoding ?? "utf8",
    executable: file.executable === true,
    content: file.content,
  })).sort((left, right) => left.path.localeCompare(right.path)));
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}

