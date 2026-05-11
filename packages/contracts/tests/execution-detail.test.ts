import { describe, expect, test } from "vitest";

import {
  ExecutionSchema,
  WorkspaceStatusSchema,
  isWorkflowExecution,
  workflowIdForExecution,
} from "../src/index.js";

describe("WorkspaceStatusSchema", () => {
  test("accepts retained, pruned, and not_created workspace states", () => {
    expect(
      WorkspaceStatusSchema.array().parse([
        "retained",
        "pruned",
        "not_created",
      ]),
    ).toEqual(["retained", "pruned", "not_created"]);
  });

  test("defaults missing execution workspace_mode to managed", () => {
    const execution = ExecutionSchema.parse({
      id: "exec_123",
      owner: {
        kind: "workflow",
        id: "demo",
      },
      workflow_state: "in_progress",
      lifecycle_state: "queued",
      attempts: [],
      workspace_path: "/tmp/demo",
      start_git_ref: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    expect(execution.workspace_mode).toBe("managed");
  });

  test("projects workflow execution owners", () => {
    const workflowExecution = ExecutionSchema.parse({
      id: "exec_workflow",
      owner: {
        kind: "workflow",
        id: "demo",
      },
      workflow_state: "queued",
      lifecycle_state: "queued",
      attempts: [],
      workspace_mode: "managed",
      workspace_path: "/tmp/demo",
      start_git_ref: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    expect(isWorkflowExecution(workflowExecution)).toBe(true);
    expect(workflowIdForExecution(workflowExecution)).toBe("demo");
  });
});
