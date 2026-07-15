import { describe, expect, test } from "vitest";

import {
  workbenchRunOwnsJob,
  type WorkbenchJob,
  type WorkbenchRun,
} from "@workbench-ai/workbench-contract";

import {
  directoryPathForFile,
  fileName,
  formatCost,
  formatCount,
  formatDurationMs,
  formatReportCost,
  formatScore,
  formatStatus,
  formatTimestamp,
  jobsForRun,
  runScore,
  shortId,
} from "../src/lib/format";

describe("format helpers", () => {
  test("shortId keeps a prefix and tolerates nullish input", () => {
    expect(shortId("agent_hash_1234567890")).toBe("agent_hash_1");
    expect(shortId("agent", 3)).toBe("age");
    expect(shortId(null)).toBe("n/a");
    expect(shortId(undefined)).toBe("n/a");
  });

  test("formatScore renders three decimals and guards non-finite values", () => {
    expect(formatScore(0.92)).toBe("0.920");
    expect(formatScore(1)).toBe("1.000");
    expect(formatScore(Number.NaN)).toBe("n/a");
    expect(formatScore(undefined)).toBe("n/a");
    expect(formatScore(null)).toBe("n/a");
  });

  test("formatCost renders USD with up to two decimals", () => {
    expect(formatCost(0.1234)).toBe("$0.12");
    expect(formatCost(0.126)).toBe("$0.13");
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(Number.POSITIVE_INFINITY)).toBe("n/a");
    expect(formatCost(undefined)).toBe("n/a");
  });

  test("formatReportCost explains missing usage states", () => {
    expect(formatReportCost({
      unitCount: 1,
      jobCount: 1,
      roles: [{
        role: "run",
        jobCount: 1,
        queued: 0,
        running: 0,
        succeeded: 1,
        failed: 0,
        canceled: 0,
        costUsd: 0.0123,
      }],
    }, "succeeded")).toBe("$0.01");
    expect(formatReportCost(undefined, "failed")).toBe("Failed before usage");
    expect(formatReportCost(undefined, "succeeded")).toBe("Not reported");
  });

  test("treats run.jobIds as run-owned evidence", () => {
    const reusedGradeJob = gradeJob({
      id: "job_reused_grade",
      runId: "run_original",
      score: 0.82,
    });
    const unrelatedGradeJob = gradeJob({
      id: "job_unrelated_grade",
      runId: "run_unrelated",
      score: 0.2,
    });
    const cachedRun = run({
      id: "run_cached",
      jobIds: [reusedGradeJob.id],
    });

    expect(workbenchRunOwnsJob(cachedRun, reusedGradeJob)).toBe(true);
    expect(jobsForRun(cachedRun, [reusedGradeJob, unrelatedGradeJob]).map((job) => job.id))
      .toEqual([reusedGradeJob.id]);
    expect(runScore(cachedRun, [reusedGradeJob, unrelatedGradeJob])).toBe(0.82);
  });

  test("formatDurationMs scales from milliseconds to minutes", () => {
    expect(formatDurationMs(undefined)).toBe("n/a");
    expect(formatDurationMs(Number.NaN)).toBe("n/a");
    expect(formatDurationMs(950)).toBe("950ms");
    expect(formatDurationMs(1_500)).toBe("1.5s");
    expect(formatDurationMs(3_000)).toBe("3s");
    expect(formatDurationMs(125_000)).toBe("2m 5s");
  });

  test("formatTimestamp falls back for empty or unparsable values", () => {
    expect(formatTimestamp(null)).toBe("n/a");
    expect(formatTimestamp("")).toBe("n/a");
    expect(formatTimestamp("not-a-date")).toBe("not-a-date");
    expect(formatTimestamp("2026-06-06T00:10:00.000Z")).not.toBe("n/a");
  });

  test("formatTimestamp can format in the browser timezone instead of forcing UTC", () => {
    const value = "2026-06-06T00:10:00.000Z";
    expect(formatTimestamp(value, { locale: "en-US", timeZone: "UTC" })).toBe("Jun 6, 12:10 AM");
    expect(formatTimestamp(value, { locale: "en-US", timeZone: "America/Los_Angeles" })).toBe("Jun 5, 5:10 PM");
  });

  test("formatStatus humanizes snake and kebab case", () => {
    expect(formatStatus("repair_exhausted")).toBe("repair exhausted");
    expect(formatStatus("in-progress")).toBe("in progress");
    expect(formatStatus(undefined)).toBe("unknown");
  });

  test("formatCount pluralizes counts including irregular nouns", () => {
    expect(formatCount(1, "run")).toBe("1 run");
    expect(formatCount(2, "run")).toBe("2 runs");
    expect(formatCount(0, "entry")).toBe("0 entries");
    expect(formatCount(2, "child")).toBe("2 children");
  });

  test("file path helpers split names and directories", () => {
    expect(fileName("output/result.json")).toBe("result.json");
    expect(fileName("SKILL.md")).toBe("SKILL.md");
    expect(directoryPathForFile("output/result.json")).toBe("output");
    expect(directoryPathForFile("SKILL.md")).toBeNull();
    expect(directoryPathForFile(null)).toBeNull();
  });
});

function run(overrides: Partial<WorkbenchRun> & { id: string }): WorkbenchRun {
  return {
    kind: "eval",
    versionId: "v001",
    skillName: "current",
    skillBundleHash: "bundle",
    evalHash: "eval",
    agentName: "default",
    agentHash: "agent",
    status: "succeeded",
    traceIds: [],
    createdAt: "2026-06-06T00:00:00.000Z",
    ...overrides,
  };
}

function gradeJob(overrides: Partial<WorkbenchJob> & { id: string; runId: string; score: number }): WorkbenchJob {
  const { score, ...rest } = overrides;
  return {
    kind: "eval",
    role: "grade",
    versionId: "v001",
    skillName: "current",
    skillBundleHash: "bundle",
    evalHash: "eval",
    agentName: "default",
    agentHash: "agent",
    caseId: "case-001",
    sample: 0,
    status: "succeeded",
    artifactIds: [],
    traceIds: [],
    createdAt: "2026-06-06T00:00:00.000Z",
    result: { items: [{ kind: "score", score, value: score }] },
    ...rest,
  };
}
