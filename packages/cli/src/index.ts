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
  createSyntheticProposalJob as createRuntimeSyntheticProposalJob,
  executeWorkbenchExecutionJob,
  filterSubjectSourceFiles,
  workbenchExecutionPurpose,
  createWorkbenchAdapterAuthBundle,
  createProposalTraceInputFiles,
  DOCKER_SANDBOX_BACKEND,
  localWorkbenchAdapterAuthStore,
  materializeWorkbenchRunResult,
  normalizeSurfaceFiles,
  planWorkbenchExecutionJobsForPurpose,
  runWorkbenchExecutionDag,
  resolveWorkbenchResolvedSourceYaml,
  summarizeSubjectFiles,
  validateWorkbenchRunEnvelope,
  validateWorkbenchResolvedSourceYaml,
  parseWorkbenchAdapterAuthTarget,
  readWorkbenchSpecDockerfilePath,
  type SubjectRecord,
  type WorkbenchExecutionRuntimeInput,
  type HostedWorkbenchJob,
  type Json,
  type RunSummary,
  type RuntimeEvent,
  type SurfaceSnapshotFile,
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
  builtinAdapterManifests,
  composeRuntimeDockerfileWithAdapters,
  resolveBuiltinWorkbenchAdapter,
  resolveProjectAdapterSource,
  resolveWorkbenchAdaptersForProject,
  WORKBENCH_ADAPTER_MANIFEST_FILE,
  type ResolvedWorkbenchAdapter,
} from "./adapter-project.js";
import {
  appendLocalRun,
  loadLocalArchive,
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

interface HostedForkRef {
  projectId?: string;
  ownerUsername?: string;
  benchmarkName?: string;
  sourceRevisionId?: string;
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

interface HostedProjectSummary {
  id?: string;
  ownerUsername?: string;
  name?: string;
  visibility?: "private" | "public";
  currentSpecVersionId?: string;
  sourceFingerprint?: string;
  starCount?: number;
  runs?: unknown[];
  subjects?: unknown[];
}

interface WorkbenchResourceUrls {
  benchmark: string;
  run?: string;
  subjectEvaluation?: string;
  traces?: string;
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
  tasks: {
    source: WorkbenchAdapterSummary;
    path: string;
    cases: number;
    files: number;
  };
  environment: {
    dockerfile: string;
    network: {
      egress: "none" | "allowlist" | "open";
      allow?: string[];
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
    score: WorkbenchAdapterSummary;
    sources: WorkbenchAdapterSourceSummary[];
  };
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
  stability: "builtin" | "local" | "pinned" | "floating";
  overridesBuiltin?: boolean;
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
  jobCount?: number;
  trialsRequested?: number;
  trialsExecuted?: number;
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
    if (argv[0] === "checkpoint") {
      return await localCheckpoint(argv.slice(1), io);
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
      io.stderr.write(`${message}\n\n${rootUsage}\n`);
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
  if (positionals[0] === "adapters" && positionals[1] === "test") {
    return "adapters test";
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
    case "fork":
      return await forkProject(rest, io);
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
  rejectUnknownFlags(parsed, new Set(["dir", "host", "port", "no-open", "json"]));
  if (parsed.positionals.length > 1) {
    throw new UsageError("workbench open accepts at most one source file or directory argument.");
  }
  const workspace = resolveSourceDir(parsed);
  const host = readOptionalStringFlag(parsed.flags.host, "host") ?? "127.0.0.1";
  const port = parsePortFlag(parsed.flags.port);
  const server = await startLocalWorkbenchDevServer({
    workspace,
    host,
    port,
  });
  const result = {
    ok: true,
    url: server.url,
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
    await openBrowser(server.url).catch(() => undefined);
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
      "pipeline",
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
    tasks: {
      source: adapterSummary(source.taskSource),
      path: source.taskFingerprintPath,
      cases: source.taskIds.length,
      files: source.taskSourceFiles.length,
    },
    environment: {
      dockerfile: source.dockerfilePath,
      network: runtimeNetworkSummary(source.spec.environment.network),
      resources: runtimeResourceSummary(source.spec.environment.resources),
    },
    adapters: {
      improve: source.spec.improve ? adapterSummary(source.spec.improve) : null,
      run: adapterSummary(source.spec.run),
      score: adapterSummary(source.spec.score),
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
  const network = plan.environment.network.egress === "allowlist"
    ? `allowlist (${plan.environment.network.allow?.join(", ") ?? ""})`
    : plan.environment.network.egress;
  const resources = plan.environment.resources;
  return [
    `Spec is valid${warningSuffix}.`,
    `Benchmark: ${plan.benchmarkName}`,
    `Description: ${plan.benchmarkDescription}`,
    `Source: ${plan.source.files} file(s) (${plan.source.yaml.join(", ")}, ${plan.source.dockerfile})`,
    `Subject files: ${plan.subject.filesPath} (${plan.subject.files} file(s))`,
    `Optimizer edits: ${edits}`,
    `Tasks: ${plan.tasks.cases} case(s) from ${formatAdapterSummary(plan.tasks.source)} at ${plan.tasks.path} (${plan.tasks.files} file(s))`,
    `Environment: ${plan.environment.dockerfile}, network ${network}, ${resources.cpu} CPU, ${resources.memoryGb}GB RAM, ${resources.timeoutMinutes}m timeout`,
    `Execution: improve ${plan.adapters.improve ? formatAdapterSummary(plan.adapters.improve) : "not configured"}, run ${formatAdapterSummary(plan.adapters.run)}, score ${formatAdapterSummary(plan.adapters.score)}`,
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
    ...(adapter.overridesBuiltin ? { overridesBuiltin: true } : {}),
  };
}

function adapterSourceLines(sources: readonly WorkbenchAdapterSourceSummary[]): string[] {
  const external = sources.filter((source) => source.kind !== "builtin");
  if (external.length === 0) {
    return [];
  }
  return [
    `Adapter sources: ${external.map(formatAdapterSourceSummary).join("; ")}`,
  ];
}

function formatAdapterSourceSummary(source: WorkbenchAdapterSourceSummary): string {
  const override = source.overridesBuiltin ? " overrides built-in" : "";
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
  const egress = network.egress === "none" || network.egress === "allowlist"
    ? network.egress
    : "open";
  if (egress !== "allowlist") {
    return { egress };
  }
  const allow = Array.isArray(network.allow)
    ? network.allow.flatMap((entry) => typeof entry === "string" ? [entry] : [])
    : [];
  return {
    egress,
    allow,
  };
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
  const budget = parsePositiveInt(parsed.flags.budget, 1, "budget");
  const samples = parsePositiveInt(parsed.flags.samples, 1, "samples");
  const taskSourceFiles = normalizeSurfaceFiles(projectSource.taskSourceFiles);
  const taskBundles = projectSource.taskBundles;
  const caseIds = taskBundles.map((bundle) => bundle.id);
  if (caseIds.length === 0) {
    throw new UsageError("Task source must emit at least one task bundle.");
  }
  requireValidRunEnvelope({
    workflow: "improve",
    budget,
    samples,
    caseCount: caseIds.length,
  });
  const environmentRef = await ensureLocalDockerfileEnvironment(
    workspace,
    spec,
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
  const trials = budget;
  for (let trialIndex = 0; trialIndex < trials; trialIndex += 1) {
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
    const proposalTraceFiles = createProposalTraceInputFiles({
      runId,
      jobs: runTraceJobs,
      events,
    });
    const subjectId = `subject_${runId.replace(/^run_/u, "")}_${String(trialIndex + 1).padStart(3, "0")}`;
    const plannedProposal = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "local",
      projectId: "local",
      runId,
      subjectId,
      trialIndex,
      samples,
      caseIds,
      taskBundles,
      spec,
      workflow: "improve",
      purpose: "improve",
      now: new Date().toISOString(),
      baseFiles,
      traceFiles: proposalTraceFiles,
      environmentRef,
      baseId: activeSubject.id,
    })[0]!;
    const proposalJobs = await executeLocalDevelopmentDag({
      jobs: [plannedProposal],
      spec,
      adapterManifests,
      baseFiles,
      taskSourceFiles,
      taskBundles,
      traceFiles: proposalTraceFiles,
      capacity: devCapacity,
    });
    const proposed = proposalJobs[0]!;
    const completedJobs: HostedWorkbenchJob[] = [proposed];
    if (proposed.status === "succeeded") {
      const proposedFiles =
        completedJobOutputFiles(proposed).length > 0
          ? normalizeSurfaceFiles(
              completedJobOutputFiles(proposed).filter(
                (file) => !file.path.startsWith(".workbench/"),
              ),
            )
          : baseFiles;
      const trialJobs = planWorkbenchExecutionJobsForPurpose({
        ownerUserId: "local",
        projectId: "local",
        runId,
        subjectId,
        trialIndex,
        samples,
        now: new Date().toISOString(),
        caseIds,
        taskBundles,
        spec,
        environmentRef,
        workflow: "improve",
        purpose: "trial",
      });
      const dagJobs = await executeLocalDevelopmentDag({
        jobs: [proposed, ...trialJobs],
        spec,
        adapterManifests,
        baseFiles: proposedFiles,
        taskSourceFiles,
        taskBundles,
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
	    score: spec.score.use,
    strategy: "greedy",
    budget,
    repairBudget: 0,
    trialsRequested: budget,
    trialsExecuted: budget,
    samples,
    sampleConcurrency: 1,
    stoppedReason: "budget_exhausted",
    outcome: failedJobCount > 0 ? "error" : "ok",
  };
  events.push(
    createLocalEvent("run_finished", finishedAt, {
      runId,
      detail: {
        outcome: run.outcome ?? null,
        trialsExecuted: run.trialsExecuted,
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
    localView: localDevViewHint(workspace),
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
  const sourceArg = resolveSourceDir(parsed);
  const projectSource = await readLocalProjectSource(sourceArg);
  const workspace = projectSource.dir;
  const executionProject = await resolveLocalProjectForExecution(workspace, projectSource.specSource);
  const { spec, adapterManifests } = executionProject;
  const samples = parsePositiveInt(parsed.flags.samples, 1, "samples");
  const taskSourceFiles = normalizeSurfaceFiles(projectSource.taskSourceFiles);
  const taskBundles = projectSource.taskBundles;
  const caseIds = taskBundles.map((bundle) => bundle.id);
  if (caseIds.length === 0) {
    throw new UsageError("Task source must emit at least one task bundle.");
  }
  requireValidRunEnvelope({
    workflow: "eval",
    budget: 1,
    samples,
    caseCount: caseIds.length,
  });
  const environmentRef = await ensureLocalDockerfileEnvironment(
    workspace,
    spec,
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
  const proposal = createRuntimeSyntheticProposalJob({
    ownerUserId: "local",
    projectId: "local",
    runId,
    subjectId: evaluatedSubjectId,
    trialIndex: 0,
    files,
    now: startedAt,
    baseId: null,
  });
  const completedJobs: HostedWorkbenchJob[] = [proposal];
  const trialJobs = planWorkbenchExecutionJobsForPurpose({
    ownerUserId: "local",
    projectId: "local",
    runId,
    subjectId: evaluatedSubjectId,
    trialIndex: 0,
    samples,
    now: startedAt,
    caseIds,
    taskBundles,
    spec,
    environmentRef,
    workflow: "eval",
    purpose: "trial",
  });
  const dagJobs = await executeLocalDevelopmentDag({
    jobs: [proposal, ...trialJobs],
    spec,
    adapterManifests,
    baseFiles: files,
    taskSourceFiles,
    taskBundles,
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
	    score: spec.score.use,
    strategy: "direct",
    budget: 1,
    repairBudget: 0,
    trialsRequested: 1,
    trialsExecuted: 1,
    samples,
    sampleConcurrency: 1,
    stoppedReason: "completed",
    outcome: materialized.failedJobCount > 0 ? "error" : "ok",
  }, []);
  await saveLocalJobs(workspace, completedJobs);
  await saveLocalArchive(workspace, snapshot);
  const evaluation = materialized.evaluations[0] ?? null;
  const result = {
    ok: materialized.failedJobCount === 0,
    evaluation,
    resultId: evaluation?.id ?? null,
    subjectId: evaluatedSubjectId,
    completedJobCount: materialized.completedJobCount,
    failedJobCount: materialized.failedJobCount,
    localView: localDevViewHint(workspace),
  };
  writeOutput(
    result,
    parsed,
    io,
    ({ resultId, subjectId: evaluatedSubjectId }) =>
      `Evaluation ${resultId ?? runId} finished for ${evaluatedSubjectId}.\nOpen local view: ${result.localView.command}\n${result.localView.note}`,
  );
  return materialized.failedJobCount === 0 ? 0 : 1;
}

function localDevViewHint(workspace: string): LocalDevViewHint {
  return {
    command: `workbench open --dir ${shellQuote(path.resolve(workspace))}`,
    note: LOCAL_DEV_OPEN_LIFECYCLE_NOTE,
  };
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

function checkpointSubjectFingerprint(files: readonly SurfaceSnapshotFile[]): string {
  const hash = createHash("sha256");
  hash.update("workbench-checkpoint-subject-v1\0");
  hashSurfaceFiles(hash, files);
  return hash.digest("hex");
}

function hashSurfaceFiles(
  hash: ReturnType<typeof createHash>,
  files: readonly {
    path: string;
    content: string;
    encoding?: "utf8" | "base64";
    executable?: boolean;
  }[],
): void {
  for (const file of files.slice().sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update("\0file\0");
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.encoding ?? "utf8");
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
    hash.update(file.executable ? "1" : "0");
  }
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
  baseFiles: readonly SurfaceSnapshotFile[];
  taskSourceFiles: readonly SurfaceSnapshotFile[];
  taskBundles: WorkbenchExecutionRuntimeInput["taskBundles"];
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
	        baseFiles: args.baseFiles,
	        taskSourceFiles: args.taskSourceFiles,
        taskBundles: args.taskBundles,
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

async function ensureLocalDockerfileEnvironment(
  workspace: string,
  spec: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>,
): Promise<string | undefined> {
  const dockerfilePath = readWorkbenchSpecDockerfilePath(spec);
  const absoluteDockerfile = resolveProjectPath(workspace, dockerfilePath);
  const rawDockerfile = await fs.readFile(absoluteDockerfile, "utf8");
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
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} ${args.join(" ")} exited with status ${code ?? "unknown"}.`,
          ),
        );
      }
    });
  });
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

async function localCheckpoint(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  const workspace = resolveDir(parsed);
  const projectSource = await readLocalProjectSource(workspace);
  const spec = projectSource.spec;
  const subjectRoot = spec.subject.files.path;
  let snapshot = await loadLocalArchive(workspace);
  const previous = snapshot.activeId
    ? readLocalSubject(snapshot, snapshot.activeId)
    : null;
  const files = normalizeSurfaceFiles(
    await readSnapshotFiles(resolveProjectPath(workspace, subjectRoot)),
  );
  const now = new Date().toISOString();
  const subject: SubjectRecord = {
    id: `chk_${Date.now().toString(36)}`,
    ordinal: snapshot.subjects.length,
    benchmarkFingerprint: await readLocalBenchmarkFingerprint(workspace),
    subjectFingerprint: checkpointSubjectFingerprint(files),
    createdAt: now,
    ...(previous ? { baseId: previous.id } : {}),
    referenceIds: [],
    status: "checkpointed",
    fileChanges: files.map((file) => file.path),
  };
  snapshot = upsertLocalSubject(snapshot, subject, files);
  snapshot = setLocalActive(snapshot, subject.id);
  await saveLocalArchive(workspace, snapshot);
  writeOutput(
    {
      ok: true,
      activeBefore: previous?.id ?? null,
      activeAfter: subject.id,
      changedPaths: subject.fileChanges,
    },
    parsed,
    io,
    () =>
      `Checkpointed ${subject.id} with ${subject.fileChanges.length} file(s).`,
  );
  return 0;
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
          `${run.id}\t${run.workflow}\t${run.status}\t${run.outcome ?? "pending"}\t${run.trialsExecuted ?? 0}/${run.trialsRequested ?? 0}`
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
        `trials\t${record.trialsExecuted ?? 0}/${record.trialsRequested ?? 0}`,
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
  const builtins = builtinAdapterManifests()
    .filter((manifest) => !projectAdaptersById.has(manifest.id))
    .map((manifest) => ({
      id: manifest.id,
      declaredSource: `builtin:${manifest.id}`,
      resolvedSource: `builtin:${manifest.id}`,
      kind: "builtin",
      stability: "builtin",
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
      ...(adapter.overridesBuiltin ? { overridesBuiltin: true } : {}),
    }));
  const adapters = [...builtins, ...project].sort((left, right) => left.id.localeCompare(right.id));
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
          overridesBuiltin?: boolean;
        }>;
      };
      return value.adapters.map((adapter) =>
        `${adapter.id}\t${adapter.installed ? "installed" : "available"}\t${adapter.stability}${adapter.overridesBuiltin ? " override" : ""}\t${formatAdapterResolution(adapter)}`
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
    resolveBuiltinWorkbenchAdapter(id);
  if (!adapter) {
    throw new UsageError(`Adapter ${id} is not installed or built in.`);
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
      const override = value.adapter.overridesBuiltin ? "overrides built-in" : value.adapter.kind;
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
  const builtin = resolveBuiltinWorkbenchAdapter(target);
  if (builtin) {
    return builtin;
  }
  throw new UsageError(`Adapter ${target} is not installed, built in, or resolvable as a source.`);
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
  requestPath: string;
  outputRoot: string;
}): Promise<{ stdout: string; stderr: string }> {
  const env = adapterTestEnv(args.requestPath, args.outputRoot);
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

function adapterTestEnv(
  requestPath: string,
  outputRoot: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && !key.startsWith("WORKBENCH_")) {
      env[key] = value;
    }
  }
  env.PATH = process.env.PATH
    ? `${process.env.PATH}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`
    : "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  env.WORKBENCH_ADAPTER_REQUEST = requestPath;
  env.WORKBENCH_OUTPUT = outputRoot;
  env.WORKBENCH_RESULT = workbenchAdapterOperationResultPath(outputRoot);
  return env;
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
  overridesBuiltin?: boolean;
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
    ...(adapter.overridesBuiltin ? { overridesBuiltin: true } : {}),
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
    "protocol: workbench.adapter.v2",
    "setup:",
    "  - npm install --global .",
    "operations:",
    "  subject.run: {}",
    "  trial.score: {}",
    "  subject.improve: {}",
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
const operation = request.operation || "trial.score";
const resultPath = process.env.WORKBENCH_RESULT || request.paths?.result || path.join(outputRoot, "workbench-result.json");

let value;
if (operation === "trial.score") {
  value = {
    score: 1,
    summary: "${id} accepted the trial output.",
  };
} else if (operation === "subject.improve") {
  value = {
    files: [],
    fileChanges: [],
    summary: "${id} did not propose changes.",
  };
} else if (operation === "subject.run") {
  const task = request.context?.task?.text || "No task text was provided.";
  fs.writeFileSync(path.join(outputRoot, "adapter-output.txt"), [
    "adapter: ${id}",
    "task:",
    task,
    "",
  ].join("\\n"));
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
    "This is a Workbench adapter. It receives a JSON request at `WORKBENCH_ADAPTER_REQUEST` and writes phase outputs under `WORKBENCH_OUTPUT`.",
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
  const profile = config.accessToken
    ? await apiRequest<{ profile?: { username?: string; displayName?: string; email?: string } | null }>(
        "/api/workbench/profile",
      ).catch(() => ({ profile: null }))
    : { profile: null };
  const adapterStatuses = await localWorkbenchAdapterAuthStore().listStatus();
  const hostedAuth = config.accessToken
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
      authenticated: Boolean(config.accessToken),
      username: profile.profile?.username ?? null,
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
      spec.score,
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
    const child = spawn("sh", ["-lc", args.command], {
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
    const response = await apiRequest<{ benchmark: HostedProjectSummary & {
      ownerUsername?: string;
      sourceFingerprint?: string;
      currentSpecVersionId?: string;
    } }>(
      "/api/workbench/benchmarks",
      {
        method: "POST",
        body: hostedProjectSourceRequest(source),
      },
      baseUrl,
    );
    const project = response.benchmark;
    const publishedProject =
      visibility === "public"
        ? (await apiRequest<{ benchmark: HostedProjectSummary & { ownerUsername?: string } }>(
            projectApiPath(project.id!, "/publish"),
            { method: "PUT" },
            baseUrl,
          )).benchmark
        : project;
    const nextOrigin = await writeWorkbenchOrigin(dir, {
      baseUrl,
      owner: publishedProject.ownerUsername ?? project.ownerUsername ?? "",
      project: publishedProject.name ?? project.name ?? source.spec.name,
      projectId: publishedProject.id ?? project.id!,
      writable: true,
      sourceRevisionId: publishedProject.currentSpecVersionId ?? project.currentSpecVersionId,
      sourceFingerprint: publishedProject.sourceFingerprint ?? project.sourceFingerprint,
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
    throw new UsageError(
      "Cannot push to a read-only benchmark clone. Run workbench cloud fork to create a writable benchmark fork.",
    );
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
  await fs.rm(originPath, { force: true });
  writeOutput(
    { ok: true, remote: "origin", removed: originPath },
    parsed,
    io,
    () => `Removed origin (${originPath}).`,
  );
  return 0;
}

async function forkProject(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["json"]));
  const ref = readRequiredBenchmarkRef(parsed);
  if (parsed.positionals.length > 2) {
    throw new UsageError("workbench cloud fork accepts OWNER/BENCHMARK[@REF] and an optional fork name.");
  }
  const baseUrl = await effectiveBaseUrl();
  const response = await apiRequest<{ benchmark: HostedProjectSummary & {
    id: string;
    name: string;
    ownerUsername: string;
    currentSpecVersionId?: string;
    sourceFingerprint?: string;
    forkedFrom?: HostedForkRef;
  } }>(
    `${publicProjectApiPath(ref)}/fork`,
    {
      method: "POST",
      body: { name: parsed.positionals[1] },
    },
    baseUrl,
  );
  const benchmark = response.benchmark;
  const currentDir = resolveDir(parsed);
  const currentOrigin = await readWorkbenchOrigin(currentDir);
  const outputDir = parsed.positionals[1] ?? (
    currentOrigin &&
      !currentOrigin.writable &&
      currentOrigin.owner === ref.owner &&
      currentOrigin.project === ref.project
      ? currentDir
      : benchmark.name
  );
  const filesResponse = await apiRequest<HostedSourceResponse>(
    projectApiPath(benchmark.id, "/source"),
    {},
    baseUrl,
  );
  await syncSourceFiles(outputDir, filesResponse.files);
  const origin = await writeWorkbenchOrigin(outputDir, {
    baseUrl,
    owner: benchmark.ownerUsername,
    project: benchmark.name,
    projectId: benchmark.id,
    writable: true,
    sourceRevisionId: filesResponse.benchmark?.currentSpecVersionId ?? benchmark.currentSpecVersionId,
    sourceFingerprint: filesResponse.benchmark?.sourceFingerprint ?? benchmark.sourceFingerprint,
    upstream: originUpstreamFromForkedFrom(benchmark.forkedFrom),
  });
  const urls = buildWorkbenchResourceUrls({
    baseUrl,
    projectId: benchmark.id,
    owner: benchmark.ownerUsername,
    projectName: benchmark.name,
  });
  writeOutput(
    {
      ok: true,
      benchmark,
      origin,
      outputDir,
      files: filesResponse.files.length,
      urls,
    },
    parsed,
    io,
    (record) => {
      const value = record as {
        benchmark: { ownerUsername: string; name: string; id: string };
        outputDir: string;
        files: number;
        urls: WorkbenchResourceUrls;
      };
      return [
        `Forked ${formatBenchmarkRef(ref)} to ${value.benchmark.ownerUsername}/${value.benchmark.name} (${value.benchmark.id}).`,
        `Local checkout: ${value.outputDir} (${value.files} file(s)).`,
        `Open benchmark: ${value.urls.benchmark}`,
      ].join("\n");
    },
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

function originUpstreamFromForkedFrom(
  forkedFrom: HostedForkRef | undefined,
): WorkbenchOrigin["upstream"] | undefined {
  if (
    !forkedFrom?.projectId ||
    !forkedFrom.ownerUsername ||
    !forkedFrom.benchmarkName ||
    !forkedFrom.sourceRevisionId
  ) {
    return undefined;
  }
  return {
    owner: forkedFrom.ownerUsername,
    project: forkedFrom.benchmarkName,
    projectId: forkedFrom.projectId,
    sourceRevisionId: forkedFrom.sourceRevisionId,
  };
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
  const target = await resolveHostedTarget(parsed, {
    requireProjectIdentity: true,
    sourceDir: projectSource.dir,
  });
  const dryRun = parsed.flags["dry-run"] === true;
  if (workflow === "improve" && !dryRun) {
    request.subjectId = await ensureHostedImproveBaseSubject({
      parsed,
      target,
      samples: request.samples,
      subjectId: baseSubjectId,
      intervalMs: watchIntervalMs ?? 1000,
      timeoutMs: watchTimeoutMs,
    });
  }
  if (dryRun) {
    writeOutput(
      {
        ok: true,
        dryRun: true,
        projectId: target.projectId,
        dir: target.dir,
        baseUrl: target.baseUrl,
        request,
      },
      parsed,
      io,
      () => `Would start hosted ${workflow} for ${target.projectId}.`,
    );
    return 0;
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
    const response = await apiRequest<{
      subjects: Array<{ id: string; status?: string; eval?: unknown }>;
    }>(
      projectApiPath(args.target.projectId, "/subjects"),
      {},
      args.target.baseUrl,
    );
    const subject = response.subjects.find((entry) => entry.id === args.subjectId);
    if (!subject) {
      throw new UsageError(
        `Base subject ${args.subjectId} was not found for the current benchmark.`,
      );
    }
    if (subject && (subject.status === "evaluated" || subject.eval != null)) {
      return args.subjectId;
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
  const project = await resolveRemoteProject(projectRef, baseUrl);
  const projectId = project.id;
  const projectName = project.name;
  const originProjectDeleted = origin ? origin.projectId === projectId : false;
  if (parsed.flags["dry-run"] === true) {
    writeOutput(
      {
        ok: true,
        dryRun: true,
        projectId,
        ...(projectName ? { projectName } : {}),
        baseUrl,
        ...(originProjectDeleted ? { originPath } : {}),
      },
      parsed,
      io,
      () =>
        originProjectDeleted
          ? `Would delete hosted benchmark ${formatProjectRef(project)} and remove local origin ${originPath}.`
          : `Would delete hosted benchmark ${formatProjectRef(project)}.`,
    );
    return 0;
  }
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
      `Open run: ${value.urls?.run ?? buildWorkbenchResourceUrls(target, { runId: value.id }).run}`,
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
    return buildWorkbenchResourceUrls(target, { runId: ref }).run!;
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
  if (refs.runId) {
    urls.run = `${benchmark}/runs/${encodeURIComponent(refs.runId)}`;
    urls.traces = urls.run;
  }
  if (refs.subjectId) {
    urls.subjectEvaluation = `${benchmark}/subject/${encodeURIComponent(refs.subjectId)}/evaluation`;
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

function withRunUrls(
  target: HostedTarget,
  run: HostedRunRecord,
): HostedRunRecord {
  return {
    ...run,
    urls: buildWorkbenchResourceUrls(target, {
      runId: run.id,
      subjectId: run.subjectId,
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
  const subjectId = detail.run.subjectId ?? detail.jobs.find((job) => job.subjectId)?.subjectId ?? null;
  const run = withRunUrls(target, { ...detail.run, subjectId });
  return {
    run,
    jobs: detail.jobs,
    urls: run.urls ?? buildWorkbenchResourceUrls(target, { runId: run.id }),
  };
}

function sourceFileCount(source: LocalProjectSource): number {
  return source.sourceFiles.length;
}

function hostedProjectSourceRequest(source: LocalProjectSource): {
  source: string;
  subjectFiles: HostedFile[];
  taskFiles: HostedFile[];
  adapterFiles: HostedFile[];
  dockerfile: string;
  runtimeDockerfile: string;
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
    taskFiles: hostedTaskFiles(source),
    adapterFiles: source.adapterFiles,
    dockerfile: source.dockerfile,
    runtimeDockerfile: source.runtimeDockerfile,
    network,
    resources,
  };
}

function hostedTaskFiles(source: LocalProjectSource): HostedFile[] {
  return [
    ...source.taskSourceFiles,
    {
      path: WORKBENCH_ADAPTER_RESULT_FILE,
      content: `${JSON.stringify({
        protocol: WORKBENCH_ADAPTER_RESULT_PROTOCOL,
        operation: "tasks.resolve",
        ok: true,
        value: {
          tasks: source.taskBundles,
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
    const response = await apiRequest<{ run: HostedRunRecord }>(
      projectApiPath(args.target.projectId, `/runs/${encodeURIComponent(args.runId)}`),
      {},
      args.target.baseUrl,
    );
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
  const summary = `Run ${run.id} reached ${run.status}; ${run.outcome ? `outcome ${run.outcome}; ` : ""}subject ${run.subjectId ?? "pending"}; ${run.completedJobCount ?? 0}/${run.jobCount ?? 0} jobs completed.`;
  return [
    run.error ? `${summary}\nError: ${run.error}` : summary,
    ...(run.urls?.run ? [`Open run: ${run.urls.run}`] : []),
    ...(run.urls?.subjectEvaluation
      ? [`Open evaluation: ${run.urls.subjectEvaluation}`]
      : []),
  ].join("\n");
}

function formatHostedRunStarted(
  run: HostedRunRecord,
  fallbackWorkflow: HostedRunWorkflow,
): string {
  return [
    `Started ${run.workflow ?? fallbackWorkflow} run ${run.id}; ${run.subjectId ? `subject ${run.subjectId}` : `${run.jobCount ?? 0} jobs queued`}.`,
    ...(run.urls?.run ? [`Open run: ${run.urls.run}`] : []),
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
  const subjectId = run.subjectId ?? jobs.find((job) => job.subjectId)?.subjectId ?? null;
  return [
    `Run ${run.id}: ${run.status}${run.outcome ? ` (${run.outcome})` : ""}`,
    `Workflow: ${run.workflow ?? "improve"}`,
    `Subject: ${subjectId ?? "pending"}`,
    `Samples: ${run.samples ?? 0}`,
    `Trials: ${run.trialsExecuted ?? 0}/${run.trialsRequested ?? run.trialsExecuted ?? 0}`,
    `Jobs: ${run.completedJobCount ?? jobs.filter(isTerminalRunJob).length}/${run.jobCount ?? jobs.length} completed${run.failedJobCount ? `; ${run.failedJobCount} failed` : ""}`,
    ...(typeof run.durationMs === "number"
      ? [`Duration: ${formatDurationMs(run.durationMs)}`]
      : []),
    ...(cost > 0 ? [`Cost: ${formatUsd(cost)}`] : []),
    ...(firstFailedJob?.error
      ? [`First failed job ${firstFailedJob.id}: ${firstFailedJob.error}`]
      : []),
    `Open run: ${urls.run ?? urls.benchmark}`,
    ...(urls.subjectEvaluation ? [`Open evaluation: ${urls.subjectEvaluation}`] : []),
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
  return ["total", "optimizer", "runner", "scorer"].reduce((sum, key) => {
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
    throw new Error(
      readResponseError(text) ||
        `Request failed with status ${response.status}.`,
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
    return text;
  }
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
  const selections = (["skill", "pipeline", "command"] as const).flatMap(
    (kind) =>
      parsed.flags[kind] === undefined
        ? []
        : [{ kind, value: parsed.flags[kind] }],
  );
  if (selections.length !== 1) {
    throw new UsageError(
      "Specify exactly one of --skill NAME, --pipeline NAME, or --command NAME.",
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
      throw new UsageError("--agent applies only to --skill and --pipeline.");
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
      spec,
      adapterManifests,
    ) as ReturnType<typeof resolveWorkbenchResolvedSourceYaml>,
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
