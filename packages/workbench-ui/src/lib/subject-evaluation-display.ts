import type { EvaluationSummary } from "../types";
import { formatMetricValue, shortId, statusLabel } from "./format";

export interface SubjectEvaluationDisplay {
  evaluation: EvaluationSummary | null;
  scoreText: string;
  sourceText: string;
  ariaText: string;
}

export function buildLatestEvaluationBySubject(
  evaluations: readonly EvaluationSummary[],
): Map<string, EvaluationSummary> {
  const latestBySubject = new Map<string, EvaluationSummary>();
  for (const evaluation of evaluations) {
    const current = latestBySubject.get(evaluation.subjectId);
    if (!current || compareEvaluationRecency(evaluation, current) > 0) {
      latestBySubject.set(evaluation.subjectId, evaluation);
    }
  }
  return latestBySubject;
}

export function resolveSubjectEvaluationDisplay(args: {
  latestEvaluation: EvaluationSummary | null;
}): SubjectEvaluationDisplay {
  const evaluation = args.latestEvaluation;
  if (!evaluation) {
    return {
      evaluation: null,
      scoreText: "No score",
      sourceText: "No evaluation yet",
      ariaText: "No latest evaluation score",
    };
  }

  const score = evaluation.metrics?.score?.mean;
  const scoreText = Number.isFinite(score)
    ? `Score ${formatMetricValue(score as number)}`
    : "Score not recorded";
  const evaluationLabel = shortId(evaluation.id) ?? evaluation.id;
  const sourceText = `Latest evaluation ${evaluationLabel}`;
  const statusText = statusLabel(evaluation.status);
  return {
    evaluation,
    scoreText,
    sourceText,
    ariaText: `${scoreText} from ${sourceText}, ${statusText}`,
  };
}

function compareEvaluationRecency(
  left: EvaluationSummary,
  right: EvaluationSummary,
): number {
  const updatedOrder = left.updatedAt.localeCompare(right.updatedAt);
  if (updatedOrder !== 0) {
    return updatedOrder;
  }
  return left.createdAt.localeCompare(right.createdAt);
}
