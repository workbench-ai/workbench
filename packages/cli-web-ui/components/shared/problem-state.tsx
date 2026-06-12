import type { ReactNode } from "react";
import { AlertTriangleIcon } from "lucide-react";

import type { IconComponent } from "../../lib/icon-component";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../ui/empty";

export interface ProblemStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
}

export interface ProblemStateProps {
  icon?: IconComponent;
  eyebrow?: ReactNode;
  title: ReactNode;
  message?: ReactNode;
  statusCode?: number | string;
  meta?: ReactNode[];
  actions?: ProblemStateAction[];
  actionContent?: ReactNode;
  children?: ReactNode;
  scope?: "page" | "workspace" | "pane";
  align?: "center" | "start";
  className?: string;
}

const scopeClassName = {
  page: "mx-auto min-h-[min(34rem,calc(100dvh-7rem))] max-w-2xl",
  workspace: "min-h-[20rem]",
  pane: "min-h-[11rem] rounded-lg p-4",
} as const;

export function ProblemState({
  icon: Icon = AlertTriangleIcon,
  eyebrow,
  title,
  message,
  statusCode,
  meta,
  actions,
  actionContent,
  children,
  scope = "pane",
  align = "center",
  className,
}: ProblemStateProps) {
  const headerMeta = eyebrow ?? statusCode;

  return (
    <Empty
      className={cn(
        scopeClassName[scope],
        align === "start" && "items-start text-left",
        className,
      )}
      data-scope={scope}
    >
      <EmptyHeader className={cn(align === "start" && "items-start text-left")}>
        {headerMeta ? (
          <div className="text-xs font-medium uppercase text-muted-foreground">
            {headerMeta}
          </div>
        ) : null}
        <Icon aria-hidden="true" className="mb-2 size-4 shrink-0 text-foreground" />
        <EmptyTitle>{title}</EmptyTitle>
        {message ? <EmptyDescription>{message}</EmptyDescription> : null}
      </EmptyHeader>

      {meta?.length || actions?.length || actionContent || children ? (
        <EmptyContent className={cn(align === "start" && "items-start")}>
          {meta?.length ? (
            <div
              className={cn(
                "flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground",
                align === "center" && "justify-center",
              )}
            >
              {meta.map((item, index) => (
                <span key={typeof item === "string" ? item : index}>{item}</span>
              ))}
            </div>
          ) : null}
          {actions?.length ? (
            <div
              className={cn(
                "flex flex-wrap gap-2",
                align === "center" && "justify-center",
              )}
            >
              {actions.map((action) => (
                <ProblemStateButton action={action} key={action.label} />
              ))}
            </div>
          ) : null}
          {actionContent}
          {children}
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

function ProblemStateButton({ action }: { action: ProblemStateAction }) {
  const variant = action.variant ?? "outline";

  if (action.href) {
    return (
      <Button asChild size="sm" variant={variant}>
        <a href={action.href}>{action.label}</a>
      </Button>
    );
  }

  return (
    <Button
      onClick={action.onClick}
      size="sm"
      type="button"
      variant={variant}
    >
      {action.label}
    </Button>
  );
}
