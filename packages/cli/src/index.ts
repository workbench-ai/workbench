import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import YAML from "yaml";

import {
  createBaselineCandidateJob as createRuntimeBaselineCandidateJob,
  evaluationScorecardId,
  evaluationMeanMetrics,
  executeWorkbenchExecutionJob,
  engineResolveBindingForSpec,
  filterOptimizerTraceJobsForCaseIds,
  filterCandidateSourceFiles,
  formatWorkbenchCaseSelector,
  formatWorkbenchSelectionPolicy,
  workbenchCaseSelectorUsesAllCases,
  workbenchExecutionPurpose,
  workbenchRunExecutionFingerprint,
  createWorkbenchAdapterAuthBundle,
  createOptimizerTraceInputFiles,
  DOCKER_SANDBOX_BACKEND,
  localWorkbenchAdapterAuthStore,
  materializeWorkbenchRunResult,
  normalizeSurfaceFiles,
  isSurfaceSnapshotFile,
  jsonRecord,
  planWorkbenchExecutionJobsForPurpose,
  runWorkbenchExecutionDag,
  resolveEngineCaseExecutionConfig,
  resolveWorkbenchResolvedSourceYaml,
  runtimeResources,
  validateWorkbenchRunEnvelope,
  validateWorkbenchResolvedSourceYaml,
  parseWorkbenchAdapterAuthTarget,
  workbenchEngineCaseIdsForImproveEvaluation,
  workbenchEngineCaseIdsForSelector,
  workbenchImproveOptimizeSelector,
  workbenchImproveSelectionPolicy,
  workbenchProjectSourceFingerprint,
  workbenchRuntimeBundleFingerprint,
  workbenchRuntimeExplicitActiveId,
  type CandidateRecord,
  type EvaluationScorecard,
  type EngineResolveBinding,
  type WorkbenchExecutionRuntimeInput,
  type RemoteWorkbenchJob,
  type Json,
  type RunSummary,
  type RuntimeEvent,
  type SurfaceSnapshotFile,
  type WorkbenchRuntimeBundle,
  type WorkbenchRuntimeBundleStats,
  type WorkbenchProjectState,
  type WorkbenchProjectStateImportResult,
  type WorkbenchProjectStateSource,
  type WorkbenchRemoteRunRequest,
  type WorkbenchEngineCase,
  type WorkbenchExecutionDagCapacity,
  type WorkbenchAdapterAuthBundle,
  type WorkbenchAdapterAuthTarget,
  type WorkbenchAdapterAuthStatusRecord,
  type WorkbenchInspection,
} from "@workbench-ai/workbench-core";
import {
  assertWorkbenchAdapterOperationResultOk,
  collectWorkbenchAdapterAuthRequirements,
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
  REMOTE_WATCH_LIFECYCLE_NOTE,
  LOCAL_DEV_OPEN_LIFECYCLE_NOTE,
  rootUsage,
} from "./command-model.js";
import { startLocalWorkbenchDevServer } from "./dev-open-server.js";
import { createLocalWorkbenchInspection } from "./local-inspection.js";
import {
  createWorkbenchInitScaffold,
  type InitAgent,
  type InitCandidateKind,
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
  loadLocalArchive,
  loadLocalArchiveIndex,
  exportLocalRuntimeBundle,
  importLocalRuntimeBundle,
  runtimeBundleStats,
  materializeCandidateRoot,
  readLocalCandidate,
  readLocalCandidateFiles,
  readLocalJobs,
  saveLocalArchive,
  saveLocalJobs,
  setLocalActive,
  upsertLocalRun,
  upsertLocalCandidate,
  upsertLocalEvaluation,
} from "./local-archive.js";
import {
  readSnapshotFiles,
  WorkspaceSnapshotError,
  type WorkspaceSnapshotFile,
} from "./workspace-snapshot.js";
import {
  remoteEngineResolveFiles,
  readLocalProjectSource,
  WORKBENCH_BENCHMARK_FILE,
  type LocalProjectSource,
} from "./project-source.js";
import {
  localBenchmarkFingerprint,
  localCandidateFingerprint,
  projectStateBenchmarkFingerprint,
} from "./benchmark-fingerprint.js";

interface CliIo {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

type CliCommandHandler = (argv: readonly string[], io: CliIo) => Promise<number>;

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
  remote: string;
  projectId: string;
  sourceRevisionId: string;
  sourceFingerprint: string;
  runtimeFingerprint: string;
  linkedAt: string;
}

interface LocalProjectStateApplyResult {
  origin: WorkbenchOrigin;
  files: number;
  runtime: WorkbenchRuntimeBundleStats;
}

interface CliRuntimeOptions {}

type RemoteRunWorkflow = "eval" | "improve";

const require = createRequire(import.meta.url);

function getCliVersion(): string {
  const manifest = require("../package.json") as { version?: unknown };
  return typeof manifest.version === "string" ? manifest.version : "unknown";
}

interface RemoteTarget {
  projectId: string;
  owner?: string;
  projectName?: string;
  dir: string;
  baseUrl: string;
  origin?: WorkbenchOrigin | null;
}

interface RemoteDryRunTarget {
  projectRef: string;
  projectId?: string;
  owner?: string;
  projectName?: string;
  dir: string;
  baseUrl: string;
  origin?: WorkbenchOrigin | null;
}

interface RemoteProjectSummary {
  id?: string;
  ownerUsername?: string;
  name?: string;
  visibility?: "private" | "public";
  activeCandidateId?: string | null;
  starCount?: number;
}

interface WorkbenchResourceUrls {
  benchmark: string;
  candidateEvaluation?: string;
}

interface WorkbenchCheckPlan {
  benchmarkName: string;
  benchmarkDescription: string;
  source: {
    files: number;
    yaml: string[];
    dockerfile: string;
  };
  candidate: {
    name: string;
    selectedRunId: string;
    runCount: number;
    filesPath: string;
    files: number;
  };
  improve: {
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

const API_REQUEST_MAX_ATTEMPTS = 3;

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

type RemoteFile = WorkspaceSnapshotFile;

interface RemoteRunRecord {
  id: string;
  projectId?: string;
  status: string;
  workflow?: RemoteRunWorkflow;
  candidateId: string | null;
  candidateRunId?: string;
  candidateRunName?: string;
  activeCandidateId?: string | null;
  outputCandidateId?: string | null;
  jobCount?: number;
  budget?: number;
  attemptsRequested?: number;
  attemptsExecuted?: number;
  samples?: number;
  completedJobCount?: number;
  failedJobCount?: number;
  durationMs?: number;
  outcome?: "ok" | "error" | "cancelled" | string | null;
  stoppedReason?: string;
  error?: string;
  retry?: {
    sourceYaml?: string;
    baseCandidateId?: string | null;
  };
  urls?: WorkbenchResourceUrls;
}

interface RemoteRunStartResponse {
  run: RemoteRunRecord;
  reused?: boolean;
  benchmark?: RemoteProjectSummary & { id: string };
}

interface RemoteRunJobRecord {
  id: string;
  runId?: string;
  kind?: string;
  status: string;
  candidateId?: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt?: string;
  output?: Json;
  error?: string;
  purpose?: string;
  caseId?: string;
  sampleIndex?: number;
  attemptIndex?: number;
}

interface LocalDevViewHint {
  command: string;
  note: string;
}

const DEFAULT_BASE_URL = "https://v2.workbench.ai";
const AUTH_COMMAND_HANDLERS: Record<string, CliCommandHandler> = {
  connect: authConnect,
  disconnect: authDisconnect,
};
const ADAPTERS_COMMAND_HANDLERS: Record<string, CliCommandHandler> = {
  create: adaptersCreate,
  inspect: adaptersInspect,
  list: adaptersList,
  test: adaptersTest,
};
const TRACES_COMMAND_HANDLERS: Record<string, CliCommandHandler> = {
  collect: localTraceCollect,
  list: localTraceList,
  show: localTraceShow,
};
const TWO_SEGMENT_HELP_COMMANDS: Record<string, readonly string[]> = {
  adapters: ["create", "list", "inspect", "test"],
  auth: [],
  candidates: ["list", "show", "files", "preview"],
  evaluations: ["list", "show"],
  executions: ["trace"],
  runs: ["list", "show"],
  traces: ["collect", "list", "show"],
};

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
    if (argv[0] === "pull") {
      return await pullProject(argv.slice(1), io);
    }
    if (argv[0] === "push") {
      return await pushBenchmark(argv.slice(1), io);
    }
    if (argv[0] === "eval") {
      const remote = extractRemoteFlag(argv.slice(1));
      return remote.enabled
        ? await startRemoteWorkflow("eval", remote.argv, io)
        : await localEvaluateCandidate(remote.argv, io, runtimeOptions);
    }
    if (argv[0] === "retry") {
      const remote = extractRemoteFlag(argv.slice(1));
      return remote.enabled
        ? await retryRemoteWorkflow(remote.argv, io)
        : await localRetry(remote.argv, io, runtimeOptions);
    }
    if (argv[0] === "improve") {
      const remote = extractRemoteFlag(argv.slice(1));
      return remote.enabled
        ? await startRemoteWorkflow("improve", remote.argv, io)
        : await localRun(remote.argv, io, runtimeOptions);
    }
    if (argv[0] === "restore") {
      return await localRestore(argv.slice(1), io);
    }
    if (argv[0] === "open") {
      const remote = extractRemoteFlag(argv.slice(1));
      return remote.enabled
        ? await openWorkbench(remote.argv, io)
        : await localDevOpen(remote.argv, io);
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
    if (argv[0] === "diagnose") {
      return await localDiagnose(argv.slice(1), io);
    }
    const commandPath = argv.slice(0, 2).join(" ");
    const rest = argv.slice(2);
    switch (commandPath) {
      case "runs list":
        return await localRunList(rest, io);
      case "runs show":
        return await localRunShow(rest, io);
      case "evaluations list":
        return await localEvaluationList(rest, io);
      case "evaluations show":
        return await localEvaluationShow(rest, io);
      case "executions trace":
        return await localExecutionTrace(rest, io);
      case "candidates list":
        return await localCandidateList(rest, io);
      case "candidates show":
        return await localCandidateShow(rest, io);
      case "candidates files":
        return await localCandidateFiles(rest, io);
      case "candidates preview":
        return await localCandidatePreview(rest, io);
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
  const command = positionals[0] ?? "";
  const subcommands = TWO_SEGMENT_HELP_COMMANDS[command];
  if (subcommands && (subcommands.length === 0 || subcommands.includes(positionals[1] ?? ""))) {
    return positionals.slice(0, 2).join(" ");
  }
  return command;
}

function extractRemoteFlag(argv: readonly string[]): {
  enabled: boolean;
  argv: string[];
} {
  let enabled = false;
  const next: string[] = [];
  for (const arg of argv) {
    if (arg === "--remote") {
      enabled = true;
    } else {
      next.push(arg);
    }
  }
  return { enabled, argv: next };
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
      candidateRoot: scaffold.candidateRoot,
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
        path.relative(source.dir, source.candidateSpecPath) || "candidate YAML",
      ],
      dockerfile: source.dockerfilePath,
    },
    candidate: {
      name: source.spec.candidate.name,
      selectedRunId: source.spec.candidate.selectedRunId,
      runCount: Object.keys(source.spec.candidate.runs).length,
      filesPath: source.spec.candidate.files.path,
      files: source.candidateFiles.length,
    },
    improve: source.spec.candidate.improve
      ? {
          edits: [...source.spec.candidate.improve.edits],
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
  const edits = plan.improve?.edits.length
    ? plan.improve.edits.join(", ")
    : "-";
  const network = plan.environment.network.egress;
  const resources = plan.environment.resources;
  return [
    `Spec is valid${warningSuffix}.`,
    `Benchmark: ${plan.benchmarkName}`,
    `Description: ${plan.benchmarkDescription}`,
    `Source: ${plan.source.files} file(s) (${plan.source.yaml.join(", ")}, ${plan.source.dockerfile})`,
    `Candidate: ${plan.candidate.name} (${plan.candidate.runCount} run(s), selected ${plan.candidate.selectedRunId})`,
    `Candidate files: ${plan.candidate.filesPath} (${plan.candidate.files} file(s))`,
    `Improve edits: ${edits}`,
    `Engine cases: ${plan.engine.cases} case(s) from ${formatAdapterSummary(plan.engine.resolver)} at ${plan.engine.path} (${plan.engine.files} file(s))`,
    `Environment: ${plan.environment.dockerfile}, network ${network}, ${resources.cpu} CPU, ${resources.memoryGb}GB RAM, ${resources.timeoutMinutes}m timeout`,
    `Execution: improve ${plan.adapters.improve ? formatAdapterSummary(plan.adapters.improve) : "not configured"}, candidate run ${formatAdapterSummary(plan.adapters.run)}, engine ${formatAdapterSummary(plan.adapters.engine)}`,
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

interface LocalRetryTarget {
  sourceId: string;
  sourceKind: "evaluation" | "run";
  workflow: RemoteRunWorkflow;
  candidateId: string;
  candidateRunId: string;
  samples: number;
  budget?: number;
  preserveActiveId: string | null;
}

interface RetryEvaluationSummary {
  id: string;
  runId: string;
  candidateId: string;
  candidateRunId?: string;
  status: string;
  sampleCount: number;
  errorSampleCount: number;
}

interface RetryCommandResult {
  ok: boolean;
  retried: {
    id: string;
    kind: "evaluation" | "run";
    workflow: RemoteRunWorkflow;
  };
  runId?: string | null;
  evaluationId?: string | null;
  candidateId?: string | null;
  activeCandidateId?: string | null;
  localView?: LocalDevViewHint;
  run?: RemoteRunRecord;
  urls?: WorkbenchResourceUrls;
  failedJobCount?: number;
  error?: string;
}

async function localRetry(
  argv: readonly string[],
  io: CliIo,
  runtimeOptions: CliRuntimeOptions,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  rejectUnexpectedPositionals(parsed, "workbench retry", 1);
  const targetId = parsed.positionals[0];
  if (!targetId) {
    throw new UsageError("Missing required TARGET_ID.");
  }
  const workspace = resolveDir(parsed);
  const target = await resolveLocalRetryTarget(workspace, targetId);
  const captured = createCapturingIo(io);
  const code = target.workflow === "eval"
    ? await localEvaluateCandidate([
        "--dir",
        workspace,
        "--candidate",
        target.candidateId,
        "--runs",
        target.candidateRunId,
        "--samples",
        String(target.samples),
        "--json",
      ], captured.io, runtimeOptions)
    : await localRun([
        "--dir",
        workspace,
        "--from",
        target.candidateId,
        "--runs",
        target.candidateRunId,
        "--budget",
        String(target.budget ?? 1),
        "--samples",
        String(target.samples),
        "--json",
      ], captured.io, runtimeOptions);
  const commandOutput = parseCapturedJson(captured.stdoutText());
  await preserveLocalActiveCandidate(workspace, target.preserveActiveId);
  const outputRecord = readRecord(commandOutput) ?? {};
  const result: RetryCommandResult = {
    ok: code === 0 && outputRecord.ok !== false,
    retried: {
      id: target.sourceId,
      kind: target.sourceKind,
      workflow: target.workflow,
    },
  };
  assignRetryResultString(result, "runId", outputRecord.runId);
  assignRetryResultString(result, "evaluationId", outputRecord.evaluationId);
  assignRetryResultString(result, "candidateId", outputRecord.candidateId);
  assignRetryResultString(result, "activeCandidateId", outputRecord.activeCandidateId);
  const localView = localRetryViewHint(outputRecord.localView);
  if (localView) {
    result.localView = localView;
  }
  const failedJobCount = numberValue(outputRecord.failedJobCount);
  if (failedJobCount !== null) {
    result.failedJobCount = failedJobCount;
  }
  const error = stringValue(outputRecord.error);
  if (error) {
    result.error = error;
  }
  writeOutput(result, parsed, io, formatRetryCommandResult);
  return code;
}

async function resolveLocalRetryTarget(
  workspace: string,
  targetId: string,
): Promise<LocalRetryTarget> {
  const snapshot = await loadLocalArchive(workspace);
  const evaluation = snapshot.evaluations.find((entry) => entry.id === targetId);
  if (evaluation) {
    const run = snapshot.runs.find((entry) => entry.id === evaluation.runId) ?? null;
    return localEvaluationRetryTarget(snapshot, evaluation, run, "evaluation", targetId);
  }
  const run = snapshot.runs.find((entry) => entry.id === targetId);
  if (!run) {
    throw new UsageError(`Run or evaluation not found: ${targetId}`);
  }
  if (run.status !== "finished") {
    throw new UsageError(`Run ${run.id} is ${run.status}; wait for it to finish before retrying.`);
  }
  if (!runSummaryFailed(run)) {
    throw new UsageError(`Run ${run.id} did not fail; use workbench ${run.workflow} to intentionally run it again.`);
  }
  if (run.workflow === "eval") {
    const evaluations = snapshot.evaluations.filter((entry) => entry.runId === run.id);
    if (evaluations.length !== 1) {
      throw new UsageError(
        evaluations.length === 0
          ? `Run ${run.id} has no evaluation record to retry.`
          : `Run ${run.id} has multiple evaluations; retry a specific evaluation id instead.`,
      );
    }
    return localEvaluationRetryTarget(snapshot, evaluations[0]!, run, "run", targetId);
  }
  const candidateRunId = run.candidateRunId;
  if (!run.candidateId || !candidateRunId) {
    throw new UsageError(`Run ${run.id} is missing retry metadata; use workbench improve --from with an explicit candidate id.`);
  }
  return {
    sourceId: targetId,
    sourceKind: "run",
    workflow: "improve",
    candidateId: run.candidateId,
    candidateRunId,
    samples: run.samples,
    budget: run.budget,
    preserveActiveId: snapshot.activeId,
  };
}

function localEvaluationRetryTarget(
  snapshot: { activeId: string | null; candidates: CandidateRecord[] },
  evaluation: EvaluationScorecard,
  run: RunSummary | null,
  sourceKind: "evaluation" | "run",
  sourceId: string,
): LocalRetryTarget {
  if (!evaluationScorecardFailed(evaluation, run)) {
    throw new UsageError(`Evaluation ${evaluation.id} did not fail; use workbench eval to intentionally run it again.`);
  }
  if (!snapshot.candidates.some((entry) => entry.id === evaluation.candidateId)) {
    throw new UsageError(`Candidate not found for evaluation ${evaluation.id}: ${evaluation.candidateId}`);
  }
  const candidateRunId = evaluation.candidateRunId ?? run?.candidateRunId;
  if (!candidateRunId) {
    throw new UsageError(`Evaluation ${evaluation.id} is missing its candidate run configuration.`);
  }
  return {
    sourceId,
    sourceKind,
    workflow: "eval",
    candidateId: evaluation.candidateId,
    candidateRunId,
    samples: evaluation.sampleCount || run?.samples || 1,
    preserveActiveId: snapshot.activeId,
  };
}

async function preserveLocalActiveCandidate(
  workspace: string,
  activeId: string | null,
): Promise<void> {
  let snapshot = await loadLocalArchive(workspace);
  if (activeId && !snapshot.candidates.some((candidate) => candidate.id === activeId)) {
    return;
  }
  if (snapshot.activeId === activeId) {
    return;
  }
  snapshot = setLocalActive(snapshot, activeId);
  await saveLocalArchive(workspace, snapshot);
}

function evaluationScorecardFailed(
  evaluation: RetryEvaluationSummary,
  run: { outcome?: string | null } | null,
): boolean {
  return evaluation.errorSampleCount > 0 ||
    evaluation.status !== "completed" ||
    runSummaryFailed(run);
}

function runSummaryFailed(
  run: { outcome?: string | null } | null,
): boolean {
  return run?.outcome === "error" || run?.outcome === "cancelled";
}

function createCapturingIo(io: CliIo): { io: CliIo; stdoutText: () => string } {
  const chunks: string[] = [];
  const stdout = new class extends Writable {
    override _write(
      chunk: unknown,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void,
    ): void {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      callback();
    }
  }();
  return {
    io: {
      stdin: io.stdin,
      stdout,
      stderr: io.stderr,
    },
    stdoutText: () => chunks.join(""),
  };
}

function parseCapturedJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return { output: trimmed };
  }
}

function localRetryViewHint(value: unknown): LocalDevViewHint | undefined {
  const record = readRecord(value);
  const command = stringValue(record?.command);
  const note = stringValue(record?.note);
  return command && note ? { command, note } : undefined;
}

function assignRetryResultString(
  result: RetryCommandResult,
  key: "runId" | "evaluationId" | "candidateId" | "activeCandidateId",
  value: unknown,
): void {
  const normalized = stringValue(value);
  if (normalized) {
    result[key] = normalized;
  }
}

async function localRun(
  argv: readonly string[],
  io: CliIo,
  runtimeOptions: CliRuntimeOptions,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "runs", "from", "budget", "samples", "rerun", "json"]));
  const budget = parsePositiveInt(parsed.flags.budget, 1, "budget");
  const samples = parsePositiveInt(parsed.flags.samples, 1, "samples");
  const sourceArg = resolveSourceDir(parsed);
  const projectSource = await readLocalProjectSource(sourceArg, {
    runId: singleRequestedRunId(asOptionalString(parsed.flags.runs), "workbench improve"),
  });
  const workspace = projectSource.dir;
  if (!projectSource.spec.improve || !projectSource.spec.candidate.improve) {
    throw new UsageError("Candidate improve configuration is required for workbench improve.");
  }
  const executionProject = await resolveLocalProjectForExecution(workspace, projectSource.specSource);
  const { spec, adapterManifests } = executionProject;
  const engineResolveFiles = normalizeSurfaceFiles(projectSource.engineResolveFiles);
  const engineCases = projectSource.engineCases;
  const caseIds = engineCases.map((bundle) => bundle.id);
  if (caseIds.length === 0) {
    throw new UsageError("Engine resolver must emit at least one case.");
  }
  const optimizeSelector = workbenchImproveOptimizeSelector(spec);
  const selectionPolicy = workbenchImproveSelectionPolicy(spec);
  const optimizeCaseIds = workbenchEngineCaseIdsForSelector(engineCases, optimizeSelector);
  if (optimizeCaseIds.length === 0) {
    throw new UsageError(`Improve optimizeOn selector matched no cases: ${formatWorkbenchCaseSelector(optimizeSelector)}.`);
  }
  const selectionCaseIds = workbenchEngineCaseIdsForSelector(engineCases, selectionPolicy.selector);
  if (selectionCaseIds.length === 0) {
    throw new UsageError(`Improve selectBy selector matched no cases: ${formatWorkbenchCaseSelector(selectionPolicy.selector)}.`);
  }
  const selectionScoreCaseIds = workbenchCaseSelectorUsesAllCases(selectionPolicy.selector)
    ? undefined
    : selectionCaseIds;
  const evaluationCaseIds = workbenchEngineCaseIdsForImproveEvaluation({ spec, engineCases });
  requireValidRunEnvelope({
    workflow: "improve",
    budget,
    samples,
    caseCount: evaluationCaseIds.length,
  });
  const optimizeOnLabel = formatWorkbenchCaseSelector(optimizeSelector);
  const selectByLabel = formatWorkbenchSelectionPolicy(selectionPolicy);
  const environmentRefs = await ensureLocalDockerfileEnvironments(
    workspace,
    spec,
    engineCases,
  );
  const benchmarkFingerprint = await readLocalBenchmarkFingerprint(workspace);
  const executionFingerprint = localRunExecutionFingerprint(projectSource);
  const baseCandidate = await ensureLocalImproveBaseCandidate({
    parsed,
    sourceArg,
    workspace,
    projectSource,
    samples,
    io,
    runtimeOptions,
  });
  let snapshot = await loadLocalArchive(workspace);
  if (parsed.flags.rerun !== true) {
    const reusableRun = findReusableLocalImproveRun(snapshot.runs, {
      benchmarkFingerprint,
      candidateId: baseCandidate.id,
      candidateRunId: projectSource.spec.candidate.selectedRunId,
      executionFingerprint,
      budget,
      samples,
    });
    if (reusableRun) {
      const evaluation = snapshot.evaluations.find((entry) => entry.runId === reusableRun.id) ?? null;
      const outputCandidateId = reusableRun.outputCandidateId ?? reusableRun.candidateId ?? baseCandidate.id;
      const outputCandidate = readLocalCandidate(snapshot, outputCandidateId);
      const activeCandidate = snapshot.activeId
        ? readLocalCandidate(snapshot, snapshot.activeId)
        : null;
      const result = {
        ok: true,
        reused: true,
        runId: reusableRun.id,
        evaluationId: evaluation?.id ?? null,
        outputCandidateId,
        outputCandidate,
        activeCandidateId: snapshot.activeId,
        activeCandidate,
        completedJobCount: 0,
        failedJobCount: 0,
        localView: localDevViewHint(workspace, reusableRun.id),
      };
      writeOutput(
        result,
        parsed,
        io,
        () => `Reused improve run ${reusableRun.id}. Use --rerun to intentionally run it again.`,
      );
      return 0;
    }
  }
  const runId = `run_local_${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();
  let currentBaseId = baseCandidate.id;
  let outputCandidateId: string | null = null;
  let completedJobCount = 0;
  let failedJobCount = 0;
  let attemptsExecuted = 0;
  const failedJobs: Array<{
    id: string;
    purpose: string | null;
    error: string;
  }> = [];
  const events: RuntimeEvent[] = [
    createLocalEvent("run_started", startedAt, {
      runId,
      detail: { budget, samples, strategy: "greedy", optimizeOn: optimizeOnLabel, selectBy: selectByLabel },
    }),
  ];
  const runningRun: RunSummary = {
    id: runId,
    workflow: "improve",
    benchmarkFingerprint,
    status: "running",
    candidateId: baseCandidate.id,
    candidateRunId: projectSource.spec.candidate.selectedRunId,
    candidateRunName: projectSource.spec.candidate.selectedRunName,
    startedAt,
    improver: formatSpecImprover(spec),
    engineRun: spec.engineRun.use,
    strategy: "greedy",
    optimizeOn: optimizeOnLabel,
    selectBy: selectByLabel,
    budget,
    repairBudget: 0,
    attemptsRequested: budget,
    attemptsExecuted: 0,
    samples,
    executionFingerprint,
    activeCandidateId: snapshot.activeId,
    outputCandidateId: null,
  };
  snapshot = upsertLocalRun(snapshot, runningRun, events);
  await saveLocalArchive(workspace, snapshot);
  try {
  const devCapacity = await localDevelopmentCapacity(workspace);
  const baselineTraceJobs = selectLocalOptimizerBaselineTraceJobs(
    snapshot,
    await readLocalJobs(workspace),
    {
      benchmarkFingerprint,
      candidateId: baseCandidate.id,
      candidateRunId: projectSource.spec.candidate.selectedRunId,
      executionFingerprint,
    },
  );
  const runTraceJobs: RemoteWorkbenchJob[] = [];
  const attempts = budget;
  for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex += 1) {
    snapshot = await loadLocalArchive(workspace);
    const activeCandidate = readLocalCandidate(snapshot, currentBaseId);
    const baseFiles = filterCandidateSourceFiles(
      readLocalCandidateFiles(snapshot, activeCandidate.id),
    );
    if (baseFiles.length === 0) {
      throw new UsageError(
        "Candidate snapshot must include at least one file.",
      );
    }
    const candidateRevisionTraceFiles = createOptimizerTraceInputFiles({
      jobs: filterOptimizerTraceJobsForCaseIds(
        [...baselineTraceJobs, ...runTraceJobs],
        optimizeCaseIds,
      ),
    });
    const candidateId = `candidate_${runId.replace(/^run_/u, "")}_${String(attemptIndex + 1).padStart(3, "0")}`;
    const plannedCandidateRevision = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "local",
      projectId: "local",
      runId,
      candidateId,
      attemptIndex,
      samples,
      caseIds: optimizeCaseIds,
      engineCases,
      spec,
      workflow: "improve",
      purpose: "improve",
      now: new Date().toISOString(),
      baseFiles,
      traceFiles: candidateRevisionTraceFiles,
      ...(environmentRefs.defaultRef ? { environmentRef: environmentRefs.defaultRef } : {}),
      baseId: activeCandidate.id,
    })[0]!;
    const candidateRevisionJobs = await executeLocalDevelopmentDag({
      jobs: [plannedCandidateRevision],
      spec,
      adapterManifests,
      adapterFiles: normalizeSurfaceFiles(projectSource.adapterFiles),
      baseFiles,
      engineResolveFiles,
      engineCases,
      traceFiles: candidateRevisionTraceFiles,
      capacity: devCapacity,
    });
    const candidateRevision = candidateRevisionJobs[0]!;
    const completedJobs: RemoteWorkbenchJob[] = [candidateRevision];
    if (candidateRevision.status === "succeeded") {
      const candidateRevisionFiles =
        completedJobOutputFiles(candidateRevision).length > 0
          ? normalizeSurfaceFiles(
              completedJobOutputFiles(candidateRevision).filter(
                (file) => !file.path.startsWith(".workbench/"),
              ),
            )
          : baseFiles;
      const attemptJobs = planWorkbenchExecutionJobsForPurpose({
        ownerUserId: "local",
        projectId: "local",
        runId,
        candidateId,
        attemptIndex,
        samples,
        now: new Date().toISOString(),
        caseIds: evaluationCaseIds,
        engineCases,
        spec,
        environmentRefsByCase: environmentRefs.byCase,
        workflow: "improve",
        purpose: "attempt",
      });
      const dagJobs = await executeLocalDevelopmentDag({
        jobs: [candidateRevision, ...attemptJobs],
        spec,
        adapterManifests,
        adapterFiles: normalizeSurfaceFiles(projectSource.adapterFiles),
        baseFiles: candidateRevisionFiles,
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
      previousCandidate: activeCandidate,
      existingCandidateCount: snapshot.candidates.length,
      selection: {
        metric: selectionPolicy.metric,
        ...(selectionScoreCaseIds ? { caseIds: selectionScoreCaseIds } : {}),
        label: selectByLabel,
      },
    });
    for (const candidate of materialized.candidates) {
      const localCandidate = localCandidateRecord(candidate);
      outputCandidateId = localCandidate.id;
      snapshot = upsertLocalCandidate(
        snapshot,
        localCandidate,
        materialized.candidateFiles[localCandidate.id] ?? [],
      );
      events.push(
        createLocalEvent("candidate_created", localCandidate.createdAt, {
          runId,
          candidateId: localCandidate.id,
          baseId: localCandidate.baseId,
          status: localCandidate.status,
          metrics: evaluationMeanMetrics(localCandidate.eval),
        }),
      );
    }
    for (const evaluation of materialized.evaluations) {
      snapshot = upsertLocalEvaluation(snapshot, evaluation);
    }
    snapshot = setLocalActive(snapshot, materialized.activeCandidateId);
    currentBaseId = materialized.activeCandidateId ?? currentBaseId;
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
        candidateId: materialized.activeCandidateId ?? undefined,
        activeId: materialized.activeCandidateId ?? undefined,
        status: materialized.selectedCandidate?.status,
        metrics: evaluationMeanMetrics(materialized.selectedCandidate?.eval),
      }),
    );
    await saveLocalJobs(workspace, completedJobs);
    await saveLocalArchive(workspace, snapshot);
    attemptsExecuted += 1;
  }
  snapshot = await loadLocalArchive(workspace);
  const finishedAt = new Date().toISOString();
  const run: RunSummary = {
    id: runId,
    workflow: "improve",
    benchmarkFingerprint,
    status: "finished",
    candidateId: baseCandidate.id,
    candidateRunId: projectSource.spec.candidate.selectedRunId,
    candidateRunName: projectSource.spec.candidate.selectedRunName,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    improver: formatSpecImprover(spec),
    engineRun: spec.engineRun.use,
    strategy: "greedy",
    optimizeOn: optimizeOnLabel,
    selectBy: selectByLabel,
    budget,
    repairBudget: 0,
    attemptsRequested: budget,
    attemptsExecuted,
    samples,
    executionFingerprint,
    stoppedReason: "budget_exhausted",
    outcome: failedJobCount > 0 ? "error" : "ok",
    activeCandidateId: snapshot.activeId,
    outputCandidateId: outputCandidateId ?? snapshot.activeId,
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
  snapshot = upsertLocalRun(snapshot, run, events.slice(1));
  await saveLocalArchive(workspace, snapshot);
  const outputCandidate = run.outputCandidateId
    ? readLocalCandidate(snapshot, run.outputCandidateId)
    : null;
  const activeCandidate = snapshot.activeId
    ? readLocalCandidate(snapshot, snapshot.activeId)
    : null;
  const result = {
    ok: failedJobCount === 0,
    runId,
    outputCandidateId: run.outputCandidateId,
    outputCandidate,
    activeCandidateId: snapshot.activeId,
    activeCandidate,
    completedJobCount,
    failedJobCount,
    failedJobs,
    localView: localDevViewHint(workspace, runId),
  };
  writeOutput(result, parsed, io, () => {
    const outputMetricValue = outputCandidate ? formatCandidateEvaluationScore(outputCandidate) : "n/a";
    const activeMetricValue = activeCandidate ? formatCandidateEvaluationScore(activeCandidate) : "n/a";
    const firstFailure = result.failedJobs[0];
    const failureDetail = firstFailure
      ? `\nFirst failed job ${firstFailure.id}${firstFailure.purpose ? ` (${firstFailure.purpose})` : ""}: ${firstFailure.error}`
      : "";
    const viewDetail = failedJobCount === 0
      ? `\nOpen local view: ${result.localView.command}\n${result.localView.note}`
      : "";
    return `Run ${runId} finished. Output candidate: ${formatLocalCandidateLabel(outputCandidate)} (score: ${outputMetricValue}). Active candidate: ${formatLocalCandidateLabel(activeCandidate)} (score: ${activeMetricValue}).${failureDetail}${viewDetail}`;
  });
  return failedJobCount === 0 ? 0 : 1;
  } catch (error) {
    await markLocalRunFailed({
      workspace,
      run: {
        ...runningRun,
        attemptsExecuted,
        outputCandidateId,
      },
      startedAt,
      error,
    }).catch(() => undefined);
    throw error;
  }
}

async function ensureLocalImproveBaseCandidate(args: {
  parsed: ParsedArgs;
  sourceArg: string;
  workspace: string;
  projectSource: LocalProjectSource;
  samples: number;
  io: CliIo;
  runtimeOptions: CliRuntimeOptions;
}): Promise<CandidateRecord> {
  let snapshot = await loadLocalArchive(args.workspace);
  const explicitBase = asOptionalString(args.parsed.flags.from);
  const benchmarkFingerprint = localBenchmarkFingerprint(args.projectSource);
  const baseCandidateArgs = {
    workspace: args.workspace,
    benchmarkFingerprint,
    projectSource: args.projectSource,
    samples: args.samples,
    rerun: args.parsed.flags.rerun === true,
    io: args.io,
    runtimeOptions: args.runtimeOptions,
  };
  if (explicitBase) {
    return await ensureEvaluatedLocalImproveBaseCandidate({
      ...baseCandidateArgs,
      candidateId: explicitBase,
    });
  }

  if (snapshot.activeId) {
    const activeCandidate = readLocalCandidate(snapshot, snapshot.activeId);
    if (activeCandidate.benchmarkFingerprint === benchmarkFingerprint) {
      return await ensureEvaluatedLocalImproveBaseCandidate({
        ...baseCandidateArgs,
        candidateId: activeCandidate.id,
      });
    }
  }

  const candidateFingerprint = localCandidateFingerprint(args.projectSource);
  const existing = snapshot.candidates.find((candidate) =>
    candidate.benchmarkFingerprint === benchmarkFingerprint &&
    candidate.candidateFingerprint === candidateFingerprint &&
    (candidate.status === "evaluated" || Boolean(candidate.eval))
  );
  if (existing) {
    return existing;
  }

  const evalArgs = args.parsed.positionals.length > 0
    ? [
        args.sourceArg,
        "--runs",
        args.projectSource.spec.candidate.selectedRunId,
        "--samples",
        String(args.samples),
        ...(args.parsed.flags.rerun === true ? ["--rerun"] : []),
        "--json",
      ]
    : [
        "--dir",
        args.workspace,
        "--runs",
        args.projectSource.spec.candidate.selectedRunId,
        "--samples",
        String(args.samples),
        ...(args.parsed.flags.rerun === true ? ["--rerun"] : []),
        "--json",
      ];
  const code = await localEvaluateCandidate(evalArgs, createSilentIo(args.io), args.runtimeOptions);
  if (code !== 0) {
    throw new UsageError("Parent candidate eval failed; improve was not started.");
  }
  snapshot = await loadLocalArchive(args.workspace);
  const evaluated = snapshot.candidates.find((candidate) =>
    candidate.benchmarkFingerprint === benchmarkFingerprint &&
    candidate.candidateFingerprint === candidateFingerprint &&
    (candidate.status === "evaluated" || Boolean(candidate.eval))
  );
  if (!evaluated) {
    throw new UsageError("Parent candidate eval did not produce an evaluated candidate.");
  }
  return evaluated;
}

async function ensureEvaluatedLocalImproveBaseCandidate(args: {
  workspace: string;
  candidateId: string;
  benchmarkFingerprint: string;
  projectSource: LocalProjectSource;
  samples: number;
  rerun: boolean;
  io: CliIo;
  runtimeOptions: CliRuntimeOptions;
}): Promise<CandidateRecord> {
  let snapshot = await loadLocalArchive(args.workspace);
  let candidate = readLocalCandidate(snapshot, args.candidateId);
  if (candidate.benchmarkFingerprint !== args.benchmarkFingerprint) {
    throw new UsageError(
      `Base candidate ${args.candidateId} belongs to benchmark ${candidate.benchmarkFingerprint}, not ${args.benchmarkFingerprint}.`,
    );
  }
  if (!candidate.candidateFingerprint) {
    throw new UsageError(`Base candidate ${args.candidateId} is missing a candidate fingerprint.`);
  }
  if (candidate.status === "evaluated" || candidate.eval) {
    return candidate;
  }
  const code = await localEvaluateCandidate(
    [
      "--dir",
      args.workspace,
      "--candidate",
      args.candidateId,
      "--runs",
      args.projectSource.spec.candidate.selectedRunId,
      "--samples",
      String(args.samples),
      ...(args.rerun ? ["--rerun"] : []),
      "--json",
    ],
    createSilentIo(args.io),
    args.runtimeOptions,
  );
  if (code !== 0) {
    throw new UsageError(`Base candidate ${args.candidateId} eval failed; improve was not started.`);
  }
  snapshot = await loadLocalArchive(args.workspace);
  return readLocalCandidate(snapshot, args.candidateId);
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

function selectLocalOptimizerBaselineTraceJobs(
  snapshot: {
    evaluations: readonly EvaluationScorecard[];
    runs: readonly RunSummary[];
  },
  jobs: readonly RemoteWorkbenchJob[],
  target: {
    benchmarkFingerprint: string;
    candidateId: string;
    candidateRunId: string;
    executionFingerprint: string;
  },
): RemoteWorkbenchJob[] {
  const runById = new Map(snapshot.runs.map((run) => [run.id, run]));
  const evaluation = snapshot.evaluations
    .filter((entry) => {
      const run = runById.get(entry.runId);
      return entry.benchmarkFingerprint === target.benchmarkFingerprint &&
        entry.candidateId === target.candidateId &&
        entry.candidateRunId === target.candidateRunId &&
        run?.executionFingerprint === target.executionFingerprint;
    })
    .sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.runId.localeCompare(left.runId),
    )[0] ?? null;
  if (!evaluation) {
    return [];
  }
  return jobs.filter((job) => job.runId === evaluation.runId);
}

async function localEvaluateCandidate(
  argv: readonly string[],
  io: CliIo,
  runtimeOptions: CliRuntimeOptions,
): Promise<number> {
  void runtimeOptions;
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "candidate", "runs", "samples", "rerun", "json"]));
  const samples = parsePositiveInt(parsed.flags.samples, 1, "samples");
  const sourceArg = resolveSourceDir(parsed);
  const runsFlag = asOptionalString(parsed.flags.runs);
  const defaultProjectSource = await readLocalProjectSource(sourceArg);
  const selectedRunIds = resolveCandidateRunSelection(defaultProjectSource, runsFlag);
  if (selectedRunIds.length > 1) {
    let failed = 0;
    for (const runId of selectedRunIds) {
      const args = [
        "--dir",
        defaultProjectSource.dir,
        "--runs",
        runId,
        "--samples",
        String(samples),
        ...(readOptionalCandidateFlag(parsed) ? ["--candidate", readOptionalCandidateFlag(parsed)!] : []),
        ...(parsed.flags.rerun === true ? ["--rerun"] : []),
        "--json",
      ];
      const code = await localEvaluateCandidate(args, createSilentIo(io), runtimeOptions);
      if (code !== 0) {
        failed += 1;
      }
    }
    writeOutput(
      {
        ok: failed === 0,
        candidateId: defaultProjectSource.candidateName,
        candidateRunIds: selectedRunIds,
        failedRunCount: failed,
      },
      parsed,
      io,
      () => `Evaluated ${selectedRunIds.length} candidate run(s); ${failed} failed.`,
    );
    return failed === 0 ? 0 : 1;
  }
  const projectSource = selectedRunIds[0] === defaultProjectSource.candidateRunId
    ? defaultProjectSource
    : await readLocalProjectSource(sourceArg, { runId: selectedRunIds[0] });
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
  const executionFingerprint = localRunExecutionFingerprint(projectSource);
  const sourceCandidateFingerprint = localCandidateFingerprint(projectSource);
  const explicitCandidateId = readOptionalCandidateFlag(parsed);
  const existingSourceCandidate = snapshot.candidates.find((candidate) =>
    candidate.benchmarkFingerprint === benchmarkFingerprint &&
    candidate.candidateFingerprint === sourceCandidateFingerprint
  );
  const candidateId = explicitCandidateId ?? existingSourceCandidate?.id ?? `candidate_${sourceCandidateFingerprint.slice(0, 12)}`;
  const existingCandidate = snapshot.candidates.find((candidate) => candidate.id === candidateId);
  const activeCandidateIdBeforeEval = snapshot.activeId;
  const selectedCandidateRunId = projectSource.spec.candidate.selectedRunId;
  const files = filterCandidateSourceFiles(
    existingCandidate
      ? readLocalCandidateFiles(snapshot, candidateId)
      : normalizeSurfaceFiles(projectSource.candidateFiles),
  );
  const evaluationWork = parsed.flags.rerun !== true
    ? await resolveLocalEvaluationWork(workspace, snapshot, {
        benchmarkFingerprint,
        candidateId,
        candidateFingerprint: existingCandidate?.candidateFingerprint ?? sourceCandidateFingerprint,
        candidateRunId: selectedCandidateRunId,
        executionFingerprint,
        samples,
        caseIds,
      })
    : null;
  const reusableEvaluation = evaluationWork?.reusableEvaluation ?? null;
  if (reusableEvaluation) {
    const result = {
      ok: true,
      reused: true,
      runId: reusableEvaluation.runId,
      evaluation: reusableEvaluation,
      evaluationId: reusableEvaluation.id,
      candidateId,
      completedJobCount: 0,
      failedJobCount: 0,
      localView: localDevViewHint(workspace, reusableEvaluation.runId),
    };
    writeOutput(
      result,
      parsed,
      io,
      () => `Reused evaluation ${reusableEvaluation.id}. Use --rerun to intentionally run it again.`,
    );
    return 0;
  }
  const selectedPairs = evaluationWork?.missingPairs.length
    ? evaluationWork.missingPairs
    : allCaseSamplePairs(caseIds, samples);
  const runId = `eval_local_${Date.now().toString(36)}`;
  const evaluatedCandidateId = candidateId;
  const startedAt = new Date().toISOString();
  const runStartedEvent = createLocalEvent("run_started", startedAt, {
    runId,
    candidateId: evaluatedCandidateId,
    detail: { samples, strategy: "direct" },
  });
  const runningRun: RunSummary = {
    id: runId,
    workflow: "eval",
    benchmarkFingerprint,
    status: "running",
    candidateId: evaluatedCandidateId,
    candidateRunId: projectSource.spec.candidate.selectedRunId,
    candidateRunName: projectSource.spec.candidate.selectedRunName,
    startedAt,
    improver: "none",
    engineRun: spec.engineRun.use,
    strategy: "direct",
    budget: 1,
    repairBudget: 0,
    attemptsRequested: 1,
    attemptsExecuted: 0,
    samples,
    executionFingerprint,
    activeCandidateId: activeCandidateIdBeforeEval,
    outputCandidateId: evaluatedCandidateId,
  };
  snapshot = upsertLocalRun(snapshot, runningRun, [runStartedEvent]);
  await saveLocalArchive(workspace, snapshot);
  try {
  const baseline = createRuntimeBaselineCandidateJob({
    ownerUserId: "local",
    projectId: "local",
    runId,
    candidateId: evaluatedCandidateId,
    attemptIndex: 0,
    files,
    now: startedAt,
    baseId: null,
  });
  const attemptJobs = planWorkbenchExecutionJobsForPurpose({
    ownerUserId: "local",
    projectId: "local",
    runId,
    candidateId: evaluatedCandidateId,
    attemptIndex: 0,
    samples,
    now: startedAt,
    caseIds: orderedCaseIdsForPairs(caseIds, selectedPairs),
    sampleIndexesByCase: sampleIndexesByCase(selectedPairs),
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
  const materializationJobs = [
    ...(evaluationWork?.priorAttemptJobs ?? []),
    ...dagJobs,
  ];
  const currentRunJobs = dagJobs.filter((job) => job.runId === runId);
  const currentRunCompletedJobCount = currentRunJobs.filter((job) => job.status === "succeeded").length;
  const currentRunFailedJobCount = currentRunJobs.filter((job) => job.status === "failed").length;
  const materialized = materializeWorkbenchRunResult({
    runId,
    benchmarkFingerprint,
    sourceYaml: projectSource.specSource,
    benchmarkSourceFiles: authoredBenchmarkSourceFiles(projectSource),
    candidateFingerprint: existingCandidate?.candidateFingerprint ?? sourceCandidateFingerprint,
    ...(!existingCandidate || existingCandidate.candidateFingerprint === sourceCandidateFingerprint
      ? { candidateSourceFiles: authoredCandidateSourceFiles(projectSource) }
      : {}),
    startedAt,
    spec,
    jobs: materializationJobs,
    previousCandidate: existingCandidate ?? null,
    existingCandidateCount: snapshot.candidates.length,
  });
  for (const candidateRecord of materialized.candidates.map(localCandidateRecord)) {
    snapshot = upsertLocalCandidate(
      snapshot,
      candidateRecord,
      materialized.candidateFiles[candidateRecord.id] ?? [],
    );
  }
  if (materialized.activeCandidateId) {
    snapshot = setLocalActive(snapshot, materialized.activeCandidateId);
  }
  for (const evaluation of materialized.evaluations) {
    snapshot = upsertLocalEvaluation(snapshot, evaluation);
  }
  const activeCandidateId = activeCandidateIdBeforeEval ?? materialized.activeCandidateId ?? null;
  const finishedAt = new Date().toISOString();
  if (activeCandidateId) {
    snapshot = setLocalActive(snapshot, activeCandidateId);
  }
  const runFinishedEvent = createLocalEvent("run_finished", finishedAt, {
    runId,
    candidateId: evaluatedCandidateId,
    detail: {
      outcome: currentRunFailedJobCount > 0 ? "error" : "ok",
      attemptsExecuted: 1,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    },
  });
  snapshot = upsertLocalRun(snapshot, {
    id: runId,
    workflow: "eval",
    benchmarkFingerprint,
    status: "finished",
    candidateId: evaluatedCandidateId,
    candidateRunId: projectSource.spec.candidate.selectedRunId,
    candidateRunName: projectSource.spec.candidate.selectedRunName,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    improver: "none",
    engineRun: spec.engineRun.use,
    strategy: "direct",
    budget: 1,
    repairBudget: 0,
    attemptsRequested: 1,
    attemptsExecuted: 1,
    samples,
    executionFingerprint,
    stoppedReason: "completed",
    outcome: currentRunFailedJobCount > 0 ? "error" : "ok",
    activeCandidateId,
    outputCandidateId: evaluatedCandidateId,
  }, [runFinishedEvent]);
  await saveLocalJobs(workspace, currentRunJobs);
  await saveLocalArchive(workspace, snapshot);
  const evaluation = materialized.evaluations[0] ?? null;
  const result = {
    ok: currentRunFailedJobCount === 0,
    runId,
    evaluation,
    evaluationId: evaluation?.id ?? null,
    candidateId: evaluatedCandidateId,
    activeCandidateId,
    completedJobCount: currentRunCompletedJobCount,
    failedJobCount: currentRunFailedJobCount,
    localView: localDevViewHint(workspace, runId),
  };
  writeOutput(
    result,
    parsed,
    io,
    ({ evaluationId, candidateId }) =>
      `Evaluation ${evaluationId ?? runId} finished for candidate ${candidateId}.\nOpen local view: ${result.localView.command}\n${result.localView.note}`,
  );
  return currentRunFailedJobCount === 0 ? 0 : 1;
  } catch (error) {
    await markLocalRunFailed({
      workspace,
      run: runningRun,
      startedAt,
      error,
    }).catch(() => undefined);
    throw error;
  }
}

async function resolveLocalEvaluationWork(
  workspace: string,
  snapshot: {
    evaluations: readonly EvaluationScorecard[];
    runs: readonly RunSummary[];
  },
  target: {
    benchmarkFingerprint: string;
    candidateId: string;
    candidateFingerprint: string;
    candidateRunId: string;
    executionFingerprint: string;
    samples: number;
    caseIds: readonly string[];
  },
): Promise<{
  reusableEvaluation: EvaluationScorecard | null;
  missingPairs: CaseSamplePair[];
  priorAttemptJobs: RemoteWorkbenchJob[];
} | null> {
  const runById = new Map(snapshot.runs.map((run) => [run.id, run]));
  const matchingEvaluations = snapshot.evaluations.filter((evaluation) => {
    const run = runById.get(evaluation.runId);
    return evaluation.benchmarkFingerprint === target.benchmarkFingerprint &&
      evaluation.candidateId === target.candidateId &&
      evaluation.candidateFingerprint === target.candidateFingerprint &&
      evaluation.candidateRunId === target.candidateRunId &&
      run?.executionFingerprint === target.executionFingerprint;
  });
  const reusableEvaluation = matchingEvaluations
    .filter((evaluation) =>
      evaluation.status === "completed" &&
      evaluation.errorSampleCount === 0 &&
      evaluation.completedSampleCount >= target.samples
    )
    .sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.id.localeCompare(left.id),
    )[0] ?? null;
  if (reusableEvaluation) {
    return {
      reusableEvaluation,
      missingPairs: [],
      priorAttemptJobs: [],
    };
  }
  const matchingRunIds = new Set(matchingEvaluations.map((evaluation) => evaluation.runId));
  if (matchingRunIds.size === 0) {
    return null;
  }
  const allPairs = allCaseSamplePairs(target.caseIds, target.samples);
  const desiredKeys = new Set(allPairs.map(caseSamplePairKey));
  const previousJobs = await readLocalJobs(workspace);
  const priorAttemptJobsByPair = latestCompletedAttemptJobsByPair(
    previousJobs.filter((job) =>
      matchingRunIds.has(job.runId) &&
      job.candidateId === target.candidateId
    ),
    desiredKeys,
  );
  const missingPairs = allPairs.filter((pair) => !priorAttemptJobsByPair.has(caseSamplePairKey(pair)));
  if (missingPairs.length === allPairs.length) {
    return null;
  }
  return {
    reusableEvaluation: null,
    missingPairs,
    priorAttemptJobs: [...priorAttemptJobsByPair.values()],
  };
}

async function markLocalRunFailed(args: {
  workspace: string;
  run: RunSummary;
  startedAt: string;
  error: unknown;
}): Promise<void> {
  const latest = await loadLocalArchive(args.workspace);
  const current = latest.runs.find((run) => run.id === args.run.id);
  if (current?.status === "finished") {
    return;
  }
  const finishedAt = new Date().toISOString();
  const message = errorMessage(args.error);
  const failedRun: RunSummary = {
    ...args.run,
    status: "finished",
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(args.startedAt)),
    outcome: "error",
    error: message,
  };
  await saveLocalArchive(
    args.workspace,
    upsertLocalRun(latest, failedRun, [
      createLocalEvent("run_finished", finishedAt, {
        runId: args.run.id,
        candidateId: args.run.candidateId ?? undefined,
        detail: {
          outcome: "error",
          error: message,
          attemptsExecuted: failedRun.attemptsExecuted,
          durationMs: failedRun.durationMs ?? null,
        },
      }),
    ]),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface CaseSamplePair {
  caseId: string;
  sampleIndex: number;
}

function allCaseSamplePairs(
  caseIds: readonly string[],
  samples: number,
): CaseSamplePair[] {
  return caseIds.flatMap((caseId) =>
    Array.from({ length: samples }, (_, sampleIndex) => ({
      caseId,
      sampleIndex,
    })),
  );
}

function orderedCaseIdsForPairs(
  caseIds: readonly string[],
  pairs: readonly CaseSamplePair[],
): string[] {
  const selected = new Set(pairs.map((pair) => pair.caseId));
  return caseIds.filter((caseId) => selected.has(caseId));
}

function sampleIndexesByCase(
  pairs: readonly CaseSamplePair[],
): Map<string, number[]> {
  const byCase = new Map<string, number[]>();
  for (const pair of pairs) {
    byCase.set(pair.caseId, [...(byCase.get(pair.caseId) ?? []), pair.sampleIndex]);
  }
  for (const [caseId, indexes] of byCase.entries()) {
    byCase.set(caseId, [...new Set(indexes)].sort((left, right) => left - right));
  }
  return byCase;
}

function latestCompletedAttemptJobsByPair<T extends {
  id: string;
  status: string;
  input?: Json;
  finishedAt?: string;
  updatedAt?: string;
  startedAt?: string;
  createdAt?: string;
}>(
  jobs: readonly T[],
  desiredKeys: ReadonlySet<string>,
): Map<string, T> {
  const byPair = new Map<string, T>();
  for (const job of jobs) {
    if (job.status !== "succeeded" || executionPurposeFromJobInput(job.input) !== "attempt") {
      continue;
    }
    const pair = caseSamplePairFromJob(job);
    if (!pair) {
      continue;
    }
    const key = caseSamplePairKey(pair);
    if (!desiredKeys.has(key)) {
      continue;
    }
    const previous = byPair.get(key);
    if (!previous || compareJobRecency(job, previous) > 0) {
      byPair.set(key, job);
    }
  }
  return byPair;
}

function caseSamplePairFromJob(job: { input?: Json; caseId?: string; sampleIndex?: number }): CaseSamplePair | null {
  if (job.caseId && Number.isSafeInteger(job.sampleIndex) && job.sampleIndex! >= 0) {
    return { caseId: job.caseId, sampleIndex: job.sampleIndex! };
  }
  const input = readRecord(job.input);
  const execution = readRecord(input?.execution);
  const metadata = readRecord(execution?.metadata);
  const caseId = stringValue(input?.caseId) ?? stringValue(metadata?.caseId);
  const sampleIndex = integerValue(input?.sampleIndex) ?? integerValue(metadata?.sampleIndex);
  return caseId && sampleIndex !== null
    ? { caseId, sampleIndex }
    : null;
}

function executionPurposeFromJobInput(inputValue: unknown): string | null {
  const input = readRecord(inputValue);
  const execution = readRecord(input?.execution);
  return stringValue(execution?.purpose);
}

function caseSamplePairKey(pair: CaseSamplePair): string {
  return `${pair.caseId}\0${pair.sampleIndex}`;
}

function compareJobRecency(
  left: { finishedAt?: string; updatedAt?: string; startedAt?: string; createdAt?: string; id: string },
  right: { finishedAt?: string; updatedAt?: string; startedAt?: string; createdAt?: string; id: string },
): number {
  return jobRecencyTimestamp(left).localeCompare(jobRecencyTimestamp(right)) ||
    left.id.localeCompare(right.id);
}

function jobRecencyTimestamp(
  job: { finishedAt?: string; updatedAt?: string; startedAt?: string; createdAt?: string },
): string {
  return job.finishedAt ?? job.updatedAt ?? job.startedAt ?? job.createdAt ?? "";
}

function findReusableLocalImproveRun(
  runs: readonly RunSummary[],
  target: {
    benchmarkFingerprint: string;
    candidateId: string;
    candidateRunId: string;
    executionFingerprint: string;
    budget: number;
    samples: number;
  },
): RunSummary | null {
  return runs
    .filter((run) =>
      run.workflow === "improve" &&
      run.benchmarkFingerprint === target.benchmarkFingerprint &&
      run.candidateId === target.candidateId &&
      run.candidateRunId === target.candidateRunId &&
      run.executionFingerprint === target.executionFingerprint &&
      run.budget === target.budget &&
      run.samples === target.samples &&
      run.status === "finished" &&
      run.outcome === "ok" &&
      Boolean(run.outputCandidateId)
    )
    .sort((left, right) =>
      (right.finishedAt ?? right.startedAt).localeCompare(left.finishedAt ?? left.startedAt) ||
      right.id.localeCompare(left.id),
    )[0] ?? null;
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
      candidateId: string;
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
    return new URL("candidates", baseUrl).toString();
  }
  const params = new URLSearchParams({ evaluation: evaluation.id });
  return new URL(
    `candidates/${encodeURIComponent(evaluation.candidateId)}?${params.toString()}`,
    baseUrl,
  ).toString();
}

async function readLocalBenchmarkFingerprint(workspace: string): Promise<string> {
  return localBenchmarkFingerprint(await readLocalProjectSource(workspace));
}

function localRunExecutionFingerprint(projectSource: LocalProjectSource): string {
  return workbenchRunExecutionFingerprint({
    sourceYaml: projectSource.specSource,
    adapterFiles: normalizeSurfaceFiles(projectSource.adapterFiles),
  });
}

function authoredCandidateSourceFiles(projectSource: LocalProjectSource): SurfaceSnapshotFile[] {
  return [{
    path: path.relative(projectSource.dir, projectSource.candidateSpecPath).split(path.sep).join("/"),
    kind: "text",
    encoding: "utf8",
    content: projectSource.candidateSource,
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
): Promise<RemoteWorkbenchJob> {
  return await executeWorkbenchExecutionJob(args, {
    sandboxBackend: DOCKER_SANDBOX_BACKEND,
    loadLocalAdapterAuthProfiles: true,
  });
}

async function executeLocalDevelopmentDag(args: {
  jobs: readonly RemoteWorkbenchJob[];
  spec: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>;
  adapterManifests: readonly ResolvedWorkbenchAdapter["manifest"][];
  adapterFiles?: readonly SurfaceSnapshotFile[];
  baseFiles: readonly SurfaceSnapshotFile[];
  engineResolveFiles: readonly SurfaceSnapshotFile[];
  engineCases: WorkbenchExecutionRuntimeInput["engineCases"];
  traceFiles?: readonly SurfaceSnapshotFile[];
  capacity: WorkbenchExecutionDagCapacity;
}): Promise<RemoteWorkbenchJob[]> {
  const completedById = new Map(
    args.jobs
      .filter(isTerminalLocalJob)
      .map((job) => [job.id, job] as const),
  );
  const result = await runWorkbenchExecutionDag({
    jobs: args.jobs,
    capacity: args.capacity,
    sandboxBackend: DOCKER_SANDBOX_BACKEND,
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

function isTerminalLocalJob(job: RemoteWorkbenchJob): boolean {
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
  rejectUnknownFlags(parsed, new Set(["dir", "candidate", "dry-run", "yes", "json"]));
  const workspace = resolveDir(parsed);
  const spec = await readLocalSpecIfValid(workspace);
  if (!spec) {
    throw new UsageError("restore requires a valid Workbench project.");
  }
  const candidateRoot = spec.candidate.files.path;
  const snapshot = await loadLocalArchive(workspace);
  const candidateId = readCandidateIdFlag(parsed, snapshot);
  const files = readLocalCandidateFiles(snapshot, candidateId);
  if (parsed.flags["dry-run"] === true) {
    writeOutput(
      { ok: true, candidateId: candidateId, fileCount: files.length },
      parsed,
      io,
      () => `Restore would write ${files.length} file(s) from ${candidateId}.`,
    );
    return 0;
  }
  if (parsed.flags.yes !== true) {
    throw new UsageError(
      "restore requires --dry-run to preview or --yes to apply source directory changes.",
    );
  }
  const changedPaths = await materializeCandidateRoot(
    workspace,
    candidateRoot,
    files,
  );
  const next = setLocalActive(snapshot, candidateId);
  await saveLocalArchive(workspace, next);
  writeOutput(
    { ok: true, activeCandidateId: candidateId, changedPaths },
    parsed,
    io,
    () => `Restored ${candidateId} to ${candidateRoot}.`,
  );
  return 0;
}

function localInspectionFromParsed(parsed: ParsedArgs): WorkbenchInspection {
  return createLocalWorkbenchInspection({ workspace: resolveDir(parsed) });
}

async function localCandidateList(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  const inspection = localInspectionFromParsed(parsed);
  const snapshot = await inspection.snapshot();
  const candidates = await Promise.all(
    snapshot.summaries.map((candidate: { id: string }) => inspection.candidate({ id: candidate.id })),
  );
  writeOutput(
    candidates,
    parsed,
    io,
    (candidates) =>
      candidates
        .map(
          (candidate: CandidateRecord) =>
            `${candidate.id}\t${candidate.status}\tevaluation ${formatCandidateEvaluationScore(candidate)}${snapshot.activeId === candidate.id ? "\tactive" : ""}`,
        )
        .join("\n") || "No candidates.",
  );
  return 0;
}

async function localCandidateShow(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "candidate", "json"]));
  const inspection = localInspectionFromParsed(parsed);
  const snapshot = await inspection.snapshot();
  const candidateId = readCandidateIdFlag(parsed, snapshot);
  const candidate = await inspection.candidate({ id: candidateId });
  writeOutput(
    candidate,
    parsed,
    io,
    (record) =>
      [
        `${record.id}\t${record.status}`,
        `benchmark\t${record.benchmarkFingerprint}`,
        `candidate\t${record.candidateFingerprint}`,
        `evaluation\t${formatCandidateEvaluationSummary(record)}`,
        ...(record.baseId ? [`base\t${record.baseId}`] : []),
      ].join("\n"),
  );
  return 0;
}

async function localCandidateFiles(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "candidate", "json"]));
  const inspection = localInspectionFromParsed(parsed);
  const snapshot = await inspection.snapshot();
  const candidateId = readCandidateIdFlag(parsed, snapshot);
  const files = await inspection.candidateFiles({ id: candidateId });
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

async function localCandidatePreview(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "candidate", "path", "output", "view", "json"]));
  const inspection = localInspectionFromParsed(parsed);
  const snapshot = await inspection.snapshot();
  const candidateId = readCandidateIdFlag(parsed, snapshot);
  const preview = await inspection.candidatePreview({
    id: candidateId,
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
  const snapshot = await localInspectionFromParsed(parsed).snapshot();
  writeOutput(
    snapshot.runs,
    parsed,
    io,
    (runs) =>
      runs
        .map((run: RunSummary) =>
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
  rejectUnknownFlags(parsed, new Set(["dir", "jobs", "failures", "json"]));
  const runId = parsed.positionals[0];
  if (!runId) {
    throw new UsageError("workbench runs show requires RUN_ID.");
  }
  const inspection = localInspectionFromParsed(parsed);
  const detail = await inspection.run({
    id: runId,
    includeJobs: parsed.flags.jobs === true || parsed.flags.failures === true,
  });
  const diagnosis = parsed.flags.failures === true
    ? await inspection.diagnose({ targetId: runId })
    : null;
  writeOutput(
    parsed.flags.failures === true
      ? { ...detail, diagnosis }
      : detail,
    parsed,
    io,
    (record) => {
      const run = record.run;
      const jobs = "jobs" in record && Array.isArray(record.jobs)
        ? record.jobs
        : [];
      const failures = "diagnosis" in record && record.diagnosis
        ? record.diagnosis.failures
        : [];
      return [
        `${run.id}\t${run.workflow}\t${run.status}`,
        `outcome\t${run.outcome ?? "pending"}`,
        `started\t${run.startedAt}`,
        ...(run.finishedAt ? [`finished\t${run.finishedAt}`] : []),
        `attempts\t${run.attemptsExecuted ?? 0}/${run.attemptsRequested ?? 0}`,
        `samples\t${run.samples ?? 0}`,
        ...(jobs.length > 0
          ? [
              "jobs",
              ...jobs.map((job) =>
                `${job.id}\t${job.kind}\t${job.status}${job.error ? `\t${job.error}` : ""}`
              ),
            ]
          : []),
        ...(failures.length > 0
          ? [
              "failures",
              ...failures.map(formatFailureLine),
            ]
          : []),
      ].join("\n");
    },
  );
  return 0;
}

async function localEvaluationList(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  const comparison = await localInspectionFromParsed(parsed).evaluations();
  writeOutput(
    comparison,
    parsed,
    io,
    (record) =>
      record.rows
        .map((row: {
          evaluationId: string;
          status: string;
          score: number | null;
          candidateLabel: string;
          configurationLabel: string;
          runId: string;
        }) =>
          `${row.evaluationId}\t${row.status}\t${formatNullableMetric(row.score)}\t${row.candidateLabel}\t${row.configurationLabel}\t${row.runId}`
        )
        .join("\n") || "No evaluations.",
  );
  return 0;
}

async function localEvaluationShow(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  const evaluationId = parsed.positionals[0];
  if (!evaluationId) {
    throw new UsageError("workbench evaluations show requires EVALUATION_ID.");
  }
  const evaluation = await localInspectionFromParsed(parsed).evaluation({ id: evaluationId });
  writeOutput(
    evaluation,
    parsed,
    io,
    (record) =>
      [
        `${record.id}\t${record.status}`,
        `candidate\t${record.candidateName ?? record.candidateId}`,
        `run\t${record.runId}`,
        `samples\t${record.completedSampleCount}/${record.sampleCount}`,
        `errors\t${record.errorSampleCount}`,
        `score\t${formatNullableMetric(record.metrics?.score?.mean ?? null)}`,
        ...(record.error ? [`error\t${record.error}`] : []),
        ...(record.evaluation.cases?.length
          ? [
              "cases",
              ...record.evaluation.cases.map((entry: {
                id: string;
                status?: string;
                metrics?: { score?: { mean?: number | null } };
              }) =>
                `${entry.id}\t${entry.status ?? "unknown"}\t${formatNullableMetric(entry.metrics?.score?.mean ?? null)}`
              ),
            ]
          : []),
      ].join("\n"),
  );
  return 0;
}

async function localExecutionTrace(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "run", "job", "json"]));
  const runId = requireFlag(parsed, "run");
  const jobId = requireFlag(parsed, "job");
  const detail = await localInspectionFromParsed(parsed).executionTrace({ runId, jobId });
  writeOutput(
    detail,
    parsed,
    io,
    (record) =>
      record.executions
        .map((execution: {
          id: string;
          kind: string;
          status: string;
          jobIds: string[];
          sessions: unknown[];
          trace: {
            spans: unknown[];
            events: unknown[];
            summaries: unknown[];
          };
        }) =>
          [
            `${execution.id}\t${execution.kind}\t${execution.status}`,
            `jobs\t${execution.jobIds.join(",")}`,
            `sessions\t${execution.sessions.length}`,
            `spans\t${execution.trace.spans.length}`,
            `events\t${execution.trace.events.length}`,
            `summaries\t${execution.trace.summaries.length}`,
          ].join("\n")
        )
        .join("\n\n") || "No execution trace.",
  );
  return 0;
}

async function localDiagnose(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "json"]));
  rejectUnexpectedPositionals(parsed, "workbench diagnose", 1);
  const diagnosis = await localInspectionFromParsed(parsed).diagnose({ targetId: parsed.positionals[0] ?? null });
  writeOutput(
    diagnosis,
    parsed,
    io,
    (record) =>
      record.failures.length > 0
        ? record.failures.map(formatFailureLine).join("\n")
        : "No failures.",
  );
  return 0;
}

async function runAuthCommand(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  return await runSubCommand("auth", AUTH_COMMAND_HANDLERS, argv, io);
}

async function runAdaptersCommand(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  return await runSubCommand("adapters", ADAPTERS_COMMAND_HANDLERS, argv, io);
}

async function runTracesCommand(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  return await runSubCommand("traces", TRACES_COMMAND_HANDLERS, argv, io);
}

async function runSubCommand(
  group: string,
  handlers: Record<string, CliCommandHandler>,
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const command = argv[0] ?? "";
  const handler = handlers[command];
  if (!handler) {
    throw new UsageError(`Unknown command: ${group} ${argv.join(" ")}`);
  }
  return await handler(argv.slice(1), io);
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
    "  candidate.run: {}",
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
const operation = request.operation || "candidate.run";
const resultPath = process.env.WORKBENCH_RESULT || request.paths?.result || path.join(outputRoot, "workbench-result.json");

let value;
if (operation === "candidate.run") {
  const task = request.context?.case?.prompt || "No case prompt was provided.";
  fs.writeFileSync(path.join(outputRoot, "adapter-output.txt"), [
    "adapter: ${id}",
    "task:",
    task,
    "",
  ].join("\\n"));
} else {
  console.error("${id} only implements candidate.run.");
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
  const config = await loadConfig();
  const baseUrl = selectWorkbenchBaseUrl({
    explicitBaseUrl: asOptionalString(parsed.flags["base-url"]),
    configBaseUrl: config.baseUrl,
  });
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
  const baseUrl = selectWorkbenchBaseUrl({ configBaseUrl: config.baseUrl });
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
  const remoteAuth = profileStatus.authenticated
    ? await readRemoteAdapterAuthStatuses().catch((error: unknown) => ({
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
    remoteAuth.adapters,
  ).catch(() => []);
  const result = {
    ok: true,
    workbench: {
      baseUrl,
      authenticated: profileStatus.authenticated,
      username: profileStatus.profile?.username ?? null,
    },
    adapterStatuses,
    remoteAuth,
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
              `${adapter.adapter}${adapter.profile !== "default" ? ` profile ${adapter.profile}` : ""}: local ${adapter.local.status}${adapter.local.method ? ` (${adapter.local.method})` : ""}${adapter.local.reason ? ` (${adapter.local.reason})` : ""}, remote ${adapter.remote.status}${adapter.remote.method ? ` (${adapter.remote.method})` : ""}${adapter.remote.reason ? ` (${adapter.remote.reason})` : ""}`
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
  remoteAdapters: RemoteAdapterAuthStatus[],
): Promise<Array<{
  adapter: string;
  slot?: string;
  profile: string;
  local: { status: string; method?: string; reason?: string };
  remote: { status: string; method?: string; reason?: string };
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
  const remoteAdapterStatusMap = new Map(remoteAdapters.map((status) => [
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
    const remoteAdapterStatus = remoteAdapterStatusMap.get(adapterAuthStatusKey(
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
      remote: remoteAdapterStatus
        ? {
            status: remoteAdapterStatus.status,
            ...(remoteAdapterStatus.method ? { method: remoteAdapterStatus.method } : {}),
            ...(remoteAdapterStatus.reason ? { reason: remoteAdapterStatus.reason } : {}),
          }
        : { status: "disconnected" },
    };
  });
}

interface RemoteAdapterAuthStatus {
  adapterId: string;
  slot?: string;
  profile: string;
  status: string;
  version?: number;
  method?: string;
  updatedAt?: string;
  reason?: string;
}

async function readRemoteAdapterAuthStatuses(): Promise<{
  adapters: RemoteAdapterAuthStatus[];
}> {
  const adapterResponse = await apiRequest<{ adapters?: RemoteAdapterAuthStatus[] }>(
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
      `Adapter ${target.adapterId} is not used by this benchmark source. Add it to the benchmark or candidate YAML before connecting auth.`,
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
  rejectUnknownFlags(parsed, new Set(["dir", "visibility", "dry-run", "json"]));
  const dir = resolveSourceDir(parsed);
  const source = await readLocalProjectSource(dir);
  const origin = await readWorkbenchOrigin(dir);
  const baseUrl = await effectiveOriginBaseUrl(origin?.baseUrl);
  const visibility = readOptionalBenchmarkVisibility(parsed.flags.visibility);
  const createVisibility = visibility ?? "public";
  const dryRun = parsed.flags["dry-run"] === true;
  const runtime = await exportLocalRuntimeBundle(dir, {
    currentBenchmarkFingerprint: localBenchmarkFingerprint(source),
  });
  const localRuntimeFingerprint = workbenchRuntimeBundleFingerprint(runtime);
  const state = localProjectState({
    source,
    runtime,
    origin,
    visibility: createVisibility,
  });
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
          visibility: createVisibility,
          sourceFileCount: sourceFileCount(source),
          runtime: runtimeBundleStats(runtime),
          sourceFingerprint: state.source.fingerprint,
          runtimeFingerprint: localRuntimeFingerprint,
        },
        parsed,
        io,
        () => `Would push benchmark ${source.spec.name}.`,
      );
      return 0;
    }
    const { project, origin: nextOrigin, result } = await createRemoteBenchmarkFromState({
      baseUrl,
      dir,
      state,
    });
    writeOutput(
      {
        ok: true,
        action: "create",
        benchmark: project,
        visibility: project.visibility ?? createVisibility,
        origin: nextOrigin,
        source: result.source,
        runtime: result.runtime.stats,
        urls: buildWorkbenchResourceUrls({
          baseUrl,
          projectId: project.id,
          ...originRemoteUrlParts(nextOrigin),
        }),
      },
      parsed,
      io,
      (record) => {
        const value = record as { origin: WorkbenchOrigin; urls: WorkbenchResourceUrls };
        return [
          `Pushed ${value.origin.remote} (${value.origin.projectId}).`,
          `Open benchmark: ${value.urls.benchmark}`,
        ].join("\n");
      },
    );
    return 0;
  }

  const projectId = origin.projectId;
  if (!projectId) {
    throw new UsageError("Missing remote benchmark. Run workbench push from a source directory.");
  }
  if (dryRun) {
    const remoteProject = await verifyLinkedPushDryRunTarget({
      baseUrl,
      origin,
      projectId,
    });
    writeOutput(
      {
        ok: true,
        dryRun: true,
        action: "update",
        dir,
        baseUrl,
        benchmarkId: projectId,
        remote: origin.remote,
        benchmark: remoteProjectSummaryForOutput(remoteProject),
        benchmarkName: source.spec.name,
        visibility: visibility ?? "unchanged",
        sourceFileCount: sourceFileCount(source),
        runtime: runtimeBundleStats(runtime),
        sourceFingerprint: state.source.fingerprint,
        runtimeFingerprint: localRuntimeFingerprint,
      },
      parsed,
      io,
      () => `Would push ${sourceFileCount(source)} source file(s) and runtime history to ${origin.remote}.`,
    );
    return 0;
  }
  const response = await apiRequest<WorkbenchProjectStateImportResult>(
    projectApiPath(projectId, "/state"),
    {
      method: "PUT",
      body: state,
    },
    baseUrl,
  );
  const responseProject = remoteProjectSummaryFromState(response.state);
  const publishedProject = await applyRequestedProjectVisibility({
    baseUrl,
    projectId: responseProject.id,
    responseProject,
    visibility,
  });
  const applied = await acceptPushedProjectStateToLocal({
    dir,
    baseUrl,
    state: response.state,
  });
  writeOutput(
    {
      ok: true,
      action: "update",
      changed: response.changed === true,
      benchmark: publishedProject,
      visibility: visibility ?? "unchanged",
      origin: applied.origin,
      source: response.source,
      runtime: response.runtime.stats,
      urls: buildWorkbenchResourceUrls({
        baseUrl,
        projectId: publishedProject.id ?? responseProject.id,
        ...originRemoteUrlParts(applied.origin),
      }),
    },
    parsed,
    io,
    (record) => {
      const value = record as { changed: boolean; origin: WorkbenchOrigin; urls: WorkbenchResourceUrls };
      return [
        `${value.changed ? "Pushed" : "Already up to date"} ${value.origin.remote} (${value.origin.projectId}).`,
        `Open benchmark: ${value.urls.benchmark}`,
      ].join("\n");
    },
  );
  return 0;
}

async function verifyLinkedPushDryRunTarget(args: {
  baseUrl: string;
  origin: WorkbenchOrigin;
  projectId: string;
}): Promise<RemoteProjectSummary & { id: string; ownerUsername?: string; name?: string }> {
  const response = await apiRequest<{
    benchmark: RemoteProjectSummary & { id: string; ownerUsername?: string; name?: string };
  }>(projectApiPath(args.projectId), {}, args.baseUrl);
  const expected = parseOriginRemote(args.origin);
  const actualOwner = response.benchmark.ownerUsername;
  const actualProject = response.benchmark.name;
  if (actualOwner !== expected.owner || actualProject !== expected.project) {
    const actualRemote = actualOwner && actualProject
      ? `${actualOwner}/${actualProject}`
      : "unknown";
    throw new UsageError(
      `Workbench origin points to ${args.origin.remote}, but ${args.projectId} resolved to ${actualRemote}.`,
    );
  }
  return response.benchmark;
}

function remoteProjectSummaryForOutput(
  project: RemoteProjectSummary & { id?: string; ownerUsername?: string; name?: string },
): RemoteProjectSummary {
  return {
    ...(project.id ? { id: project.id } : {}),
    ...(project.ownerUsername ? { ownerUsername: project.ownerUsername } : {}),
    ...(project.name ? { name: project.name } : {}),
    ...(project.visibility ? { visibility: project.visibility } : {}),
    ...(project.activeCandidateId !== undefined ? { activeCandidateId: project.activeCandidateId } : {}),
    ...(typeof project.starCount === "number" ? { starCount: project.starCount } : {}),
  };
}

async function createRemoteBenchmarkFromState(args: {
  baseUrl: string;
  dir: string;
  state: WorkbenchProjectState;
}): Promise<{
  project: RemoteProjectSummary & { id: string; name: string; ownerUsername?: string };
  origin: WorkbenchOrigin;
  result: WorkbenchProjectStateImportResult;
}> {
  const result = await apiRequest<WorkbenchProjectStateImportResult>(
    "/api/workbench/benchmarks/state",
    {
      method: "POST",
      body: args.state,
    },
    args.baseUrl,
  );
  const project = remoteProjectSummaryFromState(result.state);
  const applied = await acceptPushedProjectStateToLocal({
    dir: args.dir,
    baseUrl: args.baseUrl,
    state: result.state,
  });
  return { project, origin: applied.origin, result };
}

async function applyRequestedProjectVisibility(args: {
  baseUrl: string;
  projectId: string;
  responseProject: RemoteProjectSummary & { ownerUsername?: string };
  visibility?: "private" | "public";
}): Promise<RemoteProjectSummary & { ownerUsername?: string }> {
  if (args.visibility === "public") {
    return (await apiRequest<{ benchmark: RemoteProjectSummary & { ownerUsername?: string } }>(
      projectApiPath(args.projectId, "/publish"),
      { method: "PUT" },
      args.baseUrl,
    )).benchmark;
  }
  if (args.visibility === "private") {
    return (await apiRequest<{ benchmark: RemoteProjectSummary & { ownerUsername?: string } }>(
      projectApiPath(args.projectId, "/publish"),
      { method: "DELETE" },
      args.baseUrl,
    )).benchmark;
  }
  return args.responseProject;
}

function readOptionalBenchmarkVisibility(value: string | boolean | undefined): "private" | "public" | undefined {
  if (value === undefined) {
    return undefined;
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
    throw new UsageError("workbench clone accepts OWNER/BENCHMARK and an optional output directory.");
  }
  const baseUrl = await effectiveBaseUrl();
  const state = await apiRequest<WorkbenchProjectState>(
    publicProjectStateApiPath(ref),
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
        fileCount: state.source.files.length,
        runtime: projectStateRuntimeStats(state),
        sourceFingerprint: state.source.fingerprint ?? state.base.sourceFingerprint ?? null,
        runtimeFingerprint: state.base.runtimeFingerprint ?? null,
      },
      parsed,
      io,
    () => `Would clone ${formatBenchmarkRef(ref)} to ${outputDir}.`,
    );
    return 0;
  }
  const applied = await applyProjectStateToLocal({
    dir: outputDir,
    baseUrl,
    state,
  });
  writeOutput(
    {
      ok: true,
      origin: applied.origin,
      outputDir,
      files: applied.files,
      runtime: applied.runtime,
    },
    parsed,
    io,
    (record) => {
      const value = record as { origin: WorkbenchOrigin; outputDir: string; files: number };
      return `Cloned ${value.origin.remote} to ${value.outputDir} (${value.files} file(s)).`;
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
    throw new UsageError("workbench pull updates the current origin; use workbench clone OWNER/BENCHMARK DIR for a new directory.");
  }
  const dir = resolveDir(parsed);
  const origin = await requireWorkbenchOrigin(dir);
  const baseUrl = await effectiveOriginBaseUrl(origin.baseUrl);
  const remoteRef = parseOriginRemote(origin);
  const state = await apiRequest<WorkbenchProjectState>(
    publicProjectStateApiPath(remoteRef),
    {},
    baseUrl,
  );
  if (parsed.flags["dry-run"] === true) {
    writeOutput(
      {
        ok: true,
        dryRun: true,
        dir,
        fileCount: state.source.files.length,
        runtime: projectStateRuntimeStats(state),
        sourceFingerprint: state.source.fingerprint ?? state.base.sourceFingerprint ?? null,
        runtimeFingerprint: state.base.runtimeFingerprint ?? null,
      },
      parsed,
      io,
      () => `Would pull ${state.source.files.length} source file(s) and runtime history into ${dir}.`,
    );
    return 0;
  }
  const applied = await applyProjectStateToLocal({
    dir,
    baseUrl,
    state,
    origin,
    requireCleanSource: true,
  });
  writeOutput(
    {
      ok: true,
      origin: applied.origin,
      dir,
      files: applied.files,
      runtime: applied.runtime,
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

async function applyProjectStateToLocal(args: {
  dir: string;
  baseUrl: string;
  state: WorkbenchProjectState;
  origin?: WorkbenchOrigin;
  requireCleanSource?: boolean;
}): Promise<LocalProjectStateApplyResult> {
  if (args.requireCleanSource === true && args.origin) {
    await assertLocalSourceMatchesOrigin(args.dir, args.origin);
  }
  await syncSourceFiles(args.dir, args.state.source.files);
  const benchmarkFingerprint = localBenchmarkFingerprint(await readLocalProjectSource(args.dir));
  const runtimeImport = await importLocalRuntimeBundle(
    args.dir,
    args.state.runtime,
    benchmarkFingerprint,
  );
  const origin = await writeWorkbenchOriginFromState(args.dir, {
    baseUrl: args.baseUrl,
    state: args.state,
  });
  return {
    origin,
    files: args.state.source.files.length,
    runtime: runtimeImport.stats,
  };
}

async function acceptPushedProjectStateToLocal(args: {
  dir: string;
  baseUrl: string;
  state: WorkbenchProjectState;
}): Promise<{ origin: WorkbenchOrigin; runtime: WorkbenchRuntimeBundleStats }> {
  const benchmarkFingerprint = localBenchmarkFingerprint(await readLocalProjectSource(args.dir));
  const runtime = await importLocalRuntimeBundle(
    args.dir,
    args.state.runtime,
    benchmarkFingerprint,
  );
  const origin = await writeWorkbenchOriginFromState(args.dir, {
    baseUrl: args.baseUrl,
    state: args.state,
  });
  return { origin, runtime: runtime.stats };
}

interface RemoteRetryTarget {
  sourceId: string;
  sourceKind: "evaluation" | "run";
  workflow: RemoteRunWorkflow;
  request: WorkbenchRemoteRunRequest;
}

interface RemoteRunDetail {
  run: RemoteRunRecord;
  jobs: RemoteRunJobRecord[];
}

async function retryRemoteWorkflow(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set([
    "dir",
    "benchmark",
    "watch",
    "interval-ms",
    "timeout-ms",
    "json",
  ]));
  rejectUnexpectedPositionals(parsed, "workbench retry --remote", 1);
  const targetId = parsed.positionals[0];
  if (!targetId) {
    throw new UsageError("Missing required TARGET_ID.");
  }
  if (parsed.flags.watch !== true && (
    parsed.flags["interval-ms"] !== undefined ||
    parsed.flags["timeout-ms"] !== undefined
  )) {
    throw new UsageError("--interval-ms and --timeout-ms require --watch.");
  }
  const target = await resolveRemoteTarget(parsed, { requireProjectIdentity: true });
  const retryTarget = await resolveRemoteRetryTarget(target, targetId);
  const watchIntervalMs =
    parsed.flags.watch === true
      ? parsePositiveInt(parsed.flags["interval-ms"], 1000, "interval-ms")
      : undefined;
  const watchTimeoutMs =
    parsed.flags.watch === true
      ? parseOptionalPositiveInt(parsed.flags["timeout-ms"], "timeout-ms")
      : undefined;
  const response = await apiRequest<RemoteRunStartResponse>(
    projectApiPath(target.projectId, "/runs"),
    {
      method: "POST",
      body: retryTarget.request,
    },
    target.baseUrl,
  );
  const runTarget = remoteTargetForRunStartResponse(target, response);
  const startedRun = withRunUrls(runTarget, response.run);
  if (parsed.flags.watch === true) {
    if (parsed.flags.json !== true) {
      io.stdout.write(
        `${formatRemoteRunStarted(startedRun, retryTarget.workflow).trimEnd()}\n${REMOTE_WATCH_LIFECYCLE_NOTE}\n`,
      );
    }
    const watched = await watchRemoteRun({
      parsed,
      target: runTarget,
      runId: response.run.id,
      intervalMs: watchIntervalMs ?? 1000,
      timeoutMs: watchTimeoutMs,
    });
    const outputRun = withRunUrls(runTarget, await withRemoteRunFailureSummary(runTarget, watched));
    await tryImportTerminalRemoteProjectState({ target: runTarget, io });
    const result: RetryCommandResult = {
      ok: remoteRunSucceeded(watched),
      retried: {
        id: retryTarget.sourceId,
        kind: retryTarget.sourceKind,
        workflow: retryTarget.workflow,
      },
      runId: outputRun.id,
      candidateId: outputRun.outputCandidateId ?? outputRun.candidateId,
      activeCandidateId: outputRun.activeCandidateId ?? null,
      run: outputRun,
      ...(outputRun.urls ? { urls: outputRun.urls } : {}),
      ...(outputRun.failedJobCount !== undefined ? { failedJobCount: outputRun.failedJobCount } : {}),
      ...(outputRun.error ? { error: outputRun.error } : {}),
    };
    writeOutput(result, parsed, io, formatRetryCommandResult);
    return remoteRunSucceeded(watched) ? 0 : 1;
  }
  const result: RetryCommandResult = {
    ok: true,
    retried: {
      id: retryTarget.sourceId,
      kind: retryTarget.sourceKind,
      workflow: retryTarget.workflow,
    },
    runId: startedRun.id,
    candidateId: startedRun.outputCandidateId ?? startedRun.candidateId,
    activeCandidateId: startedRun.activeCandidateId ?? null,
    run: startedRun,
    ...(startedRun.urls ? { urls: startedRun.urls } : {}),
  };
  writeOutput(result, parsed, io, formatRetryCommandResult);
  return 0;
}

async function resolveRemoteRetryTarget(
  target: RemoteTarget,
  targetId: string,
): Promise<RemoteRetryTarget> {
  if (targetId.startsWith("eval_")) {
    return await resolveRemoteEvaluationRetryTarget(target, targetId);
  }
  const detail = await readRemoteRunDetail(target, targetId);
  const run = detail.run;
  if (run.status !== "finished") {
    throw new UsageError(`Run ${run.id} is ${run.status}; wait for it to finish before retrying.`);
  }
  if (!remoteRunRecordFailed(run)) {
    throw new UsageError(`Run ${run.id} did not fail; use workbench ${run.workflow ?? "eval"} --remote to intentionally run it again.`);
  }
  if (run.workflow === "eval") {
    const candidateId = remoteRunEvaluationCandidateId(run, detail.jobs);
    if (!candidateId) {
      throw new UsageError(`Run ${run.id} has no candidate id to retry.`);
    }
    return {
      sourceId: targetId,
      sourceKind: "run",
      workflow: "eval",
      request: {
        schema: "workbench.remote.run.request.v1",
        workflow: "eval",
        samples: run.samples ?? 1,
        candidateId,
        sourceYaml: remoteRetrySourceYaml(run, run.id),
        preserveActive: true,
        ...retrySampleSelectionFromJobs(detail.jobs),
      },
    };
  }
  if (run.workflow === "improve") {
    const baseCandidateId = stringValue(readRecord(run.retry)?.baseCandidateId);
    if (!baseCandidateId) {
      throw new UsageError(`Run ${run.id} is missing its base candidate id.`);
    }
    return {
      sourceId: targetId,
      sourceKind: "run",
      workflow: "improve",
      request: {
        schema: "workbench.remote.run.request.v1",
        workflow: "improve",
        samples: run.samples ?? 1,
        budget: run.budget ?? run.attemptsRequested ?? 1,
        candidateId: baseCandidateId,
        sourceYaml: remoteRetrySourceYaml(run, run.id),
        preserveActive: true,
      },
    };
  }
  throw new UsageError(`Run ${run.id} has no retryable workflow.`);
}

async function resolveRemoteEvaluationRetryTarget(
  target: RemoteTarget,
  evaluationId: string,
): Promise<RemoteRetryTarget> {
  const snapshot = await apiRequest<{
    evaluations: RetryEvaluationSummary[];
    runs: RemoteRunRecord[];
  }>(
    projectApiPath(target.projectId, "/workbench/snapshot"),
    {},
    target.baseUrl,
  );
  const evaluation = snapshot.evaluations.find((entry) => entry.id === evaluationId);
  if (!evaluation) {
    throw new UsageError(`Remote evaluation not found: ${evaluationId}`);
  }
  const run = snapshot.runs.find((entry) => entry.id === evaluation.runId) ?? null;
  if (!evaluationScorecardFailed(evaluation, run)) {
    throw new UsageError(`Evaluation ${evaluation.id} did not fail; use workbench eval --remote to intentionally run it again.`);
  }
  if (!run) {
    throw new UsageError(`Evaluation ${evaluation.id} is missing its run record.`);
  }
  const detail = await readRemoteRunDetail(target, run.id);
  const detailedRun = detail.run;
  return {
    sourceId: evaluationId,
    sourceKind: "evaluation",
    workflow: "eval",
    request: {
      schema: "workbench.remote.run.request.v1",
      workflow: "eval",
      samples: evaluation.sampleCount || detailedRun.samples || 1,
      candidateId: evaluation.candidateId,
      sourceYaml: remoteRetrySourceYaml(detailedRun, detailedRun.id),
      preserveActive: true,
      ...retrySampleSelectionFromJobs(detail.jobs),
    },
  };
}

function retrySampleSelectionFromJobs(
  jobs: readonly RemoteRunJobRecord[],
): { selectedSamples: CaseSamplePair[] } | Record<string, never> {
  const selectedSamples = uniqueCaseSamplePairs(
    jobs
      .filter((job) =>
        job.status !== "succeeded" &&
        readRunJobPurpose(job) === "attempt"
      )
      .map(caseSamplePairFromJob)
      .filter((pair): pair is CaseSamplePair => pair !== null),
  );
  return selectedSamples.length > 0
    ? { selectedSamples }
    : {};
}

function uniqueCaseSamplePairs(
  pairs: readonly CaseSamplePair[],
): CaseSamplePair[] {
  const byKey = new Map<string, CaseSamplePair>();
  for (const pair of pairs) {
    byKey.set(caseSamplePairKey(pair), pair);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.caseId.localeCompare(right.caseId) ||
      left.sampleIndex - right.sampleIndex,
  );
}

async function readRemoteRunDetail(
  target: RemoteTarget,
  runId: string,
): Promise<RemoteRunDetail> {
  return await apiRequest<RemoteRunDetail>(
    projectApiPath(target.projectId, `/runs/${encodeURIComponent(runId)}`),
    {},
    target.baseUrl,
  );
}

async function tryImportTerminalRemoteProjectState(args: {
  target: RemoteTarget;
  io: CliIo;
}): Promise<void> {
  const origin = args.target.origin;
  if (!origin || origin.projectId !== args.target.projectId) {
    return;
  }
  try {
    const state = await apiRequest<WorkbenchProjectState>(
      projectApiPath(args.target.projectId, "/state"),
      {},
      args.target.baseUrl,
    );
    await applyProjectStateToLocal({
      dir: args.target.dir,
      baseUrl: args.target.baseUrl,
      state,
      origin,
      requireCleanSource: true,
    });
  } catch (error) {
    args.io.stderr.write(
      `Remote run finished, but local project state was not updated: ${errorMessage(error)}\n`,
    );
  }
}

function remoteRetrySourceYaml(
  run: RemoteRunRecord,
  runId: string,
): string {
  const sourceYaml = stringValue(readRecord(run.retry)?.sourceYaml);
  if (!sourceYaml) {
    throw new UsageError(`Run ${runId} is missing its recorded source configuration.`);
  }
  return sourceYaml;
}

function remoteRunRecordFailed(run: RemoteRunRecord): boolean {
  return run.outcome === "error" ||
    run.outcome === "cancelled" ||
    (run.failedJobCount ?? 0) > 0 ||
    Boolean(run.error);
}

async function startRemoteWorkflow(
  workflow: RemoteRunWorkflow,
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  const allowedFlags = new Set([
    "dir",
    "benchmark",
    "runs",
    "samples",
    "rerun",
    "watch",
    "dry-run",
    "interval-ms",
    "timeout-ms",
    "json",
  ]);
  if (workflow === "eval") {
    allowedFlags.add("candidate");
  } else {
    allowedFlags.add("base");
    allowedFlags.add("budget");
  }
  rejectUnknownFlags(parsed, allowedFlags);
  if (parsed.positionals.length > 1) {
    throw new UsageError(`workbench ${workflow} --remote accepts at most one source file or directory argument.`);
  }
  const sourceArg = resolveSourceDir(parsed);
  const samples = parsePositiveInt(parsed.flags.samples, 1, "samples");
  const budget = workflow === "improve"
    ? parsePositiveInt(parsed.flags.budget, 1, "budget")
    : undefined;
  if (parsed.flags.watch !== true && (
    parsed.flags["interval-ms"] !== undefined ||
    parsed.flags["timeout-ms"] !== undefined
  )) {
    throw new UsageError("--interval-ms and --timeout-ms require --watch.");
  }
  const runsFlag = asOptionalString(parsed.flags.runs);
  const defaultProjectSource = await readLocalProjectSource(path.resolve(sourceArg));
  const selectedRunIds = workflow === "eval"
    ? resolveCandidateRunSelection(defaultProjectSource, runsFlag)
    : [singleRequestedRunId(runsFlag, `workbench ${workflow} --remote`) ?? defaultProjectSource.candidateRunId];
  if (workflow === "eval" && selectedRunIds.length > 1) {
    let failed = 0;
    const results: unknown[] = [];
    for (const runId of selectedRunIds) {
      const captured = createCapturingIo(io);
      const code = await startRemoteWorkflow(
        workflow,
        remoteWorkflowArgsForRun({
          parsed,
          sourceDir: defaultProjectSource.dir,
          runId,
        }),
        captured.io,
      );
      if (code !== 0) {
        failed += 1;
      }
      results.push(parseCapturedJson(captured.stdoutText()));
    }
    writeOutput(
      {
        ok: failed === 0,
        candidateRunIds: selectedRunIds,
        failedRunCount: failed,
        results,
      },
      parsed,
      io,
      () => `Processed ${selectedRunIds.length} remote candidate run(s); ${failed} failed.`,
    );
    return failed === 0 ? 0 : 1;
  }
  const selectedCandidateId = workflow === "eval"
    ? asOptionalString(parsed.flags.candidate)
    : asOptionalString(parsed.flags.base);
  const request: WorkbenchRemoteRunRequest =
    workflow === "improve"
      ? {
          schema: "workbench.remote.run.request.v1",
          workflow,
          budget,
          samples,
          ...(selectedCandidateId ? { candidateId: selectedCandidateId } : {}),
        }
      : {
          schema: "workbench.remote.run.request.v1",
          workflow,
          samples,
          ...(selectedCandidateId ? { candidateId: selectedCandidateId } : {}),
        };
  const projectSource = selectedRunIds[0] === defaultProjectSource.candidateRunId
    ? defaultProjectSource
    : await readLocalProjectSource(path.resolve(sourceArg), { runId: selectedRunIds[0] });
  request.sourceYaml = projectSource.specSource;
  request.adapterFiles = projectSource.adapterFiles;
  if (workflow === "eval" && !selectedCandidateId) {
    request.candidateFiles = projectSource.candidateFiles;
  }
  if (parsed.flags.rerun === true) {
    request.rerun = true;
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
    const target = await resolveRemoteDryRunTarget(parsed, { sourceDir: projectSource.dir });
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
      () => `Would start remote ${workflow} for ${target.projectRef}.`,
    );
    return 0;
  }
  const target = await resolveRemoteTarget(parsed, {
    requireProjectIdentity: true,
    sourceDir: projectSource.dir,
  });
  if (workflow === "improve") {
    request.candidateId = await ensureRemoteImproveBaseCandidate({
      parsed,
      target,
      samples: request.samples,
      candidateId: selectedCandidateId,
      sourceYaml: projectSource.specSource,
      candidateFiles: projectSource.candidateFiles,
      adapterFiles: projectSource.adapterFiles,
      intervalMs: watchIntervalMs ?? 1000,
      timeoutMs: watchTimeoutMs,
      io,
    });
  }
  const response = await apiRequest<RemoteRunStartResponse>(
    projectApiPath(target.projectId, "/runs"),
    {
      method: "POST",
      body: request,
    },
    target.baseUrl,
  );
  const runTarget = remoteTargetForRunStartResponse(target, response);
  const startedRun = withRunUrls(runTarget, response.run);
  const startedRunOutput = response.reused === true
    ? { ...startedRun, reused: true }
    : startedRun;
  if (response.reused === true && response.run.status === "finished") {
    await tryImportTerminalRemoteProjectState({ target: runTarget, io });
    writeOutput(
      {
        ok: remoteRunSucceeded(response.run),
        reused: true,
        workflow,
        runId: startedRun.id,
        ...startedRun,
      },
      parsed,
      io,
      () => `Reused remote ${workflow} ${startedRun.id}. Use --rerun to intentionally run it again.`,
    );
    return remoteRunSucceeded(response.run) ? 0 : 1;
  }
  if (parsed.flags.watch === true) {
    if (parsed.flags.json !== true) {
      io.stdout.write(
        `${formatRemoteRunStarted(startedRun, workflow).trimEnd()}\n${REMOTE_WATCH_LIFECYCLE_NOTE}\n`,
      );
    }
    const watched = await watchRemoteRun({
      parsed,
      target: runTarget,
      runId: response.run.id,
      intervalMs: watchIntervalMs ?? 1000,
      timeoutMs: watchTimeoutMs,
    });
    const outputRun = await withRemoteRunFailureSummary(runTarget, watched);
    await tryImportTerminalRemoteProjectState({ target: runTarget, io });
    writeOutput(
      withRunUrls(runTarget, outputRun),
      parsed,
      io,
      formatRemoteRunResult,
    );
    return remoteRunSucceeded(watched) ? 0 : 1;
  }
  writeOutput(startedRunOutput, parsed, io, (run) =>
    formatRemoteRunStarted(run as RemoteRunRecord, workflow).trimEnd(),
  );
  return 0;
}

async function ensureRemoteImproveBaseCandidate(args: {
  parsed: ParsedArgs;
  target: RemoteTarget;
  samples: number;
  candidateId?: string;
  sourceYaml: string;
  candidateFiles: RemoteFile[];
  adapterFiles: RemoteFile[];
  intervalMs: number;
  timeoutMs?: number;
  io: CliIo;
}): Promise<string> {
  if (args.candidateId) {
    const candidate = await readRemoteCandidateSummary(args.target, args.candidateId);
    if (!candidate) {
      throw new UsageError(
        `Base candidate ${args.candidateId} was not found for the current benchmark.`,
      );
    }
    if (remoteCandidateIsEvaluated(candidate)) {
      return args.candidateId;
    }
  } else {
    const activeCandidate = await readEvaluatedActiveRemoteCandidate(args.target);
    if (activeCandidate) {
      return activeCandidate.id;
    }
  }
  const response = await apiRequest<RemoteRunStartResponse>(
    projectApiPath(args.target.projectId, "/runs"),
    {
      method: "POST",
      body: {
        schema: "workbench.remote.run.request.v1",
        workflow: "eval",
        samples: args.samples,
        ...(args.candidateId ? { candidateId: args.candidateId } : {}),
        sourceYaml: args.sourceYaml,
        ...(args.candidateId ? {} : { candidateFiles: args.candidateFiles }),
        ...(args.adapterFiles.length > 0 ? { adapterFiles: args.adapterFiles } : {}),
      },
    },
    args.target.baseUrl,
  );
  const runTarget = remoteTargetForRunStartResponse(args.target, response);
  const watched = await watchRemoteRun({
    parsed: args.parsed,
    target: runTarget,
    runId: response.run.id,
    intervalMs: args.intervalMs,
    timeoutMs: args.timeoutMs,
  });
  if (!remoteRunSucceeded(watched)) {
    throw new UsageError(`Parent candidate eval ${watched.id} failed; improve was not started.`);
  }
  if (!watched.candidateId) {
    throw new UsageError(`Parent candidate eval ${watched.id} did not produce a candidate.`);
  }
  await tryImportTerminalRemoteProjectState({ target: runTarget, io: args.io });
  return watched.candidateId;
}

function remoteWorkflowArgsForRun(args: {
  parsed: ParsedArgs;
  sourceDir: string;
  runId: string;
}): string[] {
  const next = ["--dir", args.sourceDir, "--runs", args.runId, "--json"];
  appendStringFlag(next, "benchmark", asOptionalString(args.parsed.flags.benchmark));
  appendStringFlag(next, "candidate", asOptionalString(args.parsed.flags.candidate));
  appendStringFlag(next, "samples", asOptionalString(args.parsed.flags.samples));
  appendStringFlag(next, "interval-ms", asOptionalString(args.parsed.flags["interval-ms"]));
  appendStringFlag(next, "timeout-ms", asOptionalString(args.parsed.flags["timeout-ms"]));
  if (args.parsed.flags.watch === true) {
    next.push("--watch");
  }
  if (args.parsed.flags["dry-run"] === true) {
    next.push("--dry-run");
  }
  if (args.parsed.flags.rerun === true) {
    next.push("--rerun");
  }
  return next;
}

function appendStringFlag(args: string[], name: string, value: string | undefined): void {
  if (value !== undefined) {
    args.push(`--${name}`, value);
  }
}

interface RemoteCandidateSummary {
  id: string;
  status?: string;
  eval?: unknown;
}

async function readRemoteCandidateSummary(
  target: RemoteTarget,
  candidateId: string,
): Promise<RemoteCandidateSummary | null> {
  const response = await apiRequest<{ candidates: RemoteCandidateSummary[] }>(
    projectApiPath(target.projectId, "/candidates"),
    {},
    target.baseUrl,
  );
  return response.candidates.find((entry) => entry.id === candidateId) ?? null;
}

async function readEvaluatedActiveRemoteCandidate(
  target: RemoteTarget,
): Promise<RemoteCandidateSummary | null> {
  const response = await apiRequest<{ benchmark: RemoteProjectSummary }>(
    projectApiPath(target.projectId),
    {},
    target.baseUrl,
  );
  const activeCandidateId = response.benchmark.activeCandidateId;
  if (!activeCandidateId) {
    return null;
  }
  const candidate = await readRemoteCandidateSummary(target, activeCandidateId);
  return candidate && remoteCandidateIsEvaluated(candidate) ? candidate : null;
}

function remoteCandidateIsEvaluated(candidate: RemoteCandidateSummary): boolean {
  return candidate.status === "evaluated" || candidate.eval != null;
}

async function openWorkbench(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(argv);
  rejectUnknownFlags(parsed, new Set(["dir", "benchmark", "no-open", "json"]));
  if (parsed.positionals.length > 1) {
    throw new UsageError(
      `Unexpected argument for workbench open --remote: ${parsed.positionals.slice(1).join(" ")}`,
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
  target: RemoteTarget,
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
  return buildWorkbenchResourceUrls(target, { candidateId: ref }).candidateEvaluation!;
}

async function resolveRemoteTarget(
  parsed: ParsedArgs,
  options: { requireProjectIdentity?: boolean; sourceArg?: string; sourceDir?: string } = {},
): Promise<RemoteTarget> {
  if (options.sourceArg !== undefined && parsed.flags.dir !== undefined) {
    throw new UsageError("Use either --dir or SOURCE, not both.");
  }
  const dir = options.sourceDir
    ? path.resolve(options.sourceDir)
    : resolveDir(parsed, options.sourceArg);
  const origin = await readWorkbenchOrigin(dir);
  const explicitProject = asOptionalString(parsed.flags.benchmark);
  const baseUrl = await effectiveOriginBaseUrl(origin?.baseUrl);
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
      "Missing remote benchmark. Run workbench push, workbench clone, or pass --benchmark OWNER/BENCHMARK.",
    );
  }
  const originRemote = origin ? parseOriginRemote(origin) : null;
  return {
    projectId,
    ...(!explicitProject && originRemote ? { owner: originRemote.owner } : {}),
    ...(!explicitProject && originRemote
      ? { projectName: originRemote.project }
      : {}),
    dir,
    baseUrl,
    origin,
  };
}

async function resolveRemoteDryRunTarget(
  parsed: ParsedArgs,
  options: { sourceArg?: string; sourceDir?: string } = {},
): Promise<RemoteDryRunTarget> {
  if (options.sourceArg !== undefined && parsed.flags.dir !== undefined) {
    throw new UsageError("Use either --dir or SOURCE, not both.");
  }
  const dir = options.sourceDir
    ? path.resolve(options.sourceDir)
    : resolveDir(parsed, options.sourceArg);
  const origin = await readWorkbenchOrigin(dir);
  const explicitProject = asOptionalString(parsed.flags.benchmark);
  const baseUrl = await effectiveOriginBaseUrl(origin?.baseUrl);
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
    const originRemote = parseOriginRemote(origin);
    return {
      projectRef: origin.remote,
      projectId: origin.projectId,
      owner: originRemote.owner,
      projectName: originRemote.project,
      dir,
      baseUrl,
      origin,
    };
  }
  throw new UsageError(
    "Missing remote benchmark. Run workbench push, workbench clone, or pass --benchmark OWNER/BENCHMARK.",
  );
}

async function resolveOpenTarget(
  parsed: ParsedArgs,
): Promise<RemoteTarget & { openRef?: string }> {
  const ref = parsed.positionals[0];
  if (
    ref &&
    !ref.startsWith("run_") &&
    !ref.startsWith("candidate_")
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
    ...(await resolveRemoteTarget(parsed, { requireProjectIdentity: true })),
    ...(ref ? { openRef: ref } : {}),
  };
}

function buildWorkbenchResourceUrls(
  target: Pick<RemoteTarget, "baseUrl" | "projectId"> & { owner?: string; projectName?: string },
  refs: {
    runId?: string | null;
    candidateId?: string | null;
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
  if (refs.candidateId) {
    const evaluationId = refs.runId
      ? evaluationScorecardId(refs.runId, refs.candidateId)
      : null;
    urls.candidateEvaluation = evaluationId
      ? `${benchmark}/candidates/${encodeURIComponent(refs.candidateId)}?evaluation=${encodeURIComponent(evaluationId)}`
      : `${benchmark}/candidates/${encodeURIComponent(refs.candidateId)}`;
  }
  return urls;
}

function projectApiPath(projectRef: string, suffix = ""): string {
  return `/api/workbench/benchmarks/${encodeURIComponent(projectRef)}${suffix}`;
}

function publicProjectApiPath(ref: { owner: string; project: string }): string {
  return `/api/workbench/public/benchmarks/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.project)}`;
}

function publicProjectStateApiPath(
  ref: { owner: string; project: string },
): string {
  return `${publicProjectApiPath(ref)}/state`;
}

interface BenchmarkRef {
  owner: string;
  project: string;
}

function readRequiredBenchmarkRef(parsed: ParsedArgs): BenchmarkRef {
  const ref = parsed.positionals[0];
  if (!ref) {
    throw new UsageError("Missing required OWNER/BENCHMARK.");
  }
  return parseBenchmarkRef(ref);
}

function parseBenchmarkRef(value: string): BenchmarkRef {
  if (value.includes("@")) {
    throw new UsageError("Benchmark refs must use OWNER/BENCHMARK.");
  }
  const [owner, project, extra] = value.split("/");
  if (!owner || !project || extra !== undefined) {
    throw new UsageError("Benchmark refs must use OWNER/BENCHMARK.");
  }
  return { owner, project };
}

function formatBenchmarkRef(ref: BenchmarkRef): string {
  return `${ref.owner}/${ref.project}`;
}

async function resolveRemoteProject(
  projectRef: string,
  baseUrl: string,
): Promise<{
  id: string;
  name?: string;
  ownerUsername?: string;
}> {
  if (projectRef.includes("/")) {
    const ref = parseBenchmarkRef(projectRef);
    const response = await apiRequest<{
      benchmark: {
        id: string;
        name?: string;
        ownerUsername?: string;
      };
    }>(publicProjectApiPath(ref), {}, baseUrl);
    return response.benchmark;
  }
  const response = await apiRequest<{
    benchmark: {
      id: string;
      name?: string;
      ownerUsername?: string;
    };
  }>(projectApiPath(projectRef), {}, baseUrl);
  return response.benchmark;
}

function withRunUrls(
  target: RemoteTarget,
  run: RemoteRunRecord,
): RemoteRunRecord {
  if (!target.owner || !target.projectName) {
    return { ...run };
  }
  return {
    ...run,
    urls: buildWorkbenchResourceUrls(target, {
      runId: run.id,
      candidateId: run.outputCandidateId ?? run.candidateId,
    }),
  };
}

function remoteTargetForRunStartResponse(
  target: RemoteTarget,
  response: RemoteRunStartResponse,
): RemoteTarget {
  const projectId = response.benchmark?.id ?? response.run.projectId ?? target.projectId;
  if (projectId === target.projectId && !response.benchmark) {
    return target;
  }
  const origin = target.origin?.projectId === projectId ? target.origin : null;
  const next: RemoteTarget = {
    ...target,
    projectId,
    origin,
  };
  if (response.benchmark?.ownerUsername) {
    next.owner = response.benchmark.ownerUsername;
  } else {
    delete next.owner;
  }
  if (response.benchmark?.name) {
    next.projectName = response.benchmark.name;
  } else {
    delete next.projectName;
  }
  return next;
}

function remoteRunEvaluationCandidateId(
  run: RemoteRunRecord,
  jobs: readonly RemoteRunJobRecord[] = [],
): string | null {
  if (run.outputCandidateId) {
    return run.outputCandidateId;
  }
  const attemptCandidates = jobs
    .filter((job) => readRunJobPurpose(job) === "attempt")
    .map((job) => job.candidateId)
    .filter((candidateId): candidateId is string => Boolean(candidateId));
  return attemptCandidates.at(-1) ?? run.candidateId ?? null;
}

function localProjectState(args: {
  source: LocalProjectSource;
  runtime: WorkbenchRuntimeBundle;
  origin: WorkbenchOrigin | null;
  visibility: "private" | "public";
}): WorkbenchProjectState {
  const stateSource = localProjectStateSource(args.source);
  const runtime = runtimeBundleForProjectVisibility(args.runtime, args.visibility);
  const runtimeFingerprint = workbenchRuntimeBundleFingerprint(runtime);
  return {
    schema: "workbench.project.state.v1",
    project: {
      id: args.origin?.projectId ?? "",
      remote: args.origin?.remote ?? `local/${args.source.spec.name}`,
      ownerUsername: args.origin ? parseOriginRemote(args.origin).owner : "local",
      name: args.origin ? parseOriginRemote(args.origin).project : args.source.spec.name,
      visibility: args.visibility,
    },
    base: {
      ...(args.origin ? { sourceRevisionId: args.origin.sourceRevisionId } : {}),
      ...(args.origin ? { sourceFingerprint: args.origin.sourceFingerprint } : {}),
      runtimeFingerprint: args.origin?.runtimeFingerprint ?? runtimeFingerprint,
    },
    source: stateSource,
    runtime,
  };
}

function projectStateRuntimeStats(state: WorkbenchProjectState): WorkbenchRuntimeBundleStats {
  const activeId = workbenchRuntimeExplicitActiveId({
    candidates: state.runtime.candidates,
    runs: state.runtime.runs,
    preferredActiveId: state.runtime.activeId ?? null,
    benchmarkFingerprint: projectStateBenchmarkFingerprint(state.source),
  });
  return runtimeBundleStats({
    ...state.runtime,
    activeId,
  });
}

function localCandidateRecord(candidate: CandidateRecord): CandidateRecord {
  return {
    ...candidate,
    visibility: "private",
  };
}

function runtimeBundleForProjectVisibility(
  runtime: WorkbenchRuntimeBundle,
  visibility: "private" | "public",
): WorkbenchRuntimeBundle {
  return {
    ...runtime,
    candidates: runtime.candidates.map((candidate: CandidateRecord) => ({
      ...candidate,
      visibility,
    })),
  };
}

function localProjectStateSource(source: LocalProjectSource): WorkbenchProjectStateSource {
  const request = remoteProjectSourceRequest(source);
  const stateSource: WorkbenchProjectStateSource = {
    source: request.source,
    files: source.sourceFiles.map((file) => ({ ...file })),
    candidateFiles: request.candidateFiles.map(toSurfaceSnapshotFile),
    engineResolveFiles: request.engineResolveFiles.map(toSurfaceSnapshotFile),
    engineResolveBinding: request.engineResolveBinding,
    adapterFiles: request.adapterFiles.map(toSurfaceSnapshotFile),
    dockerfile: request.dockerfile,
    runtimeDockerfile: request.runtimeDockerfile,
    runtimeFiles: request.runtimeFiles.map(toSurfaceSnapshotFile),
    network: request.network,
    resources: { ...request.resources },
  };
  return {
    ...stateSource,
    fingerprint: workbenchProjectSourceFingerprint(stateSource),
  };
}

function toSurfaceSnapshotFile(file: RemoteFile | SurfaceSnapshotFile): SurfaceSnapshotFile {
  return {
    path: file.path,
    kind: "kind" in file ? file.kind : file.encoding === "base64" ? "binary" : "text",
    encoding: file.encoding ?? "utf8",
    content: file.content,
    executable: file.executable === true,
  };
}

function remoteProjectSummaryFromState(
  state: WorkbenchProjectState,
): RemoteProjectSummary & {
  id: string;
  name: string;
  ownerUsername?: string;
} {
  return {
    id: state.project.id,
    ownerUsername: state.project.ownerUsername,
    name: state.project.name,
    visibility: state.project.visibility,
  };
}

function sourceFileCount(source: LocalProjectSource): number {
  return source.sourceFiles.length;
}

function remoteProjectSourceRequest(source: LocalProjectSource): {
  source: string;
  candidateFiles: RemoteFile[];
  engineResolveFiles: RemoteFile[];
  engineResolveBinding: EngineResolveBinding;
  adapterFiles: RemoteFile[];
  dockerfile: string;
  runtimeDockerfile: string;
  runtimeFiles: RemoteFile[];
  network: "off" | "on";
  resources: Partial<{
    cpu: number;
    memoryGb: number;
    diskGb: number;
    timeoutMinutes: number;
  }>;
} {
  const { network, resources } = remoteEnvironmentOptions(source);
  return {
    source: source.specSource,
    candidateFiles: source.candidateFiles,
    engineResolveFiles: remoteEngineResolveFiles(source),
    engineResolveBinding: engineResolveBindingForSpec(source.spec),
    adapterFiles: source.adapterFiles,
    dockerfile: source.dockerfile,
    runtimeDockerfile: source.runtimeDockerfile,
    runtimeFiles: source.dockerfileFiles,
    network,
    resources,
  };
}

function isRemoteProjectId(value: string): boolean {
  return /^wb_[a-f0-9]{12}$/u.test(value);
}

function remoteEnvironmentOptions(source: LocalProjectSource): {
  network: "off" | "on";
  resources: {
    cpu: number;
    memoryGb: number;
    diskGb: number;
    timeoutMinutes: number;
  };
} {
  return {
    network:
      source.spec.environment.network?.egress === "open"
        ? "on"
        : "off",
    resources: runtimeResources(source.spec.environment),
  };
}

async function watchRemoteRun(args: {
  parsed: ParsedArgs;
  target: RemoteTarget;
  runId: string;
  intervalMs: number;
  timeoutMs?: number;
}): Promise<RemoteRunRecord> {
  const deadline =
    args.timeoutMs === undefined ? undefined : Date.now() + args.timeoutMs;
  let lastRun: RemoteRunRecord | null = null;
  while (true) {
    let response: { run: RemoteRunRecord };
    try {
      response = await apiRequest<{ run: RemoteRunRecord }>(
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

function formatRemoteRunResult(run: RemoteRunRecord): string {
  const candidateId = run.outputCandidateId ?? run.candidateId;
  const activeDetail = run.activeCandidateId && candidateId && run.activeCandidateId !== candidateId
    ? `; active ${run.activeCandidateId}`
    : "";
  const summary = `Run ${run.id} reached ${run.status}; ${run.outcome ? `outcome ${run.outcome}; ` : ""}candidate ${candidateId ?? "pending"}${activeDetail}; ${run.completedJobCount ?? 0}/${run.jobCount ?? 0} jobs completed.`;
  return [
    run.error ? `${summary}\nError: ${run.error}` : summary,
    ...(run.urls?.candidateEvaluation
      ? [`Open evaluation: ${run.urls.candidateEvaluation}`]
      : [`Open benchmark: ${run.urls?.benchmark ?? ""}`].filter(Boolean)),
  ].join("\n");
}

function formatRetryCommandResult(result: RetryCommandResult): string {
  const run = result.run;
  const runId = run?.id ?? result.runId ?? "unknown";
  const scope = `${result.retried.kind} ${result.retried.id}`;
  const verb = run
    ? run.status === "finished" ? "finished as remote run" : "started as remote run"
    : "finished as local run";
  return [
    `Retry of ${scope} ${verb} ${runId}.`,
    ...(result.evaluationId ? [`Evaluation: ${result.evaluationId}`] : []),
    ...(result.candidateId ? [`Candidate: ${result.candidateId}`] : []),
    ...(result.failedJobCount ? [`Failed jobs: ${result.failedJobCount}`] : []),
    ...(result.error ? [`Error: ${result.error}`] : []),
    ...(result.localView
      ? [`Open local view: ${result.localView.command}`, result.localView.note]
      : []),
    ...(result.urls?.candidateEvaluation
      ? [`Open evaluation: ${result.urls.candidateEvaluation}`]
      : result.urls?.benchmark ? [`Open benchmark: ${result.urls.benchmark}`] : []),
  ].join("\n");
}

function formatRemoteRunStarted(
  run: RemoteRunRecord,
  fallbackWorkflow: RemoteRunWorkflow,
): string {
  const candidateId = run.outputCandidateId ?? run.candidateId;
  return [
    `Started ${run.workflow ?? fallbackWorkflow} run ${run.id}; ${candidateId ? `candidate ${candidateId}` : `${run.jobCount ?? 0} jobs queued`}.`,
    ...(run.urls?.candidateEvaluation
      ? [`Open evaluation: ${run.urls.candidateEvaluation}`]
      : run.urls?.benchmark ? [`Open benchmark: ${run.urls.benchmark}`] : []),
    "",
  ].join("\n");
}

function readRunJobPurpose(job: RemoteRunJobRecord): string | null {
  return job.purpose && job.purpose.trim() ? job.purpose : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return readFiniteNumber(value);
}

function integerValue(value: unknown): number | null {
  return Number.isSafeInteger(value) ? value as number : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function withRemoteRunFailureSummary(
  target: RemoteTarget,
  run: RemoteRunRecord,
): Promise<RemoteRunRecord> {
  if (remoteRunSucceeded(run) || run.error || (run.failedJobCount ?? 0) <= 0) {
    return run;
  }
  const error = await readRemoteRunFailureSummary(target, run.id);
  return error ? { ...run, error } : run;
}

async function readRemoteRunFailureSummary(
  target: RemoteTarget,
  runId: string,
): Promise<string | null> {
  try {
    const detail = await readRemoteRunDetail(target, runId);
    const failed = detail.jobs.find((job) => job.status === "failed" && job.error);
    return failed?.error ? `First failed job ${failed.id}: ${failed.error}` : null;
  } catch {
    return null;
  }
}

function remoteRunSucceeded(run: RemoteRunRecord): boolean {
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
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new UsageError(`Workbench origin is malformed: ${workbenchOriginPath(dir)}`);
    }
    const originRecord = parsed as Partial<WorkbenchOrigin>;
    if (
      typeof originRecord.projectId !== "string" ||
      typeof originRecord.baseUrl !== "string" ||
      typeof originRecord.remote !== "string" ||
      typeof originRecord.sourceRevisionId !== "string" ||
      typeof originRecord.sourceFingerprint !== "string" ||
      typeof originRecord.runtimeFingerprint !== "string" ||
      typeof originRecord.linkedAt !== "string" ||
      originRecord.projectId.length === 0 ||
      originRecord.sourceRevisionId.length === 0 ||
      originRecord.sourceFingerprint.length === 0 ||
      originRecord.runtimeFingerprint.length === 0
    ) {
      throw new UsageError(`Workbench origin is malformed: ${workbenchOriginPath(dir)}`);
    }
    return {
      baseUrl: normalizeBaseUrl(originRecord.baseUrl),
      remote: normalizeOriginRemote(originRecord.remote),
      projectId: originRecord.projectId,
      sourceRevisionId: originRecord.sourceRevisionId,
      sourceFingerprint: originRecord.sourceFingerprint,
      runtimeFingerprint: originRecord.runtimeFingerprint,
      linkedAt: originRecord.linkedAt,
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
    baseUrl: normalizeBaseUrl(input.baseUrl),
    remote: normalizeOriginRemote(input.remote),
    projectId: input.projectId,
    sourceRevisionId: input.sourceRevisionId,
    sourceFingerprint: input.sourceFingerprint,
    runtimeFingerprint: input.runtimeFingerprint,
    linkedAt: input.linkedAt ?? new Date().toISOString(),
  };
  const filePath = workbenchOriginPath(dir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(origin, null, 2)}\n`);
  return origin;
}

async function writeWorkbenchOriginFromState(
  dir: string,
  args: {
    baseUrl: string;
    state: WorkbenchProjectState;
  },
): Promise<WorkbenchOrigin> {
  const owner = args.state.project.ownerUsername;
  const name = args.state.project.name;
  const sourceRevisionId =
    args.state.source.revisionId ??
    args.state.base.sourceRevisionId;
  const sourceFingerprint =
    args.state.source.fingerprint ??
    args.state.base.sourceFingerprint;
  const runtimeFingerprint =
    args.state.base.runtimeFingerprint ??
    workbenchRuntimeBundleFingerprint(args.state.runtime);
  if (!sourceRevisionId || !sourceFingerprint || !runtimeFingerprint) {
    throw new UsageError("Remote project state is missing required origin metadata.");
  }
  return await writeWorkbenchOrigin(dir, {
    baseUrl: args.baseUrl,
    remote: `${owner}/${name}`,
    projectId: args.state.project.id,
    sourceRevisionId,
    sourceFingerprint,
    runtimeFingerprint,
  });
}

function parseOriginRemote(origin: WorkbenchOrigin): { owner: string; project: string } {
  return parseRemoteName(origin.remote);
}

function parseRemoteName(remote: string): { owner: string; project: string } {
  try {
    return parseBenchmarkRef(remote);
  } catch {
    throw new UsageError(`Workbench origin remote must use OWNER/BENCHMARK: ${remote}`);
  }
}

function normalizeOriginRemote(remote: string): string {
  const parsed = parseRemoteName(remote.trim());
  return `${parsed.owner}/${parsed.project}`;
}

function originRemoteUrlParts(origin: WorkbenchOrigin): {
  owner: string;
  projectName: string;
} {
  const remote = parseOriginRemote(origin);
  return {
    owner: remote.owner,
    projectName: remote.project,
  };
}

function workbenchOriginPath(dir: string): string {
  return path.join(dir, ".workbench", "origin.json");
}

async function effectiveBaseUrl(): Promise<string> {
  const config = await loadConfig();
  return selectWorkbenchBaseUrl({ configBaseUrl: config.baseUrl });
}

async function effectiveOriginBaseUrl(originBaseUrl?: string): Promise<string> {
  const config = await loadConfig();
  return selectWorkbenchBaseUrl({
    originBaseUrl,
    configBaseUrl: config.baseUrl,
  });
}

function selectWorkbenchBaseUrl(input: {
  explicitBaseUrl?: string;
  originBaseUrl?: string;
  configBaseUrl?: string;
} = {}): string {
  return normalizeBaseUrl(
    input.explicitBaseUrl ??
      input.originBaseUrl ??
      process.env.WORKBENCH_API_URL ??
      input.configBaseUrl ??
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
  const baseUrl = selectWorkbenchBaseUrl({ configBaseUrl: config.baseUrl });
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

async function apiRequest<T>(
  apiPath: string,
  options: { method?: string; body?: unknown } = {},
  baseUrlOverride?: string,
): Promise<T> {
  const config = await loadConfig();
  const baseUrl = baseUrlOverride !== undefined
    ? normalizeBaseUrl(baseUrlOverride)
    : selectWorkbenchBaseUrl({ configBaseUrl: config.baseUrl });
  const method = options.method ?? "GET";
  const canRetry = method === "GET";
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= API_REQUEST_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${apiPath}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(config.accessToken
            ? { authorization: `Bearer ${config.accessToken}` }
            : {}),
        },
        body: options.body == null ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      lastError = error;
      if (canRetry && attempt < API_REQUEST_MAX_ATTEMPTS && isTransientFetchError(error)) {
        await sleep(apiRequestRetryDelayMs(attempt));
        continue;
      }
      throw error;
    }
    if (!response.ok) {
      const text = await response.text();
      const requestError = new WorkbenchApiRequestError(
        response.status,
        readResponseError(text) ||
          `Request failed with status ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
        text,
      );
      lastError = requestError;
      if (canRetry && attempt < API_REQUEST_MAX_ATTEMPTS && isTransientApiRequestError(requestError)) {
        await sleep(apiRequestRetryDelayMs(attempt));
        continue;
      }
      throw requestError;
    }
    return (await response.json()) as T;
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Workbench API request failed."));
}

function apiRequestRetryDelayMs(attempt: number): number {
  return 250 * attempt;
}

function isTransientFetchError(error: unknown): boolean {
  const message = errorMessage(error);
  return /(?:fetch failed|socket hang up|ECONNRESET|EPIPE|UND_ERR_SOCKET|terminated)/iu.test(message);
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
  kind: InitCandidateKind;
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
  kind: InitCandidateKind,
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

function singleRequestedRunId(value: string | undefined, command: string): string | undefined {
  if (!value || value.trim() === "") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "all" || trimmed.includes(",")) {
    throw new UsageError(`${command} accepts one candidate run id for --runs; use workbench eval --runs all to evaluate every run.`);
  }
  return trimmed;
}

function resolveCandidateRunSelection(
  source: LocalProjectSource,
  value: string | undefined,
): string[] {
  const available = source.candidateRunIds;
  if (available.length === 0) {
    throw new UsageError("Candidate must declare at least one run.");
  }
  if (!value || value.trim() === "") {
    return [source.candidateRunId];
  }
  const trimmed = value.trim();
  if (trimmed === "all") {
    return available;
  }
  const requested = [...new Set(trimmed.split(",").map((entry) => entry.trim()).filter(Boolean))];
  if (requested.length === 0) {
    throw new UsageError("--runs must include at least one run id or all.");
  }
  const missing = requested.filter((runId) => !available.includes(runId));
  if (missing.length > 0) {
    throw new UsageError(`Unknown candidate run(s): ${missing.join(", ")}. Available: ${available.join(", ")}.`);
  }
  return requested;
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

function formatCandidateEvaluationScore(
  candidate: Pick<CandidateRecord, "eval">,
): string {
  const score = candidate.eval?.metrics?.score?.mean;
  return typeof score === "number" && Number.isFinite(score)
    ? formatMetricValue(score)
    : "n/a";
}

function formatLocalCandidateLabel(
  candidate: Pick<CandidateRecord, "id" | "name" | "version"> | null | undefined,
): string {
  if (!candidate) {
    return "none";
  }
  const name = candidate.name?.trim() || candidate.id;
  const displayName = candidate.version > 0
    ? `${name} v${candidate.version}`
    : name;
  return `${displayName} (${candidate.id})`;
}

function formatCandidateEvaluationSummary(
  candidate: Pick<CandidateRecord, "eval">,
): string {
  return formatMetricSummary(evaluationMeanMetrics(candidate.eval), {
    limit: Number.POSITIVE_INFINITY,
  });
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

function formatNullableMetric(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? formatMetricValue(value)
    : "n/a";
}

function formatFailureLine(failure: {
  kind: string;
  id: string;
  status?: string;
  runId?: string;
  candidateId?: string;
  jobId?: string;
  caseId?: string;
  sampleIndex?: number;
  error?: string;
}): string {
  return [
    failure.kind,
    failure.id,
    failure.status ?? "failed",
    failure.runId ? `run=${failure.runId}` : null,
    failure.candidateId ? `candidate=${failure.candidateId}` : null,
    failure.jobId ? `job=${failure.jobId}` : null,
    failure.caseId ? `case=${failure.caseId}` : null,
    typeof failure.sampleIndex === "number" ? `sample=${failure.sampleIndex}` : null,
    failure.error ?? null,
  ].filter(Boolean).join("\t");
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
  const dir = asOptionalString(parsed.flags.dir);
  const source = parsed.positionals[0];
  if (dir && source) {
    return path.resolve(dir, source);
  }
  return path.resolve(
    dir ?? source ?? process.cwd(),
  );
}

function isWorkbenchSourceYamlPath(filePath: string): boolean {
  return path.basename(filePath) === WORKBENCH_BENCHMARK_FILE;
}

function readCandidateIdFlag(
  parsed: ParsedArgs,
  snapshot: { activeId: string | null },
): string {
  const explicit = readOptionalCandidateFlag(parsed);
  if (explicit) {
    return explicit;
  }
  if (snapshot.activeId) {
    return snapshot.activeId;
  }
  throw new UsageError(
    "Missing required --candidate; no active candidate exists.",
  );
}

function readOptionalCandidateFlag(parsed: ParsedArgs): string | undefined {
  return asOptionalString(parsed.flags.candidate);
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
  job: RemoteWorkbenchJob,
): SurfaceSnapshotFile[] {
  const output = jsonRecord(job.output);
  const files = Array.isArray(output.files)
    ? (output.files as unknown[]).filter(isSurfaceSnapshotFile)
    : [];
  return normalizeSurfaceFiles(files);
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

function formatSpecImprover(
  spec: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>,
): string {
  return spec.improve ? `adapter:${spec.improve.use}` : "improve not configured";
}

async function writeFiles(
  outputDir: string,
  files: RemoteFile[],
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
  files: RemoteFile[],
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

async function assertLocalSourceMatchesOrigin(
  dir: string,
  origin: WorkbenchOrigin,
): Promise<void> {
  const source = await readLocalProjectSource(dir);
  const fingerprint = localProjectStateSource(source).fingerprint;
  if (fingerprint === origin.sourceFingerprint) {
    return;
  }
  throw new UsageError(
    "Local source changed since the last pull or push. Run `workbench push` before pulling, or restore the local source changes and try again.",
  );
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
