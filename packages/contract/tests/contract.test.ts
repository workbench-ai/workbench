import { describe, expect, test } from "vitest";

import {
  assertWorkbenchAdapterAuthEnvNameAllowed,
  isReservedWorkbenchAdapterAuthEnvName,
  workbenchInspectionFileContent,
  workbenchInspectionFileContentUnavailableReason,
  workbenchInspectionFileManifest,
  type WorkbenchInspectionFileContent,
  type WorkbenchInspectionSnapshot,
  type WorkbenchProjectState,
} from "../src/index";

describe("workbench contract", () => {
  test("keeps skill state and inspection snapshots as plain serializable DTOs", () => {
    const state = {
      schema: "workbench.skill.state.v1",
      root: "/tmp/skill",
      currentVersionId: "v001",
      refs: { current: "v001" },
      remotes: {
        origin: { name: "origin", url: "https://workbench.example/skills/acme/skill", type: "workbench" },
      },
      versions: [{
        id: "v001",
        hash: "hash",
        message: "initial",
        parentIds: [],
        createdAt: "2026-06-06T00:00:00.000Z",
        files: [{ path: "SKILL.md", content: "# Skill\n" }],
      }],
      skillSources: [{ name: "primary", kind: "local", path: "." }],
      skillBundles: [],
      evals: [],
      agents: [{ name: "default", adapter: "local", config: {} }],
      runs: [],
      jobs: [],
      traces: [],
      artifacts: [],
      lineage: [],
    } satisfies WorkbenchProjectState;
    const snapshot = {
      root: state.root,
      status: {
        root: state.root,
        initialized: true,
        currentVersionId: "v001",
        hasUnversionedChanges: false,
        defaultSkill: "primary",
        defaultAgent: "default",
        versionCount: 1,
        skillCount: 1,
        agentCount: 1,
        runCount: 0,
        remoteCount: 1,
      },
      versions: state.versions,
      skillSources: state.skillSources,
      skillBundles: state.skillBundles,
      agents: state.agents,
      runs: state.runs,
      jobs: state.jobs,
      traces: state.traces,
      artifacts: state.artifacts,
      lineage: state.lineage,
      remotes: Object.values(state.remotes),
      refs: state.refs,
    } satisfies WorkbenchInspectionSnapshot;
    const fileContent = {
      path: "output/blob.bin",
      kind: "binary",
      encoding: "base64",
      unavailableReason: "Binary file content is not rendered.",
    } satisfies WorkbenchInspectionFileContent;

    expect(JSON.parse(JSON.stringify({ state, snapshot, fileContent }))).toMatchObject({
      state: { schema: "workbench.skill.state.v1", currentVersionId: "v001" },
      snapshot: { status: { initialized: true }, refs: { current: "v001" } },
      fileContent: { path: "output/blob.bin", unavailableReason: "Binary file content is not rendered." },
    });
  });

  test("keeps dangerous adapter auth env names reserved", () => {
    expect(isReservedWorkbenchAdapterAuthEnvName("WORKBENCH_TOKEN")).toBe(true);
    expect(() => assertWorkbenchAdapterAuthEnvNameAllowed("PATH")).toThrow("reserved");
    expect(() => assertWorkbenchAdapterAuthEnvNameAllowed("OPENAI_API_KEY")).not.toThrow();
  });

  test("shapes inspection files consistently for manifests and explicit content reads", () => {
    const text = { path: "SKILL.md", kind: "text", encoding: "utf8", content: "# Skill\n" } as const;
    const binary = { path: "asset.bin", kind: "binary", encoding: "base64", content: "QUJD" } as const;

    expect(workbenchInspectionFileManifest(text)).toEqual({
      path: "SKILL.md",
      kind: "text",
      encoding: "utf8",
      content: "",
    });
    expect(workbenchInspectionFileContent(text)).toEqual({
      path: "SKILL.md",
      kind: "text",
      encoding: "utf8",
      content: "# Skill\n",
    });
    expect(workbenchInspectionFileContent(binary)).toEqual({
      path: "asset.bin",
      kind: "binary",
      encoding: "base64",
      unavailableReason: "Binary file content is not rendered.",
    });
    expect(workbenchInspectionFileContentUnavailableReason({ encoding: "base64" }))
      .toBe("Base64 file content is not rendered.");
  });
});
