import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";
import type {
  WorkbenchAgentTurnRequest,
} from "../src/agent-turn.ts";

import {
  executeWorkbenchAgentTurn,
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

describe("built-in Workbench adapters", () => {
  test("prefers built adapter commands before monorepo TypeScript source fallbacks", () => {
    const manifest = builtinWorkbenchAdapterManifest("codex");
    const setup = manifest?.setup.join("\n") ?? "";
    const packageRunnerIndex = setup.indexOf("/workbench-runtime/node_modules/@workbench-ai/workbench-built-in-adapters/dist/bin/codex.js");
    const monorepoRunnerIndex = setup.indexOf("/workbench-runtime/products/workbench/packages/built-in-adapters/src/bin/codex.ts");

    expect(packageRunnerIndex).toBeGreaterThanOrEqual(0);
    expect(monorepoRunnerIndex).toBeGreaterThan(packageRunnerIndex);
    expect(setup).toContain("node --experimental-strip-types /workbench-runtime/products/workbench/packages/built-in-adapters/src/bin/codex.ts");
  });

  test("executes Codex-shaped agent adapters through an operation request", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-first-party-agent-"));
    await fs.mkdir(path.join(root, "input", "subject"), { recursive: true });
    await fs.mkdir(path.join(root, "input", "task"), { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.writeFile(path.join(root, "input", "subject", "SKILL.md"), "Do the task.\n");
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v2",
      id: "exec_agent_run",
      jobId: "job_agent_run",
      operation: "subject.run",
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
        subject: {
          id: "subject_123",
          path: "subject/skill",
        },
        optimizer: {
          edits: ["SKILL.md"],
        },
        trial: {
          trialIndex: 0,
          sampleIndex: 0,
          caseId: "task-001",
        },
        task: {
          text: "Produce a concise result.",
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
    await expect(fs.readFile(path.join(root, "output", "runner-summary.md"), "utf8"))
      .resolves.toBe("agent output");
    const result = await readWorkbenchAdapterOperationResult(path.join(root, "output"), "subject.run");
    expect(result.usage.runner.provider).toBe("openai/codex");
  });

  test("executes rubric through an operation request", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-first-party-rubric-"));
    await fs.mkdir(path.join(root, "input", "task"), { recursive: true });
    await fs.mkdir(path.join(root, "input", "runner-output"), { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.writeFile(path.join(root, "input", "runner-output", "answer.md"), "runner output\n");
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v2",
      id: "exec_rubric_grade",
      jobId: "job_rubric_grade",
      operation: "trial.score",
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
          criteria: [{
            id: "quality",
            description: "The output is complete.",
            weight: 1,
          }],
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
        subject: {
          id: "subject_123",
        },
        trial: {
          trialIndex: 0,
          sampleIndex: 0,
          caseId: "task-001",
        },
        task: {
          text: "Score the runner output.",
        },
      },
      paths: adapterCommandPaths(root),
    }, null, 2)}\n`);
    const seenRequests: WorkbenchAgentTurnRequest[] = [];
    const agentExecutor = vi.fn(async (request: WorkbenchAgentTurnRequest) => {
      seenRequests.push(request);
      return {
        output: JSON.stringify({
          score: 1,
          summary: "passed",
          criteria: [{
            criterion_id: "quality",
            score: 1,
            pass: true,
            rationale: "Complete output.",
          }],
          feedback: { mocked: true },
        }),
        traceFiles: [],
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
      role: "scorer",
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
    expect(seenRequests[0]!.prompt).toContain("Score only the runner output.");
    const result = await readWorkbenchAdapterOperationResult(path.join(root, "output"), "trial.score");
    const scorecard = result.value;
    expect(scorecard).toMatchObject({
      score: 1,
      summary: "passed",
      metrics: {
        criterion__quality: 1,
      },
    });
    expect(result.feedback.rubric).toBe("judge");
  });

  test("executes Harbor task-source requests into task bundles", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-first-party-harbor-"));
    const harborRoot = path.join(root, "harbor");
    const taskRoot = path.join(harborRoot, "workdir");
    const outputRoot = path.join(root, "output");
    await fs.mkdir(path.join(taskRoot, "environment"), { recursive: true });
    await fs.mkdir(path.join(taskRoot, "tests"), { recursive: true });
    await fs.writeFile(path.join(taskRoot, "instruction.md"), "Write ok to result.txt.\n");
    await fs.writeFile(path.join(taskRoot, "task.toml"), "[environment]\nworkdir = \"/app\"\n");
    await fs.writeFile(path.join(taskRoot, "environment", "Dockerfile"), "FROM node:22-bookworm-slim\n");
    await fs.writeFile(path.join(taskRoot, "tests", "test.sh"), "echo 1 > /logs/verifier/reward.txt\n");
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.mkdir(outputRoot, { recursive: true });
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v2",
      id: "exec_task_source",
      operation: "tasks.resolve",
      invocation: {
        use: "harbor",
        with: {
          path: harborRoot,
        },
      },
      paths: {
        workspace: root,
        cwd: root,
        output: outputRoot,
        result: path.join(outputRoot, "workbench-result.json"),
      },
    }, null, 2)}\n`);

    await executeWorkbenchBuiltInAdapterCommand({
      adapterId: "harbor",
      requestPath,
      outputRoot,
    });

    const result = await readWorkbenchAdapterOperationResult(outputRoot, "tasks.resolve");
    const taskSource = result.value;
    expect(taskSource.environment).toMatchObject({
      dockerfile: "harbor/workdir/environment/Dockerfile",
      workdir: "/app",
    });
    expect(taskSource.tasks).toHaveLength(1);
    expect(taskSource.tasks[0]).toMatchObject({
      id: "workdir",
      task: {
        version: 2,
        task: "Write ok to result.txt.",
        environment: {
          workdir: "/app",
        },
      },
    });
    expect(taskSource.tasks[0]!.testFiles.map((file) => file.path)).toEqual(["test.sh"]);
    expect(taskSource.tasks[0]!.sourceFiles.map((file) => file.path).sort()).toEqual([
      "environment/Dockerfile",
      "instruction.md",
      "task.toml",
      "tests/test.sh",
    ]);
    expect(result.feedback).toMatchObject({
      taskSource: "harbor",
      taskCount: 1,
    });
  });

  test("executes path task-source requests into task bundles", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-first-party-path-"));
    const tasksRoot = path.join(root, "tasks");
    const outputRoot = path.join(root, "output");
    await fs.mkdir(path.join(tasksRoot, "task-001", "tests"), { recursive: true });
    await fs.writeFile(
      path.join(tasksRoot, "task-001", "task.yaml"),
      "version: 2\ntask: Write ok.\ntests:\n  path: tests\n",
    );
    await fs.writeFile(path.join(tasksRoot, "task-001", "tests", "test.sh"), "echo 1\n");
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.mkdir(outputRoot, { recursive: true });
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v2",
      id: "exec_task_source_path",
      operation: "tasks.resolve",
      invocation: {
        use: "path",
        with: {
          path: "tasks",
        },
      },
      paths: {
        workspace: root,
        cwd: root,
        output: outputRoot,
        result: path.join(outputRoot, "workbench-result.json"),
      },
    }, null, 2)}\n`);

    await executeWorkbenchBuiltInAdapterCommand({
      adapterId: "path",
      requestPath,
      outputRoot,
    });

    const result = await readWorkbenchAdapterOperationResult(outputRoot, "tasks.resolve");
    const taskSource = result.value;
    expect(taskSource.tasks).toHaveLength(1);
    expect(taskSource.tasks[0]).toMatchObject({
      id: "task-001",
      task: {
        version: 2,
        task: "Write ok.",
      },
      testFiles: [{
        path: "test.sh",
        content: "echo 1\n",
      }],
    });
    expect(result.feedback).toMatchObject({
      taskSource: "path",
      path: "tasks",
    });
  });

  test("requires command scorers to publish a trial.score result", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-command-scorer-"));
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v2",
      id: "exec_command_score",
      operation: "trial.score",
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
    })).rejects.toThrow("Command scorer must write workbench-result.json for trial.score.");
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

function adapterCommandPaths(root: string) {
  return {
    workspace: root,
    cwd: root,
    input: path.join(root, "input"),
    output: path.join(root, "output"),
    result: path.join(root, "output", "workbench-result.json"),
    subject: path.join(root, "input", "subject"),
    task: path.join(root, "input", "task"),
    runnerOutput: path.join(root, "input", "runner-output"),
    traces: path.join(root, "input", "traces"),
  };
}
