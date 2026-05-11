import type { JsonValue, TraceSpan } from "@workbench-ai/flow-contracts";
import {
  applyNormalizedHarnessActivity,
  HarnessTraceBuilder,
  readTraceString,
  type HarnessTraceReplayer,
} from "@workbench-ai/flow-harness-sdk";
import { piCodingAgentHarnessManifest } from "./manifest.js";
import {
  createPiNormalizationState,
  normalizePiEvent,
  type PiNormalizationState,
} from "./normalize.js";
import { isJsonObject, type PiAgentEvent } from "./rpc.js";

interface PiReplayEntry {
  at: string;
  event: PiAgentEvent;
}

export const piTraceReplayer: HarnessTraceReplayer<PiReplayEntry> = {
  harnessId: piCodingAgentHarnessManifest.id,
  parseRawReplayEntries(entries) {
    const replayEntries = parsePiTraceReplayEntries(entries, (entry) => {
      const eventValue = entry.event as JsonValue | undefined;
      if (
        entry.source !== "event" ||
        typeof entry.at !== "string" ||
        !isJsonObject(eventValue) ||
        typeof eventValue.type !== "string"
      ) {
        return null;
      }
      return {
        at: entry.at,
        event: eventValue as unknown as PiAgentEvent,
      };
    });
    return replayEntries.length === 0 ? null : { entries: replayEntries };
  },
  parseHarnessReplayEntries(entries) {
    const replayEntries = parsePiTraceReplayEntries(entries, (entry) => {
      const payloadValue = entry.payload as JsonValue | undefined;
      if (
        typeof entry.at !== "string" ||
        typeof entry.name !== "string" ||
        !entry.name.startsWith("pi/") ||
        !isJsonObject(payloadValue) ||
        typeof payloadValue.type !== "string"
      ) {
        return null;
      }
      return {
        at: entry.at,
        event: payloadValue as unknown as PiAgentEvent,
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
    const state = buildReplayState(args.oldTurnSpan);

    for (const entry of args.source.entries) {
      const normalized = normalizePiEvent(state, entry.event, entry.at);
      for (const activity of normalized) {
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

function parsePiTraceReplayEntries(
  entries: Array<Record<string, unknown>>,
  select: (entry: Record<string, unknown>) => PiReplayEntry | null,
): PiReplayEntry[] {
  const replayEntries: Array<PiReplayEntry & { originalIndex: number }> = [];
  for (const [index, entry] of entries.entries()) {
    const selected = select(entry);
    if (!selected) {
      continue;
    }
    replayEntries.push({
      ...selected,
      originalIndex: index,
    });
  }
  replayEntries.sort(comparePiReplayEntries);
  return replayEntries.map(({ originalIndex: _originalIndex, ...entry }) => entry);
}

function comparePiReplayEntries(
  left: PiReplayEntry & { originalIndex: number },
  right: PiReplayEntry & { originalIndex: number },
): number {
  const atCompare = left.at.localeCompare(right.at);
  if (atCompare !== 0) {
    return atCompare;
  }
  const phaseCompare =
    piReplayPhaseRank(left.event.type) - piReplayPhaseRank(right.event.type);
  if (phaseCompare !== 0) {
    return phaseCompare;
  }
  return left.originalIndex - right.originalIndex;
}

function piReplayPhaseRank(type: string): number {
  switch (type) {
    case "agent_start":
      return 0;
    case "turn_start":
      return 1;
    case "message_start":
      return 2;
    case "message_update":
      return 3;
    case "message_end":
      return 4;
    case "tool_execution_start":
      return 5;
    case "tool_execution_update":
      return 6;
    case "tool_execution_end":
      return 7;
    case "turn_end":
      return 8;
    case "agent_end":
      return 9;
    default:
      return 10;
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

function buildReplayState(turnSpan: TraceSpan | null): PiNormalizationState {
  return createPiNormalizationState({
    provider: piCodingAgentHarnessManifest.id,
    model: readTraceString(turnSpan?.attributes, "model"),
    sessionId: readTraceString(turnSpan?.attributes, "session_id"),
  });
}
