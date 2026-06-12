import * as React from "react";
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon } from "lucide-react";
import { Badge } from "@workbench-ai/cli-web-ui/components/ui/badge";
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
  formatComparisonTableMetricValue,
  getComparisonMetricValue,
  selectPrimaryComparisonMetrics,
  type ComparisonEvidenceRow,
  type ComparisonMetricDescriptor,
} from "../lib/comparison-metrics";

type SortDirection = "asc" | "desc";

export function ComparisonDataTable({
  rows,
  descriptors,
  onSelectRun,
}: {
  rows: ComparisonEvidenceRow[];
  descriptors: ComparisonMetricDescriptor[];
  onSelectRun?: (runId: string) => void;
}) {
  const columns = React.useMemo(
    () => selectPrimaryComparisonMetrics(descriptors).slice(0, 4),
    [descriptors],
  );
  const [sortState, setSortState] = React.useState<{
    key: string;
    direction: SortDirection;
  }>({
    key: "version",
    direction: "desc",
  });

  React.useEffect(() => {
    if (!isBuiltInSortKey(sortState.key) && columns.every((descriptor) => descriptor.id !== sortState.key)) {
      setSortState({
        key: "version",
        direction: "desc",
      });
    }
  }, [columns, sortState]);

  const sortDescriptor = React.useMemo(
    () => isBuiltInSortKey(sortState.key)
      ? null
      : columns.find((descriptor) => descriptor.id === sortState.key) ?? null,
    [columns, sortState.key],
  );
  const sortedRows = React.useMemo(
    () => sortComparisonRows(rows, sortState, sortDescriptor),
    [rows, sortState, sortDescriptor],
  );

  return (
    <Table data-testid="comparison-table" className="w-full min-w-[60rem] table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead
            className="w-[9rem]"
            aria-sort={formatAriaSort(sortState.key === "setup" ? sortState.direction : false)}
          >
            <SortableHeader
              label="Skill"
              active={sortState.key === "setup" ? sortState.direction : false}
              onClick={() => setSortState(toggleSort(sortState, "setup", "asc"))}
            />
          </TableHead>
          <TableHead
            className="w-[8rem]"
            aria-sort={formatAriaSort(sortState.key === "version" ? sortState.direction : false)}
          >
            <SortableHeader
              label="Skill version"
              active={sortState.key === "version" ? sortState.direction : false}
              onClick={() => setSortState(toggleSort(sortState, "version", "desc"))}
            />
          </TableHead>
          <TableHead
            className="w-[12rem]"
            aria-sort={formatAriaSort(sortState.key === "agent" ? sortState.direction : false)}
          >
            <SortableHeader
              label="Agent"
              active={sortState.key === "agent" ? sortState.direction : false}
              onClick={() => setSortState(toggleSort(sortState, "agent", "asc"))}
            />
          </TableHead>
          {columns.map((descriptor) => (
            <TableHead
              key={descriptor.id}
              className={metricColumnClassName(descriptor)}
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
          <TableHead className="w-[11rem]">Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedRows.map((row) => {
          const canOpen = Boolean(row.runId && onSelectRun);
          return (
            <TableRow
              key={row.rowId}
              className={canOpen ? "cursor-pointer" : undefined}
              role={canOpen ? "button" : undefined}
              tabIndex={canOpen ? 0 : undefined}
              onClick={canOpen ? () => onSelectRun?.(row.runId!) : undefined}
              onKeyDown={canOpen
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectRun?.(row.runId!);
                    }
                  }
                : undefined}
            >
              <TableCell className="align-top whitespace-normal">
                <span className="break-words font-medium text-foreground [overflow-wrap:anywhere]">
                  {row.setupLabel}
                </span>
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                <div className="grid min-w-0 gap-1">
                  <span className="break-words text-foreground [overflow-wrap:anywhere]">
                    {row.versionLabel}
                  </span>
                  {row.versionBadges.length > 0 ? (
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {row.versionBadges.map((badge) => (
                        <Badge key={badge} variant="outline" className="w-fit">
                          {badge}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                <div className="grid min-w-0 gap-1">
                  <span className="break-words font-medium text-foreground [overflow-wrap:anywhere]">
                    {row.agentName}
                  </span>
                  <Badge variant="outline" className="w-fit">
                    {row.statusLabel}
                  </Badge>
                  <span className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {row.agentDetail}
                  </span>
                </div>
              </TableCell>
              {columns.map((descriptor) => (
                <TableCell
                  key={descriptor.id}
                  className="align-top whitespace-normal break-words text-muted-foreground [overflow-wrap:anywhere]"
                >
                  {formatComparisonTableMetricValue(row, descriptor)}
                </TableCell>
              ))}
              <TableCell className="align-top whitespace-normal break-words text-muted-foreground [overflow-wrap:anywhere]">
                {row.evidenceLabel}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function metricColumnClassName(descriptor: ComparisonMetricDescriptor): string {
  return descriptor.id === "costUsd" ? "w-[8rem]" : "w-[6rem]";
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

function sortComparisonRows(
  rows: ComparisonEvidenceRow[],
  sortState: { key: string; direction: SortDirection },
  sortDescriptor: ComparisonMetricDescriptor | null,
): ComparisonEvidenceRow[] {
  return [...rows].sort((left, right) => {
    if (sortState.key === "setup") {
      return compareSetupRowsForDirection(left, right, sortState.direction);
    }
    if (sortState.key === "version") {
      return compareNumberForDirection(left.versionOrdinal, right.versionOrdinal, sortState.direction) ||
        compareSetupRowsForDirection(left, right, "asc") ||
        compareTextForDirection(left.agentName, right.agentName, "asc");
    }
    if (sortState.key === "agent") {
      return compareTextForDirection(left.agentName, right.agentName, sortState.direction) ||
        compareSetupRowsForDirection(left, right, "asc") ||
        compareNumberForDirection(left.versionOrdinal, right.versionOrdinal, "desc");
    }
    const descriptor = sortDescriptor ?? buildFallbackDescriptor(sortState.key);
    return compareMetricValuesForDirection(
      getComparisonMetricValue(left, descriptor),
      getComparisonMetricValue(right, descriptor),
      sortState.direction,
    ) || compareNumberForDirection(left.versionOrdinal, right.versionOrdinal, "desc") ||
      compareSetupRowsForDirection(left, right, "asc") ||
      compareTextForDirection(left.agentName, right.agentName, "asc");
  });
}

function isBuiltInSortKey(key: string): boolean {
  return key === "setup" || key === "version" || key === "agent";
}

function buildFallbackDescriptor(id: string): ComparisonMetricDescriptor {
  return {
    id,
    label: id,
    direction: "higher",
    kind: "number",
    primary: false,
  };
}

function compareMetricValuesForDirection(
  left: number | undefined,
  right: number | undefined,
  direction: SortDirection,
): number {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return direction === "asc" ? left - right : right - left;
}

function compareTextForDirection(left: string, right: string, direction: SortDirection): number {
  const order = left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return direction === "asc" ? order : -order;
}

function compareSetupRowsForDirection(
  left: ComparisonEvidenceRow,
  right: ComparisonEvidenceRow,
  direction: SortDirection,
): number {
  const order = left.setupRank - right.setupRank ||
    left.setupLabel.localeCompare(right.setupLabel, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  return direction === "asc" ? order : -order;
}

function compareNumberForDirection(left: number, right: number, direction: SortDirection): number {
  return direction === "asc" ? left - right : right - left;
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
