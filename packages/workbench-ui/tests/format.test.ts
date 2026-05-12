import { describe, expect, test } from "vitest";

import {
  badgeToneForStatus,
  formatDurationMs,
  formatMetricSummary,
  formatMetricValue,
  formatRunStartSummary,
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

  test("formats run start summaries from the shared run contract", () => {
    expect(
      formatRunStartSummary({
        id: "run-123",
        workflow: "eval",
        status: "finished",
        startedAt: "2026-04-14T00:00:00.000Z",
        optimizer: "flow",
        score: "harbor",
        strategy: "greedy",
        budget: 1,
        repairBudget: 2,
        trialsRequested: 1,
        trialsExecuted: 1,
        samples: 1,
        sampleConcurrency: 1,
      }),
    ).toBe("eval started");
  });
});
