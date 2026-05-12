import type { SubjectSummary } from "../types";

export function normalizeBenchmarkFingerprint(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function subjectBenchmarkKey(
  summary: SubjectSummary | null | undefined,
): string | null {
  return normalizeBenchmarkFingerprint(summary?.benchmarkFingerprint);
}

export function filterSubjectSummariesByBenchmark({
  summaries,
  benchmarkFingerprint,
}: {
  summaries: readonly SubjectSummary[];
  benchmarkFingerprint: string | null | undefined;
}): SubjectSummary[] {
  const benchmarkKey = normalizeBenchmarkFingerprint(benchmarkFingerprint);
  if (!benchmarkKey) {
    return [];
  }

  return summaries.filter((summary) => subjectBenchmarkKey(summary) === benchmarkKey);
}
