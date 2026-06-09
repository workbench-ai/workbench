import {
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import { GitBranchIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";

import type {
  WorkbenchLineageEdge,
  WorkbenchVersion,
} from "@workbench-ai/workbench-contract";
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
import { Badge } from "@workbench-ai/cli-web-ui/components/ui/badge";
import { cn } from "@workbench-ai/cli-web-ui/lib/utils";

import { formatCount, formatTimestamp, shortId } from "../lib/format";
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

const FIT_VIEW_OPTIONS = {
  padding: 0.08,
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

export function LineageGraph({
  currentVersionId,
  lineage,
  onVersionClick,
  versions,
}: {
  currentVersionId?: string | null;
  lineage: readonly WorkbenchLineageEdge[];
  onVersionClick: (versionId: string) => void;
  versions: readonly WorkbenchVersion[];
}) {
  return (
    <ReactFlowProvider>
      <LineageGraphCanvas
        currentVersionId={currentVersionId}
        lineage={lineage}
        onVersionClick={onVersionClick}
        versions={versions}
      />
    </ReactFlowProvider>
  );
}

function LineageGraphCanvas({
  currentVersionId,
  lineage,
  onVersionClick,
  versions,
}: {
  currentVersionId?: string | null;
  lineage: readonly WorkbenchLineageEdge[];
  onVersionClick: (versionId: string) => void;
  versions: readonly WorkbenchVersion[];
}) {
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
    void buildVersionLineageFlow({ versions, lineage, currentVersionId }).then((flow) => {
      if (!cancelled) {
        setFlowState({ loading: false, nodes: flow.nodes, edges: flow.edges });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentVersionId, lineage, versions]);

  useEffect(() => {
    if (flowState.nodes.length === 0) {
      return;
    }
    const frameId = requestAnimationFrame(() => {
      void reactFlow.fitView(FIT_VIEW_OPTIONS);
    });
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [flowState.nodes, reactFlow]);

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
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="break-words font-semibold [overflow-wrap:anywhere]">
                {version.id}
              </span>
              {flowData.active ? <Badge variant="outline">current</Badge> : null}
            </div>
            <span className="break-words text-muted-foreground [overflow-wrap:anywhere]">
              {version.message}
            </span>
          </div>
          <GitBranchIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        </div>
        <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{shortId(version.hash)}</span>
          <span>{formatTimestamp(version.createdAt)}</span>
          <span>{formatCount(version.parentIds.length, "parent")}</span>
          <span>{formatCount(flowData.childCount, "child")}</span>
        </div>
        {flowData.edgeReason ? (
          <div className="text-xs text-muted-foreground">
            {flowData.edgeReason}
          </div>
        ) : null}
      </div>
    </>
  );
});

const NODE_TYPES = {
  version: VersionNode,
};
