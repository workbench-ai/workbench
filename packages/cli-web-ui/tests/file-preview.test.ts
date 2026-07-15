import { describe, expect, test } from "vitest";

import {
  isPreviewMode,
  supportedPreviewModes,
} from "../lib/file-preview";
import {
  detectSourceLanguage,
  formatSourceForDisplay,
} from "../lib/source-view";
import { parseTabularPreview } from "../lib/tabular-preview";

describe("file preview helpers", () => {
  test("orders preview modes with rendered first", () => {
    expect(supportedPreviewModes()).toEqual(["rendered", "raw"]);
  });

  test("recognizes only the supported preview modes", () => {
    expect(isPreviewMode("rendered")).toBe(true);
    expect(isPreviewMode("raw")).toBe(true);
    expect(isPreviewMode("diff")).toBe(false);
    expect(isPreviewMode("overview")).toBe(false);
    expect(isPreviewMode(null)).toBe(false);
  });

  test("detects source languages from path and pretty prints rendered json", () => {
    expect(detectSourceLanguage({ path: "notes.md" })).toBe("markdown");
    expect(
      formatSourceForDisplay("{\"ok\":true}", {
        path: "report.json",
        mode: "rendered",
      }),
    ).toBe('{\n  "ok": true\n}');
  });

  test("parses tabular previews into headers and rows", () => {
    const result = parseTabularPreview({
      path: "scores.csv",
      mimeType: "text/csv",
      raw: "name,score\nAda,2\nGrace,3\n",
    });

    expect(result).toMatchObject({
      ok: true,
      table: {
        kindLabel: "CSV",
        delimiter: ",",
        delimiterLabel: "Comma",
      },
    });
    if (!result.ok) {
      throw new Error("expected tabular preview to parse");
    }
    expect(result.table.columns.map((column) => column.label)).toEqual(["name", "score"]);
    expect(result.table.rows.map((row) => row.values)).toEqual([
      ["Ada", "2"],
      ["Grace", "3"],
    ]);
  });
});
