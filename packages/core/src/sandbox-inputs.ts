import type {
  BlobObjectRef,
  HostedWorkbenchJob,
  Json,
  SurfaceSnapshotFile,
  WorkbenchExecutionCapability,
  WorkbenchExecutionResult,
  WorkbenchExecutionSpec,
  WorkbenchSandboxExecutionMetadata,
} from "@workbench-ai/workbench-contract";

import {
  createWorkbenchSandboxExecutionMetadata,
  type SandboxCreateRequest,
  type SandboxExecutionFileStore,
  type SandboxMaterializedInput,
} from "./sandbox-plane.ts";
import type {
  WorkbenchExecutionRuntimeInput,
} from "./execution-runtime-types.ts";
import {
  asRuntimeRecord,
  importNodeModule,
  isJsonPayload,
  nodeBuiltin,
} from "./runtime-utils.ts";
import {
  selectCaseFilesForRuntimePurpose,
  selectTaskCaseFiles,
} from "./execution-jobs.ts";

export function readWorkbenchExecutionSpec(job: HostedWorkbenchJob): WorkbenchExecutionSpec {
  const input = asRuntimeRecord(job.input);
  const execution = input.execution;
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
    throw new Error(`Execution job ${job.id} is missing input.execution.`);
  }
  return execution as WorkbenchExecutionSpec;
}

export function createWorkbenchSandboxFileStore(args: WorkbenchExecutionRuntimeInput): SandboxExecutionFileStore {
  const outputPayloads = new Map<string, Json>();
  return {
    async materializeInputs(execution) {
      return execution.inputs.map((input) => materializeWorkbenchSandboxInput(args, execution, input));
    },
    async publishJson(capability, outputName, payload) {
      const body = JSON.stringify(payload);
      const ref = await sandboxOutputRef(capability, outputName, body);
      outputPayloads.set(ref.key, payload);
      return ref;
    },
    async readJson(ref) {
      const payload = outputPayloads.get(ref.key);
      if (payload === undefined) {
        throw new Error(`Sandbox output payload is missing: ${ref.key}.`);
      }
      return payload;
    },
  };
}

export function materializeWorkbenchSandboxInput(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
  input: WorkbenchExecutionSpec["inputs"][number],
): SandboxMaterializedInput {
  if (input.name === "candidate") {
    return materializedFileInput(input, args.baseFiles);
  }
  if (input.name === "task") {
    return materializedFileInput(input, selectSandboxTaskFiles(args, execution));
  }
  if (input.name === "traces") {
    return materializedFileInput(input, args.traceFiles ?? []);
  }
  if (input.name === "runner-output") {
    return materializedFileInput(input, args.runnerOutputFiles ?? []);
  }
  throw new Error(`Execution ${readWorkbenchExecutionSpec(args.job).id} declares unsupported sandbox input: ${input.name}.`);
}

function selectSandboxTaskFiles(
  args: WorkbenchExecutionRuntimeInput,
  execution: WorkbenchExecutionSpec,
): SurfaceSnapshotFile[] {
  if (execution.purpose !== "run-task" && execution.purpose !== "grade-task") {
    return [];
  }
  const metadata = asRuntimeRecord(execution.metadata);
  const jobInput = asRuntimeRecord(args.job.input);
  const caseId =
    typeof metadata.caseId === "string"
      ? metadata.caseId
      : typeof jobInput.caseId === "string"
        ? jobInput.caseId
        : "current";
  return selectCaseFilesForRuntimePurpose(
    selectTaskCaseFiles(args.caseFiles, caseId),
    caseId,
    execution.purpose,
  );
}

export function materializedFileInput(
  input: WorkbenchExecutionSpec["inputs"][number],
  files: readonly SurfaceSnapshotFile[],
): SandboxMaterializedInput {
  return {
    input,
    mountPath: input.mountPath,
    kind: "files",
    files: files.map((file) => ({ ...file })),
  };
}

export function createSandboxAdapterRequest(
  args: WorkbenchExecutionRuntimeInput,
  request: SandboxCreateRequest,
  startedAt: string,
): Json {
  return {
    jobInput: {
      job: sanitizeWorkbenchExecutionJobForSandbox(args.job, request.execution) as unknown as Json,
      spec: args.spec as unknown as Json,
      environmentVersion: (args.environmentVersion ?? null) as unknown as Json,
      ...(args.adapterAuthProfiles ? { adapterAuthProfiles: args.adapterAuthProfiles as unknown as Json } : {}),
      ...(args.adapterManifests ? { adapterManifests: args.adapterManifests as unknown as Json } : {}),
      ...(args.progress ? { progress: args.progress as unknown as Json } : {}),
    },
    execution: request.execution as unknown as Json,
    capability: request.capability as unknown as Json,
    inputBundle: {
      inputs: request.inputs.map((input) => materializedInputForSandboxRequest(input) as unknown as Json),
    },
    startedAt,
  };
}

export function sanitizeWorkbenchExecutionJobForSandbox(
  job: HostedWorkbenchJob,
  execution: WorkbenchExecutionSpec,
): HostedWorkbenchJob {
  const input = asRuntimeRecord(job.input);
  const sanitizedInput: Record<string, Json> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "baseFiles" || key === "traceFiles") {
      continue;
    }
    if (isJsonPayload(value)) {
      sanitizedInput[key] = value;
    }
  }
  sanitizedInput.execution = execution as unknown as Json;
  return {
    ...job,
    input: sanitizedInput as unknown as Json,
  };
}

export function materializedInputForSandboxRequest(input: SandboxMaterializedInput): Record<string, Json> {
  const base = {
    input: input.input as unknown as Json,
    mountPath: input.mountPath,
    kind: input.kind,
  };
  if (input.kind === "files") {
    return {
      ...base,
      files: (input.files ?? []).map((file) => ({ ...file })) as unknown as Json,
    };
  }
  return {
    ...base,
    json: (input.json ?? null) as Json,
  };
}

export async function executionResultFromCompletedSandboxJob(args: {
  completedJob: HostedWorkbenchJob;
  execution: WorkbenchExecutionSpec;
  startedAt: string;
  backend: string;
  allocation: WorkbenchSandboxExecutionMetadata["allocation"];
  capability: WorkbenchSandboxExecutionMetadata["capability"];
  handle: WorkbenchSandboxExecutionMetadata["handle"];
  fileStore: SandboxExecutionFileStore;
}): Promise<WorkbenchExecutionResult> {
  const completedJob = withSandboxCompletionMetadata(args.completedJob, {
    backend: args.backend,
    allocation: args.allocation,
    capability: args.capability,
    handle: args.handle,
  });
  if (completedJob.status !== "succeeded") {
    return {
      executionId: args.execution.id,
      status: completedJob.status === "cancelled" ? "cancelled" : "failed",
      startedAt: completedJob.startedAt ?? args.startedAt,
      finishedAt: completedJob.finishedAt ?? new Date().toISOString(),
      outputs: {},
      ...(completedJob.error ? { error: completedJob.error } : {}),
      metadata: {
        backend: args.backend,
        allocation: args.allocation as unknown as Json,
        completedJob: completedJob as unknown as Json,
      },
    };
  }

  const output = asRuntimeRecord(completedJob.output);
  const outputs: WorkbenchExecutionResult["outputs"] = {};
  for (const contract of args.execution.outputs) {
    const payload = outputPayloadForContract(output, contract.name);
    if (payload === undefined) {
      continue;
    }
    const ref = await args.fileStore.publishJson(args.capability, contract.name, payload);
    outputs[contract.name] = ref;
  }
  return {
    executionId: args.execution.id,
    status: "succeeded",
    startedAt: completedJob.startedAt ?? args.startedAt,
    finishedAt: completedJob.finishedAt ?? new Date().toISOString(),
    outputs,
    metadata: {
      backend: args.backend,
      allocation: args.allocation as unknown as Json,
      completedJob: completedJob as unknown as Json,
    },
  };
}

export function outputPayloadForContract(output: Record<string, unknown>, outputName: string): Json | undefined {
  if (outputName === "candidate_patch") {
    return isJsonPayload(output.candidatePatch) ? output.candidatePatch : undefined;
  }
  if (outputName === "scorecard") {
    return isJsonPayload(output.scorecard) ? output.scorecard : undefined;
  }
  return isJsonPayload(output[outputName]) ? output[outputName] : undefined;
}

export async function sandboxOutputRef(
  capability: WorkbenchExecutionCapability,
  outputName: string,
  body: string,
): Promise<BlobObjectRef> {
  const prefix = capability.outputPrefix.endsWith("/") ? capability.outputPrefix : `${capability.outputPrefix}/`;
  const key = `${prefix}${outputName}.json`;
  if (!key.startsWith(prefix)) {
    throw new Error(`Sandbox output ${outputName} escaped capability output prefix.`);
  }
  return {
    bucket: "memory",
    key,
    byteLength: Buffer.byteLength(body, "utf8"),
    sha256: await sha256Hex(body),
  };
}

export async function sha256Hex(body: string): Promise<string> {
  const crypto = await importNodeModule<typeof import("node:crypto")>(nodeBuiltin("crypto"));
  return crypto.createHash("sha256").update(body).digest("hex");
}

export function withSandboxCompletionMetadata(
  job: HostedWorkbenchJob,
  metadata: WorkbenchSandboxExecutionMetadata,
): HostedWorkbenchJob {
  return attachSandboxMetadataToJob(job, createWorkbenchSandboxExecutionMetadata(metadata) as unknown as Json);
}

export function attachSandboxMetadataToJob(
  job: HostedWorkbenchJob,
  metadata: unknown,
): HostedWorkbenchJob {
  const output = asRuntimeRecord(job.output);
  if (!job.output || Array.isArray(job.output) || typeof job.output !== "object") {
    return job;
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return job;
  }
  return {
    ...job,
    output: {
      ...output,
      sandbox: metadata as Json,
    } as unknown as Json,
  };
}

export function isSurfaceSnapshotFile(value: unknown): value is SurfaceSnapshotFile {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as SurfaceSnapshotFile).path === "string" &&
    ((value as SurfaceSnapshotFile).kind === "text" || (value as SurfaceSnapshotFile).kind === "binary") &&
    ((value as SurfaceSnapshotFile).encoding === "utf8" || (value as SurfaceSnapshotFile).encoding === "base64") &&
    typeof (value as SurfaceSnapshotFile).content === "string" &&
    typeof (value as SurfaceSnapshotFile).executable === "boolean",
  );
}
