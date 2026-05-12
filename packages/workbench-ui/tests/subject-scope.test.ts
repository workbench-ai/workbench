import { describe, expect, test } from "vitest";

import {
  subjectBenchmarkKey,
  filterSubjectSummariesByBenchmark,
  normalizeBenchmarkFingerprint,
} from "../src/lib/subject-scope";
import type { SubjectSummary } from "../src/types";

function subject(
  id: string,
  benchmarkFingerprint: string,
  createdAt = "2026-01-01T00:00:00.000Z",
): SubjectSummary {
  return {
    id,
    ordinal: 0,
    benchmarkFingerprint,
    createdAt,
    referenceIds: [],
    status: "evaluated",
    fileChanges: [],
  };
}

describe("subject benchmark scope", () => {
  test("filters only by the supplied benchmark fingerprint", () => {
    const summaries = [
      subject("a", "1111111111111111111111111111111111111111111111111111111111111111"),
      subject("b", "1111111111111111111111111111111111111111111111111111111111111111"),
      subject("c", "2222222222222222222222222222222222222222222222222222222222222222"),
      subject("d", "2222222222222222222222222222222222222222222222222222222222222222"),
    ];

    const scoped = filterSubjectSummariesByBenchmark({
      summaries,
      benchmarkFingerprint: "2222222222222222222222222222222222222222222222222222222222222222",
    });

    expect(scoped.map((summary) => summary.id)).toEqual(["c", "d"]);
  });

  test("does not fall back to all subjects when no fingerprint is recorded", () => {
    const summaries = [
      subject("a", "1111111111111111111111111111111111111111111111111111111111111111"),
      subject("b", "2222222222222222222222222222222222222222222222222222222222222222"),
    ];

    expect(filterSubjectSummariesByBenchmark({
      summaries,
      benchmarkFingerprint: null,
    })).toEqual([]);
    expect(filterSubjectSummariesByBenchmark({
      summaries,
      benchmarkFingerprint: "   ",
    })).toEqual([]);
  });

  test("normalizes subject and snapshot fingerprints before comparing", () => {
    expect(normalizeBenchmarkFingerprint("  1111111111111111111111111111111111111111111111111111111111111111  ")).toBe("1111111111111111111111111111111111111111111111111111111111111111");
    expect(subjectBenchmarkKey(subject("a", "  1111111111111111111111111111111111111111111111111111111111111111  "))).toBe("1111111111111111111111111111111111111111111111111111111111111111");
    expect(filterSubjectSummariesByBenchmark({
      summaries: [
        subject("a", "  1111111111111111111111111111111111111111111111111111111111111111  "),
        subject("b", "2222222222222222222222222222222222222222222222222222222222222222"),
      ],
      benchmarkFingerprint: "1111111111111111111111111111111111111111111111111111111111111111",
    }).map((summary) => summary.id)).toEqual(["a"]);
  });
});
