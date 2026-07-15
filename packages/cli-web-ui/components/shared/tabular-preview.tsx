import { useMemo, useRef } from "react";
import {
  flexRender,
  getCoreRowModel,
  type ColumnDef,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Table2 } from "lucide-react";

import { getPreviewSourceText, type FilePreviewData } from "../../lib/file-preview";
import { parseTabularPreview, type ParsedTabularRow } from "../../lib/tabular-preview";
import { detectSourceLanguage, formatSourceForDisplay } from "../../lib/source-view";
import { cn } from "../../lib/utils";
import { EmptyState } from "./empty-state";
import { AiCodeView } from "./ai-code-view";

const ROW_NUMBER_WIDTH_PX = 56;
const ROW_HEIGHT_PX = 36;
const ROW_OVERSCAN = 10;
const ROW_VIRTUALIZATION_THRESHOLD = 250;

interface TabularPreviewProps {
  preview: FilePreviewData;
}

export function TabularPreview({
  preview,
}: TabularPreviewProps) {
  const textSource = getPreviewSourceText(preview) ?? "";
  const sourceLanguage = detectSourceLanguage({
    path: preview.path,
    mimeType: preview.mime_type,
  });
  const parseResult = useMemo(
    () =>
      parseTabularPreview({
        path: preview.path,
        mimeType: preview.mime_type,
        raw: textSource,
      }),
    [preview.mime_type, preview.path, textSource],
  );

  if (!parseResult.ok) {
    return (
      <AiCodeView
        value={formatSourceForDisplay(textSource, {
          language: sourceLanguage,
          path: preview.path,
          mimeType: preview.mime_type,
          mode: "rendered",
        })}
        language={sourceLanguage}
        testId="preview-source-viewer"
        ariaLabel={`Rendered source preview for ${preview.path}`}
      />
    );
  }

  const { table } = parseResult;
  const metadata = (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
      data-testid="preview-table-metadata"
    >
      {[
        table.kindLabel,
        `${table.delimiterLabel} delimited`,
        `${table.rows.length} rows`,
        `${table.columns.length} columns`,
      ].map((item, index) => (
        <div key={item} className="inline-flex items-center gap-2">
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
  if (table.columns.length === 0) {
    return (
      <div className="grid gap-3" data-testid="preview-table">
        {metadata}
        <div className="rounded-md border border-dashed border-border/80 bg-muted/20 p-3">
          <EmptyState
            icon={Table2}
            message="No tabular rows to render."
            size="md"
          />
        </div>
      </div>
    );
  }

  const tableAriaLabel = `Rendered ${table.kindLabel} table preview for ${preview.path}`;
  const columnDefs = useMemo<ColumnDef<ParsedTabularRow>[]>(
    () => [
      {
        id: "__row_number",
        header: "#",
        cell: ({ row }) => row.index + 1,
        meta: {
          sticky: true,
          width: ROW_NUMBER_WIDTH_PX,
        },
      },
      ...table.columns.map(
        (column): ColumnDef<ParsedTabularRow> => ({
          id: column.id,
          accessorFn: (row) => row.values[column.sourceIndex] ?? "",
          header: column.label,
          meta: {
            width: column.width,
          },
        }),
      ),
    ],
    [table.columns],
  );
  const tableInstance = useReactTable({
    data: table.rows,
    columns: columnDefs,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
  });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowModel = tableInstance.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rowModel.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => rowModel[index]?.id ?? index,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: ROW_OVERSCAN,
  });
  const shouldVirtualizeRows =
    rowModel.length > ROW_VIRTUALIZATION_THRESHOLD;
  const virtualRows = shouldVirtualizeRows
    ? virtualizer.getVirtualItems()
    : rowModel.map((row, index) => ({
        key: row.id,
        index,
        start: index * ROW_HEIGHT_PX,
        end: (index + 1) * ROW_HEIGHT_PX,
      }));
  const topSpacerHeight = shouldVirtualizeRows ? (virtualRows[0]?.start ?? 0) : 0;
  const bottomSpacerHeight = shouldVirtualizeRows
    ? Math.max(0, virtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? 0))
    : 0;
  const gridTemplateColumns = [
    `${ROW_NUMBER_WIDTH_PX}px`,
    ...table.columns.map((column) => `${column.width}px`),
  ].join(" ");
  const tableWidth =
    ROW_NUMBER_WIDTH_PX +
    table.columns.reduce((total, column) => total + column.width, 0);

  return (
    <div
      className="grid gap-3"
      data-testid="preview-table"
      data-delimiter={table.delimiterLabel.toLowerCase()}
    >
      {metadata}
      <div
        ref={scrollRef}
        className="max-h-[28rem] min-h-0 overflow-auto rounded-md border border-border/80 bg-card/40 isolate [contain:paint]"
        data-testid="preview-table-scroll"
        role="region"
        aria-label={`${table.kindLabel} table preview scroll region`}
      >
        <div
          className="min-w-full"
          style={{ width: tableWidth }}
          role="table"
          aria-label={tableAriaLabel}
          aria-colcount={table.columns.length + 1}
          aria-rowcount={table.rows.length + 1}
          aria-readonly="true"
        >
          <div
            className="sticky top-0 z-20 border-b border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85"
            role="rowgroup"
          >
            {tableInstance.getHeaderGroups().map((headerGroup) => (
              <div
                key={headerGroup.id}
                className="grid"
                style={{ gridTemplateColumns }}
                role="row"
                aria-rowindex={1}
              >
                {headerGroup.headers.map((header, columnIndex) => {
                  const isSticky = header.column.id === "__row_number";
                  const value = header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      );
                  return (
                    <div
                      key={header.id}
                      className={cn(
                        "truncate border-r border-border/60 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground last:border-r-0",
                        isSticky && "sticky left-0 z-30 bg-muted/95 text-right",
                      )}
                      title={typeof value === "string" ? value : undefined}
                      role="columnheader"
                      aria-colindex={columnIndex + 1}
                    >
                      {value}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div role="rowgroup">
            {topSpacerHeight > 0 ? (
              <div aria-hidden="true" style={{ height: topSpacerHeight }} />
            ) : null}
            {virtualRows.map((virtualItem) => {
              const row = rowModel[virtualItem.index];
              if (!row) {
                return null;
              }
              const ariaRowIndex = row.index + 2;

              return (
                <div
                  key={row.id}
                  className={cn(
                    "grid border-b border-border/60 text-sm",
                    row.index % 2 === 0 ? "bg-background" : "bg-muted/15",
                  )}
                  style={{
                    gridTemplateColumns,
                    minHeight: ROW_HEIGHT_PX,
                  }}
                  role="row"
                  aria-rowindex={ariaRowIndex}
                >
                  {row.getVisibleCells().map((cell, columnIndex) => {
                    const isSticky = cell.column.id === "__row_number";
                    const value = flexRender(
                      cell.column.columnDef.cell,
                      cell.getContext(),
                    );
                    return (
                      <div
                        key={cell.id}
                        className={cn(
                          "border-r border-border/60 px-3 py-2 align-top last:border-r-0",
                          isSticky && "sticky left-0 z-10 bg-muted/90 text-right font-medium text-muted-foreground",
                        )}
                        title={typeof value === "string" ? value : undefined}
                        role={columnIndex === 0 ? "rowheader" : "cell"}
                        aria-colindex={columnIndex + 1}
                      >
                        <div className="whitespace-pre-wrap break-words">
                          {value}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {bottomSpacerHeight > 0 ? (
              <div aria-hidden="true" style={{ height: bottomSpacerHeight }} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
