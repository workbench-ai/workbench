import type { ReactNode } from "react";
import type { IconComponent } from "../../lib/icon-component";
import { cn } from "../../lib/utils";
import { ProblemState } from "./problem-state";

interface EmptyStateProps {
  icon: IconComponent;
  message: string;
  title?: string;
  eyebrow?: string;
  meta?: string[];
  size?: "sm" | "md" | "lg";
  variant?: "minimal" | "hero";
  align?: "center" | "start";
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const sizeClassName = {
  sm: "",
  md: "min-h-[13rem]",
  lg: "min-h-[16rem]",
} as const;

export function EmptyState({
  icon: Icon,
  message,
  title,
  eyebrow,
  meta,
  size = "sm",
  variant = "minimal",
  align = "center",
  actions,
  children,
  className,
}: EmptyStateProps) {
  return (
    <ProblemState
      actionContent={actions}
      align={align}
      className={cn(sizeClassName[size], className)}
      eyebrow={eyebrow}
      icon={Icon}
      message={title ? message : undefined}
      meta={meta}
      scope={variant === "hero" ? "workspace" : "pane"}
      title={title ?? message}
    >
      {children}
    </ProblemState>
  );
}
