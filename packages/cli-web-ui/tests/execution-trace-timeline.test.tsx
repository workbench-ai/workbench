// @vitest-environment jsdom

import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ExecutionTraceTimeline } from "../components/shared/execution-trace-timeline";
import {
  buildExecutionTraceTimeline,
  type ExecutionTimeline,
} from "../lib/execution-trace-timeline";

describe("execution trace timeline", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  test("content layout shows full session rows without hidden toggles or nested trace boxes", async () => {
    await renderTimeline(createTimeline());

    expect(container.textContent).toContain("subject prompt body");
    expect(container.textContent).toContain("engine verifier note body");
    expect(container.textContent).toContain("agent final answer body");
    expect(container.textContent).not.toContain("Show notes");
    expect(container.querySelector("[data-testid='timeline-step-map']")).toBeNull();
    expect(container.querySelector("[data-testid='timeline-stage-list']")).toBeNull();
    expect(container.querySelectorAll("[data-testid='timeline-row-details']")).toHaveLength(3);
    expect(
      [...container.querySelectorAll("[data-testid='timeline-row-summary']")]
        .every((element) => element.tagName !== "BUTTON"),
    ).toBe(true);
  });

  test("single tool traces surface the recorded event message", () => {
    const timeline = buildExecutionTraceTimeline({
      trace: {
        trace_id: "verifier-trace",
        spans: [
          {
            id: "verifier",
            parent_id: null,
            attempt_number: 1,
            stage_id: "attempt",
            stage_run_index: null,
            kind: "tool_call",
            title: "Harbor verifier",
            status: "completed",
            started_at: "2026-05-14T00:00:00.000Z",
            ended_at: "2026-05-14T00:00:00.001Z",
            attributes: {},
          },
        ],
        events: [
          {
            id: "verifier-output",
            span_id: "verifier",
            attempt_number: 1,
            stage_id: "attempt",
            stage_run_index: null,
            kind: "output",
            at: "2026-05-14T00:00:00.001Z",
            message: "workbook and required sheets present",
            attributes: {},
          },
        ],
        summaries: [
          {
            attempt_number: 1,
            stage_id: "attempt",
            stage_run_index: null,
            status: "completed",
            started_at: "2026-05-14T00:00:00.000Z",
            ended_at: "2026-05-14T00:00:00.001Z",
            duration_ms: 1,
            tool_call_count: 1,
            input_tokens: null,
            output_tokens: null,
            final_output_present: true,
            error_message: null,
          },
        ],
      },
    });

    expect(timeline.groups[0]?.rows[0]?.body).toBe("workbook and required sheets present");
  });

  async function renderTimeline(executionTimeline: ExecutionTimeline) {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(ExecutionTraceTimeline, {
        executionTimeline,
        layout: "content",
      }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
});

function createTimeline(): ExecutionTimeline {
  const startedAt = "2026-05-14T00:00:00.000Z";
  const rows = [
    {
      id: "row-user",
      anchorId: "timeline-row-user",
      stageKey: "stage",
      turnId: "turn",
      kind: "user" as const,
      label: "User",
      tone: "outline" as const,
      title: "Prompt",
      body: "subject prompt body",
      detail: null,
      format: "text" as const,
      monospace: false,
      status: null,
      at: startedAt,
      durationMs: null,
      usage: null,
      live: false,
    },
    {
      id: "row-note",
      anchorId: "timeline-row-note",
      stageKey: "stage",
      turnId: null,
      kind: "note" as const,
      label: "Note",
      tone: "outline" as const,
      title: "Verifier note",
      body: "engine verifier note body",
      detail: null,
      format: "text" as const,
      monospace: false,
      status: null,
      at: "2026-05-14T00:00:01.000Z",
      durationMs: null,
      usage: null,
      live: false,
    },
    {
      id: "row-agent",
      anchorId: "timeline-row-agent",
      stageKey: "stage",
      turnId: "turn",
      kind: "agent" as const,
      label: "Agent",
      tone: "accent" as const,
      title: "Answer",
      body: "agent final answer body",
      detail: null,
      format: "text" as const,
      monospace: false,
      status: "completed" as const,
      at: "2026-05-14T00:00:02.000Z",
      durationMs: 1_000,
      usage: null,
      live: false,
    },
  ];
  return {
    groups: [
      {
        id: "stage",
        title: "Workbench runner",
        status: "completed",
        startedAt,
        durationMs: 3_000,
        rows,
      },
    ],
  };
}
