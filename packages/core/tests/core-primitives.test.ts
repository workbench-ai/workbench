import { describe, expect, test } from "vitest";

import {
  DOCKER_SANDBOX_BACKEND,
  applyWorkbenchSkillPatch,
  composeRuntimeDockerfileWithAdapterInstallers,
  createWorkbenchActionCapabilities,
  planWorkbenchOperationGraph,
  parseWorkbenchOperationRequest,
  createWorkbenchRunSnapshot,
  resolveWorkbenchRunRetryRequest,
  runWorkbenchExecutionDag,
  workbenchOperationCliEquivalent,
  type WorkbenchInspectionSnapshot,
  type WorkbenchJob,
  type WorkbenchRun,
  type WorkbenchExecutionJob,
} from "../src/index.ts";
import {
  compileWorkbenchExecutionGraph,
  type CompileExecutionGraphInput,
} from "../src/execution-graph.ts";
import type { GenericRunSpec } from "../src/generic-spec.ts";
import type { WorkbenchOperationStep, WorkbenchOperationRequest } from "@workbench-ai/workbench-contract";

describe("workbench operation graph", () => {
  test("plans selected samples and only concrete grade dependencies", () => {
    const graph = planWorkbenchOperationGraph({
      kind: "eval",
      targetCount: 2,
      cases: [
        { id: "case-a", path: "a", gradableTargetIndexes: [0] },
        { id: "case-b", path: "b", gradableTargetIndexes: [] },
      ],
      samples: 3,
      selectedSamples: [{ caseId: "a", sample: 2 }],
    });

    expect(graph.nodes.filter((node) => node.role === "run")).toHaveLength(8);
    expect(graph.nodes.filter((node) => node.role === "grade")).toEqual([
      expect.objectContaining({ targetIndex: 0, caseId: "case-a", sample: 2, dependencies: ["0:case-a:2:run"] }),
    ]);
  });
});

function evalOperationRequest(options: {
  variant?: "local" | "cloud";
  versionId?: string;
  evalHash?: string;
  skill?: string;
  agent?: string;
  caseIds?: readonly string[];
  samples?: number;
  steps?: readonly WorkbenchOperationStep[];
} = {}): WorkbenchOperationRequest {
  const steps = options.steps ?? ["run", "grade"];
  return {
    kind: "eval",
    variant: options.variant ?? "local",
    caseIds: options.caseIds ?? [],
    targets: [{
      ...(options.versionId ? { versionId: options.versionId } : {}),
      ...(options.skill ? { skill: options.skill } : {}),
      ...(options.agent ? { agent: options.agent } : {}),
    }],
    steps,
    ...(options.samples !== undefined ? { samples: options.samples } : {}),
  };
}

describe("workbench execution DAG scheduler", () => {
  test("starts independent jobs concurrently up to host capacity", async () => {
    const jobs = ["a", "b", "c", "d", "e"].map((id) => testJob(id));
    let active = 0;
    let maxActive = 0;

    const result = await runWorkbenchExecutionDag({
      jobs,
      sandboxBackend: DOCKER_SANDBOX_BACKEND,
      capacity: { cpu: 5, memoryGb: 5, diskGb: 5 },
      executeJob: async (job) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(25);
        active -= 1;
        return succeededJob(job);
      },
    });

    expect(result.startedJobCount).toBe(5);
    expect(result.maxConcurrency).toBe(5);
    expect(maxActive).toBe(5);
    expect(result.jobs.every((job) => job.status === "succeeded")).toBe(true);
  });

  test("starts dependents after prerequisites finish", async () => {
    const jobs = [
      testJob("runner"),
      testJob("score-a", ["runner"]),
      testJob("score-b", ["runner"]),
    ];
    const finished = new Set<string>();
    const dependentStartedAfterRunner: boolean[] = [];

    const result = await runWorkbenchExecutionDag({
      jobs,
      sandboxBackend: DOCKER_SANDBOX_BACKEND,
      capacity: { cpu: 3, memoryGb: 3, diskGb: 3 },
      executeJob: async (job) => {
        if (job.id.startsWith("score-")) {
          dependentStartedAfterRunner.push(finished.has("runner"));
        }
        await sleep(10);
        finished.add(job.id);
        return succeededJob(job);
      },
    });

    expect(result.maxConcurrency).toBe(2);
    expect(dependentStartedAfterRunner).toEqual([true, true]);
    expect(result.jobs.map((job) => job.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
  });

  test("uses resource admission instead of a parallelism knob", async () => {
    const jobs = ["a", "b", "c", "d"].map((id) => testJob(id));
    let active = 0;
    let maxActive = 0;

    const result = await runWorkbenchExecutionDag({
      jobs,
      sandboxBackend: DOCKER_SANDBOX_BACKEND,
      capacity: { cpu: 2, memoryGb: 2, diskGb: 2 },
      executeJob: async (job) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(15);
        active -= 1;
        return succeededJob(job);
      },
    });

    expect(result.maxConcurrency).toBe(2);
    expect(maxActive).toBe(2);
    expect(result.startedJobCount).toBe(4);
  });

  test("cancels jobs whose prerequisites fail", async () => {
    const jobs = [
      testJob("runner"),
      testJob("score", ["runner"]),
    ];

    const result = await runWorkbenchExecutionDag({
      jobs,
      sandboxBackend: DOCKER_SANDBOX_BACKEND,
      capacity: { cpu: 2, memoryGb: 2, diskGb: 2 },
      executeJob: async (job) =>
        job.id === "runner"
          ? failedJob(job, "runner failed")
          : succeededJob(job),
    });

    expect(result.startedJobCount).toBe(1);
    expect(result.cancelledJobCount).toBe(1);
    expect(result.jobs.map((job) => job.status)).toEqual(["failed", "canceled"]);
    expect(result.jobs[1]?.error).toBe("Dependency failed.");
  });

  test("cancels an already running job through the job control signal", async () => {
    const job = testJob("runner");
    let cancel = false;
    let observedAbort = false;

    const result = await runWorkbenchExecutionDag({
      jobs: [job],
      sandboxBackend: DOCKER_SANDBOX_BACKEND,
      capacity: { cpu: 1, memoryGb: 1, diskGb: 1 },
      shouldCancelJob: () => cancel,
      executeJob: async (runningJob, control) => {
        setTimeout(() => {
          cancel = true;
        }, 5);
        await new Promise<void>((resolve) => {
          control.signal.addEventListener("abort", () => {
            observedAbort = true;
            resolve();
          }, { once: true });
        });
        return succeededJob(runningJob);
      },
    });

    expect(observedAbort).toBe(true);
    expect(result.startedJobCount).toBe(1);
    expect(result.cancelledJobCount).toBe(1);
    expect(result.jobs[0]?.status).toBe("canceled");
  });

  test("builds retry operation requests from the stored operation plan", () => {
    for (const kind of ["run", "grade", "eval"] as const) {
      const steps = kind === "run"
        ? ["run"] as const
        : kind === "grade"
          ? ["grade"] as const
          : ["run", "grade"] as const;
      const run: WorkbenchRun = {
        id: `run_${kind}`,
        kind,
        versionId: "v_base",
        skillName: "current",
        skillBundleHash: "bundle_hash",
        evalHash: "eval_hash",
        agentName: "default",
        agentHash: "agent_hash",
        status: "failed",
        jobIds: [],
        traceIds: [],
        createdAt: "2026-06-15T00:00:00.000Z",
        operationPlan: {
          kind,
          variant: "local",
          versionId: "v_base",
          evalHash: "eval_hash",
          skills: ["current"],
          agents: ["default", "strict"],
          caseIds: ["case-a"],
          steps,
          samples: 2,
        },
      };

      expect(resolveWorkbenchRunRetryRequest(retrySnapshot({ run, jobs: [] }), run)).toEqual({
        kind: "eval",
        variant: "local",
        evalHash: "eval_hash",
        caseIds: ["case-a"],
        targets: [
          { skill: "current", versionId: "v_base", agent: "default" },
          { skill: "current", versionId: "v_base", agent: "strict" },
        ],
        steps,
        samples: 2,
        rerun: true,
        retryOfRunId: `run_${kind}`,
      });
    }

    const run: WorkbenchRun = {
      id: "run_improve",
      kind: "improve",
      versionId: "v_candidate",
      baseVersionId: "v_base",
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "patcher",
      agentHash: "agent_hash",
      status: "failed",
      jobIds: ["job_a_0", "job_a_1", "job_b_0", "job_b_1"],
      traceIds: [],
      createdAt: "2026-06-15T00:00:00.000Z",
      operationPlan: {
        kind: "improve",
        variant: "local",
        versionId: "v_base",
        evalHash: "eval_hash",
        skills: ["current"],
        agents: ["patcher"],
        samples: 2,
        budget: 3,
      },
    };
    const snapshot = retrySnapshot({
      run,
      jobs: [
        retryJob(run, "job_a_0", "case-a", 0),
        retryJob(run, "job_a_1", "case-a", 1),
        retryJob(run, "job_b_0", "case-b", 0),
        retryJob(run, "job_b_1", "case-b", 1),
      ],
    });

    expect(resolveWorkbenchRunRetryRequest(snapshot, run)).toEqual({
      kind: "improve",
      variant: "local",
      versionId: "v_base",
      evalHash: "eval_hash",
      target: {
        versionId: "v_base",
        skill: "current",
        agent: "patcher",
      },
      samples: 2,
      budget: 3,
      retryOfRunId: "run_improve",
    });
  });

  test("rejects retry when the stored operation plan is missing", () => {
    const run: WorkbenchRun = {
      id: "run_eval",
      kind: "eval",
      versionId: "v_base",
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "failed",
      jobIds: ["job_a_0", "job_a_1", "job_b_0"],
      traceIds: [],
      createdAt: "2026-06-15T00:00:00.000Z",
      requestedSamples: 2,
    };

    expect(() => resolveWorkbenchRunRetryRequest(retrySnapshot({ run, jobs: [] }), run)).toThrow(expect.objectContaining({ code: "run_retry_incomplete", remediation: "workbench eval run" }) as Error);
  });

  test("rejects retry when the stored operation plan eval hash is missing", () => {
    const run: WorkbenchRun = {
      id: "run_eval",
      kind: "eval",
      versionId: "v_base",
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "failed",
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-15T00:00:00.000Z",
      operationPlan: {
        kind: "eval",
        variant: "local",
        versionId: "v_base",
        skills: ["current"],
        agents: ["default"],
        steps: ["run", "grade"],
        samples: 1,
      },
    };

    expect(() => resolveWorkbenchRunRetryRequest(retrySnapshot({ run, jobs: [] }), run))
      .toThrow(/does not record operationPlan\.evalHash/u);
  });

  test("rejects retry when stored operation plan samples are not an integer", () => {
    const run: WorkbenchRun = {
      id: "run_eval",
      kind: "eval",
      versionId: "v_base",
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "failed",
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-15T00:00:00.000Z",
      operationPlan: {
        kind: "eval",
        variant: "local",
        versionId: "v_base",
        evalHash: "eval_hash",
        skills: ["current"],
        agents: ["default"],
        samples: 1.5,
      },
    };

    expect(() => resolveWorkbenchRunRetryRequest(retrySnapshot({ run, jobs: [] }), run))
      .toThrow(/invalid operationPlan.samples/u);
  });

  test("operation CLI equivalents preserve literal default and current selectors", () => {
    const omitted: WorkbenchOperationRequest = {
      kind: "eval",
      variant: "local",
      caseIds: [],
      targets: [{}],
      steps: ["run", "grade"],
      samples: 1,
    };
    const explicit: WorkbenchOperationRequest = {
      ...omitted,
      targets: [{ skill: "current", agent: "default" }],
    };

    expect(workbenchOperationCliEquivalent(omitted)).toBe("workbench eval run");
    expect(workbenchOperationCliEquivalent(explicit)).toBe("workbench eval run --versions current --agents default");
  });

  test("operation requests reject empty or unsupported steps", () => {
    expect(() => workbenchOperationCliEquivalent(evalOperationRequest({ steps: [] })))
      .toThrow("Eval operation steps must include run or grade.");

    expect(() => workbenchOperationCliEquivalent(evalOperationRequest({
      steps: ["execute"] as unknown as readonly WorkbenchOperationStep[],
    }))).toThrow("Eval operation steps must include only run or grade.");
  });

  test("parses canonical local and cloud operation requests", () => {
    expect(parseWorkbenchOperationRequest({
      kind: "eval",
      caseIds: ["case-001", "case-001"],
      targets: [{ skill: " current ", agent: "default" }, { skill: "candidate" }],
      steps: ["run", "grade", "run"],
      samples: 2,
      rerun: true,
    }, "local")).toMatchObject({
      kind: "eval",
      variant: "local",
      caseIds: ["case-001"],
      targets: [{ skill: "current", agent: "default" }, { skill: "candidate" }],
      steps: ["run", "grade"],
      samples: 2,
      rerun: true,
    });
    expect(parseWorkbenchOperationRequest({
      kind: "improve",
      target: { versionId: "v1", agent: "patcher" },
      evidenceTraceIds: ["tr1"],
      budget: 1,
    }, "cloud")).toMatchObject({
      kind: "improve",
      variant: "cloud",
      target: { versionId: "v1", agent: "patcher" },
      evidenceTraceIds: ["tr1"],
      budget: 1,
    });
  });

  test("rejects noncanonical values and variant-specific cardinality", () => {
    expect(() => parseWorkbenchOperationRequest({
      kind: "eval",
      caseIds: [],
      targets: [{}],
      steps: ["run"],
    }, "local")).toThrow("at least one case");
    expect(() => parseWorkbenchOperationRequest({
      kind: "eval",
      targets: [{}, {}],
      steps: ["run"],
    }, "cloud")).toThrow("exactly one target");
    expect(() => parseWorkbenchOperationRequest({
      kind: "improve",
      target: "current",
    }, "local")).toThrow("target must be an object");
    expect(() => parseWorkbenchOperationRequest({
      kind: "eval",
      caseIds: ["case-001"],
      targets: [{}],
      steps: ["run"],
      samples: "2",
    }, "local")).toThrow("samples must be a positive integer");
  });

  test("projects run snapshots with job-backed measurements", () => {
    const run: WorkbenchRun = {
      id: "run_matrix",
      kind: "eval",
      versionId: "v_matrix",
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_default",
      status: "succeeded",
      jobIds: ["job_default", "job_patcher"],
      traceIds: [],
      createdAt: "2026-06-16T00:00:00.000Z",
      finishedAt: "2026-06-16T00:00:02.000Z",
      operationPlan: {
        kind: "eval",
        variant: "local",
        versionId: "v_matrix",
        evalHash: "eval_hash",
        skills: ["current"],
        agents: ["default", "patcher"],
        samples: 1,
      },
    };
    const jobs: WorkbenchJob[] = [
      retryJob(run, "job_default", "case-001", 0, {
        status: "succeeded",
        agentName: "default",
        agentHash: "agent_default",
        score: 0.4,
        durationMs: 40,
        error: undefined,
      }),
      retryJob(run, "job_patcher", "case-001", 0, {
        status: "succeeded",
        agentName: "patcher",
        agentHash: "agent_patcher",
        score: 0.9,
        durationMs: 90,
        error: undefined,
      }),
    ];

    const snapshot = createWorkbenchRunSnapshot(evalOperationRequest({
      versionId: "v_matrix",
      evalHash: "eval_hash",
      skill: "current",
      agent: "default,patcher",
      samples: 1,
    }), [run], { jobs });

    expect(snapshot.measurements).toEqual([
      expect.objectContaining({
        runId: "run_matrix",
        agentName: "default",
        score: 0.4,
        coverage: { completed: 1, planned: 1 },
      }),
      expect.objectContaining({
        runId: "run_matrix",
        agentName: "patcher",
        score: 0.9,
        coverage: { completed: 1, planned: 1 },
      }),
    ]);
  });

  test("reports sampled work through generic report metrics", () => {
    const run: WorkbenchRun = {
      id: "run_sampled_report",
      kind: "eval",
      versionId: "v_sampled",
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_default",
      status: "succeeded",
      jobIds: ["job_execute_0", "job_grade_0", "job_execute_1", "job_grade_1"],
      traceIds: [],
      createdAt: "2026-06-16T00:00:00.000Z",
      finishedAt: "2026-06-16T00:00:02.000Z",
      operationPlan: {
        kind: "eval",
        variant: "local",
        versionId: "v_sampled",
        evalHash: "eval_hash",
        skills: ["current"],
        agents: ["default"],
        samples: 2,
      },
    };
    const jobs: WorkbenchJob[] = [
      retryJob(run, "job_execute_0", "case-001", 0, {
        role: "run",
        status: "succeeded",
        durationMs: 40,
        error: undefined,
      }),
      retryJob(run, "job_grade_0", "case-001", 0, {
        status: "succeeded",
        score: 0.4,
        error: undefined,
      }),
      retryJob(run, "job_execute_1", "case-001", 1, {
        role: "run",
        status: "succeeded",
        durationMs: 60,
        error: undefined,
      }),
      retryJob(run, "job_grade_1", "case-001", 1, {
        status: "succeeded",
        score: 0.6,
        error: undefined,
      }),
    ];

    const snapshot = createWorkbenchRunSnapshot(evalOperationRequest({
      versionId: "v_sampled",
      evalHash: "eval_hash",
      skill: "current",
      agent: "default",
      samples: 2,
    }), [run], { jobs });

    expect(snapshot.measurements).toEqual([
      expect.objectContaining({
        runId: "run_sampled_report",
        agentName: "default",
        score: 0.5,
        coverage: { completed: 2, planned: 2 },
        report: expect.objectContaining({
          unitCount: 2,
          roles: expect.arrayContaining([
            expect.objectContaining({
              role: "run",
              totalDurationMs: 100,
            }),
          ]),
        }),
      }),
    ]);
  });

  test("reports running job elapsed from the snapshot observation time", () => {
    const run: WorkbenchRun = {
      id: "run_live_report",
      kind: "eval",
      versionId: "v_live",
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_default",
      status: "running",
      jobIds: ["job_live_execute"],
      traceIds: [],
      createdAt: "2026-06-16T00:00:00.000Z",
      operationPlan: {
        kind: "eval",
        variant: "local",
        versionId: "v_live",
        evalHash: "eval_hash",
        skills: ["current"],
        agents: ["default"],
        samples: 1,
      },
    };
    const jobs: WorkbenchJob[] = [
      {
        id: "job_live_execute",
        runId: run.id,
        kind: run.kind,
        role: "run",
        versionId: run.versionId,
        skillName: run.skillName,
        skillBundleHash: run.skillBundleHash,
        evalHash: run.evalHash,
        agentName: run.agentName,
        agentHash: run.agentHash,
        caseId: "case-001",
        sample: 0,
        status: "running",
        artifactIds: [],
        traceIds: [],
        createdAt: "2026-06-16T00:00:00.000Z",
        startedAt: "2026-06-16T00:00:02.000Z",
      },
    ];

    const snapshot = createWorkbenchRunSnapshot(evalOperationRequest({
      versionId: "v_live",
      evalHash: "eval_hash",
      skill: "current",
      agent: "default",
      samples: 1,
    }), [run], {
      jobs,
      now: "2026-06-16T00:00:12.000Z",
    });

    expect(snapshot.progress.elapsedMs).toBe(12_000);
    expect(snapshot.report.elapsedMs).toBe(10_000);
    expect(snapshot.measurements[0]?.report?.elapsedMs).toBe(10_000);
  });

  test("terminal failed and canceled run snapshots do not point back to themselves", () => {
    const base: WorkbenchRun = {
      id: "run_terminal",
      kind: "eval",
      versionId: "v001",
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "failed",
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-16T00:00:00.000Z",
      finishedAt: "2026-06-16T00:00:01.000Z",
    };

    const request = evalOperationRequest({
      versionId: "v001",
      evalHash: "eval_hash",
      skill: "current",
      agent: "default",
    });
    const failed = createWorkbenchRunSnapshot(request, [base]);
    const canceled = createWorkbenchRunSnapshot(request, [{ ...base, status: "canceled" }]);

    expect(failed).not.toHaveProperty("next");
    expect(canceled).not.toHaveProperty("next");
  });

  test("terminal eval run snapshots preserve non-default compare selectors", () => {
    const run: WorkbenchRun = {
      id: "run_strict",
      kind: "eval",
      versionId: "v001",
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "strict",
      agentHash: "agent_hash",
      status: "succeeded",
      score: 1,
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-16T00:00:00.000Z",
      finishedAt: "2026-06-16T00:00:01.000Z",
    };

    const snapshot = createWorkbenchRunSnapshot(evalOperationRequest({
      versionId: "v001",
      evalHash: "eval_hash",
      skill: "current",
      agent: "strict",
    }), [run]);

    expect(snapshot.next).toBe("workbench eval results --agents strict");
  });

  test("terminal run snapshots preserve selected case context for grade", () => {
    const run: WorkbenchRun = {
      id: "run_investor_focus",
      kind: "run",
      versionId: "v001",
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "succeeded",
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-21T00:00:00.000Z",
      finishedAt: "2026-06-21T00:00:01.000Z",
    };

    const snapshot = createWorkbenchRunSnapshot(evalOperationRequest({
      versionId: "v001",
      evalHash: "eval_hash",
      caseIds: ["investor-focus"],
      steps: ["run"],
    }), [run]);

    expect(snapshot.next).toBe("workbench eval grade --cases investor-focus");
  });

  test("local web operation defaults keep CLI current-source semantics", () => {
    const snapshot = actionCapabilitySnapshot();
    const local = createWorkbenchActionCapabilities(snapshot, {
      variant: "local",
      evidenceAccess: "full",
    });
    const cloud = createWorkbenchActionCapabilities(snapshot, {
      variant: "cloud",
      evidenceAccess: "full",
    });

    expect(local.run.enabled).toBe(true);
    expect(local.grade.enabled).toBe(true);
    expect(local.eval.defaultRequest).not.toHaveProperty("versionId");
    expect(local.run.defaultRequest).not.toHaveProperty("versionId");
    expect(local.grade.defaultRequest).not.toHaveProperty("versionId");
    expect(local.improve.defaultRequest).not.toHaveProperty("versionId");
    expect(local.eval.defaultRequest.kind === "eval" ? local.eval.defaultRequest.targets[0] : undefined).not.toHaveProperty("skill");
    expect(local.eval.defaultRequest.kind === "eval" ? local.eval.defaultRequest.targets[0] : undefined).not.toHaveProperty("agent");
    expect(cloud.run.enabled).toBe(true);
    expect(cloud.grade.enabled).toBe(true);
    expect(cloud.run.defaultRequest.kind === "eval" ? cloud.run.defaultRequest.targets[0]?.versionId : undefined).toBe("v_current");
    expect(cloud.grade.defaultRequest.kind === "eval" ? cloud.grade.defaultRequest.targets[0]?.versionId : undefined).toBe("v_current");
    expect(cloud.eval.defaultRequest.kind === "eval" ? cloud.eval.defaultRequest.targets[0]?.versionId : undefined).toBe("v_current");
    expect(cloud.eval.defaultRequest.kind === "eval" ? cloud.eval.defaultRequest.targets[0] : undefined).not.toHaveProperty("skill");
    expect(cloud.eval.defaultRequest.kind === "eval" ? cloud.eval.defaultRequest.targets[0] : undefined).not.toHaveProperty("agent");
    expect(cloud.improve.defaultRequest.versionId).toBe("v_current");
    expect(local.improve.enabled).toBe(false);
    expect(local.improve.disabledReason).toMatch(/needs graded below-perfect/u);

    const evidence = createWorkbenchActionCapabilities({
      ...snapshot,
      runs: [failedEvalRun("run_failed", "eval_hash")],
    }, {
      variant: "local",
      evidenceAccess: "full",
    });
    expect(evidence.improve.enabled).toBe(true);
    expect(evidence.improve).not.toHaveProperty("disabledReason");

    delete snapshot.status.defaultAgent;
    expect(createWorkbenchActionCapabilities(snapshot, { variant: "cloud", evidenceAccess: "full" }).eval).toMatchObject({ enabled: false, disabledReason: expect.stringMatching(/ready for review.*authored Skill/u) });
  });

  test("locked Eval actions use only that Eval's cases and improvement evidence", () => {
    const snapshot = actionCapabilitySnapshot();
    const current = snapshot.evals[0]!;
    const historical = {
      ...current,
      hash: "eval_old",
      cases: [{ id: "old-case", path: "cases/old-case/case.yaml", grade: testGradePlan(), files: [] }],
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
    };
    snapshot.evals = [historical, current];
    snapshot.evalVersions = [{ ...snapshot.evalVersions[0]!, id: "eval-v1", hash: historical.hash, current: false }];
    snapshot.runs = [failedEvalRun("run_latest_failed", current.hash)];

    const scoped = createWorkbenchActionCapabilities(snapshot, {
      variant: "cloud", evidenceAccess: "full", evalRef: "eval-v1",
    });
    for (const capability of [scoped.run, scoped.grade, scoped.eval]) {
      expect(capability.defaultRequest).toMatchObject({ evalHash: "eval_old", caseIds: ["old-case"] });
    }
    expect(scoped.improve.defaultRequest).toMatchObject({ evalHash: "eval_old" });
    expect(scoped.improve.enabled).toBe(false);

    snapshot.runs.push(failedEvalRun("run_old_failed", "eval_old"));
    expect(createWorkbenchActionCapabilities(snapshot, {
      variant: "cloud", evidenceAccess: "full", evalRef: "eval_old",
    }).improve.enabled).toBe(true);
  });

  test("terminal prerequisite jobs satisfy queued dependents without re-execution", async () => {
    const skillRevision = succeededJob(testJob("skill-revision"));
    const runner = testJob("runner", ["skill-revision"]);
    const started: string[] = [];

    const result = await runWorkbenchExecutionDag({
      jobs: [skillRevision, runner],
      sandboxBackend: DOCKER_SANDBOX_BACKEND,
      capacity: { cpu: 1, memoryGb: 1, diskGb: 1 },
      executeJob: async (job) => {
        started.push(job.id);
        return succeededJob(job);
      },
    });

    expect(started).toEqual(["runner"]);
    expect(result.jobs.map((job) => job.status)).toEqual(["succeeded", "succeeded"]);
  });
});

describe("workbench execution graph compilation", () => {
  test("compiles an eval attempt execution from the engine case", () => {
    const graph = compileWorkbenchExecutionGraph(graphInput({ workflow: "eval" }));

    expect(graph.nodes).toHaveLength(1);
    expect(graph.executions).toHaveLength(1);
    const execution = graph.executions[0]!;
    expect(execution.purpose).toBe("attempt");
    expect(execution.id).toContain("case_case_001");
    expect(execution.adapter).toMatchObject({ use: "command" });
    expect(execution.inputs.map((input) => input.name)).toEqual(["skills", "case"]);
    expect(execution.sandbox).toMatchObject({
      kind: "oci",
      ref: "dockerfile://environment/Dockerfile",
    });
    expect(execution.policy).toMatchObject({
      tenantId: "user",
      resources: { cpu: 2, memoryGb: 4, diskGb: 10, timeoutMinutes: 20 },
      network: { egress: "open" },
    });
    expect(graph.nodes[0]?.dependsOn).toEqual([]);
  });

  test("compiles an improve execution with skill and trace inputs", () => {
    const graph = compileWorkbenchExecutionGraph(graphInput({ workflow: "improve" }));

    expect(graph.executions).toHaveLength(1);
    const execution = graph.executions[0]!;
    expect(execution.purpose).toBe("improve");
    expect(execution.adapter).toMatchObject({ use: "improver" });
    expect(execution.inputs.map((input) => input.name)).toEqual(["skill", "traces"]);
    expect(execution.inputs[0]).toMatchObject({ writable: true });
    expect(execution.outputs).toEqual([
      { name: "skill_patch", schema: "workbench.skill_patch.v1", required: true },
    ]);
    expect(execution.metadata).toMatchObject({ edits: ["SKILL.md"] });
  });

  test("rejects compilation without an engine case or improve config", () => {
    expect(() => compileWorkbenchExecutionGraph(graphInput({
      workflow: "eval",
      engineCase: undefined,
    }))).toThrow("requires an engine case");

    const withoutImprove = graphInput({ workflow: "improve" });
    delete withoutImprove.spec.improve;
    delete withoutImprove.spec.skill.improve;
    expect(() => compileWorkbenchExecutionGraph(withoutImprove))
      .toThrow("Skill improve configuration is required");
  });
});

describe("applyWorkbenchSkillPatch", () => {
  const baseFiles = [
    { path: "SKILL.md", content: "v1\n" },
    { path: "reference/usage.md", content: "usage\n" },
  ];

  test("applies in-scope patch files and appends added paths", () => {
    const files = applyWorkbenchSkillPatch({
      baseFiles,
      patch: {
        files: [
          { path: "SKILL.md", content: "v2\n" },
          { path: "reference/extra.md", content: "extra\n" },
        ],
        fileChanges: ["SKILL.md", "reference/extra.md"],
      },
      edits: ["SKILL.md", "reference"],
    });

    expect(files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "reference/usage.md",
      "reference/extra.md",
    ]);
    expect(files[0]?.content).toBe("v2\n");
  });

  test("allows package-root edits while rejecting Workbench control files", () => {
    const files = applyWorkbenchSkillPatch({
      baseFiles,
      patch: {
        files: [
          { path: "reference/usage.md", content: "improved usage\n" },
          { path: "scripts/helper.sh", content: "echo improved\n" },
        ],
        fileChanges: ["reference/usage.md", "scripts/helper.sh"],
      },
      edits: ["."],
    });

    expect(files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "reference/usage.md",
      "scripts/helper.sh",
    ]);
    expect(files.find((file) => file.path === "reference/usage.md")?.content).toBe("improved usage\n");
    expect(() => applyWorkbenchSkillPatch({
      baseFiles,
      patch: {
        files: [{ path: ".workbench/eval.yaml", content: "grade:\n  adapter: tests\n" }],
        fileChanges: [".workbench/eval.yaml"],
      },
      edits: ["."],
    })).toThrow(/Workbench control path/u);
  });

  test("rejects unsafe traversal paths", () => {
    expect(() => applyWorkbenchSkillPatch({
      baseFiles,
      patch: {
        files: [{ path: "../escape.md", content: "x\n" }],
        fileChanges: ["../escape.md"],
      },
      edits: ["SKILL.md"],
    })).toThrow(/unsafe path/u);
  });

  test("rejects patch paths outside declared improve edits", () => {
    expect(() => applyWorkbenchSkillPatch({
      baseFiles,
      patch: {
        files: [{ path: "secrets/token.txt", content: "x\n" }],
        fileChanges: ["secrets/token.txt"],
      },
      edits: ["SKILL.md"],
    })).toThrow(/outside improve edits/u);
  });
});

describe("composeRuntimeDockerfileWithAdapterInstallers", () => {
  test("returns the dockerfile unchanged without installable adapters", () => {
    const dockerfile = "FROM node:24\nUSER app\n";
    expect(composeRuntimeDockerfileWithAdapterInstallers(dockerfile, [])).toBe(dockerfile);
    expect(composeRuntimeDockerfileWithAdapterInstallers(dockerfile, [{
      id: "noop",
      source: "builtin",
      install: [],
    }])).toBe(dockerfile);
  });

  test("appends adapter install commands and restores the final user", () => {
    const composed = composeRuntimeDockerfileWithAdapterInstallers(
      "FROM node:24\nUSER app\n",
      [{
        id: "codex",
        source: "npm:workbench-adapter-codex",
        install: ["npm install --global workbench-adapter-codex"],
      }],
    );

    const lines = composed.split("\n");
    expect(lines).toContain("USER root");
    expect(lines).toContain("# Adapter: codex (npm:workbench-adapter-codex)");
    expect(lines).toContain("RUN npm install --global workbench-adapter-codex");
    expect(lines.indexOf("USER root")).toBeLessThan(lines.indexOf("RUN npm install --global workbench-adapter-codex"));
    expect(lines.indexOf("RUN npm install --global workbench-adapter-codex")).toBeLessThan(lines.lastIndexOf("USER app"));
    expect(lines[lines.length - 2]).toBe("WORKDIR /workspace");
  });
});

function graphInput(overrides: Partial<CompileExecutionGraphInput>): CompileExecutionGraphInput {
  return {
    ownerUserId: "user",
    projectId: "project",
    runId: "run_1",
    versionId: "v1",
    attemptIndex: 0,
    caseId: "case-001",
    engineCase: {
      version: 3,
      prompt: "Write ok.",
    },
    spec: genericSpec(),
    ...overrides,
  };
}

function genericSpec(): GenericRunSpec {
  return {
    version: 4,
    name: "demo",
    description: "demo eval",
    eval: {
      name: "demo",
      description: "demo eval",
      engine: { use: "tests" },
    },
    skill: {
      name: "current",
      files: { path: "skill" },
      agents: {
        default: { name: "Default", use: "command" },
      },
      improve: {
        edits: ["SKILL.md"],
      },
    },
    environment: { dockerfile: "environment/Dockerfile" },
    adapters: [],
    engine: { use: "tests" },
    engineResolve: { use: "tests" },
    improve: { use: "improver" },
    run: { use: "command" },
    gradeRun: { use: "tests" },
  };
}

function testJob(
  id: string,
  dependsOn: readonly string[] = [],
): WorkbenchExecutionJob {
  return {
    id,
    projectId: "eval",
    runId: "run",
    skillId: "skill",
    kind: "eval",
    status: "queued",
    attempt: 0,
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z",
    input: {
      dependsOn: [...dependsOn],
      execution: {
        id: `exec_${id}`,
        purpose: "attempt",
        policy: {
          resources: {
            cpu: 1,
            memoryGb: 1,
            diskGb: 1,
            timeoutMinutes: 1,
          },
        },
      },
    },
  } as unknown as WorkbenchExecutionJob;
}

function succeededJob(job: WorkbenchExecutionJob): WorkbenchExecutionJob {
  return {
    ...job,
    status: "succeeded",
    updatedAt: "2026-05-03T00:00:01.000Z",
    finishedAt: "2026-05-03T00:00:01.000Z",
  };
}

function failedJob(job: WorkbenchExecutionJob, error: string): WorkbenchExecutionJob {
  return {
    ...job,
    status: "failed",
    updatedAt: "2026-05-03T00:00:01.000Z",
    finishedAt: "2026-05-03T00:00:01.000Z",
    error,
  };
}

function retrySnapshot(args: {
  run: WorkbenchRun;
  jobs: WorkbenchJob[];
}): WorkbenchInspectionSnapshot {
  return {
    root: "/tmp/workbench-retry-test",
    status: {
      root: "/tmp/workbench-retry-test",
      initialized: true,
      runCount: 1,
    },
    versions: [
      {
        id: "v_base",
        hash: "hash_base",
        message: "base",
        parentIds: [],
        createdAt: "2026-06-15T00:00:00.000Z",
        files: [],
      },
      {
        id: "v_candidate",
        hash: "hash_candidate",
        message: "candidate",
        parentIds: ["v_base"],
        createdAt: "2026-06-15T00:00:01.000Z",
        files: [],
      },
    ],
    skillSources: [],
    skillBundles: [],
    evals: [],
    agents: [],
    runs: [args.run],
    jobs: args.jobs,
    traces: [],
    executionEvents: [],
    artifacts: [],
    lineage: [],
    remotes: [],
    refs: { current: "v_base" },
  };
}

function actionCapabilitySnapshot(): WorkbenchInspectionSnapshot {
  return {
    root: "/tmp/workbench-action-capability-test",
    status: {
      root: "/tmp/workbench-action-capability-test",
      initialized: true,
      defaultSkill: "current",
      defaultAgent: "default",
      currentVersionId: "v_current",
      runCount: 0,
    },
    versions: [{
      id: "v_current",
      hash: "hash_current",
      message: "package snapshot",
      parentIds: [],
      createdAt: "2026-06-15T00:00:00.000Z",
      files: [],
    }],
    skillSources: [],
    skillBundles: [],
    evals: [{
      hash: "eval_hash",
      files: [{ path: "environment/Dockerfile", content: "FROM node:22\n" }],
      grade: testGradePlan(),
      gradeAdapters: [{
        adapter: "tests",
        label: "Tests",
        authoring: testGradePlan().authoring,
      }],
      cases: [{ id: "current-case", path: "cases/current-case/case.yaml", grade: testGradePlan(), files: [] }],
      caseCount: 1,
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    }],
    evalVersions: [{
      id: "eval-v1", hash: "eval_hash", label: "Eval v1", ordinal: 1, current: true,
      caseCount: 1, gradeAdapter: "tests", createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z", runCount: 0,
    }],
    agents: [{ hash: "agent_hash", agent: { name: "default", adapter: "command", config: {} } }],
    runs: [],
    jobs: [],
    traces: [],
    executionEvents: [],
    artifacts: [],
    lineage: [],
    remotes: [],
    refs: { current: "v_current" },
  };
}

function testGradePlan(): WorkbenchInspectionSnapshot["evals"][number]["grade"] {
  return {
    adapter: "tests",
    adapterSource: "eval",
    label: "Tests",
    summary: "Case test harness",
    sources: [{ path: "eval.yaml", role: "global" }],
    display: [{ kind: "text", text: "No adapter-specific grading details are configured." }],
    authoring: [{
      kind: "file",
      name: "testScript",
      label: "Test script",
      path: "tests/test.sh",
      language: "shell",
      executable: true,
      required: true,
    }],
  };
}

function failedEvalRun(id: string, evalHash: string): WorkbenchRun {
  return { id, kind: "eval", versionId: "v_current", skillName: "current", skillBundleHash: "bundle_hash", evalHash,
    agentName: "default", agentHash: "agent_hash", status: "failed", jobIds: [], traceIds: [], createdAt: "2026-06-15T00:00:01.000Z" };
}

function retryJob(
  run: WorkbenchRun,
  id: string,
  caseId: string,
  sample: number,
  overrides: Partial<WorkbenchJob> & { score?: number } = {},
): WorkbenchJob {
  const { score, ...jobOverrides } = overrides;
  return {
    id,
    runId: run.id,
    kind: run.kind,
    versionId: run.versionId,
    skillName: run.skillName,
    skillBundleHash: run.skillBundleHash,
    evalHash: run.evalHash,
    agentName: run.agentName,
    agentHash: run.agentHash,
    caseId,
    sample,
    status: "failed",
    artifactIds: [],
    traceIds: [],
    createdAt: "2026-06-15T00:00:00.000Z",
    finishedAt: "2026-06-15T00:00:01.000Z",
    error: "failed",
    ...(score !== undefined ? {
      role: "grade",
      result: { items: [{ kind: "score", score, value: score }] },
    } : {}),
    ...jobOverrides,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
