import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Card, CardContent } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";

export function PreviewLoadingState({
  label = "Loading preview...",
  testId = "preview-loading-state",
  className,
}: {
  label?: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("rounded-md border border-border p-4", className)}
      data-testid={testId}
    >
      <PreviewLoadingLabel>{label}</PreviewLoadingLabel>
      <div className="mt-4 grid gap-3">
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
        data-testid={testId}
      >
        <PreviewLoadingLabel>{label}</PreviewLoadingLabel>
      </div>
    );
  }

  return (
    <div className="grid gap-3" data-testid={testId}>
      <Card size="sm">
        <CardContent className="py-0 text-sm text-muted-foreground">
          <PreviewLoadingLabel>{label}</PreviewLoadingLabel>
        </CardContent>
      </Card>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function PreviewLoadingLabel({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      {children}
    </span>
  );
}
