import { type ChildProcessWithoutNullStreams } from "node:child_process";

import type {
  HarnessEvent,
  HarnessSession,
  JsonValue,
} from "./types.js";

import { appendNdjson, createId, nowIso } from "./internal-utils.js";
import {
  applyNormalizedHarnessActivity,
  type NormalizedHarnessActivity,
} from "./normalized-activity.js";
import { HarnessTraceBuilder, type TraceBundle } from "./trace-builder.js";
import type {
  HarnessRunResult,
  HarnessTurnLivePersistence,
} from "./index.js";

export interface PendingHarnessTurn {
  controller: HarnessTurnController;
  result: Promise<HarnessRunResult>;
  resolve: (value: HarnessRunResult | Promise<HarnessRunResult>) => void;
  reject: (error: Error) => void;
}

export function createHarnessSession(args: {
  harnessId: string;
  attemptNumber: number;
  stageId: string;
  stageRunIndex: number;
  harnessSession?: Record<string, JsonValue>;
}): HarnessSession {
  return {
    id: createId("session"),
    harness_id: args.harnessId,
    attempt_number: args.attemptNumber,
    stage_id: args.stageId,
    stage_run_index: args.stageRunIndex,
    harness_session: args.harnessSession ?? {},
    started_at: nowIso(),
    last_event_at: null,
  };
}

export class HarnessTurnController {
  readonly trace: HarnessTraceBuilder;
  readonly events: HarnessEvent[] = [];

  private finalOutput = "";
  private turnStartedRecorded = false;
  private timeout: NodeJS.Timeout | null;
  private stallTimeout: NodeJS.Timeout | null;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushChain: Promise<void> = Promise.resolve();
  private readonly pendingHarnessEvents: HarnessEvent[] = [];

  constructor(
    private readonly args: {
      session: HarnessSession;
      eventsFile: string;
      rawEventsFile: string;
      stageSpanId: string;
      promptText?: string | null;
      turnTimeoutMs: number;
      stallTimeoutMs: number;
      onTimeout: (message: string) => void;
      livePersistence?: HarnessTurnLivePersistence;
    },
  ) {
    this.trace = new HarnessTraceBuilder({
      attemptNumber: args.session.attempt_number,
      stageId: args.session.stage_id,
      stageRunIndex: args.session.stage_run_index,
      stageSpanId: args.stageSpanId,
    });
    this.timeout = setTimeout(() => {
      this.args.onTimeout(
        `turn timed out after ${this.args.turnTimeoutMs}ms`,
      );
    }, args.turnTimeoutMs);
    this.stallTimeout = setTimeout(() => {
      this.args.onTimeout(
        `turn stalled after ${this.args.stallTimeoutMs}ms`,
      );
    }, args.stallTimeoutMs);
  }

  record(args: {
    harnessEvent?: HarnessEvent | null;
    rawEnvelope?: Record<string, unknown> | null;
    normalized?: NormalizedHarnessActivity | NormalizedHarnessActivity[] | null;
  }): void {
    if (args.rawEnvelope) {
      void appendNdjson(this.args.rawEventsFile, args.rawEnvelope);
    }
    if (args.harnessEvent) {
      void appendNdjson(this.args.eventsFile, args.harnessEvent);
      this.events.push(args.harnessEvent);
      this.pendingHarnessEvents.push(args.harnessEvent);
      this.args.session.last_event_at = args.harnessEvent.at;
    }

    const normalized = args.normalized
      ? Array.isArray(args.normalized)
        ? args.normalized
        : [args.normalized]
      : [];
    for (const activity of normalized) {
      if (activity.type === "turn.started") {
        if (this.turnStartedRecorded) {
          continue;
        }
        this.turnStartedRecorded = true;
        applyNormalizedHarnessActivity(this.trace, {
          ...activity,
          sessionId: activity.sessionId ?? this.args.session.id,
          attributes: {
            ...(activity.attributes ?? {}),
            ...(this.args.promptText
              ? {
                  prompt_text: this.args.promptText,
                  prompt_format: "text",
                  prompt_source: "rendered_stage_prompt",
                }
              : {}),
          },
        });
        this.trackOutput(activity);
        continue;
      }

      applyNormalizedHarnessActivity(this.trace, activity);
      this.trackOutput(activity);
    }

    if (args.rawEnvelope || args.harnessEvent || normalized.length > 0) {
      this.resetStallTimeout();
    }
    if (args.harnessEvent || normalized.length > 0) {
      this.scheduleFlush();
    }
  }

  async succeed(args?: {
    endedAt?: string;
    finalOutput?: string;
  }): Promise<HarnessRunResult> {
    const finalOutput = (args?.finalOutput ?? this.finalOutput).trim();
    const endedAt = args?.endedAt ?? nowIso();
    const trace = {
      trace_id: this.args.session.id,
      ...this.trace.buildBundle(finalOutput, endedAt),
    };
    await this.flushNow();
    this.clearTimers();
    return {
      sessionId: this.args.session.id,
      finalOutput,
      trace,
      events: this.args.livePersistence?.onFlush ? [] : [...this.events],
    };
  }

  dispose(): void {
    void this.flushNow().catch(() => undefined);
    this.clearTimers();
  }

  async flushNow(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.args.livePersistence?.onFlush) {
      return;
    }

    const harnessEvents = [...this.pendingHarnessEvents];
    this.pendingHarnessEvents.length = 0;
    const traceBundle = this.trace.flushBundle();
    if (
      harnessEvents.length === 0 &&
      traceBundle.spans.length === 0 &&
      traceBundle.events.length === 0 &&
      traceBundle.summaries.length === 0
    ) {
      await this.flushChain;
      return;
    }

    this.flushChain = this.flushChain
      .catch(() => undefined)
      .then(async () => {
        await this.args.livePersistence?.onFlush({
          harnessEvents,
          traceBundle: traceBundle as TraceBundle,
        });
      });
    await this.flushChain;
  }

  private clearTimers(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this.stallTimeout) {
      clearTimeout(this.stallTimeout);
      this.stallTimeout = null;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private resetStallTimeout(): void {
    if (this.stallTimeout) {
      clearTimeout(this.stallTimeout);
    }
    this.stallTimeout = setTimeout(() => {
      this.args.onTimeout(
        `turn stalled after ${this.args.stallTimeoutMs}ms`,
      );
    }, this.args.stallTimeoutMs);
  }

  private scheduleFlush(): void {
    if (!this.args.livePersistence?.onFlush || this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow().catch(() => undefined);
    }, this.args.livePersistence.flushWindowMs ?? 100);
  }

  private trackOutput(activity: NormalizedHarnessActivity): void {
    if (activity.type === "assistant_output.delta") {
      this.finalOutput += activity.delta;
      return;
    }

    if (activity.type === "assistant_output.completed") {
      this.finalOutput = activity.text;
    }
  }
}

export function createPendingHarnessTurn(
  args: ConstructorParameters<typeof HarnessTurnController>[0],
): PendingHarnessTurn {
  const controller = new HarnessTurnController(args);
  let resolveTurn!: (value: HarnessRunResult | Promise<HarnessRunResult>) => void;
  let rejectTurn!: (error: Error) => void;
  const result = new Promise<HarnessRunResult>((resolve, reject) => {
    resolveTurn = resolve;
    rejectTurn = reject;
  });

  return {
    controller,
    result,
    resolve: resolveTurn,
    reject: rejectTurn,
  };
}

export async function terminateProcess(
  process: ChildProcessWithoutNullStreams,
  gracefulTimeoutMs: number,
  hardKillTimeoutMs: number,
): Promise<void> {
  if (process.exitCode !== null || process.killed) {
    return;
  }

  const closed = waitForProcessClose(process);
  process.kill("SIGTERM");
  if (await raceWithTimeout(closed, gracefulTimeoutMs)) {
    return;
  }

  if (process.exitCode === null && !process.killed) {
    process.kill("SIGKILL");
  }
  await raceWithTimeout(closed, hardKillTimeoutMs);
}

export function waitForProcessClose(
  process: ChildProcessWithoutNullStreams,
): Promise<void> {
  return new Promise((resolve) => {
    if (process.exitCode !== null) {
      resolve();
      return;
    }

    const onClose = () => {
      process.off("close", onClose);
      resolve();
    };
    process.on("close", onClose);
  });
}

async function raceWithTimeout(
  promise: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let resolved = false;
  let timer: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      promise.then(() => {
        resolved = true;
      }),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
    return resolved;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
