export const DOCKER_SANDBOX_BACKEND = "docker";

export type WorkbenchSandboxBackendName = typeof DOCKER_SANDBOX_BACKEND;

export type WorkbenchSandboxProviderName = WorkbenchSandboxBackendName;

export function isWorkbenchSandboxProviderName(value: string): value is WorkbenchSandboxProviderName {
  return value === DOCKER_SANDBOX_BACKEND;
}

export function resolveWorkbenchSandboxProviderName(
  value: string | null | undefined,
): WorkbenchSandboxProviderName {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error("Sandbox provider is required.");
  }
  if (isWorkbenchSandboxProviderName(normalized)) {
    return normalized;
  }
  throw new Error(`Unsupported local sandbox provider ${normalized}. Supported providers: docker.`);
}
