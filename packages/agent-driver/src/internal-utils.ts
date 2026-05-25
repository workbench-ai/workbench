import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function appendNdjson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return process.env.HOME ?? inputPath;
  }

  if (inputPath.startsWith("~/")) {
    return path.join(process.env.HOME ?? "", inputPath.slice(2));
  }

  return inputPath;
}

export function resolveRuntimeHome(
  runtimeHome = process.env.AGENT_RUNTIME_HOME ?? path.join(os.homedir(), ".agent-runtime"),
): string {
  return path.resolve(expandHome(runtimeHome));
}

export function resolveCanonicalProjectRoot(repoRoot: string): string {
  const absoluteRoot = path.resolve(repoRoot);
  try {
    return realpathSync.native(absoluteRoot);
  } catch (error) {
    if (isMissingPathError(error)) {
      return absoluteRoot;
    }
    throw error;
  }
}
