import type { ComponentProps } from "react";

import type { Badge } from "../components/ui/badge";

type StockBadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

export type BadgeTone = StockBadgeVariant | "accent" | "success" | "warning";

const semanticBadgeClasses = {
  accent:
    "border-transparent bg-primary/12 text-primary ring-1 ring-primary/15 [a]:hover:bg-primary/18",
  success:
    "border-transparent bg-success/14 text-success ring-1 ring-success/18 [a]:hover:bg-success/20",
  warning:
    "border-transparent bg-warning/16 text-warning-foreground ring-1 ring-warning/24 [a]:hover:bg-warning/22",
} satisfies Record<"accent" | "success" | "warning", string>;

function isSemanticBadgeTone(
  tone: BadgeTone,
): tone is keyof typeof semanticBadgeClasses {
  return tone in semanticBadgeClasses;
}

export function badgeToneProps(
  tone: BadgeTone = "default",
): { variant: StockBadgeVariant; className?: string } {
  if (isSemanticBadgeTone(tone)) {
    return {
      variant: "outline",
      className: semanticBadgeClasses[tone],
    };
  }

  return { variant: tone };
}
