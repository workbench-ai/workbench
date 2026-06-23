import type {
  WorkbenchInspectionSnapshot,
  WorkbenchJob,
  WorkbenchJobDependency,
  WorkbenchJobRole,
  WorkbenchJobStatus,
  WorkbenchRun,
  WorkbenchRunStatus,
  WorkbenchTrace,
  UsageSummary,
} from "./index";

export interface WorkbenchRunEvidenceView {
  runId: string;
  agents: WorkbenchRunEvidenceAgentResult[];
  cases: WorkbenchRunEvidenceCaseResult[];
  traceJobs: WorkbenchRunEvidenceTraceJob[];
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

export interface WorkbenchRunEvidenceAgentResult extends WorkbenchRunEvidenceAgentIdentity {
  status: WorkbenchRunStatus;
  score?: number;
  costUsd?: number;
  durationMs?: number;
  completedCases: number;
  totalCases: number;
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
  execute?: WorkbenchRunEvidenceJobPhase;
  grade?: WorkbenchRunEvidenceJobPhase;
  score?: number;
  durationMs?: number;
  error?: string;
  dependencyReason?: string;
}

export interface WorkbenchRunEvidenceJobPhase {
  jobId: string;
  role?: WorkbenchJobRole;
  status: WorkbenchJobStatus;
  score?: number;
  durationMs?: number;
  error?: string;
  dependencyReason?: string;
}

export interface WorkbenchRunEvidenceTraceJob extends WorkbenchRunEvidenceAgentIdentity {
  jobId: string;
  runId: string;
  role?: WorkbenchJobRole;
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
type WorkbenchRunEvidenceResultVersion = NonNullable<WorkbenchInspectionSnapshot["results"]>["versions"][number];

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
  const traceJobs = jobs.map((job) => traceJobForEvidence(snapshot, job)).sort(compareTraceJobs);
  const cases = caseResultsForEvidence(snapshot, jobs).sort(compareCaseResults);
  const agents = agentResultsForEvidence(snapshot, run, jobs, cases).sort(compareAgentResults);
  return { runId: run.id, agents, cases, traceJobs };
}

function jobsForRunEvidence(snapshot: WorkbenchInspectionSnapshot, run: WorkbenchRun): WorkbenchJob[] {
  const runJobIds = new Set(run.jobIds ?? []);
  return snapshot.jobs
    .filter((job) => job.runId === run.id || runJobIds.has(job.id))
    .sort(compareJobs);
}

function traceJobForEvidence(snapshot: WorkbenchInspectionSnapshot, job: WorkbenchJob): WorkbenchRunEvidenceTraceJob {
  return {
    ...agentIdentityForJob(snapshot, job),
    jobId: job.id,
    runId: job.runId,
    ...(job.role ? { role: job.role } : {}),
    caseId: job.caseId,
    sample: job.sample,
    status: job.status,
    ...(jobScore(job) !== undefined ? { score: jobScore(job) } : {}),
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
    const key = caseResultKey(job);
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }

  const cases: WorkbenchRunEvidenceCaseResult[] = [];
  for (const groupJobs of groups.values()) {
    const sorted = [...groupJobs].sort(compareJobs);
    const executeJob = latestJobForRole(sorted, "execute");
    const gradeJob = latestJobForRole(sorted, "grade");
    const selected = gradeJob ?? executeJob ?? sorted.at(-1);
    if (!selected) {
      continue;
    }
    const execute = executeJob ? jobPhase(executeJob, sorted) : undefined;
    const grade = gradeJob ? jobPhase(gradeJob, sorted) : undefined;
    const score = grade?.score ?? execute?.score ?? jobScore(selected);
    const durationMs = caseDurationMs(sorted);
    const error = executeJob?.status === "failed" && executeJob.error
      ? executeJob.error
      : gradeJob?.error ?? executeJob?.error;
    const dependencyReason = grade?.dependencyReason ?? execute?.dependencyReason;
    cases.push({
      ...agentIdentityForJob(snapshot, selected),
      caseId: selected.caseId,
      sample: selected.sample,
      status: caseStatus(executeJob, gradeJob, selected),
      selectedJobId: selected.id,
      ...(execute ? { execute } : {}),
      ...(grade ? { grade } : {}),
      ...(score !== undefined ? { score } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(error ? { error } : {}),
      ...(dependencyReason ? { dependencyReason } : {}),
    });
  }
  return cases;
}

function agentResultsForEvidence(
  snapshot: WorkbenchInspectionSnapshot,
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
  cases: readonly WorkbenchRunEvidenceCaseResult[],
): WorkbenchRunEvidenceAgentResult[] {
  const jobGroups = new Map<string, WorkbenchJob[]>();
  for (const job of jobs) {
    const key = measurementKeyFromJob(job);
    jobGroups.set(key, [...(jobGroups.get(key) ?? []), job]);
  }

  const resultCells = (snapshot.results?.cells ?? []).filter((cell) => cell.runId === run.id);
  const agents: WorkbenchRunEvidenceAgentResult[] = [];
  for (const groupJobs of jobGroups.values()) {
    const identitySource = groupJobs[0];
    if (!identitySource) {
      continue;
    }
    const identity = agentIdentityForJob(snapshot, identitySource);
    const agentCases = cases.filter((entry) => sameMeasurementAgent(entry, identity));
    const cell = resultCellForIdentity(resultCells, identity);
    const caseScores = agentCases
      .map((entry) => entry.score)
      .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
    const score = cell?.quality ?? average(caseScores);
    const costUsd = cell?.costUsd ?? sumRunnerCosts(groupJobs, snapshot.traces);
    const durationMs = cell?.latencyMs ?? sumRunnerDurations(groupJobs);
    agents.push({
      ...identity,
      status: agentStatus(groupJobs, run.status),
      ...(score !== undefined ? { score } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      completedCases: agentCases.filter(caseHasResult).length,
      totalCases: agentCases.length,
      succeededJobs: groupJobs.filter((job) => job.status === "succeeded").length,
      totalJobs: groupJobs.length,
      failedJobs: groupJobs.filter((job) => job.status === "failed").length,
      canceledJobs: groupJobs.filter((job) => job.status === "canceled").length,
      errors: uniqueStrings(groupJobs.flatMap((job) => job.error ? [job.error] : [])),
    });
  }
  return agents;
}

function agentIdentityForJob(
  snapshot: WorkbenchInspectionSnapshot,
  job: Pick<WorkbenchJob, "versionId" | "skillName" | "skillBundleHash" | "evalHash" | "agentName" | "agentHash" | "adapter">,
): WorkbenchRunEvidenceAgentIdentity {
  const resultAgent = snapshot.results?.agents.find((agent) => agent.id === job.agentHash);
  const agentSnapshot = snapshot.agents.find((agent) => agent.hash === job.agentHash);
  const adapter = resultAgent?.adapter ?? agentSnapshot?.agent.adapter ?? job.adapter?.use ?? "recorded";
  const model = resultAgent?.model ?? agentSnapshot?.agent.model;
  return {
    ...skillIdentityForJob(snapshot, job),
    agentName: resultAgent?.name ?? agentSnapshot?.agent.name ?? job.agentName,
    agentHash: job.agentHash,
    agentLabel: resultAgent?.label ?? resultAgent?.name ?? agentSnapshot?.agent.name ?? job.agentName,
    adapter,
    ...(model ? { model } : {}),
  };
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
  const versions = snapshot.results?.versions ?? [];
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

function jobPhase(job: WorkbenchJob, groupJobs: readonly WorkbenchJob[]): WorkbenchRunEvidenceJobPhase {
  const dependencyReason = job.status === "canceled" && job.error
    ? dependencyContext(job, groupJobs)
    : undefined;
  return {
    jobId: job.id,
    ...(job.role ? { role: job.role } : {}),
    status: job.status,
    ...(jobScore(job) !== undefined ? { score: jobScore(job) } : {}),
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
    return `${job.error}; ${failedDependency.role ?? "dependency"} failed: ${failedDependency.error}`;
  }
  return job.error;
}

function latestJobForRole(jobs: readonly WorkbenchJob[], role: WorkbenchJobRole): WorkbenchJob | undefined {
  return [...jobs].reverse().find((job) => job.role === role);
}

function caseStatus(
  executeJob: WorkbenchJob | undefined,
  gradeJob: WorkbenchJob | undefined,
  selectedJob: WorkbenchJob,
): WorkbenchJobStatus {
  if (executeJob?.status === "failed" || gradeJob?.status === "failed") {
    return "failed";
  }
  if (gradeJob) {
    return gradeJob.status;
  }
  return executeJob?.status ?? selectedJob.status;
}

function caseHasResult(entry: WorkbenchRunEvidenceCaseResult): boolean {
  return entry.status === "succeeded" || entry.score !== undefined;
}

function caseDurationMs(jobs: readonly WorkbenchJob[]): number | undefined {
  return sumDurations(jobs);
}

function sumDurations(jobs: readonly Pick<WorkbenchJob, "durationMs">[]): number | undefined {
  const values = jobs
    .map((job) => job.durationMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : undefined;
}

function sumRunnerCosts(
  jobs: readonly WorkbenchJob[],
  traces: readonly WorkbenchTrace[],
): number | undefined {
  const values = jobs
    .filter(isRunnerJob)
    .map((job) => runnerCostFromJob(job, traces))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) {
    return undefined;
  }
  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(6));
}

function runnerCostFromJob(
  job: WorkbenchJob,
  traces: readonly WorkbenchTrace[],
): number | undefined {
  const jobCost = runnerCostFromUsage(job.result?.usage);
  if (jobCost !== undefined) {
    return jobCost;
  }
  const traceIds = new Set(job.traceIds);
  const traceCosts = traces
    .filter((trace) => traceIds.has(trace.id) || trace.jobId === job.id)
    .map((trace) => runnerCostFromUsage(usageFromTraceResult(trace.result)))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return traceCosts.length > 0
    ? Number(traceCosts.reduce((sum, value) => sum + value, 0).toFixed(6))
    : undefined;
}

function runnerCostFromUsage(usage: UsageSummary | undefined): number | undefined {
  const cost = usage?.runner?.costUsd ?? usage?.total?.costUsd;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? Number(cost.toFixed(6))
    : undefined;
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

function sumRunnerDurations(jobs: readonly WorkbenchJob[]): number | undefined {
  return sumDurations(jobs.filter(isRunnerJob));
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
    left.skillBundleHash === right.skillBundleHash &&
    left.evalHash === right.evalHash;
}

function isRunnerJob(job: Pick<WorkbenchJob, "role">): boolean {
  return job.role !== "grade";
}

function average(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

function jobScore(job: WorkbenchJob): number | undefined {
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
  return left.skillName.localeCompare(right.skillName, undefined, { numeric: true, sensitivity: "base" }) ||
    left.skillBundleHash.localeCompare(right.skillBundleHash) ||
    left.versionId.localeCompare(right.versionId) ||
    left.agentName.localeCompare(right.agentName, undefined, { numeric: true, sensitivity: "base" }) ||
    left.caseId.localeCompare(right.caseId, undefined, { numeric: true, sensitivity: "base" }) ||
    left.sample - right.sample ||
    roleOrder(left.role) - roleOrder(right.role) ||
    (left.createdAt ?? "").localeCompare(right.createdAt ?? "") ||
    left.id.localeCompare(right.id);
}

function compareAgentResults(left: WorkbenchRunEvidenceAgentResult, right: WorkbenchRunEvidenceAgentResult): number {
  return compareSkillIdentity(left, right) ||
    left.agentLabel.localeCompare(right.agentLabel, undefined, { numeric: true, sensitivity: "base" }) ||
    left.agentHash.localeCompare(right.agentHash);
}

function compareCaseResults(left: WorkbenchRunEvidenceCaseResult, right: WorkbenchRunEvidenceCaseResult): number {
  return left.caseId.localeCompare(right.caseId, undefined, { numeric: true, sensitivity: "base" }) ||
    left.sample - right.sample ||
    compareSkillIdentity(left, right) ||
    left.agentLabel.localeCompare(right.agentLabel, undefined, { numeric: true, sensitivity: "base" }) ||
    left.agentHash.localeCompare(right.agentHash) ||
    left.selectedJobId.localeCompare(right.selectedJobId);
}

function compareTraceJobs(left: WorkbenchRunEvidenceTraceJob, right: WorkbenchRunEvidenceTraceJob): number {
  return left.caseId.localeCompare(right.caseId, undefined, { numeric: true, sensitivity: "base" }) ||
    left.sample - right.sample ||
    compareSkillIdentity(left, right) ||
    left.agentLabel.localeCompare(right.agentLabel, undefined, { numeric: true, sensitivity: "base" }) ||
    left.agentHash.localeCompare(right.agentHash) ||
    roleOrder(left.role) - roleOrder(right.role) ||
    left.jobId.localeCompare(right.jobId);
}

function compareSkillIdentity(left: WorkbenchRunEvidenceSkillIdentity, right: WorkbenchRunEvidenceSkillIdentity): number {
  return left.skillLabel.localeCompare(right.skillLabel, undefined, { numeric: true, sensitivity: "base" }) ||
    left.skillName.localeCompare(right.skillName, undefined, { numeric: true, sensitivity: "base" }) ||
    left.skillBundleHash.localeCompare(right.skillBundleHash) ||
    left.versionId.localeCompare(right.versionId);
}

function caseResultKey(job: WorkbenchJob): string {
  return `${measurementKeyFromJob(job)}\0${job.caseId}\0${job.sample}`;
}

function measurementKeyFromJob(job: WorkbenchJob): string {
  return [
    job.versionId,
    job.skillName,
    job.skillBundleHash,
    job.evalHash,
    job.agentHash,
    job.agentName,
  ].join("\0");
}

function roleOrder(role: WorkbenchJobRole | undefined): number {
  if (role === "execute") {
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
