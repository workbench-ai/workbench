import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  ProviderIntegrationCatalog,
  ProviderIntegrationCatalogEntry,
  ProviderIntegrationUpdate,
} from "@workbench-ai/flow-contracts";

interface CodexIntegrationRecord extends ProviderIntegrationCatalogEntry {
  ranges: Array<{ start: number; end: number }>;
}

interface TomlSection {
  path: string[];
  start: number;
  end: number;
}

export async function listCodexIntegrations(
  codexHomeDir: string,
): Promise<ProviderIntegrationCatalog> {
  const integrations = await listCodexMcpIntegrations(codexHomeDir);
  return {
    providerId: "openai/codex",
    providerLabel: "OpenAI Codex",
    integrations: integrations.map(toIntegrationEntry),
  };
}

export async function updateCodexIntegrations(args: {
  codexHomeDir: string;
  update: ProviderIntegrationUpdate;
}): Promise<ProviderIntegrationCatalog> {
  const integrations = await listCodexMcpIntegrations(args.codexHomeDir);
  validateRequestedIds(integrations, args.update.enabledIds);
  await applyCodexIntegrationSelection(
    args.codexHomeDir,
    integrations,
    new Set(args.update.enabledIds),
  );
  return await listCodexIntegrations(args.codexHomeDir);
}

export async function projectCodexIntegrations(args: {
  sourceCodexHomeDir: string;
  targetCodexHomeDir: string;
}): Promise<void> {
  const integrations = await listCodexMcpIntegrations(args.sourceCodexHomeDir);
  await appendEnabledCodexMcpServers(
    args.sourceCodexHomeDir,
    args.targetCodexHomeDir,
    integrations.filter((integration) => integration.enabled),
  );
}

export async function clearCodexLegacySkillRoots(codexHomeDir: string): Promise<void> {
  await Promise.all([
    fs.rm(path.join(codexHomeDir, "skills"), { recursive: true, force: true }),
    fs.rm(path.join(codexHomeDir, ".disabled-skills"), { recursive: true, force: true }),
  ]);
}

function toIntegrationEntry<T extends ProviderIntegrationCatalogEntry>(
  integration: T,
): ProviderIntegrationCatalogEntry {
  return {
    id: integration.id,
    label: integration.label,
    enabled: integration.enabled,
  };
}

async function listCodexMcpIntegrations(codexHomeDir: string): Promise<CodexIntegrationRecord[]> {
  const configPath = path.join(codexHomeDir, "config.toml");
  const raw = await readFileOrEmpty(configPath);
  if (!raw.trim()) {
    return [];
  }

  const lines = raw.split(/\n/u);
  const sections = parseTomlSections(lines);
  const groups = new Map<string, CodexIntegrationRecord>();

  for (const section of sections) {
    if (section.path[0] !== "mcp_servers" || !section.path[1]) {
      continue;
    }
    const integrationId = section.path[1];
    const existing = groups.get(integrationId) ?? {
      id: integrationId,
      label: integrationId,
      enabled: true,
      ranges: [],
    };
    existing.ranges.push({
      start: section.start,
      end: section.end,
    });
    if (section.path.length === 2) {
      existing.enabled = parseCodexMcpEnabled(lines, section.start, section.end);
    }
    groups.set(integrationId, existing);
  }

  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
}

async function applyCodexIntegrationSelection(
  codexHomeDir: string,
  integrations: CodexIntegrationRecord[],
  enabledIds: ReadonlySet<string>,
): Promise<void> {
  const configPath = path.join(codexHomeDir, "config.toml");
  const raw = await readFileOrEmpty(configPath);
  const lines = raw.split(/\n/u);
  const sections = parseTomlSections(lines);

  const rootRanges = integrations
    .map((integration) => {
      const range = sections.find(
        (section) =>
          section.path[0] === "mcp_servers" &&
          section.path[1] === integration.id &&
          section.path.length === 2,
      );
      return range ? { integration, range } : null;
    })
    .filter(
      (entry): entry is { integration: CodexIntegrationRecord; range: TomlSection } =>
        entry !== null,
    )
    .sort((left, right) => right.range.start - left.range.start);

  for (const entry of rootRanges) {
    const shouldEnable = enabledIds.has(entry.integration.id);
    const updatedSection = setCodexMcpEnabled(
      lines.slice(entry.range.start, entry.range.end + 1),
      shouldEnable,
    );
    lines.splice(
      entry.range.start,
      entry.range.end - entry.range.start + 1,
      ...updatedSection,
    );
  }

  await fs.mkdir(codexHomeDir, { recursive: true });
  await fs.writeFile(configPath, `${trimTrailingEmptyLines(lines).join("\n")}\n`, "utf8");
}

async function appendEnabledCodexMcpServers(
  sourceCodexHomeDir: string,
  targetCodexHomeDir: string,
  enabledIntegrations: CodexIntegrationRecord[],
): Promise<void> {
  if (enabledIntegrations.length === 0) {
    return;
  }

  const sourceRaw = await readFileOrEmpty(path.join(sourceCodexHomeDir, "config.toml"));
  if (!sourceRaw.trim()) {
    return;
  }

  const sourceLines = sourceRaw.split(/\n/u);
  const sections = parseTomlSections(sourceLines);
  const sectionLookup = new Map(
    sections
      .filter((section) => section.path[0] === "mcp_servers" && section.path[1])
      .map((section) => [sectionKey(section), section] as const),
  );

  const blocks = enabledIntegrations
    .map((integration) =>
      integration.ranges
        .map((range) => {
          const section = sectionLookup.get(`${integration.id}:${range.start}:${range.end}`);
          if (!section) {
            return "";
          }
          return sourceLines.slice(section.start, section.end + 1).join("\n").trimEnd();
        })
        .filter(Boolean)
        .join("\n\n"),
    )
    .filter(Boolean);

  if (blocks.length === 0) {
    return;
  }

  const targetConfigPath = path.join(targetCodexHomeDir, "config.toml");
  const targetRaw = await readFileOrEmpty(targetConfigPath);
  const prefix = targetRaw.trimEnd();
  const suffix = blocks.join("\n\n");
  await fs.mkdir(targetCodexHomeDir, { recursive: true });
  await fs.writeFile(
    targetConfigPath,
    `${prefix ? `${prefix}\n\n` : ""}${suffix}\n`,
    "utf8",
  );
}

function parseCodexMcpEnabled(lines: string[], start: number, end: number): boolean {
  for (let index = start + 1; index <= end; index += 1) {
    const match = lines[index]?.match(/^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/u);
    if (!match) {
      continue;
    }
    return match[1] !== "false";
  }
  return true;
}

function setCodexMcpEnabled(sectionLines: string[], enabled: boolean): string[] {
  const nextLines = [...sectionLines];
  const enabledLine = `enabled = ${enabled ? "true" : "false"}`;
  for (let index = 1; index < nextLines.length; index += 1) {
    if (/^\s*\[.+\]\s*$/u.test(nextLines[index] ?? "")) {
      nextLines.splice(index, 0, enabledLine);
      return nextLines;
    }
    if (/^\s*enabled\s*=/u.test(nextLines[index] ?? "")) {
      nextLines[index] = enabledLine;
      return nextLines;
    }
  }
  nextLines.splice(1, 0, enabledLine);
  return nextLines;
}

function parseTomlSections(lines: string[]): TomlSection[] {
  const sections: TomlSection[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^\s*\[(.+)\]\s*$/u);
    const rawPath = match?.[1];
    if (!rawPath) {
      continue;
    }
    const parsedPath = parseTomlPath(rawPath);
    if (parsedPath.length === 0) {
      continue;
    }
    const previous = sections.at(-1);
    if (previous) {
      previous.end = index - 1;
    }
    sections.push({
      path: parsedPath,
      start: index,
      end: lines.length - 1,
    });
  }
  return sections;
}

function parseTomlPath(raw: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inQuotes = false;
  let escaped = false;
  for (const char of raw.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "." && !inQuotes) {
      if (current.trim().length > 0) {
        segments.push(current.trim());
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) {
    segments.push(current.trim());
  }
  return segments;
}

function sectionKey(section: TomlSection): string {
  return `${section.path[1] ?? ""}:${section.start}:${section.end}`;
}

async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function trimTrailingEmptyLines(lines: string[]): string[] {
  const nextLines = [...lines];
  while (nextLines.length > 0 && nextLines.at(-1)?.trim() === "") {
    nextLines.pop();
  }
  return nextLines;
}

function validateRequestedIds(
  integrations: readonly ProviderIntegrationCatalogEntry[],
  requestedIds: readonly string[],
): void {
  const knownIds = new Set(integrations.map((integration) => integration.id));
  const unknown = requestedIds.filter((id) => !knownIds.has(id));
  if (unknown.length === 0) {
    return;
  }
  throw new Error(`Unknown integration ids: ${unknown.join(", ")}`);
}
