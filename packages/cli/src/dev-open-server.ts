import { promises as fs } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSubjectCaseExecutionRefs,
  buildWorkbenchExecutionEvidence,
  createSubjectFilePreview,
  createCaseReview,
  loadAuthoredWorkbenchSourceDocument,
  summarizeSubjectFiles,
  traceSessionLabel,
  type SubjectRecord,
  type EvaluationScorecard,
  type SurfaceSnapshotFile,
  type WorkbenchExecutionTrace,
  type WorkbenchTraceSession,
  type WorkbenchEngineCase,
} from "@workbench-ai/workbench-core";

import {
  readLocalExecutionFiles,
  loadLocalArchiveIndex,
  readLocalEvaluationRecord,
  readLocalJobInRun,
  readLocalRunJobs,
  readLocalSubjectFilesForId,
  readLocalSubjectRecord,
  type LocalArchivedJob,
  type LocalArchiveIndex,
} from "./local-archive.js";
import {
  readLocalAuthoredProjectSource,
  readLocalProjectSource,
  type LocalProjectSource,
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

interface LocalCaseInputFile {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
  executable?: boolean;
}

export interface LocalWorkbenchRequestContext {
  workspace: string;
  assetsRoot: string;
  readProjectSource: () => Promise<LocalProjectSource>;
}

const DEV_OPEN_ASSET_DIR = "dev-open";
const PROJECT_SOURCE_CACHE_TTL_MS = 1000;

export async function startLocalWorkbenchDevServer(
  options: LocalWorkbenchDevServerOptions,
): Promise<LocalWorkbenchDevServer> {
  const workspace = path.resolve(options.workspace);
  const assetsRoot = options.assetsRoot ?? defaultDevOpenAssetsRoot();
  await assertDevOpenAssets(assetsRoot);
  const context: LocalWorkbenchRequestContext = {
    workspace,
    assetsRoot,
    readProjectSource: createProjectSourceReader(workspace),
  };

  const server = http.createServer((request, response) => {
    void handleLocalWorkbenchRequest({
      request,
      response,
      context,
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

function createProjectSourceReader(workspace: string): () => Promise<LocalProjectSource> {
  let cached: { loadedAt: number; promise: Promise<LocalProjectSource> } | null = null;
  return () => {
    const now = Date.now();
    if (cached && now - cached.loadedAt < PROJECT_SOURCE_CACHE_TTL_MS) {
      return cached.promise;
    }
    const promise = readLocalProjectSource(workspace);
    cached = { loadedAt: now, promise };
    promise.catch(() => {
      if (cached?.promise === promise) {
        cached = null;
      }
    });
    return promise;
  };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function handleLocalWorkbenchRequest(args: {
  request: IncomingMessage;
  response: ServerResponse;
  context: LocalWorkbenchRequestContext;
}): Promise<void> {
  const url = new URL(args.request.url ?? "/", "http://workbench.local");
  if (args.request.method !== "GET" && args.request.method !== "HEAD") {
    sendJson(args.response, { message: "Workbench local open is read-only." }, 405, args.request.method);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    await handleApiRequest(args.request, args.response, args.context, url);
    return;
  }
  if (url.pathname === "/assets/client.js") {
    await sendFile(args.response, path.join(args.context.assetsRoot, "client.js"), "text/javascript; charset=utf-8", args.request.method);
    return;
  }
  if (url.pathname === "/assets/client.css") {
    await sendFile(args.response, path.join(args.context.assetsRoot, "client.css"), "text/css; charset=utf-8", args.request.method);
    return;
  }
  if (url.pathname.startsWith("/assets/fonts/")) {
    await sendFontFile(args.response, args.context.assetsRoot, url, args.request.method);
    return;
  }
  await sendHtml(args.response, args.request.method);
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: LocalWorkbenchRequestContext,
  url: URL,
): Promise<void> {
  const { workspace } = context;
  switch (url.pathname) {
    case "/api/snapshot":
      sendJson(response, await localBenchmarkSnapshot(context), 200, request.method);
      return;
    case "/api/spec":
      sendJson(
        response,
        await localSpecDocument(
          context,
          readOptionalSearchString(url.searchParams, "fingerprint"),
        ),
        200,
        request.method,
      );
      return;
    case "/api/source/files":
      sendJson(
        response,
        summarizeSubjectFiles(
          await localBenchmarkMountedFiles(
            context,
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
        createSubjectFilePreview({
          files: await localBenchmarkMountedFiles(
            context,
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
      sendJson(response, await readSubjectForApi(
        workspace,
        readSearchString(url.searchParams, "id"),
      ), 200, request.method);
      return;
    case "/api/evaluation":
      sendJson(response, await readEvaluationForApi(
        workspace,
        readSearchString(url.searchParams, "id"),
      ), 200, request.method);
      return;
    case "/api/subject/files": {
      const subjectId = readSearchString(url.searchParams, "id");
      const subject = await readSubjectForApi(workspace, subjectId);
      sendJson(
        response,
        summarizeSubjectFiles(
          await readSubjectFilesForApi(workspace, subjectId),
          subject.fileChanges,
        ),
        200,
        request.method,
      );
      return;
    }
    case "/api/subject/preview": {
      const subjectId = readSearchString(url.searchParams, "id");
      sendJson(
        response,
        createSubjectFilePreview({
          files: await readSubjectFilesForApi(workspace, subjectId),
          path: readSearchString(url.searchParams, "path"),
          view: readPreviewMode(url.searchParams),
        }),
        200,
        request.method,
      );
      return;
    }
    case "/api/case-review": {
      const subjectId = readSearchString(url.searchParams, "id");
      const caseId = readSearchString(url.searchParams, "case");
      const runId = readSearchString(url.searchParams, "run");
      const jobs = await readLocalRunJobs(workspace, runId);
      sendJson(
        response,
        createCaseReview({
          subject: await readSubjectForApi(workspace, subjectId),
          caseId,
          executions: buildSubjectCaseExecutionRefs({ jobs, subjectId, caseId }),
        }),
        200,
        request.method,
      );
      return;
    }
    case "/api/traces": {
      const traceRunId = readSearchString(url.searchParams, "run");
      const traceJobId = readSearchString(url.searchParams, "job");
      const traceJobs = [await readExecutionJobForRun(workspace, traceRunId, traceJobId)];
      sendJson(
        response,
        {
          projectId: "local",
          runId: traceRunId,
          executions: buildWorkbenchExecutionEvidence({
            jobs: traceJobs,
            traceIdPrefix: "local-execution",
            traceForJob: readLocalAggregateTrace,
            traceSessionsForJob: readLocalTraceSessions,
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
        createSubjectFilePreview({
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

export async function localBenchmarkSnapshot(context: LocalWorkbenchRequestContext) {
  const { workspace } = context;
  const snapshot = await loadLocalArchiveIndex(workspace);
  const subjects = snapshot.subjects.filter(isInspectableSubjectRecord);
  const summaries = subjects.map(subjectSummary);
  const activeId = snapshot.activeId && subjects.some((subject) => subject.id === snapshot.activeId)
    ? snapshot.activeId
    : subjects.at(-1)?.id ?? null;
  const currentBenchmarkFingerprint = await readCurrentBenchmarkFingerprint(context);
  return {
    workspaceRoot: path.resolve(workspace),
    activeId,
    currentBenchmarkFingerprint,
    summaries,
    evaluations: snapshot.evaluations.map(evaluationSummary),
    runs: snapshot.runs,
  };
}

async function readCurrentBenchmarkFingerprint(
  context: LocalWorkbenchRequestContext,
): Promise<string | null> {
  return await context.readProjectSource()
    .then(localBenchmarkFingerprint)
    .catch(() => null);
}

export async function localSpecDocument(
  context: LocalWorkbenchRequestContext,
  benchmarkFingerprint?: string | null,
) {
  const { workspace } = context;
  const projectSource = await context.readProjectSource().catch(() => null);
  const authoredSource = projectSource
    ? null
    : await readLocalAuthoredProjectSource(workspace).catch(() => null);
  const requestedFingerprint = normalizeOptionalFingerprint(benchmarkFingerprint);
  const currentFingerprint = projectSource
    ? localBenchmarkFingerprint(projectSource)
    : null;
  if (
    requestedFingerprint &&
    currentFingerprint &&
    requestedFingerprint !== currentFingerprint
  ) {
    const snapshot = await loadLocalArchiveIndex(workspace);
    const document = localHistoricalBenchmarkDocument(snapshot, requestedFingerprint);
    if (document) {
      return document;
    }
    throw new LocalApiError(`Benchmark version not found: ${requestedFingerprint}`, 404);
  }
  const sourceYaml = projectSource?.specSource ?? authoredSource?.specSource ?? "";
  const cases = projectSource
    ? caseSummaryFilesFromEngineCases(projectSource.engineCases, projectSource.engineResolveFiles)
    : [];
  return loadAuthoredWorkbenchSourceDocument({
    sourceYaml,
    path: WORKBENCH_BENCHMARK_FILE,
    sourceFiles: projectSource?.sourceFiles ?? authoredSource?.sourceFiles,
    cases,
  });
}

function caseSummaryFilesFromEngineCases(
  engineCases: readonly WorkbenchEngineCase[],
  files: readonly LocalCaseInputFile[],
): LocalCaseInputFile[] {
  const existingCaseIds = new Set(files.flatMap((file) => {
    const normalized = file.path.replace(/\\/gu, "/").replace(/^\/+/u, "");
    const slash = normalized.indexOf("/");
    return slash > 0 ? [normalized.slice(0, slash)] : [];
  }));
  return [
    ...files.map((file) => ({ ...file })),
    ...engineCases
      .filter((engineCase) => !existingCaseIds.has(engineCase.id))
      .map((engineCase) => ({
        path: `${engineCase.id}/.workbench-case.json`,
        encoding: "utf8" as const,
        content: `${JSON.stringify({ id: engineCase.id })}\n`,
        executable: false,
      })),
  ];
}

export async function localSourceFiles(workspace: string): Promise<SurfaceSnapshotFile[]> {
  return (await readLocalProjectSource(workspace)).sourceFiles;
}

export async function localBenchmarkMountedFiles(
  context: LocalWorkbenchRequestContext,
  benchmarkFingerprint?: string | null,
): Promise<SurfaceSnapshotFile[]> {
  const requestedFingerprint = normalizeOptionalFingerprint(benchmarkFingerprint);
  const { workspace } = context;
  const projectSource = await context.readProjectSource();
  const currentFingerprint = localBenchmarkFingerprint(projectSource);
  if (
    requestedFingerprint &&
    currentFingerprint &&
    requestedFingerprint !== currentFingerprint
  ) {
    const snapshot = await loadLocalArchiveIndex(workspace);
    return localHistoricalBenchmarkFiles(snapshot, requestedFingerprint);
  }
  return inspectableEngineCaseFiles(projectSource.engineCases);
}

function localHistoricalBenchmarkDocument(
  snapshot: LocalArchiveIndex,
  benchmarkFingerprint: string,
) {
  const subject = snapshot.subjects.find((entry) =>
    entry.benchmarkFingerprint === benchmarkFingerprint && readBenchmarkSourceMetadata(entry)
  );
  const source = subject ? readBenchmarkSourceMetadata(subject) : null;
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
  _snapshot: LocalArchiveIndex,
  _benchmarkFingerprint: string,
): SurfaceSnapshotFile[] {
  return [];
}

function inspectableEngineCaseFiles(engineCases: readonly WorkbenchEngineCase[]): SurfaceSnapshotFile[] {
  return engineCases.flatMap((bundle) =>
    engineCaseFiles(bundle).map((file) => ({
      ...file,
      path: `${bundle.id}/${file.path}`,
    }))
  ).sort((left, right) => left.path.localeCompare(right.path));
}

function engineCaseFiles(bundle: WorkbenchEngineCase): SurfaceSnapshotFile[] {
  const buckets = bundle.files;
  return buckets.source?.length
    ? buckets.source
    : [...(buckets.public ?? []), ...(buckets.private ?? [])];
}

function subjectSummary(subject: SubjectRecord) {
  const { eval: _eval, prompt: _prompt, meta: _meta, ...summary } = subject;
  return summary;
}

function isInspectableSubjectRecord(subject: SubjectRecord): boolean {
  return Boolean(subject.eval || asRecord(asRecord(subject.meta)?.source));
}

function evaluationSummary(evaluation: EvaluationScorecard) {
  const { evaluation: _evaluation, ...summary } = evaluation;
  return summary;
}

async function readSubjectForApi(workspace: string, subjectId: string): Promise<SubjectRecord> {
  return await readArchiveRecord("Subject", subjectId, () => readLocalSubjectRecord(workspace, subjectId));
}

async function readEvaluationForApi(workspace: string, evaluationId: string): Promise<EvaluationScorecard> {
  return await readArchiveRecord("Evaluation", evaluationId, () => readLocalEvaluationRecord(workspace, evaluationId));
}

async function readSubjectFilesForApi(workspace: string, subjectId: string): Promise<SurfaceSnapshotFile[]> {
  return await readArchiveRecord("Subject", subjectId, () => readLocalSubjectFilesForId(workspace, subjectId));
}

function readBenchmarkSourceMetadata(subject: SubjectRecord): {
  sourceYaml: string;
  files: SurfaceSnapshotFile[];
} | null {
  const benchmark = asRecord(asRecord(subject.meta)?.benchmark);
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

async function readArchiveRecord<T>(
  kind: "Subject" | "Evaluation",
  id: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof Error && error.message === `${kind} not found: ${id}`) {
      throw new LocalApiError(error.message, 404);
    }
    throw error;
  }
}

async function loadExecutionFiles(workspace: string, runId: string, jobId: string) {
  const files = await readExecutionFilesForRun(workspace, runId, jobId);
  return summarizeSubjectFiles(files);
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
  await readExecutionJobForRun(workspace, runId, jobId);
}

async function readExecutionJobForRun(
  workspace: string,
  runId: string,
  jobId: string,
): Promise<LocalArchivedJob> {
  const job = await readLocalJobInRun(workspace, runId, jobId);
  if (!job) {
    throw new LocalApiError(`Execution job not found: ${jobId}`, 404);
  }
  return job;
}

function readLocalAggregateTrace(job: LocalArchivedJob): WorkbenchExecutionTrace {
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

function readLocalTraceSessions(
  job: LocalArchivedJob,
  role: WorkbenchTraceSession["role"],
): WorkbenchTraceSession[] {
  if (!Array.isArray(job.traceSessions)) {
    return [];
  }
  return job.traceSessions.map((session) => ({
    id: typeof session.id === "string" && session.id.length > 0
      ? session.id
      : `${job.id}:trace`,
    jobId: typeof session.jobId === "string" && session.jobId.length > 0
      ? session.jobId
      : job.id,
    role: session.role === "optimizer" || session.role === "runner" || session.role === "engine"
      ? session.role
      : role,
    kind: typeof session.kind === "string" && session.kind.length > 0 ? session.kind : "trace",
    label: traceSessionDisplayLabel(session, role),
    sourcePath: typeof session.sourcePath === "string" ? session.sourcePath : null,
    trace: sanitizeLocalTrace(session.trace, session.id),
    ...(session.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
      ? { metadata: session.metadata }
      : {}),
  }));
}

function traceSessionDisplayLabel(
  session: WorkbenchTraceSession,
  fallbackRole: WorkbenchTraceSession["role"],
): string {
  const role = session.role === "optimizer" || session.role === "runner" || session.role === "engine"
    ? session.role
    : fallbackRole;
  return typeof session.label === "string" && session.label.length > 0
    ? session.label
    : typeof session.sourcePath === "string" && session.sourcePath.length > 0
      ? traceSessionLabel(session.sourcePath, role)
      : "Trace";
}

function sanitizeLocalTrace(
  trace: unknown,
  fallbackId: string,
): WorkbenchExecutionTrace {
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
    return { trace_id: fallbackId, spans: [], events: [], summaries: [] };
  }
  const record = trace as Partial<WorkbenchExecutionTrace>;
  return {
    trace_id: typeof record.trace_id === "string" ? record.trace_id : fallbackId,
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
