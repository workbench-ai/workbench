import {
  isWorkbenchExecutionNetworkEgress,
} from "@workbench-ai/workbench-contract";
import type {
  WorkbenchExecutionRuntimeInput,
} from "../execution-runtime-types.ts";
import type {
  SandboxBackendCapabilities,
  SandboxBackendDescriptor,
  SandboxExecutionFileStore,
  SandboxPlane,
} from "../sandbox-plane.ts";
import {
  createDockerSandboxBackendDescriptor,
  createDockerSandboxPlane,
} from "./docker.ts";
import {
  DOCKER_SANDBOX_BACKEND,
  type WorkbenchSandboxProviderName,
  resolveWorkbenchSandboxProviderName,
} from "./names.ts";

export {
  DOCKER_SANDBOX_BACKEND,
  resolveWorkbenchSandboxProviderName,
  type WorkbenchSandboxProviderName,
} from "./names.ts";
export {
  createDockerSandboxBackendDescriptor,
  createDockerSandboxPlane,
} from "./docker.ts";

export interface SandboxHostHealthExpectation {
  provider: WorkbenchSandboxProviderName;
  backend: string;
  capabilities: SandboxBackendCapabilities;
}

export interface SandboxProviderRequestedResources {
  cpu: number;
  memoryGb: number;
  diskGb?: number;
  timeoutMinutes?: number;
}

export interface SandboxProviderHostCost {
  cpu: number;
  memoryGb: number;
  diskGb: number;
}

export interface SandboxProviderLeaseRequest {
  scope: string;
  units: number;
}

export interface SandboxProviderAdmission {
  provider: WorkbenchSandboxProviderName;
  hostCost: SandboxProviderHostCost;
  providerLeases: SandboxProviderLeaseRequest[];
}

export function createSandboxBackendPlaneForProvider(
  provider: string,
  args: WorkbenchExecutionRuntimeInput,
  startedAt: string,
  fileStore: SandboxExecutionFileStore,
): SandboxPlane {
  const resolved = resolveWorkbenchSandboxProviderName(provider);
  if (resolved !== DOCKER_SANDBOX_BACKEND) {
    throw new Error(`Unsupported local sandbox provider ${provider}.`);
  }
  return createDockerSandboxPlane(args, startedAt, fileStore);
}

export function sandboxHostHealthExpectationForProvider(
  provider: WorkbenchSandboxProviderName,
): SandboxHostHealthExpectation {
  if (provider !== DOCKER_SANDBOX_BACKEND) {
    resolveWorkbenchSandboxProviderName(provider);
  }
  return {
    provider,
    backend: provider,
    capabilities: createDockerSandboxBackendDescriptor().capabilities,
  };
}

export function assertSandboxHostHealthForProvider(
  value: unknown,
  provider: WorkbenchSandboxProviderName,
): void {
  const expected = sandboxHostHealthExpectationForProvider(provider);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("sandbox host health response must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.provider !== expected.provider) {
    throw new Error(`sandbox host provider ${String(record.provider ?? "missing")} does not match expected ${expected.provider}.`);
  }
  if (record.backend !== expected.backend) {
    throw new Error(`sandbox host backend ${String(record.backend ?? "missing")} does not match expected ${expected.backend}.`);
  }
  if (!isSandboxBackendCapabilities(record.capabilities)) {
    throw new Error(`sandbox host capabilities are invalid for backend ${expected.backend}.`);
  }
}

export function sandboxProviderDefaultMaxConcurrentJobs(
  _provider: WorkbenchSandboxProviderName,
): number | null {
  return null;
}

export function sandboxProviderAdmissionForResources(
  provider: WorkbenchSandboxProviderName,
  resources: SandboxProviderRequestedResources,
): SandboxProviderAdmission {
  if (provider !== DOCKER_SANDBOX_BACKEND) {
    resolveWorkbenchSandboxProviderName(provider);
  }
  assertPositiveResource(resources.cpu, "resources.cpu");
  assertPositiveResource(resources.memoryGb, "resources.memoryGb");
  if (resources.diskGb !== undefined) {
    assertPositiveResource(resources.diskGb, "resources.diskGb");
  }
  return {
    provider,
    hostCost: {
      cpu: resources.cpu,
      memoryGb: resources.memoryGb,
      diskGb: resources.diskGb ?? 1,
    },
    providerLeases: [],
  };
}

export function sandboxProviderLeaseScope(
  provider: WorkbenchSandboxProviderName,
): string {
  throw new Error(`Local sandbox provider ${provider} does not use provider leases.`);
}

function isSandboxBackendCapabilities(value: unknown): value is SandboxBackendDescriptor["capabilities"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.snapshots === "boolean" &&
    typeof record.interactiveExec === "boolean" &&
    typeof record.filesystemDiff === "boolean" &&
    typeof record.fileCapabilities === "boolean" &&
    Array.isArray(record.networkPolicy) &&
    record.networkPolicy.every(isWorkbenchExecutionNetworkEgress);
}

function assertPositiveResource(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
}
