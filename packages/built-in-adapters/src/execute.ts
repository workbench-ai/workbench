import { spawn, type ChildProcess } from "node:child_process";
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
  dedupeSurfaceFiles,
  jsonRecord,
  normalizeRelativePath,
  publishCommandStepEvent,
  publicGradeMetrics,
  readSurfaceFiles,
  workbenchProviderAuthSetupCommand,
  writeSurfaceFiles,
  type WorkbenchExecutionEventPublisher,
} from "@workbench-ai/workbench-core";
import {
  ensureWorkbenchAdapterOutputDir,
  isWorkbenchBuiltInAdapterId,
  readWorkbenchAdapterOperationResult,
  readWorkbenchAdapterOperationRequest,
  WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS_ENV,
  writeWorkbenchAdapterOperationResult,
  workbenchAdapterOperationResultPath,
  type WorkbenchAdapterOperationRequest,
  type WorkbenchBuiltInAdapterId,
  type WorkbenchEngineCase,
} from "@workbench-ai/workbench-protocol";
import YAML from "yaml";
import { codexHarness } from "@workbench-ai/agent-driver-openai-codex";
import { claudeCodeHarness } from "@workbench-ai/agent-driver-anthropic-claude-code";
import type { HarnessProvider } from "@workbench-ai/agent-driver";

import {
  createWorkbenchAgentTurnExecutor,
  executeWorkbenchAgentTurn,
  type HarnessProviderResolver,
  type AgentProviderSpec,
  type WorkbenchAgentTurnExecutor,
  type WorkbenchAgentTurnRequest,
  type WorkbenchAgentTurnResult,
} from "./agent-turn.ts";
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
  criteria: RubricCriterionSpec[];
}

interface RubricCriterionSpec {
  id: string;
  description: string;
  weight?: number;
}

const CASE_CONTROL_FILE = "case.yaml";
const COMMAND_SKILL_PATCH_FILE = "skill-patch.json";
const FIRST_PARTY_HARNESS_PROVIDERS = new Map<string, HarnessProvider<unknown>>([
  ["codex", codexHarness()],
  ["claude", claudeCodeHarness()],
]);
const resolveFirstPartyHarnessProvider: HarnessProviderResolver = (id) =>
  FIRST_PARTY_HARNESS_PROVIDERS.get(id);
const defaultWorkbenchAgentTurnExecutor = createWorkbenchAgentTurnExecutor(
  resolveFirstPartyHarnessProvider,
);

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
    if (request.operation !== "grade.run") {
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
  if (request.operation === "grade.run") {
    throw new Error("Workbench grade.run is not implemented by the workbench adapter. Run the selected skill in core and invoke a grader adapter directly.");
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

async function executeCommandAdapterRequest(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  const command = requiredAdapterCommandString(request, "command");
  await ensureRunSkillDirectories(request);
  await ensureGradeSubjectDirectories(request);
  const before = request.operation === "skill.improve"
    ? await snapshotEditableSkillWorkspace(request)
    : null;
  try {
    await runAdapterShellCommand(
      command,
      commandAdapterWorkingDirectory(request),
      commandAdapterEnvironment(request),
    );
    if (request.operation === "grade.run") {
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
    const publicResult = await readOptionalJson(path.join(request.paths.output, "result.json"));
    if (!publicResult) {
      throw new Error("Command grader must write $OUTPUT_DIR/result.json for grade.run.");
    }
    const result = normalizePublicGradeResult(publicResult, request.context?.attempt?.caseId ?? "current");
    await writeWorkbenchAdapterOperationResult(request.paths.output, {
      protocol: "workbench.adapter-result.v1",
      operation: "grade.run",
      ok: true,
      value: result,
      ...(typeof result.summary === "string" ? { summary: result.summary } : {}),
      feedback: {
        engine: "command",
        result: publicResult as Json,
      },
    });
    return;
  }
  await readWorkbenchAdapterOperationResult(request.paths.output, "grade.run").catch((error: unknown) => {
    throw new Error(
      `Command grader wrote an invalid workbench-result.json for grade.run: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
}

async function executeTestsEngineRequest(
  request: WorkbenchAdapterOperationRequest,
): Promise<void> {
  if (request.operation !== "grade.run") {
    throw new Error(`Tests adapter cannot handle ${request.operation}.`);
  }
  await ensureRunSkillDirectories(request);
  await ensureGradeSubjectDirectories(request);
  const testsRoot = requiredRequestPath(request.paths.enginePrivate, "paths.enginePrivate");
  const script = await firstExistingFile([
    path.join(testsRoot, "test.sh"),
    path.join(testsRoot, "run.sh"),
  ]);
  if (!script) {
    throw new Error(`Tests engine requires ${path.join(testsRoot, "test.sh")}.`);
  }
  const shellFailure = await runTestsEngineScript(script, request.paths.workspace, {
    SKILL_DIR: request.paths.skill ?? path.join(request.paths.workspace, "input", "skills", "current"),
    SKILLS_DIR: request.paths.skills ?? path.join(request.paths.workspace, "input", "skills"),
    CASE_DIR: request.paths.case ?? path.join(request.paths.workspace, "input", "case"),
    SUBJECT_WORKSPACE_DIR: path.join(request.paths.workspace, "input", "subject", "workspace"),
    SUBJECT_OUTPUT_DIR: path.join(request.paths.workspace, "input", "subject", "output"),
    SUBJECT_TRACE_DIR: path.join(request.paths.workspace, "input", "subject", "traces"),
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
    operation: "grade.run",
    ok: true,
    value: result,
    ...(typeof result.summary === "string" ? { summary: result.summary } : {}),
    feedback: {
      engine: "tests",
    },
  });
}

async function runTestsEngineScript(
  script: string,
  cwd: string,
  env: Record<string, string> = {},
): Promise<void> {
  const command = await testsEngineScriptCommand(script);
  await runAdapterProcess(command.command, command.args, cwd, env);
}

async function testsEngineScriptCommand(script: string): Promise<{ command: string; args: string[] }> {
  const source = await fs.readFile(script, "utf8");
  const firstLine = source.split(/\r?\n/u, 1)[0] ?? "";
  if (!firstLine.startsWith("#!")) {
    return { command: "sh", args: [script] };
  }
  const shebang = firstLine.slice(2).trim();
  if (!shebang) {
    return { command: "sh", args: [script] };
  }
  const [command, ...args] = shebang.split(/\s+/u);
  return { command: command ?? "sh", args: [...args, script] };
}

async function runAdapterShellCommand(
  command: string,
  cwd: string,
  env: Record<string, string> = {},
): Promise<void> {
  await runAdapterProcess("sh", ["-c", command], cwd, env);
}

async function runAdapterProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const childEnv = {
      ...process.env,
      ...env,
    };
    let timedOut = false;
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      env: childEnv,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeoutMs = adapterProcessTimeoutMs(childEnv);
    const timer = timeoutMs === null
      ? null
      : setTimeout(() => {
          timedOut = true;
          killAdapterProcess(child, "SIGKILL");
        }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      process.stderr.write(chunk);
    });
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      callback();
    };
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("exit", (code, signal) => {
      if (timedOut) {
        finish(() => reject(new Error(`Command adapter timed out after ${timeoutMs}ms.`)));
        return;
      }
      if (code === 0) {
        finish(resolve);
        return;
      }
      finish(() => reject(new Error(
        code === null
          ? `Command adapter exited from signal ${signal ?? "unknown"}.`
          : `Command adapter exited with status ${code}.`,
      )));
    });
  });
}

function adapterProcessTimeoutMs(env: NodeJS.ProcessEnv): number | null {
  const raw = env[WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS_ENV]?.trim();
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function killAdapterProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to killing the direct child if process-group termination is unavailable.
    }
  }
  child.kill(signal);
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
    SUBJECT_WORKSPACE_DIR: path.join(request.paths.workspace, "input", "subject", "workspace"),
    SUBJECT_OUTPUT_DIR: path.join(request.paths.workspace, "input", "subject", "output"),
    SUBJECT_TRACE_DIR: path.join(request.paths.workspace, "input", "subject", "traces"),
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

async function ensureGradeSubjectDirectories(request: WorkbenchAdapterOperationRequest): Promise<void> {
  if (request.operation !== "grade.run") {
    return;
  }
  await Promise.all([
    fs.mkdir(path.join(request.paths.workspace, "input", "subject", "output"), { recursive: true }),
    fs.mkdir(path.join(request.paths.workspace, "input", "subject", "workspace"), { recursive: true }),
    fs.mkdir(path.join(request.paths.workspace, "input", "subject", "traces"), { recursive: true }),
    fs.mkdir(request.paths.output, { recursive: true }),
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
    return normalizePublicGradeResult(resultJson, args.caseId);
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

function normalizePublicGradeResult(
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
    throw new Error("Grade result must include a finite numeric score or boolean ok/passed/pass.");
  }
  const metrics = publicGradeMetrics(record, rawScore);
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
    trace,
    neutralAgentTraceFile(workload.job.id, "runner", adapter.agent.use, agentResult),
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
    await writeSurfaceFiles(request.paths.output, [
      trace,
      neutralAgentTraceFile(workload.job.id, "improver", improver.agent.use, agentResult),
      ...agentResult.traceFiles,
    ]);
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
  const runtime = await importWorkbenchRuntime();
  const judge = await executeBuiltInAgentTurn(options.agentExecutor, {
    role: "engine",
    provider: engine.judge,
    adapterAuthRoot: options.adapterAuthRoot,
    adapterAuthRequest: options.adapterAuthRequest,
    adapterAuthEnv: options.adapterAuthEnv,
    workspaceRoot: request.paths.workspace,
    cwd: request.paths.workspace,
    prompt: buildRubricJudgePrompt(workload, engine),
    traceRoot: path.join(request.paths.output, ".workbench", "internal", "rubric", "judge"),
    tracePath: `.workbench/traces/${workload.job.id}/engine/rubric/judge`,
    jobId: workload.job.id,
    eventPublisher: options.eventPublisher,
  });
  const judged = parseRubricJudgeOutput(judge.output, engine.criteria);
  const usage = runtime.assignUsageRole("engine", judge.usage);
  const result = rubricJudgeResult({ workload, engine, judged, metadata: judge.metadata });
  await writeRubricEvidenceFiles({
    request,
    workload,
    engine,
    result,
    judged,
    judge,
    usage,
  });
  await writeWorkbenchAdapterOperationResult(request.paths.output, {
    protocol: "workbench.adapter-result.v1",
    operation: "grade.run",
    ok: true,
    value: result,
    ...(typeof result.summary === "string" ? { summary: result.summary } : {}),
    feedback: {
      rubric: "single-judge",
      judge: engine.judge.use,
      aggregation: "weighted_mean",
      traceFiles: publicRubricAgentTraceFiles(judge.traceFiles).map((file) => file.path),
      metadata: judge.metadata as Json,
    },
    ...(usage ? { usage } : {}),
  });
}

interface RubricEvidence {
  path: string;
  locator?: string;
  note: string;
}

interface RubricJudgedCriterion {
  id: string;
  score: number;
  pass: boolean;
  rationale: string;
  evidence: RubricEvidence[];
}

interface RubricJudgeOutput {
  summary: string;
  criteria: RubricJudgedCriterion[];
}

async function writeRubricEvidenceFiles(args: {
  request: WorkbenchAdapterOperationRequest;
  workload: AdapterWorkload;
  engine: BuiltInRubricAdapterSpec;
  result: WorkbenchResult;
  judged: RubricJudgeOutput;
  judge: WorkbenchAgentTurnResult;
  usage?: UsageSummary;
}): Promise<void> {
  const scorecard = {
    schema: "workbench.engine.rubric.evidence.v1",
    safeForImprover: true,
    jobId: args.workload.job.id,
    versionId: args.workload.versionId,
    attemptIndex: args.workload.attemptIndex,
    sampleIndex: args.workload.sampleIndex,
    caseId: args.workload.caseId,
    judge: args.engine.judge.use,
    aggregation: "weighted_mean",
    score: args.result.score,
    metrics: args.result.metrics ?? {},
    summary: args.result.summary ?? null,
    criteria: args.judged.criteria,
    metadata: safeRubricEvidenceMetadata(args.judge.metadata),
    ...(args.usage ? { usage: args.usage } : {}),
  };
  await writeSurfaceFiles(args.request.paths.output, [
    jsonSurfaceFile("rubric-scorecard.json", scorecard),
    neutralAgentTraceFile(args.workload.job.id, "judge", args.engine.judge.use, args.judge),
    ...publicRubricAgentTraceFiles(args.judge.traceFiles),
  ]);
}

function neutralAgentTraceFile(
  jobId: string,
  role: "runner" | "judge" | "improver",
  adapterId: string,
  result: WorkbenchAgentTurnResult,
): SurfaceSnapshotFile {
  return jsonSurfaceFile(`.workbench/agent-traces/${jobId}/${role}.json`, {
    schema: "workbench.execution-agent-trace.v1",
    role,
    adapterId,
    trace: result.agentTrace,
  });
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

function publicRubricAgentTraceFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  return files
    .filter((file) => file.encoding === "utf8" && file.path.endsWith("/trace.json"))
    .map((file) => ({ ...file }));
}

function buildRubricJudgePrompt(
  workload: AdapterWorkload,
  engine: BuiltInRubricAdapterSpec,
): string {
  requireWorkloadCase(workload, "Rubric judge");
  return [
    ...(engine.instructions ? ["Instructions:", engine.instructions, ""] : []),
    ...(workload.case?.prompt ? ["Case:", workload.case.prompt, ""] : []),
    "Criteria:",
    JSON.stringify(engine.criteria, null, 2),
    "",
    "Context:",
    "- The skill already ran in a separate execution job.",
    "- The runner workspace is mounted at /workspace/input/subject/workspace.",
    "- The runner output directory is mounted at /workspace/input/subject/output.",
    "- The runner trace is mounted at /workspace/input/subject/traces.",
    "- Public case files are mounted at /workspace/input/case.",
    "- Private case files are mounted at /workspace/private/engine when the case provides them.",
    "- Inspect relevant artifacts with the available tools before scoring.",
    "- Score only from the subject mounts, public case files, private case files, and the criteria above.",
    "",
    "Output:",
    "Return only a JSON object. Do not wrap it in Markdown.",
    "The JSON object must cover every criterion exactly once. Use this shape:",
    JSON.stringify({
      summary: "short scoring summary",
      criteria: engine.criteria.map((criterion) => ({
        id: criterion.id,
        score: 0,
        pass: false,
        rationale: "why this criterion received this score",
        evidence: [{ path: "output/example", locator: "optional sheet/cell or page", note: "what this proves" }],
      })),
    }, null, 2),
    "Scores must be numbers from 0 through 1. Rationales must be non-empty and criterion-specific.",
    "Evidence is optional, but when present each item must name a path, optional precise locator, and note.",
  ].join("\n");
}

function rubricJudgeResult(args: {
  workload: AdapterWorkload;
  engine: BuiltInRubricAdapterSpec;
  judged: RubricJudgeOutput;
  metadata: WorkbenchAgentTurnResult["metadata"];
}): WorkbenchResult {
  const criteria = args.judged.criteria.map((criterion) => ({
    criterion_id: criterion.id,
    label: criterion.id,
    score: criterion.score,
    pass: criterion.pass,
    rationale: criterion.rationale,
  }));
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
  return {
    score,
    metrics,
    summary: args.judged.summary,
    cases: [caseResult],
    feedback: {
      judge: args.engine.judge.use,
      rubric: {
        aggregation: "weighted_mean",
        criteria: args.judged.criteria as unknown as Json,
        metadata: args.metadata as Json,
      },
    },
  };
}

function parseRubricJudgeOutput(
  output: string,
  criteria: readonly RubricCriterionSpec[],
): RubricJudgeOutput {
  const parsed = parseAgentJsonObject(output, "Rubric judge");
  assertExactObjectKeys(parsed, ["summary", "criteria"], "Rubric judge output");
  if (typeof parsed.summary !== "string" || !parsed.summary.trim()) {
    throw new Error("Rubric judge output must include a non-empty summary.");
  }
  if (!Array.isArray(parsed.criteria)) {
    throw new Error("Rubric judge output criteria must be an array.");
  }
  const expected = new Set(criteria.map((criterion) => criterion.id));
  const seen = new Set<string>();
  const judged = parsed.criteria.map((value, index) => parseJudgedCriterion(value, index));
  for (const criterion of judged) {
    if (!expected.has(criterion.id)) {
      throw new Error(`Rubric judge output contains unknown criterion id ${criterion.id}.`);
    }
    if (seen.has(criterion.id)) {
      throw new Error(`Rubric judge output duplicates criterion id ${criterion.id}.`);
    }
    seen.add(criterion.id);
  }
  const missing = [...expected].filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(`Rubric judge output is missing criterion ids: ${missing.join(", ")}.`);
  }
  return { summary: parsed.summary.trim(), criteria: judged };
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

function parseJudgedCriterion(value: unknown, index: number): RubricJudgedCriterion {
  const record = jsonRecord(value);
  if (!record) {
    throw new Error(`Rubric judge output criteria[${index}] must be an object.`);
  }
  assertExactObjectKeys(record, ["id", "score", "pass", "rationale", "evidence"], `Rubric judge output criteria[${index}]`);
  if (typeof record.id !== "string" || !record.id.trim()) {
    throw new Error(`Rubric judge output criteria[${index}].id must be non-empty.`);
  }
  if (!isBoundedScore(record.score)) {
    throw new Error(`Rubric criterion ${record.id} score must be in the 0..1 range.`);
  }
  if (typeof record.pass !== "boolean") {
    throw new Error(`Rubric criterion ${record.id} pass must be boolean.`);
  }
  if (typeof record.rationale !== "string" || !record.rationale.trim()) {
    throw new Error(`Rubric criterion ${record.id} rationale must be non-empty.`);
  }
  return {
    id: record.id,
    score: record.score,
    pass: record.pass,
    rationale: record.rationale.trim(),
    evidence: parseRubricEvidence(record.evidence, record.id),
  };
}

function parseRubricEvidence(value: unknown, criterionId: string): RubricEvidence[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Rubric criterion ${criterionId} evidence must be an array.`);
  }
  return value.map((entry, index) => {
    const record = jsonRecord(entry);
    if (!record) {
      throw new Error(`Rubric criterion ${criterionId} evidence[${index}] must be an object.`);
    }
    assertExactObjectKeys(record, ["path", "locator", "note"], `Rubric criterion ${criterionId} evidence[${index}]`);
    if (typeof record.path !== "string" || !record.path.trim()) {
      throw new Error(`Rubric criterion ${criterionId} evidence[${index}].path must be non-empty.`);
    }
    if (record.locator !== undefined && (typeof record.locator !== "string" || !record.locator.trim())) {
      throw new Error(`Rubric criterion ${criterionId} evidence[${index}].locator must be non-empty when present.`);
    }
    if (typeof record.note !== "string" || !record.note.trim()) {
      throw new Error(`Rubric criterion ${criterionId} evidence[${index}].note must be non-empty.`);
    }
    return {
      path: record.path.trim(),
      ...(typeof record.locator === "string" ? { locator: record.locator.trim() } : {}),
      note: record.note.trim(),
    };
  });
}

function assertExactObjectKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  const extra = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (extra.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${extra.join(", ")}.`);
  }
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
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error(`${label} output must be a JSON object.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${label} output must parse as a JSON object: ${error instanceof Error ? error.message : String(error)}.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} output must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
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
