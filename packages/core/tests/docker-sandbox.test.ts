import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type {
  WorkbenchExecutionRuntimeInput,
} from "../src/execution-runtime-types.ts";
import {
  createDockerSandboxPlane,
} from "../src/sandbox-backends/docker.ts";

const tempRoots: string[] = [];
const originalPath = process.env.PATH;
const originalDockerAvailabilityTimeoutMs = process.env.WORKBENCH_DOCKER_AVAILABILITY_TIMEOUT_MS;

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  process.env.PATH = originalPath;
  if (originalDockerAvailabilityTimeoutMs === undefined) {
    delete process.env.WORKBENCH_DOCKER_AVAILABILITY_TIMEOUT_MS;
  } else {
    process.env.WORKBENCH_DOCKER_AVAILABILITY_TIMEOUT_MS = originalDockerAvailabilityTimeoutMs;
  }
  await Promise.all(tempRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  ));
});

describe("Docker sandbox preflight", () => {
  test("fails promptly when docker info does not return", async () => {
    const root = await makeTempRoot("workbench-docker-sandbox-");
    const bin = path.join(root, "bin");
    await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(path.join(bin, "docker"), "#!/bin/sh\nsleep 5\n", { mode: 0o755 });
    process.env.PATH = `${bin}${path.delimiter}${originalPath ?? ""}`;
    process.env.WORKBENCH_DOCKER_AVAILABILITY_TIMEOUT_MS = "75";

    const plane = createDockerSandboxPlane(
      { workdir: root } as WorkbenchExecutionRuntimeInput,
      "2026-06-20T00:00:00.000Z",
      {} as never,
    );
    const startedAt = Date.now();

    await expect(plane.prepareEnvironment({
      id: "exec_docker_timeout",
      sandbox: { kind: "oci", ref: "docker://workbench/workbench-node-22:envv_node_22" },
    } as never)).rejects.toThrow(/Docker sandbox unavailable: .*did not respond within 75ms/u);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
