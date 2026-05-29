import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { assertWorkbenchAdapterAuthEnvNameAllowed } from "@workbench-ai/workbench-contract";

export type WorkbenchAdapterAuthStatus =
  | "connected"
  | "reauth_required"
  | "disconnected";

export interface WorkbenchAdapterAuthTarget {
  adapterId: string;
  slot?: string;
  profile: string;
}

export interface WorkbenchAdapterAuthFile {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  mode?: number;
}

export interface WorkbenchAdapterAuthEnvVar {
  name: string;
  value: string;
}

export interface WorkbenchAdapterAuthBundle {
  adapterId: string;
  slot?: string;
  profile: string;
  method: string;
  status: "connected";
  version: number;
  files: WorkbenchAdapterAuthFile[];
  env?: WorkbenchAdapterAuthEnvVar[];
  updatedAt: string;
}

export interface WorkbenchAdapterAuthStatusRecord {
  adapterId: string;
  slot?: string;
  profile: string;
  status: WorkbenchAdapterAuthStatus;
  version: number;
  method?: string;
  updatedAt?: string;
  reason?: string;
}

export interface WorkbenchAdapterAuthStore {
  get(target: WorkbenchAdapterAuthTarget): Promise<WorkbenchAdapterAuthBundle | null>;
  put(bundle: WorkbenchAdapterAuthBundle): Promise<WorkbenchAdapterAuthBundle>;
  disconnect(target: WorkbenchAdapterAuthTarget, reason?: string): Promise<void>;
  markReauthRequired(target: WorkbenchAdapterAuthTarget, reason: string): Promise<void>;
  status(target: WorkbenchAdapterAuthTarget): Promise<WorkbenchAdapterAuthStatusRecord>;
  listStatus(): Promise<WorkbenchAdapterAuthStatusRecord[]>;
}

interface StoredWorkbenchAdapterAuthRecord {
  target: WorkbenchAdapterAuthTarget;
  status: WorkbenchAdapterAuthStatus;
  version: number;
  updatedAt?: string;
  reason?: string;
  bundle?: WorkbenchAdapterAuthBundle;
}

const ADAPTER_AUTH_STORE_VERSION = 1;
const DEFAULT_AUTH_PROFILE = "default";

export function defaultWorkbenchAdapterAuthStoreRoot(): string {
  return path.join(os.homedir(), ".workbench", "adapter-auth");
}

export function localWorkbenchAdapterAuthStore(
  root = defaultWorkbenchAdapterAuthStoreRoot(),
): WorkbenchAdapterAuthStore {
  return new FileWorkbenchAdapterAuthStore(root);
}

export function parseWorkbenchAdapterAuthTarget(
  value: string,
  profile = DEFAULT_AUTH_PROFILE,
): WorkbenchAdapterAuthTarget {
  const [adapterId, slot, ...rest] = value.split("/");
  if (!adapterId || rest.length > 0) {
    throw new Error("Adapter auth target must be adapter or adapter/slot.");
  }
  return normalizeWorkbenchAdapterAuthTarget({
    adapterId,
    ...(slot ? { slot } : {}),
    profile,
  });
}

export function normalizeWorkbenchAdapterAuthTarget(
  target: {
    adapterId: string;
    slot?: string;
    profile?: string;
  },
): WorkbenchAdapterAuthTarget {
  const adapterId = readAdapterAuthSegment(target.adapterId, "adapter id");
  const slot = target.slot === undefined
    ? undefined
    : readAdapterAuthSegment(target.slot, "auth slot");
  const profile = target.profile === undefined || target.profile === ""
    ? DEFAULT_AUTH_PROFILE
    : readAdapterAuthSegment(target.profile, "auth profile");
  return {
    adapterId,
    ...(slot ? { slot } : {}),
    profile,
  };
}

export function createWorkbenchAdapterAuthBundle(args: {
  target: WorkbenchAdapterAuthTarget;
  method: string;
  files?: WorkbenchAdapterAuthFile[];
  env?: Record<string, string> | WorkbenchAdapterAuthEnvVar[];
  now?: string;
}): WorkbenchAdapterAuthBundle {
  const files = args.files ?? [];
  const env = Array.isArray(args.env)
    ? args.env
    : Object.entries(args.env ?? {}).map(([name, value]) => ({ name, value }));
  if (files.length === 0 && env.length === 0) {
    throw new Error("Adapter auth requires at least one file or env var.");
  }
  return sanitizeWorkbenchAdapterAuthBundle({
    ...args.target,
    method: args.method,
    status: "connected",
    version: ADAPTER_AUTH_STORE_VERSION,
    files,
    ...(env.length > 0 ? { env } : {}),
    updatedAt: args.now ?? new Date().toISOString(),
  });
}

export function adapterAuthEnv(
  bundle: WorkbenchAdapterAuthBundle,
): Record<string, string> {
  return Object.fromEntries((bundle.env ?? []).map((entry) => [entry.name, entry.value]));
}

export function sanitizeWorkbenchAdapterAuthBundle(
  value: unknown,
): WorkbenchAdapterAuthBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Adapter auth bundle must be an object.");
  }
  const record = value as Record<string, unknown>;
  const target = normalizeWorkbenchAdapterAuthTarget({
    adapterId: readString(record.adapterId, "adapterId"),
    ...(record.slot !== undefined ? { slot: readString(record.slot, "slot") } : {}),
    profile: typeof record.profile === "string" ? record.profile : DEFAULT_AUTH_PROFILE,
  });
  if (record.status !== "connected") {
    throw new Error("Adapter auth bundle must be connected.");
  }
  const method = readAdapterAuthSegment(readString(record.method, "method"), "auth method");
  const files = Array.isArray(record.files)
    ? record.files.map(sanitizeWorkbenchAdapterAuthFile)
    : [];
  const env = Array.isArray(record.env)
    ? record.env.map(sanitizeWorkbenchAdapterAuthEnvVar)
    : [];
  return {
    ...target,
    method,
    status: "connected",
    version: ADAPTER_AUTH_STORE_VERSION,
    files,
    ...(env.length > 0 ? { env } : {}),
    updatedAt: typeof record.updatedAt === "string"
      ? record.updatedAt
      : new Date().toISOString(),
  };
}

class FileWorkbenchAdapterAuthStore implements WorkbenchAdapterAuthStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async get(target: WorkbenchAdapterAuthTarget): Promise<WorkbenchAdapterAuthBundle | null> {
    const record = await this.readRecord(target);
    return record?.status === "connected" && record.bundle
      ? sanitizeWorkbenchAdapterAuthBundle(record.bundle)
      : null;
  }

  async put(bundle: WorkbenchAdapterAuthBundle): Promise<WorkbenchAdapterAuthBundle> {
    const sanitized = sanitizeWorkbenchAdapterAuthBundle(bundle);
    const existing = await this.readRecord(sanitized).catch(() => null);
    const saved = {
      ...sanitized,
      version: Math.max(0, existing?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.writeRecord({
      target: normalizeWorkbenchAdapterAuthTarget(saved),
      status: "connected",
      version: saved.version,
      updatedAt: saved.updatedAt,
      bundle: saved,
    });
    return saved;
  }

  async disconnect(target: WorkbenchAdapterAuthTarget, reason = "disconnected"): Promise<void> {
    const normalized = normalizeWorkbenchAdapterAuthTarget(target);
    const existing = await this.readRecord(normalized).catch(() => null);
    await this.writeRecord({
      target: normalized,
      status: "disconnected",
      version: Math.max(0, existing?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      reason,
    });
  }

  async markReauthRequired(
    target: WorkbenchAdapterAuthTarget,
    reason: string,
  ): Promise<void> {
    const normalized = normalizeWorkbenchAdapterAuthTarget(target);
    const existing = await this.readRecord(normalized).catch(() => null);
    await this.writeRecord({
      target: normalized,
      status: "reauth_required",
      version: Math.max(0, existing?.version ?? 0),
      updatedAt: new Date().toISOString(),
      reason,
      bundle: existing?.bundle,
    });
  }

  async status(target: WorkbenchAdapterAuthTarget): Promise<WorkbenchAdapterAuthStatusRecord> {
    const normalized = normalizeWorkbenchAdapterAuthTarget(target);
    const record = await this.readRecord(normalized);
    if (!record) {
      return { ...normalized, status: "disconnected", version: 0 };
    }
    return statusFromRecord(record);
  }

  async listStatus(): Promise<WorkbenchAdapterAuthStatusRecord[]> {
    const files = await fs.readdir(this.root).catch(() => []);
    const records = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => await this.readRecordFile(path.join(this.root, file))),
    );
    return records
      .filter((record): record is StoredWorkbenchAdapterAuthRecord => Boolean(record))
      .map(statusFromRecord)
      .sort((left, right) =>
        adapterAuthTargetKey(left).localeCompare(adapterAuthTargetKey(right))
      );
  }

  private async readRecord(
    target: WorkbenchAdapterAuthTarget,
  ): Promise<StoredWorkbenchAdapterAuthRecord | null> {
    return await this.readRecordFile(this.recordPath(target));
  }

  private async readRecordFile(
    filePath: string,
  ): Promise<StoredWorkbenchAdapterAuthRecord | null> {
    const source = await fs.readFile(filePath, "utf8").catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    });
    if (source === null) {
      return null;
    }
    const parsed = JSON.parse(source) as StoredWorkbenchAdapterAuthRecord;
    return parsed?.target ? parsed : null;
  }

  private async writeRecord(record: StoredWorkbenchAdapterAuthRecord): Promise<void> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.recordPath(record.target), `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  private recordPath(target: WorkbenchAdapterAuthTarget): string {
    return path.join(this.root, `${adapterAuthTargetKey(target)}.json`);
  }
}

function statusFromRecord(
  record: StoredWorkbenchAdapterAuthRecord,
): WorkbenchAdapterAuthStatusRecord {
  return {
    ...record.target,
    status: record.status,
    version: record.version,
    ...(record.bundle?.method ? { method: record.bundle.method } : {}),
    ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
    ...(record.reason ? { reason: record.reason } : {}),
  };
}

function adapterAuthTargetKey(target: WorkbenchAdapterAuthTarget): string {
  return [
    target.adapterId,
    target.slot ?? "_",
    target.profile,
  ].join("__");
}

function sanitizeWorkbenchAdapterAuthFile(value: unknown): WorkbenchAdapterAuthFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Adapter auth file must be an object.");
  }
  const record = value as Record<string, unknown>;
  const filePath = readString(record.path, "file.path").replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (!filePath || filePath.split("/").some((part) => part === "." || part === ".." || part === "")) {
    throw new Error(`Unsafe adapter auth file path: ${filePath}`);
  }
  return {
    path: filePath,
    content: readString(record.content, "file.content"),
    encoding: record.encoding === "base64" ? "base64" : "utf8",
    ...(typeof record.mode === "number" && Number.isInteger(record.mode) ? { mode: record.mode } : {}),
  };
}

function sanitizeWorkbenchAdapterAuthEnvVar(value: unknown): WorkbenchAdapterAuthEnvVar {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Adapter auth env entry must be an object.");
  }
  const record = value as Record<string, unknown>;
  const name = readString(record.name, "env.name");
  const envValue = readString(record.value, "env.value");
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(name)) {
    throw new Error(`Adapter auth env var is invalid: ${name}`);
  }
  assertWorkbenchAdapterAuthEnvNameAllowed(name);
  if (!envValue.trim()) {
    throw new Error(`Adapter auth env var ${name} is empty.`);
  }
  return { name, value: envValue };
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Adapter auth ${label} must be a non-empty string.`);
  }
  return value;
}

function readAdapterAuthSegment(value: string, label: string): string {
  if (!/^[a-z][a-z0-9-]*$/u.test(value)) {
    throw new Error(`Adapter auth ${label} must be a lowercase identifier.`);
  }
  return value;
}
