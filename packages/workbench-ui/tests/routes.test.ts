import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { WorkbenchInspectionSnapshot } from "@workbench-ai/workbench-contract";
import { WorkbenchWorkspace } from "../src/app";
import {
  buildWorkbenchLocationHref,
  createScorecardRoute,
  createFilesRoute,
  createVersionsRoute,
  parseWorkbenchLocation,
  parseWorkbenchRoute,
  withInspector,
  withSurface,
} from "../src/lib/routes";

describe("skill-first Workbench UI helpers", () => {
  test("parses and builds the three-surface routes", () => {
    const base = "/skills/alice/earnings";
    expect(parseWorkbenchRoute("/", "/")).toEqual(createScorecardRoute());
    expect(parseWorkbenchLocation(base, base)).toEqual(createScorecardRoute());
    expect(parseWorkbenchLocation(`${base}/versions`, base))
      .toEqual(createVersionsRoute());
    expect(parseWorkbenchLocation(`${base}/versions/graph`, base))
      .toEqual(createVersionsRoute({ view: "graph" }));
    expect(parseWorkbenchLocation(`${base}/files?file=SKILL.md&view=raw`, base))
      .toEqual(createFilesRoute({
        file: { filePath: "SKILL.md", directoryPath: null, previewMode: "raw" },
      }));
    expect(buildWorkbenchLocationHref(createFilesRoute({
      file: { filePath: "SKILL.md", directoryPath: null, previewMode: "raw" },
    }), base)).toBe(`${base}/files?file=SKILL.md&view=raw`);
    expect(buildWorkbenchLocationHref(createVersionsRoute({ view: "graph" }), base))
      .toBe(`${base}/versions/graph`);
    expect(parseWorkbenchLocation(`${base}/settings`, base))
      .toEqual(createScorecardRoute());
    expect(parseWorkbenchLocation(`${base}/runs`, base))
      .toEqual(createScorecardRoute());
  });

  test("round-trips inspector routes on every surface", () => {
    const base = "/skills/alice/earnings";
    expect(parseWorkbenchLocation(`${base}/runs/run_001`, base))
      .toEqual(createScorecardRoute({ kind: "run", runId: "run_001" }));
    expect(buildWorkbenchLocationHref(createScorecardRoute({ kind: "run", runId: "run_001" }), base))
      .toBe(`${base}/runs/run_001`);
    expect(parseWorkbenchLocation(`${base}/versions/v002`, base))
      .toEqual(createVersionsRoute({ inspector: { kind: "version", versionId: "v002" } }));
    expect(buildWorkbenchLocationHref(createVersionsRoute({
      inspector: { kind: "version", versionId: "v002" },
    }), base)).toBe(`${base}/versions/v002`);
    expect(parseWorkbenchLocation(`${base}/versions/graph/versions/v002`, base))
      .toEqual(createVersionsRoute({ view: "graph", inspector: { kind: "version", versionId: "v002" } }));
    expect(parseWorkbenchLocation(`${base}/files/skills/primary`, base))
      .toEqual(createFilesRoute({ inspector: { kind: "skill-source", skillName: "primary" } }));
    expect(buildWorkbenchLocationHref(createFilesRoute({
      inspector: { kind: "skill-source", skillName: "primary" },
    }), base)).toBe(`${base}/files/skills/primary`);
    // Switching surfaces keeps the open inspector (and overlay) intact.
    expect(withSurface(
      createScorecardRoute({ kind: "version", versionId: "v002" }, { kind: "version-files" }),
      { kind: "versions", view: "list" },
    )).toEqual(createVersionsRoute({
      inspector: { kind: "version", versionId: "v002" },
      overlay: { kind: "version-files" },
    }));
  });

  test("parses and builds pane and leaf-modal routes", () => {
    const base = "/skills/alice/earnings";
    // Cases are dedicated panes with their own URLs.
    expect(parseWorkbenchLocation(`${base}/jobs/job_001`, base))
      .toEqual(createScorecardRoute({ kind: "job", jobId: "job_001" }));
    expect(buildWorkbenchLocationHref(createScorecardRoute({ kind: "job", jobId: "job_001" }), base))
      .toBe(`${base}/jobs/job_001`);
    // Case views are path segments; "output" is the unwritten default.
    expect(parseWorkbenchLocation(`${base}/jobs/job_001/timeline`, base))
      .toEqual(createScorecardRoute({ kind: "job", jobId: "job_001", view: "timeline" }));
    expect(buildWorkbenchLocationHref(
      createScorecardRoute({ kind: "job", jobId: "job_001", view: "timeline" }),
      base,
    )).toBe(`${base}/jobs/job_001/timeline`);
    // The only leaf modal left is the version files browser.
    expect(parseWorkbenchLocation(`${base}/versions/v002/files`, base))
      .toEqual(createVersionsRoute({
        inspector: { kind: "version", versionId: "v002" },
        overlay: { kind: "version-files" },
      }));
    expect(buildWorkbenchLocationHref(createVersionsRoute({
      inspector: { kind: "version", versionId: "v002" },
      overlay: { kind: "version-files" },
    }), base)).toBe(`${base}/versions/v002/files`);
    expect(parseWorkbenchLocation(`${base}/jobs/job_001/files`, base))
      .toEqual(createScorecardRoute());
    expect(parseWorkbenchLocation(`${base}/jobs/job_001/unknown`, base))
      .toEqual(createScorecardRoute());
  });

  test("renders the scorecard as the default workspace surface", () => {
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: inspectionSnapshot(),
      headerControls: createElement("nav", { "data-testid": "account-nav" }, "Account navigation"),
    }));

    expect(html).toContain(">Workbench</span>");
    expect(html).toContain("Account navigation");
    expect(html).toContain("Workbench views");
    expect(html).toContain("Scorecard");
    expect(html).toContain("Versions");
    expect(html).toContain("Skill");
    expect(html).toContain("data-testid=\"workbench-verdict-banner\"");
    expect(html).toContain("Best setup:");
    expect(html).toContain("score 0.920");
    expect(html).not.toContain("readiness");
    expect(html).not.toContain("Runtime posture");
    expect(html).not.toContain("Improve Runs");
    expect(html).not.toContain("aria-label=\"breadcrumb\"");
    expect(html).toContain("No active runs");
    expect(html).toContain("Updated ");
  });

  test("renders the Workbench loading mark during initial snapshot loading", () => {
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("Loading Workbench");
    expect(html).toContain("workbench-loading-mark");
    expect(html).not.toContain("data-slot=\"empty-icon\"");
    expect(html).not.toContain("lucide-refresh-cw");
  });

  test("summarizes active execution from queued and running jobs", () => {
    const snapshot = inspectionSnapshot();
    const activeRun = {
      ...snapshot.runs[0]!,
      id: "run_active",
      status: "running" as const,
      jobIds: ["job_running", "job_queued", "job_succeeded"],
      traceIds: [],
      createdAt: "2026-06-06T00:12:00.000Z",
    };
    const jobBase = snapshot.jobs[0]!;
    snapshot.runs = [activeRun, ...snapshot.runs];
    snapshot.jobs = [
      {
        ...jobBase,
        id: "job_running",
        runId: "run_active",
        status: "running" as const,
        traceIds: [],
        artifactIds: [],
        createdAt: "2026-06-06T00:12:00.000Z",
        startedAt: "2026-06-06T00:12:01.000Z",
      },
      {
        ...jobBase,
        id: "job_queued",
        runId: "run_active",
        status: "queued" as const,
        traceIds: [],
        artifactIds: [],
        createdAt: "2026-06-06T00:12:02.000Z",
      },
      {
        ...jobBase,
        id: "job_succeeded",
        runId: "run_active",
        status: "succeeded" as const,
        traceIds: [],
        artifactIds: [],
        createdAt: "2026-06-06T00:12:03.000Z",
      },
      ...snapshot.jobs,
    ];

    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: snapshot,
      initialRoute: createScorecardRoute(),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("1 running, 1 queued");
    expect(html).toContain("Refresh Workbench state");
    expect(html).not.toContain("Idle");
  });

  test("falls back to running runs when active jobs are not present", () => {
    const snapshot = inspectionSnapshot();
    snapshot.runs = [{
      ...snapshot.runs[0]!,
      id: "run_without_jobs",
      status: "running" as const,
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-06T00:12:00.000Z",
    }, ...snapshot.runs];

    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: snapshot,
      initialRoute: createScorecardRoute(),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("1 running");
    expect(html).not.toContain("No active runs");
  });

  test("renders comparison evidence from the primary pane", () => {
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: inspectionSnapshot(),
      initialRoute: createScorecardRoute(),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("Scorecard");
    expect(html).toContain("Evaluation 1");
    expect(html).toContain("2 cases / rubric grader");
    expect(html).toContain("Skill version");
    expect(html).toContain("Agent");
    expect(html).toContain("Score");
    expect(html).toContain("Latency");
    expect(html).toContain("Version 2");
    expect(html).toContain("Current");
    expect(html).not.toContain("Not run");
    expect(html).toContain("View details");
    // Charts only appear when there is more than one setup to compare.
    expect(html).not.toContain("Score vs Latency");
  });

  test("hides the cost column when runs do not report cost", () => {
    const snapshot = inspectionSnapshot();
    snapshot.runs = snapshot.runs.map((run) => {
      const copy = { ...run };
      delete copy.costUsd;
      return copy;
    });
    snapshot.comparison!.cells = snapshot.comparison!.cells.map((cell) => {
      const copy = { ...cell };
      delete copy.costUsd;
      return copy;
    });

    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: snapshot,
      initialRoute: createScorecardRoute(),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).not.toContain("Cost not captured");
    expect(html).not.toContain("Sort by Cost");
  });

  test("scopes comparison rows to one evaluation version at a time", () => {
    const snapshot = inspectionSnapshot();
    snapshot.evals = [
      ...snapshot.evals,
      {
        hash: "eval_hash_new",
        caseCount: 3,
        scoreAdapter: "tests",
        createdAt: "2026-06-06T00:20:00.000Z",
        updatedAt: "2026-06-06T00:20:00.000Z",
        files: [{
          path: "eval.yaml",
          kind: "text",
          encoding: "utf8",
          content: "version: 1\nscore:\n  adapter: tests\n",
        }],
      },
    ];
    snapshot.runs = [
      ...snapshot.runs,
      {
        ...snapshot.runs[0]!,
        id: "run_eval_new",
        evalHash: "eval_hash_new",
        score: 0.99,
        costUsd: 0.2,
        createdAt: "2026-06-06T00:20:00.000Z",
        finishedAt: "2026-06-06T00:21:00.000Z",
      },
    ];

    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: snapshot,
      initialRoute: createScorecardRoute(),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("Evaluation 2");
    expect(html).toContain("Latest / 3 cases / test grader");
    expect(html).toContain("3 cases / test grader");
    expect(html).toContain("0.990");
  });

  test("renders a clear empty state when comparison cells have no skill bundle", () => {
    const snapshot = inspectionSnapshot();
    snapshot.comparison = {
      ...snapshot.comparison!,
      skills: [],
      cells: snapshot.comparison!.cells.map((cell) => ({
        ...cell,
        skillBundleHash: "missing_skill_bundle_hash",
      })),
    };
    snapshot.runs = [];

    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: snapshot,
      initialRoute: createScorecardRoute(),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("Comparison unavailable");
    expect(html).toContain("This comparison has no matching skill setups to show.");
    expect(html).not.toContain("No scorecard yet");
  });

  test("renders comparison evidence for a measured dummy skill separate from the active skill", () => {
    const snapshot = inspectionSnapshot();
    const primaryBundle = snapshot.comparison!.skills[0]!;
    const dummyBundle = {
      ...primaryBundle,
      hash: "dummy_bundle_hash",
      skillName: "dummy-skill",
      entryName: "dummy-skill",
      source: { name: "dummy-skill", kind: "local" as const, path: "dummy-skill" },
    };
    const dummyRun = {
      ...snapshot.runs[0]!,
      id: "run_dummy",
      skillName: "dummy-skill",
      skillBundleHash: "dummy_bundle_hash",
      score: 0.81,
      costUsd: 0.045,
      latencyMs: 900,
    };
    snapshot.skillBundles = [primaryBundle, dummyBundle];
    snapshot.runs = [dummyRun, ...snapshot.runs];
    snapshot.comparison = {
      ...snapshot.comparison!,
      skills: [primaryBundle, dummyBundle],
      cells: [{
        ...snapshot.comparison!.cells[0]!,
        skillName: "dummy-skill",
        skillBundleHash: "dummy_bundle_hash",
        runId: "run_dummy",
        score: 0.81,
        costUsd: 0.045,
        latencyMs: 900,
      }],
    };

    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: snapshot,
      initialRoute: createScorecardRoute(),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("Dummy skill");
    expect(html).toContain("0.810");
    expect(html).toContain("View details");
    expect(html).not.toContain("dummy_bundle_hash");
  });

  test("renders the files surface as a dedicated browser", () => {
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: inspectionSnapshot(),
      initialRoute: createFilesRoute(),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("SKILL.md");
    expect(html).toContain("What this skill tells the agent to do.");
    // Release and sources live on the versions surface now.
    expect(html).not.toContain("Install URL");
    expect(html).not.toContain("Advanced");
  });

  test("renders release status and advanced details on the versions surface", () => {
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: inspectionSnapshot(),
      initialRoute: createVersionsRoute(),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("Release");
    expect(html).toContain("Install URL");
    expect(html).toContain("/skills/acme/skill");
    expect(html).toContain("/skills/acme/skill/releases/v002");
    expect(html).toContain("Advanced");
    // Published equals current, so no drift warning.
    expect(html).not.toContain("ahead of the published release");
    expect(html).not.toContain("Refs");
  });

  test("warns when the published release is behind the current version", () => {
    const snapshot = inspectionSnapshot();
    snapshot.publication = { ...snapshot.publication!, versionId: "v001" };
    snapshot.refs = { ...snapshot.refs, published: "v001" };

    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: snapshot,
      initialRoute: createVersionsRoute(),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("ahead of the published release");
  });

  test("renders the versions surface as an improvement-aware history", () => {
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: inspectionSnapshot(),
      initialRoute: createVersionsRoute(),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("Version 2");
    expect(html).toContain("Version 1");
    expect(html).toContain("current");
    expect(html).toContain("published");
    expect(html).toContain("improved from Version 1");
    expect(html).toContain("score 0.920");
    expect(html).toContain("List");
    expect(html).toContain("Graph");
    expect(html).not.toContain("0 children");
    expect(html).not.toContain("1 parent");
  });

  test("renders run inspectors in the detail pane over the scorecard", () => {
    const snapshot = inspectionSnapshot();
    const runHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: snapshot,
      initialRoute: createScorecardRoute({ kind: "run", runId: "run_eval" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(runHtml).toContain("Scorecard");
    expect(runHtml).toContain("Active skill Version 2 run");
    expect(runHtml).toContain("data-testid=\"workbench-detail-pane\"");
    expect(runHtml).toContain("Case results");
    // Case rows open the dedicated case pane.
    expect(runHtml).toContain("href=\"/skills/alice/earnings/jobs/job_001\"");
    expect(runHtml).not.toContain("Output version");
    expect(runHtml).not.toContain("Parent run");
    expect(runHtml).not.toContain("/traces/");
    expect(runHtml).not.toContain("/artifacts/");
    expect(runHtml).toContain("href=\"/skills/alice/earnings\">Scorecard</a>");
  });

  test("renders cases as dedicated panes with a run breadcrumb", () => {
    const snapshot = inspectionSnapshot();
    const jobHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: snapshot,
      initialRoute: createScorecardRoute({ kind: "job", jobId: "job_001" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(jobHtml).toContain("Case case_001");
    expect(jobHtml).toContain("Case views");
    expect(jobHtml).toContain("Output");
    expect(jobHtml).toContain("Timeline");
    expect(jobHtml).not.toContain("Technical");
    // The default Output tab is rendered with the produced files.
    expect(jobHtml).toContain("What the skill produced for case_001.");
    expect(jobHtml).toContain("report.md");
    expect(jobHtml).not.toContain("node:22");
    expect(jobHtml).not.toContain("Open full screen");
    // The breadcrumb keeps the drill-down path back to the run.
    expect(jobHtml).toContain("href=\"/skills/alice/earnings/runs/run_eval\"");
  });

  test("renders current skill files through the shared file browser scaffold", () => {
    const snapshot = inspectionSnapshot();
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: snapshot,
      initialRoute: createFilesRoute({
        file: { filePath: "SKILL.md", directoryPath: null, previewMode: "rendered" },
      }),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("SKILL.md");
    expect(html).toContain("What this skill tells the agent to do.");
  });

  test("renders improve runs in the detail pane over the versions surface", () => {
    const snapshot = inspectionSnapshot();
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialData: snapshot,
      initialRoute: createVersionsRoute({ inspector: { kind: "run", runId: "run_improve" } }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(html).toContain("href=\"/skills/alice/earnings/versions\">Versions</a>");
    expect(html).toContain("Improved into");
    expect(html).toContain("Version 2");
  });
});

function inspectionSnapshot(): WorkbenchInspectionSnapshot {
  return {
    root: "/tmp/skill",
    status: {
      root: "/tmp/skill",
      initialized: true,
      currentVersionId: "v002",
      defaultSkill: "primary",
      defaultAgent: "patcher",
      versionCount: 2,
      skillCount: 1,
      agentCount: 3,
      runCount: 2,
      remoteCount: 1,
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
    evals: [{
      hash: "eval_hash",
      caseCount: 2,
      scoreAdapter: "rubric",
      createdAt: "2026-06-06T00:10:00.000Z",
      updatedAt: "2026-06-06T00:10:00.000Z",
      files: [{
        path: "eval.yaml",
        kind: "text",
        encoding: "utf8",
        content: "version: 1\nscore:\n  adapter: rubric\n",
      }],
    }],
    agents: [{
      hash: "agent_hash",
      agent: {
        name: "patcher",
        adapter: "command",
        model: "deterministic",
        config: {
          image: "node:22",
          network: "on",
          timeoutMinutes: 7,
        },
      },
    }, {
      hash: "agent_hash_open",
      agent: {
        name: "custom-open",
        adapter: "command",
        model: "deterministic",
        config: { network: "bridge" },
      },
    }, {
      hash: "agent_hash_off",
      agent: {
        name: "explicit-off",
        adapter: "command",
        model: "deterministic",
        config: { network: "off" },
      },
    }],
    comparison: {
      evalHash: "eval_hash",
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
      skills: [{
        hash: "skill_bundle_hash",
        skillName: "primary",
        entryName: "primary",
        source: { name: "primary", kind: "local", path: "." },
        files: [{ path: "SKILL.md", kind: "text", encoding: "utf8", content: "" }],
        includedSkills: [],
        createdAt: "2026-06-06T00:00:00.000Z",
      }],
      agents: [{
        hash: "agent_hash",
        agent: {
          name: "patcher",
          adapter: "command",
          model: "deterministic",
          config: {
            image: "node:22",
            network: "on",
            timeoutMinutes: 7,
          },
        },
      }, {
        hash: "agent_hash_open",
        agent: {
          name: "custom-open",
          adapter: "command",
          model: "deterministic",
          config: { network: "bridge" },
        },
      }, {
        hash: "agent_hash_off",
        agent: {
          name: "explicit-off",
          adapter: "command",
          model: "deterministic",
          config: { network: "off" },
        },
      }],
      cells: [{
        versionId: "v002",
        skillName: "primary",
        skillBundleHash: "skill_bundle_hash",
        evalHash: "eval_hash",
        agentName: "patcher",
        agentHash: "agent_hash",
        runId: "run_eval",
        score: 0.92,
        costUsd: 0.1234,
        latencyMs: 1500,
      }, {
        versionId: "v002",
        skillName: "primary",
        skillBundleHash: "skill_bundle_hash",
        evalHash: "eval_hash",
        agentName: "custom-open",
        agentHash: "agent_hash_open",
      }, {
        versionId: "v002",
        skillName: "primary",
        skillBundleHash: "skill_bundle_hash",
        evalHash: "eval_hash",
        agentName: "explicit-off",
        agentHash: "agent_hash_off",
      }],
    },
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
      agentHash: "agent_hash",
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
      agentHash: "agent_hash",
      createdAt: "2026-06-06T00:05:01.000Z",
      request: { improvementMode: "command" },
      result: {},
      files: [],
    }],
    executionEvents: [],
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
      kind: "workbench-cloud",
    }],
    refs: {
      current: "v002",
      published: "v002",
      "releases/v002": "v002",
    },
    publication: {
      versionId: "v002",
      installUrl: "/skills/acme/skill",
      pinnedInstallUrl: "/skills/acme/skill/releases/v002",
    },
  };
}
