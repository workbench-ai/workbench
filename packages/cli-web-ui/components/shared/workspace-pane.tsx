import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { RouteToolbar } from "./route-toolbar";
import { ViewportScrollArea } from "./viewport-scroll-area";

interface WorkspacePaneProps {
  breadcrumbs?: ReactNode;
  title?: ReactNode;
  leading?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  summary?: ReactNode;
  subnav?: ReactNode;
  tone?: "primary" | "secondary";
  scrollBody?: boolean;
  hideHeader?: boolean;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  children: ReactNode;
}

export function WorkspacePane({
  breadcrumbs,
  title,
  leading,
  badges,
  actions,
  summary,
  subnav,
  tone = "primary",
  scrollBody = true,
  hideHeader = false,
  className,
  headerClassName,
  contentClassName,
  children,
}: WorkspacePaneProps) {
  const isSecondaryTone = tone === "secondary";

  return (
    <div
      data-pane-tone={tone}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
        isSecondaryTone ? "bg-muted/20" : "bg-background",
        className,
      )}
    >
      {!hideHeader ? (
        <div
          className={cn(
            "border-b border-border/60 px-4 py-3 sm:px-5 sm:py-4",
            isSecondaryTone ? "bg-muted/35" : "bg-background",
            headerClassName,
          )}
        >
          <div className="grid gap-3">
            <RouteToolbar
              breadcrumbs={breadcrumbs}
              title={title}
              leading={leading}
              badges={badges}
              actions={actions}
              className="gap-2"
            >
              {summary}
            </RouteToolbar>
            {subnav ? <div className="min-w-0">{subnav}</div> : null}
          </div>
        </div>
      ) : null}
      {scrollBody ? (
        <ViewportScrollArea
          className="min-h-0 flex-1"
          viewportClassName="h-full min-w-0"
        >
          <div className={cn("grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-6 p-4 sm:p-5", contentClassName)}>
            {children}
          </div>
        </ViewportScrollArea>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <div
            className={cn(
              "grid h-full w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-6 p-4 sm:p-5",
              contentClassName,
            )}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
