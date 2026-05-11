import type { ReactNode } from "react";
import type { IconComponent } from "../../lib/icon-component";
import { cn } from "../../lib/utils";

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

const iconSizeMap = {
  sm: "size-5 stroke-[1.55]",
  md: "size-6 stroke-[1.45]",
  lg: "size-7 stroke-[1.35]",
} as const;

const paddingMap = {
  hero: { sm: "px-0 py-6", md: "px-0 py-6", lg: "px-0 py-8 sm:py-10" },
  minimal: { sm: "px-0 py-2", md: "px-0 py-4", lg: "px-0 py-6" },
} as const;

const titleSizeMap = {
  hero: { sm: "text-lg", md: "text-lg", lg: "text-[1.35rem] sm:text-[1.5rem]" },
  minimal: { sm: "text-sm", md: "text-base", lg: "text-lg" },
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
  const isHero = variant === "hero";
  const iconSize = iconSizeMap[size];
  const padding = paddingMap[variant][size];
  const titleSize = titleSizeMap[variant][size];

  return (
    <div
      className={cn(
        "flex w-full text-muted-foreground",
        align === "center"
          ? "justify-center text-center"
          : "justify-start text-left",
        isHero ? "min-h-[15rem] items-center" : "items-start",
        padding,
        className,
      )}
    >
      <div
        className={cn(
          "grid w-full gap-4",
          isHero ? "max-w-[38rem]" : "max-w-[32rem]",
          align === "center" ? "justify-items-center" : "",
        )}
      >
        <div
          className={cn(
            "grid gap-2.5",
            align === "center" ? "justify-items-center" : "",
          )}
        >
          {eyebrow ? (
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {eyebrow}
            </span>
          ) : null}
          <Icon className={cn(iconSize, "text-foreground/45")} />
          <div className="grid min-w-0 gap-2">
            <p
              className={cn(
                "font-semibold tracking-tight text-foreground",
                titleSize,
              )}
            >
              {title ?? message}
            </p>
            {title ? (
              <p className="max-w-[34rem] text-sm leading-6 text-muted-foreground">
                {message}
              </p>
            ) : null}
          </div>
          {meta && meta.length > 0 ? (
            <div
              className={cn(
                "flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground",
                align === "center" ? "justify-center" : "",
              )}
            >
              {meta.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div
            className={cn(
              "flex flex-wrap gap-2",
              align === "center" ? "justify-center" : "",
            )}
          >
            {actions}
          </div>
        ) : null}
        {children ? <div className="grid gap-3">{children}</div> : null}
      </div>
    </div>
  );
}
