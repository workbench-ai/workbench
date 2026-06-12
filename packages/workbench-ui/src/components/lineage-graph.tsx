import {
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import { GitBranchIcon, SparklesIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";

import type {
  WorkbenchLineageEdge,
  WorkbenchRun,
  WorkbenchVersion,
} from "@workbench-ai/workbench-contract";
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
import { Badge } from "@workbench-ai/cli-web-ui/components/ui/badge";
import { cn } from "@workbench-ai/cli-web-ui/lib/utils";

import { formatScore, formatTimestamp } from "../lib/format";
import {
  buildVersionLineageFlow,
  createVersionLineageNodeDomAttributes,
  type VersionLineageEdge,
  type VersionLineageNode,
} from "../lib/lineage";

interface FlowState {
  loading: boolean;
  nodes: VersionLineageNode[];
  edges: VersionLineageEdge[];
}

// fitView clamps its computed zoom between these bounds. The minZoom floor
// keeps nodes readable when the lineage grows large: instead of shrinking the
// whole graph to fit, the view stays at a legible scale and the user pans.
// (Manual zoom-out below the floor is still allowed via the viewport minZoom.)
const FIT_VIEW_OPTIONS = {
  padding: 0.08,
  minZoom: 0.75,
  maxZoom: 1.2,
} as const;

const HIDDEN_HANDLE_STYLE = {
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  opacity: 0,
  background: "transparent",
  border: 0,
  pointerEvents: "none" as const,
};

interface LineageGraphProps {
  currentVersionId?: string | null;
  publishedVersionId?: string | null;
  lineage: readonly WorkbenchLineageEdge[];
  onVersionClick: (versionId: string) => void;
  runs?: readonly WorkbenchRun[];
  versions: readonly WorkbenchVersion[];
}

export function LineageGraph(props: LineageGraphProps) {
  return (
    <ReactFlowProvider>
      <LineageGraphCanvas {...props} />
    </ReactFlowProvider>
  );
}

function LineageGraphCanvas({
  currentVersionId,
  publishedVersionId,
  lineage,
  onVersionClick,
  runs,
  versions,
}: LineageGraphProps) {
  const reactFlow = useReactFlow<VersionLineageNode, VersionLineageEdge>();
  const [flowState, setFlowState] = useState<FlowState>({
    loading: false,
    nodes: [],
    edges: [],
  });
  const interactiveNodes = useMemo(
    () =>
      flowState.nodes.map((node) => ({
        ...node,
        selected: node.data.version.id === currentVersionId,
        className: cn(node.className, node.data.version.id === currentVersionId && "ring-2 ring-primary/60"),
        domAttributes: createVersionLineageNodeDomAttributes({
          ...node.domAttributes,
          "aria-selected": node.data.version.id === currentVersionId ? "true" : undefined,
        }),
      })) satisfies VersionLineageNode[],
    [currentVersionId, flowState.nodes],
  );

  useEffect(() => {
    let cancelled = false;
    if (versions.length === 0) {
      setFlowState({ loading: false, nodes: [], edges: [] });
      return;
    }
    setFlowState((current) => ({ ...current, loading: true }));
    void buildVersionLineageFlow({ versions, lineage, currentVersionId, publishedVersionId, runs }).then((flow) => {
      if (!cancelled) {
        setFlowState({ loading: false, nodes: flow.nodes, edges: flow.edges });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentVersionId, lineage, publishedVersionId, runs, versions]);

  useEffect(() => {
    if (flowState.nodes.length === 0) {
      return;
    }
    // Center on the active version when there is one; large graphs then open
    // focused on the node that matters instead of a zoomed-out overview.
    const activeNode = flowState.nodes.find((node) => node.data.version.id === currentVersionId);
    const frameId = requestAnimationFrame(() => {
      void reactFlow.fitView(activeNode
        ? { ...FIT_VIEW_OPTIONS, maxZoom: 1, nodes: [{ id: activeNode.id }] }
        : FIT_VIEW_OPTIONS);
    });
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [currentVersionId, flowState.nodes, reactFlow]);

  if (versions.length === 0) {
    return (
      <EmptyState
        icon={GitBranchIcon}
        title="No lineage to inspect"
        message="Lineage appears after Workbench observes related skill versions."
        variant="hero"
        size="sm"
      />
    );
  }

  if (flowState.loading && flowState.nodes.length === 0) {
    return (
      <div className="flex min-h-[28rem] min-w-0 items-center justify-center text-sm text-muted-foreground">
        Preparing lineage graph
      </div>
    );
  }

  return (
    <div
      data-testid="lineage-graph"
      className="flex min-h-[28rem] min-w-0 flex-1 overflow-hidden rounded-lg border border-border/60 bg-card"
    >
      <ReactFlow<VersionLineageNode, VersionLineageEdge>
        className="h-full min-h-[28rem] w-full flex-1"
        nodes={interactiveNodes}
        edges={flowState.edges}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.2}
        maxZoom={4.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        zoomOnDoubleClick={false}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_event: ReactMouseEvent, node) => onVersionClick(node.data.version.id)}
      />
    </div>
  );
}

const VersionNode = memo(function VersionNode(props: NodeProps<VersionLineageNode>) {
  const flowData = props.data;
  const version = flowData.version;
  return (
    <>
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} style={HIDDEN_HANDLE_STYLE} />
      <div
        aria-current={flowData.active ? "page" : undefined}
        className="grid min-w-0 gap-2 text-left text-sm text-foreground"
      >
        <div className="grid min-w-0 gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="break-words font-semibold [overflow-wrap:anywhere]">
              {flowData.label}
            </span>
            {flowData.active ? <Badge variant="outline">current</Badge> : null}
            {flowData.published ? <Badge variant="outline">published</Badge> : null}
          </div>
          {flowData.improvedFromLabel ? (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <SparklesIcon aria-hidden="true" className="size-3 shrink-0" />
              improved from {flowData.improvedFromLabel}
            </span>
          ) : null}
          <span className="line-clamp-2 break-words text-muted-foreground [overflow-wrap:anywhere]" title={version.message}>
            {version.message}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{formatTimestamp(version.createdAt)}</span>
          {flowData.score !== null ? <span>score {formatScore(flowData.score)}</span> : null}
        </div>
      </div>
    </>
  );
});

const NODE_TYPES = {
  version: VersionNode,
};
