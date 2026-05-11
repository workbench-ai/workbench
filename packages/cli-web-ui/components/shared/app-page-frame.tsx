import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

interface AppPageFrameProps {
  children: ReactNode;
  header?: ReactNode;
  mainClassName?: string;
  containerClassName?: string;
  mainId?: string;
  skipLinkLabel?: string;
  className?: string;
}

export function AppPageFrame({
  children,
  header,
  mainClassName,
  containerClassName,
  mainId,
  skipLinkLabel,
  className,
}: AppPageFrameProps) {
  const skipTargetId = skipLinkLabel ? (mainId ?? "main-content") : mainId;

  return (
    <div className={cn("min-h-screen bg-background px-2 pb-4 pt-4 sm:px-4 sm:pb-6 sm:pt-5", className)}>
      {skipLinkLabel && skipTargetId ? (
        <a
          href={`#${skipTargetId}`}
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          {skipLinkLabel}
        </a>
      ) : null}
      <div
        className={cn(
          "mx-auto flex min-h-[calc(100dvh-2rem)] max-w-[1400px] flex-col gap-4 sm:min-h-[calc(100dvh-2.75rem)]",
          containerClassName,
        )}
      >
        {header ? <header>{header}</header> : null}
        <main
          id={skipTargetId}
          tabIndex={skipTargetId ? -1 : undefined}
          className={cn("flex min-h-0 flex-1 flex-col gap-4", mainClassName)}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
