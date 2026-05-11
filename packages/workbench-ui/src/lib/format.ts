import type {
  CandidateSummary,
  EvaluationResultSummary,
  RunSummary,
  RuntimeEvent,
} from "../types";

type BadgeTone = "success" | "warning" | "destructive" | "outline" | "accent";

interface CandidateSelectionLabelOptions {
  summary: CandidateSummary;
  active?: boolean;
  details?: Array<string | null | undefined>;
}

export function shortId(value: string | null | undefined): string | null {
  return value ? value.slice(0, 12) : null;
}

export function formatWorkspaceLabel(value: string | null | undefined): string {
  if (!value) {
    return "Unknown workspace";
  }

  const normalized = value.replace(/[\\\/]+$/, "");
  const segments = normalized.split(/[\\\/]/).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDurationMs(value: number | undefined): string {
  if (!Number.isFinite(value)) {
    return "unknown";
  }

  const durationMs = value as number;
  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }

  const totalSeconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function formatRunStartSummary(run: RunSummary | null | undefined): string | null {
  if (!run) {
    return null;
  }

  return `${run.workflow} started`;
}

export function formatMetricValue(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2);
}

export function hasMetricValues(metrics: Record<string, number> | undefined): metrics is Record<string, number> {
  return Object.values(metrics ?? {}).some((value) => typeof value === "number" && Number.isFinite(value));
}

export function formatExecutionCostUsd(
  value: number | undefined,
  options: { approximate?: boolean } = {},
): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value as number);
  return options.approximate ? `~${formatted}` : formatted;
}

export function formatMetricSummary(metrics: Record<string, number> | undefined): string {
  const entries = Object.entries(metrics ?? {})
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]));
  if (entries.length === 0) {
    return "No metrics";
  }

  return entries
    .slice(0, 2)
    .map(([key, metricValue]) => `${key}: ${formatMetricValue(metricValue)}`)
    .join(" · ");
}

export function formatResultCandidateLabel(
  candidateId: string | null | undefined,
): string {
  if (!candidateId) {
    return "Unknown candidate";
  }
  return shortId(candidateId) ?? candidateId;
}

export function formatCandidateSelectionLabel({
  summary,
  active = false,
  details = [],
}: CandidateSelectionLabelOptions): string {
  const baseId = summary.baseId && summary.baseId !== summary.id ? summary.baseId : null;
  return [
    shortId(summary.id) ?? summary.id,
    baseId ? `From ${shortId(baseId)}` : "Genesis candidate",
    statusLabel(summary.status),
    ...details,
    active ? "active candidate" : null,
  ]
    .filter(Boolean)
    .join(". ");
}

export function statusLabel(
  status:
    | CandidateSummary["status"]
    | EvaluationResultSummary["status"]
    | RuntimeEvent["status"]
    | null
    | undefined,
): string {
  if (!status) {
    return "unknown";
  }
  return status.replaceAll("_", " ");
}

export function badgeToneForStatus(
  status:
    | CandidateSummary["status"]
    | EvaluationResultSummary["status"]
    | RuntimeEvent["status"]
    | null
    | undefined,
): BadgeTone {
  switch (status) {
    case "evaluated":
    case "completed":
      return "success";
    case "repair_exhausted":
    case "checkpointed":
    case "running":
    case "planned":
    case "partial":
      return "warning";
    case "eval_error":
    case "agent_error":
    case "failed":
    case "error":
      return "destructive";
    default:
      return "outline";
  }
}
