import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

interface WorkspaceRootProps {
  children: ReactNode;
  header?: ReactNode;
  mainId?: string;
  skipLinkLabel?: string;
  className?: string;
  headerClassName?: string;
  mainClassName?: string;
}

export function WorkspaceRoot({
  children,
  header,
  mainId,
  skipLinkLabel,
  className,
  headerClassName,
  mainClassName,
}: WorkspaceRootProps) {
  const skipTargetId = skipLinkLabel ? (mainId ?? "main-content") : mainId;

  return (
    <div className={cn("h-svh w-full min-w-0 max-w-full overflow-hidden bg-background", className)}>
      {skipLinkLabel && skipTargetId ? (
        <a
          href={`#${skipTargetId}`}
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          {skipLinkLabel}
        </a>
      ) : null}
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
        {header ? (
          <header
            className={cn(
              "shrink-0 border-b border-border/60 px-4 py-3 sm:px-5",
              headerClassName,
            )}
          >
            {header}
          </header>
        ) : null}
        <main
          id={skipTargetId}
          tabIndex={skipTargetId ? -1 : undefined}
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            mainClassName,
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
