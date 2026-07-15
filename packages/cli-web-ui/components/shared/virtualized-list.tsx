import { useEffect, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { cn } from "../../lib/utils";

type VirtualizedItemKey = string | number;
type VirtualizedScrollAlign = "auto" | "center" | "end" | "start";

interface VirtualizedListContentProps<T> {
  items: readonly T[];
  getScrollElement: () => HTMLElement | null;
  getItemKey: (item: T, index: number) => VirtualizedItemKey;
  renderItem: (item: T, index: number) => ReactNode;
  estimateSize?: (item: T, index: number) => number;
  overscan?: number;
  gap?: number;
  virtualizeThreshold?: number;
  contentClassName?: string;
  itemClassName?: string | ((item: T, index: number) => string | undefined);
  topPadding?: number;
  bottomPadding?: number;
  measureKey?: string | number | null;
  scrollToIndex?: number | null;
  scrollToIndexAlign?: VirtualizedScrollAlign;
  scrollToIndexKey?: string | number | null;
}

const DEFAULT_ESTIMATE_SIZE_PX = 88;
const DEFAULT_OVERSCAN = 8;
const DEFAULT_GAP_PX = 12;
const DEFAULT_VIRTUALIZE_THRESHOLD = 24;

export function VirtualizedListContent<T>({
  items,
  getScrollElement,
  getItemKey,
  renderItem,
  estimateSize,
  overscan = DEFAULT_OVERSCAN,
  gap = DEFAULT_GAP_PX,
  virtualizeThreshold = DEFAULT_VIRTUALIZE_THRESHOLD,
  contentClassName,
  itemClassName,
  topPadding = 0,
  bottomPadding = 0,
  measureKey = null,
  scrollToIndex = null,
  scrollToIndexAlign = "center",
  scrollToIndexKey = null,
}: VirtualizedListContentProps<T>) {
  const shouldVirtualize = items.length > virtualizeThreshold;
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement,
    getItemKey: (index) => {
      const item = items[index];
      return item ? getItemKey(item, index) : index;
    },
    estimateSize: (index) => {
      const item = items[index];
      return item
        ? (estimateSize?.(item, index) ?? DEFAULT_ESTIMATE_SIZE_PX)
        : DEFAULT_ESTIMATE_SIZE_PX;
    },
    overscan,
    gap,
  });
  const getScrollElementRef = useRef(getScrollElement);
  const virtualizerRef = useRef(virtualizer);
  const scrollToIndexRef = useRef(scrollToIndex);
  const resolvedScrollToIndexKey = scrollToIndexKey ?? measureKey ?? scrollToIndex;
  getScrollElementRef.current = getScrollElement;
  virtualizerRef.current = virtualizer;
  scrollToIndexRef.current = scrollToIndex;

  useEffect(() => {
    if (shouldVirtualize) {
      virtualizer.measure();
    }
  }, [measureKey, shouldVirtualize, items.length, virtualizer]);

  useEffect(() => {
    const targetIndex = scrollToIndexRef.current;
    if (!shouldVirtualize || targetIndex == null) {
      return;
    }
    const scroll = () => {
      if (getScrollElementRef.current()) {
        virtualizerRef.current.scrollToIndex(targetIndex, { align: scrollToIndexAlign });
      }
    };
    scroll();
    const timeoutId = window.setTimeout(scroll, 0);
    return () => window.clearTimeout(timeoutId);
  }, [resolvedScrollToIndexKey, scrollToIndexAlign, shouldVirtualize]);

  if (!shouldVirtualize) {
    return (
      <div
        className={cn("grid w-full min-w-0 auto-rows-max content-start", contentClassName)}
        style={{ rowGap: `${gap}px`, paddingTop: `${topPadding}px`, paddingBottom: `${bottomPadding}px` }}
      >
        {items.map((item, index) => (
          <div
            key={getItemKey(item, index)}
            data-virtualized-item-key={String(getItemKey(item, index))}
            className={cn("min-w-0", resolveItemClassName(itemClassName, item, index))}
          >
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn("relative min-h-full w-full", contentClassName)}
      style={{ height: `${virtualizer.getTotalSize() + topPadding + bottomPadding}px` }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const item = items[virtualItem.index];
        return item ? (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            data-virtualized-item-key={String(virtualItem.key)}
            className={cn("absolute left-0 top-0 w-full min-w-0", resolveItemClassName(itemClassName, item, virtualItem.index))}
            style={{ transform: `translateY(${virtualItem.start + topPadding}px)` }}
          >
            {renderItem(item, virtualItem.index)}
          </div>
        ) : null;
      })}
    </div>
  );
}

function resolveItemClassName<T>(
  itemClassName: string | ((item: T, index: number) => string | undefined) | undefined,
  item: T,
  index: number,
): string | undefined {
  return typeof itemClassName === "function" ? itemClassName(item, index) : itemClassName;
}
