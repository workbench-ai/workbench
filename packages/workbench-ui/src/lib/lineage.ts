import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type {
  WorkbenchLineageEdge,
  WorkbenchVersion,
} from "@workbench-ai/workbench-contract";

export const VERSION_LINEAGE_NODE_WIDTH = 224;
const VERSION_LINEAGE_NODE_INITIAL_HEIGHT = 116;
const VERSION_LINEAGE_NODE_CLASS_NAME =
  "nodrag nopan grid min-h-28 w-full content-start gap-1.5 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40 data-[active=true]:border-primary/20 data-[active=true]:bg-muted/35 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring";

export interface VersionLineageGraph {
  roots: string[];
  nodes: VersionLineageNodeData[];
  edgeCount: number;
}

export interface VersionLineageNodeData extends Record<string, unknown> {
  version: WorkbenchVersion;
  active: boolean;
  childCount: number;
  edgeReason: string | null;
}

export type VersionLineageNode = Node<VersionLineageNodeData, "version">;
export type VersionLineageEdge = Edge<Record<string, never>>;

interface ElkInstance {
  layout(graph: Record<string, unknown>): Promise<{
    children?: Array<{
      id?: string;
      x?: number;
      y?: number;
    }>;
  }>;
}

let elkInstancePromise: Promise<ElkInstance> | null = null;

const EDGE_STROKE = "var(--muted-foreground)";
const EDGE_MARKER_END = {
  type: MarkerType.ArrowClosed,
  color: EDGE_STROKE,
} as const;
const BASE_EDGE_STYLE = {
  stroke: EDGE_STROKE,
  strokeWidth: 2,
  strokeOpacity: 0.75,
  strokeLinecap: "round" as const,
};

export function versionLineageNodeId(versionId: string): string {
  return `version:${versionId}`;
}

export function versionLineageNodeTestId(versionId: string): string {
  return `lineage-node-${versionId}`;
}

export function createVersionLineageNodeDomAttributes(
  attributes: Record<string, unknown>,
): VersionLineageNode["domAttributes"] {
  return attributes as unknown as VersionLineageNode["domAttributes"];
}

export function buildVersionLineageGraph(args: {
  versions: readonly WorkbenchVersion[];
  lineage: readonly WorkbenchLineageEdge[];
  currentVersionId?: string | null;
}): VersionLineageGraph {
  const versions = [...args.versions].sort(compareVersions);
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const childrenByParent = new Map<string, WorkbenchVersion[]>();
  const childIds = new Set<string>();
  const validEdges: WorkbenchLineageEdge[] = [];

  for (const edge of args.lineage) {
    if (edge.parentId === edge.childId) {
      continue;
    }
    const parent = versionById.get(edge.parentId);
    const child = versionById.get(edge.childId);
    if (!parent || !child) {
      continue;
    }
    const children = childrenByParent.get(parent.id) ?? [];
    if (!children.some((entry) => entry.id === child.id)) {
      children.push(child);
      childrenByParent.set(parent.id, children);
      childIds.add(child.id);
      validEdges.push(edge);
    }
  }

  for (const children of childrenByParent.values()) {
    children.sort(compareVersions);
  }

  const rootVersions = versions.filter((version) => !childIds.has(version.id));
  const roots = (rootVersions.length > 0 ? rootVersions : versions).map((version) => version.id);
  const incomingEdgeByChild = new Map(validEdges.map((edge) => [edge.childId, edge]));
  const nodes = versions.map((version) => {
    const incomingEdge = incomingEdgeByChild.get(version.id);
    return {
      version,
      active: args.currentVersionId === version.id,
      childCount: childrenByParent.get(version.id)?.length ?? 0,
      edgeReason: incomingEdge ? formatLineageEdgeReason(incomingEdge) : null,
    };
  });

  return { roots, nodes, edgeCount: validEdges.length };
}

export async function buildVersionLineageFlow(args: {
  versions: readonly WorkbenchVersion[];
  lineage: readonly WorkbenchLineageEdge[];
  currentVersionId?: string | null;
}): Promise<{
  nodes: VersionLineageNode[];
  edges: VersionLineageEdge[];
}> {
  const graph = buildVersionLineageGraph(args);
  const versionById = new Map(args.versions.map((version) => [version.id, version]));
  const validEdges = args.lineage.filter((edge) =>
    edge.parentId !== edge.childId &&
    versionById.has(edge.parentId) &&
    versionById.has(edge.childId));
  const nodes = graph.nodes.map((node) => ({
    id: versionLineageNodeId(node.version.id),
    type: "version",
    position: { x: 0, y: 0 },
    data: node,
    className: VERSION_LINEAGE_NODE_CLASS_NAME,
    initialWidth: VERSION_LINEAGE_NODE_WIDTH,
    initialHeight: VERSION_LINEAGE_NODE_INITIAL_HEIGHT,
    focusable: true,
    selectable: true,
    ariaRole: "button",
    ariaLabel: [
      node.version.id,
      node.version.message,
      node.active ? "current" : null,
      node.edgeReason,
    ].filter(Boolean).join(", "),
    domAttributes: createVersionLineageNodeDomAttributes({
      "data-testid": versionLineageNodeTestId(node.version.id),
      "data-active": node.active ? "true" : undefined,
    }),
    style: {
      width: VERSION_LINEAGE_NODE_WIDTH,
    },
  })) satisfies VersionLineageNode[];
  const edges = validEdges.map((edge) => ({
    id: `${edge.parentId}:${edge.childId}:${edge.createdAt}`,
    sourceId: versionLineageNodeId(edge.parentId),
    targetId: versionLineageNodeId(edge.childId),
  }));

  return {
    nodes: await layoutVersionLineageNodes(nodes, edges),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      markerEnd: EDGE_MARKER_END,
      style: BASE_EDGE_STYLE,
    })),
  };
}

async function layoutVersionLineageNodes(
  nodes: ReadonlyArray<VersionLineageNode>,
  edges: ReadonlyArray<{ id: string; sourceId: string; targetId: string }>,
): Promise<VersionLineageNode[]> {
  const elk = await getElkInstance();
  const layout = await elk.layout({
    id: "version-lineage-root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
      "elk.spacing.nodeNode": "80",
      "elk.padding": "[top=40,left=40,bottom=40,right=40]",
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: node.measured?.width ?? node.width ?? node.initialWidth ?? VERSION_LINEAGE_NODE_WIDTH,
      height: node.measured?.height ?? node.height ?? node.initialHeight ?? VERSION_LINEAGE_NODE_INITIAL_HEIGHT,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.sourceId],
      targets: [edge.targetId],
    })),
  });
  const positions = new Map(
    (layout.children ?? []).map((child) => [
      child.id,
      {
        x: child.x ?? 0,
        y: child.y ?? 0,
      },
    ]),
  );
  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
  }));
}

async function getElkInstance(): Promise<ElkInstance> {
  elkInstancePromise ??= import("elkjs/lib/elk.bundled.js").then((module) => {
    const Elk = module.default as new () => ElkInstance;
    return new Elk();
  });
  return elkInstancePromise;
}

function formatLineageEdgeReason(edge: WorkbenchLineageEdge): string {
  return [
    edge.reason,
    edge.runId ? `run ${edge.runId}` : null,
  ].filter(Boolean).join(" / ");
}

function compareVersions(left: WorkbenchVersion, right: WorkbenchVersion): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}
