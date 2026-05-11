import type {
  JsonValue,
  TraceSpan,
} from "@workbench-ai/flow-contracts";

import type { TraceBundle } from "./trace-builder.js";

export interface HarnessTraceReplayEntry {
  at: string;
}

export interface HarnessTraceReplaySource<
  TEntry extends HarnessTraceReplayEntry = HarnessTraceReplayEntry,
> {
  entries: readonly TEntry[];
}

export interface HarnessTraceReplayerBuildArgs<
  TEntry extends HarnessTraceReplayEntry = HarnessTraceReplayEntry,
> {
  artifact: {
    attempt_number: number;
    stage_id: string;
    run_index: number;
    output_file: string;
    events_file: string;
    raw_events_file?: string | null;
    final_output?: string | null;
  };
  source: HarnessTraceReplaySource<TEntry>;
  oldTurnSpan: TraceSpan | null;
  stageSpanId: string;
  stageStartedAt: string;
  endedAt: string;
  readFinalOutput: () => Promise<string>;
}

export interface HarnessTraceReplayer<
  TEntry extends HarnessTraceReplayEntry = HarnessTraceReplayEntry,
> {
  harnessId: string;
  parseRawReplayEntries(
    entries: Array<Record<string, unknown>>,
  ): HarnessTraceReplaySource<TEntry> | null;
  parseHarnessReplayEntries(
    entries: Array<Record<string, unknown>>,
  ): HarnessTraceReplaySource<TEntry> | null;
  buildTraceBundle(
    args: HarnessTraceReplayerBuildArgs<TEntry>,
  ): Promise<TraceBundle>;
}

export function readTraceString(
  value: Record<string, JsonValue> | undefined,
  key: string,
): string | null {
  const current = value?.[key];
  return typeof current === "string" && current.length > 0 ? current : null;
}
