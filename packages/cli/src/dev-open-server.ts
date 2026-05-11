import { promises as fs } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCandidateCasePhaseRefs,
  buildWorkbenchTracePhases,
  createCandidateFilePreview,
  createCaseReview,
  loadAuthoredWorkbenchSourceDocument,
  summarizeCandidateFiles,
  type CandidateRecord,
  type EvaluationResultRecord,
  type HostedWorkbenchJob,
  type RunSummary,
  type SurfaceSnapshotFile,
  type WorkbenchExecutionTrace,
} from "@workbench-ai/workbench-core";

import {
  loadLocalArchive,
  localRuntimeDir,
  readLocalCandidate,
  readLocalCandidateFiles,
  readLocalExecutionFiles,
  type LocalArchiveSnapshot,
} from "./local-archive.js";
import {
  readSnapshotFiles,
  type WorkspaceSnapshotFile,
} from "./workspace-snapshot.js";
import {
  readLocalProjectSource,
  WORKBENCH_BENCHMARK_FILE,
} from "./project-source.js";
import { localBenchmarkFingerprint } from "./benchmark-fingerprint.js";

export interface LocalWorkbenchDevServer {
  url: string;
  close: () => Promise<void>;
}

export interface LocalWorkbenchDevServerOptions {
  workspace: string;
  host: string;
  port: number;
  assetsRoot?: string;
}

class LocalApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const DEV_OPEN_ASSET_DIR = "dev-open";

export async function startLocalWorkbenchDevServer(
  options: LocalWorkbenchDevServerOptions,
): Promise<LocalWorkbenchDevServer> {
  const workspace = path.resolve(options.workspace);
  const assetsRoot = options.assetsRoot ?? defaultDevOpenAssetsRoot();
  await assertDevOpenAssets(assetsRoot);

  const server = http.createServer((request, response) => {
    void handleLocalWorkbenchRequest({
      request,
      response,
      workspace,
      assetsRoot,
    }).catch((error: unknown) => {
      sendError(response, error, request.method);
    });
  });
  server.requestTimeout = 0;
  server.timeout = 0;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Workbench local server did not bind a TCP port.");
  }
  const host = displayHost(options.host);
  return {
    url: `http://${host}:${address.port}/`,
    close: () => closeServer(server),
  };
}

function defaultDevOpenAssetsRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), DEV_OPEN_ASSET_DIR);
}

async function assertDevOpenAssets(assetsRoot: string): Promise<void> {
  await Promise.all([
    fs.stat(path.join(assetsRoot, "client.js")),
    fs.stat(path.join(assetsRoot, "client.css")),
  ]).catch(() => {
    throw new Error(
      `Workbench local browser assets are missing from ${assetsRoot}. Run pnpm --dir products/workbench/packages/cli build.`,
    );
  });
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function handleLocalWorkbenchRequest(args: {
  request: IncomingMessage;
  response: ServerResponse;
  workspace: string;
  assetsRoot: string;
}): Promise<void> {
  const url = new URL(args.request.url ?? "/", "http://workbench.local");
  if (args.request.method !== "GET" && args.request.method !== "HEAD") {
    sendJson(args.response, { message: "Workbench local open is read-only." }, 405, args.request.method);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    await handleApiRequest(args.request, args.response, args.workspace, url);
    return;
  }
  if (url.pathname === "/assets/client.js") {
    await sendFile(args.response, path.join(args.assetsRoot, "client.js"), "text/javascript; charset=utf-8", args.request.method);
    return;
  }
  if (url.pathname === "/assets/client.css") {
    await sendFile(args.response, path.join(args.assetsRoot, "client.css"), "text/css; charset=utf-8", args.request.method);
    return;
  }
  if (url.pathname.startsWith("/assets/fonts/")) {
    await sendFontFile(args.response, args.assetsRoot, url, args.request.method);
    return;
  }
  await sendHtml(args.response, args.request.method);
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  workspace: string,
  url: URL,
): Promise<void> {
  switch (url.pathname) {
    case "/api/snapshot":
      sendJson(response, await localRuntimeSnapshot(workspace), 200, request.method);
      return;
    case "/api/spec":
      sendJson(
        response,
        await localSpecDocument(
          workspace,
          readOptionalSearchString(url.searchParams, "fingerprint"),
        ),
        200,
        request.method,
      );
      return;
    case "/api/source/files":
      sendJson(
        response,
        summarizeCandidateFiles(
          await localBenchmarkMountedFiles(
            workspace,
            readOptionalSearchString(url.searchParams, "fingerprint"),
          ),
          [],
        ),
        200,
        request.method,
      );
      return;
    case "/api/source/preview":
      sendJson(
        response,
        createCandidateFilePreview({
          files: await localBenchmarkMountedFiles(
            workspace,
            readOptionalSearchString(url.searchParams, "fingerprint"),
          ),
          path: readSearchString(url.searchParams, "path"),
          view: readPreviewMode(url.searchParams),
        }),
        200,
        request.method,
      );
      return;
    case "/api/record":
      sendJson(response, readCandidateForApi(
        await loadLocalArchive(workspace),
        readSearchString(url.searchParams, "id"),
      ), 200, request.method);
      return;
    case "/api/result":
      sendJson(response, readResultForApi(
        await loadLocalArchive(workspace),
        readSearchString(url.searchParams, "id"),
      ), 200, request.method);
      return;
    case "/api/candidate/files": {
      const snapshot = await loadLocalArchive(workspace);
      const candidateId = readSearchString(url.searchParams, "id");
      const candidate = readCandidateForApi(snapshot, candidateId);
      sendJson(
        response,
        summarizeCandidateFiles(
          readCandidateFilesForApi(snapshot, candidateId),
          candidate.fileChanges,
        ),
        200,
        request.method,
      );
      return;
    }
    case "/api/candidate/preview": {
      const snapshot = await loadLocalArchive(workspace);
      const candidateId = readSearchString(url.searchParams, "id");
      sendJson(
        response,
        createCandidateFilePreview({
          files: readCandidateFilesForApi(snapshot, candidateId),
          path: readSearchString(url.searchParams, "path"),
          view: readPreviewMode(url.searchParams),
        }),
        200,
        request.method,
      );
      return;
    }
    case "/api/task-review": {
      const snapshot = await loadLocalArchive(workspace);
      const candidateId = readSearchString(url.searchParams, "id");
      const caseId = readSearchString(url.searchParams, "task");
      const jobs = await loadLocalJobs(workspace);
      sendJson(
        response,
        createCaseReview({
          candidate: readCandidateForApi(snapshot, candidateId),
          caseId,
          phases: buildCandidateCasePhaseRefs({ jobs, candidateId, caseId }),
        }),
        200,
        request.method,
      );
      return;
    }
    case "/api/run":
      sendJson(
        response,
        await localRunDetail(workspace, readSearchString(url.searchParams, "id")),
        200,
        request.method,
      );
      return;
    case "/api/traces": {
      const traceRunId = readSearchString(url.searchParams, "run");
      const traceJobs = await loadLocalJobs(workspace);
      sendJson(
        response,
        {
          projectId: "local",
          runId: traceRunId,
          phases: buildWorkbenchTracePhases({
            jobs: traceJobs.filter((job) => job.runId === traceRunId),
            traceIdPrefix: "local-phase",
            traceForJob: readLocalTrace,
          }),
        },
        200,
        request.method,
      );
      return;
    }
    case "/api/execution/files": {
      const execRunId = readSearchString(url.searchParams, "run");
      const execJobId = readSearchString(url.searchParams, "id");
      const execFiles = await loadExecutionFiles(workspace, execRunId, execJobId);
      sendJson(response, execFiles, 200, request.method);
      return;
    }
    case "/api/execution/preview": {
      const previewRunId = readSearchString(url.searchParams, "run");
      const previewJobId = readSearchString(url.searchParams, "id");
      const previewFilePath = readSearchString(url.searchParams, "path");
      const previewFiles = await readExecutionFilesForRun(workspace, previewRunId, previewJobId);
      sendJson(
        response,
        createCandidateFilePreview({
          files: previewFiles,
          path: previewFilePath,
          view: readPreviewMode(url.searchParams),
        }),
        200,
        request.method,
      );
      return;
    }
    default:
      throw new LocalApiError(`Unknown Workbench local API route: ${url.pathname}`, 404);
  }
}

export async function localRuntimeSnapshot(workspace: string) {
  const snapshot = await loadLocalArchive(workspace);
  const summaries = snapshot.candidates.map(candidateSummary);
  const activeId = snapshot.activeId;
  const currentBenchmarkFingerprint = await readCurrentBenchmarkFingerprint(workspace);
  return {
    workspaceRoot: path.resolve(workspace),
    activeId,
    currentBenchmarkFingerprint,
    summaries,
    results: snapshot.evaluations.map(resultSummary),
    events: snapshot.events,
    latestRun: snapshot.runs.at(-1) ?? null,
    runs: snapshot.runs,
  };
}

async function readCurrentBenchmarkFingerprint(
  workspace: string,
): Promise<string | null> {
  return await readLocalProjectSource(workspace)
    .then(localBenchmarkFingerprint)
    .catch(() => null);
}

export async function localSpecDocument(
  workspace: string,
  benchmarkFingerprint?: string | null,
) {
  const projectSource = await readLocalProjectSource(workspace).catch(() => null);
  const requestedFingerprint = normalizeOptionalFingerprint(benchmarkFingerprint);
  const currentFingerprint = projectSource
    ? await readCurrentBenchmarkFingerprint(workspace).catch(() => null)
    : null;
  if (
    requestedFingerprint &&
    currentFingerprint &&
    requestedFingerprint !== currentFingerprint
  ) {
    const snapshot = await loadLocalArchive(workspace);
    const document = localHistoricalBenchmarkDocument(snapshot, requestedFingerprint);
    if (document) {
      return document;
    }
    throw new LocalApiError(`Benchmark version not found: ${requestedFingerprint}`, 404);
  }
  const sourceYaml = projectSource?.specSource ?? "";
  const cases = projectSource
    ? await readSpecTaskFiles(workspace, projectSource.spec.tasks.path)
    : [];
  return loadAuthoredWorkbenchSourceDocument({
    sourceYaml,
    path: WORKBENCH_BENCHMARK_FILE,
    sourceFiles: projectSource?.sourceFiles,
    cases,
  });
}

export async function localSourceFiles(workspace: string): Promise<SurfaceSnapshotFile[]> {
  return (await readLocalProjectSource(workspace)).sourceFiles;
}

export async function localBenchmarkMountedFiles(
  workspace: string,
  benchmarkFingerprint?: string | null,
): Promise<SurfaceSnapshotFile[]> {
  const requestedFingerprint = normalizeOptionalFingerprint(benchmarkFingerprint);
  const projectSource = await readLocalProjectSource(workspace);
  const currentFingerprint = await readCurrentBenchmarkFingerprint(workspace).catch(() => null);
  if (
    requestedFingerprint &&
    currentFingerprint &&
    requestedFingerprint !== currentFingerprint
  ) {
    const snapshot = await loadLocalArchive(workspace);
    return localHistoricalBenchmarkFiles(snapshot, requestedFingerprint);
  }
  return mountedTaskFiles(toSurfaceSnapshotFiles(projectSource.caseFiles));
}

function localHistoricalBenchmarkDocument(
  snapshot: LocalArchiveSnapshot,
  benchmarkFingerprint: string,
) {
  const candidate = snapshot.candidates.find((entry) =>
    entry.benchmarkFingerprint === benchmarkFingerprint
  );
  const source = candidate ? readBenchmarkSourceMetadata(candidate) : null;
  if (!source?.sourceYaml) {
    return null;
  }
  return loadAuthoredWorkbenchSourceDocument({
    sourceYaml: source.sourceYaml,
    path: WORKBENCH_BENCHMARK_FILE,
    sourceFiles: source.files,
    cases: localHistoricalBenchmarkFiles(snapshot, benchmarkFingerprint),
  });
}

function localHistoricalBenchmarkFiles(
  _snapshot: LocalArchiveSnapshot,
  _benchmarkFingerprint: string,
): SurfaceSnapshotFile[] {
  return [];
}

function mountedTaskFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  return files
    .filter((file) => !normalizeTaskFilePath(file.path).endsWith("/task.yaml"))
    .map((file) => ({ ...file }));
}

function normalizeTaskFilePath(filePath: string): string {
  return `/${filePath.replace(/\\/gu, "/").replace(/^\/+/u, "")}`;
}

function toSurfaceSnapshotFiles(
  files: readonly WorkspaceSnapshotFile[],
): SurfaceSnapshotFile[] {
  return files.map((file) => ({
    path: file.path,
    kind: "text",
    encoding: file.encoding ?? "utf8",
    content: file.content,
    executable: file.executable ?? false,
  }));
}

async function readSpecTaskFiles(
  workspace: string,
  tasksPath: string,
): Promise<WorkspaceSnapshotFile[]> {
  return await readSnapshotFiles(path.join(workspace, tasksPath)).catch(() => []);
}

function candidateSummary(candidate: CandidateRecord) {
  const { eval: _eval, prompt: _prompt, meta: _meta, ...summary } = candidate;
  return summary;
}

function resultSummary(result: EvaluationResultRecord) {
  const { evaluation: _evaluation, ...summary } = result;
  return summary;
}

function readCandidateForApi(snapshot: LocalArchiveSnapshot, candidateId: string): CandidateRecord {
  return readArchiveRecord("Candidate", candidateId, () => readLocalCandidate(snapshot, candidateId));
}

function readResultForApi(snapshot: LocalArchiveSnapshot, resultId: string): EvaluationResultRecord {
  return readArchiveRecord("Evaluation result", resultId, () => {
    const result = snapshot.evaluations.find((entry) => entry.id === resultId);
    if (!result) {
      throw new Error(`Evaluation result not found: ${resultId}`);
    }
    return result;
  });
}

function readCandidateFilesForApi(snapshot: LocalArchiveSnapshot, candidateId: string): SurfaceSnapshotFile[] {
  return readArchiveRecord("Candidate", candidateId, () => readLocalCandidateFiles(snapshot, candidateId));
}

function readBenchmarkSourceMetadata(candidate: CandidateRecord): {
  sourceYaml: string;
  files: SurfaceSnapshotFile[];
} | null {
  const benchmark = asRecord(asRecord(candidate.meta)?.benchmark);
  const files = Array.isArray(benchmark?.files)
    ? benchmark.files
        .map(readSurfaceSnapshotFile)
        .filter((file): file is SurfaceSnapshotFile => file !== null)
    : [];
  const sourceYaml = files.find((file) => file.path === WORKBENCH_BENCHMARK_FILE)?.content ?? null;
  if (!sourceYaml) {
    return null;
  }
  return { sourceYaml, files };
}

function readSurfaceSnapshotFile(value: unknown): SurfaceSnapshotFile | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const filePath = typeof record?.path === "string" ? record.path : "";
  const content = typeof record?.content === "string" ? record.content : null;
  if (!filePath || content === null) {
    return null;
  }
  return {
    path: filePath,
    kind: record.kind === "binary" ? "binary" : "text",
    encoding: record.encoding === "base64" ? "base64" : "utf8",
    content,
    executable: record.executable === true,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeOptionalFingerprint(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readArchiveRecord<T>(
  kind: "Candidate" | "Evaluation result",
  id: string,
  read: () => T,
): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof Error && error.message === `${kind} not found: ${id}`) {
      throw new LocalApiError(error.message, 404);
    }
    throw error;
  }
}

async function localRunDetail(workspace: string, runId: string): Promise<{
  run: RunSummary;
  jobs: unknown[];
}> {
  const snapshot = await loadLocalArchive(workspace);
  const run = snapshot.runs.find((entry) => entry.id === runId);
  if (!run) {
    throw new LocalApiError(`Run not found: ${runId}`, 404);
  }
  const allJobs = await loadLocalJobs(workspace);
  const runJobs = allJobs.filter((job) => job.runId === runId);
  return { run, jobs: runJobs };
}

async function loadExecutionFiles(workspace: string, runId: string, jobId: string) {
  const files = await readExecutionFilesForRun(workspace, runId, jobId);
  return summarizeCandidateFiles(files);
}

async function readExecutionFilesForRun(
  workspace: string,
  runId: string,
  jobId: string,
) {
  await assertExecutionJobInRun(workspace, runId, jobId);
  return await readLocalExecutionFiles(workspace, jobId);
}

async function assertExecutionJobInRun(
  workspace: string,
  runId: string,
  jobId: string,
) {
  const job = (await loadLocalJobs(workspace)).find((entry) => entry.id === jobId);
  if (!job || job.runId !== runId) {
    throw new LocalApiError(`Execution job not found: ${jobId}`, 404);
  }
}

type LocalJob = HostedWorkbenchJob & { trace?: WorkbenchExecutionTrace };

async function loadLocalJobs(workspace: string): Promise<LocalJob[]> {
  const jobsDir = path.join(localRuntimeDir(workspace), "jobs");
  const entries = await fs.readdir(jobsDir, { withFileTypes: true }).catch(() => []);
  const jobs: LocalJob[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      const content = await fs.readFile(path.join(jobsDir, entry.name), "utf8");
      jobs.push(JSON.parse(content) as LocalJob);
    }
  }
  return jobs;
}

function readLocalTrace(job: LocalJob): WorkbenchExecutionTrace {
  const trace = (job as unknown as Record<string, unknown>).trace;
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
    return { trace_id: job.id, spans: [], events: [], summaries: [] };
  }
  const record = trace as Partial<WorkbenchExecutionTrace>;
  return {
    trace_id: typeof record.trace_id === "string" ? record.trace_id : job.id,
    spans: Array.isArray(record.spans) ? record.spans : [],
    events: Array.isArray(record.events) ? record.events : [],
    summaries: Array.isArray(record.summaries) ? record.summaries : [],
  };
}

function readSearchString(params: URLSearchParams, key: string): string {
  const value = params.get(key);
  if (!value) {
    throw new LocalApiError(`${key} is required.`);
  }
  return value;
}

function readOptionalSearchString(params: URLSearchParams, key: string): string | null {
  const value = params.get(key)?.trim();
  return value ? value : null;
}

function readPreviewMode(params: URLSearchParams): "diff" | "raw" | "rendered" {
  const view = params.get("view") ?? "rendered";
  if (view === "diff" || view === "raw" || view === "rendered") {
    return view;
  }
  throw new LocalApiError("view must be diff, raw, or rendered.");
}

async function sendFile(
  response: ServerResponse,
  filePath: string,
  contentType: string,
  method = "GET",
): Promise<void> {
  const body = await fs.readFile(filePath);
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": body.byteLength,
    "cache-control": "no-store",
  });
  response.end(method === "HEAD" ? undefined : body);
}

async function sendFontFile(
  response: ServerResponse,
  assetsRoot: string,
  url: URL,
  method = "GET",
): Promise<void> {
  let fileName: string;
  try {
    fileName = decodeURIComponent(url.pathname.slice("/assets/fonts/".length));
  } catch {
    throw new LocalApiError("Invalid font asset path.", 404);
  }
  if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
    throw new LocalApiError("Invalid font asset path.", 404);
  }
  await sendFile(response, path.join(assetsRoot, "fonts", fileName), "font/woff2", method);
}

async function sendHtml(response: ServerResponse, method = "GET"): Promise<void> {
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Workbench Local</title>
    <link rel="stylesheet" href="/assets/client.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/client.js"></script>
  </body>
</html>`;
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(method === "HEAD" ? undefined : body);
}

function sendJson(
  response: ServerResponse,
  value: unknown,
  status = 200,
  method = "GET",
): void {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(method === "HEAD" ? undefined : body);
}

function sendError(response: ServerResponse, error: unknown, method = "GET"): void {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof LocalApiError ? error.status : 500;
  sendJson(response, { message }, status, method);
}

function displayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
