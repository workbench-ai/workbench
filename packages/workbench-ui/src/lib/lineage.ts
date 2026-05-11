import ELK from "elkjs/lib/elk.bundled.js";
import { MarkerType, type Edge, type Node } from "@xyflow/react";

import type {
  CandidateSummary,
  RuntimeSnapshot,
} from "../types";
import { formatCandidateSelectionLabel, formatMetricSummary, hasMetricValues, statusLabel } from "./format";

const elk = new ELK();

export const LINEAGE_NODE_WIDTH = 208;
const LINEAGE_NODE_INITIAL_HEIGHT = 96;
const LINEAGE_NODE_CLASS_NAME =
  "nodrag nopan grid min-h-24 w-full content-start gap-1.5 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40 data-[active=true]:border-primary/20 data-[active=true]:bg-muted/35 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring";

export interface LineageNodeData extends Record<string, unknown> {
  summary: CandidateSummary;
  active: boolean;
  statusText: string | null;
  metricText: string | null;
}

export type LineageNode = Node<LineageNodeData, "candidate">;
export type LineageEdge = Edge<Record<string, never>>;
interface LineageSemanticEdge {
  id: string;
  kind: "anchor";
  sourceId: string;
  targetId: string;
}

interface CandidateLineageNode {
  id: string;
  active: boolean;
  summary: CandidateSummary;
}

interface CandidateLineageGraph {
  activeId: string | null;
  nodes: CandidateLineageNode[];
  edges: LineageSemanticEdge[];
}

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

export function lineageCandidateNodeId(candidateId: string): string {
  return `candidate:${candidateId}`;
}

export function lineageNodeTestId(candidateId: string): string {
  return `lineage-node-${candidateId}`;
}

export function getSelectedLineageCandidateId(
  nodes: ReadonlyArray<Pick<LineageNode, "data">>,
): string | null {
  return nodes[0]?.data.summary.id ?? null;
}

export function createLineageNodeDomAttributes(
  attributes: Record<string, unknown>,
): LineageNode["domAttributes"] {
  return attributes as unknown as LineageNode["domAttributes"];
}

export async function buildLineageFlow(
  snapshot: RuntimeSnapshot,
): Promise<{
  nodes: LineageNode[];
  edges: LineageEdge[];
}> {
  const lineage = buildCandidateLineage({
    summaries: snapshot.summaries,
    activeId: snapshot.activeId,
  });
  const nodes = lineage.nodes.map((node) => {
    const { summary, active } = node;
    return {
      id: lineageCandidateNodeId(node.id),
      type: "candidate",
      position: { x: 0, y: 0 },
      data: buildLineageNodeData(summary, active),
      className: LINEAGE_NODE_CLASS_NAME,
      initialWidth: LINEAGE_NODE_WIDTH,
      initialHeight: LINEAGE_NODE_INITIAL_HEIGHT,
      focusable: true,
      selectable: true,
      ariaRole: "button",
      ariaLabel: formatCandidateSelectionLabel({
        summary,
        active,
        details: [hasMetricValues(summary.metrics) ? formatMetricSummary(summary.metrics) : null],
      }),
      domAttributes: createLineageNodeDomAttributes({
        "data-testid": lineageNodeTestId(summary.id),
        "data-active": active ? "true" : undefined,
      }),
      style: {
        width: LINEAGE_NODE_WIDTH,
      },
    } satisfies LineageNode;
  });
  const edges = lineage.edges.map((edge) => ({
    id: edge.id,
    kind: edge.kind,
    sourceId: lineageCandidateNodeId(edge.sourceId),
    targetId: lineageCandidateNodeId(edge.targetId),
  }));

  return {
    nodes: await layoutLineageNodes(nodes, edges),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      markerEnd: EDGE_MARKER_END,
      style: BASE_EDGE_STYLE,
    })),
  };
}

async function layoutLineageNodes<T extends LineageNodeData>(
  nodes: ReadonlyArray<Node<T, "candidate">>,
  edges: ReadonlyArray<LineageSemanticEdge | LineageEdge>,
): Promise<Array<Node<T, "candidate">>> {
  const layout = await elk.layout({
    id: "lineage-root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
      "elk.spacing.nodeNode": "80",
      "elk.padding": "[top=40,left=40,bottom=40,right=40]",
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: node.measured?.width ?? node.width ?? node.initialWidth ?? LINEAGE_NODE_WIDTH,
      height: node.measured?.height ?? node.height ?? node.initialHeight ?? LINEAGE_NODE_INITIAL_HEIGHT,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: ["sourceId" in edge ? edge.sourceId : edge.source],
      targets: ["targetId" in edge ? edge.targetId : edge.target],
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

function buildLineageNodeData(summary: CandidateSummary, active: boolean): LineageNodeData {
  const statusText = summary.status === "evaluated" ? null : statusLabel(summary.status);
  const metricText = hasMetricValues(summary.metrics) ? formatMetricSummary(summary.metrics) : null;
  return {
    summary,
    active,
    statusText,
    metricText,
  };
}

function buildCandidateLineage(args: {
  summaries: readonly CandidateSummary[];
  activeId: string | null;
}): CandidateLineageGraph {
  const orderedSummaries = args.summaries
    .slice()
    .sort((left, right) => {
      const createdAt = left.createdAt.localeCompare(right.createdAt);
      return createdAt !== 0 ? createdAt : left.id.localeCompare(right.id);
    });
  const summaryIds = new Set(orderedSummaries.map((summary) => summary.id));
  return {
    activeId: args.activeId,
    nodes: orderedSummaries.map((summary): CandidateLineageNode => ({
      id: summary.id,
      active: args.activeId === summary.id,
      summary,
    })),
    edges: orderedSummaries.flatMap((summary) => buildLineageEdges(summary, summaryIds)),
  };
}

function buildLineageEdges(
  summary: CandidateSummary,
  summaryIds: ReadonlySet<string>,
): LineageSemanticEdge[] {
  const edges: LineageSemanticEdge[] = [];
  if (summary.baseId && summary.baseId !== summary.id && summaryIds.has(summary.baseId)) {
    edges.push({
      id: `anchor:${summary.baseId}:${summary.id}`,
      kind: "anchor",
      sourceId: summary.baseId,
      targetId: summary.id,
    });
  }
  return edges;
}
