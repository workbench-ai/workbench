"use client";

import { startTransition, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ActivityIcon,
  ChartColumnIcon,
  FileCode2Icon,
  FolderOpenIcon,
  GitBranchIcon,
  InfoIcon,
  ListChecksIcon,
  PlayIcon,
  Settings2Icon,
} from "lucide-react";
import { CodeBlockSurface } from "@workbench-ai/cli-web-ui/components/shared/code-block-surface";
import {
  DesktopWorkspaceSplit,
  DesktopWorkspaceSplitToggle,
} from "@workbench-ai/cli-web-ui/components/shared/desktop-workspace-split";
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
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
import { Spinner } from "@workbench-ai/cli-web-ui/components/ui/spinner";
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
  ToggleGroup,
  ToggleGroupItem,
} from "@workbench-ai/cli-web-ui/components/ui/toggle-group";
import {
  buildExecutionTraceTimeline,
  type ExecutionTrace,
} from "@workbench-ai/cli-web-ui/lib/execution-trace-timeline";
import { supportedPreviewModes } from "@workbench-ai/cli-web-ui/lib/file-preview";
import { useMediaQuery } from "@workbench-ai/cli-web-ui/lib/use-media-query";
import { cn } from "@workbench-ai/cli-web-ui/lib/utils";
import { badgeToneProps, type BadgeTone } from "@workbench-ai/cli-web-ui/lib/badge";

import { CandidateList } from "./components/candidate-list";
import { ResultsDetail } from "./components/results-detail";
import {
  CandidateArchiveSkeleton,
  CandidateEvaluationSkeleton,
  CandidateFilesSurfaceSkeleton,
  CaseReviewSkeleton,
  ResultsDetailSkeleton,
  EvaluationTasksSkeleton,
  LineageSurfaceSkeleton,
  BenchmarkSurfaceSkeleton,
} from "./components/loading-states";
import { LineageGraph } from "./components/lineage-graph";
import { StatusBadge } from "./components/status-badge";
import { SurfaceSection } from "./components/surface-section";
import { requestJson, toMessage } from "./lib/api";
import { pickDefaultCandidateFile } from "./lib/candidate-file-preference";
import { orderCandidateFiles } from "./lib/candidate-files";
import {
  filterCandidateSummariesByBenchmark,
  normalizeBenchmarkFingerprint,
} from "./lib/candidate-scope";
import {
  formatDurationMs,
  formatMetricValue,
  formatRunStartSummary,
  formatTimestamp,
  shortId,
  statusLabel,
} from "./lib/format";
import {
  buildWorkbenchLocationHref,
  createCandidateRoute,
  createCandidatesRoute,
  createBenchmarkRoute,
  parseWorkbenchLocation,
  type CandidateView,
  type CandidateReviewTab,
  type WorkbenchPersistentSearchParams,
  type WorkbenchRoute,
} from "./lib/routes";
import type {
  CandidateCaseReview,
  CandidatePreviewMode,
  CandidateRecord,
  CandidateSummary,
  EvaluationRecord,
  EvaluationResultRecord,
  EvaluationResultSummary,
  CandidateWorkspaceFilePreview,
  CandidateWorkspaceFileSummary,
  AuthoredWorkbenchSourceDocument,
  HostedWorkbenchJob,
  HostedWorkbenchRun,
  RunOutcome,
  RunStatus,
  RunSummary,
  RuntimeSnapshot,
  WorkbenchExecutionTraceDetail,
  WorkbenchTracePhase,
} from "./types";

const DESKTOP_RUNTIME_PANE_STORAGE_KEY = "workbench-dual-pane-layout";
const COMPACT_RUNTIME_LAYOUT_MEDIA_QUERY = "(max-width: 1535px)";
const DESKTOP_RUNTIME_LEFT_DEFAULT_PERCENT = 35;
const DESKTOP_RUNTIME_LEFT_MIN_PERCENT = 28;
const DESKTOP_RUNTIME_LEFT_MAX_PERCENT = 42;
const EMPTY_PERSISTENT_SEARCH_PARAMS: WorkbenchPersistentSearchParams = {};

interface CandidateRecordState {
  loading: boolean;
  error: string | null;
  record: CandidateRecord | null;
}

interface ResultRecordsState {
  loading: boolean;
  error: string | null;
  records: EvaluationResultRecord[];
}

interface CaseReviewState {
  open: boolean;
  candidateId: string | null;
  caseId: string | null;
  tab: CaseReviewTab;
  runId: string | null;
  loading: boolean;
  error: string | null;
  review: CandidateCaseReview | null;
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

type CandidateEvalCaseResult = NonNullable<NonNullable<NonNullable<CandidateRecord["eval"]>["samples"][number]["cases"]>[number]>;
type CandidateCasePhase = CandidateCaseReview["phases"][number];
type TimedExecutionRecord = {
  status: HostedWorkbenchJob["status"];
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number | null;
};

interface EvaluationTaskRow {
  id: string;
  label: string;
  status: string;
  completedSampleCount: number;
  sampleCount: number;
  metricValue: number | null;
  durationMs: number | null;
  split: string | null;
  detailAvailable: boolean;
}

interface CandidatePreviewState {
  loading: boolean;
  error: string | null;
  preview: CandidateWorkspaceFilePreview | null;
}

type RuntimeRootView = "lineage" | "archive" | "results" | "runs";
type BenchmarkSurfaceTab = "processed" | "manifest" | "files";

interface BenchmarkFingerprintOption {
  fingerprint: string;
  candidateCount: number;
  resultCount: number;
  runCount: number;
  current: boolean;
}

interface TraceDetailState {
  loading: boolean;
  error: string | null;
  detail: WorkbenchExecutionTraceDetail | null;
}

interface RunDetailState {
  loading: boolean;
  error: string | null;
  detail: {
    run: HostedWorkbenchRun;
    jobs: HostedWorkbenchJob[];
  } | null;
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

type CaseReviewTab = CandidateReviewTab;

function clampDesktopRuntimeLeftPercent(value: number): number {
  return Math.min(
    DESKTOP_RUNTIME_LEFT_MAX_PERCENT,
    Math.max(DESKTOP_RUNTIME_LEFT_MIN_PERCENT, value),
  );
}

function readDesktopRuntimeLeftPercent(): number {
  if (typeof window === "undefined") {
    return DESKTOP_RUNTIME_LEFT_DEFAULT_PERCENT;
  }
  const stored = Number.parseFloat(window.localStorage.getItem(DESKTOP_RUNTIME_PANE_STORAGE_KEY) ?? "");
  if (!Number.isFinite(stored)) {
    return DESKTOP_RUNTIME_LEFT_DEFAULT_PERCENT;
  }
  return clampDesktopRuntimeLeftPercent(stored);
}

export interface WorkbenchWorkspaceProps {
  apiBasePath: string;
  routeBasePath?: string;
  persistentSearchParams?: WorkbenchPersistentSearchParams;
  headerControls?: ReactNode;
  brandHref?: string;
}

export function WorkbenchWorkspace({
  apiBasePath,
  routeBasePath = "/workbench",
  persistentSearchParams = EMPTY_PERSISTENT_SEARCH_PARAMS,
  headerControls,
  brandHref,
}: WorkbenchWorkspaceProps) {
  const apiPath = useMemo(() => createApiPathResolver(apiBasePath), [apiBasePath]);
  const [route, navigate] = useWorkbenchRoute(routeBasePath, persistentSearchParams);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [specDocument, setSpecDocument] = useState<AuthoredWorkbenchSourceDocument | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [recordState, setRecordState] = useState<CandidateRecordState>({
    loading: false,
    error: null,
    record: null,
  });
  const [resultRecordsState, setResultRecordsState] = useState<ResultRecordsState>({
    loading: false,
    error: null,
    records: [],
  });
  const [caseReviewState, setCaseReviewState] = useState<CaseReviewState>({
    open: false,
    candidateId: null,
    caseId: null,
    tab: "overview",
    runId: null,
    loading: false,
    error: null,
    review: null,
  });
  const [runtimeRootView, setRuntimeRootView] = useState<RuntimeRootView>("lineage");
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
  const [desktopRuntimeLeftPercent, setDesktopRuntimeLeftPercent] = useState(readDesktopRuntimeLeftPercent);
  const benchmarkSurfaceFillsBody = benchmarkSurfaceTab === "files";
  const snapshotLoading = snapshot === null && snapshotError === null;
  const specLoading = specDocument === null && specError === null;

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      try {
        const next = await requestJson<RuntimeSnapshot>(apiPath("/api/snapshot"));
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setSnapshot(next);
          setSnapshotError(null);
        });
      } catch (error) {
        if (!cancelled) {
          setSnapshotError(toMessage(error));
        }
      }
    }

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [apiPath]);

  const orderedCandidateSummaries = useMemo(
    () => snapshot ? orderCandidateSummaries(snapshot.summaries) : [],
    [snapshot],
  );
  const currentBenchmarkFingerprint = normalizeBenchmarkFingerprint(snapshot?.currentBenchmarkFingerprint);
  const benchmarkFingerprintOptions = useMemo(
    () => buildBenchmarkFingerprintOptions({
      currentBenchmarkFingerprint,
      summaries: orderedCandidateSummaries,
      results: snapshot?.results ?? [],
      runs: snapshot?.runs ?? [],
    }),
    [currentBenchmarkFingerprint, orderedCandidateSummaries, snapshot?.results, snapshot?.runs],
  );
  const scopedBenchmarkFingerprint =
    selectedBenchmarkFingerprint &&
      benchmarkFingerprintOptions.some((option) => option.fingerprint === selectedBenchmarkFingerprint)
      ? selectedBenchmarkFingerprint
      : currentBenchmarkFingerprint ?? benchmarkFingerprintOptions[0]?.fingerprint ?? null;
  const currentBenchmarkSummaries = useMemo(
    () => filterCandidateSummariesByBenchmark({
      summaries: orderedCandidateSummaries,
      benchmarkFingerprint: scopedBenchmarkFingerprint,
    }),
    [orderedCandidateSummaries, scopedBenchmarkFingerprint],
  );
  const currentBenchmarkResults = useMemo(
    () => snapshot
      ? orderResultSummaries(snapshot.results).filter(
          (result) => normalizeBenchmarkFingerprint(result.benchmarkFingerprint) === scopedBenchmarkFingerprint,
        )
      : [],
    [scopedBenchmarkFingerprint, snapshot],
  );
  const currentBenchmarkRuns = useMemo(
    () => snapshot
      ? orderRunSummaries(snapshot.runs).filter(
          (run) => normalizeBenchmarkFingerprint(run.benchmarkFingerprint) === scopedBenchmarkFingerprint,
        )
      : [],
    [scopedBenchmarkFingerprint, snapshot],
  );
  const orderedResultsRecordKey = useMemo(
    () => currentBenchmarkResults.map((result) => `${result.id}:${result.updatedAt}`).join("|"),
    [currentBenchmarkResults],
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
        specDocument,
      })
    : null;
  const candidatePreviewMode = route.kind === "candidate" && route.view === "files"
    ? route.previewMode
    : "rendered";
  const candidateDirectoryPath = route.kind === "candidate" && route.view === "files"
    ? route.directoryPath
    : null;
  const prefersCompactRuntimeLayout = useMediaQuery(COMPACT_RUNTIME_LAYOUT_MEDIA_QUERY);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (scopedBenchmarkFingerprint) {
      params.set("fingerprint", scopedBenchmarkFingerprint);
    }

    async function loadSpec() {
      try {
        const next = await requestJson<AuthoredWorkbenchSourceDocument>(
          apiPath(`/api/spec${params.size ? `?${params.toString()}` : ""}`),
        );
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setSpecDocument(next);
          setSpecError(null);
        });
      } catch (error) {
        if (!cancelled) {
          setSpecError(toMessage(error));
        }
      }
    }

    void loadSpec();
    return () => {
      cancelled = true;
    };
  }, [apiPath, scopedBenchmarkFingerprint]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      DESKTOP_RUNTIME_PANE_STORAGE_KEY,
      String(desktopRuntimeLeftPercent),
    );
  }, [desktopRuntimeLeftPercent]);

  useEffect(() => {
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
  }, [apiPath, scopedBenchmarkFingerprint]);

  useEffect(() => {
    const nextBenchmarkFingerprint =
      selectedBenchmarkFingerprint &&
        benchmarkFingerprintOptions.some((option) => option.fingerprint === selectedBenchmarkFingerprint)
        ? selectedBenchmarkFingerprint
        : currentBenchmarkFingerprint ?? benchmarkFingerprintOptions[0]?.fingerprint ?? null;
    if (nextBenchmarkFingerprint !== selectedBenchmarkFingerprint) {
      setSelectedBenchmarkFingerprint(nextBenchmarkFingerprint);
    }
  }, [benchmarkFingerprintOptions, currentBenchmarkFingerprint, selectedBenchmarkFingerprint]);

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
    if (!selectedBenchmarkFilePath) {
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
  }, [apiPath, selectedBenchmarkFilePath, benchmarkPreviewMode, scopedBenchmarkFingerprint]);

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
          reviewCaseId: route.view === "evaluation" ? route.reviewCaseId : null,
          reviewTab: route.view === "evaluation" ? route.reviewTab : "overview",
          reviewRunId: route.view === "evaluation" ? route.reviewRunId : null,
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
      specDocument,
    });
    if (nextFilePath !== route.filePath) {
      navigate(
        createCandidateRoute({
          candidateId: selectedCandidateId,
          view: "files",
          filePath: nextFilePath,
          directoryPath: route.directoryPath ?? directoryPathForFile(nextFilePath),
          previewMode: route.previewMode,
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
    if (route.kind !== "candidate" || !selectedCandidateId) {
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
  }, [apiPath, route.kind, selectedCandidateId]);

  useEffect(() => {
    if (route.kind !== "candidates" || runtimeRootView !== "results" || currentBenchmarkResults.length === 0) {
      setResultRecordsState({
        loading: false,
        error: null,
        records: [],
      });
      return;
    }

    let cancelled = false;
    setResultRecordsState((current) => ({
      loading: current.records.length === 0,
      error: null,
      records: current.records,
    }));

    async function loadResults() {
      try {
        const records = await Promise.all(
          currentBenchmarkResults.map((result) =>
            requestJson<EvaluationResultRecord>(
              apiPath(`/api/result?id=${encodeURIComponent(result.id)}`),
            ),
          ),
        );
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setResultRecordsState({
            loading: false,
            error: null,
            records,
          });
        });
      } catch (error) {
        if (!cancelled) {
          setResultRecordsState({
            loading: false,
            error: toMessage(error),
            records: [],
          });
        }
      }
    }

    void loadResults();
    return () => {
      cancelled = true;
    };
  }, [apiPath, currentBenchmarkResults, orderedResultsRecordKey, route.kind, runtimeRootView]);

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

  const latestRun = currentBenchmarkRuns.at(-1) ?? null;
  const latestRuns = currentBenchmarkRuns.slice(-5).reverse();
  const runRouteDetailState = useRunDetail(apiPath, route.kind === "run" ? route.runId : null);
  const runRouteTarget = resolveRunTraceRouteTarget(
    runRouteDetailState.detail,
    route.kind === "run" ? route.runId : null,
  );
  useEffect(() => {
    if (route.kind !== "run" || !runRouteTarget) {
      return;
    }
    navigate(
      createCandidateRoute({
        candidateId: runRouteTarget.candidateId,
        view: "evaluation",
        reviewCaseId: runRouteTarget.caseId,
        reviewTab: "trace",
        reviewRunId: runRouteTarget.runId,
      }),
      { replace: true },
    );
  }, [
    navigate,
    route.kind,
    runRouteTarget?.candidateId,
    runRouteTarget?.caseId,
    runRouteTarget?.runId,
  ]);

  useEffect(() => {
    const candidateId = caseReviewState.candidateId;
    const caseId = caseReviewState.caseId;
    if (!caseReviewState.open || !candidateId || !caseId) {
      return;
    }
    const requestedCandidateId = candidateId;
    const requestedCaseId = caseId;

    let cancelled = false;
    let inFlightController: AbortController | null = null;

    async function loadReview() {
      if (inFlightController) {
        return;
      }
      const controller = new AbortController();
      inFlightController = controller;
      setCaseReviewState((current) =>
        current.open && current.candidateId === requestedCandidateId && current.caseId === requestedCaseId
          ? {
              ...current,
              loading: !current.review,
              error: null,
            }
          : current,
      );
      try {
        const review = await requestJson<CandidateCaseReview>(
          apiPath(`/api/task-review?id=${encodeURIComponent(requestedCandidateId)}&task=${encodeURIComponent(requestedCaseId)}`),
          { signal: controller.signal },
        );
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setCaseReviewState((current) =>
            current.open && current.candidateId === requestedCandidateId && current.caseId === requestedCaseId
              ? {
                  open: true,
                  candidateId: requestedCandidateId,
                  caseId: requestedCaseId,
                  tab: current.tab,
                  runId: current.runId,
                  loading: false,
                  error: null,
                  review,
                }
              : current,
          );
        });
      } catch (error) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        setCaseReviewState((current) =>
          current.open && current.candidateId === requestedCandidateId && current.caseId === requestedCaseId
            ? {
                ...current,
                loading: false,
                error: toMessage(error),
              }
            : current,
        );
      } finally {
        if (inFlightController === controller) {
          inFlightController = null;
        }
      }
    }

    void loadReview();
    return () => {
      cancelled = true;
      inFlightController?.abort();
    };
  }, [
    apiPath,
    caseReviewState.caseId,
    caseReviewState.candidateId,
    caseReviewState.open,
  ]);

  useEffect(() => {
    if (route.kind !== "candidate" || route.view !== "evaluation" || !route.reviewCaseId || !selectedCandidateId) {
      setCaseReviewState((current) =>
        current.open
          ? {
              open: false,
              candidateId: null,
              caseId: null,
              tab: "overview",
              runId: null,
              loading: false,
              error: null,
              review: null,
            }
          : current,
      );
      return;
    }

    const candidateId = selectedCandidateId;
    const caseId = route.reviewCaseId;
    const tab = route.reviewTab;
    const runId = route.reviewRunId;
    setCaseReviewState((current) => {
      const review = current.candidateId === candidateId && current.caseId === caseId
        ? current.review
        : null;
      return {
        open: true,
        candidateId,
        caseId,
        tab,
        runId,
        loading: !review,
        error: null,
        review,
      };
    });
  }, [
    route.kind,
    route.kind === "candidate" ? route.candidateId : null,
    route.kind === "candidate" ? route.view : null,
    route.kind === "candidate" ? route.reviewCaseId : null,
    route.kind === "candidate" ? route.reviewRunId : null,
    route.kind === "candidate" ? route.reviewTab : "overview",
    selectedCandidateId,
  ]);

  function openCaseReview(caseId: string, tab: CaseReviewTab = "overview", runId: string | null = null) {
    if (!selectedCandidateId) {
      return;
    }
    navigateToCandidate({
      candidateId: selectedCandidateId,
      view: "evaluation",
      reviewCaseId: caseId,
      reviewTab: tab,
      reviewRunId: runId,
    });
  }

  function navigateToCandidate(args: {
    candidateId: string;
    view?: CandidateView;
    filePath?: string | null;
    directoryPath?: string | null;
    previewMode?: CandidatePreviewMode;
    reviewCaseId?: string | null;
    reviewTab?: CaseReviewTab;
    reviewRunId?: string | null;
    replace?: boolean;
  }) {
    const view = args.view ?? (route.kind === "candidate" ? route.view : "evaluation");
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
        reviewCaseId: view === "evaluation" ? args.reviewCaseId ?? null : null,
        reviewTab: view === "evaluation" ? args.reviewTab ?? "overview" : "overview",
        reviewRunId: view === "evaluation" ? args.reviewRunId ?? null : null,
      }),
      args.replace ? { replace: true } : undefined,
    );
  }

  function handleSelectCandidate(candidateId: string) {
    navigateToCandidate({
      candidateId,
      view: route.kind === "candidate" ? route.view : "evaluation",
      filePath: route.kind === "candidate" && route.view === "files" ? route.filePath : null,
      directoryPath: route.kind === "candidate" && route.view === "files" ? route.directoryPath : null,
      previewMode: route.kind === "candidate" && route.view === "files" ? route.previewMode : "rendered",
    });
  }

  const runtimeSurface = (() => {
    if (route.kind === "candidate" && route.view === "manifest") {
      return (
        <CandidateYamlSurface
          specError={specError}
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
          specError={specError}
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

    if (route.kind === "candidate" && route.view === "evaluation") {
      return (
        <CandidateEvaluationSurface
          apiPath={apiPath}
          snapshot={snapshot}
          snapshotError={snapshotError}
          snapshotLoading={snapshotLoading}
          selectedCandidateSummary={selectedCandidateSummary}
          recordState={recordState}
          specDocument={specDocument}
          latestRun={latestRun}
          latestRuns={latestRuns}
          onOpenCaseReview={openCaseReview}
        />
      );
    }

    if (route.kind === "run") {
      return (
        <RunRouteResolutionSurface
          runId={route.runId}
          state={runRouteDetailState}
          resolving={Boolean(runRouteTarget)}
        />
      );
    }

    return (
      <CandidatesPaneSurface
        view={runtimeRootView}
        snapshot={snapshot}
        snapshotError={snapshotError}
        snapshotLoading={snapshotLoading}
        currentBenchmarkSummaries={currentBenchmarkSummaries}
        currentBenchmarkResults={currentBenchmarkResults}
        currentBenchmarkRuns={currentBenchmarkRuns}
        selectedCandidateId={selectedCandidateId}
        resultRecordsState={resultRecordsState}
        onViewChange={(nextView) => {
          setRuntimeRootView(nextView);
          navigate(createCandidatesRoute());
        }}
        onSelectCandidate={handleSelectCandidate}
        showHeading={false}
      />
    );
  })();

  const desktopRuntimePaneOpen =
    route.kind !== "benchmark" && !prefersCompactRuntimeLayout;
  const routeHref = (next: WorkbenchRoute) => buildWorkbenchLocationHref(next, routeBasePath, persistentSearchParams);
  const benchmarkHref = routeHref(createBenchmarkRoute());
  const workbenchBrandHref = brandHref ?? benchmarkHref;

  function handleRuntimePaneAction() {
    if (route.kind === "benchmark") {
      navigate(createCandidatesRoute());
      return;
    }
    navigate(createBenchmarkRoute());
  }

  const runtimePaneToggleAction = (
    <DesktopWorkspaceSplitToggle
      paneOpen={desktopRuntimePaneOpen}
      openLabel="Show candidates pane"
      closeLabel="Hide candidates pane"
      openText="Candidates"
      testId="runtime-pane-toggle"
      onClick={handleRuntimePaneAction}
    />
  );

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
      actions={!prefersCompactRuntimeLayout ? runtimePaneToggleAction : undefined}
    />
  );

  const compactBenchmarkPaneActions = (
    <>
      {runtimePaneToggleAction}
    </>
  );

  const workspaceHeader = (
    <WorkspaceTopBar
      brand={(
        <a
          href={workbenchBrandHref}
          aria-label={brandHref ? "Workbench dashboard" : "Workbench Home"}
          data-testid="app-brand-link"
          className="inline-flex w-fit rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
      actions={(
        <>
          {headerControls}
        </>
      )}
    />
  );

  const benchmarkPane = (
    <WorkspacePane
      tone="secondary"
      actions={(
        prefersCompactRuntimeLayout ? compactBenchmarkPaneActions : undefined
      )}
      hideHeader={!prefersCompactRuntimeLayout}
      scrollBody={!benchmarkSurfaceFillsBody}
      contentClassName={benchmarkSurfaceFillsBody ? "flex h-full min-h-0 flex-col" : undefined}
    >
      {benchmarkSurface}
    </WorkspacePane>
  );

  const runtimeTabs = route.kind === "candidate" ? (
    <ViewSwitch
      ariaLabel="Candidate views"
      value={route.view}
      className="self-start"
      items={[
        { value: "evaluation", label: "Evaluation", icon: PlayIcon },
        { value: "manifest", label: "Manifest", icon: FileCode2Icon },
        { value: "files", label: "Files", icon: FolderOpenIcon },
      ]}
      onValueChange={(value) => {
        if (!selectedCandidateId) {
          return;
        }
        const nextView: CandidateView =
          value === "files" ? "files" : value === "manifest" ? "manifest" : "evaluation";
        navigateToCandidate({
          candidateId: selectedCandidateId,
          view: nextView,
          directoryPath: nextView === "files" ? candidateDirectoryPath : null,
          previewMode: nextView === "files" ? candidatePreviewMode : "rendered",
        });
      }}
    />
  ) : null;
  const runtimeSurfaceFillsBody =
    (route.kind === "candidate" && route.view === "files") ||
    (route.kind === "candidates" && (runtimeRootView === "lineage" || runtimeRootView === "results" || runtimeRootView === "runs"));

  const runtimePane = (
    <WorkspacePane
      breadcrumbs={route.kind !== "benchmark" ? (
          <RuntimeBreadcrumbs
            route={route}
            selectedCandidateSummary={selectedCandidateSummary}
            routeHref={routeHref}
            onNavigate={navigate}
          />
      ) : undefined}
      title={runtimeTitle({
        route,
        selectedCandidateSummary,
      })}
      badges={(
        <RuntimePaneBadges
          route={route}
          snapshot={snapshot}
          candidateCount={route.kind === "candidates" ? currentBenchmarkSummaries.length : snapshot?.summaries.length ?? 0}
          selectedCandidateSummary={selectedCandidateSummary}
        />
      )}
      subnav={runtimeTabs}
      scrollBody={!runtimeSurfaceFillsBody}
      contentClassName={runtimeSurfaceFillsBody ? "flex h-full min-h-0 flex-col" : undefined}
    >
      {runtimeSurface}
    </WorkspacePane>
  );

  return (
    <WorkspaceRoot
      mainId="main-content"
      skipLinkLabel="Skip to Workbench workspace"
      header={workspaceHeader}
    >
      {prefersCompactRuntimeLayout ? (
        route.kind === "benchmark" ? benchmarkPane : runtimePane
      ) : (
        <DesktopWorkspaceSplit
          paneOpen={desktopRuntimePaneOpen}
          primaryPercent={desktopRuntimeLeftPercent}
          minPrimaryPercent={DESKTOP_RUNTIME_LEFT_MIN_PERCENT}
          maxPrimaryPercent={DESKTOP_RUNTIME_LEFT_MAX_PERCENT}
          onPrimaryPercentChange={setDesktopRuntimeLeftPercent}
          primaryPane={benchmarkPane}
          secondaryPane={runtimePane}
          secondaryPaneId="workbench-core-pane"
          separatorLabel="Resize candidates pane"
        />
      )}

      <CaseReviewDialog
        apiPath={apiPath}
        state={caseReviewState}
        onOpenChange={(open) => {
          if (!open) {
            setCaseReviewState({
              open: false,
              candidateId: null,
              caseId: null,
              tab: "overview",
              runId: null,
              loading: false,
              error: null,
              review: null,
            });
            if (route.kind === "candidate" && route.view === "evaluation") {
              const candidateId = selectedCandidateId ?? route.candidateId;
              if (!candidateId) {
                return;
              }
              navigateToCandidate({
                candidateId,
                view: "evaluation",
                replace: true,
              });
            }
          }
        }}
        onTabChange={(tab) => {
          setCaseReviewState((current) => ({ ...current, tab }));
          if (route.kind === "candidate" && route.view === "evaluation" && route.reviewCaseId) {
            const candidateId = selectedCandidateId ?? route.candidateId;
            if (!candidateId) {
              return;
            }
            navigateToCandidate({
              candidateId,
              view: "evaluation",
              reviewCaseId: route.reviewCaseId,
              reviewTab: tab,
              reviewRunId: route.reviewRunId,
              replace: true,
            });
          }
        }}
      />
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
): [WorkbenchRoute, (route: WorkbenchRoute, options?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState<WorkbenchRoute>(() => parseWorkbenchLocation({
    pathname: typeof window === "undefined" ? "/" : window.location.pathname,
    search: typeof window === "undefined" ? "" : window.location.search,
  }, routeBasePath));

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

  function runtimeTitle(args: {
  route: WorkbenchRoute;
  selectedCandidateSummary: CandidateSummary | null;
}): string {
  if (args.route.kind !== "candidate") {
    return "Candidates";
  }
  if (!args.selectedCandidateSummary) {
    return "Candidate";
  }
  return shortId(args.selectedCandidateSummary.id) ?? args.selectedCandidateSummary.id;
}

function RuntimeBreadcrumbs({
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
  const terminalLabel = route.kind === "candidate"
    ? selectedCandidateSummary
      ? shortId(selectedCandidateSummary.id) ?? selectedCandidateSummary.id
      : "Candidate"
    : "Candidates";

  return (
    <Breadcrumb>
      <BreadcrumbList>
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
        {route.kind === "candidate" ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink
                href={routeHref(createCandidatesRoute())}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(createCandidatesRoute());
                }}
              >
                Candidates
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{terminalLabel}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : (
          <BreadcrumbItem>
            <BreadcrumbPage>{terminalLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function RuntimePaneBadges({
  route,
  snapshot,
  candidateCount,
  selectedCandidateSummary,
}: {
  route: WorkbenchRoute;
  snapshot: RuntimeSnapshot | null;
  candidateCount: number;
  selectedCandidateSummary: CandidateSummary | null;
}) {
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
        <StatusBadge
          status={selectedCandidateSummary.status}
          active={snapshot?.activeId === selectedCandidateSummary.id}
        />
      ) : null}
    </>
  );
}

function BenchmarkAccordionSection({
  value,
  title,
  summary,
  children,
  "data-testid": dataTestId,
}: {
  value: string;
  title: string;
  summary?: ReactNode;
  children: React.ReactNode;
  "data-testid"?: string;
}) {
  return (
    <AccordionItem value={value} data-testid={dataTestId} className="min-w-0">
      <AccordionTrigger className="min-w-0 py-2.5 hover:no-underline">
        <div className="grid min-w-0 flex-1 gap-1 text-left">
          <span className="min-w-0 text-sm font-medium text-foreground">{title}</span>
          {summary ? (
            <span className="min-w-0 max-w-full text-xs font-normal text-muted-foreground whitespace-normal break-words [overflow-wrap:anywhere] group-aria-expanded/accordion-trigger:hidden">
              {summary}
            </span>
          ) : null}
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-3">
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
        <Card>
          <CardContent className="py-6 text-sm text-destructive">{specError}</CardContent>
        </Card>
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
  const environment = spec.benchmark.environment;
  const grade = spec.benchmark.grade;
  const environmentImage = environment.dockerfile;
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
                <BenchmarkAccordionSection
                  value="runtime-environment"
                  title="Environment"
                  summary={environmentImage}
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <BenchmarkField label="Dockerfile" value={environmentImage} mono />
                    <BenchmarkField label="Network" value={formatNetworkConfig(environment.network)} mono />
                  </div>
                  {environment.resources ? (
                    <StructuredValueView value={environment.resources} />
                  ) : null}
                </BenchmarkAccordionSection>

                <BenchmarkAccordionSection
                  value="eval-tasks"
                  title="Task Files"
                  summary={formatCount(specDocument.cases.length, "task")}
                  data-testid="benchmark-task-card"
                >
                  <BenchmarkPlainStringList title="Path" values={[spec.benchmark.tasks]} />
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Task</TableHead>
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
                </BenchmarkAccordionSection>

                <BenchmarkAccordionSection
                  value="eval-grader"
                  title="Grade"
                  summary={formatUseBlockSummary(grade)}
                >
                  <StructuredValueView value={grade} />
                </BenchmarkAccordionSection>

              </Accordion>
            </SurfaceSection>
          </div>
        </TabsContent>
        <TabsContent value="manifest" className="min-w-0">
          <SourceYamlSection
            title="Benchmark Manifest"
            description="The benchmark manifest defines tasks, environment, and grading."
            source={benchmarkYamlSource}
            testId="benchmark-yaml-source"
          />
        </TabsContent>
        <TabsContent value="files" className="min-h-0 min-w-0">
          <SurfaceSection
            title="Mounted Task Files"
            icon={FolderOpenIcon}
            description="Task input and expected files mounted during runner and grader execution."
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
                emptyMessage="No mounted task files are available for this benchmark."
                emptySelectionMessage="Select a mounted task file to preview."
                listErrorMessage="Couldn't load the mounted task file list."
                previewErrorMessage="Couldn't load the mounted task file preview."
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
        <Card>
          <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading manifest
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : source ? (
        <div className="grid min-w-0 gap-2">
          <div className="flex min-w-0 flex-wrap gap-2">
            <Badge variant="outline" className="font-mono">{source.path}</Badge>
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
    return "none";
  }
  const egress = (value as Record<string, unknown>).egress;
  return typeof egress === "string" && egress.length > 0 ? egress : "none";
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

function CandidatesPaneSurface({
  view,
  snapshot,
  snapshotError,
  snapshotLoading,
  currentBenchmarkSummaries,
  currentBenchmarkResults,
  currentBenchmarkRuns,
  selectedCandidateId,
  resultRecordsState,
  onViewChange,
  onSelectCandidate,
  showHeading = true,
}: {
  view: RuntimeRootView;
  snapshot: RuntimeSnapshot | null;
  snapshotError: string | null;
  snapshotLoading: boolean;
  currentBenchmarkSummaries: CandidateSummary[];
  currentBenchmarkResults: EvaluationResultSummary[];
  currentBenchmarkRuns: RunSummary[];
  selectedCandidateId: string | null;
  resultRecordsState: ResultRecordsState;
  onViewChange: (view: RuntimeRootView) => void;
  onSelectCandidate: (candidateId: string) => void;
  showHeading?: boolean;
}) {
  const fillsBody = view === "lineage" || view === "results" || view === "runs";
  const candidateCountLabel = formatCount(currentBenchmarkSummaries.length, "candidate");
  const scopedActiveId =
    snapshot?.activeId && currentBenchmarkSummaries.some((summary) => summary.id === snapshot.activeId)
      ? snapshot.activeId
      : null;
  const scopedSnapshot = useMemo(
    () => snapshot
      ? {
          ...snapshot,
          activeId: scopedActiveId,
          currentBenchmarkFingerprint:
            currentBenchmarkSummaries[0]?.benchmarkFingerprint ??
            currentBenchmarkResults[0]?.benchmarkFingerprint ??
            currentBenchmarkRuns[0]?.benchmarkFingerprint ??
            null,
          summaries: currentBenchmarkSummaries,
          results: currentBenchmarkResults,
          runs: currentBenchmarkRuns,
          latestRun: currentBenchmarkRuns.at(-1) ?? null,
        }
      : null,
    [
      currentBenchmarkResults,
      currentBenchmarkRuns,
      currentBenchmarkSummaries,
      scopedActiveId,
      snapshot,
    ],
  );

  return (
    <div
      className={cn(
        "w-full min-w-0 max-w-full",
        fillsBody ? "flex h-full min-h-0 flex-1 flex-col gap-4" : "grid grid-cols-[minmax(0,1fr)] gap-4",
      )}
    >
      {showHeading ? (
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">Candidates</h2>
            {snapshot ? (
              <Badge variant="outline">{candidateCountLabel}</Badge>
            ) : null}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            Browse lineage, candidates, results, and runs for the selected benchmark version.
          </p>
        </div>
      ) : null}

      <Tabs
        value={view}
        onValueChange={(nextValue) => {
          if (
            nextValue === "lineage" ||
            nextValue === "archive" ||
            nextValue === "results" ||
            nextValue === "runs"
          ) {
            onViewChange(nextValue);
          }
        }}
        className={cn(
          "w-full min-w-0 max-w-full",
          fillsBody ? "flex min-h-0 flex-1 flex-col gap-4" : "grid grid-cols-[minmax(0,1fr)] gap-4",
        )}
      >
        <TabsList variant="line" aria-label="Benchmark version views" className="self-start">
          <TabsTrigger value="lineage">
            <GitBranchIcon data-icon="inline-start" />
            Lineage
          </TabsTrigger>
          <TabsTrigger value="archive">
            <FolderOpenIcon data-icon="inline-start" />
            Candidates
          </TabsTrigger>
          <TabsTrigger value="results">
            <ChartColumnIcon data-icon="inline-start" />
            Results
          </TabsTrigger>
          <TabsTrigger value="runs">
            <ActivityIcon data-icon="inline-start" />
            Runs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lineage" className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col">
          <CandidatesLineageSurface
            snapshot={scopedSnapshot}
            snapshotError={snapshotError}
            loading={snapshotLoading}
            selectedCandidateId={selectedCandidateId}
            onSelectCandidate={onSelectCandidate}
          />
        </TabsContent>
        <TabsContent value="archive" className="mt-0 min-w-0">
          <CandidatesArchiveSurface
            summaries={currentBenchmarkSummaries}
            activeId={scopedActiveId}
            snapshotError={snapshotError}
            loading={snapshotLoading}
            selectedCandidateId={selectedCandidateId}
            onSelectCandidate={onSelectCandidate}
          />
        </TabsContent>
        <TabsContent value="results" className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col">
          <ScrollableRuntimeSurface>
            <ResultsSurface
              snapshotError={snapshotError}
              snapshotLoading={snapshotLoading}
              results={currentBenchmarkResults}
              resultRecordsState={resultRecordsState}
            />
          </ScrollableRuntimeSurface>
        </TabsContent>
        <TabsContent value="runs" className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col">
          <ScrollableRuntimeSurface>
            <RunsSurface
              snapshotError={snapshotError}
              snapshotLoading={snapshotLoading}
              runs={currentBenchmarkRuns}
            />
          </ScrollableRuntimeSurface>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CandidatesArchiveSurface({
  summaries,
  activeId,
  snapshotError,
  loading,
  selectedCandidateId,
  onSelectCandidate,
}: {
  summaries: CandidateSummary[];
  activeId: string | null;
  snapshotError: string | null;
  loading: boolean;
  selectedCandidateId: string | null;
  onSelectCandidate: (candidateId: string) => void;
}) {
  if (snapshotError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{snapshotError}</CardContent>
      </Card>
    );
  }

  if (loading) {
    return <CandidateArchiveSkeleton />;
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <CandidateList
        summaries={summaries}
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
  snapshot: RuntimeSnapshot | null;
  snapshotError: string | null;
  loading: boolean;
  selectedCandidateId: string | null;
  onSelectCandidate: (candidateId: string) => void;
}) {
  if (snapshotError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{snapshotError}</CardContent>
      </Card>
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

function RunsSurface({
  snapshotError,
  snapshotLoading,
  runs,
}: {
  snapshotError: string | null;
  snapshotLoading: boolean;
  runs: RunSummary[];
}) {
  const nowMs = Date.now();

  if (snapshotError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{snapshotError}</CardContent>
      </Card>
    );
  }

  if (snapshotLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading runs
        </CardContent>
      </Card>
    );
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={ActivityIcon}
        eyebrow="Runs"
        title="No runs for this version"
        message="Runs appear here once Workbench executes this benchmark version."
        variant="hero"
        size="sm"
      />
    );
  }

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Runs</CardTitle>
          <Badge variant="outline">{formatCount(runs.length, "run")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-0 py-0">
        {runs.map((run) => (
          <div
            key={run.id}
            className="grid min-w-0 gap-2 border-b border-border/60 px-2 py-3 text-sm last:border-b-0"
          >
            <div className="grid min-w-0 gap-0.5">
              <span className="font-medium truncate">{formatTimestamp(run.startedAt)}</span>
              <span className="font-mono text-[11px] text-muted-foreground truncate">
                {shortId(run.id) ?? run.id}
              </span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Badge variant="outline">{formatRunWorkflow(run.workflow)}</Badge>
              <RunStatusBadge run={run} />
              <Badge variant="secondary">{formatRunPhaseStatus(run)}</Badge>
              <span className="text-sm tabular-nums text-muted-foreground">
                {formatRunDuration(run, nowMs)}
              </span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ScrollableRuntimeSurface({
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
  specError,
  snapshotError,
  snapshotLoading,
  selectedCandidateSummary,
  recordState,
}: {
  specError: string | null;
  snapshotError: string | null;
  snapshotLoading: boolean;
  selectedCandidateSummary: CandidateSummary | null;
  recordState: CandidateRecordState;
}) {
  if (specError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{specError}</CardContent>
      </Card>
    );
  }

  if (snapshotError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{snapshotError}</CardContent>
      </Card>
    );
  }

  if (snapshotLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading candidate
        </CardContent>
      </Card>
    );
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
      description="The candidate manifest defines how to run the candidate."
      source={sourceYamlFileFromCandidateRecord(recordState.record)}
      loading={recordState.loading}
      error={recordState.error}
      testId="candidate-yaml-source"
    />
  );
}

function CandidateFilesSurface({
  specError,
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
  specError: string | null;
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

  if (specError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{specError}</CardContent>
      </Card>
    );
  }

  if (snapshotError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{snapshotError}</CardContent>
      </Card>
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
      title="Mounted Candidate Files"
      icon={FolderOpenIcon}
      description="Files mounted under /workspace/input/candidate for run and improve executions."
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

function useRunDetail(
  apiPath: (pathname: string) => string,
  runId: string | null,
): RunDetailState {
  const [state, setState] = useState<RunDetailState>({
    loading: false,
    error: null,
    detail: null,
  });

  useEffect(() => {
    if (!runId) {
      setState({
        loading: false,
        error: null,
        detail: null,
      });
      return;
    }

    let cancelled = false;
    let inFlightController: AbortController | null = null;
    const params = new URLSearchParams({ id: runId });

    async function loadRunDetail() {
      if (inFlightController) {
        return;
      }
      const controller = new AbortController();
      inFlightController = controller;
      setState((current) => ({
        loading: true,
        error: null,
        detail: current.detail?.run.id === runId ? current.detail : null,
      }));
      try {
        const detail = await requestJson<{ run: HostedWorkbenchRun; jobs: HostedWorkbenchJob[] }>(
          apiPath(`/api/run?${params.toString()}`),
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
          detail: current.detail?.run.id === runId ? current.detail : null,
        }));
      } finally {
        if (inFlightController === controller) {
          inFlightController = null;
        }
      }
    }

    void loadRunDetail();

    return () => {
      cancelled = true;
      inFlightController?.abort();
    };
  }, [apiPath, runId]);

  return state;
}

function useRunTrace(
  apiPath: (pathname: string) => string,
  runId: string | null,
): TraceDetailState {
  const [state, setState] = useState<TraceDetailState>({
    loading: false,
    error: null,
    detail: null,
  });

  useEffect(() => {
    if (!runId) {
      setState({
        loading: false,
        error: null,
        detail: null,
      });
      return;
    }

    let cancelled = false;
    let inFlightController: AbortController | null = null;
    const params = new URLSearchParams({ run: runId });

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
  }, [apiPath, runId]);

  return state;
}

function CandidateEvaluationSurface({
  apiPath,
  snapshot,
  snapshotError,
  snapshotLoading,
  selectedCandidateSummary,
  recordState,
  specDocument,
  latestRun,
  latestRuns,
  onOpenCaseReview,
}: {
  apiPath: (pathname: string) => string;
  snapshot: RuntimeSnapshot | null;
  snapshotError: string | null;
  snapshotLoading: boolean;
  selectedCandidateSummary: CandidateSummary | null;
  recordState: CandidateRecordState;
  specDocument: AuthoredWorkbenchSourceDocument | null;
  latestRun: RuntimeSnapshot["latestRun"];
  latestRuns: RuntimeSnapshot["runs"];
  onOpenCaseReview: (caseId: string) => void;
}) {
  const evalRecord = recordState.record?.eval ?? null;
  const nowMs = Date.now();
  const shouldLoadRunDetail = Boolean(latestRun && selectedCandidateSummary);
  const runDetailState = useRunDetail(
    apiPath,
    shouldLoadRunDetail ? latestRun?.id ?? null : null,
  );

  if (snapshotError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{snapshotError}</CardContent>
      </Card>
    );
  }

  if (snapshotLoading) {
    return <CandidateEvaluationSkeleton />;
  }

  if (!snapshot || snapshot.summaries.length === 0 || !selectedCandidateSummary) {
    return (
      <EmptyState
        icon={PlayIcon}
        title="No candidate evaluation yet"
        message="Select or create a candidate to inspect its task-level evaluation."
        variant="hero"
        size="sm"
      />
    );
  }

  const cases = resolveEvaluationDisplayCases(evalRecord);
  const metricKeys = resolveEvaluationMetricKeys(cases, selectedCandidateSummary.metrics, "score", evalRecord?.metrics);
  const primaryMetricKey = metricKeys[0] ?? null;
  const primaryMetricValue = primaryMetricKey
    ? selectedCandidateSummary.metrics?.[primaryMetricKey]
    : undefined;
  const primaryMetricStats = primaryMetricKey ? evalRecord?.metrics?.[primaryMetricKey] : undefined;
  const candidateBenchmarkFingerprint =
    selectedCandidateSummary.benchmarkFingerprint.trim() || null;
  const taskRows = resolveEvaluationTaskRows({
    candidateId: selectedCandidateSummary.id,
    evalRecord,
    latestRun,
    metricKey: primaryMetricKey,
    nowMs,
    runJobs: runDetailState.detail?.jobs ?? [],
    specDocument,
  });
  const taskRowsLoading = recordState.loading || (runDetailState.loading && taskRows.length === 0);

  return (
    <div className="grid gap-6">
      <SurfaceSection title="Evaluation Tasks" icon={ListChecksIcon}>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {taskRowsLoading ? "loading tasks" : formatCount(taskRows.length, "task")}
          </Badge>
          {evalRecord ? (
            <Badge variant="outline">
              samples {evalRecord.completedSampleCount}/{evalRecord.sampleCount}
            </Badge>
          ) : latestRun ? (
            <Badge variant="outline">samples 0/{latestRun.samples}</Badge>
          ) : null}
          {primaryMetricKey && typeof primaryMetricValue === "number" ? (
            <Badge variant="outline">
              {primaryMetricKey} {formatCandidateMetricStats(primaryMetricStats, primaryMetricValue)}
            </Badge>
          ) : null}
        </div>

        {taskRowsLoading ? (
          <EvaluationTasksSkeleton />
        ) : recordState.error || (runDetailState.error && taskRows.length === 0) ? (
          <p className="text-sm text-destructive">{recordState.error ?? runDetailState.error}</p>
        ) : taskRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No task-level evaluation detail is available yet.</p>
        ) : (
          <Card size="sm">
            <CardContent className="py-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Samples</TableHead>
                      <TableHead>Split</TableHead>
                      <TableHead className="text-right">
                        {primaryMetricKey ?? "Metric"}
                      </TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {taskRows.map((task) => {
                      const openTask = () => {
                        if (task.detailAvailable) {
                          void onOpenCaseReview(task.id);
                        }
                      };
                      return (
                        <TableRow
                          key={task.id}
                          {...(task.detailAvailable
                            ? {
                                role: "button" as const,
                                tabIndex: 0,
                                onClick: openTask,
                                onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) =>
                                  handleCaseRowKeyDown(event, task.id, onOpenCaseReview),
                              }
                            : {})}
                          className={cn(task.detailAvailable && "cursor-pointer")}
                        >
                          <TableCell className="font-medium">
                            <div className="grid gap-0.5">
                              <span>{task.label}</span>
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {task.id}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>{task.status}</TableCell>
                          <TableCell className="tabular-nums">
                            {task.sampleCount > 0
                              ? `${task.completedSampleCount}/${task.sampleCount}`
                              : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {task.split ?? "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {typeof task.metricValue === "number"
                              ? formatMetricValue(task.metricValue)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {formatOptionalDuration(task.durationMs)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </SurfaceSection>

      <SurfaceSection title="Candidate Summary" icon={PlayIcon}>
        <div className="grid gap-3 md:grid-cols-4">
          <RunFact title="Candidate Created" value={formatTimestamp(selectedCandidateSummary.createdAt)} />
          <RunFact title="Candidate Status" value={statusLabel(selectedCandidateSummary.status)} />
          <RunFact
            title={primaryMetricKey ? `Candidate ${primaryMetricKey}` : "Candidate Score"}
            value={formatCandidateMetricStats(primaryMetricStats, primaryMetricValue)}
          />
          <RunFact
            title="Eval Samples"
            value={evalRecord ? `${evalRecord.completedSampleCount}/${evalRecord.sampleCount}` : "—"}
          />
        </div>

        <Card size="sm">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Provenance</CardTitle>
              <Badge variant="outline">benchmark version</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <RunFact
              title="Benchmark"
              value={formatBenchmarkFingerprint(candidateBenchmarkFingerprint)}
            />
            <RunFact
              title="Candidate Digest"
              value={shortFingerprint(selectedCandidateSummary.candidateFingerprint)}
            />
            <RunFact
              title="Candidate"
              value={shortId(selectedCandidateSummary.id) ?? selectedCandidateSummary.id}
            />
          </CardContent>
        </Card>

        {latestRun ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Latest Workspace Run</CardTitle>
              <CardDescription>{formatRunStartSummary(latestRun) ?? "Latest workspace run state."}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <RunFact title="Started" value={formatTimestamp(latestRun.startedAt)} />
              <RunFact title="Duration" value={formatRunDuration(latestRun, nowMs)} />
              <RunFact title="Outcome" value={formatRunOutcomeLabel(latestRun.outcome, latestRun.status)} />
            </CardContent>
          </Card>
        ) : null}

        {latestRuns.length > 0 ? (
          <div className="grid gap-2">
            {latestRuns.map((run) => (
              <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm">
                <span className="font-medium">{formatTimestamp(run.startedAt)}</span>
                <span className="text-muted-foreground">{formatRunDuration(run, nowMs)}</span>
                <span className="text-muted-foreground">{formatRunOutcomeLabel(run.outcome, run.status)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </SurfaceSection>
    </div>
  );
}

function RunRouteResolutionSurface({
  runId,
  state,
  resolving,
}: {
  runId: string | null;
  state: RunDetailState;
  resolving: boolean;
}) {
  if (!runId) {
    return (
      <EmptyState
        icon={ActivityIcon}
        title="No run selected"
        message="Run routes resolve to task execution traces when a task trace exists."
        variant="hero"
        size="sm"
      />
    );
  }

  if (resolving || (state.loading && !state.detail)) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Opening task trace
      </div>
    );
  }

  if (state.error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{state.error}</CardContent>
      </Card>
    );
  }

  return (
    <EmptyState
      icon={ActivityIcon}
      title="No task trace"
      message="This run has not produced a task execution trace yet."
      variant="hero"
      size="sm"
    />
  );
}

function ResultsSurface({
  snapshotError,
  snapshotLoading,
  results,
  resultRecordsState,
}: {
  snapshotError: string | null;
  snapshotLoading: boolean;
  results: EvaluationResultSummary[];
  resultRecordsState: ResultRecordsState;
}) {
  const resultIds = useMemo(
    () => new Set(results.map((result) => result.id)),
    [results],
  );
  const visibleRecords = useMemo(
    () => resultRecordsState.records.filter((record) => resultIds.has(record.id)),
    [resultIds, resultRecordsState.records],
  );

  if (snapshotError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{snapshotError}</CardContent>
      </Card>
    );
  }

  if (snapshotLoading) {
    return <ResultsDetailSkeleton />;
  }

  return (
    <ResultsDetail
      resultRecords={visibleRecords}
      loading={resultRecordsState.loading}
      error={resultRecordsState.error}
      hasResults={results.length > 0}
    />
  );
}

function resolveAuthoredCase(
  caseId: string,
  specDocument: AuthoredWorkbenchSourceDocument | null,
) {
  return specDocument?.cases.find((entry) => caseId === entry.id || caseId.startsWith(`${entry.id}__`)) ?? null;
}

function resolveEvaluationDisplayCases(evalRecord: EvaluationRecord | null): CandidateEvalCaseResult[] {
  return evalRecord?.samples.flatMap((sample) => sample.cases ?? []) ?? [];
}

function resolveLatestCompletedEvaluationSample(evalRecord: EvaluationRecord | null) {
  return [...(evalRecord?.samples ?? [])]
    .filter((sample) => sample.status === "completed")
    .sort((left, right) => right.index - left.index)[0] ?? null;
}

function resolveEvaluationTaskRows({
  candidateId,
  evalRecord,
  latestRun,
  metricKey,
  nowMs,
  runJobs,
  specDocument,
}: {
  candidateId: string;
  evalRecord: EvaluationRecord | null;
  latestRun: RuntimeSnapshot["latestRun"];
  metricKey: string | null;
  nowMs: number;
  runJobs: HostedWorkbenchJob[];
  specDocument: AuthoredWorkbenchSourceDocument | null;
}): EvaluationTaskRow[] {
  const rows = new Map<string, EvaluationTaskRow>();
  const expectedSampleCount = evalRecord?.sampleCount ?? latestRun?.samples ?? 0;
  const latestCompletedSample = resolveLatestCompletedEvaluationSample(evalRecord);
  const latestCompletedCases = latestCompletedSample?.cases ?? [];

  for (const caseStats of evalRecord?.cases ?? []) {
    const authoredCase = resolveAuthoredCase(caseStats.id, specDocument);
    const id = authoredCase?.id ?? caseStats.id;
    const metricValue = metricKey ? caseStats.metrics[metricKey]?.mean : null;
    rows.set(id, {
      ...(rows.get(id) ?? {
        id,
        label: caseStats.label ?? authoredCase?.name ?? id,
        split: caseStats.split ?? authoredCase?.split ?? null,
      }),
      id,
      label: authoredCase?.name ?? caseStats.label ?? id,
      status: caseStats.status ? formatCaseStatus(caseStats.status) : "completed",
      completedSampleCount: caseStats.sampleCount,
      sampleCount: caseStats.sampleCount,
      metricValue: typeof metricValue === "number" ? metricValue : null,
      durationMs: caseStats.durationMs?.mean ?? null,
      split: caseStats.split ?? authoredCase?.split ?? null,
      detailAvailable: false,
    });
  }

  for (const caseResult of latestCompletedCases) {
    const authoredCase = resolveAuthoredCase(caseResult.id, specDocument);
    const id = authoredCase?.id ?? caseResult.id;
    const current = rows.get(id);
    const metricValue = metricKey
      ? caseResult.metrics[metricKey]
      : firstMetricValue(caseResult.metrics);
    const caseDurationMs = readCaseDurationMs(
      caseResult,
      latestCompletedCases.length === 1 ? latestCompletedSample?.durationMs : undefined,
    );
    rows.set(id, {
      ...(current ?? {
        id,
        label: authoredCase?.name ?? caseResult.label ?? id,
        completedSampleCount: 1,
        sampleCount: evalRecord?.sampleCount ?? 1,
        durationMs: caseDurationMs,
        split: caseResult.split ?? authoredCase?.split ?? null,
      }),
      id,
      label: authoredCase?.name ?? caseResult.label ?? id,
      status: caseResult.status ? formatCaseStatus(caseResult.status) : current?.status ?? "completed",
      metricValue: typeof metricValue === "number" ? metricValue : current?.metricValue ?? null,
      durationMs: current?.durationMs ?? caseDurationMs,
      detailAvailable: true,
    });
  }

  for (const [caseId, jobs] of groupExecutionJobsByCase(runJobs, candidateId)) {
    const authoredCase = resolveAuthoredCase(caseId, specDocument);
    const current = rows.get(caseId);
    const executionStatus = formatExecutionTaskStatus(jobs);
    const useRuntimeState = latestRun?.status !== "finished" || !current?.detailAvailable;
    const sampleIndices = new Set(
      jobs
        .map((job) => readRunJobNumber(job, "sampleIndex"))
        .filter((index): index is number => typeof index === "number"),
    );
    const completedSampleCount = countCompletedExecutionSamples(jobs);
    const sampleCount =
      current?.sampleCount ?? (expectedSampleCount || sampleIndices.size || 1);
    rows.set(caseId, {
      ...(current ?? {
        id: caseId,
        label: authoredCase?.name ?? caseId,
        completedSampleCount,
        sampleCount,
        metricValue: null,
        durationMs: null,
        split: authoredCase?.split ?? null,
      }),
      id: caseId,
      label: current?.label ?? authoredCase?.name ?? caseId,
      status: useRuntimeState ? executionStatus : current?.status ?? executionStatus,
      completedSampleCount: useRuntimeState
        ? completedSampleCount
        : current?.completedSampleCount ?? completedSampleCount,
      sampleCount,
      metricValue: useRuntimeState && executionStatus !== "completed"
        ? null
        : current?.metricValue ?? null,
      durationMs: useRuntimeState
        ? resolveExecutionJobsDurationMs(jobs, nowMs)
        : current?.durationMs ?? resolveExecutionJobsDurationMs(jobs, nowMs),
      split: current?.split ?? authoredCase?.split ?? null,
      detailAvailable: true,
    });
  }

  return Array.from(rows.values());
}

interface RunTraceRouteTarget {
  candidateId: string;
  caseId: string;
  runId: string;
}

function resolveRunTraceRouteTarget(
  detail: RunDetailState["detail"],
  requestedRunId: string | null,
): RunTraceRouteTarget | null {
  if (!detail || !requestedRunId || detail.run.id !== requestedRunId) {
    return null;
  }
  const taskJobs = detail.jobs
    .filter((job) => {
      const purpose = readRunJobPurpose(job);
      return purpose === "run-task" || purpose === "grade-task";
    })
    .filter((job) => readRunJobCandidateId(job) && readRunJobString(job, "caseId"))
    .sort(compareRunTraceRouteJobs);
  const job = taskJobs[0] ?? null;
  const candidateId = job ? readRunJobCandidateId(job) : null;
  const caseId = job ? readRunJobString(job, "caseId") : null;
  if (!job || !candidateId || !caseId) {
    return null;
  }
  return {
    candidateId,
    caseId,
    runId: detail.run.id,
  };
}

function compareRunTraceRouteJobs(
  left: HostedWorkbenchJob,
  right: HostedWorkbenchJob,
): number {
  const leftRank = runTraceRouteJobRank(left);
  const rightRank = runTraceRouteJobRank(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return (left.startedAt ?? left.createdAt).localeCompare(right.startedAt ?? right.createdAt);
}

function runTraceRouteJobRank(job: HostedWorkbenchJob): number {
  if (job.status === "succeeded" && readRunJobPurpose(job) === "run-task") {
    return 0;
  }
  if (job.status === "succeeded" && readRunJobPurpose(job) === "grade-task") {
    return 1;
  }
  if (job.status === "running") {
    return 2;
  }
  if (job.status === "queued") {
    return 3;
  }
  return 4;
}

function groupExecutionJobsByCase(
  jobs: HostedWorkbenchJob[],
  candidateId: string,
): Map<string, HostedWorkbenchJob[]> {
  const byCase = new Map<string, HostedWorkbenchJob[]>();
  for (const job of jobs) {
    if (readRunJobCandidateId(job) !== candidateId) {
      continue;
    }
    const purpose = readRunJobPurpose(job);
    if (purpose !== "run-task" && purpose !== "grade-task") {
      continue;
    }
    const caseId = readRunJobString(job, "caseId");
    if (!caseId) {
      continue;
    }
    byCase.set(caseId, [...(byCase.get(caseId) ?? []), job]);
  }
  return byCase;
}

function readRunJobCandidateId(job: HostedWorkbenchJob): string | null {
  return job.candidateId ?? readRunJobString(job, "candidateId");
}

function countCompletedExecutionSamples(jobs: HostedWorkbenchJob[]): number {
  const sampleIndices = new Set<number>();
  let completedWithoutSampleIndex = 0;
  for (const job of jobs) {
    if (job.status !== "succeeded") {
      continue;
    }
    const sampleIndex = readRunJobNumber(job, "sampleIndex");
    if (typeof sampleIndex === "number") {
      sampleIndices.add(sampleIndex);
    } else {
      completedWithoutSampleIndex += 1;
    }
  }
  return sampleIndices.size + completedWithoutSampleIndex;
}

function formatExecutionTaskStatus(jobs: HostedWorkbenchJob[]): string {
  return formatOperationalStatus(resolveExecutionCollectionStatus(jobs, "pending"));
}

function resolveExecutionJobsDurationMs(
  jobs: HostedWorkbenchJob[],
  nowMs: number,
): number | null {
  return resolveTimedExecutionRecordsDurationMs(jobs, nowMs);
}

function readRunJobPurpose(job: HostedWorkbenchJob): string | null {
  return readRunJobString(job, "purpose");
}

function readRunJobString(
  job: HostedWorkbenchJob,
  key: string,
): string | null {
  const raw = readRunJobValue(job, key);
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function readRunJobNumber(
  job: HostedWorkbenchJob,
  key: string,
): number | null {
  const raw = readRunJobValue(job, key);
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function readRunJobValue(job: HostedWorkbenchJob, key: string): unknown {
  const input = asUiRecord(job.input);
  const execution = asUiRecord(input?.execution);
  const metadata = asUiRecord(execution?.metadata);
  return key === "purpose" ? execution?.purpose : metadata?.[key] ?? null;
}

function asUiRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstMetricValue(metrics: Record<string, number>): number | null {
  const [value] = Object.values(metrics);
  return typeof value === "number" ? value : null;
}

function resolveEvaluationMetricKeys(
  cases: CandidateEvalCaseResult[],
  candidateMetrics: Record<string, number> | undefined,
  preferredMetricKey: string | null,
  aggregateMetrics?: EvaluationRecord["metrics"],
): string[] {
  const available = new Set<string>();
  for (const key of Object.keys(candidateMetrics ?? {})) {
    available.add(key);
  }
  for (const key of Object.keys(aggregateMetrics ?? {})) {
    available.add(key);
  }
  for (const caseResult of cases) {
    for (const key of Object.keys(caseResult.metrics)) {
      available.add(key);
    }
  }

  const ordered: string[] = [];
  const add = (key: string | null | undefined) => {
    if (key && available.has(key) && !ordered.includes(key)) {
      ordered.push(key);
    }
  };

  add(preferredMetricKey);
  add("score");
  add("reward");
  for (const key of Array.from(available).sort()) {
    add(key);
  }
  return ordered;
}

function formatCandidateMetricStats(
  stats: NonNullable<EvaluationRecord["metrics"]>[string] | undefined,
  directValue: number | undefined,
): string {
  if (stats) {
    return stats.count > 1
      ? `${formatMetricValue(stats.mean)} ± ${formatMetricValue(stats.stddev)}`
      : formatMetricValue(stats.mean);
  }
  return typeof directValue === "number" ? formatMetricValue(directValue) : "—";
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

function readCaseDurationMs(
  caseResult: CandidateEvalCaseResult,
  sampleDurationMs?: number,
): number | null {
  if (typeof caseResult.durationMs === "number" && Number.isFinite(caseResult.durationMs)) {
    return caseResult.durationMs;
  }
  if (typeof sampleDurationMs === "number" && Number.isFinite(sampleDurationMs)) {
    return sampleDurationMs;
  }
  return null;
}

function formatCaseStatus(status: CandidateEvalCaseResult["status"] | undefined): string {
  return formatOperationalStatus(status);
}

function formatOperationalStatus(status: string | null | undefined): string {
  switch (status) {
    case "succeeded":
      return "completed";
    case "failed":
      return "error";
    case "cancelled":
      return "cancelled";
    case "queued":
    case "running":
    case "completed":
    case "error":
    case "pending":
      return status;
    default:
      return "—";
  }
}

function handleCaseRowKeyDown(
  event: KeyboardEvent<HTMLTableRowElement>,
  caseId: string,
  onOpenCaseReview: (caseId: string) => void,
): void {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  onOpenCaseReview(caseId);
}

function formatOptionalDuration(durationMs: number | null): string {
  return durationMs === null ? "—" : formatDurationMs(durationMs);
}

function formatRunDuration(run: RunSummary, nowMs: number): string {
  const durationMs = resolveTimedDurationMs({
    active: run.status !== "finished",
    durationMs: run.durationMs,
    finishedAt: run.finishedAt,
    nowMs,
    startedAt: run.startedAt,
  });
  return durationMs === null ? "unknown" : formatDurationMs(durationMs);
}

function resolveCaseReviewStatus(review: CandidateCaseReview): string | null {
  if (review.status) {
    return review.status;
  }
  return review.phases.length > 0
    ? resolveExecutionCollectionStatus(review.phases, "pending")
    : null;
}

function resolveCaseReviewDurationMs(
  review: CandidateCaseReview,
  nowMs: number,
): number | null {
  const activeDurationMs = resolvePhaseRefsDurationMs(review.phases, nowMs);
  if (hasActivePhaseRecords(review.phases)) {
    return activeDurationMs ?? review.durationMs ?? null;
  }
  return review.durationMs ?? activeDurationMs;
}

function resolvePhaseRefsDurationMs(
  phases: CandidateCasePhase[],
  nowMs: number,
): number | null {
  return resolveTimedExecutionRecordsDurationMs(phases, nowMs);
}

function resolveExecutionCollectionStatus(
  records: Array<{ status: HostedWorkbenchJob["status"] }>,
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

function isActiveExecutionStatus(status: HostedWorkbenchJob["status"]): boolean {
  return status === "queued" || status === "running";
}

function isTimedExecutionStatus(status: HostedWorkbenchJob["status"]): boolean {
  return status === "running";
}

function hasActivePhaseRecords(records: readonly { status: HostedWorkbenchJob["status"] }[]): boolean {
  return records.some((record) => isActiveExecutionStatus(record.status));
}

function CaseReviewDialog({
  apiPath,
  state,
  onOpenChange,
  onTabChange,
}: {
  apiPath: (pathname: string) => string;
  state: CaseReviewState;
  onOpenChange: (open: boolean) => void;
  onTabChange: (tab: CaseReviewTab) => void;
}) {
  const review = state.review;
  const activeTab = state.tab;
  const nowMs = Date.now();
  const reviewStatus = review ? resolveCaseReviewStatus(review) : null;
  const reviewDurationMs = review ? resolveCaseReviewDurationMs(review, nowMs) : null;

  return (
    <InspectorDialogShell
      open={state.open}
      onOpenChange={onOpenChange}
      title={state.review?.caseLabel ?? state.caseId ?? "Task Review"}
      description="Inspect task metrics, scoring detail, execution traces, files, and raw data."
      className="h-[min(94vh,calc(100dvh-1rem))]"
      bodyClassName="flex min-h-0 flex-1 flex-col gap-4"
    >
      {state.loading ? (
        <CaseReviewSkeleton />
      ) : state.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : !review ? (
        <p className="text-sm text-muted-foreground">No task detail was found.</p>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap gap-2">
            {Object.entries(review.metrics).map(([key, value]) => (
              <Badge key={key} variant="outline">
                {key} {formatMetricValue(value)}
              </Badge>
            ))}
            {reviewStatus ? <Badge variant="outline">{formatOperationalStatus(reviewStatus)}</Badge> : null}
            <Badge variant="outline">{formatCriterionCount(review.criteria_results.length)}</Badge>
            <Badge variant="outline">
              {review.phases.length > 0
                ? formatCount(review.phases.length, "execution")
                : "no executions"}
            </Badge>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(value) => onTabChange(value as CaseReviewTab)}
            className="flex min-h-0 flex-1 flex-col gap-4"
          >
            <TabsList variant="line" className="self-start">
              <TabsTrigger value="overview">
                <InfoIcon data-icon="inline-start" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="scoring">
                <ListChecksIcon data-icon="inline-start" />
                Scoring
              </TabsTrigger>
              <TabsTrigger value="trace">
                <ActivityIcon data-icon="inline-start" />
                Trace
              </TabsTrigger>
              <TabsTrigger value="files">
                <FolderOpenIcon data-icon="inline-start" />
                Files
              </TabsTrigger>
              <TabsTrigger value="raw">
                <FileCode2Icon data-icon="inline-start" />
                Raw
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-0 flex min-h-0 flex-1 flex-col">
              <CaseReviewTabViewport>
                <div className="grid gap-3 md:grid-cols-3">
                  <RunFact title="Status" value={reviewStatus ?? "—"} />
                  <RunFact title="Duration" value={formatOptionalDuration(reviewDurationMs)} />
                  <RunFact title="Executions" value={String(review.phases.length)} />
                </div>

                <StructuredValueCard title="Metrics" value={review.metrics} />
              </CaseReviewTabViewport>
            </TabsContent>

            <TabsContent value="scoring" className="mt-0 flex min-h-0 flex-1 flex-col">
              <CaseReviewTabViewport contentClassName={review.criteria_results.length > 0 ? "gap-0 p-0" : undefined}>
                {review.feedback !== undefined ? (
                  <div className="p-4">
                    <StructuredValueCard title="Feedback" value={review.feedback} />
                  </div>
                ) : null}

                {review.source ? (
                  <div className="px-4 pb-4">
                    <StructuredValueCard title="Source" value={review.source} />
                  </div>
                ) : null}

                {review.criteria_results.length > 0 ? (
                  <>
                  <div className="grid gap-0 sm:hidden">
                    {review.criteria_results.map((criterion) => (
                      <div
                        key={criterion.criterion_id}
                        className="grid gap-2 border-t border-border/60 px-4 py-3 first:border-t-0"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 font-mono text-xs break-words [overflow-wrap:anywhere]">
                            {criterion.criterion_id}
                          </div>
                          <Badge variant="outline" className="shrink-0 tabular-nums">
                            {criterion.pass ? "1" : "0"}
                          </Badge>
                        </div>
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
                    ))}
                  </div>

                  <div className="hidden sm:block">
                    <Table className="table-fixed">
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
                    </Table>
                  </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No scoring criteria were recorded for this task.</p>
                )}
              </CaseReviewTabViewport>
            </TabsContent>

            <TabsContent value="trace" className="mt-0 flex min-h-0 flex-1 flex-col">
              <TaskExecutionTraceTab apiPath={apiPath} review={review} preferredRunId={state.runId} />
            </TabsContent>

            <TabsContent value="files" className="mt-0 flex min-h-0 flex-1 flex-col">
              <TaskExecutionFilesTab apiPath={apiPath} review={review} />
            </TabsContent>

            <TabsContent value="raw" className="mt-0 flex min-h-0 flex-1 flex-col">
              <CaseReviewTabViewport>
                <CodeBlockSurface
                  value={JSON.stringify(review, null, 2)}
                  language="json"
                  surface="plain"
                />
              </CaseReviewTabViewport>
            </TabsContent>
          </Tabs>
        </>
      )}
    </InspectorDialogShell>
  );
}

function TaskExecutionTraceTab({
  apiPath,
  review,
  preferredRunId,
}: {
  apiPath: (pathname: string) => string;
  review: CandidateCaseReview;
  preferredRunId: string | null;
}) {
  const phases = review.phases;
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const activePhase =
    phases.find((entry) => phaseSelectorValue(entry) === selectedPhase) ??
    phases[0] ??
    null;
  const traceState = useRunTrace(apiPath, activePhase?.runId ?? null);

  useEffect(() => {
    const preferredPhase = preferredRunId
      ? phases.find((phase) => phase.runId === preferredRunId)
      : null;
    setSelectedPhase((current) => {
      const currentPhase = current
        ? phases.find((entry) => phaseSelectorValue(entry) === current)
        : null;
      if (currentPhase && (!preferredRunId || currentPhase.runId === preferredRunId)) {
        return current;
      }
      return preferredPhase
        ? phaseSelectorValue(preferredPhase)
        : phases[0] ? phaseSelectorValue(phases[0]) : null;
    });
  }, [phases, preferredRunId]);

  const tracePhase = useMemo(
    () =>
      activePhase
        ? (traceState.detail?.phases ?? []).find(
            (phase) => phase.jobIds.some((jobId) => activePhase.jobIds.includes(jobId)),
          ) ?? null
        : null,
    [activePhase, traceState.detail?.phases],
  );
  const timeline = useMemo(
    () =>
      tracePhase
        ? buildExecutionTraceTimeline({
            trace: tracePhase.trace as ExecutionTrace,
          })
        : { groups: [], stageMaps: [] },
    [tracePhase],
  );

  if (phases.length === 0) {
    return (
      <CaseReviewTabViewport>
        <EmptyState
          icon={ActivityIcon}
          title="No execution trace"
          message="No task execution was recorded for this task."
          size="sm"
        />
      </CaseReviewTabViewport>
    );
  }

  return (
    <CaseReviewTabViewport contentClassName="gap-3">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={activePhase ? phaseSelectorValue(activePhase) : ""}
        onValueChange={(value) => {
          if (value) {
            setSelectedPhase(value);
          }
        }}
      >
        {phases.map((phase) => (
          <ToggleGroupItem
            key={phaseSelectorValue(phase)}
            value={phaseSelectorValue(phase)}
            aria-label={`Show ${formatPhaseLabel(phase.phase)} trace`}
          >
            {formatPhaseSelectorLabel(phase)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {traceState.error ? (
        <p className="text-sm text-destructive">{traceState.error}</p>
      ) : traceState.loading && !tracePhase ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading execution trace
        </div>
      ) : tracePhase ? (
        <div className="grid gap-3">
          <div className="grid gap-2">
            <div className="grid gap-1">
              <h3 className="text-base font-semibold text-foreground">Execution Trace</h3>
              <p className="text-sm text-muted-foreground">
                {describePhaseTrace(activePhase, tracePhase)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {formatPhaseLabel(activePhase?.phase ?? tracePhase.phase)}
              </Badge>
              <Badge variant="outline">{activePhase?.status ?? tracePhase.status}</Badge>
              {typeof activePhase?.sampleIndex === "number" ? (
                <Badge variant="outline">sample {activePhase.sampleIndex + 1}</Badge>
              ) : null}
            </div>
          </div>

          <ExecutionTraceTimeline executionTimeline={timeline} layout="content" />
        </div>
      ) : (
        <EmptyState
          icon={ActivityIcon}
          title="No execution trace"
          message="No trace events were recorded for this execution."
          size="sm"
        />
      )}
    </CaseReviewTabViewport>
  );
}

function formatPhaseLabel(purpose: string): string {
  if (purpose === "run-task") {
    return "Runner";
  }
  if (purpose === "grade-task") {
    return "Grader";
  }
  if (purpose === "improve") {
    return "Optimizer";
  }
  return formatLabelText(purpose);
}

function phaseSelectorValue(phase: CandidateCasePhase): string {
  return `${phase.runId}:${phase.phase}:${phase.sampleIndex ?? "current"}`;
}

function formatPhaseSelectorLabel(phase: CandidateCasePhase): string {
  const label = formatPhaseLabel(phase.phase);
  return phase.status === "succeeded" ? label : `${label} · ${phase.status}`;
}

function describePhaseTrace(
  phase: CandidateCasePhase | null,
  tracePhase: WorkbenchTracePhase,
): string {
  const parts = [
    formatPhaseLabel(phase?.phase ?? tracePhase.phase),
    tracePhase.caseId ? `task ${tracePhase.caseId}` : null,
    typeof (phase?.sampleIndex ?? tracePhase.sampleIndex) === "number"
      ? `sample ${(phase?.sampleIndex ?? tracePhase.sampleIndex)! + 1}`
      : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}

function formatLabelText(value: string): string {
  return value.replaceAll(/[_-]+/g, " ").replace(/^\w/u, (match) => match.toUpperCase());
}

function TaskExecutionFilesTab({
  apiPath,
  review,
}: {
  apiPath: (pathname: string) => string;
  review: CandidateCaseReview;
}) {
  const outputPhase = review.phases.find((entry) => entry.phase === "run-task") ?? review.phases[0] ?? null;
  const outputJobId = outputPhase?.jobIds[0] ?? null;
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
  }, [review.candidateId, review.caseId, outputPhase?.runId, outputJobId]);

  useEffect(() => {
    if (!outputPhase || !outputJobId) {
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
      run: outputPhase.runId,
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
  }, [apiPath, outputPhase?.runId, outputJobId]);

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
    if (!outputPhase || !outputJobId || !selectedFilePath) {
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
      run: outputPhase.runId,
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
  }, [apiPath, outputPhase?.runId, outputJobId, previewMode, selectedFilePath]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <RunFact
          title="Run"
          value={outputPhase ? (shortId(outputPhase.runId) ?? outputPhase.runId) : "not recorded"}
        />
        <RunFact
          title="Files"
          value={outputPhase ? (executionFilesState.loading ? "loading" : String(executionFilesState.files.length)) : "not recorded"}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
          emptyMessage={outputPhase ? "No files were captured for this task." : "No output file reference was recorded for this task."}
          emptySelectionMessage="Select an execution file to preview."
          listErrorMessage="Couldn't load the execution file list."
          previewErrorMessage="Couldn't load the execution file preview."
          onSelectFile={(filePath) => {
            setSelectedFilePath(filePath);
            setDirectoryPath(directoryPathForFile(filePath));
          }}
          onDirectoryChange={setDirectoryPath}
          onPreviewModeChange={(mode) => setPreviewMode(mode as CandidatePreviewMode)}
        />
      </div>
    </div>
  );
}

function CaseReviewTabViewport({
  children,
  className,
  contentClassName,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div
      className={cn(
        "min-h-0 min-w-0 flex-1 overflow-y-auto rounded-lg border border-border/60 bg-background",
        className,
      )}
    >
      <div className={cn("grid min-w-0 gap-3 p-4", contentClassName)}>
        {children}
      </div>
    </div>
  );
}

function RunFact({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-muted/35 px-4 py-3">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="mt-2 text-sm font-medium text-foreground">{value}</div>
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
  specDocument: AuthoredWorkbenchSourceDocument | null;
}): string | null {
  if (args.routeFilePath && args.files.some((entry) => entry.path === args.routeFilePath)) {
    return args.routeFilePath;
  }
  return pickDefaultCandidateFile(args.files, args.specDocument);
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
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function orderResultSummaries(results: EvaluationResultSummary[]): EvaluationResultSummary[] {
  return results
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
  results: EvaluationResultSummary[];
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
      resultCount: 0,
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
  for (const result of args.results) {
    const option = ensure(result.benchmarkFingerprint);
    if (option) {
      option.resultCount += 1;
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
      right.resultCount - left.resultCount ||
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

function formatRunOutcomeLabel(
  outcome: RunOutcome | undefined,
  status: RunStatus,
): string {
  if (outcome === "ok") {
    return "ok";
  }
  if (outcome === "error") {
    return "error";
  }
  if (outcome === "cancelled") {
    return "cancelled";
  }
  return status;
}

function formatRunWorkflow(workflow: RunSummary["workflow"]): string {
  switch (workflow) {
    case "eval":
      return "Eval";
    case "improve":
      return "Improve";
    default:
      return workflow;
  }
}

function formatRunPhaseStatus(run: RunSummary): string {
  if (run.status === "queued") {
    return "queued";
  }
  if (run.status === "running") {
    return run.workflow === "improve" ? "improving" : "evaluating";
  }
  if (run.outcome === "error") {
    return "error";
  }
  if (run.outcome === "cancelled") {
    return "cancelled";
  }
  switch (run.stoppedReason) {
    case "budget_exhausted":
      return "budget exhausted";
    case "dry_run":
      return "dry run";
    case "cancelled":
      return "cancelled";
    case "completed":
      return "completed";
    default:
      return run.status;
  }
}

function runStatusTone(run: RunSummary): BadgeTone {
  if (run.outcome === "error") {
    return "destructive";
  }
  if (run.status === "queued" || run.status === "running") {
    return "warning";
  }
  if (run.outcome === "ok" || run.stoppedReason === "completed") {
    return "success";
  }
  return "outline";
}

function RunStatusBadge({ run }: { run: RunSummary }) {
  const tone = badgeToneProps(runStatusTone(run));
  return (
    <Badge variant={tone.variant} className={tone.className}>
      {formatRunOutcomeLabel(run.outcome, run.status)}
    </Badge>
  );
}

function formatBenchmarkFingerprint(value: string | null): string {
  if (!value) {
    return "not recorded";
  }
  return shortDigest(value);
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
