import path from "node:path";
import { fileURLToPath } from "node:url";

const SYSTEM_PATH_ENTRIES = [
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
];

export interface AdapterCommandEnvOptions {
  workspaceRoot?: string;
  adapterRoot?: string;
  env?: NodeJS.ProcessEnv;
  extraEnv?: Record<string, string | undefined>;
}

export function createAdapterCommandEnv(options: AdapterCommandEnvOptions = {}): NodeJS.ProcessEnv {
  const baseEnv = options.env ?? process.env;
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === "string" && !key.startsWith("WORKBENCH_")) {
      env[key] = value;
    }
  }
  env.PATH = adapterCommandPath({
    workspaceRoot: options.workspaceRoot,
    adapterRoot: options.adapterRoot,
    basePath: baseEnv.PATH,
  });
  for (const [key, value] of Object.entries(options.extraEnv ?? {})) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function adapterCommandPath(options: {
  workspaceRoot?: string;
  adapterRoot?: string;
  basePath?: string;
}): string {
  return uniquePathEntries([
    path.dirname(process.execPath),
    ...optionalProjectBinDirs(options.workspaceRoot),
    ...optionalProjectBinDirs(options.adapterRoot),
    ...nodeModuleBinDirsForAncestors(process.cwd()),
    ...nodeModuleBinDirsForAncestors(path.dirname(fileURLToPath(import.meta.url))),
    ...optionalAncestorBinDirs(options.workspaceRoot),
    ...optionalAncestorBinDirs(options.adapterRoot),
    ...SYSTEM_PATH_ENTRIES,
    ...(options.basePath ? options.basePath.split(path.delimiter) : []),
  ]).join(path.delimiter);
}

function optionalProjectBinDirs(root: string | undefined): string[] {
  return root
    ? [
        path.join(root, "node_modules", ".bin"),
        path.join(root, "products", "workbench", "node_modules", ".bin"),
      ]
    : [];
}

function optionalAncestorBinDirs(root: string | undefined): string[] {
  return root ? nodeModuleBinDirsForAncestors(root) : [];
}

function nodeModuleBinDirsForAncestors(start: string): string[] {
  const dirs: string[] = [];
  let current = path.resolve(start);
  for (let depth = 0; depth < 12; depth += 1) {
    dirs.push(path.join(current, "node_modules", ".bin"));
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return dirs;
}

function uniquePathEntries(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
}
