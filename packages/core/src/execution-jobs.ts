import type {
  RemoteWorkbenchJob,
  Json,
  SurfaceSnapshotFile,
  WorkbenchExecutionSpec,
} from "@workbench-ai/workbench-contract";

import {
  compileWorkbenchExecutionGraph,
} from "./execution-graph.ts";
import type {
  GenericRunSpec,
  WorkbenchEngineCase,
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

export function attemptJobCountForRunSpec(_spec: GenericRunSpec): number {
  return 1;
}

export function planWorkbenchExecutionJobsForPurpose(args: {
  ownerUserId: string;
  projectId: string;
  runId: string;
  versionId: string;
  attemptIndex: number;
  samples: number;
  caseIds?: readonly string[];
  sampleIndexesByCase?: ReadonlyMap<string, readonly number[]>;
  spec: GenericRunSpec;
  workflow: WorkbenchRunWorkflow;
  purpose: WorkbenchExecutionSpec["purpose"];
  now: string;
  baseFiles?: readonly SurfaceSnapshotFile[];
  engineCases: readonly WorkbenchEngineCase[];
  traceFiles?: readonly SurfaceSnapshotFile[];
  environmentRef?: string;
  skillRef?: string;
  caseRef?: string;
  environmentRefsByCase?: ReadonlyMap<string, string>;
  baseId?: string | null;
  metadata?: Record<string, Json>;
}): RemoteWorkbenchJob[] {
  const jobs: RemoteWorkbenchJob[] = [];
  const engineCases = args.engineCases;
  const caseIds = args.caseIds && args.caseIds.length > 0
    ? [...args.caseIds]
    : engineCaseIds(engineCases);
  if (caseIds.length === 0) {
    throw new Error("Run planning requires at least one engine case.");
  }
  for (const caseId of caseIds) {
    const engineCase = engineCaseForCase(engineCases, caseId);
    const sampleIndexes = sampleIndexesForCase({
      caseId,
      samples: args.samples,
      sampleIndexesByCase: args.sampleIndexesByCase,
    });
    for (const sampleIndex of sampleIndexes) {
      const graph = compileWorkbenchExecutionGraph({
        ownerUserId: args.ownerUserId,
        projectId: args.projectId,
        runId: args.runId,
        versionId: args.versionId,
        attemptIndex: args.attemptIndex,
        sampleIndex,
        caseId,
        spec: args.spec,
        engineCase: engineCase.case,
        environmentRef: args.environmentRefsByCase?.get(caseId) ?? args.environmentRef,
        skillRef: args.skillRef,
        caseRef: args.caseRef,
        metadata: args.metadata,
        workflow: args.workflow === "improve" ? "improve" : "eval",
      });
      for (const node of graph.nodes) {
        if (node.execution.purpose !== args.purpose) {
          continue;
        }
        jobs.push(createWorkbenchExecutionJob({
          projectId: args.projectId,
          runId: args.runId,
          versionId: args.versionId,
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

function sampleIndexesForCase(args: {
  caseId: string;
  samples: number;
  sampleIndexesByCase?: ReadonlyMap<string, readonly number[]>;
}): number[] {
  if (!args.sampleIndexesByCase) {
    return Array.from({ length: args.samples }, (_, index) => index);
  }
  return [...new Set(args.sampleIndexesByCase.get(args.caseId) ?? [])]
    .filter((sampleIndex) =>
      Number.isSafeInteger(sampleIndex) &&
      sampleIndex >= 0 &&
      sampleIndex < args.samples
    )
    .sort((left, right) => left - right);
}

export function engineCaseIds(engineCases: readonly WorkbenchEngineCase[]): string[] {
  return [...new Set(engineCases.map((bundle) => bundle.id))].sort();
}

export function engineCaseForCase(
  engineCases: readonly WorkbenchEngineCase[],
  caseId: string,
): WorkbenchEngineCase {
  const engineCase = engineCases.find((bundle) => bundle.id === caseId);
  if (!engineCase) {
    throw new Error(`Engine case not found for case ${caseId}.`);
  }
  return engineCase;
}

export function createWorkbenchExecutionJob(args: {
  projectId: string;
  runId: string;
  versionId: string;
  execution: WorkbenchExecutionSpec;
  dependsOn: readonly string[];
  now: string;
  baseFiles?: readonly SurfaceSnapshotFile[];
  traceFiles?: readonly SurfaceSnapshotFile[];
  baseId?: string | null;
}): RemoteWorkbenchJob {
  const attemptIndex = readExecutionMetadataNumber(args.execution, "attemptIndex");
  const sampleIndex = readExecutionMetadataNumber(args.execution, "sampleIndex");
  const caseId = readExecutionMetadataString(args.execution, "caseId");
  return {
    id: workbenchExecutionJobId(args.execution.id),
    projectId: args.projectId,
    runId: args.runId,
    versionId: args.versionId,
    kind: "execute",
    status: "queued",
    attempt: 0,
    createdAt: args.now,
    updatedAt: args.now,
    input: {
      execution: args.execution,
      dependsOn: args.dependsOn.map(workbenchExecutionJobId),
      versionId: args.versionId,
      attemptIndex,
      sampleIndex,
      caseId,
      ...(args.baseFiles ? { baseFiles: args.baseFiles.map((file) => ({ ...file })) } : {}),
      ...(args.traceFiles ? { traceFiles: args.traceFiles.map((file) => ({ ...file })) } : {}),
      ...(args.baseId ? { baseId: args.baseId } : {}),
    } as unknown as Json,
  };
}

export function workbenchExecutionJobId(executionId: string): string {
  return `job_${executionId.replace(/[^a-z0-9_]/giu, "_")}`;
}

export function workbenchExecutionJobPurpose(job: RemoteWorkbenchJob): WorkbenchExecutionSpec["purpose"] | null {
  if (job.kind !== "execute") {
    return null;
  }
  const execution = asRecord(asRecord(job.input).execution);
  const purpose = execution.purpose;
  return purpose === "improve" || purpose === "attempt" ? purpose : null;
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
