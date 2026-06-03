import path from "node:path";

import {
  WorkbenchInspectionError,
  candidateRecordWithoutDerivedFields,
  candidateSummaryFromRecord,
  createCandidateFilePreview,
  createWorkbenchInspection,
  loadAuthoredWorkbenchSourceDocument,
  selectedFilePath,
  summarizeCandidateFiles,
  traceSessionLabel,
  type CandidateRecord,
  type EvaluationScorecard,
  type RunSummary,
  type SurfaceSnapshotFile,
  type WorkbenchEngineCase,
  type WorkbenchExecutionTrace,
  type WorkbenchInspection,
  type WorkbenchInspectionBackend,
  type WorkbenchInspectionFileSurface,
  type WorkbenchTraceSession,
} from "@workbench-ai/workbench-core";

import { localBenchmarkFingerprint } from "./benchmark-fingerprint.js";
import {
  loadLocalArchiveIndex,
  readLocalCandidateFilesForId,
  readLocalCandidateRecord,
  readLocalEvaluationRecord,
  readLocalExecutionFiles,
  readLocalJobInRun,
  readLocalRunJobs,
  readLocalRunRecord,
  type LocalArchivedJob,
  type LocalArchiveIndex,
} from "./local-archive.js";
import {
  readLocalAuthoredProjectSource,
  readLocalProjectSource,
  type LocalProjectSource,
  WORKBENCH_BENCHMARK_FILE,
} from "./project-source.js";

const PROJECT_SOURCE_CACHE_TTL_MS = 1000;

interface LocalCaseInputFile {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
  executable?: boolean;
}

interface LocalWorkbenchInspectionContext {
  workspace: string;
  readProjectSource: () => Promise<LocalProjectSource>;
}

export interface LocalWorkbenchInspectionOptions {
  workspace: string;
  readProjectSource?: () => Promise<LocalProjectSource>;
}

export function createLocalWorkbenchInspection(
  options: LocalWorkbenchInspectionOptions,
): WorkbenchInspection {
  const context: LocalWorkbenchInspectionContext = {
    workspace: path.resolve(options.workspace),
    readProjectSource: options.readProjectSource ??
      createLocalProjectSourceReader(options.workspace),
  };
  const backend: WorkbenchInspectionBackend = {
    projectId: "local",
    snapshot: () => localBenchmarkSnapshot(context),
    spec: (input) => localSpecDocument(context, input.fingerprint),
    sourceFiles: async (input) => {
      const files = await localBenchmarkMountedFiles(context, input.fingerprint);
      return summarizeCandidateFiles(files, files.map((file) => file.path));
    },
    sourceFileSurface: async (input) => {
      const files = await localBenchmarkMountedFiles(context, input.fingerprint);
      return localFileSurface(files, files.map((file) => file.path), input.path, input.view);
    },
    candidate: (input) => readCandidateForInspection(context.workspace, input.id),
    candidateFiles: async (input) => {
      const candidate = await readCandidateForInspection(context.workspace, input.id);
      return summarizeCandidateFiles(
        await readCandidateFilesForInspection(context.workspace, input.id),
        candidate.fileChanges,
      );
    },
    candidateFileSurface: async (input) => {
      const candidate = await readCandidateForInspection(context.workspace, input.id);
      return localFileSurface(
        await readCandidateFilesForInspection(context.workspace, input.id),
        candidate.fileChanges,
        input.path,
        input.view,
      );
    },
    evaluation: (input) => readEvaluationForInspection(context.workspace, input.id),
    run: async (input) => {
      const run = await readRunForInspection(context.workspace, input.id);
      return {
        run,
        ...(input.includeJobs
          ? { jobs: await readLocalRunJobs(context.workspace, input.id) }
          : {}),
      };
    },
    jobInRun: (input) =>
      readExecutionJobForRun(context.workspace, input.runId, input.jobId),
    executionFiles: async (input) => {
      const files = await readExecutionFilesForRun(context.workspace, input.runId, input.jobId);
      return summarizeCandidateFiles(files, files.map((file) => file.path));
    },
    executionFileSurface: async (input) => {
      const files = await readExecutionFilesForRun(context.workspace, input.runId, input.jobId);
      return localFileSurface(files, files.map((file) => file.path), input.path, input.view);
    },
    traceForJob: readLocalAggregateTrace,
    traceSessionsForJob: readLocalTraceSessions,
  };
  return createWorkbenchInspection(backend);
}

function localFileSurface(
  files: readonly SurfaceSnapshotFile[],
  changedPaths: readonly string[],
  path: string | null | undefined,
  view: "diff" | "raw" | "rendered" = "rendered",
): WorkbenchInspectionFileSurface {
  const summaries = summarizeCandidateFiles(files, changedPaths);
  const previewPath = selectedFilePath(path, summaries);
  return {
    files: summaries,
    preview: previewPath
      ? createCandidateFilePreview({ files, path: previewPath, view })
      : null,
  };
}

export function createLocalProjectSourceReader(
  workspace: string,
): () => Promise<LocalProjectSource> {
  const resolvedWorkspace = path.resolve(workspace);
  let cached: { loadedAt: number; promise: Promise<LocalProjectSource> } | null = null;
  return () => {
    const now = Date.now();
    if (cached && now - cached.loadedAt < PROJECT_SOURCE_CACHE_TTL_MS) {
      return cached.promise;
    }
    const promise = readLocalProjectSource(resolvedWorkspace);
    cached = { loadedAt: now, promise };
    promise.catch(() => {
      if (cached?.promise === promise) {
        cached = null;
      }
    });
    return promise;
  };
}

async function localBenchmarkSnapshot(
  context: LocalWorkbenchInspectionContext,
) {
  const { workspace } = context;
  const snapshot = await loadLocalArchiveIndex(workspace);
  const candidates = snapshot.candidates.filter(isInspectableCandidateRecord);
  const summaries = candidates.map(candidateSummaryFromRecord);
  const activeId = snapshot.activeId && candidates.some((candidate) => candidate.id === snapshot.activeId)
    ? snapshot.activeId
    : null;
  const currentBenchmarkFingerprint = await readCurrentBenchmarkFingerprint(context);
  return {
    workspaceRoot: path.resolve(workspace),
    activeId,
    currentBenchmarkFingerprint,
    summaries,
    evaluations: snapshot.evaluations.map(evaluationSummary),
    runs: snapshot.runs.map(publicLocalRunSummary),
  };
}

async function localSpecDocument(
  context: LocalWorkbenchInspectionContext,
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
    const source = localHistoricalBenchmarkSource(snapshot, requestedFingerprint);
    if (source) {
      return loadAuthoredWorkbenchSourceDocument({
        sourceYaml: source.sourceYaml,
        path: WORKBENCH_BENCHMARK_FILE,
        sourceFiles: [{
          path: WORKBENCH_BENCHMARK_FILE,
          kind: "text",
          encoding: "utf8",
          content: source.sourceYaml,
          executable: false,
        }],
        cases: source.engineResolveFiles,
      });
    }
    throw new WorkbenchInspectionError(`Benchmark version not found: ${requestedFingerprint}`, { status: 404 });
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

async function localBenchmarkMountedFiles(
  context: LocalWorkbenchInspectionContext,
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
    const source = localHistoricalBenchmarkSource(snapshot, requestedFingerprint);
    if (source) {
      return source.engineResolveFiles.map((file) => ({ ...file }));
    }
    throw new WorkbenchInspectionError(`Benchmark version not found: ${requestedFingerprint}`, { status: 404 });
  }
  return inspectableEngineCaseFiles(projectSource.engineCases);
}

function publicLocalRunSummary(run: RunSummary): RunSummary {
  const {
    executionFingerprint: _executionFingerprint,
    input: _input,
    ...summary
  } = run as RunSummary & { input?: unknown };
  return summary;
}

async function readCurrentBenchmarkFingerprint(
  context: LocalWorkbenchInspectionContext,
): Promise<string | null> {
  return await context.readProjectSource()
    .then(localBenchmarkFingerprint)
    .catch(() => null);
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

function localHistoricalBenchmarkSource(
  snapshot: LocalArchiveIndex,
  benchmarkFingerprint: string,
): { sourceYaml: string; engineResolveFiles: SurfaceSnapshotFile[] } | null {
  for (const run of snapshot.runs) {
    if (run.benchmarkFingerprint !== benchmarkFingerprint) {
      continue;
    }
    const source = readRunSourceInput(run);
    if (source) {
      return source;
    }
  }
  return null;
}

function inspectableEngineCaseFiles(
  engineCases: readonly WorkbenchEngineCase[],
): SurfaceSnapshotFile[] {
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

function isInspectableCandidateRecord(candidate: CandidateRecord): boolean {
  return Boolean(candidate.eval || asRecord(asRecord(candidate.meta)?.source));
}

function evaluationSummary(evaluation: EvaluationScorecard) {
  const { evaluation: _evaluation, ...summary } = evaluation;
  return summary;
}

async function readCandidateForInspection(
  workspace: string,
  candidateId: string,
): Promise<CandidateRecord> {
  const candidate = await readArchiveRecord(
    "Candidate",
    candidateId,
    () => readLocalCandidateRecord(workspace, candidateId),
  );
  return candidateRecordWithoutDerivedFields(candidate);
}

async function readEvaluationForInspection(
  workspace: string,
  evaluationId: string,
): Promise<EvaluationScorecard> {
  return await readArchiveRecord(
    "Evaluation",
    evaluationId,
    () => readLocalEvaluationRecord(workspace, evaluationId),
  );
}

async function readRunForInspection(
  workspace: string,
  runId: string,
): Promise<RunSummary> {
  return await readArchiveRecord(
    "Run",
    runId,
    () => readLocalRunRecord(workspace, runId),
  );
}

async function readCandidateFilesForInspection(
  workspace: string,
  candidateId: string,
): Promise<SurfaceSnapshotFile[]> {
  return await readArchiveRecord(
    "Candidate",
    candidateId,
    () => readLocalCandidateFilesForId(workspace, candidateId),
  );
}

function readRunSourceInput(run: RunSummary): {
  sourceYaml: string;
  engineResolveFiles: SurfaceSnapshotFile[];
} | null {
  const input = asRecord((run as RunSummary & { input?: unknown }).input);
  const sourceYaml = typeof input?.sourceYaml === "string" ? input.sourceYaml : null;
  if (!input || !sourceYaml) {
    return null;
  }
  const engineResolveFiles = Array.isArray(input.engineResolveFiles)
    ? input.engineResolveFiles
        .map(readSurfaceSnapshotFile)
        .filter((file): file is SurfaceSnapshotFile => file !== null)
        .sort((left, right) => left.path.localeCompare(right.path))
    : [];
  return { sourceYaml, engineResolveFiles };
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

async function readArchiveRecord<T>(
  kind: "Candidate" | "Evaluation" | "Run",
  id: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof Error && error.message === `${kind} not found: ${id}`) {
      throw new WorkbenchInspectionError(error.message, { status: 404 });
    }
    throw error;
  }
}

async function readExecutionFilesForRun(
  workspace: string,
  runId: string,
  jobId: string,
) {
  await readExecutionJobForRun(workspace, runId, jobId);
  return await readLocalExecutionFiles(workspace, jobId);
}

async function readExecutionJobForRun(
  workspace: string,
  runId: string,
  jobId: string,
): Promise<LocalArchivedJob> {
  const job = await readLocalJobInRun(workspace, runId, jobId);
  if (!job) {
    throw new WorkbenchInspectionError(`Execution job not found: ${jobId}`, { status: 404 });
  }
  return job;
}

function readLocalAggregateTrace(
  job: LocalArchivedJob,
): WorkbenchExecutionTrace {
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
  return job.traceSessions.map((session: WorkbenchTraceSession) => ({
    id: typeof session.id === "string" && session.id.length > 0
      ? session.id
      : `${job.id}:trace`,
    jobId: typeof session.jobId === "string" && session.jobId.length > 0
      ? session.jobId
      : job.id,
    role: session.role === "improver" || session.role === "runner" || session.role === "engine"
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
  const role = session.role === "improver" || session.role === "runner" || session.role === "engine"
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeOptionalFingerprint(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
