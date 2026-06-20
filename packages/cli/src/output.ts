import { codedErrorFromUnknown, type Json } from "@workbench-ai/workbench-core";

import { humanFormatOptions, styleError, styleHint, type HumanFormatOptions } from "./human-format.js";
import type { CliIo } from "./index.js";

export interface ParsedCliFlags {
  flags: Record<string, string | boolean | string[]>;
}

export interface WorkbenchCliSuccessEnvelope {
  schema: string;
  ok: true;
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
): number {
  if (parsed.flags.json === true) {
    const envelope: WorkbenchCliSuccessEnvelope = { schema, ok: true };
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        envelope[key] = value;
      }
    }
    io.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  } else {
    io.stdout.write(`${text(humanFormatOptions(io.stdout))}\n`);
  }
  return 0;
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
    if (envelope.remediation) {
      io.stderr.write(`${styleHint("next", format)}: ${envelope.remediation}\n`);
    }
  }
  return coded.exitCode;
}
