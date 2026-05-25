import type {
  SubjectCaseReview,
  HostedWorkbenchJob,
  HostedWorkbenchJobStatus,
  Json,
  WorkbenchExecutionEventRole,
  WorkbenchExecutionSpec,
  WorkbenchExecutionTrace,
  WorkbenchExecutionEvidence,
  WorkbenchTraceSession,
} from "@workbench-ai/workbench-contract";

import { mergeWorkbenchExecutionTracesByJob } from "./execution-traces.ts";

export function buildSubjectCaseExecutionRefs(args: {
  jobs: readonly HostedWorkbenchJob[];
  subjectId: string;
  caseId: string;
  sampleIndex?: number;
}): SubjectCaseReview["executions"] {
  const groups = new Map<string, HostedWorkbenchJob[]>();
  for (const job of args.jobs) {
    const kind = readWorkbenchExecutionPurpose(job);
    const jobSubjectId =
      job.subjectId ?? readWorkbenchExecutionMetadataString(job, "subjectId");
    const jobCaseId = readWorkbenchExecutionMetadataString(job, "caseId");
    if (
      jobSubjectId === args.subjectId &&
      kind === "attempt" &&
      caseReviewCaseIdsMatch(jobCaseId, args.caseId) &&
      caseReviewSampleIndicesMatch(
        readWorkbenchExecutionMetadataNumber(job, "sampleIndex"),
        args.sampleIndex,
      )
    ) {
      const key = [
        job.runId,
        kind,
        jobCaseId ?? "",
        readWorkbenchExecutionMetadataNumber(job, "sampleIndex") ?? "",
      ].join("\0");
      groups.set(key, [...(groups.get(key) ?? []), job]);
    }
  }

  const executions = [...groups.values()]
    .map((group) => group.slice().sort(compareWorkbenchExecutionJobs))
    .flatMap((group): SubjectCaseReview["executions"] => {
      const first = group[0];
      if (!first) {
        return [];
      }
      const kind = readWorkbenchExecutionPurpose(first);
      if (kind !== "attempt") {
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
        kind,
        role: "engine",
        status: resolveWorkbenchJobGroupStatus(group),
        jobIds: group.map((job) => job.id),
        executionIds: group.flatMap((job) => {
          const executionId = readWorkbenchExecutionId(job);
          return executionId ? [executionId] : [];
        }),
        createdAt: minTimestamp(group.map((job) => job.createdAt)) ?? first.createdAt,
        ...(startedAt ? { startedAt } : {}),
        ...(finishedAt ? { finishedAt } : {}),
        ...(durationMs !== null ? { durationMs } : {}),
        ...optionalString("caseId", readWorkbenchExecutionMetadataString(first, "caseId")),
        ...optionalNumber("sampleIndex", readWorkbenchExecutionMetadataNumber(first, "sampleIndex")),
        ...optionalNumber("attemptIndex", readWorkbenchExecutionMetadataNumber(first, "attemptIndex")),
      }];
    })
    .sort(compareSubjectCaseExecutions);
  return selectCurrentExecutionRun(executions);
}

export function buildWorkbenchExecutionEvidence(args: {
  jobs: readonly HostedWorkbenchJob[];
  traceIdPrefix: string;
  traceForJob: (
    job: HostedWorkbenchJob,
    role: WorkbenchExecutionEventRole,
  ) => WorkbenchExecutionTrace;
  traceSessionsForJob?: (
    job: HostedWorkbenchJob,
    role: WorkbenchExecutionEventRole,
  ) => WorkbenchTraceSession[];
}): WorkbenchExecutionEvidence[] {
  const groups = new Map<string, HostedWorkbenchJob[]>();
  for (const job of args.jobs) {
    if (isBaselineMaterializationJob(job)) {
      continue;
    }
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
      readWorkbenchExecutionMetadataNumber(job, "attemptIndex") ?? "",
    ].join("\0");
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups.values()]
    .map((group) => group.slice().sort(compareWorkbenchTraceJobs))
    .flatMap((group): WorkbenchExecutionEvidence[] => {
      const first = group[0];
      if (!first) {
        return [];
      }
      const purpose = readWorkbenchExecutionPurpose(first);
      if (!purpose) {
        return [];
      }
      const role = traceRoleForPurpose(purpose);
      const sessions = group.flatMap((job) =>
        args.traceSessionsForJob
          ? args.traceSessionsForJob(job, role)
          : []
      );
      const jobIds = group.map((job) => job.id);
      const executionIds = group.flatMap((job) => {
        const executionId = readWorkbenchExecutionId(job);
        return executionId ? [executionId] : [];
      });
      return [{
        id: [
          purpose,
          first.runId,
          readWorkbenchExecutionMetadataString(first, "caseId") ?? "current",
          readWorkbenchExecutionMetadataNumber(first, "sampleIndex") ?? "sample",
          readWorkbenchExecutionMetadataNumber(first, "attemptIndex") ?? "attempt",
          jobIds.join("_"),
        ].join(":"),
        kind: purpose,
        executionId: group.length === 1 ? readWorkbenchExecutionId(first) : null,
        role,
        status: resolveWorkbenchJobGroupStatus(group),
        jobIds,
        executionIds,
        ...(first.subjectId ? { subjectId: first.subjectId } : {}),
        ...optionalString("caseId", readWorkbenchExecutionMetadataString(first, "caseId")),
        ...optionalNumber("sampleIndex", readWorkbenchExecutionMetadataNumber(first, "sampleIndex")),
        ...optionalNumber("attemptIndex", readWorkbenchExecutionMetadataNumber(first, "attemptIndex")),
        sessions,
        trace: mergeWorkbenchExecutionTracesByJob({
          traceIdPrefix: args.traceIdPrefix,
          stageId: purpose,
          jobs: [
            ...group.map((job) => ({
              id: job.id,
              trace: args.traceForJob(job, role),
            })),
            ...sessions.map((session) => ({
                id: session.id,
                jobId: session.jobId,
                trace: session.trace,
              })),
          ],
        }),
      }];
    })
    .sort(compareWorkbenchExecutionEvidence);
}

export function readWorkbenchExecutionPurpose(
  job: HostedWorkbenchJob,
): WorkbenchExecutionSpec["purpose"] | null {
  if (job.kind !== "execute") {
    return null;
  }
  const purpose = readExecutionRecord(job)?.purpose;
  return purpose === "improve" || purpose === "attempt"
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

export function isWorkbenchExecutionActive(
  execution: SubjectCaseReview["executions"][number],
): boolean {
  return execution.status === "queued" || execution.status === "running";
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

function isBaselineMaterializationJob(job: HostedWorkbenchJob): boolean {
  const input = asRecord(job.input);
  const execution = asRecord(input?.execution);
  const metadata = asRecord(execution?.metadata);
  return metadata?.baseline === true || input?.baseline === true;
}

function caseReviewCaseIdsMatch(
  jobCaseId: string | null,
  requestedCaseId: string,
): boolean {
  return Boolean(jobCaseId) &&
    (jobCaseId === requestedCaseId || requestedCaseId.startsWith(`${jobCaseId}__`));
}

function caseReviewSampleIndicesMatch(
  jobSampleIndex: number | null,
  reviewSampleIndex: number | undefined,
): boolean {
  return typeof reviewSampleIndex !== "number" || jobSampleIndex === reviewSampleIndex;
}

function selectCurrentExecutionRun(
  executions: SubjectCaseReview["executions"],
): SubjectCaseReview["executions"] {
  if (executions.length <= 1) {
    return executions;
  }
  const activeRunId = executions
    .filter(isWorkbenchExecutionActive)
    .sort(compareExecutionRecency)[0]?.runId;
  const selectedRunId = activeRunId ?? executions.slice().sort(compareExecutionRecency)[0]?.runId;
  return selectedRunId
    ? executions.filter((execution) => execution.runId === selectedRunId)
    : executions;
}

function compareSubjectCaseExecutions(
  left: SubjectCaseReview["executions"][number],
  right: SubjectCaseReview["executions"][number],
): number {
  return (
    executionKindOrder(left.kind) - executionKindOrder(right.kind) ||
    (left.sampleIndex ?? -1) - (right.sampleIndex ?? -1) ||
    readExecutionRecencyMs(right) - readExecutionRecencyMs(left)
  );
}

function compareExecutionRecency(
  left: SubjectCaseReview["executions"][number],
  right: SubjectCaseReview["executions"][number],
): number {
  return readExecutionRecencyMs(right) - readExecutionRecencyMs(left);
}

function compareWorkbenchExecutionJobs(
  left: HostedWorkbenchJob,
  right: HostedWorkbenchJob,
): number {
  return (
    executionKindOrder(readWorkbenchExecutionPurpose(left)) -
      executionKindOrder(readWorkbenchExecutionPurpose(right)) ||
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
    executionKindOrder(readWorkbenchExecutionPurpose(left)) -
      executionKindOrder(readWorkbenchExecutionPurpose(right)) ||
    String(readWorkbenchExecutionMetadataString(left, "caseId") ?? "").localeCompare(
      String(readWorkbenchExecutionMetadataString(right, "caseId") ?? ""),
    ) ||
    (readWorkbenchExecutionMetadataNumber(left, "sampleIndex") ?? -1) -
      (readWorkbenchExecutionMetadataNumber(right, "sampleIndex") ?? -1) ||
    (readWorkbenchExecutionMetadataNumber(left, "attemptIndex") ?? -1) -
      (readWorkbenchExecutionMetadataNumber(right, "attemptIndex") ?? -1) ||
    left.id.localeCompare(right.id)
  );
}

function compareWorkbenchExecutionEvidence(
  left: WorkbenchExecutionEvidence,
  right: WorkbenchExecutionEvidence,
): number {
  return (
    executionKindOrder(left.kind) - executionKindOrder(right.kind) ||
    String(left.caseId ?? "").localeCompare(String(right.caseId ?? "")) ||
    (left.sampleIndex ?? -1) - (right.sampleIndex ?? -1) ||
    (left.attemptIndex ?? -1) - (right.attemptIndex ?? -1) ||
    String(left.jobIds[0] ?? "").localeCompare(String(right.jobIds[0] ?? ""))
  );
}

function traceRoleForPurpose(
  purpose: WorkbenchExecutionSpec["purpose"],
): WorkbenchExecutionEventRole {
  if (purpose === "improve") {
    return "optimizer";
  }
  return "engine";
}

function executionKindOrder(kind: string | null): number {
  if (kind === "improve") {
    return 0;
  }
  if (kind === "attempt") {
    return 1;
  }
  return 3;
}

function readExecutionRecencyMs(execution: SubjectCaseReview["executions"][number]): number {
  return (
    parseTimestampMs(execution.finishedAt) ??
    parseTimestampMs(execution.startedAt) ??
    parseTimestampMs(execution.createdAt) ??
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

function optionalString<K extends keyof WorkbenchExecutionEvidence | keyof SubjectCaseReview["executions"][number]>(
  key: K,
  value: string | null | undefined,
): Partial<Record<K, string>> {
  return value ? { [key]: value } as Partial<Record<K, string>> : {};
}

function optionalNumber<K extends keyof WorkbenchExecutionEvidence | keyof SubjectCaseReview["executions"][number]>(
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
