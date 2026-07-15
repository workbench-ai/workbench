import { promises as fs } from "node:fs";
import path from "node:path";

import {
  clampWorkbenchInspectionWaitTimeout,
  createWorkbenchStateNotice,
  type WorkbenchStateNotice,
} from "@workbench-ai/workbench-contract";
import { sleep } from "./runtime-utils.ts";

const WORKBENCH_DIR = ".workbench";
const LIVE_DIR = "live";
const LIVE_STATE_SCHEMA = "workbench.live-state.v1";
const liveStateQueues = new Map<string, Promise<void>>();

interface LocalWorkbenchLiveState {
  schema: typeof LIVE_STATE_SCHEMA;
  stateRevision: number;
  progressRevision: number;
  updatedAt: string;
  progressRunIds?: string[];
  progressJobIds?: string[];
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
  const timeoutMs = clampWorkbenchInspectionWaitTimeout(options.timeoutMs);
  const startedAt = Date.now();
  const requestedCursor = options.cursor?.trim();
  const requestedState = parseLocalWorkbenchLiveStateCursor(requestedCursor);
  let currentState = await readLocalWorkbenchLiveState(options.root);
  let currentCursor = localWorkbenchLiveStateCursor(currentState);
  if (!requestedState) {
    return createWorkbenchStateNotice("reset", currentCursor);
  }
  const immediateNotice = changedLocalWorkbenchStateNotice(requestedState, currentState);
  if (immediateNotice) {
    return immediateNotice;
  }
  while (Date.now() - startedAt < timeoutMs) {
    if (options.signal?.aborted) {
      return createWorkbenchStateNotice("heartbeat", currentCursor);
    }
    await sleep(Math.min(250, Math.max(25, timeoutMs - (Date.now() - startedAt))));
    currentState = await readLocalWorkbenchLiveState(options.root);
    currentCursor = localWorkbenchLiveStateCursor(currentState);
    const nextNotice = changedLocalWorkbenchStateNotice(requestedState, currentState);
    if (nextNotice) {
      return nextNotice;
    }
  }
  return createWorkbenchStateNotice("heartbeat", currentCursor);
}

export async function advanceLocalWorkbenchLiveState(
  root: string,
  options: {
    kind?: "state" | "progress";
    runId?: string;
    jobId?: string;
  } = {},
): Promise<void> {
  const normalizedRoot = path.resolve(root);
  const previous = liveStateQueues.get(normalizedRoot) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const previousState = await readLocalWorkbenchLiveState(root);
    const kind = options.kind ?? "state";
    const nextState: LocalWorkbenchLiveState = {
      schema: LIVE_STATE_SCHEMA,
      stateRevision: previousState.stateRevision + (kind === "state" ? 1 : 0),
      progressRevision: previousState.progressRevision + (kind === "progress" ? 1 : 0),
      updatedAt: new Date().toISOString(),
      ...(kind === "progress" && options.runId ? { progressRunIds: [options.runId] } : {}),
      ...(kind === "progress" && options.jobId ? { progressJobIds: [options.jobId] } : {}),
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
      typeof (parsed as { updatedAt?: unknown }).updatedAt === "string"
    ) {
      const record = parsed as {
        revision?: unknown;
        stateRevision?: unknown;
        progressRevision?: unknown;
        updatedAt: string;
        progressRunIds?: unknown;
        progressJobIds?: unknown;
      };
      const stateRevision = Number.isSafeInteger(record.stateRevision)
        ? record.stateRevision as number
        : Number.isSafeInteger(record.revision)
          ? record.revision as number
          : 0;
      const progressRevision = Number.isSafeInteger(record.progressRevision)
        ? record.progressRevision as number
        : 0;
      return {
        schema: LIVE_STATE_SCHEMA,
        stateRevision,
        progressRevision,
        updatedAt: record.updatedAt,
        ...stringArrayField(record.progressRunIds, "progressRunIds"),
        ...stringArrayField(record.progressJobIds, "progressJobIds"),
      };
    }
  } catch {
    // Missing or malformed live delivery metadata should not hide durable state.
  }
  return {
    schema: LIVE_STATE_SCHEMA,
    stateRevision: 0,
    progressRevision: 0,
    updatedAt: "initial",
  };
}

function localWorkbenchLiveStateCursor(state: LocalWorkbenchLiveState): string {
  return `local:${state.stateRevision}:${state.progressRevision}:${state.updatedAt}`;
}

function parseLocalWorkbenchLiveStateCursor(cursor: string | undefined): Pick<LocalWorkbenchLiveState, "stateRevision" | "progressRevision"> | null {
  if (!cursor?.startsWith("local:")) {
    return null;
  }
  const parts = cursor.split(":");
  const stateRevision = Number(parts[1]);
  if (!Number.isSafeInteger(stateRevision) || stateRevision < 0) {
    return null;
  }
  const progressRevision = Number(parts[2]);
  if (Number.isSafeInteger(progressRevision) && progressRevision >= 0 && parts.length >= 4) {
    return { stateRevision, progressRevision };
  }
  return { stateRevision, progressRevision: 0 };
}

function changedLocalWorkbenchStateNotice(
  requested: Pick<LocalWorkbenchLiveState, "stateRevision" | "progressRevision">,
  current: LocalWorkbenchLiveState,
): WorkbenchStateNotice | null {
  const cursor = localWorkbenchLiveStateCursor(current);
  if (requested.stateRevision !== current.stateRevision) {
    return createWorkbenchStateNotice("changed", cursor);
  }
  if (requested.progressRevision !== current.progressRevision) {
    return createWorkbenchStateNotice("progress", cursor, {
      runIds: current.progressRunIds,
      jobIds: current.progressJobIds,
    });
  }
  return null;
}

function stringArrayField(
  value: unknown,
  key: "progressRunIds" | "progressJobIds",
): Partial<Pick<LocalWorkbenchLiveState, "progressRunIds" | "progressJobIds">> {
  if (!Array.isArray(value)) {
    return {};
  }
  const strings = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return strings.length > 0
    ? { [key]: strings } as Partial<Pick<LocalWorkbenchLiveState, "progressRunIds" | "progressJobIds">>
    : {};
}

function liveDir(root: string): string {
  return path.join(root, WORKBENCH_DIR, LIVE_DIR);
}

function liveStateFile(root: string): string {
  return path.join(liveDir(root), "state.json");
}
