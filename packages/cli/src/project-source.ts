import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

import {
  BENCHMARK_SPEC_FILE,
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
export const WORKBENCH_SUBJECTS_DIR = "subjects";
export const WORKBENCH_OPTIMIZERS_DIR = "optimizers";
export const WORKBENCH_SUBJECT_FILE = "subject.yaml";

export type HostedFile = WorkspaceSnapshotFile;

export interface LocalProjectSource {
  dir: string;
  specPath: string;
  specSource: string;
  spec: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>;
  benchmarkPath: string;
  benchmarkSource: string;
  subjectName: string;
  subjectDir: string;
  subjectFilesPath: string;
  subjectSpecPath: string;
  subjectSource: string;
  optimizerPath?: string;
  optimizerSource?: string;
  benchmarkAdapterSources: string[];
  benchmarkAdapterIds: string[];
  dockerfilePath: string;
  dockerfile: string;
  runtimeDockerfile: string;
  dockerfileFiles: HostedFile[];
  subjectFiles: HostedFile[];
  engineResolveFiles: HostedFile[];
  adapters: ResolvedWorkbenchAdapter[];
  adapterFiles: HostedFile[];
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
  subjectDir: string;
  subjectSpecPath: string;
  subjectSource: string;
  optimizerPath?: string;
  optimizerSource?: string;
  sourceFiles: SurfaceSnapshotFile[];
}

export interface LocalEngineResolveInvocation {
  use: string;
  with: Json;
  auth?: Json;
}

interface LocalProjectSourceOptions {
  optimizerPath?: string;
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
    subjectSpecPath,
    subjectDir,
    optimizerPath,
  } = paths;
  const benchmarkSource = await readRequiredTextFile(benchmarkPath, WORKBENCH_BENCHMARK_FILE);
  const subjectSource = await readRequiredTextFile(subjectSpecPath, "subject YAML");
  const optimizerSource = optimizerPath
    ? await readRequiredTextFile(optimizerPath, "optimizer YAML")
    : undefined;
  const normalizedSources = await normalizeSourceYamlForExecution({
    dir,
    benchmarkPath,
    benchmarkSource,
    subjectSpecPath,
    subjectSource,
    optimizerPath,
    optimizerSource,
  });
  const resolvedSource = parseWorkbenchSourceFiles({
    benchmarkSource: normalizedSources.benchmarkSource,
    subjectSource: normalizedSources.subjectSource,
    optimizerSource: normalizedSources.optimizerSource,
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
  const absoluteSubjectFilesPath = resolveProjectPath(dir, spec.subject.files.path);
  const subjectFilesPath = absoluteSubjectFilesPath;
  const subjectFiles = await directoryExists(absoluteSubjectFilesPath)
    ? normalizeSurfaceFiles(await readSnapshotFiles(absoluteSubjectFilesPath))
    : [];
  const rawEngineResolveFiles = engineResolveFilesFromBundles(normalizedSources.engineCases);
  const engineResolveFiles = toHostedFiles(rawEngineResolveFiles);
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
    subjectName: path.basename(subjectDir),
    subjectDir,
    subjectFilesPath,
    subjectSpecPath,
    subjectSource,
    ...(optimizerSource !== undefined && optimizerPath ? { optimizerPath, optimizerSource } : {}),
    benchmarkAdapterSources: [...resolvedSource.benchmark.adapters],
    benchmarkAdapterIds,
    dockerfilePath,
    dockerfile,
    runtimeDockerfile: composedDockerfile,
    dockerfileFiles: toHostedFiles(dockerfileSourceFiles(dockerfileSources)),
    subjectFiles: toHostedFiles(subjectFiles),
    engineResolveFiles,
    adapters,
    adapterFiles: toHostedFiles(adapterFiles),
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
        textSourceFile(toRootRelativePath(dir, subjectSpecPath), subjectSource),
        ...(optimizerSource !== undefined && optimizerPath
          ? [textSourceFile(toRootRelativePath(dir, optimizerPath), optimizerSource)]
          : []),
      ],
      subjectFilesPath: spec.subject.files.path,
      subjectFiles,
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
    subjectSpecPath,
    subjectDir,
    optimizerPath,
  } = await resolveLocalProjectSourcePaths(source, options);
  const benchmarkSource = await readRequiredTextFile(benchmarkPath, WORKBENCH_BENCHMARK_FILE);
  const subjectSource = await readRequiredTextFile(subjectSpecPath, "subject YAML");
  const optimizerSource = optimizerPath
    ? await readRequiredTextFile(optimizerPath, "optimizer YAML")
    : undefined;
  const resolvedSource = parseWorkbenchSourceFiles({
    benchmarkSource,
    subjectSource,
    optimizerSource,
  });
  const specSource = serializeWorkbenchResolvedSourceYaml(resolvedSource);
  return {
    dir,
    specPath: benchmarkPath,
    specSource,
    benchmarkPath,
    benchmarkSource,
    subjectDir,
    subjectSpecPath,
    subjectSource,
    ...(optimizerPath && optimizerSource !== undefined ? { optimizerPath, optimizerSource } : {}),
    sourceFiles: [
      textSourceFile(toRootRelativePath(dir, benchmarkPath), benchmarkSource),
      textSourceFile(toRootRelativePath(dir, subjectSpecPath), subjectSource),
      ...(optimizerPath && optimizerSource !== undefined
        ? [textSourceFile(toRootRelativePath(dir, optimizerPath), optimizerSource)]
        : []),
    ],
  };
}

async function resolveLocalProjectSourcePaths(
  source: string,
  options: LocalProjectSourceOptions,
): Promise<{
  dir: string;
  benchmarkPath: string;
  subjectDir: string;
  subjectSpecPath: string;
  optimizerPath?: string;
}> {
  const resolved = path.resolve(source);
  const stat = await fs.stat(resolved).catch(() => null);
  if (stat?.isFile()) {
    const sourceRecord = await readYamlRecordFile(resolved);
    if (isSubjectSourceRecord(sourceRecord)) {
      const subjectDir = path.dirname(resolved);
      const dir = projectRootForSubjectDir(subjectDir);
      return {
        dir,
        benchmarkPath: path.join(dir, WORKBENCH_BENCHMARK_FILE),
        subjectDir,
        subjectSpecPath: resolved,
        optimizerPath: await resolveOptimizerPath(dir, options.optimizerPath, path.basename(subjectDir)),
      };
    }
    if (isBenchmarkSourceRecord(sourceRecord)) {
      const dir = path.dirname(resolved);
      const subjectPaths = await resolveSubjectPaths(dir);
      return {
        dir,
        benchmarkPath: resolved,
        ...subjectPaths,
        optimizerPath: await resolveOptimizerPath(
          dir,
          options.optimizerPath,
          path.basename(subjectPaths.subjectDir),
        ),
      };
    }
    if (isOptimizerSourceRecord(sourceRecord)) {
      throw new WorkspaceSnapshotError(
        `Optimizer source must be passed with --optimizer; pass a source directory or subject YAML as SOURCE: ${resolved}`,
      );
    }
    throw new WorkspaceSnapshotError(`Unsupported Workbench YAML source: ${resolved}`);
  }
  const dir = resolved;
  const directorySubject = await subjectPathsForSubjectDirectory(dir);
  if (directorySubject) {
    return {
      ...directorySubject,
      optimizerPath: await resolveOptimizerPath(
        directorySubject.dir,
        options.optimizerPath,
        path.basename(directorySubject.subjectDir),
      ),
    };
  }
  const subjectPaths = await resolveSubjectPathsWithOptimizer(
    dir,
    options.optimizerPath,
  );
  return {
    dir,
    benchmarkPath: path.join(dir, WORKBENCH_BENCHMARK_FILE),
    ...subjectPaths,
  };
}

async function resolveSubjectPathsWithOptimizer(
  dir: string,
  explicitOptimizerPath: string | undefined,
): Promise<{
  subjectDir: string;
  subjectSpecPath: string;
  optimizerPath?: string;
}> {
  const subjectPaths = await resolveSubjectPaths(dir);
  return {
    ...subjectPaths,
    optimizerPath: await resolveOptimizerPath(
      dir,
      explicitOptimizerPath,
      path.basename(subjectPaths.subjectDir),
    ),
  };
}

async function resolveSubjectPaths(dir: string): Promise<{
  subjectDir: string;
  subjectSpecPath: string;
}> {
  const subjectsDir = path.join(dir, WORKBENCH_SUBJECTS_DIR);
  const subjects = await listSubjectManifestFiles(subjectsDir);
  if (subjects.length === 1) {
    const subjectSpecPath = subjects[0]!;
    const subjectDir = path.dirname(subjectSpecPath);
    return {
      subjectDir,
      subjectSpecPath,
    };
  }
  if (subjects.length > 1) {
    throw new WorkspaceSnapshotError(
        `Multiple subject directories found under ${subjectsDir}; pass subjects/NAME or subjects/NAME/subject.yaml explicitly.`,
    );
  }
  throw new WorkspaceSnapshotError(
    `No subject directories found under ${subjectsDir}; create subjects/NAME/subject.yaml with files.path.`,
  );
}

async function resolveOptimizerPath(
  dir: string,
  explicit: string | undefined,
  subjectName?: string,
): Promise<string | undefined> {
  if (explicit) {
    return path.resolve(dir, explicit);
  }
  if (subjectName) {
    const named = path.join(dir, WORKBENCH_OPTIMIZERS_DIR, `${subjectName}.yaml`);
    if (await fileExists(named)) {
      return named;
    }
  }
  const optimizersDir = path.join(dir, WORKBENCH_OPTIMIZERS_DIR);
  const optimizers = await listYamlFiles(optimizersDir);
  if (optimizers.length === 1) {
    return optimizers[0]!;
  }
  return undefined;
}

async function normalizeSourceYamlForExecution(args: {
  dir: string;
  benchmarkPath: string;
  benchmarkSource: string;
  subjectSpecPath: string;
  subjectSource: string;
  optimizerPath?: string;
  optimizerSource?: string;
}): Promise<{
  benchmarkSource: string;
  subjectSource: string;
  optimizerSource?: string;
  engineResolveFingerprintPath: string;
  engineResolve: LocalEngineResolveInvocation;
  engineResolveEnvironment?: WorkbenchEngineResolveResult["environment"];
  engineCases: WorkbenchEngineCase[];
}> {
  const benchmark = parseYamlRecord(args.benchmarkSource, args.benchmarkPath);
  const subject = parseYamlRecord(args.subjectSource, args.subjectSpecPath);
  const optimizer = args.optimizerSource === undefined || args.optimizerPath === undefined
    ? undefined
    : parseYamlRecord(args.optimizerSource, args.optimizerPath);

  const benchmarkDir = path.dirname(args.benchmarkPath);
  const subjectDir = path.dirname(args.subjectSpecPath);
  normalizeAdapterSourcePaths(args.dir, benchmark, benchmarkDir);
  normalizeAdapterSourcePaths(args.dir, subject, subjectDir);
  if (optimizer && args.optimizerPath) {
    normalizeAdapterSourcePaths(args.dir, optimizer, path.dirname(args.optimizerPath));
  }
  const engine = yamlRecord(benchmark.engine);
  if (!engine || typeof engine.use !== "string" || !engine.use.trim()) {
    throw new WorkspaceSnapshotError("benchmark.yaml engine must declare an adapter invocation with use.");
  }
  normalizeEngineForExecution(args.dir, benchmarkDir, subjectDir, benchmark, subject);
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
    subjectSource: YAML.stringify(subject).trimEnd() + "\n",
    engineResolveFingerprintPath,
    engineResolve: authoredEngineResolve,
    ...(engineResolve.environment ? { engineResolveEnvironment: engineResolve.environment } : {}),
    engineCases: engineResolve.engineCases,
    ...(optimizer
      ? { optimizerSource: YAML.stringify(optimizer).trimEnd() + "\n" }
      : {}),
  };
}

function normalizeEngineForExecution(
  root: string,
  benchmarkDir: string,
  subjectDir: string,
  benchmark: Record<string, unknown>,
  subject: Record<string, unknown>,
): void {
  const subjectFiles = yamlRecord(subject.files);
  if (subjectFiles && typeof subjectFiles.path === "string") {
    subjectFiles.path = toRootRelativePath(
      root,
      resolveYamlReference(subjectDir, subjectFiles.path),
    );
    subject.files = subjectFiles;
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

function isSubjectSourceRecord(record: Record<string, unknown>): boolean {
  return record.run !== undefined;
}

function isOptimizerSourceRecord(record: Record<string, unknown>): boolean {
  return record.edits !== undefined && record.improve !== undefined;
}

async function readYamlRecordFile(filePath: string): Promise<Record<string, unknown>> {
  return parseYamlRecord(await readRequiredTextFile(filePath, path.basename(filePath)), filePath);
}

async function subjectPathsForSubjectDirectory(sourceDir: string): Promise<{
  dir: string;
  benchmarkPath: string;
  subjectDir: string;
  subjectSpecPath: string;
} | null> {
  const subjectSpecPath = path.join(sourceDir, WORKBENCH_SUBJECT_FILE);
  if (!(await fileExists(subjectSpecPath))) {
    return null;
  }
  const dir = projectRootForSubjectDir(sourceDir);
  return {
    dir,
    benchmarkPath: path.join(dir, WORKBENCH_BENCHMARK_FILE),
    subjectDir: sourceDir,
    subjectSpecPath,
  };
}

function projectRootForSubjectDir(subjectDir: string): string {
  const parent = path.basename(path.dirname(subjectDir));
  if (parent !== WORKBENCH_SUBJECTS_DIR) {
    throw new WorkspaceSnapshotError(
      `Subject directory must be under ${WORKBENCH_SUBJECTS_DIR}/NAME: ${subjectDir}`,
    );
  }
  return path.dirname(path.dirname(subjectDir));
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

async function listSubjectManifestFiles(dir: string): Promise<string[]> {
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
        const manifestPath = path.join(dir, entry.name, WORKBENCH_SUBJECT_FILE);
        return await fileExists(manifestPath) ? manifestPath : null;
      }),
  );
  return manifests
    .filter((entry): entry is string => Boolean(entry))
    .sort((left, right) => left.localeCompare(right));
}

async function listYamlFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  });
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/iu.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
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

function toHostedFiles(files: readonly SurfaceSnapshotFile[]): HostedFile[] {
  return files.map((file) => ({
    path: file.path,
    content: file.content,
    ...(file.encoding === "base64" ? { encoding: file.encoding } : {}),
    ...(file.executable ? { executable: true } : {}),
  }));
}
