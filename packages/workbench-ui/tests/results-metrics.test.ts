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
  buildResultEvidenceRows,
  buildResultGroups,
  buildResultMetricData,
  buildResultMetricDescriptors,
  resultsForScorecard,
  defaultEvalVersionIdForResults,
  evalVersionOptionsForResults,
  formatEvaluationDisplayDetail,
  formatEvaluationDisplayName,
  missingCostLabelForStatus,
  type ResultMetricDescriptor,
} from "../src/lib/results-metrics";

const SCORE: ResultMetricDescriptor = {
  id: "score",
  label: "Score",
  direction: "higher",
  kind: "number",
  semanticRole: "performance",
  primary: true,
};

describe("result metric helpers", () => {
  test("uses WorkbenchResults as the scorecard source", () => {
    const snapshot = inspectionSnapshotFixture({
      results: resultsFixture([
        resultCell({ skillVersionId: "v001", agentVersionId: "agent_codex", quality: 0.7 }),
        resultCell({ skillVersionId: "v002", agentVersionId: "agent_codex", quality: 0.9 }),
      ]),
    });

    const scorecard = resultsForScorecard(snapshot);
    const groups = buildResultGroups(scorecard);
    const rows = buildResultEvidenceRows({
      agents: scorecard.agentVersions,
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
      skillVersions: [
        skillVersion({ id: "none", label: "No skill", source: "none", sourceKind: "none" }),
        skillVersion({
          id: "workbench:alice/summarizer@v1",
          label: "alice/summarizer@v1",
          source: "workbench:alice/summarizer@v1",
          sourceKind: "remote",
        }),
      ],
    });

    const groups = buildResultGroups(results);
    const rows = buildResultEvidenceRows({ agents: results.agentVersions, groups, runs: [] });

    expect(rows.map((row) => ({
      version: row.versionLabel,
      detail: row.versionDetail,
      score: row.score,
    }))).toEqual([
      { version: "No skill", detail: "none", score: 0.4 },
      { version: "alice/summarizer@v1", detail: "workbench:alice/summarizer@v1", score: 0.8 },
    ]);
  });

  test("builds eval selector options from snapshot eval versions", () => {
    const snapshot = inspectionSnapshotFixture({
      evals: [
        evalSnapshot("eval_one", 2, "tests", "2026-06-06T00:00:00.000Z"),
        evalSnapshot("eval_two", 3, "rubric", "2026-06-06T00:05:00.000Z"),
      ],
      results: resultsFixture([
        resultCell({ evalVersionId: "eval-v1", quality: 0.7 }),
        resultCell({ evalVersionId: "eval-v2", quality: 0.9 }),
      ]),
    });

    const options = evalVersionOptionsForResults(snapshot);

    expect(options.map((option) => ({
      id: option.id,
      label: option.label,
      detail: option.detail,
      current: option.isCurrent,
    }))).toEqual([
      { id: "eval-v1", label: "Eval v1", detail: "2 cases / test grader", current: false },
      { id: "eval-v2", label: "Eval v2", detail: "3 cases / criteria grader", current: true },
    ]);
    expect(defaultEvalVersionIdForResults(options)).toBe("eval-v2");
  });

  test("uses run evidence as score fallback without copying aggregate row metrics", () => {
    const results = resultsFixture([
      resultCell({ skillVersionId: "v002", runId: "run_eval", quality: undefined, report: undefined }),
    ]);
    const groups = buildResultGroups(results);
    const rows = buildResultEvidenceRows({
      agents: results.agentVersions,
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
          jobIds: ["job_grade"],
        }),
      ],
    });

    expect(rows[0]?.score).toBe(0.88);
    expect(rows[0]?.latencyPerSampleMs).toBeUndefined();
    expect(rows[0]?.costPerSampleUsd).toBeUndefined();
    expect(rows[0]?.statusLabel).toBe("Succeeded");
  });

  test("uses report cost from agent result rows", () => {
    const results = resultsFixture([
      resultCell({
        skillVersionId: "v002",
        agentVersionId: "agent_codex",
        runId: "run_eval",
        report: jobReport({ costUsd: 0.12 }),
      }),
      resultCell({
        skillVersionId: "v002",
        agentVersionId: "agent_claude",
        runId: "run_eval",
        report: undefined,
      }),
    ]);
    const rows = buildResultEvidenceRows({
      agents: results.agentVersions,
      groups: buildResultGroups(results),
      runs: [
        run({
          id: "run_eval",
          versionId: "v002",
        }),
      ],
    });

    expect(rows.map((row) => ({ agent: row.agentHash, cost: row.costPerSampleUsd }))).toEqual([
      { agent: "agent_claude", cost: undefined },
      { agent: "agent_codex", cost: 0.12 },
    ]);
  });

  test("summarizes report latency from the run role without promoting grade cost", () => {
    const results = resultsFixture([
      resultCell({
        report: {
          unitCount: 1,
          jobCount: 2,
          totalDurationMs: 1200,
          roles: [{
            role: "run",
            jobCount: 1,
            queued: 0,
            running: 0,
            succeeded: 1,
            failed: 0,
            canceled: 0,
            totalDurationMs: 900,
          }, {
            role: "grade",
            jobCount: 1,
            queued: 0,
            running: 0,
            succeeded: 1,
            failed: 0,
            canceled: 0,
            totalDurationMs: 300,
            costUsd: 0.91,
          }],
        },
      }),
    ]);

    const rows = buildResultEvidenceRows({
      agents: results.agentVersions,
      groups: buildResultGroups(results),
      runs: [run({ id: "run_eval", versionId: "v001" })],
    });

    expect(rows[0]?.latencyPerSampleMs).toBe(900);
    expect(rows[0]?.costPerSampleUsd).toBeUndefined();
  });

  test("summarizes grade-only report timing and cost with the same metrics", () => {
    const results = resultsFixture([
      resultCell({
        report: {
          unitCount: 1,
          jobCount: 1,
          totalDurationMs: 300,
          roles: [{
            role: "grade",
            jobCount: 1,
            queued: 0,
            running: 0,
            succeeded: 1,
            failed: 0,
            canceled: 0,
            totalDurationMs: 300,
            costUsd: 0.91,
          }],
        },
      }),
    ]);

    const rows = buildResultEvidenceRows({
      agents: results.agentVersions,
      groups: buildResultGroups(results),
      runs: [run({ id: "run_eval", versionId: "v001" })],
    });

    expect(rows[0]?.latencyPerSampleMs).toBe(300);
    expect(rows[0]?.costPerSampleUsd).toBe(0.91);
  });

  test("labels non-run result timing with the generic latency metric", () => {
    const results = resultsFixture([
      resultCell({ report: jobReport({ role: "improve", totalMs: 700, costUsd: 0.12 }) }),
    ]);
    const rows = buildResultEvidenceRows({
      agents: results.agentVersions,
      groups: buildResultGroups(results),
      runs: [run({ id: "run_eval", versionId: "v001" })],
    });

    expect(rows[0]?.latencyPerSampleMs).toBe(700);
    expect(rows[0]?.costPerSampleUsd).toBe(0.12);
    expect(buildResultMetricDescriptors(rows).map((entry) => [entry.id, entry.label])).toContainEqual([
      "latencyPerSampleMs",
      "Latency per sample",
    ]);
  });

  test("keeps canceled result evidence labeled as canceled", () => {
    const results = resultsFixture([
      resultCell({ skillVersionId: "v002", runId: "run_eval", status: "canceled", quality: undefined }),
    ]);
    const rows = buildResultEvidenceRows({
      agents: results.agentVersions,
      groups: buildResultGroups(results),
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

  test("preserves zero completed coverage", () => {
    const results = resultsFixture([
      resultCell({
        coverage: { completed: 0, planned: 2 },
        quality: undefined,
        status: "running",
      }),
    ]);
    const rows = buildResultEvidenceRows({
      agents: results.agentVersions,
      groups: buildResultGroups(results),
      runs: [run({ id: "run_eval", versionId: "v001", status: "running" })],
    });

    expect(rows[0]?.coverage).toEqual({ completed: 0, planned: 2 });
  });

  test("builds metric chart rows grouped by result version", () => {
    const results = resultsFixture([
      resultCell({ skillVersionId: "v001", agentVersionId: "agent_codex", quality: 0.7 }),
      resultCell({ skillVersionId: "v002", agentVersionId: "agent_claude", quality: 0.9 }),
    ]);
    const rows = buildResultEvidenceRows({
      agents: results.agentVersions,
      groups: buildResultGroups(results),
      runs: [],
    });

    expect(buildResultMetricData(rows, SCORE).map((datum) => ({
      group: datum.groupLabel,
      row: datum.rowLabel,
      value: datum.value,
    }))).toEqual([
      { group: "earnings-prep v2", row: "earnings-prep v2 / claude / opus", value: 0.9 },
      { group: "earnings-prep v1", row: "earnings-prep v1 / codex / gpt-5.5", value: 0.7 },
    ]);
  });

  test("formats missing cost labels by run status", () => {
    expect(missingCostLabelForStatus("Failed", true)).toBe("Failed before usage");
    expect(missingCostLabelForStatus("Canceled", true)).toBe("Failed before usage");
    expect(missingCostLabelForStatus("Succeeded", true)).toBe("Not reported");
    expect(missingCostLabelForStatus("Not tested", false)).toBe("Not tested");
  });

  test("formats evaluation display helpers for non-results views", () => {
    const evals = [
      evalSnapshot("eval_one", 1, "tests", "2026-06-06T00:00:00.000Z"),
      evalSnapshot("eval_two", 3, "rubric", "2026-06-06T00:05:00.000Z"),
    ];

    expect(formatEvaluationDisplayName("eval_two", evals)).toBe("Eval v2");
    expect(formatEvaluationDisplayDetail("eval_two", evals)).toBe("3 cases / criteria grader");
  });
});

function resultsFixture(
  cells: WorkbenchResultCell[],
  options: Partial<Pick<WorkbenchResults, "skillVersions" | "evalVersions" | "agentVersions">> = {},
): WorkbenchResults {
  return {
    skillVersions: options.skillVersions ?? [
      skillVersion({ id: "v001", label: "earnings-prep v1", projectVersionId: "v001" }),
      skillVersion({ id: "v002", label: "earnings-prep v2", projectVersionId: "v002", current: true }),
    ],
    evalVersions: options.evalVersions ?? [
      evalVersion({ id: "eval-v1", hash: "eval_hash", caseCount: 2, gradeAdapter: "tests", current: true }),
    ],
    agentVersions: options.agentVersions ?? [
      { id: "agent_codex", name: "codex", label: "codex / gpt-5.5", adapter: "codex", model: "gpt-5.5" },
      { id: "agent_claude", name: "claude", label: "claude / opus", adapter: "claude", model: "opus" },
    ],
    cells,
  };
}

function resultCell(overrides: Partial<WorkbenchResultCell> = {}): WorkbenchResultCell {
  return {
    skillVersionId: "v001",
    evalVersionId: "eval-v1",
    agentVersionId: "agent_codex",
    runId: "run_eval",
    status: "succeeded",
    quality: 0.7,
    report: jobReport({ totalMs: 900 }),
    coverage: { completed: 2, planned: 2 },
    ...overrides,
  };
}

function evalVersion(overrides: Partial<WorkbenchResults["evalVersions"][number]>): WorkbenchResults["evalVersions"][number] {
  return {
    id: "eval-v1",
    hash: "eval_hash",
    label: "Eval v1",
    ordinal: 1,
    current: true,
    caseCount: 1,
    gradeAdapter: "tests",
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
    runCount: 1,
    ...overrides,
  };
}

function jobReport(options: { costUsd?: number; totalMs?: number; role?: string } = {}) {
  const totalMs = options.totalMs ?? 900;
  const role = options.role ?? "run";
  return {
    unitCount: 1,
    jobCount: 1,
    totalDurationMs: totalMs,
    roles: [{
      role,
      jobCount: 1,
      queued: 0,
      running: 0,
      succeeded: 1,
      failed: 0,
      canceled: 0,
      totalDurationMs: totalMs,
      ...(options.costUsd !== undefined ? { costUsd: options.costUsd } : {}),
    }],
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
    jobIds: [],
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

function gradePlanFixture(adapter: string): WorkbenchEvalSnapshot["grade"] {
  return {
    adapter,
    adapterSource: "eval",
    label: adapter === "none" ? "None" : adapter === "rubric" ? "Criteria" : adapter === "tests" ? "Tests" : "Command",
    summary: adapter === "none" ? "No grader" : adapter === "rubric" ? "1 criterion" : "Case test harness",
    sources: [{ path: "eval.yaml", role: "global" }],
    display: adapter === "none"
      ? []
      : adapter === "rubric"
      ? [{
          kind: "list",
          title: "Criteria",
          items: [{ label: "quality", description: "Satisfies the case.", meta: "global" }],
        }]
      : [{ kind: "text", text: "No adapter-specific grading details are configured." }],
    authoring: adapter === "none"
      ? []
      : adapter === "rubric"
      ? [{
          kind: "list",
          name: "criteria",
          label: "Acceptance criteria",
          itemLabel: "Criterion",
          fields: [{
            kind: "text",
            name: "description",
            label: "Criterion",
          }],
        }]
      : adapter === "tests"
        ? [{
            kind: "file",
            name: "testScript",
            label: "Test script",
            path: "tests/test.sh",
          }]
        : [{
            kind: "text",
            name: "command",
            label: "Command",
            multiline: true,
            required: true,
          }],
  };
}

function gradeAdapterOptionsFixture(): WorkbenchEvalSnapshot["gradeAdapters"] {
  return ["none", "rubric", "tests", "command"].map((adapter) => ({
    adapter,
    label: adapter === "none" ? "None" : adapter === "rubric" ? "Criteria" : adapter === "tests" ? "Tests" : "Command",
    authoring: gradePlanFixture(adapter).authoring,
  }));
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
    grade: gradePlanFixture(gradeAdapter),
    gradeAdapters: gradeAdapterOptionsFixture(),
    files: [{
      path: "eval.yaml",
      kind: "text",
      encoding: "utf8",
      content: `grade:\n  adapter: ${gradeAdapter}\n`,
    }],
    cases: [],
  };
}

function inspectionSnapshotFixture(
  overrides: Partial<WorkbenchInspectionSnapshot> = {},
): WorkbenchInspectionSnapshot {
  const evals = overrides.evals ?? [evalSnapshot("eval_hash", 2)];
  const evalVersions = overrides.evalVersions ?? evals.map((entry, index) => evalVersion({
    id: `eval-v${index + 1}`,
    hash: entry.hash,
    label: `Eval v${index + 1}`,
    ordinal: index + 1,
    current: index === evals.length - 1,
    caseCount: entry.caseCount,
    gradeAdapter: entry.grade.adapter,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    runCount: 0,
  }));
  return {
    root: "/tmp/skill",
    status: {
      root: "/tmp/skill",
      initialized: true,
      currentVersionId: "v002",
      defaultSkill: "current",
      runCount: 0,
    },
    versions: [version("v001"), version("v002")],
    skillSources: [{ name: "current", kind: "local", source: "local:.", path: "." }],
    skillBundles: [],
    evals,
    evalVersions,
    agents: [],
    results: { skillVersions: [], evalVersions, agentVersions: [], cells: [] },
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
