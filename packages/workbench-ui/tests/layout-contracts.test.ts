import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("workbench browser layout contracts", () => {
  test("benchmark pane brand links back to the home route unless hosted shell overrides it", () => {
    const appSource = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain("Workbench Home");
    expect(appSource).toContain("<WorkbenchBrand />");
    expect(appSource).not.toContain('product="Workbench"');
    expect(appSource).toContain('data-testid="app-brand-link"');
    expect(appSource).toContain("brandHref?: string");
    expect(appSource).toContain("const workbenchBrandHref = brandHref ?? benchmarkHref");
    expect(appSource).toContain("navigate(createBenchmarkRoute())");
  });

  test("hosted controls mount into the shared workspace top bar", () => {
    const appSource = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain("headerControls?: ReactNode");
    expect(appSource).toContain("WorkspaceTopBar");
    expect(appSource).toContain("const workspaceHeader = (");
    expect(appSource).toContain("{headerControls}");
    expect(appSource).toContain("header={workspaceHeader}");
    expect(appSource).toContain('COMPACT_RUNTIME_LAYOUT_MEDIA_QUERY = "(max-width: 1535px)"');
  });

  test("workspace navigation uses the shared view switch", () => {
    const appSource = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain('components/shared/view-switch');
    expect(appSource).toContain("<ViewSwitch");
    expect(appSource).not.toContain('label: "Executions"');
    expect(appSource).not.toContain('value: "executions"');
  });

  test("workbench breadcrumbs stay shallow and link back to the benchmark screen", () => {
    const appSource = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain('breadcrumbs={route.kind !== "benchmark" ? (');
    expect(appSource).toContain("<RuntimeBreadcrumbs");
    expect(appSource).toContain("route={route}");
    expect(appSource).toContain("route.kind === \"candidate\"");
    expect(appSource).toContain("Benchmark");
    expect(appSource).toContain("createBenchmarkRoute()");
    expect(appSource).not.toContain("Project</BreadcrumbLink>\n        </BreadcrumbItem>\n        <BreadcrumbSeparator />\n        <BreadcrumbItem>\n          <BreadcrumbLink");
  });

  test("benchmark pane keeps shadcn-native progressive disclosure and task review skips a summary-only landing tab", () => {
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
    expect(appSource).toContain('data-testid="benchmark-task-card"');
    expect(appSource).toContain('const excludedFields = new Set(["use", "task", "instructions", "prompt", "description"])');
    expect(appSource).toContain("formatUseBlockSummary");
    expect(appSource).not.toContain('grade.use === "rubric"');
    expect(appSource).not.toContain("readRubricCriteria");
    expect(appSource).not.toContain("formatGradeSummary");
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
    expect(appSource).toContain("TaskExecutionFilesTab");
    expect(appSource).toContain("TaskExecutionTraceTab");
    expect(appSource).not.toContain("caseReviewShouldPoll");
    expect(appSource).toContain("useRunDetail");
    expect(appSource).toContain("useRunTrace");
    expect(appSource).not.toContain("shouldPollTrace");
    expect(appSource).not.toContain("POLL_INTERVAL_MS");
    expect(appSource).not.toContain("window.setInterval");
    expect(appSource).toContain('value="scoring"');
    expect(appSource).toContain('value="trace"');
    expect(appSource).toContain("ToggleGroup");
    expect(appSource).toContain("ExecutionTraceTimeline");
    expect(appSource).toContain('layout="content"');
    expect(appSource).toContain("review.phases");
    expect(appSource).toContain("resolveEvaluationTaskRows");
    expect(appSource).toContain("groupExecutionJobsByCase");
    expect(appSource).toContain('apiPath(`/api/run?${params.toString()}`)');
    expect(appSource).toContain("for (const caseStats of evalRecord?.cases ?? [])");
    expect(appSource).not.toContain("for (const authoredCase of specDocument?.cases ?? [])");
    expect(appSource).toContain('SurfaceSection title="Evaluation Tasks"');
    expect(appSource).not.toContain("runnerExecution");
    expect(appSource).not.toContain("graderExecution");
    expect(appSource).not.toContain("ExecutionTraceJobsPanel");
    expect(appSource).not.toContain('SurfaceSection title="Task Scorecard"');
    expect(appSource).not.toContain('className="min-h-[360px]"');
    expect(appSource).not.toContain('CardContent className="min-h-[360px] py-0"');
    expect(appSource).not.toContain("Live Progress");
    expect(appSource).not.toContain("resolveProgressDisplayEvents");
    expect(appSource).not.toContain('value="candidate-surface"');
    expect(appSource).not.toContain('summary={<Badge');
    expect(appSource).not.toContain('label="Discovered"');
    expect(appSource).not.toContain("function BenchmarkStringBadges");
    expect(appSource).not.toContain('description="Runs the candidate');
    expect(appSource).not.toContain('description="Agent that proposes');
    expect(appSource).not.toContain('className="border-border/60 bg-muted/10"');
    expect(appSource).not.toContain('defaultValue="overview"');
    expect(appSource).not.toContain("RunFact title=\"Environment\"");
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

  test("benchmark manifest and mounted execution files are separate surfaces", () => {
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
    expect(appSource).toContain('title="Mounted Task Files"');
    expect(appSource).toContain("Task input and expected files mounted during runner and grader execution.");
    expect(appSource).toContain("<FilesBrowser");
    expect(appSource).toContain('browseMode="folders"');
    expect(appSource).toContain("onSourcePreviewModeChange");
    expect(appSource).not.toContain("h-[640px]");
    expect(appSource).not.toContain("max-h-[calc(100dvh-12rem)]");
  });

  test("candidate benchmark tabs stay scoped and on the low-elevation shared tone", () => {
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
    expect(appSource).not.toContain("metrics?.score");
    expect(appSource).not.toContain("metrics.score");
    expect(appSource).not.toContain("usage.harness");
    expect(appSource).toContain('const fillsBody = view === "lineage" || view === "results" || view === "runs"');
    expect(appSource).toContain('route.kind === "candidates" && (runtimeRootView === "lineage" || runtimeRootView === "results" || runtimeRootView === "runs")');
    expect(appSource).toContain('if (route.kind !== "candidates" || runtimeRootView !== "results" || currentBenchmarkResults.length === 0)');
    expect(appSource).toContain("setRuntimeRootView(nextView)");
    expect(appSource).toContain("navigate(createCandidatesRoute())");
    expect(appSource).toContain('<TabsList variant="line" aria-label="Benchmark version views"');
    expect(appSource).toContain('<TabsTrigger value="lineage">');
    expect(appSource).toContain('<TabsTrigger value="archive">');
    expect(appSource).toContain('<TabsTrigger value="results">');
    expect(appSource).toContain('<TabsTrigger value="runs">');
    expect(appSource).toContain("normalizeBenchmarkFingerprint(result.benchmarkFingerprint) === scopedBenchmarkFingerprint");
    expect(appSource).toContain("normalizeBenchmarkFingerprint(run.benchmarkFingerprint) === scopedBenchmarkFingerprint");
    expect(appSource).toContain("function buildBenchmarkFingerprintOptions");
    expect(appSource).toContain("function BenchmarkFingerprintSelector");
    expect(appSource).toContain("selectedBenchmarkFingerprint={scopedBenchmarkFingerprint}");
    expect(appSource).toContain("onBenchmarkFingerprintChange={setSelectedBenchmarkFingerprint}");
    expect(appSource).not.toContain("onBenchmarkFingerprintChange={onBenchmarkFingerprintChange}");
    expect(appSource).toContain("function orderRunSummaries");
    expect(appSource).toContain("function RunsSurface");
    expect(appSource).toContain("function ScrollableRuntimeSurface");
    expect(appSource).toContain('candidateCount={route.kind === "candidates" ? currentBenchmarkSummaries.length : snapshot?.summaries.length ?? 0}');
    expect(appSource).toContain('<Badge variant="outline">{formatRunWorkflow(run.workflow)}</Badge>');
    expect(appSource).toContain("<RunStatusBadge run={run} />");
    expect(appSource).toContain("{formatRunDuration(run, nowMs)}");
    expect(appSource).toContain('contentClassName={runtimeSurfaceFillsBody ? "flex h-full min-h-0 flex-col" : undefined}');
    expect(appSource).toContain('className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-1"');
    expect(appSource).toContain('"grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3"');
    expect(appSource).toContain('{ value: "manifest", label: "Manifest", icon: FileCode2Icon }');
    expect(appSource).toContain('title="Candidate Manifest"');
    expect(appSource).toContain('title="Mounted Candidate Files"');
    expect(appSource).toContain("Files mounted under /workspace/input/candidate for run and improve executions.");
    expect(lineageSource).not.toContain("shadow-sm");
    expect(lineageSource).toContain('"elk.layered.spacing.nodeNodeBetweenLayers"');
    expect(lineageSource).toContain('"elk.spacing.nodeNode"');
    expect(graphSource).not.toContain("shadow-sm");
    expect(graphSource).toContain('data-testid="lineage-graph"');
    expect(graphSource).toContain('className="flex min-h-[28rem] min-w-0 flex-1 overflow-hidden rounded-lg border border-border/60 bg-card"');
    expect(graphSource).not.toContain("h-[clamp(");
    expect(graphSource).toContain("truncate");
  });

  test("results chart cards use native chart labeling without custom tick chrome", () => {
    const chartSource = readFileSync(
      new URL("../src/components/result-charts.tsx", import.meta.url),
      "utf8",
    );
    const detailSource = readFileSync(
      new URL("../src/components/results-detail.tsx", import.meta.url),
      "utf8",
    );

    expect(chartSource).toContain('interval="preserveStartEnd"');
    expect(chartSource).toContain("minTickGap={16}");
    expect(chartSource).toContain("tickFormatter={formatResultAxisTickLabel}");
    expect(chartSource).toContain("function formatResultAxisTickLabel");
    expect(chartSource).toContain("padding={{ left: 24, right: 24 }}");
    expect(chartSource).toContain('CardContent className="w-full min-w-0 max-w-full"');
    expect(chartSource).toContain('barCategoryGap="20%"');
    expect(chartSource).toContain("VERTICAL_BAR_CHART_THRESHOLD");
    expect(chartSource).toContain('layout="vertical"');
    expect(chartSource).toContain("data.length * VERTICAL_BAR_ROW_HEIGHT + 72");
    expect(chartSource).toContain("function resultMetricAxisDomain");
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
    expect(detailSource).toContain("grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3");
    expect(detailSource).not.toContain("grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3 overflow-hidden");
    expect(detailSource).toContain('CardContent className="overflow-x-auto py-0"');
    expect(chartSource).not.toContain('className="h-72 w-full min-w-0 overflow-hidden"');
    expect(chartSource).not.toContain('className="h-80 w-full min-w-0 overflow-hidden"');
    expect(chartSource).not.toContain("overflow-x-auto overflow-y-visible");
    expect(chartSource).not.toContain("lg:grid-cols-3");
    expect(chartSource).not.toContain("function ResultAxisTick");
    expect(chartSource).not.toContain("<ResultAxisTick");
    expect(chartSource).not.toContain("shouldShowResultAxisLabels");
    expect(chartSource).not.toContain("BAR_CHART_LABEL_VIEWPORT_QUERY");
    expect(chartSource).not.toContain("wrapResultAxisLabel");
    expect(chartSource).not.toContain("VariantAxisTick");
    expect(chartSource).not.toContain("wrapVariantAxisLabel");
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
    const resultsSource = readFileSync(
      new URL("../src/components/results-detail.tsx", import.meta.url),
      "utf8",
    );
    const lineageSource = readFileSync(
      new URL("../src/components/lineage-graph.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain('components/ui/spinner');
    expect(appSource).toContain('./components/loading-states');
    expect(appSource).toContain("const snapshotLoading = snapshot === null && snapshotError === null");
    expect(appSource).toContain("const specLoading = specDocument === null && specError === null");
    expect(loadingStatesSource).toContain('components/ui/skeleton');
    expect(loadingStatesSource).toContain('data-testid="benchmark-loading-state"');
    expect(loadingStatesSource).toContain('data-testid="candidate-archive-loading"');
    expect(loadingStatesSource).toContain('data-testid="candidate-evaluation-loading"');
    expect(loadingStatesSource).toContain('data-testid="case-review-loading"');
    expect(loadingStatesSource).toContain('data-testid="results-loading-state"');
    expect(loadingStatesSource).toContain('data-testid="lineage-loading-state"');
    expect(loadingStatesSource).not.toContain("results-last-run-card");
    expect(appSource).not.toContain("Loading candidate evaluation");
    expect(appSource).not.toContain("Loading task review");
    expect(resultsSource).toContain("ResultsDetailSkeleton");
    expect(resultsSource).not.toContain("results-last-run-card");
    expect(resultsSource).not.toContain("result-version-select");
    expect(resultsSource).not.toContain("results-case-variance-card");
    expect(resultsSource).not.toContain("Case Variance");
    expect(resultsSource).not.toContain("All Metrics");
    expect(resultsSource).not.toContain("Loading result set");
    expect(lineageSource).toContain("LineageSurfaceSkeleton");
    expect(lineageSource).not.toContain("Loading lineage");
  });
});
