"use client";

import { Fragment, startTransition, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ActivityIcon,
  ChartColumnIcon,
  FileCode2Icon,
  FolderOpenIcon,
  GitBranchIcon,
  InfoIcon,
  ListChecksIcon,
  PanelRightCloseIcon,
  Settings2Icon,
} from "lucide-react";
import { CodeBlockSurface } from "@workbench-ai/cli-web-ui/components/shared/code-block-surface";
import {
  DesktopWorkspaceSplit,
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
import { badgeToneProps, type BadgeTone } from "@workbench-ai/cli-web-ui/lib/badge";

import { SubjectList } from "./components/subject-list";
import { EvaluationsDetail } from "./components/evaluations-detail";
import {
  SubjectArchiveSkeleton,
  SubjectOverviewSkeleton,
  SubjectFilesSurfaceSkeleton,
  EvaluationCaseRowsSkeleton,
  EvaluationDetailSurfaceSkeleton,
  EvaluationCaseDetailSkeleton,
  ExecutionTraceSkeleton,
  EvaluationsDetailSkeleton,
  LineageSurfaceSkeleton,
  BenchmarkSurfaceSkeleton,
  SourceYamlSkeleton,
  SubjectManifestSkeleton,
} from "./components/loading-states";
import { LineageGraph } from "./components/lineage-graph";
import { StatusBadge } from "./components/status-badge";
import { SurfaceSection } from "./components/surface-section";
import { requestJson, toMessage } from "./lib/api";
import { pickDefaultSubjectFile } from "./lib/subject-file-preference";
import { orderSubjectFiles } from "./lib/subject-files";
import {
  filterSubjectSummariesByBenchmark,
  normalizeBenchmarkFingerprint,
} from "./lib/subject-scope";
import {
  formatDurationMs,
  formatMetricValue,
  formatSubjectDisplayName,
  formatTimestamp,
  shortId,
  statusLabel,
} from "./lib/format";
import {
  buildWorkbenchLocationHref,
  createEvaluationsRoute,
  createSubjectRoute,
  createSubjectsRoute,
  createBenchmarkRoute,
  parseWorkbenchLocation,
  parseWorkbenchRoute,
  type SubjectDialog,
  type SubjectView,
  type WorkbenchPersistentSearchParams,
  type WorkbenchRoute,
} from "./lib/routes";
import type {
  SubjectCaseReview,
  SubjectPreviewMode,
  SubjectRecord,
  SubjectSummary,
  EvaluationRecord,
  EvaluationScorecard,
  EvaluationSummary,
  SubjectWorkspaceFilePreview,
  SubjectWorkspaceFileSummary,
  AuthoredWorkbenchSourceDocument,
  HostedWorkbenchJob,
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

interface SubjectRecordState {
  loading: boolean;
  error: string | null;
  record: SubjectRecord | null;
}

interface EvaluationRecordsState {
  loading: boolean;
  error: string | null;
  records: EvaluationScorecard[];
}

interface CaseReviewDetailState {
  loading: boolean;
  error: string | null;
  review: SubjectCaseReview | null;
  requestKey: string | null;
}

interface SubjectFilesState {
  loading: boolean;
  error: string | null;
  files: SubjectWorkspaceFileSummary[];
}

interface SourceYamlFile {
  path: string;
  content: string;
}

type SubjectCaseExecution = SubjectCaseReview["executions"][number];
type TimedExecutionRecord = {
  status: HostedWorkbenchJob["status"];
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

interface SubjectPreviewState {
  loading: boolean;
  error: string | null;
  preview: SubjectWorkspaceFilePreview | null;
}

type BenchmarkSurfaceTab = "processed" | "manifest" | "files";

interface BenchmarkFingerprintOption {
  fingerprint: string;
  subjectCount: number;
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
  files: SubjectWorkspaceFileSummary[];
}

interface ExecutionPreviewState {
  loading: boolean;
  error: string | null;
  preview: SubjectWorkspaceFilePreview | null;
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
  const [specLoading, setSpecLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [recordState, setRecordState] = useState<SubjectRecordState>({
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
  const [subjectFilesState, setSubjectFilesState] = useState<SubjectFilesState>({
    loading: false,
    error: null,
    files: [],
  });
  const [subjectPreviewState, setSubjectPreviewState] = useState<SubjectPreviewState>({
    loading: false,
    error: null,
    preview: null,
  });
  const [benchmarkFilesState, setBenchmarkFilesState] = useState<SubjectFilesState>({
    loading: false,
    error: null,
    files: [],
  });
  const [selectedBenchmarkFilePath, setSelectedBenchmarkFilePath] = useState<string | null>(null);
  const [benchmarkPreviewMode, setBenchmarkPreviewMode] = useState<SubjectPreviewMode>("rendered");
  const [benchmarkDirectoryPath, setBenchmarkDirectoryPath] = useState<string | null>(null);
  const [benchmarkPreviewState, setBenchmarkPreviewState] = useState<SubjectPreviewState>({
    loading: false,
    error: null,
    preview: null,
  });
  const [desktopDetailLeftPercent, setDesktopDetailLeftPercent] = useState(readDesktopDetailLeftPercent);
  const benchmarkSurfaceFillsBody = benchmarkSurfaceTab === "files";
  const shouldLoadBenchmarkSourceFiles = benchmarkSurfaceTab === "files";

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setSnapshotLoading(true);
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
        });
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setSnapshotError(toMessage(error));
          setSnapshotLoading(false);
        }
      }
    }

    void loadSnapshot();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiPath]);

  const orderedSubjectSummaries = useMemo(
    () => snapshot ? orderSubjectSummaries(snapshot.summaries) : [],
    [snapshot],
  );
  const currentBenchmarkFingerprint = normalizeBenchmarkFingerprint(snapshot?.currentBenchmarkFingerprint);
  const benchmarkFingerprintOptions = useMemo(
    () => buildBenchmarkFingerprintOptions({
      currentBenchmarkFingerprint,
      summaries: orderedSubjectSummaries,
      evaluations: snapshot?.evaluations ?? [],
      runs: snapshot?.runs ?? [],
    }),
    [currentBenchmarkFingerprint, orderedSubjectSummaries, snapshot?.evaluations, snapshot?.runs],
  );
  const scopedBenchmarkFingerprint =
    selectedBenchmarkFingerprint &&
      benchmarkFingerprintOptions.some((option) => option.fingerprint === selectedBenchmarkFingerprint)
      ? selectedBenchmarkFingerprint
      : currentBenchmarkFingerprint ?? benchmarkFingerprintOptions[0]?.fingerprint ?? null;
  const currentBenchmarkSummaries = useMemo(
    () => filterSubjectSummariesByBenchmark({
      summaries: orderedSubjectSummaries,
      benchmarkFingerprint: scopedBenchmarkFingerprint,
    }),
    [orderedSubjectSummaries, scopedBenchmarkFingerprint],
  );
  const currentBenchmarkEvaluations = useMemo(
    () => snapshot
      ? orderEvaluationSummaries(snapshot.evaluations).filter(
          (evaluation) => normalizeBenchmarkFingerprint(evaluation.benchmarkFingerprint) === scopedBenchmarkFingerprint,
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
  const routeEvaluationDialog =
    (route.kind === "subject" || route.kind === "evaluations") &&
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
  const selectedSubjectId = resolveSelectedSubjectId({
    route,
    activeId: snapshot?.activeId ?? null,
    summaries: currentBenchmarkSummaries,
  });
  const selectedSubjectSummary = selectedSubjectId
    ? currentBenchmarkSummaries.find((summary) => summary.id === selectedSubjectId) ?? null
    : null;
  const selectedSubjectHasInspectableFiles = Boolean(selectedSubjectSummary);
  const orderedSubjectFiles = useMemo(
    () => orderSubjectFiles(subjectFilesState.files),
    [subjectFilesState.files],
  );
  const orderedBenchmarkFiles = useMemo(
    () => orderSubjectFiles(benchmarkFilesState.files),
    [benchmarkFilesState.files],
  );
  const selectedSubjectFilePath = route.kind === "subject" && route.view === "files"
    ? resolveSelectedSubjectFilePath({
        routeFilePath: route.filePath,
        files: orderedSubjectFiles,
        specDocument,
      })
    : null;
  const subjectPreviewMode = route.kind === "subject" && route.view === "files"
    ? route.previewMode
    : "rendered";
  const subjectDirectoryPath = route.kind === "subject" && route.view === "files"
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

    void requestJson<SubjectWorkspaceFileSummary[]>(
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

    void requestJson<SubjectWorkspaceFilePreview>(
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
    if (route.kind !== "subject") {
      return;
    }
    if (snapshot === null) {
      return;
    }
    if (!selectedSubjectId) {
      navigate(createSubjectsRoute(), { replace: true });
      return;
    }

    if (route.subjectId !== selectedSubjectId) {
      navigate(
        createSubjectRoute({
          subjectId: selectedSubjectId,
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

  }, [navigate, orderedSubjectSummaries.length, route, selectedSubjectId, snapshot]);

  useEffect(() => {
    if (route.kind !== "subject" || route.view !== "files" || !selectedSubjectId) {
      return;
    }
    if (subjectFilesState.loading || subjectFilesState.error) {
      return;
    }

    const nextFilePath = resolveSelectedSubjectFilePath({
      routeFilePath: route.filePath,
      files: orderedSubjectFiles,
      specDocument,
    });
    if (nextFilePath !== route.filePath) {
      navigate(
        createSubjectRoute({
          subjectId: selectedSubjectId,
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
    subjectFilesState.error,
    subjectFilesState.loading,
    navigate,
    orderedSubjectFiles,
    route,
    selectedSubjectId,
  ]);

  useEffect(() => {
    if (route.kind !== "subject" || route.view !== "manifest" || !selectedSubjectId) {
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
    const subjectId = selectedSubjectId;

    async function loadRecord() {
      try {
        const record = await requestJson<SubjectRecord>(
          apiPath(`/api/record?id=${encodeURIComponent(subjectId)}`),
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
  }, [apiPath, route, selectedSubjectId]);

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
      route.kind !== "subject" ||
      route.view !== "files" ||
      !selectedSubjectId ||
      !selectedSubjectHasInspectableFiles
    ) {
      setSubjectFilesState({
        loading: false,
        error: null,
        files: [],
      });
      return;
    }

    let cancelled = false;
    setSubjectFilesState({
      loading: true,
      error: null,
      files: [],
    });
    const subjectId = selectedSubjectId;

    async function loadFiles() {
      try {
        const files = await requestJson<SubjectWorkspaceFileSummary[]>(
          apiPath(`/api/subject/files?id=${encodeURIComponent(subjectId)}`),
        );
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setSubjectFilesState({
            loading: false,
            error: null,
            files,
          });
        });
      } catch (error) {
        if (!cancelled) {
          setSubjectFilesState({
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
  }, [apiPath, route, selectedSubjectHasInspectableFiles, selectedSubjectId]);

  useEffect(() => {
    if (
      route.kind !== "subject" ||
      route.view !== "files" ||
      !selectedSubjectId ||
      !selectedSubjectHasInspectableFiles ||
      !selectedSubjectFilePath
    ) {
      setSubjectPreviewState({
        loading: false,
        error: null,
        preview: null,
      });
      return;
    }

    let cancelled = false;
    setSubjectPreviewState({
      loading: true,
      error: null,
      preview: null,
    });
    const subjectId = selectedSubjectId;
    const filePath = selectedSubjectFilePath;

    async function loadPreview() {
      try {
        const params = new URLSearchParams({
          id: subjectId,
          path: filePath,
          view: subjectPreviewMode,
        });
        const preview = await requestJson<SubjectWorkspaceFilePreview>(
          apiPath(`/api/subject/preview?${params.toString()}`),
        );
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setSubjectPreviewState({
            loading: false,
            error: null,
            preview,
          });
        });
      } catch (error) {
        if (!cancelled) {
          setSubjectPreviewState({
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
  }, [apiPath, subjectPreviewMode, route, selectedSubjectFilePath, selectedSubjectHasInspectableFiles, selectedSubjectId]);

  const routeEvaluationScorecard = routeEvaluationId
    ? evaluationRecordsState.records.find((record) => record.id === routeEvaluationId) ?? null
    : null;
  const routeEvaluationSubjectId =
    routeEvaluationScorecard?.subjectId ??
    routeEvaluationSummary?.subjectId ??
    null;
  const evaluationCaseReviewState = useCaseReview(
    apiPath,
    routeEvaluationCaseId ? routeEvaluationSubjectId : null,
    routeEvaluationCaseId ? (routeEvaluationSummary?.runId ?? routeEvaluationScorecard?.runId ?? null) : null,
    routeEvaluationCaseId,
  );

  function navigateToSubject(args: {
    subjectId: string;
    view?: SubjectView;
    filePath?: string | null;
    directoryPath?: string | null;
    previewMode?: SubjectPreviewMode;
    dialog?: SubjectDialog | null;
    replace?: boolean;
  }) {
    const view = args.view ?? (route.kind === "subject" ? route.view : "overview");
    navigate(
      createSubjectRoute({
        subjectId: args.subjectId,
        view,
        filePath: view === "files" ? args.filePath ?? (route.kind === "subject" ? route.filePath : null) : null,
        directoryPath: view === "files"
          ? args.directoryPath ?? (route.kind === "subject" && route.view === "files" ? route.directoryPath : null)
          : null,
        previewMode: view === "files"
          ? args.previewMode ?? (route.kind === "subject" && route.view === "files" ? route.previewMode : "rendered")
          : "rendered",
        dialog: args.dialog ?? (route.kind === "subject" ? route.dialog : null),
      }),
      args.replace ? { replace: true } : undefined,
    );
  }

  function handleSelectSubject(subjectId: string) {
    navigateToSubject({
      subjectId,
      view: route.kind === "subject" ? route.view : "overview",
      filePath: route.kind === "subject" && route.view === "files" ? route.filePath : null,
      directoryPath: route.kind === "subject" && route.view === "files" ? route.directoryPath : null,
      previewMode: route.kind === "subject" && route.view === "files" ? route.previewMode : "rendered",
      dialog: null,
    });
  }

  function createCurrentSubjectRoute(dialog: SubjectDialog | null): WorkbenchRoute | null {
    if (route.kind !== "subject" || !selectedSubjectId) {
      return null;
    }
    return createSubjectRoute({
      subjectId: selectedSubjectId,
      view: route.view,
      filePath: route.view === "files" ? route.filePath : null,
      directoryPath: route.view === "files" ? route.directoryPath : null,
      previewMode: route.view === "files" ? route.previewMode : "rendered",
      dialog,
    });
  }

  const objectSurface = (() => {
    if (route.kind === "subject" && route.view === "manifest") {
      return (
        <SubjectYamlSurface
          specError={specError}
          snapshotError={snapshotError}
          snapshotLoading={snapshotLoading}
          selectedSubjectSummary={selectedSubjectSummary}
          recordState={recordState}
        />
      );
    }

    if (route.kind === "subject" && route.view === "files") {
      return (
        <SubjectFilesSurface
          specError={specError}
          snapshotError={snapshotError}
          snapshotLoading={snapshotLoading}
          selectedSubjectSummary={selectedSubjectSummary}
          subjectFilesState={subjectFilesState}
          selectedSubjectFilePath={selectedSubjectFilePath}
          subjectPreviewMode={subjectPreviewMode}
          subjectDirectoryPath={subjectDirectoryPath}
          subjectPreviewState={subjectPreviewState}
          onSelectSubjectFile={(filePath) => {
            if (!selectedSubjectId) {
              return;
            }
            const directoryPath = directoryPathForFile(filePath);
            navigateToSubject({
              subjectId: selectedSubjectId,
              view: "files",
              filePath,
              directoryPath,
              previewMode: subjectPreviewMode,
            });
          }}
          onSubjectDirectoryChange={(directoryPath) => {
            if (!selectedSubjectId) {
              return;
            }
            navigateToSubject({
              subjectId: selectedSubjectId,
              view: "files",
              filePath: selectedSubjectFilePath,
              directoryPath,
              previewMode: subjectPreviewMode,
            });
          }}
          onSubjectPreviewModeChange={(mode) => {
            if (!selectedSubjectId) {
              return;
            }
            navigateToSubject({
              subjectId: selectedSubjectId,
              view: "files",
              filePath: selectedSubjectFilePath,
              directoryPath: subjectDirectoryPath,
              previewMode: mode,
            });
          }}
        />
      );
    }

    if (route.kind === "subject" && route.view === "overview") {
      return (
        <SubjectOverviewSurface
          snapshot={snapshot}
          snapshotError={snapshotError}
          snapshotLoading={snapshotLoading}
          selectedSubjectSummary={selectedSubjectSummary}
          evaluations={currentBenchmarkEvaluations}
          onOpenEvaluation={(evaluationId) => {
            const next = createCurrentSubjectRoute({ kind: "evaluation", evaluationId });
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
            onSelectEvaluation={(evaluationId) => navigate(createEvaluationsRoute({
              dialog: { kind: "evaluation", evaluationId },
            }))}
          />
        </ScrollableObjectSurface>
      );
    }

    return (
      <SubjectsIndexSurface
        snapshot={snapshot}
        snapshotError={snapshotError}
        snapshotLoading={snapshotLoading}
        currentBenchmarkSummaries={currentBenchmarkSummaries}
        currentBenchmarkEvaluations={currentBenchmarkEvaluations}
        currentBenchmarkRuns={currentBenchmarkRuns}
        selectedSubjectId={selectedSubjectId}
        view={route.kind === "subjects" ? route.view : "archive"}
        onViewChange={(view) => navigate(createSubjectsRoute({ view }))}
        onSelectSubject={handleSelectSubject}
      />
    );
  })();

  const desktopObjectPaneOpen =
    route.kind !== "benchmark" && !prefersCompactWorkspaceLayout;
  const routeHref = (next: WorkbenchRoute) => buildWorkbenchLocationHref(next, routeBasePath, persistentSearchParams);
  const benchmarkHref = routeHref(createBenchmarkRoute());
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
              selectedSubjectSummary={selectedSubjectSummary}
              routeHref={routeHref}
              onNavigate={navigate}
            />
          </div>
          {benchmarkNavigation}
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

  const subjectDetailViewSwitch = route.kind === "subject" ? (
    <ViewSwitch
      ariaLabel="Subject views"
      value={route.view}
      className="self-start"
      items={[
        { value: "overview", label: "Overview", icon: InfoIcon },
        { value: "manifest", label: "Manifest", icon: FileCode2Icon },
        { value: "files", label: "Files", icon: FolderOpenIcon },
      ]}
      onValueChange={(value) => {
        if (!selectedSubjectId) {
          return;
        }
        const nextView: SubjectView =
          value === "files" ? "files" : value === "manifest" ? "manifest" : "overview";
        navigateToSubject({
          subjectId: selectedSubjectId,
          view: nextView,
          directoryPath: nextView === "files" ? subjectDirectoryPath : null,
          previewMode: nextView === "files" ? subjectPreviewMode : "rendered",
        });
      }}
    />
  ) : null;
  const objectSurfaceFillsBody =
    (route.kind === "subject" && route.view === "files") ||
    route.kind === "subjects" ||
    route.kind === "evaluations";

  const objectPane = (
    <WorkspacePane
      title={objectPaneTitle({
        route,
        selectedSubjectSummary,
      })}
      badges={(
        <ObjectPaneBadges
          route={route}
          snapshot={snapshot}
          subjectCount={currentBenchmarkSummaries.length}
          evaluationCount={currentBenchmarkEvaluations.length}
          selectedSubjectSummary={selectedSubjectSummary}
        />
      )}
      subnav={subjectDetailViewSwitch}
      scrollBody={!objectSurfaceFillsBody}
      contentClassName={objectSurfaceFillsBody ? "flex h-full min-h-0 flex-col" : undefined}
    >
      {objectSurface}
    </WorkspacePane>
  );
  const subjectContextDialog = route.kind === "subject" ? route.dialog : null;
  const evaluationsContextDialog = route.kind === "evaluations" ? route.dialog : null;
  const contextualDialogs = (
    <>
      {subjectContextDialog?.kind === "evaluation" ? (
        <EvaluationDetailDialog
          open
          evaluationId={subjectContextDialog.evaluationId}
          evaluationSummary={routeEvaluationSummary}
          state={evaluationRecordsState}
          selectedCaseId={subjectContextDialog.caseId ?? null}
          caseReviewState={evaluationCaseReviewState}
          onClose={() => {
            const next = createCurrentSubjectRoute(null);
            if (next) {
              navigate(next);
            }
          }}
          onSelectCase={(caseId) => {
            const next = createCurrentSubjectRoute({
              kind: "evaluation",
              evaluationId: subjectContextDialog.evaluationId,
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
    parseWorkbenchRoute({
      pathname: initialPath,
      search: initialSearch,
    }));

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
    route.kind === "subjects" || route.kind === "subject"
      ? "subjects"
      : route.kind === "evaluations"
          ? "evaluations"
          : null;
  const items = [
    {
      value: "subjects",
      label: "Subjects",
      route: createSubjectsRoute(),
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
  selectedSubjectSummary: SubjectSummary | null;
}): string {
  if (args.route.kind === "subjects") {
    return "Subjects";
  }
  if (args.route.kind === "evaluations") {
    return "Evaluations";
  }
  if (args.route.kind !== "subject") {
    return "Benchmark";
  }
  if (!args.selectedSubjectSummary) {
    return "Subject";
  }
  return formatSubjectDisplayName(args.selectedSubjectSummary);
}

function WorkbenchBreadcrumbs({
  route,
  selectedSubjectSummary,
  routeHref,
  onNavigate,
}: {
  route: WorkbenchRoute;
  selectedSubjectSummary: SubjectSummary | null;
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

  const terminalLabel = route.kind === "subject"
    ? selectedSubjectSummary
      ? formatSubjectDisplayName(selectedSubjectSummary)
      : "Subject"
    : route.kind === "evaluations"
        ? "Evaluations"
        : "Subjects";
  const parentRoute =
    route.kind === "subject" ? createSubjectsRoute() :
    null;
  const parentLabel =
    route.kind === "subject" ? "Subjects" :
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

function ObjectPaneBadges({
  route,
  snapshot,
  subjectCount,
  evaluationCount,
  selectedSubjectSummary,
}: {
  route: WorkbenchRoute;
  snapshot: BenchmarkSnapshot | null;
  subjectCount: number;
  evaluationCount: number;
  selectedSubjectSummary: SubjectSummary | null;
}) {
  if (route.kind === "evaluations") {
    return snapshot ? <Badge variant="outline">{formatCount(evaluationCount, "evaluation")}</Badge> : null;
  }

  if (route.kind === "benchmark") {
    return snapshot ? <Badge variant="outline">{formatCount(subjectCount, "subject")}</Badge> : null;
  }

  if (route.kind !== "subject") {
    return snapshot ? (
      <Badge variant="outline">
        {formatCount(subjectCount, "subject")}
      </Badge>
    ) : null;
  }

  return (
    <>
      {selectedSubjectSummary ? (
        <StatusBadge
          status={selectedSubjectSummary.status}
          active={snapshot?.activeId === selectedSubjectSummary.id}
        />
      ) : null}
    </>
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
  sourceFilesState: SubjectFilesState;
  selectedSourceFilePath: string | null;
  sourcePreviewMode: SubjectPreviewMode;
  sourceDirectoryPath: string | null;
  sourcePreviewState: SubjectPreviewState;
  onSelectSourceFile: (filePath: string) => void;
  onSourceDirectoryChange: (directoryPath: string | null) => void;
  onSourcePreviewModeChange: (mode: SubjectPreviewMode) => void;
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
            description="The benchmark manifest defines the engine, subject, optimizer, and source files."
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
                changes={orderSubjectFiles(sourceFilesState.files)}
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
                onPreviewModeChange={(mode) => onSourcePreviewModeChange(mode as SubjectPreviewMode)}
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
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
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
                {formatCount(option.subjectCount, "subject")}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function SubjectsIndexSurface({
  snapshot,
  snapshotError,
  snapshotLoading,
  currentBenchmarkSummaries,
  currentBenchmarkEvaluations,
  currentBenchmarkRuns,
  selectedSubjectId,
  view,
  onViewChange,
  onSelectSubject,
}: {
  snapshot: BenchmarkSnapshot | null;
  snapshotError: string | null;
  snapshotLoading: boolean;
  currentBenchmarkSummaries: SubjectSummary[];
  currentBenchmarkEvaluations: EvaluationSummary[];
  currentBenchmarkRuns: RunSummary[];
  selectedSubjectId: string | null;
  view: "archive" | "lineage";
  onViewChange: (view: "archive" | "lineage") => void;
  onSelectSubject: (subjectId: string) => void;
}) {
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
            currentBenchmarkEvaluations[0]?.benchmarkFingerprint ??
            currentBenchmarkRuns[0]?.benchmarkFingerprint ??
            null,
          summaries: currentBenchmarkSummaries,
          evaluations: currentBenchmarkEvaluations,
          runs: currentBenchmarkRuns,
        }
      : null,
    [
      currentBenchmarkEvaluations,
      currentBenchmarkRuns,
      currentBenchmarkSummaries,
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
        <TabsList variant="line" aria-label="Subject index views" className="self-start">
          <TabsTrigger value="archive">
            <FolderOpenIcon data-icon="inline-start" />
            Archive
          </TabsTrigger>
          <TabsTrigger value="lineage">
            <GitBranchIcon data-icon="inline-start" />
            Lineage
          </TabsTrigger>
        </TabsList>

        <TabsContent value="archive" className="mt-0 min-h-0 min-w-0 flex-1">
          <ScrollableObjectSurface>
            <SubjectsArchiveSurface
              summaries={currentBenchmarkSummaries}
              evaluations={currentBenchmarkEvaluations}
              activeId={scopedActiveId}
              snapshotError={snapshotError}
              loading={snapshotLoading}
              selectedSubjectId={selectedSubjectId}
              onSelectSubject={onSelectSubject}
            />
          </ScrollableObjectSurface>
        </TabsContent>

        <TabsContent value="lineage" className="mt-0 min-h-0 min-w-0 flex-1">
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col p-1">
            <SubjectsLineageSurface
              snapshot={scopedSnapshot}
              snapshotError={snapshotError}
              loading={snapshotLoading}
              selectedSubjectId={selectedSubjectId}
              onSelectSubject={onSelectSubject}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SubjectsArchiveSurface({
  summaries,
  evaluations,
  activeId,
  snapshotError,
  loading,
  selectedSubjectId,
  onSelectSubject,
}: {
  summaries: SubjectSummary[];
  evaluations: EvaluationSummary[];
  activeId: string | null;
  snapshotError: string | null;
  loading: boolean;
  selectedSubjectId: string | null;
  onSelectSubject: (subjectId: string) => void;
}) {
  if (snapshotError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{snapshotError}</CardContent>
      </Card>
    );
  }

  if (loading) {
    return <SubjectArchiveSkeleton />;
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <SubjectList
        summaries={summaries}
        evaluations={evaluations}
        activeId={activeId}
        selectedId={selectedSubjectId}
        onSelect={onSelectSubject}
      />
    </div>
  );
}

function SubjectsLineageSurface({
  snapshot,
  snapshotError,
  loading,
  selectedSubjectId,
  onSelectSubject,
}: {
  snapshot: BenchmarkSnapshot | null;
  snapshotError: string | null;
  loading: boolean;
  selectedSubjectId: string | null;
  onSelectSubject: (subjectId: string) => void;
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
        selectedSubjectId={selectedSubjectId}
        onSelectSubject={onSelectSubject}
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

function SubjectYamlSurface({
  specError,
  snapshotError,
  snapshotLoading,
  selectedSubjectSummary,
  recordState,
}: {
  specError: string | null;
  snapshotError: string | null;
  snapshotLoading: boolean;
  selectedSubjectSummary: SubjectSummary | null;
  recordState: SubjectRecordState;
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
    return <SubjectManifestSkeleton />;
  }

  if (!selectedSubjectSummary) {
    return (
      <EmptyState
        icon={FileCode2Icon}
        title="No subject selected"
        message="Select a subject from Subjects or Lineage to inspect its manifest."
        variant="hero"
        size="sm"
      />
    );
  }

  return (
    <SourceYamlSection
      title="Subject Manifest"
      description="The subject manifest defines how to run the subject."
      source={sourceYamlFileFromSubjectRecord(recordState.record)}
      loading={recordState.loading}
      error={recordState.error}
      testId="subject-yaml-source"
    />
  );
}

function SubjectFilesSurface({
  specError,
  snapshotError,
  snapshotLoading,
  selectedSubjectSummary,
  subjectFilesState,
  selectedSubjectFilePath,
  subjectPreviewMode,
  subjectDirectoryPath,
  subjectPreviewState,
  onSelectSubjectFile,
  onSubjectDirectoryChange,
  onSubjectPreviewModeChange,
}: {
  specError: string | null;
  snapshotError: string | null;
  snapshotLoading: boolean;
  selectedSubjectSummary: SubjectSummary | null;
  subjectFilesState: SubjectFilesState;
  selectedSubjectFilePath: string | null;
  subjectPreviewMode: SubjectPreviewMode;
  subjectDirectoryPath: string | null;
  subjectPreviewState: SubjectPreviewState;
  onSelectSubjectFile: (filePath: string) => void;
  onSubjectDirectoryChange: (directoryPath: string | null) => void;
  onSubjectPreviewModeChange: (mode: SubjectPreviewMode) => void;
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
    return <SubjectFilesSurfaceSkeleton />;
  }

  if (!selectedSubjectSummary) {
    return (
      <EmptyState
        icon={FolderOpenIcon}
        title="No subject selected"
        message="Select a subject from Subjects or Lineage to inspect its files."
        variant="hero"
        size="sm"
      />
    );
  }

  const emptyMessage = "No subject files are available for this subject.";

  return (
    <SurfaceSection
      title="Subject Files"
      icon={FolderOpenIcon}
      description="Files that make up this subject version."
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex flex-wrap gap-2">
        <StatusBadge status={selectedSubjectSummary.status} active={false} />
        <Badge variant="outline">digest {shortFingerprint(selectedSubjectSummary.subjectFingerprint)}</Badge>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <FilesBrowser
          changes={orderSubjectFiles(subjectFilesState.files)}
          selectedFilePath={selectedSubjectFilePath}
          browseMode="folders"
          currentDirectory={subjectDirectoryPath}
          previewMode={subjectPreviewMode}
          availablePreviewModes={supportedPreviewModes()}
          preview={subjectPreviewState.preview}
          changesError={subjectFilesState.error}
          previewError={subjectPreviewState.error}
          isChangesLoading={subjectFilesState.loading}
          isPreviewLoading={subjectPreviewState.loading}
          layout={prefersStackedFilesLayout ? "stacked" : "split"}
          emptyMessage={emptyMessage}
          emptySelectionMessage="Select a mounted subject file to preview."
          listErrorMessage="Couldn't load the mounted subject file list."
          previewErrorMessage="Couldn't load the mounted subject file preview."
          onSelectFile={onSelectSubjectFile}
          onDirectoryChange={onSubjectDirectoryChange}
          onPreviewModeChange={(mode) => onSubjectPreviewModeChange(mode as SubjectPreviewMode)}
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
  subjectId: string | null,
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
    if (!subjectId || !runId || !caseId) {
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
    const nextSubjectId = subjectId;
    const nextRunId = runId;
    const nextCaseId = caseId;
    const nextRequestKey = `${nextSubjectId}\0${nextRunId}\0${nextCaseId}`;
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
        const review = await requestJson<SubjectCaseReview>(
          apiPath(`/api/case-review?id=${encodeURIComponent(nextSubjectId)}&run=${encodeURIComponent(nextRunId)}&case=${encodeURIComponent(nextCaseId)}`),
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
  }, [apiPath, caseId, runId, subjectId]);

  return state;
}

function SubjectOverviewSurface({
  snapshot,
  snapshotError,
  snapshotLoading,
  selectedSubjectSummary,
  evaluations,
  onOpenEvaluation,
}: {
  snapshot: BenchmarkSnapshot | null;
  snapshotError: string | null;
  snapshotLoading: boolean;
  selectedSubjectSummary: SubjectSummary | null;
  evaluations: EvaluationSummary[];
  onOpenEvaluation: (evaluationId: string) => void;
}) {
  if (snapshotError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{snapshotError}</CardContent>
      </Card>
    );
  }

  if (snapshotLoading) {
    return <SubjectOverviewSkeleton />;
  }

  if (!snapshot || snapshot.summaries.length === 0 || !selectedSubjectSummary) {
    return (
      <EmptyState
        icon={InfoIcon}
        title="No subject selected"
        message="Select or create a subject to inspect its overview."
        variant="hero"
        size="sm"
      />
    );
  }

  const subjectEvaluations = orderEvaluationSummaries(
    evaluations.filter((evaluation) => evaluation.subjectId === selectedSubjectSummary.id),
  );
  const latestEvaluation = subjectEvaluations[0] ?? null;
  const metricKeys = resolveEvaluationMetricKeys(selectedSubjectSummary.metrics, "score", latestEvaluation?.metrics);
  const primaryMetricKey = metricKeys[0] ?? null;
  const primaryMetricValue = primaryMetricKey
    ? selectedSubjectSummary.metrics?.[primaryMetricKey]
    : undefined;
  const primaryMetricStats = primaryMetricKey ? latestEvaluation?.metrics?.[primaryMetricKey] : undefined;

  return (
    <div className="grid gap-6">
      <section className="grid min-w-0 gap-3">
        <div className="grid gap-3 md:grid-cols-3">
          <FactItem title="Created" value={formatTimestamp(selectedSubjectSummary.createdAt)} />
          <FactItem
            title={primaryMetricKey ? formatLabelText(primaryMetricKey) : "Score"}
            value={formatSubjectMetricStats(primaryMetricStats, primaryMetricValue)}
          />
          <FactItem
            title="Samples"
            value={latestEvaluation ? `${latestEvaluation.completedSampleCount}/${latestEvaluation.sampleCount}` : "—"}
          />
        </div>

      </section>

      <SurfaceSection title="Evaluations" icon={ChartColumnIcon}>
        {subjectEvaluations.length > 0 ? (
          <EvaluationSummaryTable
            evaluations={subjectEvaluations}
            showSubject={false}
            onSelectEvaluation={onOpenEvaluation}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No evaluations are recorded for this subject yet.</p>
        )}
      </SurfaceSection>
    </div>
  );
}

function EvaluationSummaryTable({
  evaluations,
  showSubject,
  onSelectEvaluation,
}: {
  evaluations: EvaluationSummary[];
  showSubject: boolean;
  onSelectEvaluation: (evaluationId: string) => void;
}) {
  return (
    <Card size="sm">
      <CardContent className="py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{showSubject ? "Subject" : "Evaluation"}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Samples</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evaluations.map((evaluation) => (
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
                    {showSubject
                      ? formatSubjectDisplayName(evaluation)
                      : formatEvaluationDisplayName(evaluation)}
                  </TableCell>
                  <TableCell>{statusLabel(evaluation.status)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {typeof evaluation.metrics?.score?.mean === "number"
                      ? formatMetricValue(evaluation.metrics.score.mean)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {evaluation.completedSampleCount}/{evaluation.sampleCount}
                  </TableCell>
                </TableRow>
              ))}
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
  executions: SubjectCaseExecution[];
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
    return <p className="text-sm text-destructive">{traceState.error}</p>;
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
  const title = "Evaluation";
  const description = summary
    ? [
        statusLabel(summary.status),
        typeof summary.metrics?.score?.mean === "number" ? `score ${formatMetricValue(summary.metrics.score.mean)}` : null,
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
  const cases = scorecard ? resolveScorecardCaseRows(scorecard) : [];

  if (state.loading && !scorecard) {
    return <EvaluationDetailSurfaceSkeleton />;
  }

  if (state.error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{state.error}</CardContent>
      </Card>
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
            value={typeof summary.metrics?.score?.mean === "number" ? formatMetricValue(summary.metrics.score.mean) : "not recorded"}
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
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{state.error}</CardContent>
      </Card>
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
  onSelectEvaluation,
}: {
  snapshotError: string | null;
  snapshotLoading: boolean;
  evaluations: EvaluationSummary[];
  onSelectEvaluation: (evaluationId: string) => void;
}) {
  if (snapshotError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{snapshotError}</CardContent>
      </Card>
    );
  }

  if (snapshotLoading) {
    return <EvaluationsDetailSkeleton />;
  }

  return (
    <EvaluationsDetail
      evaluations={evaluations}
      hasEvaluations={evaluations.length > 0}
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
      status: caseStats.status ? formatCaseStatus(caseStats.status) : "completed",
      completedSampleCount: caseStats.sampleCount,
      sampleCount: caseStats.sampleCount,
      metricValue,
      durationMs: caseStats.durationMs?.mean ?? null,
      split: caseStats.split ?? null,
    };
  }).sort((left, right) => left.label.localeCompare(right.label));
}

function formatEvaluationDisplayName(evaluation: EvaluationSummary): string {
  return `Evaluation ${formatTimestamp(evaluation.updatedAt)}`;
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

function resolveEvaluationMetricKeys(
  subjectMetrics: Record<string, number> | undefined,
  preferredMetricKey: string | null,
  aggregateMetrics?: EvaluationRecord["metrics"],
): string[] {
  const available = new Set<string>();
  for (const key of Object.keys(subjectMetrics ?? {})) {
    available.add(key);
  }
  for (const key of Object.keys(aggregateMetrics ?? {})) {
    available.add(key);
  }

  const ordered: string[] = [];
  const add = (key: string | null | undefined) => {
    if (key && available.has(key) && !ordered.includes(key)) {
      ordered.push(key);
    }
  };

  add(preferredMetricKey);
  add("score");
  for (const key of Array.from(available).sort()) {
    add(key);
  }
  return ordered;
}

function formatSubjectMetricStats(
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

function formatCaseStatus(status: string | undefined): string {
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

function formatOptionalDuration(durationMs: number | null): string {
  return durationMs === null ? "—" : formatDurationMs(durationMs);
}

function resolveCaseReviewStatus(review: SubjectCaseReview): string | null {
  if (review.status) {
    return review.status;
  }
  return review.executions.length > 0
    ? resolveExecutionCollectionStatus(review.executions, "pending")
    : null;
}

function resolveCaseReviewDurationMs(
  review: SubjectCaseReview,
  nowMs: number,
): number | null {
  const activeDurationMs = resolveExecutionRefsDurationMs(review.executions, nowMs);
  if (hasActiveExecutionRecords(review.executions)) {
    return activeDurationMs ?? review.durationMs ?? null;
  }
  return review.durationMs ?? activeDurationMs;
}

function resolveExecutionRefsDurationMs(
  executions: SubjectCaseExecution[],
  nowMs: number,
): number | null {
  return resolveTimedExecutionRecordsDurationMs(executions, nowMs);
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

function hasActiveExecutionRecords(records: readonly { status: HostedWorkbenchJob["status"] }[]): boolean {
  return records.some((record) => isActiveExecutionStatus(record.status));
}

function formatExecutionKindLabel(purpose: string): string {
  if (purpose === "attempt") {
    return "Attempt";
  }
  if (purpose === "improve") {
    return "Optimizer";
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
  review: SubjectCaseReview;
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
  const [previewMode, setPreviewMode] = useState<SubjectPreviewMode>("rendered");
  const [previewState, setPreviewState] = useState<ExecutionPreviewState>({
    loading: false,
    error: null,
    preview: null,
  });
  const orderedFiles = useMemo(
    () => orderSubjectFiles(executionFilesState.files),
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
  }, [review.subjectId, review.caseId, outputExecution?.runId, outputJobId]);

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

    void requestJson<SubjectWorkspaceFileSummary[]>(
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

    void requestJson<SubjectWorkspaceFilePreview>(
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
        onPreviewModeChange={(mode) => setPreviewMode(mode as SubjectPreviewMode)}
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

function resolveSelectedSubjectId(args: {
  route: WorkbenchRoute;
  activeId: string | null;
  summaries: SubjectSummary[];
}): string | null {
  if (args.route.kind === "subject") {
    const subjectId = args.route.subjectId;
    if (subjectId && args.summaries.some((summary) => summary.id === subjectId)) {
      return subjectId;
    }
  }
  if (args.activeId && args.summaries.some((summary) => summary.id === args.activeId)) {
    return args.activeId;
  }
  return args.summaries[0]?.id ?? null;
}

function resolveSelectedSubjectFilePath(args: {
  routeFilePath: string | null;
  files: SubjectWorkspaceFileSummary[];
  specDocument: AuthoredWorkbenchSourceDocument | null;
}): string | null {
  if (args.routeFilePath && args.files.some((entry) => entry.path === args.routeFilePath)) {
    return args.routeFilePath;
  }
  return pickDefaultSubjectFile(args.files, args.specDocument);
}

function resolvePreferredBenchmarkFilePath(
  files: SubjectWorkspaceFileSummary[],
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

function sourceYamlFileFromSubjectRecord(record: SubjectRecord | null): SourceYamlFile | null {
  const source = asUiRecord(record?.meta)?.source;
  const files = asUiRecord(source)?.files;
  if (!Array.isArray(files)) {
    return null;
  }

  for (const value of files) {
    const file = asUiRecord(value);
    const filePath = typeof file?.path === "string" ? file.path : "";
    const content = typeof file?.content === "string" ? file.content : null;
    if (/^subjects\/[^/]+\/subject\.ya?ml$/iu.test(filePath) && content !== null) {
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

function orderSubjectSummaries(summaries: SubjectSummary[]): SubjectSummary[] {
  return summaries
    .slice()
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
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
  summaries: SubjectSummary[];
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
      subjectCount: 0,
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
      option.subjectCount += 1;
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
    return right.subjectCount - left.subjectCount ||
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
