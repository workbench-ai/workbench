import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  GlobalSkillCatalog,
  GlobalSkillCatalogEntry,
  GlobalSkillProviderSupport,
} from "./types.js";

interface GlobalSkillRecord extends Omit<GlobalSkillCatalogEntry, "providerSupport"> {
  name: string;
  sourcePath: string;
}

export function globalSkillsRoot(homeDir: string): string {
  return path.join(homeDir, ".agents", "skills");
}

export function globalDisabledSkillsRoot(homeDir: string): string {
  return path.join(homeDir, ".agents", ".disabled-skills");
}

export async function listGlobalSkills(args: {
  homeDir: string;
  providerSupport?: readonly GlobalSkillProviderSupport[];
}): Promise<GlobalSkillCatalog> {
  const skills = await discoverGlobalSkillRecords(args.homeDir);
  return {
    skills: skills.map((skill) => toCatalogEntry(skill, args.providerSupport)),
  };
}

export async function updateGlobalSkill(args: {
  enabled: boolean;
  homeDir: string;
  providerSupport?: readonly GlobalSkillProviderSupport[];
  skillId: string;
}): Promise<GlobalSkillCatalogEntry> {
  const skills = await discoverGlobalSkillRecords(args.homeDir);
  const skill = skills.find((entry) => entry.id === args.skillId);
  if (!skill) {
    throw new Error(`Unknown global skill id: ${args.skillId}`);
  }
  if (skill.enabled !== args.enabled) {
    const targetRoot = args.enabled
      ? globalSkillsRoot(args.homeDir)
      : globalDisabledSkillsRoot(args.homeDir);
    const targetPath = path.join(targetRoot, skill.name);
    await fs.mkdir(targetRoot, { recursive: true });
    await fs.rm(targetPath, { recursive: true, force: true });
    await fs.rename(skill.sourcePath, targetPath);
  }

  const updated = (await discoverGlobalSkillRecords(args.homeDir)).find(
    (entry) => entry.id === args.skillId,
  );
  if (!updated) {
    throw new Error(`Global skill disappeared after update: ${args.skillId}`);
  }
  return toCatalogEntry(updated, args.providerSupport);
}

export async function projectGlobalSkills(args: {
  sourceHomeDir: string;
  targetHomeDir: string;
}): Promise<void> {
  const targetRoot = globalSkillsRoot(args.targetHomeDir);
  await syncEnabledGlobalSkillsToTarget({
    sourceHomeDir: args.sourceHomeDir,
    targetRoot,
  });
  await fs.rm(globalDisabledSkillsRoot(args.targetHomeDir), {
    recursive: true,
    force: true,
  });
}

export async function syncEnabledGlobalSkillsToTarget(args: {
  sourceHomeDir: string;
  targetRoot: string;
}): Promise<void> {
  const skills = await discoverGlobalSkillRecords(args.sourceHomeDir);
  await fs.rm(args.targetRoot, { recursive: true, force: true });
  for (const skill of skills) {
    if (!skill.enabled) {
      continue;
    }
    const targetPath = path.join(args.targetRoot, skill.name);
    await fs.mkdir(args.targetRoot, { recursive: true });
    await fs.cp(skill.sourcePath, targetPath, {
      recursive: true,
      dereference: true,
      errorOnExist: false,
      force: true,
    });
  }
}

async function discoverGlobalSkillRecords(homeDir: string): Promise<GlobalSkillRecord[]> {
  const records = new Map<string, GlobalSkillRecord>();
  for (const enabled of [true, false] as const) {
    const root = enabled ? globalSkillsRoot(homeDir) : globalDisabledSkillsRoot(homeDir);
    for (const entry of await discoverSkillDirectories(root)) {
      if (records.has(entry.name)) {
        continue;
      }
      const markdown = await fs.readFile(path.join(entry.path, "SKILL.md"), "utf8");
      records.set(entry.name, {
        id: entry.name,
        label: readSkillLabel(markdown, entry.name),
        summary: readSkillSummary(markdown),
        enabled,
        name: entry.name,
        sourcePath: entry.path,
      });
    }
  }
  return [...records.values()].sort((left, right) => left.label.localeCompare(right.label));
}

async function discoverSkillDirectories(root: string): Promise<Array<{ name: string; path: string }>> {
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const skills: Array<{ name: string; path: string }> = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }
    const skillDir = path.join(root, entry.name);
    try {
      const stat = await fs.stat(path.join(skillDir, "SKILL.md"));
      if (!stat.isFile()) {
        continue;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
    skills.push({
      name: entry.name,
      path: skillDir,
    });
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

function toCatalogEntry(
  skill: GlobalSkillRecord,
  providerSupport: readonly GlobalSkillProviderSupport[] | undefined,
): GlobalSkillCatalogEntry {
  return {
    id: skill.id,
    label: skill.label,
    summary: skill.summary,
    enabled: skill.enabled,
    providerSupport: [...(providerSupport ?? [])],
  };
}

function readSkillLabel(markdown: string, fallback: string): string {
  for (const line of contentLines(markdown)) {
    const match = line.match(/^#\s+(.+)$/u);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }
  return fallback;
}

function readSkillSummary(markdown: string): string | null {
  const paragraph: string[] = [];
  let inCodeBlock = false;
  for (const line of contentLines(markdown)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock || trimmed.length === 0 || trimmed.startsWith("#")) {
      if (paragraph.length > 0 && trimmed.length === 0) {
        break;
      }
      continue;
    }
    paragraph.push(trimmed);
  }
  return paragraph.length > 0 ? paragraph.join(" ") : null;
}

function contentLines(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") {
    return lines;
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  return closingIndex >= 0 ? lines.slice(closingIndex + 1) : lines;
}
