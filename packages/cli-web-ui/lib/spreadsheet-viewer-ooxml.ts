import type { CSSProperties } from "react";
import { strFromU8, unzipSync } from "fflate";

import type {
  CellAddress,
  CellDataType,
  GridRange,
  RenderedCellModel,
  WorkbookRange,
  WorkbookWorksheet,
} from "./spreadsheet-viewer-model";

export type OoxmlWorkbook = {
  activeSheetName: string;
  sheets: OoxmlSheet[];
};

export type OoxmlSheet = {
  name: string;
  hidden: boolean;
  columns: OoxmlColumn[];
  rows: OoxmlRow[];
  defaultRowHeight?: number;
  defaultColWidth?: number;
  showGridLines: boolean;
  mergedCells: OoxmlMerge[];
  range: GridRange | null;
  renderedCells: Map<string, RenderedCellModel>;
  worksheet: WorkbookWorksheet;
};

export type OoxmlColumn = {
  min: number;
  max: number;
  width?: number;
  hidden?: boolean;
};

export type OoxmlRow = {
  index: number;
  height?: number;
  hidden?: boolean;
  cells: Array<{ address: string }>;
};

export type OoxmlMerge = {
  startAddress: string;
  endAddress: string;
};

type SharedStringTable = string[];
type CellStyle = {
  numberFormatCode: string | null;
  css: CSSProperties;
};
type Stylesheet = {
  cellStyles: CellStyle[];
};
type Theme = {
  colors: string[];
};
type ParsedCell = {
  address: string;
  raw: string | number | boolean;
  formatted: string;
  formula: string;
  type: CellDataType;
  numberFormatCode: string | null;
  style: CSSProperties;
};

const WORKBOOK_XML_PATH = "xl/workbook.xml";
const WORKBOOK_RELS_PATH = "xl/_rels/workbook.xml.rels";
const SHARED_STRINGS_PATH = "xl/sharedStrings.xml";
const STYLES_PATH = "xl/styles.xml";
const THEME_PATH = "xl/theme/theme1.xml";
const DEFAULT_COLUMN_WIDTH = 96;
const DEFAULT_FONT_FAMILY = "Arial, Helvetica, sans-serif";
const THEME_COLOR_ORDER = [
  "lt1",
  "dk1",
  "lt2",
  "dk2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
];
const INDEXED_COLORS = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];
const BUILT_IN_NUMBER_FORMATS = new Map<number, string>([
  [0, "General"],
  [1, "0"],
  [2, "0.00"],
  [3, "#,##0"],
  [4, "#,##0.00"],
  [9, "0%"],
  [10, "0.00%"],
  [14, "m/d/yy"],
  [15, "d-mmm-yy"],
  [16, "d-mmm"],
  [17, "mmm-yy"],
  [18, "h:mm AM/PM"],
  [19, "h:mm:ss AM/PM"],
  [20, "h:mm"],
  [21, "h:mm:ss"],
  [22, "m/d/yy h:mm"],
  [37, "#,##0 ;(#,##0)"],
  [38, "#,##0 ;[Red](#,##0)"],
  [39, "#,##0.00;(#,##0.00)"],
  [40, "#,##0.00;[Red](#,##0.00)"],
  [45, "mm:ss"],
  [46, "[h]:mm:ss"],
  [49, "@"],
]);

export function parseOoxmlWorkbook(bytes: Uint8Array): OoxmlWorkbook {
  const archive = unzipSync(bytes);
  const workbookDoc = parseXml(readArchiveText(archive, WORKBOOK_XML_PATH));
  const relationships = parseRelationships(parseXml(readArchiveText(archive, WORKBOOK_RELS_PATH)));
  const sharedStrings = parseSharedStrings(readOptionalArchiveText(archive, SHARED_STRINGS_PATH));
  const theme = parseTheme(readOptionalArchiveText(archive, THEME_PATH));
  const stylesheet = parseStylesheet(readOptionalArchiveText(archive, STYLES_PATH), theme);
  const activeTabIndex = readIntegerAttribute(firstElement(workbookDoc, "workbookView"), "activeTab");
  const sheets = elements(workbookDoc, "sheet").flatMap((sheet) => {
    const name = sheet.getAttribute("name");
    const relationshipId = sheet.getAttribute("r:id") ?? sheet.getAttribute("id");
    const target = relationshipId ? relationships.get(relationshipId) : null;
    const xml = target ? readOptionalArchiveText(archive, target) : null;

    if (!name || !xml) {
      return [];
    }

    const state = sheet.getAttribute("state");
    return [parseWorksheet({
      doc: parseXml(xml),
      name,
      hidden: state === "hidden" || state === "veryHidden",
      sharedStrings,
      stylesheet,
    })];
  });
  const activeSheetName =
    activeTabIndex != null && !sheets[activeTabIndex]?.hidden
      ? sheets[activeTabIndex]?.name
      : null;
  return {
    activeSheetName: activeSheetName ?? sheets.find((sheet) => !sheet.hidden)?.name ?? sheets[0]?.name ?? "Workbook",
    sheets,
  };
}

function parseRelationships(doc: Document): Map<string, string> {
  const relationships = new Map<string, string>();

  for (const relationship of elements(doc, "Relationship")) {
    const id = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target");

    if (id && target) {
      relationships.set(id, normalizeArchivePath("xl", target));
    }
  }

  return relationships;
}

function parseWorksheet(options: {
  doc: Document;
  name: string;
  hidden: boolean;
  sharedStrings: SharedStringTable;
  stylesheet: Stylesheet;
}): OoxmlSheet {
  const sheetFormat = firstElement(options.doc, "sheetFormatPr");
  const columns = parseColumns(options.doc);
  const parsedRows = parseRows(options.doc, options.sharedStrings, options.stylesheet);
  const mergedCells = parseMergedCells(options.doc);
  const range = inferSheetRange(options.doc, parsedRows, mergedCells, columns);
  const cellByAddress = new Map<string, ParsedCell>();
  const renderedCells = new Map<string, RenderedCellModel>();

  for (const row of parsedRows) {
    for (const cell of row.cells) {
      cellByAddress.set(cell.address, cell);
      renderedCells.set(cell.address, {
        address: cell.address,
        html: escapeHtml(cell.formatted) || "&nbsp;",
        text: cell.formatted,
        style: cell.style,
        colSpan: 1,
        rowSpan: 1,
      });
    }
  }

  const showGridLines = firstElement(options.doc, "sheetView")?.getAttribute("showGridLines") !== "0";
  const worksheet = createWorksheetModel({
    name: options.name,
    showGridLines,
    freezePanes: readFreezePanes(options.doc),
    range,
    cellByAddress,
  });

  return {
    name: options.name,
    hidden: options.hidden,
    columns,
    rows: parsedRows.map((row) => ({
      index: row.index,
      height: row.height,
      hidden: row.hidden,
      cells: row.cells.map((cell) => ({ address: cell.address })),
    })),
    defaultRowHeight: readNumberAttribute(sheetFormat, "defaultRowHeight"),
    defaultColWidth: readNumberAttribute(sheetFormat, "defaultColWidth"),
    showGridLines,
    mergedCells,
    range,
    renderedCells,
    worksheet,
  };
}

type ParsedRow = {
  index: number;
  height?: number;
  hidden?: boolean;
  cells: ParsedCell[];
};

function parseColumns(doc: Document): OoxmlColumn[] {
  return elements(doc, "col").flatMap((column) => {
    const min = readIntegerAttribute(column, "min");
    const max = readIntegerAttribute(column, "max") ?? min;

    if (!min || !max) {
      return [];
    }

    return [{
      min,
      max,
      width: readNumberAttribute(column, "width"),
      hidden: column.getAttribute("hidden") === "1",
    }];
  });
}

function parseRows(doc: Document, sharedStrings: SharedStringTable, stylesheet: Stylesheet): ParsedRow[] {
  const sharedFormulaByIndex = new Map<string, string>();

  return elements(doc, "row").map((row, rowPosition) => {
    const rowIndex = readIntegerAttribute(row, "r") ?? rowPosition + 1;

    return {
      index: rowIndex,
      height: readNumberAttribute(row, "ht"),
      hidden: row.getAttribute("hidden") === "1",
      cells: directChildren(row, "c").map((cell, cellPosition) => {
        const address = cell.getAttribute("r") ?? `${encodeColumn(cellPosition)}${rowIndex}`;
        return parseCell(cell, address, sharedStrings, stylesheet, sharedFormulaByIndex);
      }),
    };
  });
}

function parseCell(
  cell: Element,
  address: string,
  sharedStrings: SharedStringTable,
  stylesheet: Stylesheet,
  sharedFormulaByIndex: Map<string, string>,
): ParsedCell {
  const declaredType = cell.getAttribute("t");
  const styleIndex = readIntegerAttribute(cell, "s") ?? 0;
  const style = stylesheet.cellStyles[styleIndex] ?? { numberFormatCode: null, css: {} };
  const rawText = firstDirectChild(cell, "v")?.textContent ?? "";
  const inlineText = elements(firstDirectChild(cell, "is"), "t").map((text) => text.textContent ?? "").join("");
  const formulaElement = firstDirectChild(cell, "f");
  const formula = readFormula(formulaElement, sharedFormulaByIndex);
  const raw = parseRawCellValue(declaredType, rawText, inlineText, sharedStrings);
  const type = inferCellType(declaredType, raw, style.numberFormatCode);
  const formatted = formatCellValue(raw, type, style.numberFormatCode);

  return {
    address,
    raw,
    formatted,
    formula,
    type,
    numberFormatCode: style.numberFormatCode,
    style: style.css,
  };
}

function parseRawCellValue(
  declaredType: string | null,
  rawText: string,
  inlineText: string,
  sharedStrings: SharedStringTable,
): string | number | boolean {
  if (declaredType === "s") {
    const index = Number.parseInt(rawText, 10);
    return Number.isFinite(index) ? sharedStrings[index] ?? "" : "";
  }

  if (declaredType === "inlineStr") {
    return inlineText;
  }

  if (declaredType === "b") {
    return rawText === "1";
  }

  if (declaredType === "str" || declaredType === "e") {
    return rawText;
  }

  const number = Number(rawText);
  return rawText !== "" && Number.isFinite(number) ? number : rawText;
}

function inferCellType(
  declaredType: string | null,
  raw: string | number | boolean,
  numberFormatCode: string | null,
): CellDataType {
  if (declaredType === "s") {
    return "shared-string";
  }

  if (declaredType === "inlineStr") {
    return "inline-string";
  }

  if (declaredType === "b") {
    return "boolean";
  }

  if (declaredType === "e") {
    return "error";
  }

  if (typeof raw === "number") {
    return isDateFormat(numberFormatCode) ? "date" : "number";
  }

  if (typeof raw === "boolean") {
    return "boolean";
  }

  return raw ? "string" : "unspecified";
}

function readFormula(
  formulaElement: Element | null,
  sharedFormulaByIndex: Map<string, string>,
): string {
  if (!formulaElement) {
    return "";
  }

  const formulaText = formulaElement.textContent ?? "";
  const sharedIndex = formulaElement.getAttribute("si");

  if (formulaElement.getAttribute("t") === "shared" && sharedIndex) {
    if (formulaText) {
      sharedFormulaByIndex.set(sharedIndex, formulaText);
      return formulaText;
    }

    return sharedFormulaByIndex.get(sharedIndex) ?? "";
  }

  return formulaText;
}

function formatCellValue(
  raw: string | number | boolean,
  type: CellDataType,
  numberFormatCode: string | null,
): string {
  if (typeof raw === "boolean") {
    return raw ? "TRUE" : "FALSE";
  }

  if (typeof raw !== "number") {
    return raw;
  }

  if (type === "date") {
    return formatExcelDate(raw, numberFormatCode);
  }

  const formatSections = parseFormatSections(numberFormatCode);

  if (raw === 0 && formatSections.zero === "-") {
    return "-";
  }

  if (numberFormatCode?.includes("%")) {
    const decimals = countDecimalPlaces(numberFormatCode);
    return `${(raw * 100).toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}%`;
  }

  if (numberFormatCode?.includes(",")) {
    const decimals = countDecimalPlaces(numberFormatCode);
    const formattedAbs = Math.abs(raw).toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: Math.max(decimals, inferNumberDecimals(raw)),
    });

    if (raw < 0 && formatSections.negative.includes("(") && formatSections.negative.includes(")")) {
      return `(${formattedAbs})`;
    }

    return raw < 0 ? `-${formattedAbs}` : formattedAbs;
  }

  return String(raw);
}

function parseMergedCells(doc: Document): OoxmlMerge[] {
  return elements(doc, "mergeCell").flatMap((mergeCell) => {
    const ref = mergeCell.getAttribute("ref");
    const [startAddress, endAddress] = ref?.split(":") ?? [];

    return startAddress && endAddress ? [{ startAddress, endAddress }] : [];
  });
}

function parseSharedStrings(xml: string | null): SharedStringTable {
  if (!xml) {
    return [];
  }

  const doc = parseXml(xml);
  return elements(doc, "si").map((item) => elements(item, "t").map((text) => text.textContent ?? "").join(""));
}

function parseTheme(xml: string | null): Theme {
  if (!xml) {
    return { colors: [] };
  }

  const doc = parseXml(xml);
  const colorScheme = firstElement(doc, "clrScheme");
  const colors = THEME_COLOR_ORDER.map((slot) => {
    const colorSlot = firstDirectChild(colorScheme, slot);
    const srgbColor = firstElement(colorSlot, "srgbClr")?.getAttribute("val");
    const systemColor = firstElement(colorSlot, "sysClr")?.getAttribute("lastClr");
    return normalizeHexColorValue(srgbColor ?? systemColor) ?? "000000";
  });

  return { colors };
}

function parseStylesheet(xml: string | null, theme: Theme): Stylesheet {
  if (!xml) {
    return { cellStyles: [] };
  }

  const doc = parseXml(xml);
  const customNumberFormats = new Map<number, string>();

  for (const numFmt of elements(doc, "numFmt")) {
    const id = readIntegerAttribute(numFmt, "numFmtId");
    const code = numFmt.getAttribute("formatCode");

    if (id != null && code) {
      customNumberFormats.set(id, code);
    }
  }

  const fonts = directChildren(firstElement(doc, "fonts"), "font").map((font) => parseFontStyle(font, theme));
  const fills = directChildren(firstElement(doc, "fills"), "fill").map((fill) => parseFillStyle(fill, theme));
  const borders = directChildren(firstElement(doc, "borders"), "border").map((border) => parseBorderStyle(border, theme));
  const cellStyles = directChildren(firstElement(doc, "cellXfs"), "xf").map((xf) => {
    const numFmtId = readIntegerAttribute(xf, "numFmtId") ?? 0;
    const fontId = readIntegerAttribute(xf, "fontId") ?? 0;
    const fillId = readIntegerAttribute(xf, "fillId") ?? 0;
    const borderId = readIntegerAttribute(xf, "borderId") ?? 0;

    return {
      numberFormatCode: customNumberFormats.get(numFmtId) ?? BUILT_IN_NUMBER_FORMATS.get(numFmtId) ?? null,
      css: {
        ...(fonts[fontId] ?? {}),
        ...(fills[fillId] ?? {}),
        ...(borders[borderId] ?? {}),
        ...parseAlignmentStyle(firstDirectChild(xf, "alignment")),
      },
    };
  });

  return { cellStyles };
}

function parseFontStyle(font: Element, theme: Theme): CSSProperties {
  const color = readColor(firstDirectChild(font, "color"), theme);
  const size = firstDirectChild(font, "sz")?.getAttribute("val");
  const name = firstDirectChild(font, "name")?.getAttribute("val");

  return {
    ...(firstDirectChild(font, "b") ? { fontWeight: 700 } : {}),
    ...(firstDirectChild(font, "i") ? { fontStyle: "italic" } : {}),
    ...(firstDirectChild(font, "u") ? { textDecoration: "underline" } : {}),
    ...(color ? { color } : {}),
    ...(size ? { fontSize: `${size}pt` } : {}),
    ...(name ? { fontFamily: toCssFontFamily(name) } : {}),
  };
}

function parseFillStyle(fill: Element, theme: Theme): CSSProperties {
  const patternFill = firstDirectChild(fill, "patternFill");
  const color = readColor(firstDirectChild(patternFill, "fgColor"), theme);

  return color && patternFill?.getAttribute("patternType") !== "none"
    ? { backgroundColor: color }
    : {};
}

function parseBorderStyle(border: Element, theme: Theme): CSSProperties {
  const style: CSSProperties = {};
  const sides = [
    ["left", "borderLeft"],
    ["right", "borderRight"],
    ["top", "borderTop"],
    ["bottom", "borderBottom"],
  ] as const;

  for (const [xmlSide, cssProperty] of sides) {
    const side = firstDirectChild(border, xmlSide);
    const borderStyle = side?.getAttribute("style");

    if (!borderStyle) {
      continue;
    }

    const color = readColor(firstDirectChild(side, "color"), theme) ?? "rgba(15, 23, 42, 0.22)";
    style[cssProperty] = `${getCssBorderWidth(borderStyle)} ${getCssBorderLineStyle(borderStyle)} ${color}`;
  }

  return style;
}

function getCssBorderWidth(style: string): string {
  switch (style) {
    case "hair":
      return "1px";
    case "medium":
    case "mediumDashDot":
    case "mediumDashDotDot":
    case "mediumDashed":
      return "2px";
    case "double":
    case "thick":
      return "3px";
    default:
      return "1px";
  }
}

function getCssBorderLineStyle(style: string): string {
  switch (style) {
    case "dashDot":
    case "dashDotDot":
    case "dashed":
    case "mediumDashDot":
    case "mediumDashDotDot":
    case "mediumDashed":
    case "slantDashDot":
      return "dashed";
    case "dotted":
    case "hair":
      return "dotted";
    case "double":
      return "double";
    default:
      return "solid";
  }
}

function parseAlignmentStyle(alignment: Element | null): CSSProperties {
  const horizontal = alignment?.getAttribute("horizontal");
  const vertical = alignment?.getAttribute("vertical");

  const indent = Math.max(0, Number(alignment?.getAttribute("indent") ?? 0));

  return {
    ...(horizontal ? { textAlign: horizontal === "right" ? "right" : horizontal === "center" ? "center" : "left" } : {}),
    ...(vertical ? { verticalAlign: vertical === "bottom" ? "bottom" : vertical === "center" ? "middle" : "top" } : {}),
    ...(alignment?.getAttribute("wrapText") === "1" ? { whiteSpace: "normal" } : {}),
    ...(indent > 0 ? { paddingLeft: `${indent * 18}px` } : {}),
  };
}

function inferSheetRange(
  doc: Document,
  rows: ParsedRow[],
  merges: OoxmlMerge[],
  columns: OoxmlColumn[],
): GridRange | null {
  let range = decodeRangeAddress(firstElement(doc, "dimension")?.getAttribute("ref"));

  for (const column of columns) {
    range = mergeRanges(range, {
      startCol: column.min - 1,
      endCol: column.max - 1,
      startRow: 0,
      endRow: 0,
    });
  }

  for (const row of rows) {
    range = mergeRanges(range, {
      startCol: 0,
      endCol: Math.max(0, ...row.cells.map((cell) => decodeAddress(cell.address).col)),
      startRow: row.index - 1,
      endRow: row.index - 1,
    });
  }

  for (const merge of merges) {
    const start = decodeAddress(merge.startAddress);
    const end = decodeAddress(merge.endAddress);
    range = mergeRanges(range, {
      startCol: Math.min(start.col, end.col),
      endCol: Math.max(start.col, end.col),
      startRow: Math.min(start.row, end.row),
      endRow: Math.max(start.row, end.row),
    });
  }

  return range;
}

function createWorksheetModel(options: {
  name: string;
  showGridLines: boolean;
  freezePanes: { rowCount: number; columnCount: number };
  range: GridRange | null;
  cellByAddress: Map<string, ParsedCell>;
}): WorkbookWorksheet {
  return {
    name: options.name,
    showGridLines: options.showGridLines,
    freezePanes: options.freezePanes,
    getUsedRange() {
      return options.range
        ? {
            address: encodeRangeAddress(options.range),
            rowCount: options.range.endRow - options.range.startRow + 1,
            columnCount: options.range.endCol - options.range.startCol + 1,
          }
        : { rowCount: 0, columnCount: 0 };
    },
    getRange(address: string): WorkbookRange {
      const cell = options.cellByAddress.get(address);

      return {
        address,
        rowCount: 1,
        columnCount: 1,
        rawValues: [[cell?.raw ?? null]],
        values: [[cell?.formatted ?? ""]],
        displayFormula: cell?.formula ? `=${cell.formula}` : "",
        format: { numberFormat: cell?.numberFormatCode ?? undefined },
      };
    },
  };
}

function readFreezePanes(doc: Document): { rowCount: number; columnCount: number } {
  const pane = firstElement(doc, "pane");
  const state = pane?.getAttribute("state");

  if (state !== "frozen" && state !== "frozenSplit") {
    return { rowCount: 0, columnCount: 0 };
  }

  return {
    rowCount: Math.max(0, Math.round(Number(pane?.getAttribute("ySplit") ?? 0))),
    columnCount: Math.max(0, Math.round(Number(pane?.getAttribute("xSplit") ?? 0))),
  };
}

function readArchiveText(archive: Record<string, Uint8Array>, path: string): string {
  const bytes = archive[path];

  if (!bytes) {
    throw new Error(`Workbook is missing ${path}.`);
  }

  return strFromU8(bytes);
}

function readOptionalArchiveText(archive: Record<string, Uint8Array>, path: string): string | null {
  const bytes = archive[path];
  return bytes ? strFromU8(bytes) : null;
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  if (firstElement(doc, "parsererror")) {
    throw new Error("Spreadsheet XML could not be parsed.");
  }

  return doc;
}

function elements(root: ParentNode | null, localName: string): Element[] {
  if (!root) {
    return [];
  }

  return Array.from((root as Document | Element).getElementsByTagNameNS("*", localName));
}

function firstElement(root: ParentNode | null, localName: string): Element | null {
  return elements(root, localName)[0] ?? null;
}

function directChildren(root: Element | null | undefined, localName: string): Element[] {
  return root ? Array.from(root.children).filter((child) => child.localName === localName) : [];
}

function firstDirectChild(root: Element | null | undefined, localName: string): Element | null {
  return directChildren(root, localName)[0] ?? null;
}

function readIntegerAttribute(element: Element | null | undefined, name: string): number | null {
  const value = element?.getAttribute(name);
  const number = value == null ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function readNumberAttribute(element: Element | null | undefined, name: string): number | undefined {
  const value = element?.getAttribute(name);
  const number = value == null ? Number.NaN : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readColor(element: Element | null, theme: Theme): string | null {
  const rgb = element?.getAttribute("rgb");
  const normalizedRgb = normalizeHexColorValue(rgb);

  if (normalizedRgb) {
    return `#${normalizedRgb}`;
  }

  const themeIndex = readIntegerAttribute(element, "theme");

  if (themeIndex != null) {
    const themeColor = theme.colors[themeIndex];

    if (themeColor) {
      const tint = Number(element?.getAttribute("tint") ?? 0);
      return `#${applyTint(themeColor, Number.isFinite(tint) ? tint : 0)}`;
    }
  }

  const indexedColor = INDEXED_COLORS[readIntegerAttribute(element, "indexed") ?? -1];
  return indexedColor ? `#${indexedColor}` : null;
}

function normalizeHexColorValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (/^[0-9A-Fa-f]{8}$/.test(value)) {
    return value.slice(2).toUpperCase();
  }

  if (/^[0-9A-Fa-f]{6}$/.test(value)) {
    return value.toUpperCase();
  }

  return null;
}

function applyTint(hexColor: string, tint: number): string {
  const rgb = hexToRgb(hexColor);

  if (!rgb || tint === 0) {
    return hexColor.toUpperCase();
  }

  return rgbToHex({
    r: applyTintChannel(rgb.r, tint),
    g: applyTintChannel(rgb.g, tint),
    b: applyTintChannel(rgb.b, tint),
  });
}

function applyTintChannel(channel: number, tint: number): number {
  const value = tint < 0
    ? channel * (1 + tint)
    : channel + (255 - channel) * tint;

  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hexColor: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHexColorValue(hexColor);

  if (!normalized) {
    return null;
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  return [rgb.r, rgb.g, rgb.b]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function toCssFontFamily(name: string): string {
  const escapedName = name.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  const family = /^[A-Za-z0-9_-]+$/.test(escapedName) ? escapedName : `"${escapedName}"`;
  return `${family}, ${DEFAULT_FONT_FAMILY}`;
}

function isDateFormat(formatCode: string | null): boolean {
  if (!formatCode) {
    return false;
  }

  const normalized = formatCode
    .replace(/\[[^\]]+\]/g, "")
    .replace(/"[^"]*"/g, "")
    .toLowerCase();

  return /(^|[^a-z])(m|mm|mmm|mmmm|d|dd|yy|yyyy|h|hh|ss)([^a-z]|$)/.test(normalized)
    && !normalized.includes("general");
}

function formatExcelDate(serial: number, formatCode: string | null): string {
  const excelEpoch = Date.UTC(1899, 11, 30);
  const date = new Date(excelEpoch + serial * 86_400_000);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const yearTwoDigit = String(year).slice(-2);
  const monthTwoDigit = String(month).padStart(2, "0");
  const dayTwoDigit = String(day).padStart(2, "0");
  const normalizedFormat = stripFormatDirectives(formatCode ?? "").toLowerCase();

  if (normalizedFormat.includes("yyyy-mm-dd")) {
    return `${year}-${monthTwoDigit}-${dayTwoDigit}`;
  }

  if (normalizedFormat.includes("mm/dd/yy")) {
    return `${monthTwoDigit}/${dayTwoDigit}/${yearTwoDigit}`;
  }

  if (normalizedFormat.includes("m/d/yy")) {
    return `${month}/${day}/${yearTwoDigit}`;
  }

  if (normalizedFormat.includes("d-mmm-yy")) {
    return new Intl.DateTimeFormat("en-US", {
      year: "2-digit",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(date).replace(/, /, "-").replace(" ", "-");
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function parseFormatSections(formatCode: string | null): {
  positive: string;
  negative: string;
  zero: string;
  text: string;
} {
  const sections = splitFormatSections(formatCode ?? "").map(stripFormatDirectives);
  const positive = sections[0] ?? "";
  const negative = sections[1] ?? positive;
  const zero = sections[2] ?? positive;

  return {
    positive,
    negative,
    zero,
    text: sections[3] ?? "",
  };
}

function splitFormatSections(formatCode: string): string[] {
  const sections: string[] = [];
  let current = "";
  let inString = false;

  for (const char of formatCode) {
    if (char === "\"") {
      inString = !inString;
      current += char;
    } else if (char === ";" && !inString) {
      sections.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  sections.push(current);
  return sections;
}

function stripFormatDirectives(formatCode: string): string {
  return formatCode
    .replace(/\[[^\]]+\]/g, "")
    .replace(/"([^"]*)"/g, "$1")
    .replace(/\\/g, "")
    .trim();
}

function countDecimalPlaces(formatCode: string | null): number {
  const match = formatCode?.match(/0\.([0#]+)/);
  return match?.[1]?.length ?? 0;
}

function inferNumberDecimals(value: number): number {
  const [, decimals = ""] = String(value).split(".");
  return Math.min(6, decimals.length);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeArchivePath(baseDirectory: string, target: string): string {
  if (target.startsWith("/")) {
    return target.replace(/^\/+/, "");
  }

  const normalized: string[] = [];

  for (const segment of `${baseDirectory}/${target}`.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      normalized.pop();
    } else {
      normalized.push(segment);
    }
  }

  return normalized.join("/");
}

function decodeRangeAddress(address: string | null | undefined): GridRange | null {
  if (!address) {
    return null;
  }

  const [startAddress, endAddress] = address.split(":");
  const start = decodeAddress(startAddress ?? "");
  const end = decodeAddress(endAddress ?? startAddress ?? "");

  return {
    startCol: Math.min(start.col, end.col),
    endCol: Math.max(start.col, end.col),
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
  };
}

function mergeRanges(left: GridRange | null, right: GridRange | null): GridRange | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return {
    startCol: Math.min(left.startCol, right.startCol),
    endCol: Math.max(left.endCol, right.endCol),
    startRow: Math.min(left.startRow, right.startRow),
    endRow: Math.max(left.endRow, right.endRow),
  };
}

function encodeRangeAddress(range: GridRange): string {
  return `${encodeAddress(range.startCol, range.startRow)}:${encodeAddress(range.endCol, range.endRow)}`;
}

function decodeAddress(address: string): CellAddress {
  const match = address.match(/^([A-Z]+)(\d+)$/i);

  if (!match) {
    return { col: 0, row: 0 };
  }

  return {
    col: decodeColumn(match[1] ?? "A"),
    row: Math.max(0, Number.parseInt(match[2] ?? "1", 10) - 1),
  };
}

function encodeAddress(col: number, row: number): string {
  return `${encodeColumn(col)}${row + 1}`;
}

function encodeColumn(col: number): string {
  let value = col + 1;
  let label = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}

function decodeColumn(label: string): number {
  let result = 0;

  for (const char of label.toUpperCase()) {
    result = result * 26 + (char.charCodeAt(0) - 64);
  }

  return result - 1;
}

export function excelColumnWidthToPx(width: number | undefined): number {
  if (!width || !Number.isFinite(width)) {
    return DEFAULT_COLUMN_WIDTH;
  }

  return Math.max(20, Math.round(width * 7 + 12));
}
