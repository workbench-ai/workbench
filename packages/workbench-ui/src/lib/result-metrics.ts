import {
  getCategoricalChartColor,
  getSemanticChartColor,
} from "@workbench-ai/cli-web-ui/lib/chart-colors";

import {
  formatDurationMs,
  formatExecutionCostUsd,
  formatMetricValue,
} from "./format";
import type {
  ResultMetricDescriptor,
  ResultMetricStats,
  LabeledEvaluationResultRecord,
  EvaluationResultRecord,
} from "../types";

export interface ResultMetricDatum {
  resultId: string;
  resultLabel: string;
  value: number;
  displayValue: string;
}

export interface ResultTradeoffPair {
  key: string;
  label: string;
  xMetric: ResultMetricDescriptor;
  yMetric: ResultMetricDescriptor;
}

export interface ResultTradeoffDatum {
  resultId: string;
  resultLabel: string;
  color: string;
  x: number;
  y: number;
  xDisplay: string;
  yDisplay: string;
}

export function buildResultMetricDescriptors(
  results: readonly EvaluationResultRecord[],
): ResultMetricDescriptor[] {
  const descriptors = new Map<string, ResultMetricDescriptor>();
  for (const result of results) {
    for (const metricId of Object.keys(result.evaluation.metrics ?? result.metrics ?? {})) {
      const isScoreMetric = metricId === "score";
      const isCriterionMetric = metricId.startsWith("criterion__");
      descriptors.set(metricId, {
        id: metricId,
        label: formatMetricLabel(metricId),
        direction: "higher",
        kind: "number",
        group: isCriterionMetric ? "criteria" : "metric",
        primary: isScoreMetric,
        ...(isScoreMetric ? { semanticRole: "performance" as const } : {}),
      });
    }
    if (result.evaluation.durationMs ?? result.durationMs) {
      descriptors.set("durationMs", {
        id: "durationMs",
        label: "Duration",
        direction: "lower",
        kind: "duration_ms",
        group: "runtime",
        primary: true,
        semanticRole: "speed",
      });
    }
    if (result.evaluation.usage?.total?.costUsd ?? result.usage?.total?.costUsd) {
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

const costAxisFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function selectPrimaryResultMetrics(
  descriptors: ResultMetricDescriptor[] | undefined,
): ResultMetricDescriptor[] {
  const available = descriptors ?? [];
  const primary = available.filter((descriptor) => descriptor.primary);
  if (primary.length > 0) {
    return primary;
  }
  const nonCriteria = available.filter((descriptor) => descriptor.group !== "criteria");
  return (nonCriteria.length > 0 ? nonCriteria : available).slice(0, 3);
}

export function buildResultMetricData(
  results: LabeledEvaluationResultRecord[],
  descriptor: ResultMetricDescriptor,
): ResultMetricDatum[] {
  const rows = results.flatMap((result) => {
    const value = getResultMetricValue(result, descriptor);
    if (value === undefined) {
      return [];
    }
    const stats = getResultMetricStats(result, descriptor);
    return [{
      resultId: result.id,
      resultLabel: result.label,
      value,
      displayValue: formatResultMetricStats(descriptor, stats, result),
    }];
  });

  return rows.sort((left, right) => compareMetricRows(left, right, descriptor));
}

export function buildResultTradeoffPairs(
  descriptors: ResultMetricDescriptor[] | undefined,
): ResultTradeoffPair[] {
  const primary = selectPrimaryResultMetrics(descriptors);
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

export function buildResultTradeoffData(
  results: LabeledEvaluationResultRecord[],
  pair: ResultTradeoffPair,
): ResultTradeoffDatum[] {
  return results.flatMap((result, index) => {
    const x = getResultMetricValue(result, pair.xMetric);
    const y = getResultMetricValue(result, pair.yMetric);
    if (x === undefined || y === undefined) {
      return [];
    }
    return [{
      resultId: result.id,
      resultLabel: result.label,
      color: getCategoricalChartColor(index),
      x,
      y,
      xDisplay: formatResultMetricStats(pair.xMetric, getResultMetricStats(result, pair.xMetric), result),
      yDisplay: formatResultMetricStats(pair.yMetric, getResultMetricStats(result, pair.yMetric), result),
    }];
  });
}

export function formatResultMetricStats(
  descriptor: ResultMetricDescriptor,
  stats: ResultMetricStats | undefined,
  result?: LabeledEvaluationResultRecord,
): string {
  if (!stats) {
    return formatResultMetricValue(descriptor, undefined, result);
  }
  const mean = formatResultMetricValue(descriptor, stats.mean, result);
  if (stats.count <= 1) {
    return mean;
  }
  return `${mean} ± ${formatResultMetricValue(descriptor, stats.stddev)}`;
}

export function formatResultMetricValue(
  descriptor: ResultMetricDescriptor,
  value: number | undefined,
  result?: LabeledEvaluationResultRecord,
): string {
  if (value === undefined) {
    if (result?.status === "error") {
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

export function formatResultMetricAxisValue(
  descriptor: ResultMetricDescriptor,
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

export function getResultMetricChartColor(
  descriptor: ResultMetricDescriptor,
  index: number,
): string {
  if (descriptor.semanticRole) {
    return getSemanticChartColor(descriptor.semanticRole);
  }
  return getCategoricalChartColor(index);
}

export function getResultMetricValue(
  result: LabeledEvaluationResultRecord,
  descriptor: ResultMetricDescriptor,
): number | undefined {
  return getResultMetricStats(result, descriptor)?.mean;
}

export function getResultMetricStats(
  result: LabeledEvaluationResultRecord,
  descriptor: ResultMetricDescriptor,
): ResultMetricStats | undefined {
  if (descriptor.id === "durationMs") {
    return result.evaluation.durationMs;
  }
  if (descriptor.id === "usage.total.costUsd") {
    return result.evaluation.usage?.total?.costUsd;
  }
  return result.evaluation.metrics?.[descriptor.id];
}

function compareMetricRows(
  left: ResultMetricDatum,
  right: ResultMetricDatum,
  descriptor: ResultMetricDescriptor,
): number {
  const valueOrder = descriptor.direction === "higher"
    ? right.value - left.value
    : left.value - right.value;
  if (valueOrder !== 0) {
    return valueOrder;
  }
  return left.resultLabel.localeCompare(right.resultLabel);
}

function compareMetricDescriptors(
  left: ResultMetricDescriptor,
  right: ResultMetricDescriptor,
): number {
  const rank = (descriptor: ResultMetricDescriptor) =>
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
    .replace(/^criterion__/, "")
    .split(/[._-]+/u)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(" ");
}
