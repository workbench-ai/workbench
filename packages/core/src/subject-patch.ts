import type {
  SurfaceSnapshotFile,
  WorkbenchSubjectPatch,
} from "@workbench-ai/workbench-contract";

export interface ApplyWorkbenchSubjectPatchInput {
  baseFiles: readonly SurfaceSnapshotFile[];
  patch: WorkbenchSubjectPatch;
  edits: readonly string[];
}

export function applyWorkbenchSubjectPatch(input: ApplyWorkbenchSubjectPatchInput): SurfaceSnapshotFile[] {
  const issues: string[] = [];
  const edits = input.edits.map(normalizeRelativePath).filter(Boolean);
  const patchPaths = new Set<string>();
  for (const file of input.patch.files) {
    const filePath = normalizeRelativePath(file.path);
    if (!isSafeRelativePath(filePath)) {
      issues.push(`Subject patch contains unsafe path ${file.path}.`);
    }
    if (!isAllowedEditPath(filePath, edits)) {
      issues.push(`Subject patch contains path outside optimizer edits: ${file.path}.`);
    }
    patchPaths.add(filePath);
  }
  for (const fileChange of input.patch.fileChanges) {
    const filePath = normalizeRelativePath(fileChange);
    if (!isSafeRelativePath(filePath)) {
      issues.push(`Subject patch fileChanges contains unsafe path ${fileChange}.`);
    }
    if (!isAllowedEditPath(filePath, edits)) {
      issues.push(`Subject patch fileChanges contains path outside optimizer edits: ${fileChange}.`);
    }
  }
  if (issues.length > 0) {
    throw new Error(issues.join("\n"));
  }

  const patched = new Map<string, SurfaceSnapshotFile>();
  for (const file of input.baseFiles) {
    patched.set(normalizeRelativePath(file.path), {
      ...file,
      path: normalizeRelativePath(file.path),
    });
  }
  for (const file of input.patch.files) {
    patched.set(normalizeRelativePath(file.path), {
      ...file,
      path: normalizeRelativePath(file.path),
    });
  }

  const baseOrder = input.baseFiles.map((file) => normalizeRelativePath(file.path));
  const addedPaths = [...patchPaths].filter((filePath) => !baseOrder.includes(filePath)).sort();
  return [...baseOrder, ...addedPaths]
    .flatMap((filePath) => {
      const file = patched.get(filePath);
      return file ? [file] : [];
    });
}

function isAllowedEditPath(filePath: string, edits: readonly string[]): boolean {
  const normalizedPath = normalizeRelativePath(filePath);
  return edits.some((entry) => {
    const normalizedEditPath = normalizeRelativePath(entry).replace(/\/+$/u, "");
    return normalizedPath === normalizedEditPath || normalizedPath.startsWith(`${normalizedEditPath}/`);
  });
}

function isSafeRelativePath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  return normalized.length > 0
    && !normalized.startsWith("/")
    && !normalized.split("/").includes("..");
}

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/gu, "/").replace(/^\.\/+/u, "").replace(/\/+/gu, "/");
}
