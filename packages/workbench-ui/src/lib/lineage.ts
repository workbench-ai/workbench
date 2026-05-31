import { MarkerType, type Edge, type Node } from "@xyflow/react";
import {
  buildCandidateLineage,
  type CandidateLineageEdge,
  type CandidateLineageGraph,
} from "@workbench-ai/workbench-contract";

import type {
  CandidateSummary,
  BenchmarkSnapshot,
} from "../types";
import { formatCandidateSelectionLabel, statusLabel } from "./format";
import {
  buildCandidateEvaluationRollups,
  resolveCandidateEvaluationRollupDisplay,
} from "./candidate-evaluation-display";

export const LINEAGE_NODE_WIDTH = 208;
const LINEAGE_NODE_INITIAL_HEIGHT = 96;
const LINEAGE_NODE_CLASS_NAME =
  "nodrag nopan grid min-h-24 w-full content-start gap-1.5 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40 data-[active=true]:border-primary/20 data-[active=true]:bg-muted/35 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring";

export interface LineageNodeData extends Record<string, unknown> {
  summary: CandidateSummary;
  active: boolean;
  statusText: string | null;
  scoreText: string;
}

export type LineageNode = Node<LineageNodeData, "candidate">;
export type LineageEdge = Edge<Record<string, never>>;

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
  snapshot: BenchmarkSnapshot,
): Promise<{
  nodes: LineageNode[];
  edges: LineageEdge[];
}> {
  const lineage = buildCandidateLineage({
    summaries: snapshot.summaries,
    activeId: snapshot.activeId,
  });
  const rollupByCandidate = buildCandidateEvaluationRollups(snapshot.evaluations);
  const summaryById = new Map(snapshot.summaries.map((summary) => [summary.id, summary]));
  const nodes = lineage.nodes.map((node) => {
    const { summary, active } = node;
    const baseSummary = summary.baseId ? summaryById.get(summary.baseId) ?? null : null;
    const rollupDisplay = resolveCandidateEvaluationRollupDisplay(
      rollupByCandidate.get(summary.id),
    );
    return {
      id: lineageCandidateNodeId(node.id),
      type: "candidate",
      position: { x: 0, y: 0 },
      data: buildLineageNodeData({
        summary,
        active,
        scoreText: rollupDisplay.scoreText,
      }),
      className: LINEAGE_NODE_CLASS_NAME,
      initialWidth: LINEAGE_NODE_WIDTH,
      initialHeight: LINEAGE_NODE_INITIAL_HEIGHT,
      focusable: true,
      selectable: true,
      ariaRole: "button",
      ariaLabel: formatCandidateSelectionLabel({
        summary,
        baseSummary,
        active,
        details: [rollupDisplay.ariaText],
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
  edges: ReadonlyArray<CandidateLineageEdge | LineageEdge>,
): Promise<Array<Node<T, "candidate">>> {
  const elk = await getElkInstance();
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

async function getElkInstance(): Promise<ElkInstance> {
  elkInstancePromise ??= import("elkjs/lib/elk.bundled.js").then((module) => {
    const Elk = module.default as new () => ElkInstance;
    return new Elk();
  });
  return elkInstancePromise;
}

function buildLineageNodeData(args: {
  summary: CandidateSummary;
  active: boolean;
  scoreText: string;
}): LineageNodeData {
  const { summary, active } = args;
  const statusText = summary.status === "evaluated" ? null : statusLabel(summary.status);
  return {
    summary,
    active,
    statusText,
    scoreText: args.scoreText,
  };
}
