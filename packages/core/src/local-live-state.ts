import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  WorkbenchStateNotice,
} from "@workbench-ai/workbench-contract";

const WORKBENCH_DIR = ".workbench";
const LIVE_DIR = "live";
const LIVE_STATE_SCHEMA = "workbench.live-state.v1";
const liveStateQueues = new Map<string, Promise<void>>();

interface LocalWorkbenchLiveState {
  schema: typeof LIVE_STATE_SCHEMA;
  revision: number;
  updatedAt: string;
}

export async function readLocalWorkbenchLiveStateCursor(root: string): Promise<string> {
  return localWorkbenchLiveStateCursor(await readLocalWorkbenchLiveState(root));
}

export async function waitForLocalWorkbenchLiveStateNotice(options: {
  root: string;
  cursor?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<WorkbenchStateNotice> {
  const timeoutMs = clampInspectionWaitTimeout(options.timeoutMs);
  const startedAt = Date.now();
  const requestedCursor = options.cursor?.trim();
  let currentCursor = await readLocalWorkbenchLiveStateCursor(options.root);
  if (!requestedCursor || !requestedCursor.startsWith("local:")) {
    return workbenchStateNotice("reset", currentCursor);
  }
  if (requestedCursor !== currentCursor) {
    return workbenchStateNotice("changed", currentCursor);
  }
  while (Date.now() - startedAt < timeoutMs) {
    if (options.signal?.aborted) {
      return workbenchStateNotice("heartbeat", currentCursor);
    }
    await sleep(Math.min(250, Math.max(25, timeoutMs - (Date.now() - startedAt))));
    currentCursor = await readLocalWorkbenchLiveStateCursor(options.root);
    if (requestedCursor !== currentCursor) {
      return workbenchStateNotice("changed", currentCursor);
    }
  }
  return workbenchStateNotice("heartbeat", currentCursor);
}

export async function advanceLocalWorkbenchLiveState(root: string): Promise<void> {
  const normalizedRoot = path.resolve(root);
  const previous = liveStateQueues.get(normalizedRoot) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const previousState = await readLocalWorkbenchLiveState(root);
    const nextState: LocalWorkbenchLiveState = {
      schema: LIVE_STATE_SCHEMA,
      revision: previousState.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await fs.mkdir(liveDir(root), { recursive: true });
    await fs.writeFile(liveStateFile(root), `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  });
  const settled = next.then(() => undefined, () => undefined);
  liveStateQueues.set(normalizedRoot, settled);
  try {
    await next;
  } finally {
    if (liveStateQueues.get(normalizedRoot) === settled) {
      liveStateQueues.delete(normalizedRoot);
    }
  }
}

async function readLocalWorkbenchLiveState(root: string): Promise<LocalWorkbenchLiveState> {
  try {
    const parsed = JSON.parse(await fs.readFile(liveStateFile(root), "utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { schema?: unknown }).schema === LIVE_STATE_SCHEMA &&
      Number.isSafeInteger((parsed as { revision?: unknown }).revision) &&
      typeof (parsed as { updatedAt?: unknown }).updatedAt === "string"
    ) {
      return {
        schema: LIVE_STATE_SCHEMA,
        revision: (parsed as { revision: number }).revision,
        updatedAt: (parsed as { updatedAt: string }).updatedAt,
      };
    }
  } catch {
    // Missing or malformed live delivery metadata should not hide durable state.
  }
  return {
    schema: LIVE_STATE_SCHEMA,
    revision: 0,
    updatedAt: "initial",
  };
}

function localWorkbenchLiveStateCursor(state: LocalWorkbenchLiveState): string {
  return `local:${state.revision}:${state.updatedAt}`;
}

function workbenchStateNotice(type: WorkbenchStateNotice["type"], cursor: string): WorkbenchStateNotice {
  return {
    schema: "workbench.state.notice.v1",
    type,
    cursor,
  };
}

function clampInspectionWaitTimeout(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs === undefined) {
    return 25_000;
  }
  return Math.max(1_000, Math.min(30_000, Math.trunc(timeoutMs)));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function liveDir(root: string): string {
  return path.join(root, WORKBENCH_DIR, LIVE_DIR);
}

function liveStateFile(root: string): string {
  return path.join(liveDir(root), "state.json");
}
