import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs, watch, type FSWatcher } from "node:fs";
import type { Socket } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

import {
  createWorkbenchActionCapabilities,
  createWorkbenchReadOnlyInspectionSnapshot,
  notifyWorkbenchReadOnlyInspectionChanged,
  previewLocalWorkbenchOperation,
  readWorkbenchReadOnlyInspectionCursor,
  waitForWorkbenchReadOnlyInspectionNotice,
  workbenchJobEvidenceForSnapshot,
  workbenchInspectionFileContent,
  workbenchInspectionFileManifest,
  WorkbenchUserError,
  type SurfaceSnapshotFile,
  type WorkbenchArtifact,
  type WorkbenchEvalCaseSnapshot,
  type WorkbenchEvalSnapshot,
  type WorkbenchInspectionFileContent,
  type WorkbenchInspectionSnapshot,
  type WorkbenchInspectionSnapshotEnvelope,
  type WorkbenchTrace,
  type WorkbenchVersion,
} from "@workbench-ai/workbench-core";
import {
  isWorkbenchAuthoredControlPath,
  isWorkbenchPackageSourcePath,
  isWorkbenchRuntimeMetadataPath,
  normalizeWorkbenchSkillName,
  normalizeWorkbenchSourcePath,
  parseWorkbenchCaseFileOwnerId,
  workbenchInspectionFileOwnerKindFromRouteSegment,
  type Json,
  type WorkbenchCaseMutationRequest,
  type WorkbenchCaseMutationResponse,
  type WorkbenchInspectionFileOwnerKind,
  type WorkbenchOperationGrader,
  type WorkbenchOperationPhase,
  type WorkbenchOperationRequest,
  type WorkbenchOperationTarget,
} from "@workbench-ai/workbench-contract";
import {
  startPrivateLocalWorkbenchOperation,
} from "./local-worker-control.js";

export interface StartWorkbenchOpenServerOptions {
  dir?: string;
  authToken?: string;
  homeDir?: string;
  host?: string;
  port?: number;
}

export interface StartedWorkbenchOpenServer {
  url: string;
  close(): Promise<void>;
}

export async function startWorkbenchOpenServer(
  options: StartWorkbenchOpenServerOptions = {},
): Promise<StartedWorkbenchOpenServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const assetRoot = await resolveDevOpenAssetRoot();
  const assetVersion = await devOpenAssetVersion(assetRoot);
  const shutdown = new AbortController();
  const sourceWatcher = await startSourceWatcher({
    dir: options.dir,
    authToken: options.authToken,
    homeDir: options.homeDir,
    signal: shutdown.signal,
  });
  const server = createServer((request, response) => {
    void handleRequest({
      request,
      response,
      assetRoot,
      assetVersion,
      dir: options.dir,
      authToken: options.authToken,
      homeDir: options.homeDir,
      signal: shutdown.signal,
    });
  });
  const sockets = new Set<Socket>();
  let closePromise: Promise<void> | undefined;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new WorkbenchUserError("Could not determine Workbench open server address.");
  }
  const display = displayHost(host);
  return {
    url: `http://${display}:${address.port}/`,
    close: () => {
      closePromise ??= new Promise((resolve, reject) => {
        shutdown.abort();
        sourceWatcher?.close();
        for (const socket of sockets) {
          socket.destroy();
        }
        server.closeAllConnections();
        server.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      return closePromise;
    },
  };
}

async function startSourceWatcher(options: {
  dir?: string;
  authToken?: string;
  homeDir?: string;
  signal: AbortSignal;
}): Promise<FSWatcher | null> {
  const root = path.resolve(options.dir ?? process.cwd());
  try {
    await fs.access(path.join(root, ".workbench"));
  } catch {
    return null;
  }
  let debounce: NodeJS.Timeout | undefined;
  const notify = () => {
    if (debounce) {
      clearTimeout(debounce);
    }
    debounce = setTimeout(() => {
      debounce = undefined;
      void notifyWorkbenchReadOnlyInspectionChanged({
        dir: root,
        authToken: options.authToken,
        homeDir: options.homeDir,
      }).catch(() => undefined);
    }, 120);
  };
  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true }, (_eventType, filename) => {
      if (options.signal.aborted) {
        return;
      }
      if (!filename) {
        notify();
        return;
      }
      const relativePath = String(filename);
      if (sourceWatchPathShouldInvalidate(relativePath)) {
        notify();
      }
    });
  } catch {
    return null;
  }
  const close = () => {
    if (debounce) {
      clearTimeout(debounce);
      debounce = undefined;
    }
    watcher.close();
  };
  options.signal.addEventListener("abort", close, { once: true });
  return watcher;
}

function sourceWatchPathShouldInvalidate(filePath: string): boolean {
  let normalized: string;
  try {
    normalized = normalizeWorkbenchSourcePath(filePath);
  } catch {
    return false;
  }
  if (isWorkbenchRuntimeMetadataPath(normalized)) {
    return false;
  }
  return isWorkbenchPackageSourcePath(normalized) || isWorkbenchAuthoredControlPath(normalized);
}

async function resolveDevOpenAssetRoot(): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, "dev-open"),
    path.join(moduleDir, "..", "dist", "dev-open"),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, "client.js"));
      return candidate;
    } catch {
      // Try the next source/build layout.
    }
  }
  return candidates[0]!;
}

async function devOpenAssetVersion(assetRoot: string): Promise<string> {
  const stats = await fs.stat(path.join(assetRoot, "client.js"));
  return `${Math.trunc(stats.mtimeMs)}-${stats.size}`;
}

async function handleRequest({
  request,
  response,
  assetRoot,
  assetVersion,
  dir,
  authToken,
  homeDir,
  signal,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  assetRoot: string;
  assetVersion: string;
  dir?: string;
  authToken?: string;
  homeDir?: string;
  signal: AbortSignal;
}): Promise<void> {
  try {
    const requestSignal = requestAbortSignal(signal, request);
    const url = new URL(request.url ?? "/", "http://workbench.local");
    if (url.pathname === "/api/snapshot") {
      const envelope = await createInspectionSnapshotEnvelope({ dir, authToken, homeDir });
      sendText(response, 200, `${JSON.stringify(envelope, null, 2)}\n`, "application/json; charset=utf-8");
      return;
    }
    if (url.pathname === "/api/evaluation/cases" && request.method === "POST") {
      const mutation = await readCaseMutationRequest(request);
      const result = await writeEvaluationCase({ dir, authToken, homeDir, mutation });
      sendText(response, 200, `${JSON.stringify(result, null, 2)}\n`, "application/json; charset=utf-8");
      return;
    }
    if (url.pathname === "/api/operations/preview" && request.method === "POST") {
      const operationRequest = await readOperationRequest(request);
      const preview = await previewLocalWorkbenchOperation({
        dir,
        authToken,
        homeDir,
        request: operationRequest,
      });
      sendText(response, 200, `${JSON.stringify(preview, null, 2)}\n`, "application/json; charset=utf-8");
      return;
    }
    if (url.pathname === "/api/operations" && request.method === "POST") {
      const operationRequest = await readOperationRequest(request);
      const started = await startPrivateLocalWorkbenchOperation({
        core: { dir, authToken, homeDir },
        request: operationRequest,
      });
      sendText(response, 200, `${JSON.stringify(started.snapshot, null, 2)}\n`, "application/json; charset=utf-8");
      return;
    }
    if (url.pathname === "/api/state/wait") {
      const notice = await waitForWorkbenchReadOnlyInspectionNotice({
        dir,
        authToken,
        homeDir,
        cursor: url.searchParams.get("cursor") ?? undefined,
        timeoutMs: parseInspectionWaitTimeout(url.searchParams.get("timeoutMs")),
        signal: requestSignal,
      });
      sendText(response, 200, `${JSON.stringify(notice, null, 2)}\n`, "application/json; charset=utf-8");
      return;
    }
    if (url.pathname === "/api/state/stream") {
      await sendStateEventStream({
        request,
        response,
        dir,
        authToken,
        homeDir,
        cursor: url.searchParams.get("cursor") ?? undefined,
        signal: requestSignal,
      });
      return;
    }
    const jobEvidenceRoute = parseJobEvidenceApiPath(url.pathname);
    if (jobEvidenceRoute) {
      const runId = url.searchParams.get("run")?.trim();
      if (!runId) {
        sendText(response, 400, `${JSON.stringify({ message: "run is required" })}\n`, "application/json; charset=utf-8");
        return;
      }
      const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir, authToken, homeDir });
      const detail = workbenchJobEvidenceForSnapshot(snapshot, {
        runId,
        jobId: jobEvidenceRoute.jobId,
      });
      if (!detail) {
        sendText(response, 404, `${JSON.stringify({ message: "Job evidence not found" })}\n`, "application/json; charset=utf-8");
        return;
      }
      sendText(response, 200, `${JSON.stringify(detail, null, 2)}\n`, "application/json; charset=utf-8");
      return;
    }
    const fileRoute = parseInspectionFileApiPath(url.pathname);
    if (fileRoute) {
      const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir, authToken, homeDir });
      const content = inspectionFileContentForSnapshot(snapshot, fileRoute);
      if (!content) {
        sendText(response, 404, `${JSON.stringify({ message: "File not found" })}\n`, "application/json; charset=utf-8");
        return;
      }
      sendText(response, 200, `${JSON.stringify(content, null, 2)}\n`, "application/json; charset=utf-8");
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      sendText(response, 404, `${JSON.stringify({ message: "Not found" })}\n`, "application/json; charset=utf-8");
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      sendText(response, 200, html(assetVersion), "text/html; charset=utf-8");
      return;
    }
    if (url.pathname === "/client.js" || url.pathname === "/client.css" || url.pathname.startsWith("/fonts/")) {
      await sendAsset(response, assetRoot, url.pathname.slice(1));
      return;
    }
    sendText(response, 200, html(assetVersion), "text/html; charset=utf-8");
  } catch (error) {
    if (signal.aborted || response.destroyed || response.writableEnded) {
      return;
    }
    if (error instanceof WorkbenchUserError) {
      sendText(response, 400, `${JSON.stringify({ message: error.message })}\n`, "application/json; charset=utf-8");
      return;
    }
    sendText(response, 500, `${error instanceof Error ? error.message : String(error)}\n`, "text/plain; charset=utf-8");
  }
}

function requestAbortSignal(signal: AbortSignal, request: IncomingMessage): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) {
    abort();
  } else {
    signal.addEventListener("abort", abort, { once: true });
  }
  request.on("close", abort);
  return controller.signal;
}

async function createInspectionSnapshotEnvelope(options: {
  dir?: string;
  authToken?: string;
  homeDir?: string;
}): Promise<WorkbenchInspectionSnapshotEnvelope> {
  // Read the cursor first so an envelope can be stale-but-refreshable, never fresh-but-silent.
  const cursor = await readWorkbenchReadOnlyInspectionCursor(options);
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(options);
  return {
    schema: "workbench.inspection.snapshot-envelope.v1",
    cursor,
    snapshot: inspectionSnapshotManifest(snapshot),
    actions: createWorkbenchActionCapabilities(snapshot, {
      variant: "local",
      evidenceAccess: "full",
    }),
  };
}

async function readCaseMutationRequest(request: IncomingMessage): Promise<WorkbenchCaseMutationRequest> {
  const body = await readJsonObject(request);
  if ("caseId" in body) {
    throw new WorkbenchUserError("Case creation derives case ids from the title or prompt.");
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    throw new WorkbenchUserError("Case prompt cannot be empty.");
  }
  const metadata = body.metadata === undefined ? undefined : body.metadata as Json;
  return {
    ...(typeof body.title === "string" && body.title.trim() ? { title: body.title.trim() } : {}),
    prompt,
    ...(typeof body.expected === "string" && body.expected.trim() ? { expected: body.expected.trim() } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

async function writeEvaluationCase(options: {
  dir?: string;
  authToken?: string;
  homeDir?: string;
  mutation: WorkbenchCaseMutationRequest;
}): Promise<WorkbenchCaseMutationResponse> {
  const root = path.resolve(options.dir ?? process.cwd());
  const baseId = normalizeWorkbenchSkillName(options.mutation.title ?? options.mutation.prompt.slice(0, 60)) || "case";
  for (let suffix = 1; ; suffix += 1) {
    const caseId = suffix === 1 ? baseId : `${baseId}-${suffix}`;
    const relativePath = path.join("cases", caseId, "case.yaml").replace(/\\/gu, "/");
    const absolutePath = path.join(root, ".workbench", relativePath);
    const record: Record<string, Json> = {
      version: 1,
      id: caseId,
      ...(options.mutation.title ? { title: options.mutation.title } : {}),
      prompt: options.mutation.prompt,
      ...(options.mutation.expected ? { expected: options.mutation.expected } : {}),
      ...(options.mutation.metadata !== undefined ? { metadata: options.mutation.metadata } : {}),
    };
    try {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, YAML.stringify(record), { encoding: "utf8", flag: "wx" });
      await notifyWorkbenchReadOnlyInspectionChanged({
        dir: root,
        authToken: options.authToken,
        homeDir: options.homeDir,
      }).catch(() => undefined);
      return {
        caseId,
        path: relativePath,
      };
    } catch (error) {
      if (isFileAlreadyExistsError(error)) {
        continue;
      }
      throw error;
    }
  }
}

function isFileAlreadyExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST");
}

async function readOperationRequest(request: IncomingMessage): Promise<WorkbenchOperationRequest> {
  const body = await readJsonObject(request);
  if (body.kind === "improve") {
    const target = readOptionalOperationTarget(body.target);
    const samples = readPositiveInteger(body.samples);
    const budget = readPositiveInteger(body.budget);
    return {
      kind: "improve",
      variant: "local",
      ...(target ? { target } : {}),
      ...(typeof body.versionId === "string" && body.versionId.trim() ? { versionId: body.versionId.trim() } : {}),
      ...(typeof body.evalHash === "string" && body.evalHash.trim() ? { evalHash: body.evalHash.trim() } : {}),
      ...(samples ? { samples } : {}),
      ...(budget ? { budget } : {}),
      ...(Array.isArray(body.evidenceTraceIds)
        ? { evidenceTraceIds: readStringArray(body.evidenceTraceIds) }
        : {}),
      ...(typeof body.retryOfRunId === "string" && body.retryOfRunId.trim() ? { retryOfRunId: body.retryOfRunId.trim() } : {}),
    };
  }
  if (body.kind !== "eval") {
    throw new WorkbenchUserError("Operation kind must be eval or improve.");
  }
  const phases = readOperationPhases(body.phases);
  const samples = readPositiveInteger(body.samples);
  const caseIds = Array.isArray(body.caseIds) ? readStringArray(body.caseIds) : [];
  if (caseIds.length === 0) {
    throw new WorkbenchUserError("Eval operations must include at least one case.");
  }
  return {
    kind: "eval",
    variant: "local",
    caseIds,
    targets: readOperationTargets(body.targets),
    phases,
    grader: readOperationGrader(body.grader, phases),
    ...(samples ? { samples } : {}),
    ...(body.rerun === true ? { rerun: true } : {}),
    ...(typeof body.gradeOfRunId === "string" && body.gradeOfRunId.trim() ? { gradeOfRunId: body.gradeOfRunId.trim() } : {}),
    ...(typeof body.retryOfRunId === "string" && body.retryOfRunId.trim() ? { retryOfRunId: body.retryOfRunId.trim() } : {}),
  };
}

function readOperationTargets(value: unknown): WorkbenchOperationTarget[] {
  if (!Array.isArray(value)) {
    throw new WorkbenchUserError("Eval operation targets must be an array.");
  }
  const targets = value.map((entry) => readOperationTarget(entry));
  if (targets.length === 0) {
    throw new WorkbenchUserError("Eval operation targets must include at least one configuration.");
  }
  return targets;
}

function readOptionalOperationTarget(value: unknown): WorkbenchOperationTarget | undefined {
  return asJsonRecord(value) ? readOperationTarget(value) : undefined;
}

function readOperationTarget(value: unknown): WorkbenchOperationTarget {
  const target = asJsonRecord(value);
  if (!target) {
    throw new WorkbenchUserError("Operation target must be an object.");
  }
  const skill = readOptionalOperationTargetString(target.skill, "Operation target skill");
  const versionId = readOptionalOperationTargetString(target.versionId, "Operation target versionId");
  const agent = readOptionalOperationTargetString(target.agent, "Operation target agent");
  return {
    ...(skill ? { skill } : {}),
    ...(versionId ? { versionId } : {}),
    ...(agent ? { agent } : {}),
  };
}

function readOptionalOperationTargetString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkbenchUserError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function readOperationPhases(value: unknown): WorkbenchOperationPhase[] {
  if (!Array.isArray(value)) {
    throw new WorkbenchUserError("Eval operation phases must be an array.");
  }
  const phases: WorkbenchOperationPhase[] = [];
  for (const entry of value) {
    if ((entry === "execute" || entry === "grade") && !phases.includes(entry)) {
      phases.push(entry);
    }
  }
  if (phases.length === 0) {
    throw new WorkbenchUserError("Eval operation phases must include execute or grade.");
  }
  return phases;
}

function readOperationGrader(value: unknown, phases: readonly WorkbenchOperationPhase[]): WorkbenchOperationGrader {
  const grader = asJsonRecord(value);
  if (!grader) {
    return phases.includes("grade") ? { kind: "evaluation" } : { kind: "none" };
  }
  if (grader.kind === "none" || grader.kind === "evaluation") {
    return { kind: grader.kind };
  }
  throw new WorkbenchUserError("Eval operation grader must be none or evaluation.");
}

function readStringArray(value: readonly unknown[]): string[] {
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim()))];
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function readJsonObject(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const content = Buffer.concat(chunks).toString("utf8").trim();
  if (!content) {
    return {};
  }
  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkbenchUserError("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function readPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function sendStateEventStream({
  request,
  response,
  dir,
  authToken,
  homeDir,
  cursor,
  signal,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  dir?: string;
  authToken?: string;
  homeDir?: string;
  cursor?: string;
  signal: AbortSignal;
}): Promise<void> {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  let closed = false;
  request.on("close", () => {
    closed = true;
  });
  let currentCursor = cursor;
  while (!closed) {
    const notice = await waitForWorkbenchReadOnlyInspectionNotice({
      dir,
      authToken,
      homeDir,
      cursor: currentCursor,
      timeoutMs: 25_000,
      signal,
    });
    if (closed) {
      return;
    }
    currentCursor = notice.cursor;
    response.write(`data: ${JSON.stringify(notice)}\n\n`);
  }
}

function parseInspectionWaitTimeout(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inspectionSnapshotManifest(snapshot: WorkbenchInspectionSnapshot): WorkbenchInspectionSnapshot {
  return {
    ...snapshot,
    versions: snapshot.versions.map((version) => ({
      ...version,
      files: inspectionFileManifests(version.files),
    })),
    skillBundles: snapshot.skillBundles.map((bundle) => ({
      ...bundle,
      files: inspectionFileManifests(bundle.files),
    })),
    evals: snapshot.evals.map((evalSnapshot) => ({
      ...evalSnapshot,
      files: inspectionFileManifests(evalSnapshot.files),
      cases: evalSnapshot.cases.map((evalCase) => ({
        ...evalCase,
        files: inspectionFileManifests(evalCase.files),
      })),
    })),
    ...(snapshot.evaluationFiles ? { evaluationFiles: inspectionFileManifests(snapshot.evaluationFiles) } : {}),
    ...(snapshot.results ? {
      results: {
        ...snapshot.results,
        skillVersions: snapshot.results.skillVersions.map((version) => ({
          ...version,
          ...(version.files ? { files: inspectionFileManifests(version.files) } : {}),
        })),
      },
    } : {}),
    traces: snapshot.traces.map((trace) => ({
      ...trace,
      files: inspectionFileManifests(trace.files),
    })),
    artifacts: snapshot.artifacts.map((artifact) => ({
      ...artifact,
      files: inspectionFileManifests(artifact.files),
    })),
  };
}

function inspectionFileManifests(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  return files.map(workbenchInspectionFileManifest);
}

function parseJobEvidenceApiPath(pathname: string): { jobId: string } | null {
  const segments = pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  const [api, jobs, jobId, evidence] = segments;
  if (api !== "api" || jobs !== "jobs" || evidence !== "evidence" || !jobId || segments.length !== 4) {
    return null;
  }
  return { jobId };
}

function parseInspectionFileApiPath(pathname: string): {
  ownerKind: WorkbenchInspectionFileOwnerKind;
  ownerId: string;
  path: string;
} | null {
  const segments = pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  const [api, ownerKind, ownerId, files, ...filePath] = segments;
  const parsedOwnerKind = workbenchInspectionFileOwnerKindFromRouteSegment(ownerKind ?? "");
  if (api !== "api" || files !== "files" || !ownerId || filePath.length === 0) {
    return null;
  }
  if (!parsedOwnerKind) {
    return null;
  }
  return {
    ownerKind: parsedOwnerKind,
    ownerId,
    path: filePath.join("/"),
  };
}

function inspectionFileContentForSnapshot(
  snapshot: WorkbenchInspectionSnapshot,
  route: {
    ownerKind: WorkbenchInspectionFileOwnerKind;
    ownerId: string;
    path: string;
  },
): WorkbenchInspectionFileContent | null {
  const owner = findInspectionFileOwner(snapshot, route.ownerKind, route.ownerId);
  const file = owner?.files.find((entry) => entry.path === route.path);
  return file ? workbenchInspectionFileContent(file) : null;
}

function findInspectionFileOwner(
  snapshot: WorkbenchInspectionSnapshot,
  ownerKind: WorkbenchInspectionFileOwnerKind,
  ownerId: string,
): Pick<WorkbenchVersion | WorkbenchTrace | WorkbenchArtifact | WorkbenchEvalCaseSnapshot | WorkbenchEvalSnapshot, "files"> | undefined {
  if (ownerKind === "version") {
    return snapshot.versions.find((entry) => entry.id === ownerId);
  }
  if (ownerKind === "trace") {
    return snapshot.traces.find((entry) => entry.id === ownerId);
  }
  if (ownerKind === "case") {
    const parsed = parseWorkbenchCaseFileOwnerId(ownerId);
    if (!parsed) {
      return undefined;
    }
    return snapshot.evals
      .find((entry) => entry.hash === parsed.evaluationHash)
      ?.cases.find((entry) => entry.id === parsed.caseId);
  }
  if (ownerKind === "evaluation") {
    return ownerId === "current"
      ? { files: snapshot.evaluationFiles ?? snapshot.evals[0]?.files ?? [] }
      : snapshot.evals.find((entry) => entry.hash === ownerId);
  }
  return snapshot.artifacts.find((entry) => entry.id === ownerId);
}

async function sendAsset(response: ServerResponse, assetRoot: string, relativePath: string): Promise<void> {
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    sendText(response, 404, "Not found\n", "text/plain; charset=utf-8");
    return;
  }
  const content = await fs.readFile(path.join(assetRoot, normalized)).catch(() => null);
  if (!content) {
    sendText(response, 404, "Not found\n", "text/plain; charset=utf-8");
    return;
  }
  response.statusCode = 200;
  response.setHeader("content-type", contentType(normalized));
  response.setHeader("cache-control", "no-store");
  response.end(content);
}

function sendText(response: ServerResponse, status: number, content: string, type: string): void {
  response.statusCode = status;
  response.setHeader("content-type", type);
  response.setHeader("cache-control", "no-store");
  response.end(content);
}

function html(assetVersion: string): string {
  const version = encodeURIComponent(assetVersion);
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>Workbench</title>",
    `<link rel="stylesheet" href="/client.css?v=${version}">`,
    "</head>",
    "<body>",
    "<div id=\"root\"></div>",
    `<script type="module" src="/client.js?v=${version}"></script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".woff2")) {
    return "font/woff2";
  }
  if (filePath.endsWith(".woff")) {
    return "font/woff";
  }
  return "application/octet-stream";
}

function displayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
