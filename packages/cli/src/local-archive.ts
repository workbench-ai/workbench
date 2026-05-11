import { promises as fs } from "node:fs";
import path from "node:path";

import {
  finalizeWorkbenchExecutionTraceForJob,
  selectExecutionOutputFilesForInspection,
  type CandidateRecord,
  type EvaluationResultRecord,
  type HostedWorkbenchJob,
  type RunSummary,
  type RuntimeEvent,
  type Json,
  type SurfaceSnapshotFile,
  type WorkbenchExecutionTrace,
} from "@workbench-ai/workbench-core";

type WorkbenchTraceSpan = WorkbenchExecutionTrace["spans"][number];
type WorkbenchTraceEvent = WorkbenchExecutionTrace["events"][number];
type WorkbenchTraceSummary = WorkbenchExecutionTrace["summaries"][number];
type WorkbenchTraceUsageSummary = NonNullable<WorkbenchTraceSummary["usage"]>;

export interface LocalArchiveSnapshot {
  activeId: string | null;
  candidates: CandidateRecord[];
  candidateFiles: Record<string, SurfaceSnapshotFile[]>;
  evaluations: EvaluationResultRecord[];
  runs: RunSummary[];
  events: RuntimeEvent[];
}

interface LocalArchiveStateFile {
  activeId?: string | null;
}

const RUNTIME_DIR = ".workbench/runtime";

export function localRuntimeDir(workspace: string): string {
  return path.join(workspace, RUNTIME_DIR);
}

export async function loadLocalArchive(workspace: string): Promise<LocalArchiveSnapshot> {
  const root = localRuntimeDir(workspace);
  const [state, candidates, evaluations, runs, events] = await Promise.all([
    readJson<LocalArchiveStateFile>(path.join(root, "state.json"), {}),
    readRecords<CandidateRecord>(path.join(root, "candidates"), "record.json"),
    readFlatRecords<EvaluationResultRecord>(path.join(root, "evaluations")),
    readFlatRecords<RunSummary>(path.join(root, "runs")),
    readJson<RuntimeEvent[]>(path.join(root, "events.json"), []),
  ]);
  const candidateFiles: Record<string, SurfaceSnapshotFile[]> = {};
  await Promise.all(candidates.map(async (candidate) => {
    candidateFiles[candidate.id] = await readSurfaceFiles(path.join(root, "candidates", candidate.id, "files"));
  }));
  const snapshot: LocalArchiveSnapshot = {
    activeId: typeof state.activeId === "string" ? state.activeId : null,
    candidates: candidates.sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id)),
    candidateFiles,
    evaluations: evaluations.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
    runs: runs.sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id)),
    events: events.sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id)),
  };
  validateLocalArchiveSnapshot(snapshot);
  return snapshot;
}

export async function saveLocalArchive(
  workspace: string,
  snapshot: LocalArchiveSnapshot,
): Promise<void> {
  const root = localRuntimeDir(workspace);
  await fs.mkdir(root, { recursive: true });
  await writeJson(path.join(root, "state.json"), { activeId: snapshot.activeId });
  await fs.rm(path.join(root, "candidates"), { force: true, recursive: true });
  await fs.rm(path.join(root, "evaluations"), { force: true, recursive: true });
  await fs.rm(path.join(root, "runs"), { force: true, recursive: true });
  await Promise.all([
    fs.mkdir(path.join(root, "candidates"), { recursive: true }),
    fs.mkdir(path.join(root, "evaluations"), { recursive: true }),
    fs.mkdir(path.join(root, "runs"), { recursive: true }),
  ]);
  for (const candidate of snapshot.candidates) {
    const candidateRoot = path.join(root, "candidates", candidate.id);
    await fs.mkdir(candidateRoot, { recursive: true });
    await writeJson(path.join(candidateRoot, "record.json"), candidate);
    await writeSurfaceFiles(path.join(candidateRoot, "files"), snapshot.candidateFiles[candidate.id] ?? []);
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

export function upsertLocalCandidate(
  snapshot: LocalArchiveSnapshot,
  candidate: CandidateRecord,
  files: readonly SurfaceSnapshotFile[],
): LocalArchiveSnapshot {
  return {
    ...snapshot,
    candidates: [
      ...snapshot.candidates.filter((entry) => entry.id !== candidate.id),
      candidate,
    ].sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id)),
    candidateFiles: {
      ...snapshot.candidateFiles,
      [candidate.id]: files.map((file) => ({ ...file })),
    },
  };
}

export function upsertLocalEvaluation(
  snapshot: LocalArchiveSnapshot,
  evaluation: EvaluationResultRecord,
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

export function readLocalCandidate(snapshot: LocalArchiveSnapshot, candidateId: string): CandidateRecord {
  const candidate = snapshot.candidates.find((entry) => entry.id === candidateId);
  if (!candidate) {
    throw new Error(`Candidate not found: ${candidateId}`);
  }
  return candidate;
}

export function readLocalCandidateFiles(snapshot: LocalArchiveSnapshot, candidateId: string): SurfaceSnapshotFile[] {
  readLocalCandidate(snapshot, candidateId);
  return (snapshot.candidateFiles[candidateId] ?? []).map((file) => ({ ...file }));
}

function validateLocalArchiveSnapshot(snapshot: LocalArchiveSnapshot): void {
  const candidateIds = new Set(snapshot.candidates.map((candidate) => candidate.id));
  if (snapshot.activeId && !candidateIds.has(snapshot.activeId)) {
    throw new Error(`Active candidate not found: ${snapshot.activeId}`);
  }
  for (const candidate of snapshot.candidates) {
    requireArchiveString(candidate.id, "candidate.id");
    requireArchiveString(candidate.benchmarkFingerprint, `candidate ${candidate.id}.benchmarkFingerprint`);
    requireArchiveString(candidate.candidateFingerprint, `candidate ${candidate.id}.candidateFingerprint`);
    requireArchiveString(candidate.createdAt, `candidate ${candidate.id}.createdAt`);
    if (!Array.isArray(candidate.referenceIds)) {
      throw new Error(`candidate ${candidate.id}.referenceIds must be an array.`);
    }
    if (!Array.isArray(candidate.fileChanges)) {
      throw new Error(`candidate ${candidate.id}.fileChanges must be an array.`);
    }
    if (candidate.baseId && !candidateIds.has(candidate.baseId)) {
      throw new Error(`candidate ${candidate.id}.baseId not found: ${candidate.baseId}`);
    }
  }
  for (const evaluation of snapshot.evaluations) {
    requireArchiveString(evaluation.id, "evaluation.id");
    requireArchiveString(evaluation.runId, `evaluation ${evaluation.id}.runId`);
    requireArchiveString(evaluation.benchmarkFingerprint, `evaluation ${evaluation.id}.benchmarkFingerprint`);
    requireArchiveString(evaluation.candidateFingerprint, `evaluation ${evaluation.id}.candidateFingerprint`);
    requireArchiveString(evaluation.candidateId, `evaluation ${evaluation.id}.candidateId`);
    const candidate = snapshot.candidates.find((entry) => entry.id === evaluation.candidateId);
    if (!candidate) {
      throw new Error(`evaluation ${evaluation.id}.candidateId not found: ${evaluation.candidateId}`);
    }
    if (candidate.benchmarkFingerprint !== evaluation.benchmarkFingerprint) {
      throw new Error(`evaluation ${evaluation.id}.benchmarkFingerprint does not match candidate ${candidate.id}.`);
    }
    if (candidate.candidateFingerprint !== evaluation.candidateFingerprint) {
      throw new Error(`evaluation ${evaluation.id}.candidateFingerprint does not match candidate ${candidate.id}.`);
    }
  }
  for (const run of snapshot.runs) {
    requireArchiveString(run.id, "run.id");
    requireArchiveString(run.workflow, `run ${run.id}.workflow`);
    requireArchiveString(run.benchmarkFingerprint, `run ${run.id}.benchmarkFingerprint`);
    requireArchiveString(run.status, `run ${run.id}.status`);
    requireArchiveString(run.startedAt, `run ${run.id}.startedAt`);
  }
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
): HostedWorkbenchJob & { trace: WorkbenchExecutionTrace } {
  const output = jsonRecord(job.output);
  return {
    ...job,
    ...(Object.keys(output).length > 0
      ? { output: { ...output, files: outputFiles } as unknown as Json }
      : {}),
    trace: buildLocalJobTrace(job, traceSourceFiles),
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

function buildLocalJobTrace(
  job: HostedWorkbenchJob,
  outputFiles: readonly SurfaceSnapshotFile[],
): WorkbenchExecutionTrace {
  const purpose = readExecutionPurpose(job);
  const role = purpose === "grade-task" ? "grader" : purpose === "run-task" ? "runner" : "optimizer";
  const stageId = purpose ?? "execution";
  const realTrace = readLastExecutionTrace(outputFiles);
  if (realTrace) {
    return normalizeLocalExecutionTrace(realTrace, job, stageId);
  }
  const status = traceStatusForJob(job.status);
  const startedAt = job.startedAt ?? job.createdAt;
  const endedAt = job.finishedAt ?? null;
  const spanId = "job";
  const agentResult = readLastTraceJson(outputFiles, "/agent-result.json");
  const eventCount = numberValue(agentResult.eventCount);
  const sessionId = stringValue(agentResult.sessionId);
  const output = jsonRecord(job.output);
  const usage = traceUsageSummary(output.usage ?? agentResult.usage);
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
  if (sessionId || eventCount !== null) {
    events.push(traceEvent({
      index: events.length + 1,
      spanId,
      stageId,
      kind: "note",
      at: endedAt ?? startedAt,
      message: `Agent session${sessionId ? ` ${sessionId}` : ""}${eventCount !== null ? ` recorded ${eventCount} event(s)` : ""}.`,
      attributes: {
        job_id: job.id,
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(eventCount !== null ? { event_count: eventCount } : {}),
      },
    }));
  }
  const outputMessage = localJobOutputMessage(job, output, agentResult);
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
    kind: purpose === "run-task" || purpose === "grade-task" || purpose === "improve" ? "turn" : "stage",
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
    summaries: [traceSummary(job, stageId, status, startedAt, endedAt, usage, outputMessage, eventCount)],
  };
}

function readLastExecutionTrace(
  files: readonly SurfaceSnapshotFile[],
): WorkbenchExecutionTrace | null {
  const traceRecord = files
    .filter((file) => file.encoding === "utf8" && file.path.endsWith("/trace.json"))
    .map((file) => parseJsonObject(file.content))
    .filter((record) => Object.keys(record).length > 0)
    .at(-1);
  if (!traceRecord) {
    return null;
  }
  const spans = Array.isArray(traceRecord.spans)
    ? traceRecord.spans.map(readTraceSpan).filter((span): span is WorkbenchTraceSpan => span !== null)
    : [];
  const events = Array.isArray(traceRecord.events)
    ? traceRecord.events.map(readTraceEvent).filter((event): event is WorkbenchTraceEvent => event !== null)
    : [];
  const summaries = Array.isArray(traceRecord.summaries)
    ? traceRecord.summaries.map(readTraceSummary).filter((summary): summary is WorkbenchTraceSummary => summary !== null)
    : [];
  if (spans.length === 0 && events.length === 0 && summaries.length === 0) {
    return null;
  }
  return {
    trace_id: stringValue(traceRecord.trace_id) ?? "agent-trace",
    spans,
    events,
    summaries,
  };
}

function normalizeLocalExecutionTrace(
  trace: WorkbenchExecutionTrace,
  job: HostedWorkbenchJob,
  stageId: string,
): WorkbenchExecutionTrace {
  return finalizeWorkbenchExecutionTraceForJob({
    job,
    stageId,
    trace: {
      trace_id: `local-${job.id}`,
      spans: trace.spans.map((span: WorkbenchTraceSpan) => ({
        ...span,
        stage_id: stageId,
        stage_run_index: null,
        attributes: {
          ...span.attributes,
          job_id: job.id,
        },
      })),
      events: trace.events.map((event: WorkbenchTraceEvent) => ({
        ...event,
        stage_id: stageId,
        stage_run_index: null,
        attributes: {
          ...event.attributes,
          job_id: job.id,
        },
      })),
      summaries: trace.summaries.map((summary: WorkbenchTraceSummary) => ({
        ...summary,
        stage_id: stageId,
        stage_run_index: null,
      })),
    },
  });
}

function readTraceSpan(value: unknown): WorkbenchTraceSpan | null {
  const record = jsonRecord(value);
  const id = stringValue(record.id);
  const kind = traceSpanKind(record.kind);
  const status = traceStatus(record.status);
  const startedAt = stringValue(record.started_at);
  if (!id || !kind || !status || !startedAt) {
    return null;
  }
  return {
    id,
    parent_id: stringValue(record.parent_id),
    attempt_number: positiveInteger(record.attempt_number) ?? 1,
    stage_id: stringValue(record.stage_id),
    stage_run_index: integerValue(record.stage_run_index),
    kind,
    title: stringValue(record.title) ?? id,
    status,
    started_at: startedAt,
    ended_at: stringValue(record.ended_at),
    attributes: jsonRecord(record.attributes) as Record<string, Json>,
  };
}

function readTraceEvent(value: unknown): WorkbenchTraceEvent | null {
  const record = jsonRecord(value);
  const id = stringValue(record.id);
  const spanId = stringValue(record.span_id);
  const kind = traceEventKind(record.kind);
  const at = stringValue(record.at);
  if (!id || !spanId || !kind || !at) {
    return null;
  }
  return {
    id,
    span_id: spanId,
    attempt_number: positiveInteger(record.attempt_number) ?? 1,
    stage_id: stringValue(record.stage_id),
    stage_run_index: integerValue(record.stage_run_index),
    kind,
    at,
    message: stringValue(record.message) ?? kind,
    attributes: jsonRecord(record.attributes) as Record<string, Json>,
  };
}

function readTraceSummary(value: unknown): WorkbenchTraceSummary | null {
  const record = jsonRecord(value);
  const status = traceStatus(record.status);
  const startedAt = stringValue(record.started_at);
  if (!status || !startedAt) {
    return null;
  }
  return {
    attempt_number: positiveInteger(record.attempt_number) ?? 1,
    stage_id: stringValue(record.stage_id),
    stage_run_index: integerValue(record.stage_run_index),
    status,
    started_at: startedAt,
    ended_at: stringValue(record.ended_at),
    duration_ms: nonNegativeInteger(record.duration_ms) ?? 0,
    tool_call_count: nonNegativeInteger(record.tool_call_count) ?? 0,
    input_tokens: nonNegativeInteger(record.input_tokens),
    output_tokens: nonNegativeInteger(record.output_tokens),
    usage: traceUsageSummary(record.usage),
    final_output_present: record.final_output_present === true,
    error_message: stringValue(record.error_message),
  };
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
  agentResult: Record<string, unknown>,
): string | null {
  const purpose = readExecutionPurpose(job);
  const scorecard = jsonRecord(output.scorecard);
  const score = numberValue(scorecard.score);
  if (purpose === "grade-task") {
    const summary = stringValue(scorecard.summary) ?? stringValue(jsonRecord(scorecard.feedback).summary);
    return `Rubric grader produced score${score !== null ? ` ${score}` : ""}.${summary ? ` ${summary}` : ""}`.trim();
  }
  const summary = stringValue(output.summary) ?? stringValue(agentResult.finalOutput);
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
        : Object.keys(jsonRecord(record.grader)).length > 0
          ? jsonRecord(record.grader)
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

function readLastTraceJson(
  files: readonly SurfaceSnapshotFile[],
  suffix: string,
): Record<string, unknown> {
  return files
    .filter((file) => file.encoding === "utf8" && file.path.endsWith(suffix))
    .map((file) => parseJsonObject(file.content))
    .filter((record) => Object.keys(record).length > 0)
    .at(-1) ?? {};
}

function parseJsonObject(source: string): Record<string, unknown> {
  try {
    return jsonRecord(JSON.parse(source));
  } catch {
    return {};
  }
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

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function positiveInteger(value: unknown): number | null {
  const integer = integerValue(value);
  return integer !== null && integer > 0 ? integer : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const integer = integerValue(value);
  return integer !== null && integer >= 0 ? integer : null;
}

function traceSpanKind(value: unknown): WorkbenchTraceSpan["kind"] | null {
  return value === "hook" ||
    value === "stage" ||
    value === "turn" ||
    value === "tool_call" ||
    value === "assistant_output" ||
    value === "usage" ||
    value === "gate" ||
    value === "action" ||
    value === "error"
    ? value
    : null;
}

function traceEventKind(value: unknown): WorkbenchTraceEvent["kind"] | null {
  return value === "status" ||
    value === "message" ||
    value === "output" ||
    value === "usage" ||
    value === "error" ||
    value === "note"
    ? value
    : null;
}

function traceStatus(value: unknown): WorkbenchTraceSpan["status"] | null {
  return value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "canceled" ||
    value === "warning"
    ? value
    : null;
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

export async function materializeCandidateRoot(
  workspace: string,
  candidateRoot: string,
  files: readonly SurfaceSnapshotFile[],
): Promise<string[]> {
  const root = path.join(workspace, normalizeRelativePath(candidateRoot));
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
