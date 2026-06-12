import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  WorkbenchExecutionEventBatch,
} from "@workbench-ai/workbench-contract";

import {
  publishWorkbenchProgressStdoutEnvelope,
  WORKBENCH_PROGRESS_STDOUT_PREFIX,
  type WorkbenchProgressStdoutEnvelope,
} from "../src/execution-events.ts";

describe("execution progress events", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("delivers parsed stdout progress to HTTP by default", async () => {
    const received: unknown[] = [];
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        received.push(JSON.parse(body));
        response.writeHead(202, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected test HTTP server to bind to a TCP port.");
    }
    const url = `http://127.0.0.1:${address.port}/progress`;
    const envelope = progressEnvelope(url);

    try {
      await publishWorkbenchProgressStdoutEnvelope(envelope, {
        url,
        token: "target-token",
        ownerUserId: "user_1",
        transport: "stdout",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      schema: "workbench.remote.job.progress.v1",
      ownerUserId: "user_1",
      leaseToken: "target-token",
      batch: {
        projectId: "project_1",
        runId: "run_1",
        jobId: "job_1",
      },
    });
  });

  test("forwards parsed stdout progress only when requested", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const envelope = progressEnvelope("http://127.0.0.1:9/progress");

    await publishWorkbenchProgressStdoutEnvelope(envelope, {
      url: envelope.url,
      token: "target-token",
      ownerUserId: "user_1",
      transport: "stdout",
    }, { forwardStdout: true });

    expect(stdout).toHaveBeenCalledTimes(1);
    const written = String(stdout.mock.calls[0]?.[0] ?? "");
    expect(written).toContain(WORKBENCH_PROGRESS_STDOUT_PREFIX);
    expect(written).toContain("\"leaseToken\":\"target-token\"");
    expect(written).toContain("\"ownerUserId\":\"user_1\"");
  });
});

function progressEnvelope(url: string): WorkbenchProgressStdoutEnvelope {
  return {
    url,
    body: {
      schema: "workbench.remote.job.progress.v1",
      leaseToken: "target-token",
      batch: progressBatch(),
    },
  };
}

function progressBatch(): WorkbenchExecutionEventBatch {
  const at = "2026-06-11T00:00:00.000Z";
  return {
    projectId: "project_1",
    runId: "run_1",
    jobId: "job_1",
    executionId: "exec_1",
    attempt: 1,
    seqStart: 1,
    seqEnd: 1,
    emittedAt: at,
    events: [{
      seq: 1,
      at,
      source: "adapter",
      role: "runner",
      schema: "workbench.execution.step.v1",
      payload: {
        step: "skill.run",
        status: "started",
      },
    }],
  };
}
