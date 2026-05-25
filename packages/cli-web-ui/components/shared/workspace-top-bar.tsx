import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

interface WorkspaceTopBarProps {
  brand: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function WorkspaceTopBar({
  brand,
  actions,
  className,
  contentClassName,
}: WorkspaceTopBarProps) {
  return (
    <div
      className={cn(
        "flex h-9 w-full min-w-0 items-center justify-between gap-3",
        className,
      )}
      data-testid="workspace-top-bar"
    >
      <div className={cn("flex min-w-0 items-center", contentClassName)}>{brand}</div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
