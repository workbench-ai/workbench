import { useEffect, useState } from "react";
import type * as Monaco from "monaco-editor";

import { SourceEditorSurface } from "./source-editor-surface";

export interface YamlEditorSurfaceProps {
  value: string;
  height: string | number;
  readOnly?: boolean;
  className?: string;
  testId?: string;
  ariaLabel?: string;
  options?: Monaco.editor.IStandaloneEditorConstructionOptions;
  onChange?: (value: string | undefined) => void;
  onMount?: (
    editor: Monaco.editor.IStandaloneCodeEditor,
    monacoInstance: typeof Monaco,
  ) => void;
}

export function YamlEditorSurface({
  value,
  height,
  readOnly = false,
  className,
  testId,
  ariaLabel,
  options,
  onChange,
  onMount,
}: YamlEditorSurfaceProps) {
  const [prefersDark, setPrefersDark] = useState(() => {
    return typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  });

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersDark(event.matches);
    };

    setPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  return (
    <SourceEditorSurface
      className={className}
      height={height}
      language="yaml"
      theme={prefersDark ? "vs-dark" : "vs"}
      testId={testId}
      ariaLabel={ariaLabel}
      value={value}
      onMount={onMount}
      onChange={onChange}
      readOnly={readOnly}
      options={options}
    />
  );
}
