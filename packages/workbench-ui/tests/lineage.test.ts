import { describe, expect, test } from "vitest";

import { buildVersionLineageFlow, buildVersionLineageGraph } from "../src/lib/lineage";
import type {
  WorkbenchJob,
  WorkbenchLineageEdge,
  WorkbenchRun,
  WorkbenchVersion,
} from "@workbench-ai/workbench-contract";

describe("version lineage", () => {
  test("keeps parent-child edges in version order", () => {
    const graph = buildVersionLineageGraph({
      selectedVersionId: "v002",
      publishedVersionId: "v001",
      versions: [
        version("v002", { parentIds: ["v001"], createdAt: "2026-01-01T00:01:00.000Z" }),
        version("v001"),
      ],
      lineage: [edge("v001", "v002", "improve")],
      runs: [
        run({
          id: "run_old",
          versionId: "v002",
          createdAt: "2026-01-01T00:03:00.000Z",
          jobIds: ["job_old"],
        }),
        run({
          id: "run_new",
          versionId: "v002",
          createdAt: "2026-01-01T00:04:00.000Z",
          jobIds: ["job_new"],
        }),
      ],
      jobs: [
        gradeJob("job_old", "run_old", 0.5),
        gradeJob("job_new", "run_new", 0.9),
      ],
    });

    expect(graph.edgeCount).toBe(1);
    expect(graph.roots).toEqual(["v001"]);
    const child = graph.nodes.find((node) => node.version.id === "v002");
    expect(child?.selected).toBe(true);
    expect(child?.score).toBe(0.9);
    expect(child?.improvedFromLabel).toContain("1");
    const parent = graph.nodes.find((node) => node.version.id === "v001");
    expect(parent?.published).toBe(true);
    expect(parent?.score).toBeNull();
  });

  test("ignores self references and missing versions", () => {
    const graph = buildVersionLineageGraph({
      versions: [version("v001")],
      lineage: [
        edge("v001", "v001"),
        edge("missing", "v001"),
        edge("v001", "missing"),
      ],
    });

    expect(graph.edgeCount).toBe(0);
    expect(graph.roots).toHaveLength(1);
    expect(graph.nodes[0]?.improvedFromLabel).toBeNull();
  });

  test("dedupes repeated parent-child edges for graph and flow consumers", async () => {
    const duplicate = edge("v001", "v002");
    const graph = buildVersionLineageGraph({
      versions: [
        version("v002", { parentIds: ["v001"], createdAt: "2026-01-01T00:01:00.000Z" }),
        version("v001"),
      ],
      lineage: [edge("v001", "v002"), { ...duplicate, createdAt: "2026-01-01T00:05:00.000Z" }],
    });

    expect(graph.edgeCount).toBe(1);
    expect(graph.edges).toHaveLength(1);

    const flow = await buildVersionLineageFlow({
      versions: [
        version("v002", { parentIds: ["v001"], createdAt: "2026-01-01T00:01:00.000Z" }),
        version("v001"),
      ],
      lineage: [edge("v001", "v002"), { ...duplicate, createdAt: "2026-01-01T00:05:00.000Z" }],
    });

    expect(flow.edges).toHaveLength(1);
    expect(new Set(flow.edges.map((entry) => entry.id)).size).toBe(flow.edges.length);
  });

  test("keeps disconnected versions inspectable", () => {
    const graph = buildVersionLineageGraph({
      versions: [version("v002"), version("v001")],
      lineage: [],
    });

    expect(graph.roots).toEqual(["v001", "v002"]);
  });
});

function version(id: string, overrides: Partial<WorkbenchVersion> = {}): WorkbenchVersion {
  return {
    id,
    hash: `${id}_hash`,
    message: id,
    parentIds: [],
    createdAt: id === "v001" ? "2026-01-01T00:00:00.000Z" : "2026-01-01T00:02:00.000Z",
    files: [],
    ...overrides,
  };
}

function edge(parentId: string, childId: string, reason = "version"): WorkbenchLineageEdge {
  return {
    parentId,
    childId,
    reason,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function run(overrides: Partial<WorkbenchRun> & { id: string; versionId: string }): WorkbenchRun {
  return {
    kind: "eval",
    skillName: "current",
    skillBundleHash: "bundle",
    evalHash: "eval",
    agentName: "patcher",
    agentHash: "agent",
    status: "succeeded",
    jobIds: [],
    traceIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function gradeJob(id: string, runId: string, score: number): WorkbenchJob {
  return {
    id,
    runId,
    kind: "eval",
    role: "grade",
    versionId: "v002",
    skillName: "current",
    skillBundleHash: "bundle",
    evalHash: "eval",
    agentName: "patcher",
    agentHash: "agent",
    caseId: "case-001",
    sample: 0,
    status: "succeeded",
    result: { items: [{ kind: "score", score, value: score }] },
    artifactIds: [],
    traceIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}
