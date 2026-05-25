import { isSnapshotPreviewMode } from "@workbench-ai/cli-web-ui/lib/file-preview";

import type { SubjectPreviewMode } from "../types";

export type SubjectView = "overview" | "manifest" | "files";
export type SubjectsIndexView = "archive" | "lineage";
export type WorkbenchPersistentSearchParams = Record<string, string | null | undefined>;
export type SubjectDialog =
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
      kind: "subjects";
      view: SubjectsIndexView;
    }
  | {
      kind: "evaluations";
      dialog: EvaluationDialog | null;
    }
  | {
      kind: "subject";
      subjectId: string | null;
      view: SubjectView;
      filePath: string | null;
      directoryPath: string | null;
      previewMode: SubjectPreviewMode;
      dialog: SubjectDialog | null;
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

  if (segments[0] === "subjects") {
    if (segments.length === 1) {
      return {
        kind: "subjects",
        view: normalizeSubjectsIndexView(searchParams.get("view")),
      };
    }
    const subjectId = segments[1] ?? null;
    const requestedView = segments[2];
    const view =
      requestedView === "files"
        ? "files"
        : requestedView === "manifest"
          ? "manifest"
          : "overview";
    return {
      kind: "subject",
      subjectId,
      view,
      filePath: searchParams.get("file"),
      directoryPath: normalizeDirectoryPath(searchParams.get("dir")),
      previewMode: normalizeSubjectPreviewMode(searchParams.get("view")),
      dialog: parseSubjectDialog(searchParams),
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

  if (route.kind === "subjects") {
    if (route.view !== "archive") {
      params.set("view", route.view);
    }
    return withQuery("/subjects", params);
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

  const subjectId = route.subjectId ? encodeURIComponent(route.subjectId) : "";
  if (route.dialog?.kind === "evaluation") {
    params.set("evaluation", route.dialog.evaluationId);
    if (route.dialog.caseId) {
      params.set("case", route.dialog.caseId);
    }
  }
  if (route.view === "overview") {
    return withQuery(`/subjects/${subjectId}`, params);
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
  return `/subjects/${subjectId}/${route.view}${query ? `?${query}` : ""}`;
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

export function createSubjectsRoute(args: {
  view?: SubjectsIndexView;
} = {}): WorkbenchRoute {
  return {
    kind: "subjects",
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

export function createSubjectRoute(args: {
  subjectId: string | null;
  view: SubjectView;
  filePath?: string | null;
  directoryPath?: string | null;
  previewMode?: SubjectPreviewMode;
  dialog?: SubjectDialog | null;
}): WorkbenchRoute {
  const view = args.view;
  return {
    kind: "subject",
    subjectId: args.subjectId,
    view,
    filePath: view === "files" ? args.filePath ?? null : null,
    directoryPath: view === "files" ? normalizeDirectoryPath(args.directoryPath ?? null) : null,
    previewMode: view === "files" ? args.previewMode ?? "rendered" : "rendered",
    dialog: normalizeSubjectDialog(args.dialog ?? null),
  };
}

function parseSubjectDialog(params: URLSearchParams): SubjectDialog | null {
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

function normalizeSubjectDialog(dialog: SubjectDialog | null): SubjectDialog | null {
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

function normalizeSubjectsIndexView(value: string | null): SubjectsIndexView {
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

function normalizeSubjectPreviewMode(value: string | null): SubjectPreviewMode {
  return value && isSnapshotPreviewMode(value) ? value : "rendered";
}
