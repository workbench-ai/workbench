import { promises as fs } from "node:fs";
import path from "node:path";

import {
  buildWorkbenchTraceSessionsFromFiles,
  candidateRecordWithoutDerivedFields,
  sanitizeWorkbenchRuntimeCandidateForExchange,
  sanitizeWorkbenchRuntimeJobForExchange,
  selectExecutionOutputFilesForInspection,
  workbenchRuntimeBundleStats,
  workbenchSurfaceFilesEqualForExchange,
  type CandidateRecord,
  type EvaluationScorecard,
  type HostedWorkbenchJob,
  type RunSummary,
  type RuntimeEvent,
  type Json,
  type SurfaceSnapshotFile,
  type WorkbenchRuntimeBundle,
  type WorkbenchRuntimeBundleStats,
  type WorkbenchRuntimeImportResult,
  type WorkbenchExecutionTrace,
  type WorkbenchTraceSession,
} from "@workbench-ai/workbench-core";

type WorkbenchTraceSpan = WorkbenchExecutionTrace["spans"][number];
type WorkbenchTraceEvent = WorkbenchExecutionTrace["events"][number];
type WorkbenchTraceSummary = WorkbenchExecutionTrace["summaries"][number];
type WorkbenchTraceUsageSummary = NonNullable<WorkbenchTraceSummary["usage"]>;

export interface LocalArchiveSnapshot {
  activeId: string | null;
  candidates: CandidateRecord[];
  candidateFiles: Record<string, SurfaceSnapshotFile[]>;
  evaluations: EvaluationScorecard[];
  runs: RunSummary[];
  events: RuntimeEvent[];
}

export interface LocalArchiveIndex {
  activeId: string | null;
  candidates: CandidateRecord[];
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
const CANDIDATE_RECORDS_DIR = "candidates";

export function localRuntimeDir(workspace: string): string {
  return path.join(workspace, RUNTIME_DIR);
}

export async function loadLocalArchive(workspace: string): Promise<LocalArchiveSnapshot> {
  const index = await loadLocalArchiveIndex(workspace);
  const root = localRuntimeDir(workspace);
  const candidateFiles: Record<string, SurfaceSnapshotFile[]> = {};
  await Promise.all(index.candidates.map(async (candidate) => {
    candidateFiles[candidate.id] = await readSurfaceFiles(
      path.join(root, CANDIDATE_RECORDS_DIR, localRecordName(candidate.id), "files"),
    );
  }));
  const snapshot: LocalArchiveSnapshot = {
    ...index,
    candidateFiles,
  };
  validateLocalArchiveSnapshot(snapshot);
  return snapshot;
}

export async function loadLocalArchiveIndex(workspace: string): Promise<LocalArchiveIndex> {
  const root = localRuntimeDir(workspace);
  const [state, candidates, evaluations, runs, events] = await Promise.all([
    readJson<LocalArchiveStateFile>(path.join(root, "state.json"), {}),
    readRecords<CandidateRecord>(path.join(root, CANDIDATE_RECORDS_DIR), "record.json"),
    readFlatRecords<EvaluationScorecard>(path.join(root, "evaluations")),
    readFlatRecords<RunSummary>(path.join(root, "runs")),
    readJson<RuntimeEvent[]>(path.join(root, "events.json"), []),
  ]);
  const index: LocalArchiveIndex = {
    activeId: typeof state.activeId === "string" ? state.activeId : null,
    candidates: candidates.sort(compareLocalCandidateRecords),
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
  await fs.rm(path.join(root, CANDIDATE_RECORDS_DIR), { force: true, recursive: true });
  await fs.rm(path.join(root, "evaluations"), { force: true, recursive: true });
  await fs.rm(path.join(root, "runs"), { force: true, recursive: true });
  await Promise.all([
    fs.mkdir(path.join(root, CANDIDATE_RECORDS_DIR), { recursive: true }),
    fs.mkdir(path.join(root, "evaluations"), { recursive: true }),
    fs.mkdir(path.join(root, "runs"), { recursive: true }),
  ]);
  for (const candidate of snapshot.candidates) {
    const candidateRoot = path.join(root, CANDIDATE_RECORDS_DIR, candidate.id);
    await fs.mkdir(candidateRoot, { recursive: true });
    await writeJson(path.join(candidateRoot, "record.json"), candidateRecordWithoutDerivedFields(candidate));
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
  await writeArchivedLocalJobs(workspace, jobs, new Map());
}

export async function exportLocalRuntimeBundle(
  workspace: string,
): Promise<WorkbenchRuntimeBundle> {
  const snapshot = await loadLocalArchive(workspace);
  const jobs = (await readLocalJobs(workspace)).map(sanitizeRuntimeJobForExchange);
  const executionFiles = await Promise.all(
    jobs.map(async (job) => ({
      jobId: job.id,
      files: await readLocalExecutionFiles(workspace, job.id),
    })),
  );
  return {
    schema: "workbench.runtime.bundle.v1",
    activeId: snapshot.activeId,
    candidates: snapshot.candidates.map(sanitizeWorkbenchRuntimeCandidateForExchange),
    candidateFiles: Object.entries(snapshot.candidateFiles).map(([candidateId, files]) => ({
      candidateId,
      files: copySurfaceFiles(files),
    })),
    evaluations: snapshot.evaluations.map((evaluation) => ({ ...evaluation })),
    runs: snapshot.runs.map((run) => ({ ...run })),
    jobs,
    executionFiles,
    events: snapshot.events.map((event) => ({ ...event })),
  };
}

export async function importLocalRuntimeBundle(
  workspace: string,
  bundle: WorkbenchRuntimeBundle,
  currentBenchmarkFingerprint: string,
): Promise<WorkbenchRuntimeImportResult> {
  validateRuntimeBundleSchema(bundle);
  const snapshot = await loadLocalArchive(workspace);
  const existingJobs = (await readLocalJobs(workspace)).map(sanitizeRuntimeJobForExchange);
  let changed = false;

  const existingCandidates = snapshot.candidates.map(sanitizeWorkbenchRuntimeCandidateForExchange);
  if (JSON.stringify(existingCandidates) !== JSON.stringify(snapshot.candidates)) {
    changed = true;
  }
  const incomingCandidates = bundle.candidates.map(sanitizeWorkbenchRuntimeCandidateForExchange);
  const candidates = mergeRecordsById(existingCandidates, incomingCandidates, (candidate) => candidate.id, (didChange) => {
    changed ||= didChange;
  }, runtimeCandidatesCompatibleForExchange, mergeRuntimeCandidateForExchange).sort(compareLocalCandidateRecords);
  const candidateFiles = { ...snapshot.candidateFiles };
  for (const group of bundle.candidateFiles) {
    const candidateId = localRecordName(group.candidateId);
    const files = copySurfaceFiles(group.files);
    const existing = candidateFiles[candidateId];
    if (existing) {
      if (!workbenchSurfaceFilesEqualForExchange(existing, files)) {
        throw new Error(`Runtime history conflict for candidate files ${candidateId}.`);
      }
    } else {
      changed = true;
    }
    candidateFiles[candidateId] = files;
  }
  const activeId =
    compatibleRuntimeActiveCandidateId(candidates, bundle.activeId ?? null, currentBenchmarkFingerprint) ??
    compatibleRuntimeActiveCandidateId(candidates, snapshot.activeId, currentBenchmarkFingerprint) ??
    latestCompatibleRuntimeCandidateId(candidates, currentBenchmarkFingerprint);
  if (activeId !== snapshot.activeId) {
    changed = true;
  }
  const evaluations = mergeRecordsById(snapshot.evaluations, bundle.evaluations, (evaluation) => evaluation.id, (didChange) => {
    changed ||= didChange;
  }, runtimeEvaluationsCompatibleForExchange).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const runs = mergeRecordsById(snapshot.runs, bundle.runs, (run) => run.id, (didChange) => {
    changed ||= didChange;
  }, runtimeRunsCompatibleForExchange).sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
  const events = mergeRecordsById(snapshot.events, bundle.events, runtimeEventKey, (didChange) => {
    changed ||= didChange;
  }).sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));

  const executionFilesByJobId = new Map<string, SurfaceSnapshotFile[]>();
  await Promise.all(existingJobs.map(async (job) => {
    executionFilesByJobId.set(job.id, await readLocalExecutionFiles(workspace, job.id));
  }));
  const existingJobById = new Map(existingJobs.map((job) => [job.id, job]));
  const incomingJobById = new Map(
    bundle.jobs.map(sanitizeRuntimeJobForExchange).map((job) => [job.id, job]),
  );
  for (const group of bundle.executionFiles) {
    const jobId = localRecordName(group.jobId);
    const files = copySurfaceFiles(group.files);
    const existing = executionFilesByJobId.get(jobId);
    if (existing) {
      if (!workbenchSurfaceFilesEqualForExchange(existing, files)) {
        const existingJob = existingJobById.get(jobId) ?? null;
        const incomingJob = incomingJobById.get(jobId) ?? null;
        if (!existingJob || !incomingJob || !runtimeJobsEqualForExchange(existingJob, incomingJob)) {
          throw new Error(`Runtime history conflict for execution files ${jobId}.`);
        }
        changed = true;
      }
    } else {
      changed = true;
    }
    executionFilesByJobId.set(jobId, files);
  }
  const jobs = mergeRecordsById(
    existingJobs,
    bundle.jobs.map(sanitizeRuntimeJobForExchange),
    (job) => job.id,
    (didChange) => {
      changed ||= didChange;
    },
    runtimeJobsEqualForExchange,
  ).sort((left, right) =>
    (left.startedAt ?? left.createdAt).localeCompare(right.startedAt ?? right.createdAt) ||
    left.id.localeCompare(right.id)
  );

  await saveLocalArchive(workspace, {
    activeId,
    candidates,
    candidateFiles,
    evaluations,
    runs,
    events,
  });
  await writeArchivedLocalJobs(workspace, jobs, executionFilesByJobId);

  return {
    changed,
    stats: runtimeBundleStats({
      schema: "workbench.runtime.bundle.v1",
      activeId,
      candidates,
      candidateFiles: Object.entries(candidateFiles).map(([candidateId, files]) => ({
        candidateId,
        files,
      })),
      evaluations,
      runs,
      jobs,
      executionFiles: [...executionFilesByJobId.entries()].map(([jobId, files]) => ({
        jobId,
        files,
      })),
      events,
    }),
  };
}

export function runtimeBundleStats(
  bundle: WorkbenchRuntimeBundle,
): WorkbenchRuntimeBundleStats {
  return workbenchRuntimeBundleStats(bundle);
}

export function sanitizeRuntimeJobForExchange(
  job: HostedWorkbenchJob,
): HostedWorkbenchJob {
  return sanitizeWorkbenchRuntimeJobForExchange(job);
}

function sanitizeRuntimeJobForArchive(
  job: HostedWorkbenchJob,
): HostedWorkbenchJob {
  const {
    leaseUntil: _leaseUntil,
    wakeupLeaseUntil: _wakeupLeaseUntil,
    hostId: _hostId,
    workerId: _workerId,
    claimTokenHash: _claimTokenHash,
    ...portable
  } = job;
  return { ...portable };
}

async function writeArchivedLocalJobs(
  workspace: string,
  jobs: readonly HostedWorkbenchJob[],
  executionFilesByJobId: ReadonlyMap<string, readonly SurfaceSnapshotFile[]>,
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
    const sanitizedJob = sanitizeRuntimeJobForArchive(job);
    const safeJobId = localRecordName(job.id);
    const explicitOutputFiles = executionFilesByJobId.get(job.id);
    const traceSourceFiles = filterArchivedExecutionFiles(completedJobOutputFiles(sanitizedJob));
    const outputFiles = explicitOutputFiles
      ? copySurfaceFiles(explicitOutputFiles)
      : selectExecutionOutputFilesForInspection({
          purpose: readExecutionPurpose(sanitizedJob),
          files: traceSourceFiles,
          output: jsonRecord(sanitizedJob.output),
        });
    await writeJson(
      path.join(jobsDir, `${safeJobId}.json`),
      archivedLocalJob(
        sanitizedJob,
        outputFiles,
        traceSourceFiles.length > 0 ? traceSourceFiles : outputFiles,
      ),
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

export async function readLocalCandidateRecord(
  workspace: string,
  candidateId: string,
): Promise<CandidateRecord> {
  const candidate = await readJson<CandidateRecord | null>(
    path.join(localRuntimeDir(workspace), CANDIDATE_RECORDS_DIR, localRecordName(candidateId), "record.json"),
    null,
  );
  if (!candidate) {
    throw new Error(`Candidate not found: ${candidateId}`);
  }
  validateCandidateRecord(candidate);
  return candidate;
}

export async function readLocalCandidateFilesForId(
  workspace: string,
  candidateId: string,
): Promise<SurfaceSnapshotFile[]> {
  await readLocalCandidateRecord(workspace, candidateId);
  return await readSurfaceFiles(
    path.join(localRuntimeDir(workspace), CANDIDATE_RECORDS_DIR, localRecordName(candidateId), "files"),
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
    ].sort(compareLocalCandidateRecords),
    candidateFiles: {
      ...snapshot.candidateFiles,
      [candidate.id]: files.map((file) => ({ ...file })),
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

export function upsertLocalRun(
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
  validateLocalArchiveIndex(snapshot);
}

function validateRuntimeBundleSchema(bundle: WorkbenchRuntimeBundle): void {
  if (!bundle || bundle.schema !== "workbench.runtime.bundle.v1") {
    throw new Error("Unsupported Workbench runtime bundle.");
  }
}

function mergeRecordsById<T>(
  existing: readonly T[],
  incoming: readonly T[],
  idFor: (record: T) => string,
  markChanged: (changed: boolean) => void,
  equal: (left: T, right: T) => boolean = runtimeRecordsEqual,
  merge: (left: T, right: T) => T = (_left, right) => right,
): T[] {
  const records = new Map<string, T>();
  for (const record of existing) {
    records.set(localRecordName(idFor(record)), record);
  }
  for (const record of incoming) {
    const id = localRecordName(idFor(record));
    const previous = records.get(id);
    if (!previous) {
      markChanged(true);
      records.set(id, record);
      continue;
    }
    if (!equal(previous, record)) {
      throw new Error(`Runtime history conflict for id ${id}.`);
    }
    const merged = merge(previous, record);
    if (!runtimeRecordsEqual(previous, merged)) {
      markChanged(true);
    }
    records.set(id, merged);
  }
  return [...records.values()];
}

function runtimeRecordsEqual<T>(left: T, right: T): boolean {
  return JSON.stringify(canonicalRuntimeJson(left)) ===
    JSON.stringify(canonicalRuntimeJson(right));
}

function runtimeJobsEqualForExchange(
  left: HostedWorkbenchJob,
  right: HostedWorkbenchJob,
): boolean {
  if (runtimeRecordsEqual(runtimeComparableJob(left), runtimeComparableJob(right))) {
    return true;
  }
  return runtimeRecordsEqual(
    runtimeJobIdentityForExchange(left),
    runtimeJobIdentityForExchange(right),
  );
}

function runtimeComparableJob(job: HostedWorkbenchJob): HostedWorkbenchJob {
  const comparable = sanitizeRuntimeJobForExchange(job);
  const output = comparable.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return comparable;
  }
  const {
    files: _files,
    fileSet: _fileSet,
    ...portableOutput
  } = output as Record<string, Json>;
  return {
    ...comparable,
    output: portableOutput as Json,
  };
}

function runtimeCandidatesCompatibleForExchange(
  left: CandidateRecord,
  right: CandidateRecord,
): boolean {
  return runtimeRecordsEqual(
    runtimeCandidateIdentityForExchange(left),
    runtimeCandidateIdentityForExchange(right),
  );
}

function runtimeCandidateIdentityForExchange(candidate: CandidateRecord): unknown {
  const {
    eval: _eval,
    prompt: _prompt,
    meta: _meta,
    status: _status,
    usage: _usage,
    visibility: _visibility,
    ownerUserId: _ownerUserId,
    ownerUsername: _ownerUsername,
    metrics: _metrics,
    candidateRunId: _candidateRunId,
    candidateRunName: _candidateRunName,
    ...identity
  } = candidate as CandidateRecord & {
    metrics?: unknown;
    candidateRunId?: unknown;
    candidateRunName?: unknown;
  };
  return identity;
}

function mergeRuntimeCandidateForExchange(
  left: CandidateRecord,
  right: CandidateRecord,
): CandidateRecord {
  return {
    ...left,
    ...right,
    ...(right.eval ? { eval: right.eval } : left.eval ? { eval: left.eval } : {}),
    ...(right.prompt ? { prompt: right.prompt } : left.prompt ? { prompt: left.prompt } : {}),
    ...(right.meta !== undefined ? { meta: right.meta } : left.meta !== undefined ? { meta: left.meta } : {}),
    ...(right.usage ? { usage: right.usage } : left.usage ? { usage: left.usage } : {}),
    visibility: right.visibility ?? left.visibility,
  };
}

function runtimeEvaluationsCompatibleForExchange(
  left: EvaluationScorecard,
  right: EvaluationScorecard,
): boolean {
  if (runtimeRecordsEqual(left, right)) {
    return true;
  }
  return runtimeRecordsEqual(
    runtimeEvaluationIdentityForExchange(left),
    runtimeEvaluationIdentityForExchange(right),
  );
}

function runtimeEvaluationIdentityForExchange(evaluation: EvaluationScorecard): unknown {
  return {
    id: evaluation.id,
    runId: evaluation.runId,
    candidateId: evaluation.candidateId,
    candidateVersion: evaluation.candidateVersion,
    benchmarkFingerprint: evaluation.benchmarkFingerprint,
    candidateFingerprint: evaluation.candidateFingerprint,
  };
}

function runtimeRunsCompatibleForExchange(
  left: RunSummary,
  right: RunSummary,
): boolean {
  if (runtimeRecordsEqual(left, right)) {
    return true;
  }
  return runtimeRecordsEqual(
    runtimeRunIdentityForExchange(left),
    runtimeRunIdentityForExchange(right),
  );
}

function runtimeRunIdentityForExchange(run: RunSummary): unknown {
  return {
    id: run.id,
    workflow: run.workflow,
    benchmarkFingerprint: run.benchmarkFingerprint,
    candidateId: run.candidateId ?? null,
    outputCandidateId: run.outputCandidateId ?? null,
    engineRun: run.engineRun,
    improver: run.improver,
    strategy: run.strategy,
    budget: run.budget,
    samples: run.samples,
    attemptsRequested: run.attemptsRequested,
  };
}

function runtimeJobIdentityForExchange(job: HostedWorkbenchJob): unknown {
  return {
    id: job.id,
    runId: job.runId,
    candidateId: job.candidateId,
    kind: job.kind,
    attempt: job.attempt,
  };
}

function compatibleRuntimeActiveCandidateId(
  candidates: readonly CandidateRecord[],
  candidateId: string | null,
  benchmarkFingerprint: string,
): string | null {
  if (!candidateId) {
    return null;
  }
  const candidate = candidates.find((entry) => entry.id === candidateId) ?? null;
  return candidate?.benchmarkFingerprint === benchmarkFingerprint ? candidate.id : null;
}

function latestCompatibleRuntimeCandidateId(
  candidates: readonly CandidateRecord[],
  benchmarkFingerprint: string,
): string | null {
  return candidates
    .filter((candidate) =>
      candidate.benchmarkFingerprint === benchmarkFingerprint &&
      candidate.status === "evaluated"
    )
    .at(-1)?.id ?? null;
}

function canonicalRuntimeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalRuntimeJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalRuntimeJson((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function runtimeEventKey(event: RuntimeEvent): string {
  return [
    event.runId ?? "_",
    event.jobId ?? "_",
    event.at,
    event.id,
  ].join("#");
}

function copySurfaceFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  return files.map((file) => ({ ...file }));
}

function validateLocalArchiveIndex(snapshot: LocalArchiveIndex): void {
  const candidateIds = new Set(snapshot.candidates.map((candidate) => candidate.id));
  if (snapshot.activeId && !candidateIds.has(snapshot.activeId)) {
    throw new Error(`Active candidate not found: ${snapshot.activeId}`);
  }
  for (const candidate of snapshot.candidates) {
    validateCandidateRecord(candidate);
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
    validateEvaluationRecord(evaluation);
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
    validateRunRecord(run);
  }
}

function validateCandidateRecord(candidate: CandidateRecord): void {
  requireArchiveString(candidate.id, "candidate.id");
  requireArchivePositiveInteger(candidate.version, `candidate ${candidate.id}.version`);
  requireArchivePositiveInteger(candidate.ordinal, `candidate ${candidate.id}.ordinal`);
  requireArchiveString(candidate.benchmarkFingerprint, `candidate ${candidate.id}.benchmarkFingerprint`);
  requireArchiveString(candidate.candidateFingerprint, `candidate ${candidate.id}.candidateFingerprint`);
  if (candidate.visibility !== "private" && candidate.visibility !== "public") {
    throw new Error(`candidate ${candidate.id}.visibility must be private or public.`);
  }
  requireArchiveString(candidate.createdAt, `candidate ${candidate.id}.createdAt`);
}

function validateEvaluationRecord(evaluation: EvaluationScorecard): void {
  requireArchiveString(evaluation.id, "evaluation.id");
  requireArchiveString(evaluation.runId, `evaluation ${evaluation.id}.runId`);
  requireArchiveString(evaluation.benchmarkFingerprint, `evaluation ${evaluation.id}.benchmarkFingerprint`);
  requireArchiveString(evaluation.candidateFingerprint, `evaluation ${evaluation.id}.candidateFingerprint`);
  requireArchiveString(evaluation.candidateId, `evaluation ${evaluation.id}.candidateId`);
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

function requireArchivePositiveInteger(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function compareLocalCandidateRecords(
  left: CandidateRecord,
  right: CandidateRecord,
): number {
  return left.version - right.version ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id);
}

function archivedLocalJob(
  job: HostedWorkbenchJob,
  outputFiles: readonly SurfaceSnapshotFile[],
  traceSourceFiles: readonly SurfaceSnapshotFile[],
): HostedWorkbenchJob & { trace: WorkbenchExecutionTrace; traceSessions: WorkbenchTraceSession[] } {
  const output = jsonRecord(job.output);
  const existingTrace = readExistingTrace(job);
  const existingTraceSessions = readExistingTraceSessions(job);
  const traceSessions = existingTraceSessions.length > 0
    ? existingTraceSessions
    : buildLocalJobTraceSessions(job, traceSourceFiles);
  return {
    ...job,
    ...(Object.keys(output).length > 0
      ? { output: { ...output, files: traceSourceFiles } as unknown as Json }
      : {}),
    trace: existingTrace ?? buildLocalJobTrace(job),
    traceSessions,
  };
}

function readExistingTrace(job: HostedWorkbenchJob): WorkbenchExecutionTrace | null {
  const trace = (job as LocalArchivedJob).trace;
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
    return null;
  }
  return {
    trace_id: typeof trace.trace_id === "string" && trace.trace_id.length > 0
      ? trace.trace_id
      : job.id,
    spans: Array.isArray(trace.spans) ? trace.spans : [],
    events: Array.isArray(trace.events) ? trace.events : [],
    summaries: Array.isArray(trace.summaries) ? trace.summaries : [],
  };
}

function readExistingTraceSessions(job: HostedWorkbenchJob): WorkbenchTraceSession[] {
  const sessions = (job as LocalArchivedJob).traceSessions;
  if (!Array.isArray(sessions)) {
    return [];
  }
  return sessions.map((session) => ({ ...session }));
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
  const role = purpose === "improve" ? "improver" : "engine";
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
    fallbackRole: purpose === "improve" ? "improver" : "engine",
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
    : Object.keys(jsonRecord(record.improver)).length > 0
      ? jsonRecord(record.improver)
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
