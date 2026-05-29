import path from "node:path";

import {
  isWorkbenchExecutionNetworkEgress,
  type SurfaceSnapshotFile,
  type WorkbenchExecutionNetworkPolicy,
  type WorkbenchExecutionResources,
} from "@workbench-ai/workbench-contract";

export interface WorkbenchEngineCaseEnvironmentSpec {
  dockerfile?: string;
  workdir?: string;
  resources?: Partial<WorkbenchExecutionResources>;
  network?: WorkbenchExecutionNetworkPolicy;
}

export interface WorkbenchEngineCaseSpec {
  version: 3;
  prompt: string;
  split?: string;
  environment?: WorkbenchEngineCaseEnvironmentSpec;
}

export interface WorkbenchEngineCaseFiles {
  public?: SurfaceSnapshotFile[];
  private?: SurfaceSnapshotFile[];
  source?: SurfaceSnapshotFile[];
}

export interface WorkbenchEngineCase {
  id: string;
  case: WorkbenchEngineCaseSpec;
  files: WorkbenchEngineCaseFiles;
}

export interface WorkbenchEngineResolveResult {
  cases: WorkbenchEngineCase[];
  environment?: WorkbenchEngineCaseEnvironmentSpec;
}

export function normalizeWorkbenchEngineResolveResult(
  value: unknown,
  label = "engine.resolve result",
): WorkbenchEngineResolveResult {
  const record = requiredRecord(value, label);
  if (!Array.isArray(record.cases)) {
    throw new Error(`${label}.cases must be an array.`);
  }
  const cases = record.cases.map((entry, index) =>
    normalizeWorkbenchEngineCase(entry, `${label}.cases[${index}]`)
  );
  const duplicate = firstDuplicate(cases.map((engineCase) => engineCase.id));
  if (duplicate) {
    throw new Error(`${label} contains duplicate case id: ${duplicate}`);
  }
  return {
    cases,
    ...(record.environment !== undefined
      ? { environment: normalizeCaseEnvironment(record.environment, `${label}.environment`) }
      : {}),
  };
}

export function normalizeWorkbenchEngineCase(
  value: unknown,
  label: string,
): WorkbenchEngineCase {
  const record = requiredRecord(value, label);
  rejectUnknownKeys(record, label, ["id", "case", "files"]);
  if (typeof record.id !== "string" || record.id.trim().length === 0) {
    throw new Error(`${label}.id must be a non-empty string.`);
  }
  return {
    id: normalizeRelativePath(record.id, `${label}.id`),
    case: normalizeWorkbenchEngineCaseSpec(record.case, `${label}.case`),
    files: normalizeWorkbenchEngineCaseFiles(record.files, `${label}.files`),
  };
}

export function normalizeWorkbenchEngineCaseFiles(
  value: unknown,
  label: string,
): WorkbenchEngineCaseFiles {
  const record = requiredRecord(value, label);
  rejectUnknownKeys(record, label, ["public", "private", "source"]);
  return {
    ...(record.public !== undefined
      ? { public: normalizeEngineResolveFiles(record.public, `${label}.public`) }
      : {}),
    ...(record.private !== undefined
      ? { private: normalizeEngineResolveFiles(record.private, `${label}.private`) }
      : {}),
    ...(record.source !== undefined
      ? { source: normalizeEngineResolveFiles(record.source, `${label}.source`) }
      : {}),
  };
}

export function normalizeWorkbenchEngineCaseSpec(
  value: unknown,
  label: string,
): WorkbenchEngineCaseSpec {
  const record = requiredRecord(value, label);
  if (record.version !== 3) {
    throw new Error(`${label}.version must be 3.`);
  }
  if (typeof record.prompt !== "string" || record.prompt.trim().length === 0) {
    throw new Error(`${label}.prompt must be a non-empty string.`);
  }
  if (record.split !== undefined && (typeof record.split !== "string" || record.split.trim().length === 0)) {
    throw new Error(`${label}.split must be a non-empty string when provided.`);
  }
  return {
    version: 3,
    prompt: record.prompt,
    ...(typeof record.split === "string" ? { split: record.split.trim() } : {}),
    ...(record.environment !== undefined
      ? { environment: normalizeCaseEnvironment(record.environment, `${label}.environment`) }
      : {}),
  };
}

function normalizeCaseEnvironment(
  value: unknown,
  label: string,
): WorkbenchEngineCaseEnvironmentSpec {
  const record = requiredRecord(value, label);
  const resources = record.resources === undefined
    ? undefined
    : normalizeCaseResources(record.resources, `${label}.resources`);
  const network = record.network === undefined
    ? undefined
    : normalizeNetworkPolicy(record.network, `${label}.network`);
  return {
    ...(typeof record.dockerfile === "string" && record.dockerfile.trim()
      ? { dockerfile: record.dockerfile }
      : {}),
    ...(typeof record.workdir === "string" && record.workdir.trim()
      ? { workdir: record.workdir }
      : {}),
    ...(resources ? { resources } : {}),
    ...(network ? { network } : {}),
  };
}

function normalizeCaseResources(
  value: unknown,
  label: string,
): Partial<WorkbenchExecutionResources> {
  const record = requiredRecord(value, label);
  return {
    ...(typeof record.cpu === "number" ? { cpu: record.cpu } : {}),
    ...(typeof record.memoryGb === "number" ? { memoryGb: record.memoryGb } : {}),
    ...(typeof record.diskGb === "number" ? { diskGb: record.diskGb } : {}),
    ...(typeof record.timeoutMinutes === "number" ? { timeoutMinutes: record.timeoutMinutes } : {}),
  };
}

function normalizeNetworkPolicy(
  value: unknown,
  label: string,
): WorkbenchExecutionNetworkPolicy {
  const record = requiredRecord(value, label);
  rejectUnknownKeys(record, label, ["egress"]);
  if (!isWorkbenchExecutionNetworkEgress(record.egress)) {
    throw new Error(`${label}.egress must be none or open.`);
  }
  return {
    egress: record.egress,
  };
}

function normalizeEngineResolveFiles(
  value: unknown,
  label: string,
): SurfaceSnapshotFile[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry, index) => {
    const record = requiredRecord(entry, `${label}[${index}]`);
    if (typeof record.path !== "string" || record.path.trim().length === 0) {
      throw new Error(`${label}[${index}].path must be a non-empty string.`);
    }
    if (typeof record.content !== "string") {
      throw new Error(`${label}[${index}].content must be a string.`);
    }
    const encoding: SurfaceSnapshotFile["encoding"] = record.encoding === "base64" ? "base64" : "utf8";
    const kind: SurfaceSnapshotFile["kind"] = record.kind === "binary" || encoding === "base64" ? "binary" : "text";
    return {
      path: normalizeRelativePath(record.path, `${label}[${index}].path`),
      kind,
      encoding,
      content: record.content,
      executable: record.executable === true,
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeRelativePath(filePath: string, label: string): string {
  const normalized = path.posix.normalize(filePath.replace(/\\/gu, "/").replace(/^\/+/u, ""));
  if (!normalized || normalized === "." || normalized.includes("\0")) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`${label} must not escape the engine-resolve result.`);
  }
  return normalized;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  label: string,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} includes unsupported fields: ${unknown.join(", ")}.`);
  }
}

function firstDuplicate(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return null;
}
