"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  ActivityIcon,
  ArchiveIcon,
  BotIcon,
  BoxIcon,
  BracesIcon,
  ChartColumnIcon,
  CircleAlertIcon,
  FileCode2Icon,
  FolderOpenIcon,
  GitBranchIcon,
  HashIcon,
  HistoryIcon,
  ListChecksIcon,
  NetworkIcon,
  PanelRightCloseIcon,
  RefreshCwIcon,
  RouteIcon,
  Settings2Icon,
  SparklesIcon,
  WorkflowIcon,
} from "lucide-react";

import {
  workbenchInspectionFileContent,
  workbenchInspectionFileContentUnavailableReason,
} from "@workbench-ai/workbench-contract";
import type {
  SurfaceSnapshotFile,
  WorkbenchAgent,
  WorkbenchArtifact,
  WorkbenchInspectionFileContent,
  WorkbenchInspectionSnapshot,
  WorkbenchJob,
  WorkbenchRun,
  WorkbenchSkillSource,
  WorkbenchTrace,
  WorkbenchVersion,
} from "@workbench-ai/workbench-contract";
import { DesktopWorkspaceSplit } from "@workbench-ai/cli-web-ui/components/shared/desktop-workspace-split";
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
import { FilesBrowser } from "@workbench-ai/cli-web-ui/components/shared/files-browser";
import { ProblemState } from "@workbench-ai/cli-web-ui/components/shared/problem-state";
import { ViewSwitch } from "@workbench-ai/cli-web-ui/components/shared/view-switch";
import { WorkbenchBrand } from "@workbench-ai/cli-web-ui/components/shared/workbench-brand";
import { WorkspacePane } from "@workbench-ai/cli-web-ui/components/shared/workspace-pane";
import { WorkspaceRoot } from "@workbench-ai/cli-web-ui/components/shared/workspace-root";
import { WorkspaceTopBar } from "@workbench-ai/cli-web-ui/components/shared/workspace-top-bar";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workbench-ai/cli-web-ui/components/ui/accordion";
import { Badge } from "@workbench-ai/cli-web-ui/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workbench-ai/cli-web-ui/components/ui/table";
import { supportedPreviewModes, type PreviewMode } from "@workbench-ai/cli-web-ui/lib/file-preview";
import { useMediaQuery } from "@workbench-ai/cli-web-ui/lib/use-media-query";
import { cn } from "@workbench-ai/cli-web-ui/lib/utils";

import { StatusBadge } from "./components/status-badge";
import { SurfaceSection } from "./components/surface-section";
import { LineageGraph } from "./components/lineage-graph";
import {
  agentConfigString,
  agentNetworkLabel,
  agentTimeoutLabel,
  directoryPathForFile,
  fileName,
  formatCost,
  formatCount,
  formatDurationMs,
  formatList,
  formatScore,
  formatTimestamp,
  jobDisplayLabel,
  jsonPreview,
  runDisplayLabel,
  shortId,
} from "./lib/format";
import {
  preferredFilePath,
  surfaceFilesToChanges,
  surfaceFileToPreview,
} from "./lib/files";
import {
  buildWorkbenchLocationHref,
  createSkillRoute,
  parseWorkbenchLocation,
  routeHasDetail,
  routeSkillSurfaceFile,
  routeSkillSurfaceView,
  withSkillSurface,
  type ArtifactView,
  type ConfigurationView,
  type ExecutionIndexView,
  type JobView,
  type RunView,
  type SkillSurfaceView,
  type SyncView,
  type TraceView,
  type VersionView,
  type VersionsIndexView,
  type WorkbenchFileOwnerKind,
  type WorkbenchFileRouteState,
  type WorkbenchRoute,
} from "./lib/routes";

export interface WorkbenchWorkspaceProps {
  apiBasePath?: string;
  routeBasePath?: string;
  brandHref?: string;
  initialData?: WorkbenchInspectionSnapshot | null;
  initialRoute?: WorkbenchRoute;
}

const DESKTOP_PRIMARY_DEFAULT_PERCENT = 54;
const DESKTOP_PRIMARY_MIN_PERCENT = 38;
const DESKTOP_PRIMARY_MAX_PERCENT = 68;
const COMPACT_WORKSPACE_QUERY = "(max-width: 1023px)";
const STACKED_FILES_QUERY = "(max-width: 900px)";

const SKILL_SURFACE_ITEMS: Array<{
  value: SkillSurfaceView;
  label: string;
  icon: typeof WorkflowIcon;
}> = [
  { value: "overview", label: "Overview", icon: WorkflowIcon },
  { value: "manifest", label: "Manifest", icon: FileCode2Icon },
  { value: "files", label: "Files", icon: FolderOpenIcon },
];

export function WorkbenchWorkspace({
  apiBasePath = "/api",
  routeBasePath = "/",
  brandHref = "/",
  initialData = null,
  initialRoute,
}: WorkbenchWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<WorkbenchInspectionSnapshot | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [route, setRoute] = useState<WorkbenchRoute>(() =>
    initialRoute ?? parseWorkbenchLocation(undefined, routeBasePath));
  const [primaryPercent, setPrimaryPercent] = useState(DESKTOP_PRIMARY_DEFAULT_PERCENT);
  const compact = useMediaQuery(COMPACT_WORKSPACE_QUERY);
  const hasDetail = routeHasDetail(route);
  const activeSkillView = routeSkillSurfaceView(route);
  const primarySurfaceFillsBody = activeSkillView === "files";

  useEffect(() => {
    if (initialData && refreshKey === 0) {
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    const hasExistingSnapshot = snapshot !== null;
    setLoading(!hasExistingSnapshot);
    setRefreshing(hasExistingSnapshot);
    setError(null);

    async function loadSnapshot() {
      try {
        const response = await fetch(`${apiBasePath}/snapshot`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const next = await response.json() as WorkbenchInspectionSnapshot;
        if (!cancelled) {
          setSnapshot(next);
          setError(null);
        }
      } catch (nextError) {
        if (!cancelled && !controller.signal.aborted) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void loadSnapshot();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBasePath, initialData, refreshKey]);

  useEffect(() => {
    const updateRoute = () => setRoute(parseWorkbenchLocation(undefined, routeBasePath));
    updateRoute();
    window.addEventListener("popstate", updateRoute);
    return () => window.removeEventListener("popstate", updateRoute);
  }, [routeBasePath]);

  const hrefFor = useCallback(
    (nextRoute: WorkbenchRoute) => buildWorkbenchLocationHref(nextRoute, routeBasePath),
    [routeBasePath],
  );
  const navigate = useCallback((nextRoute: WorkbenchRoute, options: { replace?: boolean } = {}) => {
    const href = hrefFor(nextRoute);
    const current = `${window.location.pathname}${window.location.search}`;
    if (href !== current) {
      window.history[options.replace ? "replaceState" : "pushState"]({}, "", href);
    }
    setRoute(nextRoute);
  }, [hrefFor]);
  const onRouteClick = useCallback((nextRoute: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(nextRoute);
  }, [navigate]);

  const header = (
    <div className="flex min-w-0 flex-col">
      <div className="px-4 py-3 sm:px-5">
        <WorkspaceTopBar
          brand={(
            <a
              className="min-w-0 rounded-sm text-foreground no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={brandHref}
            >
              <WorkbenchBrand product="Skills" />
            </a>
          )}
          actions={(
            <>
              {snapshot?.status.currentVersionId ? (
                <Badge variant="outline">current {snapshot.status.currentVersionId}</Badge>
              ) : null}
              {snapshot?.status.hasUnversionedChanges ? (
                <StatusBadge status="unversioned" />
              ) : snapshot ? (
                <StatusBadge status="versioned" />
              ) : null}
              <Button
                aria-label="Refresh Workbench snapshot"
                disabled={loading || refreshing}
                size="icon-sm"
                type="button"
                variant="ghost"
                onClick={() => setRefreshKey((current) => current + 1)}
              >
                <RefreshCwIcon aria-hidden="true" className={cn(refreshing && "animate-spin")} />
              </Button>
            </>
          )}
        />
      </div>
      <div className="border-t border-border/60 bg-muted/30 px-4 py-2 sm:px-5">
        <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <WorkbenchBreadcrumbs route={route} hrefFor={hrefFor} onRouteClick={onRouteClick} />
          <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 md:justify-end">
            {snapshot ? <WorkbenchActivitySummary snapshot={snapshot} loading={loading} refreshing={refreshing} error={error} /> : null}
            <WorkbenchObjectNavigation route={route} hrefFor={hrefFor} onRouteClick={onRouteClick} />
          </div>
        </div>
      </div>
    </div>
  );

  if (error && !snapshot) {
    return (
      <WorkspaceRoot header={header} headerClassName="px-0 py-0 sm:px-0" mainId="main-content" skipLinkLabel="Skip to Workbench workspace">
        <ProblemState
          icon={CircleAlertIcon}
          title="Workbench snapshot is unavailable"
          message={error}
          scope="workspace"
        />
      </WorkspaceRoot>
    );
  }

  if (!snapshot) {
    return (
      <WorkspaceRoot header={header} headerClassName="px-0 py-0 sm:px-0" mainId="main-content" skipLinkLabel="Skip to Workbench workspace">
        <ProblemState
          icon={RefreshCwIcon}
          title="Loading Workbench"
          message="Reading the skill inspection snapshot."
          scope="workspace"
        />
      </WorkspaceRoot>
    );
  }

  const primaryPane = (
      <WorkspacePane
      tone="secondary"
      hideHeader
      scrollBody={!primarySurfaceFillsBody}
      contentClassName={primarySurfaceFillsBody ? "flex h-full min-h-0 flex-col" : undefined}
    >
      <SkillSurface
        apiBasePath={apiBasePath}
        activeView={activeSkillView}
        navigate={navigate}
        route={route}
        snapshot={snapshot}
      />
    </WorkspacePane>
  );

  const objectPane = (
    <WorkspacePane
      title={objectPaneTitle(route)}
      badges={<ObjectPaneBadges route={route} snapshot={snapshot} />}
      actions={hasDetail && !compact ? (
        <Button
          aria-label="Close object pane"
          size="icon-sm"
          type="button"
          variant="ghost"
          onClick={() => navigate(skillRouteFromRoute(route))}
        >
          <PanelRightCloseIcon aria-hidden="true" />
        </Button>
      ) : null}
      scrollBody={!objectSurfaceFillsBody(route)}
      contentClassName={objectSurfaceFillsBody(route) ? "flex h-full min-h-0 flex-col" : undefined}
    >
      <ObjectPaneSurface
        apiBasePath={apiBasePath}
        hrefFor={hrefFor}
        navigate={navigate}
        onRouteClick={onRouteClick}
        route={route}
        snapshot={snapshot}
      />
    </WorkspacePane>
  );

  return (
    <WorkspaceRoot
      header={header}
      headerClassName="px-0 py-0 sm:px-0"
      mainId="main-content"
      skipLinkLabel="Skip to Workbench workspace"
    >
      {compact ? (
        hasDetail ? objectPane : primaryPane
      ) : (
        <DesktopWorkspaceSplit
          paneOpen={hasDetail}
          primaryPercent={primaryPercent}
          minPrimaryPercent={DESKTOP_PRIMARY_MIN_PERCENT}
          maxPrimaryPercent={DESKTOP_PRIMARY_MAX_PERCENT}
          onPrimaryPercentChange={setPrimaryPercent}
          primaryPane={primaryPane}
          secondaryPane={objectPane}
          secondaryPaneId="workbench-object-pane"
          separatorLabel="Resize Workbench object pane"
        />
      )}
    </WorkspaceRoot>
  );
}

export function App(props: WorkbenchWorkspaceProps) {
  return <WorkbenchWorkspace {...props} />;
}

function SkillSurface({
  activeView,
  apiBasePath,
  navigate,
  route,
  snapshot,
}: {
  activeView: SkillSurfaceView;
  apiBasePath: string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  return (
    <div className={cn("min-w-0", activeView === "files" ? "flex h-full min-h-0 flex-col gap-5" : "grid gap-5")}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h2 className="break-words text-lg font-semibold text-foreground [overflow-wrap:anywhere]">
            Skill workspace
          </h2>
          <p className="max-w-3xl break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
            {snapshot.root}
          </p>
        </div>
      </div>

      <ViewSwitch
        ariaLabel="Skill views"
        value={activeView}
        items={SKILL_SURFACE_ITEMS}
        onValueChange={(value) => {
          if (value === "overview" || value === "manifest" || value === "files") {
            navigate(withSkillSurface(route, { skillView: value }));
          }
        }}
      />

      {activeView === "overview" ? (
        <SkillOverviewSurface snapshot={snapshot} />
      ) : activeView === "manifest" ? (
        <SkillManifestSurface snapshot={snapshot} />
      ) : activeView === "files" ? (
        <SkillFilesSurface apiBasePath={apiBasePath} route={route} snapshot={snapshot} navigate={navigate} />
      ) : (
        <SkillOverviewSurface snapshot={snapshot} />
      )}
    </div>
  );
}

function SkillOverviewSurface({
  snapshot,
}: {
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const evidence = summarizeEvidence(snapshot);
  return (
    <div className="grid min-w-0 gap-6">
      <SurfaceSection title="Skill" icon={WorkflowIcon}>
        <Accordion type="multiple" defaultValue={["snapshot", "evidence"]}>
          <DetailAccordionSection
            value="snapshot"
            title="Snapshot"
            summary={`${snapshot.status.currentVersionId ?? "no version"} / ${snapshot.status.defaultSkill ?? "primary"} / ${snapshot.status.defaultAgent ?? "default"}`}
          >
            <FactGrid>
              <FactItem title="Root" value={snapshot.root} />
              <FactItem title="Current version" value={snapshot.status.currentVersionId ?? "none"} />
              <FactItem title="Default skill" value={snapshot.status.defaultSkill ?? "primary"} />
              <FactItem title="Default agent" value={snapshot.status.defaultAgent ?? "default"} />
            </FactGrid>
          </DetailAccordionSection>
          <DetailAccordionSection
            value="evidence"
            title="Evidence"
            summary={`${evidence.readinessLabel} / ${evidence.bestConfiguration}`}
          >
            <FactGrid>
              <FactItem title="Best configuration" value={evidence.bestConfiguration} detail={evidence.bestConfigurationDetail} />
              <FactItem title="Automation readiness" value={evidence.readinessLabel} detail={evidence.readinessDetail} />
              <FactItem title="Latest improvement" value={evidence.latestImprovement} detail={evidence.latestImprovementDetail} />
              <FactItem title="Runtime posture" value={evidence.runtimePosture} detail={evidence.runtimePostureDetail} />
            </FactGrid>
          </DetailAccordionSection>
          <DetailAccordionSection
            value="inventory"
            title="Inventory"
            summary={`${formatCount(snapshot.versions.length, "version")} / ${formatCount(snapshot.runs.length, "run")} / ${formatCount(snapshot.artifacts.length, "artifact")}`}
          >
            <FactGrid>
              <FactItem title="Versions" value={formatCount(snapshot.versions.length, "version")} />
              <FactItem title="Runs" value={formatCount(snapshot.runs.length, "run")} />
              <FactItem title="Jobs" value={formatCount(snapshot.jobs.length, "job")} />
              <FactItem title="Traces" value={formatCount(snapshot.traces.length, "trace")} />
              <FactItem title="Artifacts" value={formatCount(snapshot.artifacts.length, "artifact")} />
              <FactItem title="Lineage" value={formatCount(snapshot.lineage.length, "edge")} />
            </FactGrid>
          </DetailAccordionSection>
        </Accordion>
      </SurfaceSection>
    </div>
  );
}

function SkillManifestSurface({ snapshot }: { snapshot: WorkbenchInspectionSnapshot }) {
  return (
    <div className="grid min-w-0 gap-6">
      <SurfaceSection title="Manifest" icon={FileCode2Icon}>
        <Accordion type="multiple" defaultValue={["sources", "agents", "sync"]}>
          <DetailAccordionSection
            value="sources"
            title="Skill Sources"
            summary={`${formatCount(snapshot.skillSources.length, "source")} / ${formatCount(snapshot.skillBundles.length, "bundle")}`}
          >
            <SkillsManifestTable skills={snapshot.skillSources} />
          </DetailAccordionSection>
          <DetailAccordionSection
            value="agents"
            title="Agents"
            summary={`${formatCount(snapshot.agents.length, "agent")} / default ${snapshot.status.defaultAgent ?? "default"}`}
          >
            <AgentsManifestTable agents={snapshot.agents} />
          </DetailAccordionSection>
          <DetailAccordionSection
            value="sync"
            title="Refs and Remotes"
            summary={`${formatCount(Object.values(snapshot.refs).filter(Boolean).length, "ref")} / ${formatCount(snapshot.remotes.length, "remote")}`}
          >
            <FactGrid>
              <FactItem title="Current ref" value={snapshot.refs.current ?? "none"} />
              <FactItem title="Published version" value={snapshot.publication?.versionId ?? snapshot.refs.published ?? "none"} />
              {snapshot.publication ? (
                <>
                  <FactItem title="Install URL" value={snapshot.publication.installUrl} />
                  <FactItem title="Pinned install URL" value={snapshot.publication.pinnedInstallUrl} />
                </>
              ) : null}
              <FactItem title="Remotes" value={formatCount(snapshot.remotes.length, "remote")} />
              <FactItem title="Unversioned changes" value={snapshot.status.hasUnversionedChanges ? "yes" : "no"} />
            </FactGrid>
          </DetailAccordionSection>
        </Accordion>
      </SurfaceSection>
    </div>
  );
}

function SkillFilesSurface({
  apiBasePath,
  route,
  snapshot,
  navigate,
}: {
  apiBasePath: string;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
}) {
  const owner = currentVersion(snapshot);
  if (!owner) {
    return (
      <EmptyState
        icon={FolderOpenIcon}
        title="No current version"
        message="Create a source version before inspecting skill files."
        variant="hero"
        size="sm"
      />
    );
  }
  const file = routeSkillSurfaceFile(route);
  return (
    <FileBrowserSurface
      apiBasePath={apiBasePath}
      ownerKind="version"
      ownerId={owner.id}
      files={owner.files}
      title="Current Version Files"
      description={`Previewing files from ${owner.id}.`}
      file={file}
      onFileChange={(nextFile, options) => navigate(withSkillSurface(route, { skillView: "files", skillFile: nextFile }), options)}
    />
  );
}

function ObjectPaneSurface({
  apiBasePath,
  hrefFor,
  navigate,
  onRouteClick,
  route,
  snapshot,
}: {
  apiBasePath: string;
  hrefFor: (route: WorkbenchRoute) => string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const scopedHrefFor = (nextRoute: WorkbenchRoute) => hrefFor(preserveSkillSurface(route, nextRoute));
  const scopedNavigate = (nextRoute: WorkbenchRoute, options?: { replace?: boolean }) =>
    navigate(preserveSkillSurface(route, nextRoute), options);
  const scopedOnRouteClick = (nextRoute: WorkbenchRoute) =>
    onRouteClick(preserveSkillSurface(route, nextRoute));

  if (route.kind === "skill") {
    return (
      <EmptyState
        icon={PanelRightCloseIcon}
        title="Open a drilldown"
        message="Choose Versions, Execution, Configuration, or Sync to inspect nested objects."
        variant="hero"
        size="md"
      />
    );
  }
  if (route.kind === "versions") {
    return <VersionsObjectSurface route={route} snapshot={snapshot} hrefFor={scopedHrefFor} navigate={scopedNavigate} onRouteClick={scopedOnRouteClick} />;
  }
  if (route.kind === "version") {
    return <VersionObjectSurface apiBasePath={apiBasePath} route={route} snapshot={snapshot} hrefFor={scopedHrefFor} navigate={scopedNavigate} onRouteClick={scopedOnRouteClick} />;
  }
  if (route.kind === "execution") {
    return <ExecutionObjectSurface route={route} snapshot={snapshot} hrefFor={scopedHrefFor} navigate={scopedNavigate} onRouteClick={scopedOnRouteClick} />;
  }
  if (route.kind === "run") {
    return <RunObjectSurface route={route} snapshot={snapshot} hrefFor={scopedHrefFor} navigate={scopedNavigate} onRouteClick={scopedOnRouteClick} />;
  }
  if (route.kind === "job") {
    return <JobObjectSurface route={route} snapshot={snapshot} hrefFor={scopedHrefFor} navigate={scopedNavigate} onRouteClick={scopedOnRouteClick} />;
  }
  if (route.kind === "trace") {
    return <TraceObjectSurface apiBasePath={apiBasePath} route={route} snapshot={snapshot} navigate={scopedNavigate} />;
  }
  if (route.kind === "artifact") {
    return <ArtifactObjectSurface apiBasePath={apiBasePath} route={route} snapshot={snapshot} navigate={scopedNavigate} />;
  }
  if (route.kind === "configuration") {
    return <ConfigurationObjectSurface route={route} snapshot={snapshot} hrefFor={scopedHrefFor} navigate={scopedNavigate} onRouteClick={scopedOnRouteClick} />;
  }
  if (route.kind === "skill-source") {
    const skill = snapshot.skillSources.find((entry) => entry.name === route.skillName) ?? null;
    return skill ? <SkillDetail skill={skill} snapshot={snapshot} /> : <MissingObject label={`Skill ${route.skillName}`} />;
  }
  if (route.kind === "agent") {
    const agent = snapshot.agents.find((entry) => entry.name === route.agentName) ?? null;
    return agent ? <AgentDetail agent={agent} snapshot={snapshot} hrefFor={scopedHrefFor} onRouteClick={scopedOnRouteClick} /> : <MissingObject label={`Agent ${route.agentName}`} />;
  }
  return <SyncObjectSurface route={route} snapshot={snapshot} navigate={scopedNavigate} />;
}

function VersionsObjectSurface({
  hrefFor,
  navigate,
  onRouteClick,
  route,
  snapshot,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  navigate: (route: WorkbenchRoute) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
  route: Extract<WorkbenchRoute, { kind: "versions" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <ViewSwitch
        ariaLabel="Version index views"
        value={route.view}
        items={[
          { value: "archive", label: "Archive", icon: FolderOpenIcon },
          { value: "lineage", label: "Lineage", icon: GitBranchIcon },
        ]}
        onValueChange={(value) => navigate({ kind: "versions", view: value === "lineage" ? "lineage" : "archive" })}
      />
      {route.view === "lineage" ? (
        <VersionLineageSurface snapshot={snapshot} navigate={navigate} />
      ) : (
        <VersionList versions={snapshot.versions} snapshot={snapshot} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      )}
    </div>
  );
}

function VersionObjectSurface({
  apiBasePath,
  hrefFor,
  navigate,
  onRouteClick,
  route,
  snapshot,
}: {
  apiBasePath: string;
  hrefFor: (route: WorkbenchRoute) => string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
  route: Extract<WorkbenchRoute, { kind: "version" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const version = snapshot.versions.find((entry) => entry.id === route.versionId) ?? null;
  if (!version) {
    return <MissingObject label={`Version ${route.versionId}`} />;
  }
  return (
    <ObjectSubviewShell
      value={route.view}
      ariaLabel="Version views"
      items={[
        { value: "overview", label: "Overview", icon: HistoryIcon },
        { value: "files", label: "Files", icon: FolderOpenIcon },
        { value: "runs", label: "Runs", icon: ActivityIcon },
      ]}
      onValueChange={(view) => navigate({
        kind: "version",
        versionId: version.id,
        view: normalizeVersionView(view),
        file: route.view === "files" ? route.file : emptyFileRouteState(),
      })}
    >
      {route.view === "files" ? (
        <FileBrowserSurface
          apiBasePath={apiBasePath}
          ownerKind="version"
          ownerId={version.id}
          files={version.files}
          title="Version Files"
          description={`Previewing files from ${version.id}.`}
          file={route.file}
          onFileChange={(file, options) => navigate({ kind: "version", versionId: version.id, view: "files", file }, options)}
        />
      ) : route.view === "runs" ? (
        <LinkedRuns runs={snapshot.runs.filter((run) => run.versionId === version.id)} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      ) : (
        <VersionOverview version={version} snapshot={snapshot} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      )}
    </ObjectSubviewShell>
  );
}

function ExecutionObjectSurface({
  hrefFor,
  navigate,
  onRouteClick,
  route,
  snapshot,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  navigate: (route: WorkbenchRoute) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
  route: Extract<WorkbenchRoute, { kind: "execution" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  return (
    <ObjectSubviewShell
      value={route.view}
      ariaLabel="Execution views"
      items={executionSwitchItems()}
      onValueChange={(view) => navigate({ kind: "execution", view: normalizeExecutionView(view) })}
    >
      <ExecutionIndexContent
        view={route.view}
        snapshot={snapshot}
        hrefFor={hrefFor}
        onRouteClick={onRouteClick}
      />
    </ObjectSubviewShell>
  );
}

function RunObjectSurface({
  hrefFor,
  navigate,
  onRouteClick,
  route,
  snapshot,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  navigate: (route: WorkbenchRoute) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
  route: Extract<WorkbenchRoute, { kind: "run" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const run = snapshot.runs.find((entry) => entry.id === route.runId) ?? null;
  if (!run) {
    return <MissingObject label={`Run ${route.runId}`} />;
  }
  const jobs = snapshot.jobs.filter((job) => job.runId === run.id);
  const traces = snapshot.traces.filter((trace) => trace.runId === run.id);
  const artifacts = snapshot.artifacts.filter((artifact) => artifact.runId === run.id);
  return (
    <ObjectSubviewShell
      value={route.view}
      ariaLabel="Run views"
      items={[
        { value: "overview", label: "Overview", icon: ActivityIcon },
        { value: "jobs", label: "Jobs", icon: ListChecksIcon },
        { value: "traces", label: "Traces", icon: RouteIcon },
        { value: "artifacts", label: "Artifacts", icon: ArchiveIcon },
      ]}
      onValueChange={(view) => navigate({ kind: "run", runId: run.id, view: normalizeRunView(view) })}
    >
      {route.view === "jobs" ? (
        <JobsTable jobs={jobs} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      ) : route.view === "traces" ? (
        <TracesTable traces={traces} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      ) : route.view === "artifacts" ? (
        <ArtifactsTable artifacts={artifacts} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      ) : (
        <RunOverview run={run} jobs={jobs} traces={traces} artifacts={artifacts} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      )}
    </ObjectSubviewShell>
  );
}

function JobObjectSurface({
  hrefFor,
  navigate,
  onRouteClick,
  route,
  snapshot,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  navigate: (route: WorkbenchRoute) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
  route: Extract<WorkbenchRoute, { kind: "job" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const job = snapshot.jobs.find((entry) => entry.id === route.jobId) ?? null;
  if (!job) {
    return <MissingObject label={`Job ${route.jobId}`} />;
  }
  const traces = snapshot.traces.filter((trace) => job.traceIds.includes(trace.id) || trace.jobId === job.id);
  const artifacts = snapshot.artifacts.filter((artifact) => job.artifactIds.includes(artifact.id));
  return (
    <ObjectSubviewShell
      value={route.view}
      ariaLabel="Job views"
      items={[
        { value: "overview", label: "Overview", icon: ListChecksIcon },
        { value: "trace", label: "Trace", icon: RouteIcon },
        { value: "artifacts", label: "Artifacts", icon: ArchiveIcon },
      ]}
      onValueChange={(view) => navigate({ kind: "job", jobId: job.id, view: normalizeJobView(view) })}
    >
      {route.view === "trace" ? (
        <TracesTable traces={traces} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      ) : route.view === "artifacts" ? (
        <ArtifactsTable artifacts={artifacts} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      ) : (
        <JobOverview job={job} traces={traces} artifacts={artifacts} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      )}
    </ObjectSubviewShell>
  );
}

function TraceObjectSurface({
  apiBasePath,
  navigate,
  route,
  snapshot,
}: {
  apiBasePath: string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  route: Extract<WorkbenchRoute, { kind: "trace" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const trace = snapshot.traces.find((entry) => entry.id === route.traceId) ?? null;
  if (!trace) {
    return <MissingObject label={`Trace ${route.traceId}`} />;
  }
  return (
    <ObjectSubviewShell
      value={route.view}
      ariaLabel="Trace views"
      items={[
        { value: "overview", label: "Overview", icon: RouteIcon },
        { value: "files", label: "Files", icon: FolderOpenIcon },
        { value: "payload", label: "Payload", icon: BracesIcon },
      ]}
      onValueChange={(view) => navigate({
        kind: "trace",
        traceId: trace.id,
        view: normalizeTraceView(view),
        file: route.view === "files" ? route.file : emptyFileRouteState(),
      })}
    >
      {route.view === "files" ? (
        <FileBrowserSurface
          apiBasePath={apiBasePath}
          ownerKind="trace"
          ownerId={trace.id}
          files={trace.files}
          title="Trace Files"
          description={`Previewing files captured by ${trace.id}.`}
          file={route.file}
          onFileChange={(file, options) => navigate({ kind: "trace", traceId: trace.id, view: "files", file }, options)}
        />
      ) : route.view === "payload" ? (
        <TracePayload trace={trace} />
      ) : (
        <TraceOverview trace={trace} snapshot={snapshot} />
      )}
    </ObjectSubviewShell>
  );
}

function ArtifactObjectSurface({
  apiBasePath,
  navigate,
  route,
  snapshot,
}: {
  apiBasePath: string;
  navigate: (route: WorkbenchRoute, options?: { replace?: boolean }) => void;
  route: Extract<WorkbenchRoute, { kind: "artifact" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const artifact = snapshot.artifacts.find((entry) => entry.id === route.artifactId) ?? null;
  if (!artifact) {
    return <MissingObject label={`Artifact ${route.artifactId}`} />;
  }
  return (
    <ObjectSubviewShell
      value={route.view}
      ariaLabel="Artifact views"
      items={[
        { value: "overview", label: "Overview", icon: ArchiveIcon },
        { value: "files", label: "Files", icon: FolderOpenIcon },
      ]}
      onValueChange={(view) => navigate({
        kind: "artifact",
        artifactId: artifact.id,
        view: view === "files" ? "files" : "overview",
        file: route.view === "files" ? route.file : emptyFileRouteState(),
      })}
    >
      {route.view === "files" ? (
        <FileBrowserSurface
          apiBasePath={apiBasePath}
          ownerKind="artifact"
          ownerId={artifact.id}
          files={artifact.files}
          title="Artifact Files"
          description={`Previewing files captured by ${artifact.id}.`}
          file={route.file}
          onFileChange={(file, options) => navigate({ kind: "artifact", artifactId: artifact.id, view: "files", file }, options)}
        />
      ) : (
        <ArtifactOverview artifact={artifact} />
      )}
    </ObjectSubviewShell>
  );
}

function ConfigurationObjectSurface({
  hrefFor,
  navigate,
  onRouteClick,
  route,
  snapshot,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  navigate: (route: WorkbenchRoute) => void;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
  route: Extract<WorkbenchRoute, { kind: "configuration" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  return (
    <ObjectSubviewShell
      value={route.view}
      ariaLabel="Configuration views"
      items={[
        { value: "skills", label: "Skills", icon: SparklesIcon },
        { value: "agents", label: "Agents", icon: BotIcon },
      ]}
      onValueChange={(view) => navigate({ kind: "configuration", view: view === "agents" ? "agents" : "skills" })}
    >
      {route.view === "agents" ? (
        <AgentsList agents={snapshot.agents} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      ) : (
        <SkillsList skills={snapshot.skillSources} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      )}
    </ObjectSubviewShell>
  );
}

function SyncObjectSurface({
  navigate,
  route,
  snapshot,
}: {
  navigate: (route: WorkbenchRoute) => void;
  route: Extract<WorkbenchRoute, { kind: "sync" }>;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  return (
    <ObjectSubviewShell
      value={route.view}
      ariaLabel="Sync views"
      items={[
        { value: "refs", label: "Refs", icon: HashIcon },
        { value: "remotes", label: "Remotes", icon: NetworkIcon },
      ]}
      onValueChange={(view) => navigate({ kind: "sync", view: view === "remotes" ? "remotes" : "refs" })}
    >
      {route.view === "remotes" ? <RemotesIndex snapshot={snapshot} /> : <RefsIndex snapshot={snapshot} />}
    </ObjectSubviewShell>
  );
}

function ObjectSubviewShell({
  ariaLabel,
  children,
  items,
  onValueChange,
  value,
}: {
  ariaLabel: string;
  children: ReactNode;
  items: Array<{ value: string; label: string; icon: typeof WorkflowIcon }>;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <ViewSwitch ariaLabel={ariaLabel} value={value} items={items} onValueChange={onValueChange} />
      <div className="min-h-0 min-w-0 flex-1">
        {children}
      </div>
    </div>
  );
}

function VersionOverview({
  version,
  snapshot,
  hrefFor,
  onRouteClick,
}: {
  version: WorkbenchVersion;
  snapshot: WorkbenchInspectionSnapshot;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const runs = snapshot.runs.filter((run) => run.versionId === version.id);
  return (
    <div className="grid min-w-0 gap-6">
      <FactGrid>
        <FactItem title="Message" value={version.message} />
        <FactItem title="Hash" value={version.hash} />
        <FactItem title="Created" value={formatTimestamp(version.createdAt)} />
        <FactItem title="Parents" value={formatList(version.parentIds)} />
        <FactItem title="Files" value={formatCount(version.files.length, "file")} />
        <FactItem title="Runs" value={formatCount(runs.length, "run")} />
      </FactGrid>
      <LinkedRuns runs={runs} hrefFor={hrefFor} onRouteClick={onRouteClick} />
    </div>
  );
}

function RunOverview({
  artifacts,
  hrefFor,
  jobs,
  onRouteClick,
  run,
  traces,
}: {
  artifacts: WorkbenchArtifact[];
  hrefFor: (route: WorkbenchRoute) => string;
  jobs: WorkbenchJob[];
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
  run: WorkbenchRun;
  traces: WorkbenchTrace[];
}) {
  return (
    <div className="grid min-w-0 gap-6">
      <FactGrid>
        <FactItem title="Kind" value={run.kind} />
        <FactItem title="Status" value={run.status} />
        <FactItem title="Version" value={run.versionId} />
        <FactItem title="Output version" value={run.outputVersionId ?? "n/a"} />
        <FactItem title="Skill" value={run.skillName} />
        <FactItem title="Agent" value={run.agentName} />
        <FactItem title="Score" value={formatScore(run.score)} />
        <FactItem title="Latency" value={formatDurationMs(run.latencyMs)} />
        <FactItem title="Cost" value={formatCost(run.costUsd)} />
        <FactItem title="Created" value={formatTimestamp(run.createdAt)} />
        <FactItem title="Finished" value={formatTimestamp(run.finishedAt)} />
        <FactItem title="Parent run" value={run.parentRunId ?? "n/a"} />
      </FactGrid>
      {run.error ? <ProblemState icon={CircleAlertIcon} title="Run error" message={run.error} align="start" /> : null}
      <JobsTable jobs={jobs} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      <TracesTable traces={traces} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      <ArtifactsTable artifacts={artifacts} hrefFor={hrefFor} onRouteClick={onRouteClick} />
    </div>
  );
}

function JobOverview({
  artifacts,
  hrefFor,
  job,
  onRouteClick,
  traces,
}: {
  artifacts: WorkbenchArtifact[];
  hrefFor: (route: WorkbenchRoute) => string;
  job: WorkbenchJob;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
  traces: WorkbenchTrace[];
}) {
  return (
    <div className="grid min-w-0 gap-6">
      <FactGrid>
        <FactItem title="Run" value={job.runId} />
        <FactItem title="Kind" value={job.kind} />
        <FactItem title="Status" value={job.status} />
        <FactItem title="Version" value={job.versionId} />
        <FactItem title="Skill" value={job.skillName} />
        <FactItem title="Agent" value={job.agentName} />
        <FactItem title="Case" value={job.caseId} />
        <FactItem title="Sample" value={String(job.sample)} />
        <FactItem title="Score" value={formatScore(job.score)} />
        <FactItem title="Duration" value={formatDurationMs(job.durationMs)} />
        <FactItem title="Image" value={job.dockerImage ?? "n/a"} />
        <FactItem title="Exit code" value={job.exitCode === undefined ? "n/a" : String(job.exitCode)} />
      </FactGrid>
      {job.command ? <SourceBlock title="Command" value={job.command} language="shell" /> : null}
      {job.error ? <ProblemState icon={CircleAlertIcon} title="Job error" message={job.error} align="start" /> : null}
      <TracesTable traces={traces} hrefFor={hrefFor} onRouteClick={onRouteClick} />
      <ArtifactsTable artifacts={artifacts} hrefFor={hrefFor} onRouteClick={onRouteClick} />
    </div>
  );
}

function TraceOverview({
  trace,
  snapshot,
}: {
  trace: WorkbenchTrace;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const run = snapshot.runs.find((entry) => entry.id === trace.runId) ?? null;
  return (
    <div className="grid min-w-0 gap-6">
      <FactGrid>
        <FactItem title="Run" value={trace.runId} />
        <FactItem title="Job" value={trace.jobId ?? "n/a"} />
        <FactItem title="Version" value={trace.versionId} />
        <FactItem title="Skill" value={trace.skillName} />
        <FactItem title="Agent" value={trace.agentName} />
        <FactItem title="Files" value={formatCount(trace.files.length, "file")} />
        <FactItem title="Created" value={formatTimestamp(trace.createdAt)} />
      </FactGrid>
      {run ? (
        <SurfaceSection title="Run Context" icon={ActivityIcon}>
          <p className="text-sm text-muted-foreground">{runDisplayLabel(run)}</p>
        </SurfaceSection>
      ) : null}
    </div>
  );
}

function TracePayload({ trace }: { trace: WorkbenchTrace }) {
  return (
    <div className="grid min-w-0 gap-6">
      <SourceBlock title="Request" value={jsonPreview(trace.request)} language="json" />
      <SourceBlock title="Result" value={jsonPreview(trace.result)} language="json" />
    </div>
  );
}

function ArtifactOverview({ artifact }: { artifact: WorkbenchArtifact }) {
  return (
    <div className="grid min-w-0 gap-6">
      <FactGrid>
        <FactItem title="Run" value={artifact.runId} />
        <FactItem title="Job" value={artifact.jobId} />
        <FactItem title="Kind" value={artifact.kind} />
        <FactItem title="Path" value={artifact.path} />
        <FactItem title="Files" value={formatCount(artifact.files.length, "file")} />
        <FactItem title="Created" value={formatTimestamp(artifact.createdAt)} />
      </FactGrid>
    </div>
  );
}

function FileBrowserSurface({
  apiBasePath,
  description,
  file,
  files,
  onFileChange,
  ownerId,
  ownerKind,
  title,
}: {
  apiBasePath: string;
  description: string;
  file: WorkbenchFileRouteState;
  files: readonly SurfaceSnapshotFile[];
  onFileChange: (file: WorkbenchFileRouteState, options?: { replace?: boolean }) => void;
  ownerId: string;
  ownerKind: WorkbenchFileOwnerKind;
  title: string;
}) {
  const prefersStackedFilesLayout = useMediaQuery(STACKED_FILES_QUERY);
  const selectedFilePath = files.some((entry) => entry.path === file.filePath)
    ? file.filePath
    : preferredFilePath(files);
  const directoryPath = file.directoryPath ?? directoryPathForFile(selectedFilePath);
  const previewMode = file.previewMode;
  const previewState = useInspectionFilePreview({
    apiBasePath,
    ownerKind,
    ownerId,
    path: selectedFilePath,
    previewMode,
    files,
  });

  useEffect(() => {
    if (selectedFilePath && selectedFilePath !== file.filePath) {
      onFileChange({
        filePath: selectedFilePath,
        directoryPath: directoryPathForFile(selectedFilePath),
        previewMode,
      }, { replace: true });
    }
  }, [file.filePath, onFileChange, previewMode, selectedFilePath]);

  return (
    <SurfaceSection
      title={title}
      icon={FolderOpenIcon}
      description={selectedFilePath ? `Previewing ${selectedFilePath}. ${description}` : description}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <FilesBrowser
          changes={surfaceFilesToChanges(files)}
          selectedFilePath={selectedFilePath}
          browseMode="folders"
          currentDirectory={directoryPath}
          previewMode={previewMode}
          availablePreviewModes={supportedPreviewModes()}
          preview={previewState.preview}
          changesError={null}
          previewError={previewState.error}
          isPreviewLoading={previewState.loading}
          layout={prefersStackedFilesLayout ? "stacked" : "split"}
          emptyMessage="No files are available for this object."
          emptySelectionMessage="Select a file to preview."
          listErrorMessage="Couldn't load the file list."
          previewErrorMessage="Couldn't load the file preview."
          onSelectFile={(filePath) => {
            onFileChange({
              filePath,
              directoryPath: directoryPathForFile(filePath),
              previewMode,
            });
          }}
          onDirectoryChange={(nextDirectoryPath) => {
            onFileChange({
              filePath: selectedFilePath,
              directoryPath: nextDirectoryPath,
              previewMode,
            });
          }}
          onPreviewModeChange={(nextPreviewMode) => {
            onFileChange({
              filePath: selectedFilePath,
              directoryPath,
              previewMode: nextPreviewMode,
            });
          }}
        />
      </div>
    </SurfaceSection>
  );
}

function VersionList({
  versions,
  snapshot,
  hrefFor,
  onRouteClick,
}: {
  versions: WorkbenchVersion[];
  snapshot: WorkbenchInspectionSnapshot;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  if (versions.length === 0) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title="No versions"
        message="Versions appear after Workbench observes skill source."
        variant="hero"
        size="sm"
      />
    );
  }
  const childrenByParent = new Map<string, WorkbenchVersion[]>();
  for (const version of versions) {
    for (const parentId of version.parentIds) {
      const children = childrenByParent.get(parentId) ?? [];
      children.push(version);
      childrenByParent.set(parentId, children);
    }
  }
  return (
    <div className="grid min-w-0 gap-3">
      {versions.map((version) => {
        const runs = snapshot.runs.filter((run) => run.versionId === version.id);
        const children = childrenByParent.get(version.id) ?? [];
        const active = snapshot.status.currentVersionId === version.id;
        return (
          <a
            aria-current={active ? "page" : undefined}
            className={cn(
              "grid min-w-0 gap-2 rounded-lg border px-3 py-3 text-sm no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary/45 bg-primary/5 text-foreground"
                : "border-border/70 bg-background text-foreground hover:bg-muted/45",
            )}
            href={hrefFor({ kind: "version", versionId: version.id, view: "overview", file: emptyFileRouteState() })}
            key={version.id}
            onClick={onRouteClick({ kind: "version", versionId: version.id, view: "overview", file: emptyFileRouteState() })}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="grid min-w-0 gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="break-words font-semibold [overflow-wrap:anywhere]">{version.id}</span>
                  {active ? <Badge variant="outline">current</Badge> : null}
                </div>
                <span className="break-words text-muted-foreground [overflow-wrap:anywhere]">{version.message}</span>
              </div>
              <HistoryIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            </div>
            <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{shortId(version.hash)}</span>
              <span>{formatTimestamp(version.createdAt)}</span>
              <span>{formatCount(version.parentIds.length, "parent")}</span>
              <span>{formatCount(children.length, "child")}</span>
              <span>{formatCount(runs.length, "run")}</span>
            </div>
          </a>
        );
      })}
    </div>
  );
}

function VersionLineageSurface({
  navigate,
  snapshot,
}: {
  navigate: (route: WorkbenchRoute) => void;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  if (snapshot.lineage.length === 0) {
    return (
      <EmptyState
        icon={GitBranchIcon}
        title="No lineage"
        message="Version parent-child edges appear after source changes, improves, switches, or publishes."
        variant="hero"
        size="sm"
      />
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col p-1">
      <LineageGraph
        currentVersionId={snapshot.status.currentVersionId}
        lineage={snapshot.lineage}
        versions={snapshot.versions}
        onVersionClick={(versionId) => navigate({ kind: "version", versionId, view: "overview", file: emptyFileRouteState() })}
      />
    </div>
  );
}

function ExecutionIndexContent({
  view,
  snapshot,
  hrefFor,
  onRouteClick,
}: {
  view: ExecutionIndexView;
  snapshot: WorkbenchInspectionSnapshot;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  if (view === "jobs") {
    return <JobsTable jobs={snapshot.jobs} hrefFor={hrefFor} onRouteClick={onRouteClick} />;
  }
  if (view === "traces") {
    return <TracesTable traces={snapshot.traces} hrefFor={hrefFor} onRouteClick={onRouteClick} />;
  }
  if (view === "artifacts") {
    return <ArtifactsTable artifacts={snapshot.artifacts} hrefFor={hrefFor} onRouteClick={onRouteClick} />;
  }
  return <GroupedRunsTable runs={snapshot.runs} hrefFor={hrefFor} onRouteClick={onRouteClick} />;
}

function GroupedRunsTable({
  runs,
  hrefFor,
  onRouteClick,
}: {
  runs: WorkbenchRun[];
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  if (runs.length === 0) {
    return (
      <EmptyState
        icon={ActivityIcon}
        title="No runs"
        message="Run eval, improve, compare, or retry to record execution evidence."
        variant="hero"
        size="sm"
      />
    );
  }
  const groups = groupBy(runs, (run) => `${run.versionId} / ${run.skillName} / ${run.agentName}`);
  return (
    <SurfaceSection title="Runs" icon={ActivityIcon}>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[12rem]">Run</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Jobs</TableHead>
              <TableHead>Traces</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...groups.entries()].map(([group, groupRuns]) => (
              <Fragment key={group}>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="bg-muted/35 py-2 font-medium text-foreground">
                    {group} <span className="ml-2 text-xs font-normal text-muted-foreground">{formatCount(groupRuns.length, "run")}</span>
                  </TableCell>
                </TableRow>
                {groupRuns.map((run) => {
                  const runRoute: WorkbenchRoute = { kind: "run", runId: run.id, view: "overview" };
                  return (
                    <TableRow key={run.id}>
                      <TableCell>
                        <a className="font-medium text-primary underline-offset-4 hover:underline" href={hrefFor(runRoute)} onClick={onRouteClick(runRoute)}>
                          {run.id}
                        </a>
                      </TableCell>
                      <TableCell>{run.kind}</TableCell>
                      <TableCell><StatusBadge status={run.status} /></TableCell>
                      <TableCell>{formatScore(run.score)}</TableCell>
                      <TableCell>{formatCount(run.jobIds?.length ?? 0, "job")}</TableCell>
                      <TableCell>{formatCount(run.traceIds.length, "trace")}</TableCell>
                      <TableCell>{formatTimestamp(run.createdAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </SurfaceSection>
  );
}

function JobsTable({
  jobs,
  hrefFor,
  onRouteClick,
}: {
  jobs: WorkbenchJob[];
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <LinkedObjectTable
      title="Jobs"
      icon={ListChecksIcon}
      rows={jobs.map((job) => ({
        id: job.id,
        route: { kind: "job", jobId: job.id, view: "overview" },
        cells: [job.runId, job.caseId, job.status, formatScore(job.score), formatDurationMs(job.durationMs)],
      }))}
      columns={["Run", "Case", "Status", "Score", "Duration"]}
      empty="No jobs are recorded."
      hrefFor={hrefFor}
      onRouteClick={onRouteClick}
    />
  );
}

function TracesTable({
  traces,
  hrefFor,
  onRouteClick,
}: {
  traces: WorkbenchTrace[];
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <LinkedObjectTable
      title="Traces"
      icon={RouteIcon}
      rows={traces.map((trace) => ({
        id: trace.id,
        route: { kind: "trace", traceId: trace.id, view: "overview", file: emptyFileRouteState() },
        cells: [trace.runId, trace.jobId ?? "n/a", trace.versionId, formatCount(trace.files.length, "file")],
      }))}
      columns={["Run", "Job", "Version", "Files"]}
      empty="No traces are recorded."
      hrefFor={hrefFor}
      onRouteClick={onRouteClick}
    />
  );
}

function ArtifactsTable({
  artifacts,
  hrefFor,
  onRouteClick,
}: {
  artifacts: WorkbenchArtifact[];
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <LinkedObjectTable
      title="Artifacts"
      icon={ArchiveIcon}
      rows={artifacts.map((artifact) => ({
        id: artifact.id,
        route: { kind: "artifact", artifactId: artifact.id, view: "overview", file: emptyFileRouteState() },
        cells: [artifact.runId, artifact.jobId, artifact.kind, artifact.path],
      }))}
      columns={["Run", "Job", "Kind", "Path"]}
      empty="No artifacts are recorded."
      hrefFor={hrefFor}
      onRouteClick={onRouteClick}
    />
  );
}

function SkillsList({
  skills,
  hrefFor,
  onRouteClick,
}: {
  skills: WorkbenchSkillSource[];
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  if (skills.length === 0) {
    return <EmptyState icon={SparklesIcon} title="No skill sources" message="No skill sources are configured." variant="hero" size="sm" />;
  }
  return (
    <div className="grid min-w-0 gap-2">
      {skills.map((skill) => {
        const route: WorkbenchRoute = { kind: "skill-source", skillName: skill.name };
        return (
          <a
            className="grid min-w-0 gap-1 rounded-lg border border-border/70 bg-background px-3 py-3 text-sm text-foreground no-underline transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={hrefFor(route)}
            key={skill.name}
            onClick={onRouteClick(route)}
          >
            <span className="font-medium">{skill.name}</span>
            <span className="break-words text-muted-foreground [overflow-wrap:anywhere]">{skillSourceLocation(skill)}</span>
            <span className="text-xs text-muted-foreground">{skill.kind} / {formatCount(skill.includes?.length ?? 0, "include")}</span>
          </a>
        );
      })}
    </div>
  );
}

function AgentsList({
  agents,
  hrefFor,
  onRouteClick,
}: {
  agents: WorkbenchAgent[];
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  if (agents.length === 0) {
    return <EmptyState icon={BotIcon} title="No agents" message="No agents are configured." variant="hero" size="sm" />;
  }
  return (
    <div className="grid min-w-0 gap-2">
      {agents.map((agent) => {
        const route: WorkbenchRoute = { kind: "agent", agentName: agent.name };
        return (
          <a
            className="grid min-w-0 gap-1 rounded-lg border border-border/70 bg-background px-3 py-3 text-sm text-foreground no-underline transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={hrefFor(route)}
            key={agent.name}
            onClick={onRouteClick(route)}
          >
            <span className="font-medium">{agent.name}</span>
            <span className="break-words text-muted-foreground [overflow-wrap:anywhere]">{agent.adapter}{agent.model ? ` / ${agent.model}` : ""}</span>
            <span className="text-xs text-muted-foreground">{agentNetworkLabel(agent)} / {agentTimeoutLabel(agent)}</span>
          </a>
        );
      })}
    </div>
  );
}

function SkillDetail({
  skill,
  snapshot,
}: {
  skill: WorkbenchSkillSource;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  const bundles = snapshot.skillBundles.filter((bundle) => bundle.skillName === skill.name || bundle.entryName === skill.name);
  return (
    <div className="grid min-w-0 gap-6">
      <FactGrid>
        <FactItem title="Kind" value={skill.kind} />
        <FactItem title="Location" value={skillSourceLocation(skill)} />
        <FactItem title="Hash" value={skill.hash ?? "n/a"} />
        <FactItem title="Includes" value={formatCount(skill.includes?.length ?? 0, "skill")} />
      </FactGrid>
      <SurfaceSection title="Included Skills" icon={SparklesIcon}>
        {skill.includes && skill.includes.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Hash</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skill.includes.map((include) => (
                <TableRow key={include.name}>
                  <TableCell className="font-medium">{include.name}</TableCell>
                  <TableCell>{include.kind}</TableCell>
                  <TableCell className="break-words text-muted-foreground [overflow-wrap:anywhere]">{skillSourceLocation(include)}</TableCell>
                  <TableCell className="font-mono text-xs">{include.hash ? shortId(include.hash) : "n/a"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No included skills are configured.</p>
        )}
      </SurfaceSection>
      <SurfaceSection title="Bundles" icon={BoxIcon}>
        {bundles.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hash</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Files</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bundles.map((bundle) => (
                <TableRow key={bundle.hash}>
                  <TableCell className="font-mono text-xs">{shortId(bundle.hash)}</TableCell>
                  <TableCell>{bundle.entryName}</TableCell>
                  <TableCell>{formatCount(bundle.files.length, "file")}</TableCell>
                  <TableCell>{formatTimestamp(bundle.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No skill bundles have been captured for this source.</p>
        )}
      </SurfaceSection>
    </div>
  );
}

function AgentDetail({
  agent,
  snapshot,
  hrefFor,
  onRouteClick,
}: {
  agent: WorkbenchAgent;
  snapshot: WorkbenchInspectionSnapshot;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const runs = snapshot.runs.filter((run) => run.agentName === agent.name);
  return (
    <div className="grid min-w-0 gap-6">
      <FactGrid>
        <FactItem title="Adapter" value={agent.adapter} />
        <FactItem title="Model" value={agent.model ?? "n/a"} />
        <FactItem title="Image" value={agentConfigString(agent, "image") ?? agentConfigString(agent, "dockerImage") ?? "default"} />
        <FactItem title="Network" value={agentNetworkLabel(agent)} />
        <FactItem title="Timeout" value={agentTimeoutLabel(agent)} />
        <FactItem title="Runs" value={formatCount(runs.length, "run")} />
      </FactGrid>
      <SourceBlock title="Agent Config" value={JSON.stringify(agent.config, null, 2)} language="json" />
      <LinkedRuns runs={runs} hrefFor={hrefFor} onRouteClick={onRouteClick} />
    </div>
  );
}

function LinkedRuns({
  runs,
  hrefFor,
  onRouteClick,
}: {
  runs: WorkbenchRun[];
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <LinkedObjectTable
      title="Runs"
      icon={ActivityIcon}
      rows={runs.map((run) => ({
        id: run.id,
        route: { kind: "run", runId: run.id, view: "overview" },
        cells: [run.kind, run.status, run.skillName, run.agentName, formatScore(run.score)],
      }))}
      columns={["Kind", "Status", "Skill", "Agent", "Score"]}
      empty="No runs are linked to this version."
      hrefFor={hrefFor}
      onRouteClick={onRouteClick}
    />
  );
}

function LinkedObjectTable({
  title,
  icon,
  rows,
  columns,
  empty,
  hrefFor,
  onRouteClick,
}: {
  title: string;
  icon: typeof WorkflowIcon;
  rows: Array<{ id: string; route: WorkbenchRoute; cells: string[] }>;
  columns: string[];
  empty: string;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <SurfaceSection title={title} icon={icon}>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                {columns.map((column) => <TableHead key={column}>{column}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <a
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      href={hrefFor(row.route)}
                      onClick={onRouteClick(row.route)}
                    >
                      {row.id}
                    </a>
                  </TableCell>
                  {row.cells.map((cell, index) => (
                    <TableCell key={`${row.id}-${columns[index]}`} className="break-words text-muted-foreground [overflow-wrap:anywhere]">
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </SurfaceSection>
  );
}

function WorkbenchBreadcrumbs({
  compact = false,
  hrefFor,
  onRouteClick,
  route,
}: {
  compact?: boolean;
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
  route: WorkbenchRoute;
}) {
  const items = breadcrumbItems(route);
  const workbenchRoute = skillRouteFromRoute(route);
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="min-w-0 flex-nowrap">
        <BreadcrumbItem>
          <BreadcrumbLink href={hrefFor(workbenchRoute)} onClick={onRouteClick(workbenchRoute)}>
            Workbench
          </BreadcrumbLink>
        </BreadcrumbItem>
        {items.map((item, index) => {
          const scopedItem = item.route
            ? { ...item, route: preserveSkillSurface(route, item.route) }
            : item;
          return (
            <BreadcrumbCrumb
              compact={compact}
              hrefFor={hrefFor}
              item={scopedItem}
              isLast={index === items.length - 1}
              key={`${item.label}-${index}`}
              onRouteClick={onRouteClick}
            />
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function BreadcrumbCrumb({
  compact,
  hrefFor,
  isLast,
  item,
  onRouteClick,
}: {
  compact: boolean;
  hrefFor: (route: WorkbenchRoute) => string;
  isLast: boolean;
  item: { label: string; route?: WorkbenchRoute };
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  if (compact && !isLast) {
    return null;
  }
  return (
    <>
      <BreadcrumbSeparator />
      <BreadcrumbItem className="min-w-0">
        {item.route && !isLast ? (
          <BreadcrumbLink href={hrefFor(item.route)} onClick={onRouteClick(item.route)}>
            {item.label}
          </BreadcrumbLink>
        ) : (
          <BreadcrumbPage className="truncate">{item.label}</BreadcrumbPage>
        )}
      </BreadcrumbItem>
    </>
  );
}

function WorkbenchActivitySummary({
  snapshot,
  loading,
  refreshing,
  error,
}: {
  snapshot: WorkbenchInspectionSnapshot;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}) {
  const activeRuns = snapshot.runs.filter((run) => run.status === "running");
  const label = error
    ? "Snapshot error"
    : loading
      ? "Loading state"
      : activeRuns.length > 0
        ? `${activeRuns.length} active`
        : "Idle";
  const secondary = refreshing
    ? "refreshing"
    : snapshot.status.automationReadiness?.label ?? `${formatCount(snapshot.runs.length, "run")} recorded`;
  return (
    <div className="flex min-w-0 items-center justify-start gap-2 text-xs md:justify-end">
      <Badge variant={error ? "destructive" : activeRuns.length > 0 ? "secondary" : "outline"}>{label}</Badge>
      <span className="hidden min-w-0 max-w-[18rem] truncate text-muted-foreground sm:inline">{secondary}</span>
    </div>
  );
}

function WorkbenchObjectNavigation({
  hrefFor,
  onRouteClick,
  route,
}: {
  hrefFor: (route: WorkbenchRoute) => string;
  onRouteClick: (route: WorkbenchRoute) => (event: MouseEvent<HTMLAnchorElement>) => void;
  route: WorkbenchRoute;
}) {
  const active = objectNavigationValue(route);
  const items: Array<{ value: string; label: string; route: WorkbenchRoute }> = [
    { value: "versions", label: "Versions", route: { kind: "versions", view: "archive" } },
    { value: "execution", label: "Execution", route: { kind: "execution", view: "runs" } },
    { value: "configuration", label: "Configuration", route: { kind: "configuration", view: "skills" } },
    { value: "sync", label: "Sync", route: { kind: "sync", view: "refs" } },
  ];

  return (
    <nav aria-label="Skill object navigation" className="flex min-w-0 items-center gap-1 overflow-x-auto md:justify-end">
      {items.map((item) => {
        const selected = item.value === active;
        const targetRoute = selected
          ? skillRouteFromRoute(route)
          : preserveSkillSurface(route, item.route);
        return (
          <Button
            asChild
            key={item.value}
            size="sm"
            variant={selected ? "secondary" : "ghost"}
          >
            <a
              aria-current={selected ? "page" : undefined}
              href={hrefFor(targetRoute)}
              onClick={onRouteClick(targetRoute)}
            >
              {item.label}
            </a>
          </Button>
        );
      })}
    </nav>
  );
}

function ObjectPaneBadges({
  route,
  snapshot,
}: {
  route: WorkbenchRoute;
  snapshot: WorkbenchInspectionSnapshot;
}) {
  if (route.kind === "versions") {
    return <Badge variant="outline">{snapshot.versions.length}</Badge>;
  }
  if (route.kind === "execution") {
    return <Badge variant="outline">{executionCount(snapshot, route.view)}</Badge>;
  }
  if (route.kind === "configuration") {
    return <Badge variant="outline">{route.view === "agents" ? snapshot.agents.length : snapshot.skillSources.length}</Badge>;
  }
  if (route.kind === "sync") {
    return <Badge variant="outline">{route.view === "remotes" ? snapshot.remotes.length : Object.values(snapshot.refs).filter(Boolean).length}</Badge>;
  }
  if ("view" in route) {
    return <Badge variant="outline">{route.view}</Badge>;
  }
  return null;
}

function objectNavigationValue(route: WorkbenchRoute): string | null {
  if (route.kind === "versions" || route.kind === "version") {
    return "versions";
  }
  if (route.kind === "execution" || route.kind === "run" || route.kind === "job" || route.kind === "trace" || route.kind === "artifact") {
    return "execution";
  }
  if (route.kind === "configuration" || route.kind === "skill-source" || route.kind === "agent") {
    return "configuration";
  }
  if (route.kind === "sync") {
    return "sync";
  }
  return null;
}

function objectPaneTitle(route: WorkbenchRoute): string {
  if (route.kind === "skill") {
    return "Skill";
  }
  if (route.kind === "versions") {
    return "Versions";
  }
  if (route.kind === "version") {
    return `Version ${route.versionId}`;
  }
  if (route.kind === "execution") {
    return "Execution";
  }
  if (route.kind === "run") {
    return `Run ${route.runId}`;
  }
  if (route.kind === "job") {
    return `Job ${route.jobId}`;
  }
  if (route.kind === "trace") {
    return `Trace ${route.traceId}`;
  }
  if (route.kind === "artifact") {
    return `Artifact ${route.artifactId}`;
  }
  if (route.kind === "configuration") {
    return "Configuration";
  }
  if (route.kind === "skill-source") {
    return `Skill ${route.skillName}`;
  }
  if (route.kind === "agent") {
    return `Agent ${route.agentName}`;
  }
  return "Sync";
}

function objectSurfaceFillsBody(route: WorkbenchRoute): boolean {
  return (
    route.kind === "versions" && route.view === "lineage" ||
    route.kind === "version" && route.view === "files" ||
    route.kind === "trace" && route.view === "files" ||
    route.kind === "artifact" && route.view === "files"
  );
}

function breadcrumbItems(route: WorkbenchRoute): Array<{ label: string; route?: WorkbenchRoute }> {
  if (route.kind === "skill") {
    return route.view === "files" ? [{ label: "Files" }] : [];
  }
  if (route.kind === "versions") {
    return [{ label: "Versions" }, ...(route.view === "lineage" ? [{ label: "Lineage" }] : [])];
  }
  if (route.kind === "version") {
    return [
      { label: "Versions", route: { kind: "versions", view: "archive" } },
      { label: route.versionId },
      ...(route.view !== "overview" ? [{ label: route.view }] : []),
    ];
  }
  if (route.kind === "execution") {
    return [{ label: "Execution" }, { label: route.view }];
  }
  if (route.kind === "run") {
    return [
      { label: "Execution", route: { kind: "execution", view: "runs" } },
      { label: route.runId },
      ...(route.view !== "overview" ? [{ label: route.view }] : []),
    ];
  }
  if (route.kind === "job") {
    return [
      { label: "Jobs", route: { kind: "execution", view: "jobs" } },
      { label: route.jobId },
      ...(route.view !== "overview" ? [{ label: route.view }] : []),
    ];
  }
  if (route.kind === "trace") {
    return [
      { label: "Traces", route: { kind: "execution", view: "traces" } },
      { label: route.traceId },
      ...(route.view !== "overview" ? [{ label: route.view }] : []),
    ];
  }
  if (route.kind === "artifact") {
    return [
      { label: "Artifacts", route: { kind: "execution", view: "artifacts" } },
      { label: route.artifactId },
      ...(route.view !== "overview" ? [{ label: route.view }] : []),
    ];
  }
  if (route.kind === "configuration") {
    return [{ label: "Configuration" }, { label: route.view }];
  }
  if (route.kind === "skill-source") {
    return [{ label: "Configuration", route: { kind: "configuration", view: "skills" } }, { label: route.skillName }];
  }
  if (route.kind === "agent") {
    return [{ label: "Agents", route: { kind: "configuration", view: "agents" } }, { label: route.agentName }];
  }
  return [{ label: "Sync" }, { label: route.view }];
}

function useInspectionFilePreview({
  apiBasePath,
  ownerKind,
  ownerId,
  path,
  previewMode,
  files,
}: {
  apiBasePath: string;
  ownerKind: WorkbenchFileOwnerKind;
  ownerId: string;
  path: string | null;
  previewMode: PreviewMode;
  files: readonly SurfaceSnapshotFile[];
}): {
  loading: boolean;
  error: string | null;
  preview: ReturnType<typeof surfaceFileToPreview> | null;
} {
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    preview: ReturnType<typeof surfaceFileToPreview> | null;
  }>({ loading: false, error: null, preview: null });

  useEffect(() => {
    const manifest = path ? files.find((file) => file.path === path) ?? null : null;
    if (!path || !manifest) {
      setState({ loading: false, error: null, preview: null });
      return;
    }

    const unavailableReason = workbenchInspectionFileContentUnavailableReason(manifest);
    if (unavailableReason) {
      setState({
        loading: false,
        error: null,
        preview: surfaceFileToPreview({
          path: manifest.path,
          kind: manifest.kind,
          encoding: manifest.encoding,
          executable: manifest.executable,
          unavailableReason,
        }, previewMode),
      });
      return;
    }

    if (manifest.content) {
      setState({
        loading: false,
        error: null,
        preview: surfaceFileToPreview(workbenchInspectionFileContent(manifest), previewMode),
      });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setState({ loading: true, error: null, preview: null });
    void fetch(fileContentApiPath(apiBasePath, ownerKind, ownerId, path), {
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return await response.json() as WorkbenchInspectionFileContent;
    }).then((content) => {
      if (!cancelled) {
        setState({
          loading: false,
          error: null,
          preview: surfaceFileToPreview(content, previewMode),
        });
      }
    }).catch((error: unknown) => {
      if (!cancelled && !controller.signal.aborted) {
        setState({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          preview: null,
        });
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBasePath, files, ownerId, ownerKind, path, previewMode]);

  return state;
}

function RefsIndex({ snapshot }: { snapshot: WorkbenchInspectionSnapshot }) {
  const entries = Object.entries(snapshot.refs).filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={HashIcon}
        title="No refs"
        message="Refs are recorded after a source version is created or synchronized."
        variant="hero"
        size="sm"
      />
    );
  }
  return (
    <SurfaceSection title="Refs" icon={HashIcon}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Version</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map(([name, value]) => (
            <TableRow key={name}>
              <TableCell className="font-medium">{name}</TableCell>
              <TableCell className="font-mono text-xs">{value}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SurfaceSection>
  );
}

function RemotesIndex({ snapshot }: { snapshot: WorkbenchInspectionSnapshot }) {
  if (snapshot.remotes.length === 0) {
    return (
      <EmptyState
        icon={NetworkIcon}
        title="No remotes"
        message="Add a Workbench remote to synchronize versions and evidence."
        variant="hero"
        size="sm"
      />
    );
  }
  return (
    <SurfaceSection title="Remotes" icon={NetworkIcon}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>URL</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.remotes.map((remote) => (
            <TableRow key={remote.name}>
              <TableCell className="font-medium">{remote.name}</TableCell>
              <TableCell className="break-words font-mono text-xs [overflow-wrap:anywhere]">{remote.url}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SurfaceSection>
  );
}

function DetailAccordionSection({
  children,
  summary,
  title,
  value,
}: {
  children: ReactNode;
  summary?: ReactNode;
  title: string;
  value: string;
}) {
  return (
    <AccordionItem value={value} className="min-w-0">
      <AccordionTrigger className="min-w-0 py-2.5">
        <div className="grid min-w-0 flex-1 gap-1 text-left">
          <span className="min-w-0 text-sm font-medium text-foreground">{title}</span>
          {summary ? (
            <span className="min-w-0 max-w-full break-words text-xs font-normal text-muted-foreground [overflow-wrap:anywhere]">
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

function SkillsManifestTable({ skills }: { skills: WorkbenchSkillSource[] }) {
  if (skills.length === 0) {
    return <p className="text-sm text-muted-foreground">No skill sources are configured.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Includes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {skills.map((skill) => (
          <TableRow key={skill.name}>
            <TableCell className="font-medium">{skill.name}</TableCell>
            <TableCell>{skill.kind}</TableCell>
            <TableCell className="break-words text-muted-foreground [overflow-wrap:anywhere]">{skillSourceLocation(skill)}</TableCell>
            <TableCell>{formatCount(skill.includes?.length ?? 0, "include")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AgentsManifestTable({ agents }: { agents: WorkbenchAgent[] }) {
  if (agents.length === 0) {
    return <p className="text-sm text-muted-foreground">No agents are configured.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Adapter</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>Network</TableHead>
          <TableHead>Timeout</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {agents.map((agent) => (
          <TableRow key={agent.name}>
            <TableCell className="font-medium">{agent.name}</TableCell>
            <TableCell>{agent.adapter}</TableCell>
            <TableCell>{agent.model ?? "n/a"}</TableCell>
            <TableCell>{agentNetworkLabel(agent)}</TableCell>
            <TableCell>{agentTimeoutLabel(agent)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SourceBlock({
  title,
  value,
  language,
}: {
  title: string;
  value: string;
  language: string;
}) {
  return (
    <SurfaceSection title={title} icon={BracesIcon}>
      <pre
        className="max-h-[32rem] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs leading-5"
        data-language={language}
      >
        <code>{value}</code>
      </pre>
    </SurfaceSection>
  );
}

function FactGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]">
      {children}
    </div>
  );
}

function FactItem({
  title,
  value,
  detail,
}: {
  title: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1 border-t border-border/60 py-3">
      <div className="break-words text-xs font-medium text-muted-foreground [overflow-wrap:anywhere]">
        {title}
      </div>
      <div className="break-all text-sm font-semibold leading-5 text-foreground [overflow-wrap:anywhere]">
        {value}
      </div>
      {detail ? (
        <div className="break-all text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{detail}</div>
      ) : null}
    </div>
  );
}

function MissingObject({ label }: { label: string }) {
  return (
    <EmptyState
      icon={CircleAlertIcon}
      title="Object not found"
      message={`${label} is not present in this inspection snapshot.`}
      variant="hero"
      size="md"
    />
  );
}

function summarizeEvidence(snapshot: WorkbenchInspectionSnapshot): {
  bestConfiguration: string;
  bestConfigurationDetail: string;
  readinessLabel: string;
  readinessDetail: string;
  latestImprovement: string;
  latestImprovementDetail: string;
  runtimePosture: string;
  runtimePostureDetail: string;
} {
  const scoredRuns = snapshot.runs
    .filter((run) => typeof run.score === "number")
    .sort((left, right) => (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY));
  const bestRun = scoredRuns[0] ?? null;
  const latestImprove = snapshot.runs
    .filter((run) => run.kind === "improve")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  const dockerAgents = snapshot.agents.filter((agent) =>
    agentConfigString(agent, "image") || agentConfigString(agent, "dockerImage"));
  const openNetwork = snapshot.agents.filter((agent) => agentNetworkLabel(agent) === "open").length;
  return {
    bestConfiguration: bestRun ? `${bestRun.versionId} / ${bestRun.skillName} / ${bestRun.agentName}` : "No scored run",
    bestConfigurationDetail: bestRun ? `score ${formatScore(bestRun.score)}, latency ${formatDurationMs(bestRun.latencyMs)}, cost ${formatCost(bestRun.costUsd)}` : "Run evals to record scored evidence.",
    readinessLabel: snapshot.status.automationReadiness?.label ?? "No readiness",
    readinessDetail: snapshot.status.automationReadiness?.reason ?? "Automation readiness is recorded after scored eval evidence is available.",
    latestImprovement: latestImprove?.outputVersionId ?? latestImprove?.id ?? "No improve run",
    latestImprovementDetail: latestImprove ? `${latestImprove.versionId} -> ${latestImprove.outputVersionId ?? "n/a"} / ${latestImprove.agentName} / ${formatTimestamp(latestImprove.createdAt)}` : "Run improve to create child versions from evidence.",
    runtimePosture: `${dockerAgents.length}/${snapshot.agents.length} Docker-style`,
    runtimePostureDetail: snapshot.agents.length === 0
      ? "No agents are configured."
      : `${openNetwork} open-network agents, ${snapshot.agents.length - openNetwork} isolated or default agents.`,
  };
}

function currentVersion(snapshot: WorkbenchInspectionSnapshot): WorkbenchVersion | null {
  return snapshot.status.currentVersionId
    ? snapshot.versions.find((version) => version.id === snapshot.status.currentVersionId) ?? null
    : snapshot.versions[0] ?? null;
}

function fileContentApiPath(
  apiBasePath: string,
  ownerKind: WorkbenchFileOwnerKind,
  ownerId: string,
  path: string,
): string {
  const base = apiBasePath.replace(/\/+$/u, "");
  return `${base}/${ownerKind}s/${encodeURIComponent(ownerId)}/files/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function skillSourceLocation(skill: Pick<WorkbenchSkillSource, "kind" | "path" | "from" | "ref">): string {
  if (skill.kind === "remote") {
    return `${skill.from ?? "remote"}${skill.ref ? `#${skill.ref}` : ""}`;
  }
  return skill.path ?? ".";
}

function emptyFileRouteState(): WorkbenchFileRouteState {
  return { filePath: null, directoryPath: null, previewMode: "rendered" };
}

function skillRouteFromRoute(route: WorkbenchRoute): WorkbenchRoute {
  return createSkillRoute({
    view: routeSkillSurfaceView(route),
    file: routeSkillSurfaceFile(route),
  });
}

function preserveSkillSurface(sourceRoute: WorkbenchRoute, targetRoute: WorkbenchRoute): WorkbenchRoute {
  if (targetRoute.kind === "skill") {
    return targetRoute;
  }
  return withSkillSurface(targetRoute, {
    skillView: routeSkillSurfaceView(sourceRoute),
    skillFile: routeSkillSurfaceFile(sourceRoute),
  });
}

function executionCount(snapshot: WorkbenchInspectionSnapshot, view: ExecutionIndexView): number {
  if (view === "jobs") {
    return snapshot.jobs.length;
  }
  if (view === "traces") {
    return snapshot.traces.length;
  }
  if (view === "artifacts") {
    return snapshot.artifacts.length;
  }
  return snapshot.runs.length;
}

function executionSwitchItems(): Array<{ value: ExecutionIndexView; label: string; icon: typeof WorkflowIcon }> {
  return [
    { value: "runs", label: "Runs", icon: ActivityIcon },
    { value: "jobs", label: "Jobs", icon: ListChecksIcon },
    { value: "traces", label: "Traces", icon: RouteIcon },
    { value: "artifacts", label: "Artifacts", icon: ArchiveIcon },
  ];
}

function normalizeVersionView(value: string): VersionView {
  return value === "files" || value === "runs" ? value : "overview";
}

function normalizeExecutionView(value: string): ExecutionIndexView {
  return value === "jobs" || value === "traces" || value === "artifacts" ? value : "runs";
}

function normalizeRunView(value: string): RunView {
  return value === "jobs" || value === "traces" || value === "artifacts" ? value : "overview";
}

function normalizeJobView(value: string): JobView {
  return value === "trace" || value === "artifacts" ? value : "overview";
}

function normalizeTraceView(value: string): TraceView {
  return value === "files" || value === "payload" ? value : "overview";
}

function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}
