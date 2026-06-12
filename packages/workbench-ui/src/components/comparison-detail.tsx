import * as React from "react";
import { ChartColumnIcon } from "lucide-react";
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
import { getCategoricalChartColor } from "@workbench-ai/cli-web-ui/lib/chart-colors";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workbench-ai/cli-web-ui/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workbench-ai/cli-web-ui/components/ui/select";

import {
  buildComparisonMetricDescriptors,
  buildComparisonTableMetricDescriptors,
  type ComparisonEvaluationOption,
  type ComparisonEvidenceRow,
  type ComparisonGroupPresentation,
} from "../lib/comparison-metrics";
import { ComparisonCharts } from "./comparison-charts";
import { ComparisonDataTable } from "./comparison-data-table";
import { ComparisonFilter } from "./comparison-filter";

export function ComparisonDetail({
  emptySelectionMessage = "Select at least one setup to compare scorecards.",
  emptySelectionTitle = "No setups selected",
  filterLabel = "Setups",
  rows,
  groups,
  hasComparison,
  evaluation,
  evaluationOptions = [],
  unavailableMessage = "This comparison has no matching skill setups to show.",
  selectedEvaluationId,
  onSelectEvaluation,
  onSelectRun,
}: {
  emptySelectionMessage?: string;
  emptySelectionTitle?: string;
  filterLabel?: string;
  rows: ComparisonEvidenceRow[];
  groups: Array<Omit<ComparisonGroupPresentation, "color">>;
  hasComparison: boolean;
  evaluation?: ComparisonEvaluationOption | null;
  evaluationOptions?: ComparisonEvaluationOption[];
  unavailableMessage?: string;
  selectedEvaluationId?: string | null;
  onSelectEvaluation?: (evaluationId: string) => void;
  onSelectRun?: (runId: string) => void;
}) {
  const groupOptions = React.useMemo(
    () => groups
      .map((group, index): ComparisonGroupPresentation => ({
        ...group,
        color: getCategoricalChartColor(index),
      })),
    [groups],
  );
  const groupColorById = React.useMemo(
    () => new Map(groupOptions.map((group) => [group.id, group.color])),
    [groupOptions],
  );
  const allGroupIds = React.useMemo(
    () => groupOptions.map((option) => option.id),
    [groupOptions],
  );
  const [selectedGroupIds, setSelectedGroupIds] = React.useState<Set<string> | null>(null);
  const selectedGroupIdSet = React.useMemo(() => {
    if (selectedGroupIds === null) {
      return new Set(allGroupIds);
    }

    const available = new Set(allGroupIds);
    return new Set(
      [...selectedGroupIds].filter((groupId) => available.has(groupId)),
    );
  }, [allGroupIds, selectedGroupIds]);
  const filteredRows = React.useMemo(() => {
    if (selectedGroupIdSet.size === groupOptions.length) {
      return rows;
    }
    return rows.filter((row) => selectedGroupIdSet.has(row.groupId));
  }, [rows, selectedGroupIdSet, groupOptions.length]);
  const filteredGroupOptions = React.useMemo(
    () => groupOptions.filter((group) => selectedGroupIdSet.has(group.id)),
    [groupOptions, selectedGroupIdSet],
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ChartColumnIcon}
        eyebrow="Compare"
        title={hasComparison ? "Comparison unavailable" : "No runs yet"}
        message={hasComparison
          ? unavailableMessage
          : "Run evals to record scorecards for comparison."}
        variant="hero"
        size="sm"
      />
    );
  }

  const descriptors = buildComparisonMetricDescriptors(filteredRows);
  const tableDescriptors = buildComparisonTableMetricDescriptors(filteredRows);
  const showEvaluationSelector = evaluationOptions.length > 1 &&
    typeof selectedEvaluationId === "string" &&
    typeof onSelectEvaluation === "function";
  const showSetupFilter = groupOptions.length > 1;
  const showActions = showEvaluationSelector || showSetupFilter;

  return (
    <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3">
      <Card size="sm" className="min-w-0">
        <CardHeader>
          <div className="grid min-w-0 gap-1">
            <CardTitle>Scorecard</CardTitle>
            {evaluation ? (
              <p className="text-xs text-muted-foreground">
                {evaluation.label} / {evaluation.subtitle}
              </p>
            ) : null}
          </div>
          {showActions ? (
            <CardAction>
              <div className="flex min-w-0 flex-wrap justify-end gap-2">
                {showEvaluationSelector ? (
                  <EvaluationSelect
                    options={evaluationOptions}
                    value={selectedEvaluationId}
                    onValueChange={onSelectEvaluation}
                  />
                ) : null}
                {showSetupFilter ? (
                  <ComparisonFilter
                    label={filterLabel}
                    options={groupOptions}
                    selectedIds={selectedGroupIdSet}
                    testId="comparison-skill-filter"
                    onSelectAll={() => setSelectedGroupIds(null)}
                    onClear={() => setSelectedGroupIds(new Set())}
                    onToggle={(groupId, checked) => {
                      setSelectedGroupIds((current) => {
                        const next = new Set(
                          current === null ? allGroupIds : [...current],
                        );
                        if (checked) {
                          next.add(groupId);
                        } else {
                          next.delete(groupId);
                        }
                        return next.size === allGroupIds.length ? null : next;
                      });
                    }}
                  />
                ) : null}
              </div>
            </CardAction>
          ) : null}
        </CardHeader>
        {filteredRows.length > 0 ? (
          <CardContent className="overflow-x-auto py-0">
            <ComparisonDataTable
              rows={filteredRows}
              descriptors={tableDescriptors}
              onSelectRun={onSelectRun}
            />
          </CardContent>
        ) : (
          <CardContent className="py-6">
            <EmptyState
              icon={ChartColumnIcon}
              title={emptySelectionTitle}
              message={emptySelectionMessage}
              size="sm"
            />
          </CardContent>
        )}
      </Card>

      {filteredRows.length > 1 && descriptors.length > 0 ? (
        <ComparisonCharts
          rows={filteredRows}
          descriptors={descriptors}
          groups={filteredGroupOptions}
          groupColorById={groupColorById}
        />
      ) : null}
    </div>
  );
}

function EvaluationSelect({
  onValueChange,
  options,
  value,
}: {
  onValueChange: (evaluationId: string) => void;
  options: ComparisonEvaluationOption[];
  value: string;
}) {
  const selectedOption = options.find((option) => option.id === value);

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="sm"
        aria-label="Select evaluation"
        data-testid="comparison-evaluation-select"
      >
        <SelectValue placeholder="Evaluation">
          {selectedOption?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="min-w-64">
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id} textValue={option.label}>
            <span className="grid min-w-0 gap-0.5">
              <span>{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.subtitle}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
