import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

import type { ExecutionOwner } from "@workbench-ai/contracts";

import {
  resolveCanonicalProjectRoot,
  resolveFlowHome,
} from "./internal-utils.js";

export interface ResolvedFlowEnv {
  name: string;
  value: string | undefined;
  source: "repo_env" | "home_env" | "process_env" | "missing";
  envPath: string | null;
  explicitly_set: boolean;
  blank: boolean;
}

export interface FlowEnvOptions {
  flowHome?: string;
  parentEnv?: NodeJS.ProcessEnv;
}

type FlowEnvResolutionSource = Exclude<
  ResolvedFlowEnv["source"],
  "missing"
>;

export function getFlowEnvPath(rootPath: string): string {
  return path.join(rootPath, ".env");
}

function readFlowEnvFile(repoRoot: string): NodeJS.ProcessEnv {
  const envPath = getFlowEnvPath(repoRoot);
  if (!existsSync(envPath)) {
    return {};
  }

  return parseEnv(readFileSync(envPath, "utf8"));
}

function collectFlowEnvFilesWithOptions(
  repoRoot: string,
  options: FlowEnvOptions,
): {
  repoValues: NodeJS.ProcessEnv;
  homeValues: NodeJS.ProcessEnv;
  flowHome: string;
} {
  const normalizedRepoRoot = path.resolve(repoRoot);
  const flowHome = resolveFlowHome(options.flowHome);
  return {
    repoValues: readFlowEnvFile(normalizedRepoRoot),
    homeValues: readFlowEnvFile(flowHome),
    flowHome,
  };
}

function formatResolvedFlowEnv(
  name: string,
  source: FlowEnvResolutionSource,
  value: string | undefined,
  envPath: string | null,
): ResolvedFlowEnv {
  return {
    name,
    value,
    source,
    envPath,
    explicitly_set: true,
    blank: !value?.trim(),
  };
}

export function buildFlowProcessEnv(
  repoRoot: string,
  options: FlowEnvOptions = {},
): NodeJS.ProcessEnv {
  const { repoValues, homeValues } = collectFlowEnvFilesWithOptions(
    repoRoot,
    options,
  );
  return {
    ...(options.parentEnv ?? process.env),
    ...homeValues,
    ...repoValues,
    FLOW_PROJECT_ROOT: resolveCanonicalProjectRoot(repoRoot),
  };
}

export function buildExecutionOwnerEnv(
  owner: ExecutionOwner,
): Record<string, string> {
  return {
    FLOW_OWNER_ID: owner.id,
    FLOW_OWNER_KIND: owner.kind,
  };
}

export function getFlowEnv(
  name: string,
  repoRoot: string,
  options: FlowEnvOptions = {},
): string | undefined {
  return resolveFlowEnv(name, repoRoot, options).value;
}

export function resolveFlowEnvWithPrecedence(
  name: string,
  repoRoot: string,
  precedence: readonly FlowEnvResolutionSource[],
  options: FlowEnvOptions = {},
): ResolvedFlowEnv {
  const { repoValues, homeValues, flowHome } =
    collectFlowEnvFilesWithOptions(repoRoot, options);
  const parentEnv = options.parentEnv ?? process.env;

  const sourceValues: Record<
    FlowEnvResolutionSource,
    { envPath: string | null; values: NodeJS.ProcessEnv }
  > = {
    repo_env: {
      envPath: getFlowEnvPath(repoRoot),
      values: repoValues,
    },
    home_env: {
      envPath: getFlowEnvPath(flowHome),
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
      return formatResolvedFlowEnv(
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

export function resolveFlowEnv(
  name: string,
  repoRoot: string,
  options: FlowEnvOptions = {},
): ResolvedFlowEnv {
  return resolveFlowEnvWithPrecedence(
    name,
    repoRoot,
    ["repo_env", "home_env", "process_env"],
    options,
  );
}

export function resetFlowEnvForTests(): void {
  // Env resolution is intentionally stateless so repo-local edits are observed
  // immediately.
}
