import { Badge } from "@workbench-ai/cli-web-ui/components/ui/badge";
import { badgeToneProps } from "@workbench-ai/cli-web-ui/lib/badge";
import { cn } from "@workbench-ai/cli-web-ui/lib/utils";

import { badgeToneForStatus, statusLabel } from "../lib/format";
import type {
  RemoteWorkbenchJob,
  CandidateSummary,
} from "../types";

export function StatusBadge({
  status,
  active = false,
  className,
}: {
  status:
    | CandidateSummary["status"]
    | RemoteWorkbenchJob["status"]
    | null
    | undefined;
  active?: boolean;
  className?: string;
}) {
  const statusTone = badgeToneForStatus(status);
  const tone = badgeToneProps(
    active && statusTone !== "destructive" ? "accent" : statusTone,
  );

  return (
    <Badge variant={tone.variant} className={cn(tone.className, className)}>
      {statusLabel(status)}
    </Badge>
  );
}
