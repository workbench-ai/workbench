import { useMemo, useRef, type ComponentProps } from "react";
import type { TraceSpanStatus } from "@workbench-ai/agent-driver";

import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import {
  formatDuration,
  formatLabel,
  formatTimestamp,
  type ExecutionTraceTranscript,
  type ExecutionTranscriptGroup,
  type ExecutionTranscriptRow,
} from "../../lib/execution-trace-transcript";
import { StreamingMarkdown } from "./streaming-markdown";
import { TextBlockView } from "./text-block-view";
import { VirtualizedListContent } from "./virtualized-list";
import { Badge } from "../ui/badge";
import { Bubble, BubbleContent } from "../ui/bubble";
import { Button } from "../ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "../ui/marker";
import { Message, MessageContent } from "../ui/message";
import { badgeToneProps } from "../../lib/badge";
import { cn } from "../../lib/utils";

const TRANSCRIPT_BODY_COLLAPSE_CHARS = 1_400;
const TRANSCRIPT_BODY_COLLAPSE_LINES = 18;
const TRANSCRIPT_VIRTUALIZE_THRESHOLD = 36;

type TranscriptFeedItem =
  | { kind: "group"; key: string; group: ExecutionTranscriptGroup }
  | { kind: "row"; key: string; row: ExecutionTranscriptRow };

export interface TranscriptFeedProps {
  transcript: ExecutionTraceTranscript;
}

export function TranscriptFeed({
  transcript,
}: TranscriptFeedProps) {
  const groups = transcript.groups;
  const items = useMemo(() => flattenTranscriptItems(groups), [groups]);
  const virtualized = items.length > TRANSCRIPT_VIRTUALIZE_THRESHOLD;
  const viewportRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      className="flex min-h-0 min-w-0 flex-col"
      data-testid="transcript-tab"
      data-virtualized={virtualized ? "true" : "false"}
    >
      <div
        aria-label="Execution transcript"
        data-slot="message-scroller"
        role="region"
        className={cn(
          "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
          "min-w-0",
          virtualized
            ? "h-[clamp(22rem,calc(100vh-18rem),58rem)]"
            : "h-auto w-full overflow-visible",
        )}
      >
        <div
          aria-label="Transcript messages"
          data-slot="message-scroller-viewport"
          role="log"
          ref={viewportRef}
          className={cn(
            "size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content",
            "[overflow-anchor:none]",
            virtualized ? "scroll-fade-y" : "h-auto overflow-visible",
          )}
          data-testid="transcript-viewport"
        >
          <div
            className="flex h-max min-h-full flex-col gap-0 [overflow-anchor:none]"
            data-slot="message-scroller-content"
            data-testid="transcript-feed"
          >
            <VirtualizedListContent
              items={items}
              getScrollElement={() => viewportRef.current}
              getItemKey={(item) => item.key}
              renderItem={(item, index) => (
                <div
                  className="min-w-0 shrink-0"
                  data-message-id={item.key}
                  data-scroll-anchor={item.kind === "row" ? "true" : "false"}
                  data-slot="message-scroller-item"
                >
                  <TranscriptFeedItemView
                    item={item}
                    last={index === items.length - 1}
                  />
                </div>
              )}
              estimateSize={estimateTranscriptItemSize}
              gap={0}
              overscan={8}
              virtualizeThreshold={TRANSCRIPT_VIRTUALIZE_THRESHOLD}
              contentClassName="min-h-full"
              measureKey={`${transcript.id}:${items.length}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function flattenTranscriptItems(
  groups: readonly ExecutionTranscriptGroup[],
): TranscriptFeedItem[] {
  const items: TranscriptFeedItem[] = [];
  const showHeader = groups.length > 1;
  for (const group of groups) {
    if (showHeader) {
      items.push({ kind: "group", key: `group:${group.id}`, group });
    }
    for (const row of group.rows) {
      items.push({
        kind: "row",
        key: `row:${group.id}:${row.id}`,
        row,
      });
    }
  }
  return items;
}

function estimateTranscriptItemSize(item: TranscriptFeedItem): number {
  if (item.kind === "group") {
    return 52;
  }
  const row = item.row;
  const body = row.body?.text ?? "";
  const detail = row.detail ?? "";
  let estimate = rowPreviewText(row) ? 116 : 96;
  if (body.trim()) {
    estimate += shouldCollapseTranscriptBody(body)
      ? 360
      : Math.min(300, Math.max(56, estimatedTextHeight(body)));
  }
  if (detail.trim()) {
    estimate += Math.min(160, Math.max(28, estimatedTextHeight(detail, 110)));
  }
  return estimate;
}

function estimatedTextHeight(value: string, charsPerLine = 88): number {
  const explicitLines = value.split(/\r\n|\n|\r/u).length;
  const wrappedLines = Math.ceil(value.length / charsPerLine);
  return Math.max(explicitLines, wrappedLines) * 24;
}

function TranscriptFeedItemView({
  item,
  last,
}: {
  item: TranscriptFeedItem;
  last: boolean;
}) {
  if (item.kind === "group") {
    return <TranscriptGroupHeader group={item.group} />;
  }
  return <TranscriptRowView row={item.row} last={last} />;
}

function TranscriptGroupHeader({
  group,
}: {
  group: ExecutionTranscriptGroup;
}) {
  return (
    <section
      className="flex min-w-0 flex-wrap items-start justify-between gap-3 py-2"
      data-testid="transcript-group"
    >
      <div className="min-w-0">
        <h4 className="min-w-0 text-sm font-medium text-foreground whitespace-normal break-words [overflow-wrap:anywhere]">
          {group.title}
        </h4>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatTimestamp(group.startedAt ?? null)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        {group.status ? <TranscriptStatusBadge status={group.status} /> : null}
        {group.durationMs && group.durationMs > 0 ? (
          <span className="whitespace-nowrap">
            {formatDuration(group.durationMs)}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function TranscriptRowView({ row, last }: { row: ExecutionTranscriptRow; last: boolean }) {
  const badgeTone = badgeToneProps(row.tone);
  const preview = rowPreviewText(row);
  const detailMonospace =
    row.kind === "file" ||
    row.kind === "tool" ||
    row.detail?.includes("/") === true;

  return (
    <Marker
      asChild
      variant="border"
      className={cn(
        "grid min-w-0 items-stretch gap-2 py-3 text-foreground",
        last && "border-b-0",
      )}
    >
      <article
        data-row-kind={row.kind}
        data-testid="transcript-row"
      >
        <div
          className={cn(
            "min-w-0 gap-3",
            preview
              ? "grid sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start"
              : "flex flex-wrap items-start justify-between gap-y-1",
          )}
          data-testid="transcript-row-summary"
        >
          <MarkerIcon className="flex size-auto items-center gap-2">
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
          </MarkerIcon>

          {preview ? (
            <MarkerContent className="min-w-0 text-sm leading-5 text-foreground/88 whitespace-normal break-words [overflow-wrap:anywhere]">
              {preview}
            </MarkerContent>
          ) : null}

          <div
            className={cn(
              "grid gap-0.5 text-left text-[11px] text-muted-foreground",
              preview ? "sm:justify-items-end sm:text-right" : "ml-auto justify-items-end text-right",
            )}
          >
            <span>{formatTimestamp(row.at ?? null)}</span>
            {row.durationMs != null ? (
              <span>{formatDuration(row.durationMs)}</span>
            ) : null}
            {row.usage ? (
              <span className="font-mono leading-4 text-muted-foreground">
                {row.usage}
              </span>
            ) : null}
          </div>
        </div>

        <div
          className="grid min-w-0 gap-2 sm:pl-16"
          data-testid="transcript-row-details"
        >
          <TranscriptRowBody row={row} />
          {row.detail ? (
            <TextBlockView
              className="text-xs leading-6 text-muted-foreground"
              monospace={detailMonospace}
              value={row.detail}
            />
          ) : null}
        </div>
      </article>
    </Marker>
  );
}

function TranscriptRowBody({ row }: { row: ExecutionTranscriptRow }) {
  const body = row.body?.text ?? "";
  if (!body.trim()) {
    return null;
  }
  if (shouldCollapseTranscriptBody(body)) {
    return (
      <Collapsible className="group/transcript-body grid min-w-0 gap-2" data-testid="transcript-row-body-collapsible">
        <div className="max-h-72 min-w-0 overflow-hidden [mask-image:linear-gradient(to_bottom,black_72%,transparent)] group-data-[state=open]/transcript-body:hidden">
          <TranscriptRowMessage row={row} />
        </div>
        <CollapsibleContent>
          <TranscriptRowMessage row={row} />
        </CollapsibleContent>
        <CollapsibleTrigger asChild>
          <Button
            className="w-fit px-0 text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent"
            size="sm"
            type="button"
            variant="ghost"
          >
            <span className="group-data-[state=open]/transcript-body:hidden">Show more</span>
            <span className="hidden group-data-[state=open]/transcript-body:inline">Show less</span>
            <ChevronDownIcon
              className="group-data-[state=open]/transcript-body:hidden"
            />
            <ChevronUpIcon
              className="hidden group-data-[state=open]/transcript-body:block"
            />
          </Button>
        </CollapsibleTrigger>
      </Collapsible>
    );
  }

  return <TranscriptRowMessage row={row} />;
}

function TranscriptRowMessage({ row }: { row: ExecutionTranscriptRow }) {
  const align = row.kind === "user" ? "end" : "start";
  return (
    <Message align={align}>
      <MessageContent>
        <Bubble
          align={align}
          className={cn(row.kind === "user" ? "max-w-[min(44rem,90%)]" : "max-w-full")}
          variant={bubbleVariantForRow(row)}
        >
          <BubbleContent className={cn(row.kind === "assistant" ? "w-full" : undefined)}>
            <TranscriptRowBodyContent row={row} />
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function TranscriptRowBodyContent({ row }: { row: ExecutionTranscriptRow }) {
  const body = row.body;
  if (!body) {
    return null;
  }
  if (body.format === "markdown") {
    return (
      <StreamingMarkdown
        content={body.text}
        className="text-sm leading-6 text-foreground"
        preserveWhitespace
      />
    );
  }

  return (
    <TextBlockView
      className="text-sm leading-6"
      monospace={row.monospace ?? (row.kind === "tool" || row.kind === "file")}
      value={body.text}
    />
  );
}

function shouldCollapseTranscriptBody(value: string): boolean {
  if (value.length > TRANSCRIPT_BODY_COLLAPSE_CHARS) {
    return true;
  }
  return value.split(/\r\n|\n|\r/u).length > TRANSCRIPT_BODY_COLLAPSE_LINES;
}

function bubbleVariantForRow(row: ExecutionTranscriptRow): ComponentProps<typeof Bubble>["variant"] {
  if (row.kind === "user") {
    return "secondary";
  }
  if (row.kind === "assistant") {
    return "ghost";
  }
  if (row.kind === "error") {
    return "destructive";
  }
  if (row.kind === "system" || row.kind === "session") {
    return "muted";
  }
  return "outline";
}

function TranscriptStatusBadge({ status }: { status: TraceSpanStatus }) {
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

function rowPreviewText(row: ExecutionTranscriptRow): string | null {
  if (row.kind === "user" || row.kind === "assistant" || row.kind === "session") {
    return null;
  }
  const title = row.title.trim();
  const body = row.body?.text.trim() ?? "";
  const preview = title && normalizePreviewText(title) !== normalizePreviewText(body)
    ? title
    : body;
  if (!preview) {
    return null;
  }
  const compact = normalizePreviewText(preview);
  return compact.length <= 240 ? compact : `${compact.slice(0, 240).trim()}...`;
}

function normalizePreviewText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
