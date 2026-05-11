import path from "node:path";
import { rmSync } from "node:fs";

const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.error("Usage: node ./scripts/clean-paths.mjs <path> [<path>...]");
  process.exit(1);
}

for (const target of targets) {
  rmSync(path.resolve(process.cwd(), target), { recursive: true, force: true });
}
