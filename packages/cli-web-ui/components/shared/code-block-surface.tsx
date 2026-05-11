import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

export interface CodeBlockSurfaceProps {
  value: string;
  language?: string | null;
  testId?: string;
  ariaLabel?: string;
  className?: string;
  codeClassName?: string;
  surface?: "plain" | "inset";
  fillHeight?: boolean;
  wrapLongLines?: boolean;
}

export function CodeBlockSurface({
  value,
  language = null,
  testId,
  ariaLabel,
  className,
  codeClassName,
  surface = "inset",
  fillHeight = false,
  wrapLongLines = true,
}: CodeBlockSurfaceProps) {
  const shouldWrap = wrapLongLines || fillHeight;

  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "w-full min-w-0 max-w-full",
        surface === "inset"
          ? "overflow-hidden rounded-xl border border-border/70 bg-background"
          : "overflow-visible bg-transparent p-0",
        fillHeight && "flex min-h-0 flex-1 flex-col",
        className,
      )}
      data-language={language ?? "plaintext"}
      data-read-only="true"
      data-wrap-long-lines={wrapLongLines ? "true" : undefined}
      data-testid={testId}
    >
      <pre
        className={cn(
          "m-0 w-full min-w-0 max-w-full font-mono text-xs leading-6 text-foreground tabular-nums",
          surface === "inset" ? "p-3" : "p-0",
          fillHeight
            ? "min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
            : shouldWrap
              ? "overflow-x-hidden"
              : "overflow-x-auto",
          shouldWrap
            ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
            : "whitespace-pre",
          codeClassName,
        )}
      >
        <code
          className={cn(
            "block w-full min-w-0 max-w-full",
            shouldWrap
              ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
              : "whitespace-pre",
          )}
        >
          {renderHighlightedCode(value, language)}
        </code>
      </pre>
    </div>
  );
}

function renderHighlightedCode(value: string, language: string | null): ReactNode {
  const normalizedLanguage = normalizeLanguage(language);

  if (normalizedLanguage === "diff") {
    return renderDiff(value);
  }

  if (normalizedLanguage === "yaml" || normalizedLanguage === "json") {
    return renderStructuredSource(value);
  }

  if (normalizedLanguage === "shell" || normalizedLanguage === "sh" || normalizedLanguage === "bash") {
    return renderShell(value);
  }

  if (normalizedLanguage === "markdown" || normalizedLanguage === "md") {
    return renderMarkdownSource(value);
  }

  return value;
}

function normalizeLanguage(language: string | null): string | null {
  return language?.toLowerCase().trim() || null;
}

function renderDiff(value: string): ReactNode[] {
  const lines = splitLines(value);
  return lines.map((line, index) => {
    const className = line.startsWith("+") && !line.startsWith("+++")
      ? codeTokenClassName("text-emerald-700")
      : line.startsWith("-") && !line.startsWith("---")
        ? codeTokenClassName("text-destructive")
        : line.startsWith("@@")
          ? codeTokenClassName("text-primary")
          : line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")
            ? codeTokenClassName("text-muted-foreground")
            : codeTokenClassName();

    return (
      <span key={index} className={className}>
        {line}
        {index < lines.length - 1 ? "\n" : null}
      </span>
    );
  });
}

function renderStructuredSource(value: string): ReactNode[] {
  const lines = splitLines(value);
  return lines.map((line, index) => (
    <span key={index} className={codeTokenClassName()}>
      {highlightStructuredLine(line)}
      {index < lines.length - 1 ? "\n" : null}
    </span>
  ));
}

function highlightStructuredLine(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#.*$|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b|^[\s-]*[A-Za-z_][\w.-]*(?=\s*:))/gu;
  let cursor = 0;
  let tokenIndex = 0;

  for (const match of line.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > cursor) {
      nodes.push(line.slice(cursor, start));
    }
    nodes.push(
      <span key={`${start}-${tokenIndex}`} className={codeTokenClassName(structuredTokenClass(token))}>
        {token}
      </span>,
    );
    cursor = start + token.length;
    tokenIndex += 1;
  }

  if (cursor < line.length) {
    nodes.push(line.slice(cursor));
  }

  return nodes.length > 0 ? nodes : [line];
}

function structuredTokenClass(token: string): string {
  if (token.startsWith("#")) {
    return "text-muted-foreground";
  }
  if (token.startsWith("\"") || token.startsWith("'")) {
    return "text-emerald-700";
  }
  if (/^[\s-]*[A-Za-z_][\w.-]*$/u.test(token)) {
    return "text-primary";
  }
  if (/^(true|false|null)$/u.test(token)) {
    return "text-amber-700";
  }
  return "text-blue-700";
}

function renderShell(value: string): ReactNode[] {
  const lines = splitLines(value);
  return lines.map((line, index) => (
    <span key={index} className={codeTokenClassName()}>
      {highlightShellLine(line)}
      {index < lines.length - 1 ? "\n" : null}
    </span>
  ));
}

function highlightShellLine(line: string): ReactNode[] {
  const commandMatch = /^(\s*)([A-Za-z0-9_.:/-]+)/u.exec(line);
  if (!commandMatch) {
    return [line];
  }

  const leading = commandMatch[1] ?? "";
  const command = commandMatch[2] ?? "";
  return [
    leading,
    <span key="command" className={codeTokenClassName("text-primary")}>
      {command}
    </span>,
    line.slice(leading.length + command.length),
  ];
}

function renderMarkdownSource(value: string): ReactNode[] {
  const lines = splitLines(value);
  return lines.map((line, index) => {
    const className = line.startsWith("#")
      ? codeTokenClassName("text-primary")
      : /^[-*]\s/u.test(line)
        ? codeTokenClassName("text-emerald-700")
        : codeTokenClassName();
    return (
      <span key={index} className={className}>
        {line}
        {index < lines.length - 1 ? "\n" : null}
      </span>
    );
  });
}

function codeTokenClassName(className?: string): string {
  return cn("break-words [overflow-wrap:anywhere]", className);
}

function splitLines(value: string): string[] {
  return value.split("\n");
}
