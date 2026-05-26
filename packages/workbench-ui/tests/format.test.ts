import { describe, expect, test } from "vitest";

import {
  badgeToneForStatus,
  formatDurationMs,
  formatMetricSummary,
  formatMetricValue,
  formatSubjectDisplayName,
  formatSubjectSecondaryLabel,
  formatWorkspaceLabel,
  hasMetricValues,
  shortId,
} from "../src/lib/format";

describe("format helpers", () => {
  test("shortId keeps the first 12 characters and tolerates nullish input", () => {
    expect(shortId("subject-1234567890")).toBe("subject-1234");
    expect(shortId(null)).toBeNull();
    expect(shortId(undefined)).toBeNull();
  });

  test("subject display names prefer authored names over generated ids", () => {
    expect(formatSubjectDisplayName({
      id: "subject_abc123456789",
      name: "Codex GPT-5.5",
    })).toBe("Codex GPT-5.5");
    expect(formatSubjectDisplayName({
      subjectId: "subject_def123456789",
      subjectName: "Codex GPT-5.4 Mini",
    })).toBe("Codex GPT-5.4 Mini");
    expect(formatSubjectDisplayName({ id: "subject_abc123456789" })).toBe("subject_abc1");
  });

  test("subject secondary labels use plain workflow language", () => {
    expect(formatSubjectSecondaryLabel({
      id: "subject_base",
      name: "Baseline",
      ordinal: 0,
      benchmarkFingerprint: "benchmark",
      subjectFingerprint: "fingerprint",
      createdAt: "2026-01-01T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
    })).toBe("Initial");
    expect(formatSubjectSecondaryLabel({
      id: "subject_child",
      name: "Improved",
      baseId: "subject_base",
      ordinal: 1,
      benchmarkFingerprint: "benchmark",
      subjectFingerprint: "fingerprint",
      createdAt: "2026-01-01T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
    }, {
      id: "subject_base",
      name: "Baseline",
      ordinal: 0,
      benchmarkFingerprint: "benchmark",
      subjectFingerprint: "fingerprint",
      createdAt: "2026-01-01T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
    })).toBe("From Baseline");
  });

  test("formatWorkspaceLabel returns the trailing folder name", () => {
    expect(formatWorkspaceLabel("/tmp/workbench/example-workspace")).toBe("example-workspace");
    expect(formatWorkspaceLabel("C:\\repo\\demo")).toBe("demo");
    expect(formatWorkspaceLabel(undefined)).toBe("Unknown workspace");
  });

  test("badgeToneForStatus maps runtime states to shared badge variants", () => {
    expect(badgeToneForStatus("evaluated")).toBe("success");
    expect(badgeToneForStatus("repair_exhausted")).toBe("warning");
    expect(badgeToneForStatus("eval_error")).toBe("destructive");
    expect(badgeToneForStatus(undefined)).toBe("outline");
  });

  test("formats floating metrics to two decimals by default", () => {
    expect(formatMetricValue(3)).toBe("3");
    expect(formatMetricValue(3.14159)).toBe("3.14");
    expect(formatMetricValue(0.1)).toBe("0.10");
  });

  test("metric summaries use the rounded metric display", () => {
    expect(
      formatMetricSummary({
        calmar: 0.853969,
        sharpe: 1.413093,
        max_dd: 2,
      }),
    ).toBe("calmar: 0.85 · sharpe: 1.41");
    expect(formatMetricSummary({ broken: Number.NaN })).toBe("No metrics");
    expect(hasMetricValues({ broken: Number.NaN })).toBe(false);
    expect(hasMetricValues({ accuracy: 0.75 })).toBe(true);
  });

  test("formats run durations for the shell header", () => {
    expect(formatDurationMs(undefined)).toBe("unknown");
    expect(formatDurationMs(950)).toBe("950ms");
    expect(formatDurationMs(3_500)).toBe("3s");
    expect(formatDurationMs(125_000)).toBe("2m 5s");
  });
});
