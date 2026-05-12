import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  EvalCaseResult,
  Json,
  SurfaceSnapshotFile,
  UsageSummary,
  WorkbenchScorecard,
  WorkbenchSubjectPatch,
} from "@workbench-ai/workbench-contract";
import {
  ensureWorkbenchAdapterOutputDir,
  readWorkbenchAdapterOperationResult,
  readWorkbenchAdapterOperationRequest,
  writeWorkbenchAdapterOperationResult,
  workbenchAdapterOperationResultPath,
  type WorkbenchAdapterOperationRequest,
  type WorkbenchTaskBundle,
  type WorkbenchTaskSourceResult,
} from "@workbench-ai/workbench-protocol";
import YAML from "yaml";

import {
  defaultWorkbenchAgentTurnExecutor,
  executeWorkbenchAgentTurn,
  type AgentProviderSpec,
  type WorkbenchAgentTurnExecutor,
  type WorkbenchAgentTurnResult,
} from "./agent-turn.ts";
import {
  isWorkbenchBuiltInAdapterId,
  type WorkbenchBuiltInAdapterId,
} from "./manifests.ts";
import { importWorkbenchRuntime } from "./runtime.ts";

export interface ExecuteWorkbenchBuiltInAdapterCommandOptions {
  adapterId?: string;
  requestPath?: string;
  outputRoot?: string;
  agentExecutor?: WorkbenchAgentTurnExecutor;
  adapterAuthRoot?: string;
  adapterAuthRequest?: Json;
  adapterAuthEnv?: Record<string, string>;
}

interface BuiltInAgentAdapterSpec {
  agent: AgentProviderSpec;
  instructions?: string;
}

interface BuiltInRubricAdapterSpec {
  judge: AgentProviderSpec;
  instructions?: string;
  criteria: RubricCriterionSpec[];
}

interface RubricCriterionSpec {
  id: string;
  description: string;
  weight?: number;
}

const TASK_CONTROL_FILE = "task.yaml";

interface AdapterWorkload {
  job: { id: string };
  benchmark: {
    name: string;
    description: string;
  };
  subject: {
    path: string;
  };
  optimizer: {
    edits: string[];
  };
  subjectId: string;
  trialIndex: number;
  sampleIndex: number;
  caseId: string;
  task?: {
    task: string;
  };
}

export async function executeWorkbenchBuiltInAdapterCommand(
  args: ExecuteWorkbenchBuiltInAdapterCommandOptions = {},
): Promise<void> {
  const request = await readWorkbenchAdapterOperationRequest(args.requestPath);
  const adapterId = args.adapterId ?? request.invocation.use;
  if (adapterId !== request.invocation.use) {
    throw new Error(`Adapter command ${adapterId} cannot execute request for ${request.invocation.use}.`);
  }
  if (!isWorkbenchBuiltInAdapterId(adapterId)) {
    throw new Error(`Unsupported built-in Workbench adapter: ${adapterId}.`);
  }
  if (args.outputRoot && args.outputRoot !== request.paths.output) {
    request.paths.output = args.outputRoot;
  }
  await ensureWorkbenchAdapterOutputDir(request);
  if (adapterId === "command") {
    await executeCommandAdapterRequest(request);
    return;
  }
  if (adapterId === "tests") {
    await executeTestsScorerRequest(request);
    return;
  }
  if (adapterId === "path") {
    await executePathTaskSourceRequest(request);
    return;
  }
  if (adapterId === "harbor") {
    await executeHarborTaskSourceRequest(request);
    return;
  }
  if (adapterId === "rubric") {
    if (request.operation !== "trial.score") {
      throw new Error(`Rubric adapter cannot handle ${request.operation}.`);
    }
    await writeRubricJudgeScorecard(
      request,
      workloadFromAdapterOperationRequest(request),
      builtInRubricSpecFromRequest(request),
      {
        agentExecutor: args.agentExecutor,
        adapterAuthRoot: args.adapterAuthRoot,
        adapterAuthRequest: args.adapterAuthRequest ?? request.auth,
        adapterAuthEnv: args.adapterAuthEnv,
      },
    );
    return;
  }
  if (isBuiltInAgentAdapterId(adapterId)) {
    const workload = workloadFromAdapterOperationRequest(request);
    const agent = builtInAgentSpecFromRequest(request);
    if (request.operation === "subject.improve") {
      await writeAgentProposalOutput(request, workload, agent, {
        agentExecutor: args.agentExecutor,
        adapterAuthRoot: args.adapterAuthRoot,
        adapterAuthRequest: args.adapterAuthRequest ?? request.auth,
        adapterAuthEnv: args.adapterAuthEnv,
      });
      return;
    }
    if (request.operation === "subject.run") {
      await writeAgentRunnerOutput(request, workload, agent, {
        agentExecutor: args.agentExecutor,
        adapterAuthRoot: args.adapterAuthRoot,
        adapterAuthRequest: args.adapterAuthRequest ?? request.auth,
        adapterAuthEnv: args.adapterAuthEnv,
      });
      return;
    }
    throw new Error(`Agent adapter ${adapterId} cannot handle ${request.operation}.`);
  }
}

async function executePathTaskSourceRequest(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  if (request.operation !== "tasks.resolve") {
    throw new Error("Path adapter can only handle tasks.resolve.");
  }
  const configuredPath = requiredAdapterCommandString(request, "path");
  const sourcePath = path.resolve(request.paths.cwd ?? request.paths.workspace, configuredPath);
  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Path task source is not a directory: ${sourcePath}`);
  }
  const tasks = await readTaskBundlesFromWorkbenchTaskRoot(sourcePath);
  await writeWorkbenchAdapterOperationResult(request.paths.output, {
    protocol: "workbench.adapter-result.v1",
    operation: "tasks.resolve",
    ok: true,
    value: { tasks },
    summary: `Resolved Workbench task bundles from ${configuredPath}.`,
    feedback: {
      taskSource: "path",
      path: configuredPath,
    },
  });
}

async function executeHarborTaskSourceRequest(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  if (request.operation !== "tasks.resolve") {
    throw new Error("Harbor adapter can only handle tasks.resolve.");
  }
  const configuredPath = requiredAdapterCommandString(request, "path");
  const sourcePath = path.resolve(request.paths.cwd ?? request.paths.workspace, configuredPath);
  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Harbor task source path is not a directory: ${sourcePath}`);
  }
  const childTasks = await listHarborTaskDirectories(sourcePath);
  if (childTasks.length === 0) {
    throw new Error(`Harbor task source has no task directories: ${sourcePath}`);
  }
  const tasks: WorkbenchTaskBundle[] = [];
  let environment: WorkbenchTaskSourceResult["environment"];
  for (const taskDir of childTasks) {
    const taskId = path.basename(taskDir);
    const taskToml = await fs.readFile(path.join(taskDir, "task.toml"), "utf8");
    const workdir = readHarborWorkdir(taskToml);
    tasks.push(await readHarborTaskBundle({
      taskDir,
      id: taskId,
      workdir,
    }));
    const dockerfile = path.join(taskDir, "environment", "Dockerfile");
    if (!environment && await fileExists(dockerfile)) {
      environment = {
        dockerfile: workspaceRelativeOrAbsolute(request.paths.workspace, dockerfile),
        ...(workdir ? { workdir } : {}),
      };
    }
  }
  await writeWorkbenchAdapterOperationResult(request.paths.output, {
    protocol: "workbench.adapter-result.v1",
    operation: "tasks.resolve",
    ok: true,
    value: {
      tasks,
      ...(environment ? { environment } : {}),
    },
    summary: `Resolved ${childTasks.length} Harbor task${childTasks.length === 1 ? "" : "s"}.`,
    feedback: {
      taskSource: "harbor",
      taskCount: childTasks.length,
    },
  });
}

async function executeCommandAdapterRequest(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  const command = requiredAdapterCommandString(request, "command");
  await runAdapterShellCommand(command, request.paths.cwd ?? request.paths.workspace);
  if (request.operation === "trial.score") {
    await requireCommandScoreResult(request);
    return;
  }
  await writeOperationOkUnlessPresent(request);
}

async function requireCommandScoreResult(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  if (!await fileExists(workbenchAdapterOperationResultPath(request.paths.output))) {
    throw new Error("Command scorer must write workbench-result.json for trial.score.");
  }
  await readWorkbenchAdapterOperationResult(request.paths.output, "trial.score").catch((error: unknown) => {
    throw new Error(
      `Command scorer wrote an invalid workbench-result.json for trial.score: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
}

async function executeTestsScorerRequest(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  if (request.operation !== "trial.score") {
    throw new Error(`Tests adapter cannot handle ${request.operation}.`);
  }
  const testsRoot = request.paths.tests ?? path.join(request.paths.workspace, "tests");
  const logsRoot = request.paths.logs ?? path.join(request.paths.workspace, "logs");
  const verifierLogs = path.join(logsRoot, "verifier");
  await fs.mkdir(verifierLogs, { recursive: true });
  const script = await firstExistingFile([
    path.join(testsRoot, "test.sh"),
    path.join(testsRoot, "run.sh"),
  ]);
  if (!script) {
    throw new Error(`Tests scorer requires ${path.join(testsRoot, "test.sh")}.`);
  }
  await runAdapterShellCommand(`sh ${shellQuote(script)}`, request.paths.cwd ?? request.paths.workspace);
  const scorecard = await readTestsScorecard({
    logsRoot,
    caseId: request.context?.trial?.caseId ?? "current",
  });
  await writeWorkbenchAdapterOperationResult(request.paths.output, {
    protocol: "workbench.adapter-result.v1",
    operation: "trial.score",
    ok: true,
    value: scorecard,
    ...(typeof scorecard.summary === "string" ? { summary: scorecard.summary } : {}),
    feedback: {
      scorer: "tests",
    },
  });
}

async function runAdapterShellCommand(command: string, cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sh", ["-lc", command], {
      cwd,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        code === null
          ? `Command adapter exited from signal ${signal ?? "unknown"}.`
          : `Command adapter exited with status ${code}.`,
      ));
    });
  });
}

async function writeOperationOkUnlessPresent(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  if (await fileExists(workbenchAdapterOperationResultPath(request.paths.output))) {
    return;
  }
  if (request.operation === "subject.improve") {
    const patch = await createSubjectPatchFromWorkspace({
      beforeRoot: request.paths.subject ?? path.join(request.paths.input ?? request.paths.workspace, "subject"),
      afterRoot: request.paths.cwd ?? request.paths.workspace,
      edits: request.context?.optimizer?.edits ?? [],
    });
    await writeWorkbenchAdapterOperationResult(request.paths.output, {
      protocol: "workbench.adapter-result.v1",
      operation: request.operation,
      ok: true,
      value: patch,
    });
    return;
  }
  await writeWorkbenchAdapterOperationResult(request.paths.output, {
    protocol: "workbench.adapter-result.v1",
    operation: request.operation,
    ok: true,
  });
}

async function firstExistingFile(files: readonly string[]): Promise<string | null> {
  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isFile()) {
      return file;
    }
  }
  return null;
}

async function listHarborTaskDirectories(root: string): Promise<string[]> {
  if (await isHarborTaskDirectory(root)) {
    return [root];
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const tasks: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const subject = path.join(root, entry.name);
    if (await isHarborTaskDirectory(subject)) {
      tasks.push(subject);
    }
  }
  return tasks.sort((left, right) => left.localeCompare(right));
}

async function readTaskBundlesFromWorkbenchTaskRoot(
  tasksRoot: string,
): Promise<WorkbenchTaskBundle[]> {
  const taskDirs = await listWorkbenchTaskDirectories(tasksRoot);
  if (taskDirs.length === 0) {
    throw new Error(`Task source has no Workbench task packages: ${tasksRoot}`);
  }
  return await Promise.all(taskDirs.map(async (taskDir) =>
    readWorkbenchTaskBundle({
      taskDir,
      id: path.basename(taskDir),
    })
  ));
}

async function listWorkbenchTaskDirectories(root: string): Promise<string[]> {
  if (await fileExists(path.join(root, TASK_CONTROL_FILE))) {
    return [root];
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const tasks: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const taskDir = path.join(root, entry.name);
    if (await fileExists(path.join(taskDir, TASK_CONTROL_FILE))) {
      tasks.push(taskDir);
    }
  }
  return tasks.sort((left, right) => left.localeCompare(right));
}

async function readWorkbenchTaskBundle(args: {
  taskDir: string;
  id: string;
}): Promise<WorkbenchTaskBundle> {
  const sourceFiles = await readSurfaceFilesRecursive(args.taskDir);
  const taskFile = sourceFiles.find((file) =>
    normalizeRelativePath(file.path) === TASK_CONTROL_FILE && file.encoding === "utf8"
  );
  if (!taskFile) {
    throw new Error(`Task ${args.id} is missing ${TASK_CONTROL_FILE}.`);
  }
  const parsed = YAML.parse(taskFile.content) as unknown;
  const taskRecord = jsonRecord(parsed);
  if (taskRecord.version !== 2) {
    throw new Error(`Task ${args.id} ${TASK_CONTROL_FILE} version must be 2.`);
  }
  if (typeof taskRecord.task !== "string" || taskRecord.task.trim().length === 0) {
    throw new Error(`Task ${args.id} ${TASK_CONTROL_FILE} must include a task string.`);
  }
  const publicPrefix = taskDirectoryPrefix(taskRecord.files, "files", args.id);
  const testsPrefix = taskDirectoryPrefix(taskRecord.tests, "tests", args.id);
  const solutionPrefix = taskDirectoryPrefix(taskRecord.solution, "solution", args.id);
  const solutionFiles = stripTaskDirectory(sourceFiles, solutionPrefix);
  assertWorkbenchTaskPackageLayout(args.id, sourceFiles, [
    publicPrefix,
    testsPrefix,
    solutionPrefix,
    "environment/",
  ]);
  return {
    id: normalizeRelativePath(args.id),
    task: {
      version: 2,
      task: taskRecord.task,
      ...(taskRecord.environment !== undefined
        ? { environment: taskRecord.environment as WorkbenchTaskBundle["task"]["environment"] }
        : {}),
      ...(taskRecord.score !== undefined
        ? { score: taskRecord.score as unknown as WorkbenchTaskBundle["task"]["score"] }
        : {}),
    },
    publicFiles: stripTaskDirectory(sourceFiles, publicPrefix),
    testFiles: stripTaskDirectory(sourceFiles, testsPrefix),
    ...(solutionFiles.length > 0 ? { solutionFiles } : {}),
    sourceFiles,
  };
}

async function readHarborTaskBundle(args: {
  taskDir: string;
  id: string;
  workdir?: string;
}): Promise<WorkbenchTaskBundle> {
  const instruction = await fs.readFile(path.join(args.taskDir, "instruction.md"), "utf8");
  const publicFiles = await readSurfaceFilesIfDirectory(path.join(args.taskDir, "files"));
  const testFiles = await readSurfaceFilesIfDirectory(path.join(args.taskDir, "tests"));
  const solutionFiles = await readSurfaceFilesIfDirectory(path.join(args.taskDir, "solution"));
  const sourceFiles = await readSurfaceFilesRecursive(args.taskDir);
  return {
    id: normalizeRelativePath(args.id),
    task: {
      version: 2,
      task: instruction.trim() || args.id,
      ...(args.workdir ? { environment: { workdir: args.workdir } } : {}),
    },
    publicFiles,
    testFiles,
    ...(solutionFiles.length > 0 ? { solutionFiles } : {}),
    sourceFiles,
  };
}

function taskDirectoryPrefix(value: unknown, fallback: string, taskId: string): string {
  if (value === undefined) {
    return `${fallback}/`;
  }
  const record = jsonRecord(value);
  if (typeof record.path !== "string" || record.path.trim().length === 0) {
    throw new Error(`Task ${taskId} ${TASK_CONTROL_FILE} path config must include a path string.`);
  }
  return `${normalizeRelativePath(record.path)}/`;
}

function assertWorkbenchTaskPackageLayout(
  taskId: string,
  files: readonly SurfaceSnapshotFile[],
  allowedPrefixes: readonly string[],
): void {
  const invalid = files
    .map((file) => normalizeRelativePath(file.path))
    .filter((filePath) =>
      filePath !== TASK_CONTROL_FILE &&
      !allowedPrefixes.some((prefix) => filePath.startsWith(prefix))
    );
  if (invalid.length > 0) {
    throw new Error(
      `Task ${taskId} contains unsupported file${invalid.length === 1 ? "" : "s"} outside task.yaml or declared task directories: ${invalid.join(", ")}`,
    );
  }
}

function stripTaskDirectory(
  files: readonly SurfaceSnapshotFile[],
  prefix: string,
): SurfaceSnapshotFile[] {
  return files.flatMap((file): SurfaceSnapshotFile[] => {
    const normalized = normalizeRelativePath(file.path);
    if (!normalized.startsWith(prefix)) {
      return [];
    }
    return [{ ...file, path: normalized.slice(prefix.length) }];
  }).sort((left, right) => left.path.localeCompare(right.path));
}

async function readSurfaceFilesRecursive(root: string): Promise<SurfaceSnapshotFile[]> {
  const result: SurfaceSnapshotFile[] = [];
  await readSurfaceFilesInto(root, "", result);
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

async function readSurfaceFilesIfDirectory(root: string): Promise<SurfaceSnapshotFile[]> {
  return await directoryExists(root) ? readSurfaceFilesRecursive(root) : [];
}

async function readSurfaceFilesInto(
  root: string,
  relativeDir: string,
  result: SurfaceSnapshotFile[],
): Promise<void> {
  const entries = await fs.readdir(path.join(root, relativeDir), { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = normalizeRelativePath(path.join(relativeDir, entry.name));
    const absolutePath = path.join(root, relativePath);
    if (entry.isDirectory()) {
      await readSurfaceFilesInto(root, relativePath, result);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const [body, stat] = await Promise.all([
      fs.readFile(absolutePath),
      fs.stat(absolutePath),
    ]);
    const text = body.toString("utf8");
    const isUtf8 = Buffer.from(text, "utf8").equals(body);
    result.push({
      path: relativePath,
      kind: isUtf8 ? "text" : "binary",
      encoding: isUtf8 ? "utf8" : "base64",
      content: isUtf8 ? text : body.toString("base64"),
      executable: (stat.mode & 0o111) !== 0,
    });
  }
}

async function isHarborTaskDirectory(dir: string): Promise<boolean> {
  const [instruction, taskToml, tests] = await Promise.all([
    fileExists(path.join(dir, "instruction.md")),
    fileExists(path.join(dir, "task.toml")),
    fs.stat(path.join(dir, "tests")).then((stat) => stat.isDirectory(), () => false),
  ]);
  return instruction && taskToml && tests;
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then((stat) => stat.isFile(), () => false);
}

async function directoryExists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then((stat) => stat.isDirectory(), () => false);
}

function readHarborWorkdir(taskToml: string): string | undefined {
  let section = "";
  for (const rawLine of taskToml.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const sectionMatch = /^\[([^\]]+)\]$/u.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]!.trim();
      continue;
    }
    const workdirMatch = /^workdir\s*=\s*"([^"]+)"\s*$/u.exec(line);
    if (workdirMatch && (!section || section === "environment")) {
      return workdirMatch[1];
    }
  }
  return undefined;
}

function workspaceRelativeOrAbsolute(workspace: string, absolutePath: string): string {
  const relative = path.relative(workspace, absolutePath);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return normalizeRelativePath(relative || path.basename(absolutePath));
  }
  return absolutePath;
}

async function readTestsScorecard(args: {
  logsRoot: string;
  caseId: string;
}): Promise<WorkbenchScorecard> {
  const rewardJson = await readOptionalJson(path.join(args.logsRoot, "verifier", "reward.json"));
  if (rewardJson) {
    return normalizeTestsScorecard(rewardJson, args.caseId);
  }
  const rewardText = await fs.readFile(path.join(args.logsRoot, "verifier", "reward.txt"), "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (rewardText !== null) {
    const score = Number.parseFloat(rewardText.trim());
    if (!Number.isFinite(score)) {
      throw new Error("Tests scorer reward.txt must contain a finite numeric reward.");
    }
    return normalizeTestsScorecard({ reward: score }, args.caseId);
  }
  throw new Error("Tests scorer did not find /logs/verifier/reward.json or /logs/verifier/reward.txt.");
}

async function readOptionalJson(filePath: string): Promise<Record<string, unknown> | null> {
  const source = await fs.readFile(filePath, "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (source === null) {
    return null;
  }
  const parsed = JSON.parse(source) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function normalizeTestsScorecard(
  record: Record<string, unknown>,
  caseId: string,
): WorkbenchScorecard {
  const rawScore = typeof record.score === "number"
    ? record.score
    : typeof record.reward === "number"
      ? record.reward
      : undefined;
  if (rawScore === undefined || !Number.isFinite(rawScore)) {
    throw new Error("Tests scorer reward must include a finite numeric score or reward.");
  }
  const metrics = normalizeTestsMetrics(record, rawScore);
  return {
    score: rawScore,
    metrics,
    cases: [{
      id: caseId,
      status: "completed",
      metrics,
    }],
    ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
    feedback: {
      reward: record as Json,
    },
  };
}

function normalizeTestsMetrics(record: Record<string, unknown>, score: number): Record<string, number> {
  const metrics: Record<string, number> = { score };
  const source = record.metrics && typeof record.metrics === "object" && !Array.isArray(record.metrics)
    ? record.metrics as Record<string, unknown>
    : record;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      metrics[key === "reward" ? "score" : key] = value;
    }
  }
  return metrics;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function workloadFromAdapterOperationRequest(
  request: WorkbenchAdapterOperationRequest,
): AdapterWorkload {
  const context = request.context ?? {};
  const trial = context.trial ?? {};
  return {
    job: { id: request.jobId ?? request.id },
    benchmark: {
      name: context.benchmark?.name ?? "",
      description: context.benchmark?.description ?? "",
    },
    subject: {
      path: context.subject?.path ?? "",
    },
    optimizer: {
      edits: context.optimizer?.edits ?? [],
    },
    subjectId: context.subject?.id ?? "",
    trialIndex: trial.trialIndex ?? 0,
    sampleIndex: trial.sampleIndex ?? 0,
    caseId: trial.caseId ?? "",
    ...(context.task?.text ? { task: { task: context.task.text } } : {}),
  };
}

function isBuiltInAgentAdapterId(
  value: string,
): value is Extract<WorkbenchBuiltInAdapterId, "codex" | "claude" | "pi"> {
  return value === "codex" || value === "claude" || value === "pi";
}

function builtInAgentSpecFromRequest(
  request: WorkbenchAdapterOperationRequest,
): BuiltInAgentAdapterSpec {
  const config = adapterCommandConfigRecord(request);
  return {
    agent: agentProviderFromAdapterCommandRequest(request),
    ...(typeof config.instructions === "string" && config.instructions.length > 0
      ? { instructions: config.instructions }
      : {}),
  };
}

function builtInRubricSpecFromRequest(
  request: WorkbenchAdapterOperationRequest,
): BuiltInRubricAdapterSpec {
  const config = adapterCommandConfigRecord(request);
  return {
    judge: rubricJudgeProviderFromAdapterCommandRequest(request),
    ...(typeof config.instructions === "string" && config.instructions.length > 0
      ? { instructions: config.instructions }
      : {}),
    criteria: rubricCriteria(config.criteria, "adapter.with.criteria"),
  };
}

function agentProviderFromAdapterCommandRequest(
  request: WorkbenchAdapterOperationRequest,
): AgentProviderSpec {
  const config = adapterCommandConfigRecord(request);
  return {
    use: request.invocation.use,
    ...(typeof config.model === "string" && config.model.length > 0
      ? { model: config.model }
      : {}),
    ...(typeof config.effort === "string" && config.effort.length > 0
      ? { effort: config.effort }
      : {}),
  };
}

function rubricJudgeProviderFromAdapterCommandRequest(
  request: WorkbenchAdapterOperationRequest,
): AgentProviderSpec {
  const judge = jsonRecord(adapterCommandConfigRecord(request).judge);
  const use = typeof judge?.use === "string" && judge.use.length > 0
    ? judge.use
    : "";
  if (!use) {
    throw new Error("Rubric adapter requires adapter.with.judge.use.");
  }
  const config = jsonRecord(judge?.with) ?? {};
  return {
    use,
    ...(typeof config.model === "string" && config.model.length > 0
      ? { model: config.model }
      : {}),
    ...(typeof config.effort === "string" && config.effort.length > 0
      ? { effort: config.effort }
      : {}),
  };
}

function adapterCommandConfigRecord(
  request: WorkbenchAdapterOperationRequest,
): Record<string, Json> {
  return jsonRecord(request.invocation.with);
}

function requiredAdapterCommandString(
  request: WorkbenchAdapterOperationRequest,
  key: string,
): string {
  const value = adapterCommandConfigRecord(request)[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Adapter ${request.invocation.use} requires invocation.with.${key}.`);
  }
  return value;
}

async function writeAgentRunnerOutput(
  request: WorkbenchAdapterOperationRequest,
  workload: AdapterWorkload,
  runner: BuiltInAgentAdapterSpec,
  options: {
    agentExecutor?: WorkbenchAgentTurnExecutor;
    adapterAuthRoot?: string;
    adapterAuthRequest?: Json;
    adapterAuthEnv?: Record<string, string>;
  } = {},
): Promise<void> {
  if (request.operation !== "subject.run") {
    throw new Error("Agent runner results can only complete subject.run operations.");
  }
  const traceRoot = path.join(request.paths.output, ".workbench", "internal", "agent-runner");
  const agentResult = await executeWorkbenchAgentTurn(
    options.agentExecutor ?? defaultWorkbenchAgentTurnExecutor,
    {
      role: "runner",
      provider: runner.agent,
      adapterAuthRoot: options.adapterAuthRoot,
      adapterAuthRequest: options.adapterAuthRequest,
      adapterAuthEnv: options.adapterAuthEnv,
      workspaceRoot: request.paths.workspace,
      cwd: request.paths.cwd ?? request.paths.workspace,
      prompt: buildAgentRunnerPrompt(workload, runner),
      traceRoot,
      jobId: workload.job.id,
    },
  );
  const outputPath = path.join(request.paths.output, "runner-summary.md");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, agentResult.output);
  const trace: SurfaceSnapshotFile = {
    path: `.workbench/traces/${workload.job.id}/runner.json`,
    kind: "text",
    encoding: "utf8",
    executable: false,
    content: `${JSON.stringify({
      kind: "agent_runner",
      provider: runner.agent.use,
      subjectId: workload.subjectId,
      trialIndex: workload.trialIndex,
      sampleIndex: workload.sampleIndex,
      summary: agentResult.output,
      metadata: agentResult.metadata,
    }, null, 2)}\n`,
  };
  await writeSurfaceFiles(request.paths.output, [trace, ...agentResult.traceFiles]);
  const runtime = await importWorkbenchRuntime();
  const usage = runtime.assignUsageRole("runner", agentResult.usage);
  await writeWorkbenchAdapterOperationResult(request.paths.output, {
    protocol: "workbench.adapter-result.v1",
    operation: "subject.run",
    ok: true,
    ...(agentResult.output ? { summary: agentResult.output } : {}),
    feedback: {
      runner: "agent",
      agent: runner.agent.use,
      metadata: agentResult.metadata,
    },
    ...(usage ? { usage } : {}),
  });
}

function buildAgentRunnerPrompt(
  workload: AdapterWorkload,
  runner: BuiltInAgentAdapterSpec,
): string {
  return [
    ...(runner.instructions ? ["Instructions:", runner.instructions, ""] : []),
    "Context:",
    "- Subject files are mounted at /workspace/input/subject.",
    "- Subject files are also present in the task working directory.",
    ...(workload.task?.task ? ["Task:", workload.task.task, ""] : []),
    "- Public task files are already copied into the current working directory.",
    "- Verifier tests are not present while you run.",
    "- Mutate the current working directory to complete the task.",
    "- You may write inspection artifacts under /workspace/output.",
  ].join("\n");
}

async function writeAgentProposalOutput(
  request: WorkbenchAdapterOperationRequest,
  workload: AdapterWorkload,
  optimizer: BuiltInAgentAdapterSpec,
  options: {
    agentExecutor?: WorkbenchAgentTurnExecutor;
    adapterAuthRoot?: string;
    adapterAuthRequest?: Json;
    adapterAuthEnv?: Record<string, string>;
  },
): Promise<void> {
  if (request.operation !== "subject.improve") {
    throw new Error("Agent proposal results can only complete subject.improve operations.");
  }
  const traceRoot = path.join(request.paths.output, ".workbench", "internal", "agent-optimizer");
  const agentResult = await executeWorkbenchAgentTurn(
    options.agentExecutor ?? defaultWorkbenchAgentTurnExecutor,
    {
      role: "optimizer",
      provider: optimizer.agent,
      adapterAuthRoot: options.adapterAuthRoot,
      adapterAuthRequest: options.adapterAuthRequest,
      adapterAuthEnv: options.adapterAuthEnv,
      workspaceRoot: request.paths.workspace,
      cwd: request.paths.cwd ?? request.paths.workspace,
      prompt: buildAgentOptimizerPrompt(workload),
      traceRoot,
      jobId: workload.job.id,
    },
  );
  const subjectPatch = await createSubjectPatchFromWorkspace({
    beforeRoot: request.paths.subject ?? path.join(request.paths.input ?? request.paths.workspace, "subject"),
    afterRoot: request.paths.cwd ?? request.paths.workspace,
    edits: workload.optimizer.edits,
  });
  const changedSubjectPaths = subjectPatch.fileChanges.filter((filePath) =>
    isSubjectEditPath(filePath, workload.optimizer.edits),
  );
  if (changedSubjectPaths.length === 0) {
    throw new Error("Agent improve adapter completed without changing a subject file covered by optimizer edits.");
  }
  const trace: SurfaceSnapshotFile = {
    path: `.workbench/traces/${workload.job.id}/optimizer.json`,
    kind: "text",
    encoding: "utf8",
    executable: false,
    content: `${JSON.stringify({
      kind: "agent_optimizer",
      provider: optimizer.agent.use,
      subjectId: workload.subjectId,
      trialIndex: workload.trialIndex,
      changedPaths: changedSubjectPaths,
      summary: agentResult.output,
      metadata: agentResult.metadata,
    }, null, 2)}\n`,
  };
  await writeSurfaceFiles(request.paths.output, [trace, ...agentResult.traceFiles]);
  const runtime = await importWorkbenchRuntime();
  const usage = runtime.assignUsageRole("optimizer", agentResult.usage);
  await writeWorkbenchAdapterOperationResult(request.paths.output, {
    protocol: "workbench.adapter-result.v1",
    operation: "subject.improve",
    ok: true,
    value: {
      ...subjectPatch,
      fileChanges: changedSubjectPaths,
    },
    ...(agentResult.output ? { summary: agentResult.output } : {}),
    feedback: {
      optimizer: optimizer.agent.use,
      changedPaths: changedSubjectPaths,
      metadata: agentResult.metadata,
    },
    ...(usage ? { usage } : {}),
  });
}

function buildAgentOptimizerPrompt(workload: AdapterWorkload): string {
  return [
    "Benchmark:",
    workload.benchmark.description || workload.benchmark.name,
    "",
    "Context:",
    "- Subject files are mounted at /workspace/input/subject.",
    "- Subject files are also present in the current working directory.",
    "- Prior run traces are mounted at /workspace/input/traces.",
    "- Use /workspace/input/traces as the source of truth for what happened in prior attempts.",
    "- Do not mutate /workspace/input.",
    "",
    "Editable subject paths:",
    workload.optimizer.edits.map((entry) => `- ${entry}`).join("\n"),
    "",
    "Output:",
    "- Mutate the editable subject files directly in the current working directory.",
    "- Include at least one changed subject file covered by the optimizer edits list.",
  ].join("\n");
}

async function writeRubricJudgeScorecard(
  request: WorkbenchAdapterOperationRequest,
  workload: AdapterWorkload,
  scorer: BuiltInRubricAdapterSpec,
  options: {
    agentExecutor?: WorkbenchAgentTurnExecutor;
    adapterAuthRoot?: string;
    adapterAuthRequest?: Json;
    adapterAuthEnv?: Record<string, string>;
  } = {},
): Promise<void> {
  const agentExecutor = options.agentExecutor ?? defaultWorkbenchAgentTurnExecutor;
  const agentResult = await executeWorkbenchAgentTurn(agentExecutor, {
    role: "scorer",
    provider: scorer.judge,
    adapterAuthRoot: options.adapterAuthRoot,
    adapterAuthRequest: options.adapterAuthRequest,
    adapterAuthEnv: options.adapterAuthEnv,
    workspaceRoot: request.paths.workspace,
    cwd: request.paths.cwd ?? request.paths.workspace,
    prompt: buildRubricJudgePrompt(workload, scorer),
    traceRoot: path.join(request.paths.output, ".workbench", "internal", "rubric-scorer"),
    jobId: workload.job.id,
  });
  const runtime = await importWorkbenchRuntime();
  let usage = runtime.assignUsageRole("scorer", agentResult.usage);
  let scorecardAgentResult = agentResult;
  let scorecard: WorkbenchScorecard;
  try {
    scorecard = normalizeRubricJudgeScorecard(agentResult.output, workload, scorer, agentResult);
  } catch (error) {
    const repairError = error instanceof Error ? error.message : String(error);
    const repairResult = await executeWorkbenchAgentTurn(agentExecutor, {
      role: "scorer",
      provider: scorer.judge,
      adapterAuthRoot: options.adapterAuthRoot,
      adapterAuthRequest: options.adapterAuthRequest,
      adapterAuthEnv: options.adapterAuthEnv,
      workspaceRoot: request.paths.workspace,
      cwd: request.paths.workspace,
      prompt: buildRubricJudgeRepairPrompt({
        output: agentResult.output,
        error: repairError,
        workload,
        scorer,
      }),
      traceRoot: path.join(request.paths.output, ".workbench", "internal", "rubric-scorer-repair"),
      jobId: workload.job.id,
    });
    usage = runtime.mergeUsageSummaries([
      usage,
      runtime.assignUsageRole("scorer", repairResult.usage),
    ]);
    scorecardAgentResult = {
      ...repairResult,
      ...(usage ? { usage } : {}),
      metadata: {
        ...repairResult.metadata,
        repair: {
          attempted: true,
          originalError: repairError,
          originalMetadata: agentResult.metadata,
        },
      },
    };
    scorecard = normalizeRubricJudgeScorecard(repairResult.output, workload, scorer, scorecardAgentResult);
  }
  await writeWorkbenchAdapterOperationResult(request.paths.output, {
    protocol: "workbench.adapter-result.v1",
    operation: "trial.score",
    ok: true,
    value: scorecard,
    ...(typeof scorecard.summary === "string" ? { summary: scorecard.summary } : {}),
    feedback: {
      rubric: "judge",
      judge: scorer.judge.use,
      metadata: scorecardAgentResult.metadata,
    },
    ...(usage ? { usage } : {}),
  });
}

function buildRubricJudgePrompt(
  workload: AdapterWorkload,
  scorer: BuiltInRubricAdapterSpec,
): string {
  requireWorkloadTask(workload, "Rubric judge");
  return [
    ...(scorer.instructions ? ["Instructions:", scorer.instructions, ""] : []),
    ...(workload.task?.task ? ["Task:", workload.task.task, ""] : []),
    "Criteria:",
    JSON.stringify(scorer.criteria, null, 2),
    "",
    "Context:",
    "- The subject already ran in this same working directory.",
    "- Public task files and subject outputs are available in the current working directory.",
    "- Verifier-only files are mounted at /tests when the task provides them.",
    "- Score only from the current working directory, /tests, and the criteria above.",
    "",
    "Output:",
    "Return only a JSON object. Do not wrap it in Markdown.",
    "The JSON object must include a finite numeric score and one result for every criterion id. Use this shape:",
    JSON.stringify({
      score: 0.0,
      summary: "short grading summary",
      criteria: [{
        criterion_id: "criterion id",
        score: 0.0,
        pass: false,
        rationale: "why this criterion received this score",
      }],
      feedback: {},
    }, null, 2),
    "Allowed criterion ids:",
    scorer.criteria.map((criterion) => `- ${criterion.id}`).join("\n"),
    "Every criterion object must use one allowed criterion_id exactly and include a non-empty rationale string.",
  ].join("\n");
}

function buildRubricJudgeRepairPrompt(input: {
  output: string;
  error: string;
  workload: AdapterWorkload;
  scorer: BuiltInRubricAdapterSpec;
}): string {
  return [
    "The previous Workbench rubric judge response was rejected by the scorecard parser.",
    "",
    `Parser error: ${input.error}`,
    "",
    "Convert the previous response into one valid JSON object. Return only JSON, with no Markdown.",
    "Preserve the prior scores, criteria, rationales, and feedback whenever they are present.",
    "If the previous response uses clear qualitative scoring, convert only these terms: perfect/full pass/pass = 1, fail/no credit = 0, partial = 0.5.",
    "If a required criterion is still not recoverable from the previous response, include that criterion with score 0, pass false, and rationale \"The judge response did not provide a recoverable score and rationale for this criterion.\"",
    "Do not invent file paths, log paths, or extra criterion ids.",
    "",
    "Required JSON shape:",
    JSON.stringify({
      score: 0.0,
      summary: "short grading summary",
      criteria: [{
        criterion_id: "criterion id",
        score: 0.0,
        pass: false,
        rationale: "why this criterion received this score",
      }],
      feedback: {},
    }, null, 2),
    "",
    "Allowed criterion ids:",
    input.scorer.criteria.map((criterion) => `- ${criterion.id}`).join("\n"),
    "",
    "Previous response:",
    input.output,
  ].join("\n");
}

function normalizeRubricJudgeScorecard(
  output: string,
  workload: AdapterWorkload,
  scorer: BuiltInRubricAdapterSpec,
  agentResult: WorkbenchAgentTurnResult,
): WorkbenchScorecard {
  const parsed = parseAgentJsonObject(output, "Rubric judge");
  const parsedCriteria = normalizeRubricJudgeCriteria(
    parsed.criteria ?? parsed.criteria_results,
    scorer.criteria,
  );
  assertCompleteRubricCriteria(parsedCriteria, scorer.criteria);
  const explicitScore = isBoundedScore(parsed.score) ? parsed.score : undefined;
  const criteria = parsedCriteria;
  const score = explicitScore ?? weightedCriteriaScore(criteria, scorer.criteria);
  if (!isBoundedScore(score)) {
    throw new Error("Rubric judge output must include a score or criterion scores in the 0..1 range.");
  }
  const metrics: Record<string, number> = { score };
  for (const criterion of criteria) {
    metrics[`criterion__${criterion.criterion_id}`] = criterion.score;
  }
  const summary = typeof parsed.summary === "string" ? parsed.summary : undefined;
  const caseResult = rubricJudgeCaseResult({
    workload,
    score,
    criteria,
  });
  return {
    score,
    metrics,
    ...(summary ? { summary } : {}),
    cases: [caseResult],
    feedback: {
      judge: scorer.judge.use,
      ...(parsed.feedback !== undefined ? { detail: parsed.feedback as Json } : {}),
      metadata: agentResult.metadata,
    },
  };
}

function rubricJudgeCaseResult(args: {
  workload: AdapterWorkload;
  score: number;
  criteria: NonNullable<EvalCaseResult["criteria"]>;
}): EvalCaseResult {
  return {
    id: args.workload.caseId,
    status: "completed",
    metrics: { score: args.score },
    criteria: args.criteria,
  };
}

function normalizeRubricJudgeCriteria(
  value: unknown,
  specCriteria: readonly RubricCriterionSpec[],
): NonNullable<EvalCaseResult["criteria"]> {
  if (!Array.isArray(value)) {
    return [];
  }
  const knownIds = new Set(specCriteria.map((criterion) => criterion.id));
  return value.flatMap((entry): NonNullable<EvalCaseResult["criteria"]> => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const criterionId =
      typeof record.criterion_id === "string"
        ? record.criterion_id
        : typeof record.id === "string"
          ? record.id
          : "";
    if (!criterionId || (knownIds.size > 0 && !knownIds.has(criterionId))) {
      return [];
    }
    const score = isBoundedScore(record.score) ? record.score : undefined;
    if (score === undefined) {
      return [];
    }
    const pass = typeof record.pass === "boolean" ? record.pass : score >= 0.5;
    const rationale = readCriterionRationale(record);
    if (!rationale) {
      return [];
    }
    return [{
      criterion_id: criterionId,
      label: typeof record.label === "string" ? record.label : criterionId,
      score,
      pass,
      rationale,
    }];
  });
}

function assertCompleteRubricCriteria(
  criteria: readonly NonNullable<EvalCaseResult["criteria"]>[number][],
  specCriteria: readonly RubricCriterionSpec[],
): void {
  const scoredIds = new Set(criteria.map((criterion) => criterion.criterion_id));
  const missing = specCriteria
    .map((criterion) => criterion.id)
    .filter((criterionId) => !scoredIds.has(criterionId));
  if (missing.length > 0) {
    throw new Error(`Rubric judge output must include a score and rationale for every criterion id. Missing: ${missing.join(", ")}.`);
  }
}

function readCriterionRationale(record: Record<string, unknown>): string | undefined {
  for (const key of ["rationale", "feedback", "reason", "explanation"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function rubricCriteria(value: unknown, label: string): RubricCriterionSpec[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const record = jsonRecord(entry);
    const id = record.id;
    const description = record.description;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`Spec must include ${label}[${index}].id.`);
    }
    if (seen.has(id)) {
      throw new Error(`${label}[${index}].id duplicates another rubric criterion id.`);
    }
    seen.add(id);
    if (typeof description !== "string" || description.length === 0) {
      throw new Error(`Spec must include ${label}[${index}].description.`);
    }
    return {
      id,
      description,
      ...(typeof record.weight === "number" ? { weight: record.weight } : {}),
    };
  });
}

function requireWorkloadTask(workload: AdapterWorkload, label: string): void {
  if (!workload.task) {
    throw new Error(`${label} workload is missing task text.`);
  }
}

async function createSubjectPatchFromWorkspace(args: {
  beforeRoot: string;
  afterRoot: string;
  edits: readonly string[];
}): Promise<WorkbenchSubjectPatch> {
  const before = new Map(
    (await readSurfaceFilesRecursive(args.beforeRoot))
      .map((file) => [normalizeRelativePath(file.path), file]),
  );
  const changedFiles = (await readSurfaceFilesRecursive(args.afterRoot))
    .map((file) => ({ ...file, path: normalizeRelativePath(file.path) }))
    .filter((file) =>
      isSubjectEditPath(file.path, args.edits) &&
      !isRuntimeWorkspacePath(file.path) &&
      !sameSurfaceFile(before.get(file.path), file)
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    files: changedFiles,
    fileChanges: changedFiles.map((file) => file.path),
  };
}

function sameSurfaceFile(
  left: SurfaceSnapshotFile | undefined,
  right: SurfaceSnapshotFile,
): boolean {
  return !!left &&
    left.kind === right.kind &&
    left.encoding === right.encoding &&
    left.content === right.content &&
    left.executable === right.executable;
}

function isRuntimeWorkspacePath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  return normalized === ".workbench" ||
    normalized.startsWith(".workbench/") ||
    normalized === "input" ||
    normalized.startsWith("input/") ||
    normalized === "output" ||
    normalized.startsWith("output/") ||
    normalized === "logs" ||
    normalized.startsWith("logs/") ||
    normalized === "tests" ||
    normalized.startsWith("tests/");
}

async function writeSurfaceFiles(
  root: string,
  files: readonly SurfaceSnapshotFile[],
): Promise<void> {
  for (const file of files) {
    const target = path.join(root, normalizeRelativePath(file.path));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const body = file.encoding === "base64"
      ? Buffer.from(file.content, "base64")
      : Buffer.from(file.content, "utf8");
    await fs.writeFile(target, body);
    if (file.executable) {
      await fs.chmod(target, 0o755).catch(() => undefined);
    }
  }
}

function isSubjectEditPath(filePath: string, edits: readonly string[]): boolean {
  const normalized = normalizeRelativePath(filePath);
  return edits.some((entry) => {
    const editPath = normalizeRelativePath(entry).replace(/\/+$/u, "");
    return normalized === editPath || normalized.startsWith(`${editPath}/`);
  });
}

function normalizeRelativePath(filePath: string): string {
  const normalized = filePath.replace(/\\/gu, "/").replace(/^\/+/u, "");
  return normalized.split("/").filter(Boolean).join("/");
}

function parseAgentJsonObject(output: string, label: string): Record<string, unknown> {
  const trimmed = output.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error(`${label} output must be a JSON object.`);
  }
  let parsed: unknown;
  const jsonText = trimmed.slice(start, end + 1);
  try {
    parsed = parseAgentJsonText(jsonText);
  } catch (error) {
    throw new Error(`${label} output must parse as a JSON object: ${error instanceof Error ? error.message : String(error)}.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} output must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseAgentJsonText(jsonText: string): unknown {
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const repaired = repairInvalidJsonStringEscapes(jsonText);
    if (repaired !== jsonText) {
      try {
        return JSON.parse(repaired);
      } catch {
        // Preserve the original parse error; it points at the model output.
      }
    }
    throw error;
  }
}

function repairInvalidJsonStringEscapes(jsonText: string): string {
  let repaired = "";
  let inString = false;
  let escaped = false;
  for (const char of jsonText) {
    if (!inString) {
      repaired += char;
      if (char === "\"") {
        inString = true;
      }
      continue;
    }
    if (escaped) {
      repaired += isJsonEscapeCharacter(char) ? char : `\\${char}`;
      escaped = false;
      continue;
    }
    repaired += char;
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = false;
    }
  }
  if (escaped) {
    repaired += "\\";
  }
  return repaired;
}

function isJsonEscapeCharacter(char: string): boolean {
  return char === "\""
    || char === "\\"
    || char === "/"
    || char === "b"
    || char === "f"
    || char === "n"
    || char === "r"
    || char === "t"
    || char === "u";
}

function isBoundedScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function weightedCriteriaScore(
  criteria: readonly NonNullable<EvalCaseResult["criteria"]>[number][],
  specCriteria: readonly RubricCriterionSpec[],
): number | undefined {
  if (criteria.length === 0) {
    return undefined;
  }
  const weights = new Map(specCriteria.map((criterion) => [criterion.id, criterion.weight ?? 1]));
  let numerator = 0;
  let denominator = 0;
  for (const criterion of criteria) {
    const weight = weights.get(criterion.criterion_id) ?? 1;
    numerator += criterion.score * weight;
    denominator += weight;
  }
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : undefined;
}

function jsonRecord(value: unknown): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json>
    : {};
}

function isJsonPayload(value: unknown): value is Json {
  return value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    (Array.isArray(value) && value.every(isJsonPayload)) ||
    (typeof value === "object" && value !== null && Object.values(value).every(isJsonPayload));
}
