import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

import {
  createHarnessSession,
  createPendingHarnessTurn,
  nowIso,
  persistStageSessionWorkspace,
  prepareStageSessionWorkspace,
  runHarnessPrepareCommand,
  terminateProcess,
  type ActiveHarnessSession,
  type HarnessAdapter,
  type HarnessExecutionPlan,
  type HarnessRunResult,
  type PendingHarnessTurn,
  type StartSessionArgs,
  type StartTurnArgs,
} from "@workbench-ai/harness-sdk";
import type { JsonValue } from "@workbench-ai/contracts";
import {
  getPiHarness,
  piCodingAgentHarnessManifest,
} from "./manifest.js";
import {
  buildPiRpcCommand,
  resolvePiConfiguredEffort,
  resolvePiConfiguredModel,
} from "./cli.js";
import { ensurePiAuthReady } from "./auth.js";
import {
  buildPiEnv,
  stagePiHome,
} from "./home.js";
import {
  classifyPiStderr,
  createPiHarnessEvent,
  createPiNormalizationState,
  createPiStderrHarnessEvent,
  normalizePiEvent,
  redactPiEvent,
  resetPiTurnState,
  type PiNormalizationState,
} from "./normalize.js";
import {
  parsePiRpcLine,
  type PiAgentEvent,
  type PiRpcResponse,
  type PiRpcState,
} from "./rpc.js";
import { piHarnessEffortValues } from "./schemas.js";

interface PendingPiResponse {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface PiSessionState {
  workspacePath: string;
  attemptWorkspacePath: string;
  sessionWorkspacePath: string | null;
  childEnv: NodeJS.ProcessEnv;
  process: ChildProcessWithoutNullStreams | null;
  reader: readline.Interface | null;
  pendingResponses: Map<string, PendingPiResponse>;
  nextRequestId: number;
  pendingTurn: PendingHarnessTurn | null;
  abortRequested: boolean;
  sessionFile: string;
  normalization: PiNormalizationState;
}

type WorkflowHarnessCancel = NonNullable<
  NonNullable<HarnessExecutionPlan["harness"]>["cancel"]
>;

export class PiCodingAgentHarnessAdapter
  implements HarnessAdapter<PiSessionState>
{
  readonly manifest = piCodingAgentHarnessManifest;

  constructor(private readonly executable = "pi") {}

  getManagedWorkspaceIgnoreEntries(): string[] {
    return [];
  }

  async startSession(
    args: StartSessionArgs,
  ): Promise<ActiveHarnessSession<PiSessionState>> {
    const preparedWorkspace = await prepareStageSessionWorkspace({
      workspaceMode: args.plan.workspace.mode,
      workspacePath: args.workspacePath,
      stageSessionPath: args.stageSessionPath,
      excludedTopLevelEntries: [".pi"],
    });
    const staged = await stagePiHome({
      plan: args.plan,
      repoRoot: args.repoRoot,
      flowHome: args.flowHome,
      stageSessionPath: args.stageSessionPath,
      parentEnv: process.env,
      persistedSession: args.persistedSession,
      resume: args.sessionMode === "resume",
    });
    await runHarnessPrepareCommand({
      plan: args.plan,
      workspacePath: preparedWorkspace.workspacePath,
      stageSessionPath: args.stageSessionPath,
      childEnv: staged.childEnv,
    });
    const child = spawn(
      "sh",
      [
        "-lc",
        buildPiRpcCommand(
          this.executable,
          staged.model,
          staged.effort,
          staged.sessionFile,
        ),
      ],
      {
        cwd: preparedWorkspace.workspacePath,
        env: staged.childEnv,
        stdio: "pipe",
      },
    );
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
      harnessSession: {
        ...(args.sessionMode === "resume" ? (args.persistedSession ?? {}) : {}),
        session_file: staged.sessionFile,
      },
    });

    const context: ActiveHarnessSession<PiSessionState> = {
      adapter: this,
      ownerStageId: args.ownerStageId,
      session,
      state: {
        workspacePath: preparedWorkspace.workspacePath,
        attemptWorkspacePath: preparedWorkspace.attemptWorkspacePath,
        sessionWorkspacePath: preparedWorkspace.sessionWorkspacePath,
        childEnv: staged.childEnv,
        process: child,
        reader,
        pendingResponses: new Map(),
        nextRequestId: 1,
        pendingTurn: null,
        abortRequested: false,
        sessionFile: staged.sessionFile,
        normalization: createPiNormalizationState({
          provider: staged.model.provider,
          model: staged.model.full,
        }),
      },
    };

    reader.on("line", (line) => {
      this.handleLine(context, line);
    });
    child.stderr.on("data", (chunk) => {
      this.handleStderr(context, chunk.toString());
    });
    child.on("error", (error) => {
      this.failPendingResponses(context, error);
      this.rejectPendingTurn(context, error);
    });
    child.on("exit", (code, signal) => {
      const error = new Error(
        `pi rpc exited early with code ${code ?? "null"} signal ${
          signal ?? "null"
        }`,
      );
      this.failPendingResponses(context, error);
      if (context.state.pendingTurn) {
        this.rejectPendingTurn(context, error);
      }
    });

    try {
      const rpcState = (await this.request(context, {
        type: "get_state",
      })) as PiRpcState | undefined;
      if (rpcState?.sessionId && rpcState.sessionId.trim().length > 0) {
        context.state.normalization.sessionId = rpcState.sessionId;
      }
      if (
        rpcState?.model?.provider &&
        rpcState?.model?.id &&
        rpcState.model.provider.trim().length > 0 &&
        rpcState.model.id.trim().length > 0
      ) {
        context.state.normalization.model = `${rpcState.model.provider}/${rpcState.model.id}`;
      }
      if (rpcState?.sessionFile && rpcState.sessionFile.trim().length > 0) {
        context.state.sessionFile = rpcState.sessionFile;
        context.session.harness_session.session_file = rpcState.sessionFile;
      }
      await this.request(context, {
        type: "set_auto_compaction",
        enabled: false,
      });
      await this.request(context, {
        type: "set_auto_retry",
        enabled: false,
      });
      return context;
    } catch (error) {
      await this.closeSession(context).catch(() => undefined);
      throw error;
    }
  }

  async startTurn(
    context: ActiveHarnessSession<PiSessionState>,
    args: StartTurnArgs,
  ): Promise<HarnessRunResult> {
    const harness = PiCodingAgentHarnessAdapter.getHarness(args.plan);
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
        void this.closeSession(context, args.plan.harness.cancel);
      },
      livePersistence: args.livePersistence,
    });

    context.state.pendingTurn = pendingTurn;
    context.state.abortRequested = false;
    resetPiTurnState(context.state.normalization);
    context.state.normalization.turnStarted = true;
    pendingTurn.controller.record({
      normalized: {
        type: "turn.started",
        at: nowIso(),
        provider: piCodingAgentHarnessManifest.id,
        model: context.state.normalization.model,
        sessionId: context.state.normalization.sessionId,
      },
    });

    try {
      await this.request(context, {
        type: "prompt",
        message: args.prompt,
      });
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error(String(error));
      this.rejectPendingTurn(context, failure);
      throw failure;
    }

    return await pendingTurn.result;
  }

  async interruptTurn(
    context: ActiveHarnessSession<PiSessionState>,
  ): Promise<void> {
    await this.sendAbort(context, 250);
  }

  async closeSession(
    context: ActiveHarnessSession<PiSessionState>,
    cancelConfig?: WorkflowHarnessCancel,
  ): Promise<void> {
    if (context.state.pendingTurn) {
      await this.sendAbort(context, 250, true);
    }
    const error = new Error("pi session closed");
    this.failPendingResponses(context, error);
    this.rejectPendingTurn(context, error);
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
      attemptWorkspacePath: context.state.attemptWorkspacePath,
      sessionWorkspacePath: context.state.sessionWorkspacePath,
      excludedTopLevelEntries: [".pi"],
    });
  }

  static getHarness(
    plan: HarnessExecutionPlan,
  ): NonNullable<HarnessExecutionPlan["harness"]> {
    return getPiHarness(plan);
  }

  static async ensureAuthReady(
    plan: HarnessExecutionPlan,
    repoRoot: string,
    flowHome?: string,
  ): Promise<void> {
    resolvePiConfiguredModel(plan);
    await ensurePiAuthReady(plan, repoRoot, flowHome);
  }

  static validateConfiguredEffort(plan: HarnessExecutionPlan): void {
    const harness = PiCodingAgentHarnessAdapter.getHarness(plan);
    const effort = resolvePiConfiguredEffort(plan);
    if (harness.effort && !effort) {
      throw new Error(
        `Unsupported Pi effort "${harness.effort}". Expected one of ${piHarnessEffortValues.join(", ")}.`,
      );
    }
  }

  private handleLine(
    context: ActiveHarnessSession<PiSessionState>,
    line: string,
  ): void {
    if (!line.trim()) {
      return;
    }

    let parsed;
    try {
      parsed = parsePiRpcLine(line);
    } catch {
      this.rejectPendingTurn(
        context,
        new Error(`Failed to parse Pi RPC output: ${line}`),
      );
      return;
    }

    const at = nowIso();
    if (parsed.kind === "response") {
      this.handleResponse(context, parsed.response, at);
      return;
    }
    if (parsed.kind === "extension_ui") {
      const pendingTurn = context.state.pendingTurn;
      if (pendingTurn) {
        pendingTurn.controller.record({
          rawEnvelope: {
            at,
            source: "extension_ui_request",
            request: parsed.request,
          },
          normalized: {
            type: "error",
            at,
            message: "Pi requested interactive extension UI in RPC mode.",
          },
        });
      }
      this.rejectPendingTurn(
        context,
        new Error("Pi requested interactive extension UI in RPC mode."),
      );
      return;
    }
    if (parsed.kind === "unknown") {
      return;
    }

    this.handlePiEvent(context, parsed.event, at);
  }

  private handleResponse(
    context: ActiveHarnessSession<PiSessionState>,
    response: PiRpcResponse,
    at: string,
  ): void {
    const pending = response.id
      ? context.state.pendingResponses.get(response.id)
      : null;
    if (response.id) {
      context.state.pendingResponses.delete(response.id);
    }
    if (context.state.pendingTurn) {
      context.state.pendingTurn.controller.record({
        rawEnvelope: {
          at,
          source: "response",
          command: response.command,
          success: response.success,
          ...(response.data === undefined ? {} : { data: response.data }),
          ...(response.error ? { error: response.error } : {}),
        },
      });
    }
    if (!pending) {
      return;
    }
    if (!response.success) {
      pending.reject(new Error(response.error ?? `${response.command} failed`));
      return;
    }
    pending.resolve(response.data);
  }

  private handlePiEvent(
    context: ActiveHarnessSession<PiSessionState>,
    event: PiAgentEvent,
    at: string,
  ): void {
    const pendingTurn = context.state.pendingTurn;
    if (!pendingTurn) {
      return;
    }

    const redacted = redactPiEvent(event as unknown as JsonValue);
    if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) {
      return;
    }
    const redactedEvent = redacted as unknown as PiAgentEvent;
    const activities = normalizePiEvent(
      context.state.normalization,
      redactedEvent,
      at,
    );
    pendingTurn.controller.record({
      rawEnvelope: {
        at,
        source: "event",
        event: redactedEvent as unknown as Record<string, unknown>,
      },
      harnessEvent: createPiHarnessEvent(context.session, redactedEvent, at),
      normalized: activities,
    });

    if (event.type !== "agent_end") {
      return;
    }

    const stopReason = context.state.normalization.lastAssistantStopReason;
    const errorMessage =
      context.state.normalization.lastAssistantErrorMessage ??
      (stopReason === "aborted" ? "Pi turn aborted." : null);
    if (stopReason === "error") {
      this.rejectPendingTurn(
        context,
        new Error(errorMessage ?? "Pi turn failed."),
      );
      return;
    }
    if (stopReason === "aborted") {
      this.rejectPendingTurn(
        context,
        new Error(errorMessage ?? "Pi turn aborted."),
      );
      return;
    }

    context.state.pendingTurn = null;
    pendingTurn.resolve(
      pendingTurn.controller.succeed({
        endedAt: at,
        finalOutput: context.state.normalization.lastAssistantText ?? undefined,
      }),
    );
  }

  private handleStderr(
    context: ActiveHarnessSession<PiSessionState>,
    text: string,
  ): void {
    const pendingTurn = context.state.pendingTurn;
    if (!pendingTurn) {
      return;
    }
    const severity = classifyPiStderr(text);
    if (severity === "empty") {
      return;
    }
    const at = nowIso();
    pendingTurn.controller.record({
      rawEnvelope: {
        at,
        source: "stderr",
        text,
      },
      harnessEvent: createPiStderrHarnessEvent(
        context.session,
        at,
        text,
        severity,
      ),
      normalized:
        severity === "error"
          ? {
              type: "error",
              at,
              message: text.trim(),
              attributes: {
                stream: "stderr",
              },
            }
          : null,
    });
  }

  private async request(
    context: ActiveHarnessSession<PiSessionState>,
    command: Record<string, unknown> & { type: string },
  ): Promise<unknown> {
    const id = `pi_${context.state.nextRequestId++}`;
    return await new Promise((resolve, reject) => {
      context.state.pendingResponses.set(id, { resolve, reject });
      void this.writeCommand(context, { ...command, id }).catch((error) => {
        context.state.pendingResponses.delete(id);
        reject(error);
      });
    });
  }

  private async sendAbort(
    context: ActiveHarnessSession<PiSessionState>,
    timeoutMs: number,
    force = false,
  ): Promise<void> {
    const stdin = context.state.process?.stdin;
    if (
      !stdin ||
      stdin.destroyed ||
      stdin.writableEnded ||
      (context.state.abortRequested && !force)
    ) {
      return;
    }
    await this.writeCommand(
      context,
      {
        type: "abort",
        id: `pi_${context.state.nextRequestId++}`,
      },
      timeoutMs,
    ).catch(() => undefined);
    context.state.abortRequested = true;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    });
  }

  private async writeCommand(
    context: ActiveHarnessSession<PiSessionState>,
    command: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<void> {
    const stdin = context.state.process?.stdin;
    if (!stdin || stdin.destroyed || stdin.writableEnded) {
      throw new Error("Pi RPC stdin is unavailable.");
    }
    const payload = `${JSON.stringify(command)}\n`;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolve();
      };
      const timer = timeoutMs
        ? setTimeout(() => {
            finish();
          }, timeoutMs)
        : null;
      try {
        stdin.write(payload, () => {
          finish();
        });
      } catch (error) {
        finish(error);
      }
    });
  }

  private rejectPendingTurn(
    context: ActiveHarnessSession<PiSessionState>,
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

  private failPendingResponses(
    context: ActiveHarnessSession<PiSessionState>,
    error: Error,
  ): void {
    for (const pending of context.state.pendingResponses.values()) {
      pending.reject(error);
    }
    context.state.pendingResponses.clear();
  }
}
