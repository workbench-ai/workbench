import { describe, expect, test } from "vitest";

import {
  assertWorkbenchAdapterAuthEnvNameAllowed,
  buildWorkbenchJobReport,
  buildWorkbenchRunEvidenceView,
  isWorkbenchAuthoredControlPath,
  isWorkbenchPackageSourcePath,
  isWorkbenchRuntimeMetadataPath,
  isReservedWorkbenchAdapterAuthEnvName,
  normalizeWorkbenchSourcePath,
  normalizeWorkbenchSourceRequestPath,
  parseWorkbenchCaseFileOwnerId,
  workbenchCaseFileOwnerId,
  workbenchInspectionFileOwnerKindFromRouteSegment,
  workbenchInspectionFileOwnerRouteSegment,
  workbenchInspectionFileContent,
  workbenchInspectionFileContentUnavailableReason,
  workbenchInspectionFileManifest,
  workbenchJobReportMetricBreakdown,
  workbenchJobReportMetricSummary,
  workbenchJobReportTotalCostUsd,
  workbenchTraceProjection,
  workbenchTracePromotionReadiness,
  type WorkbenchInspectionFileContent,
  type WorkbenchInspectionSnapshot,
  type WorkbenchInspectionSnapshotEnvelope,
  type WorkbenchJob,
  type WorkbenchJobReport,
  type WorkbenchProjectState,
  type WorkbenchRun,
  type WorkbenchRunSnapshot,
  type WorkbenchStateNotice,
  type WorkbenchTrace,
} from "../src/index";

describe("workbench contract", () => {
  test("projects trace lifecycle, review, prompt, output, and promotion readiness through one interface", () => {
    const trace = {
      id: "trace_projection",
      runId: "run_projection",
      versionId: "unknown",
      skillName: "workbench",
      skillBundleHash: "unknown",
      agentName: "codex",
      createdAt: "2026-06-27T00:00:00.000Z",
      request: { input: { prompt: "  Project this prompt.  " } },
      result: { status: "completed", output: { assistantText: "  Project this output.  " } },
      files: [],
      protocol: "workbench.trace.v1",
      origin: "live",
      status: {
        capture: "captured",
        execution: "completed",
        grade: "ungraded",
        review: "failed",
        promotion: "none",
      },
      review: {
        status: "failed",
        expected: "Expected correction.",
      },
    } satisfies WorkbenchTrace;

    expect(workbenchTraceProjection(trace)).toMatchObject({
      lifecycleStatus: "captured/completed/ungraded",
      reviewStatus: "failed",
      promotionStatus: "none",
      prompt: "Project this prompt.",
      output: "Project this output.",
      promotionReadiness: { ok: true },
    });
  });

  test("blocks promotion for unfinished traces before case generation", () => {
    const trace = {
      id: "trace_candidate",
      runId: "run_candidate",
      versionId: "unknown",
      skillName: "workbench",
      skillBundleHash: "unknown",
      agentName: "codex",
      createdAt: "2026-06-27T00:00:00.000Z",
      request: { input: { prompt: "$workbench Finish before promotion." } },
      result: { status: "running" },
      files: [],
      protocol: "workbench.trace.v1",
      origin: "live",
      status: {
        capture: "capturing",
        execution: "running",
        grade: "ungraded",
        review: "unreviewed",
        promotion: "none",
      },
      input: { prompt: "$workbench Finish before promotion." },
      review: { status: "unreviewed" },
    } satisfies WorkbenchTrace;

    expect(workbenchTracePromotionReadiness(trace)).toMatchObject({
      ok: false,
      code: "trace_not_captured",
    });

    const traceWithoutInput = { ...trace };
    delete traceWithoutInput.input;
    expect(workbenchTracePromotionReadiness({
      ...traceWithoutInput,
      id: "trace_without_prompt",
      request: {},
      result: { status: "completed" },
      status: {
        ...trace.status,
        capture: "captured",
        execution: "completed",
      },
    })).toMatchObject({
      ok: false,
      code: "trace_prompt_required",
    });
  });

  test("derives job report costs from matching usage roles before totals", () => {
    const job = (
      id: string,
      role: WorkbenchJob["role"],
      usage: NonNullable<WorkbenchJob["result"]>["usage"],
    ): WorkbenchJob => ({
      id,
      runId: "run_cost_roles",
      kind: "eval",
      role,
      versionId: "v001",
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      caseId: id,
      sample: 0,
      status: "succeeded",
      result: { usage },
      artifactIds: [],
      traceIds: [],
      createdAt: "2026-06-26T00:00:00.000Z",
    });
    const report = buildWorkbenchJobReport([
      job("job_execute", "execute", {
        total: { costUsd: 0.5 },
        runner: { costUsd: 0.2 },
        engine: { costUsd: 0.3 },
      }),
      job("job_execute_total_only", "execute", {
        total: { costUsd: 0.4 },
      }),
      job("job_execute_unmatched_scoped", "execute", {
        total: { costUsd: 1 },
        engine: { costUsd: 0.9 },
      }),
      job("job_grade", "grade", {
        total: { costUsd: 0.7 },
        runner: { costUsd: 0.1 },
        engine: { costUsd: 0.4 },
      }),
      job("job_improve", "improve", {
        total: { costUsd: 0.9 },
        runner: { costUsd: 0.2 },
        improver: { costUsd: 0.6 },
      }),
      job("job_setup", "setup", {
        total: { costUsd: 0.8 },
        runner: { costUsd: 0.1 },
      }),
    ]);

    expect(report.roles.map((role) => [role.role, role.costUsd])).toEqual([
      ["execute", 0.6],
      ["grade", 0.4],
      ["improve", 0.6],
      ["setup", 0.8],
    ]);
    expect(workbenchJobReportTotalCostUsd(report)).toBe(2.4);
  });

  test("summarizes report latency and cost with one sample denominator", () => {
    const job = (
      id: string,
      role: WorkbenchJob["role"],
      caseId: string,
      durationMs: number,
    ): WorkbenchJob => ({
      id,
      runId: "run_role_units",
      kind: "improve",
      role,
      versionId: "v001",
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      caseId,
      sample: 0,
      status: "succeeded",
      durationMs,
      artifactIds: [],
      traceIds: [],
      createdAt: "2026-06-26T00:00:00.000Z",
    });
    const report = buildWorkbenchJobReport([
      job("job_improve", "improve", "current", 500),
      job("job_execute_one", "execute", "case-001", 100),
      job("job_execute_two", "execute", "case-002", 100),
      job("job_grade_one", "grade", "case-001", 300),
    ]);

    expect(report.unitCount).toBe(3);
    expect(workbenchJobReportMetricSummary(report)).toMatchObject({
      sampleCount: 3,
      latency: { total: 1000, perSample: 333 },
      roles: [
        { role: "execute", latency: { total: 200, perSample: 67 } },
        { role: "grade", latency: { total: 300, perSample: 100 } },
        { role: "improve", latency: { total: 500, perSample: 167 } },
      ],
    });
  });

  test("summarizes grade and improve reports without primary-role semantics", () => {
    const gradeOnlyReport = {
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
    } satisfies WorkbenchJobReport;
    const improveOnlyReport = {
      unitCount: 1,
      jobCount: 1,
      totalDurationMs: 700,
      roles: [{
        role: "improve",
        jobCount: 1,
        queued: 0,
        running: 0,
        succeeded: 1,
        failed: 0,
        canceled: 0,
        totalDurationMs: 700,
        costUsd: 0.12,
      }],
    } satisfies WorkbenchJobReport;

    expect(workbenchJobReportMetricSummary(gradeOnlyReport)).toMatchObject({
      latency: { total: 300, perSample: 300 },
      cost: { total: 0.91, perSample: 0.91 },
      roles: [{ role: "grade", latency: { total: 300, perSample: 300 }, cost: { total: 0.91, perSample: 0.91 } }],
    });
    expect(workbenchJobReportMetricSummary(improveOnlyReport)).toMatchObject({
      latency: { total: 700, perSample: 700 },
      cost: { total: 0.12, perSample: 0.12 },
      roles: [{ role: "improve", latency: { total: 700, perSample: 700 }, cost: { total: 0.12, perSample: 0.12 } }],
    });
  });

  test("breaks report metrics into run primary and grade or eval-total details", () => {
    const report = {
      unitCount: 2,
      jobCount: 4,
      totalDurationMs: 900,
      roles: [{
        role: "execute",
        jobCount: 2,
        queued: 0,
        running: 0,
        succeeded: 2,
        failed: 0,
        canceled: 0,
        totalDurationMs: 800,
        costUsd: 0.6,
      }, {
        role: "grade",
        jobCount: 2,
        queued: 0,
        running: 0,
        succeeded: 2,
        failed: 0,
        canceled: 0,
        totalDurationMs: 100,
        costUsd: 0.1,
      }],
    } satisfies WorkbenchJobReport;

    expect(workbenchJobReportMetricBreakdown(report, "latency")).toMatchObject({
      primary: { scope: "run", role: "execute", value: { total: 800, perSample: 400 } },
      run: { scope: "run", role: "execute", value: { total: 800, perSample: 400 } },
      grade: { scope: "grade", role: "grade", value: { total: 100, perSample: 50 } },
      total: { scope: "total", value: { total: 900, perSample: 450 } },
      details: [
        { scope: "grade", value: { total: 100, perSample: 50 } },
        { scope: "total", value: { total: 900, perSample: 450 } },
      ],
    });
    expect(workbenchJobReportMetricBreakdown(report, "cost")).toMatchObject({
      primary: { scope: "run", role: "execute", value: { total: 0.6, perSample: 0.3 } },
      details: [
        { scope: "grade", value: { total: 0.1, perSample: 0.05 } },
        { scope: "total", value: { total: 0.7, perSample: 0.35 } },
      ],
    });
  });

  test("does not substitute grade cost as the primary run cost", () => {
    const report = {
      unitCount: 1,
      jobCount: 2,
      totalDurationMs: 1200,
      roles: [{
        role: "execute",
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
    } satisfies WorkbenchJobReport;

    expect(workbenchJobReportMetricBreakdown(report, "latency").primary).toMatchObject({
      scope: "run",
      value: { total: 900, perSample: 900 },
    });
    expect(workbenchJobReportMetricBreakdown(report, "cost").primary).toBeUndefined();
    expect(workbenchJobReportMetricBreakdown(report, "cost").details).toEqual([{
      scope: "grade",
      label: "grade",
      role: "grade",
      value: { total: 0.91, perSample: 0.91 },
    }]);
  });

  test("uses the total as primary only when a report has no run role", () => {
    const report = {
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
    } satisfies WorkbenchJobReport;

    expect(workbenchJobReportMetricBreakdown(report, "latency")).toMatchObject({
      primary: { scope: "total", value: { total: 300, perSample: 300 } },
      details: [],
    });
    expect(workbenchJobReportMetricBreakdown(report, "cost")).toMatchObject({
      primary: { scope: "total", value: { total: 0.91, perSample: 0.91 } },
      details: [],
    });
  });

  test("keeps skill state and inspection snapshots as plain serializable DTOs", () => {
    const state = {
      schema: "workbench.skill.state.v1",
      root: "/tmp/skill",
      refs: { current: "v001" },
      remotes: {
        origin: { name: "origin", url: "https://workbench.example/skills/acme/skill", kind: "workbench-cloud" },
      },
      versions: [{
        id: "v001",
        hash: "hash",
        message: "initial",
        parentIds: [],
        createdAt: "2026-06-06T00:00:00.000Z",
        files: [{ path: "SKILL.md", content: "# Skill\n" }],
      }],
      skillSources: [{ name: "current", kind: "local", path: "." }],
      skillBundles: [],
      evals: [],
      agents: [{ name: "default", adapter: "local", config: {} }],
      runs: [],
      jobs: [],
      traces: [],
      executionEvents: [],
      artifacts: [],
      lineage: [],
    } satisfies WorkbenchProjectState;
    const snapshot = {
      root: state.root,
      status: {
        root: state.root,
        initialized: true,
        currentVersionId: "v001",
        defaultSkill: "current",
        defaultAgent: "default",
        versionCount: 1,
        skillCount: 1,
        agentCount: 1,
        runCount: 0,
        remoteCount: 1,
      },
      versions: state.versions,
      skillSources: state.skillSources,
      skillBundles: state.skillBundles,
      evals: state.evals,
      evalVersions: [],
      agents: [{ hash: "agent_hash", agent: state.agents[0]! }],
      runs: state.runs,
      jobs: state.jobs,
      traces: state.traces,
      executionEvents: state.executionEvents,
      artifacts: state.artifacts,
      lineage: state.lineage,
      remotes: Object.values(state.remotes),
      refs: state.refs,
    } satisfies WorkbenchInspectionSnapshot;
    const fileContent = {
      path: "output/blob.bin",
      kind: "binary",
      encoding: "base64",
      unavailableReason: "Binary file content is not rendered.",
    } satisfies WorkbenchInspectionFileContent;
    const envelope = {
      schema: "workbench.inspection.snapshot-envelope.v1",
      cursor: "cursor_001",
      snapshot,
      actions: {
        variant: "local",
        evidenceAccess: "full",
        run: {
          enabled: true,
          defaultRequest: {
            kind: "eval",
            variant: "local",
            caseIds: ["case_001"],
            targets: [{ agent: "default" }],
            phases: ["execute"],
            grader: { kind: "none" },
            samples: 1,
          },
        },
        grade: {
          enabled: true,
          defaultRequest: {
            kind: "eval",
            variant: "local",
            caseIds: ["case_001"],
            targets: [{ agent: "default" }],
            phases: ["grade"],
            grader: { kind: "evaluation" },
            samples: 1,
          },
        },
        eval: {
          enabled: true,
          defaultRequest: {
            kind: "eval",
            variant: "local",
            caseIds: ["case_001"],
            targets: [{ agent: "default" }],
            phases: ["execute", "grade"],
            grader: { kind: "evaluation" },
            samples: 1,
          },
        },
        improve: {
          enabled: false,
          defaultRequest: { kind: "improve", variant: "local", samples: 1, budget: 1 },
          disabledReason: "No improvement evidence is available.",
        },
        acquisition: [{
          id: "open-local",
          label: "Open local project",
          kind: "copy-command",
          value: "workbench open",
        }],
      },
    } satisfies WorkbenchInspectionSnapshotEnvelope;

    expect(JSON.parse(JSON.stringify({ state, snapshot, fileContent, envelope }))).toMatchObject({
      state: { schema: "workbench.skill.state.v1", refs: { current: "v001" } },
      snapshot: { status: { initialized: true }, refs: { current: "v001" } },
      fileContent: { path: "output/blob.bin", unavailableReason: "Binary file content is not rendered." },
      envelope: {
        actions: {
          variant: "local",
          run: { enabled: true, defaultRequest: { kind: "eval", variant: "local", phases: ["execute"] } },
          grade: { enabled: true, defaultRequest: { kind: "eval", variant: "local", phases: ["grade"] } },
          eval: { enabled: true, defaultRequest: { kind: "eval", variant: "local", phases: ["execute", "grade"] } },
          improve: { enabled: false, defaultRequest: { kind: "improve", variant: "local" } },
          acquisition: [{ label: "Open local project" }],
        },
      },
    });
  });

  test("keeps live inspection notices adapter-neutral", () => {
    const notices = [
      { schema: "workbench.state.notice.v1", type: "changed", cursor: "local:2:0:now" },
      { schema: "workbench.state.notice.v1", type: "reset", cursor: "local:2:0:now" },
      {
        schema: "workbench.state.notice.v1",
        type: "progress",
        cursor: "local:2:1:now",
        runIds: ["run_001"],
        jobIds: ["job_001"],
      },
      { schema: "workbench.state.notice.v1", type: "heartbeat", cursor: "local:2:1:now" },
    ] satisfies WorkbenchStateNotice[];

    expect(JSON.parse(JSON.stringify({ notices }))).toMatchObject({
      notices: [
        { type: "changed" },
        { type: "reset" },
        { type: "progress", runIds: ["run_001"], jobIds: ["job_001"] },
        { type: "heartbeat" },
      ],
    });
  });

  test("keeps dangerous adapter auth env names reserved", () => {
    expect(isReservedWorkbenchAdapterAuthEnvName("WORKBENCH_TOKEN")).toBe(true);
    expect(() => assertWorkbenchAdapterAuthEnvNameAllowed("PATH")).toThrow("reserved");
    expect(() => assertWorkbenchAdapterAuthEnvNameAllowed("OPENAI_API_KEY")).not.toThrow();
  });

  test("serializes run snapshots and stored retry plans as the canonical launch contract", () => {
    const snapshot = {
      schema: "workbench.run.v1",
      id: "run_matrix",
      kind: "eval",
      variant: "local",
      status: "running",
      phase: "running",
      plan: {
        kind: "eval",
        variant: "local",
        versionId: "v002",
        evalHash: "eval_hash",
        skills: ["current", "baseline"],
        agents: ["default"],
        samples: 2,
        rerun: true,
      },
      progress: {
        planned: 4,
        completed: 1,
        scored: 1,
        failed: 0,
        canceled: 0,
        partialScore: 1,
        evidenceCount: 2,
        elapsedMs: 1000,
        lastProgressAt: "2026-06-16T12:00:00.000Z",
      },
      report: {
        unitCount: 1,
        jobCount: 0,
        roles: [],
      },
      measurements: [{
        versionId: "v002",
        skillName: "current",
        skillBundleHash: "bundle_primary",
        evalHash: "eval_hash",
        agentName: "default",
        agentHash: "agent_hash",
        runId: "run_matrix",
        status: "running",
        score: 1,
        coverage: { completed: 1, planned: 1 },
      }],
      route: {
        kind: "run",
        runId: "run_matrix",
      },
      cliEquivalent: "workbench eval --versions all -n 2",
      next: "workbench watch run_matrix",
    } satisfies WorkbenchRunSnapshot;

    expect(JSON.parse(JSON.stringify({ snapshot }))).toMatchObject({
      snapshot: {
        schema: "workbench.run.v1",
        id: "run_matrix",
        progress: { planned: 4, partialScore: 1 },
        route: { runId: "run_matrix" },
        plan: { rerun: true },
        next: "workbench watch run_matrix",
      },
    });

    const run = {
      id: "run_with_plan",
      kind: "eval",
      versionId: "v002",
      skillName: "current",
      skillBundleHash: "bundle_primary",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "running",
      operationPlan: snapshot.plan,
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-16T12:00:00.000Z",
    } satisfies WorkbenchRun;
    expect(JSON.parse(JSON.stringify(run))).toMatchObject({
      id: "run_with_plan",
      operationPlan: {
        kind: "eval",
        variant: "local",
        versionId: "v002",
        skills: ["current", "baseline"],
        agents: ["default"],
        samples: 2,
      },
    });
  });

  test("builds adapter-neutral run evidence from jobs, agents, and result cells", () => {
    const createdAt = "2026-06-22T12:00:00.000Z";
    const snapshot = {
      root: "/tmp/skill",
      status: {
        root: "/tmp/skill",
        initialized: true,
        currentVersionId: "v001",
        defaultSkill: "current",
        defaultAgent: "codex",
        versionCount: 1,
        skillCount: 1,
        agentCount: 2,
        runCount: 1,
        remoteCount: 0,
      },
      versions: [{
        id: "v001",
        hash: "version_hash",
        message: "initial",
        parentIds: [],
        createdAt,
        files: [{ path: "SKILL.md", content: "# Skill\n" }],
      }],
      skillSources: [{ name: "current", kind: "local", path: "." }],
      skillBundles: [],
      evals: [],
      evalVersions: [{
        id: "eval-v1",
        hash: "eval_hash",
        label: "Eval v1",
        ordinal: 1,
        current: true,
        caseCount: 1,
        gradeAdapter: "tests",
        createdAt,
        updatedAt: createdAt,
        runCount: 1,
        latestRunId: "run_matrix",
        latestQuality: 1,
      }],
      agents: [
        { hash: "agent_codex", agent: { name: "codex", adapter: "codex", model: "gpt-5.5", config: {} } },
        { hash: "agent_claude", agent: { name: "claude", adapter: "claude", model: "haiku-4.5", config: {} } },
      ],
      results: {
        skillVersions: [{
          id: "skill_current",
          label: "Current",
          projectVersionId: "v001",
          contentHash: "bundle_hash",
          current: true,
        }],
        evalVersions: [{
          id: "eval-v1",
          hash: "eval_hash",
          label: "Eval v1",
          ordinal: 1,
          current: true,
          caseCount: 1,
          gradeAdapter: "tests",
          createdAt,
          updatedAt: createdAt,
          runCount: 1,
          latestRunId: "run_matrix",
          latestQuality: 1,
        }],
        agentVersions: [
          { id: "agent_codex", name: "codex", label: "codex / gpt-5.5", adapter: "codex", model: "gpt-5.5" },
          { id: "agent_claude", name: "claude", label: "claude / haiku-4.5", adapter: "claude", model: "haiku-4.5" },
        ],
        cells: [
          {
            skillVersionId: "skill_current",
            evalVersionId: "eval-v1",
            agentVersionId: "agent_codex",
            runId: "run_matrix",
            status: "succeeded",
            quality: 1,
            coverage: { completed: 1, planned: 1 },
          },
          {
            skillVersionId: "skill_current",
            evalVersionId: "eval-v1",
            agentVersionId: "agent_claude",
            runId: "run_matrix",
            status: "failed",
            coverage: { completed: 0, planned: 1 },
            error: "Model rejected.",
          },
        ],
      },
      runs: [{
        id: "run_matrix",
        kind: "eval",
        versionId: "v001",
        skillName: "current",
        skillBundleHash: "bundle_hash",
        evalHash: "eval_hash",
        agentName: "codex,claude",
        agentHash: "multi_agent_hash",
        status: "failed",
        jobIds: ["job_codex_execute", "job_codex_grade", "job_claude_execute", "job_claude_grade"],
        traceIds: [],
        createdAt,
        finishedAt: "2026-06-22T12:00:05.000Z",
      }],
      jobs: [
        {
          id: "job_codex_execute",
          runId: "run_matrix",
          kind: "eval",
          role: "execute",
          versionId: "v001",
          skillName: "current",
          skillBundleHash: "bundle_hash",
          evalHash: "eval_hash",
          agentName: "codex",
          agentHash: "agent_codex",
          caseId: "googl",
          sample: 0,
          status: "succeeded",
          artifactIds: [],
          traceIds: [],
          createdAt,
          durationMs: 1000,
          result: { usage: { total: { costUsd: 0.32 } } },
        },
        {
          id: "job_codex_grade",
          runId: "run_matrix",
          kind: "eval",
          role: "grade",
          versionId: "v001",
          skillName: "current",
          skillBundleHash: "bundle_hash",
          evalHash: "eval_hash",
          agentName: "codex",
          agentHash: "agent_codex",
          caseId: "googl",
          sample: 0,
          status: "succeeded",
          artifactIds: [],
          traceIds: [],
          createdAt,
          durationMs: 2000,
          dependencies: [{ name: "execute", jobId: "job_codex_execute", mount: "input", mode: "readonly" }],
          result: {
            usage: { total: { costUsd: 0.1 } },
            items: [{ kind: "score", score: 1, value: 1 }],
          },
        },
        {
          id: "job_claude_execute",
          runId: "run_matrix",
          kind: "eval",
          role: "execute",
          versionId: "v001",
          skillName: "current",
          skillBundleHash: "bundle_hash",
          evalHash: "eval_hash",
          agentName: "claude",
          agentHash: "agent_claude",
          caseId: "googl",
          sample: 0,
          status: "failed",
          artifactIds: [],
          traceIds: ["trace_claude_execute"],
          createdAt,
          durationMs: 250,
          error: "Model rejected.",
        },
        {
          id: "job_claude_grade",
          runId: "run_matrix",
          kind: "eval",
          role: "grade",
          versionId: "v001",
          skillName: "current",
          skillBundleHash: "bundle_hash",
          evalHash: "eval_hash",
          agentName: "claude",
          agentHash: "agent_claude",
          caseId: "googl",
          sample: 0,
          status: "canceled",
          artifactIds: [],
          traceIds: [],
          createdAt,
          durationMs: 10,
          dependencies: [{ name: "execute", jobId: "job_claude_execute", mount: "input", mode: "readonly" }],
          error: "Dependency failed.",
        },
      ],
      traces: [{
        id: "trace_claude_execute",
        runId: "run_matrix",
        jobId: "job_claude_execute",
        versionId: "v001",
        skillName: "current",
        skillBundleHash: "bundle_hash",
        evalHash: "eval_hash",
        agentName: "claude",
        agentHash: "agent_claude",
        createdAt,
        request: { caseId: "googl" },
        result: {
          status: "failed",
          usage: { runner: { costUsd: 0.23 }, total: { costUsd: 0.23 } },
        },
        files: [],
      }],
      executionEvents: [],
      artifacts: [],
      lineage: [],
      remotes: [],
      refs: { current: "v001" },
    } satisfies WorkbenchInspectionSnapshot;

    const evidence = buildWorkbenchRunEvidenceView(snapshot, "run_matrix");

    expect(evidence?.measurements).toMatchObject([
      {
        agentLabel: "claude / haiku-4.5",
        adapter: "claude",
        model: "haiku-4.5",
        status: "failed",
        report: {
          totalDurationMs: 260,
          roles: [
            { role: "execute", costUsd: 0.23, totalDurationMs: 250 },
            { role: "grade", totalDurationMs: 10 },
          ],
        },
        coverage: { completed: 0, planned: 1 },
        failedJobs: 1,
        canceledJobs: 1,
      },
      {
        agentLabel: "codex / gpt-5.5",
        adapter: "codex",
        model: "gpt-5.5",
        status: "succeeded",
        score: 1,
        report: {
          totalDurationMs: 3000,
          roles: [
            { role: "execute", costUsd: 0.32, totalDurationMs: 1000 },
            { role: "grade", costUsd: 0.1, totalDurationMs: 2000 },
          ],
        },
        coverage: { completed: 1, planned: 1 },
      },
    ]);
    expect(evidence?.measurements.map((measurement) => workbenchJobReportTotalCostUsd(measurement.report))).toEqual([0.23, 0.42]);
    expect(evidence?.cases).toMatchObject([
      {
        agentLabel: "claude / haiku-4.5",
        caseId: "googl",
        selectedJobId: "job_claude_grade",
        status: "failed",
        execute: { jobId: "job_claude_execute", status: "failed", error: "Model rejected." },
        grade: {
          jobId: "job_claude_grade",
          status: "canceled",
          dependencyReason: "Dependency failed.; execute failed: Model rejected.",
        },
      },
      {
        agentLabel: "codex / gpt-5.5",
        caseId: "googl",
        selectedJobId: "job_codex_grade",
        status: "succeeded",
        score: 1,
        execute: { jobId: "job_codex_execute", status: "succeeded" },
        grade: { jobId: "job_codex_grade", status: "succeeded", score: 1 },
      },
    ]);
    expect(evidence?.jobs.map((job) => `${job.agentLabel}:${job.role}:${job.status}`)).toEqual([
      "claude / haiku-4.5:execute:failed",
      "claude / haiku-4.5:grade:canceled",
      "codex / gpt-5.5:execute:succeeded",
      "codex / gpt-5.5:grade:succeeded",
    ]);
  });

  test("keeps measured skills distinct in one run matrix", () => {
    const createdAt = "2026-06-22T13:00:00.000Z";
    const measuredSkills = [
      {
        name: "current",
        label: "Current",
        bundleHash: "bundle_current",
        skillVersionId: "skill_current",
        score: 0.9,
        executeCostUsd: 0.11,
        executeDurationMs: 111,
      },
      {
        name: "no-skill",
        label: "No skill",
        bundleHash: "bundle_none",
        skillVersionId: "skill_none",
        score: 0.4,
        executeCostUsd: 0.22,
        executeDurationMs: 222,
      },
      {
        name: "dummy-skill",
        label: "Dummy skill",
        bundleHash: "bundle_dummy",
        skillVersionId: "skill_dummy",
        score: 0.7,
        executeCostUsd: 0.33,
        executeDurationMs: 333,
      },
    ];
    const jobs = measuredSkills.flatMap((skill) => [
      {
        id: `job_${skill.name}_execute`,
        runId: "run_skills",
        kind: "eval" as const,
        role: "execute" as const,
        versionId: "v002",
        skillName: skill.name,
        skillBundleHash: skill.bundleHash,
        evalHash: "eval_hash",
        agentName: "default",
        agentHash: "agent_hash",
        caseId: "case_001",
        sample: 0,
        status: "succeeded" as const,
        artifactIds: [],
        traceIds: [],
        createdAt,
        durationMs: skill.executeDurationMs,
        result: { usage: { total: { costUsd: skill.executeCostUsd } } },
      },
      {
        id: `job_${skill.name}_grade`,
        runId: "run_skills",
        kind: "eval" as const,
        role: "grade" as const,
        versionId: "v002",
        skillName: skill.name,
        skillBundleHash: skill.bundleHash,
        evalHash: "eval_hash",
        agentName: "default",
        agentHash: "agent_hash",
        caseId: "case_001",
        sample: 0,
        status: "succeeded" as const,
        artifactIds: [],
        traceIds: [],
        dependencies: [{ name: "execute", jobId: `job_${skill.name}_execute`, mount: "input", mode: "readonly" as const }],
        result: { items: [{ kind: "score", score: skill.score, value: skill.score }] },
        createdAt,
        durationMs: 20,
      },
    ]);
    const snapshot = {
      root: "/tmp/skill",
      status: {
        root: "/tmp/skill",
        initialized: true,
        currentVersionId: "v002",
        defaultSkill: "current",
        defaultAgent: "default",
        versionCount: 1,
        skillCount: 3,
        agentCount: 1,
        runCount: 1,
        remoteCount: 0,
      },
      versions: [{
        id: "v002",
        hash: "version_hash",
        message: "current",
        parentIds: [],
        createdAt,
        files: [{ path: "SKILL.md", content: "# Skill\n" }],
      }],
      skillSources: measuredSkills.map((skill) => ({ name: skill.name, kind: "local" as const, path: "." })),
      skillBundles: measuredSkills.map((skill) => ({
        hash: skill.bundleHash,
        skillName: skill.name,
        entryName: skill.name,
        source: { name: skill.name, kind: "local" as const, path: "." },
        files: [],
        includedSkills: [],
        createdAt,
      })),
      evals: [],
      evalVersions: [{
        id: "eval-v1",
        hash: "eval_hash",
        label: "Eval v1",
        ordinal: 1,
        current: true,
        caseCount: 1,
        gradeAdapter: "tests",
        createdAt,
        updatedAt: createdAt,
        runCount: 1,
        latestRunId: "run_skills",
      }],
      agents: [{ hash: "agent_hash", agent: { name: "default", adapter: "command", model: "deterministic", config: {} } }],
      results: {
        skillVersions: measuredSkills.map((skill) => ({
          id: skill.skillVersionId,
          label: skill.label,
          projectVersionId: "v002",
          contentHash: skill.bundleHash,
        })),
        evalVersions: [{
          id: "eval-v1",
          hash: "eval_hash",
          label: "Eval v1",
          ordinal: 1,
          current: true,
          caseCount: 1,
          gradeAdapter: "tests",
          createdAt,
          updatedAt: createdAt,
          runCount: 1,
          latestRunId: "run_skills",
        }],
        agentVersions: [{ id: "agent_hash", name: "default", label: "default / deterministic", adapter: "command", model: "deterministic" }],
        cells: measuredSkills.map((skill) => ({
          skillVersionId: skill.skillVersionId,
          evalVersionId: "eval-v1",
          agentVersionId: "agent_hash",
          runId: "run_skills",
          status: "succeeded" as const,
          quality: skill.score,
          coverage: { completed: 1, planned: 1 },
        })),
      },
      runs: [{
        id: "run_skills",
        kind: "eval",
        versionId: "v002",
        skillName: "all",
        skillBundleHash: "bundle_matrix",
        evalHash: "eval_hash",
        agentName: "default",
        agentHash: "agent_hash",
        status: "succeeded",
        jobIds: jobs.map((job) => job.id),
        traceIds: [],
        createdAt,
        finishedAt: createdAt,
      }],
      jobs,
      traces: [],
      executionEvents: [],
      artifacts: [],
      lineage: [],
      remotes: [],
      refs: { current: "v002" },
    } satisfies WorkbenchInspectionSnapshot;

    const evidence = buildWorkbenchRunEvidenceView(snapshot, "run_skills");

    expect(evidence?.measurements).toMatchObject([
      {
        skillLabel: "Current",
        agentLabel: "default / deterministic",
        score: 0.9,
        report: {
          roles: expect.arrayContaining([
            expect.objectContaining({ role: "execute", totalDurationMs: 111 }),
          ]),
        },
        coverage: { completed: 1, planned: 1 },
      },
      {
        skillLabel: "Dummy skill",
        agentLabel: "default / deterministic",
        score: 0.7,
        report: {
          roles: expect.arrayContaining([
            expect.objectContaining({ role: "execute", totalDurationMs: 333 }),
          ]),
        },
        coverage: { completed: 1, planned: 1 },
      },
      {
        skillLabel: "No skill",
        agentLabel: "default / deterministic",
        score: 0.4,
        report: {
          roles: expect.arrayContaining([
            expect.objectContaining({ role: "execute", totalDurationMs: 222 }),
          ]),
        },
        coverage: { completed: 1, planned: 1 },
      },
    ]);
    expect(evidence?.measurements.map((measurement) => workbenchJobReportTotalCostUsd(measurement.report))).toEqual([0.11, 0.33, 0.22]);
    expect(evidence?.cases.map((entry) => `${entry.skillLabel}:${entry.selectedJobId}:${entry.score}`)).toEqual([
      "Current:job_current_grade:0.9",
      "Dummy skill:job_dummy-skill_grade:0.7",
      "No skill:job_no-skill_grade:0.4",
    ]);
    expect(evidence?.jobs.map((entry) => `${entry.skillLabel}:${entry.role}`)).toEqual([
      "Current:execute",
      "Current:grade",
      "Dummy skill:execute",
      "Dummy skill:grade",
      "No skill:execute",
      "No skill:grade",
    ]);
  });

  test("shapes inspection files consistently for manifests and explicit content reads", () => {
    const text = { path: "SKILL.md", kind: "text", encoding: "utf8", content: "# Skill\n" } as const;
    const binary = { path: "asset.bin", kind: "binary", encoding: "base64", content: "QUJD" } as const;

    expect(workbenchInspectionFileManifest(text)).toEqual({
      path: "SKILL.md",
      kind: "text",
      encoding: "utf8",
      content: "",
    });
    expect(workbenchInspectionFileContent(text)).toEqual({
      path: "SKILL.md",
      kind: "text",
      encoding: "utf8",
      content: "# Skill\n",
    });
    expect(workbenchInspectionFileContent(binary)).toEqual({
      path: "asset.bin",
      kind: "binary",
      encoding: "base64",
      unavailableReason: "Binary file content is not rendered.",
    });
    expect(workbenchInspectionFileContentUnavailableReason({ encoding: "base64" }))
      .toBe("Base64 file content is not rendered.");
  });

  test("defines inspection file owner route vocabulary", () => {
    expect(workbenchInspectionFileOwnerKindFromRouteSegment("versions")).toBe("version");
    expect(workbenchInspectionFileOwnerKindFromRouteSegment("traces")).toBe("trace");
    expect(workbenchInspectionFileOwnerKindFromRouteSegment("artifacts")).toBe("artifact");
    expect(workbenchInspectionFileOwnerKindFromRouteSegment("cases")).toBe("case");
    expect(workbenchInspectionFileOwnerKindFromRouteSegment("evaluation")).toBe("evaluation");
    expect(workbenchInspectionFileOwnerKindFromRouteSegment("skills")).toBeNull();

    expect(workbenchInspectionFileOwnerRouteSegment("version")).toBe("versions");
    expect(workbenchInspectionFileOwnerRouteSegment("trace")).toBe("traces");
    expect(workbenchInspectionFileOwnerRouteSegment("artifact")).toBe("artifacts");
    expect(workbenchInspectionFileOwnerRouteSegment("case")).toBe("cases");
  });

  test("round-trips case file owner ids", () => {
    expect(workbenchCaseFileOwnerId("eval_hash", "case-001")).toBe("eval_hash:case-001");
    expect(parseWorkbenchCaseFileOwnerId("eval_hash:case-001")).toEqual({
      evaluationHash: "eval_hash",
      caseId: "case-001",
    });
    expect(parseWorkbenchCaseFileOwnerId("eval_hash:case:with:colon")).toEqual({
      evaluationHash: "eval_hash",
      caseId: "case:with:colon",
    });
    expect(parseWorkbenchCaseFileOwnerId("eval_hash")).toBeNull();
    expect(parseWorkbenchCaseFileOwnerId(":case-001")).toBeNull();
  });

  test("normalizes source paths and classifies Workbench file roles explicitly", () => {
    expect(normalizeWorkbenchSourcePath(".workbench/eval.yaml")).toBe(".workbench/eval.yaml");
    expect(normalizeWorkbenchSourceRequestPath("/.workbench/eval.yaml")).toBe(".workbench/eval.yaml");
    expect(() => normalizeWorkbenchSourcePath("/.workbench/eval.yaml")).toThrow(/Unsafe Workbench source path/u);
    expect(() => normalizeWorkbenchSourcePath("../state")).toThrow(/Unsafe Workbench source path/u);
    expect(() => normalizeWorkbenchSourcePath("source//SKILL.md")).toThrow(/Unsafe Workbench source path/u);

    expect(isWorkbenchRuntimeMetadataPath(".workbench/remotes.yaml")).toBe(true);
    expect(isWorkbenchRuntimeMetadataPath(".workbench/locks/project.lock")).toBe(true);
    expect(isWorkbenchRuntimeMetadataPath(".workbench/objects/run/run_001.json")).toBe(true);
    expect(isWorkbenchRuntimeMetadataPath(".workbench/eval.yaml")).toBe(false);

    expect(isWorkbenchAuthoredControlPath(".workbench/eval.yaml")).toBe(true);
    expect(isWorkbenchAuthoredControlPath(".workbench/cases/case-001/case.yaml")).toBe(true);
    expect(isWorkbenchAuthoredControlPath(".workbench/environment/Dockerfile")).toBe(true);
    expect(isWorkbenchAuthoredControlPath(".workbench/remotes.yaml")).toBe(false);

    expect(isWorkbenchPackageSourcePath("SKILL.md")).toBe(true);
    expect(isWorkbenchPackageSourcePath("references/guide.md")).toBe(true);
    expect(isWorkbenchPackageSourcePath("dist/generated.js")).toBe(true);
    expect(isWorkbenchPackageSourcePath("tools/dist/generated.js")).toBe(true);
    expect(isWorkbenchPackageSourcePath(".git/config")).toBe(false);
    expect(isWorkbenchPackageSourcePath("node_modules/pkg/index.js")).toBe(false);
    expect(isWorkbenchPackageSourcePath(".workbench/eval.yaml")).toBe(false);
    expect(isWorkbenchPackageSourcePath(".agents/skills/workbench/SKILL.md")).toBe(false);
  });
});
