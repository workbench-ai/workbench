// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { TranscriptFeed } from "../components/shared/transcript-feed";
import {
  buildExecutionTraceTranscript,
  type ExecutionTraceTranscript,
  type ExecutionTranscriptRow,
} from "../lib/execution-trace-transcript";

describe("transcript feed", () => {
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

  test("renders complete static execution evidence with accessible transcript structure", async () => {
    await renderTranscript(createTranscript());

    expect(container.textContent).toContain("subject prompt body");
    expect(container.textContent).toContain("engine verifier system body");
    expect(container.textContent).toContain("assistant final answer body");
    expect(countText(container, "subject prompt body")).toBe(1);
    expect(countText(container, "engine verifier system body")).toBe(1);
    expect(countText(container, "assistant final answer body")).toBe(1);
    expect(container.querySelectorAll("[data-testid='transcript-row-details']")).toHaveLength(3);
    expect(container.querySelector("[data-slot='message-scroller']")).not.toBeNull();
    expect(container.querySelector("[data-slot='message-scroller-viewport']")).not.toBeNull();
    expect(container.querySelector("[data-slot='message-scroller-content']")).not.toBeNull();
    expect(container.querySelectorAll("[data-slot='message']")).toHaveLength(3);
    expect(container.querySelectorAll("[data-slot='bubble']")).toHaveLength(3);
    expect(container.querySelector("[aria-label='Execution transcript']")?.getAttribute("role")).toBe("region");
  });

  test("long row bodies are collapsed until expanded", async () => {
    const transcript = createTranscript();
    transcript.groups[0]!.rows[2] = {
      ...transcript.groups[0]!.rows[2]!,
      body: {
        text: Array.from({ length: 40 }, (_, index) => `long answer line ${index + 1}`).join("\n"),
        format: "text",
      },
    };

    await renderTranscript(transcript);

    const summary = container.querySelector(
      "[data-row-kind='assistant'] [data-testid='transcript-row-summary']",
    );
    expect(container.querySelector("[data-testid='transcript-row-body-collapsible']")).not.toBeNull();
    expect(summary?.textContent).not.toContain("long answer line 1");
    expect(summary?.textContent).not.toContain("long answer line 40");
    expect(container.textContent).toContain("Show more");
  });

  test("large transcripts use the shared virtualized chat stream", async () => {
    const transcript = createTranscript();
    transcript.groups[0]!.rows = Array.from({ length: 60 }, (_, index) => ({
      ...transcript.groups[0]!.rows[index % 3]!,
      id: `row-${index}`,
      body: {
        text: `message body ${index}`,
        format: "text" as const,
      },
    }));

    await renderTranscript(transcript);

    expect(container.querySelector("[data-testid='transcript-tab']")?.getAttribute("data-virtualized")).toBe("true");
    expect(container.querySelector("[data-slot='message-scroller']")).not.toBeNull();
    expect(container.querySelector("[data-slot='message-scroller-viewport']")).not.toBeNull();
    expect(container.querySelectorAll("[data-testid='transcript-row']").length).toBeLessThan(60);
  });

  test("single tool traces surface the recorded event message", () => {
    const transcript = buildExecutionTraceTranscript({
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
        summaries: [],
      },
    });

    expect(transcript.groups[0]?.rows[0]?.body?.text).toBe("workbook and required sheets present");
  });

  async function renderTranscript(
    executionTranscript: ExecutionTraceTranscript,
  ) {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(TranscriptFeed, {
        transcript: executionTranscript,
      }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }
});

function countText(container: HTMLElement, value: string): number {
  return (container.textContent ?? "").split(value).length - 1;
}

function createTranscript(): ExecutionTraceTranscript {
  const startedAt = "2026-05-14T00:00:00.000Z";
  const rows = [
    transcriptRow("user", "Prompt", "subject prompt body", startedAt),
    transcriptRow("system", "Verifier system", "engine verifier system body", "2026-05-14T00:00:01.000Z"),
    transcriptRow("assistant", "Answer", "assistant final answer body", "2026-05-14T00:00:02.000Z", {
      durationMs: 1_000,
      tone: "accent",
    }),
  ];
  return {
    id: "trace",
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

function transcriptRow(
  kind: ExecutionTranscriptRow["kind"],
  title: string,
  text: string,
  at: string,
  overrides: Partial<ExecutionTranscriptRow> = {},
): ExecutionTranscriptRow {
  const id = `row-${kind}`;
  return {
    id,
    kind,
    label: kind[0]!.toUpperCase() + kind.slice(1),
    tone: "outline",
    title,
    body: { text, format: "text" },
    detail: null,
    monospace: false,
    at,
    durationMs: null,
    usage: null,
    live: false,
    ...overrides,
  };
}
