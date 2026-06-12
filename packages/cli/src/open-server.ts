import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createWorkbenchReadOnlyInspectionSnapshot,
  workbenchJobEvidenceForSnapshot,
  workbenchInspectionFileContent,
  workbenchInspectionFileManifest,
  WorkbenchUserError,
  type SurfaceSnapshotFile,
  type WorkbenchArtifact,
  type WorkbenchInspectionFileContent,
  type WorkbenchInspectionSnapshot,
  type WorkbenchInspectionFileOwnerKind,
  type WorkbenchTrace,
  type WorkbenchVersion,
} from "@workbench-ai/workbench-core";

export interface StartWorkbenchOpenServerOptions {
  dir?: string;
  authToken?: string;
  host?: string;
  port?: number;
}

export interface StartedWorkbenchOpenServer {
  url: string;
  close(): Promise<void>;
}

export async function startWorkbenchOpenServer(
  options: StartWorkbenchOpenServerOptions = {},
): Promise<StartedWorkbenchOpenServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const assetRoot = await resolveDevOpenAssetRoot();
  const server = createServer((request, response) => {
    void handleRequest({ request, response, assetRoot, dir: options.dir, authToken: options.authToken });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new WorkbenchUserError("Could not determine Workbench open server address.");
  }
  const display = displayHost(host);
  return {
    url: `http://${display}:${address.port}/`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    }),
  };
}

async function resolveDevOpenAssetRoot(): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, "dev-open"),
    path.join(moduleDir, "..", "dist", "dev-open"),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, "client.js"));
      return candidate;
    } catch {
      // Try the next source/build layout.
    }
  }
  return candidates[0]!;
}

async function handleRequest({
  request,
  response,
  assetRoot,
  dir,
  authToken,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  assetRoot: string;
  dir?: string;
  authToken?: string;
}): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://workbench.local");
    if (url.pathname === "/api/snapshot") {
      const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir, authToken });
      sendText(response, 200, `${JSON.stringify(inspectionSnapshotManifest(snapshot), null, 2)}\n`, "application/json; charset=utf-8");
      return;
    }
    const jobEvidenceRoute = parseJobEvidenceApiPath(url.pathname);
    if (jobEvidenceRoute) {
      const runId = url.searchParams.get("run")?.trim();
      if (!runId) {
        sendText(response, 400, `${JSON.stringify({ message: "run is required" })}\n`, "application/json; charset=utf-8");
        return;
      }
      const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir, authToken });
      const detail = workbenchJobEvidenceForSnapshot(snapshot, {
        runId,
        jobId: jobEvidenceRoute.jobId,
      });
      if (!detail) {
        sendText(response, 404, `${JSON.stringify({ message: "Job evidence not found" })}\n`, "application/json; charset=utf-8");
        return;
      }
      sendText(response, 200, `${JSON.stringify(detail, null, 2)}\n`, "application/json; charset=utf-8");
      return;
    }
    const fileRoute = parseInspectionFileApiPath(url.pathname);
    if (fileRoute) {
      const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir, authToken });
      const content = inspectionFileContentForSnapshot(snapshot, fileRoute);
      if (!content) {
        sendText(response, 404, `${JSON.stringify({ message: "File not found" })}\n`, "application/json; charset=utf-8");
        return;
      }
      sendText(response, 200, `${JSON.stringify(content, null, 2)}\n`, "application/json; charset=utf-8");
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      sendText(response, 404, `${JSON.stringify({ message: "Not found" })}\n`, "application/json; charset=utf-8");
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      sendText(response, 200, html(), "text/html; charset=utf-8");
      return;
    }
    if (url.pathname === "/client.js" || url.pathname === "/client.css" || url.pathname.startsWith("/fonts/")) {
      await sendAsset(response, assetRoot, url.pathname.slice(1));
      return;
    }
    sendText(response, 200, html(), "text/html; charset=utf-8");
  } catch (error) {
    sendText(response, 500, `${error instanceof Error ? error.message : String(error)}\n`, "text/plain; charset=utf-8");
  }
}

function inspectionSnapshotManifest(snapshot: WorkbenchInspectionSnapshot): WorkbenchInspectionSnapshot {
  return {
    ...snapshot,
    versions: snapshot.versions.map((version) => ({
      ...version,
      files: inspectionFileManifests(version.files),
    })),
    skillBundles: snapshot.skillBundles.map((bundle) => ({
      ...bundle,
      files: inspectionFileManifests(bundle.files),
    })),
    evals: snapshot.evals.map((evalSnapshot) => ({
      ...evalSnapshot,
      files: inspectionFileManifests(evalSnapshot.files),
    })),
    ...(snapshot.comparison ? {
      comparison: {
        ...snapshot.comparison,
        versions: snapshot.comparison.versions.map((version) => ({
          ...version,
          files: inspectionFileManifests(version.files),
        })),
        skills: snapshot.comparison.skills.map((bundle) => ({
          ...bundle,
          files: inspectionFileManifests(bundle.files),
        })),
      },
    } : {}),
    traces: snapshot.traces.map((trace) => ({
      ...trace,
      files: inspectionFileManifests(trace.files),
    })),
    artifacts: snapshot.artifacts.map((artifact) => ({
      ...artifact,
      files: inspectionFileManifests(artifact.files),
    })),
  };
}

function inspectionFileManifests(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  return files.map(workbenchInspectionFileManifest);
}

function parseJobEvidenceApiPath(pathname: string): { jobId: string } | null {
  const segments = pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  const [api, jobs, jobId, evidence] = segments;
  if (api !== "api" || jobs !== "jobs" || evidence !== "evidence" || !jobId || segments.length !== 4) {
    return null;
  }
  return { jobId };
}

function parseInspectionFileApiPath(pathname: string): {
  ownerKind: WorkbenchInspectionFileOwnerKind;
  ownerId: string;
  path: string;
} | null {
  const segments = pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  const [api, ownerKind, ownerId, files, ...filePath] = segments;
  if (api !== "api" || files !== "files" || !ownerId || filePath.length === 0) {
    return null;
  }
  if (ownerKind !== "versions" && ownerKind !== "traces" && ownerKind !== "artifacts") {
    return null;
  }
  return {
    ownerKind: ownerKind.slice(0, -1) as WorkbenchInspectionFileOwnerKind,
    ownerId,
    path: filePath.join("/"),
  };
}

function inspectionFileContentForSnapshot(
  snapshot: WorkbenchInspectionSnapshot,
  route: {
    ownerKind: WorkbenchInspectionFileOwnerKind;
    ownerId: string;
    path: string;
  },
): WorkbenchInspectionFileContent | null {
  const owner = findInspectionFileOwner(snapshot, route.ownerKind, route.ownerId);
  const file = owner?.files.find((entry) => entry.path === route.path);
  return file ? workbenchInspectionFileContent(file) : null;
}

function findInspectionFileOwner(
  snapshot: WorkbenchInspectionSnapshot,
  ownerKind: WorkbenchInspectionFileOwnerKind,
  ownerId: string,
): WorkbenchVersion | WorkbenchTrace | WorkbenchArtifact | undefined {
  if (ownerKind === "version") {
    return snapshot.versions.find((entry) => entry.id === ownerId);
  }
  if (ownerKind === "trace") {
    return snapshot.traces.find((entry) => entry.id === ownerId);
  }
  return snapshot.artifacts.find((entry) => entry.id === ownerId);
}

async function sendAsset(response: ServerResponse, assetRoot: string, relativePath: string): Promise<void> {
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    sendText(response, 404, "Not found\n", "text/plain; charset=utf-8");
    return;
  }
  const content = await fs.readFile(path.join(assetRoot, normalized)).catch(() => null);
  if (!content) {
    sendText(response, 404, "Not found\n", "text/plain; charset=utf-8");
    return;
  }
  response.statusCode = 200;
  response.setHeader("content-type", contentType(normalized));
  response.end(content);
}

function sendText(response: ServerResponse, status: number, content: string, type: string): void {
  response.statusCode = status;
  response.setHeader("content-type", type);
  response.end(content);
}

function html(): string {
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>Workbench</title>",
    "<link rel=\"stylesheet\" href=\"/client.css\">",
    "</head>",
    "<body>",
    "<div id=\"root\"></div>",
    "<script type=\"module\" src=\"/client.js\"></script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".woff2")) {
    return "font/woff2";
  }
  if (filePath.endsWith(".woff")) {
    return "font/woff";
  }
  return "application/octet-stream";
}

function displayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
