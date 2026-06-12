import { AsyncLocalStorage } from "node:async_hooks";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { gzipSync } from "node:zlib";

import YAML from "yaml";

import {
  isWorkbenchLocalMetadataPath,
  normalizeWorkbenchSourcePath,
} from "@workbench-ai/workbench-contract";
import type {
  Json,
  RemoteWorkbenchJob,
  SurfaceSnapshotFile,
  WorkbenchArtifact,
  WorkbenchAdapterInvocation,
  WorkbenchAgentSnapshot,
  WorkbenchSkillPatch,
  WorkbenchComparison,
  WorkbenchComparisonCell,
  WorkbenchEvalSnapshot,
  WorkbenchExecutionEvidence,
  WorkbenchExecutionEventBatch,
  WorkbenchExecutionResult,
  WorkbenchExecutionSpec,
  WorkbenchExecutionTrace,
  WorkbenchExecutionTraceDetail,
  WorkbenchFileSurface,
  WorkbenchInspectionFileContent,
  WorkbenchInspectionFileOwnerKind,
  WorkbenchInspectionSnapshot,
  WorkbenchJob,
  WorkbenchLineageEdge,
  WorkbenchObjectPack,
  WorkbenchProjectState,
  WorkbenchRefs,
  WorkbenchRemote,
  WorkbenchRemoteSyncState,
  WorkbenchResult,
  WorkbenchRun,
  WorkbenchRunKind,
  WorkbenchAgent,
  WorkbenchSkillBundleSnapshot,
  WorkbenchSkillInclude,
  WorkbenchSkillSource,
  WorkbenchStatus,
  WorkbenchStatusSnapshot,
  WorkbenchTrace,
  WorkbenchTraceSession,
  WorkbenchVersion,
  UsageSummary,
} from "@workbench-ai/workbench-contract";
import {
  assertWorkbenchAdapterOperationResultOk,
  builtinWorkbenchAdapterManifests,
  collectWorkbenchAdapterAuthRequirements,
  collectWorkbenchAdapterInvocations,
  readWorkbenchAdapterOperationResult,
  WORKBENCH_RUNTIME_CONTROL_TOKEN_ENV,
  WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS_ENV,
  WORKBENCH_RUNTIME_CONTROL_URL_ENV,
  workbenchAdapterOperationCommand,
  workbenchAdapterOperationResultPath,
  type WorkbenchAdapterOperation,
  type WorkbenchAdapterOperationExecutor,
  type WorkbenchAdapterManifest,
  type WorkbenchAdapterOperationResult,
  type WorkbenchRuntimeControlOperation,
  type WorkbenchRuntimeControlOperationSequenceRequest,
  type WorkbenchRuntimeControlOperationSequenceResult,
} from "@workbench-ai/workbench-protocol";

import {
  attachSandboxMetadataToJob,
  createWorkbenchSandboxFileStore,
  isSurfaceSnapshotFile,
  readWorkbenchExecutionSpec,
} from "./sandbox-inputs.ts";
import {
  createSandboxBackendPlaneForBackend,
  DOCKER_SANDBOX_BACKEND,
} from "./sandbox-backends/index.ts";
import {
  asRuntimeRecord,
  isJsonPayload,
  normalizeRelativePath,
  resolveDockerRuntimeImageRef,
  resolveWorkbenchWorkerId,
} from "./runtime-utils.ts";
import type {
  WorkbenchAdapterAuthBundle,
  WorkbenchAdapterAuthTarget,
} from "./adapter-auth.ts";
import {
  adapterAuthEnv,
  localWorkbenchAdapterAuthStore,
  normalizeWorkbenchAdapterAuthTarget,
  sanitizeWorkbenchAdapterAuthBundle,
} from "./adapter-auth.ts";
import {
  executeValidatedSandboxExecution,
  type SandboxExecutionFileStore,
  type SandboxPlane,
} from "./sandbox-plane.ts";
import type {
  WorkbenchExecutionRuntimeInput,
} from "./execution-runtime-types.ts";
import {
  createWorkbenchProgressStdoutParser,
  publishWorkbenchProgressStdoutEnvelope,
  WORKBENCH_PROGRESS_STDOUT_PREFIX,
  type WorkbenchExecutionProgressTarget,
} from "./execution-events.ts";
import {
  runWorkbenchExecutionDag,
  type WorkbenchExecutionDagCapacity,
} from "./execution-scheduler.ts";
import {
  planWorkbenchExecutionJobsForPurpose,
  workbenchExecutionJobPurpose,
} from "./execution-jobs.ts";
import {
  applyWorkbenchSkillPatch,
} from "./skill-patch.ts";
import {
  buildWorkbenchTraceSessionsFromFiles,
  combineWorkbenchTraceSessions,
} from "./execution-traces.ts";
import {
  assignUsageRole,
  mergeUsageSummaries,
  normalizeUsageSummary,
} from "./execution-usage.ts";
import {
  composeRuntimeDockerfileWithAdapterInstallers,
  type WorkbenchRuntimeAdapterInstaller,
} from "./runtime-dockerfile.ts";
import type {
  GenericRunSpec,
  WorkbenchEngineCase,
} from "./generic-spec.ts";
import {
  WorkbenchCodedError,
  WorkbenchUserError,
  codedErrorFromUnknown,
} from "./coded-errors.ts";
import {
  parseWorkbenchRemoteUrl,
} from "./remote-model.ts";

export type {
  Json,
  RemoteWorkbenchJob,
  SurfaceSnapshotFile,
  WorkbenchArtifact,
  WorkbenchComparison,
  WorkbenchComparisonCell,
  WorkbenchEvalSnapshot,
  WorkbenchExecutionEvidence,
  WorkbenchExecutionResult,
  WorkbenchExecutionSpec,
  WorkbenchExecutionTrace,
  WorkbenchExecutionTraceDetail,
  WorkbenchFileSurface,
  WorkbenchInspectionFileContent,
  WorkbenchInspectionFileOwnerKind,
  WorkbenchInspectionSnapshot,
  WorkbenchJob,
  WorkbenchLineageEdge,
  WorkbenchObjectPack,
  WorkbenchProjectState,
  WorkbenchRefs,
  WorkbenchRemote,
  WorkbenchRemoteSyncState,
  WorkbenchRun,
  WorkbenchAgent,
  WorkbenchAgentSnapshot,
  WorkbenchSkillBundleSnapshot,
  WorkbenchSkillInclude,
  WorkbenchSkillSource,
  WorkbenchStatus,
  WorkbenchStatusSnapshot,
  WorkbenchTrace,
  WorkbenchTraceSession,
  WorkbenchVersion,
} from "@workbench-ai/workbench-contract";
export {
  WorkbenchCodedError,
  WorkbenchUserError,
  codedErrorFromUnknown,
} from "./coded-errors.ts";
export {
  workbenchInspectionFileContent,
  workbenchInspectionFileContentUnavailableReason,
  workbenchInspectionFileManifest,
} from "@workbench-ai/workbench-contract";
export type {
  WorkbenchExecutionRuntimeInput,
  WorkbenchWorkloadStepCommand,
} from "./execution-runtime-types.ts";
export {
  attachSandboxMetadataToJob,
  createSandboxAdapterRequest,
  createWorkbenchSandboxFileStore,
  executionResultFromCompletedSandboxJob,
  isSurfaceSnapshotFile,
  readWorkbenchExecutionSpec,
} from "./sandbox-inputs.ts";
export {
  createWorkbenchExecutionCapability,
  createWorkbenchSandboxAllocation,
  collectExecutionCapabilityScopeIssues,
  collectSandboxAllocationScopeIssues,
  collectSandboxHandleScopeIssues,
  assertSandboxBackendSupportsNetworkPolicy,
  executeValidatedSandboxExecution,
  type SandboxBackendCapabilities,
  type SandboxBackendDescriptor,
  type SandboxCreateRequest,
  type SandboxEnvironmentImage,
  type SandboxExecRequest,
  type SandboxExecutionFileStore,
  type SandboxHandle,
  type SandboxMaterializedInput,
  type SandboxPlane,
} from "./sandbox-plane.ts";
export {
  createDockerSandboxBackendDescriptor,
  createDockerSandboxPlane,
  DOCKER_SANDBOX_BACKEND,
} from "./sandbox-backends/index.ts";
export {
  addCapacity,
  capacityFits,
  runWorkbenchExecutionDag,
  subtractCapacity,
  workbenchJobDependencies,
  workbenchJobHostCost,
  workbenchJobResources,
  type WorkbenchExecutionDagCapacity,
  type WorkbenchExecutionDagResult,
  type WorkbenchExecutionDagRunInput,
} from "./execution-scheduler.ts";
export {
  createWorkbenchExecutionJob,
  planWorkbenchExecutionJobsForPurpose,
  workbenchExecutionJobId,
} from "./execution-jobs.ts";
export {
  applyWorkbenchSkillPatch,
} from "./skill-patch.ts";
export {
  asRuntimeRecord,
  importNodeModule,
  jsonRecord,
  nodeBuiltin,
  normalizeRelativePath,
  normalizeRuntimeRegistry,
  normalizeWorkbenchWorkerId,
  quoteShellArg,
  readSurfaceFiles,
  resolveDockerRuntimeImageRef,
  resolveWorkbenchWorkerId,
  writeSurfaceFiles,
} from "./runtime-utils.ts";
export {
  assignUsageRole,
  extractExecutionUsageFromTrace,
  mergeUsageSummaries,
  normalizeUsageSummary,
} from "./execution-usage.ts";
export {
  composeRuntimeDockerfileWithAdapterInstallers,
  type WorkbenchRuntimeAdapterInstaller,
} from "./runtime-dockerfile.ts";
export {
  readOutputTraceFiles,
  workbenchTraceExecutionDirectory,
  workbenchTraceRunDirectory,
  workbenchTraceRunDirectoryName,
} from "./trace-files.ts";
export {
  createWorkbenchExecutionEventPublisher,
  createWorkbenchProgressStdoutParser,
  publishCommandStepEvent,
  publishWorkbenchProgressStdoutEnvelope,
  type WorkbenchExecutionEventPublisher,
  type WorkbenchExecutionProgressTarget,
} from "./execution-events.ts";
export {
  persistWorkbenchAdapterAuthUpdates,
} from "./adapter-auth-updates.ts";
export {
  adapterAuthEnv,
  createWorkbenchAdapterAuthBundle,
  defaultWorkbenchAdapterAuthStoreRoot,
  localWorkbenchAdapterAuthStore,
  normalizeWorkbenchAdapterAuthTarget,
  parseWorkbenchAdapterAuthTarget,
  sanitizeWorkbenchAdapterAuthBundle,
  type WorkbenchAdapterAuthBundle,
  type WorkbenchAdapterAuthEnvVar,
  type WorkbenchAdapterAuthFile,
  type WorkbenchAdapterAuthStatus,
  type WorkbenchAdapterAuthStatusRecord,
  type WorkbenchAdapterAuthStore,
  type WorkbenchAdapterAuthTarget,
} from "./adapter-auth.ts";
export {
  buildWorkbenchTraceSessionsFromFiles,
  combineWorkbenchTraceSessions,
  mergeWorkbenchExecutionTracesByJob,
} from "./execution-traces.ts";

export interface WorkbenchCommandOptions {
  dir?: string;
  authToken?: string;
}

export interface WorkbenchEvalOptions extends WorkbenchCommandOptions {
  version?: string;
  skill?: string;
  agent?: string;
  samples?: number;
  kind?: WorkbenchRunKind;
  parentRunId?: string;
  caseIds?: readonly string[];
  selectedSamples?: readonly WorkbenchCaseSampleSelection[];
  rerun?: boolean;
}

export interface WorkbenchStateEvalOptions {
  authToken?: string;
  version?: string;
  evalHash?: string;
  skill?: string;
  agent?: string;
  samples?: number;
  kind?: WorkbenchRunKind;
  parentRunId?: string;
  caseIds?: readonly string[];
  selectedSamples?: readonly WorkbenchCaseSampleSelection[];
  rerun?: boolean;
}

export interface WorkbenchStateImproveOptions {
  authToken?: string;
  version?: string;
  evalHash?: string;
  skill?: string;
  agent?: string;
  budget?: number;
  samples?: number;
  parentRunId?: string;
  evidenceTraceIds?: readonly string[];
}

export interface WorkbenchCaseSampleSelection {
  caseId: string;
  sample: number;
}

export interface WorkbenchCheckResult {
  ok: true;
  status: WorkbenchStatus;
  cases: number;
  skills: number;
  agents: number;
  plan: {
    source: {
      skillFiles: number;
      evalFiles: number;
      caseCount: number;
      smokeCaseCount: number;
    };
    skills: Array<{
      name: string;
      bundleHash: string;
      includedSkillCount: number;
      fileCount: number;
    }>;
    agents: Array<{
      name: string;
      adapter: string;
      model?: string;
      providerBacked: boolean;
      executionMode: "local-command" | "provider-backed";
      network: WorkbenchExecutionSpec["policy"]["network"];
      resources: WorkbenchExecutionSpec["policy"]["resources"];
      image: string;
      auth?: "local-adapter-auth";
    }>;
  };
}

export interface WorkbenchExecutionJobOptions {
  sandboxBackend: string;
  loadLocalAdapterAuthProfiles?: boolean;
  adapterAuthUpdateSink?: (profiles: readonly WorkbenchAdapterAuthBundle[]) => Promise<void>;
  createSandboxPlaneForBackend?: (
    backend: string,
    args: WorkbenchExecutionRuntimeInput,
    startedAt: string,
    fileStore: SandboxExecutionFileStore,
  ) => SandboxPlane;
}

export async function executeWorkbenchExecutionJob(
  args: WorkbenchExecutionRuntimeInput,
  options: WorkbenchExecutionJobOptions,
): Promise<RemoteWorkbenchJob> {
  const startedAt = args.job.startedAt ?? args.now ?? new Date().toISOString();
  try {
    const execution = readWorkbenchExecutionSpec(args.job);
    const adapterAuthProfiles = await explicitAdapterAuthProfilesForExecution(
      execution,
      args,
      Boolean(options.loadLocalAdapterAuthProfiles),
    );
    const adapterAuthUpdateSink =
      options.adapterAuthUpdateSink ??
      (options.loadLocalAdapterAuthProfiles
        ? persistLocalAdapterAuthProfileUpdates
        : undefined);
    const runtimeArgs =
      adapterAuthProfiles.length > 0
        ? {
            ...args,
            adapterAuthProfiles,
            ...(adapterAuthUpdateSink ? { adapterAuthUpdateSink } : {}),
          }
        : args;
    return await withMutableAdapterAuthExecutionLocks(adapterAuthProfiles, async () =>
      await executeWorkbenchExecutionJobWithResolvedAuth(runtimeArgs, options, startedAt)
    );
  } catch (error) {
    return failRemoteWorkbenchJob(args.job, startedAt, error);
  }
}

async function executeWorkbenchExecutionJobWithResolvedAuth(
  args: WorkbenchExecutionRuntimeInput,
  options: WorkbenchExecutionJobOptions,
  startedAt: string,
): Promise<RemoteWorkbenchJob> {
  try {
    const execution = readWorkbenchExecutionSpec(args.job);
    const executor = workbenchExecutionExecutorForRuntimeInput(args);
    if (executor === "host") {
      return await withWorkbenchRuntimeControlServer(
        args,
        options,
        startedAt,
        async (adapterRuntimeEnv) =>
          await executeAdapterInCurrentRuntime(
            {
              ...args,
              adapterRuntimeEnv: {
                ...(args.adapterRuntimeEnv ?? {}),
                ...adapterRuntimeEnv,
              },
            },
            execution,
            startedAt,
          ),
      );
    }
    const fileStore = createWorkbenchSandboxFileStore(args);
    const planeFactory = options.createSandboxPlaneForBackend ?? createSandboxBackendPlaneForBackend;
    const plane = planeFactory(options.sandboxBackend, args, startedAt, fileStore);
    const validated = await executeValidatedSandboxExecution(plane, execution, {
      now: startedAt,
      runnerId: resolveWorkbenchWorkerId(
        [
          process.env.WORKBENCH_WORKER_ID,
          process.env.EC2_INSTANCE_ID,
          os.hostname(),
          process.env.HOSTNAME,
        ],
        "local-runner",
      ),
      fileStore,
    });
    return completedRemoteJobFromSandboxResult(args.job, startedAt, validated.result);
  } catch (error) {
    return failRemoteWorkbenchJob(args.job, startedAt, error);
  }
}

export function requiredWorkbenchAdapterAuthTargetsForRuntimeInput(
  args: Pick<WorkbenchExecutionRuntimeInput, "job" | "adapterManifests" | "runtimeControlOperation" | "spec">,
): WorkbenchAdapterAuthTarget[] {
  return requiredAdapterAuthTargetsForExecution(readWorkbenchExecutionSpec(args.job), args);
}

export function workbenchExecutionPurpose(
  job: RemoteWorkbenchJob,
): WorkbenchExecutionSpec["purpose"] | null {
  return workbenchExecutionJobPurpose(job);
}

export function workbenchExecutionExecutorForRuntimeInput(
  args: Pick<WorkbenchExecutionRuntimeInput, "job" | "adapterManifests" | "runtimeControlOperation" | "spec">,
): WorkbenchAdapterOperationExecutor {
  if (args.runtimeControlOperation) {
    return "sandbox";
  }
  const execution = readWorkbenchExecutionSpec(args.job);
  if (isSkillEvalExecution(execution) && isProviderBackedSkillEvalInvocation(args.spec.run)) {
    return "sandbox";
  }
  const operation = adapterOperationForExecutionPurpose(execution.purpose);
  if (!operation) {
    return "sandbox";
  }
  const manifest = args.adapterManifests?.find((entry: WorkbenchAdapterManifest) => entry.id === execution.adapter.use);
  return manifest ? workbenchAdapterOperationExecutorShim(manifest, operation) : "sandbox";
}

function adapterOperationForExecutionPurpose(
  purpose: WorkbenchExecutionSpec["purpose"],
): WorkbenchAdapterOperation | null {
  if (purpose === "improve") {
    return "skill.improve";
  }
  if (purpose === "attempt") {
    return "engine.run";
  }
  return null;
}

export async function executeAdapterInCurrentRuntime(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
  startedAt: string,
): Promise<RemoteWorkbenchJob> {
  if (isSkillEvalExecution(execution) && execution.adapter.use === "command") {
    return await executeSkillEvalExecutionInCurrentRuntime(args, execution, startedAt);
  }
  const adapterAuth = await materializeSandboxAdapterAuth(args, execution);
  const runtimeArgs: WorkbenchExecutionRuntimeInput = {
    ...args,
    ...(adapterAuth.root ? { adapterAuthRoot: adapterAuth.root } : {}),
    adapterAuthEnv: {
      ...(args.adapterAuthEnv ?? {}),
      ...adapterAuth.env,
    },
  };
  try {
    if (isSkillEvalExecution(execution) && isProviderBackedSkillEvalInvocation(args.spec.run)) {
      return await executeProviderSkillEvalExecutionInCurrentRuntime(runtimeArgs, execution, startedAt);
    }
    const operation = adapterOperationForExecutionPurpose(execution.purpose);
    if (operation) {
      return await executeHostAdapterOperationInCurrentRuntime(runtimeArgs, execution, startedAt, operation);
    }
    return failRemoteWorkbenchJob(
      args.job,
      startedAt,
      new Error(`Unsupported current-runtime execution purpose ${execution.purpose}.`),
    );
  } finally {
    if (adapterAuth.captureUpdates) {
      await persistMaterializedAdapterAuthUpdates(runtimeArgs, adapterAuth.captureUpdates);
    }
    if (adapterAuth.cleanup) {
      await adapterAuth.cleanup().catch(() => undefined);
    }
  }
}

function isSkillEvalExecution(execution: WorkbenchExecutionSpec): boolean {
  return asRuntimeRecord(execution.metadata).skillEval === true;
}

async function executeHostAdapterOperationInCurrentRuntime(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
  startedAt: string,
  operation: WorkbenchAdapterOperation,
): Promise<RemoteWorkbenchJob> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-host-adapter-"));
  try {
    const result = await runRuntimeControlOperationSequence({
      args: {
        ...args,
        runtimeControlOperation: {
          operations: [{
            label: "host",
            operation,
            invocation: {
              use: execution.adapter.use,
              with: execution.adapter.with ?? {},
              ...(execution.adapter.auth !== undefined ? { auth: execution.adapter.auth } : {}),
            },
          }],
        },
      },
      execution,
      startedAt,
      workspace,
    });
    const finishedAt = now();
    return {
      ...args.job,
      status: result.ok ? "succeeded" : "failed",
      attempt: Math.max(1, args.job.attempt),
      startedAt,
      finishedAt,
      updatedAt: finishedAt,
      ...(result.ok ? {} : { error: result.error ?? "Host adapter operation failed." }),
      output: {
        ...runtimeControlJobOutput(result),
        executionId: execution.id,
        purpose: execution.purpose,
      } as unknown as Json,
    };
  } catch (error) {
    return failRemoteWorkbenchJob(args.job, startedAt, error);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

const RUNTIME_CONTROL_MAX_BODY_BYTES = 512 * 1024 * 1024;
const RUNTIME_CONTROL_SERVER_CLOSE_GRACE_MS = 1_000;
const RUNTIME_CONTROL_STEP_GRACE_MS = 5_000;

async function withWorkbenchRuntimeControlServer(
  args: WorkbenchExecutionRuntimeInput,
  options: WorkbenchExecutionJobOptions,
  startedAt: string,
  run: (env: Record<string, string>) => Promise<RemoteWorkbenchJob>,
): Promise<RemoteWorkbenchJob> {
  const token = randomBytes(24).toString("base64url");
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    void handleWorkbenchRuntimeControlHttpRequest({
      request,
      response,
      token,
      args,
      options,
      startedAt,
    });
  });
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const url = await new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Workbench runtime-control server did not expose a local TCP address."));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  try {
    return await run({
      [WORKBENCH_RUNTIME_CONTROL_URL_ENV]: url,
      [WORKBENCH_RUNTIME_CONTROL_TOKEN_ENV]: token,
    });
  } finally {
    await closeWorkbenchRuntimeControlServer(server, sockets);
  }
}

async function closeWorkbenchRuntimeControlServer(
  server: ReturnType<typeof createServer>,
  sockets: Set<Socket>,
): Promise<void> {
  let closeError: Error | undefined;
  const closed = new Promise<void>((resolve) => {
    server.close((error?: Error) => {
      closeError = error;
      resolve();
    });
  });
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const closedBeforeGrace = await Promise.race([
    closed.then(() => true),
    new Promise<boolean>((resolve) => {
      graceTimer = setTimeout(() => resolve(false), RUNTIME_CONTROL_SERVER_CLOSE_GRACE_MS);
    }),
  ]);
  if (graceTimer) {
    clearTimeout(graceTimer);
  }
  if (!closedBeforeGrace) {
    for (const socket of sockets) {
      socket.destroy();
    }
    await closed;
  }
  if (closeError) {
    throw closeError;
  }
}

async function handleWorkbenchRuntimeControlHttpRequest(args: {
  request: IncomingMessage;
  response: ServerResponse;
  token: string;
  args: WorkbenchExecutionRuntimeInput;
  options: WorkbenchExecutionJobOptions;
  startedAt: string;
}): Promise<void> {
  const { request, response } = args;
  try {
    if (request.method !== "POST" || request.url !== "/v1/operation-sequence") {
      writeRuntimeControlJson(response, 404, { error: "Unknown Workbench runtime-control endpoint." });
      return;
    }
    if (request.headers.authorization !== `Bearer ${args.token}`) {
      writeRuntimeControlJson(response, 401, { error: "Workbench runtime-control token is invalid." });
      return;
    }
    const parsed = JSON.parse(await readRuntimeControlBody(request)) as unknown;
    const controlRequest = normalizeRuntimeControlOperationSequenceRequest(parsed);
    const result = await executeRuntimeControlOperationSequenceInSandbox(
      args.args,
      args.options,
      args.startedAt,
      controlRequest,
    );
    writeRuntimeControlJson(response, 200, result as unknown as Json);
  } catch (error) {
    writeRuntimeControlJson(response, 500, {
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  }
}

function writeRuntimeControlJson(
  response: ServerResponse,
  statusCode: number,
  payload: Json,
): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function readRuntimeControlBody(
  request: IncomingMessage,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > RUNTIME_CONTROL_MAX_BODY_BYTES) {
        reject(new Error("Workbench runtime-control request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function normalizeRuntimeControlOperationSequenceRequest(
  value: unknown,
): WorkbenchRuntimeControlOperationSequenceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workbench runtime-control operation sequence request must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.operations) || record.operations.length === 0) {
    throw new Error("Workbench runtime-control operation sequence requires at least one operation.");
  }
  const inputs = normalizeRuntimeControlInputs(record.inputs);
  return {
    ...(inputs ? { inputs } : {}),
    operations: record.operations.map((entry, index) =>
      normalizeRuntimeControlOperation(entry, `operations[${index}]`)
    ),
    ...(typeof record.prepare === "boolean" ? { prepare: record.prepare } : {}),
    ...(typeof record.collectWorkspace === "boolean" ? { collectWorkspace: record.collectWorkspace } : {}),
  };
}

function normalizeRuntimeControlInputs(
  value: unknown,
): WorkbenchRuntimeControlOperationSequenceRequest["inputs"] {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workbench runtime-control inputs must be an object.");
  }
  const record = value as Record<string, unknown>;
  const inputs: NonNullable<WorkbenchRuntimeControlOperationSequenceRequest["inputs"]> = {};
  if (hasOwn(record, "skill")) {
    inputs.skill = normalizeRuntimeControlFiles(record.skill, "inputs.skill");
  }
  if (hasOwn(record, "case")) {
    inputs.case = normalizeRuntimeControlFiles(record.case, "inputs.case");
  }
  if (hasOwn(record, "enginePrivate")) {
    inputs.enginePrivate = normalizeRuntimeControlFiles(record.enginePrivate, "inputs.enginePrivate");
  }
  if (hasOwn(record, "traces")) {
    inputs.traces = normalizeRuntimeControlFiles(record.traces, "inputs.traces");
  }
  if (hasOwn(record, "workspace")) {
    inputs.workspace = normalizeRuntimeControlFiles(record.workspace, "inputs.workspace");
  }
  if (hasOwn(record, "output")) {
    inputs.output = normalizeRuntimeControlFiles(record.output, "inputs.output");
  }
  return inputs;
}

function normalizeRuntimeControlFiles(
  value: unknown,
  label: string,
): SurfaceSnapshotFile[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Workbench runtime-control ${label} must be an array.`);
  }
  return value.map((entry, index) => {
    if (!isSurfaceSnapshotFile(entry)) {
      throw new Error(`Workbench runtime-control ${label}[${index}] must be a surface snapshot file.`);
    }
    return { ...entry, path: normalizeRelativePath(entry.path) };
  });
}

function hasOwn(
  value: Record<string, unknown>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeRuntimeControlOperation(
  value: unknown,
  label: string,
): WorkbenchRuntimeControlOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Workbench runtime-control ${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const operation = record.operation;
  if (
    operation !== "engine.resolve" &&
    operation !== "engine.run" &&
    operation !== "skill.run" &&
    operation !== "skill.improve"
  ) {
    throw new Error(`Workbench runtime-control ${label}.operation is invalid.`);
  }
  const invocation = record.invocation;
  if (!invocation || typeof invocation !== "object" || Array.isArray(invocation)) {
    throw new Error(`Workbench runtime-control ${label}.invocation must be an object.`);
  }
  const invocationRecord = invocation as Record<string, unknown>;
  if (typeof invocationRecord.use !== "string" || invocationRecord.use.length === 0) {
    throw new Error(`Workbench runtime-control ${label}.invocation.use is required.`);
  }
  const withConfig = invocationRecord.with === undefined
    ? {}
    : isJsonPayload(invocationRecord.with)
      ? invocationRecord.with
      : null;
  if (withConfig === null) {
    throw new Error(`Workbench runtime-control ${label}.invocation.with must be JSON.`);
  }
  if (invocationRecord.auth !== undefined && !isJsonPayload(invocationRecord.auth)) {
    throw new Error(`Workbench runtime-control ${label}.invocation.auth must be JSON.`);
  }
  return {
    operation,
    invocation: {
      use: invocationRecord.use,
      with: withConfig,
      ...(invocationRecord.auth !== undefined ? { auth: invocationRecord.auth as Json } : {}),
      ...(typeof invocationRecord.command === "string" && invocationRecord.command.trim()
        ? { command: invocationRecord.command }
        : {}),
    },
    ...(typeof record.label === "string" && record.label.trim() ? { label: record.label } : {}),
  };
}

async function explicitAdapterAuthProfilesForExecution(
  execution: WorkbenchExecutionSpec,
  args: WorkbenchExecutionRuntimeInput,
  loadLocalAdapterProfiles: boolean,
): Promise<WorkbenchAdapterAuthBundle[]> {
  const required = requiredAdapterAuthTargetsForExecution(execution, args);
  if (required.length === 0) {
    return [];
  }
  const provided = (args.adapterAuthProfiles ?? [])
    .map((bundle) => sanitizeWorkbenchAdapterAuthBundle(bundle));
  const providedByTarget = new Map(provided.map((bundle) => [
    adapterAuthTargetKey(bundle),
    bundle,
  ]));
  const missing = required.filter((target) => !providedByTarget.has(adapterAuthTargetKey(target)));
  if (missing.length > 0 && loadLocalAdapterProfiles) {
    const store = localWorkbenchAdapterAuthStore();
    const loaded = await Promise.all(required.map(async (target) => await store.get(target)));
    const missingLoaded = loaded.findIndex((bundle) => !bundle);
    if (missingLoaded >= 0) {
      const target = required[missingLoaded]!;
      throw new Error(
        `ADAPTER_AUTH_REQUIRED: ${target.adapterId}${target.slot ? `/${target.slot}` : ""} disconnected. Run workbench auth connect ${target.adapterId}${target.slot ? `/${target.slot}` : ""}.`,
      );
    }
    return loaded.map((bundle) => bundle!);
  }
  if (missing.length > 0) {
    const target = missing[0]!;
    throw new Error(
      `ADAPTER_AUTH_REQUIRED: ${target.adapterId}${target.slot ? `/${target.slot}` : ""} disconnected. Run workbench auth connect ${target.adapterId}${target.slot ? `/${target.slot}` : ""}.`,
    );
  }
  return required.map((target) => providedByTarget.get(adapterAuthTargetKey(target))!);
}

function requiredAdapterAuthTargetsForExecution(
  execution: WorkbenchExecutionSpec,
  args: Pick<WorkbenchExecutionRuntimeInput, "adapterManifests" | "runtimeControlOperation" | "spec">,
): WorkbenchAdapterAuthTarget[] {
  const manifests = args.adapterManifests ?? [];
  return collectWorkbenchAdapterAuthRequirements(adapterInvocationsForExecution(execution, args), manifests)
    .map((target) => normalizeWorkbenchAdapterAuthTarget(target));
}

function adapterInvocationsForExecution(
  execution: WorkbenchExecutionSpec,
  args: Pick<WorkbenchExecutionRuntimeInput, "runtimeControlOperation" | "spec">,
): WorkbenchAdapterInvocation[] {
  const invocationsForAttempt = (invocations: readonly WorkbenchAdapterInvocation[]): WorkbenchAdapterInvocation[] =>
    execution.purpose === "attempt"
      ? uniqueAdapterInvocations([...invocations, args.spec.run])
      : uniqueAdapterInvocations(invocations);
  if (args.runtimeControlOperation) {
    return invocationsForAttempt(args.runtimeControlOperation.operations.map((operation) => ({
      use: operation.invocation.use,
      with: operation.invocation.with ?? {},
      ...(operation.invocation.auth !== undefined ? { auth: operation.invocation.auth } : {}),
    })));
  }
  return invocationsForAttempt([execution.adapter]);
}

function uniqueAdapterInvocations(
  invocations: readonly WorkbenchAdapterInvocation[],
): WorkbenchAdapterInvocation[] {
  const seen = new Set<string>();
  const result: WorkbenchAdapterInvocation[] = [];
  for (const invocation of invocations) {
    const key = JSON.stringify(invocation);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(invocation);
  }
  return result;
}

function adapterAuthTargetKey(target: {
  adapterId: string;
  slot?: string;
  profile: string;
}): string {
  return `${target.adapterId}/${target.slot ?? "_"}/${target.profile}`;
}

async function persistLocalAdapterAuthProfileUpdates(
  profiles: readonly WorkbenchAdapterAuthBundle[],
): Promise<void> {
  const store = localWorkbenchAdapterAuthStore();
  for (const profile of profiles) {
    await store.put(profile);
  }
}

const mutableAdapterAuthExecutionLocks = new Map<string, Promise<void>>();

async function withMutableAdapterAuthExecutionLocks<T>(
  profiles: readonly WorkbenchAdapterAuthBundle[],
  callback: () => Promise<T>,
): Promise<T> {
  const keys = [...new Set(profiles
    .filter((profile) => profile.method === "oauth" && profile.files.length > 0)
    .map((profile) => [
      profile.adapterId,
      profile.slot ?? "_",
      profile.profile,
    ].join("/")))]
    .sort();
  let run = callback;
  for (const key of [...keys].reverse()) {
    const next = run;
    run = async () => await withMutableAdapterAuthExecutionLock(key, next);
  }
  return await run();
}

async function withMutableAdapterAuthExecutionLock<T>(
  key: string,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = mutableAdapterAuthExecutionLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  mutableAdapterAuthExecutionLocks.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await callback();
  } finally {
    release();
    if (mutableAdapterAuthExecutionLocks.get(key) === queued) {
      mutableAdapterAuthExecutionLocks.delete(key);
    }
  }
}

function adapterAuthRequest(
  bundles: readonly WorkbenchAdapterAuthBundle[],
  root?: string,
  currentAdapterId?: string,
): Json {
  const self: Record<string, Json> = {};
  const adapters: Record<string, Record<string, Json>> = {};
  for (const bundle of bundles) {
    const entry = adapterAuthRequestEntry(bundle, root);
    if (currentAdapterId && bundle.adapterId === currentAdapterId) {
      self[bundle.slot ?? "default"] = entry;
      continue;
    }
    if (!currentAdapterId) {
      self[bundle.slot ?? "default"] = entry;
      continue;
    }
    adapters[bundle.adapterId] ??= {};
    adapters[bundle.adapterId]![bundle.slot ?? "default"] = entry;
  }
  const entries: Record<string, Json> = {};
  if (Object.keys(self).length > 0) {
    entries.self = self as unknown as Json;
  }
  if (Object.keys(adapters).length > 0) {
    entries.adapters = adapters as unknown as Json;
  }
  return entries as unknown as Json;
}

function adapterAuthRequestEntry(
  bundle: WorkbenchAdapterAuthBundle,
  root?: string,
): Json {
  const fileAuth = bundle.files.length > 0
    ? {
        ...(root ? { filesRoot: `${root}/${bundle.adapterId}/${bundle.slot ?? "_"}/${bundle.profile}` } : {}),
        files: bundle.files.map((file) => ({
          path: file.path,
          encoding: file.encoding,
        })),
      }
    : undefined;
  return {
    method: bundle.method,
    profile: bundle.profile,
    ...(bundle.env && bundle.env.length > 0
      ? { env: Object.fromEntries(bundle.env.map((entry) => [entry.name, "materialized"])) }
      : {}),
    ...(fileAuth ? fileAuth : {}),
  } as unknown as Json;
}

function adapterAuthRequestForStep(
  args: Pick<WorkbenchExecutionRuntimeInput, "adapterAuthProfiles" | "adapterAuthRoot" | "adapterAuthRequest">,
  adapterId: string,
): Json | undefined {
  const profiles = (args.adapterAuthProfiles ?? [])
    .map((bundle) => sanitizeWorkbenchAdapterAuthBundle(bundle));
  if (profiles.length === 0) {
    return args.adapterAuthRequest;
  }
  return adapterAuthRequest(profiles, args.adapterAuthRoot, adapterId);
}

function adapterAuthEnvForStep(
  args: Pick<WorkbenchExecutionRuntimeInput, "adapterAuthProfiles" | "adapterAuthEnv">,
  _adapterId: string,
): Record<string, string> {
  const profiles = (args.adapterAuthProfiles ?? [])
    .map((bundle) => sanitizeWorkbenchAdapterAuthBundle(bundle));
  if (profiles.length === 0) {
    return args.adapterAuthEnv ?? {};
  }
  const env: Record<string, string> = {};
  for (const bundle of profiles) {
    Object.assign(env, adapterAuthEnv(bundle));
  }
  return env;
}

function adapterAuthProfilesForExecution(
  execution: WorkbenchExecutionSpec,
  args: WorkbenchExecutionRuntimeInput,
): WorkbenchAdapterAuthBundle[] {
  const profiles = (args.adapterAuthProfiles ?? [])
    .map((bundle) => sanitizeWorkbenchAdapterAuthBundle(bundle));
  if (profiles.length === 0) {
    return [];
  }
  const targets = requiredAdapterAuthTargetsForExecution(execution, args);
  return profiles.filter((bundle) =>
    targets.some((target) =>
      bundle.adapterId === target.adapterId &&
      bundle.profile === target.profile &&
      (target.slot === undefined || bundle.slot === target.slot)
    )
  );
}

async function materializeSandboxAdapterAuth(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
): Promise<{
  root?: string;
  env: Record<string, string>;
  cleanup?: () => Promise<void>;
  captureUpdates?: () => Promise<WorkbenchAdapterAuthBundle[]>;
}> {
  const adapterProfiles = adapterAuthProfilesForExecution(execution, args);
  if (adapterProfiles.length === 0) {
    return { env: {} };
  }
  const env: Record<string, string> = {};
  for (const bundle of adapterProfiles) {
    Object.assign(env, adapterAuthEnv(bundle));
  }
  const adapterFileBundles = adapterProfiles.filter((bundle) => bundle.files.length > 0);
  if (adapterFileBundles.length === 0) {
    return { env };
  }
  const base = args.workdir ?? os.tmpdir();
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "workbench-adapter-auth-"));
  await materializeAdapterAuthProfiles(adapterFileBundles, root);
  return {
    root,
    env,
    captureUpdates: async () =>
      await collectMaterializedAdapterAuthProfileUpdates(adapterFileBundles, root),
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

async function materializeAdapterAuthProfiles(
  bundles: readonly WorkbenchAdapterAuthBundle[],
  root: string,
): Promise<void> {
  for (const bundle of bundles) {
    const targetRoot = path.join(
      root,
      bundle.adapterId,
      bundle.slot ?? "_",
      bundle.profile,
    );
    for (const file of bundle.files) {
      const targetPath = path.join(targetRoot, file.path);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(
        targetPath,
        file.encoding === "base64"
          ? Buffer.from(file.content, "base64")
          : file.content,
        { mode: file.mode ?? 0o600 },
      );
    }
  }
}

async function collectMaterializedAdapterAuthProfileUpdates(
  bundles: readonly WorkbenchAdapterAuthBundle[],
  root: string,
): Promise<WorkbenchAdapterAuthBundle[]> {
  const updates: WorkbenchAdapterAuthBundle[] = [];
  for (const bundle of bundles) {
    const targetRoot = path.join(
      root,
      bundle.adapterId,
      bundle.slot ?? "_",
      bundle.profile,
    );
    const files: WorkbenchAdapterAuthBundle["files"] = [];
    let changed = false;
    for (const file of bundle.files) {
      const filePath = path.join(targetRoot, file.path);
      const content = file.encoding === "base64"
        ? (await fs.readFile(filePath)).toString("base64")
        : await fs.readFile(filePath, "utf8");
      files.push({
        ...file,
        content,
      });
      if (content !== file.content) {
        changed = true;
      }
    }
    if (!changed) {
      continue;
    }
    updates.push(sanitizeWorkbenchAdapterAuthBundle({
      ...bundle,
      files,
      updatedAt: new Date().toISOString(),
    }));
  }
  return updates;
}

async function persistMaterializedAdapterAuthUpdates(
  args: Pick<WorkbenchExecutionRuntimeInput, "adapterAuthUpdateSink">,
  captureUpdates: () => Promise<WorkbenchAdapterAuthBundle[]>,
): Promise<void> {
  if (!args.adapterAuthUpdateSink) {
    return;
  }
  const updates = await captureUpdates();
  if (updates.length === 0) {
    return;
  }
  await args.adapterAuthUpdateSink(updates);
}

export async function executeRuntimeControlOperationSequenceInCurrentRuntime(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
  startedAt: string,
): Promise<RemoteWorkbenchJob> {
  if (!args.runtimeControlOperation) {
    return failRemoteWorkbenchJob(
      args.job,
      startedAt,
      new Error("Runtime-control operation sequence is missing from the sandbox request."),
    );
  }
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-runtime-control-"));
  try {
    const result = await runRuntimeControlOperationSequence({
      args,
      execution,
      startedAt,
      workspace,
    });
    const finishedAt = now();
    return {
      ...args.job,
      status: result.ok ? "succeeded" : "failed",
      attempt: Math.max(1, args.job.attempt),
      startedAt,
      finishedAt,
      updatedAt: finishedAt,
      ...(result.ok ? {} : { error: result.error ?? "Runtime-control operation sequence failed." }),
      output: runtimeControlJobOutput(result) as unknown as Json,
    };
  } catch (error) {
    return failRemoteWorkbenchJob(args.job, startedAt, error);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function executeRuntimeControlOperationSequenceInSandbox(
  args: WorkbenchExecutionRuntimeInput,
  options: WorkbenchExecutionJobOptions,
  startedAt: string,
  request: WorkbenchRuntimeControlOperationSequenceRequest,
): Promise<WorkbenchRuntimeControlOperationSequenceResult> {
  const childArgs = createRuntimeControlSandboxInput(args, startedAt, request);
  const completed = await executeWorkbenchExecutionJob(childArgs, options);
  return runtimeControlResultFromCompletedJob(completed);
}

function createRuntimeControlSandboxInput(
  args: WorkbenchExecutionRuntimeInput,
  startedAt: string,
  request: WorkbenchRuntimeControlOperationSequenceRequest,
): WorkbenchExecutionRuntimeInput {
  const parentExecution = readWorkbenchExecutionSpec(args.job);
  const nonce = runtimeControlNonce();
  const childExecutionId = `${parentExecution.id}:runtime:${nonce}`;
  const childJobId = `${args.job.id}:runtime:${nonce}`;
  const parentInput = asRuntimeRecord(args.job.input);
  const caseId = runtimeControlCaseId(args, parentExecution);
  const publicFiles = runtimeControlRequestInputFiles(
    request.inputs,
    "case",
    selectRuntimeControlCaseFiles(args, parentExecution),
  );
  const privateFiles = runtimeControlRequestInputFiles(
    request.inputs,
    "enginePrivate",
    selectRuntimeControlEnginePrivateFiles(args, parentExecution),
  );
  const skillFiles = runtimeControlRequestInputFiles(
    request.inputs,
    "skill",
    args.baseFiles,
  );
  const traceFiles = runtimeControlRequestInputFiles(
    request.inputs,
    "traces",
    args.traceFiles ?? [],
  );
  const adapter = request.operations[request.operations.length - 1]?.invocation;
  const childExecution: WorkbenchExecutionSpec = {
    ...parentExecution,
    id: childExecutionId,
    adapter: adapter
      ? {
          use: adapter.use,
          with: adapter.with ?? {},
          ...(adapter.auth !== undefined ? { auth: adapter.auth } : {}),
        }
      : parentExecution.adapter,
    outputs: [],
    metadata: {
      ...asRuntimeRecord(parentExecution.metadata),
      runtimeControl: true,
      caseId,
    },
  };
  const engineCase: WorkbenchEngineCase = {
    id: caseId,
    case: args.engineCases.find((entry) => entry.id === caseId)?.case ?? {
      version: 3,
      prompt: "",
    },
    files: {
      public: publicFiles,
      private: privateFiles,
      source: publicFiles,
    },
  };
  const childJob: RemoteWorkbenchJob = {
    ...args.job,
    id: childJobId,
    status: "queued",
    attempt: 0,
    createdAt: startedAt,
    updatedAt: startedAt,
    input: {
      ...parentInput,
      execution: childExecution as unknown as Json,
      caseId,
    } as unknown as Json,
  };
  const childArgs: WorkbenchExecutionRuntimeInput = {
    ...args,
    job: childJob,
    baseFiles: skillFiles,
    engineResolveFiles: publicFiles,
    engineCases: [engineCase],
    traceFiles,
    runtimeControlOperation: request,
  };
  delete childArgs.adapterRuntimeEnv;
  delete childArgs.workspaceRoot;
  return childArgs;
}

function runtimeControlRequestInputFiles(
  inputs: WorkbenchRuntimeControlOperationSequenceRequest["inputs"],
  key: keyof NonNullable<WorkbenchRuntimeControlOperationSequenceRequest["inputs"]>,
  fallback: readonly SurfaceSnapshotFile[],
): SurfaceSnapshotFile[] {
  if (inputs && hasOwn(inputs as Record<string, unknown>, key)) {
    return (inputs[key] ?? []).map(copyFile);
  }
  return fallback.map(copyFile);
}

function runtimeControlResultFromCompletedJob(
  job: RemoteWorkbenchJob,
): WorkbenchRuntimeControlOperationSequenceResult {
  return normalizeRuntimeControlResultOutput(
    asRuntimeRecord(job.output),
    job.status === "succeeded",
    job.error,
  );
}

function normalizeRuntimeControlResultOutput(
  output: Record<string, unknown>,
  ok: boolean,
  fallbackError?: string,
): WorkbenchRuntimeControlOperationSequenceResult {
  const files = Array.isArray(output.files)
    ? output.files.filter(isSurfaceSnapshotFile)
    : [];
  const workspaceFiles = Array.isArray(output.workspaceFiles)
    ? output.workspaceFiles.filter(isSurfaceSnapshotFile)
    : undefined;
  const operationResults = Array.isArray(output.operationResults)
    ? output.operationResults.filter(isWorkbenchAdapterOperationResult)
    : [];
  return {
    ok: ok && output.ok !== false,
    files,
    fileChanges: Array.isArray(output.fileChanges)
      ? output.fileChanges.filter((entry): entry is string => typeof entry === "string")
      : files.map((file) => file.path),
    operationResults,
    ...(workspaceFiles ? { workspaceFiles } : {}),
    ...(output.result && typeof output.result === "object" && !Array.isArray(output.result)
      ? { result: output.result as unknown as WorkbenchResult }
      : {}),
    ...(output.usage && typeof output.usage === "object" && !Array.isArray(output.usage)
      ? { usage: output.usage as UsageSummary }
      : {}),
    ...(typeof output.summary === "string" ? { summary: output.summary } : {}),
    ...(output.feedback !== undefined && isJsonPayload(output.feedback) ? { feedback: output.feedback } : {}),
    ...(typeof output.error === "string" ? { error: output.error } : fallbackError ? { error: fallbackError } : {}),
  };
}

function isWorkbenchAdapterOperationResult(value: unknown): value is WorkbenchAdapterOperationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.protocol === "workbench.adapter-result.v1" &&
    (record.operation === "engine.resolve" ||
      record.operation === "engine.run" ||
      record.operation === "skill.run" ||
      record.operation === "skill.improve");
}

function runtimeControlNonce(): string {
  return randomBytes(6).toString("hex");
}

async function runRuntimeControlOperationSequence(args: {
  args: WorkbenchExecutionRuntimeInput;
  execution: WorkbenchExecutionSpec;
  startedAt: string;
  workspace: string;
  stepPrefix?: string;
}): Promise<WorkbenchRuntimeControlOperationSequenceResult> {
  const request = args.args.runtimeControlOperation;
  if (!request) {
    throw new Error("Runtime-control operation sequence is missing from the sandbox request.");
  }
  if (request.operations.length === 0) {
    throw new Error("Runtime-control operation sequence must include at least one operation.");
  }
  await stageRuntimeControlWorkspace({
    args: args.args,
    execution: args.execution,
    workspace: args.workspace,
    request,
  });
  const operationResults: WorkbenchAdapterOperationResult[] = [];
  let sequenceError: string | undefined;
  for (let index = 0; index < request.operations.length; index += 1) {
    const operation = request.operations[index]!;
    const label = runtimeControlOperationLabel(operation, index);
    await fs.rm(workbenchAdapterOperationResultPath(runtimeControlOutputDir(args.workspace)), { force: true }).catch(() => undefined);
    const requestPath = await writeRuntimeControlAdapterRequest({
      args: args.args,
      execution: args.execution,
      workspace: args.workspace,
      operation,
      label,
      index,
    });
    const command = runtimeControlOperationCommand(operation, args.args.adapterManifests);
    const stepAdapterId = operation.invocation.use;
    const stepTimeoutMs = runtimeControlStepTimeoutMs(args.execution);
    const result = await runRuntimeControlShellCommand(command, {
      cwd: args.workspace,
      timeout: stepTimeoutMs + RUNTIME_CONTROL_STEP_GRACE_MS,
      progressTarget: args.args.progress,
      env: runtimeControlAdapterEnv({
        requestPath,
        outputDir: runtimeControlOutputDir(args.workspace),
        adapterEnv: adapterAuthEnvForStep(args.args, stepAdapterId),
        runtimeEnv: args.args.adapterRuntimeEnv,
        timeoutMs: stepTimeoutMs,
      }),
    });
    await writeSurfaceFiles(runtimeControlOutputDir(args.workspace), [
      textFile(`.workbench/traces/${args.args.job.id}/${label}/stdout.log`, result.stdout ?? ""),
      textFile(`.workbench/traces/${args.args.job.id}/${label}/stderr.log`, result.stderr ?? ""),
    ]);
    if (result.error || result.status !== 0) {
      sequenceError = runtimeControlStepFailureMessage({
        label,
        operation,
        result,
        prefix: args.stepPrefix,
      });
      await writeSurfaceFiles(runtimeControlOutputDir(args.workspace), [
        textFile(
          `.workbench/traces/${args.args.job.id}/${label}/error.json`,
          `${JSON.stringify(runtimeControlStepErrorEvidence({
            label,
            operation,
            result,
            error: sequenceError,
          }), null, 2)}\n`,
        ),
      ]);
      break;
    }
    const operationResult = await readWorkbenchAdapterOperationResult(
      runtimeControlOutputDir(args.workspace),
      operation.operation,
    );
    assertWorkbenchAdapterOperationResultOk(operationResult, `Runtime-control ${label}`);
    operationResults.push(operationResult);
    await writeSurfaceFiles(runtimeControlOutputDir(args.workspace), [
      textFile(
        `.workbench/traces/${args.args.job.id}/${label}/result.json`,
        `${JSON.stringify(operationResult, null, 2)}\n`,
      ),
    ]);
  }
  const files = await runtimeControlCollectedFiles(args.workspace);
  const workspaceFiles = request.collectWorkspace
    ? await runtimeControlCollectedWorkspaceFiles(args.workspace)
    : undefined;
  const engineResult = [...operationResults].reverse().find((result) => result.operation === "engine.run");
  const usage = mergeUsageSummaries(operationResults.map(adapterOperationUsageSummary));
  return {
    ok: sequenceError === undefined,
    files,
    fileChanges: files.map((file) => file.path),
    operationResults,
    ...(workspaceFiles ? { workspaceFiles } : {}),
    ...(engineResult?.value && typeof engineResult.value === "object" && !Array.isArray(engineResult.value)
      ? { result: engineResult.value as WorkbenchResult }
      : {}),
    ...(usage ? { usage } : {}),
    ...(engineResult?.summary ? { summary: engineResult.summary } : {}),
    ...(engineResult?.feedback !== undefined ? { feedback: engineResult.feedback } : {}),
    ...(sequenceError ? { error: sequenceError } : {}),
  };
}

function runtimeControlStepTimeoutMs(execution: WorkbenchExecutionSpec): number {
  return Math.max(1_000, execution.policy.resources.timeoutMinutes * 60_000);
}

function runtimeControlStepFailureMessage(args: {
  label: string;
  operation: WorkbenchRuntimeControlOperation;
  result: Awaited<ReturnType<typeof runRuntimeControlShellCommand>>;
  prefix?: string;
}): string {
  const descriptor = runtimeControlStepDescriptor(args.operation);
  const prefix = `${args.prefix ?? "Runtime-control step"} ${args.label} (${descriptor})`;
  const errorMessage = args.result.error?.message ? singleLine(args.result.error.message) : undefined;
  const summarizedError = errorMessage ? runtimeControlKnownFailureSummary(errorMessage) : undefined;
  if (summarizedError) {
    return `${prefix} ${summarizedError}`;
  }
  if (errorMessage) {
    return `${prefix} failed: ${errorMessage}`;
  }
  const rawDetail = args.result.stderr || args.result.stdout || "";
  const summarizedDetail = runtimeControlKnownFailureSummary(rawDetail);
  if (summarizedDetail) {
    return `${prefix} ${summarizedDetail}`;
  }
  const detail = singleLine(rawDetail);
  const status = args.result.status ?? "unknown";
  return detail
    ? `${prefix} exited with status ${status}: ${detail}`
    : `${prefix} exited with status ${status}.`;
}

function runtimeControlKnownFailureSummary(value: string): string | undefined {
  const text = singleLine(value);
  const timeoutMatch =
    text.match(/Workbench runtime-control request timed out after (\d+)ms\./u) ??
    text.match(/Runtime-control step timed out after (\d+)ms\./u);
  if (timeoutMatch?.[1]) {
    return `timed out after ${timeoutMatch[1]}ms.`;
  }
  return undefined;
}

function runtimeControlStepErrorEvidence(args: {
  label: string;
  operation: WorkbenchRuntimeControlOperation;
  result: Awaited<ReturnType<typeof runRuntimeControlShellCommand>>;
  error: string;
}): Json {
  const model = runtimeControlInvocationModel(args.operation);
  return {
    label: args.label,
    operation: args.operation.operation,
    adapter: args.operation.invocation.use,
    ...(model ? { model } : {}),
    error: args.error,
    status: args.result.status,
    ...(args.result.error?.message ? { cause: args.result.error.message } : {}),
  };
}

function runtimeControlStepDescriptor(operation: WorkbenchRuntimeControlOperation): string {
  const model = runtimeControlInvocationModel(operation);
  return `${operation.operation} via ${operation.invocation.use}${model ? ` model ${model}` : ""}`;
}

function runtimeControlInvocationModel(operation: WorkbenchRuntimeControlOperation): string | undefined {
  const model = asRuntimeRecord(operation.invocation.with).model;
  return typeof model === "string" && model.trim() ? model.trim() : undefined;
}

async function stageRuntimeControlWorkspace(args: {
  args: WorkbenchExecutionRuntimeInput;
  execution: WorkbenchExecutionSpec;
  workspace: string;
  request: NonNullable<WorkbenchExecutionRuntimeInput["runtimeControlOperation"]>;
}): Promise<void> {
  await fs.rm(args.workspace, { recursive: true, force: true }).catch(() => undefined);
  const jobInput = asRuntimeRecord(args.args.job.input);
  const skillRoot = args.execution.purpose === "improve"
    ? runtimeControlSkillDir(args.workspace, args.execution, jobInput)
    : runtimeControlSkillsDir(args.workspace);
  await fs.mkdir(skillRoot, { recursive: true });
  await fs.mkdir(runtimeControlCaseDir(args.workspace), { recursive: true });
  await fs.mkdir(runtimeControlTraceDir(args.workspace), { recursive: true });
  await fs.mkdir(runtimeControlOutputDir(args.workspace), { recursive: true });
  const input = args.request.inputs;
  await writeSurfaceFiles(
    skillRoot,
    runtimeControlInputFiles(input?.skill, args.args.baseFiles),
  );
  await writeSurfaceFiles(
    runtimeControlCaseDir(args.workspace),
    runtimeControlInputFiles(input?.case, selectRuntimeControlCaseFiles(args.args, args.execution)),
  );
  await writeSurfaceFiles(
    runtimeControlTraceDir(args.workspace),
    runtimeControlInputFiles(input?.traces, args.args.traceFiles ?? []),
  );
  await writeSurfaceFiles(
    runtimeControlEnginePrivateDir(args.workspace),
    runtimeControlInputFiles(input?.enginePrivate, selectRuntimeControlEnginePrivateFiles(args.args, args.execution)),
  );
  if (input?.workspace) {
    await writeSurfaceFiles(args.workspace, runtimeControlInputFiles(input.workspace, []));
  }
  if (input?.output) {
    await writeSurfaceFiles(runtimeControlOutputDir(args.workspace), runtimeControlInputFiles(input.output, []));
  }
}

function selectRuntimeControlCaseFiles(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
): SurfaceSnapshotFile[] {
  const caseId = runtimeControlCaseId(args, execution);
  const engineCase = args.engineCases.find((entry) => entry.id === caseId);
  return (engineCase?.files.public ?? args.engineResolveFiles).map(copyFile);
}

function selectRuntimeControlEnginePrivateFiles(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
): SurfaceSnapshotFile[] {
  const caseId = runtimeControlCaseId(args, execution);
  const engineCase = args.engineCases.find((entry) => entry.id === caseId);
  return (engineCase?.files.private ?? []).map(copyFile);
}

function runtimeControlCaseId(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
): string {
  const input = asRuntimeRecord(args.job.input);
  const metadata = asRuntimeRecord(execution.metadata);
  return typeof input.caseId === "string"
    ? input.caseId
    : typeof metadata.caseId === "string"
      ? metadata.caseId
      : args.engineCases[0]?.id ?? "current";
}

function runtimeControlInputFiles(
  files: readonly SurfaceSnapshotFile[] | undefined,
  fallback: readonly SurfaceSnapshotFile[],
): SurfaceSnapshotFile[] {
  return (files ?? fallback).map(copyFile);
}

async function writeRuntimeControlAdapterRequest(args: {
  args: WorkbenchExecutionRuntimeInput;
  execution: WorkbenchExecutionSpec;
  workspace: string;
  operation: WorkbenchRuntimeControlOperation;
  label: string;
  index: number;
}): Promise<string> {
  const requestPath = path.join(args.workspace, ".workbench", "runtime-control", `${args.label}.json`);
  const input = asRuntimeRecord(args.args.job.input);
  const caseId = runtimeControlCaseId(args.args, args.execution);
  const casePrompt = args.args.engineCases.find((entry) => entry.id === caseId)?.case.prompt;
  const requestId = `${args.execution.id}:${args.label}:${args.index}`;
  const payload: Record<string, unknown> = {
    protocol: "workbench.adapter.v3",
    id: requestId,
    jobId: args.args.job.id,
    ...(args.args.progress ? {
      progress: {
        projectId: args.args.job.projectId,
        runId: args.args.job.runId,
        jobId: args.args.job.id,
        executionId: requestId,
        attempt: Math.max(1, args.args.job.attempt || 1),
        target: args.args.progress,
      },
    } : {}),
    operation: args.operation.operation,
    invocation: {
      use: args.operation.invocation.use,
      with: args.operation.invocation.with ?? {},
      ...(args.operation.invocation.auth !== undefined ? { auth: args.operation.invocation.auth } : {}),
    },
    ...(adapterAuthRequestForStep(args.args, args.operation.invocation.use) !== undefined
      ? { auth: adapterAuthRequestForStep(args.args, args.operation.invocation.use) }
      : {}),
    context: {
      eval: {
        name: args.args.spec.eval.name,
        description: args.args.spec.eval.description,
      },
      skill: {
        id: typeof input.versionId === "string" ? input.versionId : args.execution.versionId,
        path: args.args.spec.skill.files.path,
        ...(args.args.spec.skill.prepare ? { prepare: { ...args.args.spec.skill.prepare } } : {}),
        run: {
          use: args.args.spec.run.use,
          with: args.args.spec.run.with ?? {},
          ...(args.args.spec.run.auth !== undefined ? { auth: args.args.spec.run.auth } : {}),
          command: runtimeControlSpecRunCommand(args.args),
        },
      },
      ...(args.args.spec.skill.improve
        ? { improve: { edits: [...args.args.spec.skill.improve.edits] } }
        : {}),
      attempt: {
        attemptIndex: typeof input.attemptIndex === "number" ? input.attemptIndex : 0,
        sampleIndex: typeof input.sampleIndex === "number" ? input.sampleIndex : 0,
        caseId,
      },
      case: {
        id: caseId,
        ...(casePrompt ? { prompt: casePrompt } : {}),
      },
    },
    paths: {
      workspace: args.workspace,
      output: runtimeControlOutputDir(args.workspace),
      result: workbenchAdapterOperationResultPath(runtimeControlOutputDir(args.workspace)),
      skill: runtimeControlSkillDir(args.workspace, args.execution, input),
      skills: runtimeControlSkillsDir(args.workspace),
      case: runtimeControlCaseDir(args.workspace),
      traces: runtimeControlTraceDir(args.workspace),
      enginePrivate: runtimeControlEnginePrivateDir(args.workspace),
    },
  };
  await fs.mkdir(path.dirname(requestPath), { recursive: true });
  await fs.writeFile(requestPath, `${JSON.stringify(payload, null, 2)}\n`);
  await writeSurfaceFiles(runtimeControlOutputDir(args.workspace), [
    textFile(
      `.workbench/traces/${args.args.job.id}/${args.label}/request.json`,
      `${JSON.stringify(sanitizeRuntimeControlTracePayload(payload), null, 2)}\n`,
    ),
  ]);
  return requestPath;
}

function runtimeControlSpecRunCommand(args: WorkbenchExecutionRuntimeInput): string {
  const manifest = args.adapterManifests?.find((entry) => entry.id === args.spec.run.use);
  if (manifest) {
    return workbenchAdapterOperationCommand(manifest, "skill.run");
  }
  return `workbench-adapter-${args.spec.run.use}`;
}

function runtimeControlOperationCommand(
  operation: WorkbenchRuntimeControlOperation,
  manifests: readonly WorkbenchAdapterManifest[] | undefined,
): string {
  const explicit = operation.invocation.command?.trim();
  if (explicit) {
    return explicit;
  }
  const manifest = manifests?.find((entry) => entry.id === operation.invocation.use);
  if (manifest) {
    return workbenchAdapterOperationCommand(manifest, operation.operation);
  }
  return `workbench-adapter-${operation.invocation.use}`;
}

function runtimeControlOperationLabel(
  operation: WorkbenchRuntimeControlOperation,
  index: number,
): string {
  const label = operation.label?.trim();
  return (label || `${operation.operation.replace(/[^a-z0-9_-]+/giu, "_")}_${index + 1}`)
    .replace(/[^a-z0-9._-]+/giu, "_");
}

function runtimeControlAdapterEnv(args: {
  requestPath: string;
  outputDir: string;
  timeoutMs: number;
  adapterEnv?: Record<string, string>;
  runtimeEnv?: Record<string, string>;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(args.adapterEnv ?? {}),
    ...(args.runtimeEnv ?? {}),
    PATH: runtimeControlAdapterCommandPath([
      args.runtimeEnv?.PATH,
      args.adapterEnv?.PATH,
      process.env.PATH,
    ]),
    WORKBENCH_ADAPTER_REQUEST: args.requestPath,
    WORKBENCH_OUTPUT: args.outputDir,
    WORKBENCH_RESULT: workbenchAdapterOperationResultPath(args.outputDir),
    [WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS_ENV]: String(args.timeoutMs),
  };
}

const RUNTIME_CONTROL_SYSTEM_PATH_ENTRIES = [
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
];

function runtimeControlAdapterCommandPath(basePaths: readonly (string | undefined)[]): string {
  return uniquePathEntries([
    ...nodeModuleBinDirsForAncestors(process.cwd()),
    ...nodeModuleBinDirsForAncestors(path.dirname(fileURLToPath(import.meta.url))),
    ...basePaths.flatMap((entry) => entry ? entry.split(path.delimiter) : []),
    path.dirname(process.execPath),
    ...RUNTIME_CONTROL_SYSTEM_PATH_ENTRIES,
  ]).join(path.delimiter);
}

function nodeModuleBinDirsForAncestors(start: string): string[] {
  const dirs: string[] = [];
  let current = path.resolve(start);
  for (let depth = 0; depth < 12; depth += 1) {
    dirs.push(path.join(current, "node_modules", ".bin"));
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return dirs;
}

function uniquePathEntries(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
}

async function runRuntimeControlShellCommand(
  command: string,
  options: {
    cwd: string;
    timeout: number;
    env: NodeJS.ProcessEnv;
    progressTarget?: WorkbenchExecutionProgressTarget;
  },
): Promise<{
  stdout: string;
  stderr: string;
  status: number | null;
  error?: Error;
}> {
  const maxBuffer = 20 * 1024 * 1024;
  return await new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let bufferError: Error | undefined;
    const progressPublishes: Promise<void>[] = [];
    const progressParser = options.progressTarget
      ? createWorkbenchProgressStdoutParser((envelope) => {
          progressPublishes.push(
            publishWorkbenchProgressStdoutEnvelope(envelope, options.progressTarget, {
              forwardStdout: true,
            })
              .catch(() => undefined),
          );
        })
      : null;
    const child = spawn("sh", ["-c", command], {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killRuntimeControlChild(child, "SIGKILL");
    }, options.timeout);
    const settle = (status: number | null, error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      progressParser?.flush();
      const result = {
        stdout: sanitizeRuntimeControlStdout(Buffer.concat(stdoutChunks).toString("utf8")),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        status,
        ...(error ? { error } : {}),
      };
      Promise.allSettled(progressPublishes).then(() => resolve(result));
    };
    const collect = (chunks: Buffer[], bytes: "stdout" | "stderr", chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (bytes === "stdout") {
        stdoutBytes += buffer.length;
      } else {
        stderrBytes += buffer.length;
      }
      if (stdoutBytes + stderrBytes > maxBuffer && !bufferError) {
        bufferError = new Error("Runtime-control step output exceeded 20MiB.");
        killRuntimeControlChild(child, "SIGKILL");
        return;
      }
      if (bytes === "stdout") {
        progressParser?.write(buffer);
      }
      chunks.push(buffer);
    };
    child.stdout?.on("data", (chunk: Buffer | string) => collect(stdoutChunks, "stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer | string) => collect(stderrChunks, "stderr", chunk));
    child.on("error", (error) => settle(null, error));
    child.on("exit", (code, signal) => {
      if (bufferError) {
        settle(code, bufferError);
        return;
      }
      if (timedOut) {
        settle(code, new Error(`Runtime-control step timed out after ${options.timeout}ms.`));
        return;
      }
      if (code === null && signal) {
        settle(code, new Error(`Runtime-control step exited from signal ${signal}.`));
        return;
      }
      settle(code);
    });
  });
}

function sanitizeRuntimeControlStdout(stdout: string): string {
  if (!stdout.includes(WORKBENCH_PROGRESS_STDOUT_PREFIX)) {
    return stdout;
  }
  const escapedPrefix = WORKBENCH_PROGRESS_STDOUT_PREFIX.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return stdout.replace(new RegExp(`${escapedPrefix}[^\\r\\n]*(?:\\r\\n|\\n|\\r|$)`, "gu"), "");
}

function killRuntimeControlChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to killing the shell process if process-group termination is unavailable.
    }
  }
  child.kill(signal);
}

async function runtimeControlCollectedFiles(root: string): Promise<SurfaceSnapshotFile[]> {
  const outputRoot = runtimeControlOutputDir(root);
  const outputFiles = (await readFilesUnder(outputRoot, ""))
    .filter((file) =>
      !isWorkbenchInternalOutputPath(file.path)
    );
  const traceFiles = await readFilesUnder(path.join(outputRoot, ".workbench", "traces"), ".workbench/traces");
  return [...outputFiles, ...traceFiles]
    .map(copyFile)
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function runtimeControlCollectedWorkspaceFiles(root: string): Promise<SurfaceSnapshotFile[]> {
  return (await readFilesUnder(root, ""))
    .filter((file) => isRuntimeControlWorkspaceOutputPath(file.path))
    .map(copyFile)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function isRuntimeControlWorkspaceOutputPath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  return Boolean(normalized) &&
    normalized !== "." &&
    !normalized.startsWith("input/") &&
    normalized !== "input" &&
    !normalized.startsWith("output/") &&
    normalized !== "output" &&
    !normalized.startsWith("private/") &&
    normalized !== "private" &&
    !normalized.startsWith(".workbench/") &&
    normalized !== ".workbench" &&
    !isWorkbenchInternalOutputPath(normalized);
}

function adapterOperationUsageSummary(
  result: WorkbenchAdapterOperationResult,
): UsageSummary | undefined {
  if (result.operation === "skill.improve") {
    return usageHasAssignedRoles(result.usage) ? result.usage : assignUsageRole("improver", result.usage);
  }
  if (result.operation === "skill.run") {
    return usageHasAssignedRoles(result.usage) ? result.usage : assignUsageRole("runner", result.usage);
  }
  if (result.operation === "engine.run") {
    return usageHasAssignedRoles(result.usage) ? result.usage : assignUsageRole("engine", result.usage);
  }
  return result.usage;
}

function usageHasAssignedRoles(usage: UsageSummary | undefined): boolean {
  return Boolean(usage?.improver || usage?.runner || usage?.engine);
}

function runtimeControlJobOutput(
  result: WorkbenchRuntimeControlOperationSequenceResult,
): Record<string, Json> {
  const skillPatch = [...result.operationResults].reverse()
    .find((entry) => entry.operation === "skill.improve")
    ?.value;
  return {
    ok: result.ok,
    files: result.files as unknown as Json,
    fileChanges: result.fileChanges as unknown as Json,
    operationResults: result.operationResults as unknown as Json,
    ...(isJsonPayload(skillPatch) ? { skillPatch } : {}),
    ...(result.workspaceFiles ? { workspaceFiles: result.workspaceFiles as unknown as Json } : {}),
    ...(result.result ? { result: result.result as unknown as Json } : {}),
    ...(result.usage ? { usage: result.usage as unknown as Json } : {}),
    ...(result.summary !== undefined ? { summary: result.summary } : {}),
    ...(result.feedback !== undefined ? { feedback: result.feedback } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}

function sanitizeRuntimeControlTracePayload(value: unknown): Json {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeRuntimeControlTracePayload(entry)) as unknown as Json;
  }
  if (!value || typeof value !== "object") {
    return (value ?? null) as Json;
  }
  const sanitized: Record<string, Json> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "auth" || key === "enginePrivate") {
      continue;
    }
    sanitized[key] = sanitizeRuntimeControlTracePayload(entry);
  }
  return sanitized as unknown as Json;
}

function runtimeControlSkillsDir(root: string): string {
  return path.join(root, "input", "skills");
}

function runtimeControlEntrySkillDir(root: string, skillName = PRIMARY_SKILL_NAME): string {
  return path.join(runtimeControlSkillsDir(root), skillName);
}

function runtimeControlSkillDir(root: string, execution?: WorkbenchExecutionSpec, jobInput?: Record<string, unknown>): string {
  if (execution?.purpose === "improve") {
    return root;
  }
  const skillName = typeof jobInput?.skillName === "string" && jobInput.skillName.trim()
    ? jobInput.skillName.trim()
    : PRIMARY_SKILL_NAME;
  return runtimeControlEntrySkillDir(root, skillName);
}

function runtimeControlCaseDir(root: string): string {
  return path.join(root, "input", "case");
}

function runtimeControlTraceDir(root: string): string {
  return path.join(root, "input", "traces");
}

function runtimeControlEnginePrivateDir(root: string): string {
  return path.join(root, "private", "engine");
}

function runtimeControlOutputDir(root: string): string {
  return path.join(root, "output");
}

async function executeProviderSkillEvalExecutionInCurrentRuntime(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
  startedAt: string,
): Promise<RemoteWorkbenchJob> {
  const workspace = path.resolve(args.workspaceRoot ?? "/workspace");
  const runner = await runRuntimeControlOperationSequence({
    args: {
      ...args,
      runtimeControlOperation: {
        inputs: {
          skill: args.baseFiles.map(copyFile),
          case: selectRuntimeControlCaseFiles(args, execution),
          enginePrivate: [],
          traces: (args.traceFiles ?? []).map(copyFile),
        },
        collectWorkspace: true,
        operations: [{
          label: "skill",
          operation: "skill.run",
          invocation: adapterInvocationForRuntimeControl(args.spec.run),
        }],
      },
    },
    execution,
    startedAt,
    workspace,
    stepPrefix: "Adapter step",
  });
  if (!runner.ok) {
    return completedSkillEvalOperationSequenceJob(args.job, startedAt, execution, runner);
  }

  const scorer = await runRuntimeControlOperationSequence({
    args: {
      ...args,
      runtimeControlOperation: {
        inputs: {
          skill: args.baseFiles.map(copyFile),
          case: selectRuntimeControlCaseFiles(args, execution),
          enginePrivate: selectRuntimeControlEnginePrivateFiles(args, execution),
          traces: (args.traceFiles ?? []).map(copyFile),
          workspace: (runner.workspaceFiles ?? []).map(copyFile),
          output: runner.files.map(copyFile),
        },
        operations: [{
          label: "score",
          operation: "engine.run",
          invocation: adapterInvocationForRuntimeControl(skillEvalScoreInvocationFromSpec(args.spec)),
        }],
      },
    },
    execution,
    startedAt,
    workspace,
    stepPrefix: "Adapter step",
  });
  return completedSkillEvalOperationSequenceJob(
    args.job,
    startedAt,
    execution,
    mergeSkillEvalOperationSequenceResults(runner, scorer),
  );
}

function adapterInvocationForRuntimeControl(
  invocation: WorkbenchAdapterInvocation,
): WorkbenchRuntimeControlOperation["invocation"] {
  return {
    use: invocation.use,
    with: invocation.with ?? {},
    ...(invocation.auth !== undefined ? { auth: invocation.auth } : {}),
  };
}

function skillEvalScoreInvocationFromSpec(spec: GenericRunSpec): WorkbenchAdapterInvocation {
  const use = typeof spec.engineRun.use === "string" && spec.engineRun.use.trim()
    ? spec.engineRun.use.trim()
    : "";
  if (!use) {
    throw new Error("Skill eval provider execution requires a score adapter.");
  }
  return {
    use,
    with: spec.engineRun.with ?? {},
    ...(spec.engineRun.auth !== undefined ? { auth: spec.engineRun.auth } : {}),
  };
}

function mergeSkillEvalOperationSequenceResults(
  runner: WorkbenchRuntimeControlOperationSequenceResult,
  scorer: WorkbenchRuntimeControlOperationSequenceResult,
): WorkbenchRuntimeControlOperationSequenceResult {
  const operationResults = [...runner.operationResults, ...scorer.operationResults];
  const files = dedupeRuntimeSurfaceFiles([...runner.files, ...scorer.files]);
  const workspaceFiles = dedupeRuntimeSurfaceFiles([
    ...(runner.workspaceFiles ?? []),
    ...(scorer.workspaceFiles ?? []),
  ]);
  return {
    ok: runner.ok && scorer.ok,
    files,
    fileChanges: files.map((file) => file.path),
    operationResults,
    ...(workspaceFiles.length > 0 ? { workspaceFiles } : {}),
    ...(scorer.result ? { result: scorer.result } : runner.result ? { result: runner.result } : {}),
    usage: mergeUsageSummaries([runner.usage, scorer.usage, mergeUsageSummaries(operationResults.map(adapterOperationUsageSummary))]),
    ...(scorer.summary !== undefined ? { summary: scorer.summary } : runner.summary !== undefined ? { summary: runner.summary } : {}),
    ...(scorer.feedback !== undefined ? { feedback: scorer.feedback } : runner.feedback !== undefined ? { feedback: runner.feedback } : {}),
    ...(scorer.error ? { error: scorer.error } : runner.error ? { error: runner.error } : {}),
  };
}

function completedSkillEvalOperationSequenceJob(
  job: RemoteWorkbenchJob,
  startedAt: string,
  execution: WorkbenchExecutionSpec,
  result: WorkbenchRuntimeControlOperationSequenceResult,
): RemoteWorkbenchJob {
  const finishedAt = now();
  return {
    ...job,
    status: result.ok ? "succeeded" : "failed",
    attempt: Math.max(1, job.attempt),
    startedAt,
    finishedAt,
    updatedAt: finishedAt,
    ...(result.ok ? {} : { error: result.error ?? "Skill eval adapter sequence failed." }),
    output: {
      ...runtimeControlJobOutput(result),
      executionId: execution.id,
      purpose: execution.purpose,
    } as unknown as Json,
  };
}

function dedupeRuntimeSurfaceFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
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

async function executeSkillEvalExecutionInCurrentRuntime(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
  startedAt: string,
): Promise<RemoteWorkbenchJob> {
  const workspace = path.resolve(args.workspaceRoot ?? "/workspace");
  const skillsDir = path.join(workspace, "input", "skills");
  const metadata = asRuntimeRecord(execution.metadata);
  const entrySkill = typeof metadata.skillName === "string" && metadata.skillName.trim()
    ? metadata.skillName.trim()
    : PRIMARY_SKILL_NAME;
  const skillDir = path.join(skillsDir, entrySkill);
  const caseDir = path.join(workspace, "input", "case");
  const outputDir = path.join(workspace, "output");
  const command = configString(asRuntimeRecord(execution.adapter.with) as Record<string, Json>, "command") ??
    "if [ -x \"$CASE_DIR/tests/test.sh\" ]; then \"$CASE_DIR/tests/test.sh\"; elif [ -f \"$CASE_DIR/tests/test.sh\" ]; then sh \"$CASE_DIR/tests/test.sh\"; elif [ -x \"$CASE_DIR/test.sh\" ]; then \"$CASE_DIR/test.sh\"; elif [ -f \"$CASE_DIR/test.sh\" ]; then sh \"$CASE_DIR/test.sh\"; else echo \"Workbench case has no command or test.sh\" >&2; exit 2; fi";
  const timeoutMs = Math.max(1000, execution.policy.resources.timeoutMinutes * 60_000);
  await fs.rm(skillsDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(caseDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(skillDir, { recursive: true });
  await writeSurfaceFiles(skillsDir, args.baseFiles);
  await writeSurfaceFiles(caseDir, args.engineResolveFiles);
  const startedMs = Date.now();
  const result = spawnSync("sh", ["-lc", command], {
    cwd: workspace,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      SKILL_DIR: skillDir,
      SKILLS_DIR: skillsDir,
      CASE_DIR: caseDir,
      OUTPUT_DIR: outputDir,
      WORKBENCH_CASE_ID: typeof execution.metadata.caseId === "string" ? execution.metadata.caseId : "current",
    },
  });
  const finishedAt = new Date().toISOString();
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exitCode = result.status ?? undefined;
  const outputFiles = await readFilesUnder(outputDir, "output").catch(() => []);
  const commandSucceeded = result.status === 0 && !result.error;
  const adapterResult = commandSucceeded && await exists(workbenchAdapterOperationResultPath(outputDir))
    ? await readWorkbenchAdapterOperationResult(outputDir, "engine.run")
    : null;
  const succeeded = commandSucceeded && adapterResult?.ok !== false;
  const error = result.error
    ? result.error.message
    : result.status !== 0
      ? (stderr || stdout || `Command exited with status ${result.status ?? "unknown"}`).trim()
    : adapterResult?.ok === false
      ? adapterResult.summary ?? "Command engine returned ok false."
      : undefined;
  const resultPayload = workbenchResultFromAdapterResult(adapterResult) ??
    skillEvalResultPayload({
      succeeded,
      exitCode,
      durationMs: Math.max(0, Date.now() - startedMs),
      stdout,
      stderr,
      error,
      caseId: typeof execution.metadata.caseId === "string" ? execution.metadata.caseId : "current",
    });
  const files = [
    textFile("stdout.log", stdout),
    textFile("stderr.log", stderr),
    ...outputFiles.map(copyFile),
  ];
  return {
    ...args.job,
    status: succeeded ? "succeeded" : "failed",
    attempt: Math.max(1, args.job.attempt),
    startedAt,
    finishedAt,
    updatedAt: finishedAt,
    ...(error ? { error } : {}),
    output: {
      ok: succeeded,
      executionId: execution.id,
      purpose: execution.purpose,
      result: resultPayload,
      files,
      metrics: resultPayload.metrics,
      cases: resultPayload.cases,
      summary: adapterResult?.summary ?? resultPayload.summary,
    } as unknown as Json,
  };
}

function workbenchResultFromAdapterResult(
  result: WorkbenchAdapterOperationResult | null,
): WorkbenchResult | null {
  const value = result?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as WorkbenchResult;
}

function skillEvalResultPayload(args: {
  succeeded: boolean;
  exitCode: number | undefined;
  durationMs: number;
  stdout: string;
  stderr: string;
  error: string | undefined;
  caseId: string;
}): WorkbenchResult {
  return {
    score: args.succeeded ? 1 : 0,
    metrics: {
      score: args.succeeded ? 1 : 0,
    },
    cases: [{
      id: args.caseId,
      status: args.succeeded ? "completed" : "error",
      durationMs: args.durationMs,
      metrics: {
        score: args.succeeded ? 1 : 0,
      },
      ...(args.error ? { feedback: { error: args.error } } : {}),
    }],
    summary: args.succeeded ? "Skill eval test passed." : args.error ?? "Skill eval test failed.",
    feedback: {
      exitCode: args.exitCode ?? null,
      stdoutBytes: Buffer.byteLength(args.stdout),
      stderrBytes: Buffer.byteLength(args.stderr),
    },
  };
}

function workbenchAdapterOperationExecutorShim(
  manifest: WorkbenchAdapterManifest,
  operation: WorkbenchAdapterOperation,
): WorkbenchAdapterOperationExecutor {
  const entry = manifest.operations[operation];
  return entry?.executor === "host" ? "host" : "sandbox";
}

function completedRemoteJobFromSandboxResult(
  fallbackJob: RemoteWorkbenchJob,
  startedAt: string,
  result: WorkbenchExecutionResult,
): RemoteWorkbenchJob {
  const completedJob = asRuntimeRecord(result.metadata).completedJob;
  if (
    completedJob &&
    typeof completedJob === "object" &&
    !Array.isArray(completedJob)
  ) {
    return completedJob as RemoteWorkbenchJob;
  }
  if (result.status === "succeeded") {
    return failRemoteWorkbenchJob(
      fallbackJob,
      result.startedAt || startedAt,
      `Sandbox execution ${result.executionId} succeeded without returning a completed job.`,
      result.finishedAt,
    );
  }
  return attachSandboxMetadataToJob(
    failRemoteWorkbenchJob(
      fallbackJob,
      result.startedAt || startedAt,
      result.error ?? `Sandbox execution ${result.status}.`,
      result.finishedAt,
    ),
    asRuntimeRecord(result.metadata).sandbox,
  );
}

function failRemoteWorkbenchJob(
  job: RemoteWorkbenchJob,
  startedAt: string,
  error: unknown,
  finishedAt = new Date().toISOString(),
): RemoteWorkbenchJob {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...job,
    status: "failed",
    attempt: Math.max(1, job.attempt),
    startedAt,
    finishedAt,
    updatedAt: finishedAt,
    error: message,
    output: {
      ok: false,
      error: message,
    },
  };
}

export function isWorkbenchInternalOutputPath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  return (
    normalized === ".workbench" ||
    normalized.startsWith(".workbench/") ||
    normalized === "workbench-result.json" ||
    normalized === "sandbox-environment.json" ||
    normalized === "sandbox_error.log" ||
    normalized === "exit_code" ||
    /^[a-z_-]+_(stdout\.log|stderr\.log|exit_code)$/u.test(normalized)
  );
}

export interface WorkbenchImproveOptions extends WorkbenchCommandOptions {
  version?: string;
  skill?: string;
  agent?: string;
  budget?: number;
  samples?: number;
  parentRunId?: string;
  evidenceTraceIds?: readonly string[];
}

export interface WorkbenchImproveResult {
  run: WorkbenchRun;
  version: WorkbenchVersion;
  switched: boolean;
  promoted: boolean;
  promotionReason: string;
  incumbentRunId?: string;
  incumbentScore?: number;
  outputScore?: number;
}

export interface WorkbenchCompareOptions extends WorkbenchCommandOptions {
  versions?: string;
  skills?: string;
  agents?: string;
}

export interface WorkbenchRemoteOptions extends WorkbenchCommandOptions {
  remote?: string;
  authToken?: string;
  dryRun?: boolean;
}

export interface WorkbenchPublishOptions extends WorkbenchCommandOptions {
  version?: string;
  remote?: string;
  visibility?: WorkbenchPublishVisibility;
  authToken?: string;
  dryRun?: boolean;
}

export type WorkbenchPublishVisibility = "private" | "internal" | "public";

export interface WorkbenchPublishResult {
  remote: WorkbenchRemote;
  version: WorkbenchVersion;
  visibility: WorkbenchPublishVisibility;
  installUrl: string;
  pinnedInstallUrl: string;
  dryRun?: boolean;
}

export interface WorkbenchAddRemoteOptions extends WorkbenchCommandOptions {
  replace?: boolean;
  dryRun?: boolean;
}

export interface WorkbenchAddRemoteResult {
  remote: WorkbenchRemote;
  operation: "added" | "unchanged" | "replaced";
  dryRun?: boolean;
}

export interface WorkbenchSyncResult {
  remote: WorkbenchRemote;
  pushed: number;
  pulled: number;
  upToDate: boolean;
  dryRun?: boolean;
  publication?: {
    status: "published" | "unpublished";
    visibility?: string;
    versionId?: string;
    installUrl?: string;
    pinnedInstallUrl?: string;
  };
}

export interface WorkbenchDiffEntry {
  path: string;
  status: "added" | "removed" | "modified";
  before?: string;
  after?: string;
}

export interface WorkbenchCaseRecord {
  id: string;
  path: string;
  content: string;
}

export interface WorkbenchQueuedSkillEvalJobInput {
  kind: "workbench.skill.eval.job.v1";
  ownerUserId?: string;
  skillId?: string;
  runId: string;
  jobId: string;
  artifactId?: string;
  traceId?: string;
  versionId: string;
  evalHash: string;
  agentName: string;
  caseId: string;
  sample: number;
  state: WorkbenchProjectState;
  adapterAuthProfiles?: readonly WorkbenchAdapterAuthBundle[];
}

export interface WorkbenchEvalCaseRuntime extends WorkbenchCaseRecord {
  files: SurfaceSnapshotFile[];
  command?: string;
  smoke?: boolean;
}

export interface WorkbenchSkillEvalRuntimeInputArgs {
  ownerUserId: string;
  projectId: string;
  runId: string;
  jobId: string;
  versionId: string;
  evalHash: string;
  evalSnapshot: WorkbenchEvalSnapshot;
  skillName?: string;
  skillBundleHash?: string;
  agent: WorkbenchAgent;
  versionFiles: readonly SurfaceSnapshotFile[];
  runtimeCase: WorkbenchEvalCaseRuntime;
  sample: number;
  createdAt?: string;
  attempt?: number;
  environmentDockerfile?: string;
  environmentImageRef?: string;
}

export interface WorkbenchSkillImproveRuntimeInputArgs {
  ownerUserId: string;
  projectId: string;
  runId: string;
  jobId: string;
  baseVersionId: string;
  evalHash: string;
  skillName?: string;
  skillBundleHash?: string;
  agent: WorkbenchAgent;
  baseFiles: readonly SurfaceSnapshotFile[];
  traces: readonly WorkbenchTrace[];
  createdAt?: string;
  attempt?: number;
  environmentDockerfile?: string;
  environmentImageRef?: string;
}

export interface WorkbenchSkillImprovementPatchApplication {
  state: WorkbenchProjectState;
  version: WorkbenchVersion;
  created: boolean;
}

const WORKBENCH_DIR = ".workbench";
const OBJECTS_DIR = "objects";
const REFS_DIR = "refs";
const SYNC_DIR = "sync";
const TMP_DIR = "tmp";
const LOGS_DIR = "logs";
const LOCKS_DIR = "locks";
const PROJECT_LOCK_DIR = "project.lock";
const REMOTES_FILE = "remotes.yaml";
const WORKBENCH_GITIGNORE_FILE = ".gitignore";
const EVAL_FILE = "eval.yaml";
const CASES_DIR = "cases";
const ENVIRONMENT_DIR = "environment";
const AGENTS_FILE = "agents.yaml";
const SKILLS_FILE = "skills.yaml";
const SKILL_FILE = "SKILL.md";
const PRIMARY_SKILL_NAME = "primary";
const ALL_SELECTOR = "all";
const STATE_SCHEMA = "workbench.skill.state.v1";
const PACK_SCHEMA = "workbench.object-pack.v1";
const DEFAULT_SKILL_RUNTIME_IMAGE = "workbench/workbench-node-22:envv_node_22";
const PROJECT_LOCK_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const PROJECT_LOCK_RETRY_MS = 50;
const DEFAULT_SKILL_ENVIRONMENT_DOCKERFILE = [
  "FROM node:22-bookworm-slim",
  "RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*",
  "RUN npm install --global vitest@3.2.4",
  "",
].join("\n");
const HTTP_REMOTE_GZIP_THRESHOLD_BYTES = 1024 * 1024;
const projectLockContext = new AsyncLocalStorage<ReadonlySet<string>>();
const projectLockQueues = new Map<string, Promise<void>>();
const SKILL_EVAL_COMMAND_AGENT_ADAPTERS = new Set(["local", "command"]);
const SKILL_EVAL_PROVIDER_AGENT_ADAPTERS = new Set(["codex", "claude"]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

const IGNORED_SKILL_DIRS = new Set([
  ".git",
  ".workbench",
  "node_modules",
  "dist",
  "__pycache__",
]);

const IGNORED_SKILL_FILES = new Set([
  ".DS_Store",
]);

export async function initWorkbenchSkill(options: WorkbenchCommandOptions = {}): Promise<WorkbenchStatus> {
  const root = resolveRoot(options.dir);
  await fs.mkdir(root, { recursive: true });
  await ensureFile(
    path.join(root, SKILL_FILE),
    [
      "---",
      `name: ${safeName(path.basename(root) || "skill")}`,
      "description: A Workbench-managed skill. Replace this with the workflow trigger.",
      "---",
      "",
      "# Skill",
      "",
      "Use this skill to complete the workflow described by the user. Replace this starter text with concrete instructions, inputs, outputs, and quality checks before treating eval scores as workflow quality.",
      "",
    ].join("\n"),
  );
  const workbenchRoot = workbenchDir(root);
  await fs.mkdir(path.join(workbenchRoot, CASES_DIR), { recursive: true });
  await ensureWorkbenchLocalMetadataIgnore(root);
  await Promise.all([
    fs.mkdir(objectsDir(root), { recursive: true }),
    fs.mkdir(refsDir(root), { recursive: true }),
    fs.mkdir(syncDir(root), { recursive: true }),
    fs.mkdir(path.join(workbenchRoot, TMP_DIR), { recursive: true }),
  ]);
  await ensureFile(
    path.join(workbenchRoot, EVAL_FILE),
    [
      "version: 1",
      `name: ${safeName(path.basename(root) || "skill")}`,
      "description: Starter smoke check for the Workbench skill harness. Replace with workflow-specific cases before interpreting scores as skill quality.",
      "score:",
      "  adapter: tests",
      "",
    ].join("\n"),
  );
  await ensureFile(
    path.join(workbenchRoot, CASES_DIR, "case-001", "case.yaml"),
    [
      "version: 1",
      "id: case-001",
      "smoke: true",
      "prompt: Smoke check the starter skill scaffolding.",
      "rubric:",
      "  - Confirms Workbench can mount the skill and run the local test harness.",
      "  - Does not measure workflow quality until replaced with workflow-specific assertions.",
      "command: sh \"$CASE_DIR/tests/test.sh\"",
      "",
    ].join("\n"),
  );
  await ensureFile(
    path.join(workbenchRoot, CASES_DIR, "case-001", "tests", "test.sh"),
    [
      "#!/bin/sh",
      "set -eu",
      "test -f \"$SKILL_DIR/SKILL.md\"",
      "grep -q '^# Skill' \"$SKILL_DIR/SKILL.md\"",
      "mkdir -p \"$OUTPUT_DIR\"",
      "cp \"$SKILL_DIR/SKILL.md\" \"$OUTPUT_DIR/SKILL.md\"",
      "printf '{\"ok\":true,\"kind\":\"smoke\",\"message\":\"Starter smoke check passed; replace with workflow-specific evals.\"}\\n' > \"$OUTPUT_DIR/result.json\"",
      "",
    ].join("\n"),
  );
  await fs.chmod(path.join(workbenchRoot, CASES_DIR, "case-001", "tests", "test.sh"), 0o755);
  await ensureFile(
    path.join(workbenchRoot, AGENTS_FILE),
    [
      "default: default",
      "agents:",
      "  default:",
      "    adapter: local",
      "    model: docker",
      "    with: {}",
      "",
    ].join("\n"),
  );
  const state = await loadState(root, { allowMissing: true });
  await refreshLocalWorkbenchFiles(root, state);
  await saveState(root, state);
  return workbenchStatus({ dir: root });
}

export async function workbenchStatus(options: WorkbenchCommandOptions = {}): Promise<WorkbenchStatus> {
  const root = resolveRoot(options.dir);
  const initialized = await exists(workbenchDir(root));
  if (!initialized) {
    return {
      root,
      initialized: false,
      versionCount: 0,
      skillCount: 0,
      agentCount: 0,
      runCount: 0,
      remoteCount: 0,
    };
  }
  return withWorkbenchProjectLockRoot(root, async () => workbenchStatusUnlocked(root, options));
}

export async function workbenchStatusSnapshot(options: WorkbenchCommandOptions = {}): Promise<Omit<WorkbenchStatusSnapshot, "auth">> {
  const root = resolveRoot(options.dir);
  const initialized = await exists(workbenchDir(root));
  if (!initialized) {
    return {
      schema: "workbench.status.v1",
      ok: true,
      project: {
        root,
        initialized: false,
      },
      worktree: {
        hasUnversionedChanges: false,
      },
      runs: {
        total: 0,
      },
      remotes: [],
      next: [`workbench init ${root}`],
    };
  }
  return withWorkbenchProjectLockRoot(root, async () => {
    const [state, agents, skillSources, syncStates] = await Promise.all([
      loadState(root),
      readAgents(root),
      readSkillSources(root),
      readRemoteSyncStates(root),
    ]);
    const versionCountBeforeReconcile = state.versions.length;
    const version = await reconcileWorkbenchVersion(root, state, "current source");
    const hasUnversionedChanges = state.versions.length > versionCountBeforeReconcile;
    await saveState(root, state);
    const defaultSkill = await readDefaultSkillSelection(root, skillSources);
    const defaultAgent = await readDefaultAgentSelection(root, agents);
    const latestVersionId = state.versions[state.versions.length - 1]?.id;
    const lastRun = [...state.runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const syncByRemote = new Map(syncStates.map((entry) => [entry.remote, entry]));
    const remotes = Object.values(state.remotes)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((remote) => {
        const syncRecord = syncByRemote.get(remote.name);
        const sync = syncRecord && syncRecord.url === remote.url ? syncRecord : undefined;
        const syncStatus: WorkbenchStatusSnapshot["remotes"][number]["sync"] = sync
          ? {
              status: sync.status === "error" ? "error" : "up_to_date",
              ...(sync.lastSyncedAt ? { lastSyncedAt: sync.lastSyncedAt } : {}),
              lastAttemptAt: sync.lastAttemptAt,
              ...(sync.lastError ? { lastError: sync.lastError } : { lastError: null }),
              ...(sync.status === "error" ? { nextCommand: `workbench sync ${remote.name}` } : {}),
            }
          : { status: "never", lastError: null, nextCommand: `workbench sync ${remote.name}` };
        return {
          name: remote.name,
          kind: remote.kind,
          url: remote.url,
          sync: syncStatus,
          publication: remote.kind === "workbench-cloud"
            ? publicationStatusFromRefs(state.refs, remote.name)
            : unpublishedPublicationStatus(),
        };
      });
    return {
      schema: "workbench.status.v1",
      ok: true,
      project: {
        root,
        initialized: true,
        currentVersionId: version.id,
        defaultSkill,
        defaultAgent,
      },
      worktree: {
        hasUnversionedChanges,
        latestVersionId,
      },
      runs: {
        total: state.runs.length,
        ...(lastRun ? {
          lastRunId: lastRun.id,
          lastStatus: lastRun.status,
          ...(lastRun.score !== undefined ? { lastScore: lastRun.score } : {}),
        } : {}),
      },
      remotes,
      next: statusNextCommands({ state, remotes, defaultAgent }),
    };
  });
}

function statusNextCommands(args: {
  state: WorkbenchProjectState;
  remotes: WorkbenchStatusSnapshot["remotes"];
  defaultAgent?: string;
}): string[] {
  const commands: string[] = [];
  if (args.state.runs.length === 0) {
    commands.push("workbench eval");
  }
  const lastRun = [...args.state.runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (lastRun?.status === "failed" || lastRun?.status === "canceled") {
    commands.push(`workbench trace ${lastRun.id}`);
    commands.push(`workbench improve --agent ${args.defaultAgent ?? "default"} --budget 1 --samples 1`);
  }
  const failedRemote = args.remotes.find((remote) => remote.sync.status === "error");
  if (failedRemote) {
    commands.push(`workbench sync ${failedRemote.name}`);
  }
  const unpublishedRemote = args.remotes.find((remote) =>
    remote.kind === "workbench-cloud" &&
    remote.publication.status === "unpublished" &&
    remote.sync.status === "up_to_date"
  );
  if (unpublishedRemote) {
    commands.push(`workbench publish --remote ${unpublishedRemote.name} --visibility private`);
  }
  const publishedRemote = args.remotes.find((remote) => remote.kind === "workbench-cloud" && remote.publication.installUrl);
  if (publishedRemote?.publication.installUrl) {
    commands.push(`workbench install --source ${publishedRemote.publication.installUrl} --list`);
  }
  return [...new Set(commands)];
}

async function workbenchStatusUnlocked(root: string, options: WorkbenchCommandOptions = {}): Promise<WorkbenchStatus> {
  await autoSyncDefaultRemote(root, options);
  const [state, agents, skillSources] = await Promise.all([
    loadState(root),
    readAgents(root),
    readSkillSources(root),
  ]);
  const version = await reconcileWorkbenchVersion(root, state, "current source");
  await saveState(root, state);
  await autoSyncDefaultRemote(root, options);
  const lastRun = state.runs
    .filter((run) => typeof run.score === "number")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  return {
    root,
    initialized: true,
    currentSkillHash: version.hash,
    currentVersionId: version.id,
    defaultSkill: await readDefaultSkillSelection(root, skillSources),
    defaultAgent: await readDefaultAgentSelection(root, agents),
    versionCount: state.versions.length,
    skillCount: skillSources.length,
    agentCount: agents.length,
    runCount: state.runs.length,
    remoteCount: Object.keys(state.remotes).length,
    pendingSyncCount: await pendingSyncCount(root),
    ...(lastRun?.score !== undefined ? { lastScore: lastRun.score } : {}),
  };
}

export async function checkWorkbenchSkill(options: WorkbenchCommandOptions = {}): Promise<WorkbenchCheckResult> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const [status, evalSnapshot, cases, agents, skillFiles, environmentDockerfile] = await Promise.all([
      workbenchStatus({ dir: root, authToken: options.authToken }),
      readEvalSnapshot(root),
      readEvalCases(root),
      readAgents(root),
      readSkillFiles(root),
      readSkillEvalEnvironmentDockerfile(root),
    ]);
    const state = await loadState(root);
    const version = await resolveOrCreateRunVersion(root, state);
    const skillBundles = await resolveRequestedSkillBundles({
      root,
      state,
      version,
      authToken: options.authToken,
    });
    if (agents.length === 0) {
      throw new WorkbenchUserError("No agents configured. Run `workbench agent add default --adapter local`.");
    }
    return {
      ok: true,
      status,
      cases: evalSnapshot.caseCount,
      skills: skillBundles.length,
      agents: agents.length,
      plan: {
        source: {
          skillFiles: skillFiles.length,
          evalFiles: evalSnapshot.files.length,
          caseCount: cases.length,
          smokeCaseCount: cases.filter((entry) => entry.smoke === true).length,
        },
        skills: skillBundles.map((bundle) => ({
          name: bundle.skillName,
          bundleHash: bundle.hash,
          includedSkillCount: bundle.includedSkills.length,
          fileCount: bundle.files.length,
        })),
        agents: agents.map((agent) => {
          const adapter = agent.adapter.trim().toLowerCase();
          assertSkillEvalAgentSupported(agent);
          const providerBacked = SKILL_EVAL_PROVIDER_AGENT_ADAPTERS.has(adapter);
          return {
            name: agent.name,
            adapter: agent.adapter,
            ...(agent.model ? { model: agent.model } : {}),
            providerBacked,
            executionMode: providerBacked ? "provider-backed" : "local-command",
            network: runtimeNetworkForSkillEval(agent),
            resources: runtimeResourcesForSkillEval(agent),
            image: skillEvalRuntimeSpec(agent, environmentDockerfile).dockerfile,
            ...(providerBacked ? { auth: "local-adapter-auth" as const } : {}),
          };
        }),
      },
    };
  });
}

export async function listWorkbenchVersions(options: WorkbenchCommandOptions = {}): Promise<WorkbenchVersion[]> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    await autoSyncDefaultRemote(root, options);
    const state = await loadState(root);
    await reconcileWorkbenchVersion(root, state, "current source");
    await saveState(root, state);
    await autoSyncDefaultRemote(root, options);
    return [...state.versions].sort(compareVersionIds);
  });
}

export async function evalWorkbenchSkill(options: WorkbenchEvalOptions = {}): Promise<WorkbenchRun[]> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    await autoSyncDefaultRemote(root, options);
    const state = await loadState(root);
    const version = await resolveOrCreateRunVersion(root, state, options.version);
    await saveState(root, state);
    const runtime = await createWorkbenchVersionRuntimeSnapshot(version, {
      skill: options.skill,
      agent: options.agent,
      authToken: options.authToken,
    });
    const agents = runtime.selectedAgents;
    for (const agent of agents) {
      assertSkillEvalAgentSupported(agent);
    }
    const skillBundles = runtime.skillBundles;
    for (const bundle of skillBundles) {
      upsertByHash(state.skillBundles, bundle);
    }
    const evalSnapshot = runtime.evalSnapshot;
    upsertEvalSnapshotObject(state.evals, evalSnapshot);
    upsertAgentSnapshots(state.agents, runtime.agents);
    if (!options.version) {
      state.skillSources = runtime.skillSources.map(copySkillSource);
    }
    const samples = options.samples ?? 1;
    const selected = (options.caseIds?.length ?? 0) > 0 || (options.selectedSamples?.length ?? 0) > 0;
    const reusableCaseCount = selected ? undefined : runtime.cases.length;
    const runs: WorkbenchRun[] = [];
    for (const skillBundle of skillBundles) {
      for (const agent of agents) {
        const reusable = options.rerun === true || selected || (options.kind ?? "eval") !== "eval"
          ? undefined
          : latestReusableEvalRun({
              state,
              versionId: version.id,
              skillName: skillBundle.skillName,
              skillBundleHash: skillBundle.hash,
              evalHash: evalSnapshot.hash,
              agentName: agent.name,
              agentHash: hashJson(agent),
              samples,
              caseCount: reusableCaseCount ?? 0,
            });
        if (reusable) {
          runs.push(copyRun(reusable));
          continue;
        }
        const run = await executeWorkbenchEvaluationRun({
          root,
          state,
          version,
          skillBundle,
          evalSnapshot,
          agent,
          kind: options.kind ?? "eval",
          parentRunId: options.parentRunId,
          samples,
          cases: runtime.cases,
          environmentDockerfile: runtime.environmentDockerfile,
          caseIds: options.caseIds,
          selectedSamples: options.selectedSamples,
        });
        runs.push(run);
      }
    }
    await saveState(root, state);
    await autoSyncDefaultRemote(root, options);
    return runs;
  });
}

export async function evalWorkbenchProjectState(
  state: WorkbenchProjectState,
  options: WorkbenchStateEvalOptions = {},
): Promise<{ state: WorkbenchProjectState; runs: WorkbenchRun[] }> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-cloud-eval-"));
  const originalRoot = state.root;
  try {
    const workingState = copyStateForRoot(state, tempRoot);
    const versionRef = options.version ?? workingState.refs.current;
    const version = versionRef ? resolveVersion(workingState, versionRef) : workingState.versions[0];
    if (!version) {
      throw new WorkbenchUserError("Cannot run eval for a skill with no version.");
    }
    await materializeSkillFiles(tempRoot, version.files);
    if (options.evalHash && (await readEvalSnapshot(tempRoot)).hash !== options.evalHash) {
      throw new WorkbenchUserError(`Eval snapshot ${options.evalHash} is not authored by version ${version.id}.`);
    }
    workingState.remotes = await readWorkbenchRemotesFile(tempRoot);
    workingState.refs.current = version.id;
    await saveState(tempRoot, workingState);
    const runs = await evalWorkbenchSkill({
      dir: tempRoot,
      authToken: options.authToken,
      version: version.id,
      skill: options.skill,
      agent: options.agent,
      samples: options.samples,
      kind: options.kind,
      parentRunId: options.parentRunId,
      caseIds: options.caseIds,
      selectedSamples: options.selectedSamples,
    });
    const nextState = await loadState(tempRoot);
    return {
      state: copyStateForRoot(nextState, originalRoot),
      runs,
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

export async function improveWorkbenchProjectState(
  state: WorkbenchProjectState,
  options: WorkbenchStateImproveOptions = {},
): Promise<{ state: WorkbenchProjectState; runs: WorkbenchRun[] }> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-cloud-improve-"));
  const originalRoot = state.root;
  try {
    const workingState = copyStateForRoot(state, tempRoot);
    const versionRef = options.version ?? workingState.refs.current;
    const version = versionRef ? resolveVersion(workingState, versionRef) : workingState.versions[0];
    if (!version) {
      throw new WorkbenchUserError("Cannot run improve for a skill with no version.");
    }
    await materializeSkillFiles(tempRoot, version.files);
    if (options.evalHash && (await readEvalSnapshot(tempRoot)).hash !== options.evalHash) {
      throw new WorkbenchUserError(`Eval snapshot ${options.evalHash} is not authored by version ${version.id}.`);
    }
    workingState.remotes = await readWorkbenchRemotesFile(tempRoot);
    workingState.refs.current = version.id;
    await saveState(tempRoot, workingState);
    const result = await improveWorkbenchSkill({
      dir: tempRoot,
      authToken: options.authToken,
      version: version.id,
      ...(options.skill !== undefined ? { skill: options.skill } : {}),
      ...(options.agent !== undefined ? { agent: options.agent } : {}),
      ...(options.budget !== undefined ? { budget: options.budget } : {}),
      ...(options.samples !== undefined ? { samples: options.samples } : {}),
      ...(options.parentRunId !== undefined ? { parentRunId: options.parentRunId } : {}),
      ...(options.evidenceTraceIds !== undefined ? { evidenceTraceIds: options.evidenceTraceIds } : {}),
    });
    const nextState = await loadState(tempRoot);
    return {
      state: copyStateForRoot(nextState, originalRoot),
      runs: [result.run],
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

export async function listWorkbenchProjectStateEvalCases(
  state: WorkbenchProjectState,
): Promise<WorkbenchCaseRecord[]> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-cloud-cases-"));
  try {
    await materializeWorkbenchFiles(tempRoot, copyStateForRoot(state, tempRoot));
    return (await readEvalCases(tempRoot)).map((entry) => ({
      id: entry.id,
      path: entry.path,
      content: entry.content,
    }));
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

export async function listWorkbenchProjectStateEvalRuntimeCases(
  state: WorkbenchProjectState,
  evalHash?: string,
): Promise<WorkbenchEvalCaseRuntime[]> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-cloud-runtime-cases-"));
  try {
    await materializeWorkbenchFiles(tempRoot, copyStateForRoot(state, tempRoot), evalHash);
    return (await readEvalCases(tempRoot)).map((entry) => ({
      ...entry,
      files: entry.files.map(copyFile),
    }));
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

export function createWorkbenchSkillEvalRuntimeInput(
  args: WorkbenchSkillEvalRuntimeInputArgs,
): WorkbenchExecutionRuntimeInput {
  const skillName = args.skillName ?? PRIMARY_SKILL_NAME;
  const skillBundleHash = args.skillBundleHash ?? args.versionId;
  assertSkillEvalAgentSupported(args.agent);
  const createdAt = args.createdAt ?? now();
  const command = resolveDockerEvalCommand(args.agent, args.runtimeCase);
  const score = skillEvalScoreInvocation({
    evalSnapshot: args.evalSnapshot,
    agent: args.agent,
    runtimeCase: args.runtimeCase,
  });
  const adapterManifests = skillEvalAdapterManifestsForAgent(args.agent, score);
  const environmentDockerfile = composeSkillRuntimeDockerfileWithAdapterManifests({
    dockerfile: normalizeWorkbenchSkillEvalEnvironmentDockerfile(args.environmentDockerfile),
    manifests: adapterManifests,
    baseImage: skillEvalRuntimeImage(args.agent),
  });
  const plannedEnvironment = skillEvalRuntimeSpec(args.agent, environmentDockerfile);
  const environment = args.environmentImageRef
    ? {
        ...plannedEnvironment,
        dockerfile: dockerRuntimeImageRef(args.environmentImageRef),
      }
    : plannedEnvironment;
  const providerBacked = isProviderBackedSkillEvalAgent(args.agent);
  const spec = genericSpecForSkillEval(args.agent, environment, command, score);
  const engineCaseFiles = providerBacked
    ? providerSkillEvalEngineCaseFiles(args.runtimeCase)
    : {
        public: args.runtimeCase.files.map(copyFile),
        private: [],
        source: args.runtimeCase.files.map(copyFile),
      };
  const engineCase: WorkbenchEngineCase = {
    id: args.runtimeCase.id,
    case: {
      version: 3,
      prompt: args.runtimeCase.content || args.runtimeCase.id,
      environment,
    },
    files: engineCaseFiles,
  };
  const [plannedJob] = planWorkbenchExecutionJobsForPurpose({
    ownerUserId: args.ownerUserId,
    projectId: args.projectId,
    runId: args.runId,
    versionId: args.versionId,
    attemptIndex: args.attempt ?? 0,
    samples: 1,
    caseIds: [args.runtimeCase.id],
    sampleIndexesByCase: new Map([[args.runtimeCase.id, [args.sample]]]),
    spec,
    workflow: "eval",
    purpose: "attempt",
    now: createdAt,
    engineCases: [engineCase],
    environmentRef: environment.dockerfile,
    skillRef: `workbench://skills/${args.projectId}/versions/${args.versionId}`,
    caseRef: `workbench://skills/${args.projectId}/cases/${args.runtimeCase.id}`,
    metadata: {
      skillEval: true,
      versionId: args.versionId,
      skillName,
      skillBundleHash,
      evalHash: args.evalHash,
      agentName: args.agent.name,
      agentAdapter: args.agent.adapter,
      executionAdapter: providerBacked ? args.agent.adapter : "command",
      smoke: args.runtimeCase.smoke === true,
      command,
    },
  });
  if (!plannedJob) {
    throw new Error(`Failed to plan skill eval execution job for case ${args.runtimeCase.id}.`);
  }
  const plannedInput = jsonRecord(plannedJob.input);
  const job: RemoteWorkbenchJob = {
    ...plannedJob,
    id: args.jobId,
    status: "queued",
    attempt: args.attempt ?? 0,
    createdAt,
    updatedAt: createdAt,
    input: {
      ...plannedInput,
      dependsOn: [],
      versionId: args.versionId,
      skillName,
      skillBundleHash,
      evalHash: args.evalHash,
      agentName: args.agent.name,
      caseId: args.runtimeCase.id,
      smoke: args.runtimeCase.smoke === true,
      sampleIndex: args.sample,
      skillEval: true,
    } as unknown as Json,
  };
  return {
    job,
    spec,
    ...(environment.dockerfile.startsWith("dockerfile://") && environmentDockerfile
      ? {
          environmentDockerfile,
          environmentVersion: {
            id: `skill_env_${hashJson(environmentDockerfile).slice(0, 12)}`,
            imageRef: environment.dockerfile,
            sourceHash: hashJson(environmentDockerfile),
            spec: {
              base: "dockerfile",
              resources: runtimeResourcesForSkillEval(args.agent),
              network: runtimeNetworkForSkillEval(args.agent).egress === "open" ? "on" : "off",
            },
          },
        }
      : {}),
    baseFiles: args.versionFiles.map(copyFile),
    engineResolveFiles: (engineCase.files.public ?? []).map(copyFile),
    engineCases: [engineCase],
    adapterManifests,
  };
}

export function createWorkbenchSkillImproveRuntimeInput(
  args: WorkbenchSkillImproveRuntimeInputArgs,
): WorkbenchExecutionRuntimeInput {
  const skillName = args.skillName ?? PRIMARY_SKILL_NAME;
  const skillBundleHash = args.skillBundleHash ?? args.baseVersionId;
  assertSkillEvalAgentSupported(args.agent);
  const createdAt = args.createdAt ?? now();
  const improve = agentImproveAdapterInvocation(args.agent);
  if (!improve) {
    throw new WorkbenchUserError(workbenchSkillImproveAdapterRequirementMessage(args.agent));
  }
  const adapterManifests = skillImproveAdapterManifestsForAgent(args.agent, improve.use);
  const environmentDockerfile = composeSkillRuntimeDockerfileWithAdapterManifests({
    dockerfile: normalizeWorkbenchSkillEvalEnvironmentDockerfile(args.environmentDockerfile),
    manifests: adapterManifests,
    baseImage: skillEvalRuntimeImage(args.agent),
  });
  const plannedEnvironment = skillEvalRuntimeSpec(args.agent, environmentDockerfile);
  const environment = args.environmentImageRef
    ? {
        ...plannedEnvironment,
        dockerfile: dockerRuntimeImageRef(args.environmentImageRef),
      }
    : plannedEnvironment;
  const spec = genericSpecForSkillImprove(args.agent, environment, improve);
  const engineCase: WorkbenchEngineCase = {
    id: "current",
    case: {
      version: 3,
      prompt: "Improve the Workbench skill using the supplied trace evidence.",
      environment,
    },
    files: {
      public: [],
      private: [],
      source: [],
    },
  };
  const [plannedJob] = planWorkbenchExecutionJobsForPurpose({
    ownerUserId: args.ownerUserId,
    projectId: args.projectId,
    runId: args.runId,
    versionId: args.baseVersionId,
    attemptIndex: args.attempt ?? 0,
    samples: 1,
    caseIds: ["current"],
    spec,
    workflow: "improve",
    purpose: "improve",
    now: createdAt,
    baseFiles: args.baseFiles,
    traceFiles: skillImproveTraceInputFiles(args.traces),
    engineCases: [engineCase],
    environmentRef: environment.dockerfile,
    skillRef: `workbench://skills/${args.projectId}/versions/${args.baseVersionId}`,
    metadata: {
      skillImprove: true,
      versionId: args.baseVersionId,
      skillName,
      skillBundleHash,
      evalHash: args.evalHash,
      agentName: args.agent.name,
      agentAdapter: args.agent.adapter,
      executionAdapter: improve.use,
    },
  });
  if (!plannedJob) {
    throw new Error(`Failed to plan skill improve execution job for ${args.baseVersionId}.`);
  }
  const plannedInput = jsonRecord(plannedJob.input);
  const job: RemoteWorkbenchJob = {
    ...plannedJob,
    id: args.jobId,
    status: "queued",
    attempt: args.attempt ?? 0,
    createdAt,
    updatedAt: createdAt,
    input: {
      ...plannedInput,
      dependsOn: [],
      versionId: args.baseVersionId,
      skillName,
      skillBundleHash,
      evalHash: args.evalHash,
      agentName: args.agent.name,
      caseId: "current",
      sampleIndex: 0,
      skillImprove: true,
    } as unknown as Json,
  };
  return {
    job,
    spec,
    ...(environment.dockerfile.startsWith("dockerfile://") && environmentDockerfile
      ? {
          environmentDockerfile,
          environmentVersion: {
            id: `skill_env_${hashJson(environmentDockerfile).slice(0, 12)}`,
            imageRef: environment.dockerfile,
            sourceHash: hashJson(environmentDockerfile),
            spec: {
              base: "dockerfile",
              resources: runtimeResourcesForSkillEval(args.agent),
              network: runtimeNetworkForSkillEval(args.agent).egress === "open" ? "on" : "off",
            },
          },
        }
      : {}),
    baseFiles: args.baseFiles.map(copyFile),
    traceFiles: skillImproveTraceInputFiles(args.traces),
    engineResolveFiles: [],
    engineCases: [engineCase],
    adapterManifests,
  };
}

export function workbenchImprovementEvidenceFromTraces(
  traces: readonly WorkbenchTrace[],
): string[] {
  return improvementEvidenceFromTraces(traces);
}

export function workbenchImprovementEvidenceTraces(
  traces: readonly WorkbenchTrace[],
): WorkbenchTrace[] {
  return improvementEvidenceTraces(traces);
}

export function workbenchImprovementEvidenceTracesForVersion(
  state: WorkbenchProjectState,
  options: {
    versionId: string;
    skillName: string;
    agent: WorkbenchAgent;
    evalHash?: string;
    traceIds?: readonly string[];
  },
): WorkbenchTrace[] {
  const lineageVersionIds = lineageAncestorVersionIds(state, options.versionId);
  const selectedTraceIds = options.traceIds?.length ? new Set(options.traceIds) : null;
  const agentHash = hashJson(options.agent);
  return improvementEvidenceTraces(state.traces.filter((trace) => {
    if (selectedTraceIds && !selectedTraceIds.has(trace.id)) {
      return false;
    }
    if (!lineageVersionIds.has(trace.versionId)) {
      return false;
    }
    if (trace.skillName !== options.skillName || trace.agentName !== options.agent.name) {
      return false;
    }
    if (options.evalHash && !traceEvalHashMatches(state, trace, options.evalHash)) {
      return false;
    }
    return traceAgentHashMatches(state, trace, agentHash);
  }));
}

function improvementEvidenceTraces(traces: readonly WorkbenchTrace[]): WorkbenchTrace[] {
  return traces.filter(isImprovementEvidenceTrace);
}

function lineageAncestorVersionIds(state: WorkbenchProjectState, versionId: string): Set<string> {
  const ids = new Set<string>();
  const pending = [versionId];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (ids.has(current)) {
      continue;
    }
    ids.add(current);
    const version = state.versions.find((entry) => entry.id === current);
    for (const parentId of version?.parentIds ?? []) {
      pending.push(parentId);
    }
    for (const edge of state.lineage) {
      if (edge.childId === current) {
        pending.push(edge.parentId);
      }
    }
  }
  return ids;
}

function traceAgentHashMatches(
  state: WorkbenchProjectState,
  trace: WorkbenchTrace,
  agentHash: string,
): boolean {
  if (trace.agentHash) {
    return trace.agentHash === agentHash;
  }
  const job = trace.jobId
    ? state.jobs.find((entry) => entry.id === trace.jobId)
    : undefined;
  if (job?.agentHash) {
    return job.agentHash === agentHash;
  }
  const run = state.runs.find((entry) => entry.id === trace.runId);
  if (run?.agentHash) {
    return run.agentHash === agentHash;
  }
  return false;
}

function traceEvalHashMatches(
  state: WorkbenchProjectState,
  trace: WorkbenchTrace,
  evalHash: string,
): boolean {
  if (trace.evalHash) {
    return trace.evalHash === evalHash;
  }
  const job = trace.jobId
    ? state.jobs.find((entry) => entry.id === trace.jobId)
    : undefined;
  if (job?.evalHash) {
    return job.evalHash === evalHash;
  }
  const run = state.runs.find((entry) => entry.id === trace.runId);
  if (run?.evalHash) {
    return run.evalHash === evalHash;
  }
  return false;
}

function isImprovementEvidenceTrace(trace: WorkbenchTrace): boolean {
  const result = asRuntimeRecord(trace.result);
  const request = asRuntimeRecord(trace.request);
  const execution = asRuntimeRecord(request.execution);
  const executionMetadata = asRuntimeRecord(execution.metadata);
  if (request.smoke === true || executionMetadata.smoke === true) {
    return false;
  }
  const status = typeof result.status === "string" ? result.status : undefined;
  const error = textFromJson(result.error);
  const feedback = asRuntimeRecord(result.feedback);
  const review = textFromJson(result.review) ??
    textFromJson(result.reviewComment) ??
    textFromJson(feedback.review) ??
    textFromJson(feedback.comment);
  const cases = Array.isArray(result.cases) ? result.cases : [];
  const hasFailedCase = cases.some((entry) => {
    const runtimeCase = asRuntimeRecord(entry);
    return runtimeCase.status === "failed" ||
      runtimeCase.status === "error" ||
      Boolean(textFromJson(runtimeCase.error));
  });
  return status === "failed" || status === "error" || Boolean(error) || Boolean(review) || hasFailedCase;
}

export function workbenchSkillImproveCanUseQueuedAdapter(agent: WorkbenchAgent): boolean {
  return agentImproveAdapterInvocation(agent) !== null;
}

export function workbenchSkillImproveAdapterRequirementMessage(agent: WorkbenchAgent): string {
  return `Agent ${agent.name} cannot run improve because it has no skill-improvement adapter. Add improveCommand to a local/command agent, or use a Codex/Claude agent with adapter auth.`;
}

export function readWorkbenchSkillImprovementPatchFromRemoteJob(
  remoteJob: RemoteWorkbenchJob,
): WorkbenchSkillPatch | null {
  const output = asRuntimeRecord(remoteJob.output);
  if (output.skillPatch !== undefined) {
    const direct = asRuntimeRecord(output.skillPatch);
    return normalizeWorkbenchSkillPatchFromRecord(direct);
  }
  const operationResults = Array.isArray(output.operationResults)
    ? output.operationResults
    : [];
  for (const entry of [...operationResults].reverse()) {
    const result = asRuntimeRecord(entry);
    if (result.operation !== "skill.improve" || result.ok === false) {
      continue;
    }
    if (result.value === undefined) {
      continue;
    }
    const fallback: { summary?: string; feedback?: Json } = {};
    if (typeof result.summary === "string") {
      fallback.summary = result.summary;
    }
    if (result.feedback !== undefined && isJsonPayload(result.feedback)) {
      fallback.feedback = result.feedback;
    }
    return normalizeWorkbenchSkillPatchFromRecord(asRuntimeRecord(result.value), fallback);
  }
  return null;
}

function normalizeWorkbenchSkillPatchFromRecord(
  record: Record<string, unknown>,
  fallback: { summary?: string; feedback?: Json } = {},
): WorkbenchSkillPatch {
  const files = Array.isArray(record.files)
    ? record.files.filter(isSurfaceSnapshotFile).map(copyFile)
    : [];
  const fileChanges = Array.isArray(record.fileChanges)
    ? record.fileChanges.flatMap((entry) => typeof entry === "string" ? [normalizeRelativePath(entry)] : [])
    : files.map((file) => normalizeRelativePath(file.path));
  return {
    files,
    fileChanges,
    ...(typeof record.summary === "string"
      ? { summary: record.summary }
      : fallback.summary
        ? { summary: fallback.summary }
        : {}),
    ...(record.feedback !== undefined && isJsonPayload(record.feedback)
      ? { feedback: record.feedback }
      : fallback.feedback !== undefined
        ? { feedback: fallback.feedback }
        : {}),
  };
}

export function applyWorkbenchSkillImprovementPatch(
  state: WorkbenchProjectState,
  args: {
    baseVersionId: string;
    agent: WorkbenchAgent;
    patch: WorkbenchSkillPatch;
    runId?: string;
    createdAt?: string;
  },
): WorkbenchSkillImprovementPatchApplication {
  const next = copyStateForRoot(state, state.root);
  const base = resolveVersion(next, args.baseVersionId);
  const files = applyWorkbenchSkillPatch({
    baseFiles: base.files,
    patch: args.patch,
    edits: skillImproveEditPaths(args.agent),
  }).sort((left, right) => left.path.localeCompare(right.path));
  const hash = hashFiles(files);
  const existing = next.versions.find((version) => version.hash === hash);
  const version = existing ?? {
    id: versionIdForHash(hash),
    hash,
    message: `Improved from ${base.hash.slice(0, 12)} with agent ${args.agent.name}`,
    parentIds: [base.id],
    createdAt: args.createdAt ?? now(),
    files,
  };
  if (!existing) {
    next.versions.push(version);
    next.lineage.push({
      parentId: base.id,
      childId: version.id,
      ...(args.runId ? { runId: args.runId } : {}),
      reason: "improve",
      createdAt: version.createdAt,
      message: args.patch.summary ?? `Improved ${args.patch.fileChanges.length} skill file${args.patch.fileChanges.length === 1 ? "" : "s"}.`,
    });
  }
  return {
    state: next,
    version,
    created: !existing,
  };
}

export function decideWorkbenchImprovementPromotion(
  run: WorkbenchRun,
  incumbentRun: WorkbenchRun | undefined,
): { promoted: boolean; reason: string } {
  return improvementPromotionDecision(run, incumbentRun);
}

export function normalizeWorkbenchSkillEvalEnvironmentDockerfile(source: string | undefined): string | undefined {
  const dockerfile = source?.trim();
  if (!dockerfile) {
    return undefined;
  }
  return dockerfile;
}

export interface WorkbenchVersionRuntimeSnapshot {
  evalSnapshot: WorkbenchEvalSnapshot;
  cases: WorkbenchEvalCaseRuntime[];
  agents: WorkbenchAgent[];
  selectedAgents: WorkbenchAgent[];
  defaultAgent?: string;
  skillSources: WorkbenchSkillSource[];
  skillBundles: WorkbenchSkillBundleSnapshot[];
  defaultSkill?: string;
  environmentDockerfile?: string;
}

export async function createWorkbenchVersionRuntimeSnapshot(
  version: WorkbenchVersion,
  options: {
    skill?: string;
    agent?: string;
    evalHash?: string;
    authToken?: string;
  } = {},
): Promise<WorkbenchVersionRuntimeSnapshot> {
  return withMaterializedVersionRoot(version, async (sourceRoot) => {
    const evalSnapshot = await readEvalSnapshot(sourceRoot, {
      createdAt: version.createdAt,
      updatedAt: version.createdAt,
    });
    if (options.evalHash && options.evalHash !== evalSnapshot.hash) {
      throw new WorkbenchUserError(`Eval snapshot ${options.evalHash} is not authored by version ${version.id}.`);
    }
    const agents = await readAgents(sourceRoot);
    const selectedAgents = await resolveRequestedAgents(sourceRoot, options.agent);
    const transientState: WorkbenchProjectState = {
      schema: STATE_SCHEMA,
      root: sourceRoot,
      refs: { current: version.id },
      remotes: {},
      versions: [copyVersion(version)],
      skillSources: [],
      skillBundles: [],
      evals: [],
      agents: [],
      runs: [],
      jobs: [],
      traces: [],
      executionEvents: [],
      artifacts: [],
      lineage: [],
    };
    const skillBundles = await resolveRequestedSkillBundles({
      root: sourceRoot,
      state: transientState,
      version,
      selection: options.skill,
      authToken: options.authToken,
    });
    const defaultAgent = await readDefaultAgentSelection(sourceRoot, agents);
    const defaultSkill = await readDefaultSkillSelection(sourceRoot, transientState.skillSources);
    const cases = await readEvalCases(sourceRoot);
    return {
      evalSnapshot: {
        ...evalSnapshot,
        files: evalSnapshot.files.map(copyFile),
      },
      cases: cases.map((entry) => ({
        ...entry,
        files: entry.files.map(copyFile),
      })),
      agents: agents.map(copyAgent),
      selectedAgents: selectedAgents.map(copyAgent),
      ...(defaultAgent ? { defaultAgent } : {}),
      skillSources: transientState.skillSources.map(copySkillSource),
      skillBundles: skillBundles.map(copySkillBundle),
      ...(defaultSkill ? { defaultSkill } : {}),
      ...(await readSkillEvalEnvironmentDockerfile(sourceRoot).then((dockerfile) =>
        dockerfile ? { environmentDockerfile: dockerfile } : {}
      )),
    };
  });
}

export async function executeQueuedWorkbenchSkillEvalJob(
  input: WorkbenchQueuedSkillEvalJobInput,
): Promise<{
  run: WorkbenchRun;
  job: WorkbenchJob;
  artifact: WorkbenchArtifact;
  trace: WorkbenchTrace;
}> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-cloud-queued-eval-"));
  try {
    const workingState = copyStateForRoot(input.state, tempRoot);
    const version = resolveVersion(workingState, input.versionId);
    const evalSnapshot = workingState.evals.find((entry) => entry.hash === input.evalHash);
    if (!evalSnapshot) {
      throw new WorkbenchUserError(`Eval snapshot not found: ${input.evalHash}`);
    }
    const existingRun = workingState.runs.find((entry) => entry.id === input.runId);
    if (!existingRun) {
      throw new WorkbenchUserError(`Run not found: ${input.runId}`);
    }
    const agent = existingRun.agentHash
      ? workingState.agents.find((entry) =>
        entry.name === existingRun.agentName && hashJson(entry) === existingRun.agentHash
      )
      : workingState.agents.find((entry) => entry.name === existingRun.agentName);
    if (!agent) {
      throw new WorkbenchUserError(`Agent not found: ${existingRun.agentName}`);
    }
    const skillBundle = workingState.skillBundles.find((entry) => entry.hash === existingRun.skillBundleHash);
    if (!skillBundle) {
      throw new WorkbenchUserError(`Skill bundle not found: ${existingRun.skillBundleHash}`);
    }
    await materializeSkillFiles(tempRoot, version.files);
    await materializeWorkbenchFiles(tempRoot, workingState, evalSnapshot.hash);
    const runtimeCase = (await readEvalCases(tempRoot)).find((entry) =>
      entry.id === input.caseId || entry.path === input.caseId
    );
    if (!runtimeCase) {
      throw new WorkbenchUserError(`Case not found: ${input.caseId}`);
    }
    const runtimeInput = createWorkbenchSkillEvalRuntimeInput({
      ownerUserId: input.ownerUserId ?? "local",
      projectId: input.skillId ?? "local",
      runId: existingRun.id,
      jobId: input.jobId,
      versionId: version.id,
      skillName: skillBundle.skillName,
      skillBundleHash: skillBundle.hash,
      evalHash: evalSnapshot.hash,
      evalSnapshot,
      agent,
      versionFiles: skillBundle.files,
      runtimeCase,
      sample: input.sample,
      environmentDockerfile: await readSkillEvalEnvironmentDockerfile(tempRoot),
    });
    const completed = await executeWorkbenchExecutionJob({
      ...runtimeInput,
      ...(input.adapterAuthProfiles ? { adapterAuthProfiles: input.adapterAuthProfiles } : {}),
    }, {
      sandboxBackend: DOCKER_SANDBOX_BACKEND,
    });
    const result = skillEvalObjectsFromRemoteJob({
      remoteJob: completed,
      run: existingRun,
      version,
      skillBundle,
      evalSnapshot,
      agent,
      runtimeCase,
      sample: input.sample,
      artifactId: input.artifactId,
      traceId: input.traceId,
    });
    const finishedAt = result.job.finishedAt ?? now();
    const run: WorkbenchRun = {
      ...existingRun,
      status: result.job.status === "succeeded" ? "succeeded" : "failed",
      score: result.job.score,
      latencyMs: result.job.durationMs ?? 0,
      traceIds: [result.trace.id],
      jobIds: [result.job.id],
      finishedAt,
      ...(result.job.error ? { error: result.job.error } : {}),
    };
    return {
      run: copyRun(run),
      job: copyJob(result.job),
      artifact: copyArtifact(result.artifact),
      trace: copyTrace(result.trace),
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

export async function improveWorkbenchSkill(options: WorkbenchImproveOptions = {}): Promise<WorkbenchImproveResult> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  await autoSyncDefaultRemote(root, options);
  let state = await loadState(root);
  const base = await resolveOrCreateRunVersion(root, state, options.version);
  await saveState(root, state);
  const runtime = await createWorkbenchVersionRuntimeSnapshot(base, {
    skill: options.skill,
    agent: options.agent,
    authToken: options.authToken,
  });
  if (runtime.skillBundles.length !== 1 || runtime.selectedAgents.length !== 1) {
    throw new WorkbenchUserError("workbench improve requires exactly one skill and one agent. Pass --skill primary --agent AGENT.");
  }
  const [skillBundle] = runtime.skillBundles;
  if (!skillBundle) {
    throw new WorkbenchUserError("No primary skill selected for improve.");
  }
  if (skillBundle.skillName !== PRIMARY_SKILL_NAME) {
    throw new WorkbenchUserError("workbench improve can edit only the primary project skill. Vendor or clone another skill before improving it.");
  }
  for (const bundle of runtime.skillBundles) {
    upsertByHash(state.skillBundles, bundle);
  }
  upsertAgentSnapshots(state.agents, runtime.agents);
  const agent = runtime.selectedAgents[0];
  if (!agent) {
    throw new WorkbenchUserError("No agent selected for improve.");
  }
  const selectedEvidenceTraceIds = options.evidenceTraceIds?.length
    ? new Set(options.evidenceTraceIds)
    : null;
  const historicalTraces = workbenchImprovementEvidenceTracesForVersion(state, {
    versionId: base.id,
    skillName: skillBundle.skillName,
    agent,
    evalHash: runtime.evalSnapshot.hash,
    ...(selectedEvidenceTraceIds ? { traceIds: [...selectedEvidenceTraceIds] } : {}),
  });
  const improvementEvidence = improvementEvidenceFromTraces(historicalTraces);
  if (improvementEvidence.length === 0) {
    throw new WorkbenchUserError("workbench improve needs failed or reviewed trace evidence for the selected agent on this version. Run `workbench eval --agents AGENT` until a failure is recorded, or edit SKILL.md directly.");
  }
  const evalSnapshot = runtime.evalSnapshot;
  upsertEvalSnapshotObject(state.evals, evalSnapshot);
  const incumbentRun = latestScoredRun({
    runs: state.runs,
    versionId: base.id,
    skillName: skillBundle.skillName,
    skillBundleHash: skillBundle.hash,
    evalHash: evalSnapshot.hash,
    agentName: agent.name,
    agentHash: hashJson(agent),
  });
  const improvement = await createSkillImprovementPatch({
    root,
    state,
    agent,
    base,
    evalHash: evalSnapshot.hash,
    environmentDockerfile: runtime.environmentDockerfile,
    historicalTraces,
    improvementEvidence,
  });
  const applied = applyWorkbenchSkillImprovementPatch(state, {
    baseVersionId: base.id,
    agent,
    patch: improvement.patch,
    createdAt: now(),
  });
  state = applied.state;
  const version = applied.version;
  const outputRuntime = await createWorkbenchVersionRuntimeSnapshot(version, {
    skill: PRIMARY_SKILL_NAME,
    agent: agent.name,
    authToken: options.authToken,
  });
  const [outputSkillBundle] = outputRuntime.skillBundles;
  if (!outputSkillBundle) {
    throw new WorkbenchUserError("No primary skill bundle available for improve proof eval.");
  }
  for (const bundle of outputRuntime.skillBundles) {
    upsertByHash(state.skillBundles, bundle);
  }
  upsertAgentSnapshots(state.agents, outputRuntime.agents);
  const run = await executeWorkbenchEvaluationRun({
    root,
    state,
    version,
    skillBundle: outputSkillBundle,
    evalSnapshot,
    agent,
    kind: "improve",
    ...(options.parentRunId !== undefined ? { parentRunId: options.parentRunId } : {}),
    samples: options.samples ?? 1,
    cases: runtime.cases,
    environmentDockerfile: runtime.environmentDockerfile,
    request: {
      baseVersionId: base.id,
      historicalTraceIds: historicalTraces.map((trace) => trace.id),
      budget: options.budget ?? 1,
      samples: options.samples ?? 1,
      improvementMode: improvement.mode,
      ...(improvement.command ? { improvementCommand: improvement.command } : {}),
      improvementFileChanges: improvement.patch.fileChanges.map(normalizeRelativePath).sort(),
    },
    result: {
      outputVersionId: version.id,
      improvementMode: improvement.mode,
      improvementFileChanges: improvement.patch.fileChanges.map(normalizeRelativePath).sort(),
      ...(improvement.patch.summary ? { summary: improvement.patch.summary } : {}),
    },
  });
  run.outputVersionId = version.id;
  if (run.status !== "succeeded") {
    await saveState(root, state);
    await autoSyncDefaultRemote(root, options);
    throw new WorkbenchUserError(improveProofEvalFailureMessage(version, run));
  }
  const promotion = improvementPromotionDecision(run, incumbentRun);
  let switched = false;
  if (promotion.promoted) {
    await materializeSkillFiles(root, version.files);
    state.refs.current = version.id;
    switched = true;
  }
  await saveState(root, state);
  await autoSyncDefaultRemote(root, options);
  return {
    run,
    version,
    switched,
    promoted: promotion.promoted,
    promotionReason: promotion.reason,
    ...(incumbentRun ? { incumbentRunId: incumbentRun.id } : {}),
    ...(typeof incumbentRun?.score === "number" ? { incumbentScore: incumbentRun.score } : {}),
    ...(typeof run.score === "number" ? { outputScore: run.score } : {}),
  };
  });
}

function improveProofEvalFailureMessage(
  version: WorkbenchVersion,
  run: WorkbenchRun,
): string {
  return [
    `Improve proof eval failed for ${version.id} in run ${run.id}.`,
    run.error ? ` ${singleLine(run.error)}` : " Inspect the run evidence before retrying.",
  ].join("");
}

function shouldSkipVersionForCompareSelection(
  error: unknown,
  options: Pick<WorkbenchCompareOptions, "skills" | "agents">,
  versionCount: number,
): boolean {
  if (versionCount <= 1 || !(error instanceof WorkbenchUserError)) {
    return false;
  }
  const message = error.message.trim();
  if (isNamedCompareSelection(options.agents) && message.startsWith("Agent not found: ")) {
    return true;
  }
  return isNamedCompareSelection(options.skills) && message.startsWith("Skill not found: ");
}

function isNamedCompareSelection(selection: string | undefined): boolean {
  const normalized = selection?.trim();
  return Boolean(normalized && normalized !== ALL_SELECTOR);
}

export async function compareWorkbench(options: WorkbenchCompareOptions = {}): Promise<WorkbenchComparison> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  await autoSyncDefaultRemote(root, options);
  const state = await loadState(root);
  await reconcileWorkbenchVersion(root, state, "current source");
  let versions = resolveVersionSelection(state, options.versions ?? "all");
  if (versions.length === 0) {
    versions = [await reconcileWorkbenchVersion(root, state, "current source")];
  }
  const cells: WorkbenchComparisonCell[] = [];
  const comparedSkills: WorkbenchSkillBundleSnapshot[] = [];
  const comparedAgents: WorkbenchAgent[] = [];
  const comparedVersions: WorkbenchVersion[] = [];
  const skippedVersions: string[] = [];
  const evalHashes = new Set<string>();
  for (const version of versions) {
    let runtime: WorkbenchVersionRuntimeSnapshot;
    try {
      runtime = await createWorkbenchVersionRuntimeSnapshot(version, {
        skill: options.skills,
        agent: options.agents,
        authToken: options.authToken,
      });
    } catch (error) {
      if (shouldSkipVersionForCompareSelection(error, options, versions.length)) {
        skippedVersions.push(version.id);
        continue;
      }
      throw error;
    }
    comparedVersions.push(version);
    evalHashes.add(runtime.evalSnapshot.hash);
    upsertEvalSnapshotObject(state.evals, runtime.evalSnapshot);
    upsertAgentSnapshots(state.agents, runtime.agents);
    for (const bundle of runtime.skillBundles) {
      upsertByHash(state.skillBundles, bundle);
      if (!comparedSkills.some((entry) => entry.hash === bundle.hash)) {
        comparedSkills.push(bundle);
      }
    }
    for (const agent of runtime.selectedAgents) {
      const agentHash = hashJson(agent);
      if (!comparedAgents.some((entry) => entry.name === agent.name && hashJson(entry) === agentHash)) {
        comparedAgents.push(agent);
      }
    }
    for (const skill of runtime.skillBundles) {
      for (const agent of runtime.selectedAgents) {
        const run = latestComparableRun({
          runs: state.runs,
          versionId: version.id,
          skillName: skill.skillName,
          skillBundleHash: skill.hash,
          evalHash: runtime.evalSnapshot.hash,
          agentName: agent.name,
          agentHash: hashJson(agent),
        });
        cells.push({
          versionId: version.id,
          skillName: skill.skillName,
          skillBundleHash: skill.hash,
          evalHash: runtime.evalSnapshot.hash,
          agentName: agent.name,
          agentHash: hashJson(agent),
          ...(run ? comparisonCellRunFields(run, state.jobs) : {}),
        });
      }
    }
  }
  if (comparedVersions.length === 0 && skippedVersions.length > 0) {
    throw new WorkbenchUserError("No selected versions define the requested compare skills or agents.");
  }
  await saveState(root, state);
  await autoSyncDefaultRemote(root, options);
  const [onlyEvalHash] = [...evalHashes];
  return {
    ...(evalHashes.size === 1 && onlyEvalHash ? { evalHash: onlyEvalHash } : {}),
    versions: comparedVersions,
    skills: comparedSkills,
    agents: uniqueAgentSnapshots(comparedAgents),
    cells,
  };
  });
}

export function buildWorkbenchComparisonFromState(
  state: WorkbenchProjectState,
  options: Pick<WorkbenchCompareOptions, "versions" | "skills" | "agents"> = {},
): WorkbenchComparison {
  const versions = resolveVersionSelection(state, options.versions ?? "all");
  const versionIds = new Set(versions.map((version) => version.id));
  const skillBundlesByHash = new Map(state.skillBundles.map((bundle) => [bundle.hash, bundle]));
  const entriesByKey = new Map<string, {
    version: WorkbenchVersion;
    bundle: WorkbenchSkillBundleSnapshot;
    evalHash: string;
  }>();

  for (const run of [...state.runs].sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    if (!versionIds.has(run.versionId) || !skillSelectionIncludes(options.skills, run.skillName, run.skillBundleHash)) {
      continue;
    }
    const version = versions.find((entry) => entry.id === run.versionId);
    const bundle = skillBundlesByHash.get(run.skillBundleHash);
    if (!version || !bundle) {
      continue;
    }
    const key = comparisonEntryKey(run.versionId, run.skillName, run.skillBundleHash, run.evalHash);
    entriesByKey.set(key, { version, bundle, evalHash: run.evalHash });
  }

  if (entriesByKey.size === 0 && versions.length > 0) {
    const selectedBundles = state.skillBundles.filter((bundle) =>
      skillSelectionIncludes(options.skills, bundle.skillName, bundle.hash)
    );
    const evalHash = state.evals[0]?.hash;
    if (evalHash) {
      for (const version of versions) {
        for (const bundle of selectedBundles) {
          entriesByKey.set(
            comparisonEntryKey(version.id, bundle.skillName, bundle.hash, evalHash),
            { version, bundle, evalHash },
          );
        }
      }
    }
  }

  const entries = [...entriesByKey.values()].sort((left, right) =>
    compareVersionIds(left.version, right.version) ||
    left.bundle.skillName.localeCompare(right.bundle.skillName) ||
    left.bundle.hash.localeCompare(right.bundle.hash) ||
    left.evalHash.localeCompare(right.evalHash)
  );
  const agentsByVersionId = new Map(versions.map((version) => [
    version.id,
    resolveComparisonAgentsForVersionFromState(state, version, options.agents),
  ]));
  const comparedAgents = uniqueResolvedAgentSnapshots(
    entries.flatMap((entry) => agentsByVersionId.get(entry.version.id) ?? []),
  );
  const comparedSkills = uniqueSkillBundles(entries.map((entry) => entry.bundle));
  const evalHashes = new Set(entries.map((entry) => entry.evalHash));
  const cells: WorkbenchComparisonCell[] = [];

  for (const entry of entries) {
    const agents = agentsByVersionId.get(entry.version.id) ?? [];
    for (const agent of agents) {
      const run = latestComparableRun({
        runs: state.runs,
        versionId: entry.version.id,
        skillName: entry.bundle.skillName,
        skillBundleHash: entry.bundle.hash,
        evalHash: entry.evalHash,
        agentName: agent.agent.name,
        agentHash: agent.hash,
      });
      cells.push({
        versionId: entry.version.id,
        skillName: entry.bundle.skillName,
        skillBundleHash: entry.bundle.hash,
        evalHash: entry.evalHash,
        agentName: agent.agent.name,
        agentHash: agent.hash,
        ...(run ? comparisonCellRunFields(run, state.jobs) : {}),
      });
    }
  }

  const [onlyEvalHash] = [...evalHashes];
  return {
    ...(evalHashes.size === 1 && onlyEvalHash ? { evalHash: onlyEvalHash } : {}),
    versions,
    skills: comparedSkills,
    agents: comparedAgents,
    cells,
  };
}

export async function switchWorkbenchVersion(versionRef: string, options: WorkbenchCommandOptions = {}): Promise<WorkbenchVersion> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  await autoSyncDefaultRemote(root, options);
  const state = await loadState(root);
  await reconcileWorkbenchVersion(root, state, "current source");
  const version = resolveVersion(state, versionRef);
  await materializeSkillFiles(root, version.files);
  state.remotes = await readWorkbenchRemotesFile(root);
  state.refs.current = version.id;
  await saveState(root, state);
  await autoSyncDefaultRemote(root, options);
  return version;
  });
}

export async function diffWorkbenchVersions(range: string, options: WorkbenchCommandOptions = {}): Promise<WorkbenchDiffEntry[]> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  await autoSyncDefaultRemote(root, options);
  const state = await loadState(root);
  await reconcileWorkbenchVersion(root, state, "current source");
  await saveState(root, state);
  await autoSyncDefaultRemote(root, options);
  const [leftRef, rightRef] = range.includes("..")
    ? range.split("..", 2)
    : [state.refs.current ?? "current", range];
  const left = resolveVersion(state, leftRef || "current");
  const right = resolveVersion(state, rightRef || "current");
  return diffFiles(left.files, right.files);
  });
}

export async function showWorkbenchRef(ref: string, options: WorkbenchCommandOptions = {}): Promise<unknown> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  await autoSyncDefaultRemote(root, options);
  const state = await loadState(root);
  await reconcileWorkbenchVersion(root, state, "current source");
  await saveState(root, state);
  await autoSyncDefaultRemote(root, options);
  const [objectRef, filePath] = splitObjectPath(ref);
  const version = findVersion(state, objectRef);
  if (version) {
    if (!filePath) {
      return version;
    }
    const file = version.files.find((entry) => entry.path === filePath);
    if (!file) {
      throw new WorkbenchCodedError("ref_not_found", `File not found in ${version.id}: ${filePath}`, {
        remediation: `Run workbench files ${version.id}.`,
        subject: { ref: version.id, path: filePath },
        exitCode: 1,
      });
    }
    return file;
  }
  const run = state.runs.find((entry) => entry.id === objectRef);
  if (run) {
    return run;
  }
  const job = state.jobs.find((entry) => entry.id === objectRef);
  if (job) {
    return job;
  }
  const trace = state.traces.find((entry) => entry.id === objectRef);
  if (trace) {
    if (filePath) {
      const file = trace.files.find((entry) => entry.path === filePath);
      if (!file) {
        throw new WorkbenchCodedError("ref_not_found", `File not found in ${trace.id}: ${filePath}`, {
          remediation: `Run workbench files ${trace.id}.`,
          subject: { ref: trace.id, path: filePath },
          exitCode: 1,
        });
      }
      return file;
    }
    return trace;
  }
  const artifact = state.artifacts.find((entry) => entry.id === objectRef);
  if (artifact) {
    if (filePath) {
      const file = artifact.files.find((entry) => entry.path === filePath);
      if (!file) {
        throw new WorkbenchCodedError("ref_not_found", `File not found in ${artifact.id}: ${filePath}`, {
          remediation: `Run workbench files ${artifact.id}.`,
          subject: { ref: artifact.id, path: filePath },
          exitCode: 1,
        });
      }
      return file;
    }
    return artifact;
  }
  throw new WorkbenchCodedError("ref_not_found", `Workbench object not found: ${objectRef}`, {
    remediation: "Run workbench list runs --json or workbench versions --json.",
    subject: { ref: objectRef },
    exitCode: 1,
  });
  });
}

export async function filesForWorkbenchRef(ref: string, options: WorkbenchCommandOptions = {}): Promise<SurfaceSnapshotFile[]> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  await autoSyncDefaultRemote(root, options);
  const state = await loadState(root);
  await reconcileWorkbenchVersion(root, state, "current source");
  await saveState(root, state);
  await autoSyncDefaultRemote(root, options);
  const version = findVersion(state, ref);
  if (version) {
    return version.files.map(copyFile);
  }
  const trace = state.traces.find((entry) => entry.id === ref);
  if (trace) {
    return trace.files.map(copyFile);
  }
  const artifact = state.artifacts.find((entry) => entry.id === ref);
  if (artifact) {
    return artifact.files.map(copyFile);
  }
  throw new WorkbenchCodedError("ref_not_found", `Workbench file object not found: ${ref}`, {
    remediation: "Run workbench list runs --json, workbench list artifacts --json, or workbench versions --json.",
    subject: { ref },
    exitCode: 1,
  });
  });
}

export async function listWorkbenchCases(options: WorkbenchCommandOptions = {}): Promise<WorkbenchCaseRecord[]> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  await autoSyncDefaultRemote(root, options);
  const state = await loadState(root);
  await reconcileWorkbenchVersion(root, state, "current source");
  await saveState(root, state);
  await autoSyncDefaultRemote(root, options);
  return (await readEvalCases(root)).map((entry) => ({
    id: entry.id,
    path: entry.path,
    content: entry.content,
  }));
  });
}

export async function showWorkbenchCase(caseId: string, options: WorkbenchCommandOptions = {}): Promise<WorkbenchCaseRecord> {
  const found = (await listWorkbenchCases(options)).find((entry) => entry.id === caseId || entry.path === caseId);
  if (!found) {
    throw new WorkbenchUserError(`Case not found: ${caseId}`);
  }
  return found;
}

export async function addWorkbenchCase(options: WorkbenchCommandOptions & { fromTraceId?: string } = {}): Promise<WorkbenchCaseRecord> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  await autoSyncDefaultRemote(root, options);
  const state = await loadState(root);
  const trace = options.fromTraceId
    ? state.traces.find((entry) => entry.id === options.fromTraceId)
    : undefined;
  if (options.fromTraceId && !trace) {
    throw new WorkbenchUserError(`Trace not found: ${options.fromTraceId}`);
  }
  const cases = await listWorkbenchCases({ dir: root });
  const id = `case-${String(cases.length + 1).padStart(3, "0")}`;
  const content = caseDescriptorYaml(id, trace);
  const caseRoot = path.join(workbenchDir(root), CASES_DIR, id);
  await fs.mkdir(path.join(caseRoot, "tests"), { recursive: true });
  await fs.writeFile(path.join(caseRoot, "case.yaml"), content);
  await fs.writeFile(path.join(caseRoot, "tests", "test.sh"), caseDraftTestScript(id, trace));
  await fs.chmod(path.join(caseRoot, "tests", "test.sh"), 0o755);
  if (trace) {
    await writeSurfaceFiles(path.join(caseRoot, "trace"), trace.files.map(copyFile));
  }
  const stateAfter = await loadState(root);
  await reconcileWorkbenchVersion(root, stateAfter, "case source");
  await saveState(root, stateAfter);
  await autoSyncDefaultRemote(root, options);
  return { id, path: id, content };
  });
}

function caseDescriptorYaml(id: string, trace: WorkbenchTrace | undefined): string {
  const descriptor = trace
    ? {
        version: 1,
        id,
        sourceTraceId: trace.id,
        prompt: tracePromptForCase(trace),
        rubric: traceRubricForCase(trace),
        command: "sh \"$CASE_DIR/tests/test.sh\"",
      }
    : {
        version: 1,
        id,
        prompt: "Replace this draft with a representative workflow prompt.",
        rubric: [
          "Replace this draft with observable acceptance criteria.",
          "Add a deterministic test or grader before using this case in score comparisons.",
        ],
        command: "sh \"$CASE_DIR/tests/test.sh\"",
      };
  return `${YAML.stringify(descriptor).trimEnd()}\n`;
}

function tracePromptForCase(trace: WorkbenchTrace): string {
  const request = asRuntimeRecord(trace.request);
  const explicitPrompt = textFromJson(request.prompt) ?? textFromJson(asRuntimeRecord(request.case).prompt);
  if (explicitPrompt) {
    return `Re-run the workflow captured by trace ${trace.id}: ${truncateText(singleLine(explicitPrompt), 320)}`;
  }
  const caseId = typeof request.caseId === "string" ? request.caseId : undefined;
  return caseId
    ? `Re-run the workflow captured by trace ${trace.id} for source case ${caseId}.`
    : `Re-run the workflow captured by trace ${trace.id}.`;
}

function traceRubricForCase(trace: WorkbenchTrace): string[] {
  const result = asRuntimeRecord(trace.result);
  const request = asRuntimeRecord(trace.request);
  const caseId = typeof request.caseId === "string" ? request.caseId : undefined;
  const error = textFromJson(result.error) ?? traceFileSnippet(trace, "stderr.log");
  return [
    `Preserves the intended behavior represented by trace ${trace.id}${caseId ? ` / ${caseId}` : ""}.`,
    error ? `Addresses the observed failure: ${truncateText(singleLine(error), 220)}` : "Matches or improves on the useful output captured in the trace evidence.",
    "Replace this draft rubric with expert-approved pass/fail criteria before using the score as workflow evidence.",
  ];
}

function caseDraftTestScript(id: string, trace: WorkbenchTrace | undefined): string {
  const message = trace
    ? `Trace-derived case ${id} needs expert acceptance criteria before it can pass. Source trace: ${trace.id}.`
    : `Draft case ${id} needs a workflow-specific prompt, rubric, and test before it can pass.`;
  return [
    "#!/bin/sh",
    "set -eu",
    "mkdir -p \"$OUTPUT_DIR\"",
    `printf '%s\\n' ${quoteShellLiteral(message)} >&2`,
    `printf '{"ok":false,"kind":"draft-case","message":%s}\\n' ${quoteShellLiteral(JSON.stringify(message))} > "$OUTPUT_DIR/result.json"`,
    "exit 2",
    "",
  ].join("\n");
}

export async function removeWorkbenchCase(caseId: string, options: WorkbenchCommandOptions = {}): Promise<{ removed: string }> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await autoSyncDefaultRemote(root, options);
  const found = await showWorkbenchCase(caseId, { dir: root, authToken: options.authToken });
  await fs.rm(path.join(workbenchDir(root), CASES_DIR, found.path), { recursive: true, force: true });
  const state = await loadState(root);
  await reconcileWorkbenchVersion(root, state, "case source");
  await saveState(root, state);
  await autoSyncDefaultRemote(root, options);
  return { removed: found.id };
  });
}

export async function listWorkbenchAgents(options: WorkbenchCommandOptions = {}): Promise<WorkbenchAgent[]> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  await autoSyncDefaultRemote(root, options);
  const state = await loadState(root);
  await reconcileWorkbenchVersion(root, state, "current source");
  await saveState(root, state);
  await autoSyncDefaultRemote(root, options);
  return readAgents(root);
  });
}

export async function addWorkbenchAgent(input: WorkbenchCommandOptions & {
  name: string;
  adapter: string;
  model?: string;
  config?: Record<string, Json>;
}): Promise<WorkbenchAgent> {
  const root = resolveRoot(input.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  await autoSyncDefaultRemote(root, input);
  const agents = await readAgents(root);
  const agentName = normalizeManifestEntryName(input.name, path.join(".workbench", AGENTS_FILE), "agent");
  const adapter = input.adapter.trim();
  if (!adapter) {
    throw new WorkbenchUserError(`Agent ${agentName} in ${path.join(".workbench", AGENTS_FILE)} must define a non-empty adapter.`);
  }
  const agent: WorkbenchAgent = {
    name: agentName,
    adapter,
    ...(input.model ? { model: input.model } : {}),
    config: input.config ?? {},
  };
  const next = [...agents.filter((entry) => entry.name !== agent.name), agent]
    .sort((left, right) => left.name.localeCompare(right.name));
  const defaultAgent = await readDefaultAgentSelection(root, next);
  await writeAgents(root, next, defaultAgent);
  const state = await loadState(root);
  upsertAgentSnapshots(state.agents, next);
  await reconcileWorkbenchVersion(root, state, "agent source");
  await saveState(root, state);
  await autoSyncDefaultRemote(root, input);
  return agent;
  });
}

export async function removeWorkbenchAgent(name: string, options: WorkbenchCommandOptions = {}): Promise<{ removed: string }> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  await autoSyncDefaultRemote(root, options);
  const agents = await readAgents(root);
  const agentName = name.trim();
  const next = agents.filter((entry) => entry.name !== agentName);
  if (next.length === agents.length) {
    throw new WorkbenchUserError(`Agent not found: ${agentName || name}`);
  }
  if (next.length === 0) {
    throw new WorkbenchUserError("Cannot remove the last agent. Add another agent before removing this one.");
  }
  const currentDefault = await readDefaultAgentSelection(root, agents);
  const defaultAgent = currentDefault === ALL_SELECTOR || next.some((agent) => agent.name === currentDefault)
    ? currentDefault
    : next[0]?.name ?? "default";
  await writeAgents(root, next, defaultAgent);
  const state = await loadState(root);
  upsertAgentSnapshots(state.agents, next);
  await reconcileWorkbenchVersion(root, state, "agent source");
  await saveState(root, state);
  await autoSyncDefaultRemote(root, options);
  return { removed: agentName };
  });
}

export async function setDefaultWorkbenchAgent(name: string, options: WorkbenchCommandOptions = {}): Promise<{ defaultAgent: string }> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  await autoSyncDefaultRemote(root, options);
  const agents = await readAgents(root);
  const selection = name.trim();
  if (!selection) {
    throw new WorkbenchUserError(`Agent not found: ${name}`);
  }
  if (selection !== ALL_SELECTOR && !agents.some((entry) => entry.name === selection)) {
    throw new WorkbenchUserError(`Agent not found: ${selection}`);
  }
  await writeAgents(root, agents, selection);
  const state = await loadState(root);
  upsertAgentSnapshots(state.agents, agents);
  await reconcileWorkbenchVersion(root, state, "agent source");
  await saveState(root, state);
  await autoSyncDefaultRemote(root, options);
  return { defaultAgent: selection };
  });
}

export async function addWorkbenchRemote(name: string, url: string, options: WorkbenchAddRemoteOptions = {}): Promise<WorkbenchAddRemoteResult> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const remoteName = validateRemoteName(name);
    const parsed = parseWorkbenchRemoteUrl(url);
    const remote: WorkbenchRemote = { name: remoteName, url: parsed.url, kind: parsed.kind };
    const state = await loadState(root);
    const existing = state.remotes[remoteName];
    const operation: WorkbenchAddRemoteResult["operation"] = !existing
      ? "added"
      : existing.url === remote.url && existing.kind === remote.kind
        ? "unchanged"
        : options.replace === true
          ? "replaced"
          : (() => {
              throw new WorkbenchCodedError("remote_name_conflict", `Remote ${remoteName} already points at a different URL.`, {
                remediation: `Run workbench remote add --name ${remoteName} --url ${remote.url} --replace to change it.`,
                subject: { remote: remoteName, currentUrl: existing.url, requestedUrl: remote.url },
                exitCode: 1,
              });
            })();
    if (options.dryRun === true) {
      return { remote, operation, dryRun: true };
    }
    if (operation === "replaced") {
      await clearRemoteLocalState(root, state, remoteName);
    }
    state.remotes[remoteName] = remote;
    await saveState(root, state);
    await autoSyncDefaultRemote(root, options);
    return { remote, operation };
  });
}

async function clearRemoteLocalState(root: string, state: WorkbenchProjectState, remoteName: string): Promise<void> {
  const prefix = `remotes/${safeObjectFileName(remoteName)}/`;
  for (const refName of Object.keys(state.refs)) {
    if (refName.startsWith(prefix)) {
      delete state.refs[refName];
    }
  }
  await fs.rm(remoteSyncStateFile(root, remoteName), { force: true });
}

export async function removeWorkbenchRemote(name: string, options: WorkbenchCommandOptions = {}): Promise<{ remote: string; removed: boolean }> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const remoteName = validateRemoteName(name);
    const state = await loadState(root);
    const removed = Boolean(state.remotes[remoteName]);
    delete state.remotes[remoteName];
    await clearRemoteLocalState(root, state, remoteName);
    await saveState(root, state);
    return { remote: remoteName, removed };
  });
}

export async function listWorkbenchRemotes(options: WorkbenchCommandOptions = {}): Promise<WorkbenchRemote[]> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    await autoSyncDefaultRemote(root, options);
    const state = await loadState(root);
    await reconcileWorkbenchVersion(root, state, "current source");
    await saveState(root, state);
    await autoSyncDefaultRemote(root, options);
    const syncedState = await loadState(root);
    return Object.values(syncedState.remotes).sort((left, right) => left.name.localeCompare(right.name));
  });
}

export async function syncWorkbenchRemote(options: WorkbenchRemoteOptions = {}): Promise<WorkbenchSyncResult> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const remote = resolveRemote(state, options.remote);
    const attemptAt = now();
    try {
      await refreshLocalWorkbenchFiles(root, state);
      await reconcileWorkbenchVersion(root, state, "current source");
      const localPack = exportObjectPackForRemote(state);
      const remotePack = await readRemoteObjectPack(remote, { authToken: options.authToken }).catch((error) => {
        if (fileErrorCode(error) === "ENOENT") {
          return emptyObjectPack();
        }
        throw error;
      });
      const before = objectPackSize(localPack);
      importObjectPack(state, remotePack, { refs: "none" });
      if (remote.kind === "workbench-cloud") {
        state.refs = withPublicationRefsFromRemote(state.refs, remotePack.refs);
      }
      const mergedLocalPack = exportObjectPackForRemote(state);
      const merged = {
        ...mergedLocalPack,
        refs: remote.kind === "workbench-cloud"
          ? {
              ...mergedLocalPack.refs,
              ...publicationRefs(remotePack.refs),
            }
          : mergedLocalPack.refs,
      };
      const remoteWritePack = isHttpRemote(remote)
        ? objectPackDeltaForRemoteWrite(merged, remotePack)
        : merged;
      const pushed = Math.max(0, objectPackSize(merged) - objectPackSize(remotePack));
      const pulled = Math.max(0, objectPackSize(merged) - before);
      const result: WorkbenchSyncResult = {
        remote,
        pushed,
        pulled,
        upToDate: pushed === 0 && pulled === 0,
        ...(options.dryRun === true ? { dryRun: true } : {}),
        publication: remote.kind === "workbench-cloud"
          ? publicationStatusFromRefs(withRemoteTrackingRefs({ ...state.refs }, remote.name, merged.refs), remote.name)
          : unpublishedPublicationStatus(),
      };
      if (options.dryRun === true) {
        return result;
      }
      await writeRemoteObjectPack(remote, remoteWritePack, state, { authToken: options.authToken });
      state.refs = withRemoteTrackingRefs(state.refs, remote.name, merged.refs);
      await saveState(root, state);
      await writeRemoteSyncState(root, {
        schema: "workbench.remote-sync-state.v1",
        remote: remote.name,
        url: remote.url,
        status: "synced",
        lastSyncedAt: now(),
        lastAttemptAt: attemptAt,
        lastError: null,
        pushed,
        pulled,
      });
      return result;
    } catch (error) {
      const syncError = syncFailureError(error, remote);
      await writeRemoteSyncState(root, {
        schema: "workbench.remote-sync-state.v1",
        remote: remote.name,
        url: remote.url,
        status: "error",
        lastAttemptAt: attemptAt,
        lastError: syncErrorRecord(syncError),
      });
      throw syncError;
    }
  });
}

export async function publishWorkbenchVersion(options: WorkbenchPublishOptions = {}): Promise<WorkbenchPublishResult> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const current = await reconcileWorkbenchVersion(root, state, "current source");
    const version = options.version ? resolveVersion(state, options.version) : current;
    const remote = resolveRemote(state, options.remote);
    assertPublishableRemote(remote);
    await saveState(root, state);
    const sync = await syncWorkbenchRemote({ dir: root, remote: remote.name, authToken: options.authToken, dryRun: options.dryRun });
    const syncedState = await loadState(root);
    if (options.dryRun === true) {
      return {
        remote: sync.remote,
        version,
        visibility: options.visibility ?? "private",
        installUrl: workbenchRemoteSourceUrl(sync.remote),
        pinnedInstallUrl: workbenchRemoteReleaseSourceUrl(sync.remote, version.id),
        dryRun: true,
      };
    }
    const publication = await writeRemotePublishedSource(sync.remote, version, {
      authToken: options.authToken,
      state: syncedState,
      visibility: options.visibility ?? "private",
    });
    const publishedRefs = publicationRefsForVersion(
      version.id,
      publication,
      options.visibility ?? "private",
    );
    Object.assign(syncedState.refs, publishedRefs);
    syncedState.refs = withMergedRemoteTrackingRefs(syncedState.refs, sync.remote.name, publishedRefs);
    await saveState(root, syncedState);
    return {
      remote: sync.remote,
      version,
      visibility: options.visibility ?? "private",
      installUrl: publication.installUrl,
      pinnedInstallUrl: publication.pinnedInstallUrl,
    };
  });
}

function assertPublishableRemote(remote: WorkbenchRemote): void {
  if (remote.kind === "workbench-cloud") {
    return;
  }
  throw new WorkbenchCodedError("publish_failed", `Remote ${remote.name} is a file remote; only Workbench Cloud remotes can publish installable source.`, {
    remediation: "Run workbench remote add --name cloud --url https://HOST/skills/OWNER/SKILL, then workbench publish --remote cloud.",
    subject: { remote: remote.name, kind: remote.kind, url: remote.url },
    exitCode: 1,
  });
}

async function autoSyncDefaultRemote(root: string, options: WorkbenchCommandOptions = {}): Promise<void> {
  const state = await loadState(root);
  if (Object.keys(state.remotes).length === 0) {
    return;
  }
  await syncWorkbenchRemote({ dir: root, authToken: options.authToken }).catch(() => undefined);
}

export interface WorkbenchInspectionSnapshotFromStateOptions {
  root?: string;
  state: WorkbenchProjectState;
  skillSources?: readonly WorkbenchSkillSource[];
  authoredAgents?: readonly WorkbenchAgent[];
  remotes?: readonly WorkbenchRemote[];
  currentVersionId?: string;
  defaultSkill?: string;
  defaultAgent?: string;
  pendingSyncCount?: number;
  publication?: WorkbenchInspectionSnapshot["publication"];
}

export function createWorkbenchInspectionSnapshotFromState(
  options: WorkbenchInspectionSnapshotFromStateOptions,
): WorkbenchInspectionSnapshot {
  const state = options.state;
  const root = options.root ?? state.root;
  const current = options.currentVersionId ?? currentWorkbenchVersionIdFromState(state);
  const currentVersion = current
    ? state.versions.find((version) => version.id === current)
    : undefined;
  const skillSources = (options.skillSources ?? state.skillSources).map(copySkillSource);
  const authoredAgents = options.authoredAgents ?? [];
  const agents = uniqueAgentSnapshots([...state.agents, ...authoredAgents]);
  const defaultSkill = options.defaultSkill ?? defaultWorkbenchSkillSelectionFromState({
    ...state,
    skillSources: skillSources.map(copySkillSource),
  });
  const defaultAgent = options.defaultAgent ?? defaultWorkbenchAgentSelectionFromState({
    ...state,
    agents: authoredAgents.length > 0 ? authoredAgents.map(copyAgent) : state.agents,
  });
  const remotes = [...(options.remotes ?? Object.values(state.remotes))]
    .map((remote) => ({ ...remote }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const lastRun = state.runs
    .filter((run) => typeof run.score === "number")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const status: WorkbenchStatus = {
    root,
    initialized: true,
    ...(currentVersion?.hash ? { currentSkillHash: currentVersion.hash } : {}),
    ...(current ? { currentVersionId: current } : {}),
    ...(defaultSkill ? { defaultSkill } : {}),
    ...(defaultAgent ? { defaultAgent } : {}),
    versionCount: state.versions.length,
    skillCount: skillSources.length,
    agentCount: authoredAgents.length > 0 ? authoredAgents.length : state.agents.length,
    runCount: state.runs.length,
    remoteCount: remotes.length,
    ...(options.pendingSyncCount !== undefined ? { pendingSyncCount: options.pendingSyncCount } : {}),
    ...(lastRun?.score !== undefined ? { lastScore: lastRun.score } : {}),
  };
  return {
    root,
    status,
    versions: state.versions.map(copyVersion),
    skillSources,
    skillBundles: state.skillBundles.map(copySkillBundle),
    evals: state.evals.map(copyEval),
    agents,
    comparison: buildWorkbenchComparisonFromState(state, {
      versions: status.currentVersionId ?? state.refs.current,
      skills: status.defaultSkill,
      agents: status.defaultAgent,
    }),
    runs: state.runs.map(copyRun),
    jobs: state.jobs.map(copyJob),
    traces: state.traces.map(copyTrace),
    executionEvents: state.executionEvents.map(copyExecutionEventBatch),
    artifacts: state.artifacts.map(copyArtifact),
    lineage: state.lineage.map((edge) => ({ ...edge })),
    remotes,
    refs: { ...state.refs },
    ...(options.publication ? { publication: options.publication } : {}),
  };
}

export function currentWorkbenchVersionIdFromState(state: WorkbenchProjectState): string | undefined {
  return state.refs.current;
}

export function defaultWorkbenchAgentSelectionFromState(state: WorkbenchProjectState): string | undefined {
  const configured = authoredWorkbenchDefaultFromState(state, AGENTS_FILE);
  if (configured === ALL_SELECTOR) {
    return configured;
  }
  return configured && state.agents.some((agent) => agent.name === configured)
    ? configured
    : state.agents[0]?.name;
}

export function defaultWorkbenchSkillSelectionFromState(state: WorkbenchProjectState): string | undefined {
  const configured = authoredWorkbenchDefaultFromState(state, SKILLS_FILE);
  if (configured === ALL_SELECTOR) {
    return configured;
  }
  if (configured && state.skillSources.some((source) => source.name === configured)) {
    return configured;
  }
  if (state.skillSources.some((source) => source.name === PRIMARY_SKILL_NAME)) {
    return PRIMARY_SKILL_NAME;
  }
  return state.skillSources[0]?.name ?? state.skillBundles[0]?.skillName;
}

function authoredWorkbenchDefaultFromState(
  state: WorkbenchProjectState,
  fileName: typeof AGENTS_FILE | typeof SKILLS_FILE,
): string | undefined {
  const current = currentWorkbenchVersionIdFromState(state);
  const version = current
    ? state.versions.find((entry) => entry.id === current)
    : state.versions[0];
  const filePath = path.join(WORKBENCH_DIR, fileName).split(path.sep).join("/");
  const file = version?.files.find((entry) => entry.path === filePath && entry.kind === "text");
  if (!file || file.kind !== "text") {
    return undefined;
  }
  try {
    const record = YAML.parse(file.content) as unknown;
    const defaultValue = typeof record === "object" && record !== null
      ? (record as { default?: unknown }).default
      : undefined;
    return typeof defaultValue === "string" && defaultValue.trim() ? defaultValue.trim() : undefined;
  } catch {
    return undefined;
  }
}

export async function createWorkbenchReadOnlyInspectionSnapshot(
  options: WorkbenchCommandOptions = {},
): Promise<WorkbenchInspectionSnapshot> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  const state = await loadStateReadOnlyWithRetry(root);
  const [authoredAgents, skillSources, syncCount] = await Promise.all([
    readAgents(root).catch(() => []),
    readSkillSources(root).catch(() => state.skillSources),
    pendingSyncCount(root).catch(() => undefined),
  ]);
  const defaultSkill = await readDefaultSkillSelection(root, skillSources)
    .catch(() => defaultWorkbenchSkillSelectionFromState({ ...state, skillSources }));
  const defaultAgent = await readDefaultAgentSelection(root, authoredAgents.length > 0 ? authoredAgents : state.agents)
    .catch(() => defaultWorkbenchAgentSelectionFromState({
      ...state,
      agents: authoredAgents.length > 0 ? authoredAgents : state.agents,
    }));
  return createWorkbenchInspectionSnapshotFromState({
    root,
    state,
    skillSources,
    authoredAgents,
    defaultSkill,
    defaultAgent,
    pendingSyncCount: syncCount,
    ...workbenchPublicationForSnapshot(
      state,
      Object.values(state.remotes).sort((left, right) => left.name.localeCompare(right.name)),
    ),
  });
}

export async function createWorkbenchInspectionSnapshot(options: WorkbenchCommandOptions = {}): Promise<WorkbenchInspectionSnapshot> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    const status = await workbenchStatus({ dir: root, authToken: options.authToken });
    const state = await loadState(root);
    const remotes = Object.values(state.remotes).sort((left, right) => left.name.localeCompare(right.name));
    const authoredAgents = await readAgents(root).catch(() => []);
    return createWorkbenchInspectionSnapshotFromState({
      root,
      skillSources: await readSkillSources(root).catch(() => state.skillSources),
      authoredAgents,
      remotes,
      state,
      currentVersionId: status.currentVersionId,
      defaultSkill: status.defaultSkill,
      defaultAgent: status.defaultAgent,
      pendingSyncCount: status.pendingSyncCount,
      ...workbenchPublicationForSnapshot(state, remotes),
    });
  });
}

export function workbenchJobEvidenceForSnapshot(
  snapshot: WorkbenchInspectionSnapshot,
  selector: { runId: string; jobId: string },
): WorkbenchExecutionTraceDetail | null {
  const run = snapshot.runs.find((entry) => entry.id === selector.runId) ?? null;
  if (!run) {
    return null;
  }
  const job = snapshot.jobs.find((entry) => entry.id === selector.jobId && entry.runId === run.id) ?? null;
  if (!job) {
    return null;
  }
  const traces = snapshot.traces.filter((trace) =>
    job.traceIds.includes(trace.id) || trace.jobId === job.id
  );
  const role = job.kind === "improve" ? "improver" : "engine";
  const fileSessions = traces.flatMap((trace) =>
    buildWorkbenchTraceSessionsFromFiles({
      job: remoteJobForInspectionJob(job, run),
      files: trace.files,
      purpose: job.kind,
      fallbackRole: role,
    }).map((session) => withTraceSessionOwner(session, trace.id))
  );
  const progressSessions = fileSessions.length === 0
    ? buildWorkbenchTraceSessionsFromExecutionEvents({
        run,
        job,
        role,
        batches: snapshot.executionEvents.filter((batch) =>
          batch.runId === run.id && batch.jobId === job.id
        ),
      })
    : [];
  const sessions = fileSessions.length > 0 ? fileSessions : progressSessions;
  const trace = sessions.length > 0
    ? combineWorkbenchTraceSessions(sessions)
    : syntheticTraceForInspectionJob(job, run);
  const execution: WorkbenchExecutionEvidence = {
    id: `job:${run.id}:${job.id}`,
    kind: job.kind,
    executionId: null,
    role,
    status: remoteStatusForInspectionJob(job.status),
    jobIds: [job.id],
    executionIds: [],
    versionId: job.versionId,
    caseId: job.caseId,
    sampleIndex: job.sample,
    sessions,
    trace,
  };
  return {
    projectId: snapshot.root,
    runId: run.id,
    executions: [execution],
  };
}

function withTraceSessionOwner(session: WorkbenchTraceSession, traceId: string): WorkbenchTraceSession {
  return {
    ...session,
    id: `${traceId}:${session.id}`,
    metadata: {
      ...(session.metadata ?? {}),
      trace_id: traceId,
    },
  };
}

function buildWorkbenchTraceSessionsFromExecutionEvents(args: {
  run: WorkbenchRun;
  job: WorkbenchJob;
  role: WorkbenchTraceSession["role"];
  batches: readonly WorkbenchExecutionEventBatch[];
}): WorkbenchTraceSession[] {
  const trace = executionTraceFromEventBatches(args.batches);
  if (!trace) {
    return [];
  }
  return [{
    id: `${args.job.id}:live-progress`,
    jobId: args.job.id,
    role: args.role,
    kind: "progress",
    label: "Live trace",
    sourcePath: null,
    trace: {
      ...trace,
      summaries: trace.summaries.length > 0
        ? trace.summaries
        : syntheticTraceForInspectionJob(args.job, args.run).summaries,
    },
    metadata: {
      progress_batches: args.batches.length,
    },
  }];
}

function executionTraceFromEventBatches(
  batches: readonly WorkbenchExecutionEventBatch[],
): WorkbenchExecutionTrace | null {
  const spans = new Map<string, WorkbenchExecutionTrace["spans"][number]>();
  const events = new Map<string, WorkbenchExecutionTrace["events"][number]>();
  const summaries = new Map<string, WorkbenchExecutionTrace["summaries"][number]>();
  const ordered = [...batches].sort((left, right) =>
    left.seqStart - right.seqStart || left.emittedAt.localeCompare(right.emittedAt)
  );
  for (const batch of ordered) {
    for (const event of batch.events) {
      if (event.schema !== "workbench.trace.delta.v1") {
        continue;
      }
      const delta = workbenchExecutionTraceFromJson(event.payload);
      if (!delta) {
        continue;
      }
      for (const span of delta.spans) {
        spans.set(span.id, span);
      }
      for (const traceEvent of delta.events) {
        events.set(traceEvent.id, traceEvent);
      }
      for (const summary of delta.summaries) {
        summaries.set(traceSummaryIdentity(summary), summary);
      }
    }
  }
  if (spans.size === 0 && events.size === 0 && summaries.size === 0) {
    return null;
  }
  return {
    trace_id: ordered[0]?.executionId ?? "live-progress",
    spans: [...spans.values()].sort((left, right) =>
      left.started_at.localeCompare(right.started_at) || left.id.localeCompare(right.id)
    ),
    events: [...events.values()].sort((left, right) =>
      left.at.localeCompare(right.at) || left.id.localeCompare(right.id)
    ),
    summaries: [...summaries.values()].sort((left, right) =>
      left.started_at.localeCompare(right.started_at) || traceSummaryIdentity(left).localeCompare(traceSummaryIdentity(right))
    ),
  };
}

function workbenchExecutionTraceFromJson(value: Json): WorkbenchExecutionTrace | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, Json>;
  const spans = Array.isArray(record.spans)
    ? record.spans.flatMap((entry) => {
        const span = workbenchTraceSpanFromJson(entry);
        return span ? [span] : [];
      })
    : [];
  const events = Array.isArray(record.events)
    ? record.events.flatMap((entry) => {
        const event = workbenchTraceEventFromJson(entry);
        return event ? [event] : [];
      })
    : [];
  const summaries = Array.isArray(record.summaries)
    ? record.summaries.flatMap((entry) => {
        const summary = workbenchTraceSummaryFromJson(entry);
        return summary ? [summary] : [];
      })
    : [];
  if (spans.length === 0 && events.length === 0 && summaries.length === 0) {
    return null;
  }
  return {
    trace_id: typeof record.trace_id === "string" ? record.trace_id : "live-progress",
    spans,
    events,
    summaries,
  };
}

function workbenchTraceSpanFromJson(value: Json): WorkbenchExecutionTrace["spans"][number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, Json>;
  const id = typeof record.id === "string" ? record.id : "";
  const kind = workbenchTraceSpanKind(record.kind);
  const status = workbenchTraceStatus(record.status);
  const startedAt = typeof record.started_at === "string" ? record.started_at : "";
  if (!id || !kind || !status || !startedAt) {
    return null;
  }
  return {
    id,
    parent_id: typeof record.parent_id === "string" ? record.parent_id : null,
    attempt_number: positiveInteger(record.attempt_number) ?? 1,
    stage_id: typeof record.stage_id === "string" ? record.stage_id : null,
    stage_run_index: integerOrNull(record.stage_run_index),
    kind,
    title: typeof record.title === "string" ? record.title : id,
    status,
    started_at: startedAt,
    ended_at: typeof record.ended_at === "string" ? record.ended_at : null,
    attributes: jsonRecord(record.attributes) as Record<string, Json>,
  };
}

function workbenchTraceEventFromJson(value: Json): WorkbenchExecutionTrace["events"][number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, Json>;
  const id = typeof record.id === "string" ? record.id : "";
  const spanId = typeof record.span_id === "string" ? record.span_id : "";
  const kind = workbenchTraceEventKind(record.kind);
  const at = typeof record.at === "string" ? record.at : "";
  if (!id || !spanId || !kind || !at) {
    return null;
  }
  return {
    id,
    span_id: spanId,
    attempt_number: positiveInteger(record.attempt_number) ?? 1,
    stage_id: typeof record.stage_id === "string" ? record.stage_id : null,
    stage_run_index: integerOrNull(record.stage_run_index),
    kind,
    at,
    message: typeof record.message === "string" ? record.message : kind,
    attributes: jsonRecord(record.attributes) as Record<string, Json>,
  };
}

function workbenchTraceSummaryFromJson(value: Json): WorkbenchExecutionTrace["summaries"][number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, Json>;
  const status = workbenchTraceStatus(record.status);
  const startedAt = typeof record.started_at === "string" ? record.started_at : "";
  if (!status || !startedAt) {
    return null;
  }
  return {
    attempt_number: positiveInteger(record.attempt_number) ?? 1,
    stage_id: typeof record.stage_id === "string" ? record.stage_id : null,
    stage_run_index: integerOrNull(record.stage_run_index),
    status,
    started_at: startedAt,
    ended_at: typeof record.ended_at === "string" ? record.ended_at : null,
    duration_ms: nonNegativeInteger(record.duration_ms) ?? 0,
    tool_call_count: nonNegativeInteger(record.tool_call_count) ?? 0,
    input_tokens: nonNegativeInteger(record.input_tokens),
    output_tokens: nonNegativeInteger(record.output_tokens),
    usage: workbenchTraceUsageSummaryFromJson(record.usage),
    final_output_present: record.final_output_present === true,
    error_message: typeof record.error_message === "string" ? record.error_message : null,
  };
}

function traceSummaryIdentity(summary: WorkbenchExecutionTrace["summaries"][number]): string {
  return [
    summary.attempt_number,
    summary.stage_id ?? "",
    summary.stage_run_index ?? "",
  ].join(":");
}

function workbenchTraceUsageSummaryFromJson(value: unknown): WorkbenchExecutionTrace["summaries"][number]["usage"] {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return {
    provider: typeof record.provider === "string" ? record.provider : null,
    model: typeof record.model === "string" ? record.model : null,
    input_tokens: nonNegativeInteger(record.input_tokens),
    uncached_input_tokens: nonNegativeInteger(record.uncached_input_tokens),
    cached_input_tokens: nonNegativeInteger(record.cached_input_tokens),
    cache_creation_input_tokens: nonNegativeInteger(record.cache_creation_input_tokens),
    cache_read_input_tokens: nonNegativeInteger(record.cache_read_input_tokens),
    output_tokens: nonNegativeInteger(record.output_tokens),
    reasoning_output_tokens: nonNegativeInteger(record.reasoning_output_tokens),
    total_tokens: nonNegativeInteger(record.total_tokens),
    total_cost_usd: nonNegativeNumber(record.total_cost_usd),
    cost_source: typeof record.cost_source === "string" ? record.cost_source : null,
    pricing_source: typeof record.pricing_source === "string" ? record.pricing_source : null,
  };
}

function workbenchTraceSpanKind(value: unknown): WorkbenchExecutionTrace["spans"][number]["kind"] | null {
  return value === "hook" ||
    value === "stage" ||
    value === "turn" ||
    value === "tool_call" ||
    value === "assistant_output" ||
    value === "usage" ||
    value === "gate" ||
    value === "action" ||
    value === "error"
    ? value
    : null;
}

function workbenchTraceEventKind(value: unknown): WorkbenchExecutionTrace["events"][number]["kind"] | null {
  return value === "status" ||
    value === "message" ||
    value === "output" ||
    value === "usage" ||
    value === "error" ||
    value === "note"
    ? value
    : null;
}

function workbenchTraceStatus(value: unknown): WorkbenchExecutionTrace["summaries"][number]["status"] | null {
  return value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "canceled" ||
    value === "warning"
    ? value
    : null;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function positiveInteger(value: unknown): number | null {
  const integer = integerOrNull(value);
  return integer !== null && integer > 0 ? integer : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const integer = integerOrNull(value);
  return integer !== null && integer >= 0 ? integer : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function remoteJobForInspectionJob(job: WorkbenchJob, run: WorkbenchRun): RemoteWorkbenchJob {
  const input: Record<string, Json> = {
    execution: {
      purpose: job.kind === "improve" ? "improve" : "attempt",
      metadata: {
        caseId: job.caseId,
        sampleIndex: job.sample,
      },
    },
  };
  return {
    id: job.id,
    projectId: run.versionId,
    runId: run.id,
    versionId: job.versionId,
    kind: "execute",
    status: remoteStatusForInspectionJob(job.status),
    attempt: 1,
    createdAt: job.createdAt,
    updatedAt: job.finishedAt ?? job.startedAt ?? job.createdAt,
    ...(job.startedAt ? { startedAt: job.startedAt } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    input,
    ...(job.error ? { error: job.error } : {}),
  };
}

function remoteStatusForInspectionJob(status: WorkbenchJob["status"]): RemoteWorkbenchJob["status"] {
  if (status === "canceled") {
    return "cancelled";
  }
  return status;
}

function traceStatusForInspectionJob(status: WorkbenchJob["status"]): WorkbenchExecutionTrace["summaries"][number]["status"] {
  if (status === "succeeded") {
    return "completed";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "canceled") {
    return "canceled";
  }
  return "running";
}

function syntheticTraceForInspectionJob(job: WorkbenchJob, run: WorkbenchRun): WorkbenchExecutionTrace {
  const startedAt = job.startedAt ?? job.createdAt;
  const endedAt = job.finishedAt ?? run.finishedAt ?? null;
  const terminal = job.status === "succeeded" || job.status === "failed" || job.status === "canceled";
  return {
    trace_id: `job-${job.id}`,
    spans: [],
    events: [],
    summaries: [{
      attempt_number: 1,
      stage_id: job.kind,
      stage_run_index: null,
      status: traceStatusForInspectionJob(job.status),
      started_at: startedAt,
      ended_at: terminal ? endedAt ?? startedAt : null,
      duration_ms: job.durationMs ?? (endedAt ? timestampDurationMs(startedAt, endedAt) : 0),
      tool_call_count: 0,
      input_tokens: null,
      output_tokens: null,
      usage: null,
      final_output_present: job.status === "succeeded",
      error_message: job.error ?? run.error ?? null,
    }],
  };
}

function timestampDurationMs(startedAt: string, endedAt: string): number {
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  return Number.isFinite(started) && Number.isFinite(ended)
    ? Math.max(0, ended - started)
    : 0;
}

function workbenchPublicationForSnapshot(
  state: WorkbenchProjectState,
  remotes: readonly WorkbenchRemote[],
): Pick<WorkbenchInspectionSnapshot, "publication"> {
  const versionId = state.refs.published;
  if (!versionId || state.refs[`releases/${versionId}`] !== versionId) {
    return {};
  }
  const remote = remotes.find((entry) => entry.name === "origin") ?? remotes[0];
  if (!remote) {
    return {};
  }
  if (isHttpRemote(remote)) {
    const parsed = parseHttpRemote(remote);
    const referenced = publicationFromRefs(state.refs, versionId);
    if (referenced) {
      return { publication: referenced };
    }
    return {
      publication: {
        versionId,
        installUrl: `${parsed.baseUrl}/skills/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}`,
        pinnedInstallUrl: `${parsed.baseUrl}/skills/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}/releases/${encodeURIComponent(versionId)}`,
      },
    };
  }
  return {};
}

export function exportObjectPack(state: WorkbenchProjectState): WorkbenchObjectPack {
  return {
    schema: PACK_SCHEMA,
    createdAt: now(),
    refs: { ...state.refs },
    versions: state.versions.map(copyVersion),
    skillSources: state.skillSources.map(copySkillSource),
    skillBundles: state.skillBundles.map(copySkillBundle),
    evals: state.evals.map((entry) => ({ ...entry, files: entry.files.map(copyFile) })),
    agents: state.agents.map(copyAgent),
    runs: state.runs.map(copyRun),
    jobs: state.jobs.map(copyJob),
    traces: state.traces.map(copyTrace),
    executionEvents: state.executionEvents.map(copyExecutionEventBatch),
    artifacts: state.artifacts.map(copyArtifact),
    lineage: state.lineage.map((entry) => ({ ...entry, parentId: entry.parentId, childId: entry.childId })),
  };
}

function exportObjectPackForRemote(state: WorkbenchProjectState): WorkbenchObjectPack {
  return exportObjectPack({
    ...state,
    refs: refsForRemoteSync(state.refs),
  });
}

function refsForRemoteSync(refs: WorkbenchRefs): WorkbenchRefs {
  return Object.fromEntries(Object.entries(refs)
    .filter(([name]) =>
      !name.startsWith("remotes/") &&
      name !== "current" &&
      name !== "published" &&
      !name.startsWith("releases/") &&
      !name.startsWith("publication/")
    ));
}

function publicationRefs(refs: WorkbenchRefs): WorkbenchRefs {
  return Object.fromEntries(Object.entries(refs)
    .filter(([name]) =>
      name === "published" ||
      name.startsWith("releases/") ||
      name.startsWith("publication/")
    ));
}

function withRemoteTrackingRefs(
  localRefs: WorkbenchRefs,
  remoteName: string,
  remoteRefs: WorkbenchRefs,
): WorkbenchRefs {
  const prefix = `remotes/${safeObjectFileName(remoteName)}/`;
  const next = Object.fromEntries(Object.entries(localRefs)
    .filter(([name]) => !name.startsWith(prefix)));
  for (const [name, value] of Object.entries(remoteRefs)) {
    if (!value || name.startsWith("remotes/")) {
      continue;
    }
    next[`${prefix}${name}`] = value;
  }
  return next;
}

function withMergedRemoteTrackingRefs(
  localRefs: WorkbenchRefs,
  remoteName: string,
  remoteRefs: WorkbenchRefs,
): WorkbenchRefs {
  const prefix = `remotes/${safeObjectFileName(remoteName)}/`;
  const next = { ...localRefs };
  for (const [name, value] of Object.entries(remoteRefs)) {
    if (!value || name.startsWith("remotes/")) {
      continue;
    }
    next[`${prefix}${name}`] = value;
  }
  return next;
}

function publicationRefsForVersion(
  versionId: string,
  publication?: { installUrl: string; pinnedInstallUrl: string },
  visibility?: WorkbenchPublishVisibility,
): WorkbenchRefs {
  return {
    published: versionId,
    [`releases/${versionId}`]: versionId,
    ...(publication?.installUrl ? { "publication/install-url": publication.installUrl } : {}),
    ...(publication?.pinnedInstallUrl ? { "publication/pinned-install-url": publication.pinnedInstallUrl } : {}),
    ...(visibility ? { "publication/visibility": visibility } : {}),
  };
}

function publicationFromRefs(
  refs: WorkbenchRefs,
  versionId: string,
): WorkbenchInspectionSnapshot["publication"] | undefined {
  const installUrl = refs["publication/install-url"];
  const pinnedInstallUrl = refs["publication/pinned-install-url"];
  if (!installUrl || !pinnedInstallUrl) {
    return undefined;
  }
  return {
    versionId,
    installUrl,
    pinnedInstallUrl,
  };
}

function publicationStatusFromRefs(
  refs: WorkbenchRefs,
  remoteName?: string,
): WorkbenchStatusSnapshot["remotes"][number]["publication"] {
  const prefix = remoteName ? `remotes/${safeObjectFileName(remoteName)}/` : "";
  const versionId = refs[`${prefix}published`];
  if (!versionId || refs[`${prefix}releases/${versionId}`] !== versionId) {
    return { status: "unpublished" };
  }
  return {
    status: "published",
    versionId,
    ...(refs[`${prefix}publication/visibility`] ? { visibility: refs[`${prefix}publication/visibility`] } : {}),
    ...(refs[`${prefix}publication/install-url`] ? { installUrl: refs[`${prefix}publication/install-url`] } : {}),
    ...(refs[`${prefix}publication/pinned-install-url`] ? { pinnedInstallUrl: refs[`${prefix}publication/pinned-install-url`] } : {}),
  };
}

function unpublishedPublicationStatus(): WorkbenchStatusSnapshot["remotes"][number]["publication"] {
  return { status: "unpublished" };
}

function withPublicationRefsFromRemote(
  refs: WorkbenchRefs,
  remoteRefs: WorkbenchRefs,
): WorkbenchRefs {
  const nonPublicationRefs = Object.fromEntries(Object.entries(refs)
    .filter(([name]) =>
      name !== "published" &&
      !name.startsWith("releases/") &&
      !name.startsWith("publication/")
    ));
  return {
    ...nonPublicationRefs,
    ...publicationRefs(remoteRefs),
  };
}

interface ImportObjectPackOptions {
  refs?: "merge" | "none";
}

export function importObjectPack(
  state: WorkbenchProjectState,
  pack: WorkbenchObjectPack,
  options: ImportObjectPackOptions = {},
): void {
  if (pack.schema !== PACK_SCHEMA) {
    throw new WorkbenchUserError("Unsupported Workbench object pack.");
  }
  const requiredArrays = [
    "versions",
    "skillSources",
    "skillBundles",
    "evals",
    "agents",
    "runs",
    "jobs",
    "traces",
    "executionEvents",
    "artifacts",
    "lineage",
  ] as const;
  for (const field of requiredArrays) {
    if (!Array.isArray((pack as unknown as Record<string, unknown>)[field])) {
      throw new WorkbenchUserError("Unsupported Workbench object pack.");
    }
  }
  for (const version of pack.versions) {
    upsertVersionObject(state, copyVersion(version));
  }
  for (const evalSnapshot of pack.evals) {
    upsertEvalSnapshotObject(state.evals, copyEval(evalSnapshot));
  }
  for (const source of pack.skillSources) {
    upsertByName(state.skillSources, copySkillSource(source));
  }
  for (const bundle of pack.skillBundles) {
    upsertSkillBundleObject(state.skillBundles, copySkillBundle(bundle));
  }
  for (const agent of pack.agents) {
    upsertImmutableByContentHash(state.agents, copyAgent(agent), "agent");
  }
  for (const edge of pack.lineage) {
    upsertLineageObject(state, edge);
  }
  for (const run of pack.runs) {
    upsertRunObject(state.runs, copyRun(run));
  }
  for (const job of pack.jobs) {
    upsertJobObject(state.jobs, copyJob(job));
  }
  for (const trace of pack.traces) {
    upsertImmutableById(state.traces, copyTrace(trace), "trace");
  }
  for (const batch of pack.executionEvents) {
    upsertExecutionEventBatch(state.executionEvents, copyExecutionEventBatch(batch));
  }
  for (const artifact of pack.artifacts) {
    upsertImmutableById(state.artifacts, copyArtifact(artifact), "artifact");
  }
  if ((options.refs ?? "merge") === "merge") {
    state.refs = { ...state.refs, ...pack.refs };
  }
}

function emptyObjectPack(): WorkbenchObjectPack {
  return {
    schema: PACK_SCHEMA,
    createdAt: now(),
    refs: {},
    versions: [],
    skillSources: [],
    skillBundles: [],
    evals: [],
    agents: [],
    runs: [],
    jobs: [],
    traces: [],
    executionEvents: [],
    artifacts: [],
    lineage: [],
  };
}

function objectPackSize(pack: WorkbenchObjectPack): number {
  return pack.versions.length +
    pack.skillSources.length +
    pack.skillBundles.length +
    pack.evals.length +
    pack.agents.length +
    pack.runs.length +
    pack.jobs.length +
    pack.traces.length +
    pack.executionEvents.length +
    pack.artifacts.length +
    pack.lineage.length;
}

function objectPackDeltaForRemoteWrite(
  merged: WorkbenchObjectPack,
  remote: WorkbenchObjectPack,
): WorkbenchObjectPack {
  const remoteVersions = mapBy(remote.versions, (entry) => entry.id);
  const remoteSkillSources = mapBy(remote.skillSources, (entry) => entry.name);
  const remoteSkillBundles = mapBy(remote.skillBundles, (entry) => entry.hash);
  const remoteEvals = mapBy(remote.evals, (entry) => entry.hash);
  const remoteAgentHashes = new Set(remote.agents.map((entry) => hashJson(entry)));
  const remoteRuns = mapBy(remote.runs, (entry) => entry.id);
  const remoteJobs = mapBy(remote.jobs, (entry) => entry.id);
  const remoteTraces = mapBy(remote.traces, (entry) => entry.id);
  const remoteExecutionEvents = mapBy(remote.executionEvents, workbenchExecutionEventBatchId);
  const remoteArtifacts = mapBy(remote.artifacts, (entry) => entry.id);
  const remoteLineageHashes = new Set(remote.lineage.map((entry) => hashJson(entry)));
  return {
    ...merged,
    versions: merged.versions.filter((entry) => !sameJsonObject(remoteVersions.get(entry.id), entry)),
    skillSources: merged.skillSources.filter((entry) => !sameJsonObject(remoteSkillSources.get(entry.name), entry)),
    skillBundles: merged.skillBundles.filter((entry) => !sameSkillBundleObject(remoteSkillBundles.get(entry.hash), entry)),
    evals: merged.evals.filter((entry) => !sameJsonObject(remoteEvals.get(entry.hash), entry)),
    agents: merged.agents.filter((entry) => !remoteAgentHashes.has(hashJson(entry))),
    runs: merged.runs.filter((entry) => !sameJsonObject(remoteRuns.get(entry.id), entry)),
    jobs: merged.jobs.filter((entry) => !sameJsonObject(remoteJobs.get(entry.id), entry)),
    traces: merged.traces.filter((entry) => !sameJsonObject(remoteTraces.get(entry.id), entry)),
    executionEvents: merged.executionEvents.filter((entry) =>
      !sameJsonObject(remoteExecutionEvents.get(workbenchExecutionEventBatchId(entry)), entry)
    ),
    artifacts: merged.artifacts.filter((entry) => !sameJsonObject(remoteArtifacts.get(entry.id), entry)),
    lineage: merged.lineage.filter((entry) => !remoteLineageHashes.has(hashJson(entry))),
  };
}

function mapBy<T>(entries: readonly T[], key: (entry: T) => string): Map<string, T> {
  return new Map(entries.map((entry) => [key(entry), entry]));
}

function sameJsonObject<T>(existing: T | undefined, incoming: T): boolean {
  return existing !== undefined && hashJson(existing) === hashJson(incoming);
}

function sameSkillBundleObject(
  existing: WorkbenchSkillBundleSnapshot | undefined,
  incoming: WorkbenchSkillBundleSnapshot,
): boolean {
  return existing !== undefined &&
    hashJson(comparableSkillBundle(existing)) === hashJson(comparableSkillBundle(incoming));
}

export function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function hashFiles(files: readonly SurfaceSnapshotFile[]): string {
  return hashJson(files.map((file) => ({
    path: file.path,
    encoding: file.encoding ?? "utf8",
    executable: file.executable === true,
    content: file.content,
  })).sort((left, right) => left.path.localeCompare(right.path)));
}

export function workbenchExecutionEventBatchId(batch: WorkbenchExecutionEventBatch): string {
  return [
    "evt_progress",
    batch.jobId,
    batch.executionId,
    String(batch.attempt),
    String(batch.seqStart),
    String(batch.seqEnd),
  ].join("_").replace(/[^a-z0-9_]+/giu, "_").slice(0, 180);
}

function localWorkbenchExecutionProgressTarget(args: {
  root: string;
  state: WorkbenchProjectState;
  projectId: string;
  runId: string;
  jobId: string;
}): WorkbenchExecutionProgressTarget {
  const token = randomBytes(24).toString("base64url");
  return {
    url: `http://127.0.0.1/.workbench/progress/${encodeURIComponent(args.jobId)}`,
    token,
    ownerUserId: "local",
    transport: "stdout",
    flushWindowMs: 1_000,
    appendBatch: async (batch) => {
      if (
        batch.projectId !== args.projectId ||
        batch.runId !== args.runId ||
        batch.jobId !== args.jobId
      ) {
        return;
      }
      const copy = copyExecutionEventBatch(batch);
      upsertExecutionEventBatch(args.state.executionEvents, copy);
      await writeJson(
        path.join(objectTypeDir(args.root, "execution-event"), `${safeObjectFileName(workbenchExecutionEventBatchId(copy))}.json`),
        copy,
      );
    },
  };
}

async function executeWorkbenchEvaluationRun(args: {
  root: string;
  state: WorkbenchProjectState;
  version: WorkbenchVersion;
  skillBundle: WorkbenchSkillBundleSnapshot;
  evalSnapshot: WorkbenchEvalSnapshot;
  agent: WorkbenchAgent;
  kind: WorkbenchRunKind;
  samples: number;
  cases?: readonly WorkbenchEvalCaseRuntime[];
  environmentDockerfile?: string;
  parentRunId?: string;
  caseIds?: readonly string[];
  selectedSamples?: readonly WorkbenchCaseSampleSelection[];
  request?: Record<string, Json>;
  result?: Record<string, Json>;
}): Promise<WorkbenchRun> {
  const samples = Math.max(1, Math.floor(args.samples));
  const cases = selectEvalCasesForRun(
    args.cases ?? await readEvalCases(args.root),
    args.caseIds,
    args.selectedSamples,
  );
  if (cases.length === 0) {
    throw new WorkbenchUserError("No eval cases found. Add files under `.workbench/cases`.");
  }
  const run: WorkbenchRun = {
    id: nextRunId(),
    kind: args.kind,
    versionId: args.version.id,
    skillName: args.skillBundle.skillName,
    skillBundleHash: args.skillBundle.hash,
    evalHash: args.evalSnapshot.hash,
    agentName: args.agent.name,
    agentHash: hashJson(args.agent),
    status: "running",
    jobIds: [],
    traceIds: [],
    createdAt: now(),
    ...(args.parentRunId ? { parentRunId: args.parentRunId } : {}),
  };
  const environmentDockerfile = args.environmentDockerfile ?? await readSkillEvalEnvironmentDockerfile(args.root);
  const planned: Array<{
    input: WorkbenchExecutionRuntimeInput;
    runtimeCase: WorkbenchEvalCaseRuntime;
    sample: number;
    artifactId: string;
    traceId: string;
  }> = [];
  for (const runtimeCase of cases) {
    for (const sample of sampleIndexesForRun(runtimeCase, samples, args.selectedSamples)) {
      const jobId = nextJobId();
      planned.push({
        input: createWorkbenchSkillEvalRuntimeInput({
          ownerUserId: "local",
          projectId: "local",
          runId: run.id,
          jobId,
          versionId: args.version.id,
          skillName: args.skillBundle.skillName,
          skillBundleHash: args.skillBundle.hash,
          evalHash: args.evalSnapshot.hash,
          evalSnapshot: args.evalSnapshot,
          agent: args.agent,
          versionFiles: args.skillBundle.files,
          runtimeCase,
          sample,
          createdAt: run.createdAt,
          environmentDockerfile,
        }),
        runtimeCase,
        sample,
        artifactId: nextArtifactId(),
        traceId: `trace_${jobId}`,
      });
    }
  }
  const inputsByJobId = new Map(planned.map((entry) => [entry.input.job.id, entry]));
  run.jobIds = planned.map((entry) => entry.input.job.id);
  upsertRunObject(args.state.runs, run);
  for (const plannedJob of planned) {
    upsertJobObject(args.state.jobs, skillEvalLifecycleJobFromRemoteJob({
      remoteJob: plannedJob.input.job,
      run,
      version: args.version,
      skillBundle: args.skillBundle,
      evalSnapshot: args.evalSnapshot,
      agent: args.agent,
      runtimeCase: plannedJob.runtimeCase,
      sample: plannedJob.sample,
    }));
  }
  await saveState(args.root, args.state);
  const persistedTerminalJobs = new Map<string, ReturnType<typeof skillEvalObjectsFromRemoteJob>>();
  const persistTerminalJob = async (completed: RemoteWorkbenchJob): Promise<void> => {
    const plannedJob = inputsByJobId.get(completed.id);
    if (!plannedJob) {
      return;
    }
    const result = skillEvalObjectsFromRemoteJob({
      remoteJob: completed,
      run,
      version: args.version,
      skillBundle: args.skillBundle,
      evalSnapshot: args.evalSnapshot,
      agent: args.agent,
      runtimeCase: plannedJob.runtimeCase,
      sample: plannedJob.sample,
      artifactId: plannedJob.artifactId,
      traceId: plannedJob.traceId,
      request: args.request,
      result: args.result,
    });
    persistedTerminalJobs.set(completed.id, result);
    run.jobIds = Array.from(new Set([...(run.jobIds ?? []), result.job.id]));
    run.traceIds = Array.from(new Set([...run.traceIds, result.trace.id]));
    upsertJobObject(args.state.jobs, result.job);
    upsertImmutableById(args.state.artifacts, result.artifact, "artifact");
    upsertImmutableById(args.state.traces, result.trace, "trace");
    await saveState(args.root, args.state);
  };
  let dag: Awaited<ReturnType<typeof runWorkbenchExecutionDag>>;
  try {
    dag = await runWorkbenchExecutionDag({
      jobs: planned.map((entry) => entry.input.job),
      capacity: await localWorkbenchSkillEvalCapacity(args.root),
      sandboxBackend: DOCKER_SANDBOX_BACKEND,
      onJobStarted: async (job) => {
        const plannedJob = inputsByJobId.get(job.id);
        if (!plannedJob) {
          return;
        }
        upsertJobObject(args.state.jobs, skillEvalLifecycleJobFromRemoteJob({
          remoteJob: job,
          run,
          version: args.version,
          skillBundle: args.skillBundle,
          evalSnapshot: args.evalSnapshot,
          agent: args.agent,
          runtimeCase: plannedJob.runtimeCase,
          sample: plannedJob.sample,
        }));
        await saveState(args.root, args.state);
      },
      onJobFinished: persistTerminalJob,
      executeJob: async (job) => {
        const plannedJob = inputsByJobId.get(job.id);
        if (!plannedJob) {
          throw new Error(`Missing planned skill eval job: ${job.id}`);
        }
        return await executeWorkbenchExecutionJob({
          ...plannedJob.input,
          job,
          progress: localWorkbenchExecutionProgressTarget({
            root: args.root,
            state: args.state,
            projectId: job.projectId,
            runId: run.id,
            jobId: job.id,
          }),
        }, {
          sandboxBackend: DOCKER_SANDBOX_BACKEND,
          loadLocalAdapterAuthProfiles: isProviderBackedSkillEvalAgent(args.agent),
        });
      },
    });
  } catch (error) {
    const finishedAt = now();
    run.finishedAt = finishedAt;
    run.status = "failed";
    run.error = error instanceof Error ? error.message : String(error);
    upsertRunObject(args.state.runs, run);
    await saveState(args.root, args.state);
    return run;
  }
  const jobs: WorkbenchJob[] = [];
  for (const completed of dag.jobs) {
    const plannedJob = inputsByJobId.get(completed.id);
    if (!plannedJob) {
      continue;
    }
    const result = persistedTerminalJobs.get(completed.id) ?? skillEvalObjectsFromRemoteJob({
        remoteJob: completed,
        run,
        version: args.version,
        skillBundle: args.skillBundle,
        evalSnapshot: args.evalSnapshot,
        agent: args.agent,
        runtimeCase: plannedJob.runtimeCase,
        sample: plannedJob.sample,
        artifactId: plannedJob.artifactId,
        traceId: plannedJob.traceId,
        request: args.request,
        result: args.result,
      });
    jobs.push(result.job);
    run.jobIds = Array.from(new Set([...(run.jobIds ?? []), result.job.id]));
    run.traceIds = Array.from(new Set([...run.traceIds, result.trace.id]));
    upsertJobObject(args.state.jobs, result.job);
    upsertImmutableById(args.state.artifacts, result.artifact, "artifact");
    upsertImmutableById(args.state.traces, result.trace, "trace");
  }
  const finishedAt = now();
  run.finishedAt = finishedAt;
  run.status = jobs.every((job) => job.status === "succeeded") ? "succeeded" : "failed";
  const scoredJobs = jobs.filter((job) => typeof job.score === "number");
  if (scoredJobs.length > 0) {
    run.score = Number((scoredJobs.reduce((sum, job) => sum + (job.score ?? 0), 0) / scoredJobs.length).toFixed(3));
  }
  run.latencyMs = jobs.reduce((sum, job) => sum + (job.durationMs ?? 0), 0);
  const costUsd = readWorkbenchSkillTraceResultsCostUsd(
    args.state.traces
      .filter((trace) => trace.runId === run.id)
      .map((trace) => trace.result),
  );
  if (costUsd !== undefined) {
    run.costUsd = costUsd;
  }
  const errors = jobs.flatMap((job) => job.error ? [job.error] : []);
  if (errors.length > 0) {
    run.error = errors.slice(0, 3).join("\n");
  }
  upsertRunObject(args.state.runs, run);
  return run;
}

function selectEvalCasesForRun(
  cases: readonly WorkbenchEvalCaseRuntime[],
  caseIds: readonly string[] | undefined,
  selectedSamples: readonly WorkbenchCaseSampleSelection[] | undefined,
): WorkbenchEvalCaseRuntime[] {
  const requested = new Set([
    ...(caseIds ?? []),
    ...(selectedSamples ?? []).map((entry) => entry.caseId),
  ]);
  if (requested.size === 0) {
    return cases.map((entry) => ({ ...entry }));
  }
  const known = new Set(cases.flatMap((entry) => [entry.id, entry.path]));
  const missing = [...requested].filter((entry) => !known.has(entry));
  if (missing.length > 0) {
    throw new WorkbenchUserError(`Eval case not found for selected sample: ${missing.join(", ")}`);
  }
  return cases
    .filter((entry) => requested.has(entry.id) || requested.has(entry.path))
    .map((entry) => ({ ...entry }));
}

function sampleIndexesForRun(
  runtimeCase: WorkbenchEvalCaseRuntime,
  samples: number,
  selectedSamples: readonly WorkbenchCaseSampleSelection[] | undefined,
): number[] {
  const explicit = (selectedSamples ?? [])
    .filter((entry) => entry.caseId === runtimeCase.id || entry.caseId === runtimeCase.path)
    .map((entry) => entry.sample);
  if (explicit.length === 0) {
    return Array.from({ length: samples }, (_, index) => index);
  }
  const normalized = new Set<number>();
  for (const sample of explicit) {
    if (!Number.isInteger(sample) || sample < 0) {
      throw new WorkbenchUserError(`Eval sample index must be a non-negative integer: ${sample}`);
    }
    normalized.add(sample);
  }
  return [...normalized].sort((left, right) => left - right);
}

function skillEvalLifecycleJobFromRemoteJob(args: {
  remoteJob: RemoteWorkbenchJob;
  run: WorkbenchRun;
  version: WorkbenchVersion;
  skillBundle: WorkbenchSkillBundleSnapshot;
  evalSnapshot: WorkbenchEvalSnapshot;
  agent: WorkbenchAgent;
  runtimeCase: WorkbenchEvalCaseRuntime;
  sample: number;
}): WorkbenchJob {
  const finishedAt = args.remoteJob.finishedAt;
  const status: WorkbenchJob["status"] =
    args.remoteJob.status === "queued" ? "queued" :
      args.remoteJob.status === "running" ? "running" :
        args.remoteJob.status === "succeeded" ? "succeeded" :
          args.remoteJob.status === "cancelled" ? "canceled" : "failed";
  return {
    id: args.remoteJob.id,
    runId: args.run.id,
    kind: args.run.kind,
    versionId: args.version.id,
    skillName: args.skillBundle.skillName,
    skillBundleHash: args.skillBundle.hash,
    evalHash: args.evalSnapshot.hash,
    agentName: args.agent.name,
    agentHash: args.run.agentHash,
    caseId: args.runtimeCase.id,
    sample: args.sample,
    status,
    command: configString(asRuntimeRecord(asRuntimeRecord(jsonRecord(args.remoteJob.input).execution).adapter).with as Record<string, Json>, "command"),
    artifactIds: [],
    traceIds: [],
    createdAt: args.remoteJob.createdAt,
    ...(args.remoteJob.startedAt ? { startedAt: args.remoteJob.startedAt } : {}),
    ...(finishedAt ? { finishedAt, durationMs: durationMsBetween(args.remoteJob.startedAt, finishedAt) } : {}),
    ...(args.remoteJob.error ? { error: args.remoteJob.error } : {}),
  };
}

function skillEvalObjectsFromRemoteJob(args: {
  remoteJob: RemoteWorkbenchJob;
  run: WorkbenchRun;
  version: WorkbenchVersion;
  skillBundle: WorkbenchSkillBundleSnapshot;
  evalSnapshot: WorkbenchEvalSnapshot;
  agent: WorkbenchAgent;
  runtimeCase: WorkbenchEvalCaseRuntime;
  sample: number;
  artifactId?: string;
  traceId?: string;
  request?: Record<string, Json>;
  result?: Record<string, Json>;
}): { job: WorkbenchJob; artifact: WorkbenchArtifact; trace: WorkbenchTrace } {
  const finishedAt = args.remoteJob.finishedAt ?? now();
  const output = asRuntimeRecord(args.remoteJob.output);
  const score = args.runtimeCase.smoke === true ? undefined : readWorkbenchSkillRunOutputScore(output);
  const usage = readWorkbenchSkillRunOutputUsage(output);
  const outputResult = jsonRecord(output.result);
  if (args.runtimeCase.smoke === true) {
    stripSmokeResultScores(outputResult);
  }
  const resultPayload = {
    status: args.remoteJob.status === "succeeded" ? "succeeded" : "failed",
    ...(score !== undefined ? { score } : {}),
    ...(args.remoteJob.error ? { error: args.remoteJob.error } : {}),
    ...outputResult,
    ...(usage ? { usage: usage as unknown as Json } : {}),
    ...(args.result ?? {}),
  } satisfies Record<string, Json>;
  if (args.runtimeCase.smoke === true) {
    stripSmokeResultScores(resultPayload);
  }
  const files = Array.isArray(output.files)
    ? output.files.filter(isSurfaceSnapshotFile).map(copyFile)
    : [];
  const artifact: WorkbenchArtifact = {
    id: args.artifactId ?? nextArtifactIdForRun(args.run, args.remoteJob.id),
    runId: args.run.id,
    jobId: args.remoteJob.id,
    kind: "directory",
    path: `artifacts/${args.remoteJob.id}`,
    createdAt: finishedAt,
    files,
  };
  const request = {
    versionId: args.version.id,
    runId: args.run.id,
    jobId: args.remoteJob.id,
    caseId: args.runtimeCase.id,
    sample: args.sample,
    smoke: args.runtimeCase.smoke === true,
    skillName: args.skillBundle.skillName,
    skillBundleHash: args.skillBundle.hash,
    agent: toJson(args.agent),
    execution: jsonRecord(args.remoteJob.input).execution ?? null,
    ...(args.request ?? {}),
  } satisfies Record<string, Json>;
  const trace: WorkbenchTrace = {
    id: args.traceId ?? `trace_${args.remoteJob.id}`,
    runId: args.run.id,
    jobId: args.remoteJob.id,
    versionId: args.version.id,
    skillName: args.skillBundle.skillName,
    skillBundleHash: args.skillBundle.hash,
    evalHash: args.evalSnapshot.hash,
    agentName: args.agent.name,
    agentHash: args.run.agentHash,
    createdAt: finishedAt,
    request,
    result: resultPayload,
    files: [
      textFile("request.json", JSON.stringify(request, null, 2) + "\n"),
      textFile("result.json", JSON.stringify(resultPayload, null, 2) + "\n"),
      ...files.map(copyFile),
    ],
  };
  const status: WorkbenchJob["status"] =
    args.remoteJob.status === "succeeded" ? "succeeded" :
      args.remoteJob.status === "cancelled" ? "canceled" : "failed";
  const job: WorkbenchJob = {
    id: args.remoteJob.id,
    runId: args.run.id,
    kind: args.run.kind,
    versionId: args.version.id,
    skillName: args.skillBundle.skillName,
    skillBundleHash: args.skillBundle.hash,
    evalHash: args.evalSnapshot.hash,
    agentName: args.agent.name,
    agentHash: args.run.agentHash,
    caseId: args.runtimeCase.id,
    sample: args.sample,
    status,
    ...(score !== undefined ? { score } : {}),
    command: configString(asRuntimeRecord(asRuntimeRecord(jsonRecord(args.remoteJob.input).execution).adapter).with as Record<string, Json>, "command"),
    artifactIds: [artifact.id],
    traceIds: [trace.id],
    createdAt: args.remoteJob.createdAt,
    startedAt: args.remoteJob.startedAt,
    finishedAt,
    durationMs: durationMsBetween(args.remoteJob.startedAt, finishedAt),
    ...(args.remoteJob.error ? { error: args.remoteJob.error } : {}),
  };
  return { job, artifact, trace };
}

export function readWorkbenchSkillRunOutputScore(output: unknown): number {
  const record = asRuntimeRecord(output);
  const result = asRuntimeRecord(record.result);
  const metrics = asRuntimeRecord(result.metrics);
  const score = typeof result.score === "number"
    ? result.score
    : typeof metrics.score === "number"
      ? metrics.score
      : undefined;
  return typeof score === "number" && Number.isFinite(score) ? score : 0;
}

export function readWorkbenchSkillRunOutputUsage(output: unknown): UsageSummary | undefined {
  const record = asRuntimeRecord(output);
  const result = asRuntimeRecord(record.result);
  return mergeUsageSummaries([
    normalizeUsageSummary(record.usage),
    normalizeUsageSummary(result.usage),
  ]);
}

export function readWorkbenchSkillTraceResultsCostUsd(results: readonly unknown[]): number | undefined {
  const usage = mergeUsageSummaries(results.map((result) =>
    normalizeUsageSummary(asRuntimeRecord(result).usage)
  ));
  return readWorkbenchSkillUsageCostUsd(usage);
}

export function readWorkbenchSkillUsageCostUsd(usage: UsageSummary | undefined): number | undefined {
  const cost = mergeUsageSummaries([usage])?.total?.costUsd;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? Number(cost.toFixed(6))
    : undefined;
}

function durationMsBetween(startedAt: string | undefined, finishedAt: string): number {
  const started = Date.parse(startedAt ?? "");
  const finished = Date.parse(finishedAt);
  return Number.isFinite(started) && Number.isFinite(finished)
    ? Math.max(0, finished - started)
    : 0;
}

function nextArtifactIdForRun(run: WorkbenchRun, jobId: string): string {
  return `artifact_${run.id}_${jobId}`.replace(/[^a-z0-9_]+/giu, "_");
}

async function readSkillEvalEnvironmentDockerfile(root: string): Promise<string | undefined> {
  const dockerfile = path.join(workbenchDir(root), ENVIRONMENT_DIR, "Dockerfile");
  const source = await fs.readFile(dockerfile, "utf8").catch(() => "");
  return source.trim() ? source : undefined;
}

async function localWorkbenchSkillEvalCapacity(root: string): Promise<WorkbenchExecutionDagCapacity> {
  const filesystem = await fs.statfs(root).catch(() => null);
  const availableDiskGb = filesystem
    ? (filesystem.bavail * filesystem.bsize) / (1024 ** 3)
    : 10;
  return {
    cpu: Math.max(1, typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length),
    memoryGb: Math.max(1, os.totalmem() / (1024 ** 3)),
    diskGb: Math.max(1, availableDiskGb),
  };
}

function skillEvalRuntimeSpec(agent: WorkbenchAgent, environmentDockerfile: string | undefined): {
  dockerfile: string;
  resources?: GenericRunSpec["environment"]["resources"];
  network?: GenericRunSpec["environment"]["network"];
} {
  const image = skillEvalRuntimeImage(agent);
  const customEnvironmentDockerfile = environmentDockerfile && !isDefaultWorkbenchSkillEvalEnvironmentDockerfile(environmentDockerfile)
    ? environmentDockerfile
    : undefined;
  return {
    dockerfile: customEnvironmentDockerfile
      ? `dockerfile://skill-eval-${hashJson(customEnvironmentDockerfile).slice(0, 16)}`
      : dockerRuntimeImageRef(image),
    resources: runtimeResourcesForSkillEval(agent),
    network: runtimeNetworkForSkillEval(agent),
  };
}

function skillEvalRuntimeImage(agent: WorkbenchAgent): string {
  return configString(agent.config, "image") ?? configString(agent.config, "dockerImage") ?? DEFAULT_SKILL_RUNTIME_IMAGE;
}

function dockerRuntimeImageRef(image: string): string {
  return image.startsWith("docker://") ? image : `docker://${image}`;
}

export function isDefaultWorkbenchSkillEvalEnvironmentDockerfile(source: string): boolean {
  return normalizeDockerfileForComparison(source) === normalizeDockerfileForComparison(DEFAULT_SKILL_ENVIRONMENT_DOCKERFILE);
}

function normalizeDockerfileForComparison(source: string): string {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function genericSpecForSkillEval(
  agent: WorkbenchAgent,
  environment: GenericRunSpec["environment"],
  command: string,
  score: WorkbenchAdapterInvocation,
): GenericRunSpec {
  if (isProviderBackedSkillEvalAgent(agent)) {
    return providerBackedGenericSpecForSkillEval(agent, environment, score);
  }
  return commandGenericSpecForSkillEval(environment, command);
}

function skillEvalScoreInvocation(args: {
  evalSnapshot: WorkbenchEvalSnapshot;
  agent: WorkbenchAgent;
  runtimeCase: WorkbenchEvalCaseRuntime;
}): WorkbenchAdapterInvocation {
  const declared = skillEvalScoreDeclaration(args.evalSnapshot);
  if (!declared || declared.adapter === "tests") {
    return {
      use: "tests",
      with: declared?.config ?? {},
    };
  }
  if (declared.adapter === "rubric") {
    const rubricConfig: Record<string, Json> = {
      ...declared.config,
      judge: declared.config.judge ?? toJson(agentAdapterInvocation(args.agent)),
      criteria: declared.config.criteria ?? skillEvalRubricCriteria(args.runtimeCase),
    };
    return {
      use: "rubric",
      with: rubricConfig,
    };
  }
  throw new WorkbenchUserError(
    `Unsupported skill eval score adapter ${declared.adapter}. Use score.adapter: rubric or score.adapter: tests.`,
  );
}

function skillEvalScoreDeclaration(
  evalSnapshot: WorkbenchEvalSnapshot,
): { adapter: string; config: Record<string, Json> } | null {
  return skillEvalScoreDeclarationFromFiles(evalSnapshot.files);
}

function skillEvalScoreDeclarationFromFiles(
  files: readonly SurfaceSnapshotFile[],
): { adapter: string; config: Record<string, Json> } | null {
  const evalFile = files.find((file) => file.path === EVAL_FILE);
  if (!evalFile) {
    return null;
  }
  const record = parseYamlRecord(evalFile.content);
  const score = asRecord(record.score);
  if (!score) {
    return null;
  }
  const adapter = typeof score.adapter === "string"
    ? score.adapter.trim().toLowerCase()
    : typeof score.use === "string"
      ? score.use.trim().toLowerCase()
      : "";
  if (!adapter) {
    return null;
  }
  const config: Record<string, Json> = {};
  const withConfig = asRecord(score.with);
  if (withConfig) {
    Object.assign(config, jsonRecord(withConfig));
  }
  for (const key of ["instructions", "parallelism", "judge", "criteria"]) {
    if (score[key] !== undefined && config[key] === undefined) {
      config[key] = toJson(score[key]);
    }
  }
  return { adapter, config };
}

function skillEvalRubricCriteria(runtimeCase: WorkbenchEvalCaseRuntime): Json[] {
  const record = parseYamlRecord(runtimeCase.content);
  const rubric = record.rubric;
  if (!Array.isArray(rubric) || rubric.length === 0) {
    throw new WorkbenchUserError(
      `Rubric scoring requires case ${runtimeCase.id} to declare a non-empty rubric array.`,
    );
  }
  return rubric.map((entry, index) => {
    const fallbackId = `criterion-${String(index + 1).padStart(3, "0")}`;
    if (typeof entry === "string") {
      return {
        id: fallbackId,
        description: entry,
      };
    }
    const criterion = asRecord(entry);
    if (!criterion) {
      throw new WorkbenchUserError(
        `Rubric scoring requires case ${runtimeCase.id} rubric[${index}] to be a string or object.`,
      );
    }
    const description = typeof criterion.description === "string" && criterion.description.trim()
      ? criterion.description.trim()
      : typeof criterion.prompt === "string" && criterion.prompt.trim()
        ? criterion.prompt.trim()
        : typeof criterion.text === "string" && criterion.text.trim()
          ? criterion.text.trim()
          : "";
    if (!description) {
      throw new WorkbenchUserError(
        `Rubric scoring requires case ${runtimeCase.id} rubric[${index}] to include a description.`,
      );
    }
    const id = typeof criterion.id === "string" && criterion.id.trim()
      ? criterion.id.trim()
      : fallbackId;
    return {
      id,
      description,
      ...(typeof criterion.weight === "number" ? { weight: criterion.weight } : {}),
    };
  });
}

function commandGenericSpecForSkillEval(
  environment: GenericRunSpec["environment"],
  command: string,
): GenericRunSpec {
  const run = { use: "command", with: { command } };
  return {
    version: 4,
    name: "Skill eval",
    description: "Workbench skill evaluation.",
    eval: {
      name: "Skill eval",
      description: "Workbench skill evaluation.",
      engine: run,
    },
    skill: {
      name: "skill",
      files: { path: "." },
      agents: {
        default: {
          name: "default",
          use: "command",
          with: { command: "true" },
        },
      },
    },
    environment,
    adapters: ["command"],
    engine: run,
    engineResolve: run,
    run,
    engineRun: run,
  };
}

function providerBackedGenericSpecForSkillEval(
  agent: WorkbenchAgent,
  environment: GenericRunSpec["environment"],
  score: WorkbenchAdapterInvocation,
): GenericRunSpec {
  const run = agentAdapterInvocation(agent);
  return {
    version: 4,
    name: "Skill eval",
    description: "Workbench skill evaluation.",
    eval: {
      name: "Skill eval",
      description: "Workbench skill evaluation.",
      engine: score,
    },
    skill: {
      name: "skill",
      files: { path: "." },
      agents: {
        [agent.name]: {
          name: agent.name,
          ...run,
        },
      },
    },
    environment,
    adapters: [...new Set([agent.adapter.trim().toLowerCase(), ...skillEvalScoreAdapterIds(score)])],
    engine: score,
    engineResolve: score,
    run,
    engineRun: score,
  };
}

function skillEvalScoreAdapterIds(score: WorkbenchAdapterInvocation): string[] {
  return collectWorkbenchAdapterInvocations([score], builtinWorkbenchAdapterManifests())
    .map((invocation) => invocation.use.trim().toLowerCase());
}

function genericSpecForSkillImprove(
  agent: WorkbenchAgent,
  environment: GenericRunSpec["environment"],
  improve: WorkbenchAdapterInvocation,
): GenericRunSpec {
  return {
    version: 4,
    name: "Skill improve",
    description: "Workbench skill improvement.",
    eval: {
      name: "Skill improve",
      description: "Workbench skill improvement.",
      engine: improve,
    },
    skill: {
      name: "skill",
      files: { path: "." },
      agents: {
        [agent.name]: {
          name: agent.name,
          ...improve,
        },
      },
      improve: {
        edits: skillImproveEditPaths(agent),
      },
    },
    environment,
    adapters: [improve.use],
    engine: improve,
    engineResolve: improve,
    run: improve,
    engineRun: improve,
    improve,
  };
}

function agentAdapterInvocation(agent: WorkbenchAgent): WorkbenchAdapterInvocation {
  const auth = agent.config.auth;
  const config: Record<string, Json> = {};
  for (const [key, value] of Object.entries(agent.config)) {
    if (SKILL_EVAL_AGENT_RUNTIME_CONFIG_KEYS.has(key)) {
      continue;
    }
    config[key] = value;
  }
  if (agent.model && typeof config.model !== "string") {
    config.model = agent.model;
  }
  return {
    use: agent.adapter.trim().toLowerCase(),
    with: config,
    ...(typeof auth === "string" || (auth && typeof auth === "object" && !Array.isArray(auth))
      ? { auth: auth as Json }
      : {}),
  };
}

function agentImproveAdapterInvocation(agent: WorkbenchAgent): WorkbenchAdapterInvocation | null {
  const adapter = agent.adapter.trim().toLowerCase();
  if (SKILL_EVAL_COMMAND_AGENT_ADAPTERS.has(adapter)) {
    const command = configString(agent.config, "improveCommand");
    return command
      ? {
          use: "command",
          with: { command },
        }
      : null;
  }
  if (SKILL_EVAL_PROVIDER_AGENT_ADAPTERS.has(adapter)) {
    return agentAdapterInvocation(agent);
  }
  return null;
}

const SKILL_EVAL_AGENT_RUNTIME_CONFIG_KEYS = new Set([
  "auth",
  "command",
  "cpu",
  "diskGb",
  "dockerImage",
  "image",
  "improveCommand",
  "improveEdits",
  "improveTimeoutMs",
  "memoryGb",
  "network",
  "timeoutMinutes",
  "timeoutMs",
]);

function isProviderBackedSkillEvalAgent(agent: WorkbenchAgent): boolean {
  return SKILL_EVAL_PROVIDER_AGENT_ADAPTERS.has(agent.adapter.trim().toLowerCase());
}

function isProviderBackedSkillEvalInvocation(invocation: WorkbenchAdapterInvocation): boolean {
  return SKILL_EVAL_PROVIDER_AGENT_ADAPTERS.has(invocation.use.trim().toLowerCase());
}

function providerSkillEvalEngineCaseFiles(
  runtimeCase: WorkbenchEvalCaseRuntime,
): WorkbenchEngineCase["files"] {
  const publicFiles: SurfaceSnapshotFile[] = [];
  const privateFiles: SurfaceSnapshotFile[] = [];
  for (const file of runtimeCase.files) {
    const normalized = normalizeRelativePath(file.path);
    if (normalized === "case.yaml" || isCaseDescriptorPath(normalized)) {
      continue;
    }
    if (normalized.startsWith("tests/")) {
      privateFiles.push({
        ...copyFile(file),
        path: normalized.slice("tests/".length),
      });
      continue;
    }
    if (normalized.startsWith("solution/")) {
      privateFiles.push(copyFile(file));
      continue;
    }
    publicFiles.push(copyFile(file));
  }
  return {
    public: publicFiles.sort((left, right) => left.path.localeCompare(right.path)),
    private: privateFiles.sort((left, right) => left.path.localeCompare(right.path)),
    source: runtimeCase.files.map(copyFile),
  };
}

function skillEvalAdapterManifestsForAgent(agent: WorkbenchAgent, score: WorkbenchAdapterInvocation): WorkbenchAdapterManifest[] {
  if (!isProviderBackedSkillEvalAgent(agent)) {
    return [];
  }
  const manifests = builtinWorkbenchAdapterManifests();
  const needed = new Set([
    agent.adapter.trim().toLowerCase(),
    ...skillEvalScoreAdapterIds(score),
  ]);
  return manifests.filter((manifest) => needed.has(manifest.id));
}

function skillImproveAdapterManifestsForAgent(
  agent: WorkbenchAgent,
  improveAdapterId: string,
): WorkbenchAdapterManifest[] {
  const needed = new Set([improveAdapterId.trim().toLowerCase(), "command"]);
  if (isProviderBackedSkillEvalAgent(agent)) {
    needed.add(agent.adapter.trim().toLowerCase());
  }
  return builtinWorkbenchAdapterManifests().filter((manifest) => needed.has(manifest.id));
}

function composeSkillRuntimeDockerfileWithAdapterManifests(args: {
  dockerfile: string | undefined;
  manifests: readonly WorkbenchAdapterManifest[];
  baseImage: string;
}): string | undefined {
  const installers = runtimeAdapterInstallersFromManifests(args.manifests);
  const hasInstallers = installers.some((installer) =>
    installer.install.length > 0 || (installer.files?.length ?? 0) > 0
  );
  if (!args.dockerfile && !hasInstallers) {
    return undefined;
  }
  return composeRuntimeDockerfileWithAdapterInstallers(
    args.dockerfile ?? adapterRuntimeBaseDockerfile(args.baseImage),
    installers,
  );
}

function dockerfileBaseImage(image: string): string {
  return image.startsWith("docker://") ? image.slice("docker://".length) : image;
}

function adapterRuntimeBaseDockerfile(image: string): string {
  return [
    `FROM ${dockerfileBaseImage(image)}`,
    "USER root",
    "RUN if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*; fi",
    "",
  ].join("\n");
}

function runtimeAdapterInstallersFromManifests(
  manifests: readonly WorkbenchAdapterManifest[],
): WorkbenchRuntimeAdapterInstaller[] {
  return manifests.map((manifest) => ({
    id: manifest.id,
    source: "built-in",
    install: manifest.install,
  }));
}

function assertSkillEvalAgentSupported(agent: WorkbenchAgent): void {
  const adapter = agent.adapter.trim().toLowerCase();
  if (SKILL_EVAL_COMMAND_AGENT_ADAPTERS.has(adapter)) {
    return;
  }
  if (SKILL_EVAL_PROVIDER_AGENT_ADAPTERS.has(adapter)) {
    assertProviderBackedAgentNetwork(agent);
    return;
  }
  throw new WorkbenchUserError(
    `Agent ${agent.name} uses unsupported skill eval adapter ${agent.adapter}. Skill eval jobs support --adapter local, --adapter command, --adapter codex, or --adapter claude.`,
  );
}

function assertProviderBackedAgentNetwork(agent: WorkbenchAgent): void {
  if (!providerAgentHasExplicitIsolatedNetwork(agent)) {
    return;
  }
  throw new WorkbenchUserError(
    `Agent ${agent.name} uses provider-backed adapter ${agent.adapter} and requires network egress. Remove network=off or set network=on before running eval or improve.`,
  );
}

function runtimeResourcesForSkillEval(agent: WorkbenchAgent): WorkbenchExecutionSpec["policy"]["resources"] {
  const timeoutMs = configNumber(agent.config, "timeoutMs");
  return {
    cpu: configNumber(agent.config, "cpu") ?? 1,
    memoryGb: configNumber(agent.config, "memoryGb") ?? 2,
    diskGb: configNumber(agent.config, "diskGb") ?? 10,
    timeoutMinutes: configNumber(agent.config, "timeoutMinutes") ?? (timeoutMs ? Math.max(1, Math.ceil(timeoutMs / 60_000)) : 10),
  };
}

function runtimeNetworkForSkillEval(agent: WorkbenchAgent): WorkbenchExecutionSpec["policy"]["network"] {
  return { egress: agentNetworkEgress(agent) };
}

function improvementEvidenceFromTraces(traces: readonly WorkbenchTrace[]): string[] {
  const evidence: string[] = [];
  for (const trace of improvementEvidenceTraces(traces).slice().reverse()) {
    const result = asRuntimeRecord(trace.result);
    const request = asRuntimeRecord(trace.request);
    const score = typeof result.score === "number" && Number.isFinite(result.score) ? result.score : undefined;
    const error = textFromJson(result.error);
    const feedback = asRuntimeRecord(result.feedback);
    const review = textFromJson(result.review) ??
      textFromJson(result.reviewComment) ??
      textFromJson(feedback.review) ??
      textFromJson(feedback.comment);
    const caseId = typeof request.caseId === "string" ? request.caseId : undefined;
    const detail = error ??
      review ??
      traceFileSnippet(trace, "stderr.log") ??
      traceFileSnippet(trace, "stdout.log") ??
      textFromJson(result.summary) ??
      "score below passing threshold";
    evidence.push([
      trace.id,
      caseId ? `case=${caseId}` : undefined,
      score !== undefined ? `score=${score.toFixed(3)}` : undefined,
      truncateText(singleLine(detail), 240),
    ].filter(Boolean).join(" "));
    if (evidence.length >= 5) {
      break;
    }
  }
  return evidence;
}

interface SkillImprovementResult {
  mode: "command" | "provider";
  patch: WorkbenchSkillPatch;
  command?: string;
}

async function createSkillImprovementPatch(args: {
  root: string;
  state: WorkbenchProjectState;
  agent: WorkbenchAgent;
  base: WorkbenchVersion;
  evalHash: string;
  environmentDockerfile?: string;
  historicalTraces: readonly WorkbenchTrace[];
  improvementEvidence: readonly string[];
}): Promise<SkillImprovementResult> {
  if (!workbenchSkillImproveCanUseQueuedAdapter(args.agent)) {
    throw new WorkbenchUserError(workbenchSkillImproveAdapterRequirementMessage(args.agent));
  }
  return executeAdapterBackedSkillImprovementPatch({
    root: args.root,
    state: args.state,
    agent: args.agent,
    base: args.base,
    evalHash: args.evalHash,
    environmentDockerfile: args.environmentDockerfile,
    historicalTraces: args.historicalTraces,
  });
}

async function executeAdapterBackedSkillImprovementPatch(args: {
  root: string;
  state: WorkbenchProjectState;
  agent: WorkbenchAgent;
  base: WorkbenchVersion;
  evalHash: string;
  environmentDockerfile?: string;
  historicalTraces: readonly WorkbenchTrace[];
}): Promise<SkillImprovementResult> {
  const command = configString(args.agent.config, "improveCommand");
  const runtimeInput = createWorkbenchSkillImproveRuntimeInput({
    ownerUserId: "local",
    projectId: "local",
    runId: nextRunId(),
    jobId: `${nextJobId()}_improve`,
    baseVersionId: args.base.id,
    evalHash: args.evalHash,
    agent: args.agent,
    baseFiles: args.base.files,
    traces: args.historicalTraces,
    createdAt: now(),
    environmentDockerfile: args.environmentDockerfile ?? await readSkillEvalEnvironmentDockerfile(args.root),
  });
  const completed = await executeWorkbenchExecutionJob(runtimeInput, {
    sandboxBackend: DOCKER_SANDBOX_BACKEND,
    loadLocalAdapterAuthProfiles: isProviderBackedSkillEvalAgent(args.agent),
  });
  if (completed.status !== "succeeded") {
    throw new WorkbenchUserError(`Improve adapter failed: ${completed.error ?? "no patch produced"}`);
  }
  const patch = readWorkbenchSkillImprovementPatchFromRemoteJob(completed);
  if (!patch || patch.fileChanges.length === 0) {
    throw new WorkbenchUserError("Improve adapter completed without producing an editable skill patch.");
  }
  return {
    mode: isProviderBackedSkillEvalAgent(args.agent) ? "provider" : "command",
    patch: {
      ...patch,
      summary: patch.summary ?? `Improved ${patch.fileChanges.length} skill file${patch.fileChanges.length === 1 ? "" : "s"} with agent ${args.agent.name}.`,
    },
    ...(command ? { command } : {}),
  };
}

function skillImproveEditPaths(agent: WorkbenchAgent): string[] {
  return configStringList(agent.config, "improveEdits") ?? [SKILL_FILE];
}

const MAX_SKILL_IMPROVE_TRACE_TEXT_CHARS = 32_000;
const SKILL_IMPROVE_TRACE_TEXT_BASENAMES = new Set([
  "stderr.log",
  "stdout.log",
  "summary.md",
  "skill-summary.md",
]);

function skillImproveTraceInputFiles(traces: readonly WorkbenchTrace[]): SurfaceSnapshotFile[] {
  const files: SurfaceSnapshotFile[] = [
    textFile("index.json", `${JSON.stringify({
      traces: traces.map((trace) => ({
        id: trace.id,
        runId: trace.runId,
        jobId: trace.jobId ?? null,
        versionId: trace.versionId,
        agentName: trace.agentName,
        createdAt: trace.createdAt,
      })),
    }, null, 2)}\n`),
  ];
  for (const trace of traces) {
    const root = safeTraceEvidencePath(trace.id);
    files.push(
      textFile(`${root}/request.json`, `${JSON.stringify(trace.request, null, 2)}\n`),
      textFile(`${root}/result.json`, `${JSON.stringify(trace.result, null, 2)}\n`),
      ...trace.files.flatMap((file) => skillImproveTraceTextFile(root, file)),
    );
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function skillImproveTraceTextFile(root: string, file: SurfaceSnapshotFile): SurfaceSnapshotFile[] {
  if (file.kind !== "text") {
    return [];
  }
  const relativePath = normalizeRelativePath(file.path);
  const basename = path.posix.basename(relativePath).toLowerCase();
  if (!SKILL_IMPROVE_TRACE_TEXT_BASENAMES.has(basename)) {
    return [];
  }
  const content = file.content.length > MAX_SKILL_IMPROVE_TRACE_TEXT_CHARS
    ? `${file.content.slice(0, MAX_SKILL_IMPROVE_TRACE_TEXT_CHARS)}\n[truncated]\n`
    : file.content;
  return [textFile(`${root}/files/${relativePath}`, content)];
}

function safeTraceEvidencePath(traceId: string): string {
  return traceId.replace(/[^a-z0-9_.-]+/giu, "_") || "trace";
}

function resolveDockerEvalCommand(agent: WorkbenchAgent, runtimeCase: WorkbenchEvalCaseRuntime): string {
  return configString(agent.config, "command") ??
    runtimeCase.command ??
    [
      "if [ -x \"$CASE_DIR/tests/test.sh\" ]; then \"$CASE_DIR/tests/test.sh\";",
      "elif [ -f \"$CASE_DIR/tests/test.sh\" ]; then sh \"$CASE_DIR/tests/test.sh\";",
      "elif [ -x \"$CASE_DIR/test.sh\" ]; then \"$CASE_DIR/test.sh\";",
      "elif [ -f \"$CASE_DIR/test.sh\" ]; then sh \"$CASE_DIR/test.sh\";",
      "else echo \"Workbench case has no command or test.sh\" >&2; exit 2;",
      "fi",
    ].join(" ");
}

function agentNetworkEgress(agent: WorkbenchAgent): WorkbenchExecutionSpec["policy"]["network"]["egress"] {
  const configured = agent.config.network;
  if (configured === true) {
    return "open";
  }
  if (configured === undefined) {
    return isProviderBackedSkillEvalAgent(agent) ? "open" : "none";
  }
  if (configured === false || configured === null) {
    return "none";
  }
  if (typeof configured === "string") {
    const normalized = configured.trim().toLowerCase();
    if (!normalized || normalized === "off" || normalized === "none" || normalized === "false" || normalized === "0") {
      return "none";
    }
    return "open";
  }
  return "none";
}

function providerAgentHasExplicitIsolatedNetwork(agent: WorkbenchAgent): boolean {
  if (!isProviderBackedSkillEvalAgent(agent)) {
    return false;
  }
  return agent.config.network !== undefined && agentNetworkEgress(agent) === "none";
}

function configString(config: Record<string, Json>, name: string): string | undefined {
  const value = config[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function configStringList(config: Record<string, Json>, name: string): string[] | undefined {
  const value = config[name];
  const entries = Array.isArray(value)
    ? value.flatMap((entry) => typeof entry === "string" ? [entry] : [])
    : typeof value === "string"
      ? value.split(",")
      : [];
  const normalized = entries.map((entry) => entry.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function configNumber(config: Record<string, Json>, name: string): number | undefined {
  const value = config[name];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function textFromJson(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value && (typeof value === "number" || typeof value === "boolean")) {
    return String(value);
  }
  if (value && typeof value === "object") {
    const stringified = JSON.stringify(value);
    return stringified && stringified !== "{}" && stringified !== "[]" ? stringified : undefined;
  }
  return undefined;
}

function traceFileSnippet(trace: WorkbenchTrace, filePath: string): string | undefined {
  const file = trace.files.find((entry) => entry.path === filePath);
  return file?.content.trim() ? file.content.trim() : undefined;
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}

function quoteShellLiteral(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

async function resolveOrCreateRunVersion(root: string, state: WorkbenchProjectState, ref?: string): Promise<WorkbenchVersion> {
  await reconcileWorkbenchVersion(root, state, "current source");
  if (ref) {
    return resolveVersion(state, ref);
  }
  return resolveVersion(state, "current");
}

async function reconcileWorkbenchVersion(
  root: string,
  state: WorkbenchProjectState,
  message: string,
): Promise<WorkbenchVersion> {
  const files = await readSkillFiles(root);
  const hash = hashFiles(files);
  const existing = state.versions.find((version) => version.hash === hash);
  if (existing) {
    state.refs.current = existing.id;
    return existing;
  }
  const parent = state.refs.current;
  const version: WorkbenchVersion = {
    id: versionIdForHash(hash),
    hash,
    message,
    parentIds: parent ? [parent] : [],
    createdAt: now(),
    files,
  };
  state.versions.push(version);
  state.refs.current = version.id;
  if (parent && parent !== version.id) {
    state.lineage.push({
      parentId: parent,
      childId: version.id,
      reason: "version",
      createdAt: version.createdAt,
      message,
    });
  }
  return version;
}

function resolveVersionSelection(state: WorkbenchProjectState, selection: string): WorkbenchVersion[] {
  const trimmed = selection.trim();
  if (!trimmed || trimmed === "all") {
    return [...state.versions]
      .sort(compareVersionIds);
  }
  if (trimmed.includes("..")) {
    const [startRef, endRef] = trimmed.split("..", 2);
    const versions = [...state.versions].sort(compareVersionIds);
    const start = startRef ? versions.findIndex((version) => version.id === resolveVersion(state, startRef).id) : 0;
    const end = endRef ? versions.findIndex((version) => version.id === resolveVersion(state, endRef).id) : versions.length - 1;
    return versions.slice(Math.max(0, start), Math.max(start, end) + 1);
  }
  return trimmed.split(",").map((part) => resolveVersion(state, part.trim()));
}

async function resolveRequestedAgents(root: string, agentSelection?: string): Promise<WorkbenchAgent[]> {
  const agents = await readAgents(root);
  return resolveNamedSelection(agents, agentSelection, await readDefaultAgentSelection(root, agents), "agent");
}

async function readAgents(root: string): Promise<WorkbenchAgent[]> {
  const filePath = path.join(workbenchDir(root), AGENTS_FILE);
  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") {
      throw new WorkbenchUserError(`Missing ${path.join(".workbench", AGENTS_FILE)}. Run \`workbench init\` or restore the agent file before continuing.`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkbenchUserError(`Unable to read ${path.join(".workbench", AGENTS_FILE)}: ${message}`);
  }
  return parseAgentsYaml(source, path.join(".workbench", AGENTS_FILE));
}

function parseAgentsYaml(source: string, fileLabel: string): WorkbenchAgent[] {
  let record: Record<string, unknown>;
  try {
    record = parseYamlRecord(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkbenchUserError(`${fileLabel} is not valid YAML: ${message}`);
  }
  const agentsRecord = asRecord(record.agents);
  if (!agentsRecord || Object.keys(agentsRecord).length === 0) {
    throw new WorkbenchUserError(`No agents configured in ${fileLabel}. Run \`workbench agent add default --adapter local\`.`);
  }
  const agents = Object.entries(agentsRecord).map(([name, raw]) => {
    const value = asRecord(raw) ?? {};
    const config = asRecord(value.with) ?? asRecord(value.config) ?? {};
    const normalizedName = normalizeManifestEntryName(name, fileLabel, "agent");
    if (typeof value.adapter !== "string" || !value.adapter.trim()) {
      throw new WorkbenchUserError(`Agent ${name} in ${fileLabel} must define a non-empty adapter.`);
    }
    return {
      name: normalizedName,
      adapter: value.adapter.trim(),
      ...(typeof value.model === "string" && value.model.trim() ? { model: value.model.trim() } : {}),
      config: jsonRecord(config),
    } satisfies WorkbenchAgent;
  });
  const sortedAgents = agents.sort((left, right) => left.name.localeCompare(right.name));
  assertUniqueManifestEntryNames(sortedAgents, fileLabel, "agent");
  readManifestDefaultSelection(record, fileLabel, sortedAgents, "agent");
  return sortedAgents;
}

async function writeAgents(root: string, agents: readonly WorkbenchAgent[], defaultAgent: string): Promise<void> {
  if (agents.length === 0) {
    throw new WorkbenchUserError(`${path.join(".workbench", AGENTS_FILE)} must contain at least one agent.`);
  }
  const normalizedAgents = agents.map((agent) => ({
    ...agent,
    name: normalizeManifestEntryName(agent.name, path.join(".workbench", AGENTS_FILE), "agent"),
  }));
  assertUniqueManifestEntryNames(normalizedAgents, path.join(".workbench", AGENTS_FILE), "agent");
  const normalizedDefault = readManifestDefaultSelection(
    { default: defaultAgent },
    path.join(".workbench", AGENTS_FILE),
    normalizedAgents,
    "agent",
  );
  const record = {
    default: normalizedDefault,
    agents: Object.fromEntries(normalizedAgents.map((agent) => [
      agent.name,
      {
        adapter: agent.adapter,
        ...(agent.model ? { model: agent.model } : {}),
        with: agent.config,
      },
    ])),
  };
  await fs.writeFile(path.join(workbenchDir(root), AGENTS_FILE), YAML.stringify(record));
}

async function readDefaultAgentSelection(root: string, agents: readonly WorkbenchAgent[]): Promise<string> {
  const source = await fs.readFile(path.join(workbenchDir(root), AGENTS_FILE), "utf8");
  const record = parseYamlRecord(source);
  return readManifestDefaultSelection(record, path.join(".workbench", AGENTS_FILE), agents, "agent");
}

function resolveNamedSelection<T extends { name: string }>(
  entries: readonly T[],
  selection: string | undefined,
  defaultSelection: string,
  noun: "skill" | "agent",
): T[] {
  const selected = (selection ?? defaultSelection).trim();
  if (!selected) {
    throw new WorkbenchUserError(`No ${noun}s selected.`);
  }
  if (selected === ALL_SELECTOR) {
    return [...entries];
  }
  const names = selected.split(",").map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) {
    throw new WorkbenchUserError(`No ${noun}s selected.`);
  }
  if (names.includes(ALL_SELECTOR)) {
    throw new WorkbenchUserError(`${capitalize(noun)} selector "${ALL_SELECTOR}" cannot be combined with named selections.`);
  }
  return names.map((name) => {
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry) {
      throw new WorkbenchUserError(`${capitalize(noun)} not found: ${name}`);
    }
    return entry;
  });
}

function readManifestDefaultSelection<T extends { name: string }>(
  record: Record<string, unknown>,
  fileLabel: string,
  entries: readonly T[],
  noun: "skill" | "agent",
): string {
  const configured = typeof record.default === "string" ? record.default.trim() : "";
  if (!configured) {
    throw new WorkbenchUserError(`${fileLabel} must define top-level default set to "${ALL_SELECTOR}" or a configured ${noun} name.`);
  }
  if (configured === ALL_SELECTOR) {
    return configured;
  }
  if (configured.includes(",")) {
    throw new WorkbenchUserError(`${fileLabel} default must be "${ALL_SELECTOR}" or one configured ${noun} name. Use command flags for comma-separated selections.`);
  }
  if (!entries.some((entry) => entry.name === configured)) {
    throw new WorkbenchUserError(`${fileLabel} default ${configured} does not match a configured ${noun}.`);
  }
  return configured;
}

function normalizeManifestEntryName(name: string, fileLabel: string, noun: "skill" | "agent"): string {
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new WorkbenchUserError(`${fileLabel} contains an empty ${noun} name.`);
  }
  if (normalizedName === ALL_SELECTOR) {
    throw new WorkbenchUserError(`${fileLabel} cannot use reserved ${noun} name "${ALL_SELECTOR}".`);
  }
  return normalizedName;
}

function assertUniqueManifestEntryNames<T extends { name: string }>(
  entries: readonly T[],
  fileLabel: string,
  noun: "skill" | "agent",
): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      throw new WorkbenchUserError(`${fileLabel} contains duplicate ${noun} name: ${entry.name}`);
    }
    seen.add(entry.name);
  }
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

async function readEvalCases(root: string): Promise<WorkbenchEvalCaseRuntime[]> {
  const casesRoot = path.join(workbenchDir(root), CASES_DIR);
  if (!await exists(casesRoot)) {
    return [];
  }
  const entries = (await fs.readdir(casesRoot, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const cases: WorkbenchEvalCaseRuntime[] = [];
  for (const entry of entries) {
    const absolute = path.join(casesRoot, entry.name);
    if (entry.isDirectory()) {
      const files = await readFilesUnder(absolute);
      const descriptor = files.find((file) => isCaseDescriptorPath(file.path));
      const content = descriptor?.content ?? `id: ${entry.name}\n`;
      const caseRecord = parseCaseRecord(
        content,
        descriptor ? path.join(entry.name, descriptor.path) : entry.name,
      );
      const command = caseCommandFromRecord(caseRecord);
      cases.push({
        id: caseIdFromRecord(caseRecord, entry.name),
        path: entry.name,
        content,
        files,
        ...(command ? { command } : {}),
        ...(caseSmokeFromRecord(caseRecord) ? { smoke: true } : {}),
      });
      continue;
    }
    if (!entry.isFile() || !isCaseDescriptorPath(entry.name)) {
      continue;
    }
    const content = await fs.readFile(absolute);
    const file = surfaceFileFromBuffer(entry.name, content, false);
    const caseRecord = parseCaseRecord(file.content, entry.name);
    const command = caseCommandFromRecord(caseRecord);
    cases.push({
      id: caseIdFromRecord(caseRecord, path.basename(entry.name, path.extname(entry.name))),
      path: entry.name,
      content: file.content,
      files: [file],
      ...(command ? { command } : {}),
      ...(caseSmokeFromRecord(caseRecord) ? { smoke: true } : {}),
    });
  }
  return cases.sort((left, right) => left.id.localeCompare(right.id));
}

async function readEvalSnapshot(
  root: string,
  timestamps: { createdAt?: string; updatedAt?: string } = {},
): Promise<WorkbenchEvalSnapshot> {
  const cases = await readEvalCases(root);
  const files = [
    ...await readOptionalFile(path.join(workbenchDir(root), EVAL_FILE), EVAL_FILE),
    ...await readFilesUnder(path.join(workbenchDir(root), CASES_DIR), CASES_DIR),
    ...await readFilesUnder(path.join(workbenchDir(root), ENVIRONMENT_DIR), ENVIRONMENT_DIR),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const sourceUpdatedAt = timestamps.updatedAt ?? await latestEvalSnapshotUpdatedAt(root);
  const createdAt = timestamps.createdAt ?? sourceUpdatedAt;
  const scoreAdapter = skillEvalScoreDeclarationFromFiles(files)?.adapter ?? "tests";
  return {
    hash: hashFiles(files),
    files,
    caseCount: cases.length,
    createdAt,
    updatedAt: sourceUpdatedAt,
    scoreAdapter,
  };
}

async function latestEvalSnapshotUpdatedAt(root: string): Promise<string> {
  const latest = Math.max(
    await latestFileModifiedTime(path.join(workbenchDir(root), EVAL_FILE)),
    await latestFileModifiedTime(path.join(workbenchDir(root), CASES_DIR)),
    await latestFileModifiedTime(path.join(workbenchDir(root), ENVIRONMENT_DIR)),
  );
  return latest > 0 ? new Date(latest).toISOString() : now();
}

async function latestFileModifiedTime(filePath: string): Promise<number> {
  if (!await exists(filePath)) {
    return 0;
  }
  const stat = await fs.stat(filePath);
  if (stat.isFile()) {
    return stat.mtimeMs;
  }
  if (!stat.isDirectory()) {
    return 0;
  }
  const entries = await fs.readdir(filePath, { withFileTypes: true });
  let latest = stat.mtimeMs;
  for (const entry of entries) {
    const absolute = path.join(filePath, entry.name);
    latest = Math.max(latest, await latestFileModifiedTime(absolute));
  }
  return latest;
}

async function refreshLocalWorkbenchFiles(root: string, state: WorkbenchProjectState): Promise<void> {
  const currentAgents = await readAgents(root);
  upsertAgentSnapshots(state.agents, currentAgents);
  state.skillSources = await readSkillSources(root);
  upsertEvalSnapshotObject(state.evals, await readEvalSnapshot(root));
}

async function readSkillFiles(root: string): Promise<SurfaceSnapshotFile[]> {
  const installableFiles = (await readFilesUnder(root))
    .filter((file) => !file.path.split("/").some((part) => IGNORED_SKILL_DIRS.has(part)))
    .filter((file) => !IGNORED_SKILL_FILES.has(path.basename(file.path)));
  const authoredWorkbenchFiles = [
    ...await readOptionalFile(path.join(workbenchDir(root), EVAL_FILE), `${WORKBENCH_DIR}/${EVAL_FILE}`),
    ...await readFilesUnder(path.join(workbenchDir(root), CASES_DIR), `${WORKBENCH_DIR}/${CASES_DIR}`),
    ...await readOptionalFile(path.join(workbenchDir(root), AGENTS_FILE), `${WORKBENCH_DIR}/${AGENTS_FILE}`),
    ...await readOptionalFile(path.join(workbenchDir(root), SKILLS_FILE), `${WORKBENCH_DIR}/${SKILLS_FILE}`),
    ...await readFilesUnder(path.join(workbenchDir(root), ENVIRONMENT_DIR), `${WORKBENCH_DIR}/${ENVIRONMENT_DIR}`),
  ];
  return [...installableFiles, ...authoredWorkbenchFiles]
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function readSkillSources(root: string): Promise<WorkbenchSkillSource[]> {
  const filePath = path.join(workbenchDir(root), SKILLS_FILE);
  if (!await exists(filePath)) {
    if (await exists(path.join(root, SKILL_FILE))) {
      return [{ name: PRIMARY_SKILL_NAME, kind: "local", path: "." }];
    }
    throw new WorkbenchUserError(`Missing ${path.join(".workbench", SKILLS_FILE)}. Projects without a root ${SKILL_FILE} must declare measured skills.`);
  }
  const source = await fs.readFile(filePath, "utf8");
  let record: Record<string, unknown>;
  try {
    record = parseYamlRecord(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkbenchUserError(`${path.join(".workbench", SKILLS_FILE)} is not valid YAML: ${message}`);
  }
  const skillsRecord = asRecord(record.skills);
  if (!skillsRecord || Object.keys(skillsRecord).length === 0) {
    throw new WorkbenchUserError(`No skills configured in ${path.join(".workbench", SKILLS_FILE)}.`);
  }
  const sources = Object.entries(skillsRecord)
    .map(([name, raw]) => parseSkillSource(name, raw, `skills.${name}`))
    .sort((left, right) => left.name.localeCompare(right.name));
  assertUniqueManifestEntryNames(sources, path.join(".workbench", SKILLS_FILE), "skill");
  readManifestDefaultSelection(record, path.join(".workbench", SKILLS_FILE), sources, "skill");
  return sources;
}

async function readDefaultSkillSelection(root: string, sources: readonly WorkbenchSkillSource[]): Promise<string> {
  const filePath = path.join(workbenchDir(root), SKILLS_FILE);
  if (!await exists(filePath)) {
    if (sources.some((source) => source.name === PRIMARY_SKILL_NAME)) {
      return PRIMARY_SKILL_NAME;
    }
    throw new WorkbenchUserError(`Missing ${path.join(".workbench", SKILLS_FILE)}. Projects without a root ${SKILL_FILE} must declare measured skills.`);
  }
  const record = parseYamlRecord(await fs.readFile(filePath, "utf8"));
  return readManifestDefaultSelection(record, path.join(".workbench", SKILLS_FILE), sources, "skill");
}

function parseSkillSource(name: string, raw: unknown, label: string): WorkbenchSkillSource {
  const value = typeof raw === "string" ? { path: raw } : asRecord(raw) ?? {};
  const normalizedName = normalizeManifestEntryName(name, path.join(".workbench", SKILLS_FILE), "skill");
  const pathRef = typeof value.path === "string" && value.path.trim() ? value.path.trim() : undefined;
  const fromRef = typeof value.from === "string" && value.from.trim() ? value.from.trim() : undefined;
  const baselineRef = typeof value.baseline === "string" && value.baseline.trim() ? value.baseline.trim() : undefined;
  if ((pathRef ? 1 : 0) + (fromRef ? 1 : 0) + (baselineRef ? 1 : 0) !== 1) {
    throw new WorkbenchUserError(`${path.join(".workbench", SKILLS_FILE)} ${label} must define exactly one of path, from, or baseline.`);
  }
  if (baselineRef && baselineRef !== "none") {
    throw new WorkbenchUserError(`${path.join(".workbench", SKILLS_FILE)} ${label} baseline must be none.`);
  }
  const explicitRef = typeof value.ref === "string" && value.ref.trim() ? value.ref.trim() : undefined;
  if (fromRef && !explicitRef) {
    throw new WorkbenchUserError(`${path.join(".workbench", SKILLS_FILE)} ${label} remote skills must define an explicit ref.`);
  }
  if (baselineRef && explicitRef) {
    throw new WorkbenchUserError(`${path.join(".workbench", SKILLS_FILE)} ${label} baseline skills cannot define ref.`);
  }
  const includes = Array.isArray(value.includes)
    ? value.includes.map((entry, index) => parseSkillInclude(entry, `${label}.includes[${index}]`))
    : undefined;
  if (baselineRef && includes && includes.length > 0) {
    throw new WorkbenchUserError(`${path.join(".workbench", SKILLS_FILE)} ${label} baseline skills cannot define includes.`);
  }
  return {
    name: normalizedName,
    kind: pathRef ? "local" : fromRef ? "remote" : "none",
    ...(pathRef ? { path: pathRef } : {}),
    ...(fromRef ? { from: fromRef } : {}),
    ...(explicitRef ? { ref: explicitRef } : {}),
    ...(includes && includes.length > 0 ? { includes } : {}),
  };
}

function parseSkillInclude(raw: unknown, label: string): WorkbenchSkillInclude {
  const value = typeof raw === "string" ? { path: raw } : asRecord(raw) ?? {};
  const pathRef = typeof value.path === "string" && value.path.trim() ? value.path.trim() : undefined;
  const fromRef = typeof value.from === "string" && value.from.trim() ? value.from.trim() : undefined;
  if ((pathRef ? 1 : 0) + (fromRef ? 1 : 0) !== 1) {
    throw new WorkbenchUserError(`${path.join(".workbench", SKILLS_FILE)} ${label} must define exactly one of path or from.`);
  }
  const explicitRef = typeof value.ref === "string" && value.ref.trim() ? value.ref.trim() : undefined;
  if (fromRef && !explicitRef) {
    throw new WorkbenchUserError(`${path.join(".workbench", SKILLS_FILE)} ${label} remote skills must define an explicit ref.`);
  }
  const explicitName = typeof value.name === "string" && value.name.trim() ? value.name.trim() : undefined;
  const fallbackName = pathRef
    ? safeName(path.basename(pathRef))
    : safeName(remoteSkillPathName(fromRef!));
  return {
    name: explicitName ?? fallbackName,
    kind: pathRef ? "local" : "remote",
    ...(pathRef ? { path: pathRef } : {}),
    ...(fromRef ? { from: fromRef } : {}),
    ...(explicitRef ? { ref: explicitRef } : {}),
  };
}

async function resolveRequestedSkillBundles(args: {
  root: string;
    state: WorkbenchProjectState;
    version: WorkbenchVersion;
    selection?: string;
    authToken?: string;
}): Promise<WorkbenchSkillBundleSnapshot[]> {
  const sources = await readSkillSources(args.root);
  args.state.skillSources = sources.map(copySkillSource);
  const defaultSelection = await readDefaultSkillSelection(args.root, sources);
  const requested = resolveNamedSelection(sources, args.selection, defaultSelection, "skill");
  const bundles: WorkbenchSkillBundleSnapshot[] = [];
  for (const source of requested) {
    const bundle = await resolveSkillBundle(args.root, source, args.version, {
      authToken: args.authToken,
      sources,
    });
    upsertByHash(args.state.skillBundles, bundle);
    bundles.push(bundle);
  }
  return bundles;
}

async function resolveSkillBundle(
  root: string,
  source: WorkbenchSkillSource,
  primaryVersion: WorkbenchVersion,
  options: { authToken?: string; sources?: readonly WorkbenchSkillSource[] } = {},
): Promise<WorkbenchSkillBundleSnapshot> {
  const entryFiles = source.kind === "none"
    ? []
    : source.kind === "local" && source.path === "." && source.name === PRIMARY_SKILL_NAME
    ? installablePrimarySkillFiles(primaryVersion.files, source, options.sources ?? [source])
        .map((file) => ({ ...copyFile(file), path: `${source.name}/${normalizeRelativePath(file.path)}` }))
    : await resolveSkillSourceFiles(root, source, source.name, options);
  const includedSkills: WorkbenchSkillInclude[] = [];
  const includeFiles: SurfaceSnapshotFile[] = [];
  for (const include of source.includes ?? []) {
    const files = await resolveSkillIncludeFiles(root, include, options);
    const resolvedInclude = {
      ...include,
      hash: hashFiles(files),
      files: files.map(copyFile),
    };
    includedSkills.push(resolvedInclude);
    includeFiles.push(...files);
  }
  const files = [...entryFiles, ...includeFiles].sort((left, right) => left.path.localeCompare(right.path));
  const hash = hashJson({
    source: {
      name: source.name,
      kind: source.kind,
      path: source.path,
      from: source.from,
      ref: source.ref,
    },
    files,
    includes: includedSkills.map((include) => ({
      name: include.name,
      kind: include.kind,
      path: include.path,
      from: include.from,
      ref: include.ref,
      hash: include.hash,
    })),
  });
  return {
    hash,
    skillName: source.name,
    entryName: source.name,
    source: copySkillSource(source),
    files,
    includedSkills,
    createdAt: now(),
  };
}

async function resolveSkillIncludeFiles(
  root: string,
  include: WorkbenchSkillInclude,
  options: { authToken?: string } = {},
): Promise<SurfaceSnapshotFile[]> {
  if (include.kind === "local") {
    return readProjectLocalSkillFiles(root, include.path ?? "", include.name);
  }
  return readRemoteSkillFiles(include.from ?? "", include.ref, include.name, options);
}

async function resolveSkillSourceFiles(
  root: string,
  source: WorkbenchSkillSource,
  prefix: string,
  options: { authToken?: string } = {},
): Promise<SurfaceSnapshotFile[]> {
  if (source.kind === "none") {
    return [];
  }
  if (source.kind === "local") {
    return readProjectLocalSkillFiles(root, source.path ?? "", prefix);
  }
  return readRemoteSkillFiles(source.from ?? "", source.ref, prefix, options);
}

async function readProjectLocalSkillFiles(root: string, relativePath: string, prefix: string): Promise<SurfaceSnapshotFile[]> {
  const absolute = await resolveProjectContainedPath(root, relativePath || ".");
  const files = (await readFilesUnder(absolute, prefix))
    .filter((file) => isInstallableSkillBundleFile(file, prefix));
  if (files.length === 0) {
    throw new WorkbenchUserError(`Local skill path ${relativePath || "."} contains no files.`);
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function resolveProjectContainedPath(root: string, relativePath: string): Promise<string> {
  if (path.isAbsolute(relativePath)) {
    throw new WorkbenchUserError(`Local skill path ${relativePath} must be relative to the Workbench project root.`);
  }
  if (relativePath.split(/[\\/]+/u).includes("..")) {
    throw new WorkbenchUserError(`Local skill path ${relativePath} must stay inside the Workbench project root.`);
  }
  const normalized = relativePath === "." ? "." : normalizeRelativePath(relativePath);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new WorkbenchUserError(`Local skill path ${relativePath} must stay inside the Workbench project root.`);
  }
  const projectRoot = await fs.realpath(root);
  const target = path.resolve(root, relativePath);
  let targetReal: string;
  try {
    targetReal = await fs.realpath(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkbenchUserError(`Unable to resolve local skill path ${relativePath}: ${message}`);
  }
  if (targetReal !== projectRoot && !targetReal.startsWith(`${projectRoot}${path.sep}`)) {
    throw new WorkbenchUserError(`Local skill path ${relativePath} must stay inside the Workbench project root.`);
  }
  return targetReal;
}

async function readRemoteSkillFiles(
  from: string,
  ref: string | undefined,
  prefix: string,
  options: { authToken?: string } = {},
): Promise<SurfaceSnapshotFile[]> {
  if (!ref?.trim()) {
    throw new WorkbenchUserError(`Remote skill ${from} must include an explicit ref.`);
  }
  const parsed = tryParseGithubSkillRef(from, ref.trim());
  if (!parsed && /^https?:\/\//u.test(from.trim())) {
    return readWorkbenchSourceSkillFiles(from, ref.trim(), prefix, options);
  }
  if (!parsed) {
    throw new WorkbenchUserError(`Unsupported remote skill ref ${from}. Use OWNER/REPO[/path], github:OWNER/REPO//path, a GitHub URL, or a Workbench source URL.`);
  }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-remote-skill-"));
  try {
    const archiveRef = ref.trim();
    const archiveUrl = `https://codeload.github.com/${parsed.owner}/${parsed.repo}/tar.gz/${archiveRef}`;
    const response = await fetch(archiveUrl, {
      headers: {
        ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    });
    if (!response.ok) {
      throw new WorkbenchUserError(`Unable to download remote skill ${from}${ref ? ` at ${ref}` : ""}: ${response.status} ${response.statusText}`);
    }
    const archivePath = path.join(temp, "source.tar.gz");
    await fs.writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
    const extract = spawnSync("tar", ["-xzf", archivePath, "-C", temp], { encoding: "utf8" });
    if (extract.status !== 0) {
      throw new WorkbenchUserError(`Unable to extract remote skill ${from}: ${extract.stderr || extract.stdout}`);
    }
    const extractedRoot = (await fs.readdir(temp, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()[0];
    if (!extractedRoot) {
      throw new WorkbenchUserError(`Remote skill ${from} archive was empty.`);
    }
    const absolute = path.join(temp, extractedRoot, parsed.subpath);
    const files = (await readFilesUnder(absolute, prefix))
      .filter((file) => isInstallableSkillBundleFile(file, prefix));
    if (files.length === 0) {
      throw new WorkbenchUserError(`Remote skill ${from} contains no installable skill files at ${parsed.subpath || "."}.`);
    }
    return files.sort((left, right) => left.path.localeCompare(right.path));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function readWorkbenchSourceSkillFiles(
  from: string,
  ref: string,
  prefix: string,
  options: { authToken?: string } = {},
): Promise<SurfaceSnapshotFile[]> {
  const sourceUrl = workbenchSourceSnapshotUrl(from, ref);
  const manifest = await fetchWorkbenchSourceJson<{
    schema?: string;
    versionId?: string;
    files?: Array<{
      path?: string;
      kind?: SurfaceSnapshotFile["kind"];
      encoding?: SurfaceSnapshotFile["encoding"];
      executable?: boolean;
      content?: string;
    }>;
  }>(sourceUrl, options);
  if (manifest.schema !== "workbench.source.snapshot.v1") {
    throw new WorkbenchUserError(`Workbench source URL did not return a source snapshot: ${from}`);
  }
  if (manifest.versionId !== ref) {
    throw new WorkbenchUserError(`Workbench source ${from} resolved ${manifest.versionId ?? "unknown"} instead of requested ref ${ref}.`);
  }
  const manifestFiles = (manifest.files ?? [])
    .filter((file): file is {
      path: string;
      kind?: SurfaceSnapshotFile["kind"];
      encoding?: SurfaceSnapshotFile["encoding"];
      executable?: boolean;
      content: string;
    } =>
      typeof file.path === "string" &&
      file.path.trim().length > 0 &&
      typeof file.content === "string"
    )
    .map((file) => ({
      ...file,
      path: normalizeWorkbenchSourceManifestPath(
        prefix ? `${prefix}/${file.path}` : file.path,
        from,
      ),
    }))
    .filter((file) => isInstallableSkillBundleFilePath(file.path, prefix))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (manifestFiles.length === 0) {
    throw new WorkbenchUserError(`Workbench source ${from} contains no installable skill files at ${ref}.`);
  }
  return manifestFiles.map((file) => ({
    path: file.path,
    ...(file.kind ? { kind: file.kind } : {}),
    encoding: file.encoding === "base64" ? "base64" : "utf8",
    content: file.content,
    ...(file.executable === true ? { executable: true } : {}),
  }));
}

function isInstallableSkillBundleFile(file: SurfaceSnapshotFile, prefix = ""): boolean {
  return isInstallableSkillBundleFilePath(file.path, prefix);
}

function isInstallableSkillBundleFilePath(filePath: string, prefix = ""): boolean {
  const normalizedPrefix = prefix ? normalizeWorkbenchSourcePath(prefix) : "";
  const normalizedPath = normalizeWorkbenchSourcePath(filePath);
  const sourcePath = normalizedPrefix && normalizedPath.startsWith(`${normalizedPrefix}/`)
    ? normalizedPath.slice(normalizedPrefix.length + 1)
    : normalizedPath;
  const parts = sourcePath.split("/");
  return !parts.some((part) => IGNORED_SKILL_DIRS.has(part)) &&
    !IGNORED_SKILL_FILES.has(path.posix.basename(sourcePath));
}

function normalizeWorkbenchSourceManifestPath(filePath: string, from: string): string {
  try {
    return normalizeWorkbenchSourcePath(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkbenchUserError(`Workbench source ${from} returned an unsafe file path ${JSON.stringify(filePath)}: ${message}`);
  }
}

function workbenchSourceSnapshotUrl(from: string, ref: string): URL {
  let url: URL;
  try {
    url = new URL(from);
  } catch {
    throw new WorkbenchUserError(`Invalid Workbench source URL: ${from}`);
  }
  const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  if (segments[0] !== "skills" || !segments[1] || !segments[2]) {
    throw new WorkbenchUserError(`Unsupported remote skill ref ${from}. Use a Workbench skill URL under /skills/OWNER/SKILL.`);
  }
  const owner = segments[1];
  const skill = segments[2];
  let version = ref;
  if (segments.length > 3) {
    if (segments[3] !== "releases" || !segments[4] || segments.length !== 5) {
      throw new WorkbenchUserError(`Invalid Workbench skill URL: ${from}`);
    }
    version = segments[4];
    if (version !== ref) {
      throw new WorkbenchUserError(`Workbench source URL ${url.toString()} is pinned to ${version}, not requested ref ${ref}.`);
    }
  } else if (segments.length !== 3) {
    throw new WorkbenchUserError(`Invalid Workbench skill URL: ${from}`);
  }
  url.pathname = `/api/workbench/source/skills/${encodeURIComponent(owner)}/${encodeURIComponent(skill)}/releases/${encodeURIComponent(version)}/source`;
  url.search = "";
  url.hash = "";
  return url;
}

async function fetchWorkbenchSourceJson<T>(
  url: URL,
  options: { authToken?: string } = {},
): Promise<T> {
  const response = await fetchWorkbenchSourceResponse(url, options);
  return JSON.parse(await response.text()) as T;
}

async function fetchWorkbenchSourceResponse(
  url: URL,
  options: { authToken?: string } = {},
): Promise<Response> {
  const token = options.authToken?.trim() ||
    process.env.WORKBENCH_API_TOKEN?.trim() ||
    process.env.WORKBENCH_SMOKE_BEARER_TOKEN?.trim();
  const response = await fetch(url, {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new WorkbenchUserError(`Unable to download Workbench source ${url.toString()}: ${response.status} ${response.statusText}`);
  }
  return response;
}

function parseGithubSkillRef(from: string): { owner: string; repo: string; subpath: string } {
  const parsed = tryParseGithubSkillRef(from);
  if (!parsed) {
    throw new WorkbenchUserError(`Unsupported remote skill ref ${from}. Use OWNER/REPO[/path], github:OWNER/REPO//path, a GitHub URL, or a Workbench source URL.`);
  }
  return parsed;
}

function tryParseGithubSkillRef(from: string, ref?: string): { owner: string; repo: string; subpath: string } | null {
  const trimmed = from.trim();
  const shorthand = /^github:([^/]+)\/([^/]+)(?:\/\/(.+))?$/u.exec(trimmed);
  if (shorthand) {
    return {
      owner: shorthand[1]!,
      repo: normalizeGithubRepoName(shorthand[2]!),
      subpath: shorthand[3] ? normalizeRelativePath(shorthand[3]) : ".",
    };
  }
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/u.exec(trimmed);
  if (ssh) {
    return {
      owner: ssh[1]!,
      repo: normalizeGithubRepoName(ssh[2]!),
      subpath: ".",
    };
  }
  if (/^[^/:]+\/[^/]+(?:\/.+)?$/u.test(trimmed)) {
    const [owner, repo, ...subpath] = trimmed.split("/");
    if (owner && repo) {
      return {
        owner,
        repo: normalizeGithubRepoName(repo),
        subpath: subpath.length > 0 ? normalizeRelativePath(subpath.join("/")) : ".",
      };
    }
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  const [owner, repoRaw] = segments;
  if (!owner || !repoRaw) {
    return null;
  }
  const repo = normalizeGithubRepoName(repoRaw);
  const mode = segments[2];
  if ((mode === "tree" || mode === "blob") && ref) {
    const refParts = ref.split("/").filter(Boolean);
    const afterMode = segments.slice(3);
    const refMatches = refParts.length > 0 && refParts.every((part, index) => afterMode[index] === part);
    if (refMatches) {
      const pathParts = afterMode.slice(refParts.length);
      const normalized = mode === "blob" && pathParts.at(-1) === SKILL_FILE
        ? pathParts.slice(0, -1)
        : pathParts;
      return {
        owner,
        repo,
        subpath: normalized.length > 0 ? normalizeRelativePath(normalized.join("/")) : ".",
      };
    }
  }
  return {
    owner,
    repo,
    subpath: ".",
  };
}

function normalizeGithubRepoName(repo: string): string {
  return repo.replace(/\.git$/u, "");
}

function remoteSkillPathName(from: string): string {
  const github = tryParseGithubSkillRef(from);
  if (github) {
    return path.posix.basename(github.subpath === "." ? github.repo : github.subpath);
  }
  const workbench = workbenchSourceName(from);
  if (workbench) {
    return workbench;
  }
  return parseGithubSkillRef(from).repo;
}

function workbenchSourceName(from: string): string | null {
  try {
    const url = new URL(from);
    const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
    if (segments[0] === "skills" && segments[2]) {
      return safeName(segments[2]);
    }
    const sourceIndex = segments.lastIndexOf("source");
    if (sourceIndex < 0) {
      return null;
    }
    const releaseIndex = segments.lastIndexOf("releases");
    const beforeSource = releaseIndex >= 0
      ? segments.slice(0, releaseIndex)
      : segments.slice(0, sourceIndex);
    const skillsIndex = beforeSource.lastIndexOf("skills");
    if (skillsIndex >= 0 && beforeSource[skillsIndex + 1]) {
      const maybeOwnerName = beforeSource[skillsIndex + 2];
      return safeName(maybeOwnerName ?? beforeSource[skillsIndex + 1]!);
    }
    return safeName(beforeSource.at(-1) ?? "workbench-skill");
  } catch {
    return null;
  }
}

async function readFilesUnder(root: string, prefix = ""): Promise<SurfaceSnapshotFile[]> {
  if (!await exists(root)) {
    return [];
  }
  const files: SurfaceSnapshotFile[] = [];
  await walkFiles(root, root, files, prefix);
  return files;
}

async function readOptionalFile(filePath: string, surfacePath: string): Promise<SurfaceSnapshotFile[]> {
  if (!await exists(filePath)) {
    return [];
  }
  return [surfaceFileFromBuffer(surfacePath, await fs.readFile(filePath), false)];
}

async function walkFiles(root: string, current: string, files: SurfaceSnapshotFile[], prefix: string): Promise<void> {
  const entries = (await fs.readdir(current, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (!prefix && IGNORED_SKILL_DIRS.has(entry.name)) {
        continue;
      }
      await walkFiles(root, absolute, files, prefix);
      continue;
    }
    if (!entry.isFile() || IGNORED_SKILL_FILES.has(entry.name)) {
      continue;
    }
    const content = await fs.readFile(absolute);
    const executable = ((await fs.stat(absolute)).mode & 0o111) !== 0;
    files.push(surfaceFileFromBuffer(
      prefix ? `${prefix}/${relative}` : relative,
      content,
      executable,
    ));
  }
}

async function materializeSkillFiles(root: string, files: readonly SurfaceSnapshotFile[]): Promise<void> {
  await removeInstallableFiles(root);
  await removeAuthoredWorkbenchFiles(root);
  for (const file of files.filter((entry) => !isWorkbenchLocalMetadataPath(entry.path))) {
    await writeSurfaceFile(root, file);
  }
}

async function removeAuthoredWorkbenchFiles(root: string): Promise<void> {
  const workbenchRoot = workbenchDir(root);
  await Promise.all([
    fs.rm(path.join(workbenchRoot, EVAL_FILE), { force: true }),
    fs.rm(path.join(workbenchRoot, CASES_DIR), { recursive: true, force: true }),
    fs.rm(path.join(workbenchRoot, AGENTS_FILE), { force: true }),
    fs.rm(path.join(workbenchRoot, SKILLS_FILE), { force: true }),
    fs.rm(path.join(workbenchRoot, ENVIRONMENT_DIR), { recursive: true, force: true }),
  ]);
}

async function materializeWorkbenchFiles(root: string, state: WorkbenchProjectState, evalHash?: string): Promise<void> {
  const workbenchRoot = workbenchDir(root);
  await fs.mkdir(workbenchRoot, { recursive: true });
  await fs.rm(path.join(workbenchRoot, EVAL_FILE), { force: true });
  await fs.rm(path.join(workbenchRoot, CASES_DIR), { recursive: true, force: true });
  await fs.rm(path.join(workbenchRoot, ENVIRONMENT_DIR), { recursive: true, force: true });

  const evalSnapshot = evalHash
    ? state.evals.find((entry) => entry.hash === evalHash) ?? selectActiveEvalSnapshot(state)
    : selectActiveEvalSnapshot(state);
  if (evalSnapshot) {
    for (const file of evalSnapshot.files) {
      await writeSurfaceFile(workbenchRoot, file);
    }
  }
}

async function removeInstallableFiles(root: string): Promise<void> {
  if (!await exists(root)) {
    return;
  }
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (IGNORED_SKILL_DIRS.has(entry.name)) {
      continue;
    }
    await fs.rm(path.join(root, entry.name), { recursive: true, force: true });
  }
}

interface WorkbenchProjectLockOwner {
  schema: "workbench.project-lock.v1";
  pid: number;
  hostname: string;
  startedAt: string;
}

export async function withWorkbenchProjectLock<T>(
  dir: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return withWorkbenchProjectLockRoot(resolveRoot(dir), fn);
}

async function withWorkbenchProjectLockRoot<T>(
  root: string,
  fn: () => Promise<T>,
): Promise<T> {
  const normalizedRoot = path.resolve(root);
  const held = projectLockContext.getStore();
  if (held?.has(normalizedRoot)) {
    return fn();
  }
  const previous = projectLockQueues.get(normalizedRoot) ?? Promise.resolve();
  let releaseQueue!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  projectLockQueues.set(normalizedRoot, queued);
  await previous.catch(() => undefined);
  let release: (() => Promise<void>) | null = null;
  try {
    release = await acquireWorkbenchProjectLock(normalizedRoot);
    const next = new Set(held ?? []);
    next.add(normalizedRoot);
    return await projectLockContext.run(next, fn);
  } finally {
    if (release) {
      await release();
    }
    releaseQueue();
    if (projectLockQueues.get(normalizedRoot) === queued) {
      projectLockQueues.delete(normalizedRoot);
    }
  }
}

async function withWorkbenchProjectLockIfInitialized<T>(
  root: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!await exists(workbenchDir(root))) {
    return fn();
  }
  return withWorkbenchProjectLockRoot(root, fn);
}

async function acquireWorkbenchProjectLock(root: string): Promise<() => Promise<void>> {
  await ensureWorkbenchLocalMetadataIgnore(root);
  const lockRoot = projectLockDir(root);
  const ownerPath = path.join(lockRoot, "owner.json");
  const deadline = Date.now() + projectLockTimeoutMs();
  let attempts = 0;
  while (true) {
    await fs.mkdir(path.dirname(lockRoot), { recursive: true });
    try {
      await fs.mkdir(lockRoot);
      await writeJson(ownerPath, {
        schema: "workbench.project-lock.v1",
        pid: process.pid,
        hostname: os.hostname(),
        startedAt: now(),
      } satisfies WorkbenchProjectLockOwner);
      return async () => {
        await fs.rm(lockRoot, { recursive: true, force: true });
      };
    } catch (error) {
      if (fileErrorCode(error) !== "EEXIST") {
        throw error;
      }
    }
    if (await removeStaleWorkbenchProjectLock(lockRoot)) {
      continue;
    }
    if (Date.now() > deadline) {
      const owner = await readWorkbenchProjectLockOwner(ownerPath).catch(() => null);
      throw new WorkbenchUserError(
        `Workbench project is locked by another command${owner ? ` on ${owner.hostname} pid ${owner.pid}` : ""}. ` +
          `Wait for it to finish or remove ${lockRoot} if the process is gone.`,
      );
    }
    await sleep(Math.min(1000, PROJECT_LOCK_RETRY_MS + attempts * 25));
    attempts += 1;
  }
}

async function removeStaleWorkbenchProjectLock(lockRoot: string): Promise<boolean> {
  const owner = await readWorkbenchProjectLockOwner(path.join(lockRoot, "owner.json")).catch(() => null);
  if (!owner) {
    return false;
  }
  if (owner.hostname !== os.hostname()) {
    return false;
  }
  if (processIsRunning(owner.pid)) {
    return false;
  }
  await fs.rm(lockRoot, { recursive: true, force: true });
  return true;
}

async function readWorkbenchProjectLockOwner(filePath: string): Promise<WorkbenchProjectLockOwner | null> {
  const record = asRecord(await readJson(filePath));
  if (
    record?.schema !== "workbench.project-lock.v1" ||
    typeof record.pid !== "number" ||
    typeof record.hostname !== "string" ||
    typeof record.startedAt !== "string"
  ) {
    return null;
  }
  return {
    schema: "workbench.project-lock.v1",
    pid: record.pid,
    hostname: record.hostname,
    startedAt: record.startedAt,
  };
}

function processIsRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return fileErrorCode(error) !== "ESRCH";
  }
}

function projectLockTimeoutMs(): number {
  const raw = process.env.WORKBENCH_PROJECT_LOCK_TIMEOUT_MS?.trim();
  if (!raw) {
    return PROJECT_LOCK_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : PROJECT_LOCK_TIMEOUT_MS;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadState(root: string, options: { allowMissing?: boolean } = {}): Promise<WorkbenchProjectState> {
  const workbenchRoot = workbenchDir(root);
  if (!await exists(workbenchRoot)) {
    if (!options.allowMissing) {
      throw new WorkbenchUserError("Workbench is not initialized here. Run `workbench init` first.");
    }
    return emptyWorkbenchState(root);
  }
  await recoverAtomicStateCommit(root);
  return readStateFromObjectStore(root, <T>(type: WorkbenchStateObjectType) => readObjectTypeDir<T>(root, type));
}

async function loadStateReadOnlyWithRetry(root: string): Promise<WorkbenchProjectState> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await loadStateReadOnly(root);
    } catch (error) {
      if (!isTransientStateReadError(error) || attempt === 5) {
        throw error;
      }
      await sleep(15 * (attempt + 1));
    }
  }
  return loadStateReadOnly(root);
}

async function loadStateReadOnly(root: string): Promise<WorkbenchProjectState> {
  const workbenchRoot = workbenchDir(root);
  if (!await exists(workbenchRoot)) {
    throw new WorkbenchUserError("Workbench is not initialized here. Run `workbench init` first.");
  }
  await assertStateDirsAvailableForReadOnly(root);
  return readStateFromObjectStore(root, <T>(type: WorkbenchStateObjectType) => readObjectTypeDirReadOnly<T>(root, type));
}

type WorkbenchStateObjectType =
  | "version"
  | "skill-source"
  | "skill-bundle"
  | "eval"
  | "agent"
  | "run"
  | "job"
  | "trace"
  | "execution-event"
  | "artifact"
  | "lineage";

type WorkbenchStateObjectReader = <T>(type: WorkbenchStateObjectType) => Promise<T[]>;

function readObjectTypeDir<T>(
  root: string,
  type: WorkbenchStateObjectType,
): Promise<T[]> {
  return readObjectDir<T>(objectTypeDir(root, type));
}

async function readStateFromObjectStore(
  root: string,
  readObjects: WorkbenchStateObjectReader,
): Promise<WorkbenchProjectState> {
  const refs = await readWorkbenchRefs(root);
  const remotes = await readWorkbenchRemotesFile(root);
  const state: WorkbenchProjectState = {
    schema: STATE_SCHEMA,
    root,
    refs,
    remotes,
    versions: readStateArray(await readObjects<unknown>("version"), "versions", validateStateVersion),
    skillSources: readStateArray(await readObjects<unknown>("skill-source"), "skillSources", validateStateSkillSource),
    skillBundles: readStateArray(await readObjects<unknown>("skill-bundle"), "skillBundles", validateStateSkillBundle),
    evals: readStateArray(await readObjects<unknown>("eval"), "evals", validateStateEvalSnapshot),
    agents: readStateArray(await readObjects<unknown>("agent"), "agents", validateStateAgent),
    runs: readStateArray(await readObjects<unknown>("run"), "runs", validateStateRun),
    jobs: readStateArray(await readObjects<unknown>("job"), "jobs", validateStateJob),
    traces: readStateArray(await readObjects<unknown>("trace"), "traces", validateStateTrace),
    executionEvents: readStateArray(await readObjects<unknown>("execution-event"), "executionEvents", validateStateExecutionEventBatch),
    artifacts: readStateArray(await readObjects<unknown>("artifact"), "artifacts", validateStateArtifact),
    lineage: readStateArray(await readObjects<unknown>("lineage"), "lineage", validateStateLineageEdge),
  };
  return state;
}

async function readObjectTypeDirReadOnly<T>(
  root: string,
  type: WorkbenchStateObjectType,
): Promise<T[]> {
  await assertStateDirsAvailableForReadOnly(root);
  return readObjectDir<T>(objectTypeDir(root, type));
}

async function assertStateDirsAvailableForReadOnly(root: string): Promise<void> {
  const [objectsReady, refsReady] = await Promise.all([
    exists(objectsDir(root)),
    exists(refsDir(root)),
  ]);
  if (!objectsReady || !refsReady) {
    throw transientStateReadUnavailableError(root);
  }
}

function transientStateReadUnavailableError(root: string): Error {
  const error = new Error(`Workbench state is being committed for ${root}.`) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
}

async function saveState(root: string, state: WorkbenchProjectState): Promise<void> {
  await withWorkbenchProjectLockRoot(root, async () => {
    await fs.mkdir(workbenchDir(root), { recursive: true });
    await fs.mkdir(path.join(workbenchDir(root), TMP_DIR), { recursive: true });
    await fs.rm(path.join(workbenchDir(root), "store"), { recursive: true, force: true });
    await recoverAtomicStateCommit(root);
    const nonce = `${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const tempRoot = path.join(workbenchDir(root), TMP_DIR, `state-${nonce}`);
    const tempObjectsDir = path.join(tempRoot, OBJECTS_DIR);
    const tempRefsDir = path.join(tempRoot, REFS_DIR);
    try {
      await writeObjectCollectionToDir(tempObjectsDir, "version", state.versions, (version) => version.id);
      await writeObjectCollectionToDir(tempObjectsDir, "skill-source", state.skillSources, (source) => source.name);
      await writeObjectCollectionToDir(tempObjectsDir, "skill-bundle", state.skillBundles, (bundle) => bundle.hash);
      await writeObjectCollectionToDir(tempObjectsDir, "eval", state.evals, (evalSnapshot) => evalSnapshot.hash);
      await writeObjectCollectionToDir(tempObjectsDir, "agent", state.agents, (agent) => hashJson(agent));
      await writeObjectCollectionToDir(tempObjectsDir, "run", state.runs, (run) => run.id);
      await writeObjectCollectionToDir(tempObjectsDir, "job", state.jobs, (job) => job.id);
      await writeObjectCollectionToDir(tempObjectsDir, "trace", state.traces, (trace) => trace.id);
      await writeObjectCollectionToDir(tempObjectsDir, "execution-event", state.executionEvents, workbenchExecutionEventBatchId);
      await writeObjectCollectionToDir(tempObjectsDir, "artifact", state.artifacts, (artifact) => artifact.id);
      await writeObjectCollectionToDir(tempObjectsDir, "lineage", state.lineage, (edge) => hashJson(edge).slice(0, 24));
      await writeWorkbenchRefsToDir(tempRefsDir, state.refs);
      await replaceStateDirectory(objectsDir(root), tempObjectsDir, stateBackupDir(root, OBJECTS_DIR));
      await replaceStateDirectory(refsDir(root), tempRefsDir, stateBackupDir(root, REFS_DIR));
      await writeWorkbenchRemotesFile(root, state.remotes);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
}

interface WorkbenchHttpRemoteOptions {
  authToken?: string;
}

interface WorkbenchRemoteWriteOptions extends WorkbenchHttpRemoteOptions {
  state: WorkbenchProjectState;
  visibility?: WorkbenchPublishVisibility;
}

class WorkbenchRemoteNotFoundError extends Error {
  readonly code = "ENOENT";

  constructor(message: string) {
    super(message);
    this.name = "WorkbenchRemoteNotFoundError";
  }
}

async function readRemoteObjectPack(remote: WorkbenchRemote, options: WorkbenchHttpRemoteOptions = {}): Promise<WorkbenchObjectPack> {
  if (isHttpRemote(remote)) {
    const target = await resolveHttpRemoteSkill(remote, options, undefined);
    const response = await httpRemoteJson<{ objectPack?: WorkbenchObjectPack }>(
      target.baseUrl,
      `/api/workbench/skills/${encodeURIComponent(target.skillId)}/objects`,
      { authToken: options.authToken },
    );
    if (!response.objectPack) {
      throw new WorkbenchUserError(`HTTP Workbench remote did not return an object pack: ${remote.url}`);
    }
    return response.objectPack;
  }
  const root = remoteObjectPackRoot(remote);
  return readObjectPackFiles(root);
}

async function writeRemoteObjectPack(
  remote: WorkbenchRemote,
  pack: WorkbenchObjectPack,
  state: WorkbenchProjectState,
  options: WorkbenchHttpRemoteOptions = {},
): Promise<void> {
  if (isHttpRemote(remote)) {
    const target = await resolveHttpRemoteSkill(remote, options, state);
    await httpRemoteJson<{ skill: unknown }>(
      target.baseUrl,
      `/api/workbench/skills/${encodeURIComponent(target.skillId)}/objects`,
      {
        authToken: options.authToken,
        method: "PUT",
        body: { objectPack: pack },
      },
    );
    return;
  }
  const root = remoteObjectPackRoot(remote);
  await fs.mkdir(root, { recursive: true });
  await writeObjectPackFiles(root, pack);
}

async function writeRemotePublishedSource(
  remote: WorkbenchRemote,
  version: WorkbenchVersion,
  options: WorkbenchRemoteWriteOptions,
): Promise<{ installUrl: string; pinnedInstallUrl: string }> {
  if (isHttpRemote(remote)) {
    const target = await resolveHttpRemoteSkill(remote, options, options.state);
    if (!target.owner || !target.name) {
      throw new WorkbenchUserError(`Workbench Cloud remote did not return owner/name identity for ${remote.url}.`);
    }
    const publication = {
      installUrl: `${target.baseUrl}/skills/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}`,
      pinnedInstallUrl: `${target.baseUrl}/skills/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}/releases/${encodeURIComponent(version.id)}`,
    };
    await httpRemoteJson<{ skill: unknown }>(
      target.baseUrl,
      `/api/workbench/skills/${encodeURIComponent(target.skillId)}/objects`,
      {
        authToken: options.authToken,
        method: "PUT",
        body: {
          objectPack: emptyObjectPack(),
          publishVersionId: version.id,
          visibility: options.visibility ?? "private",
        },
      },
    );
    return publication;
  }
  throw new WorkbenchCodedError("publish_failed", `Remote ${remote.name} is a file remote; only Workbench Cloud remotes can publish installable source.`, {
    remediation: "Run workbench remote add --name cloud --url https://HOST/skills/OWNER/SKILL, then workbench publish --remote cloud.",
    subject: { remote: remote.name, kind: remote.kind, url: remote.url },
    exitCode: 1,
  });
}

function remoteObjectPackRoot(remote: WorkbenchRemote): string {
  if (remote.kind === "file") {
    return fileURLToPath(remote.url);
  }
  throw new WorkbenchCodedError("remote_invalid_url", "Workbench Cloud remotes require authenticated object sync.", {
    subject: { remote: remote.name, url: remote.url },
  });
}

function workbenchRemoteSourceUrl(remote: WorkbenchRemote): string {
  if (!isHttpRemote(remote)) {
    throw new WorkbenchCodedError("publish_failed", `Remote ${remote.name} is a file remote; only Workbench Cloud remotes have install URLs.`, {
      subject: { remote: remote.name, kind: remote.kind, url: remote.url },
      exitCode: 1,
    });
  }
  const parsed = parseHttpRemote(remote);
  return `${parsed.baseUrl}/skills/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}`;
}

function workbenchRemoteReleaseSourceUrl(remote: WorkbenchRemote, versionId: string): string {
  if (!isHttpRemote(remote)) {
    throw new WorkbenchCodedError("publish_failed", `Remote ${remote.name} is a file remote; only Workbench Cloud remotes have install URLs.`, {
      subject: { remote: remote.name, kind: remote.kind, url: remote.url, versionId },
      exitCode: 1,
    });
  }
  const parsed = parseHttpRemote(remote);
  return `${parsed.baseUrl}/skills/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}/releases/${encodeURIComponent(versionId)}`;
}

function isHttpRemote(remote: WorkbenchRemote): boolean {
  return remote.kind === "workbench-cloud";
}

interface ParsedHttpRemote {
  baseUrl: string;
  owner: string;
  name: string;
}

interface ResolvedHttpRemote {
  baseUrl: string;
  skillId: string;
  owner?: string;
  name?: string;
}

async function resolveHttpRemoteSkill(
  remote: WorkbenchRemote,
  options: WorkbenchHttpRemoteOptions,
  state: WorkbenchProjectState | undefined,
): Promise<ResolvedHttpRemote> {
  const parsed = parseHttpRemote(remote);
  const listed = await httpRemoteJson<{ skills?: Array<{ id: string; ownerSlug: string; name: string }> }>(
    parsed.baseUrl,
    "/api/workbench/skills",
    { authToken: options.authToken },
  );
  const existing = listed.skills?.find((skill) =>
    skill.name === parsed.name &&
    skill.ownerSlug === parsed.owner
  );
  if (existing) {
    return {
      baseUrl: parsed.baseUrl,
      skillId: existing.id,
      owner: existing.ownerSlug,
      name: existing.name,
    };
  }
  if (!state) {
    throw new WorkbenchRemoteNotFoundError(`Workbench Cloud skill not found: ${remote.url}`);
  }
  const currentVersion = state.refs.current
    ? state.versions.find((version) => version.id === state.refs.current)
    : state.versions[state.versions.length - 1];
  const created = await httpRemoteJson<{ skill?: { id?: string; ownerSlug?: string; name?: string } }>(
    parsed.baseUrl,
    "/api/workbench/skills",
    {
      authToken: options.authToken,
      method: "POST",
      body: {
        name: parsed.name,
        ownerSlug: parsed.owner,
        description: currentVersion?.message ?? "Workbench skill",
        state: stateForHttpRemoteCreate(state),
      },
    },
  );
  if (!created.skill?.id) {
    throw new WorkbenchUserError(`Workbench Cloud did not return a skill id for remote: ${remote.url}`);
  }
  return {
    baseUrl: parsed.baseUrl,
    skillId: created.skill.id,
    owner: created.skill.ownerSlug,
    name: created.skill.name,
  };
}

function parseHttpRemote(remote: WorkbenchRemote): ParsedHttpRemote {
  const parsed = parseWorkbenchRemoteUrl(remote.url);
  if (parsed.kind !== "workbench-cloud") {
    throw new WorkbenchCodedError("remote_invalid_url", `Workbench remote is not a Cloud remote: ${remote.url}`, {
      subject: { remote: remote.name, url: remote.url },
    });
  }
  return { baseUrl: parsed.baseUrl, owner: parsed.owner, name: parsed.skill };
}

function stateForHttpRemoteCreate(state: WorkbenchProjectState): WorkbenchProjectState {
  return {
    ...copyStateForRoot(state, state.root),
    refs: refsForRemoteSync(state.refs),
    remotes: {},
  };
}

async function httpRemoteJson<T>(
  baseUrl: string,
  apiPath: string,
  options: WorkbenchHttpRemoteOptions & { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = options.authToken?.trim() ||
    process.env.WORKBENCH_API_TOKEN?.trim() ||
    process.env.WORKBENCH_SMOKE_BEARER_TOKEN?.trim();
  const requestBody = encodeHttpRemoteJsonBody(options.body);
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method: options.method ?? "GET",
    headers: {
      ...requestBody.headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: requestBody.body,
  });
  const text = await response.text();
  if (!response.ok) {
    const cloudError = parseWorkbenchCloudErrorBody(text);
    if (cloudError) {
      if (response.status === 404 && isNotFoundCloudErrorCode(cloudError.code)) {
        throw new WorkbenchRemoteNotFoundError(cloudError.message);
      }
      throw new WorkbenchCodedError(cloudError.code, cloudError.message, {
        retryable: cloudError.retryable,
        ...(cloudError.remediation ? { remediation: cloudError.remediation } : {}),
        ...(cloudError.subject ? { subject: cloudError.subject } : {}),
        exitCode: response.status === 400 ? 2 : 1,
      });
    }
    if (response.status === 401 && !token) {
      throw new WorkbenchCodedError("auth_required", "Workbench Cloud remote requires login.", {
        remediation: "Run workbench login.",
        exitCode: 1,
      });
    }
    if (response.status === 404) {
      throw new WorkbenchRemoteNotFoundError(`Workbench Cloud object not found: ${apiPath}`);
    }
    throw new WorkbenchCodedError("remote_protocol_error", `Workbench Cloud remote request failed (${response.status}): ${readHttpErrorMessage(text)}`, {
      subject: { status: response.status, path: apiPath },
      exitCode: 1,
    });
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function isNotFoundCloudErrorCode(code: string): boolean {
  return code === "not_found" || code.endsWith("_not_found");
}

function parseWorkbenchCloudErrorBody(text: string): {
  code: string;
  message: string;
  retryable: boolean;
  remediation?: string;
  subject?: Record<string, Json>;
} | null {
  try {
    const record = asRecord(JSON.parse(text) as unknown);
    if (record?.schema !== "workbench.cloud.error.v1" || typeof record.code !== "string" || typeof record.message !== "string") {
      return null;
    }
    const subject = asRecord(record.subject);
    return {
      code: record.code,
      message: record.message,
      retryable: record.retryable === true,
      ...(typeof record.remediation === "string" ? { remediation: record.remediation } : {}),
      ...(subject ? { subject: subject as Record<string, Json> } : {}),
    };
  } catch {
    return null;
  }
}

function encodeHttpRemoteJsonBody(body: unknown): {
  body?: BodyInit;
  headers: Record<string, string>;
} {
  if (body === undefined) {
    return { headers: { "content-type": "application/json" } };
  }
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) < HTTP_REMOTE_GZIP_THRESHOLD_BYTES) {
    return { body: text, headers: { "content-type": "application/json" } };
  }
  const compressed = gzipSync(text);
  return {
    body: compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength),
    headers: {
      "content-encoding": "gzip",
      "content-type": "application/json",
    },
  };
}

function readHttpErrorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    const record = asRecord(parsed);
    const message = record?.message ?? record?.error;
    return typeof message === "string" && message.trim() ? message : text.slice(0, 1000);
  } catch {
    return text.trim() || "empty response";
  }
}

async function writeObjectPackFiles(root: string, pack: WorkbenchObjectPack): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await Promise.all([
    fs.rm(path.join(root, "manifest.json"), { force: true }),
    fs.rm(path.join(root, "refs.json"), { force: true }),
    fs.rm(path.join(root, "objects"), { recursive: true, force: true }),
    fs.rm(path.join(root, "indexes"), { recursive: true, force: true }),
  ]);
  await writeJson(path.join(root, "manifest.json"), {
    schema: pack.schema,
    createdAt: pack.createdAt,
  });
  await writeJson(path.join(root, "refs.json"), pack.refs);
  for (const version of pack.versions) {
    await writeJson(path.join(root, "objects", "version", `${version.id}.json`), version);
  }
  for (const evalSnapshot of pack.evals) {
    await writeJson(path.join(root, "objects", "eval", `${evalSnapshot.hash}.json`), evalSnapshot);
  }
  for (const source of pack.skillSources) {
    await writeJson(path.join(root, "objects", "skill-source", `${source.name}.json`), source);
  }
  for (const bundle of pack.skillBundles) {
    await writeJson(path.join(root, "objects", "skill-bundle", `${bundle.hash}.json`), bundle);
  }
  for (const agent of pack.agents) {
    await writeJson(path.join(root, "objects", "agent", `${hashJson(agent)}.json`), agent);
  }
  for (const run of pack.runs) {
    await writeJson(path.join(root, "objects", "run", `${run.id}.json`), run);
  }
  for (const job of pack.jobs) {
    await writeJson(path.join(root, "objects", "job", `${job.id}.json`), job);
  }
  for (const trace of pack.traces) {
    await writeJson(path.join(root, "objects", "trace", `${trace.id}.json`), trace);
  }
  for (const batch of pack.executionEvents) {
    await writeJson(path.join(root, "objects", "execution-event", `${workbenchExecutionEventBatchId(batch)}.json`), batch);
  }
  for (const artifact of pack.artifacts) {
    await writeJson(path.join(root, "objects", "artifact", `${artifact.id}.json`), artifact);
  }
  await writeJsonl(path.join(root, "indexes", "versions.jsonl"), pack.versions);
  await writeJsonl(path.join(root, "indexes", "lineage.jsonl"), pack.lineage);
  await writeJsonl(path.join(root, "indexes", "measurements.jsonl"), pack.runs.filter((run) => run.score !== undefined));
  await writeJsonl(path.join(root, "indexes", "runs.jsonl"), pack.runs);
  await writeJsonl(path.join(root, "indexes", "jobs.jsonl"), pack.jobs);
  await writeJsonl(path.join(root, "indexes", "execution-events.jsonl"), pack.executionEvents);
  await writeJsonl(path.join(root, "indexes", "artifacts.jsonl"), pack.artifacts);
}

async function readObjectPackFiles(root: string): Promise<WorkbenchObjectPack> {
  const manifest = await readJson(path.join(root, "manifest.json"));
  if (asRecord(manifest)?.schema !== PACK_SCHEMA) {
    throw new WorkbenchUserError("Remote does not contain a Workbench object pack.");
  }
  return {
    schema: PACK_SCHEMA,
    createdAt: typeof asRecord(manifest)?.createdAt === "string" ? asRecord(manifest)?.createdAt as string : now(),
    refs: asStringMap(await readJson(path.join(root, "refs.json"))) ?? {},
    versions: readStateArray(await readObjectDir<unknown>(path.join(root, "objects", "version")), "versions", validateStateVersion),
    skillSources: readStateArray(await readObjectDir<unknown>(path.join(root, "objects", "skill-source")), "skillSources", validateStateSkillSource),
    skillBundles: readStateArray(await readObjectDir<unknown>(path.join(root, "objects", "skill-bundle")), "skillBundles", validateStateSkillBundle),
    evals: readStateArray(await readObjectDir<unknown>(path.join(root, "objects", "eval")), "evals", validateStateEvalSnapshot),
    agents: readStateArray(await readObjectDir<unknown>(path.join(root, "objects", "agent")), "agents", validateStateAgent),
    runs: readStateArray(await readObjectDir<unknown>(path.join(root, "objects", "run")), "runs", validateStateRun),
    jobs: readStateArray(await readObjectDir<unknown>(path.join(root, "objects", "job")), "jobs", validateStateJob),
    traces: readStateArray(await readObjectDir<unknown>(path.join(root, "objects", "trace")), "traces", validateStateTrace),
    executionEvents: readStateArray(await readObjectDir<unknown>(path.join(root, "objects", "execution-event")), "executionEvents", validateStateExecutionEventBatch),
    artifacts: readStateArray(await readObjectDir<unknown>(path.join(root, "objects", "artifact")), "artifacts", validateStateArtifact),
    lineage: readStateArray(await readJsonl(path.join(root, "indexes", "lineage.jsonl")), "lineage", validateStateLineageEdge),
  };
}

async function readObjectDir<T>(dir: string): Promise<T[]> {
  if (!await exists(dir)) {
    return [];
  }
  const entries = await fs.readdir(dir);
  return Promise.all(entries.filter((entry) => entry.endsWith(".json")).map((entry) =>
    readJson(path.join(dir, entry)) as Promise<T>
  ));
}

async function recoverAtomicStateCommit(root: string): Promise<void> {
  await recoverStateDirectory(objectsDir(root), stateBackupDir(root, OBJECTS_DIR));
  await recoverStateDirectory(refsDir(root), stateBackupDir(root, REFS_DIR));
}

async function recoverStateDirectory(target: string, backup: string): Promise<void> {
  const [hasTarget, hasBackup] = await Promise.all([exists(target), exists(backup)]);
  if (hasTarget && hasBackup) {
    await fs.rm(backup, { recursive: true, force: true });
    return;
  }
  if (!hasTarget && hasBackup) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(backup, target);
  }
}

async function replaceStateDirectory(target: string, next: string, backup: string): Promise<void> {
  await fs.rm(backup, { recursive: true, force: true });
  if (await exists(target)) {
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.rename(target, backup);
  }
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(next, target);
    await fs.rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (!await exists(target) && await exists(backup)) {
      await fs.rename(backup, target);
    }
    throw error;
  }
}

async function writeObjectCollectionToDir<T>(
  objectsRoot: string,
  type: string,
  records: readonly T[],
  id: (record: T) => string,
): Promise<void> {
  await fs.mkdir(path.join(objectsRoot, type), { recursive: true });
  for (const record of records) {
    await writeJson(path.join(objectsRoot, type, `${safeObjectFileName(id(record))}.json`), record);
  }
}

async function readWorkbenchRefs(root: string): Promise<WorkbenchRefs> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await readWorkbenchRefsOnce(root);
    } catch (error) {
      if (!isTransientStateReadError(error) || attempt === 4) {
        throw error;
      }
      await sleep(10 * (attempt + 1));
    }
  }
  return {};
}

async function readWorkbenchRefsOnce(root: string): Promise<WorkbenchRefs> {
  const dir = refsDir(root);
  if (!await exists(dir)) {
    return {};
  }
  const refs: WorkbenchRefs = {};
  await readRefDir(dir, dir, refs);
  return refs;
}

function isTransientStateReadError(error: unknown): boolean {
  return new Set(["ENOENT", "EINVAL", "ENOTDIR"]).has(fileErrorCode(error) ?? "");
}

async function readRefDir(root: string, current: string, refs: WorkbenchRefs): Promise<void> {
  const entries = (await fs.readdir(current, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await readRefDir(root, absolute, refs);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const name = path.relative(root, absolute).split(path.sep).join("/");
    const value = (await fs.readFile(absolute, "utf8")).trim();
    if (value) {
      refs[name] = value;
    }
  }
}

async function writeWorkbenchRefsToDir(dir: string, refs: WorkbenchRefs): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  for (const [name, value] of Object.entries(refs)) {
    if (!value || name.includes("..") || path.isAbsolute(name)) {
      continue;
    }
    const filePath = path.join(dir, ...name.split("/"));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await writeTextFileAtomically(filePath, `${value}\n`);
  }
}

async function readWorkbenchRemotesFile(root: string): Promise<Record<string, WorkbenchRemote>> {
  const filePath = remotesFile(root);
  if (!await exists(filePath)) {
    return {};
  }
  const parsed = parseYamlRecord(await fs.readFile(filePath, "utf8"));
  if (parsed.schema !== "workbench.remotes.v1") {
    throw new WorkbenchCodedError("remote_invalid_url", `${path.join(WORKBENCH_DIR, REMOTES_FILE)} must use schema workbench.remotes.v1.`, {
      remediation: "Recreate remotes with workbench remote add --name origin --url URL.",
      subject: { path: path.join(WORKBENCH_DIR, REMOTES_FILE) },
      exitCode: 2,
    });
  }
  const remoteRecord = asRecord(parsed.remotes);
  if (!remoteRecord) {
    return {};
  }
  const remotes: Record<string, WorkbenchRemote> = {};
  for (const [name, value] of Object.entries(remoteRecord)) {
    const remoteName = validateRemoteName(name);
    const record = asRecord(value);
    const url = typeof record?.url === "string" ? record.url : "";
    const kind = typeof record?.kind === "string" ? record.kind : "";
    const parsedUrl = parseWorkbenchRemoteUrl(url);
    if (kind && kind !== parsedUrl.kind) {
      throw new WorkbenchCodedError("remote_invalid_url", `Workbench remote ${remoteName} kind does not match its URL.`, {
        remediation: `Run workbench remote add --name ${remoteName} --url ${parsedUrl.url} --replace.`,
        subject: { remote: remoteName, kind, url },
        exitCode: 2,
      });
    }
    remotes[remoteName] = { name: remoteName, url: parsedUrl.url, kind: parsedUrl.kind };
  }
  return remotes;
}

async function writeWorkbenchRemotesFile(root: string, remotes: Record<string, WorkbenchRemote>): Promise<void> {
  const entries = Object.values(remotes).sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length === 0) {
    await fs.rm(remotesFile(root), { force: true });
    return;
  }
  const value = {
    schema: "workbench.remotes.v1",
    remotes: Object.fromEntries(entries.map((remote) => [
      remote.name,
      {
        url: remote.url,
        kind: remote.kind,
      },
    ])),
  };
  await fs.mkdir(workbenchDir(root), { recursive: true });
  await writeTextFileAtomically(remotesFile(root), `${YAML.stringify(value).trimEnd()}\n`);
}

async function writeSurfaceFiles(root: string, files: readonly SurfaceSnapshotFile[]): Promise<void> {
  for (const file of files) {
    await writeSurfaceFile(root, file);
  }
}

async function withMaterializedVersionRoot<T>(
  version: WorkbenchVersion,
  fn: (root: string) => Promise<T>,
): Promise<T> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-version-source-"));
  try {
    await writeSurfaceFiles(tempRoot, version.files);
    return await fn(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function writeSurfaceFile(root: string, file: SurfaceSnapshotFile): Promise<void> {
  const target = safeJoin(root, file.path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, file.content, file.encoding === "base64" ? "base64" : "utf8");
  await fs.chmod(target, file.executable === true ? 0o755 : 0o644);
}

function surfaceFileFromBuffer(
  filePath: string,
  content: Buffer,
  executable: boolean,
): SurfaceSnapshotFile {
  const text = decodeUtf8Text(content);
  if (text !== null) {
    return {
      path: filePath,
      kind: "text",
      encoding: "utf8",
      content: text,
      executable,
    };
  }
  return {
    path: filePath,
    kind: "binary",
    encoding: "base64",
    content: content.toString("base64"),
    executable,
  };
}

function decodeUtf8Text(content: Buffer): string | null {
  try {
    const text = UTF8_DECODER.decode(content);
    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  }
}

function selectActiveEvalSnapshot(state: WorkbenchProjectState): WorkbenchEvalSnapshot | undefined {
  const recentRun = [...state.runs]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .find((run) => state.evals.some((evalSnapshot) => evalSnapshot.hash === run.evalHash));
  return recentRun
    ? state.evals.find((evalSnapshot) => evalSnapshot.hash === recentRun.evalHash)
    : state.evals[0];
}

function resolveRemote(state: WorkbenchProjectState, name?: string): WorkbenchRemote {
  if (!name) {
    const origin = state.remotes.origin;
    if (origin) {
      return origin;
    }
    const remotes = Object.values(state.remotes);
    if (remotes.length === 1) {
      return remotes[0]!;
    }
    if (remotes.length === 0) {
      throw new WorkbenchCodedError("remote_required", "No remotes are configured.", {
        remediation: "Run workbench remote add --name origin --url https://HOST/skills/OWNER/SKILL.",
        exitCode: 2,
      });
    }
    throw new WorkbenchCodedError("remote_required", "Multiple remotes are configured and none is named origin; name the remote to use.", {
      remediation: "Run workbench remote list.",
      subject: { remotes: remotes.map((entry) => entry.name) },
      exitCode: 2,
    });
  }
  const remoteName = name;
  const remote = state.remotes[remoteName];
  if (!remote) {
    throw new WorkbenchCodedError("remote_not_found", `Remote not found: ${remoteName}`, {
      remediation: "Run workbench remote list.",
      subject: { remote: remoteName },
      exitCode: 1,
    });
  }
  return remote;
}

function validateRemoteName(name: string): string {
  const trimmed = name.trim();
  if (!/^[a-z][a-z0-9-]*$/u.test(trimmed)) {
    throw new WorkbenchCodedError("remote_invalid_name", `Workbench remote name must be a lowercase identifier: ${name}`, {
      remediation: "Use lowercase letters, numbers, and hyphens, starting with a letter.",
      subject: { remote: name },
      exitCode: 2,
    });
  }
  return trimmed;
}

function resolveVersion(state: WorkbenchProjectState, ref: string): WorkbenchVersion {
  const version = findVersion(state, ref);
  if (!version) {
    throw new WorkbenchUserError(`Version not found: ${ref}`);
  }
  return version;
}

function findVersion(state: WorkbenchProjectState, ref: string): WorkbenchVersion | undefined {
  const normalized = ref.trim();
  const mapped = normalized === "current" ? state.refs.current : state.refs[normalized] ?? normalized;
  return state.versions.find((version) =>
    version.id === mapped ||
    version.hash === mapped ||
    version.hash.startsWith(mapped ?? "")
  );
}

function findVersionById(state: WorkbenchProjectState, id: string | undefined): WorkbenchVersion | undefined {
  return id ? state.versions.find((version) => version.id === id) : undefined;
}

function latestScoredRun(args: {
  runs: readonly WorkbenchRun[];
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
}): WorkbenchRun | undefined {
  return latestMatchingRun(args, (run) => typeof run.score === "number");
}

function latestComparableRun(args: {
  runs: readonly WorkbenchRun[];
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
}): WorkbenchRun | undefined {
  return latestMatchingRun(args);
}

function latestMatchingRun(
  args: {
    runs: readonly WorkbenchRun[];
    versionId: string;
    skillName: string;
    skillBundleHash: string;
    evalHash: string;
    agentName: string;
    agentHash: string;
  },
  predicate: (run: WorkbenchRun) => boolean = () => true,
): WorkbenchRun | undefined {
  return args.runs
    .filter((run) =>
      run.versionId === args.versionId &&
      run.skillName === args.skillName &&
      run.skillBundleHash === args.skillBundleHash &&
      run.evalHash === args.evalHash &&
      run.agentName === args.agentName &&
      run.agentHash === args.agentHash &&
      predicate(run)
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function comparisonEntryKey(
  versionId: string,
  skillName: string,
  skillBundleHash: string,
  evalHash: string,
): string {
  return `${versionId}\0${skillName}\0${skillBundleHash}\0${evalHash}`;
}

function comparisonCellRunFields(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
): Pick<WorkbenchComparisonCell, "runId" | "status" | "score" | "costUsd" | "latencyMs" | "error"> {
  return {
    runId: run.id,
    status: run.status,
    ...(run.score !== undefined ? { score: run.score } : {}),
    ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
    ...(run.latencyMs !== undefined ? { latencyMs: run.latencyMs } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

function skillSelectionIncludes(
  selection: string | undefined,
  skillName: string,
  skillBundleHash: string,
): boolean {
  const trimmed = selection?.trim();
  if (!trimmed || trimmed === "all") {
    return true;
  }
  return trimmed.split(",").some((part) => {
    const requested = part.trim();
    return requested === skillName || skillBundleHash.startsWith(requested);
  });
}

function uniqueSkillBundles(
  bundles: readonly WorkbenchSkillBundleSnapshot[],
): WorkbenchSkillBundleSnapshot[] {
  const byHash = new Map<string, WorkbenchSkillBundleSnapshot>();
  for (const bundle of bundles) {
    if (!byHash.has(bundle.hash)) {
      byHash.set(bundle.hash, copySkillBundle(bundle));
    }
  }
  return [...byHash.values()];
}

function resolveComparisonAgentsForVersionFromState(
  state: WorkbenchProjectState,
  version: WorkbenchVersion,
  selection: string | undefined,
): WorkbenchAgentSnapshot[] {
  const trimmed = selection?.trim();
  const selected = !trimmed || trimmed === "all"
    ? null
    : new Set(trimmed.split(",").map((part) => part.trim()).filter(Boolean));
  const agents = new Map<string, WorkbenchAgentSnapshot>();

  for (const agent of readVersionAgents(version)) {
    const snapshot = agentSnapshot(agent);
    if (selected && !selected.has(agent.name) && !selected.has(snapshot.hash)) {
      continue;
    }
    agents.set(snapshot.hash, snapshot);
  }

  for (const run of state.runs) {
    if (run.versionId !== version.id) {
      continue;
    }
    if (selected && !selected.has(run.agentName) && !selected.has(run.agentHash)) {
      continue;
    }
    if (agents.has(run.agentHash)) {
      continue;
    }
    agents.set(run.agentHash, {
      hash: run.agentHash,
      agent: {
        name: run.agentName,
        adapter: "recorded",
        config: {},
      },
    });
  }

  if (agents.size === 0) {
    for (const agent of state.agents) {
      const snapshot = agentSnapshot(agent);
      if (selected && !selected.has(agent.name) && !selected.has(snapshot.hash)) {
        continue;
      }
      agents.set(snapshot.hash, snapshot);
    }
  }

  return [...agents.values()].sort((left, right) =>
    left.agent.name.localeCompare(right.agent.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }) || left.hash.localeCompare(right.hash)
  );
}

function readVersionAgents(version: WorkbenchVersion): WorkbenchAgent[] {
  const agentFile = version.files.find((file) =>
    normalizeRelativePath(file.path) === `${WORKBENCH_DIR}/${AGENTS_FILE}` &&
    file.encoding === "utf8"
  );
  if (!agentFile) {
    return [];
  }
  return parseAgentsYaml(agentFile.content, `${version.id}:${WORKBENCH_DIR}/${AGENTS_FILE}`);
}

function latestReusableEvalRun(args: {
  state: WorkbenchProjectState;
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
  samples: number;
  caseCount: number;
}): WorkbenchRun | undefined {
  const expectedJobs = args.caseCount * Math.max(1, Math.floor(args.samples));
  if (expectedJobs <= 0) {
    return undefined;
  }
  return args.state.runs
    .filter((run) =>
      run.kind === "eval" &&
      !run.parentRunId &&
      run.versionId === args.versionId &&
      run.skillName === args.skillName &&
      run.skillBundleHash === args.skillBundleHash &&
      run.evalHash === args.evalHash &&
      run.agentName === args.agentName &&
      run.agentHash === args.agentHash &&
      run.status !== "running" &&
      (run.jobIds?.length ?? 0) === expectedJobs &&
      run.jobIds?.every((jobId) => {
        const job = args.state.jobs.find((entry) => entry.id === jobId);
        return job?.runId === run.id &&
          job.versionId === args.versionId &&
          job.skillName === args.skillName &&
          job.skillBundleHash === args.skillBundleHash &&
          job.evalHash === args.evalHash &&
          job.agentName === args.agentName &&
          job.agentHash === args.agentHash;
      })
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function improvementPromotionDecision(
  run: WorkbenchRun,
  incumbentRun: WorkbenchRun | undefined,
): { promoted: boolean; reason: string } {
  if (run.status !== "succeeded") {
    return {
      promoted: false,
      reason: `Improved run ${run.id} finished ${run.status}.`,
    };
  }
  if (typeof run.score !== "number") {
    return {
      promoted: false,
      reason: `Improved run ${run.id} has no scored eval evidence.`,
    };
  }
  if (!incumbentRun || typeof incumbentRun.score !== "number") {
    return {
      promoted: true,
      reason: `Improved run ${run.id} succeeded with score ${run.score.toFixed(3)} and no scored incumbent existed.`,
    };
  }
  if (run.score <= incumbentRun.score) {
    return {
      promoted: false,
      reason: `Improved run ${run.id} score ${run.score.toFixed(3)} did not beat incumbent ${incumbentRun.id} score ${incumbentRun.score.toFixed(3)}.`,
    };
  }
  return {
    promoted: true,
    reason: `Improved run ${run.id} score ${run.score.toFixed(3)} beat incumbent ${incumbentRun.id} score ${incumbentRun.score.toFixed(3)}.`,
  };
}

function diffFiles(left: readonly SurfaceSnapshotFile[], right: readonly SurfaceSnapshotFile[]): WorkbenchDiffEntry[] {
  const leftMap = new Map(left.map((file) => [file.path, file]));
  const rightMap = new Map(right.map((file) => [file.path, file]));
  const paths = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort();
  const diffs: WorkbenchDiffEntry[] = [];
  for (const filePath of paths) {
    const before = leftMap.get(filePath);
    const after = rightMap.get(filePath);
    if (!before && after) {
      diffs.push({ path: filePath, status: "added", after: after.content });
    } else if (before && !after) {
      diffs.push({ path: filePath, status: "removed", before: before.content });
    } else if (before && after && before.content !== after.content) {
      diffs.push({ path: filePath, status: "modified", before: before.content, after: after.content });
    }
  }
  return diffs;
}

function installableSkillFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  return files
    .filter((file) => !file.path.split("/").some((part) => part === WORKBENCH_DIR))
    .map(copyFile)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function installablePrimarySkillFiles(
  files: readonly SurfaceSnapshotFile[],
  primarySource: WorkbenchSkillSource,
  sources: readonly WorkbenchSkillSource[],
): SurfaceSnapshotFile[] {
  const excludedLocalSourcePaths = sources
    .filter((source) =>
      source.name !== primarySource.name &&
      source.kind === "local" &&
      source.path &&
      source.path !== "."
    )
    .map((source) => normalizeRelativePath(source.path!));
  return installableSkillFiles(files)
    .filter((file) => !excludedLocalSourcePaths.some((prefix) =>
      file.path === prefix || file.path.startsWith(`${prefix}/`)
    ));
}

function versionIdForHash(hash: string): string {
  return `v_${hash}`;
}

function nextRunId(): string {
  return nextObjectId("run");
}

function nextJobId(): string {
  return nextObjectId("job");
}

function nextArtifactId(): string {
  return nextObjectId("artifact");
}

function nextObjectId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(8).toString("hex")}`;
}

function compareVersionIds(left: WorkbenchVersion, right: WorkbenchVersion): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function splitObjectPath(ref: string): [string, string | null] {
  const colon = ref.indexOf(":");
  return colon === -1 ? [ref, null] : [ref.slice(0, colon), ref.slice(colon + 1)];
}

function upsertById<T extends { id: string }>(records: T[], record: T): void {
  const index = records.findIndex((entry) => entry.id === record.id);
  if (index >= 0) {
    records[index] = record;
  } else {
    records.push(record);
  }
}

function upsertByHash<T extends { hash: string }>(records: T[], record: T): void {
  const index = records.findIndex((entry) => entry.hash === record.hash);
  if (index >= 0) {
    records[index] = record;
  } else {
    records.push(record);
  }
}

function upsertByName<T extends { name: string }>(records: T[], record: T): void {
  const index = records.findIndex((entry) => entry.name === record.name);
  if (index >= 0) {
    records[index] = record;
  } else {
    records.push(record);
  }
}

function upsertAgentSnapshots(records: WorkbenchAgent[], agents: readonly WorkbenchAgent[]): void {
  for (const agent of agents) {
    upsertImmutableByContentHash(records, copyAgent(agent), "agent");
  }
}

function upsertEvalSnapshotObject(records: WorkbenchEvalSnapshot[], record: WorkbenchEvalSnapshot): void {
  const index = records.findIndex((entry) => entry.hash === record.hash);
  if (index >= 0) {
    records[index] = mergeWorkbenchEvalSnapshots(records[index]!, record);
  } else {
    records.push(copyEval(record));
  }
}

export function mergeWorkbenchEvalSnapshots(
  existing: WorkbenchEvalSnapshot,
  incoming: WorkbenchEvalSnapshot,
): WorkbenchEvalSnapshot {
  if (existing.hash !== incoming.hash) {
    throw new WorkbenchUserError(`Workbench object conflict for eval ${incoming.hash}; sync the remote state before creating a divergent object id.`);
  }
  const incomingComparable = comparableEvalSnapshot(incoming);
  const existingComparable = comparableEvalSnapshot(existing);
  if (hashFiles(existingComparable.files) !== existing.hash) {
    throw new WorkbenchUserError(`Workbench eval ${existing.hash} files do not match its object id.`);
  }
  if (hashFiles(incomingComparable.files) !== incoming.hash) {
    throw new WorkbenchUserError(`Workbench eval ${incoming.hash} files do not match its object id.`);
  }
  assertImmutableObjectCompatible(
    existingComparable,
    incomingComparable,
    `eval ${incoming.hash}`,
  );
  const createdAt = earliestTimestamp(existing.createdAt, incoming.createdAt);
  const updatedAt = latestTimestamp(existing.updatedAt, incoming.updatedAt);
  return {
    ...copyEval(incoming),
    createdAt,
    updatedAt,
  };
}

function comparableEvalSnapshot(evalSnapshot: WorkbenchEvalSnapshot): Pick<WorkbenchEvalSnapshot, "hash" | "files"> {
  return {
    hash: evalSnapshot.hash,
    files: evalSnapshot.files.map(copyFile).sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function earliestTimestamp(left: string, right: string): string {
  const leftTime = timestampMs(left);
  const rightTime = timestampMs(right);
  if (leftTime !== null && rightTime !== null) {
    return leftTime <= rightTime ? left : right;
  }
  if (leftTime !== null) {
    return left;
  }
  return right;
}

function latestTimestamp(left: string, right: string): string {
  const leftTime = timestampMs(left);
  const rightTime = timestampMs(right);
  if (leftTime !== null && rightTime !== null) {
    return leftTime >= rightTime ? left : right;
  }
  if (leftTime !== null) {
    return left;
  }
  return right;
}

function timestampMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function upsertImmutableById<T extends { id: string }>(records: T[], record: T, label: string): void {
  const index = records.findIndex((entry) => entry.id === record.id);
  if (index >= 0) {
    assertImmutableObjectCompatible(records[index]!, record, `${label} ${record.id}`);
    records[index] = record;
  } else {
    records.push(record);
  }
}

function upsertRunObject(records: WorkbenchRun[], run: WorkbenchRun): void {
  const index = records.findIndex((entry) => entry.id === run.id);
  if (index < 0) {
    records.push(run);
    return;
  }
  const existing = records[index]!;
  if (hashJson(existing) === hashJson(run)) {
    records[index] = run;
    return;
  }
  const existingTerminal = isTerminalRunStatus(existing.status);
  const incomingTerminal = isTerminalRunStatus(run.status);
  if (existingTerminal && !incomingTerminal) {
    return;
  }
  assertLifecycleIdentityCompatible(existing, run, "run", run.id, runLifecycleIdentity);
  if (!existingTerminal && incomingTerminal) {
    records[index] = run;
    return;
  }
  if (!existingTerminal && !incomingTerminal) {
    records[index] = mergeRunningRun(existing, run);
    return;
  }
  throw new WorkbenchUserError(`Workbench object conflict for run ${run.id}; sync the remote state before creating a divergent object id.`);
}

function upsertJobObject(records: WorkbenchJob[], job: WorkbenchJob): void {
  const index = records.findIndex((entry) => entry.id === job.id);
  if (index < 0) {
    records.push(job);
    return;
  }
  const existing = records[index]!;
  if (hashJson(existing) === hashJson(job)) {
    records[index] = job;
    return;
  }
  const existingTerminal = isTerminalJobStatus(existing.status);
  const incomingTerminal = isTerminalJobStatus(job.status);
  if (existingTerminal && !incomingTerminal) {
    return;
  }
  assertLifecycleIdentityCompatible(existing, job, "job", job.id, jobLifecycleIdentity);
  if (!existingTerminal && incomingTerminal) {
    records[index] = job;
    return;
  }
  if (!existingTerminal && !incomingTerminal) {
    records[index] = mergeRunningJob(existing, job);
    return;
  }
  throw new WorkbenchUserError(`Workbench object conflict for job ${job.id}; sync the remote state before creating a divergent object id.`);
}

function upsertExecutionEventBatch(records: WorkbenchExecutionEventBatch[], batch: WorkbenchExecutionEventBatch): void {
  const id = workbenchExecutionEventBatchId(batch);
  const index = records.findIndex((entry) => workbenchExecutionEventBatchId(entry) === id);
  if (index < 0) {
    records.push(batch);
    return;
  }
  const existing = records[index]!;
  if (hashJson(existing) === hashJson(batch)) {
    records[index] = batch;
    return;
  }
  throw new WorkbenchUserError(`Workbench object conflict for execution event batch ${id}; sync the remote state before creating divergent progress evidence.`);
}

function assertLifecycleIdentityCompatible<T>(
  existing: T,
  incoming: T,
  label: string,
  id: string,
  identity: (record: T) => unknown,
): void {
  if (hashJson(identity(existing)) !== hashJson(identity(incoming))) {
    throw new WorkbenchUserError(`Workbench object conflict for ${label} ${id}; sync the remote state before creating a divergent object id.`);
  }
}

function isTerminalRunStatus(status: WorkbenchRun["status"]): boolean {
  return status !== "running";
}

function isTerminalJobStatus(status: WorkbenchJob["status"]): boolean {
  return status !== "queued" && status !== "running";
}

function runLifecycleIdentity(run: WorkbenchRun): unknown {
  return {
    id: run.id,
    kind: run.kind,
    versionId: run.versionId,
    skillName: run.skillName,
    skillBundleHash: run.skillBundleHash,
    evalHash: run.evalHash,
    agentName: run.agentName,
    agentHash: run.agentHash,
    createdAt: run.createdAt,
    parentRunId: run.parentRunId,
  };
}

function jobLifecycleIdentity(job: WorkbenchJob): unknown {
  const extra = asRecord(job);
  return {
    id: job.id,
    runId: job.runId,
    kind: job.kind,
    versionId: job.versionId,
    skillName: job.skillName,
    skillBundleHash: job.skillBundleHash,
    evalHash: job.evalHash,
    agentName: job.agentName,
    agentHash: job.agentHash,
    caseId: job.caseId,
    sample: job.sample,
    command: job.command,
    dockerImage: job.dockerImage,
    purpose: extra?.purpose,
    improvementTraceIds: extra?.improvementTraceIds,
    improvementSamples: extra?.improvementSamples,
  };
}

function mergeRunningRun(existing: WorkbenchRun, incoming: WorkbenchRun): WorkbenchRun {
  return {
    ...existing,
    ...incoming,
    jobIds: Array.from(new Set([...(existing.jobIds ?? []), ...(incoming.jobIds ?? [])])),
    traceIds: Array.from(new Set([...existing.traceIds, ...incoming.traceIds])),
  };
}

function mergeRunningJob(existing: WorkbenchJob, incoming: WorkbenchJob): WorkbenchJob {
  return {
    ...existing,
    ...incoming,
    artifactIds: Array.from(new Set([...existing.artifactIds, ...incoming.artifactIds])),
    traceIds: Array.from(new Set([...existing.traceIds, ...incoming.traceIds])),
  };
}

function upsertVersionObject(
  state: WorkbenchProjectState,
  version: WorkbenchVersion,
): void {
  const index = state.versions.findIndex((entry) => entry.id === version.id);
  if (index < 0) {
    state.versions.push(version);
    return;
  }
  const existing = state.versions[index]!;
  if (hashJson(existing) === hashJson(version)) {
    state.versions[index] = version;
    return;
  }
  if (sameVersionSource(existing, version)) {
    state.versions[index] = mergeVersionMetadata(existing, version);
    return;
  }
  throw new WorkbenchUserError(`Workbench object conflict for version ${version.id}; sync the remote state before creating a divergent object id.`);
}

function sameVersionSource(left: WorkbenchVersion, right: WorkbenchVersion): boolean {
  return left.id === right.id &&
    left.hash === right.hash &&
    hashFiles(left.files) === hashFiles(right.files);
}

function mergeVersionMetadata(existing: WorkbenchVersion, incoming: WorkbenchVersion): WorkbenchVersion {
  return {
    ...existing,
    parentIds: Array.from(new Set([...existing.parentIds, ...incoming.parentIds])).sort(),
    createdAt: existing.createdAt <= incoming.createdAt ? existing.createdAt : incoming.createdAt,
    message: existing.message || incoming.message,
  };
}

function upsertLineageObject(
  state: WorkbenchProjectState,
  edge: WorkbenchLineageEdge,
): void {
  const index = state.lineage.findIndex((entry) =>
    entry.parentId === edge.parentId &&
    entry.childId === edge.childId &&
    entry.reason === edge.reason
  );
  if (index < 0) {
    state.lineage.push({ ...edge });
    return;
  }
  const existing = state.lineage[index]!;
  if (hashJson(existing) === hashJson(edge)) {
    state.lineage[index] = { ...edge };
    return;
  }
  throw new WorkbenchUserError(`Workbench object conflict for lineage ${edge.parentId}->${edge.childId}; sync the remote state before creating a divergent object id.`);
}

function upsertImmutableByHash<T extends { hash: string }>(records: T[], record: T, label: string): void {
  const index = records.findIndex((entry) => entry.hash === record.hash);
  if (index >= 0) {
    assertImmutableObjectCompatible(records[index]!, record, `${label} ${record.hash}`);
    records[index] = record;
  } else {
    records.push(record);
  }
}

function upsertImmutableByContentHash<T>(records: T[], record: T, label: string): void {
  const hash = hashJson(record);
  const index = records.findIndex((entry) => hashJson(entry) === hash);
  if (index >= 0) {
    assertImmutableObjectCompatible(records[index]!, record, `${label} ${hash}`);
    records[index] = record;
  } else {
    records.push(record);
  }
}

function upsertSkillBundleObject(records: WorkbenchSkillBundleSnapshot[], record: WorkbenchSkillBundleSnapshot): void {
  const index = records.findIndex((entry) => entry.hash === record.hash);
  if (index < 0) {
    records.push(record);
    return;
  }
  assertImmutableObjectCompatible(
    comparableSkillBundle(records[index]!),
    comparableSkillBundle(record),
    `skill bundle ${record.hash}`,
  );
}

function comparableSkillBundle(bundle: WorkbenchSkillBundleSnapshot): Omit<WorkbenchSkillBundleSnapshot, "createdAt"> {
  const { createdAt: _createdAt, ...comparable } = bundle;
  return comparable;
}

function assertImmutableObjectCompatible(existing: unknown, incoming: unknown, label: string): void {
  if (hashJson(existing) !== hashJson(incoming)) {
    throw new WorkbenchUserError(`Workbench object conflict for ${label}; sync the remote state before creating a divergent object id.`);
  }
}

async function requireInitialized(root: string): Promise<void> {
  if (!await exists(workbenchDir(root))) {
    throw new WorkbenchUserError("Workbench is not initialized here. Run `workbench init` first.");
  }
}

function resolveRoot(dir?: string): string {
  return path.resolve(dir ?? process.cwd());
}

function workbenchDir(root: string): string {
  return path.join(root, WORKBENCH_DIR);
}

function objectsDir(root: string): string {
  return path.join(workbenchDir(root), OBJECTS_DIR);
}

function objectTypeDir(root: string, type: string): string {
  return path.join(objectsDir(root), type);
}

function refsDir(root: string): string {
  return path.join(workbenchDir(root), REFS_DIR);
}

function syncDir(root: string): string {
  return path.join(workbenchDir(root), SYNC_DIR);
}

function projectLockDir(root: string): string {
  return path.join(workbenchDir(root), LOCKS_DIR, PROJECT_LOCK_DIR);
}

function stateBackupDir(root: string, name: string): string {
  return path.join(workbenchDir(root), TMP_DIR, `${name}.previous`);
}

function remoteSyncStateFile(root: string, remoteName: string): string {
  return path.join(syncDir(root), `${safeObjectFileName(remoteName)}.json`);
}

async function writeRemoteSyncState(root: string, state: WorkbenchRemoteSyncState): Promise<void> {
  await fs.mkdir(syncDir(root), { recursive: true });
  await writeJson(remoteSyncStateFile(root, state.remote), state);
}

async function readRemoteSyncStates(root: string): Promise<WorkbenchRemoteSyncState[]> {
  try {
    const entries = await fs.readdir(syncDir(root), { withFileTypes: true });
    const states = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => parseRemoteSyncState(await readJson(path.join(syncDir(root), entry.name)))));
    return states.filter((entry): entry is WorkbenchRemoteSyncState => Boolean(entry));
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function pendingSyncCount(root: string): Promise<number> {
  return (await readRemoteSyncStates(root)).filter((state) => state.status === "error").length;
}

function parseRemoteSyncState(value: unknown): WorkbenchRemoteSyncState | null {
  const record = asRecord(value);
  if (
    record?.schema !== "workbench.remote-sync-state.v1" ||
    typeof record.remote !== "string" ||
    typeof record.url !== "string" ||
    (record.status !== "synced" && record.status !== "error") ||
    typeof record.lastAttemptAt !== "string"
  ) {
    return null;
  }
  const lastError = asRecord(record.lastError);
  return {
    schema: "workbench.remote-sync-state.v1",
    remote: record.remote,
    url: record.url,
    status: record.status,
    ...(typeof record.lastSyncedAt === "string" ? { lastSyncedAt: record.lastSyncedAt } : {}),
    lastAttemptAt: record.lastAttemptAt,
    lastError: lastError && typeof lastError.code === "string" && typeof lastError.message === "string"
      ? { code: lastError.code, message: lastError.message }
      : null,
    ...(typeof record.pushed === "number" ? { pushed: record.pushed } : {}),
    ...(typeof record.pulled === "number" ? { pulled: record.pulled } : {}),
  };
}

function syncErrorRecord(error: unknown): { code: string; message: string } {
  const coded = codedErrorFromUnknown(error, "sync_failed");
  return {
    code: coded.code === "internal" || coded.code === "usage" ? "sync_failed" : coded.code,
    message: coded.message,
  };
}

function syncFailureError(error: unknown, remote: WorkbenchRemote): unknown {
  if (error instanceof WorkbenchCodedError || error instanceof WorkbenchUserError) {
    return error;
  }
  const code = fileErrorCode(error);
  if (code) {
    return new WorkbenchCodedError("sync_failed", syncFailureMessage(error, remote), {
      subject: { remote: remote.name, url: remote.url, fsCode: code },
      exitCode: 1,
    });
  }
  return error;
}

function syncFailureMessage(error: unknown, remote: WorkbenchRemote): string {
  const code = fileErrorCode(error);
  if (remote.kind === "file" && (code === "ENOTDIR" || code === "EEXIST")) {
    return "Remote file store path is not a directory.";
  }
  return error instanceof Error ? error.message : String(error);
}

function remotesFile(root: string): string {
  return path.join(workbenchDir(root), REMOTES_FILE);
}

function workbenchLocalMetadataIgnoreContent(): string {
  return [
    `/${WORKBENCH_GITIGNORE_FILE}`,
    `/${REMOTES_FILE}`,
    `/${OBJECTS_DIR}/`,
    `/${REFS_DIR}/`,
    `/${SYNC_DIR}/`,
    `/${TMP_DIR}/`,
    `/${LOGS_DIR}/`,
    `/${LOCKS_DIR}/`,
    "",
  ].join("\n");
}

async function ensureWorkbenchLocalMetadataIgnore(root: string): Promise<void> {
  if (!await exists(workbenchDir(root))) {
    return;
  }
  await ensureFile(path.join(workbenchDir(root), WORKBENCH_GITIGNORE_FILE), workbenchLocalMetadataIgnoreContent());
}

function safeObjectFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "_") || "object";
}

async function ensureFile(filePath: string, content: string): Promise<void> {
  if (await exists(filePath)) {
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function exists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then(() => true, () => false);
}

function fileErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" ? code : undefined;
}

function safeJoin(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath);
  const resolvedRoot = path.resolve(root);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new WorkbenchUserError(`Path escapes skill root: ${relativePath}`);
  }
  return target;
}

function textFile(filePath: string, content: string): SurfaceSnapshotFile {
  return {
    path: filePath,
    kind: "text",
    encoding: "utf8",
    content,
    executable: false,
  };
}

function copyFile(file: SurfaceSnapshotFile): SurfaceSnapshotFile {
  return normalizeSurfaceSnapshotFile(file);
}

function normalizeSurfaceSnapshotFile(file: SurfaceSnapshotFile): SurfaceSnapshotFile {
  const encoding = file.encoding ?? "utf8";
  return {
    path: file.path,
    kind: file.kind ?? (encoding === "base64" ? "binary" : "text"),
    encoding,
    content: file.content,
    executable: file.executable === true,
  };
}

function copyVersion(version: WorkbenchVersion): WorkbenchVersion {
  return {
    ...version,
    parentIds: [...version.parentIds],
    files: version.files.map(copyFile),
  };
}

function copyEval(evalSnapshot: WorkbenchEvalSnapshot): WorkbenchEvalSnapshot {
  return {
    ...evalSnapshot,
    files: evalSnapshot.files.map(copyFile),
  };
}

function copySkillInclude(include: WorkbenchSkillInclude): WorkbenchSkillInclude {
  return {
    ...include,
    ...(include.files ? { files: include.files.map(copyFile) } : {}),
  };
}

function copySkillSource(source: WorkbenchSkillSource): WorkbenchSkillSource {
  return {
    ...source,
    ...(source.includes ? { includes: source.includes.map(copySkillInclude) } : {}),
  };
}

function copySkillBundle(bundle: WorkbenchSkillBundleSnapshot): WorkbenchSkillBundleSnapshot {
  return {
    ...bundle,
    source: copySkillSource(bundle.source),
    files: bundle.files.map(copyFile),
    includedSkills: bundle.includedSkills.map(copySkillInclude),
  };
}

function copyAgent(agent: WorkbenchAgent): WorkbenchAgent {
  return {
    ...agent,
    config: { ...agent.config },
  };
}

function agentSnapshot(agent: WorkbenchAgent): WorkbenchAgentSnapshot {
  return {
    hash: hashJson(agent),
    agent: copyAgent(agent),
  };
}

function uniqueAgentSnapshots(agents: readonly WorkbenchAgent[]): WorkbenchAgentSnapshot[] {
  const byHash = new Map<string, WorkbenchAgentSnapshot>();
  for (const agent of agents) {
    const snapshot = agentSnapshot(agent);
    byHash.set(snapshot.hash, snapshot);
  }
  return [...byHash.values()].sort((left, right) =>
    left.agent.name.localeCompare(right.agent.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }) || left.hash.localeCompare(right.hash)
  );
}

function uniqueResolvedAgentSnapshots(agents: readonly WorkbenchAgentSnapshot[]): WorkbenchAgentSnapshot[] {
  const byHash = new Map<string, WorkbenchAgentSnapshot>();
  for (const agent of agents) {
    byHash.set(agent.hash, {
      hash: agent.hash,
      agent: copyAgent(agent.agent),
    });
  }
  return [...byHash.values()].sort((left, right) =>
    left.agent.name.localeCompare(right.agent.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }) || left.hash.localeCompare(right.hash)
  );
}

function copyRun(run: WorkbenchRun): WorkbenchRun {
  return {
    ...run,
    ...(run.jobIds ? { jobIds: [...run.jobIds] } : {}),
    traceIds: [...run.traceIds],
  };
}

function copyJob(job: WorkbenchJob): WorkbenchJob {
  return {
    ...job,
    artifactIds: [...job.artifactIds],
    traceIds: [...job.traceIds],
  };
}

function copyTrace(trace: WorkbenchTrace): WorkbenchTrace {
  return {
    ...trace,
    files: trace.files.map(copyFile),
  };
}

function copyExecutionEventBatch(batch: WorkbenchExecutionEventBatch): WorkbenchExecutionEventBatch {
  return JSON.parse(JSON.stringify(batch)) as WorkbenchExecutionEventBatch;
}

function copyArtifact(artifact: WorkbenchArtifact): WorkbenchArtifact {
  return {
    ...artifact,
    files: artifact.files.map(copyFile),
  };
}

function copyStateForRoot(state: WorkbenchProjectState, root: string): WorkbenchProjectState {
  return {
    schema: STATE_SCHEMA,
    root,
    refs: { ...state.refs },
    remotes: Object.fromEntries(Object.entries(state.remotes).map(([name, remote]) => [name, { ...remote }])),
    versions: state.versions.map(copyVersion),
    skillSources: state.skillSources.map(copySkillSource),
    skillBundles: state.skillBundles.map(copySkillBundle),
    evals: state.evals.map((entry) => ({ ...entry, files: entry.files.map(copyFile) })),
    agents: state.agents.map(copyAgent),
    runs: state.runs.map(copyRun),
    jobs: state.jobs.map(copyJob),
    traces: state.traces.map(copyTrace),
    executionEvents: state.executionEvents.map(copyExecutionEventBatch),
    artifacts: state.artifacts.map(copyArtifact),
    lineage: state.lineage.map((entry) => ({ ...entry })),
  };
}

function now(): string {
  return new Date().toISOString();
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, "") || "skill";
}

function parseYamlRecord(source: string): Record<string, unknown> {
  const parsed = source.trim() ? YAML.parse(source) : {};
  return asRecord(parsed) ?? {};
}

function isCaseDescriptorPath(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return base === "case.yaml" || base === "case.yml" || base.endsWith(".case.yaml") ||
    base.endsWith(".case.yml") || (/\.ya?ml$/u.test(base) && !filePath.includes("/"));
}

function parseCaseRecord(content: string, casePath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = content.trim() ? YAML.parse(content) : {};
  } catch (error) {
    throw new WorkbenchUserError(
      `Eval case ${casePath} has invalid case YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const record = asRecord(parsed);
  if (content.trim() && !record) {
    throw new WorkbenchUserError(`Eval case ${casePath} case YAML must be a mapping.`);
  }
  return record ?? {};
}

function caseIdFromRecord(record: Record<string, unknown>, fallback: string): string {
  return typeof record.id === "string" && record.id.trim()
    ? record.id.trim()
    : fallback;
}

function caseCommandFromRecord(record: Record<string, unknown>): string | undefined {
  if (typeof record.command === "string" && record.command.trim()) {
    return record.command.trim();
  }
  const run = asRecord(record.run);
  if (typeof run?.command === "string" && run.command.trim()) {
    return run.command.trim();
  }
  return undefined;
}

function caseSmokeFromRecord(record: Record<string, unknown>): boolean {
  return record.smoke === true || record.kind === "smoke";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asStringMap(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(record)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function jsonRecord(value: unknown): Record<string, Json> {
  const record = asRecord(value);
  return record ? Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, toJson(entry)])) : {};
}

function stripSmokeResultScores(result: Record<string, Json>): void {
  delete result.score;
  const metrics = asRecord(result.metrics);
  if (metrics) {
    delete metrics.score;
  }
  if (Array.isArray(result.cases)) {
    for (const entry of result.cases) {
      const caseRecord = asRecord(entry);
      if (!caseRecord) {
        continue;
      }
      delete caseRecord.score;
      const caseMetrics = asRecord(caseRecord.metrics);
      if (caseMetrics) {
        delete caseMetrics.score;
      }
    }
  }
}

function toJson(value: unknown): Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toJson);
  }
  const record = asRecord(value);
  return record ? jsonRecord(record) : null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const record = asRecord(value);
  if (!record) {
    return value;
  }
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeTextFileAtomically(filePath, JSON.stringify(value, null, 2) + "\n");
}

async function writeTextFileAtomically(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
}

async function writeJsonl(filePath: string, values: readonly unknown[]): Promise<void> {
  await writeTextFileAtomically(filePath, values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : ""));
}

async function readJsonl(filePath: string): Promise<unknown[]> {
  if (!await exists(filePath)) {
    return [];
  }
  const lines = (await fs.readFile(filePath, "utf8")).split(/\r?\n/u).filter(Boolean);
  return lines.map((line) => JSON.parse(line) as unknown);
}

function emptyWorkbenchState(root: string): WorkbenchProjectState {
  return {
    schema: STATE_SCHEMA,
    root,
    refs: {},
    remotes: {},
    versions: [],
    skillSources: [],
    skillBundles: [],
    evals: [],
    agents: [],
    runs: [],
    jobs: [],
    traces: [],
    executionEvents: [],
    artifacts: [],
    lineage: [],
  };
}

function readStateArray<T>(value: unknown, pathLabel: string, validate: (entry: unknown, index: number) => void): T[] {
  const values = readRequiredArray(value, pathLabel);
  values.forEach(validate);
  return values as T[];
}

function validateStateVersion(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `versions[${index}]`);
  readRequiredString(record.id, `versions[${index}].id`);
  readRequiredString(record.hash, `versions[${index}].hash`);
  readRequiredString(record.message, `versions[${index}].message`);
  readStringArray(record.parentIds, `versions[${index}].parentIds`);
  readRequiredString(record.createdAt, `versions[${index}].createdAt`);
  validateStateSurfaceFiles(record.files, `versions[${index}].files`);
}

function validateStateEvalSnapshot(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `evals[${index}]`);
  readRequiredString(record.hash, `evals[${index}].hash`);
  validateStateSurfaceFiles(record.files, `evals[${index}].files`);
  readRequiredNumber(record.caseCount, `evals[${index}].caseCount`);
  readRequiredString(record.createdAt, `evals[${index}].createdAt`);
  readRequiredString(record.updatedAt, `evals[${index}].updatedAt`);
  readRequiredString(record.scoreAdapter, `evals[${index}].scoreAdapter`);
}

function validateStateSkillSource(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `skillSources[${index}]`);
  readRequiredString(record.name, `skillSources[${index}].name`);
  readRequiredString(record.kind, `skillSources[${index}].kind`);
  for (const key of ["path", "from", "ref", "resolvedRef", "hash"]) {
    if (record[key] !== undefined) {
      readRequiredString(record[key], `skillSources[${index}].${key}`);
    }
  }
  if (record.includes !== undefined) {
    readRequiredArray(record.includes, `skillSources[${index}].includes`)
      .forEach((entry, includeIndex) => validateStateSkillInclude(entry, `skillSources[${index}].includes[${includeIndex}]`));
  }
}

function validateStateSkillInclude(value: unknown, pathLabel: string): void {
  const record = readRequiredRecord(value, pathLabel);
  readRequiredString(record.name, `${pathLabel}.name`);
  readRequiredString(record.kind, `${pathLabel}.kind`);
  for (const key of ["path", "from", "ref", "resolvedRef", "hash"]) {
    if (record[key] !== undefined) {
      readRequiredString(record[key], `${pathLabel}.${key}`);
    }
  }
  if (record.files !== undefined) {
    validateStateSurfaceFiles(record.files, `${pathLabel}.files`);
  }
}

function validateStateSkillBundle(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `skillBundles[${index}]`);
  readRequiredString(record.hash, `skillBundles[${index}].hash`);
  readRequiredString(record.skillName, `skillBundles[${index}].skillName`);
  readRequiredString(record.entryName, `skillBundles[${index}].entryName`);
  validateStateSkillSource(record.source, index);
  validateStateSurfaceFiles(record.files, `skillBundles[${index}].files`);
  readRequiredArray(record.includedSkills, `skillBundles[${index}].includedSkills`)
    .forEach((entry, includeIndex) => validateStateSkillInclude(entry, `skillBundles[${index}].includedSkills[${includeIndex}]`));
  readRequiredString(record.createdAt, `skillBundles[${index}].createdAt`);
}

function validateStateAgent(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `agents[${index}]`);
  readRequiredString(record.name, `agents[${index}].name`);
  readRequiredString(record.adapter, `agents[${index}].adapter`);
  if (record.model !== undefined) {
    readRequiredString(record.model, `agents[${index}].model`);
  }
  readJsonRecord(record.config, `agents[${index}].config`);
}

function validateStateRun(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `runs[${index}]`);
  for (const key of ["id", "kind", "versionId", "skillName", "skillBundleHash", "evalHash", "agentName", "agentHash", "status", "createdAt"]) {
    readRequiredString(record[key], `runs[${index}].${key}`);
  }
  if (record.score !== undefined) {
    readRequiredNumber(record.score, `runs[${index}].score`);
  }
  if (record.costUsd !== undefined) {
    readRequiredNumber(record.costUsd, `runs[${index}].costUsd`);
  }
  if (record.latencyMs !== undefined) {
    readRequiredNumber(record.latencyMs, `runs[${index}].latencyMs`);
  }
  if (record.jobIds !== undefined) {
    readStringArray(record.jobIds, `runs[${index}].jobIds`);
  }
  readStringArray(record.traceIds, `runs[${index}].traceIds`);
  for (const key of ["finishedAt", "parentRunId", "outputVersionId", "error"]) {
    if (record[key] !== undefined) {
      readRequiredString(record[key], `runs[${index}].${key}`);
    }
  }
}

function validateStateJob(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `jobs[${index}]`);
  for (const key of ["id", "runId", "kind", "versionId", "skillName", "skillBundleHash", "evalHash", "agentName", "agentHash", "caseId", "status", "createdAt"]) {
    readRequiredString(record[key], `jobs[${index}].${key}`);
  }
  readRequiredNumber(record.sample, `jobs[${index}].sample`);
  if (record.score !== undefined) {
    readRequiredNumber(record.score, `jobs[${index}].score`);
  }
  if (record.exitCode !== undefined) {
    readRequiredNumber(record.exitCode, `jobs[${index}].exitCode`);
  }
  if (record.durationMs !== undefined) {
    readRequiredNumber(record.durationMs, `jobs[${index}].durationMs`);
  }
  readStringArray(record.artifactIds, `jobs[${index}].artifactIds`);
  readStringArray(record.traceIds, `jobs[${index}].traceIds`);
  for (const key of ["command", "dockerImage", "startedAt", "finishedAt", "error"]) {
    if (record[key] !== undefined) {
      readRequiredString(record[key], `jobs[${index}].${key}`);
    }
  }
}

function validateStateTrace(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `traces[${index}]`);
  for (const key of ["id", "runId", "versionId", "skillName", "skillBundleHash", "agentName", "createdAt"]) {
    readRequiredString(record[key], `traces[${index}].${key}`);
  }
  if (record.jobId !== undefined) {
    readRequiredString(record.jobId, `traces[${index}].jobId`);
  }
  readRequiredJson(record.request, `traces[${index}].request`);
  readRequiredJson(record.result, `traces[${index}].result`);
  validateStateSurfaceFiles(record.files, `traces[${index}].files`);
}

function validateStateExecutionEventBatch(value: unknown, index: number): void {
  const pathLabel = `executionEvents[${index}]`;
  const record = readRequiredRecord(value, pathLabel);
  for (const key of ["projectId", "runId", "jobId", "executionId", "emittedAt"]) {
    readRequiredString(record[key], `${pathLabel}.${key}`);
  }
  for (const key of ["attempt", "seqStart", "seqEnd"]) {
    readRequiredNumber(record[key], `${pathLabel}.${key}`);
  }
  readRequiredArray(record.events, `${pathLabel}.events`)
    .forEach((entry, eventIndex) => validateStateExecutionEvent(entry, `${pathLabel}.events[${eventIndex}]`));
}

function validateStateExecutionEvent(value: unknown, pathLabel: string): void {
  const record = readRequiredRecord(value, pathLabel);
  readRequiredNumber(record.seq, `${pathLabel}.seq`);
  readRequiredString(record.at, `${pathLabel}.at`);
  const source = readRequiredString(record.source, `${pathLabel}.source`);
  if (source !== "sandbox" && source !== "adapter" && source !== "command") {
    throw new WorkbenchUserError(`Workbench state field ${pathLabel}.source must be sandbox, adapter, or command.`);
  }
  if (record.role !== undefined) {
    const role = readRequiredString(record.role, `${pathLabel}.role`);
    if (role !== "improver" && role !== "runner" && role !== "engine") {
      throw new WorkbenchUserError(`Workbench state field ${pathLabel}.role must be improver, runner, or engine.`);
    }
  }
  const schema = readRequiredString(record.schema, `${pathLabel}.schema`);
  if (schema !== "workbench.execution.step.v1" && schema !== "workbench.trace.delta.v1") {
    throw new WorkbenchUserError(`Workbench state field ${pathLabel}.schema must be a supported execution event schema.`);
  }
  readRequiredJson(record.payload, `${pathLabel}.payload`);
}

function validateStateArtifact(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `artifacts[${index}]`);
  for (const key of ["id", "runId", "jobId", "kind", "path", "createdAt"]) {
    readRequiredString(record[key], `artifacts[${index}].${key}`);
  }
  validateStateSurfaceFiles(record.files, `artifacts[${index}].files`);
}

function validateStateLineageEdge(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `lineage[${index}]`);
  for (const key of ["parentId", "childId", "reason", "createdAt"]) {
    readRequiredString(record[key], `lineage[${index}].${key}`);
  }
  if (!["version", "improve"].includes(record.reason as string)) {
    throw new WorkbenchUserError(`Workbench state field lineage[${index}].reason must be version or improve.`);
  }
  if (record.runId !== undefined) {
    readRequiredString(record.runId, `lineage[${index}].runId`);
  }
  if (record.message !== undefined) {
    readRequiredString(record.message, `lineage[${index}].message`);
  }
}

function validateStateSurfaceFiles(value: unknown, pathLabel: string): void {
  readRequiredArray(value, pathLabel).forEach((entry, index) => {
    const record = readRequiredRecord(entry, `${pathLabel}[${index}]`);
    const filePath = readRequiredString(record.path, `${pathLabel}[${index}].path`);
    try {
      normalizeWorkbenchSourcePath(filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WorkbenchUserError(`Workbench state field ${pathLabel}[${index}].path is invalid: ${message}`);
    }
    readRequiredStringContent(record.content, `${pathLabel}[${index}].content`);
    if (record.kind !== undefined && record.kind !== "text" && record.kind !== "binary") {
      throw new WorkbenchUserError(`Workbench state field ${pathLabel}[${index}].kind must be text or binary.`);
    }
    if (record.encoding !== undefined && record.encoding !== "utf8" && record.encoding !== "base64") {
      throw new WorkbenchUserError(`Workbench state field ${pathLabel}[${index}].encoding must be utf8 or base64.`);
    }
    if (record.executable !== undefined) {
      readRequiredBoolean(record.executable, `${pathLabel}[${index}].executable`);
    }
  });
}

function readJsonRecord(value: unknown, pathLabel: string): Record<string, Json> {
  const record = readRequiredRecord(value, pathLabel);
  for (const [key, entry] of Object.entries(record)) {
    readRequiredJson(entry, `${pathLabel}.${key}`);
  }
  return record as Record<string, Json>;
}

function readRequiredJson(value: unknown, pathLabel: string): Json {
  if (!isJsonPayload(value)) {
    throw new WorkbenchUserError(`Workbench state field ${pathLabel} must be JSON.`);
  }
  return value;
}

function readStringArray(value: unknown, pathLabel: string): string[] {
  return readRequiredArray(value, pathLabel).map((entry, index) =>
    readRequiredString(entry, `${pathLabel}[${index}]`)
  );
}

function readRequiredArray(value: unknown, pathLabel: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new WorkbenchUserError(`Workbench state field ${pathLabel} must be an array.`);
  }
  return value;
}

function readRequiredRecord(value: unknown, pathLabel: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkbenchUserError(`Workbench state field ${pathLabel} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown, pathLabel: string): string {
  if (typeof value !== "string" || !value) {
    throw new WorkbenchUserError(`Workbench state field ${pathLabel} must be a non-empty string.`);
  }
  return value;
}

function readRequiredStringContent(value: unknown, pathLabel: string): string {
  if (typeof value !== "string") {
    throw new WorkbenchUserError(`Workbench state field ${pathLabel} must be a string.`);
  }
  return value;
}

function readRequiredNumber(value: unknown, pathLabel: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WorkbenchUserError(`Workbench state field ${pathLabel} must be a finite number.`);
  }
  return value;
}

function readRequiredBoolean(value: unknown, pathLabel: string): boolean {
  if (typeof value !== "boolean") {
    throw new WorkbenchUserError(`Workbench state field ${pathLabel} must be a boolean.`);
  }
  return value;
}
