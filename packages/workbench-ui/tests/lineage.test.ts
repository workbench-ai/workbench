import { describe, expect, test } from "vitest";

import { buildLineageFlow } from "../src/lib/lineage";
import { formatSubjectSelectionLabel } from "../src/lib/format";
import type { SubjectSummary, RuntimeSnapshot } from "../src/types";

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

function snapshot(summaries: SubjectSummary[]): RuntimeSnapshot {
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

describe("subject lineage", () => {
  test("ignores self references instead of rendering a self edge", async () => {
    const summary = subject("subject_self", {
      baseId: "subject_self",
      referenceIds: ["subject_self"],
    });

    const flow = await buildLineageFlow(snapshot([summary]));

    expect(flow.nodes).toHaveLength(1);
    expect(flow.edges).toEqual([]);
    expect(formatSubjectSelectionLabel({ summary })).toContain("Genesis subject");
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
});
