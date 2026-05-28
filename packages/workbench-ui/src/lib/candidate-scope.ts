import type { CandidateSummary } from "../types";

export function normalizeBenchmarkFingerprint(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function candidateBenchmarkKey(
  summary: CandidateSummary | null | undefined,
): string | null {
  return normalizeBenchmarkFingerprint(summary?.benchmarkFingerprint);
}

export function filterCandidateSummariesByBenchmark({
  summaries,
  benchmarkFingerprint,
}: {
  summaries: readonly CandidateSummary[];
  benchmarkFingerprint: string | null | undefined;
}): CandidateSummary[] {
  const benchmarkKey = normalizeBenchmarkFingerprint(benchmarkFingerprint);
  if (!benchmarkKey) {
    return [];
  }

  return summaries.filter((summary) => candidateBenchmarkKey(summary) === benchmarkKey);
}
