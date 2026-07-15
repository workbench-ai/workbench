import {
  decodeAddress,
  encodeAddress,
  type CellAddress,
  type GridRange,
} from "./spreadsheet-viewer-address";
import {
  excelColumnWidthToPx,
  parseOoxmlWorkbook,
  type OoxmlCell,
  type OoxmlSheet,
} from "./spreadsheet-viewer-ooxml";

export type { CellAddress, GridRange } from "./spreadsheet-viewer-address";

export type MergeSpan = {
  colSpan: number;
  rowSpan: number;
};

export type WorkbookModel = {
  activeSheetName: string;
  sheets: Record<string, SheetModel>;
};

export type SheetViewportExtent = {
  endRow: number;
  endCol: number;
};

export type SheetViewportMetrics = {
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  clientHeight: number;
};

export type SheetModel = {
  range: GridRange | null;
  hiddenRows: Set<number>;
  hiddenCols: Set<number>;
  mergeLookup: Map<string, MergeSpan>;
  mergeStartByAddress: Map<string, string>;
  coveredCells: Set<string>;
  colWidthMap: Map<number, number>;
  rowHeightMap: Map<number, number>;
  cells: Map<string, OoxmlCell>;
  showGridLines: boolean;
  freezePanes: {
    rowCount: number;
    columnCount: number;
  };
};

export type SheetRowWindow = {
  frozenRows: number[];
  scrollableRows: number[];
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  frozenRowsHeight: number;
};

export type SelectionModel = {
  address: string;
  raw: string;
  formula: string;
};

const DEFAULT_COLUMN_WIDTH = 96;
const DEFAULT_ROW_HEIGHT = 22;

export const MAX_SHEET_ROW_INDEX = 1_048_575;
export const MAX_SHEET_COL_INDEX = 16_383;
const DEFAULT_AXIS_OVERSCAN_COUNT = 8;

export function parseSpreadsheetViewerWorkbook(
  bytes: ArrayBuffer,
): WorkbookModel {
  const byteArray = new Uint8Array(bytes);
  return buildWorkbookModel(parseOoxmlWorkbook(byteArray));
}

function buildWorkbookModel(workbook: ReturnType<typeof parseOoxmlWorkbook>): WorkbookModel {
  const sheetEntries = workbook.sheets
    .filter((sheet) => !sheet.hidden)
    .map((sheet) => [sheet.name, buildSheetModel(sheet)] as const);

  const sheets = Object.fromEntries(sheetEntries);
  const activeSheetName = sheets[workbook.activeSheetName]
    ? workbook.activeSheetName
    : Object.keys(sheets)[0] ?? "";

  return {
    activeSheetName,
    sheets,
  };
}

function buildSheetModel(sheet: OoxmlSheet): SheetModel {
  const hiddenRows = new Set<number>();
  const hiddenCols = new Set<number>();
  const mergeLookup = new Map<string, MergeSpan>();
  const mergeStartByAddress = new Map<string, string>();
  const coveredCells = new Set<string>();
  const colWidthMap = new Map<number, number>();
  const rowHeightMap = new Map<number, number>();

  for (const column of sheet.columns) {
    const min = Math.max(0, column.min - 1);
    const max = Math.max(min, column.max - 1);

    for (let col = min; col <= max; col += 1) {
      colWidthMap.set(col, excelColumnWidthToPx(column.width ?? sheet.defaultColWidth));

      if (column.hidden) {
        hiddenCols.add(col);
      }
    }
  }

  for (const row of sheet.rows) {
    const rowIndex = Math.max(0, row.index - 1);
    rowHeightMap.set(
      rowIndex,
      pointsToPixels(row.height ?? sheet.defaultRowHeight ?? 15, DEFAULT_ROW_HEIGHT),
    );

    if (row.hidden) {
      hiddenRows.add(rowIndex);
    }

  }

  for (const merge of sheet.mergedCells) {
    if (!merge.startAddress || !merge.endAddress) {
      continue;
    }

    const start = decodeAddress(merge.startAddress);
    const end = decodeAddress(merge.endAddress);
    const startAddress = encodeAddress(start.col, start.row);

    mergeLookup.set(startAddress, {
      colSpan: end.col - start.col + 1,
      rowSpan: end.row - start.row + 1,
    });

    for (let row = start.row; row <= end.row; row += 1) {
      for (let col = start.col; col <= end.col; col += 1) {
        const address = encodeAddress(col, row);
        mergeStartByAddress.set(address, startAddress);

        if (address !== startAddress) {
          coveredCells.add(address);
        }
      }
    }
  }

  return {
    range: sheet.range,
    hiddenRows,
    hiddenCols,
    mergeLookup,
    mergeStartByAddress,
    coveredCells,
    colWidthMap,
    rowHeightMap,
    cells: sheet.cells,
    showGridLines: sheet.showGridLines,
    freezePanes: sheet.freezePanes,
  };
}

function pointsToPixels(points: number, fallback: number): number {
  if (!points || !Number.isFinite(points)) {
    return fallback;
  }

  return Math.max(DEFAULT_ROW_HEIGHT, Math.round(points * 1.3333));
}

export function getSheetSelection(
  sheet: SheetModel,
  address: string | null,
): SelectionModel | null {
  const resolvedAddress = resolveSelectionAddress(sheet, address);

  if (!resolvedAddress) {
    return null;
  }

  const cell = sheet.cells.get(resolvedAddress);

  return {
    address: resolvedAddress,
    raw: cell == null ? "" : String(cell.raw),
    formula: cell?.formula ?? "",
  };
}

export function getBaseSheetExtent(sheet: SheetModel): SheetViewportExtent {
  return {
    endRow: Math.max(0, sheet.range?.endRow ?? 0),
    endCol: Math.max(0, sheet.range?.endCol ?? 0),
  };
}

export function expandSheetExtentToIncludeCell(
  extent: SheetViewportExtent,
  address: CellAddress,
): SheetViewportExtent {
  const nextEndRow = Math.min(MAX_SHEET_ROW_INDEX, Math.max(extent.endRow, address.row));
  const nextEndCol = Math.min(MAX_SHEET_COL_INDEX, Math.max(extent.endCol, address.col));

  if (nextEndRow === extent.endRow && nextEndCol === extent.endCol) {
    return extent;
  }

  return {
    endRow: nextEndRow,
    endCol: nextEndCol,
  };
}

export function expandSheetExtentToFitViewport(
  extent: SheetViewportExtent,
  metrics: {
    clientWidth: number;
    clientHeight: number;
    rowHeaderWidth: number;
    columnHeaderHeight: number;
  },
  geometry: {
    getColumnWidth: (col: number) => number;
    getRowHeight: (row: number) => number;
    isColumnHidden?: (col: number) => boolean;
    isRowHidden?: (row: number) => boolean;
  },
): SheetViewportExtent {
  const nextEndRow = growAxisToCoverViewport({
    currentEnd: extent.endRow,
    maxIndex: MAX_SHEET_ROW_INDEX,
    clientSize: metrics.clientHeight,
    headerSize: metrics.columnHeaderHeight,
    getSize: geometry.getRowHeight,
    isHidden: geometry.isRowHidden,
  });
  const nextEndCol = growAxisToCoverViewport({
    currentEnd: extent.endCol,
    maxIndex: MAX_SHEET_COL_INDEX,
    clientSize: metrics.clientWidth,
    headerSize: metrics.rowHeaderWidth,
    getSize: geometry.getColumnWidth,
    isHidden: geometry.isColumnHidden,
  });

  if (nextEndRow === extent.endRow && nextEndCol === extent.endCol) {
    return extent;
  }

  return {
    endRow: nextEndRow,
    endCol: nextEndCol,
  };
}

function growAxisToCoverViewport(options: {
  currentEnd: number;
  maxIndex: number;
  clientSize: number;
  headerSize: number;
  getSize: (index: number) => number;
  isHidden?: (index: number) => boolean;
}): number {
  const targetSize = Math.max(
    0,
    Math.max(0, options.clientSize - options.headerSize),
  );

  if (targetSize <= 0) {
    return options.currentEnd;
  }

  let coveredSize = 0;

  for (let index = 0; index <= options.currentEnd; index += 1) {
    if (options.isHidden?.(index)) {
      continue;
    }

    coveredSize += Math.max(0, options.getSize(index));
  }

  if (coveredSize >= targetSize) {
    return options.currentEnd;
  }

  let nextEnd = options.currentEnd;

  while (coveredSize < targetSize && nextEnd < options.maxIndex) {
    nextEnd += 1;

    if (options.isHidden?.(nextEnd)) {
      continue;
    }

    coveredSize += Math.max(0, options.getSize(nextEnd));
  }

  return nextEnd;
}

function getVisibleRowIndices(
  sheet: SheetModel,
  extent: SheetViewportExtent = getBaseSheetExtent(sheet),
): number[] {
  const rows: number[] = [];
  const { endRow } = extent;

  for (let row = 0; row <= endRow; row += 1) {
    if (!sheet.hiddenRows.has(row)) {
      rows.push(row);
    }
  }

  return rows;
}

export function getVisibleColIndices(
  sheet: SheetModel,
  extent: SheetViewportExtent = getBaseSheetExtent(sheet),
): number[] {
  const cols: number[] = [];
  const { endCol } = extent;

  for (let col = 0; col <= endCol; col += 1) {
    if (!sheet.hiddenCols.has(col)) {
      cols.push(col);
    }
  }

  return cols;
}

export function getSheetRowWindow(
  sheet: SheetModel,
  extent: SheetViewportExtent,
  metrics: SheetViewportMetrics,
  options: {
    headerHeight: number;
    frozenRowCount: number;
    getRowHeight: (row: number) => number;
    overscanCount?: number;
  },
): SheetRowWindow {
  const visibleRows = getVisibleRowIndices(sheet, extent);
  const frozenRows = visibleRows.filter((row) => row < options.frozenRowCount);
  const scrollableRows = visibleRows.filter((row) => row >= options.frozenRowCount);
  const frozenRowsHeight = sumAxisSizes(frozenRows, options.getRowHeight);

  if (scrollableRows.length === 0) {
    return {
      frozenRows,
      scrollableRows,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      frozenRowsHeight,
    };
  }

  const scrollableViewportHeight = Math.max(
    0,
    metrics.clientHeight - options.headerHeight - frozenRowsHeight,
  );
  const axisWindow = getAxisWindow(scrollableRows, {
    scrollOffset: metrics.scrollTop,
    viewportSize: scrollableViewportHeight,
    getSize: options.getRowHeight,
    overscanCount: options.overscanCount ?? DEFAULT_AXIS_OVERSCAN_COUNT,
  });
  const mergeExpandedBounds = expandRowWindowForMerges(
    sheet,
    axisWindow.firstIndex == null ? null : scrollableRows[axisWindow.firstIndex] ?? null,
    axisWindow.lastIndex == null ? null : scrollableRows[axisWindow.lastIndex] ?? null,
  );
  const rowBounds = mergeExpandedBounds
    ? {
        start: mergeExpandedBounds.startRow,
        end: mergeExpandedBounds.endRow,
      }
    : null;
  const renderStartIndex = rowBounds
    ? findAxisIndexAtOrAfter(scrollableRows, rowBounds.start)
    : axisWindow.firstIndex;
  const renderEndIndex = rowBounds
    ? findAxisIndexAtOrBefore(scrollableRows, rowBounds.end)
    : axisWindow.lastIndex;

  if (renderStartIndex == null || renderEndIndex == null) {
    return {
      frozenRows,
      scrollableRows: [],
      topSpacerHeight: 0,
      bottomSpacerHeight: sumAxisSizes(scrollableRows, options.getRowHeight),
      frozenRowsHeight,
    };
  }

  const renderedScrollableRows = scrollableRows.slice(
    renderStartIndex,
    renderEndIndex + 1,
  );
  const topSpacerHeight = sumAxisSizes(
    scrollableRows.slice(0, renderStartIndex),
    options.getRowHeight,
  );
  const renderedScrollableHeight = sumAxisSizes(
    renderedScrollableRows,
    options.getRowHeight,
  );
  const totalScrollableHeight = sumAxisSizes(scrollableRows, options.getRowHeight);

  return {
    frozenRows,
    scrollableRows: renderedScrollableRows,
    topSpacerHeight,
    bottomSpacerHeight: Math.max(
      0,
      totalScrollableHeight - topSpacerHeight - renderedScrollableHeight,
    ),
    frozenRowsHeight,
  };
}

export function getDefaultSelectionAddress(
  sheet: SheetModel,
  extent: SheetViewportExtent = getBaseSheetExtent(sheet),
): string | null {
  const row = getFirstVisibleRow(sheet, extent);
  const col = getFirstVisibleCol(sheet, extent);

  if (row == null || col == null) {
    return null;
  }

  return resolveSelectionAddress(sheet, encodeAddress(col, row));
}

export function getFirstVisibleRow(
  sheet: SheetModel,
  extent: SheetViewportExtent,
): number | null {
  return findNextVisibleIndex(sheet.hiddenRows, 0, 1, extent.endRow);
}

export function getLastVisibleRow(
  sheet: SheetModel,
  extent: SheetViewportExtent,
): number | null {
  return findNextVisibleIndex(sheet.hiddenRows, extent.endRow, -1, extent.endRow);
}

export function getFirstVisibleCol(
  sheet: SheetModel,
  extent: SheetViewportExtent,
): number | null {
  return findNextVisibleIndex(sheet.hiddenCols, 0, 1, extent.endCol);
}

export function getLastVisibleCol(
  sheet: SheetModel,
  extent: SheetViewportExtent,
): number | null {
  return findNextVisibleIndex(sheet.hiddenCols, extent.endCol, -1, extent.endCol);
}

export function findNearestVisibleRow(
  sheet: SheetModel,
  row: number,
  maxRow: number,
): number {
  return findNearestVisibleIndex(sheet.hiddenRows, row, maxRow);
}

export function findNearestVisibleCol(
  sheet: SheetModel,
  col: number,
  maxCol: number,
): number {
  return findNearestVisibleIndex(sheet.hiddenCols, col, maxCol);
}

export function findNextVisibleRow(
  sheet: SheetModel,
  row: number,
  direction: -1 | 1,
  maxRow: number,
): number {
  return findNextVisibleIndex(sheet.hiddenRows, row + direction, direction, maxRow)
    ?? clampGridIndex(row, maxRow);
}

export function findNextVisibleCol(
  sheet: SheetModel,
  col: number,
  direction: -1 | 1,
  maxCol: number,
): number {
  return findNextVisibleIndex(sheet.hiddenCols, col + direction, direction, maxCol)
    ?? clampGridIndex(col, maxCol);
}

export function resolveSelectionAddress(sheet: SheetModel, address: string | null): string | null {
  if (!address) {
    return null;
  }

  return sheet.mergeStartByAddress.get(address) ?? address;
}

export function isCoveredByMerge(sheet: SheetModel, address: string): boolean {
  return sheet.coveredCells.has(address);
}

export function getMergeSpan(sheet: SheetModel, address: string): MergeSpan | null {
  const resolvedAddress = resolveSelectionAddress(sheet, address);
  return resolvedAddress ? sheet.mergeLookup.get(resolvedAddress) ?? null : null;
}

export function getRenderedCell(sheet: SheetModel, address: string): OoxmlCell | null {
  const resolvedAddress = resolveSelectionAddress(sheet, address);
  return resolvedAddress ? sheet.cells.get(resolvedAddress) ?? null : null;
}

export function getColumnWidth(sheet: SheetModel, col: number): number {
  return sheet.colWidthMap.get(col) ?? DEFAULT_COLUMN_WIDTH;
}

export function getRowHeight(sheet: SheetModel, row: number): number {
  return sheet.rowHeightMap.get(row) ?? DEFAULT_ROW_HEIGHT;
}

export function safeSheetName(sheetName: string): string {
  return sheetName.replace(/\s+/g, "-").replace(/[^a-z0-9-]/gi, "").toLowerCase();
}

export function decodeCellAddress(address: string | null): CellAddress | null {
  if (!address) {
    return null;
  }

  return decodeAddress(address);
}

function clampGridIndex(value: number, maxIndex: number): number {
  return Math.max(0, Math.min(maxIndex, value));
}

function findNearestVisibleIndex(
  hiddenIndices: Set<number>,
  value: number,
  maxIndex: number,
): number {
  const clampedValue = clampGridIndex(value, maxIndex);

  if (!hiddenIndices.has(clampedValue)) {
    return clampedValue;
  }

  for (let distance = 1; distance <= maxIndex + 1; distance += 1) {
    const backward = clampedValue - distance;

    if (backward >= 0 && !hiddenIndices.has(backward)) {
      return backward;
    }

    const forward = clampedValue + distance;

    if (forward <= maxIndex && !hiddenIndices.has(forward)) {
      return forward;
    }
  }

  return 0;
}

function findNextVisibleIndex(
  hiddenIndices: Set<number>,
  start: number,
  direction: -1 | 1,
  maxIndex: number,
): number | null {
  let candidate = clampGridIndex(start, maxIndex);

  while (candidate >= 0 && candidate <= maxIndex) {
    if (!hiddenIndices.has(candidate)) {
      return candidate;
    }

    candidate += direction;
  }

  return null;
}

function sumAxisSizes(indices: number[], getSize: (index: number) => number): number {
  let total = 0;

  for (const index of indices) {
    total += Math.max(0, getSize(index));
  }

  return total;
}

function getAxisWindow(
  indices: number[],
  options: {
    scrollOffset: number;
    viewportSize: number;
    getSize: (index: number) => number;
    overscanCount: number;
  },
): {
  firstIndex: number | null;
  lastIndex: number | null;
} {
  if (indices.length === 0) {
    return {
      firstIndex: null,
      lastIndex: null,
    };
  }

  const prefixSums = [0];

  for (const index of indices) {
    prefixSums.push(prefixSums[prefixSums.length - 1]! + Math.max(0, options.getSize(index)));
  }

  const viewportStart = Math.max(0, options.scrollOffset);
  const viewportEnd = Math.max(viewportStart, viewportStart + Math.max(0, options.viewportSize));
  const startIndex = clampWindowIndex(
    lowerBoundPrefix(prefixSums, viewportStart) - 1,
    indices.length - 1,
  );
  const endIndex = clampWindowIndex(
    Math.max(startIndex, lowerBoundPrefix(prefixSums, viewportEnd) - 1),
    indices.length - 1,
  );

  return {
    firstIndex: Math.max(0, startIndex - options.overscanCount),
    lastIndex: Math.min(indices.length - 1, endIndex + options.overscanCount),
  };
}

function lowerBoundPrefix(prefixSums: number[], target: number): number {
  let low = 0;
  let high = prefixSums.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);

    if (prefixSums[mid]! < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function clampWindowIndex(index: number, maxIndex: number): number {
  if (!Number.isFinite(index)) {
    return 0;
  }

  return Math.max(0, Math.min(maxIndex, index));
}

function expandRowWindowForMerges(
  sheet: SheetModel,
  startRow: number | null,
  endRow: number | null,
): { startRow: number; endRow: number } | null {
  if (startRow == null || endRow == null) {
    return null;
  }

  let nextStartRow = startRow;
  let nextEndRow = endRow;

  for (const [address, merge] of sheet.mergeLookup) {
    if (merge.rowSpan <= 1) {
      continue;
    }

    const start = decodeAddress(address);
    const mergeStartRow = start.row;
    const mergeEndRow = start.row + merge.rowSpan - 1;

    if (mergeEndRow < nextStartRow || mergeStartRow > nextEndRow) {
      continue;
    }

    nextStartRow = Math.min(nextStartRow, mergeStartRow);
    nextEndRow = Math.max(nextEndRow, mergeEndRow);
  }

  return {
    startRow: nextStartRow,
    endRow: nextEndRow,
  };
}

function findAxisIndexAtOrAfter(indices: number[], target: number): number | null {
  for (let index = 0; index < indices.length; index += 1) {
    if (indices[index]! >= target) {
      return index;
    }
  }

  return null;
}

function findAxisIndexAtOrBefore(indices: number[], target: number): number | null {
  for (let index = indices.length - 1; index >= 0; index -= 1) {
    if (indices[index]! <= target) {
      return index;
    }
  }

  return null;
}
