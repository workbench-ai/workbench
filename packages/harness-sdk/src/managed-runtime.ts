import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { WorkspaceMode } from "@workbench-ai/contracts";

const managedHarnessEnvAllowlist = new Set([
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]);

export async function mirrorManagedWorkspace(
  sourcePath: string,
  destinationPath: string,
  excludedTopLevelEntries: readonly string[] = [],
): Promise<void> {
  const destinationRelativeToSource = path.relative(sourcePath, destinationPath);
  if (
    destinationRelativeToSource &&
    destinationRelativeToSource !== "." &&
    !destinationRelativeToSource.startsWith(`..${path.sep}`) &&
    destinationRelativeToSource !== ".." &&
    !path.isAbsolute(destinationRelativeToSource)
  ) {
    throw new Error(
      `Cannot mirror ${sourcePath} into nested destination ${destinationPath}.`,
    );
  }
  const exclusions = new Set(
    excludedTopLevelEntries.map((value) => value.replace(/\/+$/u, "")),
  );
  const destinationParent = path.dirname(destinationPath);
  const stagingPath = path.join(
    destinationParent,
    `.flow-mirror-${path.basename(destinationPath)}-${randomUUID()}`,
  );
  await fs.rm(stagingPath, { recursive: true, force: true });
  await fs.mkdir(destinationParent, { recursive: true });

  try {
    await fs.cp(sourcePath, stagingPath, {
      recursive: true,
      force: true,
      filter: (entry) => {
        const relative = path.relative(sourcePath, entry);
        if (!relative || relative === ".") {
          return true;
        }
        const topLevel = relative.split(path.sep, 1)[0] ?? relative;
        return !exclusions.has(topLevel);
      },
    });
    await replaceMirroredWorkspace(stagingPath, destinationPath);
  } catch (error) {
    await fs.rm(stagingPath, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
}

export interface PreparedStageSessionWorkspace {
  workspacePath: string;
  attemptWorkspacePath: string;
  sessionWorkspacePath: string | null;
}

export async function prepareStageSessionWorkspace(args: {
  workspaceMode: WorkspaceMode;
  workspacePath: string;
  stageSessionPath: string;
  excludedTopLevelEntries?: readonly string[];
}): Promise<PreparedStageSessionWorkspace> {
  if (args.workspaceMode === "project") {
    return {
      workspacePath: args.workspacePath,
      attemptWorkspacePath: args.workspacePath,
      sessionWorkspacePath: null,
    };
  }

  const sessionWorkspacePath = path.join(args.stageSessionPath, "workspace");
  await mirrorManagedWorkspace(
    args.workspacePath,
    sessionWorkspacePath,
    args.excludedTopLevelEntries,
  );
  return {
    workspacePath: sessionWorkspacePath,
    attemptWorkspacePath: args.workspacePath,
    sessionWorkspacePath,
  };
}

export async function persistStageSessionWorkspace(args: {
  attemptWorkspacePath: string;
  sessionWorkspacePath: string | null;
  excludedTopLevelEntries?: readonly string[];
}): Promise<void> {
  if (!args.sessionWorkspacePath) {
    return;
  }
  await mirrorManagedWorkspace(
    args.sessionWorkspacePath,
    args.attemptWorkspacePath,
    args.excludedTopLevelEntries,
  );
}

export function buildManagedHarnessEnv(
  parentEnv: NodeJS.ProcessEnv,
  injectedEnv: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (
      typeof value === "string" &&
      (
        managedHarnessEnvAllowlist.has(key)
        || key.startsWith("FLOW_FAKE_")
        || key.startsWith("FACTSET_")
        || key.startsWith("WORKBENCH_")
      )
    ) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(injectedEnv)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

export function getManagedHarnessHomePath(stageSessionPath: string): string {
  return path.join(stageSessionPath, "home");
}

async function replaceMirroredWorkspace(
  stagingPath: string,
  destinationPath: string,
): Promise<void> {
  await fs.rm(destinationPath, { recursive: true, force: true });

  try {
    await fs.rename(stagingPath, destinationPath);
  } catch (error) {
    if (!isMirrorDestinationConflict(error)) {
      throw error;
    }
    await fs.rm(destinationPath, { recursive: true, force: true });
    await fs.rename(stagingPath, destinationPath);
  }
}

function isMirrorDestinationConflict(
  error: unknown,
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (
      error.code === "EEXIST" ||
      error.code === "ENOTEMPTY"
    )
  );
}
