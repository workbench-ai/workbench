import {
  WORKBENCH_EXECUTION_NETWORK_EGRESS_VALUES,
  type BlobObjectRef,
  type Json,
  type SurfaceSnapshotFile,
  type WorkbenchExecutionCapability,
  type WorkbenchExecutionInputRef,
  type WorkbenchExecutionNetworkPolicy,
  type WorkbenchExecutionResult,
  type WorkbenchExecutionSpec,
  type WorkbenchSandboxAllocation,
  type WorkbenchSandboxExecutionMetadata,
  type WorkbenchSandboxHandle,
} from "@workbench-ai/workbench-contract";

import {
  assertWorkbenchExecutionIsolation,
  validateWorkbenchExecutionOutputPayloads,
  type WorkbenchExecutionOutputPayloads,
} from "./execution-outputs.ts";

export interface SandboxMaterializedInput {
  input: WorkbenchExecutionInputRef;
  mountPath: string;
  kind: "files" | "json";
  files?: SurfaceSnapshotFile[];
  json?: Json;
}

export interface SandboxExecutionFileStore {
  materializeInputs(execution: WorkbenchExecutionSpec): Promise<SandboxMaterializedInput[]>;
  publishJson(capability: WorkbenchExecutionCapability, outputName: string, payload: Json): Promise<BlobObjectRef>;
  readJson(ref: BlobObjectRef): Promise<Json>;
}

interface SandboxExecutionOptions {
  fileStore: SandboxExecutionFileStore;
  runnerId?: string;
  now?: string;
  signal?: AbortSignal;
}

interface WorkbenchSandboxAllocationOptions {
  backend: string;
  runnerId?: string;
  now?: string;
  ttlMs?: number;
  lifecycleId?: string;
  sandboxId?: string;
}

export interface SandboxBackendCapabilities {
  snapshots: boolean;
  interactiveExec: boolean;
  filesystemDiff: boolean;
  networkPolicy: readonly WorkbenchExecutionNetworkPolicy["egress"][];
  fileCapabilities: boolean;
}

export interface SandboxEnvironmentImage {
  backend: string;
  kind: WorkbenchSandboxAllocation["template"]["kind"];
  ref: string;
  metadata?: Record<string, Json>;
}

export type SandboxHandle = WorkbenchSandboxHandle;

export interface SandboxBackendDescriptor {
  name: string;
  version?: string;
  capabilities: SandboxBackendCapabilities;
}

export function createSandboxBackendDescriptor(name: string): SandboxBackendDescriptor {
  return {
    name,
    version: "1",
    capabilities: {
      snapshots: true,
      interactiveExec: false,
      filesystemDiff: false,
      networkPolicy: WORKBENCH_EXECUTION_NETWORK_EGRESS_VALUES,
      fileCapabilities: true,
    },
  };
}

export interface SandboxCreateRequest {
  execution: WorkbenchExecutionSpec;
  environment: SandboxEnvironmentImage;
  allocation: WorkbenchSandboxAllocation;
  capability: WorkbenchExecutionCapability;
  inputs: SandboxMaterializedInput[];
}

export interface SandboxExecRequest {
  execution: WorkbenchExecutionSpec;
  environment: SandboxEnvironmentImage;
  sandbox: SandboxHandle;
  allocation: WorkbenchSandboxAllocation;
  capability: WorkbenchExecutionCapability;
  inputs: SandboxMaterializedInput[];
}

export interface SandboxPlane {
  backend: SandboxBackendDescriptor;
  prepareEnvironment?(execution: WorkbenchExecutionSpec, options: SandboxExecutionOptions): Promise<SandboxEnvironmentImage>;
  createSandbox(request: SandboxCreateRequest, options: SandboxExecutionOptions): Promise<SandboxHandle>;
  exec(request: SandboxExecRequest, options: SandboxExecutionOptions): Promise<WorkbenchExecutionResult>;
  destroySandbox(sandbox: SandboxHandle, options: SandboxExecutionOptions): Promise<void>;
}

interface ValidatedSandboxExecutionResult {
  result: WorkbenchExecutionResult;
  payloads: WorkbenchExecutionOutputPayloads;
}

const SANDBOX_SETUP_TTL_BUFFER_MS = 15 * 60_000;

export async function executeValidatedSandboxExecution(
  plane: SandboxPlane,
  execution: WorkbenchExecutionSpec,
  options: SandboxExecutionOptions,
): Promise<ValidatedSandboxExecutionResult> {
  assertWorkbenchExecutionIsolation(execution);
  assertSandboxBackendSupportsNetworkPolicy(plane.backend, execution);
  throwIfSandboxAborted(options.signal);
  const inputs = await options.fileStore.materializeInputs(execution);
  throwIfSandboxAborted(options.signal);
  const now = options.now ?? new Date().toISOString();
  const timing: Record<string, Json> = {};
  timing.prepareStartedAt = new Date().toISOString();
  const environment = plane.prepareEnvironment
    ? await plane.prepareEnvironment(execution, options)
    : {
        backend: plane.backend.name,
        kind: execution.sandbox.kind,
        ref: execution.sandbox.ref,
      };
  throwIfSandboxAborted(options.signal);
  timing.prepareFinishedAt = new Date().toISOString();
  const allocation = createWorkbenchSandboxAllocation(execution, {
    backend: plane.backend.name,
    runnerId: options.runnerId,
    now,
  });
  const capability = createWorkbenchExecutionCapability(execution, { now });
  assertScopeIssues("Sandbox allocation", collectSandboxAllocationScopeIssues(allocation, execution, { now }));
  assertScopeIssues("Execution capability", collectExecutionCapabilityScopeIssues(capability, execution, { now }));
  timing.createStartedAt = new Date().toISOString();
  throwIfSandboxAborted(options.signal);
  const sandbox = await plane.createSandbox({
    execution,
    environment,
    allocation,
    capability,
    inputs,
  }, options);
  timing.createFinishedAt = new Date().toISOString();
  assertScopeIssues("Sandbox handle", collectSandboxHandleScopeIssues(sandbox, allocation, execution));
  let result: WorkbenchExecutionResult;
  try {
    timing.execStartedAt = new Date().toISOString();
    throwIfSandboxAborted(options.signal);
    result = await plane.exec({
      execution,
      environment,
      sandbox,
      allocation,
      capability,
      inputs,
    }, options);
    timing.execFinishedAt = new Date().toISOString();
  } catch (error) {
    const finishedAt = new Date().toISOString();
    timing.execFinishedAt = finishedAt;
    result = {
      executionId: execution.id,
      status: "failed",
      startedAt: now,
      finishedAt,
      outputs: {},
      error: error instanceof Error ? error.message : String(error),
      metadata: {
        sandbox: createWorkbenchSandboxExecutionMetadata({
          backend: plane.backend.name,
          allocation,
          capability,
          handle: sandbox,
        }) as unknown as Json,
      },
    };
  } finally {
    timing.destroyStartedAt = new Date().toISOString();
    await plane.destroySandbox(sandbox, options);
    timing.destroyFinishedAt = new Date().toISOString();
  }
  result = attachSandboxLifecycleTiming(result, timing);
  if (result.executionId !== execution.id) {
    throw new Error(`Sandbox returned execution id ${result.executionId}, expected ${execution.id}.`);
  }
  if (result.status !== "succeeded") {
    return { result, payloads: {} };
  }

  const outputPayloads: Record<string, Json> = {};
  for (const contract of execution.outputs) {
    const ref = result.outputs[contract.name];
    if (!ref) {
      if (contract.required) {
        throw new Error(`Sandbox result for ${execution.id} omitted required output ref ${contract.name}.`);
      }
      continue;
    }
    outputPayloads[contract.name] = await options.fileStore.readJson(ref);
  }

  return {
    result,
    payloads: validateWorkbenchExecutionOutputPayloads(execution, outputPayloads),
  };
}

function throwIfSandboxAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Run cancellation requested.");
  }
}

export function assertSandboxBackendSupportsNetworkPolicy(
  backend: SandboxBackendDescriptor,
  execution: Pick<WorkbenchExecutionSpec, "id" | "policy">,
): void {
  const egress = execution.policy.network.egress;
  if (!backend.capabilities.networkPolicy.includes(egress)) {
    const supported = backend.capabilities.networkPolicy.join(", ") || "none";
    throw new Error(`Sandbox backend ${backend.name} does not support network egress ${egress} for execution ${execution.id}. Supported egress policies: ${supported}.`);
  }
}

function attachSandboxLifecycleTiming(
  result: WorkbenchExecutionResult,
  timing: Record<string, Json>,
): WorkbenchExecutionResult {
  const metadata = isJsonRecord(result.metadata) ? result.metadata : {};
  const completedJob = isJsonRecord(metadata.completedJob) ? metadata.completedJob : null;
  return {
    ...result,
    metadata: {
      ...metadata,
      sandboxTiming: timing,
      ...(completedJob ? { completedJob: attachTimingToCompletedJob(completedJob, timing) } : {}),
      ...(isJsonRecord(metadata.sandbox)
        ? { sandbox: attachTimingToSandboxMetadata(metadata.sandbox, timing) }
        : {}),
    },
  };
}

function attachTimingToCompletedJob(
  job: Record<string, Json>,
  timing: Record<string, Json>,
): Record<string, Json> {
  if (!isJsonRecord(job.output)) {
    return job;
  }
  const sandbox = isJsonRecord(job.output.sandbox)
    ? attachTimingToSandboxMetadata(job.output.sandbox, timing)
    : undefined;
  return {
    ...job,
    output: {
      ...job.output,
      ...(sandbox ? { sandbox } : {}),
    },
  };
}

function attachTimingToSandboxMetadata(
  sandbox: Record<string, Json>,
  timing: Record<string, Json>,
): Record<string, Json> {
  return {
    ...sandbox,
    timing,
  };
}

export function createWorkbenchSandboxExecutionMetadata(args: WorkbenchSandboxExecutionMetadata): WorkbenchSandboxExecutionMetadata {
  return {
    backend: args.backend,
    allocation: {
      ...args.allocation,
      template: { ...args.allocation.template },
      network: { ...args.allocation.network },
    },
    capability: {
      ...args.capability,
      skill: { ...args.capability.skill },
      inputs: args.capability.inputs.map((input) => ({ ...input })),
      network: { ...args.capability.network },
    },
    handle: {
      ...args.handle,
      template: { ...args.handle.template },
      ...(args.handle.metadata ? { metadata: { ...args.handle.metadata } } : {}),
    },
  };
}

export function collectSandboxHandleScopeIssues(
  sandbox: SandboxHandle,
  allocation: WorkbenchSandboxAllocation,
  execution: WorkbenchExecutionSpec,
): string[] {
  const issues: string[] = [];
  if (sandbox.executionId !== execution.id) {
    issues.push(`Sandbox handle execution id ${sandbox.executionId} does not match ${execution.id}.`);
  }
  if (sandbox.sandboxId !== allocation.sandboxId) {
    issues.push(`Sandbox handle id ${sandbox.sandboxId} does not match allocation ${allocation.sandboxId}.`);
  }
  if (sandbox.lifecycleId !== allocation.lifecycleId) {
    issues.push(`Sandbox handle lifecycle id does not match allocation ${allocation.lifecycleId}.`);
  }
  if (sandbox.backend !== allocation.backend) {
    issues.push(`Sandbox handle backend ${sandbox.backend} does not match allocation ${allocation.backend}.`);
  }
  if (sandbox.template.kind !== allocation.template.kind || sandbox.template.ref !== allocation.template.ref) {
    issues.push(`Sandbox handle template does not match allocation for execution ${execution.id}.`);
  }
  return issues;
}

export function createWorkbenchSandboxAllocation(
  execution: WorkbenchExecutionSpec,
  options: WorkbenchSandboxAllocationOptions,
): WorkbenchSandboxAllocation {
  const nowMs = options.now ? Date.parse(options.now) : Date.now();
  const ttlMs = options.ttlMs ?? workbenchSandboxLifetimeTtlMs(execution);
  const safeExecutionId = execution.id.replace(/[^a-z0-9_]+/giu, "_");
  const nonce = allocationNonce();
  return {
    sandboxId: options.sandboxId ?? `sbx_${safeExecutionId}_${nonce}`,
    executionId: execution.id,
    lifecycleId: options.lifecycleId ?? `lc_${safeExecutionId}_${nowMs}_${nonce}`,
    backend: options.backend,
    runnerId: options.runnerId ?? "local-runner",
    template: { ...execution.sandbox },
    network: { ...execution.policy.network },
    status: "allocated",
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  };
}

function allocationNonce(): string {
  const bytes = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createWorkbenchExecutionCapability(
  execution: WorkbenchExecutionSpec,
  options: {
    now?: string;
    ttlMs?: number;
    outputPrefix?: string;
  } = {},
): WorkbenchExecutionCapability {
  const nowMs = options.now ? Date.parse(options.now) : Date.now();
  const ttlMs = options.ttlMs ?? workbenchSandboxLifetimeTtlMs(execution);
  return {
    executionId: execution.id,
    skill: {
      tenantId: execution.policy.tenantId,
      projectId: execution.projectId,
      runId: execution.runId,
      ...(execution.versionId ? { versionId: execution.versionId } : {}),
    },
    inputs: execution.inputs.map((input) => ({ ...input })),
    outputPrefix: options.outputPrefix ?? `executions/${execution.id}/outputs/`,
    network: { ...execution.policy.network },
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  };
}

function workbenchSandboxLifetimeTtlMs(execution: WorkbenchExecutionSpec): number {
  return Math.max(
    60_000,
    execution.policy.resources.timeoutMinutes * 60_000 + SANDBOX_SETUP_TTL_BUFFER_MS,
  );
}

export function collectExecutionCapabilityScopeIssues(
  capability: WorkbenchExecutionCapability,
  execution: WorkbenchExecutionSpec,
  options: { now?: string } = {},
): string[] {
  const issues: string[] = [];
  if (capability.executionId !== execution.id) {
    issues.push(`Capability execution id ${capability.executionId} does not match ${execution.id}.`);
  }
  if (capability.skill.tenantId !== execution.policy.tenantId) {
    issues.push(`Capability tenant id does not match execution ${execution.id}.`);
  }
  if (capability.skill.projectId !== execution.projectId || capability.skill.runId !== execution.runId) {
    issues.push(`Capability project/run scope does not match execution ${execution.id}.`);
  }
  if ((capability.skill.versionId ?? null) !== (execution.versionId ?? null)) {
    issues.push(`Capability skill version scope does not match execution ${execution.id}.`);
  }
  if (!capability.outputPrefix.startsWith(`executions/${execution.id}/`)) {
    issues.push(`Capability output prefix must be scoped under executions/${execution.id}/.`);
  }
  if (networkPolicyKey(capability.network) !== networkPolicyKey(execution.policy.network)) {
    issues.push(`Capability network policy does not match execution ${execution.id}.`);
  }
  const allowedInputs = new Set(execution.inputs.map((input) => `${input.name}\0${input.ref}\0${input.mountPath}\0${input.writable}`));
  for (const input of capability.inputs) {
    const key = `${input.name}\0${input.ref}\0${input.mountPath}\0${input.writable}`;
    if (!allowedInputs.has(key)) {
      issues.push(`Capability includes input ${input.name} outside execution ${execution.id}.`);
    }
  }
  if (capability.inputs.length !== execution.inputs.length) {
    issues.push(`Capability input count does not match execution ${execution.id}.`);
  }
  const nowMs = options.now ? Date.parse(options.now) : Date.now();
  const expiresAtMs = Date.parse(capability.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    issues.push(`Capability expiresAt must be an ISO timestamp for execution ${execution.id}.`);
  } else if (expiresAtMs <= nowMs) {
    issues.push(`Capability is expired for execution ${execution.id}.`);
  }
  return issues;
}

function networkPolicyKey(policy: WorkbenchExecutionNetworkPolicy | undefined): string {
  if (!policy || typeof policy !== "object") {
    return "<invalid>";
  }
  return JSON.stringify({
    egress: policy.egress,
  });
}

export function collectSandboxAllocationScopeIssues(
  allocation: WorkbenchSandboxAllocation,
  execution: WorkbenchExecutionSpec,
  options: { now?: string } = {},
): string[] {
  const issues: string[] = [];
  if (allocation.executionId !== execution.id) {
    issues.push(`Sandbox allocation execution id ${allocation.executionId} does not match ${execution.id}.`);
  }
  if (!allocation.sandboxId.trim()) {
    issues.push(`Sandbox allocation for ${execution.id} must include a sandbox id.`);
  }
  if (!allocation.lifecycleId.trim()) {
    issues.push(`Sandbox allocation for ${execution.id} must include a lifecycle id.`);
  }
  if (!allocation.backend.trim()) {
    issues.push(`Sandbox allocation for ${execution.id} must include a backend.`);
  }
  if (!allocation.runnerId.trim()) {
    issues.push(`Sandbox allocation for ${execution.id} must include a runner id.`);
  }
  if (allocation.template.kind !== execution.sandbox.kind || allocation.template.ref !== execution.sandbox.ref) {
    issues.push(`Sandbox allocation template does not match execution ${execution.id}.`);
  }
  if (allocation.network.egress !== execution.policy.network.egress) {
    issues.push(`Sandbox allocation network policy does not match execution ${execution.id}.`);
  }
  if (!["allocated", "running", "stopping", "stopped"].includes(allocation.status)) {
    issues.push(`Sandbox allocation status ${allocation.status} is not supported for execution ${execution.id}.`);
  }
  const nowMs = options.now ? Date.parse(options.now) : Date.now();
  const expiresAtMs = Date.parse(allocation.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    issues.push(`Sandbox allocation expiresAt must be an ISO timestamp for execution ${execution.id}.`);
  } else if (expiresAtMs <= nowMs) {
    issues.push(`Sandbox allocation is expired for execution ${execution.id}.`);
  }
  return issues;
}

function assertScopeIssues(label: string, issues: readonly string[]): void {
  if (issues.length > 0) {
    throw new Error(`${label} failed validation:\n${issues.join("\n")}`);
  }
}

function isJsonRecord(value: Json | undefined): value is Record<string, Json> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
