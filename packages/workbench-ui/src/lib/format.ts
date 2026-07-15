import {
  workbenchJobReportTotalCostUsd,
  workbenchJobScore,
  type WorkbenchJobReport,
  type WorkbenchJob,
  type WorkbenchRun,
} from "@workbench-ai/workbench-contract";

export function shortId(value: string | null | undefined, length = 12): string {
  return value ? value.slice(0, length) : "n/a";
}

export function formatScore(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "n/a";
}

export function jobsForRun(
  run: Pick<WorkbenchRun, "id" | "jobIds">,
  jobs: readonly WorkbenchJob[],
): WorkbenchJob[] {
  const referencedJobIds = new Set(run.jobIds);
  return jobs.filter((job) => referencedJobIds.has(job.id));
}

export function runScore(
  run: Pick<WorkbenchRun, "id" | "status" | "jobIds">,
  jobs: readonly WorkbenchJob[],
): number | undefined {
  if (run.status === "canceled") {
    return undefined;
  }
  const scores = jobsForRun(run, jobs)
    .filter((job) => job.role === "grade")
    .map(workbenchJobScore)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  if (scores.length === 0) {
    return undefined;
  }
  return Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(3));
}

export function formatCost(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", {
        currency: "USD",
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
        style: "currency",
      }).format(value)
    : "n/a";
}

export function formatReportCost(
  report: WorkbenchJobReport | null | undefined,
  status?: string | null,
): string {
  const costUsd = workbenchJobReportTotalCostUsd(report ?? undefined);
  if (costUsd !== undefined) {
    return formatCost(costUsd);
  }
  return status === "failed" || status === "canceled"
    ? "Failed before usage"
    : "Not reported";
}

export function formatDurationMs(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  if (value < 1_000) {
    return `${Math.round(value)}ms`;
  }
  const seconds = value / 1_000;
  if (seconds < 60) {
    return `${trimNumber(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatTimestamp(
  value: string | null | undefined,
  options: { locale?: string | string[]; timeZone?: string } = {},
): string {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return new Intl.DateTimeFormat(options.locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(date);
}

export function formatStatus(value: string | null | undefined): string {
  return value ? value.replaceAll(/[_-]+/gu, " ") : "unknown";
}

export function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : pluralize(singular)}`;
}

export function fileName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function directoryPathForFile(path: string | null): string | null {
  if (!path || !path.includes("/")) {
    return null;
  }
  return path.split("/").slice(0, -1).join("/");
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function pluralize(singular: string): string {
  if (singular === "child") {
    return "children";
  }
  if (/[^aeiou]y$/iu.test(singular)) {
    return `${singular.slice(0, -1)}ies`;
  }
  return `${singular}s`;
}
