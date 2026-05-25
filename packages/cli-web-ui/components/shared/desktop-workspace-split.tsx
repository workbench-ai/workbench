import { useEffect, useRef, type ReactNode } from "react";
import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";
import type { PanelImperativeHandle } from "react-resizable-panels";

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
  const primaryPanelRef = useRef<PanelImperativeHandle | null>(null);
  const secondaryPanelRef = useRef<PanelImperativeHandle | null>(null);
  const resolvedPrimaryPercent = clampPrimaryPercent(
    primaryPercent,
    minPrimaryPercent,
    maxPrimaryPercent,
  );
  const resolvedSecondaryPercent = 100 - resolvedPrimaryPercent;

  useEffect(() => {
    const primaryPanel = primaryPanelRef.current;
    const secondaryPanel = secondaryPanelRef.current;
    if (!primaryPanel || !secondaryPanel) {
      return;
    }

    if (paneOpen) {
      if (secondaryPanel.isCollapsed()) {
        secondaryPanel.expand();
      }
      primaryPanel.resize(asPercent(resolvedPrimaryPercent));
      return;
    }

    if (!secondaryPanel.isCollapsed()) {
      secondaryPanel.collapse();
    }
    primaryPanel.resize("100%");
  }, [paneOpen, resolvedPrimaryPercent]);

  return (
    <ResizablePanelGroup
      orientation="horizontal"
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
        panelRef={primaryPanelRef}
        defaultSize={paneOpen ? asPercent(resolvedPrimaryPercent) : "100%"}
        minSize={paneOpen ? asPercent(minPrimaryPercent) : "100%"}
        maxSize={paneOpen ? asPercent(maxPrimaryPercent) : "100%"}
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
        panelRef={secondaryPanelRef}
        defaultSize={paneOpen ? asPercent(resolvedSecondaryPercent) : "0%"}
        minSize={asPercent(100 - maxPrimaryPercent)}
        maxSize={asPercent(100 - minPrimaryPercent)}
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
