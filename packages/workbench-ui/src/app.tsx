"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import {
  ActivityIcon,
  ArchiveIcon,
  ChartColumnIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CopyIcon,
  FolderOpenIcon,
  GitBranchIcon,
  HashIcon,
  HistoryIcon,
  ListIcon,
  PanelRightCloseIcon,
  RefreshCwIcon,
  SparklesIcon,
  WorkflowIcon,
} from "lucide-react";

import {
  workbenchInspectionFileContent,
  workbenchInspectionFileContentUnavailableReason,
} from "@workbench-ai/workbench-contract";
import type {
  SurfaceSnapshotFile,
  WorkbenchArtifact,
  WorkbenchExecutionTraceDetail,
  WorkbenchInspectionFileContent,
  WorkbenchInspectionSnapshot,
  WorkbenchJob,
  WorkbenchRun,
  WorkbenchSkillSource,
  WorkbenchTrace,
  WorkbenchVersion,
} from "@workbench-ai/workbench-contract";
import { DesktopWorkspaceSplit } from "@workbench-ai/cli-web-ui/components/shared/desktop-workspace-split";
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
import { ExecutionTraceTimeline } from "@workbench-ai/cli-web-ui/components/shared/execution-trace-timeline";
import { FilesBrowser } from "@workbench-ai/cli-web-ui/components/shared/files-browser";
import { InspectorDialogShell } from "@workbench-ai/cli-web-ui/components/shared/inspector-dialog-shell";
import { ProblemState } from "@workbench-ai/cli-web-ui/components/shared/problem-state";
import { ViewSwitch } from "@workbench-ai/cli-web-ui/components/shared/view-switch";
import { WorkbenchBrand } from "@workbench-ai/cli-web-ui/components/shared/workbench-brand";
import { WorkspacePane } from "@workbench-ai/cli-web-ui/components/shared/workspace-pane";
import { WorkspaceRoot } from "@workbench-ai/cli-web-ui/components/shared/workspace-root";
import { WorkspaceTopBar } from "@workbench-ai/cli-web-ui/components/shared/workspace-top-bar";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workbench-ai/cli-web-ui/components/ui/accordion";
import { Badge } from "@workbench-ai/cli-web-ui/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workbench-ai/cli-web-ui/components/ui/breadcrumb";
import { Button } from "@workbench-ai/cli-web-ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workbench-ai/cli-web-ui/components/ui/table";
import { badgeToneProps } from "@workbench-ai/cli-web-ui/lib/badge";
import {
  buildExecutionTraceTimeline,
  type ExecutionTrace,
} from "@workbench-ai/cli-web-ui/lib/execution-trace-timeline";
import { supportedPreviewModes, type PreviewMode } from "@workbench-ai/cli-web-ui/lib/file-preview";
import { useMediaQuery } from "@workbench-ai/cli-web-ui/lib/use-media-query";
import { cn } from "@workbench-ai/cli-web-ui/lib/utils";

import { StatusBadge } from "./components/status-badge";
import { SurfaceSection } from "./components/surface-section";
import { LineageGraph } from "./components/lineage-graph";
import { ComparisonDetail } from "./components/comparison-detail";
import { parseMarkdownDocument } from "@workbench-ai/cli-web-ui/lib/markdown-document";

import {
  directoryPathForFile,
  fileName,
  formatCount,
  formatDurationMs,
  formatRunCost,
  formatScore,
  formatTimestamp,
} from "./lib/format";
import {
  preferredFilePath,
  surfaceFilesToChanges,
  surfaceFileToPreview,
} from "./lib/files";
import {
  buildWorkbenchLocationHref,
  parseWorkbenchLocation,
  routeInspector,
  routeCaseView,
  routeOverlay,
  routeSurface,
  withFileRouteState,
  withCaseView,
  withInspector,
  withOverlay,
  withoutInspector,
  withSurface,
  type VersionsView,
  type WorkbenchCaseView,
  type WorkbenchOverlayRoute,
  type WorkbenchInspectorRoute,
  type WorkbenchFileOwnerKind,
  type WorkbenchFileRouteState,
  type WorkbenchRoute,
  type WorkbenchSurfaceRoute,
} from "./lib/routes";
import {
  buildComparisonEvidenceRows,
  buildComparisonGroups,
  comparisonForScorecard,
  defaultEvaluationIdForScorecard,
  evaluationOptionsForScorecard,
  type ComparisonLabelContext,
  formatEvaluationDisplayDetail,
  formatEvaluationDisplayName,
  formatSkillDisplayName,
  formatVersionDisplayName,
} from "./lib/comparison-metrics";

export interface WorkbenchWorkspaceProps {
  apiBasePath?: string;
  routeBasePath?: string;
  brandHref?: string;
  headerControls?: ReactNode;
  initialData?: WorkbenchInspectionSnapshot | null;
  initialRoute?: WorkbenchRoute;
}

const STACKED_FILES_QUERY = "(max-width: 900px)";
const COMPACT_WORKSPACE_QUERY = "(max-width: 1023px)";
// When a detail pane is open it carries the reading-heavy content (outputs,
// tables, timelines), so it gets the dominant share of the split.
const DESKTOP_PRIMARY_DEFAULT_PERCENT = 40;
const DESKTOP_PRIMARY_MIN_PERCENT = 28;
const DESKTOP_PRIMARY_MAX_PERCENT = 60;

type PrimarySurfaceView = "scorecard" | "versions" | "files";

const PRIMARY_SURFACE_ITEMS: Array<{
  value: PrimarySurfaceView;
  label: string;
  icon: typeof WorkflowIcon;
}> = [
  { value: "scorecard", label: "Scorecard", icon: ChartColumnIcon },
  { value: "versions", label: "Versions", icon: HistoryIcon },
  { value: "files", label: "Files", icon: FolderOpenIcon },
];

const ACTIVE_SNAPSHOT_REFRESH_MS = 2_000;
const ACTIVE_JOB_EVIDENCE_REFRESH_MS = 1_500;

export function WorkbenchWorkspace({
  apiBasePath = "/api",
  routeBasePath = "/",
  brandHref = "/",
  headerControls,
  initialData = null,
  initialRoute,
}: WorkbenchWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<WorkbenchInspectionSnapshot | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [route, setRoute] = useState<WorkbenchRoute>(() =>
    initialRoute ?? parseWorkbenchLocation(undefined, routeBasePath));
  const [primaryPercent, setPrimaryPercent] = useState(DESKTOP_PRIMARY_DEFAULT_PERCENT);
  const compact = useMediaQuery(COMPACT_WORKSPACE_QUERY);
  const activePrimaryView = primarySurfaceView(route);
  const primarySurfaceFillsBody = surfaceFillsBody(route);

  useEffect(() => {
    if (initialData && refreshKey === 0) {
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    const hasExistingSnapshot = snapshot !== null;
    setLoading(!hasExistingSnapshot);
    setRefreshing(hasExistingSnapshot);
    setError(null);

    async function loadSnapshot() {
      try {
        const response = await fetch(`${apiBasePath}/snapshot`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const next = await response.json() as WorkbenchInspectionSnapshot;
        if (!cancelled) {
          setSnapshot(next);
          setError(null);
        }
      } catch (nextError) {
        if (!cancelled && !controller.signal.aborted) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void loadSnapshot();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBasePath, initialData, refreshKey]);

  useEffect(() => {
    if (!snapshotHasActiveWork(snapshot) || loading || refreshing) {
      return;
    }
    const timer = window.setTimeout(() => {
      setRefreshKey((current) => current + 1);
    }, ACTIVE_SNAPSHOT_REFRESH_MS);
    return () => window.clearTimeout(timer);
  }, [loading, refreshing, snapshot]);

  useEffect(() => {
    const updateRoute = () => setRoute(parseWorkbenchLocation(undefined, routeBasePath));
    updateRoute();
    window.addEventListener("popstate", updateRoute);
    return () => window.removeEventListener("popstate", updateRoute);
  }, [routeBasePath]);

  const hrefFor = useCallback(
    (nextRoute: WorkbenchRoute) => buildWorkbenchLocationHref(nextRoute, routeBasePath),
    [routeBasePath],
  );
  useEffect(() => {
    const canonicalHref = hrefFor(route);
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== canonicalHref) {
      window.history.replaceState({}, "", canonicalHref);
    }
  }, [hrefFor, route]);
  const navigate = useCallback((nextRoute: WorkbenchRoute, options: { replace?: boolean } = {}) => {
    const href = hrefFor(nextRoute);
    const current = `${window.location.pathname}${window.location.search}`;
    if (href !== current) {
      window.history[options.replace ? "replaceState" : "pushState"]({}, "", href);
    }
    setRoute(nextRoute);
  }, [hrefFor]);
  const onRouteClick = useCallback((nextRoute: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(nextRoute);
  }, [navigate]);
  const refreshSnapshot = useCallback(() => setRefreshKey((current) => current + 1), []);
  const hasBreadcrumbs = breadcrumbItems(route, snapshot).length > 0;

  const header = (
    <div className="flex min-w-0 flex-col">
      <div className="px-4 py-3 sm:px-5">
        <WorkspaceTopBar
          brand={(
            <a
              className="min-w-0 rounded-sm text-foreground no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={brandHref}
            >
              <WorkbenchBrand />
            </a>
          )}
          actions={headerControls}
        />
      </div>
      <div className="border-t border-border/60 bg-muted/30 px-4 py-2 sm:px-5">
        <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className={cn("min-w-0", !hasBreadcrumbs && "hidden md:block")} aria-hidden={hasBreadcrumbs ? undefined : true}>
            {hasBreadcrumbs ? (
              <WorkbenchBreadcrumbs route={route} snapshot={snapshot} hrefFor={hrefFor} onRouteClick={onRouteClick} />
            ) : null}
          </div>
          <div className={cn(
            "flex min-w-0 flex-wrap items-center gap-2",
            hasBreadcrumbs ? "justify-start md:justify-end" : "justify-end",
          )}>
            {snapshot ? (
              <WorkbenchActivitySummary
                snapshot={snapshot}
                loading={loading}
                refreshing={refreshing}
                error={error}
                onRefresh={refreshSnapshot}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  if (error && !snapshot) {
    return (
      <WorkspaceRoot header={header} headerClassName="px-0 py-0 sm:px-0" mainId="main-content" skipLinkLabel="Skip to Workbench workspace">
        <ProblemState
          icon={CircleAlertIcon}
          title="Workbench snapshot is unavailable"
          message={error}
          scope="workspace"
        />
      </WorkspaceRoot>
    );
  }

  if (!snapshot) {
    return (
      <WorkspaceRoot header={header} headerClassName="px-0 py-0 sm:px-0" mainId="main-content" skipLinkLabel="Skip to Workbench workspace">
        <ProblemState
          icon={WorkbenchLoadingIcon}
          title="Loading Workbench"
          message="Reading the skill inspection snapshot."
          scope="workspace"
        />
      </WorkspaceRoot>
    );
  }

  const primaryPane = (
    <WorkspacePane
      tone="secondary"
      hideHeader
      scrollBody={!primarySurfaceFillsBody}
      contentClassName={primarySurfaceFillsBody ? "flex h-full min-h-0 flex-col" : undefined}
    >
      <PrimaryWorkspaceSurface
        apiBasePath={apiBasePath}
        activeView={activePrimaryView}
        hrefFor={hrefFor}
        navigate={navigate}
        onRouteClick={onRouteClick}
        route={route}
        snapshot={snapshot}
      />
    </WorkspacePane>
  );

  const inspector = routeInspector(route);
  const hasDetail = inspector !== null;

  const detailPane = (
    <WorkspacePane
      title={inspector ? inspectorTitle(inspector, snapshot) : "Details"}
      summary={inspector ? (
        <p className="min-w-0 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {inspectorDescription(inspector, snapshot)}
        </p>
      ) : null}
      actions={(
        <Button
          aria-label="Close detail pane"
          size="icon-sm"
          type="button"
          variant="ghost"
          onClick={() => navigate(withoutInspector(route))}
        >
          <PanelRightCloseIcon aria-hidden="true" />
        </Button>
      )}
    >
      {inspector ? (
        <div data-testid="workbench-detail-pane" className="min-w-0">
          {inspectorBody({
            apiBasePath,
            hrefFor,
            inspector,
            navigate,
            onRouteClick,
            route,
            snapshot,
          })}
        </div>
      ) : null}
    </WorkspacePane>
  );

  return (
    <>
      <WorkspaceRoot
        header={header}
        headerClassName="px-0 py-0 sm:px-0"
        mainId="main-content"
        skipLinkLabel="Skip to Workbench workspace"
      >
        {compact ? (
          hasDetail ? detailPane : primaryPane
        ) : (
          <DesktopWorkspaceSplit
            paneOpen={hasDetail}
            primaryPercent={primaryPercent}
            minPrimaryPercent={DESKTOP_PRIMARY_MIN_PERCENT}
            maxPrimaryPercent={DESKTOP_PRIMARY_MAX_PERCENT}
            onPrimaryPercentChange={setPrimaryPercent}
            primaryPane={primaryPane}
            secondaryPane={detailPane}
            secondaryPaneId="workbench-detail-pane-panel"
            separatorLabel="Resize Workbench detail pane"
          />
        )}
      </WorkspaceRoot>
      <WorkbenchOverlayDialog
        apiBasePath={apiBasePath}
        navigate={navigate}
        route={route}
        snapshot={snapshot}
      />
    </>
  );
}

function PrimaryWorkspaceSurface({
  activeView,
  apiBasePath,
  hrefFor,
  navigate,
  onRouteClick,
  route,
  snapshot,
}: {
  activeView: PrimarySurfaceView;
  apiBasePath: string;
  hrefFor: (route: WorkbenchRoute) => string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const fillsBody = surfaceFillsBody(route);
  const identity = useMemo(() => skillIdentity(snapshot), [snapshot]);
  return (
    <div className={cn("min-w-0", fillsBody ? "flex h-full min-h-0 flex-col gap-5" : "grid gap-5")}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h2 className="break-words text-lg font-semibold text-foreground [overflow-wrap:anywhere]">
            {identity.name}
          </h2>
          {identity.description ? (
            <p className="max-w-3xl break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
              {identity.description}
            </p>
          ) : null}
        </div>
      </div>

      <ViewSwitch
        ariaLabel="Workbench views"
        value={activeView}
        items={PRIMARY_SURFACE_ITEMS}
        onValueChange={(value) => {
          if (isPrimarySurfaceView(value)) {
            // Keep the open detail pane (and any overlay) when switching
            // surfaces: tabs change the master pane, not the inspection.
            navigate(withSurface(route, primarySurfaceFor(value)));
          }
        }}
      />

      {activeView === "versions" ? (
        <VersionsSurface
          route={route}
          snapshot={snapshot}
          hrefFor={hrefFor}
          navigate={navigate}
          onRouteClick={onRouteClick}
        />
      ) : activeView === "files" ? (
        <FilesSurface
          apiBasePath={apiBasePath}
          route={route}
          snapshot={snapshot}
          navigate={navigate}
        />
      ) : (
        <ScorecardSurface route={route} snapshot={snapshot} navigate={navigate} />
      )}
    </div>
  );
}

function isPrimarySurfaceView(value: string): value is PrimarySurfaceView {
  return value === "scorecard" || value === "versions" || value === "files";
}

function primarySurfaceFor(view: PrimarySurfaceView): WorkbenchSurfaceRoute {
  if (view === "versions") {
    return { kind: "versions", view: "list" };
  }
  if (view === "files") {
    return { kind: "files", file: emptyFileRouteState() };
  }
  return { kind: "scorecard" };
}

function primarySurfaceView(route: WorkbenchRoute): PrimarySurfaceView {
  const surface = routeSurface(route);
  if (surface.kind === "versions") {
    return "versions";
  }
  if (surface.kind === "files") {
    return "files";
  }
  return "scorecard";
}

function surfaceFillsBody(route: WorkbenchRoute): boolean {
  const surface = routeSurface(route);
  return (surface.kind === "versions" && surface.view === "graph") || surface.kind === "files";
}

const FRONTMATTER_NAME_PATTERN = /^name:\s*(.+)$/mu;
const FRONTMATTER_DESCRIPTION_PATTERN = /^description:\s*(.+)$/mu;

function skillIdentity(snapshot: WorkbenchInspectionSnapshot): { name: string; description: string | null } {
  const owner = currentVersion(snapshot);
  const skillFile = owner?.files.find((file) => file.path === "SKILL.md");
  const content = skillFile?.content && skillFile.encoding !== "base64" ? skillFile.content : null;
  const frontmatter = content ? parseMarkdownDocument(content).frontmatter : null;
  const read = (pattern: RegExp): string | null => {
    const raw = frontmatter?.match(pattern)?.[1]?.trim() ?? null;
    return raw ? raw.replace(/^["']|["']$/gu, "") : null;
  };
  const name = read(FRONTMATTER_NAME_PATTERN);
  if (name) {
    return { name, description: read(FRONTMATTER_DESCRIPTION_PATTERN) };
  }
  return { name: fileName(snapshot.root) || "Skill", description: null };
}

function versionNameFor(snapshot: WorkbenchInspectionSnapshot, versionId: string | null | undefined): string {
  return versionId
    ? formatVersionDisplayName(versionId, snapshot.versions, comparisonLabelContext(snapshot))
    : "none";
}

function ScorecardSurface({
  navigate,
  route,
  snapshot,
}: {
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  return (
    <div className="grid min-w-0 gap-5">
      <CompareSurface route={route} snapshot={snapshot} navigate={navigate} />
    </div>
  );
}

function CompareSurface({
  navigate,
  route,
  snapshot,
}: {
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const comparison = comparisonForScorecard(snapshot);
  const evaluationOptions = evaluationOptionsForScorecard(snapshot, comparison);
  const defaultEvaluationId = defaultEvaluationIdForScorecard(evaluationOptions);
  const [selectedEvaluationId, setSelectedEvaluationId] = useState<string | null>(defaultEvaluationId);
  useEffect(() => {
    const availableIds = new Set(evaluationOptions.map((option) => option.id));
    if (!defaultEvaluationId && selectedEvaluationId) {
      setSelectedEvaluationId(null);
      return;
    }
    if (defaultEvaluationId && (!selectedEvaluationId || !availableIds.has(selectedEvaluationId))) {
      setSelectedEvaluationId(defaultEvaluationId);
    }
  }, [defaultEvaluationId, evaluationOptions, selectedEvaluationId]);
  const activeEvaluationId = selectedEvaluationId && evaluationOptions.some((option) => option.id === selectedEvaluationId)
    ? selectedEvaluationId
    : defaultEvaluationId;
  const labelContext = comparisonLabelContext(snapshot);
  const groups = buildComparisonGroups(
    comparison,
    labelContext,
  );
  const rows = buildComparisonEvidenceRows({
    groups,
    context: labelContext,
    agents: comparison.agents,
    runs: snapshot.runs,
  });
  const visibleRows = activeEvaluationId
    ? rows.filter((row) => row.evalHash === activeEvaluationId)
    : rows;
  const visibleGroupIds = new Set(visibleRows.map((row) => row.groupId));
  const visibleGroups = groups.filter((group) => visibleGroupIds.has(group.id));
  const selectedEvaluation = activeEvaluationId
    ? evaluationOptions.find((option) => option.id === activeEvaluationId) ?? null
    : null;
  return (
    <ComparisonDetail
      rows={visibleRows}
      groups={visibleGroups.map((group) => ({ id: group.id, label: group.label }))}
      hasComparison={comparison.cells.length > 0}
      evaluation={selectedEvaluation}
      evaluationOptions={evaluationOptions}
      selectedEvaluationId={activeEvaluationId}
      filterLabel="Skills"
      onSelectEvaluation={setSelectedEvaluationId}
      onSelectRun={(runId) => navigate(withInspector(route, { kind: "run", runId }))}
    />
  );
}

function VersionsSurface({
  hrefFor,
  navigate,
  onRouteClick,
  route,
  snapshot,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const surface = routeSurface(route);
  const view: VersionsView = surface.kind === "versions" ? surface.view : "list";
  const fillsBody = surfaceFillsBody(route);
  return (
    <div className={cn("min-w-0", fillsBody ? "flex min-h-0 flex-1 flex-col gap-4" : "grid gap-4")}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
          Every saved state of the skill, newest first, with the improvements that produced it.
        </p>
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Versions view">
          <Button
            aria-pressed={view === "list"}
            size="sm"
            type="button"
            variant={view === "list" ? "secondary" : "ghost"}
            onClick={() => navigate(withSurface(route, { kind: "versions", view: "list" }))}
          >
            <ListIcon aria-hidden="true" /> List
          </Button>
          <Button
            aria-pressed={view === "graph"}
            size="sm"
            type="button"
            variant={view === "graph" ? "secondary" : "ghost"}
            onClick={() => navigate(withSurface(route, { kind: "versions", view: "graph" }))}
          >
            <GitBranchIcon aria-hidden="true" /> Graph
          </Button>
        </div>
      </div>
      {view === "graph" ? (
        <VersionLineageSurface route={route} snapshot={snapshot} navigate={navigate} />
      ) : (
        <>
          <ReleaseCard snapshot={snapshot} />
          <VersionHistoryList route={route} snapshot={snapshot} hrefFor={hrefFor} onRouteClick={onRouteClick} />
          <Accordion type="multiple" className="min-w-0">
            <DetailAccordionSection
              value="advanced"
              title="Advanced"
              summary="Workspace location, skill sources, and connected sources."
            >
              <FactGrid>
                <FactItem title="Workspace root" value={snapshot.root} />
              </FactGrid>
              <SkillsList skills={snapshot.skillSources} route={route} hrefFor={hrefFor} onRouteClick={onRouteClick} />
              <RemotesTable snapshot={snapshot} />
            </DetailAccordionSection>
          </Accordion>
        </>
      )}
    </div>
  );
}

function FilesSurface({
  apiBasePath,
  navigate,
  route,
  snapshot,
}: {
  apiBasePath: string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const surface = routeSurface(route);
  const file = surface.kind === "files" ? surface.file : emptyFileRouteState();
  const owner = currentVersion(snapshot);
  if (!owner) {
    return (
      <EmptyState
        icon={FolderOpenIcon}
        title="No skill files yet"
        message="Files appear once Workbench observes the skill source."
        variant="hero"
        size="sm"
      />
    );
  }
  return (
    <FileBrowserSurface
      apiBasePath={apiBasePath}
      ownerKind="version"
      ownerId={owner.id}
      files={owner.files}
      title="Files"
      description="What this skill tells the agent to do."
      file={file}
      onFileChange={(nextFile, options) => navigate(withFileRouteState(route, nextFile), options)}
    />
  );
}

function ReleaseCard({ snapshot }: { snapshot: WorkbenchInspectionSnapshot }) {
  const currentId = snapshot.status.currentVersionId;
  const publishedId = publishedVersionId(snapshot);
  const versionsAhead = versionsAheadOfPublished(snapshot, publishedId, currentId);
  return (
    <SurfaceSection
      title="Release"
      icon={HashIcon}
      description={publishedId ? "The version other people install." : "This skill has not been published yet."}
    >
      <div className="grid min-w-0 gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline">published {publishedId ? versionNameFor(snapshot, publishedId) : "none"}</Badge>
          <Badge variant="outline">current {currentId ? versionNameFor(snapshot, currentId) : "none"}</Badge>
          {versionsAhead > 0 ? (
            <span className="break-words text-muted-foreground [overflow-wrap:anywhere]">
              Current is {formatCount(versionsAhead, "version")} ahead of the published release.
            </span>
          ) : null}
        </div>
        {snapshot.publication ? (
          <div className="grid min-w-0 gap-2">
            <CopyField label="Install handle" value={snapshot.publication.installHandle} />
          </div>
        ) : null}
      </div>
    </SurfaceSection>
  );
}

function versionsAheadOfPublished(
  snapshot: WorkbenchInspectionSnapshot,
  publishedId: string | null | undefined,
  currentId: string | null | undefined,
): number {
  if (!publishedId || !currentId || publishedId === currentId) {
    return 0;
  }
  const published = snapshot.versions.find((version) => version.id === publishedId);
  if (!published) {
    return 0;
  }
  return snapshot.versions.filter((version) => version.createdAt > published.createdAt).length;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <code className="min-w-0 truncate rounded border border-border/60 bg-muted/30 px-2 py-1 text-xs" title={value}>
        {value}
      </code>
      <Button
        aria-label={`Copy ${label}`}
        size="icon-sm"
        type="button"
        variant="ghost"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
          });
        }}
      >
        {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      </Button>
    </div>
  );
}

interface OverlayDialogContent {
  title: string;
  description: string;
  body: ReactNode;
  fill: boolean;
}

function WorkbenchOverlayDialog({
  apiBasePath,
  navigate,
  route,
  snapshot,
}: {
  apiBasePath: string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const overlay = routeOverlay(route);
  if (!overlay) {
    return null;
  }
  const content = overlayDialogContent({ apiBasePath, route, snapshot });
  if (!content) {
    return null;
  }
  return (
    <InspectorDialogShell
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          navigate(withOverlay(route, null));
        }
      }}
      title={content.title}
      description={content.description}
      className="h-[min(94vh,calc(100dvh-1rem))]"
      bodyClassName="flex h-full min-h-0 flex-col gap-4"
      testId="workbench-overlay-dialog"
      bodyTestId="workbench-overlay-dialog-body"
    >
      <div className="grid min-w-0 shrink-0 gap-1">
        <h2 className="break-words text-base font-semibold text-foreground [overflow-wrap:anywhere]">{content.title}</h2>
        <p className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{content.description}</p>
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1", content.fill ? "overflow-hidden" : "overflow-y-auto")}>
        {content.body}
      </div>
    </InspectorDialogShell>
  );
}

function overlayDialogContent({
  apiBasePath,
  route,
  snapshot,
}: {
  apiBasePath: string;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
}): OverlayDialogContent | null {
  const pane = routeInspector(route);
  if (pane?.kind !== "version") {
    return null;
  }
  const version = snapshot.versions.find((entry) => entry.id === pane.versionId) ?? null;
  return {
    title: `${versionNameFor(snapshot, pane.versionId)} files`,
    description: version
      ? `Browsing ${formatCount(version.files.length, "file")} from ${versionNameFor(snapshot, version.id)}.`
      : "Version files",
    fill: true,
    body: version ? (
      <ObjectFilesSurface
        apiBasePath={apiBasePath}
        ownerKind="version"
        ownerId={version.id}
        files={version.files}
      />
    ) : <MissingObject label={`Version ${pane.versionId}`} />,
  };
}

function inspectorDescription(inspector: WorkbenchInspectorRoute, snapshot: WorkbenchInspectionSnapshot): string {
  if (inspector.kind === "version") {
    const version = snapshot.versions.find((entry) => entry.id === inspector.versionId) ?? null;
    return version ? `${version.message} / ${formatTimestamp(version.createdAt)}` : "Version details";
  }
  if (inspector.kind === "run") {
    const run = snapshot.runs.find((entry) => entry.id === inspector.runId) ?? null;
    return run ? `${run.kind} / ${run.status} / ${formatScore(run.score)}` : "Run details";
  }
  if (inspector.kind === "job") {
    const job = snapshot.jobs.find((entry) => entry.id === inspector.jobId) ?? null;
    return job ? `${job.kind} / ${job.status} / ${formatScore(job.score)}` : "Case details";
  }
  if (inspector.kind === "skill-source") {
    return "Skill source configuration";
  }
  return "Workbench details";
}

function inspectorBody({
  apiBasePath,
  hrefFor,
  inspector,
  navigate,
  onRouteClick,
  route,
  snapshot,
}: {
  apiBasePath: string;
  hrefFor: (route: WorkbenchRoute) => string;
  inspector: WorkbenchInspectorRoute;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  if (inspector.kind === "version") {
    const version = snapshot.versions.find((entry) => entry.id === inspector.versionId) ?? null;
    if (!version) {
      return <MissingObject label={`Version ${inspector.versionId}`} />;
    }
    return (
      <VersionDetail
        version={version}
        snapshot={snapshot}
        route={route}
        hrefFor={hrefFor}
        onRouteClick={onRouteClick}
      />
    );
  }
  if (inspector.kind === "run") {
    const run = snapshot.runs.find((entry) => entry.id === inspector.runId) ?? null;
    if (!run) {
      return <MissingObject label={`Run ${inspector.runId}`} />;
    }
    const jobs = snapshot.jobs.filter((job) => job.runId === run.id);
    return (
      <RunDetail
        run={run}
        jobs={jobs}
        snapshot={snapshot}
        route={route}
        hrefFor={hrefFor}
        onRouteClick={onRouteClick}
      />
    );
  }
  if (inspector.kind === "job") {
    const job = snapshot.jobs.find((entry) => entry.id === inspector.jobId) ?? null;
    if (!job) {
      return <MissingObject label={`Case ${inspector.jobId}`} />;
    }
    return (
      <JobDetail
        apiBasePath={apiBasePath}
        job={job}
        traces={snapshot.traces.filter((trace) => job.traceIds.includes(trace.id) || trace.jobId === job.id)}
        artifacts={snapshot.artifacts.filter((artifact) => job.artifactIds.includes(artifact.id))}
        snapshot={snapshot}
        route={route}
        navigate={navigate}
      />
    );
  }
  if (inspector.kind === "skill-source") {
    const skill = snapshot.skillSources.find((entry) => entry.name === inspector.skillName) ?? null;
    return skill ? <SkillDetail skill={skill} /> : <MissingObject label={`Skill ${inspector.skillName}`} />;
  }
  return null;
}

function VersionDetail({
  hrefFor,
  onRouteClick,
  route,
  version,
  snapshot,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  route: WorkbenchRoute;
  version: WorkbenchVersion;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const runs = snapshot.runs.filter((run) => run.versionId === version.id);
  const filesRoute = withOverlay(route, { kind: "version-files" });
  const publishedId = publishedVersionId(snapshot);
  return (
    <div className="grid min-w-0 gap-6">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {snapshot.status.currentVersionId === version.id ? <Badge variant="outline">current</Badge> : null}
        {publishedId === version.id ? <Badge variant="outline">published</Badge> : null}
      </div>
      <FactGrid>
        <FactItem title="Message" value={version.message} />
        <FactItem title="Created" value={formatTimestamp(version.createdAt)} />
      </FactGrid>
      <PanelTriggerRow
        title="Files"
        summary={`Browse ${formatCount(version.files.length, "file")} from this version.`}
        icon={FolderOpenIcon}
        href={hrefFor(filesRoute)}
        onClick={onRouteClick(filesRoute)}
      />
      <LinkedObjectTable
        title="Runs"
        icon={ActivityIcon}
        rows={runs.map((run) => ({
          id: run.id,
          label: formatTimestamp(run.createdAt),
          route: withInspector(route, { kind: "run", runId: run.id }),
          cells: [run.kind, run.status, run.agentName, formatScore(run.score)],
        }))}
        idColumn="Run"
        columns={["Kind", "Status", "Agent", "Score"]}
        empty="No runs are linked to this version."
        hrefFor={hrefFor}
        onRouteClick={onRouteClick}
      />
    </div>
  );
}

function RunDetail({
  hrefFor,
  jobs,
  onRouteClick,
  route,
  run,
  snapshot,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  jobs: WorkbenchJob[];
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  route: WorkbenchRoute;
  run: WorkbenchRun;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const outputVersionLabel = run.outputVersionId
    ? versionNameFor(snapshot, run.outputVersionId)
    : null;
  const evaluationLabel = formatEvaluationDisplayName(run.evalHash, snapshot.evals);
  const evaluationDetail = formatEvaluationDisplayDetail(run.evalHash, snapshot.evals);
  return (
    <div className="grid min-w-0 gap-6">
      <FactGrid>
        <FactItem title="Status" value={run.status} />
        <FactItem title="Score" value={formatScore(run.score)} />
        <FactItem title="Evaluation" value={evaluationLabel} detail={evaluationDetail} />
        <FactItem title="Agent" value={run.agentName} />
        <FactItem title="Latency" value={formatDurationMs(run.latencyMs)} />
        <FactItem title="Cost" value={formatRunCost(run)} />
        <FactItem title="Started" value={formatTimestamp(run.createdAt)} />
        {outputVersionLabel ? <FactItem title="Improved into" value={outputVersionLabel} /> : null}
      </FactGrid>
      {run.error ? <ProblemState icon={CircleAlertIcon} title="Run error" message={run.error} align="start" /> : null}
      <LinkedObjectTable
        title="Case results"
        icon={ActivityIcon}
        rows={jobs.map((job) => ({
          id: job.id,
          label: job.caseId,
          route: withInspector(route, { kind: "job", jobId: job.id }),
          cells: [job.status, formatScore(job.score), formatDurationMs(job.durationMs)],
        }))}
        idColumn="Case"
        columns={["Status", "Score", "Duration"]}
        empty="No case results are recorded for this run."
        hrefFor={hrefFor}
        onRouteClick={onRouteClick}
      />
    </div>
  );
}

const CASE_VIEW_ITEMS: Array<{
  value: WorkbenchCaseView;
  label: string;
  icon: typeof WorkflowIcon;
}> = [
  { value: "output", label: "Output", icon: ArchiveIcon },
  { value: "timeline", label: "Timeline", icon: ActivityIcon },
];

function isCaseView(value: string): value is WorkbenchCaseView {
  return value === "output" || value === "timeline";
}

function JobDetail({
  apiBasePath,
  artifacts,
  job,
  navigate,
  route,
  snapshot,
  traces,
}: {
  apiBasePath: string;
  artifacts: WorkbenchArtifact[];
  job: WorkbenchJob;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
  traces: WorkbenchTrace[];
}) {
  const view = routeCaseView(route);
  const evaluationLabel = formatEvaluationDisplayName(job.evalHash, snapshot.evals);
  const evaluationDetail = formatEvaluationDisplayDetail(job.evalHash, snapshot.evals);
  return (
    <div className="grid min-w-0 gap-6">
      <FactGrid>
        <FactItem title="Status" value={job.status} />
        <FactItem title="Score" value={formatScore(job.score)} />
        <FactItem title="Duration" value={formatDurationMs(job.durationMs)} />
        <FactItem title="Agent" value={job.agentName} />
        <FactItem title="Evaluation" value={evaluationLabel} detail={evaluationDetail} />
      </FactGrid>
      {job.error ? <ProblemState icon={CircleAlertIcon} title="Case error" message={job.error} align="start" /> : null}
      <ViewSwitch
        ariaLabel="Case views"
        value={view}
        items={CASE_VIEW_ITEMS}
        onValueChange={(value) => {
          if (isCaseView(value)) {
            navigate(withCaseView(route, value));
          }
        }}
      />
      {view === "timeline" ? (
        <JobEvidencePanel
          apiBasePath={apiBasePath}
          jobStatus={job.status}
          runId={job.runId}
          jobId={job.id}
        />
      ) : (
        <CaseOutputView
          apiBasePath={apiBasePath}
          artifacts={artifacts}
          job={job}
          traces={traces}
        />
      )}
    </div>
  );
}

function CaseOutputView({
  apiBasePath,
  artifacts,
  job,
  traces,
}: {
  apiBasePath: string;
  artifacts: WorkbenchArtifact[];
  job: WorkbenchJob;
  traces: WorkbenchTrace[];
}) {
  const artifact = artifacts.find((entry) => entry.files.length > 0) ?? null;
  const trace = traces.find((entry) => entry.files.length > 0) ?? null;
  const owner = artifact
    ? { kind: "artifact" as const, id: artifact.id, files: artifact.files }
    : trace
      ? { kind: "trace" as const, id: trace.id, files: trace.files }
      : null;
  if (!owner) {
    return (
      <EmptyState
        icon={ArchiveIcon}
        title="No output recorded"
        message={`No output files were captured for ${job.caseId}.`}
        size="sm"
      />
    );
  }
  return (
    <div className="grid min-w-0 gap-2">
      <p className="text-sm text-muted-foreground">What the skill produced for {job.caseId}.</p>
      <div className="h-[clamp(20rem,calc(100dvh-26rem),48rem)] overflow-hidden">
        <ObjectFilesSurface
          apiBasePath={apiBasePath}
          ownerKind={owner.kind}
          ownerId={owner.id}
          files={owner.files}
        />
      </div>
    </div>
  );
}

function JobEvidencePanel({
  apiBasePath,
  jobId,
  jobStatus,
  runId,
}: {
  apiBasePath: string;
  jobId: string;
  jobStatus: WorkbenchJob["status"];
  runId: string;
}) {
  const evidence = useJobEvidence({
    apiBasePath,
    jobId,
    runId,
    poll: jobStatus === "queued" || jobStatus === "running",
  });
  const execution = evidence.detail?.executions.find((entry) => entry.jobIds.includes(jobId)) ?? null;
  const timeline = useMemo(
    () => buildExecutionTraceTimeline({ trace: execution?.trace as ExecutionTrace | null }),
    [execution?.trace],
  );

  const isActiveJob = jobStatus === "queued" || jobStatus === "running";
  if (!execution && isActiveJob) {
    return (
      <p className="text-sm text-muted-foreground">
        Waiting for trace events. Run and job status update live; this panel refreshes while the job is active.
      </p>
    );
  }
  if (evidence.loading && !execution) {
    return <p className="text-sm text-muted-foreground">Loading job evidence...</p>;
  }
  if (evidence.error) {
    return <ProblemState icon={CircleAlertIcon} title="Couldn't load job evidence" message={evidence.error} align="start" />;
  }
  if (!execution) {
    return <EmptyState icon={ActivityIcon} title="No execution evidence" message="No evidence is recorded for this job." size="sm" />;
  }
  if (timeline.groups.length === 0) {
    return <EmptyState icon={ActivityIcon} title="No timeline evidence" message={isActiveJob ? "Waiting for live trace events." : "No trace events were recorded for this job."} size="sm" />;
  }
  return (
    <div className="grid min-w-0 gap-4">
      <FactGrid>
        <FactItem title="Status" value={execution.status} />
        <FactItem title="Sessions" value={formatCount(execution.sessions.length, "session")} />
        <FactItem title="Events" value={formatCount(execution.trace.events.length, "event")} />
        <FactItem title="Spans" value={formatCount(execution.trace.spans.length, "span")} />
      </FactGrid>
      <ExecutionTraceTimeline executionTimeline={timeline} layout="content" />
    </div>
  );
}

function PanelTriggerRow({
  href,
  icon: Icon,
  onClick,
  summary,
  title,
}: {
  href: string;
  icon: typeof WorkflowIcon;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  summary?: ReactNode;
  title: string;
}) {
  return (
    <a
      className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-3 py-3 text-sm text-foreground no-underline transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      href={href}
      onClick={onClick}
    >
      <span className="flex min-w-0 items-center gap-3">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="grid min-w-0 gap-0.5">
          <span className="font-medium">{title}</span>
          {summary ? (
            <span className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{summary}</span>
          ) : null}
        </span>
      </span>
      <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </a>
  );
}

function ObjectFilesSurface({
  apiBasePath,
  files,
  ownerId,
  ownerKind,
}: {
  apiBasePath: string;
  files: readonly SurfaceSnapshotFile[];
  ownerId: string;
  ownerKind: WorkbenchFileOwnerKind;
}) {
  const [file, setFile] = useState<WorkbenchFileRouteState>(() => emptyFileRouteState());
  return (
    <div className="h-full min-h-0 overflow-hidden">
      <FileBrowserSurface
        apiBasePath={apiBasePath}
        ownerKind={ownerKind}
        ownerId={ownerId}
        files={files}
        title="Files"
        description="Captured files for this object."
        file={file}
        showHeader={false}
        onFileChange={(nextFile) => setFile(nextFile)}
      />
    </div>
  );
}

function FileBrowserSurface({
  apiBasePath,
  description,
  file,
  files,
  onFileChange,
  ownerId,
  ownerKind,
  showHeader = true,
  title,
}: {
  apiBasePath: string;
  description: string;
  file: WorkbenchFileRouteState;
  files: readonly SurfaceSnapshotFile[];
  onFileChange: (file: WorkbenchFileRouteState, options?: { replace?: boolean }) => void;
  ownerId: string;
  ownerKind: WorkbenchFileOwnerKind;
  showHeader?: boolean;
  title: string;
}) {
  const prefersStackedFilesLayout = useMediaQuery(STACKED_FILES_QUERY);
  const selectedFilePath = files.some((entry) => entry.path === file.filePath)
    ? file.filePath
    : preferredFilePath(files);
  const directoryPath = file.directoryPath ?? directoryPathForFile(selectedFilePath);
  const previewMode = file.previewMode;
  const previewState = useInspectionFilePreview({
    apiBasePath,
    ownerKind,
    ownerId,
    path: selectedFilePath,
    previewMode,
    files,
  });

  useEffect(() => {
    if (selectedFilePath && selectedFilePath !== file.filePath) {
      onFileChange({
        filePath: selectedFilePath,
        directoryPath: directoryPathForFile(selectedFilePath),
        previewMode,
      }, { replace: true });
    }
  }, [file.filePath, onFileChange, previewMode, selectedFilePath]);

  const browser = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <FilesBrowser
        changes={surfaceFilesToChanges(files)}
        selectedFilePath={selectedFilePath}
        browseMode="folders"
        currentDirectory={directoryPath}
        previewMode={previewMode}
        availablePreviewModes={supportedPreviewModes()}
        preview={previewState.preview}
        changesError={null}
        previewError={previewState.error}
        isPreviewLoading={previewState.loading}
        layout={prefersStackedFilesLayout ? "stacked" : "split"}
        emptyMessage="No files are available for this object."
        emptySelectionMessage="Select a file to preview."
        listErrorMessage="Couldn't load the file list."
        previewErrorMessage="Couldn't load the file preview."
        onSelectFile={(filePath) => {
          onFileChange({
            filePath,
            directoryPath: directoryPathForFile(filePath),
            previewMode,
          });
        }}
        onDirectoryChange={(nextDirectoryPath) => {
          onFileChange({
            filePath: selectedFilePath,
            directoryPath: nextDirectoryPath,
            previewMode,
          });
        }}
        onPreviewModeChange={(nextPreviewMode) => {
          onFileChange({
            filePath: selectedFilePath,
            directoryPath,
            previewMode: nextPreviewMode,
          });
        }}
      />
    </div>
  );

  if (!showHeader) {
    return <div className="flex h-full min-h-0 min-w-0 flex-col">{browser}</div>;
  }

  return (
    <SurfaceSection
      title={title}
      icon={FolderOpenIcon}
      description={selectedFilePath ? `Previewing ${selectedFilePath}. ${description}` : description}
      className="flex h-full min-h-0 flex-col"
    >
      {browser}
    </SurfaceSection>
  );
}

function VersionHistoryList({
  route,
  snapshot,
  hrefFor,
  onRouteClick,
}: {
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
}) {
  const versions = snapshot.versions;
  if (versions.length === 0) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title="No versions"
        message="Versions appear after Workbench observes skill source."
        variant="hero"
        size="sm"
      />
    );
  }
  const publishedId = publishedVersionId(snapshot);
  const orderedVersions = [...versions].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id)
  );
  const runsByVersion = new Map<string, WorkbenchRun[]>();
  const latestScoredRunByVersion = new Map<string, WorkbenchRun>();
  for (const run of snapshot.runs) {
    const versionRuns = runsByVersion.get(run.versionId) ?? [];
    versionRuns.push(run);
    runsByVersion.set(run.versionId, versionRuns);
    if (typeof run.score === "number") {
      const latest = latestScoredRunByVersion.get(run.versionId);
      if (!latest || run.createdAt > latest.createdAt) {
        latestScoredRunByVersion.set(run.versionId, run);
      }
    }
  }
  const improvedFromByChild = new Map<string, string>();
  for (const edge of snapshot.lineage) {
    if (edge.reason === "improve") {
      improvedFromByChild.set(edge.childId, edge.parentId);
    }
  }
  return (
    <div className="grid min-w-0 gap-3">
      {orderedVersions.map((version) => {
        const runs = runsByVersion.get(version.id) ?? [];
        const latestScore = latestScoredRunByVersion.get(version.id)?.score;
        const improvedFromId = improvedFromByChild.get(version.id);
        const active = snapshot.status.currentVersionId === version.id;
        const versionRoute = withInspector(route, { kind: "version", versionId: version.id });
        return (
          <a
            aria-current={active ? "page" : undefined}
            className={cn(
              "grid min-w-0 gap-2 rounded-lg border px-3 py-3 text-sm no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary/45 bg-primary/5 text-foreground"
                : "border-border/70 bg-background text-foreground hover:bg-muted/45",
            )}
            href={hrefFor(versionRoute)}
            key={version.id}
            onClick={onRouteClick(versionRoute)}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="grid min-w-0 gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="break-words font-semibold [overflow-wrap:anywhere]">{versionNameFor(snapshot, version.id)}</span>
                  {active ? <Badge variant="outline">current</Badge> : null}
                  {version.id === publishedId ? <Badge variant="outline">published</Badge> : null}
                  {improvedFromId ? (
                    <Badge variant="outline" className="gap-1">
                      <SparklesIcon aria-hidden="true" className="size-3" />
                      improved from {versionNameFor(snapshot, improvedFromId)}
                    </Badge>
                  ) : null}
                </div>
                <span className="break-words text-muted-foreground [overflow-wrap:anywhere]">{version.message}</span>
              </div>
              <HistoryIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            </div>
            <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{formatTimestamp(version.createdAt)}</span>
              {typeof latestScore === "number" ? <span>score {formatScore(latestScore)}</span> : null}
              {runs.length > 0 ? <span>{formatCount(runs.length, "run")}</span> : null}
            </div>
          </a>
        );
      })}
    </div>
  );
}

function VersionLineageSurface({
  navigate,
  route,
  snapshot,
}: {
  navigate: (route: WorkbenchRoute) => void;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  if (snapshot.lineage.length === 0) {
    return (
      <EmptyState
        icon={GitBranchIcon}
        title="No lineage"
        message="Version parent-child edges appear after source changes, improves, switches, or publishes."
        variant="hero"
        size="sm"
      />
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col p-1">
      <LineageGraph
        currentVersionId={snapshot.status.currentVersionId}
        publishedVersionId={publishedVersionId(snapshot)}
        lineage={snapshot.lineage}
        runs={snapshot.runs}
        versions={snapshot.versions}
        onVersionClick={(versionId) => navigate(withInspector(route, { kind: "version", versionId }))}
      />
    </div>
  );
}

function SkillsList({
  skills,
  hrefFor,
  onRouteClick,
  route,
}: {
  skills: WorkbenchSkillSource[];
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  route: WorkbenchRoute;
}) {
  if (skills.length === 0) {
    return <EmptyState icon={SparklesIcon} title="No skill sources" message="No skill sources are configured." variant="hero" size="sm" />;
  }
  return (
    <div className="grid min-w-0 gap-2">
      {skills.map((skill) => {
        const skillRoute = withInspector(route, { kind: "skill-source", skillName: skill.name });
        return (
          <a
            className="grid min-w-0 gap-1 rounded-lg border border-border/70 bg-background px-3 py-3 text-sm text-foreground no-underline transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={hrefFor(skillRoute)}
            key={skill.name}
            onClick={onRouteClick(skillRoute)}
          >
            <span className="font-medium">{skill.name}</span>
            <span className="break-words text-muted-foreground [overflow-wrap:anywhere]">{skillSourceLocation(skill)}</span>
            <span className="text-xs text-muted-foreground">{skill.kind} / {formatCount(skill.includes?.length ?? 0, "include")}</span>
          </a>
        );
      })}
    </div>
  );
}

function SkillDetail({
  skill,
}: {
  skill: WorkbenchSkillSource;
}) {
  return (
    <div className="grid min-w-0 gap-6">
      <FactGrid>
        <FactItem title="Kind" value={skill.kind} />
        <FactItem title="Location" value={skillSourceLocation(skill)} />
        <FactItem title="Includes" value={formatCount(skill.includes?.length ?? 0, "skill")} />
      </FactGrid>
      <SurfaceSection title="Included Skills" icon={SparklesIcon}>
        {skill.includes && skill.includes.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Location</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skill.includes.map((include) => (
                <TableRow key={include.name}>
                  <TableCell className="font-medium">{include.name}</TableCell>
                  <TableCell>{include.kind}</TableCell>
                  <TableCell className="break-words text-muted-foreground [overflow-wrap:anywhere]">{skillSourceLocation(include)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No included skills are configured.</p>
        )}
      </SurfaceSection>
    </div>
  );
}

function LinkedObjectTable({
  title,
  icon,
  rows,
  columns,
  empty,
  hrefFor,
  onRouteClick,
  idColumn = "ID",
}: {
  title: string;
  icon: typeof WorkflowIcon;
  rows: Array<{ id: string; label?: string; route: WorkbenchRoute; cells: string[] }>;
  columns: string[];
  empty: string;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  idColumn?: string;
}) {
  return (
    <SurfaceSection title={title} icon={icon}>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{idColumn}</TableHead>
                {columns.map((column) => <TableHead key={column}>{column}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={onRouteClick(row.route)}>
                  <TableCell>
                    <a
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      href={hrefFor(row.route)}
                      onClick={onRouteClick(row.route)}
                    >
                      {row.label ?? row.id}
                    </a>
                  </TableCell>
                  {row.cells.map((cell, index) => (
                    <TableCell key={`${row.id}-${columns[index]}`} className="break-words text-muted-foreground [overflow-wrap:anywhere]">
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </SurfaceSection>
  );
}

function WorkbenchBreadcrumbs({
  hrefFor,
  onRouteClick,
  route,
  snapshot,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot | null;
}) {
  const items = breadcrumbItems(route, snapshot);
  if (items.length === 0) {
    return null;
  }
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="min-w-0 flex-nowrap">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              {index === 0 ? null : <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {item.route && !isLast ? (
                  <BreadcrumbLink href={hrefFor(item.route)} onClick={onRouteClick(item.route)}>
                    {item.label}
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="truncate">{item.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function WorkbenchActivitySummary({
  snapshot,
  loading,
  refreshing,
  error,
  onRefresh,
}: {
  snapshot: WorkbenchInspectionSnapshot;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const activeWork = activeWorkbenchWork(snapshot);
  const lastUpdatedAt = latestSnapshotTimestamp(snapshot);
  const label = loading && !lastUpdatedAt
    ? "Loading state"
    : activeWorkbenchWorkLabel(activeWork);
  const secondary = activitySecondaryLabel(snapshot, lastUpdatedAt, refreshing, error);
  const tone = badgeToneProps(error
    ? "destructive"
    : activeWork.hasActiveWork
      ? "warning"
      : "outline");
  return (
    <div data-testid="workbench-activity-summary" className="flex min-w-0 items-center justify-start gap-2 text-xs md:justify-end">
      <Badge
        variant={tone.variant}
        className={cn("max-w-[11rem] truncate", tone.className)}
        title={label}
      >
        {label}
      </Badge>
      <span className="hidden min-w-0 max-w-[14rem] truncate text-muted-foreground lg:inline" title={secondary}>
        {secondary}
      </span>
      <Button
        aria-label="Refresh Workbench state"
        disabled={loading || refreshing}
        size="icon-sm"
        title="Refresh Workbench state"
        type="button"
        variant="ghost"
        onClick={onRefresh}
      >
        <RefreshCwIcon aria-hidden="true" className={cn(refreshing && "animate-spin")} />
        <span className="sr-only">Refresh</span>
      </Button>
    </div>
  );
}

interface WorkbenchActiveWork {
  queued: number;
  running: number;
  hasActiveWork: boolean;
}

function activeWorkbenchWork(snapshot: WorkbenchInspectionSnapshot): WorkbenchActiveWork {
  const activeJobs = snapshot.jobs.filter((job) => job.status === "queued" || job.status === "running");
  const activeJobRunIds = new Set(activeJobs.map((job) => job.runId));
  const orphanRunningRuns = snapshot.runs.filter((run) => run.status === "running" && !activeJobRunIds.has(run.id));
  const running = activeJobs.filter((job) => job.status === "running").length + orphanRunningRuns.length;
  const queued = activeJobs.filter((job) => job.status === "queued").length;
  return {
    queued,
    running,
    hasActiveWork: queued > 0 || running > 0,
  };
}

function activeWorkbenchWorkLabel(activeWork: WorkbenchActiveWork): string {
  if (!activeWork.hasActiveWork) {
    return "No active runs";
  }
  if (activeWork.running > 0 && activeWork.queued > 0) {
    return `${activeWork.running} running, ${activeWork.queued} queued`;
  }
  if (activeWork.running > 0) {
    return `${activeWork.running} running`;
  }
  return `${activeWork.queued} queued`;
}

function snapshotHasActiveWork(snapshot: WorkbenchInspectionSnapshot | null): boolean {
  return snapshot ? activeWorkbenchWork(snapshot).hasActiveWork : false;
}

function activitySecondaryLabel(
  snapshot: WorkbenchInspectionSnapshot,
  lastUpdatedAt: string | null,
  refreshing: boolean,
  error: string | null,
): string {
  if (error) {
    return "Snapshot unavailable";
  }
  if (refreshing) {
    return "Refreshing";
  }
  if (lastUpdatedAt) {
    return `Updated ${formatTimestamp(lastUpdatedAt)}`;
  }
  return formatCount(snapshot.runs.length, "run");
}

function latestSnapshotTimestamp(snapshot: WorkbenchInspectionSnapshot): string | null {
  const timestamps = [
    ...snapshot.versions.map((version) => version.createdAt),
    ...snapshot.skillBundles.map((bundle) => bundle.createdAt),
    ...snapshot.runs.map((run) => run.finishedAt ?? run.createdAt),
    ...snapshot.jobs.map((job) => job.finishedAt ?? job.startedAt ?? job.createdAt),
    ...snapshot.traces.map((trace) => trace.createdAt),
    ...snapshot.executionEvents.map((batch) => batch.emittedAt),
    ...snapshot.artifacts.map((artifact) => artifact.createdAt),
    ...snapshot.lineage.map((edge) => edge.createdAt),
  ].filter(Boolean);
  return timestamps.sort().at(-1) ?? null;
}

function inspectorTitle(inspector: WorkbenchInspectorRoute, snapshot: WorkbenchInspectionSnapshot | null): string {
  if (inspector.kind === "version") {
    return snapshot ? formatVersionDisplayName(inspector.versionId, snapshot.versions, comparisonLabelContext(snapshot)) : "Version details";
  }
  if (inspector.kind === "run") {
    const run = snapshot?.runs.find((entry) => entry.id === inspector.runId) ?? null;
    return run && snapshot ? runDisplayTitle(run, snapshot) : "Run details";
  }
  if (inspector.kind === "job") {
    const job = snapshot?.jobs.find((entry) => entry.id === inspector.jobId) ?? null;
    return job ? `Case ${job.caseId}` : "Case details";
  }
  if (inspector.kind === "skill-source") {
    return snapshot ? formatSkillDisplayName(inspector.skillName, comparisonLabelContext(snapshot)) : "Skill details";
  }
  return "Workbench";
}

function runDisplayTitle(run: WorkbenchRun, snapshot: WorkbenchInspectionSnapshot): string {
  const context = comparisonLabelContext(snapshot);
  return [
    formatSkillDisplayName(run.skillName, context),
    formatVersionDisplayName(run.versionId, snapshot.versions, context),
    "run",
  ].join(" ");
}

function breadcrumbItems(route: WorkbenchRoute, snapshot: WorkbenchInspectionSnapshot | null): Array<{ label: string; route?: WorkbenchRoute }> {
  const surface = routeSurface(route);
  const inspector = routeInspector(route);
  if (!inspector) {
    return [];
  }
  const items: Array<{ label: string; route?: WorkbenchRoute }> = [
    { label: surfaceLabel(surface), route: withoutInspector(route) },
  ];
  if (inspector.kind === "job" && snapshot) {
    const job = snapshot.jobs.find((entry) => entry.id === inspector.jobId) ?? null;
    const run = job ? snapshot.runs.find((entry) => entry.id === job.runId) ?? null : null;
    if (run) {
      items.push({
        label: runDisplayTitle(run, snapshot),
        route: withInspector(route, { kind: "run", runId: run.id }),
      });
    }
  }
  return [...items, { label: inspectorTitle(inspector, snapshot) }];
}

function surfaceLabel(surface: WorkbenchSurfaceRoute): string {
  if (surface.kind === "versions") {
    return "Versions";
  }
  if (surface.kind === "files") {
    return "Files";
  }
  return "Scorecard";
}

function useJobEvidence({
  apiBasePath,
  jobId,
  poll = false,
  runId,
}: {
  apiBasePath: string;
  jobId: string;
  poll?: boolean;
  runId: string;
}): {
  loading: boolean;
  error: string | null;
  detail: WorkbenchExecutionTraceDetail | null;
} {
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    detail: WorkbenchExecutionTraceDetail | null;
  }>({ loading: true, error: null, detail: null });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setState((current) => ({
      loading: !current.detail || current.detail.runId !== runId,
      error: null,
      detail: current.detail?.runId === runId ? current.detail : null,
    }));
    const loadEvidence = async () => {
      try {
        const response = await fetch(jobEvidenceApiPath(apiBasePath, runId, jobId), {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(await responseErrorMessage(response));
        }
        const detail = await response.json() as WorkbenchExecutionTraceDetail;
        if (!cancelled) {
          setState({ loading: false, error: null, detail });
        }
      } catch (error: unknown) {
        if (!cancelled && !controller.signal.aborted) {
          setState((current) => ({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            detail: current.detail?.runId === runId ? current.detail : null,
          }));
        }
      }
    };

    void loadEvidence();
    const timer = poll
      ? window.setInterval(() => void loadEvidence(), ACTIVE_JOB_EVIDENCE_REFRESH_MS)
      : null;
    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearInterval(timer);
      }
      controller.abort();
    };
  }, [apiBasePath, jobId, poll, runId]);

  return state;
}

function useInspectionFilePreview({
  apiBasePath,
  ownerKind,
  ownerId,
  path,
  previewMode,
  files,
}: {
  apiBasePath: string;
  ownerKind: WorkbenchFileOwnerKind;
  ownerId: string;
  path: string | null;
  previewMode: PreviewMode;
  files: readonly SurfaceSnapshotFile[];
}): {
  loading: boolean;
  error: string | null;
  preview: ReturnType<typeof surfaceFileToPreview> | null;
} {
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    preview: ReturnType<typeof surfaceFileToPreview> | null;
  }>({ loading: false, error: null, preview: null });

  useEffect(() => {
    const fileEntry = path ? files.find((file) => file.path === path) ?? null : null;
    if (!path || !fileEntry) {
      setState({ loading: false, error: null, preview: null });
      return;
    }

    const unavailableReason = workbenchInspectionFileContentUnavailableReason(fileEntry);
    if (unavailableReason) {
      setState({
        loading: false,
        error: null,
        preview: surfaceFileToPreview({
          path: fileEntry.path,
          kind: fileEntry.kind,
          encoding: fileEntry.encoding,
          executable: fileEntry.executable,
          unavailableReason,
        }, previewMode),
      });
      return;
    }

    if (fileEntry.content) {
      setState({
        loading: false,
        error: null,
        preview: surfaceFileToPreview(workbenchInspectionFileContent(fileEntry), previewMode),
      });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setState({ loading: true, error: null, preview: null });
    void fetch(fileContentApiPath(apiBasePath, ownerKind, ownerId, path), {
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return await response.json() as WorkbenchInspectionFileContent;
    }).then((content) => {
      if (!cancelled) {
        setState({
          loading: false,
          error: null,
          preview: surfaceFileToPreview(content, previewMode),
        });
      }
    }).catch((error: unknown) => {
      if (!cancelled && !controller.signal.aborted) {
        setState({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          preview: null,
        });
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBasePath, files, ownerId, ownerKind, path, previewMode]);

  return state;
}

async function responseErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    // Use the raw text below.
  }
  return text.trim() || response.statusText || `HTTP ${response.status}`;
}

function RemotesTable({ snapshot }: { snapshot: WorkbenchInspectionSnapshot }) {
  if (snapshot.remotes.length === 0) {
    return <p className="text-sm text-muted-foreground">No remotes are configured.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Remote</TableHead>
          <TableHead>URL</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {snapshot.remotes.map((remote) => (
          <TableRow key={remote.name}>
            <TableCell className="font-medium">{remote.name}</TableCell>
            <TableCell className="break-words font-mono text-xs [overflow-wrap:anywhere]">{remote.url}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DetailAccordionSection({
  children,
  summary,
  title,
  value,
}: {
  children: ReactNode;
  summary?: ReactNode;
  title: string;
  value: string;
}) {
  return (
    <AccordionItem value={value} className="min-w-0">
      <AccordionTrigger className="min-w-0 py-2.5">
        <div className="grid min-w-0 flex-1 gap-1 text-left">
          <span className="min-w-0 text-sm font-medium text-foreground">{title}</span>
          {summary ? (
            <span className="min-w-0 max-w-full whitespace-normal break-words text-xs font-normal text-muted-foreground [overflow-wrap:anywhere]">
              {summary}
            </span>
          ) : null}
        </div>
      </AccordionTrigger>
      <AccordionContent className="!h-auto pb-3">
        <div className="flex flex-col gap-3">{children}</div>
      </AccordionContent>
    </AccordionItem>
  );
}

function FactGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]">
      {children}
    </div>
  );
}

function FactItem({
  title,
  value,
  detail,
}: {
  title: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1 border-t border-border/60 py-3">
      <div className="break-words text-xs font-medium text-muted-foreground [overflow-wrap:anywhere]">
        {title}
      </div>
      <div className="break-all text-sm font-semibold leading-5 text-foreground [overflow-wrap:anywhere]">
        {value}
      </div>
      {detail ? (
        <div className="break-all text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{detail}</div>
      ) : null}
    </div>
  );
}

function MissingObject({ label }: { label: string }) {
  return (
    <EmptyState
      icon={CircleAlertIcon}
      title="Object not found"
      message={`${label} is not present in this inspection snapshot.`}
      variant="hero"
      size="md"
    />
  );
}

function comparisonLabelContext(
  snapshot: WorkbenchInspectionSnapshot,
  overrides: Partial<ComparisonLabelContext> = {},
): ComparisonLabelContext {
  return {
    allVersions: snapshot.versions,
    currentVersionId: snapshot.status.currentVersionId,
    defaultSkill: snapshot.status.defaultSkill,
    publishedVersionId: publishedVersionId(snapshot),
    ...overrides,
  };
}

function WorkbenchLoadingIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      className={cn("workbench-loading-mark", className)}
      fill="none"
      viewBox="0 0 26.5 26.5"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g fill="currentColor">
        <circle cx="16.5" cy="3.5" r="2.58" />
        <circle cx="23" cy="3.5" r="2.8" />
        <circle cx="10" cy="10" r="2.15" />
        <circle cx="16.5" cy="10" r="2.37" />
        <circle cx="23" cy="10" r="2.58" />
        <circle cx="3.5" cy="16.5" r="1.72" />
        <circle cx="10" cy="16.5" r="1.93" />
        <circle cx="16.5" cy="16.5" r="2.15" />
        <circle cx="3.5" cy="23" r="1.5" />
        <circle cx="10" cy="23" r="1.72" />
      </g>
    </svg>
  );
}

function currentVersion(snapshot: WorkbenchInspectionSnapshot): WorkbenchVersion | null {
  return snapshot.status.currentVersionId
    ? snapshot.versions.find((version) => version.id === snapshot.status.currentVersionId) ?? null
    : snapshot.versions[0] ?? null;
}

function publishedVersionId(snapshot: WorkbenchInspectionSnapshot): string | null {
  return snapshot.publication?.versionId ?? snapshot.refs.published ?? null;
}

function jobEvidenceApiPath(apiBasePath: string, runId: string, jobId: string): string {
  const base = apiBasePath.replace(/\/+$/u, "");
  const params = new URLSearchParams({ run: runId });
  return `${base}/jobs/${encodeURIComponent(jobId)}/evidence?${params.toString()}`;
}

function fileContentApiPath(
  apiBasePath: string,
  ownerKind: WorkbenchFileOwnerKind,
  ownerId: string,
  path: string,
): string {
  const base = apiBasePath.replace(/\/+$/u, "");
  return `${base}/${ownerKind}s/${encodeURIComponent(ownerId)}/files/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function skillSourceLocation(skill: Pick<WorkbenchSkillSource, "kind" | "path" | "from" | "ref">): string {
  if (skill.kind === "none") {
    return "No skill mounted";
  }
  if (skill.kind === "remote") {
    return `${skill.from ?? "remote"}${skill.ref ? `#${skill.ref}` : ""}`;
  }
  return skill.path ?? ".";
}

function emptyFileRouteState(): WorkbenchFileRouteState {
  return { filePath: null, directoryPath: null, previewMode: "rendered" };
}
