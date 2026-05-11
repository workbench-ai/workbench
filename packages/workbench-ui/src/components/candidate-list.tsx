import { GitBranchIcon, SparklesIcon } from "lucide-react";
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
import { Button } from "@workbench-ai/cli-web-ui/components/ui/button";

import {
  formatCandidateSelectionLabel,
  formatMetricSummary,
  formatTimestamp,
  shortId,
} from "../lib/format";
import type { CandidateSummary } from "../types";
import { StatusBadge } from "./status-badge";

export function CandidateList({
  summaries,
  activeId,
  selectedId,
  onSelect,
}: {
  summaries: CandidateSummary[];
  activeId: string | null;
  selectedId: string | null;
  onSelect: (candidateId: string) => void;
}) {
  if (summaries.length === 0) {
    return (
      <EmptyState
        icon={SparklesIcon}
        eyebrow="Candidates"
        title="No candidates for this version"
        message="Run Workbench with this benchmark version to materialize the first candidate."
        variant="hero"
        size="sm"
      />
    );
  }

  return (
    <div className="grid gap-3">
      {summaries.map((summary) => {
        const isSelected = selectedId === summary.id;
        const isActive = activeId === summary.id;
        const candidateLabel = shortId(summary.id) ?? summary.id;
        const baseId = summary.baseId && summary.baseId !== summary.id ? summary.baseId : null;
        const metricSummary = formatMetricSummary(summary.metrics);
        const createdAtLabel = formatTimestamp(summary.createdAt);
        const accessibilityLabel = formatCandidateSelectionLabel({
          summary,
          active: isActive,
          details: [metricSummary, createdAtLabel],
        });

        return (
          <Button
            key={summary.id}
            data-testid={`candidate-row-${summary.id}`}
            data-active={isActive || undefined}
            aria-selected={isSelected || undefined}
            aria-label={accessibilityLabel}
            type="button"
            variant={isSelected || isActive ? "secondary" : "outline"}
            className="!flex h-auto w-full min-w-0 items-stretch justify-start px-0 py-0 text-left whitespace-normal"
            onClick={() => onSelect(summary.id)}
          >
            <div className="flex h-full w-full min-w-0 flex-col gap-2 p-3 sm:p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="grid gap-1">
                  <span className="text-[11px] font-medium uppercase text-muted-foreground">
                    {baseId ? `from ${shortId(baseId)}` : "genesis"}
                  </span>
                  <p className="text-sm font-semibold text-foreground">{candidateLabel}</p>
                </div>
                <StatusBadge status={summary.status} active={isActive} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{metricSummary}</span>
                {isActive ? (
                  <span className="inline-flex items-center gap-1 text-primary">
                    <GitBranchIcon className="size-3.5" />
                    Active
                  </span>
                ) : null}
                <span>{createdAtLabel}</span>
              </div>
            </div>
          </Button>
        );
      })}
    </div>
  );
}
