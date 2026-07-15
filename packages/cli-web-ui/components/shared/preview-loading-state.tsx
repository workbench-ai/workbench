import type { ReactNode } from "react";

import { Skeleton } from "../ui/skeleton";

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
