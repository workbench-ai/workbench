"use client";

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import {
  ActivityIcon,
  ArchiveIcon,
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  FileTextIcon,
  FolderOpenIcon,
  GitBranchIcon,
  HistoryIcon,
  PlusIcon,
  PlayCircleIcon,
  RefreshCwIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";

import {
  buildWorkbenchJobReport,
  buildWorkbenchRunEvidenceView,
  isWorkbenchPackageSourcePath,
  workbenchJobReportMetricBreakdown,
  workbenchSampleCoverage,
  workbenchSampleCoverageForJobs,
} from "@workbench-ai/workbench-contract";
import type {
  SurfaceSnapshotFile,
  WorkbenchActionCapabilities,
  WorkbenchArtifact,
  WorkbenchEvalCaseSnapshot,
  WorkbenchEvalSnapshot,
  WorkbenchExecutionTraceDetail,
  WorkbenchGradePlanDisplayBlock,
  WorkbenchInspectionFileContent,
  WorkbenchInspectionSnapshot,
  WorkbenchInspectionSnapshotEnvelope,
  WorkbenchAgentSnapshot,
  WorkbenchAgentVersion,
  WorkbenchJob,
  WorkbenchJobReport,
  WorkbenchOperationRequest,
  WorkbenchOperationTarget,
  WorkbenchReportMetricKind,
  WorkbenchSampleCoverage,
  WorkbenchRun,
  WorkbenchRunEvidenceCaseResult,
  WorkbenchRunEvidenceJob,
  WorkbenchRunEvidenceJobPhase,
  WorkbenchRunEvidenceView,
  WorkbenchRunSnapshot,
  WorkbenchSkillVersion,
  WorkbenchSkillSource,
  WorkbenchStateNotice,
  WorkbenchTrace,
} from "@workbench-ai/workbench-contract";
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
import { ExecutionTraceTimeline } from "@workbench-ai/cli-web-ui/components/shared/execution-trace-timeline";
import { ProblemState } from "@workbench-ai/cli-web-ui/components/shared/problem-state";
import { TopLoadingBar } from "@workbench-ai/cli-web-ui/components/shared/top-loading-bar";
import { ViewSwitch } from "@workbench-ai/cli-web-ui/components/shared/view-switch";
import { WorkbenchBrand } from "@workbench-ai/cli-web-ui/components/shared/workbench-brand";
import { WorkspaceRoot } from "@workbench-ai/cli-web-ui/components/shared/workspace-root";
import { WorkspaceTopBar } from "@workbench-ai/cli-web-ui/components/shared/workspace-top-bar";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workbench-ai/cli-web-ui/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workbench-ai/cli-web-ui/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workbench-ai/cli-web-ui/components/ui/select";
import { badgeToneProps } from "@workbench-ai/cli-web-ui/lib/badge";
import {
  buildExecutionTraceTimeline,
  type ExecutionTrace,
} from "@workbench-ai/cli-web-ui/lib/execution-trace-timeline";
import { parseMarkdownDocument } from "@workbench-ai/cli-web-ui/lib/markdown-document";
import { WORKBENCH_CONTENT_RAIL_CLASS } from "@workbench-ai/cli-web-ui/lib/workbench-layout";
import { cn } from "@workbench-ai/cli-web-ui/lib/utils";

import { StatusBadge } from "./components/status-badge";
import { SurfaceSection } from "./components/surface-section";
import { LineageGraph } from "./components/lineage-graph";
import { RepositoryFilesView } from "./components/repository-files-view";
import { EvaluationResultsVisualSummary } from "./components/evaluation-results-visual-summary";
import { WorkbenchActionBar, type WorkbenchOperationPreviewState } from "./components/workbench-action-bar";
import {
  caseFileOwnerId,
  fileContentApiPath,
  jobEvidenceApiPath,
} from "./lib/api-paths";
import {
  fileName,
  directoryPathForFile,
  formatCost,
  formatCount,
  formatDurationMs,
  formatReportCost,
  formatScore,
  formatTimestamp,
  jobsForRun,
  jobScore,
  runScore,
  shortId,
} from "./lib/format";
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
  routePrimaryTab,
  withEvalVersionId,
  withFileRouteState,
  type WorkbenchEvaluationView,
  type WorkbenchFileOwnerKind,
  type WorkbenchFileRouteState,
  type WorkbenchPrimaryTab,
  type WorkbenchRunCasePhase,
  type WorkbenchRunJobEvidenceView,
  type WorkbenchRoute,
} from "./lib/routes";
import {
  createEvaluationCase,
  routeForWorkbenchRunSnapshot,
  startWorkbenchOperation,
} from "./lib/operations";
import type { VersionLineageFlow } from "./lib/lineage";
import {
  defaultSourceVersion,
  orderedVersions,
  publishedVersionId,
} from "./lib/version-selection";

export type { WorkbenchOperationPreviewState } from "./components/workbench-action-bar";
import {
  buildResultEvidenceRows,
  buildResultGroups,
  resultsForScorecard,
  defaultEvalVersionIdForResults,
  evalVersionOptionsForResults,
  formatEvaluationDisplayDetail,
  formatEvaluationDisplayName,
  formatVersionDisplayName,
  missingCostLabelForStatus,
  resultVersionGroupId,
  type ResultEvalVersionOption,
  type ResultEvidenceRow,
  type ResultLabelContext,
} from "./lib/results-metrics";

export interface WorkbenchWorkspaceProps {
  apiBasePath?: string;
  routeBasePath?: string;
  brandHref?: string;
  hideHeader?: boolean;
  headerControls?: ReactNode;
  identityControls?: ReactNode;
  initialEnvelope?: WorkbenchInspectionSnapshotEnvelope | null;
  initialRoute?: WorkbenchRoute;
  hostContext?: WorkbenchHostContext;
  contentScrollTop?: number;
  operationPreview?: WorkbenchOperationPreviewState;
  sidebarMode?: "auto" | "hidden";
  syncLocation?: boolean;
  versionHistoryDialog?: WorkbenchVersionHistoryDialogState;
}

export interface WorkbenchHostContext {
  handle?: string;
  ownerHref?: string;
  ownerSlug?: string;
  skillName?: string;
  sourceVisibility?: string;
  evidenceAccess?: "full" | "source";
}

type RouteLoadingReporter = (id: string, active: boolean) => void;

const RouteLoadingContext = createContext<RouteLoadingReporter>(() => undefined);

function useRouteLoadingReporter(): (active: boolean) => void {
  const report = useContext(RouteLoadingContext);
  const id = useId();
  return useCallback((active: boolean) => report(id, active), [id, report]);
}

function useRouteLoadingSignal(active: boolean): void {
  const report = useRouteLoadingReporter();
  useEffect(() => {
    report(active);
    return () => report(false);
  }, [active, report]);
}

const PRIMARY_TABS: Array<{
  value: WorkbenchPrimaryTab;
  label: string;
  icon: typeof WorkflowIcon;
}> = [
  { value: "files", label: "Files", icon: FolderOpenIcon },
  { value: "evaluation", label: "Evaluation", icon: WorkflowIcon },
  { value: "runs", label: "Runs", icon: PlayCircleIcon },
];

const EVALUATION_VIEW_ITEMS: Array<{
  value: WorkbenchEvaluationView;
  label: string;
  icon: typeof WorkflowIcon;
}> = [
  { value: "results", label: "Results", icon: WorkflowIcon },
  { value: "cases", label: "Cases", icon: FileTextIcon },
];

export type WorkbenchVersionHistoryView = "list" | "lineage";

export interface WorkbenchVersionHistoryDialogState {
  open?: boolean;
  view?: WorkbenchVersionHistoryView;
  initialLineageFlow?: VersionLineageFlow;
}

export interface WorkbenchVersionHistoryDialogSurfaceProps {
  className?: string;
  graphClassName?: string;
  initialLineageFlow?: VersionLineageFlow;
  onValueChange: (versionId: string) => void;
  onViewChange: (view: WorkbenchVersionHistoryView) => void;
  snapshot: WorkbenchInspectionSnapshot;
  value: string;
  view: WorkbenchVersionHistoryView;
}

const VERSION_HISTORY_VIEW_ITEMS: Array<{
  value: WorkbenchVersionHistoryView;
  label: string;
  icon: typeof WorkflowIcon;
}> = [
  { value: "list", label: "List", icon: FolderOpenIcon },
  { value: "lineage", label: "Lineage", icon: GitBranchIcon },
];

const VERSION_HISTORY_DIALOG_CONTENT_CLASS =
  "flex h-[min(42rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-2xl grid-rows-none flex-col gap-0 overflow-hidden p-0 data-open:animate-none data-closed:animate-none sm:max-w-2xl";

const VERSION_HISTORY_DIALOG_SURFACE_CLASS =
  "relative flex h-[min(42rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-xl bg-popover text-sm text-popover-foreground ring-1 ring-foreground/10";

function useWorkbenchInspection({
  apiBasePath,
  initialEnvelope,
}: {
  apiBasePath: string;
  initialEnvelope: WorkbenchInspectionSnapshotEnvelope | null;
}): {
  cursor: string | null;
  error: string | null;
  loading: boolean;
  progressCursor: string | null;
  refresh: () => void;
  refreshing: boolean;
  actions: WorkbenchActionCapabilities | null;
  snapshot: WorkbenchInspectionSnapshot | null;
} {
  const [envelope, setEnvelope] = useState<WorkbenchInspectionSnapshotEnvelope | null>(initialEnvelope);
  const [loading, setLoading] = useState(!initialEnvelope);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressCursor, setProgressCursor] = useState<string | null>(null);
  const [refreshRequest, setRefreshRequest] = useState({ key: 0, visible: false });
  const refresh = useCallback(() => setRefreshRequest((current) => ({
    key: current.key + 1,
    visible: true,
  })), []);

  useEffect(() => {
    if (initialEnvelope && refreshRequest.key === 0) {
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    const hasExistingSnapshot = envelope !== null;
    setLoading(!hasExistingSnapshot);
    setRefreshing(hasExistingSnapshot && refreshRequest.visible);
    setError(null);

    async function loadSnapshot() {
      try {
        const next = await fetchInspectionEnvelope(apiBasePath, controller.signal);
        if (!cancelled) {
          setEnvelope(next);
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
  }, [apiBasePath, initialEnvelope, refreshRequest.key, refreshRequest.visible]);

  useEffect(() => {
    if (!envelope?.cursor) {
      return;
    }
    let cancelled = false;
    let eventSource: EventSource | null = null;
    let waitController: AbortController | null = null;
    let retryTimer: number | null = null;
    let currentCursor = envelope.cursor;

    const triggerSnapshotRefresh = (notice: WorkbenchStateNotice) => {
      currentCursor = notice.cursor;
      setRefreshRequest((current) => ({
        key: current.key + 1,
        visible: false,
      }));
    };

    const handleNotice = (notice: WorkbenchStateNotice) => {
      currentCursor = notice.cursor;
      if (notice.type === "changed" || notice.type === "reset") {
        triggerSnapshotRefresh(notice);
        return true;
      }
      if (notice.type === "progress") {
        setProgressCursor(notice.cursor);
      }
      return false;
    };

    const scheduleWaitLoop = (delayMs = 0) => {
      if (cancelled) {
        return;
      }
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void waitLoop();
      }, delayMs);
    };

    const waitLoop = async () => {
      while (!cancelled) {
        waitController = new AbortController();
        try {
          const notice = await fetchStateNotice(apiBasePath, currentCursor, waitController.signal);
          waitController = null;
          if (cancelled) {
            return;
          }
          if (handleNotice(notice)) {
            return;
          }
        } catch {
          waitController = null;
          if (!cancelled) {
            scheduleWaitLoop(1_000);
          }
          return;
        }
      }
    };

    if (typeof window.EventSource === "function") {
      eventSource = new window.EventSource(stateStreamUrl(apiBasePath, currentCursor));
      eventSource.onmessage = (event) => {
        try {
          const notice = JSON.parse(event.data) as WorkbenchStateNotice;
          handleNotice(notice);
        } catch {
          // Ignore malformed live notices; the next valid notice or manual refresh recovers.
        }
      };
      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        scheduleWaitLoop(1_000);
      };
    } else {
      scheduleWaitLoop();
    }

    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      waitController?.abort();
      eventSource?.close();
    };
  }, [apiBasePath, envelope?.cursor]);

  return {
    cursor: envelope?.cursor ?? null,
    error,
    loading,
    progressCursor,
    refresh,
    refreshing,
    actions: envelope?.actions ?? null,
    snapshot: envelope?.snapshot ?? null,
  };
}

async function fetchInspectionEnvelope(
  apiBasePath: string,
  signal: AbortSignal,
): Promise<WorkbenchInspectionSnapshotEnvelope> {
  const response = await fetch(`${apiBasePath}/snapshot`, { signal });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }
  const envelope = await response.json() as WorkbenchInspectionSnapshotEnvelope;
  if (envelope.schema !== "workbench.inspection.snapshot-envelope.v1" || !envelope.cursor || !envelope.snapshot) {
    throw new Error("Workbench snapshot endpoint returned an unsupported response.");
  }
  return envelope;
}

async function fetchStateNotice(
  apiBasePath: string,
  cursor: string,
  signal: AbortSignal,
): Promise<WorkbenchStateNotice> {
  const response = await fetch(`${apiBasePath}/state/wait?cursor=${encodeURIComponent(cursor)}&timeoutMs=25000`, { signal });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }
  const notice = await response.json() as WorkbenchStateNotice;
  if (notice.schema !== "workbench.state.notice.v1" || !notice.cursor) {
    throw new Error("Workbench state endpoint returned an unsupported response.");
  }
  return notice;
}

function stateStreamUrl(apiBasePath: string, cursor: string): string {
  return `${apiBasePath}/state/stream?cursor=${encodeURIComponent(cursor)}`;
}

type WorkbenchRouteEvidenceMode = "none" | "optional" | "required";

export function workbenchRouteEvidenceMode(route: WorkbenchRoute): WorkbenchRouteEvidenceMode {
  switch (route.kind) {
    case "evaluation":
      if (route.view === "results") {
        return "required";
      }
      return "optional";
    case "case":
      return route.section === "runs" ? "required" : "none";
    case "runs":
    case "run":
    case "run-job":
      return "required";
    case "files":
    case "not-found":
      return "none";
  }
}

export function workbenchSnapshotNeedsEvidenceRefresh(snapshot: WorkbenchInspectionSnapshot): boolean {
  return workbenchSnapshotReportsEvidence(snapshot) && !workbenchSnapshotHasEvidence(snapshot);
}

function workbenchSnapshotReportsEvidence(snapshot: WorkbenchInspectionSnapshot): boolean {
  return snapshot.status.runCount > 0 || (snapshot.results?.cells.length ?? 0) > 0;
}

function workbenchSnapshotHasEvidence(snapshot: WorkbenchInspectionSnapshot): boolean {
  return snapshot.runs.length > 0 ||
    snapshot.jobs.length > 0 ||
    snapshot.traces.length > 0 ||
    snapshot.executionEvents.length > 0 ||
    snapshot.artifacts.length > 0 ||
    snapshot.lineage.length > 0 ||
    (snapshot.results?.cells.length ?? 0) > 0;
}

export function WorkbenchWorkspace({
  apiBasePath = "/api",
  routeBasePath = "/",
  brandHref = "/",
  hideHeader = false,
  headerControls,
  identityControls,
  initialEnvelope = null,
  initialRoute,
  hostContext,
  contentScrollTop,
  operationPreview,
  sidebarMode = "auto",
  syncLocation = true,
  versionHistoryDialog,
}: WorkbenchWorkspaceProps) {
  const {
    cursor: inspectionCursor,
    error,
    loading,
    progressCursor,
    refresh: refreshSnapshot,
    refreshing,
    actions,
    snapshot,
  } = useWorkbenchInspection({ apiBasePath, initialEnvelope });
  const [route, setRoute] = useState<WorkbenchRoute>(() =>
    initialRoute ?? parseWorkbenchLocation(undefined, routeBasePath));
  const hasInitialRoute = initialRoute !== undefined;
  const [routePending, startRouteTransition] = useTransition();
  const [routeLoadingIds, setRouteLoadingIds] = useState<ReadonlySet<string>>(() => new Set());
  const reportRouteLoading = useCallback<RouteLoadingReporter>((id, active) => {
    setRouteLoadingIds((current) => {
      if (active === current.has(id)) {
        return current;
      }
      const next = new Set(current);
      if (active) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!syncLocation) {
      return;
    }
    const updateRoute = () => setRoute(parseWorkbenchLocation(undefined, routeBasePath));
    if (!hasInitialRoute) {
      updateRoute();
    }
    window.addEventListener("popstate", updateRoute);
    return () => window.removeEventListener("popstate", updateRoute);
  }, [hasInitialRoute, routeBasePath, syncLocation]);

  const hrefFor = useCallback(
    (nextRoute: WorkbenchRoute) => buildWorkbenchLocationHref(nextRoute, routeBasePath),
    [routeBasePath],
  );
  useEffect(() => {
    if (!syncLocation) {
      return;
    }
    const canonicalHref = hrefFor(route);
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== canonicalHref) {
      window.history.replaceState({}, "", canonicalHref);
    }
  }, [hrefFor, route, syncLocation]);
  const navigate = useCallback((nextRoute: WorkbenchRoute, options: { replace?: boolean } = {}) => {
    const href = hrefFor(nextRoute);
    const current = `${window.location.pathname}${window.location.search}`;
    startRouteTransition(() => {
      if (syncLocation && href !== current) {
        window.history[options.replace ? "replaceState" : "pushState"]({}, "", href);
      }
      setRoute(nextRoute);
    });
  }, [hrefFor, startRouteTransition, syncLocation]);
  const onRouteClick = useCallback((nextRoute: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(nextRoute);
  }, [navigate]);
  const identity = useSkillIdentity({ apiBasePath, hostContext, snapshot });
  const onOperationStarted = useCallback((started: WorkbenchRunSnapshot) => {
    refreshSnapshot();
    navigate(routeForWorkbenchRunSnapshot(started));
  }, [navigate, refreshSnapshot]);
  const routeEvidenceMode = workbenchRouteEvidenceMode(route);
  const routeWantsEvidenceRefresh = Boolean(
    snapshot &&
    actions?.evidenceAccess === "full" &&
    routeEvidenceMode !== "none" &&
    workbenchSnapshotNeedsEvidenceRefresh(snapshot),
  );
  const routeNeedsEvidenceRefresh = routeWantsEvidenceRefresh && routeEvidenceMode === "required";
  const evidenceRefreshSignature = useMemo(() => {
    if (!routeWantsEvidenceRefresh) {
      return null;
    }
    return `${inspectionCursor ?? "no-cursor"}:${route.kind}:${routeEvidenceMode}`;
  }, [inspectionCursor, route.kind, routeEvidenceMode, routeWantsEvidenceRefresh]);
  const [requestedEvidenceRefresh, setRequestedEvidenceRefresh] = useState<string | null>(null);

  useEffect(() => {
    if (!evidenceRefreshSignature || loading || refreshing) {
      return;
    }
    if (requestedEvidenceRefresh === evidenceRefreshSignature) {
      return;
    }
    setRequestedEvidenceRefresh(evidenceRefreshSignature);
    refreshSnapshot();
  }, [
    evidenceRefreshSignature,
    loading,
    refreshSnapshot,
    refreshing,
    requestedEvidenceRefresh,
  ]);

  const header = hideHeader ? null : (
    <WorkbenchShellHeader
      brandHref={brandHref}
      error={error}
      headerControls={headerControls}
      loading={loading}
      onRefresh={refreshSnapshot}
      refreshing={refreshing}
      snapshot={snapshot}
    />
  );
  const routeFeedbackActive = loading || refreshing || routePending || routeLoadingIds.size > 0 || routeWantsEvidenceRefresh;
  const showRouteSidebar = sidebarMode !== "hidden";
  const renderWorkspace = (children: ReactNode) => (
    <RouteLoadingContext.Provider value={reportRouteLoading}>
      <TopLoadingBar active={routeFeedbackActive} />
      <WorkspaceRoot
        header={header}
        headerClassName="px-0 py-0 sm:px-0"
        mainId="main-content"
        skipLinkLabel="Skip to Workbench workspace"
      >
        {children}
      </WorkspaceRoot>
    </RouteLoadingContext.Provider>
  );

  if (error && !snapshot) {
    return renderWorkspace(
      <ProblemState
        icon={CircleAlertIcon}
        title="Workbench snapshot is unavailable"
        message={error}
        scope="workspace"
      />,
    );
  }

  if (!snapshot) {
    return renderWorkspace(
      <ProblemState
        icon={WorkbenchLoadingIcon}
        title="Loading Workbench"
        message="Reading the skill inspection snapshot."
        scope="workspace"
      />,
    );
  }

  return renderWorkspace(
    <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6 sm:py-7">
      <div
        className={cn("mx-auto grid w-full gap-0", WORKBENCH_CONTENT_RAIL_CLASS)}
        style={typeof contentScrollTop === "number" ? { translate: `0 ${-contentScrollTop}px` } : undefined}
      >
        <SkillIdentityHeader
          actions={actions}
          apiBasePath={apiBasePath}
          hrefFor={hrefFor}
          identity={identity}
          identityControls={identityControls}
          onOperationStarted={onOperationStarted}
          onRouteClick={onRouteClick}
          operationPreview={operationPreview}
          snapshot={snapshot}
          hostContext={hostContext}
        />
        <PrimaryTabs route={route} hrefFor={hrefFor} onRouteClick={onRouteClick} />
        <WorkbenchBreadcrumbs
          className="pt-3"
          route={route}
          snapshot={snapshot}
          hrefFor={hrefFor}
          onRouteClick={onRouteClick}
        />
        <div
          className={cn(
            "grid min-w-0 gap-6 pt-6 xl:items-start",
            showRouteSidebar
              ? "xl:grid-cols-[minmax(0,1fr)_280px] xl:gap-8"
              : "xl:grid-cols-1",
          )}
        >
          <main className="min-w-0" data-testid="workbench-primary-content">
            {routeNeedsEvidenceRefresh ? (
              <ProblemState
                icon={WorkbenchLoadingIcon}
                title="Loading evidence"
                message="Reading eval and run details."
                scope="pane"
              />
            ) : (
              <RouteBody
                actions={actions}
                apiBasePath={apiBasePath}
                hrefFor={hrefFor}
                inspectionCursor={inspectionCursor}
                navigate={navigate}
                onRouteClick={onRouteClick}
                progressCursor={progressCursor}
                refreshSnapshot={refreshSnapshot}
                route={route}
                snapshot={snapshot}
                versionHistoryDialog={versionHistoryDialog}
              />
            )}
          </main>
          {showRouteSidebar ? (
            <RouteSidebar
              hostContext={hostContext}
              identity={identity}
              route={route}
              snapshot={snapshot}
            />
          ) : null}
        </div>
      </div>
    </div>,
  );
}

function WorkbenchShellHeader({
  brandHref,
  error,
  headerControls,
  loading,
  onRefresh,
  refreshing,
  snapshot,
}: {
  brandHref: string;
  error: string | null;
  headerControls: ReactNode;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  snapshot: WorkbenchInspectionSnapshot | null;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="border-b border-border/70 px-4 py-3 sm:px-6">
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
      <div className="border-b border-border/50 bg-background px-4 py-2 sm:px-6">
        <div className={cn("mx-auto flex min-w-0 justify-end", WORKBENCH_CONTENT_RAIL_CLASS)}>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {snapshot ? (
              <WorkbenchRunsSummary
                snapshot={snapshot}
                loading={loading}
                refreshing={refreshing}
                error={error}
                onRefresh={onRefresh}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SkillIdentity {
  name: string;
  description: string | null;
  handle: string | null;
}

function useSkillIdentity({
  apiBasePath,
  hostContext,
  snapshot,
}: {
  apiBasePath: string;
  hostContext?: WorkbenchHostContext;
  snapshot: WorkbenchInspectionSnapshot | null;
}): SkillIdentity {
  const fallback = useMemo(() => snapshot
    ? skillIdentity(snapshot, hostContext)
    : {
      name: hostContext?.skillName ?? "Skill",
      description: null,
      handle: hostContext?.handle ?? null,
    }, [hostContext, snapshot]);
  const owner = snapshot ? defaultSourceVersion(snapshot) : null;
  const [hydrated, setHydrated] = useState<SkillIdentity | null>(null);

  useEffect(() => {
    const skillFile = owner?.files.find((file) => file.path === "SKILL.md");
    if (!snapshot || !owner || !skillFile || (fallback.name && fallback.description)) {
      setHydrated(null);
      return;
    }
    const controller = new AbortController();
    let canceled = false;
    void fetch(fileContentApiPath(apiBasePath, "version", owner.id, "SKILL.md"), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await response.text());
        }
        return await response.json() as WorkbenchInspectionFileContent;
      })
      .then((content) => {
        if (canceled || content.encoding === "base64" || typeof content.content !== "string") {
          return;
        }
        setHydrated(skillIdentityFromContent(content.content, snapshot, hostContext));
      })
      .catch((error: unknown) => {
        if (!canceled && !(error instanceof DOMException && error.name === "AbortError")) {
          setHydrated(null);
        }
      });
    return () => {
      canceled = true;
      controller.abort();
    };
  }, [apiBasePath, fallback.description, fallback.name, hostContext, owner, snapshot]);

  return hydrated ?? fallback;
}

function skillIdentity(snapshot: WorkbenchInspectionSnapshot, hostContext?: WorkbenchHostContext): SkillIdentity {
  const owner = defaultSourceVersion(snapshot);
  const skillFile = owner?.files.find((file) => file.path === "SKILL.md");
  const content = skillFile?.content && skillFile.encoding !== "base64" ? skillFile.content : null;
  return skillIdentityFromContent(content, snapshot, hostContext);
}

function skillIdentityFromContent(
  content: string | null | undefined,
  snapshot: WorkbenchInspectionSnapshot,
  hostContext?: WorkbenchHostContext,
): SkillIdentity {
  const frontmatter = content ? parseMarkdownDocument(content).frontmatter : null;
  const name = readFrontmatterScalar(frontmatter, "name") ?? hostContext?.skillName ?? (fileName(snapshot.root) || "Skill");
  return {
    name,
    description: readFrontmatterScalar(frontmatter, "description"),
    handle: hostContext?.handle ?? snapshot.publication?.installHandle ?? null,
  };
}

function readFrontmatterScalar(frontmatter: string | null, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const raw = frontmatter?.match(new RegExp(`^${escapedKey}:\\s*(.+)$`, "mu"))?.[1]?.trim() ?? null;
  if (!raw) {
    return null;
  }
  const unquoted = raw.replace(/^["']|["']$/gu, "").trim();
  return unquoted || null;
}

function splitSkillHandle(handle: string | null | undefined): { owner: string; name: string } | null {
  const value = handle?.trim();
  if (!value) {
    return null;
  }
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }
  return {
    owner: value.slice(0, separator),
    name: value.slice(separator + 1),
  };
}

function SkillIdentityHeader({
  actions,
  apiBasePath,
  hrefFor,
  hostContext,
  identity,
  identityControls,
  onOperationStarted,
  onRouteClick,
  operationPreview,
  snapshot,
}: {
  actions: WorkbenchActionCapabilities | null;
  apiBasePath: string;
  hrefFor: (route: WorkbenchRoute) => string;
  hostContext: WorkbenchHostContext | undefined;
  identity: SkillIdentity;
  identityControls: ReactNode;
  onOperationStarted: (started: WorkbenchRunSnapshot) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  operationPreview?: WorkbenchOperationPreviewState;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const handleParts = splitSkillHandle(identity.handle);
  const ownerLabel = handleParts?.owner ?? hostContext?.ownerSlug ?? null;
  const skillLabel = handleParts?.name ?? identity.name;
  const homeRoute = createFilesRoute();
  return (
    <section className="grid min-w-0 gap-4 border-b border-border/70 pb-5">
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {ownerLabel ? (
                <>
                  {hostContext?.ownerHref ? (
                    <a
                      className="rounded-sm font-mono text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      href={hostContext.ownerHref}
                    >
                      {ownerLabel}
                    </a>
                  ) : (
                    <span className="font-mono text-sm text-muted-foreground">{ownerLabel}</span>
                  )}
                  <span className="text-muted-foreground">/</span>
                </>
              ) : null}
              <h1 className="break-words font-mono text-[1.45rem] font-semibold leading-tight tracking-normal text-foreground [overflow-wrap:anywhere]">
                <a
                  className="rounded-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={hrefFor(homeRoute)}
                  onClick={onRouteClick(homeRoute)}
                >
                  {skillLabel}
                </a>
              </h1>
              {identity.handle ? (
                <CopyIconButton label="handle" value={identity.handle} />
              ) : null}
              {hostContext?.sourceVisibility ? <Badge variant="outline">{hostContext.sourceVisibility}</Badge> : null}
              {hostContext?.evidenceAccess === "source" ? <Badge variant="outline">source only</Badge> : null}
            </div>
            {identityControls ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
                {identityControls}
              </div>
            ) : null}
          </div>
        </div>
        {actions ? (
          <WorkbenchActionBar
            actions={actions}
            apiBasePath={apiBasePath}
            onOperationStarted={onOperationStarted}
            operationPreview={operationPreview}
          />
        ) : null}
      </div>
    </section>
  );
}

function PrimaryTabs({
  hrefFor,
  onRouteClick,
  route,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  route: WorkbenchRoute;
}) {
  const active = routePrimaryTab(route);
  const routeFor = (tab: WorkbenchPrimaryTab): WorkbenchRoute => {
    if (tab === "evaluation") {
      return createEvaluationRoute({ view: "results", evalVersionId: route.kind === "evaluation" || route.kind === "case" ? route.evalVersionId : null });
    }
    if (tab === "runs") {
      return createRunsRoute();
    }
    return createFilesRoute();
  };
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-4 border-b border-border/70" aria-label="Workbench skill tabs">
      {PRIMARY_TABS.map((item) => {
        const nextRoute = routeFor(item.value);
        const Icon = item.icon;
        return (
          <a
            aria-current={active === item.value ? "page" : undefined}
            className={cn(
              "inline-flex h-10 items-center gap-1.5 border-b-2 px-0.5 text-sm font-medium text-muted-foreground no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active === item.value
                ? "border-primary text-foreground"
                : "border-transparent hover:text-foreground",
            )}
            href={hrefFor(nextRoute)}
            key={item.value}
            onClick={onRouteClick(nextRoute)}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

function RouteBody({
  actions,
  apiBasePath,
  hrefFor,
  inspectionCursor,
  navigate,
  onRouteClick,
  progressCursor,
  refreshSnapshot,
  route,
  snapshot,
  versionHistoryDialog,
}: {
  actions: WorkbenchActionCapabilities | null;
  apiBasePath: string;
  hrefFor: (route: WorkbenchRoute) => string;
  inspectionCursor: string | null;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  progressCursor: string | null;
  refreshSnapshot: () => void;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
  versionHistoryDialog?: WorkbenchVersionHistoryDialogState;
}) {
  switch (route.kind) {
    case "files":
      return (
        <FilesSurface
          apiBasePath={apiBasePath}
          navigate={navigate}
          route={route}
          snapshot={snapshot}
          versionHistoryDialog={versionHistoryDialog}
        />
      );
    case "evaluation":
      return (
        <EvaluationSurface
          allowMutations={actions?.evidenceAccess === "full"}
          apiBasePath={apiBasePath}
          hrefFor={hrefFor}
          navigate={navigate}
          onRouteClick={onRouteClick}
          refreshSnapshot={refreshSnapshot}
          route={route}
          snapshot={snapshot}
        />
      );
    case "case":
      return (
        <CaseDetail
          apiBasePath={apiBasePath}
          navigate={navigate}
          route={route}
          snapshot={snapshot}
          hrefFor={hrefFor}
          onRouteClick={onRouteClick}
        />
      );
    case "runs":
      return <RunsSurface route={route} snapshot={snapshot} hrefFor={hrefFor} onRouteClick={onRouteClick} />;
    case "run":
    case "run-job":
      return (
        <RunDetailPage
          apiBasePath={apiBasePath}
          hrefFor={hrefFor}
          inspectionCursor={inspectionCursor}
          onRouteClick={onRouteClick}
          progressCursor={progressCursor}
          route={route}
          snapshot={snapshot}
        />
      );
    case "not-found":
      return (
        <EmptyState
          icon={CircleAlertIcon}
          title="Workbench page not found"
          message="This Workbench web route is not part of the current interface."
          actions={<Button asChild><a href={hrefFor(createFilesRoute())} onClick={onRouteClick(createFilesRoute())}>Open Files</a></Button>}
          variant="hero"
          size="md"
        />
      );
  }
}

function FilesSurface({
  apiBasePath,
  navigate,
  route,
  snapshot,
  versionHistoryDialog,
}: {
  apiBasePath: string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  route: Extract<WorkbenchRoute, { kind: "files" }>;
  snapshot: WorkbenchInspectionSnapshot;
  versionHistoryDialog?: WorkbenchVersionHistoryDialogState;
}) {
  const owner = defaultSourceVersion(snapshot, route.file.versionId);
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
  const files = useMemo(() => authoredSourceFiles(owner.files), [owner.files]);
  return (
    <RepositorySourceSurface
      apiBasePath={apiBasePath}
      file={route.file}
      files={files}
      ownerId={owner.id}
      onFileChange={(nextFile, options) => navigate(withFileRouteState(route, nextFile), options)}
      onVersionChange={(versionId) => navigate(withFileRouteState(route, { versionId }))}
      snapshot={snapshot}
      versionId={owner.id}
      versionHistoryDialog={versionHistoryDialog}
    />
  );
}

function authoredSourceFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  return files
    .filter((file) => {
      try {
        return isWorkbenchPackageSourcePath(file.path);
      } catch {
        return true;
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function RepositorySourceSurface({
  apiBasePath,
  file,
  files,
  onFileChange,
  onVersionChange,
  ownerId,
  snapshot,
  versionId,
  versionHistoryDialog,
}: {
  apiBasePath: string;
  file: WorkbenchFileRouteState;
  files: readonly SurfaceSnapshotFile[];
  ownerId: string;
  onFileChange: (file: Partial<WorkbenchFileRouteState>, options?: { replace?: boolean }) => void;
  onVersionChange: (versionId: string) => void;
  snapshot: WorkbenchInspectionSnapshot;
  versionId: string;
  versionHistoryDialog?: WorkbenchVersionHistoryDialogState;
}) {
  const reportRouteLoading = useRouteLoadingReporter();

  if (files.length === 0) {
    return (
      <EmptyState
        icon={FolderOpenIcon}
        title="No authored files"
        message="Authored source appears here once Workbench observes files for this skill version."
        size="sm"
      />
    );
  }

  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <VersionHistoryDialog
            controlledState={versionHistoryDialog}
            snapshot={snapshot}
            value={versionId}
            onValueChange={onVersionChange}
          />
          <VersionSelect
            snapshot={snapshot}
            value={versionId}
            onValueChange={onVersionChange}
          />
        </div>
      </div>

      <RepositoryFilesView
        apiBasePath={apiBasePath}
        file={file}
        files={files}
        ownerId={ownerId}
        ownerKind="version"
        repositoryLabel="Files"
        onFileChange={onFileChange}
        onLoadingChange={reportRouteLoading}
      />
    </div>
  );
}

function VersionHistoryDialog({
  controlledState,
  onValueChange,
  snapshot,
  value,
}: {
  controlledState?: WorkbenchVersionHistoryDialogState;
  onValueChange: (versionId: string) => void;
  snapshot: WorkbenchInspectionSnapshot;
  value: string;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [uncontrolledView, setUncontrolledView] = useState<WorkbenchVersionHistoryView>("list");
  const open = controlledState?.open ?? uncontrolledOpen;
  const view = controlledState?.view ?? uncontrolledView;
  const setOpen = controlledState?.open === undefined ? setUncontrolledOpen : () => undefined;
  const setView = controlledState?.view === undefined ? setUncontrolledView : () => undefined;
  const selectVersion = (versionId: string) => {
    onValueChange(versionId);
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <HistoryIcon aria-hidden="true" />
          Version history
        </Button>
      </DialogTrigger>
      <DialogContent className={VERSION_HISTORY_DIALOG_CONTENT_CLASS}>
        <WorkbenchVersionHistoryDialogContent
          dialogSemantics
          initialLineageFlow={controlledState?.initialLineageFlow}
          onValueChange={selectVersion}
          onViewChange={setView}
          snapshot={snapshot}
          value={value}
          view={view}
        />
      </DialogContent>
    </Dialog>
  );
}

export function WorkbenchVersionHistoryDialogSurface({
  className,
  graphClassName,
  initialLineageFlow,
  onValueChange,
  onViewChange,
  snapshot,
  value,
  view,
}: WorkbenchVersionHistoryDialogSurfaceProps) {
  return (
    <div className={cn(VERSION_HISTORY_DIALOG_SURFACE_CLASS, className)}>
      <WorkbenchVersionHistoryDialogContent
        graphClassName={graphClassName}
        initialLineageFlow={initialLineageFlow}
        onValueChange={onValueChange}
        onViewChange={onViewChange}
        snapshot={snapshot}
        value={value}
        view={view}
      />
      <Button
        aria-hidden="true"
        className="absolute right-2 top-2"
        size="icon-sm"
        tabIndex={-1}
        type="button"
        variant="ghost"
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  );
}

function WorkbenchVersionHistoryDialogContent({
  dialogSemantics = false,
  graphClassName,
  initialLineageFlow,
  onValueChange,
  onViewChange,
  snapshot,
  value,
  view,
}: WorkbenchVersionHistoryDialogSurfaceProps & { dialogSemantics?: boolean }) {
  return (
    <>
      <DialogHeader className="shrink-0 gap-3 border-b border-border/70 px-4 pb-3 pt-4 pr-12">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {dialogSemantics ? (
            <>
              <DialogTitle>Version history</DialogTitle>
              <DialogDescription className="sr-only">
                Review version history and lineage for this skill.
              </DialogDescription>
            </>
          ) : (
            <>
              <h3 className="font-heading text-base font-medium leading-none">
                Version history
              </h3>
              <p className="sr-only">
                Review version history and lineage for this skill.
              </p>
            </>
          )}
          <ViewSwitch
            ariaLabel="Version history views"
            value={view}
            items={VERSION_HISTORY_VIEW_ITEMS}
            onValueChange={(nextView) => {
              if (nextView === "list" || nextView === "lineage") {
                onViewChange(nextView);
              }
            }}
          />
        </div>
      </DialogHeader>
      {view === "lineage" ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <LineageGraph
            className={cn("min-h-0 rounded-none border-0", graphClassName)}
            currentVersionId={value}
            initialFlow={initialLineageFlow}
            publishedVersionId={publishedVersionId(snapshot)}
            lineage={snapshot.lineage}
            versions={snapshot.versions}
            runs={snapshot.runs}
            jobs={snapshot.jobs}
            onVersionClick={onValueChange}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <VersionHistory
            snapshot={snapshot}
            value={value}
            onValueChange={onValueChange}
          />
        </div>
      )}
    </>
  );
}

function VersionSelect({
  onValueChange,
  snapshot,
  value,
}: {
  onValueChange: (versionId: string) => void;
  snapshot: WorkbenchInspectionSnapshot;
  value: string;
}) {
  const publishedId = publishedVersionId(snapshot);
  const options = orderedVersions(snapshot).map((version) => {
    const subtitles = [
      snapshot.status.currentVersionId === version.id ? "current" : null,
      publishedId === version.id ? "published" : null,
      formatTimestamp(version.createdAt),
    ].filter(Boolean);
    return {
      id: version.id,
      label: versionNameFor(snapshot, version.id),
      subtitle: subtitles.join(" / "),
    };
  });
  const selectedOption = options.find((option) => option.id === value);
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="sm"
        aria-label="Select version"
        data-testid="version-select"
      >
        <SelectValue placeholder="Version">{selectedOption?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="min-w-64">
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id} textValue={option.label}>
            <span className="grid min-w-0 gap-0.5">
              <span>{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.subtitle}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function VersionHistory({
  onValueChange,
  snapshot,
  value,
}: {
  onValueChange: (versionId: string) => void;
  snapshot: WorkbenchInspectionSnapshot;
  value: string;
}) {
  const publishedId = publishedVersionId(snapshot);
  const versions = orderedVersions(snapshot);
  return (
    <div className="grid min-w-0 gap-2">
      {versions.map((version) => {
        const active = value === version.id;
        const current = snapshot.status.currentVersionId === version.id;
        return (
          <button
            key={version.id}
            type="button"
            aria-current={active ? "true" : undefined}
            className={cn(
              "grid min-w-0 cursor-pointer gap-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active && "border-primary/50 bg-muted/45",
            )}
            onClick={() => onValueChange(version.id)}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-medium">{versionNameFor(snapshot, version.id)}</span>
              {active ? <Badge variant="outline">selected</Badge> : null}
              {current ? <Badge variant="outline">current</Badge> : null}
              {publishedId === version.id ? <Badge variant="outline">published</Badge> : null}
            </div>
            <span className="break-words text-muted-foreground [overflow-wrap:anywhere]">{version.message}</span>
            <span className="text-xs text-muted-foreground">{formatTimestamp(version.createdAt)}</span>
          </button>
        );
      })}
    </div>
  );
}

function EvaluationSurface({
  allowMutations,
  apiBasePath,
  hrefFor,
  navigate,
  onRouteClick,
  refreshSnapshot,
  route,
  snapshot,
}: {
  allowMutations: boolean;
  apiBasePath: string;
  hrefFor: (route: WorkbenchRoute) => string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  refreshSnapshot: () => void;
  route: Extract<WorkbenchRoute, { kind: "evaluation" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const results = resultsForScorecard(snapshot);
  const evaluationOptions = evalVersionOptionsForResults(snapshot, results);
  const defaultEvaluationId = defaultEvalVersionIdForResults(evaluationOptions);
  const activeEvaluationId = route.evalVersionId && evaluationOptions.some((option) => option.id === route.evalVersionId)
    ? route.evalVersionId
    : defaultEvaluationId;
  const labelContext = resultLabelContext(snapshot);
  const groups = buildResultGroups(results, labelContext);
  const rows = buildResultEvidenceRows({
    groups,
    context: labelContext,
    agents: results.agentVersions,
    runs: snapshot.runs,
  });
  const visibleRows = activeEvaluationId
    ? rows.filter((row) => row.evalVersionId === activeEvaluationId)
    : rows;
  const selectedEvaluation = activeEvaluationId
    ? evaluationOptions.find((option) => option.id === activeEvaluationId) ?? null
    : null;
  const showEvaluationSelector = evaluationOptions.length > 0 && typeof activeEvaluationId === "string";
  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ViewSwitch
          ariaLabel="Eval views"
          value={route.view}
          items={EVALUATION_VIEW_ITEMS}
          onValueChange={(value) => {
            if (value === "results" || value === "cases") {
              navigate(createEvaluationRoute({ view: value, evalVersionId: activeEvaluationId ?? route.evalVersionId }));
            }
          }}
        />
        {showEvaluationSelector ? (
          <EvaluationSelect
            options={evaluationOptions}
            value={activeEvaluationId}
            onValueChange={(evalVersionId) => navigate(withEvalVersionId(route, evalVersionId), { replace: false })}
          />
        ) : null}
      </div>
      {route.view === "cases" ? (
        <EvaluationCases
          allowMutations={allowMutations}
          apiBasePath={apiBasePath}
          evalVersionId={activeEvaluationId}
          hrefFor={hrefFor}
          onRouteClick={onRouteClick}
          refreshSnapshot={refreshSnapshot}
          snapshot={snapshot}
        />
      ) : (
        <EvaluationResults
          evalVersionId={activeEvaluationId}
          hasResults={results.cells.length > 0}
          hrefFor={hrefFor}
          onRouteClick={onRouteClick}
          rows={visibleRows}
          selectedEvaluation={selectedEvaluation}
          snapshot={snapshot}
        />
      )}
    </div>
  );
}

/**
 * Build the sorted scorecard result rows for a snapshot, mirroring what the
 * Evaluation -> Results view renders. By default it returns rows for the
 * snapshot's default eval; pass `evalVersionId` to select a specific one,
 * or `null` for all.
 */
export function buildEvaluationResultRows(
  snapshot: WorkbenchInspectionSnapshot,
  options: { evalVersionId?: string | null } = {},
): ResultEvidenceRow[] {
  const results = resultsForScorecard(snapshot);
  const context = resultLabelContext(snapshot);
  const groups = buildResultGroups(results, context);
  const rows = sortLeaderboardRows(
    buildResultEvidenceRows({
      groups,
      context,
      agents: results.agentVersions,
      runs: snapshot.runs,
    }),
  );
  const evalVersionId = "evalVersionId" in options
    ? options.evalVersionId
    : defaultEvalVersionIdForResults(evalVersionOptionsForResults(snapshot, results));
  return evalVersionId ? rows.filter((row) => row.evalVersionId === evalVersionId) : rows;
}

function EvaluationResults({
  evalVersionId,
  hasResults,
  hrefFor,
  onRouteClick,
  rows,
  selectedEvaluation,
  snapshot,
}: {
  evalVersionId: string | null;
  hasResults: boolean;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  rows: ResultEvidenceRow[];
  selectedEvaluation: ResultEvalVersionOption | null;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const sortedRows = useMemo(() => sortLeaderboardRows(rows), [rows]);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ActivityIcon}
        eyebrow={selectedEvaluation?.label ?? "Eval"}
        title={hasResults ? "No results for this eval" : "No runs yet"}
        message={hasResults
          ? "This eval has no recorded scorecard rows."
          : "Run evals to record results."}
        variant="hero"
        size="sm"
      />
    );
  }
  return (
    <section className="grid min-w-0 gap-4" aria-label="Results">
      <EvaluationResultsVisualSummary rows={sortedRows} />
      <EvaluationLeaderboard
        evalVersionId={evalVersionId}
        hrefFor={hrefFor}
        onRouteClick={onRouteClick}
        rows={sortedRows}
        snapshot={snapshot}
      />
    </section>
  );
}

export function EvaluationLeaderboard({
  evalVersionId = null,
  hrefFor,
  maxRows,
  onRouteClick,
  rows,
  snapshot,
}: {
  evalVersionId?: string | null;
  hrefFor?: (route: WorkbenchRoute) => string;
  maxRows?: number;
  onRouteClick?: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  rows: ResultEvidenceRow[];
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const sorted = useMemo(() => sortLeaderboardRows(rows), [rows]);
  const visible = useMemo(
    () => (typeof maxRows === "number" ? sorted.slice(0, maxRows) : sorted),
    [maxRows, sorted],
  );
  const groups = useMemo(() => buildLeaderboardGroups(visible), [visible]);
  const runsById = useMemo(
    () => new Map(snapshot.runs.map((run) => [run.id, run])),
    [snapshot.runs],
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
      <Table data-testid="evaluation-results-leaderboard" className="min-w-[42rem]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[18rem]">Measurement</TableHead>
            <TableHead className="w-[7rem]">Quality</TableHead>
            <TableHead className="w-[8.5rem]">Latency</TableHead>
            <TableHead className="w-[8.5rem]">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <Fragment key={group.id}>
              <TableRow data-testid="evaluation-results-version-group" className="hover:bg-transparent">
                <TableCell colSpan={4} className="bg-muted/35 py-2 font-medium text-foreground">
                  <span className="break-words [overflow-wrap:anywhere]">
                    {group.label}
                  </span>
                </TableCell>
              </TableRow>
              {group.rows.map((row) => {
                const run = row.runId ? runsById.get(row.runId) ?? null : null;
                const latencyMetric = formatReportMetricStack(row.report, "latency", formatDurationMs);
                const costMetric = formatReportMetricStack(
                  row.report,
                  "cost",
                  formatCost,
                  missingCostLabelForStatus(row.statusLabel, Boolean(row.runId)),
                );
                const runRoute = hrefFor && onRouteClick && row.runId
                  ? createRunRoute({ runId: row.runId })
                  : null;
                return (
                  <TableRow
                    key={row.rowId}
                    className={runRoute ? "cursor-pointer" : undefined}
                    onClick={runRoute ? onRouteClick?.(runRoute) : undefined}
                  >
                    <TableCell className="align-top">
                      {runRoute && hrefFor ? (
                        <a
                          className="break-words font-medium text-primary underline-offset-4 hover:underline [overflow-wrap:anywhere]"
                          href={hrefFor(runRoute)}
                          onClick={onRouteClick?.(runRoute)}
                        >
                          {row.agentDetail}
                        </a>
                      ) : (
                        <span className="break-words text-muted-foreground [overflow-wrap:anywhere]">
                          {row.agentDetail}
                        </span>
                      )}
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                        {row.status ? (
                          <StatusBadge status={row.status} />
                        ) : (
                          <Badge variant="outline">{row.statusLabel}</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">{formatCoverage(row.coverage)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top font-medium">{formatQualityMetric(row.score)}</TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      <MetricStack
                        value={latencyMetric.value}
                        detail={latencyMetric.detail}
                      />
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      <MetricStack
                        value={costMetric.value}
                        detail={costMetric.detail}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface LeaderboardGroup {
  id: string;
  label: string;
  rows: ResultEvidenceRow[];
}

function buildLeaderboardGroups(rows: readonly ResultEvidenceRow[]): LeaderboardGroup[] {
  const rowsByGroup = new Map<string, ResultEvidenceRow[]>();
  const groupLabels = new Map<string, string>();
  for (const row of rows) {
    const groupId = resultVersionGroupId(row);
    const groupRows = rowsByGroup.get(groupId);
    if (groupRows) {
      groupRows.push(row);
    } else {
      rowsByGroup.set(groupId, [row]);
      groupLabels.set(groupId, row.versionLabel);
    }
  }
  return [...rowsByGroup.entries()].map(([id, groupRows]) => ({
    id,
    label: groupLabels.get(id) ?? groupRows[0]?.versionLabel ?? id,
    rows: groupRows,
  }));
}

function EvaluationSelect({
  onValueChange,
  options,
  value,
}: {
  onValueChange: (evalVersionId: string) => void;
  options: ResultEvalVersionOption[];
  value: string;
}) {
  const selectedOption = options.find((option) => option.id === value);
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="sm"
        aria-label="Select eval"
        data-testid="evaluation-select"
      >
        <SelectValue placeholder="Eval">{selectedOption?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="min-w-64">
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id} textValue={option.label}>
            <span className="grid min-w-0 gap-0.5">
              <span>{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.subtitle}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function sortLeaderboardRows(rows: readonly ResultEvidenceRow[]): ResultEvidenceRow[] {
  return [...rows].sort((left, right) =>
    compareOptionalNumber(left.score, right.score, "desc") ||
    compareOptionalNumber(left.latencyPerSampleMs, right.latencyPerSampleMs, "asc") ||
    compareOptionalNumber(left.versionOrdinal, right.versionOrdinal, "desc") ||
    compareText(left.setupLabel, right.setupLabel) ||
    compareText(left.agentName, right.agentName) ||
    compareText(left.rowId, right.rowId)
  );
}

function MetricStack({
  detail,
  value,
}: {
  detail?: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <div className="break-words font-medium text-foreground [overflow-wrap:anywhere]">{value}</div>
      {detail ? <div className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{detail}</div> : null}
    </div>
  );
}

function formatQualityMetric(score: number | undefined): string {
  return score === undefined ? "n/a" : `score ${formatScore(score)}`;
}

function formatCoverage(coverage: WorkbenchSampleCoverage | undefined): string {
  if (coverage && Number.isFinite(coverage.planned) && coverage.planned > 0) {
    return `${coverage.completed} / ${coverage.planned} samples`;
  }
  return "No measured samples";
}

type ReportMetricValueKind = "perSample" | "total";

interface ReportMetricLine {
  label: string;
  value: string;
}

function formatReportMetricStack(
  report: WorkbenchJobReport | undefined,
  metric: WorkbenchReportMetricKind,
  formatter: (value: number) => string,
  missingValue: ReactNode = "n/a",
): { detail?: ReactNode; value: ReactNode } {
  const breakdown = workbenchJobReportMetricBreakdown(report, metric);
  const details = breakdown.details.filter((entry) => entry.scope !== "total");
  const valueKind = reportMetricValueKind(breakdown.primary?.value, details);
  const value = formatMetricValueForKind(breakdown.primary?.value, valueKind, formatter)
    ?? (valueKind === "perSample" ? formatMetricValueForKind(breakdown.primary?.value, "total", formatter) : undefined)
    ?? missingValue;
  const detailLines = details.flatMap((entry): ReportMetricLine[] => {
    const lineValue = formatMetricValueForKind(entry.value, valueKind, formatter)
      ?? (valueKind === "perSample" ? formatMetricValueForKind(entry.value, "total", formatter) : undefined);
    return lineValue ? [{ label: entry.label, value: lineValue }] : [];
  });
  return {
    value,
    ...(detailLines.length > 0 ? { detail: <ReportMetricLines lines={detailLines} /> } : {}),
  };
}

function formatReportMetricTotal(
  report: WorkbenchJobReport | undefined,
  metric: WorkbenchReportMetricKind,
  formatter: (value: number) => string,
  missingValue = "n/a",
): string {
  return formatMetricValueForKind(
    workbenchJobReportMetricBreakdown(report, metric).total?.value,
    "total",
    formatter,
  ) ?? missingValue;
}

function reportMetricValueKind(
  primary: { perSample?: number; total?: number } | undefined,
  details: readonly { value: { perSample?: number; total?: number } }[],
): ReportMetricValueKind {
  if (primary?.perSample !== undefined || details.some((detail) => detail.value.perSample !== undefined)) {
    return "perSample";
  }
  return "total";
}

function ReportMetricLines({ lines }: { lines: readonly ReportMetricLine[] }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      {lines.map((line) => (
        <div
          className="break-words [overflow-wrap:anywhere]"
          key={`${line.label}:${line.value}`}
        >
          <span>{line.label}</span>{" "}
          <span className="font-mono tabular-nums">{line.value}</span>
        </div>
      ))}
    </div>
  );
}

function formatMetricValueForKind(
  value: { perSample?: number; total?: number } | undefined,
  kind: ReportMetricValueKind,
  formatter: (value: number) => string,
): string | undefined {
  const numeric = kind === "perSample" ? value?.perSample : value?.total;
  const formatted = formatFiniteMetricValue(numeric, formatter);
  if (!formatted) {
    return undefined;
  }
  return kind === "perSample" ? `${formatted}/sample` : `${formatted} total`;
}

function formatFiniteMetricValue(
  value: number | undefined,
  formatter: (value: number) => string,
): string | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? formatter(value)
    : undefined;
}

function compareOptionalNumber(
  left: number | undefined,
  right: number | undefined,
  direction: "asc" | "desc",
): number {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return direction === "asc" ? left - right : right - left;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function EvaluationCases({
  allowMutations,
  apiBasePath,
  evalVersionId: selectedEvalVersionId,
  hrefFor,
  onRouteClick,
  refreshSnapshot,
  snapshot,
}: {
  allowMutations: boolean;
  apiBasePath: string;
  evalVersionId: string | null;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  refreshSnapshot: () => void;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const evalSnapshot = selectedEvalSnapshot(snapshot, selectedEvalVersionId);
  const resolvedEvalVersionId = evalSnapshot
    ? evalVersionIdForHash(snapshot, evalSnapshot.hash) ?? selectedEvalVersionId ?? evalSnapshot.hash
    : null;
  const matrixColumns = useMemo(
    () => evalSnapshot && resolvedEvalVersionId ? buildCaseMatrixColumns(snapshot, resolvedEvalVersionId) : [],
    [evalSnapshot, resolvedEvalVersionId, snapshot],
  );
  if (!evalSnapshot) {
    return (
      <EmptyState
        icon={FileTextIcon}
        title="No cases"
        message="Add a case to start building the eval matrix."
        variant="hero"
        size="sm"
      />
    );
  }
  return (
    <EvaluationCaseMatrix
      apiBasePath={apiBasePath}
      allowMutations={allowMutations}
      columns={matrixColumns}
      evalSnapshot={evalSnapshot}
      evalVersionId={resolvedEvalVersionId ?? evalSnapshot.hash}
      hrefFor={hrefFor}
      onRouteClick={onRouteClick}
      refreshSnapshot={refreshSnapshot}
      snapshot={snapshot}
    />
  );
}

function EvaluationTraceSteps({
  caseResult,
  prompt,
}: {
  caseResult: WorkbenchRunEvidenceCaseResult | null;
  prompt: string;
}) {
  const steps: Array<{ detail?: string; durationMs?: number; label: string; status?: string }> = [
    { label: "Task prompt", detail: prompt },
  ];
  if (caseResult?.execute) {
    steps.push({
      label: "Agent response",
      status: caseResult.execute.status,
      durationMs: caseResult.execute.durationMs,
      detail: caseResult.execute.error,
    });
  }
  if (caseResult?.grade) {
    steps.push({
      label: "Grade",
      status: caseResult.grade.status,
      durationMs: caseResult.grade.durationMs,
      detail: caseResult.grade.error,
    });
  }
  if (caseResult) {
    steps.push({
      label: "Final output captured",
      status: caseResult.status,
      detail: caseResult.error,
    });
  }
  return (
    <div className="grid min-w-0 gap-2">
      {steps.map((step) => (
        <div key={`${step.label}:${step.status ?? ""}`} className="grid min-w-0 gap-1 border-b border-border/60 pb-2 last:border-b-0 last:pb-0">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="size-1.5 rounded-full bg-primary" />
              <span className="text-sm font-medium text-foreground">{step.label}</span>
            </div>
            {step.durationMs !== undefined ? <span className="text-xs text-muted-foreground">{formatDurationMs(step.durationMs)}</span> : null}
          </div>
          {step.detail ? (
            <p className="break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{step.detail}</p>
          ) : step.status ? (
            <p className="text-xs leading-5 text-muted-foreground">{step.status}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

interface CaseMatrixColumn {
  agentDetail: string;
  id: string;
  evidence?: WorkbenchRunEvidenceView;
  run?: WorkbenchRun;
  target: WorkbenchOperationTarget;
  versionLabel: string;
}

function EvaluationCaseMatrix({
  apiBasePath,
  allowMutations,
  columns,
  evalSnapshot,
  evalVersionId,
  hrefFor,
  onRouteClick,
  refreshSnapshot,
  snapshot,
}: {
  apiBasePath: string;
  allowMutations: boolean;
  columns: CaseMatrixColumn[];
  evalSnapshot: WorkbenchEvalSnapshot;
  evalVersionId: string;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  refreshSnapshot: () => void;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const allColumnIds = useMemo(() => columns.map(caseMatrixColumnId), [columns]);
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(allColumnIds);
  const [selectedCell, setSelectedCell] = useState<{ caseId: string; columnId: string } | null>(null);
  const [addCaseOpen, setAddCaseOpen] = useState(false);

  useEffect(() => {
    setVisibleColumnIds((current) => {
      const retained = current.filter((id) => allColumnIds.includes(id));
      if (retained.length > 0) {
        return retained;
      }
      return allColumnIds;
    });
  }, [allColumnIds]);

  const displayColumns = columns.filter((column) => visibleColumnIds.includes(caseMatrixColumnId(column)));
  const hiddenColumnId = allColumnIds.find((id) => !visibleColumnIds.includes(id));
  const selectedColumn = selectedCell
    ? columns.find((column) => caseMatrixColumnId(column) === selectedCell.columnId) ?? null
    : null;
  const selectedCase = selectedCell
    ? evalSnapshot.cases.find((evalCase) => evalCase.id === selectedCell.caseId) ?? null
    : null;

  function removeColumn(columnId: string) {
    setVisibleColumnIds((current) => {
      if (current.length <= 1) {
        return current;
      }
      return current.filter((id) => id !== columnId);
    });
  }

  function revealHiddenColumn() {
    if (hiddenColumnId) {
      setVisibleColumnIds((current) => allColumnIds.filter((id) => id === hiddenColumnId || current.includes(id)));
    }
  }

  return (
    <section className="min-w-0" aria-label="Cases matrix">
      <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
        <Table className="min-w-[62rem] table-fixed">
          <TableHeader>
            <TableRow className="bg-muted/25 hover:bg-muted/25">
              <TableHead className="h-16 w-[20rem] px-4 text-sm font-medium">Input</TableHead>
              {displayColumns.map((column, columnIndex) => (
                <TableHead
                  className="h-16 w-[13rem] border-l border-border/70 px-4 align-top whitespace-normal"
                  key={caseMatrixColumnId(column)}
                >
                  <CaseMatrixColumnHeader
                    canRemove={displayColumns.length > 1}
                    column={column}
                    columnIndex={columnIndex}
                    onRemove={() => removeColumn(caseMatrixColumnId(column))}
                  />
                </TableHead>
              ))}
              <TableHead className="h-16 w-14 border-l border-border/70 p-0 align-middle">
                <button
                  aria-label="Add configuration"
                  className="flex h-full w-full items-center justify-center text-lg font-medium text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"
                  disabled={!hiddenColumnId}
                  title={hiddenColumnId ? "Add configuration" : "All configurations shown"}
                  type="button"
                  onClick={revealHiddenColumn}
                >
                  +
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {evalSnapshot.cases.map((evalCase) => {
              const caseRoute = createCaseRoute({ caseId: evalCase.id, evalVersionId: evalVersionId });
              return (
                <TableRow className="hover:bg-transparent" key={evalCase.id}>
                  <TableCell className="relative h-full p-0 align-top whitespace-normal">
                    <a
                      aria-label={`Open ${caseDisplayTitle(evalCase)}`}
                      className="absolute inset-0 z-10 no-underline transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      href={hrefFor(caseRoute)}
                      onClick={onRouteClick(caseRoute)}
                    />
                    <div className="pointer-events-none relative z-0 min-h-40 px-4 py-5">
                      <CaseMatrixInputContent evalCase={evalCase} />
                    </div>
                  </TableCell>
                  {displayColumns.map((column) => (
                    <TableCell
                      className="relative h-full border-l border-border/70 p-0 align-top whitespace-normal"
                      key={`${evalCase.id}:${caseMatrixColumnId(column)}`}
                    >
                      <CaseMatrixCell
                        allowMutations={allowMutations}
                        caseId={evalCase.id}
                        column={column}
                        onInspect={() => setSelectedCell({ caseId: evalCase.id, columnId: caseMatrixColumnId(column) })}
                      />
                    </TableCell>
                  ))}
                  <TableCell className="border-l border-border/70 p-0 align-top whitespace-normal" />
                </TableRow>
              );
            })}
            {allowMutations ? (
              <TableRow className="hover:bg-transparent">
                <TableCell className="p-0 align-top whitespace-normal">
                  <CaseMatrixAddCaseControl
                    onClick={() => setAddCaseOpen(true)}
                  />
                </TableCell>
                {displayColumns.map((column) => (
                  <TableCell
                    className="border-l border-border/70 p-0 align-top whitespace-normal"
                    key={`add-case:${caseMatrixColumnId(column)}`}
                  />
                ))}
                <TableCell className="border-l border-border/70 p-0 align-top whitespace-normal" />
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      {allowMutations ? (
        <CaseMatrixAddCaseDialog
          apiBasePath={apiBasePath}
          open={addCaseOpen}
          refreshSnapshot={refreshSnapshot}
          onOpenChange={setAddCaseOpen}
        />
      ) : null}
      {selectedCase && selectedColumn ? (
        <CaseMatrixCellDialog
          apiBasePath={apiBasePath}
          allowMutations={allowMutations}
          column={selectedColumn}
          evalCase={selectedCase}
          evalVersionId={evalVersionId}
          hrefFor={hrefFor}
          open={Boolean(selectedCell)}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedCell(null);
            }
          }}
          onRouteClick={onRouteClick}
          refreshSnapshot={refreshSnapshot}
          snapshot={snapshot}
        />
      ) : null}
    </section>
  );
}

function CaseMatrixInputContent({ evalCase }: { evalCase: WorkbenchEvalCaseSnapshot }) {
  return (
    <div className="grid min-w-0 gap-3">
      <div className="font-medium text-primary">{caseDisplayTitle(evalCase)}</div>
      {showCaseSecondaryId(evalCase) ? (
        <div className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{evalCase.id}</div>
      ) : null}
      {evalCase.description ? (
        <p className="line-clamp-3 break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
          {evalCase.description}
        </p>
      ) : evalCase.command ? (
        <p className="line-clamp-3 break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
          {evalCase.command}
        </p>
      ) : null}
      <GradePlanCompact evalCase={evalCase} />
    </div>
  );
}

function CaseMatrixAddCaseControl({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <button
      aria-label="Add case"
      className="flex h-14 w-full items-center gap-2 px-4 text-left text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title="Add case"
      type="button"
      onClick={onClick}
    >
      <span aria-hidden="true" className="text-lg leading-none">+</span>
      <span>Add case</span>
    </button>
  );
}

function CaseMatrixAddCaseDialog({
  apiBasePath,
  open,
  onOpenChange,
  refreshSnapshot,
}: {
  apiBasePath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refreshSnapshot: () => void;
}) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [expected, setExpected] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setPrompt("");
      setExpected("");
      setError(null);
      setPending(false);
    }
  }, [open]);

  async function submit() {
    if (!prompt.trim() || pending) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await createEvaluationCase(apiBasePath, {
        ...(title.trim() ? { title: title.trim() } : {}),
        prompt: prompt.trim(),
        ...(expected.trim() ? { expected: expected.trim() } : {}),
      });
      refreshSnapshot();
      onOpenChange(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add case</DialogTitle>
          <DialogDescription>Create a source-backed case row in this evaluation.</DialogDescription>
        </DialogHeader>
        <form
          className="grid min-w-0 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid min-w-0 gap-2">
            <span className="text-sm font-medium text-foreground">Title</span>
            <input
              aria-label="Case title"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </div>
          <div className="grid min-w-0 gap-2">
            <span className="text-sm font-medium text-foreground">Prompt</span>
            <textarea
              aria-label="Case prompt"
              className="min-h-32 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
            />
          </div>
          <div className="grid min-w-0 gap-2">
            <span className="text-sm font-medium text-foreground">Expected</span>
            <textarea
              aria-label="Expected result"
              className="min-h-20 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={expected}
              onChange={(event) => setExpected(event.currentTarget.value)}
            />
          </div>
          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm leading-5 text-destructive">
              {error}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!prompt.trim() || pending}>
              {pending ? "Adding" : "Add case"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CaseMatrixCellDialog({
  apiBasePath,
  allowMutations,
  column,
  evalCase,
  evalVersionId,
  hrefFor,
  onOpenChange,
  onRouteClick,
  open,
  refreshSnapshot,
  snapshot,
}: {
  apiBasePath: string;
  allowMutations: boolean;
  column: CaseMatrixColumn;
  evalCase: WorkbenchEvalCaseSnapshot;
  evalVersionId: string;
  hrefFor: (route: WorkbenchRoute) => string;
  onOpenChange: (open: boolean) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  open: boolean;
  refreshSnapshot: () => void;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const related = useMemo(
    () => caseMatrixRelatedResults(snapshot, evalCase.id, column),
    [column, evalCase.id, snapshot],
  );
  const current = related[0] ?? null;
  const canGrade = Boolean(current?.caseResult.execute?.status === "succeeded");
  const [pending, setPending] = useState<"run" | "eval" | "grade" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prompt = evalCase.description ?? evalCase.command ?? evalCase.id;

  async function startCellOperation(mode: "run" | "eval" | "grade") {
    if (pending) {
      return;
    }
    const phases = mode === "run"
      ? ["execute"] as const
      : mode === "grade"
        ? ["grade"] as const
        : ["execute", "grade"] as const;
    const request: WorkbenchOperationRequest = {
      kind: "eval",
      variant: "local",
      caseIds: [evalCase.id],
      targets: [column.target],
      phases,
      grader: mode === "run" ? { kind: "none" } : { kind: "evaluation" },
      samples: 1,
      ...(mode === "grade" && current?.run ? { gradeOfRunId: current.run.id } : {}),
    };
    setPending(mode);
    setError(null);
    try {
      await startWorkbenchOperation(apiBasePath, request);
      refreshSnapshot();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{caseDisplayTitle(evalCase)}</DialogTitle>
          <DialogDescription>{caseMatrixColumnLabel(column)} / {caseMatrixColumnDetail(column)}</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-4">
          {allowMutations ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button type="button" size="sm" disabled={Boolean(pending)} onClick={() => void startCellOperation("run")}>
                <PlayCircleIcon aria-hidden="true" data-icon="inline-start" />
                {pending === "run" ? "Running" : "Run"}
              </Button>
              <Button type="button" size="sm" disabled={Boolean(pending)} onClick={() => void startCellOperation("eval")}>
                <CheckIcon aria-hidden="true" data-icon="inline-start" />
                {pending === "eval" ? "Running" : "Run + grade"}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={!canGrade || Boolean(pending)} onClick={() => void startCellOperation("grade")}>
                {pending === "grade" ? "Grading" : "Grade latest"}
              </Button>
            </div>
          ) : null}
          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm leading-5 text-destructive">
              {error}
            </div>
          ) : null}
          {current ? (
            <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
              <section className="grid min-w-0 gap-3 rounded-lg border border-border/70 p-4" aria-label="Current output">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <CheckIcon aria-hidden="true" className="size-3.5 text-success" />
                    Final output
                  </div>
                  {current.caseResult.score !== undefined ? <Badge variant="outline">{formatQualityMetric(current.caseResult.score)}</Badge> : <StatusBadge status={current.caseResult.status} />}
                </div>
                <p className="break-words text-sm leading-6 text-foreground [overflow-wrap:anywhere]">
                  {caseResultFinalOutput(snapshot, current.caseResult)}
                </p>
                <EvaluationTraceSteps caseResult={current.caseResult} prompt={prompt} />
              </section>
              <section className="grid h-max min-w-0 gap-2 rounded-lg border border-border/70 p-4" aria-label="Run history">
                <div className="text-sm font-medium text-foreground">{formatCount(related.length, "run")}</div>
                <div className="grid min-w-0 gap-2">
                  {related.map(({ run, caseResult }) => {
                    const route = createRunCaseRoute({
                      caseResult,
                      phase: defaultRunCasePhase(caseResult),
                      runId: run.id,
                      view: "output",
                    });
                    return (
                      <a
                        className="grid min-w-0 gap-1 rounded-md border border-border/60 px-3 py-2 text-sm no-underline transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        href={hrefFor(route)}
                        key={`${run.id}:${runCaseResultKey(caseResult)}`}
                        onClick={onRouteClick(route)}
                      >
                        <span className="flex min-w-0 items-center justify-between gap-2">
                          <StatusBadge status={caseResult.status} />
                          <span className="text-xs text-muted-foreground">{formatTimestamp(run.finishedAt ?? run.createdAt)}</span>
                        </span>
                        <span className="truncate text-xs text-muted-foreground">{formatQualityMetric(caseResult.score)}</span>
                      </a>
                    );
                  })}
                </div>
              </section>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/80 p-6 text-sm text-muted-foreground">
              This cell has not been run.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function caseMatrixRelatedResults(
  snapshot: WorkbenchInspectionSnapshot,
  caseId: string,
  column: CaseMatrixColumn,
): Array<{ run: WorkbenchRun; caseResult: WorkbenchRunEvidenceCaseResult }> {
  return snapshot.runs
    .flatMap((run) => {
      const evidence = buildWorkbenchRunEvidenceView(snapshot, run);
      return (evidence?.cases ?? [])
        .filter((caseResult) => caseMatrixCaseResultMatches(caseResult, caseId, column))
        .map((caseResult) => ({ run, caseResult }));
    })
    .sort((left, right) =>
      (right.run.finishedAt ?? right.run.createdAt).localeCompare(left.run.finishedAt ?? left.run.createdAt) ||
      right.run.id.localeCompare(left.run.id)
    );
}

function caseMatrixCaseResultMatches(
  caseResult: WorkbenchRunEvidenceCaseResult,
  caseId: string,
  column: CaseMatrixColumn,
): boolean {
  return caseResult.caseId === caseId &&
    caseResult.agentName === column.target.agent &&
    (!column.target.skill || caseResult.skillName === column.target.skill) &&
    (!column.target.versionId || caseResult.versionId === column.target.versionId);
}

function CaseMatrixColumnHeader({
  canRemove,
  column,
  columnIndex,
  onRemove,
}: {
  canRemove: boolean;
  column: CaseMatrixColumn;
  columnIndex: number;
  onRemove: () => void;
}) {
  return (
    <div className="relative grid min-w-0 gap-1.5 py-2 pr-7">
      <button
        aria-label={`Remove ${caseMatrixColumnLabel(column)}`}
        className="absolute right-0 top-1 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"
        disabled={!canRemove}
        title="Remove configuration"
        type="button"
        onClick={onRemove}
      >
        <XIcon aria-hidden="true" className="size-3.5" />
      </button>
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-full", caseMatrixColumnDotClass(column, columnIndex))}
        />
        <span className="min-w-0 break-words text-sm font-medium text-foreground [overflow-wrap:anywhere]">
          {caseMatrixColumnLabel(column)}
        </span>
      </div>
      <div className="min-w-0 break-words text-xs font-normal text-muted-foreground [overflow-wrap:anywhere]">
        {caseMatrixColumnDetail(column)}
      </div>
    </div>
  );
}

function CaseMatrixCell({
  allowMutations,
  caseId,
  column,
  onInspect,
}: {
  allowMutations: boolean;
  caseId: string;
  column: CaseMatrixColumn;
  onInspect: () => void;
}) {
  const caseResults = column.evidence?.cases.filter((caseResult) => caseResult.caseId === caseId) ?? [];
  const summary = caseMatrixCellSummary(caseResults);
  if (!summary) {
    const content = (
      <div className="pointer-events-none relative z-0 min-h-40 px-3 py-4">
        <span className="text-sm text-muted-foreground">Not run</span>
      </div>
    );
    return allowMutations ? (
      <button
        aria-label={`Inspect ${caseMatrixColumnLabel(column)} for ${caseId}`}
        className="absolute inset-0 z-10 grid w-full text-left no-underline transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
        onClick={onInspect}
      >
        {content}
      </button>
    ) : (
      <div className="absolute inset-0 grid w-full text-left">
        {content}
      </div>
    );
  }
  const latencyMetric = formatReportMetricStack(summary.report, "latency", formatDurationMs);
  const costMetric = formatReportMetricStack(summary.report, "cost", formatCost, formatReportCost(summary.report, summary.status));
  return (
    <button
      aria-label={`Inspect ${caseMatrixColumnLabel(column)} for ${caseId}`}
      className="absolute inset-0 z-10 grid w-full text-left no-underline transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      type="button"
      onClick={onInspect}
    >
      <div className="pointer-events-none relative z-0 min-h-40 px-3 py-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <StatusBadge status={summary.status} />
          <span className="shrink-0 text-xs font-medium text-foreground">{formatQualityMetric(summary.score)}</span>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">{formatCaseMatrixCoverage(summary.coverage)}</div>
        <div className="mt-4 grid min-w-0 grid-cols-2 gap-3 border-t border-border/60 pt-3">
          <CaseMatrixMetric label="Latency" value={formatCaseMatrixMetricValue(latencyMetric.value)} />
          <CaseMatrixMetric label="Cost" value={formatCaseMatrixMetricValue(costMetric.value)} />
        </div>
      </div>
    </button>
  );
}

function CaseMatrixMetric({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1">
      <div className="text-[11px] leading-none text-muted-foreground">{label}</div>
      <div className="break-words text-xs font-medium text-foreground [overflow-wrap:anywhere]">{value}</div>
    </div>
  );
}

function formatCaseMatrixCoverage(coverage: WorkbenchSampleCoverage | undefined): string {
  if (coverage && coverage.planned > 0 && coverage.completed === coverage.planned) {
    return formatCount(coverage.completed, "sample");
  }
  return formatCoverage(coverage);
}

function formatCaseMatrixMetricValue(value: ReactNode): ReactNode {
  return typeof value === "string" ? value.replace(/\/sample$/u, "") : value;
}

function caseMatrixColumnId(column: CaseMatrixColumn): string {
  return column.id;
}

function caseMatrixColumnLabel(column: CaseMatrixColumn): string {
  return column.versionLabel;
}

function caseMatrixColumnDetail(column: CaseMatrixColumn): string {
  return column.agentDetail;
}

function caseMatrixColumnDotClass(column: CaseMatrixColumn, columnIndex: number): string {
  if (caseMatrixColumnLabel(column).toLowerCase().includes("no skill")) {
    return "bg-muted-foreground";
  }
  return columnIndex === 0 ? "bg-primary" : "bg-success";
}

function buildCaseMatrixColumns(
  snapshot: WorkbenchInspectionSnapshot,
  evalVersionId: string,
): CaseMatrixColumn[] {
  const runsById = new Map(snapshot.runs.map((run) => [run.id, run]));
  const results = snapshot.results;
  if (!results) {
    return buildFallbackCaseMatrixColumns(snapshot);
  }
  const versionsById = new Map(results.skillVersions.map((version) => [version.id, version]));
  const agentsById = new Map(results.agentVersions.map((agent) => [agent.id, agent]));
  const seen = new Set<string>();
  const columns = results.cells.flatMap((cell): CaseMatrixColumn[] => {
    if (cell.evalVersionId !== evalVersionId) {
      return [];
    }
    const version = versionsById.get(cell.skillVersionId);
    const agent = agentsById.get(cell.agentVersionId);
    if (!version || !agent) {
      return [];
    }
    const target = caseMatrixOperationTargetForResultVersion(snapshot, version, agent);
    const targetKey = caseMatrixTargetKey(target);
    if (seen.has(targetKey)) {
      return [];
    }
    seen.add(targetKey);
    const run = cell.runId ? runsById.get(cell.runId) ?? null : null;
    const evidence = run ? buildWorkbenchRunEvidenceView(snapshot, run) : null;
    return [{
      id: targetKey,
      versionLabel: version.label,
      agentDetail: agent.label,
      target,
      ...(run ? { run } : {}),
      ...(evidence ? { evidence } : {}),
    }];
  });
  return columns.length > 0 ? columns : buildFallbackCaseMatrixColumns(snapshot);
}

export function caseMatrixOperationTargetForResultVersion(
  snapshot: WorkbenchInspectionSnapshot,
  version: WorkbenchSkillVersion,
  agent: WorkbenchAgentVersion,
): WorkbenchOperationTarget {
  const source = caseMatrixSkillSourceForResultVersion(snapshot, version);
  const current = version.current === true || version.id === "current";
  const versionId = current ? undefined : caseMatrixProjectVersionId(version);
  return {
    ...(source ? { skill: source.name } : current ? { skill: snapshot.status.defaultSkill ?? "current" } : {}),
    ...(versionId ? { versionId } : {}),
    agent: agent.name,
  };
}

function caseMatrixSkillSourceForResultVersion(
  snapshot: WorkbenchInspectionSnapshot,
  version: WorkbenchSkillVersion,
): WorkbenchSkillSource | null {
  const bundleSource = version.contentHash
    ? snapshot.skillBundles.find((bundle) => bundle.hash === version.contentHash)?.source
    : undefined;
  if (bundleSource) {
    return bundleSource;
  }
  const sourceText = version.source?.trim();
  if (sourceText) {
    return snapshot.skillSources.find((source) => source.source === sourceText) ??
      (sourceText === "none" ? snapshot.skillSources.find((source) => source.kind === "none") ?? null : null);
  }
  const defaultSkill = snapshot.status.defaultSkill ?? "current";
  if (version.current === true || version.id === "current") {
    return snapshot.skillSources.find((source) => source.name === defaultSkill) ?? null;
  }
  return null;
}

function caseMatrixProjectVersionId(version: WorkbenchSkillVersion): string | undefined {
  const versionId = version.projectVersionId ?? (version.sourceKind === "local" ? version.id : undefined);
  return versionId && versionId !== "current" ? versionId : undefined;
}

function caseMatrixTargetKey(target: WorkbenchOperationTarget): string {
  return [target.skill ?? "", target.versionId ?? "", target.agent ?? ""].join("\u0000");
}

function buildFallbackCaseMatrixColumns(snapshot: WorkbenchInspectionSnapshot): CaseMatrixColumn[] {
  const versionId = snapshot.status.currentVersionId ?? snapshot.versions.at(-1)?.id ?? null;
  const targetVersionId = versionId && versionId !== "current" ? versionId : null;
  const versionLabel = versionId
    ? formatVersionDisplayName(versionId, snapshot.versions, resultLabelContext(snapshot))
    : "Current skill";
  return snapshot.agents.map((agent) => ({
    id: `source:${versionId ?? "current"}:${agent.hash}`,
    versionLabel,
    agentDetail: formatAgentSnapshotDetail(agent),
    target: {
      ...(snapshot.status.defaultSkill ? { skill: snapshot.status.defaultSkill } : {}),
      ...(targetVersionId ? { versionId: targetVersionId } : {}),
      agent: agent.agent.name,
    },
  }));
}

function formatAgentSnapshotDetail(agent: WorkbenchAgentSnapshot): string {
  return agent.agent.model ? `${agent.agent.adapter} / ${agent.agent.model}` : agent.agent.adapter;
}

interface CaseMatrixCellSummary {
  status: string;
  coverage: WorkbenchSampleCoverage | undefined;
  report: WorkbenchJobReport | undefined;
  detailResult?: WorkbenchRunEvidenceCaseResult;
  score?: number;
}

function caseMatrixCellSummary(
  caseResults: readonly WorkbenchRunEvidenceCaseResult[],
): CaseMatrixCellSummary | null {
  if (caseResults.length === 0) {
    return null;
  }
  const scores = caseResults
    .map((caseResult) => caseResult.score)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  const score = scores.length === caseResults.length
    ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(3))
    : undefined;
  return {
    status: aggregateCaseMatrixStatus(caseResults),
    coverage: workbenchSampleCoverage(
      caseResults.filter(caseMatrixResultIsComplete).length,
      caseResults.length,
    ),
    report: combinedCaseMatrixReport(caseResults),
    ...(caseResults.length === 1 ? { detailResult: caseResults[0]! } : {}),
    ...(score !== undefined ? { score } : {}),
  };
}

function aggregateCaseMatrixStatus(caseResults: readonly WorkbenchRunEvidenceCaseResult[]): string {
  const statuses = caseResults.map((caseResult) => caseResult.status);
  if (statuses.includes("failed")) {
    return "failed";
  }
  if (statuses.includes("running")) {
    return "running";
  }
  if (statuses.includes("queued")) {
    return "queued";
  }
  if (statuses.includes("canceled")) {
    return "canceled";
  }
  return statuses[0] ?? "unknown";
}

function caseMatrixResultIsComplete(caseResult: WorkbenchRunEvidenceCaseResult): boolean {
  return caseResult.status === "succeeded" || caseResult.score !== undefined;
}

function combinedCaseMatrixReport(
  caseResults: readonly WorkbenchRunEvidenceCaseResult[],
): WorkbenchJobReport | undefined {
  if (caseResults.length === 0) {
    return undefined;
  }
  const roles = new Map<string, WorkbenchJobReport["roles"][number]>();
  let jobCount = 0;
  let totalDurationMs: number | undefined;
  for (const report of caseResults.map((caseResult) => caseResult.report)) {
    jobCount += report.jobCount;
    totalDurationMs = addReportNumber(totalDurationMs, report.totalDurationMs);
    for (const role of report.roles) {
      const current = roles.get(role.role);
      const roleDurationMs = addReportNumber(current?.totalDurationMs, role.totalDurationMs);
      const roleCostUsd = addReportNumber(current?.costUsd, role.costUsd, 6);
      roles.set(role.role, {
        role: role.role,
        jobCount: (current?.jobCount ?? 0) + role.jobCount,
        queued: (current?.queued ?? 0) + role.queued,
        running: (current?.running ?? 0) + role.running,
        succeeded: (current?.succeeded ?? 0) + role.succeeded,
        failed: (current?.failed ?? 0) + role.failed,
        canceled: (current?.canceled ?? 0) + role.canceled,
        ...(roleDurationMs !== undefined ? { totalDurationMs: roleDurationMs } : {}),
        ...(roleCostUsd !== undefined ? { costUsd: roleCostUsd } : {}),
      });
    }
  }
  return {
    unitCount: caseResults.length,
    jobCount,
    ...(totalDurationMs !== undefined ? { totalDurationMs } : {}),
    roles: [...roles.values()],
  };
}

function addReportNumber(
  current: number | undefined,
  next: number | undefined,
  decimals?: number,
): number | undefined {
  if (typeof next !== "number" || !Number.isFinite(next)) {
    return current;
  }
  const value = (current ?? 0) + next;
  return decimals === undefined ? value : Number(value.toFixed(decimals));
}

function CaseDetail({
  apiBasePath,
  hrefFor,
  navigate,
  onRouteClick,
  route,
  snapshot,
}: {
  apiBasePath: string;
  hrefFor: (route: WorkbenchRoute) => string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  route: Extract<WorkbenchRoute, { kind: "case" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const evalSnapshot = selectedEvalSnapshot(snapshot, route.evalVersionId);
  const evalCase = evalSnapshot?.cases.find((entry) => entry.id === route.caseId) ?? null;
  if (!evalSnapshot || !evalCase) {
    return <MissingObject label={`Case ${route.caseId}`} />;
  }
  const evalVersionId = evalVersionIdForHash(snapshot, evalSnapshot.hash) ?? route.evalVersionId ?? evalSnapshot.hash;
  const jobs = jobsForCase(snapshot, evalSnapshot.hash, evalCase.id);
  const definitionRoute = createCaseRoute({ caseId: evalCase.id, evalVersionId: evalVersionId, section: "definition", file: route.file });
  const runsRoute = createCaseRoute({ caseId: evalCase.id, evalVersionId: evalVersionId, section: "runs" });
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav className="grid h-max gap-1 rounded-lg border border-border/70 bg-background p-2 text-sm" aria-label="Case sections">
        <a
          aria-current={route.section === "definition" ? "page" : undefined}
          className={sectionNavItemClass(route.section === "definition")}
          href={hrefFor(definitionRoute)}
          onClick={onRouteClick(definitionRoute)}
        >
          Definition
        </a>
        <a
          aria-current={route.section === "runs" ? "page" : undefined}
          className={sectionNavItemClass(route.section === "runs", "flex items-center justify-between gap-2")}
          href={hrefFor(runsRoute)}
          onClick={onRouteClick(runsRoute)}
        >
          <span>Runs</span>
          <Badge variant="outline">{jobs.length}</Badge>
        </a>
      </nav>
      <div className="grid min-w-0 gap-5">
        <DetailPageHeader
          eyebrow={formatEvaluationDisplayName(evalSnapshot.hash, snapshot.evals)}
          title={caseDisplayTitle(evalCase)}
          description={evalCase.description ?? evalCase.command ?? "Authored evaluation case."}
        />
        {route.section === "definition" ? (
          <>
            <CaseGradePlan evalCase={evalCase} />
            <CaseDefinitionFiles
              apiBasePath={apiBasePath}
              evalCase={evalCase}
              evalSnapshot={evalSnapshot}
              file={route.file}
              onFileChange={(nextFile, options) => navigate(withFileRouteState(route, nextFile), options)}
            />
          </>
        ) : (
          <LinkedRunTable
            title="Runs"
            empty="No runs are recorded for this case."
            jobs={jobs}
            snapshot={snapshot}
            hrefFor={hrefFor}
            onRouteClick={onRouteClick}
          />
        )}
      </div>
    </div>
  );
}

function GradePlanCompact({ evalCase }: { evalCase: WorkbenchEvalCaseSnapshot }) {
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="outline">{evalCase.grade.label}</Badge>
        <span className="min-w-0 break-words text-sm text-foreground [overflow-wrap:anywhere]">{evalCase.grade.summary}</span>
      </div>
      {evalCase.grade.sources.length > 0 ? (
        <div className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {evalCase.grade.sources.map((source) => source.role).join(" + ")}
        </div>
      ) : null}
    </div>
  );
}

function CaseGradePlan({ evalCase }: { evalCase: WorkbenchEvalCaseSnapshot }) {
  return (
    <section className="grid min-w-0 gap-3 rounded-lg border border-border/70 bg-background p-4" aria-label="Grading">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">Grading</h2>
          <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {evalCase.grade.label}: {evalCase.grade.summary}
          </p>
        </div>
        <Badge variant="outline">{evalCase.grade.adapter}</Badge>
      </div>
      {evalCase.grade.sources.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-2">
          {evalCase.grade.sources.map((source) => (
            <Badge key={`${source.role}:${source.path}`} variant="secondary" className="max-w-full break-words [overflow-wrap:anywhere]">
              {source.role}: {source.path}
            </Badge>
          ))}
        </div>
      ) : null}
      <div className="grid min-w-0 gap-3">
        {evalCase.grade.display.map((block, index) => (
          <GradePlanDisplayBlockView block={block} key={`${block.kind}:${block.title ?? index}`} />
        ))}
      </div>
    </section>
  );
}

function GradePlanDisplayBlockView({ block }: { block: WorkbenchGradePlanDisplayBlock }) {
  if (block.kind === "text") {
    return (
      <div className="grid min-w-0 gap-1 text-sm">
        {block.title ? <h3 className="font-medium text-foreground">{block.title}</h3> : null}
        <p className="break-words text-muted-foreground [overflow-wrap:anywhere]">{block.text}</p>
      </div>
    );
  }
  if (block.kind === "key_value") {
    return (
      <div className="grid min-w-0 gap-2">
        {block.title ? <h3 className="text-sm font-medium text-foreground">{block.title}</h3> : null}
        <dl className="grid min-w-0 gap-2 sm:grid-cols-2">
          {block.items.map((item) => (
            <div key={item.label} className="min-w-0 rounded-md border border-border/60 px-3 py-2">
              <dt className="text-xs font-medium uppercase text-muted-foreground">{item.label}</dt>
              <dd className="break-words text-sm text-foreground [overflow-wrap:anywhere]">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  if (block.kind === "list") {
    return (
      <div className="grid min-w-0 gap-2">
        {block.title ? <h3 className="text-sm font-medium text-foreground">{block.title}</h3> : null}
        <ul className="grid min-w-0 gap-2">
          {block.items.map((item) => (
            <li key={item.label} className="min-w-0 rounded-md border border-border/60 px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="break-words text-sm font-medium text-foreground [overflow-wrap:anywhere]">{item.label}</span>
                {item.meta ? <Badge variant="outline">{item.meta}</Badge> : null}
              </div>
              {item.description ? (
                <p className="mt-1 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{item.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="grid min-w-0 gap-2">
      {block.title ? <h3 className="text-sm font-medium text-foreground">{block.title}</h3> : null}
      <ul className="grid min-w-0 gap-2">
        {block.files.map((file) => (
          <li key={file.path} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
            <span className="break-words font-medium text-foreground [overflow-wrap:anywhere]">{file.path}</span>
            {file.role ? <Badge variant="secondary">{file.role}</Badge> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function caseDisplayTitle(evalCase: WorkbenchEvalCaseSnapshot): string {
  const title = evalCase.title?.trim();
  return title || evalCase.id;
}

function caseResultFinalOutput(
  snapshot: WorkbenchInspectionSnapshot,
  caseResult: WorkbenchRunEvidenceCaseResult,
): string {
  const jobId = caseResult.execute?.jobId ?? caseResult.selectedJobId;
  const job = snapshot.jobs.find((entry) => entry.id === jobId) ?? null;
  const result = job?.result;
  const itemText = result?.items?.flatMap((item): string[] => {
    if (typeof item.summary === "string" && item.summary.trim()) {
      return [item.summary.trim()];
    }
    if (typeof item.body === "string" && item.body.trim()) {
      return [item.body.trim()];
    }
    if (typeof item.value === "string" && item.value.trim()) {
      return [item.value.trim()];
    }
    return [];
  })[0];
  return result?.summary?.trim() ||
    itemText ||
    result?.error?.trim() ||
    caseResult.error?.trim() ||
    "No final output text was captured.";
}

function showCaseSecondaryId(evalCase: WorkbenchEvalCaseSnapshot): boolean {
  const title = evalCase.title?.trim();
  return Boolean(title && title !== evalCase.id);
}

function CaseDefinitionFiles({
  apiBasePath,
  evalCase,
  evalSnapshot,
  file,
  onFileChange,
}: {
  apiBasePath: string;
  evalCase: WorkbenchEvalCaseSnapshot;
  evalSnapshot: WorkbenchEvalSnapshot;
  file: WorkbenchFileRouteState;
  onFileChange: (file: WorkbenchFileRouteState, options?: { replace?: boolean }) => void;
}) {
  const reportRouteLoading = useRouteLoadingReporter();

  if (evalCase.files.length === 0) {
    return (
      <EmptyState
        icon={FileTextIcon}
        title="No case files"
        message="Case source files appear here once Workbench observes this evaluation case."
        size="sm"
      />
    );
  }
  const defaultFilePath = evalCase.files.some((entry) => entry.path === evalCase.path)
    ? evalCase.path
    : evalCase.files.find((entry) => fileName(entry.path).toLowerCase() === "case.yaml")?.path ?? evalCase.files[0]?.path ?? null;
  return (
    <section className="grid min-w-0 gap-4" aria-label="Definition">
      <RepositoryFilesView
        apiBasePath={apiBasePath}
        defaultFilePath={defaultFilePath}
        displayRootPath={directoryPathForFile(evalCase.path)}
        file={file}
        files={evalCase.files}
        ownerId={caseFileOwnerId(evalSnapshot.hash, evalCase.id)}
        ownerKind="case"
        repositoryLabel="Case files"
        onFileChange={onFileChange}
        onLoadingChange={reportRouteLoading}
      />
    </section>
  );
}

function sectionNavItemClass(active: boolean, className?: string): string {
  return cn(
    "rounded-md px-2 py-1 font-medium no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-muted text-foreground"
      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    className,
  );
}

function RunsSurface({
  hrefFor,
  onRouteClick,
  route: _route,
  snapshot,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  route: Extract<WorkbenchRoute, { kind: "runs" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const activeRuns = snapshot.runs.filter((run) => isRunActive(run, snapshot.jobs));
  const inactiveRuns = snapshot.runs.filter((run) => !activeRuns.some((active) => active.id === run.id));
  const runs = [
    ...activeRuns.sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    ...inactiveRuns.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  ];
  if (runs.length === 0) {
    return <EmptyState icon={PlayCircleIcon} title="No runs" message="Runs appear here after Workbench evaluates or improves a skill." variant="hero" size="sm" />;
  }
  return (
    <section className="min-w-0" aria-label="Runs">
      <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Operation</TableHead>
              <TableHead>Measurement</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => {
              const runRoute = createRunRoute({ runId: run.id });
              const runJobs = jobsForRun(run, snapshot.jobs);
              const evidence = runEvidenceView(snapshot, run);
              const report = buildWorkbenchJobReport(runJobs, snapshot.traces);
              const latencyMetric = formatReportMetricStack(report, "latency", formatDurationMs);
              const costMetric = formatReportMetricStack(report, "cost", formatCost, formatReportCost(report, run.status));
              const summary = runEvidenceSummary(snapshot, run, evidence, runJobs);
              return (
                <TableRow key={run.id} className="cursor-pointer" onClick={onRouteClick(runRoute)}>
                  <TableCell className="align-top">
                    <a className="font-medium text-primary underline-offset-4 hover:underline" href={hrefFor(runRoute)} onClick={onRouteClick(runRoute)}>
                      {runOperationLabel(run)}
                    </a>
                    <div className="mt-1"><StatusBadge status={run.status} /></div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="break-words font-medium [overflow-wrap:anywhere]">{summary.subject}</div>
                    <div className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{summary.context}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{summary.detail}</div>
                  </TableCell>
                  <TableCell className="align-top font-medium">{formatQualityMetric(runScore(run, snapshot.jobs))}</TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    <MetricStack
                      value={latencyMetric.value}
                      detail={latencyMetric.detail}
                    />
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    <MetricStack
                      value={costMetric.value}
                      detail={costMetric.detail}
                    />
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">{formatTimestamp(run.finishedAt ?? run.createdAt)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function RunDetailPage({
  apiBasePath,
  hrefFor,
  inspectionCursor,
  onRouteClick,
  progressCursor,
  route,
  snapshot,
}: {
  apiBasePath: string;
  hrefFor: (route: WorkbenchRoute) => string;
  inspectionCursor: string | null;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  progressCursor: string | null;
  route: Extract<WorkbenchRoute, { kind: "run" | "run-job" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const run = snapshot.runs.find((entry) => entry.id === route.runId) ?? null;
  if (!run) {
    return <MissingObject label={`Run ${route.runId}`} />;
  }
  const jobs = jobsForRun(run, snapshot.jobs);
  const evidence = runEvidenceView(snapshot, run);
  const runReport = buildWorkbenchJobReport(jobs, snapshot.traces);
  const runLatencyMetric = formatReportMetricStack(runReport, "latency", formatDurationMs);
  const runCostMetric = formatReportMetricStack(runReport, "cost", formatCost, formatReportCost(runReport, run.status));
  const runCoverage = workbenchSampleCoverageForJobs(jobs);
  const summaryRoute = createRunRoute({ runId: run.id });
  const selectedJobId = route.kind === "run-job" ? route.jobId : null;
  const selectedJob = selectedJobId ? jobs.find((job) => job.id === selectedJobId) ?? null : null;
  const selectedCaseResult = selectedJobId
    ? evidence.cases.find((caseResult) => runCaseResultHasJob(caseResult, selectedJobId)) ?? null
    : null;
  const selectedPhaseName = selectedCaseResult ? runCasePhaseForJob(selectedCaseResult, selectedJobId) : null;
  const selectedPhase = selectedCaseResult && selectedPhaseName
    ? phaseForCaseResult(selectedCaseResult, selectedPhaseName)
    : null;
  const selectedEvidenceJob = selectedJob
    ? evidence.jobs.find((job) => job.jobId === selectedJob.id) ?? null
    : null;
  const caseJobIds = new Set(evidence.cases.flatMap(runCaseResultJobIds));
  const genericNavJobs = evidence.jobs.filter((job) => !caseJobIds.has(job.jobId));
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav className="grid h-max gap-1 rounded-lg border border-border/70 bg-background p-2 text-sm" aria-label="Run sections">
        <a
          aria-current={route.kind === "run" ? "page" : undefined}
          className={sectionNavItemClass(route.kind === "run")}
          href={hrefFor(summaryRoute)}
          onClick={onRouteClick(summaryRoute)}
        >
          Summary
        </a>
        {evidence.cases.map((caseResult) => {
          const caseRoute = createRunCaseRoute({
            caseResult,
            phase: defaultRunCasePhase(caseResult),
            runId: run.id,
          });
          const active = selectedCaseResult ? runCaseResultKey(caseResult) === runCaseResultKey(selectedCaseResult) : false;
          return (
            <a
              aria-current={active ? "page" : undefined}
              className={sectionNavItemClass(active, "truncate")}
              href={hrefFor(caseRoute)}
              key={runCaseResultKey(caseResult)}
              onClick={onRouteClick(caseRoute)}
            >
              {runCaseNavLabel(caseResult)}
            </a>
          );
        })}
        {genericNavJobs.map((evidenceJob) => {
          const jobRoute = createRunJobRoute({ runId: run.id, jobId: evidenceJob.jobId });
          const active = selectedJobId === evidenceJob.jobId;
          return (
            <a
              aria-current={active ? "page" : undefined}
              className={sectionNavItemClass(active, "truncate")}
              href={hrefFor(jobRoute)}
              key={evidenceJob.jobId}
              onClick={onRouteClick(jobRoute)}
            >
              {genericRunJobNavLabel(evidenceJob)}
            </a>
          );
        })}
      </nav>
      <div className="grid min-w-0 gap-5">
        <DetailPageHeader
          eyebrow={runOperationLabel(run)}
          title={runDisplayTitle(run, snapshot, evidence, jobs)}
          description={runDescription(run, snapshot, evidence, jobs)}
        />
        {route.kind === "run" ? (
          <>
            <MetricStrip
              items={[
                {
                  label: "Quality",
                  value: formatQualityMetric(runScore(run, jobs)),
                },
                {
                  label: "Coverage",
                  value: formatCoverage(runCoverage),
                },
                {
                  label: "Latency",
                  value: runLatencyMetric.value,
                  detail: runLatencyMetric.detail,
                },
                {
                  label: "Cost",
                  value: runCostMetric.value,
                  detail: runCostMetric.detail,
                },
              ]}
            />
            {run.error ? <ProblemState icon={CircleAlertIcon} title="Run error" message={run.error} align="start" /> : null}
            <RunSummaryMeasurementTable evidence={evidence} />
            <RunSummaryJobTable evidence={evidence} />
            {runHasCaseEvidence(run, evidence, jobs) ? (
              <RunSummaryCaseTable
                evidence={evidence}
                hrefFor={hrefFor}
                onRouteClick={onRouteClick}
                run={run}
                snapshot={snapshot}
              />
            ) : null}
            <RunTimelineSummary jobs={jobs} run={run} snapshot={snapshot} />
          </>
        ) : selectedCaseResult && selectedJob && selectedPhase && selectedPhaseName ? (
          <CaseResultDetail
            apiBasePath={apiBasePath}
            caseResult={selectedCaseResult}
            hrefFor={hrefFor}
            inspectionCursor={inspectionCursor}
            job={selectedJob}
            phase={selectedPhaseName}
            progressCursor={progressCursor}
            evidenceJob={selectedEvidenceJob}
            onRouteClick={onRouteClick}
            run={run}
            snapshot={snapshot}
            view={route.view}
          />
        ) : selectedJob ? (
          <GenericJobDetail
            apiBasePath={apiBasePath}
            hrefFor={hrefFor}
            inspectionCursor={inspectionCursor}
            job={selectedJob}
            onRouteClick={onRouteClick}
            progressCursor={progressCursor}
            run={run}
            snapshot={snapshot}
            evidenceJob={selectedEvidenceJob}
            view={route.view}
          />
        ) : (
          <MissingObject label={`Job ${selectedJobId ?? "unknown"}`} />
        )}
      </div>
    </div>
  );
}

function RunSummaryMeasurementTable({
  evidence,
}: {
  evidence: WorkbenchRunEvidenceView;
}) {
  if (evidence.measurements.length === 0) {
    return null;
  }
  return (
    <SurfaceSection title="Measurements" icon={WorkflowIcon} headingLevel={3} description={formatMeasurementResultsSummary(evidence)}>
      <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Measurement</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead>Coverage</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {evidence.measurements.map((measurement) => {
              const latencyMetric = formatReportMetricStack(measurement.report, "latency", formatDurationMs);
              const costMetric = formatReportMetricStack(measurement.report, "cost", formatCost, formatReportCost(measurement.report, measurement.status));
              return (
                <TableRow key={runEvidenceGroupKey(measurement)}>
                  <TableCell className="align-top">
                    <div className="font-medium">{formatSkillLabel(measurement)}</div>
                    <div className="text-xs text-muted-foreground">{formatEvidenceAgentModel(measurement)}</div>
                    <div className="mt-1"><StatusBadge status={measurement.status} /></div>
                  </TableCell>
                  <TableCell className="align-top font-medium">{formatQualityMetric(measurement.score)}</TableCell>
                  <TableCell className="align-top text-muted-foreground">{formatCoverage(measurement.coverage)}</TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    <MetricStack
                      value={latencyMetric.value}
                      detail={latencyMetric.detail}
                    />
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    <MetricStack
                      value={costMetric.value}
                      detail={costMetric.detail}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </SurfaceSection>
  );
}

function RunSummaryJobTable({
  evidence,
}: {
  evidence: WorkbenchRunEvidenceView;
}) {
  if (evidence.jobGroups.length === 0) {
    return null;
  }
  return (
    <SurfaceSection title="Jobs" icon={WorkflowIcon} headingLevel={3}>
      <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {evidence.jobGroups.map((group) => (
              <TableRow key={runEvidenceGroupKey(group)}>
                <TableCell className="align-top">
                  <div className="font-medium">{formatSkillLabel(group)}</div>
                  <div className="text-xs text-muted-foreground">{formatEvidenceAgentModel(group)}</div>
                </TableCell>
                <TableCell className="align-top"><StatusBadge status={group.status} /></TableCell>
                <TableCell className="align-top text-muted-foreground">{formatReportMetricTotal(group.report, "latency", formatDurationMs)}</TableCell>
                <TableCell className="align-top text-muted-foreground">{formatReportMetricTotal(group.report, "cost", formatCost, formatReportCost(group.report, group.status))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SurfaceSection>
  );
}

function RunSummaryCaseTable({
  evidence,
  hrefFor,
  onRouteClick,
  run,
  snapshot,
}: {
  evidence: WorkbenchRunEvidenceView;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  run: WorkbenchRun;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const evalSnapshot = selectedEvalSnapshot(snapshot, run.evalHash);
  const casesById = new Map((evalSnapshot?.cases ?? []).map((evalCase) => [evalCase.id, evalCase]));
  if (evidence.cases.length === 0) {
    return (
      <SurfaceSection title="Case results" icon={FileTextIcon} headingLevel={3}>
        <p className="text-sm text-muted-foreground">No case results are recorded for this run.</p>
      </SurfaceSection>
    );
  }
  return (
    <SurfaceSection title="Case results" icon={FileTextIcon} headingLevel={3} description={formatEvidenceCaseSummary(evidence)}>
      <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case</TableHead>
              <TableHead>Measurement</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {evidence.cases.map((caseResult) => {
              const caseRoute = createRunCaseRoute({
                caseResult,
                phase: defaultRunCasePhase(caseResult),
                runId: run.id,
              });
              const evalCase = casesById.get(caseResult.caseId);
              const title = evalCase ? caseDisplayTitle(evalCase) : caseResult.caseId;
              const latencyMetric = formatReportMetricStack(caseResult.report, "latency", formatDurationMs);
              const costMetric = formatReportMetricStack(caseResult.report, "cost", formatCost, formatReportCost(caseResult.report, run.status));
              return (
                <TableRow key={runCaseResultKey(caseResult)} className="cursor-pointer" onClick={onRouteClick(caseRoute)}>
                  <TableCell className="align-top">
                    <a className="font-medium text-primary underline-offset-4 hover:underline" href={hrefFor(caseRoute)} onClick={onRouteClick(caseRoute)}>
                      {title}
                    </a>
                    {evalCase && showCaseSecondaryId(evalCase) ? (
                      <div className="text-xs text-muted-foreground">{caseResult.caseId}</div>
                    ) : null}
                    {caseResult.sample > 0 ? (
                      <div className="text-xs text-muted-foreground">Sample {formatSampleNumber(caseResult.sample)}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="font-medium">{formatSkillLabel(caseResult)}</div>
                    <div className="text-xs text-muted-foreground">{formatEvidenceAgentModel(caseResult)}</div>
                    <div className="mt-1"><StatusBadge status={caseResult.status} /></div>
                  </TableCell>
                  <TableCell className="align-top font-medium">{formatQualityMetric(caseResult.score)}</TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    <MetricStack
                      value={latencyMetric.value}
                      detail={latencyMetric.detail}
                    />
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    <MetricStack
                      value={costMetric.value}
                      detail={costMetric.detail}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </SurfaceSection>
  );
}

function RunTimelineSummary({
  jobs,
  run,
  snapshot,
}: {
  jobs: WorkbenchJob[];
  run: WorkbenchRun;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const traceIds = new Set([...run.traceIds, ...jobs.flatMap((job) => job.traceIds)]);
  const traces = snapshot.traces.filter((trace) => trace.runId === run.id || traceIds.has(trace.id));
  const eventBatches = snapshot.executionEvents.filter((batch) => batch.runId === run.id);
  const eventCount = eventBatches.reduce((count, batch) => count + batch.events.length, 0);
  const startedAt = jobs
    .map((job) => job.startedAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? run.createdAt;
  const finishedAt = run.finishedAt ?? jobs
    .map((job) => job.finishedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return (
    <SurfaceSection
      title="Timeline"
      icon={ActivityIcon}
      headingLevel={3}
      description={`Execution trace / ${formatCount(traces.length, "trace")} / ${formatCount(eventCount, "event")}`}
    >
      <div className="grid min-w-0 gap-3 rounded-lg border border-border/70 bg-background p-4">
        <FactGrid>
          <FactItem title="Created" value={formatTimestamp(run.createdAt)} />
          <FactItem title="Started" value={formatTimestamp(startedAt)} />
          <FactItem title="Finished" value={finishedAt ? formatTimestamp(finishedAt) : "Still running"} />
        </FactGrid>
      </div>
    </SurfaceSection>
  );
}

function formatMeasurementResultsSummary(evidence: WorkbenchRunEvidenceView): string {
  return formatCount(evidence.measurements.length, "measurement");
}

function formatEvidenceCaseSummary(evidence: WorkbenchRunEvidenceView): string {
  const completed = evidence.cases.filter((entry) => entry.status === "succeeded" || entry.score !== undefined).length;
  return `${completed} / ${evidence.cases.length} covered`;
}

function formatAdapterModel(entry: Pick<WorkbenchRunEvidenceJob, "adapter" | "model">): string {
  const adapter = compactDisplayPart(entry.adapter);
  const model = compactDisplayPart(entry.model);
  return [adapter, model].filter((part): part is string => Boolean(part)).join(" / ");
}

function formatSkillLabel(entry: Pick<WorkbenchRunEvidenceJob, "skillLabel" | "skillName">): string {
  return entry.skillLabel || entry.skillName;
}

function formatSampleNumber(sample: number): number {
  return sample + 1;
}

function formatRunCasePhase(phase: WorkbenchRunCasePhase): string {
  return phase === "grade" ? "Grade" : "Execute";
}

function formatJobRoleLabel(role: string): string {
  return role
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ") || "Job";
}

function formatJobDependencies(job: WorkbenchRunEvidenceJob): string {
  return job.dependencies
    .map((dependency) => dependency.jobId ? `${dependency.name}: ${dependency.jobId}` : dependency.name)
    .join(", ");
}

function runCaseNavLabel(caseResult: WorkbenchRunEvidenceCaseResult): string {
  const sample = caseResult.sample > 0 ? ` #${formatSampleNumber(caseResult.sample)}` : "";
  return `${caseResult.caseId}${sample} · ${formatSkillLabel(caseResult)} · ${caseResult.agentLabel}`;
}

function genericRunJobNavLabel(job: WorkbenchRunEvidenceJob): string {
  return `${formatJobRoleLabel(job.role ?? "job")} · ${formatSkillLabel(job)} · ${job.agentLabel}`;
}

function createRunCaseRoute({
  caseResult,
  phase,
  runId,
  view = "timeline",
}: {
  caseResult: WorkbenchRunEvidenceCaseResult;
  phase: WorkbenchRunCasePhase;
  runId: string;
  view?: WorkbenchRunJobEvidenceView;
}): WorkbenchRoute {
  const selectedPhase = phaseForCaseResult(caseResult, phase) ?? phaseForCaseResult(caseResult, defaultRunCasePhase(caseResult));
  return createRunJobRoute({
    runId,
    jobId: selectedPhase?.jobId ?? caseResult.selectedJobId,
    view,
  });
}

function runCaseResultJobIds(caseResult: WorkbenchRunEvidenceCaseResult): string[] {
  return [
    caseResult.selectedJobId,
    caseResult.execute?.jobId,
    caseResult.grade?.jobId,
  ].filter((jobId, index, jobIds): jobId is string => Boolean(jobId) && jobIds.indexOf(jobId) === index);
}

function runCaseResultHasJob(
  caseResult: WorkbenchRunEvidenceCaseResult,
  jobId: string,
): boolean {
  return runCaseResultJobIds(caseResult).includes(jobId);
}

function runCasePhaseForJob(
  caseResult: WorkbenchRunEvidenceCaseResult,
  jobId: string | null,
): WorkbenchRunCasePhase | null {
  if (!jobId) {
    return null;
  }
  if (caseResult.grade?.jobId === jobId) {
    return "grade";
  }
  if (caseResult.execute?.jobId === jobId) {
    return "execute";
  }
  return null;
}

function runEvidenceGroupKey(
  group: Pick<WorkbenchRunEvidenceJob, "versionId" | "skillName" | "skillBundleHash" | "evalHash" | "agentHash" | "agentName">,
): string {
  return [
    group.versionId,
    group.skillName,
    group.skillBundleHash,
    group.evalHash,
    group.agentHash,
    group.agentName,
  ].join(":");
}

function runCaseResultKey(caseResult: WorkbenchRunEvidenceCaseResult): string {
  return [
    runEvidenceGroupKey(caseResult),
    caseResult.caseId,
    caseResult.sample,
  ].join(":");
}

function defaultRunCasePhase(caseResult: WorkbenchRunEvidenceCaseResult): WorkbenchRunCasePhase {
  return caseResult.execute ? "execute" : "grade";
}

function phaseForCaseResult(
  caseResult: WorkbenchRunEvidenceCaseResult,
  phase: WorkbenchRunCasePhase,
): WorkbenchRunEvidenceJobPhase | null {
  if (phase === "grade") {
    return caseResult.grade ?? caseResult.execute ?? null;
  }
  return caseResult.execute ?? caseResult.grade ?? null;
}

function CaseResultDetail({
  apiBasePath,
  caseResult,
  hrefFor,
  inspectionCursor,
  job,
  phase,
  progressCursor,
  evidenceJob,
  onRouteClick,
  run,
  snapshot,
  view,
}: {
  apiBasePath: string;
  caseResult: WorkbenchRunEvidenceCaseResult;
  hrefFor: (route: WorkbenchRoute) => string;
  inspectionCursor: string | null;
  job: WorkbenchJob;
  phase: WorkbenchRunCasePhase;
  progressCursor: string | null;
  evidenceJob: WorkbenchRunEvidenceJob | null;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  run: WorkbenchRun;
  snapshot: WorkbenchInspectionSnapshot;
  view: WorkbenchRunJobEvidenceView;
}) {
  const traces = snapshot.traces.filter((trace) => job.traceIds.includes(trace.id) || trace.jobId === job.id);
  const artifacts = snapshot.artifacts.filter((artifact) => job.artifactIds.includes(artifact.id));
  const caseTitle = caseResult.caseId;
  const phaseLabel = formatRunCasePhase(phase);
  const agentLabel = caseResult.agentLabel;
  const skillLabel = formatSkillLabel(caseResult);
  const adapterModel = formatAdapterModel(caseResult);
  const selectedPhase = phaseForCaseResult(caseResult, phase) ?? {
    jobId: job.id,
    ...(job.role ? { role: job.role } : {}),
    status: job.status,
    ...(jobScore(job) !== undefined ? { score: jobScore(job) } : {}),
    ...(job.durationMs !== undefined ? { durationMs: job.durationMs } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
  const dependencies = evidenceJob?.dependencies.length ? formatJobDependencies(evidenceJob) : selectedPhase.dependencyReason;
  const phaseError = selectedPhase.error && selectedPhase.error !== caseResult.error ? selectedPhase.error : null;
  return (
    <section className="grid min-w-0 gap-4" aria-label={`${caseTitle} evidence`}>
      <div className="grid min-w-0 gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="text-xs font-medium text-muted-foreground">Case result</div>
          <h2 className="break-words text-xl font-semibold leading-tight text-foreground [overflow-wrap:anywhere]">{caseTitle}</h2>
          <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {skillLabel} · {agentLabel}
          </p>
        </div>
        <CasePhaseNav
          caseResult={caseResult}
          hrefFor={hrefFor}
          onRouteClick={onRouteClick}
          phase={phase}
          run={run}
          view={view}
        />
      </div>
      <FactGrid>
        <FactItem title="Skill" value={skillLabel} />
        <FactItem title="Agent" value={agentLabel} />
        <FactItem title="Model" value={adapterModel} />
        <FactItem title="Sample" value={formatSampleNumber(caseResult.sample)} />
        <FactItem title="Status" value={<StatusBadge status={caseResult.status} />} />
        <FactItem title="Quality" value={formatQualityMetric(caseResult.score)} />
        <FactItem title="Latency" value={formatReportMetricStack(caseResult.report, "latency", formatDurationMs).value} />
      </FactGrid>
      {caseResult.error ? <ProblemState icon={CircleAlertIcon} title="Case error" message={caseResult.error} align="start" /> : null}
      <div className="grid min-w-0 gap-4">
        <FactGrid>
          <FactItem title="Phase" value={phaseLabel} />
          <FactItem title="Phase status" value={<StatusBadge status={selectedPhase.status} />} />
          <FactItem title="Phase score" value={formatScore(selectedPhase.score)} />
          <FactItem title="Phase duration" value={formatDurationMs(selectedPhase.durationMs)} />
          {dependencies ? <FactItem title="Dependencies" value={dependencies} /> : null}
        </FactGrid>
        {phaseError ? <ProblemState icon={CircleAlertIcon} title={`${phaseLabel} error`} message={phaseError} align="start" /> : null}
        <div className="flex min-w-0 justify-end">
          <JobEvidenceViewNav
            hrefFor={hrefFor}
            jobId={job.id}
            onRouteClick={onRouteClick}
            runId={run.id}
            view={view}
          />
        </div>
        {view === "timeline" ? (
          <JobEvidencePanel
            apiBasePath={apiBasePath}
            description={phase === "grade" ? "Judgment timeline for this case sample." : "Skill execution timeline for this case sample."}
            jobId={job.id}
            jobStatus={job.status}
            refreshToken={job.status === "queued" || job.status === "running" ? progressCursor ?? inspectionCursor : null}
            runId={job.runId}
            title={`${phaseLabel} timeline`}
          />
        ) : (
          <CaseOutputView apiBasePath={apiBasePath} artifacts={artifacts} job={job} traces={traces} />
        )}
      </div>
    </section>
  );
}

function GenericJobDetail({
  apiBasePath,
  hrefFor,
  inspectionCursor,
  job,
  onRouteClick,
  progressCursor,
  run,
  snapshot,
  evidenceJob,
  view,
}: {
  apiBasePath: string;
  hrefFor: (route: WorkbenchRoute) => string;
  inspectionCursor: string | null;
  job: WorkbenchJob;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  progressCursor: string | null;
  run: WorkbenchRun;
  snapshot: WorkbenchInspectionSnapshot;
  evidenceJob: WorkbenchRunEvidenceJob | null;
  view: WorkbenchRunJobEvidenceView;
}) {
  const traces = snapshot.traces.filter((trace) => job.traceIds.includes(trace.id) || trace.jobId === job.id);
  const artifacts = snapshot.artifacts.filter((artifact) => job.artifactIds.includes(artifact.id));
  const primaryTrace = traces[0] ?? null;
  const roleLabel = formatJobRoleLabel(job.role ?? job.kind);
  const adapterModel = evidenceJob ? formatAdapterModel(evidenceJob) : job.adapter?.use ?? "recorded";
  const dependencies = evidenceJob?.dependencies.length ? formatJobDependencies(evidenceJob) : null;
  return (
    <section className="grid min-w-0 gap-4" aria-label={`${roleLabel} evidence`}>
      <div className="grid min-w-0 gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="text-xs font-medium text-muted-foreground">Job</div>
          <h2 className="break-words text-xl font-semibold leading-tight text-foreground [overflow-wrap:anywhere]">{roleLabel}</h2>
          <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {job.skillName} · {job.agentName}
          </p>
        </div>
      </div>
      <FactGrid>
        <FactItem title="Skill" value={job.skillName} />
        <FactItem title="Agent" value={job.agentName} />
        <FactItem title="Model" value={adapterModel} />
        <FactItem title="Role" value={roleLabel} />
        <FactItem title="Status" value={<StatusBadge status={job.status} />} />
        <FactItem title="Started" value={formatTimestamp(job.startedAt ?? job.createdAt)} />
        <FactItem title="Finished" value={job.finishedAt ? formatTimestamp(job.finishedAt) : job.status === "running" || job.status === "queued" ? "Still running" : "n/a"} />
        <FactItem title="Duration" value={formatDurationMs(job.durationMs)} />
        {primaryTrace?.source?.sessionId ? <FactItem title="Session" value={primaryTrace.source.sessionId} /> : null}
        {primaryTrace?.source?.workspaceRoot ? <FactItem title="Project" value={primaryTrace.source.workspaceRoot} /> : null}
        {job.command ? <FactItem title="Command" value={job.command} /> : null}
        {job.caseId !== "current" ? <FactItem title="Case" value={job.caseId} /> : null}
        {job.caseId !== "current" ? <FactItem title="Sample" value={formatSampleNumber(job.sample)} /> : null}
        {dependencies ? <FactItem title="Dependencies" value={dependencies} /> : null}
      </FactGrid>
      {job.error ? <ProblemState icon={CircleAlertIcon} title={`${roleLabel} error`} message={job.error} align="start" /> : null}
      <div className="grid min-w-0 gap-4">
        <div className="flex min-w-0 justify-end">
          <JobEvidenceViewNav
            hrefFor={hrefFor}
            jobId={job.id}
            onRouteClick={onRouteClick}
            runId={run.id}
            view={view}
          />
        </div>
        {view === "timeline" ? (
          <JobEvidencePanel
            apiBasePath={apiBasePath}
            description="Execution timeline and recorded evidence for this job."
            jobId={job.id}
            jobStatus={job.status}
            refreshToken={job.status === "queued" || job.status === "running" ? progressCursor ?? inspectionCursor : null}
            runId={job.runId}
            title={`${roleLabel} timeline`}
          />
        ) : (
          <CaseOutputView apiBasePath={apiBasePath} artifacts={artifacts} job={job} traces={traces} />
        )}
      </div>
    </section>
  );
}

function CasePhaseNav({
  caseResult,
  hrefFor,
  onRouteClick,
  phase,
  run,
  view,
}: {
  caseResult: WorkbenchRunEvidenceCaseResult;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  phase: WorkbenchRunCasePhase;
  run: WorkbenchRun;
  view: WorkbenchRunJobEvidenceView;
}) {
  const phases = [
    caseResult.execute ? { value: "execute" as const, label: "Execute" } : null,
    caseResult.grade ? { value: "grade" as const, label: "Grade" } : null,
  ].filter((entry): entry is { value: WorkbenchRunCasePhase; label: string } => entry !== null);
  if (phases.length <= 1) {
    return null;
  }
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-4 border-b border-border/70 text-sm" aria-label="Case result phases">
      {phases.map((item) => {
        const route = createRunCaseRoute({
          caseResult,
          phase: item.value,
          runId: run.id,
          view,
        });
        const active = item.value === phase;
        return (
          <a
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-10 items-center border-b-2 px-0.5 font-medium text-muted-foreground no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border-primary text-foreground" : "border-transparent hover:text-foreground",
            )}
            href={hrefFor(route)}
            key={item.value}
            onClick={onRouteClick(route)}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

function JobEvidenceViewNav({
  hrefFor,
  jobId,
  onRouteClick,
  runId,
  view,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  jobId: string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  runId: string;
  view: WorkbenchRunJobEvidenceView;
}) {
  const views: Array<{ value: WorkbenchRunJobEvidenceView; label: string; icon: typeof ActivityIcon }> = [
    { value: "timeline", label: "Timeline", icon: ActivityIcon },
    { value: "output", label: "Output", icon: ArchiveIcon },
  ];
  return (
    <nav className="flex w-fit max-w-full shrink-0 flex-wrap items-center gap-1 rounded-lg border border-border/70 bg-background p-1 text-sm" aria-label="Job evidence">
      {views.map((item) => {
        const route = createRunJobRoute({ runId, jobId, view: item.value });
        const active = item.value === view;
        const Icon = item.icon;
        return (
          <a
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 font-medium text-muted-foreground no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-muted text-foreground" : "hover:bg-muted/55 hover:text-foreground",
            )}
            href={hrefFor(route)}
            key={item.value}
            onClick={onRouteClick(route)}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

function LinkedRunTable({
  empty,
  hrefFor,
  jobs,
  onRouteClick,
  snapshot,
  title,
}: {
  empty: string;
  hrefFor: (route: WorkbenchRoute) => string;
  jobs: WorkbenchJob[];
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  snapshot: WorkbenchInspectionSnapshot;
  title: string;
}) {
  const runs = uniqueRunsForJobs(snapshot, jobs);
  return (
    <section className="min-w-0" aria-label={title}>
      {runs.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operation</TableHead>
                <TableHead>Measurement</TableHead>
                <TableHead>Quality</TableHead>
                <TableHead>Latency</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const runRoute = createRunRoute({ runId: run.id });
                const runJobs = jobsForRun(run, snapshot.jobs);
                const report = buildWorkbenchJobReport(runJobs, snapshot.traces);
                const latencyMetric = formatReportMetricStack(report, "latency", formatDurationMs);
                const costMetric = formatReportMetricStack(report, "cost", formatCost, formatReportCost(report, run.status));
                const coverage = workbenchSampleCoverageForJobs(runJobs);
                return (
                  <TableRow key={run.id} className="cursor-pointer" onClick={onRouteClick(runRoute)}>
                    <TableCell className="align-top">
                      <a className="font-medium text-primary underline-offset-4 hover:underline" href={hrefFor(runRoute)} onClick={onRouteClick(runRoute)}>
                        {runOperationLabel(run)}
                      </a>
                      <div className="mt-1"><StatusBadge status={run.status} /></div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="break-words font-medium [overflow-wrap:anywhere]">{runVersionDisplayName(snapshot, run)}</div>
                      <div className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{runAgentDisplayName(snapshot, run)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{formatCoverage(coverage)}</div>
                    </TableCell>
                    <TableCell className="align-top font-medium">{formatQualityMetric(runScore(run, snapshot.jobs))}</TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      <MetricStack
                        value={latencyMetric.value}
                        detail={latencyMetric.detail}
                      />
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      <MetricStack
                        value={costMetric.value}
                        detail={costMetric.detail}
                      />
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">{formatTimestamp(run.finishedAt ?? run.createdAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function RouteSidebar({
  hostContext,
  identity,
  route,
  snapshot,
}: {
  hostContext: WorkbenchHostContext | undefined;
  identity: SkillIdentity;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  if (route.kind === "case") {
    const evalSnapshot = selectedEvalSnapshot(snapshot, route.evalVersionId);
    const evalCase = evalSnapshot?.cases.find((entry) => entry.id === route.caseId) ?? null;
    if (evalSnapshot && evalCase) {
      return (
        <CaseContextSidebar
          evalCase={evalCase}
          evalSnapshot={evalSnapshot}
          snapshot={snapshot}
        />
      );
    }
  }
  if (route.kind === "run" || route.kind === "run-job") {
    const run = snapshot.runs.find((entry) => entry.id === route.runId) ?? null;
    if (run) {
      return <RunContextSidebar run={run} snapshot={snapshot} />;
    }
  }
  return <AboutSidebar identity={identity} snapshot={snapshot} hostContext={hostContext} />;
}

function CaseContextSidebar({
  evalCase,
  evalSnapshot,
  snapshot,
}: {
  evalCase: WorkbenchEvalCaseSnapshot;
  evalSnapshot: WorkbenchEvalSnapshot;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const jobs = jobsForCase(snapshot, evalSnapshot.hash, evalCase.id);
  const latest = latestJob(jobs);
  return (
    <aside className="grid min-w-0 gap-4 rounded-lg border border-border/70 bg-background p-4 text-sm xl:sticky xl:top-6">
      <div className="grid gap-1">
        <h2 className="text-sm font-semibold">Case</h2>
        <div className="break-words font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{evalCase.id}</div>
      </div>
      <FactGrid>
        <FactItem title="Path" value={evalCase.path} />
        <FactItem title="Files" value={formatCount(evalCase.files.length, "file")} />
        <FactItem title="Runs" value={formatCount(jobs.length, "run")} />
        <FactItem title="Latest" value={latest ? <StatusBadge status={latest.status} /> : "Not run"} />
      </FactGrid>
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold">Evaluation</h3>
        <div className="text-sm text-muted-foreground">{formatEvaluationDisplayName(evalSnapshot.hash, snapshot.evals)}</div>
        <div className="text-xs text-muted-foreground">{formatEvaluationDisplayDetail(evalSnapshot.hash, snapshot.evals)}</div>
      </div>
    </aside>
  );
}

function RunContextSidebar({
  run,
  snapshot,
}: {
  run: WorkbenchRun;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const jobs = jobsForRun(run, snapshot.jobs);
  const evidence = runEvidenceView(snapshot, run);
  const summary = runEvidenceSummary(snapshot, run, evidence, jobs);
  const primaryJob = primaryRunEvidenceJob(evidence);
  const primaryTrace = primaryRunTrace(run, jobs, snapshot.traces);
  const caseBacked = runHasCaseEvidence(run, evidence, jobs);
  return (
    <aside className="grid min-w-0 gap-4 rounded-lg border border-border/70 bg-background p-4 text-sm xl:sticky xl:top-6">
      <div className="grid gap-1">
        <h2 className="text-sm font-semibold">{runOperationLabel(run)}</h2>
        <div className="break-words font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{run.id}</div>
      </div>
      <FactGrid>
        <FactItem title="Status" value={<StatusBadge status={run.status} />} />
        <FactItem title="Operation" value={runOperationLabel(run)} />
        {caseBacked ? (
          <>
            <FactItem title="Version" value={runVersionDisplayName(snapshot, run)} />
            <FactItem title="Agent" value={runAgentDisplayName(snapshot, run)} />
            <FactItem title="Eval" value={formatEvaluationDisplayName(run.evalHash, snapshot.evals)} />
          </>
        ) : (
          <>
            <FactItem title="Skill" value={summary.subject} />
            <FactItem title="Agent" value={primaryJob?.agentLabel ?? runAgentDisplayName(snapshot, run)} />
            {primaryJob ? <FactItem title="Model" value={formatAdapterModel(primaryJob)} /> : null}
            <FactItem title="Jobs" value={formatCount(evidence.jobs.length || jobs.length, "job")} />
            {primaryTrace?.source?.sessionId ? <FactItem title="Session" value={primaryTrace.source.sessionId} /> : null}
            {primaryTrace?.source?.workspaceRoot ? <FactItem title="Project" value={primaryTrace.source.workspaceRoot} /> : null}
          </>
        )}
      </FactGrid>
    </aside>
  );
}

function AboutSidebar({
  hostContext,
  identity,
  snapshot,
}: {
  hostContext: WorkbenchHostContext | undefined;
  identity: SkillIdentity;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const casesCount = selectedEvalSnapshot(snapshot, null)?.caseCount ?? 0;
  return (
    <aside className="grid min-w-0 gap-4 rounded-lg border border-border/70 bg-background p-4 text-sm xl:sticky xl:top-6">
      <div className="grid gap-1">
        <h2 className="text-sm font-semibold">About</h2>
        <p className="break-words text-muted-foreground [overflow-wrap:anywhere]">{identity.description ?? "Workbench skill source."}</p>
      </div>
      <FactGrid>
        <FactItem title="Current" value={snapshot.status.currentVersionId ? versionNameFor(snapshot, snapshot.status.currentVersionId) : "none"} />
        <FactItem title="Published" value={publishedVersionId(snapshot) ? versionNameFor(snapshot, publishedVersionId(snapshot)) : "none"} />
        <FactItem title="Cases" value={formatCount(casesCount, "case")} />
        <FactItem title="Runs" value={formatCount(snapshot.status.runCount, "run")} />
        {hostContext?.ownerSlug ? <FactItem title="Owner" value={hostContext.ownerSlug} /> : null}
        {hostContext?.sourceVisibility ? <FactItem title="Visibility" value={hostContext.sourceVisibility} /> : null}
        {hostContext?.evidenceAccess ? <FactItem title="Access" value={hostContext.evidenceAccess === "full" ? "full evidence" : "source only"} /> : null}
      </FactGrid>
    </aside>
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
  const summary = typeof job.result?.summary === "string" ? job.result.summary.trim() : "";
  const summaryBlock = summary ? <JobResultSummary summary={summary} /> : null;
  if (!owner) {
    return summaryBlock ?? (
      <EmptyState
        icon={ArchiveIcon}
        title="No output recorded"
        message={`No output files were captured for ${job.caseId}.`}
        size="sm"
      />
    );
  }
  return (
    <div className="grid min-w-0 gap-4">
      {summaryBlock}
      <OutputFilesSurface apiBasePath={apiBasePath} ownerKind={owner.kind} ownerId={owner.id} files={owner.files} />
    </div>
  );
}

function JobResultSummary({ summary }: { summary: string }) {
  return (
    <section className="grid min-w-0 gap-3" aria-label="Result summary">
      <div className="grid min-w-0 gap-1">
        <h3 className="text-base font-semibold">Result summary</h3>
        <p className="text-sm text-muted-foreground">Recorded job result.</p>
      </div>
      <pre className="max-h-96 overflow-auto rounded-md border border-border/70 bg-muted/30 p-3 text-sm leading-6 text-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">
        {summary}
      </pre>
    </section>
  );
}

function JobEvidencePanel({
  apiBasePath,
  description,
  jobId,
  jobStatus,
  refreshToken,
  runId,
  title,
}: {
  apiBasePath: string;
  description?: string;
  jobId: string;
  jobStatus: WorkbenchJob["status"];
  refreshToken: string | null;
  runId: string;
  title?: string;
}) {
  const evidence = useJobEvidence({ apiBasePath, jobId, runId, refreshToken });
  const execution = evidence.detail?.executions.find((entry) => entry.jobIds.includes(jobId)) ?? null;
  const timeline = useMemo(
    () => buildExecutionTraceTimeline({ trace: execution?.trace as ExecutionTrace | null }),
    [execution?.trace],
  );
  useRouteLoadingSignal(evidence.loading && !execution);

  const isActiveJob = jobStatus === "queued" || jobStatus === "running";
  const panelTitle = title ?? "Timeline";
  const panelDescription = description ?? "Execution timeline and recorded trace events for this case run.";
  let content: ReactNode;
  if (!execution && isActiveJob) {
    content = (
      <p className="text-sm text-muted-foreground">
        Waiting for trace events. Run and job status update live; this panel refreshes while the job is active.
      </p>
    );
  } else if (evidence.loading && !execution) {
    content = <p className="text-sm text-muted-foreground">Loading job evidence...</p>;
  } else if (evidence.error) {
    content = <ProblemState icon={CircleAlertIcon} title="Couldn't load job evidence" message={evidence.error} align="start" />;
  } else if (!execution) {
    content = <EmptyState icon={ActivityIcon} title="No execution evidence" message="No evidence is recorded for this job." size="sm" />;
  } else if (timeline.groups.length === 0) {
    content = <EmptyState icon={ActivityIcon} title="No timeline evidence" message={isActiveJob ? "Waiting for live trace events." : "No trace events were recorded for this job."} size="sm" />;
  } else {
    content = (
      <>
        <FactGrid>
          <FactItem title="Execution status" value={execution.status} />
          <FactItem title="Sessions" value={formatCount(execution.sessions.length, "session")} />
          <FactItem title="Events" value={formatCount(execution.trace.events.length, "event")} />
          <FactItem title="Spans" value={formatCount(execution.trace.spans.length, "span")} />
        </FactGrid>
        <ExecutionTraceTimeline executionTimeline={timeline} layout="content" />
      </>
    );
  }
  return (
    <section className="grid min-w-0 gap-4" aria-label={panelTitle}>
      <div className="grid min-w-0 gap-1">
        <h3 className="text-base font-semibold">{panelTitle}</h3>
        <p className="text-sm text-muted-foreground">{panelDescription}</p>
      </div>
      {content}
    </section>
  );
}

function OutputFilesSurface({
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
    <OutputRepositorySurface
      apiBasePath={apiBasePath}
      ownerKind={ownerKind}
      ownerId={ownerId}
      files={files}
      file={file}
      onFileChange={(nextFile) => setFile(nextFile)}
    />
  );
}

function OutputRepositorySurface({
  apiBasePath,
  file,
  files,
  onFileChange,
  ownerId,
  ownerKind,
}: {
  apiBasePath: string;
  file: WorkbenchFileRouteState;
  files: readonly SurfaceSnapshotFile[];
  onFileChange: (file: WorkbenchFileRouteState, options?: { replace?: boolean }) => void;
  ownerId: string;
  ownerKind: WorkbenchFileOwnerKind;
}) {
  const reportRouteLoading = useRouteLoadingReporter();

  return (
    <section className="grid min-w-0 gap-4" aria-label="Output">
      <div className="grid min-w-0 gap-1">
        <h3 className="text-base font-semibold">Output</h3>
        <p className="text-sm text-muted-foreground">Captured files produced by this case run.</p>
      </div>
      <RepositoryFilesView
        apiBasePath={apiBasePath}
        file={file}
        files={files}
        ownerId={ownerId}
        ownerKind={ownerKind}
        repositoryLabel="Output files"
        onFileChange={onFileChange}
        onLoadingChange={reportRouteLoading}
      />
    </section>
  );
}

function WorkbenchBreadcrumbs({
  className,
  hrefFor,
  onRouteClick,
  route,
  snapshot,
}: {
  className?: string;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const items = breadcrumbItems(route, snapshot);
  if (items.length === 0) {
    return null;
  }
  return (
    <Breadcrumb className={cn("min-w-0", className)}>
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

function breadcrumbItems(route: WorkbenchRoute, snapshot: WorkbenchInspectionSnapshot | null): Array<{ label: string; route?: WorkbenchRoute }> {
  if (route.kind === "files") {
    return [];
  }
  if (route.kind === "evaluation") {
    return [{
      label: route.view === "cases" ? "Cases" : "Results",
    }];
  }
  if (route.kind === "case") {
    return [
      { label: "Cases", route: createEvaluationRoute({ view: "cases", evalVersionId: route.evalVersionId }) },
      { label: route.caseId },
    ];
  }
  if (route.kind === "runs") {
    return [{ label: "Runs" }];
  }
  if (route.kind === "run" || route.kind === "run-job") {
    const run = snapshot?.runs.find((entry) => entry.id === route.runId) ?? null;
    const items: Array<{ label: string; route?: WorkbenchRoute }> = [
      { label: "Runs", route: createRunsRoute() },
      { label: run && snapshot ? runDisplayTitle(run, snapshot) : shortId(route.runId), route: route.kind === "run-job" ? createRunRoute({ runId: route.runId }) : undefined },
    ];
    if (route.kind === "run-job") {
      const job = snapshot?.jobs.find((entry) => entry.id === route.jobId && entry.runId === route.runId) ?? null;
      items.push({ label: job ? formatJobRoleLabel(job.role ?? job.kind) : shortId(route.jobId) });
    }
    return items;
  }
  return [{ label: "Not found" }];
}

function WorkbenchRunsSummary({
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
  const label = loading && !lastUpdatedAt ? "Loading state" : activeWorkbenchWorkLabel(activeWork);
  const secondary = runsSecondaryLabel(snapshot, lastUpdatedAt, refreshing, error);
  const tone = badgeToneProps(error
    ? "destructive"
    : activeWork.hasActiveWork
      ? "warning"
      : "outline");
  return (
    <div data-testid="workbench-runs-summary" className="flex min-w-0 items-center justify-start gap-2 text-xs md:justify-end">
      <Badge variant={tone.variant} className={cn("max-w-[11rem] truncate", tone.className)} title={label}>
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
  const orphanRunningRuns = snapshot.runs.filter((run) => run.status === "running" && jobsForRun(run, activeJobs).length === 0);
  const running = activeJobs.filter((job) => job.status === "running").length + orphanRunningRuns.length;
  const queued = activeJobs.filter((job) => job.status === "queued").length;
  return { queued, running, hasActiveWork: queued > 0 || running > 0 };
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

function isRunActive(run: WorkbenchRun, jobs: readonly WorkbenchJob[]): boolean {
  if (run.status === "queued" || run.status === "running") {
    return true;
  }
  return jobsForRun(run, jobs).some((job) => job.status === "queued" || job.status === "running");
}

function isJobTerminal(job: WorkbenchJob): boolean {
  return job.status === "succeeded" || job.status === "failed" || job.status === "canceled";
}

function runsSecondaryLabel(
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
    ...snapshot.evals.map((entry) => entry.updatedAt),
    ...snapshot.runs.map((run) => run.finishedAt ?? run.createdAt),
    ...snapshot.jobs.map((job) => job.finishedAt ?? job.startedAt ?? job.createdAt),
    ...snapshot.traces.map((trace) => trace.createdAt),
    ...snapshot.executionEvents.map((batch) => batch.emittedAt),
    ...snapshot.artifacts.map((artifact) => artifact.createdAt),
    ...snapshot.lineage.map((edge) => edge.createdAt),
  ].filter(Boolean);
  return timestamps.sort().at(-1) ?? null;
}

function useJobEvidence({
  apiBasePath,
  jobId,
  refreshToken,
  runId,
}: {
  apiBasePath: string;
  jobId: string;
  refreshToken: string | null;
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
        const response = await fetch(jobEvidenceApiPath(apiBasePath, runId, jobId), { signal: controller.signal });
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
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBasePath, jobId, refreshToken, runId]);

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

function DetailPageHeader({
  description,
  eyebrow,
  meta,
  title,
}: {
  description?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  title: ReactNode;
}) {
  return (
    <header className="flex min-w-0 flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="grid min-w-0 gap-1.5">
        {eyebrow ? <div className="text-xs font-medium text-muted-foreground">{eyebrow}</div> : null}
        <h2 className="break-words text-xl font-semibold leading-tight text-foreground [overflow-wrap:anywhere]">
          {title}
        </h2>
        {description ? (
          <p className="max-w-3xl break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
            {description}
          </p>
        ) : null}
      </div>
      {meta ? <div className="flex shrink-0 flex-wrap items-center gap-2">{meta}</div> : null}
    </header>
  );
}

interface MetricStripItem {
  detail?: ReactNode;
  label: string;
  value: ReactNode;
}

function MetricStrip({ items }: { items: MetricStripItem[] }) {
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="grid min-w-0 gap-1 rounded-lg border border-border/70 bg-background px-3 py-3">
          <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
          <div className="break-words text-sm font-semibold leading-5 text-foreground [overflow-wrap:anywhere]">{item.value}</div>
          {item.detail ? <div className="break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{item.detail}</div> : null}
        </div>
      ))}
    </div>
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
      <div className="break-words text-xs font-medium text-muted-foreground [overflow-wrap:anywhere]">{title}</div>
      <div className="break-words text-sm font-semibold leading-5 text-foreground [overflow-wrap:anywhere]">{value}</div>
      {detail ? <div className="break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{detail}</div> : null}
    </div>
  );
}

function CopyIconButton({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      aria-label={`Copy ${label}`}
      className="text-muted-foreground"
      size="icon-xs"
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

function resultLabelContext(
  snapshot: WorkbenchInspectionSnapshot,
  overrides: Partial<ResultLabelContext> = {},
): ResultLabelContext {
  return {
    allVersions: snapshot.versions,
    currentVersionId: snapshot.status.currentVersionId,
    defaultSkill: snapshot.status.defaultSkill,
    publishedVersionId: publishedVersionId(snapshot),
    ...overrides,
  };
}

function selectedEvalSnapshot(snapshot: WorkbenchInspectionSnapshot, evalVersionId: string | null): WorkbenchEvalSnapshot | null {
  const hash = evalVersionId
    ? evalVersionHashForRef(snapshot, evalVersionId)
    : defaultEvalVersion(snapshot)?.hash;
  return hash ? snapshot.evals.find((entry) => entry.hash === hash) ?? null : null;
}

function defaultEvalVersion(snapshot: WorkbenchInspectionSnapshot): WorkbenchInspectionSnapshot["evalVersions"][number] | undefined {
  const ordered = [...snapshot.evalVersions].sort((left, right) =>
    left.ordinal - right.ordinal || left.id.localeCompare(right.id)
  );
  return ordered.find((entry) => entry.current) ?? ordered.at(-1);
}

function evalVersionHashForRef(snapshot: WorkbenchInspectionSnapshot, ref: string): string | undefined {
  const normalized = ref.trim();
  if (!normalized) {
    return undefined;
  }
  const normalizedLabel = normalized.toLowerCase();
  return snapshot.evalVersions.find((entry) =>
    entry.id === normalized ||
    entry.hash === normalized ||
    entry.hash.startsWith(normalized) ||
    entry.label.toLowerCase() === normalizedLabel
  )?.hash;
}

function evalVersionIdForHash(snapshot: WorkbenchInspectionSnapshot, hash: string): string | undefined {
  return snapshot.evalVersions.find((entry) => entry.hash === hash)?.id;
}

function jobsForCase(snapshot: WorkbenchInspectionSnapshot, evalHash: string, caseId: string): WorkbenchJob[] {
  return snapshot.jobs
    .filter((job) => job.evalHash === evalHash && job.caseId === caseId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
}

function latestJob(jobs: readonly WorkbenchJob[]): WorkbenchJob | null {
  return [...jobs].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id))[0] ?? null;
}

function uniqueRunsForJobs(snapshot: WorkbenchInspectionSnapshot, jobs: readonly WorkbenchJob[]): WorkbenchRun[] {
  const jobIds = new Set(jobs.map((job) => job.id));
  const runIds = new Set(jobs.map((job) => job.runId));
  return snapshot.runs
    .filter((run) => runIds.has(run.id) || (run.jobIds ?? []).some((jobId) => jobIds.has(jobId)))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
}

type InspectionResults = NonNullable<WorkbenchInspectionSnapshot["results"]>;
type InspectionResultVersion = InspectionResults["skillVersions"][number];
type InspectionResultAgent = InspectionResults["agentVersions"][number];

function runEvidenceView(snapshot: WorkbenchInspectionSnapshot, run: WorkbenchRun): WorkbenchRunEvidenceView {
  return buildWorkbenchRunEvidenceView(snapshot, run) ?? {
    runId: run.id,
    measurements: [],
    jobGroups: [],
    cases: [],
    jobs: [],
  };
}

function runHasCaseEvidence(
  run: WorkbenchRun,
  evidence: WorkbenchRunEvidenceView,
  jobs: readonly WorkbenchJob[],
): boolean {
  return evidence.cases.length > 0 ||
    jobs.some((job) => job.caseId !== "current") ||
    run.kind === "run" ||
    run.kind === "grade" ||
    run.kind === "eval" ||
    run.operationPlan?.kind === "run" ||
    run.operationPlan?.kind === "grade" ||
    run.operationPlan?.kind === "eval";
}

function primaryRunEvidenceJob(evidence: WorkbenchRunEvidenceView): WorkbenchRunEvidenceJob | null {
  return evidence.jobs[0] ?? null;
}

function primaryRunTrace(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
  traces: readonly WorkbenchTrace[],
): WorkbenchTrace | null {
  const traceIds = new Set([...run.traceIds, ...jobs.flatMap((job) => job.traceIds)]);
  return traces.find((trace) => trace.runId === run.id || traceIds.has(trace.id)) ?? null;
}

function runEvidenceSummary(
  snapshot: WorkbenchInspectionSnapshot,
  run: WorkbenchRun,
  evidence: WorkbenchRunEvidenceView,
  jobs: readonly WorkbenchJob[],
): { subject: string; context: string; detail: string; caseBacked: boolean } {
  const caseBacked = runHasCaseEvidence(run, evidence, jobs);
  if (caseBacked) {
    return {
      subject: runVersionDisplayName(snapshot, run),
      context: `${runAgentDisplayName(snapshot, run)} / ${formatEvaluationDisplayName(run.evalHash, snapshot.evals)}`,
      detail: formatCoverage(workbenchSampleCoverageForJobs(jobs)),
      caseBacked,
    };
  }
  const primaryJob = primaryRunEvidenceJob(evidence);
  return {
    subject: primaryJob ? formatSkillLabel(primaryJob) : run.skillName || runVersionDisplayName(snapshot, run),
    context: primaryJob ? formatEvidenceAgentModel(primaryJob) : runAgentDisplayName(snapshot, run),
    detail: formatCount(evidence.jobs.length || jobs.length, "job"),
    caseBacked,
  };
}

function formatEvidenceAgentModel(
  job: Pick<WorkbenchRunEvidenceJob, "agentLabel" | "adapter" | "model">,
): string {
  const label = compactDisplayPart(job.agentLabel);
  const adapter = compactDisplayPart(job.adapter);
  const model = compactDisplayPart(job.model);
  const labelParts = label ? displayParts(label) : [];
  return [
    label,
    adapter && !displayPartsInclude(labelParts, adapter) ? adapter : null,
    model && !displayPartsInclude(labelParts, model) ? model : null,
  ].filter((part): part is string => Boolean(part)).join(" / ");
}

function compactDisplayPart(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function displayParts(value: string): string[] {
  return value.split("/").map((part) => part.trim()).filter(Boolean);
}

function displayPartsInclude(parts: readonly string[], value: string): boolean {
  const normalized = value.toLowerCase();
  return parts.some((part) => part.toLowerCase() === normalized);
}

function runDisplayTitle(
  run: WorkbenchRun,
  snapshot: WorkbenchInspectionSnapshot,
  evidence: WorkbenchRunEvidenceView = runEvidenceView(snapshot, run),
  jobs: readonly WorkbenchJob[] = jobsForRun(run, snapshot.jobs),
): string {
  const summary = runEvidenceSummary(snapshot, run, evidence, jobs);
  if (summary.caseBacked) {
    return `${runOperationLabel(run)}: ${summary.subject} on ${formatEvaluationDisplayName(run.evalHash, snapshot.evals)}`;
  }
  return summary.context
    ? `${runOperationLabel(run)}: ${summary.subject} with ${summary.context}`
    : `${runOperationLabel(run)}: ${summary.subject}`;
}

function runDescription(
  run: WorkbenchRun,
  snapshot: WorkbenchInspectionSnapshot,
  evidence: WorkbenchRunEvidenceView,
  jobs: readonly WorkbenchJob[],
): string {
  const summary = runEvidenceSummary(snapshot, run, evidence, jobs);
  return `${runOperationLabel(run)} from ${formatTimestamp(run.createdAt)} with ${summary.detail.toLowerCase()}.`;
}

function runOperationLabel(run: WorkbenchRun): string {
  const base = run.kind === "improve"
    ? "Improve"
    : run.kind === "grade"
      ? "Grade"
      : run.kind === "run"
        ? "Run"
        : run.kind === "live"
          ? "Live session"
          : "Eval";
  return run.retryOfRunId ? `Retry ${base.toLowerCase()}` : base;
}

function runVersionDisplayName(snapshot: WorkbenchInspectionSnapshot, run: WorkbenchRun): string {
  const resultVersions = runResultVersions(snapshot, run);
  if (resultVersions.length === 1) {
    return resultVersions[0]!.label;
  }
  if (resultVersions.length > 1) {
    return formatCount(resultVersions.length, "version");
  }
  const outputVersion = run.outputVersionId
    ? resultVersionForProjectVersionId(snapshot, run.outputVersionId)
    : null;
  if (outputVersion) {
    return outputVersion.label;
  }
  const sourceLabel = runSourceVersionDisplayName(snapshot, run);
  if (sourceLabel) {
    return sourceLabel;
  }
  const baseVersion = resultVersionForProjectVersionId(snapshot, run.versionId);
  if (baseVersion) {
    return baseVersion.label;
  }
  return formatVersionDisplayName(run.outputVersionId ?? run.versionId, snapshot.versions, resultLabelContext(snapshot));
}

function runAgentDisplayName(snapshot: WorkbenchInspectionSnapshot, run: WorkbenchRun): string {
  const resultAgents = runResultAgents(snapshot, run);
  if (resultAgents.length === 1) {
    return resultAgents[0]!.label;
  }
  if (resultAgents.length > 1) {
    return formatCount(resultAgents.length, "agent");
  }
  return snapshot.results?.agentVersions.find((agent) => agent.id === run.agentHash)?.label ?? run.agentName;
}

function jobAgentDisplayName(snapshot: WorkbenchInspectionSnapshot, job: WorkbenchJob): string {
  return snapshot.results?.agentVersions.find((agent) => agent.id === job.agentHash)?.label ?? job.agentName;
}

function runResultVersions(snapshot: WorkbenchInspectionSnapshot, run: WorkbenchRun): InspectionResults["skillVersions"] {
  const results = snapshot.results;
  if (!results) {
    return [];
  }
  const versionById = new Map(results.skillVersions.map((version) => [version.id, version]));
  const versions = new Map<string, InspectionResultVersion>();
  for (const cell of results.cells) {
    if (cell.runId !== run.id) {
      continue;
    }
    const version = versionById.get(cell.skillVersionId);
    if (version) {
      versions.set(version.id, version);
    }
  }
  return [...versions.values()];
}

function runResultAgents(snapshot: WorkbenchInspectionSnapshot, run: WorkbenchRun): InspectionResults["agentVersions"] {
  const results = snapshot.results;
  if (!results) {
    return [];
  }
  const agentById = new Map(results.agentVersions.map((agent) => [agent.id, agent]));
  const agents = new Map<string, InspectionResultAgent>();
  for (const cell of results.cells) {
    if (cell.runId !== run.id) {
      continue;
    }
    const agent = agentById.get(cell.agentVersionId);
    if (agent) {
      agents.set(agent.id, agent);
    }
  }
  return [...agents.values()];
}

function resultVersionForProjectVersionId(
  snapshot: WorkbenchInspectionSnapshot,
  projectVersionId: string,
): InspectionResultVersion | null {
  return snapshot.results?.skillVersions.find((version) =>
    version.projectVersionId === projectVersionId || version.id === projectVersionId
  ) ?? null;
}

function runSourceVersionDisplayName(snapshot: WorkbenchInspectionSnapshot, run: WorkbenchRun): string | null {
  const source = runSkillSource(snapshot, run);
  if (run.skillName === "no-skill" || source?.kind === "none" || source?.source === "none") {
    return source?.label?.trim() || "No skill";
  }
  if (!source) {
    return null;
  }
  if (source.kind === "remote") {
    return source.label?.trim() || source.source?.trim() || source.from?.trim() || null;
  }
  if (source.kind === "local" && source.name !== "current") {
    return source.label?.trim() || null;
  }
  return null;
}

function runSkillSource(snapshot: WorkbenchInspectionSnapshot, run: WorkbenchRun): WorkbenchSkillSource | null {
  const bundle = snapshot.skillBundles.find((entry) =>
    entry.hash === run.skillBundleHash && entry.skillName === run.skillName
  ) ?? snapshot.skillBundles.find((entry) => entry.hash === run.skillBundleHash);
  return bundle?.source ?? snapshot.skillSources.find((source) => source.name === run.skillName) ?? null;
}

function versionNameFor(snapshot: WorkbenchInspectionSnapshot, versionId: string | null | undefined): string {
  return versionId ? formatVersionDisplayName(versionId, snapshot.versions, resultLabelContext(snapshot)) : "none";
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
