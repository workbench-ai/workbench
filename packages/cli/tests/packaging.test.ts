import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

describe.runIf(process.env.WORKBENCH_PACKAGING_TEST === "1")("packaged Workbench", () => {
  test("built binary exposes local-first help", () => {
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const result = spawnSync(
      process.execPath,
      [path.join(packageRoot, "dist", "workbench.js"), "--help"],
      {
        cwd: packageRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("workbench init");
    expect(result.stdout).toContain("workbench push [SOURCE] [--dir DIR]");
    expect(result.stdout).toContain("workbench improve [SOURCE] [--dir DIR]");
    expect(result.stdout).toContain("workbench open [SOURCE] [--dir DIR]");
    expect(result.stdout).toContain("workbench cloud benchmarks|runs|candidates <command> [options]");
  });

  test("built local browser assets are self-contained", () => {
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const assetRoot = path.join(packageRoot, "dist", "dev-open");
    const css = readFileSync(path.join(assetRoot, "client.css"), "utf8");
    const fonts = readdirSync(path.join(assetRoot, "fonts"));

    expect(css).toContain("./fonts/");
    expect(css).not.toContain("node_modules");
    expect(fonts.length).toBeGreaterThan(0);
  });
});
