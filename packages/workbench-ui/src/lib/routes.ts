import {
  isSnapshotPreviewMode,
  type PreviewMode,
} from "@workbench-ai/cli-web-ui/lib/file-preview";

export type VersionsView = "list" | "graph";
export type WorkbenchFileOwnerKind = "version" | "trace" | "artifact";

export interface WorkbenchFileRouteState {
  filePath: string | null;
  directoryPath: string | null;
  previewMode: PreviewMode;
}

export type WorkbenchSurfaceRoute =
  | { kind: "scorecard" }
  | { kind: "versions"; view: VersionsView }
  | { kind: "files"; file: WorkbenchFileRouteState };

export type WorkbenchCaseView = "output" | "timeline";

// The detail pane shows one first-class object picked from a surface or
// drilled into from another pane (run -> case). The case pane has tabbed
// views; "output" is the default and is never stored on the route.
export type WorkbenchInspectorRoute =
  | { kind: "version"; versionId: string }
  | { kind: "run"; runId: string }
  | { kind: "job"; jobId: string; view?: Exclude<WorkbenchCaseView, "output"> }
  | { kind: "skill-source"; skillName: string };

// The single full-screen leaf modal: browsing a version's files from its
// pane. Object details never open as modals; they render in the pane itself.
export type WorkbenchOverlayRoute = { kind: "version-files" };

export interface WorkbenchRoute {
  surface: WorkbenchSurfaceRoute;
  inspector: WorkbenchInspectorRoute | null;
  overlay: WorkbenchOverlayRoute | null;
}

export function parseWorkbenchRoute(
  pathname = "/",
  routeBasePath = "/",
  search = "",
): WorkbenchRoute {
  const [pathOnly, inlineSearch = ""] = pathname.split("?", 2);
  const searchParams = new URLSearchParams(search || inlineSearch);
  const segments = routeSegments(pathOnly ?? "/", routeBasePath);
  const { surface, inspectorSegments } = parseSurfaceSegments(segments, searchParams);
  const { inspector, overlay } = parseInspectorSegments(inspectorSegments);
  return createWorkbenchRoute(surface, inspector, overlay);
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

export function buildWorkbenchLocationHref(route: WorkbenchRoute = createScorecardRoute(), routeBasePath = "/"): string {
  const base = normalizedBasePath(routeBasePath);
  const path = routeParts(route).map(encodeURIComponent);
  const pathname = path.length === 0
    ? base
    : `${base === "/" ? "" : base}/${path.join("/")}`;
  const query = routeQuery(route).toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function createWorkbenchRoute(
  surface: WorkbenchSurfaceRoute = { kind: "scorecard" },
  inspector: WorkbenchInspectorRoute | null = null,
  overlay: WorkbenchOverlayRoute | null = null,
): WorkbenchRoute {
  const normalizedInspector = inspector ?? null;
  return {
    surface: normalizeSurfaceRoute(surface),
    inspector: normalizedInspector,
    overlay: normalizeOverlayRoute(normalizedInspector, overlay),
  };
}

export function createScorecardRoute(
  inspector: WorkbenchInspectorRoute | null = null,
  overlay: WorkbenchOverlayRoute | null = null,
): WorkbenchRoute {
  return createWorkbenchRoute({ kind: "scorecard" }, inspector, overlay);
}

export function createVersionsRoute(args: {
  view?: VersionsView;
  inspector?: WorkbenchInspectorRoute | null;
  overlay?: WorkbenchOverlayRoute | null;
} = {}): WorkbenchRoute {
  return createWorkbenchRoute(
    { kind: "versions", view: args.view ?? "list" },
    args.inspector ?? null,
    args.overlay ?? null,
  );
}

export function createFilesRoute(args: {
  file?: Partial<WorkbenchFileRouteState>;
  inspector?: WorkbenchInspectorRoute | null;
  overlay?: WorkbenchOverlayRoute | null;
} = {}): WorkbenchRoute {
  return createWorkbenchRoute(
    { kind: "files", file: normalizeFileRouteState(args.file) },
    args.inspector ?? null,
    args.overlay ?? null,
  );
}

export function routeSurface(route: WorkbenchRoute): WorkbenchSurfaceRoute {
  return route.surface;
}

export function routeInspector(route: WorkbenchRoute): WorkbenchInspectorRoute | null {
  return route.inspector;
}

export function routeOverlay(route: WorkbenchRoute): WorkbenchOverlayRoute | null {
  return route.overlay;
}

export function withSurface(route: WorkbenchRoute, surface: WorkbenchSurfaceRoute): WorkbenchRoute {
  return createWorkbenchRoute(surface, route.inspector, route.overlay);
}

export function withInspector(route: WorkbenchRoute, inspector: WorkbenchInspectorRoute | null): WorkbenchRoute {
  return createWorkbenchRoute(route.surface, inspector);
}

export function withoutInspector(route: WorkbenchRoute): WorkbenchRoute {
  return createWorkbenchRoute(route.surface);
}

export function withOverlay(route: WorkbenchRoute, overlay: WorkbenchOverlayRoute | null): WorkbenchRoute {
  return createWorkbenchRoute(route.surface, route.inspector, overlay);
}

export function withCaseView(route: WorkbenchRoute, view: WorkbenchCaseView): WorkbenchRoute {
  const inspector = route.inspector;
  if (inspector?.kind !== "job") {
    return route;
  }
  return withInspector(route, view === "output"
    ? { kind: "job", jobId: inspector.jobId }
    : { kind: "job", jobId: inspector.jobId, view });
}

export function routeCaseView(route: WorkbenchRoute): WorkbenchCaseView {
  return route.inspector?.kind === "job" ? route.inspector.view ?? "output" : "output";
}

export function withFileRouteState(route: WorkbenchRoute, file: Partial<WorkbenchFileRouteState>): WorkbenchRoute {
  if (route.surface.kind === "files") {
    return withSurface(route, { kind: "files", file: normalizeFileRouteState(file) });
  }
  return route;
}

function parseSurfaceSegments(
  segments: string[],
  searchParams: URLSearchParams,
): { surface: WorkbenchSurfaceRoute; inspectorSegments: string[] } {
  const [section, id] = segments;
  if (!section) {
    return { surface: { kind: "scorecard" }, inspectorSegments: [] };
  }
  if (section === "versions") {
    if (id === "graph") {
      return { surface: { kind: "versions", view: "graph" }, inspectorSegments: segments.slice(2) };
    }
    // "/versions/<id>" inspects a version; "/versions/runs/<id>" etc. carry other inspectors.
    const inspectorSegments = id === "runs" || id === "jobs" || id === "skills"
      ? segments.slice(1)
      : segments;
    return { surface: { kind: "versions", view: "list" }, inspectorSegments };
  }
  if (section === "files") {
    return {
      surface: { kind: "files", file: parseFileRouteState(searchParams) },
      inspectorSegments: segments.slice(1),
    };
  }
  if (section === "runs" || section === "jobs" || section === "skills") {
    return { surface: { kind: "scorecard" }, inspectorSegments: segments };
  }
  return { surface: { kind: "scorecard" }, inspectorSegments: [] };
}

function parseInspectorSegments(segments: string[]): {
  inspector: WorkbenchInspectorRoute | null;
  overlay: WorkbenchOverlayRoute | null;
} {
  const [section, id, ...rest] = segments;
  if (!section || !id) {
    return { inspector: null, overlay: null };
  }
  if (section === "versions") {
    return {
      inspector: { kind: "version", versionId: id },
      overlay: rest.length === 1 && rest[0] === "files" ? { kind: "version-files" } : null,
    };
  }
  if (section === "runs") {
    return rest.length === 0
      ? { inspector: { kind: "run", runId: id }, overlay: null }
      : { inspector: null, overlay: null };
  }
  if (section === "jobs") {
    if (rest.length === 0) {
      return { inspector: { kind: "job", jobId: id }, overlay: null };
    }
    if (rest.length === 1 && rest[0] === "timeline") {
      return { inspector: { kind: "job", jobId: id, view: "timeline" }, overlay: null };
    }
    return { inspector: null, overlay: null };
  }
  if (section === "skills") {
    return rest.length === 0
      ? { inspector: { kind: "skill-source", skillName: id }, overlay: null }
      : { inspector: null, overlay: null };
  }
  return { inspector: null, overlay: null };
}

function routeParts(route: WorkbenchRoute): string[] {
  const surfaceParts = surfaceRouteParts(route.surface);
  const inspector = route.inspector;
  if (!inspector) {
    return surfaceParts;
  }
  const inspectorParts = inspectorRouteParts(inspector);
  const paneParts = surfaceParts.at(-1) === inspectorParts[0]
    ? [...surfaceParts, ...inspectorParts.slice(1)]
    : [...surfaceParts, ...inspectorParts];
  return route.overlay ? [...paneParts, ...overlayRouteParts(route.overlay)] : paneParts;
}

function surfaceRouteParts(surface: WorkbenchSurfaceRoute): string[] {
  if (surface.kind === "scorecard") {
    return [];
  }
  if (surface.kind === "versions") {
    return surface.view === "graph" ? ["versions", "graph"] : ["versions"];
  }
  return ["files"];
}

function inspectorRouteParts(inspector: WorkbenchInspectorRoute): string[] {
  switch (inspector.kind) {
    case "version":
      return ["versions", inspector.versionId];
    case "run":
      return ["runs", inspector.runId];
    case "job":
      return inspector.view
        ? ["jobs", inspector.jobId, inspector.view]
        : ["jobs", inspector.jobId];
    case "skill-source":
      return ["skills", inspector.skillName];
  }
}

function overlayRouteParts(overlay: WorkbenchOverlayRoute): string[] {
  switch (overlay.kind) {
    case "version-files":
      return ["files"];
  }
}

function routeQuery(route: WorkbenchRoute): URLSearchParams {
  const params = new URLSearchParams();
  if (route.surface.kind === "files") {
    appendFileRouteParams(params, route.surface.file);
  }
  return params;
}

function appendFileRouteParams(params: URLSearchParams, file: WorkbenchFileRouteState): void {
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
  return {
    filePath: normalizeRouteSelection(searchParams.get("file")),
    directoryPath: normalizeRouteSelection(searchParams.get("dir")),
    previewMode: isSnapshotPreviewMode(previewMode) ? previewMode : "rendered",
  };
}

function normalizeSurfaceRoute(surface: WorkbenchSurfaceRoute): WorkbenchSurfaceRoute {
  if (surface.kind === "files") {
    return { kind: "files", file: normalizeFileRouteState(surface.file) };
  }
  return surface;
}

function normalizeOverlayRoute(
  inspector: WorkbenchInspectorRoute | null,
  overlay: WorkbenchOverlayRoute | null | undefined,
): WorkbenchOverlayRoute | null {
  if (!inspector || !overlay) {
    return null;
  }
  return inspector.kind === "version" ? overlay : null;
}

function normalizeFileRouteState(file: Partial<WorkbenchFileRouteState> | undefined): WorkbenchFileRouteState {
  return {
    filePath: file?.filePath ?? null,
    directoryPath: file?.directoryPath ?? null,
    previewMode: file?.previewMode ?? "rendered",
  };
}

function routeSegments(pathname: string, routeBasePath: string): string[] {
  const normalizedPath = normalizePath(pathname);
  const base = normalizedBasePath(routeBasePath);
  const relative = base !== "/" && (normalizedPath === base || normalizedPath.startsWith(`${base}/`))
    ? normalizedPath.slice(base.length)
    : normalizedPath;
  return relative.split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

function normalizeRouteSelection(value: string | null): string | null {
  return value && value.trim().length > 0 ? value : null;
}

function normalizedBasePath(routeBasePath: string): string {
  const normalized = normalizePath(routeBasePath);
  return normalized === "" ? "/" : normalized;
}

function normalizePath(value: string): string {
  const withoutQuery = value.split(/[?#]/u)[0] ?? "/";
  const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/u, "") : withLeadingSlash;
}
