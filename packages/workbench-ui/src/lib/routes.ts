import { isSnapshotPreviewMode } from "@workbench-ai/cli-web-ui/lib/file-preview";

import type { CandidatePreviewMode } from "../types";

export type CandidateView = "overview" | "manifest" | "files";
export type CandidatesIndexView = "archive" | "lineage";
export type WorkbenchPersistentSearchParams = Record<string, string | null | undefined>;
export type CandidateDialog =
  | {
      kind: "evaluation";
      evaluationId: string;
      caseId?: string | null;
    };
export type EvaluationDialog = {
  kind: "evaluation";
  evaluationId: string;
  caseId?: string | null;
};

export type WorkbenchRoute =
  | {
      kind: "benchmark";
    }
  | {
      kind: "candidates";
      view: CandidatesIndexView;
    }
  | {
      kind: "evaluations";
      dialog: EvaluationDialog | null;
    }
  | {
      kind: "candidate";
      candidateId: string | null;
      view: CandidateView;
      filePath: string | null;
      directoryPath: string | null;
      previewMode: CandidatePreviewMode;
      dialog: CandidateDialog | null;
    };

export function parseWorkbenchRoute(locationLike: {
  pathname: string;
  search: string;
}): WorkbenchRoute {
  const normalizedPath = normalizePathname(locationLike.pathname);
  const segments = normalizedPath.split("/").filter(Boolean).map(decodePathSegment);
  const searchParams = new URLSearchParams(locationLike.search);

  if (segments.length === 0) {
    return {
      kind: "benchmark",
    };
  }

  if (segments[0] === "evaluations") {
    if (segments.length === 1) {
      return {
        kind: "evaluations",
        dialog: parseEvaluationDialog(searchParams),
      };
    }
    return {
      kind: "benchmark",
    };
  }

  if (segments[0] === "candidates") {
    if (segments.length === 1) {
      return {
        kind: "candidates",
        view: normalizeCandidatesIndexView(searchParams.get("view")),
      };
    }
    const candidateId = segments[1] ?? null;
    const requestedView = segments[2];
    const view =
      requestedView === "files"
        ? "files"
        : requestedView === "manifest"
          ? "manifest"
          : "overview";
    return {
      kind: "candidate",
      candidateId,
      view,
      filePath: searchParams.get("file"),
      directoryPath: normalizeDirectoryPath(searchParams.get("dir")),
      previewMode: normalizeCandidatePreviewMode(searchParams.get("view")),
      dialog: parseCandidateDialog(searchParams),
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
    if (route.view !== "archive") {
      params.set("view", route.view);
    }
    return withQuery("/candidates", params);
  }

  if (route.kind === "evaluations") {
    if (route.dialog?.kind === "evaluation") {
      params.set("evaluation", route.dialog.evaluationId);
      if (route.dialog.caseId) {
        params.set("case", route.dialog.caseId);
      }
    }
    return withQuery("/evaluations", params);
  }

  const candidateId = route.candidateId ? encodeURIComponent(route.candidateId) : "";
  if (route.dialog?.kind === "evaluation") {
    params.set("evaluation", route.dialog.evaluationId);
    if (route.dialog.caseId) {
      params.set("case", route.dialog.caseId);
    }
  }
  if (route.view === "overview") {
    return withQuery(`/candidates/${candidateId}`, params);
  }
  if (route.view === "files" && route.filePath) {
    params.set("file", route.filePath);
  }
  if (route.view === "files" && route.directoryPath) {
    params.set("dir", route.directoryPath);
  }
  if (route.view === "files" && route.previewMode !== "rendered") {
    params.set("view", route.previewMode);
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

export function createBenchmarkRoute(): WorkbenchRoute {
  return {
    kind: "benchmark",
  };
}

export function createCandidatesRoute(args: {
  view?: CandidatesIndexView;
} = {}): WorkbenchRoute {
  return {
    kind: "candidates",
    view: args.view ?? "archive",
  };
}

export function createEvaluationsRoute(args: {
  dialog?: EvaluationDialog | null;
} = {}): WorkbenchRoute {
  return {
    kind: "evaluations",
    dialog: normalizeEvaluationDialog(args.dialog ?? null),
  };
}

export function createCandidateRoute(args: {
  candidateId: string | null;
  view: CandidateView;
  filePath?: string | null;
  directoryPath?: string | null;
  previewMode?: CandidatePreviewMode;
  dialog?: CandidateDialog | null;
}): WorkbenchRoute {
  const view = args.view;
  return {
    kind: "candidate",
    candidateId: args.candidateId,
    view,
    filePath: view === "files" ? args.filePath ?? null : null,
    directoryPath: view === "files" ? normalizeDirectoryPath(args.directoryPath ?? null) : null,
    previewMode: view === "files" ? args.previewMode ?? "rendered" : "rendered",
    dialog: normalizeCandidateDialog(args.dialog ?? null),
  };
}

function parseCandidateDialog(params: URLSearchParams): CandidateDialog | null {
  const evaluationId = normalizeDialogSelection(params.get("evaluation"));
  if (evaluationId) {
    const caseId = normalizeDialogSelection(params.get("case"));
    return {
      kind: "evaluation",
      evaluationId,
      ...(caseId ? { caseId } : {}),
    };
  }
  return null;
}

function parseEvaluationDialog(params: URLSearchParams): EvaluationDialog | null {
  const evaluationId = normalizeDialogSelection(params.get("evaluation"));
  const caseId = normalizeDialogSelection(params.get("case"));
  return evaluationId
    ? {
        kind: "evaluation",
        evaluationId,
        ...(caseId ? { caseId } : {}),
      }
    : null;
}

function normalizeCandidateDialog(dialog: CandidateDialog | null): CandidateDialog | null {
  if (dialog?.kind === "evaluation") {
    const evaluationId = normalizeDialogSelection(dialog.evaluationId);
    const caseId = normalizeDialogSelection(dialog.caseId ?? null);
    return evaluationId
      ? {
          kind: "evaluation",
          evaluationId,
          ...(caseId ? { caseId } : {}),
        }
      : null;
  }
  return null;
}

function normalizeEvaluationDialog(dialog: EvaluationDialog | null): EvaluationDialog | null {
  if (dialog?.kind !== "evaluation") {
    return null;
  }
  const evaluationId = normalizeDialogSelection(dialog.evaluationId);
  const caseId = normalizeDialogSelection(dialog.caseId ?? null);
  return evaluationId
    ? {
        kind: "evaluation",
        evaluationId,
        ...(caseId ? { caseId } : {}),
      }
    : null;
}

function normalizeDirectoryPath(value: string | null): string | null {
  const normalized = (value ?? "").replace(/^\/+/u, "").replace(/\/+$/u, "");
  return normalized || null;
}

function normalizeCandidatesIndexView(value: string | null): CandidatesIndexView {
  return value === "lineage" ? "lineage" : "archive";
}

function normalizeDialogSelection(value: string | null): string | null {
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
