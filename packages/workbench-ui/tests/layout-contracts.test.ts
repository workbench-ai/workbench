import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("workbench browser layout contracts", () => {
  test("benchmark pane brand links back to the home route unless remote shell overrides it", () => {
    const appSource = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain("Workbench home");
    expect(appSource).toContain("<WorkbenchBrand />");
    expect(appSource).not.toContain('product="Workbench"');
    expect(appSource).toContain('data-testid="app-brand-link"');
    expect(appSource).toContain("brandHref?: string");
    expect(appSource).toContain("const workbenchBrandHref = brandHref ?? benchmarkHref");
    expect(appSource).toContain("navigate(createBenchmarkRoute())");
  });

  test("remote controls mount into the shared workspace top bar", () => {
    const appSource = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain("headerControls?: ReactNode");
    expect(appSource).toContain("WorkspaceTopBar");
    expect(appSource).toContain("const workspaceHeader = (");
    expect(appSource).toContain("{headerControls}");
    expect(appSource).toContain("header={workspaceHeader}");
    expect(appSource).toContain('headerClassName="px-0 py-0 sm:px-0"');
    expect(appSource).toContain('COMPACT_WORKSPACE_LAYOUT_MEDIA_QUERY = "(max-width: 1535px)"');
  });

  test("benchmark navigation lives in a muted secondary bar with button links", () => {
    const appSource = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain('components/shared/view-switch');
    expect(appSource).toContain("<ViewSwitch");
    expect(appSource).toContain("const benchmarkNavigation = (");
    expect(appSource).toContain("<WorkbenchBenchmarkNavigation");
    expect(appSource).toContain("bg-muted/30");
    expect(appSource).toContain('<nav aria-label="Benchmark navigation"');
    expect(appSource).toContain("<Button");
    expect(appSource).toContain("asChild");
    expect(appSource).toContain('variant={active ? "secondary" : "ghost"}');
    expect(appSource).toContain("items-center gap-1 overflow-x-auto md:justify-end");
    expect(appSource).toContain('aria-current={active ? "page" : undefined}');
    expect(appSource).toContain("const targetRoute = active ? createBenchmarkRoute() : item.route");
    expect(appSource).toContain("href={routeHref(targetRoute)}");
    expect(appSource).toContain("onNavigate(targetRoute)");
    expect(appSource).toContain("actions={objectPaneCollapseAction}");
    expect(appSource).toContain("actions={headerControls}");
    expect(appSource).toContain("{benchmarkNavigation}");
    expect(appSource).not.toContain("{objectNavigation}\n          {headerControls}");
    expect(appSource).toContain("const objectPaneCollapseAction = desktopObjectPaneOpen ? (");
    expect(appSource).toContain("<PanelRightCloseIcon />");
    expect(appSource).toContain('aria-label="Collapse details pane"');
    expect(appSource).toContain('data-testid="object-pane-collapse"');
    expect(appSource).toContain("onClick={() => navigate(createBenchmarkRoute())}");
    expect(appSource).not.toContain("const Icon = item.icon");
    expect(appSource).not.toContain('<Icon aria-hidden="true" data-icon="inline-start" />');
    expect(appSource).not.toContain('label: "Benchmark"');
    expect(appSource).not.toContain('label: "Executions"');
    expect(appSource).not.toContain('value: "executions"');
    expect(appSource).not.toContain('value: "benchmark"');
    expect(appSource).not.toContain("hideHeader={!prefersCompactWorkspaceLayout}");
    expect(appSource).not.toContain('ariaLabel="Workbench sections"');
  });

  test("workbench breadcrumbs live in the secondary nav and link back to the benchmark screen", () => {
    const appSource = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).not.toContain('breadcrumbs={route.kind !== "benchmark" ? (');
    expect(appSource).toContain("bg-muted/30");
    expect(appSource).toContain("<WorkbenchBreadcrumbs");
    expect(appSource).toContain("route={route}");
    expect(appSource).toContain("route.kind === \"candidate\"");
    expect(appSource).toContain('route.kind === "benchmark"');
    expect(appSource).toContain("Benchmark");
    expect(appSource).toContain("createBenchmarkRoute()");
    expect(appSource).not.toContain("Project</BreadcrumbLink>\n        </BreadcrumbItem>\n        <BreadcrumbSeparator />\n        <BreadcrumbItem>\n          <BreadcrumbLink");
  });

  test("benchmark pane keeps shadcn-native progressive disclosure and detail pages stay object-owned", () => {
    const appSource = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain('components/ui/accordion');
    expect(appSource).toContain('<Accordion type="multiple">');
    expect(appSource).toContain("flex min-w-0 flex-wrap items-start justify-between gap-3");
    expect(appSource).toContain("flex min-w-0 flex-wrap items-center justify-start gap-2 sm:justify-end");
    expect(appSource).toContain("grid min-w-0 flex-1 gap-1 text-left");
    expect(appSource).not.toContain("sm:flex-row sm:items-center sm:justify-between");
    expect(appSource).toContain('data-testid="benchmark-engine-cases-card"');
    expect(appSource).toContain('const excludedFields = new Set(["use", "task", "instructions", "prompt", "description"])');
    expect(appSource).toContain("formatUseBlockSummary");
    expect(appSource).not.toContain('score.use === "rubric"');
    expect(appSource).not.toContain("readRubricCriteria");
    expect(appSource).not.toContain("formatScoreSummary");
    expect(appSource).not.toContain("formatRunSummary");
    expect(appSource).not.toContain("formatAdapterSummary");
    expect(appSource).not.toContain("config.judge");
    expect(appSource).not.toContain("<select");
    expect(appSource).not.toContain("border-b border-border/60 pb-3");
    expect(appSource).not.toContain("border-transparent bg-transparent");
    expect(appSource).not.toContain('className="max-w-full min-w-0 font-mono text-xs"');
    expect(appSource).not.toContain("hover:bg-muted/60");
    expect(appSource).not.toContain('<span className="text-xs text-muted-foreground">read-only</span>');
    expect(appSource).not.toContain("Read-only");
    expect(appSource).not.toContain("<CardTitle>Task</CardTitle>");
    expect(appSource).not.toContain("<CardDescription>eval.task</CardDescription>");
    expect(appSource).not.toContain('value="eval-task"');
    expect(appSource).not.toContain('value="logs"');
    expect(appSource).toContain("EvaluationCaseDetailSurface");
    expect(appSource).toContain("InspectorDialogShell");
    expect(appSource).toContain("ExecutionFilesSurface");
    expect(appSource).toContain("CaseFeedbackCard");
    expect(appSource).toContain("formatEvaluationDisplayName");
    expect(appSource).toContain("formatCandidateDisplayName");
    expect(appSource).not.toContain('SurfaceSection title="Candidate Overview"');
    expect(appSource).not.toContain('SurfaceSection title="Run" icon={ActivityIcon}');
    expect(appSource).not.toContain('SurfaceSection title="Scorecard"');
    expect(appSource).not.toContain('SurfaceSection title="Trace"');
    expect(appSource).not.toContain('<CardTitle>Provenance</CardTitle>');
    expect(appSource).not.toContain('SurfaceSection title="Raw Case Data"');
    expect(appSource).toContain("function EvaluationCasesTable");
    expect(appSource).toContain("onSelectCase(selected ? null : row.id)");
    expect(appSource).toContain("renderSelectedCase");
    expect(appSource).toContain("<TableCell colSpan={5}");
    expect(appSource).toContain('TabsTrigger value="score"');
    expect(appSource).toContain('TabsTrigger value="attempts"');
    expect(appSource).toContain('TabsTrigger value="files"');
    expect(appSource).toContain('className="flex-none h-[clamp(28rem,calc(100dvh-28rem),42rem)] overflow-hidden pt-2"');
    expect(appSource).not.toContain('className="min-h-[28rem] overflow-hidden pt-2"');
    expect(appSource).not.toContain('style={{ flex: "none", height: "min(70dvh, 44rem)" }}');
    expect(appSource).toContain('className="flex h-full min-h-0 min-w-0 flex-col"');
    expect(appSource).not.toContain("selectedJobId");
    expect(appSource).not.toContain('dialog: { kind: "job", jobId }');
    expect(appSource).toContain("EvaluationDetailDialog");
    expect(appSource).toContain('testId="context-evaluation-dialog"');
    expect(appSource).not.toContain('testId="context-run-dialog"');
    expect(appSource).toContain("function AttemptTraceContent");
    expect(appSource).not.toContain("function TraceSessionTimeline");
    expect(appSource).toContain("<AttemptTraceContent");
    expect(appSource).toContain('className="grid min-w-0 gap-4"');
    expect(appSource).not.toContain('aria-label={`Open ${row.label}`}');
    expect(appSource).not.toContain("<TableHead>Attempt</TableHead>");
    expect(appSource).not.toContain("traceSessions.length === 1");
    expect(appSource).not.toContain("onSelectJob(selected ? null");
    expect(appSource).not.toContain("defaultValue={traceSessions[0]");
    expect(appSource).not.toContain(">Open Candidate<");
    expect(appSource).not.toContain(">Open Run<");
    expect(appSource).not.toContain("caseReviewShouldPoll");
    expect(appSource).toContain("useExecutionTrace");
    expect(appSource).toContain("const params = new URLSearchParams({ run: runId, job: jobId });");
    expect(appSource).toContain("if (!runId || !jobId)");
    expect(appSource).not.toContain("shouldPollTrace");
    expect(appSource).not.toContain("POLL_INTERVAL_MS");
    expect(appSource).not.toContain("window.setInterval");
    expect(appSource).toContain("ExecutionTraceTimeline");
    expect(appSource).toContain('layout="content"');
    expect(appSource).toContain("review.executions");
    expect(appSource).toContain("resolveScorecardCaseRows");
    expect(appSource).toContain("scorecard.evaluation.cases ?? []");
    expect(appSource).not.toContain("for (const sample of scorecard.evaluation.samples)");
    expect(appSource).not.toContain("sample.cases ?? []");
    expect(appSource).not.toContain("readCaseDurationMs");
    expect(appSource).not.toContain("firstMetricValue");
    expect(appSource).not.toContain("for (const authoredCase of specDocument?.cases ?? [])");
    expect(appSource).not.toContain("sampleLevelCase");
    expect(appSource).not.toContain("__sample_\\d");
    expect(appSource).toContain('SurfaceSection title="Cases"');
    expect(appSource).not.toContain('SurfaceSection title="Case Result"');
    expect(appSource).toContain('SurfaceSection title="Evaluations"');
    expect(appSource).not.toContain('SurfaceSection title="Tasks"');
    expect(appSource).toContain("function CaseAttemptTable");
    expect(appSource).not.toContain('SurfaceSection title="Executions"');
    expect(appSource).toContain("function EvaluationSummaryTable");
    expect(appSource).toContain("buildCandidateEvaluationRollup(");
    expect(appSource).toContain('title="Best score"');
    expect(appSource).toContain('title="Best configuration"');
    expect(appSource).not.toContain("const latestEvaluation = candidateEvaluations.at(-1)");
    expect(appSource).not.toContain("function RunSummaryTable");
    expect(appSource).toContain('<TableHead>{showCandidate ? "Candidate" : "Configuration"}</TableHead>');
    expect(appSource).not.toContain("<TableHead>Run</TableHead>");
    expect(appSource).not.toContain("<TableHead>Workflow</TableHead>");
    expect(appSource).not.toContain("<TableHead>Outcome</TableHead>");
    expect(appSource).toContain("<TableHead>Status</TableHead>");
    expect(appSource).toContain('<TableHead className="text-right">Score</TableHead>');
    expect(appSource).not.toContain("testId=\"run-job-dialog\"");
    expect(appSource).not.toContain("bodyTestId=\"run-job-dialog-body\"");
    expect(appSource).toContain('className="h-[min(94vh,calc(100dvh-1rem))]"');
    expect(appSource).toContain('bodyClassName="overflow-y-auto"');
    expect(appSource).not.toContain("Execution events recorded for this run job.");
    expect(appSource).not.toContain("traceDescription");
    expect(appSource).not.toContain("describePhaseTrace");
    expect(appSource).not.toContain('<h3 className="text-sm font-medium text-foreground">Trace</h3>');
    expect(appSource).toContain("function DetailAccordionSection");
    expect(appSource).not.toContain('variant?: "line" | "bordered";');
    expect(appSource).not.toContain('"rounded-xl border border-border/60 bg-card px-3"');
    expect(appSource).toContain('contentClassName="h-auto pb-3"');
    expect(appSource).toContain("bordered && \"rounded-lg border border-border/60 px-3 not-last:border-b\"");
    expect(appSource).toContain('className="gap-2"');
    expect(appSource).toContain("bordered");
    expect(appSource).not.toContain('variant="bordered"');
    expect(appSource).toContain('className="min-w-0"');
    expect(appSource).toContain("function FactGrid");
    expect(appSource).not.toContain("function ActionRowList");
    expect(appSource).not.toContain("actionRowClassName");
    expect(appSource).not.toContain('CardContent className="grid min-w-0 gap-0 py-0"');
    expect(appSource).not.toContain('CardContent className="grid gap-3 md:grid-cols');
    expect(appSource).not.toContain('CardContent className="grid gap-2 py-3');
    expect(appSource).not.toContain('CardContent className="grid gap-3 md:grid-cols-4');
    expect(appSource).not.toContain('className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/60 bg-card p-4"');
    expect(appSource).not.toContain('open={selectedJobId !== null}');
    expect(appSource).not.toContain("runnerExecution");
    expect(appSource).not.toContain("engineExecution");
    expect(appSource).not.toContain("ExecutionTraceJobsPanel");
    expect(appSource).not.toContain('className="min-h-[360px]"');
    expect(appSource).not.toContain('CardContent className="min-h-[360px] py-0"');
    expect(appSource).not.toContain("Live Progress");
    expect(appSource).not.toContain("resolveProgressDisplayEvents");
    expect(appSource).not.toContain('value="candidate-surface"');
    expect(appSource).not.toContain('summary={<Badge');
    expect(appSource).not.toContain('label="Discovered"');
    expect(appSource).not.toContain("function BenchmarkStringBadges");
    expect(appSource).not.toContain('description="Runs the candidate');
    expect(appSource).not.toContain('className="border-border/60 bg-muted/10"');
    expect(appSource).not.toContain('defaultValue="overview"');
    expect(appSource).toContain('className="min-w-0 rounded-xl bg-muted/35 px-4 py-3"');
    expect(appSource).toContain("[overflow-wrap:anywhere]");
    expect(appSource).not.toContain("showCharts");
  });

  test("reusable benchmark workspace stays fixture and adapter agnostic", () => {
    const appSource = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );
    const loadingStatesSource = readFileSync(
      new URL("../src/components/loading-states.tsx", import.meta.url),
      "utf8",
    );
    const candidateListSource = readFileSync(
      new URL("../src/components/candidate-list.tsx", import.meta.url),
      "utf8",
    );
    const combinedSource = [
      appSource,
      loadingStatesSource,
      candidateListSource,
    ].join("\n");

    for (const forbidden of [
      "local-benchmark-ux-fixture",
      "local-inspect",
      "candidate_local_seed",
      "eval_local_seed",
      "run_local_seed",
      "Figma",
      "Reddit",
      "Harbor",
      "formula_integrity",
      "traceability",
      "codex",
      "claude",
      "openai",
      "anthropic",
    ]) {
      expect(combinedSource).not.toContain(forbidden);
    }

    expect(appSource).not.toContain("adapter");
    expect(appSource).not.toContain("baseline");
    expect(appSource).not.toContain("metadata.baseline");
    expect(appSource).not.toContain("input.baseline");
    expect(appSource).not.toContain("engine-defined");
    expect(appSource).not.toContain("local workspace");
  });

  test("queued execution rows do not accrue runtime duration before they start", () => {
    const appSource = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain("function isActiveExecutionStatus");
    expect(appSource).toContain('return status === "queued" || status === "running";');
    expect(appSource).toContain("function isTimedExecutionStatus");
    expect(appSource).toContain('return status === "running";');
    expect(appSource).toContain("isTimedExecutionStatus(record.status) ? record.createdAt : null");
    expect(appSource).not.toContain("isActiveExecutionStatus(record.status) ? record.createdAt : null");
  });

  test("benchmark manifest and source files are separate surfaces", () => {
    const appSource = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain('<TabsTrigger value="processed">');
    expect(appSource).toContain('<InfoIcon data-icon="inline-start" />');
    expect(appSource).toContain('<TabsTrigger value="manifest">');
    expect(appSource).toContain('<FileCode2Icon data-icon="inline-start" />');
    expect(appSource).toContain('<TabsTrigger value="files">');
    expect(appSource).toContain('<FolderOpenIcon data-icon="inline-start" />');
    expect(appSource).toContain('apiPath(`/api/source/files${params.size ? `?${params.toString()}` : ""}`)');
    expect(appSource).toContain('apiPath(`/api/source/preview?${params.toString()}`)');
    expect(appSource).toContain("type BenchmarkSurfaceTab = \"processed\" | \"manifest\" | \"files\";");
    expect(appSource).toContain("const benchmarkSurfaceFillsBody = benchmarkSurfaceTab === \"files\";");
    expect(appSource).toContain("scrollBody={!benchmarkSurfaceFillsBody}");
    expect(appSource).toContain('contentClassName={benchmarkSurfaceFillsBody ? "flex h-full min-h-0 flex-col" : undefined}');
    expect(appSource).toContain('activeTab === "files"');
    expect(appSource).toContain('onValueChange={(value) => onActiveTabChange(value as BenchmarkSurfaceTab)}');
    expect(appSource).toContain('<TabsContent value="manifest" className="min-w-0">');
    expect(appSource).toContain('<TabsContent value="files" className="min-h-0 min-w-0">');
    expect(appSource).toContain('title="Benchmark Manifest"');
    expect(appSource).toContain('title="Engine Case Files"');
    expect(appSource).toContain("Public, private, and source files exposed by the engine.");
    expect(appSource).toContain("<FilesBrowser");
    expect(appSource).toContain('browseMode="folders"');
    expect(appSource).toContain("onSourcePreviewModeChange");
    expect(appSource).not.toContain("h-[640px]");
    expect(appSource).not.toContain("max-h-[calc(100dvh-12rem)]");
  });

  test("benchmark object indexes are route-backed sibling pages", () => {
    const candidateListSource = readFileSync(
      new URL("../src/components/candidate-list.tsx", import.meta.url),
      "utf8",
    );
    const appSource = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );
    const lineageSource = readFileSync(
      new URL("../src/lib/lineage.ts", import.meta.url),
      "utf8",
    );
    const graphSource = readFileSync(
      new URL("../src/components/lineage-graph.tsx", import.meta.url),
      "utf8",
    );

    expect(candidateListSource).not.toContain("shadow-sm");
    expect(candidateListSource).not.toContain("font-mono text-sm font-semibold");
    expect(appSource).toContain("readEvaluationScore(evaluation)");
    expect(appSource).not.toContain(["usage", "har" + "ness"].join("."));
    expect(appSource).toContain('route.kind === "candidates"');
    expect(appSource).toContain('route.kind === "evaluations"');
    expect(appSource).toContain('if (evaluationIdsToLoad.length === 0)');
    expect(appSource).toContain("function readInitialWorkbenchRoute");
    expect(appSource).toContain("window.location.pathname");
    expect(appSource).toContain("window.location.search");
    expect(appSource).toContain("function WorkbenchBenchmarkNavigation");
    expect(appSource).toContain('<nav aria-label="Benchmark navigation"');
    expect(appSource).not.toContain('value: "benchmark"');
    expect(appSource).toContain('value: "candidates"');
    expect(appSource).toContain("route: createCandidatesRoute()");
    expect(appSource).not.toContain('value: "runs"');
    expect(appSource).toContain('value: "evaluations"');
    expect(appSource).toContain("route: createEvaluationsRoute()");
    expect(appSource).toContain('href={routeHref(targetRoute)}');
    expect(appSource).not.toContain("DesktopWorkspaceSplitToggle");
    expect(appSource).not.toContain("runtime-pane-toggle");
    expect(appSource).toContain("createEvaluationsRoute()");
    expect(appSource).not.toContain('aria-label="Benchmark version views"');
    expect(appSource).toContain("normalizeBenchmarkFingerprint(evaluation.benchmarkFingerprint) === scopedBenchmarkFingerprint");
    expect(appSource).toContain("normalizeBenchmarkFingerprint(run.benchmarkFingerprint) === scopedBenchmarkFingerprint");
    expect(appSource).toContain("function buildBenchmarkFingerprintOptions");
    expect(appSource).toContain("function BenchmarkFingerprintSelector");
    expect(appSource).toContain("selectedBenchmarkFingerprint={scopedBenchmarkFingerprint}");
    expect(appSource).toContain("onBenchmarkFingerprintChange={setSelectedBenchmarkFingerprint}");
    expect(appSource).not.toContain("onBenchmarkFingerprintChange={onBenchmarkFingerprintChange}");
    expect(appSource).toContain("function orderRunSummaries");
    expect(appSource).not.toContain("function RunsSurface");
    expect(appSource).toContain("function CandidatesIndexSurface");
    expect(appSource).toContain("function ScrollableObjectSurface");
    expect(appSource).toContain("candidateCount={currentBenchmarkSummaries.length}");
    expect(appSource).toContain("currentBenchmarkRuns={currentBenchmarkRuns}");
    expect(appSource).not.toContain("currentBenchmarkStandaloneRuns");
    expect(appSource).not.toContain("currentBenchmarkRuns.filter(isStandaloneRun)");
    expect(appSource).not.toContain("function isStandaloneRunForCandidate");
    expect(appSource).toContain("evaluationCount={currentBenchmarkEvaluationRows.length}");
    expect(appSource).not.toContain('<Badge variant="outline">{formatRunWorkflow(run.workflow)}</Badge>');
    expect(appSource).not.toContain("<RunStatusBadge run={run} />");
    expect(appSource).not.toContain("{formatRunDuration(run, nowMs)}");
    expect(appSource).toContain('contentClassName={objectSurfaceFillsBody ? "flex h-full min-h-0 flex-col" : undefined}');
    expect(appSource).toContain('className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-1"');
    expect(appSource).toContain('"grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3"');
    expect(appSource).toContain('{ value: "manifest", label: "Manifest", icon: FileCode2Icon }');
    expect(appSource).toContain('title="Candidate Manifest"');
    expect(appSource).toContain('title="Candidate Files"');
    expect(appSource).toContain("Files that make up this candidate version.");
    expect(lineageSource).not.toContain("shadow-sm");
    expect(lineageSource).toContain('"elk.layered.spacing.nodeNodeBetweenLayers"');
    expect(lineageSource).toContain('"elk.spacing.nodeNode"');
    expect(graphSource).not.toContain("shadow-sm");
    expect(graphSource).toContain('data-testid="lineage-graph"');
    expect(graphSource).toContain('className="flex min-h-[28rem] min-w-0 flex-1 overflow-hidden rounded-lg border border-border/60 bg-card"');
    expect(graphSource).not.toContain("h-[clamp(");
    expect(graphSource).toContain("truncate");
  });

  test("evaluation chart cards share non-truncating category axis labels", () => {
    const appSource = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );
    const chartSource = readFileSync(
      new URL("../src/components/evaluation-charts.tsx", import.meta.url),
      "utf8",
    );
    const detailSource = readFileSync(
      new URL("../src/components/evaluations-detail.tsx", import.meta.url),
      "utf8",
    );

    expect(chartSource).toContain("buildEvaluationCategoryAxisLayout");
    expect(chartSource).toContain("wrapEvaluationCategoryAxisLabel");
    expect(chartSource).toContain("Cell");
    expect(chartSource).toContain("candidateColorById");
    expect(chartSource).toContain("function EvaluationGroupedAxisTick");
    expect(chartSource).toContain("<EvaluationGroupedAxisTick");
    expect(chartSource).toContain("key={entry.rowKey}");
    expect(chartSource).toContain('fill={entry.kind === "evaluation" ? entry.color : "transparent"}');
    expect(chartSource).toContain("buildEvaluationMetricChartRows(data, candidates)");
    expect(chartSource).toContain('dataKey="rowKey"');
    expect(chartSource).toContain('rowKey: `candidate:${candidate.id}`');
    expect(chartSource).toContain('rowKey: `evaluation:${row.evaluationId}`');
    expect(chartSource).toContain("buildEvaluationMetricData(evaluations, descriptor, candidateColorById)");
    expect(chartSource).toContain("buildEvaluationTradeoffData(evaluations, pair, candidateColorById)");
    expect(chartSource).toContain("function CandidateColorKey");
    expect(chartSource).toContain('data-testid="evaluations-tradeoff-legend"');
    expect(chartSource).toContain("buildCandidateLegendItems(candidates, data)");
    expect(chartSource).toContain("isAnimationActive={false}");
    expect(chartSource).toContain("animationDuration={0}");
    expect(chartSource).toContain("width={categoryAxisLayout.yAxisWidth}");
    expect(chartSource).toContain("interval={0}");
    expect(chartSource).not.toContain("formatEvaluationAxisTickLabel");
    expect(chartSource).not.toContain("EVALUATION_AXIS_TICK_MAX_CHARS");
    expect(chartSource).toContain('CardContent className="w-full min-w-0 max-w-full"');
    expect(chartSource).toContain('barCategoryGap="20%"');
    expect(chartSource).not.toContain("VERTICAL_BAR_CHART_THRESHOLD");
    expect(chartSource).not.toContain("function EvaluationCategoryAxisTick");
    expect(chartSource).not.toContain("function EvaluationXAxis");
    expect(chartSource).toContain('layout="vertical"');
    expect(chartSource).toContain("chartRows.length * categoryAxisLayout.rowHeight + 72");
    expect(chartSource).toContain("function evaluationMetricAxisDomain");
    expect(chartSource).toContain("entry.value >= 0 && entry.value <= 1");
    expect(chartSource).toContain("!aspect-auto");
    expect(chartSource).toContain("grid-cols-1 gap-3");
    expect(chartSource).not.toContain("xl:grid-cols-[repeat(auto-fit");
    expect(chartSource).not.toContain("maxBarSize");
    expect(chartSource).not.toContain("BAR_CHART_MIN_WIDTH");
    expect(chartSource).not.toContain("BAR_CHART_CATEGORY_WIDTH");
    expect(chartSource).not.toContain("ChartLegend");
    expect(chartSource).not.toContain("useMediaQuery");
    expect(chartSource).not.toContain("<Label");
    expect(detailSource).toContain('Card size="sm" className="min-w-0"');
    expect(detailSource).toContain("buildEvaluationCandidatePresentations");
    expect(detailSource).toContain("buildEvaluationCandidateColorMap");
    expect(detailSource).toContain("filteredCandidateOptions");
    expect(detailSource).toContain("candidates={filteredCandidateOptions}");
    expect(detailSource).toContain("candidateColorById={candidateColorById}");
    expect(detailSource).toContain("grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3");
    expect(detailSource).not.toContain("grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3 overflow-hidden");
    expect(detailSource).toContain('CardContent className="overflow-x-auto py-0"');
    expect(detailSource).not.toContain("showCharts");
    expect(appSource).not.toContain("showCharts");
    expect(chartSource).not.toContain('className="h-72 w-full min-w-0 overflow-hidden"');
    expect(chartSource).not.toContain('className="h-80 w-full min-w-0 overflow-hidden"');
    expect(chartSource).not.toContain("overflow-x-auto overflow-y-visible");
    expect(chartSource).not.toContain("lg:grid-cols-3");
    expect(chartSource).not.toContain("shouldShowEvaluationAxisLabels");
    expect(chartSource).not.toContain("BAR_CHART_LABEL_VIEWPORT_QUERY");
    expect(chartSource).not.toContain("VariantAxisTick");
    expect(chartSource).not.toContain("wrapVariantAxisLabel");
  });

  test("evaluation scorecards group run rows under candidate headers", () => {
    const tableSource = readFileSync(
      new URL("../src/components/evaluations-data-table.tsx", import.meta.url),
      "utf8",
    );
    const filterSource = readFileSync(
      new URL("../src/components/candidate-comparison-filter.tsx", import.meta.url),
      "utf8",
    );

    expect(tableSource).toContain("buildEvaluationGroups");
    expect(tableSource).toContain('data-testid="evaluations-candidate-group"');
    expect(tableSource).toContain('label="Configuration"');
    expect(tableSource).toContain('className="min-w-[18rem] pl-8"');
    expect(tableSource).toContain('className="min-w-[18rem] align-top whitespace-normal pl-8"');
    expect(tableSource).toContain("row.configurationLabel");
    expect(tableSource).not.toContain("backgroundColor: group.candidate.color");
    expect(tableSource).not.toContain('label="Candidate / Run"');
    expect(tableSource).not.toContain('label="Run / Configuration"');
    expect(filterSource).toContain("color?: string");
    expect(filterSource).toContain("backgroundColor: option.color");
  });

  test("loading states use skeletons instead of empty-state placeholders", () => {
    const appSource = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );
    const loadingStatesSource = readFileSync(
      new URL("../src/components/loading-states.tsx", import.meta.url),
      "utf8",
    );
    const evaluationsSource = readFileSync(
      new URL("../src/components/evaluations-detail.tsx", import.meta.url),
      "utf8",
    );
    const lineageSource = readFileSync(
      new URL("../src/components/lineage-graph.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).not.toContain('components/ui/spinner');
    expect(appSource).toContain('./components/loading-states');
    expect(appSource).toContain("const [snapshotLoading, setSnapshotLoading] = useState(true)");
    expect(appSource).toContain("const [specLoading, setSpecLoading] = useState(true)");
    expect(appSource).toContain("setSnapshotLoading(snapshot === null)");
    expect(appSource).toContain("setSnapshotRefreshing(snapshot !== null)");
    expect(appSource).toContain("setSpecLoading(true)");
    expect(loadingStatesSource).toContain('components/ui/skeleton');
    expect(loadingStatesSource).toContain('data-testid="benchmark-loading-state"');
    expect(loadingStatesSource).toContain('data-testid="source-yaml-loading"');
    expect(loadingStatesSource).toContain('data-testid="candidate-manifest-loading"');
    expect(loadingStatesSource).not.toContain('data-testid="run-detail-loading"');
    expect(loadingStatesSource).not.toContain('data-testid="run-job-loading"');
    expect(loadingStatesSource).toContain('data-testid="execution-trace-loading"');
    expect(loadingStatesSource).toContain('data-testid="evaluation-detail-loading"');
    expect(loadingStatesSource).toContain('data-testid="candidate-archive-loading"');
    expect(loadingStatesSource).toContain('data-testid="candidate-overview-loading"');
    expect(loadingStatesSource).toContain('data-testid="evaluation-case-loading"');
    expect(loadingStatesSource).toContain('data-testid="evaluations-loading-state"');
    expect(loadingStatesSource).toContain('data-testid="lineage-loading-state"');
    expect(loadingStatesSource).not.toContain("evaluations-last-run-card");
    expect(loadingStatesSource).not.toContain('h-full min-h-0 flex-1 rounded-lg border border-border/60 bg-background');
    expect(appSource).not.toContain("Loading manifest");
    expect(appSource).not.toContain("Loading candidate");
    expect(appSource).not.toContain("Loading run");
    expect(appSource).not.toContain("Loading execution trace");
    expect(appSource).not.toContain("Loading evaluation");
    expect(appSource).not.toContain("Loading cases");
    expect(appSource).not.toContain("Loading candidate evaluation");
    expect(appSource).not.toContain("Loading case review");
    expect(appSource).toContain("EvaluationsDetailSkeleton");
    expect(evaluationsSource).not.toContain("evaluations-last-run-card");
    expect(evaluationsSource).not.toContain("evaluation-version-select");
    expect(evaluationsSource).not.toContain("evaluations-case-variance-card");
    expect(evaluationsSource).not.toContain("Case Variance");
    expect(evaluationsSource).not.toContain("All Metrics");
    expect(evaluationsSource).not.toContain("Loading evaluation set");
    expect(lineageSource).toContain("LineageSurfaceSkeleton");
    expect(lineageSource).not.toContain("Loading lineage");
  });
});
