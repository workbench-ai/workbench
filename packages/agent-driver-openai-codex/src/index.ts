import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";

import {
  createCliHarnessManifest,
  defineHarnessProvider,
  type HarnessAdapter,
  type HarnessExecutionPlan,
  type HarnessManifest,
  type HarnessProvider,
  type HarnessReadinessCheckArgs,
  type HarnessRunResult,
  type HarnessAuth,
  type HarnessEvent,
  type JsonValue,
  type TraceSpan,
  applyNormalizedHarnessActivity,
  buildManagedHarnessEnv,
  createHarnessSession,
  createPendingHarnessTurn,
  codexHarnessEffortValues,
  ensureDir,
  getManagedHarnessHomePath,
  HarnessTraceBuilder,
  nowIso,
  persistStageSessionWorkspace,
  prepareStageSessionWorkspace,
  runHarnessPrepareCommand,
  resolveHarnessConfiguredEffort,
  resolveHarnessConfiguredModel,
  resolveRuntimeEnv,
  terminateProcess,
  type ActiveHarnessSession,
  type HarnessTraceReplayer,
  type HarnessTraceReplayerBuildArgs,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type NormalizedHarnessActivity,
  type PendingHarnessTurn,
  type StartSessionArgs,
  type StartTurnArgs,
  buildCanonicalToolCall,
} from "@workbench-ai/agent-driver";
import { z } from "zod";
import { codexHarnessPackageVersion } from "./package-version.js";
import {
  projectCodexGlobalSkills,
} from "./global-skills.js";
import {
  listCodexIntegrations,
  projectCodexIntegrations,
  updateCodexIntegrations,
} from "./integrations.js";

const CodexSecretRefAuthSchema = z
  .object({
    strategy: z.literal("secret_ref"),
    ref: z.string().min(1),
  })
  .strict();

const CodexProfilePathAuthSchema = z
  .object({
    strategy: z.literal("profile_path"),
    path: z.string().min(1),
  })
  .strict();

export const CodexHarnessAuthSchema = z.discriminatedUnion("strategy", [
  CodexSecretRefAuthSchema,
  CodexProfilePathAuthSchema,
]);

const CodexAzureModelProviderSchema = z
  .object({
    id: z.literal("azure"),
    base_url: z.string().trim().min(1),
    query_params: z
      .record(z.string().trim().min(1), z.string().trim().min(1))
      .optional(),
  })
  .strict();

const CodexHarnessSandboxModeSchema = z.enum([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);

export const CodexHarnessConfigSchema = z
  .object({
    sandbox_mode: CodexHarnessSandboxModeSchema.optional(),
    model_provider: CodexAzureModelProviderSchema.optional(),
  })
  .strict();

export type CodexHarnessAuth = z.infer<typeof CodexHarnessAuthSchema>;
export type CodexHarnessConfig = z.infer<typeof CodexHarnessConfigSchema>;
export type CodexHarnessModelProvider = z.infer<
  typeof CodexAzureModelProviderSchema
>;
export type CodexHarnessSandboxMode = z.infer<
  typeof CodexHarnessSandboxModeSchema
>;

function requireCanonicalAzureBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl.trim());
  const trimmedPath = parsed.pathname.replace(/\/+$/u, "");
  if (trimmedPath !== "/openai/v1") {
    throw new Error(
      "Codex Azure model_provider.base_url must be an absolute URL ending in /openai/v1.",
    );
  }
  parsed.pathname = trimmedPath;
  return parsed.toString().replace(/\/$/u, "");
}

export function createCodexHarnessDefinition(
  options: { executable?: string } = {},
) {
  return {
    id: "openai/codex",
    displayName: "OpenAI Codex",
    auth: CodexHarnessAuthSchema,
    config: CodexHarnessConfigSchema,
    defaults: {
      auth: {
        strategy: "secret_ref" as const,
        ref: "OPENAI_API_KEY",
      },
      model: "gpt-5.5",
      config: {},
    },
    capabilities: {
      supports_resume: true,
      supports_interrupt: true,
      required_runtime_capabilities: ["shell_execution", "dotenv_secrets"],
    },
    supportedWorkspaceModes: ["managed", "project"] as const,
    async checkReadiness(args: HarnessReadinessCheckArgs) {
      await CodexHarnessAdapter.ensureAuthReady(
        args.plan,
        args.repoRoot,
        args.runtimeHome,
      );
      CodexHarnessAdapter.validateConfiguredEffort(args.plan);
      return {
        availability_errors: [],
      };
    },
    create() {
      return new CodexHarnessAdapter(options.executable?.trim() || "codex");
    },
  };
}

export const codexHarnessDefinition = createCodexHarnessDefinition();
export const codexHarnessManifest: HarnessManifest = createCliHarnessManifest(
  codexHarnessDefinition,
);

export const codexHarnessProvider = codexHarness();

export {
  listCodexIntegrations,
  projectCodexIntegrations,
  updateCodexIntegrations,
} from "./integrations.js";
export {
  projectCodexGlobalSkills,
  syncCodexGlobalSkills,
} from "./global-skills.js";
export {
  codexWorkbenchProviderAuth,
} from "./workbench-auth.js";
export {
  codexLocalTraceAdapter,
} from "./local-traces.js";

export function codexHarness(options: { executable?: string } = {}) {
  const definition = createCodexHarnessDefinition(options);
  return defineHarnessProvider({
    manifest: createCliHarnessManifest(definition),
    schemas: {
      auth: definition.auth,
      config: definition.config,
    },
    checkReadiness: definition.checkReadiness,
    create: definition.create,
  });
}

interface CodexReplayEntry {
  at: string;
  method: string;
  payload: JsonValue;
}

const codexReplayMethods = new Set([
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "thread/tokenUsage/updated",
  "error",
]);

export const codexTraceReplayer: HarnessTraceReplayer<CodexReplayEntry> = {
  harnessId: codexHarnessManifest.id,
  parseRawReplayEntries(entries) {
    const replayEntries = parseCodexTraceReplayEntries(entries, (entry) => {
      if (
        entry.source !== "notification" ||
        typeof entry.at !== "string" ||
        typeof entry.method !== "string" ||
        !("payload" in entry)
      ) {
        return null;
      }
      return {
        at: entry.at,
        method: entry.method,
        payload: (entry.payload as JsonValue) ?? {},
      };
    });
    return replayEntries.length === 0 ? null : { entries: replayEntries };
  },
  parseHarnessReplayEntries(entries) {
    const replayEntries = parseCodexTraceReplayEntries(entries, (entry) => {
      if (
        typeof entry.at !== "string" ||
        typeof entry.name !== "string" ||
        entry.name.startsWith("claude/") ||
        !("payload" in entry)
      ) {
        return null;
      }
      return {
        at: entry.at,
        method: entry.name,
        payload: (entry.payload as JsonValue) ?? {},
      };
    });
    return replayEntries.length === 0 ? null : { entries: replayEntries };
  },
  async buildTraceBundle(args) {
    const trace = new HarnessTraceBuilder({
      attemptNumber: args.artifact.attempt_number,
      stageId: args.artifact.stage_id,
      stageRunIndex: args.artifact.run_index,
      stageSpanId: args.stageSpanId,
    });
    const promptAttributes = promptAttributesFromSpan(args.oldTurnSpan);
    const fakeSession = buildSyntheticHarnessSession(
      args,
      codexHarnessManifest.id,
    );

    for (const entry of args.source.entries) {
      if (!isJsonObject(entry.payload)) {
        continue;
      }
      const normalized = normalizeCodexNotification(
        fakeSession,
        {
          jsonrpc: "2.0",
          method: entry.method,
          params: entry.payload,
        } as JsonRpcNotification,
        entry.at,
      );
      for (const activity of normalized.activities) {
        if (
          activity.type === "turn.started" &&
          Object.keys(promptAttributes).length > 0
        ) {
          applyNormalizedHarnessActivity(trace, {
            ...activity,
            attributes: {
              ...(activity.attributes ?? {}),
              ...promptAttributes,
            },
          });
          continue;
        }
        applyNormalizedHarnessActivity(trace, activity);
      }
    }

    return trace.buildBundle(await args.readFinalOutput(), args.endedAt);
  },
};

interface CodexSessionState {
  attemptWorkspacePath: string;
  sessionWorkspacePath: string | null;
  childEnv: NodeJS.ProcessEnv;
  managedCodexHomeDir: string;
  profileSourceRoot: string | null;
  process: ChildProcessWithoutNullStreams;
  reader: readline.Interface;
  nextId: number;
  threadId: string | null;
  turnId: string | null;
  pendingResponses: Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >;
  pendingTurn: PendingHarnessTurn | null;
  preTurnStderrLines: string[];
  nativeCaCertificateError: string | null;
}

interface CodexNotificationNormalization {
  harnessEvent: HarnessEvent | null;
  activities: NormalizedHarnessActivity[];
}

interface PreparedManagedCodexHome {
  managedHomeDir: string;
  managedCodexHomeDir: string;
  profileSourceRoot: string | null;
  trustedProjectPaths: string[];
  childEnv: NodeJS.ProcessEnv;
}

type ResolvedCodexModelProvider =
  | {
      id: "openai";
    }
  | {
      id: "azure";
      baseUrl: string;
      queryParams: Record<string, string>;
    };

type ResolvedCodexProviderSelection =
  | {
      auth: CodexHarnessAuth;
      provider: Extract<ResolvedCodexModelProvider, { id: "openai" }>;
    }
  | {
      auth: Extract<CodexHarnessAuth, { strategy: "secret_ref" }>;
      provider: Extract<ResolvedCodexModelProvider, { id: "azure" }>;
    };

const DEFAULT_CODEX_RPC_RESPONSE_TIMEOUT_MS = 60_000;
const azureSecretRefOnlyError =
  "Codex Azure model_provider currently supports only secret_ref auth.";

interface ResolvedCodexApiKeyAuth {
  secretEnvName: string;
  apiKey: string;
}

type ResolvedCodexProfileAuth = {
  sourceRoot: string;
};

type WorkflowHarnessCancel = NonNullable<
  HarnessExecutionPlan["harness"]
>["cancel"];

export class CodexHarnessAdapter
  implements HarnessAdapter<CodexSessionState>
{
  readonly manifest = codexHarnessManifest;

  constructor(private readonly executable: string) {}

  static getManagedCodexHomeDir(stageSessionPath: string): string {
    return path.join(getManagedHarnessHomePath(stageSessionPath), ".codex");
  }

  static getConfigPath(codexHomeDir: string): string {
    return path.join(codexHomeDir, "config.toml");
  }

  static getAuthPath(codexHomeDir: string): string {
    return path.join(codexHomeDir, "auth.json");
  }

  static getManagedWorkspaceIgnoreEntries(
    plan: HarnessExecutionPlan,
  ): string[] {
    void plan;
    return [];
  }

  static classifyStderrForTrace(text: string): "empty" | "warning" | "error" {
    const lines = text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      return "empty";
    }

    let sawWarning = false;
    for (const line of lines) {
      const severityMatch = line.match(
        /\b(ERROR|FATAL|PANIC|WARN(?:ING)?|INFO|DEBUG|TRACE)\b/i,
      );
      const severity = severityMatch?.[1]?.toUpperCase();
      if (!severity) {
        return "error";
      }
      if (
        severity === "ERROR" ||
        severity === "FATAL" ||
        severity === "PANIC"
      ) {
        return "error";
      }
      sawWarning = true;
    }

    return sawWarning ? "warning" : "error";
  }

  static isNativeCaCertificateError(text: string): boolean {
    return /\bno native root CA certificates found\b/iu.test(text);
  }

  static nativeCaCertificateErrorMessage(original: string): string {
    const message =
      "Codex could not verify TLS certificates because the runtime image has no native root CA certificates. Install ca-certificates in environment/Dockerfile.";
    const originalMessage = original.trim();
    if (
      originalMessage.length === 0 ||
      CodexHarnessAdapter.isNativeCaCertificateError(originalMessage)
    ) {
      return message;
    }
    return `${message} Original error: ${originalMessage}`;
  }

  static requireApiKey(
    plan: HarnessExecutionPlan,
    repoRoot: string,
    runtimeHome?: string,
  ): string {
    return CodexHarnessAdapter.resolveApiKeyAuth(plan, repoRoot, runtimeHome)
      .apiKey;
  }

  static resolveApiKeyAuth(
    plan: HarnessExecutionPlan,
    repoRoot: string,
    runtimeHome?: string,
  ): ResolvedCodexApiKeyAuth {
    const auth = CodexHarnessAdapter.getHarnessAuth(plan);
    if (auth.strategy !== "secret_ref") {
      throw new Error("Codex secret_ref auth is required for API key access.");
    }
    const resolved = resolveRuntimeEnv(auth.ref, repoRoot, { runtimeHome });
    const apiKey = resolved.value?.trim();
    if (!apiKey) {
      const location = resolved.envPath ?? "the environment";
      throw new Error(
        `${auth.ref} must be set in ${location} before running Codex sessions.`,
      );
    }
    return {
      secretEnvName: auth.ref,
      apiKey,
    };
  }

  static resolveProviderSelection(
    plan: HarnessExecutionPlan,
  ): ResolvedCodexProviderSelection {
    const auth = CodexHarnessAdapter.getHarnessAuth(plan);
    const configuredProvider =
      CodexHarnessAdapter.getHarnessConfig(plan).model_provider;
    if (configuredProvider) {
      if (auth.strategy !== "secret_ref") {
        throw new Error(azureSecretRefOnlyError);
      }
      return {
        auth,
        provider: {
          id: "azure",
          baseUrl: requireCanonicalAzureBaseUrl(configuredProvider.base_url),
          queryParams: { ...(configuredProvider.query_params ?? {}) },
        },
      };
    }
    return {
      auth,
      provider: {
        id: "openai",
      },
    };
  }

  static resolveProfileAuth(
    plan: HarnessExecutionPlan,
    repoRoot: string,
  ): ResolvedCodexProfileAuth {
    const auth = CodexHarnessAdapter.getHarnessAuth(plan);
    if (auth.strategy !== "profile_path") {
      throw new Error("Codex profile_path auth is required for profile auth.");
    }
    const sourceRoot = path.resolve(repoRoot, auth.path);
    return { sourceRoot };
  }

  static async ensureAuthReady(
    plan: HarnessExecutionPlan,
    repoRoot: string,
    runtimeHome?: string,
  ): Promise<void> {
    const { auth } = CodexHarnessAdapter.resolveProviderSelection(plan);
    if (auth.strategy === "secret_ref") {
      CodexHarnessAdapter.resolveApiKeyAuth(plan, repoRoot, runtimeHome);
      return;
    }

    const { sourceRoot } = CodexHarnessAdapter.resolveProfileAuth(
      plan,
      repoRoot,
    );
    const authPath = path.join(sourceRoot, ".codex", "auth.json");
    await fs.access(authPath);
  }

  static validateConfiguredEffort(plan: HarnessExecutionPlan): void {
    const harness = CodexHarnessAdapter.getHarness(plan);
    const effort = resolveHarnessConfiguredEffort(
      harness,
      codexHarnessEffortValues,
    );
    if (harness.effort && !effort) {
      throw new Error(
        `Unsupported Codex effort "${harness.effort}". Expected one of ${codexHarnessEffortValues.join(", ")}.`,
      );
    }
  }

  static buildCodexEnv(
    paths: {
      homeDir: string;
      codexHomeDir: string;
    },
    parentEnv: NodeJS.ProcessEnv = process.env,
    options: {
      platform?: NodeJS.Platform;
    } = {},
  ): NodeJS.ProcessEnv {
    const nestedStageHome = CodexHarnessAdapter.looksLikeNestedStageHome(
      paths.homeDir,
    );
    const env = buildManagedHarnessEnv(parentEnv, {
      HOME: paths.homeDir,
      CODEX_HOME: paths.codexHomeDir,
    });
    if (nestedStageHome && typeof env.PATH === "string") {
      env.PATH = CodexHarnessAdapter.sanitizeNestedStagePath(env.PATH);
    }
    CodexHarnessAdapter.applyNestedDarwinProxyBypass(
      env,
      parentEnv,
      options.platform ?? process.platform,
      { nestedStageHome },
    );
    return env;
  }

  static applyNestedDarwinProxyBypass(
    env: NodeJS.ProcessEnv,
    parentEnv: NodeJS.ProcessEnv,
    platform: NodeJS.Platform = process.platform,
    options: {
      nestedStageHome?: boolean;
    } = {},
  ): void {
    if (platform !== "darwin") {
      return;
    }
    if (
      !options.nestedStageHome &&
      !CodexHarnessAdapter.looksLikeNestedStageFlowHome(parentEnv.FLOW_HOME)
    ) {
      return;
    }
    if (
      CodexHarnessAdapter.hasExplicitProxyConfig(parentEnv) ||
      CodexHarnessAdapter.hasExplicitProxyConfig(env)
    ) {
      return;
    }

    // Nested stage-session launches can inherit a Codex-managed shell context where
    // macOS system proxy discovery fails during app-server bootstrap. An explicit
    // env-level bypass keeps the child Codex process on direct network paths.
    const disabledProxyUrl = "http://127.0.0.1:9";
    env.HTTP_PROXY = disabledProxyUrl;
    env.HTTPS_PROXY = disabledProxyUrl;
    env.ALL_PROXY = disabledProxyUrl;
    env.http_proxy = disabledProxyUrl;
    env.https_proxy = disabledProxyUrl;
    env.all_proxy = disabledProxyUrl;
    env.NO_PROXY = "*";
    env.no_proxy = "*";
  }

  static looksLikeNestedStageFlowHome(value: string | undefined): boolean {
    if (typeof value !== "string") {
      return false;
    }
    return /[\\/]\.flow[\\/]executions[\\/][^\\/]+[\\/]stage-sessions[\\/][^\\/]+[\\/]home[\\/]\.flow$/u.test(
      value.trim(),
    );
  }

  static looksLikeNestedStageHome(value: string | undefined): boolean {
    if (typeof value !== "string") {
      return false;
    }
    return /[\\/]\.flow[\\/]executions[\\/][^\\/]+[\\/]stage-sessions[\\/][^\\/]+[\\/]home$/u.test(
      value.trim(),
    );
  }

  static sanitizeNestedStagePath(pathValue: string): string {
    const seen = new Set<string>();
    return pathValue
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => {
        if (entry.length === 0) {
          return false;
        }
        if (/[\\/]\.codex[\\/]tmp[\\/]arg0[\\/]/u.test(entry)) {
          return false;
        }
        if (seen.has(entry)) {
          return false;
        }
        seen.add(entry);
        return true;
      })
      .join(path.delimiter);
  }

  static isFatalBootstrapStderr(text: string): boolean {
    return (
      /thread 'main'.*panicked at/iu.test(text) ||
      /Attempted to create a NULL object/iu.test(text)
    );
  }

  static resolveBootstrapAttemptLimit(
    homeDir: string,
    platform: NodeJS.Platform = process.platform,
  ): number {
    if (
      platform === "darwin" &&
      CodexHarnessAdapter.looksLikeNestedStageHome(homeDir)
    ) {
      return 3;
    }
    return 1;
  }

  static shouldRetryBootstrapError(args: {
    error: Error;
    attempt: number;
    maxAttempts: number;
    homeDir: string;
    platform?: NodeJS.Platform;
  }): boolean {
    if (args.attempt >= args.maxAttempts) {
      return false;
    }
    if (
      (args.platform ?? process.platform) !== "darwin" ||
      !CodexHarnessAdapter.looksLikeNestedStageHome(args.homeDir)
    ) {
      return false;
    }

    return (
      /Timed out waiting for codex app-server response to initialize/iu.test(
        args.error.message,
      ) || CodexHarnessAdapter.isFatalBootstrapStderr(args.error.message)
    );
  }

  static buildManagedAppServerLaunchSpec(args: {
    command: string;
    homeDir: string;
    targetUserId: number | null;
    platform?: NodeJS.Platform;
  }): {
    command: string;
    args: string[];
  } {
    if (
      (args.platform ?? process.platform) === "darwin" &&
      CodexHarnessAdapter.looksLikeNestedStageHome(args.homeDir) &&
      args.targetUserId != null &&
      args.targetUserId >= 0
    ) {
      return {
        command: "launchctl",
        args: ["asuser", String(args.targetUserId), "sh", "-lc", args.command],
      };
    }
    return {
      command: "sh",
      args: ["-lc", args.command],
    };
  }

  static async resolveManagedLaunchUserId(
    workspacePath: string,
    homeDir: string,
  ): Promise<number | null> {
    for (const targetPath of [workspacePath, homeDir]) {
      try {
        const stat = await fs.stat(targetPath);
        if (
          typeof stat.uid === "number" &&
          Number.isInteger(stat.uid) &&
          stat.uid >= 0
        ) {
          return stat.uid;
        }
      } catch {
        // Fall back to the current process uid if filesystem ownership is unavailable.
      }
    }
    const getuid = process.getuid;
    if (typeof getuid === "function") {
      return getuid.call(process);
    }
    return null;
  }

  static hasExplicitProxyConfig(env: NodeJS.ProcessEnv): boolean {
    return [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "NO_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy",
      "no_proxy",
    ].some(
      (key) => typeof env[key] === "string" && env[key]!.trim().length > 0,
    );
  }

  static resolveSandboxMode(
    plan: HarnessExecutionPlan,
  ): CodexHarnessSandboxMode {
    return (
      CodexHarnessAdapter.getHarnessConfig(plan).sandbox_mode ??
      "workspace-write"
    );
  }

  static async resolveTrustedProjectPaths(
    workspacePath: string,
  ): Promise<string[]> {
    const paths = [
      workspacePath,
      ...CodexHarnessAdapter.deriveTrustedProjectPathAliases(workspacePath),
    ];
    const realpath = await fs.realpath(workspacePath).catch(() => null);
    if (realpath) {
      paths.push(
        realpath,
        ...CodexHarnessAdapter.deriveTrustedProjectPathAliases(realpath),
      );
    }
    return [...new Set(paths.map((value) => value.trim()).filter(Boolean))];
  }

  static deriveTrustedProjectPathAliases(workspacePath: string): string[] {
    const trimmed = workspacePath.trim();
    if (!trimmed) {
      return [];
    }

    const aliases: string[] = [];
    if (trimmed.startsWith("/var/") || trimmed.startsWith("/tmp/")) {
      aliases.push(`/private${trimmed}`);
    }
    if (
      trimmed.startsWith("/private/var/") ||
      trimmed.startsWith("/private/tmp/")
    ) {
      aliases.push(trimmed.slice("/private".length));
    }
    return aliases;
  }

  static async ensureHomeConfig(args: {
    plan: HarnessExecutionPlan;
    codexHomeDir: string;
    trustedProjectPaths?: string[];
  }): Promise<void> {
    const selection = CodexHarnessAdapter.resolveProviderSelection(args.plan);
    await ensureDir(args.codexHomeDir);
    const uniqueTrustedPaths = [
      ...new Set(
        (args.trustedProjectPaths ?? [])
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    const lines = [
      'forced_login_method = "api"',
      'cli_auth_credentials_store = "file"',
      "",
    ];
    if (selection.provider.id === "azure") {
      const authRef =
        selection.auth.strategy === "secret_ref" ? selection.auth.ref : null;
      if (!authRef) {
        throw new Error(azureSecretRefOnlyError);
      }
      lines.push('model_provider = "azure"');
      lines.push("");
      lines.push("[model_providers.azure]");
      lines.push('name = "Azure OpenAI"');
      lines.push(`base_url = ${quoteTomlString(selection.provider.baseUrl)}`);
      lines.push(`env_key = ${quoteTomlString(authRef)}`);
      lines.push('wire_api = "responses"');
      lines.push("");
      const queryParams = Object.entries(selection.provider.queryParams).sort(
        ([left], [right]) => left.localeCompare(right),
      );
      if (queryParams.length > 0) {
        lines.push("[model_providers.azure.query_params]");
        for (const [key, value] of queryParams) {
          lines.push(`${quoteTomlString(key)} = ${quoteTomlString(value)}`);
        }
        lines.push("");
      }
    }
    for (const projectPath of uniqueTrustedPaths) {
      lines.push(`[projects.${quoteTomlString(projectPath)}]`);
      lines.push('trust_level = "trusted"');
      lines.push("");
    }
    await fs.writeFile(
      CodexHarnessAdapter.getConfigPath(args.codexHomeDir),
      lines.join("\n"),
      "utf8",
    );
  }

  static getAppServerCommand(command: string): string {
    const trimmed = command.trim();
    return /\bapp-server\b/u.test(trimmed) ? trimmed : `${trimmed} app-server`;
  }

  static getLoginCommand(command: string): string {
    const appServerCommand = CodexHarnessAdapter.getAppServerCommand(command);
    const derived = appServerCommand.replace(
      /\bapp-server\b[\s\S]*$/u,
      "login --with-api-key",
    );
    return derived === appServerCommand
      ? "codex login --with-api-key"
      : derived;
  }

  static async hasSeededApiKeyAuth(
    apiKey: string,
    codexHomeDir: string,
  ): Promise<boolean> {
    try {
      const authJson = JSON.parse(
        await fs.readFile(
          CodexHarnessAdapter.getAuthPath(codexHomeDir),
          "utf8",
        ),
      ) as {
        auth_mode?: string;
        OPENAI_API_KEY?: string;
      };
      return (
        authJson.auth_mode === "apikey" && authJson.OPENAI_API_KEY === apiKey
      );
    } catch {
      return false;
    }
  }

  static async ensureManagedHomeAuth(
    plan: HarnessExecutionPlan,
    codexHomeDir: string,
    childEnv: NodeJS.ProcessEnv,
    command: string,
    repoRoot: string,
    trustedProjectPaths: string[] = [],
    runtimeHome?: string,
  ): Promise<{ profileSourceRoot: string | null }> {
    const { auth, provider } =
      CodexHarnessAdapter.resolveProviderSelection(plan);
    if (auth.strategy === "profile_path") {
      const { sourceRoot } = CodexHarnessAdapter.resolveProfileAuth(
        plan,
        repoRoot,
      );
      await ensureDir(codexHomeDir);
      await fs.copyFile(
        path.join(sourceRoot, ".codex", "auth.json"),
        CodexHarnessAdapter.getAuthPath(codexHomeDir),
      );
      await CodexHarnessAdapter.ensureHomeConfig({
        plan,
        codexHomeDir,
        trustedProjectPaths,
      });
      return { profileSourceRoot: sourceRoot };
    }

    const apiKeyAuth = CodexHarnessAdapter.resolveApiKeyAuth(
      plan,
      repoRoot,
      runtimeHome,
    );

    if (provider.id === "azure") {
      childEnv[apiKeyAuth.secretEnvName] = apiKeyAuth.apiKey;
    }

    await CodexHarnessAdapter.ensureHomeConfig({
      plan,
      codexHomeDir,
      trustedProjectPaths,
    });

    if (provider.id === "azure") {
      return { profileSourceRoot: null };
    }

    if (
      await CodexHarnessAdapter.hasSeededApiKeyAuth(
        apiKeyAuth.apiKey,
        codexHomeDir,
      )
    ) {
      return { profileSourceRoot: null };
    }

    const loginCommand = CodexHarnessAdapter.getLoginCommand(command);

    await new Promise<void>((resolve, reject) => {
      const child = spawn("sh", ["-lc", loginCommand], {
        cwd: repoRoot,
        env: childEnv,
        stdio: "pipe",
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(
          new Error(
            `codex login failed with code ${code ?? "null"} signal ${signal ?? "null"}: ${(stderr || stdout).trim()}`,
          ),
        );
      });

      child.stdin.end(apiKeyAuth.apiKey);
    });

    await CodexHarnessAdapter.ensureHomeConfig({
      plan,
      codexHomeDir,
      trustedProjectPaths,
    });
    return { profileSourceRoot: null };
  }

  static async prepareManagedCodexHome(args: {
    plan: HarnessExecutionPlan;
    workspacePath: string;
    stageSessionPath: string;
    repoRoot: string;
    command: string;
    runtimeHome?: string;
    parentEnv?: NodeJS.ProcessEnv;
  }): Promise<PreparedManagedCodexHome> {
    const managedHomeDir = getManagedHarnessHomePath(args.stageSessionPath);
    const managedCodexHomeDir = CodexHarnessAdapter.getManagedCodexHomeDir(
      args.stageSessionPath,
    );
    const childEnv = CodexHarnessAdapter.buildCodexEnv(
      {
        homeDir: managedHomeDir,
        codexHomeDir: managedCodexHomeDir,
      },
      args.parentEnv ?? process.env,
    );
    const trustedProjectPaths =
      await CodexHarnessAdapter.resolveTrustedProjectPaths(args.workspacePath);
    const auth = await CodexHarnessAdapter.ensureManagedHomeAuth(
      args.plan,
      managedCodexHomeDir,
      childEnv,
      args.command,
      args.repoRoot,
      trustedProjectPaths,
      args.runtimeHome,
    );
    const sourceHomeDir = resolveAmbientHomeDir(args.parentEnv);
    const sourceCodexHomeDir = resolveAmbientCodexHomeDir(
      args.parentEnv,
      sourceHomeDir,
    );
    if (sourceHomeDir && sourceCodexHomeDir) {
      await projectCodexGlobalSkills({
        sourceHomeDir,
        targetHomeDir: managedHomeDir,
        targetCodexHomeDir: managedCodexHomeDir,
      });
      await projectCodexIntegrations({
        sourceCodexHomeDir,
        targetCodexHomeDir: managedCodexHomeDir,
      });
    }
    return {
      managedHomeDir,
      managedCodexHomeDir,
      profileSourceRoot: auth.profileSourceRoot,
      trustedProjectPaths,
      childEnv,
    };
  }

  getManagedWorkspaceIgnoreEntries(plan: HarnessExecutionPlan): string[] {
    return CodexHarnessAdapter.getManagedWorkspaceIgnoreEntries(plan);
  }

  async startSession(
    args: StartSessionArgs,
  ): Promise<ActiveHarnessSession<CodexSessionState>> {
    const harness = CodexHarnessAdapter.getHarness(args.plan);
    const sandboxMode = CodexHarnessAdapter.resolveSandboxMode(args.plan);
    const configuredModel = resolveHarnessConfiguredModel(harness);
    const command = CodexHarnessAdapter.getAppServerCommand(this.executable);
    const preparedWorkspace = await prepareStageSessionWorkspace({
      workspaceMode: args.plan.workspace.mode,
      workspacePath: args.workspacePath,
      stageSessionPath: args.stageSessionPath,
      excludedTopLevelEntries: [".agents", ".codex"],
    });
    const { workspacePath, attemptWorkspacePath, sessionWorkspacePath } =
      preparedWorkspace;
    const { managedHomeDir, managedCodexHomeDir, profileSourceRoot, childEnv } =
      await CodexHarnessAdapter.prepareManagedCodexHome({
        plan: args.plan,
        workspacePath,
        stageSessionPath: args.stageSessionPath,
        repoRoot: args.repoRoot,
        command: this.executable,
        runtimeHome: args.runtimeHome,
        parentEnv: process.env,
      });
    await runHarnessPrepareCommand({
      plan: args.plan,
      workspacePath,
      stageSessionPath: args.stageSessionPath,
      childEnv,
    });
    const launchUserId = await CodexHarnessAdapter.resolveManagedLaunchUserId(
      workspacePath,
      managedHomeDir,
    );
    const launchSpec = CodexHarnessAdapter.buildManagedAppServerLaunchSpec({
      command,
      homeDir: managedHomeDir,
      targetUserId: launchUserId,
    });
    const maxBootstrapAttempts =
      CodexHarnessAdapter.resolveBootstrapAttemptLimit(managedHomeDir);
    let lastBootstrapError: Error | null = null;

    for (
      let bootstrapAttempt = 1;
      bootstrapAttempt <= maxBootstrapAttempts;
      bootstrapAttempt += 1
    ) {
      const child = spawn(launchSpec.command, launchSpec.args, {
        cwd: workspacePath,
        env: childEnv,
        stdio: "pipe",
      });

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      const reader = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      });

      const session = createHarnessSession({
        harnessId: this.manifest.id,
        attemptNumber: args.attemptNumber,
        stageId: args.stageId,
        stageRunIndex: args.stageRunIndex,
        harnessSession:
          args.sessionMode === "resume" ? (args.persistedSession ?? {}) : {},
      });

      const context: ActiveHarnessSession<CodexSessionState> = {
        adapter: this,
        ownerStageId: args.ownerStageId,
        session,
        state: {
          attemptWorkspacePath,
          sessionWorkspacePath,
          childEnv,
          managedCodexHomeDir,
          profileSourceRoot,
          process: child,
          reader,
          nextId: 1,
          threadId: null,
          turnId: null,
          pendingResponses: new Map(),
          pendingTurn: null,
          preTurnStderrLines: [],
          nativeCaCertificateError: null,
        },
      };

      reader.on("line", (line) => {
        this.handleLine(context, line);
      });

      child.stderr.on("data", (chunk) => {
        this.handleStderr(context, chunk.toString());
      });
      child.on("error", (error) => {
        this.rejectPendingResponses(
          context,
          this.withBootstrapStderr(context, error),
        );
        this.rejectPendingTurn(context, error);
      });
      child.on("exit", (code, signal) => {
        const error = this.withBootstrapStderr(
          context,
          new Error(
            `codex app-server exited early with code ${code ?? "null"} signal ${signal ?? "null"}`,
          ),
        );
        this.rejectPendingResponses(context, error);
        if (context.state.pendingTurn) {
          this.rejectPendingTurn(context, error);
        }
      });

      try {
        await this.request(context, "initialize", {
          clientInfo: {
            name: "flow",
            version: codexHarnessPackageVersion,
          },
          capabilities: {
            experimentalApi: true,
          },
        });
        this.notify(context, "initialized", undefined);

        const persistedThreadId =
          typeof args.persistedSession?.thread_id === "string" &&
          args.persistedSession.thread_id.trim().length > 0
            ? args.persistedSession.thread_id
            : null;

        if (args.sessionMode === "resume" && persistedThreadId) {
          const resumeResult = (await this.request(context, "thread/resume", {
            threadId: persistedThreadId,
            cwd: workspacePath,
            approvalPolicy: "never",
            sandbox: sandboxMode,
            config: {},
            ...(configuredModel ? { model: configuredModel } : {}),
          })) as { thread?: { id?: string } };
          context.state.threadId = resumeResult.thread?.id ?? persistedThreadId;
        } else {
          // Fresh stages still create a resumable lineage so a downstream `session: previous` stage can adopt it.
          const threadResult = (await this.request(context, "thread/start", {
            cwd: workspacePath,
            approvalPolicy: "never",
            sandbox: sandboxMode,
            config: {},
            ephemeral: false,
            experimentalRawEvents: false,
            persistExtendedHistory: true,
            ...(configuredModel ? { model: configuredModel } : {}),
          })) as { thread: { id: string } };
          context.state.threadId = threadResult.thread.id;
        }

        if (!context.state.threadId) {
          throw new Error("codex session did not yield a thread id");
        }
        context.session.harness_session.thread_id = context.state.threadId;
        return context;
      } catch (error) {
        const bootstrapError =
          error instanceof Error ? error : new Error(String(error));
        lastBootstrapError = bootstrapError;
        await terminateProcess(child, 1_000, 1_000).catch(() => undefined);
        if (
          !CodexHarnessAdapter.shouldRetryBootstrapError({
            error: bootstrapError,
            attempt: bootstrapAttempt,
            maxAttempts: maxBootstrapAttempts,
            homeDir: managedHomeDir,
          })
        ) {
          throw bootstrapError;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    throw lastBootstrapError ?? new Error("codex bootstrap failed");
  }

  async startTurn(
    context: ActiveHarnessSession<CodexSessionState>,
    args: StartTurnArgs,
  ): Promise<HarnessRunResult> {
    const harness = CodexHarnessAdapter.getHarness(args.plan);
    const configuredModel = resolveHarnessConfiguredModel(harness);
    const configuredEffort = resolveHarnessConfiguredEffort(
      harness,
      codexHarnessEffortValues,
    );
    const pendingTurn = createPendingHarnessTurn({
      session: context.session,
      eventsFile: args.eventsFile,
      rawEventsFile: args.rawEventsFile,
      stageSpanId: args.stageSpanId,
      promptText: args.prompt,
      turnTimeoutMs: harness.turn_timeout_ms,
      stallTimeoutMs: harness.stall_timeout_ms,
      onTimeout: (message) => {
        this.rejectPendingTurn(context, new Error(message));
        void this.closeSession(context);
      },
      livePersistence: args.livePersistence,
    });

    context.state.pendingTurn = pendingTurn;
    context.state.nativeCaCertificateError = null;

    pendingTurn.controller.record({
      normalized: {
        type: "turn.started",
        at: nowIso(),
        provider: codexHarnessManifest.id,
        model: configuredModel ?? null,
        sessionId: context.state.threadId,
      },
    });

    try {
      const response = (await this.request(context, "turn/start", {
        threadId: context.state.threadId,
        input: [
          {
            type: "text",
            text: args.prompt,
            text_elements: [],
          },
        ],
        cwd: undefined,
        approvalPolicy: "never",
        sandboxPolicy: undefined,
        collaborationMode: null,
        ...(configuredModel ? { model: configuredModel } : {}),
        ...(configuredEffort ? { effort: configuredEffort } : {}),
      })) as { turn: { id: string } };

      context.state.turnId = response.turn.id;
      context.session.harness_session.turn_id = response.turn.id;
    } catch (error) {
      this.rejectPendingTurn(
        context,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }

    return await pendingTurn.result;
  }

  async interruptTurn(
    context: ActiveHarnessSession<CodexSessionState>,
  ): Promise<void> {
    if (context.state.threadId && context.state.turnId) {
      await this.request(context, "turn/interrupt", {
        threadId: context.state.threadId,
        turnId: context.state.turnId,
      }).catch(() => undefined);
    }
  }

  async closeSession(
    context: ActiveHarnessSession<CodexSessionState>,
    cancelConfig?: WorkflowHarnessCancel,
  ): Promise<void> {
    const gracefulTimeoutMs = cancelConfig?.graceful_timeout_ms ?? 1_000;
    const hardKillTimeoutMs = cancelConfig?.hard_kill_timeout_ms ?? 1_000;

    await terminateProcess(
      context.state.process,
      gracefulTimeoutMs,
      hardKillTimeoutMs,
    );
    context.state.reader.close();
    await CodexHarnessAdapter.persistProfileAuthFromManagedHome({
      managedCodexHomeDir: context.state.managedCodexHomeDir,
      profileSourceRoot: context.state.profileSourceRoot,
    });
    await persistStageSessionWorkspace({
      sessionWorkspacePath: context.state.sessionWorkspacePath,
      attemptWorkspacePath: context.state.attemptWorkspacePath,
      excludedTopLevelEntries: [".agents", ".codex"],
    });
  }

  static async persistProfileAuthFromManagedHome(args: {
    managedCodexHomeDir: string;
    profileSourceRoot: string | null;
  }): Promise<void> {
    if (!args.profileSourceRoot) {
      return;
    }
    const targetAuthPath = path.join(args.profileSourceRoot, ".codex", "auth.json");
    await ensureDir(path.dirname(targetAuthPath));
    await fs.copyFile(
      CodexHarnessAdapter.getAuthPath(args.managedCodexHomeDir),
      targetAuthPath,
    );
  }

  static getHarness(
    plan: HarnessExecutionPlan,
  ): NonNullable<HarnessExecutionPlan["harness"]> {
    const harness = plan.harness;
    if (!harness) {
      throw new Error(
        `Expected ${codexHarnessManifest.id} harness, received no harness configuration`,
      );
    }
    if (harness.id !== codexHarnessManifest.id) {
      throw new Error(
        `Expected ${codexHarnessManifest.id} harness, received ${harness.id}`,
      );
    }
    return harness;
  }

  static getHarnessAuth(plan: HarnessExecutionPlan): CodexHarnessAuth {
    return CodexHarnessAuthSchema.parse(
      CodexHarnessAdapter.getHarness(plan).auth,
    );
  }

  static getHarnessConfig(plan: HarnessExecutionPlan): CodexHarnessConfig {
    return CodexHarnessConfigSchema.parse(
      CodexHarnessAdapter.getHarness(plan).config,
    );
  }

  private handleStderr(
    context: ActiveHarnessSession<CodexSessionState>,
    text: string,
  ): void {
    this.recordNativeCaCertificateError(context, text);
    const pendingTurn = context.state.pendingTurn;
    if (!pendingTurn) {
      this.capturePreTurnStderr(context, text);
      if (
        context.state.pendingResponses.size > 0 &&
        CodexHarnessAdapter.isFatalBootstrapStderr(text)
      ) {
        const error = this.withBootstrapStderr(
          context,
          new Error("codex app-server emitted fatal bootstrap stderr"),
        );
        this.rejectPendingResponses(context, error);
        void terminateProcess(context.state.process, 250, 250);
      }
      return;
    }

    const at = nowIso();
    const severity = CodexHarnessAdapter.classifyStderrForTrace(text);
    pendingTurn.controller.record({
      rawEnvelope: {
        at,
        source: "stderr",
        text,
      },
      harnessEvent: {
        at,
        attempt_number: context.session.attempt_number,
        stage_id: context.session.stage_id,
        stage_run_index: context.session.stage_run_index,
        phase: severity === "error" ? "error" : "session",
        name: "stderr",
        payload: {
          text,
          severity,
        },
      },
      normalized:
        severity === "error"
          ? {
              type: "error",
              at,
              message: text.trim() || "stderr",
              attributes: {
                stream: "stderr",
              },
            }
          : null,
    });
  }

  private handleLine(
    context: ActiveHarnessSession<CodexSessionState>,
    line: string,
  ): void {
    if (!line.trim()) {
      return;
    }

    let message: JsonRpcResponse | JsonRpcNotification | JsonRpcRequest;
    try {
      message = JSON.parse(line) as
        | JsonRpcResponse
        | JsonRpcNotification
        | JsonRpcRequest;
    } catch {
      const error = this.withBootstrapStderr(
        context,
        new Error(`Failed to parse app-server output: ${line}`),
      );
      this.rejectPendingResponses(context, error);
      this.rejectPendingTurn(context, error);
      return;
    }

    if ("id" in message && ("result" in message || "error" in message)) {
      const pending = context.state.pendingResponses.get(Number(message.id));
      if (!pending) {
        return;
      }

      context.state.pendingResponses.delete(Number(message.id));
      if ("error" in message && message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if ("id" in message && "method" in message && !("result" in message)) {
      const pendingTurn = context.state.pendingTurn;
      if (pendingTurn) {
        const at = nowIso();
        pendingTurn.controller.record({
          rawEnvelope: {
            at,
            source: "interactive_request",
            method: message.method,
            payload: "params" in message ? (message.params ?? {}) : {},
          },
          harnessEvent: {
            at,
            attempt_number: context.session.attempt_number,
            stage_id: context.session.stage_id,
            stage_run_index: context.session.stage_run_index,
            phase: "error",
            name: "interactive_request",
            payload: {
              method: message.method,
            },
          },
          normalized: {
            type: "error",
            at,
            message: `Interactive server request received: ${message.method}`,
            attributes: {
              method: message.method,
            },
          },
        });
      }
      this.rejectPendingTurn(
        context,
        new Error(`Interactive server request received: ${message.method}`),
      );
      this.rejectPendingResponses(
        context,
        new Error(`Interactive server request received: ${message.method}`),
      );
      void this.closeSession(context);
      return;
    }

    if (!("method" in message)) {
      return;
    }

    const pendingTurn = context.state.pendingTurn;
    const notification = message as JsonRpcNotification;
    if (!pendingTurn) {
      return;
    }

    this.recordNativeCaCertificateError(
      context,
      JSON.stringify(notification.params ?? {}),
    );

    const at = nowIso();
    context.session.last_event_at = at;
    const { harnessEvent, activities } = normalizeCodexNotification(
      context.session,
      notification,
      at,
    );
    pendingTurn.controller.record({
      rawEnvelope: {
        at,
        source: "notification",
        method: notification.method,
        payload: notification.params ?? {},
      },
      harnessEvent,
      normalized: activities,
    });

    if (notification.method !== "turn/completed") {
      return;
    }

    const turnStatus = (
      notification.params as {
        turn?: { status?: string; error?: { message?: string } | null };
      }
    ).turn;
    if (turnStatus?.status === "failed") {
      this.rejectPendingTurn(
        context,
        new Error(turnStatus.error?.message ?? "turn failed"),
      );
      return;
    }
    if (turnStatus?.status === "interrupted") {
      this.rejectPendingTurn(context, new Error("turn interrupted"));
      return;
    }

    const completedTurn = context.state.pendingTurn;
    if (!completedTurn) {
      return;
    }
    context.state.pendingTurn = null;
    completedTurn.resolve(completedTurn.controller.succeed({ endedAt: at }));
  }

  private async request(
    context: ActiveHarnessSession<CodexSessionState>,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    if (
      context.state.process.exitCode != null ||
      context.state.process.stdin.destroyed
    ) {
      throw new Error(
        `codex app-server is not running while sending ${method}`,
      );
    }

    const id = context.state.nextId++;
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    const timeoutMs = this.getRpcResponseTimeoutMs();

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        context.state.pendingResponses.delete(id);
        reject(
          this.withBootstrapStderr(
            context,
            new Error(
              `Timed out waiting for codex app-server response to ${method}`,
            ),
          ),
        );
        void terminateProcess(context.state.process, 1_000, 1_000);
      }, timeoutMs);
      context.state.pendingResponses.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      context.state.process.stdin.write(
        `${JSON.stringify(payload)}\n`,
        (error) => {
          if (!error) {
            return;
          }
          clearTimeout(timeout);
          context.state.pendingResponses.delete(id);
          reject(this.withBootstrapStderr(context, error));
        },
      );
    });
  }

  private notify(
    context: ActiveHarnessSession<CodexSessionState>,
    method: string,
    params: unknown,
  ): void {
    const payload = {
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    };
    context.state.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private rejectPendingTurn(
    context: ActiveHarnessSession<CodexSessionState>,
    error: Error,
  ): void {
    const pendingTurn = context.state.pendingTurn;
    if (!pendingTurn) {
      return;
    }

    context.state.pendingTurn = null;
    pendingTurn.controller.dispose();
    pendingTurn.reject(this.withNativeCaCertificateError(context, error));
  }

  private recordNativeCaCertificateError(
    context: ActiveHarnessSession<CodexSessionState>,
    text: string,
  ): void {
    if (CodexHarnessAdapter.isNativeCaCertificateError(text)) {
      context.state.nativeCaCertificateError = text.trim();
    }
  }

  private withNativeCaCertificateError(
    context: ActiveHarnessSession<CodexSessionState>,
    error: Error,
  ): Error {
    const combined = [
      error.message,
      context.state.nativeCaCertificateError ?? "",
    ].join("\n");
    if (!CodexHarnessAdapter.isNativeCaCertificateError(combined)) {
      return error;
    }
    return new Error(
      CodexHarnessAdapter.nativeCaCertificateErrorMessage(error.message),
    );
  }

  private rejectPendingResponses(
    context: ActiveHarnessSession<CodexSessionState>,
    error: Error,
  ): void {
    if (context.state.pendingResponses.size === 0) {
      return;
    }

    const pending = [...context.state.pendingResponses.values()];
    context.state.pendingResponses.clear();
    for (const response of pending) {
      response.reject(error);
    }
  }

  private capturePreTurnStderr(
    context: ActiveHarnessSession<CodexSessionState>,
    text: string,
  ): void {
    const lines = text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return;
    }
    context.state.preTurnStderrLines.push(...lines);
    if (context.state.preTurnStderrLines.length > 20) {
      context.state.preTurnStderrLines.splice(
        0,
        context.state.preTurnStderrLines.length - 20,
      );
    }
  }

  private withBootstrapStderr(
    context: ActiveHarnessSession<CodexSessionState>,
    error: Error,
  ): Error {
    if (context.state.pendingTurn) {
      return error;
    }
    if (context.state.preTurnStderrLines.length === 0) {
      return error;
    }
    return new Error(
      `${error.message}. codex stderr: ${context.state.preTurnStderrLines.join(" | ")}`,
    );
  }

  private getRpcResponseTimeoutMs(): number {
    const configured = Number(
      process.env.FLOW_CODEX_RPC_RESPONSE_TIMEOUT_MS ?? "",
    );
    if (Number.isFinite(configured) && configured > 0) {
      return configured;
    }
    return DEFAULT_CODEX_RPC_RESPONSE_TIMEOUT_MS;
  }
}

function quoteTomlString(value: string): string {
  return JSON.stringify(value);
}

export function normalizeCodexNotification(
  session: ActiveHarnessSession["session"],
  notification: JsonRpcNotification,
  at = nowIso(),
): CodexNotificationNormalization {
  const payload = (notification.params ?? {}) as Record<string, JsonValue>;
  const harnessEvent = normalizeCodexHarnessEvent(
    session,
    notification.method,
    payload,
    at,
  );
  const activities = normalizeCodexActivities(notification, at);
  return {
    harnessEvent,
    activities,
  };
}

function normalizeCodexHarnessEvent(
  session: ActiveHarnessSession["session"],
  method: string,
  payload: Record<string, JsonValue>,
  at: string,
): HarnessEvent | null {
  if (method === "thread/started" || method === "thread/status/changed") {
    return createCodexHarnessEvent(session, at, "session", method, payload);
  }

  if (method.startsWith("turn/")) {
    return createCodexHarnessEvent(session, at, "turn", method, payload);
  }

  if (method.startsWith("item/tool") || method.startsWith("item/mcpToolCall")) {
    return createCodexHarnessEvent(session, at, "tool", method, payload);
  }

  if (method.startsWith("item/")) {
    return createCodexHarnessEvent(session, at, "item", method, payload);
  }

  if (method === "thread/tokenUsage/updated") {
    return createCodexHarnessEvent(session, at, "usage", method, payload);
  }

  if (method === "error") {
    return createCodexHarnessEvent(session, at, "error", method, payload);
  }

  if (method.startsWith("codex/event/")) {
    const phase =
      payload.msg &&
      typeof payload.msg === "object" &&
      "type" in payload.msg &&
      payload.msg.type === "token_count"
        ? "usage"
        : "item";
    return createCodexHarnessEvent(session, at, phase, method, payload);
  }

  return null;
}

function createCodexHarnessEvent(
  session: ActiveHarnessSession["session"],
  at: string,
  phase: HarnessEvent["phase"],
  name: string,
  payload: Record<string, JsonValue>,
): HarnessEvent {
  return {
    at,
    attempt_number: session.attempt_number,
    stage_id: session.stage_id,
    stage_run_index: session.stage_run_index,
    phase,
    name,
    payload,
  };
}

function normalizeCodexActivities(
  notification: JsonRpcNotification,
  at: string,
): NormalizedHarnessActivity[] {
  const payload = (notification.params ?? {}) as Record<string, JsonValue>;

  if (notification.method === "turn/started") {
    return [
      {
        type: "turn.started",
        at,
        provider: codexHarnessManifest.id,
        sessionId: readPayloadString(payload, [["threadId"], ["thread_id"]]),
        operationId: readPayloadString(payload, [
          ["turn", "id"],
          ["turnId"],
          ["turn_id"],
        ]),
      },
    ];
  }

  if (notification.method === "turn/completed") {
    return [
      {
        type: "turn.completed",
        at,
        provider: codexHarnessManifest.id,
        sessionId: readPayloadString(payload, [["threadId"], ["thread_id"]]),
        operationId: readPayloadString(payload, [
          ["turn", "id"],
          ["turnId"],
          ["turn_id"],
        ]),
        status: readPayloadString(payload, [["turn", "status"]]),
        errorMessage: readPayloadString(payload, [
          ["turn", "error", "message"],
          ["error", "message"],
        ]),
      },
    ];
  }

  if (notification.method === "item/started") {
    const itemType = readPayloadString(payload, [["item", "type"]]);
    if (itemType === "agentMessage") {
      return [
        {
          type: "assistant_output.started",
          at,
          phase: readPayloadString(payload, [["item", "phase"]]),
          itemId: readPayloadString(payload, [
            ["item", "id"],
            ["itemId"],
            ["item_id"],
          ]),
        },
      ];
    }
    if (isCodexToolItemType(itemType)) {
      const toolCall = readCodexToolCall(itemType, payload, false);
      return [
        {
          type: "tool.started",
          at,
          toolId: readToolId(payload),
          toolName: toolCall.toolName,
          attributes: toolCall.attributes,
        },
      ];
    }
    return [];
  }

  if (notification.method === "item/completed") {
    const itemType = readPayloadString(payload, [["item", "type"]]);
    if (itemType === "agentMessage") {
      return [
        {
          type: "assistant_output.completed",
          at,
          text: readPayloadString(payload, [["item", "text"]]) ?? "",
          phase: readPayloadString(payload, [["item", "phase"]]),
          itemId: readPayloadString(payload, [
            ["item", "id"],
            ["itemId"],
            ["item_id"],
          ]),
        },
      ];
    }
    if (isCodexToolItemType(itemType)) {
      const toolCall = readCodexToolCall(itemType, payload, true);
      return [
        {
          type: "tool.completed",
          at,
          toolId: readToolId(payload),
          toolName: toolCall.toolName,
          attributes: toolCall.attributes,
        },
      ];
    }
    if (itemType === "fileChange") {
      const note = readCodexFileChangeNote(payload);
      return note ? [{ type: "note", at, ...note }] : [];
    }
    return [];
  }

  if (notification.method === "item/agentMessage/delta") {
    return [
      {
        type: "assistant_output.delta",
        at,
        delta: readPayloadString(payload, [["delta"]]) ?? "",
        phase: readPayloadString(payload, [["item", "phase"]]),
        itemId: readPayloadString(payload, [
          ["item", "id"],
          ["itemId"],
          ["item_id"],
        ]),
      },
    ];
  }

  if (notification.method === "thread/tokenUsage/updated") {
    const usage = readUsageSnapshot(payload);
    const cachedInputTokens = usage.cached_input_tokens;
    const uncachedInputTokens = usage.input_tokens != null && cachedInputTokens != null
      ? Math.max(usage.input_tokens - cachedInputTokens, 0)
      : null;
    return [
      {
        type: "usage.updated",
        at,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        attributes: {
          ...(uncachedInputTokens != null ? { uncached_input_tokens: uncachedInputTokens } : {}),
          ...(cachedInputTokens != null ? { cached_input_tokens: cachedInputTokens } : {}),
          ...(cachedInputTokens != null ? { cache_read_input_tokens: cachedInputTokens } : {}),
          ...(usage.reasoning_output_tokens != null ? { reasoning_output_tokens: usage.reasoning_output_tokens } : {}),
          ...(usage.total_tokens != null ? { total_tokens: usage.total_tokens } : {}),
        },
      },
    ];
  }

  if (notification.method === "error") {
    return [
      {
        type: "error",
        at,
        message:
          readPayloadString(payload, [["error", "message"], ["message"]]) ??
          "Harness error",
        attributes: payload,
      },
    ];
  }

  return [];
}

function isCodexToolItemType(itemType: string | null): boolean {
  return (
    itemType === "toolCall" ||
    itemType === "mcpToolCall" ||
    itemType === "commandExecution" ||
    itemType === "imageView" ||
    itemType === "webSearch"
  );
}

function readCodexToolCall(
  itemType: string | null,
  payload: Record<string, JsonValue>,
  includeResultPreview: boolean,
): ReturnType<typeof buildCanonicalToolCall> {
  const actionType = readPayloadString(payload, [
    ["item", "action", "type"],
    ["action", "type"],
  ]);
  const actionUrl = readPayloadString(payload, [
    ["item", "action", "url"],
    ["action", "url"],
  ]);
  const exitCode = readPayloadNumber(payload, [
    ["item", "exitCode"],
    ["exitCode"],
    ["item", "exit_code"],
    ["exit_code"],
  ]);
  const durationMs = readPayloadNumber(payload, [
    ["item", "durationMs"],
    ["durationMs"],
    ["item", "duration_ms"],
    ["duration_ms"],
  ]);
  const previewSource = includeResultPreview
    ? readPayloadString(payload, [
        ["item", "aggregatedOutput"],
        ["aggregatedOutput"],
      ]) ??
      readPayloadString(payload, [["item", "result"], ["result"]]) ??
      JSON.stringify(payload)
    : null;

  return buildCanonicalToolCall({
    canonicalToolName:
      itemType === "commandExecution"
        ? "shell"
        : itemType === "imageView"
          ? "image"
          : itemType === "webSearch"
            ? "web"
            : null,
    rawToolName:
      itemType === "commandExecution" ||
      itemType === "imageView" ||
      itemType === "webSearch"
        ? itemType
        : readToolName(payload),
    operation: actionType,
    command: readPayloadString(payload, [["item", "command"], ["command"]]),
    cwd: readPayloadString(payload, [["item", "cwd"], ["cwd"]]),
    query: readPayloadString(payload, [["item", "query"], ["query"]]),
    path: readPayloadString(payload, [["item", "path"], ["path"]]),
    url: actionUrl,
    resultPreview: previewSource ? truncateValue(previewSource, 160) : null,
    attributes: {
      ...(actionType ? { action_type: actionType } : {}),
      ...(actionUrl ? { action_url: actionUrl } : {}),
      ...(exitCode != null ? { exit_code: exitCode } : {}),
      ...(durationMs != null ? { duration_ms: durationMs } : {}),
    },
  });
}

function readCodexFileChangeNote(
  payload: Record<string, JsonValue>,
): { message: string; attributes: Record<string, JsonValue> } | null {
  const rawChanges = readPayloadValue(payload, ["item", "changes"]);
  if (!Array.isArray(rawChanges) || rawChanges.length === 0) {
    return null;
  }

  const paths: string[] = [];
  const kinds = new Set<string>();

  for (const entry of rawChanges) {
    if (!entry || Array.isArray(entry) || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, JsonValue>;
    const changePath = typeof record.path === "string" ? record.path : null;
    if (changePath) {
      paths.push(changePath);
    }

    const rawKind = record.kind;
    if (typeof rawKind === "string" && rawKind.length > 0) {
      kinds.add(rawKind);
      continue;
    }
    if (rawKind && !Array.isArray(rawKind) && typeof rawKind === "object") {
      const nestedKind = (rawKind as Record<string, JsonValue>).type;
      if (typeof nestedKind === "string" && nestedKind.length > 0) {
        kinds.add(nestedKind);
      }
    }
  }

  const changeCount = paths.length || rawChanges.length;
  const filePreview = paths
    .slice(0, 2)
    .map((currentPath) => path.basename(currentPath))
    .join(", ");
  const remainingCount = Math.max(changeCount - Math.min(paths.length, 2), 0);
  const suffix =
    filePreview.length > 0
      ? `${filePreview}${remainingCount > 0 ? `, +${remainingCount} more` : ""}`
      : null;

  return {
    message: `${describeCodexFileChangeVerb(kinds)} ${changeCount} file${changeCount === 1 ? "" : "s"}${suffix ? `: ${suffix}` : ""}`,
    attributes: {
      change_count: changeCount,
      change_kind: kinds.size === 1 ? ([...kinds][0] ?? "mixed") : "mixed",
      paths: paths.slice(0, 10),
    },
  };
}

function describeCodexFileChangeVerb(kinds: ReadonlySet<string>): string {
  if (kinds.size === 1) {
    const kind = [...kinds][0];
    if (kind === "add") {
      return "Added";
    }
    if (kind === "delete") {
      return "Deleted";
    }
    if (kind === "modify" || kind === "update") {
      return "Updated";
    }
  }
  return "Changed";
}

function readPayloadString(
  payload: Record<string, JsonValue>,
  paths: string[][],
): string | null {
  for (const currentPath of paths) {
    const current = readPayloadValue(payload, currentPath);
    if (typeof current === "string" && current.length > 0) {
      return current;
    }
  }
  return null;
}

function readPayloadNumber(
  payload: Record<string, JsonValue>,
  paths: string[][],
): number | null {
  for (const currentPath of paths) {
    const current = readPayloadValue(payload, currentPath);
    if (typeof current === "number" && Number.isFinite(current)) {
      return current;
    }
  }
  return null;
}

function readPayloadValue(
  payload: Record<string, JsonValue>,
  currentPath: string[],
): JsonValue | undefined {
  let current: JsonValue | undefined = payload;
  for (const segment of currentPath) {
    if (!current || Array.isArray(current) || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, JsonValue>)[segment];
  }
  return current;
}

function readUsageSnapshot(payload: Record<string, JsonValue>): {
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_output_tokens: number | null;
  total_tokens: number | null;
} {
  return {
    input_tokens: readPayloadNumber(payload, [
      ["tokenUsage", "total", "inputTokens"],
      ["usage", "input_tokens"],
      ["msg", "info", "total_token_usage", "input_tokens"],
    ]),
    output_tokens: readPayloadNumber(payload, [
      ["tokenUsage", "total", "outputTokens"],
      ["usage", "output_tokens"],
      ["msg", "info", "total_token_usage", "output_tokens"],
    ]),
    cached_input_tokens: readPayloadNumber(payload, [
      ["tokenUsage", "total", "cachedInputTokens"],
      ["usage", "cached_input_tokens"],
      ["msg", "info", "total_token_usage", "cached_input_tokens"],
    ]),
    reasoning_output_tokens: readPayloadNumber(payload, [
      ["tokenUsage", "total", "reasoningOutputTokens"],
      ["usage", "reasoning_output_tokens"],
      ["msg", "info", "total_token_usage", "reasoning_output_tokens"],
    ]),
    total_tokens: readPayloadNumber(payload, [
      ["tokenUsage", "total", "totalTokens"],
      ["usage", "total_tokens"],
      ["msg", "info", "total_token_usage", "total_tokens"],
    ]),
  };
}

function readToolId(payload: Record<string, JsonValue>): string | null {
  return readPayloadString(payload, [
    ["item", "id"],
    ["itemId"],
    ["item_id"],
    ["toolCall", "id"],
    ["tool_call", "id"],
    ["call", "id"],
  ]);
}

function readToolName(payload: Record<string, JsonValue>): string | null {
  return readPayloadString(payload, [
    ["item", "name"],
    ["toolName"],
    ["tool_name"],
    ["tool", "name"],
    ["call", "name"],
  ]);
}

function truncateValue(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength - 1)}…`;
}

function parseCodexTraceReplayEntries(
  entries: Array<Record<string, unknown>>,
  select: (entry: Record<string, unknown>) => {
    at: string;
    method: string;
    payload: JsonValue;
  } | null,
): CodexReplayEntry[] {
  const replayEntries: Array<CodexReplayEntry & { originalIndex: number }> = [];
  for (const [index, entry] of entries.entries()) {
    const selected = select(entry);
    if (!selected || !codexReplayMethods.has(selected.method)) {
      continue;
    }
    replayEntries.push({
      at: selected.at,
      method: selected.method,
      payload: selected.payload,
      originalIndex: index,
    });
  }
  replayEntries.sort(compareCodexTraceReplayEntries);
  return replayEntries.map(
    ({ originalIndex: _originalIndex, ...entry }) => entry,
  );
}

function compareCodexTraceReplayEntries(
  left: CodexReplayEntry & { originalIndex: number },
  right: CodexReplayEntry & { originalIndex: number },
): number {
  const atCompare = left.at.localeCompare(right.at);
  if (atCompare !== 0) {
    return atCompare;
  }
  const phaseCompare =
    codexReplayPhaseRank(left.method) - codexReplayPhaseRank(right.method);
  if (phaseCompare !== 0) {
    return phaseCompare;
  }
  return left.originalIndex - right.originalIndex;
}

function codexReplayPhaseRank(method: string): number {
  switch (method) {
    case "turn/started":
      return 0;
    case "item/started":
      return 1;
    case "item/agentMessage/delta":
      return 2;
    case "item/completed":
      return 3;
    case "thread/tokenUsage/updated":
      return 4;
    case "error":
      return 5;
    case "turn/completed":
      return 6;
    default:
      return 7;
  }
}

function promptAttributesFromSpan(
  span: TraceSpan | null,
): Record<string, JsonValue> {
  const attributes: Record<string, JsonValue> = {};
  if (!span?.attributes) {
    return attributes;
  }
  for (const key of ["prompt_text", "prompt_format", "prompt_source"]) {
    const value = span.attributes[key];
    if (value != null) {
      attributes[key] = value;
    }
  }
  return attributes;
}

function buildSyntheticHarnessSession(
  args: HarnessTraceReplayerBuildArgs<CodexReplayEntry>,
  harnessId: string,
): ActiveHarnessSession["session"] {
  return {
    id: `session_reprocess_${args.artifact.attempt_number}_${args.artifact.stage_id}_${args.artifact.run_index}`,
    harness_id: harnessId,
    attempt_number: args.artifact.attempt_number,
    stage_id: args.artifact.stage_id,
    stage_run_index: args.artifact.run_index,
    harness_session: {},
    started_at: new Date(0).toISOString(),
    last_event_at: null,
  };
}

function resolveAmbientHomeDir(parentEnv?: NodeJS.ProcessEnv): string | null {
  const homeDir = parentEnv?.HOME?.trim() || process.env.HOME?.trim() || "";
  return homeDir ? path.resolve(homeDir) : null;
}

function resolveAmbientCodexHomeDir(
  parentEnv?: NodeJS.ProcessEnv,
  homeDir?: string | null,
): string | null {
  const codexHomeDir =
    parentEnv?.CODEX_HOME?.trim() || process.env.CODEX_HOME?.trim() || "";
  if (codexHomeDir) {
    return path.resolve(codexHomeDir);
  }
  return homeDir ? path.join(homeDir, ".codex") : null;
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}
