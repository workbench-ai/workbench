import { promises as fs, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { hashJson, quoteShellArg, WorkbenchCodedError, type Json, type SurfaceSnapshotFile } from "@workbench-ai/workbench-core";
import YAML from "yaml";

const INSTALLS_SCHEMA = "workbench.skill-installs.v1";
const INSTALLS_FILE = ".workbench-installs.json";

export type SkillAccessTargetId = "codex" | "claude";
export type SkillAccessScope = "folder" | "global";
export type WorkbenchSkillAccessStatus = "current" | "modified" | "missing" | "project" | "unmanaged" | "duplicate-name";

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
  workbenchProject?: boolean;
  deprecatedRoot?: boolean;
}

export interface WorkbenchSkillAccessInventory {
  scopes: SkillAccessScope[];
  dir?: string;
  target?: SkillAccessTargetId;
  currentAgent?: SkillAccessTargetId;
  targets: SkillAccessTargetView[];
  skills: WorkbenchInstalledSkill[];
  next: null;
}

export interface WorkbenchInstallTargetResult {
  target: SkillAccessTargetId;
  scope: SkillAccessScope;
  root: string;
  destination: string;
  previous: "none" | "updated" | "modified" | "unmanaged" | "unchanged";
  result: "installed" | "planned" | "blocked" | "unchanged";
  requiresOverwrite?: boolean;
  remediation?: string;
  filesCopied: number;
  contentHash: string;
  ledgerPath: string;
}

export interface WorkbenchInstallTargetsResult {
  result: "installed" | "planned" | "blocked" | "unchanged";
  requiresOverwrite?: boolean;
  remediation?: string;
  scope: SkillAccessScope;
  dir?: string;
  target: SkillAccessTargetId;
  currentAgent?: SkillAccessTargetId;
  skill: string;
  filesCopied: number;
  contentHash: string;
  targets: WorkbenchInstallTargetResult[];
}

export function resolveSkillAccessTargets(options: {
  target?: string;
  scope?: string;
  dir?: string;
  write: boolean;
  env?: NodeJS.ProcessEnv;
  sourceForRemediation?: string;
}): {
  scopes: SkillAccessScope[];
  dir?: string;
  target?: SkillAccessTargetId;
  currentAgent?: SkillAccessTargetId;
  targets: SkillAccessTargetView[];
} {
  const env = options.env ?? process.env;
  const target = parseRequestedTarget(options.target);
  const requestedScope = parseRequestedScope(options.scope);
  if (options.dir && requestedScope === "global") {
    throw new WorkbenchCodedError("usage", "workbench skills/install --dir is only valid with folder scope.", {
      remediation: options.write
        ? `workbench install ${options.sourceForRemediation ?? "OWNER/SKILL"} --scope folder --dir ${commandArg(path.resolve(options.dir))}`
        : `workbench skills --scope folder --dir ${commandArg(path.resolve(options.dir))}`,
      subject: { scope: requestedScope, dir: path.resolve(options.dir) },
      exitCode: 2,
    });
  }
  const detected = detectCurrentSkillAccessTargets(env);
  const targetIds = target
    ? [target]
    : options.write
      ? detected.length === 1
        ? detected
        : failUndetectedInstallTarget(options.sourceForRemediation)
      : ["codex", "claude"] as SkillAccessTargetId[];
  const scopes = requestedScope ? [requestedScope] : options.write ? ["folder"] as SkillAccessScope[] : ["folder", "global"] as SkillAccessScope[];
  const resolvedDir = scopes.includes("folder") ? path.resolve(options.dir ?? process.cwd()) : undefined;
  return {
    scopes,
    ...(resolvedDir ? { dir: resolvedDir } : {}),
    ...(target ? { target } : {}),
    ...(detected.length === 1 ? { currentAgent: detected[0] } : {}),
    targets: targetIds.flatMap((targetId) => scopes.map((scope) => targetView(targetId, scope, resolvedDir, env))),
  };
}

export async function readInstalledSkillsInventory(options: {
  target?: string;
  scope?: string;
  dir?: string;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<WorkbenchSkillAccessInventory> {
  return readInventoryForRequest(resolveSkillAccessTargets({
    target: options.target,
    scope: options.scope,
    dir: options.dir,
    write: false,
    env: options.env,
  }));
}

export async function observeCurrentInstalledSkillsInventory(options: {
  scope?: string;
  dir?: string;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<WorkbenchSkillAccessInventory> {
  return readInventoryForRequest(observeCurrentSkillAccessTargets(options));
}

async function readInventoryForRequest(request: {
  scopes: SkillAccessScope[];
  dir?: string;
  target?: SkillAccessTargetId;
  currentAgent?: SkillAccessTargetId;
  targets: SkillAccessTargetView[];
}): Promise<WorkbenchSkillAccessInventory> {
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
    scopes: [...request.scopes],
    ...(request.dir ? { dir: request.dir } : {}),
    ...(request.target ? { target: request.target } : {}),
    ...(request.currentAgent ? { currentAgent: request.currentAgent } : {}),
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
  sourceForRemediation?: string;
  target?: string;
  scope?: string;
  dir?: string;
  installedAt?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<WorkbenchInstallTargetsResult> {
  const request = resolveSkillAccessTargets({
    target: options.target,
    scope: options.scope,
    dir: options.dir,
    write: true,
    env: options.env,
    sourceForRemediation: options.sourceForRemediation ?? options.provenance.handle,
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
  const target = request.targets[0]!.id;
  const overwriteRemediation = installOverwriteRemediation({
    handle: options.sourceForRemediation ?? options.provenance.handle,
    target,
    scope: request.scopes[0] ?? "folder",
    dir: request.scopes.includes("folder") && options.dir ? request.dir : undefined,
  });
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
      overwriteRemediation,
      installedAt: options.installedAt,
    }));
  }
  const filesCopied = results.reduce((sum, result) => sum + result.filesCopied, 0);
  const blocked = results.some((entry) => entry.result === "blocked");
  const result = options.dryRun
    ? blocked ? "blocked" : "planned"
    : results.every((entry) => entry.result === "unchanged")
      ? "unchanged"
      : "installed";
  const remediation = results.find((entry) => entry.remediation)?.remediation;
  return {
    result,
    ...(blocked ? { requiresOverwrite: true } : {}),
    ...(remediation ? { remediation } : {}),
    scope: request.scopes[0] ?? "folder",
    ...(request.dir ? { dir: request.dir } : {}),
    target,
    ...(request.currentAgent ? { currentAgent: request.currentAgent } : {}),
    skill: skillName,
    filesCopied,
    contentHash,
    targets: results,
  };
}

function installOverwriteRemediation(input: {
  handle: string;
  target?: SkillAccessTargetId;
  scope: SkillAccessScope;
  dir?: string;
}): string {
  return [
    "workbench",
    "install",
    commandArg(input.handle),
    ...(input.target ? ["--target", input.target] : []),
    ...(input.scope !== "folder" ? ["--scope", input.scope] : []),
    ...(input.dir ? ["--dir", commandArg(input.dir)] : []),
    "--yes",
  ].join(" ");
}

function commandArg(value: string): string {
  return /^[A-Za-z0-9_./:@+-]+$/u.test(value) ? value : quoteShellArg(value);
}

export function installedInventoryToJson(inventory: WorkbenchSkillAccessInventory): Record<string, Json> {
  return {
    scopes: inventory.scopes,
    ...(inventory.scopes.length === 1 ? { scope: inventory.scopes[0] } : {}),
    ...(inventory.dir ? { dir: inventory.dir } : {}),
    ...(inventory.target ? { target: inventory.target } : {}),
    ...(inventory.currentAgent ? { currentAgent: inventory.currentAgent } : {}),
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
      ...(skill.workbenchProject ? { workbenchProject: true } : {}),
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
    ...(result.requiresOverwrite ? { requiresOverwrite: true } : {}),
    ...(result.remediation ? { remediation: result.remediation } : {}),
    scope: result.scope,
    ...(result.dir ? { dir: result.dir } : {}),
    target: result.target,
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
      ...(target.requiresOverwrite ? { requiresOverwrite: true } : {}),
      ...(target.remediation ? { remediation: target.remediation } : {}),
      filesCopied: target.filesCopied,
      contentHash: target.contentHash,
      ledgerPath: target.ledgerPath,
    })),
    next: result.remediation ?? null,
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
  if (isValidDirectoryName(snapshot.name.trim())) {
    return installStoreSkillDirectoryName(snapshot.name);
  }
  const skillFile = snapshot.files.find((file) => normalizeInstallSnapshotPath(file.path) === "SKILL.md");
  if (skillFile && skillFile.encoding !== "base64") {
    const metadata = parseSkillMetadata(skillFile.content);
    if (metadata.name && isValidDirectoryName(metadata.name)) {
      return metadata.name;
    }
  }
  return installStoreSkillDirectoryName(snapshot.name);
}

function parseRequestedTarget(value: string | undefined): SkillAccessTargetId | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "codex" || value === "claude") {
    return value;
  }
  throw new WorkbenchCodedError("usage", "workbench skills/install --target expects codex or claude.", {
    remediation: "workbench skills --target codex",
    subject: { target: value },
    exitCode: 2,
  });
}

function parseRequestedScope(value: string | undefined): SkillAccessScope | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "folder" || value === "global") {
    return value;
  }
  throw new WorkbenchCodedError("usage", "workbench skills/install --scope expects folder or global.", {
    remediation: "workbench skills --scope global",
    subject: { scope: value },
    exitCode: 2,
  });
}

function failUndetectedInstallTarget(source: string | undefined): never {
  const remediationSource = source ?? "OWNER/SKILL";
  throw new WorkbenchCodedError("usage", "workbench install could not detect the current coding agent.", {
    remediation: `workbench install ${remediationSource} --target codex`,
    subject: { supportedTargets: ["codex", "claude"] },
    exitCode: 2,
  });
}

function observeCurrentSkillAccessTargets(options: {
  scope?: string;
  dir?: string;
  env?: NodeJS.ProcessEnv;
}): {
  scopes: SkillAccessScope[];
  dir?: string;
  currentAgent?: SkillAccessTargetId;
  targets: SkillAccessTargetView[];
} {
  const env = options.env ?? process.env;
  const detected = detectCurrentSkillAccessTargets(env);
  const scope: SkillAccessScope = parseRequestedScope(options.scope) ?? "folder";
  const resolvedDir = scope === "folder" ? path.resolve(options.dir ?? process.cwd()) : undefined;
  const currentAgent = detected.length === 1 ? detected[0] : undefined;
  return {
    scopes: [scope],
    ...(resolvedDir ? { dir: resolvedDir } : {}),
    ...(currentAgent ? { currentAgent } : {}),
    targets: currentAgent ? [targetView(currentAgent, scope, resolvedDir, env)] : [],
  };
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
    const workbenchProject = await isWorkbenchProjectSkillPath(skillPath);
    const status: WorkbenchSkillAccessStatus = record
      ? contentHash === record.contentHash ? "current" : "modified"
      : workbenchProject ? "project" : "unmanaged";
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
      ...(workbenchProject ? { workbenchProject: true } : {}),
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

async function isWorkbenchProjectSkillPath(skillPath: string): Promise<boolean> {
  const workbenchRoot = path.join(skillPath, ".workbench");
  const [evalYaml, agentsYaml] = await Promise.all([
    fs.access(path.join(workbenchRoot, "eval.yaml")).then(() => true, () => false),
    fs.access(path.join(workbenchRoot, "agents.yaml")).then(() => true, () => false),
  ]);
  return evalYaml && agentsYaml;
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
  overwriteRemediation: string;
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
    ? existingHash === args.contentHash ? "unchanged" : canUpdateExisting ? "updated" : record ? "modified" : "unmanaged"
    : "none";
  const requiresOverwrite = Boolean(existingHash && (previous === "modified" || previous === "unmanaged") && !args.overwrite);
  if (!args.dryRun && requiresOverwrite) {
    const status = record ? "modified" : "unmanaged";
    throw new WorkbenchCodedError("install_failed", `Skill destination has ${status} content: ${destination}`, {
      remediation: args.overwriteRemediation,
      subject: { destination, status, target: args.target.id },
      exitCode: 1,
    });
  }
  const nextLedgerRecord: WorkbenchInstallLedgerRecord = {
    ...args.provenance,
    targetId: args.target.id,
    skillName: args.skillName,
    installedAt: record?.installedAt ?? args.installedAt ?? new Date().toISOString(),
    contentHash: args.contentHash,
  };
  const ledgerChanged = !record || !installLedgerRecordEquals(record, nextLedgerRecord);
  if (!args.dryRun && previous !== "unchanged") {
    await fs.rm(destination, { recursive: true, force: true });
    await writeSnapshotFiles(destination, args.files);
  }
  if (!args.dryRun && (previous !== "unchanged" || ledgerChanged)) {
    await writeInstallLedgerRecord(root, args.skillName, nextLedgerRecord);
  }
  const filesCopied = !args.dryRun && previous !== "unchanged" ? args.files.length : 0;
  return {
    target: args.target.id,
    scope: args.target.scope,
    root,
    destination,
    previous,
    result: args.dryRun
      ? requiresOverwrite ? "blocked" : "planned"
      : previous === "unchanged" && !ledgerChanged ? "unchanged" : "installed",
    ...(requiresOverwrite ? { requiresOverwrite: true, remediation: args.overwriteRemediation } : {}),
    filesCopied,
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

function installLedgerRecordEquals(
  left: WorkbenchInstallLedgerRecord,
  right: WorkbenchInstallLedgerRecord,
): boolean {
  return left.handle === right.handle &&
    left.versionId === right.versionId &&
    left.baseUrl === right.baseUrl &&
    left.targetId === right.targetId &&
    left.skillName === right.skillName &&
    left.installedAt === right.installedAt &&
    left.contentHash === right.contentHash;
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
    const normalizedPath = relativePath.replace(/\\/gu, "/");
    if (!isInstallPackagePath(normalizedPath)) {
      continue;
    }
    const fullPath = path.join(root, relativePath);
    if (entry.isDirectory()) {
      await readExistingTreeInto(root, relativePath, result, executable);
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath);
      result.set(normalizedPath, await fs.readFile(fullPath));
      executable.set(normalizedPath, (stat.mode & 0o111) !== 0);
    }
  }
}

function homeDirectory(env: NodeJS.ProcessEnv): string {
  return env.HOME?.trim() || os.homedir();
}
