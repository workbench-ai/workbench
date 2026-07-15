import { createElement, type ComponentProps } from "react";
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

const ROUTE_BASE = "/skills/alice/earnings";

function renderWorkspace(
  snapshot: WorkbenchInspectionSnapshot,
  options: Omit<ComponentProps<typeof WorkbenchWorkspace>, "initialEnvelope"> & { evidenceAccess?: "full" | "package" } = {},
): string {
  const { evidenceAccess = "full", ...props } = options;
  return renderToStaticMarkup(createElement(WorkbenchWorkspace, {
    initialEnvelope: inspectionEnvelope(snapshot, evidenceAccess),
    routeBasePath: ROUTE_BASE,
    ...props,
  }));
}

describe("hub-shaped Workbench UI", () => {
  test("parses and builds the hard-cut routes", () => {
    const base = "/skills/alice/earnings";
    expect(parseWorkbenchRoute("/", "/")).toEqual(createFilesRoute());
    const parsedRoutes = [
      [base, createFilesRoute()],
      [`${base}/files?file=SKILL.md&view=raw`, createFilesRoute({ file: { filePath: "SKILL.md", directoryPath: null, previewMode: "raw" } })],
      [`${base}/files?version=v001&file=SKILL.md`, createFilesRoute({ file: { versionId: "v001", filePath: "SKILL.md" } })],
      [`${base}/files?dir=references`, createFilesRoute({ file: { filePath: null, directoryPath: "references", previewMode: "rendered" } })],
      [`${base}/evaluation`, createEvaluationRoute({ view: "results" })],
      [`${base}/evaluation/cases?eval=eval-v1`, createEvaluationRoute({ view: "cases", evalVersionId: "eval-v1" })],
      [`${base}/evaluation/cases/case_001?eval=eval-v1`, createCaseRoute({ caseId: "case_001", evalVersionId: "eval-v1" })],
      [`${base}/evaluation/cases/case_001?eval=eval-v1&file=cases%2Fcase_001%2Fnotes.md&view=raw`, createCaseRoute({ caseId: "case_001", evalVersionId: "eval-v1", file: { filePath: "cases/case_001/notes.md", previewMode: "raw" } })],
      [`${base}/evaluation/cases/case_001?eval=eval-v1&section=runs`, createCaseRoute({ caseId: "case_001", evalVersionId: "eval-v1", section: "runs" })],
      [`${base}/runs`, createRunsRoute()],
      [`${base}/runs/run_eval`, createRunRoute({ runId: "run_eval" })],
      [`${base}/runs/run_eval/jobs/job_001`, createRunJobRoute({ runId: "run_eval", jobId: "job_001" })],
      [`${base}/runs/run_eval/jobs/job_001?view=output`, createRunJobRoute({ runId: "run_eval", jobId: "job_001", view: "output" })],
    ] as const;
    for (const [href, route] of parsedRoutes) expect(parseWorkbenchLocation(href, base), href).toEqual(route);
    const builtRoutes = [
      [createFilesRoute({ file: { filePath: "SKILL.md", directoryPath: null, previewMode: "raw" } }), `${base}/files?file=SKILL.md&view=raw`],
      [createFilesRoute({ file: { versionId: "v001", filePath: "SKILL.md" } }), `${base}/files?version=v001&file=SKILL.md`],
      [createFilesRoute({ file: { filePath: null, directoryPath: "references", previewMode: "rendered" } }), `${base}/files?dir=references`],
      [createEvaluationRoute({ view: "cases", evalVersionId: "eval-v1" }), `${base}/evaluation/cases?eval=eval-v1`],
      [createCaseRoute({ caseId: "case_001", evalVersionId: "eval-v1", file: { filePath: "cases/case_001/notes.md", previewMode: "raw" } }), `${base}/evaluation/cases/case_001?eval=eval-v1&file=cases%2Fcase_001%2Fnotes.md&view=raw`],
      [withFileRouteState(createCaseRoute({ caseId: "case_001", evalVersionId: "eval-v1", file: emptyFileRouteState() }), { filePath: "cases/case_001/notes.md", previewMode: "raw", versionId: "ignored-for-cases" }), `${base}/evaluation/cases/case_001?eval=eval-v1&file=cases%2Fcase_001%2Fnotes.md&view=raw`],
      [createCaseRoute({ caseId: "case_001", evalVersionId: "eval-v1", section: "runs" }), `${base}/evaluation/cases/case_001?eval=eval-v1&section=runs`],
      [createRunRoute({ runId: "run_eval" }), `${base}/runs/run_eval`],
      [createRunJobRoute({ runId: "run_eval", jobId: "job_001" }), `${base}/runs/run_eval/jobs/job_001`],
      [createRunJobRoute({ runId: "run_eval", jobId: "job_001", view: "output" }), `${base}/runs/run_eval/jobs/job_001?view=output`],
    ] as const;
    for (const [route, href] of builtRoutes) expect(buildWorkbenchLocationHref(route, base), href).toBe(href);
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
    const html = renderWorkspace(inspectionSnapshot(), {
      headerControls: createElement("nav", { "data-testid": "account-nav" }, "Account navigation"),
      hostContext: {
        handle: "acme/skill",
        ownerSlug: "acme",
        skillName: "earnings",
        visibility: "public",
        evidenceAccess: "full",
      },
    });

    expectHtmlContains(html, [">Workbench</span>", "Account navigation", "Files", "Evals", "Runs", "data-testid=\"top-loading-bar\"", "data-active=\"false\"", "SKILL.md", "Version history", "data-testid=\"version-select\"", "Reads earnings documents.", "Use skill", "data-workbench-operation=\"evaluate\""]);
    expectHtmlOmits(html, ["data-workbench-operation=\"run\"", "data-workbench-operation=\"grade\"", "Eval setup", "1 evaluation", "Authored source for the current skill version.", "aria-current=\"true\"", "Repository overview.", "Selected source preview.", "Workbench views", "Compare</", "data-testid=\"workbench-detail-pane\""]);
  });

  test("renders the canonical handle slug instead of the frontmatter name", () => {
    const snapshot = inspectionSnapshot();
    const html = renderWorkspace(snapshot, {
      routeBasePath: "/skills/acme/earnings-recap-live-1782117954",
      hostContext: {
        handle: "acme/earnings-recap-live-1782117954",
        ownerSlug: "acme",
        skillName: "earnings-recap-live-1782117954",
      },
    });

    expectHtmlContains(html, [">acme</", ">earnings-recap-live-1782117954</a>"]);
    expectHtmlOmits(html, [">Earnings Skill</a>"]);
  });

  test("can render the workspace without the contextual sidebar", () => {
    const html = renderWorkspace(inspectionSnapshot(), {
      sidebarMode: "hidden",
    });

    expectHtmlContains(html, ["data-testid=\"workbench-primary-content\"", "SKILL.md"]);
    expect(html.match(/<main\b/gu)).toHaveLength(1);
    expectHtmlOmits(html, [">About</h2>", "Workbench skill package."]);
  });

  test("renders a skeleton for source previews without embedded content", () => {
    const html = renderWorkspace(inspectionSnapshot(), {
      initialRoute: createFilesRoute({ file: { versionId: "v001", filePath: "SKILL.md" } }),
    });

    expectHtmlContains(html, ["data-testid=\"source-preview-loading\""]);
    expectHtmlOmits(html, ["Loading preview..."]);
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
    snapshot.evalVersions = [{
      id: "eval-v1",
      hash: "eval_old",
      label: "Eval v1",
      ordinal: 1,
      current: false,
      caseCount: 4,
      gradeAdapter: latestEval.grade.adapter,
      createdAt: "2026-06-06T00:05:00.000Z",
      updatedAt: "2026-06-06T00:05:00.000Z",
      runCount: 0,
    }, {
      id: "eval-v2",
      hash: "eval_current",
      label: "Eval v2",
      ordinal: 2,
      current: true,
      caseCount: 2,
      gradeAdapter: latestEval.grade.adapter,
      createdAt: "2026-06-06T00:15:00.000Z",
      updatedAt: "2026-06-06T00:15:00.000Z",
      runCount: 0,
    }];

    const html = renderWorkspace(snapshot);

    expectHtmlContains(html, ["2 cases"]);
    expectHtmlOmits(html, ["6 cases"]);
  });

  test("does not auto-select a file when opening a folder", () => {
    const html = renderWorkspace(inspectionSnapshot(), {
      initialRoute: createFilesRoute({ file: { directoryPath: "references", filePath: null } }),
    });

    expectHtmlContains(html, ["root", "references", "guide.md"]);
    expectHtmlOmits(html, ["No file selected", "Select a source file from the repository list.", "Select a source file to preview.", "Selected source preview."]);
  });

  test("renders Evaluation Results with the scorecard", () => {
    const html = renderWorkspace(inspectionSnapshot(), {
      initialRoute: createEvaluationRoute({ view: "results" }),
    });

    expectHtmlContains(html, ["Results", "Cases", "Eval v1 current", "data-testid=\"evaluation-results-visual-summary\"", "data-testid=\"evaluation-quality-chart\"", "data-testid=\"evaluation-latency-chart\"", "data-testid=\"evaluation-cost-chart\"", "data-testid=\"evaluation-tradeoff-chart\"", "data-testid=\"evaluation-tradeoff-plot\"", "recharts-responsive-container", "Quality vs Latency", "data-testid=\"evaluation-results-leaderboard\""]);
    expect(html.match(/data-testid="evaluation-results-version-group"/g)?.length).toBe(2);
    expectHtmlContains(html, [">Measurement</th>", ">Quality</th>", ">Latency</th>", ">Cost</th>", "earnings-prep v2", "earnings-prep v1", "0.920", "0.700", "$0.05/sample", "1.5s", "2 / 2 samples", "1 / 1 samples", "300ms/sample"]);
    expectHtmlOmits(html, [">Status</th>", ">Cases</th>", ">When</th>", ">#</th>", ">Run</th>", ">Mode</th>", ">Version</th>", "1 setup", "Best 0.920", "Mean 0.920", "Succeeded 1/1", "Lowest cost $0.12", "$0.1234", "$0.06/sample", "375ms/sample", "eval total"]);
    expect(html).toMatch(/grade<\/span>\s+<span[^>]*>75ms\/sample<\/span>/u);
    expect(html).toMatch(/<button[^>]*>Quality vs Latency<\/button>/u);
    expect(html).toMatch(/<button[^>]*>Quality vs Cost<\/button>/u);
    expect(html).not.toMatch(/<button[^>]*>Latency per sample<\/button>/u);
    expectHtmlContains(html, ["href=\"/skills/alice/earnings/runs/run_eval\""]);
    expectHtmlOmits(html, ["Skill version", "View details", "Select all", "Current scorecard", "Active skill history"]);
  });

  test("renders Cases as the editable case matrix", () => {
    const html = renderWorkspace(inspectionSnapshot(), {
      initialRoute: createEvaluationRoute({ view: "cases", evalVersionId: "eval-v1" }),
    });

    expectHtmlContains(html, ["Cases", "aria-label=\"Cases matrix\"", "Default grader", "Edit", "case_001", "aria-label=\"Edit case_001\"", "Criteria", "2 criteria", "earnings-prep v2", "earnings-prep v1", "command / deterministic", "score 0.920", "score 0.700", "1 sample", "Not run", ">Add case<"]);
    expectHtmlOmits(html, ["aria-label=\"Add configuration\"", "Use task prompt", "placeholder=\"Enter a prompt\""]);
  });

  test("renders ungraded run-only cells as complete instead of needing grade", () => {
    const snapshot = inspectionSnapshot();
    const noGrade = gradePlanFixture("none", "No grader", []);
    const evalSnapshot = snapshot.evals[0];
    const resultCell = snapshot.results?.cells.find((cell) => cell.skillVersionId === "v002");
    if (!evalSnapshot || !resultCell || !snapshot.results) {
      throw new Error("Expected result fixture.");
    }
    evalSnapshot.grade = noGrade;
    evalSnapshot.caseCount = 1;
    evalSnapshot.cases = [{
      ...evalSnapshot.cases[0]!,
      grade: noGrade,
    }];
    snapshot.evalVersions = snapshot.evalVersions.map((entry) => ({
      ...entry,
      caseCount: 1,
      gradeAdapter: "none",
      latestQuality: undefined,
    }));
    snapshot.results = {
      ...snapshot.results,
      evalVersions: snapshot.results.evalVersions.map((entry) => ({
        ...entry,
        caseCount: 1,
        gradeAdapter: "none",
        latestQuality: undefined,
      })),
      cells: [{
        ...resultCell,
        jobIds: ["job_execute_001"],
        quality: undefined,
        coverage: { completed: 1, planned: 1 },
        report: jobReport({ totalMs: 1000, unitCount: 1 }),
      }],
    };
    snapshot.runs = [{
      ...snapshot.runs.find((run) => run.id === "run_eval")!,
      jobIds: ["job_execute_001"],
    }];
    snapshot.jobs = snapshot.jobs.filter((job) => job.id === "job_execute_001");

    const html = renderWorkspace(snapshot, {
      initialRoute: createEvaluationRoute({ view: "cases", evalVersionId: "eval-v1" }),
    });

    expectHtmlContains(html, ["succeeded", "1 / 1 samples"]);
    expectHtmlOmits(html, ["Needs grade"]);
  });

  test("keeps historical eval cases inspectable without source authoring controls", () => {
    const snapshot = inspectionSnapshot();
    snapshot.evalVersions = snapshot.evalVersions.map((entry) => ({ ...entry, current: false }));
    if (snapshot.results) {
      snapshot.results = {
        ...snapshot.results,
        evalVersions: snapshot.results.evalVersions.map((entry) => ({ ...entry, current: false })),
      };
    }

    const html = renderWorkspace(snapshot, {
      initialRoute: createEvaluationRoute({ view: "cases", evalVersionId: "eval-v1" }),
    });

    expectHtmlContains(html, ["aria-label=\"Cases matrix\"", "Default grader", "Historical evals are read-only. Switch to current to edit.", "case_001", "Inspect earnings-prep v2 for case_001", "href=\"/skills/alice/earnings/evaluation/cases/case_001?eval=eval-v1\""]);
    expectHtmlOmits(html, ["aria-label=\"Edit case_001\"", ">Add case<"]);
  });

  test("maps result versions to runnable matrix targets without using display ids as selectors", () => {
    const snapshot = inspectionSnapshot();
    const results = snapshot.results;
    if (!results) {
      throw new Error("Expected result fixture.");
    }
    const agent = results.agentVersions.find((entry) => entry.name === "patcher");
    const historical = results.skillVersions.find((entry) => entry.id === "v001");
    const current = results.skillVersions.find((entry) => entry.id === "v002");
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
    const listHtml = renderWorkspace(inspectionSnapshot(), {
      initialRoute: createEvaluationRoute({ view: "cases", evalVersionId: "eval-v1" }),
    });
    expectHtmlContains(listHtml, ["case_001", "Default grader", "Criteria", "2 criteria", "aria-label=\"Edit case_001\"", "earnings-prep v2", "earnings-prep v1", "command / deterministic", "score 0.920", "score 0.700", "1 / 1 samples", "1s/sample", "Not run", ">Add case<", "Inspect earnings-prep v2 for case_001"]);
    expectHtmlOmits(listHtml, ["href=\"/skills/alice/earnings/evaluation/cases/case_001?eval=eval-v1\"", "aria-label=\"Add configuration\"", "href=\"/skills/alice/earnings/runs/run_eval/jobs/job_execute_001"]);

    const definitionHtml = renderWorkspace(inspectionSnapshot(), {
      initialRoute: createCaseRoute({ caseId: "case_001", evalVersionId: "eval-v1" }),
    });
    expectHtmlContains(definitionHtml, ["case_001", "aria-label=\"Grading\"", "Uses supported facts.", "Covers the case-specific detail.", "case.yaml", "aria-label=\"Case files\"", "aria-label=\"case.yaml preview\"", "Rendered", "Raw", "aria-label=\"Case sections\"", "href=\"/skills/alice/earnings/evaluation/cases/case_001?eval=eval-v1&amp;section=runs\""]);
    expectHtmlOmits(definitionHtml, ["All cases", "href=\"#runs\"", "href=\"/skills/alice/earnings/runs/run_eval\""]);

    const runsHtml = renderWorkspace(inspectionSnapshot(), {
      initialRoute: createCaseRoute({ caseId: "case_001", evalVersionId: "eval-v1", section: "runs" }),
    });
    expectHtmlContains(runsHtml, ["Runs", ">Operation</th>", ">Measurement</th>", ">Quality</th>", ">Latency</th>", ">Cost</th>", ">Updated</th>", "href=\"/skills/alice/earnings/runs/run_eval\""]);
    expectHtmlOmits(runsHtml, [">Run</th>", ">Score</th>", "Case ID", ">Command</span>"]);
  });

  test("renders package-only compact case definitions without blocking on evidence", () => {
    const snapshot = inspectionSnapshot();
    delete snapshot.results;
    snapshot.agents = [];
    snapshot.runs = [];
    snapshot.jobs = [];
    snapshot.traces = [];
    snapshot.executionEvents = [];
    snapshot.artifacts = [];
    snapshot.lineage = [];

    const html = renderWorkspace(snapshot, {
      evidenceAccess: "package",
      initialRoute: createEvaluationRoute({ view: "cases", evalVersionId: "eval-v1" }),
      hostContext: {
        handle: "alice/earnings",
        ownerSlug: "alice",
        skillName: "earnings",
        evidenceAccess: "package",
        visibility: "public",
      },
    });

    expectHtmlContains(html, ["case_001", "Default grader", "Criteria", "2 criteria", "package only"]);
    expectHtmlOmits(html, ["min-w-[62rem]", "w-[20rem]", "aria-label=\"Add case\"", ">Add case<", "Inspect earnings-prep", "Loading evidence"]);
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
    run.jobIds = [...run.jobIds, failedSample.id];
    snapshot.jobs.push(failedSample);

    const html = renderWorkspace(snapshot, {
      initialRoute: createEvaluationRoute({ view: "cases", evalVersionId: "eval-v1" }),
    });

    expectHtmlContains(html, ["failed", "1 / 2 samples", "750ms/sample", "Inspect earnings-prep v2 for case_001"]);
    expect(html).toMatch(/grade<\/span>\s+<span[^>]*>500ms\/sample<\/span>/u);
    expectHtmlOmits(html, ["href=\"/skills/alice/earnings/runs/run_eval/jobs/job_execute_001"]);
  });

  test("renders Runs and full run detail pages", () => {
    const runsHtml = renderWorkspace(inspectionSnapshot(), {
      initialRoute: createRunsRoute(),
      lockedEvalVersionId: "eval-v1",
    });
    expectHtmlContains(runsHtml, ["Runs", ">Operation</th>", ">Measurement</th>", ">Quality</th>", ">Latency</th>", ">Cost</th>", ">Updated</th>", ">Eval</a>", "earnings-prep v2", "No skill", "command / deterministic", "href=\"/skills/alice/earnings/runs/run_eval\"", "Eval v1 · eval_hash"]);
    expectHtmlOmits(runsHtml, [">Run</th>", ">Kind</th>", ">Score</th>", ">run_eval</a>"]);

    const summaryHtml = renderWorkspace(inspectionSnapshot(), {
      initialRoute: createRunRoute({ runId: "run_eval" }),
    });
    expectHtmlContains(summaryHtml, ["Eval: earnings-prep v2 on Eval v1", "aria-label=\"Run sections\"", "2 / 2 samples", "Latency", "Measurements", ">Measurement</th>", ">Coverage</th>", "Case results", ">Case</th>", ">Quality</th>", "command / deterministic", "case_001 · earnings-prep v2 · command / deterministic", "Timeline", "Execution trace", "href=\"/skills/alice/earnings/runs/run_eval/jobs/job_execute_001\""]);
    expectHtmlOmits(summaryHtml, ["case_001 execute", "case_001 grade", "Run commands", "workbench show run_eval", "workbench watch run_eval", "workbench retry run_eval", "<ul class=\"grid min-w-0 gap-2\">", "<a class=\"font-medium text-primary no-underline hover:underline\"", "data-testid=\"workbench-detail-pane\""]);

    const executeTraceHtml = renderWorkspace(inspectionSnapshot(), {
      initialRoute: createRunJobRoute({ runId: "run_eval", jobId: "job_execute_001" }),
    });
    expectHtmlContains(executeTraceHtml, ["case_001", "Case result", "Skill", "Agent", "Model", "Step", "Status", "Step status", "Quality", "Step score", "Latency", "Step duration", "command / deterministic", "Run", "Grade", "Timeline", "Output", "aria-label=\"Case result steps\"", "class=\"flex min-w-0 flex-wrap items-center gap-4 border-b border-border/70 text-sm\"", "class=\"flex min-w-0 justify-end\"", "aria-label=\"Job evidence\"", "Run timeline", "Skill run timeline for this case sample.", "Loading job evidence...", "href=\"/skills/alice/earnings/runs/run_eval/jobs/job_001\"", "href=\"/skills/alice/earnings/runs/run_eval/jobs/job_execute_001?view=output\""]);
    expectHtmlOmits(executeTraceHtml, ["Case result / grade", "Grade timeline", "Judgment timeline for this case sample.", "Captured files produced by this case run.", "report.md", "# Report", "Run commands", "workbench show run_eval"]);
    const caseResultHeadingIndex = executeTraceHtml.indexOf(">Case result</div>");
    const phaseNavIndex = executeTraceHtml.indexOf("aria-label=\"Case result steps\"");
    const factGridIndex = executeTraceHtml.indexOf(">Step</div>");
    const evidenceNavIndex = executeTraceHtml.indexOf("aria-label=\"Job evidence\"");
    const tracePanelIndex = executeTraceHtml.indexOf("Run timeline");
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
    const executeWithFailedGradeHtml = renderWorkspace(gradeFailedSnapshot, {
      initialRoute: createRunJobRoute({ runId: "run_eval", jobId: "job_execute_001" }),
    });
    const failedCaseStatusIndex = executeWithFailedGradeHtml.indexOf(">Status</div>");
    const succeededPhaseStatusIndex = executeWithFailedGradeHtml.indexOf(">Step status</div>");
    const failedStatusIndex = executeWithFailedGradeHtml.indexOf(">failed</", failedCaseStatusIndex);
    const succeededStatusIndex = executeWithFailedGradeHtml.indexOf(">succeeded</", succeededPhaseStatusIndex);
    expect(failedCaseStatusIndex).toBeGreaterThan(-1);
    expect(succeededPhaseStatusIndex).toBeGreaterThan(failedCaseStatusIndex);
    expect(failedStatusIndex).toBeGreaterThan(failedCaseStatusIndex);
    expect(failedStatusIndex).toBeLessThan(succeededPhaseStatusIndex);
    expect(succeededStatusIndex).toBeGreaterThan(succeededPhaseStatusIndex);
    expectHtmlContains(executeWithFailedGradeHtml, ["Case error", "Grading mismatch."]);
    expectHtmlOmits(executeWithFailedGradeHtml, ["Run error"]);

    const outputHtml = renderWorkspace(inspectionSnapshot(), {
      initialRoute: createRunJobRoute({ runId: "run_eval", jobId: "job_001", view: "output" }),
    });
    expectHtmlContains(outputHtml, ["case_001", "Run", "Grade", "Timeline", "Output", "Captured files produced by this case run.", "report.md", "href=\"/skills/alice/earnings/runs/run_eval/jobs/job_001\""]);
    expectHtmlOmits(outputHtml, ["Loading job evidence...", "Run timeline", "Grade timeline", "Run commands"]);
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

    const html = renderWorkspace(snapshot, {
      initialRoute: createRunRoute({ runId: sourceRun.id }),
    });

    expectHtmlContains(html, ["Jobs", "Latency", "700ms"]);
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

    const summaryHtml = renderWorkspace(snapshot, {
      initialRoute: createRunRoute({ runId: "run_eval" }),
    });
    expectHtmlContains(summaryHtml, ["href=\"/skills/alice/earnings/runs/run_eval/jobs/job_review_001\""]);

    const jobHtml = renderWorkspace(snapshot, {
      initialRoute: createRunJobRoute({ runId: "run_eval", jobId: "job_review_001" }),
    });
    expectHtmlContains(jobHtml, ["aria-label=\"Review evidence\"", "Review timeline", "href=\"/skills/alice/earnings/runs/run_eval/jobs/job_review_001?view=output\""]);
    expectHtmlOmits(jobHtml, ["aria-label=\"Case result steps\""]);
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
        agentVersions: [
          ...snapshot.results.agentVersions,
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

    const summaryHtml = renderWorkspace(canceledSnapshot, {
      initialRoute: createRunRoute({ runId: "run_eval" }),
    });

    expectHtmlContains(summaryHtml, ["Case results", ">Measurement</th>", "command / deterministic", "claude / opus", "canceled"]);
    expectHtmlOmits(summaryHtml, ["command / deterministic / command / deterministic", "claude / opus / claude / opus"]);
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

    const summaryHtml = renderWorkspace(snapshot, {
      initialRoute: createRunRoute({ runId: "run_cached" }),
    });

    expectHtmlContains(summaryHtml, ["0.920", "1 / 1 covered", "Execution trace / 1 trace", "href=\"/skills/alice/earnings/runs/run_cached/jobs/job_001\""]);
    expectHtmlOmits(summaryHtml, ["No case results are recorded for this run."]);

    const caseRunsHtml = renderWorkspace(snapshot, {
      initialRoute: createCaseRoute({ caseId: "case_001", evalVersionId: "eval-v1", section: "runs" }),
    });
    expectHtmlContains(caseRunsHtml, ["href=\"/skills/alice/earnings/runs/run_cached\""]);
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

    const html = renderWorkspace(snapshot, {
      initialRoute: createRunsRoute(),
    });

    expectHtmlContains(html, ["1 running, 1 queued", "Refresh Workbench state"]);
    expectHtmlOmits(html, ["Idle"]);
    expect(renderWorkspace(snapshot, { initialRoute: createRunsRoute(), liveInspection: false })).not.toContain("Refresh Workbench state");
  });
});

function expectHtmlContains(html: string, values: readonly string[]): void {
  for (const value of values) expect(html).toContain(value);
}

function expectHtmlOmits(html: string, values: readonly string[]): void {
  for (const value of values) expect(html).not.toContain(value);
}

function inspectionEnvelope(
  snapshot: WorkbenchInspectionSnapshot,
  evidenceAccess: "full" | "package" = "full",
): WorkbenchInspectionSnapshotEnvelope {
  const canRun = evidenceAccess === "full";
  const caseIds = snapshot.evals[0]?.cases.map((entry) => entry.id) ?? [];
  const target = {
    skill: snapshot.status.defaultSkill ?? "current",
    versionId: "v001",
    agent: snapshot.status.defaultAgent ?? "patcher",
  };
  const evalRequest = (
    steps: ["run"] | ["grade"] | ["run", "grade"],
  ) => ({
    kind: "eval" as const,
    variant: "local" as const,
    caseIds,
    targets: [target],
    steps,
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
        defaultRequest: evalRequest(["run"]),
        ...(canRun ? {} : { disabledReason: "Package-only pages cannot start runs." }),
      },
      grade: {
        enabled: canRun,
        defaultRequest: evalRequest(["grade"]),
        ...(canRun ? {} : { disabledReason: "Package-only pages cannot start grading." }),
      },
      eval: {
        enabled: canRun,
        defaultRequest: evalRequest(["run", "grade"]),
        ...(canRun ? {} : { disabledReason: "Package-only pages cannot start evaluations." }),
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
    adapterSource: "eval",
    label: adapter === "none" ? "None" : adapter === "rubric" ? "Criteria" : adapter,
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
    authoring: gradeAuthoringFixture(adapter),
  };
}

function gradeAuthoringFixture(adapter: string): WorkbenchEvalCaseSnapshot["grade"]["authoring"] {
  if (adapter === "none") {
    return [];
  }
  if (adapter === "tests") {
    return [{
      kind: "file",
      name: "testScript",
      label: "Test script",
      path: "tests/test.sh",
    }];
  }
  if (adapter === "command") {
    return [{
      kind: "text",
      name: "command",
      label: "Command",
      multiline: true,
      required: true,
    }];
  }
  return [{
    kind: "list",
    name: "criteria",
    label: "Acceptance criteria",
    itemLabel: "Criterion",
    fields: [{
      kind: "text",
      name: "description",
      label: "Criterion",
    }],
  }];
}

function gradeAdapterOptionsFixture(): WorkbenchEvalSnapshot["gradeAdapters"] {
  return ["none", "rubric", "tests", "command"].map((adapter) => ({
    adapter,
    label: adapter === "none" ? "None" : adapter === "rubric" ? "Criteria" : adapter === "tests" ? "Tests" : "Command",
    authoring: gradePlanFixture(adapter, adapter === "rubric" ? "1 criterion" : "Case test harness").authoring,
  }));
}

type FixtureRun = WorkbenchInspectionSnapshot["runs"][number];
type FixtureJob = WorkbenchInspectionSnapshot["jobs"][number];

function textFixture(path: string, content = "") {
  return { path, kind: "text" as const, encoding: "utf8" as const, content };
}

function runFixture(id: string, overrides: Partial<Omit<FixtureRun, "id">> = {}): FixtureRun {
  return {
    id, kind: "eval", versionId: "v002", skillName: "current", skillBundleHash: "skill_bundle_hash",
    evalHash: "eval_hash", agentName: "patcher", agentHash: "agent_hash", status: "succeeded",
    jobIds: [], traceIds: [], createdAt: "2026-06-06T00:10:00.000Z", finishedAt: "2026-06-06T00:11:00.000Z",
    ...overrides,
  };
}

function jobFixture(id: string, role: string, caseId: string, overrides: Partial<Omit<FixtureJob, "id" | "role" | "caseId">> = {}): FixtureJob {
  return {
    id, runId: "run_eval", kind: "eval", versionId: "v002", skillName: "current",
    skillBundleHash: "skill_bundle_hash", evalHash: "eval_hash", agentName: "patcher", agentHash: "agent_hash",
    role, caseId, sample: 0, status: "succeeded", artifactIds: [], traceIds: [],
    createdAt: "2026-06-06T00:10:00.000Z", startedAt: "2026-06-06T00:10:01.000Z",
    finishedAt: "2026-06-06T00:10:02.000Z", durationMs: 1000, ...overrides,
  };
}

function inspectionSnapshot(): WorkbenchInspectionSnapshot {
  const versions = [{
    id: "v001", hash: "hash_v001_abcdef", message: "initial", parentIds: [],
    createdAt: "2026-06-06T00:00:00.000Z", files: [textFixture("SKILL.md")],
  }, {
    id: "v002", hash: "hash_v002_abcdef", message: "improved", parentIds: ["v001"],
    createdAt: "2026-06-06T00:05:00.000Z",
    files: [
      textFixture("SKILL.md", "---\nname: Earnings Skill\ndescription: Reads earnings documents.\n---\n"),
      textFixture("references/guide.md", "Use current filings and cite source documents.\n"),
    ],
  }];
  const bundleFiles = [textFixture("SKILL.md")];
  const skillBundle = {
    hash: "skill_bundle_hash", skillName: "current", entryName: "current",
    source: { name: "current", kind: "local" as const, path: "." },
    files: bundleFiles, includedSkills: [], createdAt: "2026-06-06T00:00:00.000Z",
  };
  const noSkillBundle = {
    hash: "no_skill_bundle_hash", skillName: "no-skill", entryName: "no-skill",
    source: { name: "no-skill", kind: "none" as const, source: "none", label: "No skill" },
    files: [], includedSkills: [], createdAt: "2026-06-06T00:00:00.000Z",
  };
  const agents = [{
    hash: "agent_hash", agent: { name: "patcher", adapter: "command", model: "deterministic", config: { image: "node:22" } },
  }];
  const criteria = [
    { label: "accuracy", description: "Uses supported facts.", meta: "global" },
    { label: "case-detail", description: "Covers the case-specific detail.", meta: "case" },
  ];
  const evalVersion = {
    id: "eval-v1", hash: "eval_hash", label: "Eval v1", ordinal: 1, current: true, caseCount: 2,
    gradeAdapter: "rubric", createdAt: "2026-06-06T00:10:00.000Z", updatedAt: "2026-06-06T00:10:00.000Z",
    runCount: 2, latestRunId: "run_eval", latestQuality: 0.92,
  };
  return {
    root: "/tmp/skill",
    status: {
      root: "/tmp/skill", initialized: true, currentVersionId: "v002", defaultSkill: "current",
      defaultAgent: "patcher", runCount: 4,
    },
    versions,
    skillSources: [
      { name: "current", kind: "local", path: "." },
      { name: "no-skill", kind: "none", source: "none", label: "No skill" },
    ],
    skillBundles: [skillBundle, noSkillBundle],
    evals: [{
      hash: "eval_hash", caseCount: 2, grade: gradePlanFixture("rubric", "2 criteria", criteria),
      gradeAdapters: gradeAdapterOptionsFixture(),
      createdAt: "2026-06-06T00:10:00.000Z", updatedAt: "2026-06-06T00:10:00.000Z",
      files: [
        textFixture("eval.yaml", "grade:\n  adapter: rubric\n"),
        textFixture("cases/case_001/case.yaml", "prompt: case_001\ncommand: npm test -- case-one\n"),
      ],
      cases: [{
        id: "case_001", path: "cases/case_001/case.yaml", command: "npm test -- case-one",
        grade: gradePlanFixture("rubric", "2 criteria", criteria),
        files: [textFixture("cases/case_001/case.yaml", "prompt: case_001\ncommand: npm test -- case-one\n")],
      }, {
        id: "case_002", path: "cases/case_002/case.yaml",
        grade: gradePlanFixture("rubric", "1 criterion", [
          { label: "accuracy", description: "Uses supported facts.", meta: "global" },
        ], "cases/case_002/case.yaml"),
        files: [textFixture("cases/case_002/case.yaml", "prompt: case_002\n")],
      }],
    }],
    evalVersions: [evalVersion],
    agents,
    results: {
      skillVersions: [{
        id: "v001", label: "earnings-prep v1", source: "local:.", sourceKind: "local",
        projectVersionId: "v001", contentHash: "skill_bundle_hash", files: bundleFiles,
      }, {
        id: "v002", label: "earnings-prep v2", source: "local:.", sourceKind: "local",
        projectVersionId: "v002", contentHash: "skill_bundle_hash", current: true, published: true, files: bundleFiles,
      }],
      evalVersions: [evalVersion],
      agentVersions: [{
        id: "agent_hash", name: "patcher", label: "command / deterministic", adapter: "command", model: "deterministic",
      }],
      cells: [{
        skillVersionId: "v001", evalVersionId: "eval-v1", agentVersionId: "agent_hash",
        runId: "run_eval_baseline", quality: 0.7,
        report: jobReport({ costUsd: 0.05, totalMs: 1500 }),
        coverage: { completed: 1, planned: 1 },
      }, {
        skillVersionId: "v002", evalVersionId: "eval-v1", agentVersionId: "agent_hash",
        runId: "run_eval", quality: 0.92,
        report: jobReport({ costUsd: 0.1234, gradeCostUsd: 0.0234, gradeMs: 150, totalMs: 750, unitCount: 2 }),
        coverage: { completed: 2, planned: 2 },
      }],
    },
    runs: [
      runFixture("run_eval_baseline", { versionId: "v001", jobIds: ["job_baseline"], createdAt: "2026-06-06T00:08:00.000Z", finishedAt: "2026-06-06T00:09:00.000Z" }),
      runFixture("run_eval", { jobIds: ["job_execute_001", "job_001", "job_execute_002", "job_grade_002"], traceIds: ["trace_eval"] }),
      runFixture("run_no_skill", { skillName: "no-skill", skillBundleHash: "no_skill_bundle_hash", createdAt: "2026-06-06T00:12:00.000Z", finishedAt: "2026-06-06T00:13:00.000Z" }),
      runFixture("run_improve", { kind: "improve", versionId: "v001", outputVersionId: "v002", jobIds: ["job_001"], traceIds: ["trace_improve"], createdAt: "2026-06-06T00:05:00.000Z", finishedAt: "2026-06-06T00:06:00.000Z" }),
    ],
    jobs: [
      jobFixture("job_baseline", "grade", "case_001", { runId: "run_eval_baseline", versionId: "v001", result: { items: [{ kind: "score", score: 0.7, value: 0.7 }] }, createdAt: "2026-06-06T00:08:00.000Z", startedAt: "2026-06-06T00:08:01.000Z", finishedAt: "2026-06-06T00:08:02.000Z" }),
      jobFixture("job_execute_001", "run", "case_001", { result: { summary: "Draft explains revenue, margin, and guidance." } }),
      jobFixture("job_001", "grade", "case_001", { result: { items: [{ kind: "score", score: 0.92, value: 0.92 }] }, artifactIds: ["artifact_001"], traceIds: ["trace_eval"] }),
      jobFixture("job_execute_002", "run", "case_002"),
      jobFixture("job_grade_002", "grade", "case_002", { result: { items: [{ kind: "score", score: 0.92, value: 0.92 }] } }),
    ],
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
      status: "completed",
      source: { adapterId: "command", sessionId: "run_eval", turnId: "job_001" },
      links: [
        { type: "run", id: "run_eval" },
        { type: "job", id: "job_001" },
        { type: "case", id: "case_001" },
        { type: "version", id: "v002" },
        { type: "agent", id: "patcher" },
      ],
      input: { prompt: "Inspect earnings." },
      output: { assistantText: "Done." },
      files: [{ path: "output/result.json", kind: "text", encoding: "utf8", content: "{\"ok\":true}\n" }],
    }],
    executionEvents: [],
    artifacts: [{
      id: "artifact_001",
      runId: "run_eval",
      jobId: "job_001",
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
      role: "run",
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
