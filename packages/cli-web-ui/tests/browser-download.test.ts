import { describe, expect, test } from "vitest";

import {
  basename,
  contentDispositionFilename,
  pickDownloadFilename,
} from "../lib/browser-download";

describe("browser-download helpers", () => {
  test("picks the trailing path segment as the fallback filename", () => {
    expect(basename("outputs/model.xlsx")).toBe("model.xlsx");
    expect(basename("/tmp/output/report.md?download=1")).toBe("report.md");
  });

  test("extracts quoted and utf-8 content-disposition filenames", () => {
    expect(contentDispositionFilename('inline; filename="model.xlsx"')).toBe("model.xlsx");
    expect(contentDispositionFilename("attachment; filename*=UTF-8''three%20statement.xlsx")).toBe(
      "three statement.xlsx",
    );
  });

  test("prefers the response header filename when present", () => {
    const headers = new Headers({
      "content-disposition": 'attachment; filename="artifact.bin"',
    });
    expect(pickDownloadFilename(headers, "fallback.bin")).toBe("artifact.bin");
  });
});
