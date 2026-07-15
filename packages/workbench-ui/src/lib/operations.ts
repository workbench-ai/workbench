import type {
  WorkbenchCaseMutationRequest,
  WorkbenchCaseMutationResponse,
  WorkbenchGradeMutationRequest,
  WorkbenchGradeMutationResponse,
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
  const started = await postWorkbenchJson<WorkbenchRunSnapshot>(`${apiBasePath}/operations`, request);
  if (started.schema !== "workbench.run.v1" || !started.id) {
    throw new Error("Workbench operation endpoint returned an unsupported response.");
  }
  return started;
}

export async function saveEvaluationCase(
  apiBasePath: string,
  request: WorkbenchCaseMutationRequest,
): Promise<WorkbenchCaseMutationResponse> {
  const created = await postWorkbenchJson<WorkbenchCaseMutationResponse>(`${apiBasePath}/evaluation/cases`, request);
  if (!created.caseId || !created.path) {
    throw new Error("Workbench case endpoint returned an unsupported response.");
  }
  return created;
}

export async function updateEvaluationGrader(
  apiBasePath: string,
  request: WorkbenchGradeMutationRequest,
): Promise<WorkbenchGradeMutationResponse> {
  const updated = await postWorkbenchJson<WorkbenchGradeMutationResponse>(`${apiBasePath}/evaluation/grader`, request);
  if (!updated.path) {
    throw new Error("Workbench grader endpoint returned an unsupported response.");
  }
  return updated;
}

async function postWorkbenchJson<ResponseBody>(url: string, request: unknown): Promise<ResponseBody> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(await workbenchResponseErrorMessage(response));
  }
  return await response.json() as ResponseBody;
}

export function routeForWorkbenchRunSnapshot(started: WorkbenchRunSnapshot): WorkbenchRoute {
  return createRunRoute({
    runId: started.route.runId,
  });
}

export async function workbenchResponseErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    // Use the raw response below.
  }
  return text.trim() || response.statusText || `HTTP ${response.status}`;
}
