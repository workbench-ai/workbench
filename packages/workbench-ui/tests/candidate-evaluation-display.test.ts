import { describe, expect, test } from "vitest";

import { getCategoricalChartColor } from "@workbench-ai/cli-web-ui/lib/chart-colors";
import {
  buildCandidateEvaluationRollup,
  buildCandidateEvaluationRollups,
  buildEvaluationCandidateColorMap,
  buildEvaluationCandidatePresentations,
  formatEvaluationConfigurationLabel,
  readEvaluationScore,
  resolveCandidateEvaluationRollupDisplay,
  resolveEvaluationCandidateDisplay,
} from "../src/lib/candidate-evaluation-display";
import type { EvaluationSummary } from "../src/types";

describe("candidate evaluation display", () => {
  test("shows candidate identity and run configuration together", () => {
    const evaluation = evaluationSummary({
      candidateName: "Skill",
      candidateVersion: 3,
      candidateRunId: "claude-opus-46",
      candidateRunName: "Claude Code w/ Opus 4.6",
    });

    expect(resolveEvaluationCandidateDisplay(evaluation)).toEqual({
      candidateLabel: "Skill v3",
      configurationLabel: "Claude Code w/ Opus 4.6",
      label: "Skill v3 · Claude Code w/ Opus 4.6",
    });
  });

  test("falls back to default run when an evaluation has no run metadata", () => {
    const evaluation = evaluationSummary({ candidateName: "Skill", candidateVersion: 1 });

    expect(formatEvaluationConfigurationLabel(evaluation)).toBe("Default configuration");
    expect(resolveEvaluationCandidateDisplay(evaluation).label).toBe("Skill v1 · Default configuration");
  });

  test("rolls candidate score display up from evaluations", () => {
    const low = evaluationSummary({
      id: "eval_low",
      candidateId: "skill_v3",
      candidateName: "Skill",
      candidateVersion: 3,
      candidateRunName: "Fast",
      updatedAt: "2026-01-01T00:00:00.000Z",
      metrics: { score: metricStats(0.5) },
    });
    const high = evaluationSummary({
      id: "eval_high",
      candidateId: "skill_v3",
      candidateName: "Skill",
      candidateVersion: 3,
      candidateRunName: "Accurate",
      updatedAt: "2026-01-02T00:00:00.000Z",
      metrics: { score: metricStats(0.9) },
    });

    const rollup = buildCandidateEvaluationRollup("skill_v3", [low, high]);
    expect(rollup).toMatchObject({
      candidateId: "skill_v3",
      evaluationCount: 2,
      scoredEvaluationCount: 2,
      bestEvaluation: high,
      bestScore: 0.9,
      bestConfigurationLabel: "Accurate",
      meanScore: 0.7,
    });
    expect(resolveCandidateEvaluationRollupDisplay(rollup)).toMatchObject({
      scoreText: "Best score 0.90",
      meanText: "Mean 0.70",
      bestConfigurationText: "Best configuration Accurate",
      countText: "2 evaluations",
    });
  });

  test("uses selection score as the primary candidate score when present", () => {
    const evaluation = evaluationSummary({
      metrics: { score: metricStats(0.2) },
      selectionMetric: "score",
      selectionLabel: "score on split=validation",
      selectionScore: metricStats(0.8),
    });

    const rollup = buildCandidateEvaluationRollup("candidate_test", [evaluation]);

    expect(readEvaluationScore(evaluation)).toBe(0.8);
    expect(rollup.bestScore).toBe(0.8);
  });

  test("does not label non-score selection metrics as score", () => {
    const evaluation = evaluationSummary({
      metrics: { score: metricStats(0.2) },
      selectionMetric: "latency",
      selectionLabel: "latency on split=validation",
      selectionScore: metricStats(0.8),
    });

    expect(readEvaluationScore(evaluation)).toBe(0.2);
  });

  test("excludes incomplete evaluations from candidate score rollups", () => {
    const complete = evaluationSummary({
      id: "eval_complete",
      candidateId: "skill_v3",
      candidateName: "Skill",
      candidateVersion: 3,
      candidateRunName: "Complete",
      metrics: { score: metricStats(0.6) },
    });
    const error = evaluationSummary({
      id: "eval_error",
      candidateId: "skill_v3",
      candidateName: "Skill",
      candidateVersion: 3,
      candidateRunName: "Error",
      status: "error",
      completedSampleCount: 0,
      errorSampleCount: 1,
      metrics: { score: metricStats(1) },
    });

    const rollup = buildCandidateEvaluationRollup("skill_v3", [complete, error]);

    expect(rollup).toMatchObject({
      evaluationCount: 2,
      scoredEvaluationCount: 1,
      bestEvaluation: complete,
      bestScore: 0.6,
      bestConfigurationLabel: "Complete",
      meanScore: 0.6,
    });
    expect(resolveCandidateEvaluationRollupDisplay(rollup).countText).toBe("2 evaluations");
  });

  test("builds candidate rollups without candidate-owned metrics", () => {
    const rollups = buildCandidateEvaluationRollups([
      evaluationSummary({
        id: "eval_v1",
        candidateId: "skill_v1",
        candidateName: "Skill",
        candidateVersion: 1,
        metrics: { score: metricStats(0.4) },
      }),
      evaluationSummary({
        id: "eval_v2",
        candidateId: "skill_v2",
        candidateName: "Skill",
        candidateVersion: 2,
        metrics: { score: metricStats(0.8) },
      }),
    ]);

    expect(rollups.get("skill_v1")?.bestScore).toBe(0.4);
    expect(rollups.get("skill_v2")?.bestScore).toBe(0.8);
  });

  test("builds one stable presentation color per candidate", () => {
    const candidates = buildEvaluationCandidatePresentations([
      evaluationSummary({
        id: "eval_v3_opus",
        candidateId: "skill_v3",
        candidateName: "Skill",
        candidateVersion: 3,
        candidateRunName: "Claude Code w/ Opus 4.6",
      }),
      evaluationSummary({
        id: "eval_v1_codex",
        candidateId: "skill_v1",
        candidateName: "Skill",
        candidateVersion: 1,
        candidateRunName: "Codex w/ GPT-5.4",
      }),
      evaluationSummary({
        id: "eval_v3_codex",
        candidateId: "skill_v3",
        candidateName: "Skill",
        candidateVersion: 3,
        candidateRunName: "Codex w/ GPT-5.4",
      }),
    ]);

    expect(candidates).toEqual([
      { id: "skill_v1", label: "Skill v1", color: getCategoricalChartColor(0) },
      { id: "skill_v3", label: "Skill v3", color: getCategoricalChartColor(1) },
    ]);
    expect(buildEvaluationCandidateColorMap(candidates)).toEqual(new Map([
      ["skill_v1", getCategoricalChartColor(0)],
      ["skill_v3", getCategoricalChartColor(1)],
    ]));
  });

  test("uses runtime versions instead of id suffixes for evolved candidates", () => {
    const candidates = buildEvaluationCandidatePresentations([
      evaluationSummary({
        id: "eval_original",
        candidateId: "candidate_500e4be9aee3",
        candidateName: "Skill",
        candidateVersion: 1,
        candidateRunName: "Command",
      }),
      evaluationSummary({
        id: "eval_improved",
        candidateId: "candidate_1416fd53b1_001",
        candidateName: "Skill",
        candidateVersion: 2,
        candidateRunName: "Command",
      }),
      evaluationSummary({
        id: "eval_v3",
        candidateId: "skill_v3",
        candidateName: "Skill",
        candidateVersion: 3,
        candidateRunName: "Command",
      }),
    ]);

    expect(candidates.map((candidate) => candidate.label)).toEqual([
      "Skill v1",
      "Skill v2",
      "Skill v3",
    ]);
  });
});

function evaluationSummary(
  overrides: Partial<EvaluationSummary> = {},
): EvaluationSummary {
  return {
    id: "eval_test",
    runId: "run_test",
    benchmarkFingerprint: "benchmark",
    candidateFingerprint: "candidate-fingerprint",
    candidateId: "candidate_test",
    candidateVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "completed",
    sampleCount: 1,
    completedSampleCount: 1,
    errorSampleCount: 0,
    ...overrides,
  };
}

function metricStats(value: number) {
  return {
    count: 1,
    mean: value,
    variance: 0,
    stddev: 0,
    min: value,
    max: value,
  };
}
