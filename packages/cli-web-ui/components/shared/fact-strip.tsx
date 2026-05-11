import { Card, CardContent } from "../ui/card";
import { cn } from "../../lib/utils";

interface FactItem {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  valueClassName?: string;
  detailClassName?: string;
}

interface FactStripProps {
  items: FactItem[];
  className?: string;
  contentClassName?: string;
  columnsClassName?: string;
  variant?: "quiet" | "inset";
}

export function FactStrip({
  items,
  className,
  contentClassName,
  columnsClassName,
  variant = "quiet",
}: FactStripProps) {
  return (
    <Card
      size="sm"
      className={cn(
        variant === "quiet"
          ? "bg-card/80"
          : "bg-card",
        className,
      )}
    >
      <CardContent
        className={cn(
          "grid gap-4 px-4 py-0 sm:grid-cols-2 sm:px-5 xl:grid-cols-4",
          columnsClassName,
          contentClassName,
        )}
      >
        {items.map((item) => (
          <div
            key={item.label}
            className="grid min-w-0 gap-1"
          >
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {item.label}
            </span>
            <span
              className={cn("truncate text-sm font-semibold text-foreground", item.valueClassName)}
              title={typeof item.value === "string" ? item.value : undefined}
            >
              {item.value}
            </span>
            {item.detail ? (
              <span
                className={cn("truncate text-xs text-muted-foreground", item.detailClassName)}
                title={typeof item.detail === "string" ? item.detail : undefined}
              >
                {item.detail}
              </span>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
