import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@workbench-ai/workbench-contract": fileURLToPath(new URL("../contract/src/index.ts", import.meta.url)),
      "@workbench-ai/workbench-core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@workbench-ai/workbench-protocol": fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false,
    environment: "node",
  },
});
