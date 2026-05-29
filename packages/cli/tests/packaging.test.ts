import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

describe.runIf(process.env.WORKBENCH_PACKAGING_TEST === "1")("packaged Workbench", () => {
  test("built binary exposes repo-like help", () => {
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
    expect(result.stdout).toContain("workbench pull [--dir DIR]");
    expect(result.stdout).toContain("workbench improve [SOURCE] [--dir DIR] [--hosted]");
    expect(result.stdout).toContain("workbench open [SOURCE|OWNER/BENCHMARK|RUN_ID|CANDIDATE_ID]");
    expect(result.stdout).not.toContain("workbench cloud");
  });

  test("built binary resolves built-in adapter commands without package-manager PATH", () => {
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const bin = path.join(packageRoot, "dist", "workbench.js");
    const root = mkdtempSync(path.join(os.tmpdir(), "workbench-packaged-check-"));
    const workspace = path.join(root, "bench");
    try {
      const init = spawnSync(
        process.execPath,
        [bin, "init", workspace, "--skill", "packaged-check", "--agent", "codex", "--json"],
        {
          cwd: packageRoot,
          encoding: "utf8",
        },
      );
      expect(init.status).toBe(0);

      const check = spawnSync(
        process.execPath,
        [bin, "check", "--dir", workspace, "--json"],
        {
          cwd: packageRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: "/usr/bin:/bin",
          },
        },
      );

      expect(check.status).toBe(0);
      expect(JSON.parse(check.stdout)).toMatchObject({
        ok: true,
        errors: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
