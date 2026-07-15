import { Badge } from "@workbench-ai/cli-web-ui/components/ui/badge";
import { badgeToneProps } from "@workbench-ai/cli-web-ui/lib/badge";
import { cn } from "@workbench-ai/cli-web-ui/lib/utils";

import { formatStatus } from "../lib/format";

type Tone = "outline" | "success" | "warning" | "destructive" | "accent";

const TONE_BY_STATUS: Record<string, Tone> = {
  automate: "success",
  canceled: "destructive",
  cancelled: "destructive",
  failed: "destructive",
  insufficient: "warning",
  "needs grade": "warning",
  "needs run": "warning",
  review: "warning",
  running: "warning",
  queued: "warning",
  succeeded: "success",
  assist: "accent",
};

export function StatusBadge({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const tone = badgeToneProps(TONE_BY_STATUS[status ?? ""] ?? "outline");
  return (
    <Badge variant={tone.variant} className={cn(tone.className, className)}>
      {formatStatus(status)}
    </Badge>
  );
}
