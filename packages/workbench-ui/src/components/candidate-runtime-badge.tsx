import { Badge } from "@workbench-ai/cli-web-ui/components/ui/badge";
import { badgeToneProps, type BadgeTone } from "@workbench-ai/cli-web-ui/lib/badge";

import type { CandidateRuntimeState } from "../lib/runtime-state";

export function CandidateRuntimeBadge({
  state,
}: {
  state: CandidateRuntimeState;
}) {
  const tone = badgeToneProps(candidateRuntimeBadgeTone(state));
  const label = state.label ?? "Run state";
  return (
    <Badge variant={tone.variant} className={tone.className}>
      {label}
    </Badge>
  );
}

export function shouldShowCandidateRuntimeBadge(
  state: CandidateRuntimeState | null | undefined,
): state is CandidateRuntimeState {
  if (!state?.label) {
    return false;
  }
  if (state.active) {
    return true;
  }
  return state.latestRun?.outcome === "error" || state.latestRun?.outcome === "cancelled";
}

function candidateRuntimeBadgeTone(state: CandidateRuntimeState): BadgeTone {
  if (state.active) {
    return "warning";
  }
  if (state.latestRun?.outcome === "error" || state.latestRun?.outcome === "cancelled") {
    return "destructive";
  }
  return "outline";
}
