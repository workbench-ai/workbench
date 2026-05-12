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
  WorkbenchTaskBundle,
} from "./generic-spec.ts";

export type WorkbenchRunWorkflow = "eval" | "improve";

export const MAX_WORKBENCH_RUN_BUDGET = 20;

export function expectedWorkbenchRunJobCount(args: {
  workflow: WorkbenchRunWorkflow;
  budget: number;
  samples: number;
  caseCount: number;
}): number {
  const caseCount = Math.max(1, Math.floor(args.caseCount));
  if (args.workflow === "improve") {
    return args.budget * (1 + (args.samples * caseCount));
  }
  return 1 + (args.samples * caseCount);
}

export function validateWorkbenchRunEnvelope(args: {
  workflow: WorkbenchRunWorkflow;
  budget: number;
  samples: number;
  caseCount: number;
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

export function trialJobCountForRunSpec(_spec: GenericRunSpec): number {
  return 1;
}

export function planWorkbenchExecutionJobsForPurpose(args: {
  ownerUserId: string;
  projectId: string;
  runId: string;
  subjectId: string;
  trialIndex: number;
  samples: number;
  caseIds?: readonly string[];
  spec: GenericRunSpec;
  workflow: WorkbenchRunWorkflow;
  purpose: WorkbenchExecutionSpec["purpose"];
  now: string;
  baseFiles?: readonly SurfaceSnapshotFile[];
  taskBundles: readonly WorkbenchTaskBundle[];
  traceFiles?: readonly SurfaceSnapshotFile[];
  environmentRef?: string;
  baseId?: string | null;
}): HostedWorkbenchJob[] {
  const jobs: HostedWorkbenchJob[] = [];
  const taskBundles = args.taskBundles;
  const caseIds = args.caseIds && args.caseIds.length > 0
    ? [...args.caseIds]
    : taskBundleIds(taskBundles);
  if (caseIds.length === 0) {
    throw new Error("Run planning requires at least one task bundle.");
  }
  for (const caseId of caseIds) {
    const taskBundle = taskBundleForCase(taskBundles, caseId);
    for (let sampleIndex = 0; sampleIndex < args.samples; sampleIndex += 1) {
      const graph = compileWorkbenchExecutionGraph({
        ownerUserId: args.ownerUserId,
        projectId: args.projectId,
        runId: args.runId,
        subjectId: args.subjectId,
        trialIndex: args.trialIndex,
        sampleIndex,
        caseId,
        spec: args.spec,
        task: taskBundle.task,
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
          subjectId: args.subjectId,
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

export function taskBundleIds(taskBundles: readonly WorkbenchTaskBundle[]): string[] {
  return [...new Set(taskBundles.map((bundle) => bundle.id))].sort();
}

export function taskBundleForCase(
  taskBundles: readonly WorkbenchTaskBundle[],
  caseId: string,
): WorkbenchTaskBundle {
  const taskBundle = taskBundles.find((bundle) => bundle.id === caseId);
  if (!taskBundle) {
    throw new Error(`Task bundle not found for case ${caseId}.`);
  }
  return taskBundle;
}

export function createWorkbenchExecutionJob(args: {
  projectId: string;
  runId: string;
  subjectId: string;
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
    subjectId: args.subjectId,
    kind: "execute",
    status: "queued",
    attempt: 0,
    createdAt: args.now,
    updatedAt: args.now,
    input: {
      execution: args.execution,
      dependsOn: args.dependsOn.map(workbenchExecutionJobId),
      subjectId: args.subjectId,
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
  subjectId: string;
  trialIndex: number;
}): WorkbenchExecutionSpec {
  return {
    id: `exec_${args.runId.replace(/[^a-z0-9_]/giu, "_")}_trial_${String(args.trialIndex).padStart(3, "0")}_case_current_sample_000_improve`,
    projectId: args.projectId,
    runId: args.runId,
    subjectId: args.subjectId,
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
      name: "subject_patch",
      schema: "workbench.subject_patch.v1",
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
  subjectId: string;
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
    subjectId: args.subjectId,
    trialIndex: args.trialIndex,
  });
  const files = args.files.map((file) => ({ ...file }));
  return {
    id: workbenchExecutionJobId(execution.id),
    projectId: args.projectId,
    runId: args.runId,
    subjectId: args.subjectId,
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
      subjectId: args.subjectId,
      trialIndex: args.trialIndex,
      synthetic: true,
    } as unknown as Json,
    output: {
      ok: true,
      executionId: execution.id,
      purpose: "improve",
      subjectId: args.subjectId,
      trialIndex: args.trialIndex,
      baseId: args.baseId,
      subjectPatch: {
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
	  return purpose === "improve" || purpose === "trial" ? purpose : null;
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
