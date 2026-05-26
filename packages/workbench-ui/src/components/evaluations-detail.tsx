import * as React from "react";
import { ChartColumnIcon, ChevronDownIcon, ListFilterIcon } from "lucide-react";
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
import { Button } from "@workbench-ai/cli-web-ui/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workbench-ai/cli-web-ui/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workbench-ai/cli-web-ui/components/ui/dropdown-menu";

import { formatSubjectDisplayName } from "../lib/format";
import { buildEvaluationMetricDescriptors } from "../lib/evaluation-metrics";
import type {
  LabeledEvaluationSummary,
  EvaluationSummary,
} from "../types";
import { EvaluationCharts } from "./evaluation-charts";
import { EvaluationsDataTable } from "./evaluations-data-table";

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

interface SubjectFilterOption {
  id: string;
  label: string;
}

function SubjectComparisonFilter({
  options,
  selectedSubjectIds,
  onSelectAll,
  onClear,
  onToggleSubject,
}: {
  options: SubjectFilterOption[];
  selectedSubjectIds: Set<string>;
  onSelectAll: () => void;
  onClear: () => void;
  onToggleSubject: (subjectId: string, checked: boolean) => void;
}) {
  const selectedCount = selectedSubjectIds.size;
  const totalCount = options.length;
  const buttonLabel = selectedCount === totalCount
    ? `All ${totalCount}`
    : selectedCount === 0
      ? "None"
      : `${selectedCount} of ${totalCount}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Filter comparison subjects: ${buttonLabel}`}
          data-testid="evaluations-subject-filter"
        >
          <ListFilterIcon data-icon="inline-start" aria-hidden="true" />
          <span>Subjects: {buttonLabel}</span>
          <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Comparison subjects</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={selectedCount === totalCount}
            onSelect={(event) => {
              event.preventDefault();
              onSelectAll();
            }}
          >
            Select all
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={selectedCount === 0}
            onSelect={(event) => {
              event.preventDefault();
              onClear();
            }}
          >
            Clear
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={selectedSubjectIds.has(option.id)}
              onCheckedChange={(checked) => {
                onToggleSubject(option.id, checked === true);
              }}
              onSelect={(event) => event.preventDefault()}
              className="items-start py-2"
            >
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate font-medium">{option.label}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {formatSubjectFilterId(option.id)}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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

function formatSubjectFilterId(subjectId: string): string {
  if (subjectId.length <= 18) {
    return subjectId;
  }
  return `${subjectId.slice(0, 8)}...${subjectId.slice(-8)}`;
}

function formatEvaluationLabel(
  evaluation: EvaluationSummary,
): string {
  return formatSubjectDisplayName(evaluation);
}
