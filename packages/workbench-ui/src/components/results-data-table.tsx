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
  formatResultMetricStats,
  getResultMetricStats,
  getResultMetricValue,
  selectPrimaryResultMetrics,
} from "../lib/result-metrics";
import type {
  ResultMetricDescriptor,
  LabeledEvaluationResultRecord,
} from "../types";

type SortDirection = "asc" | "desc";

export function ResultsDataTable({
  results,
  descriptors,
}: {
  results: LabeledEvaluationResultRecord[];
  descriptors: ResultMetricDescriptor[];
}) {
  const columns = React.useMemo(
    () => selectPrimaryResultMetrics(descriptors).slice(0, 4),
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
    () => sortResults(results, sortState, sortDescriptor),
    [results, sortState, sortDescriptor],
  );

  return (
    <Table data-testid="results-table" className="min-w-[640px] table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead
            className="w-[36%]"
            aria-sort={formatAriaSort(sortState.key === "label" ? sortState.direction : false)}
          >
            <SortableHeader
              label="Result"
              active={sortState.key === "label" ? sortState.direction : false}
              onClick={() => setSortState(toggleSort(sortState, "label", "asc"))}
            />
          </TableHead>
          {columns.map((descriptor) => (
            <TableHead
              key={descriptor.id}
              className="w-[16%]"
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
          <TableHead className="w-[14%]">Samples</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((result) => (
          <TableRow key={result.id}>
            <TableCell>
              <span className="font-medium text-foreground">{result.label}</span>
            </TableCell>
            {columns.map((descriptor) => (
              <TableCell key={descriptor.id} className="text-muted-foreground">
                {formatResultMetricStats(
                  descriptor,
                  getResultMetricStats(result, descriptor),
                  result,
                )}
              </TableCell>
            ))}
            <TableCell className="text-muted-foreground">
              {result.completedSampleCount}/{result.sampleCount}
              {result.errorSampleCount > 0 ? ` error ${result.errorSampleCount}` : ""}
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
      {label}
      <SortIcon data-icon="inline-end" aria-hidden="true" />
    </Button>
  );
}

function sortResults(
  results: LabeledEvaluationResultRecord[],
  sortState: { key: string; direction: SortDirection },
  sortDescriptor: ResultMetricDescriptor | null,
): LabeledEvaluationResultRecord[] {
  const activeDescriptor = sortDescriptor ?? buildFallbackDescriptor(sortState.key);
  return [...results].sort((left, right) => {
    const normalized = sortState.key === "label"
      ? left.label.localeCompare(right.label)
      : compareMetricValues(
          getResultMetricValue(left, activeDescriptor),
          getResultMetricValue(right, activeDescriptor),
        ) || left.label.localeCompare(right.label);
    return sortState.direction === "asc" ? normalized : -normalized;
  });
}

function buildFallbackDescriptor(id: string): ResultMetricDescriptor {
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
