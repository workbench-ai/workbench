export function basename(filePath: string): string {
  const normalized = filePath.replace(/[?#].*$/u, "");
  const segments = normalized.split(/[\\/]/u).filter(Boolean);
  return segments.at(-1) ?? "download";
}

export function contentDispositionFilename(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const utf8Match = value.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/iu);
  if (utf8Match) {
    const encoded = trimDispositionValue(utf8Match[1] ?? "");
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  const fallbackMatch = value.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/iu);
  return fallbackMatch
    ? trimDispositionValue(fallbackMatch[1] ?? fallbackMatch[2] ?? "")
    : null;
}

export function pickDownloadFilename(
  headers: Headers,
  fallback: string,
): string {
  return contentDispositionFilename(headers.get("content-disposition")) ?? fallback;
}

export function triggerBrowserDownload(blob: Blob, fileName: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("File downloads require a browser environment.");
  }

  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 0);
}

function trimDispositionValue(value: string): string {
  return value.trim().replace(/^"(.*)"$/u, "$1");
}
