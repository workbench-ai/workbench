import type {
  Json,
  WorkbenchExecutionEvent,
  WorkbenchExecutionEventBatch,
  WorkbenchExecutionEventSource,
} from "@workbench-ai/workbench-contract";

export interface WorkbenchExecutionProgressTarget {
  url: string;
  token: string;
  ownerUserId?: string;
  flushWindowMs?: number;
  transport?: "http" | "stdout" | "both";
  appendBatch?: (batch: WorkbenchExecutionEventBatch) => Promise<void>;
}

export interface WorkbenchExecutionEventPublisherContext {
  projectId: string;
  runId: string;
  jobId: string;
  executionId: string;
  attempt: number;
  target?: WorkbenchExecutionProgressTarget;
}

export interface WorkbenchExecutionEventInput {
  at?: string;
  source: WorkbenchExecutionEventSource;
  role?: WorkbenchExecutionEvent["role"];
  schema: WorkbenchExecutionEvent["schema"];
  payload: Json;
}

export interface WorkbenchExecutionEventPublisher {
  readonly enabled: boolean;
  readonly flushWindowMs?: number;
  publish(events: readonly WorkbenchExecutionEventInput[]): Promise<void>;
  flush(): Promise<void>;
}

export const WORKBENCH_PROGRESS_STDOUT_PREFIX = "__WORKBENCH_PROGRESS__";

export function createWorkbenchExecutionEventPublisher(
  context: WorkbenchExecutionEventPublisherContext,
): WorkbenchExecutionEventPublisher {
  const target = validProgressTarget(context.target);
  if (!target) {
    return NOOP_EXECUTION_EVENT_PUBLISHER;
  }
  let seq = 0;
  return {
    enabled: true,
    flushWindowMs: target.flushWindowMs,
    async publish(inputs) {
      if (inputs.length === 0) {
        return;
      }
      const events = inputs.map((input): WorkbenchExecutionEvent => ({
        seq: ++seq,
        at: input.at ?? new Date().toISOString(),
        source: input.source,
        ...(input.role ? { role: input.role } : {}),
        schema: input.schema,
        payload: input.payload,
      }));
      const batch: WorkbenchExecutionEventBatch = {
        projectId: context.projectId,
        runId: context.runId,
        jobId: context.jobId,
        executionId: context.executionId,
        attempt: Math.max(1, Math.floor(context.attempt || 1)),
        seqStart: events[0]!.seq,
        seqEnd: events[events.length - 1]!.seq,
        emittedAt: new Date().toISOString(),
        events,
      };
      await publishProgressBatch(target, batch);
    },
    async flush() {
      return;
    },
  };
}

export async function publishCommandStepEvent(
  publisher: WorkbenchExecutionEventPublisher | undefined,
  args: {
    step: string;
    status: "started" | "succeeded" | "failed";
    role?: WorkbenchExecutionEvent["role"];
    exitCode?: number;
    error?: string;
  },
): Promise<void> {
  if (!publisher?.enabled) {
    return;
  }
  await publisher.publish([{
    source: "command",
    ...(args.role ? { role: args.role } : {}),
    schema: "workbench.execution.step.v1",
    payload: {
      step: args.step,
      status: args.status,
      ...(typeof args.exitCode === "number" ? { exitCode: args.exitCode } : {}),
      ...(args.error ? { error: args.error } : {}),
    },
  }]).catch(() => undefined);
}

const NOOP_EXECUTION_EVENT_PUBLISHER: WorkbenchExecutionEventPublisher = {
  enabled: false,
  async publish() {
    return;
  },
  async flush() {
    return;
  },
};

function validProgressTarget(target: WorkbenchExecutionProgressTarget | undefined): WorkbenchExecutionProgressTarget | null {
  if (!target?.url.trim() || !target.token.trim()) {
    return null;
  }
  return {
    url: target.url.trim(),
    token: target.token,
    ...(typeof target.ownerUserId === "string" && target.ownerUserId.trim() ? { ownerUserId: target.ownerUserId.trim() } : {}),
    ...(typeof target.flushWindowMs === "number" && Number.isFinite(target.flushWindowMs) && target.flushWindowMs >= 0
      ? { flushWindowMs: target.flushWindowMs }
      : {}),
    ...(target.transport === "stdout" || target.transport === "both" ? { transport: target.transport } : { transport: "http" as const }),
    ...(target.appendBatch ? { appendBatch: target.appendBatch } : {}),
  };
}

async function publishProgressBatch(
  target: WorkbenchExecutionProgressTarget,
  batch: WorkbenchExecutionEventBatch,
): Promise<void> {
  const envelope = progressStdoutEnvelope(target, batch);
  if (target.transport === "stdout" || target.transport === "both") {
    process.stdout.write(`${WORKBENCH_PROGRESS_STDOUT_PREFIX}${JSON.stringify(envelope)}\n`);
  }
  if (target.transport === "stdout") {
    return;
  }
  await postProgressBody(envelope);
}

export interface WorkbenchProgressStdoutEnvelope {
  url: string;
  body: {
    schema: "workbench.remote.job.progress.v1";
    ownerUserId?: string;
    leaseToken: string;
    batch: WorkbenchExecutionEventBatch;
  };
}

export interface PublishWorkbenchProgressStdoutEnvelopeOptions {
  forwardStdout?: boolean;
}

export function createWorkbenchProgressStdoutParser(
  onEnvelope: (envelope: WorkbenchProgressStdoutEnvelope) => void,
): {
  write(chunk: Buffer | string): void;
  flush(): void;
} {
  let buffer = "";
  const consumeRawEnvelope = (rawEnvelope: string) => {
    const raw = rawEnvelope.trim();
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isProgressStdoutEnvelope(parsed)) {
        onEnvelope(parsed);
      }
    } catch {
      // Progress telemetry is best-effort and must not crash the sandbox host.
    }
  };
  const drain = (final: boolean) => {
    for (;;) {
      const prefixIndex = buffer.indexOf(WORKBENCH_PROGRESS_STDOUT_PREFIX);
      if (prefixIndex < 0) {
        buffer = buffer.length > WORKBENCH_PROGRESS_STDOUT_PREFIX.length
          ? buffer.slice(-WORKBENCH_PROGRESS_STDOUT_PREFIX.length)
          : buffer;
        return;
      }
      if (prefixIndex > 0) {
        buffer = buffer.slice(prefixIndex);
      }
      const payloadStart = WORKBENCH_PROGRESS_STDOUT_PREFIX.length;
      const delimiterIndex = firstExistingIndex([
        buffer.indexOf("\n", payloadStart),
        buffer.indexOf("\r", payloadStart),
        buffer.indexOf(WORKBENCH_PROGRESS_STDOUT_PREFIX, payloadStart),
      ]);
      if (delimiterIndex < 0) {
        if (!final) {
          return;
        }
        consumeRawEnvelope(buffer.slice(payloadStart));
        buffer = "";
        return;
      }
      consumeRawEnvelope(buffer.slice(payloadStart, delimiterIndex));
      buffer = buffer.slice(delimiterIndex);
      while (buffer.startsWith("\n") || buffer.startsWith("\r")) {
        buffer = buffer.slice(1);
      }
    }
  };
  return {
    write(chunk) {
      buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      drain(false);
    },
    flush() {
      drain(true);
    },
  };
}

export async function publishWorkbenchProgressStdoutEnvelope(
  envelope: WorkbenchProgressStdoutEnvelope,
  expectedTarget?: WorkbenchExecutionProgressTarget,
  options: PublishWorkbenchProgressStdoutEnvelopeOptions = {},
): Promise<void> {
  const target = validProgressTarget(expectedTarget);
  if (!target) {
    await postProgressBody(envelope);
    return;
  }
  if (!progressEnvelopeMatchesTarget(envelope, target)) {
    return;
  }
  if (target.appendBatch) {
    await target.appendBatch(envelope.body.batch);
    return;
  }
  const deliveredEnvelope = {
    url: target.url,
    body: {
      ...envelope.body,
      ...(target.ownerUserId ? { ownerUserId: target.ownerUserId } : {}),
      leaseToken: target.token,
    },
  };
  if (target.transport === "stdout" && options.forwardStdout === true) {
    process.stdout.write(`${WORKBENCH_PROGRESS_STDOUT_PREFIX}${JSON.stringify(deliveredEnvelope)}\n`);
    return;
  }
  await postProgressBody(deliveredEnvelope);
}

function progressEnvelopeMatchesTarget(
  envelope: WorkbenchProgressStdoutEnvelope,
  target: WorkbenchExecutionProgressTarget,
): boolean {
  return envelope.url === target.url &&
    envelope.body.leaseToken === target.token &&
    (
      !target.ownerUserId ||
      envelope.body.ownerUserId === undefined ||
      envelope.body.ownerUserId === target.ownerUserId
    );
}

function firstExistingIndex(indexes: number[]): number {
  return indexes.filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? -1;
}

function progressStdoutEnvelope(
  target: WorkbenchExecutionProgressTarget,
  batch: WorkbenchExecutionEventBatch,
): WorkbenchProgressStdoutEnvelope {
  return {
    url: target.url,
    body: {
      schema: "workbench.remote.job.progress.v1",
      ...(target.ownerUserId ? { ownerUserId: target.ownerUserId } : {}),
      leaseToken: target.token,
      batch,
    },
  };
}

async function postProgressBody(envelope: WorkbenchProgressStdoutEnvelope): Promise<void> {
  const response = await fetch(envelope.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(envelope.body),
  });
  if (!response.ok) {
    throw new Error(`Workbench progress publish failed with HTTP ${response.status}.`);
  }
}

function isProgressStdoutEnvelope(value: unknown): value is WorkbenchProgressStdoutEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string" || record.url.length === 0) {
    return false;
  }
  const body = record.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  const bodyRecord = body as Record<string, unknown>;
  return bodyRecord.schema === "workbench.remote.job.progress.v1"
    && typeof bodyRecord.leaseToken === "string"
    && Boolean(bodyRecord.batch);
}
