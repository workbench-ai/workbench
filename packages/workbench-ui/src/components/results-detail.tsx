import { ChartColumnIcon } from "lucide-react";
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workbench-ai/cli-web-ui/components/ui/card";

import { formatResultCandidateLabel } from "../lib/format";
import { buildResultMetricDescriptors } from "../lib/result-metrics";
import type {
  LabeledEvaluationResultRecord,
  EvaluationResultRecord,
} from "../types";
import { ResultCharts } from "./result-charts";
import { ResultsDataTable } from "./results-data-table";
import { ResultsDetailSkeleton } from "./loading-states";

export function ResultsDetail({
  resultRecords,
  loading,
  error,
  hasResults,
}: {
  resultRecords: EvaluationResultRecord[];
  loading: boolean;
  error: string | null;
  hasResults: boolean;
}) {
  if (loading) {
    return <ResultsDetailSkeleton />;
  }

  if (error) {
    return (
      <EmptyState
        icon={ChartColumnIcon}
        eyebrow="Results"
        title="Results unavailable"
        message={error}
        variant="hero"
        size="sm"
      />
    );
  }

  const labeledResults = resultRecords.map(toLabeledResult);

  if (resultRecords.length === 0) {
    return (
      <EmptyState
        icon={ChartColumnIcon}
        eyebrow="Results"
        title={hasResults ? "Results unavailable" : "No results yet"}
        message={hasResults
          ? "The recorded results could not be loaded from run state."
          : "Run an evaluation or improvement to record candidate results."}
        variant="hero"
        size="sm"
      />
    );
  }

  const descriptors = buildResultMetricDescriptors(resultRecords);

  return (
    <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3">
      <Card size="sm" className="min-w-0">
        <CardHeader>
          <CardTitle>Results</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto py-0">
          <ResultsDataTable
            results={labeledResults}
            descriptors={descriptors}
          />
        </CardContent>
      </Card>

      <ResultCharts
        results={labeledResults}
        descriptors={descriptors}
      />
    </div>
  );
}

function toLabeledResult(result: EvaluationResultRecord): LabeledEvaluationResultRecord {
  return {
    ...result,
    label: formatResultLabel(result),
  };
}

function formatResultLabel(
  result: EvaluationResultRecord,
): string {
  const subjectLabel = result.evaluation.subject.label;
  return subjectLabel ?? formatResultCandidateLabel(result.candidateId);
}
