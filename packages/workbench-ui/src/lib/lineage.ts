import ELK from "elkjs/lib/elk.bundled.js";
import { MarkerType, type Edge, type Node } from "@xyflow/react";

import type {
  EvaluationSummary,
  SubjectSummary,
  BenchmarkSnapshot,
} from "../types";
import { formatSubjectSelectionLabel, statusLabel } from "./format";
import {
  buildLatestEvaluationBySubject,
  resolveSubjectEvaluationDisplay,
} from "./subject-evaluation-display";

const elk = new ELK();

export const LINEAGE_NODE_WIDTH = 208;
const LINEAGE_NODE_INITIAL_HEIGHT = 96;
const LINEAGE_NODE_CLASS_NAME =
  "nodrag nopan grid min-h-24 w-full content-start gap-1.5 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40 data-[active=true]:border-primary/20 data-[active=true]:bg-muted/35 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring";

export interface LineageNodeData extends Record<string, unknown> {
  summary: SubjectSummary;
  active: boolean;
  statusText: string | null;
  scoreText: string;
  sourceText: string;
}

export type LineageNode = Node<LineageNodeData, "subject">;
export type LineageEdge = Edge<Record<string, never>>;
interface LineageSemanticEdge {
  id: string;
  kind: "anchor";
  sourceId: string;
  targetId: string;
}

interface SubjectLineageNode {
  id: string;
  active: boolean;
  summary: SubjectSummary;
}

interface SubjectLineageGraph {
  activeId: string | null;
  nodes: SubjectLineageNode[];
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

export function lineageSubjectNodeId(subjectId: string): string {
  return `subject:${subjectId}`;
}

export function lineageNodeTestId(subjectId: string): string {
  return `lineage-node-${subjectId}`;
}

export function getSelectedLineageSubjectId(
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
  const lineage = buildSubjectLineage({
    summaries: snapshot.summaries,
    activeId: snapshot.activeId,
  });
  const latestEvaluationBySubject = buildLatestEvaluationBySubject(snapshot.evaluations);
  const summaryById = new Map(snapshot.summaries.map((summary) => [summary.id, summary]));
  const nodes = lineage.nodes.map((node) => {
    const { summary, active } = node;
    const baseSummary = summary.baseId ? summaryById.get(summary.baseId) ?? null : null;
    const latestEvaluation = latestEvaluationBySubject.get(summary.id) ?? null;
    const evaluationDisplay = resolveSubjectEvaluationDisplay({
      latestEvaluation,
    });
    return {
      id: lineageSubjectNodeId(node.id),
      type: "subject",
      position: { x: 0, y: 0 },
      data: buildLineageNodeData({
        summary,
        active,
        latestEvaluation,
      }),
      className: LINEAGE_NODE_CLASS_NAME,
      initialWidth: LINEAGE_NODE_WIDTH,
      initialHeight: LINEAGE_NODE_INITIAL_HEIGHT,
      focusable: true,
      selectable: true,
      ariaRole: "button",
      ariaLabel: formatSubjectSelectionLabel({
        summary,
        baseSummary,
        active,
        details: [evaluationDisplay.ariaText],
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
    sourceId: lineageSubjectNodeId(edge.sourceId),
    targetId: lineageSubjectNodeId(edge.targetId),
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
  nodes: ReadonlyArray<Node<T, "subject">>,
  edges: ReadonlyArray<LineageSemanticEdge | LineageEdge>,
): Promise<Array<Node<T, "subject">>> {
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

function buildLineageNodeData(args: {
  summary: SubjectSummary;
  active: boolean;
  latestEvaluation: EvaluationSummary | null;
}): LineageNodeData {
  const { summary, active } = args;
  const statusText = summary.status === "evaluated" ? null : statusLabel(summary.status);
  const evaluationDisplay = resolveSubjectEvaluationDisplay({
    latestEvaluation: args.latestEvaluation,
  });
  return {
    summary,
    active,
    statusText,
    scoreText: evaluationDisplay.scoreText,
    sourceText: evaluationDisplay.sourceText,
  };
}

function buildSubjectLineage(args: {
  summaries: readonly SubjectSummary[];
  activeId: string | null;
}): SubjectLineageGraph {
  const orderedSummaries = args.summaries
    .slice()
    .sort((left, right) => {
      const createdAt = left.createdAt.localeCompare(right.createdAt);
      return createdAt !== 0 ? createdAt : left.id.localeCompare(right.id);
    });
  const summaryIds = new Set(orderedSummaries.map((summary) => summary.id));
  return {
    activeId: args.activeId,
    nodes: orderedSummaries.map((summary): SubjectLineageNode => ({
      id: summary.id,
      active: args.activeId === summary.id,
      summary,
    })),
    edges: orderedSummaries.flatMap((summary) => buildLineageEdges(summary, summaryIds)),
  };
}

function buildLineageEdges(
  summary: SubjectSummary,
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
