export const DOCKER_SANDBOX_BACKEND = "docker";

export type WorkbenchSandboxBackendName = typeof DOCKER_SANDBOX_BACKEND;

export function isWorkbenchSandboxBackendName(value: string): value is WorkbenchSandboxBackendName {
  return value === DOCKER_SANDBOX_BACKEND;
}

export function resolveWorkbenchSandboxBackendName(
  value: string | null | undefined,
): WorkbenchSandboxBackendName {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error("Sandbox backend is required.");
  }
  if (isWorkbenchSandboxBackendName(normalized)) {
    return normalized;
  }
  throw new Error(`Unsupported local sandbox backend ${normalized}. Supported backends: docker.`);
}
