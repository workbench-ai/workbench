import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";
import type {
  AuthoredWorkbenchCaseSummary,
  AuthoredWorkbenchSourceSpec,
  AuthoredWorkbenchSourceDocument,
  CandidateCaseExecutionRef,
  CandidateCaseReview,
  CandidateFilePreview,
  CandidateFileSummary,
  CandidateLineageEdge,
  CandidateLineageGraph,
  CandidateLineageNode,
  CandidateRecord,
  CandidateSummary,
  EvalCaseStatus,
  EvalCaseResult,
  EngineResolveBinding,
  EvaluationRecord,
  EvaluationScorecard,
  EvaluationSampleRecord,
  HostedWorkbenchEnvironment,
  HostedWorkbenchEnvironmentVersion,
  HostedWorkbenchFileInput,
  HostedWorkbenchJob,
  Json,
  MetricStats,
  RunSummary,
  SurfaceSnapshotFile,
  UsageSummary,
  WorkbenchRuntimeBundle,
  WorkbenchRuntimeBundleStats,
  WorkbenchProjectSourceResources,
  WorkbenchProjectState,
  WorkbenchProjectStateBase,
  WorkbenchProjectStateImportResult,
  WorkbenchProjectStateRemote,
  WorkbenchProjectStateSource,
  WorkbenchCandidatePatch,
  WorkbenchAdapterInvocation,
  WorkbenchExecutionCapability,
  WorkbenchExecutionResult,
  WorkbenchExecutionSpec,
  WorkbenchSandboxExecutionMetadata,
  WorkbenchResult,
} from "@workbench-ai/workbench-contract";
import {
  adapterCommandName,
  assertWorkbenchAdapterOperationResultOk,
  collectWorkbenchAdapterAuthRequirements,
  collectWorkbenchAdapterInvocations,
  parseWorkbenchAdapterManifest,
  readWorkbenchAdapterOperationResult,
  WORKBENCH_ADAPTER_RESULT_FILE,
  WORKBENCH_RUNTIME_CONTROL_TOKEN_ENV,
  WORKBENCH_RUNTIME_CONTROL_URL_ENV,
  workbenchAdapterOperationCommand,
  workbenchAdapterOperationExecutor,
  workbenchAdapterOperationResultPath,
  type WorkbenchAdapterOperation,
  type WorkbenchAdapterOperationExecutor,
  type WorkbenchAdapterOperationResult,
  type WorkbenchAdapterManifest,
  type WorkbenchRuntimeControlOperation,
  type WorkbenchRuntimeControlOperationSequenceRequest,
  type WorkbenchRuntimeControlOperationSequenceResult,
} from "@workbench-ai/workbench-protocol";
import {
  BENCHMARK_SPEC_FILE,
  CANDIDATE_SPEC_FILE,
  DEFAULT_EXECUTION_RESOURCES,
  engineCasePrivateFiles,
  engineCaseFilesForRuntimeInput,
  engineCasePublicFiles,
  resolveEngineCaseExecutionConfig,
  resolveWorkbenchResolvedSourceYaml as resolveWorkbenchResolvedSourceYamlInternal,
  validateWorkbenchResolvedSourceYaml as validateWorkbenchResolvedSourceYamlInternal,
  isWorkbenchCandidateManifestPath,
  type GenericEngineCaseSpec,
  type GenericRunSpec,
  type WorkbenchCaseSelector,
  type WorkbenchEngineCase,
} from "./generic-spec.ts";
import {
  attachSandboxMetadataToJob,
  createWorkbenchSandboxFileStore,
  isSurfaceSnapshotFile,
  readWorkbenchExecutionSpec,
} from "./sandbox-inputs.ts";
import type {
  WorkbenchExecutionRuntimeInput,
  WorkbenchWorkloadStepCommand,
} from "./execution-runtime-types.ts";
import {
  asRuntimeRecord,
  importNodeModule,
  isJsonPayload,
  jsonRecord,
  nodeBuiltin,
  numberValue,
  normalizeRuntimeRegistry,
  quoteShellArg,
  resolveDockerRuntimeImageRef,
  resolveWorkbenchWorkerId,
  stringValue,
} from "./runtime-utils.ts";
import {
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
import {
  createSandboxBackendPlaneForProvider,
  type WorkbenchSandboxProviderName,
} from "./sandbox-backends/index.ts";
import { applyWorkbenchCandidatePatch } from "./candidate-patch.ts";
import {
  assignUsageRole,
  completeUsageSummary,
  mergeUsageSummaries,
  normalizeUsageSummary,
  usageStats,
} from "./execution-usage.ts";
import {
  readOutputTraceFiles,
  traceFilePaths,
  workbenchTraceExecutionDirectory,
} from "./trace-files.ts";
import {
  engineCaseForCase,
} from "./execution-jobs.ts";
import {
  createWorkbenchExecutionEventPublisher,
  publishCommandStepEvent,
  type WorkbenchExecutionEventPublisher,
} from "./execution-events.ts";
import { readWorkbenchExecutionPurpose } from "./execution-evidence.ts";
import { validateWorkbenchExecutionOutputPayloads } from "./execution-outputs.ts";
import {
  adapterAuthEnv,
  localWorkbenchAdapterAuthStore,
  normalizeWorkbenchAdapterAuthTarget,
  sanitizeWorkbenchAdapterAuthBundle,
  type WorkbenchAdapterAuthBundle,
  type WorkbenchAdapterAuthTarget,
} from "./adapter-auth.ts";

export {
  BENCHMARK_SPEC_FILE,
  CANDIDATE_SPEC_FILE,
  DEFAULT_EXECUTION_RESOURCES,
  engineCasePrivateFiles,
  engineCaseFilesForRuntimeInput,
  engineCasePublicFiles,
  engineResolveInvocationForSpec,
  engineResolveBindingForSpec,
  engineResolveBindingForSourceYaml,
  isWorkbenchCandidateManifestPath,
  parseWorkbenchSourceFiles,
  resolveEngineCaseExecutionConfig,
  resolveWorkbenchResolvedSourceYaml,
  resolveWorkbenchSourceFiles,
  runtimeNetwork,
  runtimeResources,
  serializeWorkbenchResolvedSourceYaml,
  validateWorkbenchResolvedSourceYaml,
  type AuthoredBenchmarkSpec,
  type WorkbenchCandidateImproveSpec,
  type WorkbenchCandidateManifestSpec,
  type WorkbenchCandidateRunSpec,
  type WorkbenchCaseSelector,
  type WorkbenchSelectionSpec,
  type GenericRunSpec,
  type GenericEngineCaseSpec,
  type WorkbenchEngineCase,
  type WorkbenchResolvedSource,
} from "./generic-spec.ts";
export {
  composeRuntimeDockerfileWithAdapterInstallers,
  type WorkbenchRuntimeAdapterInstaller,
  type WorkbenchRuntimeAdapterInstallerFile,
} from "./runtime-dockerfile.ts";
export {
  adapterCommandName,
  cloneWorkbenchAdapterManifest,
  collectWorkbenchAdapterAuthRequirements,
  collectWorkbenchAdapterInvocations,
  parseWorkbenchAdapterManifest,
  workbenchAdapterManifestRequiresAuth,
  workbenchAdapterManifestSupportsOperation,
  workbenchAdapterOperationCommand,
  workbenchAdapterOperationExecutor,
  withDefaultWorkbenchAdapterAuth,
  withDefaultWorkbenchAdapterAuthProfiles,
  type WorkbenchPrimitiveAdapterOperation,
  type WorkbenchAdapterOperation,
  type WorkbenchAdapterOperationExecutor,
  type WorkbenchAdapterOperationManifest,
  type WorkbenchAdapterSlotManifest,
  type WorkbenchAdapterAuthRequirement,
  type WorkbenchAdapterAuthManifest,
  type WorkbenchAdapterAuthMethodManifest,
  type WorkbenchAdapterInvocationLike,
  type WorkbenchAdapterManifest,
} from "@workbench-ai/workbench-protocol";
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
export type {
  WorkbenchExecutionRuntimeInput,
  WorkbenchWorkloadStepCommand,
} from "./execution-runtime-types.ts";
export {
  asRuntimeRecord,
  importNodeModule,
  nodeBuiltin,
  normalizeWorkbenchWorkerId,
  normalizeRuntimeRegistry,
  quoteShellArg,
  resolveDockerRuntimeImageRef,
  resolveWorkbenchWorkerId,
} from "./runtime-utils.ts";
export {
  assignUsageRole,
  extractExecutionUsageFromTrace,
  mergeUsageSummaries,
} from "./execution-usage.ts";
export {
  createWorkbenchProgressStdoutParser,
  publishWorkbenchProgressStdoutEnvelope,
} from "./execution-events.ts";
export {
  persistWorkbenchAdapterAuthUpdates,
} from "./adapter-auth-updates.ts";
export {
  resolveSandboxTemplateImage,
} from "./sandbox-backends/template-images.ts";
export {
  readOutputTraceFiles,
  workbenchTraceExecutionDirectory,
  workbenchTraceRunDirectory,
  workbenchTraceRunDirectoryName,
} from "./trace-files.ts";
export {
  assertWorkbenchAdapterOperationSupport,
  assertWorkbenchAdapterOperationResultOk,
  collectWorkbenchAdapterOperationIssues,
  collectWorkbenchAdapterOperationRequirements,
  ensureWorkbenchAdapterOutputDir,
  WORKBENCH_ADAPTER_RESULT_FILE,
  normalizeWorkbenchAdapterOperationRequest,
  normalizeWorkbenchAdapterOperationResult,
  readWorkbenchAdapterOperationRequest,
  readWorkbenchAdapterOperationResult,
  workbenchAdapterOperationResultPath,
  writeWorkbenchAdapterOperationResult,
  type WorkbenchAdapterOperationRequest,
  type WorkbenchAdapterOperationResult,
  type WorkbenchAdapterOperationResultValue,
  type WorkbenchAdapterOperationRequirement,
  type WorkbenchEngineResolveResult,
  type WorkbenchEngineCaseSpec,
} from "@workbench-ai/workbench-protocol";
export {
  applyWorkbenchCandidatePatch,
  type ApplyWorkbenchCandidatePatchInput,
} from "./candidate-patch.ts";
export {
  createWorkbenchSandboxFileStore,
  createSandboxAdapterRequest,
  executionResultFromCompletedSandboxJob,
  materializeWorkbenchSandboxInput,
  readWorkbenchExecutionSpec,
  sanitizeWorkbenchExecutionJobForSandbox,
} from "./sandbox-inputs.ts";
export {
  compileWorkbenchExecutionGraph,
  type CompileExecutionGraphInput,
  type WorkbenchExecutionGraph,
  type WorkbenchExecutionGraphNode,
} from "./execution-graph.ts";
export {
  createBaselineCandidateExecution,
  createBaselineCandidateJob,
  createWorkbenchExecutionJob,
  expectedWorkbenchRunJobCount,
  engineCaseForCase,
  engineCaseIds,
  attemptJobCountForRunSpec,
  workbenchExecutionJobPurpose,
  MAX_WORKBENCH_RUN_BUDGET,
  planWorkbenchExecutionJobsForPurpose,
  validateWorkbenchRunEnvelope,
  workbenchExecutionJobId,
  type WorkbenchRunWorkflow,
} from "./execution-jobs.ts";
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
  assertWorkbenchExecutionIsolation,
  collectWorkbenchExecutionIsolationIssues,
  validateWorkbenchExecutionOutputPayloads,
  type WorkbenchExecutionOutputPayloads,
} from "./execution-outputs.ts";
export {
  collectSandboxAllocationScopeIssues,
  collectExecutionCapabilityScopeIssues,
  collectSandboxHandleScopeIssues,
  createWorkbenchSandboxAllocation,
  createWorkbenchSandboxExecutionMetadata,
  createWorkbenchExecutionCapability,
  executeValidatedSandboxExecution,
  type SandboxExecutionFileStore,
  type SandboxExecutionOptions,
  type SandboxBackendCapabilities,
  type SandboxBackendDescriptor,
  type SandboxCreateRequest,
  type SandboxEnvironmentImage,
  type SandboxExecRequest,
  type SandboxHandle,
  type SandboxMaterializedInput,
  type SandboxPlane,
  type ValidatedSandboxExecutionResult,
} from "./sandbox-plane.ts";
export {
  buildCandidateCaseExecutionRefs,
  buildWorkbenchExecutionEvidence,
  isWorkbenchExecutionActive,
  readWorkbenchExecutionId,
  readWorkbenchExecutionMetadataNumber,
  readWorkbenchExecutionMetadataString,
  readWorkbenchExecutionPurpose,
  resolveWorkbenchJobGroupStatus,
} from "./execution-evidence.ts";
export {
  buildWorkbenchTraceSessionsFromFiles,
  combineWorkbenchTraceSessions,
  finalizeWorkbenchExecutionTraceForJob,
  mergeWorkbenchExecutionTracesByJob,
  readWorkbenchExecutionTraceFiles,
  traceSessionLabel,
  type WorkbenchTraceMergeJob,
} from "./execution-traces.ts";
export {
  DOCKER_SANDBOX_BACKEND,
  assertSandboxHostHealthForProvider,
  createDockerSandboxBackendDescriptor,
  createDockerSandboxPlane,
  resolveWorkbenchSandboxProviderName,
  sandboxProviderAdmissionForResources,
  sandboxProviderDefaultMaxConcurrentJobs,
  sandboxProviderLeaseScope,
  sandboxHostHealthExpectationForProvider,
  type SandboxProviderAdmission,
  type SandboxProviderHostCost,
  type SandboxProviderLeaseRequest,
  type SandboxProviderRequestedResources,
  type SandboxHostHealthExpectation,
  type WorkbenchSandboxProviderName,
} from "./sandbox-backends/index.ts";
export type {
  WorkbenchExecutionEventPublisher,
  WorkbenchExecutionProgressTarget,
} from "./execution-events.ts";

export type {
  CandidateCaseReview,
  CandidateRecord,
  EngineResolveBinding,
  EvaluationScorecard,
  HostedWorkbenchJob,
  Json,
  RunSummary,
  RuntimeEvent,
  SurfaceSnapshotFile,
  WorkbenchRuntimeBundle,
  WorkbenchRuntimeBundleStats,
  WorkbenchRuntimeRun,
  WorkbenchRuntimeCandidateFiles,
  WorkbenchRuntimeExecutionFiles,
  WorkbenchRuntimeImportResult,
  WorkbenchProjectSourceResources,
  WorkbenchProjectState,
  WorkbenchProjectStateBase,
  WorkbenchProjectStateImportResult,
  WorkbenchProjectStateRemote,
  WorkbenchProjectStateSource,
  WorkbenchExecutionCapability,
  WorkbenchExecutionTrace,
  WorkbenchTraceSession,
  WorkbenchSandboxHandle,
  WorkbenchSandboxExecutionMetadata,
} from "@workbench-ai/workbench-contract";

export function sanitizeWorkbenchRuntimeJobForExchange(
  job: HostedWorkbenchJob,
): HostedWorkbenchJob {
  const {
    leaseUntil: _leaseUntil,
    wakeupLeaseUntil: _wakeupLeaseUntil,
    hostId: _hostId,
    workerId: _workerId,
    claimTokenHash: _claimTokenHash,
    trace: _trace,
    traceSessions: _traceSessions,
    ...portable
  } = job as HostedWorkbenchJob & {
    trace?: unknown;
    traceSessions?: unknown;
  };
  return { ...portable };
}

export function sanitizeWorkbenchRuntimeCandidateForExchange(
  candidate: CandidateRecord,
): CandidateRecord {
  const {
    ownerUserId: _ownerUserId,
    ownerUsername: _ownerUsername,
    metrics: _metrics,
    candidateRunId: _candidateRunId,
    candidateRunName: _candidateRunName,
    ...portable
  } = candidate as CandidateRecord & {
    metrics?: unknown;
    candidateRunId?: unknown;
    candidateRunName?: unknown;
  };
  return { ...portable };
}

export function workbenchRuntimeCandidateIdentityForExchange(
  candidate: CandidateRecord,
): {
  id: string;
  candidateFingerprint: string;
  baseId: string | null;
  referenceIds: string[];
} {
  return {
    id: candidate.id,
    candidateFingerprint: candidate.candidateFingerprint,
    baseId: candidate.baseId ?? null,
    referenceIds: [...candidate.referenceIds].sort(),
  };
}

export function mergeWorkbenchRuntimeCandidateForExchange(
  left: CandidateRecord,
  right: CandidateRecord,
): CandidateRecord {
  return {
    ...left,
    ...right,
    ...(right.eval ? { eval: right.eval } : left.eval ? { eval: left.eval } : {}),
    ...(right.prompt ? { prompt: right.prompt } : left.prompt ? { prompt: left.prompt } : {}),
    ...(right.meta !== undefined ? { meta: right.meta } : left.meta !== undefined ? { meta: left.meta } : {}),
    ...(right.usage ? { usage: right.usage } : left.usage ? { usage: left.usage } : {}),
    visibility: right.visibility ?? left.visibility,
  };
}

export interface WorkbenchBenchmarkContentFingerprintInput {
  sourceYaml: string;
  engineResolveFiles: readonly SurfaceSnapshotFile[];
  engineResolveBinding: EngineResolveBinding;
  adapterFiles?: readonly SurfaceSnapshotFile[];
  adapterManifests?: readonly WorkbenchAdapterManifest[];
  runtimeFiles?: readonly SurfaceSnapshotFile[];
  resources?: WorkbenchProjectSourceResources | null;
  network?: WorkbenchProjectStateSource["network"] | null;
}

export interface WorkbenchCandidateContentFingerprintInput {
  sourceYaml: string;
  candidateFiles: readonly SurfaceSnapshotFile[];
  adapterFiles?: readonly SurfaceSnapshotFile[];
  adapterManifests?: readonly WorkbenchAdapterManifest[];
}

export function workbenchBenchmarkContentFingerprint(
  input: WorkbenchBenchmarkContentFingerprintInput,
): string {
  const benchmarkSource = workbenchBenchmarkSourceYamlForFingerprint(input.sourceYaml);
  const resolvedSpec = resolveWorkbenchResolvedSourceYamlInternal(input.sourceYaml);
  const adapterManifests = input.adapterManifests ??
    adapterManifestsForContentFingerprint(input.adapterFiles ?? []);
  const benchmarkAdapterIds = new Set(
    collectWorkbenchAdapterInvocations([resolvedSpec.engineRun], adapterManifests)
      .map((invocation: { use: string }) => invocation.use),
  );
  const canonical = {
    sourceYaml: normalizeTextForProjectStateFingerprint(benchmarkSource.sourceYaml),
    engineResolveFiles: canonicalFilesForProjectStateFingerprint(input.engineResolveFiles),
    engineResolveBinding: canonicalEngineResolveBindingForFingerprint(input.engineResolveBinding),
    adapterFiles: canonicalFilesForProjectStateFingerprint(
      adapterFilesForContentFingerprint(
        input.adapterFiles ?? [],
        benchmarkSource.adapterSources,
        benchmarkAdapterIds,
      ),
    ),
    runtimeFiles: canonicalFilesForProjectStateFingerprint(input.runtimeFiles ?? []),
    resources: input.resources
      ? normalizeProjectStateResources(input.resources)
      : null,
    network: input.network ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function workbenchCandidateContentFingerprint(
  input: WorkbenchCandidateContentFingerprintInput,
): string {
  const candidateSource = workbenchCandidateSourceYamlForFingerprint(input.sourceYaml);
  const resolvedSpec = resolveWorkbenchResolvedSourceYamlInternal(input.sourceYaml);
  const adapterManifests = input.adapterManifests ??
    adapterManifestsForContentFingerprint(input.adapterFiles ?? []);
  const candidateAdapterIds = new Set(
    collectWorkbenchAdapterInvocations([resolvedSpec.run], adapterManifests)
      .map((invocation: { use: string }) => invocation.use),
  );
  const canonical = {
    sourceYaml: normalizeTextForProjectStateFingerprint(candidateSource.sourceYaml),
    candidateFiles: canonicalFilesForProjectStateFingerprint(input.candidateFiles),
    adapterFiles: canonicalFilesForProjectStateFingerprint(
      adapterFilesForContentFingerprint(
        input.adapterFiles ?? [],
        candidateSource.adapterSources,
        candidateAdapterIds,
      ),
    ),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function workbenchProjectSourceFingerprint(
  input: Omit<WorkbenchProjectStateSource, "files" | "revisionId" | "fingerprint">,
): string {
  const canonical = {
    sourceYaml: normalizeTextForProjectStateFingerprint(input.source),
    candidateFiles: canonicalFilesForProjectStateFingerprint(input.candidateFiles),
    engineResolveFiles: canonicalFilesForProjectStateFingerprint(input.engineResolveFiles),
    engineResolveBinding: {
      engine: input.engineResolveBinding.engine,
      resolver: {
        use: input.engineResolveBinding.resolver.use,
        withFingerprint: input.engineResolveBinding.resolver.withFingerprint,
      },
    },
    adapterFiles: canonicalFilesForProjectStateFingerprint(input.adapterFiles),
    runtimeFiles: canonicalFilesForProjectStateFingerprint(input.runtimeFiles),
    dockerfile: normalizeTextForProjectStateFingerprint(input.dockerfile),
    runtimeDockerfile: normalizeTextForProjectStateFingerprint(input.runtimeDockerfile),
    resources: normalizeProjectStateResources(input.resources),
    network: input.network,
  };
  return createHash("sha256").update(JSON.stringify(canonicalizeProjectState(canonical))).digest("hex");
}

export function workbenchRuntimeBundleFingerprint(
  bundle: WorkbenchRuntimeBundle,
): string {
  const canonical = {
    schema: bundle.schema,
    activeId: bundle.activeId,
    candidates: sortByStableKey(
      bundle.candidates.map(workbenchRuntimeCandidateIdentityForExchange),
      (candidate) => candidate.id,
    ),
    candidateFiles: sortByStableKey(
      bundle.candidateFiles.map((group) => ({
        candidateId: group.candidateId,
        files: canonicalFilesForProjectStateFingerprint(group.files),
      })),
      (group) => group.candidateId,
    ),
    evaluations: sortByStableKey(bundle.evaluations, (evaluation) => evaluation.id),
    runs: sortByStableKey(bundle.runs, (run) => run.id),
    jobs: sortByStableKey(
      bundle.jobs.map(runtimeJobForProjectStateFingerprint),
      (job) => job.id,
    ),
    executionFiles: sortByStableKey(
      bundle.executionFiles.map((group) => ({
        jobId: group.jobId,
        files: canonicalFilesForProjectStateFingerprint(group.files),
      })),
      (group) => group.jobId,
    ),
    events: sortByStableKey(bundle.events, (event) =>
      [event.runId ?? "_", event.jobId ?? "_", event.at, event.id].join("#")
    ),
  };
  return createHash("sha256").update(JSON.stringify(canonicalizeProjectState(canonical))).digest("hex");
}

export function workbenchSurfaceFilesEqualForExchange(
  left: readonly SurfaceSnapshotFile[],
  right: readonly SurfaceSnapshotFile[],
): boolean {
  return JSON.stringify(canonicalFilesForProjectStateFingerprint(left)) ===
    JSON.stringify(canonicalFilesForProjectStateFingerprint(right));
}

export function workbenchRuntimeBundleStats(
  bundle: WorkbenchRuntimeBundle,
): WorkbenchRuntimeBundleStats {
  return {
    candidates: bundle.candidates.length,
    candidateFiles: bundle.candidateFiles.reduce((sum, group) => sum + group.files.length, 0),
    evaluations: bundle.evaluations.length,
    runs: bundle.runs.length,
    jobs: bundle.jobs.length,
    executionFiles: bundle.executionFiles.reduce((sum, group) => sum + group.files.length, 0),
    events: bundle.events.length,
    activeId: bundle.activeId,
  };
}

export function workbenchRuntimeExplicitActiveId(args: {
  candidates: readonly CandidateRecord[];
  runs: readonly RunSummary[];
  preferredActiveId?: string | null;
  benchmarkFingerprint: string;
}): string | null {
  const candidateById = new Map(args.candidates.map((candidate) => [
    candidate.id,
    candidate,
  ]));
  const compatible = (candidateId: string | null | undefined): string | null => {
    if (!candidateId) {
      return null;
    }
    const candidate = candidateById.get(candidateId) ?? null;
    return candidate?.benchmarkFingerprint === args.benchmarkFingerprint
      ? candidate.id
      : null;
  };
  return compatible(args.preferredActiveId) ??
    latestExplicitRunActiveIdForBenchmark(args.runs, compatible, args.benchmarkFingerprint);
}

function latestExplicitRunActiveIdForBenchmark(
  runs: readonly RunSummary[],
  compatible: (candidateId: string | null | undefined) => string | null,
  benchmarkFingerprint: string,
): string | null {
  return runs
    .slice()
    .sort((left, right) => {
      const leftAt = left.finishedAt ?? left.startedAt;
      const rightAt = right.finishedAt ?? right.startedAt;
      return leftAt.localeCompare(rightAt) || left.id.localeCompare(right.id);
    })
    .reverse()
    .map((run) =>
      run.benchmarkFingerprint === benchmarkFingerprint
        ? compatible(run.activeCandidateId)
        : null
    )
    .find((candidateId): candidateId is string => candidateId !== null) ?? null;
}

function workbenchCandidateSourceYamlForFingerprint(sourceYaml: string): {
  sourceYaml: string;
  adapterSources: string[];
} {
  const parsed = YAML.parse(sourceYaml) as Record<string, unknown> | null;
  const candidate = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed.candidate
    : null;
  const candidateRecord = candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null;
  const adapters = Array.isArray(candidateRecord?.adapters)
    ? candidateRecord.adapters.flatMap((entry) => typeof entry === "string" ? [entry] : [])
    : [];
  const sourceRecord = splitCandidateSourceRecord(candidateRecord);
  return {
    sourceYaml: `${YAML.stringify(sourceRecord ?? {}).trimEnd()}\n`,
    adapterSources: adapters,
  };
}

function workbenchBenchmarkSourceYamlForFingerprint(sourceYaml: string): {
  sourceYaml: string;
  adapterSources: string[];
} {
  const parsed = YAML.parse(sourceYaml) as Record<string, unknown> | null;
  const benchmark = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed.benchmark
    : null;
  const benchmarkRecord = benchmark && typeof benchmark === "object" && !Array.isArray(benchmark)
    ? benchmark as Record<string, unknown>
    : null;
  const adapters = Array.isArray(benchmarkRecord?.adapters)
    ? benchmarkRecord.adapters.flatMap((entry) => typeof entry === "string" ? [entry] : [])
    : [];
  return {
    sourceYaml: `${YAML.stringify(benchmarkRecord ?? {}).trimEnd()}\n`,
    adapterSources: adapters,
  };
}

function canonicalEngineResolveBindingForFingerprint(
  binding: EngineResolveBinding,
): EngineResolveBinding {
  return {
    engine: binding.engine,
    resolver: {
      use: binding.resolver.use,
      withFingerprint: binding.resolver.withFingerprint,
    },
  };
}

function adapterFilesForContentFingerprint(
  adapterFiles: readonly SurfaceSnapshotFile[],
  adapterSources: readonly string[],
  adapterIds: ReadonlySet<string>,
): SurfaceSnapshotFile[] {
  const roots = [
    ...adapterSources.map(normalizeSourcePathForContentFingerprint).filter(Boolean),
    ...adapterRootsForContentFingerprint(adapterFiles, adapterIds),
  ];
  if (roots.length === 0) {
    return [];
  }
  return adapterFiles.filter((file) =>
    roots.some((root) => isWithinSourcePathForContentFingerprint(file.path, root)),
  );
}

function adapterRootsForContentFingerprint(
  adapterFiles: readonly SurfaceSnapshotFile[],
  adapterIds: ReadonlySet<string>,
): string[] {
  const roots: string[] = [];
  for (const file of adapterFiles) {
    const normalizedPath = normalizeSourcePathForContentFingerprint(file.path);
    if (
      (
        normalizedPath !== "workbench.adapter.yaml" &&
        !normalizedPath.endsWith("/workbench.adapter.yaml")
      ) ||
      file.encoding !== "utf8"
    ) {
      continue;
    }
    const manifest = parseWorkbenchAdapterManifest(file.content, normalizedPath);
    if (adapterIds.has(manifest.id)) {
      roots.push(normalizedPath === "workbench.adapter.yaml"
        ? ""
        : normalizedPath.slice(0, -"/workbench.adapter.yaml".length));
    }
  }
  return roots;
}

function adapterManifestsForContentFingerprint(
  adapterFiles: readonly SurfaceSnapshotFile[],
): WorkbenchAdapterManifest[] {
  return adapterFiles.flatMap((file) => {
    const normalizedPath = normalizeSourcePathForContentFingerprint(file.path);
    if (
      (
        normalizedPath !== "workbench.adapter.yaml" &&
        !normalizedPath.endsWith("/workbench.adapter.yaml")
      ) ||
      file.encoding !== "utf8"
    ) {
      return [];
    }
    return [parseWorkbenchAdapterManifest(file.content, normalizedPath)];
  });
}

function isWithinSourcePathForContentFingerprint(filePath: string, rootPath: string): boolean {
  const normalizedFile = normalizeSourcePathForContentFingerprint(filePath);
  const normalizedRoot = normalizeSourcePathForContentFingerprint(rootPath);
  if (!normalizedRoot) {
    return true;
  }
  return normalizedFile === normalizedRoot ||
    normalizedFile.startsWith(`${normalizedRoot}/`);
}

function normalizeSourcePathForContentFingerprint(value: string): string {
  return value
    .replace(/\\/gu, "/")
    .replace(/^\/+/u, "")
    .replace(/\/+/gu, "/")
    .replace(/^(?:\.\/)+/u, "");
}

function runtimeJobForProjectStateFingerprint(
  job: HostedWorkbenchJob,
): HostedWorkbenchJob {
  const portable = sanitizeWorkbenchRuntimeJobForExchange(job);
  const output = portable.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return portable;
  }
  const {
    files: _files,
    fileSet: _fileSet,
    ...portableOutput
  } = output as Record<string, Json>;
  return {
    ...portable,
    output: portableOutput as Json,
  };
}

function canonicalFilesForProjectStateFingerprint(
  files: readonly SurfaceSnapshotFile[],
): Array<{
  path: string;
  encoding: SurfaceSnapshotFile["encoding"];
  executable: boolean;
  content: string;
}> {
  return sortByStableKey(
    files.map((file) => ({
      path: file.path,
      encoding: file.encoding,
      executable: Boolean(file.executable),
      content: canonicalFileContentForProjectStateFingerprint(file),
    })),
    (file) => file.path,
  );
}

function canonicalFileContentForProjectStateFingerprint(
  file: SurfaceSnapshotFile,
): string {
  if (
    file.encoding !== "utf8" ||
    normalizeSourcePathForContentFingerprint(file.path) !== WORKBENCH_ADAPTER_RESULT_FILE
  ) {
    return file.content;
  }
  return canonicalEngineResolveResultContentForFingerprint(file.content);
}

function canonicalEngineResolveResultContentForFingerprint(content: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return content;
  }
  const record = parsed as Record<string, unknown>;
  const value = record.value && typeof record.value === "object" && !Array.isArray(record.value)
    ? record.value as Record<string, unknown>
    : null;
  if (!Array.isArray(value?.cases)) {
    return JSON.stringify(canonicalizeProjectState(record));
  }
  return JSON.stringify(canonicalizeProjectState({
    ...record,
    value: {
      ...value,
      cases: sortByStableKey(
        value.cases.map(canonicalEngineResolveCaseForFingerprint),
        (engineCase) => engineCase.id,
      ),
    },
  }));
}

function canonicalEngineResolveCaseForFingerprint(value: unknown): Record<string, unknown> & { id: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { id: JSON.stringify(value), value };
  }
  const record = value as Record<string, unknown>;
  const files = record.files && typeof record.files === "object" && !Array.isArray(record.files)
    ? record.files as Record<string, unknown>
    : null;
  return {
    ...record,
    id: typeof record.id === "string" ? record.id : JSON.stringify(record.id ?? record),
    ...(files
      ? {
          files: {
            ...files,
            public: canonicalEngineResolveCaseFilesForFingerprint(files.public),
            private: canonicalEngineResolveCaseFilesForFingerprint(files.private),
            source: canonicalEngineResolveCaseFilesForFingerprint(files.source),
          },
        }
      : {}),
  };
}

function canonicalEngineResolveCaseFilesForFingerprint(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  if (!value.every((entry) =>
    entry &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    typeof (entry as Record<string, unknown>).path === "string"
  )) {
    return value;
  }
  return sortByStableKey(
    value.map((entry) => ({ ...(entry as Record<string, unknown>) })),
    (entry) => String(entry.path),
  );
}

function normalizeTextForProjectStateFingerprint(value: string): string {
  return value.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
}

function normalizeProjectStateResources(
  resources: WorkbenchProjectSourceResources,
): Required<WorkbenchProjectSourceResources> {
  return {
    cpu: resources.cpu ?? DEFAULT_EXECUTION_RESOURCES.cpu,
    memoryGb: resources.memoryGb ?? DEFAULT_EXECUTION_RESOURCES.memoryGb,
    diskGb: resources.diskGb ?? DEFAULT_EXECUTION_RESOURCES.diskGb,
    timeoutMinutes: resources.timeoutMinutes ?? DEFAULT_EXECUTION_RESOURCES.timeoutMinutes,
  };
}

function sortByStableKey<T>(items: readonly T[], keyFor: (item: T) => string): T[] {
  return [...items].sort((left, right) => keyFor(left).localeCompare(keyFor(right)));
}

function canonicalizeProjectState(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeProjectState);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalizeProjectState(record[key])]),
  );
}

interface RuntimeCommandSpec {
  use: "command";
  command: string;
  executor: WorkbenchAdapterOperationExecutor;
}

export interface WorkbenchRunMaterialization {
  candidates: CandidateRecord[];
  candidateFiles: Record<string, SurfaceSnapshotFile[]>;
  evaluations: EvaluationScorecard[];
  activeCandidateId: string | null;
  selectedCandidate: CandidateRecord | null;
  completedJobCount: number;
  failedJobCount: number;
}

export interface WorkbenchRunWorkload {
  job: HostedWorkbenchJob;
  spec: GenericRunSpec;
  candidateId: string;
  attemptIndex: number;
  sampleIndex: number;
  caseId: string;
  candidateFiles: SurfaceSnapshotFile[];
  engineResolveFiles: SurfaceSnapshotFile[];
  traceFiles: SurfaceSnapshotFile[];
  engineCase?: WorkbenchEngineCase;
  engineCaseSpec?: GenericEngineCaseSpec;
  prompt: string;
  changedPaths: string[];
  baseId: string | null;
}

export interface RuntimeWorkloadResult {
  files: SurfaceSnapshotFile[];
  fileChanges: string[];
  operationResults?: WorkbenchAdapterOperationResult[];
  workspaceFiles?: SurfaceSnapshotFile[];
  candidatePatch?: WorkbenchCandidatePatch;
  result?: WorkbenchResult;
  metrics?: Record<string, number>;
  cases?: EvalCaseResult[];
  usage?: UsageSummary;
  summary?: string;
  feedback?: Json;
  exitCode?: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

export const DEFAULT_ENVIRONMENT_VERSIONS: HostedWorkbenchEnvironmentVersion[] =
  [
    {
      id: "envv_python_3_12",
      environmentId: "env_python",
      name: "Python 3.12",
      imageRef: "docker://workbench/workbench-python-3.12:envv_python_3_12",
      sourceHash: "builtin:python-3.12",
      sourceType: "builtin",
      status: "ready",
      createdAt: "2026-04-23T00:00:00.000Z",
      updatedAt: "2026-04-23T00:00:00.000Z",
      spec: {
        base: "workbench/python-3.12",
        resources: {
          cpu: 2,
          memoryGb: 4,
          diskGb: 10,
          timeoutMinutes: 20,
        },
        network: "off",
      },
    },
    {
      id: "envv_libreoffice_python",
      environmentId: "env_libreoffice_python",
      name: "LibreOffice + Python",
      imageRef:
        "docker://workbench/workbench-libreoffice-python:envv_libreoffice_python",
      sourceHash: "builtin:libreoffice-python",
      sourceType: "builtin",
      status: "ready",
      createdAt: "2026-04-23T00:00:00.000Z",
      updatedAt: "2026-04-23T00:00:00.000Z",
      spec: {
        base: "workbench/python-3.12",
        resources: {
          cpu: 2,
          memoryGb: 4,
          diskGb: 10,
          timeoutMinutes: 30,
        },
        network: "off",
      },
    },
    {
      id: "envv_libreoffice_agent",
      environmentId: "env_libreoffice_agent",
      name: "LibreOffice + Agent",
      imageRef:
        "docker://workbench/workbench-libreoffice-agent:envv_libreoffice_agent",
      sourceHash: "builtin:libreoffice-agent",
      sourceType: "builtin",
      status: "ready",
      createdAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:00.000Z",
      spec: {
        base: "workbench/python-3.12",
        resources: {
          cpu: 4,
          memoryGb: 8,
          diskGb: 20,
          timeoutMinutes: 60,
        },
        network: "on",
      },
    },
    {
      id: "envv_node_22",
      environmentId: "env_node",
      name: "Node 22",
      imageRef: "docker://workbench/workbench-node-22:envv_node_22",
      sourceHash: "builtin:node-22",
      sourceType: "builtin",
      status: "ready",
      createdAt: "2026-04-23T00:00:00.000Z",
      updatedAt: "2026-04-23T00:00:00.000Z",
      spec: {
        base: "workbench/node-22",
        resources: {
          cpu: 2,
          memoryGb: 4,
          diskGb: 10,
          timeoutMinutes: 20,
        },
        network: "off",
      },
    },
  ];

export const DEFAULT_ENVIRONMENTS: HostedWorkbenchEnvironment[] = [
  {
    id: "env_python",
    name: "Python",
    description:
      "Python runtime for scripts, data processing, and simple evaluators.",
    currentVersionId: "envv_python_3_12",
    builtIn: true,
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
  },
  {
    id: "env_libreoffice_python",
    name: "LibreOffice + Python",
    description:
      "Python runtime with soffice for document, spreadsheet, and PDF-heavy evaluations.",
    currentVersionId: "envv_libreoffice_python",
    builtIn: true,
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
  },
  {
    id: "env_libreoffice_agent",
    name: "LibreOffice + Agent",
    description:
      "Agent runtime with soffice and Python libraries for spreadsheet-heavy evaluations.",
    currentVersionId: "envv_libreoffice_agent",
    builtIn: true,
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
  },
  {
    id: "env_node",
    name: "Node",
    description: "Node runtime for JavaScript and TypeScript candidates.",
    currentVersionId: "envv_node_22",
    builtIn: true,
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
  },
];

export function loadAuthoredWorkbenchSourceDocument(args: {
  sourceYaml: string;
  path?: string;
  sourceFiles?: readonly SurfaceSnapshotFile[];
  cases?: HostedWorkbenchFileInput[];
}): AuthoredWorkbenchSourceDocument {
  const spec = parseAuthoredWorkbenchSourceSpec(args.sourceYaml);
  return {
    path: args.path ?? "benchmark.yaml",
    exists: args.sourceYaml.trim().length > 0,
    source_yaml: args.sourceYaml,
    source_files: authoredSourceFilesForDocument(args),
    spec,
    cases: summarizeCaseInputs(args.cases ?? []),
  };
}

function authoredSourceFilesForDocument(args: {
  sourceYaml: string;
  sourceFiles?: readonly SurfaceSnapshotFile[];
}): AuthoredWorkbenchSourceDocument["source_files"] {
  const explicit = (args.sourceFiles ?? [])
    .filter((file) =>
      file.encoding === "utf8" &&
      isAuthoredSourceYamlPath(file.path)
    )
    .map((file) => ({
      path: file.path,
      content: file.content,
    }));
  if (explicit.length > 0) {
    return explicit;
  }
  return splitAuthoredSourceYaml(args.sourceYaml);
}

function splitAuthoredSourceYaml(
  sourceYaml: string,
): AuthoredWorkbenchSourceDocument["source_files"] {
  const parsed = YAML.parse(sourceYaml) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const entries: Array<[string, unknown]> = [
    [BENCHMARK_SPEC_FILE, parsed.benchmark],
    ["candidates/current/candidate.yaml", splitCandidateSourceRecord(parsed.candidate)],
  ];
  return entries.flatMap(([filePath, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }
    return [{
      path: filePath,
      content: `${YAML.stringify(value).trimEnd()}\n`,
    }];
  });
}

function splitCandidateSourceRecord(value: unknown): unknown {
  const record = cloneYamlRecord(value);
  if (!record) {
    return value;
  }
  delete record.benchmark;
  delete record.path;
  stripCandidateRuntimeSelection(record);
  rewriteAdapterSources(record, "candidates/current");
  return record;
}

function stripCandidateRuntimeSelection(record: Record<string, unknown>): void {
  delete record.selectedRunId;
  delete record.selectedRunName;
}

function cloneYamlRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? YAML.parse(YAML.stringify(value)) as Record<string, unknown>
    : null;
}

function rewriteAdapterSources(record: Record<string, unknown>, yamlDir: string): void {
  if (!Array.isArray(record.adapters)) {
    return;
  }
  record.adapters = record.adapters.map((entry) =>
    typeof entry === "string" && !/^(?:npm|git):/iu.test(entry.trim())
      ? sourcePathRelativeTo(yamlDir, entry)
      : entry
  );
}

function sourcePathRelativeTo(yamlDir: string, sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/gu, "/").replace(/^\.\//u, "");
  const relative = path.posix.relative(yamlDir, normalized);
  return relative || ".";
}

function isAuthoredSourceYamlPath(filePath: string): boolean {
  return filePath === BENCHMARK_SPEC_FILE ||
    isWorkbenchCandidateManifestPath(filePath);
}

function formatImproveSummary(spec: GenericRunSpec): string {
  return spec.improve ? `adapter:${spec.improve.use}` : "improve not configured";
}

function formatEngineRunSummary(spec: GenericRunSpec): string {
  return `adapter:${spec.engineRun.use}`;
}

function environmentNetwork(runtime: GenericRunSpec["environment"]): "off" | "on" {
  const egress = runtime.network?.egress;
  return egress === "none" ? "off" : "on";
}

function environmentResources(
  runtime: GenericRunSpec["environment"],
): RuntimeEnvironmentResources | undefined {
  const resources = runtime.resources ?? {};
  const output: RuntimeEnvironmentResources = {};
  if (typeof resources.cpu === "number") {
    output.cpu = resources.cpu;
  }
  if (typeof resources.memoryGb === "number") {
    output.memoryGb = resources.memoryGb;
  }
  if (typeof resources.diskGb === "number") {
    output.diskGb = resources.diskGb;
  }
  if (typeof resources.timeoutMinutes === "number") {
    output.timeoutMinutes = resources.timeoutMinutes;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function adapterProtocolCommandSpec(
  adapter: WorkbenchExecutionSpec["adapter"],
  operation: WorkbenchAdapterOperation,
  manifests: readonly WorkbenchAdapterManifest[] = [],
): RuntimeCommandSpec {
  if (!/^[a-z][a-z0-9-]*$/u.test(adapter.use)) {
    throw new Error(`Adapter id ${adapter.use} cannot be mapped to an executable command.`);
  }
  const manifest = manifests.find((entry) => entry.id === adapter.use);
  return {
    use: "command",
    command: manifest ? workbenchAdapterOperationCommand(manifest, operation) : adapterCommandName(adapter.use),
    executor: manifest ? workbenchAdapterOperationExecutor(manifest, operation) : "sandbox",
  };
}

function protocolStepForExecution(
  execution: WorkbenchExecutionSpec,
  manifests?: readonly WorkbenchAdapterManifest[],
): WorkbenchWorkloadStepCommand {
  if (execution.purpose !== "improve") {
    throw new Error(`Protocol execution step only supports improve executions, not ${execution.purpose}.`);
  }
  const operation = "candidate.improve";
  const command = adapterProtocolCommandSpec(
    execution.adapter,
    operation,
    manifests,
  );
  return {
    kind: "improver",
    label: execution.purpose,
    operation,
    executor: command.executor,
    adapter: execution.adapter,
    command: command.command,
  };
}

function attemptStepsForExecution(
  execution: WorkbenchExecutionSpec,
  spec: GenericRunSpec,
  manifests?: readonly WorkbenchAdapterManifest[],
): WorkbenchWorkloadStepCommand[] {
  void spec;
  const command = adapterProtocolCommandSpec(execution.adapter, "engine.run", manifests);
  const engineStep: WorkbenchWorkloadStepCommand = {
    kind: "engine",
    label: "engine",
    operation: "engine.run",
    executor: command.executor,
    adapter: execution.adapter,
    command: command.command,
  };
  return [engineStep];
}

function adapterConfigRecord(
  adapter: WorkbenchExecutionSpec["adapter"],
  manifests: readonly WorkbenchAdapterManifest[] = [],
): Record<string, Json> {
  const config = cloneJsonRecord(jsonRecord(adapter.with));
  const manifest = manifests.find((entry) => entry.id === adapter.use);
  if (!manifest?.slots) {
    return config;
  }
  for (const slot of Object.values(manifest.slots)) {
    const value = jsonPointerValue(config, slot.path);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const nested = jsonRecord(value[index]);
        if (nested) {
          value[index] = invocationWithCommand(nested, slot.operation, manifests);
        }
      }
      continue;
    }
    const nested = jsonRecord(value);
    if (nested) {
      setJsonPointerValue(config, slot.path, invocationWithCommand(nested, slot.operation, manifests));
    }
  }
  return config;
}

function invocationWithCommand(
  invocation: Record<string, Json>,
  operation: WorkbenchAdapterOperation,
  manifests: readonly WorkbenchAdapterManifest[],
): Record<string, Json> {
  const use = typeof invocation.use === "string" ? invocation.use : "";
  if (!use) {
    return invocation;
  }
  const manifest = manifests.find((entry) => entry.id === use);
  return {
    ...invocation,
    command: manifest ? workbenchAdapterOperationCommand(manifest, operation) : adapterCommandName(use),
  };
}

function cloneJsonRecord(value: Record<string, Json>): Record<string, Json> {
  return JSON.parse(JSON.stringify(value)) as Record<string, Json>;
}

function jsonPointerValue(root: Record<string, Json>, pointer: string): unknown {
  let current: unknown = root;
  for (const segment of jsonPointerSegments(pointer)) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setJsonPointerValue(
  root: Record<string, Json>,
  pointer: string,
  value: Record<string, Json>,
): void {
  const segments = jsonPointerSegments(pointer);
  let current: Record<string, Json> = root;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return;
    }
    current = next as Record<string, Json>;
  }
  const key = segments.at(-1);
  if (key) {
    current[key] = value as Json;
  }
}

function jsonPointerSegments(pointer: string): string[] {
  if (pointer === "") {
    return [];
  }
  return pointer
    .replace(/^\//u, "")
    .split("/")
    .map((segment) => segment.replace(/~1/gu, "/").replace(/~0/gu, "~"));
}

export function materializeWorkbenchRunResult(args: {
  runId: string;
  benchmarkFingerprint: string;
  sourceYaml?: string;
  benchmarkSourceFiles?: readonly SurfaceSnapshotFile[];
  candidateFingerprint?: string;
  candidateSourceFiles?: readonly SurfaceSnapshotFile[];
  startedAt: string;
  spec: GenericRunSpec;
  jobs: readonly HostedWorkbenchJob[];
  previousCandidate?: CandidateRecord | null;
  existingCandidateCount: number;
  selection?: {
    metric: string;
    caseIds?: readonly string[];
    label?: string;
  };
}): WorkbenchRunMaterialization {
  const completed = args.jobs.filter((job) => job.status === "succeeded");
  const failedJobCount = args.jobs.filter(
    (job) => job.status === "failed",
  ).length;
  const completedJobCount = args.jobs.filter(
    (job) => job.status === "succeeded",
  ).length;
  const candidateRevisions = completed
    .filter((job) => workbenchExecutionPurpose(job) === "improve")
    .map((job) => normalizeCandidateRevisionJobOutput(job.output))
    .filter((output): output is HostedCandidateRevisionJobOutput => output !== null)
    .sort((left, right) => left.attemptIndex - right.attemptIndex);
  const evaluationJobs = args.jobs.filter(
    (job) =>
      workbenchExecutionPurpose(job) === "attempt",
  );
  const evaluationsByCandidate = new Map<string, HostedWorkbenchJob[]>();
  for (const job of evaluationJobs) {
    const candidateId =
      readJobString(job.output, "candidateId") ??
      readJobString(job.input, "candidateId") ??
      job.candidateId;
    if (candidateId) {
      evaluationsByCandidate.set(candidateId, [
        ...(evaluationsByCandidate.get(candidateId) ?? []),
        job,
      ]);
    }
  }

  const candidates: CandidateRecord[] = [];
  const candidateFiles: Record<string, SurfaceSnapshotFile[]> = {};
  const evaluations: EvaluationScorecard[] = [];
  for (const candidateRevision of candidateRevisions) {
    const candidateId = candidateRevision.candidateId;
    const candidateJobs = evaluationsByCandidate.get(candidateId) ?? [];
    const succeededEvaluationJobs = candidateJobs.filter(
      (job) => job.status === "succeeded",
    );
    const outputs = normalizeEvaluationSampleOutputs(succeededEvaluationJobs)
      .sort((left, right) => compareSampleOutputs(left.output, right.output));
    const outputJobIds = new Set(
      outputs.flatMap(({ jobs }) => jobs.map((job) => job.id)),
    );
    const completedSampleKeys = new Set(
      outputs
        .flatMap(({ jobs, output }) => [
          evaluationSampleGroupKeyFromOutput(output),
          ...jobs.map(evaluationSampleGroupKeyFromJob),
        ])
        .filter((key): key is string => key !== null),
    );
    const errorSampleJobs = [
      ...candidateJobs.filter((job) => job.status === "failed"),
      ...succeededEvaluationJobs.filter((job) => !outputJobIds.has(job.id)),
    ];
    const errorSamples = errorEvaluationSamplesFromJobs(
      errorSampleJobs,
      candidateId,
      candidateRevision.attemptIndex,
      completedSampleKeys,
    );
    const samples = [
      ...outputs.map(({ jobs, output }) =>
        withJobUsage(
          output.sample,
          completed,
          jobs[0]!,
        ),
      ),
      ...errorSamples,
    ].sort(
      (left, right) =>
        left.index - right.index || left.id.localeCompare(right.id),
    );
    const candidateName = normalizedCandidateDisplayName(args.spec.candidate.name);
    const evalRecord = createEvaluationRecord(candidateId, candidateName, samples);
    const usage = mergeUsageSummaries([
      candidateRevision.usage,
      ...samples.map((sample) => sample.usage),
    ]);
    const attemptIndex = candidateRevision.attemptIndex;
    const evaluationTraces = [
      ...outputs.flatMap(({ output }) => output.traces),
      ...errorSampleJobs.flatMap(jobTracePaths),
    ].sort();
    const baseId = candidateRevision.baseId && candidateRevision.baseId !== candidateId
      ? candidateRevision.baseId
      : null;
    const sourceMeta = candidateSourceMetadata(args.candidateSourceFiles);
    const benchmarkMeta = benchmarkSourceMetadata(args.benchmarkSourceFiles);
    const meta: Record<string, Json> = {
      attemptIndex,
      sampleCount: evalRecord.sampleCount,
      improver: formatImproveSummary(args.spec),
      engineRun: formatEngineRunSummary(args.spec),
      strategy: "greedy",
      traces: {
        improve: candidateRevision.traces,
        evaluations: evaluationTraces,
      },
    };
    if (sourceMeta) {
      meta.source = sourceMeta;
    }
    if (benchmarkMeta) {
      meta.benchmark = benchmarkMeta;
    }
    const record = preserveExistingCandidateIdentity({
      candidate: {
        id: candidateId,
        ...(candidateName ? { name: candidateName } : {}),
        version: args.existingCandidateCount + candidates.length + 1,
        ordinal: args.existingCandidateCount + candidates.length + 1,
        benchmarkFingerprint: args.benchmarkFingerprint,
        candidateFingerprint: args.candidateFingerprint ?? materializedCandidateFingerprint(args.spec, candidateRevision.files),
        createdAt: args.startedAt,
        ...(baseId ? { baseId } : {}),
        referenceIds: [],
        status: evalRecord.completedSampleCount > 0 ? "evaluated" : "eval_error",
        fileChanges: candidateRevision.fileChanges,
        ...(usage ? { usage } : {}),
        eval: evalRecord,
        ...(candidateRevision.prompt ? { prompt: candidateRevision.prompt } : {}),
        meta,
      },
      previousCandidate: args.previousCandidate ?? null,
    });
    candidates.push(record);
    evaluations.push(createEvaluationScorecard({
      runId: args.runId,
      benchmarkFingerprint: args.benchmarkFingerprint,
      createdAt: args.startedAt,
      candidate: record,
      candidateRunId: args.spec.candidate.selectedRunId,
      candidateRunName: args.spec.candidate.selectedRunName,
      evaluation: evalRecord,
      ...(args.selection
        ? {
            selection: {
              metric: args.selection.metric,
              caseIds: args.selection.caseIds,
              ...(args.selection.label ? { label: args.selection.label } : {}),
            },
          }
        : {}),
    }));
    candidateFiles[candidateId] = materializedCandidateFiles({
      candidateRevisionFiles: candidateRevision.files,
    });
  }

  const selectedCandidate = selectCandidate({
    candidates,
    previousCandidate: args.previousCandidate ?? null,
    selection: args.selection,
  });
  return {
    candidates,
    candidateFiles,
    evaluations,
    activeCandidateId:
      selectedCandidate?.id ?? args.previousCandidate?.id ?? null,
    selectedCandidate,
    completedJobCount,
    failedJobCount,
  };
}

function preserveExistingCandidateIdentity(args: {
  candidate: CandidateRecord;
  previousCandidate: CandidateRecord | null;
}): CandidateRecord {
  const previous = args.previousCandidate;
  if (!previous || previous.id !== args.candidate.id) {
    return args.candidate;
  }
  const baseId = args.candidate.baseId ?? previous.baseId;
  const prompt = args.candidate.prompt ?? previous.prompt;
  const meta = mergeExistingCandidateMeta(previous.meta, args.candidate.meta);
  return {
    ...args.candidate,
    version: previous.version,
    ordinal: previous.version,
    createdAt: previous.createdAt,
    ...(args.candidate.name ?? previous.name
      ? { name: (args.candidate.name ?? previous.name)! }
      : {}),
    ...(baseId ? { baseId } : {}),
    referenceIds: previous.referenceIds.length > 0
      ? [...previous.referenceIds]
      : args.candidate.referenceIds,
    fileChanges: args.candidate.fileChanges.length > 0
      ? args.candidate.fileChanges
      : [...previous.fileChanges],
    ...(prompt ? { prompt } : {}),
    ...(meta ? { meta } : {}),
  };
}

function mergeExistingCandidateMeta(
  previousMeta: Json | undefined,
  candidateMeta: Json | undefined,
): Json | undefined {
  const previous = jsonRecord(previousMeta);
  const candidate = jsonRecord(candidateMeta);
  if (!previous) {
    return candidateMeta;
  }
  if (!candidate) {
    return previousMeta;
  }
  const previousTraces = jsonRecord(previous.traces);
  const candidateTraces = jsonRecord(candidate.traces);
  if (!previousTraces || !candidateTraces) {
    return { ...previous, ...candidate };
  }
  const traces: Record<string, Json> = {
    ...previousTraces,
    ...candidateTraces,
  };
  const candidateImproveTraces = Array.isArray(candidateTraces.improve)
    ? candidateTraces.improve
    : [];
  if (candidateImproveTraces.length === 0 && previousTraces.improve !== undefined) {
    traces.improve = previousTraces.improve;
  }
  return {
    ...previous,
    ...candidate,
    traces,
  };
}

function candidateSourceMetadata(
  files: readonly SurfaceSnapshotFile[] | undefined,
): Json | null {
  const sourceFiles = (files ?? [])
    .filter((file) => /^candidates\/[^/]+\/candidate\.ya?ml$/iu.test(file.path))
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file): Record<string, Json> => ({
      path: file.path,
      kind: file.kind,
      encoding: file.encoding ?? "utf8",
      content: file.content,
      executable: file.executable ?? false,
    }));
  return sourceFiles.length > 0 ? { files: sourceFiles } : null;
}

function benchmarkSourceMetadata(
  files: readonly SurfaceSnapshotFile[] | undefined,
): Json | null {
  const sourceFiles = (files ?? [])
    .filter((file) => file.path === BENCHMARK_SPEC_FILE)
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file): Record<string, Json> => ({
      path: file.path,
      kind: file.kind,
      encoding: file.encoding ?? "utf8",
      content: file.content,
      executable: file.executable ?? false,
    }));
  return sourceFiles.length > 0 ? { files: sourceFiles } : null;
}

function materializedCandidateFingerprint(
  spec: GenericRunSpec,
  files: readonly SurfaceSnapshotFile[],
): string {
  const hash = createHash("sha256");
  hash.update("workbench-candidate-v1\0");
  hash.update("materialized\0");
  hash.update("prepare");
  hash.update(JSON.stringify(spec.candidate.prepare ?? null));
  for (const file of filterCandidateSourceFiles(files).slice().sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update("\0file\0");
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.encoding ?? "utf8");
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
    hash.update(file.executable ? "1" : "0");
  }
  return hash.digest("hex");
}

function materializedCandidateFiles(args: {
  candidateRevisionFiles: readonly SurfaceSnapshotFile[];
}): SurfaceSnapshotFile[] {
  const byPath = new Map<string, SurfaceSnapshotFile>();
  for (const file of filterCandidateSourceFiles(args.candidateRevisionFiles)) {
    byPath.set(file.path, { ...file });
  }
  return [...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function createEvaluationScorecard(args: {
  runId: string;
  benchmarkFingerprint: string;
  createdAt: string;
  candidate: CandidateRecord;
  candidateRunId?: string;
  candidateRunName?: string;
  evaluation: EvaluationRecord;
  selection?: {
    metric: string;
    caseIds?: readonly string[];
    label?: string;
  };
}): EvaluationScorecard {
  const evaluation = args.evaluation;
  const selectionScore = args.selection
    ? readEvaluationSelectionStats(evaluation, args.selection.metric, args.selection.caseIds)
    : null;
  return {
    id: evaluationScorecardId(args.runId, args.candidate.id),
    runId: args.runId,
    benchmarkFingerprint: args.benchmarkFingerprint,
    candidateFingerprint: args.candidate.candidateFingerprint,
    candidateId: args.candidate.id,
    ...(args.candidate.name ? { candidateName: args.candidate.name } : {}),
    candidateVersion: args.candidate.version,
    ...(args.candidateRunId ? { candidateRunId: args.candidateRunId } : {}),
    ...(args.candidateRunName ? { candidateRunName: args.candidateRunName } : {}),
    createdAt: args.createdAt,
    updatedAt: evaluation.finishedAt ?? args.createdAt,
    status: evaluation.status,
    sampleCount: evaluation.sampleCount,
    completedSampleCount: evaluation.completedSampleCount,
    errorSampleCount: evaluation.errorSampleCount,
    ...(evaluation.metrics ? { metrics: evaluation.metrics } : {}),
    ...(args.selection ? { selectionMetric: args.selection.metric } : {}),
    ...(args.selection ? { selectionLabel: args.selection.label ?? `${args.selection.metric} on selected cases` } : {}),
    ...(selectionScore ? { selectionScore } : {}),
    ...(evaluation.durationMs ? { durationMs: evaluation.durationMs } : {}),
    ...(evaluation.usage ? { usage: evaluation.usage } : {}),
    ...(evaluation.error ? { error: evaluation.error } : {}),
    evaluation,
  };
}

export function evaluationScorecardId(runId: string, candidateId: string): string {
  const runPart = runId.replace(/[^a-z0-9]+/giu, "_").replace(/^_+|_+$/gu, "").slice(-24);
  const candidatePart = candidateId.replace(/[^a-z0-9]+/giu, "_").replace(/^_+|_+$/gu, "").slice(-24);
  return `eval_${runPart}_${candidatePart}`;
}

export function selectExecutionOutputFilesForInspection(args: {
  purpose: string | null | undefined;
  files: readonly SurfaceSnapshotFile[];
  output?: Record<string, unknown> | null | undefined;
}): SurfaceSnapshotFile[] {
  return args.files.filter((file) =>
    !isWorkbenchInternalOutputPath(file.path) &&
    !isGeneratedExecutionOutputPath(file.path)
  );
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

export function isGeneratedExecutionOutputPath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  if (normalized.endsWith(".pyc")) {
    return true;
  }
  return normalized.split("/").some(isGeneratedExecutionOutputSegment);
}

function isGeneratedExecutionOutputSegment(segment: string): boolean {
  if (
    segment === "__pycache__" ||
    segment === ".cache" ||
    segment === ".mypy_cache" ||
    segment === ".pytest_cache" ||
    segment === ".ruff_cache" ||
    segment === ".venv" ||
    segment === "node_modules" ||
    segment === "venv"
  ) {
    return true;
  }
  if (segment === "lohome" || segment === "lo_tmp") {
    return true;
  }
  return (
    /^lo[-_]?.*profile\d*$/u.test(segment) ||
    /^(soffice|recalc|usability).*profile\d*$/u.test(segment)
  );
}

export function createOptimizerTraceInputFiles(args: {
  jobs: readonly HostedWorkbenchJob[];
}): SurfaceSnapshotFile[] {
  const files: SurfaceSnapshotFile[] = [];
  const executions: Json[] = [];
  const jobs = args.jobs
    .filter(isOptimizerTraceInputJob)
    .sort(compareTraceInputJobs);
  jobs.forEach((job, index) => {
    const sequence = String(index + 1).padStart(6, "0");
    const executionPath = `executions/${sequence}`;
    const operation: WorkbenchAdapterOperation = "engine.run";
    const jobFiles = completedJobOutputFiles(job);
    const requestFile = traceInputRequestFile(jobFiles, operation);
    const resultFile = traceInputResultFile(jobFiles, operation);
    const requestPath = `${executionPath}/request.json`;
    const resultPath = `${executionPath}/result.json`;
    const filesPath = `${executionPath}/files`;
    files.push(textSurfaceFile(
      requestPath,
      requestFile?.content ?? `${JSON.stringify(traceInputRequestFallback(job, operation), null, 2)}\n`,
    ));
    files.push(textSurfaceFile(
      resultPath,
      resultFile?.content ?? `${JSON.stringify(traceInputResultFallback(job, operation), null, 2)}\n`,
    ));
    files.push(...jobFiles.map((file) => ({
      ...file,
      path: normalizeRelativePath(`${filesPath}/${file.path}`),
    })));
    executions.push({
      path: executionPath,
      operation,
      status: job.status,
      candidateId: job.candidateId ?? readJobString(job.input, "candidateId") ?? null,
      runId: job.runId,
      jobId: job.id,
      attemptIndex: readOptionalJobNumber(job.input, "attemptIndex") ?? null,
      sampleIndex: readOptionalJobNumber(job.input, "sampleIndex") ?? null,
      caseId: readJobString(job.input, "caseId") ?? null,
      requestPath,
      resultPath,
      filesPath,
    } as unknown as Json);
  });
  files.push(textSurfaceFile(
    "index.json",
    `${JSON.stringify({
      schema: "workbench.optimizer-traces.v1",
      executions,
    }, null, 2)}\n`,
  ));
  return dedupeSurfaceFiles(files);
}

export interface WorkbenchSelectionPolicy {
  metric: string;
  selector: WorkbenchCaseSelector;
}

export function workbenchImproveOptimizeSelector(
  spec: GenericRunSpec,
): WorkbenchCaseSelector {
  return cloneWorkbenchCaseSelector(spec.candidate.improve?.optimizeOn ?? { all: true });
}

export function workbenchImproveSelectionPolicy(
  spec: GenericRunSpec,
): WorkbenchSelectionPolicy {
  const optimizeOn = workbenchImproveOptimizeSelector(spec);
  const selectBy = spec.candidate.improve?.selectBy;
  return {
    metric: selectBy?.metric ?? "score",
    selector: cloneWorkbenchCaseSelector(selectBy?.cases ?? optimizeOn),
  };
}

export function workbenchEngineCaseIdsForSelector(
  engineCases: readonly WorkbenchEngineCase[],
  selector: WorkbenchCaseSelector,
): string[] {
  return engineCases
    .filter((engineCase) => workbenchEngineCaseMatchesSelector(engineCase, selector))
    .map((engineCase) => engineCase.id);
}

export function workbenchEngineCaseIdsForImproveEvaluation(args: {
  spec: GenericRunSpec;
  engineCases: readonly WorkbenchEngineCase[];
}): string[] {
  const optimizeIds = new Set(workbenchEngineCaseIdsForSelector(
    args.engineCases,
    workbenchImproveOptimizeSelector(args.spec),
  ));
  const selectionIds = new Set(workbenchEngineCaseIdsForSelector(
    args.engineCases,
    workbenchImproveSelectionPolicy(args.spec).selector,
  ));
  return args.engineCases
    .map((engineCase) => engineCase.id)
    .filter((caseId) => optimizeIds.has(caseId) || selectionIds.has(caseId));
}

export function filterOptimizerTraceJobsForCaseIds(
  jobs: readonly HostedWorkbenchJob[],
  caseIds: readonly string[],
): HostedWorkbenchJob[] {
  const allowed = new Set(caseIds);
  if (allowed.size === 0) {
    return [];
  }
  return jobs.filter((job) => {
    if (workbenchExecutionPurpose(job) !== "attempt") {
      return false;
    }
    const caseId = readJobString(job.input, "caseId");
    return caseId !== null && allowed.has(caseId);
  });
}

export function formatWorkbenchCaseSelector(
  selector: WorkbenchCaseSelector,
): string {
  return workbenchCaseSelectorUsesAllCases(selector)
    ? "all cases"
    : `split=${selector.split}`;
}

export function formatWorkbenchSelectionPolicy(
  policy: WorkbenchSelectionPolicy,
): string {
  return `${policy.metric} on ${formatWorkbenchCaseSelector(policy.selector)}`;
}

export function workbenchCaseSelectorUsesAllCases(
  selector: WorkbenchCaseSelector,
): boolean {
  return !selector.split;
}

function workbenchEngineCaseMatchesSelector(
  engineCase: WorkbenchEngineCase,
  selector: WorkbenchCaseSelector,
): boolean {
  if (workbenchCaseSelectorUsesAllCases(selector)) {
    return true;
  }
  return engineCase.case.split === selector.split;
}

function cloneWorkbenchCaseSelector(
  selector: WorkbenchCaseSelector,
): WorkbenchCaseSelector {
  return selector.split ? { split: selector.split } : { all: true };
}

export function evaluationMeanMetrics(
  evaluation: Pick<EvaluationRecord, "metrics"> | null | undefined,
): Record<string, number> | undefined {
  const entries = Object.entries(evaluation?.metrics ?? {})
    .filter((entry): entry is [string, MetricStats] => Number.isFinite(entry[1].mean));
  return entries.length > 0
    ? Object.fromEntries(entries.map(([key, stats]) => [key, stats.mean]))
    : undefined;
}

export function candidateRecordWithoutDerivedFields(candidate: CandidateRecord): CandidateRecord {
  const {
    metrics: _metrics,
    candidateRunId: _candidateRunId,
    candidateRunName: _candidateRunName,
    ...record
  } = candidate as CandidateRecord & {
    metrics?: unknown;
    candidateRunId?: unknown;
    candidateRunName?: unknown;
  };
  return record;
}

export function candidateSummaryFromRecord(candidate: CandidateRecord): CandidateSummary {
  const {
    eval: _eval,
    prompt: _prompt,
    meta: _meta,
    ...summary
  } = candidateRecordWithoutDerivedFields(candidate);
  return summary;
}

export function workbenchRunExecutionFingerprint(args: {
  sourceYaml?: string | null;
  adapterFiles?: readonly SurfaceSnapshotFile[];
  specVersionId?: string | null;
  environmentVersionId?: string | null;
}): string {
  const hash = createHash("sha256");
  hash.update("workbench-run-execution-v1\0");
  hash.update(args.specVersionId ?? "");
  hash.update("\0");
  hash.update(args.environmentVersionId ?? "");
  hash.update("\0");
  hash.update(args.sourceYaml ?? "");
  for (const file of (args.adapterFiles ?? []).slice().sort((left, right) =>
    left.path.localeCompare(right.path)
  )) {
    hash.update("\0file\0");
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.kind);
    hash.update("\0");
    hash.update(file.encoding);
    hash.update("\0");
    hash.update(file.executable ? "1" : "0");
    hash.update("\0");
    hash.update(file.content);
  }
  return hash.digest("hex");
}

function isOptimizerTraceInputJob(job: HostedWorkbenchJob): boolean {
  return isTerminalExecutionJob(job) &&
    workbenchExecutionPurpose(job) === "attempt";
}

function isTerminalExecutionJob(job: HostedWorkbenchJob): boolean {
  return job.kind === "execute" && (
    job.status === "succeeded" ||
    job.status === "failed" ||
    job.status === "cancelled"
  );
}

function compareTraceInputJobs(
  left: HostedWorkbenchJob,
  right: HostedWorkbenchJob,
): number {
  const leftAttempt = readOptionalJobNumber(left.input, "attemptIndex") ?? -1;
  const rightAttempt = readOptionalJobNumber(right.input, "attemptIndex") ?? -1;
  return leftAttempt - rightAttempt ||
    (readOptionalJobNumber(left.input, "sampleIndex") ?? -1) - (readOptionalJobNumber(right.input, "sampleIndex") ?? -1) ||
    (readJobString(left.input, "caseId") ?? "").localeCompare(readJobString(right.input, "caseId") ?? "") ||
    left.id.localeCompare(right.id);
}

function completedJobOutputFiles(job: HostedWorkbenchJob): SurfaceSnapshotFile[] {
  const output = jsonRecord(job.output);
  if (!Array.isArray(output.files)) {
    return [];
  }
  const files: SurfaceSnapshotFile[] = [];
  for (const file of output.files) {
    if (isSurfaceSnapshotFile(file)) {
      files.push({ ...(file as unknown as SurfaceSnapshotFile) });
    }
  }
  return files;
}

function traceInputRequestFile(
  files: readonly SurfaceSnapshotFile[],
  operation: WorkbenchAdapterOperation,
): SurfaceSnapshotFile | null {
  return files.find((file) => {
    const normalized = normalizeRelativePath(file.path);
    return normalized.startsWith(".workbench/traces/") &&
      normalized.endsWith("/request.json") &&
      file.encoding === "utf8" &&
      traceJsonOperation(file) === operation;
  }) ?? null;
}

function traceInputResultFile(
  files: readonly SurfaceSnapshotFile[],
  operation: WorkbenchAdapterOperation,
): SurfaceSnapshotFile | null {
  return files.find((file) => {
    const normalized = normalizeRelativePath(file.path);
    return normalized.startsWith(".workbench/traces/") &&
      normalized.endsWith("/result.json") &&
      file.encoding === "utf8" &&
      traceJsonOperation(file) === operation;
  }) ?? null;
}

function traceJsonOperation(file: SurfaceSnapshotFile): string | null {
  try {
    const parsed = JSON.parse(file.content);
    return typeof parsed?.operation === "string" ? parsed.operation : null;
  } catch {
    return null;
  }
}

function traceInputRequestFallback(
  job: HostedWorkbenchJob,
  operation: WorkbenchAdapterOperation,
): Record<string, Json> {
  const execution = jsonRecord(jsonRecord(job.input).execution);
  return {
    protocol: "workbench.adapter.v3",
    id: typeof execution.id === "string" ? execution.id : job.id,
    jobId: job.id,
    operation,
    invocation: jsonRecord(execution.adapter) as unknown as Json,
    context: {
      candidate: {
        id: job.candidateId ?? readJobString(job.input, "candidateId") ?? null,
      },
      attempt: {
        attemptIndex: readOptionalJobNumber(job.input, "attemptIndex") ?? null,
        sampleIndex: readOptionalJobNumber(job.input, "sampleIndex") ?? null,
        caseId: readJobString(job.input, "caseId") ?? null,
      },
    },
  } as unknown as Record<string, Json>;
}

function traceInputResultFallback(
  job: HostedWorkbenchJob,
  operation: WorkbenchAdapterOperation,
): WorkbenchAdapterOperationResult {
  const output = jsonRecord(job.output);
  const ok = job.status === "succeeded" && output.ok !== false;
  const value = operation === "candidate.improve"
    ? jsonRecord(output.candidatePatch)
    : operation === "engine.run"
      ? jsonRecord(output.result)
      : {};
  return {
    protocol: "workbench.adapter-result.v1",
    operation,
    ok,
    ...(Object.keys(value).length > 0 ? { value: value as unknown as Json } : {}),
    ...(typeof output.summary === "string" ? { summary: output.summary } : {}),
    ...(output.feedback !== undefined ? { feedback: output.feedback } : {}),
    ...(output.usage !== undefined ? { usage: output.usage as UsageSummary } : {}),
    ...(!ok ? { error: job.error ?? "Execution did not complete successfully." } : {}),
  };
}

function textSurfaceFile(path: string, content: string): SurfaceSnapshotFile {
  return {
    path,
    kind: "text",
    encoding: "utf8",
    content,
    executable: false,
  };
}

function dedupeSurfaceFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  const byPath = new Map<string, SurfaceSnapshotFile>();
  for (const file of files) {
    byPath.set(normalizeRelativePath(file.path), {
      ...file,
      path: normalizeRelativePath(file.path),
    });
  }
  return [...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

export interface WorkbenchProjectSourceFilesInput {
  specSource?: string;
  specFiles?: readonly SurfaceSnapshotFile[];
  candidateFilesPath: string;
  candidateFiles: readonly SurfaceSnapshotFile[];
  engineResolveFilesPath: string;
  engineResolveFiles: readonly SurfaceSnapshotFile[];
  adapterFiles?: readonly SurfaceSnapshotFile[];
  dockerfilePath?: string;
  dockerfile?: string | null;
  dockerfiles?: readonly SurfaceSnapshotFile[];
}

export function buildWorkbenchProjectSourceFiles(
  input: WorkbenchProjectSourceFilesInput,
): SurfaceSnapshotFile[] {
  const files: SurfaceSnapshotFile[] = [
    ...(input.specFiles
      ? input.specFiles.map((file) => ({ ...file }))
      : [textSurfaceFile("benchmark.yaml", input.specSource ?? "")]),
    ...prefixProjectSourceFiles(input.candidateFiles, input.candidateFilesPath),
    ...prefixProjectSourceFiles(input.engineResolveFiles, input.engineResolveFilesPath),
    ...(input.adapterFiles ?? []).map((file) => ({ ...file })),
    ...(input.dockerfiles ?? []).map((file) => ({ ...file })),
  ];
  if (input.dockerfilePath && input.dockerfile !== null && input.dockerfile !== undefined) {
    files.push(textSurfaceFile(input.dockerfilePath, input.dockerfile));
  }
  return dedupeSurfaceFiles(files);
}

export function readWorkbenchSpecDockerfilePath(spec: {
  environment: { dockerfile?: unknown };
}): string {
  return typeof spec.environment.dockerfile === "string" &&
      spec.environment.dockerfile.length > 0
    ? spec.environment.dockerfile
    : "environment/Dockerfile";
}

function prefixProjectSourceFiles(
  files: readonly SurfaceSnapshotFile[],
  rootPath: string,
): SurfaceSnapshotFile[] {
  const root = normalizeRelativePath(rootPath);
  return files.map((file) => {
    const filePath = normalizeRelativePath(file.path);
    return {
      ...file,
      path: filePath === root || filePath.startsWith(`${root}/`)
        ? filePath
        : `${root}/${filePath}`,
    };
  });
}

export function isCandidateSourceFilePath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  return (
    normalized !== ".workbench" &&
    !normalized.startsWith(".workbench/") &&
    normalized !== "workbench-result.json"
  );
}

export function filterCandidateSourceFiles(
  files: readonly SurfaceSnapshotFile[],
): SurfaceSnapshotFile[] {
  return files
    .filter((file) => isCandidateSourceFilePath(file.path))
    .map((file) => ({ ...file }));
}

export function buildCandidateLineage(args: {
  summaries: readonly CandidateSummary[];
  activeId: string | null;
}): CandidateLineageGraph {
  const orderedSummaries = args.summaries.slice().sort((left, right) => {
    const createdAt = left.createdAt.localeCompare(right.createdAt);
    return createdAt !== 0 ? createdAt : left.id.localeCompare(right.id);
  });
  const summaryIds = new Set(orderedSummaries.map((summary) => summary.id));
  return {
    activeId: args.activeId,
    nodes: orderedSummaries.map(
      (summary): CandidateLineageNode => ({
        id: summary.id,
        active: args.activeId === summary.id,
        summary,
      }),
    ),
    edges: orderedSummaries.flatMap((summary) =>
      buildLineageEdges(summary, summaryIds),
    ),
  };
}

export function normalizeSurfaceFiles(
  files: HostedWorkbenchFileInput[],
): SurfaceSnapshotFile[] {
  const byPath = new Map<string, SurfaceSnapshotFile>();
  for (const file of files) {
    const normalizedPath = normalizeRelativePath(file.path);
    const content = String(file.content ?? "");
    byPath.set(normalizedPath, {
      path: normalizedPath,
      kind: file.encoding === "base64" ? "binary" : "text",
      encoding: file.encoding ?? "utf8",
      content,
      executable: file.executable === true,
    });
  }
  return [...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

export function filterSurfaceFilesByInclude<T extends { path: string }>(
  files: readonly T[],
  include: readonly string[] | undefined,
): T[] {
  if (!include || include.length === 0) {
    return files.map((file) => ({ ...file }));
  }
  const matchers = include.map((pattern) =>
    globPatternToRegExp(normalizeRelativePath(pattern)),
  );
  return files
    .filter((file) =>
      matchers.some((matcher) =>
        matcher.test(normalizeRelativePath(file.path)),
      ),
    )
    .map((file) => ({ ...file }));
}

function globPatternToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    if (char === "*") {
      const next = pattern[index + 1];
      const afterNext = pattern[index + 2];
      if (next === "*") {
        if (afterNext === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(char);
  }
  return new RegExp(`${source}$`, "u");
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
}

export function summarizeCandidateFiles(
  files: readonly SurfaceSnapshotFile[],
  changedPaths: readonly string[] = files.map((file) => file.path),
): CandidateFileSummary[] {
  const changed = new Set(changedPaths);
  return [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => {
      const previewKind = resolvePreviewKind(file.path);
      const text = file.encoding === "utf8" ? file.content : "";
      const lines = text.length === 0 ? [] : text.split(/\r?\n/u);
      return {
        path: file.path,
        old_path: null,
        status: changed.has(file.path) ? "added" : "unchanged",
        mime_type: detectMimeType(file.path),
        preview_kind: previewKind,
        additions: changed.has(file.path) ? Math.max(lines.length, 1) : 0,
        deletions: 0,
      };
    });
}

export function createCandidateFilePreview(args: {
  files: readonly SurfaceSnapshotFile[];
  path: string;
  view: "diff" | "raw" | "rendered";
}): CandidateFilePreview {
  if (args.view === "diff") {
    throw new Error("Diff previews require explicit before and after file content.");
  }
  const normalizedPath = normalizeRelativePath(args.path);
  const file = args.files.find((entry) => entry.path === normalizedPath);
  if (!file) {
    throw new Error(`File ${args.path} was not found.`);
  }
  const source = {
    content: file.content,
    encoding: file.encoding,
  };
  return {
    path: file.path,
    view: args.view,
    mime_type: detectMimeType(file.path),
    preview_kind: resolvePreviewKind(file.path),
    diff: null,
    source,
    rendered_html: null,
  };
}

export function createCaseReview(args: {
  candidate: CandidateRecord;
  caseId: string;
  executions?: CandidateCaseExecutionRef[];
}): CandidateCaseReview {
  const preferredSampleIndex = uniqueExecutionSampleIndex(args.executions ?? []);
  const sampleMatchesCase = (sample: EvaluationSampleRecord) =>
    (sample.cases ?? []).some((entry) => entry.id === args.caseId);
  const samples = args.candidate.eval?.samples ?? [];
  const sampleResult =
    samples.find(
      (sample) =>
        typeof preferredSampleIndex === "number" &&
        sample.index === preferredSampleIndex &&
        sampleMatchesCase(sample),
    ) ?? samples.find(sampleMatchesCase);
  const caseResult = sampleResult?.cases?.find((entry) => entry.id === args.caseId);
  if (!sampleResult && (args.executions?.length ?? 0) > 0) {
    return {
      candidateId: args.candidate.id,
      caseId: args.caseId,
      caseLabel: args.caseId,
      ...(typeof preferredSampleIndex === "number"
        ? { sampleIndex: preferredSampleIndex }
        : {}),
      metrics: {},
      executions: args.executions ?? [],
      criteria_results: [],
    };
  }
  if (!sampleResult) {
    throw new Error(
      `Case ${args.caseId} was not found on candidate ${args.candidate.id}.`,
    );
  }
  const durationMs =
    typeof caseResult?.durationMs === "number"
      ? caseResult.durationMs
      : undefined;
  return {
    candidateId: args.candidate.id,
    caseId: caseResult?.id ?? args.caseId,
    caseLabel: caseResult?.label ?? args.caseId,
    sampleId: sampleResult.id,
    sampleIndex: sampleResult.index,
    ...(caseResult?.status ? { status: caseResult.status } : {}),
    metrics: caseResult?.metrics ?? {},
    ...(typeof durationMs === "number" ? { durationMs } : {}),
    ...(caseResult?.source ? { source: caseResult.source } : {}),
    ...(caseResult?.feedback !== undefined
      ? { feedback: caseResult.feedback }
      : {}),
    executions: args.executions ?? [],
    criteria_results: (caseResult?.criteria ?? []).map((criterion) => ({
      criterion_id: criterion.criterion_id,
      pass: criterion.pass,
      score: criterion.score,
      errors: criterion.errors ?? [],
      ...(criterion.rationale ? { rationale: criterion.rationale } : {}),
    })),
  };
}

function uniqueExecutionSampleIndex(
  executions: readonly CandidateCaseExecutionRef[],
): number | null {
  const sampleIndices = new Set(
    executions
      .map((execution) => execution.sampleIndex)
      .filter((index): index is number => typeof index === "number"),
  );
  if (sampleIndices.size !== 1) {
    return null;
  }
  const [sampleIndex] = sampleIndices;
  return typeof sampleIndex === "number" ? sampleIndex : null;
}

function parseAuthoredWorkbenchSourceSpec(source: string): AuthoredWorkbenchSourceSpec | null {
  const validation = validateWorkbenchResolvedSourceYamlInternal(source);
  if (!validation.ok) {
    return null;
  }
  const resolved = resolveWorkbenchResolvedSourceYamlInternal(source);
  return {
    version: 4,
    benchmark: {
      name: resolved.benchmark.name,
      description: resolved.benchmark.description,
      engine: authoredAdapterSpecFromInvocation(resolved.engine),
    },
    candidate: {
      name: resolved.candidate.name,
      description: resolved.candidate.description,
      files: { path: resolved.candidate.files.path },
      ...(resolved.candidate.prepare ? { prepare: { ...resolved.candidate.prepare } } : {}),
      defaultRun: resolved.candidate.defaultRun,
      runs: Object.fromEntries(Object.entries(resolved.candidate.runs).map(([runId, run]) => [
        runId,
        {
          name: run.name,
          ...authoredAdapterSpecFromInvocation(run),
        },
      ])),
      ...(resolved.candidate.improve
        ? {
            improve: {
              edits: [...resolved.candidate.improve.edits],
              ...(resolved.candidate.improve.optimizeOn
                ? { optimizeOn: resolved.candidate.improve.optimizeOn }
                : {}),
              ...(resolved.candidate.improve.selectBy
                ? { selectBy: resolved.candidate.improve.selectBy }
                : {}),
              ...improveSpecFromInvocation(resolved.improve as NonNullable<GenericRunSpec["improve"]>),
            },
          }
        : {}),
    },
  };
}

function improveSpecFromInvocation(
  invocation: NonNullable<GenericRunSpec["improve"]>,
): { use: string; auth?: string | Record<string, string>; with?: Record<string, Json> } {
  return authoredAdapterSpecFromInvocation(invocation);
}

function authoredAdapterSpecFromInvocation(
  invocation: WorkbenchAdapterInvocation,
): { use: string; auth?: string | Record<string, string>; with?: Record<string, Json> } {
  const config = jsonRecord(invocation.with);
  return {
    use: invocation.use,
    ...(invocation.auth !== undefined ? { auth: invocation.auth as string | Record<string, string> } : {}),
    ...(Object.keys(config).length > 0 ? { with: config } : {}),
  };
}

function summarizeCaseInputs(
  files: HostedWorkbenchFileInput[],
): AuthoredWorkbenchCaseSummary[] {
  if (files.length === 0) {
    return [];
  }
  const caseIds = [...new Set(files.flatMap((file) => {
    const normalized = normalizeRelativePath(file.path);
    const slash = normalized.indexOf("/");
    if (slash <= 0) {
      return [];
    }
    return [normalized.slice(0, slash)];
  }))].sort();
  if (caseIds.length === 0) {
    return [];
  }
  return caseIds.map((taskId, index) => {
    const prefix = `${taskId}/`;
    const fileCount = files.filter(
      (file) => normalizeRelativePath(file.path).startsWith(prefix),
    ).length;
    return {
      id: `case-${String(index + 1).padStart(3, "0")}`,
      slug: taskId.replace(/\W+/gu, "-"),
      path: taskId,
      name: taskId,
      fileCount,
    };
  });
}

function buildLineageEdges(
  summary: CandidateSummary,
  summaryIds: ReadonlySet<string>,
): CandidateLineageEdge[] {
  const edges: CandidateLineageEdge[] = [];
  if (summary.baseId && summary.baseId !== summary.id && summaryIds.has(summary.baseId)) {
    edges.push({
      id: `anchor:${summary.baseId}:${summary.id}`,
      kind: "anchor",
      sourceId: summary.baseId,
      targetId: summary.id,
    });
  }
  return edges;
}

interface HostedSampleJobOutput {
  candidateId: string;
  attemptIndex: number;
  sample: EvaluationSampleRecord;
  fileChanges: string[];
  files: SurfaceSnapshotFile[];
  traces: string[];
}

interface HostedMaterializedSampleOutput {
  jobs: HostedWorkbenchJob[];
  output: HostedSampleJobOutput;
}

interface HostedCandidateRevisionJobOutput {
  candidateId: string;
  attemptIndex: number;
  baseId: string | null;
  prompt?: string;
  fileChanges: string[];
  files: SurfaceSnapshotFile[];
  traces: string[];
  usage?: UsageSummary;
}

export function createWorkbenchRunWorkload(args: {
  job: HostedWorkbenchJob;
  spec: GenericRunSpec;
  baseFiles: readonly SurfaceSnapshotFile[];
  engineResolveFiles: readonly SurfaceSnapshotFile[];
  engineCases: readonly WorkbenchEngineCase[];
  traceFiles?: readonly SurfaceSnapshotFile[];
}): WorkbenchRunWorkload {
  const purpose = workbenchExecutionPurpose(args.job);
  if (!purpose) {
    throw new Error(`Unsupported runtime job kind: ${args.job.kind}`);
  }
  const candidateId =
    readJobString(args.job.input, "candidateId") ?? args.job.candidateId;
  if (!candidateId) {
    throw new Error(`${purpose} execution job is missing candidateId.`);
  }
  const attemptIndex = readRequiredJobNumber(
    args.job.input,
    "attemptIndex",
    `${purpose} execution job`,
  );
  const sampleIndex =
    purpose === "improve"
      ? 0
      : readRequiredJobNumber(
          args.job.input,
          "sampleIndex",
          `${purpose} execution job`,
        );
  const caseId =
    purpose === "improve"
      ? "current"
      : readRequiredJobString(
          args.job.input,
          "caseId",
          `${purpose} execution job`,
        );
  const engineCase = purpose === "improve"
    ? undefined
    : engineCaseForCase(args.engineCases, caseId);
  const selectedEngineResolveFiles = engineCase
    ? engineCaseFilesForRuntimeInput({ spec: args.spec, engineCase })
    : [];
  const engineCaseSpec = engineCase?.case;
  const initial = createInitialCandidateFiles({
    baseFiles: args.baseFiles,
    spec: args.spec,
    attemptIndex,
  });
  return {
    job: args.job,
    spec: args.spec,
    candidateId,
    attemptIndex,
    sampleIndex,
    candidateFiles: initial.files,
    caseId,
    engineResolveFiles: selectedEngineResolveFiles,
    traceFiles: (args.traceFiles ?? []).map((file) => ({ ...file })),
    ...(engineCase ? { engineCase } : {}),
    ...(engineCaseSpec ? { engineCaseSpec } : {}),
    prompt: initial.prompt,
    changedPaths: initial.changedPaths,
    baseId: readJobString(args.job.input, "baseId"),
  };
}

function createInitialCandidateFiles(args: {
  baseFiles: readonly SurfaceSnapshotFile[];
  spec: GenericRunSpec;
  attemptIndex: number;
}): {
  files: SurfaceSnapshotFile[];
  changedPaths: string[];
  prompt: string;
} {
  const editablePaths = improveEdits(args.spec).map(normalizeRelativePath);
  const editPath = editablePaths[0];
  const candidatePaths = editPath ? [editPath] : [];
  const files =
    args.baseFiles.length > 0
      ? args.baseFiles.map((file) => ({ ...file }))
      : editPath
        ? normalizeSurfaceFiles([{ path: editPath, content: "" }])
        : [];
  const prompt = [
    `Run the candidate workload for benchmark: ${args.spec.benchmark.description}`,
    `Attempt ${args.attemptIndex + 1} uses ${formatImproveSummary(args.spec)}; the improve adapter may edit the candidate before Workbench scores it.`,
  ].join("\n");
  const byPath = new Map(files.map((file) => [file.path, file]));
  if (
    editPath &&
    ![...byPath.keys()].some((filePath) => candidatePaths.includes(filePath))
  ) {
    byPath.set(editPath, {
      path: editPath,
      kind: "text",
      encoding: "utf8",
      executable: false,
      content: "",
    });
  }
  return {
    files: [...byPath.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    changedPaths: [],
    prompt,
  };
}

export interface WorkbenchExecutionJobOptions {
  sandboxProvider: string;
  loadLocalAdapterAuthProfiles?: boolean;
  adapterAuthUpdateSink?: (profiles: readonly WorkbenchAdapterAuthBundle[]) => Promise<void>;
  createSandboxPlaneForProvider?: (
    provider: string,
    args: WorkbenchExecutionRuntimeInput,
    startedAt: string,
    fileStore: SandboxExecutionFileStore,
  ) => SandboxPlane;
}

export async function executeWorkbenchExecutionJob(
  args: WorkbenchExecutionRuntimeInput,
  options: WorkbenchExecutionJobOptions,
): Promise<HostedWorkbenchJob> {
  const startedAt = args.job.startedAt ?? args.now ?? new Date().toISOString();
  const execution = readWorkbenchExecutionSpec(args.job);
  try {
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
        ? { ...args, adapterAuthProfiles, ...(adapterAuthUpdateSink ? { adapterAuthUpdateSink } : {}) }
        : args;
    return await withMutableAdapterAuthExecutionLocks(adapterAuthProfiles, async () =>
      await executeWorkbenchExecutionJobWithResolvedAuth(
        runtimeArgs,
        options,
        startedAt,
      )
    );
  } catch (error) {
    return failWorkbenchRunJob(args.job, startedAt, error);
  }
}

async function executeWorkbenchExecutionJobWithResolvedAuth(
  runtimeArgs: WorkbenchExecutionRuntimeInput,
  options: WorkbenchExecutionJobOptions,
  startedAt: string,
): Promise<HostedWorkbenchJob> {
  const executionForRuntime = readWorkbenchExecutionSpec(runtimeArgs.job);
  const executor = workbenchExecutionExecutorForRuntimeInput(runtimeArgs);
  if (executor === "host") {
    return await withWorkbenchRuntimeControlServer(
      runtimeArgs,
      options,
      startedAt,
      async (adapterRuntimeEnv) => executeAdapterInCurrentRuntime(
        {
          ...runtimeArgs,
          adapterRuntimeEnv,
        },
        executionForRuntime,
        startedAt,
        createWorkbenchExecutionCapability(executionForRuntime, { now: startedAt }),
      ),
    );
  }
  const fileStore = createWorkbenchSandboxFileStore(runtimeArgs);
  const planeFactory = options.createSandboxPlaneForProvider ?? createSandboxBackendPlaneForProvider;
  const plane = planeFactory(
    options.sandboxProvider,
    runtimeArgs,
    startedAt,
    fileStore,
  );
  const validated = await executeValidatedSandboxExecution(plane, executionForRuntime, {
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
  return completedJobFromSandboxResult(
    runtimeArgs.job,
    startedAt,
    validated.result,
  );
}

export function workbenchExecutionExecutorForRuntimeInput(
  args: Pick<WorkbenchExecutionRuntimeInput, "job" | "adapterManifests" | "runtimeControlOperation">,
): WorkbenchAdapterOperationExecutor {
  if (args.runtimeControlOperation) {
    return "sandbox";
  }
  const execution = readWorkbenchExecutionSpec(args.job);
  const operation = adapterOperationForExecutionPurpose(execution.purpose);
  if (!operation) {
    return "sandbox";
  }
  const manifest = args.adapterManifests?.find((entry) => entry.id === execution.adapter.use);
  return manifest ? workbenchAdapterOperationExecutor(manifest, operation) : "sandbox";
}

function adapterOperationForExecutionPurpose(
  purpose: WorkbenchExecutionSpec["purpose"],
): WorkbenchAdapterOperation | null {
  if (purpose === "improve") {
    return "candidate.improve";
  }
  if (purpose === "attempt") {
    return "engine.run";
  }
  return null;
}

const RUNTIME_CONTROL_MAX_BODY_BYTES = 512 * 1024 * 1024;

async function withWorkbenchRuntimeControlServer(
  args: WorkbenchExecutionRuntimeInput,
  options: WorkbenchExecutionJobOptions,
  startedAt: string,
  run: (env: Record<string, string>) => Promise<HostedWorkbenchJob>,
): Promise<HostedWorkbenchJob> {
  const [{ createServer }] = await Promise.all([
    importNodeModule<typeof import("node:http")>(nodeBuiltin("http")),
  ]);
  const token = randomBytes(24).toString("base64url");
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function handleWorkbenchRuntimeControlHttpRequest(args: {
  request: import("node:http").IncomingMessage;
  response: import("node:http").ServerResponse;
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
  response: import("node:http").ServerResponse,
  statusCode: number,
  payload: Json,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function readRuntimeControlBody(
  request: import("node:http").IncomingMessage,
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
  if (hasOwn(record, "candidate")) {
    inputs.candidate = normalizeRuntimeControlFiles(record.candidate, "inputs.candidate");
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
    operation !== "candidate.run" &&
    operation !== "candidate.improve"
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

function adapterAuthTargetKey(target: {
  adapterId: string;
  slot?: string;
  profile: string;
}): string {
  return `${target.adapterId}/${target.slot ?? "_"}/${target.profile}`;
}

export function workbenchExecutionPurpose(
  job: HostedWorkbenchJob,
): WorkbenchExecutionSpec["purpose"] | null {
  return readWorkbenchExecutionPurpose(job);
}

export async function executeAdapterInCurrentRuntime(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
  startedAt: string,
  capability: ReturnType<typeof createWorkbenchExecutionCapability>,
): Promise<HostedWorkbenchJob> {
  const eventPublisher = createWorkbenchExecutionEventPublisher({
    projectId: args.job.projectId,
    runId: args.job.runId,
    jobId: args.job.id,
    executionId: execution.id,
    attempt: Math.max(1, args.job.attempt),
    target: args.progress,
  });
  const adapterAuth = await materializeSandboxAdapterAuth(args, execution);
  const runtimeInput = {
    ...args,
    ...(adapterAuth.root ? { adapterAuthRoot: adapterAuth.root } : {}),
  };
  try {
    if (execution.purpose === "improve") {
      return await executeCandidateRevisionExecutionInCurrentRuntime(
        runtimeInput,
        execution,
        startedAt,
        capability,
        eventPublisher,
      );
    }
    if (execution.purpose === "attempt") {
      return await executeAttemptExecutionInCurrentRuntime(
        runtimeInput,
        execution,
        startedAt,
        capability,
        eventPublisher,
      );
    }
    throw new Error(`Unsupported execution purpose ${execution.purpose}.`);
  } catch (error) {
    return failWorkbenchRunJob(args.job, startedAt, error);
  } finally {
    if (adapterAuth.captureUpdates) {
      await persistMaterializedAdapterAuthUpdates(args, adapterAuth.captureUpdates);
    }
    if (adapterAuth.cleanup) {
      await adapterAuth.cleanup().catch(() => undefined);
    }
    await eventPublisher.flush().catch(() => undefined);
  }
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
  const [fs, os, path] = await Promise.all([
    importNodeModule<any>(nodeBuiltin("fs/promises")),
    importNodeModule<any>(nodeBuiltin("os")),
    importNodeModule<any>(nodeBuiltin("path")),
  ]);
  const base = args.workdir ?? os.tmpdir();
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "workbench-adapter-auth-"));
  await materializeAdapterAuthProfiles(adapterFileBundles, root, fs, path);
  return {
    ...(root ? { root } : {}),
    env,
    captureUpdates: async () =>
      await collectMaterializedAdapterAuthProfileUpdates(
        adapterFileBundles,
        root,
        fs,
        path,
      ),
    cleanup: async () => {
      if (root) {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  };
}

async function materializeAdapterAuthProfiles(
  bundles: readonly WorkbenchAdapterAuthBundle[],
  root: string,
  fs: typeof import("node:fs/promises"),
  path: typeof import("node:path"),
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
  fs: typeof import("node:fs/promises"),
  path: typeof import("node:path"),
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
  return entries;
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
  adapterId: string,
): Record<string, string> {
  void adapterId;
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

function adapterAuthProfilesForAdapter(
  args: Pick<WorkbenchExecutionRuntimeInput, "adapterAuthProfiles">,
  adapterId: string,
): WorkbenchAdapterAuthBundle[] {
  return (args.adapterAuthProfiles ?? [])
    .map((bundle) => sanitizeWorkbenchAdapterAuthBundle(bundle))
    .filter((bundle) => bundle.adapterId === adapterId);
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
  if (args.runtimeControlOperation) {
    return uniqueAdapterInvocations(args.runtimeControlOperation.operations.map((operation) => ({
      use: operation.invocation.use,
      with: operation.invocation.with ?? {},
      ...(operation.invocation.auth !== undefined ? { auth: operation.invocation.auth } : {}),
    })));
  }
  if (execution.purpose === "attempt") {
    return uniqueAdapterInvocations([execution.adapter, args.spec.run]);
  }
  return [execution.adapter];
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

function completedJobFromSandboxResult(
  fallbackJob: HostedWorkbenchJob,
  startedAt: string,
  result: WorkbenchExecutionResult,
): HostedWorkbenchJob {
  const completedJob = asRuntimeRecord(result.metadata).completedJob;
  if (
    completedJob &&
    typeof completedJob === "object" &&
    !Array.isArray(completedJob)
  ) {
    return completedJob as HostedWorkbenchJob;
  }
  if (result.status === "succeeded") {
    const finishedAt = result.finishedAt || new Date().toISOString();
    return {
      ...fallbackJob,
      status: "succeeded",
      attempt: Math.max(1, fallbackJob.attempt),
      startedAt: result.startedAt || startedAt,
      finishedAt,
      updatedAt: finishedAt,
      output: {
        ok: true,
        executionId: result.executionId,
      },
    };
  }
  return attachSandboxMetadataToJob(
    failWorkbenchRunJob(
      fallbackJob,
      result.startedAt || startedAt,
      result.error ?? `Sandbox execution ${result.status}.`,
      result.finishedAt,
    ),
    asRuntimeRecord(result.metadata).sandbox,
  );
}

async function executeCandidateRevisionExecutionInCurrentRuntime(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
  startedAt: string,
  capability: ReturnType<typeof createWorkbenchExecutionCapability>,
  eventPublisher?: WorkbenchExecutionEventPublisher,
): Promise<HostedWorkbenchJob> {
  const { workload, result } = await runHostedProtocolExecutionResult(
    args,
    execution,
    startedAt,
    capability,
    eventPublisher,
  );
  if (result.error || (result.exitCode ?? 0) !== 0) {
    return failWorkbenchRunJob(
      args.job,
      startedAt,
      result.error ?? `Adapter ${execution.adapter.use} exited with status ${result.exitCode}.`,
      result.finishedAt,
      result,
    );
  }

  const finishedAt = result.finishedAt ?? new Date().toISOString();
  const candidatePatch = createCandidatePatchFromResult(result, args.spec);
  if (candidatePatch.fileChanges.length === 0) {
    return failWorkbenchRunJob(
      args.job,
      startedAt,
      `${execution.adapter.use === "command" ? "Command improve adapter" : `Adapter ${execution.adapter.use}`} completed without changing candidate files covered by improve edits.`,
      finishedAt,
      result,
    );
  }
  const candidateRevisionFiles = applyWorkbenchCandidatePatch({
    baseFiles: workload.candidateFiles,
    patch: candidatePatch,
    edits: requireImproveEdits(args.spec),
  });
  const usage = assignUsageRole("improver", result.usage);
  return {
    ...args.job,
    status: "succeeded",
    attempt: Math.max(1, args.job.attempt),
    startedAt,
    finishedAt,
    updatedAt: finishedAt,
    output: {
      ok: true,
      executionId: execution.id,
      purpose: execution.purpose,
      candidateId: workload.candidateId,
      attemptIndex: workload.attemptIndex,
      baseId: workload.baseId,
      prompt: workload.prompt,
      candidatePatch,
      fileChanges: candidatePatch.fileChanges,
      files: candidateRevisionFiles,
      traces: traceFilePaths(result.files),
      ...(usage ? { usage } : {}),
      ...(result.summary !== undefined ? { summary: result.summary } : {}),
      ...(result.feedback !== undefined ? { feedback: result.feedback } : {}),
    } as unknown as Json,
  };
}

async function executeAttemptExecutionInCurrentRuntime(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
  startedAt: string,
  capability: ReturnType<typeof createWorkbenchExecutionCapability>,
  eventPublisher?: WorkbenchExecutionEventPublisher,
): Promise<HostedWorkbenchJob> {
  const workload = createWorkbenchRunWorkload({
    job: args.job,
    spec: args.spec,
    baseFiles: args.baseFiles,
    engineResolveFiles: args.engineResolveFiles,
    engineCases: args.engineCases,
    traceFiles: args.traceFiles,
  });
  const workloadResult = await runHostedCommandExecutionSteps(
    args,
    workload,
    attemptStepsForExecution(execution, args.spec, args.adapterManifests),
    startedAt,
    {
      capability,
      eventPublisher,
    },
  );
  if (workloadResult.error || (workloadResult.exitCode ?? 0) !== 0) {
    return failWorkbenchRunJob(
      args.job,
      startedAt,
      workloadResult.error ?? `Attempt adapter execution exited with status ${workloadResult.exitCode}.`,
      workloadResult.finishedAt,
      workloadResult,
    );
  }
  const engineResult = workloadResult.result;
  if (
    !engineResult ||
    typeof engineResult.score !== "number" ||
    !Number.isFinite(engineResult.score)
  ) {
    return failWorkbenchRunJob(
      args.job,
      startedAt,
      "Attempt engine must return a workbench-result result with a finite numeric score.",
      workloadResult.finishedAt,
      workloadResult,
    );
  }
  const finishedAt = workloadResult.finishedAt ?? new Date().toISOString();
  const usage = attemptUsageSummary(workloadResult.usage, engineResult.usage);
  const sample = evaluateSample({
    candidateId: workload.candidateId,
    files: workloadResult.files,
    engineResolveFiles: workload.engineResolveFiles,
    spec: workload.spec,
    attemptIndex: workload.attemptIndex,
    sampleIndex: workload.sampleIndex,
    caseId: workload.caseId,
    split: workload.engineCaseSpec?.split,
    startedAt,
    finishedAt,
    durationMs: workloadResult.durationMs,
    workload: {
      ...workloadResult,
      ...(usage ? { usage } : {}),
      result: engineResult,
    },
  });
  return {
    ...args.job,
    status: "succeeded",
    attempt: Math.max(1, args.job.attempt),
    startedAt,
    finishedAt: sample.finishedAt,
    updatedAt: sample.finishedAt ?? startedAt,
    output: {
      ok: true,
      executionId: execution.id,
      purpose: execution.purpose,
      candidateId: workload.candidateId,
      attemptIndex: workload.attemptIndex,
      sampleIndex: workload.sampleIndex,
      caseId: workload.caseId,
      prompt: workload.prompt,
      result: engineResult,
      fileChanges:
        workloadResult.fileChanges.length > 0
          ? workloadResult.fileChanges
          : workload.changedPaths,
      files: workloadResult.files,
      sample,
      ...(usage ? { usage } : {}),
      traces: traceFilePaths(workloadResult.files),
    } as unknown as Json,
  };
}

export async function executeRuntimeControlOperationSequenceInCurrentRuntime(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
  startedAt: string,
  capability?: WorkbenchExecutionCapability,
): Promise<HostedWorkbenchJob> {
  void execution;
  void capability;
  if (!args.runtimeControlOperation) {
    throw new Error("Runtime-control operation sequence is missing from the sandbox request.");
  }
  const childExecution = readWorkbenchExecutionSpec(args.job);
  const workload = createWorkbenchRunWorkload({
    job: args.job,
    spec: args.spec,
    baseFiles: args.baseFiles,
    engineResolveFiles: args.engineResolveFiles,
    engineCases: args.engineCases,
    traceFiles: args.traceFiles,
  });
  const runtimeArgs: WorkbenchExecutionRuntimeInput = { ...args };
  delete runtimeArgs.adapterRuntimeEnv;
  const adapterAuth = await materializeSandboxAdapterAuth(runtimeArgs, childExecution);
  let result: RuntimeWorkloadResult;
  try {
    result = await runHostedCommandExecutionSteps(
      {
        ...runtimeArgs,
        ...(adapterAuth.root ? { adapterAuthRoot: adapterAuth.root } : {}),
      },
      workload,
      args.runtimeControlOperation.operations.map((operation, index) =>
        runtimeControlStepForOperation(operation, index, args.adapterManifests)
      ),
      startedAt,
      {
        runCandidatePrepare: args.runtimeControlOperation.prepare ?? false,
        workspaceFiles: args.runtimeControlOperation.inputs?.workspace ?? [],
        outputFiles: args.runtimeControlOperation.inputs?.output ?? [],
        collectWorkspace: args.runtimeControlOperation.collectWorkspace ?? false,
      },
    );
  } finally {
    if (adapterAuth.captureUpdates) {
      await persistMaterializedAdapterAuthUpdates(runtimeArgs, adapterAuth.captureUpdates);
    }
    if (adapterAuth.cleanup) {
      await adapterAuth.cleanup().catch(() => undefined);
    }
  }
  const finishedAt = result.finishedAt ?? new Date().toISOString();
  const failed = Boolean(result.error) || (result.exitCode ?? 0) !== 0;
  return {
    ...args.job,
    status: failed ? "failed" : "succeeded",
    attempt: Math.max(1, args.job.attempt),
    startedAt,
    finishedAt,
    updatedAt: finishedAt,
    ...(failed ? { error: result.error ?? `Runtime-control operation sequence exited with status ${result.exitCode}.` } : {}),
    output: runtimeControlJobOutput(result, !failed) as unknown as Json,
  };
}

async function executeRuntimeControlOperationSequenceInSandbox(
  args: WorkbenchExecutionRuntimeInput,
  options: WorkbenchExecutionJobOptions,
  startedAt: string,
  request: WorkbenchRuntimeControlOperationSequenceRequest,
): Promise<WorkbenchRuntimeControlOperationSequenceResult> {
  const childArgs = createRuntimeControlSandboxInput(args, request);
  const execution = readWorkbenchExecutionSpec(childArgs.job);
  const fileStore = createWorkbenchSandboxFileStore(childArgs);
  const planeFactory = options.createSandboxPlaneForProvider ?? createSandboxBackendPlaneForProvider;
  const plane = planeFactory(
    options.sandboxProvider,
    childArgs,
    startedAt,
    fileStore,
  );
  assertSandboxBackendSupportsNetworkPolicy(plane.backend, execution);
  const sandboxOptions = {
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
  };
  const inputs = await fileStore.materializeInputs(execution);
  const environment = plane.prepareEnvironment
    ? await plane.prepareEnvironment(execution, sandboxOptions)
    : {
        backend: plane.backend.name,
        kind: execution.sandbox.kind,
        ref: execution.sandbox.ref,
      };
  const allocation = createWorkbenchSandboxAllocation(execution, {
    backend: plane.backend.name,
    runnerId: sandboxOptions.runnerId,
    now: startedAt,
  });
  const capability = createWorkbenchExecutionCapability(execution, { now: startedAt });
  assertRuntimeControlScope("Runtime-control sandbox allocation", collectSandboxAllocationScopeIssues(allocation, execution, { now: startedAt }));
  assertRuntimeControlScope("Runtime-control execution capability", collectExecutionCapabilityScopeIssues(capability, execution, { now: startedAt }));
  const sandbox = await plane.createSandbox({
    execution,
    environment,
    allocation,
    capability,
    inputs,
  }, sandboxOptions);
  assertRuntimeControlScope("Runtime-control sandbox handle", collectSandboxHandleScopeIssues(sandbox, allocation, execution));
  let result: WorkbenchExecutionResult;
  try {
    result = await plane.exec({
      execution,
      environment,
      sandbox,
      allocation,
      capability,
      inputs,
    }, sandboxOptions);
  } finally {
    await plane.destroySandbox(sandbox, sandboxOptions);
  }
  const completedJob = completedJobFromSandboxResult(childArgs.job, startedAt, result);
  return runtimeControlResultFromCompletedJob(completedJob);
}

function createRuntimeControlSandboxInput(
  args: WorkbenchExecutionRuntimeInput,
  request: WorkbenchRuntimeControlOperationSequenceRequest,
): WorkbenchExecutionRuntimeInput {
  const parentExecution = readWorkbenchExecutionSpec(args.job);
  const parentWorkload = createWorkbenchRunWorkload({
    job: args.job,
    spec: args.spec,
    baseFiles: args.baseFiles,
    engineResolveFiles: args.engineResolveFiles,
    engineCases: args.engineCases,
    traceFiles: args.traceFiles,
  });
  const nonce = runtimeControlNonce();
  const childExecutionId = `${parentExecution.id}:runtime:${nonce}`;
  const childJobId = `${args.job.id}:runtime:${nonce}`;
  const parentInput = asRuntimeRecord(args.job.input);
  const publicFiles = runtimeControlInputFiles(
    request.inputs,
    "case",
    parentWorkload.engineCase ? engineCasePublicFiles(parentWorkload.engineCase) : [],
  );
  const privateFiles = runtimeControlInputFiles(
    request.inputs,
    "enginePrivate",
    parentWorkload.engineCase ? engineCasePrivateFiles(parentWorkload.engineCase) : [],
  );
  const candidateFiles = runtimeControlInputFiles(
    request.inputs,
    "candidate",
    parentWorkload.candidateFiles,
  );
  const traceFiles = runtimeControlInputFiles(
    request.inputs,
    "traces",
    parentWorkload.traceFiles,
  );
  const adapter = request.operations[request.operations.length - 1]?.invocation;
  const childExecution: WorkbenchExecutionSpec = {
    ...parentExecution,
    id: childExecutionId,
    outputs: [],
    adapter: adapter
      ? {
          use: adapter.use,
          with: adapter.with ?? {},
          ...(adapter.auth !== undefined ? { auth: adapter.auth } : {}),
        }
      : parentExecution.adapter,
    metadata: {
      ...asRuntimeRecord(parentExecution.metadata),
      runtimeControl: true,
      caseId: parentWorkload.caseId,
    },
  };
  const engineCase: WorkbenchEngineCase = {
    id: parentWorkload.caseId,
    case: parentWorkload.engineCaseSpec ?? {
      version: 3,
      prompt: parentWorkload.prompt,
    },
    files: {
      public: publicFiles,
      private: privateFiles,
    },
  };
  const childJob: HostedWorkbenchJob = {
    ...args.job,
    id: childJobId,
    input: {
      ...parentInput,
      execution: childExecution as unknown as Json,
      caseId: parentWorkload.caseId,
    } as unknown as Json,
  };
  const childArgs: WorkbenchExecutionRuntimeInput = {
    ...args,
    job: childJob,
    baseFiles: candidateFiles,
    engineResolveFiles: [...publicFiles, ...privateFiles],
    engineCases: [engineCase],
    traceFiles,
    runtimeControlOperation: request,
  };
  delete childArgs.adapterRuntimeEnv;
  delete childArgs.workspaceRoot;
  return childArgs;
}

function runtimeControlInputFiles(
  inputs: WorkbenchRuntimeControlOperationSequenceRequest["inputs"],
  key: keyof NonNullable<WorkbenchRuntimeControlOperationSequenceRequest["inputs"]>,
  fallback: readonly SurfaceSnapshotFile[],
): SurfaceSnapshotFile[] {
  if (inputs && Object.prototype.hasOwnProperty.call(inputs, key)) {
    return cloneSurfaceFiles(inputs[key] ?? []);
  }
  return cloneSurfaceFiles(fallback);
}

function runtimeControlStepForOperation(
  operation: WorkbenchRuntimeControlOperation,
  index: number,
  manifests: readonly WorkbenchAdapterManifest[] = [],
): WorkbenchWorkloadStepCommand {
  const commandSpec = adapterProtocolCommandSpec(
    {
      use: operation.invocation.use,
      with: operation.invocation.with ?? {},
      ...(operation.invocation.auth !== undefined ? { auth: operation.invocation.auth } : {}),
    },
    operation.operation,
    manifests,
  );
  const command = operation.invocation.command?.trim() || commandSpec.command;
  return {
    kind: operation.operation === "candidate.run"
      ? "candidate"
      : operation.operation === "candidate.improve"
        ? "improver"
        : "engine",
    label: operation.label ?? `${operation.operation.replace(".", "_")}_${index + 1}`,
    operation: operation.operation,
    executor: commandSpec.executor,
    adapter: {
      use: operation.invocation.use,
      with: operation.invocation.with ?? {},
      ...(operation.invocation.auth !== undefined ? { auth: operation.invocation.auth } : {}),
    },
    command,
  };
}

function runtimeControlResultFromCompletedJob(
  job: HostedWorkbenchJob,
): WorkbenchRuntimeControlOperationSequenceResult {
  return normalizeRuntimeControlResultOutput(asRuntimeRecord(job.output), job.status === "succeeded", job.error);
}

function runtimeControlJobOutput(
  result: RuntimeWorkloadResult,
  ok: boolean,
): Record<string, Json> {
  return normalizeRuntimeControlResultOutput({
    ok,
    files: result.files as unknown as Json,
    fileChanges: result.fileChanges as unknown as Json,
    ...(result.operationResults ? { operationResults: result.operationResults as unknown as Json } : {}),
    ...(result.workspaceFiles ? { workspaceFiles: result.workspaceFiles as unknown as Json } : {}),
    ...(result.result ? { result: result.result as unknown as Json } : {}),
    ...(result.usage ? { usage: result.usage as unknown as Json } : {}),
    ...(result.summary !== undefined ? { summary: result.summary } : {}),
    ...(result.feedback !== undefined ? { feedback: result.feedback } : {}),
    ...(result.error ? { error: result.error } : {}),
  }, ok, result.error) as unknown as Record<string, Json>;
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
      record.operation === "candidate.run" ||
      record.operation === "candidate.improve");
}

function cloneSurfaceFiles(
  files: readonly SurfaceSnapshotFile[],
): SurfaceSnapshotFile[] {
  return files.map((file) => ({ ...file, path: normalizeRelativePath(file.path) }));
}

function runtimeControlNonce(): string {
  return randomBytes(6).toString("hex");
}

function assertRuntimeControlScope(label: string, issues: readonly string[]): void {
  if (issues.length > 0) {
    throw new Error(`${label} failed validation:\n${issues.join("\n")}`);
  }
}

async function runHostedProtocolExecutionResult(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
  startedAt: string,
  capability: ReturnType<typeof createWorkbenchExecutionCapability>,
  eventPublisher?: WorkbenchExecutionEventPublisher,
): Promise<{ workload: WorkbenchRunWorkload; result: RuntimeWorkloadResult }> {
  const workload = createWorkbenchRunWorkload({
    job: args.job,
    spec: args.spec,
    baseFiles: args.baseFiles,
    engineResolveFiles: args.engineResolveFiles,
    engineCases: args.engineCases,
    traceFiles: args.traceFiles,
  });
  const result = await runHostedCommandExecutionSteps(
    args,
    workload,
    [protocolStepForExecution(execution, args.adapterManifests)],
    startedAt,
    {
      capability,
      eventPublisher,
    },
  );
  return { workload, result };
}

async function runHostedCommandExecutionSteps(
  args: WorkbenchExecutionRuntimeInput,
  workload: WorkbenchRunWorkload,
  steps: readonly WorkbenchWorkloadStepCommand[],
  startedAt: string,
  options: {
    capability?: ReturnType<typeof createWorkbenchExecutionCapability>;
    eventPublisher?: WorkbenchExecutionEventPublisher;
    runCandidatePrepare?: boolean;
    workspaceFiles?: readonly SurfaceSnapshotFile[];
    outputFiles?: readonly SurfaceSnapshotFile[];
    collectWorkspace?: boolean;
  } = {},
): Promise<RuntimeWorkloadResult> {
  const [{ execFile }, fs, os, path, { promisify }] = await Promise.all([
    importNodeModule<any>(nodeBuiltin("child_process")),
    importNodeModule<any>(nodeBuiltin("fs/promises")),
    importNodeModule<any>(nodeBuiltin("os")),
    importNodeModule<any>(nodeBuiltin("path")),
    importNodeModule<any>(nodeBuiltin("util")),
  ]);
  const execFileAsync = promisify(execFile);
  const resolvedRuntime = workload.engineCaseSpec
    ? resolveEngineCaseExecutionConfig({
        spec: workload.spec,
        engineCase: workload.engineCaseSpec,
      }).environment
    : workload.spec.environment;
  const environmentVersion =
    args.environmentVersion
      ? environmentVersionForRuntime(resolvedRuntime, args.environmentVersion)
      : environmentVersionForRuntime(resolvedRuntime);
  const workspace = await createRuntimeWorkspaceRoot(
    args,
    fs,
    os,
    path,
    "workbench-execution-sandbox-",
  );
  try {
    await stageWorkbenchRunWorkload(workspace.root, workload);
    if (options.workspaceFiles && options.workspaceFiles.length > 0) {
      await stageInitialWorkspaceFiles(workspace.root, options.workspaceFiles);
    }
    if (options.outputFiles && options.outputFiles.length > 0) {
      await writeSurfaceFiles(outputDir(workspace.root), options.outputFiles);
    }
    const execution = readWorkbenchExecutionSpec(workload.job);
    const hostAdapterIds = new Set(
      steps.flatMap((step) => step.executor === "host"
        ? [step.adapter?.use ?? execution.adapter.use]
        : []),
    );
    const hostAdapterRoots = hostAdapterIds.size > 0
      ? await materializeHostAdapterRoots(
          workspace.root,
          args.adapterFiles ?? [],
          hostAdapterIds,
        )
      : new Map<string, string>();
    let exitCode = 0;
    let runtimeError: string | undefined;
    const operationResults: WorkbenchAdapterOperationResult[] = [];
    try {
      if (!environmentVersion) {
        throw new Error(
          "environment is required for adapter command executions.",
        );
      }
      if (environmentVersion) {
        await fs.writeFile(
          path.join(outputDir(workspace.root), "sandbox-environment.json"),
          `${JSON.stringify(
            {
              imageRef: environmentVersion.imageRef,
              resources: environmentVersion.spec.resources,
              network: environmentVersion.spec.network,
            },
            null,
            2,
          )}\n`,
        );
      }
      const stepTimeoutMs = environmentVersion
        ? environmentVersionTimeoutMs(environmentVersion)
        : 5 * 60 * 1000;
      const shouldRunCandidatePrepare =
        options.runCandidatePrepare ??
        (readWorkloadExecutionPurpose(workload) === "attempt" &&
          steps.some((step) => step.executor === "sandbox"));
      if (shouldRunCandidatePrepare) {
        await runCandidatePrepareCommand({
          root: workspace.root,
          workload,
          execution,
          execFileAsync,
          timeoutMs: stepTimeoutMs,
          eventPublisher: options.eventPublisher,
        });
      }
      let enginePrivateStaged = false;
      for (const step of steps) {
        if (step.kind === "engine" && !enginePrivateStaged) {
          await stageWorkbenchEnginePrivateFiles(workspace.root, workload);
          enginePrivateStaged = true;
        }
        await resetHostedWorkloadStepOutput(workspace.root);
        const stepAdapterId = step.adapter?.use ?? execution.adapter.use;
        const adapterRequestPath = await writeWorkbenchAdapterRequest(
          workspace.root,
          workload,
          execution,
          step,
          adapterAuthRequestForStep(args, stepAdapterId),
          args.adapterManifests,
        );
        const stepRole = stepEventRole(step);
        await publishCommandStepEvent(options.eventPublisher, {
          step: step.label,
          status: "started",
          ...(stepRole ? { role: stepRole } : {}),
        });
        try {
          if (!step.command) {
            throw new Error(`Adapter step ${step.label} is missing a command.`);
          }
          const adapterRoot = step.executor === "host"
            ? hostAdapterRoots.get(stepAdapterId)
            : undefined;
          const command = createHostedWorkloadShellCommand(
            workspace.root,
            step.command,
            step.label,
            step.okExitCodes,
          );
          await execFileAsync("sh", ["-c", command], {
            cwd: adapterRoot ?? workspace.root,
            env: createHostedWorkloadAdapterEnv(
              workspace.root,
              adapterRequestPath,
              adapterAuthEnvForStep(args, stepAdapterId),
              adapterRoot ? { adapterRoot } : undefined,
              args.adapterRuntimeEnv,
            ),
            maxBuffer: 10 * 1024 * 1024,
            timeout: stepTimeoutMs,
          });
          const operationResult = await readWorkbenchAdapterOperationResult(outputDir(workspace.root), step.operation);
          assertWorkbenchAdapterOperationResultOk(
            operationResult,
            `Adapter ${stepAdapterId} ${step.operation}`,
          );
          await writeSurfaceFiles(outputDir(workspace.root), [
            textSurfaceFile(
              `.workbench/traces/${workload.job.id}/${step.label}/result.json`,
              `${JSON.stringify(operationResult, null, 2)}\n`,
            ),
          ]);
          operationResults.push(operationResult);
          await publishCommandStepEvent(options.eventPublisher, {
            step: step.label,
            status: "succeeded",
            ...(stepRole ? { role: stepRole } : {}),
          });
        } catch (error) {
          await publishCommandStepEvent(options.eventPublisher, {
            step: step.label,
            status: "failed",
            exitCode: readExitCode(error),
            error: error instanceof Error ? error.message : String(error),
            ...(stepRole ? { role: stepRole } : {}),
          });
          throw error;
        }
      }
    } catch (error) {
      exitCode = readExitCode(error);
      if (exitCode === 0) {
        exitCode = 1;
      }
      runtimeError =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      await fs
        .writeFile(
          path.join(outputDir(workspace.root), "sandbox_error.log"),
          `${runtimeError}\n`,
        )
        .catch(() => undefined);
    }
    if (exitCode !== 0) {
      return await readHostedRunFailureResult(workspace.root, workload, {
        exitCode,
        error:
          runtimeError ?? `Runtime command exited with status ${exitCode}.`,
        startedAt,
      });
    }
    const result = await readWorkbenchRunWorkloadResult(workspace.root, workload, {
      exitCode,
      startedAt,
      operationResults,
    });
    if (options.collectWorkspace) {
      result.workspaceFiles = await readMutableWorkspaceSnapshotFiles(workspace.root);
    }
    return result;
  } finally {
    await workspace.cleanup();
  }
}

async function runCandidatePrepareCommand(args: {
  root: string;
  workload: WorkbenchRunWorkload;
  execution: WorkbenchExecutionSpec;
  execFileAsync: (
    file: string,
    args: string[],
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  timeoutMs: number;
  eventPublisher?: WorkbenchExecutionEventPublisher;
}): Promise<void> {
  const command = args.workload.spec.candidate.prepare?.command;
  if (!command) {
    return;
  }
  const role = args.execution.purpose === "improve" ? "improver" : "runner";
  await publishCommandStepEvent(args.eventPublisher, {
    step: "candidate_prepare",
    status: "started",
    role,
  });
  try {
    const shellCommand = createHostedWorkloadShellCommand(
      args.root,
      command,
      "candidate_prepare",
    );
    await args.execFileAsync("sh", ["-c", shellCommand], {
      cwd: args.root,
      env: createHostedWorkloadPrepareEnv(args.root),
      maxBuffer: 10 * 1024 * 1024,
      timeout: args.timeoutMs,
    });
    await publishCommandStepEvent(args.eventPublisher, {
      step: "candidate_prepare",
      status: "succeeded",
      role,
    });
  } catch (error) {
    await publishCommandStepEvent(args.eventPublisher, {
      step: "candidate_prepare",
      status: "failed",
      exitCode: readExitCode(error),
      error: error instanceof Error ? error.message : String(error),
      role,
    });
    throw new Error(`Candidate prepare command failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function createRuntimeWorkspaceRoot(
  args: Pick<WorkbenchExecutionRuntimeInput, "workdir" | "workspaceRoot">,
  fs: typeof import("node:fs/promises"),
  os: typeof import("node:os"),
  path: typeof import("node:path"),
  prefix: string,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  if (args.workspaceRoot) {
    await fs.mkdir(args.workspaceRoot, { recursive: true });
    return { root: args.workspaceRoot, cleanup: async () => undefined };
  }
  if (args.workdir) {
    await fs.mkdir(args.workdir, { recursive: true });
    const root = await fs.mkdtemp(path.join(args.workdir, prefix));
    return {
      root,
      cleanup: async () => {
        await fs
          .rm(root, { force: true, recursive: true })
          .catch(() => undefined);
      },
    };
  }
  const sandboxRoot = "/workspace";
  const sandboxRootStat = await fs.stat(sandboxRoot).catch(() => null);
  if (sandboxRootStat?.isDirectory()) {
    return {
      root: sandboxRoot,
      cleanup: async () => undefined,
    };
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    root,
    cleanup: async () => {
      await fs
        .rm(root, { force: true, recursive: true })
        .catch(() => undefined);
    },
  };
}

function stepEventRole(
  step: WorkbenchWorkloadStepCommand,
): "improver" | "runner" | "engine" | undefined {
  if (step.kind === "improver") {
    return "improver";
  }
  if (step.kind === "candidate") {
    return "runner";
  }
  if (step.kind === "engine") {
    return "engine";
  }
  return undefined;
}

function adapterOperationUsageSummary(
  result: WorkbenchAdapterOperationResult,
): UsageSummary | undefined {
  if (hasExplicitUsageRole(result.usage)) {
    return completeUsageSummary(result.usage);
  }
  if (result.operation === "candidate.improve") {
    return assignUsageRole("improver", result.usage);
  }
  if (result.operation === "candidate.run") {
    return assignUsageRole("runner", result.usage);
  }
  if (result.operation === "engine.run") {
    return assignUsageRole("engine", result.usage);
  }
  return result.usage;
}

function attemptUsageSummary(
  workloadUsage: UsageSummary | undefined,
  resultUsage: UsageSummary | undefined,
): UsageSummary | undefined {
  const normalizedWorkloadUsage = completeUsageSummary(workloadUsage);
  const resultEngineUsage = normalizedWorkloadUsage?.engine
    ? undefined
    : assignUsageRole("engine", resultUsage);
  return mergeUsageSummaries([normalizedWorkloadUsage, resultEngineUsage]);
}

function hasExplicitUsageRole(usage: UsageSummary | undefined): boolean {
  const normalized = completeUsageSummary(usage);
  return Boolean(normalized?.improver || normalized?.runner || normalized?.engine);
}

function createCandidatePatchFromResult(
  result: RuntimeWorkloadResult,
  spec: GenericRunSpec,
): WorkbenchCandidatePatch {
  if (result.candidatePatch) {
    return result.candidatePatch;
  }
  const changedEditPaths = result.fileChanges
    .map(normalizeRelativePath)
    .filter(
      (filePath) =>
        !filePath.startsWith(".workbench/") &&
        isCandidateEditPath(filePath, improveEdits(spec)),
    );
  const changedSet = new Set(changedEditPaths);
  const files = result.files
    .filter((file) => changedSet.has(normalizeRelativePath(file.path)))
    .map((file) => ({ ...file, path: normalizeRelativePath(file.path) }));
  return {
    files,
    fileChanges: changedEditPaths,
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.feedback !== undefined ? { feedback: result.feedback } : {}),
  };
}

function isCandidateEditPath(
  filePath: string,
  edits: readonly string[],
): boolean {
  const normalized = normalizeRelativePath(filePath);
  return edits.some((entry) => {
    const editPath = normalizeRelativePath(entry).replace(/\/+$/u, "");
    return (
      normalized === editPath || normalized.startsWith(`${editPath}/`)
    );
  });
}

function environmentVersionForSpec(
  spec: GenericRunSpec,
): Pick<HostedWorkbenchEnvironmentVersion, "id" | "imageRef" | "spec"> {
  return environmentVersionForRuntime(spec.environment);
}

function environmentVersionForRuntime(
  runtime: GenericRunSpec["environment"],
  base?: Pick<HostedWorkbenchEnvironmentVersion, "id" | "imageRef" | "spec">,
): Pick<HostedWorkbenchEnvironmentVersion, "id" | "imageRef" | "spec"> {
  const image = runtime.dockerfile;
  const resolved = findEnvironmentVersionForImage(
    image,
    DEFAULT_ENVIRONMENT_VERSIONS,
  ) ?? base;
  if (resolved) {
    return {
      id: resolved.id,
      imageRef: resolved.imageRef,
      spec: {
        ...resolved.spec,
        network: environmentNetwork(runtime),
        resources: definedEnvironmentResources(environmentResources(runtime)),
      },
    };
  }
  return {
    id: "spec_environment",
    imageRef: image.startsWith("dockerfile://")
      ? image
      : `dockerfile://${image}`,
    spec: {
      base: "custom",
      network: environmentNetwork(runtime),
      resources: definedEnvironmentResources(environmentResources(runtime)),
    },
  };
}

type RuntimeEnvironmentResources = Partial<
  HostedWorkbenchEnvironmentVersion["spec"]["resources"]
>;

function definedEnvironmentResources(
  resources: RuntimeEnvironmentResources | undefined,
): NonNullable<HostedWorkbenchEnvironmentVersion["spec"]["resources"]> {
  return {
    cpu: resources?.cpu ?? 2,
    memoryGb: resources?.memoryGb ?? 4,
    diskGb: resources?.diskGb ?? 10,
    timeoutMinutes: resources?.timeoutMinutes ?? 30,
  };
}

export async function stageWorkbenchRunWorkload(
  root: string,
  workload: WorkbenchRunWorkload,
): Promise<void> {
  const fs = await importNodeModule<any>(nodeBuiltin("fs/promises"));
  const purpose = readWorkloadExecutionPurpose(workload);
  await Promise.all([
    fs
      .rm(inputDir(root), { recursive: true, force: true })
      .catch(() => undefined),
    fs
      .rm(outputDir(root), { recursive: true, force: true })
      .catch(() => undefined),
    fs
      .rm(runtimePrivateDir(root), { recursive: true, force: true })
      .catch(() => undefined),
  ]);
  await fs.mkdir(inputDir(root), { recursive: true });
  await fs.mkdir(outputDir(root), { recursive: true });
  await clearMutableWorkspaceFiles(root);
  if (purpose === "attempt") {
    await fs.mkdir(candidateDir(root), { recursive: true });
    await fs.mkdir(caseDir(root), { recursive: true });
    const engineCase = requireWorkloadEngineCase(workload, "Attempt staging");
    await writeSurfaceFiles(candidateDir(root), workload.candidateFiles);
    await writeSurfaceFiles(caseDir(root), engineCasePublicFiles(engineCase));
    return;
  }
  if (purpose === "improve") {
    await writeSurfaceFiles(
      root,
      workload.candidateFiles.filter((file) => isMutableWorkspaceSnapshotPath(file.path)),
    );
    await fs.mkdir(tracesDir(root), { recursive: true });
    await writeSurfaceFiles(tracesDir(root), workload.traceFiles);
  }
}

async function clearMutableWorkspaceFiles(root: string): Promise<void> {
  const fs = await importNodeModule<any>(nodeBuiltin("fs/promises"));
  const path = await importNodeModule<any>(nodeBuiltin("path"));
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry: { name: string }) => {
    const relativePath = normalizeRelativePath(entry.name);
    if (!isMutableWorkspaceSnapshotPath(relativePath)) {
      return;
    }
    await fs.rm(path.join(root, entry.name), { recursive: true, force: true });
  }));
}

async function stageWorkbenchEnginePrivateFiles(
  root: string,
  workload: WorkbenchRunWorkload,
): Promise<void> {
  if (readWorkloadExecutionPurpose(workload) !== "attempt") {
    return;
  }
  const fs = await importNodeModule<any>(nodeBuiltin("fs/promises"));
  await fs.mkdir(runtimeEnginePrivateDir(root), { recursive: true });
  await writeSurfaceFiles(
    runtimeEnginePrivateDir(root),
    engineCasePrivateFiles(requireWorkloadEngineCase(workload, "Engine-private staging")),
  );
}

async function stageInitialWorkspaceFiles(
  root: string,
  files: readonly SurfaceSnapshotFile[],
): Promise<void> {
  await writeSurfaceFiles(root, files.filter((file) => isMutableWorkspaceSnapshotPath(file.path)));
}

async function readMutableWorkspaceSnapshotFiles(
  root: string,
): Promise<SurfaceSnapshotFile[]> {
  return (await readSurfaceFiles(root))
    .filter((file) => isMutableWorkspaceSnapshotPath(file.path))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function isMutableWorkspaceSnapshotPath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  return Boolean(
    normalized &&
      !normalized.startsWith("../") &&
      normalized !== "input" &&
      !normalized.startsWith("input/") &&
      normalized !== "private" &&
      !normalized.startsWith("private/") &&
      normalized !== "output" &&
      !normalized.startsWith("output/") &&
      normalized !== ".workbench" &&
      !normalized.startsWith(".workbench/"),
  );
}

async function materializeHostAdapterRoots(
  root: string,
  adapterFiles: readonly SurfaceSnapshotFile[],
  adapterIds: ReadonlySet<string>,
): Promise<Map<string, string>> {
  if (adapterFiles.length === 0 || adapterIds.size === 0) {
    return new Map();
  }
  const fs = await importNodeModule<any>(nodeBuiltin("fs/promises"));
  const path = await importNodeModule<any>(nodeBuiltin("path"));
  const sourceRoots = hostAdapterSourceRoots(adapterFiles, adapterIds);
  const roots = new Map<string, string>();
  for (const [adapterId, sourceRoot] of sourceRoots) {
    const targetRoot = path.join(root, ".workbench", "adapters", adapterId);
    const files = adapterFiles.flatMap((file) => {
      const relativePath = adapterFilePathWithinRoot(file.path, sourceRoot);
      return relativePath === null
        ? []
        : [{ ...file, path: relativePath }];
    });
    await fs.rm(targetRoot, { recursive: true, force: true }).catch(() => undefined);
    await fs.mkdir(targetRoot, { recursive: true });
    await writeSurfaceFiles(targetRoot, files);
    roots.set(adapterId, await fs.realpath(targetRoot));
  }
  return roots;
}

function hostAdapterSourceRoots(
  adapterFiles: readonly SurfaceSnapshotFile[],
  adapterIds: ReadonlySet<string>,
): Map<string, string> {
  const roots = new Map<string, string>();
  for (const file of adapterFiles) {
    const normalized = normalizeRelativePath(file.path);
    if (!normalized.endsWith("workbench.adapter.yaml")) {
      continue;
    }
    const manifest = parseWorkbenchAdapterManifest(file.content);
    if (!adapterIds.has(manifest.id)) {
      continue;
    }
    const sourceRoot = normalized === "workbench.adapter.yaml"
      ? ""
      : normalized.slice(0, -"workbench.adapter.yaml".length).replace(/\/+$/u, "");
    roots.set(manifest.id, sourceRoot);
  }
  return roots;
}

function adapterFilePathWithinRoot(
  filePath: string,
  sourceRoot: string,
): string | null {
  const normalized = normalizeRelativePath(filePath);
  if (!sourceRoot) {
    return normalized;
  }
  if (!normalized.startsWith(`${sourceRoot}/`)) {
    return null;
  }
  return normalized.slice(sourceRoot.length + 1);
}

async function readHostedRunFailureResult(
  root: string,
  workload: WorkbenchRunWorkload,
  options: { exitCode: number; error: string; startedAt?: string },
): Promise<RuntimeWorkloadResult> {
  const traceFiles = await readRuntimeTraceFiles(root, workload);
  const outputFiles = filterRuntimeOutputFiles(
    await readSurfaceFiles(outputDir(root), { ignorePath: isWorkbenchInternalOutputPath }),
  );
  const startedAt = options.startedAt ?? new Date().toISOString();
  const finishedAt = new Date().toISOString();
  const files = [...outputFiles, ...traceFiles].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  return {
    files,
    fileChanges: files.map((file) => file.path),
    exitCode: options.exitCode,
    error: options.error,
    startedAt,
    finishedAt,
  };
}

async function readWorkbenchRunWorkloadResult(
  root: string,
  workload: WorkbenchRunWorkload,
  options: {
    exitCode?: number;
    error?: string;
    startedAt?: string;
    usage?: UsageSummary;
    operationResults?: readonly WorkbenchAdapterOperationResult[];
  } = {},
): Promise<RuntimeWorkloadResult> {
  const path = await importNodeModule<any>(nodeBuiltin("path"));
  const traceFiles = await readRuntimeTraceFiles(root, workload);
  const outputFiles = filterRuntimeOutputFiles(
    await readSurfaceFiles(outputDir(root), { ignorePath: isWorkbenchInternalOutputPath }),
  );
  const outputExitCode = await readOptionalNumber(
    path.join(outputDir(root), "exit_code"),
  );
  const startedAt = options.startedAt ?? new Date().toISOString();
  const finishedAt = new Date().toISOString();
  const purpose = readWorkloadExecutionPurpose(workload);
  const primaryOperation: WorkbenchAdapterOperation = purpose === "improve"
    ? "candidate.improve"
    : "engine.run";
  const primaryResult = [...(options.operationResults ?? [])]
    .reverse()
    .find((result) => result.operation === primaryOperation);
  const resultPayload = jsonRecord(primaryResult?.value);
  const usage = mergeUsageSummaries([
    options.usage,
    ...(options.operationResults ?? []).map(adapterOperationUsageSummary),
  ]);
  const metrics = normalizeResultMetrics(resultPayload.metrics);
  const cases = normalizeResultCases(resultPayload.cases);
  const includeResultScoring = purpose === "attempt";
  const files = [...outputFiles, ...traceFiles].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const candidatePatch =
    purpose === "improve" ? primaryResult?.value as WorkbenchCandidatePatch | undefined : undefined;
  const engineResult =
    purpose === "attempt" ? primaryResult?.value as WorkbenchResult | undefined : undefined;
  const declaredChanges =
    candidatePatch?.fileChanges ??
    (Array.isArray(resultPayload.fileChanges)
      ? resultPayload.fileChanges.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : files.map((file) => file.path));
  return {
    files,
    fileChanges: declaredChanges,
    ...(options.operationResults ? { operationResults: [...options.operationResults] } : {}),
    ...(candidatePatch ? { candidatePatch } : {}),
    ...(engineResult ? { result: engineResult } : {}),
    ...(includeResultScoring && metrics ? { metrics } : {}),
    ...(includeResultScoring && cases ? { cases } : {}),
    ...(typeof resultPayload.summary === "string"
      ? { summary: resultPayload.summary }
      : primaryResult?.summary !== undefined
        ? { summary: primaryResult.summary }
        : {}),
    ...(resultPayload.feedback !== undefined
      ? { feedback: resultPayload.feedback as Json }
      : primaryResult?.feedback !== undefined
        ? { feedback: primaryResult.feedback }
      : {}),
    ...(usage ? { usage } : {}),
    exitCode: options.exitCode ?? outputExitCode ?? 0,
    ...(options.error ? { error: options.error } : {}),
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
  };
}

async function readRuntimeTraceFiles(
  root: string,
  workload: WorkbenchRunWorkload,
): Promise<SurfaceSnapshotFile[]> {
  const path = await importNodeModule<any>(nodeBuiltin("path"));
  const traceRoot = path.join(outputDir(root), ".workbench", "traces", workload.job.id);
  const purpose = readWorkloadExecutionPurpose(workload);
  const outputTraceRoot = workbenchTraceExecutionDirectory({
    sequence: 1,
    runId: workload.job.runId,
    purpose,
  });
  return (await readSurfaceFiles(traceRoot)).map((file) => ({
    ...file,
    path: normalizeRelativePath(`${outputTraceRoot}/${workload.job.id}/${file.path}`),
  }));
}

function filterRuntimeOutputFiles(
  files: readonly SurfaceSnapshotFile[],
): SurfaceSnapshotFile[] {
  return files.filter((file) => !isWorkbenchInternalOutputPath(file.path));
}

function createHostedWorkloadShellCommand(
  root: string,
  command: string,
  prefix = "",
  okExitCodes: readonly number[] = [0],
): string {
  const outputPrefix = prefix ? `${prefix}_` : "";
  const okExpression = [...new Set(okExitCodes)]
    .sort((left, right) => left - right)
    .map((code) => `[ "$status" -eq ${code} ]`)
    .join(" || ");
  const output = quoteShellArg(outputDir(root));
  const stdout = quoteShellArg(`${outputDir(root)}/${outputPrefix}stdout.log`);
  const stderr = quoteShellArg(`${outputDir(root)}/${outputPrefix}stderr.log`);
  return [
    `mkdir -p ${output}`,
    `(${command}) > ${stdout} 2> ${stderr}`,
    "status=$?",
    `printf '%s\\n' "$status" > ${quoteShellArg(`${outputDir(root)}/${outputPrefix}exit_code`)}`,
    okExpression ? `{ ${okExpression}; } && exit 0` : "",
    `if [ -s ${stderr} ]; then sed -n '1,120p' ${stderr} >&2; fi`,
    `if [ -s ${stdout} ]; then sed -n '1,40p' ${stdout} >&2; fi`,
    'exit "$status"',
  ].join("; ");
}

async function resetHostedWorkloadStepOutput(
  root: string,
): Promise<void> {
  const fs = await importNodeModule<any>(nodeBuiltin("fs/promises"));
  await fs
    .rm(workbenchAdapterOperationResultPath(outputDir(root)), { force: true })
    .catch(() => undefined);
}

async function writeWorkbenchAdapterRequest(
  root: string,
  workload: WorkbenchRunWorkload,
  execution: WorkbenchExecutionSpec,
  step: WorkbenchWorkloadStepCommand,
  auth?: Json,
  manifests?: readonly WorkbenchAdapterManifest[],
): Promise<string> {
  const [fs, path] = await Promise.all([
    importNodeModule<any>(nodeBuiltin("fs/promises")),
    importNodeModule<any>(nodeBuiltin("path")),
  ]);
  const requestPath = path.join(root, ".workbench", "request.json");
  await fs.mkdir(path.dirname(requestPath), { recursive: true });
  const casePrompt = workload.engineCaseSpec?.prompt;
  const caseSplit = workload.engineCaseSpec?.split;
  const adapter = step.adapter ?? execution.adapter;
  const candidateCommand = adapterProtocolCommandSpec(workload.spec.run, "candidate.run", manifests).command;
  const payload = {
    protocol: "workbench.adapter.v3",
    id: execution.id,
    jobId: workload.job.id,
    operation: step.operation,
    invocation: {
      use: adapter.use,
      with: adapterConfigRecord(adapter, manifests),
      ...(adapter.auth !== undefined ? { auth: adapter.auth } : {}),
    },
    ...(auth !== undefined ? { auth } : {}),
    context: {
      benchmark: {
        name: workload.spec.benchmark.name,
        description: workload.spec.benchmark.description,
      },
      candidate: {
        id: workload.candidateId,
        path: workload.spec.candidate.files.path,
        ...(workload.spec.candidate.prepare ? { prepare: { ...workload.spec.candidate.prepare } } : {}),
        run: {
          ...workload.spec.run,
          command: candidateCommand,
        },
      },
      ...(workload.spec.candidate.improve
        ? { improve: { edits: [...workload.spec.candidate.improve.edits] } }
        : {}),
      attempt: {
        attemptIndex: workload.attemptIndex,
        sampleIndex: workload.sampleIndex,
        caseId: workload.caseId,
      },
      case: {
        id: workload.caseId,
        ...(casePrompt ? { prompt: casePrompt } : {}),
        ...(caseSplit ? { split: caseSplit } : {}),
      },
    },
    paths: {
      workspace: root,
      output: outputDir(root),
      result: workbenchAdapterOperationResultPath(outputDir(root)),
      ...(readWorkloadExecutionPurpose(workload) === "attempt" ? { candidate: candidateDir(root) } : {}),
      ...(workload.engineCaseSpec ? { case: caseDir(root) } : {}),
      traces: tracesDir(root),
      ...(step.kind === "engine" ? { enginePrivate: runtimeEnginePrivateDir(root) } : {}),
    },
  };
  await fs.writeFile(
    requestPath,
    `${JSON.stringify(payload, null, 2)}\n`,
  );
  await writeSurfaceFiles(outputDir(root), [
    textSurfaceFile(
      `.workbench/traces/${workload.job.id}/${step.label}/request.json`,
      `${JSON.stringify(sanitizeAdapterRequestTracePayload(payload), null, 2)}\n`,
    ),
  ]);
  return requestPath;
}

function sanitizeAdapterRequestTracePayload(value: unknown): Json {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAdapterRequestTracePayload(entry)) as unknown as Json;
  }
  if (!value || typeof value !== "object") {
    return (value ?? null) as Json;
  }
  const sanitized: Record<string, Json> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "auth" || key === "enginePrivate") {
      continue;
    }
    sanitized[key] = sanitizeAdapterRequestTracePayload(entry);
  }
  return sanitized as unknown as Json;
}

function improveEdits(spec: GenericRunSpec): string[] {
  return spec.candidate.improve?.edits ?? [];
}

function requireImproveEdits(spec: GenericRunSpec): string[] {
  const edits = improveEdits(spec);
  if (edits.length === 0) {
    throw new Error("Candidate improve configuration must declare at least one entry in edits.");
  }
  return edits;
}

function createHostedWorkloadAdapterEnv(
  root: string,
  adapterRequestPath: string,
  adapterEnv: Record<string, string> = {},
  options: { adapterRoot?: string } = {},
  runtimeEnv: Record<string, string> = {},
): Record<string, string> {
  const env = createHostedWorkloadBaseEnv();
  env.WORKBENCH_ADAPTER_REQUEST = adapterRequestPath;
  env.WORKBENCH_OUTPUT = outputDir(root);
  env.WORKBENCH_RESULT = workbenchAdapterOperationResultPath(outputDir(root));
  if (options.adapterRoot) {
    env.WORKBENCH_ADAPTER_ROOT = options.adapterRoot;
    env.WORKBENCH_WORKSPACE_ROOT = root;
    env.PATH = [
      `${options.adapterRoot}/node_modules/.bin`,
      env.PATH,
    ].filter(Boolean).join(":");
  }
  Object.assign(env, adapterEnv);
  Object.assign(env, runtimeEnv);
  return env;
}

function createHostedWorkloadPrepareEnv(root: string): Record<string, string> {
  const env = createHostedWorkloadBaseEnv();
  env.WORKBENCH_OUTPUT = outputDir(root);
  return env;
}

function createHostedWorkloadBaseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  for (const key of Object.keys(env)) {
    if (key.startsWith("WORKBENCH_")) {
      delete env[key];
    }
  }
  const runtimeBins = uniquePathEntries([
    ...nodeModuleBinDirsForAncestors(process.cwd()),
    ...nodeModuleBinDirsForAncestors(path.dirname(fileURLToPath(import.meta.url))),
    "/app/node_modules/.bin",
    "/workbench-runtime/node_modules/.bin",
    "/workbench-runtime/products/workbench/node_modules/.bin",
  ]);
  env.PATH = uniquePathEntries([
    path.dirname(process.execPath),
    "/usr/local/sbin",
    "/usr/local/bin",
    "/usr/sbin",
    "/usr/bin",
    "/sbin",
    "/bin",
    ...runtimeBins,
    ...(process.env.PATH ? process.env.PATH.split(path.delimiter) : []),
  ]).join(path.delimiter);
  return env;
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

function readWorkloadExecutionPurpose(
  workload: WorkbenchRunWorkload,
): WorkbenchExecutionSpec["purpose"] {
  const purpose = workbenchExecutionPurpose(workload.job);
  if (purpose === "improve" || purpose === "attempt") {
    return purpose;
  }
  throw new Error(
    `Execution job ${workload.job.id} is missing a supported execution purpose.`,
  );
}

function requireWorkloadEngineCase(
  workload: WorkbenchRunWorkload,
  label: string,
): WorkbenchEngineCase {
  if (!workload.engineCase) {
    throw new Error(`${label} workload is missing an engine case.`);
  }
  return workload.engineCase;
}

function candidateDir(root: string): string {
  return `${inputDir(root)}/candidate`;
}

function caseDir(root: string): string {
  return `${inputDir(root)}/case`;
}

function tracesDir(root: string): string {
  return `${inputDir(root)}/traces`;
}

function inputDir(root: string): string {
  return `${root}/input`;
}

function outputDir(root: string): string {
  return `${root}/output`;
}

function runtimePrivateDir(root: string): string {
  return `${root}/private`;
}

function runtimeEnginePrivateDir(root: string): string {
  return `${runtimePrivateDir(root)}/engine`;
}

async function writeSurfaceFiles(
  root: string,
  files: readonly SurfaceSnapshotFile[],
): Promise<void> {
  const fs = await importNodeModule<any>(nodeBuiltin("fs/promises"));
  const path = await importNodeModule<any>(nodeBuiltin("path"));
  for (const file of files) {
    const target = path.join(root, normalizeRelativePath(file.path));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const body =
      file.encoding === "base64"
        ? Buffer.from(file.content, "base64")
        : Buffer.from(file.content, "utf8");
    await fs.writeFile(target, body);
    if (file.executable) {
      await fs.chmod(target, 0o755).catch(() => undefined);
    }
  }
}

async function readSurfaceFiles(
  root: string,
  options: { ignorePath?: (path: string) => boolean } = {},
): Promise<SurfaceSnapshotFile[]> {
  const fs = await importNodeModule<any>(nodeBuiltin("fs/promises"));
  const path = await importNodeModule<any>(nodeBuiltin("path"));
  const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
  const files: SurfaceSnapshotFile[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await fs
      .readdir(directory, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizeRelativePath(
        path.relative(root, absolutePath).replace(/\\/gu, "/"),
      );
      if (options.ignorePath?.(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      let body: Buffer;
      let stats: { mode: number };
      try {
        body = await fs.readFile(absolutePath);
        stats = await fs.stat(absolutePath);
      } catch (error) {
        if (isVanishedWalkEntry(error)) {
          continue;
        }
        throw error;
      }
      const content = encodeSurfaceSnapshotContent(body, utf8Decoder);
      files.push({
        path: relativePath,
        kind: content.encoding === "base64" ? "binary" : "text",
        encoding: content.encoding,
        content: content.content,
        executable: (stats.mode & 0o111) !== 0,
      });
    }
  }
  await walk(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function isVanishedWalkEntry(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function encodeSurfaceSnapshotContent(
  body: Buffer,
  utf8Decoder: { decode(input?: Uint8Array): string },
): { encoding: "utf8" | "base64"; content: string } {
  try {
    return {
      encoding: "utf8",
      content: utf8Decoder.decode(body),
    };
  } catch {
    return {
      encoding: "base64",
      content: body.toString("base64"),
    };
  }
}

function normalizeResultMetrics(
  value: unknown,
): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const metrics: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      metrics[key] = entry;
    }
  }
  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

function normalizeResultCases(value: unknown): EvalCaseResult[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const cases = value.flatMap((entry): EvalCaseResult[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const id =
      typeof record.id === "string" && record.id.length > 0 ? record.id : "";
    if (!id) {
      return [];
    }
    const metrics = normalizeResultMetrics(record.metrics) ?? {};
    const status =
      record.status === "completed" || record.status === "error"
        ? record.status
        : undefined;
    const criteria = Array.isArray(record.criteria)
      ? record.criteria.flatMap(
          (criterion): NonNullable<EvalCaseResult["criteria"]> => {
            if (
              !criterion ||
              typeof criterion !== "object" ||
              Array.isArray(criterion)
            ) {
              return [];
            }
            const criterionRecord = criterion as Record<string, unknown>;
            const criterionId =
              typeof criterionRecord.criterion_id === "string"
                ? criterionRecord.criterion_id
                : "";
            const label =
              typeof criterionRecord.label === "string"
                ? criterionRecord.label
                : criterionId;
            const score =
              typeof criterionRecord.score === "number" &&
              Number.isFinite(criterionRecord.score)
                ? criterionRecord.score
                : undefined;
            const pass =
              typeof criterionRecord.pass === "boolean"
                ? criterionRecord.pass
                : undefined;
            if (!criterionId || score === undefined || pass === undefined) {
              return [];
            }
            const errors = Array.isArray(criterionRecord.errors)
              ? criterionRecord.errors.filter(
                  (error): error is string => typeof error === "string",
                )
              : [];
            const rationale =
              typeof criterionRecord.rationale === "string" &&
              criterionRecord.rationale.trim().length > 0
                ? criterionRecord.rationale.trim()
                : undefined;
            return [
              {
                criterion_id: criterionId,
                label,
                score,
                pass,
                ...(errors.length > 0 ? { errors } : {}),
                ...(rationale ? { rationale } : {}),
              },
            ];
          },
        )
      : undefined;
    return [
      {
        id,
        ...(typeof record.label === "string" ? { label: record.label } : {}),
        ...(typeof record.split === "string" ? { split: record.split } : {}),
        ...(status ? { status } : {}),
        ...(typeof record.durationMs === "number" &&
        Number.isFinite(record.durationMs)
          ? { durationMs: record.durationMs }
          : {}),
        metrics,
        ...(record.source &&
        typeof record.source === "object" &&
        !Array.isArray(record.source)
          ? { source: record.source as Record<string, Json> }
          : {}),
        ...(record.feedback !== undefined
          ? { feedback: record.feedback as Json }
          : {}),
        ...(criteria && criteria.length > 0 ? { criteria } : {}),
      },
    ];
  });
  return cases.length > 0 ? cases : undefined;
}

async function readOptionalNumber(
  pathname: string,
): Promise<number | undefined> {
  const fs = await importNodeModule<any>(nodeBuiltin("fs/promises"));
  try {
    const parsed = Number.parseInt(
      String(await fs.readFile(pathname, "utf8")).trim(),
      10,
    );
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export function workloadTimeoutMs(spec: GenericRunSpec): number {
  return environmentVersionTimeoutMs(environmentVersionForSpec(spec));
}

export function findEnvironmentVersionForImage(
  image: string,
  versions: readonly HostedWorkbenchEnvironmentVersion[],
): HostedWorkbenchEnvironmentVersion | null {
  const normalizedImage = normalizeDockerImageRef(image);
  return (
    versions.find(
      (entry) => normalizeDockerImageRef(entry.imageRef) === normalizedImage,
    ) ?? null
  );
}

export function normalizeDockerImageRef(image: string): string {
  return image.startsWith("docker://") ? image : `docker://${image}`;
}

export function environmentVersionTimeoutMs(
  version: Pick<HostedWorkbenchEnvironmentVersion, "spec"> | null | undefined,
): number {
  const timeoutMinutes = version?.spec.resources.timeoutMinutes ?? 30;
  return Math.max(1, timeoutMinutes) * 60 * 1000;
}

function readExitCode(error: unknown): number {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "number"
  ) {
    return (error as { code: number }).code;
  }
  if (error && typeof error === "object" && "signal" in error) {
    return 124;
  }
  return 1;
}

function failWorkbenchRunJob(
  job: HostedWorkbenchJob,
  startedAt: string,
  error: unknown,
  finishedAt = new Date().toISOString(),
  result?: RuntimeWorkloadResult,
): HostedWorkbenchJob {
  const message = error instanceof Error ? error.message : String(error);
  const output = {
    ok: false,
    error: message,
    ...(result?.files ? { files: result.files } : {}),
    ...(result?.fileChanges ? { fileChanges: result.fileChanges } : {}),
  } as unknown as Json;
  return {
    ...job,
    status: "failed",
    attempt: Math.max(1, job.attempt),
    startedAt,
    finishedAt,
    updatedAt: finishedAt,
    error: message,
    output,
  };
}

function evaluateSample(args: {
  candidateId: string;
  files: readonly SurfaceSnapshotFile[];
  engineResolveFiles: readonly SurfaceSnapshotFile[];
  spec: GenericRunSpec;
  attemptIndex: number;
  sampleIndex: number;
  caseId: string;
  split?: string;
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  workload: RuntimeWorkloadResult;
}): EvaluationSampleRecord {
  const durationMs =
    args.durationMs ??
    Math.max(0, Date.parse(args.finishedAt) - Date.parse(args.startedAt));
  const sampleScore = args.workload.result?.score;
  if (typeof sampleScore !== "number" || !Number.isFinite(sampleScore)) {
    throw new Error("Evaluation sample requires an engine result with a finite numeric score.");
  }
  const metrics = args.workload.metrics ?? {
    score: sampleScore,
  };
  if (metrics.score === undefined) {
    metrics.score = sampleScore;
  }
  const cases = runtimeTimedCaseResults({
    caseId: args.caseId,
    split: args.split,
    status: "completed",
    durationMs,
    metrics,
    cases: args.workload.cases,
  });
  const feedback = {
    ...(args.workload.summary !== undefined
      ? { summary: args.workload.summary }
      : {}),
    ...(args.workload.feedback !== undefined
      ? { detail: args.workload.feedback }
      : {}),
  };
  const usage = completeUsageSummary(args.workload.usage);
  return {
    id: `${args.caseId}__sample_${String(args.sampleIndex + 1).padStart(3, "0")}`,
    index: args.sampleIndex,
    candidate: {
      id: args.candidateId,
      kind: "candidate",
      label: args.candidateId,
    },
    status: "completed",
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    durationMs,
    metrics,
    ...(usage ? { usage } : {}),
    cases,
    feedback,
  };
}

function normalizeSampleJobOutput(
  value: unknown,
): HostedSampleJobOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true || typeof record.candidateId !== "string") {
    return null;
  }
  const files = Array.isArray(record.files)
    ? record.files.filter(isSurfaceSnapshotFile)
    : [];
  const sample = isEvaluationSampleRecord(record.sample) ? record.sample : null;
  if (!sample) {
    return null;
  }
  if (
    typeof record.attemptIndex !== "number" ||
    !Number.isFinite(record.attemptIndex)
  ) {
    return null;
  }
  return {
    candidateId: record.candidateId,
    attemptIndex: record.attemptIndex,
    sample,
    fileChanges: Array.isArray(record.fileChanges)
      ? record.fileChanges.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    files,
    traces: Array.isArray(record.traces)
      ? record.traces.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : traceFilePaths(files),
  };
}

function normalizeEvaluationSampleOutputs(
  jobs: readonly HostedWorkbenchJob[],
): HostedMaterializedSampleOutput[] {
  return jobs.flatMap((job): HostedMaterializedSampleOutput[] => {
    const output = normalizeSampleJobOutput(job.output);
    if (!output) {
      return [];
    }
    const caseId = readJobString(job.input, "caseId") ?? output.sample.cases?.[0]?.id ?? null;
    const durationMs = runtimeJobDurationMs(job) ?? output.sample.durationMs;
    const sample = caseId && typeof durationMs === "number" && Number.isFinite(durationMs)
      ? {
          ...output.sample,
          cases: runtimeTimedCaseResults({
            caseId,
            split: readJobEngineCaseSplit(job),
            status: output.sample.status === "error" ? "error" : "completed",
            durationMs,
            metrics: output.sample.metrics ?? {},
            cases: output.sample.cases,
          }),
        }
      : output.sample;
    return [{
      jobs: [job],
      output: {
        ...output,
        sample,
      },
    }];
  });
}

function runtimeTimedCaseResults(args: {
  caseId: string;
  split?: string;
  status: EvalCaseStatus;
  durationMs: number;
  metrics: Record<string, number>;
  cases?: EvalCaseResult[];
}): EvalCaseResult[] {
  const cases = args.cases?.length
    ? args.cases
    : [{
        id: args.caseId,
        status: args.status,
        metrics: args.metrics,
      }];
  return cases.map((entry) => ({
    ...entry,
    ...(!entry.split && args.split && entry.id === args.caseId ? { split: args.split } : {}),
    status: entry.status ?? args.status,
    metrics: entry.metrics ?? args.metrics,
    durationMs: args.durationMs,
  }));
}

function readJobEngineCaseSplit(job: HostedWorkbenchJob): string | undefined {
  const input = jsonRecord(job.input);
  const execution = jsonRecord(input.execution);
  const metadata = jsonRecord(execution.metadata);
  const engineCase = jsonRecord(metadata.engineCase);
  const split = engineCase.split;
  return typeof split === "string" && split.trim().length > 0
    ? split.trim()
    : undefined;
}

function runtimeJobDurationMs(job: HostedWorkbenchJob): number | undefined {
  if (typeof job.startedAt !== "string" || typeof job.finishedAt !== "string") {
    return undefined;
  }
  const startedMs = Date.parse(job.startedAt);
  const finishedMs = Date.parse(job.finishedAt);
  return Number.isFinite(startedMs) && Number.isFinite(finishedMs)
    ? Math.max(0, finishedMs - startedMs)
    : undefined;
}

function meanFinite(values: readonly unknown[]): number | undefined {
  const finite = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (finite.length === 0) {
    return undefined;
  }
  return Number((finite.reduce((sum, value) => sum + value, 0) / finite.length).toFixed(6));
}

function minIsoTimestamp(values: readonly string[]): string | null {
  const sorted = values
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  return sorted[0] ?? null;
}

function maxIsoTimestamp(values: readonly string[]): string | null {
  const sorted = values
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left));
  return sorted[0] ?? null;
}

function withJobUsage(
  sample: EvaluationSampleRecord,
  _jobs: readonly HostedWorkbenchJob[],
  attemptJob: HostedWorkbenchJob,
): EvaluationSampleRecord {
  const usage = normalizeUsageSummary(jsonRecord(attemptJob.output).usage)
    ?? completeUsageSummary(sample.usage);
  if (!usage) {
    return sample;
  }
  return {
    ...sample,
    usage,
  };
}

function normalizeCandidateRevisionJobOutput(
  value: unknown,
): HostedCandidateRevisionJobOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true || typeof record.candidateId !== "string") {
    return null;
  }
  const files = Array.isArray(record.files)
    ? record.files.filter(isSurfaceSnapshotFile)
    : [];
  if (
    typeof record.attemptIndex !== "number" ||
    !Number.isFinite(record.attemptIndex)
  ) {
    return null;
  }
  const usage = normalizeUsageSummary(record.usage);
  return {
    candidateId: record.candidateId,
    attemptIndex: record.attemptIndex,
    baseId:
      typeof record.baseId === "string" && record.baseId.length > 0
        ? record.baseId
        : null,
    ...(typeof record.prompt === "string" ? { prompt: record.prompt } : {}),
    fileChanges: Array.isArray(record.fileChanges)
      ? record.fileChanges.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    files,
    traces: Array.isArray(record.traces)
      ? record.traces.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : traceFilePaths(files),
    ...(usage ? { usage } : {}),
  };
}

function errorEvaluationSamplesFromJobs(
  jobs: readonly HostedWorkbenchJob[],
  candidateId: string,
  attemptIndex: number,
  completedSampleKeys: ReadonlySet<string>,
): EvaluationSampleRecord[] {
  const groups = new Map<string, HostedWorkbenchJob[]>();
  for (const job of jobs) {
    const key = evaluationSampleGroupKeyFromJob(job);
    if (!key || completedSampleKeys.has(key)) {
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups.values()]
    .map((group) => errorEvaluationSampleFromJobGroup(group, candidateId, attemptIndex))
    .filter((sample): sample is EvaluationSampleRecord => sample !== null);
}

function errorEvaluationSampleFromJobGroup(
  jobs: readonly HostedWorkbenchJob[],
  candidateId: string,
  attemptIndex: number,
): EvaluationSampleRecord | null {
  const job = jobs[0];
  if (!job) {
    return null;
  }
  const sampleIndex = readOptionalJobNumber(job.input, "sampleIndex");
  const caseId = readJobString(job.input, "caseId");
  const split = readJobEngineCaseSplit(job);
  if (sampleIndex === null || !caseId) {
    return null;
  }
  const startedAt = minIsoTimestamp(jobs.map((entry) => entry.startedAt ?? entry.createdAt));
  const finishedAt = maxIsoTimestamp(jobs.map((entry) => entry.finishedAt ?? entry.updatedAt ?? entry.startedAt));
  const durationMs = startedAt && finishedAt
    ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
    : undefined;
  const error = summarizeEvaluationJobErrors(jobs) ?? "Evaluation job did not produce a valid sample.";
  return {
    id: `${caseId}__sample_${String(sampleIndex + 1).padStart(3, "0")}`,
    index: sampleIndex,
    candidate: {
      id: candidateId,
      kind: "candidate",
      label: candidateId,
    },
    status: "error",
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(error ? { error } : {}),
    cases: [{
      id: caseId,
      ...(split ? { split } : {}),
      status: "error",
      ...(durationMs !== undefined ? { durationMs } : {}),
      metrics: {},
      ...(error ? { feedback: { summary: error } } : {}),
    }],
    feedback: {
      traces: [...new Set(jobs.flatMap(jobTracePaths))].sort(),
    },
  };
}

function evaluationSampleGroupKeyFromOutput(output: HostedSampleJobOutput): string | null {
  const caseId = output.sample.cases?.[0]?.id;
  if (!caseId) {
    return null;
  }
  return evaluationSampleGroupKey(caseId, output.sample.index);
}

function evaluationSampleGroupKeyFromJob(job: HostedWorkbenchJob): string | null {
  const sampleIndex = readOptionalJobNumber(job.input, "sampleIndex");
  const caseId = readJobString(job.input, "caseId");
  if (sampleIndex === null || !caseId) {
    return null;
  }
  return evaluationSampleGroupKey(caseId, sampleIndex);
}

function evaluationSampleGroupKey(
  caseId: string,
  sampleIndex: number,
): string {
  return `${caseId}\0${sampleIndex}`;
}

function summarizeEvaluationJobErrors(jobs: readonly HostedWorkbenchJob[]): string | null {
  const failures = jobs
    .map((job) => job.error ? `${job.id}: ${job.error}` : null)
    .filter((entry): entry is string => entry !== null);
  if (failures.length === 0) {
    return null;
  }
  return failures.length === 1
    ? failures[0]!
    : `${failures.length} evaluation job errors: ${failures.join("; ")}`;
}

function jobTracePaths(job: HostedWorkbenchJob): string[] {
  const output =
    job.output && typeof job.output === "object" && !Array.isArray(job.output)
      ? (job.output as Record<string, unknown>)
      : {};
  const files = Array.isArray(output.files)
    ? output.files.filter(isSurfaceSnapshotFile)
    : [];
  return Array.isArray(output.traces)
    ? output.traces.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : traceFilePaths(files);
}

function compareSampleOutputs(
  left: HostedSampleJobOutput,
  right: HostedSampleJobOutput,
): number {
  const sampleOrder = left.sample.index - right.sample.index;
  if (sampleOrder !== 0) {
    return sampleOrder;
  }
  return left.sample.id.localeCompare(right.sample.id);
}

function createEvaluationRecord(
  candidateId: string,
  candidateName: string | null,
  rawSamples: EvaluationSampleRecord[],
): EvaluationRecord {
  const samples = mergeEvaluationSampleRecords(rawSamples).map((sample) =>
    candidateName
      ? {
          ...sample,
          candidate: {
            ...sample.candidate,
            label: candidateName,
          },
        }
      : sample,
  );
  const startedAt = minTimestamp(
    samples.flatMap((sample) => (sample.startedAt ? [sample.startedAt] : [])),
  );
  const finishedAt = maxTimestamp(
    samples.flatMap((sample) => (sample.finishedAt ? [sample.finishedAt] : [])),
  );
  const durationValues = samples.flatMap((sample) =>
    typeof sample.durationMs === "number" ? [sample.durationMs] : [],
  );
  const metrics = aggregateSampleMetrics(samples);
  const usage = usageStats(samples.flatMap((sample) => sample.usage ? [sample.usage] : []));
  const cases = createEvaluationCaseStats(samples);
  const completedSampleCount = samples.filter(
    (sample) => sample.status === "completed",
  ).length;
  const errorSampleCount = samples.filter((sample) => sample.status === "error")
    .length;
  return {
    candidate: {
      id: candidateId,
      kind: "candidate",
      ...(candidateName ? { label: candidateName } : {}),
    },
    status:
      samples.length > 0 && completedSampleCount === samples.length
        ? "completed"
        : samples.length > 0 && errorSampleCount === samples.length
          ? "error"
        : "partial",
    sampleCount: samples.length,
    completedSampleCount,
    errorSampleCount,
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    ...(metrics ? { metrics } : {}),
    ...(durationValues.length > 0
      ? { durationMs: metricStats(durationValues) }
      : {}),
    ...(usage ? { usage } : {}),
    ...(cases ? { cases } : {}),
    samples,
  };
}

function normalizedCandidateDisplayName(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function aggregateSampleMetrics(
  samples: EvaluationSampleRecord[],
): Record<string, MetricStats> | undefined {
  const metricNames = new Set(
    samples.flatMap((sample) => Object.keys(sample.metrics ?? {})),
  );
  if (metricNames.size === 0) {
    return undefined;
  }
  const metrics = Object.fromEntries(
    [...metricNames].sort().map((metric) => [
      metric,
      metricStats(
        samples.flatMap((sample) => {
          const value = sample.metrics?.[metric];
          return typeof value === "number" && Number.isFinite(value)
            ? [value]
            : [];
        }),
      ),
    ]),
  );
  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

function mergeEvaluationSampleRecords(
  samples: EvaluationSampleRecord[],
): EvaluationSampleRecord[] {
  const groups = new Map<string, EvaluationSampleRecord[]>();
  for (const sample of samples) {
    const key = String(sample.index);
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return [...groups.values()]
    .map(mergeEvaluationSampleGroup)
    .sort(
      (left, right) =>
        left.index - right.index ||
        left.id.localeCompare(right.id),
    );
}

function mergeEvaluationSampleGroup(
  group: EvaluationSampleRecord[],
): EvaluationSampleRecord {
  const first = group[0]!;
  if (group.length === 1) {
    return first;
  }
  const startedAt = minTimestamp(group.flatMap((sample) => (sample.startedAt ? [sample.startedAt] : [])));
  const finishedAt = maxTimestamp(group.flatMap((sample) => (sample.finishedAt ? [sample.finishedAt] : [])));
  const durationMs = startedAt && finishedAt
    ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
    : undefined;
  const cases = group.flatMap((sample) => sample.cases ?? []);
  const metrics = aggregateSampleGroupMetrics(group);
  const usage = mergeUsageSummaries(group.map((sample) => sample.usage));
  const errors = group.flatMap((sample) => sample.error ? [sample.error] : []);
  return {
    id: `sample_${String(first.index + 1).padStart(3, "0")}`,
    index: first.index,
    candidate: first.candidate,
    status: mergeEvaluationSampleStatus(group),
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(metrics ? { metrics } : {}),
    ...(usage ? { usage } : {}),
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
    ...(cases.length > 0 ? { cases } : {}),
  };
}

function aggregateSampleGroupMetrics(
  group: readonly EvaluationSampleRecord[],
): Record<string, number> | undefined {
  const metricNames = new Set(
    group.flatMap((sample) => Object.keys(sample.metrics ?? {})),
  );
  if (metricNames.size === 0) {
    return undefined;
  }
  const metrics = Object.fromEntries(
    [...metricNames].sort().flatMap((metric) => {
      const value = meanFinite(group.map((sample) => sample.metrics?.[metric]));
      return value === undefined ? [] : [[metric, value]];
    }),
  );
  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

function mergeEvaluationSampleStatus(
  group: readonly EvaluationSampleRecord[],
): EvaluationSampleRecord["status"] {
  if (group.some((sample) => sample.status === "error")) {
    return "error";
  }
  if (group.some((sample) => sample.status === "running")) {
    return "running";
  }
  if (group.length > 0 && group.every((sample) => sample.status === "completed")) {
    return "completed";
  }
  return "planned";
}

function minTimestamp(values: string[]): string | null {
  return values.length > 0
    ? values.reduce((min, value) => (value < min ? value : min))
    : null;
}

function maxTimestamp(values: string[]): string | null {
  return values.length > 0
    ? values.reduce((max, value) => (value > max ? value : max))
    : null;
}

function createEvaluationCaseStats(
  samples: EvaluationSampleRecord[],
): EvaluationRecord["cases"] | undefined {
  const byCase = new Map<string, EvalCaseResult[]>();
  for (const caseResult of samples.flatMap((sample) => sample.cases ?? [])) {
    byCase.set(caseResult.id, [
      ...(byCase.get(caseResult.id) ?? []),
      caseResult,
    ]);
  }
  if (byCase.size === 0) {
    return undefined;
  }
  return [...byCase.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([id, results]) => {
      const first = results[0]!;
      const metricNames = new Set(
        results.flatMap((result) => Object.keys(result.metrics)),
      );
      const durationValues = results.flatMap((result) =>
        typeof result.durationMs === "number" ? [result.durationMs] : [],
      );
      const status = aggregateCaseStatus(results);
      return {
        id,
        ...(first.label ? { label: first.label } : {}),
        ...(first.split ? { split: first.split } : {}),
        ...(status ? { status } : {}),
        sampleCount: results.length,
        metrics: Object.fromEntries(
          [...metricNames].sort().map((metric) => [
            metric,
            metricStats(
              results.flatMap((result) => {
                const value = result.metrics[metric];
                return typeof value === "number" && Number.isFinite(value)
                  ? [value]
                  : [];
              }),
            ),
          ]),
        ),
        ...(durationValues.length > 0
          ? { durationMs: metricStats(durationValues) }
          : {}),
      };
    });
}

function aggregateCaseStatus(
  results: readonly EvalCaseResult[],
): EvalCaseResult["status"] | undefined {
  if (results.some((result) => result.status === "error")) {
    return "error";
  }
  if (results.length > 0) {
    return "completed";
  }
  return undefined;
}

function selectCandidate(args: {
  candidates: readonly CandidateRecord[];
  previousCandidate: CandidateRecord | null;
  selection?: {
    metric: string;
    caseIds?: readonly string[];
  };
}): CandidateRecord | null {
  let selected = args.previousCandidate;
  for (const candidate of args.candidates) {
    if (!selected || hasHigherEvaluationMetric(candidate, selected, args.selection)) {
      selected = candidate;
    }
  }
  return selected;
}

function hasHigherEvaluationMetric(
  candidate: CandidateRecord,
  incumbent: CandidateRecord,
  selection?: {
    metric: string;
    caseIds?: readonly string[];
    label?: string;
  },
): boolean {
  const metric = selection?.metric ?? "score";
  const candidateValue = readEvaluationSelectionMean(candidate.eval, metric, selection?.caseIds);
  const incumbentValue = readEvaluationSelectionMean(incumbent.eval, metric, selection?.caseIds);
  if (candidateValue == null) {
    return false;
  }
  if (incumbentValue == null) {
    return true;
  }
  return candidateValue > incumbentValue;
}

function readEvaluationSelectionMean(
  evaluation: EvaluationRecord | undefined,
  metric: string,
  caseIds?: readonly string[],
): number | null {
  const stats = readEvaluationSelectionStats(evaluation, metric, caseIds);
  return stats ? stats.mean : null;
}

function readEvaluationSelectionStats(
  evaluation: EvaluationRecord | undefined,
  metric: string,
  caseIds?: readonly string[],
): MetricStats | null {
  if (!caseIds) {
    const direct = evaluation?.metrics?.[metric];
    return direct && Number.isFinite(direct.mean) ? direct : null;
  }
  if (caseIds.length === 0) {
    return null;
  }
  const allowed = new Set(caseIds);
  const values =
    (evaluation?.samples ?? [])
      .flatMap((sample) => sample.cases ?? [])
      .flatMap((caseResult) => {
        const metricValue = caseResult.metrics[metric];
        return allowed.has(caseResult.id) && typeof metricValue === "number" && Number.isFinite(metricValue)
          ? [metricValue]
      : [];
      });
  return values.length > 0 ? metricStats(values) : null;
}

function metricStats(values: number[]): MetricStats {
  const count = values.length;
  if (count === 0) {
    return {
      count: 0,
      mean: 0,
      variance: 0,
      stddev: 0,
      min: 0,
      max: 0,
    };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  return {
    count,
    mean,
    variance,
    stddev: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function normalizeRelativePath(filePath: string): string {
  const normalized = filePath.replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (!normalized || normalized.includes("\0")) {
    throw new Error("File paths must be non-empty relative paths.");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === "." || part === "")) {
    throw new Error(`Unsafe relative file path: ${filePath}`);
  }
  return normalized;
}

function detectMimeType(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "text/markdown";
  }
  if (lower.endsWith(".json")) {
    return "application/json";
  }
  if (lower.endsWith(".csv")) {
    return "text/csv";
  }
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "text/plain";
}

function resolvePreviewKind(
  filePath: string,
): CandidateFileSummary["preview_kind"] {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "markdown";
  }
  if (lower.endsWith(".csv")) {
    return "table";
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return "spreadsheet";
  }
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif")
  ) {
    return "image";
  }
  if (lower.endsWith(".pdf")) {
    return "pdf";
  }
  return "text";
}

function readJobString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function readRequiredJobString(
  value: unknown,
  key: string,
  label: string,
): string {
  const result = readJobString(value, key);
  if (!result) {
    throw new Error(`${label} is missing ${key}.`);
  }
  return result;
}

function readOptionalJobNumber(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function readRequiredJobNumber(
  value: unknown,
  key: string,
  label: string,
): number {
  const result = readOptionalJobNumber(value, key);
  if (result === null) {
    throw new Error(`${label} is missing ${key}.`);
  }
  return result;
}

function isEvaluationSampleRecord(
  value: unknown,
): value is EvaluationSampleRecord {
  const record = value as Partial<EvaluationSampleRecord>;
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof record.id === "string" &&
    typeof record.index === "number" &&
    typeof record.candidate === "object" &&
    isEvaluationSampleStatus(record.status) &&
    hasOperationalCaseStatuses(record.cases),
  );
}

function isEvaluationSampleStatus(
  value: unknown,
): value is EvaluationSampleRecord["status"] {
  return value === "planned" ||
    value === "running" ||
    value === "completed" ||
    value === "error";
}

function hasOperationalCaseStatuses(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }
    const status = (entry as Partial<EvalCaseResult>).status;
    return status === undefined || status === "completed" || status === "error";
  });
}
