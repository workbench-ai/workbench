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
  buildEvaluationCandidateColorMap,
  buildEvaluationCandidatePresentations,
  formatEvaluationConfigurationLabel,
  resolveEvaluationCandidateDisplay,
} from "../lib/candidate-evaluation-display";
import { buildEvaluationMetricDescriptors } from "../lib/evaluation-metrics";
import {
  formatRunPolicyText,
  type EvaluationRuntimeRow,
} from "../lib/runtime-state";
import { shortId, statusLabel } from "../lib/format";
import type {
  LabeledEvaluationSummary,
  EvaluationSummary,
} from "../types";
import { EvaluationCharts } from "./evaluation-charts";
import { EvaluationsDataTable, type EvaluationDataTableRow } from "./evaluations-data-table";
import { CandidateComparisonFilter } from "./candidate-comparison-filter";

export function EvaluationsDetail({
  evaluations,
  rows,
  candidateLabelById,
  hasEvaluations,
  onSelectEvaluation,
}: {
  evaluations: EvaluationSummary[];
  rows: EvaluationRuntimeRow[];
  candidateLabelById?: ReadonlyMap<string, string>;
  hasEvaluations: boolean;
  onSelectEvaluation?: (evaluationId: string) => void;
}) {
  const candidateOptions = React.useMemo(
    () => mergeEvaluationCandidatePresentations(
      buildEvaluationCandidatePresentations(evaluations),
      rows,
      candidateLabelById,
    ),
    [candidateLabelById, evaluations, rows],
  );
  const resolvedCandidateLabelById = React.useMemo(
    () => new Map(candidateOptions.map((candidate) => [candidate.id, candidate.label])),
    [candidateOptions],
  );
  const labeledEvaluations = React.useMemo(
    () => evaluations.map((evaluation) => toLabeledEvaluation(evaluation, resolvedCandidateLabelById)),
    [evaluations, resolvedCandidateLabelById],
  );
  const tableRows = React.useMemo(
    () => rows.map((row) => toEvaluationDataTableRow(row, resolvedCandidateLabelById)),
    [resolvedCandidateLabelById, rows],
  );
  const candidateColorById = React.useMemo(
    () => buildEvaluationCandidateColorMap(candidateOptions),
    [candidateOptions],
  );
  const allCandidateIds = React.useMemo(
    () => candidateOptions.map((option) => option.id),
    [candidateOptions],
  );
  const [selectedCandidateIds, setSelectedCandidateIds] = React.useState<Set<string> | null>(
    null,
  );
  const selectedCandidateIdSet = React.useMemo(() => {
    if (selectedCandidateIds === null) {
      return new Set(allCandidateIds);
    }

    const available = new Set(allCandidateIds);
    return new Set(
      [...selectedCandidateIds].filter((candidateId) => available.has(candidateId)),
    );
  }, [allCandidateIds, selectedCandidateIds]);
  const filteredRows = React.useMemo(() => {
    if (selectedCandidateIdSet.size === candidateOptions.length) {
      return tableRows;
    }
    return tableRows.filter((row) =>
      selectedCandidateIdSet.has(row.candidateId),
    );
  }, [tableRows, selectedCandidateIdSet, candidateOptions.length]);
  const filteredEvaluations = React.useMemo(() => {
    if (selectedCandidateIdSet.size === candidateOptions.length) {
      return labeledEvaluations;
    }
    return labeledEvaluations.filter((evaluation) =>
      selectedCandidateIdSet.has(evaluation.candidateId),
    );
  }, [labeledEvaluations, selectedCandidateIdSet, candidateOptions.length]);
  const filteredCandidateOptions = React.useMemo(
    () => candidateOptions.filter((candidate) =>
      selectedCandidateIdSet.has(candidate.id),
    ),
    [candidateOptions, selectedCandidateIdSet],
  );

  if (rows.length === 0) {
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
          <CardTitle>Runs and scorecards</CardTitle>
          {candidateOptions.length > 1 ? (
            <CardAction>
              <CandidateComparisonFilter
                options={candidateOptions}
                selectedCandidateIds={selectedCandidateIdSet}
                testId="evaluations-candidate-filter"
                onSelectAll={() => setSelectedCandidateIds(null)}
                onClear={() => setSelectedCandidateIds(new Set())}
                onToggleCandidate={(candidateId, checked) => {
                  setSelectedCandidateIds((current) => {
                    const next = new Set(
                      current === null ? allCandidateIds : [...current],
                    );
                    if (checked) {
                      next.add(candidateId);
                    } else {
                      next.delete(candidateId);
                    }
                    return next.size === allCandidateIds.length ? null : next;
                  });
                }}
              />
            </CardAction>
          ) : null}
        </CardHeader>
        {filteredRows.length > 0 ? (
          <CardContent className="overflow-x-auto py-0">
            <EvaluationsDataTable
              rows={filteredRows}
              descriptors={descriptors}
              candidates={filteredCandidateOptions}
              onSelectEvaluation={onSelectEvaluation}
            />
          </CardContent>
        ) : (
          <CardContent className="py-6">
            <EmptyState
              icon={ChartColumnIcon}
              title="No candidates selected"
              message="Select at least one candidate to compare scorecards."
              size="sm"
            />
          </CardContent>
        )}
      </Card>

      {filteredEvaluations.length > 0 ? (
        <EvaluationCharts
          evaluations={filteredEvaluations}
          descriptors={descriptors}
          candidates={filteredCandidateOptions}
          candidateColorById={candidateColorById}
        />
      ) : null}
    </div>
  );
}

function mergeEvaluationCandidatePresentations(
  evaluationCandidates: ReturnType<typeof buildEvaluationCandidatePresentations>,
  rows: readonly EvaluationRuntimeRow[],
  candidateLabelById: ReadonlyMap<string, string> | undefined,
): ReturnType<typeof buildEvaluationCandidatePresentations> {
  const byId = new Map<string, { id: string; label: string; color?: string }>(
    evaluationCandidates.map((candidate) => [candidate.id, candidate]),
  );
  for (const row of rows) {
    if (byId.has(row.candidateId)) {
      continue;
    }
    byId.set(row.candidateId, {
      id: row.candidateId,
      label: candidateLabelById?.get(row.candidateId) ?? shortId(row.candidateId) ?? row.candidateId,
    });
  }
  return [...byId.values()]
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((candidate, index) => ({
      ...candidate,
      color: candidate.color ?? getCategoricalChartColor(index),
    }));
}

function toEvaluationDataTableRow(
  row: EvaluationRuntimeRow,
  candidateLabelById: ReadonlyMap<string, string>,
): EvaluationDataTableRow {
  if (row.kind === "evaluation") {
    const evaluation = toLabeledEvaluation(row.evaluation, candidateLabelById);
    return {
      rowId: row.rowId,
      candidateId: row.candidateId,
      label: evaluation.label,
      configurationLabel: formatEvaluationConfigurationLabel(row.evaluation),
      statusLabel: statusLabel(row.evaluation.status),
      sampleText: formatEvaluationSampleText(row.evaluation),
      policyText: formatRunPolicyText(row.run),
      evaluation,
      evaluationId: row.evaluation.id,
    };
  }
  return {
    rowId: row.rowId,
    candidateId: row.candidateId,
    label: `${candidateLabelById.get(row.candidateId) ?? shortId(row.candidateId)} · ${formatRunConfigurationLabel(row)}`,
    configurationLabel: formatRunConfigurationLabel(row),
    statusLabel: row.statusLabel,
    sampleText: formatRunSampleText(row),
    policyText: formatRunPolicyText(row.run),
    evaluation: null,
    evaluationId: null,
  };
}

function formatEvaluationSampleText(evaluation: EvaluationSummary): string {
  const errorText = evaluation.errorSampleCount > 0 ? ` error ${evaluation.errorSampleCount}` : "";
  return `${evaluation.completedSampleCount}/${evaluation.sampleCount}${errorText}`;
}

function formatRunConfigurationLabel(row: Extract<EvaluationRuntimeRow, { kind: "run" }>): string {
  return row.run.candidateRunName ?? row.run.candidateRunId ?? (
    row.run.workflow === "eval" ? "Evaluation run" : "Improve run"
  );
}

function formatRunSampleText(row: Extract<EvaluationRuntimeRow, { kind: "run" }>): string {
  const attempts = `${row.run.attemptsExecuted}/${row.run.attemptsRequested} attempts`;
  const samples = row.run.samples === 1 ? "1 sample" : `${row.run.samples} samples`;
  return `${attempts} · ${samples}`;
}

function toLabeledEvaluation(
  evaluation: EvaluationSummary,
  candidateLabelById: ReadonlyMap<string, string>,
): LabeledEvaluationSummary {
  return {
    ...evaluation,
    label: formatEvaluationLabel(evaluation, candidateLabelById),
  };
}

function formatEvaluationLabel(
  evaluation: EvaluationSummary,
  candidateLabelById: ReadonlyMap<string, string>,
): string {
  const display = resolveEvaluationCandidateDisplay(evaluation);
  const candidateLabel = candidateLabelById.get(evaluation.candidateId) ?? display.candidateLabel;
  return `${candidateLabel} · ${display.configurationLabel}`;
}
