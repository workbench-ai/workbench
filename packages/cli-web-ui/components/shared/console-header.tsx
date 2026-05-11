import { Badge } from "../ui/badge";
import { type BadgeTone, badgeToneProps } from "../../lib/badge";
import { cn } from "../../lib/utils";

interface ConsoleHeaderBadge {
  label: string;
  tone?: BadgeTone;
}

interface ConsoleHeaderProps {
  eyebrow: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  badges?: ConsoleHeaderBadge[];
  actions?: React.ReactNode;
  className?: string;
  summary?: React.ReactNode;
  summaryClassName?: string;
}

export function ConsoleHeader({
  eyebrow,
  title,
  description,
  badges = [],
  actions,
  className,
  summary,
  summaryClassName,
}: ConsoleHeaderProps) {
  return (
    <section className={cn("grid gap-3", className)}>
      <div className="grid min-w-0 gap-3 px-0 py-1 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="grid min-w-0 gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {eyebrow}
            </span>
          </div>
          <div className="grid gap-1">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
            {description ? (
              <p className="max-w-[44rem] text-sm leading-6 text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {actions || badges.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {actions}
            {badges.map((badge) => {
              const tone = badgeToneProps(badge.tone ?? "outline");
              return (
                <Badge
                  key={badge.label}
                  variant={tone.variant}
                  className={tone.className}
                >
                  {badge.label}
                </Badge>
              );
            })}
          </div>
        ) : null}
      </div>
      {summary ? <div className={cn("min-w-0", summaryClassName)}>{summary}</div> : null}
    </section>
  );
}
