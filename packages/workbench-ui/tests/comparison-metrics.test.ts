import { describe, expect, test } from "vitest";

import type {
  WorkbenchAgentSnapshot,
  WorkbenchComparison,
  WorkbenchComparisonCell,
  WorkbenchEvalSnapshot,
  WorkbenchInspectionSnapshot,
  WorkbenchRun,
  WorkbenchSkillBundleSnapshot,
  WorkbenchVersion,
} from "@workbench-ai/workbench-contract";

import {
  buildComparisonEvidenceRows,
  buildComparisonGroups,
  buildComparisonMetricData,
  buildComparisonTableMetricDescriptors,
  comparisonForActiveSkillVersions,
  comparisonForScorecard,
  defaultEvaluationIdForScorecard,
  evaluationOptionsForScorecard,
  formatEvaluationDisplayDetail,
  formatEvaluationDisplayName,
  formatComparisonTableMetricValue,
  formatSkillDisplayName,
  type ComparisonMetricDescriptor,
} from "../src/lib/comparison-metrics";

const SCORE: ComparisonMetricDescriptor = {
  id: "score",
  label: "Score",
  direction: "higher",
  kind: "number",
  semanticRole: "performance",
  primary: true,
};

const LATENCY: ComparisonMetricDescriptor = {
  id: "latencyMs",
  label: "Latency",
  direction: "lower",
  kind: "duration_ms",
  semanticRole: "speed",
  primary: true,
};

describe("comparison metric helpers", () => {
  test("groups scorecard cells by skill setup", () => {
    const comparison = comparisonFixture([
      cell({ versionId: "v001", agentName: "patcher", agentHash: "agent_a" }),
      cell({ versionId: "v001", agentName: "explorer", agentHash: "agent_b" }),
      cell({ versionId: "v002", agentName: "patcher", agentHash: "agent_a" }),
    ]);

    const groups = buildComparisonGroups(comparison);

    expect(groups.map((group) => group.id)).toEqual([
      "setup/active",
    ]);
    expect(groups[0]?.cells).toHaveLength(3);
    expect(groups.map((group) => group.label)).toEqual([
      "Active skill",
    ]);
  });

  test("keeps several eval scorecards as separate rows within one setup", () => {
    const comparison = comparisonFixture([
      cell({ versionId: "v001", evalHash: "eval_hash_one_long", score: 0.4 }),
      cell({ versionId: "v001", evalHash: "eval_hash_two_long", score: 0.5 }),
    ]);

    const groups = buildComparisonGroups(comparison);
    const rows = buildComparisonEvidenceRows({
      agents: comparison.agents,
      groups,
      runs: [],
    });

    expect(groups).toHaveLength(1);
    expect(groups.map((group) => group.label)).toEqual([
      "Active skill",
    ]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.rowId)).size).toBe(2);
  });

  test("orders setup groups by active skill, no-skill baseline, then other skills", () => {
    const comparison = comparisonFixture([
      cell({ versionId: "v002", score: 0.3, skillName: "dummy-skill", skillBundleHash: "dummy_bundle_hash" }),
      cell({ versionId: "v002", score: 0.1, skillName: "no-skill", skillBundleHash: "no_skill_bundle_hash" }),
      cell({ versionId: "v002", score: 0.9 }),
    ], {
      skills: [
        skillBundle(),
        skillBundle({ hash: "dummy_bundle_hash", skillName: "dummy-skill", entryName: "dummy-skill" }),
        skillBundle({ hash: "no_skill_bundle_hash", skillName: "no-skill", entryName: "no-skill" }),
      ],
    });

    const groups = buildComparisonGroups(comparison);

    expect(groups.map((group) => group.label)).toEqual([
      "Active skill",
      "No skill baseline",
      "Dummy skill",
    ]);
  });

  test("omits comparison cells without a matching skill bundle", () => {
    const comparison = comparisonFixture([
      cell({ versionId: "v001" }),
    ], {
      skills: [],
    });

    expect(buildComparisonGroups(comparison)).toEqual([]);
  });

  test("labels current scorecard setups without version noise", () => {
    const comparison = comparisonFixture([
      cell({
        versionId: "v002",
        score: 0.9,
      }),
      cell({
        versionId: "v002",
        score: 0.3,
        skillName: "dummy-skill",
        skillBundleHash: "dummy_bundle_hash",
      }),
      cell({
        versionId: "v002",
        score: 0.1,
        skillName: "no-skill",
        skillBundleHash: "no_skill_bundle_hash",
      }),
    ], {
      skills: [
        skillBundle(),
        skillBundle({
          hash: "dummy_bundle_hash",
          skillName: "dummy-skill",
          entryName: "dummy-skill",
        }),
        skillBundle({
          hash: "no_skill_bundle_hash",
          skillName: "no-skill",
          entryName: "no-skill",
        }),
      ],
    });

    const groups = buildComparisonGroups(comparison, {
      currentVersionId: "v002",
      defaultSkill: "primary",
    });

    expect(groups.map((group) => group.id)).toEqual([
      "setup/active",
      "setup/no-skill",
      "setup/dummy-skill",
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "Active skill",
      "No skill baseline",
      "Dummy skill",
    ]);
  });

  test("does not add a skill label for the active skill when another bundle is unmeasured", () => {
    const comparison = comparisonFixture([
      cell({ versionId: "v001" }),
    ], {
      skills: [
        skillBundle(),
        skillBundle({
          hash: "dummy_bundle_hash",
          skillName: "dummy-skill",
          entryName: "dummy-skill",
        }),
      ],
    });

    const groups = buildComparisonGroups(comparison, {
      currentVersionId: "v001",
      defaultSkill: "primary",
    });

    expect(groups.map((group) => group.label)).toEqual([
      "Active skill",
    ]);
  });

  test("keeps version identity and state on rows when setup labels are shared", () => {
    const comparison = comparisonFixture([
      cell({ versionId: "v001", score: 0.8 }),
      cell({ versionId: "v002", score: 0.9 }),
      cell({
        versionId: "v001",
        score: 0.2,
        skillName: "dummy-skill",
        skillBundleHash: "dummy_bundle_hash",
      }),
      cell({
        versionId: "v002",
        score: 0.3,
        skillName: "dummy-skill",
        skillBundleHash: "dummy_bundle_hash",
      }),
    ], {
      skills: [
        skillBundle(),
        skillBundle({
          hash: "dummy_bundle_hash",
          skillName: "dummy-skill",
          entryName: "dummy-skill",
        }),
      ],
    });

    const groups = buildComparisonGroups(comparison, {
      currentVersionId: "v002",
      defaultSkill: "primary",
      publishedVersionId: "v001",
      allVersions: [version("v001"), version("v002")],
    });
    const rows = buildComparisonEvidenceRows({
      agents: comparison.agents,
      context: {
        currentVersionId: "v002",
        defaultSkill: "primary",
        publishedVersionId: "v001",
        allVersions: [version("v001"), version("v002")],
      },
      groups,
      runs: [],
    });

    expect(groups.map((group) => group.label)).toEqual([
      "Active skill",
      "Dummy skill",
    ]);
    expect(rows.map((row) => ({
      setup: row.setupLabel,
      version: row.versionLabel,
      badges: row.versionBadges,
    }))).toEqual([
      { setup: "Active skill", version: "Version 2", badges: ["Current"] },
      { setup: "Active skill", version: "Version 1", badges: ["Published"] },
      { setup: "Dummy skill", version: "Version 2", badges: ["Current"] },
      { setup: "Dummy skill", version: "Version 1", badges: ["Published"] },
    ]);
  });

  test("uses the configured default skill as the active skill label", () => {
    const comparison = comparisonFixture([
      cell({
        versionId: "v002",
        score: 0.4,
      }),
      cell({
        versionId: "v002",
        score: 0.9,
        skillName: "variant",
        skillBundleHash: "variant_bundle_hash",
      }),
    ], {
      skills: [
        skillBundle(),
        skillBundle({
          hash: "variant_bundle_hash",
          skillName: "variant",
          entryName: "variant",
        }),
      ],
    });

    const groups = buildComparisonGroups(comparison, {
      currentVersionId: "v002",
      defaultSkill: "variant",
    });

    expect(groups.map((group) => group.label)).toEqual([
      "Active skill",
      "Primary skill",
    ]);
  });

  test("formats skill display names outside comparison rows", () => {
    expect(formatSkillDisplayName("primary", { defaultSkill: "primary" })).toBe("Active skill");
    expect(formatSkillDisplayName("primary", { defaultSkill: "all" })).toBe("Active skill");
    expect(formatSkillDisplayName("no-skill")).toBe("No skill baseline");
    expect(formatSkillDisplayName("dummy-skill")).toBe("Dummy skill");
  });

  test("labels row versions against the full version history", () => {
    const comparison = comparisonFixture([
      cell({ versionId: "v002" }),
    ]);

    const groups = buildComparisonGroups(comparison, {
      allVersions: [version("v001"), version("v002")],
    });
    const rows = buildComparisonEvidenceRows({
      agents: comparison.agents,
      context: { allVersions: [version("v001"), version("v002")] },
      groups,
      runs: [],
    });

    expect(groups.map((group) => group.label)).toEqual([
      "Active skill",
    ]);
    expect(rows[0]?.versionLabel).toBe("Version 2");
  });

  test("builds active skill version history from recorded eval scorecards", () => {
    const snapshot = inspectionSnapshotFixture({
      versions: [version("v001"), version("v002"), version("v003")],
      skillBundles: [skillBundle({ hash: "bundle_v001" }), skillBundle({ hash: "bundle_v002" })],
      runs: [
        run({ id: "run_old", versionId: "v001", skillBundleHash: "bundle_v001", score: 0.4, createdAt: "2026-06-06T00:10:00.000Z" }),
        run({ id: "run_newer", versionId: "v001", skillBundleHash: "bundle_v001", score: 0.5, createdAt: "2026-06-06T00:11:00.000Z" }),
        run({ id: "run_current", versionId: "v002", skillBundleHash: "bundle_v002", score: 0.9, createdAt: "2026-06-06T00:12:00.000Z" }),
        run({ id: "run_dummy", versionId: "v002", skillName: "dummy-skill", skillBundleHash: "dummy_bundle_hash", score: 0.1, createdAt: "2026-06-06T00:13:00.000Z" }),
      ],
    });

    const comparison = comparisonForActiveSkillVersions(snapshot);

    expect(comparison.versions.map((entry) => entry.id)).toEqual(["v001", "v002"]);
    expect(comparison.skills.map((entry) => entry.hash)).toEqual(["bundle_v001", "bundle_v002"]);
    expect(comparison.cells.map((entry) => ({
      versionId: entry.versionId,
      runId: entry.runId,
      score: entry.score,
    }))).toEqual([
      { versionId: "v001", runId: "run_newer", score: 0.5 },
      { versionId: "v002", runId: "run_current", score: 0.9 },
    ]);
  });

  test("builds one scorecard from current setups plus active skill history", () => {
    const snapshot = inspectionSnapshotFixture({
      versions: [version("v001"), version("v002"), version("v003")],
      skillBundles: [
        skillBundle({ hash: "bundle_v001" }),
        skillBundle({ hash: "bundle_v002" }),
        skillBundle({ hash: "dummy_bundle_hash", skillName: "dummy-skill", entryName: "dummy-skill" }),
      ],
      runs: [
        run({ id: "run_old", versionId: "v001", skillBundleHash: "bundle_v001", score: 0.4, createdAt: "2026-06-06T00:10:00.000Z" }),
        run({ id: "run_current", versionId: "v002", skillBundleHash: "bundle_v002", score: 0.9, createdAt: "2026-06-06T00:12:00.000Z" }),
        run({ id: "run_dummy", versionId: "v002", skillName: "dummy-skill", skillBundleHash: "dummy_bundle_hash", score: 0.1, createdAt: "2026-06-06T00:13:00.000Z" }),
      ],
      comparison: {
        versions: [version("v002")],
        skills: [
          skillBundle({ hash: "bundle_v002" }),
          skillBundle({ hash: "dummy_bundle_hash", skillName: "dummy-skill", entryName: "dummy-skill" }),
        ],
        agents: [agentSnapshot("agent_a", "patcher")],
        cells: [
          {
            versionId: "v002",
            skillName: "primary",
            skillBundleHash: "bundle_v002",
            evalHash: "eval_hash",
            agentName: "patcher",
            agentHash: "agent_a",
            runId: "run_current",
            score: 0.9,
          },
          {
            versionId: "v002",
            skillName: "dummy-skill",
            skillBundleHash: "dummy_bundle_hash",
            evalHash: "eval_hash",
            agentName: "patcher",
            agentHash: "agent_a",
            runId: "run_dummy",
            score: 0.1,
          },
        ],
      },
    });

    const comparison = comparisonForScorecard(snapshot);

    expect(comparison.cells.map((entry) => ({
      versionId: entry.versionId,
      skillName: entry.skillName,
      runId: entry.runId,
    }))).toEqual([
      { versionId: "v002", skillName: "primary", runId: "run_current" },
      { versionId: "v002", skillName: "dummy-skill", runId: "run_dummy" },
      { versionId: "v001", skillName: "primary", runId: "run_old" },
    ]);
  });

  test("scorecard includes all current-version skill and agent runs", () => {
    const snapshot = inspectionSnapshotFixture({
      versions: [version("v001"), version("v002")],
      skillBundles: [
        skillBundle({ hash: "old_bundle" }),
        skillBundle({ hash: "active_bundle" }),
        skillBundle({ hash: "dummy_bundle_hash", skillName: "dummy-skill", entryName: "dummy-skill" }),
        skillBundle({ hash: "no_skill_bundle_hash", skillName: "no-skill", entryName: "no-skill" }),
      ],
      agents: [
        agentSnapshot("agent_a", "patcher"),
        agentSnapshot("agent_b", "gpt-5.3-codex-spark"),
      ],
      runs: [
        run({ id: "run_old", versionId: "v001", skillBundleHash: "old_bundle", score: 0.4, createdAt: "2026-06-06T00:10:00.000Z" }),
        run({ id: "run_active", versionId: "v002", skillBundleHash: "active_bundle", agentName: "gpt-5.3-codex-spark", agentHash: "agent_b", score: 0, createdAt: "2026-06-06T00:20:00.000Z" }),
        run({ id: "run_no_skill", versionId: "v002", skillName: "no-skill", skillBundleHash: "no_skill_bundle_hash", agentName: "gpt-5.3-codex-spark", agentHash: "agent_b", score: 0, createdAt: "2026-06-06T00:21:00.000Z" }),
        run({ id: "run_dummy", versionId: "v002", skillName: "dummy-skill", skillBundleHash: "dummy_bundle_hash", agentName: "gpt-5.3-codex-spark", agentHash: "agent_b", score: 0, createdAt: "2026-06-06T00:22:00.000Z" }),
      ],
      comparison: {
        versions: [version("v002")],
        skills: [skillBundle({ hash: "active_bundle" })],
        agents: [agentSnapshot("agent_a", "patcher")],
        cells: [
          {
            versionId: "v002",
            skillName: "primary",
            skillBundleHash: "active_bundle",
            evalHash: "eval_hash",
            agentName: "patcher",
            agentHash: "agent_a",
          },
        ],
      },
    });

    const comparison = comparisonForScorecard(snapshot);

    expect(comparison.cells.map((entry) => ({
      skillName: entry.skillName,
      agentName: entry.agentName,
      runId: entry.runId,
    }))).toEqual([
      { skillName: "dummy-skill", agentName: "gpt-5.3-codex-spark", runId: "run_dummy" },
      { skillName: "no-skill", agentName: "gpt-5.3-codex-spark", runId: "run_no_skill" },
      { skillName: "primary", agentName: "gpt-5.3-codex-spark", runId: "run_active" },
      { skillName: "primary", agentName: "patcher", runId: "run_old" },
    ]);
  });

  test("labels evaluation versions and lets the scorecard pick the latest eval scope", () => {
    const firstEval = evalSnapshot("eval_hash_one", 1, "tests");
    const secondEval = evalSnapshot("eval_hash_two", 3, "rubric");
    const snapshot = inspectionSnapshotFixture({
      evals: [firstEval, secondEval],
      versions: [version("v001"), version("v002")],
      skillBundles: [skillBundle({ hash: "bundle_v002" })],
      runs: [
        run({
          id: "run_old_eval",
          versionId: "v002",
          skillBundleHash: "bundle_v002",
          evalHash: "eval_hash_one",
          score: 0.6,
          createdAt: "2026-06-06T00:10:00.000Z",
        }),
        run({
          id: "run_new_eval",
          versionId: "v002",
          skillBundleHash: "bundle_v002",
          evalHash: "eval_hash_two",
          score: 0.9,
          createdAt: "2026-06-06T00:20:00.000Z",
        }),
      ],
    });

    const comparison = comparisonForScorecard(snapshot);
    const options = evaluationOptionsForScorecard(snapshot, comparison);

    expect(options.map((option) => ({
      id: option.id,
      label: option.label,
      detail: option.detail,
      isLatest: option.isLatest,
    }))).toEqual([
      { id: "eval_hash_one", label: "Evaluation 1", detail: "1 case / test grader", isLatest: false },
      { id: "eval_hash_two", label: "Evaluation 2", detail: "3 cases / rubric grader", isLatest: true },
    ]);
    expect(options[0]?.subtitle).toContain("Created ");
    expect(options[0]?.subtitle).toContain(" / 1 case / test grader");
    expect(options[1]?.subtitle).toBe("Latest / 3 cases / rubric grader");
    expect(defaultEvaluationIdForScorecard(options)).toBe("eval_hash_two");
    expect(formatEvaluationDisplayName("eval_hash_two", snapshot.evals)).toBe("Evaluation 2");
    expect(formatEvaluationDisplayDetail("eval_hash_two", snapshot.evals)).toBe("3 cases / rubric grader");
  });

  test("orders evaluation labels and latest by created-at chronology", () => {
    const firstEval = {
      ...evalSnapshot("eval_hash_one", 1, "tests"),
      createdAt: "2026-06-06T00:10:00.000Z",
      updatedAt: "2026-06-06T00:30:00.000Z",
    };
    const secondEval = {
      ...evalSnapshot("eval_hash_two", 3, "rubric"),
      createdAt: "2026-06-06T00:20:00.000Z",
      updatedAt: "2026-06-06T00:20:00.000Z",
    };
    const snapshot = inspectionSnapshotFixture({
      evals: [firstEval, secondEval],
      versions: [version("v001"), version("v002")],
      skillBundles: [skillBundle({ hash: "bundle_v002" })],
      runs: [
        run({
          id: "run_first_eval",
          versionId: "v002",
          skillBundleHash: "bundle_v002",
          evalHash: "eval_hash_one",
          score: 0.6,
          createdAt: "2026-06-06T00:10:00.000Z",
        }),
        run({
          id: "run_second_eval",
          versionId: "v002",
          skillBundleHash: "bundle_v002",
          evalHash: "eval_hash_two",
          score: 0.9,
          createdAt: "2026-06-06T00:20:00.000Z",
        }),
      ],
    });

    const comparison = comparisonForScorecard(snapshot);
    const options = evaluationOptionsForScorecard(snapshot, comparison);

    expect(options.map((option) => ({
      id: option.id,
      label: option.label,
      isLatest: option.isLatest,
      subtitle: option.subtitle,
    }))).toEqual([
      {
        id: "eval_hash_one",
        label: "Evaluation 1",
        isLatest: false,
        subtitle: expect.stringContaining("Created "),
      },
      {
        id: "eval_hash_two",
        label: "Evaluation 2",
        isLatest: true,
        subtitle: "Latest / 3 cases / rubric grader",
      },
    ]);
    expect(defaultEvaluationIdForScorecard(options)).toBe("eval_hash_two");
  });

  test("evidence rows fall back from cell metrics to the linked run", () => {
    const comparison = comparisonFixture([
      cell({ versionId: "v001", runId: "run_001", score: 0.5 }),
      cell({ versionId: "v002", runId: "run_002" }),
      cell({ versionId: "v002", agentName: "explorer", agentHash: "agent_b" }),
    ]);
    const runs: WorkbenchRun[] = [
      run({ id: "run_001", versionId: "v001", score: 0.9, latencyMs: 2_000 }),
      run({ id: "run_002", versionId: "v002", score: 0.8, latencyMs: 1_000 }),
    ];

    const rows = buildComparisonEvidenceRows({
      agents: comparison.agents,
      groups: buildComparisonGroups(comparison),
      runs,
    });

    expect(rows).toHaveLength(2);
    // Cell metric wins over the run metric, run fills cell gaps.
    const v001Row = rows.find((row) => row.versionId === "v001");
    const v002Row = rows.find((row) => row.versionId === "v002");
    expect(v001Row?.score).toBe(0.5);
    expect(v001Row?.latencyMs).toBe(2_000);
    expect(v001Row?.evidenceLabel).toBe("View details");
    expect(v002Row?.score).toBe(0.8);
    expect(rows.some((row) => row.agentName === "explorer")).toBe(false);
  });

  test("surfaces failed run status and error text in evidence rows", () => {
    const comparison = comparisonFixture([
      cell({
        versionId: "v001",
        runId: "run_failed",
        status: "failed",
        error: "ADAPTER_AUTH_REQUIRED: codex disconnected. Run workbench login codex.",
      }),
    ]);

    const rows = buildComparisonEvidenceRows({
      agents: comparison.agents,
      groups: buildComparisonGroups(comparison),
      runs: [],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "failed",
      statusLabel: "Failed",
      evidenceLabel: "ADAPTER_AUTH_REQUIRED: codex disconnected. Run workbench login codex.",
      error: "ADAPTER_AUTH_REQUIRED: codex disconnected. Run workbench login codex.",
      runId: "run_failed",
    });
    expect(rows[0]?.score).toBeUndefined();
  });

  test("summarizes adapter stack traces to the provider-facing message in evidence rows", () => {
    const comparison = comparisonFixture([
      cell({
        versionId: "v001",
        runId: "run_failed",
        status: "failed",
        error: "Adapter step skill (skill.run via codex model gpt-5.4-nano) exited with status 1: Error: {\"type\":\"error\",\"status\":400,\"error\":{\"message\":\"The 'gpt-5.4-nano' model is not supported when using Codex with a ChatGPT account.\"}} at CodexHarnessAdapter.handleLine",
      }),
    ]);

    const rows = buildComparisonEvidenceRows({
      agents: comparison.agents,
      groups: buildComparisonGroups(comparison),
      runs: [],
    });

    expect(rows[0]?.evidenceLabel)
      .toBe("The 'gpt-5.4-nano' model is not supported when using Codex with a ChatGPT account.");
    expect(rows[0]?.error).toContain("Adapter step skill");
  });

  test("collapses untested configurations to one no-scorecard row per version", () => {
    const comparison = comparisonFixture([
      cell({ versionId: "v001" }),
      cell({ versionId: "v001", agentName: "explorer", agentHash: "agent_b" }),
    ]);

    const rows = buildComparisonEvidenceRows({
      agents: comparison.agents,
      groups: buildComparisonGroups(comparison),
      runs: [],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agentName: "No scorecard yet",
      statusLabel: "Not tested",
      evidenceLabel: "No run yet",
      runId: null,
    });
  });

  test("sorts metric data by descriptor direction", () => {
    const comparison = comparisonFixture([
      cell({ versionId: "v001", score: 0.4, latencyMs: 500 }),
      cell({ versionId: "v002", score: 0.9, latencyMs: 2_000 }),
    ]);
    const rows = buildComparisonEvidenceRows({
      agents: comparison.agents,
      groups: buildComparisonGroups(comparison),
      runs: [],
    });

    // higher-is-better metrics sort descending.
    expect(buildComparisonMetricData(rows, SCORE).map((datum) => datum.value)).toEqual([0.9, 0.4]);
    // lower-is-better metrics sort ascending.
    expect(buildComparisonMetricData(rows, LATENCY).map((datum) => datum.value)).toEqual([500, 2_000]);
  });

  test("hides all-empty cost columns and explains mixed missing cost", () => {
    const comparison = comparisonFixture([
      cell({ versionId: "v001", runId: "run_failed", score: 0, latencyMs: 500 }),
      cell({ versionId: "v002", runId: "run_cost", score: 0.9, latencyMs: 600, costUsd: 0.0123 }),
    ]);
    const groups = buildComparisonGroups(comparison);
    const rowsWithoutCost = buildComparisonEvidenceRows({
      agents: comparison.agents,
      groups,
      runs: [
        run({ id: "run_failed", versionId: "v001", status: "failed", score: 0, latencyMs: 500 }),
      ],
    }).filter((row) => row.versionId === "v001");
    const rowsWithMixedCost = buildComparisonEvidenceRows({
      agents: comparison.agents,
      groups,
      runs: [
        run({ id: "run_failed", versionId: "v001", status: "failed", score: 0, latencyMs: 500 }),
        run({ id: "run_cost", versionId: "v002", score: 0.9, latencyMs: 600, costUsd: 0.0123 }),
      ],
    });
    const costDescriptor = buildComparisonTableMetricDescriptors(rowsWithMixedCost)
      .find((descriptor) => descriptor.id === "costUsd");

    expect(buildComparisonTableMetricDescriptors(rowsWithoutCost).map((descriptor) => descriptor.id))
      .toEqual(["score", "latencyMs"]);
    expect(buildComparisonTableMetricDescriptors(rowsWithMixedCost).map((descriptor) => descriptor.id))
      .toEqual(["score", "latencyMs", "costUsd"]);
    expect(costDescriptor).toBeDefined();
    expect(formatComparisonTableMetricValue(rowsWithMixedCost.find((row) => row.versionId === "v001")!, costDescriptor!))
      .toBe("Failed before usage");
    expect(formatComparisonTableMetricValue(rowsWithMixedCost.find((row) => row.versionId === "v002")!, costDescriptor!))
      .toBe("$0.0123");
  });

  test("omits rows without a value for the metric", () => {
    const comparison = comparisonFixture([
      cell({ versionId: "v001", score: 0.4 }),
      cell({ versionId: "v002" }),
    ]);
    const rows = buildComparisonEvidenceRows({
      agents: comparison.agents,
      groups: buildComparisonGroups(comparison),
      runs: [],
    });

    expect(buildComparisonMetricData(rows, SCORE)).toHaveLength(1);
  });
});

function comparisonFixture(
  cells: WorkbenchComparisonCell[],
  options: {
    skills?: WorkbenchSkillBundleSnapshot[];
    agents?: WorkbenchAgentSnapshot[];
  } = {},
): WorkbenchComparison {
  const versionIds = [...new Set(cells.map((entry) => entry.versionId))];
  return {
    evalHash: "eval_hash",
    versions: versionIds.map((id) => version(id)),
    skills: options.skills ?? [skillBundle()],
    agents: options.agents ?? [
      agentSnapshot("agent_a", "patcher"),
      agentSnapshot("agent_b", "explorer"),
    ],
    cells,
  };
}

function cell(overrides: Partial<WorkbenchComparisonCell> & { versionId: string }): WorkbenchComparisonCell {
  return {
    skillName: "primary",
    skillBundleHash: "skill_bundle_hash",
    evalHash: "eval_hash",
    agentName: "patcher",
    agentHash: "agent_a",
    ...overrides,
  };
}

function run(overrides: Partial<WorkbenchRun> & { id: string; versionId: string }): WorkbenchRun {
  return {
    kind: "eval",
    skillName: "primary",
    skillBundleHash: "skill_bundle_hash",
    evalHash: "eval_hash",
    agentName: "patcher",
    agentHash: "agent_a",
    status: "succeeded",
    traceIds: [],
    createdAt: "2026-06-06T00:10:00.000Z",
    ...overrides,
  };
}

function version(id: string): WorkbenchVersion {
  return {
    id,
    hash: `${id}_hash`,
    message: id === "v001" ? "initial" : "source update",
    parentIds: id === "v001" ? [] : ["v001"],
    createdAt: id === "v001" ? "2026-06-06T00:00:00.000Z" : "2026-06-06T00:05:00.000Z",
    files: [],
  };
}

function skillBundle(overrides: Partial<WorkbenchSkillBundleSnapshot> = {}): WorkbenchSkillBundleSnapshot {
  const skillName = overrides.skillName ?? "primary";
  return {
    hash: overrides.hash ?? "skill_bundle_hash",
    skillName,
    entryName: overrides.entryName ?? skillName,
    source: overrides.source ?? (skillName === "no-skill"
      ? { name: skillName, kind: "none" }
      : { name: skillName, kind: "local", path: skillName === "primary" ? "." : skillName }),
    files: [],
    includedSkills: [],
    createdAt: "2026-06-06T00:00:00.000Z",
    ...overrides,
  };
}

function evalSnapshot(hash = "eval_hash", caseCount = 1, scoreAdapter = "tests"): WorkbenchEvalSnapshot {
  const createdAt = hash === "eval_hash_two"
    ? "2026-06-06T00:20:00.000Z"
    : "2026-06-06T00:00:00.000Z";
  return {
    hash,
    caseCount,
    createdAt,
    updatedAt: createdAt,
    scoreAdapter,
    files: [{
      path: "eval.yaml",
      kind: "text",
      encoding: "utf8",
      content: `version: 1\nscore:\n  adapter: ${scoreAdapter}\n`,
    }],
  };
}

function agentSnapshot(hash: string, name: string): WorkbenchAgentSnapshot {
  return {
    hash,
    agent: {
      name,
      adapter: "command",
      model: "deterministic",
      config: {},
    },
  };
}

function inspectionSnapshotFixture(overrides: Partial<WorkbenchInspectionSnapshot> = {}): WorkbenchInspectionSnapshot {
  const versions = overrides.versions ?? [version("v001")];
  const skillBundles = overrides.skillBundles ?? [skillBundle()];
  const agents = overrides.agents ?? [agentSnapshot("agent_a", "patcher")];
  const evals = overrides.evals ?? [evalSnapshot()];
  return {
    root: "/tmp/workbench-test",
    status: {
      root: "/tmp/workbench-test",
      initialized: true,
      currentVersionId: versions.at(-1)?.id,
      defaultSkill: "primary",
      defaultAgent: "patcher",
      versionCount: versions.length,
      skillCount: 1,
      agentCount: agents.length,
      runCount: overrides.runs?.length ?? 0,
      remoteCount: 0,
    },
    versions,
    skillSources: [{ name: "primary", kind: "local", path: "." }],
    skillBundles,
    evals,
    agents,
    runs: [],
    jobs: [],
    traces: [],
    executionEvents: [],
    artifacts: [],
    lineage: [],
    remotes: [],
    refs: { current: versions.at(-1)?.id },
    ...overrides,
  };
}
