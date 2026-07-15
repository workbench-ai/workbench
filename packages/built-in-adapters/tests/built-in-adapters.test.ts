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
import { builtinAgentTraceAdapters } from "../src/agent-trace-adapters.ts";
import {
  readWorkbenchAdapterOperationResult,
} from "@workbench-ai/workbench-protocol";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("built-in Workbench adapters", () => {
  test("publishes only the neutral Codex and Claude trace reducers", () => {
    expect(builtinAgentTraceAdapters().map((adapter) => adapter.id)).toEqual(["codex", "claude"]);
    expect(builtinAgentTraceAdapters()[0]).not.toHaveProperty("discoverSessions");
    expect(builtinAgentTraceAdapters()[0]).not.toHaveProperty("projectSession");
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
    })).rejects.toThrow("ADAPTER_AUTH_REQUIRED: codex disconnected. Next: workbench login codex.");
    expect(agentExecutor).not.toHaveBeenCalled();
  });

  test("defaults Codex agent turns to the supported Workbench model", async () => {
    const { codexHarness } = await import("@workbench-ai/agent-driver-openai-codex");

    expect(codexHarness().manifest.defaults.model).toBe("gpt-5.4-mini");
  });

  test("requires provider-owned timeouts and bounds stall by turn timeout", () => {
    expect(() => resolveAgentTurnTimeouts({})).toThrow("requires a positive turn_timeout_ms");
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

  test("does not add a Workbench retry loop around agent turns", async () => {
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
      throw new Error("turn stalled after 300000ms");
    });

    await expect(executeWorkbenchAgentTurn(executor, request)).rejects.toThrow(
      "turn stalled after 300000ms",
    );
    expect(executor).toHaveBeenCalledTimes(1);
  });

  test("reports provider auth failures without retrying agent turns", async () => {
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
      "ADAPTER_AUTH_REQUIRED: claude disconnected. Next: workbench login claude.",
    );
    expect(executor).toHaveBeenCalledTimes(1);
  });

  test("executes one rubric judge turn for all criteria and aggregates weighted metrics", async () => {
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
      criteria,
    });
    const seenRequests: WorkbenchAgentTurnRequest[] = [];
    const agentExecutor = vi.fn(async (request: WorkbenchAgentTurnRequest) => {
      seenRequests.push(request);
      return {
        output: rubricJudgeOutput(criteria),
        agentTrace: mockNeutralTrace("rubric-judge"),
        traceFiles: [
          mockAgentTraceFile(request, "all", "judge"),
          {
            path: `${request.tracePath!}/session/raw-events.ndjson`,
            kind: "text" as const,
            encoding: "utf8" as const,
            executable: false,
            content: "{\"private\":true}\n",
          },
        ],
        metadata: { mocked: true },
      };
    });

    await executeWorkbenchBuiltInAdapterCommand({
      adapterId: "rubric",
      requestPath,
      agentExecutor,
    });

    expect(agentExecutor).toHaveBeenCalledTimes(1);
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
    expect(criteria.every((criterion) => seenRequests[0]!.prompt.includes(criterion.description))).toBe(true);
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
      rubric: "single-judge",
      aggregation: "weighted_mean",
    });
    expect(engineResult.feedback.judge).toBe("codex");
    const publicScorecard = JSON.parse(
      await fs.readFile(path.join(root, "output", "rubric-scorecard.json"), "utf8"),
    ) as { safeForImprover?: boolean; criteria?: Array<{ id?: string; rationale?: string }> };
    expect(publicScorecard.safeForImprover).toBe(true);
    expect(publicScorecard.criteria?.map((criterion) => criterion.rationale)).toContain("accuracy rationale");
    const accuracyTrace = JSON.parse(
      await fs.readFile(
        path.join(root, "output", ".workbench", "traces", "job_rubric_grade", "engine", "rubric", "judge", "session", "trace.json"),
        "utf8",
      ),
    ) as { spans?: Array<{ title?: string }>; events?: Array<{ message?: string }> };
    expect(accuracyTrace.spans?.map((span) => span.title)).toContain("Judge criterion all");
    expect(accuracyTrace.events?.map((event) => event.message)).toContain("all judge trace event");
    await expect(fs.stat(
      path.join(root, "output", ".workbench", "traces", "job_rubric_grade", "engine", "rubric", "trace.json"),
    )).rejects.toThrow();
    await expect(fs.stat(
      path.join(root, "output", ".workbench", "traces", "job_rubric_grade", "engine", "rubric", "judge", "session", "raw-events.ndjson"),
    )).rejects.toThrow();
  });

  test("fails malformed rubric output without a repair turn", async () => {
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
      criteria,
    });
    const agentExecutor = vi.fn(async () => {
      return {
        output: "factuality: partial credit because the citation is malformed",
        agentTrace: mockNeutralTrace("malformed-judge"),
        traceFiles: [],
        metadata: { mocked: true, malformed: true },
      };
    });

    await expect(executeWorkbenchBuiltInAdapterCommand({
      adapterId: "rubric",
      requestPath,
      agentExecutor,
    })).rejects.toThrow("Rubric judge output must be a JSON object");

    expect(agentExecutor).toHaveBeenCalledTimes(1);
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

  test("reads command grader results from OUTPUT_DIR/result.json", async () => {
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
          command: "printf '{\"score\":0.75,\"summary\":\"command grade\",\"metrics\":{\"score\":0.75}}\\n' > \"$OUTPUT_DIR/result.json\"",
        },
      },
      paths: adapterCommandPaths(root),
    }, null, 2)}\n`);

    await executeWorkbenchBuiltInAdapterCommand({
      adapterId: "command",
      requestPath,
    });

    const result = await readWorkbenchAdapterOperationResult(path.join(root, "output"), "grade.run");
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ score: 0.75, summary: "command grade", metrics: { score: 0.75 } });
  });

  test("requires command graders to publish a public grade result", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-command-engine-missing-result-"));
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_command_missing_score",
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
    })).rejects.toThrow("Command grader must write $OUTPUT_DIR/result.json for grade.run.");
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

  test("runs tests engine scripts through their shebang interpreter", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-tests-engine-shebang-"));
    const enginePrivate = path.join(root, "private", "engine");
    await fs.mkdir(enginePrivate, { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.writeFile(
      path.join(enginePrivate, "test.sh"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "mkdir -p \"$OUTPUT_DIR\"",
        "printf '{\"ok\":true,\"score\":1,\"summary\":\"bash shebang honored\"}\\n' > \"$OUTPUT_DIR/result.json\"",
        "",
      ].join("\n"),
    );
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_tests_shebang",
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
    expect(result.value).toMatchObject({ score: 1, summary: "bash shebang honored" });
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

  test("does not retry transient provider exits", async () => {
    let attempts = 0;
    await expect(executeWorkbenchAgentTurn(async () => {
      attempts += 1;
      throw new Error("claude exited before returning a terminal result with code null signal SIGTERM");
    }, testAgentTurnRequest("claude"))).rejects.toThrow("signal SIGTERM");
    expect(attempts).toBe(1);
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

function rubricJudgeOutput(criteria: readonly RubricTestCriterion[]): string {
  return JSON.stringify({
    summary: "All criteria graded.",
    criteria: criteria.map((criterion) => ({
      id: criterion.id,
      score: criterion.score,
      pass: criterion.score >= 0.5,
      rationale: `${criterion.id} rationale`,
      evidence: [{
        path: "output/result.xlsx",
        locator: "Summary!B2",
        note: `${criterion.id} evidence`,
      }],
    })),
  });
}

function mockNeutralTrace(id: string) {
  return {
    id,
    events: [{
      id: "assistant:1",
      kind: "message" as const,
      role: "assistant" as const,
      channel: "visible" as const,
      text: "Judge output",
    }],
  };
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
