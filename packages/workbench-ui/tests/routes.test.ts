import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type {
  WorkbenchInspectionSnapshot,
  WorkbenchInspectionSnapshotEnvelope,
} from "@workbench-ai/workbench-contract";
import { WorkbenchWorkspace } from "../src/app";
import {
  buildWorkbenchLocationHref,
  createCaseRoute,
  createEvaluationRoute,
  createFilesRoute,
  createRunRoute,
  createRunsRoute,
  emptyFileRouteState,
  parseWorkbenchLocation,
  parseWorkbenchRoute,
  withFileRouteState,
} from "../src/lib/routes";

describe("hub-shaped Workbench UI", () => {
  test("parses and builds the hard-cut routes", () => {
    const base = "/skills/alice/earnings";
    expect(parseWorkbenchRoute("/", "/")).toEqual(createFilesRoute());
    expect(parseWorkbenchLocation(base, base)).toEqual(createFilesRoute());
    expect(parseWorkbenchLocation(`${base}/files?file=SKILL.md&view=raw`, base))
      .toEqual(createFilesRoute({ file: { filePath: "SKILL.md", directoryPath: null, previewMode: "raw" } }));
    expect(parseWorkbenchLocation(`${base}/files?version=v001&file=SKILL.md`, base))
      .toEqual(createFilesRoute({ file: { versionId: "v001", filePath: "SKILL.md" } }));
    expect(parseWorkbenchLocation(`${base}/files?dir=.workbench`, base))
      .toEqual(createFilesRoute({ file: { filePath: null, directoryPath: ".workbench", previewMode: "rendered" } }));
    expect(parseWorkbenchLocation(`${base}/evaluation`, base))
      .toEqual(createEvaluationRoute({ view: "results" }));
    expect(parseWorkbenchLocation(`${base}/evaluation/cases?evaluation=eval_hash`, base))
      .toEqual(createEvaluationRoute({ view: "cases", evaluationId: "eval_hash" }));
    expect(parseWorkbenchLocation(`${base}/evaluation/cases/case_001?evaluation=eval_hash`, base))
      .toEqual(createCaseRoute({ caseId: "case_001", evaluationId: "eval_hash" }));
    expect(parseWorkbenchLocation(`${base}/evaluation/cases/case_001?evaluation=eval_hash&file=cases%2Fcase_001%2Fnotes.md&view=raw`, base))
      .toEqual(createCaseRoute({
        caseId: "case_001",
        evaluationId: "eval_hash",
        file: { filePath: "cases/case_001/notes.md", previewMode: "raw" },
      }));
    expect(parseWorkbenchLocation(`${base}/evaluation/cases/case_001?evaluation=eval_hash&section=runs`, base))
      .toEqual(createCaseRoute({ caseId: "case_001", evaluationId: "eval_hash", section: "runs" }));
    expect(parseWorkbenchLocation(`${base}/evaluation/runs/run_eval?evaluation=eval_hash`, base))
      .toEqual(createRunRoute({ runId: "run_eval", source: "evaluation", evaluationId: "eval_hash" }));
    expect(parseWorkbenchLocation(`${base}/evaluation/runs/run_eval?evaluation=eval_hash&section=job%3Ajob_001`, base))
      .toEqual(createRunRoute({
        runId: "run_eval",
        source: "evaluation",
        evaluationId: "eval_hash",
        section: { kind: "job", jobId: "job_001", view: "trace" },
      }));
    expect(parseWorkbenchLocation(`${base}/evaluation/runs/run_eval?evaluation=eval_hash&section=job%3Ajob_001%3Aoutput`, base))
      .toEqual(createRunRoute({
        runId: "run_eval",
        source: "evaluation",
        evaluationId: "eval_hash",
        section: { kind: "job", jobId: "job_001", view: "output" },
      }));
    expect(parseWorkbenchLocation(`${base}/runs`, base)).toEqual(createRunsRoute());
    expect(parseWorkbenchLocation(`${base}/runs/run_eval`, base))
      .toEqual(createRunRoute({ runId: "run_eval", source: "runs" }));

    expect(buildWorkbenchLocationHref(createFilesRoute({
      file: { filePath: "SKILL.md", directoryPath: null, previewMode: "raw" },
    }), base)).toBe(`${base}/files?file=SKILL.md&view=raw`);
    expect(buildWorkbenchLocationHref(createFilesRoute({
      file: { versionId: "v001", filePath: "SKILL.md" },
    }), base)).toBe(`${base}/files?version=v001&file=SKILL.md`);
    expect(buildWorkbenchLocationHref(createFilesRoute({
      file: { filePath: null, directoryPath: ".workbench", previewMode: "rendered" },
    }), base)).toBe(`${base}/files?dir=.workbench`);
    expect(buildWorkbenchLocationHref(createEvaluationRoute({ view: "cases", evaluationId: "eval_hash" }), base))
      .toBe(`${base}/evaluation/cases?evaluation=eval_hash`);
    expect(buildWorkbenchLocationHref(createCaseRoute({
      caseId: "case_001",
      evaluationId: "eval_hash",
      file: { filePath: "cases/case_001/notes.md", previewMode: "raw" },
    }), base)).toBe(`${base}/evaluation/cases/case_001?evaluation=eval_hash&file=cases%2Fcase_001%2Fnotes.md&view=raw`);
    expect(buildWorkbenchLocationHref(withFileRouteState(createCaseRoute({
      caseId: "case_001",
      evaluationId: "eval_hash",
      file: emptyFileRouteState(),
    }), {
      filePath: "cases/case_001/notes.md",
      previewMode: "raw",
      versionId: "ignored-for-cases",
    }), base)).toBe(`${base}/evaluation/cases/case_001?evaluation=eval_hash&file=cases%2Fcase_001%2Fnotes.md&view=raw`);
    expect(buildWorkbenchLocationHref(createCaseRoute({ caseId: "case_001", evaluationId: "eval_hash", section: "runs" }), base))
      .toBe(`${base}/evaluation/cases/case_001?evaluation=eval_hash&section=runs`);
    expect(buildWorkbenchLocationHref(createRunRoute({ runId: "run_eval", source: "runs" }), base))
      .toBe(`${base}/runs/run_eval`);
    expect(buildWorkbenchLocationHref(createRunRoute({
      runId: "run_eval",
      source: "runs",
      section: { kind: "job", jobId: "job_001", view: "trace" },
    }), base)).toBe(`${base}/runs/run_eval?section=job%3Ajob_001`);
    expect(buildWorkbenchLocationHref(createRunRoute({
      runId: "run_eval",
      source: "runs",
      section: { kind: "job", jobId: "job_001", view: "output" },
    }), base)).toBe(`${base}/runs/run_eval?section=job%3Ajob_001%3Aoutput`);
  });

  test("does not preserve old web route compatibility", () => {
    const base = "/skills/alice/earnings";
    expect(parseWorkbenchLocation(`${base}/compare`, base).kind).toBe("not-found");
    expect(parseWorkbenchLocation(`${base}/versions`, base).kind).toBe("not-found");
    expect(parseWorkbenchLocation(`${base}/activity`, base).kind).toBe("not-found");
    expect(parseWorkbenchLocation(`${base}/activity/runs/run_eval`, base).kind).toBe("not-found");
    expect(parseWorkbenchLocation(`${base}/jobs/job_001`, base).kind).toBe("not-found");
    expect(parseWorkbenchLocation(`${base}/skills/primary`, base).kind).toBe("not-found");
  });

  test("renders Files as the default skill page", () => {
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      headerControls: createElement("nav", { "data-testid": "account-nav" }, "Account navigation"),
      routeBasePath: "/skills/alice/earnings",
      hostContext: {
        handle: "acme/skill",
        ownerSlug: "acme",
        skillName: "earnings",
        sourceVisibility: "public",
        evidenceAccess: "full",
      },
    }));

    expect(html).toContain(">Workbench</span>");
    expect(html).toContain("Account navigation");
    expect(html).toContain("Files");
    expect(html).toContain("Evaluation");
    expect(html).toContain("Runs");
    expect(html).toContain("data-testid=\"top-loading-bar\"");
    expect(html).toContain("data-active=\"false\"");
    expect(html).toContain("SKILL.md");
    expect(html).toContain("Version history");
    expect(html).toContain("data-testid=\"version-select\"");
    expect(html).toContain("Reads earnings documents.");
    expect(html).toContain("Use skill");
    expect(html).not.toContain("Authored source for the current skill version.");
    expect(html).not.toContain("aria-current=\"true\"");
    expect(html).not.toContain("Repository overview.");
    expect(html).not.toContain("Selected source preview.");
    expect(html).not.toContain("Workbench views");
    expect(html).not.toContain("Compare</");
    expect(html).not.toContain("data-testid=\"workbench-detail-pane\"");
  });

  test("counts About cases from the latest authored evaluation", () => {
    const snapshot = inspectionSnapshot();
    const [latestEval] = snapshot.evals;
    if (!latestEval) {
      throw new Error("Expected evaluation fixture.");
    }
    snapshot.evals = [{
      ...latestEval,
      hash: "eval_old",
      caseCount: 4,
      createdAt: "2026-06-06T00:05:00.000Z",
      updatedAt: "2026-06-06T00:05:00.000Z",
    }, {
      ...latestEval,
      hash: "eval_current",
      caseCount: 2,
      createdAt: "2026-06-06T00:15:00.000Z",
      updatedAt: "2026-06-06T00:15:00.000Z",
    }];

    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(snapshot),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("2 cases");
    expect(html).not.toContain("6 cases");
  });

  test("does not auto-select a file when opening a folder", () => {
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createFilesRoute({ file: { directoryPath: ".workbench", filePath: null } }),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("root");
    expect(html).toContain(".workbench");
    expect(html).toContain("cases/");
    expect(html).not.toContain("No file selected");
    expect(html).not.toContain("Select a source file from the repository list.");
    expect(html).not.toContain("Select a source file to preview.");
    expect(html).not.toContain("Selected source preview.");
  });

  test("renders Evaluation Results with the scorecard", () => {
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createEvaluationRoute({ view: "results" }),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("Results");
    expect(html).toContain("Cases");
    expect(html).toContain("Evaluation 1");
    expect(html).toContain("data-testid=\"evaluation-results-visual-summary\"");
    expect(html).toContain("data-testid=\"evaluation-quality-chart\"");
    expect(html).toContain("data-testid=\"evaluation-latency-chart\"");
    expect(html).toContain("data-testid=\"evaluation-cost-chart\"");
    expect(html).toContain("data-testid=\"evaluation-tradeoff-chart\"");
    expect(html).toContain("data-testid=\"evaluation-tradeoff-plot\"");
    expect(html).toContain("recharts-responsive-container");
    expect(html).toContain("Quality vs Latency");
    expect(html).toContain("data-testid=\"evaluation-results-leaderboard\"");
    expect(html.match(/data-testid="evaluation-results-version-group"/g)?.length).toBe(2);
    expect(html).toContain(">Agent</th>");
    expect(html).toContain(">Status</th>");
    expect(html).toContain(">Cases</th>");
    expect(html).toContain(">Quality</th>");
    expect(html).toContain(">Latency</th>");
    expect(html).toContain(">Cost</th>");
    expect(html).toContain(">When</th>");
    expect(html).not.toContain(">#</th>");
    expect(html).not.toContain(">Run</th>");
    expect(html).not.toContain(">Mode</th>");
    expect(html).not.toContain(">Version</th>");
    expect(html).toContain("earnings-prep v2");
    expect(html).toContain("earnings-prep v1");
    expect(html).toContain("0.920");
    expect(html).toContain("0.700");
    expect(html).not.toContain("1 setup");
    expect(html).not.toContain("Best 0.920");
    expect(html).not.toContain("Mean 0.920");
    expect(html).not.toContain("Succeeded 1/1");
    expect(html).not.toContain("Lowest cost $0.12");
    expect(html).toContain("$0.12");
    expect(html).not.toContain("$0.1234");
    expect(html).toContain("750ms");
    expect(html).toContain("1.5s");
    expect(html).toContain("1/1");
    expect(html).toContain("href=\"/skills/alice/earnings/evaluation/runs/run_eval?evaluation=eval_hash\"");
    expect(html).not.toContain("Skill version");
    expect(html).not.toContain("View details");
    expect(html).not.toContain("Select all");
    expect(html).not.toContain("Current scorecard");
    expect(html).not.toContain("Active skill history");
  });

  test("renders authored evaluation cases and case detail sections", () => {
    const listHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createEvaluationRoute({ view: "cases", evaluationId: "eval_hash" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(listHtml).toContain("Case one");
    expect(listHtml).toContain("npm test -- case-one");
    expect(listHtml).toContain("href=\"/skills/alice/earnings/evaluation/cases/case_001?evaluation=eval_hash\"");

    const definitionHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createCaseRoute({ caseId: "case_001", evaluationId: "eval_hash" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(definitionHtml).toContain("Case one");
    expect(definitionHtml).toContain("case.yaml");
    expect(definitionHtml).toContain("aria-label=\"Case files\"");
    expect(definitionHtml).toContain("aria-label=\"case.yaml preview\"");
    expect(definitionHtml).toContain("Rendered");
    expect(definitionHtml).toContain("Raw");
    expect(definitionHtml).toContain("aria-label=\"Case sections\"");
    expect(definitionHtml).toContain("href=\"/skills/alice/earnings/evaluation/cases/case_001?evaluation=eval_hash&amp;section=runs\"");
    expect(definitionHtml).not.toContain("All cases");
    expect(definitionHtml).not.toContain("href=\"#runs\"");
    expect(definitionHtml).not.toContain("href=\"/skills/alice/earnings/evaluation/runs/run_eval?evaluation=eval_hash\"");

    const runsHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createCaseRoute({ caseId: "case_001", evaluationId: "eval_hash", section: "runs" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(runsHtml).toContain("Runs");
    expect(runsHtml).toContain(">Operation</th>");
    expect(runsHtml).toContain(">Version</th>");
    expect(runsHtml).toContain(">Agent</th>");
    expect(runsHtml).toContain(">Quality</th>");
    expect(runsHtml).not.toContain(">Run</th>");
    expect(runsHtml).not.toContain(">Score</th>");
    expect(runsHtml).toContain("href=\"/skills/alice/earnings/evaluation/runs/run_eval?evaluation=eval_hash\"");
    expect(runsHtml).not.toContain("Case ID");
    expect(runsHtml).not.toContain(">Command</span>");
  });

  test("renders Runs and full run detail pages", () => {
    const runsHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createRunsRoute(),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(runsHtml).toContain("Runs");
    expect(runsHtml).toContain(">Operation</th>");
    expect(runsHtml).toContain(">Version</th>");
    expect(runsHtml).toContain(">Agent</th>");
    expect(runsHtml).toContain(">Evaluation</th>");
    expect(runsHtml).toContain(">Quality</th>");
    expect(runsHtml).not.toContain(">Run</th>");
    expect(runsHtml).not.toContain(">Kind</th>");
    expect(runsHtml).not.toContain(">Score</th>");
    expect(runsHtml).toContain(">Eval</a>");
    expect(runsHtml).not.toContain(">run_eval</a>");
    expect(runsHtml).toContain("earnings-prep v2");
    expect(runsHtml).toContain("No skill");
    expect(runsHtml).toContain("command / deterministic");
    expect(runsHtml).toContain("href=\"/skills/alice/earnings/runs/run_eval\"");

    const summaryHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createRunRoute({ runId: "run_eval", source: "evaluation", evaluationId: "eval_hash" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(summaryHtml).toContain("Eval: earnings-prep v2 on Evaluation 1");
    expect(summaryHtml).toContain("aria-label=\"Run sections\"");
    expect(summaryHtml).toContain("1 / 1 passed");
    expect(summaryHtml).toContain("Case results");
    expect(summaryHtml).toContain("Timeline");
    expect(summaryHtml).toContain("Execution trace");
    expect(summaryHtml).toContain("href=\"/skills/alice/earnings/evaluation/runs/run_eval?evaluation=eval_hash&amp;section=job%3Ajob_001\"");
    expect(summaryHtml).not.toContain("Run commands");
    expect(summaryHtml).not.toContain("workbench show run_eval");
    expect(summaryHtml).not.toContain("workbench run watch run_eval");
    expect(summaryHtml).not.toContain("workbench run retry run_eval");
    expect(summaryHtml).not.toContain("<ul class=\"grid min-w-0 gap-2\">");
    expect(summaryHtml).not.toContain("<a class=\"font-medium text-primary no-underline hover:underline\"");
    expect(summaryHtml).not.toContain("data-testid=\"workbench-detail-pane\"");

    const jobHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createRunRoute({
        runId: "run_eval",
        source: "evaluation",
        evaluationId: "eval_hash",
        section: { kind: "job", jobId: "job_001", view: "trace" },
      }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(jobHtml).toContain("case_001");
    expect(jobHtml).toContain("Trace");
    expect(jobHtml).toContain("Output");
    expect(jobHtml).toContain("Loading job evidence...");
    expect(jobHtml).toContain("href=\"/skills/alice/earnings/evaluation/runs/run_eval?evaluation=eval_hash&amp;section=job%3Ajob_001%3Aoutput\"");
    expect(jobHtml).not.toContain("Captured files produced by this case run.");
    expect(jobHtml).not.toContain("report.md");
    expect(jobHtml).not.toContain("# Report");
    expect(jobHtml).not.toContain("Run commands");
    expect(jobHtml).not.toContain("workbench show run_eval");

    const outputHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createRunRoute({
        runId: "run_eval",
        source: "evaluation",
        evaluationId: "eval_hash",
        section: { kind: "job", jobId: "job_001", view: "output" },
      }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(outputHtml).toContain("case_001");
    expect(outputHtml).toContain("Trace");
    expect(outputHtml).toContain("Output");
    expect(outputHtml).toContain("Captured files produced by this case run.");
    expect(outputHtml).toContain("report.md");
    expect(outputHtml).toContain("href=\"/skills/alice/earnings/evaluation/runs/run_eval?evaluation=eval_hash&amp;section=job%3Ajob_001\"");
    expect(outputHtml).not.toContain("Loading job evidence...");
    expect(outputHtml).not.toContain("Timeline");
    expect(outputHtml).not.toContain("Run commands");
  });

  test("summarizes active execution from queued and running jobs", () => {
    const snapshot = inspectionSnapshot();
    snapshot.runs = [{
      ...snapshot.runs[0]!,
      id: "run_active",
      status: "running",
      jobIds: ["job_running", "job_queued"],
      traceIds: [],
      createdAt: "2026-06-06T00:12:00.000Z",
    }, ...snapshot.runs];
    snapshot.jobs = [
      {
        ...snapshot.jobs[0]!,
        id: "job_running",
        runId: "run_active",
        status: "running",
        traceIds: [],
        artifactIds: [],
      },
      {
        ...snapshot.jobs[0]!,
        id: "job_queued",
        runId: "run_active",
        status: "queued",
        traceIds: [],
        artifactIds: [],
      },
      ...snapshot.jobs,
    ];

    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(snapshot),
      initialRoute: createRunsRoute(),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("1 running, 1 queued");
    expect(html).toContain("Refresh Workbench state");
    expect(html).not.toContain("Idle");
  });
});

function inspectionEnvelope(snapshot: WorkbenchInspectionSnapshot): WorkbenchInspectionSnapshotEnvelope {
  return {
    schema: "workbench.inspection.snapshot-envelope.v1",
    cursor: "test:1",
    snapshot,
    actions: {
      variant: "local",
      evidenceAccess: "full",
      eval: {
        enabled: true,
        defaultRequest: { kind: "eval", variant: "local", versionId: "v001", samples: 1 },
      },
      improve: {
        enabled: false,
        defaultRequest: { kind: "improve", variant: "local", versionId: "v001", samples: 1, budget: 1 },
        disabledReason: "No improvement evidence is available.",
      },
      acquisition: [{
        id: "open-local",
        label: "Open local project",
        kind: "copy-command",
        value: "workbench open",
      }],
    },
  };
}

function inspectionSnapshot(): WorkbenchInspectionSnapshot {
  const versions = [{
    id: "v001",
    hash: "hash_v001_abcdef",
    message: "initial",
    parentIds: [],
    createdAt: "2026-06-06T00:00:00.000Z",
    files: [{ path: "SKILL.md", kind: "text" as const, encoding: "utf8" as const, content: "" }],
  }, {
    id: "v002",
    hash: "hash_v002_abcdef",
    message: "improved",
    parentIds: ["v001"],
    createdAt: "2026-06-06T00:05:00.000Z",
    files: [
      {
        path: "SKILL.md",
        kind: "text" as const,
        encoding: "utf8" as const,
        content: "---\nname: Earnings Skill\ndescription: Reads earnings documents.\n---\n",
      },
      {
        path: ".workbench/cases/case_001/case.yaml",
        kind: "text" as const,
        encoding: "utf8" as const,
        content: "id: case_001\ntitle: Case one\ncommand: npm test -- case-one\n",
      },
    ],
  }];
  const skillBundle = {
    hash: "skill_bundle_hash",
    skillName: "current",
    entryName: "current",
    source: { name: "current", kind: "local" as const, path: "." },
    files: [{ path: "SKILL.md", kind: "text" as const, encoding: "utf8" as const, content: "" }],
    includedSkills: [],
    createdAt: "2026-06-06T00:00:00.000Z",
  };
  const noSkillBundle = {
    hash: "no_skill_bundle_hash",
    skillName: "no-skill",
    entryName: "no-skill",
    source: { name: "no-skill", kind: "none" as const, source: "none", label: "No skill" },
    files: [],
    includedSkills: [],
    createdAt: "2026-06-06T00:00:00.000Z",
  };
  const agents = [{
    hash: "agent_hash",
    agent: {
      name: "patcher",
      adapter: "command",
      model: "deterministic",
      config: { image: "node:22" },
    },
  }];
  return {
    root: "/tmp/skill",
    status: {
      root: "/tmp/skill",
      initialized: true,
      currentVersionId: "v002",
      defaultSkill: "current",
      defaultAgent: "patcher",
      versionCount: 2,
      skillCount: 1,
      agentCount: 1,
      runCount: 4,
      remoteCount: 1,
    },
    versions,
    skillSources: [
      { name: "current", kind: "local", path: "." },
      { name: "no-skill", kind: "none", source: "none", label: "No skill" },
    ],
    skillBundles: [skillBundle, noSkillBundle],
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
      }, {
        path: "cases/case_001/case.yaml",
        kind: "text",
        encoding: "utf8",
        content: "id: case_001\ntitle: Case one\ncommand: npm test -- case-one\n",
      }],
      cases: [{
        id: "case_001",
        path: "cases/case_001/case.yaml",
        title: "Case one",
        command: "npm test -- case-one",
        files: [{
          path: "cases/case_001/case.yaml",
          kind: "text",
          encoding: "utf8",
          content: "id: case_001\ntitle: Case one\ncommand: npm test -- case-one\n",
        }],
      }, {
        id: "case_002",
        path: "cases/case_002/case.yaml",
        title: "Case two",
        files: [{
          path: "cases/case_002/case.yaml",
          kind: "text",
          encoding: "utf8",
          content: "id: case_002\ntitle: Case two\n",
        }],
      }],
    }],
    agents,
    results: {
      versions: [{
        id: "v001",
        label: "earnings-prep v1",
        source: "local:.",
        sourceKind: "local",
        projectVersionId: "v001",
        contentHash: "skill_bundle_hash",
        files: skillBundle.files,
      }, {
        id: "v002",
        label: "earnings-prep v2",
        source: "local:.",
        sourceKind: "local",
        projectVersionId: "v002",
        contentHash: "skill_bundle_hash",
        current: true,
        published: true,
        files: skillBundle.files,
      }],
      evaluations: [{
        id: "eval_hash",
        caseCount: 2,
        scoreAdapter: "rubric",
        createdAt: "2026-06-06T00:10:00.000Z",
        updatedAt: "2026-06-06T00:10:00.000Z",
      }],
      agents: [{
        id: "agent_hash",
        name: "patcher",
        label: "command / deterministic",
        adapter: "command",
        model: "deterministic",
      }],
      cells: [{
        skillVersionId: "v001",
        evaluationId: "eval_hash",
        agentVersionId: "agent_hash",
        runId: "run_eval_baseline",
        quality: 0.7,
        costUsd: 0.05,
        latencyMs: 1500,
        samples: 1,
      }, {
        skillVersionId: "v002",
        evaluationId: "eval_hash",
        agentVersionId: "agent_hash",
        runId: "run_eval",
        quality: 0.92,
        costUsd: 0.1234,
        latencyMs: 750,
        samples: 2,
      }],
    },
    runs: [{
      id: "run_eval_baseline",
      kind: "eval",
      versionId: "v001",
      skillName: "current",
      skillBundleHash: "skill_bundle_hash",
      evalHash: "eval_hash",
      agentName: "patcher",
      agentHash: "agent_hash",
      status: "succeeded",
      score: 0.7,
      latencyMs: 1500,
      costUsd: 0.05,
      jobIds: ["job_baseline"],
      traceIds: [],
      createdAt: "2026-06-06T00:08:00.000Z",
      finishedAt: "2026-06-06T00:09:00.000Z",
    }, {
      id: "run_eval",
      kind: "eval",
      versionId: "v002",
      skillName: "current",
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
      id: "run_no_skill",
      kind: "eval",
      versionId: "v002",
      skillName: "no-skill",
      skillBundleHash: "no_skill_bundle_hash",
      evalHash: "eval_hash",
      agentName: "patcher",
      agentHash: "agent_hash",
      status: "succeeded",
      score: 0.4,
      latencyMs: 900,
      costUsd: 0.01,
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-06T00:12:00.000Z",
      finishedAt: "2026-06-06T00:13:00.000Z",
    }, {
      id: "run_improve",
      kind: "improve",
      versionId: "v001",
      outputVersionId: "v002",
      skillName: "current",
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
      id: "job_baseline",
      runId: "run_eval_baseline",
      kind: "eval",
      versionId: "v001",
      skillName: "current",
      skillBundleHash: "skill_bundle_hash",
      evalHash: "eval_hash",
      agentName: "patcher",
      agentHash: "agent_hash",
      caseId: "case_001",
      sample: 0,
      status: "succeeded",
      score: 0.7,
      dockerImage: "node:22",
      artifactIds: [],
      traceIds: [],
      createdAt: "2026-06-06T00:08:00.000Z",
      startedAt: "2026-06-06T00:08:01.000Z",
      finishedAt: "2026-06-06T00:08:02.000Z",
      durationMs: 1000,
    }, {
      id: "job_001",
      runId: "run_eval",
      kind: "eval",
      versionId: "v002",
      skillName: "current",
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
      skillName: "current",
      skillBundleHash: "skill_bundle_hash",
      agentName: "patcher",
      agentHash: "agent_hash",
      createdAt: "2026-06-06T00:10:01.000Z",
      request: { caseId: "case_001" },
      result: { ok: true },
      files: [{ path: "output/result.json", kind: "text", encoding: "utf8", content: "{\"ok\":true}\n" }],
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
      "publication/current-version": "v002",
      "publication/versions/v002": "v002",
    },
    publication: {
      currentVersionId: "v002",
      publishedVersionIds: ["v002"],
      installHandle: "acme/skill",
    },
  };
}
