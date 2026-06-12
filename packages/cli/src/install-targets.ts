import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { WorkbenchCodedError, type Json, type SurfaceSnapshotFile } from "@workbench-ai/workbench-core";

export type WorkbenchInstallAgentTarget = "codex" | "claude";
export type WorkbenchInstallTargetName = WorkbenchInstallAgentTarget | "local";

export interface WorkbenchInstallSnapshot {
  name: string;
  files: SurfaceSnapshotFile[];
}

export interface WorkbenchInstallTarget {
  agent: WorkbenchInstallTargetName;
  mode: "copy";
  destination: string;
}

export interface WorkbenchInstallTargetResult extends WorkbenchInstallTarget {
  previous: "none" | "overwritten" | "unchanged";
}

export interface WorkbenchInstallResult {
  result: "installed" | "unchanged";
  targets: WorkbenchInstallTargetResult[];
  filesCopied: number;
}

export function supportedInstallTargets(): WorkbenchInstallTarget[] {
  return [
    { agent: "codex", mode: "copy", destination: path.join(workbenchAgentHome("codex"), "skills", "<skill>") },
    { agent: "claude", mode: "copy", destination: path.join(workbenchAgentHome("claude"), "skills", "<skill>") },
    { agent: "local", mode: "copy", destination: path.join(process.cwd(), ".agents", "skills", "<skill>") },
  ];
}

export function resolveInstallTargets(options: {
  agents: readonly string[];
  local: boolean;
  skillName: string;
}): WorkbenchInstallTarget[] {
  const targets: WorkbenchInstallTarget[] = [];
  for (const rawAgent of options.agents) {
    const agent = rawAgent.trim().toLowerCase();
    if (agent !== "codex" && agent !== "claude") {
      throw new WorkbenchCodedError("usage", `Unsupported install agent: ${rawAgent}`, {
        remediation: "Use --agent codex, --agent claude, or --local.",
        exitCode: 2,
      });
    }
    targets.push({
      agent,
      mode: "copy",
      destination: path.join(workbenchAgentHome(agent), "skills", options.skillName),
    });
  }
  if (options.local) {
    targets.push({
      agent: "local",
      mode: "copy",
      destination: path.join(process.cwd(), ".agents", "skills", options.skillName),
    });
  }
  if (targets.length === 0) {
    throw new WorkbenchCodedError("install_target_required", "workbench install requires an explicit target.", {
      remediation: "Run workbench install --source SOURCE --agent codex, workbench install --source SOURCE --agent claude, or workbench install --source SOURCE --local.",
      exitCode: 2,
    });
  }
  return dedupeTargets(targets);
}

export async function installSnapshotToTargets(options: {
  snapshot: WorkbenchInstallSnapshot;
  targets: readonly WorkbenchInstallTarget[];
  overwrite: boolean;
  dryRun: boolean;
}): Promise<WorkbenchInstallResult> {
  const normalizedFiles = options.snapshot.files.map((file) => ({
    ...file,
    path: normalizeInstallSnapshotPath(file.path),
  }));
  const next = new Map(normalizedFiles.map((file) => [file.path, installFileContent(file)]));
  // Pre-validate every target before mutating any destination so a conflict
  // on a later target cannot leave an earlier target partially installed.
  const plan: Array<{ target: WorkbenchInstallTarget; previous: "none" | "overwritten" | "unchanged" }> = [];
  for (const target of options.targets) {
    const existing = await readExistingTree(target.destination).catch((error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return null;
      }
      if (code === "ENOTDIR") {
        const conflictPath = (error as NodeJS.ErrnoException).path ?? target.destination;
        throw new WorkbenchCodedError("install_failed", `Install target path is blocked by an existing file: ${conflictPath}`, {
          remediation: `Remove the conflicting file ${conflictPath} and rerun the install.`,
          subject: { destination: target.destination, conflictPath },
          exitCode: 1,
        });
      }
      throw error;
    });
    const identical = existing ? fileMapsEqual(existing, next) : false;
    if (identical) {
      plan.push({ target, previous: "unchanged" });
      continue;
    }
    if (existing && !options.overwrite) {
      throw new WorkbenchCodedError("install_failed", `Install target already exists: ${target.destination}`, {
        remediation: "Pass --yes to overwrite the existing target.",
        subject: { destination: target.destination },
        exitCode: 1,
      });
    }
    plan.push({ target, previous: existing ? "overwritten" : "none" });
  }
  let filesCopied = 0;
  const results: WorkbenchInstallTargetResult[] = [];
  for (const entry of plan) {
    results.push({ ...entry.target, previous: entry.previous });
    if (entry.previous === "unchanged") {
      continue;
    }
    filesCopied += normalizedFiles.length;
    if (!options.dryRun) {
      await fs.rm(entry.target.destination, { recursive: true, force: true });
      await writeSnapshotFiles(entry.target.destination, normalizedFiles);
    }
  }
  return {
    result: plan.some((entry) => entry.previous !== "unchanged") ? "installed" : "unchanged",
    targets: results,
    filesCopied,
  };
}

function workbenchAgentHome(agent: WorkbenchInstallAgentTarget): string {
  if (agent === "codex") {
    return process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
  }
  return process.env.CLAUDE_HOME?.trim() || path.join(os.homedir(), ".claude");
}

function dedupeTargets(targets: readonly WorkbenchInstallTarget[]): WorkbenchInstallTarget[] {
  const byDestination = new Map<string, WorkbenchInstallTarget>();
  for (const target of targets) {
    byDestination.set(target.destination, target);
  }
  return [...byDestination.values()];
}

export function normalizeInstallSnapshotPath(filePath: string): string {
  const normalized = filePath.replace(/\\/gu, "/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/")) {
    throw new WorkbenchCodedError("install_failed", `Invalid source file path: ${filePath}`, {
      subject: { path: filePath },
      exitCode: 1,
    });
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new WorkbenchCodedError("install_failed", `Invalid source file path: ${filePath}`, {
      subject: { path: filePath },
      exitCode: 1,
    });
  }
  return normalized;
}

function installFileContent(file: SurfaceSnapshotFile): Buffer | string {
  if (file.encoding === "base64") {
    return Buffer.from(file.content, "base64");
  }
  return file.content;
}

async function writeSnapshotFiles(root: string, files: readonly SurfaceSnapshotFile[]): Promise<void> {
  for (const file of files) {
    const filePath = path.join(root, file.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, installFileContent(file));
    if (file.executable) {
      await fs.chmod(filePath, 0o755);
    }
  }
}

async function readExistingTree(root: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  await readExistingTreeInto(root, "", result);
  return result;
}

async function readExistingTreeInto(root: string, relativeDir: string, result: Map<string, Buffer>): Promise<void> {
  const dir = path.join(root, relativeDir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    const fullPath = path.join(root, relativePath);
    if (entry.isDirectory()) {
      await readExistingTreeInto(root, relativePath, result);
    } else if (entry.isFile()) {
      result.set(relativePath.replace(/\\/gu, "/"), await fs.readFile(fullPath));
    }
  }
}

function fileMapsEqual(left: Map<string, Buffer>, right: Map<string, Buffer | string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [key, rightValue] of right) {
    const leftValue = left.get(key);
    if (!leftValue) {
      return false;
    }
    const rightBuffer = Buffer.isBuffer(rightValue) ? rightValue : Buffer.from(rightValue);
    if (!leftValue.equals(rightBuffer)) {
      return false;
    }
  }
  return true;
}

export function installTargetsToJson(targets: readonly WorkbenchInstallTarget[]): Json[] {
  return targets.map((target) => ({
    agent: target.agent,
    mode: target.mode,
    destination: target.destination,
  }));
}
