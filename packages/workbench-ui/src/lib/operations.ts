import type {
  WorkbenchCaseMutationRequest,
  WorkbenchCaseMutationResponse,
  WorkbenchOperationRequest,
  WorkbenchRunSnapshot,
} from "@workbench-ai/workbench-contract";

import {
  createRunRoute,
  type WorkbenchRoute,
} from "./routes";

export async function startWorkbenchOperation(
  apiBasePath: string,
  request: WorkbenchOperationRequest,
): Promise<WorkbenchRunSnapshot> {
  const response = await fetch(`${apiBasePath}/operations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }
  const started = await response.json() as WorkbenchRunSnapshot;
  if (started.schema !== "workbench.run.v1" || !started.id) {
    throw new Error("Workbench operation endpoint returned an unsupported response.");
  }
  return started;
}

export async function createEvaluationCase(
  apiBasePath: string,
  request: WorkbenchCaseMutationRequest,
): Promise<WorkbenchCaseMutationResponse> {
  const response = await fetch(`${apiBasePath}/evaluation/cases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }
  const created = await response.json() as WorkbenchCaseMutationResponse;
  if (!created.caseId || !created.path) {
    throw new Error("Workbench case endpoint returned an unsupported response.");
  }
  return created;
}

export function routeForWorkbenchRunSnapshot(started: WorkbenchRunSnapshot): WorkbenchRoute {
  return createRunRoute({
    runId: started.route.runId,
    source: started.route.source,
    evaluationId: started.route.evaluationId ?? null,
  });
}

async function responseErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return `Request failed with HTTP ${response.status}.`;
  }
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : text;
  } catch {
    return text;
  }
}
