// @vitest-environment jsdom

import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { parseSpreadsheetViewerWorkbookMock } = vi.hoisted(() => ({
  parseSpreadsheetViewerWorkbookMock: vi.fn(async (fileLike: { name: string }) => ({
    id: `${fileLike.name}:1`,
    label: fileLike.name,
    source: fileLike.name,
    sizeBytes: 1,
    workbook: {
      activeSheetName: "Sheet1",
      sheetNames: ["Sheet1"],
      sheets: {},
    },
  })),
}));

vi.mock("../spreadsheet-viewer", () => ({
  SpreadsheetViewer: ({ workbookFile }: { workbookFile: { label: string } }) =>
    createElement("div", { "data-testid": "mock-spreadsheet-viewer" }, workbookFile.label),
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
      "statement.xlsx",
    );

    act(() => {
      root?.unmount();
      root = null;
    });

    await renderPreview({ ...preview });
    expect(parseSpreadsheetViewerWorkbookMock).toHaveBeenCalledTimes(1);
  });

  async function renderPreview(preview: FilePreviewData) {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SpreadsheetFilePreview, {
        preview,
        fillHeight: true,
      }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
});

function createPreview(): FilePreviewData {
  return {
    path: "models/statement.xlsx",
    view: "rendered",
    mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    preview_kind: "spreadsheet",
    diff: null,
    source: {
      content: "UEsDBA==",
      encoding: "base64",
    },
    rendered_html: null,
  };
}
