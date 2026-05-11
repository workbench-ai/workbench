import type {
  Json,
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

export function isJsonPayload(value: unknown): value is import("@workbench-ai/workbench-contract").Json {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return Number.isFinite(value as number) || typeof value !== "number";
  }
  if (Array.isArray(value)) {
    return value.every(isJsonPayload);
  }
  if (value && typeof value === "object") {
    return Object.values(value).every(isJsonPayload);
  }
  return false;
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

function hasRegistryHost(image: string): boolean {
  const first = image.split("/")[0] ?? "";
  return first === "localhost" || first.includes(".") || first.includes(":");
}

function hasMutableLatestTag(image: string): boolean {
  const leaf = image.slice(image.lastIndexOf("/") + 1);
  const taggedName = leaf.includes("@") ? leaf.slice(0, leaf.indexOf("@")) : leaf;
  return taggedName.endsWith(":latest");
}

export function quoteShellArg(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replace(/'/gu, `'\"'\"'`)}'`;
}
