import { getCategoricalChartColor } from "@workbench-ai/cli-web-ui/lib/chart-colors";
import { buildWorkbenchEvaluationMetricDescriptors } from "@workbench-ai/workbench-contract";

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
  return buildWorkbenchEvaluationMetricDescriptors(evaluations);
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
