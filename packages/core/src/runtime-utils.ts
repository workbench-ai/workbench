import {
  normalizeWorkbenchSourcePath,
  type Json,
  type SurfaceSnapshotFile,
} from "@workbench-ai/workbench-contract";

export async function importNodeModule<T>(specifier: string): Promise<T> {
  return await import(/* webpackIgnore: true */ specifier) as T;
}

export function nodeBuiltin(name: string): string {
  return `node:${name}`;
}

export function asRuntimeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function jsonRecord(value: unknown): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json>
    : {};
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function fileErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function abortSignalOrUndefined(value: AbortSignal | undefined): AbortSignal | undefined {
  return value &&
    typeof value.aborted === "boolean" &&
    typeof value.addEventListener === "function" &&
    typeof value.removeEventListener === "function"
    ? value
    : undefined;
}

export function normalizeRelativePath(filePath: string): string {
  const normalized = filePath.replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (!normalized || normalized.includes("\0")) {
    throw new Error("File paths must be non-empty relative paths.");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === "." || part === "")) {
    throw new Error(`Unsafe relative file path: ${filePath}`);
  }
  return normalized;
}

export function dedupeSurfaceFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  const byPath = new Map<string, SurfaceSnapshotFile>();
  for (const file of files) {
    const normalized = normalizeWorkbenchSourcePath(file.path);
    byPath.set(normalized, { ...file, path: normalized });
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function publicGradeMetrics(record: Record<string, unknown>, score: number): Record<string, number> {
  const metrics: Record<string, number> = { score };
  const source = record.metrics && typeof record.metrics === "object" && !Array.isArray(record.metrics)
    ? record.metrics as Record<string, unknown>
    : {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      metrics[key] = value;
    }
  }
  return metrics;
}

export async function writeSurfaceFiles(
  root: string,
  files: readonly SurfaceSnapshotFile[],
): Promise<void> {
  const fs = await importNodeModule<typeof import("node:fs/promises")>(nodeBuiltin("fs/promises"));
  const path = await importNodeModule<typeof import("node:path")>(nodeBuiltin("path"));
  await fs.mkdir(root, { recursive: true });
  for (const file of files) {
    const target = path.join(root, normalizeRelativePath(file.path));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const body =
      file.encoding === "base64"
        ? Buffer.from(file.content, "base64")
        : Buffer.from(file.content, "utf8");
    await fs.writeFile(target, body);
    await fs.chmod(target, file.executable === true ? 0o755 : 0o644);
  }
}

export async function readSurfaceFiles(
  root: string,
  options: { ignorePath?: (path: string) => boolean } = {},
): Promise<SurfaceSnapshotFile[]> {
  const fs = await importNodeModule<typeof import("node:fs/promises")>(nodeBuiltin("fs/promises"));
  const path = await importNodeModule<typeof import("node:path")>(nodeBuiltin("path"));
  const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
  const files: SurfaceSnapshotFile[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await fs
      .readdir(directory, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizeRelativePath(
        path.relative(root, absolutePath).replace(/\\/gu, "/"),
      );
      if (options.ignorePath?.(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      let body: Buffer;
      let stats: { mode: number };
      try {
        body = await fs.readFile(absolutePath);
        stats = await fs.stat(absolutePath);
      } catch (error) {
        if (isVanishedWalkEntry(error)) {
          continue;
        }
        throw error;
      }
      const content = encodeSurfaceSnapshotContent(body, utf8Decoder);
      files.push({
        path: relativePath,
        kind: content.encoding === "base64" ? "binary" : "text",
        encoding: content.encoding,
        content: content.content,
        executable: (stats.mode & 0o111) !== 0,
      });
    }
  }
  await walk(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function isVanishedWalkEntry(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function encodeSurfaceSnapshotContent(
  body: Buffer,
  utf8Decoder: { decode(input?: Uint8Array): string },
): { encoding: "utf8" | "base64"; content: string } {
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

export function resolveDockerRuntimeImageRef(
  imageRef: string,
  options: { runtimeRegistry: string; label: string; allowMutableLatest?: boolean },
): string {
  if (!imageRef.startsWith("docker://")) {
    throw new Error(`${options.label} must start with docker://.`);
  }
  const image = applyRuntimeRegistry(imageRef.slice("docker://".length), options.runtimeRegistry);
  if (!options.allowMutableLatest && hasMutableLatestTag(image)) {
    throw new Error(`${options.label} must not use mutable tag :latest.`);
  }
  return image;
}

export function normalizeRuntimeRegistry(value: string): string {
  return value.replace(/^https?:\/\//u, "").replace(/\/+$/u, "");
}

const NON_IDENTIFYING_WORKER_IDS = new Set([
  "*",
  "0",
  "0.0.0.0",
  "::",
  "::0",
  "[::]",
  "127.0.0.1",
  "::1",
  "localhost",
  "localhost.localdomain",
]);

export function normalizeWorkbenchWorkerId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return NON_IDENTIFYING_WORKER_IDS.has(normalized.toLowerCase()) ? undefined : normalized;
}

export function resolveWorkbenchWorkerId(candidates: readonly unknown[], fallback: string): string {
  for (const candidate of candidates) {
    const normalized = normalizeWorkbenchWorkerId(candidate);
    if (normalized) {
      return normalized;
    }
  }
  const normalizedFallback = normalizeWorkbenchWorkerId(fallback);
  return normalizedFallback ?? "worker";
}

function applyRuntimeRegistry(image: string, runtimeRegistry: string): string {
  if (!runtimeRegistry || hasRegistryHost(image)) {
    return image;
  }
  return `${runtimeRegistry}/${image}`;
}

export function hasRegistryHost(image: string): boolean {
  const first = image.split("/")[0] ?? "";
  return first === "localhost" || first.includes(".") || first.includes(":");
}

function hasMutableLatestTag(image: string): boolean {
  const leaf = image.slice(image.lastIndexOf("/") + 1);
  const taggedName = leaf.includes("@") ? leaf.slice(0, leaf.indexOf("@")) : leaf;
  return taggedName.endsWith(":latest");
}

export function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) {
    return value;
  }
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replace(/'/gu, `'\"'\"'`)}'`;
}
