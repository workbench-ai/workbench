import { AsyncLocalStorage } from "node:async_hooks";
import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify, TextDecoder } from "node:util";

import YAML from "yaml";

import {
  buildWorkbenchJobReport,
  compareWorkbenchNaturalText,
  compareWorkbenchVersions,
  isWorkbenchJobStatusTerminal,
  isWorkbenchAuthoredControlPath,
  isWorkbenchJson,
  isWorkbenchLiveInspectableProjectPath,
  isWorkbenchPackageSourcePath,
  isWorkbenchRuntimeMetadataPath,
  isWorkbenchRunStatusTerminal,
  isWorkbenchSkillVisibility,
  normalizeWorkbenchSkillName,
  normalizeWorkbenchSourcePath,
  parseWorkbenchProjectState,
  WorkbenchStateValidationError,
  workbenchGradePlanAuthoringIssues,
  workbenchGradePlanAuthoringValues,
  workbenchJobScore,
  workbenchRunOwnsJob,
  workbenchRunStatusFromJobs,
  workbenchSkillVersionIdentity,
  workbenchSampleCoverage,
  workbenchSampleCoverageForJobs,
  workbenchOperationStepsForRunKind as stepsForRunKind,
  workbenchRunKindForOperationSteps as runKindForOperationSteps,
} from "@workbench-ai/workbench-contract";
import type {
  Json,
  EvalCaseResult,
  WorkbenchExecutionJob,
  SurfaceSnapshotFile,
  WorkbenchArtifact,
  WorkbenchAdapterInvocation,
  WorkbenchAgentSnapshot,
  WorkbenchSkillPatch,
  WorkbenchResults,
  WorkbenchCaseGradeMutation,
  WorkbenchDefaultAgentSelection,
  WorkbenchEvalCaseSnapshot,
  WorkbenchGradePlan,
  WorkbenchGradeAdapterOption,
  WorkbenchGradeMutationRequest,
  WorkbenchEvalVersionSummary,
  WorkbenchGradePlanDisplayBlock,
  WorkbenchGradePlanAuthoringControl,
  WorkbenchGradePlanAuthoringListField,
  WorkbenchGradePlanSource,
  WorkbenchEvalSnapshot,
  WorkbenchExecutionEvidence,
  WorkbenchExecutionEventBatch,
  WorkbenchExecutionResult,
  WorkbenchExecutionSpec,
  WorkbenchExecutionTrace,
  WorkbenchExecutionTraceDetail,
  WorkbenchInspectionSnapshot,
  WorkbenchActionCapabilities,
  WorkbenchCaseRunKind,
  WorkbenchJobReport,
  WorkbenchOperationPlanSummary,
  WorkbenchOperationRequest,
  WorkbenchOperationStep,
  WorkbenchOperationTarget,
  WorkbenchOperationVariant,
  WorkbenchRunSnapshot,
  WorkbenchMeasurementSummary,
  WorkbenchSampleCoverage,
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
  WorkbenchRunLocation,
  WorkbenchAgent,
  WorkbenchSkillBundleSnapshot,
  WorkbenchSkillInclude,
  WorkbenchSkillSource,
  WorkbenchStatus,
  WorkbenchSkillVisibility,
  WorkbenchTrace,
  WorkbenchTraceSession,
  WorkbenchVersion,
  UsageSummary,
} from "@workbench-ai/workbench-contract";
import {
  assertWorkbenchAdapterOperationResultOk,
  builtinWorkbenchAdapterManifest,
  builtinWorkbenchAdapterManifests,
  collectWorkbenchAdapterAuthRequirements,
  collectWorkbenchAdapterInvocations,
  isWorkbenchAdapterOperationResult,
  isWorkbenchBuiltInAdapterId,
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
  readWorkbenchPlannedExecutionJobInput,
} from "./sandbox-inputs.ts";
import {
  createSandboxBackendPlaneForBackend,
  DOCKER_SANDBOX_BACKEND,
} from "./sandbox-backends/index.ts";
import { requestWorkbenchCloudJson } from "./cloud-json.ts";
export { requestWorkbenchCloudJson } from "./cloud-json.ts";
export { runWorkbenchSandboxProcess } from "./sandbox-process.ts";
import {
  writeFileAtomically,
  writeJsonFileAtomically,
} from "./atomic-files.ts";
export {
  writeFileAtomically,
  writeJsonFileAtomically,
} from "./atomic-files.ts";
import {
  assertDockerSandboxAvailable,
} from "./sandbox-backends/docker.ts";
import {
  abortSignalOrUndefined,
  asRuntimeRecord,
  dedupeSurfaceFiles,
  fileErrorCode,
  normalizeRelativePath,
  publicGradeMetrics,
  quoteShellArg,
  resolveWorkbenchWorkerId,
  sleep,
  writeSurfaceFiles,
} from "./runtime-utils.ts";
import {
  listWorkbenchTraceRecords,
  writeWorkbenchTraceRecord,
} from "./trace-runtime.ts";
import type {
  WorkbenchAdapterAuthBundle,
  WorkbenchAdapterAuthTarget,
} from "./adapter-auth.ts";
import {
  adapterAuthEnv,
  localWorkbenchAdapterAuthStore,
  normalizeWorkbenchAdapterAuthTarget,
  sanitizeWorkbenchAdapterAuthBundle,
  workbenchAdapterAuthTargetIdentity,
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
} from "./execution-jobs.ts";
import {
  applyWorkbenchSkillPatch,
  isWorkbenchControlPath,
} from "./skill-patch.ts";
import {
  buildWorkbenchTraceSessionsFromFiles,
  combineWorkbenchTraceSessions,
  readWorkbenchExecutionTrace,
  traceSummaryKey,
} from "./execution-traces.ts";
import { planWorkbenchOperationGraph } from "./operation-graph.ts";
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
  copyWorkbenchOperationPlanSummary as copyOperationPlanSummary,
  copyWorkbenchOperationTarget,
  createWorkbenchOperationPlanSummary as operationPlanSummaryForRun,
  normalizeWorkbenchOperationRequest,
  normalizeWorkbenchOperationSteps as uniqueOperationSteps,
  workbenchOperationTargetAgentSelector as operationTargetAgentSelector,
  workbenchOperationTargetFromPlan as operationTargetFromPlan,
  workbenchOperationTargetSkillSelector as operationTargetSkillSelector,
  workbenchOperationTargetsFromPlan as operationTargetsFromPlan,
  workbenchOperationTargetVersionId as operationTargetVersionId,
  uniqueStrings,
} from "./operation-request.ts";
import {
  parseWorkbenchRemoteUrl,
} from "./remote-model.ts";
import {
  canonicalize,
  hashFiles,
  hashJson,
} from "./content-hash.ts";

export {
  WorkbenchCodedError,
  WorkbenchUserError,
  codedErrorFromUnknown,
} from "./coded-errors.ts";
export {
  hashFiles,
  hashJson,
} from "./content-hash.ts";
export {
  applyWorkbenchEvalPatch,
  WorkbenchEvalPatchConflictError,
} from "./eval-patch.ts";
export type {
  WorkbenchExecutionRuntimeInput,
} from "./execution-runtime-types.ts";
export {
  attachSandboxMetadataToJob,
  createSandboxAdapterRequest,
  createWorkbenchSandboxFileStore,
  executionResultFromCompletedSandboxJob,
  isSurfaceSnapshotFile,
  readWorkbenchExecutionSpec,
  readWorkbenchPlannedExecutionJobInput,
} from "./sandbox-inputs.ts";
export {
  createSandboxBackendDescriptor,
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
  createSandboxBackendRegistry,
  createDockerSandboxBackendDescriptor,
  createDockerSandboxPlane,
  DOCKER_SANDBOX_BACKEND,
  resolveSandboxTemplateImage,
  type SandboxBackendAdmission,
  type SandboxBackendHostCost,
  type SandboxBackendRequestedResources,
  type SandboxBackendRegistration,
  type SandboxHostHealthExpectation,
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
  workbenchExecutionJobPurpose,
  workbenchExecutionJobId,
} from "./execution-jobs.ts";
export {
  applyWorkbenchSkillPatch,
} from "./skill-patch.ts";
export {
  asRuntimeRecord,
  dedupeSurfaceFiles,
  fileErrorCode,
  importNodeModule,
  jsonRecord,
  nodeBuiltin,
  normalizeRelativePath,
  normalizeRuntimeRegistry,
  normalizeWorkbenchWorkerId,
  publicGradeMetrics,
  quoteShellArg,
  readSurfaceFiles,
  resolveDockerRuntimeImageRef,
  resolveWorkbenchWorkerId,
  sleep,
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
  copyWorkbenchOperationPlanSummary,
  copyWorkbenchOperationTarget,
  createWorkbenchOperationPlanSummary,
  normalizeWorkbenchOperationRequest,
  parseWorkbenchOperationRequest,
  normalizeWorkbenchOperationSteps,
  workbenchOperationTargetAgentSelector,
  workbenchOperationTargetFromPlan,
  workbenchOperationTargetSkillSelector,
  workbenchOperationTargetsFromPlan,
  workbenchOperationTargetVersionId,
} from "./operation-request.ts";
export {
  readOutputTraceFiles,
} from "./trace-files.ts";
export {
  createWorkbenchExecutionEventPublisher,
  createWorkbenchProgressStdoutParser,
  publishCommandStepEvent,
  publishWorkbenchProgressStdoutEnvelope,
  readOptionalWorkbenchExecutionProgressTarget,
  type WorkbenchExecutionEventPublisher,
  type WorkbenchExecutionProgressTarget,
} from "./execution-events.ts";
export {
  readWorkbenchSandboxAdapterJobResponse,
} from "./sandbox-response.ts";
export {
  adapterAuthEnv,
  createWorkbenchAdapterAuthBundle,
  defaultWorkbenchAdapterAuthStoreRoot,
  localWorkbenchAdapterAuthStore,
  normalizeWorkbenchAdapterAuthTarget,
  parseWorkbenchAdapterAuthTarget,
  sanitizeWorkbenchAdapterAuthBundle,
  workbenchAdapterAuthTargetIdentity,
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
} from "./execution-traces.ts";
export {
  planWorkbenchOperationGraph,
  type WorkbenchOperationGraph,
  type WorkbenchOperationGraphCase,
  type WorkbenchOperationGraphNode,
  type WorkbenchOperationGraphSampleSelection,
} from "./operation-graph.ts";
export {
  listWorkbenchTraceRecords,
  writeWorkbenchTraceRecord,
  type WorkbenchTraceRuntimeOptions,
} from "./trace-runtime.ts";
export interface WorkbenchDraftEvalCaseFile {
  path: string;
  content: string;
  executable?: boolean;
}

const DRAFT_CASE_PROMPT_PLACEHOLDER = "Replace this with a representative workflow prompt.";
const DRAFT_CASE_GRADE_CRITERION_PLACEHOLDER = "Replace this with observable acceptance criteria.";
const DRAFT_CASE_TEST_PLACEHOLDER_FRAGMENT = "is intentionally failing. Replace";
const DRAFT_CASE_COMMAND_GRADER_PLACEHOLDER_FRAGMENT =
  "Draft command grader is intentionally failing. Replace grade.with.command";
const DRAFT_CASE_COMMAND_GRADER_PLACEHOLDER =
  "printf '%s\\n' '{\"ok\":false,\"score\":0,\"metrics\":{\"score\":0},\"summary\":\"Draft command grader is intentionally failing. Replace grade.with.command with real assertions.\"}' > \"$OUTPUT_DIR/result.json\" && exit 1";
export interface WorkbenchEvaluationCaseSourceInput {
  caseId: string;
  prompt: string;
  defaultGrade: WorkbenchGradePlan;
  grade?: WorkbenchCaseGradeMutation;
  metadata?: Json;
}

export function workbenchEvaluationCaseSourceFiles(
  input: WorkbenchEvaluationCaseSourceInput,
): WorkbenchDraftEvalCaseFile[] {
  const selectedGrade = selectedCaseAuthoringGradePlan(input.defaultGrade, input.grade);
  const inheritsDefault = !input.grade?.adapter;
  const gradeAuthoringControls = caseAuthoringControlsForMutation(selectedGrade, inheritsDefault);
  const authoringInput = input.grade?.authoring ?? {};
  const authoring = workbenchGradePlanAuthoringValues(gradeAuthoringControls, authoringInput);
  const authoringIssue = workbenchGradePlanAuthoringIssues(gradeAuthoringControls, authoringInput)[0];
  if (authoringIssue) {
    throw new WorkbenchUserError(authoringIssue.message);
  }
  const caseDir = `.workbench/cases/${input.caseId}`;
  const caseRecord: Record<string, Json> = {
    prompt: input.prompt,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  };
  const gradeWith = gradeConfigFromAuthoring(selectedGrade, authoring);
  const writesAdapter = selectedGrade.adapter !== input.defaultGrade.adapter;
  if (writesAdapter || Object.keys(gradeWith).length > 0) {
    caseRecord.grade = {
      ...(writesAdapter ? { adapter: selectedGrade.adapter } : {}),
      ...(Object.keys(gradeWith).length > 0 ? { with: gradeWith } : {}),
    };
  }
  return [
    { path: `${caseDir}/case.yaml`, content: YAML.stringify(caseRecord) },
    ...caseFilesFromAuthoring(input.caseId, selectedGrade, authoring),
  ];
}

export function workbenchEvaluationGradeSourceFiles(
  input: WorkbenchGradeMutationRequest,
): SurfaceSnapshotFile[] {
  const adapter = input.adapter.trim().toLowerCase();
  if (!adapter) {
    throw new WorkbenchUserError(`${EVAL_FILE} grade.adapter must be none, rubric, tests, or command.`);
  }
  assertSupportedSkillEvalGradeAdapter(adapter);
  const grade = gradePlanForAdapter({ adapter, adapterSource: "eval" });
  const authoringControls = evalGradePlanAuthoringControls(adapter, {});
  const authoringInput = input.authoring ?? {};
  const hasAuthoringInput = Object.keys(authoringInput).length > 0;
  const authoringIssue = hasAuthoringInput
    ? workbenchGradePlanAuthoringIssues(authoringControls, authoringInput, { pathLabel: "Eval grade.authoring" })[0]
    : undefined;
  if (authoringIssue) {
    throw new WorkbenchUserError(authoringIssue.message);
  }
  const gradeWith = hasAuthoringInput
    ? gradeConfigFromAuthoring(grade, workbenchGradePlanAuthoringValues(authoringControls, authoringInput))
    : {};
  const evalRecord: Record<string, Json> = {
    grade: {
      adapter,
      ...(Object.keys(gradeWith).length > 0 ? { with: gradeWith } : {}),
    },
  };
  return [{
    path: `.workbench/${EVAL_FILE}`,
    kind: "text",
    encoding: "utf8",
    content: YAML.stringify(evalRecord),
  }];
}

export async function writeWorkbenchEvaluationGradeSourceFiles(
  options: WorkbenchCommandOptions & { mutation: WorkbenchGradeMutationRequest },
): Promise<SurfaceSnapshotFile[]> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  const files = workbenchEvaluationGradeSourceFiles(options.mutation);
  await writeSurfaceFiles(root, files);
  return files;
}

export function workbenchDraftEvalCaseFiles(
  caseId = "case-001",
  options: { defaultGrade: WorkbenchGradePlan; grade?: WorkbenchCaseGradeMutation },
): WorkbenchDraftEvalCaseFile[] {
  const selectedGrade = selectedCaseAuthoringGradePlan(options.defaultGrade, options.grade);
  return workbenchEvaluationCaseSourceFiles({
    caseId,
    prompt: DRAFT_CASE_PROMPT_PLACEHOLDER,
    defaultGrade: options.defaultGrade,
    grade: {
      adapter: selectedGrade.adapter,
      authoring: defaultCaseAuthoringForGradePlan(caseId, selectedGrade),
    },
  }).map((file) => file.path.endsWith("/case.yaml")
    ? { ...file, content: draftCaseYamlComments(selectedGrade) + file.content }
    : file);
}

function selectedCaseAuthoringGradePlan(
  defaultGrade: WorkbenchGradePlan,
  grade: WorkbenchCaseGradeMutation | undefined,
): WorkbenchGradePlan {
  const adapter = grade?.adapter?.trim().toLowerCase();
  if (!adapter) {
    return defaultGrade;
  }
  assertSupportedSkillEvalGradeAdapter(adapter);
  return gradePlanForAdapter({ adapter, adapterSource: "case" });
}

function caseAuthoringControlsForMutation(
  grade: WorkbenchGradePlan,
  inheritsDefault: boolean,
): WorkbenchGradePlanAuthoringControl[] {
  return inheritsDefault
    ? grade.authoring.filter((control) => control.kind === "file")
    : grade.authoring;
}

export function defaultWorkbenchCaseTestScript(caseId?: string): string {
  const subject = caseId ? `case ${caseId}` : "this case";
  const testPath = caseId ? `.workbench/cases/${caseId}/tests/test.sh` : "this test script";
  const placeholderSummary =
    `Draft ${subject} is intentionally failing. Replace ${testPath} with assertions and write JSON to $OUTPUT_DIR/result.json.`;
  return [
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
  ].join("\n") + "\n";
}

function defaultCaseAuthoringForGradePlan(
  caseId: string,
  grade: WorkbenchGradePlan,
): Record<string, Json> {
  if (grade.adapter === "rubric") {
    return { criteria: [{ description: DRAFT_CASE_GRADE_CRITERION_PLACEHOLDER }] };
  }
  if (grade.adapter === "tests") {
    return { testScript: defaultWorkbenchCaseTestScript(caseId) };
  }
  if (grade.adapter === "command") {
    return { command: DRAFT_CASE_COMMAND_GRADER_PLACEHOLDER };
  }
  return {};
}

function draftCaseYamlComments(grade: WorkbenchGradePlan): string {
  return [
    "# Replace prompt with a realistic user request for this workflow.",
    ...(grade.adapter === "rubric"
      ? ["# Add one criterion per observable behavior that makes the result good."]
      : []),
    "",
  ].join("\n");
}

function gradeConfigFromAuthoring(
  grade: WorkbenchGradePlan,
  authoring: Record<string, Json>,
): Record<string, Json> {
  if (grade.adapter !== "rubric") {
    if (grade.adapter === "command") {
      const command = typeof authoring.command === "string" ? authoring.command.trim() : "";
      return command ? { command } : {};
    }
    return {};
  }
  const criteria = rubricCriteriaFromAuthoring(authoring.criteria);
  return criteria.length > 0 ? { criteria } : {};
}

function caseFilesFromAuthoring(
  caseId: string,
  grade: WorkbenchGradePlan,
  authoring: Record<string, Json>,
): WorkbenchDraftEvalCaseFile[] {
  if (grade.adapter !== "tests") {
    return [];
  }
  const content = typeof authoring.testScript === "string" && authoring.testScript.trim()
    ? authoring.testScript
    : defaultWorkbenchCaseTestScript(caseId);
  return [{
    path: `.workbench/cases/${caseId}/tests/test.sh`,
    content: content.endsWith("\n") ? content : `${content}\n`,
    executable: true,
  }];
}

function rubricCriteriaFromAuthoring(value: Json | undefined): Json[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const used = new Set<string>();
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const description = typeof entry.description === "string" ? entry.description.trim() : "";
    if (!description) {
      return [];
    }
    const candidateId = typeof entry.id === "string" ? entry.id.trim() : "";
    const id = uniqueRubricCriterionId(candidateId || description, index, used);
    const criterion: Record<string, Json> = { id, description };
    if (typeof entry.weight === "number" && Number.isFinite(entry.weight)) {
      criterion.weight = entry.weight;
    }
    return [criterion];
  });
}

function uniqueRubricCriterionId(seed: string, index: number, used: Set<string>): string {
  const normalized = normalizeWorkbenchSkillName(seed).slice(0, 48) || `criterion-${index + 1}`;
  let id = normalized;
  for (let suffix = 2; used.has(id); suffix += 1) {
    id = `${normalized}-${suffix}`;
  }
  used.add(id);
  return id;
}

export function workbenchAuthorEvalCaseCommand(caseId = "case-001"): string {
  return `workbench eval case draft ${quoteShellArg(caseId)}`;
}

export const WORKBENCH_AUTHOR_EVAL_CASE_COMMAND = workbenchAuthorEvalCaseCommand();

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

export interface WorkbenchSwitchOptions extends WorkbenchCommandOptions {
  dryRun?: boolean;
  overwrite?: boolean;
}

export interface WorkbenchSwitchFileChanges {
  added: string[];
  changed: string[];
  removed: string[];
}

export interface WorkbenchSwitchResult {
  version: WorkbenchVersion;
  dryRun: boolean;
  changes: WorkbenchSwitchFileChanges;
  requiresOverwrite: boolean;
  unchanged: boolean;
}

export interface WorkbenchInitOptions extends WorkbenchCommandOptions {
  agent?: string;
  model?: string;
  auth?: string;
}

type WorkbenchSelectorCommand = "run" | "grade" | "eval" | "results" | "improve";
const WORKBENCH_SELECTOR_INVOCATIONS: Record<WorkbenchSelectorCommand, string> = {
  run: "workbench eval run", grade: "workbench eval grade", eval: "workbench eval run",
  results: "workbench eval results", improve: "workbench skill improve",
};
type WorkbenchSchedulableRunKind = WorkbenchCaseRunKind | "improve";

export interface WorkbenchEvalOptions extends WorkbenchCommandOptions {
  version?: string;
  evalHash?: string;
  skill?: string;
  agent?: string;
  samples?: number;
  kind?: WorkbenchCaseRunKind;
  parentRunId?: string;
  caseIds?: readonly string[];
  operationTargets?: readonly WorkbenchOperationTarget[];
  operationSteps?: readonly WorkbenchOperationStep[];
  gradeOfRunId?: string;
  selectedSamples?: readonly WorkbenchCaseSampleSelection[];
  rerun?: boolean;
  location?: WorkbenchRun["location"];
  remoteName?: string;
  retryOfRunId?: string;
  onRunStarted?: (run: WorkbenchRun) => void | Promise<void>;
}

function isWorkbenchCaseRunKind(kind: unknown): kind is WorkbenchCaseRunKind {
  return kind === "run" || kind === "grade" || kind === "eval";
}

function normalizeWorkbenchCaseRunKind(kind: unknown, fallback: WorkbenchCaseRunKind): WorkbenchCaseRunKind {
  if (kind === undefined) {
    return fallback;
  }
  if (isWorkbenchCaseRunKind(kind)) {
    return kind;
  }
  throw new WorkbenchCodedError("unsupported_run_kind", `Workbench case runs support kind run, grade, or eval; received ${String(kind)}.`, {
    remediation: "workbench eval run",
    subject: { kind: String(kind) },
    exitCode: 2,
  });
}

export type WorkbenchPreparedCloudEvalRequest = Extract<WorkbenchOperationRequest, { kind: "eval" }>;

export type WorkbenchPreparedCloudImproveRequest = Extract<WorkbenchOperationRequest, { kind: "improve" }>;

export interface WorkbenchEvalPreview {
  dryRun: true;
  location: "local" | "cloud";
  versionId: string;
  sourceState?: "clean" | "edited" | "no_snapshot";
  evalHash: string;
  skills: Array<{ name: string; hash: string }>;
  agents: Array<{ name: string; hash: string }>;
  cases: number;
  samples: number;
  cachedRunIds: string[];
  cachedJobIds: string[];
  environment?: {
    path: string;
    dockerfile: string;
  };
  adapterAuthTargets: WorkbenchAdapterAuthTarget[];
  readiness: WorkbenchLaunchReadiness;
}

export interface WorkbenchImprovePreview {
  dryRun: true;
  location: "local" | "cloud";
  versionId: string;
  sourceState?: "clean" | "edited" | "no_snapshot";
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
  subject?: Record<string, Json>;
}

export function assertWorkbenchLaunchReadinessReady(readiness: WorkbenchLaunchReadiness): void {
  const issue = readiness.issues[0];
  if (!issue) {
    return;
  }
  throw new WorkbenchCodedError(issue.code, issue.message, {
    ...(issue.remediation ? { remediation: issue.remediation } : {}),
    ...(issue.subject ? { subject: issue.subject } : {}),
    exitCode: issue.code === "remote_invalid_url" ? 2 : 1,
  });
}

export interface WorkbenchCaseSampleSelection {
  caseId: string;
  sample: number;
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
): Promise<WorkbenchExecutionJob> {
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
    return failWorkbenchExecutionJob(args.job, startedAt, error);
  }
}

async function executeWorkbenchExecutionJobWithResolvedAuth(
  args: WorkbenchExecutionRuntimeInput,
  options: WorkbenchExecutionJobOptions,
  startedAt: string,
): Promise<WorkbenchExecutionJob> {
  try {
    if (options.signal?.aborted) {
      return cancelWorkbenchExecutionJob(args.job, startedAt);
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
      return cancelWorkbenchExecutionJob(args.job, startedAt);
    }
    return completedRemoteJobFromSandboxResult(args.job, startedAt, validated.result);
  } catch (error) {
    if (options.signal?.aborted) {
      return cancelWorkbenchExecutionJob(args.job, startedAt);
    }
    return failWorkbenchExecutionJob(args.job, startedAt, error);
  }
}

export function requiredWorkbenchAdapterAuthTargetsForRuntimeInput(
  args: Pick<WorkbenchExecutionRuntimeInput, "job" | "adapterManifests" | "runtimeControlOperation" | "spec">,
): WorkbenchAdapterAuthTarget[] {
  return requiredAdapterAuthTargetsForExecution(readWorkbenchExecutionSpec(args.job), args);
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
): Promise<WorkbenchExecutionJob> {
  if (signal?.aborted) {
    return cancelWorkbenchExecutionJob(args.job, startedAt);
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
    return failWorkbenchExecutionJob(
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
): Promise<WorkbenchExecutionJob> {
  return executeRuntimeControlOperationInTemporaryWorkspace({
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
    workspacePrefix: "workbench-host-adapter-",
    failureMessage: "Host adapter operation failed.",
    signal,
    output: (result) => ({
        ...runtimeControlJobOutput(result),
        executionId: execution.id,
        purpose: execution.purpose,
      }),
  });
}

const RUNTIME_CONTROL_MAX_BODY_BYTES = 512 * 1024 * 1024;
const RUNTIME_CONTROL_SERVER_CLOSE_GRACE_MS = 1_000;
const RUNTIME_CONTROL_STEP_GRACE_MS = 5_000;
const WORKBENCH_BUILT_IN_ADAPTERS_IMPORT_ENV = "WORKBENCH_BUILT_IN_ADAPTERS_IMPORT";

async function withWorkbenchRuntimeControlServer(
  args: WorkbenchExecutionRuntimeInput,
  options: WorkbenchExecutionJobOptions,
  startedAt: string,
  run: (env: Record<string, string>) => Promise<WorkbenchExecutionJob>,
): Promise<WorkbenchExecutionJob> {
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
    writeRuntimeControlJson(response, 200, toJson(result));
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
    : isWorkbenchJson(invocationRecord.with)
      ? invocationRecord.with
      : null;
  if (withConfig === null) {
    throw new Error(`Workbench runtime-control ${label}.invocation.with must be JSON.`);
  }
  if (invocationRecord.auth !== undefined && !isWorkbenchJson(invocationRecord.auth)) {
    throw new Error(`Workbench runtime-control ${label}.invocation.auth must be JSON.`);
  }
  return {
    operation,
    invocation: {
      use: invocationRecord.use,
      with: withConfig,
      ...(invocationRecord.auth !== undefined ? { auth: toJson(invocationRecord.auth) } : {}),
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
    workbenchAdapterAuthTargetIdentity(bundle),
    bundle,
  ]));
  const missing = required.filter((target) => !providedByTarget.has(workbenchAdapterAuthTargetIdentity(target)));
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
  return required.map((target) => providedByTarget.get(workbenchAdapterAuthTargetIdentity(target))!);
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

export function adapterAuthRemediationFromError(error: string | undefined): string | null {
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
  return `workbench login ${adapterId.trim().toLowerCase()}`;
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
    entries.self = toJson(self);
  }
  if (Object.keys(adapters).length > 0) {
    entries.adapters = toJson(adapters);
  }
  return toJson(entries);
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
  return toJson({
    method: bundle.method,
    profile: bundle.profile,
    ...(bundle.env && bundle.env.length > 0
      ? { env: Object.fromEntries(bundle.env.map((entry) => [entry.name, "materialized"])) }
      : {}),
    ...(fileAuth ? fileAuth : {}),
  });
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
): Promise<WorkbenchExecutionJob> {
  if (!args.runtimeControlOperation) {
    return failWorkbenchExecutionJob(
      args.job,
      startedAt,
      new Error("Runtime-control operation sequence is missing from the sandbox request."),
    );
  }
  return executeRuntimeControlOperationInTemporaryWorkspace({
    args,
    execution,
    startedAt,
    workspacePrefix: "workbench-runtime-control-",
    failureMessage: "Runtime-control operation sequence failed.",
    output: runtimeControlJobOutput,
  });
}

async function executeRuntimeControlOperationInTemporaryWorkspace(input: {
  args: WorkbenchExecutionRuntimeInput;
  execution: WorkbenchExecutionSpec;
  startedAt: string;
  workspacePrefix: string;
  failureMessage: string;
  signal?: AbortSignal;
  output: (result: WorkbenchRuntimeControlOperationSequenceResult) => Json;
}): Promise<WorkbenchExecutionJob> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), input.workspacePrefix));
  try {
    const result = await runRuntimeControlOperationSequence({
      args: input.args,
      execution: input.execution,
      startedAt: input.startedAt,
      workspace,
      signal: input.signal,
    });
    const finishedAt = now();
    return {
      ...input.args.job,
      status: result.ok ? "succeeded" : "failed",
      attempt: Math.max(1, input.args.job.attempt),
      startedAt: input.startedAt,
      finishedAt,
      updatedAt: finishedAt,
      ...(result.ok ? {} : { error: result.error ?? input.failureMessage }),
      output: toJson(input.output(result)),
    };
  } catch (error) {
    return failWorkbenchExecutionJob(input.args.job, input.startedAt, error);
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
  const parentInput = readWorkbenchPlannedExecutionJobInput(args.job);
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
  const childJob: WorkbenchExecutionJob = {
    ...args.job,
    id: childJobId,
    status: "queued",
    attempt: 0,
    createdAt: startedAt,
    updatedAt: startedAt,
    input: {
      ...parentInput,
      execution: childExecution,
      caseId,
    },
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
  job: WorkbenchExecutionJob,
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
    ...(output.feedback !== undefined && isWorkbenchJson(output.feedback) ? { feedback: output.feedback } : {}),
    ...(typeof output.error === "string" ? { error: output.error } : fallbackError ? { error: fallbackError } : {}),
  };
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
    const stepAdapterId = operation.invocation.use;
    const stepTimeoutMs = runtimeControlStepTimeoutMs(args.execution);
    const stepEnv = runtimeControlAdapterEnv({
      requestPath,
      outputDir: runtimeControlOutputDir(args.workspace),
      adapterEnv: adapterAuthEnvForStep(runtimeArgs),
      runtimeEnv: runtimeArgs.adapterRuntimeEnv,
      timeoutMs: stepTimeoutMs,
    });
    const result = runtimeControlUsesBuiltInDirectDispatch(operation)
      ? await runRuntimeControlBuiltInAdapterOperation(stepAdapterId, {
          cwd: args.workspace,
          requestPath,
          outputDir: runtimeControlOutputDir(args.workspace),
          progressTarget: runtimeArgs.progress,
          signal: args.signal,
          env: stepEnv,
          adapterAuthRoot: runtimeArgs.adapterAuthRoot,
          adapterAuthRequest: adapterAuthRequestForOperation(runtimeArgs, operation),
          adapterAuthEnv: adapterAuthEnvForStep(runtimeArgs),
        })
      : await runRuntimeControlShellCommand(runtimeControlOperationCommand(operation, runtimeArgs.adapterManifests), {
          cwd: args.workspace,
          timeout: stepTimeoutMs + RUNTIME_CONTROL_STEP_GRACE_MS,
          progressTarget: runtimeArgs.progress,
          signal: args.signal,
          env: stepEnv,
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

function runtimeControlUsesBuiltInDirectDispatch(operation: WorkbenchRuntimeControlOperation): boolean {
  if (operation.invocation.command?.trim()) {
    return false;
  }
  return isWorkbenchBuiltInAdapterId(operation.invocation.use);
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

async function runRuntimeControlBuiltInAdapterOperation(
  adapterId: string,
  options: {
    cwd: string;
    requestPath: string;
    outputDir: string;
    env: NodeJS.ProcessEnv;
    progressTarget?: WorkbenchExecutionProgressTarget;
    signal?: AbortSignal;
    adapterAuthRoot?: string;
    adapterAuthRequest?: Json;
    adapterAuthEnv?: Record<string, string>;
  },
): Promise<{
  stdout: string;
  stderr: string;
  status: number | null;
  error?: Error;
}> {
  if (options.signal?.aborted) {
    return {
      stdout: "",
      stderr: "",
      status: null,
      error: new Error("Run cancellation requested."),
    };
  }
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const progressPublishes: Promise<void>[] = [];
  const progressParser = options.progressTarget
    ? createWorkbenchProgressStdoutParser((envelope) => {
        progressPublishes.push(
          publishWorkbenchProgressStdoutEnvelope(envelope, options.progressTarget)
            .catch(() => undefined),
        );
      })
    : null;
  const collectStdout = (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    progressParser?.write(buffer);
    stdoutChunks.push(buffer);
  };
  const collectStderr = (chunk: Buffer | string) => {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  };
  const restoreStdout = captureProcessWrite(process.stdout, collectStdout, shouldForwardCapturedStdout);
  const restoreStderr = captureProcessWrite(process.stderr, collectStderr);
  const restoreEnv = applyTemporaryProcessEnv(options.env);
  const previousCwd = process.cwd();
  let status: number | null = 0;
  let error: Error | undefined;
  try {
    process.chdir(options.cwd);
    const module = await import(runtimeControlBuiltInAdaptersImportSpecifier());
    const execute = (module as {
      executeWorkbenchBuiltInAdapterCommand?: (args: {
        adapterId?: string;
        requestPath?: string;
        outputRoot?: string;
        adapterAuthRoot?: string;
        adapterAuthRequest?: Json;
        adapterAuthEnv?: Record<string, string>;
      }) => Promise<void>;
    }).executeWorkbenchBuiltInAdapterCommand;
    if (typeof execute !== "function") {
      throw new Error("Built-in Workbench adapter module does not export executeWorkbenchBuiltInAdapterCommand.");
    }
    await execute({
      adapterId,
      requestPath: options.requestPath,
      outputRoot: options.outputDir,
      adapterAuthRoot: options.adapterAuthRoot,
      adapterAuthRequest: options.adapterAuthRequest,
      adapterAuthEnv: options.adapterAuthEnv,
    });
  } catch (caught) {
    status = 1;
    error = caught instanceof Error ? caught : new Error(String(caught));
  } finally {
    process.chdir(previousCwd);
    restoreEnv();
    restoreStderr();
    restoreStdout();
    progressParser?.flush();
  }
  await Promise.allSettled(progressPublishes);
  return {
    stdout: sanitizeRuntimeControlStdout(Buffer.concat(stdoutChunks).toString("utf8")),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
    status,
    ...(error ? { error } : {}),
  };
}

function runtimeControlBuiltInAdaptersImportSpecifier(): string {
  const configured = process.env[WORKBENCH_BUILT_IN_ADAPTERS_IMPORT_ENV]?.trim();
  return configured || "@workbench-ai/workbench-built-in-adapters";
}

function captureProcessWrite(
  stream: NodeJS.WriteStream,
  collect: (chunk: Buffer | string) => void,
  shouldForward?: (chunk: Buffer | string) => boolean,
): () => void {
  const original = stream.write.bind(stream) as (...args: unknown[]) => boolean;
  (stream as unknown as { write: (...args: unknown[]) => boolean }).write = (...args: unknown[]): boolean => {
    const chunk = args[0];
    if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
      collect(chunk);
      if (shouldForward?.(chunk) === true) {
        return original(...args);
      }
    }
    const callback = args.find((arg): arg is (error?: Error | null) => void => typeof arg === "function");
    callback?.();
    return true;
  };
  return () => {
    (stream as unknown as { write: typeof original }).write = original;
  };
}

function shouldForwardCapturedStdout(chunk: Buffer | string): boolean {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
  return text.includes(WORKBENCH_PROGRESS_STDOUT_PREFIX);
}

function applyTemporaryProcessEnv(env: NodeJS.ProcessEnv): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
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
  const agentTraceFiles = await readFilesUnder(
    path.join(outputRoot, ".workbench", "agent-traces"),
    ".workbench/agent-traces",
  );
  return [...outputFiles, ...traceFiles, ...agentTraceFiles]
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
    files: toJson(result.files),
    fileChanges: toJson(result.fileChanges),
    operationResults: toJson(result.operationResults),
    ...(isWorkbenchJson(skillPatch) ? { skillPatch } : {}),
    ...(result.workspaceFiles ? { workspaceFiles: toJson(result.workspaceFiles) } : {}),
    ...(result.result ? { result: toJson(result.result) } : {}),
    ...(result.usage ? { usage: toJson(result.usage) } : {}),
    ...(result.summary !== undefined ? { summary: result.summary } : {}),
    ...(result.feedback !== undefined ? { feedback: result.feedback } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}

function sanitizeRuntimeControlTracePayload(value: unknown): Json {
  if (Array.isArray(value)) {
    return toJson(value.map((entry) => sanitizeRuntimeControlTracePayload(entry)));
  }
  if (!value || typeof value !== "object") {
    return toJson(value ?? null);
  }
  const sanitized: Record<string, Json> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "auth" || key === "enginePrivate") {
      continue;
    }
    sanitized[key] = sanitizeRuntimeControlTracePayload(entry);
  }
  return toJson(sanitized);
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
): Promise<WorkbenchExecutionJob> {
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
    return cancelWorkbenchExecutionJob(args.job, startedAt);
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
  job: WorkbenchExecutionJob,
  startedAt: string,
  execution: WorkbenchExecutionSpec,
  result: WorkbenchRuntimeControlOperationSequenceResult,
): WorkbenchExecutionJob {
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
    output: toJson({
      ...output,
      ok: succeeded,
      executionId: execution.id,
      purpose: execution.purpose,
    }),
  };
}

async function executeSkillEvalExecutionInCurrentRuntime(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
  startedAt: string,
  signal?: AbortSignal,
): Promise<WorkbenchExecutionJob> {
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
    output: toJson({
      ok: succeeded,
      executionId: execution.id,
      purpose: execution.purpose,
      result: resultPayload,
      files,
      metrics: resultPayload.metrics,
      cases: resultPayload.cases,
      summary: adapterResult?.summary ?? resultPayload.summary,
    }),
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
  const passed = rawPassed;
  const metrics = publicGradeMetrics(record, score);
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
    ...(passed === false ? { error: message ?? "Test failed." } : {}),
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
  fallbackJob: WorkbenchExecutionJob,
  startedAt: string,
  result: WorkbenchExecutionResult,
): WorkbenchExecutionJob {
  const completedJob = asRuntimeRecord(result.metadata).completedJob;
  if (
    completedJob &&
    typeof completedJob === "object" &&
    !Array.isArray(completedJob)
  ) {
    return completedJob as WorkbenchExecutionJob;
  }
  if (result.status === "succeeded") {
    return failWorkbenchExecutionJob(
      fallbackJob,
      result.startedAt || startedAt,
      `Sandbox execution ${result.executionId} succeeded without returning a completed job.`,
      result.finishedAt,
    );
  }
  return attachSandboxMetadataToJob(
    failWorkbenchExecutionJob(
      fallbackJob,
      result.startedAt || startedAt,
      result.error ?? `Sandbox execution ${result.status}.`,
      result.finishedAt,
    ),
    asRuntimeRecord(result.metadata).sandbox,
  );
}

function failWorkbenchExecutionJob(
  job: WorkbenchExecutionJob,
  startedAt: string,
  error: unknown,
  finishedAt = new Date().toISOString(),
): WorkbenchExecutionJob {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...job,
    status: "failed",
    attempt: Math.max(1, job.attempt),
    startedAt,
    finishedAt,
    updatedAt: finishedAt,
    error: message,
    output: toJson({
      ok: false,
      error: message,
    }),
  };
}

function cancelWorkbenchExecutionJob(
  job: WorkbenchExecutionJob,
  startedAt: string,
  finishedAt = new Date().toISOString(),
): WorkbenchExecutionJob {
  return {
    ...job,
    status: "canceled",
    attempt: Math.max(1, job.attempt),
    startedAt,
    finishedAt,
    updatedAt: finishedAt,
    error: "Run cancellation requested.",
    output: toJson({
      ok: false,
      canceled: true,
      error: "Run cancellation requested.",
    }),
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

export interface WorkbenchPendingCloudOperation {
  schema: "workbench.pending-cloud-operation.v1";
  id: string;
  command: "run" | "grade" | "eval" | "improve" | "retry";
  remoteName: string;
  createdAt: string;
  retryOfRunId?: string;
}

export interface WorkbenchPendingCloudOperationCancellation {
  operation: WorkbenchPendingCloudOperation;
  requestedAt: string;
  requestPath: string;
}

export interface WorkbenchResultsOptions extends WorkbenchCommandOptions {
  projectVersions?: string;
  resultVersions?: string;
  versions?: string;
  agents?: string;
  eval?: string;
}

interface InternalComparisonCell {
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
  runId?: string;
  jobIds?: string[];
  status?: WorkbenchRun["status"];
  score?: number;
  coverage?: WorkbenchSampleCoverage;
  report?: WorkbenchJobReport;
  error?: string;
}

interface InternalComparison {
  evalHashes?: string[];
  versions: WorkbenchVersion[];
  skills: WorkbenchSkillBundleSnapshot[];
  agents: WorkbenchAgentSnapshot[];
  cells: InternalComparisonCell[];
}

interface InternalComparisonSelection {
  versions?: string;
  skills?: string;
  agents?: string;
  evalHashes?: readonly string[];
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
  visibility?: WorkbenchSkillVisibility;
  authToken?: string;
  dryRun?: boolean;
}

export interface WorkbenchPublishResult {
  remote: WorkbenchRemote;
  version: WorkbenchVersion;
  visibility: WorkbenchSkillVisibility;
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
  visibility?: WorkbenchSkillVisibility;
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
  publication?: WorkbenchSyncPublication;
}

export type WorkbenchSyncPublication =
  | { status: "unpublished" }
  | {
      status: "published";
      visibility?: WorkbenchSkillVisibility;
      currentVersionId: string;
      publishedVersionIds: string[];
      installHandle?: string;
    };

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
  environmentDockerfile: string;
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
  environmentDockerfile: string;
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
const LIVE_DIR = "live";
const CANCEL_DIR = "cancel";
const TMP_DIR = "tmp";
const SYNC_DIR = "sync";
const LOGS_DIR = "logs";
const LOCKS_DIR = "locks";
const STATE_TREE_RM_OPTIONS = { recursive: true, force: true, maxRetries: 20, retryDelay: 100 } as const;
const PROJECT_LOCK_DIR = "project.lock";
const REMOTES_FILE = "remotes.yaml";
const WORKBENCH_GITIGNORE_FILE = ".gitignore";
const EVAL_FILE = "eval.yaml";
const CASES_DIR = "cases";
const CASE_DESCRIPTOR_FILE = "case.yaml";
const ENVIRONMENT_DIR = "environment";
const AGENTS_FILE = "agents.yaml";
const VERSIONS_FILE = "versions.yaml";
const SKILL_FILE = "SKILL.md";
const CURRENT_SKILL_VERSION_NAME = "current";
const ALL_SELECTOR = "all";
const CURRENT_EVAL_SELECTOR = "current";
const EVAL_VERSION_REF_PREFIX = "eval-v";
const STATE_SCHEMA = "workbench.skill.state.v1";
const PACK_SCHEMA = "workbench.object-pack.v1";
const DEFAULT_SKILL_RUNTIME_IMAGE = "workbench/workbench-node-22:envv_node_22";
const PROJECT_LOCK_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const PROJECT_LOCK_RETRY_MS = 50;
const STARTER_SKILL_ENVIRONMENT_DOCKERFILE = [
  `FROM ${DEFAULT_SKILL_RUNTIME_IMAGE}`,
  "",
  "RUN apt-get update \\",
  "    && apt-get install -y --no-install-recommends ca-certificates \\",
  "    && rm -rf /var/lib/apt/lists/*",
  "",
  "# Add eval/runtime dependencies here when cases need them.",
  "",
].join("\n");

const PACKAGE_SNAPSHOT_MESSAGE = "package snapshot";
const projectLockContext = new AsyncLocalStorage<ReadonlySet<string>>();
const projectLockQueues = new Map<string, Promise<void>>();
const stateSaveQueues = new Map<string, Promise<void>>();
const SKILL_EVAL_COMMAND_AGENT_ADAPTERS = new Set(["local", "command"]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const dockerAvailabilityExecFileAsync = promisify(execFile) as unknown as (
  file: string,
  args: string[],
  options?: Record<string, unknown>,
) => Promise<unknown>;

const STARTER_CREATED_PATHS = [
  "SKILL.md",
  ".workbench/eval.yaml",
  ".workbench/agents.yaml",
  ".workbench/environment/Dockerfile",
  ".workbench/.gitignore",
];

type WorkbenchProviderAgentAdapter = "codex" | "claude";
type WorkbenchNewAgentAdapter = WorkbenchProviderAgentAdapter | "command" | "local";
type WorkbenchManifestEntryNoun = "skill" | "version" | "agent";

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
        remediation: containsSkill ? `cd ${root} && workbench skill init` : "workbench skill new DIR",
        subject: { root },
        exitCode: 2,
      });
    }
  }
  const defaultAgentSelection = await selectNewDefaultAgent(options);
  await fs.mkdir(root, { recursive: true });
  await ensureFile(
    path.join(root, SKILL_FILE),
    starterSkillMarkdown(root),
  );
  return await initializeWorkbenchProjectControls(root, defaultAgentSelection, [...STARTER_CREATED_PATHS]);
}

function starterSkillMarkdown(root: string): string {
  const skillName = safeName(path.basename(root) || "skill");
  const title = titleFromSkillName(skillName);
  return [
    "---",
    `name: ${skillName}`,
    'description: "TODO: describe the user request that should trigger this skill."',
    "---",
    "",
    `# ${title}`,
    "",
    "Use this skill when the user asks to TODO: describe the workflow this skill owns.",
    "",
    "## Inputs",
    "",
    "- TODO: list required inputs, files, context, or credentials.",
    "",
    "## Workflow",
    "",
    "1. TODO: inspect the request and gather required context.",
    "2. TODO: run the core steps, scripts, or checks for this workflow.",
    "3. TODO: validate the output against the quality bar below.",
    "",
    "## Output",
    "",
    "- TODO: describe the artifact, answer, or code change the agent should produce.",
    "",
    "## Quality Bar",
    "",
    "- TODO: add observable checks that make a result good enough to ship.",
    "",
  ].join("\n");
}

function titleFromSkillName(name: string): string {
  const words = name
    .split(/[^A-Za-z0-9]+/u)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) {
    return "Skill";
  }
  return words.map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join(" ");
}

export async function initExistingWorkbenchSkillProject(options: WorkbenchInitOptions = {}): Promise<WorkbenchStatus> {
  const root = resolveRoot(options.dir);
  if (!await exists(path.join(root, SKILL_FILE))) {
    throw new WorkbenchCodedError("usage", `Workbench init requires ${SKILL_FILE} in the current directory.`, {
      remediation: "workbench skill new DIR",
      subject: { root, requiredFile: SKILL_FILE },
      exitCode: 2,
    });
  }
  if (await exists(workbenchDir(root))) {
    const required = [
      path.join(workbenchDir(root), EVAL_FILE),
      path.join(workbenchDir(root), AGENTS_FILE),
      path.join(workbenchDir(root), ENVIRONMENT_DIR, "Dockerfile"),
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
        remediation: "Inspect .workbench, repair the missing files, or move .workbench aside before rerunning workbench skill init.",
        subject: { root, missing },
        exitCode: 2,
      });
    }
    throw new WorkbenchCodedError("already_initialized", `Workbench project already exists: ${root}`, {
      remediation: "workbench skill show",
      subject: { root },
      exitCode: 2,
    });
  }
  const defaultAgentSelection = await selectNewDefaultAgent(options);
  return await initializeWorkbenchProjectControls(root, defaultAgentSelection, [
    ".workbench/eval.yaml",
    ".workbench/agents.yaml",
    ".workbench/environment/Dockerfile",
    ".workbench/.gitignore",
  ]);
}

export async function initializeHydratedWorkbenchSkillProject(options: WorkbenchInitOptions = {}): Promise<WorkbenchStatus> {
  const root = resolveRoot(options.dir);
  if (!await exists(path.join(root, SKILL_FILE))) {
    throw new WorkbenchCodedError("usage", `Workbench clone requires ${SKILL_FILE} in the hydrated source.`, {
      remediation: "workbench skill clone OWNER/SKILL[@VERSION] DIR",
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
        "grade:",
        "  adapter: none",
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
  const environmentDockerfilePath = path.join(workbenchRoot, ENVIRONMENT_DIR, "Dockerfile");
  if (!await exists(environmentDockerfilePath)) {
    await ensureFile(environmentDockerfilePath, STARTER_SKILL_ENVIRONMENT_DOCKERFILE);
    createdPaths.push(`.workbench/${ENVIRONMENT_DIR}/Dockerfile`);
  }
  return createdPaths;
}

async function selectNewDefaultAgent(options: WorkbenchInitOptions): Promise<WorkbenchDefaultAgentSelection> {
  const explicitAgent = options.agent?.trim();
  const explicitModel = options.model?.trim();
  const explicitAuth = options.auth?.trim();
  if (explicitAgent) {
    const adapter = normalizeNewAgentAdapter(explicitAgent);
    if (adapter === "local" || adapter === "command") {
      if (explicitModel || explicitAuth) {
        throw new WorkbenchCodedError("usage", "workbench skill new --model and --auth apply only to provider agents.", {
          remediation: `workbench skill new --agent ${adapter}`,
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

  return providerNewDefaultAgent("codex", "product_default", options);
}

function normalizeNewAgentAdapter(value: string): WorkbenchNewAgentAdapter {
  const normalized = value.trim().toLowerCase();
  if (normalized === "codex" || normalized === "claude" || normalized === "command" || normalized === "local") {
    return normalized;
  }
  throw new WorkbenchCodedError("usage", "workbench skill new --agent must be codex, claude, command, or local.", {
    remediation: "workbench skill new --agent codex",
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
  const auth = options.auth?.trim();
  const authStatus = await localWorkbenchAdapterAuthStore(options.adapterAuthStoreRoot).status({
    adapterId: adapter,
    profile: auth || "default",
  }).catch(() => ({ status: "disconnected" as const }));
  const ready = authStatus.status === "connected";
  return {
    name: "default",
    adapter,
    ...(options.model?.trim() ? { model: options.model.trim() } : {}),
    ...(auth ? { auth } : {}),
    kind: "provider",
    reason,
    readiness: {
      state: ready ? "ready" : "partial",
      workbenchProviderAuth: ready ? "connected" : "missing",
      setupCommands: ready ? [] : [workbenchProviderAuthSetupCommand(adapter)],
      warnings: ready ? [] : [`Adapter ${adapter} authentication is not configured.`],
    },
  };
}

async function assertLocalWorkbenchAdapterAuthReady(
  agents: readonly WorkbenchAgent[],
  options?: string | Pick<WorkbenchCommandOptions, "adapterAuthStoreRoot" | "homeDir" | "env">,
): Promise<void> {
  const readiness = await localWorkbenchAdapterAuthReadiness(agents, options);
  assertWorkbenchLaunchReadinessReady(readiness);
}

async function assertLocalWorkbenchLaunchReady(
  root: string,
  agents: readonly WorkbenchAgent[],
  options?: string | Pick<WorkbenchCommandOptions, "adapterAuthStoreRoot" | "homeDir" | "env">,
): Promise<void> {
  await assertLocalWorkbenchAdapterAuthReady(agents, options);
  await assertLocalWorkbenchExecutionEnvironmentReady(root, agents);
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
      const setupCommand = workbenchProviderAuthSetupCommand(target.adapterId);
      issues.push({
        code: "adapter_auth_required",
        message: `${workbenchAdapterAuthTargetLabel(target)} disconnected.`,
        remediation: setupCommand,
        subject: {
          adapterId: target.adapterId,
          profile: target.profile,
          ...(target.slot ? { slot: target.slot } : {}),
          setupCommands: [setupCommand],
        },
      });
    }
  }
  return readinessFromIssues(issues);
}

async function localWorkbenchLaunchReadiness(
  root: string,
  agents: readonly WorkbenchAgent[],
  options?: string | Pick<WorkbenchCommandOptions, "adapterAuthStoreRoot" | "homeDir" | "env">,
): Promise<WorkbenchLaunchReadiness> {
  const [authReadiness, environmentReadiness] = await Promise.all([
    localWorkbenchAdapterAuthReadiness(agents, options),
    localWorkbenchExecutionEnvironmentReadiness(root, agents),
  ]);
  return readinessFromIssues([...authReadiness.issues, ...environmentReadiness.issues]);
}

async function cloudWorkbenchLaunchReadiness(root: string): Promise<WorkbenchLaunchReadiness> {
  const environmentIssue = await skillEvalEnvironmentDockerfileReadinessIssue(root);
  return environmentIssue ? readinessFromIssues([environmentIssue]) : readyWorkbenchLaunchReadiness();
}

async function assertLocalWorkbenchExecutionEnvironmentReady(root: string, agents: readonly WorkbenchAgent[]): Promise<void> {
  const readiness = await localWorkbenchExecutionEnvironmentReadiness(root, agents);
  assertWorkbenchLaunchReadinessReady(readiness);
}

async function localWorkbenchExecutionEnvironmentReadiness(root: string, agents: readonly WorkbenchAgent[]): Promise<WorkbenchLaunchReadiness> {
  if (!localWorkbenchLaunchUsesDocker(agents)) {
    return readyWorkbenchLaunchReadiness();
  }
  const environmentIssue = await skillEvalEnvironmentDockerfileReadinessIssue(root);
  if (environmentIssue) {
    return readinessFromIssues([environmentIssue]);
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
    return SKILL_EVAL_COMMAND_AGENT_ADAPTERS.has(adapter) || isHarnessBackedSkillEvalAdapter(adapter);
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

async function skillEvalEnvironmentDockerfileReadinessIssue(root: string): Promise<WorkbenchLaunchReadinessIssue | null> {
  try {
    await readSkillEvalEnvironmentDockerfile(root);
    return null;
  } catch (error) {
    if (isMissingSkillEvalEnvironmentDockerfileError(error)) {
      return {
        code: "environment_missing",
        message: `${path.join(".workbench", ENVIRONMENT_DIR, "Dockerfile")} is required.`,
        remediation: `Create ${path.join(".workbench", ENVIRONMENT_DIR, "Dockerfile")} or rerun workbench skill init in a fresh project.`,
        subject: {
          path: path.join(".workbench", ENVIRONMENT_DIR, "Dockerfile"),
        },
      };
    }
    return {
      code: "environment_invalid",
      message: error instanceof Error ? error.message : String(error),
      remediation: `Inspect ${path.join(".workbench", ENVIRONMENT_DIR, "Dockerfile")}.`,
      subject: {
        path: path.join(".workbench", ENVIRONMENT_DIR, "Dockerfile"),
      },
    };
  }
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
    const key = workbenchAdapterAuthTargetIdentity(target);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(target);
  }
  return result;
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
      runCount: 0,
    };
  }
  return withWorkbenchProjectLockRoot(root, async () => workbenchStatusUnlocked(root));
}

async function workbenchStatusUnlocked(root: string): Promise<WorkbenchStatus> {
  const [state, agents, skillSources, skillFiles] = await Promise.all([
    loadStateReadOnlyWithRetry(root),
    readAgents(root),
    readSkillSources(root),
    readSkillFiles(root).catch(() => []),
  ]);
  const liveHash = skillFiles.length > 0 ? hashFiles(skillFiles) : undefined;
  const sourceVersion = liveHash ? findWorkbenchVersionBySourceHash(state.versions, liveHash) : undefined;
  const currentVersionId = sourceVersion?.id ?? state.refs.current;
  return {
    root,
    initialized: true,
    ...(currentVersionId ? { currentVersionId } : {}),
    defaultSkill: await readDefaultSkillSelection(root, skillSources),
    defaultAgent: await readDefaultAgentSelection(root, agents),
    runCount: state.runs.length,
    pendingSyncCount: await pendingSyncCount(root),
  };
}

export async function listWorkbenchVersions(options: WorkbenchCommandOptions = {}): Promise<WorkbenchVersion[]> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  const state = await loadStateReadOnlyWithRetry(root);
  return [...state.versions].sort(compareWorkbenchVersions);
}

export async function reconcileCurrentWorkbenchVersion(options: WorkbenchCommandOptions = {}): Promise<WorkbenchVersion> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const version = await reconcileWorkbenchVersion(root, state, PACKAGE_SNAPSHOT_MESSAGE);
    await saveState(root, state);
    return copyVersion(version);
  });
}

async function resolveWorkbenchEvalContext(
  root: string,
  state: WorkbenchProjectState,
  options: Pick<WorkbenchEvalOptions, "version" | "skill" | "agent" | "evalHash" | "authToken" | "caseIds" | "selectedSamples" | "samples">,
  command: "eval" | "grade",
  requireEnvironment: boolean,
) {
  const source = await planWorkbenchLaunchSource(root, state, {
    ref: options.version,
    commit: false,
    message: PACKAGE_SNAPSHOT_MESSAGE,
  });
  const runtimeSelection = await runtimeSelectionOptionsForRoot(root, state);
  const runtimeEvalControls = await runtimeEvalControlsForSelection(root, state, options.evalHash);
  const runtime = await createWorkbenchVersionRuntimeSnapshot(source.version, {
    controlRoot: root,
    ...runtimeEvalControls,
    skill: options.skill,
    agent: options.agent,
    evalHash: options.evalHash,
    authToken: options.authToken,
    selectionRemediationCommand: command,
    ...runtimeSelection,
  });
  for (const agent of runtime.selectedAgents) {
    assertSkillEvalAgentSupported(agent);
  }
  const selectedCases = selectEvalCasesForRun(runtime.cases, options.caseIds, options.selectedSamples);
  const targets = runtime.skillBundles.flatMap((skillBundle) =>
    runtime.selectedAgents.map((agent): WorkbenchEvaluationRunTarget => ({ skillBundle, agent }))
  );
  return {
    source,
    version: source.version,
    runtime,
    agents: runtime.selectedAgents,
    skillBundles: runtime.skillBundles,
    evalSnapshot: runtime.evalSnapshot,
    runtimeCases: runtime.cases,
    selectedCases,
    environmentDockerfile: runtime.environmentDockerfile ?? (requireEnvironment
      ? await readSkillEvalEnvironmentDockerfile(root)
      : undefined),
    targets,
    primaryTarget: targets[0],
    samples: options.samples ?? 1,
  };
}

export async function evalWorkbenchSkill(options: WorkbenchEvalOptions = {}): Promise<WorkbenchRun[]> {
  return runWorkbenchEvaluation(options, "eval");
}

export async function gradeWorkbenchSkill(options: WorkbenchEvalOptions = {}): Promise<WorkbenchRun[]> {
  return runWorkbenchEvaluation(options, "grade");
}

async function runWorkbenchEvaluation(
  options: WorkbenchEvalOptions,
  command: "eval" | "grade",
): Promise<WorkbenchRun[]> {
  const root = resolveRoot(options.dir);
  const kind = command === "grade" ? "grade" : normalizeWorkbenchCaseRunKind(options.kind, "eval");
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const context = await resolveWorkbenchEvalContext(root, state, options, command, true);
    let { version } = context;
    const { runtime, agents, runtimeCases, selectedCases } = context;
    if (runtimeCases.length === 0) {
      throw noEvalCasesError();
    }
    assertDraftCaseReadinessReady(selectedCases, kind, runtime.evalSnapshot);
    if ((options.location ?? "local") === "local") {
      await assertLocalWorkbenchLaunchReady(root, agents, options);
    }
    if (command === "eval" && !options.version) {
      version = await resolveOrCreateRunVersion(root, state);
    }
    for (const bundle of runtime.skillBundles) {
      upsertByHash(state.skillBundles, bundle);
    }
    upsertEvalSnapshotObject(state.evals, runtime.evalSnapshot);
    upsertAgentSnapshots(state.agents, runtime.agents);
    if (command === "eval" && !options.version) {
      state.skillSources = runtime.skillSources.map(copySkillSource);
    }
    const { targets, primaryTarget } = context;
    if (!primaryTarget) {
      throw new WorkbenchUserError("No eval targets resolved for this run.");
    }
    if (command === "eval") await saveState(root, state);
    const run = await executeWorkbenchEvaluationRun({
      root,
      state,
      adapterAuthStoreRoot: options.adapterAuthStoreRoot,
      version,
      skillBundle: primaryTarget.skillBundle,
      evalSnapshot: runtime.evalSnapshot,
      agent: primaryTarget.agent,
      targets,
      kind,
      parentRunId: options.parentRunId,
      location: options.location ?? "local",
      remoteName: options.remoteName,
      retryOfRunId: options.retryOfRunId,
      rerun: options.rerun === true,
      samples: context.samples,
      cases: runtimeCases,
      environmentDockerfile: context.environmentDockerfile!,
      caseIds: options.caseIds,
      selectedSamples: options.selectedSamples,
      operationTargets: options.operationTargets,
      operationSteps: options.operationSteps,
      gradeOfRunId: options.gradeOfRunId,
      onRunStarted: options.onRunStarted,
    });
    await saveState(root, state);
    return [command === "grade" ? copyRun(run) : run];
  });
}

export interface WorkbenchGradeSubject {
  job: WorkbenchJob;
  artifact: WorkbenchArtifact;
  trace: WorkbenchTrace;
  skillBundle: WorkbenchSkillBundleSnapshot;
  agent: WorkbenchAgent;
  runtimeCase: WorkbenchEvalCaseRuntime;
}

export function selectWorkbenchGradeSubjects(args: {
  state: WorkbenchProjectState;
  evalSnapshot: WorkbenchEvalSnapshot;
  targets: readonly WorkbenchEvaluationRunTarget[];
  cases: readonly WorkbenchEvalCaseRuntime[];
  executeRunId?: string;
}): WorkbenchGradeSubject[] {
  const casesById = new Map(args.cases.flatMap((runtimeCase) => [
    [runtimeCase.id, runtimeCase],
    [runtimeCase.path, runtimeCase],
  ]));
  const targetsByKey = new Map(args.targets.map((target) => [
    gradeTargetKey(target.skillBundle.hash, hashJson(target.agent)),
    target,
  ]));
  const eligibleSubjects: WorkbenchGradeSubject[] = [];
  for (const job of args.state.jobs) {
    if (job.role !== "run" || job.status !== "succeeded") {
      continue;
    }
    if (args.executeRunId && job.runId !== args.executeRunId) {
      continue;
    }
    const target = targetsByKey.get(gradeTargetKey(job.skillBundleHash, job.agentHash));
    const runtimeCase = casesById.get(job.caseId);
    if (
      !target ||
      !runtimeCase ||
      job.inputHash !== workbenchRunInputHash({
        evalSnapshot: args.evalSnapshot,
        target,
        runtimeCase,
        sample: job.sample,
      })
    ) {
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
  return eligibleSubjects.sort((left, right) =>
    left.job.caseId.localeCompare(right.job.caseId) ||
    left.job.sample - right.job.sample ||
    left.job.skillName.localeCompare(right.job.skillName) ||
    left.job.agentName.localeCompare(right.job.agentName) ||
    left.job.id.localeCompare(right.job.id)
  );
}

function gradeTargetKey(skillBundleHash: string, agentHash: string): string {
  return `${skillBundleHash}\0${agentHash}`;
}

function isReusableTerminalGradeStatus(status: WorkbenchJob["status"] | WorkbenchRun["status"]): boolean {
  return status === "succeeded" || status === "failed";
}

function currentGradeSubjectsForRuntime(args: {
  state: WorkbenchProjectState;
  evalSnapshot: WorkbenchEvalSnapshot;
  targets: readonly WorkbenchEvaluationRunTarget[];
  cases: readonly WorkbenchEvalCaseRuntime[];
  samples: number;
  selectedSamples?: readonly WorkbenchCaseSampleSelection[];
  executeRunId?: string;
}): WorkbenchGradeSubject[] {
  const samples = Math.max(1, Math.floor(args.samples));
  const targetsByKey = new Map(args.targets.map((target) => [
    splitEvalTargetKey({
      versionId: "",
      skillName: target.skillBundle.skillName,
      skillBundleHash: target.skillBundle.hash,
      agentName: target.agent.name,
      agentHash: hashJson(target.agent),
    }),
    target,
  ]));
  if (targetsByKey.size === 0 || args.cases.length === 0) {
    return [];
  }

  const expectedKeys: string[] = [];
  for (const targetKey of targetsByKey.keys()) {
    for (const runtimeCase of args.cases) {
      for (const sample of sampleIndexesForRun(runtimeCase, samples, args.selectedSamples)) {
        expectedKeys.push(splitEvalEvidenceKey(targetKey, runtimeCase.id, sample));
      }
    }
  }

  const expectedKeySet = new Set(expectedKeys);
  const subjectsByKey = new Map<string, WorkbenchGradeSubject[]>();
  for (const subject of selectWorkbenchGradeSubjects(args)) {
    const targetKey = splitEvalTargetKey(subject.job);
    const key = splitEvalEvidenceKey(targetKey, subject.runtimeCase.id, subject.job.sample);
    if (!targetsByKey.has(targetKey) || !expectedKeySet.has(key)) {
      continue;
    }
    const current = subjectsByKey.get(key) ?? [];
    current.push(subject);
    subjectsByKey.set(key, current);
  }
  for (const subjects of subjectsByKey.values()) {
    subjects.sort((left, right) => compareJobsNewestFirst(left.job, right.job));
  }

  const currentSubjects: WorkbenchGradeSubject[] = [];
  const seenJobIds = new Set<string>();
  for (const key of expectedKeys) {
    const subject = subjectsByKey.get(key)?.[0];
    if (!subject || seenJobIds.has(subject.job.id)) {
      continue;
    }
    currentSubjects.push(subject);
    seenJobIds.add(subject.job.id);
  }
  return currentSubjects;
}

function reusableExecutionPreviewEvidence(args: {
  state: WorkbenchProjectState;
  version: WorkbenchVersion;
  evalSnapshot: WorkbenchEvalSnapshot;
  targets: readonly WorkbenchEvaluationRunTarget[];
  cases: readonly WorkbenchEvalCaseRuntime[];
  samples: number;
}): { jobs: WorkbenchJob[] } {
  return {
    jobs: reusableExecutionPreviewSubjects(args).map((subject) => subject.job),
  };
}

function reusableSplitEvalPreviewEvidence(args: {
  state: WorkbenchProjectState;
  version: WorkbenchVersion;
  evalSnapshot: WorkbenchEvalSnapshot;
  targets: readonly WorkbenchEvaluationRunTarget[];
  cases: readonly WorkbenchEvalCaseRuntime[];
  samples: number;
}): { jobs: WorkbenchJob[] } {
  const reusableJobs: WorkbenchJob[] = [];
  for (const subject of reusableExecutionPreviewSubjects(args)) {
    reusableJobs.push(subject.job);
    const gradeJob = selectReusableWorkbenchGradeJob({
      state: args.state,
      evalSnapshot: args.evalSnapshot,
      runtimeCase: subject.runtimeCase,
      agent: subject.agent,
      executionJob: subject.job,
    });
    if (gradeJob) {
      reusableJobs.push(gradeJob);
    }
  }
  return { jobs: dedupeJobs(reusableJobs) };
}

function reusableExecutionPreviewSubjects(args: {
  state: WorkbenchProjectState;
  version: WorkbenchVersion;
  evalSnapshot: WorkbenchEvalSnapshot;
  targets: readonly WorkbenchEvaluationRunTarget[];
  cases: readonly WorkbenchEvalCaseRuntime[];
  samples: number;
}): WorkbenchGradeSubject[] {
  const samples = Math.max(1, Math.floor(args.samples));
  const subjects: WorkbenchGradeSubject[] = [];
  const seenJobIds = new Set<string>();
  for (const target of args.targets) {
    for (const runtimeCase of args.cases) {
      for (const sample of sampleIndexesForRun(runtimeCase, samples, undefined)) {
        const subject = selectReusableWorkbenchExecutionSubject({
          state: args.state,
          evalSnapshot: args.evalSnapshot,
          target,
          runtimeCase,
          sample,
        });
        if (!subject || seenJobIds.has(subject.job.id)) {
          continue;
        }
        subjects.push(subject);
        seenJobIds.add(subject.job.id);
      }
    }
  }
  return subjects;
}

export function selectReusableWorkbenchExecutionSubject(args: {
  state: WorkbenchProjectState;
  evalSnapshot: WorkbenchEvalSnapshot;
  target: WorkbenchEvaluationRunTarget;
  runtimeCase: WorkbenchEvalCaseRuntime;
  sample: number;
}): WorkbenchGradeSubject | undefined {
  const inputHash = workbenchRunInputHash({
    evalSnapshot: args.evalSnapshot,
    target: args.target,
    runtimeCase: args.runtimeCase,
    sample: args.sample,
  });
  const candidates = args.state.jobs
    .filter((job) =>
      job.role === "run" &&
      job.status === "succeeded" &&
      job.skillBundleHash === args.target.skillBundle.hash &&
      job.agentHash === hashJson(args.target.agent) &&
      job.caseId === args.runtimeCase.id &&
      job.sample === args.sample &&
      job.inputHash === inputHash
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
      skillBundle: args.target.skillBundle,
      agent: args.target.agent,
      runtimeCase: args.runtimeCase,
    };
  }
  return undefined;
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

export function createWorkbenchRunInputHash(args: {
  evalSnapshot: WorkbenchEvalSnapshot;
  skillBundle: WorkbenchSkillBundleSnapshot;
  agent: WorkbenchAgent;
  runtimeCase: WorkbenchEvalCaseRuntime;
  sample: number;
}): string {
  return workbenchRunInputHash({
    evalSnapshot: args.evalSnapshot,
    target: { skillBundle: args.skillBundle, agent: args.agent },
    runtimeCase: args.runtimeCase,
    sample: args.sample,
  });
}

function workbenchRunInputHash(args: {
  evalSnapshot: WorkbenchEvalSnapshot;
  target: WorkbenchEvaluationRunTarget;
  runtimeCase: WorkbenchEvalCaseRuntime;
  sample: number;
}): string {
  return hashJson({
    schema: "workbench.run-input.v1",
    skillBundleHash: args.target.skillBundle.hash,
    agentHash: hashJson(args.target.agent),
    command: resolveDockerEvalCommand(args.target.agent, args.runtimeCase),
    caseId: args.runtimeCase.id,
    sample: args.sample,
    prompt: skillEvalCasePrompt(args.runtimeCase),
    caseDescriptor: comparableRunCaseDescriptorContent(args.runtimeCase.content),
    caseFilesHash: hashFiles(skillEvalRunVisibleCaseFiles(args.target.agent, args.runtimeCase)),
    environmentFilesHash: hashFiles(evalSnapshotEnvironmentFiles(args.evalSnapshot)),
  });
}

export function createWorkbenchGradeInputHash(args: {
  evalSnapshot: WorkbenchEvalSnapshot;
  runtimeCase: WorkbenchEvalCaseRuntime;
  agent: WorkbenchAgent;
  subjectJobId: string;
  subjectInputHash: string;
}): string {
  return workbenchGradeInputHash(args);
}

function workbenchGradeInputHash(args: {
  evalSnapshot: WorkbenchEvalSnapshot;
  runtimeCase: WorkbenchEvalCaseRuntime;
  agent: WorkbenchAgent;
  subjectJobId: string;
  subjectInputHash: string;
}, strict = true): string {
  const resolved = skillEvalCaseGradePlan({
    evalSnapshot: args.evalSnapshot,
    runtimeCase: args.runtimeCase,
    agent: args.agent,
    strict,
  });
  return hashJson({
    schema: "workbench.grade-input.v1",
    subjectJobId: args.subjectJobId,
    subjectInputHash: args.subjectInputHash,
    caseId: args.runtimeCase.id,
    agentHash: hashJson(args.agent),
    adapter: resolved.adapter,
    config: resolved.config,
    sources: resolved.plan.sources,
    gradeFilesHash: hashFiles(skillEvalGradeVisibleCaseFiles(args.runtimeCase)),
    environmentFilesHash: hashFiles(evalSnapshotEnvironmentFiles(args.evalSnapshot)),
  });
}

function evalSnapshotEnvironmentFiles(evalSnapshot: WorkbenchEvalSnapshot): SurfaceSnapshotFile[] {
  return evalSnapshot.files
    .filter((file) => normalizeRelativePath(file.path).startsWith(`${ENVIRONMENT_DIR}/`))
    .map(copyFile)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function skillEvalRunVisibleCaseFiles(
  agent: WorkbenchAgent,
  runtimeCase: WorkbenchEvalCaseRuntime,
): SurfaceSnapshotFile[] {
  return (skillEvalEngineCaseFiles(agent, runtimeCase).public ?? [])
    .map((file) => {
      const normalized = normalizeRelativePath(file.path);
      return {
        ...copyFile(file),
        path: normalized,
        content: normalized === CASE_DESCRIPTOR_FILE
          ? comparableRunCaseDescriptorContent(file.content)
          : file.content,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function skillEvalGradeVisibleCaseFiles(runtimeCase: WorkbenchEvalCaseRuntime): SurfaceSnapshotFile[] {
  return runtimeCase.files
    .map((file) => {
      const normalized = normalizeRelativePath(file.path);
      return {
        ...copyFile(file),
        path: normalized,
        content: normalized === CASE_DESCRIPTOR_FILE
          ? comparableGradeCaseDescriptorContent(file.content)
          : file.content,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function evalSnapshotCaseRoot(runtimeCase: WorkbenchEvalCaseSnapshot): string {
  const normalized = normalizeRelativePath(runtimeCase.path);
  if (!normalized.startsWith(`${CASES_DIR}/`)) {
    return "";
  }
  return normalizeRelativePath(path.posix.dirname(normalized));
}

function evalRuntimeCaseFromSnapshot(snapshotCase: WorkbenchEvalCaseSnapshot): WorkbenchEvalCaseRuntime {
  const caseRoot = evalSnapshotCaseRoot(snapshotCase);
  const files = snapshotCase.files
    .map((file) => ({
      ...copyFile(file),
      path: normalizeEvalCaseLocalPath(file.path, caseRoot),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const descriptor = files.find((file) => normalizeRelativePath(file.path) === CASE_DESCRIPTOR_FILE);
  const content = descriptor?.content ?? "";
  const record = parseCaseSnapshotRecord(content);
  return {
    id: snapshotCase.id,
    path: caseRoot ? path.posix.basename(caseRoot) : snapshotCase.id,
    content,
    files,
    ...(snapshotCase.command ? { command: snapshotCase.command } : {}),
    ...(caseSmokeFromRecord(record) ? { smoke: true } : {}),
  };
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

function comparableRunCaseDescriptorContent(content: string): string {
  const record = comparableCaseDescriptorRecord(content);
  delete record.grade;
  return `${YAML.stringify(canonicalize(record)).trimEnd()}\n`;
}

function comparableGradeCaseDescriptorContent(content: string): string {
  const record = comparableCaseDescriptorRecord(content);
  return `${YAML.stringify(canonicalize(record)).trimEnd()}\n`;
}

function comparableCaseDescriptorRecord(content: string): Record<string, unknown> {
  const record = parseCaseSnapshotRecord(content);
  delete record.smoke;
  return record;
}

function reusableExecutionSubjectForPlannedJob(args: {
  state: WorkbenchProjectState;
  version: WorkbenchVersion;
  evalSnapshot: WorkbenchEvalSnapshot;
  plannedJob: PlannedWorkbenchEvaluationJob;
}): WorkbenchGradeSubject | undefined {
  return selectReusableWorkbenchExecutionSubject({
    state: args.state,
    evalSnapshot: args.evalSnapshot,
    target: {
      skillBundle: args.plannedJob.skillBundle,
      agent: args.plannedJob.agent,
    },
    runtimeCase: args.plannedJob.runtimeCase,
    sample: args.plannedJob.sample,
  });
}

export function selectReusableWorkbenchGradeJob(args: {
  state: WorkbenchProjectState;
  evalSnapshot: WorkbenchEvalSnapshot;
  runtimeCase: WorkbenchEvalCaseRuntime;
  agent: WorkbenchAgent;
  executionJob: WorkbenchJob;
}): WorkbenchJob | undefined {
  if (!skillEvalCaseHasConcreteGrader({
    evalSnapshot: args.evalSnapshot,
    runtimeCase: args.runtimeCase,
    agent: args.agent,
  })) {
    return undefined;
  }
  const inputHash = workbenchGradeInputHash({
    evalSnapshot: args.evalSnapshot,
    runtimeCase: args.runtimeCase,
    agent: args.agent,
    subjectJobId: args.executionJob.id,
    subjectInputHash: args.executionJob.inputHash,
  }, false);
  return args.state.jobs
    .filter((job) =>
      job.role === "grade" &&
      isReusableTerminalGradeStatus(job.status) &&
      job.skillBundleHash === args.executionJob.skillBundleHash &&
      job.agentHash === args.executionJob.agentHash &&
      job.caseId === args.executionJob.caseId &&
      job.sample === args.executionJob.sample &&
      job.inputHash === inputHash &&
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
  environmentDockerfile: string;
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
  const remoteJob: WorkbenchExecutionJob = {
    ...args.subject.job,
    projectId: "local",
    status: "succeeded",
    attempt: 1,
    updatedAt: args.subject.job.finishedAt ?? args.subject.job.startedAt ?? args.subject.job.createdAt,
    input: input.job.input,
    output: toJson({
      ok: true,
      files: toJson(outputFiles),
      workspaceFiles: toJson(workspaceFiles),
      result: args.subject.trace.result,
    }),
  };
  return {
    remoteJob,
    plannedJob: {
      role: "run",
      inputHash: args.subject.job.inputHash,
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
  const kind = normalizeWorkbenchCaseRunKind(options.kind, "eval");
  await requireInitialized(root);
  const state = await loadStateReadOnlyWithRetry(root);
  const context = await resolveWorkbenchEvalContext(root, state, options, "eval", false);
  const { source, version, runtime, runtimeCases, selectedCases, samples, targets } = context;
  const draftCaseIssues = runtimeCases.length === 0
    ? []
    : draftCaseReadinessIssues(selectedCases, kind, runtime.evalSnapshot);
  const localReadiness = options.cloud === true
    ? await cloudWorkbenchLaunchReadiness(root)
    : await localWorkbenchLaunchReadiness(root, runtime.selectedAgents, options);
  const readiness = runtimeCases.length === 0
    ? readinessFromIssues([noEvalCasesReadinessIssue(), ...localReadiness.issues])
    : readinessFromIssues([...draftCaseIssues, ...localReadiness.issues]);
  const adapterAuthTargets = uniqueLocalAdapterAuthTargets(runtime.selectedAgents.flatMap(localAdapterAuthTargetsForAgent));
  const cached = options.cloud === true
    ? { runIds: [], jobIds: [] }
    : cachedEvalPreviewEvidence({
        state,
        version,
        evalSnapshot: runtime.evalSnapshot,
        targets,
        cases: selectedCases,
        samples,
        kind,
        rerun: options.rerun === true,
        selectedSamples: options.selectedSamples,
      });
  return {
    dryRun: true,
    location: options.cloud === true ? "cloud" : "local",
    versionId: version.id,
    sourceState: source.sourceState,
    evalHash: runtime.evalSnapshot.hash,
    skills: runtime.skillBundles.map((bundle) => ({ name: bundle.skillName, hash: bundle.hash })),
    agents: runtime.selectedAgents.map((agent) => ({ name: agent.name, hash: hashJson(agent) })),
    cases: selectedCases.length,
    samples,
    cachedRunIds: cached.runIds,
    cachedJobIds: cached.jobIds,
    ...(context.environmentDockerfile ? {
      environment: {
        path: path.join(".workbench", ENVIRONMENT_DIR, "Dockerfile"),
        dockerfile: context.environmentDockerfile,
      },
    } : {}),
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
  kind: WorkbenchCaseRunKind;
  rerun: boolean;
  selectedSamples?: readonly unknown[];
}): { runIds: string[]; jobIds: string[] } {
  if (
    args.rerun ||
    args.cases.length === 0 ||
    (args.selectedSamples?.length ?? 0) > 0
  ) {
    return { runIds: [], jobIds: [] };
  }
  if (args.kind === "run") {
    const execution = reusableExecutionPreviewEvidence({
      state: args.state,
      version: args.version,
      evalSnapshot: args.evalSnapshot,
      targets: args.targets,
      cases: args.cases,
      samples: args.samples,
    });
    return {
      runIds: uniqueStrings(execution.jobs.map((job) => job.runId)),
      jobIds: execution.jobs.map((job) => job.id),
    };
  }
  if (args.kind === "grade") {
    const subjects = currentGradeSubjectsForRuntime({
      state: args.state,
      evalSnapshot: args.evalSnapshot,
      targets: args.targets,
      cases: args.cases,
      samples: args.samples,
    });
    const gradeJobs = subjects.flatMap((subject) =>
      selectReusableWorkbenchGradeJob({
        state: args.state,
        evalSnapshot: args.evalSnapshot,
        runtimeCase: subject.runtimeCase,
        agent: subject.agent,
        executionJob: subject.job,
      }) ?? []
    );
    return gradeJobs.length > 0
      ? {
          runIds: uniqueStrings(gradeJobs.map((job) => job.runId)),
          jobIds: gradeJobs.map((job) => job.id),
        }
      : { runIds: [], jobIds: [] };
  }
  if (args.kind !== "eval") {
    return { runIds: [], jobIds: [] };
  }
  const split = reusableSplitEvalPreviewEvidence({
    state: args.state,
    version: args.version,
    evalSnapshot: args.evalSnapshot,
    targets: args.targets,
    cases: args.cases,
    samples: args.samples,
  });
  return {
    runIds: uniqueStrings(split.jobs.map((job) => job.runId)),
    jobIds: split.jobs.map((job) => job.id),
  };
}

export async function prepareWorkbenchCloudEvalRequest(
  options: Omit<Pick<WorkbenchEvalOptions, "dir" | "authToken" | "evalHash" | "skill" | "agent" | "caseIds" | "samples" | "kind" | "rerun">, "kind"> & {
    kind?: WorkbenchCaseRunKind;
  } = {},
): Promise<WorkbenchPreparedCloudEvalRequest> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const cases = await readEvalCases(root);
    if (cases.length === 0) {
      throw noEvalCasesError();
    }
    const kind = normalizeWorkbenchCaseRunKind(options.kind, "eval");
    const evalSnapshot = await readEvalSnapshot(root);
    assertDraftCaseReadinessReady(selectEvalCasesForRun(cases, options.caseIds, undefined), kind, evalSnapshot);
    const state = await loadState(root);
    const version = await resolveOrCreateRunVersion(root, state);
    await saveState(root, state);
    return {
      kind: "eval",
      variant: "cloud",
      ...(options.evalHash ? { evalHash: options.evalHash } : {}),
      caseIds: [...(options.caseIds ?? [])],
      targets: [{
        versionId: version.id,
        ...(options.skill !== undefined ? { skill: options.skill } : {}),
        ...(options.agent !== undefined ? { agent: options.agent } : {}),
      }],
      steps: stepsForRunKind(kind),
      samples: options.samples ?? 1,
      ...(options.rerun === true ? { rerun: true } : {}),
    };
  });
}

export function resolveWorkbenchRunRetryRequest(
  snapshot: WorkbenchInspectionSnapshot,
  run: WorkbenchRun,
): WorkbenchOperationRequest {
  const plan = retryOperationPlanForRun(run);
  const evalHash = retryEvalHash(run, plan);
  const samples = positiveRetryInteger(run, plan.samples, "operationPlan.samples");
  if (samples === undefined) {
    throw retryIncompleteError(run, `Run ${run.id} does not record operationPlan.samples.`);
  }
  if (run.kind !== "improve") {
    const versionId = retryVersionId(run, plan);
    requireRetryVersion(snapshot, versionId, run);
    return {
      kind: "eval",
      variant: plan.variant,
      evalHash,
      caseIds: plan.caseIds ? [...plan.caseIds] : [],
      targets: retryOperationTargets(snapshot, run, plan, versionId),
      steps: retryOperationSteps(run, plan),
      samples,
      rerun: true,
      retryOfRunId: run.id,
    };
  }
  const skillName = retrySingleSelection(run, plan.skills, "skills");
  const agentName = retrySingleSelection(run, plan.agents, "agents");
  const baseVersionId = retryVersionId(run, plan);
  requireRetryVersion(snapshot, baseVersionId, run);
  return {
    kind: "improve",
    variant: plan.variant,
    versionId: baseVersionId,
    evalHash,
    target: {
      versionId: baseVersionId,
      skill: skillName,
      agent: agentName,
    },
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

function retryEvalHash(run: WorkbenchRun, plan: WorkbenchOperationPlanSummary): string {
  if (plan.evalHash) {
    return plan.evalHash;
  }
  throw retryIncompleteError(run, `Run ${run.id} does not record operationPlan.evalHash.`);
}

function retryOperationSteps(run: WorkbenchRun, plan: WorkbenchOperationPlanSummary): WorkbenchOperationStep[] {
  if ((plan.steps?.length ?? 0) > 0) {
    return uniqueOperationSteps(plan.steps ?? []);
  }
  throw retryIncompleteError(run, `Run ${run.id} does not record operationPlan.steps.`);
}

function retryOperationTargets(
  snapshot: WorkbenchInspectionSnapshot,
  run: WorkbenchRun,
  plan: WorkbenchOperationPlanSummary,
  versionId: string,
): WorkbenchOperationTarget[] {
  const targetsFromJobs = retryOperationTargetsFromJobs(snapshot, run, versionId);
  if (targetsFromJobs.length > 0) {
    return targetsFromJobs;
  }
  const targets = plan.targets?.length ? plan.targets : operationTargetsFromPlan(plan);
  if (targets.length === 0) {
    throw retryIncompleteError(run, `Run ${run.id} does not record operationPlan.targets.`);
  }
  return targets.map((target, index) => ({
    ...(target.skill ?? plan.skills[index] ?? plan.skills[0] ? { skill: target.skill ?? plan.skills[index] ?? plan.skills[0] } : {}),
    versionId: target.versionId ?? versionId,
    ...(target.agent ?? plan.agents[index] ?? plan.agents[0] ? { agent: target.agent ?? plan.agents[index] ?? plan.agents[0] } : {}),
  }));
}

function retryOperationTargetsFromJobs(
  snapshot: WorkbenchInspectionSnapshot,
  run: WorkbenchRun,
  versionId: string,
): WorkbenchOperationTarget[] {
  const targets = new Map<string, WorkbenchOperationTarget>();
  for (const job of snapshot.jobs) {
    if (!run.jobIds.includes(job.id)) {
      continue;
    }
    if (!job.skillName || !job.agentName) {
      continue;
    }
    const key = `${job.skillName}\0${job.agentName}`;
    if (!targets.has(key)) {
      targets.set(key, {
        skill: job.skillName,
        versionId,
        agent: job.agentName,
      });
    }
  }
  return [...targets.values()];
}

function retrySingleSelection(run: WorkbenchRun, values: readonly string[], label: "skills" | "agents"): string {
  if (values.length === 1 && values[0]) {
    return values[0];
  }
  throw retryIncompleteError(run, `Run ${run.id} does not record exactly one operationPlan.${label} entry.`);
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
  return new WorkbenchCodedError("run_retry_incomplete", message, {
    remediation: WORKBENCH_SELECTOR_INVOCATIONS[run.kind],
    subject: { runId: run.id },
    exitCode: 1,
  });
}

async function resolveWorkbenchImproveContext(
  root: string,
  state: WorkbenchProjectState,
  options: Pick<WorkbenchImproveOptions, "version" | "skill" | "agent" | "authToken" | "evidenceTraceIds">,
) {
  const source = await planWorkbenchLaunchSource(root, state, {
    ref: options.version,
    commit: false,
    message: PACKAGE_SNAPSHOT_MESSAGE,
  });
  const runtimeSelection = await runtimeSelectionOptionsForRoot(root, state);
  const runtime = await createWorkbenchVersionRuntimeSnapshot(source.version, {
    controlRoot: root,
    skill: options.skill,
    agent: options.agent,
    authToken: options.authToken,
    selectionRemediationCommand: "improve",
    ...runtimeSelection,
  });
  const { skillBundle, evalAgent } = requireWorkbenchImproveTarget(runtime, { requireAdapter: false });
  if (runtime.cases.length === 0) {
    throw noEvalCasesError();
  }
  const historicalTraces = improvementEvidenceTracesForImproveRequest(state, {
    versionId: source.version.id,
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
      versionId: source.version.id,
      skillName: skillBundle.skillName,
      evalHash: runtime.evalSnapshot.hash,
      cases: runtime.cases,
      agentName: evalAgent.name,
      preserveAgentSelection: options.agent !== undefined,
    });
  }
  return {
    source,
    base: source.version,
    runtime,
    runtimeSelection,
    skillBundle,
    evalAgent,
    historicalTraces,
    improvementEvidence,
  };
}

export async function prepareWorkbenchCloudImproveRequest(
  options: Pick<WorkbenchImproveOptions, "dir" | "authToken" | "skill" | "agent" | "budget" | "samples" | "evidenceTraceIds"> = {},
): Promise<WorkbenchPreparedCloudImproveRequest> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const { evalAgent } = await resolveWorkbenchImproveContext(root, state, options);
    if (!workbenchSkillImproveCanUseQueuedAdapter(evalAgent)) {
      throw workbenchSkillImproveAdapterRequirementError(evalAgent, state.agents);
    }
    requireWorkbenchImproveAgentAdapter(evalAgent);
    const base = await resolveOrCreateRunVersion(root, state);
    await saveState(root, state);
    return {
      kind: "improve",
      variant: "cloud",
      versionId: base.id,
      target: {
        versionId: base.id,
        ...(options.skill !== undefined ? { skill: options.skill } : {}),
        ...(options.agent !== undefined ? { agent: options.agent } : {}),
      },
      samples: options.samples ?? 1,
      budget: options.budget ?? 1,
      ...(options.evidenceTraceIds !== undefined ? { evidenceTraceIds: [...options.evidenceTraceIds] } : {}),
    };
  });
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

function resolveSkillRuntimeEnvironment(
  agent: WorkbenchAgent,
  dockerfile: string,
  manifests: readonly WorkbenchAdapterManifest[],
  imageRef?: string,
) {
  const environmentDockerfile = composeSkillRuntimeDockerfileWithAdapterManifests({
    dockerfile: requireSkillEvalEnvironmentDockerfileContent(dockerfile),
    manifests,
  });
  const plannedEnvironment = skillEvalRuntimeSpec(agent, environmentDockerfile);
  const environment = imageRef
    ? { ...plannedEnvironment, dockerfile: dockerRuntimeImageRef(imageRef) }
    : plannedEnvironment;
  return {
    environment,
    runtime: environment.dockerfile.startsWith("dockerfile://")
      ? {
          environmentDockerfile,
          environmentVersion: {
            id: `skill_env_${hashJson(environmentDockerfile).slice(0, 12)}`,
            imageRef: environment.dockerfile,
            sourceHash: hashJson(environmentDockerfile),
            spec: {
              base: "dockerfile" as const,
              resources: runtimeResourcesForSkillEval(agent),
              network: runtimeNetworkForSkillEval(agent).egress === "open" ? "on" as const : "off" as const,
            },
          },
        }
      : {},
  };
}

export function createWorkbenchSkillEvalRuntimeInput(
  args: WorkbenchSkillEvalRuntimeInputArgs,
): WorkbenchExecutionRuntimeInput {
  const skillName = args.skillName ?? CURRENT_SKILL_VERSION_NAME;
  const skillBundleHash = args.skillBundleHash ?? args.versionId;
  assertSkillEvalAgentSupported(args.agent);
  const createdAt = args.createdAt ?? now();
  const command = resolveDockerEvalCommand(args.agent, args.runtimeCase);
  const score = skillEvalRuntimeGradeInvocation({
    evalSnapshot: args.evalSnapshot,
    agent: args.agent,
    runtimeCase: args.runtimeCase,
  });
  const adapterManifests = skillEvalAdapterManifestsForAgent(args.agent, score);
  const { environment, runtime } = resolveSkillRuntimeEnvironment(
    args.agent,
    args.environmentDockerfile,
    adapterManifests,
    args.environmentImageRef,
  );
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
  const plannedInput = readWorkbenchPlannedExecutionJobInput(plannedJob);
  const job: WorkbenchExecutionJob = {
    ...plannedJob,
    id: args.jobId,
    kind: "eval",
    role: "run",
    inputHash: createWorkbenchRunInputHash({
      evalSnapshot: args.evalSnapshot,
      skillBundle: {
        hash: skillBundleHash,
        skillName,
        entryName: skillName,
        source: { name: skillName, kind: "local", path: "." },
        files: args.versionFiles.map(copyFile),
        includedSkills: [],
        createdAt,
      },
      agent: args.agent,
      runtimeCase: args.runtimeCase,
      sample: args.sample,
    }),
    skillName,
    skillBundleHash,
    evalHash: args.evalHash,
    agentName: args.agent.name,
    agentHash: hashJson(args.agent),
    caseId: args.runtimeCase.id,
    sample: args.sample,
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
    },
  };
  return {
    job,
    spec,
    ...runtime,
    baseFiles: args.versionFiles.map(copyFile),
    engineResolveFiles: (engineCase.files.public ?? []).map(copyFile),
    engineCases: [engineCase],
    adapterManifests,
  };
}

export function createWorkbenchSkillEvalGradeRuntimeInput(
  args: WorkbenchSkillEvalGradeRuntimeInputArgs,
): WorkbenchExecutionRuntimeInput {
  // Run-only planning tolerates an unfinished grader so output can be inspected
  // before judgment policy is authored. A grade execution never does.
  skillEvalGradeInvocation(args);
  const input = createWorkbenchSkillEvalRuntimeInput(args);
  const execution = readWorkbenchExecutionSpec(input.job);
  const jobInput = readWorkbenchPlannedExecutionJobInput(input.job);
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
      },
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
  const { environment, runtime } = resolveSkillRuntimeEnvironment(
    args.agent,
    args.environmentDockerfile,
    adapterManifests,
    args.environmentImageRef,
  );
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
  const plannedInput = readWorkbenchPlannedExecutionJobInput(plannedJob);
  const job: WorkbenchExecutionJob = {
    ...plannedJob,
    id: args.jobId,
    kind: "improve",
    role: "improve",
    inputHash: hashJson({
      schema: "workbench.improve-input.v1",
      baseVersionId: args.baseVersionId,
      skillBundleHash,
      evalHash: args.evalHash,
      agentHash: hashJson(args.agent),
      traceIds: args.traces.map((trace) => trace.id).sort(),
    }),
    skillName,
    skillBundleHash,
    evalHash: args.evalHash,
    agentName: args.agent.name,
    agentHash: hashJson(args.agent),
    caseId: "current",
    sample: 0,
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
    },
  };
  return {
    job,
    spec,
    ...runtime,
    baseFiles: args.baseFiles.map(copyFile),
    traceFiles: skillImproveTraceInputFiles(args.traces),
    engineResolveFiles: [],
    engineCases: [engineCase],
    adapterManifests,
  };
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
    if (options.evalHash && !traceHashMatches(state, trace, "evalHash", options.evalHash)) {
      return false;
    }
    if (options.agent) {
      if (trace.agentName !== options.agent.name) {
        return false;
      }
      return traceHashMatches(state, trace, "agentHash", agentHash!);
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

function traceHashMatches(
  state: WorkbenchProjectState,
  trace: WorkbenchTrace,
  key: "agentHash" | "evalHash",
  expected: string,
): boolean {
  if (trace[key]) {
    return trace[key] === expected;
  }
  const job = trace.jobId
    ? state.jobs.find((entry) => entry.id === trace.jobId)
    : undefined;
  if (job?.[key]) {
    return job[key] === expected;
  }
  const run = state.runs.find((entry) => entry.id === trace.runId);
  if (run?.[key]) {
    return run[key] === expected;
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

function providerAgentAuthSetupCommands(adapter: string): string[] {
  return [workbenchProviderAuthSetupCommand(adapter)];
}

function providerAgentAddCommand(adapter: string, agentName: string): string {
  return `workbench eval agent add ${agentName} --adapter ${adapter}`;
}

function providerAgentSetupCommand(adapter: string, agentName: string): string {
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
      `workbench eval run --agents ${configuredImproveAgent.name} --rerun`,
      `workbench skill improve --agents ${configuredImproveAgent.name}`,
    ];
  }
  const adapter = agent.adapter.trim().toLowerCase();
  if (isHarnessBackedSkillEvalAdapter(adapter)) {
    return [...providerAgentAuthSetupCommands(adapter), providerAgentAddCommand(adapter, agent.name)];
  }
  return [
    providerAgentAddCommand("codex", "improver"),
    ...providerAgentAuthSetupCommands("codex"),
    "workbench eval run --agents improver --rerun",
    "workbench skill improve --agents improver",
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
  return isHarnessBackedSkillEvalAdapter(adapter)
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
  remoteJob: WorkbenchExecutionJob,
): WorkbenchSkillPatch | null {
  const output = asRuntimeRecord(remoteJob.output);
  return output.skillPatch === undefined
    ? null
    : normalizeWorkbenchSkillPatchFromRecord(asRuntimeRecord(output.skillPatch));
}

function normalizeWorkbenchSkillPatchFromRecord(
  record: Record<string, unknown>,
): WorkbenchSkillPatch {
  const files = Array.isArray(record.files)
    ? record.files.filter(isSurfaceSnapshotFile).map(copyFile).filter((file) => !isWorkbenchControlPath(file.path))
    : [];
  const fileChanges = Array.isArray(record.fileChanges)
    ? record.fileChanges
        .flatMap((entry) => typeof entry === "string" ? [normalizeRelativePath(entry)] : [])
        .filter((entry) => !isWorkbenchControlPath(entry))
    : files.map((file) => normalizeRelativePath(file.path));
  return {
    files,
    fileChanges,
    ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
    ...(record.feedback !== undefined && isWorkbenchJson(record.feedback) ? { feedback: record.feedback } : {}),
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

interface WorkbenchRuntimeEvalControls {
  evalSnapshot: WorkbenchEvalSnapshot;
  cases: WorkbenchEvalCaseRuntime[];
  environmentDockerfile?: string;
}

async function runtimeEvalControlsForSelection(
  root: string,
  state: WorkbenchProjectState,
  evalHash?: string,
): Promise<WorkbenchRuntimeEvalControls> {
  if (!evalHash) {
    const liveEvalSnapshot = await readEvalSnapshot(root);
    const environmentDockerfile = await readOptionalSkillEvalEnvironmentDockerfile(root);
    return {
      evalSnapshot: liveEvalSnapshot,
      cases: await readEvalCases(root),
      ...(environmentDockerfile ? { environmentDockerfile } : {}),
    };
  }

  const evalSnapshot = state.evals.find((entry) => entry.hash === evalHash);
  if (!evalSnapshot) {
    const liveEvalSnapshot = await readEvalSnapshot(root);
    if (liveEvalSnapshot.hash !== evalHash) {
      throw new WorkbenchUserError(`Eval snapshot not found: ${evalHash}`);
    }
    const environmentDockerfile = await readOptionalSkillEvalEnvironmentDockerfile(root);
    return {
      evalSnapshot: liveEvalSnapshot,
      cases: await readEvalCases(root),
      ...(environmentDockerfile ? { environmentDockerfile } : {}),
    };
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-eval-controls-"));
  try {
    await materializeWorkbenchFiles(tempRoot, copyStateForRoot(state, tempRoot), evalHash);
    const environmentDockerfile = await readOptionalSkillEvalEnvironmentDockerfile(tempRoot);
    return {
      evalSnapshot: copyEval(evalSnapshot),
      cases: await readEvalCases(tempRoot),
      ...(environmentDockerfile ? { environmentDockerfile } : {}),
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

export async function createWorkbenchVersionRuntimeSnapshot(
  version: WorkbenchVersion,
  options: {
    controlRoot?: string;
    evalSnapshot?: WorkbenchEvalSnapshot;
    cases?: readonly WorkbenchEvalCaseRuntime[];
    skillSources?: readonly WorkbenchSkillSource[];
    defaultSkill?: string;
    environmentDockerfile?: string;
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
    const controlRoot = options.controlRoot ?? sourceRoot;
    const evalSnapshot = options.evalSnapshot
      ? copyEval(options.evalSnapshot)
      : await readEvalSnapshot(controlRoot, options.controlRoot ? {} : {
          createdAt: version.createdAt,
          updatedAt: version.createdAt,
        });
    if (options.evalHash && options.evalHash !== evalSnapshot.hash) {
      throw new WorkbenchUserError(`Eval snapshot ${options.evalHash} is not authored by version ${version.id}.`);
    }
    const suppliedAgents = options.agents && options.agents.length > 0
      ? options.agents.map(copyAgent)
      : null;
    const agents = suppliedAgents ?? await readAgents(controlRoot);
    const defaultAgent = suppliedAgents
      ? runtimeDefaultAgentForSuppliedAgents(suppliedAgents, options.defaultAgent)
      : await readDefaultAgentSelection(controlRoot, agents);
    if (!defaultAgent) {
      throw new WorkbenchUserError(`No agents configured in ${path.join(".workbench", AGENTS_FILE)}. Run \`${providerAgentSetupCommand("codex", "default")}\`.`);
    }
    const selectedAgents = resolveNamedSelection(agents, options.agent, defaultAgent, "agent", options.selectionRemediationCommand);
    const transientState: WorkbenchProjectState = {
      schema: STATE_SCHEMA,
      root: controlRoot,
      refs: { current: version.id },
      remotes: {},
      versions: [copyVersion(version)],
      skillSources: options.skillSources ? options.skillSources.map(copySkillSource) : [],
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
      root: controlRoot,
      state: transientState,
      version,
      selection: options.skill,
      authToken: options.authToken,
      remediationCommand: options.selectionRemediationCommand,
      ...(options.skillSources ? { skillSources: options.skillSources } : {}),
      ...(options.defaultSkill ? { defaultSkill: options.defaultSkill } : {}),
    });
    const defaultSkill = options.defaultSkill ?? await readDefaultSkillSelection(controlRoot, transientState.skillSources);
    const cases = options.cases
      ? options.cases.map((entry) => ({ ...entry, files: entry.files.map(copyFile) }))
      : await readEvalCases(controlRoot);
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
      ...(await Promise.resolve(options.environmentDockerfile ?? readOptionalSkillEvalEnvironmentDockerfile(controlRoot)).then((dockerfile) =>
        dockerfile ? { environmentDockerfile: dockerfile } : {}
      )),
    };
  });
}

async function readOptionalSkillEvalEnvironmentDockerfile(root: string): Promise<string | undefined> {
  try {
    return await readSkillEvalEnvironmentDockerfile(root);
  } catch (error) {
    if (isMissingSkillEvalEnvironmentDockerfileError(error)) {
      return undefined;
    }
    throw error;
  }
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

export async function improveWorkbenchSkill(options: WorkbenchImproveOptions = {}): Promise<WorkbenchImproveResult> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    let state = await loadState(root);
    const context = await resolveWorkbenchImproveContext(root, state, options);
    let { base } = context;
    const {
      runtime,
      runtimeSelection,
      skillBundle,
      evalAgent,
      historicalTraces,
      improvementEvidence,
    } = context;
    for (const bundle of runtime.skillBundles) {
      upsertByHash(state.skillBundles, bundle);
    }
    upsertAgentSnapshots(state.agents, runtime.agents);
    if (!workbenchSkillImproveCanUseQueuedAdapter(evalAgent)) {
      throw workbenchSkillImproveAdapterRequirementError(evalAgent, state.agents);
    }
    if ((options.location ?? "local") === "local") {
      await assertLocalWorkbenchLaunchReady(root, [evalAgent], options);
    }
    const environmentDockerfile = runtime.environmentDockerfile ?? await readSkillEvalEnvironmentDockerfile(root);
    if (!options.version) {
      base = await resolveOrCreateRunVersion(root, state);
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
      role: "improve",
      inputHash: hashWorkbenchImproveInput({
        baseVersionId: base.id,
        skillBundleHash: skillBundle.hash,
        evalHash: evalSnapshot.hash,
        agentHash: run.agentHash,
        evidenceTraceIds: historicalTraces.map((trace) => trace.id),
        samples: proofSamples,
        budget: options.budget ?? 1,
      }),
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
        environmentDockerfile,
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
        await writeWorkbenchTraceRecord(objects.trace, { projectRoot: root });
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
    await writeWorkbenchTraceRecord(improveObjects.trace, { projectRoot: root });
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
      controlRoot: root,
      skill: CURRENT_SKILL_VERSION_NAME,
      agent: evalAgent.name,
      authToken: options.authToken,
      selectionRemediationCommand: "improve",
      environmentDockerfile,
      ...runtimeSelection,
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
      environmentDockerfile,
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
        remediation: adapterAuthRemediationFromError(proofRun.error) ?? `workbench eval show ${proofRun.id}`,
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
  const {
    source,
    base,
    runtime,
    skillBundle,
    evalAgent,
    historicalTraces,
    improvementEvidence,
  } = await resolveWorkbenchImproveContext(root, state, options);
  const canImproveWithSelectedAgent = workbenchSkillImproveCanUseQueuedAdapter(evalAgent);
  const readiness = canImproveWithSelectedAgent
    ? options.cloud === true
      ? await cloudWorkbenchLaunchReadiness(root)
      : await localWorkbenchLaunchReadiness(root, [evalAgent], options)
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
  evidenceAccess: "full" | "package";
  evalRef?: string;
  handle?: string;
  skillName?: string;
}

export function createWorkbenchActionCapabilities(
  snapshot: WorkbenchInspectionSnapshot,
  options: WorkbenchActionCapabilitiesOptions,
): WorkbenchActionCapabilities {
  const selectedEval = snapshotEvalSelection(snapshot, options.evalRef);
  const defaultImproveRequest = defaultWorkbenchOperationRequest(snapshot, "improve", options.variant, selectedEval);
  const fullAccess = options.evidenceAccess === "full";
  const selectedEvalSnapshot = snapshot.evals.find((entry) => entry.hash === selectedEval?.hash);
  const cloudRuntimeReady = options.variant !== "cloud" || Boolean(
    (snapshot.refs.current ?? latestSnapshotVersionId(snapshot)) && snapshot.status.defaultAgent &&
    selectedEvalSnapshot?.files.some((file) => file.path === `${ENVIRONMENT_DIR}/Dockerfile`)
  );
  const unavailableReason = !selectedEval
    ? options.evalRef ? `Eval ${options.evalRef} is not available.` : "No Eval is available."
    : selectedEval.caseIds.length === 0 ? "This Eval has no cases."
    : !cloudRuntimeReady
      ? "This Eval is ready for review. Sync an authored Skill with a current version, default agent, and evaluation environment before running it."
      : undefined;
  const enabled = fullAccess && !unavailableReason;
  const improveEnabled = enabled && hasActionableImproveEvidence(snapshot, selectedEval?.hash);
  const capability = (defaultRequest: WorkbenchOperationRequest, action: string) => ({
    enabled, defaultRequest,
    ...(enabled ? {} : { disabledReason: fullAccess ? unavailableReason! : `Package-only pages cannot start ${action}.` }),
  });
  return {
    variant: options.variant,
    evidenceAccess: options.evidenceAccess,
    run: capability(defaultWorkbenchOperationRequest(snapshot, "run", options.variant, selectedEval), "runs"),
    grade: capability(defaultWorkbenchOperationRequest(snapshot, "grade", options.variant, selectedEval), "grading"),
    eval: capability(defaultWorkbenchOperationRequest(snapshot, "eval", options.variant, selectedEval), "evaluations"),
    improve: {
      enabled: improveEnabled,
      defaultRequest: defaultImproveRequest,
      ...(improveEnabled
        ? {}
        : { disabledReason: fullAccess ? unavailableReason ?? workbenchImproveEvidenceRequirementMessage() : "Package-only pages cannot start improvements." }),
    },
    acquisition: workbenchAcquisitionOptions(snapshot, options),
  };
}

async function executeLocalWorkbenchOperation(
  options: WorkbenchCommandOptions & {
    request: WorkbenchOperationRequest;
    onRunStarted?: (run: WorkbenchRun) => void | Promise<void>;
  },
): Promise<WorkbenchRunSnapshot> {
  const request = normalizeWorkbenchOperationRequest(options.request);
  let notifiedStarted = false;
  const onRunStarted = async (run: WorkbenchRun): Promise<void> => {
    if (notifiedStarted) {
      return;
    }
    notifiedStarted = true;
    await options.onRunStarted?.(run);
  };
  const evalOperationOptions = request.kind === "eval" ? {
    dir: options.dir,
    authToken: options.authToken,
    adapterAuthStoreRoot: options.adapterAuthStoreRoot,
    homeDir: options.homeDir,
    env: options.env,
    evalHash: request.evalHash,
    version: operationTargetVersionId(request.targets),
    skill: operationTargetSkillSelector(request.targets),
    agent: operationTargetAgentSelector(request.targets),
    caseIds: request.caseIds,
    samples: request.samples,
    rerun: request.rerun,
    location: "local" as const,
    operationTargets: request.targets,
    operationSteps: request.steps,
    gradeOfRunId: request.gradeOfRunId,
    retryOfRunId: request.retryOfRunId,
    onRunStarted,
  } : undefined;
  const runs = request.kind === "eval"
    ? request.steps.includes("grade") && !request.steps.includes("run")
      ? await gradeWorkbenchSkill({
          ...evalOperationOptions!,
          kind: "grade",
        })
      : await evalWorkbenchSkill({
          ...evalOperationOptions!,
          kind: runKindForOperationSteps(request.steps),
        })
    : [(
        await improveWorkbenchSkill({
          dir: options.dir,
          authToken: options.authToken,
          adapterAuthStoreRoot: options.adapterAuthStoreRoot,
          homeDir: options.homeDir,
          env: options.env,
          version: request.versionId ?? (request.target ? operationTargetVersionId([request.target]) : undefined),
          skill: request.target?.skill,
          agent: request.target?.agent,
          samples: request.samples,
          budget: request.budget,
          evidenceTraceIds: request.evidenceTraceIds,
          location: "local",
          retryOfRunId: request.retryOfRunId,
          onRunStarted,
        })
        ).run];
  const cursor = await readWorkbenchReadOnlyInspectionCursor(options).catch(() => undefined);
  const state = await loadState(resolveRoot(options.dir)).catch(() => undefined);
  return createWorkbenchRunSnapshot(request, runs, {
    cursor,
    jobs: state?.jobs ?? [],
    traces: state?.traces ?? [],
  });
}

export interface WorkbenchLocalOperationSupervisor {
  started: Promise<WorkbenchRunSnapshot>;
  completed: Promise<WorkbenchRunSnapshot>;
}

export function superviseLocalWorkbenchOperation(
  options: WorkbenchCommandOptions & { request: WorkbenchOperationRequest },
): WorkbenchLocalOperationSupervisor {
  const request = normalizeWorkbenchOperationRequest(options.request);
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
  const steps = commonStringArrays(plans.map((plan) => plan.steps));
  const targets = commonJsonArray(plans.map((plan) => plan.targets));
  return {
    kind: first.kind,
    variant: first.variant,
    ...(targets ? { targets: (targets as WorkbenchOperationTarget[]).map(copyWorkbenchOperationTarget) } : {}),
    ...(steps ? { steps: steps as WorkbenchOperationStep[] } : {}),
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

function commonJsonArray<T>(values: readonly (readonly T[] | undefined)[]): T[] | undefined {
  if (values.some((value) => value === undefined)) {
    return undefined;
  }
  const present = values as readonly (readonly T[])[];
  const [first] = present;
  if (!first) {
    return undefined;
  }
  const firstHash = hashJson(first);
  return present.every((value) => hashJson(value) === firstHash)
    ? JSON.parse(JSON.stringify(first)) as T[]
    : undefined;
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

export function createWorkbenchRunSnapshot(
  request: WorkbenchOperationRequest,
  runs: readonly WorkbenchRun[],
  options: {
    cursor?: string;
    jobs?: readonly WorkbenchJob[];
    traces?: readonly WorkbenchTrace[];
    now?: string;
    plan?: WorkbenchOperationPlanSummary;
  } = {},
): WorkbenchRunSnapshot {
  const firstRun = runs[0];
  if (!firstRun) {
    throw new WorkbenchCodedError("operation_run_missing", `Workbench ${request.kind} did not create a run.`, {
      retryable: true,
      remediation: request.kind === "eval" ? "workbench eval run" : "workbench skill improve",
      exitCode: 1,
    });
  }
  const normalized = normalizeWorkbenchOperationRequest(request);
  const jobs = options.jobs ?? [];
  const traces = options.traces ?? [];
  const runJobs = jobsForSnapshotRuns(runs, jobs);
  const reportOptions = { now: options.now ?? now() };
  const result = runSnapshotResultSummary(runs, jobs);
  const persistedPlan = options.plan ?? operationPlanSummaryForSnapshotRuns(runs);
  const plan = persistedPlan
    ? copyOperationPlanSummary(persistedPlan)
    : {
        kind: normalized.kind === "improve" ? "improve" : runKindForOperationSteps(normalized.steps),
        variant: normalized.variant,
        ...(normalized.kind === "improve" && normalized.versionId ? { versionId: normalized.versionId } : { versionId: firstRun.versionId }),
        ...(normalized.kind === "improve" && normalized.evalHash ? { evalHash: normalized.evalHash } : { evalHash: firstRun.evalHash }),
        ...(normalized.kind === "eval" ? {
          targets: normalized.targets.map(copyWorkbenchOperationTarget),
          steps: [...normalized.steps],
        } : {}),
        skills: [...new Set(runs.map((run) => run.skillName))],
        agents: [...new Set(runs.map((run) => run.agentName))],
        ...(normalized.kind === "eval" && normalized.caseIds.length
          ? { caseIds: [...normalized.caseIds] }
          : {}),
        ...(normalized.samples !== undefined ? { samples: normalized.samples } : {}),
        ...(normalized.kind === "eval" && normalized.rerun ? { rerun: true } : {}),
        ...(normalized.kind === "improve" && normalized.budget !== undefined ? { budget: normalized.budget } : {}),
        ...(normalized.retryOfRunId ? { retryOfRunId: normalized.retryOfRunId } : {}),
      } satisfies WorkbenchOperationPlanSummary;
  const next = runSnapshotNext(firstRun, plan);
  return {
    schema: "workbench.run.v1",
    id: firstRun.id,
    kind: plan.kind,
    variant: plan.variant,
    status: aggregateRunStatus(runs),
    phase: runPhaseForRuns(runs),
    plan,
    progress: runProgressSummary(runs, jobs, reportOptions),
    report: buildWorkbenchJobReport(runJobs, traces, reportOptions),
    measurements: runMeasurementSummaries(runs, jobs, traces, reportOptions),
    ...(result ? { result } : {}),
    ...(firstRun.retryOfRunId ? { retryOfRunId: firstRun.retryOfRunId } : {}),
    route: {
      kind: "run",
      runId: firstRun.id,
    },
    ...(options.cursor ? { cursor: options.cursor } : {}),
    cliEquivalent: workbenchOperationPlanCliEquivalent(plan),
    ...(next ? { next } : {}),
  };
}

export function createWorkbenchRunSnapshotForRun(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[] = [],
  options: { cursor?: string; traces?: readonly WorkbenchTrace[]; now?: string } = {},
): WorkbenchRunSnapshot {
  const plan = run.operationPlan ? copyOperationPlanSummary(run.operationPlan) : undefined;
  return createWorkbenchRunSnapshot(operationRequestFromRunPlan(run, plan), [run], { ...options, jobs, ...(plan ? { plan } : {}) });
}

function operationRequestFromRunPlan(
  run: WorkbenchRun,
  plan: WorkbenchOperationPlanSummary | undefined,
): WorkbenchOperationRequest {
  if ((plan?.kind ?? run.kind) === "improve") {
    return {
      kind: "improve",
      variant: plan?.variant ?? run.location ?? "local",
      target: operationTargetFromPlan(plan ?? {
        versionId: run.versionId,
        skills: [run.skillName],
        agents: [run.agentName],
      }),
      versionId: plan?.versionId ?? run.versionId,
      evalHash: plan?.evalHash ?? run.evalHash,
      ...(plan?.samples !== undefined ? { samples: plan.samples } : run.requestedSamples !== undefined ? { samples: run.requestedSamples } : {}),
      ...(plan?.budget !== undefined ? { budget: plan.budget } : run.requestedBudget !== undefined ? { budget: run.requestedBudget } : {}),
      ...(plan?.retryOfRunId ? { retryOfRunId: plan.retryOfRunId } : run.retryOfRunId ? { retryOfRunId: run.retryOfRunId } : {}),
    };
  }
  const kind = normalizeWorkbenchCaseRunKind(plan?.kind ?? run.kind, "eval");
  const steps = plan?.steps ?? stepsForRunKind(kind);
  return {
    kind: "eval",
    variant: plan?.variant ?? run.location ?? "local",
    evalHash: plan?.evalHash ?? run.evalHash,
    caseIds: plan?.caseIds ?? [],
    targets: plan?.targets ?? operationTargetsFromPlan(plan ?? {
      versionId: run.versionId,
      skills: [run.skillName],
      agents: [run.agentName],
    }),
    steps,
    ...(plan?.samples !== undefined ? { samples: plan.samples } : run.requestedSamples !== undefined ? { samples: run.requestedSamples } : {}),
    ...(plan?.rerun ? { rerun: true } : {}),
    ...(plan?.retryOfRunId ? { retryOfRunId: plan.retryOfRunId } : run.retryOfRunId ? { retryOfRunId: run.retryOfRunId } : {}),
  };
}

export function workbenchRunFromSnapshot(
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
  if (plan.kind === "improve") {
    return workbenchOperationCliEquivalent({
      kind: "improve",
      variant: plan.variant,
      target: operationTargetFromPlan(plan),
      ...(plan.versionId ? { versionId: plan.versionId } : {}),
      ...(plan.evalHash ? { evalHash: plan.evalHash } : {}),
      ...(plan.samples !== undefined ? { samples: plan.samples } : {}),
      ...(plan.budget !== undefined ? { budget: plan.budget } : {}),
      ...(plan.retryOfRunId ? { retryOfRunId: plan.retryOfRunId } : {}),
    });
  }
  const kind = normalizeWorkbenchCaseRunKind(plan.kind, "eval");
  return workbenchOperationCliEquivalent({
    kind: "eval",
    variant: plan.variant,
    ...(plan.evalHash ? { evalHash: plan.evalHash } : {}),
    caseIds: plan.caseIds ?? [],
    targets: plan.targets ?? operationTargetsFromPlan(plan),
    steps: plan.steps ?? stepsForRunKind(kind),
    ...(plan.samples !== undefined ? { samples: plan.samples } : {}),
    ...(plan.rerun ? { rerun: true } : {}),
    ...(plan.retryOfRunId ? { retryOfRunId: plan.retryOfRunId } : {}),
  });
}

export function workbenchOperationCliEquivalent(request: WorkbenchOperationRequest): string {
  const normalized = normalizeWorkbenchOperationRequest(request);
  const command = normalized.kind === "improve"
    ? ["skill", "improve"]
    : ["eval", runKindForOperationSteps(normalized.steps) === "grade" ? "grade" : "run"];
  const parts = ["workbench", ...command];
  if (normalized.variant === "cloud") {
    parts.push("--cloud");
  }
  const targets = normalized.kind === "improve"
    ? normalized.target ? [normalized.target] : []
    : normalized.targets;
  const skillSelector = operationTargetSkillSelector(targets);
  const agentSelector = operationTargetAgentSelector(targets);
  if (skillSelector) {
    parts.push("--versions", quoteShellArg(skillSelector));
  }
  if (agentSelector) {
    parts.push("--agents", quoteShellArg(agentSelector));
  }
  if (normalized.kind === "eval" && normalized.caseIds.length > 0) {
    parts.push("--cases", quoteShellArg(normalized.caseIds.join(",")));
  }
  if (normalized.samples && normalized.samples !== 1) {
    parts.push("-n", String(normalized.samples));
  }
  if (normalized.kind === "eval" && normalized.rerun) {
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
  options: { now?: string } = {},
): WorkbenchRunSnapshot["progress"] {
  const runJobs = jobsForSnapshotRuns(runs, jobs);
  const caseJobs = runJobs.filter((job) => job.caseId !== "current");
  const selectedJobs = caseJobs.length > 0 ? caseJobs : runJobs;
  const completedJobs = selectedJobs.filter((job) => isWorkbenchJobStatusTerminal(job.status));
  const scoredJobs = selectedJobs.filter((job) => workbenchJobScore(job) !== undefined);
  const failedJobs = selectedJobs.filter((job) => job.status === "failed");
  const canceledJobs = selectedJobs.filter((job) => job.status === "canceled");
  const activeJobs = selectedJobs.filter((job) => job.status === "running");
  const firstRun = runs[0];
  const observedAt = runs.every((run) => isWorkbenchRunStatusTerminal(run.status))
    ? latestRunObservedAt(runs, selectedJobs)
    : options.now ?? latestRunObservedAt(runs, selectedJobs);
  const startedAt = firstRun?.createdAt ?? observedAt ?? now();
  const score = scoredJobs.length > 0
    ? averageScores(scoredJobs.map(workbenchJobScore))
    : undefined;
  const observedAtMs = timestampMs(observedAt ?? now()) ?? Date.now();
  const startedAtMs = timestampMs(startedAt) ?? observedAtMs;
  const lastProgressAt = latestRunProgressAt(runs, selectedJobs);
  const observedPlanned = selectedJobs.length > 0
    ? selectedJobs.length
    : runs.reduce((sum, run) => sum + run.jobIds.length, 0);
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
    ...(!runs.every((run) => isWorkbenchRunStatusTerminal(run.status)) && score !== undefined ? { partialScore: score } : {}),
    evidenceCount: runs.reduce((sum, run) => sum + run.traceIds.length + run.jobIds.length, 0),
    elapsedMs: Math.max(0, observedAtMs - startedAtMs),
    ...(lastProgressAt ? { lastProgressAt } : {}),
  };
}

function jobsForSnapshotRuns(
  runs: readonly WorkbenchRun[],
  jobs: readonly WorkbenchJob[],
): WorkbenchJob[] {
  const jobIds = new Set(runs.flatMap((run) => run.jobIds));
  return jobs.filter((job) => jobIds.has(job.id));
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
  const targetCount = Math.max(1, plan.targets?.length ?? (plan.skills.length * plan.agents.length));
  const stepCount = Math.max(1, plan.steps?.length ?? (plan.kind === "eval" ? 2 : 1));
  return caseCount * samples * targetCount * stepCount;
}

function runMeasurementSummary(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
  traces: readonly WorkbenchTrace[] = [],
  reportOptions: { now?: string } = {},
): WorkbenchMeasurementSummary {
  const runJobs = jobs.filter((job) => workbenchRunOwnsJob(run, job) && job.caseId !== "current");
  const score = aggregateJobScore(runJobs);
  const coverage = workbenchSampleCoverageForJobs(runJobs);
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
    ...(coverage ? { coverage } : {}),
    ...(runJobs.length > 0 ? { report: buildWorkbenchJobReport(runJobs, traces, reportOptions) } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

function runMeasurementSummaries(
  runs: readonly WorkbenchRun[],
  jobs: readonly WorkbenchJob[],
  traces: readonly WorkbenchTrace[] = [],
  reportOptions: { now?: string } = {},
): WorkbenchMeasurementSummary[] {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const jobsByMeasurement = new Map<string, {
    run: WorkbenchRun;
    jobs: WorkbenchJob[];
    versionId: string;
    evalHash: string;
  }>();
  for (const run of runs) {
    for (const jobId of run.jobIds) {
      const job = jobsById.get(jobId);
      if (!job || job.caseId === "current") {
        continue;
      }
      const versionId = run.operationPlan?.versionId ?? run.versionId;
      const evalHash = run.operationPlan?.evalHash ?? run.evalHash;
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
  }
  const measuredRunIds = new Set<string>();
  const measurements = [...jobsByMeasurement.values()].map(({ run, jobs: measurementJobs, versionId, evalHash }) => {
    measuredRunIds.add(run.id);
    return runMeasurementSummaryFromJobs(run, measurementJobs, traces, reportOptions, { versionId, evalHash });
  });
  for (const run of runs) {
    if (!measuredRunIds.has(run.id)) {
      measurements.push(runMeasurementSummary(run, jobs, traces, reportOptions));
    }
  }
  return measurements;
}

function runMeasurementSummaryFromJobs(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
  traces: readonly WorkbenchTrace[] = [],
  reportOptions: { now?: string } = {},
  options: { versionId?: string; evalHash?: string } = {},
): WorkbenchMeasurementSummary {
  const [firstJob] = jobs;
  if (!firstJob) {
    return runMeasurementSummary(run, jobs, traces, reportOptions);
  }
  const scoredJobs = jobs.filter((job) => workbenchJobScore(job) !== undefined);
  const coverage = workbenchSampleCoverageForJobs(jobs);
  const errors = jobs.flatMap((job) => job.error ? [job.error] : []);
  const status = workbenchRunStatusFromJobs(jobs, run.status);
  const score = status === "canceled" || scoredJobs.length === 0
    ? undefined
    : averageScores(scoredJobs.map(workbenchJobScore));
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
    ...(coverage ? { coverage } : {}),
    report: buildWorkbenchJobReport(jobs, traces, reportOptions),
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
  const improveJobIds = new Set(runs.filter((run) => run.kind === "improve").flatMap((run) => run.jobIds));
  const baseVersionIds = new Set(runs.map((run) => run.operationPlan?.versionId ?? run.baseVersionId ?? run.versionId));
  return jobs.find((job) =>
    improveJobIds.has(job.id) &&
    job.kind === "improve" &&
    job.caseId !== "current" &&
    !baseVersionIds.has(job.versionId)
  )?.versionId;
}

function runSnapshotNext(run: WorkbenchRun, plan: WorkbenchOperationPlanSummary | undefined = run.operationPlan): string | undefined {
  if (run.status === "queued" || run.status === "running" || run.status === "canceling") {
    return `workbench watch ${run.id}`;
  }
  if (run.status === "failed" || run.status === "canceled") {
    return undefined;
  }
  if (run.kind === "run") {
    return workbenchRunTransitionCliEquivalent(run, "grade", plan ? { plan } : {});
  }
  if (run.kind === "improve") {
    return workbenchRunTransitionCliEquivalent(run, "eval", {
      ...(plan ? { plan } : {}),
      rerun: true,
      samples: 5,
    });
  }
  return workbenchRunResultsCliEquivalent(run);
}

export function workbenchRunResultsCliEquivalent(run: WorkbenchRun): string {
  const parts = ["workbench eval results"];
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

export function workbenchRunTransitionCliEquivalent(
  run: WorkbenchRun,
  kind: "grade" | "eval",
  options: { plan?: WorkbenchOperationPlanSummary; rerun?: boolean; samples?: number } = {},
): string {
  const plan = options.plan ?? run.operationPlan;
  return workbenchOperationCliEquivalent({
    kind: "eval",
    variant: plan?.variant ?? run.location ?? "local",
    caseIds: plan?.caseIds ?? [],
    targets: plan?.targets ?? operationTargetsFromPlan(plan ?? {
      kind: run.kind,
      variant: run.location ?? "local",
      versionId: run.versionId,
      evalHash: run.evalHash,
      skills: [run.skillName],
      agents: [run.agentName],
    }),
    steps: stepsForRunKind(kind),
    samples: options.samples ?? plan?.samples ?? run.requestedSamples ?? 1,
    ...(options.rerun ? { rerun: true } : {}),
  });
}

function aggregateJobScore(jobs: readonly WorkbenchJob[]): number | undefined {
  return averageScores(jobs.map(workbenchJobScore));
}

export function runQualityScoreFromJobs(
  run: Pick<WorkbenchRun, "status" | "jobIds">,
  jobs: readonly WorkbenchJob[],
): number | undefined {
  if (run.status === "canceled") {
    return undefined;
  }
  return aggregateJobScore(jobs.filter((job) => workbenchRunOwnsJob(run, job) && job.role === "grade"));
}

function averageScores(values: readonly (number | undefined)[]): number | undefined {
  const scores = values.filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  if (scores.length === 0) {
    return undefined;
  }
  return Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(3));
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

function defaultWorkbenchOperationRequest(
  snapshot: WorkbenchInspectionSnapshot,
  kind: WorkbenchSchedulableRunKind,
  variant: WorkbenchOperationVariant,
  selectedEval: { hash: string; caseIds: string[] } | undefined,
): WorkbenchOperationRequest {
  const versionId = variant === "cloud" ? snapshot.refs.current ?? latestSnapshotVersionId(snapshot) : undefined;
  const evalHash = selectedEval?.hash;
  const target: WorkbenchOperationTarget = {
    ...(versionId ? { versionId } : {}),
  };
  if (kind === "improve") {
    return {
      kind: "improve",
      variant,
      target,
      ...(versionId ? { versionId } : {}),
      ...(evalHash ? { evalHash } : {}),
      samples: 1,
      budget: 1,
    };
  }
  return {
    kind: "eval",
    variant,
    ...(evalHash ? { evalHash } : {}),
    caseIds: selectedEval?.caseIds ?? [],
    targets: [target],
    steps: stepsForRunKind(kind),
    samples: 1,
  };
}

function latestSnapshotVersionId(snapshot: WorkbenchInspectionSnapshot): string | undefined {
  return snapshot.versions
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0]
    ?.id;
}

function snapshotEvalSelection(
  snapshot: WorkbenchInspectionSnapshot,
  ref?: string,
): { hash: string; caseIds: string[] } | undefined {
  const hash = ref === undefined
    ? snapshot.evals
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.hash.localeCompare(left.hash))[0]
        ?.hash
    : snapshot.evalVersions.find((entry) => entry.id === ref || entry.hash === ref)?.hash ??
      snapshot.evals.find((entry) => entry.hash === ref)?.hash;
  const selected = hash ? snapshot.evals.find((entry) => entry.hash === hash) : undefined;
  return selected ? { hash: selected.hash, caseIds: selected.cases.map((entry) => entry.id) } : undefined;
}

function hasActionableImproveEvidence(snapshot: WorkbenchInspectionSnapshot, evalHash?: string): boolean {
  return snapshot.runs.some((run) =>
    run.kind === "eval" &&
    (!evalHash || run.evalHash === evalHash) &&
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
  const handle = snapshot.publication ? options.handle ?? snapshot.publication.installHandle : undefined;
  if (handle) {
    acquisition.push({
      id: "install-package",
      label: "Install package",
      kind: "copy-command",
      value: `workbench skill install ${handle}`,
    });
    acquisition.push({
      id: "editable-source",
      label: "Create editable project",
      kind: "copy-command",
      value: `workbench skill clone ${handle} ${normalizeWorkbenchSkillName(options.skillName ?? handle.split("/").at(-1) ?? "skill") || "skill"}`,
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

export async function requestLocalWorkbenchRunCancellation(
  options: WorkbenchCommandOptions & { runId: string; reason?: string },
): Promise<WorkbenchRunCancellationResult> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  const loadedState = await loadStateReadOnlyWithRetry(root);
  const state = await applyLocalRunCancellationRequests(root, loadedState);
  const run = state.runs.find((entry) => entry.id === options.runId);
  if (!run) {
    throw new WorkbenchCodedError("run_not_found", `Run not found: ${options.runId}`, {
      remediation: "workbench eval results",
      subject: { runId: options.runId },
      exitCode: 1,
    });
  }
  if (isWorkbenchRunStatusTerminal(run.status)) {
    throw new WorkbenchCodedError("run_terminal", `Run ${run.id} is already ${run.status}.`, {
      remediation: `workbench eval show ${run.id}`,
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
    if (!lockedRun || isWorkbenchRunStatusTerminal(lockedRun.status)) {
      return;
    }
    upsertRunObject(lockedState.runs, runWithLocalCancellationRequest(lockedRun, requestedAt), { replace: true });
    await saveState(root, lockedState);
  });
  return { run: copyRun(cancelingRun), requestedAt, requestPath };
}

export async function readWorkbenchPendingCloudOperation(
  options: WorkbenchCommandOptions & { operationId: string },
): Promise<WorkbenchPendingCloudOperation | null> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  const operationPath = pendingCloudOperationPath(root, options.operationId);
  if (!await exists(operationPath)) {
    return null;
  }
  const value = asRecord(await readJson(operationPath));
  if (
    value?.schema !== "workbench.pending-cloud-operation.v1" ||
    typeof value.id !== "string" ||
    typeof value.command !== "string" ||
    typeof value.remoteName !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    throw new WorkbenchUserError(`Invalid pending Cloud operation: ${operationPath}`);
  }
  return value as unknown as WorkbenchPendingCloudOperation;
}

export async function recordWorkbenchPendingCloudOperation(
  options: WorkbenchCommandOptions & { operation: WorkbenchPendingCloudOperation },
): Promise<WorkbenchPendingCloudOperation> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  await writeJson(pendingCloudOperationPath(root, options.operation.id), options.operation);
  return { ...options.operation };
}

export async function clearWorkbenchPendingCloudOperation(
  options: WorkbenchCommandOptions & { operationId: string },
): Promise<void> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  await Promise.all([
    fs.rm(pendingCloudOperationPath(root, options.operationId), { force: true }),
    fs.rm(localRunCancellationRequestPath(root, options.operationId), { force: true }),
  ]);
}

export async function hasWorkbenchLocalRunCancellationRequest(
  options: WorkbenchCommandOptions & { runId: string },
): Promise<boolean> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  return await hasLocalRunCancellationRequest(root, options.runId);
}

export async function requestWorkbenchPendingCloudOperationCancellation(
  options: WorkbenchCommandOptions & { operationId: string; reason?: string },
): Promise<WorkbenchPendingCloudOperationCancellation> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  const operation = await readWorkbenchPendingCloudOperation(options);
  if (!operation) {
    throw new WorkbenchCodedError("run_not_found", `Pending Cloud operation not found: ${options.operationId}`, {
      remediation: "workbench eval results",
      exitCode: 1,
    });
  }
  const requestedAt = now();
  const requestPath = await writeLocalRunCancellationRequest(root, {
    runId: operation.id,
    requestedAt,
    reason: options.reason ?? "user_requested",
  });
  return { operation, requestedAt, requestPath };
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
      const copied = copyTrace(trace);
      await writeWorkbenchTraceRecord(copied, { projectRoot: root });
      upsertById(state.traces, copied);
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
      "workbench skill improve requires exactly one version and one eval agent.",
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
    throw new WorkbenchUserError("workbench skill improve can edit only the current local project skill. Vendor or clone another skill before improving it.");
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
  return "workbench skill improve needs graded below-perfect, failed, or reviewed eval evidence for the selected skill on this eval. Perfect eval runs do not qualify. Ungraded runtime or auth failures do not qualify. Add or edit an eval case that captures an actual failure, review a run as improvement evidence, or edit the package source directly.";
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
    const latestTerminal = currentEvalRuns.find((run) => isWorkbenchRunStatusTerminal(run.status));
    return latestTerminal ? `workbench eval show ${latestTerminal.id}` : workbenchImproveEvidenceEvalCommand(args);
  }
  return nextWorkbenchEvalCaseCommand(args.cases);
}

function workbenchImproveEvidenceEvalCommand(args: {
  agentName?: string;
  preserveAgentSelection?: boolean;
}): string {
  if (args.preserveAgentSelection && args.agentName) {
    return `workbench eval run --agents ${quoteShellArg(args.agentName)}`;
  }
  return "workbench eval run";
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
    return `workbench skill improve --versions ${version} --agents ${agent}`;
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
    remediation: "workbench eval results --versions current",
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

function resultEvalVersionSummaries(
  state: WorkbenchProjectState,
  currentEvalHash?: string,
  includeEvalHashes: readonly string[] = [],
): WorkbenchEvalVersionSummary[] {
  const versionedEvalHashes = resultEvalVersionHashes(state);
  if (currentEvalHash) {
    versionedEvalHashes.add(currentEvalHash);
  }
  for (const hash of includeEvalHashes) {
    versionedEvalHashes.add(hash);
  }
  const orderedEvals = orderResultEvalSnapshots(state.evals)
    .filter((evalSnapshot) => versionedEvalHashes.has(evalSnapshot.hash));
  const latestRunByEvalHash = new Map<string, WorkbenchRun>();
  const runCountByEvalHash = new Map<string, number>();
  for (const run of [...state.runs].sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    runCountByEvalHash.set(run.evalHash, (runCountByEvalHash.get(run.evalHash) ?? 0) + 1);
    latestRunByEvalHash.set(run.evalHash, run);
  }
  const latestVersionedRun = [...state.runs]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .find((run) => versionedEvalHashes.has(run.evalHash));
  const currentHash = currentEvalHash && versionedEvalHashes.has(currentEvalHash)
    ? currentEvalHash
    : latestVersionedRun?.evalHash ?? orderedEvals.at(-1)?.hash;
  return orderedEvals.map((evalSnapshot, index) => {
    const ordinal = index + 1;
    const latestRun = latestRunByEvalHash.get(evalSnapshot.hash);
    const latestQuality = latestRun ? runQualityScoreFromJobs(latestRun, state.jobs) : undefined;
    return {
      id: `${EVAL_VERSION_REF_PREFIX}${ordinal}`,
      hash: evalSnapshot.hash,
      label: `Eval v${ordinal}`,
      ordinal,
      current: evalSnapshot.hash === currentHash,
      caseCount: evalSnapshot.caseCount,
      gradeAdapter: evalSnapshot.grade.adapter,
      createdAt: evalSnapshot.createdAt,
      updatedAt: evalSnapshot.updatedAt,
      runCount: runCountByEvalHash.get(evalSnapshot.hash) ?? 0,
      ...(latestRun ? { latestRunId: latestRun.id } : {}),
      ...(latestQuality !== undefined ? { latestQuality } : {}),
    };
  });
}

function resultEvalVersionHashes(state: WorkbenchProjectState): Set<string> {
  const hashes = new Set<string>();
  for (const run of state.runs) {
    hashes.add(run.evalHash);
  }
  for (const job of state.jobs) {
    hashes.add(job.evalHash);
  }
  return hashes;
}

function orderResultEvalSnapshots(evals: readonly WorkbenchEvalSnapshot[]): WorkbenchEvalSnapshot[] {
  return [...evals].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) ||
    left.updatedAt.localeCompare(right.updatedAt) ||
    left.hash.localeCompare(right.hash)
  );
}

function resultEvalVersionByHash(
  state: WorkbenchProjectState,
  currentEvalHash?: string,
  includeEvalHashes: readonly string[] = [],
): Map<string, WorkbenchEvalVersionSummary> {
  return new Map(resultEvalVersionSummaries(state, currentEvalHash, includeEvalHashes).map((entry) => [entry.hash, entry]));
}

function resolveResultsEvalHashes(
  state: WorkbenchProjectState,
  selection: string | undefined,
  currentEvalHash?: string,
): string[] {
  const summaries = resultEvalVersionSummaries(state, currentEvalHash);
  const normalized = selection?.trim() || CURRENT_EVAL_SELECTOR;
  if (normalized === ALL_SELECTOR) {
    return summaries.map((entry) => entry.hash);
  }
  if (normalized === CURRENT_EVAL_SELECTOR) {
    const currentHash = summaries.find((entry) => entry.current)?.hash ?? summaries.at(-1)?.hash;
    return currentHash ? [currentHash] : [];
  }
  const selectedHashes = normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => resolveEvalVersionHash(summaries, part));
  return [...new Set(selectedHashes)];
}

function resolveEvalVersionHash(
  summaries: readonly WorkbenchEvalVersionSummary[],
  ref: string,
): string {
  const candidates = evalVersionRefCandidates(summaries, ref);
  if (candidates.length === 1) {
    return candidates[0]!.hash;
  }
  if (candidates.length > 1) {
    throw new WorkbenchCodedError("usage", `Eval version ref is ambiguous: ${ref}.`, {
      remediation: "workbench eval list",
      subject: { ref, candidates: candidates.map((entry) => entry.id) },
      exitCode: 2,
    });
  }
  throw new WorkbenchCodedError("usage", `Eval version not found: ${ref}.`, {
    remediation: "workbench eval list",
    subject: { ref, configuredEvalVersions: summaries.map((entry) => entry.id) },
    exitCode: 2,
  });
}

function maybeResolveEvalVersionHash(
  summaries: readonly WorkbenchEvalVersionSummary[],
  ref: string,
): string | undefined {
  const candidates = evalVersionRefCandidates(summaries, ref);
  if (candidates.length > 1) {
    throw new WorkbenchCodedError("usage", `Eval version ref is ambiguous: ${ref}.`, {
      remediation: "workbench eval list",
      subject: { ref, candidates: candidates.map((entry) => entry.id) },
      exitCode: 2,
    });
  }
  return candidates[0]?.hash;
}

function evalVersionRefCandidates(
  summaries: readonly WorkbenchEvalVersionSummary[],
  ref: string,
): WorkbenchEvalVersionSummary[] {
  const normalized = ref.trim();
  if (!normalized) {
    return [];
  }
  const normalizedLabel = normalized.toLowerCase();
  return summaries.filter((entry) =>
    entry.id === normalized ||
    entry.label.toLowerCase() === normalizedLabel ||
    entry.hash === normalized ||
    entry.hash.startsWith(normalized)
  );
}

function evalSnapshotByVersionRef(
  state: WorkbenchProjectState,
  ref: string,
): WorkbenchEvalSnapshot | undefined {
  const hash = maybeResolveEvalVersionHash(resultEvalVersionSummaries(state), ref);
  return hash ? state.evals.find((entry) => entry.hash === hash) : undefined;
}

export async function resultsWorkbench(options: WorkbenchResultsOptions = {}): Promise<WorkbenchResults> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const selection = normalizeWorkbenchResultsSelection(state, options);
    const runtimeSelection = await runtimeSelectionOptionsForRoot(root, state);
    const currentEvalSnapshot = await readEvalSnapshot(root).catch(() => selectActiveEvalSnapshot(state));
    if (currentEvalSnapshot) {
      upsertEvalSnapshotObject(state.evals, currentEvalSnapshot);
    }
    const selectedEvalHashes = resolveResultsEvalHashes(state, options.eval, currentEvalSnapshot?.hash);
    const internalSelection: InternalComparisonSelection = {
      versions: selection.projectVersions,
      skills: selection.skills,
      agents: options.agents,
      evalHashes: selectedEvalHashes,
      availableAgents: runtimeSelection.agents,
      ...(runtimeSelection.defaultAgent ? { defaultAgent: runtimeSelection.defaultAgent } : {}),
    };
    const recordedComparison = buildInternalComparisonFromState(state, internalSelection);
    if (recordedComparison.cells.some((cell) => cell.runId || cell.status)) {
      const completedComparison = await completeRecordedResultsSelectionMatrix(state, recordedComparison, {
        ...options,
        controlRoot: root,
        versions: selection.skills,
        availableAgents: runtimeSelection.agents,
        skillSources: runtimeSelection.skillSources,
        ...(runtimeSelection.defaultAgent ? { defaultAgent: runtimeSelection.defaultAgent } : {}),
        ...(runtimeSelection.defaultSkill ? { defaultSkill: runtimeSelection.defaultSkill } : {}),
      });
      return resultsFromInternalComparison(completedComparison, state, { currentEvalHash: currentEvalSnapshot?.hash });
    }
    const versions = resolveVersionSelection(state, selection.projectVersions);
    if (versions.length === 0) {
      return resultsFromInternalComparison({
        evalHashes: selectedEvalHashes,
        versions: [],
        skills: [],
        agents: [],
        cells: [],
      }, state, { currentEvalHash: currentEvalSnapshot?.hash });
    }
    const cells: InternalComparisonCell[] = [];
    const comparedSkills: WorkbenchSkillBundleSnapshot[] = [];
    const comparedAgents: WorkbenchAgent[] = [];
    const comparedVersions: WorkbenchVersion[] = [];
    const skippedVersions: string[] = [];
    let skippedSelectionError: unknown;
    const evalHashes = new Set<string>(selectedEvalHashes);
    for (const version of versions) {
      let runtime: WorkbenchVersionRuntimeSnapshot;
      try {
        runtime = await createWorkbenchVersionRuntimeSnapshot(version, {
          controlRoot: root,
          skill: selection.skills,
          agent: options.agents,
          authToken: options.authToken,
          selectionRemediationCommand: "results",
          ...runtimeSelection,
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
          const evidence = bestCompatibleEvalEvidence({
            state,
            skillBundle: skill,
            evalSnapshot: runtime.evalSnapshot,
            agent,
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
    return resultsFromInternalComparison({
      evalHashes: [...evalHashes],
      versions: comparedVersions,
      skills: comparedSkills,
      agents: uniqueAgentSnapshots(comparedAgents),
      cells,
    }, state, { currentEvalHash: currentEvalSnapshot?.hash });
  });
}

async function completeRecordedResultsSelectionMatrix(
  state: WorkbenchProjectState,
  comparison: InternalComparison,
  options: Pick<WorkbenchResultsOptions, "versions" | "agents" | "authToken"> & {
    controlRoot?: string;
    availableAgents?: readonly WorkbenchAgent[];
    defaultAgent?: string;
    skillSources?: readonly WorkbenchSkillSource[];
    defaultSkill?: string;
  },
): Promise<InternalComparison> {
  const versions = comparison.versions;
  const cells = [...comparison.cells];
  const skills = [...comparison.skills];
  const agents = [...comparison.agents];
  const constrainedEvalHashes = comparison.evalHashes ? new Set(comparison.evalHashes) : undefined;
  const evalHashes = new Set<string>([
    ...(comparison.evalHashes ?? []),
    ...cells.map((cell) => cell.evalHash),
  ]);
  const existingCellKeys = new Set(cells.map(comparisonCellAxisKey));
  const versionOrder = new Map(versions.map((version, index) => [version.id, index]));
  const defaultAgent = options.defaultAgent ?? defaultWorkbenchAgentSelectionFromState(state);

  for (const version of versions) {
    let runtime: WorkbenchVersionRuntimeSnapshot;
    try {
      runtime = await createWorkbenchVersionRuntimeSnapshot(version, {
        ...(options.controlRoot ? { controlRoot: options.controlRoot } : {}),
        skill: options.versions,
        agent: options.agents,
        authToken: options.authToken,
        selectionRemediationCommand: "results",
        ...(options.skillSources ? { skillSources: options.skillSources } : {}),
        ...(options.defaultSkill ? { defaultSkill: options.defaultSkill } : {}),
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

    if (!constrainedEvalHashes) {
      evalHashes.add(runtime.evalSnapshot.hash);
      upsertEvalSnapshotObject(state.evals, runtime.evalSnapshot);
    }
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

    const runtimeEvalHashes = constrainedEvalHashes ? [...constrainedEvalHashes] : [runtime.evalSnapshot.hash];
    for (const evalHash of runtimeEvalHashes) {
      for (const skill of runtime.skillBundles) {
        for (const agent of runtime.selectedAgents) {
          const agentHash = hashJson(agent);
          const cell: InternalComparisonCell = {
            versionId: version.id,
            skillName: skill.skillName,
            skillBundleHash: skill.hash,
            evalHash,
            agentName: agent.name,
            agentHash,
          };
          const key = comparisonCellAxisKey(cell);
          if (existingCellKeys.has(key)) {
            continue;
          }
          const evalSnapshot = evalHash === runtime.evalSnapshot.hash
            ? runtime.evalSnapshot
            : state.evals.find((entry) => entry.hash === evalHash);
          const evidence = evalSnapshot
            ? bestCompatibleEvalEvidence({
                state,
                skillBundle: skill,
                evalSnapshot,
                agent,
              })
            : undefined;
          cells.push({
            ...cell,
            ...(evidence ? comparisonCellEvidenceFields(evidence) : {}),
          });
          existingCellKeys.add(key);
        }
      }
    }
  }

  return {
    evalHashes: [...evalHashes],
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
  options: { currentEvalHash?: string } = {},
): WorkbenchResults {
  const skillByHash = new Map(comparison.skills.map((skill) => [skill.hash, skill]));
  const agentByHash = new Map(comparison.agents.map((agent) => [agent.hash, agent]));
  const evalVersionByHash = resultEvalVersionByHash(state, options.currentEvalHash, comparison.evalHashes ?? []);
  const projectVersionById = new Map(comparison.versions.map((version) => [version.id, version]));
  const localOrdinalByProjectVersionId = resultLocalVersionOrdinals(state);
  const resultVersions = new Map<string, WorkbenchResults["skillVersions"][number]>();
  const resultAgents = new Map<string, WorkbenchResults["agentVersions"][number]>();
  const resultEvalVersions = new Map<string, WorkbenchResults["evalVersions"][number]>();
  const resultCells = new Map<string, WorkbenchResults["cells"][number]>();
  const createdAtByRunId = new Map(state.runs.map((run) => [run.id, run.createdAt]));

  for (const evalHash of comparison.evalHashes ?? []) {
    const evalVersion = evalVersionByHash.get(evalHash);
    if (evalVersion) {
      resultEvalVersions.set(evalVersion.id, evalVersion);
    }
  }

  for (const cell of comparison.cells) {
    const skill = skillByHash.get(cell.skillBundleHash);
    const agent = agentByHash.get(cell.agentHash);
    const evalVersion = evalVersionByHash.get(cell.evalHash);
    if (!skill || !agent || !evalVersion) {
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
    const resultCell: WorkbenchResults["cells"][number] = {
      skillVersionId: skillVersion.id,
      evalVersionId: evalVersion.id,
      agentVersionId: cell.agentHash,
      ...(cell.runId ? { runId: cell.runId } : {}),
      ...(cell.jobIds && cell.jobIds.length > 0 ? { jobIds: [...cell.jobIds] } : {}),
      ...(cell.status ? { status: cell.status } : {}),
      ...(cell.score !== undefined ? { quality: cell.score } : {}),
      ...(cell.coverage ? { coverage: cell.coverage } : {}),
      ...(cell.report ? { report: cell.report } : {}),
      ...(cell.error ? { error: cell.error } : {}),
    };
    const resultCellKey = [
      resultCell.skillVersionId,
      resultCell.evalVersionId,
      resultCell.agentVersionId,
    ].join("\0");
    const existingCell = resultCells.get(resultCellKey);
    if (!existingCell || compareResultCellEvidence(resultCell, existingCell, createdAtByRunId) > 0) {
      resultCells.set(resultCellKey, resultCell);
      resultVersions.set(skillVersion.id, skillVersion);
    }
    resultAgents.set(cell.agentHash, {
      id: cell.agentHash,
      name: agent.agent.name,
      label: agent.agent.name,
      adapter: agent.agent.adapter,
      ...(agent.agent.model ? { model: agent.agent.model } : {}),
    });
    resultEvalVersions.set(evalVersion.id, evalVersion);
  }

  return {
    skillVersions: [...resultVersions.values()].sort((left, right) =>
      workbenchSkillVersionIdentity(left).localeCompare(workbenchSkillVersionIdentity(right))
    ),
    evalVersions: [...resultEvalVersions.values()].sort((left, right) =>
      left.ordinal - right.ordinal || left.id.localeCompare(right.id)
    ),
    agentVersions: [...resultAgents.values()].sort((left, right) =>
      left.label.localeCompare(right.label) || left.id.localeCompare(right.id)
    ),
    cells: [...resultCells.values()].sort((left, right) =>
      workbenchSkillVersionIdentity(resultVersions.get(left.skillVersionId)).localeCompare(workbenchSkillVersionIdentity(resultVersions.get(right.skillVersionId))) ||
      left.evalVersionId.localeCompare(right.evalVersionId) ||
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
): WorkbenchResults["skillVersions"][number] {
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
  const sorted = [...state.versions].sort(compareWorkbenchVersions);
  return new Map(sorted.map((version, index) => [version.id, index + 1]));
}

function compareResultCellEvidence(
  left: WorkbenchResults["cells"][number],
  right: WorkbenchResults["cells"][number],
  createdAtByRunId: ReadonlyMap<string, string>,
): number {
  const leftTerminal = left.status ? isWorkbenchRunStatusTerminal(left.status) : false;
  const rightTerminal = right.status ? isWorkbenchRunStatusTerminal(right.status) : false;
  if (leftTerminal !== rightTerminal) {
    return leftTerminal ? 1 : -1;
  }
  const sampleDelta = (left.coverage?.planned ?? 0) - (right.coverage?.planned ?? 0);
  if (sampleDelta !== 0) {
    return sampleDelta;
  }
  const leftCreated = left.runId ? createdAtByRunId.get(left.runId) ?? "" : "";
  const rightCreated = right.runId ? createdAtByRunId.get(right.runId) ?? "" : "";
  return leftCreated.localeCompare(rightCreated);
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
  const selectedEvalHashes = options.evalHashes ? new Set(options.evalHashes) : null;
  const skillBundlesByHash = new Map(state.skillBundles.map((bundle) => [bundle.hash, bundle]));
  const entriesByKey = new Map<string, {
    version: WorkbenchVersion;
    bundle: WorkbenchSkillBundleSnapshot;
    evalHash: string;
    allowEvidence: boolean;
  }>();

  for (const run of [...state.runs].sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    if (
      !versionIds.has(run.versionId) ||
      !skillSelectionIncludes(options.skills, run.skillName, run.skillBundleHash)
    ) {
      continue;
    }
    const version = versions.find((entry) => entry.id === run.versionId);
    const bundle = skillBundlesByHash.get(run.skillBundleHash);
    if (!version || !bundle) {
      continue;
    }
    for (const evalHash of selectedEvalHashes ? [...selectedEvalHashes] : [run.evalHash]) {
      const key = comparisonEntryKey(run.versionId, run.skillName, run.skillBundleHash, evalHash);
      entriesByKey.set(key, { version, bundle, evalHash, allowEvidence: true });
    }
  }

  for (const job of [...state.jobs].sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    if (
      !versionIds.has(job.versionId) ||
      !skillSelectionIncludes(options.skills, job.skillName, job.skillBundleHash)
    ) {
      continue;
    }
    const version = versions.find((entry) => entry.id === job.versionId);
    const bundle = skillBundlesByHash.get(job.skillBundleHash);
    if (!version || !bundle) {
      continue;
    }
    for (const evalHash of selectedEvalHashes ? [...selectedEvalHashes] : [job.evalHash]) {
      const key = comparisonEntryKey(job.versionId, job.skillName, job.skillBundleHash, evalHash);
      entriesByKey.set(key, { version, bundle, evalHash, allowEvidence: true });
    }
  }

  if (versions.length > 0) {
    const selectedBundles = state.skillBundles.filter((bundle) =>
      skillSelectionIncludes(options.skills, bundle.skillName, bundle.hash)
    );
    const storedEvalVersionHashes = resultEvalVersionSummaries(state).map((entry) => entry.hash);
    const activeEvalHash = selectActiveEvalSnapshot(state)?.hash;
    const placeholderEvalHashes = selectedEvalHashes
      ? [...selectedEvalHashes]
      : entriesByKey.size === 0
        ? storedEvalVersionHashes.length > 0
          ? storedEvalVersionHashes
          : activeEvalHash ? [activeEvalHash] : []
        : [];
    for (const evalHash of placeholderEvalHashes) {
      for (const version of versions) {
        for (const bundle of selectedBundles) {
          const key = comparisonEntryKey(version.id, bundle.skillName, bundle.hash, evalHash);
          if (!entriesByKey.has(key)) {
            entriesByKey.set(key, { version, bundle, evalHash, allowEvidence: false });
          }
        }
      }
    }
  }

  const entries = [...entriesByKey.values()].sort((left, right) =>
    compareWorkbenchVersions(left.version, right.version) ||
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
  const evalHashes = new Set([...(options.evalHashes ?? []), ...entries.map((entry) => entry.evalHash)]);
  const cells: InternalComparisonCell[] = [];

  for (const entry of entries) {
    const agents = agentsByVersionId.get(entry.version.id) ?? [];
    for (const agent of agents) {
      const evalSnapshot = state.evals.find((snapshot) => snapshot.hash === entry.evalHash);
      const resolvedAgent = state.agents.find((candidate) => hashJson(candidate) === agent.hash) ?? agent.agent;
      const evidence = entry.allowEvidence && evalSnapshot && hashJson(resolvedAgent) === agent.hash
        ? bestCompatibleEvalEvidence({
            state,
            skillBundle: entry.bundle,
            evalSnapshot,
            agent: resolvedAgent,
          })
        : undefined;
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

  return {
    evalHashes: [...evalHashes],
    versions,
    skills: comparedSkills,
    agents: comparedAgents,
    cells,
  };
}

export async function switchWorkbenchVersion(versionRef: string, options: WorkbenchSwitchOptions = {}): Promise<WorkbenchSwitchResult> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const version = resolveVersion(state, versionRef);
    const liveFiles = await readSkillFiles(root);
    const changes = compareSwitchFiles(liveFiles, version.files);
    const unchanged = switchFileChangesEmpty(changes);
    const liveHash = hashFiles(liveFiles);
    const liveIsKnownVersion = Boolean(findWorkbenchVersionBySourceHash(state.versions, liveHash));
    const requiresOverwrite = !unchanged && !liveIsKnownVersion;
    if (requiresOverwrite && !options.overwrite && !options.dryRun) {
      throw new WorkbenchCodedError(
        "worktree_changed",
        "Local package source has unsaved edits; refusing to overwrite it with workbench skill switch.",
        {
          remediation: `workbench skill switch ${version.id} --yes`,
          subject: {
            versionId: version.id,
            added: changes.added,
            changed: changes.changed,
            removed: changes.removed,
          },
          exitCode: 1,
        },
      );
    }
    if (!options.dryRun) {
      if (!unchanged) {
        await materializeSkillFiles(root, version.files);
      }
      state.remotes = await readWorkbenchRemotesFile(root);
      state.refs.current = version.id;
      await saveState(root, state);
    }
    return {
      version: copyVersion(version),
      dryRun: options.dryRun === true,
      changes,
      requiresOverwrite,
      unchanged,
    };
  });
}

export async function diffWorkbenchVersions(range: string, options: WorkbenchCommandOptions = {}): Promise<WorkbenchDiffEntry[]> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
  await requireInitialized(root);
  const state = await loadStateReadOnlyWithRetry(root);
  const liveVersion = await liveWorkbenchVersion(root, state);
  const [leftRef, rightRef] = range.includes("..")
    ? range.split("..", 2)
    : range.trim() === CURRENT_SKILL_VERSION_NAME
      ? [state.refs.current ?? "", CURRENT_SKILL_VERSION_NAME]
      : [CURRENT_SKILL_VERSION_NAME, range];
  const left = leftRef ? resolveDiffVersionRef(state, liveVersion, leftRef) : null;
  const right = rightRef ? resolveDiffVersionRef(state, liveVersion, rightRef) : liveVersion;
  return diffFiles(left?.files ?? [], right.files);
  });
}

function resolveDiffVersionRef(
  state: WorkbenchProjectState,
  liveVersion: WorkbenchVersion,
  ref: string,
): WorkbenchVersion {
  return ref.trim() === CURRENT_SKILL_VERSION_NAME
    ? liveVersion
    : resolveVersion(state, ref);
}

export async function showWorkbenchRef(ref: string, options: WorkbenchCommandOptions = {}): Promise<unknown> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  const [objectRef, filePath] = splitObjectPath(ref);
  if (!filePath) {
    const liveFile = await readLiveInspectableProjectFile(root, objectRef);
    if (liveFile) {
      return liveFile;
    }
  }
  const state = await loadStateReadOnlyWithRetry(root);
  if (objectRef === CURRENT_SKILL_VERSION_NAME) {
    if (filePath) {
      throw new WorkbenchCodedError("usage", `Use a path directly for live project files: workbench skill show ${filePath}`, {
        remediation: `workbench skill show ${quoteShellArg(filePath)}`,
        subject: { ref, path: filePath },
        exitCode: 2,
      });
    }
    const version = await liveWorkbenchVersion(root, state);
    return version;
  }
  const evalSnapshot = evalSnapshotByVersionRef(state, objectRef);
  if (evalSnapshot) {
    if (!filePath) {
      return copyEval(evalSnapshot);
    }
    const file = evalSnapshot.files.find((entry) => entry.path === filePath);
    if (!file) {
      throw new WorkbenchCodedError("ref_not_found", `File not found in ${objectRef}: ${filePath}`, {
        remediation: `workbench eval show ${objectRef}`,
        subject: { ref: objectRef, path: filePath },
        exitCode: 1,
      });
    }
    return copyFile(file);
  }
  const version = findVersion(state, objectRef);
  if (version) {
    if (!filePath) {
      return version;
    }
    const file = version.files.find((entry) => entry.path === filePath);
    if (!file) {
      throw new WorkbenchCodedError("ref_not_found", `File not found in ${version.id}: ${filePath}`, {
        remediation: `workbench skill show ${version.id}`,
        subject: { ref: version.id, path: filePath },
        exitCode: 1,
      });
    }
    return file;
  }
  const run = resolveWorkbenchObjectByRef(state.runs, objectRef, "run");
  if (run) {
    return run;
  }
  const job = resolveWorkbenchObjectByRef(state.jobs, objectRef, "job");
  if (job) {
    return job;
  }
  const trace = resolveWorkbenchObjectByRef(state.traces, objectRef, "trace");
  if (trace) {
    if (filePath) {
      const file = trace.files.filter(isUserFacingTraceFile).find((entry) => entry.path === filePath);
      if (!file) {
        throw new WorkbenchCodedError("ref_not_found", `File not found in ${trace.id}: ${filePath}`, {
          remediation: `workbench eval show ${trace.id}`,
          subject: { ref: trace.id, path: filePath },
          exitCode: 1,
        });
      }
      return file;
    }
    return trace;
  }
  const artifact = resolveWorkbenchObjectByRef(state.artifacts, objectRef, "artifact");
  if (artifact) {
    if (filePath) {
      const file = artifact.files.find((entry) => entry.path === filePath);
      if (!file) {
        throw new WorkbenchCodedError("ref_not_found", `File not found in ${artifact.id}: ${filePath}`, {
          remediation: `workbench eval show ${artifact.id}`,
          subject: { ref: artifact.id, path: filePath },
          exitCode: 1,
        });
      }
      return file;
    }
    return artifact;
  }
  throw new WorkbenchCodedError("ref_not_found", `Workbench object not found: ${objectRef}`, {
    remediation: "workbench eval results --json",
    subject: { ref: objectRef },
    exitCode: 1,
  });
}

async function readLiveInspectableProjectFile(root: string, filePath: string): Promise<SurfaceSnapshotFile | null> {
  let normalized: string;
  try {
    normalized = normalizeWorkbenchSourcePath(filePath);
  } catch {
    return null;
  }
  if (isWorkbenchRuntimeMetadataPath(normalized)) {
    throw new WorkbenchCodedError("runtime_metadata_not_inspectable", `Runtime metadata is not inspectable: ${normalized}`, {
      remediation: "Use workbench eval results or workbench eval show RUN_ID to inspect durable evidence.",
      subject: { path: normalized },
      exitCode: 1,
    });
  }
  if (!isWorkbenchLiveInspectableProjectPath(normalized)) {
    return null;
  }
  const absolute = path.join(root, normalized);
  const stat = await fs.stat(absolute).catch(() => null);
  if (stat?.isFile()) {
    return surfaceFileFromBuffer(normalized, await fs.readFile(absolute), (stat.mode & 0o111) !== 0);
  }
  const pathLike = isWorkbenchAuthoredControlPath(normalized) ||
    normalized.includes("/") ||
    normalized.includes(".") ||
    path.basename(normalized) === "Dockerfile" ||
    path.basename(normalized) === SKILL_FILE;
  if (pathLike) {
    throw new WorkbenchCodedError("ref_not_found", `Live project file not found: ${normalized}`, {
      remediation: "workbench skill show",
      subject: { path: normalized },
      exitCode: 1,
    });
  }
  return null;
}

export function resolveWorkbenchObjectByRef<T extends { id: string }>(
  entries: readonly T[],
  ref: string,
  kind: "run" | "job" | "trace" | "artifact",
): T | undefined {
  const normalized = ref.trim();
  if (!normalized) {
    return undefined;
  }
  const candidates = entries
    .filter((entry) => objectIdRefMatches(entry.id, normalized))
    .sort((left, right) => left.id.localeCompare(right.id));
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
    if (isCanonicalPublicationRef(name)) {
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

export async function syncWorkbenchRemote(options: WorkbenchRemoteOptions = {}): Promise<WorkbenchSyncResult> {
  const root = resolveRoot(options.dir);
  return withWorkbenchProjectLockIfInitialized(root, async () => {
    await requireInitialized(root);
    const state = await loadState(root);
    const remote = resolveRemote(state, options.remote);
    const attemptAt = now();
    try {
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
      await writeObjectPackTraceBundles(root, remotePack);
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
      if (options.signal?.aborted) throw error;
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
    const current = options.dryRun === true
      ? (await planWorkbenchLaunchSource(root, state, {
          commit: false,
          message: PACKAGE_SNAPSHOT_MESSAGE,
        })).version
      : await reconcileWorkbenchVersion(root, state, PACKAGE_SNAPSHOT_MESSAGE);
    const version = options.version ? resolveVersion(state, options.version) : current;
    const remote = resolveRemote(state, options.remote);
    assertPublishableRemote(remote);
    if (options.dryRun !== true) {
      await saveState(root, state);
    }
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
    const publication = await writeRemoteSkillPackage(sync.remote, version, {
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
        remediation: "workbench skill publish VERSION",
        subject: { versionId: version.id },
        exitCode: 1,
      });
    }
    if (publication.currentVersionId === version.id) {
      const replacementVersionId = unpublishReplacementVersionId(publication, version.id, syncedState.versions);
      throw new WorkbenchCodedError("published_version_current", `Version ${version.id} is the current published version and cannot be unpublished directly.`, {
        remediation: replacementVersionId ? `workbench skill publish ${replacementVersionId}` : "workbench skill versions",
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
        visibility: isWorkbenchSkillVisibility(publication.visibility) ? publication.visibility : undefined,
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
    .sort(compareWorkbenchVersions)
    .at(-1);
  return latestKnownVersion?.id ?? [...replacementIds].sort().at(-1);
}

function assertPublishableRemote(remote: WorkbenchRemote): void {
  if (remote.kind === "workbench-cloud") {
    return;
  }
  throw new WorkbenchCodedError("publish_failed", `Remote ${remote.name} is a file remote; only Workbench Cloud remotes can publish skill packages.`, {
    remediation: "workbench login && workbench skill publish",
    subject: { remote: remote.name, kind: remote.kind, url: remote.url },
    exitCode: 1,
  });
}

export interface WorkbenchInspectionSnapshotFromStateOptions {
  root?: string;
  state: WorkbenchProjectState;
  liveVersion?: WorkbenchVersion;
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
  const currentEvalHash = state.evals[0]?.hash;
  const evalVersions = resultEvalVersionSummaries(state, currentEvalHash);
  const resultEvalHashes = evalVersions.length > 0
    ? evalVersions.map((entry) => entry.hash)
    : currentEvalHash ? [currentEvalHash] : [];
  const status: WorkbenchStatus = {
    root,
    initialized: true,
    ...(current ? { currentVersionId: current } : {}),
    ...(defaultSkill ? { defaultSkill } : {}),
    ...(defaultAgent ? { defaultAgent } : {}),
    runCount: state.runs.length,
    ...(options.pendingSyncCount !== undefined ? { pendingSyncCount: options.pendingSyncCount } : {}),
  };
  return {
    root,
    status,
    versions: [
      ...(options.liveVersion ? [copyVersion(options.liveVersion)] : []),
      ...state.versions.filter((version) => version.id !== options.liveVersion?.id).map(copyVersion),
    ],
    skillSources,
    skillBundles: state.skillBundles.map(copySkillBundle),
    evals: state.evals.map(copyEval),
    evalVersions,
    agents,
    ...(state.versions.length > 0 ? {
      results: resultsFromInternalComparison(buildInternalComparisonFromState(state, {
        versions: "all",
        skills: "all",
        agents: "all",
        evalHashes: resultEvalHashes,
      }), state, { currentEvalHash }),
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
  return state.agents[0]?.name;
}

export function defaultWorkbenchSkillSelectionFromState(state: WorkbenchProjectState): string | undefined {
  if (state.skillSources.some((source) => source.name === CURRENT_SKILL_VERSION_NAME)) {
    return CURRENT_SKILL_VERSION_NAME;
  }
  return state.skillSources[0]?.name ?? state.skillBundles[0]?.skillName;
}

export async function createWorkbenchReadOnlyInspectionSnapshot(
  options: WorkbenchCommandOptions = {},
): Promise<WorkbenchInspectionSnapshot> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  const loadedState = await loadStateReadOnlyWithRetry(root);
  const state = await applyLocalRunCancellationRequests(root, loadedState);
  const [authoredAgents, skillSources, syncCount, liveVersion, evalSnapshot] = await Promise.all([
    readAgents(root).catch(() => []),
    readSkillSources(root).catch(() => state.skillSources),
    pendingSyncCount(root).catch(() => undefined),
    liveWorkbenchVersion(root, state).catch(() => undefined),
    readEvalSnapshot(root),
  ]);
  const defaultSkill = await readDefaultSkillSelection(root, skillSources)
    .catch(() => defaultWorkbenchSkillSelectionFromState({ ...state, skillSources }));
  const defaultAgent = await readDefaultAgentSelection(root, authoredAgents.length > 0 ? authoredAgents : state.agents)
    .catch(() => defaultWorkbenchAgentSelectionFromState({
      ...state,
      agents: authoredAgents.length > 0 ? authoredAgents : state.agents,
    }));
  const snapshotStateWithTraces = evalSnapshot
    ? {
        ...state,
        evals: [
          copyEval(evalSnapshot),
          ...state.evals.filter((entry) => entry.hash !== evalSnapshot.hash).map(copyEval),
        ],
        traces: state.traces.map(copyTrace),
      }
    : {
        ...state,
      traces: state.traces.map(copyTrace),
      };
  return createWorkbenchInspectionSnapshotFromState({
    root,
    state: snapshotStateWithTraces,
    liveVersion,
    skillSources,
    authoredAgents,
    currentVersionId: liveVersion ? CURRENT_SKILL_VERSION_NAME : currentWorkbenchVersionIdFromState(state),
    defaultSkill,
    defaultAgent,
    pendingSyncCount: syncCount,
    ...workbenchPublicationForSnapshot(
      state,
      Object.values(state.remotes).sort((left, right) => left.name.localeCompare(right.name)),
    ),
  });
}

/** The first Eval in an inspection is always the freshly read local Eval. */
export function currentWorkbenchEvalSnapshot(
  snapshot: Pick<WorkbenchInspectionSnapshot, "evals">,
): WorkbenchEvalSnapshot | undefined {
  return snapshot.evals[0];
}

/** The Agent Skill name declared by the checkout's current SKILL.md. */
export function currentWorkbenchSkillName(
  snapshot: Pick<WorkbenchInspectionSnapshot, "status" | "versions">,
): string | undefined {
  const current = snapshot.versions.find((version) => version.id === snapshot.status.currentVersionId);
  const skillFile = current?.files.find((file) => file.path === SKILL_FILE &&
    (file.kind ?? "text") === "text" && (file.encoding ?? "utf8") === "utf8");
  return skillFile ? skillFrontmatterName(skillFile.content) : undefined;
}

export async function readWorkbenchReadOnlyInspectionCursor(
  options: WorkbenchCommandOptions = {},
): Promise<string> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  return readLocalWorkbenchLiveStateCursor(root);
}

export async function notifyWorkbenchReadOnlyInspectionChanged(
  options: WorkbenchCommandOptions = {},
): Promise<void> {
  const root = resolveRoot(options.dir);
  await requireInitialized(root);
  await advanceLocalWorkbenchLiveState(root);
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

export function workbenchJobEvidenceForSnapshot(
  snapshot: WorkbenchInspectionSnapshot,
  selector: { runId: string; jobId: string },
): WorkbenchExecutionTraceDetail | null {
  const run = snapshot.runs.find((entry) => entry.id === selector.runId) ?? null;
  if (!run) {
    return null;
  }
  const job = snapshot.jobs.find((entry) => entry.id === selector.jobId && workbenchRunOwnsJob(run, entry)) ?? null;
  if (!job) {
    return null;
  }
  const traces = snapshot.traces.filter((trace) =>
    job.traceIds.includes(trace.id) || trace.jobId === job.id
  );
  const role = job.kind === "improve" ? "improver" : "engine";
  const fileSessions = traces.flatMap((trace) =>
    buildWorkbenchTraceSessionsFromFiles({
      job,
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
        batches: snapshot.executionEvents.filter((batch) => batch.jobId === job.id),
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
    status: job.status,
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
      const delta = readWorkbenchExecutionTrace(event.payload, "live-progress");
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
        summaries.set(traceSummaryKey(summary), summary);
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
      left.started_at.localeCompare(right.started_at) || traceSummaryKey(left).localeCompare(traceSummaryKey(right))
    ),
  };
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
  const terminal = isWorkbenchJobStatusTerminal(job.status);
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
    ...copyProjectObjectGraph(state),
  };
}

function copyProjectObjectGraph(
  state: WorkbenchProjectState,
): Omit<WorkbenchObjectPack, "schema" | "createdAt"> {
  return {
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
    lineage: state.lineage.map((entry) => ({ ...entry })),
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
      !isCanonicalPublicationRef(name)
    ));
}

function isCanonicalPublicationRef(name: string): boolean {
  return name.startsWith("publication/");
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
  visibility?: WorkbenchSkillVisibility,
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
  const visibility = refs["publication/visibility"];
  return {
    currentVersionId: versionId,
    publishedVersionIds: publishedVersionIdsFromRefs(refs),
    installHandle,
    ...(isWorkbenchSkillVisibility(visibility) ? { visibility } : {}),
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
): WorkbenchSyncPublication {
  const prefix = remoteName ? `remotes/${safeObjectFileName(remoteName)}/` : "";
  const versionId = publishedVersionIdFromRefsWithPrefix(refs, prefix);
  if (!versionId) {
    return { status: "unpublished" };
  }
  const visibility = refs[`${prefix}publication/visibility`];
  return {
    status: "published",
    currentVersionId: versionId,
    publishedVersionIds: publishedVersionIdsFromRefsWithPrefix(refs, prefix),
    ...(isWorkbenchSkillVisibility(visibility) ? { visibility } : {}),
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
): WorkbenchSkillVisibility | undefined {
  const prefix = remoteName ? `remotes/${safeObjectFileName(remoteName)}/` : "";
  const local = refs["publication/visibility"];
  if (isWorkbenchSkillVisibility(local)) {
    return local;
  }
  const remote = remoteName ? refs[`${prefix}publication/visibility`] : undefined;
  return isWorkbenchSkillVisibility(remote) ? remote : undefined;
}

function unpublishedPublicationStatus(): WorkbenchSyncPublication {
  return { status: "unpublished" };
}

function withPublicationRefsFromRemote(
  refs: WorkbenchRefs,
  remoteRefs: WorkbenchRefs,
): WorkbenchRefs {
  const nonPublicationRefs = Object.fromEntries(Object.entries(refs)
    .filter(([name]) => !isCanonicalPublicationRef(name)));
  const visibility = refs["publication/visibility"];
  const localVisibility = isWorkbenchSkillVisibility(visibility) ? visibility : undefined;
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

async function writeObjectPackTraceBundles(root: string, pack: WorkbenchObjectPack): Promise<void> {
  await Promise.all(pack.traces.map((trace) =>
    writeWorkbenchTraceRecord(copyTrace(trace), { projectRoot: root })
  ));
}

type WorkbenchProjectObjects = Omit<WorkbenchProjectState, "schema" | "root" | "refs" | "remotes">;

function emptyWorkbenchProjectObjects(): WorkbenchProjectObjects {
  return {
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

function emptyObjectPack(): WorkbenchObjectPack {
  return {
    schema: PACK_SCHEMA,
    createdAt: now(),
    refs: {},
    ...emptyWorkbenchProjectObjects(),
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
      await advanceLocalWorkbenchLiveState(args.root, {
        kind: "progress",
        runId: batch.runId,
        jobId: batch.jobId,
      }).catch(() => undefined);
    },
  };
}

interface WorkbenchEvaluationRunTarget {
  skillBundle: WorkbenchSkillBundleSnapshot;
  agent: WorkbenchAgent;
}

interface PlannedWorkbenchEvaluationJob {
  role: "run" | "grade";
  inputHash: string;
  input: WorkbenchExecutionRuntimeInput;
  runtimeCase: WorkbenchEvalCaseRuntime;
  sample: number;
  artifactId: string;
  traceId: string;
  skillBundle: WorkbenchSkillBundleSnapshot;
  agent: WorkbenchAgent;
  subjectJobId?: string;
  gradeSubject?: WorkbenchGradeSubject;
  dependencies?: readonly WorkbenchJobDependency[];
}

interface CompletedWorkbenchEvaluationJob {
  remoteJob: WorkbenchExecutionJob;
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
  kind: WorkbenchSchedulableRunKind;
  samples: number;
  cases?: readonly WorkbenchEvalCaseRuntime[];
  environmentDockerfile: string;
  operationTargets?: readonly WorkbenchOperationTarget[];
  operationSteps?: readonly WorkbenchOperationStep[];
  gradeOfRunId?: string;
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
          targets: args.operationTargets,
          steps: args.operationSteps,
          versionId: args.kind === "improve" ? args.baseVersionId ?? args.version.id : args.version.id,
          evalHash: args.evalSnapshot.hash,
          skillNames: targets.map((target) => target.skillBundle.skillName),
          agentNames: targets.map((target) => target.agent.name),
          caseIds: cases.map((runtimeCase) => runtimeCase.id),
          samples,
          rerun: (args.kind === "run" || args.kind === "grade" || args.kind === "eval") && args.rerun === true,
          budget: args.kind === "improve" ? args.requestedBudget : undefined,
          gradeOfRunId: args.gradeOfRunId,
          retryOfRunId: args.retryOfRunId,
        }),
    lastProgressAt: createdAt,
  };
  delete run.finishedAt;
  delete run.error;
  const environmentDockerfile = args.environmentDockerfile;
  const terminalDependencyJobs = new Map<string, WorkbenchExecutionJob>();
  const reusableJobsById = new Map<string, WorkbenchJob>();
  const plannedDagJobs: PlannedWorkbenchEvaluationJob[] = [];
  const addReusableJob = (job: WorkbenchJob): void => {
    reusableJobsById.set(job.id, job);
  };
  const addTerminalDependency = (completed: CompletedWorkbenchEvaluationJob): void => {
    terminalDependencyJobs.set(completed.remoteJob.id, completed.remoteJob);
    addReusableJob(completed.objects.job);
  };
  const planGradeForSubject = (subject: WorkbenchGradeSubject): void => {
    if (!skillEvalCaseHasConcreteGrader({
      evalSnapshot: args.evalSnapshot,
      runtimeCase: subject.runtimeCase,
      agent: subject.agent,
    })) {
      return;
    }
    const reusableGradeJob = args.rerun !== true
      ? selectReusableWorkbenchGradeJob({
          state: args.state,
          evalSnapshot: args.evalSnapshot,
          runtimeCase: subject.runtimeCase,
          agent: subject.agent,
          executionJob: subject.job,
        })
      : undefined;
    if (reusableGradeJob) {
      addReusableJob(reusableGradeJob);
      return;
    }
    const completed = completedEvaluationJobFromGradeSubject({
      root: args.root,
      state: args.state,
      run,
      version: args.version,
      evalSnapshot: args.evalSnapshot,
      environmentDockerfile,
      subject,
    });
    addTerminalDependency(completed);
    plannedDagJobs.push(createPlannedWorkbenchGradeJob({
      run,
      version: args.version,
      evalSnapshot: args.evalSnapshot,
      skillBundle: subject.skillBundle,
      agent: subject.agent,
      runtimeCase: subject.runtimeCase,
      sample: subject.job.sample,
      createdAt,
      environmentDockerfile,
      subject,
    }));
  };

  if (args.kind === "grade") {
    const subjects = currentGradeSubjectsForRuntime({
      state: args.state,
      evalSnapshot: args.evalSnapshot,
      targets,
      cases,
      samples,
      selectedSamples: args.selectedSamples,
      executeRunId: args.gradeOfRunId,
    });
    const gradeableSubjects = subjects.filter((subject) =>
      skillEvalCaseHasConcreteGrader({
        evalSnapshot: args.evalSnapshot,
        runtimeCase: subject.runtimeCase,
        agent: subject.agent,
      })
    );
    if (subjects.length === 0) {
      throw new WorkbenchCodedError("no_grade_subjects", "No execution jobs found for the selected skill, agent, and cases.", {
        remediation: gradeNoSubjectsRemediation({
          state: args.state,
          evalSnapshot: args.evalSnapshot,
          targets,
          cases,
          location: args.location ?? "local",
        }),
        exitCode: 2,
      });
    }
    if (gradeableSubjects.length === 0) {
      throw new WorkbenchCodedError("no_case_graders", "No selected cases have a grader configured.", {
        remediation: "Set an eval default grader or edit selected cases to choose a case-level grader.",
        exitCode: 2,
      });
    }
    for (const subject of gradeableSubjects) {
      addReusableJob(subject.job);
      planGradeForSubject(subject);
    }
  } else {
    const graph = planWorkbenchOperationGraph({
      kind: args.kind === "improve" ? "eval" : args.kind,
      targetCount: targets.length,
      cases: cases.map((runtimeCase) => ({
        id: runtimeCase.id,
        path: runtimeCase.path,
        gradableTargetIndexes: targets.flatMap((target, targetIndex) =>
          skillEvalCaseHasConcreteGrader({
            evalSnapshot: args.evalSnapshot,
            runtimeCase,
            agent: target.agent,
          }) ? [targetIndex] : []),
      })),
      samples,
      selectedSamples: args.selectedSamples,
    });
    const gradeDependencies = new Set(graph.nodes
      .filter((node) => node.role === "grade")
      .flatMap((node) => node.dependencies));
    for (const node of graph.nodes.filter((entry) => entry.role === "run")) {
      const target = targets[node.targetIndex]!;
      const runtimeCase = cases.find((entry) => entry.id === node.caseId)!;
      const jobId = nextJobId();
      const plannedJob: PlannedWorkbenchEvaluationJob = {
        role: "run",
        inputHash: workbenchRunInputHash({
          evalSnapshot: args.evalSnapshot,
          target,
          runtimeCase,
          sample: node.sample,
        }),
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
          sample: node.sample,
          createdAt,
          environmentDockerfile,
        }),
        runtimeCase,
        sample: node.sample,
        artifactId: nextArtifactId(),
        traceId: `trace_${jobId}`,
        skillBundle: target.skillBundle,
        agent: target.agent,
      };
      const reusableSubject = args.rerun !== true
        ? reusableExecutionSubjectForPlannedJob({
            state: args.state,
            version: args.version,
            evalSnapshot: args.evalSnapshot,
            plannedJob,
          })
        : undefined;
      if (reusableSubject) {
        const completed = completedEvaluationJobFromGradeSubject({
          root: args.root,
          state: args.state,
          run,
          version: args.version,
          evalSnapshot: args.evalSnapshot,
          environmentDockerfile,
          subject: reusableSubject,
        });
        addTerminalDependency(completed);
        if (gradeDependencies.has(node.id)) {
          planGradeForSubject(reusableSubject);
        }
        continue;
      }
      plannedDagJobs.push(plannedJob);
      if (gradeDependencies.has(node.id)) {
        plannedDagJobs.push(createPlannedWorkbenchGradeJob({
          run,
          version: args.version,
          evalSnapshot: args.evalSnapshot,
          skillBundle: target.skillBundle,
          agent: target.agent,
          runtimeCase,
          sample: node.sample,
          createdAt,
          environmentDockerfile,
          subjectJobId: plannedJob.input.job.id,
          subjectInputHash: plannedJob.inputHash,
        }));
      }
    }
  }

  const inputsByJobId = new Map(plannedDagJobs.map((entry) => [entry.input.job.id, entry]));
  const reusableJobs = [...reusableJobsById.values()];
  run.jobIds = Array.from(new Set([
    ...(args.run?.jobIds ?? []),
    ...reusableJobs.map((job) => job.id),
    ...plannedDagJobs.map((entry) => entry.input.job.id),
  ]));
  run.traceIds = Array.from(new Set([
    ...run.traceIds,
    ...reusableJobs.flatMap((job) => job.traceIds),
  ]));
  upsertRunObject(args.state.runs, run, args.run ? { replace: true } : {});
  for (const plannedJob of plannedDagJobs) {
    upsertJobObject(args.state.jobs, skillEvalLifecycleJobFromRemoteJob({
      remoteJob: plannedJob.input.job,
      run,
      version: args.version,
      skillBundle: plannedJob.skillBundle,
      evalSnapshot: args.evalSnapshot,
      agent: plannedJob.agent,
      runtimeCase: plannedJob.runtimeCase,
      sample: plannedJob.sample,
      role: plannedJob.role,
      inputHash: plannedJob.inputHash,
      dependencies: plannedJob.dependencies,
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
  const persistTerminalJob = async (completed: WorkbenchExecutionJob): Promise<void> => {
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
      role: plannedJob.role,
      inputHash: plannedJob.inputHash,
      dependencies: dependenciesForPlannedWorkbenchEvaluationJob(args.state, plannedJob),
      request: requestForPlannedWorkbenchEvaluationJob(args.request, args.state, plannedJob),
      result: args.result,
    });
    persistedTerminalJobs.set(completed.id, result);
    run.jobIds = Array.from(new Set([...run.jobIds, result.job.id]));
    run.traceIds = Array.from(new Set([...run.traceIds, result.trace.id]));
    upsertJobObject(args.state.jobs, result.job);
    upsertImmutableById(args.state.artifacts, result.artifact, "artifact");
    await writeWorkbenchTraceRecord(result.trace, { projectRoot: args.root });
    upsertImmutableById(args.state.traces, result.trace, "trace");
    await enqueueRunStateSave();
  };
  let dagJobs: WorkbenchExecutionJob[] = [];
  if (plannedDagJobs.length > 0) {
    try {
      const dag = await runWorkbenchExecutionDag({
        jobs: [
          ...terminalDependencyJobs.values(),
          ...plannedDagJobs.map((entry) => entry.input.job),
        ],
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
            role: plannedJob.role,
            inputHash: plannedJob.inputHash,
            dependencies: plannedJob.dependencies,
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
          const runtimeInput = plannedJob.role === "grade"
            ? createLocalPlannedGradeRuntimeInput({
                state: args.state,
                plannedJob,
                job,
                run,
                version: args.version,
                evalSnapshot: args.evalSnapshot,
              })
            : {
                ...plannedJob.input,
                job,
              };
          return await executeWorkbenchExecutionJob({
            ...runtimeInput,
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
  const jobs: WorkbenchJob[] = [...reusableJobs];
  for (const completed of dagJobs) {
    if (!inputsByJobId.has(completed.id)) {
      continue;
    }
    const result = persistedTerminalJobs.get(completed.id);
    if (!result) {
      throw new Error(`Terminal skill eval job was not persisted: ${completed.id}`);
    }
    jobs.push(result.job);
    run.lastProgressAt = result.job.finishedAt ?? result.job.startedAt ?? now();
  }
  const finishedAt = now();
  run.finishedAt = finishedAt;
  run.lastProgressAt = finishedAt;
  run.status = jobs.every((job) => job.status === "succeeded")
    ? "succeeded"
    : jobs.some((job) => job.status === "failed")
      ? "failed"
      : "canceled";
  const allRunJobs = args.run
    ? args.state.jobs.filter((job) => workbenchRunOwnsJob(run, job))
    : jobs;
  const errors = allRunJobs.flatMap((job) => job.error ? [job.error] : []);
  if (errors.length > 0) {
    run.error = summarizeJobErrors(errors);
  }
  upsertRunObject(args.state.runs, run, args.run ? { replace: true } : {});
  return run;
}

function gradeNoSubjectsRemediation(args: {
  state: WorkbenchProjectState;
  evalSnapshot: WorkbenchEvalSnapshot;
  targets: readonly WorkbenchEvaluationRunTarget[];
  cases: readonly WorkbenchEvalCaseRuntime[];
  location: WorkbenchRunLocation;
}): string {
  const runCommand = runCommandForGradeSelection(args);
  const failedJob = latestFailedExecuteJobForGradeSelection(args);
  return failedJob
    ? `workbench eval show ${quoteShellArg(failedJob.id)} && ${runCommand}`
    : runCommand;
}

function runCommandForGradeSelection(args: {
  targets: readonly WorkbenchEvaluationRunTarget[];
  cases: readonly WorkbenchEvalCaseRuntime[];
  location: WorkbenchRunLocation;
}): string {
  const skills = uniqueStrings(args.targets.map((target) => target.skillBundle.skillName))
    .filter((skill) => skill !== CURRENT_SKILL_VERSION_NAME);
  const agents = uniqueStrings(args.targets.map((target) => target.agent.name));
  const caseIds = uniqueStrings(args.cases.map((runtimeCase) => runtimeCase.id));
  return workbenchOperationCliEquivalent({
    kind: "eval",
    variant: args.location,
    caseIds,
    targets: agents.map((agent) => ({
      ...(skills[0] ? { skill: skills[0] } : {}),
      agent,
    })),
    steps: ["run"],
  });
}

function latestFailedExecuteJobForGradeSelection(args: {
  state: WorkbenchProjectState;
  evalSnapshot: WorkbenchEvalSnapshot;
  targets: readonly WorkbenchEvaluationRunTarget[];
  cases: readonly WorkbenchEvalCaseRuntime[];
}): WorkbenchJob | undefined {
  const caseIds = new Set(args.cases.flatMap((runtimeCase) => [runtimeCase.id, runtimeCase.path]));
  const targetKeys = new Set(args.targets.map((target) =>
    gradeTargetKey(target.skillBundle.hash, hashJson(target.agent))
  ));
  return args.state.jobs
    .filter((job) =>
      job.role === "run" &&
      job.status === "failed" &&
      job.evalHash === args.evalSnapshot.hash &&
      targetKeys.has(gradeTargetKey(job.skillBundleHash, job.agentHash)) &&
      caseIds.has(job.caseId)
    )
    .sort((left, right) => jobTerminalSortKey(right).localeCompare(jobTerminalSortKey(left)) || right.id.localeCompare(left.id))[0];
}

function jobTerminalSortKey(job: WorkbenchJob): string {
  return job.finishedAt ?? job.startedAt ?? job.createdAt;
}

function createPlannedWorkbenchGradeJob(args: {
  run: WorkbenchRun;
  version: WorkbenchVersion;
  evalSnapshot: WorkbenchEvalSnapshot;
  skillBundle: WorkbenchSkillBundleSnapshot;
  agent: WorkbenchAgent;
  runtimeCase: WorkbenchEvalCaseRuntime;
  sample: number;
  createdAt: string;
  environmentDockerfile: string;
  subject?: WorkbenchGradeSubject;
  subjectJobId?: string;
  subjectInputHash?: string;
}): PlannedWorkbenchEvaluationJob {
  if (!skillEvalCaseHasConcreteGrader({
    evalSnapshot: args.evalSnapshot,
    runtimeCase: args.runtimeCase,
    agent: args.agent,
  })) {
    throw new Error(`Case ${args.runtimeCase.id} does not have a grader configured.`);
  }
  const subjectJobId = args.subject?.job.id ?? args.subjectJobId;
  if (!subjectJobId) {
    throw new Error("Grade job planning requires a subject job id.");
  }
  const subjectInputHash = args.subject?.job.inputHash ?? args.subjectInputHash;
  if (!subjectInputHash) {
    throw new Error("Grade job planning requires a subject input hash.");
  }
  const gradeJobId = nextJobId();
  const input = createWorkbenchSkillEvalRuntimeInput({
    ownerUserId: "local",
    projectId: "local",
    runId: args.run.id,
    jobId: gradeJobId,
    versionId: args.version.id,
    skillName: args.skillBundle.skillName,
    skillBundleHash: args.skillBundle.hash,
    evalHash: args.evalSnapshot.hash,
    evalSnapshot: args.evalSnapshot,
    agent: args.agent,
    versionFiles: args.skillBundle.files,
    runtimeCase: args.runtimeCase,
    sample: args.sample,
    createdAt: args.createdAt,
    environmentDockerfile: args.environmentDockerfile,
  });
  const jobInput = readWorkbenchPlannedExecutionJobInput(input.job);
  const dependencies = args.subject
    ? gradeDependenciesForSubject(args.subject)
    : [gradeDependencyForSubjectJobId(subjectJobId)];
  return {
    role: "grade",
    inputHash: workbenchGradeInputHash({
      evalSnapshot: args.evalSnapshot,
      runtimeCase: args.runtimeCase,
      agent: args.agent,
      subjectJobId,
      subjectInputHash,
    }),
    input: {
      ...input,
      job: {
        ...input.job,
        input: {
          ...jobInput,
          dependsOn: [subjectJobId],
          subjectJobId,
          role: "grade",
        },
      },
    },
    runtimeCase: args.runtimeCase,
    sample: args.sample,
    artifactId: nextArtifactId(),
    traceId: `trace_${gradeJobId}`,
    skillBundle: args.skillBundle,
    agent: args.agent,
    subjectJobId,
    ...(args.subject ? { gradeSubject: args.subject } : {}),
    dependencies,
  };
}

function createLocalPlannedGradeRuntimeInput(args: {
  state: WorkbenchProjectState;
  plannedJob: PlannedWorkbenchEvaluationJob;
  job: WorkbenchExecutionJob;
  run: WorkbenchRun;
  version: WorkbenchVersion;
  evalSnapshot: WorkbenchEvalSnapshot;
}): WorkbenchExecutionRuntimeInput {
  const subject = gradeSubjectForPlannedWorkbenchEvaluationJob(args.state, args.plannedJob);
  const input = createWorkbenchSkillEvalGradeRuntimeInput({
    ownerUserId: "local",
    projectId: "local",
    runId: args.run.id,
    jobId: args.job.id,
    versionId: args.version.id,
    skillName: args.plannedJob.skillBundle.skillName,
    skillBundleHash: args.plannedJob.skillBundle.hash,
    evalHash: args.evalSnapshot.hash,
    evalSnapshot: args.evalSnapshot,
    agent: args.plannedJob.agent,
    versionFiles: args.plannedJob.skillBundle.files,
    runtimeCase: args.plannedJob.runtimeCase,
    sample: args.plannedJob.sample,
    createdAt: args.job.createdAt,
    environmentDockerfile: args.plannedJob.input.environmentDockerfile ?? missingPlannedEnvironmentDockerfile(),
    subject: {
      job: subject.job,
      artifact: subject.artifact,
      trace: subject.trace,
    },
  });
  return {
    ...input,
    job: {
      ...input.job,
      ...args.job,
      input: input.job.input,
    },
  };
}

function missingPlannedEnvironmentDockerfile(): never {
  throw new Error("Planned Workbench eval job omitted environmentDockerfile.");
}

function gradeSubjectForPlannedWorkbenchEvaluationJob(
  state: WorkbenchProjectState,
  plannedJob: PlannedWorkbenchEvaluationJob,
): WorkbenchGradeSubject {
  if (plannedJob.gradeSubject) {
    return plannedJob.gradeSubject;
  }
  if (!plannedJob.subjectJobId) {
    throw new Error(`Grade job ${plannedJob.input.job.id} has no subject dependency.`);
  }
  const job = state.jobs.find((entry) => entry.id === plannedJob.subjectJobId);
  if (!job || job.role !== "run" || job.status !== "succeeded") {
    throw new Error(`Grade job ${plannedJob.input.job.id} cannot start before subject ${plannedJob.subjectJobId} succeeds.`);
  }
  const artifact = job.artifactIds.flatMap((id) => state.artifacts.find((entry) => entry.id === id) ?? [])[0];
  const trace = job.traceIds.flatMap((id) => state.traces.find((entry) => entry.id === id) ?? [])[0];
  if (!artifact || !trace) {
    throw new Error(`Grade job ${plannedJob.input.job.id} cannot find subject evidence for ${job.id}.`);
  }
  return {
    job,
    artifact,
    trace,
    skillBundle: plannedJob.skillBundle,
    agent: plannedJob.agent,
    runtimeCase: plannedJob.runtimeCase,
  };
}

function dependenciesForPlannedWorkbenchEvaluationJob(
  state: WorkbenchProjectState,
  plannedJob: PlannedWorkbenchEvaluationJob,
): readonly WorkbenchJobDependency[] | undefined {
  if (plannedJob.role !== "grade") {
    return undefined;
  }
  try {
    return gradeDependenciesForSubject(gradeSubjectForPlannedWorkbenchEvaluationJob(state, plannedJob));
  } catch {
    return plannedJob.dependencies;
  }
}

function requestForPlannedWorkbenchEvaluationJob(
  request: Record<string, Json> | undefined,
  state: WorkbenchProjectState,
  plannedJob: PlannedWorkbenchEvaluationJob,
): Record<string, Json> | undefined {
  if (plannedJob.role !== "grade") {
    return request;
  }
  const dependencies = dependenciesForPlannedWorkbenchEvaluationJob(state, plannedJob) ?? [];
  const subject = dependencies[0];
  return {
    ...(request ?? {}),
    ...(plannedJob.subjectJobId ? { subjectJobId: plannedJob.subjectJobId } : {}),
    ...(subject?.artifactId ? { subjectArtifactId: subject.artifactId } : {}),
    ...(subject?.traceIds ? { subjectTraceIds: [...subject.traceIds] } : {}),
  };
}

function gradeDependenciesForSubject(subject: WorkbenchGradeSubject): WorkbenchJobDependency[] {
  return [{
    ...gradeDependencyForSubjectJobId(subject.job.id),
    artifactId: subject.artifact.id,
    traceIds: [subject.trace.id],
  }];
}

function gradeDependencyForSubjectJobId(jobId: string): WorkbenchJobDependency {
  return {
    name: "subject",
    jobId,
    mount: "/workspace/input/subject",
    mode: "readonly",
  };
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
    subject: issue.subject,
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
  kind: WorkbenchCaseRunKind,
  evalSnapshot: WorkbenchEvalSnapshot,
): void {
  assertWorkbenchLaunchReadinessReady(readinessFromIssues(draftCaseReadinessIssues(cases, kind, evalSnapshot)));
}

function draftCaseReadinessIssues(
  cases: readonly WorkbenchEvalCaseRuntime[],
  kind: WorkbenchCaseRunKind,
  evalSnapshot: WorkbenchEvalSnapshot,
): WorkbenchLaunchReadinessIssue[] {
  const issues: WorkbenchLaunchReadinessIssue[] = [];
  const checksGrade = kind === "grade" || kind === "eval";
  for (const runtimeCase of cases) {
    const record = parseCaseRecord(runtimeCase.content, runtimeCase.path || runtimeCase.id);
    const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
    if (prompt === DRAFT_CASE_PROMPT_PLACEHOLDER) {
      issues.push(draftCaseReadinessIssue(runtimeCase, "prompt"));
      continue;
    }
    if (checksGrade && caseEffectiveGradeContainsDraftPlaceholder(evalSnapshot, runtimeCase)) {
      issues.push(draftCaseReadinessIssue(runtimeCase, "grade"));
    }
  }
  return issues;
}

function caseEffectiveGradeContainsDraftPlaceholder(
  evalSnapshot: WorkbenchEvalSnapshot,
  runtimeCase: WorkbenchEvalCaseRuntime,
): boolean {
  const resolved = skillEvalCaseGradePlan({ evalSnapshot, runtimeCase });
  if (resolved.adapter === "rubric") {
    return rubricCriteriaContainDraftPlaceholder(resolved.config.criteria);
  }
  if (resolved.adapter === "tests") {
    return gradePlanTestFiles(runtimeCase.files).some((file) =>
      file.content.includes(DRAFT_CASE_TEST_PLACEHOLDER_FRAGMENT)
    );
  }
  if (resolved.adapter === "command") {
    return (configString(resolved.config, "command") ?? "").includes(DRAFT_CASE_COMMAND_GRADER_PLACEHOLDER_FRAGMENT);
  }
  return false;
}

function rubricCriteriaContainDraftPlaceholder(value: Json | undefined): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.some((entry) => {
    const criterion = asRecord(entry);
    return typeof criterion?.description === "string" &&
      criterion.description.includes(DRAFT_CASE_GRADE_CRITERION_PLACEHOLDER);
  });
}

function draftCaseReadinessIssue(
  runtimeCase: WorkbenchEvalCaseRuntime,
  field: "prompt" | "grade",
): WorkbenchLaunchReadinessIssue {
  const descriptorPath = evalCaseDescriptorProjectPath(runtimeCase);
  const command = `\${EDITOR:-vi} ${quoteShellArg(descriptorPath)}`;
  return {
    code: `draft_case_${field}`,
    message: `Eval case ${runtimeCase.id} still contains the draft ${field === "prompt" ? "prompt" : "grader input"} placeholder. Edit ${descriptorPath} before using ${field === "prompt" ? "run" : "grade"} evidence.`,
    remediation: command,
    subject: { caseId: runtimeCase.id, path: descriptorPath, field },
  };
}

function evalCaseDescriptorProjectPath(runtimeCase: WorkbenchEvalCaseRuntime): string {
  return normalizeRelativePath(path.join(
    WORKBENCH_DIR,
    CASES_DIR,
    normalizeRelativePath(runtimeCase.path),
    CASE_DESCRIPTOR_FILE,
  ));
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
  remoteJob: WorkbenchExecutionJob;
  run: WorkbenchRun;
  version: WorkbenchVersion;
  skillBundle: WorkbenchSkillBundleSnapshot;
  evalSnapshot: WorkbenchEvalSnapshot;
  agent: WorkbenchAgent;
  runtimeCase: WorkbenchEvalCaseRuntime;
  sample: number;
  role: WorkbenchJob["role"];
  inputHash: string;
  dependencies?: readonly WorkbenchJobDependency[];
}): WorkbenchExecutionJob {
  const finishedAt = args.remoteJob.finishedAt;
  const error = args.remoteJob.error;
  const execution = readWorkbenchPlannedExecutionJobInput(args.remoteJob).execution;
  return {
    ...args.remoteJob,
    kind: args.run.kind,
    role: args.role,
    inputHash: args.inputHash,
    versionId: args.version.id,
    skillName: args.skillBundle.skillName,
    skillBundleHash: args.skillBundle.hash,
    evalHash: args.evalSnapshot.hash,
    agentName: args.agent.name,
    agentHash: hashJson(args.agent),
    caseId: args.runtimeCase.id,
    sample: args.sample,
    ...(args.dependencies?.length ? { dependencies: args.dependencies.map(copyJobDependency) } : {}),
    command: configString(jsonRecord(execution.adapter.with), "command"),
    ...(finishedAt ? { durationMs: durationMsBetween(args.remoteJob.startedAt, finishedAt) } : {}),
    ...(error ? { error } : {}),
  };
}

function skillEvalObjectsFromRemoteJob(args: {
  remoteJob: WorkbenchExecutionJob;
  run: WorkbenchRun;
  version: WorkbenchVersion;
  skillBundle: WorkbenchSkillBundleSnapshot;
  evalSnapshot: WorkbenchEvalSnapshot;
  agent: WorkbenchAgent;
  runtimeCase: WorkbenchEvalCaseRuntime;
  sample: number;
  artifactId?: string;
  traceId?: string;
  role: WorkbenchJob["role"];
  inputHash: string;
  dependencies?: readonly WorkbenchJobDependency[];
  request?: Record<string, Json>;
  result?: Record<string, Json>;
}): { job: WorkbenchJob; artifact: WorkbenchArtifact; trace: WorkbenchTrace } {
  const finishedAt = args.remoteJob.finishedAt ?? now();
  const output = asRuntimeRecord(args.remoteJob.output);
  const status = args.remoteJob.status === "succeeded"
    ? "succeeded"
    : args.remoteJob.status === "canceled" ? "canceled" : "failed";
  const usage = readWorkbenchSkillRunOutputUsage(output);
  const outputResult = jsonRecord(output.result);
  const jobError = args.remoteJob.error;
  if (status !== "succeeded") {
    stripResultScores(outputResult);
  }
  const resultPayload = {
    ...outputResult,
    ...(usage ? { usage: toJson(usage) } : {}),
    ...(args.result ?? {}),
    status: status === "succeeded" ? "succeeded" : "failed",
    ...(jobError ? { error: jobError } : {}),
  } satisfies Record<string, Json>;
  if (status !== "succeeded") {
    stripResultScores(resultPayload);
  }
  const files = artifactFilesFromRemoteOutput(output);
  const request = {
    versionId: args.version.id,
    runId: args.run.id,
    jobId: args.remoteJob.id,
    role: args.role,
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
  const jobCommand = configString(asRuntimeRecord(asRuntimeRecord(jsonRecord(args.remoteJob.input).execution).adapter).with as Record<string, Json>, "command");
  const jobResult = jobResultFromPayload(resultPayload, files, args.role === "grade");
  const lifecycleJob = skillEvalLifecycleJobFromRemoteJob(args);
  const { artifact, trace } = remoteExecutionEvidence({
    remoteJob: args.remoteJob,
    run: args.run,
    files,
    finishedAt,
    request,
    result: resultPayload,
    status,
    identity: {
      versionId: args.version.id,
      skillName: args.skillBundle.skillName,
      skillBundleHash: args.skillBundle.hash,
      evalHash: args.evalSnapshot.hash,
      agentName: args.agent.name,
      agentHash: hashJson(args.agent),
    },
    adapterId: adapterUse ?? args.agent.adapter,
    ...(jobCommand ? { command: jobCommand } : {}),
    links: [
      { type: "run", id: args.run.id },
      { type: "job", id: args.remoteJob.id },
      { type: "case", id: args.runtimeCase.id },
      { type: "version", id: args.version.id },
      { type: "agent", id: args.agent.name },
    ],
    prompt: skillEvalCasePrompt(args.runtimeCase),
    ...(args.artifactId ? { artifactId: args.artifactId } : {}),
    ...(args.traceId ? { traceId: args.traceId } : {}),
  });
  const job: WorkbenchExecutionJob = {
    ...lifecycleJob,
    status,
    ...(adapterUse ? { adapter: { use: adapterUse, hash: hashJson(executionAdapter) } } : {}),
    ...(jobResult ? { result: jobResult } : {}),
    command: jobCommand,
    artifactIds: [artifact.id],
    traceIds: [trace.id],
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
  return dedupeSurfaceFiles([
    ...outputFiles,
    ...prefixSurfaceFiles("workspace", workspaceFiles),
  ]);
}

function copyJobResult(result: WorkbenchJobResult): WorkbenchJobResult {
  return {
    ...result,
    ...(result.usage ? { usage: JSON.parse(JSON.stringify(result.usage)) as UsageSummary } : {}),
    ...(result.items ? { items: result.items.map((item) => ({ ...item, data: item.data, value: item.value })) } : {}),
    ...(result.payload !== undefined ? { payload: toJson(JSON.parse(JSON.stringify(result.payload))) } : {}),
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
    payload: toJson(JSON.parse(JSON.stringify(payload))),
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
        value: toJson(score),
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
        value: toJson(value),
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
          data: toJson(JSON.parse(JSON.stringify(criterion))),
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
      value: toJson(summary),
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
  remoteJob: WorkbenchExecutionJob;
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
  const status = args.remoteJob.status === "succeeded" && patch
    ? "succeeded"
    : args.remoteJob.status === "canceled"
      ? "canceled"
      : "failed";
  const jobError = args.remoteJob.error ??
    (status === "failed" ? textFromJson(output.error) ?? "Improve adapter did not produce a usable skill patch." : undefined);
  const files = Array.isArray(output.files)
    ? output.files.filter(isSurfaceSnapshotFile).map(copyFile)
    : [];
  const request = {
    versionId: args.job.versionId,
    runId: args.run.id,
    jobId: args.remoteJob.id,
    caseId: args.job.caseId,
    sample: args.job.sample,
    skillName: args.job.skillName,
    skillBundleHash: args.job.skillBundleHash,
    agent: toJson(args.agent),
    evidenceTraceIds: toJson(args.evidenceTraceIds),
    samples: args.samples,
    execution: jsonRecord(args.remoteJob.input).execution ?? null,
  } satisfies Record<string, Json>;
  const resultPayload = {
    status: status === "succeeded" ? "succeeded" : "failed",
    ...(usage ? { usage: toJson(usage) } : {}),
    ...(patch
      ? {
          fileChanges: toJson(patch.fileChanges),
          ...(patch.summary ? { summary: patch.summary } : {}),
          ...(patch.feedback !== undefined ? { feedback: patch.feedback } : {}),
        }
      : {}),
    ...(jobError ? { error: jobError } : {}),
  } satisfies Record<string, Json>;
  const execution = jsonRecord(args.remoteJob.input).execution;
  const executionAdapter = asRuntimeRecord(asRuntimeRecord(execution).adapter);
  const adapterUse = typeof executionAdapter.use === "string" ? executionAdapter.use : undefined;
  const { artifact, trace } = remoteExecutionEvidence({
    remoteJob: args.remoteJob,
    run: args.run,
    files,
    finishedAt,
    request,
    result: resultPayload,
    status,
    identity: {
      versionId: args.job.versionId,
      skillName: args.job.skillName,
      skillBundleHash: args.job.skillBundleHash,
      evalHash: args.job.evalHash,
      agentName: args.agent.name,
      agentHash: args.job.agentHash,
    },
    adapterId: adapterUse ?? args.agent.adapter,
    links: [
      { type: "run", id: args.run.id },
      { type: "job", id: args.remoteJob.id },
      { type: "version", id: args.job.versionId },
      { type: "agent", id: args.agent.name },
      ...args.evidenceTraceIds.map((id) => ({ type: "trace" as const, id })),
    ],
    prompt: "Improve the Workbench skill using the supplied trace evidence.",
  });
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

function remoteExecutionEvidence(args: {
  remoteJob: WorkbenchExecutionJob;
  run: WorkbenchRun;
  files: readonly SurfaceSnapshotFile[];
  finishedAt: string;
  request: Record<string, Json>;
  result: Record<string, Json>;
  status: "succeeded" | "failed" | "canceled";
  identity: Pick<WorkbenchTrace, "versionId" | "skillName" | "skillBundleHash" | "evalHash" | "agentName" | "agentHash">;
  adapterId: string;
  command?: string;
  links: WorkbenchTrace["links"];
  prompt: string;
  artifactId?: string;
  traceId?: string;
}): { artifact: WorkbenchArtifact; trace: WorkbenchTrace } {
  const artifact: WorkbenchArtifact = {
    id: args.artifactId ?? nextArtifactIdForRun(args.run, args.remoteJob.id),
    runId: args.run.id,
    jobId: args.remoteJob.id,
    createdAt: args.finishedAt,
    files: args.files.map(copyFile),
  };
  const outputSummary = textFromJson(args.result.summary) ?? textFromJson(args.result.error) ?? undefined;
  const trace: WorkbenchTrace = {
    id: args.traceId ?? `trace_${args.remoteJob.id}`,
    runId: args.run.id,
    jobId: args.remoteJob.id,
    ...args.identity,
    createdAt: args.finishedAt,
    request: args.request,
    result: args.result,
    files: [
      textFile("request.json", JSON.stringify(args.request, null, 2) + "\n"),
      textFile("result.json", JSON.stringify(args.result, null, 2) + "\n"),
      ...args.files.map(copyFile),
    ],
    updatedAt: args.finishedAt,
    source: {
      adapterId: args.adapterId,
      sessionId: args.run.id,
      turnId: args.remoteJob.id,
      ...(args.command ? { command: args.command } : {}),
    },
    status: args.status === "succeeded" ? "completed" : args.status,
    links: args.links,
    input: { prompt: args.prompt },
    ...(outputSummary ? { output: { assistantText: outputSummary } } : {}),
  };
  return { artifact, trace };
}

export function readWorkbenchSkillRunOutputUsage(output: unknown): UsageSummary | undefined {
  const record = asRuntimeRecord(output);
  const result = asRuntimeRecord(record.result);
  return mergeUsageSummaries([
    normalizeUsageSummary(record.usage),
    normalizeUsageSummary(result.usage),
  ]);
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

async function readSkillEvalEnvironmentDockerfile(root: string): Promise<string> {
  const dockerfile = path.join(workbenchDir(root), ENVIRONMENT_DIR, "Dockerfile");
  let source: string;
  try {
    source = await fs.readFile(dockerfile, "utf8");
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") {
      throw missingSkillEvalEnvironmentDockerfileError();
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkbenchUserError(`Unable to read ${path.join(".workbench", ENVIRONMENT_DIR, "Dockerfile")}: ${message}`);
  }
  if (!source.trim()) {
    throw new WorkbenchUserError(`${path.join(".workbench", ENVIRONMENT_DIR, "Dockerfile")} must not be empty.`);
  }
  return source;
}

function missingSkillEvalEnvironmentDockerfileError(): WorkbenchCodedError {
  return new WorkbenchCodedError("environment_missing", `${path.join(".workbench", ENVIRONMENT_DIR, "Dockerfile")} is required.`, {
    remediation: `Create ${path.join(".workbench", ENVIRONMENT_DIR, "Dockerfile")} or rerun workbench skill init in a fresh project.`,
    subject: { path: path.join(".workbench", ENVIRONMENT_DIR, "Dockerfile") },
    exitCode: 1,
  });
}

function isMissingSkillEvalEnvironmentDockerfileError(error: unknown): boolean {
  return error instanceof WorkbenchCodedError && error.code === "environment_missing";
}

function requireSkillEvalEnvironmentDockerfileContent(source: string): string {
  const dockerfile = normalizeWorkbenchSkillEvalEnvironmentDockerfile(source);
  if (!dockerfile) {
    throw new WorkbenchUserError(`${path.join(".workbench", ENVIRONMENT_DIR, "Dockerfile")} must not be empty.`);
  }
  return dockerfile;
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

function skillEvalRuntimeSpec(agent: WorkbenchAgent, environmentDockerfile: string): {
  dockerfile: string;
  resources?: GenericRunSpec["environment"]["resources"];
  network?: GenericRunSpec["environment"]["network"];
} {
  const dockerfile = requireSkillEvalEnvironmentDockerfileContent(environmentDockerfile);
  return {
    dockerfile: `dockerfile://skill-eval-${hashJson(dockerfile).slice(0, 16)}`,
    resources: runtimeResourcesForSkillEval(agent),
    network: runtimeNetworkForSkillEval(agent),
  };
}

function dockerRuntimeImageRef(image: string): string {
  return image.startsWith("docker://") ? image : `docker://${image}`;
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
  const resolved = skillEvalCaseGradePlan({
    evalSnapshot: args.evalSnapshot,
    runtimeCase: args.runtimeCase,
    agent: args.agent,
    strict: true,
  });
  return {
    use: resolved.adapter,
    with: resolved.config,
  };
}

function skillEvalRuntimeGradeInvocation(args: {
  evalSnapshot: WorkbenchEvalSnapshot;
  agent: WorkbenchAgent;
  runtimeCase: WorkbenchEvalCaseRuntime;
}): WorkbenchAdapterInvocation {
  const resolved = skillEvalCaseGradePlan({
    evalSnapshot: args.evalSnapshot,
    runtimeCase: args.runtimeCase,
    agent: args.agent,
  });
  const invocation: WorkbenchAdapterInvocation = {
    use: resolved.adapter,
    with: resolved.config,
  };
  return invocation.use === "none"
    ? { use: "command", with: { command: "true" } }
    : invocation;
}

function skillEvalGradeDeclaration(
  evalSnapshot: WorkbenchEvalSnapshot,
): SkillEvalGradeDeclaration {
  return skillEvalGradeDeclarationFromFiles(evalSnapshot.files);
}

interface SkillEvalGradeDeclaration {
  adapter: string;
  config: Record<string, Json>;
}

interface SkillEvalCaseGradePlanResolution {
  adapter: string;
  config: Record<string, Json>;
  plan: WorkbenchGradePlan;
}

interface RubricCriterion {
  id: string;
  description: string;
  weight?: number;
}

interface ResolvedRubricCriterion extends RubricCriterion {
  source: "global" | "case" | "case_override";
}

const SUPPORTED_SKILL_EVAL_GRADE_ADAPTERS = ["none", "rubric", "tests", "command"] as const;

function skillEvalGradeDeclarationFromFiles(
  files: readonly SurfaceSnapshotFile[],
): SkillEvalGradeDeclaration {
  const evalFile = files.find((file) => file.path === EVAL_FILE);
  if (!evalFile) {
    throw new WorkbenchUserError(`${EVAL_FILE} grade.adapter must be none, rubric, tests, or command.`);
  }
  const record = parseYamlRecord(evalFile.content);
  assertOnlyEvalKeys(record, ["grade"], EVAL_FILE);
  const grade = asRecord(record.grade);
  if (!grade) {
    throw new WorkbenchUserError(`${EVAL_FILE} grade.adapter must be none, rubric, tests, or command.`);
  }
  assertOnlyGradeKeys(grade, ["adapter", "with"], EVAL_FILE);
  const adapter = typeof grade.adapter === "string" ? grade.adapter.trim().toLowerCase() : "";
  if (!adapter) {
    throw new WorkbenchUserError(`${EVAL_FILE} grade.adapter must be none, rubric, tests, or command.`);
  }
  const withConfig = grade.with === undefined ? {} : asRecord(grade.with);
  if (!withConfig) {
    throw new WorkbenchUserError(`${EVAL_FILE} grade.with must be a mapping.`);
  }
  return { adapter, config: jsonRecord(withConfig) };
}

function assertOnlyEvalKeys(record: Record<string, unknown>, allowed: readonly string[], pathLabel: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      throw new WorkbenchUserError(
        `${pathLabel} ${key} is not supported. Use only grade.adapter plus optional grade.with.`,
      );
    }
  }
}

function assertSupportedSkillEvalGradeAdapter(adapter: string): void {
  if (!(SUPPORTED_SKILL_EVAL_GRADE_ADAPTERS as readonly string[]).includes(adapter)) {
    throw new WorkbenchUserError(
      `Unsupported skill eval grade adapter ${adapter}. Use grade.adapter: none, rubric, tests, or command.`,
    );
  }
}

function skillEvalGradePlanFromDeclaration(args: {
  evalFiles: readonly SurfaceSnapshotFile[];
  evalGradeDeclaration: SkillEvalGradeDeclaration;
}): WorkbenchGradePlan {
  const declared = args.evalGradeDeclaration;
  const adapter = declared.adapter;
  assertSupportedSkillEvalGradeAdapter(adapter);
  if (adapter === "rubric") {
    const criteria = rubricCriteriaFromConfig(declared.config.criteria, `${EVAL_FILE} grade.with.criteria`)
      .map((criterion): ResolvedRubricCriterion => ({ ...criterion, source: "global" }));
    const config: Record<string, Json> = {
      ...declared.config,
      criteria: criteria.map(rubricCriterionConfig),
    };
    return {
      adapter,
      adapterSource: "eval",
      label: gradeAdapterLabel(adapter),
      summary: criteria.length === 0 ? "No grading criteria configured" : formatCount(criteria.length, "criterion"),
      sources: gradePlanSources({
        evalFiles: args.evalFiles,
        hasEvalGrade: true,
        hasCaseGrade: false,
      }),
      display: rubricGradePlanDisplay(criteria, config),
      authoring: gradePlanAuthoringControls(adapter, config),
    };
  }
  const config: Record<string, Json> = { ...declared.config };
  return {
    adapter,
    adapterSource: "eval",
    label: gradeAdapterLabel(adapter),
    summary: genericGradePlanSummary(adapter, config, []),
    sources: gradePlanSources({
      evalFiles: args.evalFiles,
      hasEvalGrade: true,
      hasCaseGrade: false,
    }),
    display: genericGradePlanDisplay(adapter, config, []),
    authoring: gradePlanAuthoringControls(adapter, config),
  };
}

function skillEvalCaseGradePlan(args: {
  evalSnapshot: WorkbenchEvalSnapshot;
  runtimeCase: WorkbenchEvalCaseRuntime;
  agent?: WorkbenchAgent;
  strict?: boolean;
}): SkillEvalCaseGradePlanResolution {
  return skillEvalCaseGradePlanFromCaseRecord({
    evalFiles: args.evalSnapshot.files,
    evalGradeDeclaration: skillEvalGradeDeclaration(args.evalSnapshot),
    caseId: args.runtimeCase.id,
    caseSourcePath: evalRuntimeCaseDescriptorSourcePath(args.runtimeCase),
    caseRecord: parseCaseRecord(args.runtimeCase.content, args.runtimeCase.path || args.runtimeCase.id),
    caseFiles: args.runtimeCase.files,
    agent: args.agent,
    strict: args.strict,
  });
}

export function skillEvalCaseHasConcreteGrader(args: {
  evalSnapshot: WorkbenchEvalSnapshot;
  runtimeCase: WorkbenchEvalCaseRuntime;
  agent?: WorkbenchAgent;
}): boolean {
  return skillEvalCaseGradePlan({
    evalSnapshot: args.evalSnapshot,
    runtimeCase: args.runtimeCase,
    agent: args.agent,
  }).adapter !== "none";
}

function skillEvalCaseGradePlanFromCaseRecord(args: {
  evalFiles: readonly SurfaceSnapshotFile[];
  evalGradeDeclaration: SkillEvalGradeDeclaration;
  caseId: string;
  caseSourcePath: string;
  caseRecord: Record<string, unknown>;
  caseFiles: readonly SurfaceSnapshotFile[];
  agent?: WorkbenchAgent;
  strict?: boolean;
}): SkillEvalCaseGradePlanResolution {
  const declared = args.evalGradeDeclaration;
  const caseGradeConfig = skillEvalCaseGradeConfig(args.caseRecord, args.caseSourcePath);
  const adapter = caseGradeConfig.adapter ?? declared.adapter;
  assertSupportedSkillEvalGradeAdapter(adapter);
  const inheritsEvalGrade = caseGradeConfig.adapter === undefined && adapter === declared.adapter;
  const adapterSource: WorkbenchGradePlan["adapterSource"] = caseGradeConfig.adapter ? "case" : "eval";

  if (adapter === "rubric") {
    const globalCriteria = inheritsEvalGrade
      ? rubricCriteriaFromConfig(declared.config.criteria, `${EVAL_FILE} grade.with.criteria`)
      : [];
    const caseCriteria = rubricCriteriaFromConfig(
      caseGradeConfig.config.criteria,
      `${args.caseSourcePath} grade.with.criteria`,
      { optional: true },
    );
    const criteria = mergeRubricCriteria(globalCriteria, caseCriteria);
    if (args.strict && criteria.length === 0) {
      throw new WorkbenchUserError(
        `Grading requires effective criteria for case ${args.caseId}. Add grade.with.criteria to ${EVAL_FILE} or ${args.caseSourcePath}.`,
      );
    }
    const config: Record<string, Json> = {
      ...(inheritsEvalGrade ? declared.config : {}),
      ...caseGradeConfig.config,
      criteria: criteria.map(rubricCriterionConfig),
    };
    const judge = jsonRecord(config.judge);
    if (args.strict && (typeof judge.use !== "string" || judge.use.trim().length === 0)) {
      throw new WorkbenchUserError("Rubric grading requires grade.with.judge.use.");
    }
    return {
      adapter,
      config,
      plan: {
        adapter,
        adapterSource,
        label: gradeAdapterLabel(adapter),
        summary: criteria.length === 0 ? "No grading criteria configured" : formatCount(criteria.length, "criterion"),
        sources: gradePlanSources({
          evalFiles: args.evalFiles,
          caseSourcePath: args.caseSourcePath,
          hasEvalGrade: inheritsEvalGrade,
          hasCaseGrade: caseGradeConfig.hasGrade,
        }),
        display: rubricGradePlanDisplay(criteria, config),
        authoring: gradePlanAuthoringControls(adapter, config),
      },
    };
  }

  const config: Record<string, Json> = {
    ...(inheritsEvalGrade ? declared.config : {}),
    ...caseGradeConfig.config,
  };
  return {
    adapter,
    config,
    plan: {
      adapter,
      adapterSource,
      label: gradeAdapterLabel(adapter),
      summary: genericGradePlanSummary(adapter, config, args.caseFiles),
      sources: gradePlanSources({
        evalFiles: args.evalFiles,
        caseSourcePath: args.caseSourcePath,
        hasEvalGrade: inheritsEvalGrade,
        hasCaseGrade: caseGradeConfig.hasGrade,
      }),
      display: genericGradePlanDisplay(adapter, config, args.caseFiles),
      authoring: gradePlanAuthoringControls(adapter, config),
    },
  };
}

function assertOnlyGradeKeys(record: Record<string, unknown>, allowed: readonly string[], pathLabel: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      throw new WorkbenchUserError(
        `${pathLabel} grade.${key} is not supported. Use grade.adapter plus grade.with.`,
      );
    }
  }
}

function skillEvalCaseGradeConfig(
  caseRecord: Record<string, unknown>,
  caseSourcePath: string,
): { adapter?: string; config: Record<string, Json>; hasGrade: boolean } {
  if (caseRecord.rubric !== undefined) {
    throw new WorkbenchUserError(
      `${caseSourcePath} rubric is not supported. Use grade.with.criteria for grading criteria.`,
    );
  }
  const grade = caseRecord.grade;
  if (grade === undefined) {
    return { config: {}, hasGrade: false };
  }
  const gradeRecord = asRecord(grade);
  if (!gradeRecord) {
    throw new WorkbenchUserError(`${caseSourcePath} grade must be a mapping.`);
  }
  assertOnlyGradeKeys(gradeRecord, ["adapter", "with"], caseSourcePath);
  const adapter = gradeRecord.adapter === undefined
    ? undefined
    : typeof gradeRecord.adapter === "string" && gradeRecord.adapter.trim()
      ? gradeRecord.adapter.trim().toLowerCase()
      : "";
  if (adapter === "") {
    throw new WorkbenchUserError(`${caseSourcePath} grade.adapter must be none, rubric, tests, or command.`);
  }
  if (adapter !== undefined) {
    assertSupportedSkillEvalGradeAdapter(adapter);
  }
  const withConfig = gradeRecord.with === undefined ? {} : asRecord(gradeRecord.with);
  if (!withConfig) {
    throw new WorkbenchUserError(`${caseSourcePath} grade.with must be a mapping.`);
  }
  return {
    ...(adapter ? { adapter } : {}),
    config: jsonRecord(withConfig),
    hasGrade: true,
  };
}

function rubricCriteriaFromConfig(
  value: Json | undefined,
  label: string,
  options: { optional?: boolean } = {},
): RubricCriterion[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    if (options.optional) {
      throw new WorkbenchUserError(`${label} must be an array when provided.`);
    }
    throw new WorkbenchUserError(`${label} must be an array.`);
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const criterion = asRecord(entry);
    if (!criterion) {
      throw new WorkbenchUserError(`${label}[${index}] must be a mapping.`);
    }
    const id = typeof criterion.id === "string" && criterion.id.trim() ? criterion.id.trim() : "";
    if (!id) {
      throw new WorkbenchUserError(`${label}[${index}] must include a stable id.`);
    }
    if (seen.has(id)) {
      throw new WorkbenchUserError(`${label}[${index}].id duplicates another rubric criterion id.`);
    }
    seen.add(id);
    const description = typeof criterion.description === "string" && criterion.description.trim()
      ? criterion.description.trim()
      : "";
    if (!description) {
      throw new WorkbenchUserError(`${label}[${index}] must include a description.`);
    }
    return {
      id,
      description,
      ...(typeof criterion.weight === "number" ? { weight: criterion.weight } : {}),
    } satisfies RubricCriterion;
  });
}

function mergeRubricCriteria(
  globalCriteria: readonly RubricCriterion[],
  caseCriteria: readonly RubricCriterion[],
): ResolvedRubricCriterion[] {
  const merged = globalCriteria.map((criterion): ResolvedRubricCriterion => ({
    ...criterion,
    source: "global",
  }));
  const indexes = new Map(merged.map((criterion, index) => [criterion.id, index]));
  for (const criterion of caseCriteria) {
    const index = indexes.get(criterion.id);
    if (index === undefined) {
      indexes.set(criterion.id, merged.length);
      merged.push({ ...criterion, source: "case" });
      continue;
    }
    merged[index] = { ...criterion, source: "case_override" };
  }
  return merged;
}

function rubricCriterionConfig(criterion: RubricCriterion): Json {
  return {
    id: criterion.id,
    description: criterion.description,
    ...(typeof criterion.weight === "number" ? { weight: criterion.weight } : {}),
  };
}

function gradeAdapterLabel(adapter: string): string {
  if (adapter === "none") {
    return "None";
  }
  if (adapter === "rubric") {
    return "Criteria";
  }
  if (adapter === "tests") {
    return "Tests";
  }
  if (adapter === "command") {
    return "Command";
  }
  return adapter;
}

function gradeAdapterOptions(): WorkbenchGradeAdapterOption[] {
  return SUPPORTED_SKILL_EVAL_GRADE_ADAPTERS.map((adapter) => ({
    adapter,
    label: gradeAdapterLabel(adapter),
    authoring: gradePlanAuthoringControls(adapter),
  }));
}

function gradePlanForAdapter(args: {
  adapter: string;
  adapterSource: WorkbenchGradePlan["adapterSource"];
  config?: Record<string, Json>;
  caseFiles?: readonly SurfaceSnapshotFile[];
}): WorkbenchGradePlan {
  const config = args.config ?? {};
  const caseFiles = args.caseFiles ?? [];
  return {
    adapter: args.adapter,
    adapterSource: args.adapterSource,
    label: gradeAdapterLabel(args.adapter),
    summary: args.adapter === "rubric"
      ? "No grading criteria configured"
      : genericGradePlanSummary(args.adapter, config, caseFiles),
    sources: [],
    display: args.adapter === "rubric"
      ? rubricGradePlanDisplay([], config)
      : genericGradePlanDisplay(args.adapter, config, caseFiles),
    authoring: gradePlanAuthoringControls(args.adapter, config),
  };
}

function gradePlanSources(args: {
  evalFiles: readonly SurfaceSnapshotFile[];
  caseSourcePath?: string;
  hasEvalGrade: boolean;
  hasCaseGrade: boolean;
}): WorkbenchGradePlanSource[] {
  const sources: WorkbenchGradePlanSource[] = [];
  if (args.hasEvalGrade && args.evalFiles.some((file) => file.path === EVAL_FILE)) {
    sources.push({ path: EVAL_FILE, role: "global" });
  }
  if (args.hasCaseGrade && args.caseSourcePath) {
    sources.push({ path: args.caseSourcePath, role: "case" });
  }
  return sources;
}

function rubricGradePlanDisplay(
  criteria: readonly ResolvedRubricCriterion[],
  config: Record<string, Json>,
): WorkbenchGradePlanDisplayBlock[] {
  const display: WorkbenchGradePlanDisplayBlock[] = [];
  if (criteria.length > 0) {
    display.push({
      kind: "list",
      title: "Criteria",
      items: criteria.map((criterion) => ({
        label: criterion.id,
        description: criterion.description,
        meta: rubricCriterionSourceLabel(criterion.source, criterion.weight),
      })),
    });
  }
  const items = gradeConfigKeyValueItems(config, new Set(["criteria", "judge"]));
  if (items.length > 0) {
    display.push({ kind: "key_value", title: "Adapter config", items });
  }
  return display;
}

function rubricCriterionSourceLabel(source: ResolvedRubricCriterion["source"], weight: number | undefined): string {
  const sourceLabel = source === "case_override"
    ? "case override"
    : source === "case"
      ? "case"
      : "global";
  return typeof weight === "number" ? `${sourceLabel} / weight ${weight}` : sourceLabel;
}

function genericGradePlanSummary(
  adapter: string,
  config: Record<string, Json>,
  caseFiles: readonly SurfaceSnapshotFile[],
): string {
  if (adapter === "none") {
    return "No grader";
  }
  if (adapter === "tests") {
    const testFiles = gradePlanTestFiles(caseFiles);
    return testFiles.length > 0 ? `${formatCount(testFiles.length, "test file")}` : "Case test harness";
  }
  if (adapter === "command") {
    return typeof config.command === "string" && config.command.trim() ? "Command grader" : "Command grader not configured";
  }
  return Object.keys(config).length > 0 ? "Configured grader" : "Default grader";
}

function genericGradePlanDisplay(
  adapter: string,
  config: Record<string, Json>,
  caseFiles: readonly SurfaceSnapshotFile[],
): WorkbenchGradePlanDisplayBlock[] {
  if (adapter === "none") {
    return [];
  }
  const display: WorkbenchGradePlanDisplayBlock[] = [];
  const testFiles = adapter === "tests" ? gradePlanTestFiles(caseFiles) : [];
  if (testFiles.length > 0) {
    display.push({
      kind: "files",
      title: "Test files",
      files: testFiles.map((file) => ({ path: file.path, role: "grade input" })),
    });
  }
  const items = gradeConfigKeyValueItems(config);
  if (items.length > 0) {
    display.push({ kind: "key_value", title: "Adapter config", items });
  }
  if (display.length === 0) {
    display.push({ kind: "text", text: "No adapter-specific grading details are configured." });
  }
  return display;
}

function gradePlanAuthoringControls(
  adapter: string,
  config: Record<string, Json> = {},
): WorkbenchGradePlanAuthoringControl[] {
  if (adapter === "none") {
    return [];
  }
  if (adapter === "rubric") {
    return [{
      kind: "list",
      name: "criteria",
      label: "Acceptance criteria",
      itemLabel: "Criterion",
      minItems: 1,
      fields: [{
        kind: "text",
        name: "description",
        label: "Criterion",
        placeholder: "One observable behavior that makes the result good.",
        required: true,
      }],
      defaultItems: [{ description: "" }],
    }];
  }
  if (adapter === "tests") {
    return [{
      kind: "file",
      name: "testScript",
      label: "Test script",
      description: "Runs inside the case sandbox and writes JSON to $OUTPUT_DIR/result.json.",
      path: "tests/test.sh",
      language: "shell",
      defaultValue: defaultWorkbenchCaseTestScript(),
      executable: true,
      required: true,
    }];
  }
  if (adapter === "command") {
    return [{
      kind: "text",
      name: "command",
      label: "Command",
      description: "Runs in the grader workspace and writes JSON to $OUTPUT_DIR/result.json.",
      ...(typeof config.command === "string" && config.command ? { defaultValue: config.command } : {}),
      multiline: true,
      required: true,
    }];
  }
  return [{
    kind: "notice",
    name: "grade",
    label: "Grade",
    message: "This grader does not expose case authoring fields.",
  }];
}

function evalGradePlanAuthoringControls(
  adapter: string,
  config: Record<string, Json> = {},
): WorkbenchGradePlanAuthoringControl[] {
  return gradePlanAuthoringControls(adapter, config).filter((control) => control.kind !== "file");
}

function gradePlanTestFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  return files.filter((file) => {
    const normalized = normalizeRelativePath(file.path);
    return normalized.startsWith("tests/") || normalized.includes("/tests/");
  });
}

function gradeConfigKeyValueItems(
  config: Record<string, Json>,
  excludedKeys: Set<string> = new Set(),
): { label: string; value: string }[] {
  return Object.keys(config)
    .filter((key) => !excludedKeys.has(key))
    .sort()
    .flatMap((key) => {
      const value = config[key];
      return value === undefined ? [] : [{ label: key, value: jsonSummary(value) }];
    });
}

function jsonSummary(value: Json): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${formatCount(value.length, "item")}`;
  }
  return `${formatCount(Object.keys(value).length, "field")}`;
}

function formatCount(count: number, singular: string): string {
  const plural = singular === "criterion" ? "criteria" : `${singular}s`;
  return `${count} ${count === 1 ? singular : plural}`;
}

function evalRuntimeCaseDescriptorSourcePath(runtimeCase: WorkbenchEvalCaseRuntime): string {
  return normalizeRelativePath(path.join(
    CASES_DIR,
    normalizeRelativePath(runtimeCase.path),
    CASE_DESCRIPTOR_FILE,
  ));
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
      ? { auth: toJson(auth) }
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
  if (isHarnessBackedSkillEvalAdapter(adapter)) {
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
  return isHarnessBackedSkillEvalAdapter(agent.adapter);
}

function isProviderBackedSkillEvalInvocation(invocation: WorkbenchAdapterInvocation): boolean {
  return isHarnessBackedSkillEvalAdapter(invocation.use);
}

function isHarnessBackedSkillEvalAdapter(adapterId: string): boolean {
  const manifest = builtinWorkbenchAdapterManifest(adapterId.trim().toLowerCase());
  return Boolean(manifest?.operations["skill.run"] && manifest.auth);
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
    if (normalized === CASE_DESCRIPTOR_FILE) {
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
  dockerfile: string;
  manifests: readonly WorkbenchAdapterManifest[];
}): string {
  const installers = runtimeAdapterInstallersFromManifests(args.manifests);
  return composeRuntimeDockerfileWithAdapterInstallers(
    args.dockerfile,
    installers,
  );
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
  if (isHarnessBackedSkillEvalAdapter(adapter)) {
    assertProviderBackedAgentNetwork(agent);
    return;
  }
  throw new WorkbenchUserError(
    `Agent ${agent.name} uses unsupported skill run adapter ${agent.adapter}.`,
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
  remoteJob: WorkbenchExecutionJob;
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
  environmentDockerfile: string;
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
  environmentDockerfile: string;
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
    environmentDockerfile: args.environmentDockerfile,
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
  remoteJob: WorkbenchExecutionJob,
  agent: WorkbenchAgent,
  message: string,
): WorkbenchCodedError & { remoteJob: WorkbenchExecutionJob } {
  return Object.assign(new WorkbenchCodedError("improve_failed", message, {
    remediation: adapterAuthRemediationFromError(remoteJob.error) ?? "workbench skill improve",
    subject: { agent: agent.name, status: remoteJob.status },
    exitCode: 1,
  }), { remoteJob });
}

function improvePatchRemoteJob(error: unknown): WorkbenchExecutionJob | undefined {
  return error && typeof error === "object" && "remoteJob" in error
    ? (error as { remoteJob?: WorkbenchExecutionJob }).remoteJob
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
  sourceState: "clean" | "edited" | "no_snapshot";
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
      sourceState: "clean",
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
      sourceState: "clean",
    };
  }
  const parent = state.refs.current;
  const version: WorkbenchVersion = {
    id: versionIdForHash(hash),
    hash,
    message: options.message ?? PACKAGE_SNAPSHOT_MESSAGE,
    parentIds: parent ? [parent] : [],
    createdAt: now(),
    files,
  };
  if (!options.commit) {
    return {
      version,
      sourceState: parent ? "edited" : "no_snapshot",
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
    sourceState: "clean",
  };
}

function findWorkbenchVersionBySourceHash(
  versions: readonly WorkbenchVersion[],
  hash: string,
): WorkbenchVersion | undefined {
  return versions.find((version) => version.hash === hash);
}

async function resolveOrCreateRunVersion(root: string, state: WorkbenchProjectState, ref?: string): Promise<WorkbenchVersion> {
  return (await planWorkbenchLaunchSource(root, state, {
    ref,
    commit: true,
    message: PACKAGE_SNAPSHOT_MESSAGE,
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
      .sort(compareWorkbenchVersions);
  }
  if (trimmed.includes("..")) {
    const [startRef, endRef] = trimmed.split("..", 2);
    const versions = [...state.versions].sort(compareWorkbenchVersions);
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

async function runtimeSelectionOptionsForRoot(
  root: string,
  state: WorkbenchProjectState,
): Promise<Pick<
  NonNullable<Parameters<typeof createWorkbenchVersionRuntimeSnapshot>[1]>,
  "agents" | "defaultAgent" | "skillSources" | "defaultSkill"
>> {
  const [agents, skillSources] = await Promise.all([
    readAgents(root).catch(() => state.agents.map(copyAgent)),
    readSkillSources(root).catch(() => state.skillSources.map(copySkillSource)),
  ]);
  const [defaultAgent, defaultSkill] = await Promise.all([
    readDefaultAgentSelection(root, agents).catch(() =>
      defaultWorkbenchAgentSelectionFromState({
        ...state,
        agents: agents.map(copyAgent),
      })
    ),
    readDefaultSkillSelection(root, skillSources).catch(() =>
      defaultWorkbenchSkillSelectionFromState({
        ...state,
        skillSources: skillSources.map(copySkillSource),
      })
    ),
  ]);
  return {
    agents,
    ...(defaultAgent ? { defaultAgent } : {}),
    skillSources,
    ...(defaultSkill ? { defaultSkill } : {}),
  };
}

async function readAgents(root: string): Promise<WorkbenchAgent[]> {
  const filePath = path.join(workbenchDir(root), AGENTS_FILE);
  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") {
      throw new WorkbenchUserError(`Missing ${path.join(".workbench", AGENTS_FILE)}. Run \`workbench skill new\` or restore the agent file before continuing.`);
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
    const config = asRecord(value.with) ?? {};
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
      : "workbench skill new";
  }
  const firstConfigured = configured[0];
  if (!firstConfigured) {
    return noun === "agent"
      ? providerAgentSetupCommand("codex", "default")
      : "workbench skill new";
  }
  const improvementAgent = command === "improve" && noun === "agent"
    ? firstImprovementCapableAgentName(entries)
    : undefined;
  if (command === "improve" && noun === "agent" && !improvementAgent) {
    return providerAgentSetupCommand("codex", "default");
  }
  const first = improvementAgent ?? closestConfiguredSelectionName(missingName, configured) ?? firstConfigured;
  const selection = missingName || command === "improve" || configured.length === 1 ? first : ALL_SELECTOR;
  return `${WORKBENCH_SELECTOR_INVOCATIONS[command]} ${flag} ${selection}`;
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
    if (!entry.isDirectory()) {
      continue;
    }
    const files = await readFilesUnder(absolute);
    const descriptor = files.find((file) => normalizeRelativePath(file.path) === CASE_DESCRIPTOR_FILE);
    if (!descriptor) {
      continue;
    }
    const caseRecord = parseCaseRecord(descriptor.content, path.join(entry.name, descriptor.path));
    const command = caseCommandFromRecord(caseRecord);
    cases.push({
      id: entry.name,
      path: entry.name,
      content: descriptor.content,
      files,
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

export function createWorkbenchEvalSnapshotFromEvalFiles(
  files: readonly SurfaceSnapshotFile[],
  timestamps: { createdAt?: string; updatedAt?: string } = {},
): WorkbenchEvalSnapshot {
  const normalizedFiles = files
    .map(copyFile)
    .map((file) => ({ ...file, path: normalizeRelativePath(file.path) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const gradeDeclaration = skillEvalGradeDeclarationFromFiles(normalizedFiles);
  const grade = skillEvalGradePlanFromDeclaration({
    evalFiles: normalizedFiles,
    evalGradeDeclaration: gradeDeclaration,
  });
  const cases = evalCaseSnapshotsFromEvalFiles(normalizedFiles, gradeDeclaration);
  const updatedAt = timestamps.updatedAt ?? now();
  const createdAt = timestamps.createdAt ?? updatedAt;
  return {
    hash: hashFiles(normalizedFiles),
    files: normalizedFiles,
    grade,
    gradeAdapters: gradeAdapterOptions(),
    cases,
    caseCount: cases.length,
    createdAt,
    updatedAt,
  };
}

function evalCaseSnapshotsFromEvalFiles(
  files: readonly SurfaceSnapshotFile[],
  gradeDeclaration: SkillEvalGradeDeclaration = skillEvalGradeDeclarationFromFiles(files),
): WorkbenchEvalCaseSnapshot[] {
  const grouped = new Map<string, SurfaceSnapshotFile[]>();
  for (const file of files) {
    const normalized = normalizeRelativePath(file.path);
    if (!normalized.startsWith(`${CASES_DIR}/`)) {
      continue;
    }
    const relativeCasePath = normalized.slice(CASES_DIR.length + 1);
    const [first, ...rest] = relativeCasePath.split("/");
    if (!first || rest.length === 0) {
      continue;
    }
    const group = grouped.get(first) ?? [];
    group.push(copyFile({ ...file, path: normalized }));
    grouped.set(first, group);
  }
  return [...grouped.entries()]
    .map(([fallbackId, caseFiles]) => {
      const sortedFiles = caseFiles.sort((left, right) => left.path.localeCompare(right.path));
      const caseSourcePath = normalizeRelativePath(path.join(CASES_DIR, fallbackId, CASE_DESCRIPTOR_FILE));
      const descriptor = sortedFiles.find((file) => normalizeRelativePath(file.path) === caseSourcePath);
      if (!descriptor) {
        return null;
      }
      const record = parseCaseSnapshotRecord(descriptor.content);
      const id = fallbackId;
      const command = caseCommandFromRecord(record);
      const description = caseDescriptionFromRecord(record);
      const grade = skillEvalCaseGradePlanFromCaseRecord({
        evalFiles: files,
        evalGradeDeclaration: gradeDeclaration,
        caseId: id,
        caseSourcePath,
        caseRecord: record,
        caseFiles: sortedFiles,
      }).plan;
      return {
        id,
        path: caseSourcePath,
        ...(description ? { description } : {}),
        ...(command ? { command } : {}),
        grade,
        files: sortedFiles.map(copyFile),
      };
    })
    .filter((entry): entry is WorkbenchEvalCaseSnapshot => entry !== null)
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
  return (await readFilesUnder(root))
    .filter((file) => isWorkbenchPackageSourcePath(file.path))
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function liveWorkbenchVersion(root: string, state: WorkbenchProjectState): Promise<WorkbenchVersion> {
  const files = await readSkillFiles(root);
  const hash = hashFiles(files);
  return {
    id: CURRENT_SKILL_VERSION_NAME,
    hash,
    message: "live worktree source",
    parentIds: state.refs.current ? [state.refs.current] : [],
    createdAt: now(),
    files,
  };
}

async function readSkillSources(root: string): Promise<WorkbenchSkillSource[]> {
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

async function currentRootSkillSource(root: string): Promise<WorkbenchSkillSource | null> {
  return await exists(path.join(root, SKILL_FILE))
    ? { name: CURRENT_SKILL_VERSION_NAME, kind: "local", source: "local:.", path: "." }
    : null;
}

function parseSkillSource(name: string, raw: unknown, label: string): WorkbenchSkillSource {
  const value = asRecord(raw) ?? {};
  const normalizedName = normalizeManifestEntryName(name, path.join(".workbench", VERSIONS_FILE), "version");
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
      from: `https://workbench.ai/skills/${encodeURIComponent(owner)}/${encodeURIComponent(skill)}`,
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
    skillSources?: readonly WorkbenchSkillSource[];
    defaultSkill?: string;
}): Promise<WorkbenchSkillBundleSnapshot[]> {
  const sources = args.skillSources
    ? args.skillSources.map(copySkillSource)
    : await readSkillSources(args.root);
  args.state.skillSources = sources.map(copySkillSource);
  const defaultSelection = args.defaultSkill ?? await readDefaultSkillSelection(args.root, sources);
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
    return readWorkbenchSkillPackageFiles(from, ref.trim(), prefix, options);
  }
  if (!parsed) {
    throw new WorkbenchUserError(`Unsupported remote skill ref ${from}. Use OWNER/REPO[/path], github:OWNER/REPO//path, a GitHub URL, or a Workbench skill URL.`);
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

async function readWorkbenchSkillPackageFiles(
  from: string,
  ref: string,
  prefix: string,
  options: { authToken?: string } = {},
): Promise<SurfaceSnapshotFile[]> {
  const packageUrl = workbenchSkillPackageUrl(from, ref);
  const manifest = await fetchWorkbenchSkillPackageJson<{
    schema?: string;
    versionId?: string;
    files?: Array<{
      path?: string;
      kind?: SurfaceSnapshotFile["kind"];
      encoding?: SurfaceSnapshotFile["encoding"];
      executable?: boolean;
      content?: string;
    }>;
  }>(packageUrl, options);
  if (manifest.schema !== "workbench.skill-package.snapshot.v1") {
    throw new WorkbenchUserError(`Workbench skill URL did not return a skill package: ${from}`);
  }
  if (manifest.versionId !== ref) {
    throw new WorkbenchUserError(`Workbench skill package ${from} resolved ${manifest.versionId ?? "unknown"} instead of requested ref ${ref}.`);
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
    throw new WorkbenchUserError(`Workbench skill package ${from} contains no installable skill files at ${ref}.`);
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
  return isWorkbenchPackageSourcePath(sourcePath);
}

function normalizeWorkbenchSourceManifestPath(filePath: string, from: string): string {
  try {
    return normalizeWorkbenchSourcePath(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkbenchUserError(`Workbench skill package ${from} returned an unsafe file path ${JSON.stringify(filePath)}: ${message}`);
  }
}

function workbenchSkillPackageUrl(from: string, ref: string): URL {
  let url: URL;
  try {
    url = new URL(from);
  } catch {
    throw new WorkbenchUserError(`Invalid Workbench skill URL: ${from}`);
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
      throw new WorkbenchUserError(`Workbench skill URL ${url.toString()} is pinned to ${version}, not requested ref ${ref}.`);
    }
  } else if (segments.length !== 3) {
    throw new WorkbenchUserError(`Invalid Workbench skill URL: ${from}`);
  }
  url.pathname = `/api/workbench/skills/${encodeURIComponent(owner)}/${encodeURIComponent(skill)}/versions/${encodeURIComponent(version)}/package`;
  url.search = "";
  url.hash = "";
  return url;
}

async function fetchWorkbenchSkillPackageJson<T>(
  url: URL,
  options: { authToken?: string } = {},
): Promise<T> {
  const response = await fetchWorkbenchSkillPackageResponse(url, options);
  return JSON.parse(await response.text()) as T;
}

async function fetchWorkbenchSkillPackageResponse(
  url: URL,
  options: { authToken?: string } = {},
): Promise<Response> {
  const token = options.authToken?.trim() || process.env.WORKBENCH_API_TOKEN?.trim();
  const response = await fetch(url, {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new WorkbenchUserError(`Unable to download Workbench skill package ${url.toString()}: ${response.status} ${response.statusText}`);
  }
  return response;
}

function parseGithubSkillRef(from: string): { owner: string; repo: string; subpath: string } {
  const parsed = tryParseGithubSkillRef(from);
  if (!parsed) {
    throw new WorkbenchUserError(`Unsupported remote skill ref ${from}. Use OWNER/REPO[/path], github:OWNER/REPO//path, a GitHub URL, or a Workbench skill URL.`);
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
  const workbench = workbenchSkillNameFromUrl(from);
  if (workbench) {
    return workbench;
  }
  return parseGithubSkillRef(from).repo;
}

function workbenchSkillNameFromUrl(from: string): string | null {
  try {
    const url = new URL(from);
    const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
    if (segments[0] === "skills" && segments[2]) {
      return safeName(segments[2]);
    }
    return null;
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
    const surfacePath = prefix ? `${prefix}/${relative}` : relative;
    if (entry.isDirectory()) {
      if (!prefix && !isWorkbenchPackageSourcePath(relative)) {
        continue;
      }
      await walkFiles(root, absolute, files, prefix);
      continue;
    }
    if (!entry.isFile() || path.posix.basename(relative) === ".DS_Store") {
      continue;
    }
    if (!prefix && !isWorkbenchPackageSourcePath(relative)) {
      continue;
    }
    const content = await fs.readFile(absolute);
    const executable = ((await fs.stat(absolute)).mode & 0o111) !== 0;
    files.push(surfaceFileFromBuffer(
      surfacePath,
      content,
      executable,
    ));
  }
}

async function materializeSkillFiles(root: string, files: readonly SurfaceSnapshotFile[]): Promise<void> {
  assertPackageSourceFilesOnly(files);
  await removeInstallableFiles(root);
  await writeSurfaceFiles(root, files);
}

function compareSwitchFiles(
  currentFiles: readonly SurfaceSnapshotFile[],
  targetFiles: readonly SurfaceSnapshotFile[],
): WorkbenchSwitchFileChanges {
  assertPackageSourceFilesOnly(targetFiles);
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file]));
  const targetByPath = new Map(targetFiles.map((file) => [file.path, file]));
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const file of targetFiles) {
    const current = currentByPath.get(file.path);
    if (!current) {
      added.push(file.path);
      continue;
    }
    if (!surfaceSnapshotFileEquivalent(current, file)) {
      changed.push(file.path);
    }
  }
  for (const file of currentFiles) {
    if (!targetByPath.has(file.path)) {
      removed.push(file.path);
    }
  }
  return {
    added: added.sort(),
    changed: changed.sort(),
    removed: removed.sort(),
  };
}

function switchFileChangesEmpty(changes: WorkbenchSwitchFileChanges): boolean {
  return changes.added.length === 0 && changes.changed.length === 0 && changes.removed.length === 0;
}

function surfaceSnapshotFileEquivalent(left: SurfaceSnapshotFile, right: SurfaceSnapshotFile): boolean {
  return left.path === right.path &&
    (left.encoding ?? "utf8") === (right.encoding ?? "utf8") &&
    left.content === right.content &&
    (left.executable === true) === (right.executable === true);
}

function assertPackageSourceFilesOnly(files: readonly SurfaceSnapshotFile[]): void {
  const nonPackageFile = files.find((file) => !isWorkbenchPackageSourcePath(file.path));
  if (!nonPackageFile) {
    return;
  }
  throw new WorkbenchUserError(
    `Package version files cannot include ${nonPackageFile.path}. Recreate this Workbench project with current package-only versions.`,
  );
}

async function materializeWorkbenchFiles(root: string, state: WorkbenchProjectState, evalHash?: string): Promise<void> {
  const workbenchRoot = workbenchDir(root);
  await fs.mkdir(workbenchRoot, { recursive: true });
  await fs.rm(path.join(workbenchRoot, EVAL_FILE), { force: true });
  await fs.rm(path.join(workbenchRoot, CASES_DIR), { recursive: true, force: true });
  await fs.rm(path.join(workbenchRoot, ENVIRONMENT_DIR), { recursive: true, force: true });

  const evalSnapshot = evalHash
    ? state.evals.find((entry) => entry.hash === evalHash)
    : selectActiveEvalSnapshot(state);
  if (evalHash && !evalSnapshot) {
    throw new WorkbenchUserError(`Eval snapshot not found: ${evalHash}`);
  }
  if (evalSnapshot) {
    await writeSurfaceFiles(workbenchRoot, evalSnapshot.files);
  }
}

async function removeInstallableFiles(root: string): Promise<void> {
  if (!await exists(root)) {
    return;
  }
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!isWorkbenchPackageSourcePath(entry.name)) {
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
  await fs.mkdir(path.dirname(lockRoot), { recursive: true });
  try {
    return await createWorkbenchProjectLock(lockRoot);
  } catch (error) {
    if (fileErrorCode(error) !== "EEXIST") {
      throw error;
    }
    if (!await removeStaleWorkbenchProjectLock(lockRoot)) {
      return null;
    }
    try {
      return await createWorkbenchProjectLock(lockRoot);
    } catch (retryError) {
      if (fileErrorCode(retryError) !== "EEXIST") {
        throw retryError;
      }
      return null;
    }
  }
}

async function acquireWorkbenchProjectLock(root: string): Promise<() => Promise<void>> {
  await ensureWorkbenchLocalMetadataIgnore(root);
  const lockRoot = projectLockDir(root);
  const ownerPath = path.join(lockRoot, "owner.json");
  const deadline = Date.now() + projectLockTimeoutMs();
  let attempts = 0;
  await fs.mkdir(path.dirname(lockRoot), { recursive: true });
  while (true) {
    try {
      return await createWorkbenchProjectLock(lockRoot);
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

async function createWorkbenchProjectLock(lockRoot: string): Promise<() => Promise<void>> {
  await fs.mkdir(lockRoot);
  await writeJson(path.join(lockRoot, "owner.json"), {
    schema: "workbench.project-lock.v1",
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: now(),
  } satisfies WorkbenchProjectLockOwner);
  return async () => await fs.rm(lockRoot, { recursive: true, force: true });
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

async function loadState(root: string, options: { allowMissing?: boolean } = {}): Promise<WorkbenchProjectState> {
  const workbenchRoot = workbenchDir(root);
  if (!await exists(workbenchRoot)) {
    if (!options.allowMissing) {
      throw new WorkbenchUserError("Workbench is not initialized here. Run `workbench skill new` first.");
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
    throw new WorkbenchUserError("Workbench is not initialized here. Run `workbench skill new` first.");
  }
  await recoverAtomicStateCommit(root);
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
  return parseWorkbenchState({
    schema: STATE_SCHEMA,
    root,
    refs,
    remotes,
    versions: await readObjects<unknown>("version"),
    skillSources: await readObjects<unknown>("skill-source"),
    skillBundles: await readObjects<unknown>("skill-bundle"),
    evals: await readObjects<unknown>("eval"),
    agents: await readObjects<unknown>("agent"),
    runs: await readObjects<unknown>("run"),
    jobs: await readObjects<unknown>("job"),
    traces: await listWorkbenchTraceRecords({ projectRoot: root }),
    executionEvents: await readObjects<unknown>("execution-event"),
    artifacts: await readObjects<unknown>("artifact"),
    lineage: await readObjects<unknown>("lineage"),
  });
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
  visibility?: WorkbenchSkillVisibility;
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

async function writeRemoteSkillPackage(
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
  throw new WorkbenchCodedError("publish_failed", `Remote ${remote.name} is a file remote; only Workbench Cloud remotes can publish skill packages.`, {
    remediation: "workbench login && workbench skill publish",
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
  visibility?: WorkbenchSkillVisibility;
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
      `/api/workbench/skills/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}/versions/${encodeURIComponent(versionId)}/package`,
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
      ...(isWorkbenchSkillVisibility(publication?.visibility)
        ? { visibility: publication.visibility }
        : {}),
    };
  }
  throw new WorkbenchCodedError("unpublish_failed", `Remote ${remote.name} is a file remote; only Workbench Cloud remotes can unpublish skill packages.`, {
    remediation: "workbench login && workbench skill unpublish VERSION",
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
  const token = options.authToken?.trim() || process.env.WORKBENCH_API_TOKEN?.trim();
  return await requestWorkbenchCloudJson<T>(baseUrl, apiPath, {
    method: options.method,
    body: options.body,
    signal: options.signal,
    token,
    mapTransportError: httpRemoteTransportError,
    mapHttpError: ({ status, text, cloudError }) => {
      if (cloudError) {
        const normalizedCloudError = normalizeWorkbenchCloudError(cloudError);
        if (status === 404 && isNotFoundCloudErrorCode(cloudError.code)) {
          return new WorkbenchRemoteNotFoundError(normalizedCloudError.message);
        }
        return new WorkbenchCodedError(normalizedCloudError.code, normalizedCloudError.message, {
          retryable: normalizedCloudError.retryable,
          ...(normalizedCloudError.remediation ? { remediation: normalizedCloudError.remediation } : {}),
          ...(normalizedCloudError.subject ? { subject: normalizedCloudError.subject } : {}),
          exitCode: status === 400 ? 2 : 1,
        });
      }
      if (status === 401 && !token) {
        return new WorkbenchCodedError("auth_required", "Workbench Cloud remote requires login.", {
          remediation: "workbench login",
          exitCode: 1,
        });
      }
      if (status === 404) {
        return new WorkbenchRemoteNotFoundError(`Workbench Cloud object not found: ${apiPath}`);
      }
      return new WorkbenchCodedError("remote_protocol_error", `Workbench Cloud remote request failed (${status}): ${readHttpErrorMessage(text)}`, {
        retryable: status === 429 || status >= 500,
        subject: { status, path: apiPath },
        exitCode: 1,
      });
    },
  });
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
    /\b(?:internal|team) skill visibility requires an organization-owned skill\b/iu.test(error.message)
  ) {
    return {
      ...error,
      message: "Team skill visibility requires an organization-owned skill.",
      subject: { ...error.subject, visibility: "team" },
    };
  }
  return error;
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
  const refs = asStringMap(await readJson(path.join(root, "refs.json"))) ?? {};
  const state = parseWorkbenchState({
    schema: STATE_SCHEMA,
    root,
    refs,
    remotes: {},
    versions: await readObjectDir<unknown>(path.join(root, "objects", "version")),
    skillSources: await readObjectDir<unknown>(path.join(root, "objects", "skill-source")),
    skillBundles: await readObjectDir<unknown>(path.join(root, "objects", "skill-bundle")),
    evals: await readObjectDir<unknown>(path.join(root, "objects", "eval")),
    agents: await readObjectDir<unknown>(path.join(root, "objects", "agent")),
    runs: await readObjectDir<unknown>(path.join(root, "objects", "run")),
    jobs: await readObjectDir<unknown>(path.join(root, "objects", "job")),
    traces: await readObjectDir<unknown>(path.join(root, "objects", "trace")),
    executionEvents: await readObjectDir<unknown>(path.join(root, "objects", "execution-event")),
    artifacts: await readObjectDir<unknown>(path.join(root, "objects", "artifact")),
    lineage: await readJsonl(path.join(root, "indexes", "lineage.jsonl")),
  });
  return {
    schema: PACK_SCHEMA,
    createdAt: typeof asRecord(manifest)?.createdAt === "string" ? asRecord(manifest)?.createdAt as string : now(),
    refs: state.refs,
    versions: state.versions,
    skillSources: state.skillSources,
    skillBundles: state.skillBundles,
    evals: state.evals,
    agents: state.agents,
    runs: state.runs,
    jobs: state.jobs,
    traces: state.traces,
    executionEvents: state.executionEvents,
    artifacts: state.artifacts,
    lineage: state.lineage,
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
  const collisionBackup = `${backup}.collision-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
  if (await exists(target)) {
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.rename(target, backup);
  }
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await renameStateDirectoryIntoPlace(next, target, collisionBackup);
    await removeStateTree(backup);
    await removeStateTree(collisionBackup);
  } catch (error) {
    if (!await exists(target)) {
      if (await exists(collisionBackup)) {
        await restoreStateBackupDirectory(target, collisionBackup);
      } else if (await exists(backup)) {
        await restoreStateBackupDirectory(target, backup);
      }
    }
    throw error;
  } finally {
    await removeStateTree(collisionBackup);
  }
}

async function removeStateTree(target: string): Promise<void> {
  await fs.rm(target, STATE_TREE_RM_OPTIONS);
}

async function renameStateDirectoryIntoPlace(next: string, target: string, collisionBackup: string): Promise<void> {
  try {
    await fs.rename(next, target);
  } catch (error) {
    const code = fileErrorCode(error);
    if (code !== "ENOTEMPTY" && code !== "EEXIST") {
      throw error;
    }
    if (!await exists(target)) {
      throw error;
    }
    await removeStateTree(collisionBackup);
    await fs.rename(target, collisionBackup);
    await fs.rename(next, target);
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
    await writeFileAtomically(filePath, `${value}\n`);
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
      remediation: "workbench skill publish",
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
  await writeFileAtomically(remotesFile(root), `${YAML.stringify(value).trimEnd()}\n`);
}

async function withMaterializedVersionRoot<T>(
  version: WorkbenchVersion,
  fn: (root: string) => Promise<T>,
): Promise<T> {
  assertPackageSourceFilesOnly(version.files);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-version-source-"));
  try {
    await writeSurfaceFiles(tempRoot, version.files);
    return await fn(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
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
        remediation: "workbench skill publish",
        exitCode: 2,
      });
    }
    throw new WorkbenchCodedError("remote_required", "Multiple remotes are configured and none is named origin; name the remote to use.", {
      remediation: "workbench skill show",
      subject: { remotes: remotes.map((entry) => entry.name) },
      exitCode: 2,
    });
  }
  const remoteName = name;
  const remote = state.remotes[remoteName];
  if (!remote) {
    throw new WorkbenchCodedError("remote_not_found", `Remote not found: ${remoteName}`, {
      remediation: "workbench skill show",
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
      remediation: "workbench skill versions",
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
  traces?: readonly WorkbenchTrace[];
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
    ...(evidence.coverage ? { requestedSamples: evidence.coverage.planned } : {}),
    ...(evidence.error ? { error: evidence.error } : {}),
  } : undefined;
}

type InternalComparisonEvidence = {
  runId: string;
  jobIds: string[];
  status: WorkbenchRun["status"];
  createdAt: string;
  score?: number;
  coverage?: WorkbenchSampleCoverage;
  report?: WorkbenchJobReport;
  error?: string;
};

function bestCompatibleEvalEvidence(args: {
  state: WorkbenchProjectState;
  skillBundle: WorkbenchSkillBundleSnapshot;
  evalSnapshot: WorkbenchEvalSnapshot;
  agent: WorkbenchAgent;
}): InternalComparisonEvidence | undefined {
  const target: WorkbenchEvaluationRunTarget = {
    skillBundle: args.skillBundle,
    agent: args.agent,
  };
  const runtimeCases = args.evalSnapshot.cases.map(evalRuntimeCaseFromSnapshot);
  if (runtimeCases.length === 0) {
    return undefined;
  }
  const runsById = new Map(args.state.runs.map((run) => [run.id, run]));
  const agentHash = hashJson(args.agent);
  const compatibleJobs: WorkbenchJob[] = [];
  const completedCaseSamples = new Set<string>();
  const plannedCaseSamples = new Set<string>();
  for (const runtimeCase of runtimeCases) {
    const observedSamples = compatibleObservedSamples(args.state.jobs, {
      skillBundleHash: args.skillBundle.hash,
      agentHash,
      caseId: runtimeCase.id,
    });
    for (const sample of observedSamples.length > 0 ? observedSamples : [0]) {
      plannedCaseSamples.add(`${runtimeCase.id}\0${sample}`);
      const runInputHash = workbenchRunInputHash({
        evalSnapshot: args.evalSnapshot,
        target,
        runtimeCase,
        sample,
      });
      const runJob = args.state.jobs
        .filter((job) =>
          job.role === "run" &&
          job.skillBundleHash === args.skillBundle.hash &&
          job.agentHash === agentHash &&
          job.caseId === runtimeCase.id &&
          job.sample === sample &&
          job.inputHash === runInputHash
        )
        .sort(compareJobsNewestFirst)[0];
      if (!runJob) {
        continue;
      }
      compatibleJobs.push(runJob);
      const caseRequiresGrade = skillEvalCaseHasConcreteGrader({
        evalSnapshot: args.evalSnapshot,
        runtimeCase,
        agent: args.agent,
      });
      if (!caseRequiresGrade && runJob.status === "succeeded") {
        completedCaseSamples.add(`${runtimeCase.id}\0${sample}`);
        continue;
      }
      const gradeJob = selectReusableWorkbenchGradeJob({
        state: args.state,
        evalSnapshot: args.evalSnapshot,
        runtimeCase,
        agent: args.agent,
        executionJob: runJob,
      });
      if (gradeJob) {
        compatibleJobs.push(gradeJob);
        if (workbenchJobScore(gradeJob) !== undefined || gradeJob.status === "succeeded") {
          completedCaseSamples.add(`${runtimeCase.id}\0${sample}`);
        }
      }
    }
  }
  const jobs = dedupeJobs(compatibleJobs);
  if (jobs.length === 0) {
    return undefined;
  }
  const representativeRun = representativeRunForCompatibleJobs(jobs, runsById);
  const createdAt = representativeRun?.createdAt ?? jobs.map(jobObservedAt).sort().at(-1) ?? now();
  const status = workbenchRunStatusFromJobs(jobs, representativeRun?.status ?? "succeeded");
  const scoredJobs = jobs.filter((job) => workbenchJobScore(job) !== undefined);
  const score = status === "canceled" || scoredJobs.length === 0
    ? undefined
    : averageScores(scoredJobs.map(workbenchJobScore));
  const errors = jobs.flatMap((job) => job.error ? [job.error] : []);
  const coverage = workbenchSampleCoverage(completedCaseSamples.size, plannedCaseSamples.size);
  return {
    runId: representativeRun?.id ?? jobs[0]!.runId,
    jobIds: jobs.map((job) => job.id),
    status,
    createdAt,
    ...(score !== undefined ? { score } : {}),
    ...(coverage ? { coverage } : {}),
    report: buildWorkbenchJobReport(jobs, args.state.traces),
    ...(errors.length > 0 ? { error: summarizeJobErrors(errors) } : representativeRun?.error ? { error: representativeRun.error } : {}),
  };
}

function representativeRunForCompatibleJobs(
  jobs: readonly WorkbenchJob[],
  runsById: ReadonlyMap<string, WorkbenchRun>,
): WorkbenchRun | undefined {
  const jobIds = new Set(jobs.map((job) => job.id));
  return [...runsById.values()]
    .map((run) => ({ run, jobCount: run.jobIds.filter((jobId) => jobIds.has(jobId)).length }))
    .filter(({ jobCount }) => jobCount > 0)
    .sort((left, right) =>
      right.jobCount - left.jobCount ||
      right.run.createdAt.localeCompare(left.run.createdAt) ||
      right.run.id.localeCompare(left.run.id)
    )[0]?.run;
}

function compatibleObservedSamples(
  jobs: readonly WorkbenchJob[],
  args: { skillBundleHash: string; agentHash: string; caseId: string },
): number[] {
  const samples = jobs
    .filter((job) =>
      job.skillBundleHash === args.skillBundleHash &&
      job.agentHash === args.agentHash &&
      job.caseId === args.caseId &&
      Number.isInteger(job.sample) &&
      job.sample >= 0
    )
    .map((job) => job.sample);
  return [...new Set(samples)].sort((left, right) => left - right);
}

function bestScoredComparableEvidence(args: {
  runs: readonly WorkbenchRun[];
  jobs: readonly WorkbenchJob[];
  traces?: readonly WorkbenchTrace[];
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
      (right.coverage?.planned ?? 0) - (left.coverage?.planned ?? 0) ||
      right.createdAt.localeCompare(left.createdAt)
    )[0];
}

function matchingComparisonMeasurements(args: {
  runs: readonly WorkbenchRun[];
  jobs: readonly WorkbenchJob[];
  traces?: readonly WorkbenchTrace[];
  versionId: string;
  skillName: string;
  skillBundleHash: string;
  evalHash: string;
  agentName: string;
  agentHash: string;
}): InternalComparisonEvidence[] {
  const jobsById = new Map(args.jobs.map((job) => [job.id, job]));
  const measurements: InternalComparisonEvidence[] = [];
  for (const run of matchingRuns(args)) {
    const runJobs = run.jobIds.flatMap((jobId) => jobsById.get(jobId) ?? []);
    const matchingJobs = runJobs.filter((job) =>
      job.caseId !== "current" &&
      job.versionId === args.versionId &&
      job.skillName === args.skillName &&
      job.skillBundleHash === args.skillBundleHash &&
      job.evalHash === args.evalHash &&
      job.agentName === args.agentName &&
      job.agentHash === args.agentHash
    );
    if (matchingJobs.length > 0) {
      measurements.push(comparisonEvidenceFromJobs(run, matchingJobs, runJobs, args.traces ?? []));
    } else {
      measurements.push(comparisonEvidenceFromRun(run, args.jobs, args.traces ?? []));
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

function comparisonEntryKey(
  versionId: string,
  skillName: string,
  skillBundleHash: string,
  evalHash: string,
): string {
  return `${versionId}\0${skillName}\0${skillBundleHash}\0${evalHash}`;
}

function comparisonEvidenceFromRun(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
  traces: readonly WorkbenchTrace[] = [],
): InternalComparisonEvidence {
  const runJobs = jobs.filter((job) => workbenchRunOwnsJob(run, job) && job.caseId !== "current");
  const score = runQualityScoreFromJobs(run, jobs);
  const coverage = workbenchSampleCoverageForJobs(runJobs);
  return {
    runId: run.id,
    jobIds: runJobs.map((job) => job.id),
    status: run.status,
    createdAt: run.createdAt,
    ...(score !== undefined ? { score } : {}),
    ...(coverage ? { coverage } : {}),
    ...(runJobs.length > 0 ? { report: buildWorkbenchJobReport(runJobs, traces) } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

function comparisonEvidenceFromJobs(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
  allRunJobs: readonly WorkbenchJob[],
  traces: readonly WorkbenchTrace[] = [],
): InternalComparisonEvidence {
  const scoredJobs = jobs.filter((job) => workbenchJobScore(job) !== undefined);
  const coverage = workbenchSampleCoverageForJobs(jobs);
  const errors = jobs.flatMap((job) => job.error ? [job.error] : []);
  const everyRunJobMatches = allRunJobs.filter((job) => job.caseId !== "current").every((job) => jobs.some((entry) => entry.id === job.id));
  const status = workbenchRunStatusFromJobs(jobs, run.status);
  const score = status === "canceled" || scoredJobs.length === 0
    ? undefined
    : averageScores(scoredJobs.map(workbenchJobScore));
  return {
    runId: run.id,
    jobIds: jobs.map((job) => job.id),
    status,
    createdAt: run.createdAt,
    ...(score !== undefined ? { score } : {}),
    ...(coverage ? { coverage } : {}),
    report: buildWorkbenchJobReport(jobs, traces),
    ...(errors.length > 0 ? { error: summarizeJobErrors(errors) } : run.error && everyRunJobMatches ? { error: run.error } : {}),
  };
}

function comparisonCellEvidenceFields(
  evidence: InternalComparisonEvidence,
): Pick<InternalComparisonCell, "runId" | "jobIds" | "status" | "score" | "coverage" | "report" | "error"> {
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
  const selected = comparisonAgentSelection(selection, options.defaultAgent);
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

  for (const agent of options.availableAgents ?? state.agents) {
    const snapshot = agentSnapshot(agent);
    if (!comparisonAgentSelectionIncludes(selected, agent.name, snapshot.hash)) {
      continue;
    }
    agents.set(snapshot.hash, snapshot);
  }

  return sortComparisonAgentSnapshots([...agents.values()]);
}

function sortComparisonAgentSnapshots(agents: WorkbenchAgentSnapshot[]): WorkbenchAgentSnapshot[] {
  return agents.sort((left, right) =>
    compareWorkbenchNaturalText(left.agent.name, right.agent.name) || left.hash.localeCompare(right.hash)
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

export function nextJobId(): string {
  return nextObjectId("job");
}

export function nextArtifactId(): string {
  return nextObjectId("artifact");
}

export function hashWorkbenchImproveInput(input: {
  baseVersionId: string;
  skillBundleHash: string;
  evalHash: string;
  agentHash: string;
  evidenceTraceIds: readonly string[];
  samples: number;
  budget: number;
}): string {
  return hashJson({
    schema: "workbench.improve-input.v1",
    ...input,
    evidenceTraceIds: [...input.evidenceTraceIds].sort(),
  });
}

function nextObjectId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(8).toString("hex")}`;
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
  const existingTerminal = isWorkbenchRunStatusTerminal(existing.status);
  const incomingTerminal = isWorkbenchRunStatusTerminal(run.status);
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
  const existingTerminal = isWorkbenchJobStatusTerminal(existing.status);
  const incomingTerminal = isWorkbenchJobStatusTerminal(job.status);
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
    inputHash: job.inputHash,
    versionId: job.versionId,
    skillName: job.skillName,
    skillBundleHash: job.skillBundleHash,
    evalHash: job.evalHash,
    agentName: job.agentName,
    agentHash: job.agentHash,
    caseId: job.caseId,
    sample: job.sample,
    command: job.command,
    purpose: extra?.purpose,
    improvementTraceIds: extra?.improvementTraceIds,
    improvementSamples: extra?.improvementSamples,
  };
}

function mergeRunningRun(existing: WorkbenchRun, incoming: WorkbenchRun): WorkbenchRun {
  const preserveCanceling = existing.status === "canceling" && !isWorkbenchRunStatusTerminal(incoming.status);
  return {
    ...existing,
    ...incoming,
    status: preserveCanceling ? "canceling" : incoming.status,
    ...(preserveCanceling && existing.cancelRequestedAt ? { cancelRequestedAt: existing.cancelRequestedAt } : {}),
    jobIds: Array.from(new Set([...existing.jobIds, ...incoming.jobIds])),
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
    throw new WorkbenchUserError("Workbench is not initialized here. Run `workbench skill new` first.");
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

function projectLockDir(root: string): string {
  return path.join(workbenchDir(root), LOCKS_DIR, PROJECT_LOCK_DIR);
}

function stateBackupDir(root: string, name: string): string {
  return path.join(workbenchDir(root), TMP_DIR, `${name}.previous`);
}

function syncDir(root: string): string {
  return path.join(workbenchDir(root), SYNC_DIR);
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
    if (fileErrorCode(error) === "ENOENT") return [];
    throw error;
  }
}

async function pendingSyncCount(root: string): Promise<number> {
  return (await readRemoteSyncStates(root)).filter((state) => state.status === "error").length;
}

function parseRemoteSyncState(value: unknown): WorkbenchRemoteSyncState | null {
  const record = asRecord(value);
  const remote = record?.remote;
  const url = record?.url;
  const status = record?.status;
  const lastAttemptAt = record?.lastAttemptAt;
  const localHash = record?.localHash;
  const lastSyncedAt = record?.lastSyncedAt;
  if (
    record?.schema !== "workbench.remote-sync-state.v1" ||
    typeof remote !== "string" ||
    typeof url !== "string" ||
    (status !== "synced" && status !== "error") ||
    typeof lastAttemptAt !== "string" ||
    (status === "synced" && (typeof localHash !== "string" || typeof lastSyncedAt !== "string"))
  ) return null;
  const lastError = asRecord(record.lastError);
  const base = {
    schema: "workbench.remote-sync-state.v1" as const,
    remote,
    url,
    lastAttemptAt,
    ...(typeof record.pushed === "number" ? { pushed: record.pushed } : {}),
    ...(typeof record.pulled === "number" ? { pulled: record.pulled } : {}),
  };
  if (status === "synced") {
    if (typeof localHash !== "string" || typeof lastSyncedAt !== "string") return null;
    return { ...base, status: "synced", localHash, lastSyncedAt, lastError: null };
  }
  return {
    ...base,
    status: "error",
    ...(typeof record.lastSyncedAt === "string" ? { lastSyncedAt: record.lastSyncedAt } : {}),
    lastError: lastError && typeof lastError.code === "string" && typeof lastError.message === "string"
      ? { code: lastError.code, message: lastError.message }
      : null,
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

function pendingCloudOperationsDir(root: string): string {
  return path.join(workbenchDir(root), LIVE_DIR, "pending-cloud-operations");
}

function pendingCloudOperationPath(root: string, operationId: string): string {
  return path.join(pendingCloudOperationsDir(root), `${safeObjectFileName(operationId)}.json`);
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
      return requestedAt && !isWorkbenchRunStatusTerminal(run.status)
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
    grade: copyGradePlan(evalSnapshot.grade),
    gradeAdapters: evalSnapshot.gradeAdapters.map(copyGradeAdapterOption),
    cases,
  };
}

function copyEvalCase(evalCase: WorkbenchEvalCaseSnapshot): WorkbenchEvalCaseSnapshot {
  return {
    ...evalCase,
    grade: copyGradePlan(evalCase.grade),
    files: evalCase.files.map(copyFile),
  };
}

function copyGradePlan(grade: WorkbenchGradePlan): WorkbenchGradePlan {
  return {
    ...grade,
    sources: grade.sources.map((source) => ({ ...source })),
    display: grade.display.map(copyGradePlanDisplayBlock),
    authoring: grade.authoring.map(copyGradePlanAuthoringControl),
  };
}

function copyGradeAdapterOption(option: WorkbenchGradeAdapterOption): WorkbenchGradeAdapterOption {
  return {
    ...option,
    authoring: option.authoring.map(copyGradePlanAuthoringControl),
  };
}

function copyGradePlanAuthoringControl(
  control: WorkbenchGradePlanAuthoringControl,
): WorkbenchGradePlanAuthoringControl {
  if (control.kind === "list") {
    return {
      ...control,
      fields: control.fields.map(copyGradePlanAuthoringListField),
      ...(control.defaultItems ? { defaultItems: control.defaultItems.map((entry) => ({ ...entry })) } : {}),
    };
  }
  if (control.kind === "choice") {
    return {
      ...control,
      options: control.options.map((option) => ({ ...option })),
    };
  }
  return { ...control };
}

function copyGradePlanAuthoringListField(
  field: WorkbenchGradePlanAuthoringListField,
): WorkbenchGradePlanAuthoringListField {
  if (field.kind === "choice") {
    return {
      ...field,
      options: field.options.map((option) => ({ ...option })),
    };
  }
  return { ...field };
}

function copyGradePlanDisplayBlock(block: WorkbenchGradePlanDisplayBlock): WorkbenchGradePlanDisplayBlock {
  if (block.kind === "key_value") {
    return { ...block, items: block.items.map((item) => ({ ...item })) };
  }
  if (block.kind === "list") {
    return { ...block, items: block.items.map((item) => ({ ...item })) };
  }
  if (block.kind === "files") {
    return { ...block, files: block.files.map((file) => ({ ...file })) };
  }
  return { ...block };
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
  return uniqueResolvedAgentSnapshots(agents.map(agentSnapshot));
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
    compareWorkbenchNaturalText(left.agent.name, right.agent.name) || left.hash.localeCompare(right.hash)
  );
}

function copyRun(run: WorkbenchRun): WorkbenchRun {
  return {
    id: run.id,
    kind: run.kind,
    versionId: run.versionId,
    skillName: run.skillName,
    skillBundleHash: run.skillBundleHash,
    evalHash: run.evalHash,
    agentName: run.agentName,
    agentHash: run.agentHash,
    status: run.status,
    ...(run.operationPlan !== undefined ? { operationPlan: copyOperationPlanSummary(run.operationPlan) } : {}),
    jobIds: [...run.jobIds],
    traceIds: [...run.traceIds],
    createdAt: run.createdAt,
    ...(run.finishedAt !== undefined ? { finishedAt: run.finishedAt } : {}),
    ...(run.parentRunId !== undefined ? { parentRunId: run.parentRunId } : {}),
    ...(run.location !== undefined ? { location: run.location } : {}),
    ...(run.remoteName !== undefined ? { remoteName: run.remoteName } : {}),
    ...(run.baseVersionId !== undefined ? { baseVersionId: run.baseVersionId } : {}),
    ...(run.requestedSamples !== undefined ? { requestedSamples: run.requestedSamples } : {}),
    ...(run.requestedBudget !== undefined ? { requestedBudget: run.requestedBudget } : {}),
    ...(run.retryOfRunId !== undefined ? { retryOfRunId: run.retryOfRunId } : {}),
    ...(run.cancelRequestedAt !== undefined ? { cancelRequestedAt: run.cancelRequestedAt } : {}),
    ...(run.lastProgressAt !== undefined ? { lastProgressAt: run.lastProgressAt } : {}),
    ...(run.outputVersionId !== undefined ? { outputVersionId: run.outputVersionId } : {}),
    ...(run.error !== undefined ? { error: run.error } : {}),
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
    remotes: Object.fromEntries(Object.entries(state.remotes).map(([name, remote]) => [name, { ...remote }])),
    ...copyProjectObjectGraph(state),
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

function caseCommandFromRecord(record: Record<string, unknown>): string | undefined {
  if (typeof record.command === "string" && record.command.trim()) {
    return record.command.trim();
  }
  return undefined;
}

function caseDescriptionFromRecord(record: Record<string, unknown>): string | undefined {
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
  return record.smoke === true;
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeJsonFileAtomically(filePath, value);
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
}

async function writeJsonl(filePath: string, values: readonly unknown[]): Promise<void> {
  await writeFileAtomically(filePath, values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : ""));
}

async function readJsonl(filePath: string): Promise<unknown[]> {
  if (!await exists(filePath)) {
    return [];
  }
  const lines = (await fs.readFile(filePath, "utf8")).split(/\r?\n/u).filter(Boolean);
  return lines.map((line) => JSON.parse(line) as unknown);
}

export function createEmptyWorkbenchProjectState(root: string): WorkbenchProjectState {
  return {
    schema: STATE_SCHEMA,
    root,
    refs: {},
    remotes: {},
    ...emptyWorkbenchProjectObjects(),
  };
}

const emptyWorkbenchState = createEmptyWorkbenchProjectState;

function parseWorkbenchState(value: unknown): WorkbenchProjectState {
  try {
    return parseWorkbenchProjectState(value);
  } catch (error) {
    if (error instanceof WorkbenchStateValidationError) {
      throw new WorkbenchUserError(error.message);
    }
    throw error;
  }
}
