export type PreviewMode = "diff" | "raw" | "rendered";
export type SnapshotPreviewMode = Extract<PreviewMode, "raw" | "rendered">;
export type PreviewKind =
  | "text"
  | "markdown"
  | "table"
  | "spreadsheet"
  | "image"
  | "pdf"
  | "unsupported";
export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed" | "unchanged";
export type PreviewSourceEncoding = "utf8" | "base64";

export const previewModes = ["rendered", "raw", "diff"] as const;
export const snapshotPreviewModes = ["rendered", "raw"] as const;

export interface FileChangeSummary {
  path: string;
  old_path: string | null;
  status: FileChangeStatus;
  mime_type: string | null;
  preview_kind: PreviewKind;
  additions: number;
  deletions: number;
}

export interface FilePreviewSource {
  content: string;
  encoding: PreviewSourceEncoding;
}

export interface FilePreviewData {
  path: string;
  view: PreviewMode;
  mime_type: string | null;
  preview_kind: PreviewKind;
  diff: string | null;
  source: FilePreviewSource | null;
  rendered_html: string | null;
}

export function getPreviewSourceText(preview: FilePreviewData): string | null {
  return preview.source?.encoding === "utf8" ? preview.source.content : null;
}

export function getPreviewSourceBase64(preview: FilePreviewData): string | null {
  return preview.source?.encoding === "base64" ? preview.source.content : null;
}

export function supportedPreviewModes(): PreviewMode[] {
  return [...snapshotPreviewModes];
}

export function supportedDiffPreviewModes(): PreviewMode[] {
  return [...previewModes];
}

export function isPreviewMode(value: string | null): value is PreviewMode {
  return previewModes.includes(value as PreviewMode);
}

export function isSnapshotPreviewMode(value: string | null): value is SnapshotPreviewMode {
  return snapshotPreviewModes.includes(value as SnapshotPreviewMode);
}

export function formatChangeLabel(change: FileChangeSummary): string {
  if (change.status === "renamed" && change.old_path) {
    return `${change.old_path} -> ${change.path}`;
  }
  return change.path;
}

export function formatChangeDisplayLabel(
  change: FileChangeSummary,
  maxLength = 28,
): string {
  if (change.status === "renamed" && change.old_path) {
    const sideLength = Math.max(Math.floor((maxLength - 4) / 2), 12);
    return `${formatPathTailLabel(change.old_path, sideLength)} -> ${formatPathTailLabel(change.path, sideLength)}`;
  }

  return formatPathTailLabel(change.path, maxLength);
}

export function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const available = Math.max(maxLength - 1, 2);
  const headLength = Math.ceil(available / 2);
  const tailLength = Math.floor(available / 2);
  return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
}

function formatPathTailLabel(filePath: string, maxLength: number): string {
  if (filePath.length <= maxLength) {
    return filePath;
  }

  const segments = filePath.split("/").filter((segment) => segment.length > 0);
  const fileName = segments.at(-1) ?? filePath;
  const prefix = ".../";
  const availableLength = Math.max(maxLength - prefix.length, 6);

  if (fileName.length > availableLength) {
    return `${prefix}${truncateMiddle(fileName, availableLength)}`;
  }

  let label = `${prefix}${fileName}`;
  for (let index = segments.length - 2; index >= 0; index -= 1) {
    const candidate = `${prefix}${segments.slice(index).join("/")}`;
    if (candidate.length > maxLength) {
      break;
    }
    label = candidate;
  }

  return label;
}
