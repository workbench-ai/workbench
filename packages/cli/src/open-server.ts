import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs, watch, type FSWatcher } from "node:fs";
import type { Socket } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createWorkbenchActionCapabilities,
  createWorkbenchReadOnlyInspectionSnapshot,
  notifyWorkbenchReadOnlyInspectionChanged,
  parseWorkbenchOperationRequest,
  readWorkbenchReadOnlyInspectionCursor,
  waitForWorkbenchReadOnlyInspectionNotice,
  workbenchEvaluationCaseSourceFiles,
  workbenchJobEvidenceForSnapshot,
  writeWorkbenchEvaluationGradeSourceFiles,
  WorkbenchUserError,
} from "@workbench-ai/workbench-core";
import { jsonValue } from "./output.js";
import { asRecord, pathExists } from "./runtime-utils.js";
import {
  isWorkbenchAuthoredControlPath,
  isWorkbenchPackageSourcePath,
  isWorkbenchRuntimeMetadataPath,
  normalizeWorkbenchSkillName,
  normalizeWorkbenchSourcePath,
  parseWorkbenchCaseFileOwnerId,
  workbenchInspectionFileContent,
  workbenchInspectionFileOwnerKindFromRouteSegment,
  workbenchInspectionSnapshotManifest,
  type Json,
  type SurfaceSnapshotFile,
  type WorkbenchArtifact,
  type WorkbenchCaseMutationRequest,
  type WorkbenchCaseMutationResponse,
  type WorkbenchEvalCaseSnapshot,
  type WorkbenchEvalSnapshot,
  type WorkbenchGradeMutationRequest,
  type WorkbenchGradeMutationResponse,
  type WorkbenchInspectionFileContent,
  type WorkbenchInspectionFileOwnerKind,
  type WorkbenchInspectionSnapshot,
  type WorkbenchInspectionSnapshotEnvelope,
  type WorkbenchTrace,
  type WorkbenchVersion,
} from "@workbench-ai/workbench-contract";
import {
  startPrivateLocalWorkbenchOperation,
} from "./local-worker-control.js";

interface StartWorkbenchOpenServerOptions {
  dir?: string;
  authToken?: string;
  homeDir?: string;
  host?: string;
  port?: number;
}

interface StartedWorkbenchOpenServer {
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
    if (url.pathname === "/api/evaluation/grader" && request.method === "POST") {
      const mutation = await readGradeMutationRequest(request);
      const result = await writeEvaluationGrader({ dir, authToken, homeDir, mutation });
      sendText(response, 200, `${JSON.stringify(result, null, 2)}\n`, "application/json; charset=utf-8");
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
    snapshot: workbenchInspectionSnapshotManifest(snapshot),
    actions: createWorkbenchActionCapabilities(snapshot, {
      variant: "local",
      evidenceAccess: "full",
    }),
  };
}

async function readCaseMutationRequest(request: IncomingMessage): Promise<WorkbenchCaseMutationRequest> {
  const body = await readJsonObject(request);
  assertOnlyCaseMutationKeys(body);
  const caseId = readCaseMutationCaseId(body.caseId);
  const title = readCaseMutationTitle(body.title);
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    throw new WorkbenchUserError("Case prompt cannot be empty.");
  }
  const grade = readCaseGradeMutation(body.grade);
  const metadata = body.metadata === undefined ? undefined : jsonValue(body.metadata);
  return {
    ...(caseId ? { caseId } : {}),
    ...(title ? { title } : {}),
    prompt,
    ...(grade ? { grade } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

function assertOnlyCaseMutationKeys(body: Record<string, unknown>): void {
  const allowed = new Set(["caseId", "title", "prompt", "grade", "metadata"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new WorkbenchUserError(`Case field ${key} is not supported.`);
    }
  }
}

function readCaseMutationCaseId(value: unknown): string | undefined {
  return readCaseDirectoryName(value, "Case id");
}

function readCaseMutationTitle(value: unknown): string | undefined {
  const title = readCaseDirectoryName(value, "Case title");
  if (title && !/^[a-z0-9][a-z0-9_-]*$/u.test(title)) {
    throw new WorkbenchUserError("Case title must use lowercase letters, numbers, hyphens, or underscores.");
  }
  return title;
}

function readCaseDirectoryName(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new WorkbenchUserError(`${label} must be a string.`);
  }
  const caseId = value.trim();
  if (!caseId) {
    throw new WorkbenchUserError(`${label} cannot be empty.`);
  }
  if (
    caseId === "." ||
    caseId === ".." ||
    caseId.includes("/") ||
    caseId.includes("\\") ||
    path.isAbsolute(caseId)
  ) {
    throw new WorkbenchUserError(`${label} must be a safe case directory name.`);
  }
  return caseId;
}

function readCaseGradeMutation(value: unknown): WorkbenchCaseMutationRequest["grade"] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const grade = asRecord(value);
  if (!grade) {
    throw new WorkbenchUserError("Case grade must be an object.");
  }
  assertOnlyGradeMutationKeys(grade, "Case grade.");
  const adapter = grade.adapter === undefined
    ? undefined
    : typeof grade.adapter === "string" && grade.adapter.trim()
      ? grade.adapter.trim().toLowerCase()
      : "";
  if (adapter === "") {
    throw new WorkbenchUserError("Case grade.adapter must be a non-empty string.");
  }
  const authoring = readGradeAuthoringMutation(grade.authoring, "Case grade.authoring");
  return adapter || authoring
    ? {
        ...(adapter ? { adapter } : {}),
        ...(authoring ? { authoring } : {}),
      }
    : undefined;
}

async function readGradeMutationRequest(request: IncomingMessage): Promise<WorkbenchGradeMutationRequest> {
  const body = await readJsonObject(request);
  assertOnlyGradeMutationKeys(body, "Eval grader field ");
  const adapter = typeof body.adapter === "string" && body.adapter.trim()
    ? body.adapter.trim().toLowerCase()
    : "";
  if (!adapter) {
    throw new WorkbenchUserError("Eval grade.adapter must be a non-empty string.");
  }
  const authoring = readGradeAuthoringMutation(body.authoring, "Eval grade.authoring");
  return {
    adapter,
    ...(authoring ? { authoring } : {}),
  };
}

const GRADE_MUTATION_KEYS = new Set(["adapter", "authoring"]);

function assertOnlyGradeMutationKeys(body: Record<string, unknown>, fieldLabel: string): void {
  for (const key of Object.keys(body)) {
    if (!GRADE_MUTATION_KEYS.has(key)) {
      throw new WorkbenchUserError(`${fieldLabel}${key} is not supported.`);
    }
  }
}

function readGradeAuthoringMutation(
  value: unknown,
  label: string,
): Record<string, Json> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const authoring = asRecord(value);
  if (!authoring) {
    throw new WorkbenchUserError(`${label} must be an object.`);
  }
  return Object.keys(authoring).length > 0 ? authoring as Record<string, Json> : undefined;
}

async function writeEvaluationCase(options: {
  dir?: string;
  authToken?: string;
  homeDir?: string;
  mutation: WorkbenchCaseMutationRequest;
}): Promise<WorkbenchCaseMutationResponse> {
  const root = path.resolve(options.dir ?? process.cwd());
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root, authToken: options.authToken, homeDir: options.homeDir });
  const evalSnapshot = snapshot.evals[0];
  if (!evalSnapshot) {
    throw new WorkbenchUserError("No evaluation is configured.");
  }
  if (options.mutation.caseId) {
    return writeExistingEvaluationCase({
      root,
      authToken: options.authToken,
      homeDir: options.homeDir,
      evalSnapshot,
      mutation: { ...options.mutation, caseId: options.mutation.caseId },
    });
  }
  const baseId = options.mutation.title ?? (normalizeWorkbenchSkillName(options.mutation.prompt.slice(0, 60)) || "case");
  for (let suffix = 1; ; suffix += 1) {
    const caseId = suffix === 1 ? baseId : `${baseId}-${suffix}`;
    const caseDir = path.join(root, ".workbench", "cases", caseId);
    const files = workbenchEvaluationCaseSourceFiles({
      caseId,
      prompt: options.mutation.prompt,
      defaultGrade: evalSnapshot.grade,
      grade: options.mutation.grade,
      metadata: options.mutation.metadata,
    });
    const caseFile = files.find((file) => file.path.endsWith("/case.yaml"));
    const written: string[] = [];
    try {
      if (
        await pathExists(caseDir) ||
        await Promise.all(files.map((file) => pathExists(path.join(root, file.path)))).then((entries) => entries.some(Boolean))
      ) {
        continue;
      }
      await writeEvaluationCaseSourceFiles(root, files, "wx", written);
      await notifyWorkbenchReadOnlyInspectionChanged({
        dir: root,
        authToken: options.authToken,
        homeDir: options.homeDir,
      }).catch(() => undefined);
      return {
        caseId,
        path: (caseFile?.path ?? `.workbench/cases/${caseId}/case.yaml`).replace(/^\.workbench\//u, ""),
      };
    } catch (error) {
      if (isFileAlreadyExistsError(error)) {
        await Promise.all(written.map((filePath) => fs.rm(filePath, { force: true }).catch(() => undefined)));
        continue;
      }
      throw error;
    }
  }
}

async function writeExistingEvaluationCase(options: {
  root: string;
  authToken?: string;
  homeDir?: string;
  evalSnapshot: WorkbenchEvalSnapshot;
  mutation: WorkbenchCaseMutationRequest & { caseId: string };
}): Promise<WorkbenchCaseMutationResponse> {
  if (!options.evalSnapshot.cases.some((entry) => entry.id === options.mutation.caseId)) {
    throw new WorkbenchUserError(`Case ${options.mutation.caseId} is not in the current evaluation.`);
  }
  const nextCaseId = options.mutation.title ?? options.mutation.caseId;
  if (
    nextCaseId !== options.mutation.caseId &&
    options.evalSnapshot.cases.some((entry) => entry.id === nextCaseId)
  ) {
    throw new WorkbenchUserError(`Case ${nextCaseId} already exists.`);
  }
  const files = workbenchEvaluationCaseSourceFiles({
    caseId: nextCaseId,
    prompt: options.mutation.prompt,
    defaultGrade: options.evalSnapshot.grade,
    grade: options.mutation.grade,
    metadata: options.mutation.metadata,
  });
  const caseFile = files.find((file) => file.path.endsWith("/case.yaml"));
  if (nextCaseId !== options.mutation.caseId) {
    await renameEvaluationCaseDirectory(options.root, options.mutation.caseId, nextCaseId);
  }
  await removeStaleGeneratedCaseFiles(options.root, nextCaseId, files);
  await writeEvaluationCaseSourceFiles(options.root, files, "w");
  await notifyWorkbenchReadOnlyInspectionChanged({
    dir: options.root,
    authToken: options.authToken,
    homeDir: options.homeDir,
  }).catch(() => undefined);
  return {
    caseId: nextCaseId,
    path: (caseFile?.path ?? `.workbench/cases/${nextCaseId}/case.yaml`).replace(/^\.workbench\//u, ""),
  };
}

async function renameEvaluationCaseDirectory(root: string, fromCaseId: string, toCaseId: string): Promise<void> {
  const casesRoot = path.join(root, ".workbench", "cases");
  const fromDir = path.join(casesRoot, fromCaseId);
  const toDir = path.join(casesRoot, toCaseId);
  if (await pathExists(toDir)) {
    throw new WorkbenchUserError(`Case ${toCaseId} already exists.`);
  }
  try {
    await fs.rename(fromDir, toDir);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
      throw new WorkbenchUserError(`Case ${fromCaseId} source folder is missing.`);
    }
    throw error;
  }
}

async function writeEvaluationCaseSourceFiles(
  root: string,
  files: readonly SurfaceSnapshotFile[],
  flag: "w" | "wx",
  written: string[] = [],
): Promise<void> {
  for (const file of files) {
    const absolutePath = path.join(root, file.path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.content, { encoding: "utf8", flag });
    written.push(absolutePath);
    if (file.executable) {
      await fs.chmod(absolutePath, 0o755);
    }
  }
}

async function removeStaleGeneratedCaseFiles(
  root: string,
  caseId: string,
  files: readonly SurfaceSnapshotFile[],
): Promise<void> {
  const generatedFiles = new Set(files.map((file) => path.join(root, file.path)));
  const staleGeneratedFiles = [
    path.join(root, ".workbench", "cases", caseId, "tests", "test.sh"),
  ];
  for (const staleFile of staleGeneratedFiles) {
    if (generatedFiles.has(staleFile)) {
      continue;
    }
    await fs.rm(staleFile, { force: true }).catch(() => undefined);
    await fs.rmdir(path.dirname(staleFile)).catch(() => undefined);
  }
}

async function writeEvaluationGrader(options: {
  dir?: string;
  authToken?: string;
  homeDir?: string;
  mutation: WorkbenchGradeMutationRequest;
}): Promise<WorkbenchGradeMutationResponse> {
  const root = path.resolve(options.dir ?? process.cwd());
  const files = await writeWorkbenchEvaluationGradeSourceFiles({
    dir: root,
    authToken: options.authToken,
    homeDir: options.homeDir,
    mutation: options.mutation,
  });
  const file = files[0];
  if (!file) {
    throw new WorkbenchUserError("Eval grader did not produce a source file.");
  }
  await notifyWorkbenchReadOnlyInspectionChanged({
    dir: root,
    authToken: options.authToken,
    homeDir: options.homeDir,
  }).catch(() => undefined);
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root, authToken: options.authToken, homeDir: options.homeDir });
  return {
    path: file.path.replace(/^\.workbench\//u, ""),
    evaluationHash: snapshot.evals[0]?.hash,
  };
}

function isFileAlreadyExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST");
}

async function readOperationRequest(request: IncomingMessage) {
  return parseWorkbenchOperationRequest(await readJsonObject(request), "local");
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
): Pick<WorkbenchVersion | WorkbenchTrace | WorkbenchArtifact | WorkbenchEvalCaseSnapshot, "files"> | undefined {
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
