import { spawn } from "node:child_process";

import { DEFAULT_HARNESS_PREPARE_TIMEOUT_MS } from "@workbench-ai/contracts";

import type { HarnessExecutionPlan } from "./index.js";

const harnessPrepareContextEnvNames = Object.freeze([
  "WORKBENCH_HARNESS_PROVIDER",
  "WORKBENCH_HARNESS_WORKSPACE_ROOT",
  "WORKBENCH_HARNESS_STAGE_ROOT",
  "WORKBENCH_HARNESS_WORKSPACE_MODE",
] as const);

export interface HarnessPrepareCommandArgs {
  plan: HarnessExecutionPlan;
  workspacePath: string;
  stageSessionPath: string;
  childEnv: NodeJS.ProcessEnv;
}

function buildHarnessPrepareEnv(args: HarnessPrepareCommandArgs): NodeJS.ProcessEnv {
  const prepare = args.plan.harness.prepare;
  return {
    ...args.childEnv,
    ...(prepare?.env ?? {}),
    WORKBENCH_HARNESS_PROVIDER: args.plan.harness.id,
    WORKBENCH_HARNESS_WORKSPACE_ROOT: args.workspacePath,
    WORKBENCH_HARNESS_STAGE_ROOT: args.stageSessionPath,
    WORKBENCH_HARNESS_WORKSPACE_MODE: args.plan.workspace.mode,
  };
}

export async function runHarnessPrepareCommand(
  args: HarnessPrepareCommandArgs,
): Promise<void> {
  const prepare = args.plan.harness.prepare;
  if (!prepare) {
    return;
  }

  const timeoutMs =
    prepare.timeout_ms ?? DEFAULT_HARNESS_PREPARE_TIMEOUT_MS;
  const env = buildHarnessPrepareEnv(args);

  await new Promise<void>((resolve, reject) => {
    const child = spawn("sh", ["-lc", prepare.run], {
      cwd: args.workspacePath,
      env,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      finish(() => {
        reject(
          new Error(
            formatHarnessPrepareFailure({
              command: prepare.run,
              error,
              stdout,
              stderr,
            }),
          ),
        );
      });
    });

    child.on("exit", (code, signal) => {
      finish(() => {
        if (timedOut) {
          reject(
            new Error(
              formatHarnessPrepareTimeout({
                command: prepare.run,
                timeoutMs,
                stdout,
                stderr,
              }),
            ),
          );
          return;
        }
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            formatHarnessPrepareFailure({
              command: prepare.run,
              code,
              signal,
              stdout,
              stderr,
            }),
          ),
        );
      });
    });
  });
}

function formatHarnessPrepareFailure(args: {
  command: string;
  code?: number | null;
  signal?: NodeJS.Signals | null;
  error?: unknown;
  stdout: string;
  stderr: string;
}): string {
  const reason = args.error instanceof Error
    ? args.error.message
    : `code ${args.code ?? "null"} signal ${args.signal ?? "null"}`;
  return [
    `Harness prepare command failed (${reason}): ${args.command}`,
    ...formatHarnessPrepareOutput(args.stdout, args.stderr),
  ].join("\n");
}

function formatHarnessPrepareTimeout(args: {
  command: string;
  timeoutMs: number;
  stdout: string;
  stderr: string;
}): string {
  return [
    `Harness prepare command timed out after ${args.timeoutMs}ms: ${args.command}`,
    ...formatHarnessPrepareOutput(args.stdout, args.stderr),
  ].join("\n");
}

function formatHarnessPrepareOutput(
  stdout: string,
  stderr: string,
): string[] {
  const lines: string[] = [];
  const normalizedStdout = stdout.trim();
  const normalizedStderr = stderr.trim();
  if (normalizedStdout) {
    lines.push(`stdout: ${normalizedStdout}`);
  }
  if (normalizedStderr) {
    lines.push(`stderr: ${normalizedStderr}`);
  }
  return lines;
}
