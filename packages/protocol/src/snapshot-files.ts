import path from "node:path";

import type {
  SurfaceSnapshotFile,
} from "@workbench-ai/workbench-contract";

export function normalizeSurfaceSnapshotFiles(
  value: unknown,
  label: string,
  options: { optional?: boolean } = {},
): SurfaceSnapshotFile[] {
  if (value === undefined && options.optional) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    const record = requiredRecord(entry, itemLabel);
    if (typeof record.path !== "string" || record.path.trim().length === 0) {
      throw new Error(`${itemLabel}.path must be a non-empty string.`);
    }
    if (typeof record.content !== "string") {
      throw new Error(`${itemLabel}.content must be a string.`);
    }
    const encoding: SurfaceSnapshotFile["encoding"] = record.encoding === "base64" ? "base64" : "utf8";
    const kind: SurfaceSnapshotFile["kind"] = record.kind === "binary" || encoding === "base64" ? "binary" : "text";
    return {
      path: normalizeSurfaceRelativePath(record.path, `${itemLabel}.path`),
      kind,
      encoding,
      content: record.content,
      executable: record.executable === true,
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

export function normalizeSurfaceRelativePath(filePath: string, label: string): string {
  const normalized = path.posix.normalize(filePath.replace(/\\/gu, "/").replace(/^\/+/u, ""));
  if (!normalized || normalized === "." || normalized.includes("\0")) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`${label} must not escape the result root.`);
  }
  return normalized;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}
