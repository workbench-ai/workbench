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
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
import { cn } from "@workbench-ai/cli-web-ui/lib/utils";

import { formatSubjectDisplayName } from "../lib/format";
import {
  buildLineageFlow,
  createLineageNodeDomAttributes,
  type LineageEdge,
  type LineageNode,
} from "../lib/lineage";
import type { BenchmarkSnapshot } from "../types";
import { LineageSurfaceSkeleton } from "./loading-states";

interface FlowState {
  loading: boolean;
  nodes: LineageNode[];
  edges: LineageEdge[];
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
  snapshot,
  selectedSubjectId,
  onSelectSubject,
}: {
  snapshot: BenchmarkSnapshot | null;
  selectedSubjectId: string | null;
  onSelectSubject: (subjectId: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <LineageGraphCanvas
        snapshot={snapshot}
        selectedSubjectId={selectedSubjectId}
        onSelectSubject={onSelectSubject}
      />
    </ReactFlowProvider>
  );
}

function LineageGraphCanvas({
  snapshot,
  selectedSubjectId,
  onSelectSubject,
}: {
  snapshot: BenchmarkSnapshot | null;
  selectedSubjectId: string | null;
  onSelectSubject: (subjectId: string) => void;
}) {
  const reactFlow = useReactFlow<LineageNode, LineageEdge>();
  const [flowState, setFlowState] = useState<FlowState>({
    loading: false,
    nodes: [],
    edges: [],
  });

  const interactiveNodes = useMemo(
    () =>
      flowState.nodes.map((node) => ({
        ...node,
        selected: node.data.summary.id === selectedSubjectId,
        className: cn(node.className, node.data.summary.id === selectedSubjectId && "ring-2 ring-primary/60"),
        domAttributes: createLineageNodeDomAttributes({
          ...node.domAttributes,
          "aria-selected": node.data.summary.id === selectedSubjectId ? "true" : undefined,
        }),
      })) satisfies LineageNode[],
    [flowState.nodes, selectedSubjectId],
  );

  function handleNodeClick(_event: ReactMouseEvent, node: LineageNode) {
    onSelectSubject(node.data.summary.id);
  }

  useEffect(() => {
    let cancelled = false;

    if (!snapshot || snapshot.summaries.length === 0) {
      setFlowState({
        loading: false,
        nodes: [],
        edges: [],
      });
      return;
    }

    setFlowState((current) => ({
      ...current,
      loading: true,
    }));

    void buildLineageFlow(snapshot).then((next) => {
      if (cancelled) {
        return;
      }
      setFlowState({
        loading: false,
        nodes: next.nodes,
        edges: next.edges,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [snapshot]);

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

  if (!snapshot || snapshot.summaries.length === 0) {
    return (
      <EmptyState
        icon={GitBranchIcon}
        eyebrow="Lineage"
        title="No lineage to inspect"
        message="Lineage appears after the first subject exists for this benchmark version."
        variant="hero"
        size="sm"
      />
    );
  }

  if (flowState.loading && flowState.nodes.length === 0) {
    return <LineageSurfaceSkeleton />;
  }

  return (
    <div
      data-testid="lineage-graph"
      className="flex min-h-[28rem] min-w-0 flex-1 overflow-hidden rounded-lg border border-border/60 bg-card"
    >
      <ReactFlow<LineageNode, LineageEdge>
        className="h-full min-h-0 w-full flex-1"
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
        onNodeClick={handleNodeClick}
        nodeTypes={NODE_TYPES}
      />
    </div>
  );
}

const SubjectNode = memo(function SubjectNode(props: NodeProps<LineageNode>) {
  const flowData = props.data;
  const summary = flowData.summary;

  return (
    <>
      <Handle type="target" position={Position.Top} style={HIDDEN_HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} style={HIDDEN_HANDLE_STYLE} />
      <div className="grid w-full min-w-0 content-start gap-1.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] uppercase text-muted-foreground">
            <GitBranchIcon className="size-3.5" />
            <span className="truncate">Subject</span>
          </span>
          {flowData.statusText ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {flowData.statusText}
            </span>
          ) : null}
        </div>
        <div className="min-w-0 truncate font-medium leading-5 text-foreground">
          {formatSubjectDisplayName(summary)}
        </div>
        {flowData.active ? (
          <div className="text-[11px] leading-4 text-primary">Active</div>
        ) : null}
        <div className="min-w-0 truncate text-[11px] font-medium leading-4 text-foreground">
          {flowData.scoreText}
        </div>
      </div>
    </>
  );
});

const NODE_TYPES = {
  subject: SubjectNode,
};
