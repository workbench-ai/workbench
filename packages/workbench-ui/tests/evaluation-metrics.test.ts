import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import { getCategoricalChartColor } from "@workbench-ai/cli-web-ui/lib/chart-colors";

import {
  buildEvaluationMetricDescriptors,
  buildEvaluationMetricData,
  buildEvaluationTradeoffData,
  buildEvaluationTradeoffPairs,
  formatEvaluationMetricStats,
  getEvaluationMetricValue,
  selectPrimaryEvaluationMetrics,
} from "../src/lib/evaluation-metrics";
import type {
  EvaluationMetricDescriptor,
  LabeledEvaluationScorecard,
} from "../src/types";

describe("evaluation metric helpers", () => {
  test("keeps execution usage and metric groups generic in the web helper", () => {
    const source = readFileSync(
      new URL("../src/lib/evaluation-metrics.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("usage.total.costUsd");
    expect(source).not.toContain("usage.execution");
    expect(source).not.toContain('descriptor.group !== "criteria"');
    expect(source).not.toContain(["usage", "har" + "ness"].join("."));
    expect(source).not.toContain('"rubric"');
  });

  test("colors metric rows and scatter points by candidate", () => {
    const evaluations: LabeledEvaluationScorecard[] = [
      evaluationRecord("skill_v1_opus", "Skill", 1, 12_000, {}, {
        candidateId: "skill_v1",
        candidateVersion: 1,
        candidateRunName: "Claude Code w/ Opus 4.6",
      }),
      evaluationRecord("skill_v1_codex", "Skill", 0.8, 14_000, {}, {
        candidateId: "skill_v1",
        candidateVersion: 1,
        candidateRunName: "Codex w/ GPT-5.4",
      }),
      evaluationRecord("skill_v3_opus", "Skill", 0.95, 13_000, {}, {
        candidateId: "skill_v3",
        candidateVersion: 3,
        candidateRunName: "Claude Code w/ Opus 4.6",
      }),
    ];
    const candidateColorById = new Map([
      ["skill_v1", getCategoricalChartColor(0)],
      ["skill_v3", getCategoricalChartColor(1)],
    ]);
    const scoreDescriptor: EvaluationMetricDescriptor = {
      id: "score",
      label: "Score",
      direction: "higher",
      kind: "number",
      group: "metric",
      primary: true,
      semanticRole: "performance",
    };
    const tradeoffPair = buildEvaluationTradeoffPairs([
      scoreDescriptor,
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
      buildEvaluationMetricData(evaluations, scoreDescriptor, candidateColorById).map((datum) => datum.color),
    ).toEqual([
      getCategoricalChartColor(0),
      getCategoricalChartColor(1),
      getCategoricalChartColor(0),
    ]);
    expect(
      buildEvaluationTradeoffData(evaluations, tradeoffPair, candidateColorById).map((datum) => datum.color),
    ).toEqual([
      getCategoricalChartColor(0),
      getCategoricalChartColor(0),
      getCategoricalChartColor(1),
    ]);
  });

  test("excludes incomplete evaluations from comparison charts", () => {
    const complete = evaluationRecord("complete", "Skill", 0.7, 12_000);
    const errorBase = evaluationRecord("error", "Skill", 1, 1_000);
    const error = {
      ...errorBase,
      status: "error" as const,
      completedSampleCount: 0,
      errorSampleCount: 1,
      evaluation: {
        ...errorBase.evaluation,
        status: "error" as const,
        completedSampleCount: 0,
        errorSampleCount: 1,
      },
    };
    const scoreDescriptor: EvaluationMetricDescriptor = {
      id: "score",
      label: "Score",
      direction: "higher",
      kind: "number",
      group: "metric",
      primary: true,
      semanticRole: "performance",
    };

    expect(buildEvaluationMetricDescriptors([error])).toEqual([]);
    expect(buildEvaluationMetricData([complete, error], scoreDescriptor).map((datum) => datum.evaluationId)).toEqual([
      "complete",
    ]);
  });

  test("uses explicit primary flags without inferring criteria from metric names", () => {
    const descriptors: EvaluationMetricDescriptor[] = [
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
        id: "case_completion",
        label: "Case Completion",
        direction: "higher",
        kind: "number",
        group: "metric",
        primary: false,
      },
    ];

    expect(selectPrimaryEvaluationMetrics(descriptors)).toEqual([
      descriptors[0],
    ]);
  });

  test("classifies score as primary and leaves other metrics generic", () => {
    const descriptors = buildEvaluationMetricDescriptors([
      evaluationRecord("current", "Source candidate", 1, 12_000, {
        case_completion: stats(0.8),
      }),
    ]);

    expect(descriptors.find((descriptor) => descriptor.id === "score")).toMatchObject({
      group: "metric",
      primary: true,
      semanticRole: "performance",
    });
    expect(descriptors.find((descriptor) => descriptor.id === "case_completion")).toMatchObject({
      group: "metric",
      label: "Case Completion",
      primary: false,
    });
  });

  test("uses selection score for the selected metric", () => {
    const evaluation = {
      ...evaluationRecord("split_selection", "Skill", 0.5, 12_000),
      selectionMetric: "score",
      selectionScore: stats(0.9),
    };
    const scoreDescriptor: EvaluationMetricDescriptor = {
      id: "score",
      label: "Score",
      direction: "higher",
      kind: "number",
      group: "metric",
      primary: true,
    };

    expect(getEvaluationMetricValue(evaluation, scoreDescriptor)).toBe(0.9);
  });

  test("includes selected metrics even when only selection stats are present", () => {
    const base = evaluationRecord("custom_selection", "Skill", 0.5, 12_000);
    const descriptors = buildEvaluationMetricDescriptors([{
      ...base,
      metrics: { score: base.metrics.score },
      evaluation: {
        ...base.evaluation,
        metrics: { score: base.evaluation.metrics.score },
      },
      selectionMetric: "validation_accuracy",
      selectionScore: stats(0.9),
    }]);

    expect(descriptors.find((descriptor) => descriptor.id === "validation_accuracy")).toMatchObject({
      label: "Validation Accuracy",
      group: "metric",
    });
  });

  test("formats sampled metrics with standard deviation", () => {
    expect(formatEvaluationMetricStats({
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

function evaluationRecord(
  id: string,
  label: string,
  score: number,
  durationMs: number,
  extraMetrics: Record<string, ReturnType<typeof stats>> = {},
  options: {
    candidateId?: string;
    candidateVersion?: number;
    candidateRunName?: string;
  } = {},
): LabeledEvaluationScorecard {
  const candidateId = options.candidateId ?? id;
  const evaluation = {
    candidate: { id: candidateId, kind: "candidate" as const, label },
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
    candidateId,
    candidateName: label,
    candidateVersion: options.candidateVersion ?? 1,
    candidateRunName: options.candidateRunName,
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
