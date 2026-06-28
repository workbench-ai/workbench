import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { quoteShellArg } from "@workbench-ai/workbench-core";

const MARKETPLACE_NAME = "workbench-trace";
const CODEX_PLUGIN_NAME = "workbench-trace-codex";
const CLAUDE_PLUGIN_NAME = "workbench-trace-claude-code";

export interface TraceHostPluginResult {
  host: string;
  state: "enabled" | "disabled" | "available" | "unavailable" | "unsupported" | "removed" | "error";
  detail: string;
  command?: string;
  path?: string;
}

export interface TraceRecordingHostPluginOptions {
  homeDir?: string;
  command?: string;
}

export function workbenchTraceHookCommand(): string {
  const override = process.env.WORKBENCH_TRACE_HOOK_COMMAND?.trim();
  if (override) {
    return override;
  }
  const bundledEntrypoint = path.resolve(import.meta.dirname, "..", "workbench.js");
  if (existsSync(bundledEntrypoint)) {
    return `${quoteShellArg(process.execPath)} ${quoteShellArg(bundledEntrypoint)} trace-hook --managed workbench-trace`;
  }
  return "workbench trace-hook --managed workbench-trace";
}

export function tracePluginMarketplaceRoot(): string {
  const override = process.env.WORKBENCH_TRACE_PLUGIN_ROOT?.trim();
  const candidates = [
    ...(override ? [override] : []),
    path.resolve(import.meta.dirname, ".."),
    path.resolve(import.meta.dirname, "../../../.."),
  ];
  for (const candidate of candidates) {
    if (
      existsSync(path.join(candidate, ".agents", "plugins", "marketplace.json")) ||
      existsSync(path.join(candidate, ".claude-plugin", "marketplace.json"))
    ) {
      return candidate;
    }
  }
  return candidates[0] ?? process.cwd();
}

export async function reconcileTraceHostPlugins(
  enabled: boolean,
  hosts: readonly string[],
  options: TraceRecordingHostPluginOptions = {},
): Promise<TraceHostPluginResult[]> {
  const initialStates = new Map<string, TraceHostPluginResult>();
  if (enabled) {
    const preflightResults = await preflightTraceHostPluginEnablement(hosts);
    if (preflightResults.some(isEnablementFailure)) {
      return preflightResults;
    }
    for (const host of hosts) {
      const [status] = await traceHostPluginStatus([host]);
      if (status) {
        initialStates.set(host, status);
      }
    }
  }
  const results: TraceHostPluginResult[] = [];
  for (const host of hosts) {
    const result = await reconcileTraceHostPlugin(enabled, host);
    results.push(result);
    if (enabled && isEnablementFailure(result)) {
      results.push(...await rollbackTraceHostPluginEnablement(hosts, host, initialStates));
      return results;
    }
  }
  if (!enabled) {
    results.push(...await cleanupInterimTraceHostMutations(options.homeDir ?? os.homedir()));
  }
  return results;
}

async function reconcileTraceHostPlugin(enabled: boolean, host: string): Promise<TraceHostPluginResult> {
  if (host === "claude") {
    return enabled ? await enableClaudePlugin() : await disableClaudePlugin();
  }
  if (host === "codex") {
    return enabled ? await enableCodexPlugin() : await disableCodexPlugin();
  }
  return {
    host,
    state: "unsupported",
    detail: `${host}: unsupported host`,
  };
}

async function rollbackTraceHostPluginEnablement(
  hosts: readonly string[],
  failedHost: string,
  initialStates: ReadonlyMap<string, TraceHostPluginResult>,
): Promise<TraceHostPluginResult[]> {
  const rollbackHosts = hosts.slice(0, hosts.indexOf(failedHost) + 1)
    .filter((host) => initialStates.get(host)?.state !== "enabled")
    .reverse();
  const results: TraceHostPluginResult[] = [];
  for (const host of rollbackHosts) {
    const result = await reconcileTraceHostPlugin(false, host);
    results.push({
      ...result,
      detail: `${result.host}: rollback after failed record on; ${result.detail}`,
    });
  }
  return results;
}

async function preflightTraceHostPluginEnablement(hosts: readonly string[]): Promise<TraceHostPluginResult[]> {
  const results: TraceHostPluginResult[] = [];
  for (const host of hosts) {
    if (host === "claude") {
      results.push(await preflightClaudePluginEnablement());
    } else if (host === "codex") {
      results.push(await preflightCodexPluginEnablement());
    } else {
      results.push({
        host,
        state: "unsupported",
        detail: `${host}: unsupported host`,
      });
    }
  }
  return results;
}

function isEnablementFailure(result: TraceHostPluginResult): boolean {
  return result.state === "error" || result.state === "unavailable" || result.state === "unsupported";
}

export async function traceHostPluginStatus(hosts: readonly string[]): Promise<TraceHostPluginResult[]> {
  const results: TraceHostPluginResult[] = [];
  for (const host of hosts) {
    if (host === "claude") {
      results.push(await claudePluginStatus());
    } else if (host === "codex") {
      results.push(await codexPluginStatus());
    } else {
      results.push({ host, state: "unsupported", detail: `${host}: unsupported host` });
    }
  }
  return results;
}

export async function cleanupInterimTraceHostMutations(homeDir = os.homedir()): Promise<TraceHostPluginResult[]> {
  return [
    await cleanupClaudeSettingsHooks(homeDir),
    await cleanupCodexNotifyWrapper(homeDir),
  ].filter((result): result is TraceHostPluginResult => result !== null);
}

async function enableClaudePlugin(): Promise<TraceHostPluginResult> {
  if (!await commandIsAvailable("claude", ["plugin", "--help"])) {
    return {
      host: "claude",
      state: "unavailable",
      detail: "claude: CLI not available; cannot install Workbench tracing plugin",
      command: "claude plugin marketplace add <workbench-root>",
    };
  }
  const marketplaceRoot = tracePluginMarketplaceRoot();
  const pluginRoot = path.join(marketplaceRoot, "plugins", "trace-claude-code");
  const validation = await runCommand("claude", ["plugin", "validate", pluginRoot]);
  if (validation.code !== 0) {
    return {
      host: "claude",
      state: "error",
      detail: `claude: Workbench plugin failed validation: ${compactCommandOutput(validation)}`,
      command: `claude plugin validate ${quoteShellArg(pluginRoot)}`,
      path: pluginRoot,
    };
  }
  if (!await claudeMarketplaceIsRegistered()) {
    const add = await runCommand("claude", ["plugin", "marketplace", "add", marketplaceRoot, "--scope", "user"]);
    if (add.code !== 0) {
      return {
        host: "claude",
        state: "error",
        detail: `claude: failed to add Workbench marketplace: ${compactCommandOutput(add)}`,
        command: `claude plugin marketplace add ${quoteShellArg(marketplaceRoot)} --scope user`,
        path: marketplaceRoot,
      };
    }
  }
  const pluginId = `${CLAUDE_PLUGIN_NAME}@${MARKETPLACE_NAME}`;
  const installed = await claudeInstalledPlugin(pluginId);
  if (installed?.enabled === true) {
    return {
      host: "claude",
      state: "enabled",
      detail: `claude: Workbench plugin enabled (${pluginId})`,
      path: installed.installPath,
    };
  }
  if (installed && installed.enabled === false) {
    const enabled = await runCommand("claude", ["plugin", "enable", pluginId, "--scope", "user"]);
    if (enabled.code !== 0) {
      return {
        host: "claude",
        state: "error",
        detail: `claude: failed to enable Workbench plugin: ${compactCommandOutput(enabled)}`,
        command: `claude plugin enable ${pluginId} --scope user`,
      };
    }
    return { host: "claude", state: "enabled", detail: `claude: Workbench plugin enabled (${pluginId})` };
  }
  const install = await runCommand("claude", ["plugin", "install", pluginId, "--scope", "user"]);
  if (install.code !== 0) {
    return {
      host: "claude",
      state: "error",
      detail: `claude: failed to install Workbench plugin: ${compactCommandOutput(install)}`,
      command: `claude plugin install ${pluginId} --scope user`,
    };
  }
  return { host: "claude", state: "enabled", detail: `claude: Workbench plugin installed (${pluginId})` };
}

async function preflightClaudePluginEnablement(): Promise<TraceHostPluginResult> {
  if (!await commandIsAvailable("claude", ["plugin", "--help"])) {
    return {
      host: "claude",
      state: "unavailable",
      detail: "claude: CLI not available; cannot install Workbench tracing plugin",
      command: "claude plugin marketplace add <workbench-root>",
    };
  }
  const marketplaceRoot = tracePluginMarketplaceRoot();
  const pluginRoot = path.join(marketplaceRoot, "plugins", "trace-claude-code");
  const validation = await runCommand("claude", ["plugin", "validate", pluginRoot]);
  if (validation.code !== 0) {
    return {
      host: "claude",
      state: "error",
      detail: `claude: Workbench plugin failed validation: ${compactCommandOutput(validation)}`,
      command: `claude plugin validate ${quoteShellArg(pluginRoot)}`,
      path: pluginRoot,
    };
  }
  return {
    host: "claude",
    state: "available",
    detail: `claude: Workbench plugin can be enabled from ${marketplaceRoot}`,
    path: pluginRoot,
  };
}

async function disableClaudePlugin(): Promise<TraceHostPluginResult> {
  if (!await commandIsAvailable("claude", ["plugin", "--help"])) {
    return {
      host: "claude",
      state: "unavailable",
      detail: "claude: CLI not available; local Workbench recording config was still disabled",
    };
  }
  const pluginId = `${CLAUDE_PLUGIN_NAME}@${MARKETPLACE_NAME}`;
  const installed = await claudeInstalledPlugin(pluginId);
  if (installed) {
    const uninstalled = await runCommand("claude", ["plugin", "uninstall", pluginId, "--scope", "user", "--yes"]);
    if (uninstalled.code !== 0) {
      const output = compactCommandOutput(uninstalled);
      if (!describesMissingPluginTarget(output)) {
        return {
          host: "claude",
          state: "error",
          detail: `claude: failed to uninstall Workbench plugin: ${output}`,
          command: `claude plugin uninstall ${pluginId} --scope user --yes`,
        };
      }
    }
  }
  const marketplaceRemoved = await runCommand("claude", ["plugin", "marketplace", "remove", MARKETPLACE_NAME]);
  if (marketplaceRemoved.code !== 0) {
    const output = compactCommandOutput(marketplaceRemoved);
    if (describesMissingPluginTarget(output)) {
      return { host: "claude", state: "removed", detail: "claude: Workbench plugin and marketplace already absent" };
    }
    return {
      host: "claude",
      state: "error",
      detail: `claude: failed to remove Workbench marketplace: ${output}`,
      command: `claude plugin marketplace remove ${MARKETPLACE_NAME}`,
    };
  }
  return { host: "claude", state: "removed", detail: `claude: Workbench plugin and marketplace removed (${pluginId})` };
}

async function claudePluginStatus(): Promise<TraceHostPluginResult> {
  if (!await commandIsAvailable("claude", ["plugin", "--help"])) {
    return { host: "claude", state: "unavailable", detail: "claude: CLI not available" };
  }
  const pluginId = `${CLAUDE_PLUGIN_NAME}@${MARKETPLACE_NAME}`;
  const installed = await claudeInstalledPlugin(pluginId);
  if (!installed) {
    return {
      host: "claude",
      state: "available",
      detail: `claude: Workbench plugin available from ${tracePluginMarketplaceRoot()}`,
      command: `claude plugin install ${pluginId} --scope user`,
    };
  }
  return {
    host: "claude",
    state: installed.enabled ? "enabled" : "disabled",
    detail: `claude: Workbench plugin ${installed.enabled ? "enabled" : "disabled"} (${pluginId})`,
    path: installed.installPath,
  };
}

async function enableCodexPlugin(): Promise<TraceHostPluginResult> {
  if (!await commandIsAvailable("codex", ["plugin", "--help"])) {
    return {
      host: "codex",
      state: "unavailable",
      detail: "codex: CLI not available; cannot install Workbench tracing plugin",
      command: "codex plugin marketplace add <workbench-root>",
    };
  }
  const marketplaceRoot = tracePluginMarketplaceRoot();
  if (!await commandIsAvailable("codex", ["plugin", "add", "--help"])) {
    return {
      host: "codex",
      state: "unsupported",
      detail: "codex: this Codex CLI exposes marketplace add/remove but not plugin add; update Codex or enable the Workbench Trace Codex plugin in a plugin-capable host",
      command: `codex plugin add ${CODEX_PLUGIN_NAME} --marketplace ${MARKETPLACE_NAME}`,
      path: marketplaceRoot,
    };
  }
  const removed = await runCommand("codex", ["plugin", "marketplace", "remove", MARKETPLACE_NAME]);
  void removed;
  const added = await runCommand("codex", ["plugin", "marketplace", "add", marketplaceRoot]);
  if (added.code !== 0) {
    return {
      host: "codex",
      state: "error",
      detail: `codex: failed to add Workbench marketplace: ${compactCommandOutput(added)}`,
      command: `codex plugin marketplace add ${quoteShellArg(marketplaceRoot)}`,
      path: marketplaceRoot,
    };
  }
  await runCommand("codex", ["plugin", "remove", `${CODEX_PLUGIN_NAME}@${MARKETPLACE_NAME}`]);
  const installed = await runCommand("codex", ["plugin", "add", CODEX_PLUGIN_NAME, "--marketplace", MARKETPLACE_NAME]);
  if (installed.code !== 0) {
    return {
      host: "codex",
      state: "error",
      detail: `codex: failed to install Workbench plugin: ${compactCommandOutput(installed)}`,
      command: `codex plugin add ${CODEX_PLUGIN_NAME} --marketplace ${MARKETPLACE_NAME}`,
    };
  }
  return { host: "codex", state: "enabled", detail: `codex: Workbench plugin installed (${CODEX_PLUGIN_NAME}@${MARKETPLACE_NAME})` };
}

async function preflightCodexPluginEnablement(): Promise<TraceHostPluginResult> {
  if (!await commandIsAvailable("codex", ["plugin", "--help"])) {
    return {
      host: "codex",
      state: "unavailable",
      detail: "codex: CLI not available; cannot install Workbench tracing plugin",
      command: "codex plugin marketplace add <workbench-root>",
    };
  }
  const marketplaceRoot = tracePluginMarketplaceRoot();
  if (!await commandIsAvailable("codex", ["plugin", "add", "--help"])) {
    return {
      host: "codex",
      state: "unsupported",
      detail: "codex: this Codex CLI exposes marketplace add/remove but not plugin add; update Codex or enable the Workbench Trace Codex plugin in a plugin-capable host",
      command: `codex plugin add ${CODEX_PLUGIN_NAME} --marketplace ${MARKETPLACE_NAME}`,
      path: marketplaceRoot,
    };
  }
  return {
    host: "codex",
    state: "available",
    detail: `codex: Workbench plugin can be enabled from ${marketplaceRoot}`,
    path: marketplaceRoot,
  };
}

async function disableCodexPlugin(): Promise<TraceHostPluginResult> {
  if (!await commandIsAvailable("codex", ["plugin", "--help"])) {
    return {
      host: "codex",
      state: "unavailable",
      detail: "codex: CLI not available; local Workbench recording config was still disabled",
    };
  }
  if (await commandIsAvailable("codex", ["plugin", "remove", "--help"])) {
    const pluginRemoved = await runCommand("codex", ["plugin", "remove", `${CODEX_PLUGIN_NAME}@${MARKETPLACE_NAME}`]);
    if (pluginRemoved.code !== 0) {
      const output = compactCommandOutput(pluginRemoved);
      if (!describesMissingPluginTarget(output)) {
        return {
          host: "codex",
          state: "error",
          detail: `codex: failed to remove Workbench plugin: ${output}`,
          command: `codex plugin remove ${CODEX_PLUGIN_NAME}@${MARKETPLACE_NAME}`,
        };
      }
    }
  }
  const removed = await runCommand("codex", ["plugin", "marketplace", "remove", MARKETPLACE_NAME]);
  if (removed.code !== 0) {
    const output = compactCommandOutput(removed);
    if (describesMissingPluginTarget(output)) {
      return { host: "codex", state: "removed", detail: "codex: Workbench marketplace already absent" };
    }
    return {
      host: "codex",
      state: "error",
      detail: `codex: failed to remove Workbench marketplace: ${output}`,
      command: `codex plugin marketplace remove ${MARKETPLACE_NAME}`,
    };
  }
  return { host: "codex", state: "removed", detail: "codex: Workbench marketplace removed" };
}

async function codexPluginStatus(): Promise<TraceHostPluginResult> {
  if (!await commandIsAvailable("codex", ["plugin", "--help"])) {
    return { host: "codex", state: "unavailable", detail: "codex: CLI not available" };
  }
  if (!await commandIsAvailable("codex", ["plugin", "add", "--help"])) {
    return {
      host: "codex",
      state: "unsupported",
      detail: "codex: installed CLI exposes marketplace add/remove but not plugin add/list",
      command: `codex plugin add ${CODEX_PLUGIN_NAME} --marketplace ${MARKETPLACE_NAME}`,
    };
  }
  const pluginId = `${CODEX_PLUGIN_NAME}@${MARKETPLACE_NAME}`;
  const installed = await codexInstalledPlugin(pluginId);
  if (installed) {
    return {
      host: "codex",
      state: installed.enabled ? "enabled" : "disabled",
      detail: `codex: Workbench plugin ${installed.enabled ? "enabled" : "disabled"} (${pluginId})`,
      ...(installed.installPath ? { path: installed.installPath } : {}),
    };
  }
  return {
    host: "codex",
    state: "available",
    detail: `codex: Workbench plugin available from ${tracePluginMarketplaceRoot()}`,
    command: `codex plugin add ${CODEX_PLUGIN_NAME} --marketplace ${MARKETPLACE_NAME}`,
  };
}

interface ClaudeInstalledPlugin {
  id: string;
  enabled: boolean;
  installPath?: string;
}

interface CodexInstalledPlugin {
  id: string;
  enabled: boolean;
  installPath?: string;
}

async function claudeMarketplaceIsRegistered(): Promise<boolean> {
  const result = await runCommand("claude", ["plugin", "marketplace", "list", "--json"]);
  if (result.code !== 0) {
    return false;
  }
  const parsed = parseJson(result.stdout);
  return Array.isArray(parsed) && parsed.some((entry) => {
    const record = asRecord(entry);
    return record?.name === MARKETPLACE_NAME;
  });
}

async function claudeInstalledPlugin(pluginId: string): Promise<ClaudeInstalledPlugin | null> {
  const result = await runCommand("claude", ["plugin", "list", "--json"]);
  if (result.code !== 0) {
    return null;
  }
  const parsed = parseJson(result.stdout);
  if (!Array.isArray(parsed)) {
    return null;
  }
  for (const entry of parsed) {
    const record = asRecord(entry);
    if (record?.id !== pluginId) {
      continue;
    }
    return {
      id: pluginId,
      enabled: record.enabled === true,
      ...(typeof record.installPath === "string" ? { installPath: record.installPath } : {}),
    };
  }
  return null;
}

async function codexInstalledPlugin(pluginId: string): Promise<CodexInstalledPlugin | null> {
  const result = await runCommand("codex", ["plugin", "list", "--json"]);
  if (result.code !== 0) {
    return null;
  }
  const parsed = parseJson(result.stdout);
  const parsedRecord = asRecord(parsed);
  const entries = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsedRecord?.installed)
      ? parsedRecord.installed
      : [];
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const id = typeof record?.pluginId === "string"
      ? record.pluginId
      : typeof record?.id === "string"
        ? record.id
        : null;
    if (id !== pluginId) {
      continue;
    }
    const source = asRecord(record.source);
    return {
      id: pluginId,
      enabled: record.enabled !== false,
      ...(typeof source?.path === "string" ? { installPath: source.path } : {}),
    };
  }
  return null;
}

async function cleanupClaudeSettingsHooks(homeDir: string): Promise<TraceHostPluginResult | null> {
  const settingsPath = path.join(homeDir, ".claude", "settings.json");
  const settings = await readJsonObjectFile(settingsPath);
  if (!settings) {
    return null;
  }
  const hooks = asRecord(settings.hooks);
  if (!hooks) {
    return null;
  }
  const nextHooks: Record<string, unknown> = {};
  let removed = 0;
  for (const [event, value] of Object.entries(hooks)) {
    if (!Array.isArray(value)) {
      nextHooks[event] = value;
      continue;
    }
    const entries = value.filter((entry) => {
      if (isWorkbenchInterimClaudeHook(entry)) {
        removed += 1;
        return false;
      }
      return true;
    });
    if (entries.length > 0) {
      nextHooks[event] = entries;
    }
  }
  if (removed === 0) {
    return null;
  }
  const next = { ...settings };
  if (Object.keys(nextHooks).length > 0) {
    next.hooks = nextHooks;
  } else {
    delete next.hooks;
  }
  await writeJsonObjectFile(settingsPath, next);
  return { host: "claude", state: "removed", detail: `claude: removed ${removed} interim Workbench settings hook${removed === 1 ? "" : "s"}` };
}

function isWorkbenchInterimClaudeHook(entry: unknown): boolean {
  const record = asRecord(entry);
  const hooks = Array.isArray(record?.hooks) ? record.hooks : [];
  return hooks.some((hook) => {
    const hookRecord = asRecord(hook);
    return typeof hookRecord?.command === "string" &&
      hookRecord.command.includes("trace-hook") &&
      hookRecord.command.includes("workbench-trace");
  });
}

async function cleanupCodexNotifyWrapper(homeDir: string): Promise<TraceHostPluginResult | null> {
  const configPath = path.join(homeDir, ".codex", "config.toml");
  const wrapperPath = path.join(homeDir, ".workbench", "traces", "codex-notify.sh");
  const originalPath = path.join(homeDir, ".workbench", "traces", "codex-notify-original.json");
  const source = await readTextFileIfExists(configPath);
  if (source === null) {
    const removed = await removeWorkbenchOwnedCodexNotifyFiles(wrapperPath, originalPath);
    return removed ? { host: "codex", state: "removed", detail: "codex: removed orphaned interim Workbench notify files" } : null;
  }
  const notify = extractCodexNotify(source);
  if (!isWorkbenchInterimCodexNotify(notify, wrapperPath)) {
    const removed = await removeWorkbenchOwnedCodexNotifyFiles(wrapperPath, originalPath);
    return removed ? { host: "codex", state: "removed", detail: "codex: removed orphaned interim Workbench notify files" } : null;
  }
  const restored = await readSavedCodexNotify(homeDir, wrapperPath);
  const next = restored ? setCodexNotify(source, restored) : removeCodexNotify(source);
  await fs.writeFile(configPath, next, "utf8");
  await removeWorkbenchOwnedCodexNotifyFiles(wrapperPath, originalPath);
  return { host: "codex", state: "removed", detail: "codex: removed interim Workbench notify wrapper" };
}

async function removeWorkbenchOwnedCodexNotifyFiles(wrapperPath: string, originalPath: string): Promise<boolean> {
  let removed = false;
  if (await readTextFileIfExists(wrapperPath) !== null) {
    await fs.rm(wrapperPath, { force: true });
    removed = true;
  }
  if (await readTextFileIfExists(originalPath) !== null) {
    await fs.rm(originalPath, { force: true });
    removed = true;
  }
  return removed;
}

async function readSavedCodexNotify(homeDir: string, wrapperPath: string): Promise<string[] | null> {
  const original = await readJsonObjectFile(path.join(homeDir, ".workbench", "traces", "codex-notify-original.json"));
  const notify = Array.isArray(original?.notify) ? original.notify.filter((entry): entry is string => typeof entry === "string") : null;
  return isWorkbenchInterimCodexNotify(notify, wrapperPath) ? null : notify;
}

function isWorkbenchInterimCodexNotify(notify: readonly string[] | null, wrapperPath: string): boolean {
  return notify?.length === 1 && path.resolve(notify[0]!) === path.resolve(wrapperPath);
}

function extractCodexNotify(source: string): string[] | null {
  const line = source.split(/\r?\n/u).find((entry) => /^\s*notify\s*=/u.test(entry));
  if (!line) {
    return null;
  }
  const match = line.match(/^\s*notify\s*=\s*(\[.*\])\s*$/u);
  if (!match) {
    return null;
  }
  try {
    const parsed = JSON.parse(match[1]!) as unknown;
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function setCodexNotify(source: string, notify: readonly string[]): string {
  const line = `notify = [${notify.map((entry) => JSON.stringify(entry)).join(", ")}]`;
  const lines = source.split(/\r?\n/u);
  const index = lines.findIndex((entry) => /^\s*notify\s*=/u.test(entry));
  if (index >= 0) {
    lines[index] = line;
    return lines.join("\n").replace(/\n*$/u, "\n");
  }
  return `${source.replace(/\n*$/u, "\n")}${line}\n`;
}

function removeCodexNotify(source: string): string {
  return source.split(/\r?\n/u).filter((entry) => !/^\s*notify\s*=/u.test(entry)).join("\n").replace(/\n*$/u, "\n");
}

async function commandIsAvailable(command: string, args: readonly string[]): Promise<boolean> {
  const result = await runCommand(command, args);
  return result.code === 0;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCommand(command: string, args: readonly string[]): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve) => {
    const child = spawn(command, [...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => resolve({ code: 127, stdout: "", stderr: String(error) }));
    child.on("exit", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function compactCommandOutput(result: CommandResult): string {
  const text = `${result.stderr}\n${result.stdout}`.trim().replace(/\s+/gu, " ");
  return text.slice(0, 240) || `exit ${result.code}`;
}

function describesMissingPluginTarget(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes("already disabled") ||
    normalized.includes("not found") ||
    normalized.includes("not installed") ||
    normalized.includes("not registered") ||
    normalized.includes("not configured") ||
    normalized.includes("unknown marketplace") ||
    normalized.includes("no marketplace");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function readTextFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code) === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readJsonObjectFile(filePath: string): Promise<Record<string, unknown> | null> {
  const text = await readTextFileIfExists(filePath);
  if (!text?.trim()) {
    return null;
  }
  const parsed = parseJson(text);
  return asRecord(parsed);
}

async function writeJsonObjectFile(filePath: string, value: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
