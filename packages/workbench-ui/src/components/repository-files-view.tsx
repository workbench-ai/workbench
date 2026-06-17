import { useEffect, useState } from "react";
import { CircleAlertIcon, FileTextIcon, FolderOpenIcon } from "lucide-react";

import {
  workbenchInspectionFileContent,
  workbenchInspectionFileContentUnavailableReason,
  type SurfaceSnapshotFile,
  type WorkbenchInspectionFileContent,
} from "@workbench-ai/workbench-contract";
import { PreviewPanel } from "@workbench-ai/cli-web-ui/components/shared/preview-panel";
import { ProblemState } from "@workbench-ai/cli-web-ui/components/shared/problem-state";
import { Button } from "@workbench-ai/cli-web-ui/components/ui/button";
import { supportedPreviewModes, type PreviewMode } from "@workbench-ai/cli-web-ui/lib/file-preview";
import { cn } from "@workbench-ai/cli-web-ui/lib/utils";

import { directoryPathForFile, formatCount } from "../lib/format";
import {
  preferredFilePath,
  surfaceFileToPreview,
} from "../lib/files";
import { fileContentApiPath } from "../lib/api-paths";
import type {
  WorkbenchFileOwnerKind,
  WorkbenchFileRouteState,
} from "../lib/routes";

export function RepositoryFilesView({
  apiBasePath,
  defaultFilePath,
  displayRootPath,
  file,
  files,
  onFileChange,
  onLoadingChange,
  ownerId,
  ownerKind,
  repositoryLabel,
}: {
  apiBasePath: string;
  defaultFilePath?: string | null;
  displayRootPath?: string | null;
  file: WorkbenchFileRouteState;
  files: readonly SurfaceSnapshotFile[];
  onFileChange: (file: WorkbenchFileRouteState, options?: { replace?: boolean }) => void;
  onLoadingChange?: (loading: boolean) => void;
  ownerId: string;
  ownerKind: WorkbenchFileOwnerKind;
  repositoryLabel: string;
}) {
  const rootPath = normalizeRootPath(displayRootPath);
  const selectedFilePath = files.some((entry) => entry.path === file.filePath && filePathIsWithinRoot(entry.path, rootPath))
    ? file.filePath
    : null;
  const directoryPath = normalizeDirectoryPath(
    file.directoryPath ?? directoryPathForSelectedFile(selectedFilePath, rootPath),
    rootPath,
  );
  const normalizedDefaultFilePath = defaultFilePath && files.some((entry) => entry.path === defaultFilePath && filePathIsWithinRoot(entry.path, rootPath))
    ? defaultFilePath
    : null;
  const previewFilePath = selectedFilePath ?? (directoryPath ? null : normalizedDefaultFilePath ?? preferredFilePath(filesWithinRoot(files, rootPath)));
  const previewMode = file.previewMode;
  const previewState = useInspectionFilePreview({
    apiBasePath,
    ownerKind,
    ownerId,
    path: previewFilePath,
    previewMode,
    files,
  });
  const entries = sourceRepositoryEntries(files, directoryPath, rootPath);
  const previewFile = previewFilePath
    ? files.find((entry) => entry.path === previewFilePath) ?? null
    : null;
  const previewLabel = previewFile ? displayPathForFile(previewFile.path, rootPath) : null;

  useEffect(() => {
    onLoadingChange?.(previewState.loading && previewFilePath !== null);
    return () => onLoadingChange?.(false);
  }, [onLoadingChange, previewFilePath, previewState.loading]);

  return (
    <>
      <section className="min-w-0" aria-label={repositoryLabel}>
        <div className="overflow-hidden rounded-lg border border-border/70 bg-background">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
            <SourceBreadcrumbs
              directoryPath={directoryPath}
              rootPath={rootPath}
              onSelectDirectory={(nextDirectoryPath) => {
                onFileChange({
                  filePath: null,
                  directoryPath: nextDirectoryPath,
                  previewMode,
                  versionId: file.versionId,
                });
              }}
            />
          </div>
          <div className="divide-y divide-border/60">
            {directoryPath ? (
              <RepositoryRow
                active={false}
                description="Parent directory"
                icon={FolderOpenIcon}
                label=".."
                meta="folder"
                onClick={() => {
                  onFileChange({
                    filePath: null,
                    directoryPath: parentDirectoryPath(directoryPath, rootPath),
                    previewMode,
                    versionId: file.versionId,
                  });
                }}
              />
            ) : null}
            {entries.map((entry) => {
              if (entry.kind === "folder") {
                const active = directoryPath === entry.path || Boolean(selectedFilePath?.startsWith(`${entry.path}/`));
                return (
                  <RepositoryRow
                    active={active}
                    description={formatCount(entry.fileCount, "file")}
                    icon={FolderOpenIcon}
                    key={entry.path}
                    label={`${entry.name}/`}
                    meta="folder"
                    onClick={() => {
                      onFileChange({
                        filePath: null,
                        directoryPath: entry.path,
                        previewMode,
                        versionId: file.versionId,
                      });
                    }}
                  />
                );
              }
              const active = selectedFilePath === entry.file.path;
              return (
                <RepositoryRow
                  active={active}
                  description={displayPathForFile(entry.file.path, rootPath)}
                  icon={FileTextIcon}
                  key={entry.file.path}
                  label={entry.name}
                  meta={fileMetaLabel(entry.file)}
                  onClick={() => {
                    onFileChange({
                      filePath: entry.file.path,
                      directoryPath,
                      previewMode,
                      versionId: file.versionId,
                    });
                  }}
                />
              );
            })}
          </div>
        </div>
      </section>

      {previewFile ? (
        <section className="overflow-hidden rounded-lg border border-border/70 bg-background" aria-label={`${previewLabel} preview`}>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileTextIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <h3 className="truncate text-base font-semibold text-foreground">{previewLabel}</h3>
            </div>
            <PreviewModeButtons
              value={previewMode}
              onValueChange={(nextPreviewMode) => {
                onFileChange({
                  filePath: selectedFilePath,
                  directoryPath,
                  previewMode: nextPreviewMode,
                  versionId: file.versionId,
                });
              }}
            />
          </div>
          <div className="min-h-[24rem] overflow-hidden px-4 py-3">
            <SourcePreviewBody
              error={previewState.error}
              loading={previewState.loading}
              preview={previewState.preview}
            />
          </div>
        </section>
      ) : null}
    </>
  );
}

type SourceRepositoryEntry =
  | { kind: "folder"; name: string; path: string; fileCount: number }
  | { kind: "file"; name: string; file: SurfaceSnapshotFile };

function sourceRepositoryEntries(
  files: readonly SurfaceSnapshotFile[],
  directoryPath: string | null,
  rootPath: string | null,
): SourceRepositoryEntry[] {
  const prefix = directoryPath ? `${directoryPath}/` : rootPath ? `${rootPath}/` : "";
  const folders = new Map<string, { name: string; path: string; fileCount: number }>();
  const entries: SourceRepositoryEntry[] = [];

  for (const file of files) {
    if (!filePathIsWithinRoot(file.path, rootPath)) {
      continue;
    }
    if (prefix && !file.path.startsWith(prefix)) {
      continue;
    }
    const relativePath = prefix ? file.path.slice(prefix.length) : file.path;
    const [name, ...rest] = relativePath.split("/").filter(Boolean);
    if (!name) {
      continue;
    }
    if (rest.length === 0) {
      entries.push({ kind: "file", name, file });
      continue;
    }
    const path = prefix ? `${prefix}${name}` : name;
    const existing = folders.get(path);
    if (existing) {
      existing.fileCount += 1;
    } else {
      folders.set(path, { name, path, fileCount: 1 });
    }
  }

  return [
    ...entries.sort((left, right) => sourceSpecialNameRank(left.name) - sourceSpecialNameRank(right.name) || left.name.localeCompare(right.name)),
    ...[...folders.values()]
      .sort((left, right) => sourceSpecialNameRank(left.name) - sourceSpecialNameRank(right.name) || left.name.localeCompare(right.name))
      .map((entry) => ({ kind: "folder" as const, ...entry })),
  ];
}

function sourceSpecialNameRank(name: string): number {
  const normalized = name.toLowerCase();
  if (normalized === "skill.md") {
    return 0;
  }
  if (normalized.endsWith(".md")) {
    return 1;
  }
  if (normalized === ".workbench") {
    return 2;
  }
  return 3;
}

function parentDirectoryPath(directoryPath: string | null, rootPath: string | null): string | null {
  if (!directoryPath || !directoryPath.includes("/")) {
    return null;
  }
  const parent = directoryPath.split("/").slice(0, -1).join("/");
  if (rootPath && (parent === rootPath || !parent.startsWith(`${rootPath}/`))) {
    return null;
  }
  return parent;
}

function directoryPathForSelectedFile(filePath: string | null, rootPath: string | null): string | null {
  const directoryPath = directoryPathForFile(filePath);
  if (!rootPath || !directoryPath) {
    return directoryPath;
  }
  return directoryPath === rootPath ? null : directoryPath;
}

function normalizeDirectoryPath(directoryPath: string | null, rootPath: string | null): string | null {
  if (!directoryPath) {
    return null;
  }
  if (!rootPath) {
    return directoryPath;
  }
  if (directoryPath === rootPath) {
    return null;
  }
  return directoryPath.startsWith(`${rootPath}/`) ? directoryPath : null;
}

function normalizeRootPath(path: string | null | undefined): string | null {
  const trimmed = path?.replace(/^\/+|\/+$/gu, "").trim() ?? "";
  return trimmed || null;
}

function filePathIsWithinRoot(filePath: string, rootPath: string | null): boolean {
  return !rootPath || filePath.startsWith(`${rootPath}/`);
}

function filesWithinRoot(files: readonly SurfaceSnapshotFile[], rootPath: string | null): SurfaceSnapshotFile[] {
  return files.filter((file) => filePathIsWithinRoot(file.path, rootPath));
}

function displayPathForFile(filePath: string, rootPath: string | null): string {
  return rootPath && filePath.startsWith(`${rootPath}/`)
    ? filePath.slice(rootPath.length + 1)
    : filePath;
}

function SourceBreadcrumbs({
  directoryPath,
  rootPath,
  onSelectDirectory,
}: {
  directoryPath: string | null;
  rootPath: string | null;
  onSelectDirectory: (directoryPath: string | null) => void;
}) {
  const relativeDirectoryPath = rootPath && directoryPath?.startsWith(`${rootPath}/`)
    ? directoryPath.slice(rootPath.length + 1)
    : directoryPath;
  const parts = relativeDirectoryPath?.split("/").filter(Boolean) ?? [];
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
      <button
        className="cursor-pointer rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
        onClick={() => onSelectDirectory(null)}
      >
        root
      </button>
      {parts.map((part, index) => {
        const relativePath = parts.slice(0, index + 1).join("/");
        const path = rootPath ? `${rootPath}/${relativePath}` : relativePath;
        return (
          <span className="contents" key={path}>
            <span aria-hidden="true" className="text-muted-foreground">/</span>
            <button
              className="cursor-pointer rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
              onClick={() => onSelectDirectory(path)}
            >
              {part}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function RepositoryRow({
  active,
  description,
  icon: Icon,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  description: string;
  icon: typeof FileTextIcon;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "true" : undefined}
      className={cn(
        "grid w-full min-w-0 cursor-pointer grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active ? "bg-muted/55" : "hover:bg-muted/35",
      )}
      type="button"
      onClick={onClick}
    >
      <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate font-medium text-foreground">{label}</span>
        <span className="truncate text-xs text-muted-foreground">{description}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
    </button>
  );
}

function fileMetaLabel(file: SurfaceSnapshotFile): string {
  if (file.kind === "binary" || file.encoding === "base64") {
    return "binary";
  }
  const content = "content" in file && typeof file.content === "string" ? file.content : "";
  const lines = content ? content.split(/\r\n|\r|\n/u).length : 0;
  return lines > 0 ? formatCount(lines, "line") : "text";
}

function PreviewModeButtons({
  onValueChange,
  value,
}: {
  onValueChange: (value: PreviewMode) => void;
  value: PreviewMode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label="File preview mode">
      {supportedPreviewModes().map((mode) => (
        <Button
          aria-pressed={value === mode}
          key={mode}
          size="xs"
          type="button"
          variant={value === mode ? "secondary" : "ghost"}
          onClick={() => onValueChange(mode)}
        >
          {mode.charAt(0).toUpperCase() + mode.slice(1)}
        </Button>
      ))}
    </div>
  );
}

function SourcePreviewBody({
  error,
  loading,
  preview,
}: {
  error: unknown;
  loading: boolean;
  preview: ReturnType<typeof surfaceFileToPreview> | null;
}) {
  if (loading && !preview) {
    return <p className="text-sm text-muted-foreground">Loading preview...</p>;
  }
  if (error && !preview) {
    return (
      <ProblemState
        icon={CircleAlertIcon}
        title="Couldn't load source preview"
        message={error instanceof Error ? error.message : String(error)}
        align="start"
      />
    );
  }
  if (!preview) {
    return <p className="text-sm text-muted-foreground">Loading preview...</p>;
  }
  return <PreviewPanel preview={preview} />;
}

function useInspectionFilePreview({
  apiBasePath,
  ownerKind,
  ownerId,
  path,
  previewMode,
  files,
}: {
  apiBasePath: string;
  ownerKind: WorkbenchFileOwnerKind;
  ownerId: string;
  path: string | null;
  previewMode: PreviewMode;
  files: readonly SurfaceSnapshotFile[];
}): {
  loading: boolean;
  error: string | null;
  preview: ReturnType<typeof surfaceFileToPreview> | null;
} {
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    preview: ReturnType<typeof surfaceFileToPreview> | null;
  }>({ loading: false, error: null, preview: null });

  useEffect(() => {
    const fileEntry = path ? files.find((file) => file.path === path) ?? null : null;
    if (!path || !fileEntry) {
      setState({ loading: false, error: null, preview: null });
      return;
    }
    const unavailableReason = workbenchInspectionFileContentUnavailableReason(fileEntry);
    if (unavailableReason) {
      setState({
        loading: false,
        error: null,
        preview: surfaceFileToPreview({
          path: fileEntry.path,
          kind: fileEntry.kind,
          encoding: fileEntry.encoding,
          executable: fileEntry.executable,
          unavailableReason,
        }, previewMode),
      });
      return;
    }
    if (fileEntry.content) {
      setState({
        loading: false,
        error: null,
        preview: surfaceFileToPreview(workbenchInspectionFileContent(fileEntry), previewMode),
      });
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setState({ loading: true, error: null, preview: null });
    void fetch(fileContentApiPath(apiBasePath, ownerKind, ownerId, path), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await response.text());
        }
        return await response.json() as WorkbenchInspectionFileContent;
      })
      .then((content) => {
        if (!cancelled) {
          setState({ loading: false, error: null, preview: surfaceFileToPreview(content, previewMode) });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && !controller.signal.aborted) {
          setState({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            preview: null,
          });
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBasePath, files, ownerId, ownerKind, path, previewMode]);

  return state;
}
