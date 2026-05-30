import type {
  WorkbenchExecutionRuntimeInput,
} from "./execution-runtime-types.ts";
import {
  sanitizeWorkbenchAdapterAuthBundle,
} from "./adapter-auth.ts";

export async function persistWorkbenchAdapterAuthUpdates(
  args: Pick<WorkbenchExecutionRuntimeInput, "adapterAuthUpdateSink">,
  value: unknown,
): Promise<void> {
  if (!args.adapterAuthUpdateSink || !Array.isArray(value) || value.length === 0) {
    return;
  }
  const updates = value.map((entry) => sanitizeWorkbenchAdapterAuthBundle(entry));
  await args.adapterAuthUpdateSink(updates);
}
