import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import type {
  AuthoredWorkbenchCaseSummary,
  AuthoredWorkbenchSourceSpec,
  AuthoredWorkbenchSourceDocument,
  SubjectCasePhaseRef,
  SubjectCaseReview,
  SubjectFilePreview,
  SubjectFileSummary,
  SubjectLineageEdge,
  SubjectLineageGraph,
  SubjectLineageNode,
  SubjectRecord,
  SubjectSummary,
  EvalCaseResult,
  EvaluationRecord,
  EvaluationResultRecord,
  EvaluationSampleRecord,
  HostedWorkbenchEnvironment,
  HostedWorkbenchEnvironmentVersion,
  HostedWorkbenchFileInput,
  HostedWorkbenchJob,
  Json,
  MetricStats,
  RuntimeEvent,
  SurfaceSnapshotFile,
  UsageSummary,
  WorkbenchSubjectPatch,
  WorkbenchAdapterInvocation,
  WorkbenchExecutionCapability,
  WorkbenchExecutionResult,
  WorkbenchExecutionSpec,
  WorkbenchSandboxExecutionMetadata,
  WorkbenchScorecard,
} from "@workbench-ai/workbench-contract";
import {
  adapterCommandName,
  assertWorkbenchAdapterOperationResultOk,
  collectWorkbenchAdapterAuthRequirements,
  readWorkbenchAdapterOperationResult,
  workbenchAdapterOperationCommand,
  workbenchAdapterOperationResultPath,
  type WorkbenchAdapterOperation,
  type WorkbenchAdapterOperationResult,
  type WorkbenchAdapterManifest,
} from "@workbench-ai/workbench-protocol";
import {
  BENCHMARK_SPEC_FILE,
  resolveTaskExecutionConfig,
  resolveWorkbenchResolvedSourceYaml as resolveWorkbenchResolvedSourceYamlInternal,
  validateWorkbenchResolvedSourceYaml as validateWorkbenchResolvedSourceYamlInternal,
  isWorkbenchSubjectManifestPath,
  type GenericTaskSpec,
  type GenericRunSpec,
  type WorkbenchTaskBundle,
} from "./generic-spec.ts";
import {
  attachSandboxMetadataToJob,
  createWorkbenchSandboxFileStore,
  isSurfaceSnapshotFile,
  readWorkbenchExecutionSpec,
} from "./sandbox-inputs.ts";
import type {
  WorkbenchExecutionRuntimeInput,
  WorkbenchWorkloadPhaseCommand,
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
import { applyWorkbenchSubjectPatch } from "./subject-patch.ts";
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
  workbenchTracePhaseDirectory,
} from "./trace-files.ts";
import {
  taskBundleForCase,
} from "./execution-jobs.ts";
import {
  createWorkbenchExecutionEventPublisher,
  publishCommandPhaseEvent,
  type WorkbenchExecutionEventPublisher,
} from "./execution-events.ts";
import { readWorkbenchExecutionPurpose } from "./execution-phases.ts";
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
  DEFAULT_EXECUTION_RESOURCES,
  isWorkbenchSubjectManifestPath,
  parseWorkbenchSourceFiles,
  resolveWorkbenchResolvedSourceYaml,
  resolveWorkbenchSourceFiles,
  serializeWorkbenchResolvedSourceYaml,
  validateWorkbenchResolvedSourceYaml,
  type AuthoredBenchmarkSpec,
  type AuthoredOptimizerSpec,
  type GenericRunSpec,
  type GenericTaskSpec,
  type ResolvedSubjectSpec,
  type WorkbenchTaskBundle,
  type WorkbenchResolvedSource,
  type WorkbenchSubjectManifestSpec,
} from "./generic-spec.ts";
export {
  adapterCommandName,
  cloneWorkbenchAdapterManifest,
  collectWorkbenchAdapterAuthRequirements,
  collectWorkbenchAdapterInvocations,
  parseWorkbenchAdapterManifest,
  workbenchAdapterManifestRequiresAuth,
  workbenchAdapterManifestSupportsOperation,
  workbenchAdapterOperationCommand,
  withDefaultWorkbenchAdapterAuth,
  withDefaultWorkbenchAdapterAuthProfiles,
  type WorkbenchAdapterOperation,
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
  WorkbenchWorkloadPhaseCommand,
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
  executionTracePersistenceForPublisher,
  publishWorkbenchProgressStdoutEnvelope,
} from "./execution-events.ts";
export {
  resolveSandboxTemplateImage,
} from "./sandbox-backends/template-images.ts";
export {
  readOutputTraceFiles,
  workbenchTracePhaseDirectory,
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
  type WorkbenchTaskSourceResult,
  type WorkbenchTaskSpec,
} from "@workbench-ai/workbench-protocol";
export {
  applyWorkbenchSubjectPatch,
  type ApplyWorkbenchSubjectPatchInput,
} from "./subject-patch.ts";
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
  createSyntheticProposalExecution,
  createSyntheticProposalJob,
	  createWorkbenchExecutionJob,
	  expectedWorkbenchRunJobCount,
  taskBundleForCase,
  taskBundleIds,
	  trialJobCountForRunSpec,
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
  buildSubjectCasePhaseRefs,
  buildWorkbenchTracePhases,
  isWorkbenchPhaseActive,
  readWorkbenchExecutionId,
  readWorkbenchExecutionMetadataNumber,
  readWorkbenchExecutionMetadataString,
  readWorkbenchExecutionPurpose,
  resolveWorkbenchJobGroupStatus,
} from "./execution-phases.ts";
export {
  finalizeWorkbenchExecutionTraceForJob,
  mergeWorkbenchExecutionTracesByJob,
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
  SubjectCaseReview,
  SubjectRecord,
  EvaluationResultRecord,
  HostedWorkbenchJob,
  Json,
  RunSummary,
  RuntimeEvent,
  SurfaceSnapshotFile,
  WorkbenchExecutionCapability,
  WorkbenchExecutionTrace,
  WorkbenchSandboxHandle,
  WorkbenchSandboxExecutionMetadata,
} from "@workbench-ai/workbench-contract";

interface RuntimeCommandSpec {
  use: "command";
  command: string;
}

export interface WorkbenchRunMaterialization {
  subjects: SubjectRecord[];
  subjectFiles: Record<string, SurfaceSnapshotFile[]>;
  evaluations: EvaluationResultRecord[];
  activeSubjectId: string | null;
  selectedSubject: SubjectRecord | null;
  completedJobCount: number;
  failedJobCount: number;
}

export interface WorkbenchRunWorkload {
  job: HostedWorkbenchJob;
  spec: GenericRunSpec;
  subjectId: string;
  trialIndex: number;
  sampleIndex: number;
  caseId: string;
  subjectFiles: SurfaceSnapshotFile[];
  taskSourceFiles: SurfaceSnapshotFile[];
  traceFiles: SurfaceSnapshotFile[];
  taskBundle?: WorkbenchTaskBundle;
  task?: GenericTaskSpec;
  prompt: string;
  changedPaths: string[];
  baseId: string | null;
}

export interface RuntimeWorkloadResult {
  files: SurfaceSnapshotFile[];
  fileChanges: string[];
  subjectPatch?: WorkbenchSubjectPatch;
  scorecard?: WorkbenchScorecard;
  score?: number;
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
      "Agent runtime with soffice and Python libraries for spreadsheet-heavy skill and rubric evaluations.",
    currentVersionId: "envv_libreoffice_agent",
    builtIn: true,
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
  },
  {
    id: "env_node",
    name: "Node",
    description: "Node runtime for JavaScript and TypeScript subjects.",
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
    ["subjects/current/subject.yaml", splitSubjectSourceRecord(parsed.subject)],
    ["optimizers/current.yaml", splitOptimizerSourceRecord(parsed.optimizer)],
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

function splitSubjectSourceRecord(value: unknown): unknown {
  const record = cloneYamlRecord(value);
  if (!record) {
    return value;
  }
  delete record.benchmark;
  delete record.path;
  rewriteAdapterSources(record, "subjects");
  return record;
}

function splitOptimizerSourceRecord(value: unknown): unknown {
  const record = cloneYamlRecord(value);
  if (!record) {
    return value;
  }
  rewriteAdapterSources(record, "optimizers");
  return record;
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
    isWorkbenchSubjectManifestPath(filePath) ||
    /^optimizers\/[^/]+\.ya?ml$/iu.test(filePath);
}

function formatOptimizerSummary(spec: GenericRunSpec): string {
  return spec.improve ? `adapter:${spec.improve.use}` : "optimizer not configured";
}

function formatScoreSummary(spec: GenericRunSpec): string {
  return `adapter:${spec.score.use}`;
}

function environmentImage(spec: GenericRunSpec): string {
  return spec.environment.dockerfile;
}

function environmentNetwork(spec: GenericRunSpec): "off" | "on" {
  const egress = spec.environment.network?.egress;
  return egress === "none" ? "off" : "on";
}

function environmentResources(
  spec: GenericRunSpec,
): RuntimeEnvironmentResources | undefined {
  const resources = spec.environment.resources ?? {};
  const output: RuntimeEnvironmentResources = {};
  if (typeof resources.cpu === "number") {
    output.cpu = resources.cpu;
  }
  if (typeof resources.memoryGb === "number") {
    output.memoryGb = resources.memoryGb;
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
  };
}

function protocolPhaseForExecution(
  execution: WorkbenchExecutionSpec,
  manifests?: readonly WorkbenchAdapterManifest[],
): WorkbenchWorkloadPhaseCommand {
  const role = executionPurposeRole(execution.purpose);
  const operation = execution.purpose === "improve" ? "subject.improve" : "subject.run";
  const command = adapterProtocolCommandSpec(
    execution.adapter,
    operation,
    manifests,
  );
  return {
    kind: role,
    label: execution.purpose,
    operation,
    adapter: execution.adapter,
    command: command.command,
  };
}

function trialPhasesForExecution(
  execution: WorkbenchExecutionSpec,
  spec: GenericRunSpec,
  manifests?: readonly WorkbenchAdapterManifest[],
): WorkbenchWorkloadPhaseCommand[] {
  const scorer = trialScoreAdapter(execution, spec);
  return [
    {
      kind: "runner",
      label: "run",
      operation: "subject.run",
      adapter: execution.adapter,
      command: adapterProtocolCommandSpec(execution.adapter, "subject.run", manifests).command,
    },
    {
      kind: "scorer",
      label: "score",
      operation: "trial.score",
      adapter: scorer,
      command: adapterProtocolCommandSpec(scorer, "trial.score", manifests).command,
    },
  ];
}

function trialScoreAdapter(
  execution: WorkbenchExecutionSpec,
  spec: GenericRunSpec,
): WorkbenchExecutionSpec["adapter"] {
  const metadata = jsonRecord(execution.metadata);
  const scoreAdapter = jsonRecord(metadata.scoreAdapter);
  if (typeof scoreAdapter.use === "string" && scoreAdapter.use.length > 0) {
    return {
      use: scoreAdapter.use,
      with: isJsonPayload(scoreAdapter.with) ? scoreAdapter.with : {},
      ...(scoreAdapter.auth !== undefined && isJsonPayload(scoreAdapter.auth) ? { auth: scoreAdapter.auth } : {}),
    };
  }
  return spec.score;
}

function adapterConfigRecord(
  adapter: WorkbenchExecutionSpec["adapter"],
): Record<string, Json> {
  return jsonRecord(adapter.with);
}

export function materializeWorkbenchRunResult(args: {
  runId: string;
  benchmarkFingerprint: string;
  sourceYaml?: string;
  benchmarkSourceFiles?: readonly SurfaceSnapshotFile[];
  subjectFingerprint?: string;
  subjectSourceFiles?: readonly SurfaceSnapshotFile[];
  startedAt: string;
  spec: GenericRunSpec;
  jobs: readonly HostedWorkbenchJob[];
  previousSubject?: SubjectRecord | null;
  existingSubjectCount: number;
}): WorkbenchRunMaterialization {
  const completed = args.jobs.filter((job) => job.status === "succeeded");
  const failedJobCount = args.jobs.filter(
    (job) => job.status === "failed",
  ).length;
  const completedJobCount = args.jobs.filter(
    (job) => job.status === "succeeded",
  ).length;
  const proposals = completed
    .filter((job) => workbenchExecutionPurpose(job) === "improve")
    .map((job) => normalizeProposalJobOutput(job.output))
    .filter((output): output is HostedProposalJobOutput => output !== null)
    .sort((left, right) => left.trialIndex - right.trialIndex);
	  const evaluationJobs = args.jobs.filter(
	    (job) =>
	      workbenchExecutionPurpose(job) === "trial",
	  );
  const evaluationsBySubject = new Map<string, HostedWorkbenchJob[]>();
  for (const job of evaluationJobs) {
    const subjectId =
      readJobString(job.output, "subjectId") ??
      readJobString(job.input, "subjectId") ??
      job.subjectId;
    if (subjectId) {
      evaluationsBySubject.set(subjectId, [
        ...(evaluationsBySubject.get(subjectId) ?? []),
        job,
      ]);
    }
  }

  const subjects: SubjectRecord[] = [];
  const subjectFiles: Record<string, SurfaceSnapshotFile[]> = {};
  const evaluations: EvaluationResultRecord[] = [];
  for (const proposal of proposals) {
    const subjectId = proposal.subjectId;
    const subjectJobs = evaluationsBySubject.get(subjectId) ?? [];
    const succeededEvaluationJobs = subjectJobs.filter(
      (job) => job.status === "succeeded",
    );
    const outputs = normalizeEvaluationSampleOutputs({
      jobs: succeededEvaluationJobs,
      allJobs: completed,
    })
      .sort((left, right) => compareSampleOutputs(left.output, right.output));
    const outputJobIds = new Set(
      outputs.flatMap(({ jobs }) => jobs.map((job) => job.id)),
    );
    const completedSampleKeys = new Set(
      outputs
        .map(({ output }) => evaluationSampleGroupKeyFromOutput(output))
        .filter((key): key is string => key !== null),
    );
    const errorSampleJobs = [
      ...subjectJobs.filter((job) => job.status === "failed"),
      ...succeededEvaluationJobs.filter((job) => !outputJobIds.has(job.id)),
    ];
    const errorSamples = errorEvaluationSamplesFromJobs(
      errorSampleJobs,
      subjectId,
      proposal.trialIndex,
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
    const evalRecord = createEvaluationRecord(subjectId, samples);
    const usage = mergeUsageSummaries([
      proposal.usage,
      ...samples.map((sample) => sample.usage),
    ]);
    const metrics = evaluationMeanMetrics(
      createEvaluationRecord(subjectId, samples),
    );
    const trialIndex = proposal.trialIndex;
    const evaluationTraces = [
      ...outputs.flatMap(({ output }) => output.traces),
      ...errorSampleJobs.flatMap(jobTracePaths),
    ].sort();
    const baseId = proposal.baseId && proposal.baseId !== subjectId
      ? proposal.baseId
      : null;
    const sourceMeta = subjectSourceMetadata(args.subjectSourceFiles);
    const benchmarkMeta = benchmarkSourceMetadata(args.benchmarkSourceFiles);
    const meta: Record<string, Json> = {
      trialIndex,
      sampleCount: evalRecord.sampleCount,
      optimizer: formatOptimizerSummary(args.spec),
	      score: formatScoreSummary(args.spec),
      strategy: "greedy",
      traces: {
        improve: proposal.traces,
        evaluations: evaluationTraces,
      },
    };
    if (sourceMeta) {
      meta.source = sourceMeta;
    }
    if (benchmarkMeta) {
      meta.benchmark = benchmarkMeta;
    }
    const record: SubjectRecord = {
      id: subjectId,
      ordinal: args.existingSubjectCount + subjects.length,
      benchmarkFingerprint: args.benchmarkFingerprint,
      subjectFingerprint: args.subjectFingerprint ?? materializedSubjectFingerprint(args.spec, proposal.files),
      createdAt: args.startedAt,
      ...(baseId ? { baseId } : {}),
      referenceIds: [],
      status: evalRecord.completedSampleCount > 0 ? "evaluated" : "eval_error",
      fileChanges: proposal.fileChanges,
      ...(metrics ? { metrics } : {}),
      ...(usage ? { usage } : {}),
      eval: evalRecord,
      ...(proposal.prompt ? { prompt: proposal.prompt } : {}),
      meta,
    };
    subjects.push(record);
    evaluations.push(createEvaluationResultRecord({
      runId: args.runId,
      benchmarkFingerprint: args.benchmarkFingerprint,
      createdAt: args.startedAt,
      subject: record,
      evaluation: evalRecord,
    }));
    subjectFiles[subjectId] = materializedSubjectFiles({
      proposalFiles: proposal.files,
    });
  }

  const selectedSubject = selectSubject({
    subjects,
    previousSubject: args.previousSubject ?? null,
  });
  return {
    subjects,
    subjectFiles,
    evaluations,
    activeSubjectId:
      selectedSubject?.id ?? args.previousSubject?.id ?? null,
    selectedSubject,
    completedJobCount,
    failedJobCount,
  };
}

function subjectSourceMetadata(
  files: readonly SurfaceSnapshotFile[] | undefined,
): Json | null {
  const sourceFiles = (files ?? [])
    .filter((file) => /^subjects\/[^/]+\/subject\.ya?ml$/iu.test(file.path))
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

function materializedSubjectFingerprint(
  spec: GenericRunSpec,
  files: readonly SurfaceSnapshotFile[],
): string {
  const hash = createHash("sha256");
  hash.update("workbench-subject-v1\0");
  hash.update("materialized\0runner\0");
  hash.update(JSON.stringify(spec.run));
  for (const file of filterSubjectSourceFiles(files).slice().sort((left, right) => left.path.localeCompare(right.path))) {
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

function materializedSubjectFiles(args: {
  proposalFiles: readonly SurfaceSnapshotFile[];
}): SurfaceSnapshotFile[] {
  const byPath = new Map<string, SurfaceSnapshotFile>();
  for (const file of filterSubjectSourceFiles(args.proposalFiles)) {
    byPath.set(file.path, { ...file });
  }
  return [...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function createEvaluationResultRecord(args: {
  runId: string;
  benchmarkFingerprint: string;
  createdAt: string;
  subject: SubjectRecord;
  evaluation: EvaluationRecord;
}): EvaluationResultRecord {
  const evaluation = args.evaluation;
  return {
    id: evaluationResultId(args.runId, args.subject.id),
    runId: args.runId,
    benchmarkFingerprint: args.benchmarkFingerprint,
    subjectFingerprint: args.subject.subjectFingerprint,
    subjectId: args.subject.id,
    createdAt: args.createdAt,
    updatedAt: evaluation.finishedAt ?? args.createdAt,
    status: evaluation.status,
    sampleCount: evaluation.sampleCount,
    completedSampleCount: evaluation.completedSampleCount,
    errorSampleCount: evaluation.errorSampleCount,
    ...(evaluation.metrics ? { metrics: evaluation.metrics } : {}),
    ...(evaluation.durationMs ? { durationMs: evaluation.durationMs } : {}),
    ...(evaluation.usage ? { usage: evaluation.usage } : {}),
    ...(evaluation.error ? { error: evaluation.error } : {}),
    evaluation,
  };
}

function evaluationResultId(runId: string, subjectId: string): string {
  const runPart = runId.replace(/[^a-z0-9]+/giu, "_").replace(/^_+|_+$/gu, "").slice(-24);
  const subjectPart = subjectId.replace(/[^a-z0-9]+/giu, "_").replace(/^_+|_+$/gu, "").slice(-24);
  return `eval_${runPart}_${subjectPart}`;
}

export function selectExecutionOutputFilesForInspection(args: {
  purpose: string | null | undefined;
  files: readonly SurfaceSnapshotFile[];
  output?: Record<string, unknown> | null | undefined;
}): SurfaceSnapshotFile[] {
  return args.files.filter((file) => !isWorkbenchInternalOutputPath(file.path));
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
    /^[a-z-]+_(stdout\.log|stderr\.log|exit_code)$/u.test(normalized)
  );
}

export function createProposalTraceInputFiles(args: {
  runId: string;
  jobs: readonly HostedWorkbenchJob[];
  events: readonly RuntimeEvent[];
}): SurfaceSnapshotFile[] {
  const files: SurfaceSnapshotFile[] = [];
  const manifestJobs: Json[] = [];
  const jobs = args.jobs
    .filter((job) => job.runId === args.runId && isTerminalExecutionJob(job))
    .sort(compareTraceInputJobs);
  for (const job of jobs) {
    const jobFiles = completedJobOutputFiles(job);
    const rawTraceFiles = jobFiles.filter((file) =>
      normalizeRelativePath(file.path).startsWith(".workbench/traces/"),
    );
    files.push(...rawTraceFiles.map((file) => ({ ...file })));
    const events = args.events
      .filter((event) => event.runId === args.runId && event.jobId === job.id)
      .sort((left, right) => left.at.localeCompare(right.at));
    const eventPath = `events/${job.id}.ndjson`;
    if (events.length > 0) {
      files.push(textSurfaceFile(
        eventPath,
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      ));
    }
    const summaryPath = `jobs/${job.id}.json`;
    const summary = proposalTraceJobSummary(job, {
      eventPath: events.length > 0 ? eventPath : null,
      rawTracePaths: rawTraceFiles.map((file) => file.path).sort(),
    });
    files.push(textSurfaceFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`));
    manifestJobs.push({
      ...summary,
      summary_path: summaryPath,
    } as unknown as Json);
  }
  files.push(textSurfaceFile(
    "manifest.json",
    `${JSON.stringify({
      run_id: args.runId,
      jobs: manifestJobs,
    }, null, 2)}\n`,
  ));
  return dedupeSurfaceFiles(files);
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
  const leftTrial = readOptionalJobNumber(left.input, "trialIndex") ?? -1;
  const rightTrial = readOptionalJobNumber(right.input, "trialIndex") ?? -1;
  return leftTrial - rightTrial ||
    purposeSortKey(workbenchExecutionPurpose(left)) - purposeSortKey(workbenchExecutionPurpose(right)) ||
    (readOptionalJobNumber(left.input, "sampleIndex") ?? -1) - (readOptionalJobNumber(right.input, "sampleIndex") ?? -1) ||
    (readJobString(left.input, "caseId") ?? "").localeCompare(readJobString(right.input, "caseId") ?? "") ||
    left.id.localeCompare(right.id);
}

function purposeSortKey(purpose: WorkbenchExecutionSpec["purpose"] | null): number {
	  if (purpose === "improve") {
	    return 0;
	  }
	  if (purpose === "trial") {
	    return 1;
	  }
	  return 3;
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

function proposalTraceJobSummary(
  job: HostedWorkbenchJob,
  paths: { eventPath: string | null; rawTracePaths: readonly string[] },
): Record<string, Json> {
  const output = jsonRecord(job.output);
  return {
    job_id: job.id,
    purpose: workbenchExecutionPurpose(job) ?? "unknown",
    status: job.status,
    subject_id: job.subjectId ?? readJobString(job.input, "subjectId"),
    trial_index: readOptionalJobNumber(job.input, "trialIndex"),
    sample_index: readOptionalJobNumber(job.input, "sampleIndex"),
    case_id: readJobString(job.input, "caseId"),
    created_at: job.createdAt,
    ...(job.startedAt ? { started_at: job.startedAt } : {}),
    ...(job.finishedAt ? { finished_at: job.finishedAt } : {}),
    ...(job.error ? { error: job.error } : {}),
    traces: jobTracePaths(job),
    event_path: paths.eventPath,
    raw_trace_paths: [...paths.rawTracePaths],
    output: summarizeJobOutputForTrace(output),
  } as Record<string, Json>;
}

function summarizeJobOutputForTrace(output: Record<string, Json>): Record<string, Json> {
  const {
    files: _files,
    fileSet: _fileSet,
    subjectPatch,
    ...rest
  } = output;
  const patch = jsonRecord(subjectPatch);
  const { files: _patchFiles, ...patchSummary } = patch;
  return {
    ...rest,
    ...(Object.keys(patch).length > 0
      ? { subjectPatch: patchSummary }
      : {}),
  } as Record<string, Json>;
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
  subjectFilesPath: string;
  subjectFiles: readonly SurfaceSnapshotFile[];
  tasksPath: string;
  taskFiles: readonly SurfaceSnapshotFile[];
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
    ...prefixProjectSourceFiles(input.subjectFiles, input.subjectFilesPath),
    ...prefixProjectSourceFiles(input.taskFiles, input.tasksPath),
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

export function isSubjectSourceFilePath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  return (
    normalized !== ".workbench" &&
    !normalized.startsWith(".workbench/") &&
    normalized !== "workbench-result.json"
  );
}

export function filterSubjectSourceFiles(
  files: readonly SurfaceSnapshotFile[],
): SurfaceSnapshotFile[] {
  return files
    .filter((file) => isSubjectSourceFilePath(file.path))
    .map((file) => ({ ...file }));
}

export function buildSubjectLineage(args: {
  summaries: readonly SubjectSummary[];
  activeId: string | null;
}): SubjectLineageGraph {
  const orderedSummaries = args.summaries.slice().sort((left, right) => {
    const createdAt = left.createdAt.localeCompare(right.createdAt);
    return createdAt !== 0 ? createdAt : left.id.localeCompare(right.id);
  });
  const summaryIds = new Set(orderedSummaries.map((summary) => summary.id));
  return {
    activeId: args.activeId,
    nodes: orderedSummaries.map(
      (summary): SubjectLineageNode => ({
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

export function summarizeSubjectFiles(
  files: readonly SurfaceSnapshotFile[],
  changedPaths: readonly string[] = files.map((file) => file.path),
): SubjectFileSummary[] {
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

export function createSubjectFilePreview(args: {
  files: readonly SurfaceSnapshotFile[];
  path: string;
  view: "diff" | "raw" | "rendered";
}): SubjectFilePreview {
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
  subject: SubjectRecord;
  caseId: string;
  phases?: SubjectCasePhaseRef[];
}): SubjectCaseReview {
  const preferredSampleIndex = uniquePhaseSampleIndex(args.phases ?? []);
  const sampleMatchesCase = (sample: EvaluationSampleRecord) =>
    sample.id === args.caseId ||
    sample.id.startsWith(`${args.caseId}__`) ||
    (sample.cases ?? []).some(
      (entry) =>
        entry.id === args.caseId || entry.id.startsWith(`${args.caseId}__`),
    );
  const samples = args.subject.eval?.samples ?? [];
  const sampleResult =
    samples.find(
      (sample) =>
        typeof preferredSampleIndex === "number" &&
        sample.index === preferredSampleIndex &&
        sampleMatchesCase(sample),
    ) ?? samples.find(sampleMatchesCase);
  const caseResult = sampleResult?.cases?.find(
    (entry) =>
      entry.id === args.caseId || entry.id.startsWith(`${args.caseId}__`),
  );
  if (!sampleResult && (args.phases?.length ?? 0) > 0) {
    return {
      subjectId: args.subject.id,
      caseId: args.caseId,
      caseLabel: args.caseId,
      ...(typeof preferredSampleIndex === "number"
        ? { sampleIndex: preferredSampleIndex }
        : {}),
      metrics: {},
      phases: args.phases ?? [],
      criteria_results: [],
    };
  }
  if (!sampleResult) {
    throw new Error(
      `Case ${args.caseId} was not found on subject ${args.subject.id}.`,
    );
  }
  const durationMs =
    typeof caseResult?.durationMs === "number"
      ? caseResult.durationMs
      : sampleResult?.cases?.length === 1 &&
          typeof sampleResult.durationMs === "number"
        ? sampleResult.durationMs
        : !caseResult && typeof sampleResult.durationMs === "number"
          ? sampleResult.durationMs
        : undefined;
  const sampleStatus =
    sampleResult.status === "planned" ? undefined : sampleResult.status;
  const status = caseResult?.status ?? sampleStatus;
  return {
    subjectId: args.subject.id,
    caseId: caseResult?.id ?? sampleResult.id,
    caseLabel: caseResult?.label ?? args.caseId,
    sampleId: sampleResult.id,
    sampleIndex: sampleResult.index,
    ...(status ? { status } : {}),
    metrics: caseResult?.metrics ?? sampleResult.metrics ?? {},
    ...(typeof durationMs === "number" ? { durationMs } : {}),
    ...(caseResult?.source ? { source: caseResult.source } : {}),
    ...((caseResult?.feedback ?? sampleResult.feedback) !== undefined
      ? { feedback: caseResult?.feedback ?? sampleResult.feedback }
      : {}),
    phases: args.phases ?? [],
    criteria_results: (caseResult?.criteria ?? []).map((criterion) => ({
      criterion_id: criterion.criterion_id,
      pass: criterion.pass,
      score: criterion.score,
      errors: criterion.errors ?? [],
      ...(criterion.rationale ? { rationale: criterion.rationale } : {}),
    })),
  };
}

function uniquePhaseSampleIndex(
  phases: readonly SubjectCasePhaseRef[],
): number | null {
  const sampleIndices = new Set(
    phases
      .map((phase) => phase.sampleIndex)
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
    version: 2,
    benchmark: {
      name: resolved.benchmark.name,
      description: resolved.benchmark.description,
      tasks: resolved.benchmark.tasks,
      environment: runtimeSpecFromRuntime(resolved.benchmark.environment),
      score: scoreSpecFromInvocation(resolved.score),
    },
    subject: {
      name: resolved.subject.name,
      description: resolved.subject.description,
      files: { path: resolved.subject.files.path },
      run: runSpecFromInvocation(resolved.run),
    },
    ...(resolved.optimizer
      ? {
          optimizer: {
            name: resolved.optimizer.name,
            ...(resolved.optimizer.description ? { description: resolved.optimizer.description } : {}),
            edits: [...resolved.optimizer.edits],
            improve: improveSpecFromInvocation(resolved.improve as NonNullable<GenericRunSpec["improve"]>),
          },
        }
      : {}),
  };
}

function improveSpecFromInvocation(
  invocation: NonNullable<GenericRunSpec["improve"]>,
): NonNullable<AuthoredWorkbenchSourceSpec["optimizer"]>["improve"] {
  return authoredAdapterSpecFromInvocation(invocation);
}

function runtimeSpecFromRuntime(
  runtime: GenericRunSpec["environment"],
): AuthoredWorkbenchSourceSpec["benchmark"]["environment"] {
  return {
    dockerfile: runtime.dockerfile,
    ...(runtime.resources ? { resources: runtime.resources } : {}),
    ...(runtime.network ? { network: runtime.network } : {}),
  };
}

function runSpecFromInvocation(
  invocation: WorkbenchAdapterInvocation,
): AuthoredWorkbenchSourceSpec["subject"]["run"] {
  return authoredAdapterSpecFromInvocation(invocation);
}

function scoreSpecFromInvocation(
  invocation: WorkbenchAdapterInvocation,
): AuthoredWorkbenchSourceSpec["benchmark"]["score"] {
  return authoredAdapterSpecFromInvocation(invocation);
}

function authoredAdapterSpecFromInvocation(
  invocation: WorkbenchAdapterInvocation,
): AuthoredWorkbenchSourceSpec["subject"]["run"] {
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
  const taskIds = [...new Set(files.flatMap((file) => {
    const normalized = normalizeRelativePath(file.path);
    const slash = normalized.indexOf("/");
    if (slash <= 0) {
      return [];
    }
    return [normalized.slice(0, slash)];
  }))].sort();
  if (taskIds.length === 0) {
    return [];
  }
  return taskIds.map((taskId, index) => {
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
  summary: SubjectSummary,
  summaryIds: ReadonlySet<string>,
): SubjectLineageEdge[] {
  const edges: SubjectLineageEdge[] = [];
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
  subjectId: string;
  trialIndex: number;
  sample: EvaluationSampleRecord;
  fileChanges: string[];
  files: SurfaceSnapshotFile[];
  traces: string[];
}

interface HostedMaterializedSampleOutput {
  jobs: HostedWorkbenchJob[];
  output: HostedSampleJobOutput;
}

interface HostedProposalJobOutput {
  subjectId: string;
  trialIndex: number;
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
  taskSourceFiles: readonly SurfaceSnapshotFile[];
  taskBundles: readonly WorkbenchTaskBundle[];
  traceFiles?: readonly SurfaceSnapshotFile[];
}): WorkbenchRunWorkload {
  const purpose = workbenchExecutionPurpose(args.job);
  if (!purpose) {
    throw new Error(`Unsupported runtime job kind: ${args.job.kind}`);
  }
  const subjectId =
    readJobString(args.job.input, "subjectId") ?? args.job.subjectId;
  if (!subjectId) {
    throw new Error(`${purpose} execution job is missing subjectId.`);
  }
  const trialIndex = readRequiredJobNumber(
    args.job.input,
    "trialIndex",
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
  const taskBundle = purpose === "improve"
    ? undefined
    : taskBundleForCase(args.taskBundles, caseId);
  const selectedTaskSourceFiles = taskBundle
    ? taskBundle.sourceFiles?.map((file) => ({ ...file })) ?? taskBundleRuntimeSourceFiles(taskBundle)
    : [];
  const task = taskBundle?.task;
  const initial = createInitialSubjectFiles({
    baseFiles: args.baseFiles,
    spec: args.spec,
    trialIndex,
  });
  return {
    job: args.job,
    spec: args.spec,
    subjectId,
    trialIndex,
    sampleIndex,
    subjectFiles: initial.files,
    caseId,
    taskSourceFiles: selectedTaskSourceFiles,
    traceFiles: (args.traceFiles ?? []).map((file) => ({ ...file })),
    ...(taskBundle ? { taskBundle } : {}),
    ...(task ? { task } : {}),
    prompt: initial.prompt,
    changedPaths: initial.changedPaths,
    baseId: readJobString(args.job.input, "baseId"),
  };
}

function taskBundleRuntimeSourceFiles(taskBundle: WorkbenchTaskBundle): SurfaceSnapshotFile[] {
  return [
    ...taskBundle.publicFiles.map((file) => ({ ...file })),
    ...taskBundle.testFiles.map((file) => ({ ...file })),
    ...(taskBundle.solutionFiles ?? []).map((file) => ({ ...file })),
  ].sort((left, right) => left.path.localeCompare(right.path));
}

function createInitialSubjectFiles(args: {
  baseFiles: readonly SurfaceSnapshotFile[];
  spec: GenericRunSpec;
  trialIndex: number;
}): {
  files: SurfaceSnapshotFile[];
  changedPaths: string[];
  prompt: string;
} {
  const editablePaths = optimizerEdits(args.spec).map(normalizeRelativePath);
  const editPath = editablePaths[0];
  const subjectPaths = editPath ? [editPath] : [];
  const files =
    args.baseFiles.length > 0
      ? args.baseFiles.map((file) => ({ ...file }))
      : editPath
        ? normalizeSurfaceFiles([{ path: editPath, content: "" }])
        : [];
  const prompt = [
    `Run the subject workload for benchmark: ${args.spec.benchmark.description}`,
    `Trial ${args.trialIndex + 1} uses ${formatOptimizerSummary(args.spec)}; the improve adapter may edit the subject before Workbench scores it.`,
  ].join("\n");
  const byPath = new Map(files.map((file) => [file.path, file]));
  if (
    editPath &&
    ![...byPath.keys()].some((filePath) => subjectPaths.includes(filePath))
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
    const runtimeArgs =
      adapterAuthProfiles.length > 0
        ? { ...args, adapterAuthProfiles }
        : args;
    const executionForSandbox = readWorkbenchExecutionSpec(runtimeArgs.job);
    const fileStore = createWorkbenchSandboxFileStore(runtimeArgs);
    const planeFactory = options.createSandboxPlaneForProvider ?? createSandboxBackendPlaneForProvider;
    const plane = planeFactory(
      options.sandboxProvider,
      runtimeArgs,
      startedAt,
      fileStore,
    );
    const validated = await executeValidatedSandboxExecution(plane, executionForSandbox, {
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
  } catch (error) {
    return failWorkbenchRunJob(args.job, startedAt, error);
  }
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

export async function executeAdapterInCurrentSandboxRuntime(
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
    ...(Object.keys(adapterAuth.env).length > 0
      ? { adapterAuthEnv: adapterAuth.env }
      : {}),
    ...(adapterAuth.request ? { adapterAuthRequest: adapterAuth.request } : {}),
  };
  try {
    if (execution.purpose === "improve") {
      return await executeProposalExecutionInSandbox(
        runtimeInput,
        execution,
        startedAt,
        capability,
        eventPublisher,
      );
    }
    if (execution.purpose === "trial") {
      return await executeTrialExecutionInSandbox(
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
  request?: Json;
  cleanup?: () => Promise<void>;
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
    return {
      env,
      request: adapterAuthRequest(adapterProfiles, undefined, execution.adapter.use),
    };
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
    request: adapterAuthRequest(adapterProfiles, root, execution.adapter.use),
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

function adapterAuthRequest(
  bundles: readonly WorkbenchAdapterAuthBundle[],
  root?: string,
  currentAdapterId?: string,
): Json {
  const self: Record<string, Json> = {};
  const adapters: Record<string, Record<string, Json>> = {};
  for (const bundle of bundles) {
    const key = bundle.slot ?? "default";
    const fileAuth = bundle.files.length > 0
      ? {
          ...(root ? { filesRoot: `${root}/${bundle.adapterId}/${bundle.slot ?? "_"}/${bundle.profile}` } : {}),
          files: bundle.files.map((file) => ({
            path: file.path,
            encoding: file.encoding,
          })),
        }
      : undefined;
    const entry: Json = {
      method: bundle.method,
      profile: bundle.profile,
      ...(bundle.env && bundle.env.length > 0
        ? { env: Object.fromEntries(bundle.env.map((entry) => [entry.name, "materialized"])) }
        : {}),
      ...(fileAuth ? fileAuth : {}),
    };
    adapters[bundle.adapterId] = {
      ...(adapters[bundle.adapterId] ?? {}),
      [key]: entry,
    };
    if (!currentAdapterId || bundle.adapterId === currentAdapterId) {
      self[key] = entry;
    }
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
  args: Pick<WorkbenchExecutionRuntimeInput, "adapterManifests">,
): WorkbenchAdapterAuthTarget[] {
  const manifests = args.adapterManifests ?? [];
  return collectWorkbenchAdapterAuthRequirements([execution.adapter], manifests)
    .map((target) => normalizeWorkbenchAdapterAuthTarget(target));
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

async function executeProposalExecutionInSandbox(
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
  const subjectPatch = createSubjectPatchFromResult(result, args.spec);
  if (subjectPatch.fileChanges.length === 0) {
    return failWorkbenchRunJob(
      args.job,
      startedAt,
      `${execution.adapter.use === "command" ? "Command improve adapter" : `Adapter ${execution.adapter.use}`} completed without changing subject files covered by optimizer edits.`,
      finishedAt,
      result,
    );
  }
  const proposalFiles = applyWorkbenchSubjectPatch({
    baseFiles: workload.subjectFiles,
    patch: subjectPatch,
    edits: requireOptimizerEdits(args.spec),
  });
  const usage = assignUsageRole("optimizer", result.usage);
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
      subjectId: workload.subjectId,
      trialIndex: workload.trialIndex,
      baseId: workload.baseId,
      prompt: workload.prompt,
      subjectPatch,
      fileChanges: subjectPatch.fileChanges,
      files: proposalFiles,
      traces: traceFilePaths(result.files),
      ...(usage ? { usage } : {}),
      ...(result.summary !== undefined ? { summary: result.summary } : {}),
      ...(result.feedback !== undefined ? { feedback: result.feedback } : {}),
    } as unknown as Json,
  };
}

async function executeTrialExecutionInSandbox(
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
    taskSourceFiles: args.taskSourceFiles,
    taskBundles: args.taskBundles,
    traceFiles: args.traceFiles,
  });
  const result = await runHostedCommandExecutionPhases(
    args,
    workload,
    trialPhasesForExecution(execution, args.spec, args.adapterManifests),
    startedAt,
    {
      capability,
      eventPublisher,
    },
  );
  if (result.error || (result.exitCode ?? 0) !== 0) {
    return failWorkbenchRunJob(
      args.job,
      startedAt,
      result.error ?? `Trial adapter execution exited with status ${result.exitCode}.`,
      result.finishedAt,
      result,
    );
  }
  const scorecard = result.scorecard;
  if (
    !scorecard ||
    typeof scorecard.score !== "number" ||
    !Number.isFinite(scorecard.score)
  ) {
    return failWorkbenchRunJob(
      args.job,
      startedAt,
      "Trial scorer must return a workbench-result scorecard with a finite numeric score.",
      result.finishedAt,
      result,
    );
  }
  const finishedAt = result.finishedAt ?? new Date().toISOString();
  const usage = mergeUsageSummaries([
    result.usage,
    scorecard.usage,
  ]);
  const sample = evaluateSample({
    subjectId: workload.subjectId,
    files: result.files,
    taskSourceFiles: workload.taskSourceFiles,
    spec: workload.spec,
    trialIndex: workload.trialIndex,
    sampleIndex: workload.sampleIndex,
    caseId: workload.caseId,
    startedAt,
    finishedAt,
    durationMs: result.durationMs,
    workload: {
      ...result,
      ...(usage ? { usage } : {}),
      score: scorecard.score,
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
      subjectId: workload.subjectId,
      trialIndex: workload.trialIndex,
      sampleIndex: workload.sampleIndex,
      caseId: workload.caseId,
      prompt: workload.prompt,
      scorecard,
      fileChanges:
        result.fileChanges.length > 0
          ? result.fileChanges
          : workload.changedPaths,
      files: result.files,
      sample,
      ...(usage ? { usage } : {}),
      traces: traceFilePaths(result.files),
    } as unknown as Json,
  };
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
    taskSourceFiles: args.taskSourceFiles,
    taskBundles: args.taskBundles,
    traceFiles: args.traceFiles,
  });
  const result = await runHostedCommandExecutionPhases(
    args,
    workload,
    [protocolPhaseForExecution(execution, args.adapterManifests)],
    startedAt,
    {
      capability,
      eventPublisher,
    },
  );
  return { workload, result };
}

async function runHostedCommandExecutionPhases(
  args: WorkbenchExecutionRuntimeInput,
  workload: WorkbenchRunWorkload,
  phases: readonly WorkbenchWorkloadPhaseCommand[],
  startedAt: string,
  options: {
    capability?: ReturnType<typeof createWorkbenchExecutionCapability>;
    eventPublisher?: WorkbenchExecutionEventPublisher;
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
  const resolvedRuntime = workload.task
    ? resolveTaskExecutionConfig({
        spec: workload.spec,
        task: workload.task,
      }).environment
    : workload.spec.environment;
  const environmentVersion =
    args.environmentVersion ??
    (resolvedRuntime
      ? environmentVersionForSpec(workload.spec)
      : undefined);
  const workspace = await createRuntimeWorkspaceRoot(
    args,
    fs,
    os,
    path,
    "workbench-execution-sandbox-",
  );
  try {
    await stageWorkbenchRunWorkload(workspace.root, workload);
    let exitCode = 0;
    let runtimeError: string | undefined;
    const phaseResults: WorkbenchAdapterOperationResult[] = [];
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
      const phaseTimeoutMs = environmentVersion
        ? environmentVersionTimeoutMs(environmentVersion)
        : 5 * 60 * 1000;
      const execution = readWorkbenchExecutionSpec(workload.job);
      for (const phase of phases) {
        await resetHostedWorkloadPhaseOutput(workspace.root, phase);
        if (phase.kind === "scorer" && execution.purpose === "trial") {
          await stageTrialScoringInputs(workspace.root, workload);
        }
        const adapterRequestPath = await writeWorkbenchAdapterRequest(
          workspace.root,
          workload,
          execution,
          phase,
          args.adapterAuthRequest,
        );
        const phaseRole = phaseEventRole(phase);
        await publishCommandPhaseEvent(options.eventPublisher, {
          phase: phase.label,
          status: "started",
          ...(phaseRole ? { role: phaseRole } : {}),
        });
        try {
          if (!phase.command) {
            throw new Error(`Adapter phase ${phase.label} is missing a command.`);
          }
          const command = createHostedWorkloadShellCommand(
            workspace.root,
            phase.command,
            phase.label,
            phase.okExitCodes,
          );
          await execFileAsync("sh", ["-lc", command], {
            cwd: workspace.root,
            env: createHostedWorkloadPhaseEnv(
              workspace.root,
              adapterRequestPath,
              args.adapterAuthEnv,
            ),
            maxBuffer: 10 * 1024 * 1024,
            timeout: phaseTimeoutMs,
          });
          const operationResult = await readWorkbenchAdapterOperationResult(outputDir(workspace.root), phase.operation);
          assertWorkbenchAdapterOperationResultOk(
            operationResult,
            `Adapter ${phase.adapter?.use ?? execution.adapter.use} ${phase.operation}`,
          );
          phaseResults.push(operationResult);
          await publishCommandPhaseEvent(options.eventPublisher, {
            phase: phase.label,
            status: "succeeded",
            ...(phaseRole ? { role: phaseRole } : {}),
          });
        } catch (error) {
          await publishCommandPhaseEvent(options.eventPublisher, {
            phase: phase.label,
            status: "failed",
            exitCode: readExitCode(error),
            error: error instanceof Error ? error.message : String(error),
            ...(phaseRole ? { role: phaseRole } : {}),
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
    return await readWorkbenchRunWorkloadResult(workspace.root, workload, {
      exitCode,
      startedAt,
      phaseResults,
    });
  } finally {
    await workspace.cleanup();
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

function phaseEventRole(
  phase: WorkbenchWorkloadPhaseCommand,
): "optimizer" | "runner" | "scorer" | undefined {
  if (phase.kind === "optimizer") {
    return "optimizer";
  }
  if (phase.kind === "runner") {
    return "runner";
  }
  if (phase.kind === "scorer") {
    return "scorer";
  }
  return undefined;
}

function adapterOperationUsageSummary(
  result: WorkbenchAdapterOperationResult,
): UsageSummary | undefined {
  if (result.operation === "subject.improve") {
    return assignUsageRole("optimizer", result.usage);
  }
  if (result.operation === "subject.run") {
    return assignUsageRole("runner", result.usage);
  }
  if (result.operation === "trial.score") {
    return assignUsageRole("scorer", result.usage);
  }
  return result.usage;
}

function executionPurposeRole(
  purpose: WorkbenchExecutionSpec["purpose"],
): "optimizer" | "runner" {
  if (purpose === "improve") {
    return "optimizer";
  }
  return "runner";
}

function createSubjectPatchFromResult(
  result: RuntimeWorkloadResult,
  spec: GenericRunSpec,
): WorkbenchSubjectPatch {
  if (result.subjectPatch) {
    return result.subjectPatch;
  }
  const changedEditPaths = result.fileChanges
    .map(normalizeRelativePath)
    .filter(
      (filePath) =>
        !filePath.startsWith(".workbench/") &&
        isSubjectEditPath(filePath, optimizerEdits(spec)),
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

function isSubjectEditPath(
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
  const image = environmentImage(spec);
  const resolved = findEnvironmentVersionForImage(
    image,
    DEFAULT_ENVIRONMENT_VERSIONS,
  );
  if (resolved) {
    return {
      id: resolved.id,
      imageRef: resolved.imageRef,
      spec: {
        ...resolved.spec,
        network: environmentNetwork(spec),
        resources: definedEnvironmentResources(environmentResources(spec)),
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
      network: environmentNetwork(spec),
      resources: definedEnvironmentResources(environmentResources(spec)),
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
  ]);
  await fs.mkdir(inputDir(root), { recursive: true });
  await fs.mkdir(outputDir(root), { recursive: true });
  if (purpose === "trial") {
    await Promise.all([
      fs.rm(runtimeTestsDir(root), { recursive: true, force: true }).catch(() => undefined),
      fs.rm(runtimeLogsDir(root), { recursive: true, force: true }).catch(() => undefined),
    ]);
    await fs.mkdir(subjectDir(root), { recursive: true });
    await fs.mkdir(taskDir(root), { recursive: true });
    await fs.mkdir(runtimeLogsAgentDir(root), { recursive: true });
    await fs.mkdir(runtimeLogsVerifierDir(root), { recursive: true });
    await fs.mkdir(runtimeLogsArtifactsDir(root), { recursive: true });
    const taskBundle = requireWorkloadTaskBundle(workload, "Trial staging");
    await writeSurfaceFiles(subjectDir(root), workload.subjectFiles);
    await writeSurfaceFiles(taskDir(root), workload.taskSourceFiles);
    await writeSurfaceFiles(root, taskBundle.publicFiles);
    await writeSurfaceFiles(root, workload.subjectFiles);
    return;
  }
  if (purpose === "improve") {
    await fs.mkdir(subjectDir(root), { recursive: true });
    await writeSurfaceFiles(subjectDir(root), workload.subjectFiles);
    await writeSurfaceFiles(root, workload.subjectFiles);
    await fs.mkdir(tracesDir(root), { recursive: true });
    await writeSurfaceFiles(tracesDir(root), workload.traceFiles);
  }
}

async function stageTrialScoringInputs(
  root: string,
  workload: WorkbenchRunWorkload,
): Promise<void> {
  const fs = await importNodeModule<any>(nodeBuiltin("fs/promises"));
  const taskBundle = requireWorkloadTaskBundle(workload, "Trial scoring");
  await fs.mkdir(runtimeTestsDir(root), { recursive: true });
  await fs.mkdir(runtimeLogsVerifierDir(root), { recursive: true });
  await writeSurfaceFiles(runtimeTestsDir(root), taskBundle.testFiles);
}

async function readHostedRunFailureResult(
  root: string,
  workload: WorkbenchRunWorkload,
  options: { exitCode: number; error: string; startedAt?: string },
): Promise<RuntimeWorkloadResult> {
  const traceFiles = await readRuntimeTraceFiles(root, workload);
  const outputFiles = filterRuntimeOutputFiles(
    await readSurfaceFiles(outputDir(root)),
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
    phaseResults?: readonly WorkbenchAdapterOperationResult[];
  } = {},
): Promise<RuntimeWorkloadResult> {
  const path = await importNodeModule<any>(nodeBuiltin("path"));
  const traceFiles = await readRuntimeTraceFiles(root, workload);
  const outputFiles = filterRuntimeOutputFiles(
    await readSurfaceFiles(outputDir(root)),
  );
  const outputExitCode = await readOptionalNumber(
    path.join(outputDir(root), "exit_code"),
  );
  const startedAt = options.startedAt ?? new Date().toISOString();
  const finishedAt = new Date().toISOString();
  const purpose = readWorkloadExecutionPurpose(workload);
  const primaryOperation: WorkbenchAdapterOperation = purpose === "improve" ? "subject.improve" : "trial.score";
  const primaryResult = [...(options.phaseResults ?? [])]
    .reverse()
    .find((result) => result.operation === primaryOperation);
  const result = jsonRecord(primaryResult?.value);
  const usage = mergeUsageSummaries([
    options.usage,
    ...(options.phaseResults ?? []).map(adapterOperationUsageSummary),
  ]);
  const metrics = normalizeRewardMetrics(result.metrics);
  const cases = normalizeRewardCases(result.cases);
	  const includeResultScoring = purpose === "trial";
  const files = [...outputFiles, ...traceFiles].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const subjectPatch =
    purpose === "improve" ? primaryResult?.value as WorkbenchSubjectPatch | undefined : undefined;
  const scorecard =
	    purpose === "trial" ? primaryResult?.value as WorkbenchScorecard | undefined : undefined;
  const declaredChanges =
    subjectPatch?.fileChanges ??
    (Array.isArray(result.fileChanges)
      ? result.fileChanges.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : files.map((file) => file.path));
  return {
    files,
    fileChanges: declaredChanges,
    ...(subjectPatch ? { subjectPatch } : {}),
    ...(scorecard ? { scorecard } : {}),
    ...(includeResultScoring &&
    typeof result.score === "number" && Number.isFinite(result.score)
      ? { score: result.score }
      : {}),
    ...(includeResultScoring && metrics ? { metrics } : {}),
    ...(includeResultScoring && cases ? { cases } : {}),
    ...(typeof result.summary === "string"
      ? { summary: result.summary }
      : primaryResult?.summary !== undefined
        ? { summary: primaryResult.summary }
        : {}),
    ...(result.feedback !== undefined
      ? { feedback: result.feedback as Json }
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
  const outputTraceRoot = workbenchTracePhaseDirectory({
    sequence: 1,
    runId: workload.job.runId,
    phase: purpose,
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

async function resetHostedWorkloadPhaseOutput(
  root: string,
  _phase: WorkbenchWorkloadPhaseCommand,
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
  phase: WorkbenchWorkloadPhaseCommand,
  auth?: Json,
): Promise<string> {
  const [fs, path] = await Promise.all([
    importNodeModule<any>(nodeBuiltin("fs/promises")),
    importNodeModule<any>(nodeBuiltin("path")),
  ]);
  const requestPath = path.join(root, ".workbench", "request.json");
  await fs.mkdir(path.dirname(requestPath), { recursive: true });
  const task = workload.task?.task;
  const adapter = phase.adapter ?? execution.adapter;
  await fs.writeFile(
    requestPath,
    `${JSON.stringify({
      protocol: "workbench.adapter.v2",
      id: execution.id,
      jobId: workload.job.id,
      operation: phase.operation,
      invocation: {
        use: adapter.use,
        with: adapterConfigRecord(adapter),
        ...(adapter.auth !== undefined ? { auth: adapter.auth } : {}),
      },
      ...(auth !== undefined ? { auth } : {}),
      context: {
        benchmark: {
          name: workload.spec.benchmark.name,
          description: workload.spec.benchmark.description,
        },
        subject: {
          id: workload.subjectId,
          path: workload.spec.subject.files.path,
        },
        ...(workload.spec.optimizer
          ? { optimizer: { edits: [...workload.spec.optimizer.edits] } }
          : {}),
        trial: {
          trialIndex: workload.trialIndex,
          sampleIndex: workload.sampleIndex,
          caseId: workload.caseId,
        },
        ...(task ? { task: { text: task } } : {}),
      },
      paths: {
        workspace: root,
        cwd: root,
        input: inputDir(root),
        output: outputDir(root),
        result: workbenchAdapterOperationResultPath(outputDir(root)),
        subject: subjectDir(root),
        task: taskDir(root),
        traces: tracesDir(root),
        tests: runtimeTestsDir(root),
        logs: runtimeLogsDir(root),
        artifacts: runtimeLogsArtifactsDir(root),
      },
    }, null, 2)}\n`,
  );
  return requestPath;
}

function optimizerEdits(spec: GenericRunSpec): string[] {
  return spec.optimizer?.edits ?? [];
}

function requireOptimizerEdits(spec: GenericRunSpec): string[] {
  const edits = optimizerEdits(spec);
  if (edits.length === 0) {
    throw new Error("Optimizer YAML must declare at least one entry in edits.");
  }
  return edits;
}

function createHostedWorkloadPhaseEnv(
  root: string,
  adapterRequestPath: string,
  adapterEnv: Record<string, string> = {},
): Record<string, string> {
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
  env.PATH = process.env.PATH
    ? `${process.env.PATH}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`
    : "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  env.WORKBENCH_ADAPTER_REQUEST = adapterRequestPath;
  env.WORKBENCH_OUTPUT = outputDir(root);
  env.WORKBENCH_RESULT = workbenchAdapterOperationResultPath(outputDir(root));
  Object.assign(env, adapterEnv);
  return env;
}

function readWorkloadExecutionPurpose(
  workload: WorkbenchRunWorkload,
): WorkbenchExecutionSpec["purpose"] {
  const purpose = workbenchExecutionPurpose(workload.job);
  if (purpose === "improve" || purpose === "trial") {
    return purpose;
  }
  throw new Error(
    `Execution job ${workload.job.id} is missing a supported execution purpose.`,
  );
}

function requireWorkloadTaskBundle(
  workload: WorkbenchRunWorkload,
  label: string,
): WorkbenchTaskBundle {
  if (!workload.taskBundle) {
    throw new Error(`${label} workload is missing a task bundle.`);
  }
  return workload.taskBundle;
}

function subjectDir(root: string): string {
  return `${inputDir(root)}/subject`;
}

function taskDir(root: string): string {
  return `${inputDir(root)}/task`;
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

function runtimeTestsDir(root: string): string {
  return process.env.WORKBENCH_IN_DOCKER_SANDBOX === "1" ? "/tests" : `${root}/tests`;
}

function runtimeLogsDir(root: string): string {
  return process.env.WORKBENCH_IN_DOCKER_SANDBOX === "1" ? "/logs" : `${root}/logs`;
}

function runtimeLogsAgentDir(root: string): string {
  return `${runtimeLogsDir(root)}/agent`;
}

function runtimeLogsVerifierDir(root: string): string {
  return `${runtimeLogsDir(root)}/verifier`;
}

function runtimeLogsArtifactsDir(root: string): string {
  return `${runtimeLogsDir(root)}/artifacts`;
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

async function readSurfaceFiles(root: string): Promise<SurfaceSnapshotFile[]> {
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
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const relativePath = normalizeRelativePath(
        path.relative(root, absolutePath).replace(/\\/gu, "/"),
      );
      const body = await fs.readFile(absolutePath);
      const stats = await fs.stat(absolutePath);
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

function normalizeRewardMetrics(
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

function normalizeRewardCases(value: unknown): EvalCaseResult[] | undefined {
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
    const metrics = normalizeRewardMetrics(record.metrics) ?? {};
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
                : score !== undefined
                  ? score >= 0.5
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
  subjectId: string;
  files: readonly SurfaceSnapshotFile[];
  taskSourceFiles: readonly SurfaceSnapshotFile[];
  spec: GenericRunSpec;
  trialIndex: number;
  sampleIndex: number;
  caseId: string;
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  workload: RuntimeWorkloadResult;
}): EvaluationSampleRecord {
  const durationMs =
    args.durationMs ??
    Math.max(0, Date.parse(args.finishedAt) - Date.parse(args.startedAt));
  const sampleScore = args.workload.score!;
  const cases = args.workload.cases?.length ? args.workload.cases : undefined;
  const metrics = args.workload.metrics ?? {
    score: sampleScore,
  };
  if (metrics.score === undefined) {
    metrics.score = sampleScore;
  }
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
    subject: {
      id: args.subjectId,
      kind: "subject",
      label: args.subjectId,
    },
    status: "completed",
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    durationMs,
    metrics,
    ...(usage ? { usage } : {}),
    ...(cases ? { cases } : {}),
    feedback,
  };
}

function normalizeSampleJobOutput(
  value: unknown,
  fallbackFiles: readonly SurfaceSnapshotFile[] = [],
): HostedSampleJobOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true || typeof record.subjectId !== "string") {
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
    typeof record.trialIndex !== "number" ||
    !Number.isFinite(record.trialIndex)
  ) {
    return null;
  }
  const sampleFiles = files.length > 0
    ? files
    : fallbackFiles.map((file) => ({ ...file }));
  return {
    subjectId: record.subjectId,
    trialIndex: record.trialIndex,
    sample,
    fileChanges: Array.isArray(record.fileChanges)
      ? record.fileChanges.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    files: sampleFiles,
    traces: Array.isArray(record.traces)
      ? record.traces.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : traceFilePaths(sampleFiles),
  };
}

function normalizeEvaluationSampleOutputs(args: {
  jobs: readonly HostedWorkbenchJob[];
  allJobs: readonly HostedWorkbenchJob[];
	}): HostedMaterializedSampleOutput[] {
	  return args.jobs.flatMap((job): HostedMaterializedSampleOutput[] => {
	    const output = normalizeSampleJobOutput(job.output);
	    return output ? [{ jobs: [job], output }] : [];
	  });
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
  trialJob: HostedWorkbenchJob,
): EvaluationSampleRecord {
  const usage = normalizeUsageSummary(jsonRecord(trialJob.output).usage)
    ?? completeUsageSummary(sample.usage);
  if (!usage) {
    return sample;
  }
  return {
    ...sample,
    usage,
  };
}

function normalizeProposalJobOutput(
  value: unknown,
): HostedProposalJobOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true || typeof record.subjectId !== "string") {
    return null;
  }
  const files = Array.isArray(record.files)
    ? record.files.filter(isSurfaceSnapshotFile)
    : [];
  if (
    typeof record.trialIndex !== "number" ||
    !Number.isFinite(record.trialIndex)
  ) {
    return null;
  }
  const usage = normalizeUsageSummary(record.usage);
  return {
    subjectId: record.subjectId,
    trialIndex: record.trialIndex,
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
  subjectId: string,
  trialIndex: number,
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
    .map((group) => errorEvaluationSampleFromJobGroup(group, subjectId, trialIndex))
    .filter((sample): sample is EvaluationSampleRecord => sample !== null);
}

function errorEvaluationSampleFromJobGroup(
  jobs: readonly HostedWorkbenchJob[],
  subjectId: string,
  trialIndex: number,
): EvaluationSampleRecord | null {
  const job = jobs[0];
  if (!job) {
    return null;
  }
  const sampleIndex = readOptionalJobNumber(job.input, "sampleIndex");
  const caseId = readJobString(job.input, "caseId");
  if (sampleIndex === null || !caseId) {
    return null;
  }
  const startedAt = minIsoTimestamp(jobs.map((entry) => entry.startedAt ?? entry.createdAt));
  const finishedAt = maxIsoTimestamp(jobs.map((entry) => entry.finishedAt ?? entry.updatedAt ?? entry.startedAt));
  const error = summarizeEvaluationJobErrors(jobs) ?? "Evaluation job did not produce a valid sample.";
  return {
    id: `${caseId}__sample_${String(sampleIndex + 1).padStart(3, "0")}`,
    index: sampleIndex,
    subject: {
      id: subjectId,
      kind: "subject",
      label: subjectId,
    },
    status: "error",
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    ...(startedAt && finishedAt
      ? { durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)) }
      : {}),
    ...(error ? { error } : {}),
    cases: [{
      id: caseId,
      status: "error",
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
  subjectId: string,
  rawSamples: EvaluationSampleRecord[],
): EvaluationRecord {
  const samples = mergeEvaluationSampleRecords(rawSamples);
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
    subject: {
      id: subjectId,
      kind: "subject",
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
    return normalizeSingleCaseDurations(first);
  }
  const startedAt = minTimestamp(group.flatMap((sample) => (sample.startedAt ? [sample.startedAt] : [])));
  const finishedAt = maxTimestamp(group.flatMap((sample) => (sample.finishedAt ? [sample.finishedAt] : [])));
  const durationMs = startedAt && finishedAt
    ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
    : undefined;
  const cases = group.flatMap((sample) => normalizeCaseDurations(sample));
  const metrics = aggregateSampleGroupMetrics(group);
  const usage = mergeUsageSummaries(group.map((sample) => sample.usage));
  const errors = group.flatMap((sample) => sample.error ? [sample.error] : []);
  return {
    id: `sample_${String(first.index + 1).padStart(3, "0")}`,
    index: first.index,
    subject: first.subject,
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

function normalizeSingleCaseDurations(
  sample: EvaluationSampleRecord,
): EvaluationSampleRecord {
  if (!sample.cases) {
    return sample;
  }
  const cases = normalizeCaseDurations(sample);
  return cases.length === sample.cases.length
    ? { ...sample, cases }
    : sample;
}

function normalizeCaseDurations(
  sample: EvaluationSampleRecord,
): EvalCaseResult[] {
  return (sample.cases ?? []).map((caseResult) => (
    typeof caseResult.durationMs === "number" ||
    sample.cases?.length !== 1 ||
    typeof sample.durationMs !== "number"
      ? caseResult
      : { ...caseResult, durationMs: sample.durationMs }
  ));
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

function evaluationMeanMetrics(
  evaluation: EvaluationRecord,
): Record<string, number> | undefined {
  const entries = Object.entries(evaluation.metrics ?? {}).filter(
    (entry): entry is [string, MetricStats] => Number.isFinite(entry[1].mean),
  );
  return entries.length > 0
    ? Object.fromEntries(
        entries.map(([key, stats]) => [key, Number(stats.mean.toFixed(3))]),
      )
    : undefined;
}

function selectSubject(args: {
  subjects: readonly SubjectRecord[];
  previousSubject: SubjectRecord | null;
}): SubjectRecord | null {
  let selected = args.previousSubject;
  for (const subject of args.subjects) {
    if (!selected || hasHigherScore(subject, selected)) {
      selected = subject;
    }
  }
  return selected;
}

function hasHigherScore(
  subject: SubjectRecord,
  incumbent: SubjectRecord,
): boolean {
  const subjectValue = readMetric(subject, "score");
  const incumbentValue = readMetric(incumbent, "score");
  if (subjectValue == null) {
    return false;
  }
  if (incumbentValue == null) {
    return true;
  }
  return subjectValue > incumbentValue;
}

function readMetric(subject: SubjectRecord, metric: string): number | null {
  const direct = subject.metrics?.[metric];
  return typeof direct === "number" && Number.isFinite(direct) ? direct : null;
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
): SubjectFileSummary["preview_kind"] {
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
    typeof record.subject === "object" &&
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
