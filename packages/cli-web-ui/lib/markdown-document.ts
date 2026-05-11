export interface MarkdownDocumentData {
  body: string;
  frontmatter: string | null;
  hasFrontmatter: boolean;
}

export function parseMarkdownDocument(source: string): MarkdownDocumentData {
  const frontmatter = splitFrontmatter(source);
  if (!frontmatter) {
    return {
      body: source,
      frontmatter: null,
      hasFrontmatter: false,
    };
  }

  return {
    body: frontmatter.body,
    frontmatter: frontmatter.raw,
    hasFrontmatter: true,
  };
}

function splitFrontmatter(source: string): { raw: string; body: string } | null {
  const normalized = source.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return null;
  }

  const closingFenceIndex = normalized.indexOf("\n---\n", 4);
  if (closingFenceIndex === -1) {
    return null;
  }

  return {
    raw: normalized.slice(4, closingFenceIndex),
    body: normalized.slice(closingFenceIndex + 5),
  };
}
