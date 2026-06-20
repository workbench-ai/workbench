export interface HumanFormatOptions {
  color: boolean;
  columns?: number;
}

export interface HumanOutputStream {
  isTTY?: boolean;
  columns?: number;
}

export interface TableColumn<Row> {
  header: string;
  cell: (row: Row, options: HumanFormatOptions) => string;
  align?: "left" | "right";
}

export const PLAIN_HUMAN_FORMAT: HumanFormatOptions = { color: false };

const ANSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/gu;

const ANSI_CODES = {
  reset: "\x1B[0m",
  dim: "\x1B[2m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  red: "\x1B[31m",
} as const;

type Tone = keyof Omit<typeof ANSI_CODES, "reset">;

export function humanFormatOptions(stream: unknown): HumanFormatOptions {
  const output = outputStreamFields(stream);
  return {
    color: colorEnabled(output),
    ...(typeof output.columns === "number" && output.columns > 0 ? { columns: output.columns } : {}),
  };
}

export function renderTable<Row>(
  rows: readonly Row[],
  columns: readonly TableColumn<Row>[],
  options: HumanFormatOptions = PLAIN_HUMAN_FORMAT,
): string {
  if (rows.length === 0) {
    return "";
  }
  const rendered = rows.map((row) =>
    columns.map((column) => tableCell(column.cell(row, options)))
  );
  const widths = columns.map((column, index) =>
    Math.max(
      visibleLength(column.header),
      ...rendered.map((row) => visibleLength(row[index] ?? "")),
    )
  );
  const header = columns.map((column, index) =>
    padCell(column.header, widths[index] ?? visibleLength(column.header), column.align)
  ).join("  ");
  const body = rendered.map((row) =>
    row.map((cell, index) =>
      padCell(cell, widths[index] ?? visibleLength(cell), columns[index]?.align)
    ).join("  ")
  );
  return [header, ...body].join("\n");
}

export function styleStatus(status: string, options: HumanFormatOptions = PLAIN_HUMAN_FORMAT): string {
  const normalized = status.trim().toLowerCase();
  if ([
    "authenticated",
    "connected",
    "current",
    "installed",
    "published",
    "ready",
    "succeeded",
    "unchanged",
    "updated",
    "up_to_date",
  ].includes(normalized)) {
    return style(status, "green", options);
  }
  if ([
    "auth_required",
    "blocked",
    "disconnected",
    "error",
    "failed",
    "missing",
    "not_authenticated",
  ].includes(normalized)) {
    return style(status, "red", options);
  }
  if ([
    "canceled",
    "duplicate-name",
    "modified",
    "project",
    "queued",
    "running",
    "skipped",
    "unmanaged",
    "unpublished",
  ].includes(normalized)) {
    return style(status, "yellow", options);
  }
  return status;
}

export function styleError(value: string, options: HumanFormatOptions = PLAIN_HUMAN_FORMAT): string {
  return style(value, "red", options);
}

export function styleHint(value: string, options: HumanFormatOptions = PLAIN_HUMAN_FORMAT): string {
  return style(value, "dim", options);
}

export function formatCostUsd(costUsd: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: "currency",
  }).format(costUsd);
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function colorEnabled(stream: HumanOutputStream): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") {
    return false;
  }
  const forceColor = process.env.FORCE_COLOR;
  if (forceColor !== undefined && forceColor !== "" && forceColor !== "0") {
    return true;
  }
  return stream.isTTY === true;
}

function outputStreamFields(stream: unknown): HumanOutputStream {
  if (!stream || typeof stream !== "object") {
    return {};
  }
  const record = stream as Record<string, unknown>;
  return {
    ...(typeof record.isTTY === "boolean" ? { isTTY: record.isTTY } : {}),
    ...(typeof record.columns === "number" ? { columns: record.columns } : {}),
  };
}

function style(value: string, tone: Tone, options: HumanFormatOptions): string {
  if (!options.color) {
    return value;
  }
  return `${ANSI_CODES[tone]}${value}${ANSI_CODES.reset}`;
}

function tableCell(value: string): string {
  return value.replace(/\s+/gu, " ").trim() || "n/a";
}

function visibleLength(value: string): number {
  return Array.from(stripAnsi(value)).length;
}

function padCell(value: string, width: number, align: "left" | "right" = "left"): string {
  const padding = Math.max(0, width - visibleLength(value));
  return align === "right" ? `${" ".repeat(padding)}${value}` : `${value}${" ".repeat(padding)}`;
}
