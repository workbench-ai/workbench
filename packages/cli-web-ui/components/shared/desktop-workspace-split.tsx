import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";
import type { GroupImperativeHandle, Layout } from "react-resizable-panels";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../ui/resizable";

function clampPrimaryPercent(
  value: number,
  minPrimaryPercent: number,
  maxPrimaryPercent: number,
): number {
  return Math.min(
    maxPrimaryPercent,
    Math.max(minPrimaryPercent, value),
  );
}

interface DesktopWorkspaceSplitProps {
  paneOpen: boolean;
  primaryPercent: number;
  minPrimaryPercent: number;
  maxPrimaryPercent: number;
  onPrimaryPercentChange: (value: number) => void;
  primaryPane: ReactNode;
  secondaryPane: ReactNode;
  secondaryPaneId?: string;
  separatorLabel?: string;
  className?: string;
}

interface DesktopWorkspaceSplitToggleProps {
  paneOpen: boolean;
  onClick: () => void;
  openLabel: string;
  closeLabel: string;
  openText?: string;
  className?: string;
  testId?: string;
}

const PRIMARY_PANEL_ID = "workspace-primary-pane";

function asPercent(value: number): string {
  return `${value}%`;
}

export function buildDesktopWorkspaceSplitLayout({
  paneOpen,
  primaryPercent,
  minPrimaryPercent,
  maxPrimaryPercent,
  secondaryPaneId = "workspace-secondary-pane",
}: Pick<
  DesktopWorkspaceSplitProps,
  "paneOpen" | "primaryPercent" | "minPrimaryPercent" | "maxPrimaryPercent"
> & {
  secondaryPaneId?: string;
}): Layout {
  if (!paneOpen) {
    return {
      [PRIMARY_PANEL_ID]: 100,
      [secondaryPaneId]: 0,
    };
  }

  const resolvedPrimaryPercent = clampPrimaryPercent(
    primaryPercent,
    minPrimaryPercent,
    maxPrimaryPercent,
  );
  return {
    [PRIMARY_PANEL_ID]: resolvedPrimaryPercent,
    [secondaryPaneId]: 100 - resolvedPrimaryPercent,
  };
}

export function DesktopWorkspaceSplitToggle({
  paneOpen,
  onClick,
  openLabel,
  closeLabel,
  openText,
  className,
  testId,
}: DesktopWorkspaceSplitToggleProps) {
  const label = paneOpen ? closeLabel : openLabel;
  const visibleText = !paneOpen ? openText : undefined;
  const Icon = paneOpen ? PanelRightCloseIcon : PanelRightOpenIcon;

  return (
    <Button
      type="button"
      variant="ghost"
      size={visibleText ? "sm" : "icon-sm"}
      aria-label={label}
      title={label}
      className={className}
      data-testid={testId}
      onClick={onClick}
    >
      <Icon data-icon={visibleText ? "inline-start" : undefined} />
      {visibleText ? <span>{visibleText}</span> : <span className="sr-only">{label}</span>}
    </Button>
  );
}

export function DesktopWorkspaceSplit({
  paneOpen,
  primaryPercent,
  minPrimaryPercent,
  maxPrimaryPercent,
  onPrimaryPercentChange,
  primaryPane,
  secondaryPane,
  secondaryPaneId = "workspace-secondary-pane",
  separatorLabel = "Resize workspace pane",
  className,
}: DesktopWorkspaceSplitProps) {
  const groupRef = useRef<GroupImperativeHandle | null>(null);
  const layout = useMemo(
    () => buildDesktopWorkspaceSplitLayout({
      paneOpen,
      primaryPercent,
      minPrimaryPercent,
      maxPrimaryPercent,
      secondaryPaneId,
    }),
    [
      paneOpen,
      primaryPercent,
      minPrimaryPercent,
      maxPrimaryPercent,
      secondaryPaneId,
    ],
  );
  const resolvedPrimaryPercent = layout[PRIMARY_PANEL_ID] ?? 100;
  const resolvedSecondaryPercent = layout[secondaryPaneId] ?? 0;
  const primaryMinSize = paneOpen ? minPrimaryPercent : 100;
  const primaryMaxSize = paneOpen ? maxPrimaryPercent : 100;
  const secondaryMinSize = paneOpen ? 100 - maxPrimaryPercent : 0;
  const secondaryMaxSize = paneOpen ? 100 - minPrimaryPercent : 0;

  useEffect(() => {
    groupRef.current?.setLayout(layout);
  }, [layout]);

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      defaultLayout={layout}
      groupRef={groupRef}
      data-state={paneOpen ? "open" : "closed"}
      className={cn(
        "h-full min-h-0 min-w-0 overflow-hidden",
        "[&_[data-workspace-split-panel]]:transition-[flex-grow] [&_[data-workspace-split-panel]]:duration-200 [&_[data-workspace-split-panel]]:ease-linear",
        "motion-reduce:[&_[data-workspace-split-panel]]:transition-none",
        className,
      )}
      onLayoutChanged={(layout) => {
        if (!paneOpen) {
          return;
        }
        const nextPrimaryPercent = layout[PRIMARY_PANEL_ID];
        if (typeof nextPrimaryPercent !== "number") {
          return;
        }
        const clampedPercent = clampPrimaryPercent(
          nextPrimaryPercent,
          minPrimaryPercent,
          maxPrimaryPercent,
        );
        if (clampedPercent !== primaryPercent) {
          onPrimaryPercentChange(clampedPercent);
        }
      }}
    >
      <ResizablePanel
        id={PRIMARY_PANEL_ID}
        data-workspace-split-panel="primary"
        defaultSize={paneOpen ? asPercent(resolvedPrimaryPercent) : "100%"}
        minSize={asPercent(primaryMinSize)}
        maxSize={asPercent(primaryMaxSize)}
        className="min-h-0 min-w-0 overflow-hidden"
      >
        {primaryPane}
      </ResizablePanel>
      <ResizableHandle
        aria-controls={secondaryPaneId}
        aria-hidden={!paneOpen}
        aria-label={separatorLabel}
        disabled={!paneOpen}
        disableDoubleClick
        withHandle={paneOpen}
        className={cn(
          "transition-opacity duration-200 ease-linear motion-reduce:transition-none",
          paneOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <ResizablePanel
        id={secondaryPaneId}
        data-workspace-split-panel="secondary"
        defaultSize={paneOpen ? asPercent(resolvedSecondaryPercent) : "0%"}
        minSize={asPercent(secondaryMinSize)}
        maxSize={asPercent(secondaryMaxSize)}
        collapsible
        collapsedSize="0%"
        className="min-h-0 min-w-0 overflow-hidden"
      >
        <div
          data-state={paneOpen ? "open" : "closed"}
          aria-hidden={!paneOpen}
          inert={!paneOpen ? true : undefined}
          className={cn(
            "h-full min-h-0 min-w-0 overflow-hidden transition-opacity duration-150 ease-linear motion-reduce:transition-none",
            paneOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          {secondaryPane}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
