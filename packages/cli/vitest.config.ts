import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@workbench-ai/workbench": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      "@workbench-ai/workbench-built-in-adapters": fileURLToPath(new URL("../built-in-adapters/src/index.ts", import.meta.url)),
      "@workbench-ai/workbench-contract": fileURLToPath(new URL("../contract/src/index.ts", import.meta.url)),
      "@workbench-ai/workbench-core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@workbench-ai/workbench-protocol": fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url)),
      "@workbench-ai/workbench-ui": fileURLToPath(new URL("../workbench-ui/src/index.tsx", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
