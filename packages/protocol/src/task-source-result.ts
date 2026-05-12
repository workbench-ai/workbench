import path from "node:path";

import type {
  Json,
  SurfaceSnapshotFile,
  WorkbenchAdapterInvocation,
  WorkbenchExecutionNetworkPolicy,
  WorkbenchExecutionResources,
} from "@workbench-ai/workbench-contract";

export interface WorkbenchTaskEnvironmentSpec {
  dockerfile?: string;
  workdir?: string;
  resources?: Partial<WorkbenchExecutionResources>;
  network?: WorkbenchExecutionNetworkPolicy;
}

export interface WorkbenchTaskSpec {
  version: 2;
  task: string;
  environment?: WorkbenchTaskEnvironmentSpec;
  score?: WorkbenchAdapterInvocation;
}

export interface WorkbenchTaskBundle {
  id: string;
  task: WorkbenchTaskSpec;
  publicFiles: SurfaceSnapshotFile[];
  testFiles: SurfaceSnapshotFile[];
  solutionFiles?: SurfaceSnapshotFile[];
  sourceFiles?: SurfaceSnapshotFile[];
}

export interface WorkbenchTaskSourceResult {
  tasks: WorkbenchTaskBundle[];
  environment?: WorkbenchTaskEnvironmentSpec;
}

export function normalizeWorkbenchTaskSourceResult(
  value: unknown,
  label = "tasks.resolve result",
): WorkbenchTaskSourceResult {
  const record = requiredRecord(value, label);
  if (!Array.isArray(record.tasks)) {
    throw new Error(`${label}.tasks must be an array.`);
  }
  const tasks = record.tasks.map((entry, index) =>
    normalizeWorkbenchTaskBundle(entry, `${label}.tasks[${index}]`)
  );
  const duplicate = firstDuplicate(tasks.map((task) => task.id));
  if (duplicate) {
    throw new Error(`${label} contains duplicate task id: ${duplicate}`);
  }
  return {
    tasks,
    ...(record.environment !== undefined
      ? { environment: normalizeTaskEnvironment(record.environment, `${label}.environment`) }
      : {}),
  };
}

export function normalizeWorkbenchTaskBundle(
  value: unknown,
  label: string,
): WorkbenchTaskBundle {
  const record = requiredRecord(value, label);
  if (typeof record.id !== "string" || record.id.trim().length === 0) {
    throw new Error(`${label}.id must be a non-empty string.`);
  }
  return {
    id: normalizeRelativePath(record.id, `${label}.id`),
    task: normalizeWorkbenchTaskSpec(record.task, `${label}.task`),
    publicFiles: normalizeTaskSourceFiles(record.publicFiles, `${label}.publicFiles`),
    testFiles: normalizeTaskSourceFiles(record.testFiles, `${label}.testFiles`),
    ...(record.solutionFiles !== undefined
      ? { solutionFiles: normalizeTaskSourceFiles(record.solutionFiles, `${label}.solutionFiles`) }
      : {}),
    ...(record.sourceFiles !== undefined
      ? { sourceFiles: normalizeTaskSourceFiles(record.sourceFiles, `${label}.sourceFiles`) }
      : {}),
  };
}

export function normalizeWorkbenchTaskSpec(
  value: unknown,
  label: string,
): WorkbenchTaskSpec {
  const record = requiredRecord(value, label);
  if (record.version !== 2) {
    throw new Error(`${label}.version must be 2.`);
  }
  if (typeof record.task !== "string" || record.task.trim().length === 0) {
    throw new Error(`${label}.task must be a non-empty string.`);
  }
  return {
    version: 2,
    task: record.task,
    ...(record.environment !== undefined
      ? { environment: normalizeTaskEnvironment(record.environment, `${label}.environment`) }
      : {}),
    ...(record.score !== undefined
      ? { score: normalizeAdapterInvocation(record.score, `${label}.score`) }
      : {}),
  };
}

function normalizeTaskEnvironment(
  value: unknown,
  label: string,
): WorkbenchTaskEnvironmentSpec {
  const record = requiredRecord(value, label);
  const resources = record.resources === undefined
    ? undefined
    : normalizeTaskResources(record.resources, `${label}.resources`);
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

function normalizeTaskResources(
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
  if (
    record.egress !== "none" &&
    record.egress !== "allowlist" &&
    record.egress !== "open"
  ) {
    throw new Error(`${label}.egress must be none, allowlist, or open.`);
  }
  return {
    egress: record.egress,
    ...(Array.isArray(record.allow)
      ? { allow: record.allow.filter((entry): entry is string => typeof entry === "string") }
      : {}),
  };
}

function normalizeAdapterInvocation(
  value: unknown,
  label: string,
): WorkbenchAdapterInvocation {
  const record = requiredRecord(value, label);
  if (typeof record.use !== "string" || record.use.trim().length === 0) {
    throw new Error(`${label}.use must be a non-empty string.`);
  }
  return {
    use: record.use,
    with: record.with === undefined ? {} : record.with as Json,
    ...(record.auth !== undefined ? { auth: record.auth as Json } : {}),
  };
}

function normalizeTaskSourceFiles(
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
    throw new Error(`${label} must not escape the task-source result.`);
  }
  return normalized;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
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
