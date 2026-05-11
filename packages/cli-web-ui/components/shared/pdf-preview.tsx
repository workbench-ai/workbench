import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Maximize2 } from "lucide-react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";

import { cn } from "../../lib/utils";
import { Spinner } from "../ui/spinner";

// Keep the API and worker on the same installed pdfjs-dist version.
const PDFJS_WORKER_SRC = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;

interface PdfPreviewProps {
  base64: string;
  filePath: string;
  className?: string;
  expanded?: boolean;
  onExpand?: () => void;
}

export function PdfPreview({
  base64,
  filePath,
  className,
  expanded = false,
  onExpand,
}: PdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const bytes = useMemo(() => decodeBase64(base64), [base64]);
  const testIdBase = expanded ? "expanded-pdf-preview" : "pdf-preview";

  useEffect(() => {
    const container = containerRef.current;
    const pages = pagesRef.current;
    if (!container || !pages) {
      return;
    }

    let cancelled = false;
    const loadingTask = getDocument({ data: bytes });
    const renderTasks: Array<{
      cancel?: () => void;
      promise: Promise<unknown>;
    }> = [];

    setStatus("loading");
    setErrorMessage(null);
    setPageCount(null);
    pages.replaceChildren();

    void loadingTask.promise
      .then(async (pdf) => {
        if (cancelled) {
          await pdf.destroy();
          return;
        }

        const totalPages = pdf.numPages;
        const visiblePages = expanded ? totalPages : 1;
        const containerWidth = Math.max(
          container.clientWidth - (expanded ? 32 : 24),
          1,
        );
        setPageCount(totalPages);

        for (let pageNumber = 1; pageNumber <= visiblePages; pageNumber += 1) {
          if (expanded && pageNumber > 1) {
            await waitForNextFrame();
            if (cancelled) {
              await pdf.destroy();
              return;
            }
          }

          const page = await pdf.getPage(pageNumber);
          if (cancelled) {
            await pdf.destroy();
            return;
          }

          const unscaledViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(containerWidth / unscaledViewport.width, 2);
          const viewport = page.getViewport({ scale });

          const pageContainer = document.createElement("div");
          pageContainer.className = "grid";
          pageContainer.setAttribute(
            "data-testid",
            expanded ? "expanded-pdf-preview-page" : "pdf-preview-page",
          );

          const canvas = document.createElement("canvas");
          canvas.className = expanded
            ? "mx-auto block h-auto max-w-full"
            : "mx-auto block h-auto max-w-full rounded-sm border border-border/70 shadow-sm";
          canvas.setAttribute(
            "data-testid",
            expanded ? "expanded-pdf-preview-canvas" : "pdf-preview-canvas",
          );
          canvas.setAttribute(
            "aria-label",
            `${expanded ? "Expanded" : "Rendered"} PDF page ${pageNumber} for ${filePath}`,
          );

          const context = canvas.getContext("2d");
          if (!context) {
            throw new Error("Canvas rendering is unavailable in this browser.");
          }

          const devicePixelRatio = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * devicePixelRatio);
          canvas.height = Math.floor(viewport.height * devicePixelRatio);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;

          pageContainer.append(canvas);
          pages.append(pageContainer);

          const renderTask = page.render({
            canvas,
            canvasContext: context,
            viewport,
            transform:
              devicePixelRatio === 1
                ? undefined
                : [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0],
          });
          renderTasks.push(renderTask);
          await renderTask.promise;
        }

        if (!cancelled) {
          setStatus("ready");
        }
        await pdf.destroy();
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setStatus("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to render this PDF preview.",
        );
      });

    return () => {
      cancelled = true;
      renderTasks.forEach((renderTask) => {
        renderTask.cancel?.();
      });
      loadingTask.destroy();
      pages.replaceChildren();
    };
  }, [bytes, expanded, filePath]);

  const showsStatus = !expanded || status !== "ready";
  const statusLabel = pageCount
    ? `Page 1 of ${pageCount} · ${filePath}`
    : `Showing the first page of ${filePath}`;

  const pagesSurface = (
    <div
      ref={containerRef}
      className={cn(
        expanded
          ? "min-h-0 flex-1 overflow-y-auto bg-transparent"
          : "overflow-auto rounded-md border border-border/70 bg-muted/20 p-3",
      )}
      data-testid={expanded ? "expanded-pdf-preview-scroll-region" : undefined}
    >
      <div
        ref={pagesRef}
        className={cn(
          "mx-auto grid w-full",
          expanded ? "max-w-4xl gap-6 px-2 pb-6" : "gap-4",
        )}
      />
    </div>
  );

  return (
    <div
      className={cn(
        "grid gap-3",
        expanded ? "h-full min-h-0" : null,
        expanded && !showsStatus ? "gap-0" : null,
        className,
      )}
      data-testid={testIdBase}
      data-preview-status={status}
    >
      {showsStatus ? (
        <div
          className={cn(
            "text-sm text-muted-foreground",
            expanded
              ? "px-1"
              : "rounded-md border border-border/70 bg-muted/20 p-3",
          )}
        >
          {status === "loading" ? (
            <span className="inline-flex items-center gap-2">
              <Spinner />
              Rendering PDF preview...
            </span>
          ) : status === "error" ? (
            <span className="inline-flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              {errorMessage ?? "Unable to render this PDF preview."}
            </span>
          ) : (
            statusLabel
          )}
        </div>
      ) : null}
      {expanded || !onExpand ? (
        pagesSurface
      ) : (
        <button
          type="button"
          className="block cursor-zoom-in rounded-md text-left"
          onClick={onExpand}
          aria-label={`Expand rendered PDF preview for ${filePath}`}
          data-testid="pdf-preview-trigger"
          title="Click to expand"
        >
          <div className="relative">
            {pagesSurface}
            <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/95 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm backdrop-blur">
              <Maximize2 className="h-3.5 w-3.5" />
              Expand
            </span>
          </div>
        </button>
      )}
    </div>
  );
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function decodeBase64(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
