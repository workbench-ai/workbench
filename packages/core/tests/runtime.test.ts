import { describe, expect, test } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildCandidateLineage,
  buildWorkbenchProjectSourceFiles,
  createBaselineCandidateJob,
  createCaseReview,
  createOptimizerTraceInputFiles,
  createWorkbenchRunWorkload,
  createWorkbenchExecutionCapability,
  executeWorkbenchExecutionJob,
  executeRuntimeControlOperationSequenceInCurrentRuntime,
  expectedWorkbenchRunJobCount,
  extractExecutionUsageFromTrace,
  findEnvironmentVersionForImage,
  executionResultFromCompletedSandboxJob,
  filterOptimizerTraceJobsForCaseIds,
  materializeWorkbenchRunResult,
  normalizeDockerImageRef,
  normalizeSurfaceFiles,
  planWorkbenchExecutionJobsForPurpose,
  resolveWorkbenchResolvedSourceYaml,
  selectExecutionOutputFilesForInspection,
  sanitizeWorkbenchRuntimeCandidateForExchange,
  sanitizeWorkbenchRuntimeJobForExchange,
  stageWorkbenchRunWorkload,
  attemptJobCountForRunSpec,
  validateWorkbenchResolvedSourceYaml,
  workbenchRuntimeBundleFingerprint,
  workbenchRunExecutionFingerprint,
  workbenchTraceExecutionDirectory,
  workbenchTraceRunDirectory,
  workbenchTraceRunDirectoryName,
  workloadTimeoutMs,
  type CandidateRecord,
  type WorkbenchRunWorkload,
  type WorkbenchEngineCase,
  type HostedWorkbenchJob,
  type SandboxExecutionFileStore,
  type SandboxPlane,
  type SurfaceSnapshotFile,
} from "../src/index.ts";
import {
  createWorkbenchProgressStdoutParser,
  WORKBENCH_PROGRESS_STDOUT_PREFIX,
  type WorkbenchProgressStdoutEnvelope,
} from "../src/execution-events.ts";
import {
  createWorkbenchSandboxFileStore,
} from "../src/sandbox-inputs.ts";

describe("Workbench runtime generic execution", () => {
  test("runtime candidate exchange ignores local and cloud derived fields", () => {
    const candidate = {
      id: "candidate_1",
      version: 1,
      ordinal: 1,
      benchmarkFingerprint: "benchmark",
      candidateFingerprint: "candidate",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "evaluated",
      fileChanges: [],
      ownerUserId: "user_1",
      ownerUsername: "official",
      visibility: "private",
      metrics: { score: 1 },
      candidateRunId: "run",
      candidateRunName: "Default",
    } as CandidateRecord & {
      ownerUserId: string;
      ownerUsername: string;
      visibility: string;
      metrics: Record<string, number>;
      candidateRunId: string;
      candidateRunName: string;
    };

    expect(sanitizeWorkbenchRuntimeCandidateForExchange(candidate)).toEqual({
      id: "candidate_1",
      version: 1,
      ordinal: 1,
      benchmarkFingerprint: "benchmark",
      candidateFingerprint: "candidate",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "evaluated",
      fileChanges: [],
    });

    const baseBundle = {
      schema: "workbench.runtime.bundle.v1" as const,
      activeId: "candidate_1",
      candidates: [candidate],
      candidateFiles: [],
      evaluations: [],
      runs: [],
      jobs: [],
      executionFiles: [],
      events: [],
    };
    const strippedBundle = {
      ...baseBundle,
      candidates: [sanitizeWorkbenchRuntimeCandidateForExchange(candidate)],
    };
    expect(workbenchRuntimeBundleFingerprint(baseBundle)).toBe(
      workbenchRuntimeBundleFingerprint(strippedBundle),
    );

    const job = {
      id: "job_1",
      runId: "run_1",
      candidateId: "candidate_1",
      projectId: "wb_123456789abc",
      kind: "execution",
      status: "finished",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      output: {
        ok: true,
        files: [{ path: "trace.json", content: "{}", encoding: "utf8" }],
        fileSet: { files: [] },
      },
      trace: { trace_id: "job_1", spans: [], events: [], summaries: [] },
      traceSessions: [],
    } as HostedWorkbenchJob & { trace: unknown; traceSessions: unknown };
    expect(sanitizeWorkbenchRuntimeJobForExchange(job)).toEqual({
      id: "job_1",
      runId: "run_1",
      candidateId: "candidate_1",
      projectId: "wb_123456789abc",
      kind: "execution",
      status: "finished",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      output: {
        ok: true,
        files: [{ path: "trace.json", content: "{}", encoding: "utf8" }],
        fileSet: { files: [] },
      },
    });
  });

  test("run execution fingerprints include source and adapter files", () => {
    const base = workbenchRunExecutionFingerprint({
      sourceYaml: "version: 4\ncandidate:\n  selectedRunId: main\n",
      adapterFiles: [textSurfaceFile("adapters/run/index.js", "console.log('v1')\n")],
    });

    expect(workbenchRunExecutionFingerprint({
      sourceYaml: "version: 4\ncandidate:\n  selectedRunId: other\n",
      adapterFiles: [textSurfaceFile("adapters/run/index.js", "console.log('v1')\n")],
    })).not.toBe(base);
    expect(workbenchRunExecutionFingerprint({
      sourceYaml: "version: 4\ncandidate:\n  selectedRunId: main\n",
      adapterFiles: [textSurfaceFile("adapters/run/index.js", "console.log('v2')\n")],
    })).not.toBe(base);
  });

  test("candidate lineage ignores self references", () => {
    const lineage = buildCandidateLineage({
      activeId: "candidate_self",
      summaries: [{
        id: "candidate_self",
        version: 1,
        ordinal: 1,
        benchmarkFingerprint: "benchmark",
        candidateFingerprint: "candidate_self",
        createdAt: "2026-01-01T00:00:00.000Z",
        baseId: "candidate_self",
        referenceIds: ["candidate_self"],
        status: "evaluated",
        fileChanges: [],
      }],
    });

    expect(lineage.edges).toEqual([]);
  });

  test("candidate lineage only links explicit improve bases", () => {
    const lineage = buildCandidateLineage({
      activeId: "candidate_child",
      summaries: [
        {
          id: "candidate_base",
          version: 1,
          ordinal: 1,
          benchmarkFingerprint: "benchmark",
          candidateFingerprint: "candidate_base",
          createdAt: "2026-01-01T00:00:00.000Z",
          referenceIds: [],
          status: "evaluated",
          fileChanges: [],
        },
        {
          id: "candidate_reference_only",
          version: 2,
          ordinal: 2,
          benchmarkFingerprint: "benchmark",
          candidateFingerprint: "candidate_reference_only",
          createdAt: "2026-01-01T00:01:00.000Z",
          referenceIds: ["candidate_base"],
          status: "evaluated",
          fileChanges: [],
        },
        {
          id: "candidate_child",
          version: 3,
          ordinal: 3,
          benchmarkFingerprint: "benchmark",
          candidateFingerprint: "candidate_child",
          createdAt: "2026-01-01T00:02:00.000Z",
          baseId: "candidate_base",
          referenceIds: ["candidate_reference_only"],
          status: "evaluated",
          fileChanges: [],
        },
      ],
    });

    expect(lineage.edges).toEqual([{
      id: "anchor:candidate_base:candidate_child",
      kind: "anchor",
      sourceId: "candidate_base",
      targetId: "candidate_child",
    }]);
  });

  test("validates only the split benchmark/candidate/improver authoring contract", () => {
    const validation = validateWorkbenchResolvedSourceYaml(runtimeSpec());

    expect(validation.ok).toBe(true);
    expect(resolveWorkbenchResolvedSourceYaml(runtimeSpec()).description).toBe("Exercise the generic command runner and engine runtime path.");
    expect(resolveWorkbenchResolvedSourceYaml(runtimeSpec()).run.with).toMatchObject({
      command: expect.stringContaining("runner-output.json"),
    });
    expect(validateWorkbenchResolvedSourceYaml(runtimeSpec().replace("version: 4", "version: 30")).ok).toBe(false);
    expect(validateWorkbenchResolvedSourceYaml(runtimeSpec().replace("  description: Exercise the generic command runner and engine runtime path.\n", "")).errors).toContain("benchmark.yaml.description must be a non-empty string.");
  });

  test("normalizes docker image refs and resolves workload timeouts from the runtime environment", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());

    expect(normalizeDockerImageRef("workbench/workbench-node-22:envv_node_22")).toBe("docker://workbench/workbench-node-22:envv_node_22");
    expect(findEnvironmentVersionForImage("docker://workbench/workbench-node-22:envv_node_22", [{
      id: "envv_node_22",
      environmentId: "env_node",
      imageRef: "docker://workbench/workbench-node-22:envv_node_22",
      digest: null,
      spec: {
        network: "off",
        resources: { timeoutMinutes: 7 },
      },
      status: "ready",
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
    }])?.id).toBe("envv_node_22");
    expect(workloadTimeoutMs(spec)).toBe(5 * 60 * 1000);
  });

  test("plans attempt sandboxes from case-specific runtime environments", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const engineCases = [engineCase("case-001", "Score the candidate.")];
    engineCases[0]!.case.environment = {
      dockerfile: "cases/case-001/Dockerfile",
      resources: {
        cpu: 3,
        memoryGb: 2,
        diskGb: 6,
        timeoutMinutes: 11,
      },
      network: { egress: "open" },
    };

    const [job] = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_case_environment",
      candidateId: "candidate_runtime_001",
      attemptIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "attempt",
      caseIds: ["case-001"],
      engineCases,
      environmentRef: "docker://workbench-local/source-runtime:latest",
      environmentRefsByCase: new Map([[
        "case-001",
        "docker://workbench-local/case-001-runtime:latest",
      ]]),
      now,
    });

    const execution = executionFromJob(job!);
    expect(execution.sandbox.ref).toBe("docker://workbench-local/case-001-runtime:latest");
    expect(execution.policy.resources).toMatchObject({
      cpu: 3,
      memoryGb: 2,
      diskGb: 6,
      timeoutMinutes: 11,
    });
    expect(execution.policy.network).toEqual({ egress: "open" });
  });

  test("stages only the execution-specific runtime input roots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-stage-"));
    try {
      await fs.mkdir(path.join(root, "private", "engine"), { recursive: true });
      await fs.writeFile(path.join(root, "private", "engine", "stale.txt"), "stale\n");

      await stageWorkbenchRunWorkload(root, stageWorkload("improve"));
      await expect(fs.access(path.join(root, "input", "candidate", "prompt.md"))).rejects.toBeTruthy();
      await expect(fs.access(path.join(root, "input", "traces", "index.json"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(root, "prompt.md"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(root, "input", "case", "task.yaml"))).rejects.toBeTruthy();
      await expect(fs.access(path.join(root, "private", "engine", "stale.txt"))).rejects.toBeTruthy();

      await stageWorkbenchRunWorkload(root, stageWorkload("attempt"));
      await expect(fs.access(path.join(root, "input", "candidate", "prompt.md"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(root, "input", "case", "request.md"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(root, "prompt.md"))).rejects.toBeTruthy();
      await expect(fs.access(path.join(root, "request.md"))).rejects.toBeTruthy();
      await expect(fs.access(path.join(root, "private", "engine", "secret.txt"))).rejects.toBeTruthy();
      await expect(fs.access(path.join(root, "input", "traces"))).rejects.toBeTruthy();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("projects visibility-based case files before sandbox materialization", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const engineCases = [engineCase(
      "case-001",
      "test",
      [{ path: "request.md", content: "public\n" }],
      [{ path: "secret.txt", content: "hidden\n" }],
    )];
    const engineResolveFiles = engineCases[0]!.files.public ?? [];
    const common = {
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      candidateId: "candidate_runtime_001",
      attemptIndex: 0,
      samples: 1,
      spec,
      workflow: "eval" as const,
      caseIds: engineCases.map((bundle) => bundle.id),
      engineCases,
      now,
    };
    const [attemptJob] = planWorkbenchExecutionJobsForPurpose({ ...common, purpose: "attempt" });

    const attemptInputs = await createWorkbenchSandboxFileStore({
      job: attemptJob!,
      spec,
      baseFiles: [],
      engineResolveFiles,
      engineCases,
    }).materializeInputs(executionFromJob(attemptJob!));
    expect(attemptInputs.find((input) => input.input.name === "case")?.files.map((file) => file.path)).toEqual([
      "request.md",
    ]);
    expect(attemptInputs.find((input) => input.input.name === "case")?.files.map((file) => file.path))
      .not.toContain("secret.txt");
  });

  test("creates hosted workloads from resolved engine-resolve files", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const engineCases = [engineCase(
      "case-001",
      "test",
      [{ path: "request.md", content: "public\n" }],
      [{ path: "secret.txt", content: "hidden\n" }],
    )];
    const engineResolveFiles = engineCases[0]!.files.public ?? [];
    const [runJob] = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      candidateId: "candidate_runtime_001",
      attemptIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "attempt",
      caseIds: engineCases.map((bundle) => bundle.id),
      engineCases,
      now,
    });

    const workload = createWorkbenchRunWorkload({
      job: runJob!,
      spec,
      baseFiles: [],
      engineResolveFiles,
      engineCases,
    });

    expect(workload.engineResolveFiles.map((file) => file.path)).toEqual([
      "request.md",
    ]);
    expect(workload.engineCaseSpec?.prompt).toBe("test");
  });

  test("selects only visible attempt output files for inspection", () => {
    const files = normalizeSurfaceFiles([
      { path: "runner-summary.md", content: "summary" },
      { path: "outputs/result.json", content: "{}" },
      { path: "workbench-result.json", content: "{}" },
      { path: ".workbench/traces/job/output.xlsx", encoding: "base64", content: "AA==" },
    ]);

    expect(selectExecutionOutputFilesForInspection({
      purpose: "attempt",
      files,
    }).map((file) => file.path)).toEqual([
      "outputs/result.json",
      "runner-summary.md",
    ]);
  });

  test("builds synced project source files with candidate and engine-resolve prefixes", () => {
    const files = buildWorkbenchProjectSourceFiles({
      specSource: "version: 4\nbenchmark:\n  version: 4\n  name: source-projection\n",
      candidateFilesPath: "candidates/app/files",
      candidateFiles: normalizeSurfaceFiles([
        { path: "prompt.md", content: "candidate\n" },
        { path: "candidates/app/files/already-prefixed.md", content: "already\n" },
      ]),
      engineResolveFilesPath: "tasks",
      engineResolveFiles: normalizeSurfaceFiles([
        { path: "case-001/task.yaml", content: "version: 3\ntask: Test\n" },
      ]),
      dockerfilePath: "environment/Dockerfile",
      dockerfile: "FROM node:22\n",
    });

    expect(files.map((file) => file.path)).toEqual([
      "benchmark.yaml",
      "candidates/app/files/already-prefixed.md",
      "candidates/app/files/prompt.md",
      "environment/Dockerfile",
      "tasks/case-001/task.yaml",
    ]);
  });

  test("builds optimizer trace inputs from generic adapter executions", () => {
    const now = "2026-04-27T00:00:00.000Z";
    const job = runningJob({
      id: "job_exec_run_attempt_000_case_case_001_sample_000_run",
      projectId: "project_runtime",
      runId: "run_trace_history",
      candidateId: "candidate_trace_001",
      kind: "execute",
      status: "queued",
      attempt: 0,
      createdAt: now,
      updatedAt: now,
      input: {
        execution: {
          id: "exec_trace_run",
          projectId: "project_runtime",
          runId: "run_trace_history",
          candidateId: "candidate_trace_001",
          purpose: "attempt",
          adapter: { use: "command", with: { command: "true" } },
          sandbox: { kind: "snapshot", ref: "workbench/test" },
          inputs: [],
          outputs: [],
          policy: { resources: { cpu: 1, memoryGb: 1, diskGb: 1, timeoutMinutes: 1 }, network: { egress: "none" } },
          metadata: {},
        },
        attemptIndex: 0,
        sampleIndex: 0,
        caseId: "case-001",
      },
    } as HostedWorkbenchJob, now);
    const completed = {
      ...job,
      status: "succeeded" as const,
      finishedAt: now,
      output: {
        ok: true,
        purpose: "attempt",
        candidateId: "candidate_trace_001",
        attemptIndex: 0,
        sampleIndex: 0,
        caseId: "case-001",
        files: normalizeSurfaceFiles([
          { path: "runner-summary.md", content: "done\n" },
          { path: `.workbench/traces/${job.id}/engine/request.json`, content: "{\"operation\":\"engine.run\"}\n" },
          { path: `.workbench/traces/${job.id}/engine/result.json`, content: "{\"protocol\":\"workbench.adapter-result.v1\",\"operation\":\"engine.run\",\"ok\":true,\"value\":{\"score\":1}}\n" },
          { path: `.workbench/traces/${job.id}/runner/session/events.ndjson`, content: "{\"event\":\"done\"}\n" },
        ]),
        traces: [`.workbench/traces/${job.id}/runner/session/events.ndjson`],
      },
    } as HostedWorkbenchJob;
    const files = createOptimizerTraceInputFiles({
      jobs: [completed],
    });

    expect(files.map((file) => file.path).sort()).toEqual([
      "executions/000001/files/.workbench/traces/job_exec_run_attempt_000_case_case_001_sample_000_run/engine/request.json",
      "executions/000001/files/.workbench/traces/job_exec_run_attempt_000_case_case_001_sample_000_run/engine/result.json",
      "executions/000001/files/.workbench/traces/job_exec_run_attempt_000_case_case_001_sample_000_run/runner/session/events.ndjson",
      "executions/000001/files/runner-summary.md",
      "executions/000001/request.json",
      "executions/000001/result.json",
      "index.json",
    ]);
    expect(files.find((file) => file.path === "index.json")?.content).toContain("workbench.optimizer-traces.v1");
    expect(files.find((file) => file.path === "executions/000001/request.json")?.content).toContain("\"operation\":\"engine.run\"");
    expect(files.find((file) => file.path === "executions/000001/result.json")?.content).toContain("\"score\":1");
  });

  test("optimizer trace input includes every supplied terminal attempt and excludes non-attempt materialization", () => {
    const attemptJob = {
      id: "job_attempt",
      kind: "execute",
      status: "succeeded",
      runId: "run_trace",
      candidateId: "candidate_trace_001",
      input: {
        execution: {
          purpose: "attempt",
        },
        candidateId: "candidate_trace_001",
        attemptIndex: 0,
        sampleIndex: 0,
        caseId: "case-001",
      },
      output: {
        ok: true,
        result: { score: 1 },
        files: normalizeSurfaceFiles([
          { path: `.workbench/traces/job_attempt/engine/request.json`, content: "{\"operation\":\"engine.run\"}\n" },
          { path: `.workbench/traces/job_attempt/engine/result.json`, content: "{\"protocol\":\"workbench.adapter-result.v1\",\"operation\":\"engine.run\",\"ok\":true,\"value\":{\"score\":1}}\n" },
        ]),
      },
    } as HostedWorkbenchJob;
    const baselineJob = {
      ...attemptJob,
      id: "job_baseline",
      candidateId: "candidate_trace_001",
      input: {
        execution: {
          purpose: "improve",
        },
        candidateId: "candidate_trace_001",
        attemptIndex: 0,
        baseline: true,
      },
    } as HostedWorkbenchJob;
    const generatedCandidateJob = {
      ...attemptJob,
      id: "job_generated_candidate",
      candidateId: "candidate_trace_002",
      input: {
        execution: {
          purpose: "attempt",
        },
        candidateId: "candidate_trace_002",
        attemptIndex: 0,
      },
    } as HostedWorkbenchJob;

    const files = createOptimizerTraceInputFiles({
      jobs: [baselineJob, generatedCandidateJob, attemptJob],
    });
    const index = JSON.parse(files.find((file) => file.path === "index.json")?.content ?? "{}");

    expect(index.executions).toHaveLength(2);
    expect(index.executions).toEqual(expect.arrayContaining([
      expect.objectContaining({
      jobId: "job_attempt",
      operation: "engine.run",
      candidateId: "candidate_trace_001",
      }),
      expect.objectContaining({
        jobId: "job_generated_candidate",
        operation: "engine.run",
        candidateId: "candidate_trace_002",
      }),
    ]));
  });

  test("formats chronological run trace directories with typed execution subdirectories", () => {
    expect(workbenchTraceRunDirectoryName({
      sequence: 7,
      runId: "run trace/history",
    })).toBe("000007-run_trace_history");
    expect(workbenchTraceRunDirectory({
      sequence: 7,
      runId: "run trace/history",
    })).toBe(".workbench/traces/000007-run_trace_history");
    expect(workbenchTraceExecutionDirectory({
      sequence: 7,
      runId: "run trace/history",
      purpose: "attempt",
    })).toBe(".workbench/traces/000007-run_trace_history/000002-attempt");
  });

  test("extracts execution usage from agent token usage events", () => {
    const usage = extractExecutionUsageFromTrace({}, {
      use: "codex",
      model: "gpt-5.4-mini",
    }, "openai/codex", [{
      name: "thread/tokenUsage/updated",
      payload: {
        tokenUsage: {
          total: {
            totalTokens: 1_000,
            inputTokens: 700,
            cachedInputTokens: 300,
            outputTokens: 300,
          },
        },
      },
    }]);

    expect(usage).toMatchObject({
      total: {
        provider: "openai/codex",
        model: "gpt-5.4-mini",
        totalTokens: 1_000,
        costUsd: 0.001673,
        costSource: "estimated",
      },
    });
  });

  test("extracts execution usage from trace usage spans when live persistence returns no events", () => {
    const usage = extractExecutionUsageFromTrace({
      spans: [{
        kind: "usage",
        started_at: "2026-04-30T00:00:00.000Z",
        attributes: {
          total_tokens: 1_000,
          input_tokens: 700,
          cached_input_tokens: 300,
          output_tokens: 300,
        },
      }],
      events: [],
      summaries: [],
    }, {
      use: "codex",
      model: "gpt-5.4-mini",
    }, "openai/codex", []);

    expect(usage?.total?.costUsd).toBe(0.001673);
  });

  test("infers total tokens without double-counting cached input details", () => {
    const usage = extractExecutionUsageFromTrace({
      spans: [{
        kind: "usage",
        started_at: "2026-04-30T00:00:00.000Z",
        attributes: {
          input_tokens: 700,
          cached_input_tokens: 300,
          output_tokens: 300,
        },
      }],
      events: [],
      summaries: [],
    }, {
      use: "codex",
      model: "gpt-5.4-mini",
    }, "openai/codex", []);

    expect(usage?.total?.totalTokens).toBe(1_000);
    expect(usage?.total?.costUsd).toBe(0.001673);
  });

  test("preserves Claude provider cost and cache token breakdown from trace usage spans", () => {
    const usage = extractExecutionUsageFromTrace({
      spans: [{
        kind: "usage",
        started_at: "2026-04-30T00:00:00.000Z",
        attributes: {
          total_cost_usd: 0.47041375,
          uncached_input_tokens: 73,
          total_tokens: 1_750_686,
          output_tokens: 35_945,
          cache_creation_input_tokens: 102_993,
          input_tokens: 73,
          cache_read_input_tokens: 1_611_675,
          cached_input_tokens: 1_714_668,
          cost_source: "provider",
        },
      }],
      events: [],
      summaries: [],
    }, {
      use: "claude",
      model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    }, "anthropic/claude-code", []);

    expect(usage?.total).toMatchObject({
      provider: "anthropic/claude-code",
      model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      costUsd: 0.47041375,
      costSource: "provider",
      uncachedInputTokens: 73,
      cacheCreationInputTokens: 102_993,
      cacheReadInputTokens: 1_611_675,
      cachedInputTokens: 1_714_668,
      totalTokens: 1_750_686,
    });
  });

  test("executes a generic attempt through the sandbox backend and materializes the run", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "candidate_runtime_001";
    const baseFiles = normalizeSurfaceFiles([{
      path: "prompt.md",
      content: "base candidate\n",
    }]);
    const engineCases = [engineCase("case-001", "Score the candidate.")];
    const engineResolveFiles = engineCases[0]!.files.public ?? [];
    const candidateRevision = createBaselineCandidateJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      candidateId,
      files: baseFiles,
      now,
      baseId: null,
      attemptIndex: 0,
    });
    const attemptJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      candidateId,
      attemptIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "attempt",
      caseIds: engineCases.map((bundle) => bundle.id),
      engineCases,
      now,
    });
    expect(attemptJobs).toHaveLength(1);
    expect(attemptJobs.map((job) => job.kind)).toEqual(["execute"]);

    const commandManifest = await commandAdapterManifest();
    const runningRunner = runningJob(attemptJobs[0]!, now);
    const runnerExecution = executionFromJob(runningRunner);
    const progress = await tryCreateProgressCaptureServer();
    let completedRunner: HostedWorkbenchJob | null = null;
    try {
      completedRunner = await executeWorkbenchAttemptWithRuntimeControl({
        job: runningRunner,
        spec,
        adapterManifests: [workbenchEngineManifest(), commandManifest],
        baseFiles,
        engineResolveFiles,
        engineCases,
        progress: progress ? {
          url: progress.url,
          token: "progress-token",
          ownerUserId: "user_runtime",
          flushWindowMs: 0,
        } : undefined,
      });
      if (progress) {
        expect(progress.requests.map((request) => request.progressToken)).toEqual([
          "progress-token",
          "progress-token",
        ]);
        expect(progress.requests.flatMap((request) => request.batch.events).map((event) => ({
          source: event.source,
          role: event.role,
          schema: event.schema,
          payload: event.payload,
        }))).toEqual([
          {
            source: "command",
            role: "engine",
            schema: "workbench.execution.step.v1",
            payload: { step: "engine", status: "started" },
          },
          {
            source: "command",
            role: "engine",
            schema: "workbench.execution.step.v1",
            payload: { step: "engine", status: "succeeded" },
          },
        ]);
      }
    } finally {
      await progress?.close();
    }
    expect(completedRunner?.error).toBeUndefined();
    expect(completedRunner?.status).toBe("succeeded");

    const progressEnvelope = (seq: number): WorkbenchProgressStdoutEnvelope => ({
      url: progress?.url ?? "http://127.0.0.1:9/progress",
      body: {
        type: "workbench.job.progress",
        progressToken: "progress-token",
        batch: {
          projectId: "project_runtime",
          runId: "run_runtime",
          jobId: `job_${seq}`,
          executionId: `exec_${seq}`,
          attempt: 1,
          seqStart: seq,
          seqEnd: seq,
          emittedAt: now,
          events: [{
            seq,
            at: now,
            source: "command",
            role: "runner",
            schema: "workbench.execution.step.v1",
            payload: { step: "run", status: "succeeded" },
          }],
        },
      },
    });
    const parsedProgress: WorkbenchProgressStdoutEnvelope[] = [];
    const parser = createWorkbenchProgressStdoutParser((envelope) => parsedProgress.push(envelope));
    const first = JSON.stringify(progressEnvelope(1));
    const second = JSON.stringify(progressEnvelope(2));
    const third = JSON.stringify(progressEnvelope(3));
    parser.write(`noise\r${WORKBENCH_PROGRESS_STDOUT_PREFIX}${first}\r${WORKBENCH_PROGRESS_STDOUT_PREFIX}${second}`);
    parser.write(`\n${WORKBENCH_PROGRESS_STDOUT_PREFIX}${third}`);
    parser.flush();
    expect(parsedProgress.map((envelope) => envelope.body.batch.seqStart)).toEqual([1, 2, 3]);

    const materialized = materializeWorkbenchRunResult({
      runId: "run_runtime",
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      startedAt: now,
      spec,
      jobs: [candidateRevision, completedRunner],
      existingCandidateCount: 0,
    });

    expect(materialized.activeCandidateId).toBe(candidateId);
    expect(materialized.candidates).toHaveLength(1);
    expect(materialized.candidates[0]?.name).toBe("runtime-generic-execution");
    expect(materialized.candidates[0]).not.toHaveProperty("metrics");
    expect(materialized.candidates[0]?.eval?.metrics?.score.mean).toBe(0.91);
    expect(materialized.candidates[0]?.eval?.samples[0]?.cases?.[0]).toMatchObject({
      id: "case-001",
      status: "completed",
      metrics: { score: 0.91 },
    });
    expect(materialized.candidates[0]?.eval?.samples[0]?.cases?.[0]?.durationMs).toEqual(expect.any(Number));
    expect(materialized.evaluations[0]?.evaluation.cases?.[0]?.durationMs?.mean).toEqual(expect.any(Number));
    expect(materialized.completedJobCount).toBe(2);
    expect(materialized.evaluations[0]?.evaluation.candidate.id).toBe(candidateId);
    expect(materialized.evaluations[0]?.candidateName).toBe("runtime-generic-execution");
    expect(materialized.evaluations[0]?.evaluation.candidate.label).toBe("runtime-generic-execution");
  });

  test("materializes only candidate source files into candidate snapshots", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "candidate_runtime_001";
    const candidateRevision = createBaselineCandidateJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      candidateId,
      files: normalizeSurfaceFiles([
        { path: "prompt.md", content: "base candidate\n" },
        { path: "reports/source-note.md", content: "candidate-authored source\n" },
      ]),
      now,
      baseId: null,
      attemptIndex: 0,
    });
    const attemptJob: HostedWorkbenchJob = {
      id: "job_exec_run_runtime_attempt_000_current_sample_000_score",
      projectId: "project_runtime",
      runId: "run_runtime",
      candidateId,
      kind: "execute",
      status: "succeeded",
      attempt: 1,
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      updatedAt: now,
      input: {
        candidateId,
        attemptIndex: 0,
        sampleIndex: 0,
        execution: {
          id: "exec_run_runtime_attempt_000_current_sample_000_score",
          purpose: "attempt",
          adapter: { use: "command", with: { command: "node score.js" } },
          inputs: [],
          outputs: [],
        },
      } as unknown as HostedWorkbenchJob["input"],
      output: {
        ok: true,
        candidateId,
        attemptIndex: 0,
        sampleIndex: 0,
        result: { score: 0.9 },
        fileChanges: ["score.json"],
        files: [
          {
            path: "score.json",
            kind: "text",
            encoding: "utf8",
            content: "{\"score\":0.9}\n",
            executable: false,
          },
          {
            path: ".workbench/traces/job_exec_run_runtime_attempt_000_current_sample_000_score/score.json",
            kind: "text",
            encoding: "utf8",
            content: "{\"score\":0.9,\"source\":\"engine-output\"}\n",
            executable: false,
          },
        ],
        sample: {
          id: "sample_001",
          index: 0,
          candidate: { id: candidateId, kind: "candidate" },
          status: "completed",
          metrics: { score: 0.9 },
          startedAt: now,
          finishedAt: now,
          cases: [{
            id: "case-001",
            label: "case-001",
            status: "completed",
            metrics: { score: 0.9 },
          }],
        },
      } as unknown as HostedWorkbenchJob["output"],
    };

    const materialized = materializeWorkbenchRunResult({
      runId: "run_runtime",
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      startedAt: now,
      spec,
      jobs: [candidateRevision, attemptJob],
      existingCandidateCount: 0,
    });

    expect(materialized.candidateFiles[candidateId]?.map((file) => file.path)).toEqual([
      "prompt.md",
      "reports/source-note.md",
    ]);
  });

  test("materialized candidate baseId comes only from explicit improve candidate revision output", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateRevision = createBaselineCandidateJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      candidateId: "candidate_runtime_002",
      files: normalizeSurfaceFiles([{ path: "prompt.md", content: "base candidate\n" }]),
      now,
      baseId: null,
      attemptIndex: 0,
    });
    const materialized = materializeWorkbenchRunResult({
      runId: "run_runtime",
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      startedAt: now,
      spec,
      jobs: [candidateRevision],
      previousCandidate: {
        id: "candidate_previous",
        version: 1,
        ordinal: 1,
        benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
        candidateFingerprint: "candidate_previous",
        createdAt: now,
        referenceIds: [],
        status: "evaluated",
        fileChanges: [],
      },
      existingCandidateCount: 1,
    });

    expect(materialized.candidates[0]?.baseId).toBeUndefined();
  });

  test("materialized evaluation preserves existing candidate identity metadata", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "candidate_existing";
    const benchmarkFingerprint = "4444444444444444444444444444444444444444444444444444444444444444";
    const previousCandidate = {
      id: candidateId,
      name: "Existing Candidate",
      version: 2,
      ordinal: 2,
      benchmarkFingerprint,
      candidateFingerprint: "candidate_existing_fingerprint",
      createdAt: "2026-04-26T00:00:00.000Z",
      baseId: "candidate_parent",
      referenceIds: ["candidate_reference"],
      status: "evaluated" as const,
      fileChanges: ["SKILL.md"],
      prompt: "Improve the skill.",
      meta: {
        traces: {
          improve: ["traces/improve.json"],
        },
      },
    };
    const candidateRevision = createBaselineCandidateJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_existing_eval",
      candidateId,
      files: normalizeSurfaceFiles([{ path: "prompt.md", content: "candidate\n" }]),
      now,
      baseId: null,
      attemptIndex: 0,
    });
    const attemptJob: HostedWorkbenchJob = {
      ...runningJob({
        id: "job_existing_eval_score",
        projectId: "project_runtime",
        runId: "run_existing_eval",
        candidateId,
        kind: "execute",
        status: "queued",
        attempt: 0,
        createdAt: now,
        updatedAt: now,
        input: {
          candidateId,
          attemptIndex: 0,
          sampleIndex: 0,
          caseId: "case-001",
          execution: {
            id: "exec_existing_eval_score",
            purpose: "attempt",
            adapter: { use: "command", with: { command: "node score.js" } },
            inputs: [],
            outputs: [],
          },
        },
      } as unknown as HostedWorkbenchJob, now),
      status: "succeeded",
      attempt: 1,
      finishedAt: now,
      updatedAt: now,
      output: {
        ok: true,
        candidateId,
        attemptIndex: 0,
        fileChanges: [],
        sample: {
          id: "sample_001",
          index: 0,
          candidate: { id: candidateId, kind: "candidate" },
          status: "completed",
          metrics: { score: 0.82 },
          cases: [{
            id: "case-001",
            status: "completed",
            metrics: { score: 0.82 },
          }],
        },
      } as unknown as HostedWorkbenchJob["output"],
    };

    const materialized = materializeWorkbenchRunResult({
      runId: "run_existing_eval",
      benchmarkFingerprint,
      candidateFingerprint: previousCandidate.candidateFingerprint,
      startedAt: now,
      spec,
      jobs: [candidateRevision, attemptJob],
      previousCandidate,
      existingCandidateCount: 3,
    });

    expect(materialized.candidates[0]).toMatchObject({
      id: candidateId,
      version: 2,
      ordinal: 2,
      createdAt: "2026-04-26T00:00:00.000Z",
      baseId: "candidate_parent",
      referenceIds: ["candidate_reference"],
      fileChanges: ["SKILL.md"],
      prompt: "Improve the skill.",
    });
    expect(materialized.candidates[0]?.eval?.metrics.score.mean).toBe(0.82);
    expect(materialized.candidates[0]?.meta).toMatchObject({
      traces: {
        improve: ["traces/improve.json"],
      },
    });
  });

  test("materializes invalid sample statuses as an error sample", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "candidate_invalid_status";
    const candidateRevision = createBaselineCandidateJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_invalid_status",
      candidateId,
      files: normalizeSurfaceFiles([{ path: "prompt.md", content: "candidate" }]),
      now,
      baseId: null,
      attemptIndex: 0,
    });
    const attemptJob: HostedWorkbenchJob = {
      ...runningJob({
        id: "job_invalid_score",
        projectId: "project_runtime",
        runId: "run_invalid_status",
        candidateId,
        kind: "execute",
        status: "queued",
        attempt: 0,
        createdAt: now,
        updatedAt: now,
        input: {
          candidateId,
          attemptIndex: 0,
          sampleIndex: 0,
          caseId: "case-001",
          execution: {
            id: "exec_invalid_score",
            purpose: "attempt",
            adapter: { use: "command", with: { command: "node score.js" } },
            inputs: [],
            outputs: [],
          },
        },
      } as unknown as HostedWorkbenchJob, now),
      status: "succeeded",
      attempt: 1,
      finishedAt: now,
      updatedAt: now,
      output: {
        ok: true,
        candidateId,
        attemptIndex: 0,
        fileChanges: [],
        sample: {
          id: "sample_001",
          index: 0,
          candidate: { id: candidateId, kind: "candidate" },
          status: "failed",
          metrics: { score: 0.1 },
          cases: [{
            id: "case-001",
            status: "passed",
            metrics: { score: 0.1 },
          }],
        },
      } as unknown as HostedWorkbenchJob["output"],
    };

    const materialized = materializeWorkbenchRunResult({
      runId: "run_invalid_status",
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      startedAt: now,
      spec,
      jobs: [candidateRevision, attemptJob],
      existingCandidateCount: 0,
    });

    const evalRecord = materialized.candidates[0]?.eval;
    const sample = evalRecord?.samples[0];
    expect(evalRecord?.sampleCount).toBe(1);
    expect(evalRecord?.errorSampleCount).toBe(1);
    expect(sample?.status).toBe("error");
    expect(sample?.cases?.[0]?.status).toBe("error");
    expect(sample?.error).toContain("valid sample");
  });

  test("counts samples as repeats instead of task executions", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "candidate_two_cases_one_sample";
    const candidateRevision = createBaselineCandidateJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_two_cases_one_sample",
      candidateId,
      files: normalizeSurfaceFiles([{ path: "prompt.md", content: "candidate" }]),
      now,
      baseId: null,
      attemptIndex: 0,
    });
    const engineCases = [
      engineCase("case-a", "A"),
      engineCase("case-b", "B"),
    ];
    const attemptJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_two_cases_one_sample",
      candidateId,
      attemptIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "attempt",
      caseIds: engineCases.map((bundle) => bundle.id),
      engineCases,
      now,
    });
    const completedAttempts = attemptJobs.map((job, index): HostedWorkbenchJob => {
      const caseId = index === 0 ? "case-a" : "case-b";
      const score = index === 0 ? 0.9 : 0.3;
      const finishedAt = new Date(Date.parse(now) + ((index + 1) * 1000)).toISOString();
      return {
        ...runningJob(job, now),
        status: "succeeded",
        attempt: 1,
        finishedAt,
        updatedAt: finishedAt,
        output: {
          ok: true,
          candidateId,
          attemptIndex: 0,
          fileChanges: [],
          files: normalizeSurfaceFiles([{
            path: `${caseId}/score.json`,
            content: JSON.stringify({ score }),
          }]),
          traces: [],
          sample: {
            id: `${caseId}__sample_001`,
            index: 0,
            candidate: { id: candidateId, kind: "candidate" },
            status: "completed",
            startedAt: now,
            finishedAt,
            durationMs: (index + 1) * 1000,
            metrics: { score },
            cases: [{
              id: caseId,
              status: "completed",
              metrics: { score },
            }],
          },
        },
      };
    });

    const materialized = materializeWorkbenchRunResult({
      runId: "run_two_cases_one_sample",
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      startedAt: now,
      spec,
      jobs: [candidateRevision, ...completedAttempts],
      existingCandidateCount: 0,
    });

    const evalRecord = materialized.candidates[0]?.eval;
    expect(evalRecord?.sampleCount).toBe(1);
    expect(evalRecord?.completedSampleCount).toBe(1);
    expect(evalRecord?.metrics?.score.count).toBe(1);
    expect(evalRecord?.metrics?.score.mean).toBe(0.6);
    expect(evalRecord?.samples).toHaveLength(1);
    expect(evalRecord?.samples[0]?.id).toBe("sample_001");
    expect(evalRecord?.samples[0]?.cases?.map((entry) => entry.id)).toEqual(["case-a", "case-b"]);
    expect(evalRecord?.cases?.map((entry) => ({
      id: entry.id,
      sampleCount: entry.sampleCount,
      status: entry.status,
      durationMs: entry.durationMs?.mean,
    }))).toEqual([
      { id: "case-a", sampleCount: 1, status: "completed", durationMs: 1000 },
      { id: "case-b", sampleCount: 1, status: "completed", durationMs: 2000 },
    ]);
    expect(materialized.evaluations[0]?.sampleCount).toBe(1);
  });

  test("selects improved candidates by configured split score", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const runId = "run_split_selection";
    const candidateId = "candidate_split_selection_001";
    const previousCandidate = {
      id: "candidate_previous",
      version: 1,
      ordinal: 1,
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      candidateFingerprint: "candidate_previous",
      createdAt: now,
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
      eval: {
        candidate: { id: "candidate_previous", kind: "candidate" as const },
        status: "completed" as const,
        sampleCount: 1,
        completedSampleCount: 1,
        errorSampleCount: 0,
        metrics: { score: metricStats([0.6]) },
        cases: [
          { id: "case-train", split: "train", status: "completed" as const, sampleCount: 1, metrics: { score: metricStats([1]) } },
          { id: "case-validation", split: "validation", status: "completed" as const, sampleCount: 1, metrics: { score: metricStats([0.2]) } },
        ],
        samples: [{
          id: "sample_001",
          index: 0,
          candidate: { id: "candidate_previous", kind: "candidate" as const },
          status: "completed" as const,
          metrics: { score: 0.6 },
          cases: [
            { id: "case-train", split: "train", status: "completed" as const, metrics: { score: 1 } },
            { id: "case-validation", split: "validation", status: "completed" as const, metrics: { score: 0.2 } },
          ],
        }],
      },
    };
    const candidateRevision = createBaselineCandidateJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId,
      candidateId,
      files: normalizeSurfaceFiles([{ path: "prompt.md", content: "candidate" }]),
      now,
      baseId: previousCandidate.id,
      attemptIndex: 0,
    });
    const engineCases = [
      engineCase("case-train", "Train", [], [], "train"),
      engineCase("case-validation", "Validation", [], [], "validation"),
    ];
    const attemptJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId,
      candidateId,
      attemptIndex: 0,
      samples: 1,
      spec,
      workflow: "improve",
      purpose: "attempt",
      caseIds: engineCases.map((bundle) => bundle.id),
      engineCases,
      now,
    });
    const completedAttempts = attemptJobs.map((job): HostedWorkbenchJob => {
      const caseId = job.input && typeof job.input === "object" && !Array.isArray(job.input)
        ? String((job.input as { caseId?: unknown }).caseId)
        : "";
      const score = caseId === "case-validation" ? 0.4 : 0;
      return {
        ...runningJob(job, now),
        status: "succeeded",
        attempt: 1,
        finishedAt: now,
        updatedAt: now,
        output: {
          ok: true,
          candidateId,
          attemptIndex: 0,
          fileChanges: [],
          files: [],
          traces: [],
          sample: {
            id: `${caseId}__sample_001`,
            index: 0,
            candidate: { id: candidateId, kind: "candidate" },
            status: "completed",
            startedAt: now,
            finishedAt: now,
            metrics: { score },
            cases: [{
              id: caseId,
              status: "completed",
              metrics: { score },
            }],
          },
        },
      };
    });

    const materialized = materializeWorkbenchRunResult({
      runId,
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      startedAt: now,
      spec,
      jobs: [candidateRevision, ...completedAttempts],
      previousCandidate: previousCandidate as Parameters<typeof materializeWorkbenchRunResult>[0]["previousCandidate"],
      existingCandidateCount: 1,
      selection: {
        metric: "score",
        caseIds: ["case-validation"],
        label: "score on split=validation",
      },
    });
    const traceIndex = JSON.parse(
      createOptimizerTraceInputFiles({
        jobs: filterOptimizerTraceJobsForCaseIds(completedAttempts, ["case-train"]),
      }).find((file) => file.path === "index.json")?.content ?? "{}",
    ) as { executions?: Array<{ caseId?: string | null }> };

    expect(materialized.activeCandidateId).toBe(candidateId);
    expect(materialized.evaluations[0]?.selectionScore?.mean).toBe(0.4);
    expect(materialized.evaluations[0]?.selectionLabel).toBe("score on split=validation");
    expect(materialized.candidates[0]?.eval?.metrics?.score.mean).toBe(0.2);
    expect(materialized.candidates[0]?.eval?.cases?.map((entry) => [entry.id, entry.split])).toEqual([
      ["case-train", "train"],
      ["case-validation", "validation"],
    ]);
    expect(traceIndex.executions?.map((entry) => entry.caseId)).toEqual(["case-train"]);
  });

  test("selects improved candidates by aggregate score when selection uses all cases", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const runId = "run_all_case_selection";
    const candidateId = "candidate_all_case_selection_001";
    const previousCandidate = {
      id: "candidate_previous_all_cases",
      version: 1,
      ordinal: 1,
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      candidateFingerprint: "candidate_previous_all_cases",
      createdAt: now,
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
      eval: {
        candidate: { id: "candidate_previous_all_cases", kind: "candidate" as const },
        status: "completed" as const,
        sampleCount: 1,
        completedSampleCount: 1,
        errorSampleCount: 0,
        metrics: { score: metricStats([0.6]) },
        samples: [{
          id: "sample_001",
          index: 0,
          candidate: { id: "candidate_previous_all_cases", kind: "candidate" as const },
          status: "completed" as const,
          metrics: { score: 0.6 },
        }],
      },
    };
    const candidateRevision = createBaselineCandidateJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId,
      candidateId,
      files: normalizeSurfaceFiles([{ path: "prompt.md", content: "candidate" }]),
      now,
      baseId: previousCandidate.id,
      attemptIndex: 0,
    });
    const [attemptJob] = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId,
      candidateId,
      attemptIndex: 0,
      samples: 1,
      spec,
      workflow: "improve",
      purpose: "attempt",
      caseIds: ["case-a"],
      engineCases: [engineCase("case-a", "Case A")],
      now,
    });
    const completedAttempt: HostedWorkbenchJob = {
      ...runningJob(attemptJob!, now),
      status: "succeeded",
      attempt: 1,
      finishedAt: now,
      updatedAt: now,
      output: {
        ok: true,
        candidateId,
        attemptIndex: 0,
        fileChanges: [],
        files: [],
        traces: [],
        sample: {
          id: "sample_001",
          index: 0,
          candidate: { id: candidateId, kind: "candidate" },
          status: "completed",
          startedAt: now,
          finishedAt: now,
          metrics: { score: 0.7 },
        },
      },
    };

    const materialized = materializeWorkbenchRunResult({
      runId,
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      startedAt: now,
      spec,
      jobs: [candidateRevision, completedAttempt],
      previousCandidate: previousCandidate as Parameters<typeof materializeWorkbenchRunResult>[0]["previousCandidate"],
      existingCandidateCount: 1,
      selection: {
        metric: "score",
        label: "score on all cases",
      },
    });

    expect(materialized.activeCandidateId).toBe(candidateId);
    expect(materialized.evaluations[0]?.selectionScore?.mean).toBe(0.7);
  });

  test("case reviews expose scoring and executions without file or log side channels", () => {
    const candidate = {
      id: "candidate_execution_review",
      ordinal: 1,
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      candidateFingerprint: "candidate_execution_review",
      createdAt: "2026-04-27T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
      eval: {
        candidate: { kind: "candidate", id: "candidate_execution_review" },
        status: "completed",
        sampleCount: 1,
        completedSampleCount: 1,
        errorSampleCount: 0,
        samples: [{
          id: "sample_001",
          index: 0,
          candidate: { kind: "candidate", id: "candidate_execution_review" },
          status: "completed",
          metrics: { score: 0.91 },
          cases: [{
            id: "smoke",
            status: "completed",
            metrics: { score: 0.91 },
            criteria: [{ criterion_id: "quality", label: "Quality", score: 1, pass: true }],
          }],
        }],
      },
    };

    const review = createCaseReview({
      candidate: candidate as Parameters<typeof createCaseReview>[0]["candidate"],
      caseId: "smoke",
    });

    expect(review.criteria_results).toEqual([{
      criterion_id: "quality",
      pass: true,
      score: 1,
      errors: [],
    }]);
    expect("logs" in (review as unknown as Record<string, unknown>)).toBe(false);
  });

  test("case reviews use execution sample identity when materialized samples share a case id", () => {
    const candidate = {
      id: "candidate_execution_review",
      ordinal: 1,
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      candidateFingerprint: "candidate_execution_review",
      createdAt: "2026-04-27T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
      eval: {
        candidate: { kind: "candidate", id: "candidate_execution_review" },
        status: "completed",
        sampleCount: 2,
        completedSampleCount: 2,
        errorSampleCount: 0,
        samples: [
          {
            id: "task-001__sample_001",
            index: 0,
            candidate: { kind: "candidate", id: "candidate_execution_review" },
            status: "completed",
            metrics: { score: 0.25 },
            cases: [{ id: "task-001", status: "completed", metrics: { score: 0.25 } }],
          },
          {
            id: "task-001__sample_002",
            index: 1,
            candidate: { kind: "candidate", id: "candidate_execution_review" },
            status: "completed",
            metrics: { score: 0.75 },
            cases: [{ id: "task-001", status: "completed", metrics: { score: 0.75 } }],
          },
        ],
      },
    };

    const review = createCaseReview({
      candidate: candidate as Parameters<typeof createCaseReview>[0]["candidate"],
      caseId: "task-001",
      executions: [{
        runId: "run_001",
        kind: "attempt",
        role: "runner",
        status: "succeeded",
        jobIds: ["job_001"],
        executionIds: ["exec_001"],
        sampleIndex: 1,
      }],
    });

    expect(review.sampleId).toBe("task-001__sample_002");
    expect(review.sampleIndex).toBe(1);
    expect(review.metrics.score).toBe(0.75);
  });

  test("case reviews do not infer case results from sample ids or sample metrics", () => {
    const candidate = {
      id: "candidate_execution_review",
      ordinal: 1,
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      candidateFingerprint: "candidate_execution_review",
      createdAt: "2026-04-27T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
      eval: {
        candidate: { kind: "candidate", id: "candidate_execution_review" },
        status: "completed",
        sampleCount: 1,
        completedSampleCount: 1,
        errorSampleCount: 0,
        samples: [{
          id: "task-001__sample_001",
          index: 0,
          candidate: { kind: "candidate", id: "candidate_execution_review" },
          status: "completed",
          metrics: { score: 0.75 },
        }],
      },
    };

    const review = createCaseReview({
      candidate: candidate as Parameters<typeof createCaseReview>[0]["candidate"],
      caseId: "task-001",
      executions: [{
        runId: "run_001",
        kind: "attempt",
        role: "runner",
        status: "succeeded",
        jobIds: ["job_001"],
        executionIds: ["exec_001"],
        sampleIndex: 0,
      }],
    });

    expect(review.sampleId).toBeUndefined();
    expect(review.metrics).toEqual({});
    expect(review.criteria_results).toEqual([]);
  });

  test("case reviews expose execution-only task state through the shared helper", () => {
    const review = createCaseReview({
      candidate: {
        id: "candidate_execution_only",
        ordinal: 1,
        benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
        candidateFingerprint: "candidate_execution_only",
        createdAt: "2026-04-27T00:00:00.000Z",
        referenceIds: [],
        status: "running",
        fileChanges: [],
      } as Parameters<typeof createCaseReview>[0]["candidate"],
      caseId: "task-001",
      executions: [{
        runId: "run_001",
        kind: "attempt",
        role: "runner",
        status: "running",
        jobIds: ["job_001"],
        executionIds: ["exec_001"],
        sampleIndex: 0,
      }],
    });

    expect(review.caseId).toBe("task-001");
    expect(review.sampleIndex).toBe(0);
    expect(review.metrics).toEqual({});
    expect(review.criteria_results).toEqual([]);
    expect(review.executions).toHaveLength(1);
  });

  test("rejects unknown top-level source fields", () => {
    const validation = validateWorkbenchResolvedSourceYaml(runtimeSpecWithUnknownTopLevelField());

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("resolved Workbench source includes unsupported field: experiments.");
  });

  test("executes a skill runner as agent-produced output without an OCI environment", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(skillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "candidate_skill_001";
    const baseFiles = normalizeSurfaceFiles([{
      path: "invoice-review/SKILL.md",
      content: "---\nname: invoice-review\ndescription: Review invoices.\n---\n\n# Invoice Review\n",
    }]);
    const largeFilingText = "large filing body\n".repeat(100_000);
    const engineCases = [engineCase(
      "case-001",
      "Review this invoice fixture.",
      [
        { path: "prompt.md", content: "Review this invoice fixture.\n" },
        { path: "filing/raw/primary_document.htm", content: largeFilingText },
      ],
    )];
    const engineResolveFiles = engineCases[0]!.files.public ?? [];
    const attemptJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_skill_runtime",
      candidateId,
      attemptIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "attempt",
      caseIds: engineCases.map((bundle) => bundle.id),
      engineCases,
      now,
    });
    const runningRunner = runningJob(attemptJobs[0]!, now);
    const runnerExecution = executionFromJob(runningRunner);
    const runnerUsage = {
      total: {
        provider: "openai/codex",
        model: "gpt-5.4-mini",
        totalTokens: 1_200,
        costUsd: 0.0042,
        costSource: "estimated" as const,
      },
    };
    const codexAdapter = await scriptedAdapterManifest("codex", `
import fs from "node:fs";
import path from "node:path";
const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, "utf8"));
const output = process.env.WORKBENCH_OUTPUT;
const traceId = request.jobId || request.id;
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "runner-summary.md"), "skill output from runner");
fs.mkdirSync(path.join(output, ".workbench", "traces", traceId, "runner", "session"), { recursive: true });
fs.writeFileSync(path.join(output, ".workbench", "traces", traceId, "runner.json"), "{}\\n");
fs.writeFileSync(path.join(output, ".workbench", "traces", traceId, "runner", "session", "events.ndjson"), "{\\"event\\":\\"done\\"}\\n");
fs.writeFileSync(path.join(output, "workbench-result.json"), JSON.stringify({
  protocol: "workbench.adapter-result.v1",
  operation: "candidate.run",
  ok: true,
  summary: "skill output from runner",
  usage: ${JSON.stringify(runnerUsage)}
}, null, 2));
`);
    const engineUsage = {
      total: {
        provider: "openai/codex",
        model: "gpt-5.4-mini",
        totalTokens: 300,
        costUsd: 0.001,
        costSource: "estimated" as const,
      },
    };
    const rubricAdapter = await scriptedAdapterManifest("rubric", `
import fs from "node:fs";
import path from "node:path";
const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, "utf8"));
const output = process.env.WORKBENCH_OUTPUT;
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "workbench-result.json"), JSON.stringify({
  protocol: "workbench.adapter-result.v1",
  operation: "engine.run",
  ok: true,
  value: {
    score: 0.88,
    metrics: { score: 0.88 },
    cases: [{ id: request.context?.attempt?.caseId ?? "current", status: "completed", metrics: { score: 0.88 } }],
    usage: {
      engine: ${JSON.stringify(engineUsage.total)},
      total: ${JSON.stringify(engineUsage.total)}
    },
    feedback: { metadata: {} }
  }
}, null, 2));
`);
    const completedRunner = await executeWorkbenchAttemptWithRuntimeControl({
      job: runningRunner,
      spec,
      adapterManifests: [workbenchEngineManifest(), codexAdapter, rubricAdapter],
      baseFiles,
      engineResolveFiles,
      engineCases,
    });

    expect(completedRunner.error).toBeUndefined();
    expect(completedRunner.status).toBe("succeeded");
    const attemptOutputPaths = completedOutputFiles(completedRunner).map((file) => file.path);
    expect(attemptOutputPaths).toContain("runner-summary.md");
    expect(attemptOutputPaths.some((filePath) => filePath.startsWith(".workbench/internal/"))).toBe(false);
    expect((completedRunner.output as { usage?: { runner?: { costUsd?: number } } }).usage?.runner?.costUsd).toBe(0.0042);
    expect((completedRunner.output as { traces?: string[] }).traces).toEqual(expect.arrayContaining([
      `.workbench/traces/000001-run_skill_runtime/000002-attempt/${runningRunner.id}/candidate/request.json`,
      `.workbench/traces/000001-run_skill_runtime/000002-attempt/${runningRunner.id}/candidate/result.json`,
      `.workbench/traces/000001-run_skill_runtime/000002-attempt/${runningRunner.id}/engine/request.json`,
      `.workbench/traces/000001-run_skill_runtime/000002-attempt/${runningRunner.id}/engine/result.json`,
      `.workbench/traces/000001-run_skill_runtime/000002-attempt/${runningRunner.id}/runner.json`,
      `.workbench/traces/000001-run_skill_runtime/000002-attempt/${runningRunner.id}/runner/session/events.ndjson`,
      `.workbench/traces/000001-run_skill_runtime/000002-attempt/${runningRunner.id}/score/request.json`,
      `.workbench/traces/000001-run_skill_runtime/000002-attempt/${runningRunner.id}/score/result.json`,
    ]));

    const completedEngine = completedRunner;
    expect(completedEngine.error).toBeUndefined();
    expect(completedEngine.status).toBe("succeeded");
    expect(completedScore(completedEngine)).toBe(0.88);
    expect((completedEngine.output as { usage?: { runner?: { costUsd?: number } } }).usage?.runner?.costUsd).toBe(0.0042);
    expect((completedEngine.output?.result as { feedback?: { metadata?: { usage?: unknown } } } | undefined)?.feedback?.metadata?.usage).toBeUndefined();
    expect((completedEngine.output?.result as { cases?: Array<{ id?: string }> } | undefined)?.cases?.[0]?.id).toBe("case-001");
    const candidateRevision = createBaselineCandidateJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_skill_runtime",
      candidateId,
      files: baseFiles,
      now,
      baseId: null,
      attemptIndex: 0,
    });
    const candidateRevisionWithUsage = {
      ...candidateRevision,
      output: {
        ...(candidateRevision.output as Record<string, unknown>),
        usage: {
          improver: {
            provider: "openai/codex",
            model: "gpt-5.4-mini",
            totalTokens: 500,
            costUsd: 0.002,
            costSource: "estimated" as const,
          },
          total: {
            provider: "openai/codex",
            model: "gpt-5.4-mini",
            totalTokens: 500,
            costUsd: 0.002,
            costSource: "estimated" as const,
          },
        },
      },
    };
    const materialized = materializeWorkbenchRunResult({
      runId: "run_skill_runtime",
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      startedAt: now,
      spec,
      jobs: [candidateRevisionWithUsage, completedRunner],
      existingCandidateCount: 0,
    });
    expect(materialized.candidates[0]?.usage?.improver?.costUsd).toBe(0.002);
    expect(materialized.candidates[0]?.usage?.runner?.costUsd).toBe(0.0042);
    expect(materialized.candidates[0]?.usage?.engine?.costUsd).toBe(0.001);
    expect(materialized.candidates[0]?.usage?.total?.costUsd).toBe(0.0072);
    expect(materialized.candidates[0]?.eval?.usage?.total?.costUsd?.mean).toBe(0.0052);
    expect(materialized.candidates[0]?.eval?.usage?.total?.totalTokens?.mean).toBe(1_500);
    expect(materialized.candidates[0]?.eval?.usage?.runner?.costUsd?.mean).toBe(0.0042);
    expect(materialized.candidates[0]?.eval?.usage?.engine?.costUsd?.mean).toBe(0.001);
    expect(materialized.evaluations[0]?.usage?.total?.costUsd?.mean).toBe(0.0052);
  });

  test("uses criterion scores when rubric judges return an unnormalized top-level score", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(skillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const engineCases = [engineCase("case-001", "Review this invoice fixture.")];
    const engineResolveFiles = engineCases[0]!.files.public ?? [];
    const attemptJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_rubric_normalization",
      candidateId: "candidate_skill_001",
      attemptIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "attempt",
      caseIds: engineCases.map((bundle) => bundle.id),
      engineCases,
      now,
    });
    const runningEngine = runningJob(attemptJobs[0]!, now);
    const engineExecution = executionFromJob(runningEngine);
    const rubricAdapter = await scriptedRubricAdapter({
      score: 0.4,
      summary: "Judge used a 10-point top-level score but normalized criteria.",
      criteria: [{
        criterion_id: "useful",
        score: 0.4,
        pass: false,
        rationale: "The runner output missed the required output.",
      }],
    });
    const runnerAdapter = await scriptedRunnerAdapter();
    const completedEngine = await executeWorkbenchAttemptWithRuntimeControl({
      job: runningEngine,
      spec,
      adapterManifests: [workbenchEngineManifest(), runnerAdapter, rubricAdapter],
      baseFiles: normalizeSurfaceFiles([{ path: "SKILL.md", content: "Use the skill.\n" }]),
      engineResolveFiles,
      engineCases,
    });

    expect(completedEngine.error).toBeUndefined();
    expect(completedEngine.status).toBe("succeeded");
    expect(completedScore(completedEngine)).toBe(0.4);
    const result = completedEngine.output?.result as { cases?: Array<{ status?: string; criteria?: Array<{ rationale?: string }> }> } | undefined;
    expect(result?.cases?.[0]?.status).toBe("completed");
    expect(result?.cases?.[0]?.criteria?.[0]?.rationale).toBe("The runner output missed the required output.");
  });

  test("repairs malformed rubric judge JSON with one bounded judge turn", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(skillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const engineCases = [engineCase("case-001", "Review this invoice fixture.")];
    const engineResolveFiles = engineCases[0]!.files.public ?? [];
    const attemptJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_rubric_repair",
      candidateId: "candidate_skill_001",
      attemptIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "attempt",
      caseIds: engineCases.map((bundle) => bundle.id),
      engineCases,
      now,
    });
    const runningEngine = runningJob(attemptJobs[0]!, now);
    const engineExecution = executionFromJob(runningEngine);
    const rubricAdapter = await scriptedRubricAdapter({
      score: 0.82,
      summary: "Repaired rubric judge output.",
      criteria: [{
        criterion_id: "useful",
        score: 0.82,
        pass: true,
        rationale: "The runner output is usable.",
      }],
      feedback: {
        metadata: {
          repair: {
            attempted: true,
            originalError: "Rubric judge output must parse as a JSON object.",
          },
        },
      },
    });
    const runnerAdapter = await scriptedRunnerAdapter();
    const completedEngine = await executeWorkbenchAttemptWithRuntimeControl({
      job: runningEngine,
      spec,
      adapterManifests: [workbenchEngineManifest(), runnerAdapter, rubricAdapter],
      baseFiles: normalizeSurfaceFiles([{ path: "SKILL.md", content: "Use the skill.\n" }]),
      engineResolveFiles,
      engineCases,
    });

    expect(completedEngine.error).toBeUndefined();
    expect(completedEngine.status).toBe("succeeded");
    expect(completedScore(completedEngine)).toBe(0.82);
    const result = completedEngine.output?.result as { feedback?: { metadata?: { repair?: { attempted?: boolean; originalError?: string } } } } | undefined;
    expect(result?.feedback?.metadata?.repair?.attempted).toBe(true);
    expect(result?.feedback?.metadata?.repair?.originalError).toContain("must parse as a JSON object");
  });

  test("accepts rubric repair JSON with invalid string escapes", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(skillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const engineCases = [engineCase("case-001", "Review this invoice fixture.")];
    const engineResolveFiles = engineCases[0]!.files.public ?? [];
    const attemptJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_rubric_escape_repair",
      candidateId: "candidate_skill_001",
      attemptIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "attempt",
      caseIds: engineCases.map((bundle) => bundle.id),
      engineCases,
      now,
    });
    const runningEngine = runningJob(attemptJobs[0]!, now);
    const engineExecution = executionFromJob(runningEngine);
    const rubricAdapter = await scriptedRubricAdapter({
      score: 0.82,
      summary: "Repaired rubric judge output.",
      criteria: [{
        criterion_id: "useful",
        score: 0.82,
        pass: true,
        rationale: "The workbook references C:\\Temp\\model and remains usable.",
      }],
    });
    const runnerAdapter = await scriptedRunnerAdapter();
    const completedEngine = await executeWorkbenchAttemptWithRuntimeControl({
      job: runningEngine,
      spec,
      adapterManifests: [workbenchEngineManifest(), runnerAdapter, rubricAdapter],
      baseFiles: normalizeSurfaceFiles([{ path: "SKILL.md", content: "Use the skill.\n" }]),
      engineResolveFiles,
      engineCases,
    });

    expect(completedEngine.error).toBeUndefined();
    expect(completedEngine.status).toBe("succeeded");
    expect(completedScore(completedEngine)).toBe(0.82);
    const result = completedEngine.output?.result as { cases?: Array<{ criteria?: Array<{ rationale?: string }> }> } | undefined;
    expect(result?.cases?.[0]?.criteria?.[0]?.rationale).toBe("The workbook references C:\\Temp\\model and remains usable.");
  });

  test("runs one rubric-scored attempt job per sample and materializes all criteria", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(fiveCriterionSkillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "candidate_skill_001";
    const baseFiles = normalizeSurfaceFiles([{ path: "SKILL.md", content: "Use the skill.\n" }]);
    const engineCases = [engineCase("case-001", "Review this invoice fixture.")];
    const engineResolveFiles = engineCases[0]!.files.public ?? [];
    const attemptJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_single_rubric_attempt",
      candidateId,
      attemptIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "attempt",
      caseIds: engineCases.map((bundle) => bundle.id),
      engineCases,
      now,
    });
    expect(attemptJobs).toHaveLength(1);
    expect(attemptJobCountForRunSpec(spec)).toBe(1);
    expect(expectedWorkbenchRunJobCount({
      workflow: "eval",
      budget: 1,
      samples: 1,
      caseCount: engineCases.length,
    })).toBe(2);
    expect(Object.keys(executionFromJob(attemptJobs[0]!).metadata)).toEqual([
      "attemptIndex",
      "sampleIndex",
      "caseId",
      "engineCase",
    ]);

    const criterionScores = new Map([
      ["useful", 1],
      ["complete", 0.5],
      ["format", 0.75],
      ["accurate", 0.25],
      ["polished", 1],
    ]);
    const criterionDescriptions = new Map([
      ["useful", "Output is useful."],
      ["complete", "Output is complete."],
      ["format", "Output is well formatted."],
      ["accurate", "Output is accurate."],
      ["polished", "Output is polished."],
    ]);
    const runningEngine = runningJob(attemptJobs[0]!, now);
    const engineExecution = executionFromJob(runningEngine);
    const ids = [...criterionDescriptions.keys()];
    const criteria = ids.map((criterionId) => {
      const score = criterionScores.get(criterionId) ?? 0;
      return {
        criterion_id: criterionId,
        score,
        pass: score >= 0.5,
        rationale: `${criterionId} rationale.`,
      };
    });
    const rubricAdapter = await scriptedRubricAdapter({
      score: criteria.reduce((sum, criterion) => sum + criterion.score, 0) / criteria.length,
      summary: `${ids.join(", ")} judged.`,
      criteria,
      feedback: { metadata: { ids } },
    });
    const runnerAdapter = await scriptedRunnerAdapter();
    const completedEngine = await executeWorkbenchAttemptWithRuntimeControl({
      job: runningEngine,
      spec,
      adapterManifests: [workbenchEngineManifest(), runnerAdapter, rubricAdapter],
      baseFiles,
      engineResolveFiles,
      engineCases,
    });

    expect(completedEngine.status).toBe("succeeded");
    const { files: _files, ...hostedStyleEngineOutput } =
      completedEngine.output as Record<string, unknown>;
    const hostedStyleCompletedEngine = {
      ...completedEngine,
      output: hostedStyleEngineOutput,
    };
    const candidateRevision = createBaselineCandidateJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_single_rubric_attempt",
      candidateId,
      files: baseFiles,
      now,
      baseId: null,
      attemptIndex: 0,
    });
    const materialized = materializeWorkbenchRunResult({
      runId: "run_single_rubric_attempt",
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      startedAt: now,
      spec,
      jobs: [candidateRevision, hostedStyleCompletedEngine],
      existingCandidateCount: 0,
    });
    const sample = materialized.candidates[0]?.eval?.samples[0];
    expect(materialized.candidates[0]).not.toHaveProperty("metrics");
    expect(materialized.candidates[0]?.eval?.metrics?.score.mean).toBe(0.7);
    expect(sample?.cases?.[0]?.criteria?.map((criterion) => criterion.criterion_id))
      .toEqual(["useful", "complete", "format", "accurate", "polished"]);
    expect(sample?.cases?.[0]?.criteria?.map((criterion) => criterion.score))
      .toEqual([1, 0.5, 0.75, 0.25, 1]);
  });

  test("materializes a failed attempt engine as one error case sample", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(twoCriterionSkillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "candidate_failed_rubric_score";
    const baseFiles = normalizeSurfaceFiles([{ path: "SKILL.md", content: "Use the skill.\n" }]);
    const engineCases = [engineCase("case-001", "Review this invoice fixture.")];
    const candidateRevision = createBaselineCandidateJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_failed_rubric_score",
      candidateId,
      files: baseFiles,
      now,
      baseId: null,
      attemptIndex: 0,
    });
    const attemptJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_failed_rubric_score",
      candidateId,
      attemptIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "attempt",
      caseIds: engineCases.map((bundle) => bundle.id),
      engineCases,
      now,
    });
    expect(attemptJobs).toHaveLength(1);
    expect(attemptJobCountForRunSpec(spec)).toBe(1);
    const finishedAt = new Date(Date.parse(now) + 1234).toISOString();
    const failedEngine = {
      ...runningJob(attemptJobs[0]!, now),
      status: "failed" as const,
      attempt: 1,
      finishedAt,
      updatedAt: finishedAt,
      error: "engine failed",
      output: { ok: false },
    };

    const materialized = materializeWorkbenchRunResult({
      runId: "run_failed_rubric_score",
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      startedAt: now,
      spec,
      jobs: [candidateRevision, failedEngine],
      existingCandidateCount: 0,
    });

    const evalRecord = materialized.candidates[0]?.eval;
    const sample = evalRecord?.samples[0];
    expect(evalRecord?.sampleCount).toBe(1);
    expect(evalRecord?.errorSampleCount).toBe(1);
    expect(sample?.id).toBe("case-001__sample_001");
    expect(sample?.status).toBe("error");
    expect(sample?.durationMs).toBe(1234);
    expect(sample?.cases?.[0]?.id).toBe("case-001");
    expect(sample?.cases?.[0]?.status).toBe("error");
    expect(sample?.cases?.[0]?.durationMs).toBe(1234);
    expect(evalRecord?.cases?.[0]?.durationMs?.mean).toBe(1234);
    expect(sample?.error).toContain("engine failed");
  });

  test("executes a workflow candidate with the generic agent runner", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(workflowRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "candidate_workflow_001";
    const baseFiles = normalizeSurfaceFiles([{
      path: "workflow.yaml",
      content: [
        "metadata:",
        "  id: runtime-workflow",
        "  name: Runtime Workflow",
        "hooks:",
        "  beforeRun: |",
        "    printf 'workflow runner completed\\n' > workflow-output.log",
        "stages: []",
        "",
      ].join("\n"),
    }]);
    const engineCases = [engineCase("case-001", "Run the workflow.")];
    const engineResolveFiles = engineCases[0]!.files.public ?? [];
    const attemptJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_workflow_runtime",
      candidateId,
      attemptIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "attempt",
      caseIds: engineCases.map((bundle) => bundle.id),
      engineCases,
      now,
    });
    const runningRunner = runningJob(attemptJobs[0]!, now);
    const runnerExecution = executionFromJob(runningRunner);
    const codexAdapter = await scriptedAdapterManifest("codex", `
import fs from "node:fs";
import path from "node:path";
const output = process.env.WORKBENCH_OUTPUT;
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "scratch.tmp"), "scratch\\n");
fs.writeFileSync(path.join(output, "runner-summary.md"), "workflow agent runner completed");
const volatileInternalFile = path.join(output, ".workbench", "internal", "agent-candidate", "session", "home", ".codex", "state_5.sqlite-shm");
fs.mkdirSync(path.dirname(volatileInternalFile), { recursive: true });
fs.writeFileSync(volatileInternalFile, "sqlite sidecar\\n");
fs.chmodSync(volatileInternalFile, 0o000);
fs.writeFileSync(path.join(output, "workbench-result.json"), JSON.stringify({
  protocol: "workbench.adapter-result.v1",
  operation: "candidate.run",
  ok: true
}, null, 2));
`);
    const rubricAdapter = await scriptedRubricAdapter({ score: 0.77 });
    const completedAttempt = await executeWorkbenchAttemptWithRuntimeControl({
      job: runningRunner,
      spec,
      adapterManifests: [workbenchEngineManifest(), codexAdapter, rubricAdapter],
      baseFiles,
      engineResolveFiles,
      engineCases,
    });

    expect(completedAttempt.error).toBeUndefined();
    expect(completedAttempt.status).toBe("succeeded");
    expect(completedScore(completedAttempt)).toBe(0.77);
    const outputFiles = completedOutputFiles(completedAttempt);
    expect(outputFiles.map((file) => file.path)).toContain("runner-summary.md");
    expect(outputFiles.some((file) => file.path.startsWith(".workbench/internal/"))).toBe(false);
    expect(outputFiles.map((file) => file.path)).toContain("scratch.tmp");
    expect(outputFiles.find((file) => file.path === "runner-summary.md")?.content).toContain("workflow agent runner completed");
  });

});

async function executeWorkbenchAttemptWithRuntimeControl(
  args: Parameters<typeof executeWorkbenchExecutionJob>[0],
): Promise<HostedWorkbenchJob> {
  return await executeWorkbenchExecutionJob(args, {
    sandboxProvider: "test-current-runtime",
    createSandboxPlaneForProvider(_provider, runtimeArgs, startedAt, fileStore) {
      return createCurrentRuntimeControlSandboxPlane(runtimeArgs, startedAt, fileStore);
    },
  });
}

function createCurrentRuntimeControlSandboxPlane(
  runtimeArgs: Parameters<NonNullable<Parameters<typeof executeWorkbenchExecutionJob>[1]["createSandboxPlaneForProvider"]>>[1],
  startedAt: string,
  fileStore: SandboxExecutionFileStore,
): SandboxPlane {
  return {
    backend: {
      name: "test-current-runtime",
      capabilities: {
        snapshots: true,
        interactiveExec: false,
        filesystemDiff: false,
        networkPolicy: ["none", "open"],
        fileCapabilities: true,
      },
    },
    async prepareEnvironment(execution) {
      return {
        backend: "test-current-runtime",
        kind: execution.sandbox.kind,
        ref: execution.sandbox.ref,
      };
    },
    async createSandbox(request) {
      return {
        sandboxId: request.allocation.sandboxId,
        lifecycleId: request.allocation.lifecycleId,
        backend: request.allocation.backend,
        executionId: request.execution.id,
        template: request.allocation.template,
      };
    },
    async exec(request) {
      const completedJob = await executeRuntimeControlOperationSequenceInCurrentRuntime(
        {
          ...runtimeArgs,
          workspaceRoot: undefined,
        },
        request.execution,
        startedAt,
        request.capability,
      );
      return await executionResultFromCompletedSandboxJob({
        completedJob,
        execution: request.execution,
        startedAt,
        backend: "test-current-runtime",
        allocation: request.allocation,
        capability: request.capability,
        handle: request.sandbox,
        fileStore,
      });
    },
    async destroySandbox() {
      return undefined;
    },
  };
}

interface CapturedProgressRequest {
  type: string;
  progressToken: string;
  ownerUserId?: string;
  batch: {
    events: Array<{
      source: string;
      role?: string;
      schema: string;
      payload: unknown;
    }>;
  };
}

async function createProgressCaptureServer(): Promise<{
  url: string;
  requests: CapturedProgressRequest[];
  close(): Promise<void>;
}> {
  const requests: CapturedProgressRequest[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void readRequestBody(request)
      .then((body) => {
        requests.push(JSON.parse(body) as CapturedProgressRequest);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ accepted: true }));
      })
      .catch((error) => {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      });
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", onListening);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Progress capture server did not bind a TCP port.");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

async function tryCreateProgressCaptureServer(): Promise<Awaited<ReturnType<typeof createProgressCaptureServer>> | null> {
  try {
    return await createProgressCaptureServer();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "EPERM" || error.code === "EACCES")
    ) {
      return null;
    }
    throw error;
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function runningJob(job: HostedWorkbenchJob, now: string): HostedWorkbenchJob {
  return {
    ...job,
    status: "running",
    startedAt: now,
    updatedAt: now,
  };
}

function executionFromJob(job: HostedWorkbenchJob) {
  const input = job.input as { execution?: unknown };
  if (!input.execution || typeof input.execution !== "object" || Array.isArray(input.execution)) {
    throw new Error("test job omitted execution");
  }
  return input.execution as Parameters<typeof createWorkbenchExecutionCapability>[0];
}

function completedOutputFiles(job: HostedWorkbenchJob): SurfaceSnapshotFile[] {
  const output = job.output && typeof job.output === "object" && !Array.isArray(job.output)
    ? job.output as Record<string, unknown>
    : {};
  return Array.isArray(output.files)
    ? output.files.filter((file): file is SurfaceSnapshotFile => (
        file !== null
        && typeof file === "object"
        && !Array.isArray(file)
        && typeof (file as { path?: unknown }).path === "string"
        && typeof (file as { content?: unknown }).content === "string"
      ))
    : [];
}

function completedScore(job: HostedWorkbenchJob): number | undefined {
  const output = job.output && typeof job.output === "object" && !Array.isArray(job.output)
    ? job.output as Record<string, unknown>
    : {};
  const result = output.result && typeof output.result === "object" && !Array.isArray(output.result)
    ? output.result as Record<string, unknown>
    : {};
  return typeof result.score === "number" ? result.score : undefined;
}

function metricStats(values: readonly number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: values.length,
    mean,
    variance: 0,
    stddev: 0,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function engineCase(
  id: string,
  task: string,
  publicFiles: readonly { path: string; content: string }[] = [],
  privateFiles: readonly { path: string; content: string }[] = [],
  split?: string,
): WorkbenchEngineCase {
  const publicCaseFiles = normalizeSurfaceFiles(publicFiles);
  const privateCaseFiles = normalizeSurfaceFiles(privateFiles);
  return {
    id,
    case: { version: 3, prompt: task, ...(split ? { split } : {}) },
    files: {
      public: publicCaseFiles,
      private: privateCaseFiles,
    },
  };
}

function stageWorkload(purpose: "improve" | "attempt"): WorkbenchRunWorkload {
  const now = "2026-04-27T00:00:00.000Z";
  const bundle = engineCase(
    "case-001",
    "test",
    [{ path: "request.md", content: "public request\n" }],
    [{ path: "secret.txt", content: "hidden\n" }],
  );
  return {
    job: {
      id: `job_${purpose}`,
      projectId: "proj_test",
      runId: "run_test",
      candidateId: "candidate_test",
      kind: "execute",
      status: "running",
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      input: {
        execution: {
          id: `exec_${purpose}`,
          purpose,
          adapter: { use: "command", with: { command: "true" } },
          inputs: [],
          outputs: [],
          policy: { resources: { cpu: 1, memoryGb: 1, diskGb: 1, timeoutMinutes: 1 }, network: { egress: "none" } },
          metadata: {},
        },
      },
    },
    spec: resolveWorkbenchResolvedSourceYaml(runtimeSpec()),
    candidateId: "candidate_test",
    attemptIndex: 0,
    sampleIndex: 0,
    caseId: "case-001",
    candidateFiles: normalizeSurfaceFiles([{ path: "prompt.md", content: "candidate" }]),
    engineResolveFiles: bundle.files.public ?? [],
    traceFiles: normalizeSurfaceFiles([{ path: "index.json", content: "{\"schema\":\"workbench.optimizer-traces.v1\",\"executions\":[]}\n" }]),
    ...(purpose === "attempt" ? { engineCase: bundle, engineCaseSpec: bundle.case } : {}),
    prompt: "test",
    changedPaths: ["prompt.md"],
    baseId: null,
  };
}

function rubricJudgeExecutor(
  score: number,
  usage?: {
    total: {
      provider?: string;
      model?: string;
      totalTokens?: number;
      costUsd?: number;
      costSource?: "provider" | "estimated" | "mixed";
      pricingSource?: string;
    };
  },
) {
  return async () => ({
    output: JSON.stringify({
      score,
      summary: "Rubric judge passed.",
      criteria: [{
        criterion_id: "useful",
        score,
        pass: score >= 0.5,
        rationale: "The runner output satisfies the criterion.",
      }],
    }),
    traceFiles: [],
    metadata: { score },
    ...(usage ? { usage } : {}),
  });
}

function runtimeSpec(): string {
  const runnerCommand = JSON.stringify(`node -e ${JSON.stringify([
    "const fs=require('fs'),path=require('path');",
    "const dir=path.join('output','runner');",
    "fs.mkdirSync(dir,{recursive:true});",
    "fs.writeFileSync(path.join(dir,'runner-output.json'),JSON.stringify({ok:true,metrics:{checks:1}}));",
    "fs.writeFileSync(path.join('output','runner-summary.md'),'Runner output passed.\\n');",
  ].join(""))}`);
  const engineCommand = JSON.stringify(`node -e ${JSON.stringify([
    "const fs=require('fs');",
    "fs.mkdirSync('output',{recursive:true});",
    "fs.writeFileSync('output/workbench-result.json',JSON.stringify({protocol:'workbench.adapter-result.v1',operation:'engine.run',ok:true,value:{score:0.91,summary:'Generic runtime path passed.'}},null,2));",
  ].join(""))}`);
  return [
    "version: 4",
    "benchmark:",
    "  version: 4",
    "  name: runtime-generic-execution",
    "  description: Exercise the generic command runner and engine runtime path.",
    "  engine:",
    "    use: workbench",
    "    with:",
    "      environment:",
    "        dockerfile: environment/Dockerfile",
    "        resources:",
    "          cpu: 1",
    "          memoryGb: 1",
    "          timeoutMinutes: 5",
    "        network:",
    "          egress: none",
    "      score:",
    "        use: command",
    "        with:",
    `          command: ${engineCommand}`,
    "candidate:",
    "  version: 4",
    "  name: runtime-generic-execution",
    "  description: Candidate runner for the generic runtime benchmark.",
    "  files:",
    "    path: candidates/runtime-generic-execution/files",
    "  defaultRun: command",
    "  runs:",
    "    command:",
    "      name: Command",
    "      use: command",
    "      with:",
    `        command: ${runnerCommand}`,
    "  improve:",
    "    edits:",
    "      - prompt.md",
    "    use: codex",
    "    with:",
    "      model: gpt-5.4-mini",
    "",
  ].join("\n");
}

function runtimeSpecWithUnknownTopLevelField(): string {
  return [
    runtimeSpec().replace(
      "benchmark:",
      "experiments:\n  strict: true\nbenchmark:",
    ),
    "",
  ].join("\n");
}

async function scriptedAdapterManifest(id: string, source: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `workbench-${id}-adapter-`));
  const file = path.join(root, `${id}.mjs`);
  await fs.writeFile(file, source);
  return {
    id,
    protocol: "workbench.adapter.v3" as const,
    setup: [],
    operations: {
      "candidate.run": { command: `node ${shellWord(file)}` },
      "engine.run": { command: `node ${shellWord(file)}` },
      "candidate.improve": { command: `node ${shellWord(file)}` },
    },
  };
}

async function commandAdapterManifest() {
  return await scriptedAdapterManifest("command", `
import { spawnSync } from "node:child_process";
import fs from "node:fs";
const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, "utf8"));
const command = request.invocation?.with?.command;
if (typeof command !== "string" || command.length === 0) {
  throw new Error("command adapter requires invocation.with.command");
}
const result = spawnSync("sh", ["-c", command], {
  cwd: request.paths.workspace,
  env: process.env,
  stdio: "inherit",
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
const resultPath = process.env.WORKBENCH_RESULT || request.paths.result || \`\${request.paths.output}/workbench-result.json\`;
if (!fs.existsSync(resultPath)) {
  fs.writeFileSync(resultPath, JSON.stringify({
    protocol: "workbench.adapter-result.v1",
    operation: request.operation,
    ok: true
  }, null, 2) + "\\n");
}
`);
}

function workbenchEngineManifest() {
  return {
    id: "workbench",
    protocol: "workbench.adapter.v3" as const,
    setup: [],
    operations: {
      "engine.resolve": { command: "workbench-adapter-workbench" },
      "engine.run": { command: "workbench-adapter-workbench", executor: "host" as const },
    },
    slots: {
      score: { path: "/score", operation: "engine.run" as const },
    },
  };
}

async function scriptedRubricAdapter(args: {
  score: number;
  criteria?: Array<{
    criterion_id: string;
    score: number;
    pass: boolean;
    rationale: string;
  }>;
  summary?: string;
  feedback?: Record<string, unknown>;
}) {
  return scriptedAdapterManifest("rubric", `
import fs from "node:fs";
import path from "node:path";
const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, "utf8"));
const output = process.env.WORKBENCH_OUTPUT;
const criteria = ${JSON.stringify(args.criteria ?? [])};
const score = ${JSON.stringify(args.score)};
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "workbench-result.json"), JSON.stringify({
  protocol: "workbench.adapter-result.v1",
  operation: "engine.run",
  ok: true,
  value: {
    score,
    metrics: { score },
    ${args.summary ? `summary: ${JSON.stringify(args.summary)},` : ""}
    cases: [{ id: request.context?.attempt?.caseId ?? "current", status: "completed", metrics: { score }, criteria }],
    feedback: ${JSON.stringify(args.feedback ?? {})}
  }
}, null, 2));
`);
}

async function scriptedRunnerAdapter(id = "codex") {
  return scriptedAdapterManifest(id, `
import fs from "node:fs";
import path from "node:path";
const output = process.env.WORKBENCH_OUTPUT;
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "runner-summary.md"), "runner output\\n");
fs.writeFileSync(path.join(output, "workbench-result.json"), JSON.stringify({
  protocol: "workbench.adapter-result.v1",
  operation: "candidate.run",
  ok: true
}, null, 2));
`);
}

function shellWord(value: string): string {
  return `'${value.replace(/'/gu, "'\"'\"'")}'`;
}

function skillRunnerSpec(): string {
  return [
    "version: 4",
    "benchmark:",
    "  version: 4",
    "  name: runtime-skill-runner",
    "  description: Exercise an agent skill runner with rubric scoring.",
    "  engine:",
    "    use: workbench",
    "    with:",
    "      environment:",
    "        dockerfile: environment/Dockerfile",
    "      score:",
    "        use: rubric",
    "        with:",
    "          judge:",
    "            use: codex",
    "            with:",
    "              model: gpt-5.4-mini",
    "          criteria:",
    "            - id: useful",
    "              description: Output is useful.",
    "candidate:",
    "  version: 4",
    "  name: runtime-skill-runner",
    "  description: Candidate skill runner.",
    "  files:",
    "    path: candidates/invoice-review/files",
    "  defaultRun: codex",
    "  runs:",
    "    codex:",
    "      name: Codex",
    "      use: codex",
    "      with:",
    "        instructions: Run the skill for the current task.",
    "        model: gpt-5.4-mini",
    "  improve:",
    "    edits:",
    "      - SKILL.md",
    "    use: codex",
    "    with:",
    "      model: gpt-5.4-mini",
    "",
  ].join("\n");
}

function twoCriterionSkillRunnerSpec(): string {
  return skillRunnerSpec().replace(
    [
      "            - id: useful",
      "              description: Output is useful.",
    ].join("\n"),
    [
      "            - id: useful",
      "              description: Output is useful.",
      "            - id: complete",
      "              description: Output is complete.",
    ].join("\n"),
  );
}

function fiveCriterionSkillRunnerSpec(): string {
  return skillRunnerSpec().replace(
    [
      "            - id: useful",
      "              description: Output is useful.",
    ].join("\n"),
    [
      "            - id: useful",
      "              description: Output is useful.",
      "            - id: complete",
      "              description: Output is complete.",
      "            - id: format",
      "              description: Output is well formatted.",
      "            - id: accurate",
      "              description: Output is accurate.",
      "            - id: polished",
      "              description: Output is polished.",
    ].join("\n"),
  );
}

function workflowRunnerSpec(): string {
  return [
    "version: 4",
    "benchmark:",
    "  version: 4",
    "  name: runtime-workflow-runner",
    "  description: Exercise an agent workflow runner with rubric scoring.",
    "  engine:",
    "    use: workbench",
    "    with:",
    "      environment:",
    "        dockerfile: environment/Dockerfile",
    "      score:",
    "        use: rubric",
    "        with:",
    "          judge:",
    "            use: codex",
    "            with:",
    "              model: gpt-5.4-mini",
    "          criteria:",
    "            - id: useful",
    "              description: Output is useful.",
    "candidate:",
    "  version: 4",
    "  name: runtime-workflow-runner",
    "  description: Candidate workflow runner.",
    "  files:",
    "    path: candidates/runtime-workflow-runner/files",
    "  defaultRun: codex",
    "  runs:",
    "    codex:",
    "      name: Codex",
    "      use: codex",
    "      with:",
    "        instructions: Run the workflow for the current task.",
    "        model: gpt-5.4-mini",
    "  improve:",
    "    edits:",
    "      - workflow.yaml",
    "    use: codex",
    "    with:",
    "      model: gpt-5.4-mini",
    "",
  ].join("\n");
}

function textSurfaceFile(path: string, content: string): SurfaceSnapshotFile {
  return {
    path,
    kind: "text",
    encoding: "utf8",
    executable: false,
    content,
  };
}
