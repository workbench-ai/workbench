import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

import { resolveRuntimeHome } from "./internal-utils.js";

export interface ResolvedRuntimeEnv {
  name: string;
  value: string | undefined;
  source: "repo_env" | "home_env" | "process_env" | "missing";
  envPath: string | null;
  explicitly_set: boolean;
  blank: boolean;
}

export interface RuntimeEnvOptions {
  runtimeHome?: string;
  parentEnv?: NodeJS.ProcessEnv;
}

type RuntimeEnvResolutionSource = Exclude<
  ResolvedRuntimeEnv["source"],
  "missing"
>;

export function getRuntimeEnvPath(rootPath: string): string {
  return path.join(rootPath, ".env");
}

function readRuntimeEnvFile(repoRoot: string): NodeJS.ProcessEnv {
  const envPath = getRuntimeEnvPath(repoRoot);
  if (!existsSync(envPath)) {
    return {};
  }

  return parseEnv(readFileSync(envPath, "utf8"));
}

function collectRuntimeEnvFilesWithOptions(
  repoRoot: string,
  options: RuntimeEnvOptions,
): {
  repoValues: NodeJS.ProcessEnv;
  homeValues: NodeJS.ProcessEnv;
  runtimeHome: string;
} {
  const normalizedRepoRoot = path.resolve(repoRoot);
  const runtimeHome = resolveRuntimeHome(options.runtimeHome);
  return {
    repoValues: readRuntimeEnvFile(normalizedRepoRoot),
    homeValues: readRuntimeEnvFile(runtimeHome),
    runtimeHome,
  };
}

function formatResolvedRuntimeEnv(
  name: string,
  source: RuntimeEnvResolutionSource,
  value: string | undefined,
  envPath: string | null,
): ResolvedRuntimeEnv {
  return {
    name,
    value,
    source,
    envPath,
    explicitly_set: true,
    blank: !value?.trim(),
  };
}

export function getRuntimeEnv(
  name: string,
  repoRoot: string,
  options: RuntimeEnvOptions = {},
): string | undefined {
  return resolveRuntimeEnv(name, repoRoot, options).value;
}

export function resolveRuntimeEnvWithPrecedence(
  name: string,
  repoRoot: string,
  precedence: readonly RuntimeEnvResolutionSource[],
  options: RuntimeEnvOptions = {},
): ResolvedRuntimeEnv {
  const { repoValues, homeValues, runtimeHome } =
    collectRuntimeEnvFilesWithOptions(repoRoot, options);
  const parentEnv = options.parentEnv ?? process.env;

  const sourceValues: Record<
    RuntimeEnvResolutionSource,
    { envPath: string | null; values: NodeJS.ProcessEnv }
  > = {
    repo_env: {
      envPath: getRuntimeEnvPath(repoRoot),
      values: repoValues,
    },
    home_env: {
      envPath: getRuntimeEnvPath(runtimeHome),
      values: homeValues,
    },
    process_env: {
      envPath: null,
      values: parentEnv,
    },
  };

  for (const source of precedence) {
    const entry = sourceValues[source];
    if (Object.prototype.hasOwnProperty.call(entry.values, name)) {
      return formatResolvedRuntimeEnv(
        name,
        source,
        entry.values[name],
        entry.envPath,
      );
    }
  }

  return {
    name,
    value: undefined,
    source: "missing",
    envPath: null,
    explicitly_set: false,
    blank: false,
  };
}

export function resolveRuntimeEnv(
  name: string,
  repoRoot: string,
  options: RuntimeEnvOptions = {},
): ResolvedRuntimeEnv {
  return resolveRuntimeEnvWithPrecedence(
    name,
    repoRoot,
    ["repo_env", "home_env", "process_env"],
    options,
  );
}

export function resetRuntimeEnvForTests(): void {
  // Env resolution is intentionally stateless so repo-local edits are observed
  // immediately.
}
