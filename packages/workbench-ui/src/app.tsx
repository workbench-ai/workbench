"use client";

import { Fragment, startTransition, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ChartColumnIcon,
  FileCode2Icon,
  FolderOpenIcon,
  GitBranchIcon,
  InfoIcon,
  ListChecksIcon,
  PanelRightCloseIcon,
  RefreshCwIcon,
  Settings2Icon,
} from "lucide-react";
import { CodeBlockSurface } from "@workbench-ai/cli-web-ui/components/shared/code-block-surface";
import {
  DesktopWorkspaceSplit,
} from "@workbench-ai/cli-web-ui/components/shared/desktop-workspace-split";
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
import { ProblemState } from "@workbench-ai/cli-web-ui/components/shared/problem-state";
import {
  FilesBrowser,
} from "@workbench-ai/cli-web-ui/components/shared/files-browser";
import { InspectorDialogShell } from "@workbench-ai/cli-web-ui/components/shared/inspector-dialog-shell";
import { RouteToolbar } from "@workbench-ai/cli-web-ui/components/shared/route-toolbar";
import { TextBlockView } from "@workbench-ai/cli-web-ui/components/shared/text-block-view";
import { ExecutionTraceTimeline } from "@workbench-ai/cli-web-ui/components/shared/execution-trace-timeline";
import { ViewSwitch } from "@workbench-ai/cli-web-ui/components/shared/view-switch";
import { WorkbenchBrand } from "@workbench-ai/cli-web-ui/components/shared/workbench-brand";
import { WorkspaceTopBar } from "@workbench-ai/cli-web-ui/components/shared/workspace-top-bar";
import { WorkspacePane } from "@workbench-ai/cli-web-ui/components/shared/workspace-pane";
import { WorkspaceRoot } from "@workbench-ai/cli-web-ui/components/shared/workspace-root";
import { Badge } from "@workbench-ai/cli-web-ui/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workbench-ai/cli-web-ui/components/ui/accordion";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workbench-ai/cli-web-ui/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workbench-ai/cli-web-ui/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workbench-ai/cli-web-ui/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@workbench-ai/cli-web-ui/components/ui/tabs";
import {
  buildExecutionTraceTimeline,
  type ExecutionTrace,
} from "@workbench-ai/cli-web-ui/lib/execution-trace-timeline";
import { supportedPreviewModes } from "@workbench-ai/cli-web-ui/lib/file-preview";
import { useMediaQuery } from "@workbench-ai/cli-web-ui/lib/use-media-query";
import { cn } from "@workbench-ai/cli-web-ui/lib/utils";
import { badgeToneProps } from "@workbench-ai/cli-web-ui/lib/badge";

import { CandidateList } from "./components/candidate-list";
import {
  CandidateRuntimeBadge,
  shouldShowCandidateRuntimeBadge,
} from "./components/candidate-runtime-badge";
import { EvaluationsDetail } from "./components/evaluations-detail";
import {
  CandidateArchiveSkeleton,
  CandidateOverviewSkeleton,
  CandidateFilesSurfaceSkeleton,
  EvaluationCaseRowsSkeleton,
  EvaluationDetailSurfaceSkeleton,
  EvaluationCaseDetailSkeleton,
  ExecutionTraceSkeleton,
  EvaluationsDetailSkeleton,
  LineageSurfaceSkeleton,
  BenchmarkSurfaceSkeleton,
  SourceYamlSkeleton,
  CandidateManifestSkeleton,
} from "./components/loading-states";
import { LineageGraph } from "./components/lineage-graph";
import { StatusBadge } from "./components/status-badge";
import { CandidateComparisonFilter, type CandidateFilterOption } from "./components/candidate-comparison-filter";
import { SurfaceSection } from "./components/surface-section";
import { requestJson, toMessage } from "./lib/api";
import {
  buildCandidateEvaluationRollup,
  formatEvaluationConfigurationLabel,
  readEvaluationScore,
  resolveCandidateEvaluationRollupDisplay,
} from "./lib/candidate-evaluation-display";
import { pickDefaultCandidateFile } from "./lib/candidate-file-preference";
import { orderCandidateFiles } from "./lib/candidate-files";
import {
  filterCandidateSummariesByBenchmark,
  normalizeBenchmarkFingerprint,
} from "./lib/candidate-scope";
import {
  formatDurationMs,
  formatMetricValue,
  formatCandidateDisplayName,
  formatCandidateName,
  formatCandidateVersionLabel,
  formatTimestamp,
  shortId,
  statusLabel,
} from "./lib/format";
import {
  buildWorkbenchLocationHref,
  createEvaluationsRoute,
  createCandidateRoute,
  createCandidatesRoute,
  createBenchmarkRoute,
  parseWorkbenchLocation,
  parseWorkbenchRoute,
  type CandidateDialog,
  type CandidateView,
  type WorkbenchPersistentSearchParams,
  type WorkbenchRoute,
} from "./lib/routes";
import {
  activeRunSummaryLabel,
  buildWorkbenchRuntimeState,
  type CandidateRuntimeState,
  type EvaluationRuntimeRow,
  type WorkbenchRuntimeState,
} from "./lib/runtime-state";
import type {
  CandidateCaseReview,
  CandidatePreviewMode,
  CandidateRecord,
  CandidateSummary,
  EvaluationScorecard,
  EvaluationSummary,
  CandidateWorkspaceFilePreview,
  CandidateWorkspaceFileSummary,
  AuthoredWorkbenchSourceDocument,
  RemoteWorkbenchJob,
  RunSummary,
  BenchmarkSnapshot,
  WorkbenchExecutionEvidence,
  WorkbenchExecutionTraceDetail,
} from "./types";

const DESKTOP_DETAIL_PANE_STORAGE_KEY = "workbench-dual-pane-layout";
const COMPACT_WORKSPACE_LAYOUT_MEDIA_QUERY = "(max-width: 1535px)";
const DESKTOP_DETAIL_LEFT_DEFAULT_PERCENT = 35;
const DESKTOP_DETAIL_LEFT_MIN_PERCENT = 28;
const DESKTOP_DETAIL_LEFT_MAX_PERCENT = 42;
const EMPTY_PERSISTENT_SEARCH_PARAMS: WorkbenchPersistentSearchParams = {};

type TraceSessionView = WorkbenchExecutionEvidence["sessions"][number];

interface CandidateRecordState {
  loading: boolean;
  error: string | null;
  record: CandidateRecord | null;
}

interface EvaluationRecordsState {
  loading: boolean;
  error: string | null;
  records: EvaluationScorecard[];
}

interface CaseReviewDetailState {
  loading: boolean;
  error: string | null;
  review: CandidateCaseReview | null;
  requestKey: string | null;
}

interface CandidateFilesState {
  loading: boolean;
  error: string | null;
  files: CandidateWorkspaceFileSummary[];
}

interface SourceYamlFile {
  path: string;
  content: string;
}

type CandidateCaseExecution = CandidateCaseReview["executions"][number];
type TimedExecutionRecord = {
  status: RemoteWorkbenchJob["status"];
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number | null;
};

interface EvaluationCaseRow {
  id: string;
  label: string;
  status: string;
  completedSampleCount: number;
  sampleCount: number;
  metricValue: number | null;
  durationMs: number | null;
  split: string | null;
}

interface CandidatePreviewState {
  loading: boolean;
  error: string | null;
  preview: CandidateWorkspaceFilePreview | null;
}

type BenchmarkSurfaceTab = "processed" | "manifest" | "files";

interface BenchmarkFingerprintOption {
  fingerprint: string;
  candidateCount: number;
  evaluationCount: number;
  runCount: number;
  current: boolean;
}

interface TraceDetailState {
  loading: boolean;
  error: string | null;
  detail: WorkbenchExecutionTraceDetail | null;
}

interface ExecutionFilesState {
  loading: boolean;
  error: string | null;
  files: CandidateWorkspaceFileSummary[];
}

interface ExecutionPreviewState {
  loading: boolean;
  error: string | null;
  preview: CandidateWorkspaceFilePreview | null;
}

function clampDesktopDetailLeftPercent(value: number): number {
  return Math.min(
    DESKTOP_DETAIL_LEFT_MAX_PERCENT,
    Math.max(DESKTOP_DETAIL_LEFT_MIN_PERCENT, value),
  );
}

function readDesktopDetailLeftPercent(): number {
  if (typeof window === "undefined") {
    return DESKTOP_DETAIL_LEFT_DEFAULT_PERCENT;
  }
  const stored = Number.parseFloat(window.localStorage.getItem(DESKTOP_DETAIL_PANE_STORAGE_KEY) ?? "");
  if (!Number.isFinite(stored)) {
    return DESKTOP_DETAIL_LEFT_DEFAULT_PERCENT;
  }
  return clampDesktopDetailLeftPercent(stored);
}

export interface WorkbenchWorkspaceProps {
  apiBasePath: string;
  routeBasePath?: string;
  initialPath?: string;
  initialSearch?: string;
  persistentSearchParams?: WorkbenchPersistentSearchParams;
  headerControls?: ReactNode;
  brandHref?: string;
}

export function WorkbenchWorkspace({
  apiBasePath,
  routeBasePath = "/workbench",
  initialPath = "/",
  initialSearch = "",
  persistentSearchParams = EMPTY_PERSISTENT_SEARCH_PARAMS,
  headerControls,
  brandHref,
}: WorkbenchWorkspaceProps) {
  const apiPath = useMemo(() => createApiPathResolver(apiBasePath), [apiBasePath]);
  const [route, navigate] = useWorkbenchRoute(
    routeBasePath,
    persistentSearchParams,
    initialPath,
    initialSearch,
  );
  const [snapshot, setSnapshot] = useState<BenchmarkSnapshot | null>(null);
  const [specDocument, setSpecDocument] = useState<AuthoredWorkbenchSourceDocument | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotRefreshing, setSnapshotRefreshing] = useState(false);
  const [specLoading, setSpecLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [snapshotRefreshKey, setSnapshotRefreshKey] = useState(0);
  const [recordState, setRecordState] = useState<CandidateRecordState>({
    loading: false,
    error: null,
    record: null,
  });
  const [evaluationRecordsState, setEvaluationRecordsState] = useState<EvaluationRecordsState>({
    loading: false,
    error: null,
    records: [],
  });
  const [benchmarkSurfaceTab, setBenchmarkSurfaceTab] = useState<BenchmarkSurfaceTab>("processed");
  const [selectedBenchmarkFingerprint, setSelectedBenchmarkFingerprint] = useState<string | null>(null);
  const [candidateFilesState, setCandidateFilesState] = useState<CandidateFilesState>({
    loading: false,
    error: null,
    files: [],
  });
  const [candidatePreviewState, setCandidatePreviewState] = useState<CandidatePreviewState>({
    loading: false,
    error: null,
    preview: null,
  });
  const [benchmarkFilesState, setBenchmarkFilesState] = useState<CandidateFilesState>({
    loading: false,
    error: null,
    files: [],
  });
  const [selectedBenchmarkFilePath, setSelectedBenchmarkFilePath] = useState<string | null>(null);
  const [benchmarkPreviewMode, setBenchmarkPreviewMode] = useState<CandidatePreviewMode>("rendered");
  const [benchmarkDirectoryPath, setBenchmarkDirectoryPath] = useState<string | null>(null);
  const [benchmarkPreviewState, setBenchmarkPreviewState] = useState<CandidatePreviewState>({
    loading: false,
    error: null,
    preview: null,
  });
  const [desktopDetailLeftPercent, setDesktopDetailLeftPercent] = useState(readDesktopDetailLeftPercent);
  const benchmarkSurfaceFillsBody = benchmarkSurfaceTab === "files";
  const shouldLoadBenchmarkSourceFiles = benchmarkSurfaceTab === "files";
  const refreshSnapshot = useCallback(() => {
    setSnapshotRefreshKey((current) => current + 1);
  }, []);
  const routeRefreshHref = useMemo(
    () => buildWorkbenchLocationHref(route, routeBasePath, persistentSearchParams),
    [persistentSearchParams, route, routeBasePath],
  );
  const didMountRouteRefresh = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setSnapshotLoading(snapshot === null);
    setSnapshotRefreshing(snapshot !== null);
    setSnapshotError(null);

    async function loadSnapshot() {
      try {
        const next = await requestJson<BenchmarkSnapshot>(apiPath("/api/snapshot"), {
          signal: controller.signal,
        });
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setSnapshot(next);
          setSnapshotError(null);
          setSnapshotLoading(false);
          setSnapshotRefreshing(false);
        });
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setSnapshotError(toMessage(error));
          setSnapshotLoading(false);
          setSnapshotRefreshing(false);
        }
      }
    }

    void loadSnapshot();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiPath, snapshotRefreshKey]);

  useEffect(() => {
    if (!didMountRouteRefresh.current) {
      didMountRouteRefresh.current = true;
      return;
    }
    refreshSnapshot();
  }, [refreshSnapshot, routeRefreshHref]);

  const runtimeState = useMemo(
    () => buildWorkbenchRuntimeState(snapshot),
    [snapshot],
  );

  const orderedCandidateSummaries = useMemo(
    () => snapshot ? orderCandidateSummaries(snapshot.summaries) : [],
    [snapshot],
  );
  const currentBenchmarkFingerprint = normalizeBenchmarkFingerprint(snapshot?.currentBenchmarkFingerprint);
  const benchmarkFingerprintOptions = useMemo(
    () => buildBenchmarkFingerprintOptions({
      currentBenchmarkFingerprint,
      summaries: orderedCandidateSummaries,
      evaluations: snapshot?.evaluations ?? [],
      runs: snapshot?.runs ?? [],
    }),
    [currentBenchmarkFingerprint, orderedCandidateSummaries, snapshot?.evaluations, snapshot?.runs],
  );
  const activeBenchmarkFingerprint = useMemo(
    () =>
      normalizeBenchmarkFingerprint(
        snapshot?.activeId
          ? orderedCandidateSummaries.find((summary) => summary.id === snapshot.activeId)?.benchmarkFingerprint
          : null,
      ),
    [orderedCandidateSummaries, snapshot?.activeId],
  );
  const routeBenchmarkFingerprint = useMemo(
    () =>
      normalizeBenchmarkFingerprint(
        route.kind === "candidate" && route.candidateId
          ? orderedCandidateSummaries.find((summary) => summary.id === route.candidateId)?.benchmarkFingerprint
          : null,
      ),
    [orderedCandidateSummaries, route],
  );
  const preferredBenchmarkFingerprint =
    routeBenchmarkFingerprint ?? activeBenchmarkFingerprint ?? currentBenchmarkFingerprint;
  const scopedBenchmarkFingerprint =
    routeBenchmarkFingerprint ??
    (selectedBenchmarkFingerprint &&
      benchmarkFingerprintOptions.some((option) => option.fingerprint === selectedBenchmarkFingerprint)
      ? selectedBenchmarkFingerprint
      : preferredBenchmarkFingerprint ?? benchmarkFingerprintOptions[0]?.fingerprint ?? null);
  const currentBenchmarkSummaries = useMemo(
    () => filterCandidateSummariesByBenchmark({
      summaries: orderedCandidateSummaries,
      benchmarkFingerprint: scopedBenchmarkFingerprint,
    }),
    [orderedCandidateSummaries, scopedBenchmarkFingerprint],
  );
  const currentBenchmarkEvaluations = useMemo(
    () => snapshot
      ? orderEvaluationSummaries(snapshot.evaluations).filter(
          (evaluation) => normalizeBenchmarkFingerprint(evaluation.benchmarkFingerprint) === scopedBenchmarkFingerprint,
        )
      : [],
    [scopedBenchmarkFingerprint, snapshot],
  );
  const currentBenchmarkEvaluationRows = useMemo(
    () => runtimeState.evaluationRows.filter(
      (row) => normalizeBenchmarkFingerprint(row.benchmarkFingerprint) === scopedBenchmarkFingerprint,
    ),
    [runtimeState.evaluationRows, scopedBenchmarkFingerprint],
  );
  const currentBenchmarkRuns = useMemo(
    () => snapshot
      ? orderRunSummaries(snapshot.runs).filter(
          (run) => normalizeBenchmarkFingerprint(run.benchmarkFingerprint) === scopedBenchmarkFingerprint,
        )
      : [],
    [scopedBenchmarkFingerprint, snapshot],
  );
  const currentBenchmarkCandidateLabelById = useMemo(
    () => new Map(currentBenchmarkSummaries.map((summary) => [
      summary.id,
      formatCandidateDisplayName(summary),
    ])),
    [currentBenchmarkSummaries],
  );
  const routeEvaluationDialog =
    (route.kind === "candidate" || route.kind === "evaluations") &&
    route.dialog?.kind === "evaluation"
      ? route.dialog
      : null;
  const routeEvaluationId = routeEvaluationDialog?.evaluationId ?? null;
  const routeEvaluationCaseId = routeEvaluationDialog?.caseId ?? null;
  const routeEvaluationSummary = useMemo(
    () => routeEvaluationId && snapshot
      ? snapshot.evaluations.find((evaluation) => evaluation.id === routeEvaluationId) ?? null
      : null,
    [routeEvaluationId, snapshot],
  );
  const evaluationIdsToLoad = useMemo(() => {
    if (routeEvaluationId) {
      return [routeEvaluationId];
    }
    return [];
  }, [routeEvaluationId]);
  const evaluationRecordKey = useMemo(
    () => evaluationIdsToLoad.join("|"),
    [evaluationIdsToLoad],
  );
  const selectedCandidateId = resolveSelectedCandidateId({
    route,
    activeId: snapshot?.activeId ?? null,
    summaries: currentBenchmarkSummaries,
  });
  const selectedCandidateSummary = selectedCandidateId
    ? currentBenchmarkSummaries.find((summary) => summary.id === selectedCandidateId) ?? null
    : null;
  const selectedCandidateHasInspectableFiles = Boolean(selectedCandidateSummary);
  const orderedCandidateFiles = useMemo(
    () => orderCandidateFiles(candidateFilesState.files),
    [candidateFilesState.files],
  );
  const orderedBenchmarkFiles = useMemo(
    () => orderCandidateFiles(benchmarkFilesState.files),
    [benchmarkFilesState.files],
  );
  const selectedCandidateFilePath = route.kind === "candidate" && route.view === "files"
    ? resolveSelectedCandidateFilePath({
        routeFilePath: route.filePath,
        files: orderedCandidateFiles,
      })
    : null;
  const candidatePreviewMode = route.kind === "candidate" && route.view === "files"
    ? route.previewMode
    : "rendered";
  const candidateDirectoryPath = route.kind === "candidate" && route.view === "files"
    ? route.directoryPath
    : null;
  const prefersCompactWorkspaceLayout = useMediaQuery(COMPACT_WORKSPACE_LAYOUT_MEDIA_QUERY);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setSpecLoading(true);
    setSpecError(null);

    const params = new URLSearchParams();
    if (scopedBenchmarkFingerprint) {
      params.set("fingerprint", scopedBenchmarkFingerprint);
    }

    async function loadSpec() {
      try {
        const next = await requestJson<AuthoredWorkbenchSourceDocument>(
          apiPath(`/api/spec${params.size ? `?${params.toString()}` : ""}`),
          { signal: controller.signal },
        );
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setSpecDocument(next);
          setSpecError(null);
          setSpecLoading(false);
        });
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setSpecError(toMessage(error));
          setSpecLoading(false);
        }
      }
    }

    void loadSpec();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiPath, scopedBenchmarkFingerprint]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      DESKTOP_DETAIL_PANE_STORAGE_KEY,
      String(desktopDetailLeftPercent),
    );
  }, [desktopDetailLeftPercent]);

  useEffect(() => {
    if (!shouldLoadBenchmarkSourceFiles) {
      setBenchmarkFilesState((current) =>
        current.files.length > 0
          ? { ...current, loading: false, error: null }
          : {
              loading: false,
              error: null,
              files: [],
            }
      );
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setBenchmarkFilesState({
      loading: true,
      error: null,
      files: [],
    });

    const params = new URLSearchParams();
    if (scopedBenchmarkFingerprint) {
      params.set("fingerprint", scopedBenchmarkFingerprint);
    }

    void requestJson<CandidateWorkspaceFileSummary[]>(
      apiPath(`/api/source/files${params.size ? `?${params.toString()}` : ""}`),
      { signal: controller.signal },
    ).then((files) => {
      if (cancelled) {
        return;
      }
      startTransition(() => {
        setBenchmarkFilesState({
          loading: false,
          error: null,
          files,
        });
      });
    }).catch((error: unknown) => {
      if (cancelled || controller.signal.aborted) {
        return;
      }
      setBenchmarkFilesState({
        loading: false,
        error: toMessage(error),
        files: [],
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiPath, scopedBenchmarkFingerprint, shouldLoadBenchmarkSourceFiles]);

  useEffect(() => {
    const nextBenchmarkFingerprint =
      routeBenchmarkFingerprint ??
      (selectedBenchmarkFingerprint &&
        benchmarkFingerprintOptions.some((option) => option.fingerprint === selectedBenchmarkFingerprint)
        ? selectedBenchmarkFingerprint
        : preferredBenchmarkFingerprint ?? benchmarkFingerprintOptions[0]?.fingerprint ?? null);
    if (nextBenchmarkFingerprint !== selectedBenchmarkFingerprint) {
      setSelectedBenchmarkFingerprint(nextBenchmarkFingerprint);
    }
  }, [
    benchmarkFingerprintOptions,
    preferredBenchmarkFingerprint,
    routeBenchmarkFingerprint,
    selectedBenchmarkFingerprint,
  ]);

  useEffect(() => {
    const nextFilePath =
      selectedBenchmarkFilePath && orderedBenchmarkFiles.some((file) => file.path === selectedBenchmarkFilePath)
        ? selectedBenchmarkFilePath
        : resolvePreferredBenchmarkFilePath(orderedBenchmarkFiles);
    if (nextFilePath !== selectedBenchmarkFilePath) {
      setSelectedBenchmarkFilePath(nextFilePath);
      setBenchmarkDirectoryPath(directoryPathForFile(nextFilePath));
    }
  }, [orderedBenchmarkFiles, selectedBenchmarkFilePath]);

  useEffect(() => {
    if (!shouldLoadBenchmarkSourceFiles || !selectedBenchmarkFilePath) {
      setBenchmarkPreviewState({
        loading: false,
        error: null,
        preview: null,
      });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setBenchmarkPreviewState({
      loading: true,
      error: null,
      preview: null,
    });
    const params = new URLSearchParams({
      path: selectedBenchmarkFilePath,
      view: benchmarkPreviewMode,
    });
    if (scopedBenchmarkFingerprint) {
      params.set("fingerprint", scopedBenchmarkFingerprint);
    }

    void requestJson<CandidateWorkspaceFilePreview>(
      apiPath(`/api/source/preview?${params.toString()}`),
      { signal: controller.signal },
    ).then((preview) => {
      if (cancelled) {
        return;
      }
      startTransition(() => {
        setBenchmarkPreviewState({
          loading: false,
          error: null,
          preview,
        });
      });
    }).catch((error: unknown) => {
      if (cancelled || controller.signal.aborted) {
        return;
      }
      setBenchmarkPreviewState({
        loading: false,
        error: toMessage(error),
        preview: null,
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiPath, selectedBenchmarkFilePath, benchmarkPreviewMode, scopedBenchmarkFingerprint, shouldLoadBenchmarkSourceFiles]);

  useEffect(() => {
    if (route.kind !== "candidate") {
      return;
    }
    if (snapshot === null) {
      return;
    }
    if (!selectedCandidateId) {
      navigate(createCandidatesRoute(), { replace: true });
      return;
    }

    if (route.candidateId !== selectedCandidateId) {
      navigate(
        createCandidateRoute({
          candidateId: selectedCandidateId,
          view: route.view,
          filePath: route.view === "files" ? route.filePath : null,
          directoryPath: route.view === "files" ? route.directoryPath : null,
          previewMode: route.view === "files" ? route.previewMode : "rendered",
          dialog: route.dialog,
        }),
        { replace: true },
      );
      return;
    }

  }, [navigate, orderedCandidateSummaries.length, route, selectedCandidateId, snapshot]);

  useEffect(() => {
    if (route.kind !== "candidate" || route.view !== "files" || !selectedCandidateId) {
      return;
    }
    if (candidateFilesState.loading || candidateFilesState.error) {
      return;
    }

    const nextFilePath = resolveSelectedCandidateFilePath({
      routeFilePath: route.filePath,
      files: orderedCandidateFiles,
    });
    if (nextFilePath !== route.filePath) {
      navigate(
        createCandidateRoute({
          candidateId: selectedCandidateId,
          view: "files",
          filePath: nextFilePath,
          directoryPath: route.directoryPath ?? directoryPathForFile(nextFilePath),
          previewMode: route.previewMode,
          dialog: route.dialog,
        }),
        { replace: true },
      );
    }
  }, [
    candidateFilesState.error,
    candidateFilesState.loading,
    navigate,
    orderedCandidateFiles,
    route,
    selectedCandidateId,
  ]);

  useEffect(() => {
    if (route.kind !== "candidate" || route.view !== "manifest" || !selectedCandidateId) {
      setRecordState({
        loading: false,
        error: null,
        record: null,
      });
      return;
    }

    let cancelled = false;
    setRecordState({
      loading: true,
      error: null,
      record: null,
    });
    const candidateId = selectedCandidateId;

    async function loadRecord() {
      try {
        const record = await requestJson<CandidateRecord>(
          apiPath(`/api/record?id=${encodeURIComponent(candidateId)}`),
        );
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setRecordState({
            loading: false,
            error: null,
            record,
          });
        });
      } catch (error) {
        if (!cancelled) {
          setRecordState({
            loading: false,
            error: toMessage(error),
            record: null,
          });
        }
      }
    }

    void loadRecord();
    return () => {
      cancelled = true;
    };
  }, [apiPath, route, selectedCandidateId]);

  useEffect(() => {
    if (evaluationIdsToLoad.length === 0) {
      setEvaluationRecordsState({
        loading: false,
        error: null,
        records: [],
      });
      return;
    }

    let cancelled = false;
    setEvaluationRecordsState((current) => ({
      loading: current.records.length === 0,
      error: null,
      records: current.records,
    }));

    async function loadEvaluations() {
      try {
        const records = await Promise.all(
          evaluationIdsToLoad.map((evaluationId) =>
            requestJson<EvaluationScorecard>(
              apiPath(`/api/evaluation?id=${encodeURIComponent(evaluationId)}`),
            ),
          ),
        );
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setEvaluationRecordsState({
            loading: false,
            error: null,
            records,
          });
        });
      } catch (error) {
        if (!cancelled) {
          setEvaluationRecordsState({
            loading: false,
            error: toMessage(error),
            records: [],
          });
        }
      }
    }

    void loadEvaluations();
    return () => {
      cancelled = true;
    };
  }, [apiPath, evaluationIdsToLoad, evaluationRecordKey]);

  useEffect(() => {
    if (
      route.kind !== "candidate" ||
      route.view !== "files" ||
      !selectedCandidateId ||
      !selectedCandidateHasInspectableFiles
    ) {
      setCandidateFilesState({
        loading: false,
        error: null,
        files: [],
      });
      return;
    }

    let cancelled = false;
    setCandidateFilesState({
      loading: true,
      error: null,
      files: [],
    });
    const candidateId = selectedCandidateId;

    async function loadFiles() {
      try {
        const files = await requestJson<CandidateWorkspaceFileSummary[]>(
          apiPath(`/api/candidate/files?id=${encodeURIComponent(candidateId)}`),
        );
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setCandidateFilesState({
            loading: false,
            error: null,
            files,
          });
        });
      } catch (error) {
        if (!cancelled) {
          setCandidateFilesState({
            loading: false,
            error: toMessage(error),
            files: [],
          });
        }
      }
    }

    void loadFiles();
    return () => {
      cancelled = true;
    };
  }, [apiPath, route, selectedCandidateHasInspectableFiles, selectedCandidateId]);

  useEffect(() => {
    if (
      route.kind !== "candidate" ||
      route.view !== "files" ||
      !selectedCandidateId ||
      !selectedCandidateHasInspectableFiles ||
      !selectedCandidateFilePath
    ) {
      setCandidatePreviewState({
        loading: false,
        error: null,
        preview: null,
      });
      return;
    }

    let cancelled = false;
    setCandidatePreviewState({
      loading: true,
      error: null,
      preview: null,
    });
    const candidateId = selectedCandidateId;
    const filePath = selectedCandidateFilePath;

    async function loadPreview() {
      try {
        const params = new URLSearchParams({
          id: candidateId,
          path: filePath,
          view: candidatePreviewMode,
        });
        const preview = await requestJson<CandidateWorkspaceFilePreview>(
          apiPath(`/api/candidate/preview?${params.toString()}`),
        );
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setCandidatePreviewState({
            loading: false,
            error: null,
            preview,
          });
        });
      } catch (error) {
        if (!cancelled) {
          setCandidatePreviewState({
            loading: false,
            error: toMessage(error),
            preview: null,
          });
        }
      }
    }

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [apiPath, candidatePreviewMode, route, selectedCandidateFilePath, selectedCandidateHasInspectableFiles, selectedCandidateId]);

  const routeEvaluationScorecard = routeEvaluationId
    ? evaluationRecordsState.records.find((record) => record.id === routeEvaluationId) ?? null
    : null;
  const routeEvaluationCandidateId =
    routeEvaluationScorecard?.candidateId ??
    routeEvaluationSummary?.candidateId ??
    null;
  const evaluationCaseReviewState = useCaseReview(
    apiPath,
    routeEvaluationCaseId ? routeEvaluationCandidateId : null,
    routeEvaluationCaseId ? (routeEvaluationSummary?.runId ?? routeEvaluationScorecard?.runId ?? null) : null,
    routeEvaluationCaseId,
  );

  function navigateToCandidate(args: {
    candidateId: string;
    view?: CandidateView;
    filePath?: string | null;
    directoryPath?: string | null;
    previewMode?: CandidatePreviewMode;
    dialog?: CandidateDialog | null;
    replace?: boolean;
  }) {
    const view = args.view ?? (route.kind === "candidate" ? route.view : "overview");
    navigate(
      createCandidateRoute({
        candidateId: args.candidateId,
        view,
        filePath: view === "files" ? args.filePath ?? (route.kind === "candidate" ? route.filePath : null) : null,
        directoryPath: view === "files"
          ? args.directoryPath ?? (route.kind === "candidate" && route.view === "files" ? route.directoryPath : null)
          : null,
        previewMode: view === "files"
          ? args.previewMode ?? (route.kind === "candidate" && route.view === "files" ? route.previewMode : "rendered")
          : "rendered",
        dialog: args.dialog ?? (route.kind === "candidate" ? route.dialog : null),
      }),
      args.replace ? { replace: true } : undefined,
    );
  }

  function handleSelectCandidate(candidateId: string) {
    navigateToCandidate({
      candidateId,
      view: route.kind === "candidate" ? route.view : "overview",
      filePath: route.kind === "candidate" && route.view === "files" ? route.filePath : null,
      directoryPath: route.kind === "candidate" && route.view === "files" ? route.directoryPath : null,
      previewMode: route.kind === "candidate" && route.view === "files" ? route.previewMode : "rendered",
      dialog: null,
    });
  }

  function createCurrentCandidateRoute(dialog: CandidateDialog | null): WorkbenchRoute | null {
    if (route.kind !== "candidate" || !selectedCandidateId) {
      return null;
    }
    return createCandidateRoute({
      candidateId: selectedCandidateId,
      view: route.view,
      filePath: route.view === "files" ? route.filePath : null,
      directoryPath: route.view === "files" ? route.directoryPath : null,
      previewMode: route.view === "files" ? route.previewMode : "rendered",
      dialog,
    });
  }

  const routeHref = (next: WorkbenchRoute) => buildWorkbenchLocationHref(next, routeBasePath, persistentSearchParams);
  const benchmarkHref = routeHref(createBenchmarkRoute());

  const objectSurface = (() => {
    if (route.kind === "not-found") {
      return (
        <ScrollableObjectSurface>
          <ProblemState
            message="The page you requested could not be found."
            scope="workspace"
            statusCode={404}
            title="Page not found"
          />
        </ScrollableObjectSurface>
      );
    }

    if (route.kind === "candidate" && route.view === "manifest") {
      return (
        <CandidateYamlSurface
          snapshotError={snapshotError}
          snapshotLoading={snapshotLoading}
          selectedCandidateSummary={selectedCandidateSummary}
          recordState={recordState}
        />
      );
    }

    if (route.kind === "candidate" && route.view === "files") {
      return (
        <CandidateFilesSurface
          snapshotError={snapshotError}
          snapshotLoading={snapshotLoading}
          selectedCandidateSummary={selectedCandidateSummary}
          candidateFilesState={candidateFilesState}
          selectedCandidateFilePath={selectedCandidateFilePath}
          candidatePreviewMode={candidatePreviewMode}
          candidateDirectoryPath={candidateDirectoryPath}
          candidatePreviewState={candidatePreviewState}
          onSelectCandidateFile={(filePath) => {
            if (!selectedCandidateId) {
              return;
            }
            const directoryPath = directoryPathForFile(filePath);
            navigateToCandidate({
              candidateId: selectedCandidateId,
              view: "files",
              filePath,
              directoryPath,
              previewMode: candidatePreviewMode,
            });
          }}
          onCandidateDirectoryChange={(directoryPath) => {
            if (!selectedCandidateId) {
              return;
            }
            navigateToCandidate({
              candidateId: selectedCandidateId,
              view: "files",
              filePath: selectedCandidateFilePath,
              directoryPath,
              previewMode: candidatePreviewMode,
            });
          }}
          onCandidatePreviewModeChange={(mode) => {
            if (!selectedCandidateId) {
              return;
            }
            navigateToCandidate({
              candidateId: selectedCandidateId,
              view: "files",
              filePath: selectedCandidateFilePath,
              directoryPath: candidateDirectoryPath,
              previewMode: mode,
            });
          }}
        />
      );
    }

    if (route.kind === "candidate" && route.view === "overview") {
      return (
        <CandidateOverviewSurface
          snapshot={snapshot}
          snapshotError={snapshotError}
          snapshotLoading={snapshotLoading}
          selectedCandidateSummary={selectedCandidateSummary}
          selectedCandidateRuntimeState={selectedCandidateId
            ? runtimeState.candidateStateById.get(selectedCandidateId) ?? null
            : null}
          evaluations={currentBenchmarkEvaluations}
          onOpenEvaluation={(evaluationId) => {
            const next = createCurrentCandidateRoute({ kind: "evaluation", evaluationId });
            if (next) {
              navigate(next);
            }
          }}
        />
      );
    }

    if (route.kind === "evaluations") {
      return (
        <ScrollableObjectSurface>
          <EvaluationsSurface
            snapshotError={snapshotError}
            snapshotLoading={snapshotLoading}
            evaluations={currentBenchmarkEvaluations}
            rows={currentBenchmarkEvaluationRows}
            candidateLabelById={currentBenchmarkCandidateLabelById}
            onSelectEvaluation={(evaluationId) => navigate(createEvaluationsRoute({
              dialog: { kind: "evaluation", evaluationId },
            }))}
          />
        </ScrollableObjectSurface>
      );
    }

    return (
      <CandidatesIndexSurface
        snapshot={snapshot}
        snapshotError={snapshotError}
        snapshotLoading={snapshotLoading}
        currentBenchmarkSummaries={currentBenchmarkSummaries}
        currentBenchmarkEvaluations={currentBenchmarkEvaluations}
        currentBenchmarkRuns={currentBenchmarkRuns}
        candidateStateById={runtimeState.candidateStateById}
        selectedCandidateId={selectedCandidateId}
        view={route.kind === "candidates" ? route.view : "archive"}
        onViewChange={(view) => navigate(createCandidatesRoute({ view }))}
        onSelectCandidate={handleSelectCandidate}
      />
    );
  })();

  const desktopObjectPaneOpen =
    route.kind !== "benchmark" && !prefersCompactWorkspaceLayout;
  const workbenchBrandHref = brandHref ?? benchmarkHref;
  const benchmarkNavigation = (
    <WorkbenchBenchmarkNavigation
      route={route}
      routeHref={routeHref}
      onNavigate={navigate}
    />
  );
  const objectPaneCollapseAction = desktopObjectPaneOpen ? (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Collapse details pane"
      title="Collapse details pane"
      data-testid="object-pane-collapse"
      onClick={() => navigate(createBenchmarkRoute())}
    >
      <PanelRightCloseIcon />
      <span className="sr-only">Collapse details pane</span>
    </Button>
  ) : null;

  const benchmarkSurface = (
    <BenchmarkSurface
      activeTab={benchmarkSurfaceTab}
      onActiveTabChange={setBenchmarkSurfaceTab}
      selectedBenchmarkFingerprint={scopedBenchmarkFingerprint}
      currentBenchmarkFingerprint={currentBenchmarkFingerprint}
      benchmarkFingerprintOptions={benchmarkFingerprintOptions}
      specDocument={specDocument}
      specError={specError}
      sourceFilesState={benchmarkFilesState}
      selectedSourceFilePath={selectedBenchmarkFilePath}
      sourcePreviewMode={benchmarkPreviewMode}
      sourceDirectoryPath={benchmarkDirectoryPath}
      sourcePreviewState={benchmarkPreviewState}
      onSelectSourceFile={(filePath) => {
        setSelectedBenchmarkFilePath(filePath);
        setBenchmarkDirectoryPath(directoryPathForFile(filePath));
      }}
      onSourceDirectoryChange={setBenchmarkDirectoryPath}
      onSourcePreviewModeChange={setBenchmarkPreviewMode}
      onBenchmarkFingerprintChange={setSelectedBenchmarkFingerprint}
      loading={specLoading}
      actions={objectPaneCollapseAction}
    />
  );

  const workspaceHeader = (
    <div className="flex min-w-0 flex-col">
      <div className="px-4 py-3 sm:px-5">
        <WorkspaceTopBar
          brand={(
            <a
              href={workbenchBrandHref}
              aria-label="Workbench home"
              data-testid="app-brand-link"
              className="inline-flex shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={(event) => {
                if (brandHref) {
                  return;
                }
                event.preventDefault();
                navigate(createBenchmarkRoute());
              }}
            >
              <WorkbenchBrand />
            </a>
          )}
          actions={headerControls}
        />
      </div>
      <div className="border-t border-border/60 bg-muted/30 px-4 py-2 sm:px-5">
        <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <WorkbenchBreadcrumbs
              route={route}
              selectedCandidateSummary={selectedCandidateSummary}
              routeHref={routeHref}
              onNavigate={navigate}
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 md:justify-end">
            <WorkbenchActivitySummary
              runtimeState={runtimeState}
              loading={snapshotLoading}
              refreshing={snapshotRefreshing}
              error={snapshotError}
              onRefresh={refreshSnapshot}
            />
            {benchmarkNavigation}
          </div>
        </div>
      </div>
    </div>
  );

  const benchmarkPane = (
    <WorkspacePane
      tone="secondary"
      hideHeader
      scrollBody={!benchmarkSurfaceFillsBody}
      contentClassName={benchmarkSurfaceFillsBody ? "flex h-full min-h-0 flex-col" : undefined}
    >
      {benchmarkSurface}
    </WorkspacePane>
  );

  const candidateDetailViewSwitch = route.kind === "candidate" ? (
    <ViewSwitch
      ariaLabel="Candidate views"
      value={route.view}
      className="self-start"
      items={[
        { value: "overview", label: "Overview", icon: InfoIcon },
        { value: "manifest", label: "Manifest", icon: FileCode2Icon },
        { value: "files", label: "Files", icon: FolderOpenIcon },
      ]}
      onValueChange={(value) => {
        if (!selectedCandidateId) {
          return;
        }
        const nextView: CandidateView =
          value === "files" ? "files" : value === "manifest" ? "manifest" : "overview";
        navigateToCandidate({
          candidateId: selectedCandidateId,
          view: nextView,
          directoryPath: nextView === "files" ? candidateDirectoryPath : null,
          previewMode: nextView === "files" ? candidatePreviewMode : "rendered",
        });
      }}
    />
  ) : null;
  const objectSurfaceFillsBody =
    (route.kind === "candidate" && route.view === "files") ||
    route.kind === "candidates" ||
    route.kind === "evaluations";

  const objectPane = (
    <WorkspacePane
      title={objectPaneTitle({
        route,
        selectedCandidateSummary,
      })}
      badges={(
        <ObjectPaneBadges
          route={route}
          snapshot={snapshot}
          candidateCount={currentBenchmarkSummaries.length}
          evaluationCount={currentBenchmarkEvaluationRows.length}
          selectedCandidateSummary={selectedCandidateSummary}
          selectedCandidateRuntimeState={selectedCandidateId
            ? runtimeState.candidateStateById.get(selectedCandidateId) ?? null
            : null}
        />
      )}
      subnav={candidateDetailViewSwitch}
      scrollBody={!objectSurfaceFillsBody}
      contentClassName={objectSurfaceFillsBody ? "flex h-full min-h-0 flex-col" : undefined}
    >
      {objectSurface}
    </WorkspacePane>
  );
  const candidateContextDialog = route.kind === "candidate" ? route.dialog : null;
  const evaluationsContextDialog = route.kind === "evaluations" ? route.dialog : null;
  const contextualDialogs = (
    <>
      {candidateContextDialog?.kind === "evaluation" ? (
        <EvaluationDetailDialog
          open
          evaluationId={candidateContextDialog.evaluationId}
          evaluationSummary={routeEvaluationSummary}
          state={evaluationRecordsState}
          selectedCaseId={candidateContextDialog.caseId ?? null}
          caseReviewState={evaluationCaseReviewState}
          onClose={() => {
            const next = createCurrentCandidateRoute(null);
            if (next) {
              navigate(next);
            }
          }}
          onSelectCase={(caseId) => {
            const next = createCurrentCandidateRoute({
              kind: "evaluation",
              evaluationId: candidateContextDialog.evaluationId,
              caseId,
            });
            if (next) {
              navigate(next);
            }
          }}
          apiPath={apiPath}
        />
      ) : null}

      {evaluationsContextDialog?.kind === "evaluation" ? (
        <EvaluationDetailDialog
          open
          evaluationId={evaluationsContextDialog.evaluationId}
          evaluationSummary={routeEvaluationSummary}
          state={evaluationRecordsState}
          selectedCaseId={evaluationsContextDialog.caseId ?? null}
          caseReviewState={evaluationCaseReviewState}
          onClose={() => navigate(createEvaluationsRoute())}
          onSelectCase={(caseId) => navigate(createEvaluationsRoute({
            dialog: {
              kind: "evaluation",
              evaluationId: evaluationsContextDialog.evaluationId,
              caseId,
            },
          }))}
          apiPath={apiPath}
        />
      ) : null}
    </>
  );

  return (
    <WorkspaceRoot
      mainId="main-content"
      skipLinkLabel="Skip to Workbench workspace"
      header={workspaceHeader}
      headerClassName="px-0 py-0 sm:px-0"
    >
      {prefersCompactWorkspaceLayout ? (
        route.kind === "benchmark" ? benchmarkPane : objectPane
      ) : (
        <DesktopWorkspaceSplit
          paneOpen={desktopObjectPaneOpen}
          primaryPercent={desktopDetailLeftPercent}
          minPrimaryPercent={DESKTOP_DETAIL_LEFT_MIN_PERCENT}
          maxPrimaryPercent={DESKTOP_DETAIL_LEFT_MAX_PERCENT}
          onPrimaryPercentChange={setDesktopDetailLeftPercent}
          primaryPane={benchmarkPane}
          secondaryPane={objectPane}
          secondaryPaneId="workbench-object-pane"
          separatorLabel="Resize details pane"
        />
      )}

      {contextualDialogs}
    </WorkspaceRoot>
  );
}

export function App() {
  return <WorkbenchWorkspace apiBasePath="/api" routeBasePath="/" />;
}

function createApiPathResolver(apiBasePath: string): (pathname: string) => string {
  const basePath = apiBasePath.replace(/\/+$/u, "");
  return (pathname: string) => {
    const [rawPath = "", rawQuery] = pathname.split("?", 2);
    const normalizedPath = rawPath.replace(/^\/api/u, "").replace(/^\/+/u, "");
    const suffix = normalizedPath.length > 0 ? `/${normalizedPath}` : "";
    return `${basePath}${suffix}${rawQuery ? `?${rawQuery}` : ""}`;
  };
}

function useWorkbenchRoute(
  routeBasePath: string,
  persistentSearchParams: WorkbenchPersistentSearchParams,
  initialPath: string,
  initialSearch: string,
): [WorkbenchRoute, (route: WorkbenchRoute, options?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState<WorkbenchRoute>(() =>
    readInitialWorkbenchRoute(routeBasePath, initialPath, initialSearch));

  useEffect(() => {
    const readCurrentRoute = () => parseWorkbenchLocation({
      pathname: window.location.pathname,
      search: window.location.search,
    }, routeBasePath);
    const normalizeCurrentLocation = () => {
      const nextRoute = readCurrentRoute();
      const href = buildWorkbenchLocationHref(nextRoute, routeBasePath, persistentSearchParams);
      const current = `${window.location.pathname}${window.location.search}`;
      if (href !== current) {
        window.history.replaceState({}, "", href);
      }
      return nextRoute;
    };

    setRoute(normalizeCurrentLocation());

    const handlePopState = () => {
      setRoute(normalizeCurrentLocation());
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [persistentSearchParams, routeBasePath]);

  function navigate(next: WorkbenchRoute, options: { replace?: boolean } = {}) {
    const href = buildWorkbenchLocationHref(next, routeBasePath, persistentSearchParams);
    const current = `${window.location.pathname}${window.location.search}`;
    if (href !== current) {
      window.history[options.replace ? "replaceState" : "pushState"]({}, "", href);
    }
    setRoute(parseWorkbenchLocation({
      pathname: window.location.pathname,
      search: window.location.search,
    }, routeBasePath));
  }

  return [route, navigate];
}

function readInitialWorkbenchRoute(
  routeBasePath: string,
  initialPath: string,
  initialSearch: string,
): WorkbenchRoute {
  if (typeof window !== "undefined") {
    return parseWorkbenchLocation({
      pathname: window.location.pathname,
      search: window.location.search,
    }, routeBasePath);
  }
  return parseWorkbenchRoute({
    pathname: initialPath,
    search: initialSearch,
  });
}

function WorkbenchBenchmarkNavigation({
  route,
  routeHref,
  onNavigate,
}: {
  route: WorkbenchRoute;
  routeHref: (route: WorkbenchRoute) => string;
  onNavigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
}) {
  const value =
    route.kind === "candidates" || route.kind === "candidate"
      ? "candidates"
      : route.kind === "evaluations"
          ? "evaluations"
          : null;
  const items = [
    {
      value: "candidates",
      label: "Candidates",
      route: createCandidatesRoute(),
    },
    {
      value: "evaluations",
      label: "Evaluations",
      route: createEvaluationsRoute(),
    },
  ] as const;

  return (
    <nav aria-label="Benchmark navigation" className="flex min-w-0 items-center gap-1 overflow-x-auto md:justify-end">
      {items.map((item) => {
        const active = item.value === value;
        const targetRoute = active ? createBenchmarkRoute() : item.route;
        return (
          <Button
            key={item.value}
            asChild
            size="sm"
            variant={active ? "secondary" : "ghost"}
          >
            <a
              aria-current={active ? "page" : undefined}
              href={routeHref(targetRoute)}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(targetRoute);
              }}
            >
              {item.label}
            </a>
          </Button>
        );
      })}
    </nav>
  );
}

function objectPaneTitle(args: {
  route: WorkbenchRoute;
  selectedCandidateSummary: CandidateSummary | null;
}): string {
  if (args.route.kind === "candidates") {
    return "Candidates";
  }
  if (args.route.kind === "evaluations") {
    return "Evaluations";
  }
  if (args.route.kind === "not-found") {
    return "Not found";
  }
  if (args.route.kind !== "candidate") {
    return "Benchmark";
  }
  if (!args.selectedCandidateSummary) {
    return "Candidate";
  }
  return formatCandidateName(args.selectedCandidateSummary);
}

function WorkbenchBreadcrumbs({
  route,
  selectedCandidateSummary,
  routeHref,
  onNavigate,
}: {
  route: WorkbenchRoute;
  selectedCandidateSummary: CandidateSummary | null;
  routeHref: (route: WorkbenchRoute) => string;
  onNavigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
}) {
  if (route.kind === "benchmark") {
    return (
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="min-w-0 flex-nowrap">
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">Benchmark</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  const terminalLabel = route.kind === "candidate"
    ? selectedCandidateSummary
      ? formatCandidateName(selectedCandidateSummary)
      : "Candidate"
    : route.kind === "evaluations"
      ? "Evaluations"
      : route.kind === "not-found"
        ? "Not found"
        : "Candidates";
  const parentRoute =
    route.kind === "candidate" ? createCandidatesRoute() :
    null;
  const parentLabel =
    route.kind === "candidate" ? "Candidates" :
    null;

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="min-w-0 flex-nowrap">
        <BreadcrumbItem>
          <BreadcrumbLink
            href={routeHref(createBenchmarkRoute())}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(createBenchmarkRoute());
            }}
          >
            Benchmark
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        {parentRoute && parentLabel ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink
                href={routeHref(parentRoute)}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(parentRoute);
                }}
              >
                {parentLabel}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate">{terminalLabel}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : (
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">{terminalLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function WorkbenchActivitySummary({
  runtimeState,
  loading,
  refreshing,
  error,
  onRefresh,
}: {
  runtimeState: WorkbenchRuntimeState;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const label = loading && !runtimeState.lastUpdatedAt
    ? "Loading state"
    : activeRunSummaryLabel(runtimeState.activeRuns);
  const secondary = activitySecondaryLabel(runtimeState, refreshing, error);
  const tone = badgeToneProps(error
    ? "destructive"
    : runtimeState.hasActiveWork
      ? "warning"
      : "outline");

  return (
    <div
      data-testid="workbench-activity-summary"
      className="flex min-w-0 items-center gap-2 text-xs"
    >
      <Badge
        variant={tone.variant}
        className={cn("max-w-[11rem] truncate", tone.className)}
        title={label}
      >
        {label}
      </Badge>
      <span
        className="hidden min-w-0 max-w-[14rem] truncate text-muted-foreground lg:inline"
        title={secondary}
      >
        {secondary}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Refresh Workbench state"
        title="Refresh Workbench state"
        disabled={loading || refreshing}
        onClick={onRefresh}
      >
        <RefreshCwIcon className={refreshing ? "animate-spin" : undefined} />
        <span className="sr-only">Refresh</span>
      </Button>
    </div>
  );
}

function activitySecondaryLabel(
  runtimeState: WorkbenchRuntimeState,
  refreshing: boolean,
  error: string | null,
): string {
  if (error) {
    return "Snapshot unavailable";
  }
  if (refreshing) {
    return "Refreshing";
  }
  if (runtimeState.lastUpdatedAt) {
    return `Updated ${formatTimestamp(runtimeState.lastUpdatedAt)}`;
  }
  return formatCount(runtimeState.recentRuns.length, "run");
}

function ObjectPaneBadges({
  route,
  snapshot,
  candidateCount,
  evaluationCount,
  selectedCandidateSummary,
  selectedCandidateRuntimeState,
}: {
  route: WorkbenchRoute;
  snapshot: BenchmarkSnapshot | null;
  candidateCount: number;
  evaluationCount: number;
  selectedCandidateSummary: CandidateSummary | null;
  selectedCandidateRuntimeState: CandidateRuntimeState | null;
}) {
  if (route.kind === "evaluations") {
    return snapshot ? <Badge variant="outline">{formatCount(evaluationCount, "evaluation")}</Badge> : null;
  }

  if (route.kind === "benchmark") {
    return snapshot ? <Badge variant="outline">{formatCount(candidateCount, "candidate")}</Badge> : null;
  }

  if (route.kind === "not-found") {
    return null;
  }

  if (route.kind !== "candidate") {
    return snapshot ? (
      <Badge variant="outline">
        {formatCount(candidateCount, "candidate")}
      </Badge>
    ) : null;
  }

  return (
    <>
      {selectedCandidateSummary ? (
        <Badge variant="outline">
          {formatCandidateVersionLabel(selectedCandidateSummary) ?? "unversioned"}
        </Badge>
      ) : null}
      {selectedCandidateSummary ? (
        <StatusBadge
          status={selectedCandidateSummary.status}
          active={snapshot?.activeId === selectedCandidateSummary.id}
        />
      ) : null}
      {shouldShowCandidateRuntimeBadge(selectedCandidateRuntimeState) ? (
        <CandidateRuntimeBadge state={selectedCandidateRuntimeState} />
      ) : null}
    </>
  );
}

function PaneErrorState({
  message,
  title = "Couldn't load Workbench data",
}: {
  message: string;
  title?: string;
}) {
  return (
    <ProblemState
      align="start"
      icon={AlertTriangleIcon}
      message={message}
      scope="pane"
      title={title}
    />
  );
}

function DetailAccordionSection({
  value,
  title,
  summary,
  children,
  contentClassName = "pb-3",
  bordered = false,
  "data-testid": dataTestId,
}: {
  value: string;
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  bordered?: boolean;
  "data-testid"?: string;
}) {
  return (
    <AccordionItem
      value={value}
      data-testid={dataTestId}
      className={cn(
        "min-w-0",
        bordered && "rounded-lg border border-border/60 px-3 not-last:border-b",
      )}
    >
      <AccordionTrigger className="min-w-0 py-2.5">
        <div className="grid min-w-0 flex-1 gap-1 text-left">
          <span className="min-w-0 text-sm font-medium text-foreground">{title}</span>
          {summary ? (
            <span className="min-w-0 max-w-full text-xs font-normal text-muted-foreground whitespace-normal break-words [overflow-wrap:anywhere]">
              {summary}
            </span>
          ) : null}
        </div>
      </AccordionTrigger>
      <AccordionContent className={contentClassName}>
        <div className="flex flex-col gap-3">{children}</div>
      </AccordionContent>
    </AccordionItem>
  );
}

function BenchmarkSurface({
  activeTab,
  onActiveTabChange,
  selectedBenchmarkFingerprint,
  currentBenchmarkFingerprint,
  benchmarkFingerprintOptions,
  specDocument,
  specError,
  sourceFilesState,
  selectedSourceFilePath,
  sourcePreviewMode,
  sourceDirectoryPath,
  sourcePreviewState,
  onSelectSourceFile,
  onSourceDirectoryChange,
  onSourcePreviewModeChange,
  onBenchmarkFingerprintChange,
  loading,
  actions,
}: {
  activeTab: BenchmarkSurfaceTab;
  onActiveTabChange: (tab: BenchmarkSurfaceTab) => void;
  selectedBenchmarkFingerprint: string | null;
  currentBenchmarkFingerprint: string | null;
  benchmarkFingerprintOptions: BenchmarkFingerprintOption[];
  specDocument: AuthoredWorkbenchSourceDocument | null;
  specError: string | null;
  sourceFilesState: CandidateFilesState;
  selectedSourceFilePath: string | null;
  sourcePreviewMode: CandidatePreviewMode;
  sourceDirectoryPath: string | null;
  sourcePreviewState: CandidatePreviewState;
  onSelectSourceFile: (filePath: string) => void;
  onSourceDirectoryChange: (directoryPath: string | null) => void;
  onSourcePreviewModeChange: (mode: CandidatePreviewMode) => void;
  onBenchmarkFingerprintChange: (fingerprint: string | null) => void;
  loading: boolean;
  actions?: ReactNode;
}) {
  const prefersStackedFilesLayout = useMediaQuery("(max-width: 900px)");
  if (specError) {
    return (
      <div className="grid gap-4">
        <PaneErrorState
          message={specError}
          title="Couldn't load benchmark source"
        />
      </div>
    );
  }

  if (loading) {
    return <BenchmarkSurfaceSkeleton />;
  }

  if (!specDocument?.spec) {
    return (
      <div className="grid gap-4">
        <EmptyState
          icon={Settings2Icon}
          title="No benchmark loaded"
          message="Create or load benchmark.yaml to define the benchmark."
          variant="hero"
          size="sm"
        />
      </div>
    );
  }

  const spec = specDocument.spec;
  const engine = spec.benchmark.engine;
  const environment = engineEnvironmentConfig(engine);
  const environmentSummary = environment?.dockerfile ?? "Not declared";
  const resolvedEngineSourcePath = engineResolvePath(engine);
  const benchmarkYamlSource = sourceYamlFileFromDocument(specDocument, "benchmark.yaml");

  return (
    <div
      className={cn(
        "min-w-0 max-w-[calc(100vw-2rem)] sm:max-w-full",
        activeTab === "files"
          ? "flex h-full min-h-0 flex-col gap-6 overflow-hidden"
          : "grid gap-6",
      )}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 className="text-lg font-semibold text-foreground break-words [overflow-wrap:anywhere]">
            {spec.benchmark.name}
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground break-words [overflow-wrap:anywhere]">
            {spec.benchmark.description}
          </p>
          <BenchmarkFingerprintSelector
            options={benchmarkFingerprintOptions}
            value={selectedBenchmarkFingerprint}
            currentBenchmarkFingerprint={currentBenchmarkFingerprint}
            onValueChange={onBenchmarkFingerprintChange}
          />
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 sm:justify-end">
          {actions}
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => onActiveTabChange(value as BenchmarkSurfaceTab)}
        className={cn(
          "min-w-0 gap-5",
          activeTab === "files" ? "min-h-0 flex-1" : undefined,
        )}
      >
        <TabsList variant="line" aria-label="Benchmark views">
          <TabsTrigger value="processed">
            <InfoIcon data-icon="inline-start" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="manifest">
            <FileCode2Icon data-icon="inline-start" />
            Manifest
          </TabsTrigger>
          <TabsTrigger value="files">
            <FolderOpenIcon data-icon="inline-start" />
            Files
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="processed"
          className={cn(
            "min-w-0",
            activeTab === "processed" ? undefined : "min-h-0 overflow-y-auto",
          )}
        >
          <div className="grid min-w-0 gap-6">
            <SurfaceSection title="Benchmark">
              <Accordion type="multiple">
                <DetailAccordionSection
                  value="environment"
                  title="Environment"
                  summary={environmentSummary}
                >
                  {environment ? (
                    <>
                      <div className="grid gap-3 md:grid-cols-2">
                        <BenchmarkField label="Dockerfile" value={environment.dockerfile} mono />
                        <BenchmarkField label="Network" value={formatNetworkConfig(environment.network)} mono />
                      </div>
                      {environment.resources ? (
                        <StructuredValueView value={environment.resources} />
                      ) : null}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No environment settings were declared in this manifest.
                    </p>
                  )}
                </DetailAccordionSection>

                <DetailAccordionSection
                  value="eval-cases"
                  title="Engine Cases"
                  summary={formatCount(specDocument.cases.length, "case")}
                  data-testid="benchmark-engine-cases-card"
                >
                  <BenchmarkPlainStringList
                    title="Resolved Engine Source"
                    values={resolvedEngineSourcePath ? [resolvedEngineSourcePath] : []}
                  />
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Case</TableHead>
                          <TableHead>Split</TableHead>
                          <TableHead className="text-right">Files</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {specDocument.cases.map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell className="font-medium">{entry.name}</TableCell>
                            <TableCell className="text-muted-foreground">{entry.split ?? "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{entry.fileCount}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </DetailAccordionSection>

                <DetailAccordionSection
                  value="eval-engine"
                  title="Engine"
                  summary={formatUseBlockSummary(engine)}
                >
                  <StructuredValueView value={engine} />
                </DetailAccordionSection>

              </Accordion>
            </SurfaceSection>
          </div>
        </TabsContent>
        <TabsContent value="manifest" className="min-w-0">
          <SourceYamlSection
            title="Benchmark Manifest"
            description="The benchmark manifest defines the engine, cases, and source files."
            source={benchmarkYamlSource}
            testId="benchmark-yaml-source"
          />
        </TabsContent>
        <TabsContent value="files" className="min-h-0 min-w-0">
          <SurfaceSection
            title="Engine Case Files"
            icon={FolderOpenIcon}
            description="Public, private, and source files exposed by the engine."
            className="flex h-full min-h-0 flex-col"
          >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <FilesBrowser
                changes={orderCandidateFiles(sourceFilesState.files)}
                selectedFilePath={selectedSourceFilePath}
                browseMode="folders"
                currentDirectory={sourceDirectoryPath}
                previewMode={sourcePreviewMode}
                availablePreviewModes={supportedPreviewModes()}
                preview={sourcePreviewState.preview}
                changesError={sourceFilesState.error}
                previewError={sourcePreviewState.error}
                isChangesLoading={sourceFilesState.loading}
                isPreviewLoading={sourcePreviewState.loading}
                layout={prefersStackedFilesLayout ? "stacked" : "split"}
                emptyMessage="No engine case files are available for this benchmark."
                emptySelectionMessage="Select an engine case file to preview."
                listErrorMessage="Couldn't load the engine case file list."
                previewErrorMessage="Couldn't load the engine case file preview."
                onSelectFile={onSelectSourceFile}
                onDirectoryChange={onSourceDirectoryChange}
                onPreviewModeChange={(mode) => onSourcePreviewModeChange(mode as CandidatePreviewMode)}
              />
            </div>
          </SurfaceSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BenchmarkField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </span>
      <span className={cn(
        "text-sm whitespace-normal break-words [overflow-wrap:anywhere]",
        mono ? "font-mono text-xs" : "",
      )}
      >
        {value}
      </span>
    </div>
  );
}

function SourceYamlSection({
  title,
  description,
  source,
  loading = false,
  error = null,
  testId,
}: {
  title: string;
  description: string;
  source: SourceYamlFile | null;
  loading?: boolean;
  error?: string | null;
  testId: string;
}) {
  return (
    <SurfaceSection title={title} icon={FileCode2Icon} description={description}>
      {loading ? (
        <SourceYamlSkeleton />
      ) : error ? (
        <PaneErrorState
          message={error}
          title="Couldn't load manifest source"
        />
      ) : source ? (
        <div className="grid min-w-0 gap-2">
          <div className="flex min-w-0 flex-wrap gap-2">
            <Badge
              variant="outline"
              className="min-w-0 max-w-full whitespace-normal break-words font-mono [overflow-wrap:anywhere]"
            >
              {source.path}
            </Badge>
          </div>
          <CodeBlockSurface
            value={source.content}
            language="yaml"
            ariaLabel={title}
            testId={testId}
          />
        </div>
      ) : (
        <EmptyState
          icon={FileCode2Icon}
          message="No manifest source was recorded."
          size="sm"
        />
      )}
    </SurfaceSection>
  );
}

function BenchmarkPlainStringList({
  title,
  values,
}: {
  title: string;
  values: string[];
}) {
  if (values.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium uppercase text-muted-foreground">
        {title}
      </span>
      <div className="grid gap-1">
        {values.map((value) => (
          <span
            key={value}
            className="font-mono text-xs whitespace-normal break-words [overflow-wrap:anywhere]"
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function StructuredValueView({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  if (isDisplayScalar(value)) {
    return (
      <span className="font-mono text-xs whitespace-normal break-words [overflow-wrap:anywhere]">
        {String(value)}
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-sm text-muted-foreground">none</span>;
    }
    if (value.every(isDisplayScalar)) {
      return (
        <div className="flex flex-wrap gap-2">
          {value.map((entry, index) => (
            <Badge key={`${String(entry)}-${index}`} variant="outline" className="font-mono text-[11px]">
              {String(entry)}
            </Badge>
          ))}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        {value.map((entry, index) => (
          <div key={index} className="border-l border-border pl-3">
            <StructuredValueView value={entry} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  if (!value || typeof value !== "object") {
    return <span className="text-sm text-muted-foreground">none</span>;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return <span className="text-sm text-muted-foreground">none</span>;
  }

  return (
    <div className={cn("min-w-0", depth > 0 ? "border-l border-border pl-3" : "")}>
      <Table className="text-xs">
        <TableBody>
          {entries.map(([key, entry]) => (
            <TableRow key={key}>
              <TableCell className="w-0 py-1.5 pr-3 pl-0 align-top font-mono text-xs text-muted-foreground whitespace-nowrap">
                {key}
              </TableCell>
              <TableCell className="min-w-0 py-1.5 pr-0 pl-0 align-top whitespace-normal">
                <StructuredValueView value={entry} depth={depth + 1} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type BenchmarkUseBlock = Record<string, unknown> & { use: string };

function engineEnvironmentConfig(engine: unknown): {
  dockerfile: string;
  network?: unknown;
  resources?: unknown;
} | null {
  const block = normalizeBenchmarkUseBlock(engine);
  const config = useBlockConfig(block);
  const environment = config.environment &&
    typeof config.environment === "object" &&
    !Array.isArray(config.environment)
    ? config.environment as Record<string, unknown>
    : null;
  if (!environment || typeof environment.dockerfile !== "string" || environment.dockerfile.length === 0) {
    return null;
  }
  return {
    dockerfile: environment.dockerfile,
    ...(environment.network !== undefined ? { network: environment.network } : {}),
    ...(environment.resources !== undefined ? { resources: environment.resources } : {}),
  };
}

function engineResolvePath(value: unknown): string | null {
  const config = useBlockConfig(value);
  return typeof config.path === "string" && config.path.length > 0
    ? config.path
    : null;
}

function formatUseBlockSummary(value: unknown): string {
  const block = normalizeBenchmarkUseBlock(value);
  if (!block) {
    return "configured";
  }
  const config = useBlockConfig(block);
  const preferredFields = ["provider", "model", "effort", "metric", "direction", "run"];
  const excludedFields = new Set(["use", "task", "instructions", "prompt", "description"]);
  const preferred = preferredFields
    .map((key) => config[key] ?? block[key])
    .flatMap(summaryScalarParts);
  const extras = Object.entries({ ...config, ...block })
    .filter(([key, value]) =>
      !excludedFields.has(key) &&
      !preferredFields.includes(key) &&
      summaryScalarParts(value).length > 0)
    .slice(0, 3)
    .map(([key, value]) => `${key} ${String(value)}`);
  const fields = [...preferred, ...extras];
  if (fields.length === 0) {
    return block.use;
  }
  return [block.use, ...fields].join(" · ");
}

function summaryScalarParts(value: unknown): string[] {
  if (!isDisplayScalar(value)) {
    return [];
  }
  const text = String(value).trim();
  return text.length > 0 && text.length <= 48 ? [text] : [];
}

function normalizeBenchmarkUseBlock(value: unknown): BenchmarkUseBlock | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return typeof record.use === "string" && record.use.length > 0
    ? record as BenchmarkUseBlock
    : null;
}

function useBlockConfig(value: unknown): Record<string, unknown> {
  const block = normalizeBenchmarkUseBlock(value);
  if (!block || !block.with || typeof block.with !== "object" || Array.isArray(block.with)) {
    return {};
  }
  return block.with as Record<string, unknown>;
}

function formatNetworkConfig(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "open";
  }
  const egress = (value as Record<string, unknown>).egress;
  return typeof egress === "string" && egress.length > 0 ? egress : "open";
}

function isDisplayScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function BenchmarkFingerprintSelector({
  options,
  value,
  currentBenchmarkFingerprint,
  onValueChange,
}: {
  options: BenchmarkFingerprintOption[];
  value: string | null;
  currentBenchmarkFingerprint: string | null;
  onValueChange: (fingerprint: string | null) => void;
}) {
  if (options.length <= 1 || !value) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase text-muted-foreground">Benchmark version</span>
      <Select value={value} onValueChange={(next) => onValueChange(next || null)}>
        <SelectTrigger size="sm" className="max-w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.fingerprint} value={option.fingerprint}>
                {shortDigest(option.fingerprint)}
                {option.fingerprint === currentBenchmarkFingerprint ? " · current" : ""}
                {" · "}
                {formatCount(option.candidateCount, "candidate")}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function CandidatesIndexSurface({
  snapshot,
  snapshotError,
  snapshotLoading,
  currentBenchmarkSummaries,
  currentBenchmarkEvaluations,
  currentBenchmarkRuns,
  candidateStateById,
  selectedCandidateId,
  view,
  onViewChange,
  onSelectCandidate,
}: {
  snapshot: BenchmarkSnapshot | null;
  snapshotError: string | null;
  snapshotLoading: boolean;
  currentBenchmarkSummaries: CandidateSummary[];
  currentBenchmarkEvaluations: EvaluationSummary[];
  currentBenchmarkRuns: RunSummary[];
  candidateStateById: ReadonlyMap<string, CandidateRuntimeState>;
  selectedCandidateId: string | null;
  view: "archive" | "lineage";
  onViewChange: (view: "archive" | "lineage") => void;
  onSelectCandidate: (candidateId: string) => void;
}) {
  const candidateFilterOptions = useMemo(
    () => currentBenchmarkSummaries
      .map((summary): CandidateFilterOption => ({
        id: summary.id,
        label: formatCandidateDisplayName(summary),
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    [currentBenchmarkSummaries],
  );
  const allCandidateIds = useMemo(
    () => candidateFilterOptions.map((option) => option.id),
    [candidateFilterOptions],
  );
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string> | null>(null);
  const selectedCandidateIdSet = useMemo(() => {
    if (selectedCandidateIds === null) {
      return new Set(allCandidateIds);
    }

    const availableCandidateIds = new Set(allCandidateIds);
    return new Set(
      [...selectedCandidateIds].filter((candidateId) => availableCandidateIds.has(candidateId)),
    );
  }, [allCandidateIds, selectedCandidateIds]);
  const filteredCandidateSummaries = useMemo(
    () => selectedCandidateIdSet.size === candidateFilterOptions.length
      ? currentBenchmarkSummaries
      : currentBenchmarkSummaries.filter((summary) => selectedCandidateIdSet.has(summary.id)),
    [currentBenchmarkSummaries, selectedCandidateIdSet, candidateFilterOptions.length],
  );
  const filteredEvaluations = useMemo(
    () => selectedCandidateIdSet.size === candidateFilterOptions.length
      ? currentBenchmarkEvaluations
      : currentBenchmarkEvaluations.filter((evaluation) => selectedCandidateIdSet.has(evaluation.candidateId)),
    [currentBenchmarkEvaluations, selectedCandidateIdSet, candidateFilterOptions.length],
  );
  const scopedActiveId =
    snapshot?.activeId && filteredCandidateSummaries.some((summary) => summary.id === snapshot.activeId)
      ? snapshot.activeId
      : null;
  const scopedSnapshot = useMemo(
    () => snapshot
      ? {
          ...snapshot,
          activeId: scopedActiveId,
          currentBenchmarkFingerprint:
            filteredCandidateSummaries[0]?.benchmarkFingerprint ??
            filteredEvaluations[0]?.benchmarkFingerprint ??
            currentBenchmarkRuns[0]?.benchmarkFingerprint ??
            null,
          summaries: filteredCandidateSummaries,
          evaluations: filteredEvaluations,
          runs: currentBenchmarkRuns,
        }
      : null,
    [
      currentBenchmarkRuns,
      filteredEvaluations,
      filteredCandidateSummaries,
      scopedActiveId,
      snapshot,
    ],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4">
      <Tabs
        value={view}
        onValueChange={(nextValue) => {
          if (nextValue === "archive" || nextValue === "lineage") {
            onViewChange(nextValue);
          }
        }}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-4"
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <TabsList variant="line" aria-label="Candidate index views" className="min-w-0">
            <TabsTrigger value="archive">
              <FolderOpenIcon data-icon="inline-start" />
              Archive
            </TabsTrigger>
            <TabsTrigger value="lineage">
              <GitBranchIcon data-icon="inline-start" />
              Lineage
            </TabsTrigger>
          </TabsList>
          {candidateFilterOptions.length > 1 ? (
            <CandidateComparisonFilter
              options={candidateFilterOptions}
              selectedCandidateIds={selectedCandidateIdSet}
              testId="candidates-candidate-filter"
              onSelectAll={() => setSelectedCandidateIds(null)}
              onClear={() => setSelectedCandidateIds(new Set())}
              onToggleCandidate={(candidateId, checked) => {
                setSelectedCandidateIds((current) => {
                  const next = new Set(
                    current === null ? allCandidateIds : [...current],
                  );
                  if (checked) {
                    next.add(candidateId);
                  } else {
                    next.delete(candidateId);
                  }
                  return next.size === allCandidateIds.length ? null : next;
                });
              }}
            />
          ) : null}
        </div>

        <TabsContent
          value="archive"
          className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <ScrollableObjectSurface>
            <CandidatesArchiveSurface
              summaries={filteredCandidateSummaries}
              evaluations={filteredEvaluations}
              candidateStateById={candidateStateById}
              activeId={scopedActiveId}
              snapshotError={snapshotError}
              loading={snapshotLoading}
              selectedCandidateId={selectedCandidateId}
              onSelectCandidate={onSelectCandidate}
            />
          </ScrollableObjectSurface>
        </TabsContent>

        <TabsContent
          value="lineage"
          className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col p-1">
            <CandidatesLineageSurface
              snapshot={scopedSnapshot}
              snapshotError={snapshotError}
              loading={snapshotLoading}
              selectedCandidateId={selectedCandidateId}
              onSelectCandidate={onSelectCandidate}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CandidatesArchiveSurface({
  summaries,
  evaluations,
  candidateStateById,
  activeId,
  snapshotError,
  loading,
  selectedCandidateId,
  onSelectCandidate,
}: {
  summaries: CandidateSummary[];
  evaluations: EvaluationSummary[];
  candidateStateById: ReadonlyMap<string, CandidateRuntimeState>;
  activeId: string | null;
  snapshotError: string | null;
  loading: boolean;
  selectedCandidateId: string | null;
  onSelectCandidate: (candidateId: string) => void;
}) {
  if (snapshotError) {
    return (
      <PaneErrorState message={snapshotError} />
    );
  }

  if (loading) {
    return <CandidateArchiveSkeleton />;
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <CandidateList
        summaries={summaries}
        evaluations={evaluations}
        candidateStateById={candidateStateById}
        activeId={activeId}
        selectedId={selectedCandidateId}
        onSelect={onSelectCandidate}
      />
    </div>
  );
}

function CandidatesLineageSurface({
  snapshot,
  snapshotError,
  loading,
  selectedCandidateId,
  onSelectCandidate,
}: {
  snapshot: BenchmarkSnapshot | null;
  snapshotError: string | null;
  loading: boolean;
  selectedCandidateId: string | null;
  onSelectCandidate: (candidateId: string) => void;
}) {
  if (snapshotError) {
    return (
      <PaneErrorState message={snapshotError} />
    );
  }

  if (loading) {
    return <LineageSurfaceSkeleton />;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <LineageGraph
        snapshot={snapshot}
        selectedCandidateId={selectedCandidateId}
        onSelectCandidate={onSelectCandidate}
      />
    </div>
  );
}

function ScrollableObjectSurface({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-1">
      <div
        className={cn(
          "grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function CandidateYamlSurface({
  snapshotError,
  snapshotLoading,
  selectedCandidateSummary,
  recordState,
}: {
  snapshotError: string | null;
  snapshotLoading: boolean;
  selectedCandidateSummary: CandidateSummary | null;
  recordState: CandidateRecordState;
}) {
  if (snapshotError) {
    return (
      <PaneErrorState message={snapshotError} />
    );
  }

  if (snapshotLoading) {
    return <CandidateManifestSkeleton />;
  }

  if (!selectedCandidateSummary) {
    return (
      <EmptyState
        icon={FileCode2Icon}
        title="No candidate selected"
        message="Select a candidate from Candidates or Lineage to inspect its manifest."
        variant="hero"
        size="sm"
      />
    );
  }

  return (
    <SourceYamlSection
      title="Candidate Manifest"
      description="The candidate manifest defines files, runs, and improvement."
      source={sourceYamlFileFromCandidateRecord(recordState.record)}
      loading={recordState.loading}
      error={recordState.error}
      testId="candidate-yaml-source"
    />
  );
}

function CandidateFilesSurface({
  snapshotError,
  snapshotLoading,
  selectedCandidateSummary,
  candidateFilesState,
  selectedCandidateFilePath,
  candidatePreviewMode,
  candidateDirectoryPath,
  candidatePreviewState,
  onSelectCandidateFile,
  onCandidateDirectoryChange,
  onCandidatePreviewModeChange,
}: {
  snapshotError: string | null;
  snapshotLoading: boolean;
  selectedCandidateSummary: CandidateSummary | null;
  candidateFilesState: CandidateFilesState;
  selectedCandidateFilePath: string | null;
  candidatePreviewMode: CandidatePreviewMode;
  candidateDirectoryPath: string | null;
  candidatePreviewState: CandidatePreviewState;
  onSelectCandidateFile: (filePath: string) => void;
  onCandidateDirectoryChange: (directoryPath: string | null) => void;
  onCandidatePreviewModeChange: (mode: CandidatePreviewMode) => void;
}) {
  const prefersStackedFilesLayout = useMediaQuery("(max-width: 900px)");

  if (snapshotError) {
    return (
      <PaneErrorState message={snapshotError} />
    );
  }

  if (snapshotLoading) {
    return <CandidateFilesSurfaceSkeleton />;
  }

  if (!selectedCandidateSummary) {
    return (
      <EmptyState
        icon={FolderOpenIcon}
        title="No candidate selected"
        message="Select a candidate from Candidates or Lineage to inspect its files."
        variant="hero"
        size="sm"
      />
    );
  }

  const emptyMessage = "No candidate files are available for this candidate.";

  return (
    <SurfaceSection
      title="Candidate Files"
      icon={FolderOpenIcon}
      description="Files that make up this candidate version."
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex flex-wrap gap-2">
        <StatusBadge status={selectedCandidateSummary.status} active={false} />
        <Badge variant="outline">digest {shortFingerprint(selectedCandidateSummary.candidateFingerprint)}</Badge>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <FilesBrowser
          changes={orderCandidateFiles(candidateFilesState.files)}
          selectedFilePath={selectedCandidateFilePath}
          browseMode="folders"
          currentDirectory={candidateDirectoryPath}
          previewMode={candidatePreviewMode}
          availablePreviewModes={supportedPreviewModes()}
          preview={candidatePreviewState.preview}
          changesError={candidateFilesState.error}
          previewError={candidatePreviewState.error}
          isChangesLoading={candidateFilesState.loading}
          isPreviewLoading={candidatePreviewState.loading}
          layout={prefersStackedFilesLayout ? "stacked" : "split"}
          emptyMessage={emptyMessage}
          emptySelectionMessage="Select a mounted candidate file to preview."
          listErrorMessage="Couldn't load the mounted candidate file list."
          previewErrorMessage="Couldn't load the mounted candidate file preview."
          onSelectFile={onSelectCandidateFile}
          onDirectoryChange={onCandidateDirectoryChange}
          onPreviewModeChange={(mode) => onCandidatePreviewModeChange(mode as CandidatePreviewMode)}
        />
      </div>
    </SurfaceSection>
  );
}

function useExecutionTrace(
  apiPath: (pathname: string) => string,
  runId: string | null,
  jobId: string | null,
): TraceDetailState {
  const [state, setState] = useState<TraceDetailState>({
    loading: false,
    error: null,
    detail: null,
  });

  useEffect(() => {
    if (!runId || !jobId) {
      setState({
        loading: false,
        error: null,
        detail: null,
      });
      return;
    }

    let cancelled = false;
    let inFlightController: AbortController | null = null;
    const params = new URLSearchParams({ run: runId, job: jobId });

    async function loadTrace() {
      if (inFlightController) {
        return;
      }
      const controller = new AbortController();
      inFlightController = controller;
      setState((current) => ({
        loading: true,
        error: null,
        detail: current.detail?.runId === runId ? current.detail : null,
      }));
      try {
        const detail = await requestJson<WorkbenchExecutionTraceDetail>(
          apiPath(`/api/traces?${params.toString()}`),
          { signal: controller.signal },
        );
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setState({
            loading: false,
            error: null,
            detail,
          });
        });
      } catch (error) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        setState((current) => ({
          loading: false,
          error: toMessage(error),
          detail: current.detail?.runId === runId ? current.detail : null,
        }));
      } finally {
        if (inFlightController === controller) {
          inFlightController = null;
        }
      }
    }

    void loadTrace();

    return () => {
      cancelled = true;
      inFlightController?.abort();
    };
  }, [apiPath, runId, jobId]);

  return state;
}

function useCaseReview(
  apiPath: (pathname: string) => string,
  candidateId: string | null,
  runId: string | null,
  caseId: string | null,
): CaseReviewDetailState {
  const [state, setState] = useState<CaseReviewDetailState>({
    loading: false,
    error: null,
    review: null,
    requestKey: null,
  });

  useEffect(() => {
    if (!candidateId || !runId || !caseId) {
      setState({
        loading: false,
        error: null,
        review: null,
        requestKey: null,
      });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const nextCandidateId = candidateId;
    const nextRunId = runId;
    const nextCaseId = caseId;
    const nextRequestKey = `${nextCandidateId}\0${nextRunId}\0${nextCaseId}`;
    setState((current) => ({
      loading: true,
      error: null,
      review: current.requestKey === nextRequestKey
        ? current.review
        : null,
      requestKey: nextRequestKey,
    }));

    async function loadReview() {
      try {
        const review = await requestJson<CandidateCaseReview>(
          apiPath(`/api/case-review?id=${encodeURIComponent(nextCandidateId)}&run=${encodeURIComponent(nextRunId)}&case=${encodeURIComponent(nextCaseId)}`),
          { signal: controller.signal },
        );
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setState({
            loading: false,
            error: null,
            review,
            requestKey: nextRequestKey,
          });
        });
      } catch (error) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        setState({
          loading: false,
          error: toMessage(error),
          review: null,
          requestKey: nextRequestKey,
        });
      }
    }

    void loadReview();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiPath, caseId, runId, candidateId]);

  return state;
}

function CandidateOverviewSurface({
  snapshot,
  snapshotError,
  snapshotLoading,
  selectedCandidateSummary,
  selectedCandidateRuntimeState,
  evaluations,
  onOpenEvaluation,
}: {
  snapshot: BenchmarkSnapshot | null;
  snapshotError: string | null;
  snapshotLoading: boolean;
  selectedCandidateSummary: CandidateSummary | null;
  selectedCandidateRuntimeState: CandidateRuntimeState | null;
  evaluations: EvaluationSummary[];
  onOpenEvaluation: (evaluationId: string) => void;
}) {
  if (snapshotError) {
    return (
      <PaneErrorState message={snapshotError} />
    );
  }

  if (snapshotLoading) {
    return <CandidateOverviewSkeleton />;
  }

  if (!snapshot || snapshot.summaries.length === 0 || !selectedCandidateSummary) {
    return (
      <EmptyState
        icon={InfoIcon}
        title="No candidate selected"
        message="Select or create a candidate to inspect its overview."
        variant="hero"
        size="sm"
      />
    );
  }

  const candidateEvaluations = orderEvaluationSummaries(
    evaluations.filter((evaluation) => evaluation.candidateId === selectedCandidateSummary.id),
  );
  const rollup = buildCandidateEvaluationRollup(
    selectedCandidateSummary.id,
    candidateEvaluations,
  );
  const rollupDisplay = resolveCandidateEvaluationRollupDisplay(rollup);

  return (
    <div className="grid gap-6">
      <section className="grid min-w-0 gap-3">
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr))]">
          <FactItem title="Created" value={formatTimestamp(selectedCandidateSummary.createdAt)} />
          <FactItem
            title="Version"
            value={formatCandidateVersionLabel(selectedCandidateSummary) ?? "—"}
          />
          <FactItem
            title="Run state"
            value={selectedCandidateRuntimeState?.label ?? "No runs"}
          />
          <FactItem
            title="Optimize on"
            value={selectedCandidateRuntimeState?.latestRun?.optimizeOn ?? "—"}
          />
          <FactItem
            title="Select winner by"
            value={selectedCandidateRuntimeState?.latestRun?.selectBy ?? "—"}
          />
          <FactItem title="Best score" value={rollup.bestScore === null ? "—" : formatMetricValue(rollup.bestScore)} />
          <FactItem
            title="Best configuration"
            value={rollup.bestConfigurationLabel ?? "—"}
          />
          <FactItem title="Mean score" value={rollup.meanScore === null ? "—" : formatMetricValue(rollup.meanScore)} />
          <FactItem
            title="Evaluations"
            value={rollupDisplay.countText}
          />
        </div>

      </section>

      <SurfaceSection title="Evaluations" icon={ChartColumnIcon}>
        {candidateEvaluations.length > 0 ? (
          <EvaluationSummaryTable
            evaluations={candidateEvaluations}
            showCandidate={false}
            onSelectEvaluation={onOpenEvaluation}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No evaluations are recorded for this candidate yet.</p>
        )}
      </SurfaceSection>
    </div>
  );
}

function EvaluationSummaryTable({
  evaluations,
  showCandidate,
  onSelectEvaluation,
}: {
  evaluations: EvaluationSummary[];
  showCandidate: boolean;
  onSelectEvaluation: (evaluationId: string) => void;
}) {
  return (
    <Card size="sm">
      <CardContent className="py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{showCandidate ? "Candidate" : "Configuration"}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Samples</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evaluations.map((evaluation) => {
                const score = readEvaluationScore(evaluation);
                return (
                  <TableRow
                    key={evaluation.id}
                    aria-label={`Open ${formatEvaluationDisplayName(evaluation)}`}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={() => onSelectEvaluation(evaluation.id)}
                    onKeyDown={(event) => {
                      if (isKeyboardActivation(event)) {
                        event.preventDefault();
                        onSelectEvaluation(evaluation.id);
                      }
                    }}
                  >
                    <TableCell className="font-medium">
                      {showCandidate
                        ? formatCandidateDisplayName(evaluation)
                        : formatEvaluationDisplayName(evaluation)}
                    </TableCell>
                    <TableCell>{statusLabel(evaluation.status)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {score !== null ? formatMetricValue(score) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {evaluation.completedSampleCount}/{evaluation.sampleCount}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function CaseAttemptTable({
  executions,
  apiPath,
}: {
  executions: CandidateCaseExecution[];
  apiPath: (pathname: string) => string;
}) {
  const rows = executions.flatMap((execution, executionIndex) =>
    execution.jobIds.map((jobId, jobIndex) => ({
      id: `${execution.runId}:${execution.kind}:${execution.sampleIndex ?? "current"}:${jobId}`,
      execution,
      jobId,
      label: execution.jobIds.length > 1
        ? `${formatExecutionKindLabel(execution.kind)} ${executionIndex + 1}.${jobIndex + 1}`
        : `${formatExecutionKindLabel(execution.kind)} ${executionIndex + 1}`,
    }))
  );

  return (
    <div className="grid min-w-0 gap-4">
      {rows.map((row) => (
        <section key={row.id} className="grid min-w-0 gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-foreground">{row.label}</span>
            <span className="text-muted-foreground">{formatOperationalStatus(row.execution.status)}</span>
            <span className="text-muted-foreground">
              {typeof row.execution.sampleIndex === "number"
                ? `sample ${row.execution.sampleIndex + 1}`
                : "sample not recorded"}
            </span>
            <span className="text-muted-foreground">
              {formatOptionalDuration(
                typeof row.execution.durationMs === "number" ? row.execution.durationMs : null,
              )}
            </span>
          </div>
          <AttemptTraceLoader
            apiPath={apiPath}
            runId={row.execution.runId}
            jobId={row.jobId}
          />
        </section>
      ))}
    </div>
  );
}

function AttemptTraceLoader({
  apiPath,
  runId,
  jobId,
}: {
  apiPath: (pathname: string) => string;
  runId: string;
  jobId: string;
}) {
  const traceState = useExecutionTrace(apiPath, runId, jobId);
  return (
    <AttemptTraceContent
      jobId={jobId}
      traceState={traceState}
    />
  );
}

function AttemptTraceContent({
  jobId,
  traceState,
}: {
  jobId: string;
  traceState: TraceDetailState;
}) {
  const traceExecution = useMemo(
    () => (traceState.detail?.executions ?? []).find((execution) => execution.jobIds.includes(jobId)) ?? null,
    [jobId, traceState.detail?.executions],
  );
  const traceSessions = useMemo(
    () => resolveTraceSessionsForJob(traceExecution, jobId),
    [jobId, traceExecution],
  );

  if (traceState.loading && !traceExecution) {
    return <ExecutionTraceSkeleton />;
  }

  if (traceState.error) {
    return (
      <PaneErrorState
        message={traceState.error}
        title="Couldn't load execution trace"
      />
    );
  }

  if (!traceExecution) {
    return (
      <EmptyState
        icon={ActivityIcon}
        title="No execution trace"
        message="No trace events were recorded for this attempt."
        size="sm"
      />
    );
  }

  if (traceSessions.length === 0 && traceExecution.trace.events.length === 0 && traceExecution.trace.spans.length === 0) {
    return (
      <EmptyState
        icon={ActivityIcon}
        title="No execution trace"
        message="No trace events were recorded for this attempt."
        size="sm"
      />
    );
  }

  return (
    <Accordion
      key={`${jobId}:${traceSessions.map((session) => session.id).join("|")}`}
      type="multiple"
      className="gap-2"
    >
      {traceSessions.length > 0 ? (
        traceSessions.map((session) => (
          <TraceSessionAccordionItem key={session.id} session={session} />
        ))
      ) : (
        <TraceTimelineAccordionItem
          value={`${jobId}:execution`}
          title="Execution"
          trace={traceExecution.trace as ExecutionTrace}
        />
      )}
    </Accordion>
  );
}

function TraceSessionAccordionItem({
  session,
}: {
  session: TraceSessionView;
}) {
  const timeline = useMemo(
    () => buildExecutionTraceTimeline({ trace: session.trace as ExecutionTrace }),
    [session.trace],
  );

  return (
    <TraceTimelineAccordionSection
      value={session.id}
      title={session.label}
      trace={session.trace as ExecutionTrace}
      timeline={timeline}
    />
  );
}

function TraceTimelineAccordionItem({
  trace,
  title,
  value,
}: {
  trace: ExecutionTrace;
  title: string;
  value: string;
}) {
  const timeline = useMemo(
    () => buildExecutionTraceTimeline({ trace }),
    [trace],
  );
  return (
    <TraceTimelineAccordionSection
      value={value}
      title={title}
      trace={trace}
      timeline={timeline}
    />
  );
}

function TraceTimelineAccordionSection({
  trace,
  timeline,
  title,
  value,
}: {
  trace: ExecutionTrace;
  timeline: ReturnType<typeof buildExecutionTraceTimeline>;
  title: string;
  value: string;
}) {
  const summary = formatCount(trace.events.length, "event");
  return (
    <DetailAccordionSection
      value={value}
      title={title}
      summary={summary}
      contentClassName="h-auto pb-3"
      bordered
    >
      <ExecutionTraceTimeline executionTimeline={timeline} layout="content" />
    </DetailAccordionSection>
  );
}

function isKeyboardActivation(event: KeyboardEvent): boolean {
  return event.key === "Enter" || event.key === " ";
}

function EvaluationDetailDialog({
  open,
  evaluationId,
  evaluationSummary,
  state,
  selectedCaseId,
  caseReviewState,
  onClose,
  onSelectCase,
  apiPath,
}: {
  open: boolean;
  evaluationId: string;
  evaluationSummary: EvaluationSummary | null;
  state: EvaluationRecordsState;
  selectedCaseId: string | null;
  caseReviewState: CaseReviewDetailState;
  onClose: () => void;
  onSelectCase: (caseId: string | null) => void;
  apiPath: (pathname: string) => string;
}) {
  const scorecard = evaluationId
    ? state.records.find((record) => record.id === evaluationId) ?? null
    : null;
  const summary = scorecard ?? evaluationSummary;
  const score = summary ? readEvaluationScore(summary) : null;
  const title = "Evaluation";
  const description = summary
    ? [
        statusLabel(summary.status),
        score !== null ? `score ${formatMetricValue(score)}` : null,
        `${summary.completedSampleCount}/${summary.sampleCount} samples`,
      ].filter((part): part is string => Boolean(part)).join(" · ")
    : "Evaluation details";

  return (
    <InspectorDialogShell
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      title={title}
      description={description}
      className="h-[min(94vh,calc(100dvh-1rem))]"
      bodyClassName="overflow-y-auto"
      testId="context-evaluation-dialog"
      bodyTestId="context-evaluation-dialog-body"
    >
      <EvaluationDetailSurface
        evaluationId={evaluationId}
        evaluationSummary={evaluationSummary}
        state={state}
        selectedCaseId={selectedCaseId}
        caseReviewState={caseReviewState}
        onSelectCase={onSelectCase}
        apiPath={apiPath}
      />
    </InspectorDialogShell>
  );
}

function EvaluationDetailSurface({
  evaluationId,
  evaluationSummary,
  state,
  selectedCaseId,
  caseReviewState,
  onSelectCase,
  apiPath,
}: {
  evaluationId: string;
  evaluationSummary: EvaluationSummary | null;
  state: EvaluationRecordsState;
  selectedCaseId: string | null;
  caseReviewState: CaseReviewDetailState;
  onSelectCase: (caseId: string | null) => void;
  apiPath: (pathname: string) => string;
}) {
  const scorecard = evaluationId
    ? state.records.find((record) => record.id === evaluationId) ?? null
    : null;
  const summary = scorecard ?? evaluationSummary;
  const score = summary ? readEvaluationScore(summary) : null;
  const cases = scorecard ? resolveScorecardCaseRows(scorecard) : [];

  if (state.loading && !scorecard) {
    return <EvaluationDetailSurfaceSkeleton />;
  }

  if (state.error) {
    return (
      <PaneErrorState
        message={state.error}
        title="Couldn't load evaluation"
      />
    );
  }

  if (!summary) {
    return (
      <EmptyState
        icon={ChartColumnIcon}
        title="Evaluation not found"
        message="The selected scorecard is not available for this benchmark."
        variant="hero"
        size="sm"
      />
    );
  }

  const content = (
    <>
      <section className="grid min-w-0 gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{statusLabel(summary.status)}</Badge>
          <Badge variant="outline">{formatCount(summary.completedSampleCount, "completed sample")}</Badge>
          {summary.errorSampleCount > 0 ? (
            <Badge variant="destructive">{formatCount(summary.errorSampleCount, "error sample")}</Badge>
          ) : null}
        </div>
        <FactGrid>
          <FactItem title="Updated" value={formatTimestamp(summary.updatedAt)} />
          <FactItem title="Samples" value={`${summary.completedSampleCount}/${summary.sampleCount}`} />
          <FactItem
            title="Score"
            value={score !== null ? formatMetricValue(score) : "not recorded"}
          />
        </FactGrid>
      </section>

      <SurfaceSection title="Cases" icon={ListChecksIcon}>
        {scorecard && cases.length > 0 ? (
          <EvaluationCasesTable
            cases={cases}
            selectedCaseId={selectedCaseId}
            onSelectCase={onSelectCase}
            renderSelectedCase={() =>
              selectedCaseId ? (
                <EvaluationCaseDetailSurface
                  apiPath={apiPath}
                  caseId={selectedCaseId}
                  state={caseReviewState}
                />
              ) : null
            }
          />
        ) : scorecard ? (
          <p className="text-sm text-muted-foreground">No case-level results were recorded for this evaluation.</p>
        ) : (
          <EvaluationCaseRowsSkeleton showBadges={false} />
        )}
      </SurfaceSection>
    </>
  );

  return <div className="grid min-w-0 gap-6">{content}</div>;
}

function EvaluationCasesTable({
  cases,
  selectedCaseId,
  onSelectCase,
  renderSelectedCase,
}: {
  cases: EvaluationCaseRow[];
  selectedCaseId: string | null;
  onSelectCase: (caseId: string | null) => void;
  renderSelectedCase: () => ReactNode;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Case</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Score</TableHead>
          <TableHead className="text-right">Samples</TableHead>
          <TableHead className="text-right">Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cases.map((row) => {
          const selected = selectedCaseId === row.id;
          return (
            <Fragment key={row.id}>
              <TableRow
                aria-label={`Open case ${row.label}`}
                data-state={selected ? "selected" : undefined}
                role="button"
                tabIndex={0}
                className="cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => onSelectCase(selected ? null : row.id)}
                onKeyDown={(event) => {
                  if (isKeyboardActivation(event)) {
                    event.preventDefault();
                    onSelectCase(selected ? null : row.id);
                  }
                }}
              >
                <TableCell>
                  <div className="grid min-w-0 gap-1">
                    <span className="font-medium">{row.label}</span>
                    {row.split ? <span className="text-xs text-muted-foreground">{row.split}</span> : null}
                  </div>
                </TableCell>
                <TableCell>{row.status}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.metricValue === null ? "not recorded" : formatMetricValue(row.metricValue)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.completedSampleCount}/{row.sampleCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.durationMs !== null ? formatOptionalDuration(row.durationMs) : "—"}
                </TableCell>
              </TableRow>
              {selected ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="border-b bg-background px-3 py-4">
                    {renderSelectedCase()}
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

function EvaluationCaseDetailSurface({
  apiPath,
  caseId,
  state,
}: {
  apiPath: (pathname: string) => string;
  caseId: string;
  state: CaseReviewDetailState;
}) {
  const review = state.review;
  const nowMs = Date.now();
  const reviewStatus = review ? resolveCaseReviewStatus(review) : null;
  const reviewDurationMs = review ? resolveCaseReviewDurationMs(review, nowMs) : null;

  if (state.loading && !review) {
    return <EvaluationCaseDetailSkeleton />;
  }

  if (state.error) {
    return (
      <PaneErrorState
        message={state.error}
        title="Couldn't load case review"
      />
    );
  }

  if (!review) {
    return (
      <EmptyState
        icon={ListChecksIcon}
        title="Case not found"
        message="The selected case is not available for this evaluation."
        variant="hero"
        size="sm"
      />
    );
  }

  const caseSummary = (
    <section className="grid min-w-0 gap-3">
      <div className="flex flex-wrap gap-2">
        {Object.entries(review.metrics).map(([key, value]) => (
          <Badge key={key} variant="outline">
            {key} {formatMetricValue(value)}
          </Badge>
        ))}
        {reviewStatus ? <Badge variant="outline">{formatOperationalStatus(reviewStatus)}</Badge> : null}
        <Badge variant="outline">{formatCriterionCount(review.criteria_results.length)}</Badge>
        <Badge variant="outline">
          {review.executions.length > 0 ? formatCount(review.executions.length, "execution") : "no executions"}
        </Badge>
        <Badge variant="outline">{formatOptionalDuration(reviewDurationMs)}</Badge>
      </div>
    </section>
  );

  const content = (
    <>
      {caseSummary}

      <Tabs key={caseId} defaultValue="score" className="min-w-0">
        <TabsList variant="line">
          <TabsTrigger value="score">Score</TabsTrigger>
          <TabsTrigger value="attempts">Attempts</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>

        <TabsContent value="score" className="grid min-w-0 gap-3 pt-2">
          {review.feedback !== undefined ? (
            <CaseFeedbackCard value={review.feedback} />
          ) : null}

          {review.criteria_results.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed caption-bottom text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-52">Criterion</TableHead>
                    <TableHead className="w-16 text-center">Pass</TableHead>
                    <TableHead className="whitespace-normal">Rationale</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {review.criteria_results.map((criterion) => (
                    <TableRow key={criterion.criterion_id}>
                      <TableCell className="w-52 align-top font-mono text-xs whitespace-normal break-words [overflow-wrap:anywhere]">
                        {criterion.criterion_id}
                      </TableCell>
                      <TableCell className="w-16 align-top text-center tabular-nums">
                        {criterion.pass ? "1" : "0"}
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <div className="grid min-w-0 gap-2">
                          <TextBlockView
                            value={criterion.rationale ?? "No rationale recorded."}
                            className="text-sm leading-6"
                          />
                          {criterion.errors.length > 0 ? (
                            <TextBlockView
                              value={criterion.errors.join(" · ")}
                              className="text-xs leading-5 text-muted-foreground"
                            />
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No scoring criteria were recorded for this case.</p>
          )}
        </TabsContent>

        <TabsContent value="attempts" className="grid min-w-0 gap-3 pt-2">
          {review.executions.length > 0 ? (
            <CaseAttemptTable
              executions={review.executions}
              apiPath={apiPath}
            />
          ) : (
            <EmptyState
              icon={ActivityIcon}
              title="No task attempts"
              message="No attempts were recorded for this case."
              size="sm"
            />
          )}
        </TabsContent>

        <TabsContent
          value="files"
          className="flex-none h-[clamp(28rem,calc(100dvh-28rem),42rem)] overflow-hidden pt-2"
        >
          <ExecutionFilesSurface apiPath={apiPath} review={review} />
        </TabsContent>
      </Tabs>
    </>
  );

  return <div className="grid min-w-0 gap-4">{content}</div>;
}

function EvaluationsSurface({
  snapshotError,
  snapshotLoading,
  evaluations,
  rows,
  candidateLabelById,
  onSelectEvaluation,
}: {
  snapshotError: string | null;
  snapshotLoading: boolean;
  evaluations: EvaluationSummary[];
  rows: EvaluationRuntimeRow[];
  candidateLabelById: ReadonlyMap<string, string>;
  onSelectEvaluation: (evaluationId: string) => void;
}) {
  if (snapshotError) {
    return (
      <PaneErrorState message={snapshotError} />
    );
  }

  if (snapshotLoading) {
    return <EvaluationsDetailSkeleton />;
  }

  return (
    <EvaluationsDetail
      evaluations={evaluations}
      rows={rows}
      candidateLabelById={candidateLabelById}
      hasEvaluations={rows.length > 0}
      onSelectEvaluation={onSelectEvaluation}
    />
  );
}

function resolveScorecardCaseRows(scorecard: EvaluationScorecard): EvaluationCaseRow[] {
  return (scorecard.evaluation.cases ?? []).map((caseStats) => {
    const metricValue = caseStats.metrics.score?.mean ?? firstMetricStatsValue(caseStats.metrics);
    return {
      id: caseStats.id,
      label: caseStats.label ?? caseStats.id,
      status: caseStats.status ? formatOperationalStatus(caseStats.status) : "completed",
      completedSampleCount: caseStats.sampleCount,
      sampleCount: caseStats.sampleCount,
      metricValue,
      durationMs: caseStats.durationMs?.mean ?? null,
      split: caseStats.split ?? null,
    };
  }).sort((left, right) => left.label.localeCompare(right.label));
}

function formatEvaluationDisplayName(evaluation: EvaluationSummary): string {
  return formatEvaluationConfigurationLabel(evaluation);
}

function resolveTraceSessionsForJob(
  traceExecution: WorkbenchExecutionEvidence | null,
  jobId: string,
): TraceSessionView[] {
  if (!traceExecution) {
    return [];
  }
  const sessions = Array.isArray(traceExecution.sessions) ? traceExecution.sessions : [];
  const jobSessions = sessions.filter((session) => session.jobId === jobId);
  if (jobSessions.length > 0) {
    return jobSessions;
  }
  if (sessions.length > 0 && traceExecution.jobIds.length === 1) {
    return sessions;
  }
  return [];
}

function asUiRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstMetricStatsValue(metrics: Record<string, { mean: number }>): number | null {
  const [value] = Object.values(metrics);
  return typeof value?.mean === "number" ? value.mean : null;
}

function StructuredValueCard({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  return (
    <Card size="sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <StructuredValueView value={value} />
      </CardContent>
    </Card>
  );
}

function CaseFeedbackCard({
  value,
}: {
  value: unknown;
}) {
  if (typeof value === "string" && value.trim().length > 0) {
    return (
      <Card size="sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Feedback</CardTitle>
        </CardHeader>
        <CardContent>
          <TextBlockView value={value.trim()} className="text-sm leading-6" />
        </CardContent>
      </Card>
    );
  }
  return <StructuredValueCard title="Feedback" value={value} />;
}

const OPERATIONAL_STATUS_LABELS: Record<string, string> = {
  cancelled: "cancelled",
  completed: "completed",
  error: "error",
  failed: "error",
  pending: "pending",
  queued: "queued",
  running: "running",
  succeeded: "completed",
};

function formatOperationalStatus(status: string | null | undefined): string {
  return status ? OPERATIONAL_STATUS_LABELS[status] ?? "—" : "—";
}

function formatOptionalDuration(durationMs: number | null): string {
  return durationMs === null ? "—" : formatDurationMs(durationMs);
}

function resolveCaseReviewStatus(review: CandidateCaseReview): string | null {
  if (review.status) {
    return review.status;
  }
  return review.executions.length > 0
    ? resolveExecutionCollectionStatus(review.executions, "pending")
    : null;
}

function resolveCaseReviewDurationMs(
  review: CandidateCaseReview,
  nowMs: number,
): number | null {
  const activeDurationMs = resolveExecutionRefsDurationMs(review.executions, nowMs);
  if (hasActiveExecutionRecords(review.executions)) {
    return activeDurationMs ?? review.durationMs ?? null;
  }
  return review.durationMs ?? activeDurationMs;
}

function resolveExecutionRefsDurationMs(
  executions: CandidateCaseExecution[],
  nowMs: number,
): number | null {
  return resolveTimedExecutionRecordsDurationMs(executions, nowMs);
}

function resolveExecutionCollectionStatus(
  records: Array<{ status: RemoteWorkbenchJob["status"] }>,
  emptyStatus: string,
): string {
  if (records.some((record) => record.status === "running")) {
    return "running";
  }
  if (records.some((record) => record.status === "queued")) {
    return "queued";
  }
  if (records.some((record) => record.status === "failed")) {
    return "error";
  }
  if (records.some((record) => record.status === "cancelled")) {
    return "cancelled";
  }
  if (records.length > 0 && records.every((record) => record.status === "succeeded")) {
    return "completed";
  }
  return emptyStatus;
}

function resolveTimedExecutionRecordsDurationMs(
  records: TimedExecutionRecord[],
  nowMs: number,
): number | null {
  const ranges = records.flatMap((record) => {
    const startedAt = record.startedAt ?? (isTimedExecutionStatus(record.status) ? record.createdAt : null);
    const startMs = parseTimestampMs(startedAt);
    const endMs = parseTimestampMs(record.finishedAt) ?? (isTimedExecutionStatus(record.status) ? nowMs : null);
    return startMs !== null && endMs !== null && endMs >= startMs
      ? [{ startMs, endMs }]
      : [];
  });
  if (ranges.length > 0) {
    const startMs = Math.min(...ranges.map((range) => range.startMs));
    const endMs = Math.max(...ranges.map((range) => range.endMs));
    return endMs - startMs;
  }

  const durations = records.flatMap((record) =>
    typeof record.durationMs === "number" && Number.isFinite(record.durationMs)
      ? [record.durationMs]
      : [],
  );
  if (durations.length === 0) {
    return null;
  }
  return durations.reduce((sum, value) => sum + value, 0);
}

function resolveTimedDurationMs({
  active,
  durationMs,
  finishedAt,
  nowMs,
  startedAt,
}: {
  active: boolean;
  durationMs?: number | null;
  finishedAt?: string | null;
  nowMs: number;
  startedAt?: string | null;
}): number | null {
  const startMs = parseTimestampMs(startedAt);
  if (active && startMs !== null) {
    return Math.max(0, nowMs - startMs);
  }
  if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
    return durationMs;
  }
  const endMs = parseTimestampMs(finishedAt);
  return startMs !== null && endMs !== null && endMs >= startMs
    ? endMs - startMs
    : null;
}

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function isActiveExecutionStatus(status: RemoteWorkbenchJob["status"]): boolean {
  return status === "queued" || status === "running";
}

function isTimedExecutionStatus(status: RemoteWorkbenchJob["status"]): boolean {
  return status === "running";
}

function hasActiveExecutionRecords(records: readonly { status: RemoteWorkbenchJob["status"] }[]): boolean {
  return records.some((record) => isActiveExecutionStatus(record.status));
}

function formatExecutionKindLabel(purpose: string): string {
  if (purpose === "attempt") {
    return "Attempt";
  }
  if (purpose === "improve") {
    return "Improve";
  }
  return formatLabelText(purpose);
}

function formatLabelText(value: string): string {
  return value.replaceAll(/[_-]+/g, " ").replace(/^\w/u, (match) => match.toUpperCase());
}

function ExecutionFilesSurface({
  apiPath,
  review,
}: {
  apiPath: (pathname: string) => string;
  review: CandidateCaseReview;
}) {
  const outputExecution = review.executions[0] ?? null;
  const outputJobId = outputExecution?.jobIds[0] ?? null;
  const prefersStackedFilesLayout = useMediaQuery("(max-width: 900px)");
  const [executionFilesState, setExecutionFilesState] = useState<ExecutionFilesState>({
    loading: false,
    error: null,
    files: [],
  });
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [directoryPath, setDirectoryPath] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<CandidatePreviewMode>("rendered");
  const [previewState, setPreviewState] = useState<ExecutionPreviewState>({
    loading: false,
    error: null,
    preview: null,
  });
  const orderedFiles = useMemo(
    () => orderCandidateFiles(executionFilesState.files),
    [executionFilesState.files],
  );

  useEffect(() => {
    setSelectedFilePath(null);
    setDirectoryPath(null);
    setPreviewMode("rendered");
    setPreviewState({
      loading: false,
      error: null,
      preview: null,
    });
  }, [review.candidateId, review.caseId, outputExecution?.runId, outputJobId]);

  useEffect(() => {
    if (!outputExecution || !outputJobId) {
      setExecutionFilesState({
        loading: false,
        error: null,
        files: [],
      });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setExecutionFilesState({
      loading: true,
      error: null,
      files: [],
    });
    const params = new URLSearchParams({
      run: outputExecution.runId,
      id: outputJobId,
    });

    void requestJson<CandidateWorkspaceFileSummary[]>(
      apiPath(`/api/execution/files?${params.toString()}`),
      { signal: controller.signal },
    ).then((files) => {
      if (cancelled) {
        return;
      }
      startTransition(() => {
        setExecutionFilesState({
          loading: false,
          error: null,
          files,
        });
      });
    }).catch((error: unknown) => {
      if (cancelled || controller.signal.aborted) {
        return;
      }
      setExecutionFilesState({
        loading: false,
        error: toMessage(error),
        files: [],
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiPath, outputExecution?.runId, outputJobId]);

  useEffect(() => {
    const nextFilePath =
      selectedFilePath && orderedFiles.some((file) => file.path === selectedFilePath)
        ? selectedFilePath
        : orderedFiles[0]?.path ?? null;
    if (nextFilePath !== selectedFilePath) {
      setSelectedFilePath(nextFilePath);
      setDirectoryPath(directoryPathForFile(nextFilePath));
    }
  }, [orderedFiles, selectedFilePath]);

  useEffect(() => {
    if (!outputExecution || !outputJobId || !selectedFilePath) {
      setPreviewState({
        loading: false,
        error: null,
        preview: null,
      });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setPreviewState({
      loading: true,
      error: null,
      preview: null,
    });
    const params = new URLSearchParams({
      run: outputExecution.runId,
      id: outputJobId,
      path: selectedFilePath,
      view: previewMode,
    });

    void requestJson<CandidateWorkspaceFilePreview>(
      apiPath(`/api/execution/preview?${params.toString()}`),
      { signal: controller.signal },
    ).then((preview) => {
      if (cancelled) {
        return;
      }
      startTransition(() => {
        setPreviewState({
          loading: false,
          error: null,
          preview,
        });
      });
    }).catch((error: unknown) => {
      if (cancelled || controller.signal.aborted) {
        return;
      }
      setPreviewState({
        loading: false,
        error: toMessage(error),
        preview: null,
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiPath, outputExecution?.runId, outputJobId, previewMode, selectedFilePath]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <FilesBrowser
        changes={orderedFiles}
        selectedFilePath={selectedFilePath}
        browseMode="folders"
        currentDirectory={directoryPath}
        previewMode={previewMode}
        availablePreviewModes={supportedPreviewModes()}
        preview={previewState.preview}
        changesError={executionFilesState.error}
        previewError={previewState.error}
        isChangesLoading={executionFilesState.loading}
        isPreviewLoading={previewState.loading}
        layout={prefersStackedFilesLayout ? "stacked" : "split"}
        emptyMessage={outputExecution ? "No files were captured for this case." : "No output file reference was recorded for this case."}
        emptySelectionMessage="Select a case file to preview."
        listErrorMessage="Couldn't load the case file list."
        previewErrorMessage="Couldn't load the case file preview."
        onSelectFile={(filePath) => {
          setSelectedFilePath(filePath);
          setDirectoryPath(directoryPathForFile(filePath));
        }}
        onDirectoryChange={setDirectoryPath}
        onPreviewModeChange={(mode) => setPreviewMode(mode as CandidatePreviewMode)}
      />
    </div>
  );
}

function FactGrid({
  children,
  columnsClassName = "md:grid-cols-3",
}: {
  children: ReactNode;
  columnsClassName?: string;
}) {
  return (
    <div className={cn("grid gap-3", columnsClassName)}>
      {children}
    </div>
  );
}

function FactItem({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/35 px-4 py-3">
      <div className="min-w-0 truncate text-sm text-muted-foreground">{title}</div>
      <div
        className="mt-2 min-w-0 text-sm font-medium text-foreground whitespace-normal break-words [overflow-wrap:anywhere]"
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function resolveSelectedCandidateId(args: {
  route: WorkbenchRoute;
  activeId: string | null;
  summaries: CandidateSummary[];
}): string | null {
  if (args.route.kind === "candidate") {
    const candidateId = args.route.candidateId;
    if (candidateId && args.summaries.some((summary) => summary.id === candidateId)) {
      return candidateId;
    }
  }
  if (args.activeId && args.summaries.some((summary) => summary.id === args.activeId)) {
    return args.activeId;
  }
  return args.summaries[0]?.id ?? null;
}

function resolveSelectedCandidateFilePath(args: {
  routeFilePath: string | null;
  files: CandidateWorkspaceFileSummary[];
}): string | null {
  if (args.routeFilePath && args.files.some((entry) => entry.path === args.routeFilePath)) {
    return args.routeFilePath;
  }
  return pickDefaultCandidateFile(args.files);
}

function resolvePreferredBenchmarkFilePath(
  files: CandidateWorkspaceFileSummary[],
): string | null {
  return files[0]?.path ?? null;
}

function sourceYamlFileFromDocument(
  document: AuthoredWorkbenchSourceDocument,
  filePath: string,
): SourceYamlFile | null {
  const source = document.source_files.find((file) => file.path === filePath);
  return source ? { path: source.path, content: source.content } : null;
}

function sourceYamlFileFromCandidateRecord(record: CandidateRecord | null): SourceYamlFile | null {
  const source = asUiRecord(record?.meta)?.source;
  const files = asUiRecord(source)?.files;
  if (!Array.isArray(files)) {
    return null;
  }

  for (const value of files) {
    const file = asUiRecord(value);
    const filePath = typeof file?.path === "string" ? file.path : "";
    const content = typeof file?.content === "string" ? file.content : null;
    if (/^candidates\/[^/]+\/candidate\.ya?ml$/iu.test(filePath) && content !== null) {
      return { path: filePath, content };
    }
  }
  return null;
}

function directoryPathForFile(filePath: string | null | undefined): string | null {
  if (!filePath) {
    return null;
  }
  const segments = filePath.split("/").filter(Boolean);
  segments.pop();
  return segments.length ? segments.join("/") : null;
}

function orderCandidateSummaries(summaries: CandidateSummary[]): CandidateSummary[] {
  return summaries
    .slice()
    .sort((left, right) =>
      left.version - right.version ||
      left.createdAt.localeCompare(right.createdAt),
    );
}

function orderEvaluationSummaries(evaluations: EvaluationSummary[]): EvaluationSummary[] {
  return evaluations
    .slice()
    .sort((left, right) => {
      const updatedOrder = right.updatedAt.localeCompare(left.updatedAt);
      if (updatedOrder !== 0) {
        return updatedOrder;
      }
      return right.id.localeCompare(left.id);
    });
}

function orderRunSummaries(runs: RunSummary[]): RunSummary[] {
  return runs
    .slice()
    .sort((left, right) => {
      const startedOrder = left.startedAt.localeCompare(right.startedAt);
      if (startedOrder !== 0) {
        return startedOrder;
      }
      return left.id.localeCompare(right.id);
    });
}

function buildBenchmarkFingerprintOptions(args: {
  currentBenchmarkFingerprint: string | null;
  summaries: CandidateSummary[];
  evaluations: EvaluationSummary[];
  runs: RunSummary[];
}): BenchmarkFingerprintOption[] {
  const entries = new Map<string, BenchmarkFingerprintOption>();

  function ensure(fingerprint: string | null): BenchmarkFingerprintOption | null {
    const normalized = normalizeBenchmarkFingerprint(fingerprint);
    if (!normalized) {
      return null;
    }
    const existing = entries.get(normalized);
    if (existing) {
      return existing;
    }
    const option: BenchmarkFingerprintOption = {
      fingerprint: normalized,
      candidateCount: 0,
      evaluationCount: 0,
      runCount: 0,
      current: normalized === args.currentBenchmarkFingerprint,
    };
    entries.set(normalized, option);
    return option;
  }

  ensure(args.currentBenchmarkFingerprint);
  for (const summary of args.summaries) {
    const option = ensure(summary.benchmarkFingerprint);
    if (option) {
      option.candidateCount += 1;
    }
  }
  for (const evaluation of args.evaluations) {
    const option = ensure(evaluation.benchmarkFingerprint);
    if (option) {
      option.evaluationCount += 1;
    }
  }
  for (const run of args.runs) {
    const option = ensure(run.benchmarkFingerprint);
    if (option) {
      option.runCount += 1;
    }
  }

  return [...entries.values()].sort((left, right) => {
    if (left.current !== right.current) {
      return left.current ? -1 : 1;
    }
    return right.candidateCount - left.candidateCount ||
      right.evaluationCount - left.evaluationCount ||
      right.runCount - left.runCount ||
      left.fingerprint.localeCompare(right.fingerprint);
  });
}

function formatCount(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function formatCriterionCount(value: number): string {
  return `${value} ${value === 1 ? "criterion" : "criteria"}`;
}

function shortFingerprint(value: string | null | undefined): string {
  if (!value) {
    return "not recorded";
  }
  return shortDigest(value);
}

function shortDigest(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value;
}
