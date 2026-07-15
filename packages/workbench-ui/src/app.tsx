"use client";

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
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
  compareWorkbenchNaturalText,
  isWorkbenchPackageSourcePath,
  isWorkbenchRunStatusTerminal,
  mergeWorkbenchJobReports,
  normalizeWorkbenchSkillName,
  workbenchGradePlanAuthoringDefaults,
  workbenchGradePlanAuthoringIssues,
  workbenchGradePlanAuthoringListItemDefault,
  workbenchCaseFileOwnerId,
  workbenchJobReportMetricBreakdown,
  workbenchOperationStepsForRunKind,
  workbenchRunEvidenceJobPhase,
  workbenchRunOwnsJob,
  workbenchRunStatusFromJobs,
  workbenchSampleCoverage,
  workbenchSampleCoverageForJobs,
} from "@workbench-ai/workbench-contract";
import type {
  Json,
  SurfaceSnapshotFile,
  WorkbenchActionCapabilities,
  WorkbenchArtifact,
  WorkbenchCaseRunKind,
  WorkbenchEvalCaseSnapshot,
  WorkbenchEvalSnapshot,
  WorkbenchExecutionTraceDetail,
  WorkbenchGradeAdapterOption,
  WorkbenchGradePlanAuthoringControl,
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
  WorkbenchResultCell,
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
import { TranscriptFeed } from "@workbench-ai/cli-web-ui/components/shared/transcript-feed";
import { ProblemState } from "@workbench-ai/cli-web-ui/components/shared/problem-state";
import { TopLoadingBar } from "@workbench-ai/cli-web-ui/components/shared/top-loading-bar";
import { ViewSwitch } from "@workbench-ai/cli-web-ui/components/shared/view-switch";
import { WorkbenchBrand, WorkbenchLogoMark } from "@workbench-ai/cli-web-ui/components/shared/workbench-brand";
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workbench-ai/cli-web-ui/components/ui/dropdown-menu";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workbench-ai/cli-web-ui/components/ui/field";
import { Input } from "@workbench-ai/cli-web-ui/components/ui/input";
import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "@workbench-ai/cli-web-ui/components/ui/marker";
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workbench-ai/cli-web-ui/components/ui/select";
import { Textarea } from "@workbench-ai/cli-web-ui/components/ui/textarea";
import { badgeToneProps } from "@workbench-ai/cli-web-ui/lib/badge";
import {
  buildExecutionTraceTranscript,
} from "@workbench-ai/cli-web-ui/lib/execution-trace-transcript";
import { parseMarkdownDocument } from "@workbench-ai/cli-web-ui/lib/markdown-document";
import { WORKBENCH_CONTENT_RAIL_CLASS } from "@workbench-ai/cli-web-ui/lib/workbench-layout";
import { cn } from "@workbench-ai/cli-web-ui/lib/utils";

import { StatusBadge } from "./components/status-badge";
import { SurfaceSection } from "./components/surface-section";
import { LineageGraph } from "./components/lineage-graph";
import { RepositoryFilesView } from "./components/repository-files-view";
import { EvaluationResultsVisualSummary } from "./components/evaluation-results-visual-summary";
import { WorkbenchActionBar } from "./components/workbench-action-bar";
import { fileContentApiPath, jobEvidenceApiPath } from "./lib/api-paths";
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
  routeForWorkbenchRunSnapshot,
  saveEvaluationCase,
  startWorkbenchOperation,
  updateEvaluationGrader,
  workbenchResponseErrorMessage,
} from "./lib/operations";
import {
  defaultPackageVersion,
  orderedVersions,
  publishedVersionId,
} from "./lib/version-selection";

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
} from "./lib/results-metrics";

interface WorkbenchWorkspaceProps {
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
  sidebarMode?: "auto" | "hidden";
  syncLocation?: boolean;
  visiblePrimaryTabs?: readonly WorkbenchPrimaryTab[];
  lockedEvalVersionId?: string;
  liveInspection?: boolean;
}

interface WorkbenchHostContext {
  handle?: string;
  ownerHref?: string;
  ownerSlug?: string;
  skillName?: string;
  visibility?: string;
  evidenceAccess?: "full" | "package";
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

function closeDialog(open: boolean, onClose: () => void): void {
  if (!open) {
    onClose();
  }
}

const PRIMARY_TABS: Array<{
  value: WorkbenchPrimaryTab;
  label: string;
  icon: typeof WorkflowIcon;
}> = [
  { value: "files", label: "Files", icon: FolderOpenIcon },
  { value: "evaluation", label: "Evals", icon: WorkflowIcon },
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

type WorkbenchVersionHistoryView = "list" | "lineage";

interface VersionHistoryContentProps {
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
  "flex h-[min(42rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-2xl grid-rows-none flex-col gap-0 overflow-hidden p-0 data-[state=open]:animate-none data-[state=closed]:animate-none sm:max-w-2xl";

function useWorkbenchInspection({
  apiBasePath,
  evalRef,
  initialEnvelope,
  live,
}: {
  apiBasePath: string;
  evalRef?: string;
  initialEnvelope: WorkbenchInspectionSnapshotEnvelope | null;
  live: boolean;
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
  const refresh = useCallback(() => {
    if (live) setRefreshRequest((current) => ({ key: current.key + 1, visible: true }));
  }, [live]);

  useEffect(() => {
    if (!live || (initialEnvelope && refreshRequest.key === 0)) {
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
        const next = await fetchInspectionEnvelope(apiBasePath, controller.signal, evalRef);
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
  }, [apiBasePath, evalRef, initialEnvelope, live, refreshRequest.key, refreshRequest.visible]);

  useEffect(() => {
    if (!live || !envelope?.cursor) {
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
  }, [apiBasePath, envelope?.cursor, live]);

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
  evalRef?: string,
): Promise<WorkbenchInspectionSnapshotEnvelope> {
  const response = await fetch(`${apiBasePath}/snapshot${evalRef ? `?eval=${encodeURIComponent(evalRef)}` : ""}`, { signal });
  if (!response.ok) {
    throw new Error(await workbenchResponseErrorMessage(response));
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
    throw new Error(await workbenchResponseErrorMessage(response));
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
  sidebarMode = "auto",
  syncLocation = true,
  visiblePrimaryTabs = ["files", "evaluation", "runs"],
  lockedEvalVersionId,
  liveInspection = true,
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
  } = useWorkbenchInspection({ apiBasePath, ...(lockedEvalVersionId ? { evalRef: lockedEvalVersionId } : {}), initialEnvelope, live: liveInspection });
  const [route, setRoute] = useState<WorkbenchRoute>(() =>
    initialRoute ?? parseWorkbenchLocation(undefined, routeBasePath));
  const hasInitialRoute = initialRoute !== undefined;
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
    if (syncLocation && href !== current) {
      window.history[options.replace ? "replaceState" : "pushState"]({}, "", href);
    }
    setRoute(nextRoute);
  }, [hrefFor, syncLocation]);
  const onRouteClick = useCallback((nextRoute: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(nextRoute);
  }, [navigate]);
  const identity = useSkillIdentity({ apiBasePath, hostContext, snapshot });
  const lockedEvalVersion = lockedEvalVersionId
    ? snapshot?.evalVersions.find((entry) => entry.id === lockedEvalVersionId || entry.hash === lockedEvalVersionId)
    : undefined;
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
        onRefresh={liveInspection ? refreshSnapshot : undefined}
      refreshing={refreshing}
      snapshot={snapshot}
    />
  );
  const routeFeedbackActive = loading || refreshing || routeLoadingIds.size > 0 || routeWantsEvidenceRefresh;
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
          lockedEvalVersion={lockedEvalVersion}
          onOperationStarted={onOperationStarted}
          onRouteClick={onRouteClick}
          hostContext={hostContext}
          homeRoute={lockedEvalVersionId ? createEvaluationRoute({ view: "cases", evalVersionId: lockedEvalVersionId }) : createFilesRoute()}
        />
        <PrimaryTabs route={route} hrefFor={hrefFor} lockedEvalVersionId={lockedEvalVersionId} onRouteClick={onRouteClick} visibleTabs={visiblePrimaryTabs} />
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
          <div className="min-w-0" data-testid="workbench-primary-content">
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
                lockedEvalVersionId={lockedEvalVersionId}
                navigate={navigate}
                onRouteClick={onRouteClick}
                progressCursor={progressCursor}
                refreshSnapshot={refreshSnapshot}
                route={route}
                snapshot={snapshot}
              />
            )}
          </div>
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
  onRefresh?: () => void;
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
  const owner = snapshot ? defaultPackageVersion(snapshot) : null;
  const [hydrated, setHydrated] = useState<SkillIdentity | null>(null);

  useEffect(() => {
    const skillFile = owner?.files.find((file) => file.path === "SKILL.md");
    if (!snapshot || !owner || !skillFile || skillFile.content.length > 0 || (fallback.name && fallback.description)) {
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
  const owner = defaultPackageVersion(snapshot);
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
  lockedEvalVersion,
  homeRoute,
  onOperationStarted,
  onRouteClick,
}: {
  actions: WorkbenchActionCapabilities | null;
  apiBasePath: string;
  hrefFor: (route: WorkbenchRoute) => string;
  hostContext: WorkbenchHostContext | undefined;
  identity: SkillIdentity;
  identityControls: ReactNode;
  lockedEvalVersion?: WorkbenchInspectionSnapshot["evalVersions"][number];
  homeRoute: WorkbenchRoute;
  onOperationStarted: (started: WorkbenchRunSnapshot) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
}) {
  const handleParts = splitSkillHandle(identity.handle);
  const ownerLabel = handleParts?.owner ?? hostContext?.ownerSlug ?? null;
  const skillLabel = handleParts?.name ?? identity.name;
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
              {hostContext?.visibility ? <Badge variant="outline">{hostContext.visibility}</Badge> : null}
              {hostContext?.evidenceAccess === "package" ? <Badge variant="outline">package only</Badge> : null}
              {lockedEvalVersion ? (
                <Badge title={lockedEvalVersion.hash} variant="outline">
                  {lockedEvalVersion.label} · {shortId(lockedEvalVersion.hash)}
                </Badge>
              ) : null}
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
          />
        ) : null}
      </div>
    </section>
  );
}

function PrimaryTabs({
  hrefFor,
  lockedEvalVersionId,
  onRouteClick,
  route,
  visibleTabs,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  lockedEvalVersionId?: string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  route: WorkbenchRoute;
  visibleTabs: readonly WorkbenchPrimaryTab[];
}) {
  const active = routePrimaryTab(route);
  const routeFor = (tab: WorkbenchPrimaryTab): WorkbenchRoute => {
    if (tab === "evaluation") {
      return createEvaluationRoute({ view: "results", evalVersionId: lockedEvalVersionId ?? (route.kind === "evaluation" || route.kind === "case" ? route.evalVersionId : null) });
    }
    if (tab === "runs") {
      return createRunsRoute();
    }
    return createFilesRoute();
  };
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-4 border-b border-border/70" aria-label="Workbench skill tabs">
      {PRIMARY_TABS.filter((item) => visibleTabs.includes(item.value)).map((item) => {
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
  lockedEvalVersionId,
  navigate,
  onRouteClick,
  progressCursor,
  refreshSnapshot,
  route,
  snapshot,
}: {
  actions: WorkbenchActionCapabilities | null;
  apiBasePath: string;
  hrefFor: (route: WorkbenchRoute) => string;
  inspectionCursor: string | null;
  lockedEvalVersionId?: string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  progressCursor: string | null;
  refreshSnapshot: () => void;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  switch (route.kind) {
    case "files":
      return (
        <FilesSurface
          apiBasePath={apiBasePath}
          navigate={navigate}
          route={route}
          snapshot={snapshot}
        />
      );
    case "evaluation":
      return (
        <EvaluationSurface
          allowMutations={actions?.evidenceAccess === "full"}
          apiBasePath={apiBasePath}
          hrefFor={hrefFor}
          lockedEvalVersionId={lockedEvalVersionId}
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
          route={lockedEvalVersionId ? { ...route, evalVersionId: lockedEvalVersionId } : route}
          snapshot={snapshot}
          hrefFor={hrefFor}
          onRouteClick={onRouteClick}
        />
      );
    case "runs":
      return <RunsSurface snapshot={snapshot} hrefFor={hrefFor} lockedEvalVersionId={lockedEvalVersionId} onRouteClick={onRouteClick} />;
    case "run":
    case "run-job":
      return (
        <RunDetailPage
          apiBasePath={apiBasePath}
          hrefFor={hrefFor}
          inspectionCursor={inspectionCursor}
          lockedEvalVersionId={lockedEvalVersionId}
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
}: {
  apiBasePath: string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  route: Extract<WorkbenchRoute, { kind: "files" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const owner = defaultPackageVersion(snapshot, route.file.versionId);
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
  const files = useMemo(() => authoredPackageFiles(owner.files), [owner.files]);
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
    />
  );
}

function authoredPackageFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
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
}: {
  apiBasePath: string;
  file: WorkbenchFileRouteState;
  files: readonly SurfaceSnapshotFile[];
  ownerId: string;
  onFileChange: (file: Partial<WorkbenchFileRouteState>, options?: { replace?: boolean }) => void;
  onVersionChange: (versionId: string) => void;
  snapshot: WorkbenchInspectionSnapshot;
  versionId: string;
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
  onValueChange,
  snapshot,
  value,
}: {
  onValueChange: (versionId: string) => void;
  snapshot: WorkbenchInspectionSnapshot;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<WorkbenchVersionHistoryView>("list");
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

function WorkbenchVersionHistoryDialogContent({
  onValueChange,
  onViewChange,
  snapshot,
  value,
  view,
}: VersionHistoryContentProps) {
  return (
    <>
      <DialogHeader className="shrink-0 gap-3 border-b border-border/70 px-4 pb-3 pt-4 pr-12">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription className="sr-only">
            Review version history and lineage for this skill.
          </DialogDescription>
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
            className="min-h-0 rounded-none border-0"
            selectedVersionId={value}
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
  return (
    <LabeledSelect
      ariaLabel="Select version"
      options={options}
      placeholder="Version"
      testId="version-select"
      value={value}
      onValueChange={onValueChange}
    />
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
          <Button
            key={version.id}
            type="button"
            aria-current={active ? "true" : undefined}
            className="h-auto min-w-0 flex-col items-stretch gap-1 px-3 py-2 text-left"
            variant={active ? "secondary" : "outline"}
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
          </Button>
        );
      })}
    </div>
  );
}

function EvaluationSurface({
  allowMutations,
  apiBasePath,
  hrefFor,
  lockedEvalVersionId,
  navigate,
  onRouteClick,
  refreshSnapshot,
  route,
  snapshot,
}: {
  allowMutations: boolean;
  apiBasePath: string;
  hrefFor: (route: WorkbenchRoute) => string;
  lockedEvalVersionId?: string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  refreshSnapshot: () => void;
  route: Extract<WorkbenchRoute, { kind: "evaluation" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const results = resultsForScorecard(snapshot);
  const evaluationOptions = evalVersionOptionsForResults(snapshot);
  const defaultEvaluationId = defaultEvalVersionIdForResults(evaluationOptions);
  const requestedEvaluationId = lockedEvalVersionId
    ? snapshot.evalVersions.find((option) => option.id === lockedEvalVersionId || option.hash === lockedEvalVersionId)?.id ?? lockedEvalVersionId
    : route.evalVersionId;
  const activeEvaluationId = requestedEvaluationId && evaluationOptions.some((option) => option.id === requestedEvaluationId)
    ? requestedEvaluationId
    : defaultEvaluationId;
  const groups = buildResultGroups(results);
  const rows = buildResultEvidenceRows({
    groups,
    agents: results.agentVersions,
    runs: snapshot.runs,
  });
  const visibleRows = activeEvaluationId
    ? rows.filter((row) => row.evalVersionId === activeEvaluationId)
    : rows;
  const selectedEvaluation = activeEvaluationId
    ? evaluationOptions.find((option) => option.id === activeEvaluationId) ?? null
    : null;
  const showEvaluationSelector = !lockedEvalVersionId && evaluationOptions.length > 0 && typeof activeEvaluationId === "string";
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
          navigate={navigate}
          onRouteClick={onRouteClick}
          refreshSnapshot={refreshSnapshot}
          snapshot={snapshot}
        />
      ) : (
        <EvaluationResults
          hasResults={results.cells.length > 0}
          hrefFor={hrefFor}
          onRouteClick={onRouteClick}
          rows={visibleRows}
          selectedEvaluation={selectedEvaluation}
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
  const groups = buildResultGroups(results);
  const rows = sortLeaderboardRows(
    buildResultEvidenceRows({
      groups,
      agents: results.agentVersions,
      runs: snapshot.runs,
    }),
  );
  const evalVersionId = "evalVersionId" in options
    ? options.evalVersionId
    : defaultEvalVersionIdForResults(evalVersionOptionsForResults(snapshot));
  return evalVersionId ? rows.filter((row) => row.evalVersionId === evalVersionId) : rows;
}

function EvaluationResults({
  hasResults,
  hrefFor,
  onRouteClick,
  rows,
  selectedEvaluation,
}: {
  hasResults: boolean;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  rows: ResultEvidenceRow[];
  selectedEvaluation: ResultEvalVersionOption | null;
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
        hrefFor={hrefFor}
        onRouteClick={onRouteClick}
        rows={sortedRows}
      />
    </section>
  );
}

export function EvaluationLeaderboard({
  hrefFor,
  maxRows,
  onRouteClick,
  rows,
}: {
  hrefFor?: (route: WorkbenchRoute) => string;
  maxRows?: number;
  onRouteClick?: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  rows: ResultEvidenceRow[];
}) {
  const sorted = useMemo(() => sortLeaderboardRows(rows), [rows]);
  const visible = useMemo(
    () => (typeof maxRows === "number" ? sorted.slice(0, maxRows) : sorted),
    [maxRows, sorted],
  );
  const groups = useMemo(() => buildLeaderboardGroups(visible), [visible]);
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
                    <QualityLatencyCostCells
                      cost={costMetric}
                      latency={latencyMetric}
                      quality={formatQualityMetric(row.score)}
                    />
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
  return (
    <LabeledSelect
      ariaLabel="Select eval"
      options={options}
      placeholder="Eval"
      testId="evaluation-select"
      triggerLabel={evaluationSelectTriggerLabel}
      value={value}
      onValueChange={onValueChange}
    />
  );
}

function LabeledSelect<T extends { id: string; label: string; subtitle: string }>({
  ariaLabel,
  onValueChange,
  options,
  placeholder,
  testId,
  triggerLabel = (option) => option.label,
  value,
}: {
  ariaLabel: string;
  onValueChange: (value: string) => void;
  options: T[];
  placeholder: string;
  testId: string;
  triggerLabel?: (option: T) => string;
  value: string;
}) {
  const selectedOption = options.find((option) => option.id === value);
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger size="sm" aria-label={ariaLabel} data-testid={testId}>
        <SelectValue placeholder={placeholder}>
          {selectedOption ? triggerLabel(selectedOption) : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="min-w-64">
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id} textValue={option.label}>
              <span className="grid min-w-0 gap-0.5">
                <span>{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.subtitle}</span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function evaluationSelectTriggerLabel(option: ResultEvalVersionOption): string {
  return `${option.label}${option.isCurrent ? " current" : ""}`;
}

function sortLeaderboardRows(rows: readonly ResultEvidenceRow[]): ResultEvidenceRow[] {
  return [...rows].sort((left, right) =>
    compareOptionalNumber(left.score, right.score, "desc") ||
    compareOptionalNumber(left.latencyPerSampleMs, right.latencyPerSampleMs, "asc") ||
    compareOptionalNumber(left.versionOrdinal, right.versionOrdinal, "desc") ||
    compareWorkbenchNaturalText(left.setupLabel, right.setupLabel) ||
    compareWorkbenchNaturalText(left.agentName, right.agentName) ||
    compareWorkbenchNaturalText(left.rowId, right.rowId)
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

function QualityLatencyCostCells({
  between,
  cost,
  latency,
  quality,
}: {
  between?: ReactNode;
  cost: { detail?: ReactNode; value: ReactNode };
  latency: { detail?: ReactNode; value: ReactNode };
  quality: ReactNode;
}) {
  return (
    <>
      <TableCell className="align-top font-medium">{quality}</TableCell>
      {between}
      <TableCell className="align-top text-muted-foreground">
        <MetricStack value={latency.value} detail={latency.detail} />
      </TableCell>
      <TableCell className="align-top text-muted-foreground">
        <MetricStack value={cost.value} detail={cost.detail} />
      </TableCell>
    </>
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

function EvaluationCases({
  allowMutations,
  apiBasePath,
  evalVersionId: selectedEvalVersionId,
  hrefFor,
  navigate,
  onRouteClick,
  refreshSnapshot,
  snapshot,
}: {
  allowMutations: boolean;
  apiBasePath: string;
  evalVersionId: string | null;
  hrefFor: (route: WorkbenchRoute) => string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  refreshSnapshot: () => void;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const evalSnapshot = selectedEvalSnapshot(snapshot, selectedEvalVersionId);
  const resolvedEvalVersionId = evalSnapshot
    ? evalVersionIdForHash(snapshot, evalSnapshot.hash) ?? selectedEvalVersionId ?? evalSnapshot.hash
    : null;
  const selectedEvalVersion = resolvedEvalVersionId
    ? snapshot.evalVersions.find((entry) => entry.id === resolvedEvalVersionId || entry.hash === evalSnapshot?.hash)
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
      allowCaseAuthoring={allowMutations && selectedEvalVersion?.current === true}
      columns={matrixColumns}
      evalSnapshot={evalSnapshot}
      evalVersionId={resolvedEvalVersionId ?? evalSnapshot.hash}
      hrefFor={hrefFor}
      navigate={navigate}
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
  if (caseResult?.run) {
    steps.push({
      label: "Agent response",
      status: caseResult.run.status,
      durationMs: caseResult.run.durationMs,
      detail: caseResult.run.error,
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
        <Marker
          key={`${step.label}:${step.status ?? ""}`}
          className="items-start"
          variant="border"
        >
          <MarkerIcon className="pt-1.5">
            <span className="block size-1.5 rounded-full bg-primary" />
          </MarkerIcon>
          <MarkerContent className="grid flex-1 gap-1">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{step.label}</span>
              {step.durationMs !== undefined ? (
                <span className="text-xs text-muted-foreground">
                  {formatDurationMs(step.durationMs)}
                </span>
              ) : null}
            </div>
            {step.detail ? (
              <p className="break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{step.detail}</p>
            ) : step.status ? (
              <p className="text-xs leading-5 text-muted-foreground">{step.status}</p>
            ) : null}
          </MarkerContent>
        </Marker>
      ))}
    </div>
  );
}

interface CaseMatrixColumn {
  agentDetail: string;
  id: string;
  evalHash?: string;
  evalVersionId: string;
  evidence?: WorkbenchRunEvidenceView;
  run?: WorkbenchRun;
  skillVersionId?: string;
  target: WorkbenchOperationTarget;
  versionLabel: string;
}

const CASE_MATRIX_DEFAULT_VISIBLE_COLUMN_LIMIT = 4;

function EvaluationCaseMatrix({
  apiBasePath,
  allowCaseAuthoring,
  allowMutations,
  columns,
  evalSnapshot,
  evalVersionId,
  hrefFor,
  navigate,
  onRouteClick,
  refreshSnapshot,
  snapshot,
}: {
  apiBasePath: string;
  allowCaseAuthoring: boolean;
  allowMutations: boolean;
  columns: CaseMatrixColumn[];
  evalSnapshot: WorkbenchEvalSnapshot;
  evalVersionId: string;
  hrefFor: (route: WorkbenchRoute) => string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  refreshSnapshot: () => void;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const allColumnIds = useMemo(() => columns.map(caseMatrixColumnId), [columns]);
  const [manualVisibleColumnIds, setManualVisibleColumnIds] = useState<string[] | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ caseId: string; columnId: string } | null>(null);
  const [caseEditor, setCaseEditor] = useState<{ caseId?: string } | null>(null);
  const [defaultGraderOpen, setDefaultGraderOpen] = useState(false);

  useEffect(() => {
    setManualVisibleColumnIds((current) =>
      current === null ? null : current.filter((id) => allColumnIds.includes(id))
    );
  }, [allColumnIds]);

  const defaultVisibleColumnIds = useMemo(() => {
    if (allColumnIds.length <= CASE_MATRIX_DEFAULT_VISIBLE_COLUMN_LIMIT) {
      return allColumnIds;
    }
    const prioritizedIds = [
      ...columns
        .filter((column) => Boolean(column.run ?? column.evidence))
        .map(caseMatrixColumnId),
      ...allColumnIds,
    ];
    const visibleIds = new Set<string>();
    for (const columnId of prioritizedIds) {
      visibleIds.add(columnId);
      if (visibleIds.size >= CASE_MATRIX_DEFAULT_VISIBLE_COLUMN_LIMIT) {
        break;
      }
    }
    return allColumnIds.filter((columnId) => visibleIds.has(columnId));
  }, [allColumnIds, columns]);
  const visibleColumnIds = manualVisibleColumnIds ?? defaultVisibleColumnIds;
  const displayColumns = columns.filter((column) => visibleColumnIds.includes(caseMatrixColumnId(column)));
  const caseListOnly = displayColumns.length === 0;
  const hiddenColumns = columns.filter((column) => !visibleColumnIds.includes(caseMatrixColumnId(column)));
  const selectedColumn = selectedCell
    ? columns.find((column) => caseMatrixColumnId(column) === selectedCell.columnId) ?? null
    : null;
  const selectedCase = selectedCell
    ? evalSnapshot.cases.find((evalCase) => evalCase.id === selectedCell.caseId) ?? null
    : null;
  const editingCase = caseEditor?.caseId
    ? evalSnapshot.cases.find((evalCase) => evalCase.id === caseEditor.caseId) ?? null
    : null;

  function removeColumn(columnId: string) {
    setManualVisibleColumnIds((current) => (current ?? visibleColumnIds).filter((id) => id !== columnId));
  }

  function setColumnVisible(columnId: string, visible: boolean) {
    setManualVisibleColumnIds((current) => {
      const currentVisibleIds = current ?? visibleColumnIds;
      return visible
        ? allColumnIds.filter((id) => id === columnId || currentVisibleIds.includes(id))
        : currentVisibleIds.filter((id) => id !== columnId);
    });
  }

  return (
    <section className="grid min-w-0 gap-4" aria-label="Cases matrix">
      <DefaultGraderStrip
        allowEdit={allowCaseAuthoring}
        grade={evalSnapshot.grade}
        onEdit={() => setDefaultGraderOpen(true)}
      />
      <CaseMatrixConfigurationBar
        columns={columns}
        defaultVisibleColumnIds={defaultVisibleColumnIds}
        hiddenCount={hiddenColumns.length}
        onCompact={() => setManualVisibleColumnIds(null)}
        onSetVisible={setColumnVisible}
        onShowAll={() => setManualVisibleColumnIds(allColumnIds)}
        visibleColumnIds={visibleColumnIds}
      />
      <div className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-background">
        <Table className={cn("table-fixed", !caseListOnly && "min-w-[62rem]")}>
          <TableHeader>
            <TableRow className="bg-muted/25 hover:bg-muted/25">
              <TableHead className={cn("h-16 bg-muted/25 px-4 text-sm font-medium", !caseListOnly && "sticky left-0 z-30 w-[20rem] shadow-[1px_0_0_hsl(var(--border))]")}>
                Cases
              </TableHead>
              {displayColumns.map((column) => (
                <TableHead
                  className="h-16 w-[13rem] border-l border-border/70 px-4 align-top whitespace-normal"
                  key={caseMatrixColumnId(column)}
                >
                  <CaseMatrixColumnHeader
                    column={column}
                    onRemove={() => removeColumn(caseMatrixColumnId(column))}
                  />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {evalSnapshot.cases.map((evalCase) => {
              const caseRoute = createCaseRoute({ caseId: evalCase.id, evalVersionId: evalVersionId });
              return (
                <TableRow className="hover:bg-transparent" key={evalCase.id}>
                  <TableCell className={cn("h-px bg-background p-0 align-top whitespace-normal", !caseListOnly && "sticky left-0 z-20 shadow-[1px_0_0_hsl(var(--border))]")}>
                    <CaseMatrixCaseControl
                      allowEdit={allowCaseAuthoring}
                      evalCase={evalCase}
                      href={hrefFor(caseRoute)}
                      onEdit={() => setCaseEditor({ caseId: evalCase.id })}
                      onRouteClick={onRouteClick(caseRoute)}
                    />
                  </TableCell>
                  {displayColumns.map((column) => (
                    <TableCell
                      className="h-px border-l border-border/70 p-0 align-top whitespace-normal"
                      key={`${evalCase.id}:${caseMatrixColumnId(column)}`}
                    >
                      <CaseMatrixCell
                        allowMutations={allowMutations}
                        column={column}
                        evalCase={evalCase}
                        onInspect={() => setSelectedCell({ caseId: evalCase.id, columnId: caseMatrixColumnId(column) })}
                        snapshot={snapshot}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
            {allowCaseAuthoring ? (
              <TableRow className="hover:bg-transparent">
                <TableCell className={cn("h-px bg-background p-0 align-top whitespace-normal", !caseListOnly && "sticky left-0 z-20 shadow-[1px_0_0_hsl(var(--border))]")}>
                  <CaseMatrixAddCaseControl
                    onClick={() => setCaseEditor({})}
                  />
                </TableCell>
                {displayColumns.map((column) => (
                  <TableCell
                    className="h-px border-l border-border/70 p-0 align-top whitespace-normal"
                    key={`add-case:${caseMatrixColumnId(column)}`}
                  />
                ))}
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      {allowCaseAuthoring ? (
        <CaseMatrixCaseEditorDialog
          apiBasePath={apiBasePath}
          defaultGrade={evalSnapshot.grade}
          evalHash={evalSnapshot.hash}
          evalCase={editingCase}
          gradeAdapters={evalSnapshot.gradeAdapters}
          open={Boolean(caseEditor)}
          refreshSnapshot={refreshSnapshot}
          onOpenChange={(open) => closeDialog(open, () => setCaseEditor(null))}
        />
      ) : null}
      <DefaultGraderDialog
        apiBasePath={apiBasePath}
        defaultGrade={evalSnapshot.grade}
        gradeAdapters={evalSnapshot.gradeAdapters}
        open={defaultGraderOpen}
        refreshSnapshot={refreshSnapshot}
        onOpenChange={setDefaultGraderOpen}
      />
      {selectedCase && selectedColumn ? (
        <CaseMatrixCellDialog
          apiBasePath={apiBasePath}
          allowMutations={allowMutations}
          column={selectedColumn}
          evalCase={selectedCase}
          hrefFor={hrefFor}
          navigate={navigate}
          open={Boolean(selectedCell)}
          onOpenChange={(open) => closeDialog(open, () => setSelectedCell(null))}
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

function CaseMatrixCaseControl({
  allowEdit,
  evalCase,
  href,
  onEdit,
  onRouteClick,
}: {
  allowEdit: boolean;
  evalCase: WorkbenchEvalCaseSnapshot;
  href: string;
  onEdit: () => void;
  onRouteClick: (event: MouseEvent<HTMLElement>) => void;
}) {
  const className = "grid h-full min-h-40 w-full cursor-pointer bg-transparent px-4 py-5 text-left text-inherit no-underline transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const content = (
    <div className="pointer-events-none min-w-0">
      <CaseMatrixInputContent evalCase={evalCase} />
    </div>
  );

  if (allowEdit) {
    return (
      <Button
        aria-label={`Edit ${caseDisplayTitle(evalCase)}`}
        className={className}
        title={`Edit ${caseDisplayTitle(evalCase)}`}
        type="button"
        variant="ghost"
        onClick={onEdit}
      >
        {content}
      </Button>
    );
  }

  return (
    <a
      aria-label={`Open ${caseDisplayTitle(evalCase)}`}
      className={className}
      href={href}
      onClick={onRouteClick}
    >
      {content}
    </a>
  );
}

function CaseMatrixAddCaseControl({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <Button
      aria-label="Add case"
      className="h-14 w-full justify-start rounded-none px-4 text-left"
      title="Add case"
      type="button"
      variant="ghost"
      onClick={onClick}
    >
      <PlusIcon aria-hidden="true" data-icon="inline-start" />
      <span>Add case</span>
    </Button>
  );
}

function DefaultGraderStrip({
  allowEdit,
  grade,
  onEdit,
}: {
  allowEdit: boolean;
  grade: WorkbenchEvalSnapshot["grade"];
  onEdit: () => void;
}) {
  const editDisabledReason = "Historical evals are read-only. Switch to current to edit.";
  return (
    <Button
      aria-label="Edit default grader"
      className="h-auto w-full min-w-0 justify-between px-4 py-3 text-left"
      disabled={!allowEdit}
      title={allowEdit ? "Edit default grader" : editDisabledReason}
      type="button"
      variant="outline"
      onClick={onEdit}
    >
      <div className="grid min-w-0 gap-1">
        <span className="text-xs font-medium uppercase text-muted-foreground">Default grader</span>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">{grade.label}</span>
          <span className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{grade.summary}</span>
        </div>
      </div>
    </Button>
  );
}

function selectedDefaultGradeOption(
  defaultGrade: WorkbenchEvalSnapshot["grade"],
  gradeAdapters: readonly WorkbenchGradeAdapterOption[],
  selected: string,
): Pick<WorkbenchGradeAdapterOption, "adapter" | "label" | "authoring"> {
  return selected === defaultGrade.adapter
    ? defaultGrade
    : gradeAdapters.find((option) => option.adapter === selected) ?? defaultGrade;
}

function evalDefaultGradeAuthoringControls(
  grade: Pick<WorkbenchGradeAdapterOption, "authoring">,
): WorkbenchGradePlanAuthoringControl[] {
  return grade.authoring.filter((control) => control.kind !== "file");
}

function defaultGradeAuthoringValues(
  defaultGrade: WorkbenchEvalSnapshot["grade"],
  selectedGrade: Pick<WorkbenchGradeAdapterOption, "adapter" | "authoring">,
  controls: readonly WorkbenchGradePlanAuthoringControl[],
): Record<string, Json> {
  const values = workbenchGradePlanAuthoringDefaults(controls);
  if (selectedGrade.adapter !== defaultGrade.adapter) {
    return values;
  }
  for (const control of controls) {
    if (control.kind !== "list" || control.name !== "criteria") {
      continue;
    }
    const criteria = defaultGrade.display.flatMap((block) =>
      block.kind === "list" && block.title === "Criteria"
        ? block.items.map((item) => ({ description: item.description ?? item.label }))
        : []
    );
    if (criteria.length > 0) {
      values[control.name] = criteria;
    }
  }
  return values;
}

interface GraderPolicySelectOption {
  label: string;
  textValue?: string;
  value: string;
}

function GraderPolicyEditor({
  controls,
  emptyMessage,
  onControlChange,
  onValueChange,
  options,
  path,
  selectLabel,
  value,
  values,
}: {
  controls: readonly WorkbenchGradePlanAuthoringControl[];
  emptyMessage: string;
  onControlChange: (name: string, value: Json) => void;
  onValueChange: (value: string) => void;
  options: readonly GraderPolicySelectOption[];
  path?: string;
  selectLabel: string;
  value: string;
  values: Record<string, Json>;
}) {
  const selectId = useId();
  return (
    <>
      <Field>
        <FieldLabel htmlFor={selectId}>Grader</FieldLabel>
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger aria-label={selectLabel} className="h-9 w-full bg-background" id={selectId}>
            <SelectValue placeholder="Select grader" />
          </SelectTrigger>
          <SelectContent align="start" className="w-[var(--radix-select-trigger-width)]" position="popper">
            <SelectGroup>
              {options.map((option) => (
                <SelectItem
                  key={option.value}
                  textValue={option.textValue ?? option.label}
                  value={option.value}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      {controls.length > 0 ? (
        <GradeAuthoringControls
          controls={controls}
          values={values}
          onChange={onControlChange}
        />
      ) : (
        <div className="rounded-md border border-dashed border-border px-3 py-3 text-sm leading-5 text-muted-foreground">
          {emptyMessage}
        </div>
      )}
      {path ? <div className="text-xs text-muted-foreground">{path}</div> : null}
    </>
  );
}

function defaultGraderEmptyMessage(adapter: string): string {
  if (adapter === "none") {
    return "No default grader. Cases are ungraded until they choose a case-level grader.";
  }
  if (adapter === "tests") {
    return "Tests are case-owned. The eval default selects Tests; each case supplies its own tests/test.sh.";
  }
  return "This grader has no eval-level settings.";
}

function caseGraderEmptyMessage(
  defaultGrade: WorkbenchEvalSnapshot["grade"],
  selectedGrader: string,
): string {
  if (selectedGrader === INHERIT_GRADE_ADAPTER_VALUE) {
    if (defaultGrade.adapter === "none") {
      return "No case-level grader. Choose a grader to grade this case.";
    }
    return `Uses the eval default (${defaultGrade.label}) without writing a case-level grader override.`;
  }
  if (selectedGrader === "none") {
    return "This case is ungraded.";
  }
  return "This grader has no case-level fields.";
}

function DefaultGraderDialog({
  apiBasePath,
  defaultGrade,
  gradeAdapters,
  open,
  onOpenChange,
  refreshSnapshot,
}: {
  apiBasePath: string;
  defaultGrade: WorkbenchEvalSnapshot["grade"];
  gradeAdapters: readonly WorkbenchGradeAdapterOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refreshSnapshot: () => void;
}) {
  const [selectedAdapter, setSelectedAdapter] = useState(defaultGrade.adapter);
  const selectedGrade = useMemo(
    () => selectedDefaultGradeOption(defaultGrade, gradeAdapters, selectedAdapter),
    [defaultGrade, gradeAdapters, selectedAdapter],
  );
  const gradeAuthoring = useMemo(() => evalDefaultGradeAuthoringControls(selectedGrade), [selectedGrade]);
  const graderOptions = useMemo<GraderPolicySelectOption[]>(
    () => gradeAdapters.map((option) => ({
      label: option.label,
      value: option.adapter,
    })),
    [gradeAdapters],
  );
  const [gradeValues, setGradeValues] = useState<Record<string, Json>>(
    () => defaultGradeAuthoringValues(defaultGrade, selectedGrade, gradeAuthoring),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedAdapter(defaultGrade.adapter);
      const controls = evalDefaultGradeAuthoringControls(defaultGrade);
      setGradeValues(defaultGradeAuthoringValues(defaultGrade, defaultGrade, controls));
      setError(null);
      setPending(false);
    }
  }, [defaultGrade, open]);

  useEffect(() => {
    if (open) {
      setGradeValues(defaultGradeAuthoringValues(defaultGrade, selectedGrade, gradeAuthoring));
      setError(null);
    }
  }, [defaultGrade, gradeAuthoring, open, selectedGrade]);

  async function submit() {
    if (pending) {
      return;
    }
    setError(null);
    const authoringIssue = workbenchGradePlanAuthoringIssues(
      gradeAuthoring,
      gradeValues,
      { pathLabel: "Eval grade.authoring" },
    )[0];
    if (authoringIssue) {
      setError(authoringIssue.message);
      return;
    }
    setPending(true);
    try {
      const authoring = authoringFromControls(gradeAuthoring, gradeValues);
      await updateEvaluationGrader(apiBasePath, {
        adapter: selectedGrade.adapter,
        ...(authoring ? { authoring } : {}),
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
          <DialogTitle>Default grader</DialogTitle>
          <DialogDescription>Edit the grader policy inherited by cases without an override.</DialogDescription>
        </DialogHeader>
        <form
          className="grid min-w-0 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <GraderPolicyEditor
            controls={gradeAuthoring}
            emptyMessage={defaultGraderEmptyMessage(selectedGrade.adapter)}
            options={graderOptions}
            path=".workbench/eval.yaml"
            selectLabel="Default grader"
            value={selectedAdapter}
            values={gradeValues}
            onControlChange={(name, value) => setGradeValues((current) => ({ ...current, [name]: value }))}
            onValueChange={setSelectedAdapter}
          />
          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm leading-5 text-destructive" role="alert">
              {error}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const INHERIT_GRADE_ADAPTER_VALUE = "__eval_default__";

function selectedCaseGradeOption(
  defaultGrade: WorkbenchEvalSnapshot["grade"],
  gradeAdapters: readonly WorkbenchGradeAdapterOption[],
  selected: string,
): Pick<WorkbenchGradeAdapterOption, "adapter" | "label" | "authoring"> {
  if (selected === INHERIT_GRADE_ADAPTER_VALUE) {
    return {
      ...defaultGrade,
      authoring: defaultGrade.authoring.filter((control) => control.kind === "file"),
    };
  }
  return gradeAdapters.find((option) => option.adapter === selected) ?? defaultGrade;
}

function caseEditorPromptValue(evalCase: WorkbenchEvalCaseSnapshot): string {
  return evalCase.description?.trim() || evalCase.command?.trim() || "";
}

function caseEditorSelectedGrader(evalCase: WorkbenchEvalCaseSnapshot | null): string {
  return evalCase?.grade.adapterSource === "case"
    ? evalCase.grade.adapter
    : INHERIT_GRADE_ADAPTER_VALUE;
}

function caseEditorGradeAuthoring(
  evalCase: WorkbenchEvalCaseSnapshot | null,
  selectedGrader: string,
  selectedGrade: Pick<WorkbenchGradeAdapterOption, "adapter" | "authoring">,
): readonly WorkbenchGradePlanAuthoringControl[] {
  return evalCase?.grade.adapterSource === "case" &&
    selectedGrader !== INHERIT_GRADE_ADAPTER_VALUE &&
    selectedGrade.adapter === evalCase.grade.adapter
    ? evalCase.grade.authoring
    : selectedGrade.authoring;
}

function caseEditorInitialGradeValues(
  evalCase: WorkbenchEvalCaseSnapshot | null,
  controls: readonly WorkbenchGradePlanAuthoringControl[],
): Record<string, Json> {
  const values = workbenchGradePlanAuthoringDefaults(controls);
  if (!evalCase) {
    return values;
  }
  for (const control of controls) {
    if (control.kind === "file") {
      const file = caseEditorFileForControl(evalCase, control);
      if (file && file.kind !== "binary" && file.content) {
        values[control.name] = file.content;
      }
      continue;
    }
    if (control.kind === "list") {
      const rows = caseEditorDisplayListValue(evalCase, control);
      if (rows.length > 0) {
        values[control.name] = rows;
      }
      continue;
    }
    if (control.kind === "text" || control.kind === "choice") {
      const value = caseEditorDisplayTextValue(evalCase, control.name, control.label);
      if (value) {
        values[control.name] = value;
      }
    }
  }
  return values;
}

function caseEditorFileAuthoringTargets(
  evalCase: WorkbenchEvalCaseSnapshot,
  controls: readonly WorkbenchGradePlanAuthoringControl[],
): Array<{ name: string; path: string }> {
  return controls.flatMap((control) => {
    if (control.kind !== "file") {
      return [];
    }
    const file = caseEditorFileForControl(evalCase, control);
    return file && file.kind !== "binary" ? [{ name: control.name, path: file.path }] : [];
  });
}

function caseEditorFileForControl(
  evalCase: WorkbenchEvalCaseSnapshot,
  control: Extract<WorkbenchGradePlanAuthoringControl, { kind: "file" }>,
): SurfaceSnapshotFile | undefined {
  return evalCase.files.find((entry) =>
    entry.path === control.path || entry.path.endsWith(`/${control.path}`)
  );
}

function caseEditorDisplayListValue(
  evalCase: WorkbenchEvalCaseSnapshot,
  control: Extract<WorkbenchGradePlanAuthoringControl, { kind: "list" }>,
): Json[] {
  const titleKeys = [
    control.name,
    control.label,
    control.itemLabel ?? "",
  ].map(normalizedAuthoringLabel).filter(Boolean);
  const block = evalCase.grade.display.find((entry) =>
    entry.kind === "list" &&
    normalizedAuthoringLabel(entry.title ?? "") &&
    titleKeys.some((key) => {
      const title = normalizedAuthoringLabel(entry.title ?? "");
      return title.includes(key) || key.includes(title);
    })
  );
  if (!block || block.kind !== "list") {
    return [];
  }
  return block.items.map((item) => {
    const row = workbenchGradePlanAuthoringListItemDefault(control);
    for (const field of control.fields) {
      if (field.name === "description" && item.description) {
        row[field.name] = item.description;
      } else if ((field.name === "id" || field.name === "label") && item.label) {
        row[field.name] = item.label;
      }
    }
    return row;
  });
}

function caseEditorDisplayTextValue(
  evalCase: WorkbenchEvalCaseSnapshot,
  name: string,
  label: string,
): string | undefined {
  const keys = [name, label].map(normalizedAuthoringLabel).filter(Boolean);
  for (const block of evalCase.grade.display) {
    if (block.kind !== "key_value") {
      continue;
    }
    const item = block.items.find((entry) => keys.includes(normalizedAuthoringLabel(entry.label)));
    if (item?.value) {
      return item.value;
    }
  }
  return undefined;
}

function normalizedAuthoringLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function CaseMatrixCaseEditorDialog({
  apiBasePath,
  defaultGrade,
  evalHash,
  evalCase,
  gradeAdapters,
  open,
  onOpenChange,
  refreshSnapshot,
}: {
  apiBasePath: string;
  defaultGrade: WorkbenchEvalSnapshot["grade"];
  evalHash: string;
  evalCase: WorkbenchEvalCaseSnapshot | null;
  gradeAdapters: readonly WorkbenchGradeAdapterOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refreshSnapshot: () => void;
}) {
  const isEdit = Boolean(evalCase);
  const [title, setTitle] = useState(() => evalCase?.id ?? "");
  const [titleTouched, setTitleTouched] = useState(() => Boolean(evalCase));
  const [prompt, setPrompt] = useState(() => evalCase ? caseEditorPromptValue(evalCase) : "");
  const [selectedGrader, setSelectedGrader] = useState(() => caseEditorSelectedGrader(evalCase));
  const selectedGrade = useMemo(
    () => selectedCaseGradeOption(defaultGrade, gradeAdapters, selectedGrader),
    [defaultGrade, gradeAdapters, selectedGrader],
  );
  const gradeAuthoring = useMemo(
    () => caseEditorGradeAuthoring(evalCase, selectedGrader, selectedGrade),
    [evalCase, selectedGrade, selectedGrader],
  );
  const graderOptions = useMemo<GraderPolicySelectOption[]>(() => [
    {
      label: `Eval default: ${defaultGrade.label}`,
      textValue: `Eval default: ${defaultGrade.label}`,
      value: INHERIT_GRADE_ADAPTER_VALUE,
    },
    ...gradeAdapters
      .filter((option) => !(option.adapter === "none" && defaultGrade.adapter === "none"))
      .map((option) => ({
        label: option.adapter === defaultGrade.adapter ? `${option.label} override` : option.label,
        value: option.adapter,
      })),
  ], [defaultGrade.adapter, defaultGrade.label, gradeAdapters]);
  const [gradeValues, setGradeValues] = useState<Record<string, Json>>(
    () => caseEditorInitialGradeValues(evalCase, gradeAuthoring),
  );
  const [fileValuesLoading, setFileValuesLoading] = useState(false);
  const [fileValuesError, setFileValuesError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      setFileValuesError(null);
      setFileValuesLoading(false);
      setPending(false);
      return;
    }
    const nextSelectedGrader = caseEditorSelectedGrader(evalCase);
    const nextSelectedGrade = selectedCaseGradeOption(defaultGrade, gradeAdapters, nextSelectedGrader);
    const nextAuthoring = caseEditorGradeAuthoring(evalCase, nextSelectedGrader, nextSelectedGrade);
    setTitle(evalCase?.id ?? "");
    setTitleTouched(Boolean(evalCase));
    setPrompt(evalCase ? caseEditorPromptValue(evalCase) : "");
    setSelectedGrader(nextSelectedGrader);
    setGradeValues(caseEditorInitialGradeValues(evalCase, nextAuthoring));
    setError(null);
    setFileValuesError(null);
    setFileValuesLoading(false);
    setPending(false);
  }, [defaultGrade, evalCase, gradeAdapters, open]);

  useEffect(() => {
    if (!open || !evalCase) {
      setFileValuesError(null);
      setFileValuesLoading(false);
      return;
    }
    const fileTargets = caseEditorFileAuthoringTargets(evalCase, gradeAuthoring);
    if (fileTargets.length === 0) {
      setFileValuesError(null);
      setFileValuesLoading(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setFileValuesLoading(true);
    setFileValuesError(null);
    void Promise.all(fileTargets.map(async (target) => {
      const response = await fetch(
        fileContentApiPath(apiBasePath, "case", workbenchCaseFileOwnerId(evalHash, evalCase.id), target.path),
        { signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const content = await response.json() as WorkbenchInspectionFileContent;
      return [target.name, content.content ?? ""] as const;
    }))
      .then((entries) => {
        if (cancelled) {
          return;
        }
        const loaded = Object.fromEntries(entries);
        const defaults = workbenchGradePlanAuthoringDefaults(gradeAuthoring);
        setGradeValues((current) => {
          const next = { ...current };
          for (const [name, value] of Object.entries(loaded)) {
            const currentValue = current[name];
            if (currentValue === "" || currentValue === defaults[name] || currentValue === undefined) {
              next[name] = value;
            }
          }
          return next;
        });
        setFileValuesLoading(false);
      })
      .catch((nextError: unknown) => {
        if (!cancelled && !controller.signal.aborted) {
          setFileValuesError(nextError instanceof Error ? nextError.message : String(nextError));
          setFileValuesLoading(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBasePath, evalCase, evalHash, gradeAuthoring, open]);

  function changeGrader(nextSelectedGrader: string): void {
    const nextSelectedGrade = selectedCaseGradeOption(defaultGrade, gradeAdapters, nextSelectedGrader);
    const nextAuthoring = caseEditorGradeAuthoring(evalCase, nextSelectedGrader, nextSelectedGrade);
    setSelectedGrader(nextSelectedGrader);
    setGradeValues(caseEditorInitialGradeValues(evalCase, nextAuthoring));
    setError(null);
    setFileValuesError(null);
  }

  function changeTitle(nextTitle: string): void {
    setTitleTouched(true);
    setTitle(nextTitle);
    setError(null);
  }

  function changePrompt(nextPrompt: string): void {
    setPrompt(nextPrompt);
    if (!isEdit && !titleTouched) {
      setTitle(normalizeWorkbenchSkillName(nextPrompt.slice(0, 60)));
    }
    setError(null);
  }

  async function submit() {
    if (!title.trim() || !prompt.trim() || pending || fileValuesLoading) {
      return;
    }
    setError(null);
    const submitInheritsDefault = selectedGrader === INHERIT_GRADE_ADAPTER_VALUE;
    const submitGradeAuthoring = selectedGrade.authoring;
    const submitGradeValues = submitGradeAuthoring.length > 0 ? gradeValues : {};
    const authoringIssue = workbenchGradePlanAuthoringIssues(submitGradeAuthoring, submitGradeValues)[0];
    if (authoringIssue) {
      setError(authoringIssue.message);
      return;
    }
    setPending(true);
    try {
      const authoring = authoringFromControls(submitGradeAuthoring, submitGradeValues);
      const grade = {
        ...(submitInheritsDefault ? {} : { adapter: selectedGrade.adapter }),
        ...(authoring ? { authoring } : {}),
      };
      await saveEvaluationCase(apiBasePath, {
        ...(evalCase ? { caseId: evalCase.id } : {}),
        title: title.trim(),
        prompt: prompt.trim(),
        ...(Object.keys(grade).length > 0 ? { grade } : {}),
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
          <DialogTitle>{isEdit ? `Edit ${title || caseDisplayTitle(evalCase!)}` : "Add case"}</DialogTitle>
          <DialogDescription>Source-backed case row in this evaluation.</DialogDescription>
        </DialogHeader>
        <form
          className="grid min-w-0 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field>
            <FieldLabel htmlFor="evaluation-case-title">Title</FieldLabel>
            <Input
              className="h-9 bg-background font-mono text-sm"
              id="evaluation-case-title"
              value={title}
              onChange={(event) => changeTitle(event.currentTarget.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="evaluation-case-prompt">Prompt</FieldLabel>
            <Textarea
              className="min-h-32 resize-y bg-background leading-6"
              id="evaluation-case-prompt"
              value={prompt}
              onChange={(event) => changePrompt(event.currentTarget.value)}
            />
          </Field>
          <GraderPolicyEditor
            controls={gradeAuthoring}
            emptyMessage={caseGraderEmptyMessage(defaultGrade, selectedGrader)}
            options={graderOptions}
            selectLabel="Grader"
            value={selectedGrader}
            values={gradeValues}
            onControlChange={(name, value) => setGradeValues((current) => ({ ...current, [name]: value }))}
            onValueChange={changeGrader}
          />
          {error || fileValuesError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm leading-5 text-destructive" role="alert">
              {error ?? fileValuesError}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || !prompt.trim() || pending || fileValuesLoading}>
              {pending ? "Saving" : fileValuesLoading ? "Loading" : isEdit ? "Save case" : "Add case"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GradeAuthoringControls({
  controls,
  onChange,
  values,
}: {
  controls: readonly WorkbenchGradePlanAuthoringControl[];
  onChange: (name: string, value: Json) => void;
  values: Record<string, Json>;
}) {
  const controlsId = useId();
  return (
    <FieldGroup className="gap-3">
      {controls.map((control) => {
        const controlId = `${controlsId}-${control.name}`;
        if (control.kind === "notice") {
          return (
            <div className="grid min-w-0 gap-1 rounded-md border border-border/70 px-3 py-2 text-sm" key={control.name}>
              <span className="font-medium text-foreground">{control.label}</span>
              <span className="break-words text-muted-foreground [overflow-wrap:anywhere]">{control.message}</span>
            </div>
          );
        }
        if (control.kind === "list") {
          return (
            <GradeAuthoringListControl
              control={control}
              key={control.name}
              value={values[control.name]}
              onChange={(value) => onChange(control.name, value)}
            />
          );
        }
        if (control.kind === "file") {
          return (
            <Field key={control.name}>
              <FieldLabel htmlFor={controlId}>{control.label}</FieldLabel>
              {control.description ? (
                <FieldDescription>{control.description}</FieldDescription>
              ) : null}
              <Textarea
                className="min-h-56 resize-y bg-background font-mono text-xs leading-5"
                id={controlId}
                value={stringAuthoringValue(values[control.name])}
                onChange={(event) => onChange(control.name, event.currentTarget.value)}
              />
              <FieldDescription>{control.path}</FieldDescription>
            </Field>
          );
        }
        if (control.kind === "choice") {
          return (
            <Field key={control.name}>
              <FieldLabel htmlFor={controlId}>{control.label}</FieldLabel>
              {control.description ? (
                <FieldDescription>{control.description}</FieldDescription>
              ) : null}
              <GradeAuthoringChoiceSelect
                id={controlId}
                label={control.label}
                options={control.options}
                value={stringAuthoringValue(values[control.name])}
                onChange={(value) => onChange(control.name, value)}
              />
            </Field>
          );
        }
        return (
          <Field key={control.name}>
            <FieldLabel htmlFor={controlId}>{control.label}</FieldLabel>
            {control.description ? (
              <FieldDescription>{control.description}</FieldDescription>
            ) : null}
            <Input
              className="h-9 bg-background"
              id={controlId}
              placeholder={control.placeholder}
              value={stringAuthoringValue(values[control.name])}
              onChange={(event) => onChange(control.name, event.currentTarget.value)}
            />
          </Field>
        );
      })}
    </FieldGroup>
  );
}

function GradeAuthoringListControl({
  control,
  onChange,
  value,
}: {
  control: Extract<WorkbenchGradePlanAuthoringControl, { kind: "list" }>;
  onChange: (value: Json) => void;
  value: Json | undefined;
}) {
  const rows = listAuthoringRows(value, control);
  const canAdd = control.maxItems === undefined || rows.length < control.maxItems;

  function updateRow(index: number, fieldName: string, fieldValue: Json): void {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [fieldName]: fieldValue } : row));
  }

  function removeRow(index: number): void {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index));
  }

  function addRow(): void {
    if (canAdd) {
      onChange([...rows, workbenchGradePlanAuthoringListItemDefault(control)]);
    }
  }

  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <span className="text-sm font-medium text-foreground">{control.label}</span>
          {control.description ? (
            <span className="text-xs leading-5 text-muted-foreground">{control.description}</span>
          ) : null}
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!canAdd} onClick={addRow}>
          <PlusIcon aria-hidden="true" data-icon="inline-start" />
          Add
        </Button>
      </div>
      <div className="grid min-w-0 gap-2">
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
            No {control.itemLabel?.toLowerCase() ?? "items"}.
          </div>
        ) : rows.map((row, index) => (
          <div className="grid min-w-0 gap-2 rounded-md border border-border/70 p-3" key={index}>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <span className="text-xs font-medium uppercase text-muted-foreground">
                {(control.itemLabel ?? "Item")} {index + 1}
              </span>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove item" onClick={() => removeRow(index)}>
                <XIcon aria-hidden="true" />
              </Button>
            </div>
            {control.fields.map((field) => (
              <GradeAuthoringListFieldControl
                field={field}
                key={field.name}
                value={row[field.name]}
                onChange={(fieldValue) => updateRow(index, field.name, fieldValue)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function GradeAuthoringListFieldControl({
  field,
  onChange,
  value,
}: {
  field: Extract<WorkbenchGradePlanAuthoringControl, { kind: "list" }>["fields"][number];
  onChange: (value: Json) => void;
  value: Json | undefined;
}) {
  const inputId = useId();
  if (field.kind === "choice") {
    return (
      <Field>
        <FieldLabel htmlFor={inputId}>{field.label}</FieldLabel>
        <GradeAuthoringChoiceSelect
          id={inputId}
          label={field.label}
          options={field.options}
          value={stringAuthoringValue(value)}
          onChange={onChange}
        />
      </Field>
    );
  }
  if (field.kind === "number") {
    return (
      <Field>
        <FieldLabel htmlFor={inputId}>{field.label}</FieldLabel>
        <Input
          className="h-9 bg-background"
          id={inputId}
          max={field.max}
          min={field.min}
          step={field.step}
          type="number"
          value={typeof value === "number" ? String(value) : ""}
          onChange={(event) => {
            const next = event.currentTarget.value.trim();
            onChange(next ? Number(next) : "");
          }}
        />
      </Field>
    );
  }
  const input = field.multiline ? (
    <Textarea
      className="min-h-20 resize-y bg-background leading-6"
      id={inputId}
      placeholder={field.placeholder}
      value={stringAuthoringValue(value)}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ) : (
    <Input
      className="h-9 bg-background"
      id={inputId}
      placeholder={field.placeholder}
      value={stringAuthoringValue(value)}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
  return (
    <Field>
      <FieldLabel htmlFor={inputId}>{field.label}</FieldLabel>
      {input}
    </Field>
  );
}

function GradeAuthoringChoiceSelect({
  id,
  label,
  onChange,
  options,
  value,
}: {
  id?: string;
  label: string;
  onChange: (value: string) => void;
  options: readonly { label: string; value: string }[];
  value: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-9 w-full bg-background" id={id}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent align="start" className="w-[var(--radix-select-trigger-width)]" position="popper">
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function authoringFromControls(
  controls: readonly WorkbenchGradePlanAuthoringControl[],
  values: Record<string, Json>,
): Record<string, Json> | undefined {
  const authoring: Record<string, Json> = {};
  for (const control of controls) {
    const value = compactAuthoringValue(control, values[control.name]);
    if (value !== undefined) {
      authoring[control.name] = value;
    }
  }
  return Object.keys(authoring).length > 0 ? authoring : undefined;
}

function compactAuthoringValue(
  control: WorkbenchGradePlanAuthoringControl,
  value: Json | undefined,
): Json | undefined {
  if (control.kind === "notice") {
    return undefined;
  }
  if (control.kind === "list") {
    const rows = Array.isArray(value) ? value : [];
    const compactRows = rows.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }
      const row: Record<string, Json> = {};
      for (const field of control.fields) {
        const fieldValue = compactListFieldValue(field, entry[field.name]);
        if (fieldValue !== undefined) {
          row[field.name] = fieldValue;
        }
      }
      return Object.keys(row).length > 0 ? [row] : [];
    });
    return compactRows.length > 0 ? compactRows : undefined;
  }
  if (control.kind === "file") {
    const content = typeof value === "string" ? value : "";
    return content.trim() ? content : undefined;
  }
  if (control.kind === "choice" || control.kind === "text") {
    const text = typeof value === "string" ? value.trim() : "";
    return text ? text : undefined;
  }
  return undefined;
}

function compactListFieldValue(
  field: Extract<WorkbenchGradePlanAuthoringControl, { kind: "list" }>["fields"][number],
  value: Json | undefined,
): Json | undefined {
  if (field.kind === "number") {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : undefined;
}

function listAuthoringRows(
  value: Json | undefined,
  control: Extract<WorkbenchGradePlanAuthoringControl, { kind: "list" }>,
): Record<string, Json>[] {
  if (!Array.isArray(value)) {
    return Array.from({ length: control.minItems ?? 0 }, () => workbenchGradePlanAuthoringListItemDefault(control));
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return workbenchGradePlanAuthoringListItemDefault(control);
    }
    return { ...entry };
  });
}

function stringAuthoringValue(value: Json | undefined): string {
  return typeof value === "string" ? value : "";
}

interface CaseMatrixCellAction {
  label: string;
  mode: WorkbenchCaseRunKind;
  pendingLabel: string;
  rerun?: boolean;
}

function caseMatrixCellActions(
  current: { caseResult: WorkbenchRunEvidenceCaseResult } | null,
  caseRequiresGrade: boolean,
): { primary: CaseMatrixCellAction; secondary: CaseMatrixCellAction[] } {
  const runStatus = current?.caseResult.run?.status;
  const hasRun = Boolean(runStatus);
  const hasGrade = Boolean(current?.caseResult.grade);
  const runAction: CaseMatrixCellAction = {
    mode: "run",
    label: hasRun ? "Rerun" : "Run",
    pendingLabel: "Running",
    ...(hasRun ? { rerun: true } : {}),
  };
  const evalAction: CaseMatrixCellAction = {
    mode: "eval",
    label: hasRun ? "Rerun + grade" : "Run + grade",
    pendingLabel: "Running",
    ...(hasRun ? { rerun: true } : {}),
  };
  const gradeAction: CaseMatrixCellAction = {
    mode: "grade",
    label: "Grade latest",
    pendingLabel: "Grading",
    ...(hasGrade ? { rerun: true } : {}),
  };
  if (!caseRequiresGrade) {
    if (!hasRun) {
      return { primary: runAction, secondary: [] };
    }
    if (runStatus !== "succeeded") {
      return { primary: { ...runAction, label: "Retry run" }, secondary: [] };
    }
    return { primary: { ...runAction, label: "Rerun" }, secondary: [] };
  }
  if (!hasRun) {
    return { primary: evalAction, secondary: [runAction] };
  }
  if (runStatus !== "succeeded") {
    return { primary: { ...runAction, label: "Retry run" }, secondary: [evalAction] };
  }
  if (!hasGrade) {
    return { primary: gradeAction, secondary: [{ ...runAction, label: "Rerun" }] };
  }
  return { primary: evalAction, secondary: [gradeAction, { ...runAction, label: "Run only" }] };
}

function CellActionIcon({ mode }: { mode: WorkbenchCaseRunKind }) {
  const Icon = mode === "run" ? PlayCircleIcon : CheckIcon;
  return <Icon aria-hidden="true" data-icon="inline-start" />;
}

function CaseMatrixCellDialog({
  apiBasePath,
  allowMutations,
  column,
  evalCase,
  hrefFor,
  navigate,
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
  hrefFor: (route: WorkbenchRoute) => string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  onOpenChange: (open: boolean) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  open: boolean;
  refreshSnapshot: () => void;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const current = useMemo(
    () => caseMatrixCurrentResult(snapshot, evalCase.id, column),
    [column, evalCase.id, snapshot],
  );
  const related = useMemo(
    () => caseMatrixRelatedResults(snapshot, evalCase.id, column),
    [column, evalCase.id, snapshot],
  );
  const caseRequiresGrade = caseMatrixCaseRequiresGrade(evalCase);
  const actions = caseMatrixCellActions(current, caseRequiresGrade);
  const [pending, setPending] = useState<WorkbenchCaseRunKind | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const prompt = evalCase.description ?? evalCase.command ?? evalCase.id;

  async function startCellOperation(action: CaseMatrixCellAction) {
    if (pendingRef.current) {
      return;
    }
    pendingRef.current = true;
    const request: WorkbenchOperationRequest = {
      kind: "eval",
      variant: "local",
      ...(column.evalHash ? { evalHash: column.evalHash } : {}),
      caseIds: [evalCase.id],
      targets: [column.target],
      steps: workbenchOperationStepsForRunKind(action.mode),
      samples: 1,
      ...(action.rerun ? { rerun: true } : {}),
      ...(action.mode === "grade" && current?.run ? { gradeOfRunId: current.run.id } : {}),
    };
    setPending(action.mode);
    setError(null);
    try {
      const started = await startWorkbenchOperation(apiBasePath, request);
      refreshSnapshot();
      navigate(routeForWorkbenchRunSnapshot(started));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next || !pendingRef.current) onOpenChange(next); }}>
      <DialogContent className="max-w-4xl" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{caseDisplayTitle(evalCase)}</DialogTitle>
          <DialogDescription>{caseMatrixColumnLabel(column)} / {caseMatrixColumnDetail(column)}</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-4">
          {allowMutations ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button type="button" size="sm" disabled={Boolean(pending)} onClick={() => void startCellOperation(actions.primary)}>
                <CellActionIcon mode={actions.primary.mode} />
                {pending === actions.primary.mode ? actions.primary.pendingLabel : actions.primary.label}
              </Button>
              {actions.secondary.map((action) => (
                <Button
                  disabled={Boolean(pending)}
                  key={action.mode}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => void startCellOperation(action)}
                >
                  <CellActionIcon mode={action.mode} />
                  {pending === action.mode ? action.pendingLabel : action.label}
                </Button>
              ))}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm leading-5 text-destructive" role="alert">
              {error}
            </div>
          ) : null}
          {current ? (
            <div className="grid min-w-0 gap-4">
              <section className="grid min-w-0 gap-3 border-b border-border/70 pb-4" aria-label="Current output">
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
              <section className="grid min-w-0 gap-2" aria-label="Run history">
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
                        className="flex min-w-0 w-full cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-border/60 px-3 py-2.5 text-sm no-underline transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        href={hrefFor(route)}
                        key={`${run.id}:${runCaseResultKey(caseResult)}`}
                        onClick={onRouteClick(route)}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <StatusBadge status={caseResult.status} />
                          <span className="text-xs text-muted-foreground">{formatTimestamp(run.finishedAt ?? run.createdAt)}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatQualityMetric(caseResult.score)}</span>
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

function caseMatrixCurrentResult(
  snapshot: WorkbenchInspectionSnapshot,
  caseId: string,
  column: CaseMatrixColumn,
): { run: WorkbenchRun; caseResult: WorkbenchRunEvidenceCaseResult } | null {
  const evidence = column.evidence;
  const caseResult = evidence?.cases.find((entry) => entry.caseId === caseId) ?? null;
  if (!evidence || !caseResult) {
    return null;
  }
  const caseJobIds = new Set(runCaseResultJobIds(caseResult));
  const run = column.run ??
    snapshot.runs.find((entry) => entry.id === evidence.runId) ??
    snapshot.runs.find((entry) => entry.jobIds.some((jobId) => caseJobIds.has(jobId))) ??
    null;
  return run ? { run, caseResult } : null;
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
    (column.skillVersionId
      ? caseResult.skillVersionId === column.skillVersionId || caseResult.versionId === column.skillVersionId
      : !column.target.versionId || caseResult.versionId === column.target.versionId);
}

function CaseMatrixConfigurationBar({
  columns,
  defaultVisibleColumnIds,
  hiddenCount,
  onCompact,
  onSetVisible,
  onShowAll,
  visibleColumnIds,
}: {
  columns: CaseMatrixColumn[];
  defaultVisibleColumnIds: string[];
  hiddenCount: number;
  onCompact: () => void;
  onSetVisible: (columnId: string, visible: boolean) => void;
  onShowAll: () => void;
  visibleColumnIds: string[];
}) {
  const visibleColumnIdSet = new Set(visibleColumnIds);
  const defaultColumnIdSet = new Set(defaultVisibleColumnIds);
  const defaultIsActive =
    visibleColumnIds.length === defaultVisibleColumnIds.length &&
    visibleColumnIds.every((columnId) => defaultColumnIdSet.has(columnId));
  const allVisible = hiddenCount === 0;
  const columnCount = columns.length;
  if (columnCount === 0) {
    return null;
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium text-foreground">Configurations</span>
        <span className="text-muted-foreground">
          {visibleColumnIds.length} shown / {columnCount} total
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Manage configurations"
            size="sm"
            type="button"
            variant="outline"
          >
            Configurations
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Visible configurations</DropdownMenuLabel>
            {columns.map((column) => {
              const columnId = caseMatrixColumnId(column);
              return (
                <DropdownMenuCheckboxItem
                  checked={visibleColumnIdSet.has(columnId)}
                  className="grid min-w-0 cursor-pointer gap-0.5"
                  key={columnId}
                  onCheckedChange={(checked) => onSetVisible(columnId, checked === true)}
                  onSelect={(event) => event.preventDefault()}
                >
                  <span className="min-w-0 truncate font-medium">{caseMatrixColumnLabel(column)}</span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">{caseMatrixColumnDetail(column)}</span>
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              className="cursor-pointer"
              disabled={allVisible}
              onSelect={onShowAll}
            >
              Show all
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              disabled={defaultIsActive}
              onSelect={onCompact}
            >
              Compact view
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function CaseMatrixColumnHeader({
  column,
  onRemove,
}: {
  column: CaseMatrixColumn;
  onRemove: () => void;
}) {
  return (
    <div className="relative grid min-w-0 gap-1.5 py-2 pr-7">
      <Button
        aria-label={`Remove ${caseMatrixColumnAccessibleName(column)}`}
        className="absolute right-0 top-1/2 -translate-y-1/2"
        size="icon-xs"
        title="Remove configuration"
        type="button"
        variant="ghost"
        onClick={onRemove}
      >
        <XIcon aria-hidden="true" />
      </Button>
      <div className="flex min-w-0 items-center gap-2">
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
  evalCase,
  column,
  onInspect,
  snapshot,
}: {
  allowMutations: boolean;
  evalCase: WorkbenchEvalCaseSnapshot;
  column: CaseMatrixColumn;
  onInspect: () => void;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const caseId = evalCase.id;
  const caseResults = column.evidence?.cases.filter((caseResult) => caseResult.caseId === caseId) ?? [];
  const summary = caseMatrixCellSummary(caseResults, caseMatrixCaseRequiresGrade(evalCase));
  if (!summary) {
    const hasRelatedEvidence = caseMatrixRelatedResults(snapshot, caseId, column).length > 0;
    const content = (
      <div className="pointer-events-none h-full min-h-40 px-3 py-4">
        {hasRelatedEvidence ? (
          <StatusBadge status="needs run" />
        ) : (
          <span className="text-sm text-muted-foreground">Not run</span>
        )}
      </div>
    );
    return allowMutations ? (
      <Button
        aria-label={caseMatrixColumnInspectLabel(column, caseId)}
        className="h-full min-h-40 w-full justify-start rounded-none p-0 text-left"
        type="button"
        variant="ghost"
        onClick={onInspect}
      >
        {content}
      </Button>
    ) : (
      <div className="grid h-full min-h-40 w-full text-left">
        {content}
      </div>
    );
  }
  const latencyMetric = formatReportMetricStack(summary.report, "latency", formatDurationMs);
  const costMetric = formatReportMetricStack(summary.report, "cost", formatCost, formatReportCost(summary.report, summary.status));
  return (
    <Button
      aria-label={caseMatrixColumnInspectLabel(column, caseId)}
      className="h-full min-h-40 w-full justify-start rounded-none p-0 text-left"
      type="button"
      variant="ghost"
      onClick={onInspect}
    >
      <div className="pointer-events-none h-full min-h-40 px-3 py-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <StatusBadge status={summary.status} />
          <span className="shrink-0 text-xs font-medium text-foreground">{formatQualityMetric(summary.score)}</span>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">{formatCoverage(summary.coverage)}</div>
        <div className="mt-4 grid min-w-0 grid-cols-2 gap-3 border-t border-border/60 pt-3">
          <CaseMatrixMetric label="Latency" value={latencyMetric.value} detail={latencyMetric.detail} />
          <CaseMatrixMetric label="Cost" value={costMetric.value} detail={costMetric.detail} />
        </div>
      </div>
    </Button>
  );
}

function CaseMatrixMetric({
  detail,
  label,
  value,
}: {
  detail?: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1">
      <div className="text-[11px] leading-none text-muted-foreground">{label}</div>
      <div className="text-xs">
        <MetricStack value={value} detail={detail} />
      </div>
    </div>
  );
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

function caseMatrixColumnAccessibleName(column: CaseMatrixColumn): string {
  const detail = caseMatrixColumnDetail(column);
  return detail ? `${caseMatrixColumnLabel(column)} / ${detail}` : caseMatrixColumnLabel(column);
}

function caseMatrixColumnInspectLabel(column: CaseMatrixColumn, caseId: string): string {
  const detail = caseMatrixColumnDetail(column);
  return `Inspect ${caseMatrixColumnLabel(column)} for ${caseId}${detail ? ` / ${detail}` : ""}`;
}

function buildCaseMatrixColumns(
  snapshot: WorkbenchInspectionSnapshot,
  evalVersionId: string,
): CaseMatrixColumn[] {
  const evalVersion = snapshot.evalVersions.find((entry) => entry.id === evalVersionId || entry.hash === evalVersionId);
  const scopedEvalVersionId = evalVersion?.id ?? evalVersionId;
  const evalHash = evalVersion?.hash ?? evalVersionHashForRef(snapshot, evalVersionId);
  const runsById = new Map(snapshot.runs.map((run) => [run.id, run]));
  const results = snapshot.results;
  if (!results) {
    return buildFallbackCaseMatrixColumns(snapshot, scopedEvalVersionId, evalHash);
  }
  const versionsById = new Map(results.skillVersions.map((version) => [version.id, version]));
  const agentsById = new Map(results.agentVersions.map((agent) => [agent.id, agent]));
  const currentAgentHashByName = new Map(snapshot.agents.map((entry) => [entry.agent.name, entry.hash]));
  const columnsByTargetKey = new Map<string, CaseMatrixColumnCandidate>();
  if (snapshot.status.currentVersionId === "current" && !caseMatrixHasEvidencedLiveVersion(snapshot, results, scopedEvalVersionId)) {
    for (const column of buildFallbackCaseMatrixColumns(snapshot, scopedEvalVersionId, evalHash)) {
      caseMatrixSetColumnCandidate(columnsByTargetKey, caseMatrixTargetKey(column.target), { column });
    }
  }
  for (const cell of results.cells) {
    if (cell.evalVersionId !== scopedEvalVersionId) {
      continue;
    }
    const version = versionsById.get(cell.skillVersionId);
    const agent = agentsById.get(cell.agentVersionId);
    if (!version || !agent) {
      continue;
    }
    const target = caseMatrixOperationTargetForResultVersion(snapshot, version, agent);
    const targetKey = caseMatrixTargetKey(target);
    const run = cell.runId ? runsById.get(cell.runId) ?? null : null;
    const evidence = caseMatrixEvidenceForResultCell(snapshot, cell, run);
    caseMatrixSetColumnCandidate(columnsByTargetKey, targetKey, {
      cell,
      column: {
        id: targetKey,
        evalVersionId: scopedEvalVersionId,
        ...(evalHash ? { evalHash } : {}),
        skillVersionId: version.id,
        versionLabel: version.label,
        agentDetail: agent.label,
        target,
        ...(run ? { run } : {}),
        ...(evidence ? { evidence } : {}),
      },
      currentAgent: currentAgentHashByName.get(agent.name) === agent.id,
      observedAt: run?.createdAt ?? "",
    });
  }
  const columns = [...columnsByTargetKey.values()].map((candidate) => candidate.column);
  return columns.length > 0 ? columns : buildFallbackCaseMatrixColumns(snapshot, scopedEvalVersionId, evalHash);
}

interface CaseMatrixColumnCandidate {
  column: CaseMatrixColumn;
  cell?: WorkbenchResultCell;
  currentAgent?: boolean;
  observedAt?: string;
}

function caseMatrixSetColumnCandidate(
  columns: Map<string, CaseMatrixColumnCandidate>,
  targetKey: string,
  candidate: CaseMatrixColumnCandidate,
): void {
  const existing = columns.get(targetKey);
  if (!existing || compareCaseMatrixColumnCandidates(candidate, existing) > 0) {
    columns.set(targetKey, candidate);
  }
}

function compareCaseMatrixColumnCandidates(
  left: CaseMatrixColumnCandidate,
  right: CaseMatrixColumnCandidate,
): number {
  const leftCurrent = left.currentAgent === true;
  const rightCurrent = right.currentAgent === true;
  if (leftCurrent !== rightCurrent) {
    return leftCurrent ? 1 : -1;
  }
  const leftActive = caseMatrixCellIsActive(left.cell);
  const rightActive = caseMatrixCellIsActive(right.cell);
  if (leftActive !== rightActive) {
    return leftActive ? 1 : -1;
  }
  const leftHasEvidence = caseMatrixCellHasEvidence(left.cell);
  const rightHasEvidence = caseMatrixCellHasEvidence(right.cell);
  if (leftHasEvidence !== rightHasEvidence) {
    return leftHasEvidence ? 1 : -1;
  }
  const leftTerminal = caseMatrixCellIsTerminal(left.cell);
  const rightTerminal = caseMatrixCellIsTerminal(right.cell);
  if (leftTerminal !== rightTerminal) {
    return leftTerminal ? 1 : -1;
  }
  const sampleDelta = (left.cell?.coverage?.planned ?? 0) - (right.cell?.coverage?.planned ?? 0);
  if (sampleDelta !== 0) {
    return sampleDelta;
  }
  return (left.observedAt ?? "").localeCompare(right.observedAt ?? "");
}

function caseMatrixCellHasEvidence(cell: WorkbenchResultCell | undefined): boolean {
  return Boolean(cell?.runId || cell?.status || (cell?.jobIds?.length ?? 0) > 0);
}

function caseMatrixCellIsActive(cell: WorkbenchResultCell | undefined): boolean {
  return cell?.status === "running" || cell?.status === "queued";
}

function caseMatrixCellIsTerminal(cell: WorkbenchResultCell | undefined): boolean {
  return cell?.status !== undefined && isWorkbenchRunStatusTerminal(cell.status);
}

function caseMatrixHasEvidencedLiveVersion(
  snapshot: WorkbenchInspectionSnapshot,
  results: NonNullable<WorkbenchInspectionSnapshot["results"]>,
  evalVersionId: string,
): boolean {
  const liveVersion = snapshot.versions.find((version) => version.id === "current");
  const liveHash = liveVersion?.hash;
  if (!liveHash) {
    return false;
  }
  const liveVersionIds = new Set(
    snapshot.versions
      .filter((version) => version.id !== "current" && version.hash === liveHash)
      .map((version) => version.id),
  );
  return results.cells.some((cell) =>
    cell.evalVersionId === evalVersionId &&
    liveVersionIds.has(cell.skillVersionId) &&
    Boolean(cell.runId || cell.status || (cell.jobIds?.length ?? 0) > 0)
  );
}

function caseMatrixEvidenceForResultCell(
  snapshot: WorkbenchInspectionSnapshot,
  cell: WorkbenchResultCell,
  run: WorkbenchRun | null,
): WorkbenchRunEvidenceView | null {
  const jobIds = [...(cell.jobIds ?? [])];
  if (jobIds.length === 0) {
    return run ? buildWorkbenchRunEvidenceView(snapshot, run) : null;
  }
  const jobIdSet = new Set(jobIds);
  const jobs = snapshot.jobs.filter((job) => jobIdSet.has(job.id));
  const firstJob = jobs[0];
  if (!firstJob) {
    return run ? buildWorkbenchRunEvidenceView(snapshot, run) : null;
  }
  const sourceRun = run ?? snapshot.runs
    .filter((entry) => entry.jobIds.some((jobId) => jobIdSet.has(jobId)))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0] ?? null;
  const traceIds = Array.from(new Set(jobs.flatMap((job) => job.traceIds)));
  const syntheticRun: WorkbenchRun = {
    id: cell.runId ?? sourceRun?.id ?? `cell_${firstJob.id}`,
    kind: sourceRun?.kind ?? firstJob.kind,
    versionId: sourceRun?.versionId ?? firstJob.versionId,
    skillName: firstJob.skillName,
    skillBundleHash: firstJob.skillBundleHash,
    evalHash: sourceRun?.evalHash ?? firstJob.evalHash,
    agentName: firstJob.agentName,
    agentHash: firstJob.agentHash,
    status: cell.status ?? sourceRun?.status ?? workbenchRunStatusFromJobs(jobs),
    jobIds,
    traceIds,
    createdAt: sourceRun?.createdAt ?? jobs.map((job) => job.createdAt).sort()[0] ?? firstJob.createdAt,
    ...(sourceRun?.finishedAt ? { finishedAt: sourceRun.finishedAt } : {}),
    ...(sourceRun?.location ? { location: sourceRun.location } : {}),
    ...(sourceRun?.remoteName ? { remoteName: sourceRun.remoteName } : {}),
    ...(sourceRun?.requestedSamples !== undefined ? { requestedSamples: sourceRun.requestedSamples } : {}),
    ...(sourceRun?.error ? { error: sourceRun.error } : {}),
  };
  return buildWorkbenchRunEvidenceView(snapshot, syntheticRun);
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

function buildFallbackCaseMatrixColumns(
  snapshot: WorkbenchInspectionSnapshot,
  evalVersionId = defaultEvalVersion(snapshot)?.id ?? "current",
  evalHash = evalVersionHashForRef(snapshot, evalVersionId),
): CaseMatrixColumn[] {
  const versionId = snapshot.status.currentVersionId ?? snapshot.versions.at(-1)?.id ?? null;
  const targetVersionId = versionId && versionId !== "current" ? versionId : null;
  const versionLabel = versionId
    ? formatVersionDisplayName(versionId, snapshot.versions)
    : "Current skill";
  return snapshot.agents.map((agent) => ({
    id: `source:${versionId ?? "current"}:${agent.hash}`,
    evalVersionId,
    ...(evalHash ? { evalHash } : {}),
    ...(targetVersionId ? { skillVersionId: targetVersionId } : {}),
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
  const runtime = agent.agent.model ? `${agent.agent.adapter} / ${agent.agent.model}` : agent.agent.adapter;
  return agent.agent.name === "default" ? runtime : `${agent.agent.name} / ${runtime}`;
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
  caseRequiresGrade: boolean,
): CaseMatrixCellSummary | null {
  if (caseResults.length === 0) {
    return null;
  }
  const needsGrade = caseRequiresGrade && caseResults.some((caseResult) => caseResult.run && !caseResult.grade);
  const scores = caseResults
    .map((caseResult) => caseResult.score)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  const score = scores.length === caseResults.length
    ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(3))
    : undefined;
  const aggregateStatus = aggregateCaseMatrixStatus(caseResults);
  return {
    status: needsGrade && aggregateStatus === "succeeded" ? "needs grade" : aggregateStatus,
    coverage: workbenchSampleCoverage(
      caseResults.filter(caseMatrixResultIsComplete).length,
      caseResults.length,
    ),
    report: mergeWorkbenchJobReports(caseResults.map((caseResult) => caseResult.report)),
    ...(caseResults.length === 1 ? { detailResult: caseResults[0]! } : {}),
    ...(score !== undefined ? { score } : {}),
  };
}

function caseMatrixCaseRequiresGrade(evalCase: WorkbenchEvalCaseSnapshot): boolean {
  return evalCase.grade.adapter !== "none";
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
        <Badge variant="outline">{gradePlanSourceLabel(evalCase.grade)}</Badge>
        <span className="min-w-0 break-words text-sm text-foreground [overflow-wrap:anywhere]">{evalCase.grade.summary}</span>
      </div>
    </div>
  );
}

function gradePlanSourceLabel(grade: WorkbenchEvalCaseSnapshot["grade"]): string {
  return grade.adapterSource === "case" ? `${grade.label} override` : `Default: ${grade.label}`;
}

function CaseGradePlan({ evalCase }: { evalCase: WorkbenchEvalCaseSnapshot }) {
  return (
    <section className="grid min-w-0 gap-3 rounded-lg border border-border/70 bg-background p-4" aria-label="Grading">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">Grading</h2>
          <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {gradePlanSourceLabel(evalCase.grade)}: {evalCase.grade.summary}
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
  return evalCase.id;
}

function caseResultFinalOutput(
  snapshot: WorkbenchInspectionSnapshot,
  caseResult: WorkbenchRunEvidenceCaseResult,
): string {
  const jobId = caseResult.run?.jobId ?? caseResult.selectedJobId;
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
        ownerId={workbenchCaseFileOwnerId(evalSnapshot.hash, evalCase.id)}
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
  lockedEvalVersionId,
  onRouteClick,
  snapshot,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  lockedEvalVersionId?: string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const evalHash = lockedEvalVersionId ? evalVersionHashForRef(snapshot, lockedEvalVersionId) ?? lockedEvalVersionId : null;
  const scopedRuns = evalHash ? snapshot.runs.filter((run) => run.evalHash === evalHash) : snapshot.runs;
  const activeRuns = scopedRuns.filter((run) => isRunActive(run, snapshot.jobs));
  const inactiveRuns = scopedRuns.filter((run) => !activeRuns.some((active) => active.id === run.id));
  const runs = [
    ...activeRuns.sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    ...inactiveRuns.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  ];
  if (runs.length === 0) {
    return <EmptyState icon={PlayCircleIcon} title="No runs" message="Runs appear here after Workbench evaluates or improves a skill." variant="hero" size="sm" />;
  }
  return (
    <section className="min-w-0" aria-label="Runs">
      <RunTable
        hrefFor={hrefFor}
        onRouteClick={onRouteClick}
        runs={runs}
        snapshot={snapshot}
        renderMeasurement={(run, runJobs) => {
          const summary = runEvidenceSummary(snapshot, run, runEvidenceView(snapshot, run), runJobs);
          return (
            <>
              <div className="break-words font-medium [overflow-wrap:anywhere]">{summary.subject}</div>
              <div className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{summary.context}</div>
              <div className="mt-1 text-xs text-muted-foreground">{summary.detail}</div>
            </>
          );
        }}
      />
    </section>
  );
}

function RunTable({
  hrefFor,
  onRouteClick,
  renderMeasurement,
  runs,
  snapshot,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  renderMeasurement: (run: WorkbenchRun, jobs: WorkbenchJob[]) => ReactNode;
  runs: WorkbenchRun[];
  snapshot: WorkbenchInspectionSnapshot;
}) {
  return (
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
            return (
              <TableRow key={run.id} className="cursor-pointer" onClick={onRouteClick(runRoute)}>
                <TableCell className="align-top">
                  <a className="font-medium text-primary underline-offset-4 hover:underline" href={hrefFor(runRoute)} onClick={onRouteClick(runRoute)}>
                    {runOperationLabel(run)}
                  </a>
                  <div className="mt-1"><StatusBadge status={run.status} /></div>
                </TableCell>
                <TableCell className="align-top">{renderMeasurement(run, runJobs)}</TableCell>
                <QualityLatencyCostCells
                  cost={costMetric}
                  latency={latencyMetric}
                  quality={formatQualityMetric(runScore(run, snapshot.jobs))}
                />
                <TableCell className="align-top text-muted-foreground">{formatTimestamp(run.finishedAt ?? run.createdAt)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function RunDetailPage({
  apiBasePath,
  hrefFor,
  inspectionCursor,
  lockedEvalVersionId,
  onRouteClick,
  progressCursor,
  route,
  snapshot,
}: {
  apiBasePath: string;
  hrefFor: (route: WorkbenchRoute) => string;
  inspectionCursor: string | null;
  lockedEvalVersionId?: string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLElement>) => void;
  progressCursor: string | null;
  route: Extract<WorkbenchRoute, { kind: "run" | "run-job" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const lockedEvalHash = lockedEvalVersionId ? evalVersionHashForRef(snapshot, lockedEvalVersionId) ?? lockedEvalVersionId : null;
  const run = snapshot.runs.find((entry) => entry.id === route.runId && (!lockedEvalHash || entry.evalHash === lockedEvalHash)) ?? null;
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
                  <QualityLatencyCostCells
                    between={<TableCell className="align-top text-muted-foreground">{formatCoverage(measurement.coverage)}</TableCell>}
                    cost={costMetric}
                    latency={latencyMetric}
                    quality={formatQualityMetric(measurement.score)}
                  />
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
                    {caseResult.sample > 0 ? (
                      <div className="text-xs text-muted-foreground">Sample {formatSampleNumber(caseResult.sample)}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="font-medium">{formatSkillLabel(caseResult)}</div>
                    <div className="text-xs text-muted-foreground">{formatEvidenceAgentModel(caseResult)}</div>
                    <div className="mt-1"><StatusBadge status={caseResult.status} /></div>
                  </TableCell>
                  <QualityLatencyCostCells
                    cost={costMetric}
                    latency={latencyMetric}
                    quality={formatQualityMetric(caseResult.score)}
                  />
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
  return phase === "grade" ? "Grade" : "Run";
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
  return `${formatJobRoleLabel(job.role)} · ${formatSkillLabel(job)} · ${job.agentLabel}`;
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
    caseResult.run?.jobId,
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
  if (caseResult.run?.jobId === jobId) {
    return "run";
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
  return caseResult.run ? "run" : "grade";
}

function phaseForCaseResult(
  caseResult: WorkbenchRunEvidenceCaseResult,
  phase: WorkbenchRunCasePhase,
): WorkbenchRunEvidenceJobPhase | null {
  if (phase === "grade") {
    return caseResult.grade ?? caseResult.run ?? null;
  }
  return caseResult.run ?? caseResult.grade ?? null;
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
  const selectedPhase = phaseForCaseResult(caseResult, phase) ?? workbenchRunEvidenceJobPhase(job, snapshot.jobs);
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
          <FactItem title="Step" value={phaseLabel} />
          <FactItem title="Step status" value={<StatusBadge status={selectedPhase.status} />} />
          <FactItem title="Step score" value={formatScore(selectedPhase.score)} />
          <FactItem title="Step duration" value={formatDurationMs(selectedPhase.durationMs)} />
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
            description={phase === "grade" ? "Judgment timeline for this case sample." : "Skill run timeline for this case sample."}
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
  const roleLabel = formatJobRoleLabel(job.role);
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
  const steps = [
    caseResult.run ? { value: "run" as const, label: "Run" } : null,
    caseResult.grade ? { value: "grade" as const, label: "Grade" } : null,
  ].filter((entry): entry is { value: WorkbenchRunCasePhase; label: string } => entry !== null);
  if (steps.length <= 1) {
    return null;
  }
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-4 border-b border-border/70 text-sm" aria-label="Case result steps">
      {steps.map((item) => {
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
        <RunTable
          hrefFor={hrefFor}
          onRouteClick={onRouteClick}
          runs={runs}
          snapshot={snapshot}
          renderMeasurement={(run, runJobs) => (
            <>
              <div className="break-words font-medium [overflow-wrap:anywhere]">{runVersionDisplayName(snapshot, run)}</div>
              <div className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{runAgentDisplayName(snapshot, run)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{formatCoverage(workbenchSampleCoverageForJobs(runJobs))}</div>
            </>
          )}
        />
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
        <p className="break-words text-muted-foreground [overflow-wrap:anywhere]">{identity.description ?? "Workbench skill package."}</p>
      </div>
      <FactGrid>
        <FactItem title="Current" value={snapshot.status.currentVersionId ? versionNameFor(snapshot, snapshot.status.currentVersionId) : "none"} />
        <FactItem title="Published" value={publishedVersionId(snapshot) ? versionNameFor(snapshot, publishedVersionId(snapshot)) : "none"} />
        <FactItem title="Cases" value={formatCount(casesCount, "case")} />
        <FactItem title="Runs" value={formatCount(snapshot.status.runCount, "run")} />
        {hostContext?.ownerSlug ? <FactItem title="Owner" value={hostContext.ownerSlug} /> : null}
        {hostContext?.visibility ? <FactItem title="Visibility" value={hostContext.visibility} /> : null}
        {hostContext?.evidenceAccess ? <FactItem title="Access" value={hostContext.evidenceAccess === "full" ? "full evidence" : "package only"} /> : null}
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
  const transcript = useMemo(
    () => buildExecutionTraceTranscript({ trace: execution?.trace }),
    [execution?.trace],
  );
  useRouteLoadingSignal(evidence.loading && !execution);

  const isActiveJob = jobStatus === "queued" || jobStatus === "running";
  const panelTitle = title ?? "Timeline";
  const panelDescription = description ?? "Execution timeline and recorded trace events for this case run.";
  let content: ReactNode;
  if (!execution && isActiveJob) {
    content = (
      <Marker role="status">
        <MarkerIcon>
          <ActivityIcon />
        </MarkerIcon>
        <MarkerContent>
          Waiting for trace events. Run and job status update live; this panel refreshes while the job is active.
        </MarkerContent>
      </Marker>
    );
  } else if (evidence.loading && !execution) {
    content = (
      <Marker role="status">
        <MarkerIcon>
          <ActivityIcon />
        </MarkerIcon>
        <MarkerContent className="shimmer">Loading job evidence...</MarkerContent>
      </Marker>
    );
  } else if (evidence.error) {
    content = <ProblemState icon={CircleAlertIcon} title="Couldn't load job evidence" message={evidence.error} align="start" />;
  } else if (!execution) {
    content = <EmptyState icon={ActivityIcon} title="No execution evidence" message="No evidence is recorded for this job." size="sm" />;
  } else if (transcript.groups.length === 0) {
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
        <TranscriptFeed transcript={transcript} />
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
      const job = run && snapshot
        ? snapshot.jobs.find((entry) => entry.id === route.jobId && workbenchRunOwnsJob(run, entry)) ?? null
        : null;
      items.push({ label: job ? formatJobRoleLabel(job.role) : shortId(route.jobId) });
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
  onRefresh?: () => void;
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
      {onRefresh ? <Button
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
      </Button> : null}
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
          throw new Error(await workbenchResponseErrorMessage(response));
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

function selectedEvalSnapshot(snapshot: WorkbenchInspectionSnapshot, evalVersionId: string | null): WorkbenchEvalSnapshot | null {
  const hash = evalVersionId
    ? evalVersionHashForRef(snapshot, evalVersionId) ?? evalSnapshotHashForRef(snapshot, evalVersionId)
    : defaultEvalVersion(snapshot)?.hash ?? snapshot.evals[0]?.hash;
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

function evalSnapshotHashForRef(snapshot: WorkbenchInspectionSnapshot, ref: string): string | undefined {
  const normalized = ref.trim();
  if (!normalized) {
    return undefined;
  }
  return snapshot.evals.find((entry) =>
    entry.hash === normalized ||
    entry.hash.startsWith(normalized)
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
  return snapshot.runs
    .filter((run) => run.jobIds.some((jobId) => jobIds.has(jobId)))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
}

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
        : "Eval";
  return run.retryOfRunId ? `Retry ${base.toLowerCase()}` : base;
}

function runVersionDisplayName(snapshot: WorkbenchInspectionSnapshot, run: WorkbenchRun): string {
  const resultVersions = runResultItems(
    snapshot.results?.skillVersions,
    snapshot.results?.cells,
    run.id,
    (cell) => cell.skillVersionId,
  );
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
  return formatVersionDisplayName(run.outputVersionId ?? run.versionId, snapshot.versions);
}

function runAgentDisplayName(snapshot: WorkbenchInspectionSnapshot, run: WorkbenchRun): string {
  const resultAgents = runResultItems(
    snapshot.results?.agentVersions,
    snapshot.results?.cells,
    run.id,
    (cell) => cell.agentVersionId,
  );
  if (resultAgents.length === 1) {
    return resultAgents[0]!.label;
  }
  if (resultAgents.length > 1) {
    return formatCount(resultAgents.length, "agent");
  }
  return snapshot.results?.agentVersions.find((agent) => agent.id === run.agentHash)?.label ?? run.agentName;
}

function runResultItems<Item extends { id: string }>(
  items: readonly Item[] | undefined,
  cells: readonly WorkbenchResultCell[] | undefined,
  runId: string,
  itemId: (cell: WorkbenchResultCell) => string,
): Item[] {
  const itemById = new Map(items?.map((item) => [item.id, item]));
  const selected = new Map<string, Item>();
  for (const cell of cells ?? []) {
    if (cell.runId !== runId) {
      continue;
    }
    const item = itemById.get(itemId(cell));
    if (item) {
      selected.set(item.id, item);
    }
  }
  return [...selected.values()];
}

function resultVersionForProjectVersionId(
  snapshot: WorkbenchInspectionSnapshot,
  projectVersionId: string,
): WorkbenchSkillVersion | null {
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
  return versionId ? formatVersionDisplayName(versionId, snapshot.versions) : "none";
}

function WorkbenchLoadingIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return <WorkbenchLogoMark {...props} className={cn("workbench-loading-mark", className)} />;
}
