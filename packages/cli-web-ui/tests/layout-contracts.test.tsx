import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { AppPageFrame } from "../components/shared/app-page-frame";
import { CodeBlockSurface } from "../components/shared/code-block-surface";
import {
  buildDesktopWorkspaceSplitLayout,
  DesktopWorkspaceSplit,
  DesktopWorkspaceSplitToggle,
} from "../components/shared/desktop-workspace-split";
import { DisclosurePanel } from "../components/shared/disclosure-panel";
import { FilesBrowser } from "../components/shared/files-browser";
import { PreviewPanel } from "../components/shared/preview-panel";
import { RouteToolbar } from "../components/shared/route-toolbar";
import { SourceEditorDialogShell } from "../components/shared/source-editor-dialog-shell";
import { SourceEditorSurface } from "../components/shared/source-editor-surface";
import { SourceMetadataCard } from "../components/shared/source-metadata-card";
import { TextBlockView } from "../components/shared/text-block-view";
import { ViewSwitch } from "../components/shared/view-switch";
import { WorkbenchBrand } from "../components/shared/workbench-brand";
import { WorkspacePane } from "../components/shared/workspace-pane";
import { WorkspaceRoot } from "../components/shared/workspace-root";
import { WorkspaceTopBar } from "../components/shared/workspace-top-bar";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "../components/ui/sidebar";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { VirtualizedListContent } from "../components/shared/virtualized-list";

describe("shared layout contracts", () => {
  test("pdf preview resolves its worker from the installed pdfjs-dist package", () => {
    const source = readFileSync(
      new URL("../components/shared/pdf-preview.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('from "pdfjs-dist"');
    expect(source).toContain('"pdfjs-dist/build/pdf.worker.min.mjs"');
    expect(source).toContain("import.meta.url");
    expect(source).toContain(
      "GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC",
    );
    expect(source).not.toContain("cdn.jsdelivr.net/npm/pdfjs-dist@");
  });

  test("split files browser exposes an h-full root for bounded preview surfaces", () => {
    const html = renderToStaticMarkup(
      createElement(FilesBrowser, {
        changes: [
          {
            path: "candidate.json",
            old_path: null,
            status: "modified",
            mime_type: "application/json",
            preview_kind: "text",
            additions: 1,
            deletions: 1,
          },
          {
            path: "reports/performance.pdf",
            old_path: null,
            status: "added",
            mime_type: "application/pdf",
            preview_kind: "pdf",
            additions: 0,
            deletions: 0,
          },
        ],
        selectedFilePath: "candidate.json",
        previewMode: "rendered",
        availablePreviewModes: ["rendered", "raw", "diff"],
        preview: null,
        changesError: null,
        previewError: null,
        layout: "split",
        onSelectFile: () => undefined,
        onPreviewModeChange: () => undefined,
      }),
    );

    expect(html).toContain('data-testid="files-browser"');
    expect(html).toContain(
      'class="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3"',
    );
    expect(html).toContain("grid-cols-[minmax(14rem,0.4fr)_minmax(0,1fr)]");
    expect(html).not.toContain("w-72 shrink-0");
    expect(html).toContain('data-slot="card"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
  });

  test("stacked files browser keeps previews internally scrollable", () => {
    const html = renderToStaticMarkup(
      createElement(FilesBrowser, {
        changes: [
          {
            path: "SKILL.md",
            old_path: null,
            status: "modified",
            mime_type: "text/markdown",
            preview_kind: "markdown",
            additions: 40,
            deletions: 0,
          },
        ],
        selectedFilePath: "SKILL.md",
        previewMode: "raw",
        availablePreviewModes: ["rendered", "raw"],
        preview: {
          path: "SKILL.md",
          view: "raw",
          mime_type: "text/markdown",
          preview_kind: "markdown",
          diff: null,
          source: {
            content: "# Long document\n\n".repeat(60),
            encoding: "utf8",
          },
          rendered_html: null,
        },
        changesError: null,
        previewError: null,
        layout: "stacked",
        onSelectFile: () => undefined,
        onPreviewModeChange: () => undefined,
      }),
    );
    const filesBrowserSource = readFileSync(
      new URL("../components/shared/files-browser.tsx", import.meta.url),
      "utf8",
    );
    const previewPanelSource = readFileSync(
      new URL("../components/shared/preview-panel.tsx", import.meta.url),
      "utf8",
    );
    const pdfPreviewSource = readFileSync(
      new URL("../components/shared/pdf-preview.tsx", import.meta.url),
      "utf8",
    );

    expect(html).toContain('data-fill-height="true"');
    expect(html).toContain("max-h-[min(18rem,35dvh)] shrink-0 overflow-y-auto");
    expect(html).toContain(
      "mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
    );
    expect(html).toContain("min-h-0 flex-1 overflow-y-auto overflow-x-hidden");
    expect(filesBrowserSource).toContain("fillHeight: true");
    expect(filesBrowserSource).not.toContain("fillHeight: isSplit");
    expect(previewPanelSource).toContain(
      'fillHeight && "flex min-h-0 flex-1 flex-col"',
    );
    expect(previewPanelSource).not.toContain(
      'fillHeight && "flex h-full min-h-0 flex-1 flex-col",',
    );
  });

  test("files browser can render a compact nested tree without product-specific code", () => {
    const renderFilesBrowser = (currentDirectory: string | null) =>
      renderToStaticMarkup(
        createElement(FilesBrowser, {
          changes: [
            {
              path: "packages/flow-panel/src/app.tsx",
              old_path: null,
              status: "modified",
              mime_type: "text/plain",
              preview_kind: "text",
              additions: 48,
              deletions: 14,
            },
            {
              path: "artifacts/report.csv",
              old_path: null,
              status: "added",
              mime_type: "text/csv",
              preview_kind: "text",
              additions: 4,
              deletions: 0,
            },
            {
              path: "docs/workflow-authoring.md",
              old_path: null,
              status: "added",
              mime_type: "text/markdown",
              preview_kind: "markdown",
              additions: 22,
              deletions: 0,
            },
          ],
          selectedFilePath: "docs/workflow-authoring.md",
          browseMode: "folders",
          currentDirectory,
          previewMode: "rendered",
          availablePreviewModes: ["rendered", "raw", "diff"],
          preview: null,
          changesError: null,
          previewError: null,
          layout: "split",
          onSelectFile: () => undefined,
          onDirectoryChange: () => undefined,
          onPreviewModeChange: () => undefined,
        }),
      );

    const rootHtml = renderFilesBrowser(null);
    expect(rootHtml).toContain('data-testid="files-browse-toolbar"');
    expect(rootHtml).toContain(">artifacts<");
    expect(rootHtml).toContain(">report.csv<");
    expect(rootHtml).toContain(">docs<");
    expect(rootHtml).toContain(">workflow-authoring.md<");
    expect(rootHtml).toContain(">packages<");
    expect(rootHtml).toContain('data-tree-kind="folder"');
    expect(rootHtml).toContain('data-tree-kind="file"');
    expect(rootHtml).toContain('style="padding-left:20px"');
    expect(rootHtml).not.toContain("Up one level");

    const docsHtml = renderFilesBrowser("docs");
    expect(docsHtml).toContain('data-testid="files-browse-toolbar"');
    expect(docsHtml).not.toContain('data-testid="files-directory-breadcrumb"');
    expect(docsHtml).toContain(">workflow-authoring.md<");
  });

  test("folder trees preserve the selected file ancestry", () => {
    const html = renderToStaticMarkup(
      createElement(FilesBrowser, {
        changes: [
          {
            path: "packages/flow-panel/src/app.tsx",
            old_path: null,
            status: "modified",
            mime_type: "text/plain",
            preview_kind: "text",
            additions: 48,
            deletions: 14,
          },
        ],
        selectedFilePath: "packages/flow-panel/src/app.tsx",
        browseMode: "folders",
        currentDirectory: "packages/flow-panel/src",
        previewMode: "rendered",
        availablePreviewModes: ["rendered", "raw", "diff"],
        preview: null,
        changesError: null,
        previewError: null,
        layout: "split",
        onSelectFile: () => undefined,
        onDirectoryChange: () => undefined,
        onPreviewModeChange: () => undefined,
      }),
    );

    expect(html).toContain('title="packages/flow-panel/src"');
    expect(html).toContain(">flow-panel<");
    expect(html).toContain(">src<");
    expect(html).toContain(">app.tsx<");
    expect(html).toContain('style="padding-left:52px"');
  });

  test("deep folder trees cap visual indentation while preserving path titles", () => {
    const html = renderToStaticMarkup(
      createElement(FilesBrowser, {
        changes: [
          {
            path: "candidate/s1-three-statement-model/references/sec/s-1/2024/tables/income/normalized.json",
            old_path: null,
            status: "modified",
            mime_type: "application/json",
            preview_kind: "text",
            additions: 12,
            deletions: 2,
          },
        ],
        selectedFilePath:
          "candidate/s1-three-statement-model/references/sec/s-1/2024/tables/income/normalized.json",
        browseMode: "folders",
        previewMode: "rendered",
        availablePreviewModes: ["rendered", "raw", "diff"],
        preview: null,
        changesError: null,
        previewError: null,
        layout: "split",
        onSelectFile: () => undefined,
        onDirectoryChange: () => undefined,
        onPreviewModeChange: () => undefined,
      }),
    );

    expect(html).toContain(">normalized.json<");
    expect(html).toContain(
      'title="candidate/s1-three-statement-model/references/sec/s-1/2024/tables/income/normalized.json"',
    );
    expect(html).toContain('style="padding-left:84px"');
    expect(html).not.toContain('style="padding-left:132px"');
  });

  test("spreadsheet previews route through the shared preview host", () => {
    const html = renderToStaticMarkup(
      createElement(PreviewPanel, {
        fillHeight: true,
        preview: {
          path: "models/statement.xlsx",
          view: "rendered",
          mime_type:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          preview_kind: "spreadsheet",
          diff: null,
          source: {
            content: "UEsDBA==",
            encoding: "base64",
          },
          rendered_html: null,
        },
      }),
    );

    expect(html).toContain('data-testid="preview-spreadsheet-loading"');
    expect(html).not.toContain('data-testid="preview-placeholder"');
  });

  test("shared preview loading states use skeletons without extra loading chrome", () => {
    const filesBrowserSource = readFileSync(
      new URL("../components/shared/files-browser.tsx", import.meta.url),
      "utf8",
    );
    const previewPanelSource = readFileSync(
      new URL("../components/shared/preview-panel.tsx", import.meta.url),
      "utf8",
    );
    const pdfPreviewSource = readFileSync(
      new URL("../components/shared/pdf-preview.tsx", import.meta.url),
      "utf8",
    );
    const spreadsheetPreviewSource = readFileSync(
      new URL("../components/shared/spreadsheet-file-preview.tsx", import.meta.url),
      "utf8",
    );
    const previewLoadingSource = readFileSync(
      new URL("../components/shared/preview-loading-state.tsx", import.meta.url),
      "utf8",
    );

    expect(filesBrowserSource).toContain("./preview-loading-state");
    expect(previewPanelSource).toContain("./preview-loading-state");
    expect(spreadsheetPreviewSource).toContain("./preview-loading-state");
    expect(previewLoadingSource).toContain('../ui/skeleton');
    expect(previewLoadingSource).toContain('aria-busy="true"');
    expect(previewLoadingSource).toContain('className="sr-only"');
    expect(previewLoadingSource).not.toContain('../ui/spinner');
    expect(previewLoadingSource).not.toContain("../ui/card");
    expect(previewLoadingSource).not.toContain("<Card");
    expect(pdfPreviewSource).toContain('../ui/skeleton');
    expect(pdfPreviewSource).not.toContain('../ui/spinner');
    expect(pdfPreviewSource).not.toContain("Rendering PDF preview");
    expect(filesBrowserSource).not.toContain("Loader2");
    expect(previewPanelSource).not.toContain("Loader2");
    expect(spreadsheetPreviewSource).not.toContain("Loader2");
  });

  test("single-select toggle groups expose grouped radio-item semantics", () => {
    const html = renderToStaticMarkup(
      createElement(
        ToggleGroup,
        {
          type: "single",
          value: "rendered",
          "aria-label": "File preview mode",
        },
        createElement(ToggleGroupItem, { value: "rendered" }, "Rendered"),
        createElement(ToggleGroupItem, { value: "raw" }, "Raw"),
      ),
    );

    expect(html).toContain('role="group"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
  });

  test("non-virtualized list content stays top aligned when it fills the viewport", () => {
    const html = renderToStaticMarkup(
      createElement(VirtualizedListContent, {
        items: [{ id: "candidate.json" }, { id: "reports/performance.pdf" }],
        getScrollElement: () => null,
        getItemKey: (item: { id: string }) => item.id,
        renderItem: (item: { id: string }) => item.id,
        contentClassName: "min-h-full",
        virtualizeThreshold: 10,
      }),
    );

    expect(html).toContain(
      'class="grid w-full min-w-0 auto-rows-max content-start min-h-full"',
    );
  });

  test("code block surfaces can own tab-height scrolling with one shell", () => {
    const html = renderToStaticMarkup(
      createElement(CodeBlockSurface, {
        value: "alpha\nbeta\n",
        fillHeight: true,
        testId: "code-surface",
      }),
    );

    expect(html).toContain('data-testid="code-surface"');
    expect(html).toContain(
      'class="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border/70 bg-background flex min-h-0 flex-1 flex-col"',
    );
    expect(html).toContain("overflow-y-auto overflow-x-hidden");
    expect(html).toContain("min-h-0 flex-1");
    expect(html).toContain('data-wrap-long-lines="true"');
    expect(html).toContain("<pre");
    expect(html).toContain("<code");
    expect(html).toContain("alpha\nbeta\n</code>");
  });

  test("plain code block surfaces stay shell-free inside parent surfaces", () => {
    const html = renderToStaticMarkup(
      createElement(CodeBlockSurface, {
        value: "alpha\nbeta\n",
        surface: "plain",
        testId: "plain-code-surface",
      }),
    );

    expect(html).toContain('data-testid="plain-code-surface"');
    expect(html).toContain(
      'class="w-full min-w-0 max-w-full overflow-visible bg-transparent p-0"',
    );
    expect(html).not.toContain("border-border/70");
  });

  test("code block surfaces hard-wrap long readonly lines by default", () => {
    const html = renderToStaticMarkup(
      createElement(CodeBlockSurface, {
        value: "command: node -e \"console.log('a very long command')\"",
        testId: "wrapped-code-surface",
      }),
    );

    expect(html).toContain('data-testid="wrapped-code-surface"');
    expect(html).toContain('data-wrap-long-lines="true"');
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("[overflow-wrap:anywhere]");

    const css = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");
    expect(css).toContain('.ai-code-view[data-wrap-long-lines="true"] .markdown-content :where(pre)');
    expect(css).toContain("white-space: pre-wrap");
    expect(css).toContain("overflow-wrap: anywhere");
  });

  test("text block views preserve whitespace and wrap long lines without an extra shell", () => {
    const html = renderToStaticMarkup(
      createElement(TextBlockView, {
        value: "alpha beta gamma",
        fillHeight: true,
        monospace: true,
        testId: "text-block",
      }),
    );

    expect(html).toContain('data-testid="text-block"');
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toContain("font-mono");
    expect(html).not.toContain("bg-muted/50");
  });

  test("disclosure panels share one stock collapsible shell across products", () => {
    const html = renderToStaticMarkup(
      createElement(
        DisclosurePanel,
        {
          title: "Raw JSON",
          description: "Expand supporting evidence.",
          aside: createElement("span", null, "1 file"),
          open: true,
        },
        createElement("div", null, "payload"),
      ),
    );

    expect(html).toContain('data-slot="collapsible"');
    expect(html).toContain("rounded-xl border border-border/60 bg-muted/20");
    expect(html).toContain("Raw JSON");
    expect(html).toContain("Expand supporting evidence.");
    expect(html).toContain("group-data-[state=open]:rotate-90");
    expect(html).toContain("border-t border-border/60 px-3 py-3");
    expect(html).toContain("payload");
  });

  test("dialog content is positioned independently of the overlay", () => {
    const source = readFileSync(
      new URL("../components/ui/dialog.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("left-1/2");
    expect(source).toContain("-translate-x-1/2");
    expect(source).toContain("max-w-[calc(100%-2rem)]");
  });

  test("route toolbars keep title, badges, and actions in one thin shared row", () => {
    const html = renderToStaticMarkup(
      createElement(RouteToolbar, {
        title: "Threads",
        leading: createElement("button", { type: "button" }, "Select harness"),
        actions: createElement("button", { type: "button" }, "Edit config"),
        badges: createElement("span", null, "Archive read only"),
      }),
    );

    expect(html).toContain('data-testid="route-toolbar"');
    expect(html).toContain("Threads");
    expect(html).toContain("Select harness");
    expect(html).toContain("Edit config");
    expect(html).toContain("Archive read only");
    expect(html).toContain("flex-row flex-wrap");
    expect(html).toContain("min-h-9");
    expect(html).toContain("items-center");
  });

  test("workspace roots use a full-height shell instead of a centered page frame", () => {
    const html = renderToStaticMarkup(
      createElement(
        WorkspaceRoot,
        {
          header: createElement("nav", null, "Flow"),
          mainId: "workspace-main",
          skipLinkLabel: "Skip to workspace",
        },
        createElement("div", null, "content"),
      ),
    );

    expect(html).toContain('href="#workspace-main"');
    expect(html).toContain("h-svh");
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("bg-background");
    expect(html).not.toContain("max-w-[1400px]");
    expect(html).toContain("<header");
    expect(html).toContain("border-b border-border/60");
  });

  test("workspace top bars expose one shared authenticated header row", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceTopBar, {
        brand: createElement("a", { href: "/dashboard" }, "Workbench"),
        actions: createElement("button", { type: "button" }, "Sign out"),
      }),
    );

    expect(html).toContain('data-testid="workspace-top-bar"');
    expect(html).not.toContain("max-w-[1600px]");
    expect(html).toContain("w-full");
    expect(html).toContain("min-w-0");
    expect(html).toContain("h-9");
    expect(html).toContain("items-center");
    expect(html).toContain("justify-between");
    expect(html).toContain("Sign out");
  });

  test("workspace panes own fixed headers, optional subnav, and pane scrolling", () => {
    const html = renderToStaticMarkup(
      createElement(
        WorkspacePane,
        {
          title: "Executions",
          leading: createElement("button", { type: "button" }, "Workflow"),
          badges: createElement("span", null, "3"),
          actions: createElement("button", { type: "button" }, "Run"),
          summary: createElement("p", null, "Current workflow summary"),
          subnav: createElement("div", null, "Board Timeline"),
        },
        createElement("div", null, "pane body"),
      ),
    );

    expect(html).toContain('data-pane-tone="primary"');
    expect(html).toContain('data-testid="route-toolbar"');
    expect(html).toContain("Current workflow summary");
    expect(html).toContain("Board Timeline");
    expect(html).toContain('data-slot="scroll-area"');
  });

  test("workspace panes use semantic tones for master-detail hierarchy", () => {
    const primaryHtml = renderToStaticMarkup(
      createElement(
        WorkspacePane,
        { title: "Candidates" },
        createElement("div", null, "detail"),
      ),
    );
    const secondaryHtml = renderToStaticMarkup(
      createElement(
        WorkspacePane,
        { title: "Spec", tone: "secondary" },
        createElement("div", null, "master"),
      ),
    );

    expect(primaryHtml).toContain("bg-background");
    expect(primaryHtml).not.toContain("bg-muted/20");
    expect(secondaryHtml).toContain('data-pane-tone="secondary"');
    expect(secondaryHtml).toContain("bg-muted/20");
    expect(secondaryHtml).toContain("bg-muted/35");
  });

  test("desktop workspace splits compose the shared resizable foundation instead of custom pointer math", () => {
    const source = readFileSync(
      new URL("../components/shared/desktop-workspace-split.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("ResizablePanelGroup");
    expect(source).toContain("ResizablePanel");
    expect(source).toContain("ResizableHandle");
    expect(source).toContain("groupRef");
    expect(source).toContain("defaultLayout={layout}");
    expect(source).toContain("data-workspace-split-panel");
    expect(source).toContain("transition-[flex-grow]");
    expect(source).not.toContain("setTimeout");
    expect(source).not.toContain("window.addEventListener(\"pointermove\"");
    expect(source).not.toContain("document.body.style.cursor = \"col-resize\"");
  });

  test("desktop workspace split builds an explicit layout for fresh open and closed mounts", () => {
    expect(buildDesktopWorkspaceSplitLayout({
      paneOpen: true,
      primaryPercent: 56,
      minPrimaryPercent: 40,
      maxPrimaryPercent: 68,
      secondaryPaneId: "detail-pane",
    })).toEqual({
      "workspace-primary-pane": 56,
      "detail-pane": 44,
    });

    expect(buildDesktopWorkspaceSplitLayout({
      paneOpen: true,
      primaryPercent: 5,
      minPrimaryPercent: 40,
      maxPrimaryPercent: 68,
      secondaryPaneId: "detail-pane",
    })).toEqual({
      "workspace-primary-pane": 40,
      "detail-pane": 60,
    });

    expect(buildDesktopWorkspaceSplitLayout({
      paneOpen: false,
      primaryPercent: 56,
      minPrimaryPercent: 40,
      maxPrimaryPercent: 68,
      secondaryPaneId: "detail-pane",
    })).toEqual({
      "workspace-primary-pane": 100,
      "detail-pane": 0,
    });
  });

  test("desktop workspace split exposes a separator and secondary pane contract", () => {
    const html = renderToStaticMarkup(
      createElement(DesktopWorkspaceSplit, {
        paneOpen: true,
        primaryPercent: 56,
        minPrimaryPercent: 40,
        maxPrimaryPercent: 68,
        onPrimaryPercentChange: () => undefined,
        primaryPane: createElement("div", null, "left"),
        secondaryPane: createElement("div", null, "right"),
        secondaryPaneId: "detail-pane",
        separatorLabel: "Resize detail pane",
      }),
    );

    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Resize detail pane"');
    expect(html).toContain('id="detail-pane"');
    expect(html).toContain("left");
    expect(html).toContain("right");
  });

  test("desktop workspace split toggles use one shared show-hide button contract", () => {
    const closedHtml = renderToStaticMarkup(
      createElement(DesktopWorkspaceSplitToggle, {
        paneOpen: false,
        openLabel: "Show detail pane",
        closeLabel: "Hide detail pane",
        openText: "Details",
        onClick: () => undefined,
        testId: "detail-pane-toggle",
      }),
    );
    const openHtml = renderToStaticMarkup(
      createElement(DesktopWorkspaceSplitToggle, {
        paneOpen: true,
        openLabel: "Show detail pane",
        closeLabel: "Hide detail pane",
        openText: "Details",
        onClick: () => undefined,
        testId: "detail-pane-toggle",
      }),
    );

    expect(closedHtml).toContain('data-testid="detail-pane-toggle"');
    expect(closedHtml).toContain('aria-label="Show detail pane"');
    expect(closedHtml).toContain(">Details</span>");
    expect(closedHtml).toContain('data-size="sm"');
    expect(openHtml).toContain('aria-label="Hide detail pane"');
    expect(openHtml).toContain("sr-only");
    expect(openHtml).toContain('data-size="icon-sm"');
  });

  test("view switches share the stock line-tabs treatment for sibling views", () => {
    const html = renderToStaticMarkup(
      createElement(ViewSwitch, {
        ariaLabel: "Runtime views",
        value: "archive",
        fullWidth: true,
        testId: "runtime-view-switch",
        items: [
          { value: "archive", label: "Archive", testId: "view-switch-archive" },
          { value: "lineage", label: "Lineage" },
        ],
        onValueChange: () => undefined,
      }),
    );

    expect(html).toContain('data-testid="runtime-view-switch"');
    expect(html).toContain('data-slot="tabs-list"');
    expect(html).toContain('data-variant="line"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Runtime views"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('data-testid="view-switch-archive"');
    expect(html).toContain("gap-1");
  });

  test("workbench brands share one compact heading treatment across products", () => {
    const html = renderToStaticMarkup(
      createElement(WorkbenchBrand, {
        product: "Workbench",
      }),
    );

    expect(html).toContain("Workbench");
    expect(html).toContain("text-lg");
    expect(html).toContain("font-medium");
    expect(html).toContain("tracking-tight");
  });

  test("inspector dialog shells keep large read-only overlays centered with one shared geometry contract", () => {
    const source = readFileSync(
      new URL(
        "../components/shared/inspector-dialog-shell.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toContain("h-[min(94vh,calc(100dvh-1rem))]");
    expect(source).toContain("gap-0");
    expect(source).toContain("sm:max-w-[min(96rem,calc(100vw-2rem))]");
    expect(source).toContain(
      '"min-h-0 overflow-x-hidden overflow-y-hidden px-4 py-4 sm:px-6 sm:py-6"',
    );
    expect(source).toContain("bodyClassName");
    expect(source).not.toContain(
      '"flex h-full min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6 sm:py-6"',
    );
  });

  test("source editor surfaces participate in flex-height layouts instead of collapsing under 100% height", () => {
    const html = renderToStaticMarkup(
      createElement(SourceEditorSurface, {
        value: "alpha\nbeta\n",
        language: "markdown",
        height: "100%",
      }),
    );

    expect(html).toContain(
      "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl",
    );
    expect(html).toContain('data-language="markdown"');
  });

  test("app page frames can expose one shared skip-link and main region contract", () => {
    const html = renderToStaticMarkup(
      createElement(
        AppPageFrame,
        {
          header: createElement("div", null, "Header"),
          mainId: "surface-root",
          skipLinkLabel: "Skip to content",
        },
        createElement("div", null, "Body"),
      ),
    );

    expect(html).toContain('href="#surface-root"');
    expect(html).toContain('id="surface-root"');
    expect(html).toContain("Skip to content");
    expect(html).toContain("Header");
    expect(html).toContain("Body");
  });

  test("sidebar shells expose the stock dashboard wrapper, trigger, and inset contract", () => {
    const html = renderToStaticMarkup(
      createElement(
        SidebarProvider,
        null,
        createElement(
          Sidebar,
          { variant: "inset" },
          createElement(
            SidebarContent,
            null,
            createElement(
              SidebarGroup,
              null,
              createElement(SidebarGroupLabel, null, "Navigation"),
              createElement(
                SidebarGroupContent,
                null,
                createElement(
                  SidebarMenu,
                  null,
                  createElement(
                    SidebarMenuItem,
                    null,
                    createElement(
                      SidebarMenuButton,
                      { isActive: true },
                      "Threads",
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        createElement(
          SidebarInset,
          null,
          createElement(SidebarTrigger, null),
          createElement("div", null, "Surface"),
        ),
      ),
    );

    expect(html).toContain('data-slot="sidebar-wrapper"');
    expect(html).toContain('data-slot="sidebar-trigger"');
    expect(html).toContain('data-slot="sidebar-inset"');
    expect(html).toContain("Threads");
    expect(html).toContain("Surface");
  });

  test("source editor dialog shell can be constructed in the shared package test environment", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(SourceEditorDialogShell, {
          open: true,
          onOpenChange: () => undefined,
          title: "Workspace config",
          description: "Edit raw YAML.",
          metadata: createElement("div", null, "Source file"),
          editor: createElement(
            "div",
            { "data-testid": "editor-body" },
            "Editor",
          ),
          errorMessage: "Invalid config",
          footer: createElement("div", null, "Save config"),
          testId: "editor-shell",
        }),
      ),
    ).not.toThrow();
  });

  test("source metadata cards render shared source-file framing", () => {
    const html = renderToStaticMarkup(
      createElement(SourceMetadataCard, {
        sourcePath: ".workbench/config.yaml",
        header: createElement("span", null, "Authored config"),
        children: createElement("div", null, "Extra detail"),
      }),
    );

    expect(html).toContain("Authored config");
    expect(html).toContain("Source file");
    expect(html).toContain(".workbench/config.yaml");
    expect(html).toContain("Extra detail");
  });

  test("spreadsheet viewer css is loaded by the host app shell", () => {
    const componentSource = readFileSync(
      new URL("../components/shared/spreadsheet-viewer.tsx", import.meta.url),
      "utf8",
    );

    expect(componentSource).not.toContain("spreadsheet-viewer.css");
  });
});
