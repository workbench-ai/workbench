import type { ReactNode } from "react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { FileQuestion, Maximize2 } from "lucide-react";

import type { FilePreviewData, PreviewKind } from "../../lib/file-preview";
import {
  getPreviewSourceBase64,
  getPreviewSourceText,
} from "../../lib/file-preview";
import { detectSourceLanguage, formatSourceForDisplay } from "../../lib/source-view";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { AiCodeView } from "./ai-code-view";
import { CodeBlockSurface } from "./code-block-surface";
import { EmptyState } from "./empty-state";
import { MarkdownDocumentView } from "./markdown-document-view";
import { PreviewRendererLoadingState } from "./preview-loading-state";
import { SpreadsheetFilePreview } from "./spreadsheet-file-preview";
import { TabularPreview } from "./tabular-preview";

const PdfPreview = lazy(() =>
  import("./pdf-preview").then((module) => ({
    default: module.PdfPreview,
  })),
);

interface PreviewPanelProps {
  preview: FilePreviewData;
  fillHeight?: boolean;
}

type ExpandedRenderedPreviewKind = "image" | "pdf";

type RenderedPreviewContext = {
  preview: FilePreviewData;
  fillHeight: boolean;
  sanitizedRenderedHtml: string | null;
  textSource: string | null;
  base64Source: string | null;
  onExpand: () => void;
};

type RenderedPreviewResolution = {
  body: ReactNode;
  expandedKind: ExpandedRenderedPreviewKind | null;
  ownsScroll: boolean;
};

type RenderedPreviewResolver = (
  context: RenderedPreviewContext,
) => RenderedPreviewResolution;

const renderedPreviewResolvers: Record<PreviewKind, RenderedPreviewResolver> = {
  text: ({ preview, fillHeight, textSource, sanitizedRenderedHtml }) =>
    textSource !== null
      ? {
          body: renderSourcePreview(preview, textSource, "rendered", fillHeight),
          expandedKind: null,
          ownsScroll: true,
        }
      : renderRenderedFallback(sanitizedRenderedHtml),
  markdown: ({ preview, textSource, sanitizedRenderedHtml }) =>
    textSource !== null
      ? {
          body: (
            <MarkdownDocumentView
              content={textSource}
              testId="preview-markdown"
            />
          ),
          expandedKind: null,
          ownsScroll: false,
        }
      : renderRenderedFallback(sanitizedRenderedHtml),
  table: ({ preview, fillHeight, textSource, sanitizedRenderedHtml }) =>
    textSource !== null
      ? {
          body: <TabularPreview preview={preview} fillHeight={fillHeight} />,
          expandedKind: null,
          ownsScroll: true,
        }
      : renderRenderedFallback(sanitizedRenderedHtml),
  spreadsheet: ({ preview, fillHeight, base64Source, sanitizedRenderedHtml }) =>
    base64Source !== null
      ? {
          body: (
            <SpreadsheetFilePreview preview={preview} fillHeight={fillHeight} />
          ),
          expandedKind: null,
          ownsScroll: true,
        }
      : renderRenderedFallback(sanitizedRenderedHtml),
  image: ({ preview, base64Source, onExpand, sanitizedRenderedHtml }) =>
    base64Source !== null
      ? {
          body: (
            <button
              type="button"
              className="block w-full cursor-zoom-in text-left"
              onClick={onExpand}
              aria-label={getExpandedPreviewLabel("image", preview.path)}
              data-testid="image-preview-trigger"
              title="Click to expand"
            >
              <div className="overflow-auto rounded-md border border-border checkerboard-bg">
                <img
                  alt={describeImagePreviewAlt(preview.path)}
                  className="mx-auto block h-auto max-h-[520px] w-full object-contain"
                  data-testid="image-preview"
                  src={`data:${preview.mime_type ?? "image/png"};base64,${base64Source}`}
                />
              </div>
            </button>
          ),
          expandedKind: "image",
          ownsScroll: true,
        }
      : renderRenderedFallback(sanitizedRenderedHtml),
  pdf: ({ preview, base64Source, onExpand, sanitizedRenderedHtml }) =>
    base64Source !== null
      ? {
          body: (
            <Suspense fallback={<PdfPreviewFallback filePath={preview.path} />}>
              <PdfPreview
                base64={base64Source}
                filePath={preview.path}
                onExpand={onExpand}
              />
            </Suspense>
          ),
          expandedKind: "pdf",
          ownsScroll: true,
        }
      : renderRenderedFallback(sanitizedRenderedHtml),
  unsupported: ({ sanitizedRenderedHtml }) =>
    renderRenderedFallback(sanitizedRenderedHtml),
};

export function PreviewPanel({
  preview,
  fillHeight = false,
}: PreviewPanelProps) {
  const [isExpandedPreviewOpen, setIsExpandedPreviewOpen] = useState(false);
  const sanitizedRenderedHtml = useMemo(
    () =>
      preview.view === "rendered" && preview.rendered_html
        ? DOMPurify.sanitize(preview.rendered_html, {
            USE_PROFILES: { html: true },
          })
        : null,
    [preview.rendered_html, preview.view],
  );
  const textSource = getPreviewSourceText(preview);
  const base64Source = getPreviewSourceBase64(preview);
  const renderedPreview = useMemo(() => {
    const resolver = renderedPreviewResolvers[preview.preview_kind];

    return resolver({
      preview,
      fillHeight,
      sanitizedRenderedHtml,
      textSource,
      base64Source,
      onExpand: () => setIsExpandedPreviewOpen(true),
    });
  }, [base64Source, fillHeight, preview, sanitizedRenderedHtml, textSource]);
  const previewOwnsScroll =
    preview.view === "rendered"
      ? renderedPreview.ownsScroll
      : preview.view === "raw"
        ? textSource !== null
        : Boolean(preview.diff);

  useEffect(() => {
    setIsExpandedPreviewOpen(false);
  }, [preview.path, preview.preview_kind, preview.view]);

  const body =
    preview.view === "rendered" ? (
      renderedPreview.body
    ) : preview.view === "raw" ? (
      textSource !== null ? (
        renderSourcePreview(preview, textSource, "raw", fillHeight)
      ) : (
        <PreviewPlaceholder
          title="Raw view isn't available for this file."
          description="This preview is backed by an encoded file payload. Use Rendered when an inline viewer is available."
        />
      )
    ) : preview.diff ? (
      <CodeBlockSurface
        value={preview.diff}
        language="diff"
        surface="plain"
        fillHeight={fillHeight}
        testId="preview-diff-viewer"
      />
    ) : (
      <PreviewPlaceholder
        title="Diff view is unavailable for this file."
        description="No textual diff was returned for the selected file."
      />
    );
  const canExpandRenderedPreview = renderedPreview.expandedKind !== null;
  const expandedPreviewLabel =
    renderedPreview.expandedKind === null
      ? ""
      : getExpandedPreviewLabel(renderedPreview.expandedKind, preview.path);

  return (
    <>
      <div
        className={cn(
          "min-w-0 py-2",
          fillHeight && "flex h-full min-h-0 flex-1 flex-col overflow-hidden",
        )}
        data-testid="preview-panel"
        data-fill-height={fillHeight ? "true" : "false"}
      >
        <div className="mb-3 flex shrink-0 items-center gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {buildPreviewMetadata(preview).map((item, index) => (
              <div key={item} className="inline-flex min-w-0 items-center gap-2">
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                <span>{item}</span>
              </div>
            ))}
          </div>
          {canExpandRenderedPreview ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              onClick={() => setIsExpandedPreviewOpen(true)}
              aria-label={expandedPreviewLabel}
              title="Open expanded preview"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
        <div
          className={cn(
            fillHeight && "flex min-h-0 flex-1 flex-col",
            fillHeight &&
              (previewOwnsScroll
                ? "overflow-hidden"
                : "overflow-y-auto overflow-x-hidden"),
          )}
        >
          {body}
        </div>
      </div>
      {canExpandRenderedPreview ? (
        <ExpandedRenderedPreviewDialog
          open={isExpandedPreviewOpen}
          onOpenChange={setIsExpandedPreviewOpen}
          preview={preview}
        />
      ) : null}
    </>
  );
}

function buildPreviewMetadata(preview: FilePreviewData): string[] {
  const items: string[] = [preview.view];

  if (preview.mime_type) {
    items.push(preview.mime_type);
  } else {
    items.push(preview.preview_kind);
  }

  return items;
}

function renderSourcePreview(
  preview: FilePreviewData,
  textSource: string,
  mode: "raw" | "rendered",
  fillHeight: boolean,
): ReactNode {
  return (
    <CodeBlockSurface
      value={formatPreviewSource(preview, textSource, mode)}
      language={detectSourceLanguage({
        path: preview.path,
        mimeType: preview.mime_type,
      })}
      surface="plain"
      fillHeight={fillHeight}
      testId="preview-source-viewer"
      ariaLabel={`${mode === "raw" ? "Raw" : "Rendered"} source preview for ${preview.path}`}
    />
  );
}

function renderRenderedFallback(
  sanitizedRenderedHtml: string | null,
): RenderedPreviewResolution {
  return sanitizedRenderedHtml
    ? {
        body: (
          <div
            className="markdown-content text-sm text-foreground"
            dangerouslySetInnerHTML={{ __html: sanitizedRenderedHtml }}
          />
        ),
        expandedKind: null,
        ownsScroll: false,
      }
    : {
        body: (
          <PreviewPlaceholder
            title="Rendered preview isn't available for this file."
            description="No rendered payload is available for this file. Use Raw or Diff when those views are available."
          />
        ),
        expandedKind: null,
        ownsScroll: false,
      };
}

function formatPreviewSource(
  preview: FilePreviewData,
  textSource: string,
  mode: "raw" | "rendered",
): string {
  return formatSourceForDisplay(textSource, {
    language: detectSourceLanguage({
      path: preview.path,
      mimeType: preview.mime_type,
    }),
    path: preview.path,
    mimeType: preview.mime_type,
    mode,
  });
}

function describeImagePreviewAlt(filePath: string): string {
  const filename = filePath.split("/").filter(Boolean).at(-1) ?? filePath;
  return `Image preview for ${filename}`;
}

function PreviewPlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      className="rounded-md border border-dashed border-border/80 bg-muted/20 p-3"
      data-testid="preview-placeholder"
    >
      <EmptyState icon={FileQuestion} message={title} size="md">
        <p className="max-w-md text-center text-xs leading-6 text-muted-foreground">
          {description}
        </p>
      </EmptyState>
    </div>
  );
}

function PdfPreviewFallback({
  filePath,
  expanded = false,
}: {
  filePath: string;
  expanded?: boolean;
}) {
  return (
    <PreviewRendererLoadingState
      expanded={expanded}
      label={`PDF renderer for ${filePath}`}
      testId="pdf-preview-loading"
    />
  );
}

function ExpandedRenderedPreviewDialog({
  open,
  onOpenChange,
  preview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: FilePreviewData;
}) {
  const expandedPreviewKind = getExpandedRenderedPreviewKind(preview);
  const base64Source = getPreviewSourceBase64(preview);
  const isImage = expandedPreviewKind === "image";
  const dialogContentOverrides = isImage
    ? "h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none border-0 bg-transparent p-0 shadow-none sm:h-[calc(100dvh-3rem)] sm:w-[calc(100vw-3rem)] sm:max-w-none"
    : "flex h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden border-0 bg-transparent p-0 shadow-none";

  if (!expandedPreviewKind || !base64Source) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          isImage ? "" : "sm:max-w-3xl",
          dialogContentOverrides,
        )}
        data-testid="expanded-preview-dialog"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{preview.path}</DialogTitle>
          <DialogDescription>
            {getExpandedPreviewDescription(expandedPreviewKind)}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          {isImage ? (
            <div className="h-full overflow-auto checkerboard-bg">
              <div className="flex min-h-full min-w-full items-start justify-center">
                <img
                  alt={describeImagePreviewAlt(preview.path)}
                  className="block h-auto w-full max-w-none"
                  data-testid="expanded-image-preview"
                  src={`data:${preview.mime_type ?? "image/png"};base64,${base64Source}`}
                />
              </div>
            </div>
          ) : (
            <Suspense
              fallback={<PdfPreviewFallback filePath={preview.path} expanded />}
            >
              <PdfPreview
                base64={base64Source}
                filePath={preview.path}
                expanded
                className="h-full min-h-0"
              />
            </Suspense>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getExpandedRenderedPreviewKind(
  preview: FilePreviewData,
): ExpandedRenderedPreviewKind | null {
  if (preview.view !== "rendered" || getPreviewSourceBase64(preview) === null) {
    return null;
  }

  return preview.preview_kind === "image" || preview.preview_kind === "pdf"
    ? preview.preview_kind
    : null;
}

function getExpandedPreviewLabel(
  kind: ExpandedRenderedPreviewKind,
  filePath: string,
): string {
  return `Expand rendered ${kind === "image" ? "image" : "PDF"} preview for ${filePath}`;
}

function getExpandedPreviewDescription(
  kind: ExpandedRenderedPreviewKind,
): string {
  return kind === "pdf"
    ? "Scrollable full-document preview."
    : "Expanded rendered image preview.";
}
