#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const binDir = path.dirname(fileURLToPath(import.meta.url));
const compiledCliPath = path.resolve(binDir, "../dist/workflow-validator-cli.js");

if (!existsSync(compiledCliPath)) {
  process.stderr.write(
    "flow-workflow-validator is not built yet. Run `pnpm --filter @workbench-ai/flow-contracts run build` from the repo root and retry.\n",
  );
  process.exit(1);
}

const { runWorkflowValidatorCli } = await import(pathToFileURL(compiledCliPath).href);
process.exitCode = await runWorkflowValidatorCli(process.argv.slice(2));
