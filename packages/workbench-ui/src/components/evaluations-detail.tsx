import * as React from "react";
import { ChartColumnIcon } from "lucide-react";
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workbench-ai/cli-web-ui/components/ui/card";

import { formatSubjectDisplayName } from "../lib/format";
import { buildEvaluationMetricDescriptors } from "../lib/evaluation-metrics";
import type {
  LabeledEvaluationSummary,
  EvaluationSummary,
} from "../types";
import { EvaluationCharts } from "./evaluation-charts";
import { EvaluationsDataTable } from "./evaluations-data-table";
import { SubjectComparisonFilter, type SubjectFilterOption } from "./subject-comparison-filter";

export function EvaluationsDetail({
  evaluations,
  hasEvaluations,
  onSelectEvaluation,
}: {
  evaluations: EvaluationSummary[];
  hasEvaluations: boolean;
  onSelectEvaluation?: (evaluationId: string) => void;
}) {
  const labeledEvaluations = React.useMemo(
    () => evaluations.map(toLabeledEvaluation),
    [evaluations],
  );
  const subjectOptions = React.useMemo(
    () => buildSubjectFilterOptions(labeledEvaluations),
    [labeledEvaluations],
  );
  const allSubjectIds = React.useMemo(
    () => subjectOptions.map((option) => option.id),
    [subjectOptions],
  );
  const [selectedSubjectIds, setSelectedSubjectIds] = React.useState<Set<string> | null>(
    null,
  );
  const selectedSubjectIdSet = React.useMemo(() => {
    if (selectedSubjectIds === null) {
      return new Set(allSubjectIds);
    }

    const available = new Set(allSubjectIds);
    return new Set(
      [...selectedSubjectIds].filter((subjectId) => available.has(subjectId)),
    );
  }, [allSubjectIds, selectedSubjectIds]);
  const filteredEvaluations = React.useMemo(() => {
    if (selectedSubjectIdSet.size === subjectOptions.length) {
      return labeledEvaluations;
    }
    return labeledEvaluations.filter((evaluation) =>
      selectedSubjectIdSet.has(evaluation.subjectId),
    );
  }, [labeledEvaluations, selectedSubjectIdSet, subjectOptions.length]);

  if (evaluations.length === 0) {
    return (
      <EmptyState
        icon={ChartColumnIcon}
        eyebrow="Evaluations"
        title={hasEvaluations ? "Evaluations unavailable" : "No evaluations yet"}
        message={hasEvaluations
          ? "The recorded evaluations are not available in this benchmark index."
          : "Run an eval or improve workflow to record scorecards."}
        variant="hero"
        size="sm"
      />
    );
  }

  const descriptors = buildEvaluationMetricDescriptors(filteredEvaluations);

  return (
    <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3">
      <Card size="sm" className="min-w-0">
        <CardHeader>
          <CardTitle>Scorecards</CardTitle>
          {subjectOptions.length > 1 ? (
            <CardAction>
              <SubjectComparisonFilter
                options={subjectOptions}
                selectedSubjectIds={selectedSubjectIdSet}
                testId="evaluations-subject-filter"
                onSelectAll={() => setSelectedSubjectIds(null)}
                onClear={() => setSelectedSubjectIds(new Set())}
                onToggleSubject={(subjectId, checked) => {
                  setSelectedSubjectIds((current) => {
                    const next = new Set(
                      current === null ? allSubjectIds : [...current],
                    );
                    if (checked) {
                      next.add(subjectId);
                    } else {
                      next.delete(subjectId);
                    }
                    return next.size === allSubjectIds.length ? null : next;
                  });
                }}
              />
            </CardAction>
          ) : null}
        </CardHeader>
        {filteredEvaluations.length > 0 ? (
          <CardContent className="overflow-x-auto py-0">
            <EvaluationsDataTable
              evaluations={filteredEvaluations}
              descriptors={descriptors}
              onSelectEvaluation={onSelectEvaluation}
            />
          </CardContent>
        ) : (
          <CardContent className="py-6">
            <EmptyState
              icon={ChartColumnIcon}
              title="No subjects selected"
              message="Select at least one subject to compare scorecards."
              size="sm"
            />
          </CardContent>
        )}
      </Card>

      {filteredEvaluations.length > 0 ? (
        <EvaluationCharts
          evaluations={filteredEvaluations}
          descriptors={descriptors}
        />
      ) : null}
    </div>
  );
}

function toLabeledEvaluation(evaluation: EvaluationSummary): LabeledEvaluationSummary {
  return {
    ...evaluation,
    label: formatEvaluationLabel(evaluation),
  };
}

function buildSubjectFilterOptions(
  evaluations: LabeledEvaluationSummary[],
): SubjectFilterOption[] {
  const optionsById = new Map<string, SubjectFilterOption>();
  for (const evaluation of evaluations) {
    if (!optionsById.has(evaluation.subjectId)) {
      optionsById.set(evaluation.subjectId, {
        id: evaluation.subjectId,
        label: evaluation.label,
      });
    }
  }
  return [...optionsById.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

function formatEvaluationLabel(
  evaluation: EvaluationSummary,
): string {
  return formatSubjectDisplayName(evaluation);
}
