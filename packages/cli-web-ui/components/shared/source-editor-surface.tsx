import Editor from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

import { cn } from "../../lib/utils";

const defaultSourceEditorOptions: Monaco.editor.IStandaloneEditorConstructionOptions =
  {
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    lineHeight: 20,
    wordWrap: "on",
    lineNumbers: "on",
    lineNumbersMinChars: 3,
    padding: { top: 16, bottom: 16 },
    scrollBeyondLastLine: false,
    tabSize: 2,
  };

export const authoringEditorOptions: Monaco.editor.IStandaloneEditorConstructionOptions =
  {
    renderLineHighlight: "line",
    occurrencesHighlight: "off",
    selectionHighlight: false,
  };

export interface SourceEditorSurfaceProps {
  value: string;
  language: string;
  height: string | number;
  readOnly?: boolean;
  className?: string;
  theme?: string;
  testId?: string;
  ariaLabel?: string;
  options?: Monaco.editor.IStandaloneEditorConstructionOptions;
  onChange?: (value: string | undefined) => void;
  onMount?: (
    editor: Monaco.editor.IStandaloneCodeEditor,
    monacoInstance: typeof Monaco,
  ) => void;
}

export function SourceEditorSurface({
  value,
  language,
  height,
  readOnly = false,
  className,
  theme = "vs",
  testId,
  ariaLabel,
  options,
  onChange,
  onMount,
}: SourceEditorSurfaceProps) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-card",
        className,
      )}
      style={{ backgroundColor: "var(--monaco-shell-background)" }}
      data-testid={testId}
      data-language={language}
      data-read-only={readOnly ? "true" : "false"}
    >
      <Editor
        height={height}
        language={language}
        theme={theme}
        value={value}
        onChange={onChange}
        onMount={onMount}
        options={{
          ...defaultSourceEditorOptions,
          readOnly,
          domReadOnly: readOnly,
          renderLineHighlight: readOnly ? "none" : "line",
          occurrencesHighlight: readOnly ? "off" : "singleFile",
          selectionHighlight: !readOnly,
          folding: true,
          codeLens: false,
          contextmenu: true,
          stickyScroll: { enabled: false },
          ariaLabel,
          ...options,
        }}
      />
    </div>
  );
}
