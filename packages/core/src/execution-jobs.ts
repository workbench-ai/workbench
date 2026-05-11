import type {
  HostedWorkbenchJob,
  Json,
  SurfaceSnapshotFile,
  WorkbenchExecutionSpec,
} from "@workbench-ai/workbench-contract";

import {
  compileWorkbenchExecutionGraph,
} from "./execution-graph.ts";
import type {
  GenericRunSpec,
  GenericTaskSpec,
} from "./generic-spec.ts";
import {
  parseGenericTaskSpec,
} from "./generic-spec.ts";

export type WorkbenchRunWorkflow = "eval" | "improve";

export const MAX_WORKBENCH_RUN_BUDGET = 20;
const TASK_CONTROL_FILE = "task.yaml";
const TASK_INPUT_PREFIX = "input/";
const TASK_EXPECTED_PREFIX = "expected/";

export function expectedWorkbenchRunJobCount(args: {
  workflow: WorkbenchRunWorkflow;
  budget: number;
  samples: number;
  caseCount: number;
  gradeJobCount?: number;
}): number {
  const caseCount = Math.max(1, Math.floor(args.caseCount));
  const gradeJobCount = Math.max(1, Math.floor(args.gradeJobCount ?? 1));
  if (args.workflow === "improve") {
    return args.budget *
      (1 + (args.samples * caseCount * (1 + gradeJobCount)));
  }
  return 1 + (args.samples * caseCount * (1 + gradeJobCount));
}

export function validateWorkbenchRunEnvelope(args: {
  workflow: WorkbenchRunWorkflow;
  budget: number;
  samples: number;
  caseCount: number;
  gradeJobCount?: number;
}): string | null {
  if (!Number.isSafeInteger(args.budget) || args.budget <= 0) {
    return "Run budget must be a positive integer.";
  }
  if (!Number.isSafeInteger(args.samples) || args.samples <= 0) {
    return "Run samples must be a positive integer.";
  }
  if (!Number.isSafeInteger(args.caseCount) || args.caseCount <= 0) {
    return "Run case count must be a positive integer.";
  }
  if (args.budget > MAX_WORKBENCH_RUN_BUDGET) {
    return `Run budget cannot exceed ${MAX_WORKBENCH_RUN_BUDGET}.`;
  }
  return null;
}

export function gradeJobCountForRunSpec(_spec: GenericRunSpec): number {
  return 1;
}

export function planWorkbenchExecutionJobsForPurpose(args: {
  ownerUserId: string;
  projectId: string;
  runId: string;
  candidateId: string;
  trialIndex: number;
  samples: number;
  caseIds?: readonly string[];
  spec: GenericRunSpec;
  workflow: WorkbenchRunWorkflow;
  purpose: WorkbenchExecutionSpec["purpose"];
  now: string;
  baseFiles?: readonly SurfaceSnapshotFile[];
  caseFiles?: readonly SurfaceSnapshotFile[];
  traceFiles?: readonly SurfaceSnapshotFile[];
  environmentRef?: string;
  baseId?: string | null;
}): HostedWorkbenchJob[] {
  const jobs: HostedWorkbenchJob[] = [];
  const caseIds = args.caseIds && args.caseIds.length > 0
    ? [...args.caseIds]
    : caseExecutionIds(args.caseFiles ?? []);
  if (caseIds.length === 0) {
    throw new Error("Run planning requires at least one task.yaml in the task snapshot.");
  }
  for (const caseId of caseIds) {
    for (let sampleIndex = 0; sampleIndex < args.samples; sampleIndex += 1) {
      const graph = compileWorkbenchExecutionGraph({
        ownerUserId: args.ownerUserId,
        projectId: args.projectId,
        runId: args.runId,
        candidateId: args.candidateId,
        trialIndex: args.trialIndex,
        sampleIndex,
        caseId,
        spec: args.spec,
        task: taskSpecFromCaseFiles(selectCaseFilesForExecution(args.caseFiles ?? [], caseId), caseId),
        environmentRef: args.environmentRef,
        workflow: args.workflow === "improve" ? "improve" : "eval",
      });
      for (const node of graph.nodes) {
        if (node.execution.purpose !== args.purpose) {
          continue;
        }
        jobs.push(createWorkbenchExecutionJob({
          projectId: args.projectId,
          runId: args.runId,
          candidateId: args.candidateId,
          execution: node.execution,
          dependsOn: node.dependsOn,
          now: args.now,
          ...(args.baseFiles ? { baseFiles: args.baseFiles } : {}),
          ...(args.traceFiles ? { traceFiles: args.traceFiles } : {}),
          ...(args.baseId ? { baseId: args.baseId } : {}),
        }));
      }
    }
  }
  return jobs.filter((job, index) => jobs.findIndex((entry) => entry.id === job.id) === index);
}

export function caseExecutionIds(files: readonly SurfaceSnapshotFile[]): string[] {
  return [...new Set(files.flatMap((file) => {
    const normalized = normalizeRelativePath(file.path);
    if (!normalized.endsWith(`/${TASK_CONTROL_FILE}`)) {
      return [];
    }
    const slash = normalized.indexOf("/");
    return slash > 0 ? [normalized.slice(0, slash)] : [];
  }))].sort();
}

export function selectCaseFilesForExecution(
  files: readonly SurfaceSnapshotFile[],
  caseId: string,
): SurfaceSnapshotFile[] {
  if (caseId === "current") {
    return files.map((file) => ({ ...file }));
  }
  const prefix = `${normalizeRelativePath(caseId)}/`;
  const selected = files
    .filter((file) => normalizeRelativePath(file.path).startsWith(prefix))
    .map((file) => ({
      ...file,
      path: normalizeRelativePath(file.path).slice(prefix.length),
    }));
  if (selected.length === 0) {
    throw new Error(`Task ${caseId} has no files in the uploaded task snapshot.`);
  }
  return selected.sort((left, right) => left.path.localeCompare(right.path));
}

export function selectTaskCaseFiles(
  files: readonly SurfaceSnapshotFile[],
  caseId: string,
): SurfaceSnapshotFile[] {
  const normalized = files.map((file) => ({
    ...file,
    path: normalizeRelativePath(file.path),
  }));
  if (normalized.some((file) => isTaskCaseRootPath(file.path))) {
    return normalized.sort((left, right) => left.path.localeCompare(right.path));
  }
  return selectCaseFilesForExecution(normalized, caseId);
}

export function taskSpecFromCaseFiles(
  files: readonly SurfaceSnapshotFile[],
  caseId: string,
): GenericTaskSpec {
  assertTaskCaseLayout(files, caseId);
  const taskFile = files.find((file) => normalizeRelativePath(file.path) === TASK_CONTROL_FILE && file.encoding === "utf8");
  if (!taskFile) {
    throw new Error(`Task ${caseId} is missing ${TASK_CONTROL_FILE}.`);
  }
  return parseGenericTaskSpec(taskFile.content, `${caseId}/${TASK_CONTROL_FILE}`);
}

export function selectCaseFilesForRuntimePurpose(
  files: readonly SurfaceSnapshotFile[],
  caseId: string,
  purpose: "run-task" | "grade-task",
): SurfaceSnapshotFile[] {
  assertTaskCaseLayout(files, caseId);
  return files
    .filter((file) => {
      const filePath = normalizeRelativePath(file.path);
      if (filePath === TASK_CONTROL_FILE) {
        return false;
      }
      if (filePath.startsWith(TASK_INPUT_PREFIX)) {
        return true;
      }
      return purpose === "grade-task" && filePath.startsWith(TASK_EXPECTED_PREFIX);
    })
    .map((file) => ({ ...file, path: normalizeRelativePath(file.path) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function assertTaskCaseLayout(
  files: readonly SurfaceSnapshotFile[],
  caseId: string,
): void {
  const invalid = files
    .map((file) => normalizeRelativePath(file.path))
    .filter((filePath) => !isTaskCaseRootPath(filePath));
  if (invalid.length > 0) {
    throw new Error(
      `Task ${caseId} contains unsupported file${invalid.length === 1 ? "" : "s"} outside task.yaml, input/, or expected/: ${invalid.join(", ")}`,
    );
  }
}

function isTaskCaseRootPath(filePath: string): boolean {
  return (
    filePath === TASK_CONTROL_FILE ||
    filePath.startsWith(TASK_INPUT_PREFIX) ||
    filePath.startsWith(TASK_EXPECTED_PREFIX)
  );
}

export function createWorkbenchExecutionJob(args: {
  projectId: string;
  runId: string;
  candidateId: string;
  execution: WorkbenchExecutionSpec;
  dependsOn: readonly string[];
  now: string;
  baseFiles?: readonly SurfaceSnapshotFile[];
  traceFiles?: readonly SurfaceSnapshotFile[];
  baseId?: string | null;
}): HostedWorkbenchJob {
  const trialIndex = readExecutionMetadataNumber(args.execution, "trialIndex");
  const sampleIndex = readExecutionMetadataNumber(args.execution, "sampleIndex");
  const caseId = readExecutionMetadataString(args.execution, "caseId");
  return {
    id: workbenchExecutionJobId(args.execution.id),
    projectId: args.projectId,
    runId: args.runId,
    candidateId: args.candidateId,
    kind: "execute",
    status: "queued",
    attempt: 0,
    createdAt: args.now,
    updatedAt: args.now,
    input: {
      execution: args.execution,
      dependsOn: args.dependsOn.map(workbenchExecutionJobId),
      candidateId: args.candidateId,
      trialIndex,
      sampleIndex,
      caseId,
      ...(args.baseFiles ? { baseFiles: args.baseFiles.map((file) => ({ ...file })) } : {}),
      ...(args.traceFiles ? { traceFiles: args.traceFiles.map((file) => ({ ...file })) } : {}),
      ...(args.baseId ? { baseId: args.baseId } : {}),
    } as unknown as Json,
  };
}

export function createSyntheticProposalExecution(args: {
  ownerUserId: string;
  projectId: string;
  runId: string;
  candidateId: string;
  trialIndex: number;
}): WorkbenchExecutionSpec {
  return {
    id: `exec_${args.runId.replace(/[^a-z0-9_]/giu, "_")}_trial_${String(args.trialIndex).padStart(3, "0")}_case_current_sample_000_improve`,
    projectId: args.projectId,
    runId: args.runId,
    candidateId: args.candidateId,
    purpose: "improve",
    adapter: {
      use: "synthetic",
      with: {},
    },
    sandbox: {
      kind: "snapshot",
      ref: "workbench/synthetic-baseline",
    },
    inputs: [],
    outputs: [{
      name: "candidate_patch",
      schema: "workbench.candidate_patch.v1",
      required: true,
    }],
    policy: {
      tenantId: args.ownerUserId,
      resources: {
        cpu: 1,
        memoryGb: 1,
        diskGb: 1,
        timeoutMinutes: 1,
      },
      network: {
        egress: "none",
      },
    },
    metadata: {
      trialIndex: args.trialIndex,
      sampleIndex: 0,
      caseId: "current",
      synthetic: true,
    },
  };
}

export function createSyntheticProposalJob(args: {
  ownerUserId: string;
  projectId: string;
  runId: string;
  candidateId: string;
  files: readonly SurfaceSnapshotFile[];
  now: string;
  baseId: string | null;
  trialIndex: number;
  fileSet?: Json;
}): HostedWorkbenchJob {
  const execution = createSyntheticProposalExecution({
    ownerUserId: args.ownerUserId,
    projectId: args.projectId,
    runId: args.runId,
    candidateId: args.candidateId,
    trialIndex: args.trialIndex,
  });
  const files = args.files.map((file) => ({ ...file }));
  return {
    id: workbenchExecutionJobId(execution.id),
    projectId: args.projectId,
    runId: args.runId,
    candidateId: args.candidateId,
    kind: "execute",
    status: "succeeded",
    attempt: 1,
    createdAt: args.now,
    startedAt: args.now,
    finishedAt: args.now,
    updatedAt: args.now,
    input: {
      execution,
      dependsOn: [],
      candidateId: args.candidateId,
      trialIndex: args.trialIndex,
      synthetic: true,
    } as unknown as Json,
    output: {
      ok: true,
      executionId: execution.id,
      purpose: "improve",
      candidateId: args.candidateId,
      trialIndex: args.trialIndex,
      baseId: args.baseId,
      candidatePatch: {
        files,
        fileChanges: [],
      },
      fileChanges: [],
      files,
      ...(args.fileSet ? { fileSet: args.fileSet } : {}),
      traces: [],
    } as unknown as Json,
  };
}

export function workbenchExecutionJobId(executionId: string): string {
  return `job_${executionId.replace(/[^a-z0-9_]/giu, "_")}`;
}

export function workbenchExecutionJobPurpose(job: HostedWorkbenchJob): WorkbenchExecutionSpec["purpose"] | null {
  if (job.kind !== "execute") {
    return null;
  }
  const execution = asRecord(asRecord(job.input).execution);
  const purpose = execution.purpose;
  return purpose === "improve" || purpose === "run-task" || purpose === "grade-task" ? purpose : null;
}

function readExecutionMetadataNumber(
  execution: WorkbenchExecutionSpec,
  key: string,
): number {
  const raw = execution.metadata[key];
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  throw new Error(`Execution ${execution.id} is missing numeric metadata.${key}.`);
}

function readExecutionMetadataString(
  execution: WorkbenchExecutionSpec,
  key: string,
): string {
  const raw = execution.metadata[key];
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  throw new Error(`Execution ${execution.id} is missing string metadata.${key}.`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeRelativePath(value: string): string {
  return value.trim().replace(/\\/gu, "/").replace(/^\/+/u, "").replace(/\/+$/u, "");
}
