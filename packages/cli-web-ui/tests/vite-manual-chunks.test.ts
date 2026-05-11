import { describe, expect, test } from "vitest";

import { sharedWebManualChunks } from "../lib/vite-manual-chunks";

describe("shared vite manual chunks", () => {
  test("keeps app source in the default chunk", () => {
    expect(sharedWebManualChunks("/repo/src/app.tsx")).toBeUndefined();
  });

  test.each([
    ["node_modules/pdfjs-dist/build/pdf.mjs", "pdf-preview"],
    ["node_modules/react/index.js", "react-vendor"],
    ["node_modules/@radix-ui/react-dialog/dist/index.mjs", "react-vendor"],
    ["node_modules/@xyflow/react/dist/index.js", "graph-vendor"],
    ["node_modules/recharts/es6/index.js", "chart-vendor"],
    ["node_modules/class-variance-authority/dist/index.mjs", "ui-vendor"],
  ])("maps %s to %s", (id, expected) => {
    expect(sharedWebManualChunks(`/repo/${id}`)).toBe(expected);
  });

  test("leaves preview libraries to their own lazy chunk strategy", () => {
    expect(
      sharedWebManualChunks(
        "/repo/node_modules/monaco-editor/esm/vs/editor/editor.api.js",
      ),
    ).toBeUndefined();
  });
});
