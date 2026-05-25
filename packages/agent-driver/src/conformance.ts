import type { HarnessManifest } from "./index.js";
import type { HarnessProvider } from "./index.js";

export function collectHarnessProviderConformanceIssues(
  provider: HarnessProvider<unknown>,
): string[] {
  const issues: string[] = [];
  const manifest = provider.manifest;

  validateManifest(manifest, issues);
  if (!provider.schemas) {
    issues.push("provider.schemas is required.");
  } else {
    if (!provider.schemas.auth) {
      issues.push("provider.schemas.auth is required.");
    }
    if (!provider.schemas.config) {
      issues.push("provider.schemas.config is required.");
    }
  }
  if (typeof provider.create !== "function") {
    issues.push("provider.create must be a function.");
  }

  return issues;
}

function validateManifest(manifest: HarnessManifest, issues: string[]): void {
  if (!manifest.id?.trim()) {
    issues.push("manifest.id must be a non-empty string.");
  }
  if (!manifest.display_name?.trim()) {
    issues.push("manifest.display_name must be a non-empty string.");
  }
  if (!manifest.auth_schema) {
    issues.push("manifest.auth_schema is required.");
  }
  if (!manifest.config_schema) {
    issues.push("manifest.config_schema is required.");
  }
  if (!Array.isArray(manifest.supported_workspace_modes) || manifest.supported_workspace_modes.length === 0) {
    issues.push("manifest.supported_workspace_modes must declare at least one mode.");
  }
}
