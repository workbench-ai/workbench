import { getCategoricalChartColor } from "@workbench-ai/cli-web-ui/lib/chart-colors";
import {
  formatEvaluationConfigurationLabel,
  isCompleteEvaluationSummary,
  readEvaluationScore,
} from "@workbench-ai/workbench-contract";

import type { EvaluationSummary } from "../types";
import {
  formatMetricValue,
  formatCandidateDisplayName,
  shortId,
} from "./format";

export interface EvaluationCandidateDisplay {
  candidateLabel: string;
  configurationLabel: string;
  label: string;
}

export interface EvaluationCandidatePresentation {
  id: string;
  label: string;
  color: string;
}

export interface CandidateEvaluationRollup {
  candidateId: string;
  evaluationCount: number;
  scoredEvaluationCount: number;
  bestEvaluation: EvaluationSummary | null;
  bestScore: number | null;
  bestConfigurationLabel: string | null;
  meanScore: number | null;
}

export interface CandidateEvaluationRollupDisplay {
  scoreText: string;
  meanText: string;
  bestConfigurationText: string;
  countText: string;
  ariaText: string;
}

export function buildCandidateEvaluationRollups(
  evaluations: readonly EvaluationSummary[],
): Map<string, CandidateEvaluationRollup> {
  const evaluationsByCandidate = buildEvaluationsByCandidate(evaluations);
  return new Map(
    [...evaluationsByCandidate.entries()].map(([candidateId, candidateEvaluations]) => [
      candidateId,
      buildCandidateEvaluationRollup(candidateId, candidateEvaluations),
    ]),
  );
}

export function buildCandidateEvaluationRollup(
  candidateId: string,
  evaluations: readonly EvaluationSummary[],
): CandidateEvaluationRollup {
  const scored = evaluations
    .filter(isCompleteEvaluationSummary)
    .map((evaluation) => ({
      evaluation,
      score: readEvaluationScore(evaluation),
    }))
    .filter((entry): entry is { evaluation: EvaluationSummary; score: number } =>
      entry.score !== null,
    );
  const best = scored
    .slice()
    .sort((left, right) =>
      right.score - left.score ||
      compareEvaluationRecency(right.evaluation, left.evaluation),
    )[0] ?? null;
  const meanScore = scored.length > 0
    ? scored.reduce((sum, entry) => sum + entry.score, 0) / scored.length
    : null;

  return {
    candidateId,
    evaluationCount: evaluations.length,
    scoredEvaluationCount: scored.length,
    bestEvaluation: best?.evaluation ?? null,
    bestScore: best?.score ?? null,
    bestConfigurationLabel: best ? formatEvaluationConfigurationLabel(best.evaluation) : null,
    meanScore,
  };
}

export function buildEvaluationsByCandidate(
  evaluations: readonly EvaluationSummary[],
): Map<string, EvaluationSummary[]> {
  const byCandidate = new Map<string, EvaluationSummary[]>();
  for (const evaluation of evaluations) {
    appendMapEntry(byCandidate, evaluation.candidateId, evaluation);
  }
  for (const [candidateId, entries] of byCandidate.entries()) {
    byCandidate.set(candidateId, entries.sort((left, right) => {
      return compareDisplayText(formatEvaluationConfigurationLabel(left), formatEvaluationConfigurationLabel(right)) ||
        compareEvaluationRecency(right, left);
    }));
  }
  return byCandidate;
}

export function buildEvaluationCandidatePresentations(
  evaluations: readonly EvaluationSummary[],
): EvaluationCandidatePresentation[] {
  const candidatesById = new Map<string, Omit<EvaluationCandidatePresentation, "color">>();
  for (const evaluation of evaluations) {
    if (!candidatesById.has(evaluation.candidateId)) {
      const display = resolveEvaluationCandidateDisplay(evaluation);
      candidatesById.set(evaluation.candidateId, {
        id: evaluation.candidateId,
        label: display.candidateLabel,
      });
    }
  }

  const sortedCandidates = [...candidatesById.values()]
    .sort((left, right) =>
      compareDisplayText(left.label, right.label) ||
      compareDisplayText(left.id, right.id),
    );
  const labelCounts = countCandidateLabels(sortedCandidates);

  return sortedCandidates.map((candidate, index) => ({
    ...disambiguateDuplicateCandidateLabel(candidate, labelCounts),
    color: getCategoricalChartColor(index),
  }));
}

export function buildEvaluationCandidateColorMap(
  candidates: readonly EvaluationCandidatePresentation[],
): Map<string, string> {
  return new Map(candidates.map((candidate) => [candidate.id, candidate.color]));
}

export function resolveEvaluationCandidateDisplay(
  evaluation: EvaluationSummary,
): EvaluationCandidateDisplay {
  const candidateLabel = formatCandidateDisplayName(evaluation);
  const configurationLabel = formatEvaluationConfigurationLabel(evaluation);
  return {
    candidateLabel,
    configurationLabel,
    label: `${candidateLabel} · ${configurationLabel}`,
  };
}

export {
  formatEvaluationConfigurationLabel,
  isCompleteEvaluationSummary,
  readEvaluationScore,
};

export function resolveCandidateEvaluationRollupDisplay(
  rollup: CandidateEvaluationRollup | null | undefined,
): CandidateEvaluationRollupDisplay {
  if (!rollup || rollup.evaluationCount === 0) {
    return {
      scoreText: "No evaluations",
      meanText: "Mean —",
      bestConfigurationText: "Best configuration —",
      countText: "0 evaluations",
      ariaText: "No evaluations",
    };
  }

  const scoreText = rollup.bestScore === null
    ? "Best score —"
    : `Best score ${formatMetricValue(rollup.bestScore)}`;
  const meanText = rollup.meanScore === null
    ? "Mean —"
    : `Mean ${formatMetricValue(rollup.meanScore)}`;
  const bestConfigurationText = rollup.bestConfigurationLabel
    ? `Best configuration ${rollup.bestConfigurationLabel}`
    : "Best configuration —";
  const countText = formatEvaluationCount(rollup.evaluationCount);
  return {
    scoreText,
    meanText,
    bestConfigurationText,
    countText,
    ariaText: `${scoreText}, ${meanText}, ${bestConfigurationText}, ${countText}`,
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

function formatEvaluationCount(count: number): string {
  return count === 1 ? "1 evaluation" : `${count} evaluations`;
}

function compareDisplayText(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function countCandidateLabels(
  candidates: Array<Omit<EvaluationCandidatePresentation, "color">>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.label, (counts.get(candidate.label) ?? 0) + 1);
  }
  return counts;
}

function disambiguateDuplicateCandidateLabel(
  candidate: Omit<EvaluationCandidatePresentation, "color">,
  labelCounts: ReadonlyMap<string, number>,
): Omit<EvaluationCandidatePresentation, "color"> {
  if ((labelCounts.get(candidate.label) ?? 0) <= 1) {
    return candidate;
  }

  const candidateId = shortId(candidate.id) ?? candidate.id;
  return {
    ...candidate,
    label: `${candidate.label} (${candidateId})`,
  };
}

function appendMapEntry<K, V>(
  map: Map<K, V[]>,
  key: K,
  value: V,
): void {
  const entries = map.get(key);
  if (entries) {
    entries.push(value);
  } else {
    map.set(key, [value]);
  }
}
