import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  UIEvent as ReactUIEvent,
} from "react";
import {
  encodeAddress,
  encodeColumn,
} from "../../lib/spreadsheet-viewer-address";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createAllSelection,
  createCellSelection,
  createColumnSelection,
  createInitialSelection,
  createRowSelection,
  extendSelectionToCell,
  extendSelectionToColumn,
  extendSelectionToRow,
  getSelectionAddress,
  getSelectionRange,
  isCellWithinSelection,
  isColumnHeaderWithinSelection,
  isRowHeaderWithinSelection,
  moveSelectionByKey,
  type GridSelection,
} from "../../lib/spreadsheet-viewer-grid";
import {
  decodeCellAddress,
  expandSheetExtentToFitViewport,
  expandSheetExtentToIncludeCell,
  getBaseSheetExtent,
  getColumnWidth,
  getMergeSpan,
  getRenderedCell,
  getRowHeight,
  getSheetRowWindow,
  getSheetSelection,
  getVisibleColIndices,
  isCoveredByMerge,
  safeSheetName,
  type MergeSpan,
  type SheetViewportExtent,
  type SheetViewportMetrics,
  type WorkbookModel,
} from "../../lib/spreadsheet-viewer-model";

type DragSelectionMode = "cell" | "row" | "column";
type DimensionOverrides = Record<string, Record<number, number>>;
type ResizeSession = {
  axis: "column" | "row";
  index: number;
  sheetName: string;
  startPointer: number;
  startSize: number;
};
type PendingSelectionScroll = {
  sheetName: string;
  address: string;
};

type CellSelectionOutline = {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
};

const GRID_HEADER_HEIGHT = 20;
const GRID_ROW_HEADER_WIDTH = 40;
const MIN_COLUMN_WIDTH = 20;
const MIN_ROW_HEIGHT = 12;
const SCROLL_FOLLOW_TOLERANCE_PX = 1;
const EMPTY_DIMENSION_OVERRIDES: Record<number, number> = {};
const DEFAULT_VIEWPORT_METRICS: SheetViewportMetrics = {
  scrollLeft: 0,
  scrollTop: 0,
  clientWidth: 0,
  clientHeight: 0,
};
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function useEventCallback<T extends (...args: never[]) => unknown>(callback: T): T {
  const callbackRef = useRef(callback);

  useIsomorphicLayoutEffect(() => {
    callbackRef.current = callback;
  });

  return useMemo(
    () => ((...args: Parameters<T>) => callbackRef.current(...args)) as T,
    [],
  );
}

export interface SpreadsheetViewerProps {
  workbook: WorkbookModel;
}

function updateOverride(
  current: DimensionOverrides,
  sheetName: string,
  index: number,
  size: number,
): DimensionOverrides {
  return {
    ...current,
    [sheetName]: {
      ...(current[sheetName] ?? {}),
      [index]: size,
    },
  };
}

function createPendingSelectionScroll(
  sheet: WorkbookModel["sheets"][string] | null,
  sheetName: string,
  selection: GridSelection | null,
): PendingSelectionScroll | null {
  if (!sheet || !selection) {
    return null;
  }

  return {
    sheetName,
    address: getSelectionAddress(sheet, selection),
  };
}

function intersectsSelection(
  sheet: WorkbookModel["sheets"][string],
  row: number,
  col: number,
  merge: MergeSpan | null,
  selection: GridSelection | null,
  extent: SheetViewportExtent,
): boolean {
  if (!selection) {
    return false;
  }

  if (!merge) {
    return isCellWithinSelection(sheet, selection, row, col, extent);
  }

  for (let rowOffset = 0; rowOffset < merge.rowSpan; rowOffset += 1) {
    for (let colOffset = 0; colOffset < merge.colSpan; colOffset += 1) {
      if (
        isCellWithinSelection(
          sheet,
          selection,
          row + rowOffset,
          col + colOffset,
          extent,
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

export function SpreadsheetViewer({ workbook }: SpreadsheetViewerProps) {
  const [activeSheetName, setActiveSheetName] = useState(
    () => workbook.activeSheetName,
  );
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const [dragSelectionMode, setDragSelectionMode] = useState<DragSelectionMode | null>(null);
  const [columnWidthOverrides, setColumnWidthOverrides] = useState<DimensionOverrides>({});
  const [rowHeightOverrides, setRowHeightOverrides] = useState<DimensionOverrides>({});
  const [sheetExtents, setSheetExtents] = useState<Record<string, SheetViewportExtent>>({});
  const [resizeSession, setResizeSession] = useState<ResizeSession | null>(null);
  const [pendingSelectionScroll, setPendingSelectionScroll] = useState<PendingSelectionScroll | null>(null);
  const [viewportMetrics, setViewportMetrics] = useState<SheetViewportMetrics>(
    DEFAULT_VIEWPORT_METRICS,
  );
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const viewportAnimationFrameRef = useRef<number | null>(null);

  const activeSheet = useMemo(() => {
    if (!activeSheetName) {
      return null;
    }

    return workbook.sheets[activeSheetName] ?? null;
  }, [workbook, activeSheetName]);
  const activeSheetExtent = useMemo(() => {
    if (!activeSheet) {
      return null;
    }

    return sheetExtents[activeSheetName] ?? getBaseSheetExtent(activeSheet);
  }, [activeSheet, activeSheetName, sheetExtents]);

  const visibleCols = useMemo(
    () => (activeSheet && activeSheetExtent ? getVisibleColIndices(activeSheet, activeSheetExtent) : []),
    [activeSheet, activeSheetExtent],
  );

  const selectedCellAddress = useMemo(
    () => (activeSheet && selection ? getSelectionAddress(activeSheet, selection) : null),
    [activeSheet, selection],
  );

  const selectionInfo = useMemo(
    () => (activeSheet ? getSheetSelection(activeSheet, selectedCellAddress) : null),
    [activeSheet, selectedCellAddress],
  );
  const selectionRange = useMemo(
    () => (
      activeSheet && activeSheetExtent && selection
        ? getSelectionRange(activeSheet, selection, activeSheetExtent)
        : null
    ),
    [activeSheet, activeSheetExtent, selection],
  );

  const activeColumnOverrideMap =
    columnWidthOverrides[activeSheetName] ?? EMPTY_DIMENSION_OVERRIDES;
  const activeRowOverrideMap =
    rowHeightOverrides[activeSheetName] ?? EMPTY_DIMENSION_OVERRIDES;
  const frozenRowCount = Number.isFinite(activeSheet?.freezePanes.rowCount)
    ? Math.max(0, activeSheet?.freezePanes.rowCount ?? 0)
    : 0;
  const frozenColCount = Number.isFinite(activeSheet?.freezePanes.columnCount)
    ? Math.max(0, activeSheet?.freezePanes.columnCount ?? 0)
    : 0;

  function getDisplayColumnWidth(col: number): number {
    if (!activeSheet) {
      return MIN_COLUMN_WIDTH;
    }

    return activeColumnOverrideMap[col] ?? getColumnWidth(activeSheet, col);
  }

  function getDisplayRowHeight(row: number): number {
    if (!activeSheet) {
      return MIN_ROW_HEIGHT;
    }

    return activeRowOverrideMap[row] ?? getRowHeight(activeSheet, row);
  }

  const rowWindow = useMemo(
    () => (
      activeSheet && activeSheetExtent
        ? getSheetRowWindow(activeSheet, activeSheetExtent, viewportMetrics, {
            headerHeight: GRID_HEADER_HEIGHT,
            frozenRowCount,
            getRowHeight: getDisplayRowHeight,
          })
        : null
    ),
    [
      activeSheet,
      activeSheetExtent,
      viewportMetrics,
      frozenRowCount,
      activeRowOverrideMap,
    ],
  );

  const frozenRowOffsets = useMemo(() => {
    const offsets = new Map<number, number>();

    if (!activeSheet || frozenRowCount <= 0) {
      return offsets;
    }

    let top = GRID_HEADER_HEIGHT;

    for (const row of rowWindow?.frozenRows ?? []) {
      offsets.set(row, top);
      top += getDisplayRowHeight(row);
    }

    return offsets;
  }, [activeSheet, activeRowOverrideMap, frozenRowCount, rowWindow]);

  const frozenColOffsets = useMemo(() => {
    const offsets = new Map<number, number>();

    if (!activeSheet || frozenColCount <= 0) {
      return offsets;
    }

    let left = GRID_ROW_HEADER_WIDTH;

    for (const col of visibleCols) {
      if (col >= frozenColCount) {
        break;
      }

      offsets.set(col, left);
      left += getDisplayColumnWidth(col);
    }

    return offsets;
  }, [activeSheet, activeColumnOverrideMap, frozenColCount, visibleCols]);

  const frozenColumnsWidth = useMemo(() => {
    if (!activeSheet || frozenColCount <= 0) {
      return 0;
    }

    let total = 0;

    for (const col of visibleCols) {
      if (col >= frozenColCount) {
        break;
      }

      total += getDisplayColumnWidth(col);
    }

    return total;
  }, [activeSheet, activeColumnOverrideMap, frozenColCount, visibleCols]);

  const formulaBarText = selectionInfo?.formula || selectionInfo?.raw || "";
  const frozenVisibleRows = rowWindow?.frozenRows ?? [];
  const scrollableVisibleRows = rowWindow?.scrollableRows ?? [];

  const updateSelection = useEventCallback((
    nextSelection: GridSelection | null,
    options?: {
      scrollIntoView?: boolean;
    },
  ) => {
    setSelection(nextSelection);
    if (activeSheet && nextSelection) {
      const selectedCell = decodeCellAddress(getSelectionAddress(activeSheet, nextSelection));

      if (selectedCell) {
        setSheetExtents((current) => {
          const baseExtent = current[activeSheetName] ?? activeSheetExtent ?? getBaseSheetExtent(activeSheet);
          const nextExtent = expandSheetExtentToIncludeCell(baseExtent, selectedCell);

          if (
            nextExtent.endRow === baseExtent.endRow
            && nextExtent.endCol === baseExtent.endCol
          ) {
            return current;
          }

          return {
            ...current,
            [activeSheetName]: nextExtent,
          };
        });
      }
    }
    setPendingSelectionScroll(
      options?.scrollIntoView === false
        ? null
        : createPendingSelectionScroll(activeSheet, activeSheetName, nextSelection),
    );
  });

  const syncViewportMetrics = useEventCallback((container: HTMLDivElement | null) => {
    if (!container) {
      return;
    }

    setViewportMetrics((current) => {
      const nextMetrics = {
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
        clientWidth: container.clientWidth,
        clientHeight: container.clientHeight,
      };

      if (
        current.scrollLeft === nextMetrics.scrollLeft
        && current.scrollTop === nextMetrics.scrollTop
        && current.clientWidth === nextMetrics.clientWidth
        && current.clientHeight === nextMetrics.clientHeight
      ) {
        return current;
      }

      return nextMetrics;
    });
  });

  const syncExtentToViewport = useEventCallback((container: HTMLDivElement | null) => {
    if (!activeSheet || !container) {
      return;
    }

    syncViewportMetrics(container);
    setSheetExtents((current) => {
      const baseExtent = current[activeSheetName] ?? getBaseSheetExtent(activeSheet);
      const nextExtent = expandSheetExtentToFitViewport(
        baseExtent,
        {
          clientWidth: container.clientWidth,
          clientHeight: container.clientHeight,
          rowHeaderWidth: GRID_ROW_HEADER_WIDTH,
          columnHeaderHeight: GRID_HEADER_HEIGHT,
        },
        {
          getColumnWidth: (col) => getDisplayColumnWidth(col),
          getRowHeight: (row) => getDisplayRowHeight(row),
          isColumnHidden: (col) => activeSheet.hiddenCols.has(col),
          isRowHidden: (row) => activeSheet.hiddenRows.has(row),
        },
      );

      if (nextExtent.endRow === baseExtent.endRow && nextExtent.endCol === baseExtent.endCol) {
        return current;
      }

      return {
        ...current,
        [activeSheetName]: nextExtent,
      };
    });
  });

  const scheduleViewportSync = useEventCallback((container: HTMLDivElement | null) => {
    if (!container) {
      return;
    }

    if (viewportAnimationFrameRef.current != null) {
      window.cancelAnimationFrame(viewportAnimationFrameRef.current);
    }

    viewportAnimationFrameRef.current = window.requestAnimationFrame(() => {
      viewportAnimationFrameRef.current = null;
      syncExtentToViewport(container);
    });
  });

  useEffect(() => {
    setActiveSheetName(workbook.activeSheetName);
    setPendingSelectionScroll(null);
  }, [workbook]);

  useEffect(() => {
    if (!activeSheet || !activeSheetExtent) {
      updateSelection(null, {
        scrollIntoView: false,
      });
      return;
    }

    updateSelection(createInitialSelection(activeSheet, activeSheetExtent));
    setDragSelectionMode(null);
    setResizeSession(null);
  }, [workbook, activeSheetName]);

  useEffect(() => {
    setSheetExtents({});
    setViewportMetrics(DEFAULT_VIEWPORT_METRICS);
  }, [workbook]);

  useIsomorphicLayoutEffect(() => {
    scheduleViewportSync(gridScrollRef.current);
  }, [activeSheetName, workbook]);

  useEffect(() => {
    const container = gridScrollRef.current;

    if (!container || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      scheduleViewportSync(container);
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [activeSheetName, workbook]);

  useEffect(() => {
    return () => {
      if (viewportAnimationFrameRef.current != null) {
        window.cancelAnimationFrame(viewportAnimationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!dragSelectionMode) {
      return undefined;
    }

    function clearDragSelection() {
      setDragSelectionMode(null);
    }

    window.addEventListener("pointerup", clearDragSelection);
    window.addEventListener("pointercancel", clearDragSelection);

    return () => {
      window.removeEventListener("pointerup", clearDragSelection);
      window.removeEventListener("pointercancel", clearDragSelection);
    };
  }, [dragSelectionMode]);

  useEffect(() => {
    if (!resizeSession) {
      return undefined;
    }

    const session = resizeSession;

    function handlePointerMove(event: PointerEvent) {
      const delta = session.axis === "column"
        ? event.clientX - session.startPointer
        : event.clientY - session.startPointer;
      const nextSize = Math.max(
        session.axis === "column" ? MIN_COLUMN_WIDTH : MIN_ROW_HEIGHT,
        Math.round(session.startSize + delta),
      );

      if (session.axis === "column") {
        setColumnWidthOverrides((current) =>
          updateOverride(current, session.sheetName, session.index, nextSize),
        );
        return;
      }

      setRowHeightOverrides((current) =>
        updateOverride(current, session.sheetName, session.index, nextSize),
      );
    }

    function handlePointerUp() {
      setResizeSession(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [resizeSession]);

  useEffect(() => {
    if (
      !pendingSelectionScroll
      || pendingSelectionScroll.sheetName !== activeSheetName
      || !activeSheet
      || !activeSheetExtent
    ) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      const container = gridScrollRef.current;
      
      if (container) {
        scrollAddressIntoView(
          container,
          activeSheet,
          pendingSelectionScroll.address,
          getDisplayColumnWidth,
          getDisplayRowHeight,
          rowWindow?.frozenRowsHeight ?? 0,
          frozenColumnsWidth,
        );
        setPendingSelectionScroll((current) =>
          current
            && current.sheetName === pendingSelectionScroll.sheetName
            && current.address === pendingSelectionScroll.address
            ? null
            : current,
        );
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [pendingSelectionScroll, activeSheetExtent, activeSheetName, activeSheet, rowWindow, frozenColumnsWidth]);

  function focusGrid() {
    gridScrollRef.current?.focus({
      preventScroll: true,
    });
  }

  function ensureSelection(): GridSelection | null {
    if (!activeSheet || !activeSheetExtent) {
      return null;
    }

    return selection ?? createInitialSelection(activeSheet, activeSheetExtent);
  }

  function handleGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!activeSheet || !activeSheetExtent) {
      return;
    }

    const baseSelection = ensureSelection();

    if (!baseSelection) {
      return;
    }

    const nextSelection = moveSelectionByKey(
      activeSheet,
      baseSelection,
      activeSheetExtent,
      {
        key: event.key,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
      },
    );

    if (!nextSelection) {
      return;
    }

    event.preventDefault();
    updateSelection(nextSelection);
  }

  function handleCellPointerDown(
    address: string,
    event: ReactPointerEvent<HTMLTableCellElement>,
  ) {
    if (!activeSheet || event.button !== 0) {
      return;
    }

    event.preventDefault();
    focusGrid();

    const coord = decodeCellAddress(address);

    if (!coord) {
      return;
    }

    updateSelection(
      createCellSelection(activeSheet, coord, activeSheetExtent ?? getBaseSheetExtent(activeSheet)),
    );
    setDragSelectionMode("cell");
  }

  function handleCellPointerEnter(address: string) {
    if (!activeSheet || !activeSheetExtent || dragSelectionMode !== "cell") {
      return;
    }

    const coord = decodeCellAddress(address);

    if (!coord) {
      return;
    }

    updateSelection(
      selection
        ? extendSelectionToCell(activeSheet, selection, coord, activeSheetExtent)
        : selection,
      {
        scrollIntoView: false,
      },
    );
  }

  function handleRowHeaderPointerDown(
    row: number,
    event: ReactPointerEvent<HTMLTableCellElement>,
  ) {
    if (!activeSheet || event.button !== 0) {
      return;
    }

    event.preventDefault();
    focusGrid();
    updateSelection(
      createRowSelection(activeSheet, row, activeSheetExtent ?? getBaseSheetExtent(activeSheet)),
    );
    setDragSelectionMode("row");
  }

  function handleRowHeaderPointerEnter(row: number) {
    if (!activeSheet || !activeSheetExtent || dragSelectionMode !== "row") {
      return;
    }

    updateSelection(
      selection
        ? extendSelectionToRow(activeSheet, selection, row, activeSheetExtent)
        : selection,
      {
        scrollIntoView: false,
      },
    );
  }

  function handleColumnHeaderPointerDown(
    col: number,
    event: ReactPointerEvent<HTMLTableCellElement>,
  ) {
    if (!activeSheet || event.button !== 0) {
      return;
    }

    event.preventDefault();
    focusGrid();
    updateSelection(
      createColumnSelection(activeSheet, col, activeSheetExtent ?? getBaseSheetExtent(activeSheet)),
    );
    setDragSelectionMode("column");
  }

  function handleColumnHeaderPointerEnter(col: number) {
    if (!activeSheet || !activeSheetExtent || dragSelectionMode !== "column") {
      return;
    }

    updateSelection(
      selection
        ? extendSelectionToColumn(activeSheet, selection, col, activeSheetExtent)
        : selection,
      {
        scrollIntoView: false,
      },
    );
  }

  function handleCornerPointerDown(event: ReactPointerEvent<HTMLTableCellElement>) {
    if (!activeSheet || event.button !== 0) {
      return;
    }

    event.preventDefault();
    focusGrid();
    const nextSelection = createAllSelection(
      activeSheet,
      activeSheetExtent ?? getBaseSheetExtent(activeSheet),
    );

    if (nextSelection) {
      updateSelection(nextSelection);
    }
  }

  function beginResize(
    axis: ResizeSession["axis"],
    index: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (!activeSheetName) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    focusGrid();

    setResizeSession({
      axis,
      index,
      sheetName: activeSheetName,
      startPointer: axis === "column" ? event.clientX : event.clientY,
      startSize: axis === "column" ? getDisplayColumnWidth(index) : getDisplayRowHeight(index),
    });
  }

  function handleGridScroll(event: ReactUIEvent<HTMLDivElement>) {
    scheduleViewportSync(event.currentTarget);
  }

  function renderSheetRow(row: number) {
    return (
      <tr key={row} style={{ height: getDisplayRowHeight(row) }}>
        <th
          className={
            activeSheetExtent && isRowHeaderWithinSelection(activeSheet!, selection, row, activeSheetExtent)
              ? "spreadsheet-row-header active spreadsheet-selection-fill"
              : "spreadsheet-row-header"
          }
          style={buildRowHeaderStyle(frozenRowOffsets.get(row))}
          data-testid={`row-header-${row + 1}`}
          onPointerDown={(event) => {
            handleRowHeaderPointerDown(row, event);
          }}
          onPointerEnter={() => {
            handleRowHeaderPointerEnter(row);
          }}
        >
          <span className="spreadsheet-header-label">{row + 1}</span>
          <button
            type="button"
            className="spreadsheet-row-resize-handle"
            data-testid={`row-resize-${row + 1}`}
            tabIndex={-1}
            aria-label={`Resize row ${row + 1}`}
            onPointerDown={(event) => {
              beginResize("row", row, event);
            }}
          />
        </th>
        {visibleCols.map((col) => {
          const address = encodeAddress(col, row);

          if (isCoveredByMerge(activeSheet!, address)) {
            return null;
          }

          const merge = getMergeSpan(activeSheet!, address);
          const renderedCell = getRenderedCell(activeSheet!, address);
          const selected = address === selectedCellAddress;
          const selectionFill = intersectsSelection(
            activeSheet!,
            row,
            col,
            merge,
            selection,
            activeSheetExtent ?? getBaseSheetExtent(activeSheet!),
          );
          const selectionOutline = getSelectionOutline(
            row,
            col,
            merge,
            selectionRange,
          );
          const style = buildCellStyle(
            renderedCell?.style,
            buildFrozenCellStyle(
              frozenRowOffsets.get(row),
              frozenColOffsets.get(col),
            ),
          );

          return (
            <td
              key={address}
              id={`gridcell-${address}`}
              className={buildCellClassName(selected, selectionFill, selectionOutline)}
              role="gridcell"
              aria-label={address}
              aria-selected={selected}
              data-testid={`cell-${address}`}
              data-cell-address={address}
              colSpan={merge?.colSpan}
              rowSpan={merge?.rowSpan}
              style={style}
              onPointerDown={(event) => {
                handleCellPointerDown(address, event);
              }}
              onPointerEnter={() => {
                handleCellPointerEnter(address);
              }}
            >
              <div className="spreadsheet-cell-content">
                {renderedCell?.text || "\u00a0"}
              </div>
            </td>
          );
        })}
      </tr>
    );
  }

  if (!activeSheet) {
    return (
      <main className="spreadsheet-viewer-shell">
        <section className="spreadsheet-viewer-message">
          This workbook does not contain a visible sheet to render.
        </section>
      </main>
    );
  }

  return (
    <main className="spreadsheet-viewer-shell" data-testid="spreadsheet-viewer">
      <header className="spreadsheet-formula-bar">
        <div className="spreadsheet-name-box" data-testid="selection-address">
          {selectionInfo?.address ?? ""}
        </div>
        <div className="spreadsheet-formula-sigil" aria-hidden="true">
          fx
        </div>
        <div
          className={
            formulaBarText
              ? "spreadsheet-formula-copy"
              : "spreadsheet-formula-copy spreadsheet-formula-copy-empty"
          }
          data-testid="formula-bar"
        >
          {formulaBarText}
        </div>
      </header>

      <section className="spreadsheet-grid-viewport">
        <div
          ref={gridScrollRef}
          className="spreadsheet-grid-scroll"
          data-testid="sheet-grid-wrap"
          tabIndex={0}
          onFocus={() => {
            if (!selection) {
              updateSelection(
                createInitialSelection(
                  activeSheet,
                  activeSheetExtent ?? getBaseSheetExtent(activeSheet),
                ),
              );
            }
          }}
          onScroll={handleGridScroll}
          onKeyDown={handleGridKeyDown}
        >
          <table
            className={
              activeSheet.showGridLines
                ? "spreadsheet-grid"
                : "spreadsheet-grid spreadsheet-grid-no-grid-lines"
            }
            data-testid="sheet-grid"
            role="grid"
          >
            <colgroup>
              <col style={{ width: GRID_ROW_HEADER_WIDTH }} />
              {visibleCols.map((col) => (
                <col key={col} style={{ width: getDisplayColumnWidth(col) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                  <th
                    className={
                      selection?.mode === "all"
                      ? "spreadsheet-corner-cell spreadsheet-selection-fill"
                      : "spreadsheet-corner-cell"
                    }
                    data-testid="corner-cell"
                    onPointerDown={handleCornerPointerDown}
                />
                {visibleCols.map((col) => (
                  <th
                    key={col}
                    className={
                      activeSheetExtent && isColumnHeaderWithinSelection(activeSheet, selection, col, activeSheetExtent)
                        ? "spreadsheet-col-header active spreadsheet-selection-fill"
                        : "spreadsheet-col-header"
                    }
                    style={buildColumnHeaderStyle(frozenColOffsets.get(col))}
                    data-testid={`col-header-${encodeColumn(col).toLowerCase()}`}
                    onPointerDown={(event) => {
                      handleColumnHeaderPointerDown(col, event);
                    }}
                    onPointerEnter={() => {
                      handleColumnHeaderPointerEnter(col);
                    }}
                  >
                    <span className="spreadsheet-header-label">{encodeColumn(col)}</span>
                    <button
                      type="button"
                      className="spreadsheet-col-resize-handle"
                      data-testid={`col-resize-${encodeColumn(col).toLowerCase()}`}
                      tabIndex={-1}
                      aria-label={`Resize column ${encodeColumn(col)}`}
                      onPointerDown={(event) => {
                        beginResize("column", col, event);
                      }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {frozenVisibleRows.map((row) => renderSheetRow(row))}
              {rowWindow && rowWindow.topSpacerHeight > 0 ? (
                <tr aria-hidden="true" data-testid="row-window-top-spacer">
                  <th className="spreadsheet-row-header spreadsheet-spacer-cell" />
                  <td
                    className="spreadsheet-spacer-cell"
                    colSpan={visibleCols.length}
                    style={{ height: rowWindow.topSpacerHeight }}
                  />
                </tr>
              ) : null}
              {scrollableVisibleRows.map((row) => renderSheetRow(row))}
              {rowWindow && rowWindow.bottomSpacerHeight > 0 ? (
                <tr aria-hidden="true" data-testid="row-window-bottom-spacer">
                  <th className="spreadsheet-row-header spreadsheet-spacer-cell" />
                  <td
                    className="spreadsheet-spacer-cell"
                    colSpan={visibleCols.length}
                    style={{ height: rowWindow.bottomSpacerHeight }}
                  />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="spreadsheet-sheet-tabs" data-testid="sheet-list">
        {Object.keys(workbook.sheets).map((sheetName) => (
          <button
            key={sheetName}
            type="button"
            className={
              sheetName === activeSheetName
                ? "spreadsheet-sheet-tab active"
                : "spreadsheet-sheet-tab"
            }
            data-testid={`sheet-tab-${safeSheetName(sheetName)}`}
            onClick={() => {
              setPendingSelectionScroll(null);
              setActiveSheetName(sheetName);
            }}
          >
            {sheetName}
          </button>
        ))}
      </footer>
    </main>
  );
}

function buildCellClassName(
  selected: boolean,
  selectionFill: boolean,
  selectionOutline: CellSelectionOutline,
): string {
  const classNames = ["spreadsheet-cell"];

  if (selected) {
    classNames.push("selected");
  }

  if (selectionFill) {
    classNames.push("spreadsheet-selection-fill");
  }

  if (selectionOutline.top || selectionOutline.right || selectionOutline.bottom || selectionOutline.left) {
    classNames.push("spreadsheet-selection-outline");
  }

  if (selectionOutline.top) {
    classNames.push("spreadsheet-selection-top");
  }

  if (selectionOutline.right) {
    classNames.push("spreadsheet-selection-right");
  }

  if (selectionOutline.bottom) {
    classNames.push("spreadsheet-selection-bottom");
  }

  if (selectionOutline.left) {
    classNames.push("spreadsheet-selection-left");
  }

  return classNames.join(" ");
}

function buildCellStyle(
  renderedStyle: CSSProperties | undefined,
  frozenStyle: CSSProperties,
): CSSProperties {
  const effectiveStyle = renderedStyle && Object.keys(renderedStyle).length > 0
    ? renderedStyle
    : {};

  return {
    ...effectiveStyle,
    ...frozenStyle,
    ...(frozenStyle.position === "sticky" && !effectiveStyle.backgroundColor
      ? { backgroundColor: "#fff" }
      : {}),
  };
}

function buildColumnHeaderStyle(left: number | undefined): CSSProperties | undefined {
  if (left == null) {
    return undefined;
  }

  return {
    left,
    zIndex: 5,
  };
}

function buildRowHeaderStyle(top: number | undefined): CSSProperties | undefined {
  if (top == null) {
    return undefined;
  }

  return {
    top,
    zIndex: 4,
  };
}

function buildFrozenCellStyle(
  top: number | undefined,
  left: number | undefined,
): CSSProperties {
  const hasTop = Number.isFinite(top);
  const hasLeft = Number.isFinite(left);

  if (!hasTop && !hasLeft) {
    return {};
  }

  return {
    position: "sticky",
    top: hasTop ? top : undefined,
    left: hasLeft ? left : undefined,
    zIndex: hasTop && hasLeft ? 3 : 2,
  };
}

function getSelectionOutline(
  row: number,
  col: number,
  merge: MergeSpan | null,
  selectionRange: ReturnType<typeof getSelectionRange> | null,
): CellSelectionOutline {
  if (!selectionRange) {
    return {
      top: false,
      right: false,
      bottom: false,
      left: false,
    };
  }

  const startRow = row;
  const endRow = row + (merge?.rowSpan ?? 1) - 1;
  const startCol = col;
  const endCol = col + (merge?.colSpan ?? 1) - 1;
  const overlapsRows = startRow <= selectionRange.endRow && endRow >= selectionRange.startRow;
  const overlapsCols = startCol <= selectionRange.endCol && endCol >= selectionRange.startCol;

  if (!overlapsRows || !overlapsCols) {
    return {
      top: false,
      right: false,
      bottom: false,
      left: false,
    };
  }

  return {
    top:
      startRow <= selectionRange.startRow
      && endRow >= selectionRange.startRow
      && overlapsCols,
    right:
      startCol <= selectionRange.endCol
      && endCol >= selectionRange.endCol
      && overlapsRows,
    bottom:
      startRow <= selectionRange.endRow
      && endRow >= selectionRange.endRow
      && overlapsCols,
    left:
      startCol <= selectionRange.startCol
      && endCol >= selectionRange.startCol
      && overlapsRows,
  };
}

function scrollAddressIntoView(
  container: HTMLDivElement,
  sheet: WorkbookModel["sheets"][string],
  address: string,
  getColumnWidth: (col: number) => number,
  getRowHeight: (row: number) => number,
  frozenRowsHeight: number,
  frozenColumnsWidth: number,
): void {
  const targetCell = decodeCellAddress(address);

  if (!targetCell) {
    return;
  }

  const merge = getMergeSpan(sheet, address);
  const targetTop = measureAxisOffset(sheet.hiddenRows, targetCell.row, getRowHeight);
  const targetBottom = targetTop + measureAxisSpan(
    sheet.hiddenRows,
    targetCell.row,
    merge?.rowSpan ?? 1,
    getRowHeight,
  );
  const targetLeft = measureAxisOffset(sheet.hiddenCols, targetCell.col, getColumnWidth);
  const targetRight = targetLeft + measureAxisSpan(
    sheet.hiddenCols,
    targetCell.col,
    merge?.colSpan ?? 1,
    getColumnWidth,
  );
  const insetTop = container.scrollTop + GRID_HEADER_HEIGHT + frozenRowsHeight + 8;
  const insetBottom = container.scrollTop + container.clientHeight - 8;
  const insetLeft = container.scrollLeft + GRID_ROW_HEADER_WIDTH + frozenColumnsWidth + 8;
  const insetRight = container.scrollLeft + container.clientWidth - 8;
  const nextScrollTop = adjustScrollAxisIntoView(
    container.scrollTop,
    targetTop,
    targetBottom,
    insetTop,
    insetBottom,
  );
  const nextScrollLeft = adjustScrollAxisIntoView(
    container.scrollLeft,
    targetLeft,
    targetRight,
    insetLeft,
    insetRight,
  );

  if (nextScrollTop !== container.scrollTop || nextScrollLeft !== container.scrollLeft) {
    container.scrollTo({
      top: Math.max(0, nextScrollTop),
      left: Math.max(0, nextScrollLeft),
    });
  }
}

function measureAxisOffset(
  hiddenIndices: Set<number>,
  endExclusive: number,
  getSize: (index: number) => number,
): number {
  let total = 0;

  for (let index = 0; index < endExclusive; index += 1) {
    if (hiddenIndices.has(index)) {
      continue;
    }

    total += Math.max(0, getSize(index));
  }

  return total;
}

function measureAxisSpan(
  hiddenIndices: Set<number>,
  startInclusive: number,
  count: number,
  getSize: (index: number) => number,
): number {
  let total = 0;
  const endExclusive = startInclusive + count;

  for (let index = startInclusive; index < endExclusive; index += 1) {
    if (hiddenIndices.has(index)) {
      continue;
    }

    total += Math.max(0, getSize(index));
  }

  return total;
}

function adjustScrollAxisIntoView(
  currentScroll: number,
  targetStart: number,
  targetEnd: number,
  insetStart: number,
  insetEnd: number,
): number {
  if (targetStart < insetStart - SCROLL_FOLLOW_TOLERANCE_PX) {
    return currentScroll - (insetStart - targetStart);
  }

  if (targetEnd > insetEnd + SCROLL_FOLLOW_TOLERANCE_PX) {
    return currentScroll + (targetEnd - insetEnd);
  }

  return currentScroll;
}
