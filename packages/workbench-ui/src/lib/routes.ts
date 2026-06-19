import {
  isSnapshotPreviewMode,
  type PreviewMode,
} from "@workbench-ai/cli-web-ui/lib/file-preview";
import type { WorkbenchInspectionFileOwnerKind } from "@workbench-ai/workbench-contract";

export type WorkbenchPrimaryTab = "files" | "evaluation" | "runs";
export type WorkbenchEvaluationView = "results" | "cases";
export type WorkbenchRunRouteSource = "evaluation" | "runs";
export type WorkbenchCaseSection = "definition" | "runs";
export type WorkbenchJobEvidenceView = "trace" | "output";
export type WorkbenchRunSection =
  | { kind: "summary" }
  | { kind: "job"; jobId: string; view: WorkbenchJobEvidenceView };
export type WorkbenchFileOwnerKind = WorkbenchInspectionFileOwnerKind;

export interface WorkbenchFileRouteState {
  filePath: string | null;
  directoryPath: string | null;
  previewMode: PreviewMode;
  versionId: string | null;
}

export type WorkbenchRoute =
  | { kind: "files"; file: WorkbenchFileRouteState }
  | { kind: "evaluation"; view: WorkbenchEvaluationView; evaluationId: string | null }
  | { kind: "case"; caseId: string; evaluationId: string | null; section: WorkbenchCaseSection; file: WorkbenchFileRouteState }
  | { kind: "run"; runId: string; source: WorkbenchRunRouteSource; evaluationId: string | null; section: WorkbenchRunSection }
  | { kind: "runs" }
  | { kind: "not-found"; path: string };

export function parseWorkbenchRoute(
  pathname = "/",
  routeBasePath = "/",
  search = "",
): WorkbenchRoute {
  const [pathOnly, inlineSearch = ""] = pathname.split("?", 2);
  const searchParams = new URLSearchParams(search || inlineSearch);
  const segments = routeSegments(pathOnly ?? "/", routeBasePath);
  const evaluationId = normalizedQueryValue(searchParams.get("evaluation"));
  const sectionParam = normalizedQueryValue(searchParams.get("section"));
  const [section, subsection, id, ...rest] = segments;

  if (!section) {
    return createFilesRoute({ file: parseFileRouteState(searchParams) });
  }
  if (section === "files") {
    return createFilesRoute({ file: parseFileRouteState(searchParams) });
  }
  if (section === "evaluation") {
    if (!subsection || subsection === "results") {
      return createEvaluationRoute({ view: "results", evaluationId });
    }
    if (subsection === "cases" && !id) {
      return createEvaluationRoute({ view: "cases", evaluationId });
    }
    if (subsection === "cases" && id && rest.length === 0) {
      return createCaseRoute({ caseId: id, evaluationId, section: parseCaseSection(sectionParam), file: parseCaseFileRouteState(searchParams) });
    }
    if (subsection === "runs" && id && rest.length === 0) {
      return createRunRoute({ runId: id, source: "evaluation", evaluationId, section: parseRunSection(sectionParam) });
    }
    return createNotFoundRoute(segments);
  }
  if (section === "runs") {
    if (!subsection) {
      return createRunsRoute();
    }
    if (subsection && !id && rest.length === 0) {
      return createRunRoute({ runId: subsection, source: "runs", evaluationId: null, section: parseRunSection(sectionParam) });
    }
    return createNotFoundRoute(segments);
  }
  return createNotFoundRoute(segments);
}

export function parseWorkbenchLocation(
  location: { pathname: string; search?: string } | string | undefined = typeof window === "undefined" ? "/" : window.location,
  routeBasePath = "/",
): WorkbenchRoute {
  return parseWorkbenchRoute(
    typeof location === "string" ? location : location.pathname,
    routeBasePath,
    typeof location === "string" ? "" : location.search ?? "",
  );
}

export function buildWorkbenchLocationHref(route: WorkbenchRoute = createFilesRoute(), routeBasePath = "/"): string {
  const base = normalizedBasePath(routeBasePath);
  const parts = routeParts(route).map(encodeURIComponent);
  const pathname = parts.length === 0
    ? base
    : `${base === "/" ? "" : base}/${parts.join("/")}`;
  const query = routeQuery(route).toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function createFilesRoute(args: {
  file?: Partial<WorkbenchFileRouteState>;
} = {}): WorkbenchRoute {
  return { kind: "files", file: normalizeFileRouteState(args.file) };
}

export function createEvaluationRoute(args: {
  view?: WorkbenchEvaluationView;
  evaluationId?: string | null;
} = {}): WorkbenchRoute {
  return {
    kind: "evaluation",
    view: args.view ?? "results",
    evaluationId: normalizedQueryValue(args.evaluationId ?? null),
  };
}

export function createCaseRoute(args: {
  caseId: string;
  evaluationId?: string | null;
  file?: Partial<WorkbenchFileRouteState>;
  section?: WorkbenchCaseSection;
}): WorkbenchRoute {
  return {
    kind: "case",
    caseId: args.caseId,
    evaluationId: normalizedQueryValue(args.evaluationId ?? null),
    file: normalizeCaseFileRouteState(args.file),
    section: args.section ?? "definition",
  };
}

export function createRunRoute(args: {
  runId: string;
  source?: WorkbenchRunRouteSource;
  evaluationId?: string | null;
  section?: WorkbenchRunSection;
}): WorkbenchRoute {
  const source = args.source ?? "runs";
  return {
    kind: "run",
    runId: args.runId,
    source,
    evaluationId: source === "evaluation" ? normalizedQueryValue(args.evaluationId ?? null) : null,
    section: normalizeRunSection(args.section),
  };
}

export function createRunsRoute(): WorkbenchRoute {
  return { kind: "runs" };
}

export function createNotFoundRoute(path: string[] | string): WorkbenchRoute {
  return {
    kind: "not-found",
    path: Array.isArray(path) ? `/${path.join("/")}` : path,
  };
}

export function routePrimaryTab(route: WorkbenchRoute): WorkbenchPrimaryTab {
  if (route.kind === "runs") {
    return "runs";
  }
  if (route.kind === "evaluation" || route.kind === "case" || (route.kind === "run" && route.source === "evaluation")) {
    return "evaluation";
  }
  if (route.kind === "run" && route.source === "runs") {
    return "runs";
  }
  return "files";
}

export function withFileRouteState(route: WorkbenchRoute, file: Partial<WorkbenchFileRouteState>): WorkbenchRoute {
  if (route.kind === "files") {
    return createFilesRoute({ file: { ...route.file, ...file } });
  }
  if (route.kind === "case") {
    return createCaseRoute({
      caseId: route.caseId,
      evaluationId: route.evaluationId,
      section: route.section,
      file: { ...route.file, ...file },
    });
  }
  return route;
}

export function withEvaluationId(route: WorkbenchRoute, evaluationId: string | null): WorkbenchRoute {
  switch (route.kind) {
    case "evaluation":
      return createEvaluationRoute({ view: route.view, evaluationId });
    case "case":
      return createCaseRoute({ caseId: route.caseId, evaluationId, section: route.section, file: route.file });
    case "run":
      return createRunRoute({ runId: route.runId, source: route.source, evaluationId, section: route.section });
    default:
      return route;
  }
}

export function emptyFileRouteState(): WorkbenchFileRouteState {
  return {
    filePath: null,
    directoryPath: null,
    previewMode: "rendered",
    versionId: null,
  };
}

function routeParts(route: WorkbenchRoute): string[] {
  switch (route.kind) {
    case "files":
      return routeHasExplicitFileState(route.file) ? ["files"] : [];
    case "evaluation":
      return route.view === "cases" ? ["evaluation", "cases"] : ["evaluation", "results"];
    case "case":
      return ["evaluation", "cases", route.caseId];
    case "run":
      return route.source === "evaluation"
        ? ["evaluation", "runs", route.runId]
        : ["runs", route.runId];
    case "runs":
      return ["runs"];
    case "not-found":
      return route.path.split("/").filter(Boolean);
  }
}

function routeQuery(route: WorkbenchRoute): URLSearchParams {
  const params = new URLSearchParams();
  if (route.kind === "files") {
    fileRouteQuery(route.file, params);
    return params;
  }
  if ((route.kind === "evaluation" || route.kind === "case" || route.kind === "run") && route.evaluationId) {
    params.set("evaluation", route.evaluationId);
  }
  if (route.kind === "case" && route.section !== "definition") {
    params.set("section", route.section);
  }
  if (route.kind === "case" && route.section === "definition") {
    caseFileRouteQuery(route.file, params);
  }
  if (route.kind === "run" && route.section.kind === "job") {
    params.set("section", route.section.view === "output"
      ? `job:${route.section.jobId}:output`
      : `job:${route.section.jobId}`);
  }
  return params;
}

function fileRouteQuery(file: WorkbenchFileRouteState, params: URLSearchParams): void {
  if (file.versionId) {
    params.set("version", file.versionId);
  }
  if (file.filePath) {
    params.set("file", file.filePath);
  }
  if (file.directoryPath) {
    params.set("dir", file.directoryPath);
  }
  if (file.previewMode !== "rendered") {
    params.set("view", file.previewMode);
  }
}

function caseFileRouteQuery(file: WorkbenchFileRouteState, params: URLSearchParams): void {
  if (file.filePath) {
    params.set("file", file.filePath);
  }
  if (file.directoryPath) {
    params.set("dir", file.directoryPath);
  }
  if (file.previewMode !== "rendered") {
    params.set("view", file.previewMode);
  }
}

function parseFileRouteState(searchParams: URLSearchParams): WorkbenchFileRouteState {
  const previewMode = searchParams.get("view");
  return normalizeFileRouteState({
    filePath: searchParams.get("file"),
    directoryPath: searchParams.get("dir"),
    previewMode: previewMode && isSnapshotPreviewMode(previewMode) ? previewMode : "rendered",
    versionId: searchParams.get("version"),
  });
}

function parseCaseFileRouteState(searchParams: URLSearchParams): WorkbenchFileRouteState {
  return normalizeCaseFileRouteState(parseFileRouteState(searchParams));
}

function normalizeFileRouteState(file: Partial<WorkbenchFileRouteState> | null | undefined): WorkbenchFileRouteState {
  return {
    filePath: normalizedQueryValue(file?.filePath ?? null),
    directoryPath: normalizedQueryValue(file?.directoryPath ?? null),
    previewMode: file?.previewMode && isSnapshotPreviewMode(file.previewMode) ? file.previewMode : "rendered",
    versionId: normalizedQueryValue(file?.versionId ?? null),
  };
}

function normalizeCaseFileRouteState(file: Partial<WorkbenchFileRouteState> | null | undefined): WorkbenchFileRouteState {
  return {
    ...normalizeFileRouteState(file),
    versionId: null,
  };
}

function parseCaseSection(section: string | null): WorkbenchCaseSection {
  return section === "runs" ? "runs" : "definition";
}

function parseRunSection(section: string | null): WorkbenchRunSection {
  if (!section?.startsWith("job:")) {
    return { kind: "summary" };
  }
  const [, rawJobId, rawView] = section.split(":");
  const jobId = normalizedQueryValue(rawJobId);
  if (!jobId) {
    return { kind: "summary" };
  }
  return {
    kind: "job",
    jobId,
    view: rawView === "output" ? "output" : "trace",
  };
}

function normalizeRunSection(section: WorkbenchRunSection | undefined): WorkbenchRunSection {
  if (!section || section.kind === "summary") {
    return { kind: "summary" };
  }
  return {
    kind: "job",
    jobId: section.jobId,
    view: section.view ?? "trace",
  };
}

function routeHasExplicitFileState(file: WorkbenchFileRouteState): boolean {
  return Boolean(file.versionId || file.filePath || file.directoryPath || file.previewMode !== "rendered");
}

function normalizedQueryValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function routeSegments(pathname: string, routeBasePath: string): string[] {
  const base = normalizedBasePath(routeBasePath);
  const path = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  return path
    .replace(/^\/+|\/+$/gu, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

function normalizedBasePath(routeBasePath: string): string {
  const trimmed = routeBasePath.replace(/\/+$/u, "");
  return trimmed || "/";
}
