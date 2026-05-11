import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import {
  BENCHMARK_SPEC_FILE,
  buildWorkbenchProjectSourceFiles,
  caseExecutionIds,
  normalizeSurfaceFiles,
  parseWorkbenchSourceFiles,
  resolveWorkbenchResolvedSourceYaml,
  serializeWorkbenchResolvedSourceYaml,
  selectCaseFilesForExecution,
  taskSpecFromCaseFiles,
  validateWorkbenchResolvedSourceYaml,
  type SurfaceSnapshotFile,
} from "@workbench-ai/workbench-core";
import {
  collectWorkbenchAdapterInvocations,
} from "@workbench-ai/workbench-protocol";

import {
  readSnapshotFiles,
  WorkspaceSnapshotError,
  type WorkspaceSnapshotFile,
} from "./workspace-snapshot.js";
import {
  composeRuntimeDockerfileWithAdapters,
  resolveWorkbenchAdaptersForProject,
  type ResolvedWorkbenchAdapter,
} from "./adapter-project.js";
import YAML from "yaml";

export const WORKBENCH_BENCHMARK_FILE = BENCHMARK_SPEC_FILE;
export const WORKBENCH_SUBJECTS_DIR = "subjects";
export const WORKBENCH_CANDIDATES_DIR = WORKBENCH_SUBJECTS_DIR;
export const WORKBENCH_OPTIMIZERS_DIR = "optimizers";
export const WORKBENCH_SUBJECT_FILE = "subject.yaml";
export const WORKBENCH_CANDIDATE_FILE = WORKBENCH_SUBJECT_FILE;
export const WORKBENCH_SUBJECT_FILES_DIR = "files";
export const WORKBENCH_CANDIDATE_FILES_DIR = WORKBENCH_SUBJECT_FILES_DIR;

export type HostedFile = WorkspaceSnapshotFile;

export interface LocalProjectSource {
  dir: string;
  specPath: string;
  specSource: string;
  spec: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>;
  benchmarkPath: string;
  benchmarkSource: string;
  subjectName: string;
  candidateName: string;
  candidateDir: string;
  candidateFilesPath: string;
  candidateSpecPath: string;
  candidateSource: string;
  optimizerPath?: string;
  optimizerSource?: string;
  benchmarkAdapterSources: string[];
  benchmarkAdapterIds: string[];
  dockerfilePath: string;
  dockerfile: string;
  runtimeDockerfile: string;
  dockerfileFiles: HostedFile[];
  candidateFiles: HostedFile[];
  caseFiles: HostedFile[];
  adapters: ResolvedWorkbenchAdapter[];
  adapterFiles: HostedFile[];
  taskIds: string[];
  sourceFiles: SurfaceSnapshotFile[];
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
    candidateSpecPath,
    candidateDir,
    candidateFilesPath,
    optimizerPath,
  } = paths;
  const benchmarkSource = await readRequiredTextFile(benchmarkPath, WORKBENCH_BENCHMARK_FILE);
  const candidateSource = await readRequiredTextFile(candidateSpecPath, "subject YAML");
  const optimizerSource = optimizerPath
    ? await readRequiredTextFile(optimizerPath, "optimizer YAML")
    : undefined;
  const normalizedSources = await normalizeSourceYamlForExecution({
    dir,
    benchmarkPath,
    benchmarkSource,
    candidateSpecPath,
    candidateFilesPath,
    candidateSource,
    optimizerPath,
    optimizerSource,
  });
  const resolvedSource = parseWorkbenchSourceFiles({
    benchmarkSource: normalizedSources.benchmarkSource,
    subjectSource: normalizedSources.candidateSource,
    optimizerSource: normalizedSources.optimizerSource,
    subjectPath: normalizedSources.candidatePath,
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
  const absoluteCandidateFilesPath = resolveProjectPath(dir, spec.candidate.path);
  const candidateFiles = await directoryExists(absoluteCandidateFilesPath)
    ? normalizeSurfaceFiles(await readSnapshotFiles(absoluteCandidateFilesPath))
    : [];
  const rawCaseFiles = normalizeSurfaceFiles(
    await readSnapshotFiles(resolveProjectPath(dir, spec.tasks.path)),
  );
  const caseFiles = toHostedFiles(rawCaseFiles);
  if (caseFiles.length === 0) {
    throw new WorkspaceSnapshotError(
      `Tasks snapshot has no files: ${resolveProjectPath(dir, spec.tasks.path)}`,
    );
  }
  const taskIds = caseExecutionIds(rawCaseFiles);
  if (taskIds.length === 0) {
    throw new WorkspaceSnapshotError(
      `Tasks snapshot must include at least one task.yaml: ${resolveProjectPath(dir, spec.tasks.path)}`,
    );
  }
  for (const taskId of taskIds) {
    try {
      taskSpecFromCaseFiles(
        selectCaseFilesForExecution(rawCaseFiles, taskId),
        taskId,
      );
    } catch (error) {
      throw new WorkspaceSnapshotError(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    dir,
    specPath: benchmarkPath,
    specSource,
    spec,
    benchmarkPath,
    benchmarkSource,
    subjectName: path.basename(candidateDir),
    candidateName: path.basename(candidateDir),
    candidateDir,
    candidateFilesPath,
    candidateSpecPath,
    candidateSource,
    ...(optimizerSource !== undefined && optimizerPath ? { optimizerPath, optimizerSource } : {}),
    benchmarkAdapterSources: [...resolvedSource.benchmark.adapters],
    benchmarkAdapterIds,
    dockerfilePath,
    dockerfile,
    runtimeDockerfile: composedDockerfile,
    dockerfileFiles: toHostedFiles(dockerfileSourceFiles(dockerfileSources)),
    candidateFiles: toHostedFiles(candidateFiles),
    caseFiles,
    adapters,
    adapterFiles: toHostedFiles(adapterFiles),
    taskIds,
    sourceFiles: buildWorkbenchProjectSourceFiles({
      specFiles: [
        textSourceFile(toRootRelativePath(dir, benchmarkPath), benchmarkSource),
        textSourceFile(toRootRelativePath(dir, candidateSpecPath), candidateSource),
        ...(optimizerSource !== undefined && optimizerPath
          ? [textSourceFile(toRootRelativePath(dir, optimizerPath), optimizerSource)]
          : []),
      ],
      candidatePath: spec.candidate.path,
      candidateFiles,
      tasksPath: spec.tasks.path,
      taskFiles: rawCaseFiles,
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
  candidateDir: string;
  candidateFilesPath: string;
  candidateSpecPath: string;
  optimizerPath?: string;
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
        candidateFilesPath: path.join(candidateDir, WORKBENCH_CANDIDATE_FILES_DIR),
        candidateSpecPath: resolved,
        optimizerPath: await resolveOptimizerPath(dir, options.optimizerPath, path.basename(candidateDir)),
      };
    }
    if (isBenchmarkSourceRecord(sourceRecord)) {
      const dir = path.dirname(resolved);
      const candidatePaths = await resolveCandidatePaths(dir);
      return {
        dir,
        benchmarkPath: resolved,
        ...candidatePaths,
        optimizerPath: await resolveOptimizerPath(
          dir,
          options.optimizerPath,
          path.basename(candidatePaths.candidateDir),
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
  const directoryCandidate = await candidatePathsForCandidateDirectory(dir);
  if (directoryCandidate) {
    return {
      ...directoryCandidate,
      optimizerPath: await resolveOptimizerPath(
        directoryCandidate.dir,
        options.optimizerPath,
        path.basename(directoryCandidate.candidateDir),
      ),
    };
  }
  const candidatePaths = await resolveCandidatePathsWithOptimizer(
    dir,
    options.optimizerPath,
  );
  return {
    dir,
    benchmarkPath: path.join(dir, WORKBENCH_BENCHMARK_FILE),
    ...candidatePaths,
  };
}

async function resolveCandidatePathsWithOptimizer(
  dir: string,
  explicitOptimizerPath: string | undefined,
): Promise<{
  candidateDir: string;
  candidateFilesPath: string;
  candidateSpecPath: string;
  optimizerPath?: string;
}> {
  const candidatePaths = await resolveCandidatePaths(dir);
  return {
    ...candidatePaths,
    optimizerPath: await resolveOptimizerPath(
      dir,
      explicitOptimizerPath,
      path.basename(candidatePaths.candidateDir),
    ),
  };
}

async function resolveCandidatePaths(dir: string): Promise<{
  candidateDir: string;
  candidateFilesPath: string;
  candidateSpecPath: string;
}> {
  const candidatesDir = path.join(dir, WORKBENCH_CANDIDATES_DIR);
  const candidates = await listCandidateManifestFiles(candidatesDir);
  if (candidates.length === 1) {
    const candidateSpecPath = candidates[0]!;
    const candidateDir = path.dirname(candidateSpecPath);
    return {
      candidateDir,
      candidateFilesPath: path.join(candidateDir, WORKBENCH_CANDIDATE_FILES_DIR),
      candidateSpecPath,
    };
  }
  if (candidates.length > 1) {
    throw new WorkspaceSnapshotError(
        `Multiple subject directories found under ${candidatesDir}; pass subjects/NAME or subjects/NAME/subject.yaml explicitly.`,
    );
  }
  throw new WorkspaceSnapshotError(
    `No subject directories found under ${candidatesDir}; create subjects/NAME/subject.yaml and subjects/NAME/files/.`,
  );
}

async function resolveOptimizerPath(
  dir: string,
  explicit: string | undefined,
  candidateName?: string,
): Promise<string | undefined> {
  if (explicit) {
    return path.resolve(dir, explicit);
  }
  if (candidateName) {
    const named = path.join(dir, WORKBENCH_OPTIMIZERS_DIR, `${candidateName}.yaml`);
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
  candidateSpecPath: string;
  candidateFilesPath: string;
  candidateSource: string;
  optimizerPath?: string;
  optimizerSource?: string;
}): Promise<{
  benchmarkSource: string;
  candidateSource: string;
  candidatePath: string;
  optimizerSource?: string;
}> {
  const benchmark = parseYamlRecord(args.benchmarkSource, args.benchmarkPath);
  const candidate = parseYamlRecord(args.candidateSource, args.candidateSpecPath);
  const optimizer = args.optimizerSource === undefined || args.optimizerPath === undefined
    ? undefined
    : parseYamlRecord(args.optimizerSource, args.optimizerPath);

  const benchmarkDir = path.dirname(args.benchmarkPath);
  const candidateDir = path.dirname(args.candidateSpecPath);
  if (typeof benchmark.tasks === "string") {
    benchmark.tasks = toRootRelativePath(
      args.dir,
      resolveYamlReference(benchmarkDir, benchmark.tasks),
    );
  } else {
    const taskSource = await resolveTaskSourceAdapter({
      root: args.dir,
      yamlDir: benchmarkDir,
      value: benchmark.tasks,
    });
    benchmark.tasks = taskSource.tasksPath;
    if (!yamlRecord(benchmark.environment) && taskSource.environment) {
      benchmark.environment = taskSource.environment;
    }
  }
  const environment = yamlRecord(benchmark.environment);
  if (environment && typeof environment.dockerfile === "string") {
    environment.dockerfile = toRootRelativePath(
      args.dir,
      resolveYamlReference(benchmarkDir, environment.dockerfile),
    );
  }
  normalizeAdapterSourcePaths(args.dir, benchmark, benchmarkDir);
  normalizeAdapterSourcePaths(args.dir, candidate, candidateDir);
  if (optimizer && args.optimizerPath) {
    normalizeAdapterSourcePaths(args.dir, optimizer, path.dirname(args.optimizerPath));
  }
  return {
    benchmarkSource: YAML.stringify(benchmark).trimEnd() + "\n",
    candidateSource: YAML.stringify(candidate).trimEnd() + "\n",
    candidatePath: toRootRelativePath(args.dir, args.candidateFilesPath),
    ...(optimizer
      ? { optimizerSource: YAML.stringify(optimizer).trimEnd() + "\n" }
      : {}),
  };
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
  value: unknown;
}): Promise<{
  tasksPath: string;
  environment?: Record<string, unknown>;
}> {
  const record = yamlRecord(args.value);
  if (!record || typeof record.use !== "string") {
    throw new WorkspaceSnapshotError("benchmark.yaml.tasks must be a relative path or an adapter invocation.");
  }
  if (record.use !== "harbor") {
    throw new WorkspaceSnapshotError(`Unsupported task-source adapter ${record.use}.`);
  }
  const config = yamlRecord(record.with) ?? {};
  const sourcePath = typeof config.path === "string"
    ? resolveYamlReference(args.yamlDir, config.path)
    : null;
  if (!sourcePath) {
    throw new WorkspaceSnapshotError("tasks.use: harbor requires tasks.with.path.");
  }
  return await resolveHarborTaskSource({
    root: args.root,
    sourcePath,
  });
}

async function resolveHarborTaskSource(args: {
  root: string;
  sourcePath: string;
}): Promise<{
  tasksPath: string;
  environment?: Record<string, unknown>;
}> {
  const stat = await fs.stat(args.sourcePath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new WorkspaceSnapshotError(`Harbor task source path is not a directory: ${args.sourcePath}`);
  }
  const childTasks = await listHarborTaskDirectories(args.sourcePath);
  if (childTasks.length === 0) {
    throw new WorkspaceSnapshotError(`Harbor task source has no task directories: ${args.sourcePath}`);
  }
  const digest = createHash("sha256")
    .update(path.resolve(args.sourcePath))
    .digest("hex")
    .slice(0, 16);
  const generatedRoot = path.join(args.root, ".workbench", "generated", "harbor", digest);
  const tasksRoot = path.join(generatedRoot, "tasks");
  await fs.rm(generatedRoot, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(tasksRoot, { recursive: true });
  let firstEnvironment: Record<string, unknown> | undefined;
  for (const taskDir of childTasks) {
    const taskId = path.basename(taskDir);
    const target = path.join(tasksRoot, taskId);
    await fs.mkdir(target, { recursive: true });
    await copyIfExists(path.join(taskDir, "environment"), path.join(target, "environment"));
    await copyIfExists(path.join(taskDir, "tests"), path.join(target, "tests"));
    await copyIfExists(path.join(taskDir, "solution"), path.join(target, "solution"));
    await copyIfExists(path.join(taskDir, "files"), path.join(target, "files"));
    await copyIfExists(path.join(taskDir, "instruction.md"), path.join(target, "instruction.md"));
    await copyIfExists(path.join(taskDir, "task.toml"), path.join(target, "task.toml"));
    const instruction = await fs.readFile(path.join(taskDir, "instruction.md"), "utf8").catch(() => "");
    const taskToml = await fs.readFile(path.join(taskDir, "task.toml"), "utf8").catch(() => "");
    const workdir = readHarborWorkdir(taskToml);
    const taskYaml = {
      task: instruction.trim() || taskId,
      environment: {
        dockerfile: "environment/Dockerfile",
        ...(workdir ? { workdir } : {}),
      },
    };
    await fs.writeFile(path.join(target, "task.yaml"), `${YAML.stringify(taskYaml).trimEnd()}\n`);
    if (!firstEnvironment) {
      firstEnvironment = {
        dockerfile: toRootRelativePath(args.root, path.join(target, "environment", "Dockerfile")),
        ...(workdir ? { workdir } : {}),
      };
    }
  }
  return {
    tasksPath: toRootRelativePath(args.root, tasksRoot),
    ...(firstEnvironment ? { environment: firstEnvironment } : {}),
  };
}

async function listHarborTaskDirectories(root: string): Promise<string[]> {
  const direct = await isHarborTaskDirectory(root);
  if (direct) {
    return [root];
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const tasks: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(root, entry.name);
    if (await isHarborTaskDirectory(candidate)) {
      tasks.push(candidate);
    }
  }
  return tasks.sort((left, right) => left.localeCompare(right));
}

async function isHarborTaskDirectory(dir: string): Promise<boolean> {
  const [instruction, taskToml, tests] = await Promise.all([
    fileExists(path.join(dir, "instruction.md")),
    fileExists(path.join(dir, "task.toml")),
    fs.stat(path.join(dir, "tests")).then((stat) => stat.isDirectory(), () => false),
  ]);
  return instruction && taskToml && tests;
}

async function copyIfExists(source: string, target: string): Promise<void> {
  const stat = await fs.stat(source).catch(() => null);
  if (!stat) {
    return;
  }
  if (stat.isDirectory()) {
    await fs.cp(source, target, { recursive: true });
    return;
  }
  if (stat.isFile()) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    await fs.chmod(target, stat.mode).catch(() => undefined);
  }
}

function readHarborWorkdir(taskToml: string): string | undefined {
  const match = /^\s*workdir\s*=\s*"([^"]+)"\s*$/gmu.exec(taskToml);
  return match?.[1];
}

function isPathAdapterSource(source: string): boolean {
  return !/^(?:npm|git):/iu.test(source.trim());
}

function isBenchmarkSourceRecord(record: Record<string, unknown>): boolean {
  return record.tasks !== undefined && record.environment !== undefined && record.score !== undefined;
}

function isCandidateSourceRecord(record: Record<string, unknown>): boolean {
  return record.run !== undefined;
}

function isOptimizerSourceRecord(record: Record<string, unknown>): boolean {
  return record.edits !== undefined && record.improve !== undefined;
}

async function readYamlRecordFile(filePath: string): Promise<Record<string, unknown>> {
  return parseYamlRecord(await readRequiredTextFile(filePath, path.basename(filePath)), filePath);
}

async function candidatePathsForCandidateDirectory(sourceDir: string): Promise<{
  dir: string;
  benchmarkPath: string;
  candidateDir: string;
  candidateFilesPath: string;
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
    candidateFilesPath: path.join(sourceDir, WORKBENCH_CANDIDATE_FILES_DIR),
    candidateSpecPath,
  };
}

function projectRootForCandidateDir(candidateDir: string): string {
  const parent = path.basename(path.dirname(candidateDir));
  if (parent !== WORKBENCH_CANDIDATES_DIR) {
    throw new WorkspaceSnapshotError(
      `Subject directory must be under ${WORKBENCH_CANDIDATES_DIR}/NAME: ${candidateDir}`,
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
