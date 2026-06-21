import { AsyncLocalStorage } from "node:async_hooks";
import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify, TextDecoder } from "node:util";
import { gzipSync } from "node:zlib";

import YAML from "yaml";

import {
  isWorkbenchLocalMetadataPath,
  normalizeWorkbenchSkillName,
  normalizeWorkbenchSourcePath,
} from "@workbench-ai/workbench-contract";
import type {
  Json,
  EvalCaseResult,
  RemoteWorkbenchJob,
  SurfaceSnapshotFile,
  WorkbenchArtifact,
  WorkbenchAdapterInvocation,
  WorkbenchAgentSnapshot,
  WorkbenchSkillPatch,
  WorkbenchResults,
  WorkbenchDefaultAgentSelection,
  WorkbenchEvalCaseSnapshot,
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
  WorkbenchActionCapabilities,
  WorkbenchOperationPreview,
  WorkbenchOperationPlanSummary,
  WorkbenchOperationRequest,
  WorkbenchOperationSelection,
  WorkbenchOperationVariant,
  WorkbenchRunSnapshot,
  WorkbenchMeasurementSummary,
  WorkbenchRunPhase,
  WorkbenchStateNotice,
  WorkbenchJob,
  WorkbenchJobDependency,
  WorkbenchJobResult,
  WorkbenchResultItem,
  WorkbenchLineageEdge,
  WorkbenchObjectPack,
  WorkbenchProjectState,
  WorkbenchRefs,
  WorkbenchRemote,
  WorkbenchRemoteSyncState,
  WorkbenchResult,
  WorkbenchRun,
  WorkbenchRunKind,
  WorkbenchRunLocation,
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
  assertDockerSandboxAvailable,
} from "./sandbox-backends/docker.ts";
import {
  abortSignalOrUndefined,
  asRuntimeRecord,
  isJsonPayload,
  normalizeRelativePath,
  quoteShellArg,
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
  advanceLocalWorkbenchLiveState,
  readLocalWorkbenchLiveStateCursor,
  waitForLocalWorkbenchLiveStateNotice,
} from "./local-live-state.ts";
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
  WorkbenchResults,
  WorkbenchDefaultAgentSelection,
  WorkbenchEvalCaseSnapshot,
  WorkbenchEvalSnapshot,
  WorkbenchExecutionEvidence,
  WorkbenchExecutionResult,
  WorkbenchExecutionSpec,
  WorkbenchExecutionTrace,
  WorkbenchExecutionTraceDetail,
  WorkbenchFileSurface,
  WorkbenchInspectionFileContent,
  WorkbenchInspectionFileOwnerKind,
  WorkbenchInspectionSnapshotEnvelope,
  WorkbenchInspectionSnapshot,
  WorkbenchActionCapabilities,
  WorkbenchAcquisitionOption,
  WorkbenchOperationPreview,
  WorkbenchOperationPlanSummary,
  WorkbenchOperationRequest,
  WorkbenchOperationSelection,
  WorkbenchOperationVariant,
  WorkbenchRunSnapshot,
  WorkbenchMeasurementSummary,
  WorkbenchRunPhase,
  WorkbenchStateNotice,
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
  type WorkbenchExecutionDagJobControl,
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

export interface WorkbenchDraftEvalCaseFile {
  path: string;
  content: string;
  executable?: boolean;
}

const DRAFT_CASE_PROMPT_PLACEHOLDER = "Replace this with a representative workflow prompt.";
const DRAFT_CASE_RUBRIC_PLACEHOLDER = "Replace this with observable acceptance criteria.";

export function workbenchDraftEvalCaseFiles(
  caseId = "case-001",
  options: { includeHarness?: boolean } = {},
): WorkbenchDraftEvalCaseFile[] {
  const caseDir = `.workbench/cases/${caseId}`;
  const testDir = `${caseDir}/tests`;
  const casePath = `${caseDir}/case.yaml`;
  const testPath = `${testDir}/test.sh`;
  const placeholderSummary =
    `Draft case ${caseId} still contains placeholder local/command assertions. Provider-backed grading can use ${casePath}; replace ${testPath} before using this case with local or command agents.`;
  const caseLines = [
    "version: 1",
    `id: ${caseId}`,
    `prompt: ${DRAFT_CASE_PROMPT_PLACEHOLDER}`,
    "rubric:",
    `  - ${DRAFT_CASE_RUBRIC_PLACEHOLDER}`,
  ];
  const testLines = [
    "#!/bin/sh",
    "set -eu",
    "mkdir -p \"$OUTPUT_DIR\"",
    `printf '%s\\n' ${quoteShellArg(JSON.stringify({
      ok: false,
      score: 0,
      metrics: { score: 0 },
      summary: placeholderSummary,
    }))} > "$OUTPUT_DIR/result.json"`,
    `printf '%s\\n' ${quoteShellArg(placeholderSummary)} >&2`,
    "exit 1",
  ];
  return [
    { path: casePath, content: `${caseLines.join("\n")}\n` },
    ...(options.includeHarness === false ? [] : [{ path: testPath, content: `${testLines.join("\n")}\n`, executable: true }]),
  ];
}

export function workbenchAuthorEvalCaseCommand(caseId = "case-001"): string {
  return `workbench case draft ${quoteShellArg(caseId)}`;
}

export const WORKBENCH_AUTHOR_EVAL_CASE_COMMAND = workbenchAuthorEvalCaseCommand();

const WORKBENCH_CASE_TEST_MISSING_COMMAND_MESSAGE =
  "Workbench case must define top-level command or include tests/test.sh.";

const WORKBENCH_DEFAULT_CASE_TEST_COMMAND = [
  "mkdir -p \"$OUTPUT_DIR\"",
  "printf '%s\\n' 'Execution completed.' > \"$OUTPUT_DIR/answer.txt\"",
].join(" && ");

export interface WorkbenchCommandOptions {
  dir?: string;
  authToken?: string;
  adapterAuthStoreRoot?: string;
  homeDir?: string;
  env?: Record<string, string | undefined>;
}

export interface WorkbenchInitOptions extends WorkbenchCommandOptions {
  agent?: string;
  model?: string;
  auth?: string;
}

type WorkbenchSelectorCommand = "run" | "grade" | "eval" | "results" | "improve";

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
  location?: WorkbenchRun["location"];
  remoteName?: string;
  retryOfRunId?: string;
  onRunStarted?: (run: WorkbenchRun) => void | Promise<void>;
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
  location?: WorkbenchRun["location"];
  remoteName?: string;
  retryOfRunId?: string;
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
  location?: WorkbenchRun["location"];
  remoteName?: string;
  retryOfRunId?: string;
}

export interface WorkbenchPreparedCloudEvalRequest {
  runId?: string;
  versionId: string;
  skill?: string;
  agent?: string;
  caseIds?: readonly string[];
  samples: number;
  rerun?: boolean;
}

export interface WorkbenchPreparedCloudImproveRequest {
  runId?: string;
  versionId: string;
  skill?: string;
  agent?: string;
  samples: number;
  budget: number;
  evidenceTraceIds?: string[];
}

export interface WorkbenchEvalPreview {
  dryRun: true;
  location: "local" | "cloud";
  versionId: string;
  sourceState?: "committed" | "would_create";
  wouldCreateVersionId?: string;
  evalHash: string;
  skills: Array<{ name: string; hash: string }>;
  agents: Array<{ name: string; hash: string }>;
  cases: number;
  samples: number;
  cachedRunIds: string[];
  cachedJobIds: string[];
  adapterAuthTargets: WorkbenchAdapterAuthTarget[];
  readiness: WorkbenchLaunchReadiness;
}

export interface WorkbenchImprovePreview {
  dryRun: true;
  location: "local" | "cloud";
  versionId: string;
  sourceState?: "committed" | "would_create";
  wouldCreateVersionId?: string;
  evalHash: string;
  skill: { name: string; hash: string };
  agent: { name: string; hash: string };
  evidenceTraceIds: string[];
  evidenceCount: number;
  proofCases: number;
  samples: number;
  budget: number;
  incumbentRunId?: string;
  incumbentScore?: number;
  adapterAuthTargets: WorkbenchAdapterAuthTarget[];
  readiness: WorkbenchLaunchReadiness;
}

export interface WorkbenchLaunchReadiness {
  ready: boolean;
  issues: WorkbenchLaunchReadinessIssue[];
}

export interface WorkbenchLaunchReadinessIssue {
  code: string;
  message: string;
  remediation?: string;
  subject?: Json;
}

export type WorkbenchRunRetryPlan =
  | {
      kind: "eval";
      location: WorkbenchRunLocation;
      remoteName?: string;
      versionId: string;
      skillName: string;
      agentName: string;
      caseIds?: readonly string[];
      samples: number;
      retryOfRunId: string;
    }
  | {
      kind: "improve";
      location: WorkbenchRunLocation;
      remoteName?: string;
      baseVersionId: string;
      skillName: string;
      agentName: string;
      samples: number;
      budget: number;
      retryOfRunId: string;
    };

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
  adapterAuthStoreRoot?: string;
  adapterAuthUpdateSink?: (profiles: readonly WorkbenchAdapterAuthBundle[]) => Promise<void>;
  signal?: AbortSignal;
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
      options.adapterAuthStoreRoot,
    );
    const adapterAuthUpdateSink =
      options.adapterAuthUpdateSink ??
      (options.loadLocalAdapterAuthProfiles
        ? async (profiles) => await persistLocalAdapterAuthProfileUpdates(profiles, options.adapterAuthStoreRoot)
        : undefined);
    const runtimeArgs =
      adapterAuthProfiles.length > 0
        ? {
            ...args,
            adapterAuthProfiles,
            ...(adapterAuthUpdateSink ? { adapterAuthUpdateSink } : {}),
          }
        : args;
    return await withMutableAdapterAuthExecutionLocks(adapterAuthProfiles, async () => {
      try {
        return await executeWorkbenchExecutionJobWithResolvedAuth(runtimeArgs, options, startedAt);
      } catch (error) {
        if (options.loadLocalAdapterAuthProfiles) {
          await markAdapterAuthProfilesReauthRequired(adapterAuthProfiles, error, options.adapterAuthStoreRoot);
        }
        throw error;
      }
    });
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
    if (options.signal?.aborted) {
      return cancelRemoteWorkbenchJob(args.job, startedAt);
    }
    const execution = readWorkbenchExecutionSpec(args.job);
    const executor = workbenchExecutionExecutorForRuntimeInput(args);
    if (executor === "host") {
      return await withWorkbenchRuntimeControlServer(
        args,
        options,
        startedAt,
        async (adapterRuntimeEnv) =>
          args.runtimeControlOperation
            ? await executeRuntimeControlOperationSequenceInCurrentRuntime(
                {
                  ...args,
                  adapterRuntimeEnv: {
                    ...(args.adapterRuntimeEnv ?? {}),
                    ...adapterRuntimeEnv,
                  },
                },
                execution,
                startedAt,
              )
            : await executeAdapterInCurrentRuntime(
                {
                  ...args,
                  adapterRuntimeEnv: {
                    ...(args.adapterRuntimeEnv ?? {}),
                    ...adapterRuntimeEnv,
                  },
                },
                execution,
                startedAt,
                options.signal,
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
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (options.signal?.aborted) {
      return cancelRemoteWorkbenchJob(args.job, startedAt);
    }
    return completedRemoteJobFromSandboxResult(args.job, startedAt, validated.result);
  } catch (error) {
    if (options.signal?.aborted) {
      return cancelRemoteWorkbenchJob(args.job, startedAt);
    }
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
    return runtimeControlOperationSequenceExecutor(args);
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

function runtimeControlOperationSequenceExecutor(
  args: Pick<WorkbenchExecutionRuntimeInput, "adapterManifests" | "runtimeControlOperation">,
): WorkbenchAdapterOperationExecutor {
  const operations = args.runtimeControlOperation?.operations ?? [];
  if (operations.length === 0) {
    return "sandbox";
  }
  return operations.every((operation) => {
    const manifest = args.adapterManifests?.find((entry: WorkbenchAdapterManifest) => entry.id === operation.invocation.use);
    return manifest ? workbenchAdapterOperationExecutorShim(manifest, operation.operation) === "host" : false;
  })
    ? "host"
    : "sandbox";
}

function adapterOperationForExecutionPurpose(
  purpose: WorkbenchExecutionSpec["purpose"],
): WorkbenchAdapterOperation | null {
  if (purpose === "improve") {
    return "skill.improve";
  }
  if (purpose === "attempt") {
    return "skill.run";
  }
  return null;
}

export async function executeAdapterInCurrentRuntime(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
  startedAt: string,
  signal?: AbortSignal,
): Promise<RemoteWorkbenchJob> {
  if (signal?.aborted) {
    return cancelRemoteWorkbenchJob(args.job, startedAt);
  }
  if (isSkillEvalExecution(execution) && execution.adapter.use === "command") {
    return await executeSkillEvalExecutionInCurrentRuntime(args, execution, startedAt, signal);
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
      return await executeProviderSkillEvalExecutionInCurrentRuntime(runtimeArgs, execution, startedAt, signal);
    }
    const operation = adapterOperationForExecutionPurpose(execution.purpose);
    if (operation) {
      return await executeHostAdapterOperationInCurrentRuntime(runtimeArgs, execution, startedAt, operation, signal);
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
  signal?: AbortSignal,
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
      signal,
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
    operation !== "grade.run" &&
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
  adapterAuthStoreRoot?: string,
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
    const store = localWorkbenchAdapterAuthStore(adapterAuthStoreRoot);
    const loaded = await Promise.all(required.map(async (target) => await store.get(target)));
    const missingLoaded = loaded.findIndex((bundle) => !bundle);
    if (missingLoaded >= 0) {
      throw new Error(workbenchAdapterAuthRequiredMessage(required[missingLoaded]!));
    }
    return loaded.map((bundle) => bundle!);
  }
  if (missing.length > 0) {
    throw new Error(workbenchAdapterAuthRequiredMessage(missing[0]!));
  }
  return required.map((target) => providedByTarget.get(adapterAuthTargetKey(target))!);
}

async function markAdapterAuthProfilesReauthRequired(
  profiles: readonly WorkbenchAdapterAuthBundle[],
  error: unknown,
  adapterAuthStoreRoot?: string,
): Promise<void> {
  const adapterId = adapterAuthFailureAdapterId(error);
  if (!adapterId) {
    return;
  }
  const affected = profiles.filter((profile) => profile.adapterId === adapterId);
  if (affected.length === 0) {
    return;
  }
  const store = localWorkbenchAdapterAuthStore(adapterAuthStoreRoot);
  await Promise.all(affected.map(async (profile) =>
    await store.markReauthRequired(profile, error instanceof Error ? error.message : String(error))
  ));
}

function adapterAuthFailureAdapterId(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.match(/^ADAPTER_AUTH_REQUIRED:\s*([a-z0-9-]+)/iu)?.[1]?.toLowerCase() ?? null;
}

function adapterAuthRemediationFromError(error: string | undefined): string | null {
  const adapterId = error?.match(/ADAPTER_AUTH_REQUIRED:\s*([a-z0-9-]+)/iu)?.[1];
  return adapterId ? workbenchProviderAuthSetupCommand(adapterId) : null;
}

function workbenchAdapterAuthRequiredMessage(target: WorkbenchAdapterAuthTarget): string {
  return `ADAPTER_AUTH_REQUIRED: ${workbenchAdapterAuthTargetLabel(target)} disconnected. Next: ${workbenchProviderAuthSetupCommand(target.adapterId)}.`;
}

function workbenchAdapterAuthTargetLabel(target: WorkbenchAdapterAuthTarget): string {
  return `${target.adapterId}${target.slot ? `/${target.slot}` : ""}`;
}

export function workbenchProviderAuthSetupCommand(adapterId: string): string {
  return workbenchProviderAuthSetupCommands(adapterId)[0] ?? `workbench login ${adapterId.trim().toLowerCase()}`;
}

export function workbenchProviderAuthSetupCommands(adapterId: string): string[] {
  const normalized = adapterId.trim().toLowerCase();
  if (normalized === "claude") {
    return [
      "claude setup-token",
      "CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth",
    ];
  }
  if (normalized === "codex") {
    return [
      "codex login --device-auth",
      "workbench login codex --method oauth",
    ];
  }
  return [`workbench login ${normalized}`];
}

export async function workbenchProviderAuthSetupCommandsForTarget(
  target: WorkbenchAdapterAuthTarget,
  options: Pick<WorkbenchCommandOptions, "homeDir" | "env"> = {},
): Promise<string[]> {
  const adapter = providerAgentAdapterFromId(target.adapterId);
  if (!adapter) {
    return workbenchProviderAuthSetupCommands(target.adapterId);
  }
  const env = options.env ?? process.env;
  const nativeAuth = await providerNativeAuthState(adapter, options.homeDir?.trim() || os.homedir(), env);
  return providerSetupCommands(adapter, {
    executable: true,
    nativeAuth,
    workbenchProviderAuth: "missing",
    profile: target.profile || "default",
    env,
  });
}

export function codexAuthJsonHasUsableToken(source: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return false;
  }
  const record = asRecord(parsed);
  if (!record) {
    return false;
  }
  if (typeof record.OPENAI_API_KEY === "string" && record.OPENAI_API_KEY.trim()) {
    return true;
  }
  const tokens = asRecord(record.tokens);
  return Boolean(
    nonEmptyRecordString(tokens, "access_token") ||
    nonEmptyRecordString(tokens, "refresh_token") ||
    nonEmptyRecordString(record, "access_token") ||
    nonEmptyRecordString(record, "refresh_token"),
  );
}

function nonEmptyRecordString(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
  adapterAuthStoreRoot?: string,
): Promise<void> {
  const store = localWorkbenchAdapterAuthStore(adapterAuthStoreRoot);
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

function adapterAuthRequestForOperation(
  args: Pick<WorkbenchExecutionRuntimeInput, "adapterAuthProfiles" | "adapterAuthRoot" | "adapterAuthRequest" | "adapterManifests">,
  operation: WorkbenchRuntimeControlOperation,
): Json | undefined {
  const profiles = (args.adapterAuthProfiles ?? [])
    .map((bundle) => sanitizeWorkbenchAdapterAuthBundle(bundle));
  if (profiles.length === 0) {
    return args.adapterAuthRequest;
  }
  return adapterAuthRequest(profiles, args.adapterAuthRoot, operation.invocation.use);
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
      record.operation === "grade.run" ||
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
  signal?: AbortSignal;
}): Promise<WorkbenchRuntimeControlOperationSequenceResult> {
  const request = args.args.runtimeControlOperation;
  if (!request) {
    throw new Error("Runtime-control operation sequence is missing from the sandbox request.");
  }
  if (request.operations.length === 0) {
    throw new Error("Runtime-control operation sequence must include at least one operation.");
  }
  const adapterAuth = await materializeSandboxAdapterAuth(args.args, args.execution);
  const runtimeArgs: WorkbenchExecutionRuntimeInput = {
    ...args.args,
    ...(adapterAuth.root ? { adapterAuthRoot: adapterAuth.root } : {}),
    adapterAuthEnv: {
      ...(args.args.adapterAuthEnv ?? {}),
      ...adapterAuth.env,
    },
  };
  try {
  await stageRuntimeControlWorkspace({
    args: runtimeArgs,
    execution: args.execution,
    workspace: args.workspace,
    request,
  });
  const operationResults: WorkbenchAdapterOperationResult[] = [];
  let sequenceError: string | undefined;
  for (let index = 0; index < request.operations.length; index += 1) {
    if (args.signal?.aborted) {
      sequenceError = "Run cancellation requested.";
      break;
    }
    const operation = request.operations[index]!;
    const label = runtimeControlOperationLabel(operation, index);
    await fs.rm(workbenchAdapterOperationResultPath(runtimeControlOutputDir(args.workspace)), { force: true }).catch(() => undefined);
    const requestPath = await writeRuntimeControlAdapterRequest({
      args: runtimeArgs,
      execution: args.execution,
      workspace: args.workspace,
      operation,
      label,
      index,
    });
    const command = runtimeControlOperationCommand(operation, runtimeArgs.adapterManifests);
    const stepAdapterId = operation.invocation.use;
    const stepTimeoutMs = runtimeControlStepTimeoutMs(args.execution);
    const result = await runRuntimeControlShellCommand(command, {
      cwd: args.workspace,
      timeout: stepTimeoutMs + RUNTIME_CONTROL_STEP_GRACE_MS,
      progressTarget: runtimeArgs.progress,
      signal: args.signal,
      env: runtimeControlAdapterEnv({
        requestPath,
        outputDir: runtimeControlOutputDir(args.workspace),
        adapterEnv: adapterAuthEnvForStep(runtimeArgs, stepAdapterId),
        runtimeEnv: runtimeArgs.adapterRuntimeEnv,
        timeoutMs: stepTimeoutMs,
      }),
    });
    await writeSurfaceFiles(runtimeControlOutputDir(args.workspace), [
      textFile(`.workbench/traces/${runtimeArgs.job.id}/${label}/stdout.log`, result.stdout ?? ""),
      textFile(`.workbench/traces/${runtimeArgs.job.id}/${label}/stderr.log`, result.stderr ?? ""),
    ]);
    if (result.error || result.status !== 0) {
      sequenceError = runtimeControlStepFailureMessage({
        label,
        operation,
        result,
        prefix: args.stepPrefix,
      });
      await writeSurfaceFiles(runtimeControlOutputDir(args.workspace), [
        textFile("stderr.log", runtimeControlFailureStderrEvidence(sequenceError, result.stderr ?? "")),
        textFile("stdout.log", result.stdout ?? ""),
        textFile(
          `.workbench/traces/${runtimeArgs.job.id}/${label}/error.json`,
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
        `.workbench/traces/${runtimeArgs.job.id}/${label}/result.json`,
        `${JSON.stringify(operationResult, null, 2)}\n`,
      ),
    ]);
  }
  const files = await runtimeControlCollectedFiles(args.workspace);
  const workspaceFiles = request.collectWorkspace
    ? await runtimeControlCollectedWorkspaceFiles(args.workspace)
    : undefined;
  const gradeResult = [...operationResults].reverse().find((result) => result.operation === "grade.run");
  const usage = mergeUsageSummaries(operationResults.map(adapterOperationUsageSummary));
  const executionResult = !gradeResult && sequenceError === undefined
    ? runtimeControlSkillRunResult({
        execution: args.execution,
        operationResults,
        usage,
      })
    : undefined;
  const result = gradeResult?.value && typeof gradeResult.value === "object" && !Array.isArray(gradeResult.value)
    ? gradeResult.value as WorkbenchResult
    : executionResult;
  return {
    ok: sequenceError === undefined,
    files,
    fileChanges: files.map((file) => file.path),
    operationResults,
    ...(workspaceFiles ? { workspaceFiles } : {}),
    ...(result ? { result } : {}),
    ...(usage ? { usage } : {}),
    ...(gradeResult?.summary ? { summary: gradeResult.summary } : executionResult?.summary ? { summary: executionResult.summary } : {}),
    ...(gradeResult?.feedback !== undefined ? { feedback: gradeResult.feedback } : {}),
    ...(sequenceError ? { error: sequenceError } : {}),
  };
  } finally {
    if (adapterAuth.captureUpdates) {
      await persistMaterializedAdapterAuthUpdates(runtimeArgs, adapterAuth.captureUpdates);
    }
    if (adapterAuth.cleanup) {
      await adapterAuth.cleanup().catch(() => undefined);
    }
  }
}

function runtimeControlSkillRunResult(args: {
  execution: WorkbenchExecutionSpec;
  operationResults: readonly WorkbenchAdapterOperationResult[];
  usage?: UsageSummary;
}): WorkbenchResult | undefined {
  const skillResult = [...args.operationResults].reverse().find((result) => result.operation === "skill.run");
  if (!skillResult) {
    return undefined;
  }
  const summary = skillResult.summary?.trim() ||
    textFromJson(asRuntimeRecord(skillResult.value).summary) ||
    "Skill run completed.";
  const caseId = textFromJson(asRuntimeRecord(args.execution.metadata).caseId) ?? "current";
  return {
    score: 1,
    metrics: { score: 1 },
    cases: [{
      id: caseId,
      status: "completed",
      metrics: { score: 1 },
    }],
    summary,
    ...(args.usage ? { usage: args.usage } : {}),
    ...(skillResult.feedback !== undefined ? { feedback: skillResult.feedback } : {}),
  };
}

function runtimeControlFailureStderrEvidence(error: string, stderr: string): string {
  const detail = stderr.trim();
  if (!detail) {
    return `${error}\n`;
  }
  const publicDetail = publicRuntimeErrorSummary(detail);
  return publicDetail && error.includes(publicDetail) ? `${error}\n` : `${error}\n\n${detail}\n`;
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
  const errorMessage = args.result.error?.message ? publicRuntimeErrorSummary(args.result.error.message) : undefined;
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
  const detail = publicRuntimeErrorSummary(rawDetail);
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

function selectRuntimeControlGradeCaseFiles(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
): SurfaceSnapshotFile[] {
  const caseId = runtimeControlCaseId(args, execution);
  const engineCase = args.engineCases.find((entry) => entry.id === caseId);
  return (engineCase?.files.source ?? [
    ...selectRuntimeControlCaseFiles(args, execution),
    ...selectRuntimeControlEnginePrivateFiles(args, execution),
  ]).map(copyFile);
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
  const auth = adapterAuthRequestForOperation(args.args, args.operation);
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
    ...(auth !== undefined ? { auth } : {}),
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
    signal?: AbortSignal;
  },
): Promise<{
  stdout: string;
  stderr: string;
  status: number | null;
  error?: Error;
}> {
  const maxBuffer = 20 * 1024 * 1024;
  const signal = abortSignalOrUndefined(options.signal);
  return await new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let aborted = false;
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
    if (signal?.aborted) {
      aborted = true;
      killRuntimeControlChild(child, "SIGTERM");
    }
    const abort = () => {
      aborted = true;
      killRuntimeControlChild(child, "SIGTERM");
    };
    signal?.addEventListener("abort", abort, { once: true });
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
      signal?.removeEventListener("abort", abort);
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
      if (aborted) {
        settle(code, new Error("Run cancellation requested."));
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
  if (result.operation === "grade.run") {
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

function runtimeControlEntrySkillDir(root: string, skillName = CURRENT_SKILL_VERSION_NAME): string {
  return path.join(runtimeControlSkillsDir(root), skillName);
}

function runtimeControlSkillDir(root: string, execution?: WorkbenchExecutionSpec, jobInput?: Record<string, unknown>): string {
  if (execution?.purpose === "improve") {
    return root;
  }
  const skillName = typeof jobInput?.skillName === "string" && jobInput.skillName.trim()
    ? jobInput.skillName.trim()
    : CURRENT_SKILL_VERSION_NAME;
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
  signal?: AbortSignal,
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
    signal,
  });
  if (!runner.ok) {
    return completedSkillEvalOperationSequenceJob(args.job, startedAt, execution, runner);
  }
  if (signal?.aborted) {
    return cancelRemoteWorkbenchJob(args.job, startedAt);
  }
  return completedSkillEvalOperationSequenceJob(args.job, startedAt, execution, runner);
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

function skillEvalGradeInvocationFromSpec(spec: GenericRunSpec): WorkbenchAdapterInvocation {
  const use = typeof spec.gradeRun.use === "string" && spec.gradeRun.use.trim()
    ? spec.gradeRun.use.trim()
    : "";
  if (!use) {
    throw new Error("Skill eval grading requires a grade adapter.");
  }
  return {
    use,
    with: spec.gradeRun.with ?? {},
    ...(spec.gradeRun.auth !== undefined ? { auth: spec.gradeRun.auth } : {}),
  };
}

function skillEvalResultFailedCaseMessage(result: WorkbenchResult | undefined): string | undefined {
  if (!result?.cases) {
    return undefined;
  }
  for (const entry of result.cases) {
    const record = asRuntimeRecord(entry);
    if (record.status !== "error" && record.status !== "failed" && !textFromJson(record.error)) {
      continue;
    }
    const feedback = asRuntimeRecord(record.feedback);
    return textFromJson(record.error) ??
      textFromJson(feedback.message) ??
      textFromJson(feedback.summary) ??
      "Skill eval grade adapter reported a failed case.";
  }
  return undefined;
}

function completedSkillEvalOperationSequenceJob(
  job: RemoteWorkbenchJob,
  startedAt: string,
  execution: WorkbenchExecutionSpec,
  result: WorkbenchRuntimeControlOperationSequenceResult,
): RemoteWorkbenchJob {
  const finishedAt = now();
  const output = runtimeControlJobOutput(result);
  const succeeded = result.ok;
  const outputResult = asRuntimeRecord(output.result);
  const error = succeeded
    ? undefined
    : result.error ?? skillEvalResultFailedCaseMessage(outputResult as unknown as WorkbenchResult) ??
      "Skill eval adapter sequence failed.";
  return {
    ...job,
    status: succeeded ? "succeeded" : "failed",
    attempt: Math.max(1, job.attempt),
    startedAt,
    finishedAt,
    updatedAt: finishedAt,
    ...(error ? { error } : {}),
    output: {
      ...output,
      ok: succeeded,
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
  signal?: AbortSignal,
): Promise<RemoteWorkbenchJob> {
  const workspace = path.resolve(args.workspaceRoot ?? "/workspace");
  const skillsDir = path.join(workspace, "input", "skills");
  const metadata = asRuntimeRecord(execution.metadata);
  const entrySkill = typeof metadata.skillName === "string" && metadata.skillName.trim()
    ? metadata.skillName.trim()
    : CURRENT_SKILL_VERSION_NAME;
  const skillDir = path.join(skillsDir, entrySkill);
  const caseDir = path.join(workspace, "input", "case");
  const outputDir = path.join(workspace, "output");
  const command = configString(asRuntimeRecord(execution.adapter.with) as Record<string, Json>, "command") ??
    WORKBENCH_DEFAULT_CASE_TEST_COMMAND;
  const timeoutMs = Math.max(1000, execution.policy.resources.timeoutMinutes * 60_000);
  await fs.rm(skillsDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(caseDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(skillDir, { recursive: true });
  await writeSurfaceFiles(skillsDir, args.baseFiles);
  await writeSurfaceFiles(caseDir, args.engineResolveFiles);
  const startedMs = Date.now();
  const result = await runRuntimeControlShellCommand(command, {
    cwd: workspace,
    timeout: timeoutMs,
    signal,
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
  const publicResult = await readPublicSkillEvalResult({
    filePath: path.join(outputDir, "result.json"),
    caseId: typeof execution.metadata.caseId === "string" ? execution.metadata.caseId : "current",
    durationMs: Math.max(0, Date.now() - startedMs),
  });
  const adapterResult = !publicResult && commandSucceeded && await exists(workbenchAdapterOperationResultPath(outputDir))
    ? await readWorkbenchAdapterOperationResult(outputDir, "skill.run")
    : null;
  const succeeded = publicResult
    ? commandSucceeded && publicResult.passed !== false
    : commandSucceeded && adapterResult?.ok !== false;
  const commandError = result.error
    ? result.error.message
    : result.status !== 0
      ? (stderr || stdout || `Command exited with status ${result.status ?? "unknown"}`).trim()
    : adapterResult?.ok === false
      ? adapterResult.summary ?? "Command engine returned ok false."
      : undefined;
  const error = publicResult
    ? !succeeded ? publicResult.error ?? commandError : undefined
    : commandError;
  const resultPayload = publicResult?.result ??
    workbenchResultFromAdapterResult(adapterResult) ??
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

async function readPublicSkillEvalResult(args: {
  filePath: string;
  caseId: string;
  durationMs: number;
}): Promise<{ result: WorkbenchResult; passed?: boolean; error?: string } | null> {
  if (!await exists(args.filePath)) {
    return null;
  }
  const parsed = await readJson(args.filePath);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkbenchUserError("OUTPUT_DIR/result.json must contain a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  const rawPassed = typeof record.ok === "boolean"
    ? record.ok
    : typeof record.passed === "boolean"
      ? record.passed
      : typeof record.pass === "boolean"
        ? record.pass
        : undefined;
  const score = typeof record.score === "number"
    ? record.score
    : rawPassed !== undefined
      ? rawPassed ? 1 : 0
      : undefined;
  if (score === undefined || !Number.isFinite(score)) {
    throw new WorkbenchUserError("OUTPUT_DIR/result.json must include a finite numeric score or boolean ok/passed/pass.");
  }
  const passed = rawPassed === undefined ? undefined : rawPassed && score > 0;
  const metrics = publicSkillEvalResultMetrics(record, score);
  const message = typeof record.message === "string"
    ? record.message
    : typeof record.summary === "string"
      ? record.summary
      : undefined;
  const caseStatus: EvalCaseResult["status"] = passed === false ? "error" : "completed";
  const result: WorkbenchResult = {
    score,
    metrics,
    cases: [{
      id: args.caseId,
      status: caseStatus,
      durationMs: args.durationMs,
      metrics,
      ...(passed === false
        ? { feedback: { message: message ?? "Test failed." } }
        : {}),
    }],
    ...(typeof record.summary === "string"
      ? { summary: record.summary }
      : message
        ? { summary: message }
        : {}),
    feedback: {
      result: toJson(record),
    },
  };
  return {
    result,
    ...(passed !== undefined ? { passed } : {}),
    ...(passed === false ? { error: message ?? (score <= 0 ? "Score is 0." : "Test failed.") } : {}),
  };
}

function publicSkillEvalResultMetrics(record: Record<string, unknown>, score: number): Record<string, number> {
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

function cancelRemoteWorkbenchJob(
  job: RemoteWorkbenchJob,
  startedAt: string,
  finishedAt = new Date().toISOString(),
): RemoteWorkbenchJob {
  return {
    ...job,
    status: "cancelled",
    attempt: Math.max(1, job.attempt),
    startedAt,
    finishedAt,
    updatedAt: finishedAt,
    error: "Run cancellation requested.",
    output: {
      ok: false,
      canceled: true,
      error: "Run cancellation requested.",
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
  location?: WorkbenchRun["location"];
  remoteName?: string;
  retryOfRunId?: string;
  onRunStarted?: (run: WorkbenchRun) => void | Promise<void>;
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

export interface WorkbenchRunCancellationResult {
  run: WorkbenchRun;
  requestedAt: string;
  requestPath: string;
}

export interface WorkbenchResultsOptions extends WorkbenchCommandOptions {
  projectVersions?: string;
  resultVersions?: string;
  versions?: string;
  agents?: string;
}

interface InternalComparisonCell {
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
  runId?: string;
  status?: WorkbenchRun["status"];
  score?: number;
  samples?: number;
  costUsd?: number;
  latencyMs?: number;
  error?: string;
}

interface InternalComparison {
  evalHash?: string;
  versions: WorkbenchVersion[];
  skills: WorkbenchSkillBundleSnapshot[];
  agents: WorkbenchAgentSnapshot[];
  cells: InternalComparisonCell[];
}

interface InternalComparisonSelection {
  versions?: string;
  skills?: string;
  agents?: string;
  availableAgents?: readonly WorkbenchAgent[];
  defaultAgent?: string;
}

export interface WorkbenchRemoteOptions extends WorkbenchCommandOptions {
  remote?: string;
  authToken?: string;
  dryRun?: boolean;
  signal?: AbortSignal;
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
  installHandle: string;
  dryRun?: boolean;
  unchanged?: boolean;
}

export interface WorkbenchUnpublishOptions extends WorkbenchCommandOptions {
  version: string;
  remote?: string;
  authToken?: string;
  dryRun?: boolean;
}

export interface WorkbenchUnpublishResult {
  remote: WorkbenchRemote;
  version: WorkbenchVersion;
  visibility?: WorkbenchPublishVisibility;
  installHandle?: string;
  currentVersionId?: string;
  publishedVersionIds: string[];
  dryRun?: boolean;
}

export interface WorkbenchDeletedCloudProjectLocalStateCleanup {
  root: string;
  initialized: boolean;
  removedRemotes: string[];
  clearedPublication: boolean;
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
  publication?: WorkbenchStatusSnapshot["remotes"][number]["publication"];
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

export interface WorkbenchSkillEvalGradeRuntimeInputArgs extends WorkbenchSkillEvalRuntimeInputArgs {
  subject: {
    job: WorkbenchJob;
    artifact: WorkbenchArtifact;
    trace: WorkbenchTrace;
  };
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
const LIVE_DIR = "live";
const CANCEL_DIR = "cancel";
const TMP_DIR = "tmp";
const LOGS_DIR = "logs";
const LOCKS_DIR = "locks";
const STATE_TREE_RM_OPTIONS = { recursive: true, force: true, maxRetries: 20, retryDelay: 100 } as const;
const PROJECT_LOCK_DIR = "project.lock";
const REMOTES_FILE = "remotes.yaml";
const WORKBENCH_GITIGNORE_FILE = ".gitignore";
const EVAL_FILE = "eval.yaml";
const CASES_DIR = "cases";
const ENVIRONMENT_DIR = "environment";
const AGENTS_FILE = "agents.yaml";
const VERSIONS_FILE = "versions.yaml";
const LEGACY_SKILLS_FILE = "skills.yaml";
const SKILL_FILE = "SKILL.md";
const CURRENT_SKILL_VERSION_NAME = "current";
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
const HTTP_REMOTE_MAX_ATTEMPTS = 3;
const SOURCE_SNAPSHOT_MESSAGE = "source snapshot";
const projectLockContext = new AsyncLocalStorage<ReadonlySet<string>>();
const projectLockQueues = new Map<string, Promise<void>>();
const stateSaveQueues = new Map<string, Promise<void>>();
const SKILL_EVAL_COMMAND_AGENT_ADAPTERS = new Set(["local", "command"]);
const SKILL_EVAL_PROVIDER_AGENT_ADAPTERS = new Set(["codex", "claude"]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const dockerAvailabilityExecFileAsync = promisify(execFile) as unknown as (
  file: string,
  args: string[],
  options?: Record<string, unknown>,
) => Promise<unknown>;

const IGNORED_SKILL_DIRS = new Set([
  ".agents",
  ".git",
  ".workbench",
  "node_modules",
  "dist",
  "__pycache__",
]);

const IGNORED_SKILL_FILES = new Set([
  ".DS_Store",
]);

const STARTER_CREATED_PATHS = [
  "SKILL.md",
  ".workbench/eval.yaml",
  ".workbench/agents.yaml",
  ".workbench/.gitignore",
];

type WorkbenchProviderAgentAdapter = "codex" | "claude";
type WorkbenchNewAgentAdapter = WorkbenchProviderAgentAdapter | "command" | "local";
type WorkbenchManifestEntryNoun = "skill" | "version" | "agent";

const WORKBENCH_PROVIDER_AGENT_DEFAULTS: Record<WorkbenchProviderAgentAdapter, {
  model: string;
  executable: string;
  installCommand: string;
  apiKeyEnv: string;
}> = {
  codex: {
    model: "gpt-5.4-mini",
    executable: "codex",
    installCommand: "npm install --global @openai/codex",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  claude: {
    model: "sonnet",
    executable: "claude",
    installCommand: "npm install --global @anthropic-ai/claude-code",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
};

function providerAgentAdapterFromId(value: string): WorkbenchProviderAgentAdapter | null {
  const normalized = value.trim().toLowerCase();
  return normalized === "codex" || normalized === "claude" ? normalized : null;
}

export async function createNewWorkbenchSkillProject(options: WorkbenchInitOptions = {}): Promise<WorkbenchStatus> {
  const root = resolveRoot(options.dir);
  const rootExists = await exists(root);
  if (rootExists && await exists(workbenchDir(root))) {
    throw new WorkbenchCodedError("already_initialized", `Workbench project already exists: ${root}`, {
      remediation: `cd ${root} && workbench`,
      subject: { root },
      exitCode: 2,
    });
  }
  if (rootExists && !await exists(workbenchDir(root))) {
    const entries = await fs.readdir(root);
    if (entries.length > 0) {
      const containsSkill = await exists(path.join(root, SKILL_FILE));
      throw new WorkbenchCodedError("usage", containsSkill
        ? `Directory already contains ${SKILL_FILE}: ${root}`
        : `Directory is not empty: ${root}`, {
        remediation: containsSkill ? `cd ${root} && workbench init` : "workbench new DIR",
        subject: { root },
        exitCode: 2,
      });
    }
  }
  const defaultAgentSelection = await selectNewDefaultAgent(options);
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
  return await initializeWorkbenchProjectControls(root, defaultAgentSelection, [...STARTER_CREATED_PATHS]);
}

export async function initExistingWorkbenchSkillProject(options: WorkbenchInitOptions = {}): Promise<WorkbenchStatus> {
  const root = resolveRoot(options.dir);
  if (!await exists(path.join(root, SKILL_FILE))) {
    throw new WorkbenchCodedError("usage", `Workbench init requires ${SKILL_FILE} in the current directory.`, {
      remediation: "workbench new DIR",
      subject: { root, requiredFile: SKILL_FILE },
      exitCode: 2,
    });
  }
  if (await exists(workbenchDir(root))) {
    const required = [
      path.join(workbenchDir(root), EVAL_FILE),
      path.join(workbenchDir(root), AGENTS_FILE),
      objectsDir(root),
      refsDir(root),
    ];
    const missing = [];
    for (const entry of required) {
      if (!await exists(entry)) {
        missing.push(path.relative(root, entry));
      }
    }
    if (missing.length > 0) {
      throw new WorkbenchCodedError("invalid_workbench_project", `Workbench metadata already exists but is incomplete: ${root}`, {
        remediation: "Inspect .workbench, repair the missing files, or move .workbench aside before rerunning workbench init.",
        subject: { root, missing },
        exitCode: 2,
      });
    }
    throw new WorkbenchCodedError("already_initialized", `Workbench project already exists: ${root}`, {
      remediation: "workbench status",
      subject: { root },
      exitCode: 2,
    });
  }
  const defaultAgentSelection = await selectNewDefaultAgent(options);
  return await initializeWorkbenchProjectControls(root, defaultAgentSelection, [
    ".workbench/eval.yaml",
    ".workbench/agents.yaml",
    ".workbench/.gitignore",
  ]);
}

export async function initializeHydratedWorkbenchSkillProject(options: WorkbenchInitOptions = {}): Promise<WorkbenchStatus> {
  const root = resolveRoot(options.dir);
  if (!await exists(path.join(root, SKILL_FILE))) {
    throw new WorkbenchCodedError("usage", `Workbench clone requires ${SKILL_FILE} in the hydrated source.`, {
      remediation: "workbench clone OWNER/SKILL[@VERSION] DIR",
      subject: { root, requiredFile: SKILL_FILE },
      exitCode: 2,
    });
  }
  const defaultAgentSelection = await selectNewDefaultAgent(options);
  const createdPaths = await ensureWorkbenchProjectScaffold(root, defaultAgentSelection);
  const state = await loadState(root, { allowMissing: true });
  await refreshLocalWorkbenchFiles(root, state);
  await saveState(root, state);
  return {
    ...await workbenchStatus({
      dir: root,
      adapterAuthStoreRoot: options.adapterAuthStoreRoot,
      homeDir: options.homeDir,
      env: options.env,
    }),
    ...(createdPaths.length ? { createdPaths } : {}),
    ...(createdPaths.includes(`.workbench/${AGENTS_FILE}`) ? { defaultAgentSelection } : {}),
  };
}

async function initializeWorkbenchProjectControls(
  root: string,
  defaultAgentSelection: WorkbenchDefaultAgentSelection,
  createdPaths: readonly string[],
): Promise<WorkbenchStatus> {
  await ensureWorkbenchProjectScaffold(root, defaultAgentSelection);
  const state = await loadState(root, { allowMissing: true });
  await refreshLocalWorkbenchFiles(root, state);
  await saveState(root, state);
  return {
    ...await workbenchStatus({ dir: root }),
    defaultAgentSelection,
    createdPaths: [...createdPaths],
  };
}

async function ensureWorkbenchProjectScaffold(
  root: string,
  defaultAgentSelection: WorkbenchDefaultAgentSelection,
): Promise<string[]> {
  const createdPaths: string[] = [];
  const workbenchRoot = workbenchDir(root);
  await fs.mkdir(path.join(workbenchRoot, CASES_DIR), { recursive: true });
  await ensureWorkbenchLocalMetadataIgnore(root);
  await Promise.all([
    fs.mkdir(objectsDir(root), { recursive: true }),
    fs.mkdir(refsDir(root), { recursive: true }),
    fs.mkdir(syncDir(root), { recursive: true }),
    fs.mkdir(path.join(workbenchRoot, TMP_DIR), { recursive: true }),
  ]);
  const evalPath = path.join(workbenchRoot, EVAL_FILE);
  if (!await exists(evalPath)) {
    await ensureFile(
      evalPath,
      [
        "version: 1",
        `name: ${safeName(path.basename(root) || "skill")}`,
        "description: Workflow eval definition. Add cases under .workbench/cases before running eval.",
        "grade:",
        `  adapter: ${starterEvalGradeAdapter(defaultAgentSelection)}`,
        "",
      ].join("\n"),
    );
    createdPaths.push(`.workbench/${EVAL_FILE}`);
  }
  const agentsPath = path.join(workbenchRoot, AGENTS_FILE);
  if (!await exists(agentsPath)) {
    await ensureFile(
      agentsPath,
      agentsYamlForNewDefault(defaultAgentSelection),
    );
    createdPaths.push(`.workbench/${AGENTS_FILE}`);
  }
  return createdPaths;
}

function starterEvalGradeAdapter(selection: WorkbenchDefaultAgentSelection): "rubric" | "tests" {
  return selection.kind === "provider" ? "rubric" : "tests";
}

async function selectNewDefaultAgent(options: WorkbenchInitOptions): Promise<WorkbenchDefaultAgentSelection> {
  const explicitAgent = options.agent?.trim();
  const explicitModel = options.model?.trim();
  const explicitAuth = options.auth?.trim();
  if (explicitAgent) {
    const adapter = normalizeNewAgentAdapter(explicitAgent);
    if (adapter === "local" || adapter === "command") {
      if (explicitModel || explicitAuth) {
        throw new WorkbenchCodedError("usage", "workbench new --model and --auth apply only to provider agents.", {
          remediation: `workbench new --agent ${adapter}`,
          subject: { agent: adapter },
          exitCode: 2,
        });
      }
      return deterministicNewDefaultAgent(adapter, "explicit_agent");
    }
    return await providerNewDefaultAgent(adapter, "explicit_agent", options);
  }
  if (explicitModel || explicitAuth) {
    return await providerNewDefaultAgent("codex", "explicit_provider_options", options);
  }

  const [codex, claude] = await Promise.all([
    providerNewDefaultAgent("codex", "ready_codex", options),
    providerNewDefaultAgent("claude", "ready_claude", options),
  ]);
  if (codex.readiness.state === "ready") {
    return codex;
  }
  if (claude.readiness.state === "ready") {
    return claude;
  }
  if (codex.readiness.state === "partial") {
    return { ...codex, reason: "partial_codex" };
  }
  if (claude.readiness.state === "partial") {
    return { ...claude, reason: "partial_claude" };
  }
  return { ...codex, reason: "product_default" };
}

function normalizeNewAgentAdapter(value: string): WorkbenchNewAgentAdapter {
  const normalized = value.trim().toLowerCase();
  if (normalized === "codex" || normalized === "claude" || normalized === "command" || normalized === "local") {
    return normalized;
  }
  throw new WorkbenchCodedError("usage", "workbench new --agent must be codex, claude, command, or local.", {
    remediation: "workbench new --agent codex",
    subject: { agent: value },
    exitCode: 2,
  });
}

function deterministicNewDefaultAgent(
  adapter: "command" | "local",
  reason: string,
): WorkbenchDefaultAgentSelection {
  return {
    name: "default",
    adapter,
    ...(adapter === "local" ? { model: "docker" } : {}),
    kind: "deterministic",
    reason,
    readiness: {
      state: "deterministic",
      setupCommands: [],
      warnings: [],
    },
  };
}

async function providerNewDefaultAgent(
  adapter: WorkbenchProviderAgentAdapter,
  reason: string,
  options: WorkbenchInitOptions,
): Promise<WorkbenchDefaultAgentSelection> {
  const defaults = WORKBENCH_PROVIDER_AGENT_DEFAULTS[adapter];
  const auth = options.auth?.trim() || "default";
  return {
    name: "default",
    adapter,
    model: options.model?.trim() || defaults.model,
    auth,
    kind: "provider",
    reason,
    readiness: await providerReadiness(adapter, auth, options),
  };
}

async function providerReadiness(
  adapter: WorkbenchProviderAgentAdapter,
  profile: string,
  options: WorkbenchInitOptions,
): Promise<WorkbenchDefaultAgentSelection["readiness"]> {
  const defaults = WORKBENCH_PROVIDER_AGENT_DEFAULTS[adapter];
  const homeDir = options.homeDir?.trim() || os.homedir();
  const env = options.env ?? process.env;
  const [authStatus, nativeAuth] = await Promise.all([
    localWorkbenchAdapterAuthStore(options.adapterAuthStoreRoot).status({
      adapterId: adapter,
      profile,
    }).catch(() => ({ status: "disconnected" as const })),
    providerNativeAuthState(adapter, homeDir, env),
  ]);
  const executable = executableOnPath(defaults.executable);
  const workbenchProviderAuth = authStatus.status === "connected" ? "connected" : "missing";
  const apiKeyPresent = Boolean(env[defaults.apiKeyEnv]?.trim());
  const state = executable && workbenchProviderAuth === "connected"
    ? "ready"
    : executable || workbenchProviderAuth === "connected" || nativeAuth !== "missing" || apiKeyPresent
      ? "partial"
      : "missing";
  const warnings: string[] = [];
  if (nativeAuth === "present" && workbenchProviderAuth !== "connected") {
    warnings.push(`${capitalize(adapter)} native auth exists, but Workbench adapter auth is not captured.`);
  }
  if (state !== "ready") {
    warnings.push(`${capitalize(adapter)} is not ready for provider-backed Workbench runs yet.`);
  }
  const effectiveNativeAuth = workbenchProviderAuth === "connected" ? "not_required" : nativeAuth;
  return {
    state,
    executable,
    workbenchProviderAuth,
    nativeAuth: effectiveNativeAuth,
    setupCommands: providerSetupCommands(adapter, {
      executable,
      nativeAuth: effectiveNativeAuth,
      workbenchProviderAuth,
      profile,
      env,
    }),
    warnings,
  };
}

async function providerNativeAuthState(
  adapter: WorkbenchProviderAgentAdapter,
  homeDir: string,
  env: Record<string, string | undefined>,
): Promise<"present" | "partial" | "missing"> {
  if (adapter === "codex") {
    const codexHome = env.CODEX_HOME?.trim();
    const roots = [
      ...(codexHome ? [codexHome] : []),
      path.join(homeDir, ".codex"),
    ];
    for (const root of roots) {
      if (await codexNativeAuthFilePresent(path.join(root, "auth.json"))) {
        return "present";
      }
    }
    return "missing";
  }
  const profile = await exists(path.join(homeDir, ".claude.json"));
  const tokenEnv = Boolean(env.CLAUDE_CODE_OAUTH_TOKEN?.trim());
  if (profile && tokenEnv) {
    return "present";
  }
  return profile || tokenEnv ? "partial" : "missing";
}

async function codexNativeAuthFilePresent(filePath: string): Promise<boolean> {
  const source = await fs.readFile(filePath, "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  });
  return source !== null && codexAuthJsonHasUsableToken(source);
}

function providerSetupCommands(
  adapter: WorkbenchProviderAgentAdapter,
  readiness: {
    executable: boolean;
    nativeAuth: "present" | "partial" | "missing" | "not_required";
    workbenchProviderAuth: "connected" | "missing";
    profile: string;
    env: Record<string, string | undefined>;
  },
): string[] {
  const defaults = WORKBENCH_PROVIDER_AGENT_DEFAULTS[adapter];
  const commands: string[] = [];
  if (!readiness.executable) {
    commands.push(defaults.installCommand);
  }
  if (readiness.workbenchProviderAuth === "connected") {
    return commands;
  }
  if (adapter === "codex") {
    if (readiness.nativeAuth !== "present") {
      commands.push("codex login --device-auth");
    }
    commands.push(`workbench login codex --method oauth${readiness.profile === "default" ? "" : ` --profile ${readiness.profile}`}`);
    return commands;
  }
  if (readiness.nativeAuth !== "present") {
    commands.push("claude setup-token");
  }
  commands.push(readiness.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
    ? `workbench login claude --method oauth${readiness.profile === "default" ? "" : ` --profile ${readiness.profile}`}`
    : `CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth${readiness.profile === "default" ? "" : ` --profile ${readiness.profile}`}`);
  return commands;
}

async function assertLocalWorkbenchAdapterAuthReady(
  agents: readonly WorkbenchAgent[],
  options?: string | Pick<WorkbenchCommandOptions, "adapterAuthStoreRoot" | "homeDir" | "env">,
): Promise<void> {
  const readiness = await localWorkbenchAdapterAuthReadiness(agents, options);
  const issue = readiness.issues[0];
  if (issue) {
    throw new WorkbenchCodedError("adapter_auth_required", issue.message, {
      remediation: issue.remediation,
      subject: issue.subject as Record<string, Json> | undefined,
      exitCode: 1,
    });
  }
}

async function assertLocalWorkbenchLaunchReady(
  agents: readonly WorkbenchAgent[],
  options?: string | Pick<WorkbenchCommandOptions, "adapterAuthStoreRoot" | "homeDir" | "env">,
): Promise<void> {
  await assertLocalWorkbenchAdapterAuthReady(agents, options);
  await assertLocalWorkbenchExecutionEnvironmentReady(agents);
}

async function localWorkbenchAdapterAuthReadiness(
  agents: readonly WorkbenchAgent[],
  input?: string | Pick<WorkbenchCommandOptions, "adapterAuthStoreRoot" | "homeDir" | "env">,
): Promise<WorkbenchLaunchReadiness> {
  const options = typeof input === "string" ? { adapterAuthStoreRoot: input } : input ?? {};
  const targets = uniqueLocalAdapterAuthTargets(agents.flatMap(localAdapterAuthTargetsForAgent));
  if (targets.length === 0) {
    return readyWorkbenchLaunchReadiness();
  }
  const store = localWorkbenchAdapterAuthStore(options.adapterAuthStoreRoot);
  const issues: WorkbenchLaunchReadinessIssue[] = [];
  for (const target of targets) {
    const status = await store.status(target);
    if (status.status !== "connected") {
      const setupCommands = await workbenchProviderAuthSetupCommandsForTarget(target, options);
      issues.push({
        code: "adapter_auth_required",
        message: `${workbenchAdapterAuthTargetLabel(target)} disconnected.`,
        remediation: setupCommands[0] ?? workbenchProviderAuthSetupCommand(target.adapterId),
        subject: {
          adapterId: target.adapterId,
          profile: target.profile,
          ...(target.slot ? { slot: target.slot } : {}),
          setupCommands,
        },
      });
    }
  }
  return readinessFromIssues(issues);
}

async function localWorkbenchLaunchReadiness(
  agents: readonly WorkbenchAgent[],
  options?: string | Pick<WorkbenchCommandOptions, "adapterAuthStoreRoot" | "homeDir" | "env">,
): Promise<WorkbenchLaunchReadiness> {
  const [authReadiness, environmentReadiness] = await Promise.all([
    localWorkbenchAdapterAuthReadiness(agents, options),
    localWorkbenchExecutionEnvironmentReadiness(agents),
  ]);
  return readinessFromIssues([...authReadiness.issues, ...environmentReadiness.issues]);
}

async function assertLocalWorkbenchExecutionEnvironmentReady(agents: readonly WorkbenchAgent[]): Promise<void> {
  const readiness = await localWorkbenchExecutionEnvironmentReadiness(agents);
  const issue = readiness.issues[0];
  if (issue) {
    throw new WorkbenchCodedError(issue.code, issue.message, {
      remediation: issue.remediation,
      subject: issue.subject as Record<string, Json> | undefined,
      exitCode: 1,
    });
  }
}

async function localWorkbenchExecutionEnvironmentReadiness(agents: readonly WorkbenchAgent[]): Promise<WorkbenchLaunchReadiness> {
  if (!localWorkbenchLaunchUsesDocker(agents)) {
    return readyWorkbenchLaunchReadiness();
  }
  try {
    await assertDockerSandboxAvailable(dockerAvailabilityExecFileAsync);
    return readyWorkbenchLaunchReadiness();
  } catch (error) {
    return readinessFromIssues([dockerSandboxReadinessIssue(error)]);
  }
}

function localWorkbenchLaunchUsesDocker(agents: readonly WorkbenchAgent[]): boolean {
  return agents.some((agent) => {
    const adapter = agent.adapter.trim().toLowerCase();
    return SKILL_EVAL_COMMAND_AGENT_ADAPTERS.has(adapter) || SKILL_EVAL_PROVIDER_AGENT_ADAPTERS.has(adapter);
  });
}

function dockerSandboxReadinessIssue(error: unknown): WorkbenchLaunchReadinessIssue {
  return {
    code: "sandbox_unavailable",
    message: error instanceof Error ? error.message : String(error),
    remediation: "Install and start Docker, ensure the docker CLI is on PATH, then rerun the command.",
    subject: {
      backend: DOCKER_SANDBOX_BACKEND,
      executable: "docker",
    },
  };
}

function readyWorkbenchLaunchReadiness(): WorkbenchLaunchReadiness {
  return { ready: true, issues: [] };
}

function readinessFromIssues(issues: readonly WorkbenchLaunchReadinessIssue[]): WorkbenchLaunchReadiness {
  return { ready: issues.length === 0, issues: issues.map((issue) => ({ ...issue })) };
}

function localAdapterAuthTargetsForAgent(agent: WorkbenchAgent): WorkbenchAdapterAuthTarget[] {
  if (!isProviderBackedSkillEvalAgent(agent)) {
    return [];
  }
  return collectWorkbenchAdapterAuthRequirements([agentAdapterInvocation(agent)], builtinWorkbenchAdapterManifests())
    .map((target) => normalizeWorkbenchAdapterAuthTarget(target));
}

function uniqueLocalAdapterAuthTargets(targets: readonly WorkbenchAdapterAuthTarget[]): WorkbenchAdapterAuthTarget[] {
  const seen = new Set<string>();
  const result: WorkbenchAdapterAuthTarget[] = [];
  for (const target of targets) {
    const key = adapterAuthTargetKey(target);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(target);
  }
  return result;
}

function executableOnPath(command: string): boolean {
  const result = process.platform === "win32"
    ? spawnSync("where", [command], { stdio: "ignore" })
    : spawnSync("sh", ["-lc", `command -v ${quoteShellArg(command)}`], { stdio: "ignore" });
  return result.status === 0;
}

function agentsYamlForNewDefault(selection: WorkbenchDefaultAgentSelection): string {
  const agent: WorkbenchAgent = {
    name: selection.name,
    adapter: selection.adapter,
    ...(selection.model ? { model: selection.model } : {}),
    config: selection.auth ? { auth: selection.auth } : {},
  };
  return YAML.stringify({
    default: selection.name,
    agents: {
      [selection.name]: {
        adapter: agent.adapter,
        ...(agent.model ? { model: agent.model } : {}),
        with: agent.config,
      },
    },
  });
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
      },
      runs: {
        total: 0,
      },
      remotes: [],
      next: "workbench new .",
    };
  }
  const [snapshot, syncStates, localState, worktreeSourceHash] = await Promise.all([
    createWorkbenchReadOnlyInspectionSnapshot(options),
    readRemoteSyncStates(root).catch(() => []),
    loadStateReadOnlyWithRetry(root),
    readSkillFiles(root).then(hashFiles).catch(() => undefined),
  ]);
  const currentVersionId = snapshot.status.currentVersionId ?? snapshot.refs.current;
  const worktreeSourceVersion = worktreeSourceHash
    ? findWorkbenchVersionBySourceHash(localState.versions, worktreeSourceHash)
    : undefined;
  const worktreeWouldCreateVersionId = worktreeSourceHash && !worktreeSourceVersion
    ? versionIdForHash(worktreeSourceHash)
    : undefined;
  const worktreeSourceState: WorkbenchStatusSnapshot["worktree"]["sourceState"] | undefined = worktreeSourceHash
    ? worktreeSourceVersion ? "committed" : "would_create"
    : undefined;
  const hasUnsyncedWorktreeSource = Boolean(
    worktreeSourceHash &&
    !worktreeSourceVersion,
  );
  const lastRun = [...snapshot.runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const lastRunScore = lastRun ? runQualityScoreFromJobs(lastRun, snapshot.jobs) : undefined;
  const syncByRemote = new Map(syncStates.map((entry) => [entry.remote, entry]));
  const remotes = snapshot.remotes.map((remote) => {
    const syncRecord = syncByRemote.get(remote.name);
    const sync = syncRecord && syncRecord.url === remote.url ? syncRecord : undefined;
    const syncStatus: WorkbenchStatusSnapshot["remotes"][number]["sync"] = sync
      ? {
          status: sync.status === "error"
            ? "error"
            : hasUnsyncedWorktreeSource || !sync.localHash || sync.localHash !== remoteSyncLocalHash(localState, remote)
              ? "local_changes"
              : "up_to_date",
          ...(sync.lastSyncedAt ? { lastSyncedAt: sync.lastSyncedAt } : {}),
          lastAttemptAt: sync.lastAttemptAt,
          ...(sync.lastError ? { lastError: sync.lastError } : { lastError: null }),
        }
      : { status: "never", lastError: null };
    return {
      name: remote.name,
      kind: remote.kind,
      url: remote.url,
      sync: syncStatus,
      publication: remote.kind === "workbench-cloud"
        ? publicationStatusFromRefs(snapshot.refs, remote.name)
        : unpublishedPublicationStatus(),
    };
  });
  return {
    schema: "workbench.status.v1",
    ok: true,
    project: {
      root,
      initialized: true,
      ...(currentVersionId ? { currentVersionId } : {}),
      ...(snapshot.status.defaultSkill ? { defaultSkill: snapshot.status.defaultSkill } : {}),
      ...(snapshot.status.defaultAgent ? { defaultAgent: snapshot.status.defaultAgent } : {}),
    },
    worktree: {
      ...(worktreeWouldCreateVersionId || currentVersionId ? { latestVersionId: worktreeWouldCreateVersionId ?? currentVersionId } : {}),
      ...(worktreeSourceState ? { sourceState: worktreeSourceState } : {}),
      ...(worktreeWouldCreateVersionId ? { wouldCreateVersionId: worktreeWouldCreateVersionId } : {}),
    },
    runs: {
      total: snapshot.runs.length,
      ...(lastRun ? {
        lastRunId: lastRun.id,
        lastStatus: lastRun.status,
        ...(lastRunScore !== undefined ? { lastScore: lastRunScore } : {}),
      } : {}),
      activeRuns: activeRunStatusEntries(snapshot),
    },
    remotes,
    next: null,
  };
}

function activeRunStatusEntries(
  snapshot: WorkbenchInspectionSnapshot,
): NonNullable<WorkbenchStatusSnapshot["runs"]["activeRuns"]> {
  const jobsByRun = new Map<string, WorkbenchJob[]>();
  for (const job of snapshot.jobs) {
    const entries = jobsByRun.get(job.runId) ?? [];
    entries.push(job);
    jobsByRun.set(job.runId, entries);
  }
  return snapshot.runs
    .filter((run) => run.status === "queued" || run.status === "running" || run.status === "canceling")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((run) => {
      const jobs = jobsByRun.get(run.id) ?? [];
      const lastProgressAt = run.lastProgressAt ?? latestJobProgressAt(jobs);
      return {
        id: run.id,
        kind: run.kind,
        location: run.location ?? "local",
        status: run.status,
        skillName: run.skillName,
        agentName: run.agentName,
        failed: jobs.filter((job) => job.status === "failed" || job.status === "canceled").length,
        elapsedMs: Math.max(0, Date.now() - Date.parse(run.createdAt)),
        ...(lastProgressAt ? { lastProgressAt } : {}),
        health: run.location === "cloud" ? "stale_local_state" : "healthy",
        next: `workbench watch ${run.id}`,
      };
    });
}

function latestJobProgressAt(jobs: readonly WorkbenchJob[]): string | undefined {
  return jobs
    .flatMap((job) => [job.finishedAt, job.startedAt, job.createdAt].filter((entry): entry is string => Boolean(entry)))
    .sort((left, right) => right.localeCompare(left))[0];
}

async function workbenchStatusUnlocked(root: string, options: WorkbenchCommandOptions = {}): Promise<WorkbenchStatus> {
  const [state, agents, skillSources] = await Promise.all([
    loadState(root),
    readAgents(root),
    readSkillSources(root),
  ]);
  const version = await reconcileWorkbenchVersion(root, state, SOURCE_SNAPSHOT_MESSAGE);
  upsertAgentSnapshots(state.agents, agents);
  state.skillSources = skillSources.map(copySkillSource);
  upsertEvalSnapshotObject(state.evals, await readEvalSnapshot(root));
  await saveState(root, state);
  const lastRun = state.runs
    .filter((run) => runQualityScoreFromJobs(run, state.jobs) !== undefined)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const lastRunScore = lastRun ? runQualityScoreFromJobs(lastRun, state.jobs) : undefined;
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
    ...(lastRunScore !== undefined ? { lastScore: lastRunScore } : {}),
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
      throw new WorkbenchUserError(`No agents configured. Run \`${providerAgentSetupCommand("codex", "default")}\`.`);
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
  await requireInitialized(root);
  const state = await loadStateReadOnlyWithRetry(root);
  return [...state.versions].sort(compareVersionIds);
}

export async function reconcileCurrentWorkbenchVersion(options: WorkbenchCommandOptions = {}): Promise<WorkbenchVersion> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const version = await reconcileWorkbenchVersion(root, state, SOURCE_SNAPSHOT_MESSAGE);
    await saveState(root, state);
    return copyVersion(version);
  });
}

export async function evalWorkbenchSkill(options: WorkbenchEvalOptions = {}): Promise<WorkbenchRun[]> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const version = await resolveOrCreateRunVersion(root, state, options.version);
    const runtimeAgents = await runtimeAgentOptionsForRoot(root, state);
    const runtime = await createWorkbenchVersionRuntimeSnapshot(version, {
      skill: options.skill,
      agent: options.agent,
      authToken: options.authToken,
      selectionRemediationCommand: "eval",
      ...runtimeAgents,
    });
    const agents = runtime.selectedAgents;
    for (const agent of agents) {
      assertSkillEvalAgentSupported(agent);
    }
    const skillBundles = runtime.skillBundles;
    const evalSnapshot = runtime.evalSnapshot;
    if (runtime.cases.length === 0) {
      throw noEvalCasesError();
    }
    const selectedCases = selectEvalCasesForRun(runtime.cases, options.caseIds, options.selectedSamples);
    assertDraftCaseReadinessReady(selectedCases, options.kind ?? "eval");
    if ((options.location ?? "local") === "local") {
      await assertLocalWorkbenchLaunchReady(agents, options);
    }
    for (const bundle of skillBundles) {
      upsertByHash(state.skillBundles, bundle);
    }
    upsertEvalSnapshotObject(state.evals, evalSnapshot);
    upsertAgentSnapshots(state.agents, runtime.agents);
    if (!options.version) {
      state.skillSources = runtime.skillSources.map(copySkillSource);
    }
    const samples = options.samples ?? 1;
    const reusableCaseCount = (options.selectedSamples?.length ?? 0) > 0 ? undefined : selectedCases.length;
    const targets = skillBundles.flatMap((skillBundle) =>
      agents.map((agent): WorkbenchEvaluationRunTarget => ({ skillBundle, agent }))
    );
    const primaryTarget = targets[0];
    if (!primaryTarget) {
      throw new WorkbenchUserError("No eval targets resolved for this run.");
    }
    await saveState(root, state);
    const reusableRunEvidence = options.rerun === true || reusableCaseCount === undefined || (options.kind ?? "eval") !== "run"
      ? undefined
      : materializeReusableExecutionMatrixRun({
          state,
          version,
          evalSnapshot,
          targets,
          cases: selectedCases,
          samples,
          location: options.location ?? "local",
          remoteName: options.remoteName,
        });
    if (reusableRunEvidence) {
      await saveState(root, state);
      return [copyRun(reusableRunEvidence)];
    }
    const reusable = options.rerun === true || reusableCaseCount === undefined || (options.kind ?? "eval") !== "eval"
      ? undefined
      : latestReusableEvalMatrixRun({
          state,
          versionId: version.id,
          evalHash: evalSnapshot.hash,
          targets,
          samples,
          caseCount: reusableCaseCount ?? 0,
    });
    if (reusable) {
      return [copyRun(reusable)];
    }
    const reusableSplitEvidence = options.rerun === true || reusableCaseCount === undefined || (options.kind ?? "eval") !== "eval"
      ? undefined
      : materializeReusableSplitEvalMatrixRun({
          state,
          version,
          evalSnapshot,
          targets,
          cases: selectedCases,
          samples,
          location: options.location ?? "local",
          remoteName: options.remoteName,
        });
    if (reusableSplitEvidence) {
      await saveState(root, state);
      return [copyRun(reusableSplitEvidence)];
    }
    const run = await executeWorkbenchEvaluationRun({
      root,
      state,
      adapterAuthStoreRoot: options.adapterAuthStoreRoot,
      version,
      skillBundle: primaryTarget.skillBundle,
      evalSnapshot,
      agent: primaryTarget.agent,
      targets,
      kind: options.kind ?? "eval",
      parentRunId: options.parentRunId,
      location: options.location ?? "local",
      remoteName: options.remoteName,
      retryOfRunId: options.retryOfRunId,
      rerun: options.rerun === true,
      samples,
      cases: runtime.cases,
      environmentDockerfile: runtime.environmentDockerfile,
      caseIds: options.caseIds,
      selectedSamples: options.selectedSamples,
      onRunStarted: options.onRunStarted,
    });
    await saveState(root, state);
    return [run];
  });
}

export async function gradeWorkbenchSkill(options: WorkbenchEvalOptions = {}): Promise<WorkbenchRun[]> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const version = await resolveOrCreateRunVersion(root, state, options.version);
    const runtimeAgents = await runtimeAgentOptionsForRoot(root, state);
    const runtime = await createWorkbenchVersionRuntimeSnapshot(version, {
      skill: options.skill,
      agent: options.agent,
      authToken: options.authToken,
      selectionRemediationCommand: "grade",
      ...runtimeAgents,
    });
    const agents = runtime.selectedAgents;
    for (const agent of agents) {
      assertSkillEvalAgentSupported(agent);
    }
    if (runtime.cases.length === 0) {
      throw noEvalCasesError();
    }
    const selectedCases = selectEvalCasesForRun(runtime.cases, options.caseIds, options.selectedSamples);
    assertDraftCaseReadinessReady(selectedCases, "grade");
    if ((options.location ?? "local") === "local") {
      await assertLocalWorkbenchLaunchReady(agents, options);
    }
    for (const bundle of runtime.skillBundles) {
      upsertByHash(state.skillBundles, bundle);
    }
    upsertEvalSnapshotObject(state.evals, runtime.evalSnapshot);
    upsertAgentSnapshots(state.agents, runtime.agents);
    const targets = runtime.skillBundles.flatMap((skillBundle) =>
      agents.map((agent): WorkbenchEvaluationRunTarget => ({ skillBundle, agent }))
    );
    const gradeSelection = gradeSubjectsForRuntime({
      state,
      evalSnapshot: runtime.evalSnapshot,
      targets,
      cases: selectedCases,
      rerun: options.rerun === true,
    });
    if (gradeSelection.subjects.length === 0) {
      if (options.rerun !== true && gradeSelection.reusableRun) {
        return [copyRun(gradeSelection.reusableRun)];
      }
      throw new WorkbenchCodedError("no_grade_subjects", "No ungraded execution jobs found for the selected skill, agent, and cases.", {
        remediation: "workbench run",
        exitCode: 2,
      });
    }
    const primary = targets[0]!;
    const createdAt = now();
    const samples = options.samples ?? 1;
    const run: WorkbenchRun = {
      id: nextRunId(),
      kind: "grade",
      versionId: version.id,
      skillName: primary.skillBundle.skillName,
      skillBundleHash: primary.skillBundle.hash,
      evalHash: runtime.evalSnapshot.hash,
      agentName: primary.agent.name,
      agentHash: hashJson(primary.agent),
      status: "running",
      operationPlan: operationPlanSummaryForRun({
        kind: "grade",
        variant: options.location ?? "local",
        versionId: version.id,
        evalHash: runtime.evalSnapshot.hash,
        skillNames: targets.map((target) => target.skillBundle.skillName),
        agentNames: targets.map((target) => target.agent.name),
        caseIds: selectedCases.map((runtimeCase) => runtimeCase.id),
        samples,
        rerun: options.rerun === true,
      }),
      jobIds: [],
      traceIds: [],
      createdAt,
      location: options.location ?? "local",
      requestedSamples: samples,
      lastProgressAt: createdAt,
    };
    upsertRunObject(state.runs, run);
    await saveState(root, state);
    await options.onRunStarted?.(copyRun(run));
    const jobs: WorkbenchJob[] = [];
    for (const subject of gradeSelection.subjects) {
      const completed = completedEvaluationJobFromGradeSubject({
        root,
        state,
        run,
        version,
        evalSnapshot: runtime.evalSnapshot,
        environmentDockerfile: runtime.environmentDockerfile,
        subject,
      });
      const result = await executeSkillEvalGradeJob({
        root,
        state,
        adapterAuthStoreRoot: options.adapterAuthStoreRoot,
        run,
        version,
        evalSnapshot: runtime.evalSnapshot,
        completed,
      });
      jobs.push(result.job);
      run.jobIds = Array.from(new Set([...(run.jobIds ?? []), result.job.id]));
      run.traceIds = Array.from(new Set([...run.traceIds, result.trace.id]));
      run.lastProgressAt = result.job.finishedAt ?? result.job.startedAt ?? now();
      upsertJobObject(state.jobs, result.job);
      upsertImmutableById(state.artifacts, result.artifact, "artifact");
      upsertImmutableById(state.traces, result.trace, "trace");
      upsertRunObject(state.runs, run, { replace: true });
      await saveState(root, state);
    }
    const finishedAt = now();
    run.finishedAt = finishedAt;
    run.lastProgressAt = finishedAt;
    run.status = jobs.every((job) => job.status === "succeeded")
      ? "succeeded"
      : jobs.some((job) => job.status === "canceled")
        ? "canceled"
        : "failed";
    run.latencyMs = jobs.reduce((sum, job) => sum + (job.durationMs ?? 0), 0);
    const errors = jobs.flatMap((job) => job.error ? [job.error] : []);
    if (errors.length > 0) {
      run.error = summarizeJobErrors(errors);
    }
    upsertRunObject(state.runs, run, { replace: true });
    await saveState(root, state);
    return [copyRun(run)];
  });
}

interface WorkbenchGradeSubject {
  job: WorkbenchJob;
  artifact: WorkbenchArtifact;
  trace: WorkbenchTrace;
  skillBundle: WorkbenchSkillBundleSnapshot;
  agent: WorkbenchAgent;
  runtimeCase: WorkbenchEvalCaseRuntime;
}

function gradeSubjectsForRuntime(args: {
  state: WorkbenchProjectState;
  evalSnapshot: WorkbenchEvalSnapshot;
  targets: readonly WorkbenchEvaluationRunTarget[];
  cases: readonly WorkbenchEvalCaseRuntime[];
  rerun: boolean;
}): { subjects: WorkbenchGradeSubject[]; reusableRun?: WorkbenchRun } {
  const casesById = new Map(args.cases.flatMap((runtimeCase) => [
    [runtimeCase.id, runtimeCase],
    [runtimeCase.path, runtimeCase],
  ]));
  const targetsByKey = new Map(args.targets.map((target) => [
    gradeTargetKey(target.skillBundle.hash, hashJson(target.agent)),
    target,
  ]));
  const currentGradedSubjectJobIds = new Set(args.state.jobs.flatMap((job) =>
    job.role === "grade" && isReusableTerminalGradeStatus(job.status) && job.evalHash === args.evalSnapshot.hash
      ? (job.dependencies ?? []).flatMap((dependency) => dependency.jobId ? [dependency.jobId] : [])
      : []
  ));
  const eligibleSubjects: WorkbenchGradeSubject[] = [];
  for (const job of args.state.jobs) {
    if ((job.role ?? "execute") !== "execute" || job.status !== "succeeded") {
      continue;
    }
    const target = targetsByKey.get(gradeTargetKey(job.skillBundleHash, job.agentHash));
    const runtimeCase = casesById.get(job.caseId);
    if (!target || !runtimeCase || !executionJobMatchesCurrentEvalCase(args.state, job, args.evalSnapshot, runtimeCase)) {
      continue;
    }
    const artifact = job.artifactIds.flatMap((id) => args.state.artifacts.find((entry) => entry.id === id) ?? [])[0];
    const trace = job.traceIds.flatMap((id) => args.state.traces.find((entry) => entry.id === id) ?? [])[0];
    if (!target || !runtimeCase || !artifact || !trace) {
      continue;
    }
    eligibleSubjects.push({
      job,
      artifact,
      trace,
      skillBundle: target.skillBundle,
      agent: target.agent,
      runtimeCase,
    });
  }
  const sortedEligibleSubjects = eligibleSubjects.sort((left, right) =>
    left.job.caseId.localeCompare(right.job.caseId) ||
    left.job.sample - right.job.sample ||
    left.job.skillName.localeCompare(right.job.skillName) ||
    left.job.agentName.localeCompare(right.job.agentName) ||
    left.job.id.localeCompare(right.job.id)
  );
  const subjects = args.rerun
    ? sortedEligibleSubjects
    : sortedEligibleSubjects.filter((subject) => !currentGradedSubjectJobIds.has(subject.job.id));
  return {
    subjects,
    ...(args.rerun ? {} : {
      reusableRun: latestReusableGradeRun({
        state: args.state,
        evalHash: args.evalSnapshot.hash,
        eligibleSubjects: sortedEligibleSubjects,
      }),
    }),
  };
}

function gradeTargetKey(skillBundleHash: string, agentHash: string): string {
  return `${skillBundleHash}\0${agentHash}`;
}

function latestReusableGradeRun(args: {
  state: WorkbenchProjectState;
  evalHash: string;
  eligibleSubjects: readonly WorkbenchGradeSubject[];
}): WorkbenchRun | undefined {
  const eligibleSubjectJobIds = new Set(args.eligibleSubjects.map((subject) => subject.job.id));
  if (eligibleSubjectJobIds.size === 0) {
    return undefined;
  }
  return args.state.runs
    .filter((run) =>
      run.kind === "grade" &&
      run.evalHash === args.evalHash &&
      isReusableTerminalGradeStatus(run.status)
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .find((run) => {
      const gradeJobs = args.state.jobs.filter((job) =>
        job.runId === run.id &&
        job.role === "grade" &&
        isReusableTerminalGradeStatus(job.status) &&
        job.evalHash === args.evalHash
      );
      const gradedSubjectIds = new Set(gradeJobs.flatMap((job) =>
        (job.dependencies ?? []).flatMap((dependency) => dependency.jobId ? [dependency.jobId] : [])
      ));
      return [...eligibleSubjectJobIds].every((jobId) => gradedSubjectIds.has(jobId));
    });
}

function isReusableTerminalGradeStatus(status: WorkbenchJob["status"] | WorkbenchRun["status"]): boolean {
  return status === "succeeded" || status === "failed";
}

function materializeReusableSplitEvalMatrixRun(args: {
  state: WorkbenchProjectState;
  version: WorkbenchVersion;
  evalSnapshot: WorkbenchEvalSnapshot;
  targets: readonly WorkbenchEvaluationRunTarget[];
  cases: readonly WorkbenchEvalCaseRuntime[];
  samples: number;
  location: WorkbenchRunLocation;
  remoteName?: string;
}): WorkbenchRun | undefined {
  const primaryTarget = args.targets[0];
  if (!primaryTarget) {
    return undefined;
  }
  const evidence = reusableSplitEvalMatrixEvidence(args);
  if (!evidence) {
    return undefined;
  }
  const createdAt = now();
  const run: WorkbenchRun = {
    id: nextRunId(),
    kind: "eval",
    versionId: args.version.id,
    skillName: primaryTarget.skillBundle.skillName,
    skillBundleHash: primaryTarget.skillBundle.hash,
    evalHash: args.evalSnapshot.hash,
    agentName: primaryTarget.agent.name,
    agentHash: hashJson(primaryTarget.agent),
    status: "succeeded",
    jobIds: evidence.jobs.map((job) => job.id),
    traceIds: uniqueStrings(evidence.jobs.flatMap((job) => job.traceIds)),
    createdAt,
    finishedAt: createdAt,
    lastProgressAt: createdAt,
    location: args.location,
    ...(args.remoteName ? { remoteName: args.remoteName } : {}),
    requestedSamples: Math.max(1, Math.floor(args.samples)),
    operationPlan: operationPlanSummaryForRun({
      kind: "eval",
      variant: args.location,
      versionId: args.version.id,
      evalHash: args.evalSnapshot.hash,
      skillNames: args.targets.map((target) => target.skillBundle.skillName),
      agentNames: args.targets.map((target) => target.agent.name),
      caseIds: args.cases.map((runtimeCase) => runtimeCase.id),
      samples: Math.max(1, Math.floor(args.samples)),
    }),
  };
  upsertRunObject(args.state.runs, run);
  return run;
}

function materializeReusableExecutionMatrixRun(args: {
  state: WorkbenchProjectState;
  version: WorkbenchVersion;
  evalSnapshot: WorkbenchEvalSnapshot;
  targets: readonly WorkbenchEvaluationRunTarget[];
  cases: readonly WorkbenchEvalCaseRuntime[];
  samples: number;
  location: WorkbenchRunLocation;
  remoteName?: string;
}): WorkbenchRun | undefined {
  const primaryTarget = args.targets[0];
  if (!primaryTarget) {
    return undefined;
  }
  const evidence = reusableExecutionMatrixEvidence(args);
  if (!evidence) {
    return undefined;
  }
  const createdAt = now();
  const run: WorkbenchRun = {
    id: nextRunId(),
    kind: "run",
    versionId: args.version.id,
    skillName: primaryTarget.skillBundle.skillName,
    skillBundleHash: primaryTarget.skillBundle.hash,
    evalHash: args.evalSnapshot.hash,
    agentName: primaryTarget.agent.name,
    agentHash: hashJson(primaryTarget.agent),
    status: "succeeded",
    jobIds: evidence.jobs.map((job) => job.id),
    traceIds: uniqueStrings(evidence.jobs.flatMap((job) => job.traceIds)),
    createdAt,
    finishedAt: createdAt,
    lastProgressAt: createdAt,
    location: args.location,
    ...(args.remoteName ? { remoteName: args.remoteName } : {}),
    requestedSamples: Math.max(1, Math.floor(args.samples)),
    operationPlan: operationPlanSummaryForRun({
      kind: "run",
      variant: args.location,
      versionId: args.version.id,
      evalHash: args.evalSnapshot.hash,
      skillNames: args.targets.map((target) => target.skillBundle.skillName),
      agentNames: args.targets.map((target) => target.agent.name),
      caseIds: args.cases.map((runtimeCase) => runtimeCase.id),
      samples: Math.max(1, Math.floor(args.samples)),
    }),
  };
  upsertRunObject(args.state.runs, run);
  return run;
}

function reusableExecutionMatrixEvidence(args: {
  state: WorkbenchProjectState;
  version: WorkbenchVersion;
  evalSnapshot: WorkbenchEvalSnapshot;
  targets: readonly WorkbenchEvaluationRunTarget[];
  cases: readonly WorkbenchEvalCaseRuntime[];
  samples: number;
}): { jobs: WorkbenchJob[] } | undefined {
  const samples = Math.max(1, Math.floor(args.samples));
  const targetsByKey = new Map(args.targets.map((target) => [
    splitEvalTargetKey({
      versionId: args.version.id,
      skillName: target.skillBundle.skillName,
      skillBundleHash: target.skillBundle.hash,
      agentName: target.agent.name,
      agentHash: hashJson(target.agent),
    }),
    target,
  ]));
  if (targetsByKey.size === 0 || args.cases.length === 0) {
    return undefined;
  }
  const expectedKeys: string[] = [];
  for (const targetKey of targetsByKey.keys()) {
    for (const runtimeCase of args.cases) {
      for (const sample of sampleIndexesForRun(runtimeCase, samples, undefined)) {
        expectedKeys.push(splitEvalEvidenceKey(targetKey, runtimeCase.id, sample));
      }
    }
  }
  const executeJobsByKey = new Map<string, WorkbenchJob[]>();
  const casesById = new Map(args.cases.flatMap((runtimeCase) => [
    [runtimeCase.id, runtimeCase],
    [runtimeCase.path, runtimeCase],
  ]));
  const expectedKeySet = new Set(expectedKeys);
  for (const job of args.state.jobs) {
    if ((job.role ?? "execute") !== "execute" || job.status !== "succeeded") {
      continue;
    }
    const runtimeCase = casesById.get(job.caseId);
    const targetKey = splitEvalTargetKey(job);
    const key = splitEvalEvidenceKey(targetKey, job.caseId, job.sample);
    if (
      !runtimeCase ||
      !targetsByKey.has(targetKey) ||
      !expectedKeySet.has(key) ||
      !executionJobMatchesCurrentEvalCase(args.state, job, args.evalSnapshot, runtimeCase)
    ) {
      continue;
    }
    const current = executeJobsByKey.get(key) ?? [];
    current.push(job);
    executeJobsByKey.set(key, current);
  }
  for (const jobs of executeJobsByKey.values()) {
    jobs.sort(compareJobsNewestFirst);
  }
  const reusableJobs: WorkbenchJob[] = [];
  for (const key of expectedKeys.sort()) {
    const executeJob = executeJobsByKey.get(key)?.[0];
    if (!executeJob) {
      return undefined;
    }
    reusableJobs.push(executeJob);
  }
  return { jobs: dedupeJobs(reusableJobs) };
}

function reusableSplitEvalMatrixEvidence(args: {
  state: WorkbenchProjectState;
  version: WorkbenchVersion;
  evalSnapshot: WorkbenchEvalSnapshot;
  targets: readonly WorkbenchEvaluationRunTarget[];
  cases: readonly WorkbenchEvalCaseRuntime[];
  samples: number;
}): { jobs: WorkbenchJob[] } | undefined {
  const execution = reusableExecutionMatrixEvidence(args);
  if (!execution) {
    return undefined;
  }
  const samples = Math.max(1, Math.floor(args.samples));
  const targetsByKey = new Map(args.targets.map((target) => [
    splitEvalTargetKey({
      versionId: args.version.id,
      skillName: target.skillBundle.skillName,
      skillBundleHash: target.skillBundle.hash,
      agentName: target.agent.name,
      agentHash: hashJson(target.agent),
    }),
    target,
  ]));
  if (targetsByKey.size === 0 || args.cases.length === 0) {
    return undefined;
  }
  const expectedKeys: string[] = [];
  for (const targetKey of targetsByKey.keys()) {
    for (const runtimeCase of args.cases) {
      for (const sample of sampleIndexesForRun(runtimeCase, samples, undefined)) {
        expectedKeys.push(splitEvalEvidenceKey(targetKey, runtimeCase.id, sample));
      }
    }
  }
  const expectedKeySet = new Set(expectedKeys);
  const executeJobsByKey = new Map<string, WorkbenchJob[]>();
  for (const job of execution.jobs) {
    const targetKey = splitEvalTargetKey(job);
    const key = splitEvalEvidenceKey(targetKey, job.caseId, job.sample);
    if (!targetsByKey.has(targetKey) || !expectedKeySet.has(key)) {
      continue;
    }
    const current = executeJobsByKey.get(key) ?? [];
    current.push(job);
    executeJobsByKey.set(key, current);
  }
  const gradeJobsByExecuteJobId = new Map<string, WorkbenchJob[]>();
  for (const job of args.state.jobs) {
    if (
      job.role !== "grade" ||
      job.status !== "succeeded" ||
      job.evalHash !== args.evalSnapshot.hash ||
      jobQualityScore(job) === undefined
    ) {
      continue;
    }
    const targetKey = splitEvalTargetKey(job);
    const key = splitEvalEvidenceKey(targetKey, job.caseId, job.sample);
    if (!targetsByKey.has(targetKey) || !expectedKeySet.has(key)) {
      continue;
    }
    for (const dependency of job.dependencies ?? []) {
      if (!dependency.jobId) {
        continue;
      }
      const current = gradeJobsByExecuteJobId.get(dependency.jobId) ?? [];
      current.push(job);
      gradeJobsByExecuteJobId.set(dependency.jobId, current);
    }
  }
  for (const jobs of gradeJobsByExecuteJobId.values()) {
    jobs.sort(compareJobsNewestFirst);
  }
  const reusableJobs: WorkbenchJob[] = [];
  for (const key of expectedKeys.sort()) {
    const executeJob = executeJobsByKey.get(key)?.[0];
    if (!executeJob) {
      return undefined;
    }
    const gradeJob = gradeJobsByExecuteJobId.get(executeJob.id)?.find((candidate) =>
      splitEvalEvidenceKey(splitEvalTargetKey(candidate), candidate.caseId, candidate.sample) === key
    );
    if (!gradeJob) {
      return undefined;
    }
    reusableJobs.push(executeJob, gradeJob);
  }
  return { jobs: dedupeJobs(reusableJobs) };
}

function splitEvalTargetKey(args: {
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  agentName: string;
  agentHash: string;
}): string {
  return [
    args.skillName,
    args.skillBundleHash,
    args.agentName,
    args.agentHash,
  ].join("\0");
}

function splitEvalEvidenceKey(targetKey: string, caseId: string, sample: number): string {
  return [targetKey, caseId, String(sample)].join("\0");
}

function compareJobsNewestFirst(left: WorkbenchJob, right: WorkbenchJob): number {
  return jobObservedAt(right).localeCompare(jobObservedAt(left)) || right.id.localeCompare(left.id);
}

function jobObservedAt(job: WorkbenchJob): string {
  return job.finishedAt ?? job.startedAt ?? job.createdAt;
}

function dedupeJobs(jobs: readonly WorkbenchJob[]): WorkbenchJob[] {
  const byId = new Map<string, WorkbenchJob>();
  for (const job of jobs) {
    byId.set(job.id, job);
  }
  return [...byId.values()];
}

function executionJobMatchesCurrentEvalCase(
  state: WorkbenchProjectState,
  job: WorkbenchJob,
  evalSnapshot: WorkbenchEvalSnapshot,
  runtimeCase: WorkbenchEvalCaseRuntime,
): boolean {
  if (job.evalHash === evalSnapshot.hash) {
    return true;
  }
  const jobEvalSnapshot = state.evals.find((entry) => entry.hash === job.evalHash);
  if (!jobEvalSnapshot) {
    return false;
  }
  const previous = evalCaseExecutionFingerprint(jobEvalSnapshot, runtimeCase.id);
  const current = evalCaseExecutionFingerprint(evalSnapshot, runtimeCase.id);
  return previous !== null && current !== null && previous === current;
}

function evalCaseExecutionFingerprint(evalSnapshot: WorkbenchEvalSnapshot, caseId: string): string | null {
  const runtimeCase = evalSnapshot.cases.find((entry) => entry.id === caseId);
  if (!runtimeCase) {
    return null;
  }
  const caseRoot = evalSnapshotCaseRoot(runtimeCase);
  const caseFiles = runtimeCase.files.map((file) => {
    const localPath = normalizeEvalCaseLocalPath(file.path, caseRoot);
    const content = isCaseDescriptorPath(localPath)
      ? comparableEvalCaseDescriptorContent(file.content)
      : file.content;
    return {
      ...copyFile(file),
      path: normalizeRelativePath(`${CASES_DIR}/${runtimeCase.id}/${localPath}`),
      content,
    };
  });
  const environmentFiles = evalSnapshot.files
    .filter((file) => normalizeRelativePath(file.path).startsWith(`${ENVIRONMENT_DIR}/`))
    .map(copyFile);
  return hashFiles([...caseFiles, ...environmentFiles].sort((left, right) => left.path.localeCompare(right.path)));
}

function evalSnapshotCaseRoot(runtimeCase: WorkbenchEvalCaseSnapshot): string {
  const normalized = normalizeRelativePath(runtimeCase.path);
  if (!normalized.startsWith(`${CASES_DIR}/`)) {
    return "";
  }
  return isCaseDescriptorPath(normalized.slice(CASES_DIR.length + 1))
    ? normalizeRelativePath(path.posix.dirname(normalized))
    : normalized;
}

function normalizeEvalCaseLocalPath(filePath: string, caseRoot: string): string {
  const normalized = normalizeRelativePath(filePath);
  if (caseRoot && normalized.startsWith(`${caseRoot}/`)) {
    return normalized.slice(caseRoot.length + 1);
  }
  if (caseRoot && normalized === caseRoot) {
    return path.posix.basename(normalized);
  }
  if (normalized.startsWith(`${CASES_DIR}/`)) {
    return normalized.slice(CASES_DIR.length + 1);
  }
  return normalized;
}

function comparableEvalCaseDescriptorContent(content: string): string {
  const record = parseCaseSnapshotRecord(content);
  delete record.rubric;
  return `${YAML.stringify(canonicalize(record)).trimEnd()}\n`;
}

function reusableExecutionSubjectForPlannedJob(args: {
  state: WorkbenchProjectState;
  version: WorkbenchVersion;
  evalSnapshot: WorkbenchEvalSnapshot;
  plannedJob: PlannedWorkbenchEvaluationJob;
}): WorkbenchGradeSubject | undefined {
  const candidates = args.state.jobs
    .filter((job) =>
      (job.role ?? "execute") === "execute" &&
      job.status === "succeeded" &&
      job.skillBundleHash === args.plannedJob.skillBundle.hash &&
      job.agentHash === hashJson(args.plannedJob.agent) &&
      job.caseId === args.plannedJob.runtimeCase.id &&
      job.sample === args.plannedJob.sample &&
      executionJobMatchesCurrentEvalCase(args.state, job, args.evalSnapshot, args.plannedJob.runtimeCase)
    )
    .sort(compareJobsNewestFirst);
  for (const job of candidates) {
    const artifact = job.artifactIds.flatMap((id) => args.state.artifacts.find((entry) => entry.id === id) ?? [])[0];
    const trace = job.traceIds.flatMap((id) => args.state.traces.find((entry) => entry.id === id) ?? [])[0];
    if (!artifact || !trace) {
      continue;
    }
    return {
      job,
      artifact,
      trace,
      skillBundle: args.plannedJob.skillBundle,
      agent: args.plannedJob.agent,
      runtimeCase: args.plannedJob.runtimeCase,
    };
  }
  return undefined;
}

function latestReusableTerminalGradeJobForExecution(args: {
  state: WorkbenchProjectState;
  evalHash: string;
  executionJob: WorkbenchJob;
}): WorkbenchJob | undefined {
  return args.state.jobs
    .filter((job) =>
      job.role === "grade" &&
      isReusableTerminalGradeStatus(job.status) &&
      job.evalHash === args.evalHash &&
      job.versionId === args.executionJob.versionId &&
      job.skillBundleHash === args.executionJob.skillBundleHash &&
      job.agentHash === args.executionJob.agentHash &&
      job.caseId === args.executionJob.caseId &&
      job.sample === args.executionJob.sample &&
      (job.dependencies ?? []).some((dependency) => dependency.jobId === args.executionJob.id)
    )
    .sort(compareJobsNewestFirst)[0];
}

function completedEvaluationJobFromGradeSubject(args: {
  root: string;
  state: WorkbenchProjectState;
  run: WorkbenchRun;
  version: WorkbenchVersion;
  evalSnapshot: WorkbenchEvalSnapshot;
  environmentDockerfile?: string;
  subject: WorkbenchGradeSubject;
}): CompletedWorkbenchEvaluationJob {
  const seedJobId = nextJobId();
  const input = createWorkbenchSkillEvalRuntimeInput({
    ownerUserId: "local",
    projectId: "local",
    runId: args.run.id,
    jobId: seedJobId,
    versionId: args.version.id,
    skillName: args.subject.skillBundle.skillName,
    skillBundleHash: args.subject.skillBundle.hash,
    evalHash: args.evalSnapshot.hash,
    evalSnapshot: args.evalSnapshot,
    agent: args.subject.agent,
    versionFiles: args.subject.skillBundle.files,
    runtimeCase: args.subject.runtimeCase,
    sample: args.subject.job.sample,
    environmentDockerfile: args.environmentDockerfile,
  });
  const outputFiles = normalizeSubjectOutputFiles(args.subject.artifact.files
    .filter((file) => !normalizeRelativePath(file.path).startsWith("workspace/"))
    .map(copyFile));
  const workspaceFiles = stripSurfaceFilePrefix("workspace", args.subject.artifact.files);
  const remoteJob: RemoteWorkbenchJob = {
    id: args.subject.job.id,
    projectId: "local",
    runId: args.subject.job.runId,
    versionId: args.subject.job.versionId,
    kind: "execute",
    status: "succeeded",
    attempt: 1,
    createdAt: args.subject.job.createdAt,
    updatedAt: args.subject.job.finishedAt ?? args.subject.job.startedAt ?? args.subject.job.createdAt,
    ...(args.subject.job.startedAt ? { startedAt: args.subject.job.startedAt } : {}),
    ...(args.subject.job.finishedAt ? { finishedAt: args.subject.job.finishedAt } : {}),
    input: {
      execution: jsonRecord(input.job.input).execution ?? null,
    } as unknown as Json,
    output: {
      ok: true,
      files: outputFiles as unknown as Json,
      workspaceFiles: workspaceFiles as unknown as Json,
      result: args.subject.trace.result,
    } as unknown as Json,
  };
  return {
    remoteJob,
    plannedJob: {
      input,
      runtimeCase: args.subject.runtimeCase,
      sample: args.subject.job.sample,
      artifactId: args.subject.artifact.id,
      traceId: args.subject.trace.id,
      skillBundle: args.subject.skillBundle,
      agent: args.subject.agent,
    },
    objects: {
      job: args.subject.job,
      artifact: args.subject.artifact,
      trace: args.subject.trace,
    },
  };
}

function stripSurfaceFilePrefix(prefix: string, files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  const normalizedPrefix = normalizeRelativePath(prefix).replace(/\/+$/u, "");
  return files.flatMap((file) => {
    const normalizedPath = normalizeRelativePath(file.path);
    const prefixWithSlash = `${normalizedPrefix}/`;
    if (!normalizedPath.startsWith(prefixWithSlash)) {
      return [];
    }
    return [{
      ...copyFile(file),
      path: normalizedPath.slice(prefixWithSlash.length),
    }];
  });
}

export async function previewWorkbenchEval(options: WorkbenchEvalOptions & { cloud?: boolean } = {}): Promise<WorkbenchEvalPreview> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  const state = await loadStateReadOnlyWithRetry(root);
  const source = await planWorkbenchLaunchSource(root, state, {
    ref: options.version,
    commit: false,
    message: SOURCE_SNAPSHOT_MESSAGE,
  });
  const version = source.version;
  const runtimeAgents = await runtimeAgentOptionsForRoot(root, state);
  const runtime = await createWorkbenchVersionRuntimeSnapshot(version, {
    skill: options.skill,
    agent: options.agent,
    authToken: options.authToken,
    selectionRemediationCommand: "eval",
    ...runtimeAgents,
  });
  for (const agent of runtime.selectedAgents) {
    assertSkillEvalAgentSupported(agent);
  }
  const selectedCases = selectEvalCasesForRun(runtime.cases, options.caseIds, options.selectedSamples);
  const draftCaseIssues = runtime.cases.length === 0
    ? []
    : draftCaseReadinessIssues(selectedCases, options.kind ?? "eval");
  const localReadiness = options.cloud === true
    ? readyWorkbenchLaunchReadiness()
    : runtime.cases.length === 0
      ? await localWorkbenchAdapterAuthReadiness(runtime.selectedAgents, options)
      : await localWorkbenchLaunchReadiness(runtime.selectedAgents, options);
  const readiness = runtime.cases.length === 0
    ? readinessFromIssues([noEvalCasesReadinessIssue(), ...localReadiness.issues])
    : readinessFromIssues([...draftCaseIssues, ...localReadiness.issues]);
  const adapterAuthTargets = uniqueLocalAdapterAuthTargets(runtime.selectedAgents.flatMap(localAdapterAuthTargetsForAgent));
  const samples = options.samples ?? 1;
  const targets = runtime.skillBundles.flatMap((skillBundle) =>
    runtime.selectedAgents.map((agent): WorkbenchEvaluationRunTarget => ({ skillBundle, agent }))
  );
  const cached = cachedEvalPreviewEvidence({
    state,
    version,
    evalSnapshot: runtime.evalSnapshot,
    targets,
    cases: selectedCases,
    samples,
    kind: options.kind ?? "eval",
    cloud: options.cloud === true,
    rerun: options.rerun === true,
    selectedSamples: options.selectedSamples,
  });
  return {
    dryRun: true,
    location: options.cloud === true ? "cloud" : "local",
    versionId: version.id,
    sourceState: source.sourceState,
    ...(source.wouldCreateVersionId ? { wouldCreateVersionId: source.wouldCreateVersionId } : {}),
    evalHash: runtime.evalSnapshot.hash,
    skills: runtime.skillBundles.map((bundle) => ({ name: bundle.skillName, hash: bundle.hash })),
    agents: runtime.selectedAgents.map((agent) => ({ name: agent.name, hash: hashJson(agent) })),
    cases: selectedCases.length,
    samples,
    cachedRunIds: cached.runIds,
    cachedJobIds: cached.jobIds,
    adapterAuthTargets,
    readiness,
  };
}

function cachedEvalPreviewEvidence(args: {
  state: WorkbenchProjectState;
  version: WorkbenchVersion;
  evalSnapshot: WorkbenchEvalSnapshot;
  targets: readonly WorkbenchEvaluationRunTarget[];
  cases: readonly WorkbenchEvalCaseRuntime[];
  samples: number;
  kind: WorkbenchRunKind;
  cloud: boolean;
  rerun: boolean;
  selectedSamples?: readonly unknown[];
}): { runIds: string[]; jobIds: string[] } {
  if (
    args.cloud ||
    args.rerun ||
    args.cases.length === 0 ||
    (args.selectedSamples?.length ?? 0) > 0
  ) {
    return { runIds: [], jobIds: [] };
  }
  if (args.kind === "run") {
    const execution = reusableExecutionMatrixEvidence({
      state: args.state,
      version: args.version,
      evalSnapshot: args.evalSnapshot,
      targets: args.targets,
      cases: args.cases,
      samples: args.samples,
    });
    return execution
      ? {
          runIds: uniqueStrings(execution.jobs.map((job) => job.runId)),
          jobIds: execution.jobs.map((job) => job.id),
        }
      : { runIds: [], jobIds: [] };
  }
  if (args.kind !== "eval") {
    return { runIds: [], jobIds: [] };
  }
  const wholeRunIds = uniqueStrings(args.targets.flatMap((target) => {
    const reusable = latestReusableEvalRun({
      state: args.state,
      versionId: args.version.id,
      skillName: target.skillBundle.skillName,
      skillBundleHash: target.skillBundle.hash,
      evalHash: args.evalSnapshot.hash,
      agentName: target.agent.name,
      agentHash: hashJson(target.agent),
      samples: args.samples,
      caseCount: args.cases.length,
    });
    return reusable ? [reusable.id] : [];
  }));
  if (wholeRunIds.length > 0) {
    return { runIds: wholeRunIds, jobIds: [] };
  }
  const split = reusableSplitEvalMatrixEvidence({
    state: args.state,
    version: args.version,
    evalSnapshot: args.evalSnapshot,
    targets: args.targets,
    cases: args.cases,
    samples: args.samples,
  });
  if (!split) {
    return { runIds: [], jobIds: [] };
  }
  return {
    runIds: uniqueStrings(split.jobs.map((job) => job.runId)),
    jobIds: split.jobs.map((job) => job.id),
  };
}

export async function prepareWorkbenchCloudEvalRequest(
  options: Pick<WorkbenchEvalOptions, "dir" | "authToken" | "skill" | "agent" | "caseIds" | "samples" | "rerun"> = {},
): Promise<WorkbenchPreparedCloudEvalRequest> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const cases = await readEvalCases(root);
    if (cases.length === 0) {
      throw noEvalCasesError();
    }
    assertDraftCaseReadinessReady(selectEvalCasesForRun(cases, options.caseIds, undefined), "eval");
    const state = await loadState(root);
    const version = await resolveOrCreateRunVersion(root, state);
    await saveState(root, state);
    return {
      versionId: version.id,
      ...(options.skill !== undefined ? { skill: options.skill } : {}),
      ...(options.agent !== undefined ? { agent: options.agent } : {}),
      ...(options.caseIds?.length ? { caseIds: [...options.caseIds] } : {}),
      samples: options.samples ?? 1,
      ...(options.rerun === true ? { rerun: true } : {}),
    };
  });
}

export function resolveWorkbenchRunRetryPlan(
  snapshot: WorkbenchInspectionSnapshot,
  run: WorkbenchRun,
): WorkbenchRunRetryPlan {
  if (run.kind !== "eval" && run.kind !== "improve") {
    throw new WorkbenchCodedError("run_retry_unsupported", `Run ${run.id} is a ${run.kind} run and cannot be retried.`, {
      remediation: "workbench eval",
      subject: { runId: run.id, kind: run.kind },
      exitCode: 2,
    });
  }
  const plan = retryOperationPlanForRun(run);
  const location = plan.variant;
  const samples = positiveRetryInteger(run, plan.samples, "operationPlan.samples");
  if (samples === undefined) {
    throw retryIncompleteError(run, `Run ${run.id} does not record operationPlan.samples.`);
  }
  if (run.kind === "eval") {
    const skillName = retrySelection(run, plan.skills, "skills");
    const agentName = retrySelection(run, plan.agents, "agents");
    const versionId = retryVersionId(run, plan);
    requireRetryVersion(snapshot, versionId, run);
    return {
      kind: "eval",
      location,
      ...(run.remoteName ? { remoteName: run.remoteName } : {}),
      versionId,
      skillName,
      agentName,
      ...(plan.caseIds ? { caseIds: [...plan.caseIds] } : {}),
      samples,
      retryOfRunId: run.id,
    };
  }
  const skillName = retrySingleSelection(run, plan.skills, "skills");
  const agentName = retrySingleSelection(run, plan.agents, "agents");
  const baseVersionId = retryVersionId(run, plan);
  requireRetryVersion(snapshot, baseVersionId, run);
  return {
    kind: "improve",
    location,
    ...(run.remoteName ? { remoteName: run.remoteName } : {}),
    baseVersionId,
    skillName,
    agentName,
    samples,
    budget: positiveRetryInteger(run, plan.budget, "operationPlan.budget") ?? 1,
    retryOfRunId: run.id,
  };
}

function retryOperationPlanForRun(run: WorkbenchRun): WorkbenchOperationPlanSummary {
  const plan = run.operationPlan;
  if (!plan) {
    throw retryIncompleteError(run, `Run ${run.id} does not record an operation plan.`);
  }
  if (plan.kind !== run.kind) {
    throw retryIncompleteError(run, `Run ${run.id} records operationPlan.kind ${plan.kind} but run kind is ${run.kind}.`);
  }
  return plan;
}

function retryVersionId(run: WorkbenchRun, plan: WorkbenchOperationPlanSummary): string {
  if (plan.versionId) {
    return plan.versionId;
  }
  throw retryIncompleteError(run, `Run ${run.id} does not record operationPlan.versionId.`);
}

function retrySingleSelection(run: WorkbenchRun, values: readonly string[], label: "skills" | "agents"): string {
  if (values.length === 1 && values[0]) {
    return values[0];
  }
  throw retryIncompleteError(run, `Run ${run.id} does not record exactly one operationPlan.${label} entry.`);
}

function retrySelection(run: WorkbenchRun, values: readonly string[], label: "skills" | "agents"): string {
  const selected = uniqueStrings(values);
  if (selected.length > 0) {
    return selected.join(",");
  }
  throw retryIncompleteError(run, `Run ${run.id} does not record operationPlan.${label}.`);
}

function positiveRetryInteger(run: WorkbenchRun, value: number | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw retryIncompleteError(run, `Run ${run.id} cannot retry with invalid ${label} ${String(value)}.`);
  }
  return value;
}

function requireRetryVersion(snapshot: WorkbenchInspectionSnapshot, versionId: string, run: WorkbenchRun): void {
  if (snapshot.versions.some((version) => version.id === versionId)) {
    return;
  }
  throw retryIncompleteError(run, `Run ${run.id} refers to missing version ${versionId}.`);
}

function retryIncompleteError(run: WorkbenchRun, message: string): WorkbenchCodedError {
  const command = run.kind === "improve" ? "workbench improve" : "workbench eval";
  return new WorkbenchCodedError("run_retry_incomplete", message, {
    remediation: command,
    subject: { runId: run.id },
    exitCode: 1,
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
      location: options.location,
      remoteName: options.remoteName,
      retryOfRunId: options.retryOfRunId,
      rerun: options.rerun === true,
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
      ...(options.location !== undefined ? { location: options.location } : {}),
      ...(options.remoteName !== undefined ? { remoteName: options.remoteName } : {}),
      ...(options.retryOfRunId !== undefined ? { retryOfRunId: options.retryOfRunId } : {}),
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

export async function prepareWorkbenchCloudImproveRequest(
  options: Pick<WorkbenchImproveOptions, "dir" | "authToken" | "skill" | "agent" | "budget" | "samples" | "evidenceTraceIds"> = {},
): Promise<WorkbenchPreparedCloudImproveRequest> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const base = await resolveOrCreateRunVersion(root, state);
    await saveState(root, state);
    const runtimeAgents = await runtimeAgentOptionsForRoot(root, state);
    const runtime = await createWorkbenchVersionRuntimeSnapshot(base, {
      skill: options.skill,
      agent: options.agent,
      authToken: options.authToken,
      selectionRemediationCommand: "improve",
      ...runtimeAgents,
    });
    const { skillBundle, evalAgent } = requireWorkbenchImproveTarget(runtime, { requireAdapter: false });
    if (runtime.cases.length === 0) {
      throw noEvalCasesError();
    }
    const historicalTraces = improvementEvidenceTracesForImproveRequest(state, {
      versionId: base.id,
      skillName: skillBundle.skillName,
      skillBundleHash: skillBundle.hash,
      evalHash: runtime.evalSnapshot.hash,
      agent: evalAgent,
      traceIds: options.evidenceTraceIds,
    });
    const improvementEvidence = improvementEvidenceFromTraces(historicalTraces);
    if (!workbenchSkillImproveCanUseQueuedAdapter(evalAgent) && improvementEvidence.length > 0) {
      throw workbenchSkillImproveAdapterRequirementError(evalAgent, state.agents);
    }
    if (improvementEvidence.length === 0) {
      throw workbenchImproveEvidenceRequirementError({
        state,
        versionId: base.id,
        skillName: skillBundle.skillName,
        evalHash: runtime.evalSnapshot.hash,
        cases: runtime.cases,
        agentName: evalAgent.name,
        preserveAgentSelection: options.agent !== undefined,
      });
    }
    requireWorkbenchImproveAgentAdapter(evalAgent);
    return {
      versionId: base.id,
      ...(options.skill !== undefined ? { skill: options.skill } : {}),
      ...(options.agent !== undefined ? { agent: options.agent } : {}),
      samples: options.samples ?? 1,
      budget: options.budget ?? 1,
      ...(options.evidenceTraceIds !== undefined ? { evidenceTraceIds: [...options.evidenceTraceIds] } : {}),
    };
  });
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
  const skillName = args.skillName ?? CURRENT_SKILL_VERSION_NAME;
  const skillBundleHash = args.skillBundleHash ?? args.versionId;
  assertSkillEvalAgentSupported(args.agent);
  const createdAt = args.createdAt ?? now();
  const command = resolveDockerEvalCommand(args.agent, args.runtimeCase);
  const score = skillEvalGradeInvocation({
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
  const engineCaseFiles = skillEvalEngineCaseFiles(args.agent, args.runtimeCase);
  const engineCase: WorkbenchEngineCase = {
    id: args.runtimeCase.id,
    case: {
      version: 3,
      prompt: skillEvalCasePrompt(args.runtimeCase),
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
    samples: Math.max(1, args.sample + 1),
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

export function createWorkbenchSkillEvalGradeRuntimeInput(
  args: WorkbenchSkillEvalGradeRuntimeInputArgs,
): WorkbenchExecutionRuntimeInput {
  const input = createWorkbenchSkillEvalRuntimeInput(args);
  const execution = readWorkbenchExecutionSpec(input.job);
  const jobInput = jsonRecord(input.job.input);
  const subjectOutputFiles = normalizeSubjectOutputFiles(args.subject.artifact.files
    .filter((file) => !normalizeRelativePath(file.path).startsWith("workspace/"))
    .map(copyFile));
  const subjectWorkspaceFiles = stripSurfaceFilePrefix("workspace", args.subject.artifact.files);
  const subjectFiles = [
    ...prefixSurfaceFiles("input/subject/output", subjectOutputFiles),
    ...prefixSurfaceFiles("input/subject/workspace", subjectWorkspaceFiles),
    ...prefixSurfaceFiles("input/subject/traces", args.subject.trace.files),
    textFile(
      "input/subject/result.json",
      `${JSON.stringify(args.subject.trace.result, null, 2)}\n`,
    ),
  ];
  return {
    ...input,
    job: {
      ...input.job,
      input: {
        ...jobInput,
        dependsOn: [args.subject.job.id],
        subjectJobId: args.subject.job.id,
        role: "grade",
      } as unknown as Json,
    },
    traceFiles: args.subject.trace.files.map(copyFile),
    runtimeControlOperation: {
      inputs: {
        skill: input.baseFiles.map(copyFile),
        case: selectRuntimeControlGradeCaseFiles(input, execution),
        enginePrivate: selectRuntimeControlEnginePrivateFiles(input, execution),
        traces: args.subject.trace.files.map(copyFile),
        workspace: [
          ...subjectWorkspaceFiles.map(copyFile),
          ...subjectFiles,
        ],
      },
      operations: [{
        label: "grade",
        operation: "grade.run",
        invocation: adapterInvocationForRuntimeControl(skillEvalGradeInvocationFromSpec(input.spec)),
      }],
    },
  };
}

export function createWorkbenchSkillImproveRuntimeInput(
  args: WorkbenchSkillImproveRuntimeInputArgs,
): WorkbenchExecutionRuntimeInput {
  const skillName = args.skillName ?? CURRENT_SKILL_VERSION_NAME;
  const skillBundleHash = args.skillBundleHash ?? args.baseVersionId;
  assertSkillEvalAgentSupported(args.agent);
  const createdAt = args.createdAt ?? now();
  const improve = agentImproveAdapterInvocation(args.agent);
  if (!improve) {
    throw workbenchSkillImproveAdapterRequirementError(args.agent);
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
    agent?: WorkbenchAgent;
    evalHash?: string;
    traceIds?: readonly string[];
  },
): WorkbenchTrace[] {
  const lineageVersionIds = lineageAncestorVersionIds(state, options.versionId);
  const selectedTraceIds = options.traceIds?.length ? new Set(options.traceIds) : null;
  const agentHash = options.agent ? hashJson(options.agent) : undefined;
  return improvementEvidenceTraces(state.traces.filter((trace) => {
    if (selectedTraceIds && !selectedTraceIds.has(trace.id)) {
      return false;
    }
    if (!lineageVersionIds.has(trace.versionId)) {
      return false;
    }
    if (trace.skillName !== options.skillName) {
      return false;
    }
    if (options.evalHash && !traceEvalHashMatches(state, trace, options.evalHash)) {
      return false;
    }
    if (options.agent) {
      if (trace.agentName !== options.agent.name) {
        return false;
      }
      return traceAgentHashMatches(state, trace, agentHash!);
    }
    return true;
  }));
}

function improvementEvidenceTracesForImproveRequest(
  state: WorkbenchProjectState,
  options: {
    versionId: string;
    skillName: string;
    skillBundleHash: string;
    evalHash: string;
    agent: WorkbenchAgent;
    traceIds?: readonly string[];
  },
): WorkbenchTrace[] {
  const explicitTraceIds = options.traceIds?.length ? options.traceIds : undefined;
  if (!explicitTraceIds) {
    const incumbent = bestScoredComparableRun({
      runs: state.runs,
      jobs: state.jobs,
      versionId: options.versionId,
      skillName: options.skillName,
      skillBundleHash: options.skillBundleHash,
      evalHash: options.evalHash,
      agentName: options.agent.name,
      agentHash: hashJson(options.agent),
    });
    const incumbentScore = incumbent ? runQualityScoreFromJobs(incumbent, state.jobs) : undefined;
    if (incumbentScore !== undefined && incumbentScore >= 1) {
      return [];
    }
  }
  return workbenchImprovementEvidenceTracesForVersion(state, {
    versionId: options.versionId,
    skillName: options.skillName,
    evalHash: options.evalHash,
    ...(explicitTraceIds ? { traceIds: explicitTraceIds } : {}),
  });
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
  const status = typeof result.status === "string" ? result.status : undefined;
  const feedback = asRuntimeRecord(result.feedback);
  const review = textFromJson(result.review) ??
    textFromJson(result.reviewComment) ??
    textFromJson(feedback.review) ??
    textFromJson(feedback.comment);
  const score = typeof result.score === "number" && Number.isFinite(result.score) ? result.score : undefined;
  const cases = Array.isArray(result.cases) ? result.cases : [];
  const hasFailedCase = cases.some((entry) => {
    const runtimeCase = asRuntimeRecord(entry);
    return runtimeCase.status === "failed" ||
      runtimeCase.status === "error" ||
      Boolean(textFromJson(runtimeCase.error));
  });
  const belowPerfectScore = score !== undefined && score < 1;
  return Boolean(review) || hasFailedCase || belowPerfectScore || ((status === "failed" || status === "error") && score !== undefined);
}

export function workbenchSkillImproveCanUseQueuedAdapter(agent: WorkbenchAgent): boolean {
  return agentImproveAdapterInvocation(agent) !== null;
}

export function workbenchSkillImproveAdapterRequirementMessage(agent: WorkbenchAgent): string {
  return `Agent ${agent.name} cannot run improve because it has no skill-improvement adapter. Configure the selected agent with an improvement-capable adapter.`;
}

function providerAgentAuthSetupCommands(adapter: WorkbenchProviderAgentAdapter): string[] {
  if (adapter === "claude") {
    return [
      "claude setup-token",
      "CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth",
    ];
  }
  return [
    "codex login --device-auth",
    "workbench login codex --method oauth",
  ];
}

function providerAgentAddCommand(adapter: WorkbenchProviderAgentAdapter, agentName: string): string {
  if (adapter === "claude") {
    return `workbench agent add ${agentName} --adapter claude --model sonnet --with auth=default`;
  }
  return `workbench agent add ${agentName} --adapter codex --model gpt-5.4-mini --with auth=default`;
}

function providerAgentSetupCommand(adapter: WorkbenchProviderAgentAdapter, agentName: string): string {
  return [...providerAgentAuthSetupCommands(adapter), providerAgentAddCommand(adapter, agentName)].join(" && ");
}

export function workbenchSkillImproveAdapterSetupCommands(
  agent: WorkbenchAgent,
  availableAgents: readonly WorkbenchAgent[] = [],
): string[] {
  const configuredImproveAgent = configuredImproveAdapterAgent(agent, availableAgents);
  if (configuredImproveAgent) {
    return [
      ...providerImproveAgentAuthSetupCommands(configuredImproveAgent),
      `workbench eval --agents ${configuredImproveAgent.name} --rerun`,
      `workbench improve --agents ${configuredImproveAgent.name}`,
    ];
  }
  const adapter = agent.adapter.trim().toLowerCase();
  if (adapter === "codex" || adapter === "claude") {
    return [...providerAgentAuthSetupCommands(adapter), providerAgentAddCommand(adapter, agent.name)];
  }
  return [
    providerAgentAddCommand("codex", "improver"),
    ...providerAgentAuthSetupCommands("codex"),
    "workbench eval --agents improver --rerun",
    "workbench improve --agents improver",
  ];
}

function configuredImproveAdapterAgent(
  selectedAgent: WorkbenchAgent,
  availableAgents: readonly WorkbenchAgent[],
): WorkbenchAgent | undefined {
  const candidates = availableAgents.filter((agent) =>
    agent.name !== selectedAgent.name &&
    agent.name !== "default" &&
    workbenchSkillImproveCanUseQueuedAdapter(agent)
  );
  return candidates.find((agent) => agent.name === "improver") ?? (candidates.length === 1 ? candidates[0] : undefined);
}

function providerImproveAgentAuthSetupCommands(agent: WorkbenchAgent): string[] {
  const adapter = agent.adapter.trim().toLowerCase();
  return adapter === "codex" || adapter === "claude"
    ? providerAgentAuthSetupCommands(adapter)
    : [];
}

export function workbenchSkillImproveAdapterRemediation(
  agent: WorkbenchAgent,
  availableAgents: readonly WorkbenchAgent[] = [],
): string {
  return workbenchSkillImproveAdapterSetupCommands(agent, availableAgents)[0] ?? providerAgentAddCommand("codex", "improver");
}

function workbenchSkillImproveAdapterRequirementIssue(
  agent: WorkbenchAgent,
  availableAgents: readonly WorkbenchAgent[] = [],
): WorkbenchLaunchReadinessIssue {
  const setupCommands = workbenchSkillImproveAdapterSetupCommands(agent, availableAgents);
  return {
    code: "improve_adapter_required",
    message: workbenchSkillImproveAdapterRequirementMessage(agent),
    remediation: workbenchSkillImproveAdapterRemediation(agent, availableAgents),
    subject: {
      agent: agent.name,
      setupCommands,
    },
  };
}

function workbenchSkillImproveAdapterRequirementError(
  agent: WorkbenchAgent,
  availableAgents: readonly WorkbenchAgent[] = [],
): WorkbenchCodedError {
  const setupCommands = workbenchSkillImproveAdapterSetupCommands(agent, availableAgents);
  return new WorkbenchCodedError("improve_adapter_required", workbenchSkillImproveAdapterRequirementMessage(agent), {
    remediation: workbenchSkillImproveAdapterRemediation(agent, availableAgents),
    subject: {
      agent: agent.name,
      setupCommands,
    },
    exitCode: 2,
  });
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
    ? record.files.filter(isSurfaceSnapshotFile).map(copyFile).filter((file) => !isWorkbenchImprovePatchControlPath(file.path))
    : [];
  const fileChanges = Array.isArray(record.fileChanges)
    ? record.fileChanges
        .flatMap((entry) => typeof entry === "string" ? [normalizeRelativePath(entry)] : [])
        .filter((entry) => !isWorkbenchImprovePatchControlPath(entry))
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

function isWorkbenchImprovePatchControlPath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  return normalized === ".workbench" || normalized.startsWith(".workbench/");
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
  jobs: readonly WorkbenchJob[] = [],
): { promoted: boolean; reason: string } {
  return improvementPromotionDecision(run, incumbentRun, jobs);
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
    selectionRemediationCommand?: WorkbenchSelectorCommand;
    agents?: readonly WorkbenchAgent[];
    defaultAgent?: string;
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
    const suppliedAgents = options.agents && options.agents.length > 0
      ? options.agents.map(copyAgent)
      : null;
    const agents = suppliedAgents ?? await readAgents(sourceRoot);
    const defaultAgent = suppliedAgents
      ? runtimeDefaultAgentForSuppliedAgents(suppliedAgents, options.defaultAgent)
      : await readDefaultAgentSelection(sourceRoot, agents);
    if (!defaultAgent) {
      throw new WorkbenchUserError(`No agents configured in ${path.join(".workbench", AGENTS_FILE)}. Run \`${providerAgentSetupCommand("codex", "default")}\`.`);
    }
    const selectedAgents = resolveNamedSelection(agents, options.agent, defaultAgent, "agent", options.selectionRemediationCommand);
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
      remediationCommand: options.selectionRemediationCommand,
    });
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

function runtimeDefaultAgentForSuppliedAgents(
  agents: readonly WorkbenchAgent[],
  preferred: string | undefined,
): string | undefined {
  if (preferred && (preferred === ALL_SELECTOR || agents.some((agent) => agent.name === preferred))) {
    return preferred;
  }
  return agents[0]?.name;
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
    const proofStatus: WorkbenchRun["status"] = result.job.status === "succeeded" ? "succeeded" : "failed";
    const run: WorkbenchRun = {
      ...existingRun,
      status: proofStatus,
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
    let state = await loadState(root);
    const base = await resolveOrCreateRunVersion(root, state, options.version);
    await saveState(root, state);
    const runtimeAgents = await runtimeAgentOptionsForRoot(root, state);
    const runtime = await createWorkbenchVersionRuntimeSnapshot(base, {
      skill: options.skill,
      agent: options.agent,
      authToken: options.authToken,
      selectionRemediationCommand: "improve",
      ...runtimeAgents,
    });
    const { skillBundle, evalAgent } = requireWorkbenchImproveTarget(runtime, { requireAdapter: false });
    if (runtime.cases.length === 0) {
      throw noEvalCasesError();
    }
    for (const bundle of runtime.skillBundles) {
      upsertByHash(state.skillBundles, bundle);
    }
    upsertAgentSnapshots(state.agents, runtime.agents);
    const historicalTraces = improvementEvidenceTracesForImproveRequest(state, {
      versionId: base.id,
      skillName: skillBundle.skillName,
      skillBundleHash: skillBundle.hash,
      evalHash: runtime.evalSnapshot.hash,
      agent: evalAgent,
      traceIds: options.evidenceTraceIds,
    });
    const improvementEvidence = improvementEvidenceFromTraces(historicalTraces);
    if (!workbenchSkillImproveCanUseQueuedAdapter(evalAgent) && improvementEvidence.length > 0) {
      throw workbenchSkillImproveAdapterRequirementError(evalAgent, state.agents);
    }
    if (improvementEvidence.length === 0) {
      throw workbenchImproveEvidenceRequirementError({
        state,
        versionId: base.id,
        skillName: skillBundle.skillName,
        evalHash: runtime.evalSnapshot.hash,
        cases: runtime.cases,
        agentName: evalAgent.name,
        preserveAgentSelection: options.agent !== undefined,
      });
    }
    if ((options.location ?? "local") === "local") {
      await assertLocalWorkbenchLaunchReady([evalAgent], options);
    }
    const evalSnapshot = runtime.evalSnapshot;
    upsertEvalSnapshotObject(state.evals, evalSnapshot);
    const incumbentRun = bestScoredComparableRun({
      runs: state.runs,
      jobs: state.jobs,
      versionId: base.id,
      skillName: skillBundle.skillName,
      skillBundleHash: skillBundle.hash,
      evalHash: evalSnapshot.hash,
      agentName: evalAgent.name,
      agentHash: hashJson(evalAgent),
    });
    const proofSamples = options.samples ?? 1;
    const createdAt = now();
    const improveJobId = nextJobId();
    const improveCommand = configString(evalAgent.config, "improveCommand");
    const run: WorkbenchRun = {
      id: nextRunId(),
      kind: "improve",
      versionId: base.id,
      skillName: skillBundle.skillName,
      skillBundleHash: skillBundle.hash,
      evalHash: evalSnapshot.hash,
      agentName: evalAgent.name,
      agentHash: hashJson(evalAgent),
      status: "running",
      jobIds: [improveJobId],
      traceIds: [],
      createdAt,
      ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}),
      location: options.location ?? "local",
      ...(options.remoteName ? { remoteName: options.remoteName } : {}),
      baseVersionId: base.id,
      ...(options.retryOfRunId ? { retryOfRunId: options.retryOfRunId } : {}),
      requestedSamples: proofSamples,
      requestedBudget: options.budget ?? 1,
      operationPlan: operationPlanSummaryForRun({
        kind: "improve",
        variant: options.location ?? "local",
        versionId: base.id,
        evalHash: evalSnapshot.hash,
        skillName: skillBundle.skillName,
        agentName: evalAgent.name,
        samples: proofSamples,
        budget: options.budget ?? 1,
        retryOfRunId: options.retryOfRunId,
      }),
      lastProgressAt: createdAt,
    };
    const improveJob: WorkbenchJob = {
      id: improveJobId,
      runId: run.id,
      kind: "improve",
      versionId: base.id,
      skillName: skillBundle.skillName,
      skillBundleHash: skillBundle.hash,
      evalHash: evalSnapshot.hash,
      agentName: evalAgent.name,
      agentHash: run.agentHash,
      caseId: "current",
      sample: 0,
      status: "running",
      ...(improveCommand ? { command: improveCommand } : {}),
      artifactIds: [],
      traceIds: [],
      createdAt,
      startedAt: createdAt,
    };
    upsertRunObject(state.runs, run);
    upsertJobObject(state.jobs, improveJob);
    await saveState(root, state);
    await options.onRunStarted?.(copyRun(run));
    let improvement: SkillImprovementResult;
    try {
      improvement = await createSkillImprovementPatch({
        root,
        state,
        adapterAuthStoreRoot: options.adapterAuthStoreRoot,
        agent: evalAgent,
        base,
        evalHash: evalSnapshot.hash,
        runId: run.id,
        jobId: improveJob.id,
        createdAt: improveJob.createdAt,
        environmentDockerfile: runtime.environmentDockerfile,
        historicalTraces,
        improvementEvidence,
      });
    } catch (error) {
      const remoteJob = improvePatchRemoteJob(error);
      if (remoteJob) {
        const objects = skillImproveObjectsFromRemoteJob({
          remoteJob,
          run,
          job: improveJob,
          agent: evalAgent,
          evidenceTraceIds: historicalTraces.map((trace) => trace.id),
          samples: proofSamples,
        });
        upsertJobObject(state.jobs, objects.job);
        upsertImmutableById(state.artifacts, objects.artifact, "artifact");
        upsertImmutableById(state.traces, objects.trace, "trace");
        run.traceIds = Array.from(new Set([...run.traceIds, objects.trace.id]));
      } else {
        const failedAt = now();
        upsertJobObject(state.jobs, {
          ...improveJob,
          status: "failed",
          finishedAt: failedAt,
          durationMs: durationMsBetween(improveJob.startedAt, failedAt),
          error: error instanceof Error ? error.message : String(error),
        });
      }
      run.status = "failed";
      run.finishedAt = now();
      run.lastProgressAt = run.finishedAt;
      run.error = error instanceof Error ? error.message : String(error);
      upsertRunObject(state.runs, run, { replace: true });
      await saveState(root, state);
      throw error;
    }
    const improveObjects = skillImproveObjectsFromRemoteJob({
      remoteJob: improvement.remoteJob,
      run,
      job: improveJob,
      agent: evalAgent,
      evidenceTraceIds: historicalTraces.map((trace) => trace.id),
      samples: proofSamples,
      patch: improvement.patch,
    });
    upsertJobObject(state.jobs, improveObjects.job);
    upsertImmutableById(state.artifacts, improveObjects.artifact, "artifact");
    upsertImmutableById(state.traces, improveObjects.trace, "trace");
    run.traceIds = Array.from(new Set([...run.traceIds, improveObjects.trace.id]));
    run.lastProgressAt = improveObjects.job.finishedAt ?? now();
    upsertRunObject(state.runs, run);
    await saveState(root, state);
    const applied = applyWorkbenchSkillImprovementPatch(state, {
      baseVersionId: base.id,
      agent: evalAgent,
      patch: improvement.patch,
      runId: run.id,
      createdAt: now(),
    });
    state = applied.state;
    const version = applied.version;
    const outputRuntime = await createWorkbenchVersionRuntimeSnapshot(version, {
      skill: CURRENT_SKILL_VERSION_NAME,
      agent: evalAgent.name,
      authToken: options.authToken,
      selectionRemediationCommand: "improve",
      ...runtimeAgents,
    });
    const [outputSkillBundle] = outputRuntime.skillBundles;
    if (!outputSkillBundle) {
      throw new WorkbenchUserError("No current skill version available for improve proof eval.");
    }
    for (const bundle of outputRuntime.skillBundles) {
      upsertByHash(state.skillBundles, bundle);
    }
    upsertAgentSnapshots(state.agents, outputRuntime.agents);
    const proofRun = await executeWorkbenchEvaluationRun({
      root,
      state,
      adapterAuthStoreRoot: options.adapterAuthStoreRoot,
      version,
      skillBundle: outputSkillBundle,
      evalSnapshot,
      agent: evalAgent,
      kind: "improve",
      ...(options.parentRunId !== undefined ? { parentRunId: options.parentRunId } : {}),
      ...(options.location !== undefined ? { location: options.location } : {}),
      ...(options.remoteName !== undefined ? { remoteName: options.remoteName } : {}),
      ...(options.retryOfRunId !== undefined ? { retryOfRunId: options.retryOfRunId } : {}),
      baseVersionId: base.id,
      requestedBudget: options.budget ?? 1,
      samples: proofSamples,
      cases: runtime.cases,
      environmentDockerfile: runtime.environmentDockerfile,
      run,
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
    proofRun.outputVersionId = version.id;
    upsertRunObject(state.runs, proofRun);
    if (proofRun.status !== "succeeded") {
      await saveState(root, state);
      throw new WorkbenchCodedError("improve_failed", improveProofEvalFailureMessage(version, proofRun), {
        remediation: adapterAuthRemediationFromError(proofRun.error) ?? `workbench show ${proofRun.id}`,
        subject: { runId: proofRun.id, versionId: version.id, status: proofRun.status },
        exitCode: 1,
      });
    }
    const promotion = improvementPromotionDecision(proofRun, incumbentRun, state.jobs);
    const incumbentScore = incumbentRun ? runQualityScoreFromJobs(incumbentRun, state.jobs) : undefined;
    const outputScore = runQualityScoreFromJobs(proofRun, state.jobs);
    let switched = false;
    if (promotion.promoted) {
      await materializeSkillFiles(root, version.files);
      state.refs.current = version.id;
      switched = true;
    }
    await saveState(root, state);
    return {
      run: proofRun,
      version,
      switched,
      promoted: promotion.promoted,
      promotionReason: promotion.reason,
      ...(incumbentRun ? { incumbentRunId: incumbentRun.id } : {}),
      ...(incumbentScore !== undefined ? { incumbentScore } : {}),
      ...(proofRun.status === "succeeded" && outputScore !== undefined ? { outputScore } : {}),
    };
  });
}

export async function previewWorkbenchImprove(options: WorkbenchImproveOptions & { cloud?: boolean } = {}): Promise<WorkbenchImprovePreview> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  const state = await loadStateReadOnlyWithRetry(root);
  const source = await planWorkbenchLaunchSource(root, state, {
    ref: options.version,
    commit: false,
    message: SOURCE_SNAPSHOT_MESSAGE,
  });
  const base = source.version;
  const runtimeAgents = await runtimeAgentOptionsForRoot(root, state);
  const runtime = await createWorkbenchVersionRuntimeSnapshot(base, {
    skill: options.skill,
    agent: options.agent,
    authToken: options.authToken,
    selectionRemediationCommand: "improve",
    ...runtimeAgents,
  });
  const { skillBundle, evalAgent } = requireWorkbenchImproveTarget(runtime, { requireAdapter: false });
  if (runtime.cases.length === 0) {
    throw noEvalCasesError();
  }
  const historicalTraces = improvementEvidenceTracesForImproveRequest(state, {
    versionId: base.id,
    skillName: skillBundle.skillName,
    skillBundleHash: skillBundle.hash,
    evalHash: runtime.evalSnapshot.hash,
    agent: evalAgent,
    traceIds: options.evidenceTraceIds,
  });
  const improvementEvidence = improvementEvidenceFromTraces(historicalTraces);
  if (improvementEvidence.length === 0) {
    throw workbenchImproveEvidenceRequirementError({
      state,
      versionId: base.id,
      skillName: skillBundle.skillName,
      evalHash: runtime.evalSnapshot.hash,
      cases: runtime.cases,
      agentName: evalAgent.name,
      preserveAgentSelection: options.agent !== undefined,
    });
  }
  const canImproveWithSelectedAgent = workbenchSkillImproveCanUseQueuedAdapter(evalAgent);
  const readiness = canImproveWithSelectedAgent
    ? options.cloud === true
      ? readyWorkbenchLaunchReadiness()
      : await localWorkbenchLaunchReadiness([evalAgent], options)
    : readinessFromIssues([workbenchSkillImproveAdapterRequirementIssue(evalAgent, state.agents)]);
  const adapterAuthTargets = canImproveWithSelectedAgent
    ? uniqueLocalAdapterAuthTargets([evalAgent].flatMap(localAdapterAuthTargetsForAgent))
    : [];
  const incumbentRun = bestScoredComparableRun({
    runs: state.runs,
    jobs: state.jobs,
    versionId: base.id,
    skillName: skillBundle.skillName,
    skillBundleHash: skillBundle.hash,
    evalHash: runtime.evalSnapshot.hash,
    agentName: evalAgent.name,
    agentHash: hashJson(evalAgent),
  });
  const incumbentScore = incumbentRun ? runQualityScoreFromJobs(incumbentRun, state.jobs) : undefined;
  return {
    dryRun: true,
    location: options.cloud === true ? "cloud" : "local",
    versionId: base.id,
    sourceState: source.sourceState,
    ...(source.wouldCreateVersionId ? { wouldCreateVersionId: source.wouldCreateVersionId } : {}),
    evalHash: runtime.evalSnapshot.hash,
    skill: { name: skillBundle.skillName, hash: skillBundle.hash },
    agent: { name: evalAgent.name, hash: hashJson(evalAgent) },
    evidenceTraceIds: historicalTraces.map((trace) => trace.id),
    evidenceCount: improvementEvidence.length,
    proofCases: runtime.cases.length,
    samples: options.samples ?? 1,
    budget: options.budget ?? 1,
    ...(incumbentRun ? { incumbentRunId: incumbentRun.id } : {}),
    ...(incumbentScore !== undefined ? { incumbentScore } : {}),
    adapterAuthTargets,
    readiness,
  };
}

export interface WorkbenchActionCapabilitiesOptions {
  variant: WorkbenchOperationVariant;
  evidenceAccess: "full" | "source";
  handle?: string;
  skillName?: string;
}

export function createWorkbenchActionCapabilities(
  snapshot: WorkbenchInspectionSnapshot,
  options: WorkbenchActionCapabilitiesOptions,
): WorkbenchActionCapabilities {
  const defaultRunRequest = defaultWorkbenchOperationRequest(snapshot, "run", options.variant);
  const defaultGradeRequest = defaultWorkbenchOperationRequest(snapshot, "grade", options.variant);
  const defaultEvalRequest = defaultWorkbenchOperationRequest(snapshot, "eval", options.variant);
  const defaultImproveRequest = defaultWorkbenchOperationRequest(snapshot, "improve", options.variant);
  const fullAccess = options.evidenceAccess === "full";
  const localPhaseActionsEnabled = fullAccess && options.variant === "local";
  const improveEnabled = fullAccess && hasActionableImproveEvidence(snapshot);
  return {
    variant: options.variant,
    evidenceAccess: options.evidenceAccess,
    run: {
      enabled: localPhaseActionsEnabled,
      defaultRequest: defaultRunRequest,
      ...(localPhaseActionsEnabled ? {} : { disabledReason: fullAccess ? "Hosted pages start full evaluations; use local Workbench for execution-only runs." : "Source-only pages cannot start runs." }),
    },
    grade: {
      enabled: localPhaseActionsEnabled,
      defaultRequest: defaultGradeRequest,
      ...(localPhaseActionsEnabled ? {} : { disabledReason: fullAccess ? "Hosted pages start full evaluations; use local Workbench for grading existing local output." : "Source-only pages cannot start grading." }),
    },
    eval: {
      enabled: fullAccess,
      defaultRequest: defaultEvalRequest,
      ...(fullAccess ? {} : { disabledReason: "Source-only pages cannot start evaluations." }),
    },
    improve: {
      enabled: improveEnabled,
      defaultRequest: defaultImproveRequest,
      ...(improveEnabled
        ? {}
        : { disabledReason: fullAccess ? workbenchImproveEvidenceRequirementMessage() : "Source-only pages cannot start improvements." }),
    },
    acquisition: workbenchAcquisitionOptions(snapshot, options),
  };
}

export async function previewLocalWorkbenchOperation(
  options: WorkbenchCommandOptions & { request: WorkbenchOperationRequest },
): Promise<WorkbenchOperationPreview> {
  const request = normalizeWorkbenchOperationRequest(options.request, "local");
  try {
    if (request.kind === "run" || request.kind === "grade" || request.kind === "eval") {
      const preview = await previewWorkbenchEval({
        dir: options.dir,
        authToken: options.authToken,
        adapterAuthStoreRoot: options.adapterAuthStoreRoot,
        homeDir: options.homeDir,
        env: options.env,
        version: request.versionId,
        skill: request.skill,
        agent: request.agent,
        caseIds: request.caseIds,
        samples: request.samples,
        kind: request.kind,
        rerun: request.rerun,
        cloud: false,
      });
      return operationPreviewFromEvalPreview(request, preview);
    }
    const preview = await previewWorkbenchImprove({
      dir: options.dir,
      authToken: options.authToken,
      adapterAuthStoreRoot: options.adapterAuthStoreRoot,
      homeDir: options.homeDir,
      env: options.env,
      version: request.versionId,
      skill: request.skill,
      agent: request.agent,
      samples: request.samples,
      budget: request.budget,
      evidenceTraceIds: request.evidenceTraceIds,
      cloud: false,
    });
    return operationPreviewFromImprovePreview(request, preview);
  } catch (error) {
    return disabledOperationPreviewFromError(request, error);
  }
}

async function executeLocalWorkbenchOperation(
  options: WorkbenchCommandOptions & {
    request: WorkbenchOperationRequest;
    onRunStarted?: (run: WorkbenchRun) => void | Promise<void>;
  },
): Promise<WorkbenchRunSnapshot> {
  const request = normalizeWorkbenchOperationRequest(options.request, "local");
  let notifiedStarted = false;
  const onRunStarted = async (run: WorkbenchRun): Promise<void> => {
    if (notifiedStarted) {
      return;
    }
    notifiedStarted = true;
    await options.onRunStarted?.(run);
  };
  const runs = request.kind === "run"
    ? await evalWorkbenchSkill({
        dir: options.dir,
        authToken: options.authToken,
        adapterAuthStoreRoot: options.adapterAuthStoreRoot,
        homeDir: options.homeDir,
        env: options.env,
        version: request.versionId,
        skill: request.skill,
        agent: request.agent,
        caseIds: request.caseIds,
        samples: request.samples,
        rerun: request.rerun,
        kind: "run",
        location: "local",
        retryOfRunId: request.retryOfRunId,
        onRunStarted,
      })
    : request.kind === "eval"
      ? await evalWorkbenchSkill({
          dir: options.dir,
          authToken: options.authToken,
          adapterAuthStoreRoot: options.adapterAuthStoreRoot,
          homeDir: options.homeDir,
          env: options.env,
          version: request.versionId,
          skill: request.skill,
          agent: request.agent,
          caseIds: request.caseIds,
          samples: request.samples,
          rerun: request.rerun,
          kind: "eval",
          location: "local",
          retryOfRunId: request.retryOfRunId,
          onRunStarted,
        })
      : request.kind === "grade"
        ? await gradeWorkbenchSkill({
            dir: options.dir,
            authToken: options.authToken,
            adapterAuthStoreRoot: options.adapterAuthStoreRoot,
            homeDir: options.homeDir,
            env: options.env,
            version: request.versionId,
            skill: request.skill,
            agent: request.agent,
            caseIds: request.caseIds,
            samples: request.samples,
            rerun: request.rerun,
            kind: "grade",
            location: "local",
            retryOfRunId: request.retryOfRunId,
            onRunStarted,
          })
        : [(
        await improveWorkbenchSkill({
          dir: options.dir,
          authToken: options.authToken,
          adapterAuthStoreRoot: options.adapterAuthStoreRoot,
          homeDir: options.homeDir,
          env: options.env,
          version: request.versionId,
          skill: request.skill,
          agent: request.agent,
          samples: request.samples,
          budget: request.budget,
          evidenceTraceIds: request.evidenceTraceIds,
          location: "local",
          retryOfRunId: request.retryOfRunId,
          onRunStarted,
        })
        ).run];
  const cursor = await readWorkbenchReadOnlyInspectionCursor(options).catch(() => undefined);
  return createWorkbenchRunSnapshot(request, runs, { cursor });
}

export interface WorkbenchLocalOperationSupervisor {
  started: Promise<WorkbenchRunSnapshot>;
  completed: Promise<WorkbenchRunSnapshot>;
}

export function superviseLocalWorkbenchOperation(
  options: WorkbenchCommandOptions & { request: WorkbenchOperationRequest },
): WorkbenchLocalOperationSupervisor {
  const request = normalizeWorkbenchOperationRequest(options.request, "local");
  let settledStarted = false;
  let resolveStarted!: (value: WorkbenchRunSnapshot) => void;
  let rejectStarted!: (reason: unknown) => void;
  const started = new Promise<WorkbenchRunSnapshot>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const settleStarted = (value: WorkbenchRunSnapshot): void => {
    if (settledStarted) {
      return;
    }
    settledStarted = true;
    resolveStarted(value);
  };
  const failStarted = (error: unknown): void => {
    if (settledStarted) {
      return;
    }
    settledStarted = true;
    rejectStarted(error);
  };
  const completed = executeLocalWorkbenchOperation({
    ...options,
    request,
    onRunStarted: async (run) => {
      const cursor = await readWorkbenchReadOnlyInspectionCursor(options).catch(() => undefined);
      settleStarted(createWorkbenchRunSnapshot(request, [run], { cursor }));
    },
  }).then((result) => {
    settleStarted(result);
    return result;
  }, (error) => {
    failStarted(error);
    throw error;
  });
  completed.catch(() => undefined);
  return { started, completed };
}

function operationPlanSummaryForRun(input: {
  kind: WorkbenchRunKind;
  variant: WorkbenchOperationVariant;
  versionId: string;
  evalHash: string;
  skillName?: string;
  agentName?: string;
  skillNames?: readonly string[];
  agentNames?: readonly string[];
  caseIds?: readonly string[];
  samples?: number;
  rerun?: boolean;
  budget?: number;
  retryOfRunId?: string;
}): WorkbenchOperationPlanSummary {
  if (input.kind !== "run" && input.kind !== "grade" && input.kind !== "eval" && input.kind !== "improve") {
    throw new WorkbenchCodedError("operation_plan_unsupported", `Run kind ${input.kind} cannot be persisted as a Workbench operation plan.`, {
      remediation: "workbench eval",
      subject: { kind: input.kind },
      exitCode: 2,
    });
  }
  return {
    kind: input.kind,
    variant: input.variant,
    versionId: input.versionId,
    evalHash: input.evalHash,
    skills: uniqueStrings([...(input.skillNames ?? []), ...(input.skillName ? [input.skillName] : [])]),
    agents: uniqueStrings([...(input.agentNames ?? []), ...(input.agentName ? [input.agentName] : [])]),
    ...((input.caseIds?.length ?? 0) > 0 ? { caseIds: uniqueStrings([...(input.caseIds ?? [])]) } : {}),
    ...(input.samples !== undefined ? { samples: input.samples } : {}),
    ...(input.rerun === true ? { rerun: true } : {}),
    ...(input.budget !== undefined ? { budget: input.budget } : {}),
    ...(input.retryOfRunId ? { retryOfRunId: input.retryOfRunId } : {}),
  };
}

function copyOperationPlanSummary(plan: WorkbenchOperationPlanSummary): WorkbenchOperationPlanSummary {
  return {
    ...plan,
    skills: [...plan.skills],
    agents: [...plan.agents],
    ...(plan.caseIds ? { caseIds: [...plan.caseIds] } : {}),
  };
}

function operationPlanSummaryForSnapshotRuns(runs: readonly WorkbenchRun[]): WorkbenchOperationPlanSummary | undefined {
  const plans: WorkbenchOperationPlanSummary[] = [];
  for (const run of runs) {
    if (!run.operationPlan) {
      return undefined;
    }
    plans.push(run.operationPlan);
  }
  const [first] = plans;
  if (!first || plans.some((plan) => plan.kind !== first.kind || plan.variant !== first.variant)) {
    return undefined;
  }
  const versionId = commonString(plans.map((plan) => plan.versionId));
  const evalHash = commonString(plans.map((plan) => plan.evalHash));
  const samples = commonNumber(plans.map((plan) => plan.samples));
  const budget = commonNumber(plans.map((plan) => plan.budget));
  const retryOfRunId = commonString(plans.map((plan) => plan.retryOfRunId));
  const caseIds = commonStringArrays(plans.map((plan) => plan.caseIds));
  return {
    kind: first.kind,
    variant: first.variant,
    ...(versionId ? { versionId } : {}),
    ...(evalHash ? { evalHash } : {}),
    skills: uniqueStrings(plans.flatMap((plan) => plan.skills)),
    agents: uniqueStrings(plans.flatMap((plan) => plan.agents)),
    ...(caseIds ? { caseIds } : {}),
    ...(samples !== undefined ? { samples } : {}),
    ...(plans.some((plan) => plan.rerun === true) ? { rerun: true } : {}),
    ...(budget !== undefined ? { budget } : {}),
    ...(retryOfRunId ? { retryOfRunId } : {}),
  };
}

function commonStringArrays(values: readonly (readonly string[] | undefined)[]): string[] | undefined {
  if (values.some((value) => !value)) {
    return undefined;
  }
  const present = values as readonly (readonly string[])[];
  const [first] = present;
  if (!first) {
    return undefined;
  }
  return present.every((value) => sameStringArray(value, first)) ? [...first] : undefined;
}

function commonString(values: readonly (string | undefined)[]): string | undefined {
  const present = values.filter((value): value is string => typeof value === "string" && value.length > 0);
  if (present.length !== values.length) {
    return undefined;
  }
  const first = present[0];
  return first !== undefined && present.every((value) => value === first) ? first : undefined;
}

function commonNumber(values: readonly (number | undefined)[]): number | undefined {
  const present = values.filter((value): value is number => typeof value === "number");
  if (present.length !== values.length) {
    return undefined;
  }
  const first = present[0];
  return first !== undefined && present.every((value) => value === first) ? first : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

export function createWorkbenchRunSnapshot(
  request: WorkbenchOperationRequest,
  runs: readonly WorkbenchRun[],
  options: { cursor?: string; jobs?: readonly WorkbenchJob[]; plan?: WorkbenchOperationPlanSummary } = {},
): WorkbenchRunSnapshot {
  const firstRun = runs[0];
  if (!firstRun) {
    throw new WorkbenchCodedError("operation_run_missing", `Workbench ${request.kind} did not create a run.`, {
      retryable: true,
      remediation: request.kind === "eval" ? "workbench eval" : "workbench improve",
      exitCode: 1,
    });
  }
  const normalized = normalizeWorkbenchOperationRequest(request, firstRun.location ?? request.variant);
  const jobs = options.jobs ?? [];
  const result = runSnapshotResultSummary(runs, jobs);
  const persistedPlan = options.plan ?? operationPlanSummaryForSnapshotRuns(runs);
  const plan = persistedPlan
    ? copyOperationPlanSummary(persistedPlan)
    : {
        kind: normalized.kind,
        variant: normalized.variant,
        ...(normalized.versionId ? { versionId: normalized.versionId } : { versionId: firstRun.versionId }),
        ...(normalized.evalHash ? { evalHash: normalized.evalHash } : { evalHash: firstRun.evalHash }),
        skills: [...new Set(runs.map((run) => run.skillName))],
        agents: [...new Set(runs.map((run) => run.agentName))],
        ...(normalized.caseIds?.length ? { caseIds: normalized.caseIds } : {}),
        ...(normalized.samples !== undefined ? { samples: normalized.samples } : {}),
        ...(normalized.rerun ? { rerun: true } : {}),
        ...(normalized.budget !== undefined ? { budget: normalized.budget } : {}),
        ...(normalized.retryOfRunId ? { retryOfRunId: normalized.retryOfRunId } : {}),
      } satisfies WorkbenchOperationPlanSummary;
  return {
    schema: "workbench.run.v1",
    id: firstRun.id,
    kind: plan.kind,
    variant: plan.variant,
    status: aggregateRunStatus(runs),
    phase: runPhaseForRuns(runs),
    plan,
    progress: runProgressSummary(runs, jobs),
    measurements: runMeasurementSummaries(runs, jobs),
    ...(result ? { result } : {}),
    ...(firstRun.retryOfRunId ? { retryOfRunId: firstRun.retryOfRunId } : {}),
    route: {
      kind: "run",
      runId: firstRun.id,
      source: plan.kind === "eval" ? "evaluation" : "runs",
      evaluationId: firstRun.evalHash,
    },
    ...(options.cursor ? { cursor: options.cursor } : {}),
    cliEquivalent: workbenchOperationPlanCliEquivalent(plan),
    ...(runSnapshotNext(firstRun) ? { next: runSnapshotNext(firstRun) } : {}),
  };
}

export function createWorkbenchRunSnapshotForRun(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[] = [],
  options: { cursor?: string } = {},
): WorkbenchRunSnapshot {
  const plan = run.operationPlan ? copyOperationPlanSummary(run.operationPlan) : undefined;
  return createWorkbenchRunSnapshot({
    kind: plan?.kind ?? run.kind,
    variant: plan?.variant ?? run.location ?? "local",
    versionId: plan?.versionId ?? run.versionId,
    evalHash: plan?.evalHash ?? run.evalHash,
    skill: plan?.skills.join(",") || run.skillName,
    agent: plan?.agents.join(",") || run.agentName,
    ...(plan?.samples !== undefined ? { samples: plan.samples } : run.requestedSamples !== undefined ? { samples: run.requestedSamples } : {}),
    ...(plan?.rerun ? { rerun: true } : {}),
    ...(plan?.budget !== undefined ? { budget: plan.budget } : run.kind === "improve" && run.requestedBudget !== undefined ? { budget: run.requestedBudget } : {}),
    ...(plan?.retryOfRunId ? { retryOfRunId: plan.retryOfRunId } : run.retryOfRunId ? { retryOfRunId: run.retryOfRunId } : {}),
  }, [run], { ...options, jobs, ...(plan ? { plan } : {}) });
}

function workbenchRunFromSnapshot(
  snapshot: WorkbenchRunSnapshot,
  options: { remoteName?: string } = {},
): WorkbenchRun {
  const [measurement] = snapshot.measurements;
  const nowIso = now();
  const outputVersionId = snapshot.result?.switchedToVersionId ?? snapshot.result?.improvedVersionId;
  return {
    id: snapshot.id,
    kind: snapshot.kind,
    versionId: snapshot.plan.versionId ?? measurement?.versionId ?? "",
    skillName: snapshot.plan.skills[0] ?? measurement?.skillName ?? "",
    skillBundleHash: measurement?.skillBundleHash ?? "",
    evalHash: snapshot.plan.evalHash ?? measurement?.evalHash ?? "",
    agentName: snapshot.plan.agents[0] ?? measurement?.agentName ?? "",
    agentHash: measurement?.agentHash ?? "",
    status: snapshot.status,
    operationPlan: copyOperationPlanSummary(snapshot.plan),
    ...(measurement?.costUsd !== undefined ? { costUsd: measurement.costUsd } : {}),
    ...(measurement?.latencyMs !== undefined ? { latencyMs: measurement.latencyMs } : {}),
    jobIds: [],
    traceIds: [],
    createdAt: nowIso,
    location: snapshot.variant,
    ...(options.remoteName ? { remoteName: options.remoteName } : {}),
    ...(snapshot.plan.versionId ? { baseVersionId: snapshot.plan.versionId } : {}),
    ...(snapshot.plan.samples !== undefined ? { requestedSamples: snapshot.plan.samples } : {}),
    ...(snapshot.plan.budget !== undefined ? { requestedBudget: snapshot.plan.budget } : {}),
    ...(snapshot.retryOfRunId ?? snapshot.plan.retryOfRunId ? { retryOfRunId: snapshot.retryOfRunId ?? snapshot.plan.retryOfRunId } : {}),
    lastProgressAt: nowIso,
    ...(outputVersionId ? { outputVersionId } : {}),
    ...(snapshot.result?.error ?? measurement?.error ? { error: snapshot.result?.error ?? measurement?.error } : {}),
  };
}

function workbenchOperationPlanCliEquivalent(plan: WorkbenchOperationPlanSummary): string {
  return workbenchOperationCliEquivalent({
    kind: plan.kind,
    variant: plan.variant,
    ...(plan.versionId ? { versionId: plan.versionId } : {}),
    ...(plan.evalHash ? { evalHash: plan.evalHash } : {}),
    ...(plan.skills.length > 0 ? { skill: plan.skills.join(",") } : {}),
    ...(plan.agents.length > 0 ? { agent: plan.agents.join(",") } : {}),
    ...(plan.caseIds?.length ? { caseIds: plan.caseIds } : {}),
    ...(plan.samples !== undefined ? { samples: plan.samples } : {}),
    ...(plan.rerun ? { rerun: true } : {}),
    ...(plan.budget !== undefined ? { budget: plan.budget } : {}),
    ...(plan.retryOfRunId ? { retryOfRunId: plan.retryOfRunId } : {}),
  });
}

export function workbenchOperationCliEquivalent(request: WorkbenchOperationRequest): string {
  const normalized = normalizeWorkbenchOperationRequest(request, request.variant);
  const parts = ["workbench", normalized.kind];
  if (normalized.variant === "cloud") {
    parts.push("--cloud");
  }
  if (normalized.skill) {
    parts.push("--versions", quoteShellArg(normalized.skill));
  }
  if (normalized.agent) {
    parts.push("--agents", quoteShellArg(normalized.agent));
  }
  if (normalized.caseIds?.length) {
    parts.push("--cases", quoteShellArg(normalized.caseIds.join(",")));
  }
  if (normalized.samples && normalized.samples !== 1) {
    parts.push("-n", String(normalized.samples));
  }
  if ((normalized.kind === "run" || normalized.kind === "grade" || normalized.kind === "eval") && normalized.rerun) {
    parts.push("--rerun");
  }
  if (normalized.kind === "improve" && normalized.budget && normalized.budget !== 1) {
    parts.push("--budget", String(normalized.budget));
  }
  return parts.join(" ");
}

function aggregateRunStatus(runs: readonly WorkbenchRun[]): WorkbenchRun["status"] {
  if (runs.some((run) => run.status === "running")) {
    return "running";
  }
  if (runs.some((run) => run.status === "queued")) {
    return "queued";
  }
  if (runs.some((run) => run.status === "canceling")) {
    return "canceling";
  }
  if (runs.some((run) => run.status === "failed")) {
    return "failed";
  }
  if (runs.some((run) => run.status === "canceled")) {
    return "canceled";
  }
  return "succeeded";
}

function runPhaseForRuns(runs: readonly WorkbenchRun[]): WorkbenchRunPhase {
  const status = aggregateRunStatus(runs);
  if (status === "queued") {
    return "queued";
  }
  if (status === "running") {
    return runs.some((run) => run.kind === "improve") ? "improving" : "running";
  }
  if (status === "canceling") {
    return "canceling";
  }
  return "complete";
}

function runProgressSummary(
  runs: readonly WorkbenchRun[],
  jobs: readonly WorkbenchJob[],
): WorkbenchRunSnapshot["progress"] {
  const runJobs = jobsForSnapshotRuns(runs, jobs);
  const caseJobs = runJobs.filter((job) => job.caseId !== "current");
  const selectedJobs = caseJobs.length > 0 ? caseJobs : runJobs;
  const completedJobs = selectedJobs.filter(isTerminalJob);
  const scoredJobs = selectedJobs.filter((job) => jobQualityScore(job) !== undefined);
  const failedJobs = selectedJobs.filter((job) => job.status === "failed");
  const canceledJobs = selectedJobs.filter((job) => job.status === "canceled");
  const activeJobs = selectedJobs.filter((job) => job.status === "running");
  const firstRun = runs[0];
  const observedAt = latestRunObservedAt(runs, selectedJobs);
  const startedAt = firstRun?.createdAt ?? observedAt ?? now();
  const score = scoredJobs.length > 0
    ? averageScores(scoredJobs.map(jobQualityScore))
    : undefined;
  const costUsd = aggregateRunCost(runs);
  const observedAtMs = timestampMs(observedAt ?? now()) ?? Date.now();
  const startedAtMs = timestampMs(startedAt) ?? observedAtMs;
  const lastProgressAt = latestRunProgressAt(runs, selectedJobs);
  const observedPlanned = selectedJobs.length > 0
    ? selectedJobs.length
    : runs.reduce((sum, run) => sum + (run.jobIds?.length ?? 0), 0);
  return {
    planned: Math.max(observedPlanned, plannedJobCountForRuns(runs) ?? 0),
    completed: completedJobs.length,
    scored: scoredJobs.length,
    failed: failedJobs.length,
    canceled: canceledJobs.length,
    ...(activeJobs[0] ? {
      active: {
        jobId: activeJobs[0].id,
        caseId: activeJobs[0].caseId,
        sample: activeJobs[0].sample + 1,
        skillName: activeJobs[0].skillName,
        agentName: activeJobs[0].agentName,
        runningCount: activeJobs.length,
      },
    } : {}),
    ...(!runs.every(isTerminalRun) && score !== undefined ? { partialScore: score } : {}),
    evidenceCount: runs.reduce((sum, run) => sum + run.traceIds.length + (run.jobIds?.length ?? 0), 0),
    ...(costUsd !== undefined ? { costUsd } : {}),
    elapsedMs: Math.max(0, observedAtMs - startedAtMs),
    ...(lastProgressAt ? { lastProgressAt } : {}),
  };
}

function jobsForSnapshotRuns(
  runs: readonly WorkbenchRun[],
  jobs: readonly WorkbenchJob[],
): WorkbenchJob[] {
  const runIds = new Set(runs.map((run) => run.id));
  const jobIds = new Set(runs.flatMap((run) => run.jobIds ?? []));
  return jobs.filter((job) => runIds.has(job.runId) || jobIds.has(job.id));
}

function runOwnsJob(run: WorkbenchRun, job: WorkbenchJob): boolean {
  return job.runId === run.id || (run.jobIds ?? []).includes(job.id);
}

function plannedJobCountForRuns(runs: readonly WorkbenchRun[]): number | undefined {
  let planned = 0;
  for (const run of runs) {
    const count = plannedJobCountForRun(run);
    if (count === undefined) {
      return undefined;
    }
    planned += count;
  }
  return planned;
}

function plannedJobCountForRun(run: WorkbenchRun): number | undefined {
  if (run.status === "canceling") {
    return undefined;
  }
  const plan = run.operationPlan;
  if (!plan || (plan.kind !== "run" && plan.kind !== "grade" && plan.kind !== "eval")) {
    return undefined;
  }
  const caseCount = plan.caseIds?.length ?? 0;
  if (caseCount === 0) {
    return undefined;
  }
  const samples = Math.max(1, Math.floor(plan.samples ?? run.requestedSamples ?? 1));
  const skillCount = Math.max(1, plan.skills.length);
  const agentCount = Math.max(1, plan.agents.length);
  const phaseCount = plan.kind === "eval" ? 2 : 1;
  return caseCount * samples * skillCount * agentCount * phaseCount;
}

function runMeasurementSummary(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
): WorkbenchMeasurementSummary {
  const runJobs = jobs.filter((job) => runOwnsJob(run, job) && job.caseId !== "current");
  const samples = runJobs.length > 0
    ? new Set(runJobs.map((job) => `${job.caseId}\0${job.sample}`)).size
    : run.jobIds?.length;
  const score = aggregateJobScore(runJobs);
  return {
    versionId: run.versionId,
    skillName: run.skillName,
    skillBundleHash: run.skillBundleHash,
    evalHash: run.evalHash,
    agentName: run.agentName,
    agentHash: run.agentHash,
    runId: run.id,
    status: run.status,
    ...(score !== undefined ? { score } : {}),
    ...(samples !== undefined && samples > 0 ? { samples } : {}),
    ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
    ...(run.latencyMs !== undefined ? { latencyMs: run.latencyMs } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

function runMeasurementSummaries(
  runs: readonly WorkbenchRun[],
  jobs: readonly WorkbenchJob[],
): WorkbenchMeasurementSummary[] {
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const runsByReferencedJobId = new Map<string, WorkbenchRun[]>();
  for (const run of runs) {
    for (const jobId of run.jobIds ?? []) {
      const current = runsByReferencedJobId.get(jobId) ?? [];
      current.push(run);
      runsByReferencedJobId.set(jobId, current);
    }
  }
  const jobsByMeasurement = new Map<string, {
    run: WorkbenchRun;
    jobs: WorkbenchJob[];
    versionId: string;
    evalHash: string;
  }>();
  for (const job of jobs) {
    if (job.caseId === "current") {
      continue;
    }
    const run = runsById.get(job.runId) ?? runsByReferencedJobId.get(job.id)?.[0];
    if (!run) {
      continue;
    }
    const versionId = run.operationPlan?.versionId ?? run.versionId ?? job.versionId;
    const evalHash = run.operationPlan?.evalHash ?? run.evalHash ?? job.evalHash;
    const key = [
      run.id,
      versionId,
      job.skillName,
      job.skillBundleHash,
      evalHash,
      job.agentName,
      job.agentHash,
    ].join("\0");
    const current = jobsByMeasurement.get(key) ?? { run, jobs: [], versionId, evalHash };
    current.jobs.push(job);
    jobsByMeasurement.set(key, current);
  }
  const measuredRunIds = new Set<string>();
  const measurements = [...jobsByMeasurement.values()].map(({ run, jobs: measurementJobs, versionId, evalHash }) => {
    measuredRunIds.add(run.id);
    return runMeasurementSummaryFromJobs(run, measurementJobs, { versionId, evalHash });
  });
  for (const run of runs) {
    if (!measuredRunIds.has(run.id)) {
      measurements.push(runMeasurementSummary(run, jobs));
    }
  }
  return measurements;
}

function runMeasurementSummaryFromJobs(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
  options: { versionId?: string; evalHash?: string } = {},
): WorkbenchMeasurementSummary {
  const [firstJob] = jobs;
  if (!firstJob) {
    return runMeasurementSummary(run, jobs);
  }
  const scoredJobs = jobs.filter((job) => jobQualityScore(job) !== undefined);
  const samples = new Set(jobs.map((job) => `${job.caseId}\0${job.sample}`)).size;
  const latencyMs = jobs.some((job) => job.durationMs !== undefined)
    ? jobs.reduce((sum, job) => sum + (job.durationMs ?? 0), 0)
    : undefined;
  const errors = jobs.flatMap((job) => job.error ? [job.error] : []);
  const status = comparisonJobStatus(jobs, run.status);
  const score = status === "canceled" || scoredJobs.length === 0
    ? undefined
    : averageScores(scoredJobs.map(jobQualityScore));
  return {
    versionId: options.versionId ?? firstJob.versionId,
    skillName: firstJob.skillName,
    skillBundleHash: firstJob.skillBundleHash,
    evalHash: options.evalHash ?? firstJob.evalHash,
    agentName: firstJob.agentName,
    agentHash: firstJob.agentHash,
    runId: run.id,
    status,
    ...(score !== undefined ? { score } : {}),
    ...(samples > 0 ? { samples } : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    ...(errors.length > 0 ? { error: summarizeJobErrors(errors) } : {}),
  };
}

function runSnapshotResultSummary(
  runs: readonly WorkbenchRun[],
  jobs: readonly WorkbenchJob[],
): WorkbenchRunSnapshot["result"] | undefined {
  const score = aggregateJobScore(jobsForSnapshotRuns(runs, jobs));
  const outputVersionId = runs.find((run) => run.outputVersionId)?.outputVersionId ?? improveProofVersionId(runs, jobs);
  const error = runs.find((run) => run.error)?.error;
  if (score === undefined && !outputVersionId && !error) {
    return undefined;
  }
  return {
    ...(score !== undefined ? { score } : {}),
    ...(outputVersionId ? { improvedVersionId: outputVersionId } : {}),
    ...(error ? { error } : {}),
  };
}

function improveProofVersionId(runs: readonly WorkbenchRun[], jobs: readonly WorkbenchJob[]): string | undefined {
  const improveRunIds = new Set(runs.filter((run) => run.kind === "improve").map((run) => run.id));
  const baseVersionIds = new Set(runs.map((run) => run.operationPlan?.versionId ?? run.baseVersionId ?? run.versionId));
  return jobs.find((job) =>
    improveRunIds.has(job.runId) &&
    job.kind === "improve" &&
    job.caseId !== "current" &&
    !baseVersionIds.has(job.versionId)
  )?.versionId;
}

function runSnapshotNext(run: WorkbenchRun): string | undefined {
  if (run.status === "queued" || run.status === "running" || run.status === "canceling") {
    return `workbench watch ${run.id}`;
  }
  if (run.status === "failed" || run.status === "canceled") {
    return undefined;
  }
  return run.kind === "run" ? "workbench grade" : run.kind === "improve" ? "workbench eval --rerun -n 5" : resultsNextCommandForRun(run);
}

function resultsNextCommandForRun(run: WorkbenchRun): string {
  const parts = ["workbench results"];
  const skillSelection = run.operationPlan?.skills.join(",") || run.skillName;
  const agentSelection = run.operationPlan?.agents.join(",") || run.agentName;
  if (skillSelection && skillSelection !== CURRENT_SKILL_VERSION_NAME) {
    parts.push("--versions", quoteShellArg(skillSelection));
  }
  if (agentSelection && agentSelection !== "default") {
    parts.push("--agents", quoteShellArg(agentSelection));
  }
  return parts.join(" ");
}

function aggregateJobScore(jobs: readonly WorkbenchJob[]): number | undefined {
  return averageScores(jobs.map(jobQualityScore));
}

export function runQualityScoreFromJobs(
  run: Pick<WorkbenchRun, "id" | "status"> & { jobIds?: readonly string[] },
  jobs: readonly WorkbenchJob[],
): number | undefined {
  if (run.status === "canceled") {
    return undefined;
  }
  const referencedJobIds = new Set(run.jobIds ?? []);
  return aggregateJobScore(jobs.filter((job) =>
    (job.runId === run.id || referencedJobIds.has(job.id)) && job.role === "grade"
  ));
}

export function jobQualityScore(job: Pick<WorkbenchJob, "result">): number | undefined {
  const scoreItem = job.result?.items?.find((item) =>
    item.kind === "score" && typeof item.score === "number" && Number.isFinite(item.score)
  );
  return typeof scoreItem?.score === "number" ? scoreItem.score : undefined;
}

function averageScores(values: readonly (number | undefined)[]): number | undefined {
  const scores = values.filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  if (scores.length === 0) {
    return undefined;
  }
  return Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(3));
}

function aggregateRunCost(runs: readonly WorkbenchRun[]): number | undefined {
  const costs = runs
    .map((run) => run.costUsd)
    .filter((cost): cost is number => typeof cost === "number");
  if (costs.length === 0) {
    return undefined;
  }
  return Number(costs.reduce((sum, cost) => sum + cost, 0).toFixed(6));
}

function latestRunObservedAt(runs: readonly WorkbenchRun[], jobs: readonly WorkbenchJob[]): string | undefined {
  return [
    ...runs.flatMap((run) => [run.finishedAt, run.lastProgressAt, run.createdAt]),
    ...jobs.flatMap((job) => [job.finishedAt, job.startedAt, job.createdAt]),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort()
    .at(-1);
}

function latestRunProgressAt(runs: readonly WorkbenchRun[], jobs: readonly WorkbenchJob[]): string | undefined {
  return [
    ...runs.flatMap((run) => [run.lastProgressAt, run.finishedAt, run.createdAt]),
    ...jobs.flatMap((job) => [job.finishedAt, job.startedAt]),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort()
    .at(-1);
}

function isTerminalJob(job: WorkbenchJob): boolean {
  return job.status === "succeeded" || job.status === "failed" || job.status === "canceled";
}

function isTerminalRun(run: WorkbenchRun): boolean {
  return run.status === "succeeded" || run.status === "failed" || run.status === "canceled";
}

function defaultWorkbenchOperationRequest(
  snapshot: WorkbenchInspectionSnapshot,
  kind: WorkbenchOperationRequest["kind"],
  variant: WorkbenchOperationVariant,
): WorkbenchOperationRequest {
  const versionId = variant === "cloud" ? snapshot.refs.current ?? latestSnapshotVersionId(snapshot) : undefined;
  const evalHash = latestSnapshotEvalHash(snapshot);
  return {
    kind,
    variant,
    ...(versionId ? { versionId } : {}),
    ...(evalHash ? { evalHash } : {}),
    ...(snapshot.status.defaultSkill ? { skill: snapshot.status.defaultSkill } : {}),
    ...(snapshot.status.defaultAgent ? { agent: snapshot.status.defaultAgent } : {}),
    samples: 1,
    ...(kind === "improve" ? { budget: 1 } : {}),
  };
}

function latestSnapshotVersionId(snapshot: WorkbenchInspectionSnapshot): string | undefined {
  return snapshot.versions
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0]
    ?.id;
}

function latestSnapshotEvalHash(snapshot: WorkbenchInspectionSnapshot): string | undefined {
  return snapshot.evals
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.hash.localeCompare(left.hash))[0]
    ?.hash;
}

function hasActionableImproveEvidence(snapshot: WorkbenchInspectionSnapshot): boolean {
  return snapshot.runs.some((run) =>
    run.kind === "eval" &&
    (
      run.status === "failed" ||
      run.status === "canceled" ||
      ((runQualityScoreFromJobs(run, snapshot.jobs) ?? 1) < 1)
    )
  );
}

function workbenchAcquisitionOptions(
  snapshot: WorkbenchInspectionSnapshot,
  options: WorkbenchActionCapabilitiesOptions,
): WorkbenchActionCapabilities["acquisition"] {
  const acquisition: WorkbenchActionCapabilities["acquisition"][number][] = [];
  const handle = options.handle ?? snapshot.publication?.installHandle;
  if (handle) {
    acquisition.push({
      id: "install-package",
      label: "Install package",
      kind: "copy-command",
      value: `workbench install ${handle}`,
    });
    acquisition.push({
      id: "editable-source",
      label: "Create editable project",
      kind: "copy-command",
      value: `workbench clone ${handle} ${normalizeWorkbenchSkillName(options.skillName ?? handle.split("/").at(-1) ?? "skill") || "skill"}`,
    });
  }
  if (options.variant === "local") {
    acquisition.push({
      id: "open-local",
      label: "Open local project",
      kind: "copy-command",
      value: "workbench open",
    });
  }
  return acquisition;
}

function normalizeWorkbenchOperationRequest(
  request: WorkbenchOperationRequest,
  fallbackVariant: WorkbenchOperationVariant,
): WorkbenchOperationRequest {
  const samples = positiveIntegerOrUndefined(request.samples);
  const budget = positiveIntegerOrUndefined(request.budget);
  return {
    kind: request.kind,
    variant: request.variant ?? fallbackVariant,
    ...(request.runId ? { runId: request.runId } : {}),
    ...(request.versionId ? { versionId: request.versionId } : {}),
    ...(request.evalHash ? { evalHash: request.evalHash } : {}),
    ...(request.skill ? { skill: request.skill } : {}),
    ...(request.agent ? { agent: request.agent } : {}),
    ...(request.caseIds?.length ? { caseIds: [...request.caseIds] } : {}),
    samples: samples ?? 1,
    ...((request.kind === "run" || request.kind === "grade" || request.kind === "eval") && request.rerun === true ? { rerun: true } : {}),
    ...(request.kind === "improve" ? { budget: budget ?? 1 } : {}),
    ...(request.evidenceTraceIds?.length ? { evidenceTraceIds: [...request.evidenceTraceIds] } : {}),
    ...(request.retryOfRunId ? { retryOfRunId: request.retryOfRunId } : {}),
  };
}

function positiveIntegerOrUndefined(value: number | undefined): number | undefined {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : undefined;
}

function operationPreviewFromEvalPreview(
  request: WorkbenchOperationRequest,
  preview: WorkbenchEvalPreview,
): WorkbenchOperationPreview {
  return {
    kind: request.kind,
    variant: request.variant,
    ...operationPreviewReadiness(preview.readiness),
    versionId: preview.versionId,
    evalHash: preview.evalHash,
    skills: preview.skills.map(operationSelection),
    agents: preview.agents.map(operationSelection),
    caseCount: preview.cases,
    samples: preview.samples,
    cliEquivalent: workbenchOperationCliEquivalent(request),
  };
}

function operationPreviewFromImprovePreview(
  request: WorkbenchOperationRequest,
  preview: WorkbenchImprovePreview,
): WorkbenchOperationPreview {
  return {
    kind: "improve",
    variant: request.variant,
    ...operationPreviewReadiness(preview.readiness),
    versionId: preview.versionId,
    evalHash: preview.evalHash,
    skills: [operationSelection(preview.skill)],
    agents: [operationSelection(preview.agent)],
    caseCount: preview.proofCases,
    samples: preview.samples,
    budget: preview.budget,
    evidenceTraceIds: preview.evidenceTraceIds,
    evidenceCount: preview.evidenceCount,
    cliEquivalent: workbenchOperationCliEquivalent(request),
  };
}

function operationPreviewReadiness(
  readiness: WorkbenchLaunchReadiness,
): Pick<WorkbenchOperationPreview, "canStart" | "disabledReason" | "setupCommands"> {
  if (readiness.ready) {
    return { canStart: true };
  }
  const setupCommands = uniqueSetupCommands(readiness.issues.flatMap((issue) => {
    const commands = setupCommandsFromSubject(issue.subject);
    return commands.length > 0 ? commands : issue.remediation ? [issue.remediation] : [];
  }));
  return {
    canStart: false,
    disabledReason: readiness.issues.map((issue) => issue.message).join(" ") || "Launch readiness is blocked.",
    ...(setupCommands.length ? { setupCommands } : {}),
  };
}

function setupCommandsFromSubject(subject: Json | undefined): string[] {
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) {
    return [];
  }
  const commands = (subject as Record<string, Json>).setupCommands;
  return Array.isArray(commands)
    ? commands.filter((command): command is string => typeof command === "string" && command.trim().length > 0)
    : [];
}

function uniqueSetupCommands(commands: readonly string[]): string[] {
  return [...new Set(commands.map((command) => command.trim()).filter(Boolean))];
}

function operationSelection(value: { name: string; hash?: string }): WorkbenchOperationSelection {
  return {
    name: value.name,
    ...(value.hash ? { hash: value.hash } : {}),
  };
}

function disabledOperationPreviewFromError(
  request: WorkbenchOperationRequest,
  error: unknown,
): WorkbenchOperationPreview {
  const coded = codedErrorFromUnknown(error);
  const subjectSetupCommands = setupCommandsFromSubject(coded.subject);
  const setupCommands = uniqueSetupCommands(subjectSetupCommands.length > 0
    ? subjectSetupCommands
    : coded.remediation ? [coded.remediation] : []);
  return {
    kind: request.kind,
    variant: request.variant,
    canStart: false,
    skills: request.skill ? [{ name: request.skill }] : [],
    agents: request.agent ? [{ name: request.agent }] : [],
    caseCount: 0,
    samples: request.samples ?? 1,
    ...(request.kind === "improve" ? { budget: request.budget ?? 1 } : {}),
    disabledReason: coded.message,
    ...(setupCommands.length ? { setupCommands } : {}),
    cliEquivalent: workbenchOperationCliEquivalent(request),
  };
}

export async function requestLocalWorkbenchRunCancellation(
  options: WorkbenchCommandOptions & { runId: string; reason?: string },
): Promise<WorkbenchRunCancellationResult> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  const loadedState = await loadStateReadOnlyWithRetry(root);
  const stateWithHostedHandles = await applyLocalHostedRunHandles(root, loadedState);
  const state = await applyLocalRunCancellationRequests(root, stateWithHostedHandles);
  const run = state.runs.find((entry) => entry.id === options.runId);
  if (!run) {
    throw new WorkbenchCodedError("run_not_found", `Run not found: ${options.runId}`, {
      remediation: "workbench log --runs",
      subject: { runId: options.runId },
      exitCode: 1,
    });
  }
  if (isTerminalRunStatus(run.status)) {
    throw new WorkbenchCodedError("run_terminal", `Run ${run.id} is already ${run.status}.`, {
      remediation: `workbench show ${run.id}`,
      subject: { runId: run.id, status: run.status },
      exitCode: 2,
    });
  }
  const requestedAt = now();
  const requestPath = await writeLocalRunCancellationRequest(root, {
    runId: run.id,
    requestedAt,
    reason: options.reason ?? "user_requested",
  });
  const cancelingRun = runWithLocalCancellationRequest(run, requestedAt);
  await withWorkbenchProjectLockRootIfAvailable(root, async () => {
    const lockedState = await loadState(root);
    const lockedRun = lockedState.runs.find((entry) => entry.id === run.id);
    if (!lockedRun || isTerminalRunStatus(lockedRun.status)) {
      return;
    }
    upsertRunObject(lockedState.runs, runWithLocalCancellationRequest(lockedRun, requestedAt), { replace: true });
    await saveState(root, lockedState);
  });
  return { run: copyRun(cancelingRun), requestedAt, requestPath };
}

export async function hasWorkbenchLocalHostedRunHandle(
  options: WorkbenchCommandOptions & { runId: string },
): Promise<boolean> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  if (!await exists(localHostedRunHandlePath(root, options.runId))) {
    return false;
  }
  const state = await loadStateReadOnlyWithRetry(root);
  return !state.runs.some((run) => run.id === options.runId);
}

export async function hasWorkbenchLocalRunCancellationRequest(
  options: WorkbenchCommandOptions & { runId: string },
): Promise<boolean> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  return await hasLocalRunCancellationRequest(root, options.runId);
}

export async function recordWorkbenchLocalHostedRunCancellation(
  options: WorkbenchCommandOptions & {
    run: WorkbenchRun;
    requestedAt: string;
  },
): Promise<WorkbenchRun> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  const canceledRun: WorkbenchRun = {
    ...copyRun(options.run),
    status: "canceled",
    location: "cloud",
    cancelRequestedAt: options.run.cancelRequestedAt ?? options.requestedAt,
    finishedAt: options.run.finishedAt ?? options.requestedAt,
    lastProgressAt: options.requestedAt,
    error: options.run.error ?? "Canceled before Workbench Cloud accepted the run.",
  };
  await writeJson(localHostedRunHandlePath(root, canceledRun.id), canceledRun);
  await advanceLocalWorkbenchLiveState(root);
  const persisted = await withWorkbenchProjectLockRootIfAvailable(root, async () => {
    const state = await loadState(root);
    upsertRunObject(state.runs, canceledRun, { replace: true });
    await saveState(root, state);
    return true;
  });
  if (persisted) {
    await fs.rm(localHostedRunHandlePath(root, canceledRun.id), { force: true });
    await advanceLocalWorkbenchLiveState(root);
  }
  return copyRun(canceledRun);
}

export async function recordWorkbenchLocalHostedRunFailure(
  options: WorkbenchCommandOptions & {
    run: WorkbenchRun;
    error: string;
    failedAt?: string;
  },
): Promise<WorkbenchRun> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  const failedAt = options.failedAt ?? now();
  const failedRun: WorkbenchRun = {
    ...copyRun(options.run),
    status: "failed",
    location: "cloud",
    finishedAt: options.run.finishedAt ?? failedAt,
    lastProgressAt: failedAt,
    error: options.error,
  };
  await writeJson(localHostedRunHandlePath(root, failedRun.id), failedRun);
  await advanceLocalWorkbenchLiveState(root);
  const persisted = await withWorkbenchProjectLockRootIfAvailable(root, async () => {
    const state = await loadState(root);
    upsertRunObject(state.runs, failedRun, { replace: true });
    await saveState(root, state);
    return true;
  });
  if (persisted) {
    await fs.rm(localHostedRunHandlePath(root, failedRun.id), { force: true });
    await advanceLocalWorkbenchLiveState(root);
  }
  return copyRun(failedRun);
}

export async function recordWorkbenchCloudRunSnapshot(
  options: WorkbenchCommandOptions & {
    remoteName: string;
    run: WorkbenchRunSnapshot;
  },
): Promise<WorkbenchRun> {
  const root = resolveRoot(options.dir);
  return await withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const run = workbenchRunFromSnapshot(options.run, {
      remoteName: options.remoteName,
    });
    upsertRunObject(state.runs, run, { replace: true });
    await saveState(root, state);
    return copyRun(run);
  });
}

export async function recordWorkbenchLocalHostedRunHandle(
  options: WorkbenchCommandOptions & {
    run: WorkbenchRun;
  },
): Promise<WorkbenchRun> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  const run = copyRun(options.run);
  await writeJson(localHostedRunHandlePath(root, run.id), run);
  await advanceLocalWorkbenchLiveState(root);
  return run;
}

export async function clearWorkbenchLocalHostedRunHandle(
  options: WorkbenchCommandOptions & {
    runId: string;
  },
): Promise<void> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  await fs.rm(localHostedRunHandlePath(root, options.runId), { force: true });
  await advanceLocalWorkbenchLiveState(root);
}

async function writeLocalRunCancellationRequest(
  root: string,
  request: { runId: string; requestedAt: string; reason: string },
): Promise<string> {
  const requestPath = localRunCancellationRequestPath(root, request.runId);
  await fs.mkdir(path.dirname(requestPath), { recursive: true });
  await writeJson(requestPath, {
    schema: "workbench.local.run-cancel-request.v1",
    runId: request.runId,
    requestedAt: request.requestedAt,
    reason: request.reason,
  });
  return requestPath;
}

function runWithLocalCancellationRequest(run: WorkbenchRun, requestedAt: string): WorkbenchRun {
  return {
    ...run,
    status: "canceling",
    cancelRequestedAt: run.cancelRequestedAt ?? requestedAt,
    lastProgressAt: requestedAt,
  };
}

export async function recordWorkbenchCloudInspectionSnapshot(
  options: WorkbenchCommandOptions & {
    remoteName: string;
    snapshot: WorkbenchInspectionSnapshot;
  },
): Promise<void> {
  const root = resolveRoot(options.dir);
  await withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    for (const run of options.snapshot.runs) {
      upsertRunObject(state.runs, {
        ...copyRun(run),
        location: run.location ?? "cloud",
        remoteName: run.remoteName ?? options.remoteName,
      }, { replace: true });
    }
    for (const job of options.snapshot.jobs) {
      upsertJobObject(state.jobs, copyJob(job), { replace: true });
    }
    for (const trace of options.snapshot.traces) {
      upsertById(state.traces, copyTrace(trace));
    }
    for (const batch of options.snapshot.executionEvents) {
      upsertExecutionEventBatch(state.executionEvents, copyExecutionEventBatch(batch), { replace: true });
    }
    for (const artifact of options.snapshot.artifacts) {
      upsertById(state.artifacts, copyArtifact(artifact));
    }
    await saveState(root, state);
  });
}

function requireWorkbenchImproveTarget(
  runtime: WorkbenchVersionRuntimeSnapshot,
  options: { requireAdapter?: boolean } = {},
): {
  skillBundle: WorkbenchSkillBundleSnapshot;
  evalAgent: WorkbenchAgent;
} {
  if (runtime.skillBundles.length !== 1 || runtime.selectedAgents.length !== 1) {
    const configuredVersions = [...new Set(runtime.skillBundles.map((bundle) => bundle.skillName))].sort();
    const configuredAgents = [...new Set(runtime.selectedAgents.map((agent) => agent.name))].sort();
    const improvementCapableAgents = runtime.selectedAgents
      .filter(workbenchSkillImproveCanUseQueuedAdapter)
      .map((agent) => agent.name)
      .sort();
    throw new WorkbenchCodedError("usage", [
      "workbench improve requires exactly one version and one eval agent.",
      `Configured versions: ${configuredVersions.length > 0 ? configuredVersions.join(", ") : "none"}.`,
      `Configured agents: ${configuredAgents.length > 0 ? configuredAgents.join(", ") : "none"}.`,
      ...(improvementCapableAgents.length > 0
        ? [`Improvement-capable agents: ${improvementCapableAgents.join(", ")}.`]
        : []),
    ].join(" "), {
      remediation: improveSelectorRemediation(configuredVersions, improvementCapableAgents),
      subject: { configuredVersions, configuredAgents, improvementCapableAgents },
      exitCode: 2,
    });
  }
  const [skillBundle] = runtime.skillBundles;
  if (!skillBundle) {
    throw new WorkbenchUserError("No current skill version selected for improve.");
  }
  if (skillBundle.skillName !== CURRENT_SKILL_VERSION_NAME) {
    throw new WorkbenchUserError("workbench improve can edit only the current local project skill. Vendor or clone another skill before improving it.");
  }
  const [evalAgent] = runtime.selectedAgents;
  if (!evalAgent) {
    throw new WorkbenchUserError("No eval agent selected for improve.");
  }
  if (options.requireAdapter !== false) {
    requireWorkbenchImproveAgentAdapter(evalAgent);
  }
  return { skillBundle, evalAgent };
}

function requireWorkbenchImproveAgentAdapter(agent: WorkbenchAgent): void {
  if (!workbenchSkillImproveCanUseQueuedAdapter(agent)) {
    throw workbenchSkillImproveAdapterRequirementError(agent);
  }
}

export function workbenchImproveEvidenceRequirementMessage(): string {
  return "workbench improve needs graded below-perfect, failed, or reviewed eval evidence for the selected skill on this eval. Perfect eval runs do not qualify. Ungraded runtime or auth failures do not qualify. Add or edit an eval case that captures an actual failure, review a run as improvement evidence, or edit the package source directly.";
}

function workbenchImproveEvidenceRequirementError(args: {
  state: WorkbenchProjectState;
  versionId: string;
  skillName: string;
  evalHash: string;
  cases: readonly WorkbenchEvalCaseRuntime[];
  agentName?: string;
  preserveAgentSelection?: boolean;
}): WorkbenchCodedError {
  return new WorkbenchCodedError("improve_evidence_required", workbenchImproveEvidenceRequirementMessage(), {
    remediation: workbenchImproveEvidenceRequirementRemediation(args),
    exitCode: 2,
  });
}

function workbenchImproveEvidenceRequirementRemediation(args: {
  state: WorkbenchProjectState;
  versionId: string;
  skillName: string;
  evalHash: string;
  cases: readonly WorkbenchEvalCaseRuntime[];
  agentName?: string;
  preserveAgentSelection?: boolean;
}): string {
  const currentEvalRuns = args.state.runs
    .filter((run) =>
      run.kind === "eval" &&
      run.versionId === args.versionId &&
      run.skillName === args.skillName &&
      run.evalHash === args.evalHash
    )
    .sort((left, right) => workbenchRunObservedAt(right).localeCompare(workbenchRunObservedAt(left)));
  if (currentEvalRuns.length === 0) {
    return workbenchImproveEvidenceEvalCommand(args);
  }
  const latestAuthRemediation = currentEvalRuns
    .map((run) => adapterAuthRemediationFromError(run.error))
    .find((remediation): remediation is string => Boolean(remediation));
  if (latestAuthRemediation) {
    return latestAuthRemediation;
  }
  if (!currentEvalRuns.some((run) => runQualityScoreFromJobs(run, args.state.jobs) !== undefined)) {
    const latestTerminal = currentEvalRuns.find(isTerminalRun);
    return latestTerminal ? `workbench show ${latestTerminal.id}` : workbenchImproveEvidenceEvalCommand(args);
  }
  return nextWorkbenchEvalCaseCommand(args.cases);
}

function workbenchImproveEvidenceEvalCommand(args: {
  agentName?: string;
  preserveAgentSelection?: boolean;
}): string {
  if (args.preserveAgentSelection && args.agentName) {
    return `workbench eval --agents ${quoteShellArg(args.agentName)}`;
  }
  return "workbench eval";
}

function workbenchRunObservedAt(run: WorkbenchRun): string {
  return run.finishedAt ?? run.lastProgressAt ?? run.createdAt;
}

function nextWorkbenchEvalCaseCommand(cases: readonly WorkbenchEvalCaseRuntime[]): string {
  const existing = new Set(cases.flatMap((entry) => [entry.id, path.basename(path.dirname(entry.path))]));
  for (let index = 1; ; index += 1) {
    const id = `case-${String(index).padStart(3, "0")}`;
    if (!existing.has(id)) {
      return workbenchAuthorEvalCaseCommand(id);
    }
  }
}

function improveSelectorRemediation(
  configuredVersions: readonly string[],
  improvementCapableAgents: readonly string[],
): string {
  const version = configuredVersions[0] ?? CURRENT_SKILL_VERSION_NAME;
  const agent = improvementCapableAgents[0];
  if (agent) {
    return `workbench improve --versions ${version} --agents ${agent}`;
  }
  return providerAgentSetupCommand("codex", "default");
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

function shouldSkipVersionForResultsSelection(
  error: unknown,
  options: Pick<WorkbenchResultsOptions, "versions" | "agents">,
  versionCount: number,
): boolean {
  if (versionCount <= 1 || !(error instanceof WorkbenchUserError)) {
    return false;
  }
  const message = error.message.trim();
  if (isNamedResultsSelection(options.agents) && message.startsWith("Agent not found: ")) {
    return true;
  }
  return isNamedResultsSelection(options.versions) && message.startsWith("Skill not found: ");
}

async function resultsSelectionErrorWithLiveControls(
  root: string,
  error: unknown,
  options: Pick<WorkbenchResultsOptions, "agents">,
): Promise<unknown> {
  if (
    !isNamedResultsSelection(options.agents) ||
    !(error instanceof WorkbenchUserError) ||
    !error.message.trim().startsWith("Agent not found: ")
  ) {
    return error;
  }
  try {
    await resolveRequestedAgents(root, options.agents, "results");
    return error;
  } catch (liveError) {
    return liveError instanceof WorkbenchUserError ? liveError : error;
  }
}

function isNamedResultsSelection(selection: string | undefined): boolean {
  const normalized = selection?.trim();
  return Boolean(normalized && normalized !== ALL_SELECTOR);
}

interface NormalizedResultsSelection {
  projectVersions: string;
  skills?: string;
}

function normalizeWorkbenchResultsSelection(
  state: WorkbenchProjectState,
  options: Pick<WorkbenchResultsOptions, "projectVersions" | "resultVersions" | "versions">,
): NormalizedResultsSelection {
  const publicVersions = options.resultVersions?.trim();
  if (!publicVersions) {
    return {
      projectVersions: options.projectVersions ?? "current",
      skills: options.versions,
    };
  }
  if (publicVersions === ALL_SELECTOR) {
    return {
      projectVersions: ALL_SELECTOR,
      skills: ALL_SELECTOR,
    };
  }
  const projectVersions = resolveProjectResultsVersionSelection(state, publicVersions);
  if (projectVersions) {
    return {
      projectVersions,
      skills: options.versions ?? CURRENT_SKILL_VERSION_NAME,
    };
  }
  return {
    projectVersions: options.projectVersions ?? ALL_SELECTOR,
    skills: publicVersions,
  };
}

function resolveProjectResultsVersionSelection(
  state: WorkbenchProjectState,
  selection: string,
): string | null {
  try {
    resolveVersionSelection(state, selection);
    return selection;
  } catch (error) {
    if (looksLikeProjectVersionSelection(selection)) {
      throw resultsVersionSelectionError(state, error);
    }
    return null;
  }
}

function looksLikeProjectVersionSelection(selection: string): boolean {
  return selection.includes("..") ||
    selection.split(",").map((part) => part.trim()).filter(Boolean).some((part) =>
      part === "current" ||
      part.startsWith("v_") ||
      /^[0-9a-f]{6,}$/iu.test(part)
    );
}

function resultsVersionSelectionError(
  state: WorkbenchProjectState,
  error: unknown,
): WorkbenchCodedError {
  const message = error instanceof Error ? error.message : String(error);
  const configuredVersions = resultsConfiguredVersionRefs(state);
  return new WorkbenchCodedError("usage", message, {
    remediation: "workbench results --versions current",
    subject: { configuredVersions },
    exitCode: 2,
  });
}

function resultsConfiguredVersionRefs(state: WorkbenchProjectState): string[] {
  const refs = [
    ...(state.refs.current ? ["current"] : []),
    ...state.versions.slice(-8).map(versionDisplayCandidate),
  ];
  return [...new Set(refs)].sort();
}

export async function resultsWorkbench(options: WorkbenchResultsOptions = {}): Promise<WorkbenchResults> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const selection = normalizeWorkbenchResultsSelection(state, options);
    const runtimeAgents = await runtimeAgentOptionsForRoot(root, state);
    const internalSelection: InternalComparisonSelection = {
      versions: selection.projectVersions,
      skills: selection.skills,
      agents: options.agents,
      availableAgents: runtimeAgents.agents,
      ...(runtimeAgents.defaultAgent ? { defaultAgent: runtimeAgents.defaultAgent } : {}),
    };
    const recordedComparison = buildInternalComparisonFromState(state, internalSelection);
    if (recordedComparison.cells.some((cell) => cell.runId || cell.status)) {
      const completedComparison = await completeRecordedResultsSelectionMatrix(state, recordedComparison, {
        ...options,
        versions: selection.skills,
        availableAgents: runtimeAgents.agents,
        ...(runtimeAgents.defaultAgent ? { defaultAgent: runtimeAgents.defaultAgent } : {}),
      });
      return resultsFromInternalComparison(completedComparison, state);
    }
    const versions = resolveVersionSelection(state, selection.projectVersions);
    if (versions.length === 0) {
      return resultsFromInternalComparison({
        versions: [],
        skills: [],
        agents: [],
        cells: [],
      }, state);
    }
    const cells: InternalComparisonCell[] = [];
    const comparedSkills: WorkbenchSkillBundleSnapshot[] = [];
    const comparedAgents: WorkbenchAgent[] = [];
    const comparedVersions: WorkbenchVersion[] = [];
    const skippedVersions: string[] = [];
    let skippedSelectionError: unknown;
    const evalHashes = new Set<string>();
    for (const version of versions) {
      let runtime: WorkbenchVersionRuntimeSnapshot;
      try {
        runtime = await createWorkbenchVersionRuntimeSnapshot(version, {
          skill: selection.skills,
          agent: options.agents,
          authToken: options.authToken,
          selectionRemediationCommand: "results",
          ...runtimeAgents,
        });
      } catch (error) {
        const selectionError = await resultsSelectionErrorWithLiveControls(root, error, options);
        if (shouldSkipVersionForResultsSelection(error, {
          versions: selection.skills,
          agents: options.agents,
        }, versions.length)) {
          skippedSelectionError ??= selectionError;
          skippedVersions.push(version.id);
          continue;
        }
        throw selectionError;
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
          const evidence = bestComparableEvidence({
            runs: state.runs,
            jobs: state.jobs,
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
            ...(evidence ? comparisonCellEvidenceFields(evidence) : {}),
          });
        }
      }
    }
    if (comparedVersions.length === 0 && skippedVersions.length > 0) {
      if (skippedSelectionError) {
        throw skippedSelectionError;
      }
      throw new WorkbenchUserError("No selected versions define the requested result versions or agents.");
    }
    const [onlyEvalHash] = [...evalHashes];
    return resultsFromInternalComparison({
      ...(evalHashes.size === 1 && onlyEvalHash ? { evalHash: onlyEvalHash } : {}),
      versions: comparedVersions,
      skills: comparedSkills,
      agents: uniqueAgentSnapshots(comparedAgents),
      cells,
    }, state);
  });
}

async function completeRecordedResultsSelectionMatrix(
  state: WorkbenchProjectState,
  comparison: InternalComparison,
  options: Pick<WorkbenchResultsOptions, "versions" | "agents" | "authToken"> & {
    availableAgents?: readonly WorkbenchAgent[];
    defaultAgent?: string;
  },
): Promise<InternalComparison> {
  const versions = comparison.versions;
  const cells = [...comparison.cells];
  const skills = [...comparison.skills];
  const agents = [...comparison.agents];
  const evalHashes = new Set<string>([
    ...(comparison.evalHash ? [comparison.evalHash] : []),
    ...cells.map((cell) => cell.evalHash),
  ]);
  const existingCellKeys = new Set(cells.map(comparisonCellAxisKey));
  const versionOrder = new Map(versions.map((version, index) => [version.id, index]));
  const defaultAgent = options.defaultAgent ?? defaultWorkbenchAgentSelectionFromState(state);

  for (const version of versions) {
    let runtime: WorkbenchVersionRuntimeSnapshot;
    try {
      runtime = await createWorkbenchVersionRuntimeSnapshot(version, {
        skill: options.versions,
        agent: options.agents,
        authToken: options.authToken,
        selectionRemediationCommand: "results",
        agents: options.availableAgents ?? state.agents,
        ...(defaultAgent ? { defaultAgent } : {}),
      });
    } catch (error) {
      const alreadyHasEvidence = cells.some((cell) => cell.versionId === version.id && (cell.runId || cell.status));
      if (alreadyHasEvidence || shouldSkipVersionForResultsSelection(error, options, versions.length)) {
        continue;
      }
      throw error;
    }

    evalHashes.add(runtime.evalSnapshot.hash);
    upsertEvalSnapshotObject(state.evals, runtime.evalSnapshot);
    upsertAgentSnapshots(state.agents, runtime.agents);
    for (const bundle of runtime.skillBundles) {
      upsertByHash(state.skillBundles, bundle);
      if (!skills.some((entry) => entry.hash === bundle.hash)) {
        skills.push(bundle);
      }
    }
    for (const agent of uniqueAgentSnapshots(runtime.selectedAgents)) {
      if (!agents.some((entry) => entry.hash === agent.hash)) {
        agents.push(agent);
      }
    }

    for (const skill of runtime.skillBundles) {
      for (const agent of runtime.selectedAgents) {
        const agentHash = hashJson(agent);
        const cell: InternalComparisonCell = {
          versionId: version.id,
          skillName: skill.skillName,
          skillBundleHash: skill.hash,
          evalHash: runtime.evalSnapshot.hash,
          agentName: agent.name,
          agentHash,
        };
        const key = comparisonCellAxisKey(cell);
        if (existingCellKeys.has(key)) {
          continue;
        }
        const evidence = bestComparableEvidence({
          runs: state.runs,
          jobs: state.jobs,
          versionId: version.id,
          skillName: skill.skillName,
          skillBundleHash: skill.hash,
          evalHash: runtime.evalSnapshot.hash,
          agentName: agent.name,
          agentHash,
        });
        cells.push({
          ...cell,
          ...(evidence ? comparisonCellEvidenceFields(evidence) : {}),
        });
        existingCellKeys.add(key);
      }
    }
  }

  const [onlyEvalHash] = [...evalHashes];
  return {
    ...(evalHashes.size === 1 && onlyEvalHash ? { evalHash: onlyEvalHash } : {}),
    versions,
    skills: uniqueSkillBundles(skills),
    agents: uniqueResolvedAgentSnapshots(agents),
    cells: cells.sort((left, right) =>
      (versionOrder.get(left.versionId) ?? Number.MAX_SAFE_INTEGER) -
        (versionOrder.get(right.versionId) ?? Number.MAX_SAFE_INTEGER) ||
      left.skillName.localeCompare(right.skillName) ||
      left.agentName.localeCompare(right.agentName) ||
      left.skillBundleHash.localeCompare(right.skillBundleHash) ||
      left.evalHash.localeCompare(right.evalHash) ||
      left.agentHash.localeCompare(right.agentHash)
    ),
  };
}

function comparisonCellAxisKey(cell: Pick<InternalComparisonCell, "versionId" | "skillName" | "skillBundleHash" | "evalHash" | "agentName" | "agentHash">): string {
  return [
    cell.versionId,
    cell.skillName,
    cell.skillBundleHash,
    cell.evalHash,
    cell.agentName,
    cell.agentHash,
  ].join("\0");
}

function resultsFromInternalComparison(
  comparison: InternalComparison,
  state: WorkbenchProjectState,
): WorkbenchResults {
  const skillByHash = new Map(comparison.skills.map((skill) => [skill.hash, skill]));
  const agentByHash = new Map(comparison.agents.map((agent) => [agent.hash, agent]));
  const evalByHash = new Map(state.evals.map((evalSnapshot) => [evalSnapshot.hash, evalSnapshot]));
  const projectVersionById = new Map(comparison.versions.map((version) => [version.id, version]));
  const localOrdinalByProjectVersionId = resultLocalVersionOrdinals(state);
  const resultVersions = new Map<string, WorkbenchResults["versions"][number]>();
  const resultAgents = new Map<string, WorkbenchResults["agents"][number]>();
  const resultEvaluations = new Map<string, WorkbenchResults["evaluations"][number]>();
  const resultCells = new Map<string, WorkbenchResults["cells"][number]>();
  const createdAtByRunId = new Map(state.runs.map((run) => [run.id, run.createdAt]));

  for (const cell of comparison.cells) {
    const skill = skillByHash.get(cell.skillBundleHash);
    const agent = agentByHash.get(cell.agentHash);
    if (!skill || !agent) {
      continue;
    }
    const projectVersion = projectVersionById.get(cell.versionId);
    const skillVersion = resultVersionFromInternalCell(
      cell,
      skill,
      projectVersion,
      localOrdinalByProjectVersionId,
      state,
    );
    const evaluation = evalByHash.get(cell.evalHash);
    const resultCell: WorkbenchResults["cells"][number] = {
      skillVersionId: skillVersion.id,
      evaluationId: cell.evalHash,
      agentVersionId: cell.agentHash,
      ...(cell.runId ? { runId: cell.runId } : {}),
      ...(cell.status ? { status: cell.status } : {}),
      ...(cell.score !== undefined ? { quality: cell.score } : {}),
      ...(cell.samples !== undefined ? { samples: cell.samples } : {}),
      ...(cell.costUsd !== undefined ? { costUsd: cell.costUsd } : {}),
      ...(cell.latencyMs !== undefined ? { latencyMs: cell.latencyMs } : {}),
      ...(cell.error ? { error: cell.error } : {}),
    };
    const resultCellKey = [
      resultCell.skillVersionId,
      resultCell.evaluationId,
      resultCell.agentVersionId,
    ].join("\0");
    const existingCell = resultCells.get(resultCellKey);
    if (!existingCell || compareResultCellEvidence(resultCell, existingCell, createdAtByRunId) > 0) {
      resultCells.set(resultCellKey, resultCell);
    }
    resultVersions.set(skillVersion.id, skillVersion);
    resultAgents.set(cell.agentHash, {
      id: cell.agentHash,
      name: agent.agent.name,
      label: agent.agent.name,
      adapter: agent.agent.adapter,
      ...(agent.agent.model ? { model: agent.agent.model } : {}),
    });
    resultEvaluations.set(cell.evalHash, {
      id: cell.evalHash,
      ...(evaluation ? {
        caseCount: evaluation.caseCount,
        gradeAdapter: evaluation.gradeAdapter,
        createdAt: evaluation.createdAt,
        updatedAt: evaluation.updatedAt,
      } : {}),
    });
  }

  return {
    versions: [...resultVersions.values()].sort((left, right) =>
      resultVersionSortKey(left).localeCompare(resultVersionSortKey(right))
    ),
    evaluations: [...resultEvaluations.values()].sort((left, right) =>
      (left.createdAt ?? "").localeCompare(right.createdAt ?? "") || left.id.localeCompare(right.id)
    ),
    agents: [...resultAgents.values()].sort((left, right) =>
      left.label.localeCompare(right.label) || left.id.localeCompare(right.id)
    ),
    cells: [...resultCells.values()].sort((left, right) =>
      resultVersionSortKey(resultVersions.get(left.skillVersionId)).localeCompare(resultVersionSortKey(resultVersions.get(right.skillVersionId))) ||
      left.evaluationId.localeCompare(right.evaluationId) ||
      left.agentVersionId.localeCompare(right.agentVersionId)
    ),
  };
}

function resultVersionFromInternalCell(
  cell: InternalComparisonCell,
  skill: WorkbenchSkillBundleSnapshot,
  projectVersion: WorkbenchVersion | undefined,
  localOrdinalByProjectVersionId: ReadonlyMap<string, number>,
  state: WorkbenchProjectState,
): WorkbenchResults["versions"][number] {
  const id = resultSkillVersionId(skill, cell);
  const localOrdinal = localOrdinalByProjectVersionId.get(cell.versionId) ?? 1;
  const source = resultSkillVersionSource(skill);
  return {
    id,
    label: resultSkillVersionLabel(skill, localOrdinal),
    source,
    sourceKind: skill.source.kind,
    projectVersionId: cell.versionId,
    contentHash: skill.hash,
    current: skill.source.kind === "local" &&
      (skill.source.source === "local:." || !skill.source.path || skill.source.path === ".") &&
      cell.versionId === state.refs.current,
    files: skill.files.map(copyFile),
    ...(projectVersion && remoteCurrentRefPromotesVersionInState(state, projectVersion.id) ? { published: true } : {}),
  };
}

function resultSkillVersionId(
  skill: WorkbenchSkillBundleSnapshot,
  cell: InternalComparisonCell,
): string {
  if (skill.source.kind === "local" && (skill.source.source === "local:." || !skill.source.path || skill.source.path === ".")) {
    return cell.versionId;
  }
  return resultSkillVersionSource(skill) || skill.hash;
}

function resultSkillVersionSource(skill: WorkbenchSkillBundleSnapshot): string | undefined {
  if (skill.source.source) {
    return skill.source.source;
  }
  if (skill.source.kind === "none") {
    return "none";
  }
  if (skill.source.kind === "local" && skill.source.path) {
    return `local:${skill.source.path}`;
  }
  if (skill.source.kind === "remote" && skill.source.from && skill.source.ref) {
    return `${skill.source.from}@${skill.source.ref}`;
  }
  return undefined;
}

function resultSkillVersionLabel(skill: WorkbenchSkillBundleSnapshot, localOrdinal: number): string {
  const sourceLabel = skill.source.label?.trim();
  if (skill.source.kind === "none" || skill.skillName === "no-skill") {
    return sourceLabel || "No skill";
  }
  if (skill.source.kind === "local" && (skill.source.source === "local:." || !skill.source.path || skill.source.path === ".")) {
    return `${sourceLabel || skillBundleFrontmatterName(skill) || readableResultLabel(skill.skillName)} v${localOrdinal}`;
  }
  if (sourceLabel) {
    return sourceLabel;
  }
  if (skill.source.source?.startsWith("workbench:")) {
    return skill.source.source.slice("workbench:".length);
  }
  return readableResultLabel(skill.skillName);
}

function skillBundleFrontmatterName(skill: WorkbenchSkillBundleSnapshot): string | undefined {
  const entrySkillPath = `${normalizeRelativePath(skill.entryName)}/${SKILL_FILE}`;
  const isTextSkillFile = (file: SurfaceSnapshotFile) =>
    (file.kind ?? "text") === "text" && (file.encoding ?? "utf8") === "utf8";
  const skillFile = skill.files.find((file) => file.path === entrySkillPath && isTextSkillFile(file)) ??
    skill.files.find((file) => file.path === SKILL_FILE && isTextSkillFile(file));
  if (!skillFile?.content) {
    return undefined;
  }
  return skillFrontmatterName(skillFile.content);
}

function skillFrontmatterName(content: string): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  if (!match) {
    return undefined;
  }
  try {
    const record = parseYamlRecord(match[1] ?? "");
    const name = record.name;
    return typeof name === "string" && name.trim() ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}

function resultLocalVersionOrdinals(state: WorkbenchProjectState): Map<string, number> {
  const sorted = [...state.versions].sort(compareVersionIds);
  return new Map(sorted.map((version, index) => [version.id, index + 1]));
}

function compareResultCellEvidence(
  left: WorkbenchResults["cells"][number],
  right: WorkbenchResults["cells"][number],
  createdAtByRunId: ReadonlyMap<string, string>,
): number {
  const leftTerminal = left.status ? isTerminalRunStatus(left.status) : false;
  const rightTerminal = right.status ? isTerminalRunStatus(right.status) : false;
  if (leftTerminal !== rightTerminal) {
    return leftTerminal ? 1 : -1;
  }
  const sampleDelta = (left.samples ?? 0) - (right.samples ?? 0);
  if (sampleDelta !== 0) {
    return sampleDelta;
  }
  const leftCreated = left.runId ? createdAtByRunId.get(left.runId) ?? "" : "";
  const rightCreated = right.runId ? createdAtByRunId.get(right.runId) ?? "" : "";
  return leftCreated.localeCompare(rightCreated);
}

function resultVersionSortKey(version: WorkbenchResults["versions"][number] | undefined): string {
  return version?.projectVersionId ?? version?.id ?? "";
}

function remoteCurrentRefPromotesVersionInState(state: WorkbenchProjectState, versionId: string): boolean {
  return publishedVersionIdFromRefs(state.refs) === versionId || publishedVersionIdsFromRefs(state.refs).includes(versionId);
}

function readableResultLabel(value: string): string {
  const normalized = value.trim().replace(/[-_]+/gu, " ");
  return normalized ? normalized.replace(/\b\w/gu, (match) => match.toUpperCase()) : "Version";
}

export function buildInternalComparisonFromState(
  state: WorkbenchProjectState,
  options: InternalComparisonSelection = {},
): InternalComparison {
  const versions = resolveVersionSelection(state, options.versions ?? "current");
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

  for (const job of [...state.jobs].sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    if (!versionIds.has(job.versionId) || !skillSelectionIncludes(options.skills, job.skillName, job.skillBundleHash)) {
      continue;
    }
    const version = versions.find((entry) => entry.id === job.versionId);
    const bundle = skillBundlesByHash.get(job.skillBundleHash);
    if (!version || !bundle) {
      continue;
    }
    const key = comparisonEntryKey(job.versionId, job.skillName, job.skillBundleHash, job.evalHash);
    entriesByKey.set(key, { version, bundle, evalHash: job.evalHash });
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
  const entryVersions = [...new Map(entries.map((entry) => [entry.version.id, entry.version])).values()];
  const agentsByVersionId = new Map(entryVersions.map((version) => [
    version.id,
    resolveComparisonAgentsForVersionFromState(state, version, options.agents, {
      ...(options.availableAgents ? { availableAgents: options.availableAgents } : {}),
      ...(options.defaultAgent ? { defaultAgent: options.defaultAgent } : {}),
    }),
  ]));
  const comparedAgents = uniqueResolvedAgentSnapshots(
    entries.flatMap((entry) => agentsByVersionId.get(entry.version.id) ?? []),
  );
  const comparedSkills = uniqueSkillBundles(entries.map((entry) => entry.bundle));
  const evalHashes = new Set(entries.map((entry) => entry.evalHash));
  const cells: InternalComparisonCell[] = [];

  for (const entry of entries) {
    const agents = agentsByVersionId.get(entry.version.id) ?? [];
    for (const agent of agents) {
      const evidence = bestComparableEvidence({
        runs: state.runs,
        jobs: state.jobs,
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
        ...(evidence ? comparisonCellEvidenceFields(evidence) : {}),
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

export function buildWorkbenchResultsFromState(
  state: WorkbenchProjectState,
  options: InternalComparisonSelection = {},
): WorkbenchResults {
  return resultsFromInternalComparison(buildInternalComparisonFromState(state, options), state);
}

export async function switchWorkbenchVersion(versionRef: string, options: WorkbenchCommandOptions = {}): Promise<WorkbenchVersion> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  const state = await loadState(root);
  await reconcileWorkbenchVersion(root, state, SOURCE_SNAPSHOT_MESSAGE);
  const version = resolveVersion(state, versionRef);
  await materializeSkillFiles(root, version.files);
  state.remotes = await readWorkbenchRemotesFile(root);
  state.refs.current = version.id;
  await saveState(root, state);
  return version;
  });
}

export async function diffWorkbenchVersions(range: string, options: WorkbenchCommandOptions = {}): Promise<WorkbenchDiffEntry[]> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  const state = await loadState(root);
  await reconcileWorkbenchVersion(root, state, SOURCE_SNAPSHOT_MESSAGE);
  await saveState(root, state);
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
  const state = await loadState(root);
  await reconcileWorkbenchVersion(root, state, SOURCE_SNAPSHOT_MESSAGE);
  await saveState(root, state);
  const [objectRef, filePath] = splitObjectPath(ref);
  const version = findVersion(state, objectRef);
  if (version) {
    if (!filePath) {
      return version;
    }
    const file = version.files.find((entry) => entry.path === filePath);
    if (!file) {
      throw new WorkbenchCodedError("ref_not_found", `File not found in ${version.id}: ${filePath}`, {
        remediation: `workbench show ${version.id}`,
        subject: { ref: version.id, path: filePath },
        exitCode: 1,
      });
    }
    return file;
  }
  const run = resolveStateObjectByRef(state.runs, objectRef, "run");
  if (run) {
    return run;
  }
  const job = resolveStateObjectByRef(state.jobs, objectRef, "job");
  if (job) {
    return job;
  }
  const trace = resolveStateObjectByRef(state.traces, objectRef, "trace");
  if (trace) {
    if (filePath) {
      const file = trace.files.filter(isUserFacingTraceFile).find((entry) => entry.path === filePath);
      if (!file) {
        throw new WorkbenchCodedError("ref_not_found", `File not found in ${trace.id}: ${filePath}`, {
          remediation: `workbench show ${trace.id}`,
          subject: { ref: trace.id, path: filePath },
          exitCode: 1,
        });
      }
      return file;
    }
    return trace;
  }
  const artifact = resolveStateObjectByRef(state.artifacts, objectRef, "artifact");
  if (artifact) {
    if (filePath) {
      const file = artifact.files.find((entry) => entry.path === filePath);
      if (!file) {
        throw new WorkbenchCodedError("ref_not_found", `File not found in ${artifact.id}: ${filePath}`, {
          remediation: `workbench show ${artifact.id}`,
          subject: { ref: artifact.id, path: filePath },
          exitCode: 1,
        });
      }
      return file;
    }
    return artifact;
  }
  throw new WorkbenchCodedError("ref_not_found", `Workbench object not found: ${objectRef}`, {
    remediation: "workbench log --json",
    subject: { ref: objectRef },
    exitCode: 1,
  });
  });
}

function resolveStateObjectByRef<T extends { id: string }>(
  entries: readonly T[],
  ref: string,
  kind: "run" | "job" | "trace" | "artifact",
): T | undefined {
  const normalized = ref.trim();
  if (!normalized) {
    return undefined;
  }
  const candidates = entries.filter((entry) => objectIdRefMatches(entry.id, normalized));
  if (candidates.length > 1) {
    throw new WorkbenchCodedError("ref_ambiguous", `${capitalize(kind)} ref is ambiguous: ${ref}. Candidates: ${candidates.map((entry) => entry.id).slice(0, 8).join(", ")}.`, {
      subject: { ref, candidates: candidates.map((entry) => entry.id).slice(0, 20) },
      exitCode: 2,
    });
  }
  return candidates[0];
}

function objectIdRefMatches(id: string, ref: string): boolean {
  if (id === ref || id.startsWith(ref)) {
    return true;
  }
  if (ref.includes("_")) {
    return false;
  }
  const separator = id.indexOf("_");
  return separator !== -1 && id.slice(separator + 1).startsWith(ref);
}

export async function filesForWorkbenchRef(ref: string, options: WorkbenchCommandOptions = {}): Promise<SurfaceSnapshotFile[]> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  const state = await loadState(root);
  await reconcileWorkbenchVersion(root, state, SOURCE_SNAPSHOT_MESSAGE);
  await saveState(root, state);
  const version = findVersion(state, ref);
  if (version) {
    return version.files.map(copyFile);
  }
  const trace = resolveStateObjectByRef(state.traces, ref, "trace");
  if (trace) {
    return trace.files.filter(isUserFacingTraceFile).map(copyFile);
  }
  const artifact = resolveStateObjectByRef(state.artifacts, ref, "artifact");
  if (artifact) {
    return artifact.files.map(copyFile);
  }
  throw new WorkbenchCodedError("ref_not_found", `Workbench file object not found: ${ref}`, {
    remediation: "workbench log --json",
    subject: { ref },
    exitCode: 1,
  });
  });
}

function isUserFacingTraceFile(file: SurfaceSnapshotFile): boolean {
  const normalized = normalizeRelativePath(file.path);
  if (normalized.split("/").includes(".workbench")) {
    return false;
  }
  const basename = path.basename(normalized);
  return basename !== "request.json" && basename !== "result.json" && basename !== "trace.json";
}

export async function listWorkbenchAgents(options: WorkbenchCommandOptions = {}): Promise<WorkbenchAgent[]> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  const state = await loadState(root);
  await reconcileWorkbenchVersion(root, state, SOURCE_SNAPSHOT_MESSAGE);
  await saveState(root, state);
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
    await saveState(root, state);
    return agent;
  });
}

export async function removeWorkbenchAgent(name: string, options: WorkbenchCommandOptions = {}): Promise<{ removed: string }> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
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
    await saveState(root, state);
    return { removed: agentName };
  });
}

export async function setDefaultWorkbenchAgent(name: string, options: WorkbenchCommandOptions = {}): Promise<{ defaultAgent: string }> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
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
    await saveState(root, state);
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
                remediation: `Update .workbench/remotes.yaml so ${remoteName} points at ${remote.url}.`,
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

export async function clearDeletedWorkbenchCloudProjectLocalState(options: WorkbenchCommandOptions & {
  baseUrl: string;
  handle: string;
}): Promise<WorkbenchDeletedCloudProjectLocalStateCleanup> {
  const root = resolveRoot(options.dir);
  if (!await exists(workbenchDir(root))) {
    return { root, initialized: false, removedRemotes: [], clearedPublication: false };
  }
  return withWorkbenchProjectLockRoot(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const handle = options.handle.trim();
    const removedRemotes: string[] = [];
    for (const [remoteName, remote] of Object.entries(state.remotes)) {
      if (!workbenchCloudRemoteMatchesHandle(remote, options.baseUrl, handle)) {
        continue;
      }
      delete state.remotes[remoteName];
      await clearRemoteLocalState(root, state, remoteName);
      removedRemotes.push(remoteName);
    }
    const clearedPublication = clearPublicationRefsForHandle(state.refs, handle);
    if (removedRemotes.length > 0 || clearedPublication) {
      await saveState(root, state);
    }
    return {
      root,
      initialized: true,
      removedRemotes: removedRemotes.sort(),
      clearedPublication,
    };
  });
}

function workbenchCloudRemoteMatchesHandle(remote: WorkbenchRemote, baseUrl: string, handle: string): boolean {
  if (remote.kind !== "workbench-cloud") {
    return false;
  }
  try {
    const parsed = parseHttpRemote(remote);
    return normalizedBaseUrl(parsed.baseUrl) === normalizedBaseUrl(baseUrl) &&
      `${parsed.owner}/${parsed.name}` === handle;
  } catch {
    return false;
  }
}

function clearPublicationRefsForHandle(refs: WorkbenchRefs, handle: string): boolean {
  if (refs["publication/install-handle"] !== handle) {
    return false;
  }
  for (const name of Object.keys(refs)) {
    if (isPublicationRef(name)) {
      delete refs[name];
    }
  }
  return true;
}

function normalizedBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString().replace(/\/$/u, "");
  } catch {
    return value.trim().replace(/\/+$/u, "");
  }
}

export async function listWorkbenchRemotes(options: WorkbenchCommandOptions = {}): Promise<WorkbenchRemote[]> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    await reconcileWorkbenchVersion(root, state, SOURCE_SNAPSHOT_MESSAGE);
    await saveState(root, state);
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
      await reconcileWorkbenchVersion(root, state, SOURCE_SNAPSHOT_MESSAGE);
      const localPack = exportObjectPackForRemote(state);
      const remotePackRaw = await readRemoteObjectPack(remote, { authToken: options.authToken, signal: options.signal }).catch((error) => {
        if (fileErrorCode(error) === "ENOENT") {
          return emptyObjectPack();
        }
        throw error;
      });
      const remotePack = remote.kind === "workbench-cloud"
        ? objectPackWithCloudLifecycleOwner(remotePackRaw, remote.name)
        : remotePackRaw;
      const before = objectPackSize(localPack);
      importObjectPack(state, remotePack, {
        refs: "none",
        lifecycleObjects: isHttpRemote(remote) ? "replace" : "merge",
      });
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
      const remoteIsHttp = isHttpRemote(remote);
      const remoteComparablePack = remote.kind === "workbench-cloud"
        ? objectPackWithoutCloudOwnedLifecycleObjects(merged, remote.name)
        : merged;
      const remoteWritePack = remoteIsHttp
        ? objectPackDeltaForRemoteWrite(remoteComparablePack, remotePack, { remoteOwnsLifecycleObjects: true })
        : merged;
      const pushed = remoteIsHttp
        ? objectPackSize(remoteWritePack)
        : Math.max(0, objectPackSize(merged) - objectPackSize(remotePack));
      const pulled = Math.max(0, objectPackSize(merged) - before);
      const remoteTrackingRefs = remote.kind === "workbench-cloud"
        ? remoteTrackingRefsForCloudSync(merged.refs, remotePack.refs)
        : merged.refs;
      const result: WorkbenchSyncResult = {
        remote,
        pushed,
        pulled,
        upToDate: pushed === 0 && pulled === 0,
        ...(options.dryRun === true ? { dryRun: true } : {}),
        publication: remote.kind === "workbench-cloud"
          ? publicationStatusFromRefs(withRemoteTrackingRefs({ ...state.refs }, remote.name, remoteTrackingRefs), remote.name)
          : unpublishedPublicationStatus(),
      };
      if (options.dryRun === true) {
        return result;
      }
      if (!remoteIsHttp || objectPackSize(remoteWritePack) > 0) {
        await writeRemoteObjectPack(remote, remoteWritePack, state, { authToken: options.authToken, signal: options.signal });
      }
      state.refs = withRemoteTrackingRefs(state.refs, remote.name, remoteTrackingRefs);
      await saveState(root, state);
      await writeRemoteSyncState(root, {
        schema: "workbench.remote-sync-state.v1",
        remote: remote.name,
        url: remote.url,
        status: "synced",
        localHash: remoteSyncLocalHash(state, remote),
        lastSyncedAt: now(),
        lastAttemptAt: attemptAt,
        lastError: null,
        pushed,
        pulled,
      });
      return result;
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }
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
    const current = await reconcileWorkbenchVersion(root, state, SOURCE_SNAPSHOT_MESSAGE);
    const version = options.version ? resolveVersion(state, options.version) : current;
    const remote = resolveRemote(state, options.remote);
    assertPublishableRemote(remote);
    await saveState(root, state);
    const localVisibility = options.visibility ?? publicationVisibilityFromRefs(state.refs, remote.name) ?? "private";
    const localInstallHandle = workbenchRemoteInstallHandle(remote);
    const localPublication = publicationStatusFromRefs(state.refs, remote.name);
    if (
      options.dryRun !== true &&
      localPublication.status === "published" &&
      localPublication.currentVersionId === version.id &&
      (localPublication.visibility ?? "private") === localVisibility &&
      localPublication.installHandle === localInstallHandle
    ) {
      return {
        remote,
        version,
        visibility: localVisibility,
        installHandle: localInstallHandle,
        unchanged: true,
      };
    }
    const sync = await syncWorkbenchRemote({ dir: root, remote: remote.name, authToken: options.authToken, dryRun: options.dryRun });
    const syncedState = await loadState(root);
    const visibility = options.visibility ?? publicationVisibilityFromRefs(syncedState.refs, sync.remote.name) ?? "private";
    if (options.dryRun === true) {
      return {
        remote: sync.remote,
        version,
        visibility,
        installHandle: workbenchRemoteInstallHandle(sync.remote),
        dryRun: true,
      };
    }
    const installHandle = workbenchRemoteInstallHandle(sync.remote);
    const currentPublication = publicationStatusFromRefs(syncedState.refs, sync.remote.name);
    if (
      currentPublication.status === "published" &&
      currentPublication.currentVersionId === version.id &&
      (currentPublication.visibility ?? "private") === visibility &&
      currentPublication.installHandle === installHandle
    ) {
      return {
        remote: sync.remote,
        version,
        visibility,
        installHandle,
        unchanged: true,
      };
    }
    const publication = await writeRemotePublishedSource(sync.remote, version, {
      authToken: options.authToken,
      state: syncedState,
      visibility,
    });
    const publishedRefs = publicationRefsForVersion(
      version.id,
      publication,
      visibility,
    );
    Object.assign(syncedState.refs, publishedRefs);
    syncedState.refs = withMergedRemoteTrackingRefs(syncedState.refs, sync.remote.name, publishedRefs);
    await saveState(root, syncedState);
    const syncedAt = now();
    await writeRemoteSyncState(root, {
      schema: "workbench.remote-sync-state.v1",
      remote: sync.remote.name,
      url: sync.remote.url,
      status: "synced",
      localHash: remoteSyncLocalHash(syncedState, sync.remote),
      lastSyncedAt: syncedAt,
      lastAttemptAt: syncedAt,
      lastError: null,
      pushed: sync.pushed,
      pulled: sync.pulled,
    });
    return {
      remote: sync.remote,
      version,
      visibility,
      installHandle: publication.installHandle,
    };
  });
}

export async function unpublishWorkbenchVersion(options: WorkbenchUnpublishOptions): Promise<WorkbenchUnpublishResult> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const version = resolveVersion(state, options.version);
    const remote = resolveRemote(state, options.remote);
    assertPublishableRemote(remote);
    if (options.dryRun !== true) {
      await saveState(root, state);
    }
    const sync = await syncWorkbenchRemote({
      dir: root,
      remote: remote.name,
      authToken: options.authToken,
      dryRun: options.dryRun === true,
    });
    const syncedState = options.dryRun === true ? state : await loadState(root);
    const publication = options.dryRun === true && sync.publication
      ? sync.publication
      : publicationStatusFromRefs(syncedState.refs, sync.remote.name);
    if (publication.status !== "published" || !publication.publishedVersionIds?.includes(version.id)) {
      throw new WorkbenchCodedError("published_version_not_found", `Published version not found: ${version.id}.`, {
        remediation: "workbench publish VERSION",
        subject: { versionId: version.id },
        exitCode: 1,
      });
    }
    if (publication.currentVersionId === version.id) {
      const replacementVersionId = unpublishReplacementVersionId(publication, version.id, syncedState.versions);
      throw new WorkbenchCodedError("published_version_current", `Version ${version.id} is the current published version and cannot be unpublished directly.`, {
        remediation: replacementVersionId ? `workbench publish ${replacementVersionId}` : "workbench versions",
        subject: {
          versionId: version.id,
          currentVersionId: publication.currentVersionId,
          ...(replacementVersionId ? { replacementVersionId } : {}),
          publishedVersionIds: publication.publishedVersionIds ?? [],
          ...(publication.installHandle ? { installHandle: publication.installHandle } : {}),
        },
        exitCode: 1,
      });
    }
    if (options.dryRun === true) {
      return {
        remote: sync.remote,
        version,
        visibility: normalizePublishVisibilityRef(publication.visibility),
        installHandle: publication.installHandle,
        currentVersionId: publication.currentVersionId,
        publishedVersionIds: publication.publishedVersionIds ?? [],
        dryRun: true,
      };
    }
    const remotePublication = await deleteRemotePublishedVersion(sync.remote, version.id, {
      authToken: options.authToken,
      state: syncedState,
    });
    removePublishedVersionRef(syncedState.refs, version.id);
    syncedState.refs = withMergedRemoteTrackingRefs(syncedState.refs, sync.remote.name, {
      ...publicationRefsForVersion(
        remotePublication.currentVersionId,
        remotePublication.installHandle ? { installHandle: remotePublication.installHandle } : undefined,
        remotePublication.visibility,
      ),
      ...Object.fromEntries(remotePublication.publishedVersionIds.map((id) => [`publication/versions/${id}`, id])),
    });
    removeRemotePublishedVersionRef(syncedState.refs, sync.remote.name, version.id);
    await saveState(root, syncedState);
    return {
      remote: sync.remote,
      version,
      visibility: remotePublication.visibility,
      installHandle: remotePublication.installHandle,
      currentVersionId: remotePublication.currentVersionId,
      publishedVersionIds: remotePublication.publishedVersionIds,
    };
  });
}

function unpublishReplacementVersionId(
  publication: { publishedVersionIds?: readonly string[] },
  currentVersionId: string,
  versions: readonly WorkbenchVersion[],
): string | undefined {
  const replacementIds = new Set(
    (publication.publishedVersionIds ?? []).filter((versionId) => versionId !== currentVersionId),
  );
  if (replacementIds.size === 0) {
    return undefined;
  }
  const latestKnownVersion = versions
    .filter((version) => replacementIds.has(version.id))
    .sort(compareVersionIds)
    .at(-1);
  return latestKnownVersion?.id ?? [...replacementIds].sort().at(-1);
}

function assertPublishableRemote(remote: WorkbenchRemote): void {
  if (remote.kind === "workbench-cloud") {
    return;
  }
  throw new WorkbenchCodedError("publish_failed", `Remote ${remote.name} is a file remote; only Workbench Cloud remotes can publish installable source.`, {
    remediation: "workbench login && workbench publish",
    subject: { remote: remote.name, kind: remote.kind, url: remote.url },
    exitCode: 1,
  });
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
    .filter((run) => runQualityScoreFromJobs(run, state.jobs) !== undefined)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const lastRunScore = lastRun ? runQualityScoreFromJobs(lastRun, state.jobs) : undefined;
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
    ...(lastRunScore !== undefined ? { lastScore: lastRunScore } : {}),
  };
  return {
    root,
    status,
    versions: state.versions.map(copyVersion),
    skillSources,
    skillBundles: state.skillBundles.map(copySkillBundle),
    evals: state.evals.map(copyEval),
    agents,
    ...(currentVersion ? {
      results: resultsFromInternalComparison(buildInternalComparisonFromState(state, {
        versions: "all",
        skills: "all",
        agents: "all",
      }), state),
    } : {}),
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
  const configured = authoredWorkbenchDefaultFromState(state, VERSIONS_FILE);
  if (configured === ALL_SELECTOR) {
    return configured;
  }
  if (configured && state.skillSources.some((source) => source.name === configured)) {
    return configured;
  }
  if (state.skillSources.some((source) => source.name === CURRENT_SKILL_VERSION_NAME)) {
    return CURRENT_SKILL_VERSION_NAME;
  }
  return state.skillSources[0]?.name ?? state.skillBundles[0]?.skillName;
}

function authoredWorkbenchDefaultFromState(
  state: WorkbenchProjectState,
  fileName: typeof AGENTS_FILE | typeof VERSIONS_FILE,
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
  const loadedState = await loadStateReadOnlyWithRetry(root);
  const stateWithHostedHandles = await applyLocalHostedRunHandles(root, loadedState);
  const state = await applyLocalRunCancellationRequests(root, stateWithHostedHandles);
  const [authoredAgents, skillSources, syncCount, sourceHash] = await Promise.all([
    readAgents(root).catch(() => []),
    readSkillSources(root).catch(() => state.skillSources),
    pendingSyncCount(root).catch(() => undefined),
    readSkillFiles(root).then(hashFiles).catch(() => undefined),
  ]);
  const sourceVersionId = sourceHash
    ? findWorkbenchVersionBySourceHash(state.versions, sourceHash)?.id
    : undefined;
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
    currentVersionId: sourceVersionId ?? currentWorkbenchVersionIdFromState(state),
    defaultSkill,
    defaultAgent,
    pendingSyncCount: syncCount,
    ...workbenchPublicationForSnapshot(
      state,
      Object.values(state.remotes).sort((left, right) => left.name.localeCompare(right.name)),
    ),
  });
}

export async function readWorkbenchReadOnlyInspectionCursor(
  options: WorkbenchCommandOptions = {},
): Promise<string> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  return readLocalWorkbenchLiveStateCursor(root);
}

export async function waitForWorkbenchReadOnlyInspectionNotice(
  options: WorkbenchCommandOptions & {
    cursor?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<WorkbenchStateNotice> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  return waitForLocalWorkbenchLiveStateNotice({
    root,
    cursor: options.cursor,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
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
  const versionId = publishedVersionIdFromRefs(state.refs);
  if (!versionId) {
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
        currentVersionId: versionId,
        publishedVersionIds: publishedVersionIdsFromRefs(state.refs),
        installHandle: `${parsed.owner}/${parsed.name}`,
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
    evals: state.evals.map(copyEval),
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

function objectPackWithCloudLifecycleOwner(pack: WorkbenchObjectPack, remoteName: string): WorkbenchObjectPack {
  return {
    ...pack,
    runs: pack.runs.map((run) => runWithCloudLifecycleOwner(run, remoteName)),
  };
}

function runWithCloudLifecycleOwner(run: WorkbenchRun, remoteName: string): WorkbenchRun {
  const copied = copyRun(run);
  const location = copied.operationPlan?.variant ?? copied.location ?? "cloud";
  if (location === "cloud") {
    return {
      ...copied,
      location: "cloud",
      remoteName: copied.remoteName ?? remoteName,
    };
  }
  const { remoteName: _remoteName, ...withoutRemoteName } = copied;
  return {
    ...withoutRemoteName,
    location: "local",
  };
}

function refsForRemoteSync(refs: WorkbenchRefs): WorkbenchRefs {
  return Object.fromEntries(Object.entries(refs)
    .filter(([name]) =>
      !name.startsWith("remotes/") &&
      name !== "current" &&
      !isPublicationRef(name)
    ));
}

function isCanonicalPublicationRef(name: string): boolean {
  return name.startsWith("publication/");
}

// Pre-publication/* publish refs remain publication metadata so sync cannot resurrect them.
function isLegacyPublicationRef(name: string): boolean {
  return name === "published" || name.startsWith("releases/");
}

function isPublicationRef(name: string): boolean {
  return isCanonicalPublicationRef(name) || isLegacyPublicationRef(name);
}

function publicationRefs(refs: WorkbenchRefs): WorkbenchRefs {
  return Object.fromEntries(Object.entries(refs)
    .filter(([name]) => isCanonicalPublicationRef(name)));
}

function remoteTrackingRefsForCloudSync(mergedRefs: WorkbenchRefs, remoteRefs: WorkbenchRefs): WorkbenchRefs {
  return {
    ...mergedRefs,
    ...(remoteRefs.current ? { current: remoteRefs.current } : {}),
  };
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
  publication?: { installHandle: string },
  visibility?: WorkbenchPublishVisibility,
): WorkbenchRefs {
  return {
    "publication/current-version": versionId,
    [`publication/versions/${versionId}`]: versionId,
    ...(publication?.installHandle ? { "publication/install-handle": publication.installHandle } : {}),
    ...(visibility ? { "publication/visibility": visibility } : {}),
  };
}

function publicationFromRefs(
  refs: WorkbenchRefs,
  versionId: string,
): WorkbenchInspectionSnapshot["publication"] | undefined {
  const installHandle = refs["publication/install-handle"];
  if (!installHandle) {
    return undefined;
  }
  return {
    currentVersionId: versionId,
    publishedVersionIds: publishedVersionIdsFromRefs(refs),
    installHandle,
    ...(refs["publication/visibility"] ? { visibility: refs["publication/visibility"] } : {}),
  };
}

function publishedVersionIdFromRefs(refs: WorkbenchRefs): string | undefined {
  const versionId = refs["publication/current-version"];
  return versionId && refs[`publication/versions/${versionId}`] === versionId ? versionId : undefined;
}

function publishedVersionIdsFromRefs(refs: WorkbenchRefs): string[] {
  return publishedVersionIdsFromRefsWithPrefix(refs, "");
}

function publicationStatusFromRefs(
  refs: WorkbenchRefs,
  remoteName?: string,
): WorkbenchStatusSnapshot["remotes"][number]["publication"] {
  const prefix = remoteName ? `remotes/${safeObjectFileName(remoteName)}/` : "";
  const versionId = publishedVersionIdFromRefsWithPrefix(refs, prefix);
  if (!versionId) {
    return { status: "unpublished" };
  }
  return {
    status: "published",
    currentVersionId: versionId,
    publishedVersionIds: publishedVersionIdsFromRefsWithPrefix(refs, prefix),
    ...(refs[`${prefix}publication/visibility`] ? { visibility: refs[`${prefix}publication/visibility`] } : {}),
    ...(refs[`${prefix}publication/install-handle`] ? { installHandle: refs[`${prefix}publication/install-handle`] } : {}),
  };
}

function publishedVersionIdFromRefsWithPrefix(refs: WorkbenchRefs, prefix: string): string | undefined {
  const versionId = refs[`${prefix}publication/current-version`];
  return versionId && refs[`${prefix}publication/versions/${versionId}`] === versionId ? versionId : undefined;
}

function publishedVersionIdsFromRefsWithPrefix(refs: WorkbenchRefs, prefix: string): string[] {
  return Object.entries(refs)
    .flatMap(([name, value]) =>
      typeof value === "string" && name.startsWith(`${prefix}publication/versions/`) && name === `${prefix}publication/versions/${value}`
        ? [value]
        : []
    )
    .sort();
}

function removePublishedVersionRef(refs: WorkbenchRefs, versionId: string): void {
  delete refs[`publication/versions/${versionId}`];
}

function removeRemotePublishedVersionRef(refs: WorkbenchRefs, remoteName: string, versionId: string): void {
  delete refs[`remotes/${safeObjectFileName(remoteName)}/publication/versions/${versionId}`];
}

function publicationVisibilityFromRefs(
  refs: WorkbenchRefs,
  remoteName?: string,
): WorkbenchPublishVisibility | undefined {
  const prefix = remoteName ? `remotes/${safeObjectFileName(remoteName)}/` : "";
  return normalizePublishVisibilityRef(refs["publication/visibility"]) ??
    (remoteName ? normalizePublishVisibilityRef(refs[`${prefix}publication/visibility`]) : undefined);
}

function normalizePublishVisibilityRef(value: string | undefined): WorkbenchPublishVisibility | undefined {
  return value === "private" || value === "internal" || value === "public" ? value : undefined;
}

function unpublishedPublicationStatus(): WorkbenchStatusSnapshot["remotes"][number]["publication"] {
  return { status: "unpublished" };
}

function withPublicationRefsFromRemote(
  refs: WorkbenchRefs,
  remoteRefs: WorkbenchRefs,
): WorkbenchRefs {
  const nonPublicationRefs = Object.fromEntries(Object.entries(refs)
    .filter(([name]) => !isPublicationRef(name)));
  const localVisibility = normalizePublishVisibilityRef(refs["publication/visibility"]);
  return {
    ...nonPublicationRefs,
    ...publicationRefs(remoteRefs),
    ...(localVisibility ? { "publication/visibility": localVisibility } : {}),
  };
}

interface ImportObjectPackOptions {
  refs?: "merge" | "none";
  lifecycleObjects?: "merge" | "replace";
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
  const replaceLifecycleObjects = options.lifecycleObjects === "replace";
  for (const run of pack.runs) {
    upsertRunObject(state.runs, copyRun(run), { replace: replaceLifecycleObjects });
  }
  for (const job of pack.jobs) {
    upsertJobObject(state.jobs, copyJob(job), { replace: replaceLifecycleObjects });
  }
  for (const trace of pack.traces) {
    if (replaceLifecycleObjects) {
      upsertById(state.traces, copyTrace(trace));
    } else {
      upsertImmutableById(state.traces, copyTrace(trace), "trace");
    }
  }
  for (const batch of pack.executionEvents) {
    upsertExecutionEventBatch(state.executionEvents, copyExecutionEventBatch(batch), { replace: replaceLifecycleObjects });
  }
  for (const artifact of pack.artifacts) {
    if (replaceLifecycleObjects) {
      upsertById(state.artifacts, copyArtifact(artifact));
    } else {
      upsertImmutableById(state.artifacts, copyArtifact(artifact), "artifact");
    }
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

function objectPackSyncHash(pack: WorkbenchObjectPack): string {
  const { createdAt: _createdAt, ...stablePack } = pack;
  return hashJson({
    ...stablePack,
    versions: stableSortByIdentity(stablePack.versions, (entry) => entry.id),
    skillSources: stableSortByIdentity(stablePack.skillSources, (entry) => entry.name),
    skillBundles: stableSortByIdentity(stablePack.skillBundles, (entry) => entry.hash),
    evals: stableSortByIdentity(stablePack.evals, (entry) => entry.hash),
    agents: stableSortByIdentity(stablePack.agents, (entry) => hashJson(entry)),
    runs: stableSortByIdentity(stablePack.runs, (entry) => entry.id),
    jobs: stableSortByIdentity(stablePack.jobs, (entry) => entry.id),
    traces: stableSortByIdentity(stablePack.traces, (entry) => entry.id),
    executionEvents: stableSortByIdentity(stablePack.executionEvents, workbenchExecutionEventBatchId),
    artifacts: stableSortByIdentity(stablePack.artifacts, (entry) => entry.id),
    lineage: stableSortByIdentity(stablePack.lineage, (entry) => hashJson(entry)),
  });
}

function stableSortByIdentity<T>(entries: readonly T[], identity: (entry: T) => string): T[] {
  return [...entries].sort((left, right) => identity(left).localeCompare(identity(right)));
}

function remoteSyncLocalHash(state: WorkbenchProjectState, remote?: WorkbenchRemote): string {
  return objectPackSyncHash(exportObjectPackForRemoteSyncStatus(state, remote));
}

function exportObjectPackForRemoteSyncStatus(
  state: WorkbenchProjectState,
  remote: WorkbenchRemote | undefined,
): WorkbenchObjectPack {
  const pack = exportObjectPackForRemote(state);
  if (!remote || remote.kind !== "workbench-cloud") {
    return pack;
  }
  return objectPackWithoutCloudOwnedLifecycleObjects(pack, remote.name);
}

function objectPackWithoutCloudOwnedLifecycleObjects(
  pack: WorkbenchObjectPack,
  remoteName: string,
): WorkbenchObjectPack {
  const remoteOwnedRunIds = new Set(pack.runs
    .filter((run) => run.location === "cloud" && run.remoteName === remoteName)
    .map((run) => run.id));
  if (remoteOwnedRunIds.size === 0) {
    return pack;
  }
  return {
    ...pack,
    runs: pack.runs.filter((run) => !remoteOwnedRunIds.has(run.id)),
    jobs: pack.jobs.filter((job) => !remoteOwnedRunIds.has(job.runId)),
    traces: pack.traces.filter((trace) => !remoteOwnedRunIds.has(trace.runId)),
    executionEvents: pack.executionEvents.filter((batch) => !remoteOwnedRunIds.has(batch.runId)),
    artifacts: pack.artifacts.filter((artifact) => !remoteOwnedRunIds.has(artifact.runId)),
  };
}

function objectPackDeltaForRemoteWrite(
  merged: WorkbenchObjectPack,
  remote: WorkbenchObjectPack,
  options: { remoteOwnsLifecycleObjects?: boolean } = {},
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
    runs: merged.runs.filter((entry) => options.remoteOwnsLifecycleObjects
      ? !remoteRuns.has(entry.id)
      : !sameJsonObject(remoteRuns.get(entry.id), entry)),
    jobs: merged.jobs.filter((entry) => options.remoteOwnsLifecycleObjects
      ? !remoteJobs.has(entry.id)
      : !sameJsonObject(remoteJobs.get(entry.id), entry)),
    traces: merged.traces.filter((entry) => options.remoteOwnsLifecycleObjects
      ? !remoteTraces.has(entry.id)
      : !sameJsonObject(remoteTraces.get(entry.id), entry)),
    executionEvents: options.remoteOwnsLifecycleObjects
      ? []
      : merged.executionEvents.filter((entry) =>
        !sameJsonObject(remoteExecutionEvents.get(workbenchExecutionEventBatchId(entry)), entry)
      ),
    artifacts: merged.artifacts.filter((entry) => options.remoteOwnsLifecycleObjects
      ? !remoteArtifacts.has(entry.id)
      : !sameJsonObject(remoteArtifacts.get(entry.id), entry)),
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
      await advanceLocalWorkbenchLiveState(args.root).catch(() => undefined);
    },
  };
}

interface WorkbenchEvaluationRunTarget {
  skillBundle: WorkbenchSkillBundleSnapshot;
  agent: WorkbenchAgent;
}

interface PlannedWorkbenchEvaluationJob {
  input: WorkbenchExecutionRuntimeInput;
  runtimeCase: WorkbenchEvalCaseRuntime;
  sample: number;
  artifactId: string;
  traceId: string;
  skillBundle: WorkbenchSkillBundleSnapshot;
  agent: WorkbenchAgent;
}

interface CompletedWorkbenchEvaluationJob {
  remoteJob: RemoteWorkbenchJob;
  plannedJob: PlannedWorkbenchEvaluationJob;
  objects: ReturnType<typeof skillEvalObjectsFromRemoteJob>;
}

async function executeWorkbenchEvaluationRun(args: {
  root: string;
  state: WorkbenchProjectState;
  adapterAuthStoreRoot?: string;
  version: WorkbenchVersion;
  skillBundle: WorkbenchSkillBundleSnapshot;
  evalSnapshot: WorkbenchEvalSnapshot;
  agent: WorkbenchAgent;
  targets?: readonly WorkbenchEvaluationRunTarget[];
  kind: WorkbenchRunKind;
  samples: number;
  cases?: readonly WorkbenchEvalCaseRuntime[];
  environmentDockerfile?: string;
  parentRunId?: string;
  location?: WorkbenchRun["location"];
  remoteName?: string;
  retryOfRunId?: string;
  baseVersionId?: string;
  requestedBudget?: number;
  rerun?: boolean;
  caseIds?: readonly string[];
  selectedSamples?: readonly WorkbenchCaseSampleSelection[];
  request?: Record<string, Json>;
  result?: Record<string, Json>;
  run?: WorkbenchRun;
  onRunStarted?: (run: WorkbenchRun) => void | Promise<void>;
}): Promise<WorkbenchRun> {
  const targets = args.targets ?? [{ skillBundle: args.skillBundle, agent: args.agent }];
  const primaryTarget = targets[0];
  if (!primaryTarget) {
    throw new WorkbenchUserError("No eval targets resolved for this run.");
  }
  const samples = Math.max(1, Math.floor(args.samples));
  const cases = selectEvalCasesForRun(
    args.cases ?? await readEvalCases(args.root),
    args.caseIds,
    args.selectedSamples,
  );
  if (cases.length === 0) {
    throw noEvalCasesError();
  }
  const createdAt = now();
  const run: WorkbenchRun = {
    ...(args.run ? copyRun(args.run) : {
      id: nextRunId(),
      createdAt,
      traceIds: [],
    }),
    kind: args.kind,
    versionId: args.version.id,
    skillName: primaryTarget.skillBundle.skillName,
    skillBundleHash: primaryTarget.skillBundle.hash,
    evalHash: args.evalSnapshot.hash,
    agentName: primaryTarget.agent.name,
    agentHash: hashJson(primaryTarget.agent),
    status: "running",
    jobIds: [],
    traceIds: [...(args.run?.traceIds ?? [])],
    ...(args.parentRunId ? { parentRunId: args.parentRunId } : {}),
    location: args.location ?? args.run?.location ?? "local",
    ...(args.remoteName ? { remoteName: args.remoteName } : {}),
    ...(args.baseVersionId ? { baseVersionId: args.baseVersionId } : {}),
    ...(args.retryOfRunId ? { retryOfRunId: args.retryOfRunId } : {}),
    requestedSamples: samples,
    ...(args.requestedBudget !== undefined ? { requestedBudget: args.requestedBudget } : {}),
    operationPlan: args.run?.operationPlan
      ? copyOperationPlanSummary(args.run.operationPlan)
      : operationPlanSummaryForRun({
          kind: args.kind,
          variant: args.location ?? args.run?.location ?? "local",
          versionId: args.kind === "improve" ? args.baseVersionId ?? args.version.id : args.version.id,
          evalHash: args.evalSnapshot.hash,
          skillNames: targets.map((target) => target.skillBundle.skillName),
          agentNames: targets.map((target) => target.agent.name),
          caseIds: cases.map((runtimeCase) => runtimeCase.id),
          samples,
          rerun: args.kind === "eval" && args.rerun === true,
          budget: args.kind === "improve" ? args.requestedBudget : undefined,
          retryOfRunId: args.retryOfRunId,
        }),
    lastProgressAt: createdAt,
  };
  delete run.finishedAt;
  delete run.error;
  delete run.latencyMs;
  delete run.costUsd;
  const environmentDockerfile = args.environmentDockerfile ?? await readSkillEvalEnvironmentDockerfile(args.root);
  const planned: PlannedWorkbenchEvaluationJob[] = [];
  for (const target of targets) {
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
            skillName: target.skillBundle.skillName,
            skillBundleHash: target.skillBundle.hash,
            evalHash: args.evalSnapshot.hash,
            evalSnapshot: args.evalSnapshot,
            agent: target.agent,
            versionFiles: target.skillBundle.files,
            runtimeCase,
            sample,
            createdAt,
            environmentDockerfile,
          }),
          runtimeCase,
          sample,
          artifactId: nextArtifactId(),
          traceId: `trace_${jobId}`,
          skillBundle: target.skillBundle,
          agent: target.agent,
        });
      }
    }
  }
  const reusableCompletedExecutionJobs: CompletedWorkbenchEvaluationJob[] = [];
  const plannedForExecution: PlannedWorkbenchEvaluationJob[] = [];
  for (const plannedJob of planned) {
    const reusableSubject = args.kind === "eval" && args.rerun !== true
      ? reusableExecutionSubjectForPlannedJob({
          state: args.state,
          version: args.version,
          evalSnapshot: args.evalSnapshot,
          plannedJob,
        })
      : undefined;
    if (reusableSubject) {
      reusableCompletedExecutionJobs.push(completedEvaluationJobFromGradeSubject({
        root: args.root,
        state: args.state,
        run,
        version: args.version,
        evalSnapshot: args.evalSnapshot,
        environmentDockerfile,
        subject: reusableSubject,
      }));
      continue;
    }
    plannedForExecution.push(plannedJob);
  }
  const inputsByJobId = new Map(plannedForExecution.map((entry) => [entry.input.job.id, entry]));
  run.jobIds = Array.from(new Set([
    ...(args.run?.jobIds ?? []),
    ...reusableCompletedExecutionJobs.map((entry) => entry.objects.job.id),
    ...plannedForExecution.map((entry) => entry.input.job.id),
  ]));
  run.traceIds = Array.from(new Set([
    ...run.traceIds,
    ...reusableCompletedExecutionJobs.flatMap((entry) => entry.objects.job.traceIds),
  ]));
  upsertRunObject(args.state.runs, run, args.run ? { replace: true } : {});
  for (const plannedJob of plannedForExecution) {
    upsertJobObject(args.state.jobs, skillEvalLifecycleJobFromRemoteJob({
      remoteJob: plannedJob.input.job,
      run,
      version: args.version,
      skillBundle: plannedJob.skillBundle,
      evalSnapshot: args.evalSnapshot,
      agent: plannedJob.agent,
      runtimeCase: plannedJob.runtimeCase,
      sample: plannedJob.sample,
    }));
  }
  await saveState(args.root, args.state);
  await args.onRunStarted?.(copyRun(run));
  let stateSaveQueue = Promise.resolve();
  const enqueueRunStateSave = async (): Promise<void> => {
    const next = stateSaveQueue.then(async () => {
      await saveState(args.root, args.state);
    });
    stateSaveQueue = next.catch(() => undefined);
    await next;
  };
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
      skillBundle: plannedJob.skillBundle,
      evalSnapshot: args.evalSnapshot,
      agent: plannedJob.agent,
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
    await enqueueRunStateSave();
  };
  let dagJobs: RemoteWorkbenchJob[] = [];
  if (plannedForExecution.length > 0) {
    try {
      const dag = await runWorkbenchExecutionDag({
        jobs: plannedForExecution.map((entry) => entry.input.job),
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
            skillBundle: plannedJob.skillBundle,
            evalSnapshot: args.evalSnapshot,
            agent: plannedJob.agent,
            runtimeCase: plannedJob.runtimeCase,
            sample: plannedJob.sample,
          }));
          run.lastProgressAt = job.startedAt ?? now();
          upsertRunObject(args.state.runs, run, args.run ? { replace: true } : {});
          await enqueueRunStateSave();
        },
        onJobFinished: persistTerminalJob,
        shouldCancelJob: async () => await hasLocalRunCancellationRequest(args.root, run.id),
        executeJob: async (job, control) => {
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
            loadLocalAdapterAuthProfiles: isProviderBackedSkillEvalAgent(plannedJob.agent),
            adapterAuthStoreRoot: args.adapterAuthStoreRoot,
            signal: control.signal,
          });
        },
      });
      dagJobs = dag.jobs;
    } catch (error) {
      const finishedAt = now();
      run.finishedAt = finishedAt;
      run.status = "failed";
      run.error = error instanceof Error ? error.message : String(error);
      upsertRunObject(args.state.runs, run, args.run ? { replace: true } : {});
      await saveState(args.root, args.state);
      return run;
    }
  }
  const jobs: WorkbenchJob[] = [];
  const completedExecutionJobs: CompletedWorkbenchEvaluationJob[] = [...reusableCompletedExecutionJobs];
  for (const reused of reusableCompletedExecutionJobs) {
    jobs.push(reused.objects.job);
    run.jobIds = Array.from(new Set([...(run.jobIds ?? []), reused.objects.job.id]));
    run.traceIds = Array.from(new Set([...run.traceIds, ...reused.objects.job.traceIds]));
  }
  for (const completed of dagJobs) {
    const plannedJob = inputsByJobId.get(completed.id);
    if (!plannedJob) {
      continue;
    }
    const result = persistedTerminalJobs.get(completed.id) ?? skillEvalObjectsFromRemoteJob({
      remoteJob: completed,
      run,
      version: args.version,
      skillBundle: plannedJob.skillBundle,
      evalSnapshot: args.evalSnapshot,
      agent: plannedJob.agent,
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
    run.lastProgressAt = result.job.finishedAt ?? result.job.startedAt ?? now();
    upsertJobObject(args.state.jobs, result.job);
    upsertImmutableById(args.state.artifacts, result.artifact, "artifact");
    upsertImmutableById(args.state.traces, result.trace, "trace");
    completedExecutionJobs.push({ remoteJob: completed, plannedJob, objects: result });
  }
  if (shouldRunGradersForEvaluationRun(args.kind)) {
    for (const completed of completedExecutionJobs) {
      if (completed.objects.job.status !== "succeeded") {
        continue;
      }
      const reusableGradeJob = args.kind === "eval" && args.rerun !== true
        ? latestReusableTerminalGradeJobForExecution({
            state: args.state,
            evalHash: args.evalSnapshot.hash,
            executionJob: completed.objects.job,
          })
        : undefined;
      if (reusableGradeJob) {
        jobs.push(reusableGradeJob);
        run.jobIds = Array.from(new Set([...(run.jobIds ?? []), reusableGradeJob.id]));
        run.traceIds = Array.from(new Set([...run.traceIds, ...reusableGradeJob.traceIds]));
        run.lastProgressAt = reusableGradeJob.finishedAt ?? reusableGradeJob.startedAt ?? now();
        upsertRunObject(args.state.runs, run, args.run ? { replace: true } : {});
        await enqueueRunStateSave();
        continue;
      }
      const result = await executeSkillEvalGradeJob({
        root: args.root,
        state: args.state,
        adapterAuthStoreRoot: args.adapterAuthStoreRoot,
        run,
        version: args.version,
        evalSnapshot: args.evalSnapshot,
        completed,
      });
      jobs.push(result.job);
      run.jobIds = Array.from(new Set([...(run.jobIds ?? []), result.job.id]));
      run.traceIds = Array.from(new Set([...run.traceIds, result.trace.id]));
      run.lastProgressAt = result.job.finishedAt ?? result.job.startedAt ?? now();
      upsertJobObject(args.state.jobs, result.job);
      upsertImmutableById(args.state.artifacts, result.artifact, "artifact");
      upsertImmutableById(args.state.traces, result.trace, "trace");
      await enqueueRunStateSave();
    }
  }
  const finishedAt = now();
  run.finishedAt = finishedAt;
  run.lastProgressAt = finishedAt;
  run.status = jobs.every((job) => job.status === "succeeded")
    ? "succeeded"
    : jobs.some((job) => job.status === "canceled")
      ? "canceled"
      : "failed";
  const allRunJobs = args.run
    ? args.state.jobs.filter((job) => job.runId === run.id && (run.jobIds ?? []).includes(job.id))
    : jobs;
  run.latencyMs = allRunJobs.reduce((sum, job) => sum + (job.durationMs ?? 0), 0);
  const costUsd = readWorkbenchSkillTraceResultsCostUsd(
    args.state.traces
      .filter((trace) => trace.runId === run.id)
      .map((trace) => trace.result),
  );
  if (costUsd !== undefined) {
    run.costUsd = costUsd;
  }
  const errors = allRunJobs.flatMap((job) => job.error ? [job.error] : []);
  if (errors.length > 0) {
    run.error = summarizeJobErrors(errors);
  }
  upsertRunObject(args.state.runs, run, args.run ? { replace: true } : {});
  return run;
}

function shouldRunGradersForEvaluationRun(kind: WorkbenchRunKind): boolean {
  return kind !== "run";
}

async function executeSkillEvalGradeJob(args: {
  root: string;
  state: WorkbenchProjectState;
  adapterAuthStoreRoot?: string;
  run: WorkbenchRun;
  version: WorkbenchVersion;
  evalSnapshot: WorkbenchEvalSnapshot;
  completed: CompletedWorkbenchEvaluationJob;
}): Promise<ReturnType<typeof skillEvalObjectsFromRemoteJob>> {
  const createdAt = now();
  const gradeJobId = nextJobId();
  const executionJob = args.completed.objects.job;
  const executionTrace = args.completed.objects.trace;
  const executionArtifact = args.completed.objects.artifact;
  const gradeInput = createWorkbenchSkillEvalGradeRuntimeInput({
    ownerUserId: "local",
    projectId: "local",
    runId: args.run.id,
    jobId: gradeJobId,
    versionId: args.version.id,
    skillName: args.completed.plannedJob.skillBundle.skillName,
    skillBundleHash: args.completed.plannedJob.skillBundle.hash,
    evalHash: args.evalSnapshot.hash,
    evalSnapshot: args.evalSnapshot,
    agent: args.completed.plannedJob.agent,
    versionFiles: args.completed.plannedJob.skillBundle.files,
    runtimeCase: args.completed.plannedJob.runtimeCase,
    sample: args.completed.plannedJob.sample,
    createdAt,
    environmentDockerfile: args.completed.plannedJob.input.environmentDockerfile,
    subject: {
      job: executionJob,
      artifact: executionArtifact,
      trace: executionTrace,
    },
  });
  const completed = await executeWorkbenchExecutionJob({
    ...gradeInput,
    progress: localWorkbenchExecutionProgressTarget({
      root: args.root,
      state: args.state,
      projectId: gradeInput.job.projectId,
      runId: args.run.id,
      jobId: gradeJobId,
    }),
  }, {
    sandboxBackend: DOCKER_SANDBOX_BACKEND,
    loadLocalAdapterAuthProfiles: isProviderBackedSkillEvalAgent(args.completed.plannedJob.agent),
    adapterAuthStoreRoot: args.adapterAuthStoreRoot,
  });
  return skillEvalObjectsFromRemoteJob({
    remoteJob: completed,
    run: args.run,
    version: args.version,
    skillBundle: args.completed.plannedJob.skillBundle,
    evalSnapshot: args.evalSnapshot,
    agent: args.completed.plannedJob.agent,
    runtimeCase: args.completed.plannedJob.runtimeCase,
    sample: args.completed.plannedJob.sample,
    role: "grade",
    dependencies: [{
      name: "subject",
      jobId: executionJob.id,
      artifactId: executionArtifact.id,
      traceIds: [executionTrace.id],
      mount: "/workspace/input/subject",
      mode: "readonly",
    }],
    request: {
      subjectJobId: executionJob.id,
      subjectArtifactId: executionArtifact.id,
      subjectTraceIds: [executionTrace.id],
    },
  });
}

function prefixSurfaceFiles(prefix: string, files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  return files.map((file) => ({
    ...copyFile(file),
    path: normalizeRelativePath(`${prefix}/${file.path}`),
  }));
}

function normalizeSubjectOutputFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  return files.map((file) => {
    const normalizedPath = normalizeRelativePath(file.path);
    if (!normalizedPath.startsWith("output/")) {
      return copyFile(file);
    }
    return {
      ...copyFile(file),
      path: normalizedPath.slice("output/".length),
    };
  });
}

function summarizeJobErrors(errors: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const error of errors) {
    const summary = publicRuntimeErrorSummary(error);
    counts.set(summary, (counts.get(summary) ?? 0) + 1);
  }
  return [...counts.entries()]
    .slice(0, 5)
    .map(([error, count]) => count > 1 ? `${error} (${count} jobs)` : error)
    .join("\n");
}

function noEvalCasesError(): WorkbenchCodedError {
  const issue = noEvalCasesReadinessIssue();
  return new WorkbenchCodedError(issue.code, issue.message, {
    remediation: issue.remediation,
    subject: issue.subject as Record<string, Json>,
    exitCode: 2,
  });
}

function noEvalCasesReadinessIssue(): WorkbenchLaunchReadinessIssue {
  return {
    code: "no_eval_cases",
    message: "No eval cases found under .workbench/cases. Add at least one case.yaml before running eval.",
    remediation: WORKBENCH_AUTHOR_EVAL_CASE_COMMAND,
    subject: { directory: ".workbench/cases" },
  };
}

function assertDraftCaseReadinessReady(
  cases: readonly WorkbenchEvalCaseRuntime[],
  kind: WorkbenchRunKind,
): void {
  const issue = draftCaseReadinessIssues(cases, kind)[0];
  if (!issue) {
    return;
  }
  throw new WorkbenchCodedError(issue.code, issue.message, {
    ...(issue.remediation ? { remediation: issue.remediation } : {}),
    ...(issue.subject && typeof issue.subject === "object" && !Array.isArray(issue.subject)
      ? { subject: issue.subject as Record<string, Json> }
      : {}),
    exitCode: 1,
  });
}

function draftCaseReadinessIssues(
  cases: readonly WorkbenchEvalCaseRuntime[],
  kind: WorkbenchRunKind,
): WorkbenchLaunchReadinessIssue[] {
  const issues: WorkbenchLaunchReadinessIssue[] = [];
  const checksRubric = kind === "grade" || kind === "eval";
  for (const runtimeCase of cases) {
    const record = parseCaseRecord(runtimeCase.content, runtimeCase.path || runtimeCase.id);
    const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
    if (prompt === DRAFT_CASE_PROMPT_PLACEHOLDER) {
      issues.push(draftCaseReadinessIssue(runtimeCase, "prompt"));
      continue;
    }
    if (checksRubric && caseRubricContainsDraftPlaceholder(record)) {
      issues.push(draftCaseReadinessIssue(runtimeCase, "rubric"));
    }
  }
  return issues;
}

function caseRubricContainsDraftPlaceholder(record: Record<string, unknown>): boolean {
  const rubric = record.rubric;
  return Array.isArray(rubric) && rubric.some((entry) => {
    if (typeof entry === "string") {
      return entry.trim() === DRAFT_CASE_RUBRIC_PLACEHOLDER;
    }
    const criterion = asRecord(entry);
    if (!criterion) {
      return false;
    }
    return ["description", "prompt", "text"].some((key) =>
      typeof criterion[key] === "string" && criterion[key].trim() === DRAFT_CASE_RUBRIC_PLACEHOLDER
    );
  });
}

function draftCaseReadinessIssue(
  runtimeCase: WorkbenchEvalCaseRuntime,
  field: "prompt" | "rubric",
): WorkbenchLaunchReadinessIssue {
  const descriptorPath = evalCaseDescriptorProjectPath(runtimeCase);
  const command = `\${EDITOR:-vi} ${quoteShellArg(descriptorPath)}`;
  return {
    code: `draft_case_${field}`,
    message: `Eval case ${runtimeCase.id} still contains the draft ${field} placeholder. Edit ${descriptorPath} before using ${field === "prompt" ? "run" : "grade"} evidence.`,
    remediation: command,
    subject: { caseId: runtimeCase.id, path: descriptorPath, field },
  };
}

function evalCaseDescriptorProjectPath(runtimeCase: WorkbenchEvalCaseRuntime): string {
  const casePath = normalizeRelativePath(runtimeCase.path);
  if (isCaseDescriptorPath(casePath)) {
    return normalizeRelativePath(path.join(WORKBENCH_DIR, CASES_DIR, casePath));
  }
  return normalizeRelativePath(path.join(WORKBENCH_DIR, CASES_DIR, casePath, "case.yaml"));
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
    agentHash: hashJson(args.agent),
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
  role?: WorkbenchJob["role"];
  dependencies?: readonly WorkbenchJobDependency[];
  request?: Record<string, Json>;
  result?: Record<string, Json>;
}): { job: WorkbenchJob; artifact: WorkbenchArtifact; trace: WorkbenchTrace } {
  const finishedAt = args.remoteJob.finishedAt ?? now();
  const output = asRuntimeRecord(args.remoteJob.output);
  const remoteStatus: WorkbenchJob["status"] =
    args.remoteJob.status === "succeeded" ? "succeeded" :
      args.remoteJob.status === "cancelled" ? "canceled" : "failed";
  const status: WorkbenchJob["status"] = remoteStatus;
  const usage = readWorkbenchSkillRunOutputUsage(output);
  const outputResult = jsonRecord(output.result);
  const jobError = args.remoteJob.error;
  if (status !== "succeeded") {
    stripResultScores(outputResult);
  }
  const resultPayload = {
    ...outputResult,
    ...(usage ? { usage: usage as unknown as Json } : {}),
    ...(args.result ?? {}),
    status: status === "succeeded" ? "succeeded" : "failed",
    ...(jobError ? { error: jobError } : {}),
  } satisfies Record<string, Json>;
  if (status !== "succeeded") {
    stripResultScores(resultPayload);
  }
  const files = artifactFilesFromRemoteOutput(output);
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
    role: args.role ?? "execute",
    caseId: args.runtimeCase.id,
    sample: args.sample,
    smoke: args.runtimeCase.smoke === true,
    skillName: args.skillBundle.skillName,
    skillBundleHash: args.skillBundle.hash,
    agent: toJson(args.agent),
    execution: jsonRecord(args.remoteJob.input).execution ?? null,
    ...(args.request ?? {}),
  } satisfies Record<string, Json>;
  const execution = jsonRecord(args.remoteJob.input).execution;
  const executionAdapter = asRuntimeRecord(asRuntimeRecord(execution).adapter);
  const adapterUse = typeof executionAdapter.use === "string" ? executionAdapter.use : undefined;
  const jobResult = jobResultFromPayload(resultPayload, files, (args.role ?? "execute") === "grade");
  const trace: WorkbenchTrace = {
    id: args.traceId ?? `trace_${args.remoteJob.id}`,
    runId: args.run.id,
    jobId: args.remoteJob.id,
    versionId: args.version.id,
    skillName: args.skillBundle.skillName,
    skillBundleHash: args.skillBundle.hash,
    evalHash: args.evalSnapshot.hash,
    agentName: args.agent.name,
    agentHash: hashJson(args.agent),
    createdAt: finishedAt,
    request,
    result: resultPayload,
    files: [
      textFile("request.json", JSON.stringify(request, null, 2) + "\n"),
      textFile("result.json", JSON.stringify(resultPayload, null, 2) + "\n"),
      ...files.map(copyFile),
    ],
  };
  const job: WorkbenchJob = {
    id: args.remoteJob.id,
    runId: args.run.id,
    kind: args.run.kind,
    role: args.role ?? "execute",
    versionId: args.version.id,
    skillName: args.skillBundle.skillName,
    skillBundleHash: args.skillBundle.hash,
    evalHash: args.evalSnapshot.hash,
    agentName: args.agent.name,
    agentHash: hashJson(args.agent),
    caseId: args.runtimeCase.id,
    sample: args.sample,
    status,
    ...(adapterUse ? { adapter: { use: adapterUse, hash: hashJson(executionAdapter) } } : {}),
    ...(args.dependencies && args.dependencies.length > 0 ? { dependencies: args.dependencies.map(copyJobDependency) } : {}),
    ...(jobResult ? { result: jobResult } : {}),
    command: configString(asRuntimeRecord(asRuntimeRecord(jsonRecord(args.remoteJob.input).execution).adapter).with as Record<string, Json>, "command"),
    artifactIds: [artifact.id],
    traceIds: [trace.id],
    createdAt: args.remoteJob.createdAt,
    startedAt: args.remoteJob.startedAt,
    finishedAt,
    durationMs: durationMsBetween(args.remoteJob.startedAt, finishedAt),
    ...(jobError ? { error: jobError } : {}),
  };
  return { job, artifact, trace };
}

function copyJobDependency(dependency: WorkbenchJobDependency): WorkbenchJobDependency {
  return {
    ...dependency,
    ...(dependency.traceIds ? { traceIds: [...dependency.traceIds] } : {}),
  };
}

function artifactFilesFromRemoteOutput(output: Record<string, unknown>): SurfaceSnapshotFile[] {
  const outputFiles = Array.isArray(output.files)
    ? output.files.filter(isSurfaceSnapshotFile).map(copyFile)
    : [];
  const workspaceFiles = Array.isArray(output.workspaceFiles)
    ? output.workspaceFiles.filter(isSurfaceSnapshotFile).map(copyFile)
    : [];
  return dedupeRuntimeSurfaceFiles([
    ...outputFiles,
    ...prefixSurfaceFiles("workspace", workspaceFiles),
  ]);
}

function copyJobResult(result: WorkbenchJobResult): WorkbenchJobResult {
  return {
    ...result,
    ...(result.usage ? { usage: JSON.parse(JSON.stringify(result.usage)) as UsageSummary } : {}),
    ...(result.items ? { items: result.items.map((item) => ({ ...item, data: item.data, value: item.value })) } : {}),
    ...(result.payload !== undefined ? { payload: JSON.parse(JSON.stringify(result.payload)) as Json } : {}),
  };
}

function jobResultFromPayload(
  payload: Record<string, Json>,
  files: readonly SurfaceSnapshotFile[],
  includeScores: boolean,
): WorkbenchJobResult | undefined {
  const items = resultItemsFromPayload(payload, files, includeScores);
  const usage = normalizeUsageSummary(payload.usage);
  const summary = textFromJson(payload.summary);
  const error = textFromJson(payload.error);
  if (items.length === 0 && usage === undefined && !summary && !error && Object.keys(payload).length === 0) {
    return undefined;
  }
  return {
    ...(summary ? { summary } : {}),
    ...(error ? { error } : {}),
    ...(usage ? { usage } : {}),
    ...(items.length > 0 ? { items } : {}),
    payload: JSON.parse(JSON.stringify(payload)) as Json,
  };
}

export function createWorkbenchJobResultFromPayload(
  payload: Record<string, Json>,
  files: readonly SurfaceSnapshotFile[],
  options: { includeScores?: boolean } = {},
): WorkbenchJobResult | undefined {
  return jobResultFromPayload(payload, files, options.includeScores === true);
}

function resultItemsFromPayload(
  payload: Record<string, Json>,
  files: readonly SurfaceSnapshotFile[],
  includeScores: boolean,
): WorkbenchResultItem[] {
  const items: WorkbenchResultItem[] = [];
  if (includeScores) {
    const score = scoreFromWorkbenchResultPayload(payload);
    if (score !== undefined) {
      items.push({
        kind: "score",
        id: "score",
        label: "score",
        score,
        value: score as Json,
      });
    }
    const metrics = asRuntimeRecord(payload.metrics);
    for (const [name, value] of Object.entries(metrics).sort(([left], [right]) => left.localeCompare(right))) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        continue;
      }
      items.push({
        kind: "metric",
        id: name,
        label: name,
        value: value as Json,
        ...(name === "score" ? { score: value } : {}),
      });
    }
    const cases = Array.isArray(payload.cases) ? payload.cases : [];
    for (const caseEntry of cases) {
      const caseRecord = asRuntimeRecord(caseEntry);
      const caseId = textFromJson(caseRecord.id);
      const criteria = Array.isArray(caseRecord.criteria) ? caseRecord.criteria : [];
      for (const criterionEntry of criteria) {
        const criterion = asRuntimeRecord(criterionEntry);
        const id = textFromJson(criterion.criterion_id) ?? textFromJson(criterion.id) ?? "criterion";
        const criterionScore = typeof criterion.score === "number" && Number.isFinite(criterion.score)
          ? criterion.score
          : undefined;
        items.push({
          kind: "criterion",
          id: caseId ? `${caseId}:${id}` : id,
          label: textFromJson(criterion.label) ?? id,
          ...(criterionScore !== undefined ? { score: criterionScore } : {}),
          ...(typeof criterion.pass === "boolean" ? { pass: criterion.pass } : {}),
          ...(textFromJson(criterion.summary) ?? textFromJson(criterion.rationale)
            ? { summary: textFromJson(criterion.summary) ?? textFromJson(criterion.rationale) }
            : {}),
          data: JSON.parse(JSON.stringify(criterion)) as Json,
        });
      }
    }
  }
  const summary = textFromJson(payload.summary);
  if (summary) {
    items.push({
      kind: "text",
      id: "summary",
      label: "summary",
      summary,
      body: summary,
      value: summary as Json,
    });
  }
  for (const file of files) {
    items.push({
      kind: "artifact",
      id: file.path,
      label: path.basename(file.path),
      path: file.path,
    });
  }
  return dedupeResultItems(items);
}

function scoreFromWorkbenchResultPayload(payload: Record<string, Json>): number | undefined {
  const metrics = asRuntimeRecord(payload.metrics);
  const score = typeof payload.score === "number"
    ? payload.score
    : typeof metrics.score === "number"
      ? metrics.score
      : undefined;
  return typeof score === "number" && Number.isFinite(score) ? score : undefined;
}

function dedupeResultItems(items: readonly WorkbenchResultItem[]): WorkbenchResultItem[] {
  const byKey = new Map<string, WorkbenchResultItem>();
  for (const item of items) {
    byKey.set(`${item.kind}:${item.id ?? item.label ?? byKey.size}`, item);
  }
  return [...byKey.values()];
}

function skillImproveObjectsFromRemoteJob(args: {
  remoteJob: RemoteWorkbenchJob;
  run: WorkbenchRun;
  job: WorkbenchJob;
  agent: WorkbenchAgent;
  evidenceTraceIds: readonly string[];
  samples: number;
  patch?: WorkbenchSkillPatch;
}): { job: WorkbenchJob; artifact: WorkbenchArtifact; trace: WorkbenchTrace } {
  const finishedAt = args.remoteJob.finishedAt ?? now();
  const output = asRuntimeRecord(args.remoteJob.output);
  const usage = readWorkbenchSkillRunOutputUsage(output);
  const patch = args.patch ?? readWorkbenchSkillImprovementPatchFromRemoteJob(args.remoteJob) ?? undefined;
  const status: WorkbenchJob["status"] = args.remoteJob.status === "succeeded" && patch
    ? "succeeded"
    : args.remoteJob.status === "cancelled"
      ? "canceled"
      : "failed";
  const jobError = args.remoteJob.error ??
    (status === "failed" ? textFromJson(output.error) ?? "Improve adapter did not produce a usable skill patch." : undefined);
  const files = Array.isArray(output.files)
    ? output.files.filter(isSurfaceSnapshotFile).map(copyFile)
    : [];
  const artifact: WorkbenchArtifact = {
    id: nextArtifactIdForRun(args.run, args.remoteJob.id),
    runId: args.run.id,
    jobId: args.remoteJob.id,
    kind: "directory",
    path: `artifacts/${args.remoteJob.id}`,
    createdAt: finishedAt,
    files,
  };
  const request = {
    versionId: args.job.versionId,
    runId: args.run.id,
    jobId: args.remoteJob.id,
    caseId: args.job.caseId,
    sample: args.job.sample,
    skillName: args.job.skillName,
    skillBundleHash: args.job.skillBundleHash,
    agent: toJson(args.agent),
    evidenceTraceIds: args.evidenceTraceIds as unknown as Json,
    samples: args.samples,
    execution: jsonRecord(args.remoteJob.input).execution ?? null,
  } satisfies Record<string, Json>;
  const resultPayload = {
    status: status === "succeeded" ? "succeeded" : "failed",
    ...(usage ? { usage: usage as unknown as Json } : {}),
    ...(patch
      ? {
          fileChanges: patch.fileChanges as unknown as Json,
          ...(patch.summary ? { summary: patch.summary } : {}),
          ...(patch.feedback !== undefined ? { feedback: patch.feedback } : {}),
        }
      : {}),
    ...(jobError ? { error: jobError } : {}),
  } satisfies Record<string, Json>;
  const trace: WorkbenchTrace = {
    id: `trace_${args.remoteJob.id}`,
    runId: args.run.id,
    jobId: args.remoteJob.id,
    versionId: args.job.versionId,
    skillName: args.job.skillName,
    skillBundleHash: args.job.skillBundleHash,
    evalHash: args.job.evalHash,
    agentName: args.agent.name,
    agentHash: args.job.agentHash,
    createdAt: finishedAt,
    request,
    result: resultPayload,
    files: [
      textFile("request.json", JSON.stringify(request, null, 2) + "\n"),
      textFile("result.json", JSON.stringify(resultPayload, null, 2) + "\n"),
      ...files.map(copyFile),
    ],
  };
  const job: WorkbenchJob = {
    ...args.job,
    status,
    artifactIds: [artifact.id],
    traceIds: [trace.id],
    startedAt: args.remoteJob.startedAt ?? args.job.startedAt,
    finishedAt,
    durationMs: durationMsBetween(args.remoteJob.startedAt ?? args.job.startedAt, finishedAt),
    ...(jobError ? { error: jobError } : {}),
  };
  return { job, artifact, trace };
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
  return commandGenericSpecForSkillEval(environment, command, score);
}

function skillEvalGradeInvocation(args: {
  evalSnapshot: WorkbenchEvalSnapshot;
  agent: WorkbenchAgent;
  runtimeCase: WorkbenchEvalCaseRuntime;
}): WorkbenchAdapterInvocation {
  const declared = skillEvalGradeDeclaration(args.evalSnapshot);
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
  if (declared.adapter === "command") {
    return {
      use: "command",
      with: declared.config,
    };
  }
  throw new WorkbenchUserError(
    `Unsupported skill eval grade adapter ${declared.adapter}. Use grade.adapter: rubric, tests, or command.`,
  );
}

function skillEvalGradeDeclaration(
  evalSnapshot: WorkbenchEvalSnapshot,
): { adapter: string; config: Record<string, Json> } | null {
  return skillEvalGradeDeclarationFromFiles(evalSnapshot.files);
}

function skillEvalGradeDeclarationFromFiles(
  files: readonly SurfaceSnapshotFile[],
): { adapter: string; config: Record<string, Json> } | null {
  const evalFile = files.find((file) => file.path === EVAL_FILE);
  if (!evalFile) {
    return null;
  }
  const record = parseYamlRecord(evalFile.content);
  const grade = asRecord(record.grade);
  if (!grade) {
    return null;
  }
  const adapter = typeof grade.adapter === "string"
    ? grade.adapter.trim().toLowerCase()
    : typeof grade.use === "string"
      ? grade.use.trim().toLowerCase()
      : "";
  if (!adapter) {
    return null;
  }
  const config: Record<string, Json> = {};
  const withConfig = asRecord(grade.with);
  if (withConfig) {
    Object.assign(config, jsonRecord(withConfig));
  }
  for (const key of ["command", "instructions", "parallelism", "judge", "criteria"]) {
    if (grade[key] !== undefined && config[key] === undefined) {
      config[key] = toJson(grade[key]);
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
  score: WorkbenchAdapterInvocation,
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
    adapters: [...new Set(["command", ...skillEvalGradeAdapterIds(score)])],
    engine: score,
    engineResolve: score,
    run,
    gradeRun: score,
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
    adapters: [...new Set([agent.adapter.trim().toLowerCase(), ...skillEvalGradeAdapterIds(score)])],
    engine: score,
    engineResolve: score,
    run,
    gradeRun: score,
  };
}

function skillEvalGradeAdapterIds(score: WorkbenchAdapterInvocation): string[] {
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
    gradeRun: improve,
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

function skillEvalEngineCaseFiles(
  agent: WorkbenchAgent,
  runtimeCase: WorkbenchEvalCaseRuntime,
): WorkbenchEngineCase["files"] {
  if (isProviderBackedSkillEvalAgent(agent)) {
    return providerSkillEvalEngineCaseFiles(runtimeCase);
  }
  const source = runtimeCase.files.map(copyFile);
  const privateFiles = providerSkillEvalEngineCaseFiles(runtimeCase).private ?? [];
  return {
    public: source.map(copyFile),
    private: privateFiles.map(copyFile),
    source,
  };
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
    ...skillEvalGradeAdapterIds(score),
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
    `Agent ${agent.name} uses unsupported skill execution adapter ${agent.adapter}. Execute jobs support --adapter local, --adapter command, --adapter codex, or --adapter claude.`,
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
  remoteJob: RemoteWorkbenchJob;
  command?: string;
}

async function createSkillImprovementPatch(args: {
  root: string;
  state: WorkbenchProjectState;
  adapterAuthStoreRoot?: string;
  agent: WorkbenchAgent;
  base: WorkbenchVersion;
  evalHash: string;
  runId: string;
  jobId: string;
  createdAt: string;
  environmentDockerfile?: string;
  historicalTraces: readonly WorkbenchTrace[];
  improvementEvidence: readonly string[];
}): Promise<SkillImprovementResult> {
  if (!workbenchSkillImproveCanUseQueuedAdapter(args.agent)) {
    throw workbenchSkillImproveAdapterRequirementError(args.agent);
  }
  return executeAdapterBackedSkillImprovementPatch({
    root: args.root,
    state: args.state,
    adapterAuthStoreRoot: args.adapterAuthStoreRoot,
    agent: args.agent,
    base: args.base,
    evalHash: args.evalHash,
    runId: args.runId,
    jobId: args.jobId,
    createdAt: args.createdAt,
    environmentDockerfile: args.environmentDockerfile,
    historicalTraces: args.historicalTraces,
  });
}

async function executeAdapterBackedSkillImprovementPatch(args: {
  root: string;
  state: WorkbenchProjectState;
  adapterAuthStoreRoot?: string;
  agent: WorkbenchAgent;
  base: WorkbenchVersion;
  evalHash: string;
  runId: string;
  jobId: string;
  createdAt: string;
  environmentDockerfile?: string;
  historicalTraces: readonly WorkbenchTrace[];
}): Promise<SkillImprovementResult> {
  const command = configString(args.agent.config, "improveCommand");
  const runtimeInput = createWorkbenchSkillImproveRuntimeInput({
    ownerUserId: "local",
    projectId: "local",
    runId: args.runId,
    jobId: args.jobId,
    baseVersionId: args.base.id,
    evalHash: args.evalHash,
    agent: args.agent,
    baseFiles: args.base.files,
    traces: args.historicalTraces,
    createdAt: args.createdAt,
    environmentDockerfile: args.environmentDockerfile ?? await readSkillEvalEnvironmentDockerfile(args.root),
  });
  const completed = await executeWorkbenchExecutionJob(runtimeInput, {
    sandboxBackend: DOCKER_SANDBOX_BACKEND,
    loadLocalAdapterAuthProfiles: isProviderBackedSkillEvalAgent(args.agent),
    adapterAuthStoreRoot: args.adapterAuthStoreRoot,
  });
  if (completed.status !== "succeeded") {
    throw improvePatchExecutionError(completed, args.agent, `Improve adapter failed: ${completed.error ? publicRuntimeErrorSummary(completed.error) : "no patch produced"}`);
  }
  const patch = readWorkbenchSkillImprovementPatchFromRemoteJob(completed);
  if (!patch || patch.fileChanges.length === 0) {
    throw improvePatchExecutionError(completed, args.agent, "Improve adapter completed without producing an editable skill patch.");
  }
  return {
    mode: isProviderBackedSkillEvalAgent(args.agent) ? "provider" : "command",
    patch: {
      ...patch,
      summary: patch.summary ?? `Improved ${patch.fileChanges.length} skill file${patch.fileChanges.length === 1 ? "" : "s"} with agent ${args.agent.name}.`,
    },
    remoteJob: completed,
    ...(command ? { command } : {}),
  };
}

function improvePatchExecutionError(
  remoteJob: RemoteWorkbenchJob,
  agent: WorkbenchAgent,
  message: string,
): WorkbenchCodedError & { remoteJob: RemoteWorkbenchJob } {
  return Object.assign(new WorkbenchCodedError("improve_failed", message, {
    remediation: adapterAuthRemediationFromError(remoteJob.error) ?? "workbench improve",
    subject: { agent: agent.name, status: remoteJob.status },
    exitCode: 1,
  }), { remoteJob });
}

function improvePatchRemoteJob(error: unknown): RemoteWorkbenchJob | undefined {
  return error && typeof error === "object" && "remoteJob" in error
    ? (error as { remoteJob?: RemoteWorkbenchJob }).remoteJob
    : undefined;
}

function skillImproveEditPaths(agent: WorkbenchAgent): string[] {
  return configStringList(agent.config, "improveEdits") ?? ["."];
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
    WORKBENCH_DEFAULT_CASE_TEST_COMMAND;
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

function publicRuntimeErrorSummary(value: string): string {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const errorLine = lines.find((line) => /^(?:[A-Za-z_$][\w.$]*Error|Error):/u.test(line));
  if (errorLine) {
    return singleLine(errorLine);
  }
  const nonStackLine = lines.find((line) =>
    !/^at\s/u.test(line) &&
    !/^\(?node:/u.test(line) &&
    !/:\d+:\d+\)?$/u.test(line)
  );
  return singleLine(nonStackLine ?? value);
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}

interface PlannedWorkbenchLaunchSource {
  version: WorkbenchVersion;
  sourceState: "committed" | "would_create";
  wouldCreateVersionId?: string;
}

async function planWorkbenchLaunchSource(
  root: string,
  state: WorkbenchProjectState,
  options: {
    ref?: string;
    commit: boolean;
    message?: string;
  },
): Promise<PlannedWorkbenchLaunchSource> {
  if (options.ref) {
    return {
      version: resolveVersion(state, options.ref),
      sourceState: "committed",
    };
  }
  const files = await readSkillFiles(root);
  const hash = hashFiles(files);
  const existing = findWorkbenchVersionBySourceHash(state.versions, hash);
  if (existing) {
    if (options.commit) {
      state.refs.current = existing.id;
    }
    return {
      version: existing,
      sourceState: "committed",
    };
  }
  const parent = state.refs.current;
  const version: WorkbenchVersion = {
    id: versionIdForHash(hash),
    hash,
    message: options.message ?? SOURCE_SNAPSHOT_MESSAGE,
    parentIds: parent ? [parent] : [],
    createdAt: now(),
    files,
  };
  if (!options.commit) {
    return {
      version,
      sourceState: "would_create",
      wouldCreateVersionId: version.id,
    };
  }
  state.versions.push(version);
  state.refs.current = version.id;
  if (parent && parent !== version.id) {
    state.lineage.push({
      parentId: parent,
      childId: version.id,
      reason: "version",
      createdAt: version.createdAt,
      message: version.message,
    });
  }
  return {
    version,
    sourceState: "committed",
  };
}

function findWorkbenchVersionBySourceHash(
  versions: readonly WorkbenchVersion[],
  hash: string,
): WorkbenchVersion | undefined {
  return versions.find((version) =>
    version.hash === hash ||
    sourceComparableHashForVersion(version) === hash
  );
}

function sourceComparableHashForVersion(version: WorkbenchVersion): string {
  return hashFiles(version.files.filter((file) => !isWorkbenchAgentConfigPath(file.path)));
}

function isWorkbenchAgentConfigPath(filePath: string): boolean {
  return normalizeRelativePath(filePath) === `${WORKBENCH_DIR}/${AGENTS_FILE}`;
}

async function resolveOrCreateRunVersion(root: string, state: WorkbenchProjectState, ref?: string): Promise<WorkbenchVersion> {
  return (await planWorkbenchLaunchSource(root, state, {
    ref,
    commit: true,
    message: SOURCE_SNAPSHOT_MESSAGE,
  })).version;
}

async function reconcileWorkbenchVersion(
  root: string,
  state: WorkbenchProjectState,
  message: string,
): Promise<WorkbenchVersion> {
  return (await planWorkbenchLaunchSource(root, state, {
    commit: true,
    message,
  })).version;
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

async function resolveRequestedAgents(
  root: string,
  agentSelection?: string,
  remediationCommand?: WorkbenchSelectorCommand,
): Promise<WorkbenchAgent[]> {
  const agents = await readAgents(root);
  return resolveNamedSelection(agents, agentSelection, await readDefaultAgentSelection(root, agents), "agent", remediationCommand);
}

async function runtimeAgentOptionsForRoot(
  root: string,
  state: WorkbenchProjectState,
): Promise<Pick<NonNullable<Parameters<typeof createWorkbenchVersionRuntimeSnapshot>[1]>, "agents" | "defaultAgent">> {
  const agents = await readAgents(root).catch(() => state.agents.map(copyAgent));
  const defaultAgent = await readDefaultAgentSelection(root, agents).catch(() =>
    defaultWorkbenchAgentSelectionFromState({
      ...state,
      agents: agents.map(copyAgent),
    })
  );
  return {
    agents,
    ...(defaultAgent ? { defaultAgent } : {}),
  };
}

async function readAgents(root: string): Promise<WorkbenchAgent[]> {
  const filePath = path.join(workbenchDir(root), AGENTS_FILE);
  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") {
      throw new WorkbenchUserError(`Missing ${path.join(".workbench", AGENTS_FILE)}. Run \`workbench new\` or restore the agent file before continuing.`);
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
    throw new WorkbenchUserError(`No agents configured in ${fileLabel}. Run \`${providerAgentSetupCommand("codex", "default")}\`.`);
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
  noun: WorkbenchManifestEntryNoun,
  remediationCommand?: WorkbenchSelectorCommand,
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
      const configured = entries.map((candidate) => candidate.name).sort();
      throw new WorkbenchCodedError("usage", `${capitalize(noun)} not found: ${name}. Configured ${noun}s: ${configuredSelectionNames(entries)}.`, {
        remediation: namedSelectionRemediation(noun, entries, remediationCommand, name),
        subject: noun === "agent"
          ? { configuredAgents: configured }
          : noun === "version"
            ? { configuredVersions: configured }
            : { configuredSkills: configured },
        exitCode: 2,
      });
    }
    return entry;
  });
}

function configuredSelectionNames(entries: readonly { name: string }[]): string {
  const names = entries.map((entry) => entry.name).sort();
  if (names.length === 0) {
    return "none";
  }
  const visible = names.slice(0, 8);
  return `${visible.join(", ")}${names.length > visible.length ? ", ..." : ""}`;
}

function namedSelectionRemediation<T extends { name: string }>(
  noun: WorkbenchManifestEntryNoun,
  entries: readonly T[],
  command: WorkbenchSelectorCommand = "eval",
  missingName?: string,
): string {
  const flag = noun === "agent" ? "--agents" : "--versions";
  const configured = entries.map((entry) => entry.name).sort();
  if (configured.length === 0) {
    return noun === "agent"
      ? providerAgentSetupCommand("codex", "default")
      : "workbench new";
  }
  const firstConfigured = configured[0];
  if (!firstConfigured) {
    return noun === "agent"
      ? providerAgentSetupCommand("codex", "default")
      : "workbench new";
  }
  const improvementAgent = command === "improve" && noun === "agent"
    ? firstImprovementCapableAgentName(entries)
    : undefined;
  if (command === "improve" && noun === "agent" && !improvementAgent) {
    return providerAgentSetupCommand("codex", "default");
  }
  const first = improvementAgent ?? closestConfiguredSelectionName(missingName, configured) ?? firstConfigured;
  const selection = missingName || command === "improve" || configured.length === 1 ? first : ALL_SELECTOR;
  return `workbench ${command} ${flag} ${selection}`;
}

function closestConfiguredSelectionName(missingName: string | undefined, configured: readonly string[]): string | undefined {
  const normalized = missingName?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return configured.find((name) => name.toLowerCase() === normalized) ??
    configured.find((name) => name.toLowerCase().startsWith(normalized) || normalized.startsWith(name.toLowerCase())) ??
    configured.find((name) => name.toLowerCase().includes(normalized) || normalized.includes(name.toLowerCase()));
}

function firstImprovementCapableAgentName(entries: readonly { name: string }[]): string | undefined {
  return entries
    .filter(isWorkbenchAgent)
    .filter(workbenchSkillImproveCanUseQueuedAdapter)
    .map((agent) => agent.name)
    .sort()[0];
}

function isWorkbenchAgent(entry: { name: string }): entry is WorkbenchAgent {
  return typeof (entry as Partial<WorkbenchAgent>).adapter === "string";
}

function readManifestDefaultSelection<T extends { name: string }>(
  record: Record<string, unknown>,
  fileLabel: string,
  entries: readonly T[],
  noun: WorkbenchManifestEntryNoun,
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

function normalizeManifestEntryName(name: string, fileLabel: string, noun: WorkbenchManifestEntryNoun): string {
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
  noun: WorkbenchManifestEntryNoun,
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

export function createWorkbenchEvalSnapshotFromVersionFiles(
  versionFiles: readonly SurfaceSnapshotFile[],
  timestamps: { createdAt?: string; updatedAt?: string } = {},
): WorkbenchEvalSnapshot | null {
  const files = versionFiles.flatMap((file) => {
    const normalized = normalizeRelativePath(file.path);
    const evalPath = evalSnapshotPathFromSourcePath(normalized);
    return evalPath ? [{ ...copyFile(file), path: evalPath }] : [];
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (files.length === 0) {
    return null;
  }
  return createWorkbenchEvalSnapshotFromEvalFiles(files, timestamps);
}

async function readEvalSnapshot(
  root: string,
  timestamps: { createdAt?: string; updatedAt?: string } = {},
): Promise<WorkbenchEvalSnapshot> {
  const files = [
    ...await readOptionalFile(path.join(workbenchDir(root), EVAL_FILE), EVAL_FILE),
    ...await readFilesUnder(path.join(workbenchDir(root), CASES_DIR), CASES_DIR),
    ...await readFilesUnder(path.join(workbenchDir(root), ENVIRONMENT_DIR), ENVIRONMENT_DIR),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const sourceUpdatedAt = timestamps.updatedAt ?? await latestEvalSnapshotUpdatedAt(root);
  const createdAt = timestamps.createdAt ?? sourceUpdatedAt;
  return createWorkbenchEvalSnapshotFromEvalFiles(files, {
    createdAt,
    updatedAt: sourceUpdatedAt,
  });
}

function createWorkbenchEvalSnapshotFromEvalFiles(
  files: readonly SurfaceSnapshotFile[],
  timestamps: { createdAt?: string; updatedAt?: string } = {},
): WorkbenchEvalSnapshot {
  const normalizedFiles = files
    .map(copyFile)
    .map((file) => ({ ...file, path: normalizeRelativePath(file.path) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const cases = evalCaseSnapshotsFromEvalFiles(normalizedFiles);
  const updatedAt = timestamps.updatedAt ?? now();
  const createdAt = timestamps.createdAt ?? updatedAt;
  const gradeAdapter = skillEvalGradeDeclarationFromFiles(normalizedFiles)?.adapter ?? "tests";
  return {
    hash: hashFiles(normalizedFiles),
    files: normalizedFiles,
    cases,
    caseCount: cases.length,
    createdAt,
    updatedAt,
    gradeAdapter,
  };
}

function evalSnapshotPathFromSourcePath(filePath: string): string | null {
  const normalized = normalizeRelativePath(filePath);
  if (!normalized.startsWith(`${WORKBENCH_DIR}/`)) {
    return null;
  }
  const workbenchSourcePath = normalized.slice(WORKBENCH_DIR.length + 1);
  return workbenchSourcePath === EVAL_FILE ||
    workbenchSourcePath.startsWith(`${CASES_DIR}/`) ||
    workbenchSourcePath.startsWith(`${ENVIRONMENT_DIR}/`)
    ? workbenchSourcePath
    : null;
}

function evalCaseSnapshotsFromEvalFiles(files: readonly SurfaceSnapshotFile[]): WorkbenchEvalCaseSnapshot[] {
  const grouped = new Map<string, SurfaceSnapshotFile[]>();
  for (const file of files) {
    const normalized = normalizeRelativePath(file.path);
    if (!normalized.startsWith(`${CASES_DIR}/`)) {
      continue;
    }
    const relativeCasePath = normalized.slice(CASES_DIR.length + 1);
    const [first, ...rest] = relativeCasePath.split("/");
    const key = rest.length > 0
      ? first
      : path.basename(first ?? "case", path.extname(first ?? "case"));
    if (!key) {
      continue;
    }
    const group = grouped.get(key) ?? [];
    group.push(copyFile({ ...file, path: normalized }));
    grouped.set(key, group);
  }
  return [...grouped.entries()]
    .map(([fallbackId, caseFiles]) => {
      const sortedFiles = caseFiles.sort((left, right) => left.path.localeCompare(right.path));
      const descriptor = sortedFiles.find((file) =>
        isCaseDescriptorPath(file.path.slice(CASES_DIR.length + 1))
      );
      const record = descriptor ? parseCaseSnapshotRecord(descriptor.content) : {};
      const id = caseIdFromRecord(record, fallbackId);
      const command = caseCommandFromRecord(record);
      const title = caseTitleFromRecord(record);
      const description = caseDescriptionFromRecord(record);
      return {
        id,
        path: descriptor?.path ?? `${CASES_DIR}/${fallbackId}`,
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
        ...(command ? { command } : {}),
        files: sortedFiles.map(copyFile),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
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
    ...await readOptionalFile(path.join(workbenchDir(root), VERSIONS_FILE), `${WORKBENCH_DIR}/${VERSIONS_FILE}`),
    ...await readFilesUnder(path.join(workbenchDir(root), ENVIRONMENT_DIR), `${WORKBENCH_DIR}/${ENVIRONMENT_DIR}`),
  ];
  return [...installableFiles, ...authoredWorkbenchFiles]
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function readSkillSources(root: string): Promise<WorkbenchSkillSource[]> {
  await assertNoLegacySkillManifest(root);
  const filePath = path.join(workbenchDir(root), VERSIONS_FILE);
  if (!await exists(filePath)) {
    const rootSkill = await currentRootSkillSource(root);
    if (rootSkill) {
      return [rootSkill];
    }
    throw new WorkbenchUserError(`Missing ${path.join(".workbench", VERSIONS_FILE)}. Projects without a root ${SKILL_FILE} must declare versions.`);
  }
  const source = await fs.readFile(filePath, "utf8");
  let record: Record<string, unknown>;
  try {
    record = parseYamlRecord(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkbenchUserError(`${path.join(".workbench", VERSIONS_FILE)} is not valid YAML: ${message}`);
  }
  const versionsRecord = asRecord(record.versions);
  if (!versionsRecord || Object.keys(versionsRecord).length === 0) {
    const rootSkill = await currentRootSkillSource(root);
    if (rootSkill) {
      return [rootSkill];
    }
    throw new WorkbenchUserError(`No versions configured in ${path.join(".workbench", VERSIONS_FILE)}.`);
  }
  const sources = Object.entries(versionsRecord)
    .map(([name, raw]) => parseSkillSource(name, raw, `versions.${name}`))
    .sort((left, right) => left.name.localeCompare(right.name));
  assertUniqueManifestEntryNames(sources, path.join(".workbench", VERSIONS_FILE), "version");
  readManifestDefaultSelection(record, path.join(".workbench", VERSIONS_FILE), sources, "version");
  return sources;
}

async function readDefaultSkillSelection(root: string, sources: readonly WorkbenchSkillSource[]): Promise<string> {
  await assertNoLegacySkillManifest(root);
  const filePath = path.join(workbenchDir(root), VERSIONS_FILE);
  if (!await exists(filePath)) {
    if (sources.some((source) => source.name === CURRENT_SKILL_VERSION_NAME)) {
      return CURRENT_SKILL_VERSION_NAME;
    }
    throw new WorkbenchUserError(`Missing ${path.join(".workbench", VERSIONS_FILE)}. Projects without a root ${SKILL_FILE} must declare versions.`);
  }
  const record = parseYamlRecord(await fs.readFile(filePath, "utf8"));
  const versionsRecord = asRecord(record.versions);
  if ((!versionsRecord || Object.keys(versionsRecord).length === 0) && sources.some((source) => source.name === CURRENT_SKILL_VERSION_NAME)) {
    return CURRENT_SKILL_VERSION_NAME;
  }
  return readManifestDefaultSelection(record, path.join(".workbench", VERSIONS_FILE), sources, "version");
}

async function assertNoLegacySkillManifest(root: string): Promise<void> {
  const legacyPath = path.join(workbenchDir(root), LEGACY_SKILLS_FILE);
  if (await exists(legacyPath)) {
    throw new WorkbenchUserError(`${path.join(".workbench", LEGACY_SKILLS_FILE)} is no longer supported. Use ${path.join(".workbench", VERSIONS_FILE)} with versions.*.source entries.`);
  }
}

async function currentRootSkillSource(root: string): Promise<WorkbenchSkillSource | null> {
  return await exists(path.join(root, SKILL_FILE))
    ? { name: CURRENT_SKILL_VERSION_NAME, kind: "local", source: "local:.", path: "." }
    : null;
}

function parseSkillSource(name: string, raw: unknown, label: string): WorkbenchSkillSource {
  const value = asRecord(raw) ?? {};
  const normalizedName = normalizeManifestEntryName(name, path.join(".workbench", VERSIONS_FILE), "version");
  for (const oldKey of ["path", "from", "ref", "baseline"]) {
    if (oldKey in value) {
      throw new WorkbenchUserError(`${path.join(".workbench", VERSIONS_FILE)} ${label}.${oldKey} is no longer supported. Use ${label}.source.`);
    }
  }
  const sourceText = typeof value.source === "string" && value.source.trim() ? value.source.trim() : undefined;
  if (!sourceText) {
    throw new WorkbenchUserError(`${path.join(".workbench", VERSIONS_FILE)} ${label} must define source.`);
  }
  const includes = Array.isArray(value.includes)
    ? value.includes.map((entry, index) => parseSkillInclude(entry, `${label}.includes[${index}]`))
    : undefined;
  const descriptor = parseVersionSourceString(sourceText, label);
  if (descriptor.kind === "none" && includes && includes.length > 0) {
    throw new WorkbenchUserError(`${path.join(".workbench", VERSIONS_FILE)} ${label} source none cannot define includes.`);
  }
  const explicitLabel = typeof value.label === "string" && value.label.trim() ? value.label.trim() : undefined;
  return {
    name: normalizedName,
    source: sourceText,
    ...(explicitLabel ? { label: explicitLabel } : {}),
    ...descriptor,
    ...(includes && includes.length > 0 ? { includes } : {}),
  };
}

function parseSkillInclude(raw: unknown, label: string): WorkbenchSkillInclude {
  const value = asRecord(raw) ?? {};
  const sourceText = typeof value.source === "string" && value.source.trim() ? value.source.trim() : undefined;
  if (!sourceText) {
    throw new WorkbenchUserError(`${path.join(".workbench", VERSIONS_FILE)} ${label} must define source.`);
  }
  for (const oldKey of ["path", "from", "ref", "baseline"]) {
    if (oldKey in value) {
      throw new WorkbenchUserError(`${path.join(".workbench", VERSIONS_FILE)} ${label}.${oldKey} is no longer supported. Use ${label}.source.`);
    }
  }
  const descriptor = parseVersionSourceString(sourceText, label);
  if (descriptor.kind === "none") {
    throw new WorkbenchUserError(`${path.join(".workbench", VERSIONS_FILE)} ${label} includes cannot use source none.`);
  }
  const explicitName = typeof value.name === "string" && value.name.trim() ? value.name.trim() : undefined;
  const explicitLabel = typeof value.label === "string" && value.label.trim() ? value.label.trim() : undefined;
  const fallbackName = descriptor.kind === "local"
    ? safeName(path.basename(descriptor.path || "include"))
    : safeName(remoteSkillPathName(descriptor.from!));
  return {
    name: explicitName ?? fallbackName,
    source: sourceText,
    ...(explicitLabel ? { label: explicitLabel } : {}),
    kind: descriptor.kind,
    ...(descriptor.path ? { path: descriptor.path } : {}),
    ...(descriptor.from ? { from: descriptor.from } : {}),
    ...(descriptor.ref ? { ref: descriptor.ref } : {}),
  };
}

function parseVersionSourceString(
  source: string,
  label: string,
): Pick<WorkbenchSkillSource, "kind" | "path" | "from" | "ref"> {
  if (source === "none") {
    return { kind: "none" };
  }
  if (source.startsWith("local:")) {
    const localPath = source.slice("local:".length).trim();
    if (!localPath) {
      throw new WorkbenchUserError(`${path.join(".workbench", VERSIONS_FILE)} ${label}.source local: requires a path.`);
    }
    return { kind: "local", path: localPath };
  }
  if (source.startsWith("workbench:")) {
    const pinned = splitPinnedSource(source.slice("workbench:".length), label);
    const parts = pinned.from.split("/");
    const [owner, skill] = parts;
    if (parts.length !== 2 || !isPinnedSourceSegment(owner) || !isPinnedSourceSegment(skill) || !isPinnedSourceRef(pinned.ref)) {
      throw new WorkbenchUserError(`${path.join(".workbench", VERSIONS_FILE)} ${label}.source must be workbench:OWNER/SKILL@VERSION.`);
    }
    return {
      kind: "remote",
      from: `https://v2.workbench.ai/skills/${encodeURIComponent(owner)}/${encodeURIComponent(skill)}`,
      ref: pinned.ref,
    };
  }
  if (source.startsWith("github:")) {
    const pinned = splitPinnedSource(source, label);
    if (!isGithubPinnedSource(pinned.from, pinned.ref)) {
      throw new WorkbenchUserError(`${path.join(".workbench", VERSIONS_FILE)} ${label}.source must be github:OWNER/REPO//PATH@COMMIT, where COMMIT is a 40-character commit SHA.`);
    }
    return { kind: "remote", from: pinned.from, ref: pinned.ref };
  }
  throw new WorkbenchUserError(`${path.join(".workbench", VERSIONS_FILE)} ${label}.source must use local:, none, workbench:, or github:.`);
}

function splitPinnedSource(value: string, label: string): { from: string; ref: string } {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    throw new WorkbenchUserError(`${path.join(".workbench", VERSIONS_FILE)} ${label}.source must include an immutable @ ref.`);
  }
  return {
    from: trimmed.slice(0, at).trim(),
    ref: trimmed.slice(at + 1).trim(),
  };
}

function isPinnedSourceSegment(value: string | undefined): value is string {
  return typeof value === "string" && /^[^\s/@]+$/u.test(value);
}

function isPinnedSourceRef(value: string): boolean {
  return /^[^\s/@]+$/u.test(value);
}

function isGithubPinnedSource(from: string, ref: string): boolean {
  if (!/^[0-9a-f]{40}$/iu.test(ref)) {
    return false;
  }
  const match = /^github:([^\s/@]+)\/([^\s/@]+)\/\/(.+)$/u.exec(from);
  if (!match) {
    return false;
  }
  try {
    normalizeRelativePath(match[3]!);
    return true;
  } catch {
    return false;
  }
}

async function resolveRequestedSkillBundles(args: {
  root: string;
    state: WorkbenchProjectState;
    version: WorkbenchVersion;
    selection?: string;
    authToken?: string;
    remediationCommand?: WorkbenchSelectorCommand;
}): Promise<WorkbenchSkillBundleSnapshot[]> {
  const sources = await readSkillSources(args.root);
  args.state.skillSources = sources.map(copySkillSource);
  const defaultSelection = await readDefaultSkillSelection(args.root, sources);
  const requested = resolveNamedSelection(sources, args.selection, defaultSelection, "version", args.remediationCommand);
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
    : source.kind === "local" && source.path === "."
    ? installableCurrentSkillFiles(primaryVersion.files, source, options.sources ?? [source])
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
      source: source.source,
      path: source.path,
      from: source.from,
      ref: source.ref,
    },
    files,
    includes: includedSkills.map((include) => ({
      name: include.name,
      kind: include.kind,
      source: include.source,
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
    if (segments[3] !== "versions" || !segments[4] || segments.length !== 5) {
      throw new WorkbenchUserError(`Invalid Workbench skill URL: ${from}`);
    }
    version = segments[4];
    if (version !== ref) {
      throw new WorkbenchUserError(`Workbench source URL ${url.toString()} is pinned to ${version}, not requested ref ${ref}.`);
    }
  } else if (segments.length !== 3) {
    throw new WorkbenchUserError(`Invalid Workbench skill URL: ${from}`);
  }
  url.pathname = `/api/workbench/source/skills/${encodeURIComponent(owner)}/${encodeURIComponent(skill)}/versions/${encodeURIComponent(version)}/source`;
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
    const beforeSource = segments.slice(0, sourceIndex);
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
    fs.rm(path.join(workbenchRoot, VERSIONS_FILE), { force: true }),
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

async function withWorkbenchProjectLockRootIfAvailable<T>(
  root: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const normalizedRoot = path.resolve(root);
  const held = projectLockContext.getStore();
  if (held?.has(normalizedRoot)) {
    return fn();
  }
  if (projectLockQueues.has(normalizedRoot)) {
    return undefined;
  }
  const release = await tryAcquireWorkbenchProjectLock(normalizedRoot);
  if (!release) {
    return undefined;
  }
  try {
    const next = new Set(held ?? []);
    next.add(normalizedRoot);
    return await projectLockContext.run(next, fn);
  } finally {
    await release();
  }
}

async function tryAcquireWorkbenchProjectLock(root: string): Promise<(() => Promise<void>) | null> {
  await ensureWorkbenchLocalMetadataIgnore(root);
  const lockRoot = projectLockDir(root);
  const ownerPath = path.join(lockRoot, "owner.json");
  await fs.mkdir(path.dirname(lockRoot), { recursive: true });
  try {
    await fs.mkdir(lockRoot);
  } catch (error) {
    if (fileErrorCode(error) !== "EEXIST") {
      throw error;
    }
    if (!await removeStaleWorkbenchProjectLock(lockRoot)) {
      return null;
    }
    try {
      await fs.mkdir(lockRoot);
    } catch (retryError) {
      if (fileErrorCode(retryError) !== "EEXIST") {
        throw retryError;
      }
      return null;
    }
  }
  await writeJson(ownerPath, {
    schema: "workbench.project-lock.v1",
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: now(),
  } satisfies WorkbenchProjectLockOwner);
  return async () => {
    await fs.rm(lockRoot, { recursive: true, force: true });
  };
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
      throw new WorkbenchUserError("Workbench is not initialized here. Run `workbench new` first.");
    }
    return emptyWorkbenchState(root);
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await recoverAtomicStateCommit(root);
      return await readStateFromObjectStore(root, <T>(type: WorkbenchStateObjectType) => readObjectTypeDir<T>(root, type));
    } catch (error) {
      if (!isTransientStateReadError(error) || attempt === 5) {
        throw error;
      }
      await sleep(15 * (attempt + 1));
    }
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
    throw new WorkbenchUserError("Workbench is not initialized here. Run `workbench new` first.");
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
  await withStateSaveQueue(root, async () => {
    await withWorkbenchProjectLockRoot(root, async () => {
      await fs.mkdir(workbenchDir(root), { recursive: true });
      await fs.mkdir(path.join(workbenchDir(root), TMP_DIR), { recursive: true });
      await removeStateTree(path.join(workbenchDir(root), "store"));
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
        await advanceLocalWorkbenchLiveState(root).catch(() => undefined);
      } finally {
        await removeStateTree(tempRoot);
      }
    });
  });
}

async function withStateSaveQueue<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const normalizedRoot = path.resolve(root);
  const previous = stateSaveQueues.get(normalizedRoot) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  const settled = next.then(() => undefined, () => undefined);
  stateSaveQueues.set(normalizedRoot, settled);
  try {
    return await next;
  } finally {
    if (stateSaveQueues.get(normalizedRoot) === settled) {
      stateSaveQueues.delete(normalizedRoot);
    }
  }
}

interface WorkbenchHttpRemoteOptions {
  authToken?: string;
  signal?: AbortSignal;
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
      { authToken: options.authToken, signal: options.signal },
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
        signal: options.signal,
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
): Promise<{ installHandle: string }> {
  if (isHttpRemote(remote)) {
    const target = await resolveHttpRemoteSkill(remote, options, options.state);
    if (!target.owner || !target.name) {
      throw new WorkbenchUserError(`Workbench Cloud remote did not return owner/name identity for ${remote.url}.`);
    }
    const publication = {
      installHandle: `${target.owner}/${target.name}`,
    };
    await httpRemoteJson<{ skill: unknown }>(
      target.baseUrl,
      `/api/workbench/skills/${encodeURIComponent(target.skillId)}/objects`,
      {
        authToken: options.authToken,
        signal: options.signal,
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
    remediation: "workbench login && workbench publish",
    subject: { remote: remote.name, kind: remote.kind, url: remote.url },
    exitCode: 1,
  });
}

async function deleteRemotePublishedVersion(
  remote: WorkbenchRemote,
  versionId: string,
  options: WorkbenchRemoteWriteOptions,
): Promise<{
  currentVersionId: string;
  publishedVersionIds: string[];
  installHandle?: string;
  visibility?: WorkbenchPublishVisibility;
}> {
  if (isHttpRemote(remote)) {
    const target = await resolveHttpRemoteSkill(remote, options, options.state);
    if (!target.owner || !target.name) {
      throw new WorkbenchUserError(`Workbench Cloud remote did not return owner/name identity for ${remote.url}.`);
    }
    const response = await httpRemoteJson<{
      publication?: {
        currentVersionId?: unknown;
        publishedVersionIds?: unknown;
        installHandle?: unknown;
        visibility?: unknown;
      };
    }>(
      target.baseUrl,
      `/api/workbench/source/skills/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}/versions/${encodeURIComponent(versionId)}`,
      {
        authToken: options.authToken,
        signal: options.signal,
        method: "DELETE",
      },
    );
    const publication = response.publication;
    const currentVersionId = typeof publication?.currentVersionId === "string" ? publication.currentVersionId : "";
    const publishedVersionIds = Array.isArray(publication?.publishedVersionIds)
      ? publication.publishedVersionIds.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : [];
    if (!currentVersionId || !publishedVersionIds.includes(currentVersionId)) {
      throw new WorkbenchCodedError("unpublish_failed", "Workbench Cloud returned an invalid publication summary after unpublish.", {
        subject: { remote: remote.name, versionId },
        exitCode: 1,
      });
    }
    return {
      currentVersionId,
      publishedVersionIds,
      ...(typeof publication?.installHandle === "string" ? { installHandle: publication.installHandle } : {}),
      ...(publication?.visibility === "private" || publication?.visibility === "internal" || publication?.visibility === "public"
        ? { visibility: publication.visibility }
        : {}),
    };
  }
  throw new WorkbenchCodedError("unpublish_failed", `Remote ${remote.name} is a file remote; only Workbench Cloud remotes can unpublish source.`, {
    remediation: "workbench login && workbench unpublish VERSION",
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

function workbenchRemoteInstallHandle(remote: WorkbenchRemote): string {
  if (!isHttpRemote(remote)) {
    throw new WorkbenchCodedError("publish_failed", `Remote ${remote.name} is a file remote; only Workbench Cloud remotes have install handles.`, {
      subject: { remote: remote.name, kind: remote.kind, url: remote.url },
      exitCode: 1,
    });
  }
  const parsed = parseHttpRemote(remote);
  return `${parsed.owner}/${parsed.name}`;
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

function workbenchRemoteVersionSourceUrl(remote: WorkbenchRemote, versionId: string): string {
  if (!isHttpRemote(remote)) {
    throw new WorkbenchCodedError("publish_failed", `Remote ${remote.name} is a file remote; only Workbench Cloud remotes have install URLs.`, {
      subject: { remote: remote.name, kind: remote.kind, url: remote.url, versionId },
      exitCode: 1,
    });
  }
  const parsed = parseHttpRemote(remote);
  return `${parsed.baseUrl}/skills/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}/versions/${encodeURIComponent(versionId)}`;
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
    `/api/workbench/skills?owner=${encodeURIComponent(parsed.owner)}&name=${encodeURIComponent(parsed.name)}`,
    { authToken: options.authToken, signal: options.signal },
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
      signal: options.signal,
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
  const method = options.method ?? "GET";
  const canRetry = isIdempotentHttpRemoteMethod(method);
  const requestBody = encodeHttpRemoteJsonBody(options.body);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= HTTP_REMOTE_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${apiPath}`, {
        method,
        signal: options.signal,
        headers: {
          ...requestBody.headers,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: requestBody.body,
      });
    } catch (error) {
      lastError = error;
      if (canRetry && attempt < HTTP_REMOTE_MAX_ATTEMPTS && isTransientHttpRemoteError(error)) {
        await sleep(250 * attempt);
        continue;
      }
      throw httpRemoteTransportError(error, apiPath);
    }
    const text = await response.text();
    if (!response.ok) {
      const cloudError = parseWorkbenchCloudErrorBody(text);
      if (cloudError) {
        const normalizedCloudError = normalizeWorkbenchCloudError(cloudError);
        if (response.status === 404 && isNotFoundCloudErrorCode(cloudError.code)) {
          throw new WorkbenchRemoteNotFoundError(normalizedCloudError.message);
        }
        const codedError = new WorkbenchCodedError(normalizedCloudError.code, normalizedCloudError.message, {
          retryable: normalizedCloudError.retryable,
          ...(normalizedCloudError.remediation ? { remediation: normalizedCloudError.remediation } : {}),
          ...(normalizedCloudError.subject ? { subject: normalizedCloudError.subject } : {}),
          exitCode: response.status === 400 ? 2 : 1,
        });
        lastError = codedError;
        if (canRetry && attempt < HTTP_REMOTE_MAX_ATTEMPTS && normalizedCloudError.retryable) {
          await sleep(250 * attempt);
          continue;
        }
        throw codedError;
      }
      if (response.status === 401 && !token) {
        throw new WorkbenchCodedError("auth_required", "Workbench Cloud remote requires login.", {
          remediation: "workbench login",
          exitCode: 1,
        });
      }
      if (response.status === 404) {
        throw new WorkbenchRemoteNotFoundError(`Workbench Cloud object not found: ${apiPath}`);
      }
      const codedError = new WorkbenchCodedError("remote_protocol_error", `Workbench Cloud remote request failed (${response.status}): ${readHttpErrorMessage(text)}`, {
        retryable: response.status === 429 || response.status >= 500,
        subject: { status: response.status, path: apiPath },
        exitCode: 1,
      });
      lastError = codedError;
      if (canRetry && attempt < HTTP_REMOTE_MAX_ATTEMPTS && codedError.retryable) {
        await sleep(250 * attempt);
        continue;
      }
      throw codedError;
    }
    return (text ? JSON.parse(text) : {}) as T;
  }
  throw lastError instanceof WorkbenchCodedError ? lastError : httpRemoteTransportError(lastError, apiPath);
}

function isIdempotentHttpRemoteMethod(method: string): boolean {
  return method === "GET" || method === "PUT" || method === "DELETE";
}

function isTransientHttpRemoteError(error: unknown): boolean {
  return /\b(?:fetch failed|socket hang up|network error|terminated|timeout|TimeoutError|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|EPIPE|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT)\b/iu
    .test(httpRemoteErrorMessage(error));
}

function httpRemoteTransportError(error: unknown, apiPath: string): WorkbenchCodedError {
  const message = publicRuntimeErrorSummary(httpRemoteErrorMessage(error));
  return new WorkbenchCodedError("remote_unavailable", `Workbench Cloud remote request failed: ${message}`, {
    retryable: true,
    subject: { path: apiPath },
    exitCode: 1,
  });
}

function httpRemoteErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown transport error");
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

function normalizeWorkbenchCloudError(error: {
  code: string;
  message: string;
  retryable: boolean;
  remediation?: string;
  subject?: Record<string, Json>;
}): {
  code: string;
  message: string;
  retryable: boolean;
  remediation?: string;
  subject?: Record<string, Json>;
} {
  if (
    error.code === "validation_failed" &&
    error.subject?.visibility === "internal" &&
    /\b(?:internal|team) source visibility requires an organization-owned skill\b/iu.test(error.message)
  ) {
    const remediation = cloudCommandRemediationOrUndefined(error.remediation);
    const { remediation: _staleRemediation, ...rest } = error;
    return {
      ...rest,
      message: "Team source visibility requires an organization-owned skill.",
      ...(remediation ? { remediation } : {}),
      subject: { ...error.subject, visibility: "team" },
    };
  }
  const remediation = cloudCommandRemediationOrUndefined(error.remediation);
  if (remediation === error.remediation) {
    return error;
  }
  const { remediation: _staleRemediation, ...rest } = error;
  return {
    ...rest,
    ...(remediation ? { remediation } : {}),
  };
}

function cloudCommandRemediationOrUndefined(remediation: string | undefined): string | undefined {
  const trimmed = remediation?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!/^(?:workbench|codex|claude|npm|mkdir)\b/u.test(trimmed) && !/^[A-Z_][A-Z0-9_]*=.*\bworkbench\b/u.test(trimmed)) {
    return undefined;
  }
  return trimmed;
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
  await writeJsonl(path.join(root, "indexes", "measurements.jsonl"), runMeasurementSummaries(pack.runs, pack.jobs));
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
  const entries = await fs.readdir(dir).catch((error: unknown) => {
    if (fileErrorCode(error) === "ENOENT") {
      return [];
    }
    throw error;
  });
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
    await removeStateTree(backup);
    return;
  }
  if (!hasTarget && hasBackup) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await restoreStateBackupDirectory(target, backup);
  }
}

async function restoreStateBackupDirectory(target: string, backup: string): Promise<void> {
  try {
    await fs.rename(backup, target);
  } catch (error) {
    const code = fileErrorCode(error);
    if ((code === "ENOTEMPTY" || code === "EEXIST" || code === "ENOENT") && await exists(target)) {
      await removeStateTree(backup);
      return;
    }
    throw error;
  }
}

async function replaceStateDirectory(target: string, next: string, backup: string): Promise<void> {
  await removeStateTree(backup);
  if (await exists(target)) {
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.rename(target, backup);
  }
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(next, target);
    await removeStateTree(backup);
  } catch (error) {
    if (!await exists(target) && await exists(backup)) {
      await fs.rename(backup, target);
    }
    throw error;
  }
}

async function removeStateTree(target: string): Promise<void> {
  await fs.rm(target, STATE_TREE_RM_OPTIONS);
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
      remediation: "workbench publish",
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
        remediation: `Update .workbench/remotes.yaml so ${remoteName} points at ${parsedUrl.url}.`,
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
        remediation: "workbench publish",
        exitCode: 2,
      });
    }
    throw new WorkbenchCodedError("remote_required", "Multiple remotes are configured and none is named origin; name the remote to use.", {
      remediation: "workbench status",
      subject: { remotes: remotes.map((entry) => entry.name) },
      exitCode: 2,
    });
  }
  const remoteName = name;
  const remote = state.remotes[remoteName];
  if (!remote) {
    throw new WorkbenchCodedError("remote_not_found", `Remote not found: ${remoteName}`, {
      remediation: "workbench status",
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
    throw new WorkbenchCodedError("version_not_found", `Version not found: ${ref}. Configured versions: ${configuredVersionRefs(state)}.`, {
      remediation: "workbench log --versions",
      subject: { ref },
      exitCode: 1,
    });
  }
  return version;
}

function findVersion(state: WorkbenchProjectState, ref: string): WorkbenchVersion | undefined {
  const normalized = ref.trim();
  const mapped = normalized === "current" ? state.refs.current : state.refs[normalized] ?? normalized;
  if (!mapped) {
    return undefined;
  }
  const candidates = uniqueById(state.versions.filter((version) => versionRefMatches(version, mapped)));
  if (candidates.length > 1) {
    throw new WorkbenchCodedError("ref_ambiguous", `Version ref is ambiguous: ${ref}. Candidates: ${candidates.map(versionDisplayCandidate).join(", ")}.`, {
      subject: { ref, candidates: candidates.map((version) => version.id) },
      exitCode: 2,
    });
  }
  return candidates[0];
}

function findVersionById(state: WorkbenchProjectState, id: string | undefined): WorkbenchVersion | undefined {
  return id ? state.versions.find((version) => version.id === id) : undefined;
}

function versionRefMatches(version: WorkbenchVersion, ref: string): boolean {
  const normalized = ref.trim();
  const withoutVersionPrefix = normalized.startsWith("v_") ? normalized.slice(2) : normalized;
  return version.id === normalized ||
    version.hash === normalized ||
    version.id.startsWith(normalized) ||
    version.hash.startsWith(normalized) ||
    version.hash.startsWith(withoutVersionPrefix) ||
    version.id.startsWith(`v_${withoutVersionPrefix}`);
}

function configuredVersionRefs(state: WorkbenchProjectState): string {
  const refs = state.versions
    .slice(-8)
    .map(versionDisplayCandidate)
    .sort();
  return refs.length > 0 ? refs.join(", ") : "none";
}

function versionDisplayCandidate(version: WorkbenchVersion): string {
  return version.hash.slice(0, 8);
}

function uniqueById<T extends { id: string }>(entries: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    unique.push(entry);
  }
  return unique;
}

function bestScoredComparableRun(args: {
  runs: readonly WorkbenchRun[];
  jobs: readonly WorkbenchJob[];
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
}): WorkbenchRun | undefined {
  const evidence = bestScoredComparableEvidence(args);
  if (!evidence) {
    return undefined;
  }
  const run = args.runs.find((entry) => entry.id === evidence.runId);
  return run ? {
    ...run,
    ...(evidence.samples !== undefined ? { requestedSamples: evidence.samples } : {}),
    ...(evidence.costUsd !== undefined ? { costUsd: evidence.costUsd } : {}),
    ...(evidence.latencyMs !== undefined ? { latencyMs: evidence.latencyMs } : {}),
    ...(evidence.error ? { error: evidence.error } : {}),
  } : undefined;
}

type InternalComparisonEvidence = {
  runId: string;
  status: WorkbenchRun["status"];
  createdAt: string;
  score?: number;
  samples?: number;
  costUsd?: number;
  latencyMs?: number;
  error?: string;
};

function bestComparableEvidence(args: {
  runs: readonly WorkbenchRun[];
  jobs: readonly WorkbenchJob[];
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
}): InternalComparisonEvidence | undefined {
  const measurements = matchingComparisonMeasurements(args);
  const terminalMeasurements = measurements.filter((measurement) => isTerminalRunStatus(measurement.status));
  if (terminalMeasurements.length > 0) {
    return terminalMeasurements.sort((left, right) =>
      (right.samples ?? 0) - (left.samples ?? 0) ||
      right.createdAt.localeCompare(left.createdAt)
    )[0];
  }
  return measurements.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function bestScoredComparableEvidence(args: {
  runs: readonly WorkbenchRun[];
  jobs: readonly WorkbenchJob[];
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
}): (InternalComparisonEvidence & { score: number }) | undefined {
  return matchingComparisonMeasurements(args)
    .filter((measurement): measurement is InternalComparisonEvidence & { score: number } =>
      measurement.status === "succeeded" &&
      typeof measurement.score === "number"
    )
    .sort((left, right) =>
      (right.samples ?? 0) - (left.samples ?? 0) ||
      right.createdAt.localeCompare(left.createdAt)
    )[0];
}

function matchingComparisonMeasurements(args: {
  runs: readonly WorkbenchRun[];
  jobs: readonly WorkbenchJob[];
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
}): InternalComparisonEvidence[] {
  const runsById = new Map(args.runs.map((run) => [run.id, run]));
  const runJobsByRunId = new Map<string, WorkbenchJob[]>();
  const matchingJobsByRunId = new Map<string, WorkbenchJob[]>();
  for (const job of args.jobs) {
    const runJobs = runJobsByRunId.get(job.runId) ?? [];
    runJobs.push(job);
    runJobsByRunId.set(job.runId, runJobs);
    if (
      job.caseId !== "current" &&
      job.versionId === args.versionId &&
      job.skillName === args.skillName &&
      job.skillBundleHash === args.skillBundleHash &&
      job.evalHash === args.evalHash &&
      job.agentName === args.agentName &&
      job.agentHash === args.agentHash
    ) {
      const matching = matchingJobsByRunId.get(job.runId) ?? [];
      matching.push(job);
      matchingJobsByRunId.set(job.runId, matching);
    }
  }
  const measurements: InternalComparisonEvidence[] = [];
  for (const [runId, jobs] of matchingJobsByRunId) {
    const run = runsById.get(runId);
    if (!run) {
      continue;
    }
    measurements.push(comparisonEvidenceFromJobs(run, jobs, runJobsByRunId.get(runId) ?? []));
  }
  const measuredRunIds = new Set(measurements.map((measurement) => measurement.runId));
  for (const run of matchingRuns(args)) {
    if (!measuredRunIds.has(run.id)) {
      measurements.push(comparisonEvidenceFromRun(run, args.jobs));
    }
  }
  return measurements;
}

function matchingRuns(args: {
  runs: readonly WorkbenchRun[];
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
}): WorkbenchRun[] {
  return args.runs.filter((run) =>
    run.versionId === args.versionId &&
    run.skillName === args.skillName &&
    run.skillBundleHash === args.skillBundleHash &&
    run.evalHash === args.evalHash &&
    run.agentName === args.agentName &&
    run.agentHash === args.agentHash
  );
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
  return matchingRuns(args)
    .filter(predicate)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function comparisonRunSamples(run: WorkbenchRun, jobs: readonly WorkbenchJob[]): number {
  const runJobs = jobs.filter((job) => runOwnsJob(run, job) && job.caseId !== "current");
  if (runJobs.length > 0) {
    return new Set(runJobs.map((job) => `${job.caseId}\0${job.sample}`)).size;
  }
  return run.jobIds?.length ?? 0;
}

function comparisonEntryKey(
  versionId: string,
  skillName: string,
  skillBundleHash: string,
  evalHash: string,
): string {
  return `${versionId}\0${skillName}\0${skillBundleHash}\0${evalHash}`;
}

function comparisonEvidenceFromRun(run: WorkbenchRun, jobs: readonly WorkbenchJob[]): InternalComparisonEvidence {
  const samples = comparisonRunSamples(run, jobs);
  const latencyMs = run.latencyMs !== undefined && samples > 1
    ? Math.round(run.latencyMs / samples)
    : run.latencyMs;
  const score = runQualityScoreFromJobs(run, jobs);
  return {
    runId: run.id,
    status: run.status,
    createdAt: run.createdAt,
    ...(score !== undefined ? { score } : {}),
    ...(samples > 0 ? { samples } : {}),
    ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

function comparisonEvidenceFromJobs(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
  allRunJobs: readonly WorkbenchJob[],
): InternalComparisonEvidence {
  const scoredJobs = jobs.filter((job) => jobQualityScore(job) !== undefined);
  const samples = new Set(jobs.map((job) => `${job.caseId}\0${job.sample}`)).size;
  const latencyMs = jobs.some((job) => job.durationMs !== undefined)
    ? Math.round(jobs.reduce((sum, job) => sum + (job.durationMs ?? 0), 0) / Math.max(1, samples))
    : undefined;
  const errors = jobs.flatMap((job) => job.error ? [job.error] : []);
  const everyRunJobMatches = allRunJobs.filter((job) => job.caseId !== "current").every((job) => jobs.some((entry) => entry.id === job.id));
  const status = comparisonJobStatus(jobs, run.status);
  const score = status === "canceled" || scoredJobs.length === 0
    ? undefined
    : averageScores(scoredJobs.map(jobQualityScore));
  return {
    runId: run.id,
    status,
    createdAt: run.createdAt,
    ...(score !== undefined ? { score } : {}),
    ...(samples > 0 ? { samples } : {}),
    ...(everyRunJobMatches && run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    ...(errors.length > 0 ? { error: summarizeJobErrors(errors) } : run.error && everyRunJobMatches ? { error: run.error } : {}),
  };
}

function comparisonJobStatus(jobs: readonly WorkbenchJob[], fallback: WorkbenchRun["status"]): WorkbenchRun["status"] {
  if (jobs.length === 0) {
    return fallback;
  }
  if (jobs.some((job) => job.status === "running")) {
    return "running";
  }
  if (jobs.some((job) => job.status === "queued")) {
    return "queued";
  }
  if (fallback === "canceled" && jobs.some((job) => job.status === "canceled")) {
    return "canceled";
  }
  if (jobs.some((job) => job.status === "failed")) {
    return "failed";
  }
  if (jobs.some((job) => job.status === "canceled")) {
    return "canceled";
  }
  return "succeeded";
}

function comparisonCellEvidenceFields(
  evidence: InternalComparisonEvidence,
): Pick<InternalComparisonCell, "runId" | "status" | "score" | "samples" | "costUsd" | "latencyMs" | "error"> {
  const { createdAt: _createdAt, ...fields } = evidence;
  return fields;
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
  options: {
    availableAgents?: readonly WorkbenchAgent[];
    defaultAgent?: string;
  } = {},
): WorkbenchAgentSnapshot[] {
  const manifest = options.availableAgents ? null : readVersionAgentManifestIfValid(version);
  const selected = comparisonAgentSelection(selection, options.defaultAgent ?? manifest?.defaultAgent);
  const agents = new Map<string, WorkbenchAgentSnapshot>();

  for (const run of state.runs) {
    if (run.versionId !== version.id) {
      continue;
    }
    if (!comparisonAgentSelectionIncludes(selected, run.agentName, run.agentHash)) {
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

  for (const job of state.jobs) {
    if (job.versionId !== version.id || job.caseId === "current") {
      continue;
    }
    if (!comparisonAgentSelectionIncludes(selected, job.agentName, job.agentHash)) {
      continue;
    }
    if (agents.has(job.agentHash)) {
      continue;
    }
    agents.set(job.agentHash, {
      hash: job.agentHash,
      agent: {
        name: job.agentName,
        adapter: "recorded",
        config: {},
      },
    });
  }

  try {
    for (const agent of options.availableAgents ?? manifest?.agents ?? readVersionAgents(version)) {
      const snapshot = agentSnapshot(agent);
      if (!comparisonAgentSelectionIncludes(selected, agent.name, snapshot.hash)) {
        continue;
      }
      agents.set(snapshot.hash, snapshot);
    }
  } catch (error) {
    if (agents.size > 0) {
      return sortComparisonAgentSnapshots([...agents.values()]);
    }
    throw error;
  }

  if (agents.size === 0) {
    for (const agent of state.agents) {
      const snapshot = agentSnapshot(agent);
      if (!comparisonAgentSelectionIncludes(selected, agent.name, snapshot.hash)) {
        continue;
      }
      agents.set(snapshot.hash, snapshot);
    }
  }

  return sortComparisonAgentSnapshots([...agents.values()]);
}

function sortComparisonAgentSnapshots(agents: WorkbenchAgentSnapshot[]): WorkbenchAgentSnapshot[] {
  return agents.sort((left, right) =>
    left.agent.name.localeCompare(right.agent.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }) || left.hash.localeCompare(right.hash)
  );
}

type ComparisonAgentSelection = Set<string> | null;

function comparisonAgentSelection(
  selection: string | undefined,
  defaultAgent: string | undefined,
): ComparisonAgentSelection {
  const trimmed = selection?.trim();
  const configured = trimmed || defaultAgent || ALL_SELECTOR;
  if (configured === ALL_SELECTOR) {
    return null;
  }
  return new Set(configured.split(",").map((part) => part.trim()).filter(Boolean));
}

function comparisonAgentSelectionIncludes(
  selection: ComparisonAgentSelection,
  agentName: string,
  agentHash: string,
): boolean {
  return selection === null || selection.has(agentName) || selection.has(agentHash);
}

function readVersionAgentManifestIfValid(
  version: WorkbenchVersion,
): { agents: WorkbenchAgent[]; defaultAgent: string } | null {
  try {
    const manifest = readVersionAgentManifest(version);
    return manifest.agents.length > 0 ? manifest : null;
  } catch {
    return null;
  }
}

function readVersionAgentManifest(version: WorkbenchVersion): { agents: WorkbenchAgent[]; defaultAgent: string } {
  const agentFile = version.files.find((file) =>
    normalizeRelativePath(file.path) === `${WORKBENCH_DIR}/${AGENTS_FILE}` &&
    file.encoding === "utf8"
  );
  if (!agentFile) {
    return { agents: [], defaultAgent: ALL_SELECTOR };
  }
  const fileLabel = `${version.id}:${WORKBENCH_DIR}/${AGENTS_FILE}`;
  const record = parseYamlRecord(agentFile.content);
  const agents = parseAgentsYaml(agentFile.content, fileLabel);
  return {
    agents,
    defaultAgent: readManifestDefaultSelection(record, fileLabel, agents, "agent"),
  };
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
      run.status !== "queued" &&
      completedEvalEvidenceForRun(run, args.state.jobs, expectedJobs) &&
      run.jobIds?.every((jobId) => {
        const job = args.state.jobs.find((entry) => entry.id === jobId);
        return job !== undefined &&
          runOwnsJob(run, job) &&
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

function latestReusableEvalMatrixRun(args: {
  state: WorkbenchProjectState;
  versionId: string;
  evalHash: string;
  targets: readonly WorkbenchEvaluationRunTarget[];
  samples: number;
  caseCount: number;
}): WorkbenchRun | undefined {
  const targetKeys = new Set(args.targets.map((target) => comparisonTargetKey({
    versionId: args.versionId,
    skillName: target.skillBundle.skillName,
    skillBundleHash: target.skillBundle.hash,
    evalHash: args.evalHash,
    agentName: target.agent.name,
    agentHash: hashJson(target.agent),
  })));
  const expectedJobs = args.caseCount * Math.max(1, Math.floor(args.samples)) * targetKeys.size;
  if (expectedJobs <= 0 || targetKeys.size === 0) {
    return undefined;
  }
  const primaryTarget = args.targets[0];
  if (!primaryTarget) {
    return undefined;
  }
  const expectedSkills = uniqueStrings(args.targets.map((target) => target.skillBundle.skillName)).sort();
  const expectedAgents = uniqueStrings(args.targets.map((target) => target.agent.name)).sort();
  return args.state.runs
    .filter((run) => {
      if (
        run.kind !== "eval" ||
        run.parentRunId ||
        run.versionId !== args.versionId ||
        run.evalHash !== args.evalHash ||
        run.skillName !== primaryTarget.skillBundle.skillName ||
        run.skillBundleHash !== primaryTarget.skillBundle.hash ||
        run.agentName !== primaryTarget.agent.name ||
        run.agentHash !== hashJson(primaryTarget.agent) ||
        run.status === "running" ||
        run.status === "queued" ||
        !completedEvalEvidenceForRun(run, args.state.jobs, expectedJobs) ||
        run.operationPlan?.samples !== Math.max(1, Math.floor(args.samples))
      ) {
        return false;
      }
      const planSkills = [...(run.operationPlan?.skills ?? [run.skillName])].sort();
      const planAgents = [...(run.operationPlan?.agents ?? [run.agentName])].sort();
      if (!sameStringArray(planSkills, expectedSkills) || !sameStringArray(planAgents, expectedAgents)) {
        return false;
      }
      return run.jobIds?.every((jobId) => {
        const job = args.state.jobs.find((entry) => entry.id === jobId);
        return job !== undefined && runOwnsJob(run, job) && targetKeys.has(comparisonTargetKey(job));
      }) === true;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function completedEvalEvidenceForRun(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
  expectedSamples: number,
): boolean {
  const runJobIds = new Set(run.jobIds ?? []);
  const runJobs = jobs.filter((job) => runOwnsJob(run, job) && runJobIds.has(job.id) && job.caseId !== "current");
  const executeJobs = runJobs.filter((job) => job.role !== "grade");
  const gradeJobs = runJobs.filter((job) => job.role === "grade");
  return executeJobs.length === expectedSamples &&
    gradeJobs.length === expectedSamples &&
    executeJobs.every((job) => job.status === "succeeded") &&
    gradeJobs.every((job) => job.status === "succeeded" && jobQualityScore(job) !== undefined);
}

function comparisonTargetKey(args: {
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
}): string {
  return [
    args.versionId,
    args.skillName,
    args.skillBundleHash,
    args.evalHash,
    args.agentName,
    args.agentHash,
  ].join("\0");
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function improvementPromotionDecision(
  run: WorkbenchRun,
  incumbentRun: WorkbenchRun | undefined,
  jobs: readonly WorkbenchJob[],
): { promoted: boolean; reason: string } {
  if (run.status !== "succeeded") {
    return {
      promoted: false,
      reason: `Candidate run ${run.id} finished ${run.status}.`,
    };
  }
  const score = runQualityScoreFromJobs(run, jobs);
  if (score === undefined) {
    return {
      promoted: false,
      reason: `Candidate run ${run.id} has no scored eval evidence.`,
    };
  }
  const incumbentScore = incumbentRun ? runQualityScoreFromJobs(incumbentRun, jobs) : undefined;
  if (!incumbentRun || incumbentScore === undefined) {
    return {
      promoted: true,
      reason: `Improved run ${run.id} succeeded with score ${score.toFixed(3)} and no scored incumbent existed.`,
    };
  }
  if (score <= incumbentScore) {
    return {
      promoted: false,
      reason: `Candidate run ${run.id} score ${score.toFixed(3)} did not beat incumbent ${incumbentRun.id} score ${incumbentScore.toFixed(3)}.`,
    };
  }
  return {
    promoted: true,
    reason: `Improved run ${run.id} score ${score.toFixed(3)} beat incumbent ${incumbentRun.id} score ${incumbentScore.toFixed(3)}.`,
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

function installableCurrentSkillFiles(
  files: readonly SurfaceSnapshotFile[],
  currentSource: WorkbenchSkillSource,
  sources: readonly WorkbenchSkillSource[],
): SurfaceSnapshotFile[] {
  const excludedLocalSourcePaths = sources
    .filter((source) =>
      source.name !== currentSource.name &&
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

export function createWorkbenchRunId(): string {
  return nextRunId();
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

function upsertRunObject(
  records: WorkbenchRun[],
  run: WorkbenchRun,
  options: { replace?: boolean } = {},
): void {
  const index = records.findIndex((entry) => entry.id === run.id);
  if (index < 0) {
    records.push(run);
    return;
  }
  if (options.replace === true) {
    records[index] = run;
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

function upsertJobObject(
  records: WorkbenchJob[],
  job: WorkbenchJob,
  options: { replace?: boolean } = {},
): void {
  const index = records.findIndex((entry) => entry.id === job.id);
  if (index < 0) {
    records.push(job);
    return;
  }
  if (options.replace === true) {
    records[index] = job;
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

function upsertExecutionEventBatch(
  records: WorkbenchExecutionEventBatch[],
  batch: WorkbenchExecutionEventBatch,
  options: { replace?: boolean } = {},
): void {
  const id = workbenchExecutionEventBatchId(batch);
  const index = records.findIndex((entry) => workbenchExecutionEventBatchId(entry) === id);
  if (index < 0) {
    records.push(batch);
    return;
  }
  if (options.replace === true) {
    records[index] = batch;
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
  return status === "succeeded" || status === "failed" || status === "canceled";
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
  const preserveCanceling = existing.status === "canceling" && !isTerminalRunStatus(incoming.status);
  return {
    ...existing,
    ...incoming,
    status: preserveCanceling ? "canceling" : incoming.status,
    ...(preserveCanceling && existing.cancelRequestedAt ? { cancelRequestedAt: existing.cancelRequestedAt } : {}),
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
    throw new WorkbenchUserError("Workbench is not initialized here. Run `workbench new` first.");
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
    ...(typeof record.localHash === "string" ? { localHash: record.localHash } : {}),
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
    `/${LIVE_DIR}/`,
    `/${CANCEL_DIR}/`,
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

async function applyLocalHostedRunHandles(
  root: string,
  state: WorkbenchProjectState,
): Promise<WorkbenchProjectState> {
  const handles = await readLocalHostedRunHandles(root);
  if (handles.length === 0) {
    return state;
  }
  const existing = new Set(state.runs.map((run) => run.id));
  const runs = [...state.runs];
  for (const run of handles) {
    if (existing.has(run.id)) {
      continue;
    }
    existing.add(run.id);
    runs.push(run);
  }
  return { ...state, runs };
}

async function readLocalHostedRunHandles(root: string): Promise<WorkbenchRun[]> {
  const dir = localHostedRunHandlesDir(root);
  if (!await exists(dir)) {
    return [];
  }
  const runs: WorkbenchRun[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const value = await readJson(path.join(dir, entry.name)).catch(() => null);
    try {
      validateStateRun(value, runs.length);
      const run = copyRun(value as WorkbenchRun);
      if ((run.location ?? "local") === "cloud") {
        runs.push(run);
      }
    } catch {
      // Malformed live handles are ignored; durable state remains authoritative.
    }
  }
  return runs.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function localHostedRunHandlesDir(root: string): string {
  return path.join(workbenchDir(root), LIVE_DIR, "hosted-runs");
}

function localHostedRunHandlePath(root: string, runId: string): string {
  return path.join(localHostedRunHandlesDir(root), `${safeObjectFileName(runId)}.json`);
}

async function hasLocalRunCancellationRequest(root: string, runId: string): Promise<boolean> {
  try {
    await fs.stat(localRunCancellationRequestPath(root, runId));
    return true;
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function applyLocalRunCancellationRequests(
  root: string,
  state: WorkbenchProjectState,
): Promise<WorkbenchProjectState> {
  const requests = await readLocalRunCancellationRequests(root);
  if (requests.size === 0) {
    return state;
  }
  return {
    ...state,
    runs: state.runs.map((run) => {
      const requestedAt = requests.get(run.id);
      return requestedAt && !isTerminalRunStatus(run.status)
        ? runWithLocalCancellationRequest(run, requestedAt)
        : run;
    }),
  };
}

async function readLocalRunCancellationRequests(root: string): Promise<Map<string, string>> {
  const cancelRoot = path.join(workbenchDir(root), TMP_DIR, CANCEL_DIR);
  if (!await exists(cancelRoot)) {
    return new Map();
  }
  const requests = new Map<string, string>();
  for (const entry of await fs.readdir(cancelRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const record = asRecord(await readJson(path.join(cancelRoot, entry.name)).catch(() => null));
    if (
      record?.schema === "workbench.local.run-cancel-request.v1" &&
      typeof record.runId === "string" &&
      typeof record.requestedAt === "string"
    ) {
      requests.set(record.runId, record.requestedAt);
    }
  }
  return requests;
}

function localRunCancellationRequestPath(root: string, runId: string): string {
  return path.join(workbenchDir(root), TMP_DIR, CANCEL_DIR, `${safeObjectFileName(runId)}.json`);
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
  const cases = Array.isArray(evalSnapshot.cases)
    ? evalSnapshot.cases.map(copyEvalCase)
    : evalCaseSnapshotsFromEvalFiles(evalSnapshot.files);
  return {
    ...evalSnapshot,
    files: evalSnapshot.files.map(copyFile),
    cases,
  };
}

function copyEvalCase(evalCase: WorkbenchEvalCaseSnapshot): WorkbenchEvalCaseSnapshot {
  return {
    ...evalCase,
    files: evalCase.files.map(copyFile),
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
    ...(run.operationPlan ? { operationPlan: copyOperationPlanSummary(run.operationPlan) } : {}),
    ...(run.jobIds ? { jobIds: [...run.jobIds] } : {}),
    traceIds: [...run.traceIds],
  };
}

function copyJob(job: WorkbenchJob): WorkbenchJob {
  return {
    ...job,
    ...(job.adapter ? { adapter: { ...job.adapter } } : {}),
    ...(job.dependencies ? { dependencies: job.dependencies.map(copyJobDependency) } : {}),
    ...(job.result ? { result: copyJobResult(job.result) } : {}),
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
    evals: state.evals.map(copyEval),
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

function parseCaseSnapshotRecord(content: string): Record<string, unknown> {
  try {
    const parsed = content.trim() ? YAML.parse(content) : {};
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
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

function caseTitleFromRecord(record: Record<string, unknown>): string | undefined {
  if (typeof record.title === "string" && record.title.trim()) {
    return record.title.trim();
  }
  if (typeof record.name === "string" && record.name.trim()) {
    return record.name.trim();
  }
  return undefined;
}

function caseDescriptionFromRecord(record: Record<string, unknown>): string | undefined {
  if (typeof record.description === "string" && record.description.trim()) {
    return record.description.trim();
  }
  if (typeof record.prompt === "string" && record.prompt.trim()) {
    return record.prompt.trim();
  }
  return undefined;
}

function skillEvalCasePrompt(runtimeCase: WorkbenchEvalCaseRuntime): string {
  const record = parseCaseRecord(runtimeCase.content, runtimeCase.path || runtimeCase.id);
  if (typeof record.prompt === "string" && record.prompt.trim()) {
    return record.prompt.trim();
  }
  return runtimeCase.id;
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

function stripResultScores(result: Record<string, Json>): void {
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
  readStateArray<WorkbenchEvalCaseSnapshot>(record.cases, `evals[${index}].cases`, (entry, caseIndex) =>
    validateStateEvalCaseSnapshot(entry, index, caseIndex)
  );
  readRequiredNumber(record.caseCount, `evals[${index}].caseCount`);
  readRequiredString(record.createdAt, `evals[${index}].createdAt`);
  readRequiredString(record.updatedAt, `evals[${index}].updatedAt`);
  readRequiredString(record.gradeAdapter, `evals[${index}].gradeAdapter`);
}

function validateStateEvalCaseSnapshot(value: unknown, evalIndex: number, caseIndex: number): void {
  const pathLabel = `evals[${evalIndex}].cases[${caseIndex}]`;
  const record = readRequiredRecord(value, pathLabel);
  readRequiredString(record.id, `${pathLabel}.id`);
  readRequiredString(record.path, `${pathLabel}.path`);
  for (const key of ["title", "description", "command"]) {
    if (record[key] !== undefined) {
      readRequiredString(record[key], `${pathLabel}.${key}`);
    }
  }
  validateStateSurfaceFiles(record.files, `${pathLabel}.files`);
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
    throw new WorkbenchUserError(`Workbench state field runs[${index}].score is no longer supported; remove .workbench/objects and rerun.`);
  }
  if (record.costUsd !== undefined) {
    readRequiredNumber(record.costUsd, `runs[${index}].costUsd`);
  }
  if (record.latencyMs !== undefined) {
    readRequiredNumber(record.latencyMs, `runs[${index}].latencyMs`);
  }
  if (record.operationPlan !== undefined) {
    validateStateRunOperationPlan(record.operationPlan, `runs[${index}].operationPlan`);
  }
  if (record.jobIds !== undefined) {
    readStringArray(record.jobIds, `runs[${index}].jobIds`);
  }
  readStringArray(record.traceIds, `runs[${index}].traceIds`);
  for (const key of ["finishedAt", "parentRunId", "location", "remoteName", "baseVersionId", "retryOfRunId", "cancelRequestedAt", "lastProgressAt", "outputVersionId", "error"]) {
    if (record[key] !== undefined) {
      readRequiredString(record[key], `runs[${index}].${key}`);
    }
  }
  if (record.location !== undefined && record.location !== "local" && record.location !== "cloud") {
    throw new WorkbenchUserError(`Workbench state field runs[${index}].location must be local or cloud.`);
  }
  if (record.requestedSamples !== undefined) {
    readRequiredNumber(record.requestedSamples, `runs[${index}].requestedSamples`);
  }
  if (record.requestedBudget !== undefined) {
    readRequiredNumber(record.requestedBudget, `runs[${index}].requestedBudget`);
  }
}

function validateStateRunOperationPlan(value: unknown, pathLabel: string): void {
  const record = readRequiredRecord(value, pathLabel);
  readRequiredString(record.kind, `${pathLabel}.kind`);
  if (record.kind !== "run" && record.kind !== "grade" && record.kind !== "eval" && record.kind !== "improve") {
    throw new WorkbenchUserError(`Workbench state field ${pathLabel}.kind must be run, grade, eval, or improve.`);
  }
  readRequiredString(record.variant, `${pathLabel}.variant`);
  if (record.variant !== "local" && record.variant !== "cloud") {
    throw new WorkbenchUserError(`Workbench state field ${pathLabel}.variant must be local or cloud.`);
  }
  if (record.versionId !== undefined) {
    readRequiredString(record.versionId, `${pathLabel}.versionId`);
  }
  if (record.evalHash !== undefined) {
    readRequiredString(record.evalHash, `${pathLabel}.evalHash`);
  }
  readStringArray(record.skills, `${pathLabel}.skills`);
  readStringArray(record.agents, `${pathLabel}.agents`);
  if (record.caseIds !== undefined) {
    readStringArray(record.caseIds, `${pathLabel}.caseIds`);
  }
  if (record.samples !== undefined) {
    readRequiredNumber(record.samples, `${pathLabel}.samples`);
  }
  if (record.budget !== undefined) {
    readRequiredNumber(record.budget, `${pathLabel}.budget`);
  }
  if (record.rerun !== undefined && typeof record.rerun !== "boolean") {
    throw new WorkbenchUserError(`Workbench state field ${pathLabel}.rerun must be a boolean.`);
  }
  if (record.retryOfRunId !== undefined) {
    readRequiredString(record.retryOfRunId, `${pathLabel}.retryOfRunId`);
  }
}

function validateStateJob(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `jobs[${index}]`);
  for (const key of ["id", "runId", "kind", "versionId", "skillName", "skillBundleHash", "evalHash", "agentName", "agentHash", "caseId", "status", "createdAt"]) {
    readRequiredString(record[key], `jobs[${index}].${key}`);
  }
  readRequiredNumber(record.sample, `jobs[${index}].sample`);
  if (record.score !== undefined) {
    throw new WorkbenchUserError(`Workbench state field jobs[${index}].score is no longer supported; remove .workbench/objects and rerun.`);
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
