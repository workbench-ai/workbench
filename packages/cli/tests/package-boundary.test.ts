import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const PRODUCT_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const PUBLIC_PACKAGE_DIRS = [
  "packages/contract",
  "packages/protocol",
  "packages/core",
  "packages/built-in-adapters",
  "packages/workbench-ui",
  "packages/cli",
] as const;

const HOSTED_ONLY_DEPENDENCIES = [
  "@aws-sdk/client-dynamodb",
  "@aws-sdk/client-s3",
  "@aws-sdk/client-sqs",
  "@aws-sdk/lib-dynamodb",
  "@daytona/sdk",
  "@workbench-internal/workbench-cloud-runtime",
  "e2b",
  "next",
  "next-auth",
  "stripe",
] as const;
const DELETED_RUNTIME_PACKAGE_PATH = ["packages", "runtime"].join("/");
const DELETED_RUNTIME_SOURCE_PATH = ["runtime", "src"].join("/");

describe("public package boundary", () => {
  test("published Workbench packages do not depend on hosted infrastructure packages", async () => {
    for (const packageDir of PUBLIC_PACKAGE_DIRS) {
      const manifest = await readPackageJson(path.join(PRODUCT_ROOT, packageDir, "package.json"));
      const dependencyNames = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]);
      expect(
        [...dependencyNames].filter((dependency) =>
          HOSTED_ONLY_DEPENDENCIES.includes(dependency as typeof HOSTED_ONLY_DEPENDENCIES[number])
        ),
        manifest.name,
      ).toEqual([]);
    }
  });

  test("the Workbench product root does not carry runtime-only dependencies", async () => {
    const manifest = await readPackageJson(path.join(PRODUCT_ROOT, "package.json"));
    expect(manifest.dependencies ?? {}).toEqual({});
  });

  test("public package source does not import private cloud runtime or deleted runtime paths", async () => {
    const hits: string[] = [];
    for (const packageDir of PUBLIC_PACKAGE_DIRS) {
      const files = await listSourceFiles(path.join(PRODUCT_ROOT, packageDir, "src"));
      for (const file of files) {
        const source = await fs.readFile(file, "utf8");
        for (const needle of [
          "@workbench-internal/",
          "products/workbench-cloud",
          DELETED_RUNTIME_PACKAGE_PATH,
          DELETED_RUNTIME_SOURCE_PATH,
        ]) {
          if (source.includes(needle)) {
            hits.push(`${path.relative(PRODUCT_ROOT, file)} contains ${needle}`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

async function readPackageJson(filePath: string): Promise<PackageJson> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as PackageJson;
}

async function listSourceFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(entryPath));
    } else if (/\.(ts|tsx|mts|mjs|cjs|js)$/u.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files.sort();
}
