import { describe, expect, test } from "vitest";

import { buildVersionLineageGraph } from "../src/lib/lineage";
import type {
  WorkbenchLineageEdge,
  WorkbenchVersion,
} from "@workbench-ai/workbench-contract";

describe("version lineage", () => {
  test("keeps parent-child edges in version order", () => {
    const graph = buildVersionLineageGraph({
      currentVersionId: "v002",
      versions: [
        version("v002", { parentIds: ["v001"], createdAt: "2026-01-01T00:01:00.000Z" }),
        version("v001"),
      ],
      lineage: [edge("v001", "v002")],
    });

    expect(graph.edgeCount).toBe(1);
    expect(graph.roots).toEqual(["v001"]);
    expect(graph.nodes.find((node) => node.version.id === "v001")?.childCount).toBe(1);
    expect(graph.nodes.find((node) => node.version.id === "v002")?.active).toBe(true);
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
    expect(graph.nodes[0]?.childCount).toBe(0);
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

function edge(parentId: string, childId: string): WorkbenchLineageEdge {
  return {
    parentId,
    childId,
    reason: "version",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}
