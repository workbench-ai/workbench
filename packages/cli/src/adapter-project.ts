import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  builtinWorkbenchAdapterManifest,
  builtinWorkbenchAdapterManifests,
} from "@workbench-ai/workbench-built-in-adapters";
import {
  assertWorkbenchAdapterOperationSupport,
  collectWorkbenchAdapterOperationRequirements,
  parseWorkbenchAdapterManifest,
  type WorkbenchAdapterOperationRequirement,
  type WorkbenchAdapterManifest,
} from "@workbench-ai/workbench-protocol";
import {
  composeRuntimeDockerfileWithAdapterInstallers,
  engineResolveInvocationForSpec,
  type resolveWorkbenchResolvedSourceYaml,
} from "@workbench-ai/workbench-core";

export const WORKBENCH_ADAPTER_MANIFEST_FILE = "workbench.adapter.yaml";

const execFileAsync = promisify(execFile);

export interface ResolvedWorkbenchAdapter {
  source: string;
  declaredSource: string;
  kind: "default" | "path" | "npm" | "git";
  stability: "default" | "local" | "pinned" | "floating";
  overridesDefault?: boolean;
  manifest: WorkbenchAdapterManifest;
  root?: string;
  files?: WorkbenchAdapterSourceFile[];
  integrity?: string;
  contentHash: string;
  manifestHash: string;
}

export interface WorkbenchAdapterSourceFile {
  path: string;
  content: string;
  executable: boolean;
}

type GenericSpec = ReturnType<typeof resolveWorkbenchResolvedSourceYaml>;

export function defaultAdapterManifests(): WorkbenchAdapterManifest[] {
  return builtinWorkbenchAdapterManifests();
}

export function resolveDefaultWorkbenchAdapter(id: string): ResolvedWorkbenchAdapter | null {
  const manifest = builtinWorkbenchAdapterManifest(id);
  return manifest ? resolvedDefaultAdapter(manifest) : null;
}

export async function resolveWorkbenchAdaptersForProject(
  dir: string,
  spec: GenericSpec,
): Promise<ResolvedWorkbenchAdapter[]> {
  const adapters = new Map<string, ResolvedWorkbenchAdapter>();
  for (const id of topLevelAdapterIds(spec)) {
    const defaultAdapter = resolveDefaultWorkbenchAdapter(id);
    if (defaultAdapter) {
      adapters.set(id, defaultAdapter);
    }
  }
  for (const source of spec.adapters) {
    const adapter = await resolveProjectAdapterSource(dir, source);
    const existing = adapters.get(adapter.manifest.id);
    const override = adapterOverridesDefault(adapter);
    const resolvedAdapter = {
      ...adapter,
      ...(override ? { overridesDefault: true } : {}),
    };
    if (existing?.kind === "default") {
      adapters.set(adapter.manifest.id, resolvedAdapter);
      continue;
    }
    if (existing && existing.source !== adapter.source) {
      throw new Error(
        `Adapter id ${adapter.manifest.id} is provided by both ${existing.source} and ${adapter.source}. Remove one adapter source.`,
      );
    }
    adapters.set(adapter.manifest.id, resolvedAdapter);
  }
  let discovered = true;
  while (discovered) {
    discovered = false;
    const manifestById = new Map([...adapters.values()].map((adapter) => [adapter.manifest.id, adapter.manifest]));
    for (const id of requiredAdapterIds(spec, [...manifestById.values()])) {
      if (adapters.has(id)) {
        continue;
      }
      const defaultAdapter = resolveDefaultWorkbenchAdapter(id);
      if (defaultAdapter) {
        adapters.set(id, defaultAdapter);
        discovered = true;
        continue;
      }
      throw new Error(
        `Adapter ${id} is referenced by benchmark/candidate YAML but is not installed. List its source under adapters in the YAML file that uses it.`,
      );
    }
  }
  assertWorkbenchAdapterOperationSupport(
    rootAdapterOperationRequirements(spec),
    [...adapters.values()].map((adapter) => adapter.manifest),
  );
  return [...adapters.values()].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
}

export async function resolveProjectAdapterSource(
  dir: string,
  source: string,
): Promise<ResolvedWorkbenchAdapter> {
  if (source.startsWith("npm:")) {
    return await resolveNpmAdapterSource(source);
  }
  if (source.startsWith("git:")) {
    return await resolveGitAdapterSource(source);
  }
  const isPathSource = source.startsWith(".") || source.startsWith("/") || source.includes("/");
  if (!isPathSource) {
    throw new Error(`Adapter source ${source} is not installed locally. Use a benchmark-contained path source, npm: package, or git: URL.`);
  }
  const root = path.resolve(dir, source);
  const relative = path.relative(dir, root);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Adapter source ${source} is outside the benchmark source root. Copy it into the benchmark source tree and list that benchmark-contained path.`,
    );
  }
  return await resolveAdapterFromRoot({
    declaredSource: source,
    source: normalizeSourcePath(relative || "."),
    kind: "path",
    root,
  });
}

export async function composeRuntimeDockerfileWithAdapters(
  dockerfile: string,
  adapters: readonly ResolvedWorkbenchAdapter[],
): Promise<string> {
  return composeRuntimeDockerfileWithAdapterInstallers(
    dockerfile,
    adapters.map((adapter) => ({
      id: adapter.manifest.id,
      source: adapter.source,
      setup: adapter.manifest.setup,
      files: adapter.files,
    })),
  );
}

function resolvedDefaultAdapter(manifest: WorkbenchAdapterManifest): ResolvedWorkbenchAdapter {
  const manifestHash = sha256(JSON.stringify(manifest));
  return {
    source: `default:${manifest.id}`,
    declaredSource: `default:${manifest.id}`,
    kind: "default",
    stability: "default",
    manifest: {
      ...manifest,
      operations: JSON.parse(JSON.stringify(manifest.operations)) as WorkbenchAdapterManifest["operations"],
      setup: [...manifest.setup],
      ...(manifest.slots ? { slots: JSON.parse(JSON.stringify(manifest.slots)) as WorkbenchAdapterManifest["slots"] } : {}),
    },
    manifestHash,
    contentHash: manifestHash,
  };
}

function adapterOverridesDefault(adapter: ResolvedWorkbenchAdapter): boolean {
  return adapter.kind !== "default" && builtinWorkbenchAdapterManifest(adapter.manifest.id) !== null;
}

async function resolveNpmAdapterSource(source: string): Promise<ResolvedWorkbenchAdapter> {
  const specifier = source.slice("npm:".length).trim();
  if (!specifier) {
    throw new Error("npm adapter source must include a package specifier.");
  }
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-adapter-npm-"));
  try {
    const npmCache = path.join(tempRoot, "npm-cache");
    const npmLogs = path.join(tempRoot, "npm-logs");
    await fs.mkdir(npmCache, { recursive: true });
    await fs.mkdir(npmLogs, { recursive: true });
    const pack = await execFileUtf8("npm", [
      "pack",
      specifier,
      "--json",
      "--pack-destination",
      tempRoot,
    ], {
      env: {
        ...process.env,
        NPM_CONFIG_CACHE: npmCache,
        NPM_CONFIG_LOGS_DIR: npmLogs,
      },
    });
    const [entry] = JSON.parse(pack.stdout) as Array<{
      name?: string;
      version?: string;
      filename?: string;
      integrity?: string;
    }>;
    if (!entry?.name || !entry.version || !entry.filename) {
      throw new Error(`npm pack ${specifier} did not return package metadata.`);
    }
    const tarballPath = path.join(tempRoot, entry.filename);
    const extractRoot = path.join(tempRoot, "extract");
    await fs.mkdir(extractRoot, { recursive: true });
    await execFileUtf8("tar", ["-xzf", tarballPath, "-C", extractRoot]);
    return await resolveAdapterFromRoot({
      declaredSource: source,
      source: `npm:${entry.name}@${entry.version}`,
      kind: "npm",
      stability: npmSourceStability(specifier),
      root: path.join(extractRoot, "package"),
      integrity: entry.integrity,
      includeBuildArtifacts: true,
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function resolveGitAdapterSource(source: string): Promise<ResolvedWorkbenchAdapter> {
  const specifier = source.slice("git:".length).trim();
  if (!specifier) {
    throw new Error("git adapter source must include a repository URL.");
  }
  const { url, ref } = parseGitSource(specifier);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-adapter-git-"));
  const checkoutRoot = path.join(tempRoot, "checkout");
  try {
    await cloneGitAdapter(url, ref, checkoutRoot);
    const commit = (await execFileUtf8("git", ["-C", checkoutRoot, "rev-parse", "HEAD"])).stdout.trim();
    return await resolveAdapterFromRoot({
      declaredSource: source,
      source: `git:${url}#${commit}`,
      kind: "git",
      stability: gitSourceStability(ref),
      root: checkoutRoot,
      integrity: commit,
      includeBuildArtifacts: true,
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function resolveAdapterFromRoot(args: {
  declaredSource?: string;
  source: string;
  kind: ResolvedWorkbenchAdapter["kind"];
  stability?: ResolvedWorkbenchAdapter["stability"];
  root: string;
  integrity?: string;
  includeBuildArtifacts?: boolean;
}): Promise<ResolvedWorkbenchAdapter> {
  const manifestPath = path.join(args.root, WORKBENCH_ADAPTER_MANIFEST_FILE);
  const manifestSource = await fs.readFile(manifestPath, "utf8");
  const manifest = parseWorkbenchAdapterManifest(manifestSource, manifestPath);
  const files = await readAdapterSourceFiles(args.root, {
    includeBuildArtifacts: args.includeBuildArtifacts === true,
  });
  const manifestHash = sha256(manifestSource);
  const contentHash = sha256(JSON.stringify(files.map((file) => ({
    path: file.path,
    executable: file.executable,
    contentHash: sha256(file.content),
  }))));
  return {
    source: args.source,
    declaredSource: args.declaredSource ?? args.source,
    kind: args.kind,
    stability: args.stability ?? "local",
    manifest,
    root: args.root,
    files,
    ...(args.integrity ? { integrity: args.integrity } : {}),
    manifestHash,
    contentHash,
  };
}

async function cloneGitAdapter(
  url: string,
  ref: string | null,
  checkoutRoot: string,
): Promise<void> {
  if (ref) {
    try {
      await execFileUtf8("git", ["clone", "--depth", "1", "--branch", ref, url, checkoutRoot]);
      return;
    } catch {
      await fs.rm(checkoutRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  await execFileUtf8("git", ["clone", "--depth", "1", url, checkoutRoot]);
  if (ref) {
    await execFileUtf8("git", ["-C", checkoutRoot, "fetch", "--depth", "1", "origin", ref]);
    await execFileUtf8("git", ["-C", checkoutRoot, "checkout", "FETCH_HEAD"]);
  }
}

function parseGitSource(specifier: string): { url: string; ref: string | null } {
  const hashIndex = specifier.lastIndexOf("#");
  if (hashIndex < 0) {
    return { url: specifier, ref: null };
  }
  const url = specifier.slice(0, hashIndex);
  const ref = specifier.slice(hashIndex + 1);
  if (!url || !ref) {
    throw new Error(`Invalid git adapter source: git:${specifier}`);
  }
  return { url, ref };
}

function npmSourceStability(specifier: string): ResolvedWorkbenchAdapter["stability"] {
  return npmSpecifierHasExactVersion(specifier) ? "pinned" : "floating";
}

function npmSpecifierHasExactVersion(specifier: string): boolean {
  const atIndex = specifier.lastIndexOf("@");
  if (atIndex <= 0) {
    return false;
  }
  const version = specifier.slice(atIndex + 1);
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version);
}

function gitSourceStability(ref: string | null): ResolvedWorkbenchAdapter["stability"] {
  return ref && /^[0-9a-f]{7,40}$/iu.test(ref) ? "pinned" : "floating";
}

function topLevelAdapterIds(spec: GenericSpec): string[] {
  return [...new Set(rootAdapterInvocations(spec).map((invocation) => invocation.use))];
}

function rootAdapterOperationRequirements(spec: GenericSpec): WorkbenchAdapterOperationRequirement[] {
  return [
    { invocation: engineResolveInvocationForSpec(spec), operation: "engine.resolve" as const },
    { invocation: spec.engineRun, operation: "engine.run" as const },
    ...(spec.improve ? [{ invocation: spec.improve, operation: "candidate.improve" as const }] : []),
    { invocation: spec.run, operation: "candidate.run" as const },
  ];
}

function rootAdapterInvocations(spec: GenericSpec): WorkbenchAdapterOperationRequirement["invocation"][] {
  return rootAdapterOperationRequirements(spec).map((requirement) => requirement.invocation);
}

function requiredAdapterIds(
  spec: GenericSpec,
  manifests: readonly WorkbenchAdapterManifest[],
): string[] {
  const ids = new Set<string>();
  for (const requirement of collectWorkbenchAdapterOperationRequirements(
    rootAdapterOperationRequirements(spec),
    manifests,
  )) {
    ids.add(requirement.invocation.use);
  }
  return [...ids];
}

async function readAdapterSourceFiles(
  root: string,
  options: { includeBuildArtifacts?: boolean } = {},
): Promise<WorkbenchAdapterSourceFile[]> {
  const files: WorkbenchAdapterSourceFile[] = [];
  async function visit(relativeDir: string): Promise<void> {
    const absoluteDir = path.join(root, relativeDir);
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        (!options.includeBuildArtifacts && entry.name === "dist")
      ) {
        continue;
      }
      const relativePath = normalizeSourcePath(path.join(relativeDir, entry.name));
      const absolutePath = path.join(root, relativePath);
      if (entry.isDirectory()) {
        await visit(relativePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const content = await fs.readFile(absolutePath, "utf8");
      const stat = await fs.stat(absolutePath);
      files.push({
        path: relativePath,
        content,
        executable: Boolean(stat.mode & 0o111),
      });
    }
  }
  await visit("");
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeSourcePath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\.?\//u, "");
}

async function execFileUtf8(
  command: string,
  args: readonly string[],
  options: {
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(command, [...args], {
      encoding: "utf8",
      ...(options.env ? { env: options.env } : {}),
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    const record = error as {
      stdout?: unknown;
      stderr?: unknown;
      message?: string;
    };
    const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
    const stdout = typeof record.stdout === "string" ? record.stdout.trim() : "";
    throw new Error(
      [
        `${command} ${args.join(" ")} failed.`,
        stderr,
        stdout,
        record.message,
      ].filter(Boolean).join("\n"),
    );
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
