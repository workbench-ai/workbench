import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const SCHEMA = "workbench.remote-target-binding.v1" as const;
const MAX_BYTES = 4 * 1024;

export type WorkbenchRemoteTargetKind = "operation" | "eval-draft";
export interface WorkbenchRemoteTarget { baseUrl: string; namespace?: string }

export async function bindWorkbenchRemoteTarget(kind: WorkbenchRemoteTargetKind, id: string, target: WorkbenchRemoteTarget, homeDir?: string): Promise<void> {
  const normalized = { baseUrl: normalizeWorkbenchBackendUrl(target.baseUrl), ...(target.namespace === undefined ? {} : { namespace: validNamespace(target.namespace) }) };
  const existing = await readOptionalWorkbenchRemoteTarget(kind, id, homeDir);
  if (existing) return assertSameTarget(id, existing, normalized);
  const binding = { schema: SCHEMA, id: validId(kind, id), ...normalized };
  const serialized = `${JSON.stringify(binding)}\n`;
  if (Buffer.byteLength(serialized) > MAX_BYTES) throw new Error("Remote target binding is too large.");
  const file = bindingPath(kind, id, homeDir), temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(temporary, serialized, { flag: "wx", mode: 0o600 });
    await fs.link(temporary, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const raced = await readOptionalWorkbenchRemoteTarget(kind, id, homeDir);
    if (!raced) throw error;
    assertSameTarget(id, raced, normalized);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function readOptionalWorkbenchRemoteTarget(kind: WorkbenchRemoteTargetKind, id: string, homeDir?: string): Promise<WorkbenchRemoteTarget | null> {
  let content: string;
  try {
    const file = bindingPath(kind, id, homeDir), stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Remote target binding for ${id} is invalid.`);
    if (stat.size > MAX_BYTES) throw new Error("Remote target binding is too large.");
    content = await fs.readFile(file, "utf8");
    if (Buffer.byteLength(content) > MAX_BYTES) throw new Error("Remote target binding is too large.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const value = JSON.parse(content) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Remote target binding for ${id} is invalid.`);
  const record = value as Record<string, unknown>, allowed = new Set(["schema", "id", "baseUrl", "namespace"]);
  const extra = Object.keys(record).find((key) => !allowed.has(key));
  if (extra) throw new Error(`Remote target binding contains unsupported field ${extra}.`);
  if (record.schema !== SCHEMA || record.id !== validId(kind, id) || typeof record.baseUrl !== "string" || (record.namespace !== undefined && typeof record.namespace !== "string")) {
    throw new Error(`Remote target binding for ${id} is invalid.`);
  }
  return { baseUrl: normalizeWorkbenchBackendUrl(record.baseUrl), ...(record.namespace ? { namespace: validNamespace(record.namespace as string) } : {}) };
}

function bindingPath(kind: WorkbenchRemoteTargetKind, id: string, homeDir?: string): string {
  return path.join(homeDir ?? os.homedir(), ".workbench", "remote-targets", kind, `${encodeURIComponent(validId(kind, id))}.json`);
}
function validId(kind: WorkbenchRemoteTargetKind, id: string): string { if (!(kind === "operation" ? /^op_[a-f0-9]{32}$/u : /^draft_[a-f0-9]{32}$/u).test(id)) throw new Error(`Remote ${kind} id is invalid.`); return id; }
export function normalizeWorkbenchBackendUrl(value: string): string { try { const url = new URL(value.trim()); if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) throw new Error(); return `${url.origin}${url.pathname === "/" ? "" : url.pathname.replace(/\/+$/u, "")}`; } catch { throw new Error("Workbench backend URL is invalid."); } }
function validNamespace(value: string): string { if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) throw new Error("Remote target namespace is invalid."); return value; }
function assertSameTarget(id: string, left: WorkbenchRemoteTarget, right: WorkbenchRemoteTarget): void { if (left.baseUrl !== right.baseUrl || left.namespace !== right.namespace) throw new Error(`Remote target ${id} is already bound to another backend.`); }
