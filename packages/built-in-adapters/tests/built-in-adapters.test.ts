import { promises as fs } from "node:fs";
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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("built-in Workbench adapters", () => {
  test("publishes manifest-backed built-in adapters without extra command install", () => {
    const manifest = builtinWorkbenchAdapterManifest("codex");
    const workbench = builtinWorkbenchAdapterManifest("workbench");

    expect(manifest?.install.join("\n")).not.toContain("/usr/local/bin/workbench-adapter-codex");
    expect(manifest?.operations["skill.run"]?.command).toBe("workbench-adapter-codex");
    expect(workbench?.install).toEqual([]);
    expect(workbench?.operations).toMatchObject({
      "engine.resolve": { command: "workbench-adapter-workbench" },
    });
    expect(workbench?.operations["grade.run"]).toBeUndefined();
  });

  test("executes Codex-shaped agent adapters through an operation request", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-first-party-agent-"));
    await fs.mkdir(path.join(root, "input", "skill"), { recursive: true });
    await fs.mkdir(path.join(root, "input", "case"), { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "runtime-control"), { recursive: true });
    await fs.writeFile(path.join(root, "input", "skill", "SKILL.md"), "Do the case.\n");
    await fs.writeFile(path.join(root, ".workbench", "runtime-control", "skill.json"), "{\"secret\":\"BLUE-712\"}\n");
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_agent_run",
      jobId: "job_agent_run",
      operation: "skill.run",
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
        eval: {
          name: "adapter-smoke",
          description: "Smoke test first-party adapter command.",
        },
        skill: {
          id: "skill_123",
          path: "skill/files",
        },
        improve: {
          edits: ["SKILL.md"],
        },
        attempt: {
          attemptIndex: 0,
          sampleIndex: 0,
          caseId: "case-001",
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
      await expect(fs.stat(path.join(request.workspaceRoot, ".workbench"))).rejects.toMatchObject({ code: "ENOENT" });
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
        metadata: { mocked: true, sessionId: "session-test", model: "gpt-5.4-mini" },
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
    await expect(fs.readFile(path.join(root, "output", "skill-summary.md"), "utf8"))
      .resolves.toBe("agent output");
    await expect(fs.readFile(path.join(root, "output", "agent-session.json"), "utf8"))
      .resolves.toContain("\"ref\": \"codex:session-test\"");
    const result = await readWorkbenchAdapterOperationResult(path.join(root, "output"), "skill.run");
    expect(result.usage.runner.provider).toBe("openai/codex");
  });

  test("requires Workbench adapter auth before provider agent turns", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-first-party-agent-missing-auth-"));
    await fs.mkdir(path.join(root, "input", "skill"), { recursive: true });
    await fs.mkdir(path.join(root, "input", "case"), { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.writeFile(path.join(root, "input", "skill", "SKILL.md"), "Do the case.\n");
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_agent_missing_auth",
      jobId: "job_agent_missing_auth",
      operation: "skill.run",
      invocation: {
        use: "codex",
        with: {
          model: "gpt-5.4-mini",
        },
      },
      context: {
        eval: {
          name: "adapter-auth",
          description: "Provider auth guidance.",
        },
        skill: {
          id: "skill_123",
          path: "skill/files",
        },
        improve: {
          edits: ["SKILL.md"],
        },
        attempt: {
          attemptIndex: 0,
          sampleIndex: 0,
          caseId: "case-001",
        },
      },
      paths: adapterCommandPaths(root),
    }, null, 2)}\n`);
    const agentExecutor = vi.fn(async () => ({
      output: "should not run",
      traceFiles: [],
      metadata: {},
    }));

    await expect(executeWorkbenchBuiltInAdapterCommand({
      adapterId: "codex",
      requestPath,
      agentExecutor,
    })).rejects.toThrow("ADAPTER_AUTH_REQUIRED: codex disconnected. Next: codex login --device-auth.");
    expect(agentExecutor).not.toHaveBeenCalled();
  });

  test("defaults Codex agent turns to the supported Workbench model", async () => {
    const { codexHarness } = await import("@workbench-ai/agent-driver-openai-codex");

    expect(codexHarness().manifest.defaults.model).toBe("gpt-5.4-mini");
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
      prompt: "Score the case.",
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

  test("normalizes provider auth failures before retrying agent turns", async () => {
    const request = {
      role: "runner" as const,
      provider: { use: "claude" },
      workspaceRoot: "/workspace",
      cwd: "/workspace",
      prompt: "Run the case.",
      traceRoot: "/workspace/.workbench/trace",
      jobId: "job_auth_failure",
    };
    const executor = vi.fn(async () => {
      throw new Error("API Error: 401 {\"error\":\"invalid bearer token\"}");
    });

    await expect(executeWorkbenchAgentTurn(executor, request)).rejects.toThrow(
      "ADAPTER_AUTH_REQUIRED: claude disconnected. Next: claude setup-token.",
    );
    expect(executor).toHaveBeenCalledTimes(1);
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
    const adapterResult = await readWorkbenchAdapterOperationResult(path.join(root, "output"), "grade.run");
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
    const publicScorecard = JSON.parse(
      await fs.readFile(path.join(root, "output", "rubric-scorecard.json"), "utf8"),
    ) as { safeForImprover?: boolean; criteria?: Array<{ id?: string; rationale?: string }> };
    expect(publicScorecard.safeForImprover).toBe(true);
    expect(publicScorecard.criteria?.map((criterion) => criterion.rationale)).toContain("accuracy rationale");
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
      description: "Unique coverage criterion: the output addresses the whole case.",
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
    const adapterResult = await readWorkbenchAdapterOperationResult(path.join(root, "output"), "grade.run");
    expect(adapterResult.value.score).toBe(0.75);
    expect(adapterResult.value.metrics).toEqual({ score: 0.75 });
  });

  test("executes Workbench engine-resolve requests into engine cases", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-first-party-path-"));
    const casesRoot = path.join(root, "cases");
    const outputRoot = path.join(root, "output");
    await fs.mkdir(path.join(casesRoot, "case-001", "tests"), { recursive: true });
    await fs.writeFile(
      path.join(casesRoot, "case-001", "case.yaml"),
      "version: 1\ncase: Write ok.\nsplit: train\ntests:\n  path: tests\n",
    );
    await fs.writeFile(path.join(casesRoot, "case-001", "tests", "test.sh"), "echo 1\n");
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
          cases: {
            path: "cases",
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
      id: "case-001",
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
      path: "cases",
    });
  });

  test("rejects direct case.yaml roots for Workbench engine resolve", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-direct-case-root-"));
    const casesRoot = path.join(root, "cases");
    const outputRoot = path.join(root, "output");
    await fs.mkdir(path.join(casesRoot, "tests"), { recursive: true });
    await fs.writeFile(
      path.join(casesRoot, "case.yaml"),
      "version: 1\ncase: Write ok.\ntests:\n  path: tests\n",
    );
    await fs.writeFile(path.join(casesRoot, "tests", "test.sh"), "echo 1\n");
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.mkdir(outputRoot, { recursive: true });
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_engine_resolve_direct_case_root",
      operation: "engine.resolve",
      invocation: {
        use: "workbench",
        with: {
          cases: {
            path: "cases",
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
    })).rejects.toThrow("Workbench engine cases root must contain case directories");
  });

  test("rejects Workbench grade-run orchestration", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-engine-run-removed-"));
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_workbench_engine_removed",
      operation: "grade.run",
      invocation: {
        use: "workbench",
        with: {
          score: {
            use: "tests",
          },
        },
      },
      paths: adapterCommandPaths(root),
    }, null, 2)}\n`);

    await expect(executeWorkbenchBuiltInAdapterCommand({
      adapterId: "workbench",
      requestPath,
    })).rejects.toThrow("Workbench grade.run is not implemented by the workbench adapter");
  });

  test("requires command graders to publish a grade.run result", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-command-engine-"));
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_command_score",
      operation: "grade.run",
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
    })).rejects.toThrow("Command grader must write workbench-result.json for grade.run.");
  });

  test("reads tests engine results from OUTPUT_DIR/result.json", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-tests-engine-result-"));
    const enginePrivate = path.join(root, "private", "engine");
    await fs.mkdir(enginePrivate, { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.writeFile(
      path.join(enginePrivate, "test.sh"),
      "printf '{\"score\":0.5,\"summary\":\"half credit\",\"metrics\":{\"score\":0.5,\"coverage\":0.75}}\\n' > \"$OUTPUT_DIR/result.json\"\n",
    );
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_tests_result",
      operation: "grade.run",
      invocation: {
        use: "tests",
      },
      paths: adapterCommandPaths(root),
    }, null, 2)}\n`);

    await executeWorkbenchBuiltInAdapterCommand({
      adapterId: "tests",
      requestPath,
    });

    const result = await readWorkbenchAdapterOperationResult(path.join(root, "output"), "grade.run");
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ score: 0.5, summary: "half credit", metrics: { score: 0.5, coverage: 0.75 } });
  });

  test("turns failed test result files into scored improvement evidence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-tests-engine-failed-result-"));
    const enginePrivate = path.join(root, "private", "engine");
    await fs.mkdir(enginePrivate, { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.writeFile(
      path.join(enginePrivate, "test.sh"),
      "printf '{\"ok\":false,\"message\":\"missing checklist\"}\\n' > \"$OUTPUT_DIR/result.json\"\nexit 1\n",
    );
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_tests_failed_result",
      operation: "grade.run",
      invocation: {
        use: "tests",
      },
      context: {
        attempt: {
          caseId: "case-checklist",
        },
      },
      paths: adapterCommandPaths(root),
    }, null, 2)}\n`);

    await executeWorkbenchBuiltInAdapterCommand({
      adapterId: "tests",
      requestPath,
    });

    const result = await readWorkbenchAdapterOperationResult(path.join(root, "output"), "grade.run");
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      score: 0,
      summary: "missing checklist",
      cases: [expect.objectContaining({
        id: "case-checklist",
        status: "error",
      })],
    });
  });

  test("rejects tests engine result files that omit score and pass flag", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-tests-engine-missing-score-"));
    const enginePrivate = path.join(root, "private", "engine");
    await fs.mkdir(enginePrivate, { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.writeFile(
      path.join(enginePrivate, "test.sh"),
      "printf '{\"message\":\"missing score\"}\\n' > \"$OUTPUT_DIR/result.json\"\n",
    );
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_tests_missing_score",
      operation: "grade.run",
      invocation: {
        use: "tests",
      },
      paths: adapterCommandPaths(root),
    }, null, 2)}\n`);

    await expect(executeWorkbenchBuiltInAdapterCommand({
      adapterId: "tests",
      requestPath,
    })).rejects.toThrow("finite numeric score or boolean ok/passed/pass");
  });

  test("publishes direct adapter step progress", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-tests-engine-progress-"));
    const enginePrivate = path.join(root, "private", "engine");
    await fs.mkdir(enginePrivate, { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.writeFile(
      path.join(enginePrivate, "test.sh"),
      "printf '{\"ok\":true}\\n' > \"$OUTPUT_DIR/result.json\"\n",
    );
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_tests_progress",
      operation: "grade.run",
      invocation: {
        use: "tests",
      },
      progress: {
        projectId: "project_1",
        runId: "run_1",
        jobId: "job_1",
        executionId: "exec_1",
        attempt: 1,
        target: {
          url: "http://127.0.0.1:9/progress",
          token: "progress-token",
          transport: "stdout",
        },
      },
      paths: adapterCommandPaths(root),
    }, null, 2)}\n`);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await executeWorkbenchBuiltInAdapterCommand({
      adapterId: "tests",
      requestPath,
    });

    const events = stdout.mock.calls
      .map((call) => String(call[0] ?? ""))
      .filter((line) => line.startsWith("__WORKBENCH_PROGRESS__"))
      .flatMap((line) => {
        const envelope = JSON.parse(line.slice("__WORKBENCH_PROGRESS__".length)) as {
          body: { batch: { events: Array<{ payload: unknown; role?: string }> } };
        };
        return envelope.body.batch.events;
      });
    expect(events).toEqual([
      expect.objectContaining({
        role: "engine",
        payload: expect.objectContaining({
          step: "tests.grade.run",
          status: "started",
        }),
      }),
      expect.objectContaining({
        role: "engine",
        payload: expect.objectContaining({
          step: "tests.grade.run",
          status: "succeeded",
        }),
      }),
    ]);
  });

  test("fails tests engine runs that write no result output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-tests-engine-no-result-"));
    const enginePrivate = path.join(root, "private", "engine");
    await fs.mkdir(enginePrivate, { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.writeFile(path.join(enginePrivate, "test.sh"), "exit 0\n");
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_tests_no_result",
      operation: "grade.run",
      invocation: {
        use: "tests",
      },
      paths: adapterCommandPaths(root),
    }, null, 2)}\n`);

    await expect(executeWorkbenchBuiltInAdapterCommand({
      adapterId: "tests",
      requestPath,
    })).rejects.toThrow("did not find result.json");
  });

  test("rejects skill patches with malformed entries instead of dropping them", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-command-bad-patch-"));
    await fs.mkdir(path.join(root, "input", "skill"), { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.writeFile(path.join(root, "input", "skill", "SKILL.md"), "Original.\n");
    const badPatch = JSON.stringify({
      files: [
        { path: "SKILL.md", content: "Updated.\n" },
        { path: "missing-content.md" },
      ],
      fileChanges: ["SKILL.md"],
    });
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_command_bad_patch",
      operation: "skill.improve",
      invocation: {
        use: "command",
        with: {
          command: `cat > "$WORKBENCH_SKILL_PATCH" <<'WORKBENCH_PATCH_EOF'\n${badPatch}\nWORKBENCH_PATCH_EOF`,
        },
      },
      context: {
        improve: {
          edits: ["SKILL.md"],
        },
      },
      paths: adapterCommandPaths(root),
    }, null, 2)}\n`);

    await expect(executeWorkbenchBuiltInAdapterCommand({
      adapterId: "command",
      requestPath,
    })).rejects.toThrow(/files\[1\] must be an object with string path and content fields/u);
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
    }, testAgentTurnRequest("claude"));

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
      }, testAgentTurnRequest("codex")),
    ).rejects.toThrow("ca-certificates");

    expect(attempts).toBe(1);
  });
});

function testAgentTurnRequest(provider: string): WorkbenchAgentTurnRequest {
  const root = os.tmpdir();
  return {
    role: "runner",
    provider: { use: provider },
    workspaceRoot: root,
    cwd: root,
    prompt: "Run the test request.",
    traceRoot: root,
    jobId: "job_test_agent_turn",
  };
}

function adapterCommandPaths(root: string) {
  return {
    workspace: root,
    output: path.join(root, "output"),
    result: path.join(root, "output", "workbench-result.json"),
    skill: path.join(root, "input", "skill"),
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
  await fs.mkdir(path.join(root, "input", "case"), { recursive: true });
  await fs.mkdir(path.join(root, "output"), { recursive: true });
  await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
  const requestPath = path.join(root, ".workbench", "request.json");
  await fs.writeFile(requestPath, `${JSON.stringify({
    protocol: "workbench.adapter.v3",
    id: "exec_rubric_grade",
    jobId: "job_rubric_grade",
    operation: "grade.run",
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
      eval: {
        name: "rubric-smoke",
        description: "Smoke test rubric adapter command.",
      },
      skill: {
        id: "skill_123",
      },
      attempt: {
        attemptIndex: 0,
        sampleIndex: 0,
        caseId: "case-001",
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
