import { MessagesSquare } from "lucide-react";

import type {
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
import { badgeToneProps } from "../../lib/badge";
import { cn } from "../../lib/utils";

export interface ExecutionTraceTimelineProps {
  executionTimeline: ExecutionTimeline;
  layout?: "fill" | "content";
  className?: string;
}

export function ExecutionTraceTimeline({
  className,
  executionTimeline,
  layout = "fill",
}: ExecutionTraceTimelineProps) {
  const groups = executionTimeline.groups;

  if (groups.length === 0) {
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
          message="No timeline evidence recorded."
        />
      </div>
    );
  }

  return (
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
        <div className="grid gap-4" data-testid="timeline-feed">
          {groups.map((group) => (
            <ExecutionTimelineGroupSection
              key={group.id}
              group={group}
              showHeader={groups.length > 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ExecutionTimelineGroupSection({
  group,
  showHeader,
}: {
  group: ExecutionTimelineGroup;
  showHeader: boolean;
}) {
  return (
    <section className="grid min-w-0 gap-2" data-testid="timeline-stage">
      {showHeader ? (
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="min-w-0 text-sm font-medium text-foreground whitespace-normal break-words [overflow-wrap:anywhere]">
              {group.title}
            </h4>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatTimestamp(group.startedAt)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {group.status ? <TimelineStatusBadge status={group.status} /> : null}
            {group.durationMs > 0 ? (
              <span className="whitespace-nowrap">
                {formatDuration(group.durationMs)}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <ExecutionTimelineStagePanel rows={group.rows} />
    </section>
  );
}

function ExecutionTimelineStagePanel({
  rows,
}: {
  rows: ExecutionTimelineRow[];
}) {
  if (rows.length === 0) {
    return (
      <section data-testid="timeline-stage-panel">
        <EmptyState
          icon={MessagesSquare}
          message="No timeline rows for this stage"
        />
      </section>
    );
  }

  return (
    <section
      className="min-w-0 divide-y divide-border/60"
      data-testid="timeline-stage-panel"
    >
      {rows.map((row) => (
        <ExecutionTimelineRowView key={row.id} row={row} />
      ))}
    </section>
  );
}

function ExecutionTimelineRowView({ row }: { row: ExecutionTimelineRow }) {
  const badgeTone = badgeToneProps(row.tone);
  const preview = rowPreviewText(row);
  const detailMonospace =
    row.kind === "write" ||
    row.kind === "tool" ||
    row.detail?.includes("/") === true;

  return (
    <article
      className="grid min-w-0 gap-2 py-3 first:pt-0 last:pb-0"
      data-row-kind={row.kind}
      data-testid="timeline-row"
      id={row.anchorId}
    >
      <div
        className="grid min-w-0 gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start"
        data-testid="timeline-row-summary"
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

        <div className="min-w-0 text-sm leading-5 text-foreground/88 whitespace-normal break-words [overflow-wrap:anywhere]">
          {preview}
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
      </div>

      <div
        className="grid min-w-0 gap-2 sm:pl-16"
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
    </article>
  );
}

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
