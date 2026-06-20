import { codedErrorFromUnknown, type Json } from "@workbench-ai/workbench-core";

import { humanFormatOptions, styleError, styleHint, type HumanFormatOptions } from "./human-format.js";
import type { CliIo } from "./index.js";

export interface ParsedCliFlags {
  flags: Record<string, string | boolean | string[]>;
}

export interface WorkbenchCliSuccessEnvelope {
  schema: string;
  ok: boolean;
  [key: string]: Json | undefined;
}

export interface WorkbenchCliErrorEnvelope {
  schema: "workbench.cli.error.v1";
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
  remediation?: string;
  runId?: string;
  subject?: Record<string, Json>;
}

export function emitResult(
  schema: string,
  body: Record<string, Json | undefined>,
  parsed: ParsedCliFlags,
  io: CliIo,
  text: (format: HumanFormatOptions) => string,
  options: { ok?: boolean; exitCode?: number } = {},
): number {
  if (parsed.flags.json === true) {
    const envelope: WorkbenchCliSuccessEnvelope = { schema, ok: options.ok ?? true };
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        envelope[key] = value;
      }
    }
    io.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  } else {
    io.stdout.write(`${text(humanFormatOptions(io.stdout))}\n`);
  }
  return options.exitCode ?? 0;
}

export function emitError(error: unknown, parsed: ParsedCliFlags, io: CliIo): number {
  const coded = codedErrorFromUnknown(error);
  const runId = typeof coded.subject?.runId === "string" ? coded.subject.runId : undefined;
  const envelope: WorkbenchCliErrorEnvelope = {
    schema: "workbench.cli.error.v1",
    ok: false,
    code: coded.code,
    message: coded.message,
    retryable: coded.retryable,
    ...(coded.remediation ? { remediation: coded.remediation } : {}),
    ...(runId ? { runId } : {}),
    ...(coded.subject ? { subject: coded.subject } : {}),
  };
  if (parsed.flags.json === true) {
    io.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  } else {
    const format = humanFormatOptions(io.stderr);
    io.stderr.write(`${styleError(`error[${envelope.code}]`, format)}: ${envelope.message}\n`);
    const setupCommands = setupCommandsFromSubject(envelope.subject);
    if (setupCommands.length > 0) {
      io.stderr.write(`${styleHint("setup", format)}:\n`);
      for (const command of setupCommands) {
        io.stderr.write(`  ${command}\n`);
      }
    }
    if (envelope.remediation) {
      io.stderr.write(`${styleHint("next", format)}: ${envelope.remediation}\n`);
    }
  }
  return coded.exitCode;
}

function setupCommandsFromSubject(subject: Record<string, Json> | undefined): string[] {
  const commands = subject?.setupCommands;
  return Array.isArray(commands)
    ? commands.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}
