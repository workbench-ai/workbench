import type { AgentTraceAdapter } from "@workbench-ai/agent-driver";
import { claudeAgentTraceAdapter } from "@workbench-ai/agent-driver-anthropic-claude-code";
import { codexAgentTraceAdapter } from "@workbench-ai/agent-driver-openai-codex";

const ADAPTERS = [codexAgentTraceAdapter, claudeAgentTraceAdapter] as const;

export function builtinAgentTraceAdapters(): readonly AgentTraceAdapter[] {
  return ADAPTERS;
}
