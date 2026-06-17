import { describe, expect, test } from "vitest";

import {
  assertWorkbenchAdapterAuthEnvNameAllowed,
  isWorkbenchLocalMetadataPath,
  isReservedWorkbenchAdapterAuthEnvName,
  normalizeWorkbenchSourcePath,
  normalizeWorkbenchSourceRequestPath,
  parseWorkbenchCaseFileOwnerId,
  workbenchCaseFileOwnerId,
  workbenchInspectionFileOwnerKindFromRouteSegment,
  workbenchInspectionFileOwnerRouteSegment,
  workbenchInspectionFileContent,
  workbenchInspectionFileContentUnavailableReason,
  workbenchInspectionFileManifest,
  type WorkbenchInspectionFileContent,
  type WorkbenchInspectionSnapshot,
  type WorkbenchInspectionSnapshotEnvelope,
  type WorkbenchProjectState,
  type WorkbenchRun,
  type WorkbenchRunSnapshot,
} from "../src/index";

describe("workbench contract", () => {
  test("keeps skill state and inspection snapshots as plain serializable DTOs", () => {
    const state = {
      schema: "workbench.skill.state.v1",
      root: "/tmp/skill",
      refs: { current: "v001" },
      remotes: {
        origin: { name: "origin", url: "https://workbench.example/skills/acme/skill", kind: "workbench-cloud" },
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
      executionEvents: [],
      artifacts: [],
      lineage: [],
    } satisfies WorkbenchProjectState;
    const snapshot = {
      root: state.root,
      status: {
        root: state.root,
        initialized: true,
        currentVersionId: "v001",
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
      evals: state.evals,
      agents: [{ hash: "agent_hash", agent: state.agents[0]! }],
      runs: state.runs,
      jobs: state.jobs,
      traces: state.traces,
      executionEvents: state.executionEvents,
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
    const envelope = {
      schema: "workbench.inspection.snapshot-envelope.v1",
      cursor: "cursor_001",
      snapshot,
      actions: {
        variant: "local",
        evidenceAccess: "full",
        eval: {
          enabled: true,
          defaultRequest: { kind: "eval", variant: "local", samples: 1 },
        },
        improve: {
          enabled: false,
          defaultRequest: { kind: "improve", variant: "local", samples: 1, budget: 1 },
          disabledReason: "No improvement evidence is available.",
        },
        acquisition: [{
          id: "open-local",
          label: "Open local project",
          kind: "copy-command",
          value: "workbench open",
        }],
      },
    } satisfies WorkbenchInspectionSnapshotEnvelope;

    expect(JSON.parse(JSON.stringify({ state, snapshot, fileContent, envelope }))).toMatchObject({
      state: { schema: "workbench.skill.state.v1", refs: { current: "v001" } },
      snapshot: { status: { initialized: true }, refs: { current: "v001" } },
      fileContent: { path: "output/blob.bin", unavailableReason: "Binary file content is not rendered." },
      envelope: {
        actions: {
          variant: "local",
          eval: { enabled: true, defaultRequest: { kind: "eval", variant: "local" } },
          improve: { enabled: false, defaultRequest: { kind: "improve", variant: "local" } },
          acquisition: [{ label: "Open local project" }],
        },
      },
    });
  });

  test("keeps dangerous adapter auth env names reserved", () => {
    expect(isReservedWorkbenchAdapterAuthEnvName("WORKBENCH_TOKEN")).toBe(true);
    expect(() => assertWorkbenchAdapterAuthEnvNameAllowed("PATH")).toThrow("reserved");
    expect(() => assertWorkbenchAdapterAuthEnvNameAllowed("OPENAI_API_KEY")).not.toThrow();
  });

  test("serializes run snapshots and stored retry plans as the canonical launch contract", () => {
    const snapshot = {
      schema: "workbench.run.v1",
      id: "run_matrix",
      kind: "eval",
      variant: "local",
      status: "running",
      phase: "running",
      plan: {
        kind: "eval",
        variant: "local",
        versionId: "v002",
        evalHash: "eval_hash",
        skills: ["primary", "baseline"],
        agents: ["default"],
        samples: 2,
        rerun: true,
      },
      progress: {
        planned: 4,
        completed: 1,
        scored: 1,
        failed: 0,
        canceled: 0,
        partialScore: 1,
        evidenceCount: 2,
        elapsedMs: 1000,
        lastProgressAt: "2026-06-16T12:00:00.000Z",
      },
      measurements: [{
        versionId: "v002",
        skillName: "primary",
        skillBundleHash: "bundle_primary",
        evalHash: "eval_hash",
        agentName: "default",
        agentHash: "agent_hash",
        runId: "run_matrix",
        status: "running",
        score: 1,
        samples: 1,
      }],
      route: {
        kind: "run",
        runId: "run_matrix",
        source: "evaluation",
        evaluationId: "eval_hash",
      },
      cliEquivalent: "workbench eval --skills all -n 2",
      next: "workbench run watch run_matrix",
    } satisfies WorkbenchRunSnapshot;

    expect(JSON.parse(JSON.stringify({ snapshot }))).toMatchObject({
      snapshot: {
        schema: "workbench.run.v1",
        id: "run_matrix",
        progress: { planned: 4, partialScore: 1 },
        route: { runId: "run_matrix" },
        plan: { rerun: true },
        next: "workbench run watch run_matrix",
      },
    });

    const run = {
      id: "run_with_plan",
      kind: "eval",
      versionId: "v002",
      skillName: "primary",
      skillBundleHash: "bundle_primary",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "running",
      operationPlan: snapshot.plan,
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-16T12:00:00.000Z",
    } satisfies WorkbenchRun;
    expect(JSON.parse(JSON.stringify(run))).toMatchObject({
      id: "run_with_plan",
      operationPlan: {
        kind: "eval",
        variant: "local",
        versionId: "v002",
        skills: ["primary", "baseline"],
        agents: ["default"],
        samples: 2,
      },
    });
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

  test("defines inspection file owner route vocabulary", () => {
    expect(workbenchInspectionFileOwnerKindFromRouteSegment("versions")).toBe("version");
    expect(workbenchInspectionFileOwnerKindFromRouteSegment("traces")).toBe("trace");
    expect(workbenchInspectionFileOwnerKindFromRouteSegment("artifacts")).toBe("artifact");
    expect(workbenchInspectionFileOwnerKindFromRouteSegment("cases")).toBe("case");
    expect(workbenchInspectionFileOwnerKindFromRouteSegment("skills")).toBeNull();

    expect(workbenchInspectionFileOwnerRouteSegment("version")).toBe("versions");
    expect(workbenchInspectionFileOwnerRouteSegment("trace")).toBe("traces");
    expect(workbenchInspectionFileOwnerRouteSegment("artifact")).toBe("artifacts");
    expect(workbenchInspectionFileOwnerRouteSegment("case")).toBe("cases");
  });

  test("round-trips case file owner ids", () => {
    expect(workbenchCaseFileOwnerId("eval_hash", "case-001")).toBe("eval_hash:case-001");
    expect(parseWorkbenchCaseFileOwnerId("eval_hash:case-001")).toEqual({
      evaluationHash: "eval_hash",
      caseId: "case-001",
    });
    expect(parseWorkbenchCaseFileOwnerId("eval_hash:case:with:colon")).toEqual({
      evaluationHash: "eval_hash",
      caseId: "case:with:colon",
    });
    expect(parseWorkbenchCaseFileOwnerId("eval_hash")).toBeNull();
    expect(parseWorkbenchCaseFileOwnerId(":case-001")).toBeNull();
  });

  test("normalizes source paths and identifies local Workbench metadata", () => {
    expect(normalizeWorkbenchSourcePath(".workbench/eval.yaml")).toBe(".workbench/eval.yaml");
    expect(normalizeWorkbenchSourceRequestPath("/.workbench/eval.yaml")).toBe(".workbench/eval.yaml");
    expect(() => normalizeWorkbenchSourcePath("/.workbench/eval.yaml")).toThrow(/Unsafe Workbench source path/u);
    expect(() => normalizeWorkbenchSourcePath("../state")).toThrow(/Unsafe Workbench source path/u);
    expect(() => normalizeWorkbenchSourcePath("source//SKILL.md")).toThrow(/Unsafe Workbench source path/u);

    expect(isWorkbenchLocalMetadataPath(".workbench/remotes.yaml")).toBe(true);
    expect(isWorkbenchLocalMetadataPath(".workbench/locks/project.lock")).toBe(true);
    expect(isWorkbenchLocalMetadataPath(".workbench/objects/run/run_001.json")).toBe(true);
    expect(isWorkbenchLocalMetadataPath(".workbench/eval.yaml")).toBe(false);
    expect(isWorkbenchLocalMetadataPath("SKILL.md")).toBe(false);
  });
});
