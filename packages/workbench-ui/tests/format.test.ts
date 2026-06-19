import { describe, expect, test } from "vitest";

import type { WorkbenchAgent } from "@workbench-ai/workbench-contract";

import {
  agentConfigString,
  agentNetworkLabel,
  agentTimeoutLabel,
  directoryPathForFile,
  fileName,
  formatCost,
  formatCount,
  formatDurationMs,
  formatList,
  formatRunCost,
  formatScore,
  formatStatus,
  formatTimestamp,
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

  test("formatRunCost explains missing usage states", () => {
    expect(formatRunCost({ id: "run_cost", status: "succeeded", costUsd: 0.0123 })).toBe("$0.01");
    expect(formatRunCost({ id: "run_failed", status: "failed" })).toBe("Failed before usage");
    expect(formatRunCost({ id: "run_no_usage", status: "succeeded" })).toBe("Not reported");
    expect(formatRunCost(null)).toBe("Not tested");
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

  test("formatList joins values with a configurable empty fallback", () => {
    expect(formatList(["a", "b"])).toBe("a, b");
    expect(formatList([])).toBe("none");
    expect(formatList([], "empty")).toBe("empty");
  });

  test("agentNetworkLabel maps config aliases to open and isolated", () => {
    expect(agentNetworkLabel(agent({ network: true }))).toBe("open");
    expect(agentNetworkLabel(agent({ network: "on" }))).toBe("open");
    expect(agentNetworkLabel(agent({ network: "bridge" }))).toBe("open");
    expect(agentNetworkLabel(agent({ network: false }))).toBe("isolated");
    expect(agentNetworkLabel(agent({ network: "off" }))).toBe("isolated");
    expect(agentNetworkLabel(agent({ network: "none" }))).toBe("isolated");
    expect(agentNetworkLabel(agent({ network: "custom-vpc" }))).toBe("custom-vpc");
    expect(agentNetworkLabel(agent({}))).toBe("default");
  });

  test("agentTimeoutLabel prefers minutes over seconds", () => {
    expect(agentTimeoutLabel(agent({ timeoutMinutes: 7 }))).toBe("7m");
    expect(agentTimeoutLabel(agent({ timeoutSeconds: 30 }))).toBe("30s");
    expect(agentTimeoutLabel(agent({ timeoutMinutes: 7, timeoutSeconds: 30 }))).toBe("7m");
    expect(agentTimeoutLabel(agent({}))).toBe("default");
  });

  test("agentConfigString only returns non-empty strings", () => {
    expect(agentConfigString(agent({ image: "node:22" }), "image")).toBe("node:22");
    expect(agentConfigString(agent({ image: "  " }), "image")).toBeNull();
    expect(agentConfigString(agent({ timeoutMinutes: 7 }), "timeoutMinutes")).toBeNull();
    expect(agentConfigString(agent({}), "image")).toBeNull();
  });

  test("file path helpers split names and directories", () => {
    expect(fileName("output/result.json")).toBe("result.json");
    expect(fileName("SKILL.md")).toBe("SKILL.md");
    expect(directoryPathForFile("output/result.json")).toBe("output");
    expect(directoryPathForFile("SKILL.md")).toBeNull();
    expect(directoryPathForFile(null)).toBeNull();
  });
});

function agent(config: WorkbenchAgent["config"]): WorkbenchAgent {
  return {
    name: "patcher",
    adapter: "command",
    model: "deterministic",
    config,
  };
}
