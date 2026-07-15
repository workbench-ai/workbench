import { startTransition, useEffect, useState } from "react";

import type { FilePreviewData } from "../../lib/file-preview";
import {
  SpreadsheetViewer,
  parseSpreadsheetViewerWorkbook,
} from "../../spreadsheet-viewer";
import { PreviewRendererLoadingState } from "./preview-loading-state";

type SpreadsheetFilePreviewProps = {
  preview: FilePreviewData;
};

type ParsedSpreadsheetWorkbook = Awaited<
  ReturnType<typeof parseSpreadsheetViewerWorkbook>
>;

type SpreadsheetPreviewState =
  | { status: "loading" }
  | { status: "ready"; workbook: ParsedSpreadsheetWorkbook }
  | { status: "error"; message: string };

const workbookPreviewCache = new Map<string, ParsedSpreadsheetWorkbook>();

export function SpreadsheetFilePreview({
  preview,
}: SpreadsheetFilePreviewProps) {
  const [state, setState] = useState<SpreadsheetPreviewState>({
    status: "loading",
  });

  useEffect(() => {
    if (preview.source?.encoding !== "base64") {
      setState({
        status: "error",
        message: "Spreadsheet previews require an encoded workbook payload.",
      });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    let bytes: Uint8Array;
    try {
      bytes = decodeBase64ToBytes(preview.source.content);
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to decode spreadsheet payload.",
      });
      return;
    }

    void getCachedWorkbookPreview(preview.path, bytes)
      .then((workbook) => {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setState({
            status: "ready",
            workbook,
          });
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setState({
          status: "error",
          message:
            error instanceof Error ? error.message : "Failed to open spreadsheet preview.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [preview.path, preview.source]);

  if (state.status === "error") {
    return (
      <div
        className="rounded-md border border-dashed border-border/80 bg-muted/20 p-4 text-sm text-muted-foreground"
        data-testid="preview-spreadsheet-error"
      >
        {state.message}
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <PreviewRendererLoadingState
        label="Opening spreadsheet preview..."
        testId="preview-spreadsheet-loading"
      />
    );
  }

  return (
    <div
      className="flex h-[min(36rem,70vh)] min-h-0 overflow-hidden"
      data-testid="preview-spreadsheet"
    >
      <SpreadsheetViewer workbook={state.workbook} />
    </div>
  );
}

async function getCachedWorkbookPreview(
  path: string,
  bytes: Uint8Array,
): Promise<ParsedSpreadsheetWorkbook> {
  const cacheKey = await createWorkbookPreviewCacheKey(path, bytes);
  let workbook = workbookPreviewCache.get(cacheKey);

  if (!workbook) {
    workbook = parseSpreadsheetViewerWorkbook(toArrayBuffer(bytes));
    workbookPreviewCache.set(cacheKey, workbook);
  }

  return workbook;
}

async function createWorkbookPreviewCacheKey(
  path: string,
  bytes: Uint8Array,
): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
    return `${path}:${bytesToHex(new Uint8Array(digest))}`;
  }

  return `${path}:${bytes.byteLength}:${bytes[0] ?? 0}:${bytes[bytes.length - 1] ?? 0}`;
}

function bytesToHex(bytes: Uint8Array): string {
  let value = "";

  for (const byte of bytes) {
    value += byte.toString(16).padStart(2, "0");
  }

  return value;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const normalized = base64.replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
