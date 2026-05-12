import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { executeWorkbenchBuiltInAdapterCommand } from "@workbench-ai/workbench-built-in-adapters";

import {
  BENCHMARK_SPEC_FILE,
  buildWorkbenchProjectSourceFiles,
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
  type WorkbenchTaskBundle,
  type WorkbenchTaskSourceResult,
} from "@workbench-ai/workbench-protocol";

import {
  readSnapshotFiles,
  WorkspaceSnapshotError,
  type WorkspaceSnapshotFile,
} from "./workspace-snapshot.js";
import {
  builtinAdapterManifests,
  composeRuntimeDockerfileWithAdapters,
  resolveBuiltinWorkbenchAdapter,
  resolveProjectAdapterSource,
  resolveWorkbenchAdaptersForProject,
  type ResolvedWorkbenchAdapter,
} from "./adapter-project.js";
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
  taskSourceFiles: HostedFile[];
  adapters: ResolvedWorkbenchAdapter[];
  adapterFiles: HostedFile[];
  taskIds: string[];
  taskBundles: WorkbenchTaskBundle[];
  taskSource: LocalTaskSourceInvocation;
  taskFingerprintPath: string;
  sourceFiles: SurfaceSnapshotFile[];
}

export interface LocalTaskSourceInvocation {
  use: string;
  with: Json;
  auth?: Json;
}

interface LocalProjectSourceOptions {
  optimizerPath?: string;
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
  const dockerfileSources = await readDockerfileSources(dir, [
    spec.environment.dockerfile,
  ]);
  const dockerfilePath = spec.environment.dockerfile;
  const dockerfile = dockerfileSources.get(dockerfilePath);
  if (dockerfile === undefined) {
    throw new WorkspaceSnapshotError(`Dockerfile not found: ${resolveProjectPath(dir, dockerfilePath)}`);
  }
  const adapters = await resolveWorkbenchAdaptersForProject(dir, spec);
  const benchmarkAdapterIds = [
    ...new Set(collectWorkbenchAdapterInvocations(
      [spec.score],
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
  const rawTaskSourceFiles = taskSourceFilesFromBundles(normalizedSources.taskBundles);
  const taskSourceFiles = toHostedFiles(rawTaskSourceFiles);
  const taskBundles = normalizedSources.taskBundles;
  if (taskBundles.length === 0) {
    throw new WorkspaceSnapshotError(
      `Task-source adapter ${normalizedSources.taskSource.use} did not emit any task bundles.`,
    );
  }
  const taskIds = taskBundles.map((bundle) => bundle.id);
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
    taskSourceFiles,
    adapters,
    adapterFiles: toHostedFiles(adapterFiles),
    taskIds,
    taskBundles,
    taskSource: normalizedSources.taskSource,
    taskFingerprintPath: normalizedSources.taskFingerprintPath,
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
      tasksPath: normalizedSources.taskFingerprintPath,
      taskFiles: rawTaskSourceFiles,
      adapterFiles,
      dockerfiles: dockerfileSourceFiles(dockerfileSources),
    }),
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
  taskFingerprintPath: string;
  taskSource: LocalTaskSourceInvocation;
  taskBundles: WorkbenchTaskBundle[];
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
  const authoredTaskSource = normalizeTaskSourceDeclaration(benchmark.tasks);
  const taskSource = await resolveTaskSourceAdapter({
    root: args.dir,
    yamlDir: benchmarkDir,
    benchmark,
    value: authoredTaskSource,
  });
  const taskFingerprintPath = taskSourceFingerprintPath(args.dir, benchmarkDir, authoredTaskSource);
  benchmark.tasks = { path: taskFingerprintPath };
  if (!yamlRecord(benchmark.environment) && taskSource.environment) {
    benchmark.environment = taskSource.environment;
  }
  const subjectFiles = yamlRecord(subject.files);
  if (subjectFiles && typeof subjectFiles.path === "string") {
    subjectFiles.path = toRootRelativePath(
      args.dir,
      resolveYamlReference(subjectDir, subjectFiles.path),
    );
    subject.files = subjectFiles;
  }
  const environment = yamlRecord(benchmark.environment);
  if (environment && typeof environment.dockerfile === "string") {
    environment.dockerfile = toRootRelativePath(
      args.dir,
      resolveYamlReference(benchmarkDir, environment.dockerfile),
    );
  }
  return {
    benchmarkSource: YAML.stringify(benchmark).trimEnd() + "\n",
    subjectSource: YAML.stringify(subject).trimEnd() + "\n",
    taskFingerprintPath,
    taskSource: authoredTaskSource,
    taskBundles: taskSource.taskBundles,
    ...(optimizer
      ? { optimizerSource: YAML.stringify(optimizer).trimEnd() + "\n" }
      : {}),
  };
}

function normalizeTaskSourceDeclaration(value: unknown): LocalTaskSourceInvocation {
  if (value === undefined || value === null) {
    return defaultPathTaskSourceDeclaration();
  }
  const record = yamlRecord(value);
  if (!record || typeof record.use !== "string" || record.use.length === 0) {
    throw new WorkspaceSnapshotError(
      "benchmark.yaml.tasks must be omitted for the default tasks/ directory or declare an adapter invocation with use.",
    );
  }
  const config = record.with === undefined ? {} : yamlRecord(record.with);
  if (record.with !== undefined && !config) {
    throw new WorkspaceSnapshotError("benchmark.yaml.tasks.with must be a YAML object.");
  }
  const configRecord = config ?? {};
  if (record.use === "path") {
    if (configRecord.path === undefined) {
      return taskSourceInvocationFromRecord({
        ...record,
        with: {
          ...configRecord,
          path: "tasks",
        },
      });
    }
  }
  return taskSourceInvocationFromRecord({
    ...record,
    with: configRecord,
  });
}

function defaultPathTaskSourceDeclaration(): LocalTaskSourceInvocation {
  return {
    use: "path",
    with: {
      path: "tasks",
    },
  };
}

function taskSourceInvocationFromRecord(
  record: Record<string, unknown>,
): LocalTaskSourceInvocation {
  return {
    use: record.use as string,
    with: cloneJson((record.with ?? {}) as Json),
    ...(record.auth !== undefined ? { auth: cloneJson(record.auth as Json) } : {}),
  };
}

function cloneJson<T extends Json>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function taskSourceFingerprintPath(
  root: string,
  yamlDir: string,
  declaration: LocalTaskSourceInvocation,
): string {
  if (declaration.use === "path") {
    const config = yamlRecord(declaration.with);
    const configuredPath = typeof config?.path === "string" && config.path.length > 0
      ? config.path
      : "tasks";
    return toRootRelativePath(root, resolveYamlReference(yamlDir, configuredPath));
  }
  return `task-source/${safePathSegment(String(declaration.use))}`;
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

async function resolveTaskSourceAdapter(args: {
  root: string;
  yamlDir: string;
  benchmark: Record<string, unknown>;
  value: unknown;
}): Promise<{
  taskBundles: WorkbenchTaskBundle[];
  environment?: WorkbenchTaskSourceResult["environment"];
}> {
  const record = yamlRecord(args.value);
  if (!record || typeof record.use !== "string") {
    throw new WorkspaceSnapshotError("benchmark.yaml.tasks must be an adapter invocation.");
  }
  const adapter = await resolveTaskSourceAdapterReference({
    root: args.root,
    benchmark: args.benchmark,
    adapterId: record.use,
  });
  await assertTaskSourceAdapterOperations({
    root: args.root,
    benchmark: args.benchmark,
    invocation: taskSourceInvocationFromRecord(record),
  });
  const digest = createHash("sha256")
    .update(JSON.stringify({
      adapter: adapter.contentHash,
      invocation: record,
      cwd: path.resolve(args.yamlDir),
    }))
    .digest("hex")
    .slice(0, 16);
  const generatedRoot = path.join(
    args.root,
    ".workbench",
    "generated",
    "task-sources",
    safePathSegment(record.use),
    `${digest}-${randomUUID().replace(/-/gu, "").slice(0, 12)}`,
  );
  await fs.mkdir(generatedRoot, { recursive: true });
  const requestPath = path.join(generatedRoot, ".workbench", "request.json");
  await fs.mkdir(path.dirname(requestPath), { recursive: true });
  await fs.writeFile(
    requestPath,
    `${JSON.stringify({
      protocol: "workbench.adapter.v2",
      id: `task_source_${digest}`,
      operation: "tasks.resolve",
      invocation: {
        use: record.use,
        with: record.with ?? {},
        ...(record.auth !== undefined ? { auth: record.auth } : {}),
      },
      paths: {
        workspace: args.root,
        cwd: args.yamlDir,
        output: generatedRoot,
        result: workbenchAdapterOperationResultPath(generatedRoot),
      },
    }, null, 2)}\n`,
  );
  await executeTaskSourceAdapter({
    adapter,
    requestPath,
    outputRoot: generatedRoot,
    workspaceRoot: args.root,
  });
  const result = await readTaskSourceResult(generatedRoot, record.use);
  const environment = normalizeTaskSourceEnvironment(args.root, result.environment);
  return {
    taskBundles: result.tasks,
    ...(environment ? { environment } : {}),
  };
}

async function assertTaskSourceAdapterOperations(args: {
  root: string;
  benchmark: Record<string, unknown>;
  invocation: LocalTaskSourceInvocation;
}): Promise<void> {
  const manifests = await resolveBenchmarkAdapterManifests(args.root, args.benchmark);
  try {
    assertWorkbenchAdapterOperationSupport(
      [{ invocation: args.invocation, operation: "tasks.resolve" }],
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
    builtinAdapterManifests().map((manifest) => [manifest.id, manifest]),
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

async function resolveTaskSourceAdapterReference(args: {
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
  const builtin = resolveBuiltinWorkbenchAdapter(args.adapterId);
  if (builtin) {
    return builtin;
  }
  throw new WorkspaceSnapshotError(
    `Task-source adapter ${args.adapterId} is not installed. Add its source under benchmark.yaml adapters.`,
  );
}

async function executeTaskSourceAdapter(args: {
  adapter: ResolvedWorkbenchAdapter;
  requestPath: string;
  outputRoot: string;
  workspaceRoot: string;
}): Promise<void> {
  if (args.adapter.kind === "builtin") {
    await executeWorkbenchBuiltInAdapterCommand({
      adapterId: args.adapter.manifest.id,
      requestPath: args.requestPath,
      outputRoot: args.outputRoot,
    });
    return;
  }
  const cwd = args.adapter.root && await directoryExists(args.adapter.root)
    ? args.adapter.root
    : await materializeTaskSourceAdapterFiles(args.outputRoot, args.adapter);
  await runTaskSourceAdapterCommand({
    command: workbenchAdapterOperationCommand(args.adapter.manifest, "tasks.resolve"),
    cwd,
    requestPath: args.requestPath,
    outputRoot: args.outputRoot,
    workspaceRoot: args.workspaceRoot,
  });
}

async function materializeTaskSourceAdapterFiles(
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

async function runTaskSourceAdapterCommand(args: {
  command: string;
  cwd: string;
  requestPath: string;
  outputRoot: string;
  workspaceRoot: string;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sh", ["-lc", args.command], {
      cwd: args.cwd,
      env: {
        ...process.env,
        WORKBENCH_ADAPTER_REQUEST: args.requestPath,
        WORKBENCH_OUTPUT: args.outputRoot,
        WORKBENCH_RESULT: workbenchAdapterOperationResultPath(args.outputRoot),
        WORKBENCH_WORKSPACE_ROOT: args.workspaceRoot,
      },
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
            ? `Task-source adapter command exited from signal ${signal}.`
            : `Task-source adapter command exited with status ${code ?? "unknown"}.`,
          detail,
        ].filter(Boolean).join("\n"),
      ));
    });
  });
}

async function readTaskSourceResult(
  outputRoot: string,
  adapterId: string,
): Promise<WorkbenchTaskSourceResult> {
  return await readWorkbenchAdapterOperationResult(outputRoot, "tasks.resolve").then((result) => {
    assertWorkbenchAdapterOperationResultOk(result, `Adapter ${adapterId} tasks.resolve`);
    if (!result.value || typeof result.value !== "object" || Array.isArray(result.value)) {
      throw new WorkspaceSnapshotError(`Adapter ${adapterId} tasks.resolve did not return task bundles.`);
    }
    return result.value as WorkbenchTaskSourceResult;
  }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new WorkspaceSnapshotError(
        `Adapter ${adapterId} must write workbench-result.json for tasks.resolve.`,
      );
    }
    throw new WorkspaceSnapshotError(error instanceof Error ? error.message : String(error));
  });
}

function normalizeTaskSourceEnvironment(
  root: string,
  environment: WorkbenchTaskSourceResult["environment"] | undefined,
): WorkbenchTaskSourceResult["environment"] | undefined {
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

function taskSourceFilesFromBundles(
  taskBundles: readonly WorkbenchTaskBundle[],
): SurfaceSnapshotFile[] {
  return normalizeSurfaceFiles(taskBundles.flatMap((bundle) => {
    const files = bundle.sourceFiles?.length
      ? bundle.sourceFiles
      : [
          ...bundle.publicFiles,
          ...bundle.testFiles,
          ...(bundle.solutionFiles ?? []),
        ];
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
  return record.score !== undefined;
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

async function readDockerfileSources(
  dir: string,
  dockerfilePaths: readonly (string | undefined)[],
): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  for (const dockerfilePath of [...new Set(dockerfilePaths.filter((entry): entry is string => Boolean(entry)))]) {
    const absoluteDockerfilePath = resolveProjectPath(dir, dockerfilePath);
    sources.set(dockerfilePath, await fs.readFile(absoluteDockerfilePath, "utf8").catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new WorkspaceSnapshotError(`Dockerfile not found: ${absoluteDockerfilePath}`);
      }
      throw error;
    }));
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
    adapter.kind === "builtin"
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
