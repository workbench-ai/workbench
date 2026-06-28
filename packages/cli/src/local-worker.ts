#!/usr/bin/env node

import { promises as fs } from "node:fs";

import {
  codedErrorFromUnknown,
  superviseLocalWorkbenchOperation,
  type Json,
  type WorkbenchOperationRequest,
} from "@workbench-ai/workbench-core";

interface LocalWorkerRequestPayload {
  schema: "workbench.local-worker.request.v1";
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

const payloadPath = process.argv[2];

if (process.env.WORKBENCH_INTERNAL_LOCAL_WORKER !== "1" || !payloadPath) {
  process.stderr.write("workbench local worker is an internal execution entry.\n");
  process.exitCode = 2;
} else {
  runLocalWorker(payloadPath).catch(async (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

async function runLocalWorker(filePath: string): Promise<void> {
  const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as LocalWorkerRequestPayload;
  if (payload.schema !== "workbench.local-worker.request.v1") {
    throw new Error("Invalid local worker request payload.");
  }
  try {
    const supervisor = superviseLocalWorkbenchOperation({
      ...payload.core,
      request: payload.request,
    });
    const started = await supervisor.started;
    await writeJson(payload.startedPath, started);
    const completed = await supervisor.completed;
    await writeJson(payload.completedPath, completed);
  } catch (error) {
    await writeJson(payload.errorPath, workerErrorPayload(error)).catch(() => undefined);
    process.exitCode = codedErrorFromUnknown(error).exitCode ?? 1;
  }
}

function workerErrorPayload(error: unknown): Json {
  const coded = codedErrorFromUnknown(error);
  return {
    schema: "workbench.local-worker.error.v1",
    code: coded.code,
    message: coded.message,
    ...(coded.remediation ? { remediation: coded.remediation } : {}),
    ...(coded.retryable !== undefined ? { retryable: coded.retryable } : {}),
    ...(coded.subject ? { subject: coded.subject } : {}),
    ...(coded.exitCode !== undefined ? { exitCode: coded.exitCode } : {}),
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
