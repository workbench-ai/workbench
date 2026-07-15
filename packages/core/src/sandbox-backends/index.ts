import { isWorkbenchExecutionNetworkEgress } from "@workbench-ai/workbench-contract";
import type { WorkbenchExecutionRuntimeInput } from "../execution-runtime-types.ts";
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
} from "./names.ts";

export {
  DOCKER_SANDBOX_BACKEND,
  type WorkbenchSandboxBackendName,
} from "./names.ts";
export {
  createDockerSandboxBackendDescriptor,
  createDockerSandboxPlane,
} from "./docker.ts";
export { resolveSandboxTemplateImage } from "./template-images.ts";

export interface SandboxHostHealthExpectation<Name extends string = string> {
  backend: Name;
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

export interface SandboxBackendAdmission<Name extends string = string> {
  backend: Name;
  hostCost: SandboxBackendHostCost;
}

type SandboxBackendPlaneFactory = (
  args: WorkbenchExecutionRuntimeInput,
  startedAt: string,
  fileStore: SandboxExecutionFileStore,
) => SandboxPlane;

export interface SandboxBackendRegistration<Name extends string = string> {
  name: Name;
  descriptor: () => SandboxBackendDescriptor;
  createPlane: SandboxBackendPlaneFactory;
  hostCost?: (resources: SandboxBackendRequestedResources) => SandboxBackendHostCost;
}

export function createSandboxBackendRegistry<Name extends string>(
  registrations: readonly SandboxBackendRegistration<Name>[],
  unsupportedLabel = "Unsupported sandbox backend",
) {
  const registry = new Map<string, SandboxBackendRegistration<Name>>(
    registrations.map((registration) => [registration.name, registration]),
  );
  const supportedNames = registrations.map((registration) => registration.name);

  function requireRegistration(name: string): SandboxBackendRegistration<Name> {
    const registration = registry.get(name);
    if (!registration) {
      throw new Error(`${unsupportedLabel} ${name}. Supported backends: ${supportedNames.join(", ")}.`);
    }
    return registration;
  }

  function resolveName(value: string | null | undefined): Name {
    const normalized = value?.trim();
    if (!normalized) {
      throw new Error("Sandbox backend is required.");
    }
    return requireRegistration(normalized).name;
  }

  function hostHealthExpectation(backend: Name): SandboxHostHealthExpectation<Name> {
    const registration = requireRegistration(backend);
    return { backend: registration.name, capabilities: registration.descriptor().capabilities };
  }

  function assertHostHealth(value: unknown, backend: Name): void {
    const expected = hostHealthExpectation(backend);
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
    if (!sandboxCapabilitiesEqual(record.capabilities, expected.capabilities)) {
      throw new Error(`sandbox host capabilities do not match expected ${expected.backend} capabilities.`);
    }
  }

  function admissionForResources(
    backend: Name,
    resources: SandboxBackendRequestedResources,
  ): SandboxBackendAdmission<Name> {
    const registration = requireRegistration(backend);
    assertPositiveResource(resources.cpu, "resources.cpu");
    assertPositiveResource(resources.memoryGb, "resources.memoryGb");
    if (resources.diskGb !== undefined) {
      assertPositiveResource(resources.diskGb, "resources.diskGb");
    }
    return {
      backend: registration.name,
      hostCost: registration.hostCost?.(resources) ?? {
        cpu: resources.cpu,
        memoryGb: resources.memoryGb,
        diskGb: resources.diskGb ?? 1,
      },
    };
  }

  return {
    resolveName,
    createPlane: (
      backend: string,
      args: WorkbenchExecutionRuntimeInput,
      startedAt: string,
      fileStore: SandboxExecutionFileStore,
    ) => requireRegistration(backend).createPlane(args, startedAt, fileStore),
    hostHealthExpectation,
    assertHostHealth,
    admissionForResources,
  };
}

const LOCAL_SANDBOX_BACKENDS = createSandboxBackendRegistry<WorkbenchSandboxBackendName>([
  {
    name: DOCKER_SANDBOX_BACKEND,
    descriptor: createDockerSandboxBackendDescriptor,
    createPlane: createDockerSandboxPlane,
  },
], "Unsupported local sandbox backend");

export const createSandboxBackendPlaneForBackend = LOCAL_SANDBOX_BACKENDS.createPlane;
export const sandboxBackendAdmissionForResources = LOCAL_SANDBOX_BACKENDS.admissionForResources;

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

function sandboxCapabilitiesEqual(
  left: SandboxBackendCapabilities,
  right: SandboxBackendCapabilities,
): boolean {
  return left.snapshots === right.snapshots &&
    left.interactiveExec === right.interactiveExec &&
    left.filesystemDiff === right.filesystemDiff &&
    left.fileCapabilities === right.fileCapabilities &&
    left.networkPolicy.length === right.networkPolicy.length &&
    left.networkPolicy.every((policy, index) => policy === right.networkPolicy[index]);
}

function assertPositiveResource(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
}
