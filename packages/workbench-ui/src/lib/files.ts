import type {
  SurfaceSnapshotFile,
  WorkbenchInspectionFileContent,
} from "@workbench-ai/workbench-contract";
import type {
  FileChangeSummary,
  FilePreviewData,
  PreviewKind,
  PreviewMode,
} from "@workbench-ai/cli-web-ui/lib/file-preview";

export function surfaceFilesToChanges(files: readonly SurfaceSnapshotFile[]): FileChangeSummary[] {
  return files.map((file) => ({
    path: file.path,
    old_path: null,
    status: "unchanged",
    mime_type: mimeTypeForPath(file.path),
    preview_kind: previewKindForFile(file),
    additions: 0,
    deletions: 0,
  }));
}

export function surfaceFileToPreview(
  file: WorkbenchInspectionFileContent,
  view: PreviewMode,
): FilePreviewData {
  const content = file.content ?? file.unavailableReason ?? "";
  const isUnavailable = Boolean(file.unavailableReason);
  return {
    path: file.path,
    view,
    mime_type: mimeTypeForPath(file.path),
    preview_kind: isUnavailable ? "unsupported" : previewKindForFile(file),
    diff: null,
    source: isUnavailable
      ? null
      : {
          content,
          encoding: file.encoding === "base64" ? "base64" : "utf8",
        },
    rendered_html: null,
  };
}

export function preferredFilePath(files: readonly SurfaceSnapshotFile[]): string | null {
  const ordered = [...files].sort((left, right) => fileRank(left) - fileRank(right) || left.path.localeCompare(right.path));
  return ordered[0]?.path ?? null;
}

function fileRank(file: SurfaceSnapshotFile): number {
  const path = file.path.toLowerCase();
  if (path === "skill.md" || path.endsWith("/skill.md")) {
    return 0;
  }
  if (path.endsWith(".md")) {
    return 1;
  }
  if (path.endsWith(".yaml") || path.endsWith(".yml") || path.endsWith(".json")) {
    return 2;
  }
  if (path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".js") || path.endsWith(".py")) {
    return 3;
  }
  return 4;
}

function previewKindForFile(file: Pick<SurfaceSnapshotFile, "path" | "kind" | "encoding">): PreviewKind {
  const path = file.path.toLowerCase();
  if (file.kind === "binary" || file.encoding === "base64") {
    if (path.endsWith(".png") || path.endsWith(".jpg") || path.endsWith(".jpeg") || path.endsWith(".gif") || path.endsWith(".webp") || path.endsWith(".svg")) {
      return "image";
    }
    if (path.endsWith(".pdf")) {
      return "pdf";
    }
    return "unsupported";
  }
  if (path.endsWith(".md") || path.endsWith(".markdown")) {
    return "markdown";
  }
  if (path.endsWith(".csv") || path.endsWith(".tsv")) {
    return "table";
  }
  if (path.endsWith(".xlsx") || path.endsWith(".xls")) {
    return "spreadsheet";
  }
  return "text";
}

function mimeTypeForPath(path: string): string | null {
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".md") || normalized.endsWith(".markdown")) {
    return "text/markdown";
  }
  if (normalized.endsWith(".json")) {
    return "application/json";
  }
  if (normalized.endsWith(".yaml") || normalized.endsWith(".yml")) {
    return "application/yaml";
  }
  if (normalized.endsWith(".csv")) {
    return "text/csv";
  }
  if (normalized.endsWith(".tsv")) {
    return "text/tab-separated-values";
  }
  if (normalized.endsWith(".png")) {
    return "image/png";
  }
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalized.endsWith(".pdf")) {
    return "application/pdf";
  }
  return "text/plain";
}
