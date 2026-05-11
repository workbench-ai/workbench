import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, MessagesSquare } from "lucide-react";

import type {
  ExecutionStageMap,
  ExecutionStageMapSegment,
  ExecutionTimeline,
  ExecutionTimelineGroup,
  ExecutionTimelineRow,
  TraceSpanStatus,
} from "../../lib/execution-trace-timeline";
import {
  formatDuration,
  formatLabel,
  formatTimestamp,
} from "../../lib/execution-trace-timeline";
import { EmptyState } from "./empty-state";
import { StreamingMarkdown } from "./streaming-markdown";
import { TextBlockView } from "./text-block-view";
import { Badge } from "../ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Label } from "../ui/label";
import { Separator } from "../ui/separator";
import { Switch } from "../ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { badgeToneProps } from "../../lib/badge";
import { cn } from "../../lib/utils";

export interface ExecutionTraceTimelineProps {
  executionTimeline: ExecutionTimeline;
  layout?: "fill" | "content";
  className?: string;
}

interface TimelineStageView {
  group: ExecutionTimelineGroup;
  visibleRows: ExecutionTimelineRow[];
  visibleSegments: ExecutionStageMapSegment[];
}

export function ExecutionTraceTimeline({
  className,
  executionTimeline,
  layout = "fill",
}: ExecutionTraceTimelineProps) {
  const { groups, stageMaps } = executionTimeline;
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [openStageId, setOpenStageId] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [selectedRowsByStage, setSelectedRowsByStage] = useState<
    Record<string, string | null>
  >({});

  const stages = useMemo<TimelineStageView[]>(() => {
    const stageMapById = new Map(stageMaps.map((stageMap) => [stageMap.id, stageMap]));
    return groups
      .map((group) => {
        const stageMap = stageMapById.get(group.id);
        if (!stageMap) {
          return null;
        }
        const visibleRows = filterTimelineRows(group.rows, showNotes);
        const visibleSegments = filterStageMapSegments(stageMap, visibleRows);
        return { group, visibleRows, visibleSegments };
      })
      .filter((stage): stage is TimelineStageView => stage != null);
  }, [groups, showNotes, stageMaps]);

  useEffect(() => {
    if (stages.length === 0) {
      setOpenStageId(null);
      return;
    }
    if (openStageId && !stages.some((stage) => stage.group.id === openStageId)) {
      setOpenStageId(null);
    }
  }, [openStageId, stages]);

  useEffect(() => {
    setSelectedRowsByStage((current) => {
      const next = Object.fromEntries(
        stages.map((stage) => {
          const currentRowId = current[stage.group.id] ?? null;
          const nextRowId = stage.visibleRows.some(
            (row) => row.anchorId === currentRowId,
          )
            ? currentRowId
            : null;
          return [stage.group.id, nextRowId];
        }),
      );
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);
      if (
        currentKeys.length === nextKeys.length &&
        nextKeys.every((key) => current[key] === next[key])
      ) {
        return current;
      }
      return next;
    });
  }, [stages]);

  if (stages.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-0 min-w-0",
          layout === "fill" && "flex-1",
          className,
        )}
        data-testid="timeline-tab"
      >
        <EmptyState
          icon={MessagesSquare}
          message="No timeline evidence recorded for this attempt"
        />
      </div>
    );
  }

  function focusRow(targetRowId: string) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const row = rowRefs.current.get(targetRowId);
        if (!row) {
          return;
        }
        row.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        row.focus({ preventScroll: true });
      });
    });
  }

  function selectRow(stageId: string, targetRowId: string, toggle: boolean) {
    setOpenStageId(stageId);
    let nextRowId: string | null = targetRowId;
    setSelectedRowsByStage((current) => {
      nextRowId =
        toggle && current[stageId] === targetRowId ? null : targetRowId;
      return {
        ...current,
        [stageId]: nextRowId,
      };
    });
    if (nextRowId) {
      focusRow(nextRowId);
    }
  }

  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-col",
          layout === "fill" && "flex-1",
          className,
        )}
        data-testid="timeline-tab"
      >
        <div
          className={cn(
            "min-h-0",
            layout === "fill" ? "flex-1 overflow-y-auto" : "overflow-visible",
          )}
          data-testid="timeline-viewport"
        >
          <div className="grid gap-3" data-testid="timeline-feed">
            <div className="flex items-center justify-end px-1">
              <div className="flex items-center gap-2">
                <Switch
                  checked={showNotes}
                  data-testid="timeline-show-notes-toggle"
                  id="timeline-show-notes-toggle"
                  onCheckedChange={setShowNotes}
                  size="sm"
                />
                <Label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="timeline-show-notes-toggle"
                >
                  Show notes
                </Label>
              </div>
            </div>

            <div
              className="overflow-hidden rounded-xl border border-border/60 bg-background/55"
              data-testid="timeline-stage-list"
            >
              {stages.map((stage, index) => (
                <ExecutionTimelineStageAccordion
                  key={stage.group.id}
                  activeRowId={selectedRowsByStage[stage.group.id] ?? null}
                  group={stage.group}
                  isLast={index === stages.length - 1}
                  onOpenChange={(open) => {
                    setOpenStageId(open ? stage.group.id : null);
                  }}
                  onRowRef={(rowId, element) => {
                    if (element) {
                      rowRefs.current.set(rowId, element);
                      return;
                    }
                    rowRefs.current.delete(rowId);
                  }}
                  onSelectRow={(rowId) => selectRow(stage.group.id, rowId, true)}
                  onSelectSegment={(targetRowId) =>
                    selectRow(stage.group.id, targetRowId, false)
                  }
                  open={openStageId === stage.group.id}
                  rows={stage.visibleRows}
                  segments={stage.visibleSegments}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function ExecutionTimelineStageAccordion({
  activeRowId,
  group,
  isLast,
  onOpenChange,
  onRowRef,
  onSelectRow,
  onSelectSegment,
  open,
  rows,
  segments,
}: {
  activeRowId: string | null;
  group: ExecutionTimelineGroup;
  isLast: boolean;
  onOpenChange: (open: boolean) => void;
  onRowRef: (rowId: string, element: HTMLDivElement | null) => void;
  onSelectRow: (rowId: string) => void;
  onSelectSegment: (targetRowId: string) => void;
  open: boolean;
  rows: ExecutionTimelineRow[];
  segments: ExecutionStageMapSegment[];
}) {
  return (
    <Collapsible onOpenChange={onOpenChange} open={open}>
      <section
        className={cn(
          "bg-background/30",
          !isLast && "border-b border-border/60",
        )}
        data-testid="timeline-stage-accordion"
      >
        <CollapsibleTrigger
          className="group flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          data-testid="timeline-stage-trigger"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">
              {group.title}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {formatTimestamp(group.startedAt)}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {group.status ? <TimelineStatusBadge status={group.status} /> : null}
            {group.durationMs > 0 ? (
              <span className="whitespace-nowrap">
                {formatDuration(group.durationMs)}
              </span>
            ) : null}
          </div>

          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180 text-foreground",
            )}
          />
        </CollapsibleTrigger>

        <CollapsibleContent
          className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
          data-testid="timeline-stage-content"
        >
          <div className="grid gap-3 px-3 pb-3">
            <Separator />
            <ExecutionStageStepMap
              activeRowId={activeRowId}
              onSelectSegment={onSelectSegment}
              segments={segments}
            />
            <ExecutionTimelineStagePanel
              activeRowId={activeRowId}
              onRowRef={onRowRef}
              onSelectRow={onSelectRow}
              rows={rows}
            />
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function ExecutionStageStepMap({
  activeRowId,
  onSelectSegment,
  segments,
}: {
  activeRowId: string | null;
  onSelectSegment: (targetRowId: string) => void;
  segments: ExecutionStageMapSegment[];
}) {
  return (
    <div className="grid gap-2" data-testid="timeline-step-map">
      {segments.length > 0 ? (
        <div className="overflow-x-auto">
          <div className="flex h-4 min-w-full overflow-hidden rounded-md bg-muted/32 ring-1 ring-border/60">
            {segments.map((segment, index) => (
              <ExecutionStageSegment
                key={segment.id}
                active={activeRowId === segment.targetRowId}
                index={index}
                onClick={() => onSelectSegment(segment.targetRowId)}
                segment={segment}
                segmentCount={segments.length}
              />
            ))}
          </div>
        </div>
      ) : (
        <div
          className="rounded-md bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
          data-testid="timeline-step-map-empty"
        >
          No visible steps for this stage. Turn on Show notes to inspect the
          hidden trace details.
        </div>
      )}
    </div>
  );
}

function ExecutionStageSegment({
  active,
  index,
  onClick,
  segment,
  segmentCount,
}: {
  active: boolean;
  index: number;
  onClick: () => void;
  segment: ExecutionStageMapSegment;
  segmentCount: number;
}) {
  const durationLabel =
    segment.durationMs != null
      ? formatDuration(segment.durationMs)
      : "Duration unavailable";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Jump to ${segment.label}: ${segment.title}`}
          className={cn(
            "h-full min-w-0 shrink-0 rounded-none transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
            index === 0 && "rounded-l-[7px] border-l-0",
            index === segmentCount - 1 && "rounded-r-[7px]",
            segmentToneClassName(segment.tone),
            active && "brightness-[0.94] saturate-150 ring-1 ring-inset ring-foreground/18",
          )}
          data-testid="timeline-step-map-segment"
          onClick={onClick}
          style={{
            flex: `${segment.flexWeight} 1 0`,
            minWidth:
              segmentCount > 72 ? "2px" : segmentCount > 40 ? "3px" : "5px",
          }}
        />
      </TooltipTrigger>
      <TooltipContent className="max-w-sm" side="bottom" sideOffset={8}>
        <div className="grid gap-1.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">{segment.label}</span>
            <span className="text-background/75">{durationLabel}</span>
          </div>
          <div>{segment.title}</div>
          {segment.detail ? (
            <div className="text-background/75">{segment.detail}</div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function ExecutionTimelineStagePanel({
  activeRowId,
  onRowRef,
  onSelectRow,
  rows,
}: {
  activeRowId: string | null;
  onRowRef: (rowId: string, element: HTMLDivElement | null) => void;
  onSelectRow: (rowId: string) => void;
  rows: ExecutionTimelineRow[];
}) {
  if (rows.length === 0) {
    return (
      <section
        className="overflow-hidden rounded-xl border border-border/60 bg-background/60"
        data-testid="timeline-stage-panel"
      >
        <EmptyState
          icon={MessagesSquare}
          message="No visible timeline rows for this stage"
        />
      </section>
    );
  }

  return (
    <section
      className="overflow-hidden rounded-xl border border-border/60 bg-background/60"
      data-testid="timeline-stage-panel"
    >
      <div className="divide-y divide-border/60">
        {rows.map((row) => (
          <ExecutionTimelineRowView
            key={row.id}
            active={activeRowId === row.anchorId}
            onSelect={() => onSelectRow(row.anchorId)}
            row={row}
            rowRef={(element) => onRowRef(row.anchorId, element)}
          />
        ))}
      </div>
    </section>
  );
}

const ExecutionTimelineRowView = ({
  active,
  onSelect,
  row,
  rowRef,
}: {
  active: boolean;
  onSelect: () => void;
  row: ExecutionTimelineRow;
  rowRef: (element: HTMLDivElement | null) => void;
}) => {
  const badgeTone = badgeToneProps(row.tone);
  const preview = rowPreviewText(row);
  const detailMonospace =
    row.kind === "write" ||
    row.kind === "tool" ||
    row.detail?.includes("/") === true;

  return (
    <div
      ref={rowRef}
      className={cn("scroll-mt-36 bg-background/20", active && "bg-muted/38")}
      data-row-kind={row.kind}
      data-testid="timeline-row"
      id={row.anchorId}
      tabIndex={-1}
    >
      <button
        type="button"
        aria-expanded={active}
        className="grid w-full gap-3 px-2 py-2.5 text-left transition-colors hover:bg-muted/20 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
        data-testid="timeline-row-summary"
        onClick={onSelect}
      >
        <div className="flex items-center gap-2">
          <Badge
            variant={badgeTone.variant}
            className={cn("justify-center", badgeTone.className)}
          >
            {row.label}
          </Badge>
          {row.live ? (
            <Badge
              variant="outline"
              className="text-[10px] uppercase tracking-[0.08em]"
            >
              Live
            </Badge>
          ) : null}
        </div>

        <div className="min-w-0">
          <div
            className={cn(
              "line-clamp-2 text-sm leading-5 text-foreground/88 sm:line-clamp-1",
              active && "font-medium text-foreground",
            )}
          >
            {preview}
          </div>
        </div>

        <div className="grid gap-0.5 text-left text-[11px] text-muted-foreground sm:justify-items-end sm:text-right">
          <span>{formatTimestamp(row.at)}</span>
          {row.durationMs != null ? (
            <span>{formatDuration(row.durationMs)}</span>
          ) : null}
          {row.usage ? (
            <span className="font-mono leading-4 text-muted-foreground">
              {row.usage.label}
            </span>
          ) : null}
        </div>
      </button>

      {active ? (
        <div
          className="grid gap-2 px-2 pb-3 sm:pl-16 sm:pr-2"
          data-testid="timeline-row-details"
        >
          <ExecutionTimelineRowBody row={row} />
          {row.detail ? (
            <TextBlockView
              className="text-xs leading-6 text-muted-foreground"
              monospace={detailMonospace}
              value={row.detail}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

function ExecutionTimelineRowBody({ row }: { row: ExecutionTimelineRow }) {
  if (row.format === "markdown") {
    return (
      <StreamingMarkdown
        content={row.body}
        className="text-sm leading-6 text-foreground"
        preserveWhitespace
      />
    );
  }

  return (
    <TextBlockView
      className="text-sm leading-6"
      monospace={row.monospace}
      value={row.body}
    />
  );
}

function TimelineStatusBadge({ status }: { status: TraceSpanStatus }) {
  const badgeTone = badgeToneProps(toneForTraceStatus(status));

  return (
    <Badge variant={badgeTone.variant} className={badgeTone.className}>
      {formatLabel(status)}
    </Badge>
  );
}

function toneForTraceStatus(
  status: TraceSpanStatus,
): "success" | "warning" | "destructive" | "accent" | "outline" {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed" || status === "canceled") {
    return "destructive";
  }
  if (status === "running") {
    return "accent";
  }
  if (status === "warning") {
    return "warning";
  }
  return "outline";
}

function rowPreviewText(row: ExecutionTimelineRow): string {
  const title = rowSecondaryTitle(row);
  const bodyPreview = previewBodyText(row);
  const preview = title ? `${title} · ${bodyPreview}` : bodyPreview;
  return preview.length > 0 ? preview : row.label;
}

function rowSecondaryTitle(row: ExecutionTimelineRow): string | null {
  if (row.kind === "user" || row.kind === "agent" || row.kind === "session") {
    return null;
  }

  const title = row.title.trim();
  if (title.length === 0) {
    return null;
  }
  if (row.kind === "tool" && isGenericToolTitle(title)) {
    return null;
  }

  return normalizeRowText(title) === normalizeRowText(row.body) ? null : title;
}

function normalizeRowText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function compactPreviewText(
  value: string,
  format: ExecutionTimelineRow["format"],
): string {
  const normalized =
    format === "markdown" ? stripMarkdownForPreview(value) : value;
  return normalized.replace(/\s+/g, " ").trim();
}

function previewBodyText(row: ExecutionTimelineRow): string {
  const preview = compactPreviewText(row.body, row.format);
  if (row.kind === "tool" && row.label === "Bash") {
    return unwrapShellCommand(preview);
  }
  return preview;
}

function isGenericToolTitle(value: string): boolean {
  return /^tool call:\s+/iu.test(value.trim());
}

function unwrapShellCommand(value: string): string {
  const match = value
    .trim()
    .match(/^(?:\/bin\/)?(?:bash|zsh|sh)\s+-lc\s+(['"])([\s\S]+)\1$/u);
  return match?.[2]?.trim() || value;
}

function stripMarkdownForPreview(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^>\s+/gm, "");
}

function filterTimelineRows(
  rows: ExecutionTimelineRow[],
  showNotes: boolean,
): ExecutionTimelineRow[] {
  if (showNotes) {
    return rows;
  }
  return rows.filter((row) => row.kind !== "note");
}

function filterStageMapSegments(
  stageMap: ExecutionStageMap,
  visibleRows: ExecutionTimelineRow[],
): ExecutionStageMapSegment[] {
  const visibleRowIds = new Set(visibleRows.map((row) => row.anchorId));
  return stageMap.segments.filter((segment) =>
    visibleRowIds.has(segment.targetRowId),
  );
}

function segmentToneClassName(tone: ExecutionStageMapSegment["tone"]): string {
  switch (tone) {
    case "accent":
      return "bg-primary/22 hover:bg-primary/30";
    case "success":
      return "bg-success/24 hover:bg-success/32";
    case "warning":
      return "bg-warning/30 hover:bg-warning/38";
    case "destructive":
      return "bg-destructive/30 hover:bg-destructive/38";
    case "secondary":
      return "bg-muted-foreground/22 hover:bg-muted-foreground/30";
    case "outline":
    case "ghost":
    case "link":
    case "default":
    default:
      return "bg-border/90 hover:bg-muted";
  }
}
