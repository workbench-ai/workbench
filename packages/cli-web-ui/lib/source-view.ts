export type SourceLanguage =
  | "plaintext"
  | "yaml"
  | "json"
  | "markdown"
  | "typescript"
  | "javascript"
  | "css"
  | "scss"
  | "html"
  | "shell"
  | "python"
  | "go"
  | "rust";

const sourceLanguagePathSuffixes: ReadonlyArray<
  readonly [SourceLanguage, readonly string[]]
> = [
  ["yaml", [".yaml", ".yml"]],
  ["json", [".json"]],
  ["markdown", [".markdown", ".md"]],
  ["typescript", [".ts", ".tsx", ".mts", ".cts"]],
  ["javascript", [".js", ".jsx", ".mjs", ".cjs"]],
  ["scss", [".scss"]],
  ["css", [".css"]],
  ["html", [".html", ".htm"]],
  ["shell", [".sh", ".bash", ".zsh"]],
  ["python", [".py"]],
  ["go", [".go"]],
  ["rust", [".rs"]],
];

const sourceLanguageMimeMatchers: ReadonlyArray<{
  language: SourceLanguage;
  matches: (mimeType: string) => boolean;
}> = [
  {
    language: "yaml",
    matches: (mimeType) =>
      mimeType.includes("yaml") ||
      mimeType === "application/x-yaml" ||
      mimeType === "text/x-yaml",
  },
  {
    language: "json",
    matches: (mimeType) =>
      mimeType === "application/json" || mimeType.endsWith("+json"),
  },
  {
    language: "markdown",
    matches: (mimeType) =>
      mimeType === "text/markdown" || mimeType === "text/x-markdown",
  },
  {
    language: "typescript",
    matches: (mimeType) => mimeType.includes("typescript"),
  },
  {
    language: "javascript",
    matches: (mimeType) => mimeType.includes("javascript"),
  },
  {
    language: "scss",
    matches: (mimeType) => mimeType.includes("scss"),
  },
  {
    language: "css",
    matches: (mimeType) => mimeType === "text/css",
  },
  {
    language: "html",
    matches: (mimeType) => mimeType === "text/html",
  },
  {
    language: "shell",
    matches: (mimeType) =>
      mimeType === "application/x-sh" ||
      mimeType === "application/x-shellscript" ||
      mimeType === "text/x-shellscript",
  },
  {
    language: "python",
    matches: (mimeType) => mimeType.includes("python"),
  },
  {
    language: "go",
    matches: (mimeType) => mimeType.includes("x-go"),
  },
  {
    language: "rust",
    matches: (mimeType) => mimeType.includes("rust"),
  },
];

export function detectSourceLanguage(args: {
  path?: string | null;
  mimeType?: string | null;
}): SourceLanguage {
  const normalizedPath = args.path?.toLowerCase() ?? "";
  const normalizedMimeType = args.mimeType?.toLowerCase() ?? "";

  for (const [language, suffixes] of sourceLanguagePathSuffixes) {
    if (suffixes.some((suffix) => normalizedPath.endsWith(suffix))) {
      return language;
    }
  }

  for (const { language, matches } of sourceLanguageMimeMatchers) {
    if (matches(normalizedMimeType)) {
      return language;
    }
  }

  return "plaintext";
}

export function formatSourceForDisplay(
  value: string,
  args: {
    language?: SourceLanguage | null;
    path?: string | null;
    mimeType?: string | null;
    mode?: "raw" | "rendered";
  } = {},
): string {
  const language =
    args.language ??
    detectSourceLanguage({ path: args.path, mimeType: args.mimeType });
  if (args.mode !== "rendered" || language !== "json") {
    return value;
  }

  try {
    const normalized = JSON.stringify(JSON.parse(value), null, 2);
    return value.endsWith("\n") ? `${normalized}\n` : normalized;
  } catch {
    return value;
  }
}
