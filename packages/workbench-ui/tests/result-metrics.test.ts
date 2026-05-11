import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import { getCategoricalChartColor } from "@workbench-ai/cli-web-ui/lib/chart-colors";

import {
  buildResultMetricDescriptors,
  buildResultTradeoffData,
  buildResultTradeoffPairs,
  formatResultMetricStats,
  getResultMetricChartColor,
  selectPrimaryResultMetrics,
} from "../src/lib/result-metrics";
import type {
  ResultMetricDescriptor,
  LabeledEvaluationResultRecord,
} from "../src/types";

describe("result metric helpers", () => {
  test("keeps runtime usage and metric groups generic in the web helper", () => {
    const source = readFileSync(
      new URL("../src/lib/result-metrics.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("usage.total.costUsd");
    expect(source).not.toContain("usage.execution");
    expect(source).toContain('descriptor.group !== "criteria"');
    expect(source).not.toContain("usage.harness");
    expect(source).not.toContain('"rubric"');
  });

  test("keeps semantic colors for the shared performance, speed, and cost roles", () => {
    const descriptors: ResultMetricDescriptor[] = [
      {
        id: "score",
        label: "Score",
        direction: "higher",
        kind: "number",
        group: "metric",
        primary: true,
        semanticRole: "performance",
      },
      {
        id: "durationMs",
        label: "Duration",
        direction: "lower",
        kind: "duration_ms",
        group: "metric",
        primary: true,
        semanticRole: "speed",
      },
      {
        id: "usage.total.costUsd",
        label: "Execution Cost / Sample",
        direction: "lower",
        kind: "currency_usd",
        group: "metric",
        primary: true,
        semanticRole: "cost",
      },
    ];

    expect(getResultMetricChartColor(descriptors[0]!, 0)).toBe("var(--chart-performance)");
    expect(getResultMetricChartColor(descriptors[1]!, 1)).toBe("var(--chart-speed)");
    expect(getResultMetricChartColor(descriptors[2]!, 2)).toBe("var(--chart-cost)");
  });

  test("rotates scatter points through the shared categorical palette", () => {
    const results: LabeledEvaluationResultRecord[] = [
      resultRecord("current", "Source candidate", 1, 12_000),
      resultRecord("degraded", "Reduced radius", 0.8, 14_000),
      resultRecord("cheaper", "Cheaper run", 0.95, 13_000),
    ];
    const tradeoffPair = buildResultTradeoffPairs([
      {
        id: "score",
        label: "Score",
        direction: "higher",
        kind: "number",
        group: "metric",
        primary: true,
        semanticRole: "performance",
      },
      {
        id: "durationMs",
        label: "Duration",
        direction: "lower",
        kind: "duration_ms",
        group: "metric",
        primary: true,
        semanticRole: "speed",
      },
    ])[0]!;

    expect(
      buildResultTradeoffData(results, tradeoffPair).map((datum) => datum.color),
    ).toEqual([
      getCategoricalChartColor(0),
      getCategoricalChartColor(1),
      getCategoricalChartColor(2),
    ]);
  });

  test("keeps criteria metrics out of the default primary surface when explicit primary metrics exist", () => {
    const descriptors: ResultMetricDescriptor[] = [
      {
        id: "score",
        label: "Score",
        direction: "higher",
        kind: "number",
        group: "metric",
        primary: true,
        semanticRole: "performance",
      },
      {
        id: "criterion__task_completion",
        label: "Task Completion",
        direction: "higher",
        kind: "number",
        group: "criteria",
        primary: false,
      },
    ];

    expect(selectPrimaryResultMetrics(descriptors)).toEqual([
      descriptors[0],
    ]);
  });

  test("classifies score as the primary result metric and criteria as secondary", () => {
    const descriptors = buildResultMetricDescriptors([
      resultRecord("current", "Source candidate", 1, 12_000, {
        criterion__task_completion: stats(0.8),
      }),
    ]);

    expect(descriptors.find((descriptor) => descriptor.id === "score")).toMatchObject({
      group: "metric",
      primary: true,
      semanticRole: "performance",
    });
    expect(descriptors.find((descriptor) => descriptor.id === "criterion__task_completion")).toMatchObject({
      group: "criteria",
      label: "Task Completion",
      primary: false,
    });
  });

  test("formats sampled metrics with standard deviation", () => {
    expect(formatResultMetricStats({
      id: "score",
      label: "Score",
      direction: "higher",
      kind: "number",
      group: "metric",
      primary: true,
    }, {
      count: 3,
      mean: 0.75,
      variance: 0.01,
      stddev: 0.1,
      min: 0.6,
      max: 0.9,
    })).toBe("0.75 ± 0.10");
  });
});

function stats(value: number) {
  return {
    count: 1,
    mean: value,
    variance: 0,
    stddev: 0,
    min: value,
    max: value,
  };
}

function resultRecord(
  id: string,
  label: string,
  score: number,
  durationMs: number,
  extraMetrics: Record<string, ReturnType<typeof stats>> = {},
): LabeledEvaluationResultRecord {
  const evaluation = {
    subject: { id, kind: "candidate" as const, label },
    status: "completed" as const,
    sampleCount: 1,
    completedSampleCount: 1,
    errorSampleCount: 0,
    metrics: { score: stats(score), ...extraMetrics },
    durationMs: stats(durationMs),
    samples: [],
  };
  return {
    id,
    runId: "run_test",
    benchmarkFingerprint: "3333333333333333333333333333333333333333333333333333333333333333",
    candidateId: id,
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z",
    label,
    status: evaluation.status,
    sampleCount: evaluation.sampleCount,
    completedSampleCount: evaluation.completedSampleCount,
    errorSampleCount: evaluation.errorSampleCount,
    metrics: evaluation.metrics,
    durationMs: evaluation.durationMs,
    evaluation,
  };
}
