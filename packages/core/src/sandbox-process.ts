import { createWriteStream } from "node:fs";

import {
  createWorkbenchProgressStdoutParser,
  publishWorkbenchProgressStdoutEnvelope,
  type WorkbenchExecutionProgressTarget,
} from "./execution-events.ts";
import { abortSignalOrUndefined } from "./runtime-utils.ts";

interface WorkbenchSandboxProcessOptions {
  backendName: string;
  cwd?: string;
  stdoutPath: string;
  stderrPath: string;
  timeoutMs: number;
  progressTarget?: WorkbenchExecutionProgressTarget;
  signal?: AbortSignal;
  beforeTerminate?: () => void;
}

export function runWorkbenchSandboxProcess(
  spawn: typeof import("node:child_process").spawn,
  command: string,
  args: string[],
  options: WorkbenchSandboxProcessOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const signal = abortSignalOrUndefined(options.signal);
    let settled = false;
    let timedOut = false;
    let aborted = false;
    const progressPublishes: Promise<void>[] = [];
    const progressParser = createWorkbenchProgressStdoutParser((envelope) => {
      progressPublishes.push(
        publishWorkbenchProgressStdoutEnvelope(envelope, options.progressTarget)
          .catch(() => undefined),
      );
    });
    const stdout = createWriteStream(options.stdoutPath);
    const stderr = createWriteStream(options.stderrPath);
    const child = spawn(command, args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const terminate = (terminationSignal: NodeJS.Signals): void => {
      options.beforeTerminate?.();
      child.kill(terminationSignal);
    };
    if (signal?.aborted) {
      aborted = true;
      terminate("SIGTERM");
    }
    const abort = () => {
      aborted = true;
      terminate("SIGTERM");
    };
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      terminate("SIGKILL");
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout.write(chunk);
      progressParser.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.write(chunk);
    });

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      progressParser.flush();
      const stdoutClosed = new Promise<void>((closeResolve) => stdout.end(closeResolve));
      const stderrClosed = new Promise<void>((closeResolve) => stderr.end(closeResolve));
      Promise.allSettled([...progressPublishes, stdoutClosed, stderrClosed]).then(() => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    };

    child.on("error", (error) => finish(error));
    child.on("exit", (code, exitSignal) => {
      if (timedOut) {
        finish(new Error(`${options.backendName} timed out after ${options.timeoutMs}ms.`));
      } else if (aborted) {
        finish(new Error("Run cancellation requested."));
      } else if (code === 0) {
        finish();
      } else {
        finish(new Error(
          code === null
            ? `${options.backendName} exited from signal ${exitSignal ?? "unknown"}.`
            : `${options.backendName} exited with code ${code}.`,
        ));
      }
    });
  });
}
