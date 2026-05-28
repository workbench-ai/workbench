import { describe, expect, test } from "vitest";

import {
  candidateBenchmarkKey,
  filterCandidateSummariesByBenchmark,
  normalizeBenchmarkFingerprint,
} from "../src/lib/candidate-scope";
import type { CandidateSummary } from "../src/types";

function candidate(
  id: string,
  benchmarkFingerprint: string,
  createdAt = "2026-01-01T00:00:00.000Z",
): CandidateSummary {
  return {
    id,
    version: 1,
    ordinal: 1,
    benchmarkFingerprint,
    createdAt,
    referenceIds: [],
    status: "evaluated",
    fileChanges: [],
  };
}

describe("candidate benchmark scope", () => {
  test("filters only by the supplied benchmark fingerprint", () => {
    const summaries = [
      candidate("a", "1111111111111111111111111111111111111111111111111111111111111111"),
      candidate("b", "1111111111111111111111111111111111111111111111111111111111111111"),
      candidate("c", "2222222222222222222222222222222222222222222222222222222222222222"),
      candidate("d", "2222222222222222222222222222222222222222222222222222222222222222"),
    ];

    const scoped = filterCandidateSummariesByBenchmark({
      summaries,
      benchmarkFingerprint: "2222222222222222222222222222222222222222222222222222222222222222",
    });

    expect(scoped.map((summary) => summary.id)).toEqual(["c", "d"]);
  });

  test("does not fall back to all candidates when no fingerprint is recorded", () => {
    const summaries = [
      candidate("a", "1111111111111111111111111111111111111111111111111111111111111111"),
      candidate("b", "2222222222222222222222222222222222222222222222222222222222222222"),
    ];

    expect(filterCandidateSummariesByBenchmark({
      summaries,
      benchmarkFingerprint: null,
    })).toEqual([]);
    expect(filterCandidateSummariesByBenchmark({
      summaries,
      benchmarkFingerprint: "   ",
    })).toEqual([]);
  });

  test("normalizes candidate and snapshot fingerprints before comparing", () => {
    expect(normalizeBenchmarkFingerprint("  1111111111111111111111111111111111111111111111111111111111111111  ")).toBe("1111111111111111111111111111111111111111111111111111111111111111");
    expect(candidateBenchmarkKey(candidate("a", "  1111111111111111111111111111111111111111111111111111111111111111  "))).toBe("1111111111111111111111111111111111111111111111111111111111111111");
    expect(filterCandidateSummariesByBenchmark({
      summaries: [
        candidate("a", "  1111111111111111111111111111111111111111111111111111111111111111  "),
        candidate("b", "2222222222222222222222222222222222222222222222222222222222222222"),
      ],
      benchmarkFingerprint: "1111111111111111111111111111111111111111111111111111111111111111",
    }).map((summary) => summary.id)).toEqual(["a"]);
  });
});
