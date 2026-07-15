import type { WorkbenchOperationRequest } from "@workbench-ai/workbench-contract";

export const LOCAL_WORKER_REQUEST_SCHEMA = "workbench.local-worker.request.v1";

export interface LocalWorkerRequestPayload {
  schema: typeof LOCAL_WORKER_REQUEST_SCHEMA;
  core: {
    dir?: string;
    authToken?: string;
    adapterAuthStoreRoot?: string;
    homeDir?: string;
  };
  request: WorkbenchOperationRequest;
  startedPath: string;
  completedPath: string;
  errorPath: string;
}
