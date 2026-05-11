import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";

import { cn } from "../../lib/utils";

export interface StreamingMarkdownProps {
  content: string;
  className?: string;
  testId?: string;
  streaming?: boolean;
  preserveWhitespace?: boolean;
}

export function StreamingMarkdown({
  content,
  className,
  testId,
  streaming = false,
  preserveWhitespace = false,
}: StreamingMarkdownProps) {
  return (
    <div
      className={cn("markdown-content min-w-0 max-w-full text-foreground", className)}
      data-preserve-whitespace={preserveWhitespace ? "true" : undefined}
      data-testid={testId}
    >
      <Streamdown
        animated={streaming ? { duration: 120 } : false}
        className="text-sm leading-7"
        controls={false}
        isAnimating={streaming}
        linkSafety={{ enabled: false }}
        mode={streaming ? "streaming" : "static"}
        plugins={{ code }}
      >
        {content}
      </Streamdown>
    </div>
  );
}
