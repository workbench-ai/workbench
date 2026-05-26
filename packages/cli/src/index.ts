import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import YAML from "yaml";

import {
  createSubjectFilePreview,
  createBaselineSubjectJob as createRuntimeBaselineSubjectJob,
  evaluationScorecardId,
  executeWorkbenchExecutionJob,
  engineResolveBindingForSpec,
  filterSubjectSourceFiles,
  workbenchExecutionPurpose,
  createWorkbenchAdapterAuthBundle,
  createSubjectEvaluationTraceInputFiles,
  createSubjectRevisionTraceInputFiles,
  DOCKER_SANDBOX_BACKEND,
  localWorkbenchAdapterAuthStore,
  materializeWorkbenchRunResult,
  normalizeSurfaceFiles,
  planWorkbenchExecutionJobsForPurpose,
  runWorkbenchExecutionDag,
  resolveEngineCaseExecutionConfig,
  resolveWorkbenchResolvedSourceYaml,
  summarizeSubjectFiles,
  validateWorkbenchRunEnvelope,
  validateWorkbenchResolvedSourceYaml,
  parseWorkbenchAdapterAuthTarget,
  type SubjectRecord,
  type EngineResolveBinding,
  type WorkbenchExecutionRuntimeInput,
  type HostedWorkbenchJob,
  type Json,
  type RunSummary,
  type RuntimeEvent,
  type SurfaceSnapshotFile,
  type WorkbenchEngineCase,
  type WorkbenchExecutionDagCapacity,
  type WorkbenchAdapterAuthBundle,
  type WorkbenchAdapterAuthTarget,
  type WorkbenchAdapterAuthStatusRecord,
} from "@workbench-ai/workbench-core";
import {
  assertWorkbenchAdapterOperationResultOk,
  collectWorkbenchAdapterAuthRequirements,
  WORKBENCH_ADAPTER_RESULT_FILE,
  WORKBENCH_ADAPTER_RESULT_PROTOCOL,
  normalizeWorkbenchAdapterOperationRequest,
  readWorkbenchAdapterOperationResult,
  workbenchAdapterOperationCommand,
  workbenchAdapterOperationResultPath,
  withDefaultWorkbenchAdapterAuthProfiles as applyDefaultWorkbenchAdapterAuthProfiles,
  type WorkbenchAdapterOperation,
  type WorkbenchAdapterOperationRequest,
} from "@workbench-ai/workbench-protocol";
import {
  builtinLocalTraceAdapter,
  builtinLocalTraceAdapters,
  sortLocalTraceRefs,
  type AgentReadableTraceDigest,
  type LocalTraceAdapter,
  type LocalTraceRef,
} from "@workbench-ai/workbench-built-in-adapters/local-traces";

import {
  commandUsage,
  HOSTED_WATCH_LIFECYCLE_NOTE,
  LOCAL_DEV_OPEN_LIFECYCLE_NOTE,
  rootUsage,
} from "./command-model.js";
import { startLocalWorkbenchDevServer } from "./dev-open-server.js";
import {
  createWorkbenchInitScaffold,
  type InitAgent,
  type InitSubjectKind,
} from "./init-scaffold.js";
import {
  defaultAdapterManifests,
  composeRuntimeDockerfileWithAdapters,
  resolveDefaultWorkbenchAdapter,
  resolveProjectAdapterSource,
  resolveWorkbenchAdaptersForProject,
  WORKBENCH_ADAPTER_MANIFEST_FILE,
  type ResolvedWorkbenchAdapter,
} from "./adapter-project.js";
import { createAdapterCommandEnv } from "./adapter-command-env.js";
import {
  appendLocalRun,
  loadLocalArchive,
  loadLocalArchiveIndex,
  materializeSubjectRoot,
  readLocalSubject,
  readLocalSubjectFiles,
  saveLocalArchive,
  saveLocalJobs,
  setLocalActive,
  upsertLocalSubject,
  upsertLocalEvaluation,
} from "./local-archive.js";
import {
  readSnapshotFiles,
  WorkspaceSnapshotError,
  type WorkspaceSnapshotFile,
} from "./workspace-snapshot.js";
import {
  readLocalProjectSource,
  WORKBENCH_BENCHMARK_FILE,
  type LocalProjectSource,
} from "./project-source.js";
import {
  localBenchmarkFingerprint,
  localSubjectFingerprint,
} from "./benchmark-fingerprint.js";

interface CliIo {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

interface WorkbenchConfig {
  baseUrl?: string;
  accessToken?: string;
}

interface WorkbenchOrigin {
  baseUrl: string;
  owner: string;
  project: string;
  projectId: string;
  writable: boolean;
  sourceRevisionId?: string;
  sourceFingerprint?: string;
  upstream?: {
    owner: string;
    project: string;
    projectId: string;
    sourceRevisionId: string;
  };
  linkedAt: string;
}

interface CliRuntimeOptions {}

type HostedRunWorkflow = "eval" | "improve";

const require = createRequire(import.meta.url);

function getCliVersion(): string {
  const manifest = require("../package.json") as { version?: unknown };
  return typeof manifest.version === "string" ? manifest.version : "unknown";
}

interface HostedTarget {
  projectId: string;
  owner?: string;
  projectName?: string;
  dir: string;
  baseUrl: string;
  origin?: WorkbenchOrigin | null;
}

interface HostedDryRunTarget {
  projectRef: string;
  projectId?: string;
  owner?: string;
  projectName?: string;
  dir: string;
  baseUrl: string;
  origin?: WorkbenchOrigin | null;
}

interface HostedProjectSummary {
  id?: string;
  ownerUsername?: string;
  name?: string;
  visibility?: "private" | "public";
  currentSpecVersionId?: string;
  sourceFingerprint?: string;
  activeSubjectId?: string | null;
  starCount?: number;
  runs?: unknown[];
  subjects?: unknown[];
}

interface WorkbenchResourceUrls {
  benchmark: string;
  subjectEvaluation?: string;
}

interface WorkbenchCheckPlan {
  benchmarkName: string;
  benchmarkDescription: string;
  source: {
    files: number;
    yaml: string[];
    dockerfile: string;
  };
  subject: {
    filesPath: string;
    files: number;
  };
  optimizer: {
    edits: string[];
  } | null;
  engine: {
    resolver: WorkbenchAdapterSummary;
    path: string;
    cases: number;
    files: number;
  };
  environment: {
    dockerfile: string;
    network: {
      egress: "none" | "open";
    };
    resources: {
      cpu: number;
      memoryGb: number;
      diskGb: number;
      timeoutMinutes: number;
    };
  };
  adapters: {
    improve: WorkbenchAdapterSummary | null;
    run: WorkbenchAdapterSummary;
    engine: WorkbenchAdapterSummary;
    sources: WorkbenchAdapterSourceSummary[];
  };
}

class WorkbenchApiRequestError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, message: string, body: string) {
    super(message);
    this.name = "WorkbenchApiRequestError";
    this.status = status;
    this.body = body;
  }
}

interface WorkbenchAdapterSummary {
  use: string;
  model?: string;
  command?: string;
  judge?: string;
  criteria?: number;
}

interface WorkbenchAdapterSourceSummary {
  id: string;
  kind: string;
  declaredSource: string;
  resolvedSource: string;
  stability: "default" | "local" | "pinned" | "floating";
  overridesDefault?: boolean;
}

type HostedFile = WorkspaceSnapshotFile;

interface HostedSourceResponse {
  files: HostedFile[];
  benchmark?: HostedProjectSummary;
}

interface HostedRunRecord {
  id: string;
  status: string;
  workflow?: HostedRunWorkflow;
  subjectId: string | null;
  activeSubjectId?: string | null;
  outputSubjectId?: string | null;
  jobCount?: number;
  attemptsRequested?: number;
  attemptsExecuted?: number;
  samples?: number;
  completedJobCount?: number;
  failedJobCount?: number;
  durationMs?: number;
  outcome?: "ok" | "error" | "cancelled" | string | null;
  stoppedReason?: string;
  error?: string;
  urls?: WorkbenchResourceUrls;
}

interface HostedRunJobRecord {
  id: string;
  runId?: string;
  kind?: string;
  status: string;
  subjectId?: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt?: string;
  input?: Json;
  output?: Json;
  error?: string;
}

interface LocalDevViewHint {
  command: string;
  note: string;
}

const DEFAULT_BASE_URL = "https://v2.workbench.ai";
export async function runCli(
  argv: readonly string[],
  io: CliIo = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  },
  runtimeOptions: CliRuntimeOptions = {},
): Promise<number> {
  try {
    if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
      io.stdout.write(`${rootUsage}\n`);
      return 0;
    }
    if (argv[0] === "--version" || argv[0] === "-v") {
      io.stdout.write(`workbench ${getCliVersion()}\n`);
      return 0;
    }
    if (argv.includes("--help") || argv.includes("-h")) {
      const commandPath = commandPathForHelp(argv);
      const usage = commandUsage(commandPath);
      if (!usage) {
        throw new UsageError(
          `Unknown command: ${commandPath || argv.join(" ")}`,
        );
      }
      io.stdout.write(`${usage}\n`);
      return 0;
    }

    if (argv[0] === "init") {
      return await localInit(argv.slice(1), io);
    }
    if (argv[0] === "check") {
      return await localValidate(argv.slice(1), io);
    }
    if (argv[0] === "login") {
      return await login(argv.slice(1), io);
    }
    if (argv[0] === "logout") {
      return await logout(argv.slice(1), io);
    }
    if (argv[0] === "whoami") {
      return await authStatus(argv.slice(1), io);
    }
    if (argv[0] === "clone") {
      return await cloneProject(argv.slice(1), io);
    }
    if (argv[0] === "fetch") {
      return await fetchProject(argv.slice(1), io);
    }
    if (argv[0] === "pull") {
      return await pullProject(argv.slice(1), io);
    }
    if (argv[0] === "push") {
      return await pushBenchmark(argv.slice(1), io);
    }
    if (argv[0] === "remote") {
      return await runRemoteCommand(argv.slice(1), io);
    }
    if (argv[0] === "eval") {
      return await localEvaluateSubject(argv.slice(1), io, runtimeOptions);
    }
    if (argv[0] === "improve") {
      return await localRun(argv.slice(1), io, runtimeOptions);
    }
    if (argv[0] === "restore") {
      return await localRestore(argv.slice(1), io);
    }
    if (argv[0] === "open") {
      return await localDevOpen(argv.slice(1), io);
    }
    if (argv[0] === "auth") {
      return await runAuthCommand(argv.slice(1), io);
    }
    if (argv[0] === "adapters") {
      return await runAdaptersCommand(argv.slice(1), io);
    }
    if (argv[0] === "traces") {
      return await runTracesCommand(argv.slice(1), io);
    }
    if (argv[0] === "cloud") {
      return await runCloudCommand(argv.slice(1), io);
    }

    const commandPath = argv.slice(0, 2).join(" ");
    const rest = argv.slice(2);
    switch (commandPath) {
      case "runs list":
        return await localRunList(rest, io);
      case "runs show":
        return await localRunShow(rest, io);
      case "subjects list":
        return await localSubjectList(rest, io);
      case "subjects show":
        return await localSubjectShow(rest, io);
      case "subjects files":
        return await localSubjectFiles(rest, io);
      case "subjects preview":
        return await localSubjectPreview(rest, io);
      default:
        break;
    }

    throw new UsageError(`Unknown command: ${argv.join(" ")}`);
  } catch (error) {
    const jsonRequested = argv.includes("--json");
    const message = error instanceof Error ? error.message : String(error);
    if (jsonRequested) {
      io.stdout.write(
        `${JSON.stringify({ ok: false, error: message }, null, 2)}\n`,
      );
    } else {
      const usage = commandUsage(commandPathForHelp(argv)) ?? rootUsage;
      io.stderr.write(`${message}\n\n${usage}\n`);
    }
    return error instanceof UsageError || error instanceof WorkspaceSnapshotError ? 2 : 1;
  }
}

function commandPathForHelp(argv: readonly string[]): string {
  const positionals = argv.filter(
    (arg) => arg !== "--help" && arg !== "-h" && !arg.startsWith("--"),
  );
  if (positionals[0] === "cloud") {
    return positionals.slice(0, 3).join(" ");
  }
  if (
    positionals[0] === "adapters" &&
    ["create", "list", "inspect", "test"].includes(positionals[1] ?? "")
  ) {
    return positionals.slice(0, 2).join(" ");
  }
  if (
    positionals[0] === "traces" &&
    ["collect", "list", "show"].includes(positionals[1] ?? "")
  ) {
    return positionals.slice(0, 2).join(" ");
  }
  if (positionals[0] === "auth" || positionals[0] === "remote") {
    return positionals.slice(0, 2).join(" ");
  }
  if (
    positionals[0] === "runs" &&
    ["list", "show"].includes(positionals[1] ?? "")
  ) {
    return positionals.slice(0, 2).join(" ");
  }
  if (
    positionals[0] === "subjects" &&
    ["list", "show", "files", "preview"].includes(positionals[1] ?? "")
  ) {
    return positionals.slice(0, 2).join(" ");
  }
  return positionals[0] ?? "";
}

async function runCloudCommand(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const command = argv[0];
  const rest = argv.slice(1);
  switch (command) {
    case "eval":
      return await startHostedWorkflow("eval", rest, io);
    case "improve":
      return await startHostedWorkflow("improve", rest, io);
    case "open":
      return await openWorkbench(rest, io);
    case "watch":
      return await runWatch(rest, io);
    case "logs":
      return await runLogs(rest, io);
    case "star":
      return await starProject(rest, io, true);
    case "unstar":
      return await starProject(rest, io, false);
    default:
      break;
  }

  const commandPath = argv.slice(0, 2).join(" ");
  const subRest = argv.slice(2);
  switch (commandPath) {
    case "benchmarks list":
      return await benchmarkList(subRest, io);
    case "benchmarks show":
      return await benchmarkShow(subRest, io);
    case "benchmarks versions":
      return await benchmarkVersions(subRest, io);
    case "benchmarks starred":
      return await benchmarkStarred(subRest, io);
    case "benchmarks delete":
      return await benchmarkDelete(subRest, io);
    case "runs list":
      return await runList(subRest, io);
    case "runs show":
      return await runShow(subRest, io);
    case "runs cancel":
      return await runCancel(subRest, io);
    case "subjects list":
      return await subjectList(subRest, io);
    case "subjects show":
      return await subjectShow(subRest, io);
    case "subjects files":
      return await subjectFiles(subRest, io);
    case "subjects preview":
      return await subjectPreview(subRest, io);
    case "subjects pull":
      return await subjectExport(subRest, io);
    case "subjects publish":
      return await subjectVisibility(subRest, io, "public");
    case "subjects unpublish":
      return await subjectVisibility(subRest, io, "private");
    default:
      throw new UsageError(`Unknown command: cloud ${argv.join(" ")}`);
  }
}

async function localDevOpen(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "host", "port", "run", "no-open", "json"]));
  if (parsed.positionals.length > 1) {
    throw new UsageError("workbench open accepts at most one source file or directory argument.");
  }
  const workspace = resolveSourceDir(parsed);
  const host = readOptionalStringFlag(parsed.flags.host, "host") ?? "127.0.0.1";
  const port = parsePortFlag(parsed.flags.port);
  const requestedRunId = asOptionalString(parsed.flags.run);
  const snapshot = await loadLocalArchiveIndex(workspace);
  const latestRunId = snapshot.runs.at(-1)?.id ?? null;
  const runId = requestedRunId ?? latestRunId;
  if (requestedRunId && !snapshot.runs.some((run) => run.id === requestedRunId)) {
    throw new UsageError(`Run not found: ${requestedRunId}`);
  }
  const server = await startLocalWorkbenchDevServer({
    workspace,
    host,
    port,
  });
  const url = localDevOpenUrl(server.url, snapshot, runId);
  const result = {
    ok: true,
    url,
    workspaceRoot: path.resolve(workspace),
    note: LOCAL_DEV_OPEN_LIFECYCLE_NOTE,
  };
  writeOutput(
    result,
    parsed,
    io,
    (value) =>
      `Workbench open: ${value.url}\nWorkspace: ${value.workspaceRoot}\n${value.note}`,
  );
  if (parsed.flags["no-open"] !== true) {
    await openBrowser(url).catch(() => undefined);
  }
  await waitForDevOpenShutdown(server);
  return 0;
}

async function waitForDevOpenShutdown(server: {
  close: () => Promise<void>;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let closing = false;
    const close = () => {
      if (closing) {
        return;
      }
      closing = true;
      process.off("SIGINT", close);
      process.off("SIGTERM", close);
      server.close().then(resolve, reject);
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

async function localInit(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(
    parsed,
    new Set([
      "skill",
      "command",
      "agent",
      "from",
      "example",
      "dir",
      "json",
    ]),
  );
  const { kind, name } = readInitSelection(parsed);
  const agent = readInitAgent(parsed, kind);
  const workspace = resolveDir(parsed, parsed.positionals[0]);
  const scaffold = createWorkbenchInitScaffold({
    kind,
    name,
    ...(agent ? { agent } : {}),
    example: parsed.flags.example === true,
  });
  await fs.mkdir(workspace, { recursive: true });
  await copyInitSeedIfProvided(parsed, workspace, {
    fileTarget: scaffold.seedFileTarget,
    directoryTarget: scaffold.seedDirectoryTarget,
  });
  for (const file of scaffold.files) {
    await writeFileIfMissing(path.join(workspace, file.path), file.content);
  }
  const specPath = path.join(workspace, WORKBENCH_BENCHMARK_FILE);
  writeOutput(
    {
      ok: true,
      dir: workspace,
      specPath,
      kind: scaffold.kind,
      name: scaffold.name,
      subjectRoot: scaffold.subjectRoot,
    },
    parsed,
    io,
    () =>
      `Initialized ${scaffold.kind} Workbench source directory at ${workspace}`,
  );
  return 0;
}

async function localValidate(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  const sourceArg = resolveSourceDir(parsed);
  const validation = await readLocalProjectSource(sourceArg)
    .then((projectSource) => ({
      ok: true,
      errors: [],
      warnings: [],
      dir: projectSource.dir,
      specPath: projectSource.specPath,
      plan: buildWorkbenchCheckPlan(projectSource),
    }))
    .catch((error: unknown) => ({
      ok: false,
      errors: splitWorkspaceError(error),
      warnings: [],
    }));
  const output: unknown = validation;
  writeOutput(output, parsed, io, (record) => {
    const result = record as {
      ok: boolean;
      errors: string[];
      warnings: string[];
      plan?: WorkbenchCheckPlan;
    };
    if (!result.ok) {
      return `Spec is invalid:\n${result.errors.map((entry) => `- ${entry}`).join("\n")}`;
    }
    const warningSuffix = result.warnings.length
      ? ` with ${result.warnings.length} warning(s)`
      : "";
    return result.plan
      ? formatWorkbenchCheckPlan(result.plan, warningSuffix)
      : `Spec is valid${warningSuffix}.`;
  });
  return validation.ok ? 0 : 1;
}

function buildWorkbenchCheckPlan(source: LocalProjectSource): WorkbenchCheckPlan {
  return {
    benchmarkName: source.spec.name,
    benchmarkDescription: source.spec.description,
    source: {
      files: sourceFileCount(source),
      yaml: [
        path.relative(source.dir, source.benchmarkPath) || "benchmark.yaml",
        path.relative(source.dir, source.subjectSpecPath) || "subject YAML",
        ...(source.optimizerSource !== undefined
          ? [path.relative(source.dir, source.optimizerPath ?? "") || "optimizer YAML"]
          : []),
      ],
      dockerfile: source.dockerfilePath,
    },
    subject: {
      filesPath: source.spec.subject.files.path,
      files: source.subjectFiles.length,
    },
    optimizer: source.spec.optimizer
      ? {
          edits: [...source.spec.optimizer.edits],
        }
      : null,
    engine: {
      resolver: adapterSummary(source.engineResolve),
      path: source.engineResolveFingerprintPath,
      cases: source.caseIds.length,
      files: source.engineResolveFiles.length,
    },
    environment: {
      dockerfile: source.dockerfilePath,
      network: runtimeNetworkSummary(source.spec.environment.network),
      resources: runtimeResourceSummary(source.spec.environment.resources),
    },
    adapters: {
      improve: source.spec.improve ? adapterSummary(source.spec.improve) : null,
      run: adapterSummary(source.spec.run),
      engine: adapterSummary(source.spec.engineRun),
      sources: source.adapters.map(adapterSourceSummary),
    },
  };
}

function formatWorkbenchCheckPlan(
  plan: WorkbenchCheckPlan,
  warningSuffix: string,
): string {
  const edits = plan.optimizer?.edits.length
    ? plan.optimizer.edits.join(", ")
    : "-";
  const network = plan.environment.network.egress;
  const resources = plan.environment.resources;
  return [
    `Spec is valid${warningSuffix}.`,
    `Benchmark: ${plan.benchmarkName}`,
    `Description: ${plan.benchmarkDescription}`,
    `Source: ${plan.source.files} file(s) (${plan.source.yaml.join(", ")}, ${plan.source.dockerfile})`,
    `Subject files: ${plan.subject.filesPath} (${plan.subject.files} file(s))`,
    `Optimizer edits: ${edits}`,
    `Engine cases: ${plan.engine.cases} case(s) from ${formatAdapterSummary(plan.engine.resolver)} at ${plan.engine.path} (${plan.engine.files} file(s))`,
    `Environment: ${plan.environment.dockerfile}, network ${network}, ${resources.cpu} CPU, ${resources.memoryGb}GB RAM, ${resources.timeoutMinutes}m timeout`,
    `Execution: improve ${plan.adapters.improve ? formatAdapterSummary(plan.adapters.improve) : "not configured"}, subject ${formatAdapterSummary(plan.adapters.run)}, engine ${formatAdapterSummary(plan.adapters.engine)}`,
    ...adapterSourceLines(plan.adapters.sources),
  ].join("\n");
}

function adapterSummary(adapter: {
  use: string;
  with: Json;
}): WorkbenchAdapterSummary {
  const config = readRecord(adapter.with) ?? {};
  const summary: WorkbenchAdapterSummary = { use: adapter.use };
  if (typeof config.model === "string" && config.model) {
    summary.model = config.model;
  }
  if (typeof config.command === "string" && config.command) {
    summary.command = config.command;
  }
  const judge = readRecord(config.judge);
  if (typeof judge?.use === "string" && judge.use) {
    summary.judge = judge.use;
  }
  if (Array.isArray(config.criteria)) {
    summary.criteria = config.criteria.length;
  }
  return summary;
}

function formatAdapterSummary(summary: WorkbenchAdapterSummary): string {
  const details = [
    summary.model,
    summary.judge ? `judge ${summary.judge}` : "",
    summary.criteria === undefined ? "" : `${summary.criteria} criteria`,
    summary.command ? truncateCommand(summary.command) : "",
  ].filter(Boolean);
  return details.length ? `${summary.use} (${details.join(", ")})` : summary.use;
}

function adapterSourceSummary(adapter: ResolvedWorkbenchAdapter): WorkbenchAdapterSourceSummary {
  return {
    id: adapter.manifest.id,
    kind: adapter.kind,
    declaredSource: adapter.declaredSource,
    resolvedSource: adapter.source,
    stability: adapter.stability,
    ...(adapter.overridesDefault ? { overridesDefault: true } : {}),
  };
}

function adapterSourceLines(sources: readonly WorkbenchAdapterSourceSummary[]): string[] {
  const external = sources.filter((source) => source.kind !== "default");
  if (external.length === 0) {
    return [];
  }
  return [
    `Adapter sources: ${external.map(formatAdapterSourceSummary).join("; ")}`,
  ];
}

function formatAdapterSourceSummary(source: WorkbenchAdapterSourceSummary): string {
  const override = source.overridesDefault ? " overrides default" : "";
  return `${source.id} ${source.stability}${override} ${formatAdapterResolution(source)}`;
}

function formatAdapterResolution(source: {
  declaredSource: string;
  resolvedSource: string;
}): string {
  const resolution = source.declaredSource === source.resolvedSource
    ? source.declaredSource
    : `${source.declaredSource} -> ${source.resolvedSource}`;
  return resolution;
}

function truncateCommand(command: string): string {
  return command.length > 80 ? `${command.slice(0, 77)}...` : command;
}

function runtimeNetworkSummary(configValue: unknown): WorkbenchCheckPlan["environment"]["network"] {
  const network = readRecord(configValue) ?? {};
  return { egress: network.egress === "none" ? "none" : "open" };
}

function runtimeResourceSummary(configValue: unknown): WorkbenchCheckPlan["environment"]["resources"] {
  const resources = readRecord(configValue) ?? {};
  return {
    cpu: readPositiveNumber(resources.cpu, 2),
    memoryGb: readPositiveNumber(resources.memoryGb, 4),
    diskGb: readPositiveNumber(resources.diskGb, 10),
    timeoutMinutes: readPositiveNumber(resources.timeoutMinutes, 20),
  };
}

function readPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function splitWorkspaceError(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\n+/u).map((entry) => entry.trim()).filter(Boolean);
}

async function localRun(
  argv: readonly string[],
  io: CliIo,
  runtimeOptions: CliRuntimeOptions,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "optimizer", "from", "budget", "samples", "json"]));
  const budget = parsePositiveInt(parsed.flags.budget, 1, "budget");
  const samples = parsePositiveInt(parsed.flags.samples, 1, "samples");
  const sourceArg = resolveSourceDir(parsed);
  const projectSource = await readLocalProjectSource(sourceArg, {
    optimizerPath: asOptionalString(parsed.flags.optimizer),
  });
  const workspace = projectSource.dir;
  if (!projectSource.spec.optimizer) {
    throw new UsageError("Optimizer YAML is required for workbench improve.");
  }
  const executionProject = await resolveLocalProjectForExecution(workspace, projectSource.specSource);
  const { spec, adapterManifests } = executionProject;
  const engineResolveFiles = normalizeSurfaceFiles(projectSource.engineResolveFiles);
  const engineCases = projectSource.engineCases;
  const caseIds = engineCases.map((bundle) => bundle.id);
  if (caseIds.length === 0) {
    throw new UsageError("Engine resolver must emit at least one case.");
  }
  requireValidRunEnvelope({
    workflow: "improve",
    budget,
    samples,
    caseCount: caseIds.length,
  });
  const environmentRefs = await ensureLocalDockerfileEnvironments(
    workspace,
    spec,
    engineCases,
  );
  const benchmarkFingerprint = await readLocalBenchmarkFingerprint(workspace);
  const runId = `run_local_${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();
  let snapshot = await loadLocalArchive(workspace);
  const baseSubject = await ensureLocalImproveBaseSubject({
    parsed,
    sourceArg,
    workspace,
    projectSource,
    samples,
    io,
    runtimeOptions,
  });
  let currentBaseId = baseSubject.id;
  let completedJobCount = 0;
  let failedJobCount = 0;
  const failedJobs: Array<{
    id: string;
    purpose: string | null;
    error: string;
  }> = [];
  const events: RuntimeEvent[] = [
    createLocalEvent("run_started", startedAt, {
      runId,
      detail: { budget, samples, strategy: "greedy" },
    }),
  ];
  const devCapacity = await localDevelopmentCapacity(workspace);
  const runTraceJobs: HostedWorkbenchJob[] = [];
  const attempts = budget;
  for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex += 1) {
    snapshot = await loadLocalArchive(workspace);
    const activeSubject = readLocalSubject(snapshot, currentBaseId);
    const baseFiles = filterSubjectSourceFiles(
      readLocalSubjectFiles(snapshot, activeSubject.id),
    );
    if (baseFiles.length === 0) {
      throw new UsageError(
        "Subject snapshot must include at least one file.",
      );
    }
    const subjectRevisionTraceFiles = [
      ...createSubjectEvaluationTraceInputFiles({ subject: activeSubject }),
      ...createSubjectRevisionTraceInputFiles({
        runId,
        jobs: runTraceJobs,
        events,
      }),
    ];
    const subjectId = `subject_${runId.replace(/^run_/u, "")}_${String(attemptIndex + 1).padStart(3, "0")}`;
    const plannedSubjectRevision = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "local",
      projectId: "local",
      runId,
      subjectId,
      attemptIndex,
      samples,
      caseIds,
      engineCases,
      spec,
      workflow: "improve",
      purpose: "improve",
      now: new Date().toISOString(),
      baseFiles,
      traceFiles: subjectRevisionTraceFiles,
      ...(environmentRefs.defaultRef ? { environmentRef: environmentRefs.defaultRef } : {}),
      baseId: activeSubject.id,
    })[0]!;
    const subjectRevisionJobs = await executeLocalDevelopmentDag({
      jobs: [plannedSubjectRevision],
      spec,
      adapterManifests,
      adapterFiles: normalizeSurfaceFiles(projectSource.adapterFiles),
      baseFiles,
      engineResolveFiles,
      engineCases,
      traceFiles: subjectRevisionTraceFiles,
      capacity: devCapacity,
    });
    const subjectRevision = subjectRevisionJobs[0]!;
    const completedJobs: HostedWorkbenchJob[] = [subjectRevision];
    if (subjectRevision.status === "succeeded") {
      const subjectRevisionFiles =
        completedJobOutputFiles(subjectRevision).length > 0
          ? normalizeSurfaceFiles(
              completedJobOutputFiles(subjectRevision).filter(
                (file) => !file.path.startsWith(".workbench/"),
              ),
            )
          : baseFiles;
      const attemptJobs = planWorkbenchExecutionJobsForPurpose({
        ownerUserId: "local",
        projectId: "local",
        runId,
        subjectId,
        attemptIndex,
        samples,
        now: new Date().toISOString(),
        caseIds,
        engineCases,
        spec,
        environmentRefsByCase: environmentRefs.byCase,
        workflow: "improve",
        purpose: "attempt",
      });
      const dagJobs = await executeLocalDevelopmentDag({
        jobs: [subjectRevision, ...attemptJobs],
        spec,
        adapterManifests,
        adapterFiles: normalizeSurfaceFiles(projectSource.adapterFiles),
        baseFiles: subjectRevisionFiles,
        engineResolveFiles,
        engineCases,
        capacity: devCapacity,
      });
      completedJobs.splice(0, completedJobs.length, ...dagJobs);
    }
    runTraceJobs.push(...completedJobs);
    const materialized = materializeWorkbenchRunResult({
      runId,
      benchmarkFingerprint,
      sourceYaml: projectSource.specSource,
      benchmarkSourceFiles: authoredBenchmarkSourceFiles(projectSource),
      startedAt,
      spec,
      jobs: completedJobs,
      previousSubject: activeSubject,
      existingSubjectCount: snapshot.subjects.length,
    });
    for (const subject of materialized.subjects) {
      snapshot = upsertLocalSubject(
        snapshot,
        subject,
        materialized.subjectFiles[subject.id] ?? [],
      );
      events.push(
        createLocalEvent("subject_created", subject.createdAt, {
          runId,
          subjectId: subject.id,
          baseId: subject.baseId,
          status: subject.status,
          metrics: subject.metrics,
        }),
      );
    }
    for (const evaluation of materialized.evaluations) {
      snapshot = upsertLocalEvaluation(snapshot, evaluation);
    }
    snapshot = setLocalActive(snapshot, materialized.activeSubjectId);
    currentBaseId = materialized.activeSubjectId ?? currentBaseId;
    completedJobCount += materialized.completedJobCount;
    failedJobCount += materialized.failedJobCount;
    failedJobs.push(
      ...completedJobs
        .filter((job) => job.status === "failed")
        .map((job) => ({
          id: job.id,
          purpose: workbenchExecutionPurpose(job),
          error: job.error ?? "Job failed without an error message.",
        })),
    );
    events.push(
      createLocalEvent("active_changed", new Date().toISOString(), {
        runId,
        subjectId: materialized.activeSubjectId ?? undefined,
        activeId: materialized.activeSubjectId ?? undefined,
        status: materialized.selectedSubject?.status,
        metrics: materialized.selectedSubject?.metrics,
      }),
    );
    await saveLocalJobs(workspace, completedJobs);
    await saveLocalArchive(workspace, snapshot);
  }
  snapshot = await loadLocalArchive(workspace);
  const finishedAt = new Date().toISOString();
  const run: RunSummary = {
    id: runId,
    workflow: "improve",
    benchmarkFingerprint,
    status: "finished",
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    optimizer: formatSpecOptimizer(spec),
    engineRun: spec.engineRun.use,
    strategy: "greedy",
    budget,
    repairBudget: 0,
    attemptsRequested: budget,
    attemptsExecuted: budget,
    samples,
    stoppedReason: "budget_exhausted",
    outcome: failedJobCount > 0 ? "error" : "ok",
  };
  events.push(
    createLocalEvent("run_finished", finishedAt, {
      runId,
      detail: {
        outcome: run.outcome ?? null,
        attemptsExecuted: run.attemptsExecuted,
        durationMs: run.durationMs ?? null,
      },
    }),
  );
  snapshot = appendLocalRun(snapshot, run, events);
  await saveLocalArchive(workspace, snapshot);
  const selected = snapshot.activeId
    ? readLocalSubject(snapshot, snapshot.activeId)
    : null;
  const result = {
    ok: failedJobCount === 0,
    runId,
    activeSubjectId: snapshot.activeId,
    selectedSubject: selected,
    completedJobCount,
    failedJobCount,
    failedJobs,
    localView: localDevViewHint(workspace, runId),
  };
  writeOutput(result, parsed, io, () => {
    const metricValue =
      selected?.metrics?.score ?? "n/a";
    const firstFailure = result.failedJobs[0];
    const failureDetail = firstFailure
      ? `\nFirst failed job ${firstFailure.id}${firstFailure.purpose ? ` (${firstFailure.purpose})` : ""}: ${firstFailure.error}`
      : "";
    const viewDetail = failedJobCount === 0
      ? `\nOpen local view: ${result.localView.command}\n${result.localView.note}`
      : "";
    return `Run ${runId} finished. Active subject: ${snapshot.activeId ?? "none"} (score: ${metricValue}).${failureDetail}${viewDetail}`;
  });
  return failedJobCount === 0 ? 0 : 1;
}

async function ensureLocalImproveBaseSubject(args: {
  parsed: ParsedArgs;
  sourceArg: string;
  workspace: string;
  projectSource: LocalProjectSource;
  samples: number;
  io: CliIo;
  runtimeOptions: CliRuntimeOptions;
}): Promise<SubjectRecord> {
  let snapshot = await loadLocalArchive(args.workspace);
  const explicitBase = asOptionalString(args.parsed.flags.from);
  const benchmarkFingerprint = await readLocalBenchmarkFingerprint(args.workspace);
  if (explicitBase) {
    let subject = readLocalSubject(snapshot, explicitBase);
    if (subject.benchmarkFingerprint !== benchmarkFingerprint) {
      throw new UsageError(
        `Base subject ${explicitBase} belongs to benchmark ${subject.benchmarkFingerprint}, not ${benchmarkFingerprint}.`,
      );
    }
    if (!subject.subjectFingerprint) {
      throw new UsageError(`Base subject ${explicitBase} is missing a subject fingerprint.`);
    }
    if (subject.status !== "evaluated" && !subject.eval) {
      const code = await localEvaluateSubject(
        ["--dir", args.workspace, "--subject", explicitBase, "--samples", String(args.samples), "--json"],
        createSilentIo(args.io),
        args.runtimeOptions,
      );
      if (code !== 0) {
        throw new UsageError(`Base subject ${explicitBase} eval failed; improve was not started.`);
      }
      snapshot = await loadLocalArchive(args.workspace);
      subject = readLocalSubject(snapshot, explicitBase);
    }
    return subject;
  }

  const subjectFingerprint = localSubjectFingerprint(args.projectSource);
  const existing = snapshot.subjects.find((subject) =>
    subject.benchmarkFingerprint === benchmarkFingerprint &&
    subject.subjectFingerprint === subjectFingerprint &&
    (subject.status === "evaluated" || Boolean(subject.eval))
  );
  if (existing) {
    return existing;
  }

  const evalArgs = args.parsed.positionals.length > 0
    ? [args.sourceArg, "--samples", String(args.samples), "--json"]
    : ["--dir", args.workspace, "--samples", String(args.samples), "--json"];
  const code = await localEvaluateSubject(evalArgs, createSilentIo(args.io), args.runtimeOptions);
  if (code !== 0) {
    throw new UsageError("Parent subject eval failed; improve was not started.");
  }
  snapshot = await loadLocalArchive(args.workspace);
  const evaluated = snapshot.subjects.find((subject) =>
    subject.benchmarkFingerprint === benchmarkFingerprint &&
    subject.subjectFingerprint === subjectFingerprint &&
    (subject.status === "evaluated" || Boolean(subject.eval))
  );
  if (!evaluated) {
    throw new UsageError("Parent subject eval did not produce an evaluated subject.");
  }
  return evaluated;
}

function createSilentIo(io: CliIo): CliIo {
  const sink = new class extends Writable {
    override _write(
      _chunk: unknown,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void,
    ): void {
      callback();
    }
  }();
  return {
    stdin: io.stdin,
    stdout: sink,
    stderr: io.stderr,
  };
}

async function localEvaluateSubject(
  argv: readonly string[],
  io: CliIo,
  runtimeOptions: CliRuntimeOptions,
): Promise<number> {
  void runtimeOptions;
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "subject", "samples", "json"]));
  const samples = parsePositiveInt(parsed.flags.samples, 1, "samples");
  const sourceArg = resolveSourceDir(parsed);
  const projectSource = await readLocalProjectSource(sourceArg);
  const workspace = projectSource.dir;
  const executionProject = await resolveLocalProjectForExecution(workspace, projectSource.specSource);
  const { spec, adapterManifests } = executionProject;
  const engineResolveFiles = normalizeSurfaceFiles(projectSource.engineResolveFiles);
  const engineCases = projectSource.engineCases;
  const caseIds = engineCases.map((bundle) => bundle.id);
  if (caseIds.length === 0) {
    throw new UsageError("Engine resolver must emit at least one case.");
  }
  requireValidRunEnvelope({
    workflow: "eval",
    budget: 1,
    samples,
    caseCount: caseIds.length,
  });
  const environmentRefs = await ensureLocalDockerfileEnvironments(
    workspace,
    spec,
    engineCases,
  );
  let snapshot = await loadLocalArchive(workspace);
  const benchmarkFingerprint = await readLocalBenchmarkFingerprint(workspace);
  const sourceSubjectFingerprint = localSubjectFingerprint(projectSource);
  const explicitSubjectId = asOptionalString(parsed.flags.subject);
  const existingSourceSubject = snapshot.subjects.find((subject) =>
    subject.benchmarkFingerprint === benchmarkFingerprint &&
    subject.subjectFingerprint === sourceSubjectFingerprint
  );
  const subjectId = explicitSubjectId ?? existingSourceSubject?.id ?? `subject_${sourceSubjectFingerprint.slice(0, 12)}`;
  const existingSubject = snapshot.subjects.find((subject) => subject.id === subjectId);
  const files = filterSubjectSourceFiles(
    existingSubject
      ? readLocalSubjectFiles(snapshot, subjectId)
      : normalizeSurfaceFiles(projectSource.subjectFiles),
  );
  const runId = `eval_local_${Date.now().toString(36)}`;
  const evaluatedSubjectId = subjectId;
  const startedAt = new Date().toISOString();
  const baseline = createRuntimeBaselineSubjectJob({
    ownerUserId: "local",
    projectId: "local",
    runId,
    subjectId: evaluatedSubjectId,
    attemptIndex: 0,
    files,
    now: startedAt,
    baseId: null,
  });
  const completedJobs: HostedWorkbenchJob[] = [baseline];
  const attemptJobs = planWorkbenchExecutionJobsForPurpose({
    ownerUserId: "local",
    projectId: "local",
    runId,
    subjectId: evaluatedSubjectId,
    attemptIndex: 0,
    samples,
    now: startedAt,
    caseIds,
    engineCases,
    spec,
    environmentRefsByCase: environmentRefs.byCase,
    workflow: "eval",
    purpose: "attempt",
  });
  const dagJobs = await executeLocalDevelopmentDag({
    jobs: [baseline, ...attemptJobs],
    spec,
    adapterManifests,
    adapterFiles: normalizeSurfaceFiles(projectSource.adapterFiles),
    baseFiles: files,
    engineResolveFiles,
    engineCases,
    capacity: await localDevelopmentCapacity(workspace),
  });
  completedJobs.splice(0, completedJobs.length, ...dagJobs);
  const materialized = materializeWorkbenchRunResult({
    runId,
    benchmarkFingerprint,
    sourceYaml: projectSource.specSource,
    benchmarkSourceFiles: authoredBenchmarkSourceFiles(projectSource),
    subjectFingerprint: existingSubject?.subjectFingerprint ?? sourceSubjectFingerprint,
    ...(!existingSubject || existingSubject.subjectFingerprint === sourceSubjectFingerprint
      ? { subjectSourceFiles: authoredSubjectSourceFiles(projectSource) }
      : {}),
    startedAt,
    spec,
    jobs: completedJobs,
    previousSubject: null,
    existingSubjectCount: snapshot.subjects.length,
  });
  for (const subjectRecord of materialized.subjects) {
    snapshot = upsertLocalSubject(
      snapshot,
      subjectRecord,
      materialized.subjectFiles[subjectRecord.id] ?? [],
    );
  }
  if (materialized.activeSubjectId) {
    snapshot = setLocalActive(snapshot, materialized.activeSubjectId);
  }
  for (const evaluation of materialized.evaluations) {
    snapshot = upsertLocalEvaluation(snapshot, evaluation);
  }
  const finishedAt = new Date().toISOString();
  snapshot = appendLocalRun(snapshot, {
    id: runId,
    workflow: "eval",
    benchmarkFingerprint,
    status: "finished",
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    optimizer: "none",
    engineRun: spec.engineRun.use,
    strategy: "direct",
    budget: 1,
    repairBudget: 0,
    attemptsRequested: 1,
    attemptsExecuted: 1,
    samples,
    stoppedReason: "completed",
    outcome: materialized.failedJobCount > 0 ? "error" : "ok",
  }, []);
  await saveLocalJobs(workspace, completedJobs);
  await saveLocalArchive(workspace, snapshot);
  const evaluation = materialized.evaluations[0] ?? null;
  const result = {
    ok: materialized.failedJobCount === 0,
    runId,
    evaluation,
    evaluationId: evaluation?.id ?? null,
    subjectId: evaluatedSubjectId,
    completedJobCount: materialized.completedJobCount,
    failedJobCount: materialized.failedJobCount,
    localView: localDevViewHint(workspace, runId),
  };
  writeOutput(
    result,
    parsed,
    io,
    ({ evaluationId, subjectId: evaluatedSubjectId }) =>
      `Evaluation ${evaluationId ?? runId} finished for ${evaluatedSubjectId}.\nOpen local view: ${result.localView.command}\n${result.localView.note}`,
  );
  return materialized.failedJobCount === 0 ? 0 : 1;
}

function localDevViewHint(workspace: string, runId?: string | null): LocalDevViewHint {
  const runFlag = runId ? ` --run ${shellQuote(runId)}` : "";
  return {
    command: `workbench open --dir ${shellQuote(path.resolve(workspace))}${runFlag}`,
    note: LOCAL_DEV_OPEN_LIFECYCLE_NOTE,
  };
}

function localDevOpenUrl(
  baseUrl: string,
  snapshot: {
    evaluations: Array<{
      id: string;
      runId: string;
      subjectId: string;
    }>;
  },
  runId?: string | null,
): string {
  if (!runId) {
    return baseUrl;
  }
  const evaluation = snapshot.evaluations
    .slice()
    .reverse()
    .find((entry) => entry.runId === runId);
  if (!evaluation) {
    return new URL("subjects", baseUrl).toString();
  }
  const params = new URLSearchParams({ evaluation: evaluation.id });
  return new URL(
    `subjects/${encodeURIComponent(evaluation.subjectId)}?${params.toString()}`,
    baseUrl,
  ).toString();
}

async function readLocalBenchmarkFingerprint(workspace: string): Promise<string> {
  return localBenchmarkFingerprint(await readLocalProjectSource(workspace));
}

function authoredSubjectSourceFiles(projectSource: LocalProjectSource): SurfaceSnapshotFile[] {
  return [{
    path: path.relative(projectSource.dir, projectSource.subjectSpecPath).split(path.sep).join("/"),
    kind: "text",
    encoding: "utf8",
    content: projectSource.subjectSource,
    executable: false,
  }];
}

function authoredBenchmarkSourceFiles(projectSource: LocalProjectSource): SurfaceSnapshotFile[] {
  return [{
    path: path.relative(projectSource.dir, projectSource.benchmarkPath).split(path.sep).join("/"),
    kind: "text",
    encoding: "utf8",
    content: projectSource.benchmarkSource,
    executable: false,
  }];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function resolveProjectPath(root: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
}

async function executeLocalDevelopmentJob(
  args: WorkbenchExecutionRuntimeInput,
): Promise<HostedWorkbenchJob> {
  return await executeWorkbenchExecutionJob(args, {
    sandboxProvider: DOCKER_SANDBOX_BACKEND,
    loadLocalAdapterAuthProfiles: true,
  });
}

async function executeLocalDevelopmentDag(args: {
  jobs: readonly HostedWorkbenchJob[];
  spec: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>;
  adapterManifests: readonly ResolvedWorkbenchAdapter["manifest"][];
  adapterFiles?: readonly SurfaceSnapshotFile[];
  baseFiles: readonly SurfaceSnapshotFile[];
  engineResolveFiles: readonly SurfaceSnapshotFile[];
  engineCases: WorkbenchExecutionRuntimeInput["engineCases"];
  traceFiles?: readonly SurfaceSnapshotFile[];
  capacity: WorkbenchExecutionDagCapacity;
}): Promise<HostedWorkbenchJob[]> {
  const completedById = new Map(
    args.jobs
      .filter(isTerminalLocalJob)
      .map((job) => [job.id, job] as const),
  );
  const result = await runWorkbenchExecutionDag({
    jobs: args.jobs,
    capacity: args.capacity,
    sandboxProvider: DOCKER_SANDBOX_BACKEND,
    executeJob: async (job) => {
      return await executeLocalDevelopmentJob({
        job,
        spec: args.spec,
        adapterManifests: args.adapterManifests,
        ...(args.adapterFiles ? { adapterFiles: args.adapterFiles } : {}),
        baseFiles: args.baseFiles,
        engineResolveFiles: args.engineResolveFiles,
        engineCases: args.engineCases,
        ...(args.traceFiles ? { traceFiles: args.traceFiles } : {}),
      });
    },
    onJobFinished: (job) => {
      completedById.set(job.id, job);
    },
  });
  return result.jobs;
}

async function localDevelopmentCapacity(workspace: string): Promise<WorkbenchExecutionDagCapacity> {
  const envCapacity = localDevelopmentCapacityFromEnv();
  if (envCapacity) {
    return envCapacity;
  }
  const filesystem = await fs.statfs(workspace);
  const availableDiskGb = (filesystem.bavail * filesystem.bsize) / (1024 ** 3);
  return {
    cpu: Math.max(1, typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length),
    memoryGb: Math.max(1, os.totalmem() / (1024 ** 3)),
    diskGb: Math.max(1, availableDiskGb),
  };
}

function localDevelopmentCapacityFromEnv(): WorkbenchExecutionDagCapacity | null {
  const names = [
    "WORKBENCH_HOST_CPU",
    "WORKBENCH_HOST_MEMORY_GB",
    "WORKBENCH_HOST_DISK_GB",
  ] as const;
  const values = names.map((name) => process.env[name]);
  if (values.every((value) => value === undefined || value === "")) {
    return null;
  }
  if (values.some((value) => value === undefined || value === "")) {
    throw new UsageError(`${names.join(", ")} must be set together for local dev capacity.`);
  }
  return {
    cpu: readPositiveEnvNumber(names[0]),
    memoryGb: readPositiveEnvNumber(names[1]),
    diskGb: readPositiveEnvNumber(names[2]),
  };
}

function readPositiveEnvNumber(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new UsageError(`${name} must be a positive number.`);
  }
  return value;
}

function isTerminalLocalJob(job: HostedWorkbenchJob): boolean {
  return job.status === "succeeded" || job.status === "failed" || job.status === "cancelled";
}

async function ensureLocalDockerfileEnvironments(
  workspace: string,
  spec: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>,
  engineCases: readonly WorkbenchEngineCase[],
): Promise<{ defaultRef: string; byCase: Map<string, string> }> {
  const cache = new Map<string, Promise<string>>();
  const ensure = (runtime: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>["environment"]) => {
    const key = runtime.dockerfile;
    const existing = cache.get(key);
    if (existing) {
      return existing;
    }
    const pending = ensureLocalDockerfileEnvironment(workspace, spec, runtime);
    cache.set(key, pending);
    return pending;
  };
  const defaultRef = await ensure(spec.environment);
  const byCase = new Map<string, string>();
  for (const engineCase of engineCases) {
    const runtime = resolveEngineCaseExecutionConfig({
      spec,
      engineCase: engineCase.case,
    }).environment;
    byCase.set(engineCase.id, await ensure(runtime));
  }
  return { defaultRef, byCase };
}

async function ensureLocalDockerfileEnvironment(
  workspace: string,
  spec: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>,
  runtime: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>["environment"],
): Promise<string> {
  const dockerfilePath = runtime.dockerfile;
  const absoluteDockerfile = resolveProjectPath(workspace, dockerfilePath);
  const rawDockerfile = await fs.readFile(absoluteDockerfile, "utf8").catch((error: unknown) => {
    throw error;
  });
  const adapters = await resolveWorkbenchAdaptersForProject(workspace, spec);
  const dockerfile = await composeRuntimeDockerfileWithAdapters(
    rawDockerfile,
    adapters,
  );
  const digest = createHash("sha256")
    .update(absoluteDockerfile)
    .update("\0")
    .update(dockerfile)
    .digest("hex")
    .slice(0, 16);
  const tag = `workbench-local/${safeDockerTagSegment(spec.name)}:${digest}`;
  const exists = await spawnOutput("docker", ["image", "inspect", tag]).then(
    () => true,
    () => false,
  );
  if (!exists) {
    const contextRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-local-runtime-"));
    const composedDockerfile = path.join(contextRoot, "Dockerfile");
    await fs.writeFile(composedDockerfile, dockerfile);
    await spawnOutput("docker", [
      "build",
      "-t",
      tag,
      "-f",
      composedDockerfile,
      contextRoot,
    ]).finally(async () => {
      await fs.rm(contextRoot, { recursive: true, force: true }).catch(() => undefined);
    });
  }
  return `docker://${tag}`;
}

async function spawnOutput(
  command: string,
  args: readonly string[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout = appendProcessOutput(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendProcessOutput(stderr, chunk);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        const output = formatProcessOutput({ stdout, stderr });
        reject(
          new Error(
            `${command} ${args.join(" ")} exited with status ${code ?? signal ?? "unknown"}.${output}`,
          ),
        );
      }
    });
  });
}

const PROCESS_OUTPUT_TAIL_CHARS = 16_000;

function appendProcessOutput(current: string, chunk: unknown): string {
  const next = current + String(chunk);
  return next.length > PROCESS_OUTPUT_TAIL_CHARS
    ? next.slice(next.length - PROCESS_OUTPUT_TAIL_CHARS)
    : next;
}

function formatProcessOutput(args: { stdout: string; stderr: string }): string {
  const sections: string[] = [];
  const stderr = args.stderr.trim();
  const stdout = args.stdout.trim();
  if (stderr.length > 0) {
    sections.push(`stderr:\n${stderr}`);
  }
  if (stdout.length > 0) {
    sections.push(`stdout:\n${stdout}`);
  }
  return sections.length > 0 ? `\n${sections.join("\n")}` : "";
}

function safeDockerTagSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "workbench"
  );
}

function requireValidRunEnvelope(
  args: Parameters<typeof validateWorkbenchRunEnvelope>[0],
): void {
  const issue = validateWorkbenchRunEnvelope(args);
  if (issue) {
    throw new UsageError(issue);
  }
}

async function localRestore(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "subject", "dry-run", "yes", "json"]));
  const workspace = resolveDir(parsed);
  const spec = await readLocalSpecIfValid(workspace);
  if (!spec) {
    throw new UsageError("restore requires a valid Workbench project.");
  }
  const subjectRoot = spec.subject.files.path;
  const snapshot = await loadLocalArchive(workspace);
  const subjectId = readSubjectIdFlag(parsed, snapshot);
  const files = readLocalSubjectFiles(snapshot, subjectId);
  if (parsed.flags["dry-run"] === true) {
    writeOutput(
      { ok: true, subjectId, fileCount: files.length },
      parsed,
      io,
      () => `Restore would write ${files.length} file(s) from ${subjectId}.`,
    );
    return 0;
  }
  if (parsed.flags.yes !== true) {
    throw new UsageError(
      "restore requires --dry-run to preview or --yes to apply source directory changes.",
    );
  }
  const changedPaths = await materializeSubjectRoot(
    workspace,
    subjectRoot,
    files,
  );
  const next = setLocalActive(snapshot, subjectId);
  await saveLocalArchive(workspace, next);
  writeOutput(
    { ok: true, activeAfter: subjectId, changedPaths },
    parsed,
    io,
    () => `Restored ${subjectId} to ${subjectRoot}.`,
  );
  return 0;
}

async function localSubjectList(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  const snapshot = await loadLocalArchive(resolveDir(parsed));
  writeOutput(
    snapshot.subjects,
    parsed,
    io,
    (subjects) =>
      subjects
        .map(
          (subject) =>
            `${subject.id}\t${subject.status}\tmetrics ${formatMetricSummary(subject.metrics)}${snapshot.activeId === subject.id ? "\tactive" : ""}`,
        )
        .join("\n") || "No subjects.",
  );
  return 0;
}

async function localSubjectShow(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "subject", "json"]));
  const snapshot = await loadLocalArchive(resolveDir(parsed));
  const subjectId = readSubjectIdFlag(parsed, snapshot);
  const subject = readLocalSubject(snapshot, subjectId);
  writeOutput(
    subject,
    parsed,
    io,
    (record) =>
      [
        `${record.id}\t${record.status}`,
        `benchmark\t${record.benchmarkFingerprint}`,
        `subject\t${record.subjectFingerprint}`,
        `metrics\t${formatMetricSummary(record.metrics)}`,
        ...(record.baseId ? [`base\t${record.baseId}`] : []),
      ].join("\n"),
  );
  return 0;
}

async function localSubjectFiles(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "subject", "json"]));
  const snapshot = await loadLocalArchive(resolveDir(parsed));
  const subjectId = readSubjectIdFlag(parsed, snapshot);
  const subject = readLocalSubject(snapshot, subjectId);
  const files = summarizeSubjectFiles(
    readLocalSubjectFiles(snapshot, subjectId),
    subject.fileChanges,
  );
  writeOutput(
    files,
    parsed,
    io,
    (records) =>
      records
        .map((file) => `${file.path}\t${file.status}\t${file.preview_kind}`)
        .join("\n") || "No files.",
  );
  return 0;
}

async function localSubjectPreview(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "subject", "path", "output", "view", "json"]));
  const snapshot = await loadLocalArchive(resolveDir(parsed));
  const subjectId = readSubjectIdFlag(parsed, snapshot);
  const preview = createSubjectFilePreview({
    files: readLocalSubjectFiles(snapshot, subjectId),
    path: requireFlag(parsed, "path"),
    view: readPreviewMode(parsed),
  });
  const content =
    preview.source?.content ?? preview.rendered_html ?? preview.diff ?? "";
  const outputPath = asOptionalString(parsed.flags.output);
  if (outputPath && outputPath !== "-") {
    await fs.writeFile(outputPath, content);
    io.stdout.write(`Wrote preview to ${outputPath}\n`);
  } else if (parsed.flags.json === true) {
    writeJson(preview, io);
  } else {
    io.stdout.write(content);
  }
  return 0;
}

async function localRunList(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  const snapshot = await loadLocalArchive(resolveDir(parsed));
  writeOutput(
    snapshot.runs,
    parsed,
    io,
    (runs) =>
      runs
        .map((run) =>
          `${run.id}\t${run.workflow}\t${run.status}\t${run.outcome ?? "pending"}\t${run.attemptsExecuted ?? 0}/${run.attemptsRequested ?? 0}`
        )
        .join("\n") || "No runs.",
  );
  return 0;
}

async function localRunShow(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  const runId = parsed.positionals[0];
  if (!runId) {
    throw new UsageError("workbench runs show requires RUN_ID.");
  }
  const snapshot = await loadLocalArchive(resolveDir(parsed));
  const run = snapshot.runs.find((entry) => entry.id === runId);
  if (!run) {
    throw new UsageError(`Run not found: ${runId}`);
  }
  writeOutput(
    run,
    parsed,
    io,
    (record) =>
      [
        `${record.id}\t${record.workflow}\t${record.status}`,
        `outcome\t${record.outcome ?? "pending"}`,
        `started\t${record.startedAt}`,
        ...(record.finishedAt ? [`finished\t${record.finishedAt}`] : []),
        `attempts\t${record.attemptsExecuted ?? 0}/${record.attemptsRequested ?? 0}`,
        `samples\t${record.samples ?? 0}`,
      ].join("\n"),
  );
  return 0;
}

async function runAuthCommand(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const command = argv[0];
  const rest = argv.slice(1);
  switch (command) {
    case "connect":
      return await authConnect(rest, io);
    case "disconnect":
      return await authDisconnect(rest, io);
    default:
      throw new UsageError(`Unknown command: auth ${argv.join(" ")}`);
  }
}

async function runAdaptersCommand(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const command = argv[0];
  const rest = argv.slice(1);
  switch (command) {
    case "create":
      return await adaptersCreate(rest, io);
    case "list":
      return await adaptersList(rest, io);
    case "inspect":
      return await adaptersInspect(rest, io);
    case "test":
      return await adaptersTest(rest, io);
    default:
      throw new UsageError(`Unknown command: adapters ${argv.join(" ")}`);
  }
}

async function runTracesCommand(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const command = argv[0];
  const rest = argv.slice(1);
  switch (command) {
    case "collect":
      return await localTraceCollect(rest, io);
    case "list":
      return await localTraceList(rest, io);
    case "show":
      return await localTraceShow(rest, io);
    default:
      throw new UsageError(`Unknown command: traces ${argv.join(" ")}`);
  }
}

interface LocalTraceQuery {
  selectedAdapters: LocalTraceAdapter[];
  adapterById: Map<string, LocalTraceAdapter>;
  workspaceRoot?: string;
  since?: Date;
}

interface LocalTraceWindowQuery extends LocalTraceQuery {
  limit: number;
}

interface LocalTraceSelection {
  refs: LocalTraceRef[];
  adapterById: Map<string, LocalTraceAdapter>;
  limitPerProvider: number;
  limitedProviders: string[];
}

interface LocalTraceCollectionSummary {
  ok: true;
  traceCount: number;
  limitPerProvider: number;
  limitedProviders: string[];
  providers: Record<string, number>;
  traces: AgentReadableTraceDigest[];
}

interface LocalTraceArtifactPreview {
  tools: string[];
  commands: string[];
  files: string[];
  urls: string[];
  errors: string[];
}

interface LocalTraceListItem {
  provider: string;
  traceId: string;
  source: AgentReadableTraceDigest["source"];
  sessionId?: string;
  title?: string;
  workspaceRoot?: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt?: string;
  goal?: string;
  counts: AgentReadableTraceDigest["counts"];
  artifacts: LocalTraceArtifactPreview;
}

interface LocalTraceListSummary {
  ok: true;
  traceCount: number;
  limitPerProvider: number;
  limitedProviders: string[];
  providers: Record<string, number>;
  traces: LocalTraceListItem[];
}

interface LocalTraceShowSummary {
  ok: true;
  trace: AgentReadableTraceDigest;
}

const DEFAULT_LOCAL_TRACE_LIMIT = 3;
const LOCAL_TRACE_WINDOW_FLAGS = new Set(["providers", "since", "workspace", "limit", "json"]);
const LOCAL_TRACE_SHOW_FLAGS = new Set(["providers", "since", "workspace", "json"]);

async function localTraceCollect(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, LOCAL_TRACE_WINDOW_FLAGS);
  rejectUnexpectedPositionals(parsed, "workbench traces collect", 0);
  const selection = await discoverLocalTraceSelection(readLocalTraceWindowQuery(parsed));
  const traces = await readLocalTraceDigests(selection);

  const summary: LocalTraceCollectionSummary = {
    ok: true,
    traceCount: traces.length,
    limitPerProvider: selection.limitPerProvider,
    limitedProviders: selection.limitedProviders,
    providers: countLocalTraceProviders(traces),
    traces,
  };
  writeOutput(summary, parsed, io, formatLocalTraceCollectionSummary);
  return 0;
}

async function localTraceList(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, LOCAL_TRACE_WINDOW_FLAGS);
  rejectUnexpectedPositionals(parsed, "workbench traces list", 0);
  const selection = await discoverLocalTraceSelection(readLocalTraceWindowQuery(parsed));
  const traces = await readLocalTraceDigests(selection);
  const items = traces.map(localTraceListItem);
  const summary: LocalTraceListSummary = {
    ok: true,
    traceCount: items.length,
    limitPerProvider: selection.limitPerProvider,
    limitedProviders: selection.limitedProviders,
    providers: countLocalTraceProviders(items),
    traces: items,
  };
  writeOutput(summary, parsed, io, formatLocalTraceListSummary);
  return 0;
}

async function localTraceShow(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, LOCAL_TRACE_SHOW_FLAGS);
  const traceId = parsed.positionals[0];
  if (!traceId || parsed.positionals.length > 1) {
    throw new UsageError("workbench traces show requires exactly one TRACE_ID.");
  }
  const query = readLocalTraceQuery(parsed);
  const ref = (await discoverLocalTraceRefs(query, traceId))
    .find((entry) => entry.traceId === traceId);
  if (!ref) {
    throw new UsageError(formatLocalTraceNotFound(traceId));
  }
  const trace = await readLocalTraceDigest(query, ref);
  const summary: LocalTraceShowSummary = {
    ok: true,
    trace,
  };
  writeOutput(summary, parsed, io, formatLocalTraceShowSummary);
  return 0;
}

function readLocalTraceQuery(parsed: ParsedArgs): LocalTraceQuery {
  const providers = readOptionalStringFlag(parsed.flags.providers, "providers");
  const workspace = readOptionalStringFlag(parsed.flags.workspace, "workspace");
  const selectedAdapters = selectLocalTraceAdapters(providers);
  const adapterById = new Map(selectedAdapters.map((adapter) => [adapter.id, adapter]));
  const since = parseTraceSinceFlag(parsed.flags.since);
  const workspaceRoot = workspace
    ? path.resolve(workspace)
    : undefined;
  return {
    selectedAdapters,
    adapterById,
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(since ? { since } : {}),
  };
}

function readLocalTraceWindowQuery(parsed: ParsedArgs): LocalTraceWindowQuery {
  return {
    ...readLocalTraceQuery(parsed),
    limit: parsePositiveInt(parsed.flags.limit, DEFAULT_LOCAL_TRACE_LIMIT, "limit"),
  };
}

async function discoverLocalTraceSelection(query: LocalTraceWindowQuery): Promise<LocalTraceSelection> {
  const discovered = await Promise.all(
    query.selectedAdapters.map(async (adapter) => ({
      adapter,
      refs: await adapter.discoverLocalTraces({
        env: process.env,
        ...(query.workspaceRoot ? { workspaceRoot: query.workspaceRoot } : {}),
        ...(query.since ? { since: query.since } : {}),
        limit: query.limit + 1,
      }),
    })),
  );
  const limitedProviders: string[] = [];
  const refs = sortLocalTraceRefs(
    discovered.flatMap(({ adapter, refs: providerRefs }) => {
      const sorted = sortLocalTraceRefs(providerRefs);
      if (sorted.length > query.limit) {
        limitedProviders.push(adapter.id);
      }
      return sorted.slice(0, query.limit);
    }),
  );
  return {
    refs,
    adapterById: query.adapterById,
    limitPerProvider: query.limit,
    limitedProviders,
  };
}

async function discoverLocalTraceRefs(
  query: LocalTraceQuery,
  traceId?: string,
): Promise<LocalTraceRef[]> {
  const discovered = await Promise.all(
    query.selectedAdapters.map(async (adapter) => await adapter.discoverLocalTraces({
      env: process.env,
      ...(traceId ? { traceId } : {}),
      ...(query.workspaceRoot ? { workspaceRoot: query.workspaceRoot } : {}),
      ...(query.since ? { since: query.since } : {}),
    })),
  );
  return sortLocalTraceRefs(discovered.flat());
}

async function readLocalTraceDigests(
  selection: LocalTraceSelection,
): Promise<AgentReadableTraceDigest[]> {
  const traces: AgentReadableTraceDigest[] = [];
  for (const ref of selection.refs) {
    traces.push(await readLocalTraceDigest(selection, ref));
  }
  return traces;
}

async function readLocalTraceDigest(
  query: Pick<LocalTraceQuery, "adapterById">,
  ref: LocalTraceRef,
): Promise<AgentReadableTraceDigest> {
  const adapter = query.adapterById.get(ref.provider);
  if (!adapter) {
    throw new UsageError(`Unsupported local trace provider "${ref.provider}".`);
  }
  return await adapter.readLocalTraceDigest(ref, {
    env: process.env,
  });
}

function localTraceListItem(trace: AgentReadableTraceDigest): LocalTraceListItem {
  return {
    provider: trace.provider,
    traceId: trace.traceId,
    source: trace.source,
    ...(trace.sessionId ? { sessionId: trace.sessionId } : {}),
    ...(trace.title ? { title: trace.title } : {}),
    ...(trace.workspaceRoot ? { workspaceRoot: trace.workspaceRoot } : {}),
    ...(trace.startedAt ? { startedAt: trace.startedAt } : {}),
    ...(trace.endedAt ? { endedAt: trace.endedAt } : {}),
    ...(trace.updatedAt ? { updatedAt: trace.updatedAt } : {}),
    ...(trace.goal ? { goal: trace.goal } : {}),
    counts: trace.counts,
    artifacts: localTraceArtifactPreview(trace),
  };
}

function localTraceArtifactPreview(trace: AgentReadableTraceDigest): LocalTraceArtifactPreview {
  return {
    tools: trace.artifacts.tools.slice(0, 8),
    commands: trace.artifacts.commands.slice(0, 5),
    files: trace.artifacts.files.slice(0, 5),
    urls: trace.artifacts.urls.slice(0, 3),
    errors: trace.artifacts.errors.slice(0, 3),
  };
}

function countLocalTraceProviders(
  traces: readonly { provider: string }[],
): Record<string, number> {
  return traces.reduce<Record<string, number>>((counts, digest) => {
    counts[digest.provider] = (counts[digest.provider] ?? 0) + 1;
    return counts;
  }, {});
}

async function adaptersCreate(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  const dir = resolveDir(parsed);
  const target = parsed.positionals[0];
  if (!target || parsed.positionals.length > 1) {
    throw new UsageError("workbench adapters create requires exactly one target directory.");
  }
  const absolute = path.resolve(dir, target);
  const relative = path.relative(dir, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new UsageError("Adapter create target must be inside the benchmark source root.");
  }
  const id = path.basename(absolute).trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (!/^[a-z][a-z0-9-]*$/u.test(id)) {
    throw new UsageError("Adapter directory name must produce a lowercase adapter id.");
  }
  const files = createAdapterScaffoldFiles(id);
  for (const file of files) {
    const destination = path.join(absolute, file.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, file.content, { mode: file.executable ? 0o755 : 0o644 });
  }
  writeOutput(
    {
      ok: true,
      id,
      path: absolute,
      files: files.map((file) => file.path),
    },
    parsed,
    io,
    (record) => {
      const value = record as { id: string; path: string; files: string[] };
      return `Created adapter ${value.id} at ${value.path} (${value.files.length} file(s)).`;
    },
  );
  return 0;
}

async function adaptersList(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  const dir = resolveDir(parsed);
  const projectSource = await readLocalProjectSourceIfPresent(dir);
  const projectAdapters = projectSource
    ? await resolveWorkbenchAdaptersForProject(dir, projectSource.spec)
    : [];
  const projectAdaptersById = new Map(projectAdapters.map((adapter) => [adapter.manifest.id, adapter]));
  const defaults = defaultAdapterManifests()
    .filter((manifest) => !projectAdaptersById.has(manifest.id))
    .map((manifest) => ({
      id: manifest.id,
      declaredSource: `default:${manifest.id}`,
      resolvedSource: `default:${manifest.id}`,
      kind: "default",
      stability: "default",
      installed: false,
      operations: adapterOperationCommands(manifest.operations),
    }));
  const project = projectAdapters
    .map((adapter) => ({
      id: adapter.manifest.id,
      kind: adapter.kind,
      declaredSource: adapter.declaredSource,
      resolvedSource: adapter.source,
      stability: adapter.stability,
      installed: true,
      operations: adapterOperationCommands(adapter.manifest.operations),
      ...(adapter.overridesDefault ? { overridesDefault: true } : {}),
    }));
  const adapters = [...defaults, ...project].sort((left, right) => left.id.localeCompare(right.id));
  writeOutput(
    { ok: true, adapters },
    parsed,
    io,
    (record) => {
      const value = record as {
        adapters: Array<{
          id: string;
          declaredSource: string;
          resolvedSource: string;
          stability: string;
          installed: boolean;
          overridesDefault?: boolean;
        }>;
      };
      return value.adapters.map((adapter) =>
        `${adapter.id}\t${adapter.installed ? "installed" : "available"}\t${adapter.stability}${adapter.overridesDefault ? " override" : ""}\t${formatAdapterResolution(adapter)}`
      ).join("\n");
    },
  );
  return 0;
}

async function adaptersInspect(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  const dir = resolveDir(parsed);
  const id = parsed.positionals[0];
  if (!id || parsed.positionals.length > 1) {
    throw new UsageError("workbench adapters inspect requires exactly one adapter id.");
  }
  const projectSource = await readLocalProjectSourceIfPresent(dir);
  const projectAdapters = projectSource
    ? await resolveWorkbenchAdaptersForProject(dir, projectSource.spec)
    : [];
  const adapter =
    projectAdapters.find((entry) =>
      entry.manifest.id === id || entry.declaredSource === id || entry.source === id
    ) ??
    resolveDefaultWorkbenchAdapter(id);
  if (!adapter) {
    throw new UsageError(`Adapter ${id} is not installed or available in the default catalog.`);
  }
  writeOutput(
    {
      ok: true,
      adapter: adapterRecordForOutput(adapter),
    },
    parsed,
    io,
    (record) => {
      const value = record as { adapter: ReturnType<typeof adapterRecordForOutput> };
      const setup = value.adapter.setup.length > 0 ? value.adapter.setup.join("; ") : "none";
      const override = value.adapter.overridesDefault ? "overrides default" : value.adapter.kind;
      const operations = Object.entries(value.adapter.operations)
        .map(([operation, command]) => `${operation}: ${command}`)
        .join("; ");
      return [
        `${value.adapter.id} (${formatAdapterResolution(value.adapter)}, ${value.adapter.stability}, ${override})`,
        `operations: ${operations || "none"}`,
        `setup: ${setup}`,
        `auth: ${value.adapter.auth ? "declared" : "none"}`,
      ].join("\n");
    },
  );
  return 0;
}

async function adaptersTest(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "request", "output", "json"]));
  const dir = resolveDir(parsed);
  const target = parsed.positionals[0];
  if (!target || parsed.positionals.length > 1) {
    throw new UsageError("workbench adapters test requires exactly one adapter id or source.");
  }
  const adapter = await resolveAdapterForAdaptersTest(dir, target);
  const requestArg = asOptionalString(parsed.flags.request);
  const replay = requestArg
    ? await runAdapterTestReplay({
        adapter,
        dir,
        requestPath: path.resolve(dir, requestArg),
        outputRoot: asOptionalString(parsed.flags.output),
      })
    : null;
  writeOutput(
    {
      ok: true,
      mode: replay ? "replay" : "manifest",
      adapter: adapterRecordForOutput(adapter),
      ...(replay ? { replay } : {}),
    },
    parsed,
    io,
    (record) => {
      const value = record as {
        mode: "manifest" | "replay";
        adapter: ReturnType<typeof adapterRecordForOutput>;
        replay?: AdapterTestReplayResult;
      };
      if (value.mode === "manifest") {
        return `Adapter ${value.adapter.id} manifest is valid (${formatAdapterResolution(value.adapter)}).`;
      }
      return [
        `Adapter ${value.adapter.id} replay passed (${value.replay?.operation ?? "unknown"}, ${value.replay?.outputs.length ?? 0} output(s)).`,
        `output: ${value.replay?.outputRoot ?? ""}`,
      ].join("\n");
    },
  );
  return 0;
}

interface AdapterTestReplayResult {
  requestPath: string;
  outputRoot: string;
  operation: WorkbenchAdapterOperation;
  command: string;
  stdout: string;
  stderr: string;
  outputs: string[];
}

async function resolveAdapterForAdaptersTest(
  dir: string,
  target: string,
): Promise<ResolvedWorkbenchAdapter> {
  const projectSource = await readLocalProjectSourceIfPresent(dir);
  if (projectSource) {
    const adapters = await resolveWorkbenchAdaptersForProject(dir, projectSource.spec);
    const adapter = adapters.find((entry) =>
      entry.manifest.id === target || entry.declaredSource === target || entry.source === target
    );
    if (adapter) {
      return adapter;
    }
  }
  if (isAdapterSourceTarget(target)) {
    return await resolveProjectAdapterSource(dir, target);
  }
  const defaultAdapter = resolveDefaultWorkbenchAdapter(target);
  if (defaultAdapter) {
    return defaultAdapter;
  }
  throw new UsageError(`Adapter ${target} is not installed, available in the default catalog, or resolvable as a source.`);
}

function isAdapterSourceTarget(target: string): boolean {
  return target.startsWith("npm:") ||
    target.startsWith("git:") ||
    target.startsWith(".") ||
    target.startsWith("/") ||
    target.includes("/");
}

async function runAdapterTestReplay(args: {
  adapter: ResolvedWorkbenchAdapter;
  dir: string;
  requestPath: string;
  outputRoot?: string;
}): Promise<AdapterTestReplayResult> {
  const request = normalizeWorkbenchAdapterOperationRequest(
    JSON.parse(await fs.readFile(args.requestPath, "utf8")) as unknown,
  );
  if (request.invocation.use !== args.adapter.manifest.id) {
    throw new Error(
      `Request invocation.use ${request.invocation.use} does not match adapter id ${args.adapter.manifest.id}.`,
    );
  }
  const outputRoot = args.outputRoot
    ? path.resolve(args.dir, args.outputRoot)
    : await fs.mkdtemp(path.join(os.tmpdir(), "workbench-adapter-output-"));
  await fs.mkdir(outputRoot, { recursive: true });
  const replayRequest = adapterTestRequestForOutput(request, outputRoot);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-adapter-test-"));
  const runtimeRequestPath = path.join(tempRoot, "request.json");
  try {
    await fs.writeFile(runtimeRequestPath, `${JSON.stringify(replayRequest, null, 2)}\n`);
    const commandOutput = await runAdapterCommandForTest({
      adapter: args.adapter,
      cwd: adapterCommandCwd(args.adapter, args.dir),
      workspaceRoot: args.dir,
      requestPath: runtimeRequestPath,
      outputRoot,
    });
    const outputs = await validateAdapterTestOutputs(replayRequest, outputRoot);
    const command = workbenchAdapterOperationCommand(args.adapter.manifest, replayRequest.operation);
    return {
      requestPath: args.requestPath,
      outputRoot,
      operation: replayRequest.operation,
      command,
      stdout: commandOutput.stdout,
      stderr: commandOutput.stderr,
      outputs,
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function adapterTestRequestForOutput(
  request: WorkbenchAdapterOperationRequest,
  outputRoot: string,
): WorkbenchAdapterOperationRequest {
  return {
    ...request,
    paths: {
      ...request.paths,
      output: outputRoot,
      result: workbenchAdapterOperationResultPath(outputRoot),
    },
  };
}

function adapterCommandCwd(adapter: ResolvedWorkbenchAdapter, fallback: string): string {
  return adapter.root ?? fallback;
}

async function runAdapterCommandForTest(args: {
  adapter: ResolvedWorkbenchAdapter;
  cwd: string;
  workspaceRoot: string;
  requestPath: string;
  outputRoot: string;
}): Promise<{ stdout: string; stderr: string }> {
  const adapterRoot = args.adapter.root ?? args.cwd;
  const env = adapterTestEnv({
    requestPath: args.requestPath,
    outputRoot: args.outputRoot,
    workspaceRoot: args.workspaceRoot,
    adapterRoot,
  });
  const command = workbenchAdapterOperationCommand(args.adapter.manifest, normalizeWorkbenchAdapterOperationRequest(
    JSON.parse(await fs.readFile(args.requestPath, "utf8")) as unknown,
  ).operation);
  return await runShellCommand({
    command,
    cwd: args.cwd,
    env,
    errorLabel: `Adapter command ${command}`,
  });
}

function adapterTestEnv(args: {
  requestPath: string;
  outputRoot: string;
  workspaceRoot: string;
  adapterRoot: string;
}): NodeJS.ProcessEnv {
  return createAdapterCommandEnv({
    workspaceRoot: args.workspaceRoot,
    adapterRoot: args.adapterRoot,
    extraEnv: {
      WORKBENCH_ADAPTER_REQUEST: args.requestPath,
      WORKBENCH_OUTPUT: args.outputRoot,
      WORKBENCH_RESULT: workbenchAdapterOperationResultPath(args.outputRoot),
    },
  });
}

async function validateAdapterTestOutputs(
  request: WorkbenchAdapterOperationRequest,
  outputRoot: string,
): Promise<string[]> {
  await readWorkbenchAdapterOperationResult(outputRoot, request.operation).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Adapter did not write workbench-result.json.`);
    }
    throw error;
  }).then((result) =>
    assertWorkbenchAdapterOperationResultOk(result, `Adapter ${request.invocation.use} ${request.operation}`)
  );
  return ["workbench-result.json"];
}

function adapterRecordForOutput(adapter: ResolvedWorkbenchAdapter): {
  id: string;
  declaredSource: string;
  resolvedSource: string;
  kind: string;
  stability: string;
  operations: Record<string, string>;
  setup: string[];
  slots: Record<string, unknown>;
  overridesDefault?: boolean;
  auth?: unknown;
  integrity?: string;
  manifestHash: string;
  contentHash: string;
} {
  return {
    id: adapter.manifest.id,
    declaredSource: adapter.declaredSource,
    resolvedSource: adapter.source,
    kind: adapter.kind,
    stability: adapter.stability,
    operations: adapterOperationCommands(adapter.manifest.operations),
    setup: [...adapter.manifest.setup],
    slots: adapter.manifest.slots ?? {},
    ...(adapter.overridesDefault ? { overridesDefault: true } : {}),
    ...(adapter.manifest.auth !== undefined ? { auth: adapter.manifest.auth } : {}),
    ...(adapter.integrity ? { integrity: adapter.integrity } : {}),
    manifestHash: adapter.manifestHash,
    contentHash: adapter.contentHash,
  };
}

function adapterOperationCommands(
  operations: ResolvedWorkbenchAdapter["manifest"]["operations"],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(operations).map(([operation, config]) => [operation, config.command]),
  );
}

function createAdapterScaffoldFiles(id: string): Array<{
  path: string;
  content: string;
  executable?: boolean;
}> {
  const command = `workbench-adapter-${id}`;
  const manifest = [
    `id: ${id}`,
    "protocol: workbench.adapter.v3",
    "setup:",
    "  - npm install --global .",
    "operations:",
    "  subject.run: {}",
    "",
  ].join("\n");
  const packageJson = `${JSON.stringify({
    name: `@local/${id}-workbench-adapter`,
    version: "0.0.0",
    type: "module",
    private: true,
    bin: {
      [command]: "./adapter.mjs",
    },
  }, null, 2)}\n`;
  const adapter = `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const requestPath = process.env.WORKBENCH_ADAPTER_REQUEST;
const outputRoot = process.env.WORKBENCH_OUTPUT || "/workspace/output";
const request = requestPath && fs.existsSync(requestPath)
  ? JSON.parse(fs.readFileSync(requestPath, "utf8"))
  : {};
fs.mkdirSync(outputRoot, { recursive: true });
const operation = request.operation || "subject.run";
const resultPath = process.env.WORKBENCH_RESULT || request.paths?.result || path.join(outputRoot, "workbench-result.json");

let value;
if (operation === "subject.run") {
  const task = request.context?.case?.prompt || "No case prompt was provided.";
  fs.writeFileSync(path.join(outputRoot, "adapter-output.txt"), [
    "adapter: ${id}",
    "task:",
    task,
    "",
  ].join("\\n"));
} else {
  console.error("${id} only implements subject.run.");
  process.exit(2);
}

fs.writeFileSync(resultPath, JSON.stringify({
  protocol: "workbench.adapter-result.v1",
  operation,
  ok: true,
  ...(value === undefined ? {} : { value }),
  summary: "${id} completed " + operation + ".",
}, null, 2) + "\\n");
`;
  const readme = [
    `# ${id}`,
    "",
    "This is a Workbench adapter. It receives a JSON request at `WORKBENCH_ADAPTER_REQUEST` and writes operation outputs under `WORKBENCH_OUTPUT`.",
    "",
    "Validate the manifest with `workbench adapters test PATH`. Replay a request fixture with `workbench adapters test PATH --request adapter-request.json --output out/adapter-test`.",
    "",
    "See `docs/evals/adapters.md` in the Workbench source for the full adapter contract.",
    "",
  ].join("\n");
  return [
    { path: WORKBENCH_ADAPTER_MANIFEST_FILE, content: manifest },
    { path: "package.json", content: packageJson },
    { path: "adapter.mjs", content: adapter, executable: true },
    { path: "README.md", content: readme },
  ];
}

async function login(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["base-url", "no-open", "json"]));
  const baseUrl =
    asOptionalString(parsed.flags["base-url"]) ?? DEFAULT_BASE_URL;
  const authorization = await requestDeviceAuthorization(baseUrl);
  if (parsed.flags.json === true) {
    writeJson(
      { ok: true, status: "authorization_pending", ...authorization },
      io,
    );
  } else {
    io.stdout.write(`Open ${authorization.verification_uri_complete}\n`);
    io.stdout.write(`Code: ${authorization.user_code}\n`);
  }
  if (parsed.flags["no-open"] !== true) {
    await openBrowser(authorization.verification_uri_complete).catch(
      () => undefined,
    );
  }
  const token = await pollDeviceToken(baseUrl, authorization);
  await writeConfig({ baseUrl, accessToken: token.access_token });
  if (parsed.flags.json === true) {
    writeJson({ ok: true, baseUrl, expiresIn: token.expires_in }, io);
  } else {
    io.stdout.write(`Workbench API: ${baseUrl}\n`);
  }
  return 0;
}

async function logout(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["json"]));
  const config = await loadConfig();
  const baseUrl = normalizeBaseUrl(
    process.env.WORKBENCH_API_URL ?? config.baseUrl ?? DEFAULT_BASE_URL,
  );
  if (config.accessToken) {
    await fetch(`${baseUrl}/api/oauth/revoke`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: config.accessToken }),
    }).catch(() => undefined);
  }
  await writeConfig({ baseUrl });
  writeOutput(
    { ok: true, baseUrl },
    parsed,
    io,
    () => "Logged out of Workbench.",
  );
  return 0;
}

async function authStatus(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  const config = await loadConfig();
  const baseUrl = await effectiveBaseUrl();
  const profileStatus = await readWorkbenchProfileStatus(config);
  const adapterStatuses = await localWorkbenchAdapterAuthStore().listStatus();
  const hostedAuth = profileStatus.authenticated
    ? await readHostedAdapterAuthStatuses().catch((error: unknown) => ({
        adapters: [],
        error: error instanceof Error ? error.message : String(error),
      }))
    : {
        adapters: [],
        error: "not_authenticated",
      };
  const dir = resolveDir(parsed);
  const adapterAuth = await projectAdapterAuthStatus(
    dir,
    adapterStatuses,
    hostedAuth.adapters,
  ).catch(() => []);
  const result = {
    ok: true,
    workbench: {
      baseUrl,
      authenticated: profileStatus.authenticated,
      username: profileStatus.profile?.username ?? null,
    },
    adapterStatuses,
    hostedAuth,
    adapterAuth,
  };
  writeOutput(result, parsed, io, (record) => {
    const value = record as typeof result;
    return [
      `Workbench API: ${value.workbench.baseUrl}`,
      `Workbench authenticated: ${value.workbench.authenticated ? "yes" : "no"}`,
      ...(value.workbench.username ? [`Username: ${value.workbench.username}`] : []),
      ...(value.adapterAuth.length > 0
        ? [
            "",
            "Required adapter auth:",
            ...value.adapterAuth.map((adapter) =>
              `${adapter.adapter}${adapter.profile !== "default" ? ` profile ${adapter.profile}` : ""}: local ${adapter.local.status}${adapter.local.method ? ` (${adapter.local.method})` : ""}${adapter.local.reason ? ` (${adapter.local.reason})` : ""}, hosted ${adapter.hosted.status}${adapter.hosted.method ? ` (${adapter.hosted.method})` : ""}${adapter.hosted.reason ? ` (${adapter.hosted.reason})` : ""}`
            ),
          ]
        : []),
    ].join("\n");
  });
  return 0;
}

async function projectAdapterAuthStatus(
  dir: string,
  adapterStatuses: WorkbenchAdapterAuthStatusRecord[],
  hostedAdapters: HostedAdapterAuthStatus[],
): Promise<Array<{
  adapter: string;
  slot?: string;
  profile: string;
  local: { status: string; method?: string; reason?: string };
  hosted: { status: string; method?: string; reason?: string };
}>> {
  const spec = (await readLocalProjectSource(dir)).spec;
  const adapters = await resolveWorkbenchAdaptersForProject(
    dir,
    spec,
  );
  const adapterStatusMap = new Map(adapterStatuses.map((status) => [
    adapterAuthStatusKey(status.adapterId, status.slot, status.profile),
    status,
  ]));
  const hostedAdapterStatusMap = new Map(hostedAdapters.map((status) => [
    adapterAuthStatusKey(status.adapterId, status.slot, status.profile),
    status,
  ]));
  const adapterById = new Map(adapters.map((adapter) => [adapter.manifest.id, adapter]));
  return requiredAuthTargetsForSpec(spec, adapterById).map((target) => {
    const adapterStatus = adapterStatusMap.get(adapterAuthStatusKey(
      target.adapter,
      target.slot,
      target.profile,
    ));
    const hostedAdapterStatus = hostedAdapterStatusMap.get(adapterAuthStatusKey(
      target.adapter,
      target.slot,
      target.profile,
    ));
    return {
      ...target,
      local: adapterStatus
        ? {
            status: adapterStatus.status,
            ...(adapterStatus.method ? { method: adapterStatus.method } : {}),
            ...(adapterStatus.reason ? { reason: adapterStatus.reason } : {}),
          }
        : { status: "disconnected" },
      hosted: hostedAdapterStatus
        ? {
            status: hostedAdapterStatus.status,
            ...(hostedAdapterStatus.method ? { method: hostedAdapterStatus.method } : {}),
            ...(hostedAdapterStatus.reason ? { reason: hostedAdapterStatus.reason } : {}),
          }
        : { status: "disconnected" },
    };
  });
}

interface HostedAdapterAuthStatus {
  adapterId: string;
  slot?: string;
  profile: string;
  status: string;
  version?: number;
  method?: string;
  updatedAt?: string;
  reason?: string;
}

async function readHostedAdapterAuthStatuses(): Promise<{
  adapters: HostedAdapterAuthStatus[];
}> {
  const adapterResponse = await apiRequest<{ adapters?: HostedAdapterAuthStatus[] }>(
    "/api/workbench/auth/adapters",
  );
  return {
    adapters: adapterResponse.adapters ?? [],
  };
}

function requiredAuthTargetsForSpec(
  spec: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>,
  adapterById: Map<string, ResolvedWorkbenchAdapter>,
): Array<{ adapter: string; slot?: string; profile: string }> {
  const manifests = [...adapterById.values()].map((adapter) => adapter.manifest);
  return collectWorkbenchAdapterAuthRequirements(
    [
      ...(spec.improve ? [spec.improve] : []),
      spec.run,
      spec.engineRun,
    ],
    manifests,
  ).map((target) => ({
    adapter: target.adapterId,
    ...(target.slot ? { slot: target.slot } : {}),
    profile: target.profile,
  })).sort((left, right) =>
    adapterAuthStatusKey(left.adapter, left.slot, left.profile)
      .localeCompare(adapterAuthStatusKey(right.adapter, right.slot, right.profile))
  );
}

function adapterAuthStatusKey(
  adapterId: string,
  slot: string | undefined,
  profile: string,
): string {
  return `${adapterId}/${slot ?? "_"}/${profile}`;
}

async function authConnect(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(
    parsed,
    new Set([
      "profile-root",
      "method",
      "dir",
      "profile",
      "local-only",
      "json",
    ]),
  );
  const targetRaw = readAuthTargetPositional(parsed, "connect");
  const profile = readAuthProfileFlag(parsed);
  const dir = resolveDir(parsed);
  const adapter = await resolveAdapterForAuthTarget(dir, targetRaw);
  const target = parseWorkbenchAdapterAuthTarget(targetRaw, profile);
  const method = readAdapterConnectMethod(adapter.manifest, target.slot, parsed);
  const saved = await localWorkbenchAdapterAuthStore().put(
    await collectAdapterAuthForConnect({
      adapter,
      target,
      targetRaw,
      method,
      profileRoot: path.resolve(
        asOptionalString(parsed.flags["profile-root"]) ?? os.homedir(),
      ),
      cwd: dir,
    }),
  );
  const remote =
    parsed.flags["local-only"] === true
      ? { status: "skipped", reason: "local_only" }
      : await uploadAdapterConnection(saved);
  writeOutput(
    {
      ok: true,
      adapter: target.adapterId,
      ...(target.slot ? { slot: target.slot } : {}),
      profile: target.profile,
      method: saved.method,
      status: "connected",
      version: saved.version,
      updatedAt: saved.updatedAt,
      remote,
    },
    parsed,
    io,
    (record) => {
      const value = record as {
        adapter: string;
        slot?: string;
        profile: string;
        method: string;
        version: number;
        remote: { status: string; reason?: string };
      };
      const label = value.slot ? `${value.adapter}/${value.slot}` : value.adapter;
      const profileText = value.profile === "default" ? "" : ` profile ${value.profile}`;
      const remoteLine =
        value.remote.status === "connected"
          ? "remote: connected"
          : `remote: ${value.remote.status}${value.remote.reason ? ` (${value.remote.reason})` : ""}`;
      return `Connected ${label}${profileText} adapter ${value.method} auth v${value.version}; ${remoteLine}.`;
    },
  );
  return 0;
}

async function authDisconnect(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["local-only", "profile", "json"]));
  const targetRaw = readAuthTargetPositional(parsed, "disconnect");
  const profile = readAuthProfileFlag(parsed);
  const target = parseWorkbenchAdapterAuthTarget(targetRaw, profile);
  await localWorkbenchAdapterAuthStore().disconnect(target);
  const remote =
    parsed.flags["local-only"] === true
      ? { status: "skipped", reason: "local_only" }
      : await deleteAdapterConnection(target);
  writeOutput(
    {
      ok: true,
      adapter: target.adapterId,
      ...(target.slot ? { slot: target.slot } : {}),
      profile: target.profile,
      status: "disconnected",
      remote,
    },
    parsed,
    io,
    (record) => {
      const value = record as {
        adapter: string;
        slot?: string;
        remote: { status: string; reason?: string };
      };
      const label = value.slot ? `${value.adapter}/${value.slot}` : value.adapter;
      const remoteLine =
        value.remote.status === "disconnected"
          ? "remote: disconnected"
          : `remote: ${value.remote.status}${value.remote.reason ? ` (${value.remote.reason})` : ""}`;
      return `Disconnected ${label} adapter auth; ${remoteLine}.`;
    },
  );
  return 0;
}

function readAuthTargetPositional(
  parsed: ParsedArgs,
  command: string,
): string {
  const target = parsed.positionals[0];
  if (!target) {
    throw new UsageError(`workbench auth ${command} requires adapter or adapter/slot.`);
  }
  if (parsed.positionals.length > 1) {
    throw new UsageError(
      `Unexpected argument for workbench auth ${command}: ${parsed.positionals.slice(1).join(" ")}`,
    );
  }
  if (!/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?$/u.test(target)) {
    throw new UsageError("Adapter auth target must be adapter or adapter/slot.");
  }
  return target;
}

function readAuthProfileFlag(parsed: ParsedArgs): string {
  const profile = asOptionalString(parsed.flags.profile) ?? "default";
  if (!/^[a-z][a-z0-9-]*$/u.test(profile)) {
    throw new UsageError("--profile must be a lowercase identifier.");
  }
  return profile;
}

async function resolveAdapterForAuthTarget(
  dir: string,
  targetRaw: string,
): Promise<ResolvedWorkbenchAdapter> {
  const target = parseWorkbenchAdapterAuthTarget(targetRaw);
  const spec = (await readLocalProjectSource(dir)).spec;
  const adapters = await resolveWorkbenchAdaptersForProject(
    dir,
    spec,
  );
  const adapter = adapters.find((entry) => entry.manifest.id === target.adapterId);
  if (!adapter) {
    throw new UsageError(
      `Adapter ${target.adapterId} is not used by this benchmark source. Add it to the benchmark, subject, or optimizer YAML before connecting auth.`,
    );
  }
  if (!adapter.manifest.auth) {
    throw new UsageError(`Adapter ${target.adapterId} does not declare auth.`);
  }
  return adapter;
}

function readAdapterConnectMethod(
  manifest: ResolvedWorkbenchAdapter["manifest"],
  slot: string | undefined,
  parsed: ParsedArgs,
): string {
  const supported = adapterAuthMethodNames(manifest, slot);
  if (supported.length === 0) {
    const label = slot ? `${manifest.id}/${slot}` : manifest.id;
    throw new UsageError(`Adapter ${label} does not declare auth methods.`);
  }
  const method = asOptionalString(parsed.flags.method) ?? (supported.includes("oauth") ? "oauth" : supported[0]!);
  if (!supported.includes(method)) {
    const label = slot ? `${manifest.id}/${slot}` : manifest.id;
    throw new UsageError(
      `--method ${method} is not supported for ${label}. Supported methods: ${supported.join(", ")}.`,
    );
  }
  return method;
}

function readAdapterAuthMethodEnvEntries(
  manifest: ResolvedWorkbenchAdapter["manifest"],
  slot: string | undefined,
  method: string,
): Array<{ name: string; required: boolean }> {
  const methodManifest = adapterAuthMethodManifest(manifest, slot, method);
  const env = methodManifest?.env;
  if (!Array.isArray(env) || env.length === 0) {
    const files = methodManifest?.files;
    if (Array.isArray(files) && files.length > 0) {
      return [];
    }
    const label = slot ? `${manifest.id}/${slot}` : manifest.id;
    throw new UsageError(
      `Adapter ${label} method ${method} cannot be collected by this CLI yet; use an env-backed method.`,
    );
  }
  return env.map((entry) => normalizeAdapterAuthEnvManifestEntry(manifest.id, entry));
}

async function collectAdapterAuthForConnect(args: {
  adapter: ResolvedWorkbenchAdapter;
  target: WorkbenchAdapterAuthTarget;
  targetRaw: string;
  method: string;
  profileRoot: string;
  cwd: string;
}): Promise<WorkbenchAdapterAuthBundle> {
  const methodManifest = adapterAuthMethodManifest(
    args.adapter.manifest,
    args.target.slot,
    args.method,
  );
  if (!methodManifest) {
    throw new UsageError(`Adapter ${args.targetRaw} does not declare method ${args.method}.`);
  }
  if (typeof methodManifest.command === "string" && methodManifest.command.trim()) {
    return adapterAuthBundleFromCommand({
      target: args.target,
      method: args.method,
      command: methodManifest.command.trim(),
      cwd: args.cwd,
    });
  }
  const envEntries = readAdapterAuthMethodEnvEntries(
    args.adapter.manifest,
    args.target.slot,
    args.method,
  );
  const env = Object.fromEntries(envEntries.flatMap((entry) => {
    const value = process.env[entry.name]?.trim() ?? "";
    return value ? [[entry.name, value]] : [];
  }));
  const missing = envEntries
    .filter((entry) => entry.required && !env[entry.name])
    .map((entry) => entry.name);
  if (missing.length > 0) {
    throw new UsageError(`Missing required auth environment variable${missing.length === 1 ? "" : "s"} for ${args.targetRaw}: ${missing.join(", ")}.`);
  }
  const files = await readAdapterAuthMethodFiles({
    manifest: args.adapter.manifest,
    slot: args.target.slot,
    method: args.method,
    profileRoot: args.profileRoot,
  });
  return createWorkbenchAdapterAuthBundle({
    target: args.target,
    method: args.method,
    files,
    env,
  });
}

async function readAdapterAuthMethodFiles(args: {
  manifest: ResolvedWorkbenchAdapter["manifest"];
  slot: string | undefined;
  method: string;
  profileRoot: string;
}): Promise<WorkbenchAdapterAuthBundle["files"]> {
  const methodManifest = adapterAuthMethodManifest(args.manifest, args.slot, args.method);
  const filePaths = methodManifest?.files;
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return [];
  }
  const files: WorkbenchAdapterAuthBundle["files"] = [];
  for (const entry of filePaths) {
    const { path: normalized, required } = normalizeAdapterAuthFileManifestEntry(
      args.manifest.id,
      entry,
    );
    const absolute = path.join(args.profileRoot, normalized);
    const content = await fs.readFile(absolute, "utf8").catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        if (!required) {
          return null;
        }
        throw new UsageError(`Missing required auth profile file for ${args.manifest.id}: ${absolute}.`);
      }
      throw error;
    });
    if (content === null) {
      continue;
    }
    files.push({
      path: normalized,
      content,
      encoding: "utf8",
    });
  }
  return files;
}

function normalizeAdapterAuthFileManifestEntry(
  adapterId: string,
  entry: unknown,
): { path: string; required: boolean } {
  const filePath = typeof entry === "string"
    ? entry
    : entry && typeof entry === "object" && !Array.isArray(entry)
      ? (entry as Record<string, unknown>).path
      : undefined;
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new UsageError(`Adapter ${adapterId} declares invalid auth file path.`);
  }
  const normalized = filePath.replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (!normalized || normalized.split("/").some((part) => part === "." || part === ".." || part === "")) {
    throw new UsageError(`Adapter ${adapterId} declares unsafe auth file path: ${filePath}.`);
  }
  const required = entry && typeof entry === "object" && !Array.isArray(entry)
    ? (entry as Record<string, unknown>).required !== false
    : true;
  return { path: normalized, required };
}

function normalizeAdapterAuthEnvManifestEntry(
  adapterId: string,
  entry: unknown,
): { name: string; required: boolean } {
  const name = typeof entry === "string"
    ? entry
    : entry && typeof entry === "object" && !Array.isArray(entry)
      ? (entry as Record<string, unknown>).name
      : undefined;
  if (typeof name !== "string" || !/^[A-Z_][A-Z0-9_]*$/u.test(name)) {
    throw new UsageError(`Adapter ${adapterId} declares invalid auth env var ${String(name)}.`);
  }
  const required = entry && typeof entry === "object" && !Array.isArray(entry)
    ? (entry as Record<string, unknown>).required !== false
    : true;
  return { name, required };
}

async function adapterAuthBundleFromCommand(args: {
  target: WorkbenchAdapterAuthTarget;
  method: string;
  command: string;
  cwd: string;
}): Promise<WorkbenchAdapterAuthBundle> {
  const { stdout } = await runShellCommand({
    command: args.command,
    cwd: args.cwd,
    env: process.env,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new UsageError(
      `Adapter auth command for ${args.target.adapterId} must print one JSON object: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError(`Adapter auth command for ${args.target.adapterId} must print one JSON object.`);
  }
  const record = parsed as Record<string, unknown>;
  const env = normalizeAdapterCommandAuthEnv(record.env);
  const files = Array.isArray(record.files)
    ? record.files as WorkbenchAdapterAuthBundle["files"]
    : [];
  return createWorkbenchAdapterAuthBundle({
    target: args.target,
    method: args.method,
    files,
    env,
  });
}

function normalizeAdapterCommandAuthEnv(value: unknown): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(value.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }
      const record = entry as Record<string, unknown>;
      return typeof record.name === "string" && typeof record.value === "string"
        ? [[record.name, record.value]]
        : [];
    }));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  }
  throw new UsageError("Adapter auth command env must be an object or a list.");
}

async function runShellCommand(args: {
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  errorLabel?: string;
}): Promise<{ stdout: string; stderr: string }> {
  const label = args.errorLabel ?? args.command;
  return await new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", args.command], {
      cwd: args.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: args.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${label} exited with code ${code ?? "null"} signal ${signal ?? "null"}${stderr.trim() ? `: ${stderr.trim()}` : ""}.`));
    });
  });
}

async function readLocalProjectSourceIfPresent(dir: string): Promise<LocalProjectSource | null> {
  if (!(await fileIsReadable(path.join(dir, WORKBENCH_BENCHMARK_FILE)))) {
    return null;
  }
  return await readLocalProjectSource(dir);
}

async function fileIsReadable(filePath: string): Promise<boolean> {
  return await fs.stat(filePath).then((stat) => stat.isFile(), () => false);
}

function adapterAuthMethodNames(
  manifest: ResolvedWorkbenchAdapter["manifest"],
  slot: string | undefined,
): string[] {
  const auth = adapterAuthRecord(manifest.auth);
  if (!auth) {
    return [];
  }
  const methods = slot
    ? adapterAuthRecord(adapterAuthRecord(auth.slots)?.[slot])?.methods
    : auth.methods;
  return adapterAuthRecord(methods)
    ? Object.keys(methods as Record<string, unknown>).sort()
    : [];
}

function adapterAuthMethodManifest(
  manifest: ResolvedWorkbenchAdapter["manifest"],
  slot: string | undefined,
  method: string,
): Record<string, unknown> | null {
  const auth = adapterAuthRecord(manifest.auth);
  if (!auth) {
    return null;
  }
  const methods = slot
    ? adapterAuthRecord(adapterAuthRecord(auth.slots)?.[slot])?.methods
    : auth.methods;
  const methodManifest = adapterAuthRecord(methods)?.[method];
  return adapterAuthRecord(methodManifest);
}

function adapterAuthRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function pushBenchmark(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "tag", "visibility", "dry-run", "json"]));
  const dir = resolveSourceDir(parsed);
  const source = await readLocalProjectSource(dir);
  const origin = await readWorkbenchOrigin(dir);
  const baseUrl = await effectiveBaseUrl(origin?.baseUrl);
  const visibility = readBenchmarkVisibility(parsed.flags.visibility);
  const dryRun = parsed.flags["dry-run"] === true;
  if (!origin) {
    if (dryRun) {
      writeOutput(
        {
          ok: true,
          dryRun: true,
          action: "create",
          dir,
          baseUrl,
          benchmarkName: source.spec.name,
          tag: asOptionalString(parsed.flags.tag) ?? null,
          visibility,
          sourceFileCount: sourceFileCount(source),
        },
        parsed,
        io,
        () => `Would push benchmark ${source.spec.name}.`,
      );
      return 0;
    }
    const { project, publishedProject, origin: nextOrigin } = await createHostedBenchmarkFromSource({
      baseUrl,
      dir,
      source,
      visibility,
    });
    writeOutput(
      {
        ok: true,
        action: "create",
        benchmark: publishedProject,
        tag: asOptionalString(parsed.flags.tag) ?? null,
        visibility,
        origin: nextOrigin,
        urls: buildWorkbenchResourceUrls({
          baseUrl,
          projectId: publishedProject.id ?? project.id!,
          owner: nextOrigin.owner,
          projectName: nextOrigin.project,
        }),
      },
      parsed,
      io,
      (record) => {
        const value = record as { origin: WorkbenchOrigin; urls: WorkbenchResourceUrls };
        return [
          `Pushed ${value.origin.owner}/${value.origin.project} (${value.origin.projectId}).`,
          `Open benchmark: ${value.urls.benchmark}`,
        ].join("\n");
      },
    );
    return 0;
  }

  const projectId = origin.projectId;
  if (!projectId) {
    throw new UsageError("Missing hosted benchmark. Run workbench push from a source directory.");
  }
  if (!origin.writable) {
    const signedInUsername = dryRun ? null : await readAuthenticatedWorkbenchUsername(baseUrl);
    if (signedInUsername !== origin.owner) {
      const upstream = upstreamFromOrigin(origin);
      if (dryRun) {
        writeOutput(
          {
            ok: true,
            dryRun: true,
            action: "create",
            dir,
            baseUrl,
            benchmarkName: source.spec.name,
            tag: asOptionalString(parsed.flags.tag) ?? null,
            visibility,
            sourceFileCount: sourceFileCount(source),
            upstream: upstream ?? null,
          },
          parsed,
          io,
          () => `Would create a writable benchmark from read-only origin ${origin.owner}/${origin.project}.`,
        );
        return 0;
      }
      const { project, publishedProject, origin: nextOrigin } = await createHostedBenchmarkFromSource({
        baseUrl,
        dir,
        source,
        visibility,
        upstream,
      });
      writeOutput(
        {
          ok: true,
          action: "create",
          benchmark: publishedProject,
          tag: asOptionalString(parsed.flags.tag) ?? null,
          visibility,
          origin: nextOrigin,
          upstream: upstream ?? null,
          urls: buildWorkbenchResourceUrls({
            baseUrl,
            projectId: publishedProject.id ?? project.id!,
            owner: nextOrigin.owner,
            projectName: nextOrigin.project,
          }),
        },
        parsed,
        io,
        (record) => {
          const value = record as {
            origin: WorkbenchOrigin;
            urls: WorkbenchResourceUrls;
            upstream?: WorkbenchOrigin["upstream"] | null;
          };
          return [
            `Pushed ${value.origin.owner}/${value.origin.project} (${value.origin.projectId}).`,
            ...(value.upstream ? [`Upstream: ${value.upstream.owner}/${value.upstream.project}`] : []),
            `Open benchmark: ${value.urls.benchmark}`,
          ].join("\n");
        },
      );
      return 0;
    }
  }
  if (dryRun) {
    writeOutput(
      {
        ok: true,
        dryRun: true,
        action: "update",
        dir,
        baseUrl,
        benchmarkId: projectId,
        tag: asOptionalString(parsed.flags.tag) ?? null,
        visibility,
        sourceFileCount: sourceFileCount(source),
      },
      parsed,
      io,
      () => `Would push ${sourceFileCount(source)} source file(s) to ${projectId}.`,
    );
    return 0;
  }
  const response = await apiRequest<{
    changed?: boolean;
    sourceFingerprint?: string;
    benchmark: HostedProjectSummary & {
      id: string;
      name: string;
      ownerUsername?: string;
      sourceFingerprint?: string;
      currentSpecVersionId?: string;
    };
  }>(
    projectApiPath(projectId, "/source"),
    {
      method: "PUT",
      body: hostedProjectSourceRequest(source),
    },
    baseUrl,
  );
  const publishedProject =
    visibility === "public"
      ? (await apiRequest<{ benchmark: HostedProjectSummary & { ownerUsername?: string } }>(
          projectApiPath(response.benchmark.id, "/publish"),
          { method: "PUT" },
          baseUrl,
        )).benchmark
      : response.benchmark;
  const nextOrigin = await writeWorkbenchOrigin(dir, {
    baseUrl,
    owner: publishedProject.ownerUsername ?? response.benchmark.ownerUsername ?? origin.owner,
    project: publishedProject.name ?? response.benchmark.name ?? origin.project ?? source.spec.name,
    projectId: publishedProject.id ?? response.benchmark.id,
    writable: true,
    sourceRevisionId: publishedProject.currentSpecVersionId ?? response.benchmark.currentSpecVersionId,
    sourceFingerprint: response.sourceFingerprint ?? publishedProject.sourceFingerprint ?? response.benchmark.sourceFingerprint,
    upstream: origin.upstream,
  });
  writeOutput(
    {
      ok: true,
      action: "update",
      changed: response.changed === true,
      benchmark: publishedProject,
      tag: asOptionalString(parsed.flags.tag) ?? null,
      visibility,
      origin: nextOrigin,
      urls: buildWorkbenchResourceUrls({
        baseUrl,
        projectId: publishedProject.id ?? response.benchmark.id,
        owner: nextOrigin.owner,
        projectName: nextOrigin.project,
      }),
    },
    parsed,
    io,
    (record) => {
      const value = record as { changed: boolean; origin: WorkbenchOrigin; urls: WorkbenchResourceUrls };
      return [
        `${value.changed ? "Pushed" : "Already up to date"} ${value.origin.owner}/${value.origin.project} (${value.origin.projectId}).`,
        `Open benchmark: ${value.urls.benchmark}`,
      ].join("\n");
    },
  );
  return 0;
}

async function createHostedBenchmarkFromSource(args: {
  baseUrl: string;
  dir: string;
  source: LocalProjectSource;
  visibility: "private" | "public";
  upstream?: WorkbenchOrigin["upstream"];
}): Promise<{
  project: HostedProjectSummary;
  publishedProject: HostedProjectSummary;
  origin: WorkbenchOrigin;
}> {
  const response = await apiRequest<{ benchmark: HostedProjectSummary & {
    ownerUsername?: string;
    sourceFingerprint?: string;
    currentSpecVersionId?: string;
  } }>(
    "/api/workbench/benchmarks",
    {
      method: "POST",
      body: hostedProjectSourceRequest(args.source),
    },
    args.baseUrl,
  );
  const project = response.benchmark;
  const publishedProject =
    args.visibility === "public"
      ? (await apiRequest<{ benchmark: HostedProjectSummary & { ownerUsername?: string } }>(
          projectApiPath(project.id!, "/publish"),
          { method: "PUT" },
          args.baseUrl,
        )).benchmark
      : project;
  const origin = await writeWorkbenchOrigin(args.dir, {
    baseUrl: args.baseUrl,
    owner: publishedProject.ownerUsername ?? project.ownerUsername ?? "",
    project: publishedProject.name ?? project.name ?? args.source.spec.name,
    projectId: publishedProject.id ?? project.id!,
    writable: true,
    sourceRevisionId: publishedProject.currentSpecVersionId ?? project.currentSpecVersionId,
    sourceFingerprint: publishedProject.sourceFingerprint ?? project.sourceFingerprint,
    ...(args.upstream ? { upstream: args.upstream } : {}),
  });
  return { project, publishedProject, origin };
}

async function readAuthenticatedWorkbenchUsername(baseUrl: string): Promise<string | null> {
  const config = await loadConfig();
  const status = await readWorkbenchProfileStatus({ ...config, baseUrl });
  return status.authenticated ? status.profile?.username ?? null : null;
}

function upstreamFromOrigin(origin: WorkbenchOrigin): WorkbenchOrigin["upstream"] | undefined {
  if (!origin.owner || !origin.project || !origin.projectId || !origin.sourceRevisionId) {
    return undefined;
  }
  return {
    owner: origin.owner,
    project: origin.project,
    projectId: origin.projectId,
    sourceRevisionId: origin.sourceRevisionId,
  };
}

function readBenchmarkVisibility(value: string | boolean | undefined): "private" | "public" {
  if (value === undefined) {
    return "public";
  }
  if (value === "private" || value === "public") {
    return value;
  }
  throw new UsageError("--visibility must be private or public.");
}

async function cloneProject(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dry-run", "json"]));
  const ref = readRequiredBenchmarkRef(parsed);
  const outputDir = parsed.positionals[1] ?? ref.project;
  if (parsed.positionals.length > 2) {
    throw new UsageError("workbench clone accepts OWNER/BENCHMARK[@REF] and an optional output directory.");
  }
  const baseUrl = await effectiveBaseUrl();
  const projectResponse = await apiRequest<{ benchmark: HostedProjectSummary & {
    id: string;
    name: string;
    ownerUsername: string;
    sourceFingerprint?: string;
  } }>(publicProjectApiPath(ref), {}, baseUrl);
  const filesResponse = await apiRequest<HostedSourceResponse>(
    publicProjectSourceApiPath(ref),
    {},
    baseUrl,
  );
  if (parsed.flags["dry-run"] === true) {
    writeOutput(
      {
        ok: true,
        dryRun: true,
        ref,
        outputDir,
        fileCount: filesResponse.files.length,
      },
      parsed,
      io,
    () => `Would clone ${formatBenchmarkRef(ref)} to ${outputDir}.`,
    );
    return 0;
  }
  await syncSourceFiles(outputDir, filesResponse.files);
  const project = projectResponse.benchmark;
  const sourceProject = filesResponse.benchmark;
  const origin = await writeWorkbenchOrigin(outputDir, {
    baseUrl,
    owner: sourceProject?.ownerUsername ?? project.ownerUsername,
    project: sourceProject?.name ?? project.name,
    projectId: sourceProject?.id ?? project.id,
    writable: false,
    sourceRevisionId: sourceProject?.currentSpecVersionId ?? project.currentSpecVersionId,
    sourceFingerprint: sourceProject?.sourceFingerprint ?? project.sourceFingerprint,
  });
  writeOutput(
    {
      ok: true,
      origin,
      outputDir,
      files: filesResponse.files.length,
    },
    parsed,
    io,
    (record) => {
      const value = record as { origin: WorkbenchOrigin; outputDir: string; files: number };
      return `Cloned ${value.origin.owner}/${value.origin.project} to ${value.outputDir} (${value.files} file(s)).`;
    },
  );
  return 0;
}

async function pullProject(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "dry-run", "json"]));
  if (parsed.positionals.length > 0) {
    throw new UsageError("workbench pull updates the current origin; use workbench clone OWNER/BENCHMARK[@REF] DIR for a new directory.");
  }
  const dir = resolveDir(parsed);
  const origin = await requireWorkbenchOrigin(dir);
  const filesResponse = origin.writable
    ? await apiRequest<HostedSourceResponse>(
        projectApiPath(origin.projectId, "/source"),
        {},
        await effectiveBaseUrl(origin.baseUrl),
      )
    : await apiRequest<HostedSourceResponse>(
        publicProjectSourceApiPath({ owner: origin.owner, project: origin.project }),
        {},
        await effectiveBaseUrl(origin.baseUrl),
      );
  if (parsed.flags["dry-run"] === true) {
    writeOutput(
      {
        ok: true,
        dryRun: true,
        dir,
        fileCount: filesResponse.files.length,
      },
      parsed,
      io,
      () => `Would pull ${filesResponse.files.length} source file(s) into ${dir}.`,
    );
    return 0;
  }
  await syncSourceFiles(dir, filesResponse.files);
  const sourceProject = filesResponse.benchmark;
  const nextOrigin = await writeWorkbenchOrigin(dir, {
    ...origin,
    ...(sourceProject?.ownerUsername ? { owner: sourceProject.ownerUsername } : {}),
    ...(sourceProject?.name ? { project: sourceProject.name } : {}),
    ...(sourceProject?.id ? { projectId: sourceProject.id } : {}),
    ...(sourceProject?.currentSpecVersionId ? { sourceRevisionId: sourceProject.currentSpecVersionId } : {}),
    ...(sourceProject?.sourceFingerprint ? { sourceFingerprint: sourceProject.sourceFingerprint } : {}),
  });
  writeOutput(
    {
      ok: true,
      origin: nextOrigin,
      dir,
      files: filesResponse.files.length,
    },
    parsed,
    io,
    (record) => {
      const value = record as { dir: string; files: number };
      return `Pulled ${value.files} source file(s) into ${value.dir}.`;
    },
  );
  return 0;
}

async function fetchProject(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  if (parsed.positionals.length > 0) {
    throw new UsageError("workbench fetch updates the current remote cache; use workbench clone OWNER/BENCHMARK[@REF] DIR for a new directory.");
  }
  const dir = resolveDir(parsed);
  const origin = await requireWorkbenchOrigin(dir);
  const filesResponse = await readRemoteSourceFiles(origin);
  const fetchRoot = path.join(dir, ".workbench", "fetch");
  await fs.rm(fetchRoot, { force: true, recursive: true });
  await fs.mkdir(fetchRoot, { recursive: true });
  await writeFiles(path.join(fetchRoot, "source"), filesResponse.files);
  const sourceProject = filesResponse.benchmark;
  const nextOrigin = await writeWorkbenchOrigin(dir, {
    ...origin,
    ...(sourceProject?.ownerUsername ? { owner: sourceProject.ownerUsername } : {}),
    ...(sourceProject?.name ? { project: sourceProject.name } : {}),
    ...(sourceProject?.id ? { projectId: sourceProject.id } : {}),
    ...(sourceProject?.currentSpecVersionId ? { sourceRevisionId: sourceProject.currentSpecVersionId } : {}),
    ...(sourceProject?.sourceFingerprint ? { sourceFingerprint: sourceProject.sourceFingerprint } : {}),
  });
  await fs.writeFile(
    path.join(fetchRoot, "manifest.json"),
    `${JSON.stringify({
      fetchedAt: new Date().toISOString(),
      origin: nextOrigin,
      files: filesResponse.files.map((file) => file.path),
    }, null, 2)}\n`,
  );
  writeOutput(
    {
      ok: true,
      origin: nextOrigin,
      dir,
      fetchRoot,
      files: filesResponse.files.length,
    },
    parsed,
    io,
    (record) => {
      const value = record as { files: number; fetchRoot: string };
      return `Fetched ${value.files} source file(s) into ${value.fetchRoot}.`;
    },
  );
  return 0;
}

async function readRemoteSourceFiles(origin: WorkbenchOrigin): Promise<HostedSourceResponse> {
  return origin.writable
    ? await apiRequest<HostedSourceResponse>(
        projectApiPath(origin.projectId, "/source"),
        {},
        await effectiveBaseUrl(origin.baseUrl),
      )
    : await apiRequest<HostedSourceResponse>(
        publicProjectSourceApiPath({ owner: origin.owner, project: origin.project }),
        {},
        await effectiveBaseUrl(origin.baseUrl),
      );
}

async function runRemoteCommand(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const command = argv[0] ?? "show";
  switch (command) {
    case "show":
      return await remoteShow(argv.slice(1), io);
    case "add":
      return await remoteAdd(argv.slice(1), io, "add");
    case "set-url":
      return await remoteAdd(argv.slice(1), io, "set-url");
    case "remove":
      return await remoteRemove(argv.slice(1), io);
    default:
      throw new UsageError(`Unknown command: remote ${argv.join(" ")}`);
  }
}

async function remoteShow(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  const origin = await requireWorkbenchOrigin(resolveDir(parsed));
  writeOutput(
    { ok: true, remote: "origin", origin },
    parsed,
    io,
    (record) => {
      const value = record as { origin: WorkbenchOrigin };
      return [
        `origin\t${value.origin.owner}/${value.origin.project}`,
        `url\t${value.origin.baseUrl}`,
        `writable\t${value.origin.writable ? "yes" : "no"}`,
        ...(value.origin.sourceFingerprint ? [`fingerprint\t${value.origin.sourceFingerprint}`] : []),
      ].join("\n");
    },
  );
  return 0;
}

async function remoteAdd(
  argv: readonly string[],
  io: CliIo,
  command: "add" | "set-url",
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  const [name, refValue] = parsed.positionals;
  if (name !== "origin" || !refValue || parsed.positionals.length !== 2) {
    throw new UsageError(`workbench remote ${command} accepts: origin OWNER/BENCHMARK[@REF].`);
  }
  const ref = parseBenchmarkRef(refValue);
  const baseUrl = await effectiveBaseUrl();
  const project = await resolveRemoteProject(formatBenchmarkRef(ref), baseUrl);
  const origin = await writeWorkbenchOrigin(resolveDir(parsed), {
    baseUrl,
    owner: project.ownerUsername ?? ref.owner,
    project: project.name ?? ref.project,
    projectId: project.id,
    writable: false,
    ...(project.currentSpecVersionId ? { sourceRevisionId: project.currentSpecVersionId } : {}),
    ...(project.sourceFingerprint ? { sourceFingerprint: project.sourceFingerprint } : {}),
  });
  writeOutput(
    { ok: true, remote: "origin", origin },
    parsed,
    io,
    () => `Set origin to ${origin.owner}/${origin.project}.`,
  );
  return 0;
}

async function remoteRemove(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  const [name] = parsed.positionals;
  if (name !== "origin" || parsed.positionals.length !== 1) {
    throw new UsageError("workbench remote remove accepts: origin.");
  }
  const originPath = workbenchOriginPath(resolveDir(parsed));
  const existed = await fileIsReadable(originPath);
  await fs.rm(originPath, { force: true });
  writeOutput(
    { ok: true, remote: "origin", removed: existed, path: originPath },
    parsed,
    io,
    () => existed
      ? `Removed origin (${originPath}).`
      : `No origin configured (${originPath}).`,
  );
  return 0;
}

async function starProject(
  argv: readonly string[],
  io: CliIo,
  starred: boolean,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["json"]));
  const ref = readRequiredBenchmarkRef(parsed);
  if (parsed.positionals.length > 1) {
    throw new UsageError(`${starred ? "workbench cloud star" : "workbench cloud unstar"} accepts exactly one OWNER/BENCHMARK ref.`);
  }
  const response = await apiRequest<{ benchmark: HostedProjectSummary }>(
    `${publicProjectApiPath(ref)}/star`,
    { method: starred ? "PUT" : "DELETE" },
    await effectiveBaseUrl(),
  );
  writeOutput(
    { ok: true, benchmark: response.benchmark },
    parsed,
    io,
    (record) => {
      const value = record as { benchmark: { starCount: number } };
      return `${starred ? "Starred" : "Unstarred"} ${formatBenchmarkRef(ref)}; ${value.benchmark.starCount} star(s).`;
    },
  );
  return 0;
}

async function startHostedWorkflow(
  workflow: HostedRunWorkflow,
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set([
    "dir",
    "benchmark",
    "base",
    "optimizer",
    "budget",
    "samples",
    "watch",
    "dry-run",
    "interval-ms",
    "timeout-ms",
    "json",
  ]));
  if (parsed.positionals.length > 1) {
    throw new UsageError(`workbench cloud ${workflow} accepts at most one source file or directory argument.`);
  }
  const optimizerPath = asOptionalString(parsed.flags.optimizer);
  const sourceArg = parsed.positionals[0] ?? asOptionalString(parsed.flags.dir) ?? process.cwd();
  if (parsed.positionals.length > 0 && parsed.flags.dir !== undefined) {
    throw new UsageError("Use either --dir or SOURCE, not both.");
  }
  const baseSubjectId = asOptionalString(parsed.flags.base);
  const request: {
    workflow: HostedRunWorkflow;
    budget?: number;
    samples: number;
    subjectId?: string;
    subjectSource?: string;
    optimizerSource?: string;
    subjectFiles?: HostedFile[];
    adapterFiles?: HostedFile[];
  } =
    workflow === "improve"
      ? {
          workflow,
          budget: parsePositiveInt(parsed.flags.budget, 1, "budget"),
          samples: parsePositiveInt(parsed.flags.samples, 1, "samples"),
          ...(baseSubjectId ? { subjectId: baseSubjectId } : {}),
        }
      : {
          workflow,
          samples: parsePositiveInt(parsed.flags.samples, 1, "samples"),
          ...(baseSubjectId ? { subjectId: baseSubjectId } : {}),
        };
  if (workflow === "improve" && !optimizerPath) {
    throw new UsageError("workbench cloud improve requires --optimizer OPTIMIZER_YAML.");
  }
  if (parsed.flags.watch !== true && (
    parsed.flags["interval-ms"] !== undefined ||
    parsed.flags["timeout-ms"] !== undefined
  )) {
    throw new UsageError("--interval-ms and --timeout-ms require --watch.");
  }
  const projectSource = await readLocalProjectSource(path.resolve(sourceArg), {
    optimizerPath,
  });
  if (workflow === "eval") {
    request.subjectSource = projectSource.subjectSource;
    request.subjectFiles = projectSource.subjectFiles;
    request.adapterFiles = projectSource.adapterFiles;
  }
  if (workflow === "improve" && projectSource.optimizerSource) {
    request.optimizerSource = projectSource.optimizerSource;
    request.adapterFiles = projectSource.adapterFiles;
  }
  const watchIntervalMs =
    parsed.flags.watch === true
      ? parsePositiveInt(parsed.flags["interval-ms"], 1000, "interval-ms")
      : undefined;
  const watchTimeoutMs =
    parsed.flags.watch === true
      ? parseOptionalPositiveInt(parsed.flags["timeout-ms"], "timeout-ms")
      : undefined;
  const dryRun = parsed.flags["dry-run"] === true;
  if (dryRun) {
    const target = await resolveHostedDryRunTarget(parsed, { sourceDir: projectSource.dir });
    writeOutput(
      {
        ok: true,
        dryRun: true,
        projectRef: target.projectRef,
        ...(target.projectId ? { projectId: target.projectId } : {}),
        dir: target.dir,
        baseUrl: target.baseUrl,
        request,
      },
      parsed,
      io,
      () => `Would start hosted ${workflow} for ${target.projectRef}.`,
    );
    return 0;
  }
  const target = await resolveHostedTarget(parsed, {
    requireProjectIdentity: true,
    sourceDir: projectSource.dir,
  });
  if (workflow === "improve") {
    request.subjectId = await ensureHostedImproveBaseSubject({
      parsed,
      target,
      samples: request.samples,
      subjectId: baseSubjectId,
      intervalMs: watchIntervalMs ?? 1000,
      timeoutMs: watchTimeoutMs,
    });
  }
  const response = await apiRequest<{ run: HostedRunRecord }>(
    projectApiPath(target.projectId, "/runs"),
    {
      method: "POST",
      body: request,
    },
    target.baseUrl,
  );
  const startedRun = withRunUrls(target, response.run);
  if (parsed.flags.watch === true) {
    if (parsed.flags.json !== true) {
      io.stdout.write(
        `${formatHostedRunStarted(startedRun, workflow).trimEnd()}\n${HOSTED_WATCH_LIFECYCLE_NOTE}\n`,
      );
    }
    const watched = await watchHostedRun({
      parsed,
      target,
      runId: response.run.id,
      intervalMs: watchIntervalMs ?? 1000,
      timeoutMs: watchTimeoutMs,
    });
    const outputRun = await withHostedRunFailureSummary(target, watched);
    writeOutput(
      withRunUrls(target, outputRun),
      parsed,
      io,
      formatHostedRunResult,
    );
    return hostedRunSucceeded(watched) ? 0 : 1;
  }
  writeOutput(startedRun, parsed, io, (run) =>
    formatHostedRunStarted(run as HostedRunRecord, workflow).trimEnd(),
  );
  return 0;
}

async function ensureHostedImproveBaseSubject(args: {
  parsed: ParsedArgs;
  target: HostedTarget;
  samples: number;
  subjectId?: string;
  intervalMs: number;
  timeoutMs?: number;
}): Promise<string> {
  if (args.subjectId) {
    const subject = await readHostedSubjectSummary(args.target, args.subjectId);
    if (!subject) {
      throw new UsageError(
        `Base subject ${args.subjectId} was not found for the current benchmark.`,
      );
    }
    if (hostedSubjectIsEvaluated(subject)) {
      return args.subjectId;
    }
  } else {
    const activeSubject = await readEvaluatedActiveHostedSubject(args.target);
    if (activeSubject) {
      return activeSubject.id;
    }
  }
  const response = await apiRequest<{ run: HostedRunRecord }>(
    projectApiPath(args.target.projectId, "/runs"),
    {
      method: "POST",
      body: {
        workflow: "eval",
        samples: args.samples,
        ...(args.subjectId ? { subjectId: args.subjectId } : {}),
      },
    },
    args.target.baseUrl,
  );
  const watched = await watchHostedRun({
    parsed: args.parsed,
    target: args.target,
    runId: response.run.id,
    intervalMs: args.intervalMs,
    timeoutMs: args.timeoutMs,
  });
  if (!hostedRunSucceeded(watched)) {
    throw new UsageError(`Parent subject eval ${watched.id} failed; improve was not started.`);
  }
  if (!watched.subjectId) {
    throw new UsageError(`Parent subject eval ${watched.id} did not produce a subject.`);
  }
  return watched.subjectId;
}

interface HostedSubjectSummary {
  id: string;
  status?: string;
  eval?: unknown;
}

async function readHostedSubjectSummary(
  target: HostedTarget,
  subjectId: string,
): Promise<HostedSubjectSummary | null> {
  const response = await apiRequest<{ subjects: HostedSubjectSummary[] }>(
    projectApiPath(target.projectId, "/subjects"),
    {},
    target.baseUrl,
  );
  return response.subjects.find((entry) => entry.id === subjectId) ?? null;
}

async function readEvaluatedActiveHostedSubject(
  target: HostedTarget,
): Promise<HostedSubjectSummary | null> {
  const response = await apiRequest<{ benchmark: HostedProjectSummary }>(
    projectApiPath(target.projectId),
    {},
    target.baseUrl,
  );
  const activeSubjectId = response.benchmark.activeSubjectId;
  if (!activeSubjectId) {
    return null;
  }
  const subject = await readHostedSubjectSummary(target, activeSubjectId);
  return subject && hostedSubjectIsEvaluated(subject) ? subject : null;
}

function hostedSubjectIsEvaluated(subject: HostedSubjectSummary): boolean {
  return subject.status === "evaluated" || subject.eval != null;
}

async function benchmarkList(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["json"]));
  rejectUnexpectedPositionals(parsed, "workbench cloud benchmarks list", 0);
  const response = await apiRequest<{ benchmarks: unknown[] }>(
    "/api/workbench/public/benchmarks",
  );
  writeOutput(response.benchmarks, parsed, io, (projects) => {
    if ((projects as unknown[]).length === 0) {
      return "No hosted Workbench benchmarks.";
    }
    return (
      projects as Array<{
        id: string;
        name: string;
        runCount: number;
        subjectCount: number;
      }>
    )
      .map(
        (project) =>
          `${project.id}\t${project.name}\t${project.runCount} runs\t${project.subjectCount} subjects`,
      )
      .join("\n");
  });
  return 0;
}

async function benchmarkShow(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  rejectUnexpectedPositionals(parsed, "workbench cloud benchmarks show", 1);
  const dir = resolveDir(parsed);
  const origin = await readWorkbenchOrigin(dir);
  const projectRef =
    parsed.positionals[0] ??
    origin?.projectId;
  if (!projectRef) {
    throw new UsageError(
      "Missing hosted benchmark. Pass OWNER/BENCHMARK, run workbench push, or run workbench clone.",
    );
  }
  const response = await apiRequest<{ benchmark: unknown }>(
    benchmarkApiPath(projectRef),
    {},
    await effectiveBaseUrl(origin?.baseUrl),
  );
  writeOutput(response.benchmark, parsed, io, (project) => {
    const record = project as {
      id: string;
      name: string;
      runs: unknown[];
      subjects: unknown[];
    };
    return `${record.name} (${record.id})\n${record.runs.length} runs\n${record.subjects.length} subjects`;
  });
  return 0;
}

async function benchmarkDelete(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "dry-run", "json"]));
  if (parsed.positionals.length > 1) {
    throw new UsageError(
      `Unexpected argument for workbench benchmarks delete: ${parsed.positionals.slice(1).join(" ")}`,
    );
  }
  const dir = resolveDir(parsed);
  const origin = await readWorkbenchOrigin(dir);
  const projectRef =
    parsed.positionals[0] ??
    origin?.projectId;
  if (!projectRef) {
    throw new UsageError(
      "Missing hosted benchmark. Pass OWNER/BENCHMARK, run workbench push, or run workbench clone.",
    );
  }
  const originPath = workbenchOriginPath(dir);
  const baseUrl = await effectiveBaseUrl(origin?.baseUrl);
  if (parsed.flags["dry-run"] === true) {
    const originProjectDeleted = originMatchesProjectRef(origin, projectRef);
    writeOutput(
      {
        ok: true,
        dryRun: true,
        projectRef,
        ...(isRemoteProjectId(projectRef) ? { projectId: projectRef } : {}),
        ...(originProjectDeleted && origin?.project ? { projectName: origin.project } : {}),
        baseUrl,
        ...(originProjectDeleted ? { originPath } : {}),
      },
      parsed,
      io,
      () =>
        originProjectDeleted
          ? `Would delete hosted benchmark ${projectRef} and remove local origin ${originPath}.`
          : `Would delete hosted benchmark ${projectRef}.`,
    );
    return 0;
  }
  const project = await resolveRemoteProject(projectRef, baseUrl);
  const projectId = project.id;
  const projectName = project.name;
  const originProjectDeleted = origin ? origin.projectId === projectId : false;
  await apiRequest<{ deleted: boolean }>(
    projectApiPath(projectId),
    { method: "DELETE" },
    baseUrl,
  );
  if (originProjectDeleted) {
    await fs.rm(originPath, { force: true });
  }
  writeOutput(
    {
      ok: true,
      deleted: true,
      projectId,
      ...(projectName ? { projectName } : {}),
      originRemoved: originProjectDeleted,
      ...(originProjectDeleted ? { originPath } : {}),
    },
    parsed,
    io,
    () =>
      originProjectDeleted
        ? `Deleted benchmark ${formatProjectRef(project)} and removed local origin ${originPath}.`
        : `Deleted benchmark ${formatProjectRef(project)}.`,
  );
  return 0;
}

async function benchmarkVersions(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  rejectUnexpectedPositionals(parsed, "workbench cloud benchmarks versions", 1);
  const projectRef = parsed.positionals[0];
  const origin = await readWorkbenchOrigin(resolveDir(parsed));
  if (!projectRef && !origin) {
    throw new UsageError("Missing benchmark ref. Pass OWNER/BENCHMARK or run from a benchmark clone.");
  }
  const response = await apiRequest<{ benchmark: HostedProjectSummary & {
    currentSpecVersionId?: string;
    sourceFingerprint?: string;
  } }>(
    benchmarkApiPath(projectRef ?? origin!.projectId),
    {},
    await effectiveBaseUrl(origin?.baseUrl),
  );
  const version = response.benchmark.sourceFingerprint ?? response.benchmark.currentSpecVersionId ?? "current";
  writeOutput(
    {
      ok: true,
      benchmark: response.benchmark,
      versions: [{ ref: "main", digest: version, current: true }],
    },
    parsed,
    io,
    () => `${response.benchmark.name ?? projectRef ?? origin!.project}\tmain\t${shortDigest(version)}\tcurrent`,
  );
  return 0;
}

async function benchmarkStarred(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["json"]));
  rejectUnexpectedPositionals(parsed, "workbench cloud benchmarks starred", 0);
  const response = await apiRequest<{ benchmarks: unknown[] }>(
    "/api/workbench/benchmarks",
  );
  const starred = (response.benchmarks as Array<{ viewerHasStarred?: boolean }>).filter(
    (project) => project.viewerHasStarred === true,
  );
  writeOutput(starred, parsed, io, (benchmarks) => {
    if ((benchmarks as unknown[]).length === 0) {
      return "No starred benchmarks.";
    }
    return (benchmarks as Array<{ ownerUsername?: string; name?: string; starCount?: number }>)
      .map((benchmark) =>
        `${benchmark.ownerUsername ?? "-"} / ${benchmark.name ?? "-"}\t${benchmark.starCount ?? 0} stars`
      )
      .join("\n");
  });
  return 0;
}

async function subjectList(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "benchmark", "json"]));
  rejectUnexpectedPositionals(parsed, "workbench cloud subjects list", 0);
  const target = await resolveHostedTarget(parsed);
  const response = await apiRequest<{ subjects: unknown[] }>(
    projectApiPath(target.projectId, "/subjects"),
    {},
    target.baseUrl,
  );
  writeOutput(response.subjects, parsed, io, (subjects) => {
    if ((subjects as unknown[]).length === 0) {
      return "No subjects yet.";
    }
    return (
      subjects as Array<{
        id: string;
        status: string;
        metrics?: Record<string, number>;
        fileChanges?: string[];
      }>
    )
      .map(
        (subject) =>
          `${subject.id}\t${subject.status}\tmetrics ${formatMetricSummary(subject.metrics)}\t${subject.fileChanges?.length ?? 0} files`,
      )
      .join("\n");
  });
  return 0;
}

async function subjectShow(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "benchmark", "json"]));
  rejectUnexpectedPositionals(parsed, "workbench cloud subjects show", 1);
  const target = await resolveHostedTarget(parsed);
  const subjectId = readRequiredSubjectId(parsed);
  const params = new URLSearchParams({ id: subjectId });
  const subject = await apiRequest<unknown>(
    projectApiPath(target.projectId, `/workbench/record?${params.toString()}`),
    {},
    target.baseUrl,
  );
  writeOutput(subject, parsed, io, (record) => {
    const value = record as { id?: string; status?: string; benchmarkFingerprint?: string; subjectFingerprint?: string };
    return [
      `${value.id ?? subjectId}\t${value.status ?? "unknown"}`,
      ...(value.benchmarkFingerprint ? [`Benchmark version: ${shortDigest(value.benchmarkFingerprint)}`] : []),
      ...(value.subjectFingerprint ? [`Subject digest: ${shortDigest(value.subjectFingerprint)}`] : []),
    ].join("\n");
  });
  return 0;
}

async function subjectFiles(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "benchmark", "json"]));
  rejectUnexpectedPositionals(parsed, "workbench cloud subjects files", 1);
  const target = await resolveHostedTarget(parsed);
  const subjectId = readRequiredSubjectId(parsed);
  const response = await apiRequest<{ files: unknown[] }>(
    projectApiPath(target.projectId, `/subjects/${encodeURIComponent(subjectId)}/files`),
    {},
    target.baseUrl,
  );
  writeOutput(
    response.files,
    parsed,
    io,
    (files) =>
      (files as Array<{ path: string; status: string; preview_kind: string }>)
        .map((file) => `${file.path}\t${file.status}\t${file.preview_kind}`)
        .join("\n") || "No files.",
  );
  return 0;
}

async function subjectPreview(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "benchmark", "path", "output", "json"]));
  rejectUnexpectedPositionals(parsed, "workbench cloud subjects preview", 1);
  const target = await resolveHostedTarget(parsed);
  const subjectId = readRequiredSubjectId(parsed);
  const filePath = requireFlag(parsed, "path");
  const params = new URLSearchParams({ path: filePath });
  const response = await apiRequest<{
    preview: {
      source: { content: string } | null;
      rendered_html: string | null;
      diff: string | null;
    };
  }>(
    projectApiPath(
      target.projectId,
      `/subjects/${encodeURIComponent(subjectId)}/files?${params.toString()}`,
    ),
    {},
    target.baseUrl,
  );
  const content =
    response.preview.source?.content ??
    response.preview.rendered_html ??
    response.preview.diff ??
    "";
  const outputPath = asOptionalString(parsed.flags.output);
  if (outputPath && outputPath !== "-") {
    await fs.writeFile(outputPath, content);
    io.stdout.write(`Wrote preview to ${outputPath}\n`);
  } else if (parsed.flags.json === true) {
    writeJson(response.preview, io);
  } else {
    io.stdout.write(content);
  }
  return 0;
}

async function subjectExport(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "benchmark", "out", "json"]));
  rejectUnexpectedPositionals(parsed, "workbench cloud subjects pull", 1);
  const target = await resolveHostedTarget(parsed);
  const subjectId = readRequiredSubjectId(parsed);
  const outputDir = requireOutDir(parsed);
  const response = await apiRequest<{ files: HostedFile[] }>(
    projectApiPath(target.projectId, `/subjects/${encodeURIComponent(subjectId)}/export`),
    {},
    target.baseUrl,
  );
  await writeFiles(outputDir, response.files);
  writeOutput(
    { ok: true, outputDir, files: response.files.length },
    parsed,
    io,
    (result) => {
      const record = result as { outputDir: string; files: number };
      return `Exported ${record.files} file(s) to ${record.outputDir}`;
    },
  );
  return 0;
}

async function subjectVisibility(
  argv: readonly string[],
  io: CliIo,
  visibility: "private" | "public",
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "benchmark", "json"]));
  rejectUnexpectedPositionals(parsed, `workbench cloud subjects ${visibility === "public" ? "publish" : "unpublish"}`, 1);
  const target = await resolveHostedTarget(parsed, { requireProjectIdentity: true });
  const subjectId = readRequiredSubjectId(parsed);
  const response = await apiRequest<{ subject: unknown }>(
    projectApiPath(target.projectId, `/subjects/${encodeURIComponent(subjectId)}/publish`),
    { method: visibility === "public" ? "PUT" : "DELETE" },
    target.baseUrl,
  );
  writeOutput(
    { ok: true, visibility, subject: response.subject },
    parsed,
    io,
    () => `${visibility === "public" ? "Published" : "Unpublished"} subject ${subjectId}.`,
  );
  return 0;
}

async function runList(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "benchmark", "json"]));
  rejectUnexpectedPositionals(parsed, "workbench cloud runs list", 0);
  const target = await resolveHostedTarget(parsed);
  const response = await apiRequest<{ runs: unknown[] }>(
    projectApiPath(target.projectId, "/runs"),
    {},
    target.baseUrl,
  );
  writeOutput(
    response.runs,
    parsed,
    io,
    (runs) =>
      (
        runs as Array<{
          id: string;
          status: string;
          subjectId: string | null;
        }>
      )
        .map(
          (run) => `${run.id}\t${run.status}\t${run.subjectId ?? "pending"}`,
        )
        .join("\n") || "No runs.",
  );
  return 0;
}

async function runShow(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "benchmark", "json"]));
  rejectUnexpectedPositionals(parsed, "workbench cloud runs show", 1);
  const target = await resolveHostedTarget(parsed, { requireProjectIdentity: true });
  const runId = readRequiredRunId(parsed);
  const response = await apiRequest<{
    run: HostedRunRecord;
    jobs: HostedRunJobRecord[];
  }>(
    projectApiPath(target.projectId, `/runs/${encodeURIComponent(runId)}`),
    {},
    target.baseUrl,
  );
  const detail = withRunDetailUrls(target, response);
  writeOutput(detail, parsed, io, formatRunDetail);
  return 0;
}

async function runCancel(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "benchmark", "json"]));
  rejectUnexpectedPositionals(parsed, "workbench cloud runs cancel", 1);
  const target = await resolveHostedTarget(parsed, { requireProjectIdentity: true });
  const runId = readRequiredRunId(parsed);
  const response = await apiRequest<{ run: HostedRunRecord }>(
    projectApiPath(target.projectId, `/runs/${encodeURIComponent(runId)}`),
    { method: "DELETE" },
    target.baseUrl,
  );
  const run = withRunUrls(target, response.run);
  writeOutput(run, parsed, io, (record) => {
    const value = record as HostedRunRecord;
    return [
      `Cancelled run ${value.id}; status ${value.status}; outcome ${value.outcome ?? "cancelled"}.`,
      `Open benchmark: ${value.urls?.benchmark ?? buildWorkbenchResourceUrls(target).benchmark}`,
    ].join("\n");
  });
  return 0;
}

async function runWatch(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "benchmark", "interval-ms", "timeout-ms", "json"]));
  rejectUnexpectedPositionals(parsed, "workbench cloud watch", 1);
  const target = await resolveHostedTarget(parsed, { requireProjectIdentity: true });
  const runId = readRequiredRunId(parsed);
  if (parsed.flags.json !== true) {
    io.stdout.write(`Watching run ${runId}.\n${HOSTED_WATCH_LIFECYCLE_NOTE}\n`);
  }
  const run = await watchHostedRun({
    parsed,
    target,
    runId,
    intervalMs: parsePositiveInt(
      parsed.flags["interval-ms"],
      1000,
      "interval-ms",
    ),
    timeoutMs: parseOptionalPositiveInt(
      parsed.flags["timeout-ms"],
      "timeout-ms",
    ),
  });
  const outputRun = await withHostedRunFailureSummary(target, run);
  writeOutput(withRunUrls(target, outputRun), parsed, io, formatHostedRunResult);
  return hostedRunSucceeded(run) ? 0 : 1;
}

async function runLogs(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "benchmark", "json"]));
  rejectUnexpectedPositionals(parsed, "workbench cloud logs", 1);
  const target = await resolveHostedTarget(parsed);
  const requestedRunId = parsed.positionals[0];
  if (requestedRunId) {
    const response = await apiRequest<{
      run: HostedRunRecord;
      jobs: Array<{
        id: string;
        runId: string;
        kind: string;
        status: string;
        subjectId?: string;
        error?: string;
      }>;
    }>(
      projectApiPath(target.projectId, `/runs/${encodeURIComponent(requestedRunId)}`),
      {},
      target.baseUrl,
    );
    writeOutput(
      { runId: response.run.id, jobs: response.jobs },
      parsed,
      io,
      formatRunLogs,
    );
    return 0;
  }
  const project = (
    await apiRequest<{
      project: {
        runs: HostedRunRecord[];
        jobs: Array<{
          id: string;
          runId: string;
          kind: string;
          status: string;
          subjectId?: string;
          error?: string;
        }>;
      };
    }>(projectApiPath(target.projectId), {}, target.baseUrl)
  ).project;
  const runId = project.runs.at(-1)?.id;
  if (!runId) {
    throw new UsageError("Missing RUN_ID; the benchmark has no runs.");
  }
  const jobs = project.jobs.filter((job) => job.runId === runId);
  writeOutput({ runId, jobs }, parsed, io, formatRunLogs);
  return 0;
}

function formatRunLogs(record: unknown): string {
  const value = record as {
    runId: string;
    jobs: Array<{
      id: string;
      kind: string;
      status: string;
      subjectId?: string;
      error?: string;
    }>;
  };
  return (
    value.jobs
      .map(
        (job) =>
          `${job.id}\t${job.kind}\t${job.status}\t${job.subjectId ?? "-"}${job.error ? `\t${job.error}` : ""}`,
      )
      .join("\n") || `No jobs for ${value.runId}.`
  );
}

async function openWorkbench(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "benchmark", "no-open", "json"]));
  if (parsed.positionals.length > 1) {
    throw new UsageError(
      `Unexpected argument for workbench open: ${parsed.positionals.slice(1).join(" ")}`,
    );
  }
  const target = await resolveOpenTarget(parsed);
  const ref = target.openRef;
  const url = buildWorkbenchWebUrl(target, ref);
  if (parsed.flags.json === true) {
    writeJson({ ok: true, url }, io);
  } else {
    io.stdout.write(`${url}\n`);
  }
  if (parsed.flags["no-open"] !== true) {
    await openBrowser(url).catch(() => undefined);
  }
  return 0;
}

function buildWorkbenchWebUrl(
  target: HostedTarget,
  ref?: string,
): string {
  const urls = buildWorkbenchResourceUrls(target);
  const benchmarkUrl = urls.benchmark;
  if (!ref) {
    return benchmarkUrl;
  }
  if (ref.startsWith("wb_")) {
    return benchmarkUrl;
  }
  if (ref.startsWith("run_")) {
    return benchmarkUrl;
  }
  return buildWorkbenchResourceUrls(target, { subjectId: ref }).subjectEvaluation!;
}

async function resolveHostedTarget(
  parsed: ParsedArgs,
  options: { requireProjectIdentity?: boolean; sourceArg?: string; sourceDir?: string } = {},
): Promise<HostedTarget> {
  if (options.sourceArg !== undefined && parsed.flags.dir !== undefined) {
    throw new UsageError("Use either --dir or SOURCE, not both.");
  }
  const dir = options.sourceDir
    ? path.resolve(options.sourceDir)
    : resolveDir(parsed, options.sourceArg);
  const origin = await readWorkbenchOrigin(dir);
  const explicitProject = asOptionalString(parsed.flags.benchmark);
  const baseUrl = await effectiveBaseUrl(origin?.baseUrl);
  if (explicitProject && (!isRemoteProjectId(explicitProject) || options.requireProjectIdentity === true)) {
    const project = await resolveRemoteProject(explicitProject, baseUrl);
    return {
      projectId: project.id,
      owner: project.ownerUsername,
      projectName: project.name ?? explicitProject,
      dir,
      baseUrl,
      origin,
    };
  }
  const projectId = explicitProject ?? origin?.projectId;
  if (!projectId) {
    throw new UsageError(
      "Missing hosted benchmark. Run workbench push, workbench clone, or pass --benchmark OWNER/BENCHMARK.",
    );
  }
  return {
    projectId,
    ...(!explicitProject && origin?.owner ? { owner: origin.owner } : {}),
    ...(!explicitProject && origin?.project
      ? { projectName: origin.project }
      : {}),
    dir,
    baseUrl,
    origin,
  };
}

async function resolveHostedDryRunTarget(
  parsed: ParsedArgs,
  options: { sourceArg?: string; sourceDir?: string } = {},
): Promise<HostedDryRunTarget> {
  if (options.sourceArg !== undefined && parsed.flags.dir !== undefined) {
    throw new UsageError("Use either --dir or SOURCE, not both.");
  }
  const dir = options.sourceDir
    ? path.resolve(options.sourceDir)
    : resolveDir(parsed, options.sourceArg);
  const origin = await readWorkbenchOrigin(dir);
  const explicitProject = asOptionalString(parsed.flags.benchmark);
  const baseUrl = await effectiveBaseUrl(origin?.baseUrl);
  if (explicitProject) {
    if (isRemoteProjectId(explicitProject)) {
      return {
        projectRef: explicitProject,
        projectId: explicitProject,
        dir,
        baseUrl,
        origin,
      };
    }
    const ref = parseBenchmarkRef(explicitProject);
    return {
      projectRef: formatBenchmarkRef(ref),
      owner: ref.owner,
      projectName: ref.project,
      dir,
      baseUrl,
      origin,
    };
  }
  if (origin?.projectId) {
    return {
      projectRef: origin.owner && origin.project
        ? `${origin.owner}/${origin.project}`
        : origin.projectId,
      projectId: origin.projectId,
      ...(origin.owner ? { owner: origin.owner } : {}),
      ...(origin.project ? { projectName: origin.project } : {}),
      dir,
      baseUrl,
      origin,
    };
  }
  throw new UsageError(
    "Missing hosted benchmark. Run workbench push, workbench clone, or pass --benchmark OWNER/BENCHMARK.",
  );
}

async function resolveOpenTarget(
  parsed: ParsedArgs,
): Promise<HostedTarget & { openRef?: string }> {
  const ref = parsed.positionals[0];
  if (
    ref &&
    !ref.startsWith("run_") &&
    !ref.startsWith("subject_")
  ) {
    const baseUrl = await effectiveBaseUrl();
    if (ref.includes("/")) {
      const parsedRef = parseBenchmarkRef(ref);
      const project = await apiRequest<{ benchmark: { id: string; name?: string; ownerUsername?: string } }>(
        publicProjectApiPath(parsedRef),
        {},
        baseUrl,
      );
      return {
        projectId: project.benchmark.id,
        owner: project.benchmark.ownerUsername ?? parsedRef.owner,
        projectName: project.benchmark.name ?? parsedRef.project,
        dir: resolveDir(parsed),
        baseUrl,
      };
    }
    const project = await resolveRemoteProject(ref, baseUrl);
    return {
      projectId: project.id,
      owner: project.ownerUsername,
      projectName: project.name ?? ref,
      dir: resolveDir(parsed),
      baseUrl,
    };
  }
  return {
    ...(await resolveHostedTarget(parsed, { requireProjectIdentity: true })),
    ...(ref ? { openRef: ref } : {}),
  };
}

function buildWorkbenchResourceUrls(
  target: Pick<HostedTarget, "baseUrl" | "projectId"> & { owner?: string; projectName?: string },
  refs: {
    runId?: string | null;
    subjectId?: string | null;
  } = {},
): WorkbenchResourceUrls {
  if (!target.owner || !target.projectName) {
    throw new UsageError(
      `Cannot build Workbench Cloud URL for ${target.projectId} without owner username and benchmark name.`,
    );
  }
  const projectRef = `${encodeURIComponent(target.owner)}/${encodeURIComponent(target.projectName)}`;
  const benchmark = `${target.baseUrl}/benchmarks/${projectRef}`;
  const urls: WorkbenchResourceUrls = { benchmark };
  if (refs.subjectId) {
    const evaluationId = refs.runId
      ? evaluationScorecardId(refs.runId, refs.subjectId)
      : null;
    urls.subjectEvaluation = evaluationId
      ? `${benchmark}/subjects/${encodeURIComponent(refs.subjectId)}?evaluation=${encodeURIComponent(evaluationId)}`
      : `${benchmark}/subjects/${encodeURIComponent(refs.subjectId)}`;
  }
  return urls;
}

function projectApiPath(projectRef: string, suffix = ""): string {
  return `/api/workbench/benchmarks/${encodeURIComponent(projectRef)}${suffix}`;
}

function benchmarkApiPath(benchmarkRef: string): string {
  if (benchmarkRef.includes("/")) {
    return publicProjectApiPath(parseBenchmarkRef(benchmarkRef));
  }
  return projectApiPath(benchmarkRef);
}

function publicProjectApiPath(ref: { owner: string; project: string }): string {
  return `/api/workbench/public/benchmarks/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.project)}`;
}

function publicProjectSourceApiPath(
  ref: { owner: string; project: string },
): string {
  return `${publicProjectApiPath(ref)}/source`;
}

interface BenchmarkRef {
  owner: string;
  project: string;
  ref?: string;
}

function readRequiredBenchmarkRef(parsed: ParsedArgs): BenchmarkRef {
  const ref = parsed.positionals[0];
  if (!ref) {
    throw new UsageError("Missing required OWNER/BENCHMARK ref.");
  }
  return parseBenchmarkRef(ref);
}

function parseBenchmarkRef(value: string): BenchmarkRef {
  const [namePart, versionRef, extraRef] = value.split("@");
  if (extraRef !== undefined || !namePart) {
    throw new UsageError("Benchmark refs must use OWNER/BENCHMARK[@REF].");
  }
  const [owner, project, extra] = namePart.split("/");
  if (!owner || !project || extra !== undefined) {
    throw new UsageError("Benchmark refs must use OWNER/BENCHMARK[@REF].");
  }
  return { owner, project, ...(versionRef ? { ref: versionRef } : {}) };
}

function formatBenchmarkRef(ref: BenchmarkRef): string {
  return `${ref.owner}/${ref.project}${ref.ref ? `@${ref.ref}` : ""}`;
}

async function resolveRemoteProject(
  projectRef: string,
  baseUrl: string,
): Promise<{
  id: string;
  name?: string;
  ownerUsername?: string;
  currentSpecVersionId?: string;
  sourceFingerprint?: string;
}> {
  if (projectRef.includes("/")) {
    const ref = parseBenchmarkRef(projectRef);
    const response = await apiRequest<{
      benchmark: {
        id: string;
        name?: string;
        ownerUsername?: string;
        currentSpecVersionId?: string;
        sourceFingerprint?: string;
      };
    }>(publicProjectApiPath(ref), {}, baseUrl);
    return response.benchmark;
  }
  const response = await apiRequest<{
    benchmark: {
      id: string;
      name?: string;
      ownerUsername?: string;
      currentSpecVersionId?: string;
      sourceFingerprint?: string;
    };
  }>(projectApiPath(projectRef), {}, baseUrl);
  return response.benchmark;
}

function formatProjectRef(project: { id: string; name?: string }): string {
  return project.name ? `${project.name} (${project.id})` : project.id;
}

function originMatchesProjectRef(
  origin: WorkbenchOrigin | null | undefined,
  projectRef: string,
): boolean {
  if (!origin) {
    return false;
  }
  if (origin.projectId === projectRef) {
    return true;
  }
  if (!projectRef.includes("/")) {
    return false;
  }
  const ref = parseBenchmarkRef(projectRef);
  return origin.owner === ref.owner && origin.project === ref.project;
}

function withRunUrls(
  target: HostedTarget,
  run: HostedRunRecord,
): HostedRunRecord {
  return {
    ...run,
    urls: buildWorkbenchResourceUrls(target, {
      runId: run.id,
      subjectId: run.outputSubjectId ?? run.subjectId,
    }),
  };
}

function withRunDetailUrls(
  target: HostedTarget,
  detail: {
    run: HostedRunRecord;
    jobs: HostedRunJobRecord[];
  },
): {
  run: HostedRunRecord;
  jobs: HostedRunJobRecord[];
  urls: WorkbenchResourceUrls;
} {
  const subjectId = hostedRunEvaluationSubjectId(detail.run, detail.jobs);
  const run = withRunUrls(target, {
    ...detail.run,
    outputSubjectId: detail.run.outputSubjectId ?? subjectId,
  });
  return {
    run,
    jobs: detail.jobs,
    urls: run.urls ?? buildWorkbenchResourceUrls(target, { runId: run.id }),
  };
}

function hostedRunEvaluationSubjectId(
  run: HostedRunRecord,
  jobs: readonly HostedRunJobRecord[] = [],
): string | null {
  if (run.outputSubjectId) {
    return run.outputSubjectId;
  }
  const attemptSubjects = jobs
    .filter((job) => readRunJobPurpose(job) === "attempt")
    .map((job) => job.subjectId)
    .filter((subjectId): subjectId is string => Boolean(subjectId));
  return attemptSubjects.at(-1) ?? run.subjectId ?? null;
}

function sourceFileCount(source: LocalProjectSource): number {
  return source.sourceFiles.length;
}

function hostedProjectSourceRequest(source: LocalProjectSource): {
  source: string;
  subjectFiles: HostedFile[];
  engineResolveFiles: HostedFile[];
  engineResolveBinding: EngineResolveBinding;
  adapterFiles: HostedFile[];
  dockerfile: string;
  runtimeDockerfile: string;
  runtimeFiles: HostedFile[];
  network: "off" | "on";
  resources: Partial<{
    cpu: number;
    memoryGb: number;
    diskGb: number;
    timeoutMinutes: number;
  }>;
} {
  const { network, resources } = hostedEnvironmentOptions(source);
  return {
    source: source.specSource,
    subjectFiles: source.subjectFiles,
    engineResolveFiles: hostedEngineResolveFiles(source),
    engineResolveBinding: engineResolveBindingForSpec(source.spec),
    adapterFiles: source.adapterFiles,
    dockerfile: source.dockerfile,
    runtimeDockerfile: source.runtimeDockerfile,
    runtimeFiles: source.dockerfileFiles,
    network,
    resources,
  };
}

function hostedEngineResolveFiles(source: LocalProjectSource): HostedFile[] {
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

function isRemoteProjectId(value: string): boolean {
  return /^wb_[a-f0-9]{12}$/u.test(value);
}

function hostedEnvironmentOptions(source: LocalProjectSource): {
  network: "off" | "on";
  resources: Partial<{
    cpu: number;
    memoryGb: number;
    diskGb: number;
    timeoutMinutes: number;
  }>;
} {
  const rawResources = source.spec.environment.resources ?? {};
  return {
    network:
      source.spec.environment.network?.egress === "open"
        ? "on"
        : "off",
    resources: {
      cpu: typeof rawResources.cpu === "number" ? rawResources.cpu : undefined,
      memoryGb:
        typeof rawResources.memoryGb === "number"
          ? rawResources.memoryGb
          : undefined,
      diskGb:
        typeof rawResources.diskGb === "number" ? rawResources.diskGb : undefined,
      timeoutMinutes:
        typeof rawResources.timeoutMinutes === "number"
          ? rawResources.timeoutMinutes
          : undefined,
    },
  };
}

async function watchHostedRun(args: {
  parsed: ParsedArgs;
  target: HostedTarget;
  runId: string;
  intervalMs: number;
  timeoutMs?: number;
}): Promise<HostedRunRecord> {
  const deadline =
    args.timeoutMs === undefined ? undefined : Date.now() + args.timeoutMs;
  let lastRun: HostedRunRecord | null = null;
  while (true) {
    let response: { run: HostedRunRecord };
    try {
      response = await apiRequest<{ run: HostedRunRecord }>(
        projectApiPath(args.target.projectId, `/runs/${encodeURIComponent(args.runId)}`),
        {},
        args.target.baseUrl,
      );
    } catch (error) {
      if (isTransientApiRequestError(error)) {
        if (deadline !== undefined && Date.now() > deadline) {
          throw new Error(
            `Timed out waiting for run ${args.runId}; last status was ${lastRun?.status ?? "unknown"} and the latest poll failed with ${error.message}.`,
          );
        }
        await sleep(args.intervalMs);
        continue;
      }
      throw error;
    }
    lastRun = response.run;
    if (response.run.status === "finished") {
      return response.run;
    }
    if (deadline !== undefined && Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for run ${args.runId}; last status was ${lastRun?.status ?? "unknown"}.`,
      );
    }
    await sleep(args.intervalMs);
  }
}

function formatHostedRunResult(run: HostedRunRecord): string {
  const subjectId = run.outputSubjectId ?? run.subjectId;
  const activeDetail = run.activeSubjectId && subjectId && run.activeSubjectId !== subjectId
    ? `; active ${run.activeSubjectId}`
    : "";
  const summary = `Run ${run.id} reached ${run.status}; ${run.outcome ? `outcome ${run.outcome}; ` : ""}subject ${subjectId ?? "pending"}${activeDetail}; ${run.completedJobCount ?? 0}/${run.jobCount ?? 0} jobs completed.`;
  return [
    run.error ? `${summary}\nError: ${run.error}` : summary,
    ...(run.urls?.subjectEvaluation
      ? [`Open evaluation: ${run.urls.subjectEvaluation}`]
      : [`Open benchmark: ${run.urls?.benchmark ?? ""}`].filter(Boolean)),
  ].join("\n");
}

function formatHostedRunStarted(
  run: HostedRunRecord,
  fallbackWorkflow: HostedRunWorkflow,
): string {
  const subjectId = run.outputSubjectId ?? run.subjectId;
  return [
    `Started ${run.workflow ?? fallbackWorkflow} run ${run.id}; ${subjectId ? `subject ${subjectId}` : `${run.jobCount ?? 0} jobs queued`}.`,
    ...(run.urls?.subjectEvaluation
      ? [`Open evaluation: ${run.urls.subjectEvaluation}`]
      : run.urls?.benchmark ? [`Open benchmark: ${run.urls.benchmark}`] : []),
    "",
  ].join("\n");
}

function formatRunDetail(record: unknown): string {
  const detail = record as {
    run: HostedRunRecord;
    jobs: HostedRunJobRecord[];
    urls: WorkbenchResourceUrls;
  };
  const { run, jobs, urls } = detail;
  const cost = sumJobCostUsd(jobs);
  const firstFailedJob = jobs.find((job) => job.status === "failed" && job.error);
  const subjectId = hostedRunEvaluationSubjectId(run, jobs);
  return [
    `Run ${run.id}: ${run.status}${run.outcome ? ` (${run.outcome})` : ""}`,
    `Workflow: ${run.workflow ?? "improve"}`,
    `Subject: ${subjectId ?? "pending"}`,
    ...(run.activeSubjectId && subjectId && run.activeSubjectId !== subjectId
      ? [`Active subject: ${run.activeSubjectId}`]
      : []),
    `Samples: ${run.samples ?? 0}`,
    `Attempts: ${run.attemptsExecuted ?? 0}/${run.attemptsRequested ?? run.attemptsExecuted ?? 0}`,
    `Jobs: ${run.completedJobCount ?? jobs.filter(isTerminalRunJob).length}/${run.jobCount ?? jobs.length} completed${run.failedJobCount ? `; ${run.failedJobCount} failed` : ""}`,
    ...(typeof run.durationMs === "number"
      ? [`Duration: ${formatDurationMs(run.durationMs)}`]
      : []),
    ...(cost > 0 ? [`Cost: ${formatUsd(cost)}`] : []),
    ...(firstFailedJob?.error
      ? [`First failed job ${firstFailedJob.id}: ${firstFailedJob.error}`]
      : []),
    ...(urls.subjectEvaluation
      ? [`Open evaluation: ${urls.subjectEvaluation}`]
      : [`Open benchmark: ${urls.benchmark}`]),
    ...(jobs.length > 0 ? ["", "Jobs:", ...jobs.map(formatRunJobLine)] : []),
  ].join("\n");
}

function formatRunJobLine(job: HostedRunJobRecord): string {
  return [
    job.id,
    readRunJobPurpose(job) ?? job.kind ?? "job",
    job.status,
    job.subjectId ?? "-",
    job.error ?? "",
  ].filter((value, index) => index < 4 || value !== "").join("\t");
}

function isTerminalRunJob(job: HostedRunJobRecord): boolean {
  return job.status === "succeeded" || job.status === "failed" || job.status === "cancelled";
}

function readRunJobPurpose(job: HostedRunJobRecord): string | null {
  const input = readRecord(job.input);
  const execution = readRecord(input?.execution);
  const purpose = execution?.purpose;
  return typeof purpose === "string" && purpose ? purpose : null;
}

function sumJobCostUsd(jobs: readonly HostedRunJobRecord[]): number {
  const sum = jobs.reduce((total, job) => total + costUsdFromUsage(readRecord(job.output)?.usage), 0);
  return Number.isFinite(sum) ? Math.round(sum * 1_000_000) / 1_000_000 : 0;
}

function costUsdFromUsage(value: unknown): number {
  const usage = readRecord(value);
  if (!usage) {
    return 0;
  }
  const direct = readFiniteNumber(usage.costUsd);
  if (direct !== null) {
    return direct;
  }
  return ["total", "optimizer", "runner", "engine"].reduce((sum, key) => {
    const nested = readRecord(usage[key]);
    return sum + (readFiniteNumber(nested?.costUsd) ?? 0);
  }, 0);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.max(0, Math.round(durationMs))}ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

function shortDigest(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value;
}

async function withHostedRunFailureSummary(
  target: HostedTarget,
  run: HostedRunRecord,
): Promise<HostedRunRecord> {
  if (hostedRunSucceeded(run) || run.error || (run.failedJobCount ?? 0) <= 0) {
    return run;
  }
  const error = await readHostedRunFailureSummary(target, run.id);
  return error ? { ...run, error } : run;
}

async function readHostedRunFailureSummary(
  target: HostedTarget,
  runId: string,
): Promise<string | null> {
  try {
    const project = await apiRequest<{
      benchmark: {
        jobs: Array<{
          id: string;
          runId: string;
          status: string;
          error?: string;
        }>;
      };
    }>(projectApiPath(target.projectId), {}, target.baseUrl);
    const failed = project.benchmark.jobs.find(
      (job) => job.runId === runId && job.status === "failed" && job.error,
    );
    return failed?.error ? `First failed job ${failed.id}: ${failed.error}` : null;
  } catch {
    return null;
  }
}

function hostedRunSucceeded(run: HostedRunRecord): boolean {
  if (run.status !== "finished") {
    return false;
  }
  if ((run.failedJobCount ?? 0) > 0) {
    return false;
  }
  return run.outcome == null || run.outcome === "ok";
}

async function readWorkbenchOrigin(dir: string): Promise<WorkbenchOrigin | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(workbenchOriginPath(dir), "utf8"),
    ) as Partial<WorkbenchOrigin>;
    if (
      !parsed.projectId ||
      !parsed.baseUrl ||
      !parsed.owner ||
      !parsed.project ||
      typeof parsed.writable !== "boolean"
    ) {
      throw new UsageError(`Workbench origin is malformed: ${workbenchOriginPath(dir)}`);
    }
    return {
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      owner: parsed.owner,
      project: parsed.project,
      projectId: parsed.projectId,
      writable: parsed.writable,
      ...(parsed.sourceRevisionId ? { sourceRevisionId: parsed.sourceRevisionId } : {}),
      ...(parsed.sourceFingerprint ? { sourceFingerprint: parsed.sourceFingerprint } : {}),
      ...(parsed.upstream ? { upstream: parsed.upstream } : {}),
      linkedAt: parsed.linkedAt ?? new Date(0).toISOString(),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function requireWorkbenchOrigin(dir: string): Promise<WorkbenchOrigin> {
  const origin = await readWorkbenchOrigin(dir);
  if (!origin) {
    throw new UsageError("Missing Workbench origin. Run workbench push or workbench clone first.");
  }
  return origin;
}

async function writeWorkbenchOrigin(
  dir: string,
  input: Omit<WorkbenchOrigin, "linkedAt"> & { linkedAt?: string },
): Promise<WorkbenchOrigin> {
  const origin: WorkbenchOrigin = {
    ...input,
    baseUrl: normalizeBaseUrl(input.baseUrl),
    linkedAt: input.linkedAt ?? new Date().toISOString(),
  };
  const filePath = workbenchOriginPath(dir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(origin, null, 2)}\n`);
  return origin;
}

function workbenchOriginPath(dir: string): string {
  return path.join(dir, ".workbench", "origin.json");
}

async function effectiveBaseUrl(preferred?: string): Promise<string> {
  const config = await loadConfig();
  return normalizeBaseUrl(
    process.env.WORKBENCH_API_URL ??
      preferred ??
      config.baseUrl ??
      DEFAULT_BASE_URL,
  );
}

async function readWorkbenchProfileStatus(
  config: WorkbenchConfig,
): Promise<{
  authenticated: boolean;
  profile: { username?: string; displayName?: string; email?: string } | null;
}> {
  if (!config.accessToken) {
    return { authenticated: false, profile: null };
  }
  const baseUrl = await effectiveBaseUrl(config.baseUrl);
  try {
    const response = await fetch(`${baseUrl}/api/workbench/profile`, {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.accessToken}`,
      },
    });
    if (response.status === 401 || response.status === 403) {
      return { authenticated: false, profile: null };
    }
    if (!response.ok) {
      return { authenticated: true, profile: null };
    }
    const payload = await response.json() as {
      profile?: { username?: string; displayName?: string; email?: string } | null;
    };
    return {
      authenticated: true,
      profile: payload.profile ?? null,
    };
  } catch {
    return { authenticated: true, profile: null };
  }
}

function readOptionalSubjectId(parsed: ParsedArgs): string | undefined {
  return asOptionalString(parsed.flags.subject) ?? parsed.positionals[0];
}

function readRequiredSubjectId(parsed: ParsedArgs): string {
  const subjectId = readOptionalSubjectId(parsed);
  if (!subjectId) {
    throw new UsageError("Missing required SUBJECT_ID.");
  }
  return subjectId;
}

function readRequiredRunId(parsed: ParsedArgs): string {
  const runId = parsed.positionals[0];
  if (!runId) {
    throw new UsageError("Missing required RUN_ID.");
  }
  return runId;
}

function requireOutDir(parsed: ParsedArgs): string {
  const output = asOptionalString(parsed.flags.out);
  if (!output) {
    throw new UsageError("Missing required --out.");
  }
  return output;
}

async function apiRequest<T>(
  apiPath: string,
  options: { method?: string; body?: unknown } = {},
  baseUrlOverride?: string,
): Promise<T> {
  const config = await loadConfig();
  const baseUrl = normalizeBaseUrl(
    baseUrlOverride ??
      process.env.WORKBENCH_API_URL ??
      config.baseUrl ??
      DEFAULT_BASE_URL,
  );
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(config.accessToken
        ? { authorization: `Bearer ${config.accessToken}` }
        : {}),
    },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new WorkbenchApiRequestError(
      response.status,
      readResponseError(text) ||
        `Request failed with status ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
      text,
    );
  }
  return (await response.json()) as T;
}

async function uploadAdapterConnection(
  bundle: WorkbenchAdapterAuthBundle,
): Promise<{ status: string; reason?: string }> {
  const config = await loadConfig();
  if (!config.accessToken) {
    return { status: "skipped", reason: "not_authenticated" };
  }
  await apiRequest<{ ok: boolean; status: string }>(
    adapterConnectionApiPath(bundle),
    {
      method: "PUT",
      body: { bundle },
    },
  );
  return { status: "connected" };
}

async function deleteAdapterConnection(
  target: WorkbenchAdapterAuthTarget,
): Promise<{ status: string; reason?: string }> {
  const config = await loadConfig();
  if (!config.accessToken) {
    return { status: "skipped", reason: "not_authenticated" };
  }
  await apiRequest<{ ok: boolean; status: string }>(
    adapterConnectionApiPath(target),
    { method: "DELETE" },
  );
  return { status: "disconnected" };
}

function adapterConnectionApiPath(target: {
  adapterId: string;
  slot?: string;
  profile: string;
}): string {
  const query = new URLSearchParams({
    profile: target.profile,
    ...(target.slot ? { slot: target.slot } : {}),
  });
  return `/api/workbench/auth/adapters/${encodeURIComponent(target.adapterId)}?${query}`;
}

interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface DeviceTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
}

async function requestDeviceAuthorization(
  baseUrl: string,
): Promise<DeviceAuthorizationResponse> {
  const response = await fetch(
    `${normalizeBaseUrl(baseUrl)}/api/oauth/device/code`,
    {
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new Error(
      readResponseError(await response.text()) ||
        "Unable to start Workbench login.",
    );
  }
  return (await response.json()) as DeviceAuthorizationResponse;
}

async function pollDeviceToken(
  baseUrl: string,
  authorization: DeviceAuthorizationResponse,
): Promise<DeviceTokenResponse> {
  const deadline = Date.now() + authorization.expires_in * 1000;
  const intervalMs = Math.max(0, authorization.interval) * 1000;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const response = await fetch(
      `${normalizeBaseUrl(baseUrl)}/api/oauth/token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: authorization.device_code,
        }),
      },
    );
    const body = await response.text();
    if (response.ok) {
      return JSON.parse(body) as DeviceTokenResponse;
    }
    const error = readOAuthError(body);
    if (error === "authorization_pending") {
      continue;
    }
    throw new Error(error || "Workbench login failed.");
  }
  throw new Error("Workbench login expired before approval.");
}

async function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readResponseError(text: string): string {
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown };
    return typeof body.message === "string"
      ? body.message
      : typeof body.error === "string"
        ? body.error
        : "";
  } catch {
    const trimmed = text.trim();
    if (trimmed.startsWith("<")) {
      return "";
    }
    return trimmed;
  }
}

function isTransientApiRequestError(error: unknown): error is WorkbenchApiRequestError {
  return error instanceof WorkbenchApiRequestError
    && (error.status === 408 || error.status === 429 || error.status >= 500);
}

function readOAuthError(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: unknown };
    return typeof body.error === "string" ? body.error : "";
  } catch {
    return "";
  }
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equalsIndex = arg.indexOf("=");
    if (equalsIndex > 0) {
      flags[arg.slice(2, equalsIndex)] = arg.slice(equalsIndex + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positionals, flags };
}

function requireFlag(parsed: ParsedArgs, key: string): string {
  const value = parsed.flags[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new UsageError(`Missing required --${key}.`);
  }
  return value;
}

function rejectUnknownFlags(
  parsed: ParsedArgs,
  allowed: ReadonlySet<string>,
): void {
  const unknown = Object.keys(parsed.flags).filter(
    (flag) => !allowed.has(flag),
  );
  if (unknown.length > 0) {
    throw new UsageError(
      `Unsupported flag${unknown.length === 1 ? "" : "s"}: ${unknown.map((flag) => `--${flag}`).join(", ")}.`,
    );
  }
}

function rejectUnexpectedPositionals(
  parsed: ParsedArgs,
  command: string,
  max: number,
): void {
  if (parsed.positionals.length <= max) {
    return;
  }
  throw new UsageError(
    `Unexpected argument for ${command}: ${parsed.positionals.slice(max).join(" ")}`,
  );
}

function readInitSelection(parsed: ParsedArgs): {
  kind: InitSubjectKind;
  name: string;
} {
  const selections = (["skill", "command"] as const).flatMap(
    (kind) =>
      parsed.flags[kind] === undefined
        ? []
        : [{ kind, value: parsed.flags[kind] }],
  );
  if (selections.length !== 1) {
    throw new UsageError(
      "Specify exactly one of --skill NAME or --command NAME.",
    );
  }
  const { kind, value } = selections[0]!;
  if (typeof value !== "string" || value.trim() === "") {
    throw new UsageError(`Missing NAME for --${kind}.`);
  }
  return { kind, name: value };
}

function readInitAgent(
  parsed: ParsedArgs,
  kind: InitSubjectKind,
): InitAgent | undefined {
  const agent = asOptionalString(parsed.flags.agent);
  if (kind === "command") {
    if (agent) {
      throw new UsageError("--agent applies only to --skill.");
    }
    return undefined;
  }
  if (agent && /^[a-z][a-z0-9-]*$/u.test(agent)) {
    return agent;
  }
  throw new UsageError(`--agent is required for --${kind} and must be a lowercase adapter id.`);
}

function asOptionalString(
  value: string | boolean | undefined,
): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOptionalStringFlag(
  value: string | boolean | undefined,
  name: string,
): string | undefined {
  if (value == null || value === false) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new UsageError(`--${name} requires a value.`);
  }
  return value;
}

function selectLocalTraceAdapters(rawProviders: string | undefined): LocalTraceAdapter[] {
  const available = builtinLocalTraceAdapters();
  if (!rawProviders) {
    return available;
  }
  const requested = rawProviders
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (requested.length === 0) {
    throw new UsageError("--providers must include at least one provider id.");
  }
  return [...new Set(requested)].map((id) => {
    const adapter = builtinLocalTraceAdapter(id);
    if (!adapter) {
      throw new UsageError(
        `Unsupported local trace provider "${id}". Supported providers: ${available.map((entry) => entry.id).join(", ")}.`,
      );
    }
    return adapter;
  });
}

function parseTraceSinceFlag(value: string | boolean | undefined): Date | undefined {
  if (value == null || value === false) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new UsageError("--since requires an ISO timestamp or a relative value like 30d.");
  }
  const raw = value.trim();
  const relative = /^(\d+)([dhm])$/iu.exec(raw);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]?.toLowerCase();
    const multiplier = unit === "d"
      ? 86_400_000
      : unit === "h"
        ? 3_600_000
        : 60_000;
    return new Date(Date.now() - amount * multiplier);
  }
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new UsageError("--since must be an ISO timestamp or a relative value like 30d, 12h, or 90m.");
  }
  return parsed;
}

function formatLocalTraceCollectionSummary(
  summary: LocalTraceCollectionSummary,
): string {
  const providerLines = Object.entries(summary.providers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, count]) => `${provider}: ${count}`)
    .join(", ");
  const lines = [
    `Collected ${summary.traceCount} local trace ${summary.traceCount === 1 ? "digest" : "digests"}.`,
    providerLines ? `Providers: ${providerLines}` : "Providers: none",
  ];
  const limitLine = formatLocalTraceLimitLine(summary);
  if (limitLine) {
    lines.push(limitLine);
  }
  lines.push("Run `workbench traces list` to inspect trace ids, or use --json to print full trace digests.");
  return lines.join("\n");
}

function formatLocalTraceListSummary(
  summary: LocalTraceListSummary,
): string {
  const providerLines = Object.entries(summary.providers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, count]) => `${provider}: ${count}`)
    .join(", ");
  const lines = [
    `Found ${summary.traceCount} local trace ${summary.traceCount === 1 ? "match" : "matches"}.`,
    providerLines ? `Providers: ${providerLines}` : "Providers: none",
  ];
  const limitLine = formatLocalTraceLimitLine(summary);
  if (limitLine) {
    lines.push(limitLine);
  }
  if (summary.traces.length === 0) {
    lines.push("", "No local traces matched the selected filters.");
  } else {
    lines.push("", ...summary.traces.flatMap(formatLocalTraceListItem));
  }
  lines.push("", "Run `workbench traces show TRACE_ID --json` to print one full trace digest.");
  return lines.join("\n");
}

function formatLocalTraceListItem(
  trace: LocalTraceListItem,
  index: number,
): string[] {
  const title = formatOneLine(trace.title ?? trace.goal ?? trace.traceId, 96);
  const lines = [
    `${index + 1}. ${trace.provider}\t${formatLocalTraceTimestamp(trace)}\t${title}`,
    `   id: ${trace.traceId}`,
  ];
  if (trace.workspaceRoot) {
    lines.push(`   workspace: ${trace.workspaceRoot}`);
  }
  if (trace.goal && trace.goal !== trace.title) {
    lines.push(`   goal: ${formatOneLine(trace.goal, 140)}`);
  }
  lines.push(`   counts: ${formatLocalTraceCounts(trace.counts)}`);
  const artifactLine = formatLocalTraceArtifactPreview(trace.artifacts);
  if (artifactLine) {
    lines.push(`   artifacts: ${artifactLine}`);
  }
  return lines;
}

function formatLocalTraceShowSummary(
  summary: LocalTraceShowSummary,
): string {
  const { trace } = summary;
  const lines = [
    `${trace.provider} trace`,
    `id: ${trace.traceId}`,
    `updated: ${formatLocalTraceTimestamp(trace)}`,
  ];
  if (trace.workspaceRoot) {
    lines.push(`workspace: ${trace.workspaceRoot}`);
  }
  if (trace.title) {
    lines.push(`title: ${formatOneLine(trace.title, 180)}`);
  }
  if (trace.goal) {
    lines.push(`goal: ${formatOneLine(trace.goal, 220)}`);
  }
  lines.push(
    `counts: ${formatLocalTraceCounts(trace.counts)}`,
    `source: ${trace.source.path}`,
  );
  const artifactLine = formatLocalTraceArtifactPreview(localTraceArtifactPreview(trace));
  if (artifactLine) {
    lines.push(`artifacts: ${artifactLine}`);
  }
  const preview = formatLocalTraceTimelinePreview(trace);
  if (preview.length > 0) {
    lines.push("", "Timeline preview:", ...preview);
  }
  lines.push("", "Run with --json to print the full trace digest.");
  return lines.join("\n");
}

function formatLocalTraceTimelinePreview(trace: AgentReadableTraceDigest): string[] {
  return trace.timeline.slice(0, 8).flatMap((entry) => {
    if (entry.type === "tool") {
      const name = entry.tool?.name ? ` ${entry.tool.name}` : "";
      const command = entry.tool?.command ? `: ${formatOneLine(entry.tool.command, 140)}` : "";
      return [`  - tool${name}${command}`];
    }
    const text = entry.text ? `: ${formatOneLine(entry.text, 140)}` : "";
    return [`  - ${entry.type}${text}`];
  });
}

function formatLocalTraceArtifactPreview(artifacts: LocalTraceArtifactPreview): string {
  return [
    artifacts.tools.length > 0 ? `tools=${artifacts.tools.join(", ")}` : "",
    artifacts.commands.length > 0 ? `commands=${artifacts.commands.length}` : "",
    artifacts.files.length > 0 ? `files=${artifacts.files.length}` : "",
    artifacts.urls.length > 0 ? `urls=${artifacts.urls.length}` : "",
    artifacts.errors.length > 0 ? `errors=${artifacts.errors.length}` : "",
  ].filter(Boolean).join("; ");
}

function formatLocalTraceCounts(counts: AgentReadableTraceDigest["counts"]): string {
  return `${counts.userMessages} user, ${counts.assistantMessages} assistant, ${counts.toolEvents} tool, ${counts.errors} error`;
}

function formatLocalTraceTimestamp(trace: {
  updatedAt?: string;
  endedAt?: string;
  startedAt?: string;
}): string {
  return trace.updatedAt ?? trace.endedAt ?? trace.startedAt ?? "unknown";
}

function formatLocalTraceLimitLine(summary: {
  limitPerProvider: number;
  limitedProviders: string[];
}): string | null {
  if (summary.limitedProviders.length === 0) {
    return null;
  }
  const unit = summary.limitPerProvider === 1 ? "trace" : "traces";
  return `Limited to latest ${summary.limitPerProvider} ${unit} per provider; more matching traces exist for ${formatInlineList(summary.limitedProviders)}. Rerun with --limit N to include more.`;
}

function formatLocalTraceNotFound(
  traceId: string,
): string {
  return `Local trace not found: ${traceId}. Check the trace id and any selected --providers, --workspace, or --since filters.`;
}

function formatOneLine(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`;
}

function formatInlineList(values: readonly string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function parsePositiveInt(
  value: string | boolean | undefined,
  fallback: number,
  name: string,
): number {
  if (value == null || value === false) {
    return fallback;
  }
  const raw = String(value);
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new UsageError(`--${name} must be a positive integer.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new UsageError(`--${name} must be a positive integer.`);
  }
  return parsed;
}

function parseOptionalPositiveInt(
  value: string | boolean | undefined,
  name: string,
): number | undefined {
  if (value == null || value === false) {
    return undefined;
  }
  return parsePositiveInt(value, 1, name);
}

function parsePortFlag(value: string | boolean | undefined): number {
  if (value == null || value === false) {
    return 0;
  }
  const raw = String(value);
  if (!/^\d+$/u.test(raw)) {
    throw new UsageError("--port must be an integer from 0 to 65535.");
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new UsageError("--port must be an integer from 0 to 65535.");
  }
  return port;
}

function formatMetricSummary(
  metrics: Record<string, number> | undefined,
  options: { limit?: number } = {},
): string {
  const entries = Object.entries(metrics ?? {}).filter(
    (entry): entry is [string, number] => Number.isFinite(entry[1]),
  );
  if (entries.length === 0) {
    return "n/a";
  }
  const limit = options.limit ?? 2;
  const shown = Number.isFinite(limit)
    ? entries.slice(0, Math.max(0, limit))
    : entries;
  const suffix =
    shown.length < entries.length ? ` (+${entries.length - shown.length})` : "";
  return `${shown.map(([key, value]) => `${key}: ${formatMetricValue(value)}`).join(", ")}${suffix}`;
}

function formatMetricValue(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2);
}

function resolveDir(parsed: ParsedArgs, positionalDir?: string): string {
  const resolved = path.resolve(
    asOptionalString(parsed.flags.dir) ?? positionalDir ?? process.cwd(),
  );
  return isWorkbenchSourceYamlPath(resolved) ? path.dirname(resolved) : resolved;
}

function resolveSourceDir(parsed: ParsedArgs): string {
  if (parsed.positionals.length > 1) {
    throw new UsageError("Expected at most one source file or directory argument.");
  }
  if (parsed.positionals.length > 0 && parsed.flags.dir !== undefined) {
    throw new UsageError("Use either --dir or SOURCE, not both.");
  }
  return path.resolve(
    asOptionalString(parsed.flags.dir) ?? parsed.positionals[0] ?? process.cwd(),
  );
}

function isWorkbenchSourceYamlPath(filePath: string): boolean {
  return path.basename(filePath) === WORKBENCH_BENCHMARK_FILE;
}

function readSubjectIdFlag(
  parsed: ParsedArgs,
  snapshot: { activeId: string | null },
): string {
  const explicit = asOptionalString(parsed.flags.subject) ?? asOptionalString(parsed.flags.subject);
  if (explicit) {
    return explicit;
  }
  if (snapshot.activeId) {
    return snapshot.activeId;
  }
  throw new UsageError(
    "Missing required --subject; no active subject exists.",
  );
}

function readPreviewMode(parsed: ParsedArgs): "diff" | "raw" | "rendered" {
  const view = asOptionalString(parsed.flags.view) ?? "rendered";
  if (view !== "diff" && view !== "raw" && view !== "rendered") {
    throw new UsageError("--view must be diff, raw, or rendered.");
  }
  return view;
}

async function readLocalSpecIfValid(
  workspace: string,
): Promise<ReturnType<typeof resolveWorkbenchResolvedSourceYaml> | null> {
  try {
    return (await readLocalProjectSource(workspace)).spec;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      error instanceof WorkspaceSnapshotError
    ) {
      return null;
    }
    throw error;
  }
}

async function resolveLocalProjectForExecution(
  workspace: string,
  source: string,
): Promise<{
  spec: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>;
  adapterManifests: ResolvedWorkbenchAdapter["manifest"][];
}> {
  const spec = resolveWorkbenchResolvedSourceYaml(source);
  const adapters = await resolveWorkbenchAdaptersForProject(workspace, spec);
  const adapterManifests = adapters.map((adapter) => adapter.manifest);
	  return {
	    spec: applyDefaultWorkbenchAdapterAuthProfiles(
	      spec as unknown as Record<string, unknown>,
	      adapterManifests,
	    ) as unknown as ReturnType<typeof resolveWorkbenchResolvedSourceYaml>,
	    adapterManifests,
	  };
}

function completedJobOutputFiles(
  job: HostedWorkbenchJob,
): SurfaceSnapshotFile[] {
  const output = asJsonRecord(job.output);
  const files = Array.isArray(output.files)
    ? output.files.filter(isSurfaceSnapshotFile)
    : [];
  return normalizeSurfaceFiles(files);
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isSurfaceSnapshotFile(value: unknown): value is SurfaceSnapshotFile {
  const record = asJsonRecord(value);
  return (
    typeof record.path === "string" &&
    typeof record.content === "string" &&
    (record.kind === undefined ||
      record.kind === "text" ||
      record.kind === "binary") &&
    (record.encoding === undefined ||
      record.encoding === "utf8" ||
      record.encoding === "base64")
  );
}

function createLocalEvent(
  type: RuntimeEvent["type"],
  at: string,
  event: Omit<RuntimeEvent, "id" | "at" | "type">,
): RuntimeEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`,
    at,
    type,
    ...event,
  };
}

async function writeFileIfMissing(
  filePath: string,
  content: string,
): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

async function copyInitSeedIfProvided(
  parsed: ParsedArgs,
  workspace: string,
  seed: { fileTarget: string; directoryTarget: string },
): Promise<void> {
  const from = asOptionalString(parsed.flags.from);
  if (!from) {
    return;
  }
  const source = path.resolve(from);
  const stats = await fs.stat(source).catch((error) => {
    throw new UsageError(
      `--from path does not exist: ${(error as NodeJS.ErrnoException).path ?? source}`,
    );
  });
  if (stats.isDirectory()) {
    const target = path.join(workspace, seed.directoryTarget);
    await fs.mkdir(target, { recursive: true });
    await fs.cp(source, target, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
    return;
  }
  if (!stats.isFile()) {
    throw new UsageError("--from must point to a file or directory.");
  }
  const target = path.join(workspace, seed.fileTarget);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs
    .copyFile(source, target, fs.constants.COPYFILE_EXCL)
    .catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    });
}

function formatSpecOptimizer(
  spec: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>,
): string {
  return spec.improve ? `adapter:${spec.improve.use}` : "optimizer not configured";
}

async function writeFiles(
  outputDir: string,
  files: HostedFile[],
): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  for (const file of files) {
    const targetPath = safeOutputPath(outputDir, file.path);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(
      targetPath,
      file.encoding === "base64"
        ? Buffer.from(file.content, "base64")
        : file.content,
    );
    await fs.chmod(targetPath, file.executable === true ? 0o755 : 0o644);
  }
}

async function syncSourceFiles(
  outputDir: string,
  files: HostedFile[],
): Promise<void> {
  const previousPaths = await readManagedSourceFilePaths(outputDir);
  const nextPaths = new Set(files.map((file) => file.path));
  for (const previousPath of previousPaths) {
    if (nextPaths.has(previousPath)) {
      continue;
    }
    await fs.rm(safeOutputPath(outputDir, previousPath), { force: true });
    await removeEmptyParents(outputDir, path.dirname(previousPath));
  }
  await writeFiles(outputDir, files);
}

async function readManagedSourceFilePaths(outputDir: string): Promise<Set<string>> {
  try {
    const source = await readLocalProjectSource(outputDir);
    return new Set(source.sourceFiles.map((file) => file.path));
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      error instanceof WorkspaceSnapshotError
    ) {
      return new Set();
    }
    throw error;
  }
}

async function removeEmptyParents(outputDir: string, relativeDir: string): Promise<void> {
  let current = path.normalize(relativeDir);
  while (current && current !== "." && current !== path.sep) {
    const absolute = safeOutputPath(outputDir, current);
    try {
      await fs.rmdir(absolute);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function safeOutputPath(outputDir: string, relativePath: string): string {
  const targetPath = path.resolve(outputDir, relativePath);
  const root = path.resolve(outputDir);
  if (targetPath !== root && !targetPath.startsWith(`${root}${path.sep}`)) {
    throw new UsageError(`Unsafe export path: ${relativePath}`);
  }
  return targetPath;
}

function writeOutput<T>(
  value: T,
  parsed: ParsedArgs,
  io: CliIo,
  formatText: (value: T) => string,
): void {
  if (parsed.flags.json === true) {
    writeJson(value, io);
  } else {
    io.stdout.write(`${formatText(value)}\n`);
  }
}

function writeJson(value: unknown, io: CliIo): void {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function loadConfig(): Promise<WorkbenchConfig> {
  try {
    return JSON.parse(
      await fs.readFile(configPath(), "utf8"),
    ) as WorkbenchConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeConfig(config: WorkbenchConfig): Promise<void> {
  const filePath = configPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`);
}

function configPath(): string {
  return path.join(os.homedir(), ".workbench", "workbench.json");
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/u, "");
}

class UsageError extends Error {}
