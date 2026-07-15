// @vitest-environment jsdom

import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { parseSpreadsheetViewerWorkbookMock } = vi.hoisted(() => ({
  parseSpreadsheetViewerWorkbookMock: vi.fn(() => ({
    activeSheetName: "Sheet1",
    sheets: { Sheet1: {} },
  })),
}));

vi.mock("../spreadsheet-viewer", () => ({
  SpreadsheetViewer: ({ workbook }: { workbook: { activeSheetName: string } }) =>
    createElement("div", { "data-testid": "mock-spreadsheet-viewer" }, workbook.activeSheetName),
  parseSpreadsheetViewerWorkbook: parseSpreadsheetViewerWorkbookMock,
}));

import { SpreadsheetFilePreview } from "../components/shared/spreadsheet-file-preview";
import type { FilePreviewData } from "../lib/file-preview";

describe("spreadsheet file preview", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    parseSpreadsheetViewerWorkbookMock.mockClear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  test("reuses cached workbook parses when the spreadsheet payload is unchanged", async () => {
    const preview = createPreview();

    await renderPreview(preview);
    expect(parseSpreadsheetViewerWorkbookMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid='mock-spreadsheet-viewer']")?.textContent).toBe(
      "Sheet1",
    );

    act(() => {
      root?.unmount();
      root = null;
    });

    await renderPreview({ ...preview });
    expect(parseSpreadsheetViewerWorkbookMock).toHaveBeenCalledTimes(1);
  });

  test("bounds a spreadsheet when its host does not provide a height", async () => {
    await renderPreview(createPreview("bounded.xlsx"));

    const classes = container
      .querySelector("[data-testid='preview-spreadsheet']")
      ?.className.split(" ");

    expect(classes).toContain("h-[min(36rem,70vh)]");
    expect(classes).toContain("overflow-hidden");
  });

  async function renderPreview(preview: FilePreviewData) {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SpreadsheetFilePreview, {
        preview,
      }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
});

function createPreview(fileName = "statement.xlsx"): FilePreviewData {
  return {
    path: `models/${fileName}`,
    view: "rendered",
    mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    preview_kind: "spreadsheet",
    source: {
      content: "UEsDBA==",
      encoding: "base64",
    },
  };
}
