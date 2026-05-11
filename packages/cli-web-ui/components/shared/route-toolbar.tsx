import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

interface RouteToolbarProps {
  breadcrumbs?: ReactNode;
  title?: ReactNode;
  leading?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function RouteToolbar({
  breadcrumbs,
  title,
  leading,
  badges,
  actions,
  children,
  className,
}: RouteToolbarProps) {
  return (
    <div className={cn("grid gap-3", className)} data-testid="route-toolbar">
      <div className="flex min-w-0 flex-row flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
          {breadcrumbs || title ? (
            <div className="min-w-0 flex-1">
              <div className="grid gap-1.5">
                {breadcrumbs ? (
                  <div className="min-w-0">
                    {breadcrumbs}
                  </div>
                ) : null}
                {title ? (
                  <h1 className="truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                    {title}
                  </h1>
                ) : null}
              </div>
            </div>
          ) : null}
          {leading ? (
            <div className="flex min-h-9 min-w-0 shrink-0 items-center">
              {leading}
            </div>
          ) : null}
        </div>
        {(badges || actions) ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {badges}
            {actions}
          </div>
        ) : null}
      </div>
      {children ? <div className="min-w-0">{children}</div> : null}
    </div>
  );
}
