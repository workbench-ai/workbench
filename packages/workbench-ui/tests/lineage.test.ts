import { describe, expect, test } from "vitest";

import { buildLineageFlow } from "../src/lib/lineage";
import { formatCandidateSelectionLabel } from "../src/lib/format";
import type { EvaluationSummary, CandidateSummary, BenchmarkSnapshot } from "../src/types";

function candidate(id: string, overrides: Partial<CandidateSummary> = {}): CandidateSummary {
  return {
    id,
    version: 1,
    ordinal: 1,
    benchmarkFingerprint: "benchmark",
    createdAt: "2026-01-01T00:00:00.000Z",
    referenceIds: [],
    status: "evaluated",
    fileChanges: [],
    ...overrides,
  };
}

function evaluation(
  id: string,
  candidateId: string,
  updatedAt: string,
  score: number,
): EvaluationSummary {
  return {
    id,
    runId: `run_${id}`,
    benchmarkFingerprint: "benchmark",
    candidateFingerprint: `fingerprint_${candidateId}`,
    candidateId,
    candidateVersion: 1,
    createdAt: updatedAt,
    updatedAt,
    status: "completed",
    sampleCount: 1,
    completedSampleCount: 1,
    errorSampleCount: 0,
    metrics: {
      score: {
        count: 1,
        mean: score,
        variance: 0,
        stddev: 0,
        min: score,
        max: score,
      },
    },
  };
}

function snapshot(
  summaries: CandidateSummary[],
  evaluations: EvaluationSummary[] = [],
): BenchmarkSnapshot {
  return {
    workspaceRoot: "/workspace",
    activeId: summaries[0]?.id ?? null,
    currentBenchmarkFingerprint: "benchmark",
    summaries,
    evaluations,
    runs: [],
  };
}

describe("candidate lineage", () => {
  test("ignores self references instead of rendering a self edge", async () => {
    const summary = candidate("candidate_self", {
      baseId: "candidate_self",
      referenceIds: ["candidate_self"],
    });

    const flow = await buildLineageFlow(snapshot([summary]));

    expect(flow.nodes).toHaveLength(1);
    expect(flow.edges).toEqual([]);
    expect(formatCandidateSelectionLabel({ summary })).toContain("Initial");
  });

  test("keeps explicit improve parent edges", async () => {
    const flow = await buildLineageFlow(snapshot([
      candidate("candidate_parent"),
      candidate("candidate_child", { baseId: "candidate_parent" }),
    ]));

    expect(flow.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
    }))).toEqual([
      {
        source: "candidate:candidate_parent",
        target: "candidate:candidate_child",
      },
    ]);
  });

  test("ignores benchmark references when building lineage", async () => {
    const flow = await buildLineageFlow(snapshot([
      candidate("candidate_reference"),
      candidate("candidate_child", { referenceIds: ["candidate_reference"] }),
    ]));

    expect(flow.edges).toEqual([]);
  });

  test("shows best evaluation rollup instead of candidate metric dumps", async () => {
    const flow = await buildLineageFlow(snapshot(
      [
        candidate("candidate_latest"),
      ],
      [
        evaluation("eval_old", "candidate_latest", "2026-01-01T00:00:00.000Z", 0.2),
        evaluation("eval_new", "candidate_latest", "2026-01-02T00:00:00.000Z", 0.88),
      ],
    ));

    expect(flow.nodes[0]?.data.scoreText).toBe("Best score 0.88");
    expect(flow.nodes[0]?.data.sourceText).toBeUndefined();
    expect(flow.nodes[0]?.data.metricText).toBeUndefined();
    expect(flow.nodes[0]?.ariaLabel).toContain("Best score 0.88");
  });
});
