import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

import {
  BENCHMARK_SPEC_FILE,
  CANDIDATE_SPEC_FILE,
  buildWorkbenchProjectSourceFiles,
  engineResolveInvocationForSpec,
  normalizeSurfaceFiles,
  parseWorkbenchSourceFiles,
  resolveWorkbenchResolvedSourceYaml,
  serializeWorkbenchResolvedSourceYaml,
  validateWorkbenchResolvedSourceYaml,
  type Json,
  type SurfaceSnapshotFile,
} from "@workbench-ai/workbench-core";
import {
  assertWorkbenchAdapterOperationSupport,
  assertWorkbenchAdapterOperationResultOk,
  collectWorkbenchAdapterInvocations,
  readWorkbenchAdapterOperationResult,
  WORKBENCH_ADAPTER_RESULT_FILE,
  WORKBENCH_ADAPTER_RESULT_PROTOCOL,
  workbenchAdapterOperationCommand,
  workbenchAdapterOperationResultPath,
  type WorkbenchAdapterManifest,
  type WorkbenchEngineCase,
  type WorkbenchEngineResolveResult,
} from "@workbench-ai/workbench-protocol";

import {
  readSnapshotFiles,
  WorkspaceSnapshotError,
  type WorkspaceSnapshotFile,
} from "./workspace-snapshot.js";
import {
  defaultAdapterManifests,
  composeRuntimeDockerfileWithAdapters,
  resolveDefaultWorkbenchAdapter,
  resolveProjectAdapterSource,
  resolveWorkbenchAdaptersForProject,
  type ResolvedWorkbenchAdapter,
} from "./adapter-project.js";
import { createAdapterCommandEnv } from "./adapter-command-env.js";
import YAML from "yaml";

export const WORKBENCH_BENCHMARK_FILE = BENCHMARK_SPEC_FILE;
export const WORKBENCH_CANDIDATES_DIR = "candidates";
export const WORKBENCH_CANDIDATE_FILE = CANDIDATE_SPEC_FILE;

export type RemoteFile = WorkspaceSnapshotFile;

export interface LocalProjectSource {
  dir: string;
  specPath: string;
  specSource: string;
  spec: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>;
  benchmarkPath: string;
  benchmarkSource: string;
  candidateName: string;
  candidateDir: string;
  candidateFilesPath: string;
  candidateSpecPath: string;
  candidateSource: string;
  candidateRunId: string;
  candidateRunIds: string[];
  benchmarkAdapterSources: string[];
  benchmarkAdapterIds: string[];
  dockerfilePath: string;
  dockerfile: string;
  runtimeDockerfile: string;
  dockerfileFiles: RemoteFile[];
  candidateFiles: RemoteFile[];
  engineResolveFiles: RemoteFile[];
  adapters: ResolvedWorkbenchAdapter[];
  adapterFiles: RemoteFile[];
  caseIds: string[];
  engineCases: WorkbenchEngineCase[];
  engineResolve: LocalEngineResolveInvocation;
  engineResolveFingerprintPath: string;
  engineResolveEnvironment?: WorkbenchEngineResolveResult["environment"];
  sourceFiles: SurfaceSnapshotFile[];
}

export interface LocalAuthoredProjectSource {
  dir: string;
  specPath: string;
  specSource: string;
  benchmarkPath: string;
  benchmarkSource: string;
  candidateDir: string;
  candidateSpecPath: string;
  candidateSource: string;
  sourceFiles: SurfaceSnapshotFile[];
}

export interface LocalEngineResolveInvocation {
  use: string;
  with: Json;
  auth?: Json;
}

interface LocalProjectSourceOptions {
  runId?: string;
}

function rootAdapterInvocations(
  spec: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>,
): LocalEngineResolveInvocation[] {
  return [
    engineResolveInvocationForSpec(spec),
    spec.engineRun,
    spec.run,
    ...(spec.improve ? [spec.improve] : []),
  ];
}

export async function readLocalProjectSource(
  source: string,
  options: LocalProjectSourceOptions = {},
): Promise<LocalProjectSource> {
  const paths = await resolveLocalProjectSourcePaths(source, options);
  const {
    dir,
    benchmarkPath,
    candidateSpecPath,
    candidateDir,
  } = paths;
  const benchmarkSource = await readRequiredTextFile(benchmarkPath, WORKBENCH_BENCHMARK_FILE);
  const candidateSource = await readRequiredTextFile(candidateSpecPath, "candidate YAML");
  const normalizedSources = await normalizeSourceYamlForExecution({
    dir,
    benchmarkPath,
    benchmarkSource,
    candidateSpecPath,
    candidateSource,
  });
  const resolvedSource = parseWorkbenchSourceFiles({
    benchmarkSource: normalizedSources.benchmarkSource,
    candidateSource: normalizedSources.candidateSource,
    runId: options.runId,
  });
  const specSource = serializeWorkbenchResolvedSourceYaml(resolvedSource);
  const validation = validateWorkbenchResolvedSourceYaml(specSource);
  if (!validation.ok) {
    throw new WorkspaceSnapshotError(
      `Benchmark source is invalid:\n${validation.errors.map((entry: string) => `- ${entry}`).join("\n")}`,
    );
  }
  const spec = resolveWorkbenchResolvedSourceYaml(specSource);
  const dockerfilePath = spec.environment.dockerfile;
  const dockerfileSources = await readDockerfileSourcesForSpec(
    dir,
    spec,
    normalizedSources.engineCases,
  );
  const dockerfile = dockerfileSources.get(dockerfilePath);
  if (dockerfile === undefined) {
    throw new WorkspaceSnapshotError(`Dockerfile not found: ${resolveProjectPath(dir, dockerfilePath)}`);
  }
  const adapters = await resolveWorkbenchAdaptersForProject(dir, spec);
  const benchmarkAdapterIds = [
    ...new Set(collectWorkbenchAdapterInvocations(
      rootAdapterInvocations(spec),
      adapters.map((adapter) => adapter.manifest),
    ).map((invocation) => invocation.use)),
  ];
  const composedDockerfile = await composeRuntimeDockerfileWithAdapters(
    dockerfile,
    adapters,
  );
  const adapterFiles = adapterSourceFiles(adapters);
  const absoluteCandidateFilesPath = resolveProjectPath(dir, spec.candidate.files.path);
  const candidateFilesPath = absoluteCandidateFilesPath;
  const candidateFiles = await directoryExists(absoluteCandidateFilesPath)
    ? normalizeSurfaceFiles(await readSnapshotFiles(absoluteCandidateFilesPath))
    : [];
  const rawEngineResolveFiles = engineResolveFilesFromBundles(normalizedSources.engineCases);
  const engineResolveFiles = toRemoteFiles(rawEngineResolveFiles);
  const engineCases = normalizedSources.engineCases;
  if (engineCases.length === 0) {
    throw new WorkspaceSnapshotError(
      `Engine resolver ${normalizedSources.engineResolve.use} did not emit any cases.`,
    );
  }
  const caseIds = engineCases.map((bundle) => bundle.id);
  return {
    dir,
    specPath: benchmarkPath,
    specSource,
    spec,
    benchmarkPath,
    benchmarkSource,
    candidateName: path.basename(candidateDir),
    candidateDir,
    candidateFilesPath,
    candidateSpecPath,
    candidateSource,
    candidateRunId: spec.candidate.selectedRunId,
    candidateRunIds: Object.keys(spec.candidate.runs).sort(),
    benchmarkAdapterSources: [...resolvedSource.benchmark.adapters],
    benchmarkAdapterIds,
    dockerfilePath,
    dockerfile,
    runtimeDockerfile: composedDockerfile,
    dockerfileFiles: toRemoteFiles(dockerfileSourceFiles(dockerfileSources)),
    candidateFiles: toRemoteFiles(candidateFiles),
    engineResolveFiles,
    adapters,
    adapterFiles: toRemoteFiles(adapterFiles),
    caseIds,
    engineCases,
    engineResolve: normalizedSources.engineResolve,
    engineResolveFingerprintPath: normalizedSources.engineResolveFingerprintPath,
    ...(normalizedSources.engineResolveEnvironment
      ? { engineResolveEnvironment: normalizedSources.engineResolveEnvironment }
      : {}),
    sourceFiles: buildWorkbenchProjectSourceFiles({
      specFiles: [
        textSourceFile(toRootRelativePath(dir, benchmarkPath), benchmarkSource),
        textSourceFile(toRootRelativePath(dir, candidateSpecPath), candidateSource),
      ],
      candidateFilesPath: spec.candidate.files.path,
      candidateFiles: candidateFiles,
      engineResolveFilesPath: normalizedSources.engineResolveFingerprintPath,
      engineResolveFiles: rawEngineResolveFiles,
      adapterFiles,
      dockerfiles: dockerfileSourceFiles(dockerfileSources),
    }),
  };
}

export async function readLocalAuthoredProjectSource(
  source: string,
  options: LocalProjectSourceOptions = {},
): Promise<LocalAuthoredProjectSource> {
  const {
    dir,
    benchmarkPath,
    candidateSpecPath,
    candidateDir,
  } = await resolveLocalProjectSourcePaths(source, options);
  const benchmarkSource = await readRequiredTextFile(benchmarkPath, WORKBENCH_BENCHMARK_FILE);
  const candidateSource = await readRequiredTextFile(candidateSpecPath, "candidate YAML");
  const resolvedSource = parseWorkbenchSourceFiles({
    benchmarkSource,
    candidateSource,
    runId: options.runId,
  });
  const specSource = serializeWorkbenchResolvedSourceYaml(resolvedSource);
  return {
    dir,
    specPath: benchmarkPath,
    specSource,
    benchmarkPath,
    benchmarkSource,
    candidateDir,
    candidateSpecPath,
    candidateSource,
    sourceFiles: [
      textSourceFile(toRootRelativePath(dir, benchmarkPath), benchmarkSource),
      textSourceFile(toRootRelativePath(dir, candidateSpecPath), candidateSource),
    ],
  };
}

export function remoteEngineResolveFiles(source: LocalProjectSource): RemoteFile[] {
  return [
    ...source.engineResolveFiles,
    {
      path: WORKBENCH_ADAPTER_RESULT_FILE,
      content: `${JSON.stringify({
        protocol: WORKBENCH_ADAPTER_RESULT_PROTOCOL,
        operation: "engine.resolve",
        ok: true,
        value: {
          cases: source.engineCases,
          ...(source.engineResolveEnvironment
            ? { environment: source.engineResolveEnvironment }
            : {}),
        },
        feedback: {
          path: source.engineResolveFingerprintPath,
        },
      }, null, 2)}\n`,
    },
  ];
}

async function resolveLocalProjectSourcePaths(
  source: string,
  options: LocalProjectSourceOptions,
): Promise<{
  dir: string;
  benchmarkPath: string;
  candidateDir: string;
  candidateSpecPath: string;
}> {
  const resolved = path.resolve(source);
  const stat = await fs.stat(resolved).catch(() => null);
  if (stat?.isFile()) {
    const sourceRecord = await readYamlRecordFile(resolved);
    if (isCandidateSourceRecord(sourceRecord)) {
      const candidateDir = path.dirname(resolved);
      const dir = projectRootForCandidateDir(candidateDir);
      return {
        dir,
        benchmarkPath: path.join(dir, WORKBENCH_BENCHMARK_FILE),
        candidateDir,
        candidateSpecPath: resolved,
      };
    }
    if (isBenchmarkSourceRecord(sourceRecord)) {
      const dir = path.dirname(resolved);
      const candidatePaths = await resolveCandidatePaths(dir);
      return {
        dir,
        benchmarkPath: resolved,
        ...candidatePaths,
      };
    }
    throw new WorkspaceSnapshotError(`Unsupported Workbench YAML source: ${resolved}`);
  }
  const dir = resolved;
  const directoryCandidate = await candidatePathsForCandidateDirectory(dir);
  if (directoryCandidate) {
    return directoryCandidate;
  }
  const candidatePaths = await resolveCandidatePaths(dir);
  return {
    dir,
    benchmarkPath: path.join(dir, WORKBENCH_BENCHMARK_FILE),
    ...candidatePaths,
  };
}

async function resolveCandidatePaths(dir: string): Promise<{
  candidateDir: string;
  candidateSpecPath: string;
}> {
  const candidatesDir = path.join(dir, WORKBENCH_CANDIDATES_DIR);
  const candidates = await listCandidateManifestFiles(candidatesDir);
  if (candidates.length === 1) {
    const candidateSpecPath = candidates[0]!;
    const candidateDir = path.dirname(candidateSpecPath);
    return {
      candidateDir,
      candidateSpecPath,
    };
  }
  if (candidates.length > 1) {
    throw new WorkspaceSnapshotError(
        `Multiple candidate directories found under ${candidatesDir}; pass candidates/NAME or candidates/NAME/candidate.yaml explicitly.`,
    );
  }
  throw new WorkspaceSnapshotError(
    `No candidate directories found under ${candidatesDir}; create candidates/NAME/candidate.yaml with files.path.`,
  );
}

async function normalizeSourceYamlForExecution(args: {
  dir: string;
  benchmarkPath: string;
  benchmarkSource: string;
  candidateSpecPath: string;
  candidateSource: string;
}): Promise<{
  benchmarkSource: string;
  candidateSource: string;
  engineResolveFingerprintPath: string;
  engineResolve: LocalEngineResolveInvocation;
  engineResolveEnvironment?: WorkbenchEngineResolveResult["environment"];
  engineCases: WorkbenchEngineCase[];
}> {
  const benchmark = parseYamlRecord(args.benchmarkSource, args.benchmarkPath);
  const candidate = parseYamlRecord(args.candidateSource, args.candidateSpecPath);

  const benchmarkDir = path.dirname(args.benchmarkPath);
  const candidateDir = path.dirname(args.candidateSpecPath);
  normalizeAdapterSourcePaths(args.dir, benchmark, benchmarkDir);
  normalizeAdapterSourcePaths(args.dir, candidate, candidateDir);
  const engine = yamlRecord(benchmark.engine);
  if (!engine || typeof engine.use !== "string" || !engine.use.trim()) {
    throw new WorkspaceSnapshotError("benchmark.yaml engine must declare an adapter invocation with use.");
  }
  normalizeEngineForExecution(args.dir, benchmarkDir, candidateDir, benchmark, candidate);
  const authoredEngineResolve = engineResolveInvocationFromRecord(engine);
  const engineResolve = await resolveEngineResolveAdapter({
    root: args.dir,
    yamlDir: benchmarkDir,
    benchmark,
    value: authoredEngineResolve,
  });
  const engineResolveFingerprintPath = engineResolve.sourcePath
    ?? engineResolvePathForInvocation(args.dir, benchmarkDir, authoredEngineResolve);
  applyEngineResolveEnvironment(benchmark, engineResolve.environment);
  return {
    benchmarkSource: YAML.stringify(benchmark).trimEnd() + "\n",
    candidateSource: YAML.stringify(candidate).trimEnd() + "\n",
    engineResolveFingerprintPath,
    engineResolve: authoredEngineResolve,
    ...(engineResolve.environment ? { engineResolveEnvironment: engineResolve.environment } : {}),
    engineCases: engineResolve.engineCases,
  };
}

function normalizeEngineForExecution(
  root: string,
  benchmarkDir: string,
  candidateDir: string,
  benchmark: Record<string, unknown>,
  candidate: Record<string, unknown>,
): void {
  const candidateFiles = yamlRecord(candidate.files);
  if (candidateFiles && typeof candidateFiles.path === "string") {
    candidateFiles.path = toRootRelativePath(
      root,
      resolveYamlReference(candidateDir, candidateFiles.path),
    );
    candidate.files = candidateFiles;
  }
  const engine = yamlRecord(benchmark.engine);
  const engineConfig = yamlRecord(engine?.with) ?? {};
  const environment = yamlRecord(engineConfig.environment);
  if (environment && typeof environment.dockerfile === "string") {
    environment.dockerfile = toRootRelativePath(
      root,
      resolveYamlReference(benchmarkDir, environment.dockerfile),
    );
    engineConfig.environment = environment;
  }
  if (engine) {
    engine.with = engineConfig as Json;
    benchmark.engine = engine;
  }
}

function applyEngineResolveEnvironment(
  benchmark: Record<string, unknown>,
  environment: WorkbenchEngineResolveResult["environment"] | undefined,
): void {
  if (!environment) {
    return;
  }
  const engine = yamlRecord(benchmark.engine);
  const engineConfig = yamlRecord(engine?.with) ?? {};
  if (!yamlRecord(engineConfig.environment)) {
    engineConfig.environment = environment;
    if (engine) {
      engine.with = engineConfig as Json;
      benchmark.engine = engine;
    }
  }
}

function engineResolveInvocationFromRecord(
  record: Record<string, unknown>,
): LocalEngineResolveInvocation {
  return {
    use: record.use as string,
    with: cloneJson((record.with ?? {}) as Json),
    ...(record.auth !== undefined ? { auth: cloneJson(record.auth as Json) } : {}),
  };
}

function cloneJson<T extends Json>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function engineResolvePathForInvocation(
  root: string,
  yamlDir: string,
  declaration: LocalEngineResolveInvocation,
): string {
  void root;
  void yamlDir;
  return `engine-resolve/${safePathSegment(String(declaration.use))}`;
}

function normalizeAdapterSourcePaths(
  root: string,
  record: Record<string, unknown>,
  yamlDir: string,
): void {
  if (!Array.isArray(record.adapters)) {
    return;
  }
  record.adapters = record.adapters.map((entry) =>
    typeof entry === "string" && isPathAdapterSource(entry)
      ? toRootRelativePath(root, resolveYamlReference(yamlDir, entry))
      : entry
  );
}

async function resolveEngineResolveAdapter(args: {
  root: string;
  yamlDir: string;
  benchmark: Record<string, unknown>;
  value: unknown;
}): Promise<{
  engineCases: WorkbenchEngineCase[];
  sourcePath?: string;
  environment?: WorkbenchEngineResolveResult["environment"];
}> {
  const record = yamlRecord(args.value);
  if (!record || typeof record.use !== "string") {
    throw new WorkspaceSnapshotError("benchmark.yaml engine must be an adapter invocation.");
  }
  const adapter = await resolveEngineResolveAdapterReference({
    root: args.root,
    benchmark: args.benchmark,
    adapterId: record.use,
  });
  await assertEngineResolveAdapterOperations({
    root: args.root,
    benchmark: args.benchmark,
    invocation: engineResolveInvocationFromRecord(record),
  });
  const digest = createHash("sha256")
    .update(JSON.stringify({
      adapter: adapter.contentHash,
      invocation: record,
      yamlDir: path.resolve(args.yamlDir),
    }))
    .digest("hex")
    .slice(0, 16);
  const generatedRoot = path.join(
    args.root,
    ".workbench",
    "generated",
    "engine-resolves",
    safePathSegment(record.use),
    `${digest}-${randomUUID().replace(/-/gu, "").slice(0, 12)}`,
  );
  await fs.mkdir(generatedRoot, { recursive: true });
  const requestPath = path.join(generatedRoot, ".workbench", "request.json");
  await fs.mkdir(path.dirname(requestPath), { recursive: true });
  await fs.writeFile(
    requestPath,
    `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: `engine_resolve_${digest}`,
      operation: "engine.resolve",
      invocation: {
        use: record.use,
        with: record.with ?? {},
        ...(record.auth !== undefined ? { auth: record.auth } : {}),
      },
      paths: {
        workspace: args.root,
        output: generatedRoot,
        result: workbenchAdapterOperationResultPath(generatedRoot),
      },
    }, null, 2)}\n`,
  );
  await executeEngineResolveAdapter({
    adapter,
    requestPath,
    outputRoot: generatedRoot,
    workspaceRoot: args.root,
  });
  const result = await readEngineResolveResult(generatedRoot, record.use);
  const environment = normalizeEngineResolveEnvironment(args.root, result.value.environment);
  const sourcePath = engineResolveSourcePathFromFeedback(args.root, args.yamlDir, result.feedback);
  return {
    engineCases: normalizeEngineCaseEnvironments(args.root, result.value.cases),
    ...(sourcePath ? { sourcePath } : {}),
    ...(environment ? { environment } : {}),
  };
}

async function assertEngineResolveAdapterOperations(args: {
  root: string;
  benchmark: Record<string, unknown>;
  invocation: LocalEngineResolveInvocation;
}): Promise<void> {
  const manifests = await resolveBenchmarkAdapterManifests(args.root, args.benchmark);
  try {
    assertWorkbenchAdapterOperationSupport(
      [{ invocation: args.invocation, operation: "engine.resolve" }],
      manifests,
    );
  } catch (error) {
    throw new WorkspaceSnapshotError(error instanceof Error ? error.message : String(error));
  }
}

async function resolveBenchmarkAdapterManifests(
  root: string,
  benchmark: Record<string, unknown>,
): Promise<WorkbenchAdapterManifest[]> {
  const manifests = new Map<string, WorkbenchAdapterManifest>(
    defaultAdapterManifests().map((manifest) => [manifest.id, manifest]),
  );
  const sources = Array.isArray(benchmark.adapters)
    ? benchmark.adapters.filter((entry): entry is string => typeof entry === "string")
    : [];
  for (const source of sources) {
    const adapter = await resolveProjectAdapterSource(root, source);
    manifests.set(adapter.manifest.id, adapter.manifest);
  }
  return [...manifests.values()];
}

async function resolveEngineResolveAdapterReference(args: {
  root: string;
  benchmark: Record<string, unknown>;
  adapterId: string;
}): Promise<ResolvedWorkbenchAdapter> {
  const sources = Array.isArray(args.benchmark.adapters)
    ? args.benchmark.adapters.filter((entry): entry is string => typeof entry === "string")
    : [];
  for (const source of sources) {
    const adapter = await resolveProjectAdapterSource(args.root, source);
    if (adapter.manifest.id === args.adapterId) {
      return adapter;
    }
  }
  const defaultAdapter = resolveDefaultWorkbenchAdapter(args.adapterId);
  if (defaultAdapter) {
    return defaultAdapter;
  }
  throw new WorkspaceSnapshotError(
    `Workbench engine resolver adapter ${args.adapterId} is not installed. Add its source under benchmark.yaml adapters.`,
  );
}

async function executeEngineResolveAdapter(args: {
  adapter: ResolvedWorkbenchAdapter;
  requestPath: string;
  outputRoot: string;
  workspaceRoot: string;
}): Promise<void> {
  const cwd = args.adapter.root && await directoryExists(args.adapter.root)
    ? args.adapter.root
    : args.adapter.kind === "default"
      ? args.workspaceRoot
      : await materializeEngineResolveAdapterFiles(args.outputRoot, args.adapter);
  await runEngineResolveAdapterCommand({
    command: workbenchAdapterOperationCommand(args.adapter.manifest, "engine.resolve"),
    cwd,
    requestPath: args.requestPath,
    outputRoot: args.outputRoot,
    workspaceRoot: args.workspaceRoot,
  });
}

async function materializeEngineResolveAdapterFiles(
  outputRoot: string,
  adapter: ResolvedWorkbenchAdapter,
): Promise<string> {
  const adapterRoot = path.join(outputRoot, ".workbench", "adapter");
  await fs.rm(adapterRoot, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(adapterRoot, { recursive: true });
  for (const file of adapter.files ?? []) {
    const target = path.join(adapterRoot, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content);
    if (file.executable) {
      await fs.chmod(target, 0o755).catch(() => undefined);
    }
  }
  return adapterRoot;
}

async function runEngineResolveAdapterCommand(args: {
  command: string;
  cwd: string;
  requestPath: string;
  outputRoot: string;
  workspaceRoot: string;
}): Promise<void> {
  const adapterRoot = await fs.realpath(args.cwd).catch(() => args.cwd);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sh", ["-c", args.command], {
      cwd: args.cwd,
      env: createAdapterCommandEnv({
        workspaceRoot: args.workspaceRoot,
        adapterRoot,
        extraEnv: {
          WORKBENCH_ADAPTER_REQUEST: args.requestPath,
          WORKBENCH_OUTPUT: args.outputRoot,
          WORKBENCH_RESULT: workbenchAdapterOperationResultPath(args.outputRoot),
          WORKBENCH_WORKSPACE_ROOT: args.workspaceRoot,
          WORKBENCH_ADAPTER_ROOT: adapterRoot,
        },
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = [
        Buffer.concat(stderr).toString("utf8").trim(),
        Buffer.concat(stdout).toString("utf8").trim(),
      ].filter(Boolean).join("\n");
      reject(new WorkspaceSnapshotError(
        [
          signal
            ? `Workbench engine resolver adapter command exited from signal ${signal}.`
            : `Workbench engine resolver adapter command exited with status ${code ?? "unknown"}.`,
          detail,
        ].filter(Boolean).join("\n"),
      ));
    });
  });
}

async function readEngineResolveResult(
  outputRoot: string,
  adapterId: string,
): Promise<{ value: WorkbenchEngineResolveResult; feedback?: Json }> {
  return await readWorkbenchAdapterOperationResult(outputRoot, "engine.resolve").then((result) => {
    assertWorkbenchAdapterOperationResultOk(result, `Adapter ${adapterId} engine.resolve`);
    if (!result.value || typeof result.value !== "object" || Array.isArray(result.value)) {
      throw new WorkspaceSnapshotError(`Adapter ${adapterId} engine.resolve did not return engine cases.`);
    }
    return {
      value: result.value as WorkbenchEngineResolveResult,
      ...(result.feedback !== undefined ? { feedback: result.feedback as Json } : {}),
    };
  }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new WorkspaceSnapshotError(
        `Adapter ${adapterId} must write workbench-result.json for engine.resolve.`,
      );
    }
    throw new WorkspaceSnapshotError(error instanceof Error ? error.message : String(error));
  });
}

function engineResolveSourcePathFromFeedback(
  root: string,
  yamlDir: string,
  feedback: Json | undefined,
): string | undefined {
  const record = yamlRecord(feedback);
  if (!record || typeof record.path !== "string" || record.path.trim().length === 0) {
    return undefined;
  }
  const absolute = resolveYamlReference(yamlDir, record.path);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return normalizeSnapshotPath(relative);
}

function normalizeEngineResolveEnvironment(
  root: string,
  environment: WorkbenchEngineResolveResult["environment"] | undefined,
): WorkbenchEngineResolveResult["environment"] | undefined {
  if (!environment) {
    return undefined;
  }
  return {
    ...environment,
    ...(environment.dockerfile
      ? {
          dockerfile: toRootRelativePath(
            root,
            resolveProjectPath(root, environment.dockerfile),
          ),
        }
      : {}),
  };
}

function normalizeEngineCaseEnvironments(
  root: string,
  engineCases: readonly WorkbenchEngineCase[],
): WorkbenchEngineCase[] {
  return engineCases.map((engineCase) => {
    const environment = normalizeEngineResolveEnvironment(
      root,
      engineCase.case.environment,
    );
    return {
      ...engineCase,
      case: {
        ...engineCase.case,
        ...(environment ? { environment } : {}),
      },
    };
  });
}

function engineResolveFilesFromBundles(
  engineCases: readonly WorkbenchEngineCase[],
): SurfaceSnapshotFile[] {
  return normalizeSurfaceFiles(engineCases.flatMap((bundle) => {
    const buckets = bundle.files;
    const files = buckets.source?.length
      ? buckets.source
      : [...(buckets.public ?? []), ...(buckets.private ?? [])];
    return files.map((file) => ({
      ...file,
      path: normalizeSnapshotPath(`${bundle.id}/${file.path}`),
    }));
  }));
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "_").replace(/^_+|_+$/gu, "") || "adapter";
}

function isPathAdapterSource(source: string): boolean {
  return !/^(?:npm|git):/iu.test(source.trim());
}

function isBenchmarkSourceRecord(record: Record<string, unknown>): boolean {
  return record.engine !== undefined;
}

function isCandidateSourceRecord(record: Record<string, unknown>): boolean {
  return record.runs !== undefined;
}

async function readYamlRecordFile(filePath: string): Promise<Record<string, unknown>> {
  return parseYamlRecord(await readRequiredTextFile(filePath, path.basename(filePath)), filePath);
}

async function candidatePathsForCandidateDirectory(sourceDir: string): Promise<{
  dir: string;
  benchmarkPath: string;
  candidateDir: string;
  candidateSpecPath: string;
} | null> {
  const candidateSpecPath = path.join(sourceDir, WORKBENCH_CANDIDATE_FILE);
  if (!(await fileExists(candidateSpecPath))) {
    return null;
  }
  const dir = projectRootForCandidateDir(sourceDir);
  return {
    dir,
    benchmarkPath: path.join(dir, WORKBENCH_BENCHMARK_FILE),
    candidateDir: sourceDir,
    candidateSpecPath,
  };
}

function projectRootForCandidateDir(candidateDir: string): string {
  const parent = path.basename(path.dirname(candidateDir));
  if (parent !== WORKBENCH_CANDIDATES_DIR) {
    throw new WorkspaceSnapshotError(
      `Candidate directory must be under ${WORKBENCH_CANDIDATES_DIR}/NAME: ${candidateDir}`,
    );
  }
  return path.dirname(path.dirname(candidateDir));
}

function parseYamlRecord(source: string, label: string): Record<string, unknown> {
  const parsed = YAML.parse(source);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkspaceSnapshotError(`${label} must be a YAML object.`);
  }
  return parsed as Record<string, unknown>;
}

function yamlRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function resolveYamlReference(baseDir: string, value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(baseDir, value);
}

function toRootRelativePath(root: string, absolutePath: string): string {
  const relative = path.relative(root, absolutePath);
  if (!relative || relative === "") {
    return ".";
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return path.normalize(absolutePath);
  }
  return normalizeSnapshotPath(relative);
}

function normalizeSnapshotPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function fileExists(filePath: string): Promise<boolean> {
  return await fs.stat(filePath).then((stat) => stat.isFile(), () => false);
}

async function directoryExists(filePath: string): Promise<boolean> {
  return await fs.stat(filePath).then((stat) => stat.isDirectory(), () => false);
}

async function listCandidateManifestFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const manifestPath = path.join(dir, entry.name, WORKBENCH_CANDIDATE_FILE);
        return await fileExists(manifestPath) ? manifestPath : null;
      }),
  );
  return manifests
    .filter((entry): entry is string => Boolean(entry))
    .sort((left, right) => left.localeCompare(right));
}

async function readRequiredTextFile(filePath: string, label: string): Promise<string> {
  return await fs.readFile(filePath, "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new WorkspaceSnapshotError(`${label} not found: ${filePath}`);
    }
    throw error;
  });
}

async function readDockerfileSourcesForSpec(
  dir: string,
  spec: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>,
  engineCases: readonly WorkbenchEngineCase[] = [],
): Promise<Map<string, string>> {
  const dockerfilePaths = new Set<string>([spec.environment.dockerfile]);
  for (const engineCase of engineCases) {
    const dockerfile = engineCase.case.environment?.dockerfile;
    if (dockerfile) {
      dockerfilePaths.add(dockerfile);
    }
  }
  const sources = new Map<string, string>();
  for (const dockerfilePath of [...dockerfilePaths].sort()) {
    const absoluteDockerfilePath = resolveProjectPath(dir, dockerfilePath);
    const source = await fs.readFile(absoluteDockerfilePath, "utf8").catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new WorkspaceSnapshotError(`Dockerfile not found: ${absoluteDockerfilePath}`);
      }
      throw error;
    });
    sources.set(dockerfilePath, source);
  }
  return sources;
}

function resolveProjectPath(root: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
}

function dockerfileSourceFiles(sources: ReadonlyMap<string, string>): SurfaceSnapshotFile[] {
  return [...sources.entries()].map(([filePath, content]) =>
    textSourceFile(filePath, content)
  );
}

function textSourceFile(filePath: string, content: string): SurfaceSnapshotFile {
  return {
    path: filePath,
    kind: "text",
    encoding: "utf8",
    content,
    executable: false,
  };
}

function adapterSourceFiles(
  adapters: readonly ResolvedWorkbenchAdapter[],
): SurfaceSnapshotFile[] {
  return adapters.flatMap((adapter) =>
    adapter.kind === "default"
      ? []
      : (adapter.files ?? []).map((file) => ({
          path: adapterSourceSnapshotPath(adapter, file.path),
          kind: "text" as const,
          encoding: "utf8" as const,
          content: file.content,
          executable: file.executable,
        }))
  );
}

function adapterSourceSnapshotPath(
  adapter: ResolvedWorkbenchAdapter,
  filePath: string,
): string {
  return adapter.kind === "path"
    ? `${adapter.source}/${filePath}`
    : `adapters/${adapter.manifest.id}/${filePath}`;
}

function toRemoteFiles(files: readonly SurfaceSnapshotFile[]): RemoteFile[] {
  return files.map((file) => ({
    path: file.path,
    content: file.content,
    ...(file.encoding === "base64" ? { encoding: file.encoding } : {}),
    ...(file.executable ? { executable: true } : {}),
  }));
}
