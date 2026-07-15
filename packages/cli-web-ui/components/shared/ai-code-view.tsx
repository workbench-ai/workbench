import { StreamingMarkdown } from "./streaming-markdown";

import { cn } from "../../lib/utils";

export interface AiCodeViewProps {
  value: string;
  language?: string | null;
  className?: string;
  testId?: string;
  ariaLabel?: string;
  wrapLongLines?: boolean;
}

export function AiCodeView({
  value,
  language = null,
  className,
  testId,
  ariaLabel,
  wrapLongLines = false,
}: AiCodeViewProps) {
  const normalizedLanguage = normalizeFenceLanguage(language);

  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "ai-code-view min-w-0 max-w-full overflow-visible",
        wrapLongLines && "overflow-x-hidden",
        className,
      )}
      data-language={normalizedLanguage ?? "plaintext"}
      data-read-only="true"
      data-wrap-long-lines={wrapLongLines ? "true" : undefined}
      data-testid={testId}
    >
      <StreamingMarkdown content={toFencedCode(value, normalizedLanguage)} />
    </div>
  );
}

function normalizeFenceLanguage(language: string | null): string | null {
  if (!language || language === "plaintext") {
    return null;
  }
  if (language === "shell") {
    return "sh";
  }
  return language;
}

function toFencedCode(value: string, language: string | null): string {
  const maxFenceLength = Math.max(
    3,
    ...Array.from(value.matchAll(/`+/g), (match) => match[0].length + 1),
  );
  const fence = "`".repeat(maxFenceLength);
  const languageLabel = language ?? "";
  return `${fence}${languageLabel}\n${value}\n${fence}`;
}
