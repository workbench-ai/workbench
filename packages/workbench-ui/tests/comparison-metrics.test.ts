import { describe, expect, test } from "vitest";

import type {
  WorkbenchEvalSnapshot,
  WorkbenchInspectionSnapshot,
  WorkbenchJob,
  WorkbenchResultCell,
  WorkbenchResults,
  WorkbenchRun,
  WorkbenchSkillVersion,
  WorkbenchVersion,
} from "@workbench-ai/workbench-contract";

import {
  buildComparisonEvidenceRows,
  buildComparisonGroups,
  buildComparisonMetricData,
  buildComparisonTableMetricDescriptors,
  comparisonForScorecard,
  defaultEvaluationIdForScorecard,
  evaluationOptionsForScorecard,
  formatComparisonTableMetricValue,
  formatEvaluationDisplayDetail,
  formatEvaluationDisplayName,
  formatSkillDisplayName,
  missingCostLabelForStatus,
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

const COST: ComparisonMetricDescriptor = {
  id: "costUsd",
  label: "Cost",
  direction: "lower",
  kind: "currency_usd",
  semanticRole: "cost",
  primary: true,
};

describe("comparison metric helpers", () => {
  test("uses WorkbenchResults as the scorecard source", () => {
    const snapshot = inspectionSnapshotFixture({
      results: resultsFixture([
        resultCell({ skillVersionId: "v001", agentVersionId: "agent_codex", quality: 0.7 }),
        resultCell({ skillVersionId: "v002", agentVersionId: "agent_codex", quality: 0.9 }),
      ]),
    });

    const scorecard = comparisonForScorecard(snapshot);
    const groups = buildComparisonGroups(scorecard);
    const rows = buildComparisonEvidenceRows({
      agents: scorecard.agents,
      groups,
      runs: snapshot.runs,
    });

    expect(scorecard.cells).toHaveLength(2);
    expect(groups.map((group) => group.label)).toEqual(["earnings-prep v2", "earnings-prep v1"]);
    expect(rows.map((row) => ({
      version: row.versionLabel,
      agent: row.agentDetail,
      score: row.score,
      detail: row.versionDetail,
    }))).toEqual([
      { version: "earnings-prep v2", agent: "codex / gpt-5.5", score: 0.9, detail: "local:." },
      { version: "earnings-prep v1", agent: "codex / gpt-5.5", score: 0.7, detail: "local:." },
    ]);
  });

  test("renders no-skill and external refs as first-class result versions", () => {
    const results = resultsFixture([
      resultCell({ skillVersionId: "none", quality: 0.4 }),
      resultCell({ skillVersionId: "workbench:alice/summarizer@v1", quality: 0.8 }),
    ], {
      versions: [
        skillVersion({ id: "none", label: "No skill", source: "none", sourceKind: "none" }),
        skillVersion({
          id: "workbench:alice/summarizer@v1",
          label: "alice/summarizer@v1",
          source: "workbench:alice/summarizer@v1",
          sourceKind: "remote",
        }),
      ],
    });

    const groups = buildComparisonGroups(results);
    const rows = buildComparisonEvidenceRows({ agents: results.agents, groups, runs: [] });

    expect(rows.map((row) => ({
      version: row.versionLabel,
      detail: row.versionDetail,
      score: row.score,
    }))).toEqual([
      { version: "No skill", detail: "none", score: 0.4 },
      { version: "alice/summarizer@v1", detail: "workbench:alice/summarizer@v1", score: 0.8 },
    ]);
  });

  test("builds evaluation selector options from result evaluations", () => {
    const snapshot = inspectionSnapshotFixture({
      evals: [
        evalSnapshot("eval_one", 2, "tests", "2026-06-06T00:00:00.000Z"),
        evalSnapshot("eval_two", 3, "rubric", "2026-06-06T00:05:00.000Z"),
      ],
      results: resultsFixture([
        resultCell({ evaluationId: "eval_one", quality: 0.7 }),
        resultCell({ evaluationId: "eval_two", quality: 0.9 }),
      ], {
        evaluations: [
          { id: "eval_one", caseCount: 2, gradeAdapter: "tests", createdAt: "2026-06-06T00:00:00.000Z", updatedAt: "2026-06-06T00:00:00.000Z" },
          { id: "eval_two", caseCount: 3, gradeAdapter: "rubric", createdAt: "2026-06-06T00:05:00.000Z", updatedAt: "2026-06-06T00:05:00.000Z" },
        ],
      }),
    });

    const options = evaluationOptionsForScorecard(snapshot, comparisonForScorecard(snapshot));

    expect(options.map((option) => ({
      id: option.id,
      label: option.label,
      detail: option.detail,
      latest: option.isLatest,
    }))).toEqual([
      { id: "eval_one", label: "Evaluation 1", detail: "2 cases / test grader", latest: false },
      { id: "eval_two", label: "Evaluation 2", detail: "3 cases / rubric grader", latest: true },
    ]);
    expect(defaultEvaluationIdForScorecard(options)).toBe("eval_two");
  });

  test("uses run evidence as fallback for visible row metrics", () => {
    const results = resultsFixture([
      resultCell({ skillVersionId: "v002", runId: "run_eval", quality: undefined, latencyMs: undefined }),
    ]);
    const groups = buildComparisonGroups(results);
    const rows = buildComparisonEvidenceRows({
      agents: results.agents,
      groups,
      jobs: [
        gradeJob({
          id: "job_grade",
          runId: "run_eval",
          score: 0.88,
        }),
      ],
      runs: [
        run({
          id: "run_eval",
          versionId: "v002",
          latencyMs: 1200,
          costUsd: 0.034,
        }),
      ],
    });

    expect(rows[0]?.score).toBe(0.88);
    expect(rows[0]?.latencyMs).toBe(1200);
    expect(rows[0]?.costUsd).toBe(0.034);
    expect(rows[0]?.statusLabel).toBe("Succeeded");
  });

  test("keeps canceled result evidence labeled as canceled", () => {
    const results = resultsFixture([
      resultCell({ skillVersionId: "v002", runId: "run_eval", status: "canceled", quality: undefined }),
    ]);
    const rows = buildComparisonEvidenceRows({
      agents: results.agents,
      groups: buildComparisonGroups(results),
      runs: [
        run({
          id: "run_eval",
          versionId: "v002",
          status: "canceled",
        }),
      ],
    });

    expect(rows[0]?.statusLabel).toBe("Canceled");
  });

  test("builds metric chart rows grouped by result version", () => {
    const results = resultsFixture([
      resultCell({ skillVersionId: "v001", agentVersionId: "agent_codex", quality: 0.7 }),
      resultCell({ skillVersionId: "v002", agentVersionId: "agent_claude", quality: 0.9 }),
    ]);
    const rows = buildComparisonEvidenceRows({
      agents: results.agents,
      groups: buildComparisonGroups(results),
      runs: [],
    });

    expect(buildComparisonMetricData(rows, SCORE).map((datum) => ({
      group: datum.groupLabel,
      row: datum.rowLabel,
      value: datum.value,
    }))).toEqual([
      { group: "earnings-prep v2", row: "earnings-prep v2 / claude / opus-4.8", value: 0.9 },
      { group: "earnings-prep v1", row: "earnings-prep v1 / codex / gpt-5.5", value: 0.7 },
    ]);
  });

  test("only shows the cost metric column when cost data exists", () => {
    const noCost = rowsFor(resultsFixture([
      resultCell({ skillVersionId: "v001", costUsd: undefined }),
    ]));
    const withCost = rowsFor(resultsFixture([
      resultCell({ skillVersionId: "v001", costUsd: undefined }),
      resultCell({ skillVersionId: "v002", costUsd: 0.12 }),
    ]));

    expect(buildComparisonTableMetricDescriptors(noCost).map((entry) => entry.id)).toEqual([
      "score",
      "latencyMs",
    ]);
    expect(buildComparisonTableMetricDescriptors(withCost).map((entry) => entry.id)).toEqual([
      "score",
      "latencyMs",
      "costUsd",
    ]);
    const missingCostRow = withCost.find((row) => row.costUsd === undefined);
    expect(missingCostRow ? formatComparisonTableMetricValue(missingCostRow, COST) : null).toBe("Not reported");
  });

  test("formats missing cost labels by run status", () => {
    expect(missingCostLabelForStatus("Failed", true)).toBe("Failed before usage");
    expect(missingCostLabelForStatus("Canceled", true)).toBe("Failed before usage");
    expect(missingCostLabelForStatus("Succeeded", true)).toBe("Not reported");
    expect(missingCostLabelForStatus("Not tested", false)).toBe("Not tested");
  });

  test("keeps legacy run display helpers for non-results views", () => {
    const evals = [
      evalSnapshot("eval_one", 1, "tests", "2026-06-06T00:00:00.000Z"),
      evalSnapshot("eval_two", 3, "rubric", "2026-06-06T00:05:00.000Z"),
    ];

    expect(formatSkillDisplayName("current", { defaultSkill: "current" })).toBe("Active skill");
    expect(formatSkillDisplayName("no-skill")).toBe("No skill baseline");
    expect(formatEvaluationDisplayName("eval_two", evals)).toBe("Evaluation 2");
    expect(formatEvaluationDisplayDetail("eval_two", evals)).toBe("3 cases / rubric grader");
  });
});

function rowsFor(results: WorkbenchResults) {
  return buildComparisonEvidenceRows({
    agents: results.agents,
    groups: buildComparisonGroups(results),
    runs: [],
  });
}

function resultsFixture(
  cells: WorkbenchResultCell[],
  options: Partial<Pick<WorkbenchResults, "versions" | "evaluations" | "agents">> = {},
): WorkbenchResults {
  return {
    versions: options.versions ?? [
      skillVersion({ id: "v001", label: "earnings-prep v1", projectVersionId: "v001" }),
      skillVersion({ id: "v002", label: "earnings-prep v2", projectVersionId: "v002", current: true }),
    ],
    evaluations: options.evaluations ?? [
      { id: "eval_hash", caseCount: 2, gradeAdapter: "tests", createdAt: "2026-06-06T00:00:00.000Z", updatedAt: "2026-06-06T00:00:00.000Z" },
    ],
    agents: options.agents ?? [
      { id: "agent_codex", name: "codex", label: "codex / gpt-5.5", adapter: "codex", model: "gpt-5.5" },
      { id: "agent_claude", name: "claude", label: "claude / opus-4.8", adapter: "claude", model: "opus-4.8" },
    ],
    cells,
  };
}

function resultCell(overrides: Partial<WorkbenchResultCell> = {}): WorkbenchResultCell {
  return {
    skillVersionId: "v001",
    evaluationId: "eval_hash",
    agentVersionId: "agent_codex",
    runId: "run_eval",
    status: "succeeded",
    quality: 0.7,
    latencyMs: 900,
    samples: 2,
    ...overrides,
  };
}

function skillVersion(overrides: Partial<WorkbenchSkillVersion>): WorkbenchSkillVersion {
  return {
    id: "v001",
    label: "earnings-prep v1",
    source: "local:.",
    sourceKind: "local",
    projectVersionId: "v001",
    contentHash: "bundle_hash",
    files: [],
    ...overrides,
  };
}

function run(overrides: Partial<WorkbenchRun> & { id: string; versionId: string }): WorkbenchRun {
  return {
    kind: "eval",
    skillName: "current",
    skillBundleHash: "skill_bundle_hash",
    evalHash: "eval_hash",
    agentName: "codex",
    agentHash: "agent_codex",
    status: "succeeded",
    traceIds: [],
    createdAt: "2026-06-06T00:10:00.000Z",
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
    skillBundleHash: "skill_bundle_hash",
    evalHash: "eval_hash",
    agentName: "codex",
    agentHash: "agent_codex",
    caseId: "case-001",
    sample: 0,
    status: "succeeded",
    artifactIds: [],
    traceIds: [],
    createdAt: "2026-06-06T00:10:01.000Z",
    result: { items: [{ kind: "score", score, value: score }] },
    ...rest,
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

function evalSnapshot(
  hash = "eval_hash",
  caseCount = 1,
  gradeAdapter = "tests",
  createdAt = "2026-06-06T00:00:00.000Z",
): WorkbenchEvalSnapshot {
  return {
    hash,
    caseCount,
    createdAt,
    updatedAt: createdAt,
    gradeAdapter,
    files: [{
      path: "eval.yaml",
      kind: "text",
      encoding: "utf8",
      content: `version: 1\ngrade:\n  adapter: ${gradeAdapter}\n`,
    }],
    cases: [],
  };
}

function inspectionSnapshotFixture(
  overrides: Partial<WorkbenchInspectionSnapshot> = {},
): WorkbenchInspectionSnapshot {
  return {
    root: "/tmp/skill",
    status: {
      root: "/tmp/skill",
      initialized: true,
      currentVersionId: "v002",
      defaultSkill: "current",
      defaultAgent: "codex",
      versionCount: 2,
      skillCount: 1,
      agentCount: 2,
      runCount: 0,
      remoteCount: 0,
    },
    versions: [version("v001"), version("v002")],
    skillSources: [{ name: "current", kind: "local", source: "local:.", path: "." }],
    skillBundles: [],
    evals: [evalSnapshot("eval_hash", 2)],
    agents: [],
    results: { versions: [], evaluations: [], agents: [], cells: [] },
    runs: [],
    jobs: [],
    traces: [],
    executionEvents: [],
    artifacts: [],
    lineage: [],
    remotes: [],
    refs: { current: "v002" },
    ...overrides,
  };
}
