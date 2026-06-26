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
  PlayCircleIcon,
  RefreshCwIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";

import {
  buildWorkbenchRunEvidenceView,
  isWorkbenchPackageSourcePath,
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
  WorkbenchJob,
  WorkbenchRun,
  WorkbenchRunEvidenceCaseResult,
  WorkbenchRunEvidenceJobPhase,
  WorkbenchRunEvidenceTraceJob,
  WorkbenchRunEvidenceView,
  WorkbenchRunSnapshot,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workbench-ai/cli-web-ui/components/ui/popover";
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
  formatRunCost,
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
  createRunRoute,
  createRunsRoute,
  emptyFileRouteState,
  parseWorkbenchLocation,
  routePrimaryTab,
  withEvaluationId,
  withFileRouteState,
  type WorkbenchEvaluationView,
  type WorkbenchFileOwnerKind,
  type WorkbenchFileRouteState,
  type WorkbenchPrimaryTab,
  type WorkbenchRunCaseEvidenceView,
  type WorkbenchRunCasePhase,
  type WorkbenchRoute,
} from "./lib/routes";
import {
  routeForWorkbenchRunSnapshot,
} from "./lib/operations";
import type { VersionLineageFlow } from "./lib/lineage";
import {
  defaultSourceVersion,
  orderedVersions,
  publishedVersionId,
} from "./lib/version-selection";

export type { WorkbenchOperationPreviewState } from "./components/workbench-action-bar";
import {
  buildComparisonEvidenceRows,
  buildComparisonGroups,
  comparisonForScorecard,
  defaultEvaluationIdForScorecard,
  evaluationOptionsForScorecard,
  formatEvaluationDisplayDetail,
  formatEvaluationDisplayName,
  formatVersionDisplayName,
  missingCostLabelForStatus,
  resultVersionGroupId,
  type ComparisonEvaluationOption,
  type ComparisonEvidenceRow,
  type ComparisonLabelContext,
} from "./lib/comparison-metrics";

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
  { value: "source", label: "Source", icon: FolderOpenIcon },
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

export function workbenchRouteRequiresEvidence(route: WorkbenchRoute): boolean {
  switch (route.kind) {
    case "evaluation":
      return route.view === "results";
    case "case":
      return route.section === "runs";
    case "runs":
    case "run":
      return true;
    case "files":
    case "not-found":
      return false;
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
  const routeNeedsEvidenceRefresh = Boolean(
    snapshot &&
    workbenchRouteRequiresEvidence(route) &&
    workbenchSnapshotNeedsEvidenceRefresh(snapshot),
  );
  const evidenceRefreshSignature = useMemo(() => {
    if (!routeNeedsEvidenceRefresh) {
      return null;
    }
    return `${inspectionCursor ?? "no-cursor"}:${route.kind}`;
  }, [inspectionCursor, route.kind, routeNeedsEvidenceRefresh]);
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
  const routeFeedbackActive = loading || refreshing || routePending || routeLoadingIds.size > 0 || routeNeedsEvidenceRefresh;
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
                message="Reading evaluation and run details."
                scope="pane"
              />
            ) : (
              <RouteBody
                apiBasePath={apiBasePath}
                hrefFor={hrefFor}
                inspectionCursor={inspectionCursor}
                navigate={navigate}
                onRouteClick={onRouteClick}
                progressCursor={progressCursor}
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
      return createEvaluationRoute({ view: "results", evaluationId: route.kind === "evaluation" || route.kind === "case" || route.kind === "run" ? route.evaluationId : null });
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
  apiBasePath,
  hrefFor,
  inspectionCursor,
  navigate,
  onRouteClick,
  progressCursor,
  route,
  snapshot,
  versionHistoryDialog,
}: {
  apiBasePath: string;
  hrefFor: (route: WorkbenchRoute) => string;
  inspectionCursor: string | null;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  progressCursor: string | null;
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
          apiBasePath={apiBasePath}
          hrefFor={hrefFor}
          navigate={navigate}
          onRouteClick={onRouteClick}
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
  route: Extract<WorkbenchRoute, { kind: "evaluation" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const results = comparisonForScorecard(snapshot);
  const evaluationOptions = evaluationOptionsForScorecard(snapshot, results);
  const defaultEvaluationId = defaultEvaluationIdForScorecard(evaluationOptions);
  const activeEvaluationId = route.evaluationId && evaluationOptions.some((option) => option.id === route.evaluationId)
    ? route.evaluationId
    : defaultEvaluationId;
  const labelContext = comparisonLabelContext(snapshot);
  const groups = buildComparisonGroups(results, labelContext);
  const rows = buildComparisonEvidenceRows({
    groups,
    context: labelContext,
    agents: results.agents,
    runs: snapshot.runs,
  });
  const visibleRows = activeEvaluationId
    ? rows.filter((row) => row.evalHash === activeEvaluationId)
    : rows;
  const selectedEvaluation = activeEvaluationId
    ? evaluationOptions.find((option) => option.id === activeEvaluationId) ?? null
    : null;
  const showEvaluationSelector = evaluationOptions.length > 0 && typeof activeEvaluationId === "string";
  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ViewSwitch
          ariaLabel="Evaluation views"
          value={route.view}
          items={EVALUATION_VIEW_ITEMS}
          onValueChange={(value) => {
            if (value === "results" || value === "cases" || value === "source") {
              navigate(createEvaluationRoute({ view: value, evaluationId: activeEvaluationId ?? route.evaluationId, file: route.file }));
            }
          }}
        />
        {showEvaluationSelector ? (
          <EvaluationSelect
            options={evaluationOptions}
            value={activeEvaluationId}
            onValueChange={(evaluationId) => navigate(withEvaluationId(route, evaluationId), { replace: false })}
          />
        ) : null}
      </div>
      {route.view === "source" ? (
        <EvaluationSourceFiles
          apiBasePath={apiBasePath}
          evaluationId={activeEvaluationId}
          file={route.file}
          snapshot={snapshot}
          onFileChange={(nextFile, options) => navigate(withFileRouteState(route, nextFile), options)}
        />
      ) : route.view === "cases" ? (
        <EvaluationCases route={route} snapshot={snapshot} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      ) : (
        <EvaluationResults
          evaluationId={activeEvaluationId}
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

function EvaluationSourceFiles({
  apiBasePath,
  evaluationId,
  file,
  onFileChange,
  snapshot,
}: {
  apiBasePath: string;
  evaluationId: string | null;
  file: WorkbenchFileRouteState;
  onFileChange: (file: WorkbenchFileRouteState, options?: { replace?: boolean }) => void;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const reportRouteLoading = useRouteLoadingReporter();
  const selectedEvaluation = selectedEvalSnapshot(snapshot, evaluationId);
  const files = snapshot.evaluationFiles ?? selectedEvaluation?.files ?? [];
  if (files.length === 0) {
    return <EmptyState icon={FileTextIcon} title="No evaluation source" message="Evaluation source appears after Workbench observes .workbench authored files." variant="hero" size="sm" />;
  }
  const defaultFilePath = files.some((entry) => entry.path === "eval.yaml")
    ? "eval.yaml"
    : files.find((entry) => entry.path === "environment/Dockerfile")?.path ?? files[0]?.path ?? null;
  const ownerId = snapshot.evaluationFiles ? "current" : selectedEvaluation?.hash ?? "current";
  return (
    <section className="grid min-w-0 gap-4" aria-label="Evaluation source">
      <RepositoryFilesView
        apiBasePath={apiBasePath}
        defaultFilePath={defaultFilePath}
        file={file}
        files={files}
        ownerId={ownerId}
        ownerKind="evaluation"
        repositoryLabel="Evaluation source"
        onFileChange={onFileChange}
        onLoadingChange={reportRouteLoading}
      />
    </section>
  );
}

/**
 * Build the sorted scorecard result rows for a snapshot, mirroring what the
 * Evaluation → Results view renders. By default it returns rows for the
 * snapshot's default evaluation; pass `evaluationId` to select a specific one,
 * or `null` for all.
 */
export function buildEvaluationResultRows(
  snapshot: WorkbenchInspectionSnapshot,
  options: { evaluationId?: string | null } = {},
): ComparisonEvidenceRow[] {
  const results = comparisonForScorecard(snapshot);
  const context = comparisonLabelContext(snapshot);
  const groups = buildComparisonGroups(results, context);
  const rows = sortLeaderboardRows(
    buildComparisonEvidenceRows({
      groups,
      context,
      agents: results.agents,
      runs: snapshot.runs,
    }),
  );
  const evaluationId = "evaluationId" in options
    ? options.evaluationId
    : defaultEvaluationIdForScorecard(evaluationOptionsForScorecard(snapshot, results));
  return evaluationId ? rows.filter((row) => row.evalHash === evaluationId) : rows;
}

function EvaluationResults({
  evaluationId,
  hasResults,
  hrefFor,
  onRouteClick,
  rows,
  selectedEvaluation,
  snapshot,
}: {
  evaluationId: string | null;
  hasResults: boolean;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  rows: ComparisonEvidenceRow[];
  selectedEvaluation: ComparisonEvaluationOption | null;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const sortedRows = useMemo(() => sortLeaderboardRows(rows), [rows]);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ActivityIcon}
        eyebrow={selectedEvaluation?.label ?? "Evaluation"}
        title={hasResults ? "No results for this evaluation" : "No runs yet"}
        message={hasResults
          ? "This evaluation has no recorded scorecard rows."
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
        evaluationId={evaluationId}
        hrefFor={hrefFor}
        onRouteClick={onRouteClick}
        rows={sortedRows}
        snapshot={snapshot}
      />
    </section>
  );
}

export function EvaluationLeaderboard({
  evaluationId = null,
  hrefFor,
  maxRows,
  onRouteClick,
  rows,
  snapshot,
}: {
  evaluationId?: string | null;
  hrefFor?: (route: WorkbenchRoute) => string;
  maxRows?: number;
  onRouteClick?: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  rows: ComparisonEvidenceRow[];
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
  const jobsByRunId = useMemo(
    () => new Map(snapshot.runs.map((run) => [run.id, jobsForRun(run, snapshot.jobs)])),
    [snapshot.jobs, snapshot.runs],
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
      <Table data-testid="evaluation-results-leaderboard" className="min-w-[49rem]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[12rem]">Agent</TableHead>
            <TableHead className="w-[7.5rem]">Status</TableHead>
            <TableHead className="w-[5.5rem]">Cases</TableHead>
            <TableHead className="w-[5.5rem]">Quality</TableHead>
            <TableHead className="w-[6.5rem]">Latency</TableHead>
            <TableHead className="w-[8rem]">Cost</TableHead>
            <TableHead className="w-[8.5rem]">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <Fragment key={group.id}>
              <TableRow data-testid="evaluation-results-version-group" className="hover:bg-transparent">
                <TableCell colSpan={7} className="bg-muted/35 py-2 font-medium text-foreground">
                  <span className="break-words [overflow-wrap:anywhere]">
                    {group.label}
                  </span>
                </TableCell>
              </TableRow>
              {group.rows.map((row) => {
                const run = row.runId ? runsById.get(row.runId) ?? null : null;
                const jobs = run ? jobsByRunId.get(run.id) ?? [] : [];
                const runRoute = hrefFor && onRouteClick && row.runId
                  ? createRunRoute({ runId: row.runId, source: "evaluation", evaluationId })
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
                    </TableCell>
                    <TableCell className="align-top">
                      {row.status ? (
                        <StatusBadge status={row.status} />
                      ) : (
                        <Badge variant="outline">{row.statusLabel}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">{formatLeaderboardCases(row, jobs)}</TableCell>
                    <TableCell className="align-top font-medium">{formatScore(row.score)}</TableCell>
                    <TableCell className="align-top text-muted-foreground">{formatDurationMs(row.latencyMs)}</TableCell>
                    <TableCell className="align-top text-muted-foreground">{formatLeaderboardCost(row)}</TableCell>
                    <TableCell className="align-top text-muted-foreground">{formatTimestamp(run?.finishedAt ?? run?.createdAt)}</TableCell>
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
  rows: ComparisonEvidenceRow[];
}

function buildLeaderboardGroups(rows: readonly ComparisonEvidenceRow[]): LeaderboardGroup[] {
  const rowsByGroup = new Map<string, ComparisonEvidenceRow[]>();
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
  onValueChange: (evaluationId: string) => void;
  options: ComparisonEvaluationOption[];
  value: string;
}) {
  const selectedOption = options.find((option) => option.id === value);
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="sm"
        aria-label="Select evaluation"
        data-testid="evaluation-select"
      >
        <SelectValue placeholder="Evaluation">{selectedOption?.label}</SelectValue>
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

function sortLeaderboardRows(rows: readonly ComparisonEvidenceRow[]): ComparisonEvidenceRow[] {
  return [...rows].sort((left, right) =>
    compareOptionalNumber(left.score, right.score, "desc") ||
    compareOptionalNumber(left.latencyMs, right.latencyMs, "asc") ||
    compareOptionalNumber(left.versionOrdinal, right.versionOrdinal, "desc") ||
    compareText(left.setupLabel, right.setupLabel) ||
    compareText(left.agentName, right.agentName) ||
    compareText(left.rowId, right.rowId)
  );
}

function formatLeaderboardCases(row: ComparisonEvidenceRow, jobs: readonly WorkbenchJob[]): string {
  const coverage = caseSampleCoverage(jobs);
  if (coverage.total > 0) {
    return `${coverage.completed}/${coverage.total}`;
  }
  if (typeof row.samples === "number" && Number.isFinite(row.samples)) {
    return `${row.samples}/${row.samples}`;
  }
  return "n/a";
}

function formatLeaderboardCost(row: ComparisonEvidenceRow): string {
  return typeof row.costUsd === "number" && Number.isFinite(row.costUsd)
    ? formatCost(row.costUsd)
    : missingCostLabelForStatus(row.statusLabel, Boolean(row.runId));
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
  hrefFor,
  onRouteClick,
  route,
  snapshot,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  route: Extract<WorkbenchRoute, { kind: "evaluation" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const evalSnapshot = selectedEvalSnapshot(snapshot, route.evaluationId);
  if (!evalSnapshot) {
    return <EmptyState icon={FileTextIcon} title="No evaluation cases" message="Cases appear after Workbench observes .workbench/cases." variant="hero" size="sm" />;
  }
  if (evalSnapshot.cases.length === 0) {
    return <EmptyState icon={FileTextIcon} title="No cases in this evaluation" message="Add authored cases under .workbench/cases and run Workbench again." variant="hero" size="sm" />;
  }
  return (
    <section className="min-w-0" aria-label="Cases">
      <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case</TableHead>
              <TableHead>Grading</TableHead>
              <TableHead>Runs</TableHead>
              <TableHead>Latest</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {evalSnapshot.cases.map((evalCase) => {
              const jobs = jobsForCase(snapshot, evalSnapshot.hash, evalCase.id);
              const latest = latestJob(jobs);
              const caseRoute = createCaseRoute({ caseId: evalCase.id, evaluationId: evalSnapshot.hash });
              return (
                <TableRow key={evalCase.id} className="cursor-pointer" onClick={onRouteClick(caseRoute)}>
                  <TableCell>
                    <a className="font-medium text-primary underline-offset-4 hover:underline" href={hrefFor(caseRoute)} onClick={onRouteClick(caseRoute)}>
                      {caseDisplayTitle(evalCase)}
                    </a>
                    {showCaseSecondaryId(evalCase) ? (
                      <div className="text-xs text-muted-foreground">{evalCase.id}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <GradePlanCompact evalCase={evalCase} />
                  </TableCell>
                  <TableCell>{formatCount(jobs.length, "job")}</TableCell>
                  <TableCell>{latest ? <StatusBadge status={latest.status} /> : <span className="text-muted-foreground">Not run</span>}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
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
  const evalSnapshot = selectedEvalSnapshot(snapshot, route.evaluationId);
  const evalCase = evalSnapshot?.cases.find((entry) => entry.id === route.caseId) ?? null;
  if (!evalSnapshot || !evalCase) {
    return <MissingObject label={`Case ${route.caseId}`} />;
  }
  const jobs = jobsForCase(snapshot, evalSnapshot.hash, evalCase.id);
  const definitionRoute = createCaseRoute({ caseId: evalCase.id, evaluationId: evalSnapshot.hash, section: "definition", file: route.file });
  const runsRoute = createCaseRoute({ caseId: evalCase.id, evaluationId: evalSnapshot.hash, section: "runs" });
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
            source="evaluation"
            evaluationId={evalSnapshot.hash}
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
              <TableHead>Status</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Evaluation</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => {
              const runRoute = createRunRoute({ runId: run.id, source: "runs" });
              return (
                <TableRow key={run.id} className="cursor-pointer" onClick={onRouteClick(runRoute)}>
                  <TableCell>
                    <a className="font-medium text-primary underline-offset-4 hover:underline" href={hrefFor(runRoute)} onClick={onRouteClick(runRoute)}>
                      {runOperationLabel(run)}
                    </a>
                  </TableCell>
                  <TableCell><StatusBadge status={run.status} /></TableCell>
                  <TableCell className="break-words text-muted-foreground [overflow-wrap:anywhere]">{runVersionDisplayName(snapshot, run)}</TableCell>
                  <TableCell className="break-words text-muted-foreground [overflow-wrap:anywhere]">{runAgentDisplayName(snapshot, run)}</TableCell>
                  <TableCell className="break-words text-muted-foreground [overflow-wrap:anywhere]">{formatEvaluationDisplayName(run.evalHash, snapshot.evals)}</TableCell>
                  <TableCell>{formatScore(runScore(run, snapshot.jobs))}</TableCell>
                  <TableCell className="text-muted-foreground">{formatTimestamp(run.finishedAt ?? run.createdAt)}</TableCell>
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
  route: Extract<WorkbenchRoute, { kind: "run" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const run = snapshot.runs.find((entry) => entry.id === route.runId) ?? null;
  if (!run) {
    return <MissingObject label={`Run ${route.runId}`} />;
  }
  const jobs = jobsForRun(run, snapshot.jobs);
  const evidence = buildWorkbenchRunEvidenceView(snapshot, run) ?? {
    runId: run.id,
    agents: [],
    cases: [],
    traceJobs: [],
  };
  const summaryRoute = createRunRoute({
    runId: run.id,
    source: route.source,
    evaluationId: route.evaluationId,
    section: { kind: "summary" },
  });
  const selectedCaseRoute = route.section.kind === "case" ? route.section : null;
  const selectedCaseResult = selectedCaseRoute
    ? evidence.cases.find((caseResult) => runCaseRouteMatches(caseResult, selectedCaseRoute)) ?? null
    : null;
  const selectedPhaseName = selectedCaseResult
    ? availableRunCasePhase(selectedCaseResult, selectedCaseRoute?.phase ?? null)
    : null;
  const selectedPhase = selectedCaseResult && selectedPhaseName
    ? phaseForCaseResult(selectedCaseResult, selectedPhaseName)
    : null;
  const selectedJob = selectedPhase
    ? jobs.find((job) => job.id === selectedPhase.jobId) ?? null
    : null;
  const selectedTraceJob = selectedPhase
    ? evidence.traceJobs.find((job) => job.jobId === selectedPhase.jobId) ?? null
    : null;
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav className="grid h-max gap-1 rounded-lg border border-border/70 bg-background p-2 text-sm" aria-label="Run sections">
        <a
          aria-current={route.section.kind === "summary" ? "page" : undefined}
          className={sectionNavItemClass(route.section.kind === "summary")}
          href={hrefFor(summaryRoute)}
          onClick={onRouteClick(summaryRoute)}
        >
          Summary
        </a>
        {evidence.cases.map((caseResult) => {
          const caseRoute = createRunCaseRoute({
            caseResult,
            evaluationId: route.evaluationId,
            phase: defaultRunCasePhase(caseResult),
            runId: run.id,
            source: route.source,
          });
          const active = selectedCaseRoute ? runCaseRouteMatches(caseResult, selectedCaseRoute) : false;
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
      </nav>
      <div className="grid min-w-0 gap-5">
        <DetailPageHeader
          eyebrow={runOperationLabel(run)}
          title={runDisplayTitle(run, snapshot)}
          description={`${runOperationLabel(run)} from ${formatTimestamp(run.createdAt)} with ${formatRunEvidenceSummary(jobs)}.`}
        />
        {route.section.kind === "summary" ? (
          <>
            <MetricStrip
              items={[
                { label: "Score", value: formatScore(runScore(run, jobs)) },
                { label: "Cases", value: formatRunCaseCoverageSummary(jobs) },
                { label: "Jobs", value: formatRunJobSummary(jobs) },
                { label: "Duration", value: formatDurationMs(run.latencyMs) },
                { label: "Cost", value: formatRunCost(run) },
              ]}
            />
            {run.error ? <ProblemState icon={CircleAlertIcon} title="Run error" message={run.error} align="start" /> : null}
            <RunSummaryAgentTable evidence={evidence} />
            <RunSummaryCaseTable
              evidence={evidence}
              evaluationId={route.evaluationId}
              hrefFor={hrefFor}
              onRouteClick={onRouteClick}
              run={run}
              snapshot={snapshot}
              source={route.source}
            />
            <RunTimelineSummary jobs={jobs} run={run} snapshot={snapshot} />
          </>
        ) : selectedCaseResult && selectedJob && selectedPhase && selectedPhaseName ? (
          <CaseResultDetail
            apiBasePath={apiBasePath}
            caseResult={selectedCaseResult}
            evaluationId={route.evaluationId}
            hrefFor={hrefFor}
            inspectionCursor={inspectionCursor}
            job={selectedJob}
            phase={selectedPhaseName}
            progressCursor={progressCursor}
            traceJob={selectedTraceJob}
            onRouteClick={onRouteClick}
            run={run}
            snapshot={snapshot}
            source={route.source}
            view={route.section.view}
          />
        ) : (
          <MissingObject label={`Case result ${selectedCaseRoute?.caseId ?? "unknown"}`} />
        )}
      </div>
    </div>
  );
}

function RunSummaryAgentTable({
  evidence,
}: {
  evidence: WorkbenchRunEvidenceView;
}) {
  if (evidence.agents.length === 0) {
    return null;
  }
  return (
    <SurfaceSection title="Agent results" icon={WorkflowIcon} headingLevel={3} description={formatAgentResultsSummary(evidence)}>
      <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Skill</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Cases</TableHead>
              <TableHead>Jobs</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {evidence.agents.map((agent) => (
              <TableRow key={runAgentResultKey(agent)}>
                <TableCell className="align-top font-medium">{formatSkillLabel(agent)}</TableCell>
                <TableCell className="align-top font-medium">{agent.agentLabel}</TableCell>
                <TableCell className="align-top text-muted-foreground">{formatAdapterModel(agent)}</TableCell>
                <TableCell className="align-top"><StatusBadge status={agent.status} /></TableCell>
                <TableCell className="align-top text-muted-foreground">{agent.completedCases} / {agent.totalCases}</TableCell>
                <TableCell className="align-top text-muted-foreground">{agent.succeededJobs} / {agent.totalJobs}</TableCell>
                <TableCell className="align-top">{formatScore(agent.score)}</TableCell>
                <TableCell className="align-top text-muted-foreground">{formatCost(agent.costUsd)}</TableCell>
                <TableCell className="align-top text-muted-foreground">{formatDurationMs(agent.durationMs)}</TableCell>
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
  evaluationId,
  hrefFor,
  onRouteClick,
  run,
  snapshot,
  source,
}: {
  evidence: WorkbenchRunEvidenceView;
  evaluationId: string | null;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  run: WorkbenchRun;
  snapshot: WorkbenchInspectionSnapshot;
  source: "evaluation" | "runs";
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
              <TableHead>Skill</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Execute</TableHead>
              <TableHead>Grade</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {evidence.cases.map((caseResult) => {
              const caseRoute = createRunCaseRoute({
                caseResult,
                evaluationId,
                phase: defaultRunCasePhase(caseResult),
                runId: run.id,
                source,
              });
              const evalCase = casesById.get(caseResult.caseId);
              const title = evalCase ? caseDisplayTitle(evalCase) : caseResult.caseId;
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
                  <TableCell className="align-top font-medium">{formatSkillLabel(caseResult)}</TableCell>
                  <TableCell className="align-top">
                    <div className="font-medium">{caseResult.agentLabel}</div>
                    <div className="text-xs text-muted-foreground">{formatAdapterModel(caseResult)}</div>
                  </TableCell>
                  <TableCell className="align-top">{formatPhaseBadge(caseResult.execute)}</TableCell>
                  <TableCell className="align-top">{formatPhaseBadge(caseResult.grade)}</TableCell>
                  <TableCell className="align-top">{formatScore(caseResult.score)}</TableCell>
                  <TableCell className="align-top text-muted-foreground">{formatDurationMs(caseResult.durationMs)}</TableCell>
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

function formatRunEvidenceSummary(jobs: readonly WorkbenchJob[]): string {
  return `${formatRunCaseCoverageSummary(jobs)}; ${formatRunJobSummary(jobs)}`;
}

function formatAgentResultsSummary(evidence: WorkbenchRunEvidenceView): string {
  const succeeded = evidence.agents.filter((agent) => agent.status === "succeeded").length;
  return `${succeeded} / ${evidence.agents.length} measurements succeeded`;
}

function formatEvidenceCaseSummary(evidence: WorkbenchRunEvidenceView): string {
  const completed = evidence.cases.filter((entry) => entry.status === "succeeded" || entry.score !== undefined).length;
  return `${completed} / ${evidence.cases.length} covered`;
}

function formatAdapterModel(entry: Pick<WorkbenchRunEvidenceTraceJob, "adapter" | "model">): string {
  return entry.model ? `${entry.adapter} / ${entry.model}` : entry.adapter;
}

function formatSkillLabel(entry: Pick<WorkbenchRunEvidenceTraceJob, "skillLabel" | "skillName">): string {
  return entry.skillLabel || entry.skillName;
}

function formatSampleNumber(sample: number): number {
  return sample + 1;
}

function formatRunCasePhase(phase: WorkbenchRunCasePhase): string {
  return phase === "grade" ? "Grade" : "Execute";
}

function formatPhaseBadge(phase: WorkbenchRunEvidenceJobPhase | undefined): ReactNode {
  if (!phase) {
    return <span className="text-muted-foreground">n/a</span>;
  }
  return (
    <div className="grid gap-1">
      <StatusBadge status={phase.status} />
      {phase.dependencyReason ? (
        <span className="max-w-[16rem] text-xs text-muted-foreground">{phase.dependencyReason}</span>
      ) : null}
    </div>
  );
}

function formatTraceJobDependencies(job: WorkbenchRunEvidenceTraceJob): string {
  return job.dependencies
    .map((dependency) => dependency.jobId ? `${dependency.name}: ${dependency.jobId}` : dependency.name)
    .join(", ");
}

function formatRunCaseCoverageSummary(jobs: readonly WorkbenchJob[]): string {
  const coverage = caseSampleCoverage(jobs);
  if (coverage.total === 0) {
    return "no cases";
  }
  return `${coverage.completed} / ${coverage.total} covered`;
}

function formatRunJobSummary(jobs: readonly WorkbenchJob[]): string {
  if (jobs.length === 0) {
    return "no jobs";
  }
  const succeeded = jobs.filter((job) => job.status === "succeeded").length;
  return `${succeeded} / ${jobs.length} succeeded`;
}

function caseSampleCoverage(jobs: readonly WorkbenchJob[]): { completed: number; total: number } {
  const caseJobs = jobs.filter(isEvalCaseJob);
  const resultJobs = preferredCaseResultJobs(caseJobs);
  return {
    completed: uniqueCaseSampleCount(resultJobs.filter(jobHasCaseResult)),
    total: uniqueCaseSampleCount(caseJobs),
  };
}

function preferredCaseResultJobs(jobs: readonly WorkbenchJob[]): WorkbenchJob[] {
  const gradeJobs = jobs.filter((job) => job.role === "grade");
  return gradeJobs.length > 0 ? gradeJobs : [...jobs];
}

function isEvalCaseJob(job: WorkbenchJob): boolean {
  return job.caseId !== "current";
}

function jobHasCaseResult(job: WorkbenchJob): boolean {
  return job.status === "succeeded" || jobScore(job) !== undefined;
}

function uniqueCaseSampleCount(jobs: readonly WorkbenchJob[]): number {
  return new Set(jobs.map((job) => `${job.caseId}\0${job.sample}`)).size;
}

function runCaseNavLabel(caseResult: WorkbenchRunEvidenceCaseResult): string {
  const sample = caseResult.sample > 0 ? ` #${formatSampleNumber(caseResult.sample)}` : "";
  return `${caseResult.caseId}${sample} · ${formatSkillLabel(caseResult)} · ${caseResult.agentLabel}`;
}

type SelectedRunCaseSection = Extract<Extract<WorkbenchRoute, { kind: "run" }>["section"], { kind: "case" }>;

function createRunCaseRoute({
  caseResult,
  evaluationId,
  phase,
  runId,
  source,
  view = "trace",
}: {
  caseResult: WorkbenchRunEvidenceCaseResult;
  evaluationId: string | null;
  phase: WorkbenchRunCasePhase;
  runId: string;
  source: "evaluation" | "runs";
  view?: WorkbenchRunCaseEvidenceView;
}): WorkbenchRoute {
  return createRunRoute({
    runId,
    source,
    evaluationId,
    section: {
      kind: "case",
      caseId: caseResult.caseId,
      agentHash: caseResult.agentHash,
      skillName: caseResult.skillName,
      skillBundleHash: caseResult.skillBundleHash,
      versionId: caseResult.versionId,
      sample: caseResult.sample,
      phase,
      view,
    },
  });
}

function runCaseRouteMatches(
  caseResult: WorkbenchRunEvidenceCaseResult,
  section: SelectedRunCaseSection,
): boolean {
  return caseResult.caseId === section.caseId &&
    caseResult.agentHash === section.agentHash &&
    caseResult.skillName === section.skillName &&
    caseResult.skillBundleHash === section.skillBundleHash &&
    caseResult.versionId === section.versionId &&
    caseResult.sample === section.sample;
}

function runAgentResultKey(
  agent: Pick<WorkbenchRunEvidenceTraceJob, "versionId" | "skillName" | "skillBundleHash" | "evalHash" | "agentHash" | "agentName">,
): string {
  return [
    agent.versionId,
    agent.skillName,
    agent.skillBundleHash,
    agent.evalHash,
    agent.agentHash,
    agent.agentName,
  ].join(":");
}

function runCaseResultKey(caseResult: WorkbenchRunEvidenceCaseResult): string {
  return [
    runAgentResultKey(caseResult),
    caseResult.caseId,
    caseResult.sample,
  ].join(":");
}

function defaultRunCasePhase(caseResult: WorkbenchRunEvidenceCaseResult): WorkbenchRunCasePhase {
  return caseResult.execute ? "execute" : "grade";
}

function availableRunCasePhase(
  caseResult: WorkbenchRunEvidenceCaseResult,
  requested: WorkbenchRunCasePhase | null,
): WorkbenchRunCasePhase {
  if (requested === "grade" && caseResult.grade) {
    return "grade";
  }
  if (requested === "execute" && caseResult.execute) {
    return "execute";
  }
  return defaultRunCasePhase(caseResult);
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
  evaluationId,
  hrefFor,
  inspectionCursor,
  job,
  phase,
  progressCursor,
  traceJob,
  onRouteClick,
  run,
  snapshot,
  source,
  view,
}: {
  apiBasePath: string;
  caseResult: WorkbenchRunEvidenceCaseResult;
  evaluationId: string | null;
  hrefFor: (route: WorkbenchRoute) => string;
  inspectionCursor: string | null;
  job: WorkbenchJob;
  phase: WorkbenchRunCasePhase;
  progressCursor: string | null;
  traceJob: WorkbenchRunEvidenceTraceJob | null;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  run: WorkbenchRun;
  snapshot: WorkbenchInspectionSnapshot;
  source: "evaluation" | "runs";
  view: WorkbenchRunCaseEvidenceView;
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
  const dependencies = traceJob?.dependencies.length ? formatTraceJobDependencies(traceJob) : selectedPhase.dependencyReason;
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
          evaluationId={evaluationId}
          hrefFor={hrefFor}
          onRouteClick={onRouteClick}
          phase={phase}
          run={run}
          source={source}
          view={view}
        />
      </div>
      <FactGrid>
        <FactItem title="Skill" value={skillLabel} />
        <FactItem title="Agent" value={agentLabel} />
        <FactItem title="Model" value={adapterModel} />
        <FactItem title="Sample" value={formatSampleNumber(caseResult.sample)} />
        <FactItem title="Case status" value={<StatusBadge status={caseResult.status} />} />
        <FactItem title="Case score" value={formatScore(caseResult.score)} />
        <FactItem title="Case duration" value={formatDurationMs(caseResult.durationMs)} />
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
          <CaseEvidenceViewNav
            caseResult={caseResult}
            evaluationId={evaluationId}
            hrefFor={hrefFor}
            onRouteClick={onRouteClick}
            phase={phase}
            run={run}
            source={source}
            view={view}
          />
        </div>
        {view === "trace" ? (
          <JobEvidencePanel
            apiBasePath={apiBasePath}
            description={phase === "grade" ? "Judgment evidence for this case sample." : "Skill run evidence for this case sample."}
            jobId={job.id}
            jobStatus={job.status}
            refreshToken={job.status === "queued" || job.status === "running" ? progressCursor ?? inspectionCursor : null}
            runId={job.runId}
            title={`${phaseLabel} trace`}
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
  evaluationId,
  hrefFor,
  onRouteClick,
  phase,
  run,
  source,
  view,
}: {
  caseResult: WorkbenchRunEvidenceCaseResult;
  evaluationId: string | null;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  phase: WorkbenchRunCasePhase;
  run: WorkbenchRun;
  source: "evaluation" | "runs";
  view: WorkbenchRunCaseEvidenceView;
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
          evaluationId,
          phase: item.value,
          runId: run.id,
          source,
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

function CaseEvidenceViewNav({
  caseResult,
  evaluationId,
  hrefFor,
  onRouteClick,
  phase,
  run,
  source,
  view,
}: {
  caseResult: WorkbenchRunEvidenceCaseResult;
  evaluationId: string | null;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  phase: WorkbenchRunCasePhase;
  run: WorkbenchRun;
  source: "evaluation" | "runs";
  view: WorkbenchRunCaseEvidenceView;
}) {
  const views: Array<{ value: WorkbenchRunCaseEvidenceView; label: string; icon: typeof ActivityIcon }> = [
    { value: "trace", label: "Trace", icon: ActivityIcon },
    { value: "output", label: "Output", icon: ArchiveIcon },
  ];
  return (
    <nav className="flex w-fit max-w-full shrink-0 flex-wrap items-center gap-1 rounded-lg border border-border/70 bg-background p-1 text-sm" aria-label="Case result evidence">
      {views.map((item) => {
        const route = createRunRoute({
          runId: run.id,
          source,
          evaluationId,
          section: {
            kind: "case",
            caseId: caseResult.caseId,
            agentHash: caseResult.agentHash,
            skillName: caseResult.skillName,
            skillBundleHash: caseResult.skillBundleHash,
            versionId: caseResult.versionId,
            sample: caseResult.sample,
            phase,
            view: item.value,
          },
        });
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
  evaluationId,
  hrefFor,
  jobs,
  onRouteClick,
  snapshot,
  source,
  title,
}: {
  empty: string;
  evaluationId: string | null;
  hrefFor: (route: WorkbenchRoute) => string;
  jobs: WorkbenchJob[];
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  snapshot: WorkbenchInspectionSnapshot;
  source: "evaluation" | "runs";
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
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Quality</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const runRoute = createRunRoute({ runId: run.id, source, evaluationId });
                return (
                  <TableRow key={run.id} className="cursor-pointer" onClick={onRouteClick(runRoute)}>
                    <TableCell>
                      <a className="font-medium text-primary underline-offset-4 hover:underline" href={hrefFor(runRoute)} onClick={onRouteClick(runRoute)}>
                        {runOperationLabel(run)}
                      </a>
                    </TableCell>
                    <TableCell><StatusBadge status={run.status} /></TableCell>
                    <TableCell className="break-words text-muted-foreground [overflow-wrap:anywhere]">{runVersionDisplayName(snapshot, run)}</TableCell>
                    <TableCell className="break-words text-muted-foreground [overflow-wrap:anywhere]">{runAgentDisplayName(snapshot, run)}</TableCell>
                    <TableCell>{formatScore(runScore(run, snapshot.jobs))}</TableCell>
                    <TableCell className="text-muted-foreground">{formatTimestamp(run.finishedAt ?? run.createdAt)}</TableCell>
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
    const evalSnapshot = selectedEvalSnapshot(snapshot, route.evaluationId);
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
  if (route.kind === "run") {
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
  return (
    <aside className="grid min-w-0 gap-4 rounded-lg border border-border/70 bg-background p-4 text-sm xl:sticky xl:top-6">
      <div className="grid gap-1">
        <h2 className="text-sm font-semibold">{runOperationLabel(run)}</h2>
        <div className="break-words font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{run.id}</div>
      </div>
      <FactGrid>
        <FactItem title="Status" value={<StatusBadge status={run.status} />} />
        <FactItem title="Operation" value={runOperationLabel(run)} />
        <FactItem title="Version" value={runVersionDisplayName(snapshot, run)} />
        <FactItem title="Agent" value={runAgentDisplayName(snapshot, run)} />
        <FactItem title="Evaluation" value={formatEvaluationDisplayName(run.evalHash, snapshot.evals)} />
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
    <OutputFilesSurface apiBasePath={apiBasePath} ownerKind={owner.kind} ownerId={owner.id} files={owner.files} />
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
  const panelTitle = title ?? "Trace";
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
      label: route.view === "cases"
        ? "Cases"
        : route.view === "source"
          ? "Source"
          : "Results",
    }];
  }
  if (route.kind === "case") {
    return [
      { label: "Cases", route: createEvaluationRoute({ view: "cases", evaluationId: route.evaluationId }) },
      { label: route.caseId },
    ];
  }
  if (route.kind === "runs") {
    return [{ label: "Runs" }];
  }
  if (route.kind === "run") {
    const run = snapshot?.runs.find((entry) => entry.id === route.runId) ?? null;
    return [
      {
        label: route.source === "runs" ? "Runs" : "Results",
        route: route.source === "runs"
          ? createRunsRoute()
          : createEvaluationRoute({ view: "results", evaluationId: route.evaluationId }),
      },
      { label: run && snapshot ? runDisplayTitle(run, snapshot) : shortId(route.runId) },
    ];
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

function selectedEvalSnapshot(snapshot: WorkbenchInspectionSnapshot, evaluationId: string | null): WorkbenchEvalSnapshot | null {
  if (evaluationId) {
    const selected = snapshot.evals.find((entry) => entry.hash === evaluationId);
    if (selected) {
      return selected;
    }
  }
  return [...snapshot.evals].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.hash.localeCompare(left.hash)
  )[0] ?? null;
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
type InspectionResultVersion = InspectionResults["versions"][number];
type InspectionResultAgent = InspectionResults["agents"][number];

function runDisplayTitle(run: WorkbenchRun, snapshot: WorkbenchInspectionSnapshot): string {
  return `${runOperationLabel(run)}: ${runVersionDisplayName(snapshot, run)} on ${formatEvaluationDisplayName(run.evalHash, snapshot.evals)}`;
}

function runOperationLabel(run: WorkbenchRun): string {
  const base = run.kind === "improve"
    ? "Improve"
    : run.kind === "grade"
      ? "Grade"
      : run.kind === "run"
        ? "Run"
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
  return formatVersionDisplayName(run.outputVersionId ?? run.versionId, snapshot.versions, comparisonLabelContext(snapshot));
}

function runAgentDisplayName(snapshot: WorkbenchInspectionSnapshot, run: WorkbenchRun): string {
  const resultAgents = runResultAgents(snapshot, run);
  if (resultAgents.length === 1) {
    return resultAgents[0]!.label;
  }
  if (resultAgents.length > 1) {
    return formatCount(resultAgents.length, "agent");
  }
  return snapshot.results?.agents.find((agent) => agent.id === run.agentHash)?.label ?? run.agentName;
}

function jobAgentDisplayName(snapshot: WorkbenchInspectionSnapshot, job: WorkbenchJob): string {
  return snapshot.results?.agents.find((agent) => agent.id === job.agentHash)?.label ?? job.agentName;
}

function runResultVersions(snapshot: WorkbenchInspectionSnapshot, run: WorkbenchRun): InspectionResults["versions"] {
  const results = snapshot.results;
  if (!results) {
    return [];
  }
  const versionById = new Map(results.versions.map((version) => [version.id, version]));
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

function runResultAgents(snapshot: WorkbenchInspectionSnapshot, run: WorkbenchRun): InspectionResults["agents"] {
  const results = snapshot.results;
  if (!results) {
    return [];
  }
  const agentById = new Map(results.agents.map((agent) => [agent.id, agent]));
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
  return snapshot.results?.versions.find((version) =>
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
  return versionId ? formatVersionDisplayName(versionId, snapshot.versions, comparisonLabelContext(snapshot)) : "none";
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
