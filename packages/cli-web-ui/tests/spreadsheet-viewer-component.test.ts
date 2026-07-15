// @vitest-environment jsdom

import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SpreadsheetViewer } from "../components/shared/spreadsheet-viewer";
import type { WorkbookModel } from "../lib/spreadsheet-viewer-model";

describe("spreadsheet viewer interactions", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let scrollCalls: Array<{ top?: number; left?: number }>;
  let scrollToSpy: ReturnType<typeof vi.fn>;
  let requestAnimationFrameSpy: ReturnType<typeof vi.fn>;
  let cancelAnimationFrameSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    scrollCalls = [];
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    scrollToSpy = vi.fn(function scrollTo(
      this: HTMLElement,
      value: number | ScrollToOptions,
      top?: number,
    ) {
      if (typeof value === "number") {
        this.scrollLeft = value;
        this.scrollTop = top ?? this.scrollTop;
        scrollCalls.push({
          left: value,
          top,
        });
        return;
      }

      this.scrollLeft = value.left ?? this.scrollLeft;
      this.scrollTop = value.top ?? this.scrollTop;
      scrollCalls.push({
        left: value.left,
        top: value.top,
      });
    });
    requestAnimationFrameSpy = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    cancelAnimationFrameSpy = vi.fn();

    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollToSpy,
    });
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrameSpy);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameSpy);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  test("viewport sync renders a bounded row window instead of every row through the logical extent", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SpreadsheetViewer, {
        workbook: createWorkbook(),
      }));
    });

    const wrap = container.querySelector<HTMLDivElement>("[data-testid='sheet-grid-wrap']");

    expect(wrap).not.toBeNull();

    if (!wrap) {
      throw new Error("Expected spreadsheet scroll wrapper to render");
    }

    Object.defineProperties(wrap, {
      clientHeight: {
        configurable: true,
        value: 400,
      },
      clientWidth: {
        configurable: true,
        value: 640,
      },
      scrollHeight: {
        configurable: true,
        value: 1150,
      },
      scrollWidth: {
        configurable: true,
        value: 900,
      },
    });
    wrap.scrollTop = 0;
    wrap.scrollLeft = 0;
    const baselineScrollCalls = scrollCalls.length;

    await act(async () => {
      wrap.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(scrollCalls).toHaveLength(baselineScrollCalls);
    expect(container.querySelectorAll("[data-testid^='row-header-']").length).toBeLessThan(40);
    expect(container.querySelector("[data-testid='row-window-bottom-spacer']")).not.toBeNull();
  });

  test("viewer stretches to the preview width and mounts enough columns to cover it", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SpreadsheetViewer, {
        workbook: createWorkbook(),
      }));
    });

    const wrap = container.querySelector<HTMLDivElement>("[data-testid='sheet-grid-wrap']");

    expect(wrap).not.toBeNull();

    if (!wrap) {
      throw new Error("Expected spreadsheet scroll wrapper to render");
    }

    Object.defineProperties(wrap, {
      clientHeight: {
        configurable: true,
        value: 400,
      },
      clientWidth: {
        configurable: true,
        value: 928,
      },
      scrollHeight: {
        configurable: true,
        value: 900,
      },
      scrollWidth: {
        configurable: true,
        value: 928,
      },
    });

    await act(async () => {
      wrap.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(container.querySelectorAll("[data-testid^='col-header-']")).toHaveLength(6);
    expect(container.querySelector("[data-testid='col-header-f']")).not.toBeNull();
  });

  test("scrolling near the workbook edge does not materialize unbounded blank rows", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SpreadsheetViewer, {
        workbook: createWorkbook(),
      }));
    });

    const wrap = container.querySelector<HTMLDivElement>("[data-testid='sheet-grid-wrap']");

    expect(wrap).not.toBeNull();

    if (!wrap) {
      throw new Error("Expected spreadsheet scroll wrapper to render");
    }

    Object.defineProperties(wrap, {
      clientHeight: {
        configurable: true,
        value: 400,
      },
      clientWidth: {
        configurable: true,
        value: 640,
      },
      scrollHeight: {
        configurable: true,
        value: 1150,
      },
      scrollWidth: {
        configurable: true,
        value: 900,
      },
    });
    wrap.scrollTop = 680;
    wrap.scrollLeft = 120;
    const baselineScrollCalls = scrollCalls.length;

    await act(async () => {
      wrap.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(scrollCalls).toHaveLength(baselineScrollCalls);
    expect(container.querySelectorAll("[data-testid^='row-header-']").length).toBeLessThan(40);
    expect(container.querySelectorAll("[data-testid^='col-header-']")).toHaveLength(3);
    expect(container.querySelector("[data-testid='row-window-top-spacer']")).not.toBeNull();
    expect(container.querySelector("[data-testid='row-header-46']")).not.toBeNull();
    expect(container.querySelector("[data-testid='row-header-49']")).toBeNull();
  });
});

function createWorkbook(): WorkbookModel {
  return {
    activeSheetName: "Sheet1",
    sheets: {
      Sheet1: {
        range: {
          startCol: 0,
          endCol: 2,
          startRow: 0,
          endRow: 45,
        },
        hiddenRows: new Set<number>(),
        hiddenCols: new Set<number>(),
        mergeLookup: new Map(),
        mergeStartByAddress: new Map(),
        coveredCells: new Set(),
        colWidthMap: new Map([
          [0, 360],
          [1, 150],
          [2, 96],
        ]),
        rowHeightMap: new Map(),
        cells: new Map(),
        showGridLines: true,
        freezePanes: {
          rowCount: 0,
          columnCount: 0,
        },
      },
    },
  };
}
