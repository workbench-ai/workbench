import { ChartColumnIcon } from "lucide-react";
import { EmptyState } from "@workbench-ai/cli-web-ui/components/shared/empty-state";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workbench-ai/cli-web-ui/components/ui/card";

import { formatEvaluationSubjectLabel } from "../lib/format";
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
  const labeledEvaluations = evaluations.map(toLabeledEvaluation);

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

  const descriptors = buildEvaluationMetricDescriptors(labeledEvaluations);

  return (
    <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3">
      <Card size="sm" className="min-w-0">
        <CardHeader>
          <CardTitle>Scorecards</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto py-0">
          <EvaluationsDataTable
            evaluations={labeledEvaluations}
            descriptors={descriptors}
            onSelectEvaluation={onSelectEvaluation}
          />
        </CardContent>
      </Card>

      <EvaluationCharts
        evaluations={labeledEvaluations}
        descriptors={descriptors}
      />
    </div>
  );
}

function toLabeledEvaluation(evaluation: EvaluationSummary): LabeledEvaluationSummary {
  return {
    ...evaluation,
    label: formatEvaluationLabel(evaluation),
  };
}

function formatEvaluationLabel(
  evaluation: EvaluationSummary,
): string {
  return formatEvaluationSubjectLabel(evaluation.subjectId);
}
