import { describe, expect, test } from "vitest";

import { buildVersionLineageFlow, buildVersionLineageGraph } from "../src/lib/lineage";
import type {
  WorkbenchLineageEdge,
  WorkbenchVersion,
} from "@workbench-ai/workbench-contract";

describe("version lineage", () => {
  test("keeps parent-child edges in version order", () => {
    const graph = buildVersionLineageGraph({
      currentVersionId: "v002",
      publishedVersionId: "v001",
      versions: [
        version("v002", { parentIds: ["v001"], createdAt: "2026-01-01T00:01:00.000Z" }),
        version("v001"),
      ],
      lineage: [edge("v001", "v002", "improve")],
      runs: [
        {
          id: "run_old",
          kind: "eval",
          versionId: "v002",
          skillName: "primary",
          skillBundleHash: "bundle",
          evalHash: "eval",
          agentName: "patcher",
          agentHash: "agent",
          status: "succeeded",
          score: 0.5,
          jobIds: [],
          traceIds: [],
          createdAt: "2026-01-01T00:03:00.000Z",
        },
        {
          id: "run_new",
          kind: "eval",
          versionId: "v002",
          skillName: "primary",
          skillBundleHash: "bundle",
          evalHash: "eval",
          agentName: "patcher",
          agentHash: "agent",
          status: "succeeded",
          score: 0.9,
          jobIds: [],
          traceIds: [],
          createdAt: "2026-01-01T00:04:00.000Z",
        },
      ],
    });

    expect(graph.edgeCount).toBe(1);
    expect(graph.roots).toEqual(["v001"]);
    const child = graph.nodes.find((node) => node.version.id === "v002");
    expect(child?.active).toBe(true);
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
