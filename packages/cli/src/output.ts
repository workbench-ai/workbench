import type { Json } from "@workbench-ai/workbench-contract";
import { codedErrorFromUnknown } from "@workbench-ai/workbench-core";

import { humanFormatOptions, styleError, styleHint, type HumanFormatOptions } from "./human-format.js";

export interface CliIo {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
}

interface ParsedCliFlags {
  flags: Record<string, string | boolean | string[]>;
}

type JsonPrimitive = null | boolean | number | string;

export type JsonSerializable<T> =
  T extends JsonPrimitive ? T
    : T extends undefined ? undefined
      : T extends readonly (infer Item)[] ? readonly JsonSerializable<Item>[]
        : T extends object ? { [Key in keyof T]: JsonSerializable<T[Key]> }
          : never;

type WorkbenchCliSuccessEnvelope<Body extends object> = {
  schema: string;
  ok: boolean;
} & Body;

interface WorkbenchCliErrorEnvelope {
  schema: "workbench.cli.error.v1";
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
  remediation?: string;
  runId?: string;
  subject?: Record<string, Json>;
}

export function emitResult<Body extends Record<string, unknown>>(
  schema: string,
  body: JsonSerializable<Body>,
  parsed: ParsedCliFlags,
  io: CliIo,
  text: (format: HumanFormatOptions) => string,
  options: { ok?: boolean; exitCode?: number } = {},
): number {
  if (parsed.flags.json === true) {
    const envelope: WorkbenchCliSuccessEnvelope<JsonSerializable<Body>> = {
      schema,
      ok: options.ok ?? true,
      ...body,
    };
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
    const candidateCommands = candidateCommandsFromSubject(envelope.subject);
    if (candidateCommands.length > 0) {
      io.stderr.write(`${styleHint("candidates", format)}:\n`);
      for (const command of candidateCommands) {
        io.stderr.write(`  ${command}\n`);
      }
    }
    if (envelope.remediation) {
      io.stderr.write(`${styleHint("next", format)}: ${envelope.remediation}\n`);
    }
  }
  return coded.exitCode;
}

export function jsonValue(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(jsonValue);
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, jsonValue(entry)]));
  }
  throw new TypeError(`Value is not JSON-serializable: ${typeof value}`);
}

function setupCommandsFromSubject(subject: Record<string, Json> | undefined): string[] {
  const commands = subject?.setupCommands;
  return Array.isArray(commands)
    ? commands.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function candidateCommandsFromSubject(subject: Record<string, Json> | undefined): string[] {
  const commands = subject?.candidateCommands;
  return Array.isArray(commands)
    ? commands.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}
