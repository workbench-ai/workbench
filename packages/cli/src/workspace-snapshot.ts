import { promises as fs } from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

export interface WorkspaceSnapshotFile {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
  executable?: boolean;
}

export class WorkspaceSnapshotError extends Error {}

const SNAPSHOT_FILE_MAX_BYTES = 20 * 1024 * 1024;
const SNAPSHOT_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".workbench",
  "node_modules",
  "__pycache__",
  ".pytest_cache",
]);
const SNAPSHOT_IGNORED_FILES = new Set([".DS_Store"]);
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export async function readSnapshotFiles(inputPath: string): Promise<WorkspaceSnapshotFile[]> {
  const stat = await fs.stat(inputPath);
  if (stat.isFile()) {
    return [await readSnapshotFile(inputPath, path.basename(inputPath), stat)];
  }
  if (!stat.isDirectory()) {
    throw new WorkspaceSnapshotError(
      `Snapshot path must be a file or directory: ${inputPath}`,
    );
  }
  const files: WorkspaceSnapshotFile[] = [];
  await walk(inputPath, inputPath, files);
  if (files.length === 0) {
    throw new WorkspaceSnapshotError(`Snapshot directory has no files: ${inputPath}`);
  }
  return files;
}

async function walk(
  root: string,
  current: string,
  files: WorkspaceSnapshotFile[],
): Promise<void> {
  const entries = (await fs.readdir(current, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    if (SNAPSHOT_IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(root, absolutePath, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (
      SNAPSHOT_IGNORED_FILES.has(entry.name) ||
      entry.name.endsWith(".pyc") ||
      entry.name.endsWith(".pyo")
    ) {
      continue;
    }
    files.push(
      await readSnapshotFile(
        absolutePath,
        path.relative(root, absolutePath).split(path.sep).join("/"),
        await fs.stat(absolutePath),
      ),
    );
  }
}

async function readSnapshotFile(
  filePath: string,
  relativePath: string,
  stat: { size: number; mode: number },
): Promise<WorkspaceSnapshotFile> {
  if (stat.size > SNAPSHOT_FILE_MAX_BYTES) {
    throw new WorkspaceSnapshotError(`Snapshot file is too large: ${filePath}`);
  }
  const content = await fs.readFile(filePath);
  const executable = (stat.mode & 0o111) !== 0;
  const text = decodeUtf8(content);
  if (text !== null) {
    return {
      path: relativePath,
      content: text,
      ...(executable ? { executable: true } : {}),
    };
  }
  return {
    path: relativePath,
    content: content.toString("base64"),
    encoding: "base64",
    ...(executable ? { executable: true } : {}),
  };
}

function decodeUtf8(content: Buffer): string | null {
  try {
    return utf8Decoder.decode(content);
  } catch {
    return null;
  }
}
