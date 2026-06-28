import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type {
  WorkbenchEvalCaseSnapshot,
  WorkbenchInspectionSnapshot,
  WorkbenchInspectionSnapshotEnvelope,
} from "@workbench-ai/workbench-contract";
import {
  WorkbenchWorkspace,
  caseMatrixOperationTargetForResultVersion,
  workbenchRouteEvidenceMode,
  workbenchSnapshotNeedsEvidenceRefresh,
} from "../src/app";
import {
  buildWorkbenchLocationHref,
  createCaseRoute,
  createEvaluationRoute,
  createFilesRoute,
  createRunJobRoute,
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
    expect(parseWorkbenchLocation(`${base}/files?dir=references`, base))
      .toEqual(createFilesRoute({ file: { filePath: null, directoryPath: "references", previewMode: "rendered" } }));
    expect(parseWorkbenchLocation(`${base}/evaluation`, base))
      .toEqual(createEvaluationRoute({ view: "results" }));
    expect(parseWorkbenchLocation(`${base}/evaluation/cases?evaluation=eval_hash`, base))
      .toEqual(createEvaluationRoute({ view: "cases", evaluationId: "eval_hash" }));
    expect(parseWorkbenchLocation(`${base}/evaluation/traces?evaluation=eval_hash`, base).kind)
      .toBe("not-found");
    expect(parseWorkbenchLocation(`${base}/evaluation/playground?evaluation=eval_hash`, base).kind)
      .toBe("not-found");
    expect(parseWorkbenchLocation(`${base}/evaluation/outputs?evaluation=eval_hash`, base).kind)
      .toBe("not-found");
    expect(parseWorkbenchLocation(`${base}/evaluation/source?evaluation=eval_hash&file=environment%2FDockerfile&view=raw`, base).kind)
      .toBe("not-found");
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
    expect(parseWorkbenchLocation(`${base}/evaluation/runs/run_eval?evaluation=eval_hash`, base).kind)
      .toBe("not-found");
    expect(parseWorkbenchLocation(`${base}/runs`, base)).toEqual(createRunsRoute());
    expect(parseWorkbenchLocation(`${base}/runs/run_eval`, base))
      .toEqual(createRunRoute({ runId: "run_eval" }));
    expect(parseWorkbenchLocation(`${base}/runs/run_eval/jobs/job_001`, base))
      .toEqual(createRunJobRoute({ runId: "run_eval", jobId: "job_001" }));
    expect(parseWorkbenchLocation(`${base}/runs/run_eval/jobs/job_001?view=output`, base))
      .toEqual(createRunJobRoute({ runId: "run_eval", jobId: "job_001", view: "output" }));

    expect(buildWorkbenchLocationHref(createFilesRoute({
      file: { filePath: "SKILL.md", directoryPath: null, previewMode: "raw" },
    }), base)).toBe(`${base}/files?file=SKILL.md&view=raw`);
    expect(buildWorkbenchLocationHref(createFilesRoute({
      file: { versionId: "v001", filePath: "SKILL.md" },
    }), base)).toBe(`${base}/files?version=v001&file=SKILL.md`);
    expect(buildWorkbenchLocationHref(createFilesRoute({
      file: { filePath: null, directoryPath: "references", previewMode: "rendered" },
    }), base)).toBe(`${base}/files?dir=references`);
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
    expect(buildWorkbenchLocationHref(createRunRoute({ runId: "run_eval" }), base))
      .toBe(`${base}/runs/run_eval`);
    expect(buildWorkbenchLocationHref(createRunJobRoute({ runId: "run_eval", jobId: "job_001" }), base))
      .toBe(`${base}/runs/run_eval/jobs/job_001`);
    expect(buildWorkbenchLocationHref(createRunJobRoute({ runId: "run_eval", jobId: "job_001", view: "output" }), base))
      .toBe(`${base}/runs/run_eval/jobs/job_001?view=output`);
  });

  test("requires full evidence only for evidence routes with compact run data", () => {
    const full = inspectionSnapshot();
    const fullWithoutResults = { ...full };
    delete fullWithoutResults.results;
    const compact = {
      ...fullWithoutResults,
      runs: [],
      jobs: [],
      traces: [],
      executionEvents: [],
      artifacts: [],
      lineage: [],
    };
    expect(workbenchSnapshotNeedsEvidenceRefresh(full)).toBe(false);
    expect(workbenchSnapshotNeedsEvidenceRefresh(compact)).toBe(true);
    expect(workbenchSnapshotNeedsEvidenceRefresh({
      ...compact,
      status: { ...compact.status, runCount: 0 },
    })).toBe(false);

    expect(workbenchRouteEvidenceMode(createFilesRoute())).toBe("none");
    expect(workbenchRouteEvidenceMode(createEvaluationRoute({ view: "results" }))).toBe("required");
    expect(workbenchRouteEvidenceMode(createEvaluationRoute({ view: "cases" }))).toBe("optional");
    expect(workbenchRouteEvidenceMode(createCaseRoute({ caseId: "case_001" }))).toBe("none");
    expect(workbenchRouteEvidenceMode(createCaseRoute({ caseId: "case_001", section: "runs" }))).toBe("required");
    expect(workbenchRouteEvidenceMode(createRunsRoute())).toBe("required");
    expect(workbenchRouteEvidenceMode(createRunRoute({ runId: "run_eval" }))).toBe("required");
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
    expect(html).toContain("data-workbench-operation=\"evaluate\"");
    expect(html).not.toContain("data-workbench-operation=\"run\"");
    expect(html).not.toContain("data-workbench-operation=\"grade\"");
    expect(html).not.toContain("Eval setup");
    expect(html).not.toContain("1 evaluation");
    expect(html).not.toContain("Authored source for the current skill version.");
    expect(html).not.toContain("aria-current=\"true\"");
    expect(html).not.toContain("Repository overview.");
    expect(html).not.toContain("Selected source preview.");
    expect(html).not.toContain("Workbench views");
    expect(html).not.toContain("Compare</");
    expect(html).not.toContain("data-testid=\"workbench-detail-pane\"");
  });

  test("renders the canonical handle slug instead of the frontmatter name", () => {
    const snapshot = inspectionSnapshot();
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(snapshot),
      routeBasePath: "/skills/acme/earnings-recap-live-1782117954",
      hostContext: {
        handle: "acme/earnings-recap-live-1782117954",
        ownerSlug: "acme",
        skillName: "earnings-recap-live-1782117954",
      },
    }));

    expect(html).toContain(">acme</");
    expect(html).toContain(">earnings-recap-live-1782117954</a>");
    expect(html).not.toContain(">Earnings Skill</a>");
  });

  test("can render the workspace without the contextual sidebar", () => {
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      routeBasePath: "/skills/alice/earnings",
      sidebarMode: "hidden",
    }));

    expect(html).toContain("data-testid=\"workbench-primary-content\"");
    expect(html).toContain("SKILL.md");
    expect(html).not.toContain(">About</h2>");
    expect(html).not.toContain("Workbench skill source.");
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
      initialRoute: createFilesRoute({ file: { directoryPath: "references", filePath: null } }),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("root");
    expect(html).toContain("references");
    expect(html).toContain("guide.md");
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
    expect(html).toContain(">Measurement</th>");
    expect(html).toContain(">Quality</th>");
    expect(html).toContain(">Latency</th>");
    expect(html).toContain(">Cost</th>");
    expect(html).not.toContain(">Status</th>");
    expect(html).not.toContain(">Cases</th>");
    expect(html).not.toContain(">When</th>");
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
    expect(html).toContain("$0.05/sample");
    expect(html).not.toContain("$0.1234");
    expect(html).not.toContain("$0.06/sample");
    expect(html).not.toContain("375ms/sample");
    expect(html).not.toContain("eval total");
    expect(html).toContain("1.5s");
    expect(html).toContain("2 / 2 samples");
    expect(html).toContain("1 / 1 samples");
    expect(html).toContain("300ms/sample");
    expect(html).toMatch(/grade<\/span>\s+<span[^>]*>75ms\/sample<\/span>/u);
    expect(html).toMatch(/<button[^>]*>Quality vs Latency<\/button>/u);
    expect(html).toMatch(/<button[^>]*>Quality vs Cost<\/button>/u);
    expect(html).not.toMatch(/<button[^>]*>Latency per sample<\/button>/u);
    expect(html).toContain("href=\"/skills/alice/earnings/runs/run_eval\"");
    expect(html).not.toContain("Skill version");
    expect(html).not.toContain("View details");
    expect(html).not.toContain("Select all");
    expect(html).not.toContain("Current scorecard");
    expect(html).not.toContain("Active skill history");
  });

  test("renders Cases as the editable case matrix", () => {
    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createEvaluationRoute({ view: "cases", evaluationId: "eval_hash" }),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("Cases");
    expect(html).toContain("aria-label=\"Cases matrix\"");
    expect(html).toContain("Case one");
    expect(html).toContain("Criteria");
    expect(html).toContain("2 criteria");
    expect(html).toContain("earnings-prep v2");
    expect(html).toContain("earnings-prep v1");
    expect(html).toContain("command / deterministic");
    expect(html).toContain("score 0.920");
    expect(html).toContain("score 0.700");
    expect(html).toContain("1 sample");
    expect(html).toContain("Not run");
    expect(html).toContain("aria-label=\"Add configuration\"");
    expect(html).toContain(">Add case<");
    expect(html).not.toContain("Use task prompt");
    expect(html).not.toContain("placeholder=\"Enter a prompt\"");
  });

  test("maps result versions to runnable matrix targets without using display ids as selectors", () => {
    const snapshot = inspectionSnapshot();
    const results = snapshot.results;
    if (!results) {
      throw new Error("Expected result fixture.");
    }
    const agent = results.agents.find((entry) => entry.name === "patcher");
    const historical = results.versions.find((entry) => entry.id === "v001");
    const current = results.versions.find((entry) => entry.id === "v002");
    if (!agent || !historical || !current) {
      throw new Error("Expected result versions and agent.");
    }

    expect(caseMatrixOperationTargetForResultVersion(snapshot, historical, agent)).toEqual({
      skill: "current",
      versionId: "v001",
      agent: "patcher",
    });
    expect(caseMatrixOperationTargetForResultVersion(snapshot, current, agent)).toEqual({
      skill: "current",
      agent: "patcher",
    });
    expect(caseMatrixOperationTargetForResultVersion(snapshot, {
      id: "none",
      label: "No skill",
      source: "none",
      sourceKind: "none",
      projectVersionId: "v002",
      contentHash: "no_skill_bundle_hash",
    }, agent)).toEqual({
      skill: "no-skill",
      versionId: "v002",
      agent: "patcher",
    });
  });

  test("renders authored evaluation cases and case detail sections", () => {
    const listHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createEvaluationRoute({ view: "cases", evaluationId: "eval_hash" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(listHtml).toContain("Case one");
    expect(listHtml).toContain("Criteria");
    expect(listHtml).toContain("2 criteria");
    expect(listHtml).toContain("href=\"/skills/alice/earnings/evaluation/cases/case_001?evaluation=eval_hash\"");
    expect(listHtml).toContain("earnings-prep v2");
    expect(listHtml).toContain("earnings-prep v1");
    expect(listHtml).toContain("command / deterministic");
    expect(listHtml).toContain("score 0.920");
    expect(listHtml).toContain("score 0.700");
    expect(listHtml).toContain("1 sample");
    expect(listHtml).toContain("Not run");
    expect(listHtml).toContain("aria-label=\"Add configuration\"");
    expect(listHtml).toContain(">Add case<");
    expect(listHtml).toContain("Inspect earnings-prep v2 for case_001");
    expect(listHtml).not.toContain("href=\"/skills/alice/earnings/runs/run_eval/jobs/job_execute_001");

    const definitionHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createCaseRoute({ caseId: "case_001", evaluationId: "eval_hash" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(definitionHtml).toContain("Case one");
    expect(definitionHtml).toContain("aria-label=\"Grading\"");
    expect(definitionHtml).toContain("Uses supported facts.");
    expect(definitionHtml).toContain("Covers the case-specific detail.");
    expect(definitionHtml).toContain("case.yaml");
    expect(definitionHtml).toContain("aria-label=\"Case files\"");
    expect(definitionHtml).toContain("aria-label=\"case.yaml preview\"");
    expect(definitionHtml).toContain("Rendered");
    expect(definitionHtml).toContain("Raw");
    expect(definitionHtml).toContain("aria-label=\"Case sections\"");
    expect(definitionHtml).toContain("href=\"/skills/alice/earnings/evaluation/cases/case_001?evaluation=eval_hash&amp;section=runs\"");
    expect(definitionHtml).not.toContain("All cases");
    expect(definitionHtml).not.toContain("href=\"#runs\"");
    expect(definitionHtml).not.toContain("href=\"/skills/alice/earnings/runs/run_eval\"");

    const runsHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createCaseRoute({ caseId: "case_001", evaluationId: "eval_hash", section: "runs" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(runsHtml).toContain("Runs");
    expect(runsHtml).toContain(">Operation</th>");
    expect(runsHtml).toContain(">Measurement</th>");
    expect(runsHtml).toContain(">Quality</th>");
    expect(runsHtml).toContain(">Latency</th>");
    expect(runsHtml).toContain(">Cost</th>");
    expect(runsHtml).toContain(">Updated</th>");
    expect(runsHtml).not.toContain(">Run</th>");
    expect(runsHtml).not.toContain(">Score</th>");
    expect(runsHtml).toContain("href=\"/skills/alice/earnings/runs/run_eval\"");
    expect(runsHtml).not.toContain("Case ID");
    expect(runsHtml).not.toContain(">Command</span>");
  });

  test("renders source-only compact case definitions without blocking on evidence", () => {
    const snapshot = inspectionSnapshot();
    delete snapshot.results;
    snapshot.runs = [];
    snapshot.jobs = [];
    snapshot.traces = [];
    snapshot.executionEvents = [];
    snapshot.artifacts = [];
    snapshot.lineage = [];

    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(snapshot, "source"),
      initialRoute: createEvaluationRoute({ view: "cases", evaluationId: "eval_hash" }),
      routeBasePath: "/skills/alice/earnings",
      hostContext: {
        handle: "alice/earnings",
        ownerSlug: "alice",
        skillName: "earnings",
        evidenceAccess: "source",
        sourceVisibility: "public",
      },
    }));

    expect(html).toContain("Case one");
    expect(html).toContain("Criteria");
    expect(html).toContain("2 criteria");
    expect(html).toContain("source only");
    expect(html).toContain("command / deterministic");
    expect(html).toContain("Not run");
    expect(html).not.toContain("aria-label=\"Add case\"");
    expect(html).not.toContain(">Add case<");
    expect(html).not.toContain("Inspect earnings-prep");
    expect(html).not.toContain("Loading evidence");
  });

  test("aggregates mixed sample outcomes in case matrix cells", () => {
    const snapshot = inspectionSnapshot();
    const run = snapshot.runs.find((entry) => entry.id === "run_eval");
    const sourceJob = snapshot.jobs.find((job) => job.id === "job_execute_001");
    if (!run || !sourceJob) {
      throw new Error("Expected run fixture evidence.");
    }
    const failedSample = {
      ...sourceJob,
      id: "job_execute_001_sample_2",
      sample: 1,
      status: "failed" as const,
      error: "Model rejected.",
      result: undefined,
      traceIds: [],
      artifactIds: [],
      durationMs: 500,
      startedAt: "2026-06-06T00:10:03.000Z",
      finishedAt: "2026-06-06T00:10:04.000Z",
    };
    run.status = "failed";
    run.jobIds = [...(run.jobIds ?? []), failedSample.id];
    snapshot.jobs.push(failedSample);

    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(snapshot),
      initialRoute: createEvaluationRoute({ view: "cases", evaluationId: "eval_hash" }),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("failed");
    expect(html).toContain("1 / 2 samples");
    expect(html).toContain("Inspect earnings-prep v2 for case_001");
    expect(html).not.toContain("href=\"/skills/alice/earnings/runs/run_eval/jobs/job_execute_001");
  });

  test("renders Runs and full run detail pages", () => {
    const runsHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createRunsRoute(),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(runsHtml).toContain("Runs");
    expect(runsHtml).toContain(">Operation</th>");
    expect(runsHtml).toContain(">Measurement</th>");
    expect(runsHtml).toContain(">Quality</th>");
    expect(runsHtml).toContain(">Latency</th>");
    expect(runsHtml).toContain(">Cost</th>");
    expect(runsHtml).toContain(">Updated</th>");
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
      initialRoute: createRunRoute({ runId: "run_eval" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(summaryHtml).toContain("Eval: earnings-prep v2 on Evaluation 1");
    expect(summaryHtml).toContain("aria-label=\"Run sections\"");
    expect(summaryHtml).toContain("2 / 2 samples");
    expect(summaryHtml).toContain("Latency");
    expect(summaryHtml).toContain("Measurements");
    expect(summaryHtml).toContain(">Measurement</th>");
    expect(summaryHtml).toContain(">Coverage</th>");
    expect(summaryHtml).toContain("Case results");
    expect(summaryHtml).toContain(">Case</th>");
    expect(summaryHtml).toContain(">Quality</th>");
    expect(summaryHtml).toContain("command / deterministic");
    expect(summaryHtml).toContain("case_001 · earnings-prep v2 · command / deterministic");
    expect(summaryHtml).not.toContain("case_001 execute");
    expect(summaryHtml).not.toContain("case_001 grade");
    expect(summaryHtml).toContain("Timeline");
    expect(summaryHtml).toContain("Execution trace");
    expect(summaryHtml).toContain("href=\"/skills/alice/earnings/runs/run_eval/jobs/job_execute_001\"");
    expect(summaryHtml).not.toContain("Run commands");
    expect(summaryHtml).not.toContain("workbench show run_eval");
    expect(summaryHtml).not.toContain("workbench watch run_eval");
    expect(summaryHtml).not.toContain("workbench retry run_eval");
    expect(summaryHtml).not.toContain("<ul class=\"grid min-w-0 gap-2\">");
    expect(summaryHtml).not.toContain("<a class=\"font-medium text-primary no-underline hover:underline\"");
    expect(summaryHtml).not.toContain("data-testid=\"workbench-detail-pane\"");

    const executeTraceHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createRunJobRoute({ runId: "run_eval", jobId: "job_execute_001" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(executeTraceHtml).toContain("case_001");
    expect(executeTraceHtml).toContain("Case result");
    expect(executeTraceHtml).not.toContain("Case result / grade");
    expect(executeTraceHtml).toContain("Skill");
    expect(executeTraceHtml).toContain("Agent");
    expect(executeTraceHtml).toContain("Model");
    expect(executeTraceHtml).toContain("Phase");
    expect(executeTraceHtml).toContain("Status");
    expect(executeTraceHtml).toContain("Phase status");
    expect(executeTraceHtml).toContain("Quality");
    expect(executeTraceHtml).toContain("Phase score");
    expect(executeTraceHtml).toContain("Latency");
    expect(executeTraceHtml).toContain("Phase duration");
    expect(executeTraceHtml).toContain("command / deterministic");
    expect(executeTraceHtml).toContain("Execute");
    expect(executeTraceHtml).toContain("Grade");
    expect(executeTraceHtml).toContain("Timeline");
    expect(executeTraceHtml).toContain("Output");
    expect(executeTraceHtml).toContain("aria-label=\"Case result phases\"");
    expect(executeTraceHtml).toContain("class=\"flex min-w-0 flex-wrap items-center gap-4 border-b border-border/70 text-sm\"");
    expect(executeTraceHtml).toContain("class=\"flex min-w-0 justify-end\"");
    expect(executeTraceHtml).toContain("aria-label=\"Job evidence\"");
    expect(executeTraceHtml).toContain("Execute timeline");
    expect(executeTraceHtml).not.toContain("Grade timeline");
    expect(executeTraceHtml).toContain("Skill execution timeline for this case sample.");
    expect(executeTraceHtml).not.toContain("Judgment timeline for this case sample.");
    expect(executeTraceHtml).toContain("Loading job evidence...");
    expect(executeTraceHtml).toContain("href=\"/skills/alice/earnings/runs/run_eval/jobs/job_001\"");
    expect(executeTraceHtml).toContain("href=\"/skills/alice/earnings/runs/run_eval/jobs/job_execute_001?view=output\"");
    expect(executeTraceHtml).not.toContain("Captured files produced by this case run.");
    expect(executeTraceHtml).not.toContain("report.md");
    expect(executeTraceHtml).not.toContain("# Report");
    expect(executeTraceHtml).not.toContain("Run commands");
    expect(executeTraceHtml).not.toContain("workbench show run_eval");
    const caseResultHeadingIndex = executeTraceHtml.indexOf(">Case result</div>");
    const phaseNavIndex = executeTraceHtml.indexOf("aria-label=\"Case result phases\"");
    const factGridIndex = executeTraceHtml.indexOf(">Phase</div>");
    const evidenceNavIndex = executeTraceHtml.indexOf("aria-label=\"Job evidence\"");
    const tracePanelIndex = executeTraceHtml.indexOf("Execute timeline");
    expect(caseResultHeadingIndex).toBeGreaterThan(-1);
    expect(phaseNavIndex).toBeGreaterThan(caseResultHeadingIndex);
    expect(evidenceNavIndex).toBeGreaterThan(factGridIndex);
    expect(tracePanelIndex).toBeGreaterThan(evidenceNavIndex);

    const gradeFailedSnapshot = inspectionSnapshot();
    gradeFailedSnapshot.runs = gradeFailedSnapshot.runs.map((run) => run.id === "run_eval"
      ? { ...run, status: "failed" as const }
      : run);
    gradeFailedSnapshot.jobs = gradeFailedSnapshot.jobs.map((job) => job.id === "job_001"
      ? { ...job, status: "failed" as const, error: "Grading mismatch.", durationMs: 3000 }
      : job);
    const executeWithFailedGradeHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(gradeFailedSnapshot),
      initialRoute: createRunJobRoute({ runId: "run_eval", jobId: "job_execute_001" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    const failedCaseStatusIndex = executeWithFailedGradeHtml.indexOf(">Status</div>");
    const succeededPhaseStatusIndex = executeWithFailedGradeHtml.indexOf(">Phase status</div>");
    const failedStatusIndex = executeWithFailedGradeHtml.indexOf(">failed</", failedCaseStatusIndex);
    const succeededStatusIndex = executeWithFailedGradeHtml.indexOf(">succeeded</", succeededPhaseStatusIndex);
    expect(failedCaseStatusIndex).toBeGreaterThan(-1);
    expect(succeededPhaseStatusIndex).toBeGreaterThan(failedCaseStatusIndex);
    expect(failedStatusIndex).toBeGreaterThan(failedCaseStatusIndex);
    expect(failedStatusIndex).toBeLessThan(succeededPhaseStatusIndex);
    expect(succeededStatusIndex).toBeGreaterThan(succeededPhaseStatusIndex);
    expect(executeWithFailedGradeHtml).toContain("Case error");
    expect(executeWithFailedGradeHtml).toContain("Grading mismatch.");
    expect(executeWithFailedGradeHtml).not.toContain("Execute error");

    const outputHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(inspectionSnapshot()),
      initialRoute: createRunJobRoute({ runId: "run_eval", jobId: "job_001", view: "output" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(outputHtml).toContain("case_001");
    expect(outputHtml).toContain("Execute");
    expect(outputHtml).toContain("Grade");
    expect(outputHtml).toContain("Timeline");
    expect(outputHtml).toContain("Output");
    expect(outputHtml).toContain("Captured files produced by this case run.");
    expect(outputHtml).toContain("report.md");
    expect(outputHtml).toContain("href=\"/skills/alice/earnings/runs/run_eval/jobs/job_001\"");
    expect(outputHtml).not.toContain("Loading job evidence...");
    expect(outputHtml).not.toContain("Execute timeline");
    expect(outputHtml).not.toContain("Grade timeline");
    expect(outputHtml).not.toContain("Run commands");
  });

  test("labels generic run summaries from the selected report role", () => {
    const snapshot = inspectionSnapshot();
    const sourceRun = snapshot.runs.find((run) => run.id === "run_improve");
    const sourceJob = snapshot.jobs.find((job) => job.id === "job_execute_001");
    if (!sourceRun || !sourceJob) {
      throw new Error("Expected improve run fixture source.");
    }
    const improveJob = {
      ...sourceJob,
      id: "job_improve_001",
      runId: sourceRun.id,
      kind: "improve" as const,
      role: "improve",
      caseId: "current",
      status: "succeeded" as const,
      result: undefined,
      artifactIds: [],
      traceIds: [],
      createdAt: "2026-06-06T00:05:00.000Z",
      startedAt: "2026-06-06T00:05:01.000Z",
      finishedAt: "2026-06-06T00:05:02.000Z",
      durationMs: 700,
    };
    snapshot.runs = snapshot.runs.map((run) => run.id === sourceRun.id
      ? { ...run, jobIds: [improveJob.id], traceIds: [] }
      : run);
    snapshot.jobs = [...snapshot.jobs, improveJob];

    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(snapshot),
      initialRoute: createRunRoute({ runId: sourceRun.id }),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("Jobs");
    expect(html).toContain("Latency");
    expect(html).toContain("700ms");
  });

  test("renders generic live job result summaries in the output view", () => {
    const snapshot = inspectionSnapshot();
    snapshot.runs = [{
      id: "run_live",
      kind: "live",
      versionId: "unknown",
      skillName: "earnings-live",
      skillBundleHash: "unknown",
      evalHash: "live",
      agentName: "claude",
      agentHash: "agent_live_claude",
      status: "succeeded",
      jobIds: ["job_live_session"],
      traceIds: ["trace_live_session"],
      createdAt: "2026-06-06T00:15:00.000Z",
      finishedAt: "2026-06-06T00:15:02.000Z",
      location: "local",
    }, ...snapshot.runs];
    snapshot.jobs = [...snapshot.jobs, {
      id: "job_live_session",
      runId: "run_live",
      kind: "live",
      role: "agent-session",
      versionId: "unknown",
      skillName: "earnings-live",
      skillBundleHash: "unknown",
      evalHash: "live",
      agentName: "claude",
      agentHash: "agent_live_claude",
      caseId: "current",
      sample: 0,
      status: "succeeded",
      adapter: { use: "claude" },
      result: {
        summary: "CLAUDE-LIVE-HAIKU45 OK",
        usage: { total: { provider: "anthropic", model: "claude-haiku-4-5" } },
      },
      artifactIds: [],
      traceIds: ["trace_live_session"],
      createdAt: "2026-06-06T00:15:00.000Z",
      startedAt: "2026-06-06T00:15:00.000Z",
      finishedAt: "2026-06-06T00:15:02.000Z",
      durationMs: 2000,
    }];
    snapshot.traces = [...snapshot.traces, {
      id: "trace_live_session",
      runId: "run_live",
      jobId: "job_live_session",
      versionId: "unknown",
      skillName: "earnings-live",
      skillBundleHash: "unknown",
      agentName: "claude",
      agentHash: "agent_live_claude",
      evalHash: "live",
      createdAt: "2026-06-06T00:15:00.000Z",
      updatedAt: "2026-06-06T00:15:02.000Z",
      request: {},
      result: {},
      protocol: "workbench.trace.v1",
      origin: "live",
      source: {
        host: "claude",
        sessionId: "session-live-001",
        workspaceRoot: "/tmp/earnings-live",
      },
      files: [],
    }];

    const summaryHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(snapshot),
      initialRoute: createRunRoute({ runId: "run_live" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(summaryHtml).toContain("href=\"/skills/alice/earnings/runs/run_live/jobs/job_live_session\"");
    expect(summaryHtml).toContain("Agent Session · earnings-live · claude");
    expect(summaryHtml).toContain("Live session: earnings-live with claude / claude-haiku-4-5");
    expect(summaryHtml).toContain("session-live-001");
    expect(summaryHtml).toContain("/tmp/earnings-live");
    expect(summaryHtml).not.toContain("Recorded evaluation");
    expect(summaryHtml).not.toContain("No case results are recorded for this run.");
    expect(summaryHtml).not.toContain("claude / claude / claude-haiku-4-5");

    const html = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(snapshot),
      initialRoute: createRunJobRoute({ runId: "run_live", jobId: "job_live_session", view: "output" }),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(html).toContain("Agent Session");
    expect(html).toContain("aria-label=\"Job evidence\"");
    expect(html).toContain("claude / claude-haiku-4-5");
    expect(html).toContain("session-live-001");
    expect(html).toContain("/tmp/earnings-live");
    expect(html).toContain("Result summary");
    expect(html).toContain("CLAUDE-LIVE-HAIKU45 OK");
    expect(html).not.toContain("No output recorded");
  });

  test("keeps custom case job roles reachable through canonical job routes", () => {
    const snapshot = inspectionSnapshot();
    const sourceJob = snapshot.jobs.find((job) => job.id === "job_execute_001");
    if (!sourceJob) {
      throw new Error("Expected run fixture source job.");
    }
    const reviewJob = {
      ...sourceJob,
      id: "job_review_001",
      role: "review",
      status: "succeeded" as const,
      result: { summary: "Reviewed the case output." },
      artifactIds: [],
      traceIds: [],
      createdAt: "2026-06-06T00:12:00.000Z",
      startedAt: "2026-06-06T00:12:01.000Z",
      finishedAt: "2026-06-06T00:12:02.000Z",
      durationMs: 1000,
    };
    snapshot.runs = snapshot.runs.map((run) => run.id === "run_eval"
      ? { ...run, jobIds: [reviewJob.id], traceIds: [] }
      : run);
    snapshot.jobs = [
      ...snapshot.jobs.filter((job) => job.runId !== "run_eval"),
      reviewJob,
    ];

    const summaryHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(snapshot),
      initialRoute: createRunRoute({ runId: "run_eval" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(summaryHtml).toContain("href=\"/skills/alice/earnings/runs/run_eval/jobs/job_review_001\"");

    const jobHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(snapshot),
      initialRoute: createRunJobRoute({ runId: "run_eval", jobId: "job_review_001" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(jobHtml).toContain("aria-label=\"Review evidence\"");
    expect(jobHtml).toContain("Review timeline");
    expect(jobHtml).toContain("href=\"/skills/alice/earnings/runs/run_eval/jobs/job_review_001?view=output\"");
    expect(jobHtml).not.toContain("aria-label=\"Case result phases\"");
  });

  test("keeps multi-agent canceled case results distinguishable", () => {
    const snapshot = inspectionSnapshot();
    const baseJob = snapshot.jobs.find((job) => job.id === "job_001");
    if (!baseJob || !snapshot.results) {
      throw new Error("Expected run fixture evidence.");
    }
    const canceledCodex = {
      ...baseJob,
      id: "job_cancel_codex",
      status: "canceled" as const,
      result: undefined,
      error: "Dependency failed.",
      artifactIds: [],
      traceIds: [],
    };
    const canceledClaude = {
      ...baseJob,
      id: "job_cancel_claude",
      agentName: "claude",
      agentHash: "agent_claude",
      status: "canceled" as const,
      result: undefined,
      error: "Dependency failed.",
      artifactIds: [],
      traceIds: [],
    };
    const canceledSnapshot: WorkbenchInspectionSnapshot = {
      ...snapshot,
      results: {
        ...snapshot.results,
        agents: [
          ...snapshot.results.agents,
          {
            id: "agent_claude",
            name: "claude",
            label: "claude / opus",
            adapter: "claude",
            model: "opus",
          },
        ],
      },
      runs: snapshot.runs.map((run) => run.id === "run_eval"
        ? {
          ...run,
          status: "failed" as const,
          jobIds: [canceledCodex.id, canceledClaude.id],
          traceIds: [],
        }
        : run),
      jobs: [
        ...snapshot.jobs.filter((job) => job.runId !== "run_eval"),
        canceledCodex,
        canceledClaude,
      ],
    };

    const summaryHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(canceledSnapshot),
      initialRoute: createRunRoute({ runId: "run_eval" }),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(summaryHtml).toContain("Case results");
    expect(summaryHtml).toContain(">Measurement</th>");
    expect(summaryHtml).toContain("command / deterministic");
    expect(summaryHtml).toContain("claude / opus");
    expect(summaryHtml).not.toContain("command / deterministic / command / deterministic");
    expect(summaryHtml).not.toContain("claude / opus / claude / opus");
    expect(summaryHtml).toContain("canceled");
  });

  test("renders cached run envelopes over reused job evidence", () => {
    const snapshot = inspectionSnapshot();
    const reusedJob = snapshot.jobs.find((job) => job.id === "job_001");
    const sourceRun = snapshot.runs.find((run) => run.id === "run_eval");
    if (!reusedJob || !sourceRun) {
      throw new Error("Expected run fixture evidence.");
    }
    Object.assign(reusedJob, {
      role: "grade",
      result: { items: [{ kind: "score", score: 0.92, value: 0.92 }] },
    });
    snapshot.runs.push({
      ...sourceRun,
      id: "run_cached",
      jobIds: [reusedJob.id],
      traceIds: [],
      createdAt: "2026-06-06T00:14:00.000Z",
      finishedAt: "2026-06-06T00:14:01.000Z",
    });

    const summaryHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(snapshot),
      initialRoute: createRunRoute({ runId: "run_cached" }),
      routeBasePath: "/skills/alice/earnings",
    }));

    expect(summaryHtml).toContain("0.920");
    expect(summaryHtml).toContain("1 / 1 covered");
    expect(summaryHtml).toContain("Execution trace / 1 trace");
    expect(summaryHtml).toContain("href=\"/skills/alice/earnings/runs/run_cached/jobs/job_001\"");
    expect(summaryHtml).not.toContain("No case results are recorded for this run.");

    const caseRunsHtml = renderToStaticMarkup(createElement(WorkbenchWorkspace, {
      initialEnvelope: inspectionEnvelope(snapshot),
      initialRoute: createCaseRoute({ caseId: "case_001", evaluationId: "eval_hash", section: "runs" }),
      routeBasePath: "/skills/alice/earnings",
    }));
    expect(caseRunsHtml).toContain("href=\"/skills/alice/earnings/runs/run_cached\"");
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

function inspectionEnvelope(
  snapshot: WorkbenchInspectionSnapshot,
  evidenceAccess: "full" | "source" = "full",
): WorkbenchInspectionSnapshotEnvelope {
  const canRun = evidenceAccess === "full";
  const caseIds = snapshot.evals[0]?.cases.map((entry) => entry.id) ?? [];
  const target = {
    skill: snapshot.status.defaultSkill ?? "current",
    versionId: "v001",
    agent: snapshot.status.defaultAgent ?? "patcher",
  };
  const evalRequest = (
    phases: ["execute"] | ["grade"] | ["execute", "grade"],
  ) => ({
    kind: "eval" as const,
    variant: "local" as const,
    caseIds,
    targets: [target],
    phases,
    grader: phases.includes("grade") ? { kind: "evaluation" as const } : { kind: "none" as const },
    samples: 1,
  });
  return {
    schema: "workbench.inspection.snapshot-envelope.v1",
    cursor: "test:1",
    snapshot,
    actions: {
      variant: "local",
      evidenceAccess,
      run: {
        enabled: canRun,
        defaultRequest: evalRequest(["execute"]),
        ...(canRun ? {} : { disabledReason: "Source-only pages cannot start runs." }),
      },
      grade: {
        enabled: canRun,
        defaultRequest: evalRequest(["grade"]),
        ...(canRun ? {} : { disabledReason: "Source-only pages cannot start grading." }),
      },
      eval: {
        enabled: canRun,
        defaultRequest: evalRequest(["execute", "grade"]),
        ...(canRun ? {} : { disabledReason: "Source-only pages cannot start evaluations." }),
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

function gradePlanFixture(
  adapter: string,
  summary: string,
  items: Array<{ label: string; description: string; meta?: string }> = [],
  casePath = "cases/case_001/case.yaml",
): WorkbenchEvalCaseSnapshot["grade"] {
  return {
    adapter,
    label: adapter === "rubric" ? "Criteria" : adapter,
    summary,
    sources: [
      { path: "eval.yaml", role: "global" },
      { path: casePath, role: "case" },
    ],
    display: [{
      kind: "list",
      title: "Criteria",
      items,
    }],
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
        path: "references/guide.md",
        kind: "text" as const,
        encoding: "utf8" as const,
        content: "Use current filings and cite source documents.\n",
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
      gradeAdapter: "rubric",
      createdAt: "2026-06-06T00:10:00.000Z",
      updatedAt: "2026-06-06T00:10:00.000Z",
      files: [{
        path: "eval.yaml",
        kind: "text",
        encoding: "utf8",
        content: "version: 1\ngrade:\n  adapter: rubric\n",
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
        grade: gradePlanFixture("rubric", "2 criteria", [
          { label: "accuracy", description: "Uses supported facts.", meta: "global" },
          { label: "case-detail", description: "Covers the case-specific detail.", meta: "case" },
        ]),
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
        grade: gradePlanFixture("rubric", "1 criterion", [
          { label: "accuracy", description: "Uses supported facts.", meta: "global" },
        ], "cases/case_002/case.yaml"),
        files: [{
          path: "cases/case_002/case.yaml",
          kind: "text",
          encoding: "utf8",
          content: "id: case_002\ntitle: Case two\n",
        }],
      }],
    }],
    evaluationFiles: [{
      path: "agents.yaml",
      kind: "text",
      encoding: "utf8",
      content: "schema: workbench.agents.v1\ndefault: patcher\n",
    }, {
      path: "environment/Dockerfile",
      kind: "text",
      encoding: "utf8",
      content: "FROM workbench/workbench-node-22:envv_node_22\n",
    }, {
      path: "eval.yaml",
      kind: "text",
      encoding: "utf8",
      content: "version: 1\ngrade:\n  adapter: rubric\n",
    }, {
      path: "cases/case_001/case.yaml",
      kind: "text",
      encoding: "utf8",
      content: "id: case_001\ntitle: Case one\ncommand: npm test -- case-one\n",
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
        gradeAdapter: "rubric",
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
        report: jobReport({ costUsd: 0.05, totalMs: 1500 }),
        coverage: { completed: 1, planned: 1 },
      }, {
        skillVersionId: "v002",
        evaluationId: "eval_hash",
        agentVersionId: "agent_hash",
        runId: "run_eval",
        quality: 0.92,
        report: jobReport({ costUsd: 0.1234, gradeCostUsd: 0.0234, gradeMs: 150, totalMs: 750, unitCount: 2 }),
        coverage: { completed: 2, planned: 2 },
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
      jobIds: ["job_execute_001", "job_001", "job_execute_002", "job_grade_002"],
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
      role: "grade",
      caseId: "case_001",
      sample: 0,
      status: "succeeded",
      result: { items: [{ kind: "score", score: 0.7, value: 0.7 }] },
      dockerImage: "node:22",
      artifactIds: [],
      traceIds: [],
      createdAt: "2026-06-06T00:08:00.000Z",
      startedAt: "2026-06-06T00:08:01.000Z",
      finishedAt: "2026-06-06T00:08:02.000Z",
      durationMs: 1000,
    }, {
      id: "job_execute_001",
      runId: "run_eval",
      kind: "eval",
      versionId: "v002",
      skillName: "current",
      skillBundleHash: "skill_bundle_hash",
      evalHash: "eval_hash",
      agentName: "patcher",
      agentHash: "agent_hash",
      role: "execute",
      caseId: "case_001",
      sample: 0,
      status: "succeeded",
      result: { summary: "Draft explains revenue, margin, and guidance." },
      dockerImage: "node:22",
      artifactIds: [],
      traceIds: [],
      createdAt: "2026-06-06T00:10:00.000Z",
      startedAt: "2026-06-06T00:10:01.000Z",
      finishedAt: "2026-06-06T00:10:02.000Z",
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
      role: "grade",
      caseId: "case_001",
      sample: 0,
      status: "succeeded",
      result: { items: [{ kind: "score", score: 0.92, value: 0.92 }] },
      dockerImage: "node:22",
      artifactIds: ["artifact_001"],
      traceIds: ["trace_eval"],
      createdAt: "2026-06-06T00:10:00.000Z",
      startedAt: "2026-06-06T00:10:01.000Z",
      finishedAt: "2026-06-06T00:10:02.000Z",
      durationMs: 1000,
    }, {
      id: "job_execute_002",
      runId: "run_eval",
      kind: "eval",
      versionId: "v002",
      skillName: "current",
      skillBundleHash: "skill_bundle_hash",
      evalHash: "eval_hash",
      agentName: "patcher",
      agentHash: "agent_hash",
      role: "execute",
      caseId: "case_002",
      sample: 0,
      status: "succeeded",
      dockerImage: "node:22",
      artifactIds: [],
      traceIds: [],
      createdAt: "2026-06-06T00:10:00.000Z",
      startedAt: "2026-06-06T00:10:01.000Z",
      finishedAt: "2026-06-06T00:10:02.000Z",
      durationMs: 1000,
    }, {
      id: "job_grade_002",
      runId: "run_eval",
      kind: "eval",
      versionId: "v002",
      skillName: "current",
      skillBundleHash: "skill_bundle_hash",
      evalHash: "eval_hash",
      agentName: "patcher",
      agentHash: "agent_hash",
      role: "grade",
      caseId: "case_002",
      sample: 0,
      status: "succeeded",
      result: { items: [{ kind: "score", score: 0.92, value: 0.92 }] },
      dockerImage: "node:22",
      artifactIds: [],
      traceIds: [],
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
      evalHash: "eval_hash",
      createdAt: "2026-06-06T00:10:01.000Z",
      updatedAt: "2026-06-06T00:10:02.000Z",
      request: { caseId: "case_001" },
      result: { ok: true },
      protocol: "workbench.trace.v1",
      origin: "eval",
      status: {
        capture: "captured",
        execution: "completed",
        grade: "graded",
        review: "unreviewed",
        promotion: "none",
      },
      source: { host: "command", sessionId: "run_eval", turnId: "job_001" },
      links: [
        { type: "run", id: "run_eval" },
        { type: "job", id: "job_001" },
        { type: "case", id: "case_001" },
        { type: "version", id: "v002" },
        { type: "agent", id: "patcher" },
      ],
      input: { prompt: "Inspect earnings." },
      output: { assistantText: "Done." },
      review: { status: "unreviewed" },
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
      url: "https://workbench.ai/skills/acme/skill",
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

function jobReport(options: { costUsd?: number; gradeCostUsd?: number; gradeMs?: number; totalMs?: number; unitCount?: number } = {}) {
  const totalMs = options.totalMs ?? 900;
  const unitCount = options.unitCount ?? 1;
  const gradeMs = options.gradeMs ?? 0;
  const gradeCostUsd = options.gradeCostUsd ?? 0;
  const executeCostUsd = options.costUsd === undefined
    ? undefined
    : Number(Math.max(0, options.costUsd - gradeCostUsd).toFixed(6));
  return {
    unitCount,
    jobCount: gradeMs > 0 || gradeCostUsd > 0 ? 2 : 1,
    totalDurationMs: totalMs,
    roles: [{
      role: "execute",
      jobCount: 1,
      queued: 0,
      running: 0,
      succeeded: 1,
      failed: 0,
      canceled: 0,
      totalDurationMs: Math.max(0, totalMs - gradeMs),
      ...(executeCostUsd !== undefined ? { costUsd: executeCostUsd } : {}),
    }, ...(gradeMs > 0 || gradeCostUsd > 0 ? [{
      role: "grade",
      jobCount: 1,
      queued: 0,
      running: 0,
      succeeded: 1,
      failed: 0,
      canceled: 0,
      totalDurationMs: gradeMs,
      costUsd: gradeCostUsd,
    }] : [])],
  };
}
