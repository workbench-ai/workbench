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
  formatEvaluationMetricStats,
  getEvaluationMetricStats,
  getEvaluationMetricValue,
  selectPrimaryEvaluationMetrics,
} from "../lib/evaluation-metrics";
import { resolveEvaluationCandidateDisplay } from "../lib/candidate-evaluation-display";
import type {
  EvaluationMetricDescriptor,
  LabeledEvaluationSummary,
} from "../types";

type SortDirection = "asc" | "desc";

export function EvaluationsDataTable({
  rows,
  descriptors,
  candidates,
  onSelectEvaluation,
}: {
  rows: EvaluationDataTableRow[];
  descriptors: EvaluationMetricDescriptor[];
  candidates: EvaluationTableCandidate[];
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
  const sortedRows = React.useMemo(
    () => sortEvaluationRows(rows, sortState, sortDescriptor),
    [rows, sortState, sortDescriptor],
  );
  const groups = React.useMemo(
    () => buildEvaluationGroups(sortedRows, candidates),
    [sortedRows, candidates],
  );

  return (
    <Table data-testid="evaluations-table" className="min-w-[760px] table-auto">
      <TableHeader>
        <TableRow>
          <TableHead
            className="min-w-[18rem] pl-8"
            aria-sort={formatAriaSort(sortState.key === "label" ? sortState.direction : false)}
          >
            <SortableHeader
              label="Configuration"
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
        {groups.map((group) => (
          <React.Fragment key={group.candidate.id}>
            <TableRow data-testid="evaluations-candidate-group" className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length + 2}
                className="bg-muted/35 py-2 text-foreground"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="break-words font-medium [overflow-wrap:anywhere]">
                    {group.candidate.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatRunCount(group.rows.length)}
                  </span>
                </div>
              </TableCell>
            </TableRow>
            {group.rows.map((row) => (
              <TableRow
                key={row.rowId}
                className={row.evaluationId && onSelectEvaluation ? "cursor-pointer" : undefined}
                onClick={row.evaluationId && onSelectEvaluation
                  ? () => onSelectEvaluation(row.evaluationId!)
                  : undefined}
              >
                <TableCell className="min-w-[18rem] align-top whitespace-normal pl-8">
                  <div className="grid min-w-0 gap-1">
                    <span className="break-words font-medium text-foreground [overflow-wrap:anywhere]">
                      {row.configurationLabel}
                    </span>
                    <Badge variant="outline" className="w-fit">
                      {row.statusLabel}
                    </Badge>
                    {row.policyText ? (
                      <span className="text-xs text-muted-foreground">
                        {row.policyText}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                {columns.map((descriptor) => (
                  <TableCell key={descriptor.id} className="align-top text-muted-foreground">
                    {row.evaluation
                      ? formatEvaluationMetricStats(
                          descriptor,
                          getEvaluationMetricStats(row.evaluation, descriptor),
                          row.evaluation,
                        )
                      : "—"}
                  </TableCell>
                ))}
                <TableCell className="align-top text-muted-foreground">
                  {row.sampleText}
                </TableCell>
              </TableRow>
            ))}
          </React.Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

interface EvaluationTableGroup {
  candidate: EvaluationTableCandidate;
  rows: EvaluationDataTableRow[];
}

interface EvaluationTableCandidate {
  id: string;
  label: string;
}

export interface EvaluationDataTableRow {
  rowId: string;
  candidateId: string;
  label: string;
  configurationLabel: string;
  statusLabel: string;
  sampleText: string;
  policyText?: string | null;
  evaluation: LabeledEvaluationSummary | null;
  evaluationId: string | null;
}

function buildEvaluationGroups(
  evaluations: EvaluationDataTableRow[],
  candidates: EvaluationTableCandidate[],
): EvaluationTableGroup[] {
  const rowsByCandidate = new Map<string, EvaluationDataTableRow[]>();
  for (const evaluation of evaluations) {
    appendEvaluationRow(rowsByCandidate, evaluation);
  }

  const groups: EvaluationTableGroup[] = [];
  for (const candidate of candidates) {
    const rows = rowsByCandidate.get(candidate.id);
    if (!rows?.length) {
      continue;
    }
    groups.push({ candidate, rows });
    rowsByCandidate.delete(candidate.id);
  }

  for (const rows of rowsByCandidate.values()) {
    groups.push({
      candidate: {
        id: rows[0]!.candidateId,
        label: candidateLabelFromRow(rows[0]!),
      },
      rows,
    });
  }

  return groups;
}

function candidateLabelFromRow(row: EvaluationDataTableRow): string {
  if (row.evaluation) {
    return resolveEvaluationCandidateDisplay(row.evaluation).candidateLabel;
  }
  return row.label.split(" · ", 1)[0] ?? row.candidateId;
}

function appendEvaluationRow(
  map: Map<string, EvaluationDataTableRow[]>,
  evaluation: EvaluationDataTableRow,
): void {
  const rows = map.get(evaluation.candidateId);
  if (rows) {
    rows.push(evaluation);
  } else {
    map.set(evaluation.candidateId, [evaluation]);
  }
}

function formatRunCount(count: number): string {
  return count === 1 ? "1 run" : `${count} runs`;
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

function sortEvaluationRows(
  evaluations: EvaluationDataTableRow[],
  sortState: { key: string; direction: SortDirection },
  sortDescriptor: EvaluationMetricDescriptor | null,
): EvaluationDataTableRow[] {
  const activeDescriptor = sortDescriptor ?? buildFallbackDescriptor(sortState.key);
  return [...evaluations].sort((left, right) => {
    const normalized = sortState.key === "label"
      ? left.configurationLabel.localeCompare(right.configurationLabel)
      : compareMetricValues(
          left.evaluation ? getEvaluationMetricValue(left.evaluation, activeDescriptor) : undefined,
          right.evaluation ? getEvaluationMetricValue(right.evaluation, activeDescriptor) : undefined,
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
