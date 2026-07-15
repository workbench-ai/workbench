import { workbenchInspectionFileOwnerRouteSegment } from "@workbench-ai/workbench-contract";

import type { WorkbenchFileOwnerKind } from "./routes";

export function jobEvidenceApiPath(apiBasePath: string, runId: string, jobId: string): string {
  const base = apiBasePath.replace(/\/+$/u, "");
  const params = new URLSearchParams({ run: runId });
  return `${base}/jobs/${encodeURIComponent(jobId)}/evidence?${params.toString()}`;
}

export function fileContentApiPath(
  apiBasePath: string,
  ownerKind: WorkbenchFileOwnerKind,
  ownerId: string,
  path: string,
): string {
  const base = apiBasePath.replace(/\/+$/u, "");
  const ownerSegment = workbenchInspectionFileOwnerRouteSegment(ownerKind);
  return `${base}/${ownerSegment}/${encodeURIComponent(ownerId)}/files/${path.split("/").map(encodeURIComponent).join("/")}`;
}
