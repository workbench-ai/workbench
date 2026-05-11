import { promises as fs } from "node:fs";
import path from "node:path";

import {
  projectGlobalSkills,
  syncEnabledGlobalSkillsToTarget,
} from "@workbench-ai/flow-harness-sdk";

function claudeSkillsRoot(homeDir: string): string {
  return path.join(homeDir, ".claude", "skills");
}

function claudeDisabledSkillsRoot(homeDir: string): string {
  return path.join(homeDir, ".claude", ".disabled-skills");
}

export async function syncClaudeGlobalSkills(homeDir: string): Promise<void> {
  await syncEnabledGlobalSkillsToTarget({
    sourceHomeDir: homeDir,
    targetRoot: claudeSkillsRoot(homeDir),
  });
  await fs.rm(claudeDisabledSkillsRoot(homeDir), {
    recursive: true,
    force: true,
  });
}

export async function projectClaudeGlobalSkills(args: {
  sourceHomeDir: string;
  targetHomeDir: string;
}): Promise<void> {
  await Promise.all([
    projectGlobalSkills({
      sourceHomeDir: args.sourceHomeDir,
      targetHomeDir: args.targetHomeDir,
    }),
    syncEnabledGlobalSkillsToTarget({
      sourceHomeDir: args.sourceHomeDir,
      targetRoot: claudeSkillsRoot(args.targetHomeDir),
    }),
  ]);
  await fs.rm(claudeDisabledSkillsRoot(args.targetHomeDir), {
    recursive: true,
    force: true,
  });
}
