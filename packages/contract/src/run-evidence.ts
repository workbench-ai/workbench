import type {
  WorkbenchInspectionSnapshot,
  WorkbenchJob,
  WorkbenchJobDependency,
  WorkbenchJobReport,
  WorkbenchJobRoleReport,
  WorkbenchJobRole,
  WorkbenchJobStatus,
  WorkbenchRun,
  WorkbenchRunStatus,
  WorkbenchSampleCoverage,
  WorkbenchTrace,
  UsageSummary,
} from "./index";
import { compareWorkbenchNaturalText } from "./ordering.js";

export interface WorkbenchRunEvidenceView {
  runId: string;
  measurements: WorkbenchRunEvidenceMeasurementResult[];
  jobGroups: WorkbenchRunEvidenceJobGroupResult[];
  cases: WorkbenchRunEvidenceCaseResult[];
  jobs: WorkbenchRunEvidenceJob[];
}

export function workbenchRunOwnsJob(
  run: Pick<WorkbenchRun, "jobIds">,
  job: Pick<WorkbenchJob, "id">,
): boolean {
  return run.jobIds.includes(job.id);
}

export function workbenchRunStatusFromJobs(
  jobs: readonly Pick<WorkbenchJob, "status">[],
  fallback: WorkbenchRunStatus = "succeeded",
): WorkbenchRunStatus {
  if (jobs.length === 0) {
    return fallback;
  }
  for (const status of ["running", "queued", "failed", "canceled"] as const) {
    if (jobs.some((job) => job.status === status)) {
      return status;
    }
  }
  return "succeeded";
}

export interface WorkbenchRunEvidenceSkillIdentity {
  skillName: string;
  skillBundleHash: string;
  versionId: string;
  evalHash: string;
  skillLabel: string;
  skillVersionId?: string;
}

export interface WorkbenchRunEvidenceAgentIdentity extends WorkbenchRunEvidenceSkillIdentity {
  agentName: string;
  agentHash: string;
  agentLabel: string;
  adapter: string;
  model?: string;
}

export interface WorkbenchRunEvidenceMeasurementResult extends WorkbenchRunEvidenceAgentIdentity {
  status: WorkbenchRunStatus;
  score?: number;
  report: WorkbenchJobReport;
  coverage: WorkbenchSampleCoverage;
  succeededJobs: number;
  totalJobs: number;
  failedJobs: number;
  canceledJobs: number;
  errors: string[];
}

export interface WorkbenchRunEvidenceJobGroupResult extends WorkbenchRunEvidenceAgentIdentity {
  status: WorkbenchRunStatus;
  report: WorkbenchJobReport;
  succeededJobs: number;
  totalJobs: number;
  failedJobs: number;
  canceledJobs: number;
  errors: string[];
}

export interface WorkbenchRunEvidenceCaseResult extends WorkbenchRunEvidenceAgentIdentity {
  caseId: string;
  sample: number;
  status: WorkbenchJobStatus;
  selectedJobId: string;
  run?: WorkbenchRunEvidenceJobPhase;
  grade?: WorkbenchRunEvidenceJobPhase;
  score?: number;
  report: WorkbenchJobReport;
  error?: string;
  dependencyReason?: string;
}

export interface WorkbenchRunEvidenceJobPhase {
  jobId: string;
  role: WorkbenchJobRole;
  status: WorkbenchJobStatus;
  score?: number;
  durationMs?: number;
  error?: string;
  dependencyReason?: string;
}

export interface WorkbenchRunEvidenceJob extends WorkbenchRunEvidenceAgentIdentity {
  jobId: string;
  runId: string;
  role: WorkbenchJobRole;
  caseId: string;
  sample: number;
  status: WorkbenchJobStatus;
  score?: number;
  durationMs?: number;
  error?: string;
  dependencies: WorkbenchRunEvidenceJobDependency[];
}

export interface WorkbenchRunEvidenceJobDependency {
  name: string;
  jobId?: string;
  artifactId?: string;
  traceIds: string[];
}

type WorkbenchRunEvidenceResultCell = NonNullable<WorkbenchInspectionSnapshot["results"]>["cells"][number];
type WorkbenchRunEvidenceResultVersion = NonNullable<WorkbenchInspectionSnapshot["results"]>["skillVersions"][number];

export function workbenchSampleCoverage(
  completed: number | undefined,
  planned: number | undefined,
): WorkbenchSampleCoverage | undefined {
  const plannedCount = normalizeCoverageCount(planned);
  if (plannedCount === undefined || plannedCount === 0) {
    return undefined;
  }
  const completedCount = normalizeCoverageCount(completed) ?? 0;
  return { completed: completedCount, planned: plannedCount };
}

export function workbenchSampleCoverageForJobs(
  jobs: readonly WorkbenchJob[],
): WorkbenchSampleCoverage | undefined {
  const caseJobs = jobs.filter((job) => job.caseId !== "current");
  const resultJobs = preferredSampleResultJobs(caseJobs);
  return workbenchSampleCoverage(
    uniqueCaseSampleCount(resultJobs.filter(jobHasSampleResult)),
    uniqueCaseSampleCount(caseJobs),
  );
}

export function workbenchSampleCoverageTotal(
  coverages: readonly (WorkbenchSampleCoverage | undefined)[],
): WorkbenchSampleCoverage | undefined {
  const present = coverages.filter((coverage): coverage is WorkbenchSampleCoverage => coverage !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  return workbenchSampleCoverage(
    present.reduce((sum, coverage) => sum + coverage.completed, 0),
    present.reduce((sum, coverage) => sum + coverage.planned, 0),
  );
}

function normalizeCoverageCount(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function preferredSampleResultJobs(jobs: readonly WorkbenchJob[]): readonly WorkbenchJob[] {
  const gradeJobs = jobs.filter((job) => job.role === "grade");
  return gradeJobs.length > 0 ? gradeJobs : jobs;
}

function jobHasSampleResult(job: WorkbenchJob): boolean {
  return job.status === "succeeded" || workbenchJobScore(job) !== undefined;
}

function uniqueCaseSampleCount(jobs: readonly Pick<WorkbenchJob, "caseId" | "sample">[]): number {
  return new Set(jobs.map((job) => `${job.caseId}\0${job.sample}`)).size;
}

export interface WorkbenchJobReportOptions {
  unitKey?: (job: WorkbenchJob) => string | undefined;
  now?: string;
}

export interface WorkbenchReportMetricValue {
  total?: number;
  perSample?: number;
}

export interface WorkbenchReportRoleMetricSummary {
  role: WorkbenchJobRole;
  jobCount: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  canceled: number;
  latency?: WorkbenchReportMetricValue;
  cost?: WorkbenchReportMetricValue;
}

export interface WorkbenchReportMetricSummary {
  sampleCount: number;
  latency?: WorkbenchReportMetricValue;
  cost?: WorkbenchReportMetricValue;
  roles: WorkbenchReportRoleMetricSummary[];
}

export type WorkbenchReportMetricKind = "latency" | "cost";
export type WorkbenchReportMetricScope = "run" | "grade" | "total";

export interface WorkbenchReportScopedMetric {
  scope: WorkbenchReportMetricScope;
  label: string;
  role?: WorkbenchJobRole;
  value: WorkbenchReportMetricValue;
}

export interface WorkbenchReportMetricBreakdown {
  sampleCount: number;
  primary?: WorkbenchReportScopedMetric;
  run?: WorkbenchReportScopedMetric;
  grade?: WorkbenchReportScopedMetric;
  total?: WorkbenchReportScopedMetric;
  details: WorkbenchReportScopedMetric[];
}

export function buildWorkbenchJobReport(
  jobs: readonly WorkbenchJob[],
  traces: readonly WorkbenchTrace[] = [],
  options: WorkbenchJobReportOptions = {},
): WorkbenchJobReport {
  const unitKeys = new Set<string>();
  const roles = new Map<WorkbenchJobRole, WorkbenchJob[]>();
  for (const job of jobs) {
    const unitKey = options.unitKey?.(job) ?? caseSampleMeasurementKey(job);
    if (unitKey) {
      unitKeys.add(unitKey);
    }
    const role = job.role;
    const roleGroup = roles.get(role);
    if (roleGroup) {
      roleGroup.push(job);
    } else {
      roles.set(role, [job]);
    }
  }

  const roleReports = [...roles.entries()]
    .map(([role, roleJobs]) => buildWorkbenchJobRoleReport(role, roleJobs, traces))
    .sort(compareRoleReports);
  const totalDurationMs = sumDefinedNumbers(roleReports.map((role) => role.totalDurationMs));
  const elapsedMs = elapsedMsForJobs(jobs, options.now);
  return {
    unitCount: unitKeys.size,
    jobCount: jobs.length,
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    ...(totalDurationMs !== undefined ? { totalDurationMs } : {}),
    roles: roleReports,
  };
}

export function mergeWorkbenchJobReports(
  reports: readonly WorkbenchJobReport[],
): WorkbenchJobReport | undefined {
  if (reports.length === 0) {
    return undefined;
  }
  if (reports.length === 1) {
    return reports[0];
  }

  const roles = new Map<WorkbenchJobRole, WorkbenchJobRoleReport>();
  for (const report of reports) {
    for (const role of report.roles) {
      roles.set(role.role, mergeWorkbenchJobRoleReports(roles.get(role.role), role));
    }
  }

  const totalDurationMs = sumDefinedNumbers(reports.map((report) => report.totalDurationMs));
  return {
    unitCount: reports.reduce((sum, report) => sum + report.unitCount, 0),
    jobCount: reports.reduce((sum, report) => sum + report.jobCount, 0),
    ...(totalDurationMs !== undefined ? { totalDurationMs } : {}),
    roles: [...roles.values()].sort(compareRoleReports),
  };
}

function mergeWorkbenchJobRoleReports(
  current: WorkbenchJobRoleReport | undefined,
  next: WorkbenchJobRoleReport,
): WorkbenchJobRoleReport {
  const totalDurationMs = sumDefinedNumbers([current?.totalDurationMs, next.totalDurationMs]);
  const costUsd = sumCosts([current?.costUsd, next.costUsd]);
  return {
    role: next.role,
    jobCount: (current?.jobCount ?? 0) + next.jobCount,
    queued: (current?.queued ?? 0) + next.queued,
    running: (current?.running ?? 0) + next.running,
    succeeded: (current?.succeeded ?? 0) + next.succeeded,
    failed: (current?.failed ?? 0) + next.failed,
    canceled: (current?.canceled ?? 0) + next.canceled,
    ...(totalDurationMs !== undefined ? { totalDurationMs } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

export function workbenchJobReportTotalCostUsd(report: WorkbenchJobReport | undefined): number | undefined {
  return report ? sumCosts(report.roles.map((role) => role.costUsd)) : undefined;
}

export function workbenchJobReportMetricSummary(
  report: WorkbenchJobReport | undefined,
): WorkbenchReportMetricSummary {
  const sampleCount = report?.unitCount ?? 0;
  const latency = durationMetric(report?.totalDurationMs, sampleCount);
  const cost = costMetric(workbenchJobReportTotalCostUsd(report), sampleCount);
  return {
    sampleCount,
    ...(latency ? { latency } : {}),
    ...(cost ? { cost } : {}),
    roles: (report?.roles ?? []).map((role) => {
      const roleLatency = durationMetric(role.totalDurationMs, sampleCount);
      const roleCost = costMetric(role.costUsd, sampleCount);
      return {
        role: role.role,
        jobCount: role.jobCount,
        queued: role.queued,
        running: role.running,
        succeeded: role.succeeded,
        failed: role.failed,
        canceled: role.canceled,
        ...(roleLatency ? { latency: roleLatency } : {}),
        ...(roleCost ? { cost: roleCost } : {}),
      };
    }),
  };
}

export function workbenchJobReportMetricBreakdown(
  report: WorkbenchJobReport | undefined,
  kind: WorkbenchReportMetricKind,
): WorkbenchReportMetricBreakdown {
  const summary = workbenchJobReportMetricSummary(report);
  const runRole = summary.roles.find((role) => role.role !== "grade");
  const run = scopedMetric("run", "run", metricValueForRole(runRole, kind), runRole?.role);
  const gradeRole = summary.roles.find((role) => role.role === "grade");
  const grade = scopedMetric("grade", "grade", metricValueForRole(gradeRole, kind), gradeRole?.role);
  const total = scopedMetric("total", "eval total", metricValueForSummary(summary, kind));
  const primary = runRole ? run : total ?? grade;
  const details = dedupeScopedMetrics([grade, total], primary);
  return {
    sampleCount: summary.sampleCount,
    ...(primary ? { primary } : {}),
    ...(run ? { run } : {}),
    ...(grade ? { grade } : {}),
    ...(total ? { total } : {}),
    details,
  };
}

function metricValueForSummary(
  summary: WorkbenchReportMetricSummary,
  kind: WorkbenchReportMetricKind,
): WorkbenchReportMetricValue | undefined {
  return kind === "latency" ? summary.latency : summary.cost;
}

function metricValueForRole(
  role: WorkbenchReportRoleMetricSummary | undefined,
  kind: WorkbenchReportMetricKind,
): WorkbenchReportMetricValue | undefined {
  return kind === "latency" ? role?.latency : role?.cost;
}

function scopedMetric(
  scope: WorkbenchReportMetricScope,
  label: string,
  value: WorkbenchReportMetricValue | undefined,
  role?: WorkbenchJobRole,
): WorkbenchReportScopedMetric | undefined {
  if (!value) {
    return undefined;
  }
  return {
    scope,
    label,
    ...(role ? { role } : {}),
    value,
  };
}

function dedupeScopedMetrics(
  candidates: readonly (WorkbenchReportScopedMetric | undefined)[],
  primary: WorkbenchReportScopedMetric | undefined,
): WorkbenchReportScopedMetric[] {
  const details: WorkbenchReportScopedMetric[] = [];
  for (const candidate of candidates) {
    if (!candidate || (primary && sameMetricValue(candidate.value, primary.value))) {
      continue;
    }
    if (details.some((detail) => sameMetricValue(detail.value, candidate.value))) {
      continue;
    }
    details.push(candidate);
  }
  return details;
}

function sameMetricValue(left: WorkbenchReportMetricValue, right: WorkbenchReportMetricValue): boolean {
  return left.total === right.total && left.perSample === right.perSample;
}

function durationMetric(total: number | undefined, sampleCount: number): WorkbenchReportMetricValue | undefined {
  if (total === undefined) {
    return undefined;
  }
  return {
    total,
    ...(sampleCount > 0 ? { perSample: Math.round(total / sampleCount) } : {}),
  };
}

function costMetric(total: number | undefined, sampleCount: number): WorkbenchReportMetricValue | undefined {
  if (total === undefined) {
    return undefined;
  }
  return {
    total,
    ...(sampleCount > 0 ? { perSample: Number((total / sampleCount).toFixed(6)) } : {}),
  };
}

function buildWorkbenchJobRoleReport(
  role: WorkbenchJobRole,
  jobs: readonly WorkbenchJob[],
  traces: readonly WorkbenchTrace[],
): WorkbenchJobRoleReport {
  const statusCounts = jobStatusCounts(jobs);
  const durations = jobs.map((job) => job.durationMs).filter((duration): duration is number => duration !== undefined);
  const totalDurationMs = sumDefinedNumbers(durations);
  const costUsd = sumCosts(jobs.map((job) => jobReportCostFromJob(role, job, traces)));
  return {
    role,
    jobCount: jobs.length,
    ...statusCounts,
    ...(totalDurationMs !== undefined ? {
      totalDurationMs,
    } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

function jobStatusCounts(jobs: readonly WorkbenchJob[]): Record<WorkbenchJobStatus, number> {
  const counts = { queued: 0, running: 0, succeeded: 0, failed: 0, canceled: 0 };
  for (const job of jobs) {
    counts[job.status] += 1;
  }
  return counts;
}

function caseSampleMeasurementKey(job: WorkbenchJob): string {
  return `${measurementKeyFromJob(job)}\0${job.caseId}\0${job.sample}`;
}

function compareRoleReports(left: WorkbenchJobRoleReport, right: WorkbenchJobRoleReport): number {
  return roleOrder(left.role) - roleOrder(right.role) ||
    compareWorkbenchNaturalText(left.role, right.role);
}

function elapsedMsForJobs(jobs: readonly WorkbenchJob[], nowIso: string | undefined): number | undefined {
  if (jobs.length === 0) {
    return undefined;
  }
  const startedAt = minTimestamp(jobs.map((job) => job.startedAt ?? job.createdAt));
  const observedAt = maxTimestamp(jobs.map((job) =>
    job.finishedAt ?? (job.status === "running" ? nowIso : undefined) ?? job.startedAt ?? job.createdAt
  ));
  return startedAt !== undefined && observedAt !== undefined
    ? Math.max(0, observedAt - startedAt)
    : undefined;
}

function minTimestamp(values: readonly (string | undefined)[]): number | undefined {
  const timestamps = values.map(timestampMs).filter((value): value is number => value !== undefined);
  return timestamps.length > 0 ? Math.min(...timestamps) : undefined;
}

function maxTimestamp(values: readonly (string | undefined)[]): number | undefined {
  const timestamps = values.map(timestampMs).filter((value): value is number => value !== undefined);
  return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
}

function timestampMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function sumDefinedNumbers(values: readonly (number | undefined)[]): number | undefined {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : undefined;
}

function sumCosts(values: readonly (number | undefined)[]): number | undefined {
  const total = sumDefinedNumbers(values);
  return total === undefined ? undefined : Number(total.toFixed(6));
}

function jobReportCostFromJob(
  role: WorkbenchJobRole,
  job: WorkbenchJob,
  traces: readonly WorkbenchTrace[],
): number | undefined {
  const jobCost = jobReportCostFromUsage(role, job.result?.usage);
  if (jobCost !== undefined) {
    return jobCost;
  }
  const traceIds = new Set(job.traceIds);
  const traceCosts = traces
    .filter((trace) => traceIds.has(trace.id) || trace.jobId === job.id)
    .map((trace) => jobReportCostFromUsage(role, usageFromTraceResult(trace.result)));
  return sumCosts(traceCosts);
}

function jobReportCostFromUsage(role: WorkbenchJobRole, usage: UsageSummary | undefined): number | undefined {
  if (!usage) {
    return undefined;
  }
  const scopedCost = jobReportScopedUsageCost(role, usage);
  if (validUsageCost(scopedCost)) {
    return roundedUsageCost(scopedCost);
  }
  if (jobReportRoleHasScopedUsage(role) && usageHasRoleScopedCost(usage)) {
    return undefined;
  }
  const totalCost = usage.total?.costUsd;
  return validUsageCost(totalCost)
    ? roundedUsageCost(totalCost)
    : undefined;
}

function jobReportScopedUsageCost(role: WorkbenchJobRole, usage: UsageSummary): number | undefined {
  if (role === "run") {
    return usage.runner?.costUsd;
  }
  if (role === "grade") {
    return usage.engine?.costUsd;
  }
  if (role === "improve") {
    return usage.improver?.costUsd;
  }
  return undefined;
}

function jobReportRoleHasScopedUsage(role: WorkbenchJobRole): boolean {
  return role === "run" ||
    role === "grade" ||
    role === "improve";
}

function usageHasRoleScopedCost(usage: UsageSummary): boolean {
  return validUsageCost(usage.runner?.costUsd) ||
    validUsageCost(usage.engine?.costUsd) ||
    validUsageCost(usage.improver?.costUsd);
}

function validUsageCost(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function roundedUsageCost(value: number): number {
  return Number(value.toFixed(6));
}

export function buildWorkbenchRunEvidenceView(
  snapshot: WorkbenchInspectionSnapshot,
  runOrId: WorkbenchRun | string,
): WorkbenchRunEvidenceView | null {
  const run = typeof runOrId === "string"
    ? snapshot.runs.find((entry) => entry.id === runOrId) ?? null
    : runOrId;
  if (!run) {
    return null;
  }

  const jobs = jobsForRunEvidence(snapshot, run);
  const evidenceJobs = jobs.map((job) => jobForEvidence(snapshot, job)).sort(compareEvidenceJobs);
  const cases = caseResultsForEvidence(snapshot, jobs).sort(compareCaseResults);
  const measurements = measurementResultsForEvidence(snapshot, run, jobs, cases).sort(compareAgentIdentity);
  const jobGroups = jobGroupResultsForEvidence(snapshot, run, jobs).sort(compareAgentIdentity);
  return { runId: run.id, measurements, jobGroups, cases, jobs: evidenceJobs };
}

function jobsForRunEvidence(snapshot: WorkbenchInspectionSnapshot, run: WorkbenchRun): WorkbenchJob[] {
  const runJobIds = new Set(run.jobIds);
  return snapshot.jobs
    .filter((job) => runJobIds.has(job.id))
    .sort(compareJobs);
}

function jobForEvidence(snapshot: WorkbenchInspectionSnapshot, job: WorkbenchJob): WorkbenchRunEvidenceJob {
  return {
    ...agentIdentityForJob(snapshot, job),
    jobId: job.id,
    runId: job.runId,
    role: job.role,
    caseId: job.caseId,
    sample: job.sample,
    status: job.status,
    ...(workbenchJobScore(job) !== undefined ? { score: workbenchJobScore(job) } : {}),
    ...(job.durationMs !== undefined ? { durationMs: job.durationMs } : {}),
    ...(job.error ? { error: job.error } : {}),
    dependencies: (job.dependencies ?? []).map(evidenceDependency),
  };
}

function evidenceDependency(dependency: WorkbenchJobDependency): WorkbenchRunEvidenceJobDependency {
  return {
    name: dependency.name,
    ...(dependency.jobId ? { jobId: dependency.jobId } : {}),
    ...(dependency.artifactId ? { artifactId: dependency.artifactId } : {}),
    traceIds: [...(dependency.traceIds ?? [])],
  };
}

function caseResultsForEvidence(
  snapshot: WorkbenchInspectionSnapshot,
  jobs: readonly WorkbenchJob[],
): WorkbenchRunEvidenceCaseResult[] {
  const groups = new Map<string, WorkbenchJob[]>();
  for (const job of jobs.filter((entry) => entry.caseId !== "current")) {
    const key = caseSampleMeasurementKey(job);
    const groupJobs = groups.get(key);
    if (groupJobs) {
      groupJobs.push(job);
    } else {
      groups.set(key, [job]);
    }
  }

  const cases: WorkbenchRunEvidenceCaseResult[] = [];
  for (const groupJobs of groups.values()) {
    const sorted = [...groupJobs].sort(compareJobs);
    const runJob = latestJobForRole(sorted, "run");
    const gradeJob = latestJobForRole(sorted, "grade");
    const selected = gradeJob ?? runJob ?? sorted.at(-1);
    if (!selected) {
      continue;
    }
    const run = runJob ? workbenchRunEvidenceJobPhase(runJob, sorted) : undefined;
    const grade = gradeJob ? workbenchRunEvidenceJobPhase(gradeJob, sorted) : undefined;
    const score = grade?.score ?? run?.score ?? workbenchJobScore(selected);
    const report = buildWorkbenchJobReport(sorted, snapshot.traces);
    const error = runJob?.status === "failed" && runJob.error
      ? runJob.error
      : gradeJob?.error ?? runJob?.error;
    const dependencyReason = grade?.dependencyReason ?? run?.dependencyReason;
    cases.push({
      ...agentIdentityForJob(snapshot, selected),
      caseId: selected.caseId,
      sample: selected.sample,
      status: caseStatus(runJob, gradeJob, selected),
      selectedJobId: selected.id,
      ...(run ? { run } : {}),
      ...(grade ? { grade } : {}),
      ...(score !== undefined ? { score } : {}),
      report,
      ...(error ? { error } : {}),
      ...(dependencyReason ? { dependencyReason } : {}),
    });
  }
  return cases;
}

function measurementResultsForEvidence(
  snapshot: WorkbenchInspectionSnapshot,
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
  cases: readonly WorkbenchRunEvidenceCaseResult[],
): WorkbenchRunEvidenceMeasurementResult[] {
  const resultCells = (snapshot.results?.cells ?? []).filter((cell) => cell.runId === run.id);
  const measurements: WorkbenchRunEvidenceMeasurementResult[] = [];
  for (const groupJobs of evidenceJobGroups(jobs, isMeasuredSampleJob)) {
    const group = evidenceJobGroupSummary(snapshot, run, groupJobs);
    const agentCases = cases.filter((entry) => sameMeasurementAgent(entry, group));
    if (agentCases.length === 0) {
      continue;
    }
    const cell = resultCellForIdentity(resultCells, group);
    const caseScores = agentCases
      .map((entry) => entry.score)
      .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
    const score = cell?.quality ?? average(caseScores);
    const coverage = workbenchSampleCoverage(agentCases.filter(caseHasResult).length, agentCases.length);
    if (!coverage) {
      continue;
    }
    measurements.push({
      ...group,
      ...(score !== undefined ? { score } : {}),
      coverage,
    });
  }
  return measurements;
}

function jobGroupResultsForEvidence(
  snapshot: WorkbenchInspectionSnapshot,
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
): WorkbenchRunEvidenceJobGroupResult[] {
  return evidenceJobGroups(jobs, (job) => !isMeasuredSampleJob(job))
    .map((groupJobs) => evidenceJobGroupSummary(snapshot, run, groupJobs));
}

function evidenceJobGroups(
  jobs: readonly WorkbenchJob[],
  include: (job: WorkbenchJob) => boolean,
): WorkbenchJob[][] {
  const groups = new Map<string, WorkbenchJob[]>();
  for (const job of jobs.filter(include)) {
    const key = measurementKeyFromJob(job);
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups.values()];
}

function evidenceJobGroupSummary(
  snapshot: WorkbenchInspectionSnapshot,
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
): WorkbenchRunEvidenceJobGroupResult {
  return {
    ...agentIdentityForJob(snapshot, jobs[0]!),
    status: agentStatus(jobs, run.status),
    report: buildWorkbenchJobReport(jobs, snapshot.traces),
    succeededJobs: jobs.filter((job) => job.status === "succeeded").length,
    totalJobs: jobs.length,
    failedJobs: jobs.filter((job) => job.status === "failed").length,
    canceledJobs: jobs.filter((job) => job.status === "canceled").length,
    errors: uniqueStrings(jobs.flatMap((job) => job.error ? [job.error] : [])),
  };
}

function isMeasuredSampleJob(job: Pick<WorkbenchJob, "caseId">): boolean {
  return job.caseId !== "current";
}

function agentIdentityForJob(
  snapshot: WorkbenchInspectionSnapshot,
  job: Pick<WorkbenchJob, "versionId" | "skillName" | "skillBundleHash" | "evalHash" | "agentName" | "agentHash" | "adapter" | "result">,
): WorkbenchRunEvidenceAgentIdentity {
  const resultAgent = snapshot.results?.agentVersions.find((agent) => agent.id === job.agentHash);
  const agentSnapshot = snapshot.agents.find((agent) => agent.hash === job.agentHash);
  const adapter = resultAgent?.adapter ?? agentSnapshot?.agent.adapter ?? job.adapter?.use ?? "recorded";
  const model = resultAgent?.model ?? agentSnapshot?.agent.model ?? usageModelForJob(job);
  return {
    ...skillIdentityForJob(snapshot, job),
    agentName: resultAgent?.name ?? agentSnapshot?.agent.name ?? job.agentName,
    agentHash: job.agentHash,
    agentLabel: resultAgent?.label ?? resultAgent?.name ?? agentSnapshot?.agent.name ?? job.agentName,
    adapter,
    ...(model ? { model } : {}),
  };
}

function usageModelForJob(job: Pick<WorkbenchJob, "result">): string | undefined {
  return job.result?.usage?.runner?.model ??
    job.result?.usage?.engine?.model ??
    job.result?.usage?.total?.model;
}

function skillIdentityForJob(
  snapshot: WorkbenchInspectionSnapshot,
  job: Pick<WorkbenchJob, "versionId" | "skillName" | "skillBundleHash" | "evalHash">,
): WorkbenchRunEvidenceSkillIdentity {
  const resultVersion = resultVersionForJob(snapshot, job);
  return {
    skillName: job.skillName,
    skillBundleHash: job.skillBundleHash,
    versionId: job.versionId,
    evalHash: job.evalHash,
    skillLabel: resultVersion?.label ?? job.skillName,
    ...(resultVersion ? { skillVersionId: resultVersion.id } : {}),
  };
}

function resultVersionForJob(
  snapshot: WorkbenchInspectionSnapshot,
  job: Pick<WorkbenchJob, "versionId" | "skillName" | "skillBundleHash">,
): WorkbenchRunEvidenceResultVersion | undefined {
  const versions = snapshot.results?.skillVersions ?? [];
  return versions.find((version) =>
    version.contentHash === job.skillBundleHash && version.projectVersionId === job.versionId
  ) ??
    uniqueResultVersion(versions.filter((version) => version.contentHash === job.skillBundleHash)) ??
    uniqueResultVersion(versions.filter((version) =>
      version.projectVersionId === job.versionId && resultVersionMatchesSkill(version, job.skillName)
    )) ??
    uniqueResultVersion(versions.filter((version) => version.projectVersionId === job.versionId));
}

function resultVersionMatchesSkill(
  version: WorkbenchRunEvidenceResultVersion,
  skillName: string,
): boolean {
  return version.id === skillName || version.source === skillName || version.label === skillName;
}

function uniqueResultVersion<T>(versions: readonly T[]): T | undefined {
  return versions.length === 1 ? versions[0] : undefined;
}

export function workbenchRunEvidenceJobPhase(
  job: WorkbenchJob,
  groupJobs: readonly WorkbenchJob[],
): WorkbenchRunEvidenceJobPhase {
  const dependencyReason = job.status === "canceled" && job.error
    ? dependencyContext(job, groupJobs)
    : undefined;
  return {
    jobId: job.id,
    role: job.role,
    status: job.status,
    ...(workbenchJobScore(job) !== undefined ? { score: workbenchJobScore(job) } : {}),
    ...(job.durationMs !== undefined ? { durationMs: job.durationMs } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(dependencyReason ? { dependencyReason } : {}),
  };
}

function dependencyContext(job: WorkbenchJob, groupJobs: readonly WorkbenchJob[]): string | undefined {
  if (!job.dependencies?.length) {
    return job.error;
  }
  const dependencyJobs = job.dependencies
    .map((dependency) => dependency.jobId ? groupJobs.find((entry) => entry.id === dependency.jobId) : undefined)
    .filter((entry): entry is WorkbenchJob => Boolean(entry));
  const failedDependency = dependencyJobs.find((entry) => entry.status === "failed" && entry.error);
  if (failedDependency?.error) {
    return `${job.error}; ${failedDependency.role} failed: ${failedDependency.error}`;
  }
  return job.error;
}

function latestJobForRole(jobs: readonly WorkbenchJob[], role: WorkbenchJobRole): WorkbenchJob | undefined {
  return [...jobs].reverse().find((job) => job.role === role);
}

function caseStatus(
  runJob: WorkbenchJob | undefined,
  gradeJob: WorkbenchJob | undefined,
  selectedJob: WorkbenchJob,
): WorkbenchJobStatus {
  if (runJob?.status === "failed" || gradeJob?.status === "failed") {
    return "failed";
  }
  if (runJob?.status === "canceled" || gradeJob?.status === "canceled") {
    return "canceled";
  }
  if (gradeJob) {
    return gradeJob.status;
  }
  return runJob?.status ?? selectedJob.status;
}

function caseHasResult(entry: WorkbenchRunEvidenceCaseResult): boolean {
  return entry.status === "succeeded" || entry.score !== undefined;
}

function usageFromTraceResult(result: WorkbenchTrace["result"]): UsageSummary | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return undefined;
  }
  const usage = (result as { usage?: unknown }).usage;
  return usage && typeof usage === "object" && !Array.isArray(usage)
    ? usage as UsageSummary
    : undefined;
}

function resultCellForIdentity(
  cells: readonly WorkbenchRunEvidenceResultCell[],
  identity: WorkbenchRunEvidenceAgentIdentity,
): WorkbenchRunEvidenceResultCell | undefined {
  if (identity.skillVersionId) {
    const exact = cells.find((cell) =>
      cell.skillVersionId === identity.skillVersionId && cell.agentVersionId === identity.agentHash
    );
    if (exact) {
      return exact;
    }
  }
  const agentCells = cells.filter((cell) => cell.agentVersionId === identity.agentHash);
  return agentCells.length === 1 ? agentCells[0] : undefined;
}

function sameMeasurementAgent(
  left: WorkbenchRunEvidenceAgentIdentity,
  right: WorkbenchRunEvidenceAgentIdentity,
): boolean {
  return left.agentHash === right.agentHash &&
    left.agentName === right.agentName &&
    left.versionId === right.versionId &&
    left.skillName === right.skillName &&
    left.skillBundleHash === right.skillBundleHash;
}

function average(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

export function workbenchJobScore(job: Pick<WorkbenchJob, "result">): number | undefined {
  const scoreItem = job.result?.items?.find((item) => item.kind === "score" && typeof item.score === "number");
  return typeof scoreItem?.score === "number" && Number.isFinite(scoreItem.score) ? scoreItem.score : undefined;
}

function agentStatus(jobs: readonly WorkbenchJob[], fallback: WorkbenchRunStatus): WorkbenchRunStatus {
  if (jobs.length === 0) {
    return fallback;
  }
  if (jobs.some((job) => job.status === "failed")) {
    return "failed";
  }
  if (jobs.some((job) => job.status === "running")) {
    return "running";
  }
  if (jobs.some((job) => job.status === "queued")) {
    return "running";
  }
  if (jobs.some((job) => job.status === "canceled")) {
    return "canceled";
  }
  return "succeeded";
}

function compareJobs(left: WorkbenchJob, right: WorkbenchJob): number {
  return compareWorkbenchNaturalText(left.skillName, right.skillName) ||
    left.skillBundleHash.localeCompare(right.skillBundleHash) ||
    left.versionId.localeCompare(right.versionId) ||
    compareWorkbenchNaturalText(left.agentName, right.agentName) ||
    compareWorkbenchNaturalText(left.caseId, right.caseId) ||
    left.sample - right.sample ||
    roleOrder(left.role) - roleOrder(right.role) ||
    (left.createdAt ?? "").localeCompare(right.createdAt ?? "") ||
    left.id.localeCompare(right.id);
}

function compareAgentIdentity(left: WorkbenchRunEvidenceAgentIdentity, right: WorkbenchRunEvidenceAgentIdentity): number {
  return compareSkillIdentity(left, right) ||
    compareWorkbenchNaturalText(left.agentLabel, right.agentLabel) ||
    left.agentHash.localeCompare(right.agentHash);
}

function compareCaseResults(left: WorkbenchRunEvidenceCaseResult, right: WorkbenchRunEvidenceCaseResult): number {
  return compareWorkbenchNaturalText(left.caseId, right.caseId) ||
    left.sample - right.sample ||
    compareSkillIdentity(left, right) ||
    compareWorkbenchNaturalText(left.agentLabel, right.agentLabel) ||
    left.agentHash.localeCompare(right.agentHash) ||
    left.selectedJobId.localeCompare(right.selectedJobId);
}

function compareEvidenceJobs(left: WorkbenchRunEvidenceJob, right: WorkbenchRunEvidenceJob): number {
  return compareWorkbenchNaturalText(left.caseId, right.caseId) ||
    left.sample - right.sample ||
    compareSkillIdentity(left, right) ||
    compareWorkbenchNaturalText(left.agentLabel, right.agentLabel) ||
    left.agentHash.localeCompare(right.agentHash) ||
    roleOrder(left.role) - roleOrder(right.role) ||
    left.jobId.localeCompare(right.jobId);
}

function compareSkillIdentity(left: WorkbenchRunEvidenceSkillIdentity, right: WorkbenchRunEvidenceSkillIdentity): number {
  return compareWorkbenchNaturalText(left.skillLabel, right.skillLabel) ||
    compareWorkbenchNaturalText(left.skillName, right.skillName) ||
    left.skillBundleHash.localeCompare(right.skillBundleHash) ||
    left.versionId.localeCompare(right.versionId);
}

function measurementKeyFromJob(job: WorkbenchJob): string {
  return [
    job.versionId,
    job.skillName,
    job.skillBundleHash,
    job.agentHash,
    job.agentName,
  ].join("\0");
}

function roleOrder(role: WorkbenchJobRole): number {
  if (role === "run") {
    return 0;
  }
  if (role === "grade") {
    return 1;
  }
  if (role === "improve") {
    return 2;
  }
  return 3;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
