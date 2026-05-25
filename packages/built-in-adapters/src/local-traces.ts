import {
  sortLocalTraceRefs,
  type AgentReadableTraceDigest,
  type LocalTraceAdapter,
  type LocalTraceRef,
} from "@workbench-ai/agent-driver";
import { claudeLocalTraceAdapter } from "@workbench-ai/agent-driver-anthropic-claude-code";
import { codexLocalTraceAdapter } from "@workbench-ai/agent-driver-openai-codex";

const BUILT_IN_LOCAL_TRACE_ADAPTERS: readonly LocalTraceAdapter[] = [
  codexLocalTraceAdapter,
  claudeLocalTraceAdapter,
];

export function builtinLocalTraceAdapters(): LocalTraceAdapter[] {
  return [...BUILT_IN_LOCAL_TRACE_ADAPTERS];
}

export function builtinLocalTraceAdapter(id: string): LocalTraceAdapter | null {
  return BUILT_IN_LOCAL_TRACE_ADAPTERS.find((adapter) => adapter.id === id) ?? null;
}

export {
  sortLocalTraceRefs,
  type AgentReadableTraceDigest,
  type LocalTraceAdapter,
  type LocalTraceRef,
};
