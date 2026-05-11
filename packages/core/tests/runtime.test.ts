import { describe, expect, test } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildCandidateLineage,
  buildWorkbenchProjectSourceFiles,
  createSyntheticProposalJob,
  createCaseReview,
  createProposalTraceInputFiles,
  createWorkbenchRunWorkload,
  createWorkbenchExecutionCapability,
  caseExecutionIds,
  executeAdapterInCurrentSandboxRuntime,
  expectedWorkbenchRunJobCount,
  extractExecutionUsageFromTrace,
  findEnvironmentVersionForImage,
  gradeJobCountForRunSpec,
  materializeWorkbenchRunResult,
  normalizeDockerImageRef,
  normalizeSurfaceFiles,
  planWorkbenchExecutionJobsForPurpose,
  resolveWorkbenchResolvedSourceYaml,
  selectCaseFilesForExecution,
  selectRunnerOutputFilesForGrading,
  stageWorkbenchRunWorkload,
  validateWorkbenchResolvedSourceYaml,
  workbenchTracePhaseDirectory,
  workbenchTraceRunDirectory,
  workbenchTraceRunDirectoryName,
  workloadTimeoutMs,
  type WorkbenchRunWorkload,
  type HostedWorkbenchJob,
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
  test("candidate lineage ignores self references", () => {
    const lineage = buildCandidateLineage({
      activeId: "cand_self",
      summaries: [{
        id: "cand_self",
        ordinal: 0,
        benchmarkFingerprint: "benchmark",
        candidateFingerprint: "cand_self",
        createdAt: "2026-01-01T00:00:00.000Z",
        baseId: "cand_self",
        referenceIds: ["cand_self"],
        status: "evaluated",
        fileChanges: [],
      }],
    });

    expect(lineage.edges).toEqual([]);
  });

  test("candidate lineage only links explicit improve bases", () => {
    const lineage = buildCandidateLineage({
      activeId: "cand_child",
      summaries: [
        {
          id: "cand_base",
          ordinal: 0,
          benchmarkFingerprint: "benchmark",
          candidateFingerprint: "cand_base",
          createdAt: "2026-01-01T00:00:00.000Z",
          referenceIds: [],
          status: "evaluated",
          fileChanges: [],
        },
        {
          id: "cand_reference_only",
          ordinal: 1,
          benchmarkFingerprint: "benchmark",
          candidateFingerprint: "cand_reference_only",
          createdAt: "2026-01-01T00:01:00.000Z",
          referenceIds: ["cand_base"],
          status: "evaluated",
          fileChanges: [],
        },
        {
          id: "cand_child",
          ordinal: 2,
          benchmarkFingerprint: "benchmark",
          candidateFingerprint: "cand_child",
          createdAt: "2026-01-01T00:02:00.000Z",
          baseId: "cand_base",
          referenceIds: ["cand_reference_only"],
          status: "evaluated",
          fileChanges: [],
        },
      ],
    });

    expect(lineage.edges).toEqual([{
      id: "anchor:cand_base:cand_child",
      kind: "anchor",
      sourceId: "cand_base",
      targetId: "cand_child",
    }]);
  });

  test("validates only the split benchmark/subject/optimizer authoring contract", () => {
    const validation = validateWorkbenchResolvedSourceYaml(runtimeSpec());

    expect(validation.ok).toBe(true);
    expect(resolveWorkbenchResolvedSourceYaml(runtimeSpec()).description).toBe("Exercise the generic command runner and grader runtime path.");
    expect(resolveWorkbenchResolvedSourceYaml(runtimeSpec()).run.with).toMatchObject({
      command: expect.stringContaining("runner-output.json"),
    });
    expect(validateWorkbenchResolvedSourceYaml(runtimeSpec().replace("version: 2", "version: 20")).ok).toBe(false);
    expect(validateWorkbenchResolvedSourceYaml(runtimeSpec().replace("  description: Exercise the generic command runner and grader runtime path.\n", "")).errors).toContain("benchmark.yaml.description must be a non-empty string.");
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

  test("stages only the phase-specific runtime input roots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-stage-"));
    try {
      await stageWorkbenchRunWorkload(root, stageWorkload("improve"));
      await expect(fs.access(path.join(root, "input", "candidate", "prompt.md"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(root, "input", "traces", "events", "prior.ndjson"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(root, "input", "task", "task.yaml"))).rejects.toBeTruthy();

      await stageWorkbenchRunWorkload(root, stageWorkload("trial"));
      await expect(fs.access(path.join(root, "input", "candidate", "prompt.md"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(root, "request.md"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(root, "tests", "secret.txt"))).rejects.toBeTruthy();
      await expect(fs.access(path.join(root, "input", "traces"))).rejects.toBeTruthy();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("projects task files before sandbox materialization", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const caseFiles = normalizeSurfaceFiles([
      { path: "case-001/task.yaml", content: "task: test\n" },
      { path: "case-001/files/request.md", content: "public\n" },
      { path: "case-001/tests/secret.txt", content: "hidden\n" },
    ]);
    const common = {
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      candidateId: "cand_runtime_001",
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval" as const,
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    };
    const [runJob] = planWorkbenchExecutionJobsForPurpose({ ...common, purpose: "trial" });
    const [gradeJob] = planWorkbenchExecutionJobsForPurpose({ ...common, purpose: "trial" });

    const runInputs = await createWorkbenchSandboxFileStore({
      job: runJob!,
      spec,
      baseFiles: [],
      caseFiles,
    }).materializeInputs(executionFromJob(runJob!));
    expect(runInputs.find((input) => input.input.name === "task")?.files.map((file) => file.path)).toEqual([
      "files/request.md",
      "tests/secret.txt",
    ]);

    const gradeInputs = await createWorkbenchSandboxFileStore({
      job: gradeJob!,
      spec,
      baseFiles: [],
      caseFiles,
    }).materializeInputs(executionFromJob(gradeJob!));
    expect(gradeInputs.find((input) => input.input.name === "task")?.files.map((file) => file.path)).toEqual([
      "files/request.md",
      "tests/secret.txt",
    ]);
  });

  test("creates hosted workloads from already selected case files", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const caseFiles = normalizeSurfaceFiles([
      { path: "case-001/task.yaml", content: "task: test\n" },
      { path: "case-001/files/request.md", content: "public\n" },
      { path: "case-001/tests/secret.txt", content: "hidden\n" },
    ]);
    const [runJob] = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      candidateId: "cand_runtime_001",
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    });

    const workload = createWorkbenchRunWorkload({
      job: runJob!,
      spec,
      baseFiles: [],
      caseFiles: selectCaseFilesForExecution(caseFiles, "case-001"),
    });

    expect(workload.caseFiles.map((file) => file.path)).toEqual([
      "files/request.md",
      "task.yaml",
      "tests/secret.txt",
    ]);

    const projectedWorkload = createWorkbenchRunWorkload({
      job: runJob!,
      spec,
      baseFiles: [],
      caseFiles: normalizeSurfaceFiles([{ path: "files/request.md", content: "public\n" }]),
    });
    expect(projectedWorkload.task?.task).toBe("test");
    expect(projectedWorkload.caseFiles.map((file) => file.path)).toEqual([
      "files/request.md",
    ]);
  });

  test("selects only non-internal runner output files for grading", () => {
    const files = normalizeSurfaceFiles([
      { path: "runner-summary.md", content: "summary" },
      { path: "outputs/result.json", content: "{}" },
      { path: "scorecard.json", content: "{}" },
      { path: ".workbench/traces/job/output.xlsx", encoding: "base64", content: "AA==" },
    ]);

    expect(selectRunnerOutputFilesForGrading(files).map((file) => file.path)).toEqual([
      "outputs/result.json",
      "runner-summary.md",
    ]);
  });

  test("builds synced project source files with candidate and task prefixes", () => {
    const files = buildWorkbenchProjectSourceFiles({
      specSource: "version: 2\nbenchmark:\n  version: 2\n  name: source-projection\n",
      candidatePath: "subjects/app/files",
      candidateFiles: normalizeSurfaceFiles([
        { path: "prompt.md", content: "candidate\n" },
        { path: "subjects/app/files/already-prefixed.md", content: "already\n" },
      ]),
      tasksPath: "tasks",
      taskFiles: normalizeSurfaceFiles([
        { path: "case-001/task.yaml", content: "task: Test\n" },
      ]),
      dockerfilePath: "environment/Dockerfile",
      dockerfile: "FROM node:22\n",
    });

    expect(files.map((file) => file.path)).toEqual([
      "benchmark.yaml",
      "environment/Dockerfile",
      "subjects/app/files/already-prefixed.md",
      "subjects/app/files/prompt.md",
      "tasks/case-001/task.yaml",
    ]);
  });

  test("builds proposal trace input files from generic job events and summaries", () => {
    const now = "2026-04-27T00:00:00.000Z";
    const job = runningJob({
      id: "job_exec_run_trial_000_case_case_001_sample_000_run",
      projectId: "project_runtime",
      runId: "run_trace_history",
      candidateId: "cand_trace_001",
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
          candidateId: "cand_trace_001",
          purpose: "trial",
          adapter: { use: "command", with: { command: "true" } },
          sandbox: { kind: "snapshot", ref: "workbench/test" },
          inputs: [],
          outputs: [],
          policy: { resources: { cpu: 1, memoryGb: 1, diskGb: 1, timeoutMinutes: 1 }, network: { egress: "none" } },
          metadata: {},
        },
        trialIndex: 0,
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
        purpose: "trial",
        candidateId: "cand_trace_001",
        trialIndex: 0,
        sampleIndex: 0,
        caseId: "case-001",
        files: normalizeSurfaceFiles([
          { path: "runner-summary.md", content: "done\n" },
          { path: `.workbench/traces/${job.id}/runner/session/events.ndjson`, content: "{\"event\":\"done\"}\n" },
        ]),
        traces: [`.workbench/traces/${job.id}/runner/session/events.ndjson`],
      },
    } as HostedWorkbenchJob;
    const files = createProposalTraceInputFiles({
      runId: "run_trace_history",
      jobs: [completed],
      events: [{
        id: "evt_progress_trace",
        type: "job_progress",
        at: now,
        runId: "run_trace_history",
        jobId: job.id,
        status: "succeeded",
        detail: { message: "progress" },
      }],
    });

    expect(files.map((file) => file.path).sort()).toEqual([
      `.workbench/traces/${job.id}/runner/session/events.ndjson`,
      `events/${job.id}.ndjson`,
      `jobs/${job.id}.json`,
      "manifest.json",
    ]);
    expect(files.find((file) => file.path === "manifest.json")?.content).toContain("run_trace_history");
    expect(files.find((file) => file.path === `events/${job.id}.ndjson`)?.content).toContain("evt_progress_trace");
  });

  test("formats chronological run trace directories with typed phase subdirectories", () => {
    expect(workbenchTraceRunDirectoryName({
      sequence: 7,
      runId: "run trace/history",
    })).toBe("000007-run_trace_history");
    expect(workbenchTraceRunDirectory({
      sequence: 7,
      runId: "run trace/history",
    })).toBe(".workbench/traces/000007-run_trace_history");
    expect(workbenchTracePhaseDirectory({
      sequence: 7,
      runId: "run trace/history",
      phase: "trial",
    })).toBe(".workbench/traces/000007-run_trace_history/000009-trial");
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

  test("executes generic run and grade jobs through the sandbox backend and materializes the run", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "cand_runtime_001";
    const baseFiles = normalizeSurfaceFiles([{
      path: "prompt.md",
      content: "base candidate\n",
    }]);
    const caseFiles = normalizeSurfaceFiles([{
      path: "case-001/task.yaml",
      content: "task: Score the candidate.\n",
    }]);
    const proposal = createSyntheticProposalJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      candidateId,
      files: baseFiles,
      now,
      baseId: null,
      trialIndex: 0,
    });
    const runnerJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      candidateId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    });
    const graderJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      candidateId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    });

    expect(runnerJobs).toHaveLength(1);
    expect(graderJobs).toHaveLength(1);
    expect(runnerJobs[0]?.id).toBe(graderJobs[0]?.id);
    expect(runnerJobs.map((job) => job.kind)).toEqual(["execute"]);

    const commandManifest = await commandAdapterManifest();
    const runningRunner = runningJob(runnerJobs[0]!, now);
    const runnerExecution = executionFromJob(runningRunner);
    const progress = await tryCreateProgressCaptureServer();
    let completedRunner: HostedWorkbenchJob | null = null;
    try {
      completedRunner = await executeAdapterInCurrentSandboxRuntime({
        job: runningRunner,
        spec,
        adapterManifests: [commandManifest],
        baseFiles,
        caseFiles,
        progress: progress ? {
          url: progress.url,
          token: "progress-token",
          ownerUserId: "user_runtime",
          flushWindowMs: 0,
        } : undefined,
      }, runnerExecution, now, createWorkbenchExecutionCapability(runnerExecution, { now }));
      if (progress) {
        expect(progress.requests.map((request) => request.progressToken)).toEqual([
          "progress-token",
          "progress-token",
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
            role: "runner",
            schema: "workbench.execution.phase.v1",
            payload: { phase: "run", status: "started" },
          },
          {
            source: "command",
            role: "runner",
            schema: "workbench.execution.phase.v1",
            payload: { phase: "run", status: "succeeded" },
          },
          {
            source: "command",
            role: "grader",
            schema: "workbench.execution.phase.v1",
            payload: { phase: "score", status: "started" },
          },
          {
            source: "command",
            role: "grader",
            schema: "workbench.execution.phase.v1",
            payload: { phase: "score", status: "succeeded" },
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
            schema: "workbench.execution.phase.v1",
            payload: { phase: "run", status: "succeeded" },
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
      jobs: [proposal, completedRunner],
      existingCandidateCount: 0,
    });

    expect(materialized.activeCandidateId).toBe(candidateId);
    expect(materialized.candidates).toHaveLength(1);
    expect(materialized.candidates[0]?.metrics?.score).toBe(0.91);
    expect(materialized.candidates[0]?.eval?.samples[0]?.cases).toBeUndefined();
    expect(materialized.completedJobCount).toBe(2);
    expect(materialized.evaluations[0]?.evaluation.subject.id).toBe(candidateId);
  });

  test("materializes only subject source files into subject snapshots", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "cand_runtime_001";
    const proposal = createSyntheticProposalJob({
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
      trialIndex: 0,
    });
    const gradeJob: HostedWorkbenchJob = {
      id: "job_exec_run_runtime_trial_000_current_sample_000_grade",
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
        trialIndex: 0,
        sampleIndex: 0,
        execution: {
          id: "exec_run_runtime_trial_000_current_sample_000_grade",
          purpose: "trial",
          adapter: { use: "command", with: { command: "node grade.js" } },
          inputs: [],
          outputs: [],
        },
      } as unknown as HostedWorkbenchJob["input"],
      output: {
        ok: true,
        candidateId,
        trialIndex: 0,
        sampleIndex: 0,
        scorecard: { score: 0.9 },
        fileChanges: ["scorecard.json"],
        files: [
          {
            path: "scorecard.json",
            kind: "text",
            encoding: "utf8",
            content: "{\"score\":0.9}\n",
            executable: false,
          },
          {
            path: ".workbench/traces/job_exec_run_runtime_trial_000_current_sample_000_grade/scorecard.json",
            kind: "text",
            encoding: "utf8",
            content: "{\"score\":0.9,\"source\":\"grader-output\"}\n",
            executable: false,
          },
        ],
        sample: {
          id: "sample_001",
          index: 0,
          subject: { id: candidateId, kind: "candidate" },
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
      jobs: [proposal, gradeJob],
      existingCandidateCount: 0,
    });

    expect(materialized.candidateFiles[candidateId]?.map((file) => file.path)).toEqual([
      "prompt.md",
      "reports/source-note.md",
    ]);
  });

  test("materialized candidate baseId comes only from explicit improve proposal output", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const proposal = createSyntheticProposalJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      candidateId: "cand_runtime_002",
      files: normalizeSurfaceFiles([{ path: "prompt.md", content: "base candidate\n" }]),
      now,
      baseId: null,
      trialIndex: 0,
    });
    const materialized = materializeWorkbenchRunResult({
      runId: "run_runtime",
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      startedAt: now,
      spec,
      jobs: [proposal],
      previousCandidate: {
        id: "cand_previous",
        ordinal: 0,
        benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
        candidateFingerprint: "cand_previous",
        createdAt: now,
        referenceIds: [],
        status: "evaluated",
        fileChanges: [],
      },
      existingCandidateCount: 1,
    });

    expect(materialized.candidates[0]?.baseId).toBeUndefined();
  });

  test("materializes invalid sample statuses as an error sample", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "cand_invalid_status";
    const proposal = createSyntheticProposalJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_invalid_status",
      candidateId,
      files: normalizeSurfaceFiles([{ path: "prompt.md", content: "candidate" }]),
      now,
      baseId: null,
      trialIndex: 0,
    });
    const gradeJob: HostedWorkbenchJob = {
      ...runningJob({
        id: "job_invalid_grade",
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
          trialIndex: 0,
          sampleIndex: 0,
          caseId: "case-001",
          execution: {
            id: "exec_invalid_grade",
            purpose: "trial",
            adapter: { use: "command", with: { command: "node grade.js" } },
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
        trialIndex: 0,
        fileChanges: [],
        sample: {
          id: "sample_001",
          index: 0,
          subject: { id: candidateId, kind: "candidate" },
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
      jobs: [proposal, gradeJob],
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
    const candidateId = "cand_two_cases_one_sample";
    const proposal = createSyntheticProposalJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_two_cases_one_sample",
      candidateId,
      files: normalizeSurfaceFiles([{ path: "prompt.md", content: "candidate" }]),
      now,
      baseId: null,
      trialIndex: 0,
    });
    const caseFiles = normalizeSurfaceFiles([
      { path: "case-a/task.yaml", content: "task: A\n" },
      { path: "case-b/task.yaml", content: "task: B\n" },
    ]);
    const gradeJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_two_cases_one_sample",
      candidateId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    });
    const completedGrades = gradeJobs.map((job, index): HostedWorkbenchJob => {
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
          trialIndex: 0,
          fileChanges: [],
          files: normalizeSurfaceFiles([{
            path: `${caseId}/scorecard.json`,
            content: JSON.stringify({ score }),
          }]),
          traces: [],
          sample: {
            id: `${caseId}__sample_001`,
            index: 0,
            subject: { id: candidateId, kind: "candidate" },
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
      jobs: [proposal, ...completedGrades],
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

  test("case reviews expose scoring and phases without file or log side channels", () => {
    const candidate = {
      id: "cand_phase_review",
      ordinal: 1,
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      candidateFingerprint: "cand_phase_review",
      createdAt: "2026-04-27T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
      eval: {
        subject: { kind: "candidate", id: "cand_phase_review" },
        status: "completed",
        sampleCount: 1,
        completedSampleCount: 1,
        errorSampleCount: 0,
        samples: [{
          id: "sample_001",
          index: 0,
          subject: { kind: "candidate", id: "cand_phase_review" },
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

  test("case reviews use phase sample identity when materialized samples share a case id", () => {
    const candidate = {
      id: "cand_phase_review",
      ordinal: 1,
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      candidateFingerprint: "cand_phase_review",
      createdAt: "2026-04-27T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
      eval: {
        subject: { kind: "candidate", id: "cand_phase_review" },
        status: "completed",
        sampleCount: 2,
        completedSampleCount: 2,
        errorSampleCount: 0,
        samples: [
          {
            id: "task-001__sample_001",
            index: 0,
            subject: { kind: "candidate", id: "cand_phase_review" },
            status: "completed",
            metrics: { score: 0.25 },
            cases: [{ id: "task-001", status: "completed", metrics: { score: 0.25 } }],
          },
          {
            id: "task-001__sample_002",
            index: 1,
            subject: { kind: "candidate", id: "cand_phase_review" },
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
      phases: [{
        runId: "run_001",
        phase: "trial",
        role: "runner",
        status: "succeeded",
        jobIds: ["job_001"],
        sampleIndex: 1,
      }],
    });

    expect(review.sampleId).toBe("task-001__sample_002");
    expect(review.sampleIndex).toBe(1);
    expect(review.metrics.score).toBe(0.75);
  });

  test("case reviews expose phase-only task state through the shared helper", () => {
    const review = createCaseReview({
      candidate: {
        id: "cand_phase_only",
        ordinal: 1,
        benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
        candidateFingerprint: "cand_phase_only",
        createdAt: "2026-04-27T00:00:00.000Z",
        referenceIds: [],
        status: "running",
        fileChanges: [],
      } as Parameters<typeof createCaseReview>[0]["candidate"],
      caseId: "task-001",
      phases: [{
        runId: "run_001",
        phase: "trial",
        role: "runner",
        status: "running",
        jobIds: ["job_001"],
        sampleIndex: 0,
      }],
    });

    expect(review.caseId).toBe("task-001");
    expect(review.sampleIndex).toBe(0);
    expect(review.metrics).toEqual({});
    expect(review.criteria_results).toEqual([]);
    expect(review.phases).toHaveLength(1);
  });

  test("rejects unknown top-level source fields", () => {
    const validation = validateWorkbenchResolvedSourceYaml(runtimeSpecWithUnknownTopLevelField());

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("resolved Workbench source includes unsupported field: experiments.");
  });

  test("executes a skill runner as agent-produced output without an OCI environment", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(skillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "cand_skill_001";
    const baseFiles = normalizeSurfaceFiles([{
      path: "invoice-review/SKILL.md",
      content: "---\nname: invoice-review\ndescription: Review invoices.\n---\n\n# Invoice Review\n",
    }]);
    const largeFilingText = "large filing body\n".repeat(100_000);
    const caseFiles = normalizeSurfaceFiles([
      {
        path: "case-001/task.yaml",
        content: "task: Review this invoice fixture.\n",
      },
      {
        path: "case-001/input/prompt.md",
        content: "Review this invoice fixture.\n",
      },
      {
        path: "case-001/input/filing/raw/primary_document.htm",
        content: largeFilingText,
      },
    ]);
    const runnerJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_skill_runtime",
      candidateId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    });
    const graderJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_skill_runtime",
      candidateId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    });
    const runningRunner = runningJob(runnerJobs[0]!, now);
    const runnerExecution = executionFromJob(runningRunner);
    const runnerTraceFiles = normalizeSurfaceFiles([{
      path: `.workbench/traces/${runningRunner.id}/runner/session/events.ndjson`,
      content: "{\"event\":\"done\"}\n",
    }]);
    let runnerAttempts = 0;
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
const traceId = request.execution.jobId || request.execution.id;
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "runner-summary.md"), "skill output from runner");
fs.mkdirSync(path.join(output, ".workbench", "traces", traceId, "runner", "session"), { recursive: true });
fs.writeFileSync(path.join(output, ".workbench", "traces", traceId, "runner.json"), "{}\\n");
fs.writeFileSync(path.join(output, ".workbench", "traces", traceId, "runner", "session", "events.ndjson"), "{\\"event\\":\\"done\\"}\\n");
fs.mkdirSync(path.join(output, ".workbench"), { recursive: true });
fs.writeFileSync(path.join(output, ".workbench", "result.json"), JSON.stringify({
  summary: "skill output from runner",
  usage: ${JSON.stringify(runnerUsage)}
}, null, 2));
`);
    const graderUsage = {
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
fs.writeFileSync(path.join(output, "scorecard.json"), JSON.stringify({
  score: 0.88,
  metrics: { score: 0.88 },
  cases: [{ id: request.execution.caseId, status: "completed", metrics: { score: 0.88 } }],
  usage: {
    grader: ${JSON.stringify(graderUsage.total)},
    total: ${JSON.stringify(graderUsage.total)}
  },
  feedback: { metadata: {} }
}, null, 2));
`);
    const completedRunner = await executeAdapterInCurrentSandboxRuntime({
      job: runningRunner,
      spec,
      adapterManifests: [codexAdapter, rubricAdapter],
      baseFiles,
      caseFiles,
    }, runnerExecution, now, createWorkbenchExecutionCapability(runnerExecution, { now }));

    expect(completedRunner.error).toBeUndefined();
    expect(completedRunner.status).toBe("succeeded");
    const runnerOutputPaths = completedOutputFiles(completedRunner).map((file) => file.path);
    expect(runnerOutputPaths).toContain("runner-summary.md");
    expect(runnerOutputPaths.some((filePath) => filePath.startsWith(".workbench/internal/"))).toBe(false);
    expect((completedRunner.output as { usage?: { runner?: { costUsd?: number } } }).usage?.runner?.costUsd).toBe(0.0042);
    expect((completedRunner.output as { traces?: string[] }).traces).toEqual([
      `.workbench/traces/000001-run_skill_runtime/000009-trial/${runningRunner.id}/runner.json`,
      `.workbench/traces/000001-run_skill_runtime/000009-trial/${runningRunner.id}/runner/session/events.ndjson`,
    ]);

    const completedGrader = completedRunner;
    expect(completedGrader.error).toBeUndefined();
    expect(completedGrader.status).toBe("succeeded");
    expect(completedScore(completedGrader)).toBe(0.88);
    expect((completedGrader.output as { usage?: { runner?: { costUsd?: number } } }).usage?.runner?.costUsd).toBe(0.0042);
    expect((completedGrader.output?.scorecard as { feedback?: { metadata?: { usage?: unknown } } } | undefined)?.feedback?.metadata?.usage).toBeUndefined();
    expect((completedGrader.output?.scorecard as { cases?: Array<{ id?: string }> } | undefined)?.cases?.[0]?.id).toBe("case-001");
    const proposal = createSyntheticProposalJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_skill_runtime",
      candidateId,
      files: baseFiles,
      now,
      baseId: null,
      trialIndex: 0,
    });
    const proposalWithUsage = {
      ...proposal,
      output: {
        ...(proposal.output as Record<string, unknown>),
        usage: {
          optimizer: {
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
      jobs: [proposalWithUsage, completedRunner],
      existingCandidateCount: 0,
    });
    expect(materialized.candidates[0]?.usage?.optimizer?.costUsd).toBe(0.002);
    expect(materialized.candidates[0]?.usage?.runner?.costUsd).toBeUndefined();
    expect(materialized.candidates[0]?.usage?.grader?.costUsd).toBe(0.0042);
    expect(materialized.candidates[0]?.usage?.total?.costUsd).toBe(0.0062);
    expect(materialized.candidates[0]?.eval?.usage?.total?.costUsd?.mean).toBe(0.0042);
    expect(materialized.candidates[0]?.eval?.usage?.total?.totalTokens?.mean).toBe(1_200);
    expect(materialized.candidates[0]?.eval?.usage?.runner?.costUsd?.mean).toBeUndefined();
    expect(materialized.candidates[0]?.eval?.usage?.grader?.costUsd?.mean).toBe(0.0042);
    expect(materialized.evaluations[0]?.usage?.total?.costUsd?.mean).toBe(0.0042);
  });

  test("uses criterion scores when rubric judges return an unnormalized top-level score", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(skillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const caseFiles = normalizeSurfaceFiles([{
      path: "case-001/task.yaml",
      content: "task: Review this invoice fixture.\n",
    }]);
    const graderJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_rubric_normalization",
      candidateId: "cand_skill_001",
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    });
    const runningGrader = runningJob(graderJobs[0]!, now);
    const graderExecution = executionFromJob(runningGrader);
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
    const completedGrader = await executeAdapterInCurrentSandboxRuntime({
      job: runningGrader,
      spec,
      adapterManifests: [runnerAdapter, rubricAdapter],
      baseFiles: normalizeSurfaceFiles([{ path: "SKILL.md", content: "Use the skill.\n" }]),
      caseFiles,
      runnerOutputFiles: normalizeSurfaceFiles([{ path: "runner-summary.md", content: "Hidden runner file body.\n" }]),
    }, graderExecution, now, createWorkbenchExecutionCapability(graderExecution, { now }));

    expect(completedGrader.error).toBeUndefined();
    expect(completedGrader.status).toBe("succeeded");
    expect(completedScore(completedGrader)).toBe(0.4);
    const scorecard = completedGrader.output?.scorecard as { cases?: Array<{ status?: string; criteria?: Array<{ rationale?: string }> }> } | undefined;
    expect(scorecard?.cases?.[0]?.status).toBe("completed");
    expect(scorecard?.cases?.[0]?.criteria?.[0]?.rationale).toBe("The runner output missed the required output.");
  });

  test("repairs malformed rubric judge JSON with one bounded judge turn", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(skillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const caseFiles = normalizeSurfaceFiles([{
      path: "case-001/task.yaml",
      content: "task: Review this invoice fixture.\n",
    }]);
    const graderJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_rubric_repair",
      candidateId: "cand_skill_001",
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    });
    const runningGrader = runningJob(graderJobs[0]!, now);
    const graderExecution = executionFromJob(runningGrader);
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
    const completedGrader = await executeAdapterInCurrentSandboxRuntime({
      job: runningGrader,
      spec,
      adapterManifests: [runnerAdapter, rubricAdapter],
      baseFiles: normalizeSurfaceFiles([{ path: "SKILL.md", content: "Use the skill.\n" }]),
      caseFiles,
      runnerOutputFiles: normalizeSurfaceFiles([{ path: "runner-summary.md", content: "Hidden runner file body.\n" }]),
    }, graderExecution, now, createWorkbenchExecutionCapability(graderExecution, { now }));

    expect(completedGrader.error).toBeUndefined();
    expect(completedGrader.status).toBe("succeeded");
    expect(completedScore(completedGrader)).toBe(0.82);
    const scorecard = completedGrader.output?.scorecard as { feedback?: { metadata?: { repair?: { attempted?: boolean; originalError?: string } } } } | undefined;
    expect(scorecard?.feedback?.metadata?.repair?.attempted).toBe(true);
    expect(scorecard?.feedback?.metadata?.repair?.originalError).toContain("must parse as a JSON object");
  });

  test("accepts rubric repair JSON with invalid string escapes", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(skillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const caseFiles = normalizeSurfaceFiles([{
      path: "case-001/task.yaml",
      content: "task: Review this invoice fixture.\n",
    }]);
    const graderJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_rubric_escape_repair",
      candidateId: "cand_skill_001",
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    });
    const runningGrader = runningJob(graderJobs[0]!, now);
    const graderExecution = executionFromJob(runningGrader);
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
    const completedGrader = await executeAdapterInCurrentSandboxRuntime({
      job: runningGrader,
      spec,
      adapterManifests: [runnerAdapter, rubricAdapter],
      baseFiles: normalizeSurfaceFiles([{ path: "SKILL.md", content: "Use the skill.\n" }]),
      caseFiles,
      runnerOutputFiles: normalizeSurfaceFiles([{ path: "runner-summary.md", content: "Hidden runner file body.\n" }]),
    }, graderExecution, now, createWorkbenchExecutionCapability(graderExecution, { now }));

    expect(completedGrader.error).toBeUndefined();
    expect(completedGrader.status).toBe("succeeded");
    expect(completedScore(completedGrader)).toBe(0.82);
    const scorecard = completedGrader.output?.scorecard as { cases?: Array<{ criteria?: Array<{ rationale?: string }> }> } | undefined;
    expect(scorecard?.cases?.[0]?.criteria?.[0]?.rationale).toBe("The workbook references C:\\Temp\\model and remains usable.");
  });

  test("runs one rubric grader job per sample and materializes all criteria", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(fiveCriterionSkillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "cand_skill_001";
    const baseFiles = normalizeSurfaceFiles([{ path: "SKILL.md", content: "Use the skill.\n" }]);
    const caseFiles = normalizeSurfaceFiles([{
      path: "case-001/task.yaml",
      content: "task: Review this invoice fixture.\n",
    }]);
    const runnerJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_single_rubric_grade",
      candidateId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    });
    const graderJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_single_rubric_grade",
      candidateId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    });
    expect(graderJobs).toHaveLength(1);
    expect(gradeJobCountForRunSpec(spec)).toBe(1);
    expect(expectedWorkbenchRunJobCount({
      workflow: "eval",
      budget: 1,
      samples: 1,
      caseCount: caseExecutionIds(caseFiles).length,
      gradeJobCount: gradeJobCountForRunSpec(spec),
    })).toBe(2);
    expect(Object.keys(executionFromJob(graderJobs[0]!).metadata)).toEqual([
      "trialIndex",
      "sampleIndex",
      "caseId",
      "task",
      "scoreAdapter",
    ]);

    const completedRunner = {
      ...runningJob(runnerJobs[0]!, now),
      status: "succeeded" as const,
      attempt: 1,
      startedAt: now,
      finishedAt: now,
      updatedAt: now,
      output: {
        ok: true,
        purpose: "trial",
        candidateId,
        trialIndex: 0,
        sampleIndex: 0,
        caseId: "case-001",
        fileChanges: ["runner-summary.md"],
        files: normalizeSurfaceFiles([
          { path: "runner-summary.md", content: "runner output\n" },
        ]),
        traces: [],
      },
    };

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
    const runningGrader = runningJob(graderJobs[0]!, now);
    const graderExecution = executionFromJob(runningGrader);
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
    const completedGrader = await executeAdapterInCurrentSandboxRuntime({
      job: runningGrader,
      spec,
      adapterManifests: [runnerAdapter, rubricAdapter],
      baseFiles,
      caseFiles,
      runnerOutputFiles: completedOutputFiles(completedRunner),
    }, graderExecution, now, createWorkbenchExecutionCapability(graderExecution, { now }));

    expect(completedGrader.status).toBe("succeeded");
    const { files: _files, ...hostedStyleGraderOutput } =
      completedGrader.output as Record<string, unknown>;
    const hostedStyleCompletedGrader = {
      ...completedGrader,
      output: hostedStyleGraderOutput,
    };
    const proposal = createSyntheticProposalJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_single_rubric_grade",
      candidateId,
      files: baseFiles,
      now,
      baseId: null,
      trialIndex: 0,
    });
    const materialized = materializeWorkbenchRunResult({
      runId: "run_single_rubric_grade",
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      startedAt: now,
      spec,
      jobs: [proposal, completedRunner, hostedStyleCompletedGrader],
      existingCandidateCount: 0,
    });
    const sample = materialized.candidates[0]?.eval?.samples[0];
    expect(materialized.candidates[0]?.metrics?.score).toBe(0.7);
    expect(sample?.cases?.[0]?.criteria?.map((criterion) => criterion.criterion_id))
      .toEqual(["useful", "complete", "format", "accurate", "polished"]);
    expect(sample?.cases?.[0]?.criteria?.map((criterion) => criterion.score))
      .toEqual([1, 0.5, 0.75, 0.25, 1]);
  });

  test("materializes a failed rubric grader as one error case sample", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(twoCriterionSkillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "cand_failed_rubric_grade";
    const baseFiles = normalizeSurfaceFiles([{ path: "SKILL.md", content: "Use the skill.\n" }]);
    const caseFiles = normalizeSurfaceFiles([{
      path: "case-001/task.yaml",
      content: "task: Review this invoice fixture.\n",
    }]);
    const proposal = createSyntheticProposalJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_failed_rubric_grade",
      candidateId,
      files: baseFiles,
      now,
      baseId: null,
      trialIndex: 0,
    });
    const runnerJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_failed_rubric_grade",
      candidateId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    });
    const graderJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_failed_rubric_grade",
      candidateId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    });
    expect(graderJobs).toHaveLength(1);
    expect(gradeJobCountForRunSpec(spec)).toBe(1);
    const completedRunner = {
      ...runningJob(runnerJobs[0]!, now),
      status: "succeeded" as const,
      attempt: 1,
      finishedAt: now,
      updatedAt: now,
      output: {
        ok: true,
        purpose: "trial",
        candidateId,
        trialIndex: 0,
        sampleIndex: 0,
        caseId: "case-001",
        files: normalizeSurfaceFiles([
          { path: "runner-summary.md", content: "runner output\n" },
        ]),
      },
    };
    const failedGrader = {
      ...runningJob(graderJobs[0]!, now),
      status: "failed" as const,
      attempt: 1,
      finishedAt: now,
      updatedAt: now,
      error: "grader failed",
      output: { ok: false },
    };

    const materialized = materializeWorkbenchRunResult({
      runId: "run_failed_rubric_grade",
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      startedAt: now,
      spec,
      jobs: [proposal, completedRunner, failedGrader],
      existingCandidateCount: 0,
    });

    const evalRecord = materialized.candidates[0]?.eval;
    const sample = evalRecord?.samples[0];
    expect(evalRecord?.sampleCount).toBe(1);
    expect(evalRecord?.errorSampleCount).toBe(1);
    expect(sample?.id).toBe("case-001__sample_001");
    expect(sample?.status).toBe("error");
    expect(sample?.cases?.[0]?.id).toBe("case-001");
    expect(sample?.cases?.[0]?.status).toBe("error");
    expect(sample?.error).toContain("grader failed");
  });

  test("executes a pipeline candidate with the generic agent runner", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(pipelineRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const candidateId = "cand_pipeline_001";
    const baseFiles = normalizeSurfaceFiles([{
      path: "pipeline.yaml",
      content: [
        "metadata:",
        "  id: runtime-pipeline",
        "  name: Runtime Pipeline",
        "hooks:",
        "  beforeRun: |",
        "    printf 'pipeline runner completed\\n' > pipeline-output.log",
        "stages: []",
        "",
      ].join("\n"),
    }]);
    const caseFiles = normalizeSurfaceFiles([{
      path: "case-001/task.yaml",
      content: "task: Run the pipeline.\n",
    }]);
    const runnerJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_pipeline_runtime",
      candidateId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    });
    const graderJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_pipeline_runtime",
      candidateId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: caseExecutionIds(caseFiles),
      caseFiles,
      now,
    });
    const runningRunner = runningJob(runnerJobs[0]!, now);
    const runnerExecution = executionFromJob(runningRunner);
    const codexAdapter = await scriptedAdapterManifest("codex", `
import fs from "node:fs";
import path from "node:path";
const output = process.env.WORKBENCH_OUTPUT;
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "scratch.tmp"), "scratch\\n");
fs.writeFileSync(path.join(output, "runner-summary.md"), "pipeline agent runner completed");
`);
    const rubricAdapter = await scriptedRubricAdapter({ score: 0.77 });
    const completedRunner = await executeAdapterInCurrentSandboxRuntime({
      job: runningRunner,
      spec,
      adapterManifests: [codexAdapter, rubricAdapter],
      baseFiles,
      caseFiles,
    }, runnerExecution, now, createWorkbenchExecutionCapability(runnerExecution, { now }));

    expect(completedRunner.error).toBeUndefined();
    expect(completedRunner.status).toBe("succeeded");
    const outputFiles = completedOutputFiles(completedRunner);
    expect(outputFiles.map((file) => file.path)).toContain("runner-summary.md");
    expect(outputFiles.some((file) => file.path.startsWith(".workbench/internal/"))).toBe(false);
    expect(outputFiles.map((file) => file.path)).toContain("scratch.tmp");
    expect(outputFiles.find((file) => file.path === "runner-summary.md")?.content).toContain("pipeline agent runner completed");

    const runningGrader = runningJob(graderJobs[0]!, now);
    const graderExecution = executionFromJob(runningGrader);
    const completedGrader = await executeAdapterInCurrentSandboxRuntime({
      job: runningGrader,
      spec,
      adapterManifests: [codexAdapter, rubricAdapter],
      baseFiles,
      caseFiles,
      runnerOutputFiles: outputFiles,
    }, graderExecution, now, createWorkbenchExecutionCapability(graderExecution, { now }));
    expect(completedGrader.error).toBeUndefined();
    expect(completedGrader.status).toBe("succeeded");
    expect(completedScore(completedGrader)).toBe(0.77);
  });

});

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
  const scorecard = output.scorecard && typeof output.scorecard === "object" && !Array.isArray(output.scorecard)
    ? output.scorecard as Record<string, unknown>
    : {};
  return typeof scorecard.score === "number" ? scorecard.score : undefined;
}

function stageWorkload(purpose: "improve" | "run-task" | "grade-task" | "trial"): WorkbenchRunWorkload {
  const now = "2026-04-27T00:00:00.000Z";
  return {
    job: {
      id: `job_${purpose}`,
      projectId: "proj_test",
      runId: "run_test",
      candidateId: "cand_test",
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
    candidateId: "cand_test",
    trialIndex: 0,
    sampleIndex: 0,
    caseId: "case-001",
    candidateFiles: normalizeSurfaceFiles([{ path: "prompt.md", content: "candidate" }]),
    caseFiles: normalizeSurfaceFiles([
      { path: "task.yaml", content: "task: test" },
      { path: "files/request.md", content: "public request\n" },
      { path: "tests/secret.txt", content: "hidden\n" },
    ]),
    traceFiles: normalizeSurfaceFiles([{ path: "events/prior.ndjson", content: "{\"event\":\"prior\"}\n" }]),
    task: { id: "case-001", task: "test" },
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
  const graderCommand = JSON.stringify(`node -e ${JSON.stringify([
    "const fs=require('fs');",
    "fs.mkdirSync('output',{recursive:true});",
    "fs.writeFileSync('output/scorecard.json',JSON.stringify({score:0.91,summary:'Generic runtime path passed.'},null,2));",
  ].join(""))}`);
  return [
    "version: 2",
    "benchmark:",
    "  version: 2",
    "  name: runtime-generic-execution",
    "  description: Exercise the generic command runner and grader runtime path.",
    "  tasks: tasks",
    "  environment:",
    "    dockerfile: environment/Dockerfile",
    "    resources:",
    "      cpu: 1",
    "      memoryGb: 1",
    "      timeoutMinutes: 5",
    "    network:",
    "      egress: none",
    "  score:",
    "    use: command",
    "    with:",
    `      command: ${graderCommand}`,
    "subject:",
    "  version: 2",
    "  name: runtime-generic-execution",
    "  description: Subject runner for the generic runtime benchmark.",
    "  path: subjects/runtime-generic-execution/files",
    "  run:",
    "    use: command",
    "    with:",
    `      command: ${runnerCommand}`,
    "optimizer:",
    "  version: 2",
    "  name: runtime-generic-optimizer",
    "  edits:",
    "    - prompt.md",
    "  improve:",
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
    protocol: "workbench.adapter.v1" as const,
    setup: [],
    command: `node ${shellWord(file)}`,
  };
}

async function commandAdapterManifest() {
  return await scriptedAdapterManifest("command", `
import { spawnSync } from "node:child_process";
import fs from "node:fs";
const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, "utf8"));
const command = request.adapter?.with?.command;
if (typeof command !== "string" || command.length === 0) {
  throw new Error("command adapter requires adapter.with.command");
}
const result = spawnSync("sh", ["-lc", command], {
  cwd: request.paths.workspace,
  env: process.env,
  stdio: "inherit",
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
fs.mkdirSync(\`\${request.paths.output}/.workbench\`, { recursive: true });
fs.writeFileSync(\`\${request.paths.output}/.workbench/result.json\`, JSON.stringify({ ok: true }, null, 2) + "\\n");
`);
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
fs.writeFileSync(path.join(output, "scorecard.json"), JSON.stringify({
  score,
  metrics: { score },
  ${args.summary ? `summary: ${JSON.stringify(args.summary)},` : ""}
  cases: [{ id: request.execution.caseId, status: "completed", metrics: { score }, criteria }],
  feedback: ${JSON.stringify(args.feedback ?? {})}
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
`);
}

function shellWord(value: string): string {
  return `'${value.replace(/'/gu, "'\"'\"'")}'`;
}

function skillRunnerSpec(): string {
  return [
    "version: 2",
    "benchmark:",
    "  version: 2",
    "  name: runtime-skill-runner",
    "  description: Exercise an agent skill runner with rubric grading.",
    "  tasks: tasks",
    "  environment:",
    "    dockerfile: environment/Dockerfile",
    "  score:",
    "    use: rubric",
    "    with:",
    "      judge:",
    "        use: codex",
    "        with:",
    "          model: gpt-5.4-mini",
    "      criteria:",
    "        - id: useful",
    "          description: Output is useful.",
    "subject:",
    "  version: 2",
    "  name: runtime-skill-runner",
    "  description: Candidate skill runner.",
    "  path: subjects/invoice-review/files",
    "  run:",
    "    use: codex",
    "    with:",
    "      instructions: Run the skill for the current task.",
    "      model: gpt-5.4-mini",
    "optimizer:",
    "  version: 2",
    "  name: runtime-skill-optimizer",
    "  edits:",
    "    - SKILL.md",
    "  improve:",
    "    use: codex",
    "    with:",
    "      model: gpt-5.4-mini",
    "",
  ].join("\n");
}

function twoCriterionSkillRunnerSpec(): string {
  return skillRunnerSpec().replace(
    [
      "        - id: useful",
      "          description: Output is useful.",
    ].join("\n"),
    [
      "        - id: useful",
      "          description: Output is useful.",
      "        - id: complete",
      "          description: Output is complete.",
    ].join("\n"),
  );
}

function fiveCriterionSkillRunnerSpec(): string {
  return skillRunnerSpec().replace(
    [
      "        - id: useful",
      "          description: Output is useful.",
    ].join("\n"),
    [
      "        - id: useful",
      "          description: Output is useful.",
      "        - id: complete",
      "          description: Output is complete.",
      "        - id: format",
      "          description: Output is well formatted.",
      "        - id: accurate",
      "          description: Output is accurate.",
      "        - id: polished",
      "          description: Output is polished.",
    ].join("\n"),
  );
}

function pipelineRunnerSpec(): string {
  return [
    "version: 2",
    "benchmark:",
    "  version: 2",
    "  name: runtime-pipeline-runner",
    "  description: Exercise an agent pipeline runner with rubric grading.",
    "  tasks: tasks",
    "  environment:",
    "    dockerfile: environment/Dockerfile",
    "  score:",
    "    use: rubric",
    "    with:",
    "      judge:",
    "        use: codex",
    "        with:",
    "          model: gpt-5.4-mini",
    "      criteria:",
    "        - id: useful",
    "          description: Output is useful.",
    "subject:",
    "  version: 2",
    "  name: runtime-pipeline-runner",
    "  description: Candidate pipeline runner.",
    "  path: subjects/runtime-pipeline-runner/files",
    "  run:",
    "    use: codex",
    "    with:",
    "      instructions: Run the pipeline for the current task.",
    "      model: gpt-5.4-mini",
    "optimizer:",
    "  version: 2",
    "  name: runtime-pipeline-optimizer",
    "  edits:",
    "    - pipeline.yaml",
    "  improve:",
    "    use: codex",
    "    with:",
    "      model: gpt-5.4-mini",
    "",
  ].join("\n");
}
