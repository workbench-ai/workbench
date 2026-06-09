import {
  isSnapshotPreviewMode,
  type PreviewMode,
} from "@workbench-ai/cli-web-ui/lib/file-preview";

export type SkillSurfaceView = "overview" | "manifest" | "files";
export type VersionsIndexView = "archive" | "lineage";
export type VersionView = "overview" | "files" | "runs";
export type ExecutionIndexView = "runs" | "jobs" | "traces" | "artifacts";
export type RunView = "overview" | "jobs" | "traces" | "artifacts";
export type JobView = "overview" | "trace" | "artifacts";
export type TraceView = "overview" | "files" | "payload";
export type ArtifactView = "overview" | "files";
export type ConfigurationView = "skills" | "agents";
export type SyncView = "refs" | "remotes";
export type WorkbenchFileOwnerKind = "version" | "trace" | "artifact";

export interface WorkbenchFileRouteState {
  filePath: string | null;
  directoryPath: string | null;
  previewMode: PreviewMode;
}

export interface WorkbenchSkillSurfaceRouteState {
  skillView?: SkillSurfaceView;
  skillFile?: WorkbenchFileRouteState;
}

export type WorkbenchRoute =
  | { kind: "skill"; view: SkillSurfaceView; file: WorkbenchFileRouteState }
  | ({ kind: "versions"; view: VersionsIndexView } & WorkbenchSkillSurfaceRouteState)
  | ({ kind: "version"; versionId: string; view: VersionView; file: WorkbenchFileRouteState } & WorkbenchSkillSurfaceRouteState)
  | ({ kind: "execution"; view: ExecutionIndexView } & WorkbenchSkillSurfaceRouteState)
  | ({ kind: "run"; runId: string; view: RunView } & WorkbenchSkillSurfaceRouteState)
  | ({ kind: "job"; jobId: string; view: JobView } & WorkbenchSkillSurfaceRouteState)
  | ({ kind: "trace"; traceId: string; view: TraceView; file: WorkbenchFileRouteState } & WorkbenchSkillSurfaceRouteState)
  | ({ kind: "artifact"; artifactId: string; view: ArtifactView; file: WorkbenchFileRouteState } & WorkbenchSkillSurfaceRouteState)
  | ({ kind: "configuration"; view: ConfigurationView } & WorkbenchSkillSurfaceRouteState)
  | ({ kind: "skill-source"; skillName: string } & WorkbenchSkillSurfaceRouteState)
  | ({ kind: "agent"; agentName: string } & WorkbenchSkillSurfaceRouteState)
  | ({ kind: "sync"; view: SyncView } & WorkbenchSkillSurfaceRouteState);

export function parseWorkbenchRoute(
  pathname = "/",
  routeBasePath = "/",
  search = "",
): WorkbenchRoute {
  const [pathOnly, inlineSearch = ""] = pathname.split("?", 2);
  const searchParams = new URLSearchParams(search || inlineSearch);
  const file = parseFileRouteState(searchParams);
  const skillSurface = parseSkillSurfaceRouteState(searchParams);
  const segments = routeSegments(pathOnly ?? "/", routeBasePath);
  const [section, id, child, ...rest] = segments;

  if (!section) {
    return { kind: "skill", view: "overview", file: emptyFileRouteState() };
  }
  if (section === "files") {
    return { kind: "skill", view: "files", file };
  }
  if (section === "manifest") {
    return { kind: "skill", view: "manifest", file: emptyFileRouteState() };
  }
  if (section === "versions") {
    if (!id) {
      return { kind: "versions", view: "archive", ...skillSurface };
    }
    if (id === "lineage") {
      return { kind: "versions", view: "lineage", ...skillSurface };
    }
    if (child === "files") {
      return {
        kind: "version",
        versionId: id,
        view: "files",
        file: fileWithLegacyPath(file, rest),
        ...skillSurface,
      };
    }
    if (child === "runs") {
      return { kind: "version", versionId: id, view: "runs", file: emptyFileRouteState(), ...skillSurface };
    }
    return { kind: "version", versionId: id, view: "overview", file: emptyFileRouteState(), ...skillSurface };
  }
  if (section === "execution") {
    return { kind: "execution", view: executionViewFromSegment(id), ...skillSurface };
  }
  if (section === "runs") {
    if (!id) {
      return { kind: "execution", view: "runs", ...skillSurface };
    }
    return { kind: "run", runId: id, view: runViewFromSegment(child), ...skillSurface };
  }
  if (section === "jobs") {
    if (!id) {
      return { kind: "execution", view: "jobs", ...skillSurface };
    }
    return { kind: "job", jobId: id, view: jobViewFromSegment(child), ...skillSurface };
  }
  if (section === "traces") {
    if (!id) {
      return { kind: "execution", view: "traces", ...skillSurface };
    }
    if (child === "files") {
      return {
        kind: "trace",
        traceId: id,
        view: "files",
        file: fileWithLegacyPath(file, rest),
        ...skillSurface,
      };
    }
    return { kind: "trace", traceId: id, view: traceViewFromSegment(child), file: emptyFileRouteState(), ...skillSurface };
  }
  if (section === "artifacts") {
    if (!id) {
      return { kind: "execution", view: "artifacts", ...skillSurface };
    }
    if (child === "files") {
      return {
        kind: "artifact",
        artifactId: id,
        view: "files",
        file: fileWithLegacyPath(file, rest),
        ...skillSurface,
      };
    }
    return { kind: "artifact", artifactId: id, view: "overview", file: emptyFileRouteState(), ...skillSurface };
  }
  if (section === "configuration") {
    return { kind: "configuration", view: id === "agents" ? "agents" : "skills", ...skillSurface };
  }
  if (section === "skills" && id) {
    return { kind: "skill-source", skillName: id, ...skillSurface };
  }
  if (section === "agents" && id) {
    return { kind: "agent", agentName: id, ...skillSurface };
  }
  if (section === "sync") {
    return { kind: "sync", view: id === "remotes" ? "remotes" : "refs", ...skillSurface };
  }
  if (section === "refs") {
    return { kind: "sync", view: "refs", ...skillSurface };
  }
  if (section === "remotes") {
    return { kind: "sync", view: "remotes", ...skillSurface };
  }
  return { kind: "skill", view: "overview", file: emptyFileRouteState() };
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

export function buildWorkbenchLocationHref(route: WorkbenchRoute = createSkillRoute(), routeBasePath = "/"): string {
  const base = normalizedBasePath(routeBasePath);
  const path = routeParts(route).map(encodeURIComponent);
  const pathname = path.length === 0
    ? base
    : `${base === "/" ? "" : base}/${path.join("/")}`;
  const query = routeQuery(route).toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function createSkillRoute(args: {
  view?: SkillSurfaceView;
  file?: Partial<WorkbenchFileRouteState>;
} = {}): WorkbenchRoute {
  return {
    kind: "skill",
    view: args.view ?? "overview",
    file: normalizeFileRouteState(args.file),
  };
}

export function routeHasDetail(route: WorkbenchRoute): boolean {
  return route.kind !== "skill";
}

export function routeSkillSurfaceView(route: WorkbenchRoute): SkillSurfaceView {
  if (route.kind === "skill") {
    return route.view;
  }
  return route.skillView ?? "overview";
}

export function routeSkillSurfaceFile(route: WorkbenchRoute): WorkbenchFileRouteState {
  if (route.kind === "skill") {
    return route.view === "files" ? route.file : emptyFileRouteState();
  }
  return route.skillView === "files" ? normalizeFileRouteState(route.skillFile) : emptyFileRouteState();
}

export function withSkillSurface(
  route: WorkbenchRoute,
  skillSurface: {
    skillView?: SkillSurfaceView;
    skillFile?: Partial<WorkbenchFileRouteState>;
  },
): WorkbenchRoute {
  const skillView = skillSurface.skillView ?? routeSkillSurfaceView(route);
  const skillFile = skillView === "files"
    ? normalizeFileRouteState(skillSurface.skillFile ?? routeSkillSurfaceFile(route))
    : emptyFileRouteState();
  if (route.kind === "skill") {
    return createSkillRoute({ view: skillView, file: skillFile });
  }
  return {
    ...route,
    skillView,
    skillFile: skillView === "files" ? skillFile : undefined,
  };
}

export function fileOwnerForRoute(route: WorkbenchRoute): { ownerKind: WorkbenchFileOwnerKind; ownerId: string; file: WorkbenchFileRouteState } | null {
  if (route.kind === "version" && route.view === "files") {
    return { ownerKind: "version", ownerId: route.versionId, file: route.file };
  }
  if (route.kind === "trace" && route.view === "files") {
    return { ownerKind: "trace", ownerId: route.traceId, file: route.file };
  }
  if (route.kind === "artifact" && route.view === "files") {
    return { ownerKind: "artifact", ownerId: route.artifactId, file: route.file };
  }
  return null;
}

export function withFileRouteState(route: WorkbenchRoute, file: Partial<WorkbenchFileRouteState>): WorkbenchRoute {
  const nextFile = normalizeFileRouteState(file);
  if (route.kind === "skill" && route.view === "files") {
    return { ...route, file: nextFile };
  }
  if (route.kind === "version" && route.view === "files") {
    return { ...route, file: nextFile };
  }
  if (route.kind === "trace" && route.view === "files") {
    return { ...route, file: nextFile };
  }
  if (route.kind === "artifact" && route.view === "files") {
    return { ...route, file: nextFile };
  }
  return route;
}

function routeParts(route: WorkbenchRoute): string[] {
  switch (route.kind) {
    case "skill":
      return route.view === "files" ? ["files"] : route.view === "manifest" ? ["manifest"] : [];
    case "versions":
      return route.view === "lineage" ? ["versions", "lineage"] : ["versions"];
    case "version":
      return route.view === "files"
        ? ["versions", route.versionId, "files"]
        : route.view === "runs"
          ? ["versions", route.versionId, "runs"]
          : ["versions", route.versionId];
    case "execution":
      return route.view === "runs" ? ["runs"] : [route.view];
    case "run":
      return route.view === "overview" ? ["runs", route.runId] : ["runs", route.runId, route.view];
    case "job":
      return route.view === "overview" ? ["jobs", route.jobId] : ["jobs", route.jobId, route.view];
    case "trace":
      return route.view === "overview" ? ["traces", route.traceId] : ["traces", route.traceId, route.view];
    case "artifact":
      return route.view === "overview" ? ["artifacts", route.artifactId] : ["artifacts", route.artifactId, route.view];
    case "configuration":
      return route.view === "agents" ? ["configuration", "agents"] : ["configuration"];
    case "skill-source":
      return ["skills", route.skillName];
    case "agent":
      return ["agents", route.agentName];
    case "sync":
      return route.view === "remotes" ? ["sync", "remotes"] : ["sync"];
  }
}

function routeQuery(route: WorkbenchRoute): URLSearchParams {
  const params = new URLSearchParams();
  if (route.kind === "skill" && route.view === "files") {
    appendFileRouteParams(params, route.file);
  } else {
    appendSkillSurfaceRouteParams(params, route);
  }
  if (route.kind === "version" && route.view === "files") {
    appendFileRouteParams(params, route.file);
  } else if (route.kind === "trace" && route.view === "files") {
    appendFileRouteParams(params, route.file);
  } else if (route.kind === "artifact" && route.view === "files") {
    appendFileRouteParams(params, route.file);
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

function appendSkillSurfaceRouteParams(params: URLSearchParams, route: WorkbenchRoute): void {
  if (route.kind === "skill") {
    return;
  }
  const skillView = route.skillView ?? "overview";
  if (skillView === "overview") {
    return;
  }
  params.set("skill", skillView);
  if (skillView === "files") {
    appendPrefixedFileRouteParams(params, "skill", normalizeFileRouteState(route.skillFile));
  }
}

function appendPrefixedFileRouteParams(
  params: URLSearchParams,
  prefix: string,
  file: WorkbenchFileRouteState,
): void {
  if (file.filePath) {
    params.set(`${prefix}File`, file.filePath);
  }
  if (file.directoryPath) {
    params.set(`${prefix}Dir`, file.directoryPath);
  }
  if (file.previewMode !== "rendered") {
    params.set(`${prefix}Preview`, file.previewMode);
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

function parseSkillSurfaceRouteState(searchParams: URLSearchParams): WorkbenchSkillSurfaceRouteState {
  const rawView = searchParams.get("skill");
  if (!rawView) {
    return {};
  }
  const skillView = rawView === "manifest" ? "manifest" : rawView === "files" ? "files" : "overview";
  return {
    skillView,
    skillFile: skillView === "files" ? parsePrefixedFileRouteState(searchParams, "skill") : undefined,
  };
}

function parsePrefixedFileRouteState(
  searchParams: URLSearchParams,
  prefix: string,
): WorkbenchFileRouteState {
  const previewMode = searchParams.get(`${prefix}Preview`);
  return {
    filePath: normalizeRouteSelection(searchParams.get(`${prefix}File`)),
    directoryPath: normalizeRouteSelection(searchParams.get(`${prefix}Dir`)),
    previewMode: isSnapshotPreviewMode(previewMode) ? previewMode : "rendered",
  };
}

function normalizeFileRouteState(file: Partial<WorkbenchFileRouteState> | undefined): WorkbenchFileRouteState {
  return {
    filePath: file?.filePath ?? null,
    directoryPath: file?.directoryPath ?? null,
    previewMode: file?.previewMode ?? "rendered",
  };
}

function emptyFileRouteState(): WorkbenchFileRouteState {
  return { filePath: null, directoryPath: null, previewMode: "rendered" };
}

function fileWithLegacyPath(file: WorkbenchFileRouteState, rest: readonly string[]): WorkbenchFileRouteState {
  if (file.filePath || rest.length === 0) {
    return file;
  }
  return { ...file, filePath: rest.join("/") };
}

function executionViewFromSegment(segment: string | undefined): ExecutionIndexView {
  if (segment === "jobs" || segment === "traces" || segment === "artifacts") {
    return segment;
  }
  return "runs";
}

function runViewFromSegment(segment: string | undefined): RunView {
  if (segment === "jobs" || segment === "traces" || segment === "artifacts") {
    return segment;
  }
  return "overview";
}

function jobViewFromSegment(segment: string | undefined): JobView {
  if (segment === "trace" || segment === "artifacts") {
    return segment;
  }
  return "overview";
}

function traceViewFromSegment(segment: string | undefined): TraceView {
  if (segment === "files" || segment === "payload") {
    return segment;
  }
  return "overview";
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
