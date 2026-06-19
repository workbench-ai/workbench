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
  WorkbenchSkillPatch,
} from "@workbench-ai/workbench-contract";
import {
  createWorkbenchExecutionEventPublisher,
  jsonRecord,
  normalizeRelativePath,
  publishCommandStepEvent,
  readSurfaceFiles,
  workbenchProviderAuthSetupCommand,
  writeSurfaceFiles,
  type WorkbenchExecutionEventPublisher,
} from "@workbench-ai/workbench-core";
import {
  ensureWorkbenchAdapterOutputDir,
  readWorkbenchAdapterOperationResult,
  readWorkbenchAdapterOperationRequest,
  writeWorkbenchAdapterOperationResult,
  workbenchAdapterOperationResultPath,
  type WorkbenchAdapterOperationRequest,
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

type AgentExecutionOptions = Pick<
  ExecuteWorkbenchBuiltInAdapterCommandOptions,
  "agentExecutor" | "adapterAuthRoot" | "adapterAuthRequest" | "adapterAuthEnv"
> & {
  eventPublisher?: WorkbenchExecutionEventPublisher;
};
type AdapterRequestHandler = (request: WorkbenchAdapterOperationRequest) => Promise<void>;

const DIRECT_ADAPTER_HANDLERS: Partial<Record<WorkbenchBuiltInAdapterId, AdapterRequestHandler>> = {
  command: executeCommandAdapterRequest,
  tests: executeTestsEngineRequest,
  workbench: executeWorkbenchEngineRequest,
};

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

const CASE_CONTROL_FILE = "case.yaml";
const COMMAND_SKILL_PATCH_FILE = "skill-patch.json";
const DEFAULT_RUBRIC_PARALLELISM = 4;

interface AdapterWorkload {
  job: { id: string };
  eval: {
    name: string;
    description: string;
  };
  skill: {
    path: string;
  };
  improve: {
    edits: string[];
  };
  versionId: string;
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
  const agentOptions: AgentExecutionOptions = {
    agentExecutor: args.agentExecutor,
    adapterAuthRoot: args.adapterAuthRoot,
    adapterAuthRequest: args.adapterAuthRequest ?? request.auth,
    adapterAuthEnv: args.adapterAuthEnv,
    eventPublisher: eventPublisherForAdapterRequest(request),
  };
  const directHandler = DIRECT_ADAPTER_HANDLERS[adapterId];
  if (directHandler) {
    await publishDirectAdapterStep(agentOptions.eventPublisher, adapterId, request, "started");
    try {
      await directHandler(request);
      await publishDirectAdapterStep(agentOptions.eventPublisher, adapterId, request, "succeeded");
    } catch (error) {
      await publishDirectAdapterStep(agentOptions.eventPublisher, adapterId, request, "failed", error);
      throw error;
    }
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
      agentOptions,
    );
    return;
  }
  if (isBuiltInAgentAdapterId(adapterId)) {
    const workload = workloadFromAdapterOperationRequest(request);
    const agent = builtInAgentSpecFromRequest(request);
    if (request.operation === "skill.improve") {
      await writeAgentSkillRevisionOutput(request, workload, agent, agentOptions);
      return;
    }
    if (request.operation === "skill.run") {
      await writeAgentSkillOutput(request, workload, agent, agentOptions);
      return;
    }
    throw new Error(`Agent adapter ${adapterId} cannot handle ${request.operation}.`);
  }
}

async function publishDirectAdapterStep(
  publisher: WorkbenchExecutionEventPublisher | undefined,
  adapterId: WorkbenchBuiltInAdapterId,
  request: WorkbenchAdapterOperationRequest,
  status: "started" | "succeeded" | "failed",
  error?: unknown,
): Promise<void> {
  await publishCommandStepEvent(publisher, {
    step: `${adapterId}.${request.operation}`,
    status,
    role: directAdapterProgressRole(request.operation),
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
  });
}

function directAdapterProgressRole(
  operation: WorkbenchAdapterOperationRequest["operation"],
): "runner" | "improver" | "engine" {
  if (operation === "skill.run") {
    return "runner";
  }
  if (operation === "skill.improve") {
    return "improver";
  }
  return "engine";
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
  const configuredPath = workbenchEngineCasesPath(request);
  const sourcePath = path.resolve(request.paths.workspace, configuredPath);
  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Workbench engine cases path is not a directory: ${sourcePath}`);
  }
  const cases = await readEngineCasesFromWorkbenchCaseRoot(sourcePath);
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
  void request;
  throw new Error("Workbench engine.run is no longer an orchestration adapter. Run the selected skill in core and invoke the score adapter directly.");
}

function workbenchEngineCasesPath(request: WorkbenchAdapterOperationRequest): string {
  const config = adapterCommandConfigRecord(request);
  const cases = config.cases;
  if (cases === undefined) {
    return "cases";
  }
  const caseConfig = jsonRecord(cases);
  if (typeof caseConfig.path === "string" && caseConfig.path.trim().length > 0) {
    return caseConfig.path;
  }
  throw new Error("Workbench engine cases must be an object with path.");
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

function safeInternalPathSegment(value: string): string {
  const safe = value.replace(/[^a-z0-9._-]+/giu, "_").replace(/^_+|_+$/gu, "");
  return safe || "nested";
}

async function executeCommandAdapterRequest(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  const command = requiredAdapterCommandString(request, "command");
  await ensureRunSkillDirectories(request);
  const before = request.operation === "skill.improve"
    ? await snapshotEditableSkillWorkspace(request)
    : null;
  try {
    await runAdapterShellCommand(
      command,
      commandAdapterWorkingDirectory(request),
      commandAdapterEnvironment(request),
    );
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
  await ensureRunSkillDirectories(request);
  const testsRoot = requiredRequestPath(request.paths.enginePrivate, "paths.enginePrivate");
  const script = await firstExistingFile([
    path.join(testsRoot, "test.sh"),
    path.join(testsRoot, "run.sh"),
  ]);
  if (!script) {
    throw new Error(`Tests engine requires ${path.join(testsRoot, "test.sh")}.`);
  }
  const shellFailure = await runAdapterShellCommand(`sh ${shellQuote(script)}`, request.paths.workspace, {
    SKILL_DIR: request.paths.skill ?? path.join(request.paths.workspace, "input", "skills", "current"),
    SKILLS_DIR: request.paths.skills ?? path.join(request.paths.workspace, "input", "skills"),
    CASE_DIR: request.paths.case ?? path.join(request.paths.workspace, "input", "case"),
    OUTPUT_DIR: request.paths.output,
    WORKBENCH_CASE_ID: request.context?.attempt?.caseId ?? "current",
  }).then(() => null, (error: unknown) => error);
  const result = await readTestsResult({
    outputRoot: request.paths.output,
    caseId: request.context?.attempt?.caseId ?? "current",
  }).catch((error: unknown) => {
    if (shellFailure) {
      const shellMessage = shellFailure instanceof Error ? shellFailure.message : String(shellFailure);
      const resultMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`${shellMessage}; ${resultMessage}`);
    }
    throw error;
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

function commandAdapterWorkingDirectory(request: WorkbenchAdapterOperationRequest): string {
  return request.operation === "skill.improve"
    ? requiredRequestPath(request.paths.skill, "paths.skill")
    : request.paths.workspace;
}

function commandAdapterEnvironment(request: WorkbenchAdapterOperationRequest): Record<string, string> {
  return {
    SKILL_DIR: request.paths.skill ?? path.join(request.paths.workspace, "input", "skills", "current"),
    SKILLS_DIR: request.paths.skills ?? path.join(request.paths.workspace, "input", "skills"),
    CASE_DIR: request.paths.case ?? path.join(request.paths.workspace, "input", "case"),
    TRACE_DIR: request.paths.traces ?? path.join(request.paths.workspace, "input", "traces"),
    OUTPUT_DIR: request.paths.output,
    WORKBENCH_SKILL_PATCH: commandSkillPatchPath(request),
    WORKBENCH_CASE_ID: request.context?.attempt?.caseId ?? "current",
  };
}

async function ensureRunSkillDirectories(request: WorkbenchAdapterOperationRequest): Promise<void> {
  if (request.operation === "skill.improve") {
    return;
  }
  await Promise.all([
    request.paths.skills ? fs.mkdir(request.paths.skills, { recursive: true }) : Promise.resolve(),
    request.paths.skill ? fs.mkdir(request.paths.skill, { recursive: true }) : Promise.resolve(),
  ]);
}

function commandSkillPatchPath(request: WorkbenchAdapterOperationRequest): string {
  return path.join(request.paths.output, COMMAND_SKILL_PATCH_FILE);
}

async function readSkillPatchFile(filePath: string): Promise<WorkbenchSkillPatch | null> {
  if (!await fileExists(filePath)) {
    return null;
  }
  const record = jsonRecord(JSON.parse(await fs.readFile(filePath, "utf8")) as unknown);
  const rawFiles: unknown[] = Array.isArray(record.files) ? record.files : [];
  const files: SurfaceSnapshotFile[] = rawFiles.map((entry, index) => {
    if (!isPatchSurfaceSnapshotFile(entry)) {
      throw new Error(
        `Skill patch file ${filePath} files[${index}] must be an object with string path and content fields, got: ${
          describePatchEntry(entry)
        }.`,
      );
    }
    return {
      ...entry,
      path: normalizeRelativePath(entry.path),
    };
  });
  if (record.fileChanges !== undefined && !Array.isArray(record.fileChanges)) {
    throw new Error(`Skill patch file ${filePath} fileChanges must be an array of strings when provided.`);
  }
  const fileChanges = Array.isArray(record.fileChanges)
    ? record.fileChanges.map((entry, index) => {
        if (typeof entry !== "string") {
          throw new Error(
            `Skill patch file ${filePath} fileChanges[${index}] must be a string path, got: ${
              describePatchEntry(entry)
            }.`,
          );
        }
        return normalizeRelativePath(entry);
      })
    : files.map((file) => file.path);
  return {
    files,
    fileChanges,
    ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
    ...(record.feedback !== undefined ? { feedback: record.feedback as Json } : {}),
  };
}

function describePatchEntry(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    return `an object with key${keys.length === 1 ? "" : "s"} [${keys.join(", ")}]`;
  }
  return `a ${typeof value}`;
}

function isPatchSurfaceSnapshotFile(value: unknown): value is SurfaceSnapshotFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.path === "string" && typeof record.content === "string";
}

async function writeOperationOkUnlessPresent(
  request: WorkbenchAdapterOperationRequest,
  beforeRoot?: string,
): Promise<void> {
  if (await fileExists(workbenchAdapterOperationResultPath(request.paths.output))) {
    return;
  }
  if (request.operation === "skill.improve") {
    const skillRoot = requiredRequestPath(request.paths.skill, "paths.skill");
    const patch = await readSkillPatchFile(commandSkillPatchPath(request)) ??
      await createSkillPatchFromWorkspace({
        beforeRoot: beforeRoot ?? skillRoot,
        afterRoot: skillRoot,
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

async function snapshotEditableSkillWorkspace(
  request: WorkbenchAdapterOperationRequest,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-skill-before-"));
  const edits = request.context?.improve?.edits ?? [];
  const files = await readEditableSkillWorkspaceFiles(
    requiredRequestPath(request.paths.skill, "paths.skill"),
    edits,
  );
  await writeSurfaceFiles(root, files);
  return {
    root,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

async function readEditableSkillWorkspaceFiles(
  root: string,
  edits: readonly string[],
): Promise<SurfaceSnapshotFile[]> {
  const editPaths = edits
    .map(normalizeSkillEditPath)
    .filter((filePath) => filePath === "." || !isRuntimeWorkspacePath(filePath));
  if (editPaths.length === 0) {
    return [];
  }
  const files = await readSurfaceFiles(root);
  return dedupeSurfaceFiles(files.filter((file) =>
    isAllowedSkillEditPath(file.path, editPaths) &&
    !isRuntimeWorkspacePath(file.path)
  ));
}

function normalizeSkillEditPath(filePath: string): string {
  const normalized = filePath
    .replace(/\\/gu, "/")
    .replace(/^\/+/u, "")
    .replace(/^\.\/+/u, "")
    .replace(/\/+$/u, "");
  return normalized === "." ? "." : normalizeRelativePath(normalized);
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

async function readEngineCasesFromWorkbenchCaseRoot(
  casesRoot: string,
): Promise<WorkbenchEngineCase[]> {
  const caseDirs = await listWorkbenchCaseDirectories(casesRoot);
  if (caseDirs.length === 0) {
    throw new Error(`Engine resolve has no Workbench case packages: ${casesRoot}`);
  }
  return await Promise.all(caseDirs.map(async (caseDir) =>
    readWorkbenchEngineCase({
      caseDir,
      id: path.basename(caseDir),
    })
  ));
}

async function listWorkbenchCaseDirectories(root: string): Promise<string[]> {
  if (await fileExists(path.join(root, CASE_CONTROL_FILE))) {
    throw new Error(`Workbench engine cases root must contain case directories, not a direct ${CASE_CONTROL_FILE}: ${root}`);
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const cases: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const caseDir = path.join(root, entry.name);
    if (await fileExists(path.join(caseDir, CASE_CONTROL_FILE))) {
      cases.push(caseDir);
    }
  }
  return cases.sort((left, right) => left.localeCompare(right));
}

async function readWorkbenchEngineCase(args: {
  caseDir: string;
  id: string;
}): Promise<WorkbenchEngineCase> {
  const sourceFiles = await readSurfaceFiles(args.caseDir);
  const caseFile = sourceFiles.find((file) =>
    normalizeRelativePath(file.path) === CASE_CONTROL_FILE && file.encoding === "utf8"
  );
  if (!caseFile) {
    throw new Error(`Case ${args.id} is missing ${CASE_CONTROL_FILE}.`);
  }
  const caseRecord = jsonRecord(YAML.parse(caseFile.content) as unknown);
  if (caseRecord.version !== 1) {
    throw new Error(`Case ${args.id} ${CASE_CONTROL_FILE} version must be 1.`);
  }
  if (typeof caseRecord.case !== "string" || caseRecord.case.trim().length === 0) {
    throw new Error(`Case ${args.id} ${CASE_CONTROL_FILE} must include a case string.`);
  }
  const unsupportedCaseFields = Object.keys(caseRecord)
    .filter((key) => !["version", "case", "split", "files", "tests", "solution", "environment"].includes(key));
  if (unsupportedCaseFields.length > 0) {
    throw new Error(
      `Case ${args.id} ${CASE_CONTROL_FILE} has unsupported field${unsupportedCaseFields.length === 1 ? "" : "s"}: ${unsupportedCaseFields.join(", ")}.`,
    );
  }
  if (caseRecord.split !== undefined && (typeof caseRecord.split !== "string" || caseRecord.split.trim().length === 0)) {
    throw new Error(`Case ${args.id} ${CASE_CONTROL_FILE} split must be a non-empty string when provided.`);
  }
  const publicPrefix = caseDirectoryPrefix(caseRecord.files, "files", args.id);
  const testsPrefix = caseDirectoryPrefix(caseRecord.tests, "tests", args.id);
  const solutionPrefix = caseDirectoryPrefix(caseRecord.solution, "solution", args.id);
  const publicFiles = stripCaseDirectory(sourceFiles, publicPrefix);
  const privateFiles = [
    ...stripCaseDirectory(sourceFiles, testsPrefix),
    ...stripCaseDirectory(sourceFiles, solutionPrefix),
  ].sort((left, right) => left.path.localeCompare(right.path));
  assertWorkbenchCasePackageLayout(args.id, sourceFiles, [
    publicPrefix,
    testsPrefix,
    solutionPrefix,
    "environment/",
  ]);
  return {
    id: normalizeRelativePath(args.id),
    case: {
      version: 3,
      prompt: caseRecord.case,
      ...(typeof caseRecord.split === "string" ? { split: caseRecord.split.trim() } : {}),
      ...(caseRecord.environment !== undefined
        ? { environment: caseRecord.environment as WorkbenchEngineCase["case"]["environment"] }
        : {}),
    },
    files: {
      public: publicFiles,
      private: privateFiles,
      source: sourceFiles,
    },
  };
}

function caseDirectoryPrefix(value: unknown, fallback: string, caseId: string): string {
  if (value === undefined) {
    return `${fallback}/`;
  }
  const record = jsonRecord(value);
  if (typeof record.path !== "string" || record.path.trim().length === 0) {
    throw new Error(`Case ${caseId} ${CASE_CONTROL_FILE} path config must include a path string.`);
  }
  return `${normalizeRelativePath(record.path)}/`;
}

function assertWorkbenchCasePackageLayout(
  caseId: string,
  files: readonly SurfaceSnapshotFile[],
  allowedPrefixes: readonly string[],
): void {
  const invalid = files
    .map((file) => normalizeRelativePath(file.path))
    .filter((filePath) =>
      filePath !== CASE_CONTROL_FILE &&
      !allowedPrefixes.some((prefix) => filePath.startsWith(prefix))
    );
  if (invalid.length > 0) {
    throw new Error(
      `Case ${caseId} contains unsupported file${invalid.length === 1 ? "" : "s"} outside case.yaml or declared case directories: ${invalid.join(", ")}`,
    );
  }
}

function stripCaseDirectory(
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

async function fileExists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then((stat) => stat.isFile(), () => false);
}

async function readTestsResult(args: {
  outputRoot: string;
  caseId: string;
}): Promise<WorkbenchResult> {
  const resultJson = await readOptionalJson(path.join(args.outputRoot, "result.json"));
  if (resultJson) {
    return normalizeTestsResult(resultJson, args.caseId);
  }
  throw new Error(
    `Tests engine did not find result.json under OUTPUT_DIR (${args.outputRoot}). ` +
      "The tests script must write a result to $OUTPUT_DIR/result.json.",
  );
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
  const rawPassed = typeof record.ok === "boolean"
    ? record.ok
    : typeof record.passed === "boolean"
      ? record.passed
      : typeof record.pass === "boolean"
        ? record.pass
        : undefined;
  const rawScore = typeof record.score === "number"
    ? record.score
    : rawPassed !== undefined
      ? rawPassed ? 1 : 0
      : undefined;
  if (rawScore === undefined || !Number.isFinite(rawScore)) {
    throw new Error("Tests engine result must include a finite numeric score or boolean ok/passed/pass.");
  }
  const metrics = normalizeTestsMetrics(record, rawScore);
  return {
    score: rawScore,
    metrics,
    cases: [{
      id: caseId,
      status: rawPassed === false ? "error" : "completed",
      metrics,
      ...(rawPassed === false
        ? { feedback: { message: typeof record.message === "string" ? record.message : "Test failed." } }
        : {}),
    }],
    ...(typeof record.summary === "string"
      ? { summary: record.summary }
      : typeof record.message === "string"
        ? { summary: record.message }
        : {}),
    feedback: {
      result: record as Json,
    },
  };
}

function normalizeTestsMetrics(record: Record<string, unknown>, score: number): Record<string, number> {
  const metrics: Record<string, number> = { score };
  const source = record.metrics && typeof record.metrics === "object" && !Array.isArray(record.metrics)
    ? record.metrics as Record<string, unknown>
    : {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      metrics[key] = value;
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
    eval: {
      name: context.eval?.name ?? "",
      description: context.eval?.description ?? "",
    },
    skill: {
      path: context.skill?.path ?? "",
    },
    improve: {
      edits: context.improve?.edits ?? [],
    },
    versionId: context.skill?.id ?? "",
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

function eventPublisherForAdapterRequest(
  request: WorkbenchAdapterOperationRequest,
): WorkbenchExecutionEventPublisher | undefined {
  if (!request.progress) {
    return undefined;
  }
  return createWorkbenchExecutionEventPublisher({
    projectId: request.progress.projectId,
    runId: request.progress.runId,
    jobId: request.progress.jobId,
    executionId: request.progress.executionId,
    attempt: request.progress.attempt,
    target: request.progress.target,
  });
}

async function executeBuiltInAgentTurn(
  executor: WorkbenchAgentTurnExecutor | undefined,
  request: WorkbenchAgentTurnRequest,
): Promise<WorkbenchAgentTurnResult> {
  requireWorkbenchAdapterAuthForProviderTurn(request.provider, request.adapterAuthRequest);
  const {
    defaultWorkbenchAgentTurnExecutor,
    executeWorkbenchAgentTurn,
  } = await import("./agent-turn.ts");
  return await executeWorkbenchAgentTurn(executor ?? defaultWorkbenchAgentTurnExecutor, request);
}

function requireWorkbenchAdapterAuthForProviderTurn(
  provider: AgentProviderSpec,
  auth: unknown,
): void {
  if (providerAuthRequestEntry(auth, provider.use)) {
    return;
  }
  throw new Error(`ADAPTER_AUTH_REQUIRED: ${provider.use} disconnected. Next: ${workbenchProviderAuthSetupCommand(provider.use)}.`);
}

function providerAuthRequestEntry(
  auth: unknown,
  providerName: string,
): Record<string, unknown> | null {
  const record = authObject(auth);
  const self = authObject(record?.self);
  const adapters = authObject(record?.adapters);
  const provider = authObject(adapters?.[providerName]);
  return authObject(self?.default) ??
    authObject(provider?.default) ??
    authObject(record?.default);
}

function authObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function writeAgentSkillOutput(
  request: WorkbenchAdapterOperationRequest,
  workload: AdapterWorkload,
  adapter: BuiltInAgentAdapterSpec,
  options: AgentExecutionOptions = {},
): Promise<void> {
  if (request.operation !== "skill.run") {
    throw new Error("Agent skill execution results can only complete skill.run operations.");
  }
  await sealProviderSkillRunWorkspace(request);
  const traceRoot = path.join(request.paths.output, ".workbench", "internal", "agent-skill");
  const agentResult = await executeBuiltInAgentTurn(options.agentExecutor, {
    role: "runner",
    provider: adapter.agent,
    adapterAuthRoot: options.adapterAuthRoot,
    adapterAuthRequest: options.adapterAuthRequest,
    adapterAuthEnv: options.adapterAuthEnv,
    workspaceRoot: request.paths.workspace,
    cwd: request.paths.workspace,
    prompt: buildAgentSkillPrompt(workload, adapter),
    traceRoot,
    jobId: workload.job.id,
    eventPublisher: options.eventPublisher,
  });
  const outputPath = path.join(request.paths.output, "skill-summary.md");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, agentResult.output);
  const trace: SurfaceSnapshotFile = {
    path: `.workbench/traces/${workload.job.id}/skill.json`,
    kind: "text",
    encoding: "utf8",
    executable: false,
    content: `${JSON.stringify({
      kind: "agent_skill",
      provider: adapter.agent.use,
      versionId: workload.versionId,
      attemptIndex: workload.attemptIndex,
      sampleIndex: workload.sampleIndex,
      summary: agentResult.output,
      metadata: agentResult.metadata,
    }, null, 2)}\n`,
  };
  await writeSurfaceFiles(request.paths.output, [
    ...agentSessionEvidenceFiles(workload.job.id, adapter.agent.use, agentResult.metadata),
    trace,
    ...agentResult.traceFiles,
  ]);
  const runtime = await importWorkbenchRuntime();
  const usage = runtime.assignUsageRole("runner", agentResult.usage);
  await writeWorkbenchAdapterOperationResult(request.paths.output, {
    protocol: "workbench.adapter-result.v1",
    operation: "skill.run",
    ok: true,
    ...(agentResult.output ? { summary: agentResult.output } : {}),
    feedback: {
      skill: "agent",
      agent: adapter.agent.use,
      metadata: agentResult.metadata,
    },
    ...(usage ? { usage } : {}),
  });
}

async function sealProviderSkillRunWorkspace(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  await Promise.all([
    fs.rm(path.join(request.paths.workspace, ".workbench"), { recursive: true, force: true }),
    request.paths.enginePrivate
      ? fs.rm(request.paths.enginePrivate, { recursive: true, force: true })
      : Promise.resolve(),
    request.paths.traces
      ? fs.rm(request.paths.traces, { recursive: true, force: true })
      : Promise.resolve(),
  ]);
}

function agentSessionEvidenceFiles(
  jobId: string,
  provider: string,
  metadata: WorkbenchAgentTurnResult["metadata"],
): SurfaceSnapshotFile[] {
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
  const sessionId = typeof record.sessionId === "string" && record.sessionId.trim()
    ? record.sessionId.trim()
    : undefined;
  const providerId = typeof record.providerId === "string" && record.providerId.trim()
    ? record.providerId.trim()
    : provider;
  const model = typeof record.model === "string" && record.model.trim()
    ? record.model.trim()
    : undefined;
  if (!sessionId && !providerId && !model) {
    return [];
  }
  return [
    jsonSurfaceFile("agent-session.json", {
      schema: "workbench.agent.session.v1",
      jobId,
      provider,
      providerId,
      ...(model ? { model } : {}),
      ...(sessionId ? {
        sessionId,
        ref: `${provider}:${sessionId}`,
      } : {}),
    }),
  ];
}

function buildAgentSkillPrompt(
  workload: AdapterWorkload,
  adapter: BuiltInAgentAdapterSpec,
): string {
  return [
    ...(adapter.instructions ? ["Instructions:", adapter.instructions, ""] : []),
    "Context:",
    "- The entry skill is mounted at /workspace/input/skills/current unless another version is selected.",
    "- All skills installed for this run are mounted under /workspace/input/skills.",
    "- The mutable working directory is /workspace.",
    "- If the skill declares prepare.command, it has already run and may have copied files into /workspace.",
    ...(workload.case?.prompt ? ["Case:", workload.case.prompt, ""] : []),
    "- Public case files are mounted at /workspace/input/case.",
    "- Verifier tests are not present while you run.",
    "- Mutate the current working directory to complete the case.",
    "- You may write inspection artifacts under /workspace/output.",
  ].join("\n");
}

async function writeAgentSkillRevisionOutput(
  request: WorkbenchAdapterOperationRequest,
  workload: AdapterWorkload,
  improver: BuiltInAgentAdapterSpec,
  options: AgentExecutionOptions,
): Promise<void> {
  if (request.operation !== "skill.improve") {
    throw new Error("Agent skill improvement results can only complete skill.improve operations.");
  }
  const before = await snapshotEditableSkillWorkspace(request);
  const traceRoot = path.join(request.paths.output, ".workbench", "internal", "agent-improver");
  try {
    const agentResult = await executeBuiltInAgentTurn(options.agentExecutor, {
      role: "improver",
      provider: improver.agent,
      adapterAuthRoot: options.adapterAuthRoot,
      adapterAuthRequest: options.adapterAuthRequest,
      adapterAuthEnv: options.adapterAuthEnv,
      workspaceRoot: request.paths.workspace,
      cwd: requiredRequestPath(request.paths.skill, "paths.skill"),
      prompt: buildAgentImproverPrompt(workload),
      traceRoot,
      jobId: workload.job.id,
      eventPublisher: options.eventPublisher,
    });
    const skillPatch = await createSkillPatchFromWorkspace({
      beforeRoot: before.root,
      afterRoot: requiredRequestPath(request.paths.skill, "paths.skill"),
      edits: workload.improve.edits,
    });
    const changedSkillPaths = skillPatch.fileChanges.filter((filePath) =>
      isAllowedSkillEditPath(filePath, workload.improve.edits),
    );
    if (changedSkillPaths.length === 0) {
      throw new Error("Agent improve adapter completed without changing a skill file covered by improve edits.");
    }
    const trace: SurfaceSnapshotFile = {
      path: `.workbench/traces/${workload.job.id}/improver.json`,
      kind: "text",
      encoding: "utf8",
      executable: false,
      content: `${JSON.stringify({
        kind: "agent_improver",
        provider: improver.agent.use,
        versionId: workload.versionId,
        attemptIndex: workload.attemptIndex,
        changedPaths: changedSkillPaths,
        summary: agentResult.output,
        metadata: agentResult.metadata,
      }, null, 2)}\n`,
    };
    await writeSurfaceFiles(request.paths.output, [trace, ...agentResult.traceFiles]);
    const runtime = await importWorkbenchRuntime();
    const usage = runtime.assignUsageRole("improver", agentResult.usage);
    await writeWorkbenchAdapterOperationResult(request.paths.output, {
      protocol: "workbench.adapter-result.v1",
      operation: "skill.improve",
      ok: true,
      value: {
        ...skillPatch,
        fileChanges: changedSkillPaths,
      },
      ...(agentResult.output ? { summary: agentResult.output } : {}),
      feedback: {
        improver: improver.agent.use,
        changedPaths: changedSkillPaths,
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
    "Eval:",
    workload.eval.description || workload.eval.name,
    "",
    "Improve the skill for this eval.",
    "",
    "Skill files are in the current directory.",
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
  options: AgentExecutionOptions = {},
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
      eventPublisher: options.eventPublisher,
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
    versionId: args.workload.versionId,
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
    jsonSurfaceFile("rubric-scorecard.json", scorecard),
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

async function runRubricCriterionJudge(args: AgentExecutionOptions & {
  request: WorkbenchAdapterOperationRequest;
  workload: AdapterWorkload;
  engine: BuiltInRubricAdapterSpec;
  criterion: RubricCriterionSpec;
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
    eventPublisher: args.eventPublisher,
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
      eventPublisher: args.eventPublisher,
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
  requireWorkloadCase(workload, "Rubric judge");
  return [
    ...(engine.instructions ? ["Instructions:", engine.instructions, ""] : []),
    ...(workload.case?.prompt ? ["Case:", workload.case.prompt, ""] : []),
    "Criterion:",
    JSON.stringify(criterion, null, 2),
    "",
    "Context:",
    "- The skill already ran in this same working directory.",
    "- Skill outputs are available in the current working directory.",
    "- Public case files are mounted at /workspace/input/case.",
    "- Private case files are mounted at /workspace/private/engine when the case provides them.",
    "- Score only from the current working directory, public case files, private case files, and the criterion above.",
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

function requireWorkloadCase(workload: AdapterWorkload, label: string): void {
  if (!workload.case) {
    throw new Error(`${label} workload is missing case text.`);
  }
}

async function createSkillPatchFromWorkspace(args: {
  beforeRoot: string;
  afterRoot: string;
  edits: readonly string[];
}): Promise<WorkbenchSkillPatch> {
  const before = new Map(
    (await readSurfaceFiles(args.beforeRoot))
      .map((file) => [normalizeRelativePath(file.path), file]),
  );
  const changedFiles = (await readSurfaceFiles(args.afterRoot))
    .map((file) => ({ ...file, path: normalizeRelativePath(file.path) }))
    .filter((file) =>
      isAllowedSkillEditPath(file.path, args.edits) &&
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

function isAllowedSkillEditPath(filePath: string, edits: readonly string[]): boolean {
  const normalized = normalizeRelativePath(filePath);
  return edits.some((entry) => {
    const editPath = normalizeSkillEditPath(entry);
    if (editPath === ".") {
      return true;
    }
    return normalized === editPath || normalized.startsWith(`${editPath}/`);
  });
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
