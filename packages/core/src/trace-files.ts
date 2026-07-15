import type { SurfaceSnapshotFile } from "@workbench-ai/workbench-contract";

import {
  normalizeRelativePath,
  readSurfaceFiles,
} from "./runtime-utils.ts";

export async function readOutputTraceFiles(outputRoot: string, traceRoot: string): Promise<SurfaceSnapshotFile[]> {
  return (await readSurfaceFiles(outputRoot, { ignorePath: shouldSkipTraceDirectory }))
    .map((file) => ({
      ...file,
      path: normalizeRelativePath(`${traceRoot}/${file.path}`),
      executable: false,
    }));
}

function shouldSkipTraceDirectory(relativeDirectory: string): boolean {
  return relativeDirectory === "session/home"
    || relativeDirectory.startsWith("session/home/")
    || relativeDirectory === "session/workspace"
    || relativeDirectory.startsWith("session/workspace/")
    || relativeDirectory.endsWith("/session/home")
    || relativeDirectory.includes("/session/home/")
    || relativeDirectory.endsWith("/session/workspace")
    || relativeDirectory.includes("/session/workspace/");
}
