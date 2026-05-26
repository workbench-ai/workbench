import { describe, expect, test } from "vitest";

import { buildLineageFlow } from "../src/lib/lineage";
import { formatSubjectSelectionLabel } from "../src/lib/format";
import type { EvaluationSummary, SubjectSummary, BenchmarkSnapshot } from "../src/types";

function subject(id: string, overrides: Partial<SubjectSummary> = {}): SubjectSummary {
  return {
    id,
    ordinal: 0,
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
  subjectId: string,
  updatedAt: string,
  score: number,
): EvaluationSummary {
  return {
    id,
    runId: `run_${id}`,
    benchmarkFingerprint: "benchmark",
    subjectFingerprint: `fingerprint_${subjectId}`,
    subjectId,
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
  summaries: SubjectSummary[],
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

describe("subject lineage", () => {
  test("ignores self references instead of rendering a self edge", async () => {
    const summary = subject("subject_self", {
      baseId: "subject_self",
      referenceIds: ["subject_self"],
    });

    const flow = await buildLineageFlow(snapshot([summary]));

    expect(flow.nodes).toHaveLength(1);
    expect(flow.edges).toEqual([]);
    expect(formatSubjectSelectionLabel({ summary })).toContain("Initial");
  });

  test("keeps explicit improve parent edges", async () => {
    const flow = await buildLineageFlow(snapshot([
      subject("subject_parent"),
      subject("subject_child", { baseId: "subject_parent" }),
    ]));

    expect(flow.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
    }))).toEqual([
      {
        source: "subject:subject_parent",
        target: "subject:subject_child",
      },
    ]);
  });

  test("ignores benchmark references when building lineage", async () => {
    const flow = await buildLineageFlow(snapshot([
      subject("subject_reference"),
      subject("subject_child", { referenceIds: ["subject_reference"] }),
    ]));

    expect(flow.edges).toEqual([]);
  });

  test("shows latest evaluation score instead of subject metric dumps", async () => {
    const flow = await buildLineageFlow(snapshot(
      [
        subject("subject_latest", {
          metrics: {
            custom_long_name: 1,
            score: 0.2,
          },
        }),
      ],
      [
        evaluation("eval_old", "subject_latest", "2026-01-01T00:00:00.000Z", 0.2),
        evaluation("eval_new", "subject_latest", "2026-01-02T00:00:00.000Z", 0.88),
      ],
    ));

    expect(flow.nodes[0]?.data.scoreText).toBe("Score 0.88");
    expect(flow.nodes[0]?.data.sourceText).toBe("Latest evaluation eval_new");
    expect(flow.nodes[0]?.data.metricText).toBeUndefined();
    expect(flow.nodes[0]?.ariaLabel).toContain("Score 0.88 from Latest evaluation eval_new");
  });
});
