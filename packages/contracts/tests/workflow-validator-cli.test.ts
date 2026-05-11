import { mkdtempSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { stringifyWorkflowYaml } from "../src/index.js";
import { runWorkflowValidatorCli } from "../src/workflow-validator-cli.js";

describe("workflow validator cli", () => {
  test("returns zero and prints a valid summary for a valid workflow file", async () => {
    const repoRoot = await createTempDir();
    const filePath = path.join(repoRoot, "valid.yaml");
    await fs.writeFile(filePath, createWorkflowYaml({ id: "valid" }), "utf8");

    const output = captureCliOutput();
    const exitCode = await runWorkflowValidatorCli([filePath], output.io);

    expect(exitCode).toBe(0);
    expect(output.stdout).toContain("Result: valid");
    expect(output.stdout).toContain(`VALID ${filePath} (valid)`);
  });

  test("returns non-zero and prints diagnostics for an invalid workflow file", async () => {
    const repoRoot = await createTempDir();
    const filePath = path.join(repoRoot, "invalid.yaml");
    await fs.writeFile(filePath, "state:\n  initial: []\n", "utf8");

    const output = captureCliOutput();
    const exitCode = await runWorkflowValidatorCli([filePath], output.io);

    expect(exitCode).toBe(1);
    expect(output.stdout).toContain("Result: invalid");
    expect(output.stdout).toContain("state.initial");
  });

  test("scans repo roots and reports duplicate ids in json mode", async () => {
    const repoRoot = await createTempDir();
    const workflowRoot = path.join(repoRoot, ".flow", "workflows");
    await fs.mkdir(workflowRoot, { recursive: true });
    await fs.writeFile(path.join(workflowRoot, "first.yaml"), createWorkflowYaml({ id: "shared" }), "utf8");
    await fs.writeFile(path.join(workflowRoot, "second.yaml"), createWorkflowYaml({ id: "shared", stageId: "review" }), "utf8");

    const output = captureCliOutput();
    const exitCode = await runWorkflowValidatorCli([repoRoot, "--json"], output.io);

    expect(exitCode).toBe(1);
    const report = JSON.parse(output.stdout) as {
      workflow_root: string | null;
      valid: boolean;
      diagnostics: Array<{ code: string; workflow_id?: string }>;
      files: Array<{ file_path?: string; valid: boolean }>;
    };
    expect(report.workflow_root).toBe(workflowRoot);
    expect(report.valid).toBe(false);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "duplicate_workflow_id",
        workflow_id: "shared",
      }),
    );
    expect(report.files[0]?.valid).toBe(true);
    expect(report.files[1]?.valid).toBe(false);
  });

  test("rejects extra positional target arguments", async () => {
    const output = captureCliOutput();
    const exitCode = await runWorkflowValidatorCli(["first.yaml", "second.yaml"], output.io);

    expect(exitCode).toBe(2);
    expect(output.stderr).toContain("Expected at most one target path.");
    expect(output.stderr).toContain("Usage: flow-workflow-validator");
  });
});

function captureCliOutput(): {
  stdout: string;
  stderr: string;
  io: {
    stdout(message: string): void;
    stderr(message: string): void;
  };
} {
  const output = {
    stdout: "",
    stderr: "",
    io: {
      stdout(message: string) {
        output.stdout += message;
      },
      stderr(message: string) {
        output.stderr += message;
      },
    },
  };
  return output;
}

async function createTempDir(): Promise<string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workflow-validator-cli-"));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function createWorkflowYaml(options: { id: string; stageId?: string }): string {
  return stringifyWorkflowYaml({
    metadata: {
      id: options.id,
    },
    state: {
      initial: "queued",
      terminal: ["done"],
    },
    ingress: [],
    workspace: {},
    pipeline: {
      hooks: {},
      stages: [
        {
          id: options.stageId ?? "implement",
          harness: "default",
          prompt: "Do the work.",
        },
      ],
      harnesses: {
        default: {
          id: "openai/codex",
          auth: {
            strategy: "secret_ref",
            ref: "OPENAI_API_KEY",
          },
          model: "gpt-5.4",
          effort: "medium",
        },
      },
    },
  });
}
