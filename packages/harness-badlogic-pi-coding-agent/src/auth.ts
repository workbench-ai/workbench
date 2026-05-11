import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import { ensureDir, resolveFlowEnv, type HarnessExecutionPlan } from "@workbench-ai/flow-harness-sdk";
import { PiHarnessAuthSchema, type PiHarnessAuth } from "./schemas.js";
import { resolvePiConfiguredModel } from "./cli.js";
import { getPiHarness } from "./manifest.js";

const supportedPiApiKeyProviders = new Set([
  "anthropic",
  "azure-openai-responses",
  "openai",
  "google",
  "mistral",
  "groq",
  "cerebras",
  "xai",
  "openrouter",
  "vercel-gateway",
  "zai",
  "opencode",
  "opencode-go",
  "huggingface",
  "kimi-coding",
  "minimax",
  "minimax-cn",
]);

export interface ResolvedPiApiKeyAuth {
  provider: string;
  apiKey: string;
}

export interface ResolvedPiProfileAuth {
  sourceAgentDir: string;
}

export function getPiHarnessAuth(plan: HarnessExecutionPlan): PiHarnessAuth {
  return PiHarnessAuthSchema.parse(getPiHarness(plan).auth);
}

export async function ensurePiAuthReady(
  plan: HarnessExecutionPlan,
  repoRoot: string,
  flowHome?: string,
): Promise<void> {
  const auth = getPiHarnessAuth(plan);
  if (auth.strategy === "secret_ref") {
    resolvePiApiKeyAuth(plan, repoRoot, flowHome);
    return;
  }
  const { sourceAgentDir } = resolvePiProfileAuth(plan, repoRoot);
  await fs.access(path.join(sourceAgentDir, "auth.json"));
}

export function resolvePiApiKeyAuth(
  plan: HarnessExecutionPlan,
  repoRoot: string,
  flowHome?: string,
): ResolvedPiApiKeyAuth {
  const auth = getPiHarnessAuth(plan);
  if (auth.strategy !== "secret_ref") {
    throw new Error("Pi secret_ref auth is required for API-key staging.");
  }

  const { provider } = resolvePiConfiguredModel(plan);
  if (!supportedPiApiKeyProviders.has(provider)) {
    throw new Error(
      `Pi secret_ref auth only supports API-key providers. Unsupported provider "${provider}".`,
    );
  }

  const resolved = resolveFlowEnv(auth.ref, repoRoot, { flowHome });
  const apiKey = resolved.value?.trim();
  if (!apiKey) {
    const location = resolved.envPath ?? "the environment";
    throw new Error(
      `${auth.ref} must be set in ${location} before running Flow Pi sessions.`,
    );
  }

  return {
    provider,
    apiKey,
  };
}

export function resolvePiProfileAuth(
  plan: HarnessExecutionPlan,
  repoRoot: string,
): ResolvedPiProfileAuth {
  const auth = getPiHarnessAuth(plan);
  if (auth.strategy !== "profile_path") {
    throw new Error("Pi profile_path auth is required for profile staging.");
  }
  return {
    sourceAgentDir: resolvePiProfileAgentDir(path.resolve(repoRoot, auth.path)),
  };
}

export function resolvePiProfileAgentDir(sourcePath: string): string {
  const normalized = path.resolve(sourcePath);
  const directAuthPath = path.join(normalized, "auth.json");
  const nestedAuthPath = path.join(normalized, ".pi", "agent", "auth.json");
  if (path.basename(normalized) === "agent") {
    return normalized;
  }
  if (path.basename(normalized) === ".pi") {
    return path.join(normalized, "agent");
  }
  if (existsSync(directAuthPath)) {
    return normalized;
  }
  if (existsSync(nestedAuthPath)) {
    return path.join(normalized, ".pi", "agent");
  }
  return path.join(normalized, ".pi", "agent");
}

export async function stagePiProfileAuth(
  sourceAgentDir: string,
  targetAgentDir: string,
): Promise<void> {
  await ensureDir(targetAgentDir);
  await fs.copyFile(
    path.join(sourceAgentDir, "auth.json"),
    path.join(targetAgentDir, "auth.json"),
  );
  try {
    await fs.copyFile(
      path.join(sourceAgentDir, "models.json"),
      path.join(targetAgentDir, "models.json"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function writePiApiKeyAuth(
  targetAgentDir: string,
  provider: string,
  apiKey: string,
): Promise<void> {
  await ensureDir(targetAgentDir);
  const authPath = path.join(targetAgentDir, "auth.json");
  await fs.writeFile(
    authPath,
    `${JSON.stringify(
      {
        [provider]: {
          type: "api_key",
          key: apiKey,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await fs.chmod(authPath, 0o600);
}
