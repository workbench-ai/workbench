import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { version: string };

export const codexHarnessPackageVersion = packageJson.version;
