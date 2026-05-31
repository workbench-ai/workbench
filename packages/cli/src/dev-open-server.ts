import { promises as fs } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { WorkbenchInspection } from "@workbench-ai/workbench-core";

import {
  createLocalProjectSourceReader,
  createLocalWorkbenchInspection,
} from "./local-inspection.js";

export interface LocalWorkbenchDevServer {
  url: string;
  close: () => Promise<void>;
}

export interface LocalWorkbenchDevServerOptions {
  workspace: string;
  host: string;
  port: number;
  assetsRoot?: string;
}

class LocalApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface LocalWorkbenchRequestContext {
  workspace: string;
  assetsRoot: string;
  inspection: WorkbenchInspection;
}

const DEV_OPEN_ASSET_DIR = "dev-open";

export async function startLocalWorkbenchDevServer(
  options: LocalWorkbenchDevServerOptions,
): Promise<LocalWorkbenchDevServer> {
  const workspace = path.resolve(options.workspace);
  const assetsRoot = options.assetsRoot ?? defaultDevOpenAssetsRoot();
  await assertDevOpenAssets(assetsRoot);
  const readProjectSource = createLocalProjectSourceReader(workspace);
  const context: LocalWorkbenchRequestContext = {
    workspace,
    assetsRoot,
    inspection: createLocalWorkbenchInspection({
      workspace,
      readProjectSource,
    }),
  };

  const server = http.createServer((request, response) => {
    void handleLocalWorkbenchRequest({
      request,
      response,
      context,
    }).catch((error: unknown) => {
      sendError(response, error, request.method);
    });
  });
  server.requestTimeout = 0;
  server.timeout = 0;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Workbench local server did not bind a TCP port.");
  }
  const host = displayHost(options.host);
  return {
    url: `http://${host}:${address.port}/`,
    close: () => closeServer(server),
  };
}

function defaultDevOpenAssetsRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), DEV_OPEN_ASSET_DIR);
}

async function assertDevOpenAssets(assetsRoot: string): Promise<void> {
  await Promise.all([
    fs.stat(path.join(assetsRoot, "client.js")),
    fs.stat(path.join(assetsRoot, "client.css")),
  ]).catch(() => {
    throw new Error(
      `Workbench local browser assets are missing from ${assetsRoot}. Run pnpm --dir products/workbench/packages/cli build.`,
    );
  });
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function handleLocalWorkbenchRequest(args: {
  request: IncomingMessage;
  response: ServerResponse;
  context: LocalWorkbenchRequestContext;
}): Promise<void> {
  const url = new URL(args.request.url ?? "/", "http://workbench.local");
  if (args.request.method !== "GET" && args.request.method !== "HEAD") {
    sendJson(args.response, { message: "Workbench local open is read-only." }, 405, args.request.method);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    await handleApiRequest(args.request, args.response, args.context, url);
    return;
  }
  if (url.pathname === "/assets/client.js") {
    await sendFile(args.response, path.join(args.context.assetsRoot, "client.js"), "text/javascript; charset=utf-8", args.request.method);
    return;
  }
  if (url.pathname === "/assets/client.css") {
    await sendFile(args.response, path.join(args.context.assetsRoot, "client.css"), "text/css; charset=utf-8", args.request.method);
    return;
  }
  if (url.pathname.startsWith("/assets/fonts/")) {
    await sendFontFile(args.response, args.context.assetsRoot, url, args.request.method);
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    throw new LocalApiError("Workbench local asset not found.", 404);
  }
  await sendHtml(
    args.response,
    args.request.method,
    isKnownWorkbenchDocumentPath(url.pathname) ? 200 : 404,
  );
}

function isKnownWorkbenchDocumentPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean).map(decodeDocumentPathSegment);
  if (segments.length === 0) {
    return true;
  }
  if (segments[0] === "evaluations") {
    return segments.length === 1;
  }
  if (segments[0] !== "candidates") {
    return false;
  }
  if (segments.length === 1 || segments.length === 2) {
    return true;
  }
  return segments.length === 3 && (segments[2] === "files" || segments[2] === "manifest");
}

function decodeDocumentPathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: LocalWorkbenchRequestContext,
  url: URL,
): Promise<void> {
  const { inspection } = context;
  switch (url.pathname) {
    case "/api/snapshot":
      sendJson(response, await inspection.snapshot(), 200, request.method);
      return;
    case "/api/spec":
      sendJson(
        response,
        await inspection.spec({
          fingerprint: readOptionalSearchString(url.searchParams, "fingerprint"),
        }),
        200,
        request.method,
      );
      return;
    case "/api/source/files":
      sendJson(
        response,
        await inspection.sourceFiles({
          fingerprint: readOptionalSearchString(url.searchParams, "fingerprint"),
        }),
        200,
        request.method,
      );
      return;
    case "/api/source/preview":
      sendJson(
        response,
        await inspection.sourcePreview({
          fingerprint: readOptionalSearchString(url.searchParams, "fingerprint"),
          path: readSearchString(url.searchParams, "path"),
          view: readPreviewMode(url.searchParams),
        }),
        200,
        request.method,
      );
      return;
    case "/api/record":
      sendJson(
        response,
        await inspection.candidate({ id: readSearchString(url.searchParams, "id") }),
        200,
        request.method,
      );
      return;
    case "/api/evaluation":
      sendJson(
        response,
        await inspection.evaluation({ id: readSearchString(url.searchParams, "id") }),
        200,
        request.method,
      );
      return;
    case "/api/candidate/files": {
      const candidateId = readSearchString(url.searchParams, "id");
      sendJson(
        response,
        await inspection.candidateFiles({ id: candidateId }),
        200,
        request.method,
      );
      return;
    }
    case "/api/candidate/preview": {
      const candidateId = readSearchString(url.searchParams, "id");
      sendJson(
        response,
        await inspection.candidatePreview({
          id: candidateId,
          path: readSearchString(url.searchParams, "path"),
          view: readPreviewMode(url.searchParams),
        }),
        200,
        request.method,
      );
      return;
    }
    case "/api/case-review": {
      const candidateId = readSearchString(url.searchParams, "id");
      const caseId = readSearchString(url.searchParams, "case");
      const runId = readSearchString(url.searchParams, "run");
      sendJson(
        response,
        await inspection.caseReview({
          candidateId,
          caseId,
          runId,
        }),
        200,
        request.method,
      );
      return;
    }
    case "/api/traces": {
      const traceRunId = readSearchString(url.searchParams, "run");
      const traceJobId = readSearchString(url.searchParams, "job");
      sendJson(
        response,
        await inspection.executionTrace({
          runId: traceRunId,
          jobId: traceJobId,
        }),
        200,
        request.method,
      );
      return;
    }
    case "/api/execution/files": {
      const execRunId = readSearchString(url.searchParams, "run");
      const execJobId = readSearchString(url.searchParams, "id");
      sendJson(
        response,
        await inspection.executionFiles({
          runId: execRunId,
          jobId: execJobId,
        }),
        200,
        request.method,
      );
      return;
    }
    case "/api/execution/preview": {
      const previewRunId = readSearchString(url.searchParams, "run");
      const previewJobId = readSearchString(url.searchParams, "id");
      const previewFilePath = readSearchString(url.searchParams, "path");
      sendJson(
        response,
        await inspection.executionPreview({
          runId: previewRunId,
          jobId: previewJobId,
          path: previewFilePath,
          view: readPreviewMode(url.searchParams),
        }),
        200,
        request.method,
      );
      return;
    }
    default:
      throw new LocalApiError(`Unknown Workbench local API route: ${url.pathname}`, 404);
  }
}

function readSearchString(params: URLSearchParams, key: string): string {
  const value = params.get(key);
  if (!value) {
    throw new LocalApiError(`${key} is required.`);
  }
  return value;
}

function readOptionalSearchString(params: URLSearchParams, key: string): string | null {
  const value = params.get(key)?.trim();
  return value ? value : null;
}

function readPreviewMode(params: URLSearchParams): "diff" | "raw" | "rendered" {
  const view = params.get("view") ?? "rendered";
  if (view === "diff" || view === "raw" || view === "rendered") {
    return view;
  }
  throw new LocalApiError("view must be diff, raw, or rendered.");
}

async function sendFile(
  response: ServerResponse,
  filePath: string,
  contentType: string,
  method = "GET",
): Promise<void> {
  let body: Buffer;
  try {
    body = await fs.readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new LocalApiError("Workbench local asset not found.", 404);
    }
    throw error;
  }
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": body.byteLength,
    "cache-control": "no-store",
  });
  response.end(method === "HEAD" ? undefined : body);
}

async function sendFontFile(
  response: ServerResponse,
  assetsRoot: string,
  url: URL,
  method = "GET",
): Promise<void> {
  let fileName: string;
  try {
    fileName = decodeURIComponent(url.pathname.slice("/assets/fonts/".length));
  } catch {
    throw new LocalApiError("Invalid font asset path.", 404);
  }
  if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
    throw new LocalApiError("Invalid font asset path.", 404);
  }
  await sendFile(response, path.join(assetsRoot, "fonts", fileName), "font/woff2", method);
}

async function sendHtml(
  response: ServerResponse,
  method = "GET",
  status = 200,
): Promise<void> {
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Workbench Local</title>
    <link rel="stylesheet" href="/assets/client.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/client.js"></script>
  </body>
</html>`;
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(method === "HEAD" ? undefined : body);
}

function sendJson(
  response: ServerResponse,
  value: unknown,
  status = 200,
  method = "GET",
): void {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(method === "HEAD" ? undefined : body);
}

function sendError(response: ServerResponse, error: unknown, method = "GET"): void {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof LocalApiError
    ? error.status
    : typeof (error as { statusCode?: unknown })?.statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 500;
  sendJson(response, { message }, status, method);
}

function displayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
