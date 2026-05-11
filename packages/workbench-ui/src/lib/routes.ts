import { isSnapshotPreviewMode } from "@workbench-ai/cli-web-ui/lib/file-preview";

import type { CandidatePreviewMode } from "../types";

export type CandidateView = "evaluation" | "manifest" | "files";
export type CandidateReviewTab = "overview" | "scoring" | "trace" | "files" | "raw";
export type WorkbenchPersistentSearchParams = Record<string, string | null | undefined>;

export type WorkbenchRoute =
  | {
      kind: "benchmark";
    }
  | {
      kind: "candidates";
    }
  | {
      kind: "run";
      runId: string | null;
    }
  | {
      kind: "candidate";
      candidateId: string | null;
      view: CandidateView;
      filePath: string | null;
      directoryPath: string | null;
      previewMode: CandidatePreviewMode;
      reviewCaseId: string | null;
      reviewTab: CandidateReviewTab;
      reviewRunId: string | null;
    };

export function parseWorkbenchRoute(locationLike: {
  pathname: string;
  search: string;
}): WorkbenchRoute {
  const normalizedPath = normalizePathname(locationLike.pathname);
  const segments = normalizedPath.split("/").filter(Boolean);
  const searchParams = new URLSearchParams(locationLike.search);

  if (segments.length === 0) {
    return {
      kind: "benchmark",
    };
  }

  if (segments.length === 1 && segments[0] === "candidates") {
    return {
      kind: "candidates",
    };
  }

  if (segments[0] === "runs") {
    return {
      kind: "run",
      runId: segments[1] ?? null,
    };
  }

  if (segments[0] === "candidate") {
    const candidateId = segments[1] ?? null;
    const requestedView = segments[2];
    const view =
      requestedView === "files"
        ? "files"
        : requestedView === "manifest"
          ? "manifest"
          : "evaluation";
    return {
      kind: "candidate",
      candidateId,
      view,
      filePath: searchParams.get("file"),
      directoryPath: normalizeDirectoryPath(searchParams.get("dir")),
      previewMode: normalizeCandidatePreviewMode(searchParams.get("view")),
      reviewCaseId: searchParams.get("task"),
      reviewTab: normalizeCandidateReviewTab(searchParams.get("tab")),
      reviewRunId: searchParams.get("run"),
    };
  }

  return {
    kind: "benchmark",
  };
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
    return withQuery("/", params);
  }

  if (route.kind === "candidates") {
    return withQuery("/candidates", params);
  }

  if (route.kind === "run") {
    const runId = route.runId ? encodeURIComponent(route.runId) : "";
    return withQuery(`/runs/${runId}`, params);
  }

  const candidateId = route.candidateId ? encodeURIComponent(route.candidateId) : "";
  if (route.view === "files" && route.filePath) {
    params.set("file", route.filePath);
  }
  if (route.view === "files" && route.directoryPath) {
    params.set("dir", route.directoryPath);
  }
  if (route.view === "files" && route.previewMode !== "rendered") {
    params.set("view", route.previewMode);
  }
  if (route.view === "evaluation" && route.reviewCaseId) {
    params.set("task", route.reviewCaseId);
    if (route.reviewTab !== "overview") {
      params.set("tab", route.reviewTab);
    }
    if (route.reviewRunId) {
      params.set("run", route.reviewRunId);
    }
  }

  const query = params.toString();
  return `/candidate/${candidateId}/${route.view}${query ? `?${query}` : ""}`;
}

export function buildWorkbenchLocationHref(
  route: WorkbenchRoute,
  routeBasePath: string,
  persistentSearchParams: WorkbenchPersistentSearchParams = {},
): string {
  return joinRouteBasePath(routeBasePath, buildWorkbenchHref(route, persistentSearchParams));
}

export function createBenchmarkRoute(): WorkbenchRoute {
  return {
    kind: "benchmark",
  };
}

export function createCandidatesRoute(): WorkbenchRoute {
  return {
    kind: "candidates",
  };
}

export function createRunRoute(args: {
  runId?: string | null;
} = {}): WorkbenchRoute {
  return {
    kind: "run",
    runId: args.runId ?? null,
  };
}

export function createCandidateRoute(args: {
  candidateId: string | null;
  view: CandidateView;
  filePath?: string | null;
  directoryPath?: string | null;
  previewMode?: CandidatePreviewMode;
  reviewCaseId?: string | null;
  reviewTab?: CandidateReviewTab;
  reviewRunId?: string | null;
}): WorkbenchRoute {
  const view = args.view;
  return {
    kind: "candidate",
    candidateId: args.candidateId,
    view,
    filePath: view === "files" ? args.filePath ?? null : null,
    directoryPath: view === "files" ? normalizeDirectoryPath(args.directoryPath ?? null) : null,
    previewMode: view === "files" ? args.previewMode ?? "rendered" : "rendered",
    reviewCaseId: view === "evaluation" ? args.reviewCaseId ?? null : null,
    reviewTab: view === "evaluation" ? args.reviewTab ?? "overview" : "overview",
    reviewRunId: view === "evaluation" ? args.reviewRunId ?? null : null,
  };
}

function normalizeDirectoryPath(value: string | null): string | null {
  const normalized = (value ?? "").replace(/^\/+/u, "").replace(/\/+$/u, "");
  return normalized || null;
}

function normalizeCandidateReviewTab(value: string | null): CandidateReviewTab {
  switch (value) {
    case "scoring":
    case "trace":
    case "files":
    case "raw":
      return value;
    default:
      return "overview";
  }
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
