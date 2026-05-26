import * as React from "react";
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon } from "lucide-react";
import { Button } from "@workbench-ai/cli-web-ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workbench-ai/cli-web-ui/components/ui/table";

import {
  formatEvaluationMetricStats,
  getEvaluationMetricStats,
  getEvaluationMetricValue,
  selectPrimaryEvaluationMetrics,
} from "../lib/evaluation-metrics";
import type {
  EvaluationMetricDescriptor,
  LabeledEvaluationSummary,
} from "../types";

type SortDirection = "asc" | "desc";

export function EvaluationsDataTable({
  evaluations,
  descriptors,
  onSelectEvaluation,
}: {
  evaluations: LabeledEvaluationSummary[];
  descriptors: EvaluationMetricDescriptor[];
  onSelectEvaluation?: (evaluationId: string) => void;
}) {
  const columns = React.useMemo(
    () => selectPrimaryEvaluationMetrics(descriptors).slice(0, 4),
    [descriptors],
  );
  const [sortState, setSortState] = React.useState<{
    key: string;
    direction: SortDirection;
  }>({
    key: columns[0]?.id ?? "label",
    direction: columns[0]?.direction === "lower" ? "asc" : "desc",
  });

  React.useEffect(() => {
    if (sortState.key !== "label" && columns.every((descriptor) => descriptor.id !== sortState.key)) {
      setSortState({
        key: columns[0]?.id ?? "label",
        direction: columns[0]?.direction === "lower" ? "asc" : "desc",
      });
    }
  }, [columns, sortState]);

  const sortDescriptor = React.useMemo(
    () => sortState.key === "label"
      ? null
      : columns.find((descriptor) => descriptor.id === sortState.key) ?? null,
    [columns, sortState.key],
  );
  const rows = React.useMemo(
    () => sortEvaluations(evaluations, sortState, sortDescriptor),
    [evaluations, sortState, sortDescriptor],
  );

  return (
    <Table data-testid="evaluations-table" className="min-w-[760px] table-auto">
      <TableHeader>
        <TableRow>
          <TableHead
            className="min-w-[18rem]"
            aria-sort={formatAriaSort(sortState.key === "label" ? sortState.direction : false)}
          >
            <SortableHeader
              label="Subject"
              active={sortState.key === "label" ? sortState.direction : false}
              onClick={() => setSortState(toggleSort(sortState, "label", "asc"))}
            />
          </TableHead>
          {columns.map((descriptor) => (
            <TableHead
              key={descriptor.id}
              className="min-w-[8rem]"
              aria-sort={formatAriaSort(sortState.key === descriptor.id ? sortState.direction : false)}
            >
              <SortableHeader
                label={descriptor.label}
                active={sortState.key === descriptor.id ? sortState.direction : false}
                onClick={() => setSortState(toggleSort(
                  sortState,
                  descriptor.id,
                  descriptor.direction === "lower" ? "asc" : "desc",
                ))}
              />
            </TableHead>
          ))}
          <TableHead className="min-w-[7rem]">Samples</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((evaluation) => (
          <TableRow
            key={evaluation.id}
            className={onSelectEvaluation ? "cursor-pointer" : undefined}
            onClick={onSelectEvaluation ? () => onSelectEvaluation(evaluation.id) : undefined}
          >
            <TableCell className="min-w-[18rem] align-top whitespace-normal">
              <span className="break-words font-medium text-foreground [overflow-wrap:anywhere]">
                {evaluation.label}
              </span>
            </TableCell>
            {columns.map((descriptor) => (
              <TableCell key={descriptor.id} className="align-top text-muted-foreground">
                {formatEvaluationMetricStats(
                  descriptor,
                  getEvaluationMetricStats(evaluation, descriptor),
                  evaluation,
                )}
              </TableCell>
            ))}
            <TableCell className="align-top text-muted-foreground">
              {evaluation.completedSampleCount}/{evaluation.sampleCount}
              {evaluation.errorSampleCount > 0 ? ` error ${evaluation.errorSampleCount}` : ""}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SortableHeader({
  label,
  active,
  onClick,
}: {
  label: string;
  active: false | SortDirection;
  onClick: () => void;
}) {
  const SortIcon = active === "asc"
    ? ArrowUpIcon
    : active === "desc"
      ? ArrowDownIcon
      : ArrowUpDownIcon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-label={`Sort by ${label}`}
    >
      <span className="min-w-0 truncate">{label}</span>
      <SortIcon data-icon="inline-end" aria-hidden="true" />
    </Button>
  );
}

function sortEvaluations(
  evaluations: LabeledEvaluationSummary[],
  sortState: { key: string; direction: SortDirection },
  sortDescriptor: EvaluationMetricDescriptor | null,
): LabeledEvaluationSummary[] {
  const activeDescriptor = sortDescriptor ?? buildFallbackDescriptor(sortState.key);
  return [...evaluations].sort((left, right) => {
    const normalized = sortState.key === "label"
      ? left.label.localeCompare(right.label)
      : compareMetricValues(
          getEvaluationMetricValue(left, activeDescriptor),
          getEvaluationMetricValue(right, activeDescriptor),
        ) || left.label.localeCompare(right.label);
    return sortState.direction === "asc" ? normalized : -normalized;
  });
}

function buildFallbackDescriptor(id: string): EvaluationMetricDescriptor {
  return {
    id,
    label: id,
    direction: "higher",
    kind: "number",
    group: "other",
    primary: false,
  };
}

function compareMetricValues(left: number | undefined, right: number | undefined): number {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return left - right;
}

function toggleSort(
  current: { key: string; direction: SortDirection },
  key: string,
  defaultDirection: SortDirection,
): { key: string; direction: SortDirection } {
  if (current.key !== key) {
    return { key, direction: defaultDirection };
  }
  return {
    key,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

function formatAriaSort(value: false | SortDirection): "ascending" | "descending" | "none" {
  if (value === "asc") {
    return "ascending";
  }
  if (value === "desc") {
    return "descending";
  }
  return "none";
}
