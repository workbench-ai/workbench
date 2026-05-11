import type {
  WorkbenchExecutionSpec,
} from "@workbench-ai/workbench-contract";

import type {
  WorkbenchExecutionRuntimeInput,
} from "../execution-runtime-types.ts";
import {
  normalizeRuntimeRegistry,
  resolveDockerRuntimeImageRef,
} from "../runtime-utils.ts";

export function resolveSandboxTemplateImage(
  execution: WorkbenchExecutionSpec,
  args: WorkbenchExecutionRuntimeInput,
): string {
  if (execution.sandbox.kind === "oci") {
    return resolveDockerRuntimeImageRef(execution.sandbox.ref, {
      runtimeRegistry: normalizeRuntimeRegistry(args.runtimeRegistry ?? process.env.WORKBENCH_RUNTIME_REGISTRY ?? ""),
      label: `Execution ${execution.id} sandbox ref`,
    });
  }
  const image = sandboxTemplateImageForRef(execution.sandbox.ref);
  if (!image) {
    throw new Error(`Execution ${execution.id} uses snapshot template ${execution.sandbox.ref}, but WORKBENCH_SANDBOX_TEMPLATE_IMAGES does not map that ref.`);
  }
  return image.startsWith("docker://")
    ? resolveDockerRuntimeImageRef(image, {
        runtimeRegistry: normalizeRuntimeRegistry(args.runtimeRegistry ?? process.env.WORKBENCH_RUNTIME_REGISTRY ?? ""),
        label: `WORKBENCH_SANDBOX_TEMPLATE_IMAGES[${execution.sandbox.ref}]`,
      })
    : image;
}

function sandboxTemplateImageForRef(templateRef: string): string | null {
  const raw = process.env.WORKBENCH_SANDBOX_TEMPLATE_IMAGES?.trim() ?? "";
  if (!raw) {
    return null;
  }
  if (raw.startsWith("{")) {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("WORKBENCH_SANDBOX_TEMPLATE_IMAGES must be a JSON object or comma-separated ref=image list.");
    }
    const value = (parsed as Record<string, unknown>)[templateRef];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  const entries = raw.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      throw new Error("WORKBENCH_SANDBOX_TEMPLATE_IMAGES entries must use ref=image.");
    }
    const ref = entry.slice(0, separator).trim();
    const image = entry.slice(separator + 1).trim();
    if (ref === templateRef) {
      return image || null;
    }
  }
  return null;
}
