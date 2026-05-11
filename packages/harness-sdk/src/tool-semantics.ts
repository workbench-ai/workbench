import type { JsonValue } from "@workbench-ai/contracts";

export type CanonicalToolSubjectKind =
  | "command"
  | "query"
  | "path"
  | "url"
  | "pattern";

export interface CanonicalToolCall {
  toolName: string | null;
  attributes: Record<string, JsonValue> | undefined;
}

export interface CanonicalToolCallArgs {
  canonicalToolName?: string | null;
  rawToolName?: string | null;
  operation?: string | null;
  command?: string | null;
  query?: string | null;
  path?: string | null;
  url?: string | null;
  pattern?: string | null;
  cwd?: string | null;
  resultPreview?: string | null;
  input?: JsonValue;
  attributes?: Record<string, JsonValue>;
}

const TOOL_NAME_ALIASES: Record<
  string,
  { toolName: string; operation?: string | null }
> = {
  bash: { toolName: "shell", operation: "exec" },
  shell: { toolName: "shell", operation: "exec" },
  commandexecution: { toolName: "shell", operation: "exec" },
  read: { toolName: "file", operation: "read" },
  write: { toolName: "file", operation: "write" },
  edit: { toolName: "file", operation: "edit" },
  multiedit: { toolName: "file", operation: "edit" },
  glob: { toolName: "file", operation: "glob" },
  grep: { toolName: "file", operation: "grep" },
  ls: { toolName: "file", operation: "list" },
  list: { toolName: "file", operation: "list" },
  image: { toolName: "image", operation: "view" },
  imageview: { toolName: "image", operation: "view" },
  viewimage: { toolName: "image", operation: "view" },
  web: { toolName: "web", operation: null },
  websearch: { toolName: "web", operation: "search" },
  webfetch: { toolName: "web", operation: "fetch" },
  openpage: { toolName: "web", operation: "open" },
  findinpage: { toolName: "web", operation: "find" },
  mcp: { toolName: "mcp", operation: null },
  mcptoolcall: { toolName: "mcp", operation: null },
};

const TOOL_OPERATION_ALIASES: Record<string, string> = {
  bash: "exec",
  shell: "exec",
  command: "exec",
  commandexecution: "exec",
  execute: "exec",
  exec: "exec",
  read: "read",
  write: "write",
  edit: "edit",
  multiedit: "edit",
  update: "edit",
  ls: "list",
  list: "list",
  glob: "glob",
  grep: "grep",
  search: "search",
  websearch: "search",
  webfetch: "fetch",
  fetch: "fetch",
  openpage: "open",
  open: "open",
  findinpage: "find",
  find: "find",
  view: "view",
  imageview: "view",
};

export function buildCanonicalToolCall(
  args: CanonicalToolCallArgs,
): CanonicalToolCall {
  const rawToolName = cleanString(args.rawToolName);
  const canonicalToolName = cleanString(args.canonicalToolName);
  const operation = cleanString(args.operation);
  const inputRecord = asRecord(args.input);

  const inferredName = inferToolName(rawToolName);
  const toolName =
    normalizeToolIdentifier(canonicalToolName) ??
    inferredName.toolName ??
    normalizeToolIdentifier(rawToolName);
  const toolOperation =
    normalizeToolOperation(operation) ??
    inferredName.operation ??
    normalizeToolOperation(canonicalToolName) ??
    null;

  const command =
    cleanString(args.command) ??
    readPreferredInputString(inputRecord, ["command", "cmd"]);
  const query =
    cleanString(args.query) ??
    readPreferredInputString(inputRecord, ["query", "search_query", "searchQuery"]) ??
    readStringArrayValue(inputRecord?.queries).at(0) ??
    null;
  const url =
    cleanString(args.url) ??
    readPreferredInputString(inputRecord, ["url", "page_url", "pageUrl"]);
  const path =
    cleanString(args.path) ??
    readPreferredInputString(inputRecord, [
      "path",
      "file_path",
      "filePath",
      "directory_path",
      "directoryPath",
      "target_path",
      "targetPath",
    ]) ??
    readStringArrayValue(inputRecord?.paths).at(0) ??
    null;
  const pattern =
    cleanString(args.pattern) ??
    readPreferredInputString(inputRecord, [
      "pattern",
      "glob",
      "search_pattern",
      "searchPattern",
    ]);
  const cwd =
    cleanString(args.cwd) ??
    readPreferredInputString(inputRecord, ["cwd", "working_directory", "workingDirectory"]);
  const resultPreview = cleanString(args.resultPreview);
  const toolInputPreview = buildToolInputPreview(args.input);

  const subject =
    command ?? query ?? url ?? path ?? pattern ?? null;
  const subjectKind: CanonicalToolSubjectKind | null =
    command != null
      ? "command"
      : query != null
        ? "query"
        : url != null
          ? "url"
          : path != null
            ? "path"
            : pattern != null
              ? "pattern"
              : null;

  const attributes: Record<string, JsonValue> = {
    ...(args.attributes ?? {}),
  };

  if (
    rawToolName &&
    rawToolName.length > 0 &&
    normalizeToolIdentifier(rawToolName) !== toolName
  ) {
    attributes.tool_raw_name = rawToolName;
  }
  if (toolOperation) {
    attributes.tool_operation = toolOperation;
  }
  if (subject && subjectKind) {
    attributes.tool_subject = subject;
    attributes.tool_subject_kind = subjectKind;
  }
  if (command) {
    attributes.command = command;
  }
  if (query) {
    attributes.query = query;
  }
  if (url) {
    attributes.url = url;
  }
  if (path) {
    attributes.path = path;
  }
  if (pattern) {
    attributes.pattern = pattern;
  }
  if (cwd) {
    attributes.cwd = cwd;
  }
  if (resultPreview) {
    attributes.result_preview = resultPreview;
  }
  if (!subject && toolInputPreview) {
    attributes.tool_input_preview = toolInputPreview;
  }

  return {
    toolName,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
  };
}

function inferToolName(
  rawToolName: string | null,
): { toolName: string | null; operation: string | null } {
  if (!rawToolName) {
    return { toolName: null, operation: null };
  }
  const normalized = normalizeLookupKey(rawToolName);
  const alias = TOOL_NAME_ALIASES[normalized];
  if (alias) {
    return {
      toolName: alias.toolName,
      operation: alias.operation ?? null,
    };
  }
  return {
    toolName: normalizeToolIdentifier(rawToolName),
    operation: null,
  };
}

function normalizeToolIdentifier(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const collapsed = value
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLowerCase();
  return collapsed.length > 0 ? collapsed : null;
}

function normalizeToolOperation(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = normalizeLookupKey(value);
  return TOOL_OPERATION_ALIASES[normalized] ?? normalizeToolIdentifier(value);
}

function normalizeLookupKey(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/gu, "").toLowerCase();
}

function readPreferredInputString(
  input: Record<string, JsonValue> | null,
  keys: string[],
): string | null {
  if (!input) {
    return null;
  }
  for (const key of keys) {
    const value = cleanString(input[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function readStringArrayValue(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  return value as Record<string, JsonValue>;
}

function cleanString(value: JsonValue | string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function buildToolInputPreview(value: JsonValue | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized =
    typeof value === "string" ? value.trim() || null : safeJsonStringify(value);
  if (!normalized) {
    return null;
  }
  return truncateText(normalized, 240);
}

function safeJsonStringify(value: JsonValue): string | null {
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "{}" && serialized !== "[]"
      ? serialized
      : null;
  } catch {
    return null;
  }
}

function truncateText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
