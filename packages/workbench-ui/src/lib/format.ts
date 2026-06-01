import type {
  CandidateSummary,
  EvaluationSummary,
  RemoteWorkbenchJob,
  RunSummary,
} from "../types";

type BadgeTone = "success" | "warning" | "destructive" | "outline" | "accent";
type WorkbenchDisplayStatus =
  | CandidateSummary["status"]
  | EvaluationSummary["status"]
  | RemoteWorkbenchJob["status"]
  | RunSummary["status"]
  | RunSummary["outcome"];
type WorkbenchKnownStatus = NonNullable<WorkbenchDisplayStatus>;

const BADGE_TONE_BY_STATUS: Partial<Record<WorkbenchKnownStatus, BadgeTone>> = {
  agent_error: "destructive",
  completed: "success",
  error: "destructive",
  eval_error: "destructive",
  evaluated: "success",
  failed: "destructive",
  partial: "warning",
  planned: "warning",
  repair_exhausted: "warning",
  running: "warning",
};

interface CandidateSelectionLabelOptions {
  summary: CandidateSummary;
  baseSummary?: CandidateSummary | null;
  active?: boolean;
  details?: Array<string | null | undefined>;
}

type CandidateDisplayInput =
  | string
  | Pick<CandidateSummary, "id" | "name" | "version">
  | Pick<EvaluationSummary, "candidateId" | "candidateName" | "candidateVersion">
  | null
  | undefined;

export function shortId(value: string | null | undefined): string | null {
  return value ? value.slice(0, 12) : null;
}

export function formatCandidateDisplayName(candidate: CandidateDisplayInput): string {
  if (!candidate) {
    return "Unknown candidate";
  }
  if (typeof candidate === "string") {
    return shortId(candidate) ?? candidate;
  }
  const name =
    "name" in candidate
      ? normalizedDisplayName(candidate.name)
      : "candidateName" in candidate
        ? normalizedDisplayName(candidate.candidateName)
        : null;
  const version =
    "version" in candidate
      ? candidate.version
      : "candidateVersion" in candidate
        ? candidate.candidateVersion
        : null;
  if (name) {
    return typeof version === "number" && Number.isInteger(version) && version > 0
      ? `${name} v${version}`
      : name;
  }
  const id =
    "id" in candidate
      ? candidate.id
      : "candidateId" in candidate
        ? candidate.candidateId
        : null;
  return shortId(id) ?? id ?? "Unknown candidate";
}

export function formatCandidateName(candidate: CandidateDisplayInput): string {
  if (!candidate) {
    return "Unknown candidate";
  }
  if (typeof candidate === "string") {
    return shortId(candidate) ?? candidate;
  }
  const name =
    "name" in candidate
      ? normalizedDisplayName(candidate.name)
      : "candidateName" in candidate
        ? normalizedDisplayName(candidate.candidateName)
        : null;
  if (name) {
    return name;
  }
  const id =
    "id" in candidate
      ? candidate.id
      : "candidateId" in candidate
        ? candidate.candidateId
        : null;
  return shortId(id) ?? id ?? "Unknown candidate";
}

export function formatCandidateVersionLabel(candidate: CandidateDisplayInput): string | null {
  if (!candidate || typeof candidate === "string") {
    return null;
  }
  const version =
    "version" in candidate
      ? candidate.version
      : "candidateVersion" in candidate
        ? candidate.candidateVersion
        : null;
  return typeof version === "number" && Number.isInteger(version) && version > 0
    ? `v${version}`
    : null;
}

export function formatCandidateSecondaryLabel(
  summary: CandidateSummary,
  baseSummary?: CandidateSummary | null,
): string {
  const baseId = summary.baseId && summary.baseId !== summary.id ? summary.baseId : null;
  if (!baseId) {
    return "Initial";
  }
  if (!baseSummary) {
    return `From ${shortId(baseId) ?? baseId}`;
  }
  return `From ${[
    formatCandidateName(baseSummary),
    formatCandidateVersionLabel(baseSummary),
  ].filter(Boolean).join(" · ")}`;
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

export function formatCandidateSelectionLabel({
  summary,
  baseSummary = null,
  active = false,
  details = [],
}: CandidateSelectionLabelOptions): string {
  return [
    formatCandidateDisplayName(summary),
    `Candidate ID ${shortId(summary.id) ?? summary.id}`,
    formatCandidateSecondaryLabel(summary, baseSummary),
    statusLabel(summary.status),
    ...details,
    active ? "active candidate" : null,
  ]
    .filter(Boolean)
    .join(". ");
}

function normalizedDisplayName(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function statusLabel(
  status:
    | WorkbenchDisplayStatus
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
    | WorkbenchDisplayStatus
    | null
    | undefined,
): BadgeTone {
  return status ? BADGE_TONE_BY_STATUS[status] ?? "outline" : "outline";
}
