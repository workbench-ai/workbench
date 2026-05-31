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
  type WorkbenchSandboxBackendName,
  resolveWorkbenchSandboxBackendName,
} from "./names.ts";

export {
  DOCKER_SANDBOX_BACKEND,
  resolveWorkbenchSandboxBackendName,
  type WorkbenchSandboxBackendName,
} from "./names.ts";
export {
  createDockerSandboxBackendDescriptor,
  createDockerSandboxPlane,
} from "./docker.ts";

export interface SandboxHostHealthExpectation {
  backend: WorkbenchSandboxBackendName;
  capabilities: SandboxBackendCapabilities;
}

export interface SandboxBackendRequestedResources {
  cpu: number;
  memoryGb: number;
  diskGb?: number;
  timeoutMinutes?: number;
}

export interface SandboxBackendHostCost {
  cpu: number;
  memoryGb: number;
  diskGb: number;
}

export interface SandboxBackendAdmission {
  backend: WorkbenchSandboxBackendName;
  hostCost: SandboxBackendHostCost;
}

export function createSandboxBackendPlaneForBackend(
  backend: string,
  args: WorkbenchExecutionRuntimeInput,
  startedAt: string,
  fileStore: SandboxExecutionFileStore,
): SandboxPlane {
  const resolved = resolveWorkbenchSandboxBackendName(backend);
  if (resolved !== DOCKER_SANDBOX_BACKEND) {
    throw new Error(`Unsupported local sandbox backend ${backend}.`);
  }
  return createDockerSandboxPlane(args, startedAt, fileStore);
}

export function sandboxHostHealthExpectationForBackend(
  backend: WorkbenchSandboxBackendName,
): SandboxHostHealthExpectation {
  if (backend !== DOCKER_SANDBOX_BACKEND) {
    resolveWorkbenchSandboxBackendName(backend);
  }
  return {
    backend,
    capabilities: createDockerSandboxBackendDescriptor().capabilities,
  };
}

export function assertSandboxHostHealthForBackend(
  value: unknown,
  backend: WorkbenchSandboxBackendName,
): void {
  const expected = sandboxHostHealthExpectationForBackend(backend);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("sandbox host health response must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.backend !== expected.backend) {
    throw new Error(`sandbox host backend ${String(record.backend ?? "missing")} does not match expected ${expected.backend}.`);
  }
  if (!isSandboxBackendCapabilities(record.capabilities)) {
    throw new Error(`sandbox host capabilities are invalid for backend ${expected.backend}.`);
  }
}

export function sandboxBackendAdmissionForResources(
  backend: WorkbenchSandboxBackendName,
  resources: SandboxBackendRequestedResources,
): SandboxBackendAdmission {
  if (backend !== DOCKER_SANDBOX_BACKEND) {
    resolveWorkbenchSandboxBackendName(backend);
  }
  assertPositiveResource(resources.cpu, "resources.cpu");
  assertPositiveResource(resources.memoryGb, "resources.memoryGb");
  if (resources.diskGb !== undefined) {
    assertPositiveResource(resources.diskGb, "resources.diskGb");
  }
  return {
    backend,
    hostCost: {
      cpu: resources.cpu,
      memoryGb: resources.memoryGb,
      diskGb: resources.diskGb ?? 1,
    },
  };
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
