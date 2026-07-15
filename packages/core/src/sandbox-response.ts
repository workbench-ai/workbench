import type { WorkbenchExecutionJob } from "@workbench-ai/workbench-contract";

import { sanitizeWorkbenchAdapterAuthBundle } from "./adapter-auth.ts";
import type { WorkbenchExecutionRuntimeInput } from "./execution-runtime-types.ts";

export async function readWorkbenchSandboxAdapterJobResponse(
  source: string,
  args: Pick<WorkbenchExecutionRuntimeInput, "adapterAuthUpdateSink">,
): Promise<WorkbenchExecutionJob> {
  const parsed = JSON.parse(source) as unknown;
  const response = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  if (!response.ok) {
    throw new Error(typeof response.error === "string" ? response.error : "Sandbox adapter runner failed.");
  }
  if (!response.job || typeof response.job !== "object" || Array.isArray(response.job)) {
    throw new Error("Sandbox adapter runner response omitted job.");
  }
  if (args.adapterAuthUpdateSink && Array.isArray(response.adapterAuthProfiles) && response.adapterAuthProfiles.length > 0) {
    await args.adapterAuthUpdateSink(
      response.adapterAuthProfiles.map((entry) => sanitizeWorkbenchAdapterAuthBundle(entry)),
    );
  }
  return response.job as WorkbenchExecutionJob;
}
