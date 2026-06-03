import { isSnapshotPreviewMode } from "@workbench-ai/cli-web-ui/lib/file-preview";

import type { CandidatePreviewMode } from "../types";

export type CandidateView = "overview" | "manifest" | "files";
export type BenchmarkView = "overview" | "manifest" | "files";
export type CandidatesIndexView = "archive" | "lineage";
export type EvaluationCaseTab = "score" | "attempts" | "files";
export type WorkbenchPersistentSearchParams = Record<string, string | null | undefined>;

export interface BenchmarkSurfaceRoute {
  benchmarkFingerprint: string | null;
  benchmarkView: BenchmarkView;
  benchmarkFilePath: string | null;
  benchmarkDirectoryPath: string | null;
  benchmarkPreviewMode: CandidatePreviewMode;
}

export interface EvaluationCaseRoute {
  caseTab: EvaluationCaseTab;
  caseFilePath: string | null;
  caseDirectoryPath: string | null;
  casePreviewMode: CandidatePreviewMode;
}

export type WorkbenchRoute =
  | ({
      kind: "benchmark";
    } & BenchmarkSurfaceRoute)
  | {
      kind: "not-found";
      pathname: string;
    }
  | ({
      kind: "candidates";
      view: CandidatesIndexView;
    } & BenchmarkSurfaceRoute)
  | ({
      kind: "evaluations";
    } & BenchmarkSurfaceRoute)
  | ({
      kind: "evaluation";
      evaluationId: string;
      caseId: string | null;
    } & BenchmarkSurfaceRoute & EvaluationCaseRoute)
  | ({
      kind: "candidate";
      candidateId: string | null;
      view: CandidateView;
      filePath: string | null;
      directoryPath: string | null;
      previewMode: CandidatePreviewMode;
    } & BenchmarkSurfaceRoute);

export function parseWorkbenchRoute(locationLike: {
  pathname: string;
  search: string;
}): WorkbenchRoute {
  const normalizedPath = normalizePathname(locationLike.pathname);
  const segments = normalizedPath.split("/").filter(Boolean).map(decodePathSegment);
  const searchParams = new URLSearchParams(locationLike.search);
  const benchmarkSurface = parseBenchmarkSurface(searchParams);

  if (segments.length === 0) {
    return createBenchmarkRoute(benchmarkSurface);
  }

  if (segments.length === 1 && (segments[0] === "manifest" || segments[0] === "files")) {
    return createBenchmarkRoute({
      benchmarkFingerprint: benchmarkSurface.benchmarkFingerprint,
      benchmarkView: segments[0],
      benchmarkFilePath: segments[0] === "files" ? searchParams.get("file") : null,
      benchmarkDirectoryPath: segments[0] === "files" ? normalizeDirectoryPath(searchParams.get("dir")) : null,
      benchmarkPreviewMode: segments[0] === "files" ? normalizeCandidatePreviewMode(searchParams.get("view")) : "rendered",
    });
  }

  if (segments[0] === "evaluations") {
    if (segments.length === 1) {
      return createEvaluationsRoute({ benchmark: benchmarkSurface });
    }
    const evaluationId = normalizeRouteSelection(segments[1] ?? null);
    if (!evaluationId) {
      return createWorkbenchNotFoundRoute(normalizedPath);
    }
    if (segments.length === 2) {
      return createEvaluationRoute({ evaluationId, benchmark: benchmarkSurface });
    }
    if (segments[2] !== "cases") {
      return createWorkbenchNotFoundRoute(normalizedPath);
    }
    const caseId = normalizeRouteSelection(segments[3] ?? null);
    if (!caseId) {
      return createWorkbenchNotFoundRoute(normalizedPath);
    }
    if (segments.length === 4) {
      return createEvaluationCaseRoute({ evaluationId, caseId, benchmark: benchmarkSurface });
    }
    if (segments.length === 5 && (segments[4] === "attempts" || segments[4] === "files")) {
      return createEvaluationCaseRoute({
        evaluationId,
        caseId,
        caseTab: segments[4],
        caseFilePath: segments[4] === "files" ? searchParams.get("file") : null,
        caseDirectoryPath: segments[4] === "files" ? normalizeDirectoryPath(searchParams.get("dir")) : null,
        casePreviewMode: segments[4] === "files" ? normalizeCandidatePreviewMode(searchParams.get("view")) : "rendered",
        benchmark: benchmarkSurface,
      });
    }
    return createWorkbenchNotFoundRoute(normalizedPath);
  }

  if (segments[0] === "candidates") {
    if (segments.length === 1) {
      return createCandidatesRoute({ benchmark: benchmarkSurface });
    }
    if (segments.length === 2 && segments[1] === "lineage") {
      return createCandidatesRoute({ view: "lineage", benchmark: benchmarkSurface });
    }
    const candidateId = normalizeRouteSelection(segments[1] ?? null);
    const requestedView = segments[2];
    if (!candidateId || segments.length > 3) {
      return createWorkbenchNotFoundRoute(normalizedPath);
    }
    if (
      requestedView !== undefined &&
      requestedView !== "files" &&
      requestedView !== "manifest"
    ) {
      return createWorkbenchNotFoundRoute(normalizedPath);
    }
    const view =
      requestedView === "files"
        ? "files"
        : requestedView === "manifest"
          ? "manifest"
          : "overview";
    return createCandidateRoute({
      candidateId,
      view,
      filePath: view === "files" ? searchParams.get("file") : null,
      directoryPath: view === "files" ? normalizeDirectoryPath(searchParams.get("dir")) : null,
      previewMode: view === "files" ? normalizeCandidatePreviewMode(searchParams.get("view")) : "rendered",
      benchmark: benchmarkSurface,
    });
  }

  return createWorkbenchNotFoundRoute(normalizedPath);
}

export function parseWorkbenchLocation(
  locationLike: {
    pathname: string;
    search: string;
  },
  routeBasePath: string,
): WorkbenchRoute {
  return parseWorkbenchRoute({
    pathname: stripRouteBasePath(locationLike.pathname, routeBasePath),
    search: locationLike.search,
  });
}

export function buildWorkbenchHref(
  route: WorkbenchRoute,
  persistentSearchParams: WorkbenchPersistentSearchParams = {},
): string {
  const params = new URLSearchParams();
  appendPersistentSearchParams(params, persistentSearchParams);

  if (route.kind === "benchmark") {
    appendBenchmarkFingerprintParam(params, route.benchmarkFingerprint);
    if (route.benchmarkView === "manifest") {
      return withQuery("/manifest", params);
    }
    if (route.benchmarkView === "files") {
      appendFileSurfaceParams(params, {
        filePath: route.benchmarkFilePath,
        directoryPath: route.benchmarkDirectoryPath,
        previewMode: route.benchmarkPreviewMode,
      });
      return withQuery("/files", params);
    }
    return withQuery("/", params);
  }

  if (route.kind === "not-found") {
    return withQuery(route.pathname, params);
  }

  if (route.kind === "candidates") {
    appendBenchmarkSurfaceSearchParams(params, route);
    return withQuery(route.view === "lineage" ? "/candidates/lineage" : "/candidates", params);
  }

  if (route.kind === "evaluations") {
    appendBenchmarkSurfaceSearchParams(params, route);
    return withQuery("/evaluations", params);
  }

  if (route.kind === "evaluation") {
    appendBenchmarkSurfaceSearchParams(params, route);
    let pathname = `/evaluations/${encodeURIComponent(route.evaluationId)}`;
    if (route.caseId) {
      pathname += `/cases/${encodeURIComponent(route.caseId)}`;
      if (route.caseTab === "attempts") {
        pathname += "/attempts";
      } else if (route.caseTab === "files") {
        pathname += "/files";
        appendFileSurfaceParams(params, {
          filePath: route.caseFilePath,
          directoryPath: route.caseDirectoryPath,
          previewMode: route.casePreviewMode,
        });
      }
    }
    return withQuery(pathname, params);
  }

  const candidateId = route.candidateId ? encodeURIComponent(route.candidateId) : "";
  appendBenchmarkSurfaceSearchParams(params, route);
  if (route.view === "overview") {
    return withQuery(`/candidates/${candidateId}`, params);
  }
  if (route.view === "files") {
    appendFileSurfaceParams(params, route);
  }
  const query = params.toString();
  return `/candidates/${candidateId}/${route.view}${query ? `?${query}` : ""}`;
}

export function buildWorkbenchLocationHref(
  route: WorkbenchRoute,
  routeBasePath: string,
  persistentSearchParams: WorkbenchPersistentSearchParams = {},
): string {
  return joinRouteBasePath(routeBasePath, buildWorkbenchHref(route, persistentSearchParams));
}

export function createBenchmarkRoute(args: Partial<BenchmarkSurfaceRoute> = {}): WorkbenchRoute {
  return {
    kind: "benchmark",
    ...normalizeBenchmarkSurface(args),
  };
}

export function createWorkbenchNotFoundRoute(pathname: string): WorkbenchRoute {
  return {
    kind: "not-found",
    pathname: normalizePathname(pathname),
  };
}

export function createCandidatesRoute(args: {
  view?: CandidatesIndexView;
  benchmark?: Partial<BenchmarkSurfaceRoute>;
} = {}): WorkbenchRoute {
  return {
    kind: "candidates",
    ...normalizeBenchmarkSurface(args.benchmark),
    view: args.view ?? "archive",
  };
}

export function createEvaluationsRoute(args: {
  benchmark?: Partial<BenchmarkSurfaceRoute>;
} = {}): WorkbenchRoute {
  return {
    kind: "evaluations",
    ...normalizeBenchmarkSurface(args.benchmark),
  };
}

export function createEvaluationRoute(args: {
  evaluationId: string;
  benchmark?: Partial<BenchmarkSurfaceRoute>;
}): WorkbenchRoute {
  return {
    kind: "evaluation",
    ...normalizeBenchmarkSurface(args.benchmark),
    evaluationId: args.evaluationId,
    caseId: null,
    ...normalizeEvaluationCaseRoute(null),
  };
}

export function createEvaluationCaseRoute(args: {
  evaluationId: string;
  caseId: string;
  caseTab?: EvaluationCaseTab;
  caseFilePath?: string | null;
  caseDirectoryPath?: string | null;
  casePreviewMode?: CandidatePreviewMode;
  benchmark?: Partial<BenchmarkSurfaceRoute>;
}): WorkbenchRoute {
  return {
    kind: "evaluation",
    ...normalizeBenchmarkSurface(args.benchmark),
    evaluationId: args.evaluationId,
    caseId: args.caseId,
    ...normalizeEvaluationCaseRoute(args),
  };
}

export function createCandidateRoute(args: {
  candidateId: string | null;
  view: CandidateView;
  filePath?: string | null;
  directoryPath?: string | null;
  previewMode?: CandidatePreviewMode;
  benchmark?: Partial<BenchmarkSurfaceRoute>;
}): WorkbenchRoute {
  const view = args.view;
  return {
    kind: "candidate",
    ...normalizeBenchmarkSurface(args.benchmark),
    candidateId: args.candidateId,
    view,
    filePath: view === "files" ? args.filePath ?? null : null,
    directoryPath: view === "files" ? normalizeDirectoryPath(args.directoryPath ?? null) : null,
    previewMode: view === "files" ? args.previewMode ?? "rendered" : "rendered",
  };
}

export function withBenchmarkSurface(
  route: WorkbenchRoute,
  benchmark: Partial<BenchmarkSurfaceRoute>,
): WorkbenchRoute {
  if (route.kind === "not-found") {
    return route;
  }
  return { ...route, ...normalizeBenchmarkSurface({ ...route, ...benchmark }) };
}

export function withEvaluationCaseSurface(
  route: WorkbenchRoute,
  caseRoute: Partial<EvaluationCaseRoute>,
): WorkbenchRoute {
  if (route.kind !== "evaluation" || !route.caseId) {
    return route;
  }
  return { ...route, ...normalizeEvaluationCaseRoute({ ...route, ...caseRoute }) };
}

function parseBenchmarkSurface(params: URLSearchParams): BenchmarkSurfaceRoute {
  const view = normalizeBenchmarkView(params.get("benchmark"));
  return normalizeBenchmarkSurface({
    benchmarkFingerprint: normalizeBenchmarkFingerprint(params.get("benchmarkFingerprint")),
    benchmarkView: view,
    benchmarkFilePath: view === "files" ? params.get("benchmarkFile") : null,
    benchmarkDirectoryPath: view === "files" ? normalizeDirectoryPath(params.get("benchmarkDir")) : null,
    benchmarkPreviewMode: view === "files" ? normalizeCandidatePreviewMode(params.get("benchmarkView")) : "rendered",
  });
}

function normalizeBenchmarkSurface(value: Partial<BenchmarkSurfaceRoute> | null | undefined): BenchmarkSurfaceRoute {
  const benchmarkView = normalizeBenchmarkView(value?.benchmarkView ?? null);
  return {
    benchmarkFingerprint: normalizeBenchmarkFingerprint(value?.benchmarkFingerprint ?? null),
    benchmarkView,
    benchmarkFilePath: benchmarkView === "files" ? value?.benchmarkFilePath ?? null : null,
    benchmarkDirectoryPath: benchmarkView === "files"
      ? normalizeDirectoryPath(value?.benchmarkDirectoryPath ?? null)
      : null,
    benchmarkPreviewMode: benchmarkView === "files" ? value?.benchmarkPreviewMode ?? "rendered" : "rendered",
  };
}

function normalizeEvaluationCaseRoute(value: Partial<EvaluationCaseRoute> | null | undefined): EvaluationCaseRoute {
  const caseTab = normalizeEvaluationCaseTab(value?.caseTab ?? null);
  return {
    caseTab,
    caseFilePath: caseTab === "files" ? value?.caseFilePath ?? null : null,
    caseDirectoryPath: caseTab === "files"
      ? normalizeDirectoryPath(value?.caseDirectoryPath ?? null)
      : null,
    casePreviewMode: caseTab === "files" ? value?.casePreviewMode ?? "rendered" : "rendered",
  };
}

function appendBenchmarkSurfaceSearchParams(
  params: URLSearchParams,
  route: BenchmarkSurfaceRoute,
): void {
  appendBenchmarkFingerprintParam(params, route.benchmarkFingerprint);
  if (route.benchmarkView === "overview") {
    return;
  }
  params.set("benchmark", route.benchmarkView);
  if (route.benchmarkView === "files") {
    appendFileSurfaceParams(params, {
      filePath: route.benchmarkFilePath,
      directoryPath: route.benchmarkDirectoryPath,
      previewMode: route.benchmarkPreviewMode,
    }, "benchmark");
  }
}

function appendBenchmarkFingerprintParam(
  params: URLSearchParams,
  fingerprint: string | null,
): void {
  if (fingerprint) {
    params.set("benchmarkFingerprint", fingerprint);
  }
}

function appendFileSurfaceParams(
  params: URLSearchParams,
  surface: {
    filePath?: string | null;
    directoryPath?: string | null;
    previewMode?: CandidatePreviewMode;
  },
  prefix = "",
): void {
  const key = (name: string) => prefix ? `${prefix}${name[0]!.toUpperCase()}${name.slice(1)}` : name;
  if (surface.filePath) {
    params.set(key("file"), surface.filePath);
  }
  if (surface.directoryPath) {
    params.set(key("dir"), surface.directoryPath);
  }
  if (surface.previewMode && surface.previewMode !== "rendered") {
    params.set(key("view"), surface.previewMode);
  }
}

function normalizeDirectoryPath(value: string | null): string | null {
  const normalized = (value ?? "").replace(/^\/+/u, "").replace(/\/+$/u, "");
  return normalized || null;
}

function normalizeBenchmarkView(value: string | null): BenchmarkView {
  return value === "files" || value === "manifest" ? value : "overview";
}

function normalizeBenchmarkFingerprint(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function normalizeEvaluationCaseTab(value: string | null): EvaluationCaseTab {
  return value === "attempts" || value === "files" ? value : "score";
}

function normalizeRouteSelection(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function appendPersistentSearchParams(
  params: URLSearchParams,
  persistentSearchParams: WorkbenchPersistentSearchParams,
): void {
  for (const [key, value] of Object.entries(persistentSearchParams)) {
    if (value != null && value !== "") {
      params.set(key, value);
    }
  }
}

function withQuery(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/";
  }
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function stripRouteBasePath(pathname: string, routeBasePath: string): string {
  const base = normalizeRouteBasePath(routeBasePath);
  if (base === "/") {
    return pathname;
  }
  if (pathname === base) {
    return "/";
  }
  if (pathname.startsWith(`${base}/`)) {
    return pathname.slice(base.length) || "/";
  }
  return pathname;
}

function joinRouteBasePath(routeBasePath: string, href: string): string {
  const base = normalizeRouteBasePath(routeBasePath);
  if (base === "/") {
    return href;
  }
  if (href.startsWith("/?")) {
    return `${base}${href.slice(1)}`;
  }
  return `${base}${href === "/" ? "" : href}`;
}

function normalizeRouteBasePath(routeBasePath: string): string {
  const trimmed = routeBasePath.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }
  return `/${trimmed.replace(/^\/+|\/+$/gu, "")}`;
}

function normalizeCandidatePreviewMode(value: string | null): CandidatePreviewMode {
  return value && isSnapshotPreviewMode(value) ? value : "rendered";
}
