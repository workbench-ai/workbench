import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import type { WorkbenchInspectionSnapshot } from "@workbench-ai/workbench-contract";
import { WorkbenchWorkspace } from "../src/app";
import { loadWorkbenchWorkspaceInitialData } from "../src/lib/initial-data";
import {
  buildWorkbenchLocationHref,
  createSkillRoute,
  parseWorkbenchLocation,
  parseWorkbenchRoute,
  routeSkillSurfaceFile,
  routeSkillSurfaceView,
  withSkillSurface,
} from "../src/lib/routes";

describe("skill-first Workbench UI helpers", () => {
  test("parses and builds skill-first master-detail routes", () => {
    const base = "/skills/alice/earnings";
    expect(parseWorkbenchRoute("/", "/")).toEqual(createSkillRoute());
    expect(parseWorkbenchLocation(`${base}/manifest`, base))
      .toEqual({ kind: "skill", view: "manifest", file: emptyFileRouteState() });
    expect(buildWorkbenchLocationHref(createSkillRoute({ view: "manifest" }), base))
      .toBe(`${base}/manifest`);
    expect(parseWorkbenchLocation(`${base}/versions`, base))
      .toEqual({ kind: "versions", view: "archive" });
    expect(parseWorkbenchLocation(`${base}/versions/lineage`, base))
      .toEqual({ kind: "versions", view: "lineage" });
    expect(parseWorkbenchLocation(`${base}/versions/lineage?skill=manifest`, base))
      .toEqual({ kind: "versions", view: "lineage", skillView: "manifest", skillFile: undefined });
    expect(buildWorkbenchLocationHref(
      withSkillSurface({ kind: "versions", view: "lineage" }, { skillView: "manifest" }),
      base,
    )).toBe(`${base}/versions/lineage?skill=manifest`);
    const versionsWithSkillFiles = withSkillSurface(
      { kind: "versions", view: "lineage" },
      { skillView: "files", skillFile: { filePath: "SKILL.md", directoryPath: null, previewMode: "raw" } },
    );
    expect(routeSkillSurfaceView(versionsWithSkillFiles)).toBe("files");
    expect(routeSkillSurfaceFile(versionsWithSkillFiles)).toEqual({
      filePath: "SKILL.md",
      directoryPath: null,
      previewMode: "raw",
    });
    expect(buildWorkbenchLocationHref(versionsWithSkillFiles, base))
      .toBe(`${base}/versions/lineage?skill=files&skillFile=SKILL.md&skillPreview=raw`);
    expect(parseWorkbenchLocation(`${base}/versions/v002/files?file=SKILL.md&view=raw`, base))
      .toEqual({
        kind: "version",
        versionId: "v002",
        view: "files",
        file: { filePath: "SKILL.md", directoryPath: null, previewMode: "raw" },
      });
    expect(parseWorkbenchLocation(`${base}/skills/primary`, base))
      .toEqual({ kind: "skill-source", skillName: "primary" });
    expect(parseWorkbenchLocation(`${base}/agents/patcher`, base))
      .toEqual({ kind: "agent", agentName: "patcher" });
    expect(parseWorkbenchLocation(`${base}/runs/run_001/jobs`, base))
      .toEqual({ kind: "run", runId: "run_001", view: "jobs" });
    expect(parseWorkbenchLocation(`${base}/traces/trace_001/files?file=output%2Fresult.json`, base))
      .toEqual({
        kind: "trace",
        traceId: "trace_001",
        view: "files",
        file: { filePath: "output/result.json", directoryPath: null, previewMode: "rendered" },
      });
    expect(buildWorkbenchLocationHref({ kind: "artifact", artifactId: "artifact_001", view: "overview", file: emptyFileRouteState() }, base))
      .toBe(`${base}/artifacts/artifact_001`);
    expect(buildWorkbenchLocationHref({
      kind: "artifact",
      artifactId: "artifact_001",
      view: "files",
      file: { filePath: "output/result.json", directoryPath: "output", previewMode: "raw" },
    }, base)).toBe(`${base}/artifacts/artifact_001/files?file=output%2Fresult.json&dir=output&view=raw`);
  });

  test("loads supplied inspection data or falls back to the shared reader", async () => {
    const snapshot = inspectionSnapshot();
    const inspection = { snapshot: vi.fn(async () => snapshot) };

    await expect(loadWorkbenchWorkspaceInitialData({ inspection, snapshot })).resolves.toBe(snapshot);
    expect(inspection.snapshot).not.toHaveBeenCalled();

    await expect(loadWorkbenchWorkspaceInitialData({ inspection })).resolves.toBe(snapshot);
    expect(inspection.snapshot).toHaveBeenCalledTimes(1);
  });

  test("renders overview evidence in the shared workspace shell", () => {
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: inspectionSnapshot(),
    }));

    expect(html).toContain("Workbench Skills");
    expect(html).toContain("Manifest");
    expect(html).toContain("Snapshot");
    expect(html).toContain("Best configuration");
    expect(html).toContain("v002 / primary / patcher");
    expect(html).toContain("score 0.920");
    expect(html).toContain("Latest improvement");
    expect(html).toContain("v001 -&gt; v002");
    expect(html).toContain("Runtime posture");
    expect(html).toContain("2 open-network agents, 1 isolated or default agents.");
    expect(html).not.toContain("wb-shell");
  });

  test("renders route indexes from the master pane", () => {
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: inspectionSnapshot(),
      initialRoute: withSkillSurface(
        { kind: "execution", view: "traces" },
        { skillView: "manifest" },
      ),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("Skill Sources");
    expect(html).toContain("Refs and Remotes");
    expect(html).toContain("Traces");
    expect(html).toContain("trace_eval");
    expect(html).toContain("trace_improve");
    expect(html).toContain("run_eval");
    expect(html).not.toContain("Execution Summary");
  });

  test("renders the skill manifest as primary context", () => {
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: inspectionSnapshot(),
      initialRoute: createSkillRoute({ view: "manifest" }),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("Skill Sources");
    expect(html).toContain("Refs and Remotes");
    expect(html).toContain("Published version");
    expect(html).toContain("/api/workbench/public/skills/acme/skill/source");
    expect(html).toContain("/api/workbench/public/skills/acme/skill/releases/v002/source");
    expect(html).toContain("patcher");
    expect(html).not.toContain("Version Context");
  });

  test("renders route-level run, trace, and artifact details", () => {
    const snapshot = inspectionSnapshot();
    const runHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: snapshot,
      initialRoute: { kind: "run", runId: "run_eval", view: "overview" },
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(runHtml).toContain("Run run_eval");
    expect(runHtml).toContain("job_001");
    expect(runHtml).toContain("trace_eval");

    const traceHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: snapshot,
      initialRoute: { kind: "trace", traceId: "trace_eval", view: "payload", file: emptyFileRouteState() },
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(traceHtml).toContain("Trace trace_eval");
    expect(traceHtml).toContain("&quot;caseId&quot;: &quot;case_001&quot;");
    expect(traceHtml).toContain("&quot;ok&quot;: true");

    const artifactHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: snapshot,
      initialRoute: { kind: "artifact", artifactId: "artifact_001", view: "overview", file: emptyFileRouteState() },
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(artifactHtml).toContain("Artifact artifact_001");
    expect(artifactHtml).toContain("report.md");
  });

  test("renders file routes through the shared file browser scaffold", () => {
    const snapshot = inspectionSnapshot();
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: snapshot,
      initialRoute: {
        kind: "trace",
        traceId: "trace_eval",
        view: "files",
        file: { filePath: "output/result.json", directoryPath: "output", previewMode: "rendered" },
      },
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("Trace Files");
    expect(html).toContain("Previewing output/result.json");
    expect(html).toContain("output/result.json");
    expect(html).not.toContain("QUJD");
  });
});

function emptyFileRouteState() {
  return { filePath: null, directoryPath: null, previewMode: "rendered" as const };
}

function inspectionSnapshot(): WorkbenchInspectionSnapshot {
  return {
    root: "/tmp/skill",
    status: {
      root: "/tmp/skill",
      initialized: true,
      currentVersionId: "v002",
      hasUnversionedChanges: false,
      defaultSkill: "primary",
      defaultAgent: "patcher",
      versionCount: 2,
      skillCount: 1,
      agentCount: 3,
      runCount: 2,
      remoteCount: 1,
      automationReadiness: {
        level: "review",
        label: "Review",
        reason: "Latest run should stay reviewed.",
        runId: "run_eval",
        score: 0.92,
        caseCount: 2,
        jobCount: 4,
      },
    },
    versions: [{
      id: "v001",
      hash: "hash_v001_abcdef",
      message: "initial",
      parentIds: [],
      createdAt: "2026-06-06T00:00:00.000Z",
      files: [{ path: "SKILL.md", kind: "text", encoding: "utf8", content: "" }],
    }, {
      id: "v002",
      hash: "hash_v002_abcdef",
      message: "improved",
      parentIds: ["v001"],
      createdAt: "2026-06-06T00:05:00.000Z",
      files: [{ path: "SKILL.md", kind: "text", encoding: "utf8", content: "" }],
    }],
    skillSources: [{ name: "primary", kind: "local", path: "." }],
    skillBundles: [{
      hash: "skill_bundle_hash",
      skillName: "primary",
      entryName: "primary",
      source: { name: "primary", kind: "local", path: "." },
      files: [{ path: "SKILL.md", kind: "text", encoding: "utf8", content: "" }],
      includedSkills: [],
      createdAt: "2026-06-06T00:00:00.000Z",
    }],
    agents: [{
      name: "patcher",
      adapter: "command",
      model: "deterministic",
      config: {
        image: "node:22",
        network: "on",
        timeoutMinutes: 7,
      },
    }, {
      name: "custom-open",
      adapter: "command",
      model: "deterministic",
      config: { network: "bridge" },
    }, {
      name: "explicit-off",
      adapter: "command",
      model: "deterministic",
      config: { network: "off" },
    }],
    runs: [{
      id: "run_eval",
      kind: "eval",
      versionId: "v002",
      skillName: "primary",
      skillBundleHash: "skill_bundle_hash",
      evalHash: "eval_hash",
      agentName: "patcher",
      agentHash: "agent_hash",
      status: "succeeded",
      score: 0.92,
      latencyMs: 1500,
      costUsd: 0.1234,
      jobIds: ["job_001"],
      traceIds: ["trace_eval"],
      createdAt: "2026-06-06T00:10:00.000Z",
      finishedAt: "2026-06-06T00:11:00.000Z",
    }, {
      id: "run_improve",
      kind: "improve",
      versionId: "v001",
      outputVersionId: "v002",
      skillName: "primary",
      skillBundleHash: "skill_bundle_hash",
      evalHash: "eval_hash",
      agentName: "patcher",
      agentHash: "agent_hash",
      status: "succeeded",
      score: 0.92,
      jobIds: ["job_001"],
      traceIds: ["trace_improve"],
      createdAt: "2026-06-06T00:05:00.000Z",
      finishedAt: "2026-06-06T00:06:00.000Z",
    }],
    jobs: [{
      id: "job_001",
      runId: "run_eval",
      kind: "eval",
      versionId: "v002",
      skillName: "primary",
      skillBundleHash: "skill_bundle_hash",
      evalHash: "eval_hash",
      agentName: "patcher",
      agentHash: "agent_hash",
      caseId: "case_001",
      sample: 0,
      status: "succeeded",
      score: 0.92,
      dockerImage: "node:22",
      artifactIds: ["artifact_001"],
      traceIds: ["trace_eval"],
      createdAt: "2026-06-06T00:10:00.000Z",
      startedAt: "2026-06-06T00:10:01.000Z",
      finishedAt: "2026-06-06T00:10:02.000Z",
      durationMs: 1000,
    }],
    traces: [{
      id: "trace_eval",
      runId: "run_eval",
      jobId: "job_001",
      versionId: "v002",
      skillName: "primary",
      skillBundleHash: "skill_bundle_hash",
      agentName: "patcher",
      createdAt: "2026-06-06T00:10:01.000Z",
      request: { caseId: "case_001" },
      result: { ok: true },
      files: [
        { path: "output/result.json", kind: "text", encoding: "utf8", content: "{\"ok\":true}\n" },
        { path: "output/blob.bin", kind: "binary", encoding: "base64", content: "QUJD" },
      ],
    }, {
      id: "trace_improve",
      runId: "run_improve",
      versionId: "v001",
      skillName: "primary",
      skillBundleHash: "skill_bundle_hash",
      agentName: "patcher",
      createdAt: "2026-06-06T00:05:01.000Z",
      request: { improvementMode: "command" },
      result: {},
      files: [],
    }],
    artifacts: [{
      id: "artifact_001",
      runId: "run_eval",
      jobId: "job_001",
      kind: "file",
      path: "report.md",
      createdAt: "2026-06-06T00:10:03.000Z",
      files: [{ path: "report.md", kind: "text", encoding: "utf8", content: "# Report\n" }],
    }],
    lineage: [{
      parentId: "v001",
      childId: "v002",
      runId: "run_improve",
      reason: "improve",
      createdAt: "2026-06-06T00:06:00.000Z",
      message: "improved",
    }],
    remotes: [{
      name: "origin",
      url: "https://v2.workbench.ai/skills/acme/skill",
      type: "workbench",
    }],
    refs: {
      current: "v002",
      published: "v002",
      "releases/v002": "v002",
    },
    publication: {
      versionId: "v002",
      installUrl: "/api/workbench/public/skills/acme/skill/source",
      pinnedInstallUrl: "/api/workbench/public/skills/acme/skill/releases/v002/source",
    },
  };
}
