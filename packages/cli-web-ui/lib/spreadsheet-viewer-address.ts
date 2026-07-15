export type CellAddress = {
  col: number;
  row: number;
};

export type GridRange = {
  startCol: number;
  endCol: number;
  startRow: number;
  endRow: number;
};

export function decodeAddress(address: string): CellAddress {
  const match = address.match(/^([A-Z]+)(\d+)$/i);
  if (!match) {
    return { col: 0, row: 0 };
  }
  return {
    col: decodeColumn(match[1] ?? "A"),
    row: Math.max(0, Number.parseInt(match[2] ?? "1", 10) - 1),
  };
}

export function encodeAddress(col: number, row: number): string {
  return `${encodeColumn(col)}${row + 1}`;
}

export function encodeColumn(col: number): string {
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

export function decodeRangeAddress(address: string | null | undefined): GridRange | null {
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

export function mergeGridRanges(left: GridRange | null, right: GridRange | null): GridRange | null {
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
