import { startTransition, useEffect, useState } from "react";

import type { FilePreviewData } from "../../lib/file-preview";
import {
  SpreadsheetViewer,
  parseSpreadsheetViewerWorkbook,
} from "../../spreadsheet-viewer";
import { PreviewRendererLoadingState } from "./preview-loading-state";

type SpreadsheetFilePreviewProps = {
  preview: FilePreviewData;
  fillHeight?: boolean;
};

type ParsedSpreadsheetWorkbook = Awaited<
  ReturnType<typeof parseSpreadsheetViewerWorkbook>
>;

type SpreadsheetPreviewState =
  | { status: "loading" }
  | { status: "ready"; workbookFile: ParsedSpreadsheetWorkbook }
  | { status: "error"; message: string };

const workbookPreviewCache = new Map<string, Promise<ParsedSpreadsheetWorkbook>>();

export function clearSpreadsheetFilePreviewCache(): void {
  workbookPreviewCache.clear();
}

export function SpreadsheetFilePreview({
  preview,
  fillHeight = false,
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

    const fileName =
      preview.path.split("/").filter(Boolean).at(-1) ?? preview.path;
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

    void getCachedWorkbookPreview(preview.path, fileName, bytes)
      .then((workbookFile) => {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setState({
            status: "ready",
            workbookFile,
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
      className={fillHeight ? "flex h-full min-h-0 flex-1 overflow-hidden" : undefined}
      data-testid="preview-spreadsheet"
    >
      <SpreadsheetViewer workbookFile={state.workbookFile} />
    </div>
  );
}

async function getCachedWorkbookPreview(
  path: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<ParsedSpreadsheetWorkbook> {
  const cacheKey = await createWorkbookPreviewCacheKey(path, bytes);
  let workbookPromise = workbookPreviewCache.get(cacheKey);

  if (!workbookPromise) {
    const byteBuffer = toArrayBuffer(bytes);
    workbookPromise = parseSpreadsheetViewerWorkbook(
      {
        name: fileName,
        size: bytes.byteLength,
      },
      byteBuffer,
      {
        source: path,
      },
    ).catch((error) => {
      workbookPreviewCache.delete(cacheKey);
      throw error;
    });
    workbookPreviewCache.set(cacheKey, workbookPromise);
  }

  return workbookPromise;
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
