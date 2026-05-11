import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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
  applyNormalizedHarnessActivity,
  buildManagedHarnessEnv,
  createHarnessSession,
  createPendingHarnessTurn,
  ensureDir,
  HarnessTraceBuilder,
  getManagedHarnessHomePath,
  nowIso,
  persistStageSessionWorkspace,
  prepareStageSessionWorkspace,
  runHarnessPrepareCommand,
  resolveHarnessConfiguredEffort,
  resolveHarnessConfiguredModel,
  resolveFlowEnv,
  sharedHarnessEffortValues,
  terminateProcess,
  type ActiveHarnessSession,
  type CanonicalToolCall,
  type HarnessTraceReplayer,
  type NormalizedHarnessActivity,
  type PendingHarnessTurn,
  type StartSessionArgs,
  type StartTurnArgs,
  buildCanonicalToolCall,
} from "@workbench-ai/harness-sdk";
import type {
  HarnessAuth,
  HarnessEvent,
  JsonObject,
  JsonValue,
  TraceSpan,
} from "@workbench-ai/contracts";
import { z } from "zod";
import {
  projectClaudeGlobalSkills,
  syncClaudeGlobalSkills,
} from "./global-skills.js";
import {
  CLAUDE_CODE_OAUTH_TOKEN_ENV,
  claudeWorkbenchProviderAuth,
} from "./workbench-auth.js";

const ClaudeSecretRefAuthSchema = z
  .object({
    strategy: z.literal("secret_ref"),
    ref: z.string().min(1),
  })
  .strict();

const ClaudeProfilePathAuthSchema = z
  .object({
    strategy: z.literal("profile_path"),
    path: z.string().min(1),
  })
  .strict();

const ClaudeBedrockEnvAuthSchema = z
  .object({
    strategy: z.literal("bedrock_env"),
  })
  .strict();

export const ClaudeHarnessAuthSchema = z.discriminatedUnion("strategy", [
  ClaudeSecretRefAuthSchema,
  ClaudeProfilePathAuthSchema,
  ClaudeBedrockEnvAuthSchema,
]);

export const ClaudeHarnessConfigSchema = z
  .object({
    max_turns: z.number().int().positive().default(24),
    max_budget_usd: z.number().positive().optional(),
    allowed_tools: z.array(z.string().min(1)).optional(),
    add_dirs: z.array(z.string().min(1)).optional(),
    permission_mode: z
      .enum([
        "acceptEdits",
        "auto",
        "bypassPermissions",
        "default",
        "dontAsk",
        "plan",
      ])
      .default("acceptEdits"),
  })
  .strict();

export type ClaudeHarnessAuth = z.infer<typeof ClaudeHarnessAuthSchema>;
export type ClaudeHarnessConfig = z.infer<typeof ClaudeHarnessConfigSchema>;

export function createClaudeHarnessDefinition(
  options: { executable?: string } = {},
) {
  return {
    id: "anthropic/claude-code",
    displayName: "Anthropic Claude Code",
    auth: ClaudeHarnessAuthSchema,
    config: ClaudeHarnessConfigSchema,
    defaults: {
      auth: {
        strategy: "secret_ref" as const,
        ref: "ANTHROPIC_API_KEY",
      },
      config: {
        max_turns: 24,
      },
    },
    capabilities: {
      supports_resume: true,
      supports_interrupt: true,
      required_runtime_capabilities: ["shell_execution", "dotenv_secrets"],
    },
    supportedWorkspaceModes: ["managed", "project"] as const,
    async checkReadiness(args: HarnessReadinessCheckArgs) {
      await ClaudeCodeHarnessAdapter.ensureAuthReady(
        args.plan,
        args.repoRoot,
        args.flowHome,
      );
      ClaudeCodeHarnessAdapter.validateConfiguredEffort(args.plan);
      return {
        availability_errors: [],
      };
    },
    create() {
      return new ClaudeCodeHarnessAdapter(
        options.executable?.trim() || "claude",
      );
    },
  };
}

export const claudeHarnessDefinition = createClaudeHarnessDefinition();
export const claudeHarnessManifest: HarnessManifest = createCliHarnessManifest(
  claudeHarnessDefinition,
);

export const claudeHarnessProvider = claudeCodeHarness();

export {
  projectClaudeGlobalSkills,
  syncClaudeGlobalSkills,
} from "./global-skills.js";
export {
  CLAUDE_CODE_OAUTH_TOKEN_ENV,
  claudeWorkbenchProviderAuth,
  collectClaudeWorkbenchBedrockEnv,
  parseClaudeSetupTokenOutput,
  type ClaudeWorkbenchBedrockEnvCollection,
  type ClaudeWorkbenchProviderAuthEnvVar,
} from "./workbench-auth.js";

export function claudeCodeHarness(options: { executable?: string } = {}) {
  const definition = createClaudeHarnessDefinition(options);
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

interface ClaudeReplayEntry {
  at: string;
  source: "stdout" | "stderr";
  payload?: JsonValue;
  text?: string;
}

export const claudeTraceReplayer: HarnessTraceReplayer<ClaudeReplayEntry> = {
  harnessId: claudeHarnessManifest.id,
  parseRawReplayEntries(entries) {
    const replayEntries = parseClaudeTraceReplayEntries(entries, (entry) => {
      if (
        (entry.source !== "stdout" && entry.source !== "stderr") ||
        typeof entry.at !== "string"
      ) {
        return null;
      }
      return {
        at: entry.at,
        source: entry.source,
        payload: (entry.payload as JsonValue) ?? {},
        text: typeof entry.text === "string" ? entry.text : undefined,
      };
    });
    return replayEntries.length === 0 ? null : { entries: replayEntries };
  },
  parseHarnessReplayEntries(entries) {
    const replayEntries = parseClaudeTraceReplayEntries(entries, (entry) => {
      if (typeof entry.at !== "string" || typeof entry.name !== "string") {
        return null;
      }
      if (entry.name === "claude/stderr") {
        const payloadValue = entry.payload as JsonValue | null;
        const payload = isJsonObject(payloadValue) ? payloadValue : {};
        return {
          at: entry.at,
          source: "stderr",
          text: typeof payload.text === "string" ? payload.text : "",
        };
      }
      if (!entry.name.startsWith("claude/")) {
        return null;
      }
      return {
        at: entry.at,
        source: "stdout",
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
    const turnStartedAt = args.oldTurnSpan?.started_at ?? args.stageStartedAt;
    applyNormalizedHarnessActivity(trace, {
      type: "turn.started",
      at: turnStartedAt,
      provider: claudeHarnessManifest.id,
      model: readTraceString(args.oldTurnSpan?.attributes, "model") ?? null,
      sessionId:
        readTraceString(args.oldTurnSpan?.attributes, "session_id") ?? null,
      operationId:
        readTraceString(args.oldTurnSpan?.attributes, "operation_id") ?? null,
      attributes:
        Object.keys(promptAttributes).length > 0 ? promptAttributes : undefined,
    });

    const state = {
      providerSessionId:
        readTraceString(args.oldTurnSpan?.attributes, "session_id") ?? null,
      model: readTraceString(args.oldTurnSpan?.attributes, "model") ?? null,
      operationId:
        readTraceString(args.oldTurnSpan?.attributes, "operation_id") ?? null,
      lastAssistantText: "",
      toolsById: new Map<string, CanonicalToolCall>(),
    };

    for (const entry of args.source.entries) {
      if (entry.source === "stderr") {
        const text = typeof entry.text === "string" ? entry.text : "";
        if (text.trim().length > 0) {
          applyNormalizedHarnessActivity(trace, {
            type: "error",
            at: entry.at,
            message: text.trim(),
            attributes: {
              stream: "stderr",
            },
          });
        }
        continue;
      }
      const payload = entry.payload as JsonValue | null;
      if (!isJsonObject(payload)) {
        continue;
      }
      const normalized = normalizeClaudeEnvelope(state, payload, entry.at);
      for (const activity of normalized.activities) {
        applyNormalizedHarnessActivity(trace, activity);
      }
      if (normalized.providerSessionId) {
        state.providerSessionId = normalized.providerSessionId;
      }
      if (normalized.model) {
        state.model = normalized.model;
      }
    }

    return trace.buildBundle(await args.readFinalOutput(), args.endedAt);
  },
};

interface ClaudeSessionState {
  workspacePath: string;
  attemptWorkspacePath: string;
  sessionWorkspacePath: string | null;
  childEnv: NodeJS.ProcessEnv;
  sessionMode: StartSessionArgs["sessionMode"];
  process: ChildProcessWithoutNullStreams | null;
  reader: readline.Interface | null;
  pendingTurn: PendingHarnessTurn | null;
  stderrLines: string[];
  providerSessionId: string | null;
  model: string | null;
  operationId: string | null;
  lastAssistantText: string | null;
  toolsById: Map<string, CanonicalToolCall>;
}

export interface ClaudeEnvelopeNormalization {
  activities: NormalizedHarnessActivity[];
  providerSessionId: string | null;
  model: string | null;
  resultStatus: string | null;
  errorMessage: string | null;
  finalOutput: string | null;
}

type WorkflowHarnessCancel = NonNullable<
  HarnessExecutionPlan["harness"]
>["cancel"];

const CLAUDE_OAUTH_TOKEN_ENV = CLAUDE_CODE_OAUTH_TOKEN_ENV;

const claudePortableAuthRelativePaths =
  claudeWorkbenchProviderAuth.profile.optional;

const claudeManagedEnvDenylist = [
  CLAUDE_OAUTH_TOKEN_ENV,
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_FOUNDRY_RESOURCE",
  "AZURE_API_BASE",
  "AZURE_API_KEY",
  "AZURE_OPENAI_API_KEY",
] as const;

const claudeBedrockEnvDenylist = [
  CLAUDE_OAUTH_TOKEN_ENV,
  "ANTHROPIC_API_KEY",
  "AWS_PROFILE",
  "AWS_DEFAULT_PROFILE",
  "AWS_CONFIG_FILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_FOUNDRY_RESOURCE",
  "AZURE_API_BASE",
  "AZURE_API_KEY",
  "AZURE_OPENAI_API_KEY",
] as const;

interface ResolvedClaudeApiKeyAuth {
  apiKey: string;
}

interface ResolvedClaudeProfileAuth {
  sourceRoot: string;
}

interface ResolvedClaudeBedrockAuth {
  region: string;
}

export class ClaudeCodeHarnessAdapter implements HarnessAdapter<ClaudeSessionState> {
  readonly manifest = claudeHarnessManifest;

  constructor(private readonly executable: string) {}

  getManagedWorkspaceIgnoreEntries(_plan: HarnessExecutionPlan): string[] {
    return [];
  }

  async startSession(
    args: StartSessionArgs,
  ): Promise<ActiveHarnessSession<ClaudeSessionState>> {
    const childEnv = await this.prepareChildEnv(
      args.plan,
      args.repoRoot,
      args.flowHome,
      args.stageSessionPath,
      process.env,
    );
    const preparedWorkspace = await prepareStageSessionWorkspace({
      workspaceMode: args.plan.workspace.mode,
      workspacePath: args.workspacePath,
      stageSessionPath: args.stageSessionPath,
      excludedTopLevelEntries: [".claude"],
    });
    const { workspacePath, attemptWorkspacePath, sessionWorkspacePath } =
      preparedWorkspace;
    await runHarnessPrepareCommand({
      plan: args.plan,
      workspacePath,
      stageSessionPath: args.stageSessionPath,
      childEnv,
    });
    await syncClaudeGlobalSkills(
      getManagedHarnessHomePath(args.stageSessionPath),
    );

    return {
      adapter: this,
      ownerStageId: args.ownerStageId,
      session: createHarnessSession({
        harnessId: this.manifest.id,
        attemptNumber: args.attemptNumber,
        stageId: args.stageId,
        stageRunIndex: args.stageRunIndex,
        harnessSession:
          args.sessionMode === "resume" ? (args.persistedSession ?? {}) : {},
      }),
      state: {
        workspacePath,
        attemptWorkspacePath,
        sessionWorkspacePath,
        childEnv,
        sessionMode: args.sessionMode,
        process: null,
        reader: null,
        pendingTurn: null,
        stderrLines: [],
        providerSessionId:
          args.sessionMode === "resume" &&
          typeof args.persistedSession?.session_id === "string" &&
          args.persistedSession.session_id.trim().length > 0
            ? args.persistedSession.session_id
            : null,
        model: null,
        operationId: null,
        lastAssistantText: null,
        toolsById: new Map(),
      },
    };
  }

  async startTurn(
    context: ActiveHarnessSession<ClaudeSessionState>,
    args: StartTurnArgs,
  ): Promise<HarnessRunResult> {
    const config = ClaudeCodeHarnessAdapter.getHarnessConfig(args.plan);
    const harness = ClaudeCodeHarnessAdapter.getHarness(args.plan);
    const pendingTurn = createPendingHarnessTurn({
      session: context.session,
      eventsFile: args.eventsFile,
      rawEventsFile: args.rawEventsFile,
      stageSpanId: args.stageSpanId,
      promptText: args.prompt,
      turnTimeoutMs: harness.turn_timeout_ms,
      stallTimeoutMs: harness.stall_timeout_ms,
      onTimeout: (message) => {
        this.rejectPendingTurn(
          context,
          this.withStderr(context, new Error(message)),
        );
        void this.closeSession(context, args.plan.harness.cancel);
      },
      livePersistence: args.livePersistence,
    });

    context.state.operationId = context.session.id;

    const command = buildClaudeCommand(
      this.executable,
      args.plan,
      config,
      args.prompt,
      {
        sessionMode: context.state.sessionMode,
        resumeSessionId: context.state.providerSessionId,
      },
    );
    const child = spawn("sh", ["-lc", command], {
      cwd: context.state.workspacePath,
      env: context.state.childEnv,
      stdio: "pipe",
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdin.end();

    const reader = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    context.state.process = child;
    context.state.reader = reader;

    pendingTurn.controller.record({
      normalized: {
        type: "turn.started",
        at: nowIso(),
        provider: claudeHarnessManifest.id,
        sessionId: null,
        operationId: context.state.operationId,
      },
    });

    context.state.stderrLines = [];
    context.state.pendingTurn = pendingTurn;

    reader.on("line", (line) => {
      this.handleStdoutLine(context, line);
    });
    child.stderr.on("data", (chunk) => {
      this.handleStderr(context, chunk.toString());
    });
    child.on("error", (error) => {
      this.rejectPendingTurn(context, this.withStderr(context, error));
    });
    child.on("close", (code, signal) => {
      if (context.state.pendingTurn) {
        this.rejectPendingTurn(
          context,
          this.withStderr(
            context,
            new Error(
              `claude exited before returning a terminal result with code ${code ?? "null"} signal ${signal ?? "null"}`,
            ),
          ),
        );
      }
    });

    return await pendingTurn.result;
  }

  async interruptTurn(
    context: ActiveHarnessSession<ClaudeSessionState>,
  ): Promise<void> {
    if (context.state.process) {
      await terminateProcess(context.state.process, 1_000, 1_000);
    }
  }

  async closeSession(
    context: ActiveHarnessSession<ClaudeSessionState>,
    cancelConfig?: WorkflowHarnessCancel,
  ): Promise<void> {
    if (context.state.reader) {
      context.state.reader.close();
      context.state.reader = null;
    }
    if (context.state.process) {
      await terminateProcess(
        context.state.process,
        cancelConfig?.graceful_timeout_ms ?? 1_000,
        cancelConfig?.hard_kill_timeout_ms ?? 1_000,
      );
      context.state.process = null;
    }
    await persistStageSessionWorkspace({
      sessionWorkspacePath: context.state.sessionWorkspacePath,
      attemptWorkspacePath: context.state.attemptWorkspacePath,
      excludedTopLevelEntries: [".claude"],
    });
  }

  static getHarness(
    plan: HarnessExecutionPlan,
  ): NonNullable<HarnessExecutionPlan["harness"]> {
    const harness = plan.harness;
    if (!harness) {
      throw new Error(
        `Expected ${claudeHarnessManifest.id} harness, received no harness configuration`,
      );
    }
    if (harness.id !== claudeHarnessManifest.id) {
      throw new Error(
        `Expected ${claudeHarnessManifest.id} harness, received ${harness.id}`,
      );
    }
    return harness;
  }

  static getHarnessAuth(plan: HarnessExecutionPlan): ClaudeHarnessAuth {
    return ClaudeHarnessAuthSchema.parse(
      ClaudeCodeHarnessAdapter.getHarness(plan).auth,
    );
  }

  static getHarnessConfig(plan: HarnessExecutionPlan): ClaudeHarnessConfig {
    return ClaudeHarnessConfigSchema.parse(
      ClaudeCodeHarnessAdapter.getHarness(plan).config,
    );
  }

  static async ensureAuthReady(
    plan: HarnessExecutionPlan,
    repoRoot: string,
    flowHome?: string,
  ): Promise<void> {
    const auth = ClaudeCodeHarnessAdapter.getHarnessAuth(plan);
    if (auth.strategy === "secret_ref") {
      ClaudeCodeHarnessAdapter.resolveApiKeyAuth(plan, repoRoot, flowHome);
      return;
    }
    if (auth.strategy === "bedrock_env") {
      ClaudeCodeHarnessAdapter.resolveBedrockAuth();
      return;
    }

    const { sourceRoot } = ClaudeCodeHarnessAdapter.resolveProfileAuth(
      plan,
      repoRoot,
    );
    await fs.access(path.join(sourceRoot, ".claude.json"));
    await ensureClaudePortableAuthExists(sourceRoot);
  }

  static validateConfiguredEffort(plan: HarnessExecutionPlan): void {
    const harness = ClaudeCodeHarnessAdapter.getHarness(plan);
    const effort = resolveHarnessConfiguredEffort(
      harness,
      sharedHarnessEffortValues,
    );
    if (harness.effort && !effort) {
      throw new Error(
        `Unsupported Claude effort "${harness.effort}". Expected one of ${sharedHarnessEffortValues.join(", ")}.`,
      );
    }
  }

  private async prepareChildEnv(
    plan: HarnessExecutionPlan,
    repoRoot: string,
    flowHome: string,
    stageSessionPath: string,
    parentEnv: NodeJS.ProcessEnv,
  ): Promise<NodeJS.ProcessEnv> {
    const homeDir = getManagedHarnessHomePath(stageSessionPath);
    await ensureDir(homeDir);
    const auth = ClaudeCodeHarnessAdapter.getHarnessAuth(plan);
    if (auth.strategy === "secret_ref") {
      const { apiKey } = ClaudeCodeHarnessAdapter.resolveApiKeyAuth(
        plan,
        repoRoot,
        flowHome,
      );
      await ClaudeCodeHarnessAdapter.copyAmbientHomeState(homeDir, parentEnv);
      const sourceHome = parentEnv.HOME?.trim();
      if (sourceHome) {
        await projectClaudeGlobalSkills({
          sourceHomeDir: path.resolve(sourceHome),
          targetHomeDir: homeDir,
        });
      }
      return buildClaudeChildEnv(apiKey, homeDir, parentEnv);
    }
    if (auth.strategy === "bedrock_env") {
      ClaudeCodeHarnessAdapter.resolveBedrockAuth(parentEnv);
      await ClaudeCodeHarnessAdapter.copyAmbientHomeState(homeDir, parentEnv);
      const sourceHome = parentEnv.HOME?.trim();
      if (sourceHome) {
        await projectClaudeGlobalSkills({
          sourceHomeDir: path.resolve(sourceHome),
          targetHomeDir: homeDir,
        });
      }
      return buildClaudeBedrockChildEnv(homeDir, parentEnv);
    }

    const { sourceRoot } = ClaudeCodeHarnessAdapter.resolveProfileAuth(
      plan,
      repoRoot,
    );
    await ClaudeCodeHarnessAdapter.copyProfileAuth(sourceRoot, homeDir);
    const sourceHome = parentEnv.HOME?.trim();
    if (sourceHome) {
      await projectClaudeGlobalSkills({
        sourceHomeDir: path.resolve(sourceHome),
        targetHomeDir: homeDir,
      });
    }
    return buildClaudeChildEnv(null, homeDir, parentEnv);
  }

  private handleStdoutLine(
    context: ActiveHarnessSession<ClaudeSessionState>,
    line: string,
  ): void {
    if (!line.trim()) {
      return;
    }

    let parsed: JsonValue;
    try {
      parsed = JSON.parse(line) as JsonValue;
    } catch {
      this.rejectPendingTurn(
        context,
        this.withStderr(
          context,
          new Error(`Failed to parse claude stream-json output: ${line}`),
        ),
      );
      return;
    }

    const pendingTurn = context.state.pendingTurn;
    if (!pendingTurn) {
      return;
    }

    const at = nowIso();
    const redacted = redactClaudeValue(parsed);
    const payload = isJsonObject(redacted)
      ? redacted
      : { value: redacted ?? null };
    const envelopeType =
      typeof payload.type === "string" ? payload.type : "unknown";
    const harnessEvent = createClaudeHarnessEvent(
      context.session,
      envelopeType,
      payload,
      at,
    );
    const normalized = normalizeClaudeEnvelope(context.state, payload, at);

    pendingTurn.controller.record({
      rawEnvelope: {
        at,
        source: "stdout",
        payload,
      },
      harnessEvent,
      normalized: normalized.activities,
    });

    if (normalized.providerSessionId) {
      context.state.providerSessionId = normalized.providerSessionId;
      context.session.harness_session.session_id = normalized.providerSessionId;
    }
    if (normalized.model) {
      context.state.model = normalized.model;
      context.session.harness_session.model = normalized.model;
    }

    if (envelopeType !== "result") {
      return;
    }

    const semanticStatus = normalized.resultStatus;
    if (semanticStatus !== "success") {
      this.rejectPendingTurn(
        context,
        this.withStderr(
          context,
          new Error(
            normalized.errorMessage ??
              `claude result subtype ${semanticStatus ?? "unknown"}`,
          ),
        ),
      );
      return;
    }

    const completedTurn = context.state.pendingTurn;
    if (!completedTurn) {
      return;
    }
    context.state.pendingTurn = null;
    completedTurn.resolve(
      completedTurn.controller.succeed({
        endedAt: at,
        ...(normalized.finalOutput != null
          ? { finalOutput: normalized.finalOutput }
          : {}),
      }),
    );
  }

  private handleStderr(
    context: ActiveHarnessSession<ClaudeSessionState>,
    text: string,
  ): void {
    this.captureStderr(context, text);
    const pendingTurn = context.state.pendingTurn;
    if (!pendingTurn) {
      return;
    }

    const at = nowIso();
    const severity = classifyStderr(text);
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
        name: "claude/stderr",
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

  private rejectPendingTurn(
    context: ActiveHarnessSession<ClaudeSessionState>,
    error: Error,
  ): void {
    const pendingTurn = context.state.pendingTurn;
    if (!pendingTurn) {
      return;
    }

    context.state.pendingTurn = null;
    pendingTurn.controller.dispose();
    pendingTurn.reject(error);
  }

  private captureStderr(
    context: ActiveHarnessSession<ClaudeSessionState>,
    text: string,
  ): void {
    const lines = text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return;
    }
    context.state.stderrLines.push(...lines);
    if (context.state.stderrLines.length > 20) {
      context.state.stderrLines.splice(
        0,
        context.state.stderrLines.length - 20,
      );
    }
  }

  private withStderr(
    context: ActiveHarnessSession<ClaudeSessionState>,
    error: Error,
  ): Error {
    if (context.state.stderrLines.length === 0) {
      return error;
    }
    return new Error(
      `${error.message}. claude stderr: ${context.state.stderrLines.join(" | ")}`,
    );
  }

  static resolveApiKeyAuth(
    plan: HarnessExecutionPlan,
    repoRoot: string,
    flowHome?: string,
  ): ResolvedClaudeApiKeyAuth {
    const auth = ClaudeCodeHarnessAdapter.getHarnessAuth(plan);
    if (auth.strategy !== "secret_ref") {
      throw new Error("Claude secret_ref auth is required for API key access.");
    }
    const resolved = resolveFlowEnv(auth.ref, repoRoot, { flowHome });
    const apiKey = resolved.value?.trim();
    if (!apiKey) {
      const location = resolved.envPath ?? "the environment";
      throw new Error(
        `${auth.ref} must be set in ${location} before running Flow Claude sessions.`,
      );
    }
    return {
      apiKey,
    };
  }

  static resolveProfileAuth(
    plan: HarnessExecutionPlan,
    repoRoot: string,
  ): ResolvedClaudeProfileAuth {
    const auth = ClaudeCodeHarnessAdapter.getHarnessAuth(plan);
    if (auth.strategy !== "profile_path") {
      throw new Error("Claude profile_path auth is required for profile auth.");
    }
    return {
      sourceRoot: path.resolve(repoRoot, auth.path),
    };
  }

  static resolveBedrockAuth(
    parentEnv: NodeJS.ProcessEnv = process.env,
  ): ResolvedClaudeBedrockAuth {
    const usesBearerToken = Boolean(parentEnv.AWS_BEARER_TOKEN_BEDROCK?.trim());
    const hasAccessKey = Boolean(parentEnv.AWS_ACCESS_KEY_ID?.trim());
    const hasSecretKey = Boolean(parentEnv.AWS_SECRET_ACCESS_KEY?.trim());
    if (!usesBearerToken && (!hasAccessKey || !hasSecretKey)) {
      throw new Error(
        "Claude Bedrock auth requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or AWS_BEARER_TOKEN_BEDROCK.",
      );
    }
    const region =
      parentEnv.AWS_REGION?.trim() || parentEnv.AWS_DEFAULT_REGION?.trim();
    if (!region) {
      throw new Error(
        "Claude Bedrock auth requires AWS_REGION or AWS_DEFAULT_REGION.",
      );
    }
    return { region };
  }

  static async copyProfileAuth(
    sourceRoot: string,
    homeDir: string,
  ): Promise<void> {
    await ensureDir(path.join(homeDir, ".claude"));
    await fs.copyFile(
      path.join(sourceRoot, ".claude.json"),
      path.join(homeDir, ".claude.json"),
    );
    await copyClaudePortableAuthFiles(sourceRoot, homeDir);
  }

  static async copyAmbientHomeState(
    homeDir: string,
    parentEnv: NodeJS.ProcessEnv,
  ): Promise<void> {
    const sourceHome = parentEnv.HOME?.trim();
    if (!sourceHome || path.resolve(sourceHome) === path.resolve(homeDir)) {
      return;
    }

    try {
      await fs.copyFile(
        path.join(sourceHome, ".claude.json"),
        path.join(homeDir, ".claude.json"),
      );
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }
      throw error;
    }
  }
}

function buildClaudeCommand(
  executable: string,
  plan: HarnessExecutionPlan,
  config: ClaudeHarnessConfig,
  prompt: string,
  session: {
    sessionMode: "fresh" | "resume";
    resumeSessionId: string | null;
  },
): string {
  const harness = ClaudeCodeHarnessAdapter.getHarness(plan);
  const configuredModel = resolveHarnessConfiguredModel(harness);
  const configuredEffort = resolveHarnessConfiguredEffort(
    harness,
    sharedHarnessEffortValues,
  );
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    config.permission_mode,
    "--setting-sources",
    "user",
    "--max-turns",
    String(config.max_turns),
  ];

  if (session.sessionMode === "resume" && session.resumeSessionId) {
    args.push("--continue");
  }

  if (configuredModel) {
    args.push("--model", configuredModel);
  }
  if (config.max_budget_usd != null) {
    args.push("--max-budget-usd", String(config.max_budget_usd));
  }
  if (config.allowed_tools?.length) {
    args.push("--allowed-tools", config.allowed_tools.join(","));
  }
  if (config.add_dirs?.length) {
    for (const directory of config.add_dirs) {
      args.push("--add-dir", directory);
    }
  }
  if (configuredEffort) {
    args.push("--effort", configuredEffort);
  }
  args.push("--settings", JSON.stringify({ disableAllHooks: true }));

  args.push(prompt);
  return buildClaudeCliCommand(executable, args);
}

function buildClaudeCliCommand(command: string, args: string[]): string {
  return `${command.trim()} ${args.map(quoteShellArg).join(" ")}`;
}

function quoteShellArg(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replace(/'/gu, `'\"'\"'`)}'`;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function listExistingClaudePortableAuthRelativePaths(
  sourceRoot: string,
): Promise<string[]> {
  const existing: string[] = [];
  for (const relativePath of claudePortableAuthRelativePaths) {
    try {
      await fs.access(path.join(sourceRoot, relativePath));
      existing.push(relativePath);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }
  return existing;
}

async function copyClaudePortableAuthFiles(
  sourceRoot: string,
  homeDir: string,
): Promise<void> {
  const existing =
    await listExistingClaudePortableAuthRelativePaths(sourceRoot);
  if (existing.length === 0) {
    throw claudePortableAuthRequirementError(sourceRoot);
  }
  for (const relativePath of existing) {
    const targetPath = path.join(homeDir, relativePath);
    await ensureDir(path.dirname(targetPath));
    await fs.copyFile(path.join(sourceRoot, relativePath), targetPath);
  }
}

async function ensureClaudePortableAuthExists(
  sourceRoot: string,
): Promise<void> {
  const existing =
    await listExistingClaudePortableAuthRelativePaths(sourceRoot);
  if (existing.length > 0) {
    return;
  }
  throw claudePortableAuthRequirementError(sourceRoot);
}

function readClaudeOauthToken(homeDir: string): string | null {
  try {
    const token = readFileSync(
      path.join(homeDir, ".claude", "oauth-token"),
      "utf8",
    ).trim();
    return token.length > 0 ? token : null;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

function claudePortableAuthRequirementError(sourceRoot: string): Error {
  return new Error(
    `Claude profile_path auth requires ${claudePortableAuthRelativePaths
      .map((relativePath) => `"${relativePath}"`)
      .join(" or ")} under ${sourceRoot}.`,
  );
}

function classifyStderr(text: string): "empty" | "warning" | "error" {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "empty";
  }
  if (lines.every((line) => /\bWARN(?:ING)?\b/i.test(line))) {
    return "warning";
  }
  return "error";
}

function createClaudeHarnessEvent(
  session: ActiveHarnessSession["session"],
  envelopeType: string,
  payload: JsonObject,
  at: string,
): HarnessEvent {
  const phase =
    envelopeType === "system"
      ? "session"
      : envelopeType === "result"
        ? "turn"
        : envelopeType === "assistant" || envelopeType === "user"
          ? "item"
          : envelopeType === "error"
            ? "error"
            : "item";

  const subtype =
    typeof payload.subtype === "string" ? `/${payload.subtype}` : "";
  return {
    at,
    attempt_number: session.attempt_number,
    stage_id: session.stage_id,
    stage_run_index: session.stage_run_index,
    phase,
    name: `claude/${envelopeType}${subtype}`,
    payload,
  };
}

export function buildClaudeChildEnv(
  apiKey: string | null,
  homeDir: string,
  parentEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const oauthToken = apiKey ? null : readClaudeOauthToken(homeDir);
  const env = buildManagedHarnessEnv(parentEnv, {
    HOME: homeDir,
    ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
    ...(oauthToken ? { [CLAUDE_OAUTH_TOKEN_ENV]: oauthToken } : {}),
  });
  for (const name of claudeManagedEnvDenylist) {
    delete env[name];
  }
  if (!apiKey) {
    delete env.ANTHROPIC_API_KEY;
  }
  if (oauthToken) {
    env[CLAUDE_OAUTH_TOKEN_ENV] = oauthToken;
  } else {
    delete env[CLAUDE_OAUTH_TOKEN_ENV];
  }
  return env;
}

export function buildClaudeBedrockChildEnv(
  homeDir: string,
  parentEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const { region } = ClaudeCodeHarnessAdapter.resolveBedrockAuth(parentEnv);
  const bedrockEnv: NodeJS.ProcessEnv = {
    HOME: homeDir,
    CLAUDE_CODE_USE_BEDROCK: "1",
    AWS_REGION: parentEnv.AWS_REGION?.trim() || region,
  };
  for (const name of claudeWorkbenchProviderAuth.envAuth.bedrock.envAllowlist) {
    const value = parentEnv[name]?.trim();
    if (value) {
      bedrockEnv[name] = value;
    }
  }
  bedrockEnv.CLAUDE_CODE_USE_BEDROCK = "1";
  if (!bedrockEnv.AWS_REGION && region) {
    bedrockEnv.AWS_REGION = region;
  }

  const env = buildManagedHarnessEnv(parentEnv, bedrockEnv);
  for (const name of claudeBedrockEnvDenylist) {
    delete env[name];
  }
  env.CLAUDE_CODE_USE_BEDROCK = "1";
  return env;
}

export function normalizeClaudeEnvelope(
  state: Pick<
    ClaudeSessionState,
    | "providerSessionId"
    | "model"
    | "operationId"
    | "lastAssistantText"
    | "toolsById"
  >,
  payload: JsonObject,
  at: string,
): ClaudeEnvelopeNormalization {
  const activities: NormalizedHarnessActivity[] = [];
  const type = typeof payload.type === "string" ? payload.type : null;
  let providerSessionId =
    readString(payload.session_id) ?? readString(payload.sessionId);
  let model = readString(payload.model);
  let resultStatus: string | null = null;
  let errorMessage: string | null = null;
  let finalOutput: string | null = null;

  if (type === "system" && payload.subtype === "init") {
    activities.push({
      type: "session.started",
      at,
      provider: claudeHarnessManifest.id,
      model,
      sessionId: providerSessionId,
    });
  }

  if (type === "assistant") {
    const message = asJsonObject(payload.message);
    model = readString(message?.model) ?? model;
    const content = asJsonArray(message?.content);
    let visibleText = "";
    for (const block of content) {
      const blockObject = asJsonObject(block);
      const blockType = readString(blockObject?.type);
      if (blockType === "tool_use") {
        const toolId = readString(blockObject?.id);
        const toolCall = buildCanonicalToolCall({
          rawToolName: readString(blockObject?.name),
          input: (blockObject?.input as JsonValue | undefined) ?? null,
        });
        if (toolId) {
          state.toolsById.set(toolId, toolCall);
        }
        activities.push({
          type: "tool.started",
          at,
          toolId,
          toolName: toolCall.toolName,
          attributes: toolCall.attributes,
        });
        continue;
      }
      if (blockType === "text") {
        visibleText += readString(blockObject?.text) ?? "";
      }
    }

    if (visibleText.trim().length > 0) {
      state.lastAssistantText = visibleText;
      finalOutput = visibleText;
      activities.push(
        {
          type: "assistant_output.started",
          at,
          phase: "response",
          itemId: readString(message?.id),
        },
        {
          type: "assistant_output.completed",
          at,
          phase: "response",
          itemId: readString(message?.id),
          text: visibleText,
        },
      );
    }
  }

  if (type === "user") {
    const message = asJsonObject(payload.message);
    const content = asJsonArray(message?.content);
    for (const block of content) {
      const blockObject = asJsonObject(block);
      if (readString(blockObject?.type) !== "tool_result") {
        continue;
      }

      const toolId =
        readString(blockObject?.tool_use_id) ??
        readString(blockObject?.toolUseId);
      const toolCall = toolId ? (state.toolsById.get(toolId) ?? null) : null;
      const resultPreview = readClaudeToolResultPreview(blockObject);
      activities.push({
        type: "tool.completed",
        at,
        toolId,
        toolName: toolCall?.toolName ?? null,
        attributes:
          toolCall ||
          resultPreview ||
          readBoolean(blockObject?.is_error) === true
            ? {
                ...(toolCall?.attributes ?? {}),
                ...(resultPreview ? { result_preview: resultPreview } : {}),
                ...(readBoolean(blockObject?.is_error) === true
                  ? { is_error: true }
                  : {}),
              }
            : undefined,
      });
    }
  }

  if (type === "result") {
    const subtype = readString(payload.subtype);
    const isError = readBoolean(payload.is_error);
    const isSuccess = subtype ? subtype === "success" && !isError : !isError;
    resultStatus = isSuccess
      ? "success"
      : subtype === "success"
        ? "error"
        : (subtype ?? "error");
    const resultText = readString(payload.result);
    const usage = asJsonObject(payload.usage);
    if (usage) {
      const inputTokens =
        readNumber(usage.input_tokens) ?? readNumber(usage.inputTokens);
      const outputTokens =
        readNumber(usage.output_tokens) ?? readNumber(usage.outputTokens);
      const cacheCreationInputTokens =
        readNumber(usage.cache_creation_input_tokens) ??
        readNumber(usage.cacheCreationInputTokens);
      const cacheReadInputTokens =
        readNumber(usage.cache_read_input_tokens) ??
        readNumber(usage.cacheReadInputTokens);
      const cachedInputTokens =
        cacheCreationInputTokens != null || cacheReadInputTokens != null
          ? (cacheCreationInputTokens ?? 0) + (cacheReadInputTokens ?? 0)
          : null;
      const totalTokens =
        inputTokens != null || outputTokens != null || cachedInputTokens != null
          ? (inputTokens ?? 0) + (outputTokens ?? 0) + (cachedInputTokens ?? 0)
          : null;
      activities.push({
        type: "usage.updated",
        at,
        inputTokens,
        outputTokens,
        attributes: {
          ...(inputTokens != null
            ? { uncached_input_tokens: inputTokens }
            : {}),
          ...(cachedInputTokens != null
            ? { cached_input_tokens: cachedInputTokens }
            : {}),
          ...(cacheCreationInputTokens != null
            ? { cache_creation_input_tokens: cacheCreationInputTokens }
            : {}),
          ...(cacheReadInputTokens != null
            ? { cache_read_input_tokens: cacheReadInputTokens }
            : {}),
          ...(totalTokens != null ? { total_tokens: totalTokens } : {}),
          ...(payload.total_cost_usd != null
            ? {
                total_cost_usd: payload.total_cost_usd,
                cost_source: "provider",
              }
            : {}),
        },
      });
    }

    providerSessionId =
      providerSessionId ??
      readString(payload.session_id) ??
      state.providerSessionId;
    model = model ?? state.model;
    finalOutput = resultText ?? state.lastAssistantText;
    errorMessage = readString(payload.error) ?? readString(payload.message);
    if (!isSuccess) {
      errorMessage =
        errorMessage ??
        readString(payload.result) ??
        `Claude completed with subtype ${resultStatus}`;
    }
    if (
      resultText &&
      resultText.trim().length > 0 &&
      resultText !== state.lastAssistantText
    ) {
      activities.push(
        {
          type: "assistant_output.started",
          at,
          phase: "response",
          itemId: null,
        },
        {
          type: "assistant_output.completed",
          at,
          phase: "response",
          itemId: null,
          text: resultText,
        },
      );
    }
    activities.push({
      type: "turn.completed",
      at,
      provider: claudeHarnessManifest.id,
      model,
      sessionId: providerSessionId,
      operationId: state.operationId,
      status: resultStatus === "success" ? "completed" : "failed",
      errorMessage,
      attributes: {
        subtype,
        is_error: isError,
        total_cost_usd: payload.total_cost_usd ?? null,
        num_turns: payload.num_turns ?? null,
        duration_ms: payload.duration_ms ?? null,
      },
    });
  }

  return {
    activities,
    providerSessionId,
    model,
    resultStatus,
    errorMessage,
    finalOutput,
  };
}

export function redactClaudeValue(value: JsonValue): JsonValue | null {
  if (Array.isArray(value)) {
    return value
      .map((entry) => redactClaudeValue(entry))
      .filter((entry): entry is JsonValue => entry !== null);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as JsonObject;
  const recordType = readString(record.type);
  if (
    recordType === "thinking" ||
    recordType === "redacted_thinking" ||
    recordType === "thinking_delta"
  ) {
    return null;
  }
  const delta = asJsonObject(record.delta);
  if (readString(delta?.type) === "thinking_delta") {
    return null;
  }

  const redacted: JsonObject = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key === "signature") {
      continue;
    }
    const next = redactClaudeValue(entry);
    if (next !== null) {
      redacted[key] = next;
    }
  }
  return redacted;
}

function readClaudeToolResultPreview(
  value: JsonObject | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  const direct =
    readString(value.content) ??
    readString(value.result) ??
    readString(value.error) ??
    readString(value.message);
  if (direct) {
    return truncateClaudeValue(direct, 160);
  }
  const content = asJsonArray(value.content);
  if (content.length === 0) {
    return null;
  }
  const text = content
    .map((entry) => {
      const block = asJsonObject(entry);
      return readString(block?.text) ?? "";
    })
    .filter((entry) => entry.length > 0)
    .join(" ")
    .trim();
  return text.length > 0 ? truncateClaudeValue(text, 160) : null;
}

function truncateClaudeValue(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function isJsonObject(value: JsonValue | null): value is JsonObject {
  return !!value && !Array.isArray(value) && typeof value === "object";
}

function asJsonObject(value: JsonValue | undefined): JsonObject | null {
  return value && !Array.isArray(value) && typeof value === "object"
    ? (value as JsonObject)
    : null;
}

function asJsonArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseClaudeTraceReplayEntries(
  entries: Array<Record<string, unknown>>,
  select: (entry: Record<string, unknown>) => {
    at: string;
    source: "stdout" | "stderr";
    payload?: JsonValue;
    text?: string;
  } | null,
): ClaudeReplayEntry[] {
  const replayEntries: Array<ClaudeReplayEntry & { originalIndex: number }> =
    [];
  for (const [index, entry] of entries.entries()) {
    const selected = select(entry);
    if (!selected) {
      continue;
    }
    replayEntries.push({
      at: selected.at,
      source: selected.source,
      ...(selected.source === "stderr"
        ? { text: selected.text ?? "" }
        : { payload: selected.payload ?? {} }),
      originalIndex: index,
    });
  }
  replayEntries.sort((left, right) => {
    const atCompare = left.at.localeCompare(right.at);
    if (atCompare !== 0) {
      return atCompare;
    }
    return left.originalIndex - right.originalIndex;
  });
  return replayEntries.map(
    ({ originalIndex: _originalIndex, ...entry }) => entry,
  );
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

function readTraceString(
  attributes: Record<string, JsonValue> | undefined,
  key: string,
): string | null {
  const value = attributes?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readBoolean(value: JsonValue | undefined): boolean {
  return value === true;
}
