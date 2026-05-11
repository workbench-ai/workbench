import { useEffect, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { cn } from "../../lib/utils";
import { ViewportScrollArea } from "./viewport-scroll-area";

type VirtualizedItemKey = string | number;

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
}

interface VirtualizedScrollAreaListProps<T>
  extends Omit<VirtualizedListContentProps<T>, "getScrollElement"> {
  className?: string;
  viewportClassName?: string;
  testId?: string;
  viewportTestId?: string;
  hideScrollbar?: boolean;
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

  useEffect(() => {
    if (!shouldVirtualize) {
      return;
    }
    virtualizer.measure();
  }, [measureKey, shouldVirtualize, items.length, virtualizer]);

  if (!shouldVirtualize) {
    return (
      <div
        className={cn(
          "grid w-full min-w-0 auto-rows-max content-start",
          contentClassName,
        )}
        style={{
          rowGap: `${gap}px`,
          paddingTop: `${topPadding}px`,
          paddingBottom: `${bottomPadding}px`,
        }}
      >
        {items.map((item, index) => (
          <div
            key={getItemKey(item, index)}
            className={cn(
              "min-w-0",
              resolveItemClassName(itemClassName, item, index),
            )}
          >
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      className={cn("relative min-h-full w-full", contentClassName)}
      style={{
        height: `${virtualizer.getTotalSize() + topPadding + bottomPadding}px`,
      }}
    >
      {virtualItems.map((virtualItem) => {
        const item = items[virtualItem.index];
        if (!item) {
          return null;
        }

        return (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            className={cn(
              "absolute left-0 top-0 w-full min-w-0",
              resolveItemClassName(itemClassName, item, virtualItem.index),
            )}
            style={{
              transform: `translateY(${virtualItem.start + topPadding}px)`,
            }}
          >
            {renderItem(item, virtualItem.index)}
          </div>
        );
      })}
    </div>
  );
}

export function VirtualizedScrollAreaList<T>({
  items,
  getItemKey,
  renderItem,
  estimateSize,
  overscan,
  gap,
  virtualizeThreshold,
  contentClassName,
  itemClassName,
  topPadding,
  bottomPadding,
  measureKey,
  className,
  viewportClassName,
  testId,
  viewportTestId,
  hideScrollbar = false,
}: VirtualizedScrollAreaListProps<T>) {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  return (
    <ViewportScrollArea
      className={cn("h-full min-h-0 min-w-0 w-full", className)}
      data-testid={testId}
      hideScrollbar={hideScrollbar}
      viewportClassName={cn("h-full min-w-0", viewportClassName)}
      viewportRef={viewportRef}
      viewportTestId={viewportTestId}
    >
      <VirtualizedListContent
        items={items}
        getScrollElement={() => viewportRef.current}
        getItemKey={getItemKey}
        renderItem={renderItem}
        estimateSize={estimateSize}
        overscan={overscan}
        gap={gap}
        virtualizeThreshold={virtualizeThreshold}
        contentClassName={contentClassName}
        itemClassName={itemClassName}
        topPadding={topPadding}
        bottomPadding={bottomPadding}
        measureKey={measureKey}
      />
    </ViewportScrollArea>
  );
}

function resolveItemClassName<T>(
  itemClassName:
    | string
    | ((item: T, index: number) => string | undefined)
    | undefined,
  item: T,
  index: number,
): string | undefined {
  if (typeof itemClassName === "function") {
    return itemClassName(item, index);
  }
  return itemClassName;
}
