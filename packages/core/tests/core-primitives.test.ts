import { describe, expect, test } from "vitest";

import {
  DOCKER_SANDBOX_BACKEND,
  applyWorkbenchSkillPatch,
  composeRuntimeDockerfileWithAdapterInstallers,
  createWorkbenchActionCapabilities,
  createWorkbenchRunSnapshot,
  resolveWorkbenchRunRetryPlan,
  runWorkbenchExecutionDag,
  type WorkbenchInspectionSnapshot,
  type WorkbenchJob,
  type WorkbenchRun,
  type RemoteWorkbenchJob,
} from "../src/index.ts";
import {
  compileWorkbenchExecutionGraph,
  type CompileExecutionGraphInput,
} from "../src/execution-graph.ts";
import type { GenericRunSpec } from "../src/generic-spec.ts";

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
    expect(result.jobs.map((job) => job.status)).toEqual(["failed", "cancelled"]);
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
    expect(result.jobs[0]?.status).toBe("cancelled");
  });

  test("builds retry plans from the stored operation plan", () => {
    const run: WorkbenchRun = {
      id: "run_improve",
      kind: "improve",
      versionId: "v_candidate",
      baseVersionId: "v_base",
      skillName: "primary",
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
        skills: ["primary"],
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

    expect(resolveWorkbenchRunRetryPlan(snapshot, run)).toEqual({
      kind: "improve",
      location: "local",
      baseVersionId: "v_base",
      skillName: "primary",
      agentName: "patcher",
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
      skillName: "primary",
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

    expect(() => resolveWorkbenchRunRetryPlan(retrySnapshot({ run, jobs: [] }), run))
      .toThrow(/does not record an operation plan/u);
  });

  test("rejects retry when stored operation plan samples are not an integer", () => {
    const run: WorkbenchRun = {
      id: "run_eval",
      kind: "eval",
      versionId: "v_base",
      skillName: "primary",
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
        skills: ["primary"],
        agents: ["default"],
        samples: 1.5,
      },
    };

    expect(() => resolveWorkbenchRunRetryPlan(retrySnapshot({ run, jobs: [] }), run))
      .toThrow(/invalid operationPlan.samples/u);
  });

  test("projects run snapshots with job-backed measurements", () => {
    const run: WorkbenchRun = {
      id: "run_matrix",
      kind: "eval",
      versionId: "v_matrix",
      skillName: "primary",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_default",
      status: "succeeded",
      score: 0.65,
      jobIds: ["job_default", "job_patcher"],
      traceIds: [],
      createdAt: "2026-06-16T00:00:00.000Z",
      finishedAt: "2026-06-16T00:00:02.000Z",
      operationPlan: {
        kind: "eval",
        variant: "local",
        versionId: "v_matrix",
        evalHash: "eval_hash",
        skills: ["primary"],
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

    const snapshot = createWorkbenchRunSnapshot({
      kind: "eval",
      variant: "local",
      versionId: "v_matrix",
      evalHash: "eval_hash",
      skill: "primary",
      agent: "default,patcher",
      samples: 1,
    }, [run], { jobs });

    expect(snapshot.measurements).toEqual([
      expect.objectContaining({
        runId: "run_matrix",
        agentName: "default",
        score: 0.4,
        samples: 1,
      }),
      expect.objectContaining({
        runId: "run_matrix",
        agentName: "patcher",
        score: 0.9,
        samples: 1,
      }),
    ]);
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

    expect(local.eval.defaultRequest).not.toHaveProperty("versionId");
    expect(local.improve.defaultRequest).not.toHaveProperty("versionId");
    expect(cloud.eval.defaultRequest.versionId).toBe("v_current");
    expect(cloud.improve.defaultRequest.versionId).toBe("v_current");
    expect(local.improve.enabled).toBe(false);
    expect(local.improve.disabledReason).toMatch(/needs scored below-perfect/u);

    const evidence = createWorkbenchActionCapabilities({
      ...snapshot,
      runs: [{
        id: "run_failed",
        kind: "eval",
        versionId: "v_current",
        skillName: "primary",
        skillBundleHash: "bundle_hash",
        evalHash: "eval_hash",
        agentName: "default",
        agentHash: "agent_hash",
        status: "failed",
        jobIds: [],
        traceIds: [],
        createdAt: "2026-06-15T00:00:01.000Z",
      }],
    }, {
      variant: "local",
      evidenceAccess: "full",
    });
    expect(evidence.improve.enabled).toBe(true);
    expect(evidence.improve).not.toHaveProperty("disabledReason");
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
    expect(execution.adapter).toMatchObject({ use: "tests" });
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
        files: [{ path: ".workbench/eval.yaml", content: "version: 1\n" }],
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
      name: "primary",
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
    engineRun: { use: "tests" },
  };
}

function testJob(
  id: string,
  dependsOn: readonly string[] = [],
): RemoteWorkbenchJob {
  return {
    id,
    projectId: "eval",
    runId: "run",
    skillId: "skill",
    kind: "execute",
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
  } as unknown as RemoteWorkbenchJob;
}

function succeededJob(job: RemoteWorkbenchJob): RemoteWorkbenchJob {
  return {
    ...job,
    status: "succeeded",
    updatedAt: "2026-05-03T00:00:01.000Z",
    finishedAt: "2026-05-03T00:00:01.000Z",
  };
}

function failedJob(job: RemoteWorkbenchJob, error: string): RemoteWorkbenchJob {
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
      versionCount: 2,
      skillCount: 1,
      agentCount: 1,
      runCount: 1,
      remoteCount: 0,
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
      defaultSkill: "primary",
      defaultAgent: "default",
      currentVersionId: "v_current",
      versionCount: 1,
      skillCount: 1,
      agentCount: 1,
      evalCount: 1,
      caseCount: 1,
      runCount: 0,
      remoteCount: 0,
    },
    versions: [{
      id: "v_current",
      hash: "hash_current",
      message: "source snapshot",
      parentIds: [],
      createdAt: "2026-06-15T00:00:00.000Z",
      files: [],
    }],
    skillSources: [],
    skillBundles: [],
    evals: [{
      hash: "eval_hash",
      files: [],
      cases: [],
      caseCount: 1,
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
      scoreAdapter: "tests",
    }],
    agents: [],
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

function retryJob(
  run: WorkbenchRun,
  id: string,
  caseId: string,
  sample: number,
  overrides: Partial<WorkbenchJob> = {},
): WorkbenchJob {
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
    ...overrides,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
