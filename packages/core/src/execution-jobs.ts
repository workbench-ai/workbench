import type {
  WorkbenchExecutionJob,
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
import { asRuntimeRecord } from "./runtime-utils.ts";

type WorkbenchRunWorkflow = "eval" | "improve";

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
}): WorkbenchExecutionJob[] {
  const jobs: WorkbenchExecutionJob[] = [];
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
          kind: args.workflow === "improve" ? "improve" : "eval",
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

function engineCaseIds(engineCases: readonly WorkbenchEngineCase[]): string[] {
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
  kind: "eval" | "improve";
  dependsOn: readonly string[];
  now: string;
  baseFiles?: readonly SurfaceSnapshotFile[];
  traceFiles?: readonly SurfaceSnapshotFile[];
  baseId?: string | null;
}): WorkbenchExecutionJob {
  const attemptIndex = readExecutionMetadataNumber(args.execution, "attemptIndex");
  const sampleIndex = readExecutionMetadataNumber(args.execution, "sampleIndex");
  const caseId = readExecutionMetadataString(args.execution, "caseId");
  const skillName = optionalExecutionMetadataString(args.execution, "skillName") ?? "current";
  const skillBundleHash = optionalExecutionMetadataString(args.execution, "skillBundleHash") ?? args.versionId;
  const evalHash = optionalExecutionMetadataString(args.execution, "evalHash") ?? "current";
  const agentName = optionalExecutionMetadataString(args.execution, "agentName") ?? args.execution.adapter.use;
  const role = args.execution.purpose === "improve"
    ? "improve"
    : optionalExecutionMetadataString(args.execution, "role") === "grade"
      ? "grade"
      : "run";
  return {
    id: workbenchExecutionJobId(args.execution.id),
    projectId: args.projectId,
    runId: args.runId,
    versionId: args.versionId,
    kind: args.kind,
    role,
    inputHash: args.execution.id,
    skillName,
    skillBundleHash,
    evalHash,
    agentName,
    agentHash: optionalExecutionMetadataString(args.execution, "agentHash") ?? agentName,
    caseId,
    sample: sampleIndex,
    status: "queued",
    attempt: 0,
    createdAt: args.now,
    updatedAt: args.now,
    artifactIds: [],
    traceIds: [],
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
    },
  };
}

function optionalExecutionMetadataString(
  execution: WorkbenchExecutionSpec,
  key: string,
): string | undefined {
  const raw = execution.metadata[key];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

export function workbenchExecutionJobId(executionId: string): string {
  return `job_${executionId.replace(/[^a-z0-9_]/giu, "_")}`;
}

export function workbenchExecutionJobPurpose(job: WorkbenchExecutionJob): WorkbenchExecutionSpec["purpose"] | null {
  const execution = asRuntimeRecord(asRuntimeRecord(job.input).execution);
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
