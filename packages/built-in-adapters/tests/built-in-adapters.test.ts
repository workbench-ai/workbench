import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  WorkbenchAgentTurnRequest,
} from "../src/agent-turn.ts";

import {
  executeWorkbenchAgentTurn,
  resolveAgentTurnTimeouts,
} from "../src/agent-turn.ts";
import {
  executeWorkbenchBuiltInAdapterCommand,
} from "../src/execute.ts";
import {
  builtinWorkbenchAdapterManifest,
} from "../src/manifests.ts";
import {
  readWorkbenchAdapterOperationResult,
} from "@workbench-ai/workbench-protocol";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("built-in Workbench adapters", () => {
  test("publishes manifest-backed built-in adapters without command shim setup", () => {
    const manifest = builtinWorkbenchAdapterManifest("codex");
    const workbench = builtinWorkbenchAdapterManifest("workbench");

    expect(manifest?.setup.join("\n")).not.toContain("/usr/local/bin/workbench-adapter-codex");
    expect(manifest?.operations["candidate.run"]?.command).toBe("workbench-adapter-codex");
    expect(workbench?.setup).toEqual([]);
    expect(workbench?.operations).toMatchObject({
      "engine.resolve": { command: "workbench-adapter-workbench" },
      "engine.run": { command: "workbench-adapter-workbench" },
    });
  });

  test("executes Codex-shaped agent adapters through an operation request", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-first-party-agent-"));
    await fs.mkdir(path.join(root, "input", "candidate"), { recursive: true });
    await fs.mkdir(path.join(root, "input", "case"), { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.writeFile(path.join(root, "input", "candidate", "SKILL.md"), "Do the task.\n");
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_agent_run",
      jobId: "job_agent_run",
      operation: "candidate.run",
      invocation: {
        use: "codex",
        with: {
          model: "gpt-5.4-mini",
          instructions: "Write one durable output file.",
        },
      },
      auth: {
        self: {
          default: {
            method: "api-key",
            profile: "default",
            env: { OPENAI_API_KEY: "materialized" },
          },
        },
        adapters: {
          codex: {
            default: {
              method: "api-key",
              profile: "default",
              env: { OPENAI_API_KEY: "materialized" },
            },
          },
        },
      },
      context: {
        benchmark: {
          name: "adapter-smoke",
          description: "Smoke test first-party adapter command.",
        },
        candidate: {
          id: "candidate_123",
          path: "candidate/files",
        },
        improve: {
          edits: ["SKILL.md"],
        },
        attempt: {
          attemptIndex: 0,
          sampleIndex: 0,
          caseId: "task-001",
        },
        case: {
          prompt: "Produce a concise result.",
        },
      },
      paths: adapterCommandPaths(root),
    }, null, 2)}\n`);
    const seenRequests: WorkbenchAgentTurnRequest[] = [];
    const agentExecutor = vi.fn(async (request: WorkbenchAgentTurnRequest) => {
      seenRequests.push(request);
      await fs.writeFile(path.join(request.workspaceRoot, "output", "answer.md"), "agent output\n");
      return {
        output: "agent output",
        traceFiles: [{
          path: "codex-trace.json",
          kind: "text" as const,
          encoding: "utf8" as const,
          executable: false,
          content: "{\"ok\":true}\n",
        }],
        metadata: { mocked: true },
        usage: {
          total: {
            provider: "openai/codex",
            model: "gpt-5.4-mini",
            totalTokens: 3,
            costUsd: 0,
            costSource: "provider",
          },
        },
      };
    });

    await executeWorkbenchBuiltInAdapterCommand({
      adapterId: "codex",
      requestPath,
      agentExecutor,
    });

    expect(agentExecutor).toHaveBeenCalledTimes(1);
    expect(seenRequests[0]).toMatchObject({
      role: "runner",
      provider: {
        use: "codex",
        model: "gpt-5.4-mini",
      },
      adapterAuthRequest: {
        self: {
          default: {
            method: "api-key",
          },
        },
      },
    });
    expect(seenRequests[0]!.prompt).toContain("Write one durable output file.");
    await expect(fs.readFile(path.join(root, "output", "answer.md"), "utf8"))
      .resolves.toBe("agent output\n");
    await expect(fs.readFile(path.join(root, "output", "candidate-summary.md"), "utf8"))
      .resolves.toBe("agent output");
    const result = await readWorkbenchAdapterOperationResult(path.join(root, "output"), "candidate.run");
    expect(result.usage.runner.provider).toBe("openai/codex");
  });

  test("defaults Codex agent turns to the supported Workbench model", async () => {
    const { codexHarness } = await import("@workbench-ai/agent-driver-openai-codex");

    expect(codexHarness().manifest.defaults.model).toBe("gpt-5.5");
  });

  test("keeps agent stall timeout shorter than the full turn timeout", () => {
    expect(resolveAgentTurnTimeouts({})).toEqual({
      turnTimeoutMs: 3_600_000,
      stallTimeoutMs: 300_000,
    });
    expect(resolveAgentTurnTimeouts({
      turn_timeout_ms: 120_000,
      stall_timeout_ms: 300_000,
    })).toEqual({
      turnTimeoutMs: 120_000,
      stallTimeoutMs: 120_000,
    });
    expect(resolveAgentTurnTimeouts({
      turn_timeout_ms: 3_600_000,
      stall_timeout_ms: 90_000,
    })).toEqual({
      turnTimeoutMs: 3_600_000,
      stallTimeoutMs: 90_000,
    });
  });

  test("retries stalled agent turns as transient failures", async () => {
    const request = {
      role: "engine" as const,
      provider: { use: "codex" },
      workspaceRoot: "/workspace",
      cwd: "/workspace",
      prompt: "Score the task.",
      traceRoot: "/workspace/.workbench/trace",
      jobId: "job_stall_retry",
    };
    const executor = vi.fn(async () => {
      if (executor.mock.calls.length === 1) {
        throw new Error("turn stalled after 300000ms");
      }
      return {
        output: "ok",
        traceFiles: [],
        metadata: { retried: true },
      };
    });

    await expect(executeWorkbenchAgentTurn(executor, request)).resolves.toMatchObject({
      output: "ok",
      metadata: { retried: true },
    });
    expect(executor).toHaveBeenCalledTimes(2);
  });

  test("executes rubric criteria as bounded parallel judge turns and aggregates weighted metrics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-first-party-rubric-"));
    const criteria = [{
      id: "accuracy",
      description: "Unique accuracy criterion: all requested facts are correct.",
      weight: 2,
      score: 0.25,
    }, {
      id: "completeness",
      description: "Unique completeness criterion: every requested item is present.",
      weight: 1,
      score: 1,
    }, {
      id: "style",
      description: "Unique style criterion: the answer is concise and readable.",
      weight: 1,
      score: 0.5,
    }];
    const requestPath = await writeRubricRequest(root, {
      parallelism: 2,
      criteria,
    });
    const seenRequests: WorkbenchAgentTurnRequest[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const agentExecutor = vi.fn(async (request: WorkbenchAgentTurnRequest) => {
      seenRequests.push(request);
      const criterion = singleCriterionFromPrompt(request.prompt, criteria);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(25);
      inFlight -= 1;
      return {
        output: rubricJudgeOutput(criterion.id, criterion.score, `${criterion.id} rationale`),
        traceFiles: [
          mockAgentTraceFile(request, criterion.id, "judge"),
          {
            path: `${request.tracePath!}/session/raw-events.ndjson`,
            kind: "text" as const,
            encoding: "utf8" as const,
            executable: false,
            content: "{\"private\":true}\n",
          },
        ],
        metadata: { mocked: true, criterion: criterion.id },
      };
    });

    await executeWorkbenchBuiltInAdapterCommand({
      adapterId: "rubric",
      requestPath,
      agentExecutor,
    });

    expect(agentExecutor).toHaveBeenCalledTimes(criteria.length);
    expect(maxInFlight).toBe(2);
    expect(seenRequests[0]).toMatchObject({
      role: "engine",
      provider: {
        use: "codex",
        model: "gpt-5.4-mini",
      },
      adapterAuthRequest: {
        adapters: {
          codex: {
            default: {
              method: "api-key",
            },
          },
        },
      },
    });
    expect(seenRequests.map((request) => singleCriterionFromPrompt(request.prompt, criteria).id).sort())
      .toEqual(["accuracy", "completeness", "style"]);
    expect(seenRequests.every((request) => request.prompt.includes("Score only the runner output."))).toBe(true);
    const adapterResult = await readWorkbenchAdapterOperationResult(path.join(root, "output"), "engine.run");
    const engineResult = adapterResult.value;
    expect(engineResult.score).toBe(0.5);
    expect(engineResult.metrics).toEqual({ score: 0.5 });
    expect(engineResult.cases[0].criteria).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterion_id: "accuracy", score: 0.25 }),
      expect.objectContaining({ criterion_id: "completeness", score: 1 }),
      expect.objectContaining({ criterion_id: "style", score: 0.5 }),
    ]));
    expect(adapterResult.feedback).toMatchObject({
      rubric: "criterion-fanout",
      parallelism: 2,
      aggregation: "weighted_mean",
    });
    expect(engineResult.feedback.judge).toBe("codex");
    const evidenceScorecard = JSON.parse(
      await fs.readFile(path.join(root, "output", ".workbench", "traces", "job_rubric_grade", "engine", "rubric", "scorecard.json"), "utf8"),
    ) as { safeForImprover?: boolean; criteria?: Array<{ id?: string; rationale?: string }> };
    expect(evidenceScorecard.safeForImprover).toBe(true);
    expect(evidenceScorecard.criteria?.map((criterion) => criterion.id).sort()).toEqual(["accuracy", "completeness", "style"]);
    await expect(fs.readFile(
      path.join(root, "output", ".workbench", "traces", "job_rubric_grade", "engine", "rubric", "criteria", "accuracy", "result.json"),
      "utf8",
    )).resolves.toContain("accuracy rationale");
    const accuracyTrace = JSON.parse(
      await fs.readFile(
        path.join(root, "output", ".workbench", "traces", "job_rubric_grade", "engine", "rubric", "criteria", "accuracy", "judge", "session", "trace.json"),
        "utf8",
      ),
    ) as { spans?: Array<{ title?: string }>; events?: Array<{ message?: string }> };
    expect(accuracyTrace.spans?.map((span) => span.title)).toContain("Judge criterion accuracy");
    expect(accuracyTrace.events?.map((event) => event.message)).toContain("accuracy judge trace event");
    await expect(fs.stat(
      path.join(root, "output", ".workbench", "traces", "job_rubric_grade", "engine", "rubric", "trace.json"),
    )).rejects.toThrow();
    await expect(fs.stat(
      path.join(root, "output", ".workbench", "traces", "job_rubric_grade", "engine", "rubric", "criteria", "accuracy", "judge", "session", "raw-events.ndjson"),
    )).rejects.toThrow();
  });

  test("repairs malformed rubric judge output per criterion", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-first-party-rubric-repair-"));
    const criteria = [{
      id: "factuality",
      description: "Unique factuality criterion: claims are supported by the output.",
      weight: 1,
      score: 0.5,
    }, {
      id: "coverage",
      description: "Unique coverage criterion: the output addresses the whole task.",
      weight: 1,
      score: 1,
    }];
    const requestPath = await writeRubricRequest(root, {
      parallelism: 2,
      criteria,
    });
    const callsByCriterion = new Map<string, WorkbenchAgentTurnRequest[]>();
    const repairRequests: WorkbenchAgentTurnRequest[] = [];
    const agentExecutor = vi.fn(async (request: WorkbenchAgentTurnRequest) => {
      const criterion = singleCriterionFromPrompt(request.prompt, criteria);
      callsByCriterion.set(criterion.id, [
        ...(callsByCriterion.get(criterion.id) ?? []),
        request,
      ]);
      const isRepair = request.prompt.includes("rejected by the result parser")
        || request.prompt.includes("Parser error:");
      if (isRepair) {
        repairRequests.push(request);
      }
      if (criterion.id === "factuality" && !isRepair) {
        return {
          output: "factuality: partial credit because the citation is malformed",
          traceFiles: [],
          metadata: { mocked: true, criterion: criterion.id, malformed: true },
        };
      }
      return {
        output: rubricJudgeOutput(criterion.id, criterion.score, `${criterion.id} rationale`),
        traceFiles: [],
        metadata: { mocked: true, criterion: criterion.id, repair: isRepair },
      };
    });

    await executeWorkbenchBuiltInAdapterCommand({
      adapterId: "rubric",
      requestPath,
      agentExecutor,
    });

    expect(agentExecutor).toHaveBeenCalledTimes(3);
    expect(callsByCriterion.get("factuality")).toHaveLength(2);
    expect(callsByCriterion.get("coverage")).toHaveLength(1);
    expect(repairRequests).toHaveLength(1);
    expect(repairRequests[0]!.prompt).toContain(criteria[0]!.description);
    expect(repairRequests[0]!.prompt).not.toContain(criteria[1]!.description);
    const adapterResult = await readWorkbenchAdapterOperationResult(path.join(root, "output"), "engine.run");
    expect(adapterResult.value.score).toBe(0.75);
    expect(adapterResult.value.metrics).toEqual({ score: 0.75 });
  });

  test("executes Workbench engine-resolve requests into engine cases", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-first-party-path-"));
    const tasksRoot = path.join(root, "tasks");
    const outputRoot = path.join(root, "output");
    await fs.mkdir(path.join(tasksRoot, "task-001", "tests"), { recursive: true });
    await fs.writeFile(
      path.join(tasksRoot, "task-001", "task.yaml"),
      "version: 3\ntask: Write ok.\nsplit: train\ntests:\n  path: tests\n",
    );
    await fs.writeFile(path.join(tasksRoot, "task-001", "tests", "test.sh"), "echo 1\n");
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.mkdir(outputRoot, { recursive: true });
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_engine_resolve_path",
      operation: "engine.resolve",
      invocation: {
        use: "workbench",
        with: {
          tasks: {
            path: "tasks",
          },
        },
      },
      paths: {
        workspace: root,
        output: outputRoot,
        result: path.join(outputRoot, "workbench-result.json"),
      },
    }, null, 2)}\n`);

    await executeWorkbenchBuiltInAdapterCommand({
      adapterId: "workbench",
      requestPath,
      outputRoot,
    });

    const result = await readWorkbenchAdapterOperationResult(outputRoot, "engine.resolve");
    const engineResolve = result.value;
    expect(engineResolve.cases).toHaveLength(1);
    expect(engineResolve.cases[0]).toMatchObject({
      id: "task-001",
      case: {
        version: 3,
        prompt: "Write ok.",
        split: "train",
      },
      files: {
        private: [{
          path: "test.sh",
          content: "echo 1\n",
        }],
      },
    });
    expect(result.feedback).toMatchObject({
      engineResolve: "workbench",
      path: "tasks",
    });
  });

  test("rejects direct task.yaml roots for Workbench engine resolve", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-direct-task-root-"));
    const tasksRoot = path.join(root, "tasks");
    const outputRoot = path.join(root, "output");
    await fs.mkdir(path.join(tasksRoot, "tests"), { recursive: true });
    await fs.writeFile(
      path.join(tasksRoot, "task.yaml"),
      "version: 3\ntask: Write ok.\ntests:\n  path: tests\n",
    );
    await fs.writeFile(path.join(tasksRoot, "tests", "test.sh"), "echo 1\n");
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.mkdir(outputRoot, { recursive: true });
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_engine_resolve_direct_task_root",
      operation: "engine.resolve",
      invocation: {
        use: "workbench",
        with: {
          tasks: {
            path: "tasks",
          },
        },
      },
      paths: {
        workspace: root,
        output: outputRoot,
        result: path.join(outputRoot, "workbench-result.json"),
      },
    }, null, 2)}\n`);

    await expect(executeWorkbenchBuiltInAdapterCommand({
      adapterId: "workbench",
      requestPath,
      outputRoot,
    })).rejects.toThrow("Workbench engine tasks root must contain task directories");
  });

  test("delegates shared Workbench engine grading through one runtime-control sandbox", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-engine-shared-"));
    await fs.mkdir(path.join(root, "input", "candidate"), { recursive: true });
    await fs.mkdir(path.join(root, "input", "case"), { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.writeFile(path.join(root, "input", "candidate", "SKILL.md"), "Do the shared work.\n");
    await fs.writeFile(path.join(root, "input", "case", "prompt.md"), "Public shared task.\n");
    const calls: unknown[] = [];
    const token = "runtime-token";
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      expect(request.headers.authorization).toBe(`Bearer ${token}`);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      calls.push(body);
      expect(body.prepare).toBe(true);
      expect(body.collectWorkspace).toBeUndefined();
      expect(body).toMatchObject({
        operations: [
          { label: "candidate", operation: "candidate.run" },
          { label: "score", operation: "engine.run" },
        ],
      });
      const inputs = body.inputs as {
        candidate?: Array<{ path: string; content: string }>;
        case?: Array<{ path: string; content: string }>;
        enginePrivate?: Array<{ path: string; content: string }>;
        output?: unknown[];
        workspace?: unknown[];
      };
      expect(inputs.candidate).toEqual([
        expect.objectContaining({ path: "SKILL.md", content: "Do the shared work.\n" }),
      ]);
      expect(inputs.case).toEqual([
        expect.objectContaining({ path: "prompt.md", content: "Public shared task.\n" }),
      ]);
      expect(inputs.enginePrivate).toEqual([]);
      expect(inputs.output).toBeUndefined();
      expect(inputs.workspace).toBeUndefined();
      response.setHeader("content-type", "application/json");
      response.end(`${JSON.stringify({
        ok: true,
        files: [{
          path: "shared-score.txt",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "shared score\n",
        }],
        fileChanges: ["shared-score.txt"],
        operationResults: [{
          protocol: "workbench.adapter-result.v1",
          operation: "candidate.run",
          ok: true,
          usage: {
            total: {
              provider: "test",
              totalTokens: 2,
              costUsd: 0.02,
              costSource: "provider",
            },
          },
        }, {
          protocol: "workbench.adapter-result.v1",
          operation: "engine.run",
          ok: true,
          value: { score: 1 },
          usage: {
            total: {
              provider: "test",
              totalTokens: 3,
              costUsd: 0.03,
              costSource: "provider",
            },
          },
        }],
        result: { score: 1 },
      })}\n`);
    });
    const url = await listenOnLocalhost(server);
    vi.stubEnv("WORKBENCH_RUNTIME_CONTROL_URL", url);
    vi.stubEnv("WORKBENCH_RUNTIME_CONTROL_TOKEN", token);
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_workbench_engine_shared",
      operation: "engine.run",
      invocation: {
        use: "workbench",
        with: {
          score: {
            use: "inline-score",
            command: "score-command",
          },
        },
      },
      context: {
        candidate: {
          run: {
            use: "inline-candidate",
            command: "candidate-command",
          },
        },
        attempt: {
          caseId: "task-001",
        },
        case: {
          prompt: "Run candidate and score in one sandbox.",
        },
      },
      paths: adapterCommandPaths(root),
    }, null, 2)}\n`);

    try {
      await executeWorkbenchBuiltInAdapterCommand({
        adapterId: "workbench",
        requestPath,
      });
    } finally {
      await closeServer(server);
    }

    expect(calls).toHaveLength(1);
    const result = await readWorkbenchAdapterOperationResult(path.join(root, "output"), "engine.run");
    expect(result.value.score).toBe(1);
    expect(result.usage?.runner?.costUsd).toBe(0.02);
    expect(result.usage?.engine?.costUsd).toBe(0.03);
    await expect(fs.readFile(path.join(root, "output", "shared-score.txt"), "utf8"))
      .resolves.toBe("shared score\n");
  });

  test("delegates separate Workbench engine runner and grader sandboxes through runtime-control", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-engine-private-"));
    await fs.mkdir(path.join(root, "input", "candidate"), { recursive: true });
    await fs.mkdir(path.join(root, "input", "case"), { recursive: true });
    await fs.mkdir(path.join(root, "private", "engine"), { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.writeFile(path.join(root, "input", "candidate", "SKILL.md"), "Do the work.\n");
    await fs.writeFile(path.join(root, "input", "case", "prompt.md"), "Public task.\n");
    await fs.writeFile(path.join(root, "private", "engine", "secret.txt"), "hidden\n");
    const calls: unknown[] = [];
    const token = "runtime-token";
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      expect(request.headers.authorization).toBe(`Bearer ${token}`);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      calls.push(body);
      response.setHeader("content-type", "application/json");
      if (calls.length === 1) {
        expect(body.prepare).toBe(true);
        expect(body.collectWorkspace).toBe(true);
        expect(body).toMatchObject({
          operations: [{ operation: "candidate.run" }],
        });
        expect((body.inputs as { enginePrivate?: unknown[] }).enginePrivate).toBeUndefined();
        response.end(`${JSON.stringify({
          ok: true,
          files: [{
            path: "candidate-artifact.txt",
            kind: "text",
            encoding: "utf8",
            executable: false,
            content: "candidate\n",
          }, {
            path: ".workbench/traces/000001-run/000002-attempt/runtime-runner/runner/trace.json",
            kind: "text",
            encoding: "utf8",
            executable: false,
            content: "{\"trace\":true}\n",
          }],
          fileChanges: ["candidate-artifact.txt", ".workbench/traces/000001-run/000002-attempt/runtime-runner/runner/trace.json"],
          workspaceFiles: [{
            path: "answer.txt",
            kind: "text",
            encoding: "utf8",
            executable: false,
            content: "workspace\n",
          }],
          operationResults: [{
            protocol: "workbench.adapter-result.v1",
            operation: "candidate.run",
            ok: true,
          }],
          usage: {
            runner: {
              provider: "test",
              totalTokens: 4,
              costUsd: 0.04,
              costSource: "provider",
            },
          },
        })}\n`);
        return;
      }
      expect(body.prepare).toBe(false);
      expect(body).toMatchObject({
        operations: [{ operation: "engine.run" }],
      });
      const inputs = body.inputs as {
        workspace?: Array<{ path: string; content: string }>;
        output?: Array<{ path: string; content: string }>;
        enginePrivate?: Array<{ path: string; content: string }>;
      };
      expect(inputs.workspace).toEqual([
        expect.objectContaining({ path: "answer.txt", content: "workspace\n" }),
      ]);
      expect(inputs.output).toEqual([
        expect.objectContaining({ path: "candidate-artifact.txt", content: "candidate\n" }),
      ]);
      expect(inputs.output?.map((file) => file.path)).not.toContain(".workbench/traces/000001-run/000002-attempt/runtime-runner/runner/trace.json");
      expect(inputs.enginePrivate).toEqual([
        expect.objectContaining({ path: "secret.txt", content: "hidden\n" }),
      ]);
      response.end(`${JSON.stringify({
        ok: true,
        files: [{
          path: "score-artifact.txt",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "score\n",
        }],
        fileChanges: ["score-artifact.txt"],
        operationResults: [{
          protocol: "workbench.adapter-result.v1",
          operation: "engine.run",
          ok: true,
          value: { score: 1 },
        }],
        usage: {
          engine: {
            provider: "test",
            totalTokens: 6,
            costUsd: 0.06,
            costSource: "provider",
          },
        },
        result: { score: 1 },
      })}\n`);
    });
    const url = await listenOnLocalhost(server);
    vi.stubEnv("WORKBENCH_RUNTIME_CONTROL_URL", url);
    vi.stubEnv("WORKBENCH_RUNTIME_CONTROL_TOKEN", token);
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_workbench_engine_private",
      operation: "engine.run",
      invocation: {
        use: "workbench",
        with: {
          score: {
            use: "inline-score",
            command: "score-command",
          },
        },
      },
      context: {
        candidate: {
          run: {
            use: "inline-candidate",
            command: "candidate-command",
          },
        },
        attempt: {
          caseId: "task-001",
        },
        case: {
          prompt: "Run candidate and score.",
        },
      },
      paths: adapterCommandPaths(root),
    }, null, 2)}\n`);

    try {
      await executeWorkbenchBuiltInAdapterCommand({
        adapterId: "workbench",
        requestPath,
      });
    } finally {
      await closeServer(server);
    }

    expect(calls).toHaveLength(2);
    const result = await readWorkbenchAdapterOperationResult(path.join(root, "output"), "engine.run");
    expect(result.value.score).toBe(1);
    expect(result.usage?.runner?.costUsd).toBe(0.04);
    expect(result.usage?.engine?.costUsd).toBe(0.06);
    expect((result.value as { usage?: unknown }).usage).toBeUndefined();
    await expect(fs.readFile(path.join(root, "output", "candidate-artifact.txt"), "utf8"))
      .resolves.toBe("candidate\n");
    await expect(fs.readFile(path.join(root, "output", "score-artifact.txt"), "utf8"))
      .resolves.toBe("score\n");
    await expect(fs.readFile(path.join(root, "output", ".workbench", "traces", "exec_workbench_engine_private", "runner", "trace.json"), "utf8"))
      .resolves.toBe("{\"trace\":true}\n");
  });

  test("requires command engines to publish an engine.run result", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-command-engine-"));
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_command_score",
      operation: "engine.run",
      invocation: {
        use: "command",
        with: {
          command: "true",
        },
      },
      paths: adapterCommandPaths(root),
    }, null, 2)}\n`);

    await expect(executeWorkbenchBuiltInAdapterCommand({
      adapterId: "command",
      requestPath,
    })).rejects.toThrow("Command engine must write workbench-result.json for engine.run.");
  });

  test("retries Claude agent turns that exit with a transient SIGTERM", async () => {
    let attempts = 0;
    const result = await executeWorkbenchAgentTurn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("claude exited before returning a terminal result with code null signal SIGTERM");
      }
      return {
        output: "ok",
        traceFiles: [],
        metadata: { attempts },
      };
    }, {} as Parameters<typeof executeWorkbenchAgentTurn>[1]);

    expect(result.output).toBe("ok");
    expect(attempts).toBe(2);
  });

  test("does not retry deterministic native CA certificate failures", async () => {
    let attempts = 0;

    await expect(
      executeWorkbenchAgentTurn(async () => {
        attempts += 1;
        throw new Error(
          "Codex could not verify TLS certificates because the runtime image has no native root CA certificates. Install ca-certificates in environment/Dockerfile. Original error: stream disconnected before completion: error sending request",
        );
      }, {} as Parameters<typeof executeWorkbenchAgentTurn>[1]),
    ).rejects.toThrow("ca-certificates");

    expect(attempts).toBe(1);
  });
});

function listenOnLocalhost(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Test server did not bind to a TCP address."));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function adapterCommandPaths(root: string) {
  return {
    workspace: root,
    output: path.join(root, "output"),
    result: path.join(root, "output", "workbench-result.json"),
    candidate: path.join(root, "input", "candidate"),
    case: path.join(root, "input", "case"),
    traces: path.join(root, "input", "traces"),
    enginePrivate: path.join(root, "private", "engine"),
  };
}

interface RubricTestCriterion {
  id: string;
  description: string;
  weight: number;
  score: number;
}

async function writeRubricRequest(
  root: string,
  options: {
    parallelism: number;
    criteria: RubricTestCriterion[];
  },
): Promise<string> {
  await fs.mkdir(path.join(root, "input", "task"), { recursive: true });
  await fs.mkdir(path.join(root, "output"), { recursive: true });
  await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
  const requestPath = path.join(root, ".workbench", "request.json");
  await fs.writeFile(requestPath, `${JSON.stringify({
    protocol: "workbench.adapter.v3",
    id: "exec_rubric_grade",
    jobId: "job_rubric_grade",
    operation: "engine.run",
    invocation: {
      use: "rubric",
      with: {
        instructions: "Score only the runner output.",
        parallelism: options.parallelism,
        judge: {
          use: "codex",
          with: {
            model: "gpt-5.4-mini",
          },
        },
        criteria: options.criteria.map((criterion) => ({
          id: criterion.id,
          description: criterion.description,
          weight: criterion.weight,
        })),
      },
    },
    auth: {
      self: {},
      adapters: {
        codex: {
          default: {
            method: "api-key",
            profile: "default",
            env: { OPENAI_API_KEY: "materialized" },
          },
        },
      },
    },
    context: {
      benchmark: {
        name: "rubric-smoke",
        description: "Smoke test rubric adapter command.",
      },
      candidate: {
        id: "candidate_123",
      },
      attempt: {
        attemptIndex: 0,
        sampleIndex: 0,
        caseId: "task-001",
      },
      case: {
        prompt: "Score the runner output.",
      },
    },
    paths: adapterCommandPaths(root),
  }, null, 2)}\n`);
  return requestPath;
}

function singleCriterionFromPrompt(
  prompt: string,
  criteria: readonly RubricTestCriterion[],
): RubricTestCriterion {
  const matches = criteria.filter((criterion) => prompt.includes(criterion.description));
  expect(matches.map((criterion) => criterion.id)).toHaveLength(1);
  return matches[0]!;
}

function rubricJudgeOutput(criterionId: string, score: number, rationale: string): string {
  return JSON.stringify({
    criterion_id: criterionId,
    score,
    pass: score >= 0.5,
    rationale,
    summary: `${criterionId} graded`,
    feedback: { mocked: true },
  });
}

function mockAgentTraceFile(
  request: WorkbenchAgentTurnRequest,
  criterionId: string,
  turn: "judge" | "repair",
) {
  const tracePath = request.tracePath ?? `.workbench/traces/${request.jobId}/${request.role}`;
  return {
    path: `${tracePath}/session/trace.json`,
    kind: "text" as const,
    encoding: "utf8" as const,
    executable: false,
    content: `${JSON.stringify({
      trace_id: `${criterionId}-${turn}`,
      spans: [{
        id: `${criterionId}-${turn}`,
        parent_id: null,
        attempt_number: 1,
        stage_id: "workbench-engine",
        stage_run_index: 1,
        kind: "turn",
        title: `${turn === "judge" ? "Judge" : "Repair"} criterion ${criterionId}`,
        status: "completed",
        started_at: "2026-05-14T00:00:00.000Z",
        ended_at: "2026-05-14T00:00:01.000Z",
        attributes: {},
      }],
      events: [{
        id: `${criterionId}-${turn}-event`,
        span_id: `${criterionId}-${turn}`,
        attempt_number: 1,
        stage_id: "workbench-engine",
        stage_run_index: 1,
        kind: "message",
        at: "2026-05-14T00:00:00.500Z",
        message: `${criterionId} ${turn} trace event`,
        attributes: {},
      }],
      summaries: [{
        attempt_number: 1,
        stage_id: "workbench-engine",
        stage_run_index: 1,
        status: "completed",
        started_at: "2026-05-14T00:00:00.000Z",
        ended_at: "2026-05-14T00:00:01.000Z",
        duration_ms: 1000,
        tool_call_count: 0,
        input_tokens: null,
        output_tokens: null,
        usage: null,
        final_output_present: true,
        error_message: null,
      }],
    }, null, 2)}\n`,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
