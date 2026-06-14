import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

function workspaceSource(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: {
      "@workbench-ai/workbench": workspaceSource("./src/index.ts"),
      "@workbench-ai/workbench-built-in-adapters": workspaceSource("../built-in-adapters/src/index.ts"),
      "@workbench-ai/workbench-contract": workspaceSource("../contract/src/index.ts"),
      "@workbench-ai/workbench-core": workspaceSource("../core/src/index.ts"),
      "@workbench-ai/workbench-protocol": workspaceSource("../protocol/src/index.ts"),
      "@workbench-ai/workbench-ui": workspaceSource("../workbench-ui/src/index.tsx"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
