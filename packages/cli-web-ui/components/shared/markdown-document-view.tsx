import { Streamdown } from "streamdown";
import { type SVGProps, useMemo } from "react";

import { parseMarkdownDocument } from "../../lib/markdown-document";
import { cn } from "../../lib/utils";
import { CodeBlockSurface } from "./code-block-surface";
import { EmptyState } from "./empty-state";

export interface MarkdownDocumentViewProps {
  content: string;
  className?: string;
  testId?: string;
}

export function MarkdownDocumentView({
  content,
  className,
  testId,
}: MarkdownDocumentViewProps) {
  const document = useMemo(() => parseMarkdownDocument(content), [content]);
  const trimmedBody = document.body.trim();

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-4 p-px", className)}
      data-testid={testId}
    >
      {document.frontmatter ? (
        <div className="grid min-w-0 gap-2">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Frontmatter</span>
            <span aria-hidden="true">·</span>
            <span>yaml</span>
          </div>
          <CodeBlockSurface value={document.frontmatter} language="yaml" />
        </div>
      ) : null}

      {trimmedBody.length > 0 ? (
        <div className="markdown-content min-w-0 max-w-full text-foreground">
          <Streamdown
            animated={false}
            className="text-sm leading-7"
            controls={false}
            isAnimating={false}
            linkSafety={{ enabled: true }}
            mode="static"
          >
            {trimmedBody}
          </Streamdown>
        </div>
      ) : (
        <EmptyState
          icon={DocumentPlaceholderIcon}
          title="Document body is empty"
          message={document.hasFrontmatter
            ? "The file only contains frontmatter metadata."
            : "No markdown body was found in this file."}
          variant="minimal"
          align="start"
        />
      )}
    </div>
  );
}

function DocumentPlaceholderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 3.75h7.086a2.25 2.25 0 0 1 1.591.659l2.914 2.914a2.25 2.25 0 0 1 .659 1.591V18A2.25 2.25 0 0 1 17 20.25H7A2.25 2.25 0 0 1 4.75 18V6A2.25 2.25 0 0 1 7 3.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M14 3.75V8h4.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 12.25h8M8 15.75h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
