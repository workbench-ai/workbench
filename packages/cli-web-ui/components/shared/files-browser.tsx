import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileIcon,
  FileEdit,
  FileInput,
  FilePlus,
  FileQuestion,
  FileX,
  Folder,
  FolderOpen,
} from "lucide-react";

import type {
  FileChangeSummary,
  FilePreviewData,
  PreviewMode,
} from "../../lib/file-preview";
import {
  formatChangeDisplayLabel,
  formatChangeLabel,
  isPreviewMode,
} from "../../lib/file-preview";
import { cn } from "../../lib/utils";
import { Alert } from "../ui/alert";
import { Card } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { Separator } from "../ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { EmptyState } from "./empty-state";
import { PreviewLoadingState } from "./preview-loading-state";
import { PreviewPanel } from "./preview-panel";
import { VirtualizedScrollAreaList } from "./virtualized-list";

export type FileBrowseMode = "list" | "folders";

const fileStatusIcons: Record<string, typeof FilePlus> = {
  added: FilePlus,
  modified: FileEdit,
  deleted: FileX,
  renamed: FileInput,
  unchanged: FileIcon,
};

const filesListRowLayoutClassName =
  "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5";

const filesTreeRowLayoutClassName =
  "grid grid-cols-[1rem_auto_minmax(0,1fr)] items-center gap-1";

type FileTreeNode = {
  name: string;
  path: string;
  children: Map<string, FileTreeNode>;
  item: FilePreviewListItem | null;
};

export interface FilePreviewListItem {
  key: string;
  label: ReactNode;
  title?: string;
  description?: ReactNode;
  meta?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  onSelect?: () => void;
  treeDepth?: number;
  treeKind?: "file" | "folder";
  treeExpanded?: boolean;
}

export interface FilePreviewBrowserProps {
  items: FilePreviewListItem[];
  selectedItemKey: string | null;
  browseMode?: FileBrowseMode;
  currentDirectory?: string | null;
  previewMode: PreviewMode;
  availablePreviewModes: PreviewMode[];
  preview: FilePreviewData | null;
  itemsError: unknown;
  previewError: unknown;
  isItemsLoading?: boolean;
  isPreviewLoading?: boolean;
  layout?: "stacked" | "split";
  notice?: ReactNode;
  toolbarAction?: ReactNode;
  emptyMessage?: string;
  emptySelectionMessage?: string;
  listErrorMessage?: string;
  previewErrorMessage?: string;
  onSelectItem: (itemKey: string) => void;
  onDirectoryChange?: (directory: string | null) => void;
  onPreviewModeChange: (mode: PreviewMode) => void;
}

interface FilesBrowserProps {
  changes: FileChangeSummary[];
  selectedFilePath: string | null;
  browseMode?: FileBrowseMode;
  currentDirectory?: string | null;
  previewMode: PreviewMode;
  availablePreviewModes: PreviewMode[];
  preview: FilePreviewData | null;
  changesError: unknown;
  previewError: unknown;
  isChangesLoading?: boolean;
  isPreviewLoading?: boolean;
  layout?: "stacked" | "split";
  notice?: ReactNode;
  toolbarAction?: ReactNode;
  emptyMessage?: string;
  emptySelectionMessage?: string;
  listErrorMessage?: string;
  previewErrorMessage?: string;
  onSelectFile: (filePath: string) => void;
  onDirectoryChange?: (directory: string | null) => void;
  onPreviewModeChange: (mode: PreviewMode) => void;
}

export function FilesBrowser({
  changes,
  selectedFilePath,
  browseMode = "list",
  currentDirectory = null,
  previewMode,
  availablePreviewModes,
  preview,
  changesError,
  previewError,
  isChangesLoading = false,
  isPreviewLoading = false,
  layout = "stacked",
  notice,
  toolbarAction,
  emptyMessage = "No files detected",
  emptySelectionMessage = "Select a file to preview",
  listErrorMessage = "Couldn't load the file list.",
  previewErrorMessage = "Couldn't load the selected file preview.",
  onSelectFile,
  onDirectoryChange,
  onPreviewModeChange,
}: FilesBrowserProps) {
  return (
    <FilePreviewBrowser
      items={changes.map((change) => {
        const changeLabel = formatChangeLabel(change);
        return {
          key: change.path,
          label: formatChangeDisplayLabel(change),
          title: changeLabel,
          meta: (
            <>
              <span className="capitalize">{change.status}</span>
              <span aria-hidden="true">·</span>
              <span>{`+${change.additions} / -${change.deletions}`}</span>
            </>
          ),
          icon: fileStatusIcons[change.status] ?? FileEdit,
        };
      })}
      selectedItemKey={selectedFilePath}
      browseMode={browseMode}
      currentDirectory={currentDirectory}
      previewMode={previewMode}
      availablePreviewModes={availablePreviewModes}
      preview={preview}
      itemsError={changesError}
      previewError={previewError}
      isItemsLoading={isChangesLoading}
      isPreviewLoading={isPreviewLoading}
      layout={layout}
      notice={notice}
      toolbarAction={toolbarAction}
      emptyMessage={emptyMessage}
      emptySelectionMessage={emptySelectionMessage}
      listErrorMessage={listErrorMessage}
      previewErrorMessage={previewErrorMessage}
      onSelectItem={onSelectFile}
      onDirectoryChange={onDirectoryChange}
      onPreviewModeChange={onPreviewModeChange}
    />
  );
}

export function FilePreviewBrowser({
  items,
  selectedItemKey,
  browseMode = "list",
  currentDirectory = null,
  previewMode,
  availablePreviewModes,
  preview,
  itemsError,
  previewError,
  isItemsLoading = false,
  isPreviewLoading = false,
  layout = "stacked",
  notice,
  toolbarAction,
  emptyMessage = "No files detected",
  emptySelectionMessage = "Select a file to preview",
  listErrorMessage = "Couldn't load the file list.",
  previewErrorMessage = "Couldn't load the selected file preview.",
  onSelectItem,
  onDirectoryChange,
  onPreviewModeChange,
}: FilePreviewBrowserProps) {
  const isSplit = layout === "split";
  const normalizedBrowseMode = normalizeFileBrowseMode(browseMode);
  const normalizedDirectory = normalizeDirectoryPath(currentDirectory);
  const defaultExpandedDirectories = useMemo(
    () =>
      normalizedBrowseMode === "folders"
        ? getDefaultExpandedDirectories({
            items,
            selectedItemKey,
            currentDirectory: normalizedDirectory,
          })
        : new Set<string>(),
    [items, normalizedBrowseMode, normalizedDirectory, selectedItemKey],
  );
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    () => defaultExpandedDirectories,
  );

  useEffect(() => {
    if (normalizedBrowseMode !== "folders") {
      return;
    }
    setExpandedDirectories((current) => {
      let changed = false;
      const next = new Set(current);
      for (const directory of defaultExpandedDirectories) {
        if (!next.has(directory)) {
          next.add(directory);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [defaultExpandedDirectories, normalizedBrowseMode]);

  const visibleItems =
    normalizedBrowseMode === "folders"
      ? buildFileTreeItems({
          items,
          expandedDirectories,
          onDirectoryChange,
          onToggleDirectory: (directory) => {
            setExpandedDirectories((current) => {
              const next = new Set(current);
              if (next.has(directory)) {
                next.delete(directory);
                onDirectoryChange?.(parentDirectoryPath(directory));
              } else {
                next.add(directory);
                onDirectoryChange?.(directory);
              }
              return next;
            });
          },
        })
      : items;
  const showPreviewLoading =
    selectedItemKey != null && isPreviewLoading && preview == null;

  const previewContent = resolvePreviewContent({
    fillHeight: true,
    showLoading: (isSplit && isItemsLoading) || showPreviewLoading,
    preview,
    previewError,
    previewErrorMessage,
    emptySelectionMessage,
  });

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3"
      data-testid="files-browser"
    >
      {notice}
      <Card
        size="sm"
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden border border-border py-0 ring-0"
      >
        {isSplit ? (
          <div className="grid min-h-0 min-w-0 flex-1 overflow-hidden grid-cols-[minmax(14rem,0.4fr)_minmax(0,1fr)]">
            <aside className="flex min-h-0 min-w-0 flex-col border-r border-border/60">
              <FilesListToolbar
                browseMode={normalizedBrowseMode}
              />
              <FilesItemList
                items={visibleItems}
                selectedItemKey={selectedItemKey}
                itemsError={itemsError}
                isLoading={isItemsLoading}
                isSplit
                emptyMessage={emptyMessage}
                listErrorMessage={listErrorMessage}
                onSelectItem={onSelectItem}
              />
            </aside>
            <FilesPreviewSection
              className="flex-1 min-h-0 min-w-0"
              previewMode={previewMode}
              availablePreviewModes={availablePreviewModes}
              toolbarAction={toolbarAction}
              onPreviewModeChange={onPreviewModeChange}
            >
              {previewContent}
            </FilesPreviewSection>
          </div>
        ) : (
          <>
            <div className="max-h-[min(18rem,35dvh)] shrink-0 overflow-y-auto">
              <FilesListToolbar
                browseMode={normalizedBrowseMode}
              />
              <FilesItemList
                items={visibleItems}
                selectedItemKey={selectedItemKey}
                itemsError={itemsError}
                isLoading={isItemsLoading}
                emptyMessage={emptyMessage}
                listErrorMessage={listErrorMessage}
                onSelectItem={onSelectItem}
              />
            </div>
            <Separator className="shrink-0" />
            <FilesPreviewSection
              className="flex-1 min-h-0 min-w-0"
              previewMode={previewMode}
              availablePreviewModes={availablePreviewModes}
              toolbarAction={toolbarAction}
              onPreviewModeChange={onPreviewModeChange}
            >
              {previewContent}
            </FilesPreviewSection>
          </>
        )}
      </Card>
    </div>
  );
}

function FilesListToolbar({
  browseMode,
}: {
  browseMode: FileBrowseMode;
}) {
  if (browseMode !== "folders") {
    return null;
  }

  return (
    <div
      className="flex shrink-0 items-center border-b border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground"
      data-testid="files-browse-toolbar"
    >
      Files
    </div>
  );
}

function resolvePreviewContent({
  fillHeight,
  showLoading,
  preview,
  previewError,
  previewErrorMessage,
  emptySelectionMessage,
}: {
  fillHeight: boolean;
  showLoading: boolean;
  preview: FilePreviewData | null;
  previewError: unknown;
  previewErrorMessage: string;
  emptySelectionMessage: string;
}): ReactNode {
  if (showLoading) {
    return <PreviewLoadingState />;
  }

  if (previewError != null && preview == null) {
    return (
      <TransportErrorState
        error={previewError}
        message={previewErrorMessage}
        testId="preview-load-error"
      />
    );
  }

  if (preview) {
    return <PreviewPanel preview={preview} fillHeight={fillHeight} />;
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground",
        fillHeight ? "min-h-0 flex-1 p-8" : "min-h-40 p-6",
      )}
    >
      {emptySelectionMessage}
    </div>
  );
}

function FilesPreviewSection({
  previewMode,
  availablePreviewModes,
  toolbarAction,
  onPreviewModeChange,
  children,
  className,
}: {
  previewMode: PreviewMode;
  availablePreviewModes: PreviewMode[];
  toolbarAction?: ReactNode;
  onPreviewModeChange: (mode: PreviewMode) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tabs
      value={previewMode}
      onValueChange={(value) => {
        if (isPreviewMode(value)) {
          onPreviewModeChange(value);
        }
      }}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden",
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <TabsList aria-label="File preview mode" className="max-w-full">
          {availablePreviewModes.map((mode) => (
            <TabsTrigger key={mode} value={mode}>
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>
        {toolbarAction ? <div className="shrink-0">{toolbarAction}</div> : null}
      </div>
      <TabsContent
        value={previewMode}
        className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-4 py-3">
          {children}
        </div>
      </TabsContent>
    </Tabs>
  );
}

function FilesItemList({
  items,
  selectedItemKey,
  itemsError,
  isLoading,
  isSplit = false,
  emptyMessage,
  listErrorMessage,
  onSelectItem,
}: {
  items: FilePreviewListItem[];
  selectedItemKey: string | null;
  itemsError: unknown;
  isLoading: boolean;
  isSplit?: boolean;
  emptyMessage: string;
  listErrorMessage: string;
  onSelectItem: (itemKey: string) => void;
}) {
  if (isLoading) {
    return (
      <div className={cn(isSplit ? "min-h-0 flex-1 p-1.5" : undefined)}>
        <FilesListLoadingState />
      </div>
    );
  }

  if (itemsError != null) {
    return (
      <div className={cn(isSplit ? "min-h-0 flex-1 p-1.5" : undefined)}>
        <TransportErrorState
          error={itemsError}
          message={listErrorMessage}
          testId="files-load-error"
        />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className={cn(
          isSplit ? "grid min-h-0 flex-1 place-items-center p-3" : undefined,
        )}
      >
        <EmptyState icon={FileQuestion} message={emptyMessage} />
      </div>
    );
  }

  if (!isSplit) {
    return (
      <div className="grid gap-0.5">
        {items.map((item) => (
          <FileListItemRow
            key={item.key}
            item={item}
            isActive={selectedItemKey === item.key}
            onClick={() =>
              item.onSelect ? item.onSelect() : onSelectItem(item.key)
            }
          />
        ))}
      </div>
    );
  }

  return (
    <VirtualizedScrollAreaList
      items={items}
      getItemKey={(item) => item.key}
      renderItem={(item) => (
        <FileListItemRow
          item={item}
          isActive={selectedItemKey === item.key}
          onClick={() =>
            item.onSelect ? item.onSelect() : onSelectItem(item.key)
          }
        />
      )}
      estimateSize={(item) => (item.treeKind ? 26 : 52)}
      gap={0}
      className="flex-1 min-h-0"
      contentClassName="min-h-full"
      itemClassName={(item) => (item.treeKind ? "px-1" : "px-1.5")}
      topPadding={6}
      bottomPadding={6}
      testId="files-change-list"
      viewportTestId="files-change-list-viewport"
    />
  );
}

function buildFileTreeItems({
  items,
  expandedDirectories,
  onDirectoryChange,
  onToggleDirectory,
}: {
  items: FilePreviewListItem[];
  expandedDirectories: Set<string>;
  onDirectoryChange?: (directory: string | null) => void;
  onToggleDirectory: (directory: string) => void;
}): FilePreviewListItem[] {
  const root = createFileTreeRoot();

  for (const item of items) {
    const path = normalizeFilePath(item.key);
    if (!path) {
      continue;
    }

    insertFileTreeItem(root, path, item);
  }

  const treeItems: FilePreviewListItem[] = [];

  for (const child of sortFileTreeNodes([...root.children.values()])) {
    appendFileTreeNode({
      node: child,
      depth: 0,
      expandedDirectories,
      onDirectoryChange,
      onToggleDirectory,
      treeItems,
    });
  }

  return treeItems;
}

function createFileTreeRoot(): FileTreeNode {
  return {
    name: "",
    path: "",
    children: new Map(),
    item: null,
  };
}

function insertFileTreeItem(
  root: FileTreeNode,
  path: string,
  item: FilePreviewListItem,
) {
  const segments = path.split("/").filter(Boolean);
  let cursor = root;

  segments.forEach((segment, index) => {
    const childPath = segments.slice(0, index + 1).join("/");
    const existing = cursor.children.get(segment);
    const child =
      existing ??
      {
        name: segment,
        path: childPath,
        children: new Map<string, FileTreeNode>(),
        item: null,
      };

    if (!existing) {
      cursor.children.set(segment, child);
    }

    if (index === segments.length - 1) {
      child.item = item;
    }

    cursor = child;
  });
}

function appendFileTreeNode({
  node,
  depth,
  expandedDirectories,
  onDirectoryChange,
  onToggleDirectory,
  treeItems,
}: {
  node: FileTreeNode;
  depth: number;
  expandedDirectories: Set<string>;
  onDirectoryChange?: (directory: string | null) => void;
  onToggleDirectory: (directory: string) => void;
  treeItems: FilePreviewListItem[];
}) {
  const hasChildren = node.children.size > 0;
  const isDirectory = hasChildren;

  if (isDirectory) {
    const isExpanded = expandedDirectories.has(node.path);
    treeItems.push({
      key: `folder:${node.path}`,
      label: node.name,
      title: node.path,
      icon: isExpanded ? FolderOpen : Folder,
      onSelect: () => {
        onToggleDirectory(node.path);
      },
      treeDepth: depth,
      treeKind: "folder",
      treeExpanded: isExpanded,
    });

    if (!isExpanded) {
      return;
    }

    for (const child of sortFileTreeNodes([...node.children.values()])) {
      appendFileTreeNode({
        node: child,
        depth: depth + 1,
        expandedDirectories,
        onDirectoryChange,
        onToggleDirectory,
        treeItems,
      });
    }
    return;
  }

  if (!node.item) {
    return;
  }

  treeItems.push({
    ...node.item,
    label: node.name,
    description: undefined,
    meta: undefined,
    title: node.item.title ?? node.path,
    icon: node.item.icon ?? FileIcon,
    onSelect: node.item.onSelect,
    treeDepth: depth,
    treeKind: "file",
  });
}

function sortFileTreeNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.sort((left, right) => {
    const leftIsDirectory = left.children.size > 0;
    const rightIsDirectory = right.children.size > 0;
    if (leftIsDirectory !== rightIsDirectory) {
      return leftIsDirectory ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function getDefaultExpandedDirectories({
  items,
  selectedItemKey,
  currentDirectory,
}: {
  items: FilePreviewListItem[];
  selectedItemKey: string | null;
  currentDirectory: string | null;
}): Set<string> {
  const expanded = new Set<string>();

  for (const item of items) {
    const path = normalizeFilePath(item.key);
    const firstSegment = path.split("/").filter(Boolean).at(0);
    if (firstSegment) {
      expanded.add(firstSegment);
    }
  }

  addAncestorDirectories(expanded, selectedItemKey, false);
  addAncestorDirectories(expanded, currentDirectory, true);

  if (currentDirectory) {
    expanded.add(currentDirectory);
  }

  return expanded;
}

function addAncestorDirectories(
  expanded: Set<string>,
  value: string | null | undefined,
  includeSelf: boolean,
) {
  const path = normalizeFilePath(value ?? "");
  const segments = path.split("/").filter(Boolean);
  const limit = includeSelf ? segments.length : segments.length - 1;

  for (let index = 0; index < limit; index += 1) {
    expanded.add(segments.slice(0, index + 1).join("/"));
  }
}

function normalizeFileBrowseMode(value: FileBrowseMode): FileBrowseMode {
  return value === "folders" ? "folders" : "list";
}

function normalizeDirectoryPath(value: string | null | undefined): string | null {
  const normalized = normalizeFilePath(value ?? "");
  return normalized || null;
}

function normalizeFilePath(value: string): string {
  return value.replace(/^\/+/u, "").replace(/\/+$/u, "");
}

function parentDirectoryPath(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const segments = value.split("/").filter(Boolean);
  segments.pop();
  return segments.length ? segments.join("/") : null;
}

function FilesListLoadingState() {
  return (
    <div className="grid gap-1 p-1" data-testid="files-loading-state">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className={cn(filesListRowLayoutClassName, "px-2.5 py-2")}
        >
          <Skeleton className="row-span-2 mt-0.5 h-3.5 w-3.5 rounded" />
          <div className="min-w-0">
            <Skeleton className="h-4 w-full max-w-[10rem]" />
            <Skeleton className="mt-1 h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

function FileListItemRow({
  item,
  isActive,
  onClick,
}: {
  item: FilePreviewListItem;
  isActive: boolean;
  onClick: () => void;
}) {
  const ItemIcon = item.icon ?? FileEdit;
  const itemTitle = item.title ?? (typeof item.label === "string" ? item.label : undefined);
  const isTreeRow = item.treeKind != null;
  const isFolder = item.treeKind === "folder";
  const TreeChevron = item.treeExpanded ? ChevronDown : ChevronRight;

  return (
    <button
      type="button"
      data-active={isActive ? "true" : undefined}
      data-tree-kind={item.treeKind}
      aria-expanded={isFolder ? item.treeExpanded : undefined}
      className={cn(
        "block w-full min-w-0 border border-transparent bg-transparent text-left text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring hover:bg-muted/45 data-[active=true]:bg-accent/45",
        isTreeRow
          ? cn(
              filesTreeRowLayoutClassName,
              "rounded-md py-0.5 pr-1.5 leading-5",
            )
          : cn(filesListRowLayoutClassName, "rounded-xl px-2.5 py-2"),
      )}
      data-testid="files-change-row"
      onClick={onClick}
      title={itemTitle}
      style={
        isTreeRow
          ? { paddingLeft: `${getTreeIndentPx(item.treeDepth ?? 0)}px` }
          : undefined
      }
    >
      {isTreeRow ? (
        isFolder ? (
          <TreeChevron
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        ) : (
          <span aria-hidden="true" className="size-3.5" />
        )
      ) : null}
      <ItemIcon
        className={cn(
          "shrink-0 text-muted-foreground",
          isTreeRow ? "size-3.5" : "row-span-2 mt-0.5 size-3.5",
        )}
      />
      <div className="min-w-0 self-center">
        <div
          className={cn(
            "min-w-0 font-medium text-foreground",
            isTreeRow
              ? "truncate text-[0.8rem] leading-5"
              : "break-words [overflow-wrap:anywhere]",
          )}
          data-testid="files-change-label"
          title={itemTitle}
        >
          {item.label}
        </div>
        {item.description ? (
          <div
            className="min-w-0 break-words font-mono text-[0.68rem] leading-4 text-muted-foreground [overflow-wrap:anywhere]"
            data-testid="files-item-description"
          >
            {item.description}
          </div>
        ) : null}
        {item.meta ? (
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
            data-testid="files-change-status"
          >
            {item.meta}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function getTreeIndentPx(depth: number): number {
  return 4 + Math.min(depth, 5) * 16;
}

function TransportErrorState({
  error,
  message,
  testId,
}: {
  error: unknown;
  message: string;
  testId: string;
}) {
  return (
    <Alert variant="destructive" data-testid={testId}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="grid gap-1">
          <div className="font-medium text-foreground">{message}</div>
          <div className="text-xs text-muted-foreground">
            {formatErrorMessage(error)}
          </div>
        </div>
      </div>
    </Alert>
  );
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "Unknown error";
}
