import { describe, expect, test } from "vitest";

import { buildLineageFlow } from "../src/lib/lineage";
import { formatCandidateSelectionLabel } from "../src/lib/format";
import type { CandidateSummary, RuntimeSnapshot } from "../src/types";

function candidate(id: string, overrides: Partial<CandidateSummary> = {}): CandidateSummary {
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

function snapshot(summaries: CandidateSummary[]): RuntimeSnapshot {
  return {
    workspaceRoot: "/workspace",
    activeId: summaries[0]?.id ?? null,
    currentBenchmarkFingerprint: "benchmark",
    summaries,
    results: [],
    events: [],
    latestRun: null,
    runs: [],
  };
}

describe("candidate lineage", () => {
  test("ignores self references instead of rendering a self edge", async () => {
    const summary = candidate("cand_self", {
      baseId: "cand_self",
      referenceIds: ["cand_self"],
    });

    const flow = await buildLineageFlow(snapshot([summary]));

    expect(flow.nodes).toHaveLength(1);
    expect(flow.edges).toEqual([]);
    expect(formatCandidateSelectionLabel({ summary })).toContain("Genesis candidate");
  });

  test("keeps explicit improve parent edges", async () => {
    const flow = await buildLineageFlow(snapshot([
      candidate("cand_parent"),
      candidate("cand_child", { baseId: "cand_parent" }),
    ]));

    expect(flow.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
    }))).toEqual([
      {
        source: "candidate:cand_parent",
        target: "candidate:cand_child",
      },
    ]);
  });

  test("ignores benchmark references when building lineage", async () => {
    const flow = await buildLineageFlow(snapshot([
      candidate("cand_reference"),
      candidate("cand_child", { referenceIds: ["cand_reference"] }),
    ]));

    expect(flow.edges).toEqual([]);
  });
});
