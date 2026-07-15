import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createWorkbenchReadOnlyInspectionSnapshot,
  sleep,
  WorkbenchCodedError,
} from "@workbench-ai/workbench-core";
import type {
  Json,
  WorkbenchOperationRequest,
  WorkbenchRunSnapshot,
} from "@workbench-ai/workbench-contract";
import {
  LOCAL_WORKER_REQUEST_SCHEMA,
  type LocalWorkerRequestPayload,
} from "./local-worker-protocol.js";
import { pathExists, positiveIntEnv } from "./runtime-utils.js";

interface LocalWorkerErrorPayload {
  schema?: string;
  code?: string;
  message?: string;
  remediation?: string;
  retryable?: boolean;
  subject?: Record<string, Json>;
  exitCode?: number;
}

interface LocalWorkerLaunch {
  command: string;
  args: string[];
}

export async function startPrivateLocalWorkbenchOperation(input: {
  core: { dir?: string; authToken?: string; adapterAuthStoreRoot?: string; homeDir?: string };
  request: WorkbenchOperationRequest;
}): Promise<{ snapshot: WorkbenchRunSnapshot }> {
  const root = (await createWorkbenchReadOnlyInspectionSnapshot(input.core)).root;
  const workerId = `worker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const workerDir = path.join(root, ".workbench", "tmp", "workers", workerId);
  const payloadPath = path.join(workerDir, "request.json");
  const startedPath = path.join(workerDir, "started.json");
  const completedPath = path.join(workerDir, "completed.json");
  const errorPath = path.join(workerDir, "error.json");
  const launch = await resolveLocalWorkerLaunch(payloadPath);
  await fs.mkdir(workerDir, { recursive: true });
  const payload: LocalWorkerRequestPayload = {
    schema: LOCAL_WORKER_REQUEST_SCHEMA,
    core: {
      dir: root,
      ...(input.core.authToken ? { authToken: input.core.authToken } : {}),
      ...(input.core.adapterAuthStoreRoot ? { adapterAuthStoreRoot: input.core.adapterAuthStoreRoot } : {}),
      ...(input.core.homeDir ? { homeDir: input.core.homeDir } : {}),
    },
    request: input.request,
    startedPath,
    completedPath,
    errorPath,
  };
  await writeJsonFile(payloadPath, payload);
  const child = spawn(launch.command, launch.args, {
    cwd: root,
    detached: true,
    env: {
      ...process.env,
      WORKBENCH_INTERNAL_LOCAL_WORKER: "1",
    },
    stdio: "ignore",
  });
  const spawnError = new Promise<never>((_, reject) => {
    child.once("error", reject);
  });
  const prematureExit = waitForLocalWorkerPrematureExit(child, startedPath, errorPath);
  child.unref();
  const snapshot = await Promise.race([
    waitForLocalWorkerStarted(startedPath, errorPath),
    spawnError,
    prematureExit,
  ]);
  return { snapshot };
}

export async function localWorkerErrorForRun(root: string, runId: string): Promise<WorkbenchCodedError | undefined> {
  const workersRoot = path.join(root, ".workbench", "tmp", "workers");
  let entries: string[];
  try {
    entries = await fs.readdir(workersRoot);
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const workerDir = path.join(workersRoot, entry);
    const started = await readJsonFile<WorkbenchRunSnapshot>(path.join(workerDir, "started.json")).catch(() => undefined);
    if (started?.id !== runId) {
      continue;
    }
    const error = await readJsonFile<LocalWorkerErrorPayload>(path.join(workerDir, "error.json")).catch(() => undefined);
    if (error) {
      return localWorkerError(error);
    }
  }
  return undefined;
}

async function waitForLocalWorkerStarted(
  startedPath: string,
  errorPath: string,
): Promise<WorkbenchRunSnapshot> {
  const deadline = Date.now() + (positiveIntEnv("WORKBENCH_LOCAL_WORKER_START_TIMEOUT_MS") ?? 30_000);
  while (Date.now() < deadline) {
    const started = await readLocalWorkerStart(startedPath, errorPath);
    if (started) {
      return started;
    }
    await sleep(100);
  }
  throw new WorkbenchCodedError("local_worker_start_timeout", "Local run worker did not publish a run id before the startup timeout.", {
    retryable: true,
    remediation: "workbench eval results",
    exitCode: 1,
  });
}

function waitForLocalWorkerPrematureExit(
  child: ReturnType<typeof spawn>,
  startedPath: string,
  errorPath: string,
): Promise<never> {
  return new Promise((_, reject) => {
    child.once("exit", () => {
      void (async () => {
        const started = await readLocalWorkerStart(startedPath, errorPath);
        if (started) {
          return;
        }
        throw new WorkbenchCodedError(
          "local_worker_failed",
          "Local run worker exited before publishing a run id.",
          {
            retryable: true,
            remediation: "workbench eval results",
            exitCode: 1,
          },
        );
      })().catch(reject);
    });
  });
}

async function readLocalWorkerStart(
  startedPath: string,
  errorPath: string,
): Promise<WorkbenchRunSnapshot | undefined> {
  const error = await readJsonFile<LocalWorkerErrorPayload>(errorPath).catch(() => undefined);
  if (error) {
    throw localWorkerError(error);
  }
  return await readJsonFile<WorkbenchRunSnapshot>(startedPath).catch(() => undefined);
}

function localWorkerError(error: LocalWorkerErrorPayload): WorkbenchCodedError {
  return new WorkbenchCodedError(
    error.code ?? "local_worker_failed",
    error.message ?? "Local run worker failed before publishing a run id.",
    {
      retryable: error.retryable,
      remediation: error.remediation ?? "workbench eval results",
      ...(error.subject ? { subject: error.subject } : {}),
      exitCode: error.exitCode ?? 1,
    },
  );
}

async function resolveLocalWorkerLaunch(payloadPath: string): Promise<LocalWorkerLaunch> {
  const builtWorkerPath = fileURLToPath(new URL("./local-worker.js", import.meta.url));
  if (await pathExists(builtWorkerPath)) {
    return { command: process.execPath, args: [builtWorkerPath, payloadPath] };
  }
  const sourceWorkerPath = fileURLToPath(new URL("./local-worker.ts", import.meta.url));
  const packageRoot = path.dirname(path.dirname(sourceWorkerPath));
  const tsxBin = path.join(packageRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  if (await pathExists(sourceWorkerPath) && await pathExists(tsxBin)) {
    return { command: tsxBin, args: [sourceWorkerPath, payloadPath] };
  }
  throw new WorkbenchCodedError(
    "local_worker_missing",
    "The Workbench CLI local worker module is unavailable for the current runtime.",
    {
      remediation: "pnpm --dir products/workbench/packages/cli build",
      retryable: true,
      exitCode: 1,
    },
  );
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}
