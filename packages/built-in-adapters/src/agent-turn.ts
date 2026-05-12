import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import {
  DEFAULT_HARNESS_CANCEL,
  DEFAULT_HARNESS_RETRY,
  type JsonValue,
  type WorkflowHarness,
} from "@workbench-ai/flow-contracts";
import type {
  SurfaceSnapshotFile,
  UsageSummary,
} from "@workbench-ai/workbench-contract";
import {
  createId,
  ensureDir,
  resolveFlowHome,
  type ActiveHarnessSession,
  type HarnessExecutionPlan,
  type HarnessProvider,
} from "@workbench-ai/flow-harness-sdk";
import type {
  WorkbenchExecutionEventPublisher,
} from "@workbench-ai/workbench-core";

import { importWorkbenchRuntime } from "./runtime.ts";

const DEFAULT_AGENT_TURN_MAX_ATTEMPTS = 3;
const DEFAULT_AGENT_TURN_RETRY_BASE_MS = 5_000;
const DEFAULT_AGENT_TURN_RETRY_MAX_MS = 30_000;

interface AgentHarnessRegistration {
  executable: string;
  installHint: string;
  defaultConfig?: Record<string, JsonValue>;
  load(): Promise<HarnessProvider<unknown>>;
}

export interface AgentProviderSpec {
  use: string;
  model?: string;
  effort?: string;
}

export interface WorkbenchAgentTurnRequest {
  role: "optimizer" | "runner" | "scorer";
  provider: AgentProviderSpec;
  adapterAuthRoot?: string;
  adapterAuthRequest?: JsonValue;
  adapterAuthEnv?: Record<string, string>;
  workspaceRoot: string;
  cwd: string;
  prompt: string;
  traceRoot: string;
  jobId: string;
  eventPublisher?: WorkbenchExecutionEventPublisher;
}

export interface WorkbenchAgentTurnResult {
  output: string;
  traceFiles: SurfaceSnapshotFile[];
  metadata: Record<string, JsonValue>;
  usage?: UsageSummary;
}

export type WorkbenchAgentTurnExecutor = (request: WorkbenchAgentTurnRequest) => Promise<WorkbenchAgentTurnResult>;

const AGENT_HARNESS_REGISTRY: Record<string, AgentHarnessRegistration> = {
  codex: {
    executable: "codex",
    installHint: "@openai/codex",
    defaultConfig: {
      sandbox_mode: "danger-full-access",
    },
    async load() {
      const module = await import("@workbench-ai/flow-harness-openai-codex");
      return module.codexHarness();
    },
  },
  claude: {
    executable: "claude",
    installHint: "@anthropic-ai/claude-code",
    defaultConfig: {
      max_turns: 64,
      permission_mode: "bypassPermissions",
    },
    async load() {
      const module = await import("@workbench-ai/flow-harness-anthropic-claude-code");
      return module.claudeCodeHarness();
    },
  },
  pi: {
    executable: "pi",
    installHint: "@mariozechner/pi-coding-agent",
    async load() {
      const module = await import("@workbench-ai/flow-harness-badlogic-pi-coding-agent");
      return module.piCodingAgentHarness();
    },
  },
};

export async function executeWorkbenchAgentTurn(
  executor: (request: WorkbenchAgentTurnRequest) => Promise<WorkbenchAgentTurnResult>,
  request: WorkbenchAgentTurnRequest,
): Promise<WorkbenchAgentTurnResult> {
  const maxAttempts = workbenchAgentTurnMaxAttempts();
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await executor(request);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientAgentTurnError(error)) {
        throw error;
      }
      await sleep(agentTurnRetryDelayMs(attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Agent turn failed."));
}

export async function defaultWorkbenchAgentTurnExecutor(
  request: WorkbenchAgentTurnRequest,
): Promise<WorkbenchAgentTurnResult> {
  const execFileAsync = promisify(execFile);
  await ensureAgentExecutableOnPath(request.provider.use, execFileAsync);
  const provider = await loadAgentHarnessProvider(request.provider.use);
  const flowHome = resolveFlowHome();
  const stageSessionPath = path.join(request.traceRoot, "session");
  await ensureDir(stageSessionPath);
  const restoreEnv = applyAdapterAuthEnv(request.adapterAuthEnv);
  try {
    const plan = await buildAgentHarnessExecutionPlan(provider, request.provider, request.workspaceRoot, flowHome, {
      root: request.adapterAuthRoot,
      request: request.adapterAuthRequest,
    });
    const readiness = await provider.checkReadiness?.({
      repoRoot: request.workspaceRoot,
      flowHome,
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
        flowHome,
        plan,
        ownerId: "workbench",
        executionId: createId("workbench_exec"),
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
        stageSpanId: createId("workbench_span"),
        plan,
        livePersistence: runtime.executionTracePersistenceForPublisher(request.eventPublisher, request.role),
      });
      const usage = runtime.extractExecutionUsageFromTrace(
        turnResult.trace,
        request.provider,
        provider.manifest.id,
        turnResult.events,
      );
      const eventCount = Math.max(turnResult.events.length, traceEventCount(turnResult.trace));
      await writeAgentTraceFile(path.join(stageSessionPath, "trace.json"), turnResult.trace);
      await fs.writeFile(path.join(stageSessionPath, "agent-result.json"), `${JSON.stringify({
        sessionId: turnResult.sessionId,
        finalOutput: turnResult.finalOutput,
        eventCount,
        ...(usage ? { usage } : {}),
      }, null, 2)}\n`);
      return {
        output: turnResult.finalOutput,
        traceFiles: await runtime.readOutputTraceFiles(request.traceRoot, `.workbench/traces/${request.jobId}/${request.role}`),
        metadata: {
          harnessId: provider.manifest.id,
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

async function loadAgentHarnessProvider(providerName: AgentProviderSpec["use"]): Promise<HarnessProvider<unknown>> {
  return await agentHarnessRegistration(providerName).load();
}

async function ensureAgentExecutableOnPath(
  providerName: AgentProviderSpec["use"],
  execFileAsync: (file: string, args: string[], options?: Record<string, unknown>) => Promise<unknown>,
): Promise<void> {
  const executable = agentExecutableName(providerName);
  try {
    await execFileAsync("sh", ["-lc", `command -v ${quoteShellArg(executable)} >/dev/null 2>&1`], {
      maxBuffer: 1024 * 1024,
      timeout: 5_000,
    });
  } catch {
    throw new Error(
      `Agent provider "${providerName}" requires "${executable}" on PATH. Install ${agentExecutableInstallHint(providerName)} in the adapter runtime.`,
    );
  }
}

function agentExecutableName(providerName: AgentProviderSpec["use"]): string {
  return agentHarnessRegistration(providerName).executable;
}

function agentExecutableInstallHint(providerName: AgentProviderSpec["use"]): string {
  return agentHarnessRegistration(providerName).installHint;
}

function agentHarnessRegistration(providerName: AgentProviderSpec["use"]): AgentHarnessRegistration {
  const registration = AGENT_HARNESS_REGISTRY[providerName];
  if (!registration) {
    throw new Error(`Unsupported first-party agent adapter: ${providerName}`);
  }
  return registration;
}

async function buildAgentHarnessExecutionPlan(
  provider: HarnessProvider<unknown>,
  providerSpec: AgentProviderSpec,
  workspaceRoot: string,
  flowHome: string,
  adapterAuth: { root?: string; request?: JsonValue },
): Promise<HarnessExecutionPlan> {
  const turnTimeoutMs = provider.manifest.defaults.turn_timeout_ms ?? 3_600_000;
  const harness: WorkflowHarness = {
    id: provider.manifest.id,
    auth: await resolveAgentHarnessAuth(provider, providerSpec, workspaceRoot, flowHome, adapterAuth),
    ...(firstNonEmpty(providerSpec.model, provider.manifest.defaults.model) ? { model: firstNonEmpty(providerSpec.model, provider.manifest.defaults.model) } : {}),
    ...(firstNonEmpty(providerSpec.effort, provider.manifest.defaults.effort) ? { effort: firstNonEmpty(providerSpec.effort, provider.manifest.defaults.effort) } : {}),
    turn_timeout_ms: turnTimeoutMs,
    stall_timeout_ms: Math.max(provider.manifest.defaults.stall_timeout_ms ?? 0, turnTimeoutMs),
    config: resolveAgentHarnessConfig(provider, defaultWorkbenchAgentHarnessConfig(provider, providerSpec.use)),
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

function defaultWorkbenchAgentHarnessConfig(
  provider: HarnessProvider<unknown>,
  providerName: AgentProviderSpec["use"],
): Record<string, JsonValue> {
  const fallback = (provider.manifest.defaults.config ?? {}) as Record<string, JsonValue>;
  return {
    ...fallback,
    ...(AGENT_HARNESS_REGISTRY[providerName]?.defaultConfig ?? {}),
  };
}

async function resolveAgentHarnessAuth(
  provider: HarnessProvider<unknown>,
  providerSpec: AgentProviderSpec,
  workspaceRoot: string,
  flowHome: string,
  adapterAuth: { root?: string; request?: JsonValue },
): Promise<Record<string, JsonValue>> {
  const subject =
    adapterAuthHarnessSubject(adapterAuth.request, providerSpec.use) ??
    ((provider.manifest.defaults.auth as Record<string, JsonValue> | undefined) ?? {});
  const parsed = provider.schemas.auth.safeParse(subject);
  if (!parsed.success) {
    throw new Error(`Agent provider "${provider.manifest.id}" auth is invalid: ${formatValidationIssues(parsed.error.issues)}`);
  }
  void workspaceRoot;
  void flowHome;
  return { ...parsed.data };
}

function adapterAuthHarnessSubject(
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

function resolveAgentHarnessConfig(
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

function workbenchAgentTurnMaxAttempts(): number {
  const raw = Number.parseInt(process.env.WORKBENCH_AGENT_TURN_MAX_ATTEMPTS ?? "", 10);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : DEFAULT_AGENT_TURN_MAX_ATTEMPTS;
}

function agentTurnRetryDelayMs(attempt: number): number {
  const fallback = process.env.NODE_ENV === "test" ? 1 : DEFAULT_AGENT_TURN_RETRY_BASE_MS;
  const raw = Number.parseInt(process.env.WORKBENCH_AGENT_TURN_RETRY_BASE_MS ?? "", 10);
  const baseDelay = Number.isSafeInteger(raw) && raw >= 0 ? raw : fallback;
  return Math.min(baseDelay * 2 ** Math.max(0, attempt - 1), DEFAULT_AGENT_TURN_RETRY_MAX_MS);
}

function isTransientAgentTurnError(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.message}\n${error.stack ?? ""}\n${String(error.cause ?? "")}`
    : String(error);
  if (isNativeCaCertificateFailure(message)) {
    return false;
  }
  return /\b(fetch failed|error sending request|stream disconnected before completion|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|socket hang up|network error|UND_ERR_|signal SIGTERM)/iu.test(message);
}

function isNativeCaCertificateFailure(message: string): boolean {
  return /\bno native root CA certificates found\b|install ca-certificates/iu.test(message);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

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

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}
