import {
  isWorkbenchExecutionNetworkEgress,
  type SurfaceSnapshotFile,
  type WorkbenchExecutionNetworkPolicy,
  type WorkbenchExecutionResources,
} from "@workbench-ai/workbench-contract";

import {
  normalizeSurfaceRelativePath,
  normalizeSurfaceSnapshotFiles,
} from "./snapshot-files.ts";
import { rejectUnknownKeys, requiredRecord } from "./validation.ts";

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
    id: normalizeSurfaceRelativePath(record.id, `${label}.id`),
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
  return normalizeSurfaceSnapshotFiles(value, label, { optional: true });
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
