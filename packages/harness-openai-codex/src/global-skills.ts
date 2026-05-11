import { projectGlobalSkills } from "@workbench-ai/harness-sdk";

import { clearCodexLegacySkillRoots } from "./integrations.js";

export async function syncCodexGlobalSkills(args: {
  codexHomeDir: string;
}): Promise<void> {
  await clearCodexLegacySkillRoots(args.codexHomeDir);
}

export async function projectCodexGlobalSkills(args: {
  sourceHomeDir: string;
  targetHomeDir: string;
  targetCodexHomeDir: string;
}): Promise<void> {
  await Promise.all([
    projectGlobalSkills({
      sourceHomeDir: args.sourceHomeDir,
      targetHomeDir: args.targetHomeDir,
    }),
    clearCodexLegacySkillRoots(args.targetCodexHomeDir),
  ]);
}
