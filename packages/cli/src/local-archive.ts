import { promises as fs } from "node:fs";
import path from "node:path";

import {
  buildWorkbenchTraceSessionsFromFiles,
  selectExecutionOutputFilesForInspection,
  type SubjectRecord,
  type EvaluationScorecard,
  type HostedWorkbenchJob,
  type RunSummary,
  type RuntimeEvent,
  type Json,
  type SurfaceSnapshotFile,
  type WorkbenchExecutionTrace,
  type WorkbenchTraceSession,
} from "@workbench-ai/workbench-core";

type WorkbenchTraceSpan = WorkbenchExecutionTrace["spans"][number];
type WorkbenchTraceEvent = WorkbenchExecutionTrace["events"][number];
type WorkbenchTraceSummary = WorkbenchExecutionTrace["summaries"][number];
type WorkbenchTraceUsageSummary = NonNullable<WorkbenchTraceSummary["usage"]>;

export interface LocalArchiveSnapshot {
  activeId: string | null;
  subjects: SubjectRecord[];
  subjectFiles: Record<string, SurfaceSnapshotFile[]>;
  evaluations: EvaluationScorecard[];
  runs: RunSummary[];
  events: RuntimeEvent[];
}

export interface LocalArchiveIndex {
  activeId: string | null;
  subjects: SubjectRecord[];
  evaluations: EvaluationScorecard[];
  runs: RunSummary[];
  events: RuntimeEvent[];
}

export type LocalArchivedJob = HostedWorkbenchJob & {
  trace?: WorkbenchExecutionTrace;
  traceSessions?: WorkbenchTraceSession[];
};

interface LocalArchiveStateFile {
  activeId?: string | null;
}

const RUNTIME_DIR = ".workbench/runtime";

export function localRuntimeDir(workspace: string): string {
  return path.join(workspace, RUNTIME_DIR);
}

export async function loadLocalArchive(workspace: string): Promise<LocalArchiveSnapshot> {
  const index = await loadLocalArchiveIndex(workspace);
  const root = localRuntimeDir(workspace);
  const subjectFiles: Record<string, SurfaceSnapshotFile[]> = {};
  await Promise.all(index.subjects.map(async (subject) => {
    subjectFiles[subject.id] = await readSurfaceFiles(path.join(root, "subjects", localRecordName(subject.id), "files"));
  }));
  const snapshot: LocalArchiveSnapshot = {
    ...index,
    subjectFiles,
  };
  validateLocalArchiveSnapshot(snapshot);
  return snapshot;
}

export async function loadLocalArchiveIndex(workspace: string): Promise<LocalArchiveIndex> {
  const root = localRuntimeDir(workspace);
  const [state, subjects, evaluations, runs, events] = await Promise.all([
    readJson<LocalArchiveStateFile>(path.join(root, "state.json"), {}),
    readRecords<SubjectRecord>(path.join(root, "subjects"), "record.json"),
    readFlatRecords<EvaluationScorecard>(path.join(root, "evaluations")),
    readFlatRecords<RunSummary>(path.join(root, "runs")),
    readJson<RuntimeEvent[]>(path.join(root, "events.json"), []),
  ]);
  const index: LocalArchiveIndex = {
    activeId: typeof state.activeId === "string" ? state.activeId : null,
    subjects: subjects.sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id)),
    evaluations: evaluations.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
    runs: runs.sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id)),
    events: events.sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id)),
  };
  validateLocalArchiveIndex(index);
  return index;
}

export async function saveLocalArchive(
  workspace: string,
  snapshot: LocalArchiveSnapshot,
): Promise<void> {
  const root = localRuntimeDir(workspace);
  await fs.mkdir(root, { recursive: true });
  await writeJson(path.join(root, "state.json"), { activeId: snapshot.activeId });
  await fs.rm(path.join(root, "subjects"), { force: true, recursive: true });
  await fs.rm(path.join(root, "evaluations"), { force: true, recursive: true });
  await fs.rm(path.join(root, "runs"), { force: true, recursive: true });
  await Promise.all([
    fs.mkdir(path.join(root, "subjects"), { recursive: true }),
    fs.mkdir(path.join(root, "evaluations"), { recursive: true }),
    fs.mkdir(path.join(root, "runs"), { recursive: true }),
  ]);
  for (const subject of snapshot.subjects) {
    const subjectRoot = path.join(root, "subjects", subject.id);
    await fs.mkdir(subjectRoot, { recursive: true });
    await writeJson(path.join(subjectRoot, "record.json"), subject);
    await writeSurfaceFiles(path.join(subjectRoot, "files"), snapshot.subjectFiles[subject.id] ?? []);
  }
  for (const evaluation of snapshot.evaluations) {
    await writeJson(path.join(root, "evaluations", `${evaluation.id}.json`), evaluation);
  }
  for (const run of snapshot.runs) {
    await writeJson(path.join(root, "runs", `${run.id}.json`), run);
  }
  await writeJson(path.join(root, "events.json"), snapshot.events);
}

export async function saveLocalJobs(
  workspace: string,
  jobs: readonly HostedWorkbenchJob[],
): Promise<void> {
  if (jobs.length === 0) {
    return;
  }
  const root = localRuntimeDir(workspace);
  const jobsDir = path.join(root, "jobs");
  const executionFilesDir = path.join(root, "execution-files");
  await Promise.all([
    fs.mkdir(jobsDir, { recursive: true }),
    fs.mkdir(executionFilesDir, { recursive: true }),
  ]);
  for (const job of jobs) {
    const safeJobId = localRecordName(job.id);
    const traceSourceFiles = filterArchivedExecutionFiles(completedJobOutputFiles(job));
    const outputFiles = selectExecutionOutputFilesForInspection({
      purpose: readExecutionPurpose(job),
      files: traceSourceFiles,
      output: jsonRecord(job.output),
    });
    await writeJson(
      path.join(jobsDir, `${safeJobId}.json`),
      archivedLocalJob(job, outputFiles, traceSourceFiles),
    );
    const filesRoot = path.join(executionFilesDir, safeJobId);
    await fs.rm(filesRoot, { force: true, recursive: true });
    await writeSurfaceFiles(filesRoot, outputFiles);
  }
}

export async function readLocalExecutionFiles(
  workspace: string,
  jobId: string,
): Promise<SurfaceSnapshotFile[]> {
  return await readSurfaceFiles(
    path.join(localRuntimeDir(workspace), "execution-files", localRecordName(jobId)),
  );
}

export async function readLocalSubjectRecord(
  workspace: string,
  subjectId: string,
): Promise<SubjectRecord> {
  const subject = await readJson<SubjectRecord | null>(
    path.join(localRuntimeDir(workspace), "subjects", localRecordName(subjectId), "record.json"),
    null,
  );
  if (!subject) {
    throw new Error(`Subject not found: ${subjectId}`);
  }
  validateSubjectRecord(subject);
  return subject;
}

export async function readLocalSubjectFilesForId(
  workspace: string,
  subjectId: string,
): Promise<SurfaceSnapshotFile[]> {
  await readLocalSubjectRecord(workspace, subjectId);
  return await readSurfaceFiles(
    path.join(localRuntimeDir(workspace), "subjects", localRecordName(subjectId), "files"),
  );
}

export async function readLocalEvaluationRecord(
  workspace: string,
  evaluationId: string,
): Promise<EvaluationScorecard> {
  const evaluation = await readJson<EvaluationScorecard | null>(
    path.join(localRuntimeDir(workspace), "evaluations", `${localRecordName(evaluationId)}.json`),
    null,
  );
  if (!evaluation) {
    throw new Error(`Evaluation not found: ${evaluationId}`);
  }
  validateEvaluationRecord(evaluation);
  return evaluation;
}

export async function readLocalRunRecord(
  workspace: string,
  runId: string,
): Promise<RunSummary> {
  const run = await readJson<RunSummary | null>(
    path.join(localRuntimeDir(workspace), "runs", `${localRecordName(runId)}.json`),
    null,
  );
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  validateRunRecord(run);
  return run;
}

export async function readLocalJobs(
  workspace: string,
): Promise<LocalArchivedJob[]> {
  const jobs = await readFlatRecords<LocalArchivedJob>(path.join(localRuntimeDir(workspace), "jobs"));
  return jobs.sort((left, right) =>
    (left.startedAt ?? left.createdAt).localeCompare(right.startedAt ?? right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

export async function readLocalRunJobs(
  workspace: string,
  runId: string,
): Promise<LocalArchivedJob[]> {
  return (await readLocalJobs(workspace)).filter((job) => job.runId === runId);
}

export async function readLocalJobInRun(
  workspace: string,
  runId: string,
  jobId: string,
): Promise<LocalArchivedJob | null> {
  return (await readLocalRunJobs(workspace, runId)).find((job) => job.id === jobId) ?? null;
}

export function upsertLocalSubject(
  snapshot: LocalArchiveSnapshot,
  subject: SubjectRecord,
  files: readonly SurfaceSnapshotFile[],
): LocalArchiveSnapshot {
  return {
    ...snapshot,
    subjects: [
      ...snapshot.subjects.filter((entry) => entry.id !== subject.id),
      subject,
    ].sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id)),
    subjectFiles: {
      ...snapshot.subjectFiles,
      [subject.id]: files.map((file) => ({ ...file })),
    },
  };
}

export function upsertLocalEvaluation(
  snapshot: LocalArchiveSnapshot,
  evaluation: EvaluationScorecard,
): LocalArchiveSnapshot {
  return {
    ...snapshot,
    evaluations: [
      ...snapshot.evaluations.filter((entry) => entry.id !== evaluation.id),
      evaluation,
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
  };
}

export function appendLocalRun(
  snapshot: LocalArchiveSnapshot,
  run: RunSummary,
  events: readonly RuntimeEvent[],
): LocalArchiveSnapshot {
  return {
    ...snapshot,
    runs: [
      ...snapshot.runs.filter((entry) => entry.id !== run.id),
      run,
    ].sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id)),
    events: [
      ...snapshot.events,
      ...events,
    ].sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id)),
  };
}

export function setLocalActive(snapshot: LocalArchiveSnapshot, activeId: string | null): LocalArchiveSnapshot {
  return {
    ...snapshot,
    activeId,
  };
}

export function readLocalSubject(snapshot: LocalArchiveSnapshot, subjectId: string): SubjectRecord {
  const subject = snapshot.subjects.find((entry) => entry.id === subjectId);
  if (!subject) {
    throw new Error(`Subject not found: ${subjectId}`);
  }
  return subject;
}

export function readLocalSubjectFiles(snapshot: LocalArchiveSnapshot, subjectId: string): SurfaceSnapshotFile[] {
  readLocalSubject(snapshot, subjectId);
  return (snapshot.subjectFiles[subjectId] ?? []).map((file) => ({ ...file }));
}

function validateLocalArchiveSnapshot(snapshot: LocalArchiveSnapshot): void {
  validateLocalArchiveIndex(snapshot);
}

function validateLocalArchiveIndex(snapshot: LocalArchiveIndex): void {
  const subjectIds = new Set(snapshot.subjects.map((subject) => subject.id));
  if (snapshot.activeId && !subjectIds.has(snapshot.activeId)) {
    throw new Error(`Active subject not found: ${snapshot.activeId}`);
  }
  for (const subject of snapshot.subjects) {
    validateSubjectRecord(subject);
    if (!Array.isArray(subject.referenceIds)) {
      throw new Error(`subject ${subject.id}.referenceIds must be an array.`);
    }
    if (!Array.isArray(subject.fileChanges)) {
      throw new Error(`subject ${subject.id}.fileChanges must be an array.`);
    }
    if (subject.baseId && !subjectIds.has(subject.baseId)) {
      throw new Error(`subject ${subject.id}.baseId not found: ${subject.baseId}`);
    }
  }
  for (const evaluation of snapshot.evaluations) {
    validateEvaluationRecord(evaluation);
    const subject = snapshot.subjects.find((entry) => entry.id === evaluation.subjectId);
    if (!subject) {
      throw new Error(`evaluation ${evaluation.id}.subjectId not found: ${evaluation.subjectId}`);
    }
    if (subject.benchmarkFingerprint !== evaluation.benchmarkFingerprint) {
      throw new Error(`evaluation ${evaluation.id}.benchmarkFingerprint does not match subject ${subject.id}.`);
    }
    if (subject.subjectFingerprint !== evaluation.subjectFingerprint) {
      throw new Error(`evaluation ${evaluation.id}.subjectFingerprint does not match subject ${subject.id}.`);
    }
  }
  for (const run of snapshot.runs) {
    validateRunRecord(run);
  }
}

function validateSubjectRecord(subject: SubjectRecord): void {
  requireArchiveString(subject.id, "subject.id");
  requireArchiveString(subject.benchmarkFingerprint, `subject ${subject.id}.benchmarkFingerprint`);
  requireArchiveString(subject.subjectFingerprint, `subject ${subject.id}.subjectFingerprint`);
  requireArchiveString(subject.createdAt, `subject ${subject.id}.createdAt`);
}

function validateEvaluationRecord(evaluation: EvaluationScorecard): void {
  requireArchiveString(evaluation.id, "evaluation.id");
  requireArchiveString(evaluation.runId, `evaluation ${evaluation.id}.runId`);
  requireArchiveString(evaluation.benchmarkFingerprint, `evaluation ${evaluation.id}.benchmarkFingerprint`);
  requireArchiveString(evaluation.subjectFingerprint, `evaluation ${evaluation.id}.subjectFingerprint`);
  requireArchiveString(evaluation.subjectId, `evaluation ${evaluation.id}.subjectId`);
}

function validateRunRecord(run: RunSummary): void {
  requireArchiveString(run.id, "run.id");
  requireArchiveString(run.workflow, `run ${run.id}.workflow`);
  requireArchiveString(run.benchmarkFingerprint, `run ${run.id}.benchmarkFingerprint`);
  requireArchiveString(run.status, `run ${run.id}.status`);
  requireArchiveString(run.startedAt, `run ${run.id}.startedAt`);
}

function requireArchiveString(value: unknown, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function archivedLocalJob(
  job: HostedWorkbenchJob,
  outputFiles: readonly SurfaceSnapshotFile[],
  traceSourceFiles: readonly SurfaceSnapshotFile[],
): HostedWorkbenchJob & { trace: WorkbenchExecutionTrace; traceSessions: WorkbenchTraceSession[] } {
  const output = jsonRecord(job.output);
  const traceSessions = buildLocalJobTraceSessions(job, traceSourceFiles);
  return {
    ...job,
    ...(Object.keys(output).length > 0
      ? { output: { ...output, files: outputFiles } as unknown as Json }
      : {}),
    trace: buildLocalJobTrace(job),
    traceSessions,
  };
}

function filterArchivedExecutionFiles(
  files: readonly SurfaceSnapshotFile[],
): SurfaceSnapshotFile[] {
  return files.filter((file) =>
    file.path.startsWith(".workbench/traces/") ||
    !isWorkbenchReservedArchivePath(file.path),
  );
}

function isWorkbenchReservedArchivePath(filePath: string): boolean {
  return filePath === ".workbench" || filePath.startsWith(".workbench/");
}

function buildLocalJobTrace(job: HostedWorkbenchJob): WorkbenchExecutionTrace {
  const purpose = readExecutionPurpose(job);
  const role = purpose === "improve" ? "optimizer" : "engine";
  const stageId = purpose ?? "execution";
  const status = traceStatusForJob(job.status);
  const startedAt = job.startedAt ?? job.createdAt;
  const endedAt = job.finishedAt ?? null;
  const spanId = "job";
  const output = jsonRecord(job.output);
  const usage = traceUsageSummary(output.usage);
  const events: WorkbenchTraceEvent[] = [
    traceEvent({
      index: 1,
      spanId,
      stageId,
      kind: "status",
      at: startedAt,
      message: `${capitalize(role)} job ${status === "completed" ? "completed" : status}.`,
      attributes: {
        job_id: job.id,
        purpose: purpose ?? "unknown",
      },
    }),
  ];
  const outputMessage = localJobOutputMessage(job, output);
  if (outputMessage) {
    events.push(traceEvent({
      index: events.length + 1,
      spanId,
      stageId,
      kind: "output",
      at: endedAt ?? startedAt,
      message: outputMessage,
      attributes: {
        job_id: job.id,
      },
    }));
  }
  if (usage) {
    events.push(traceEvent({
      index: events.length + 1,
      spanId,
      stageId,
      kind: "usage",
      at: endedAt ?? startedAt,
      message: usage.total_tokens !== null
        ? `Usage recorded: ${usage.total_tokens} token(s).`
        : "Usage recorded.",
      attributes: {
        job_id: job.id,
        usage: usage as unknown as Json,
      },
    }));
  }
  if (job.error) {
    events.push(traceEvent({
      index: events.length + 1,
      spanId,
      stageId,
      kind: "error",
      at: endedAt ?? startedAt,
      message: job.error,
      attributes: { job_id: job.id },
    }));
  }
  const span: WorkbenchTraceSpan = {
    id: spanId,
    parent_id: null,
    attempt_number: Math.max(1, job.attempt || 1),
    stage_id: stageId,
    stage_run_index: null,
    kind: purpose === "attempt" || purpose === "improve" ? "turn" : "stage",
    title: `${capitalize(role)} job ${job.id}`,
    status,
    started_at: startedAt,
    ended_at: endedAt,
    attributes: {
      job_id: job.id,
      purpose: purpose ?? "unknown",
    },
  };
  return {
    trace_id: `local-${job.id}`,
    spans: [span],
    events,
    summaries: [traceSummary(job, stageId, status, startedAt, endedAt, usage, outputMessage, null)],
  };
}

function buildLocalJobTraceSessions(
  job: HostedWorkbenchJob,
  outputFiles: readonly SurfaceSnapshotFile[],
): WorkbenchTraceSession[] {
  const purpose = readExecutionPurpose(job);
  return buildWorkbenchTraceSessionsFromFiles({
    job,
    files: outputFiles,
    purpose,
    fallbackRole: purpose === "improve" ? "optimizer" : "engine",
  });
}

function completedJobOutputFiles(job: HostedWorkbenchJob): SurfaceSnapshotFile[] {
  const output = jsonRecord(job.output);
  if (!Array.isArray(output.files)) {
    return [];
  }
  return output.files.filter(isSurfaceSnapshotFile).map((file) => ({ ...file }));
}

function isSurfaceSnapshotFile(value: unknown): value is SurfaceSnapshotFile {
  const record = jsonRecord(value);
  return (
    typeof record.path === "string" &&
    (record.kind === "text" || record.kind === "binary") &&
    (record.encoding === "utf8" || record.encoding === "base64") &&
    typeof record.content === "string" &&
    typeof record.executable === "boolean"
  );
}

function readExecutionPurpose(job: HostedWorkbenchJob): string | null {
  const input = jsonRecord(job.input);
  return stringValue(jsonRecord(input.execution).purpose);
}

function traceStatusForJob(status: HostedWorkbenchJob["status"]): WorkbenchTraceSpan["status"] {
  if (status === "succeeded") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "canceled";
  if (status === "running") return "running";
  return "warning";
}

function localJobOutputMessage(
  job: HostedWorkbenchJob,
  output: Record<string, unknown>,
): string | null {
  const purpose = readExecutionPurpose(job);
  const result = jsonRecord(output.result);
  const score = numberValue(result.score);
  if (purpose === "attempt" && score !== null) {
    const summary = stringValue(result.summary) ?? stringValue(jsonRecord(result.feedback).summary);
    return `Attempt produced score ${score}.${summary ? ` ${summary}` : ""}`.trim();
  }
  const summary = stringValue(output.summary);
  return summary ? truncateTraceMessage(summary) : null;
}

function traceSummary(
  job: HostedWorkbenchJob,
  stageId: string,
  status: WorkbenchTraceSpan["status"],
  startedAt: string,
  endedAt: string | null,
  usage: WorkbenchTraceUsageSummary | null,
  outputMessage: string | null,
  eventCount: number | null,
): WorkbenchTraceSummary {
  const durationMs = endedAt && Number.isFinite(Date.parse(endedAt)) && Number.isFinite(Date.parse(startedAt))
    ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt))
    : 0;
  return {
    attempt_number: Math.max(1, job.attempt || 1),
    stage_id: stageId,
    stage_run_index: null,
    status,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: durationMs,
    tool_call_count: eventCount ?? 0,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    usage,
    final_output_present: Boolean(outputMessage),
    error_message: job.error ?? null,
  };
}

function traceEvent(args: {
  index: number;
  spanId: string;
  stageId: string;
  kind: WorkbenchTraceEvent["kind"];
  at: string;
  message: string;
  attributes: Record<string, Json>;
}): WorkbenchTraceEvent {
  return {
    id: `event-${String(args.index).padStart(3, "0")}`,
    span_id: args.spanId,
    attempt_number: 1,
    stage_id: args.stageId,
    stage_run_index: null,
    kind: args.kind,
    at: args.at,
    message: truncateTraceMessage(args.message),
    attributes: args.attributes,
  };
}

function traceUsageSummary(value: unknown): WorkbenchTraceUsageSummary | null {
  const record = jsonRecord(value);
  const usage = Object.keys(jsonRecord(record.total)).length > 0
    ? jsonRecord(record.total)
    : Object.keys(jsonRecord(record.optimizer)).length > 0
      ? jsonRecord(record.optimizer)
      : Object.keys(jsonRecord(record.runner)).length > 0
        ? jsonRecord(record.runner)
        : Object.keys(jsonRecord(record.engine)).length > 0
          ? jsonRecord(record.engine)
          : record;
  if (Object.keys(usage).length === 0) {
    return null;
  }
  return {
    provider: stringValue(usage.provider),
    model: stringValue(usage.model),
    input_tokens: numberValue(usage.inputTokens) ?? numberValue(usage.input_tokens),
    uncached_input_tokens: numberValue(usage.uncachedInputTokens) ?? numberValue(usage.uncached_input_tokens),
    cached_input_tokens: numberValue(usage.cachedInputTokens) ?? numberValue(usage.cached_input_tokens),
    cache_creation_input_tokens: numberValue(usage.cacheCreationInputTokens) ?? numberValue(usage.cache_creation_input_tokens),
    cache_read_input_tokens: numberValue(usage.cacheReadInputTokens) ?? numberValue(usage.cache_read_input_tokens),
    output_tokens: numberValue(usage.outputTokens) ?? numberValue(usage.output_tokens),
    reasoning_output_tokens: numberValue(usage.reasoningOutputTokens) ?? numberValue(usage.reasoning_output_tokens),
    total_tokens: numberValue(usage.totalTokens) ?? numberValue(usage.total_tokens),
    total_cost_usd: numberValue(usage.costUsd) ?? numberValue(usage.totalCostUsd) ?? numberValue(usage.total_cost_usd),
    cost_source: stringValue(usage.costSource) ?? stringValue(usage.cost_source),
    pricing_source: stringValue(usage.pricingSource) ?? stringValue(usage.pricing_source),
  };
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}` : value;
}

function truncateTraceMessage(value: string): string {
  return value.length > 500 ? `${value.slice(0, 497)}...` : value;
}

function localRecordName(value: string): string {
  if (!value || /[\\/\\\0]/u.test(value)) {
    throw new Error(`Unsafe local archive record id: ${value}`);
  }
  return value;
}

export async function materializeSubjectRoot(
  workspace: string,
  subjectRoot: string,
  files: readonly SurfaceSnapshotFile[],
): Promise<string[]> {
  const root = path.join(workspace, normalizeRelativePath(subjectRoot));
  const before = new Set((await readSurfaceFiles(root)).map((file) => file.path));
  await fs.rm(root, { force: true, recursive: true });
  await writeSurfaceFiles(root, files);
  const after = new Set(files.map((file) => file.path));
  return [...new Set([...before, ...after])].sort();
}

export function findArchivedFile(
  files: readonly SurfaceSnapshotFile[],
  filePath: string,
): SurfaceSnapshotFile | null {
  const normalized = normalizeRelativePath(filePath);
  return files.find((file) => file.path === normalized) ?? null;
}

async function readRecords<T>(root: string, fileName: string): Promise<T[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const records: T[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    records.push(await readJson<T>(path.join(root, entry.name, fileName), null as T));
  }
  return records.filter((entry) => entry != null);
}

async function readFlatRecords<T>(root: string): Promise<T[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const records: T[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      records.push(await readJson<T>(path.join(root, entry.name), null as T));
    }
  }
  return records.filter((entry) => entry != null);
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeSurfaceFiles(root: string, files: readonly SurfaceSnapshotFile[]): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  for (const file of files) {
    const target = path.join(root, normalizeRelativePath(file.path));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const body = file.encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content, "utf8");
    await fs.writeFile(target, body);
    if (file.executable) {
      await fs.chmod(target, 0o755).catch(() => undefined);
    }
  }
}

async function readSurfaceFiles(root: string): Promise<SurfaceSnapshotFile[]> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files: SurfaceSnapshotFile[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const body = await fs.readFile(absolutePath);
      const relativePath = normalizeRelativePath(path.relative(root, absolutePath).replace(/\\/gu, "/"));
      const stats = await fs.stat(absolutePath);
      const content = encodeContent(body, decoder);
      files.push({
        path: relativePath,
        kind: content.encoding === "base64" ? "binary" : "text",
        encoding: content.encoding,
        content: content.content,
        executable: (stats.mode & 0o111) !== 0,
      });
    }
  }
  await walk(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function encodeContent(body: Buffer, decoder: { decode(input?: Uint8Array): string }): { encoding: "utf8" | "base64"; content: string } {
  try {
    return {
      encoding: "utf8",
      content: decoder.decode(body),
    };
  } catch {
    return {
      encoding: "base64",
      content: body.toString("base64"),
    };
  }
}

function normalizeRelativePath(filePath: string): string {
  const normalized = filePath.replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (!normalized || normalized.includes("\0")) {
    throw new Error("File paths must be non-empty relative paths.");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === "." || part === "")) {
    throw new Error(`Unsafe relative file path: ${filePath}`);
  }
  return normalized;
}
