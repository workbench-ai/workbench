import type {
  SubjectCaseReview,
  HostedWorkbenchJob,
  HostedWorkbenchJobStatus,
  Json,
  WorkbenchExecutionEventRole,
  WorkbenchExecutionSpec,
  WorkbenchExecutionTrace,
  WorkbenchTracePhase,
} from "@workbench-ai/workbench-contract";

import { mergeWorkbenchExecutionTracesByJob } from "./execution-traces.ts";

export function buildSubjectCasePhaseRefs(args: {
  jobs: readonly HostedWorkbenchJob[];
  subjectId: string;
  caseId: string;
  sampleIndex?: number;
}): SubjectCaseReview["phases"] {
  const groups = new Map<string, HostedWorkbenchJob[]>();
  for (const job of args.jobs) {
    const phase = readWorkbenchExecutionPurpose(job);
    const jobSubjectId =
      job.subjectId ?? readWorkbenchExecutionMetadataString(job, "subjectId");
    const jobCaseId = readWorkbenchExecutionMetadataString(job, "caseId");
	    if (
	      jobSubjectId === args.subjectId &&
	      phase === "trial" &&
      taskReviewCaseIdsMatch(jobCaseId, args.caseId) &&
      taskReviewSampleIndicesMatch(
        readWorkbenchExecutionMetadataNumber(job, "sampleIndex"),
        args.sampleIndex,
      )
    ) {
      const key = [
        job.runId,
        phase,
        jobCaseId ?? "",
        readWorkbenchExecutionMetadataNumber(job, "sampleIndex") ?? "",
      ].join("\0");
      groups.set(key, [...(groups.get(key) ?? []), job]);
    }
  }

  const phases = [...groups.values()]
    .map((group) => group.slice().sort(compareWorkbenchPhaseJobs))
    .flatMap((group): SubjectCaseReview["phases"] => {
      const first = group[0];
      if (!first) {
        return [];
      }
	      const phase = readWorkbenchExecutionPurpose(first);
	      if (phase !== "trial") {
	        return [];
	      }
      const startedAt = minTimestamp(group.map((job) => job.startedAt));
      const finishedAt = maxTimestamp(group.map((job) => job.finishedAt));
      const durationMs =
        startedAt && finishedAt
          ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
          : null;
      return [{
	        runId: first.runId,
	        phase,
	        role: "runner",
        status: resolveWorkbenchJobGroupStatus(group),
        jobIds: group.map((job) => job.id),
        createdAt: minTimestamp(group.map((job) => job.createdAt)) ?? first.createdAt,
        ...(startedAt ? { startedAt } : {}),
        ...(finishedAt ? { finishedAt } : {}),
        ...(durationMs !== null ? { durationMs } : {}),
        ...optionalNumber("sampleIndex", readWorkbenchExecutionMetadataNumber(first, "sampleIndex")),
      }];
    })
    .sort(compareSubjectCasePhases);
  return selectCurrentPhaseRun(phases);
}

export function buildWorkbenchTracePhases(args: {
  jobs: readonly HostedWorkbenchJob[];
  traceIdPrefix: string;
  traceForJob: (
    job: HostedWorkbenchJob,
    role: WorkbenchExecutionEventRole,
  ) => WorkbenchExecutionTrace;
}): WorkbenchTracePhase[] {
  const groups = new Map<string, HostedWorkbenchJob[]>();
  for (const job of args.jobs) {
    const purpose = readWorkbenchExecutionPurpose(job);
    if (!purpose) {
      continue;
    }
    const key = [
      job.runId,
      purpose,
      job.subjectId ?? readWorkbenchExecutionMetadataString(job, "subjectId") ?? "",
      readWorkbenchExecutionMetadataString(job, "caseId") ?? "",
      readWorkbenchExecutionMetadataNumber(job, "sampleIndex") ?? "",
      readWorkbenchExecutionMetadataNumber(job, "trialIndex") ?? "",
    ].join("\0");
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups.values()]
    .map((group) => group.slice().sort(compareWorkbenchTraceJobs))
    .flatMap((group): WorkbenchTracePhase[] => {
      const first = group[0];
      if (!first) {
        return [];
      }
      const purpose = readWorkbenchExecutionPurpose(first);
      if (!purpose) {
        return [];
      }
      const role = traceRoleForPurpose(purpose);
      return [{
        phase: purpose,
        executionId: group.length === 1 ? readWorkbenchExecutionId(first) : null,
        role,
        status: resolveWorkbenchJobGroupStatus(group),
        jobIds: group.map((job) => job.id),
        ...(first.subjectId ? { subjectId: first.subjectId } : {}),
        ...optionalString("caseId", readWorkbenchExecutionMetadataString(first, "caseId")),
        ...optionalNumber("sampleIndex", readWorkbenchExecutionMetadataNumber(first, "sampleIndex")),
        ...optionalNumber("trialIndex", readWorkbenchExecutionMetadataNumber(first, "trialIndex")),
        trace: mergeWorkbenchExecutionTracesByJob({
          traceIdPrefix: args.traceIdPrefix,
          stageId: purpose,
          jobs: group.map((job) => ({
            id: job.id,
            trace: args.traceForJob(job, role),
          })),
        }),
      }];
    })
    .sort(compareWorkbenchTracePhases);
}

export function readWorkbenchExecutionPurpose(
  job: HostedWorkbenchJob,
): WorkbenchExecutionSpec["purpose"] | null {
  if (job.kind !== "execute") {
    return null;
  }
	  const purpose = readExecutionRecord(job)?.purpose;
	  return purpose === "improve" || purpose === "trial"
	    ? purpose
	    : null;
}

export function readWorkbenchExecutionId(job: HostedWorkbenchJob): string | null {
  const id = readExecutionRecord(job)?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function readWorkbenchExecutionMetadataString(
  job: HostedWorkbenchJob,
  key: string,
): string | null {
  const raw = readWorkbenchExecutionMetadataValue(job, key);
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export function readWorkbenchExecutionMetadataNumber(
  job: HostedWorkbenchJob,
  key: string,
): number | null {
  const raw = readWorkbenchExecutionMetadataValue(job, key);
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

export function isWorkbenchPhaseActive(
  phase: SubjectCaseReview["phases"][number],
): boolean {
  return phase.status === "queued" || phase.status === "running";
}

export function resolveWorkbenchJobGroupStatus(
  jobs: readonly { status: HostedWorkbenchJobStatus }[],
): HostedWorkbenchJobStatus {
  if (jobs.some((job) => job.status === "running")) {
    return "running";
  }
  if (jobs.some((job) => job.status === "queued")) {
    return "queued";
  }
  if (jobs.some((job) => job.status === "failed")) {
    return "failed";
  }
  if (jobs.some((job) => job.status === "cancelled")) {
    return "cancelled";
  }
  return "succeeded";
}

function readWorkbenchExecutionMetadataValue(
  job: HostedWorkbenchJob,
  key: string,
): unknown {
  const input = asRecord(job.input);
  const execution = asRecord(input?.execution);
  const metadata = asRecord(execution?.metadata);
  return metadata?.[key] ?? input?.[key] ?? null;
}

function readExecutionRecord(job: HostedWorkbenchJob): Record<string, unknown> | null {
  const input = asRecord(job.input);
  return asRecord(input?.execution);
}

function taskReviewCaseIdsMatch(
  jobCaseId: string | null,
  reviewCaseId: string,
): boolean {
  return Boolean(jobCaseId) &&
    (jobCaseId === reviewCaseId || reviewCaseId.startsWith(`${jobCaseId}__`));
}

function taskReviewSampleIndicesMatch(
  jobSampleIndex: number | null,
  reviewSampleIndex: number | undefined,
): boolean {
  return typeof reviewSampleIndex !== "number" || jobSampleIndex === reviewSampleIndex;
}

function selectCurrentPhaseRun(
  phases: SubjectCaseReview["phases"],
): SubjectCaseReview["phases"] {
  if (phases.length <= 1) {
    return phases;
  }
  const activeRunId = phases
    .filter(isWorkbenchPhaseActive)
    .sort(comparePhaseRecency)[0]?.runId;
  const selectedRunId = activeRunId ?? phases.slice().sort(comparePhaseRecency)[0]?.runId;
  return selectedRunId
    ? phases.filter((phase) => phase.runId === selectedRunId)
    : phases;
}

function compareSubjectCasePhases(
  left: SubjectCaseReview["phases"][number],
  right: SubjectCaseReview["phases"][number],
): number {
  return (
    phasePurposeOrder(left.phase) - phasePurposeOrder(right.phase) ||
    (left.sampleIndex ?? -1) - (right.sampleIndex ?? -1) ||
    readPhaseRecencyMs(right) - readPhaseRecencyMs(left)
  );
}

function comparePhaseRecency(
  left: SubjectCaseReview["phases"][number],
  right: SubjectCaseReview["phases"][number],
): number {
  return readPhaseRecencyMs(right) - readPhaseRecencyMs(left);
}

function compareWorkbenchPhaseJobs(
  left: HostedWorkbenchJob,
  right: HostedWorkbenchJob,
): number {
  return (
    phasePurposeOrder(readWorkbenchExecutionPurpose(left)) -
      phasePurposeOrder(readWorkbenchExecutionPurpose(right)) ||
    (readWorkbenchExecutionMetadataNumber(left, "sampleIndex") ?? -1) -
      (readWorkbenchExecutionMetadataNumber(right, "sampleIndex") ?? -1) ||
    readJobRecencyMs(right) - readJobRecencyMs(left) ||
    left.id.localeCompare(right.id)
  );
}

function compareWorkbenchTraceJobs(
  left: HostedWorkbenchJob,
  right: HostedWorkbenchJob,
): number {
  return (
    phasePurposeOrder(readWorkbenchExecutionPurpose(left)) -
      phasePurposeOrder(readWorkbenchExecutionPurpose(right)) ||
    String(readWorkbenchExecutionMetadataString(left, "caseId") ?? "").localeCompare(
      String(readWorkbenchExecutionMetadataString(right, "caseId") ?? ""),
    ) ||
    (readWorkbenchExecutionMetadataNumber(left, "sampleIndex") ?? -1) -
      (readWorkbenchExecutionMetadataNumber(right, "sampleIndex") ?? -1) ||
    (readWorkbenchExecutionMetadataNumber(left, "trialIndex") ?? -1) -
      (readWorkbenchExecutionMetadataNumber(right, "trialIndex") ?? -1) ||
    left.id.localeCompare(right.id)
  );
}

function compareWorkbenchTracePhases(
  left: WorkbenchTracePhase,
  right: WorkbenchTracePhase,
): number {
  return (
    phasePurposeOrder(left.phase) - phasePurposeOrder(right.phase) ||
    String(left.caseId ?? "").localeCompare(String(right.caseId ?? "")) ||
    (left.sampleIndex ?? -1) - (right.sampleIndex ?? -1) ||
    (left.trialIndex ?? -1) - (right.trialIndex ?? -1) ||
    String(left.jobIds[0] ?? "").localeCompare(String(right.jobIds[0] ?? ""))
  );
}

function traceRoleForPurpose(
  purpose: WorkbenchExecutionSpec["purpose"],
): WorkbenchExecutionEventRole {
	  if (purpose === "improve") {
	    return "optimizer";
	  }
	  return "runner";
}

function phasePurposeOrder(purpose: string | null): number {
	  if (purpose === "improve") {
	    return 0;
	  }
	  if (purpose === "trial") {
	    return 1;
	  }
	  return 3;
}

function readPhaseRecencyMs(phase: SubjectCaseReview["phases"][number]): number {
  return (
    parseTimestampMs(phase.finishedAt) ??
    parseTimestampMs(phase.startedAt) ??
    parseTimestampMs(phase.createdAt) ??
    0
  );
}

function readJobRecencyMs(job: HostedWorkbenchJob): number {
  return (
    parseTimestampMs(job.finishedAt) ??
    parseTimestampMs(job.startedAt) ??
    parseTimestampMs(job.updatedAt) ??
    parseTimestampMs(job.createdAt) ??
    0
  );
}

function minTimestamp(values: readonly (string | undefined)[]): string | null {
  const sorted = values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort();
  return sorted[0] ?? null;
}

function maxTimestamp(values: readonly (string | undefined)[]): string | null {
  const sorted = values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort();
  return sorted[sorted.length - 1] ?? null;
}

function parseTimestampMs(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalString<K extends keyof WorkbenchTracePhase | keyof SubjectCaseReview["phases"][number]>(
  key: K,
  value: string | null | undefined,
): Partial<Record<K, string>> {
  return value ? { [key]: value } as Partial<Record<K, string>> : {};
}

function optionalNumber<K extends keyof WorkbenchTracePhase | keyof SubjectCaseReview["phases"][number]>(
  key: K,
  value: number | null | undefined,
): Partial<Record<K, number>> {
  return value == null ? {} : { [key]: value } as Partial<Record<K, number>>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
