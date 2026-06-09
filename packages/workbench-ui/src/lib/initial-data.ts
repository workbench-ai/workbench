import type { WorkbenchInspectionSnapshot } from "@workbench-ai/workbench-contract";

export type WorkbenchWorkspaceInitialData = WorkbenchInspectionSnapshot;

export interface WorkbenchInspectionReader {
  snapshot(): Promise<WorkbenchInspectionSnapshot>;
}

export async function loadWorkbenchWorkspaceInitialData({
  inspection,
  snapshot,
}: {
  inspection: WorkbenchInspectionReader;
  route?: unknown;
  snapshot?: WorkbenchInspectionSnapshot | null;
}): Promise<WorkbenchWorkspaceInitialData> {
  return snapshot ?? await inspection.snapshot();
}
