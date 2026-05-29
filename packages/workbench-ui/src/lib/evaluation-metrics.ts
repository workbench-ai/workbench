import { getCategoricalChartColor } from "@workbench-ai/cli-web-ui/lib/chart-colors";

import {
  formatDurationMs,
  formatExecutionCostUsd,
  formatMetricValue,
} from "./format";
import {
  isCompleteEvaluationSummary,
  resolveEvaluationCandidateDisplay,
} from "./candidate-evaluation-display";
import type {
  EvaluationMetricDescriptor,
  EvaluationMetricStats,
  LabeledEvaluationSummary,
} from "../types";

export interface EvaluationMetricDatum {
  evaluationId: string;
  evaluationLabel: string;
  candidateId: string;
  candidateLabel: string;
  configurationLabel: string;
  color: string;
  value: number;
  displayValue: string;
}

export interface EvaluationTradeoffPair {
  key: string;
  label: string;
  xMetric: EvaluationMetricDescriptor;
  yMetric: EvaluationMetricDescriptor;
}

export interface EvaluationTradeoffDatum {
  evaluationId: string;
  evaluationLabel: string;
  candidateId: string;
  candidateLabel: string;
  color: string;
  x: number;
  y: number;
  xDisplay: string;
  yDisplay: string;
}

export function buildEvaluationMetricDescriptors(
  evaluations: readonly LabeledEvaluationSummary[],
): EvaluationMetricDescriptor[] {
  const descriptors = new Map<string, EvaluationMetricDescriptor>();
  for (const evaluation of evaluations.filter(isCompleteEvaluationSummary)) {
    for (const metricId of Object.keys(evaluation.evaluation?.metrics ?? evaluation.metrics ?? {})) {
      descriptors.set(metricId, metricDescriptor(metricId));
    }
    if (evaluation.selectionMetric && evaluation.selectionScore) {
      descriptors.set(evaluation.selectionMetric, metricDescriptor(evaluation.selectionMetric));
    }
    if (evaluation.evaluation?.durationMs ?? evaluation.durationMs) {
      descriptors.set("durationMs", {
        id: "durationMs",
        label: "Duration",
        direction: "lower",
        kind: "duration_ms",
        group: "execution",
        primary: true,
        semanticRole: "speed",
      });
    }
    if (evaluation.evaluation?.usage?.total?.costUsd ?? evaluation.usage?.total?.costUsd) {
      descriptors.set("usage.total.costUsd", {
        id: "usage.total.costUsd",
        label: "Cost",
        direction: "lower",
        kind: "currency_usd",
        group: "usage",
        primary: true,
        semanticRole: "cost",
      });
    }
  }
  return [...descriptors.values()].sort(compareMetricDescriptors);
}

function metricDescriptor(metricId: string): EvaluationMetricDescriptor {
  const isScoreMetric = metricId === "score";
  return {
    id: metricId,
    label: formatMetricLabel(metricId),
    direction: "higher",
    kind: "number",
    group: "metric",
    primary: isScoreMetric,
    ...(isScoreMetric ? { semanticRole: "performance" as const } : {}),
  };
}

const costAxisFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function selectPrimaryEvaluationMetrics(
  descriptors: EvaluationMetricDescriptor[] | undefined,
): EvaluationMetricDescriptor[] {
  const available = descriptors ?? [];
  const primary = available.filter((descriptor) => descriptor.primary);
  if (primary.length > 0) {
    return primary;
  }
  return available.slice(0, 3);
}

export function buildEvaluationMetricData(
  evaluations: LabeledEvaluationSummary[],
  descriptor: EvaluationMetricDescriptor,
  candidateColorById?: ReadonlyMap<string, string>,
): EvaluationMetricDatum[] {
  const rows = evaluations.filter(isCompleteEvaluationSummary).flatMap((evaluation, index) => {
    const value = getEvaluationMetricValue(evaluation, descriptor);
    if (value === undefined) {
      return [];
    }
    const stats = getEvaluationMetricStats(evaluation, descriptor);
    const display = resolveEvaluationCandidateDisplay(evaluation);
    return [{
      evaluationId: evaluation.id,
      evaluationLabel: evaluation.label,
      candidateId: evaluation.candidateId,
      candidateLabel: display.candidateLabel,
      configurationLabel: display.configurationLabel,
      color: resolveEvaluationCandidateChartColor(evaluation, candidateColorById, index),
      value,
      displayValue: formatEvaluationMetricStats(descriptor, stats, evaluation),
    }];
  });

  return rows.sort((left, right) => compareMetricRows(left, right, descriptor));
}

export function buildEvaluationTradeoffPairs(
  descriptors: EvaluationMetricDescriptor[] | undefined,
): EvaluationTradeoffPair[] {
  const primary = selectPrimaryEvaluationMetrics(descriptors);
  if (primary.length < 2) {
    return [];
  }

  const performanceMetric = primary.find((descriptor) => descriptor.semanticRole === "performance") ?? primary[0]!;
  return primary
    .filter((descriptor) => descriptor.id !== performanceMetric.id)
    .map((descriptor) => ({
      key: `${performanceMetric.id}::${descriptor.id}`,
      label: `${performanceMetric.label} vs ${descriptor.label}`,
      xMetric: descriptor,
      yMetric: performanceMetric,
    }));
}

export function buildEvaluationTradeoffData(
  evaluations: LabeledEvaluationSummary[],
  pair: EvaluationTradeoffPair,
  candidateColorById?: ReadonlyMap<string, string>,
): EvaluationTradeoffDatum[] {
  return evaluations.filter(isCompleteEvaluationSummary).flatMap((evaluation, index) => {
    const x = getEvaluationMetricValue(evaluation, pair.xMetric);
    const y = getEvaluationMetricValue(evaluation, pair.yMetric);
    if (x === undefined || y === undefined) {
      return [];
    }
    const display = resolveEvaluationCandidateDisplay(evaluation);
    return [{
      evaluationId: evaluation.id,
      evaluationLabel: evaluation.label,
      candidateId: evaluation.candidateId,
      candidateLabel: display.candidateLabel,
      color: resolveEvaluationCandidateChartColor(evaluation, candidateColorById, index),
      x,
      y,
      xDisplay: formatEvaluationMetricStats(pair.xMetric, getEvaluationMetricStats(evaluation, pair.xMetric), evaluation),
      yDisplay: formatEvaluationMetricStats(pair.yMetric, getEvaluationMetricStats(evaluation, pair.yMetric), evaluation),
    }];
  });
}

export function formatEvaluationMetricStats(
  descriptor: EvaluationMetricDescriptor,
  stats: EvaluationMetricStats | undefined,
  evaluation?: LabeledEvaluationSummary,
): string {
  if (!stats) {
    return formatEvaluationMetricValue(descriptor, undefined, evaluation);
  }
  const mean = formatEvaluationMetricValue(descriptor, stats.mean, evaluation);
  if (stats.count <= 1) {
    return mean;
  }
  return `${mean} ± ${formatEvaluationMetricValue(descriptor, stats.stddev)}`;
}

export function formatEvaluationMetricValue(
  descriptor: EvaluationMetricDescriptor,
  value: number | undefined,
  evaluation?: LabeledEvaluationSummary,
): string {
  if (value === undefined) {
    if (evaluation?.status === "error") {
      return "Error";
    }
    return "—";
  }
  if (descriptor.kind === "duration_ms") {
    return formatDurationMs(value);
  }
  if (descriptor.kind === "currency_usd") {
    return formatExecutionCostUsd(value);
  }
  return formatMetricValue(value);
}

export function formatEvaluationMetricAxisValue(
  descriptor: EvaluationMetricDescriptor,
  value: number,
): string {
  if (descriptor.kind === "duration_ms") {
    const minutes = Math.round(value / 60_000);
    return `${minutes}m`;
  }
  if (descriptor.kind === "currency_usd") {
    return costAxisFormatter.format(value);
  }
  return formatMetricValue(value);
}

export function resolveEvaluationCandidateChartColor(
  evaluation: LabeledEvaluationSummary,
  candidateColorById: ReadonlyMap<string, string> | undefined,
  fallbackIndex: number,
): string {
  return candidateColorById?.get(evaluation.candidateId) ?? getCategoricalChartColor(fallbackIndex);
}

export function getEvaluationMetricValue(
  evaluation: LabeledEvaluationSummary,
  descriptor: EvaluationMetricDescriptor,
): number | undefined {
  return getEvaluationMetricStats(evaluation, descriptor)?.mean;
}

export function getEvaluationMetricStats(
  evaluation: LabeledEvaluationSummary,
  descriptor: EvaluationMetricDescriptor,
): EvaluationMetricStats | undefined {
  if (descriptor.id === "durationMs") {
    return evaluation.evaluation?.durationMs ?? evaluation.durationMs;
  }
  if (descriptor.id === "usage.total.costUsd") {
    return evaluation.evaluation?.usage?.total?.costUsd ?? evaluation.usage?.total?.costUsd;
  }
  if (evaluation.selectionMetric === descriptor.id && evaluation.selectionScore) {
    return evaluation.selectionScore;
  }
  return evaluation.evaluation?.metrics?.[descriptor.id] ?? evaluation.metrics?.[descriptor.id];
}

function compareMetricRows(
  left: EvaluationMetricDatum,
  right: EvaluationMetricDatum,
  descriptor: EvaluationMetricDescriptor,
): number {
  const valueOrder = descriptor.direction === "higher"
    ? right.value - left.value
    : left.value - right.value;
  if (valueOrder !== 0) {
    return valueOrder;
  }
  return left.evaluationLabel.localeCompare(right.evaluationLabel);
}

function compareMetricDescriptors(
  left: EvaluationMetricDescriptor,
  right: EvaluationMetricDescriptor,
): number {
  const rank = (descriptor: EvaluationMetricDescriptor) =>
    descriptor.semanticRole === "performance"
      ? 0
      : descriptor.semanticRole === "speed"
        ? 1
        : descriptor.semanticRole === "cost"
          ? 2
          : descriptor.primary
            ? 3
            : 4;
  const rankOrder = rank(left) - rank(right);
  if (rankOrder !== 0) {
    return rankOrder;
  }
  return left.label.localeCompare(right.label);
}

function formatMetricLabel(metricId: string): string {
  if (metricId === "durationMs") {
    return "Duration";
  }
  if (metricId === "usage.total.costUsd") {
    return "Cost";
  }
  return metricId
    .split(/[._-]+/u)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(" ");
}
