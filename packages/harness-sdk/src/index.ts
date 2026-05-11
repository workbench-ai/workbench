import { z } from "zod";

import type {
  ExecutionTrace,
  HarnessEvent,
  HarnessAuth,
  HarnessSession,
  JsonValue,
  WorkflowDocument,
  WorkflowHarness,
  WorkspaceMode,
} from "@workbench-ai/contracts";

export * from "./behavior-contract.js";
export * from "./conformance.js";
export * from "./global-skills.js";
export * from "./internal-utils.js";
export * from "./json-rpc.js";
export * from "./managed-runtime.js";
export * from "./model-config.js";
export * from "./normalized-activity.js";
export * from "./prepare.js";
export * from "./process-env.js";
export * from "./session-runtime.js";
export * from "./trace-builder.js";
export * from "./trace-replay.js";
export * from "./tool-semantics.js";

export interface HarnessExecutionPlan extends Pick<WorkflowDocument, "workspace"> {
  harness: WorkflowHarness;
}

type WorkflowHarnessCancel = HarnessExecutionPlan["harness"]["cancel"];

export interface HarnessCapabilities {
  supports_resume: boolean;
  supports_interrupt: boolean;
  required_runtime_capabilities: string[];
}

export interface HarnessManifest {
  id: string;
  display_name: string;
  auth_schema: JsonValue;
  config_schema: JsonValue;
  defaults: {
    auth?: HarnessAuth;
    model?: string;
      effort?: string;
      turn_timeout_ms?: number;
      stall_timeout_ms?: number;
      config?: Record<string, JsonValue>;
    };
  capabilities: HarnessCapabilities;
  supported_workspace_modes: WorkspaceMode[];
}

export interface HarnessValidationSchemas<
  TAuth extends Record<string, JsonValue> = Record<string, JsonValue>,
  TConfig extends Record<string, JsonValue> = Record<string, JsonValue>,
> {
  auth: z.ZodType<TAuth>;
  config: z.ZodType<TConfig>;
}

export interface HarnessReadinessContext {
  repoRoot: string;
  flowHome: string;
  parentEnv?: NodeJS.ProcessEnv;
}

export interface HarnessReadinessCheckArgs extends HarnessReadinessContext {
  plan: HarnessExecutionPlan;
}

export interface HarnessReadinessResult {
  availability_errors: string[];
}

export interface HarnessTurnLiveBatch {
  harnessEvents: HarnessEvent[];
  traceBundle: {
    spans: ExecutionTrace["spans"];
    events: ExecutionTrace["events"];
    summaries: ExecutionTrace["summaries"];
  };
}

export interface HarnessTurnLivePersistence {
  flushWindowMs?: number;
  onFlush: (batch: HarnessTurnLiveBatch) => Promise<void>;
}

export interface HarnessRunResult {
  sessionId: string;
  finalOutput: string;
  trace: ExecutionTrace;
  events: HarnessEvent[];
}

export type HarnessSessionMode = "fresh" | "resume";

export interface StartSessionArgs {
  repoRoot: string;
  flowHome: string;
  plan: HarnessExecutionPlan;
  ownerId: string;
  executionId: string;
  attemptNumber: number;
  stageId: string;
  stageRunIndex: number;
  workspacePath: string;
  ownerStageId: string;
  sessionMode: HarnessSessionMode;
  persistedSession: Record<string, JsonValue> | null;
  stageSessionPath: string;
}

export interface StartTurnArgs {
  prompt: string;
  eventsFile: string;
  rawEventsFile: string;
  stageSpanId: string;
  plan: HarnessExecutionPlan;
  livePersistence?: HarnessTurnLivePersistence;
}

export interface ActiveHarnessSession<TState = unknown> {
  adapter: HarnessAdapter<TState>;
  ownerStageId: string;
  session: HarnessSession;
  state: TState;
}

export interface HarnessAdapter<TState = unknown> {
  readonly manifest: HarnessManifest;
  getManagedWorkspaceIgnoreEntries(plan: HarnessExecutionPlan): string[];
  startSession(args: StartSessionArgs): Promise<ActiveHarnessSession<TState>>;
  startTurn(context: ActiveHarnessSession<TState>, args: StartTurnArgs): Promise<HarnessRunResult>;
  interruptTurn(context: ActiveHarnessSession<TState>): Promise<void>;
  closeSession(
    context: ActiveHarnessSession<TState>,
    cancelConfig?: WorkflowHarnessCancel,
  ): Promise<void>;
}

export interface HarnessProvider<
  TState = unknown,
  TAuth extends Record<string, JsonValue> = Record<string, JsonValue>,
  TConfig extends Record<string, JsonValue> = Record<string, JsonValue>,
> {
  readonly manifest: HarnessManifest;
  readonly schemas: HarnessValidationSchemas<TAuth, TConfig>;
  checkReadiness?(args: HarnessReadinessCheckArgs): Promise<HarnessReadinessResult>;
  create(): HarnessAdapter<TState>;
}

export function defineHarnessProvider<
  TState = unknown,
  TAuth extends Record<string, JsonValue> = Record<string, JsonValue>,
  TConfig extends Record<string, JsonValue> = Record<string, JsonValue>,
>(factory: HarnessProvider<TState, TAuth, TConfig>): HarnessProvider<TState, TAuth, TConfig> {
  return factory;
}

export function createCliHarnessManifest(args: {
  id: string;
  displayName?: string;
  auth: z.ZodTypeAny;
  config: z.ZodTypeAny;
  defaults?: {
    auth?: HarnessAuth;
    model?: string;
    effort?: string;
      turn_timeout_ms?: number;
      stall_timeout_ms?: number;
      config?: Record<string, JsonValue>;
    };
  capabilities: HarnessManifest["capabilities"];
  supportedWorkspaceModes: readonly WorkspaceMode[];
}): HarnessManifest {
  return {
    id: args.id,
    display_name: args.displayName ?? args.id,
    auth_schema: zodSchemaToManifestJsonSchema(args.auth),
    config_schema: zodSchemaToManifestJsonSchema(args.config),
    defaults: {
      ...(args.defaults ?? {}),
      config: { ...(args.defaults?.config ?? {}) },
    },
    capabilities: args.capabilities,
    supported_workspace_modes: [...args.supportedWorkspaceModes],
  };
}

function zodSchemaToManifestJsonSchema(schema: z.ZodTypeAny): JsonValue {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, JsonValue>;

  if (
    jsonSchema &&
    typeof jsonSchema === "object" &&
    !Array.isArray(jsonSchema)
  ) {
    const { $schema: _schema, ...rest } = jsonSchema;
    return rest as JsonValue;
  }

  return jsonSchema as JsonValue;
}
