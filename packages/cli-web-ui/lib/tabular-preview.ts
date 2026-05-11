import Papa, { type ParseError } from "papaparse";

export interface ParsedTabularColumn {
  id: string;
  label: string;
  sourceIndex: number;
  width: number;
}

export interface ParsedTabularRow {
  id: string;
  values: string[];
}

export interface ParsedTabularPreview {
  kindLabel: string;
  delimiter: string;
  delimiterLabel: string;
  columns: ParsedTabularColumn[];
  rows: ParsedTabularRow[];
}

export type ParsedTabularPreviewResult =
  | { ok: true; table: ParsedTabularPreview }
  | { ok: false; reason: string };

interface TabularFormat {
  kindLabel: string;
  delimiter: string;
}

const MIN_COLUMN_WIDTH_PX = 144;
const MAX_COLUMN_WIDTH_PX = 960;
const HEADER_SAMPLE_ROWS = 24;

export function parseTabularPreview(args: {
  path?: string | null;
  mimeType?: string | null;
  raw: string;
}): ParsedTabularPreviewResult {
  const format = detectTabularFormat(args);

  if (args.raw.trim().length === 0) {
    return {
      ok: true,
      table: {
        kindLabel: resolveKindLabel(format, format.delimiter),
        delimiter: format.delimiter,
        delimiterLabel: formatDelimiter(format.delimiter),
        columns: [],
        rows: [],
      },
    };
  }

  const parsed = Papa.parse<string[]>(args.raw, {
    delimiter: format.delimiter,
    skipEmptyLines: "greedy",
  });
  const fatalErrors = parsed.errors.filter(
    (error: ParseError) => error.code !== "UndetectableDelimiter",
  );

  if (fatalErrors.length > 0) {
    return {
      ok: false,
      reason: fatalErrors[0]?.message ?? "Unable to parse tabular preview.",
    };
  }

  const parsedRows = parsed.data.map(normalizeParsedRow);
  const columnCount = parsedRows.reduce(
    (max: number, row: string[]) => Math.max(max, row.length),
    0,
  );
  const firstRow = parsedRows[0] ?? [];
  const usesHeaderRow = shouldUseHeaderRow(firstRow);
  const headerValues = usesHeaderRow
    ? padRow(firstRow, columnCount)
    : Array.from({ length: columnCount }, () => "");
  const dataRows = (usesHeaderRow ? parsedRows.slice(1) : parsedRows).map(
    (row: string[], index: number) => ({
      id: `row_${index}`,
      values: padRow(row, columnCount),
    }),
  );
  const columns = buildColumns({
    headerValues,
    rows: dataRows,
  });
  const delimiter = parsed.meta.delimiter || format.delimiter;
  const kindLabel = resolveKindLabel(format, delimiter);
  const delimiterLabel = formatDelimiter(delimiter);

  return {
    ok: true,
    table: {
      kindLabel,
      delimiter,
      delimiterLabel,
      columns,
      rows: dataRows,
    },
  };
}

function detectTabularFormat(args: {
  path?: string | null;
  mimeType?: string | null;
}): TabularFormat {
  const normalizedPath = args.path?.toLowerCase() ?? "";
  const normalizedMimeType = args.mimeType?.toLowerCase() ?? "";

  if (normalizedPath.endsWith(".csv") || normalizedMimeType === "text/csv") {
    return { kindLabel: "CSV", delimiter: "," };
  }
  if (normalizedPath.endsWith(".tsv")) {
    return { kindLabel: "TSV", delimiter: "\t" };
  }
  if (
    normalizedPath.endsWith(".tab") ||
    normalizedMimeType === "text/tab-separated-values"
  ) {
    return { kindLabel: "TAB", delimiter: "\t" };
  }
  if (normalizedPath.endsWith(".psv")) {
    return { kindLabel: "PSV", delimiter: "|" };
  }
  return { kindLabel: "Delimited", delimiter: "" };
}

function resolveKindLabel(
  format: TabularFormat,
  delimiter: string,
): string {
  if (format.kindLabel !== "Delimited") {
    return format.kindLabel;
  }
  if (delimiter === ",") {
    return "CSV";
  }
  if (delimiter === "\t") {
    return "TSV";
  }
  if (delimiter === "|") {
    return "PSV";
  }
  return "Delimited";
}

function normalizeParsedRow(
  row: string[] | unknown,
): string[] {
  if (!Array.isArray(row)) {
    return [String(row ?? "")];
  }
  return row.map(normalizeCellValue);
}

function normalizeCellValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function shouldUseHeaderRow(row: string[]): boolean {
  const normalized = row
    .map((value) => normalizeHeaderKey(value))
    .filter((value) => value.length > 0);

  if (normalized.length === 0) {
    return false;
  }

  const uniqueCount = new Set(normalized).size;
  return uniqueCount > normalized.length / 2;
}

function buildColumns(args: {
  headerValues: string[];
  rows: ParsedTabularRow[];
}): ParsedTabularColumn[] {
  const counts = new Map<string, number>();

  return args.headerValues.map((headerValue, index) => {
    const normalizedHeader = headerValue.trim();
    const baseLabel = normalizedHeader || `Column ${index + 1}`;
    const key = normalizeHeaderKey(baseLabel);
    const seen = (counts.get(key) ?? 0) + 1;
    counts.set(key, seen);
    const label = seen === 1 ? baseLabel : `${baseLabel} (${seen})`;
    const width = estimateColumnWidth(label, index, args.rows);

    return {
      id: `column_${index}`,
      label,
      sourceIndex: index,
      width,
    };
  });
}

function estimateColumnWidth(
  label: string,
  columnIndex: number,
  rows: ParsedTabularRow[],
): number {
  const sampledRowValues = rows.slice(0, HEADER_SAMPLE_ROWS).map((row) => {
    return row.values[columnIndex] ?? "";
  });
  const maxLength = sampledRowValues.reduce(
    (max, value) => Math.max(max, value.length),
    label.length,
  );
  const widthMultiplier = maxLength > 80 ? 9 : 8;
  const padding = maxLength > 80 ? 48 : 32;
  return clamp(
    maxLength * widthMultiplier + padding,
    MIN_COLUMN_WIDTH_PX,
    MAX_COLUMN_WIDTH_PX,
  );
}

function padRow(row: string[], columnCount: number): string[] {
  if (row.length >= columnCount) {
    return row;
  }
  return row.concat(Array.from({ length: columnCount - row.length }, () => ""));
}

function normalizeHeaderKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function formatDelimiter(delimiter: string): string {
  if (delimiter === ",") {
    return "Comma";
  }
  if (delimiter === "\t") {
    return "Tab";
  }
  if (delimiter === "|") {
    return "Pipe";
  }
  if (delimiter.trim().length === 0) {
    return "Auto";
  }
  return delimiter;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
