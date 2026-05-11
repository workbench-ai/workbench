import { describe, expect, test } from "vitest";

import { WorkflowDocumentSchema } from "../src/index.js";

const baseWorkflow = {
  metadata: {
    id: "auth-demo",
  },
  state: {
    initial: "in_progress",
    terminal: ["done", "failed", "canceled"],
  },
  triggers: [],
  workspace: {},
  hooks: {},
  stages: [
    {
      id: "implement",
      harness: "default",
      prompt: "Do the work.",
    },
  ],
};

describe("workflow harness auth schema", () => {
  test("accepts zero-stage workflows without a harness catalog", () => {
    const result = WorkflowDocumentSchema.safeParse({
      ...baseWorkflow,
      stages: [],
    });

    expect(result.success).toBe(true);
  });

  test("accepts a provider-defined harness auth object", () => {
    const result = WorkflowDocumentSchema.safeParse({
      ...baseWorkflow,
      harnesses: {
        default: {
          id: "acme/custom-harness",
          auth: {
            strategy: "oauth",
            tenant: "acme",
            audience: "flow",
          },
          config: {},
        },
      },
    });

    expect(result.success).toBe(true);
  });

  test("accepts an optional harness prepare command with env and timeout", () => {
    const result = WorkflowDocumentSchema.safeParse({
      ...baseWorkflow,
      harnesses: {
        default: {
          id: "openai/codex",
          auth: {
            strategy: "secret_ref",
            ref: "OPENAI_API_KEY",
          },
          prepare: {
            run: "./scripts/prepare-agent.sh",
            env: {
              SKILL_SOURCE: ".agents/skills",
            },
            timeout_ms: 1234,
          },
          config: {},
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.harnesses.default?.prepare).toEqual({
      run: "./scripts/prepare-agent.sh",
      env: {
        SKILL_SOURCE: ".agents/skills",
      },
      timeout_ms: 1234,
    });
  });

  test("rejects a missing harness id", () => {
    const result = WorkflowDocumentSchema.safeParse({
      ...baseWorkflow,
      harnesses: {
        default: {
          id: "",
          auth: {
            strategy: "secret_ref",
            ref: "ANTHROPIC_API_KEY",
          },
          config: {},
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join(".") === "harnesses.default.id")).toBe(true);
  });

  test("rejects stageful workflows without a harness catalog", () => {
    const result = WorkflowDocumentSchema.safeParse({
      ...baseWorkflow,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ["harnesses"],
        message: "harnesses is required when stages are configured",
      }),
    );
  });

  test("rejects non-object harness auth/config payloads", () => {
    const result = WorkflowDocumentSchema.safeParse({
      ...baseWorkflow,
      harnesses: {
        default: {
          id: "openai/codex",
          auth: "OPENAI_API_KEY",
          config: ["codex"],
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join(".") === "harnesses.default.auth")).toBe(true);
    expect(result.error?.issues.some((issue) => issue.path.join(".") === "harnesses.default.config")).toBe(true);
  });

  test("rejects non-object or non-string harness prepare payloads", () => {
    const result = WorkflowDocumentSchema.safeParse({
      ...baseWorkflow,
      harnesses: {
        default: {
          id: "openai/codex",
          auth: {
            strategy: "secret_ref",
            ref: "OPENAI_API_KEY",
          },
          prepare: {
            run: "",
            env: {
              BROKEN: 1,
            },
          },
          config: {},
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join(".") === "harnesses.default.prepare.run")).toBe(true);
    expect(result.error?.issues.some((issue) => issue.path.join(".") === "harnesses.default.prepare.env.BROKEN")).toBe(true);
  });
});
