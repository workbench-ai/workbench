export type PreviewMode = "raw" | "rendered";
export type PreviewKind =
  | "text"
  | "markdown"
  | "table"
  | "spreadsheet"
  | "image"
  | "pdf"
  | "unsupported";
export type PreviewSourceEncoding = "utf8" | "base64";

const previewModes = ["rendered", "raw"] as const;

export interface FilePreviewSource {
  content: string;
  encoding: PreviewSourceEncoding;
}

export interface FilePreviewData {
  path: string;
  view: PreviewMode;
  mime_type: string | null;
  preview_kind: PreviewKind;
  source: FilePreviewSource | null;
}

export function getPreviewSourceText(preview: FilePreviewData): string | null {
  return preview.source?.encoding === "utf8" ? preview.source.content : null;
}

export function getPreviewSourceBase64(preview: FilePreviewData): string | null {
  return preview.source?.encoding === "base64" ? preview.source.content : null;
}

export function supportedPreviewModes(): PreviewMode[] {
  return [...previewModes];
}

export function isPreviewMode(value: string | null): value is PreviewMode {
  return previewModes.includes(value as PreviewMode);
}
