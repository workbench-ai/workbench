import { GitBranchIcon, SparklesIcon } from "lucide-react";
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
import { Button } from "@workbench-ai/cli-web-ui/components/ui/button";

import {
  formatSubjectDisplayName,
  formatSubjectSecondaryLabel,
  formatSubjectSelectionLabel,
} from "../lib/format";
import {
  buildLatestEvaluationBySubject,
  resolveSubjectEvaluationDisplay,
} from "../lib/subject-evaluation-display";
import type { EvaluationSummary, SubjectSummary } from "../types";
import { StatusBadge } from "./status-badge";

export function SubjectList({
  summaries,
  evaluations,
  activeId,
  selectedId,
  onSelect,
}: {
  summaries: SubjectSummary[];
  evaluations: EvaluationSummary[];
  activeId: string | null;
  selectedId: string | null;
  onSelect: (subjectId: string) => void;
}) {
  if (summaries.length === 0) {
    return (
      <EmptyState
        icon={SparklesIcon}
        eyebrow="Subjects"
        title="No subjects for this version"
        message="Run Workbench with this benchmark version to materialize the first subject."
        variant="hero"
        size="sm"
      />
    );
  }

  const latestEvaluationBySubject = buildLatestEvaluationBySubject(evaluations);
  const summaryById = new Map(summaries.map((summary) => [summary.id, summary]));

  return (
    <div className="grid gap-3">
      {summaries.map((summary) => {
        const isSelected = selectedId === summary.id;
        const isActive = activeId === summary.id;
        const subjectLabel = formatSubjectDisplayName(summary);
        const baseSummary = summary.baseId ? summaryById.get(summary.baseId) ?? null : null;
        const subjectContext = formatSubjectSecondaryLabel(summary, baseSummary);
        const evaluationDisplay = resolveSubjectEvaluationDisplay({
          latestEvaluation: latestEvaluationBySubject.get(summary.id) ?? null,
        });
        const accessibilityLabel = formatSubjectSelectionLabel({
          summary,
          baseSummary,
          active: isActive,
          details: [evaluationDisplay.ariaText],
        });

        return (
          <Button
            key={summary.id}
            data-testid={`subject-row-${summary.id}`}
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
                    {subjectContext}
                  </span>
                  <p className="min-w-0 break-words text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
                    {subjectLabel}
                  </p>
                </div>
                <StatusBadge status={summary.status} active={isActive} className="shrink-0" />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-medium text-foreground">{evaluationDisplay.scoreText}</span>
                <span className="text-muted-foreground">{evaluationDisplay.sourceText}</span>
                {isActive ? (
                  <span className="inline-flex items-center gap-1 text-primary">
                    <GitBranchIcon className="size-3.5" />
                    Active
                  </span>
                ) : null}
              </div>
            </div>
          </Button>
        );
      })}
    </div>
  );
}
