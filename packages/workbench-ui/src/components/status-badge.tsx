import { Badge } from "@workbench-ai/cli-web-ui/components/ui/badge";
import { badgeToneProps } from "@workbench-ai/cli-web-ui/lib/badge";

import { badgeToneForStatus, statusLabel } from "../lib/format";
import type {
  SubjectSummary,
  RuntimeEvent,
} from "../types";

export function StatusBadge({
  status,
  active = false,
}: {
  status:
    | SubjectSummary["status"]
    | RuntimeEvent["status"]
    | null
    | undefined;
  active?: boolean;
}) {
  const statusTone = badgeToneForStatus(status);
  const tone = badgeToneProps(
    active && statusTone !== "destructive" ? "accent" : statusTone,
  );

  return (
    <Badge variant={tone.variant} className={tone.className}>
      {statusLabel(status)}
    </Badge>
  );
}
