import {
  normalizeWorkbenchEvalPath,
  parseWorkbenchEvalPatch,
  type SurfaceSnapshotFile,
  type WorkbenchEvalPatch,
} from "@workbench-ai/workbench-contract";

import { hashFiles } from "./content-hash.ts";

export class WorkbenchEvalPatchConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbenchEvalPatchConflictError";
  }
}

export function applyWorkbenchEvalPatch(args: {
  baseFiles: readonly SurfaceSnapshotFile[];
  baseHash: string;
  expectedResultHash: string;
  patch: WorkbenchEvalPatch;
}): {
  files: SurfaceSnapshotFile[];
  baseHash: string;
  resultHash: string;
  alreadyApplied: boolean;
} {
  const baseFiles = normalizeBaseFiles(args.baseFiles);
  const currentHash = hashFiles(baseFiles);
  if (currentHash === args.expectedResultHash) {
    return { files: baseFiles, baseHash: args.baseHash, resultHash: currentHash, alreadyApplied: true };
  }
  if (currentHash !== args.baseHash) {
    throw new WorkbenchEvalPatchConflictError(`Eval base changed: expected ${args.baseHash}, received ${currentHash}.`);
  }
  const patch = parseWorkbenchEvalPatch(args.patch);
  const files = new Map(baseFiles.map((file) => [file.path, file]));
  for (const change of patch.changes) {
    if (change.kind === "delete") files.delete(change.path);
    else files.set(change.file.path, { ...change.file });
  }
  const result = [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
  const resultHash = hashFiles(result);
  if (resultHash !== args.expectedResultHash) {
    throw new Error(`Eval patch result hash mismatch: expected ${args.expectedResultHash}, produced ${resultHash}.`);
  }
  return { files: result, baseHash: currentHash, resultHash, alreadyApplied: false };
}

function normalizeBaseFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  const normalized = files.map((file) => ({ ...file, path: normalizeWorkbenchEvalPath(file.path) }));
  if (new Set(normalized.map((file) => file.path)).size !== normalized.length) {
    throw new TypeError("Eval base file paths must be unique.");
  }
  return normalized.sort((left, right) => left.path.localeCompare(right.path));
}
