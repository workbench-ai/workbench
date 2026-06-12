import type * as WorkbenchRuntime from "@workbench-ai/workbench-core";

let runtimeModule: Promise<typeof WorkbenchRuntime> | null = null;

export async function importWorkbenchRuntime(): Promise<typeof WorkbenchRuntime> {
  runtimeModule ??= importWorkbenchRuntimeUncached();
  return await runtimeModule;
}

async function importWorkbenchRuntimeUncached(): Promise<typeof WorkbenchRuntime> {
  const specifiers = runtimeImportOptions();
  let lastError: unknown;
  for (const specifier of specifiers) {
    try {
      return await import(specifier) as typeof WorkbenchRuntime;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Unable to load @workbench-ai/workbench-core for built-in adapters: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function runtimeImportOptions(): string[] {
  return [
    process.env.WORKBENCH_RUNTIME_IMPORT,
    "/app/products/workbench/packages/core/src/index.ts",
    new URL("../../core/src/index.ts", import.meta.url).href,
    "@workbench-ai/workbench-core",
  ].filter((specifier): specifier is string => typeof specifier === "string" && specifier.length > 0);
}
