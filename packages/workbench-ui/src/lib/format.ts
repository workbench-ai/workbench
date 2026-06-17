import type {
  Json,
  WorkbenchAgent,
  WorkbenchJob,
  WorkbenchRun,
} from "@workbench-ai/workbench-contract";

export function shortId(value: string | null | undefined, length = 12): string {
  return value ? value.slice(0, length) : "n/a";
}

export function formatScore(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "n/a";
}

export function formatCost(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(4)}` : "n/a";
}

export function formatRunCost(run: Pick<WorkbenchRun, "costUsd" | "status" | "id"> | null | undefined): string {
  if (!run) {
    return "Not tested";
  }
  if (typeof run.costUsd === "number" && Number.isFinite(run.costUsd)) {
    return formatCost(run.costUsd);
  }
  return run.status === "failed" || run.status === "canceled"
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

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

export function formatStatus(value: string | null | undefined): string {
  return value ? value.replaceAll(/[_-]+/gu, " ") : "unknown";
}

export function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : pluralize(singular)}`;
}

export function formatList(values: readonly string[], empty = "none"): string {
  return values.length > 0 ? values.join(", ") : empty;
}

export function agentConfigString(agent: WorkbenchAgent, key: string): string | null {
  const value = agent.config[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function agentNetworkLabel(agent: WorkbenchAgent): string {
  const value = agent.config.network;
  if (value === true || value === "true" || value === "on" || value === "bridge") {
    return "open";
  }
  if (value === false || value === "false" || value === "off" || value === "none") {
    return "isolated";
  }
  return typeof value === "string" && value.trim() ? value : "default";
}

export function agentTimeoutLabel(agent: WorkbenchAgent): string {
  const minutes = agent.config.timeoutMinutes;
  if (typeof minutes === "number" && Number.isFinite(minutes)) {
    return `${minutes}m`;
  }
  const seconds = agent.config.timeoutSeconds;
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return `${seconds}s`;
  }
  return "default";
}

export function runDisplayLabel(run: WorkbenchRun): string {
  return [
    run.kind,
    run.status,
    typeof run.score === "number" ? `score ${formatScore(run.score)}` : null,
  ].filter(Boolean).join(" / ");
}

export function jobDisplayLabel(job: WorkbenchJob): string {
  return [
    job.kind,
    job.status,
    job.caseId,
    `sample ${job.sample}`,
  ].filter(Boolean).join(" / ");
}

export function jsonPreview(value: Json): string {
  return JSON.stringify(value, null, 2);
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
