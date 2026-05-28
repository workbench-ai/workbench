import { GitBranchIcon, SparklesIcon } from "lucide-react";
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
import { Badge } from "@workbench-ai/cli-web-ui/components/ui/badge";
import { Button } from "@workbench-ai/cli-web-ui/components/ui/button";

import {
  formatCandidateName,
  formatCandidateSecondaryLabel,
  formatCandidateSelectionLabel,
  formatCandidateVersionLabel,
  statusLabel,
} from "../lib/format";
import {
  buildCandidateEvaluationRollups,
  buildEvaluationsByCandidate,
  formatEvaluationConfigurationLabel,
  readEvaluationScore,
  resolveCandidateEvaluationRollupDisplay,
} from "../lib/candidate-evaluation-display";
import type { CandidateRuntimeState } from "../lib/runtime-state";
import type { EvaluationSummary, CandidateSummary } from "../types";
import {
  CandidateRuntimeBadge,
  shouldShowCandidateRuntimeBadge,
} from "./candidate-runtime-badge";
import { StatusBadge } from "./status-badge";

export function CandidateList({
  summaries,
  evaluations,
  candidateStateById,
  activeId,
  selectedId,
  onSelect,
}: {
  summaries: CandidateSummary[];
  evaluations: EvaluationSummary[];
  candidateStateById?: ReadonlyMap<string, CandidateRuntimeState>;
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

  const rollupByCandidate = buildCandidateEvaluationRollups(evaluations);
  const evaluationsByCandidate = buildEvaluationsByCandidate(evaluations);
  const summaryById = new Map(summaries.map((summary) => [summary.id, summary]));

  return (
    <div className="grid gap-3">
      {summaries.map((summary) => {
        const isSelected = selectedId === summary.id;
        const isActive = activeId === summary.id;
        const candidateLabel = formatCandidateName(summary);
        const candidateVersionLabel = formatCandidateVersionLabel(summary);
        const baseSummary = summary.baseId ? summaryById.get(summary.baseId) ?? null : null;
        const candidateContext = formatCandidateSecondaryLabel(summary, baseSummary);
        const runtimeState = candidateStateById?.get(summary.id) ?? null;
        const rollupDisplay = resolveCandidateEvaluationRollupDisplay(
          rollupByCandidate.get(summary.id),
        );
        const runEvaluations = evaluationsByCandidate.get(summary.id) ?? [];
        const accessibilityLabel = formatCandidateSelectionLabel({
          summary,
          baseSummary,
          active: isActive,
          details: [rollupDisplay.ariaText],
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
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="grid min-w-0 gap-1">
                  <span className="min-w-0 truncate text-[11px] font-medium uppercase text-muted-foreground">
                    {candidateContext}
                  </span>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="min-w-0 break-words text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
                      {candidateLabel}
                    </p>
                    {candidateVersionLabel ? (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {candidateVersionLabel}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <StatusBadge status={summary.status} active={isActive} className="shrink-0" />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-medium text-foreground">{rollupDisplay.scoreText}</span>
                <span className="text-muted-foreground">{rollupDisplay.meanText}</span>
                <span className="text-muted-foreground">{rollupDisplay.countText}</span>
                {isActive ? (
                  <span className="inline-flex items-center gap-1 text-primary">
                    <GitBranchIcon className="size-3.5" />
                    Active
                  </span>
                ) : null}
                {shouldShowCandidateRuntimeBadge(runtimeState) ? (
                  <CandidateRuntimeBadge state={runtimeState} />
                ) : null}
              </div>
              {runEvaluations.length > 0 ? (
                <div className="min-w-0 truncate text-xs text-muted-foreground">
                  {rollupDisplay.bestConfigurationText}
                </div>
              ) : null}
              {runEvaluations.length > 0 ? (
                <div className="grid gap-1 rounded-md border border-border/70 bg-muted/20 p-2 text-xs">
                  {runEvaluations.map((evaluation) => {
                    const configurationLabel = formatEvaluationConfigurationLabel(evaluation);
                    const score = readEvaluationScore(evaluation);
                    return (
                      <div key={evaluation.id} className="flex min-w-0 items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-muted-foreground">{configurationLabel}</span>
                        <span className="shrink-0 font-medium text-foreground">
                          {score !== null ? formatRunScore(score) : statusLabel(evaluation.status)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </Button>
        );
      })}
    </div>
  );
}

function formatRunScore(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 3,
  }).format(value);
}
