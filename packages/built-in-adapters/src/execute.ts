import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  EvalCaseResult,
  Json,
  SurfaceSnapshotFile,
  UsageSummary,
  WorkbenchResult,
  WorkbenchCandidatePatch,
} from "@workbench-ai/workbench-contract";
import {
  ensureWorkbenchAdapterOutputDir,
  readWorkbenchAdapterOperationResult,
  readWorkbenchAdapterOperationRequest,
  runWorkbenchRuntimeOperationSequence,
  writeWorkbenchAdapterOperationResult,
  workbenchAdapterOperationResultPath,
  type WorkbenchAdapterOperationRequest,
  type WorkbenchRuntimeControlOperationSequenceResult,
  type WorkbenchEngineCase,
} from "@workbench-ai/workbench-protocol";
import YAML from "yaml";

import type {
  AgentProviderSpec,
  WorkbenchAgentTurnExecutor,
  WorkbenchAgentTurnRequest,
  WorkbenchAgentTurnResult,
} from "./agent-turn.ts";
import {
  isWorkbenchBuiltInAdapterId,
  adapterCommandName,
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
  parallelism: number;
  criteria: RubricCriterionSpec[];
}

interface RubricCriterionSpec {
  id: string;
  description: string;
  weight?: number;
}

const TASK_CONTROL_FILE = "task.yaml";
const DEFAULT_RUBRIC_PARALLELISM = 4;

interface AdapterWorkload {
  job: { id: string };
  benchmark: {
    name: string;
    description: string;
  };
  candidate: {
    path: string;
  };
  improve: {
    edits: string[];
  };
  candidateId: string;
  attemptIndex: number;
  sampleIndex: number;
  caseId: string;
  case?: {
    prompt: string;
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
  if (adapterId === "workbench") {
    await executeWorkbenchEngineRequest(request);
    return;
  }
  if (adapterId === "command") {
    await executeCommandAdapterRequest(request);
    return;
  }
  if (adapterId === "tests") {
    await executeTestsEngineRequest(request);
    return;
  }
  if (adapterId === "rubric") {
    if (request.operation !== "engine.run") {
      throw new Error(`Rubric adapter cannot handle ${request.operation}.`);
    }
    await writeRubricJudgeResult(
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
    if (request.operation === "candidate.improve") {
      await writeAgentCandidateRevisionOutput(request, workload, agent, {
        agentExecutor: args.agentExecutor,
        adapterAuthRoot: args.adapterAuthRoot,
        adapterAuthRequest: args.adapterAuthRequest ?? request.auth,
        adapterAuthEnv: args.adapterAuthEnv,
      });
      return;
    }
    if (request.operation === "candidate.run") {
      await writeAgentCandidateOutput(request, workload, agent, {
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

async function executeWorkbenchEngineRequest(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  if (request.operation === "engine.resolve") {
    await executeWorkbenchEngineResolveRequest(request);
    return;
  }
  if (request.operation === "engine.run") {
    await executeWorkbenchEngineRunRequest(request);
    return;
  }
  throw new Error(`Workbench engine adapter cannot handle ${request.operation}.`);
}

async function executeWorkbenchEngineResolveRequest(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  const configuredPath = workbenchEngineTasksPath(request);
  const sourcePath = path.resolve(request.paths.workspace, configuredPath);
  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Workbench engine tasks path is not a directory: ${sourcePath}`);
  }
  const cases = await readEngineCasesFromWorkbenchTaskRoot(sourcePath);
  await writeWorkbenchAdapterOperationResult(request.paths.output, {
    protocol: "workbench.adapter-result.v1",
    operation: "engine.resolve",
    ok: true,
    value: { cases },
    summary: `Resolved Workbench engine cases from ${configuredPath}.`,
    feedback: {
      engineResolve: "workbench",
      path: configuredPath,
    },
  });
}

async function executeWorkbenchEngineRunRequest(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  const outcome = await workbenchEngineGradingIsolation(request) === "separate"
    ? await runWorkbenchEngineSeparateGrading(request)
    : await runWorkbenchEngineSharedGrading(request);
  if (!outcome.result) {
    throw new Error("Workbench engine scoring completed without an engine result.");
  }
  await writeSurfaceFiles(
    request.paths.output,
    outcome.files.map((file) => remapRuntimeControlTraceFile(request, file)),
  );
  const usage = await workbenchEngineOutcomeUsage(outcome);
  await writeWorkbenchAdapterOperationResult(request.paths.output, {
    protocol: "workbench.adapter-result.v1",
    operation: "engine.run",
    ok: true,
    value: outcome.result,
    ...(usage ? { usage } : {}),
    ...(outcome.summary !== undefined ? { summary: outcome.summary } : {}),
    ...(outcome.feedback !== undefined ? { feedback: outcome.feedback } : {}),
  });
}

async function workbenchEngineOutcomeUsage(
  outcome: WorkbenchRuntimeControlOperationSequenceResult,
): Promise<UsageSummary | undefined> {
  const runtime = await importWorkbenchRuntime();
  const operationUsage = outcome.usage
    ? undefined
    : runtime.mergeUsageSummaries(
      outcome.operationResults.map((result) => {
        if (result.operation === "candidate.run") {
          return runtime.assignUsageRole("runner", result.usage);
        }
        if (result.operation === "engine.run") {
          return runtime.assignUsageRole("engine", result.usage);
        }
        return result.usage;
      }),
    );
  const runtimeUsage = runtime.mergeUsageSummaries([outcome.usage, operationUsage]);
  const resultUsage = runtimeUsage?.engine
    ? undefined
    : runtime.assignUsageRole("engine", outcome.result?.usage);
  return runtime.mergeUsageSummaries([runtimeUsage, resultUsage]);
}

function workbenchEngineTasksPath(request: WorkbenchAdapterOperationRequest): string {
  const config = adapterCommandConfigRecord(request);
  const tasks = config.tasks;
  if (tasks === undefined) {
    return "tasks";
  }
  const taskConfig = jsonRecord(tasks);
  if (typeof taskConfig.path === "string" && taskConfig.path.trim().length > 0) {
    return taskConfig.path;
  }
  throw new Error("Workbench engine tasks must be an object with path.");
}

interface NestedAdapterInvocation {
  use: string;
  with: Json;
  auth?: Json;
  command: string;
}

function workbenchEngineScoreInvocation(request: WorkbenchAdapterOperationRequest): NestedAdapterInvocation {
  const score = jsonRecord(adapterCommandConfigRecord(request).score);
  if (!score || typeof score.use !== "string" || score.use.length === 0) {
    throw new Error("Workbench engine requires invocation.with.score.use.");
  }
  return {
    use: score.use,
    with: (score.with ?? {}) as Json,
    ...(score.auth !== undefined ? { auth: score.auth as Json } : {}),
    command: typeof score.command === "string" && score.command.length > 0
      ? score.command
      : adapterCommandName(score.use),
  };
}

function workbenchEngineCandidateInvocation(request: WorkbenchAdapterOperationRequest): NestedAdapterInvocation {
  const candidate = request.context?.candidate?.run;
  if (!candidate?.use || !candidate.command) {
    throw new Error("Workbench engine requires context.candidate.run.use and context.candidate.run.command.");
  }
  return {
    use: candidate.use,
    with: (candidate.with ?? {}) as Json,
    ...(candidate.auth !== undefined ? { auth: candidate.auth as Json } : {}),
    command: candidate.command,
  };
}

type WorkbenchEngineGradingIsolation = "shared" | "separate";

async function workbenchEngineGradingIsolation(
  request: WorkbenchAdapterOperationRequest,
): Promise<WorkbenchEngineGradingIsolation> {
  const grading = jsonRecord(adapterCommandConfigRecord(request).grading);
  const isolation = grading?.isolation;
  if (
    isolation !== undefined &&
    isolation !== "shared" &&
    isolation !== "separate"
  ) {
    throw new Error("Workbench engine grading.isolation must be shared or separate.");
  }
  if (await workbenchEnginePrivateFilesPresent(request)) {
    return "separate";
  }
  return isolation ?? "shared";
}

async function workbenchEnginePrivateFilesPresent(
  request: WorkbenchAdapterOperationRequest,
): Promise<boolean> {
  if (!request.paths.enginePrivate) {
    return false;
  }
  const files = await readOptionalSurfaceFiles(request.paths.enginePrivate);
  return files.length > 0;
}

async function runWorkbenchEngineSharedGrading(
  request: WorkbenchAdapterOperationRequest,
): Promise<WorkbenchRuntimeControlOperationSequenceResult> {
  const inputs = await workbenchEngineRuntimeInputs(request);
  const candidate = workbenchEngineCandidateInvocation(request);
  const score = workbenchEngineScoreInvocation(request);
  const result = await runWorkbenchRuntimeOperationSequence({
    inputs,
    prepare: true,
    operations: [
      { label: "candidate", operation: "candidate.run", invocation: candidate },
      { label: "score", operation: "engine.run", invocation: score },
    ],
  });
  assertRuntimeControlResultOk(result, "Workbench shared grading");
  return result;
}

async function runWorkbenchEngineSeparateGrading(
  request: WorkbenchAdapterOperationRequest,
): Promise<WorkbenchRuntimeControlOperationSequenceResult> {
  const inputs = await workbenchEngineRuntimeInputs(request);
  const candidate = workbenchEngineCandidateInvocation(request);
  const score = workbenchEngineScoreInvocation(request);
  const runtime = await importWorkbenchRuntime();
  const runner = await runWorkbenchRuntimeOperationSequence({
    inputs: {
      candidate: inputs.candidate,
      case: inputs.case,
      traces: inputs.traces,
    },
    prepare: true,
    collectWorkspace: true,
    operations: [
      { label: "candidate", operation: "candidate.run", invocation: candidate },
    ],
  });
  assertRuntimeControlResultOk(runner, "Workbench separate runner");
  const grader = await runWorkbenchRuntimeOperationSequence({
    inputs: {
      candidate: inputs.candidate,
      case: inputs.case,
      enginePrivate: inputs.enginePrivate,
      traces: inputs.traces,
      workspace: runner.workspaceFiles ?? [],
      output: runner.files.filter((file) => !runtime.isWorkbenchInternalOutputPath(file.path)),
    },
    prepare: false,
    operations: [
      { label: "score", operation: "engine.run", invocation: score },
    ],
  });
  assertRuntimeControlResultOk(grader, "Workbench separate grader");
  return {
    ...grader,
    files: dedupeSurfaceFiles([...runner.files, ...grader.files]),
    fileChanges: [...new Set([...runner.fileChanges, ...grader.fileChanges])].sort(),
    usage: runtime.mergeUsageSummaries([runner.usage, grader.usage]),
    operationResults: [...runner.operationResults, ...grader.operationResults],
  };
}

async function workbenchEngineRuntimeInputs(
  request: WorkbenchAdapterOperationRequest,
): Promise<NonNullable<Parameters<typeof runWorkbenchRuntimeOperationSequence>[0]["inputs"]>> {
  const [candidate, caseFiles, enginePrivate, traces] = await Promise.all([
    readOptionalSurfaceFiles(request.paths.candidate),
    readOptionalSurfaceFiles(request.paths.case),
    readOptionalSurfaceFiles(request.paths.enginePrivate),
    readOptionalSurfaceFiles(request.paths.traces),
  ]);
  return {
    candidate,
    case: caseFiles,
    enginePrivate,
    traces,
  };
}

async function readOptionalSurfaceFiles(root: string | undefined): Promise<SurfaceSnapshotFile[]> {
  if (!root) {
    return [];
  }
  return await readSurfaceFilesRecursive(root).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  });
}

function assertRuntimeControlResultOk(
  result: WorkbenchRuntimeControlOperationSequenceResult,
  label: string,
): void {
  if (result.ok) {
    return;
  }
  throw new Error(`${label} failed${result.error ? `: ${result.error}` : "."}`);
}

function dedupeSurfaceFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  const byPath = new Map<string, SurfaceSnapshotFile>();
  for (const file of files) {
    const normalized = normalizeRelativePath(file.path);
    byPath.set(normalized, {
      ...file,
      path: normalized,
    });
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function remapRuntimeControlTraceFile(
  request: WorkbenchAdapterOperationRequest,
  file: SurfaceSnapshotFile,
): SurfaceSnapshotFile {
  const normalized = normalizeRelativePath(file.path);
  if (!normalized.startsWith(".workbench/traces/")) {
    return { ...file, path: normalized };
  }
  const segments = normalized.split("/");
  const rest = segments.length >= 6
    ? segments.slice(5)
    : segments.length >= 3
      ? segments.slice(3)
      : [];
  if (rest.length === 0) {
    return { ...file, path: normalized };
  }
  return {
    ...file,
    path: `.workbench/traces/${request.jobId ?? request.id}/${rest.join("/")}`,
  };
}

function safeInternalPathSegment(value: string): string {
  const safe = value.replace(/[^a-z0-9._-]+/giu, "_").replace(/^_+|_+$/gu, "");
  return safe || "nested";
}

async function executeCommandAdapterRequest(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  const command = requiredAdapterCommandString(request, "command");
  const before = request.operation === "candidate.improve"
    ? await snapshotEditableCandidateWorkspace(request)
    : null;
  try {
    await runAdapterShellCommand(command, request.paths.workspace);
    if (request.operation === "engine.run") {
      await requireCommandScoreResult(request);
      return;
    }
    await writeOperationOkUnlessPresent(request, before?.root);
  } finally {
    await before?.cleanup();
  }
}

async function requireCommandScoreResult(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  if (!await fileExists(workbenchAdapterOperationResultPath(request.paths.output))) {
    throw new Error("Command engine must write workbench-result.json for engine.run.");
  }
  await readWorkbenchAdapterOperationResult(request.paths.output, "engine.run").catch((error: unknown) => {
    throw new Error(
      `Command engine wrote an invalid workbench-result.json for engine.run: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
}

async function executeTestsEngineRequest(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  if (request.operation !== "engine.run") {
    throw new Error(`Tests adapter cannot handle ${request.operation}.`);
  }
  const testsRoot = requiredRequestPath(request.paths.enginePrivate, "paths.enginePrivate");
  const verifierRoot = testsVerifierOutputDir(request.paths.output);
  await fs.rm(verifierRoot, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(verifierRoot, { recursive: true });
  const script = await firstExistingFile([
    path.join(testsRoot, "test.sh"),
    path.join(testsRoot, "run.sh"),
  ]);
  if (!script) {
    throw new Error(`Tests engine requires ${path.join(testsRoot, "test.sh")}.`);
  }
  await runAdapterShellCommand(`sh ${shellQuote(script)}`, request.paths.workspace, {
    WORKBENCH_TESTS_VERIFIER_DIR: verifierRoot,
  });
  const result = await readTestsResult({
    verifierRoot,
    caseId: request.context?.attempt?.caseId ?? "current",
  });
  await writeWorkbenchAdapterOperationResult(request.paths.output, {
    protocol: "workbench.adapter-result.v1",
    operation: "engine.run",
    ok: true,
    value: result,
    ...(typeof result.summary === "string" ? { summary: result.summary } : {}),
    feedback: {
      engine: "tests",
    },
  });
}

async function runAdapterShellCommand(
  command: string,
  cwd: string,
  env: Record<string, string> = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sh", ["-c", command], {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
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
  beforeRoot?: string,
): Promise<void> {
  if (await fileExists(workbenchAdapterOperationResultPath(request.paths.output))) {
    return;
  }
  if (request.operation === "candidate.improve") {
    const patch = await createCandidatePatchFromWorkspace({
      beforeRoot: beforeRoot ?? requiredRequestPath(request.paths.candidate, "paths.candidate"),
      afterRoot: request.paths.workspace,
      edits: request.context?.improve?.edits ?? [],
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

async function snapshotEditableCandidateWorkspace(
  request: WorkbenchAdapterOperationRequest,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-candidate-before-"));
  const edits = request.context?.improve?.edits ?? [];
  const files = await readEditableCandidateWorkspaceFiles(request.paths.workspace, edits);
  await writeSurfaceFiles(root, files);
  return {
    root,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

async function readEditableCandidateWorkspaceFiles(
  root: string,
  edits: readonly string[],
): Promise<SurfaceSnapshotFile[]> {
  const files: SurfaceSnapshotFile[] = [];
  for (const edit of edits) {
    const normalized = normalizeRelativePath(edit);
    if (!normalized || isRuntimeWorkspacePath(normalized)) {
      continue;
    }
    const absolutePath = path.join(root, normalized);
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat) {
      continue;
    }
    if (stat.isDirectory()) {
      await readSurfaceFilesInto(root, normalized, files);
      continue;
    }
    if (stat.isFile()) {
      files.push(await readSurfaceFile(root, normalized));
    }
  }
  return dedupeSurfaceFiles(files.filter((file) =>
    isCandidateEditPath(file.path, edits) &&
    !isRuntimeWorkspacePath(file.path)
  ));
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

function requiredRequestPath(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Adapter request ${label} is required.`);
  }
  return value;
}

async function readEngineCasesFromWorkbenchTaskRoot(
  tasksRoot: string,
): Promise<WorkbenchEngineCase[]> {
  const taskDirs = await listWorkbenchTaskDirectories(tasksRoot);
  if (taskDirs.length === 0) {
    throw new Error(`Engine resolve has no Workbench task packages: ${tasksRoot}`);
  }
  return await Promise.all(taskDirs.map(async (taskDir) =>
    readWorkbenchEngineCase({
      taskDir,
      id: path.basename(taskDir),
    })
  ));
}

async function listWorkbenchTaskDirectories(root: string): Promise<string[]> {
  if (await fileExists(path.join(root, TASK_CONTROL_FILE))) {
    throw new Error(`Workbench engine tasks root must contain task directories, not a direct ${TASK_CONTROL_FILE}: ${root}`);
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

async function readWorkbenchEngineCase(args: {
  taskDir: string;
  id: string;
}): Promise<WorkbenchEngineCase> {
  const sourceFiles = await readSurfaceFilesRecursive(args.taskDir);
  const taskFile = sourceFiles.find((file) =>
    normalizeRelativePath(file.path) === TASK_CONTROL_FILE && file.encoding === "utf8"
  );
  if (!taskFile) {
    throw new Error(`Task ${args.id} is missing ${TASK_CONTROL_FILE}.`);
  }
  const parsed = YAML.parse(taskFile.content) as unknown;
  const taskRecord = jsonRecord(parsed);
  if (taskRecord.version !== 3) {
    throw new Error(`Task ${args.id} ${TASK_CONTROL_FILE} version must be 3.`);
  }
  if (typeof taskRecord.task !== "string" || taskRecord.task.trim().length === 0) {
    throw new Error(`Task ${args.id} ${TASK_CONTROL_FILE} must include a task string.`);
  }
  const unsupportedTaskFields = Object.keys(taskRecord)
    .filter((key) => !["version", "task", "split", "files", "tests", "solution", "environment"].includes(key));
  if (unsupportedTaskFields.length > 0) {
    throw new Error(
      `Task ${args.id} ${TASK_CONTROL_FILE} has unsupported field${unsupportedTaskFields.length === 1 ? "" : "s"}: ${unsupportedTaskFields.join(", ")}.`,
    );
  }
  if (taskRecord.split !== undefined && (typeof taskRecord.split !== "string" || taskRecord.split.trim().length === 0)) {
    throw new Error(`Task ${args.id} ${TASK_CONTROL_FILE} split must be a non-empty string when provided.`);
  }
  const publicPrefix = taskDirectoryPrefix(taskRecord.files, "files", args.id);
  const testsPrefix = taskDirectoryPrefix(taskRecord.tests, "tests", args.id);
  const solutionPrefix = taskDirectoryPrefix(taskRecord.solution, "solution", args.id);
  const publicFiles = stripTaskDirectory(sourceFiles, publicPrefix);
  const privateFiles = [
    ...stripTaskDirectory(sourceFiles, testsPrefix),
    ...stripTaskDirectory(sourceFiles, solutionPrefix),
  ].sort((left, right) => left.path.localeCompare(right.path));
  assertWorkbenchTaskPackageLayout(args.id, sourceFiles, [
    publicPrefix,
    testsPrefix,
    solutionPrefix,
    "environment/",
  ]);
  return {
    id: normalizeRelativePath(args.id),
    case: {
      version: 3,
      prompt: taskRecord.task,
      ...(typeof taskRecord.split === "string" ? { split: taskRecord.split.trim() } : {}),
      ...(taskRecord.environment !== undefined
        ? { environment: taskRecord.environment as WorkbenchEngineCase["case"]["environment"] }
        : {}),
    },
    files: {
      public: publicFiles,
      private: privateFiles,
      source: sourceFiles,
    },
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
    result.push(await readSurfaceFile(root, relativePath));
  }
}

async function readSurfaceFile(
  root: string,
  relativePath: string,
): Promise<SurfaceSnapshotFile> {
  const absolutePath = path.join(root, normalizeRelativePath(relativePath));
  const [body, stat] = await Promise.all([
    fs.readFile(absolutePath),
    fs.stat(absolutePath),
  ]);
  const text = body.toString("utf8");
  const isUtf8 = Buffer.from(text, "utf8").equals(body);
  return {
    path: normalizeRelativePath(relativePath),
    kind: isUtf8 ? "text" : "binary",
    encoding: isUtf8 ? "utf8" : "base64",
    content: isUtf8 ? text : body.toString("base64"),
    executable: (stat.mode & 0o111) !== 0,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then((stat) => stat.isFile(), () => false);
}

async function readTestsResult(args: {
  verifierRoot: string;
  caseId: string;
}): Promise<WorkbenchResult> {
  const rewardJson = await readOptionalJson(path.join(args.verifierRoot, "reward.json"));
  if (rewardJson) {
    return normalizeTestsResult(rewardJson, args.caseId);
  }
  const rewardText = await fs.readFile(path.join(args.verifierRoot, "reward.txt"), "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (rewardText !== null) {
    const score = Number.parseFloat(rewardText.trim());
    if (!Number.isFinite(score)) {
      throw new Error("Tests engine reward.txt must contain a finite numeric reward.");
    }
    return normalizeTestsResult({ reward: score }, args.caseId);
  }
  throw new Error("Tests engine did not find reward.json or reward.txt under its verifier output directory.");
}

function testsVerifierOutputDir(outputRoot: string): string {
  return path.join(outputRoot, ".workbench", "internal", "verifier");
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

function normalizeTestsResult(
  record: Record<string, unknown>,
  caseId: string,
): WorkbenchResult {
  const rawScore = typeof record.score === "number"
    ? record.score
    : typeof record.reward === "number"
      ? record.reward
      : undefined;
  if (rawScore === undefined || !Number.isFinite(rawScore)) {
    throw new Error("Tests engine reward must include a finite numeric score or reward.");
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
  const attempt = context.attempt ?? {};
  return {
    job: { id: request.jobId ?? request.id },
    benchmark: {
      name: context.benchmark?.name ?? "",
      description: context.benchmark?.description ?? "",
    },
    candidate: {
      path: context.candidate?.path ?? "",
    },
    improve: {
      edits: context.improve?.edits ?? [],
    },
    candidateId: context.candidate?.id ?? "",
    attemptIndex: attempt.attemptIndex ?? 0,
    sampleIndex: attempt.sampleIndex ?? 0,
    caseId: attempt.caseId ?? "",
    ...(context.case?.prompt ? { case: { prompt: context.case.prompt } } : {}),
  };
}

function isBuiltInAgentAdapterId(
  value: string,
): value is Extract<WorkbenchBuiltInAdapterId, "codex" | "claude"> {
  return value === "codex" || value === "claude";
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
  const criteria = rubricCriteria(config.criteria, "adapter.with.criteria");
  return {
    judge: rubricJudgeProviderFromAdapterCommandRequest(request),
    ...(typeof config.instructions === "string" && config.instructions.length > 0
      ? { instructions: config.instructions }
      : {}),
    parallelism: rubricParallelism(config.parallelism, criteria.length),
    criteria,
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

async function executeBuiltInAgentTurn(
  executor: WorkbenchAgentTurnExecutor | undefined,
  request: WorkbenchAgentTurnRequest,
): Promise<WorkbenchAgentTurnResult> {
  const {
    defaultWorkbenchAgentTurnExecutor,
    executeWorkbenchAgentTurn,
  } = await import("./agent-turn.ts");
  return await executeWorkbenchAgentTurn(executor ?? defaultWorkbenchAgentTurnExecutor, request);
}

async function writeAgentCandidateOutput(
  request: WorkbenchAdapterOperationRequest,
  workload: AdapterWorkload,
  candidate: BuiltInAgentAdapterSpec,
  options: {
    agentExecutor?: WorkbenchAgentTurnExecutor;
    adapterAuthRoot?: string;
    adapterAuthRequest?: Json;
    adapterAuthEnv?: Record<string, string>;
  } = {},
): Promise<void> {
  if (request.operation !== "candidate.run") {
    throw new Error("Agent candidate results can only complete candidate.run operations.");
  }
  const traceRoot = path.join(request.paths.output, ".workbench", "internal", "agent-candidate");
  const agentResult = await executeBuiltInAgentTurn(options.agentExecutor, {
    role: "runner",
    provider: candidate.agent,
    adapterAuthRoot: options.adapterAuthRoot,
    adapterAuthRequest: options.adapterAuthRequest,
    adapterAuthEnv: options.adapterAuthEnv,
    workspaceRoot: request.paths.workspace,
    cwd: request.paths.workspace,
    prompt: buildAgentCandidatePrompt(workload, candidate),
    traceRoot,
    jobId: workload.job.id,
  });
  const outputPath = path.join(request.paths.output, "candidate-summary.md");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, agentResult.output);
  const trace: SurfaceSnapshotFile = {
    path: `.workbench/traces/${workload.job.id}/candidate.json`,
    kind: "text",
    encoding: "utf8",
    executable: false,
    content: `${JSON.stringify({
      kind: "agent_candidate",
      provider: candidate.agent.use,
      candidateId: workload.candidateId,
      attemptIndex: workload.attemptIndex,
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
    operation: "candidate.run",
    ok: true,
    ...(agentResult.output ? { summary: agentResult.output } : {}),
    feedback: {
      candidate: "agent",
      agent: candidate.agent.use,
      metadata: agentResult.metadata,
    },
    ...(usage ? { usage } : {}),
  });
}

function buildAgentCandidatePrompt(
  workload: AdapterWorkload,
  candidate: BuiltInAgentAdapterSpec,
): string {
  return [
    ...(candidate.instructions ? ["Instructions:", candidate.instructions, ""] : []),
    "Context:",
    "- Candidate source files are mounted at /workspace/input/candidate.",
    "- Follow any candidate guidance, skill files, scripts, or configuration under /workspace/input/candidate.",
    "- The mutable working directory is /workspace.",
    "- If the candidate declares prepare.command, it has already run and may have copied files into /workspace.",
    ...(workload.case?.prompt ? ["Case:", workload.case.prompt, ""] : []),
    "- Public case files are mounted at /workspace/input/case.",
    "- Verifier tests are not present while you run.",
    "- Mutate the current working directory to complete the task.",
    "- You may write inspection artifacts under /workspace/output.",
  ].join("\n");
}

async function writeAgentCandidateRevisionOutput(
  request: WorkbenchAdapterOperationRequest,
  workload: AdapterWorkload,
  improver: BuiltInAgentAdapterSpec,
  options: {
    agentExecutor?: WorkbenchAgentTurnExecutor;
    adapterAuthRoot?: string;
    adapterAuthRequest?: Json;
    adapterAuthEnv?: Record<string, string>;
  },
): Promise<void> {
  if (request.operation !== "candidate.improve") {
    throw new Error("Agent improve results can only complete candidate.improve operations.");
  }
  const before = await snapshotEditableCandidateWorkspace(request);
  const traceRoot = path.join(request.paths.output, ".workbench", "internal", "agent-improver");
  try {
    const agentResult = await executeBuiltInAgentTurn(options.agentExecutor, {
      role: "improver",
      provider: improver.agent,
      adapterAuthRoot: options.adapterAuthRoot,
      adapterAuthRequest: options.adapterAuthRequest,
      adapterAuthEnv: options.adapterAuthEnv,
      workspaceRoot: request.paths.workspace,
      cwd: request.paths.workspace,
      prompt: buildAgentImproverPrompt(workload),
      traceRoot,
      jobId: workload.job.id,
    });
    const candidatePatch = await createCandidatePatchFromWorkspace({
      beforeRoot: before.root,
      afterRoot: request.paths.workspace,
      edits: workload.improve.edits,
    });
    const changedCandidatePaths = candidatePatch.fileChanges.filter((filePath) =>
      isCandidateEditPath(filePath, workload.improve.edits),
    );
    if (changedCandidatePaths.length === 0) {
      throw new Error("Agent improve adapter completed without changing a candidate file covered by improve edits.");
    }
    const trace: SurfaceSnapshotFile = {
      path: `.workbench/traces/${workload.job.id}/improver.json`,
      kind: "text",
      encoding: "utf8",
      executable: false,
      content: `${JSON.stringify({
        kind: "agent_improver",
        provider: improver.agent.use,
        candidateId: workload.candidateId,
        attemptIndex: workload.attemptIndex,
        changedPaths: changedCandidatePaths,
        summary: agentResult.output,
        metadata: agentResult.metadata,
      }, null, 2)}\n`,
    };
    await writeSurfaceFiles(request.paths.output, [trace, ...agentResult.traceFiles]);
    const runtime = await importWorkbenchRuntime();
    const usage = runtime.assignUsageRole("improver", agentResult.usage);
    await writeWorkbenchAdapterOperationResult(request.paths.output, {
      protocol: "workbench.adapter-result.v1",
      operation: "candidate.improve",
      ok: true,
      value: {
        ...candidatePatch,
        fileChanges: changedCandidatePaths,
      },
      ...(agentResult.output ? { summary: agentResult.output } : {}),
      feedback: {
        improver: improver.agent.use,
        changedPaths: changedCandidatePaths,
        metadata: agentResult.metadata,
      },
      ...(usage ? { usage } : {}),
    });
  } finally {
    await before.cleanup();
  }
}

function buildAgentImproverPrompt(workload: AdapterWorkload): string {
  return [
    "Benchmark:",
    workload.benchmark.description || workload.benchmark.name,
    "",
    "Improve the candidate for this benchmark.",
    "",
    "Candidate files are in the current directory.",
    "Prior adapter executions are in /workspace/input/traces.",
    "",
    "Editable paths:",
    workload.improve.edits.map((entry) => `- ${entry}`).join("\n"),
    "",
    "Rules:",
    "- Modify only editable paths.",
    "- Change at least one editable file.",
  ].join("\n");
}

async function writeRubricJudgeResult(
  request: WorkbenchAdapterOperationRequest,
  workload: AdapterWorkload,
  engine: BuiltInRubricAdapterSpec,
  options: {
    agentExecutor?: WorkbenchAgentTurnExecutor;
    adapterAuthRoot?: string;
    adapterAuthRequest?: Json;
    adapterAuthEnv?: Record<string, string>;
  } = {},
): Promise<void> {
  const agentExecutor = options.agentExecutor;
  const runtime = await importWorkbenchRuntime();
  const criterionRuns = await mapWithConcurrency(
    engine.criteria,
    engine.parallelism,
    async (criterion) => runRubricCriterionJudge({
      request,
      workload,
      engine,
      criterion,
      agentExecutor,
      adapterAuthRoot: options.adapterAuthRoot,
      adapterAuthRequest: options.adapterAuthRequest,
      adapterAuthEnv: options.adapterAuthEnv,
      runtime,
    }),
  );
  const usage = runtime.mergeUsageSummaries(criterionRuns.map((run) => run.usage));
  const result = rubricJudgeResultFromCriteria({
    workload,
    engine,
    criterionRuns,
  });
  await writeRubricEvidenceFiles({
    request,
    workload,
    engine,
    result,
    criterionRuns,
    usage,
  });
  await writeWorkbenchAdapterOperationResult(request.paths.output, {
    protocol: "workbench.adapter-result.v1",
    operation: "engine.run",
    ok: true,
    value: result,
    ...(typeof result.summary === "string" ? { summary: result.summary } : {}),
    feedback: {
      rubric: "criterion-fanout",
      judge: engine.judge.use,
      parallelism: engine.parallelism,
      aggregation: "weighted_mean",
      criteria: criterionRuns.map((run) => ({
        id: run.result.criterion_id,
        traceFiles: run.traceFiles.map((file) => file.path),
        metadata: run.metadata as Json,
        ...(run.repair ? { repair: run.repair } : {}),
      })),
    },
    ...(usage ? { usage } : {}),
  });
}

interface RubricCriterionJudgeRun {
  result: NonNullable<EvalCaseResult["criteria"]>[number];
  summary?: string;
  feedback?: Json;
  metadata: WorkbenchAgentTurnResult["metadata"];
  traceFiles: SurfaceSnapshotFile[];
  repair?: {
    attempted: true;
    originalError: string;
  };
  usage?: UsageSummary;
}

async function writeRubricEvidenceFiles(args: {
  request: WorkbenchAdapterOperationRequest;
  workload: AdapterWorkload;
  engine: BuiltInRubricAdapterSpec;
  result: WorkbenchResult;
  criterionRuns: readonly RubricCriterionJudgeRun[];
  usage?: UsageSummary;
}): Promise<void> {
  const root = `.workbench/traces/${args.workload.job.id}/engine/rubric`;
  const scorecard = {
    schema: "workbench.engine.rubric.evidence.v1",
    safeForImprover: true,
    jobId: args.workload.job.id,
    candidateId: args.workload.candidateId,
    attemptIndex: args.workload.attemptIndex,
    sampleIndex: args.workload.sampleIndex,
    caseId: args.workload.caseId,
    judge: args.engine.judge.use,
    parallelism: args.engine.parallelism,
    aggregation: "weighted_mean",
    score: args.result.score,
    metrics: args.result.metrics ?? {},
    summary: args.result.summary ?? null,
    criteria: args.criterionRuns.map((run) => ({
      id: run.result.criterion_id,
      label: run.result.label,
      score: run.result.score,
      pass: run.result.pass,
      rationale: run.result.rationale ?? null,
      errors: run.result.errors ?? [],
      summary: run.summary ?? null,
      metadata: safeRubricEvidenceMetadata(run.metadata),
      repair: run.repair ?? null,
    })),
    ...(args.usage ? { usage: args.usage } : {}),
  };
  await writeSurfaceFiles(args.request.paths.output, [
    jsonSurfaceFile(`${root}/scorecard.json`, scorecard),
    ...args.criterionRuns.map((run) =>
      jsonSurfaceFile(`${root}/criteria/${safeInternalPathSegment(run.result.criterion_id)}/result.json`, {
        schema: "workbench.engine.rubric.criterion-evidence.v1",
        safeForImprover: true,
        criterion: args.engine.criteria.find((criterion) => criterion.id === run.result.criterion_id) ?? {
          id: run.result.criterion_id,
        },
        result: run.result,
        summary: run.summary ?? null,
        metadata: safeRubricEvidenceMetadata(run.metadata),
        repair: run.repair ?? null,
      })
    ),
    ...args.criterionRuns.flatMap((run) => run.traceFiles),
  ]);
}

function safeRubricEvidenceMetadata(metadata: WorkbenchAgentTurnResult["metadata"]): Json | null {
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
  const safe: Record<string, Json> = {};
  for (const key of ["providerId", "sessionId", "eventCount", "model"] as const) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      safe[key] = value;
    }
  }
  return Object.keys(safe).length > 0 ? safe as Json : null;
}

function jsonSurfaceFile(pathname: string, value: unknown): SurfaceSnapshotFile {
  return {
    path: pathname,
    kind: "text",
    encoding: "utf8",
    executable: false,
    content: `${JSON.stringify(value, null, 2)}\n`,
  };
}

async function runRubricCriterionJudge(args: {
  request: WorkbenchAdapterOperationRequest;
  workload: AdapterWorkload;
  engine: BuiltInRubricAdapterSpec;
  criterion: RubricCriterionSpec;
  agentExecutor?: WorkbenchAgentTurnExecutor;
  adapterAuthRoot?: string;
  adapterAuthRequest?: Json;
  adapterAuthEnv?: Record<string, string>;
  runtime: Awaited<ReturnType<typeof importWorkbenchRuntime>>;
}): Promise<RubricCriterionJudgeRun> {
  const traceRoot = path.join(
    args.request.paths.output,
    ".workbench",
    "internal",
    "rubric",
    safeInternalPathSegment(args.criterion.id),
  );
  const tracePath = rubricCriterionTracePath(args.workload.job.id, args.criterion.id, "judge");
  const agentResult = await executeBuiltInAgentTurn(args.agentExecutor, {
    role: "engine",
    provider: args.engine.judge,
    adapterAuthRoot: args.adapterAuthRoot,
    adapterAuthRequest: args.adapterAuthRequest,
    adapterAuthEnv: args.adapterAuthEnv,
    workspaceRoot: args.request.paths.workspace,
    cwd: args.request.paths.workspace,
    prompt: buildRubricCriterionJudgePrompt(args.workload, args.engine, args.criterion),
    traceRoot: path.join(traceRoot, "judge"),
    tracePath,
    jobId: args.workload.job.id,
  });
  let usage = args.runtime.assignUsageRole("engine", agentResult.usage);
  try {
    return {
      ...normalizeRubricCriterionJudgeResult(agentResult.output, args.criterion),
      metadata: agentResult.metadata,
      traceFiles: publicRubricAgentTraceFiles(agentResult.traceFiles),
      ...(usage ? { usage } : {}),
    };
  } catch (error) {
    const repairError = error instanceof Error ? error.message : String(error);
    const repairTracePath = rubricCriterionTracePath(args.workload.job.id, args.criterion.id, "repair");
    const repairResult = await executeBuiltInAgentTurn(args.agentExecutor, {
      role: "engine",
      provider: args.engine.judge,
      adapterAuthRoot: args.adapterAuthRoot,
      adapterAuthRequest: args.adapterAuthRequest,
      adapterAuthEnv: args.adapterAuthEnv,
      workspaceRoot: args.request.paths.workspace,
      cwd: args.request.paths.workspace,
      prompt: buildRubricCriterionRepairPrompt({
        output: agentResult.output,
        error: repairError,
        criterion: args.criterion,
      }),
      traceRoot: path.join(traceRoot, "repair"),
      tracePath: repairTracePath,
      jobId: args.workload.job.id,
    });
    usage = args.runtime.mergeUsageSummaries([
      usage,
      args.runtime.assignUsageRole("engine", repairResult.usage),
    ]);
    return {
      ...normalizeRubricCriterionJudgeResult(repairResult.output, args.criterion),
      metadata: {
        ...repairResult.metadata,
        repair: {
          attempted: true,
          originalError: repairError,
          originalMetadata: agentResult.metadata,
        },
      },
      traceFiles: publicRubricAgentTraceFiles([
        ...agentResult.traceFiles,
        ...repairResult.traceFiles,
      ]),
      repair: {
        attempted: true,
        originalError: repairError,
      },
      ...(usage ? { usage } : {}),
    };
  }
}

function publicRubricAgentTraceFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  return files
    .filter((file) => file.encoding === "utf8" && file.path.endsWith("/trace.json"))
    .map((file) => ({ ...file }));
}

function rubricCriterionTracePath(
  jobId: string,
  criterionId: string,
  turn: "judge" | "repair",
): string {
  return `.workbench/traces/${jobId}/engine/rubric/criteria/${safeInternalPathSegment(criterionId)}/${turn}`;
}

function buildRubricCriterionJudgePrompt(
  workload: AdapterWorkload,
  engine: BuiltInRubricAdapterSpec,
  criterion: RubricCriterionSpec,
): string {
  requireWorkloadTask(workload, "Rubric judge");
  return [
    ...(engine.instructions ? ["Instructions:", engine.instructions, ""] : []),
    ...(workload.case?.prompt ? ["Case:", workload.case.prompt, ""] : []),
    "Criterion:",
    JSON.stringify(criterion, null, 2),
    "",
    "Context:",
    "- The candidate already ran in this same working directory.",
    "- Candidate outputs are available in the current working directory.",
    "- Public case files are mounted at /workspace/input/case.",
    "- Verifier-private files are mounted at /workspace/private/engine when the task provides them.",
    "- Score only from the current working directory, public case files, verifier-private files, and the criterion above.",
    "",
    "Output:",
    "Return only a JSON object. Do not wrap it in Markdown.",
    "The JSON object must score exactly this one criterion. Use this shape:",
    JSON.stringify({
      criterion_id: criterion.id,
      score: 0.0,
      pass: false,
      rationale: "why this criterion received this score",
      summary: "short scoring summary",
      feedback: {},
    }, null, 2),
    `The only allowed criterion_id is ${criterion.id}.`,
    "The rationale must be non-empty and specific to this criterion.",
  ].join("\n");
}

function buildRubricCriterionRepairPrompt(input: {
  output: string;
  error: string;
  criterion: RubricCriterionSpec;
}): string {
  return [
    "The previous Workbench rubric criterion judge response was rejected by the result parser.",
    "",
    `Parser error: ${input.error}`,
    "",
    "Convert the previous response into one valid JSON object. Return only JSON, with no Markdown.",
    "Preserve the prior score, rationale, and feedback whenever they are present.",
    "If the previous response uses clear qualitative scoring, convert only these terms: perfect/full pass/pass = 1, fail/no credit = 0, partial = 0.5.",
    "If the required score is still not recoverable from the previous response, use score 0, pass false, and rationale \"The judge response did not provide a recoverable score and rationale for this criterion.\"",
    "Do not invent file paths, log paths, or extra criterion ids.",
    "",
    "Criterion:",
    JSON.stringify(input.criterion, null, 2),
    "",
    "Required JSON shape:",
    JSON.stringify({
      criterion_id: input.criterion.id,
      score: 0.0,
      pass: false,
      rationale: "why this criterion received this score",
      summary: "short scoring summary",
      feedback: {},
    }, null, 2),
    "",
    `The only allowed criterion_id is ${input.criterion.id}.`,
    "",
    "Previous response:",
    input.output,
  ].join("\n");
}

function rubricJudgeResultFromCriteria(args: {
  workload: AdapterWorkload;
  engine: BuiltInRubricAdapterSpec;
  criterionRuns: readonly RubricCriterionJudgeRun[];
}): WorkbenchResult {
  const criteria = args.criterionRuns.map((run) => run.result);
  const score = weightedCriteriaScore(criteria, args.engine.criteria);
  if (!isBoundedScore(score)) {
    throw new Error("Rubric criterion scores must aggregate to a score in the 0..1 range.");
  }
  const metrics: Record<string, number> = { score };
  const caseResult = rubricJudgeCaseResult({
    workload: args.workload,
    score,
    criteria,
  });
  const passed = criteria.filter((criterion) => criterion.pass).length;
  return {
    score,
    metrics,
    summary: `Rubric judged ${criteria.length} criteria (${passed} passed).`,
    cases: [caseResult],
    feedback: {
      judge: args.engine.judge.use,
      rubric: {
        parallelism: args.engine.parallelism,
        aggregation: "weighted_mean",
        criteria: args.criterionRuns.map((run) => ({
          id: run.result.criterion_id,
          score: run.result.score,
          pass: run.result.pass,
          ...(run.summary ? { summary: run.summary } : {}),
          ...(run.feedback !== undefined ? { feedback: run.feedback } : {}),
          metadata: run.metadata as Json,
          ...(run.repair ? { repair: run.repair } : {}),
        })),
      },
    },
  };
}

function normalizeRubricCriterionJudgeResult(
  output: string,
  criterion: RubricCriterionSpec,
): Omit<RubricCriterionJudgeRun, "metadata" | "traceFiles" | "repair" | "usage"> {
  const parsed = parseAgentJsonObject(output, "Rubric judge");
  const result = normalizeRubricCriterionObject(parsed, criterion);
  const score = result.score;
  if (!isBoundedScore(score)) {
    throw new Error("Rubric criterion judge output must include a score in the 0..1 range.");
  }
  return {
    result,
    ...(typeof parsed.summary === "string" ? { summary: parsed.summary } : {}),
    ...(parsed.feedback !== undefined ? { feedback: parsed.feedback as Json } : {}),
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

function readCriterionRationale(record: Record<string, unknown>): string | undefined {
  for (const key of ["rationale", "feedback", "reason", "explanation"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeRubricCriterionObject(
  record: Record<string, unknown>,
  criterion: RubricCriterionSpec,
): NonNullable<EvalCaseResult["criteria"]>[number] {
  const criterionId = typeof record.criterion_id === "string"
    ? record.criterion_id
    : "";
  if (criterionId !== criterion.id) {
    throw new Error(`Rubric criterion judge output must use criterion_id ${criterion.id}.`);
  }
  if (!isBoundedScore(record.score)) {
    throw new Error(`Rubric criterion ${criterion.id} output must include a score in the 0..1 range.`);
  }
  const rationale = readCriterionRationale(record);
  if (!rationale) {
    throw new Error(`Rubric criterion ${criterion.id} output must include a non-empty rationale.`);
  }
  return {
    criterion_id: criterion.id,
    label: typeof record.label === "string" && record.label.length > 0 ? record.label : criterion.id,
    score: record.score,
    pass: typeof record.pass === "boolean" ? record.pass : record.score >= 0.5,
    rationale,
  };
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

function rubricParallelism(value: unknown, criterionCount: number): number {
  if (criterionCount <= 0) {
    return 1;
  }
  if (value === undefined) {
    return Math.min(DEFAULT_RUBRIC_PARALLELISM, criterionCount);
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("adapter.with.parallelism must be a positive integer.");
  }
  return Math.min(value, criterionCount);
}

async function mapWithConcurrency<TInput, TOutput>(
  inputs: readonly TInput[],
  concurrency: number,
  mapper: (input: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const limit = Math.max(1, Math.min(concurrency, inputs.length || 1));
  const results = new Array<TOutput>(inputs.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(inputs[index]!, index);
    }
  }
  await Promise.all(
    Array.from({ length: limit }, async () => worker()),
  );
  return results;
}

function requireWorkloadTask(workload: AdapterWorkload, label: string): void {
  if (!workload.case) {
    throw new Error(`${label} workload is missing case text.`);
  }
}

async function createCandidatePatchFromWorkspace(args: {
  beforeRoot: string;
  afterRoot: string;
  edits: readonly string[];
}): Promise<WorkbenchCandidatePatch> {
  const before = new Map(
    (await readSurfaceFilesRecursive(args.beforeRoot))
      .map((file) => [normalizeRelativePath(file.path), file]),
  );
  const changedFiles = (await readSurfaceFilesRecursive(args.afterRoot))
    .map((file) => ({ ...file, path: normalizeRelativePath(file.path) }))
    .filter((file) =>
      isCandidateEditPath(file.path, args.edits) &&
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
    normalized === "private" ||
    normalized.startsWith("private/");
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

function isCandidateEditPath(filePath: string, edits: readonly string[]): boolean {
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
