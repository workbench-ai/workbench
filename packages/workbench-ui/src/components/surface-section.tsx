import type { ComponentType, ReactNode } from "react";

import { cn } from "@workbench-ai/cli-web-ui/lib/utils";

export function SurfaceSection({
  title,
  icon: Icon,
  description,
  headingLevel = 2,
  className,
  children,
}: {
  title: string;
  icon?: ComponentType<{ className?: string }>;
  description?: string;
  headingLevel?: 2 | 3 | 4;
  className?: string;
  children: ReactNode;
}) {
  const HeadingTag = headingLevel === 4 ? "h4" : headingLevel === 3 ? "h3" : "h2";

  return (
    <section className={cn("grid min-w-0 gap-3", className)}>
      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
          <HeadingTag className="text-base font-semibold text-foreground">{title}</HeadingTag>
        </div>
        {description ? (
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
