import { promises as fs, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { hashJson, WorkbenchCodedError, type Json, type SurfaceSnapshotFile } from "@workbench-ai/workbench-core";
import YAML from "yaml";

const INSTALLS_SCHEMA = "workbench.skill-installs.v1";
const INSTALLS_FILE = ".workbench-installs.json";

export type SkillAccessTargetId = "codex" | "claude";
export type SkillAccessFor = SkillAccessTargetId | "all";
export type SkillAccessScope = "folder" | "global";
export type WorkbenchSkillAccessStatus = "current" | "modified" | "missing" | "unmanaged" | "duplicate-name";

export interface WorkbenchInstallSnapshot {
  name: string;
  files: SurfaceSnapshotFile[];
}

export interface WorkbenchInstallProvenanceInput {
  handle: string;
  versionId: string;
  baseUrl: string;
}

export interface WorkbenchInstallLedgerRecord extends WorkbenchInstallProvenanceInput {
  targetId: SkillAccessTargetId;
  skillName: string;
  installedAt: string;
  contentHash: string;
}

interface WorkbenchInstallLedgerFile {
  schema: typeof INSTALLS_SCHEMA;
  skills: Record<string, WorkbenchInstallLedgerRecord>;
}

export interface SkillAccessTargetRoot {
  target: SkillAccessTargetId;
  displayName: string;
  scope: SkillAccessScope;
  root: string;
  writable: boolean;
  deprecated?: boolean;
}

export interface SkillAccessTargetView {
  id: SkillAccessTargetId;
  displayName: string;
  scope: SkillAccessScope;
  roots: SkillAccessTargetRoot[];
  writeRoot: string;
}

export interface WorkbenchInstalledSkill {
  target: SkillAccessTargetId;
  targetDisplayName: string;
  scope: SkillAccessScope;
  root: string;
  name: string;
  directoryName: string;
  description?: string;
  path?: string;
  versionId?: string;
  handle?: string;
  baseUrl?: string;
  installedAt?: string;
  contentHash?: string;
  status: WorkbenchSkillAccessStatus;
  deprecatedRoot?: boolean;
}

export interface WorkbenchSkillAccessInventory {
  scope: SkillAccessScope;
  dir?: string;
  requestedFor?: SkillAccessFor;
  currentAgent?: SkillAccessTargetId;
  note?: string;
  targets: SkillAccessTargetView[];
  skills: WorkbenchInstalledSkill[];
  next: null;
}

export interface WorkbenchInstallTargetResult {
  target: SkillAccessTargetId;
  scope: SkillAccessScope;
  root: string;
  destination: string;
  previous: "none" | "updated" | "overwritten" | "unchanged";
  result: "installed" | "planned" | "unchanged";
  filesCopied: number;
  contentHash: string;
  ledgerPath: string;
}

export interface WorkbenchInstallTargetsResult {
  result: "installed" | "planned" | "unchanged";
  scope: SkillAccessScope;
  dir?: string;
  requestedFor?: SkillAccessFor;
  currentAgent?: SkillAccessTargetId;
  skill: string;
  filesCopied: number;
  contentHash: string;
  targets: WorkbenchInstallTargetResult[];
}

export function resolveSkillAccessTargets(options: {
  requestedFor?: string;
  global?: boolean;
  dir?: string;
  write: boolean;
  env?: NodeJS.ProcessEnv;
  sourceForRemediation?: string;
}): {
  scope: SkillAccessScope;
  dir?: string;
  requestedFor?: SkillAccessFor;
  currentAgent?: SkillAccessTargetId;
  note?: string;
  targets: SkillAccessTargetView[];
} {
  const env = options.env ?? process.env;
  const requestedFor = parseRequestedFor(options.requestedFor);
  const detected = detectCurrentSkillAccessTargets(env);
  const targetIds = requestedFor
    ? requestedFor === "all" ? ["codex", "claude"] as SkillAccessTargetId[] : [requestedFor]
    : detected.length === 1
      ? detected
      : options.write
        ? failUndetectedWriteTarget(options.sourceForRemediation)
        : ["codex", "claude"] as SkillAccessTargetId[];
  const scope: SkillAccessScope = options.global === true ? "global" : "folder";
  const resolvedDir = scope === "folder" ? path.resolve(options.dir ?? process.cwd()) : undefined;
  return {
    scope,
    ...(resolvedDir ? { dir: resolvedDir } : {}),
    ...(requestedFor ? { requestedFor } : {}),
    ...(detected.length === 1 ? { currentAgent: detected[0] } : {}),
    ...(!requestedFor && detected.length !== 1
      ? { note: detected.length > 1 ? "Multiple current coding agents detected; showing Codex and Claude." : "No current coding agent detected; showing Codex and Claude." }
      : {}),
    targets: targetIds.map((target) => targetView(target, scope, resolvedDir, env)),
  };
}

export async function readInstalledSkillsInventory(options: {
  requestedFor?: string;
  global?: boolean;
  dir?: string;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<WorkbenchSkillAccessInventory> {
  const request = resolveSkillAccessTargets({
    requestedFor: options.requestedFor,
    global: options.global,
    dir: options.dir,
    write: false,
    env: options.env,
  });
  const skills: WorkbenchInstalledSkill[] = [];
  for (const target of request.targets) {
    const targetRows: WorkbenchInstalledSkill[] = [];
    for (const root of target.roots) {
      targetRows.push(...await readRootInventory(root));
    }
    markDuplicateSkillNames(targetRows);
    skills.push(...targetRows);
  }
  skills.sort((left, right) =>
    left.name.localeCompare(right.name) ||
    left.target.localeCompare(right.target) ||
    (left.path ?? "").localeCompare(right.path ?? "")
  );
  return {
    scope: request.scope,
    ...(request.dir ? { dir: request.dir } : {}),
    ...(request.requestedFor ? { requestedFor: request.requestedFor } : {}),
    ...(request.currentAgent ? { currentAgent: request.currentAgent } : {}),
    ...(request.note ? { note: request.note } : {}),
    targets: request.targets,
    skills,
    next: null,
  };
}

export async function installSnapshotToSkillTargets(options: {
  snapshot: WorkbenchInstallSnapshot;
  overwrite: boolean;
  dryRun: boolean;
  provenance: WorkbenchInstallProvenanceInput;
  requestedFor?: string;
  global?: boolean;
  dir?: string;
  installedAt?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<WorkbenchInstallTargetsResult> {
  const request = resolveSkillAccessTargets({
    requestedFor: options.requestedFor,
    global: options.global,
    dir: options.dir,
    write: true,
    env: options.env,
    sourceForRemediation: options.provenance.handle,
  });
  const packageFiles = installPackageFiles(options.snapshot.files);
  if (!packageFiles.some((file) => file.path === "SKILL.md")) {
    throw new WorkbenchCodedError("install_failed", `Published source ${options.provenance.handle} does not contain SKILL.md.`, {
      subject: { source: options.provenance.handle },
      exitCode: 1,
    });
  }
  const skillName = canonicalSkillDirectoryName({ name: options.snapshot.name, files: packageFiles });
  const contentHash = contentHashForFiles(packageFiles);
  const results: WorkbenchInstallTargetResult[] = [];
  for (const target of request.targets) {
    results.push(await installPackageInRoot({
      target,
      skillName,
      files: packageFiles,
      contentHash,
      overwrite: options.overwrite,
      dryRun: options.dryRun,
      provenance: options.provenance,
      installedAt: options.installedAt,
    }));
  }
  const filesCopied = results.reduce((sum, result) => sum + result.filesCopied, 0);
  const result = options.dryRun
    ? "planned"
    : results.every((entry) => entry.result === "unchanged")
      ? "unchanged"
      : "installed";
  return {
    result,
    scope: request.scope,
    ...(request.dir ? { dir: request.dir } : {}),
    ...(request.requestedFor ? { requestedFor: request.requestedFor } : {}),
    ...(request.currentAgent ? { currentAgent: request.currentAgent } : {}),
    skill: skillName,
    filesCopied,
    contentHash,
    targets: results,
  };
}

export function installedInventoryToJson(inventory: WorkbenchSkillAccessInventory): Record<string, Json> {
  return {
    scope: inventory.scope,
    ...(inventory.dir ? { dir: inventory.dir } : {}),
    ...(inventory.requestedFor ? { for: inventory.requestedFor } : {}),
    ...(inventory.currentAgent ? { currentAgent: inventory.currentAgent } : {}),
    ...(inventory.note ? { note: inventory.note } : {}),
    targets: inventory.targets.map((target) => ({
      id: target.id,
      displayName: target.displayName,
      scope: target.scope,
      writeRoot: target.writeRoot,
      roots: target.roots.map((root) => ({
        target: root.target,
        scope: root.scope,
        path: root.root,
        writable: root.writable,
        ...(root.deprecated ? { deprecated: true } : {}),
      })),
    })),
    skills: inventory.skills.map((skill) => ({
      target: skill.target,
      targetDisplayName: skill.targetDisplayName,
      scope: skill.scope,
      root: skill.root,
      name: skill.name,
      directoryName: skill.directoryName,
      ...(skill.description ? { description: skill.description } : {}),
      ...(skill.path ? { path: skill.path } : {}),
      status: skill.status,
      ...(skill.contentHash ? { contentHash: skill.contentHash } : {}),
      ...(skill.versionId ? { versionId: skill.versionId } : {}),
      ...(skill.handle ? { handle: skill.handle } : {}),
      ...(skill.baseUrl ? { baseUrl: skill.baseUrl } : {}),
      ...(skill.installedAt ? { installedAt: skill.installedAt } : {}),
      ...(skill.deprecatedRoot ? { deprecatedRoot: true } : {}),
    })),
    next: inventory.next,
  };
}

export function installResultToJson(result: WorkbenchInstallTargetsResult): Record<string, Json> {
  return {
    result: result.result,
    scope: result.scope,
    ...(result.dir ? { dir: result.dir } : {}),
    ...(result.requestedFor ? { for: result.requestedFor } : {}),
    ...(result.currentAgent ? { currentAgent: result.currentAgent } : {}),
    skill: result.skill,
    filesCopied: result.filesCopied,
    contentHash: result.contentHash,
    targets: result.targets.map((target) => ({
      target: target.target,
      scope: target.scope,
      root: target.root,
      destination: target.destination,
      previous: target.previous,
      result: target.result,
      filesCopied: target.filesCopied,
      contentHash: target.contentHash,
      ledgerPath: target.ledgerPath,
    })),
    next: null,
  };
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

export function installPackageFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  return files
    .map((file) => ({
      ...file,
      path: normalizeInstallSnapshotPath(file.path),
    }))
    .filter((file) => isInstallPackagePath(file.path))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function canonicalSkillDirectoryName(snapshot: WorkbenchInstallSnapshot): string {
  const skillFile = snapshot.files.find((file) => normalizeInstallSnapshotPath(file.path) === "SKILL.md");
  if (skillFile && skillFile.encoding !== "base64") {
    const metadata = parseSkillMetadata(skillFile.content);
    if (metadata.name && isValidDirectoryName(metadata.name)) {
      return metadata.name;
    }
  }
  return installStoreSkillDirectoryName(snapshot.name);
}

function parseRequestedFor(value: string | undefined): SkillAccessFor | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "codex" || value === "claude" || value === "all") {
    return value;
  }
  throw new WorkbenchCodedError("usage", "workbench skills/install --for expects codex, claude, or all.", {
    remediation: "workbench skills --for all",
    subject: { for: value },
    exitCode: 2,
  });
}

function failUndetectedWriteTarget(source: string | undefined): never {
  const remediationSource = source ?? "OWNER/SKILL";
  throw new WorkbenchCodedError("usage", "workbench install could not detect the current coding agent.", {
    remediation: `workbench install ${remediationSource} --for codex`,
    subject: { supportedTargets: ["codex", "claude"] },
    exitCode: 2,
  });
}

function detectCurrentSkillAccessTargets(env: NodeJS.ProcessEnv): SkillAccessTargetId[] {
  const targets: SkillAccessTargetId[] = [];
  const explicit = env.WORKBENCH_CURRENT_AGENT?.trim().toLowerCase();
  if (explicit === "codex" || explicit === "claude") {
    return [explicit];
  }
  if (env.CODEX_SHELL || env.CODEX_THREAD_ID || env.CODEX_HOME || env.CODEX_CI) {
    targets.push("codex");
  }
  if (env.CLAUDE_CODE_SESSION_ID || env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) {
    targets.push("claude");
  }
  return [...new Set(targets)];
}

function targetView(
  target: SkillAccessTargetId,
  scope: SkillAccessScope,
  dir: string | undefined,
  env: NodeJS.ProcessEnv,
): SkillAccessTargetView {
  const displayName = target === "codex" ? "Codex" : "Claude";
  const roots = target === "codex"
    ? codexRoots(scope, dir, env)
    : claudeRoots(scope, dir, env);
  const writeRoot = target === "codex"
    ? codexWriteRoot(scope, dir, env)
    : claudeWriteRoot(scope, dir, env);
  return { id: target, displayName, scope, roots, writeRoot };
}

function codexRoots(scope: SkillAccessScope, dir: string | undefined, env: NodeJS.ProcessEnv): SkillAccessTargetRoot[] {
  if (scope === "global") {
    const roots: SkillAccessTargetRoot[] = [{
      target: "codex",
      displayName: "Codex",
      scope,
      root: path.join(homeDirectory(env), ".agents", "skills"),
      writable: true,
    }];
    const codexHome = env.CODEX_HOME?.trim();
    if (codexHome) {
      roots.push({
        target: "codex",
        displayName: "Codex",
        scope,
        root: path.join(codexHome, "skills"),
        writable: false,
        deprecated: true,
      });
    }
    return dedupeRoots(roots);
  }
  const folder = dir ?? process.cwd();
  return codexFolderReadRoots(folder).map((root) => ({
    target: "codex",
    displayName: "Codex",
    scope,
    root,
    writable: root === path.join(folder, ".agents", "skills"),
  }));
}

function codexWriteRoot(scope: SkillAccessScope, dir: string | undefined, env: NodeJS.ProcessEnv): string {
  return scope === "global"
    ? path.join(homeDirectory(env), ".agents", "skills")
    : path.join(dir ?? process.cwd(), ".agents", "skills");
}

function claudeRoots(scope: SkillAccessScope, dir: string | undefined, env: NodeJS.ProcessEnv): SkillAccessTargetRoot[] {
  const root = scope === "global"
    ? claudeGlobalRoot(env)
    : path.join(dir ?? process.cwd(), ".claude", "skills");
  return [{
    target: "claude",
    displayName: "Claude",
    scope,
    root,
    writable: true,
  }];
}

function claudeWriteRoot(scope: SkillAccessScope, dir: string | undefined, env: NodeJS.ProcessEnv): string {
  return scope === "global" ? claudeGlobalRoot(env) : path.join(dir ?? process.cwd(), ".claude", "skills");
}

function claudeGlobalRoot(env: NodeJS.ProcessEnv): string {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim();
  return path.join(configDir || path.join(homeDirectory(env), ".claude"), "skills");
}

function codexFolderReadRoots(dir: string): string[] {
  const roots: string[] = [];
  const gitRoot = findGitRootSync(dir);
  let current = path.resolve(dir);
  while (true) {
    roots.push(path.join(current, ".agents", "skills"));
    if (!gitRoot || current === gitRoot) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return roots;
}

function findGitRootSync(start: string): string | null {
  let current = path.resolve(start);
  while (true) {
    try {
      const stat = statSync(path.join(current, ".git"));
      if (stat.isDirectory() || stat.isFile()) {
        return current;
      }
    } catch {
      // Keep walking.
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function dedupeRoots(roots: SkillAccessTargetRoot[]): SkillAccessTargetRoot[] {
  const seen = new Set<string>();
  return roots.filter((root) => {
    if (seen.has(root.root)) {
      return false;
    }
    seen.add(root.root);
    return true;
  });
}

async function readRootInventory(root: SkillAccessTargetRoot): Promise<WorkbenchInstalledSkill[]> {
  const ledger = await readInstallLedger(root.root);
  const rows: WorkbenchInstalledSkill[] = [];
  const seenDirectories = new Set<string>();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root.root, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return missingRowsForLedger(root, ledger, seenDirectories);
    }
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const skillPath = path.join(root.root, entry.name);
    if (!entry.isDirectory() && !await isDirectorySymlink(skillPath)) {
      continue;
    }
    const skillMarkdown = await fs.readFile(path.join(skillPath, "SKILL.md"), "utf8").catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    });
    if (skillMarkdown === null) {
      continue;
    }
    seenDirectories.add(entry.name);
    const metadata = parseSkillMetadata(skillMarkdown);
    const contentHash = await readExistingTreeHash(skillPath);
    const record = validLedgerRecord(ledger.skills[entry.name], root.target);
    const status: WorkbenchSkillAccessStatus = record
      ? contentHash === record.contentHash ? "current" : "modified"
      : "unmanaged";
    rows.push({
      target: root.target,
      targetDisplayName: root.displayName,
      scope: root.scope,
      root: root.root,
      name: metadata.name ?? record?.skillName ?? entry.name,
      directoryName: entry.name,
      ...(metadata.description ? { description: metadata.description } : {}),
      path: skillPath,
      status,
      contentHash,
      ...(record?.versionId ? { versionId: record.versionId } : {}),
      ...(record?.handle ? { handle: record.handle } : {}),
      ...(record?.baseUrl ? { baseUrl: record.baseUrl } : {}),
      ...(record?.installedAt ? { installedAt: record.installedAt } : {}),
      ...(root.deprecated ? { deprecatedRoot: true } : {}),
    });
  }
  rows.push(...missingRowsForLedger(root, ledger, seenDirectories));
  return rows;
}

function missingRowsForLedger(
  root: SkillAccessTargetRoot,
  ledger: WorkbenchInstallLedgerFile,
  seenDirectories: ReadonlySet<string>,
): WorkbenchInstalledSkill[] {
  return Object.entries(ledger.skills)
    .filter(([directoryName, record]) => !seenDirectories.has(directoryName) && record.targetId === root.target)
    .map(([directoryName, record]) => ({
      target: root.target,
      targetDisplayName: root.displayName,
      scope: root.scope,
      root: root.root,
      name: record.skillName || directoryName,
      directoryName,
      status: "missing" as const,
      versionId: record.versionId,
      handle: record.handle,
      baseUrl: record.baseUrl,
      installedAt: record.installedAt,
      contentHash: record.contentHash,
      ...(root.deprecated ? { deprecatedRoot: true } : {}),
    }));
}

function markDuplicateSkillNames(rows: WorkbenchInstalledSkill[]): void {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "missing") {
      continue;
    }
    counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
  }
  for (const row of rows) {
    if (row.status !== "missing" && (counts.get(row.name) ?? 0) > 1) {
      row.status = "duplicate-name";
    }
  }
}

async function isDirectorySymlink(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function installPackageInRoot(args: {
  target: SkillAccessTargetView;
  skillName: string;
  files: readonly SurfaceSnapshotFile[];
  contentHash: string;
  overwrite: boolean;
  dryRun: boolean;
  provenance: WorkbenchInstallProvenanceInput;
  installedAt?: string;
}): Promise<WorkbenchInstallTargetResult> {
  const root = args.target.writeRoot;
  const destination = path.join(root, args.skillName);
  const ledger = await readInstallLedger(root);
  const existingHash = await readExistingTreeHash(destination).catch((error) => {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    if (code === "ENOTDIR") {
      const conflictPath = (error as NodeJS.ErrnoException).path ?? destination;
      throw new WorkbenchCodedError("install_failed", `Skill path is blocked by an existing file: ${conflictPath}`, {
        remediation: `Remove the conflicting file ${conflictPath} and rerun the install.`,
        subject: { destination, conflictPath },
        exitCode: 1,
      });
    }
    throw error;
  });
  const record = validLedgerRecord(ledger.skills[args.skillName], args.target.id);
  const canUpdateExisting = Boolean(
    existingHash &&
      record &&
      existingHash === record.contentHash &&
      record.handle === args.provenance.handle &&
      record.baseUrl === args.provenance.baseUrl,
  );
  const previous: WorkbenchInstallTargetResult["previous"] = existingHash
    ? existingHash === args.contentHash ? "unchanged" : canUpdateExisting ? "updated" : "overwritten"
    : "none";
  if (!args.dryRun && existingHash && previous === "overwritten" && !args.overwrite) {
    const status = record ? "modified" : "unmanaged";
    throw new WorkbenchCodedError("install_failed", `Skill destination has ${status} content: ${destination}`, {
      remediation: `workbench install ${args.provenance.handle} --yes`,
      subject: { destination, status, target: args.target.id },
      exitCode: 1,
    });
  }
  if (!args.dryRun && previous !== "unchanged") {
    await fs.rm(destination, { recursive: true, force: true });
    await writeSnapshotFiles(destination, args.files);
  }
  if (!args.dryRun) {
    await writeInstallLedgerRecord(root, args.skillName, {
      ...args.provenance,
      targetId: args.target.id,
      skillName: args.skillName,
      installedAt: args.installedAt ?? new Date().toISOString(),
      contentHash: args.contentHash,
    });
  }
  return {
    target: args.target.id,
    scope: args.target.scope,
    root,
    destination,
    previous,
    result: args.dryRun ? "planned" : previous === "unchanged" ? "unchanged" : "installed",
    filesCopied: previous === "unchanged" ? 0 : args.files.length,
    contentHash: args.contentHash,
    ledgerPath: installsPathForRoot(root),
  };
}

function isInstallPackagePath(filePath: string): boolean {
  const normalized = normalizeInstallSnapshotPath(filePath);
  return normalized !== ".workbench" &&
    !normalized.startsWith(".workbench/") &&
    normalized !== ".agents" &&
    !normalized.startsWith(".agents/");
}

function parseSkillMetadata(markdown: string): { name?: string; description?: string } {
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) {
    return {};
  }
  const newline = markdown.startsWith("---\r\n") ? "\r\n" : "\n";
  const closing = markdown.indexOf(`${newline}---${newline}`, 3);
  if (closing === -1) {
    return {};
  }
  const source = markdown.slice(3 + newline.length, closing);
  try {
    const parsed = YAML.parse(source) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record.name === "string" && record.name.trim() ? { name: record.name.trim() } : {}),
      ...(typeof record.description === "string" && record.description.trim() ? { description: record.description.trim() } : {}),
    };
  } catch {
    return {};
  }
}

function validLedgerRecord(value: unknown, targetId?: SkillAccessTargetId): WorkbenchInstallLedgerRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const parsedTarget = record.targetId === "codex" || record.targetId === "claude" ? record.targetId : "";
  const handle = typeof record.handle === "string" ? record.handle : "";
  const versionId = typeof record.versionId === "string" ? record.versionId : "";
  const baseUrl = typeof record.baseUrl === "string" ? record.baseUrl : "";
  const skillName = typeof record.skillName === "string" ? record.skillName : "";
  const installedAt = typeof record.installedAt === "string" ? record.installedAt : "";
  const contentHash = typeof record.contentHash === "string" ? record.contentHash : "";
  if (!parsedTarget || !handle || !versionId || !baseUrl || !skillName || !installedAt || !contentHash) {
    return null;
  }
  if (targetId && parsedTarget !== targetId) {
    return null;
  }
  return { targetId: parsedTarget, handle, versionId, baseUrl, skillName, installedAt, contentHash };
}

async function writeInstallLedgerRecord(
  root: string,
  skillName: string,
  record: WorkbenchInstallLedgerRecord,
): Promise<void> {
  const ledger = await readInstallLedger(root);
  ledger.skills[skillName] = record;
  await fs.mkdir(root, { recursive: true });
  const filePath = installsPathForRoot(root);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(ledger, null, 2)}\n`);
  await fs.rename(tempPath, filePath);
}

async function readInstallLedger(root: string): Promise<WorkbenchInstallLedgerFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(installsPathForRoot(root), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyLedger();
    }
    const record = parsed as Record<string, unknown>;
    if (record.schema !== INSTALLS_SCHEMA || !record.skills || typeof record.skills !== "object" || Array.isArray(record.skills)) {
      return emptyLedger();
    }
    return {
      schema: INSTALLS_SCHEMA,
      skills: Object.fromEntries(Object.entries(record.skills as Record<string, unknown>).flatMap(([key, value]) => {
        const valid = validLedgerRecord(value);
        return valid ? [[key, valid]] : [];
      })),
    };
  } catch {
    return emptyLedger();
  }
}

function emptyLedger(): WorkbenchInstallLedgerFile {
  return {
    schema: INSTALLS_SCHEMA,
    skills: {},
  };
}

function installsPathForRoot(root: string): string {
  return path.join(root, INSTALLS_FILE);
}

function installStoreSkillDirectoryName(skillName: string): string {
  const normalized = skillName.trim();
  if (!isValidDirectoryName(normalized)) {
    throw new WorkbenchCodedError("install_failed", `Invalid skill name for install target: ${skillName}`, {
      subject: { skillName },
      exitCode: 1,
    });
  }
  return normalized;
}

function isValidDirectoryName(value: string): boolean {
  return value.length > 0 &&
    !value.includes("\0") &&
    !value.includes("/") &&
    !value.includes("\\") &&
    value !== "." &&
    value !== "..";
}

function contentHashForFiles(files: readonly SurfaceSnapshotFile[]): string {
  return hashJson(files.map((file) => ({
    path: normalizeInstallSnapshotPath(file.path),
    executable: file.executable === true,
    contentBase64: installFileContent(file).toString("base64"),
  })).sort((left, right) => left.path.localeCompare(right.path)));
}

function installFileContent(file: SurfaceSnapshotFile): Buffer {
  if (file.encoding === "base64") {
    return Buffer.from(file.content, "base64");
  }
  return Buffer.from(file.content);
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

async function readExistingTreeHash(root: string): Promise<string> {
  const files = new Map<string, Buffer>();
  const executable = new Map<string, boolean>();
  await readExistingTreeInto(root, "", files, executable);
  return hashJson([...files.entries()].map(([filePath, content]) => ({
    path: filePath,
    executable: executable.get(filePath) === true,
    contentBase64: content.toString("base64"),
  })).sort((left, right) => left.path.localeCompare(right.path)));
}

async function readExistingTreeInto(
  root: string,
  relativeDir: string,
  result: Map<string, Buffer>,
  executable: Map<string, boolean>,
): Promise<void> {
  const dir = path.join(root, relativeDir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    if (relativePath === INSTALLS_FILE) {
      continue;
    }
    const fullPath = path.join(root, relativePath);
    if (entry.isDirectory()) {
      await readExistingTreeInto(root, relativePath, result, executable);
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath);
      const normalized = relativePath.replace(/\\/gu, "/");
      result.set(normalized, await fs.readFile(fullPath));
      executable.set(normalized, (stat.mode & 0o111) !== 0);
    }
  }
}

function homeDirectory(env: NodeJS.ProcessEnv): string {
  return env.HOME?.trim() || os.homedir();
}
