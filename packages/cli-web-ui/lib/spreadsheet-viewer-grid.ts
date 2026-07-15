import {
  encodeAddress,
} from "./spreadsheet-viewer-address";
import {
  decodeCellAddress,
  findNearestVisibleCol,
  findNearestVisibleRow,
  findNextVisibleCol,
  findNextVisibleRow,
  getDefaultSelectionAddress,
  getFirstVisibleCol,
  getFirstVisibleRow,
  getLastVisibleCol,
  getLastVisibleRow,
  resolveSelectionAddress,
  MAX_SHEET_COL_INDEX,
  MAX_SHEET_ROW_INDEX,
  type CellAddress,
  type GridRange,
  type SheetModel,
  type SheetViewportExtent,
} from "./spreadsheet-viewer-model";

export type GridSelectionMode = "cell" | "row" | "column" | "all";

export type GridSelection = {
  mode: GridSelectionMode;
  anchor: CellAddress;
  focus: CellAddress;
};

export type KeyboardNavigationInput = {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
};

export function createInitialSelection(
  sheet: SheetModel,
  extent: SheetViewportExtent,
): GridSelection | null {
  const defaultAddress = getDefaultSelectionAddress(sheet, extent);

  if (!defaultAddress) {
    return null;
  }

  return createCellSelection(
    sheet,
    decodeCellAddress(defaultAddress) ?? getFallbackCoord(sheet, extent),
    extent,
  );
}

export function createCellSelection(
  sheet: SheetModel,
  coord: CellAddress,
  extent: SheetViewportExtent,
): GridSelection {
  const normalized = normalizeCoord(sheet, coord, extent);

  return {
    mode: "cell",
    anchor: normalized,
    focus: normalized,
  };
}

export function createRowSelection(
  sheet: SheetModel,
  row: number,
  extent: SheetViewportExtent,
  anchorRow = row,
): GridSelection {
  const leadCol = getFirstVisibleCol(sheet, extent) ?? 0;
  const normalizedAnchor = normalizeCoord(sheet, { row: anchorRow, col: leadCol }, extent);
  const normalizedFocus = normalizeCoord(sheet, { row, col: leadCol }, extent);

  return {
    mode: "row",
    anchor: normalizedAnchor,
    focus: normalizedFocus,
  };
}

export function createColumnSelection(
  sheet: SheetModel,
  col: number,
  extent: SheetViewportExtent,
  anchorCol = col,
): GridSelection {
  const leadRow = getFirstVisibleRow(sheet, extent) ?? 0;
  const normalizedAnchor = normalizeCoord(sheet, { row: leadRow, col: anchorCol }, extent);
  const normalizedFocus = normalizeCoord(sheet, { row: leadRow, col }, extent);

  return {
    mode: "column",
    anchor: normalizedAnchor,
    focus: normalizedFocus,
  };
}

export function createAllSelection(
  sheet: SheetModel,
  extent: SheetViewportExtent,
): GridSelection | null {
  const first = {
    row: getFirstVisibleRow(sheet, extent) ?? 0,
    col: getFirstVisibleCol(sheet, extent) ?? 0,
  };
  const last = {
    row: getLastVisibleRow(sheet, extent) ?? first.row,
    col: getLastVisibleCol(sheet, extent) ?? first.col,
  };

  if (getFirstVisibleRow(sheet, extent) == null || getFirstVisibleCol(sheet, extent) == null) {
    return null;
  }

  return {
    mode: "all",
    anchor: normalizeCoord(sheet, first, extent),
    focus: normalizeCoord(sheet, last, extent),
  };
}

export function extendSelectionToCell(
  sheet: SheetModel,
  selection: GridSelection,
  coord: CellAddress,
  extent: SheetViewportExtent,
): GridSelection {
  return {
    mode: "cell",
    anchor: selection.anchor,
    focus: normalizeCoord(sheet, coord, extent),
  };
}

export function extendSelectionToRow(
  sheet: SheetModel,
  selection: GridSelection,
  row: number,
  extent: SheetViewportExtent,
): GridSelection {
  return createRowSelection(sheet, row, extent, selection.anchor.row);
}

export function extendSelectionToColumn(
  sheet: SheetModel,
  selection: GridSelection,
  col: number,
  extent: SheetViewportExtent,
): GridSelection {
  return createColumnSelection(sheet, col, extent, selection.anchor.col);
}

export function getSelectionAddress(sheet: SheetModel, selection: GridSelection): string {
  return resolveSelectionAddress(sheet, encodeAddress(selection.focus.col, selection.focus.row))
    ?? encodeAddress(selection.focus.col, selection.focus.row);
}

export function getSelectionRange(
  sheet: SheetModel,
  selection: GridSelection,
  extent: SheetViewportExtent,
): GridRange {
  const firstVisibleRow = getFirstVisibleRow(sheet, extent) ?? 0;
  const lastVisibleRow = getLastVisibleRow(sheet, extent) ?? firstVisibleRow;
  const firstVisibleCol = getFirstVisibleCol(sheet, extent) ?? 0;
  const lastVisibleCol = getLastVisibleCol(sheet, extent) ?? firstVisibleCol;

  switch (selection.mode) {
    case "row":
      return {
        startCol: firstVisibleCol,
        endCol: lastVisibleCol,
        startRow: Math.min(selection.anchor.row, selection.focus.row),
        endRow: Math.max(selection.anchor.row, selection.focus.row),
      };
    case "column":
      return {
        startCol: Math.min(selection.anchor.col, selection.focus.col),
        endCol: Math.max(selection.anchor.col, selection.focus.col),
        startRow: firstVisibleRow,
        endRow: lastVisibleRow,
      };
    case "all":
      return {
        startCol: firstVisibleCol,
        endCol: lastVisibleCol,
        startRow: firstVisibleRow,
        endRow: lastVisibleRow,
      };
    case "cell":
    default:
      return {
        startCol: Math.min(selection.anchor.col, selection.focus.col),
        endCol: Math.max(selection.anchor.col, selection.focus.col),
        startRow: Math.min(selection.anchor.row, selection.focus.row),
        endRow: Math.max(selection.anchor.row, selection.focus.row),
      };
  }
}

export function isCellWithinSelection(
  sheet: SheetModel,
  selection: GridSelection | null,
  row: number,
  col: number,
  extent: SheetViewportExtent,
): boolean {
  if (!selection) {
    return false;
  }

  const range = getSelectionRange(sheet, selection, extent);

  return row >= range.startRow
    && row <= range.endRow
    && col >= range.startCol
    && col <= range.endCol;
}

export function isRowHeaderWithinSelection(
  sheet: SheetModel,
  selection: GridSelection | null,
  row: number,
  extent: SheetViewportExtent,
): boolean {
  if (!selection) {
    return false;
  }

  const range = getSelectionRange(sheet, selection, extent);
  return row >= range.startRow && row <= range.endRow;
}

export function isColumnHeaderWithinSelection(
  sheet: SheetModel,
  selection: GridSelection | null,
  col: number,
  extent: SheetViewportExtent,
): boolean {
  if (!selection) {
    return false;
  }

  const range = getSelectionRange(sheet, selection, extent);
  return col >= range.startCol && col <= range.endCol;
}

export function moveSelectionByKey(
  sheet: SheetModel,
  selection: GridSelection,
  extent: SheetViewportExtent,
  input: KeyboardNavigationInput,
): GridSelection | null {
  const firstVisibleRow = getFirstVisibleRow(sheet, extent);
  const firstVisibleCol = getFirstVisibleCol(sheet, extent);

  if (firstVisibleRow == null || firstVisibleCol == null) {
    return null;
  }

  if (selection.mode === "row" && isVerticalKey(input.key)) {
    const nextRow = findNextVisibleRow(
      sheet,
      selection.focus.row,
      directionForVerticalKey(input.key),
      Math.min(MAX_SHEET_ROW_INDEX, extent.endRow + 1),
    );
    const anchorRow = input.shiftKey ? selection.anchor.row : nextRow;
    return createRowSelection(sheet, nextRow, extent, anchorRow);
  }

  if (selection.mode === "column" && isHorizontalKey(input.key)) {
    const nextCol = findNextVisibleCol(
      sheet,
      selection.focus.col,
      directionForHorizontalKey(input.key),
      Math.min(MAX_SHEET_COL_INDEX, extent.endCol + 1),
    );
    const anchorCol = input.shiftKey ? selection.anchor.col : nextCol;
    return createColumnSelection(sheet, nextCol, extent, anchorCol);
  }

  const baseSelection =
    selection.mode === "cell"
      ? selection
      : createCellSelection(sheet, selection.focus, extent);
  const nextCoord = moveFocusCoord(sheet, baseSelection.focus, extent, input);

  if (!nextCoord) {
    return null;
  }

  const normalizedCoord = normalizeCoord(sheet, nextCoord, extent);

  if (input.shiftKey) {
    return {
      mode: "cell",
      anchor: baseSelection.anchor,
      focus: normalizedCoord,
    };
  }

  return {
    mode: "cell",
    anchor: normalizedCoord,
    focus: normalizedCoord,
  };
}

function moveFocusCoord(
  sheet: SheetModel,
  focus: CellAddress,
  extent: SheetViewportExtent,
  input: KeyboardNavigationInput,
): CellAddress | null {
  const rowStepLimit = Math.min(MAX_SHEET_ROW_INDEX, extent.endRow + 1);
  const colStepLimit = Math.min(MAX_SHEET_COL_INDEX, extent.endCol + 1);
  const firstVisibleRow = getFirstVisibleRow(sheet, extent) ?? 0;
  const lastVisibleRow = getLastVisibleRow(sheet, extent) ?? focus.row;
  const firstVisibleCol = getFirstVisibleCol(sheet, extent) ?? 0;
  const lastVisibleCol = getLastVisibleCol(sheet, extent) ?? focus.col;

  switch (input.key) {
    case "ArrowUp":
      return { ...focus, row: findNextVisibleRow(sheet, focus.row, -1, rowStepLimit) };
    case "ArrowDown":
      return { ...focus, row: findNextVisibleRow(sheet, focus.row, 1, rowStepLimit) };
    case "ArrowLeft":
      return { ...focus, col: findNextVisibleCol(sheet, focus.col, -1, colStepLimit) };
    case "ArrowRight":
      return { ...focus, col: findNextVisibleCol(sheet, focus.col, 1, colStepLimit) };
    case "Tab":
      return {
        ...focus,
        col: findNextVisibleCol(sheet, focus.col, input.shiftKey ? -1 : 1, colStepLimit),
      };
    case "Enter":
      return {
        ...focus,
        row: findNextVisibleRow(sheet, focus.row, input.shiftKey ? -1 : 1, rowStepLimit),
      };
    case "Home":
      return input.metaKey || input.ctrlKey
        ? { row: firstVisibleRow, col: firstVisibleCol }
        : { ...focus, col: firstVisibleCol };
    case "End":
      return input.metaKey || input.ctrlKey
        ? { row: lastVisibleRow, col: lastVisibleCol }
        : { ...focus, col: lastVisibleCol };
    default:
      return null;
  }
}

function normalizeCoord(
  sheet: SheetModel,
  coord: CellAddress,
  extent: SheetViewportExtent,
): CellAddress {
  const maxRow = Math.max(Math.min(MAX_SHEET_ROW_INDEX, coord.row), extent.endRow);
  const maxCol = Math.max(Math.min(MAX_SHEET_COL_INDEX, coord.col), extent.endCol);
  const row = findNearestVisibleRow(sheet, coord.row, maxRow);
  const col = findNearestVisibleCol(sheet, coord.col, maxCol);
  const resolvedAddress = resolveSelectionAddress(sheet, encodeAddress(col, row));

  return decodeCellAddress(resolvedAddress) ?? { row, col };
}

function getFallbackCoord(
  sheet: SheetModel,
  extent: SheetViewportExtent,
): CellAddress {
  return {
    row: getFirstVisibleRow(sheet, extent) ?? 0,
    col: getFirstVisibleCol(sheet, extent) ?? 0,
  };
}

function isVerticalKey(key: string): key is "ArrowUp" | "ArrowDown" {
  return key === "ArrowUp" || key === "ArrowDown";
}

function isHorizontalKey(key: string): key is "ArrowLeft" | "ArrowRight" {
  return key === "ArrowLeft" || key === "ArrowRight";
}

function directionForVerticalKey(key: "ArrowUp" | "ArrowDown"): -1 | 1 {
  return key === "ArrowUp" ? -1 : 1;
}

function directionForHorizontalKey(key: "ArrowLeft" | "ArrowRight"): -1 | 1 {
  return key === "ArrowLeft" ? -1 : 1;
}
