import {
  pickDownloadFilename,
  triggerBrowserDownload,
} from "@workbench-ai/cli-web-ui/lib/browser-download";

export async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return await response.json() as T;
}

export async function downloadFile(
  url: string,
  options: {
    filename?: string;
    init?: RequestInit;
  } = {},
): Promise<void> {
  const response = await fetch(url, options.init);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const blob = await response.blob();
  triggerBrowserDownload(
    blob,
    pickDownloadFilename(response.headers, options.filename ?? "download"),
  );
}

export function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (text.length === 0) {
    return `Request failed with status ${response.status}.`;
  }

  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : text;
  } catch {
    return text;
  }
}
