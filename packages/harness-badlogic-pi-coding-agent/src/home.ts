import { promises as fs } from "node:fs";
import path from "node:path";

import {
  buildManagedHarnessEnv,
  ensureDir,
  getManagedHarnessHomePath,
  type HarnessExecutionPlan,
} from "@workbench-ai/harness-sdk";
import {
  getPiHarnessAuth,
  resolvePiApiKeyAuth,
  resolvePiProfileAuth,
  stagePiProfileAuth,
  writePiApiKeyAuth,
} from "./auth.js";
import {
  resolvePiConfiguredEffort,
  resolvePiConfiguredModel,
  type PiResolvedModel,
} from "./cli.js";

export interface StagedPiHome {
  childEnv: NodeJS.ProcessEnv;
  homeDir: string;
  agentDir: string;
  sessionFile: string;
  model: PiResolvedModel;
  effort: string | null;
}

export async function stagePiHome(args: {
  plan: HarnessExecutionPlan;
  repoRoot: string;
  flowHome: string;
  stageSessionPath: string;
  parentEnv: NodeJS.ProcessEnv;
  persistedSession: Record<string, unknown> | null;
  resume: boolean;
}): Promise<StagedPiHome> {
  const homeDir = getManagedHarnessHomePath(args.stageSessionPath);
  const agentDir = getPiAgentDir(homeDir);
  const model = resolvePiConfiguredModel(args.plan);
  const effort = resolvePiConfiguredEffort(args.plan);
  const sessionFile = resolvePiSessionFile(
    args.stageSessionPath,
    args.persistedSession,
    args.resume,
  );

  await ensureDir(agentDir);
  await fs.rm(path.join(agentDir, "settings.json"), { force: true });
  await fs.rm(path.join(agentDir, "auth.json"), { force: true });
  await fs.rm(path.join(agentDir, "models.json"), { force: true });

  const auth = getPiHarnessAuth(args.plan);

  if (auth.strategy === "profile_path") {
    const { sourceAgentDir } = resolvePiProfileAuth(args.plan, args.repoRoot);
    await stagePiProfileAuth(sourceAgentDir, agentDir);
  } else {
    const { provider, apiKey } = resolvePiApiKeyAuth(
      args.plan,
      args.repoRoot,
      args.flowHome,
    );
    await writePiApiKeyAuth(agentDir, provider, apiKey);
  }

  await writePiSettings(agentDir, {
    provider: model.provider,
    modelId: model.modelId,
    effort,
  });

  if (!args.resume) {
    await fs.rm(sessionFile, { force: true });
  }

  return {
    childEnv: buildPiEnv({ homeDir, agentDir }, args.parentEnv),
    homeDir,
    agentDir,
    sessionFile,
    model,
    effort,
  };
}

export function getPiAgentDir(homeDir: string): string {
  return path.join(homeDir, ".pi", "agent");
}

export function resolvePiSessionFile(
  stageSessionPath: string,
  persistedSession: Record<string, unknown> | null,
  requirePersistedSession: boolean,
): string {
  const persisted =
    typeof persistedSession?.session_file === "string" &&
    persistedSession.session_file.trim().length > 0
      ? persistedSession.session_file
      : null;
  if (requirePersistedSession && !persisted) {
    throw new Error("Pi resume requires a persisted session_file.");
  }
  return persisted ?? path.join(stageSessionPath, "pi-session.jsonl");
}

export function buildPiEnv(
  args: { homeDir: string; agentDir: string },
  parentEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return buildManagedHarnessEnv(parentEnv, {
    HOME: args.homeDir,
    PI_CODING_AGENT_DIR: args.agentDir,
  });
}

async function writePiSettings(
  agentDir: string,
  args: {
    provider: string;
    modelId: string;
    effort: string | null;
  },
): Promise<void> {
  const settingsPath = path.join(agentDir, "settings.json");
  await fs.writeFile(
    settingsPath,
    `${JSON.stringify(
      {
        defaultProvider: args.provider,
        defaultModel: args.modelId,
        ...(args.effort ? { defaultThinkingLevel: args.effort } : {}),
        compaction: { enabled: false },
        retry: { enabled: false },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
