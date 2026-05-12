import { describe, expect, test } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildSubjectLineage,
  buildWorkbenchProjectSourceFiles,
  createSyntheticProposalJob,
  createCaseReview,
  createProposalTraceInputFiles,
  createWorkbenchRunWorkload,
  createWorkbenchExecutionCapability,
  executeAdapterInCurrentSandboxRuntime,
  expectedWorkbenchRunJobCount,
  extractExecutionUsageFromTrace,
  findEnvironmentVersionForImage,
  materializeWorkbenchRunResult,
  normalizeDockerImageRef,
  normalizeSurfaceFiles,
  planWorkbenchExecutionJobsForPurpose,
  resolveWorkbenchResolvedSourceYaml,
  selectExecutionOutputFilesForInspection,
  stageWorkbenchRunWorkload,
  trialJobCountForRunSpec,
  validateWorkbenchResolvedSourceYaml,
  workbenchTracePhaseDirectory,
  workbenchTraceRunDirectory,
  workbenchTraceRunDirectoryName,
  workloadTimeoutMs,
  type WorkbenchRunWorkload,
  type WorkbenchTaskBundle,
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
  test("subject lineage ignores self references", () => {
    const lineage = buildSubjectLineage({
      activeId: "subject_self",
      summaries: [{
        id: "subject_self",
        ordinal: 0,
        benchmarkFingerprint: "benchmark",
        subjectFingerprint: "subject_self",
        createdAt: "2026-01-01T00:00:00.000Z",
        baseId: "subject_self",
        referenceIds: ["subject_self"],
        status: "evaluated",
        fileChanges: [],
      }],
    });

    expect(lineage.edges).toEqual([]);
  });

  test("subject lineage only links explicit improve bases", () => {
    const lineage = buildSubjectLineage({
      activeId: "subject_child",
      summaries: [
        {
          id: "subject_base",
          ordinal: 0,
          benchmarkFingerprint: "benchmark",
          subjectFingerprint: "subject_base",
          createdAt: "2026-01-01T00:00:00.000Z",
          referenceIds: [],
          status: "evaluated",
          fileChanges: [],
        },
        {
          id: "subject_reference_only",
          ordinal: 1,
          benchmarkFingerprint: "benchmark",
          subjectFingerprint: "subject_reference_only",
          createdAt: "2026-01-01T00:01:00.000Z",
          referenceIds: ["subject_base"],
          status: "evaluated",
          fileChanges: [],
        },
        {
          id: "subject_child",
          ordinal: 2,
          benchmarkFingerprint: "benchmark",
          subjectFingerprint: "subject_child",
          createdAt: "2026-01-01T00:02:00.000Z",
          baseId: "subject_base",
          referenceIds: ["subject_reference_only"],
          status: "evaluated",
          fileChanges: [],
        },
      ],
    });

    expect(lineage.edges).toEqual([{
      id: "anchor:subject_base:subject_child",
      kind: "anchor",
      sourceId: "subject_base",
      targetId: "subject_child",
    }]);
  });

  test("validates only the split benchmark/subject/optimizer authoring contract", () => {
    const validation = validateWorkbenchResolvedSourceYaml(runtimeSpec());

    expect(validation.ok).toBe(true);
    expect(resolveWorkbenchResolvedSourceYaml(runtimeSpec()).description).toBe("Exercise the generic command runner and scorer runtime path.");
    expect(resolveWorkbenchResolvedSourceYaml(runtimeSpec()).run.with).toMatchObject({
      command: expect.stringContaining("runner-output.json"),
    });
    expect(validateWorkbenchResolvedSourceYaml(runtimeSpec().replace("version: 2", "version: 20")).ok).toBe(false);
    expect(validateWorkbenchResolvedSourceYaml(runtimeSpec().replace("  description: Exercise the generic command runner and scorer runtime path.\n", "")).errors).toContain("benchmark.yaml.description must be a non-empty string.");
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
      await expect(fs.access(path.join(root, "input", "subject", "prompt.md"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(root, "input", "traces", "events", "prior.ndjson"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(root, "input", "task", "task.yaml"))).rejects.toBeTruthy();

      await stageWorkbenchRunWorkload(root, stageWorkload("trial"));
      await expect(fs.access(path.join(root, "input", "subject", "prompt.md"))).resolves.toBeUndefined();
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
    const taskBundles = [taskBundle(
      "case-001",
      "test",
      [{ path: "request.md", content: "public\n" }],
      [{ path: "secret.txt", content: "hidden\n" }],
    )];
    const taskSourceFiles = taskBundles[0]!.sourceFiles ?? [];
    const common = {
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      subjectId: "subject_runtime_001",
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval" as const,
      caseIds: taskBundles.map((bundle) => bundle.id),
      taskBundles,
      now,
    };
    const [trialJob] = planWorkbenchExecutionJobsForPurpose({ ...common, purpose: "trial" });

    const trialInputs = await createWorkbenchSandboxFileStore({
      job: trialJob!,
      spec,
      baseFiles: [],
      taskSourceFiles,
      taskBundles,
    }).materializeInputs(executionFromJob(trialJob!));
    expect(trialInputs.find((input) => input.input.name === "task")?.files.map((file) => file.path)).toEqual([
      "request.md",
      "secret.txt",
    ]);
  });

  test("creates hosted workloads from resolved task-source files", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const taskBundles = [taskBundle(
      "case-001",
      "test",
      [{ path: "request.md", content: "public\n" }],
      [{ path: "secret.txt", content: "hidden\n" }],
    )];
    const taskSourceFiles = taskBundles[0]!.sourceFiles ?? [];
    const [runJob] = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      subjectId: "subject_runtime_001",
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: taskBundles.map((bundle) => bundle.id),
      taskBundles,
      now,
    });

    const workload = createWorkbenchRunWorkload({
      job: runJob!,
      spec,
      baseFiles: [],
      taskSourceFiles,
      taskBundles,
    });

    expect(workload.taskSourceFiles.map((file) => file.path)).toEqual([
      "request.md",
      "secret.txt",
    ]);
    expect(workload.task?.task).toBe("test");
  });

  test("selects only visible trial output files for inspection", () => {
    const files = normalizeSurfaceFiles([
      { path: "runner-summary.md", content: "summary" },
      { path: "outputs/result.json", content: "{}" },
      { path: "workbench-result.json", content: "{}" },
      { path: ".workbench/traces/job/output.xlsx", encoding: "base64", content: "AA==" },
    ]);

    expect(selectExecutionOutputFilesForInspection({
      purpose: "trial",
      files,
    }).map((file) => file.path)).toEqual([
      "outputs/result.json",
      "runner-summary.md",
    ]);
  });

  test("builds synced project source files with subject and task prefixes", () => {
    const files = buildWorkbenchProjectSourceFiles({
      specSource: "version: 2\nbenchmark:\n  version: 2\n  name: source-projection\n",
      subjectFilesPath: "subjects/app/files",
      subjectFiles: normalizeSurfaceFiles([
        { path: "prompt.md", content: "subject\n" },
        { path: "subjects/app/files/already-prefixed.md", content: "already\n" },
      ]),
      tasksPath: "tasks",
      taskFiles: normalizeSurfaceFiles([
        { path: "case-001/task.yaml", content: "version: 2\ntask: Test\n" },
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
      subjectId: "subject_trace_001",
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
          subjectId: "subject_trace_001",
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
        subjectId: "subject_trace_001",
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
    })).toBe(".workbench/traces/000007-run_trace_history/000002-trial");
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

  test("executes a generic trial through the sandbox backend and materializes the run", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const subjectId = "subject_runtime_001";
    const baseFiles = normalizeSurfaceFiles([{
      path: "prompt.md",
      content: "base subject\n",
    }]);
    const taskBundles = [taskBundle("case-001", "Score the subject.")];
    const taskSourceFiles = taskBundles[0]!.sourceFiles ?? [];
    const proposal = createSyntheticProposalJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      subjectId,
      files: baseFiles,
      now,
      baseId: null,
      trialIndex: 0,
    });
    const trialJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      subjectId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: taskBundles.map((bundle) => bundle.id),
      taskBundles,
      now,
    });
    expect(trialJobs).toHaveLength(1);
    expect(trialJobs.map((job) => job.kind)).toEqual(["execute"]);

    const commandManifest = await commandAdapterManifest();
    const runningRunner = runningJob(trialJobs[0]!, now);
    const runnerExecution = executionFromJob(runningRunner);
    const progress = await tryCreateProgressCaptureServer();
    let completedRunner: HostedWorkbenchJob | null = null;
    try {
      completedRunner = await executeAdapterInCurrentSandboxRuntime({
        job: runningRunner,
        spec,
        adapterManifests: [commandManifest],
        baseFiles,
        taskSourceFiles,
        taskBundles,
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
            role: "scorer",
            schema: "workbench.execution.phase.v1",
            payload: { phase: "score", status: "started" },
          },
          {
            source: "command",
            role: "scorer",
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
      existingSubjectCount: 0,
    });

    expect(materialized.activeSubjectId).toBe(subjectId);
    expect(materialized.subjects).toHaveLength(1);
    expect(materialized.subjects[0]?.metrics?.score).toBe(0.91);
    expect(materialized.subjects[0]?.eval?.samples[0]?.cases).toBeUndefined();
    expect(materialized.completedJobCount).toBe(2);
    expect(materialized.evaluations[0]?.evaluation.subject.id).toBe(subjectId);
  });

  test("materializes only subject source files into subject snapshots", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const subjectId = "subject_runtime_001";
    const proposal = createSyntheticProposalJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      subjectId,
      files: normalizeSurfaceFiles([
        { path: "prompt.md", content: "base subject\n" },
        { path: "reports/source-note.md", content: "subject-authored source\n" },
      ]),
      now,
      baseId: null,
      trialIndex: 0,
    });
    const trialJob: HostedWorkbenchJob = {
      id: "job_exec_run_runtime_trial_000_current_sample_000_score",
      projectId: "project_runtime",
      runId: "run_runtime",
      subjectId,
      kind: "execute",
      status: "succeeded",
      attempt: 1,
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      updatedAt: now,
      input: {
        subjectId,
        trialIndex: 0,
        sampleIndex: 0,
        execution: {
          id: "exec_run_runtime_trial_000_current_sample_000_score",
          purpose: "trial",
          adapter: { use: "command", with: { command: "node score.js" } },
          inputs: [],
          outputs: [],
        },
      } as unknown as HostedWorkbenchJob["input"],
      output: {
        ok: true,
        subjectId,
        trialIndex: 0,
        sampleIndex: 0,
        scorecard: { score: 0.9 },
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
            path: ".workbench/traces/job_exec_run_runtime_trial_000_current_sample_000_score/score.json",
            kind: "text",
            encoding: "utf8",
            content: "{\"score\":0.9,\"source\":\"scorer-output\"}\n",
            executable: false,
          },
        ],
        sample: {
          id: "sample_001",
          index: 0,
          subject: { id: subjectId, kind: "subject" },
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
      jobs: [proposal, trialJob],
      existingSubjectCount: 0,
    });

    expect(materialized.subjectFiles[subjectId]?.map((file) => file.path)).toEqual([
      "prompt.md",
      "reports/source-note.md",
    ]);
  });

  test("materialized subject baseId comes only from explicit improve proposal output", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const proposal = createSyntheticProposalJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_runtime",
      subjectId: "subject_runtime_002",
      files: normalizeSurfaceFiles([{ path: "prompt.md", content: "base subject\n" }]),
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
      previousSubject: {
        id: "subject_previous",
        ordinal: 0,
        benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
        subjectFingerprint: "subject_previous",
        createdAt: now,
        referenceIds: [],
        status: "evaluated",
        fileChanges: [],
      },
      existingSubjectCount: 1,
    });

    expect(materialized.subjects[0]?.baseId).toBeUndefined();
  });

  test("materializes invalid sample statuses as an error sample", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(runtimeSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const subjectId = "subject_invalid_status";
    const proposal = createSyntheticProposalJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_invalid_status",
      subjectId,
      files: normalizeSurfaceFiles([{ path: "prompt.md", content: "subject" }]),
      now,
      baseId: null,
      trialIndex: 0,
    });
    const trialJob: HostedWorkbenchJob = {
      ...runningJob({
        id: "job_invalid_score",
        projectId: "project_runtime",
        runId: "run_invalid_status",
        subjectId,
        kind: "execute",
        status: "queued",
        attempt: 0,
        createdAt: now,
        updatedAt: now,
        input: {
          subjectId,
          trialIndex: 0,
          sampleIndex: 0,
          caseId: "case-001",
          execution: {
            id: "exec_invalid_score",
            purpose: "trial",
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
        subjectId,
        trialIndex: 0,
        fileChanges: [],
        sample: {
          id: "sample_001",
          index: 0,
          subject: { id: subjectId, kind: "subject" },
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
      jobs: [proposal, trialJob],
      existingSubjectCount: 0,
    });

    const evalRecord = materialized.subjects[0]?.eval;
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
    const subjectId = "subject_two_cases_one_sample";
    const proposal = createSyntheticProposalJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_two_cases_one_sample",
      subjectId,
      files: normalizeSurfaceFiles([{ path: "prompt.md", content: "subject" }]),
      now,
      baseId: null,
      trialIndex: 0,
    });
    const taskBundles = [
      taskBundle("case-a", "A"),
      taskBundle("case-b", "B"),
    ];
    const trialJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_two_cases_one_sample",
      subjectId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: taskBundles.map((bundle) => bundle.id),
      taskBundles,
      now,
    });
    const completedTrials = trialJobs.map((job, index): HostedWorkbenchJob => {
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
          subjectId,
          trialIndex: 0,
          fileChanges: [],
          files: normalizeSurfaceFiles([{
            path: `${caseId}/score.json`,
            content: JSON.stringify({ score }),
          }]),
          traces: [],
          sample: {
            id: `${caseId}__sample_001`,
            index: 0,
            subject: { id: subjectId, kind: "subject" },
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
      jobs: [proposal, ...completedTrials],
      existingSubjectCount: 0,
    });

    const evalRecord = materialized.subjects[0]?.eval;
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
    const subject = {
      id: "subject_phase_review",
      ordinal: 1,
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      subjectFingerprint: "subject_phase_review",
      createdAt: "2026-04-27T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
      eval: {
        subject: { kind: "subject", id: "subject_phase_review" },
        status: "completed",
        sampleCount: 1,
        completedSampleCount: 1,
        errorSampleCount: 0,
        samples: [{
          id: "sample_001",
          index: 0,
          subject: { kind: "subject", id: "subject_phase_review" },
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
      subject: subject as Parameters<typeof createCaseReview>[0]["subject"],
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
    const subject = {
      id: "subject_phase_review",
      ordinal: 1,
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      subjectFingerprint: "subject_phase_review",
      createdAt: "2026-04-27T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
      eval: {
        subject: { kind: "subject", id: "subject_phase_review" },
        status: "completed",
        sampleCount: 2,
        completedSampleCount: 2,
        errorSampleCount: 0,
        samples: [
          {
            id: "task-001__sample_001",
            index: 0,
            subject: { kind: "subject", id: "subject_phase_review" },
            status: "completed",
            metrics: { score: 0.25 },
            cases: [{ id: "task-001", status: "completed", metrics: { score: 0.25 } }],
          },
          {
            id: "task-001__sample_002",
            index: 1,
            subject: { kind: "subject", id: "subject_phase_review" },
            status: "completed",
            metrics: { score: 0.75 },
            cases: [{ id: "task-001", status: "completed", metrics: { score: 0.75 } }],
          },
        ],
      },
    };

    const review = createCaseReview({
      subject: subject as Parameters<typeof createCaseReview>[0]["subject"],
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
      subject: {
        id: "subject_phase_only",
        ordinal: 1,
        benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
        subjectFingerprint: "subject_phase_only",
        createdAt: "2026-04-27T00:00:00.000Z",
        referenceIds: [],
        status: "running",
        fileChanges: [],
      } as Parameters<typeof createCaseReview>[0]["subject"],
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
    const subjectId = "subject_skill_001";
    const baseFiles = normalizeSurfaceFiles([{
      path: "invoice-review/SKILL.md",
      content: "---\nname: invoice-review\ndescription: Review invoices.\n---\n\n# Invoice Review\n",
    }]);
    const largeFilingText = "large filing body\n".repeat(100_000);
    const taskBundles = [taskBundle(
      "case-001",
      "Review this invoice fixture.",
      [
        { path: "prompt.md", content: "Review this invoice fixture.\n" },
        { path: "filing/raw/primary_document.htm", content: largeFilingText },
      ],
    )];
    const taskSourceFiles = taskBundles[0]!.sourceFiles ?? [];
    const trialJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_skill_runtime",
      subjectId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: taskBundles.map((bundle) => bundle.id),
      taskBundles,
      now,
    });
    const runningRunner = runningJob(trialJobs[0]!, now);
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
  operation: "subject.run",
  ok: true,
  summary: "skill output from runner",
  usage: ${JSON.stringify(runnerUsage)}
}, null, 2));
`);
    const scorerUsage = {
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
  operation: "trial.score",
  ok: true,
  value: {
    score: 0.88,
    metrics: { score: 0.88 },
    cases: [{ id: request.context?.trial?.caseId ?? "current", status: "completed", metrics: { score: 0.88 } }],
    usage: {
      scorer: ${JSON.stringify(scorerUsage.total)},
      total: ${JSON.stringify(scorerUsage.total)}
    },
    feedback: { metadata: {} }
  }
}, null, 2));
`);
    const completedRunner = await executeAdapterInCurrentSandboxRuntime({
      job: runningRunner,
      spec,
      adapterManifests: [codexAdapter, rubricAdapter],
      baseFiles,
      taskSourceFiles,
      taskBundles,
    }, runnerExecution, now, createWorkbenchExecutionCapability(runnerExecution, { now }));

    expect(completedRunner.error).toBeUndefined();
    expect(completedRunner.status).toBe("succeeded");
    const trialOutputPaths = completedOutputFiles(completedRunner).map((file) => file.path);
    expect(trialOutputPaths).toContain("runner-summary.md");
    expect(trialOutputPaths.some((filePath) => filePath.startsWith(".workbench/internal/"))).toBe(false);
    expect((completedRunner.output as { usage?: { runner?: { costUsd?: number } } }).usage?.runner?.costUsd).toBe(0.0042);
    expect((completedRunner.output as { traces?: string[] }).traces).toEqual([
      `.workbench/traces/000001-run_skill_runtime/000002-trial/${runningRunner.id}/runner.json`,
      `.workbench/traces/000001-run_skill_runtime/000002-trial/${runningRunner.id}/runner/session/events.ndjson`,
    ]);

    const completedScorer = completedRunner;
    expect(completedScorer.error).toBeUndefined();
    expect(completedScorer.status).toBe("succeeded");
    expect(completedScore(completedScorer)).toBe(0.88);
    expect((completedScorer.output as { usage?: { runner?: { costUsd?: number } } }).usage?.runner?.costUsd).toBe(0.0042);
    expect((completedScorer.output?.scorecard as { feedback?: { metadata?: { usage?: unknown } } } | undefined)?.feedback?.metadata?.usage).toBeUndefined();
    expect((completedScorer.output?.scorecard as { cases?: Array<{ id?: string }> } | undefined)?.cases?.[0]?.id).toBe("case-001");
    const proposal = createSyntheticProposalJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_skill_runtime",
      subjectId,
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
      existingSubjectCount: 0,
    });
    expect(materialized.subjects[0]?.usage?.optimizer?.costUsd).toBe(0.002);
    expect(materialized.subjects[0]?.usage?.runner?.costUsd).toBe(0.0042);
    expect(materialized.subjects[0]?.usage?.scorer?.costUsd).toBe(0.001);
    expect(materialized.subjects[0]?.usage?.total?.costUsd).toBe(0.0072);
    expect(materialized.subjects[0]?.eval?.usage?.total?.costUsd?.mean).toBe(0.0052);
    expect(materialized.subjects[0]?.eval?.usage?.total?.totalTokens?.mean).toBe(1_500);
    expect(materialized.subjects[0]?.eval?.usage?.runner?.costUsd?.mean).toBe(0.0042);
    expect(materialized.subjects[0]?.eval?.usage?.scorer?.costUsd?.mean).toBe(0.001);
    expect(materialized.evaluations[0]?.usage?.total?.costUsd?.mean).toBe(0.0052);
  });

  test("uses criterion scores when rubric judges return an unnormalized top-level score", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(skillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const taskBundles = [taskBundle("case-001", "Review this invoice fixture.")];
    const taskSourceFiles = taskBundles[0]!.sourceFiles ?? [];
    const trialJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_rubric_normalization",
      subjectId: "subject_skill_001",
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: taskBundles.map((bundle) => bundle.id),
      taskBundles,
      now,
    });
    const runningScorer = runningJob(trialJobs[0]!, now);
    const scorerExecution = executionFromJob(runningScorer);
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
    const completedScorer = await executeAdapterInCurrentSandboxRuntime({
      job: runningScorer,
      spec,
      adapterManifests: [runnerAdapter, rubricAdapter],
      baseFiles: normalizeSurfaceFiles([{ path: "SKILL.md", content: "Use the skill.\n" }]),
      taskSourceFiles,
      taskBundles,
    }, scorerExecution, now, createWorkbenchExecutionCapability(scorerExecution, { now }));

    expect(completedScorer.error).toBeUndefined();
    expect(completedScorer.status).toBe("succeeded");
    expect(completedScore(completedScorer)).toBe(0.4);
    const scorecard = completedScorer.output?.scorecard as { cases?: Array<{ status?: string; criteria?: Array<{ rationale?: string }> }> } | undefined;
    expect(scorecard?.cases?.[0]?.status).toBe("completed");
    expect(scorecard?.cases?.[0]?.criteria?.[0]?.rationale).toBe("The runner output missed the required output.");
  });

  test("repairs malformed rubric judge JSON with one bounded judge turn", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(skillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const taskBundles = [taskBundle("case-001", "Review this invoice fixture.")];
    const taskSourceFiles = taskBundles[0]!.sourceFiles ?? [];
    const trialJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_rubric_repair",
      subjectId: "subject_skill_001",
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: taskBundles.map((bundle) => bundle.id),
      taskBundles,
      now,
    });
    const runningScorer = runningJob(trialJobs[0]!, now);
    const scorerExecution = executionFromJob(runningScorer);
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
    const completedScorer = await executeAdapterInCurrentSandboxRuntime({
      job: runningScorer,
      spec,
      adapterManifests: [runnerAdapter, rubricAdapter],
      baseFiles: normalizeSurfaceFiles([{ path: "SKILL.md", content: "Use the skill.\n" }]),
      taskSourceFiles,
      taskBundles,
    }, scorerExecution, now, createWorkbenchExecutionCapability(scorerExecution, { now }));

    expect(completedScorer.error).toBeUndefined();
    expect(completedScorer.status).toBe("succeeded");
    expect(completedScore(completedScorer)).toBe(0.82);
    const scorecard = completedScorer.output?.scorecard as { feedback?: { metadata?: { repair?: { attempted?: boolean; originalError?: string } } } } | undefined;
    expect(scorecard?.feedback?.metadata?.repair?.attempted).toBe(true);
    expect(scorecard?.feedback?.metadata?.repair?.originalError).toContain("must parse as a JSON object");
  });

  test("accepts rubric repair JSON with invalid string escapes", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(skillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const taskBundles = [taskBundle("case-001", "Review this invoice fixture.")];
    const taskSourceFiles = taskBundles[0]!.sourceFiles ?? [];
    const trialJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_rubric_escape_repair",
      subjectId: "subject_skill_001",
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: taskBundles.map((bundle) => bundle.id),
      taskBundles,
      now,
    });
    const runningScorer = runningJob(trialJobs[0]!, now);
    const scorerExecution = executionFromJob(runningScorer);
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
    const completedScorer = await executeAdapterInCurrentSandboxRuntime({
      job: runningScorer,
      spec,
      adapterManifests: [runnerAdapter, rubricAdapter],
      baseFiles: normalizeSurfaceFiles([{ path: "SKILL.md", content: "Use the skill.\n" }]),
      taskSourceFiles,
      taskBundles,
    }, scorerExecution, now, createWorkbenchExecutionCapability(scorerExecution, { now }));

    expect(completedScorer.error).toBeUndefined();
    expect(completedScorer.status).toBe("succeeded");
    expect(completedScore(completedScorer)).toBe(0.82);
    const scorecard = completedScorer.output?.scorecard as { cases?: Array<{ criteria?: Array<{ rationale?: string }> }> } | undefined;
    expect(scorecard?.cases?.[0]?.criteria?.[0]?.rationale).toBe("The workbook references C:\\Temp\\model and remains usable.");
  });

  test("runs one rubric-scored trial job per sample and materializes all criteria", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(fiveCriterionSkillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const subjectId = "subject_skill_001";
    const baseFiles = normalizeSurfaceFiles([{ path: "SKILL.md", content: "Use the skill.\n" }]);
    const taskBundles = [taskBundle("case-001", "Review this invoice fixture.")];
    const taskSourceFiles = taskBundles[0]!.sourceFiles ?? [];
    const trialJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_single_rubric_trial",
      subjectId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: taskBundles.map((bundle) => bundle.id),
      taskBundles,
      now,
    });
    expect(trialJobs).toHaveLength(1);
    expect(trialJobCountForRunSpec(spec)).toBe(1);
    expect(expectedWorkbenchRunJobCount({
      workflow: "eval",
      budget: 1,
      samples: 1,
      caseCount: taskBundles.length,
    })).toBe(2);
    expect(Object.keys(executionFromJob(trialJobs[0]!).metadata)).toEqual([
      "trialIndex",
      "sampleIndex",
      "caseId",
      "task",
      "scoreAdapter",
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
    const runningScorer = runningJob(trialJobs[0]!, now);
    const scorerExecution = executionFromJob(runningScorer);
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
    const completedScorer = await executeAdapterInCurrentSandboxRuntime({
      job: runningScorer,
      spec,
      adapterManifests: [runnerAdapter, rubricAdapter],
      baseFiles,
      taskSourceFiles,
      taskBundles,
    }, scorerExecution, now, createWorkbenchExecutionCapability(scorerExecution, { now }));

    expect(completedScorer.status).toBe("succeeded");
    const { files: _files, ...hostedStyleScorerOutput } =
      completedScorer.output as Record<string, unknown>;
    const hostedStyleCompletedScorer = {
      ...completedScorer,
      output: hostedStyleScorerOutput,
    };
    const proposal = createSyntheticProposalJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_single_rubric_trial",
      subjectId,
      files: baseFiles,
      now,
      baseId: null,
      trialIndex: 0,
    });
    const materialized = materializeWorkbenchRunResult({
      runId: "run_single_rubric_trial",
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      startedAt: now,
      spec,
      jobs: [proposal, hostedStyleCompletedScorer],
      existingSubjectCount: 0,
    });
    const sample = materialized.subjects[0]?.eval?.samples[0];
    expect(materialized.subjects[0]?.metrics?.score).toBe(0.7);
    expect(sample?.cases?.[0]?.criteria?.map((criterion) => criterion.criterion_id))
      .toEqual(["useful", "complete", "format", "accurate", "polished"]);
    expect(sample?.cases?.[0]?.criteria?.map((criterion) => criterion.score))
      .toEqual([1, 0.5, 0.75, 0.25, 1]);
  });

  test("materializes a failed trial scorer as one error case sample", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(twoCriterionSkillRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const subjectId = "subject_failed_rubric_score";
    const baseFiles = normalizeSurfaceFiles([{ path: "SKILL.md", content: "Use the skill.\n" }]);
    const taskBundles = [taskBundle("case-001", "Review this invoice fixture.")];
    const proposal = createSyntheticProposalJob({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_failed_rubric_score",
      subjectId,
      files: baseFiles,
      now,
      baseId: null,
      trialIndex: 0,
    });
    const trialJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_failed_rubric_score",
      subjectId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: taskBundles.map((bundle) => bundle.id),
      taskBundles,
      now,
    });
    expect(trialJobs).toHaveLength(1);
    expect(trialJobCountForRunSpec(spec)).toBe(1);
    const failedScorer = {
      ...runningJob(trialJobs[0]!, now),
      status: "failed" as const,
      attempt: 1,
      finishedAt: now,
      updatedAt: now,
      error: "scorer failed",
      output: { ok: false },
    };

    const materialized = materializeWorkbenchRunResult({
      runId: "run_failed_rubric_score",
      benchmarkFingerprint: "4444444444444444444444444444444444444444444444444444444444444444",
      startedAt: now,
      spec,
      jobs: [proposal, failedScorer],
      existingSubjectCount: 0,
    });

    const evalRecord = materialized.subjects[0]?.eval;
    const sample = evalRecord?.samples[0];
    expect(evalRecord?.sampleCount).toBe(1);
    expect(evalRecord?.errorSampleCount).toBe(1);
    expect(sample?.id).toBe("case-001__sample_001");
    expect(sample?.status).toBe("error");
    expect(sample?.cases?.[0]?.id).toBe("case-001");
    expect(sample?.cases?.[0]?.status).toBe("error");
    expect(sample?.error).toContain("scorer failed");
  });

  test("executes a pipeline subject with the generic agent runner", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(pipelineRunnerSpec());
    const now = "2026-04-27T00:00:00.000Z";
    const subjectId = "subject_pipeline_001";
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
    const taskBundles = [taskBundle("case-001", "Run the pipeline.")];
    const taskSourceFiles = taskBundles[0]!.sourceFiles ?? [];
    const trialJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_runtime",
      projectId: "project_runtime",
      runId: "run_pipeline_runtime",
      subjectId,
      trialIndex: 0,
      samples: 1,
      spec,
      workflow: "eval",
      purpose: "trial",
      caseIds: taskBundles.map((bundle) => bundle.id),
      taskBundles,
      now,
    });
    const runningRunner = runningJob(trialJobs[0]!, now);
    const runnerExecution = executionFromJob(runningRunner);
    const codexAdapter = await scriptedAdapterManifest("codex", `
import fs from "node:fs";
import path from "node:path";
const output = process.env.WORKBENCH_OUTPUT;
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "scratch.tmp"), "scratch\\n");
fs.writeFileSync(path.join(output, "runner-summary.md"), "pipeline agent runner completed");
fs.writeFileSync(path.join(output, "workbench-result.json"), JSON.stringify({
  protocol: "workbench.adapter-result.v1",
  operation: "subject.run",
  ok: true
}, null, 2));
`);
    const rubricAdapter = await scriptedRubricAdapter({ score: 0.77 });
    const completedTrial = await executeAdapterInCurrentSandboxRuntime({
      job: runningRunner,
      spec,
      adapterManifests: [codexAdapter, rubricAdapter],
      baseFiles,
      taskSourceFiles,
      taskBundles,
    }, runnerExecution, now, createWorkbenchExecutionCapability(runnerExecution, { now }));

    expect(completedTrial.error).toBeUndefined();
    expect(completedTrial.status).toBe("succeeded");
    expect(completedScore(completedTrial)).toBe(0.77);
    const outputFiles = completedOutputFiles(completedTrial);
    expect(outputFiles.map((file) => file.path)).toContain("runner-summary.md");
    expect(outputFiles.some((file) => file.path.startsWith(".workbench/internal/"))).toBe(false);
    expect(outputFiles.map((file) => file.path)).toContain("scratch.tmp");
    expect(outputFiles.find((file) => file.path === "runner-summary.md")?.content).toContain("pipeline agent runner completed");
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

function taskBundle(
  id: string,
  task: string,
  publicFiles: readonly { path: string; content: string }[] = [],
  testFiles: readonly { path: string; content: string }[] = [],
): WorkbenchTaskBundle {
  const publicSnapshot = normalizeSurfaceFiles(publicFiles);
  const testSnapshot = normalizeSurfaceFiles(testFiles);
  return {
    id,
    task: { version: 2, task },
    publicFiles: publicSnapshot,
    testFiles: testSnapshot,
    sourceFiles: [...publicSnapshot, ...testSnapshot].sort((left, right) =>
      left.path.localeCompare(right.path)
    ),
  };
}

function stageWorkload(purpose: "improve" | "trial"): WorkbenchRunWorkload {
  const now = "2026-04-27T00:00:00.000Z";
  const bundle = taskBundle(
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
      subjectId: "subject_test",
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
    subjectId: "subject_test",
    trialIndex: 0,
    sampleIndex: 0,
    caseId: "case-001",
    subjectFiles: normalizeSurfaceFiles([{ path: "prompt.md", content: "subject" }]),
    taskSourceFiles: bundle.sourceFiles ?? [],
    traceFiles: normalizeSurfaceFiles([{ path: "events/prior.ndjson", content: "{\"event\":\"prior\"}\n" }]),
    ...(purpose === "trial" ? { taskBundle: bundle, task: bundle.task } : {}),
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
  const scorerCommand = JSON.stringify(`node -e ${JSON.stringify([
    "const fs=require('fs');",
    "fs.mkdirSync('output',{recursive:true});",
    "fs.writeFileSync('output/workbench-result.json',JSON.stringify({protocol:'workbench.adapter-result.v1',operation:'trial.score',ok:true,value:{score:0.91,summary:'Generic runtime path passed.'}},null,2));",
  ].join(""))}`);
  return [
    "version: 2",
    "benchmark:",
    "  version: 2",
    "  name: runtime-generic-execution",
    "  description: Exercise the generic command runner and scorer runtime path.",
    "  tasks:",
    "    path: tasks",
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
    `      command: ${scorerCommand}`,
    "subject:",
    "  version: 2",
    "  name: runtime-generic-execution",
    "  description: Subject runner for the generic runtime benchmark.",
    "  files:",
    "    path: subjects/runtime-generic-execution/files",
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
    protocol: "workbench.adapter.v2" as const,
    setup: [],
    operations: {
      "subject.run": { command: `node ${shellWord(file)}` },
      "trial.score": { command: `node ${shellWord(file)}` },
      "subject.improve": { command: `node ${shellWord(file)}` },
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
const result = spawnSync("sh", ["-lc", command], {
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
  operation: "trial.score",
  ok: true,
  value: {
    score,
    metrics: { score },
    ${args.summary ? `summary: ${JSON.stringify(args.summary)},` : ""}
    cases: [{ id: request.context?.trial?.caseId ?? "current", status: "completed", metrics: { score }, criteria }],
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
  operation: "subject.run",
  ok: true
}, null, 2));
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
    "  description: Exercise an agent skill runner with rubric scoring.",
    "  tasks:",
    "    path: tasks",
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
    "  description: Subject skill runner.",
    "  files:",
    "    path: subjects/invoice-review/files",
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
    "  description: Exercise an agent pipeline runner with rubric scoring.",
    "  tasks:",
    "    path: tasks",
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
    "  description: Subject pipeline runner.",
    "  files:",
    "    path: subjects/runtime-pipeline-runner/files",
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
