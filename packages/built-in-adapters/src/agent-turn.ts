import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  isWorkbenchJson,
  type Json,
  type SurfaceSnapshotFile,
  type UsageSummary,
} from "@workbench-ai/workbench-contract";
import {
  DEFAULT_HARNESS_CANCEL,
  DEFAULT_HARNESS_RETRY,
  resolveRuntimeHome,
  type ActiveHarnessSession,
  type AgentTrace,
  type HarnessExecutionPlan,
  type HarnessProvider,
  type HarnessTurnLivePersistence,
  type JsonValue,
  type WorkflowHarness,
} from "@workbench-ai/agent-driver";
import {
  workbenchProviderAuthSetupCommand,
  type WorkbenchExecutionEventPublisher,
} from "@workbench-ai/workbench-core";

import { importWorkbenchRuntime } from "./runtime.ts";

export interface AgentProviderSpec {
  use: string;
  model?: string;
  effort?: string;
}

export interface WorkbenchAgentTurnRequest {
  role: "improver" | "runner" | "engine";
  provider: AgentProviderSpec;
  adapterAuthRoot?: string;
  adapterAuthRequest?: JsonValue;
  adapterAuthEnv?: Record<string, string>;
  workspaceRoot: string;
  cwd: string;
  prompt: string;
  traceRoot: string;
  tracePath?: string;
  jobId: string;
  eventPublisher?: WorkbenchExecutionEventPublisher;
}

export interface WorkbenchAgentTurnResult {
  output: string;
  agentTrace: AgentTrace;
  traceFiles: SurfaceSnapshotFile[];
  metadata: Record<string, JsonValue>;
  usage?: UsageSummary;
}

export type WorkbenchAgentTurnExecutor = (request: WorkbenchAgentTurnRequest) => Promise<WorkbenchAgentTurnResult>;
export type HarnessProviderResolver = (
  id: string,
) => HarnessProvider<unknown> | undefined;

export async function executeWorkbenchAgentTurn(
  executor: (request: WorkbenchAgentTurnRequest) => Promise<WorkbenchAgentTurnResult>,
  request: WorkbenchAgentTurnRequest,
): Promise<WorkbenchAgentTurnResult> {
  try {
    return await executor(request);
  } catch (error) {
    throw providerAuthRequiredError(request.provider?.use, error) ?? error;
  }
}

export function createWorkbenchAgentTurnExecutor(
  resolveProvider: HarnessProviderResolver,
): WorkbenchAgentTurnExecutor {
  return async (request) => runWorkbenchAgentTurn(resolveProvider, request);
}

async function runWorkbenchAgentTurn(
  resolveProvider: HarnessProviderResolver,
  request: WorkbenchAgentTurnRequest,
): Promise<WorkbenchAgentTurnResult> {
  const provider = resolveProvider(request.provider.use);
  if (!provider) {
    throw new Error(`Unknown harness provider: ${request.provider.use}.`);
  }
  const agentHome = resolveRuntimeHome();
  const stageSessionPath = path.join(request.traceRoot, "session");
  await fs.mkdir(stageSessionPath, { recursive: true });
  const restoreEnv = applyAdapterAuthEnv(request.adapterAuthEnv);
  try {
    const plan = await buildAgentExecutionPlan(provider, request.provider, {
      root: request.adapterAuthRoot,
      request: request.adapterAuthRequest,
    });
    const readiness = await provider.checkReadiness?.({
      repoRoot: request.workspaceRoot,
      runtimeHome: agentHome,
      plan,
    });
    const readinessErrors = readiness?.availability_errors ?? [];
    if (readinessErrors.length > 0) {
      throw new Error(readinessErrors.join("\n"));
    }
    const adapter = provider.create();
    const stageId = `workbench-${request.role}`;
    let activeSession: ActiveHarnessSession<unknown> | null = null;
    try {
      await fs.writeFile(path.join(stageSessionPath, "agent-request.json"), `${JSON.stringify({
        role: request.role,
        provider: request.provider.use,
        workspaceRoot: request.workspaceRoot,
        cwd: request.cwd,
        jobId: request.jobId,
      }, null, 2)}\n`);
      activeSession = await adapter.startSession({
        repoRoot: request.workspaceRoot,
        runtimeHome: agentHome,
        plan,
        ownerId: "workbench",
        executionId: createWorkbenchAgentTurnId("workbench_exec"),
        attemptNumber: 1,
        stageId,
        stageRunIndex: 1,
        workspacePath: request.cwd,
        ownerStageId: stageId,
        sessionMode: "fresh",
        persistedSession: null,
        stageSessionPath,
      });
      const runtime = await importWorkbenchRuntime();
      const eventsFile = path.join(stageSessionPath, "events.ndjson");
      const rawEventsFile = path.join(stageSessionPath, "raw-events.ndjson");
      const turnResult = await adapter.startTurn(activeSession, {
        prompt: request.prompt,
        eventsFile,
        rawEventsFile,
        stageSpanId: createWorkbenchAgentTurnId("workbench_span"),
        plan,
        livePersistence: agentLivePersistenceForPublisher(request.eventPublisher, request.role),
      });
      const usage = runtime.extractExecutionUsageFromTrace(
        turnResult.trace,
        request.provider,
        provider.manifest.id,
        turnResult.events,
      );
      const eventCount = Math.max(turnResult.events.length, traceEventCount(turnResult.trace));
      await writeAgentTraceFile(path.join(stageSessionPath, "trace.json"), turnResult.trace);
      return {
        output: turnResult.finalOutput,
        agentTrace: turnResult.agentTrace,
        traceFiles: await runtime.readOutputTraceFiles(
          request.traceRoot,
          request.tracePath ?? `.workbench/traces/${request.jobId}/${request.role}`,
        ),
        metadata: {
          providerId: provider.manifest.id,
          sessionId: turnResult.sessionId,
          eventCount,
        },
        ...(usage ? { usage } : {}),
      };
    } finally {
      if (activeSession) {
        await activeSession.adapter.closeSession(activeSession).catch(() => undefined);
      }
    }
  } finally {
    restoreEnv();
  }
}

function agentLivePersistenceForPublisher(
  publisher: WorkbenchExecutionEventPublisher | undefined,
  role: WorkbenchAgentTurnRequest["role"],
): HarnessTurnLivePersistence | undefined {
  if (!publisher?.enabled) {
    return undefined;
  }
  return {
    ...(publisher.flushWindowMs ? { flushWindowMs: publisher.flushWindowMs } : {}),
    async onFlush(batch) {
      const traceBundle = batch.traceBundle;
      if (
        traceBundle.spans.length === 0 &&
        traceBundle.events.length === 0 &&
        traceBundle.summaries.length === 0
      ) {
        return;
      }
      await publisher.publish([{
        source: "adapter",
        role,
        schema: "workbench.trace.delta.v1",
        payload: toJsonPayload(traceBundle),
      }]).catch(() => undefined);
    },
  };
}

function createWorkbenchAgentTurnId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

async function writeAgentTraceFile(filePath: string, trace: unknown): Promise<void> {
  try {
    await fs.writeFile(filePath, `${JSON.stringify(trace, null, 2)}\n`);
  } catch {
    // Trace files are diagnostic only; the agent turn result remains authoritative.
  }
}

function traceEventCount(trace: unknown): number {
  const traceRecord = trace && typeof trace === "object" && !Array.isArray(trace)
    ? trace as { events?: unknown[] }
    : {};
  return Array.isArray(traceRecord.events) ? traceRecord.events.length : 0;
}

async function buildAgentExecutionPlan(
  provider: HarnessProvider<unknown>,
  providerSpec: AgentProviderSpec,
  adapterAuth: { root?: string; request?: JsonValue },
): Promise<HarnessExecutionPlan> {
  const { turnTimeoutMs, stallTimeoutMs } = resolveAgentTurnTimeouts(provider.manifest.defaults);
  const harness: WorkflowHarness = {
    id: provider.manifest.id,
    auth: await resolveAgentAuth(provider, providerSpec, adapterAuth),
    ...(firstNonEmpty(providerSpec.model, provider.manifest.defaults.model) ? { model: firstNonEmpty(providerSpec.model, provider.manifest.defaults.model) } : {}),
    ...(firstNonEmpty(providerSpec.effort, provider.manifest.defaults.effort) ? { effort: firstNonEmpty(providerSpec.effort, provider.manifest.defaults.effort) } : {}),
    turn_timeout_ms: turnTimeoutMs,
    stall_timeout_ms: stallTimeoutMs,
    config: resolveAgentConfig(provider, provider.manifest.defaults.config ?? {}),
    retry: DEFAULT_HARNESS_RETRY,
    cancel: DEFAULT_HARNESS_CANCEL,
  };
  return {
    workspace: {
      mode: "project",
      prune_ttl_seconds: 604_800,
    },
    harness,
  };
}

export function resolveAgentTurnTimeouts(defaults: {
  turn_timeout_ms?: number;
  stall_timeout_ms?: number;
}): {
  turnTimeoutMs: number;
  stallTimeoutMs: number;
} {
  const turnTimeoutMs = requiredTimeoutMs(defaults.turn_timeout_ms, "turn_timeout_ms");
  const requestedStallTimeoutMs = requiredTimeoutMs(defaults.stall_timeout_ms, "stall_timeout_ms");
  return {
    turnTimeoutMs,
    stallTimeoutMs: Math.min(requestedStallTimeoutMs, turnTimeoutMs),
  };
}

function requiredTimeoutMs(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Harness provider manifest requires a positive ${name}.`);
  }
  return value;
}

async function resolveAgentAuth(
  provider: HarnessProvider<unknown>,
  providerSpec: AgentProviderSpec,
  adapterAuth: { root?: string; request?: JsonValue },
): Promise<Record<string, JsonValue>> {
  const authConfig =
    adapterAuthProviderOption(adapterAuth.request, providerSpec.use) ??
    ((provider.manifest.defaults.auth as Record<string, JsonValue> | undefined) ?? {});
  const parsed = provider.schemas.auth.safeParse(authConfig);
  if (!parsed.success) {
    throw new Error(`Agent provider "${provider.manifest.id}" auth is invalid: ${formatValidationIssues(parsed.error.issues)}`);
  }
  return { ...parsed.data };
}

function adapterAuthProviderOption(
  auth: JsonValue | undefined,
  providerName: string,
): Record<string, JsonValue> | null {
  const record = jsonRecord(auth);
  const self = jsonRecord(record?.self);
  const adapters = jsonRecord(record?.adapters);
  const provider = jsonRecord(adapters?.[providerName]);
  const entry =
    jsonRecord(self?.default) ??
    jsonRecord(provider?.default) ??
    jsonRecord(record?.default);
  if (!entry) {
    return null;
  }
  const method = typeof entry.method === "string" ? entry.method : "";
  if (method === "bedrock") {
    return { strategy: "bedrock_env" };
  }
  const filesRoot = typeof entry.filesRoot === "string" ? entry.filesRoot : "";
  if (filesRoot) {
    return {
      strategy: "profile_path",
      path: filesRoot,
    };
  }
  const env = jsonRecord(entry.env);
  const [envName] = Object.keys(env ?? {}).sort();
  if (envName) {
    return {
      strategy: "secret_ref",
      ref: envName,
    };
  }
  return null;
}

function resolveAgentConfig(
  provider: HarnessProvider<unknown>,
  fallback: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const parsed = provider.schemas.config.safeParse(fallback);
  if (!parsed.success) {
    throw new Error(`Agent provider "${provider.manifest.id}" config is invalid: ${formatValidationIssues(parsed.error.issues)}`);
  }
  return { ...parsed.data };
}

function applyAdapterAuthEnv(env: Record<string, string> | undefined): () => void {
  if (!env || Object.keys(env).length === 0) {
    return () => undefined;
  }
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(env)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
}

function jsonRecord(value: unknown): Record<string, JsonValue> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : null;
}

function toJsonPayload(value: unknown): Json {
  const normalized = JSON.parse(JSON.stringify(value ?? null)) as unknown;
  return isWorkbenchJson(normalized) ? normalized : null;
}

function providerAuthRequiredError(providerName: string | undefined, error: unknown): Error | null {
  if (!providerName) {
    return null;
  }
  const message = error instanceof Error
    ? `${error.message}\n${error.stack ?? ""}\n${String(error.cause ?? "")}`
    : String(error);
  if (!AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return null;
  }
  return new Error(`ADAPTER_AUTH_REQUIRED: ${providerName} disconnected. Next: ${workbenchProviderAuthSetupCommand(providerName)}.`);
}

const AUTH_ERROR_PATTERNS = [
  /not logged in/iu,
  /login required/iu,
  /authentication required/iu,
  /failed to authenticate/iu,
  /authentication_error/iu,
  /api error:\s*401/iu,
  /invalid.*session/iu,
  /invalid bearer token/iu,
  /session.*expired/iu,
  /oauth.*expired/iu,
  /unauthorized/iu,
];

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function formatValidationIssues(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue) => {
      const issuePath = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${issuePath}: ${issue.message}`;
    })
    .join("; ");
}
