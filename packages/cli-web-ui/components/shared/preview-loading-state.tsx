import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";

export function PreviewLoadingState({
  label = "Preview pending.",
  testId = "preview-loading-state",
  className,
}: {
  label?: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex min-w-0 flex-col py-2", className)}
      aria-busy="true"
      aria-label={typeof label === "string" ? label : undefined}
      data-testid={testId}
    >
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

export function PreviewRendererLoadingState({
  label,
  testId,
  expanded = false,
}: {
  label: ReactNode;
  testId: string;
  expanded?: boolean;
}) {
  if (expanded) {
    return (
      <div
        className="flex h-full min-h-0 items-center justify-center px-6"
        aria-busy="true"
        aria-label={typeof label === "string" ? label : undefined}
        data-testid={testId}
      >
        <span className="sr-only">{label}</span>
        <Skeleton className="h-64 w-full max-w-3xl" />
      </div>
    );
  }

  return (
    <div
      className="flex min-w-0 flex-col"
      aria-busy="true"
      aria-label={typeof label === "string" ? label : undefined}
      data-testid={testId}
    >
      <span className="sr-only">{label}</span>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
