import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sourceRoots = [
  "packages/contracts",
  "packages/harness-sdk",
  "packages/platform-sdk",
  "packages/runtime",
  "packages/harness-openai-codex",
  "packages/harness-anthropic-claude-code",
  "packages/platform-local",
  "packages/client",
  "packages/cli/src",
  "packages/cli/tests",
  "packages/cli/scripts",
  "apps/server",
  "apps/web/src",
  "apps/web/tests",
  "docs",
  "ARCHITECTURE.md",
  "scripts",
];

function flat(...parts: string[]): string {
  return parts.join("");
}

const deletedMigrationPattern = [
  ["runtime", "core"].join("-"),
  ["runtime", "local"].join("-"),
  ["runtime", "cloud"].join("-"),
  ["adapter", "sdk"].join("-"),
  flat("profile", "Id"),
  flat("profile", "_id"),
  flat("Runtime", "ProfileSchema"),
  flat("harness", "\\.", "adapter"),
  flat("create", "BuiltInHarnessHost"),
  flat("create", "DefaultLocalHarnessHost"),
  flat("create", "DefaultCloudHarnessHost"),
].join("|");

const deletedSeamPattern = [
  flat("Flow", "ServiceFactory"),
  flat("Runtime", "CapabilitiesProvider"),
  flat("Unsupported", "ChatSessionHost"),
  flat("create", "DefaultRuntimeCapabilities", "\\("),
].join("|");

const deletedProfilePhrasingPattern = [
  ["runtime", "profile"].join(" "),
  ["local", "profile"].join(" "),
  ["current", "profile"].join(" "),
  ["active", "profile"].join(" "),
  ["profile", "package"].join(" "),
  ["profile", "packages"].join(" "),
].join("|");

function expectNoMatches(pattern: string, label: string): void {
  const result = spawnSync(
    "rg",
    [
      "-n",
      pattern,
      "-g",
      "!packages/contracts/tests/deleted-vocabulary-guard.test.ts",
      ...sourceRoots,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  if (result.error) {
    throw result.error;
  }
  expect(result.status, `${label}\n${result.stdout}${result.stderr}`).toBe(1);
}

describe("deleted refactor vocabulary guard", () => {
  test("does not reintroduce deleted package names or transition helpers", () => {
    expectNoMatches(
      deletedMigrationPattern,
      "deleted platform/harness transition vocabulary reappeared",
    );
  });

  test("does not reintroduce retired runtime seam placeholders", () => {
    expectNoMatches(
      deletedSeamPattern,
      "deleted runtime seam placeholder reappeared",
    );
  });

  test("does not reintroduce profile-era user-facing phrasing", () => {
    expectNoMatches(
      deletedProfilePhrasingPattern,
      "profile-era phrasing reappeared in source docs or code",
    );
  });
});
