export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;

export type HarnessAuth = Record<string, JsonValue>;
export type WorkspaceMode = "managed" | "project";

export interface WorkflowHarnessRetry {
  max_retries: number;
  base_delay_ms: number;
  max_backoff_ms: number;
}

export interface WorkflowHarnessCancel {
  graceful_timeout_ms: number;
  hard_kill_timeout_ms: number;
}

export interface WorkflowHarnessPrepare {
  run: string;
  env?: Record<string, string>;
  timeout_ms: number;
}

export interface WorkflowHarness {
  id: string;
  auth: HarnessAuth;
  model?: string;
  effort?: string;
  turn_timeout_ms: number;
  stall_timeout_ms: number;
  config: Record<string, JsonValue>;
  prepare?: WorkflowHarnessPrepare;
  retry: WorkflowHarnessRetry;
  cancel: WorkflowHarnessCancel;
}

export interface WorkflowWorkspace {
  mode: WorkspaceMode;
  prune_ttl_seconds?: number;
}

export interface WorkflowDocument {
  workspace: WorkflowWorkspace;
}

export const DEFAULT_HARNESS_RETRY: WorkflowHarnessRetry = {
  max_retries: 0,
  base_delay_ms: 10_000,
  max_backoff_ms: 300_000,
};

export const DEFAULT_HARNESS_CANCEL: WorkflowHarnessCancel = {
  graceful_timeout_ms: 15_000,
  hard_kill_timeout_ms: 5_000,
};

export const DEFAULT_HARNESS_PREPARE_TIMEOUT_MS = 300_000;

export interface HarnessSession {
  id: string;
  harness_id: string;
  attempt_number: number;
  stage_id: string;
  stage_run_index: number;
  harness_session: Record<string, JsonValue>;
  started_at: string;
  last_event_at: string | null;
}

export type HarnessEventPhase =
  | "session"
  | "turn"
  | "item"
  | "tool"
  | "error"
  | "usage";

export interface HarnessEvent {
  at: string;
  attempt_number: number;
  stage_id: string;
  stage_run_index: number;
  phase: HarnessEventPhase;
  name: string;
  payload: Record<string, JsonValue>;
}

export type TraceSpanKind =
  | "hook"
  | "stage"
  | "turn"
  | "tool_call"
  | "assistant_output"
  | "usage"
  | "gate"
  | "action"
  | "error";

export type TraceSpanStatus =
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "warning";

export type TraceEventKind =
  | "status"
  | "message"
  | "output"
  | "usage"
  | "error"
  | "note";

export interface TraceSpan {
  id: string;
  parent_id: string | null;
  attempt_number: number;
  stage_id: string | null;
  stage_run_index: number | null;
  kind: TraceSpanKind;
  title: string;
  status: TraceSpanStatus;
  started_at: string;
  ended_at: string | null;
  attributes: Record<string, JsonValue>;
}

export interface TraceEvent {
  id: string;
  span_id: string;
  attempt_number: number;
  stage_id: string | null;
  stage_run_index: number | null;
  kind: TraceEventKind;
  at: string;
  message: string;
  attributes: Record<string, JsonValue>;
}

export interface TraceUsageSummary {
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  uncached_input_tokens: number | null;
  cached_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_output_tokens: number | null;
  total_tokens: number | null;
  total_cost_usd: number | null;
  cost_source: string | null;
  pricing_source: string | null;
}

export interface TraceSummary {
  attempt_number: number;
  stage_id: string | null;
  stage_run_index: number | null;
  status: TraceSpanStatus;
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  tool_call_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  usage?: TraceUsageSummary | null;
  final_output_present: boolean;
  error_message: string | null;
}

export interface ExecutionTrace {
  trace_id: string;
  spans: TraceSpan[];
  events: TraceEvent[];
  summaries: TraceSummary[];
}

export interface GlobalSkillProviderSupport {
  providerId: string;
  providerLabel: string;
}

export interface GlobalSkillCatalogEntry {
  id: string;
  label: string;
  summary: string | null;
  enabled: boolean;
  providerSupport: GlobalSkillProviderSupport[];
}

export interface GlobalSkillCatalog {
  skills: GlobalSkillCatalogEntry[];
}

export interface GlobalSkillUpdate {
  enabled: boolean;
}

export interface ProviderIntegrationCatalogEntry {
  id: string;
  label: string;
  enabled: boolean;
}

export interface ProviderIntegrationCatalog {
  providerId: string;
  providerLabel: string;
  integrations: ProviderIntegrationCatalogEntry[];
}

export interface ProviderIntegrationUpdate {
  enabledIds: string[];
}
