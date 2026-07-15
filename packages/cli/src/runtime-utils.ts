import { promises as fs } from "node:fs";

export function positiveIntEnv(name: string): number | undefined {
  const value = process.env[name]?.trim();
  const parsed = value ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function pathExists(filePath: string): Promise<boolean> {
  return await fs.stat(filePath).then(() => true, () => false);
}
