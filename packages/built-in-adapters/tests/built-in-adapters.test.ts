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

  test("executes Codex-shaped agent adapters through the generic adapter command request", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-first-party-agent-"));
    await fs.mkdir(path.join(root, "input", "candidate"), { recursive: true });
    await fs.mkdir(path.join(root, "input", "task"), { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.writeFile(path.join(root, "input", "candidate", "SKILL.md"), "Do the task.\n");
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v1",
      execution: {
        id: "exec_agent_run",
        jobId: "job_agent_run",
        purpose: "run-task",
        candidateId: "cand_123",
        trialIndex: 0,
        sampleIndex: 0,
        caseId: "task-001",
      },
      adapter: {
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
      benchmark: {
        name: "adapter-smoke",
        description: "Smoke test first-party adapter command.",
      },
      candidate: {
        path: "candidate/skill",
      },
      optimizer: {
        edits: ["SKILL.md"],
      },
      task: {
        text: "Produce a concise result.",
      },
      paths: adapterCommandPaths(root),
      expectedOutputs: [],
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
    const result = JSON.parse(
      await fs.readFile(path.join(root, "output", ".workbench", "result.json"), "utf8"),
    );
    expect(result.usage.runner.provider).toBe("openai/codex");
  });

  test("executes rubric through the generic adapter command request", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-first-party-rubric-"));
    await fs.mkdir(path.join(root, "input", "task"), { recursive: true });
    await fs.mkdir(path.join(root, "input", "runner-output"), { recursive: true });
    await fs.mkdir(path.join(root, "output"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench"), { recursive: true });
    await fs.writeFile(path.join(root, "input", "runner-output", "answer.md"), "runner output\n");
    const requestPath = path.join(root, ".workbench", "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v1",
      execution: {
        id: "exec_rubric_grade",
        jobId: "job_rubric_grade",
        purpose: "grade-task",
        candidateId: "cand_123",
        trialIndex: 0,
        sampleIndex: 0,
        caseId: "task-001",
      },
      adapter: {
        use: "rubric",
        with: {
          instructions: "Grade only the runner output.",
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
      benchmark: {
        name: "rubric-smoke",
        description: "Smoke test rubric adapter command.",
      },
      task: {
        text: "Grade the runner output.",
      },
      paths: adapterCommandPaths(root),
      expectedOutputs: [{
        name: "scorecard",
        path: "/workspace/output/scorecard.json",
      }],
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
      role: "grader",
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
    expect(seenRequests[0]!.prompt).toContain("Grade only the runner output.");
    const scorecard = JSON.parse(
      await fs.readFile(path.join(root, "output", "scorecard.json"), "utf8"),
    );
    expect(scorecard).toMatchObject({
      score: 1,
      summary: "passed",
      metrics: {
        criterion__quality: 1,
      },
    });
    const result = JSON.parse(
      await fs.readFile(path.join(root, "output", ".workbench", "result.json"), "utf8"),
    );
    expect(result.feedback.rubric).toBe("judge");
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
    input: path.join(root, "input"),
    output: path.join(root, "output"),
    candidate: path.join(root, "input", "candidate"),
    task: path.join(root, "input", "task"),
    runnerOutput: path.join(root, "input", "runner-output"),
    traces: path.join(root, "input", "traces"),
  };
}
