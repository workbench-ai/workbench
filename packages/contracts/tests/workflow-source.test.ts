import { describe, expect, test } from "vitest";

import {
  formatWorkflowValidationDiagnostics,
  normalizeWorkflowIdFromName,
  parseWorkflowSourceYaml,
  stringifyWorkflowYaml,
  validateWorkflowSourceYaml,
  validateWorkflowSourceYamlDetailed,
  validateWorkflowSources,
} from "../src/index.js";

const defaultCodexHarness = {
  id: "openai/codex",
  auth: {
    strategy: "secret_ref",
    ref: "OPENAI_API_KEY",
  },
  model: "gpt-5.4",
  effort: "medium",
} as const;

function createDefaultHarnessCatalog() {
  return {
    default: {
      ...defaultCodexHarness,
    },
  };
}

function createWorkflowSpec(overrides: Record<string, unknown> = {}) {
  return {
    metadata: {
      id: "review-loop",
      name: "Review Loop",
      ...(overrides.metadata as Record<string, unknown> | undefined),
    },
    state: {
      initial: "in_progress",
      terminal: ["done", "failed", "canceled"],
      onRun: {
        completed: "done",
        failed: "failed",
        canceled: "canceled",
        ...((overrides.state as { onRun?: Record<string, unknown> } | undefined)
          ?.onRun ?? {}),
      },
      ...((overrides.state as Record<string, unknown> | undefined) ?? {}),
    },
    ingress:
      (overrides.ingress as unknown[] | undefined) ?? [
        {
          kind: "trigger",
          id: "manual",
          adapter: "flow/manual",
        },
      ],
    workspace: {
      ...((overrides.workspace as Record<string, unknown> | undefined) ?? {}),
    },
    pipeline: {
      inputs: (overrides.pipeline as { inputs?: unknown[] } | undefined)?.inputs,
      hooks: {
        ...((overrides.pipeline as { hooks?: Record<string, unknown> } | undefined)
          ?.hooks ?? {}),
      },
      stages:
        (overrides.pipeline as { stages?: unknown[] } | undefined)?.stages ?? [
          {
            id: "implement",
            harness: "default",
            prompt: "Do the work.",
          },
        ],
      harnesses:
        (overrides.pipeline as { harnesses?: Record<string, unknown> } | undefined)
          ?.harnesses ?? createDefaultHarnessCatalog(),
      ...((overrides.pipeline as Record<string, unknown> | undefined) ?? {}),
    },
    actions: overrides.actions as unknown[] | undefined,
    "x-flow-ui": (overrides["x-flow-ui"] as Record<string, unknown> | undefined),
    "x-runtime": (overrides["x-runtime"] as Record<string, unknown> | undefined),
  };
}

describe("workflow source helpers", () => {
  test("normalizes workflow ids from names through the shared helper", () => {
    expect(normalizeWorkflowIdFromName("Review Loop")).toBe("review-loop");
    expect(normalizeWorkflowIdFromName("  !!!  ")).toBe("workflow");
  });

  test("validates workflow YAML while ignoring x-* extension keys", () => {
    const source = stringifyWorkflowYaml(
      createWorkflowSpec({
        metadata: {
          name: "Review Loop",
          enabled: true,
          "x-meta-note": "preserved in source",
        },
        pipeline: {
          stages: [
            {
              id: "implement",
              harness: "default",
              prompt: "Do the work.",
              "x-stage-note": "still allowed in source",
            },
          ],
        },
        "x-runtime": {
          owner: "tests",
        },
      }),
    );

    expect(source).not.toContain("enabled: true");
    expect(source).not.toContain("config: {}");
    expect(source).toContain("x-meta-note: preserved in source");

    const result = validateWorkflowSourceYaml(source);

    expect(result.validation_error).toBeNull();
    expect(result.document).not.toBeNull();
    expect(result.workflow?.metadata?.name).toBe("Review Loop");
    expect(result.workflow?.workspace.mode).toBe("managed");
    expect(result.workflow?.stages[0]?.id).toBe("implement");
  });

  test("ignores x-flow-ui listing metadata as an unsupported extension key", () => {
    const source = stringifyWorkflowYaml(
      createWorkflowSpec({
        metadata: {
          id: "hidden-workflow",
          name: "Hidden Workflow",
        },
        state: {
          onRun: {
            completed: "waiting_for_input",
          },
        },
        pipeline: {
          inputs: [
            {
              id: "message",
              label: "Message",
              type: "textarea",
              required: true,
            },
          ],
          stages: [
            {
              id: "reply",
              harness: "default",
              prompt: "Respond to the user.",
              session: "resume",
            },
          ],
        },
        ingress: [
          {
            kind: "trigger",
            id: "manual",
            adapter: "flow/manual",
            config: {
              inputs: [
                {
                  ref: "message",
                  payload_key: "message",
                },
              ],
            },
          },
        ],
        "x-flow-ui": {
          listed: false,
        },
      }),
    );

    const result = validateWorkflowSourceYamlDetailed(source, {
      filePath: "/tmp/hidden-workflow.yaml",
    });

    expect(result.valid).toBe(true);
    expect(
      (result.document as { "x-flow-ui"?: { listed?: boolean } })["x-flow-ui"],
    ).toEqual({
      listed: false,
    });
    expect(result.workflow?.metadata?.id).toBe("hidden-workflow");
  });

  test("accepts an explicit project workspace mode", () => {
    const result = validateWorkflowSourceYaml(
      stringifyWorkflowYaml(
        createWorkflowSpec({
          metadata: {
            id: "project-workspace",
          },
          state: {
            initial: "queued",
            terminal: ["done"],
            onRun: {
              completed: "done",
              failed: null,
              canceled: null,
            },
          },
          workspace: {
            mode: "project",
            pruneTtlSeconds: 60,
          },
        }),
      ),
    );

    expect(result.validation_error).toBeNull();
    expect(result.workflow?.workspace.mode).toBe("project");
  });

  test("accepts zero-stage workflows without a harness catalog", () => {
    const result = validateWorkflowSourceYaml(
      stringifyWorkflowYaml(
        createWorkflowSpec({
          metadata: {
            id: "hook-only",
          },
          state: {
            initial: "queued",
            terminal: ["done"],
            onRun: {
              completed: "done",
              failed: null,
              canceled: null,
            },
          },
          pipeline: {
            hooks: {},
            stages: [],
            harnesses: {},
          },
        }),
      ),
    );

    expect(result.validation_error).toBeNull();
    expect(result.workflow?.stages).toEqual([]);
    expect(result.workflow?.harnesses).toEqual({});
  });

  test("accepts source-backed workflows through ingress", () => {
    const result = validateWorkflowSourceYaml(
      stringifyWorkflowYaml(
        createWorkflowSpec({
          metadata: {
            id: "linear-source",
          },
          state: {
            initial: "triage",
            terminal: ["done", "failed", "canceled"],
            onRun: {
              completed: "waiting_for_update",
              failed: "failed",
              canceled: "canceled",
            },
          },
          ingress: [
            {
              kind: "source",
              id: "linear",
              adapter: "linear/issues",
              config: {
                api_key_env: "LINEAR_API_KEY",
                project_slug: "flow-distro",
                active_states: ["Todo", "In Progress"],
                terminal_states: ["Done", "Canceled"],
              },
            },
          ],
          pipeline: {
            stages: [],
            harnesses: {},
          },
        }),
      ),
    );

    expect(result.validation_error).toBeNull();
    expect(result.workflow?.sources).toEqual([
      {
        id: "linear",
        adapter: "linear/issues",
        config: {
          api_key_env: "LINEAR_API_KEY",
          project_slug: "flow-distro",
          active_states: ["Todo", "In Progress"],
          terminal_states: ["Done", "Canceled"],
        },
      },
    ]);
  });

  test("parses workflow specs with inline pipelines into executable workflows", () => {
    const result = validateWorkflowSourceYaml(
      stringifyWorkflowYaml(
        createWorkflowSpec({
          ingress: [
            {
              kind: "trigger",
              id: "manual",
              adapter: "flow/manual",
            },
            {
              kind: "source",
              id: "linear",
              adapter: "linear/issues",
            },
          ],
          actions: [
            {
              id: "approve",
              label: "Approve",
              command: "exit 0",
              setState: "done",
            },
          ],
        }),
      ),
    );

    expect(result.validation_error).toBeNull();
    expect(result.workflow?.triggers).toEqual([
      {
        id: "manual",
        adapter: "flow/manual",
        config: {},
      },
    ]);
    expect(result.workflow?.sources).toEqual([
      {
        id: "linear",
        adapter: "linear/issues",
        config: {},
      },
    ]);
    expect(result.workflow?.hooks.before_run).toBeNull();
    expect(result.workflow?.actions?.[0]).toMatchObject({
      id: "approve",
      set_state: "done",
      start_new_attempt: false,
    });
  });

  test("rejects duplicate ingress ids", () => {
    const result = validateWorkflowSourceYamlDetailed(
      stringifyWorkflowYaml(
        createWorkflowSpec({
          ingress: [
            {
              kind: "trigger",
              id: "manual",
              adapter: "flow/manual",
            },
            {
              kind: "source",
              id: "manual",
              adapter: "linear/issues",
            },
          ],
        }),
      ),
    );

    expect(result.valid).toBe(false);
    expect(formatWorkflowValidationDiagnostics(result.diagnostics)).toContain(
      'ingress.1.id: Duplicate ingress id "manual"',
    );
  });

  test("accepts strict stage hook definitions", () => {
    const result = validateWorkflowSourceYaml(
      stringifyWorkflowYaml(
        createWorkflowSpec({
          pipeline: {
            hooks: {
              env: {
                SHARED: "1",
              },
            },
            stages: [
              {
                id: "implement",
                harness: "default",
                prompt: "Do the work.",
                hooks: {
                  before: "echo before",
                  after: "echo after",
                  afterGate: "echo after gate",
                  timeoutMs: 45_000,
                  env: {
                    STAGE: "1",
                  },
                },
              },
            ],
          },
        }),
      ),
    );

    expect(result.validation_error).toBeNull();
    expect(result.workflow?.stages[0]?.hooks).toEqual({
      before: "echo before",
      after: "echo after",
      after_gate: "echo after gate",
      timeout_ms: 45_000,
      env: {
        STAGE: "1",
      },
    });
  });

  test("rejects unknown stage hook keys", () => {
    const result = validateWorkflowSourceYamlDetailed(
      stringifyWorkflowYaml(
        createWorkflowSpec({
          pipeline: {
            stages: [
              {
                id: "implement",
                harness: "default",
                prompt: "Do the work.",
                hooks: {
                  before: "echo before",
                  during: "echo nope",
                },
              },
            ],
          },
        }),
      ),
      { filePath: "/tmp/invalid-stage-hooks.yaml" },
    );

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        path: ["pipeline", "stages", 0, "hooks", "during"],
        message: 'Unrecognized key: "during"',
        source: "schema",
      }),
    );
  });

  test("returns structured diagnostics with source ranges for schema errors", () => {
    const result = validateWorkflowSourceYamlDetailed(
      [
        "metadata:",
        "  id: broken",
        "state:",
        "  initial: []",
        "  terminal: [done]",
        "ingress: []",
        "workspace: {}",
        "pipeline:",
        "  hooks: {}",
        "  stages:",
        "    - id: implement",
        "      harness: default",
        "      prompt: Do the work.",
        "  harnesses:",
        "    default:",
        "      id: openai/codex",
        "      auth:",
        "        strategy: secret_ref",
        "        ref: OPENAI_API_KEY",
      ].join("\n"),
      { filePath: "/tmp/broken.yaml" },
    );

    expect(result.valid).toBe(false);
    expect(result.workflow).toBeNull();
    expect(result.workflow_id).toBe("broken");
    expect(result.diagnostics[0]).toMatchObject({
      source: "schema",
      code: "invalid_type",
      path: ["state", "initial"],
      file_path: "/tmp/broken.yaml",
    });
    expect(result.diagnostics[0]?.range?.start.line).toBe(4);
    expect(result.diagnostics[0]?.range?.start.column).toBeGreaterThan(1);
  });

  test("reports semantic validation issues through structured diagnostics", () => {
    const source = stringifyWorkflowYaml(
      createWorkflowSpec({
        pipeline: {
          stages: [
            {
              id: "implement",
              harness: "default",
              prompt: "Do the work.",
            },
            {
              id: "implement",
              harness: "default",
              prompt: "Review the work.",
            },
          ],
        },
      }),
    );

    const result = validateWorkflowSourceYamlDetailed(source, {
      filePath: "/tmp/duplicate-stage.yaml",
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        source: "semantic",
        code: "duplicate_stage_id",
        path: ["pipeline", "stages", 1, "id"],
      }),
    );
    expect(formatWorkflowValidationDiagnostics(result.diagnostics)).toContain(
      'Duplicate stage id "implement"',
    );
  });

  test("detects duplicate effective workflow ids across multiple files", () => {
    const first = stringifyWorkflowYaml(
      createWorkflowSpec({
        metadata: {
          id: "shared",
        },
      }),
    );

    const second = stringifyWorkflowYaml(
      createWorkflowSpec({
        metadata: {
          id: "shared",
        },
        pipeline: {
          stages: [
            {
              id: "review",
              harness: "default",
              prompt: "Review the work.",
            },
          ],
        },
      }),
    );

    const result = validateWorkflowSources([
      {
        file_path: "/tmp/first.yaml",
        source_yaml: first,
      },
      {
        file_path: "/tmp/second.yaml",
        source_yaml: second,
      },
    ]);

    expect(result.valid).toBe(false);
    expect(formatWorkflowValidationDiagnostics(result.diagnostics)).toContain(
      'duplicate workflow id "shared"',
    );
  });

  test("parses a valid workflow source into an executable workflow", () => {
    const source = stringifyWorkflowYaml(
      createWorkflowSpec({
        metadata: {
          id: "parse-me",
        },
      }),
    );

    const parsed = parseWorkflowSourceYaml(source, {
      contextLabel: "parse-me.yaml",
    });

    expect(parsed.document).not.toBeNull();
    expect(parsed.workflow.metadata?.id).toBe("parse-me");
    expect(parsed.workflow.triggers[0]?.id).toBe("manual");
  });
});
