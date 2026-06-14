import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

function workspaceSource(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: {
      "@workbench-ai/workbench-contract": workspaceSource("../contract/src/index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
