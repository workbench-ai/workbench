import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { quoteShellArg } from "@workbench-ai/workbench-core";

import { stripAnsi } from "./human-format.js";

const require = createRequire(import.meta.url);
const DEFAULT_EXTERNAL_SKILLS_TIMEOUT_MS = 120_000;
const MAX_CAPTURED_OUTPUT_BYTES = 1024 * 1024;

interface ExternalSkillInstallRequest {
  source: string;
  args: readonly string[];
  dryRun: boolean;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface ExternalSkillInstallResult {
  mode: "external";
  delegatedTool: "skills";
  delegatedCommand: string[];
  delegatedCommandText: string;
  dryRun: boolean;
  planned: boolean;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface CapturedOutput {
  value: string;
  truncated: boolean;
}

export async function runExternalSkillInstall(request: ExternalSkillInstallRequest): Promise<ExternalSkillInstallResult> {
  const delegatedCommand = externalSkillInstallCommand(request.source, request.args);
  const delegatedCommandText = externalSkillInstallCommandText(delegatedCommand);
  if (request.dryRun) {
    return {
      mode: "external",
      delegatedTool: "skills",
      delegatedCommand,
      delegatedCommandText,
      dryRun: true,
      planned: true,
      cwd: request.cwd,
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    };
  }

  const binPath = await resolveSkillsBinPath();
  const stdout = createCapturedOutput();
  const stderr = createCapturedOutput();
  let timedOut = false;
  let spawnError: Error | undefined;
  const child = spawn(process.execPath, [binPath, "add", request.source, ...request.args], {
    cwd: request.cwd,
    env: {
      ...request.env,
      NO_COLOR: request.env.NO_COLOR ?? "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => appendCapturedOutput(stdout, chunk));
  child.stderr.on("data", (chunk: Buffer) => appendCapturedOutput(stderr, chunk));
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, request.timeoutMs ?? DEFAULT_EXTERNAL_SKILLS_TIMEOUT_MS);
  const exitCode = await new Promise<number>((resolve) => {
    child.on("error", (error: Error) => {
      spawnError = error;
      resolve(1);
    });
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  }).finally(() => {
    clearTimeout(timeout);
  });

  return {
    mode: "external",
    delegatedTool: "skills",
    delegatedCommand,
    delegatedCommandText,
    dryRun: false,
    planned: false,
    cwd: request.cwd,
    exitCode,
    stdout: capturedOutputValue(stdout),
    stderr: spawnError ? spawnError.message : capturedOutputValue(stderr),
    timedOut,
  };
}

function externalSkillInstallCommand(source: string, args: readonly string[]): string[] {
  return ["skills", "add", source, ...args];
}

function externalSkillInstallCommandText(command: readonly string[]): string {
  return command.map((part) => quoteShellArg(part)).join(" ");
}

export function conciseExternalSkillsFailureReason(result: Pick<ExternalSkillInstallResult, "stdout" | "stderr" | "timedOut">): string | undefined {
  if (result.timedOut) {
    return "Timed out while running skills add.";
  }
  const lines = stripAnsi(`${result.stderr}\n${result.stdout}`)
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^[\u2580-\u259f\s]+$/u.test(line))
    .filter((line) => !/^Usage:/iu.test(line))
    .filter((line) => !/^npx skills /iu.test(line))
    .map((line) => line.replace(/^ERROR\s+/iu, "").trim())
    .filter(Boolean);
  const reason = lines[0];
  return reason ? reason.slice(0, 300) : undefined;
}

async function resolveSkillsBinPath(): Promise<string> {
  const packageJsonPath = require.resolve("skills/package.json");
  const manifest = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const bin = typeof manifest.bin === "string"
    ? manifest.bin
    : manifest.bin?.skills ?? manifest.bin?.["add-skill"];
  if (!bin) {
    throw new Error("The skills package does not declare a skills bin.");
  }
  return path.resolve(path.dirname(packageJsonPath), bin);
}

function createCapturedOutput(): CapturedOutput {
  return { value: "", truncated: false };
}

function appendCapturedOutput(output: CapturedOutput, chunk: Buffer): void {
  if (output.truncated) {
    return;
  }
  const next = output.value + chunk.toString("utf8");
  if (Buffer.byteLength(next, "utf8") <= MAX_CAPTURED_OUTPUT_BYTES) {
    output.value = next;
    return;
  }
  output.value = next.slice(0, MAX_CAPTURED_OUTPUT_BYTES);
  output.truncated = true;
}

function capturedOutputValue(output: CapturedOutput): string {
  const value = output.truncated ? `${output.value}\n[output truncated]` : output.value;
  return stripAnsi(value);
}
