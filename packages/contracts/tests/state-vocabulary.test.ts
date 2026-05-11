import { describe, expect, test } from "vitest";

import {
  HarnessSchema,
  collectWorkflowStateVocabulary,
  describeWorkflowStateSemantics,
  WorkflowDocumentSchema,
  type WorkflowDocument,
} from "../src/index.js";

const defaultCodexHarness = HarnessSchema.parse({
  id: "openai/codex",
  auth: {
    strategy: "secret_ref",
    ref: "OPENAI_API_KEY",
  },
  model: "gpt-5.4",
  effort: "medium",
});

function createWorkflow(overrides: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return WorkflowDocumentSchema.parse({
    metadata: {
      id: "review-loop",
      enabled: true,
      ...overrides.metadata,
    },
    state: {
      initial: "in_progress",
      terminal: ["done", "canceled"],
      on_attempt: {
        completed: "ready_for_review",
        failed: "failed",
        canceled: "canceled",
        ...overrides.state?.on_attempt,
      },
      ...overrides.state,
    },
    triggers: overrides.triggers ?? [],
    workspace: {
      prune_ttl_seconds: 60,
      ...overrides.workspace,
    },
    hooks: {
      after_create: null,
      before_run: null,
      after_run: null,
      before_remove: null,
      timeout_ms: 60_000,
      ...overrides.hooks,
    },
    stages: overrides.stages ?? [
      {
        id: "implement",
        harness: "default",
        prompt: "Implement the change.",
        gate: null,
      },
    ],
    actions: overrides.actions ?? [
      {
        id: "request_changes",
        label: "Request Changes",
        command: "printf request",
        confirm: false,
        timeout_ms: 30_000,
        set_state: "rework",
        start_new_attempt: true,
      },
      {
        id: "approve",
        label: "Approve",
        command: "printf approve",
        confirm: false,
        timeout_ms: 30_000,
        set_state: "done",
        start_new_attempt: false,
      },
    ],
    harnesses: {
      default: defaultCodexHarness,
      ...(overrides.harnesses ?? {}),
    },
  });
}

describe("collectWorkflowStateVocabulary", () => {
  test("places non-terminal workflow states before declared terminal states", () => {
    const workflow = createWorkflow();

    expect(collectWorkflowStateVocabulary(workflow)).toEqual([
      "in_progress",
      "ready_for_review",
      "failed",
      "rework",
      "done",
      "canceled",
    ]);
  });

  test("deduplicates repeated states while preserving declared terminal order", () => {
    const workflow = createWorkflow({
      metadata: {
        id: "dedupe-order",
        enabled: true,
      },
      state: {
        initial: "queued",
        terminal: ["canceled", "done", "canceled"],
        on_attempt: {
          completed: "done",
          failed: "blocked",
          canceled: "canceled",
        },
      },
      actions: [
        {
          id: "retry",
          label: "Retry",
          command: "printf retry",
          confirm: false,
          timeout_ms: 30_000,
          set_state: "blocked",
          start_new_attempt: false,
        },
        {
          id: "finish",
          label: "Finish",
          command: "printf finish",
          confirm: false,
          timeout_ms: 30_000,
          set_state: "done",
          start_new_attempt: false,
        },
      ],
    });

    expect(collectWorkflowStateVocabulary(workflow)).toEqual(["queued", "blocked", "canceled", "done"]);
  });
});

describe("describeWorkflowStateSemantics", () => {
  test("marks initial state semantics", () => {
    expect(describeWorkflowStateSemantics(createWorkflow(), "in_progress")).toEqual({
      state: "in_progress",
      isInitial: true,
      isTerminal: false,
      fromAttemptCompleted: false,
      fromAttemptFailed: false,
      fromAttemptCanceled: false,
      actionTargets: [],
    });
  });

  test("marks non-terminal attempt completion semantics", () => {
    expect(describeWorkflowStateSemantics(createWorkflow(), "ready_for_review")).toEqual({
      state: "ready_for_review",
      isInitial: false,
      isTerminal: false,
      fromAttemptCompleted: true,
      fromAttemptFailed: false,
      fromAttemptCanceled: false,
      actionTargets: [],
    });
  });

  test("marks non-terminal attempt failure semantics", () => {
    expect(describeWorkflowStateSemantics(createWorkflow(), "failed")).toEqual({
      state: "failed",
      isInitial: false,
      isTerminal: false,
      fromAttemptCompleted: false,
      fromAttemptFailed: true,
      fromAttemptCanceled: false,
      actionTargets: [],
    });
  });

  test("marks non-terminal attempt canceled semantics when configured that way", () => {
    const workflow = createWorkflow({
      state: {
        initial: "in_progress",
        terminal: ["done"],
        on_attempt: {
          completed: "ready_for_review",
          failed: "failed",
          canceled: "paused_elsewhere",
        },
      },
    });

    expect(describeWorkflowStateSemantics(workflow, "paused_elsewhere")).toEqual({
      state: "paused_elsewhere",
      isInitial: false,
      isTerminal: false,
      fromAttemptCompleted: false,
      fromAttemptFailed: false,
      fromAttemptCanceled: true,
      actionTargets: [],
    });
  });

  test("marks action targets with start_new_attempt", () => {
    expect(describeWorkflowStateSemantics(createWorkflow(), "rework")).toEqual({
      state: "rework",
      isInitial: false,
      isTerminal: false,
      fromAttemptCompleted: false,
      fromAttemptFailed: false,
      fromAttemptCanceled: false,
      actionTargets: [
        {
          id: "request_changes",
          label: "Request Changes",
          startNewAttempt: true,
        },
      ],
    });
  });

  test("marks action targets without start_new_attempt", () => {
    expect(describeWorkflowStateSemantics(createWorkflow(), "done")).toEqual({
      state: "done",
      isInitial: false,
      isTerminal: true,
      fromAttemptCompleted: false,
      fromAttemptFailed: false,
      fromAttemptCanceled: false,
      actionTargets: [
        {
          id: "approve",
          label: "Approve",
          startNewAttempt: false,
        },
      ],
    });
  });

  test("marks overlapping terminal canceled semantics", () => {
    expect(describeWorkflowStateSemantics(createWorkflow(), "canceled")).toEqual({
      state: "canceled",
      isInitial: false,
      isTerminal: true,
      fromAttemptCompleted: false,
      fromAttemptFailed: false,
      fromAttemptCanceled: true,
      actionTargets: [],
    });
  });

  test("falls back to neutral semantics for unknown states", () => {
    expect(describeWorkflowStateSemantics(createWorkflow(), "out_of_band")).toEqual({
      state: "out_of_band",
      isInitial: false,
      isTerminal: false,
      fromAttemptCompleted: false,
      fromAttemptFailed: false,
      fromAttemptCanceled: false,
      actionTargets: [],
    });
  });
});
