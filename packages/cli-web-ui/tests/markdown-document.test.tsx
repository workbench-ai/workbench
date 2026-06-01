import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { MarkdownDocumentView } from "../components/shared/markdown-document-view";
import { StreamingMarkdown } from "../components/shared/streaming-markdown";
import { parseMarkdownDocument } from "../lib/markdown-document";

describe("markdown document parsing", () => {
  test("splits frontmatter from the markdown body without interpreting field semantics", () => {
    const document = parseMarkdownDocument(`---
name: sample-skill
description: Build and verify the output.
allowed-tools:
  - Bash
  - Read
complex:
  nested: true
---

# Body heading

Actual body text.
`);

    expect(document.hasFrontmatter).toBe(true);
    expect(document.frontmatter).toBe(`name: sample-skill
description: Build and verify the output.
allowed-tools:
  - Bash
  - Read
complex:
  nested: true`);
    expect(document.body).toContain("# Body heading");
    expect(document.body).not.toContain("name: sample-skill");
  });
});

describe("markdown document view", () => {
  test("keeps unsafe markdown links out of static and streaming markup", () => {
    const unsafeContent = "[unsafe](javascript:alert(1)) [safe](https://example.com/docs)";
    const staticHtml = renderToStaticMarkup(
      createElement(MarkdownDocumentView, { content: unsafeContent }),
    );
    const streamingHtml = renderToStaticMarkup(
      createElement(StreamingMarkdown, { content: unsafeContent }),
    );

    expect(staticHtml).not.toContain("javascript:alert");
    expect(streamingHtml).not.toContain("javascript:alert");
    expect(staticHtml).toContain("unsafe [blocked]");
    expect(streamingHtml).toContain("unsafe [blocked]");
    expect(staticHtml).toContain("safe");
    expect(streamingHtml).toContain("safe");
  });

  test("renders frontmatter as metadata and keeps the body separate", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownDocumentView, {
        content: `---
name: sample-skill
description: Build and verify the output.
allowed-tools:
  - Bash
  - Read
---

# Body heading

Actual body text.
`,
      }),
    );

    expect(html).toContain("Frontmatter");
    expect(html).toContain(">yaml<");
    expect(html).toContain("name");
    expect(html).toContain("description");
    expect(html).toContain("allowed-tools");
    expect(html).toContain("- Bash");
    expect(html).toContain("- Read");
    expect(html).toContain("Body heading");
    expect(html).toContain("Actual body text.");
  });

  test("renders plain markdown without adding a metadata shell", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownDocumentView, {
        content: "# Plain document\n\nNothing special here.\n",
      }),
    );

    expect(html).toContain("Plain document");
    expect(html).toContain("Nothing special here.");
    expect(html).not.toContain("Frontmatter");
  });

  test("renders prompt-style markdown as prose and lists instead of one fenced code block", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownDocumentView, {
        content: `Build a historical model for \`/app/company.json\`.\n\nTreat \`/app\` as read-only.\n\nDeliverables:\n- One workbook\n- One checks sheet\n`,
      }),
    );

    expect(html).toContain("Build a historical model for");
    expect(html).toContain("/app/company.json");
    expect(html).toContain("Treat");
    expect(html).toContain("/app");
    expect(html).toContain("One workbook");
    expect(html).toContain("One checks sheet");
    expect(html).not.toContain('data-streamdown="code-block"');
  });
});
