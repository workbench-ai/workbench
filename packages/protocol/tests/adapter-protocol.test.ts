import http from "node:http";

import { describe, expect, test } from "vitest";

import {
  WORKBENCH_ADAPTER_MANIFEST_PROTOCOL,
  WORKBENCH_ADAPTER_PROTOCOL,
  WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS_ENV,
  adapterCommandName,
  adapterResult,
  assertWorkbenchAdapterOperationResultOk,
  assertWorkbenchAdapterOperationSupport,
  collectWorkbenchAdapterAuthRequirements,
  defineAdapter,
  defineEngineResolver,
  defineGradeRunner,
  defineImprover,
  defineSkillRunner,
  normalizeWorkbenchAdapterOperationRequest,
  normalizeWorkbenchAdapterOperationResult,
  normalizeWorkbenchEngineCase,
  parseWorkbenchAdapterManifest,
  runWorkbenchRuntimeOperationSequence,
  workbenchAdapterManifestFromDefinition,
  workbenchAdapterOperationExecutor,
  withDefaultWorkbenchAdapterAuthProfiles,
  type WorkbenchAdapterOperationRequest,
} from "../src/index.ts";

describe("Workbench adapter protocol", () => {
  test("keeps adapter operation requests serializable", () => {
    const request = {
      protocol: WORKBENCH_ADAPTER_PROTOCOL,
      id: "command",
      operation: "skill.run",
      invocation: {
        use: "command",
        with: { command: "sh \"$CASE_DIR/tests/test.sh\"" },
      },
      context: {
        case: {
          id: "case-001",
        },
      },
      paths: {
        workspace: "/workspace",
        output: "/workspace/output",
        result: "/workspace/output/workbench-result.json",
        skill: "/workspace/skill",
        case: "/workspace/case",
      },
    } satisfies WorkbenchAdapterOperationRequest;

    expect(JSON.parse(JSON.stringify(request))).toMatchObject({
      protocol: "workbench.adapter.v3",
      operation: "skill.run",
      context: { case: { id: "case-001" } },
    });
  });

  test("names adapter commands and wraps results without runtime-specific fields", () => {
    expect(adapterCommandName("codex")).toBe("workbench-adapter-codex");
    expect(adapterResult("skill.run", { score: 1 })).toEqual({
      protocol: "workbench.adapter-result.v1",
      operation: "skill.run",
      ok: true,
      value: { score: 1 },
    });
  });

  test("uses install commands in adapter manifests", () => {
    const manifest = parseWorkbenchAdapterManifest([
      "id: command",
      `protocol: ${WORKBENCH_ADAPTER_MANIFEST_PROTOCOL}`,
      "install:",
      "  - npm install --global workbench-adapter-command",
      "operations:",
      "  skill.run:",
      "    command: workbench-adapter-command",
      "",
    ].join("\n"));

    expect(manifest).toMatchObject({
      protocol: "workbench.adapter-manifest.v1",
      install: ["npm install --global workbench-adapter-command"],
      operations: {
        "skill.run": { command: "workbench-adapter-command" },
      },
    });
    expect(() => parseWorkbenchAdapterManifest([
      "id: command",
      `protocol: ${WORKBENCH_ADAPTER_MANIFEST_PROTOCOL}`,
      "extra: []",
      "operations:",
      "  skill.run:",
      "    command: workbench-adapter-command",
      "",
    ].join("\n"))).toThrow(/unsupported field: extra/u);
  });

  test("parses manifests and defaults auth through the public protocol package", () => {
    const manifest = parseWorkbenchAdapterManifest([
      "id: codex",
      `protocol: ${WORKBENCH_ADAPTER_MANIFEST_PROTOCOL}`,
      "operations:",
      "  skill.run: {}",
      "  skill.improve: {}",
      "auth:",
      "  methods:",
      "    oauth:",
      "      files:",
      "        - path: .codex/auth.json",
      "",
    ].join("\n"));
    const record = withDefaultWorkbenchAdapterAuthProfiles(
      { run: { use: "codex" } },
      [manifest],
    );

    expect(manifest.operations["skill.run"]?.command).toBe("workbench-adapter-codex");
    expect(manifest.operations["skill.run"]?.executor).toBe("sandbox");
    expect((record.run as { auth?: unknown }).auth).toBe("default");
    expect(collectWorkbenchAdapterAuthRequirements([record.run as { use: string }], [manifest])).toEqual([
      { adapterId: "codex", profile: "default" },
    ]);
  });

  test("parses operation executors and defaults to sandbox", () => {
    const manifest = parseWorkbenchAdapterManifest([
      "id: external-engine",
      `protocol: ${WORKBENCH_ADAPTER_MANIFEST_PROTOCOL}`,
      "operations:",
      "  engine.resolve: {}",
      "  grade.run:",
      "    command: external-engine-adapter",
      "    executor: host",
      "",
    ].join("\n"));

    expect(workbenchAdapterOperationExecutor(manifest, "engine.resolve")).toBe("sandbox");
    expect(workbenchAdapterOperationExecutor(manifest, "grade.run")).toBe("host");
    expect(() => parseWorkbenchAdapterManifest([
      "id: invalid-executor",
      `protocol: ${WORKBENCH_ADAPTER_MANIFEST_PROTOCOL}`,
      "operations:",
      "  grade.run:",
      "    executor: worker",
      "",
    ].join("\n"))).toThrow("executor must be sandbox or host");
  });

  test("normalizes adapter operation requests", () => {
    expect(normalizeWorkbenchAdapterOperationRequest({
      protocol: "workbench.adapter.v3",
      id: "exec_1",
      operation: "grade.run",
      invocation: {
        use: "command",
      },
      context: {
        skill: {
          prepare: { command: "cp -R input/skills/current/. ." },
        },
      },
      paths: {
        workspace: "/workspace",
        output: "/workspace/output",
        result: "/workspace/output/workbench-result.json",
        skill: "/workspace/input/skills/current",
        traces: "/workspace/input/traces",
        enginePrivate: "/workspace/private/engine",
      },
    })).toMatchObject({
      id: "exec_1",
      operation: "grade.run",
      invocation: {
        use: "command",
        with: {},
      },
      context: {
        skill: {
          prepare: { command: "cp -R input/skills/current/. ." },
        },
      },
      paths: {
        workspace: "/workspace",
        output: "/workspace/output",
        result: "/workspace/output/workbench-result.json",
        skill: "/workspace/input/skills/current",
        traces: "/workspace/input/traces",
        enginePrivate: "/workspace/private/engine",
      },
    });
  });

  test("rejects unsupported broad adapter path fields", () => {
    expect(() => normalizeWorkbenchAdapterOperationRequest({
      protocol: "workbench.adapter.v3",
      id: "exec_invalid_paths",
      operation: "grade.run",
      invocation: {
        use: "command",
      },
      paths: {
        workspace: "/workspace",
        output: "/workspace/output",
        result: "/workspace/output/workbench-result.json",
        skill: "/workspace/input/skills/current",
        traces: "/workspace/input/traces",
        input: "/workspace/input",
        artifacts: "/workspace/output/artifacts",
        scratch: "/workspace/scratch",
      },
    })).toThrow("unsupported fields: input, artifacts, scratch");
  });

  test("emits v3 operation names from typed helper definitions", () => {
    const manifest = workbenchAdapterManifestFromDefinition(defineAdapter({
      id: "adapter",
      engineResolve: defineEngineResolver(),
      skillRun: defineSkillRunner(),
      gradeRun: defineGradeRunner(),
      improve: defineImprover(),
    }));

    expect(manifest).toMatchObject({
      protocol: WORKBENCH_ADAPTER_MANIFEST_PROTOCOL,
      operations: {
        "engine.resolve": { command: "workbench-adapter-adapter" },
        "skill.run": { command: "workbench-adapter-adapter" },
        "grade.run": { command: "workbench-adapter-adapter" },
        "skill.improve": { command: "workbench-adapter-adapter" },
      },
    });
  });

  test("rejects invalid protocol strings and unknown operation names", () => {
    expect(() => parseWorkbenchAdapterManifest([
      "id: invalid-protocol",
      "protocol: workbench.adapter.invalid",
      "operations:",
      "  skill.run: {}",
      "",
    ].join("\n"))).toThrow(WORKBENCH_ADAPTER_MANIFEST_PROTOCOL);
    expect(() => parseWorkbenchAdapterManifest([
      "id: invalid-operation",
      `protocol: ${WORKBENCH_ADAPTER_MANIFEST_PROTOCOL}`,
      "operations:",
      "  unknown.run: {}",
      "",
    ].join("\n"))).toThrow("must be engine.resolve");
    expect(() => normalizeWorkbenchAdapterOperationRequest({
      protocol: "workbench.adapter.invalid",
      id: "exec_invalid_protocol",
      operation: "skill.run",
      invocation: { use: "invalid-protocol" },
      paths: {
        workspace: "/workspace",
        output: "/workspace/output",
        result: "/workspace/output/workbench-result.json",
      },
    })).toThrow("workbench.adapter.v3");
    expect(() => normalizeWorkbenchAdapterOperationRequest({
      protocol: "workbench.adapter.v3",
      id: "exec_invalid_operation",
      operation: "unknown.run",
      invocation: { use: "invalid-operation" },
      paths: {
        workspace: "/workspace",
        output: "/workspace/output",
        result: "/workspace/output/workbench-result.json",
      },
    })).toThrow("must be engine.resolve");
  });

  test("normalizes adapter operation results", () => {
    expect(normalizeWorkbenchAdapterOperationResult({
      protocol: "workbench.adapter-result.v1",
      operation: "grade.run",
      value: {
        score: 0.75,
        metrics: { accuracy: 0.75 },
      },
    }, "grade.run")).toMatchObject({
      protocol: "workbench.adapter-result.v1",
      operation: "grade.run",
      value: {
        score: 0.75,
        metrics: { accuracy: 0.75 },
      },
    });

    expect(normalizeWorkbenchAdapterOperationResult({
      protocol: "workbench.adapter-result.v1",
      operation: "skill.improve",
      value: {
        files: [{
          path: "prompt.md",
          content: "updated\n",
        }],
        fileChanges: ["prompt.md"],
      },
    }, "skill.improve")).toMatchObject({
      value: {
        files: [{
          path: "prompt.md",
          kind: "text",
          encoding: "utf8",
          executable: false,
        }],
        fileChanges: ["prompt.md"],
      },
    });
  });

  test("posts runtime-control requests with the bounded node client", async () => {
    const server = http.createServer((request, response) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/v1/operation-sequence");
      expect(request.headers.authorization).toBe("Bearer runtime-token");
      request.resume();
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          ok: true,
          files: [],
          fileChanges: [],
          operationResults: [],
        }));
      }, 20);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected runtime-control test server port.");
      }
      const result = await runWorkbenchRuntimeOperationSequence({
        operations: [{
          operation: "skill.run",
          invocation: { use: "command" },
        }],
      }, {
        url: `http://127.0.0.1:${address.port}`,
        token: "runtime-token",
        timeoutMs: 1_000,
      });
      expect(result).toMatchObject({ ok: true, files: [] });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  test("times out runtime-control requests with no response", async () => {
    const server = http.createServer((request) => {
      request.resume();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected runtime-control test server port.");
      }
      await expect(runWorkbenchRuntimeOperationSequence({
        operations: [{
          operation: "skill.run",
          invocation: { use: "command" },
        }],
      }, {
        url: `http://127.0.0.1:${address.port}`,
        token: "runtime-token",
        timeoutMs: 20,
      })).rejects.toThrow("Workbench runtime-control request timed out after 20ms.");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  test("uses runtime-control timeout from the environment", async () => {
    const previous = process.env[WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS_ENV];
    process.env[WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS_ENV] = "20";
    const server = http.createServer((request) => {
      request.resume();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected runtime-control test server port.");
      }
      await expect(runWorkbenchRuntimeOperationSequence({
        operations: [{
          operation: "skill.run",
          invocation: { use: "command" },
        }],
      }, {
        url: `http://127.0.0.1:${address.port}`,
        token: "runtime-token",
      })).rejects.toThrow("Workbench runtime-control request timed out after 20ms.");
    } finally {
      if (previous === undefined) {
        delete process.env[WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS_ENV];
      } else {
        process.env[WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS_ENV] = previous;
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  test("rejects runtime-control requests without a url and token", async () => {
    await expect(runWorkbenchRuntimeOperationSequence({
      operations: [{
        operation: "skill.run",
        invocation: { use: "command" },
      }],
    }, { url: "", token: "" })).rejects.toThrow("runtime-control is unavailable");
  });

  test("rejects adapter operation results that explicitly report failure", () => {
    expect(() => assertWorkbenchAdapterOperationResultOk({
      protocol: "workbench.adapter-result.v1",
      operation: "grade.run",
      ok: false,
      summary: "engine rejected the workspace",
    }, "Adapter grade.run")).toThrow("Adapter grade.run returned ok false: engine rejected the workspace");
  });

  test("collects required operations through adapter slots", () => {
    const orchestrator = parseWorkbenchAdapterManifest([
      "id: orchestrator",
      `protocol: ${WORKBENCH_ADAPTER_MANIFEST_PROTOCOL}`,
      "operations:",
      "  grade.run: {}",
      "slots:",
      "  judge:",
      "    path: /judge",
      "    operation: skill.run",
      "",
    ].join("\n"));
    const engineOnly = parseWorkbenchAdapterManifest([
      "id: engine-only",
      `protocol: ${WORKBENCH_ADAPTER_MANIFEST_PROTOCOL}`,
      "operations:",
      "  grade.run: {}",
      "",
    ].join("\n"));
    const roots = [{
      invocation: {
        use: "orchestrator",
        with: {
          judge: { use: "engine-only" },
        },
      },
      operation: "grade.run" as const,
    }];

    expect(() => assertWorkbenchAdapterOperationSupport(roots, [orchestrator, engineOnly]))
      .toThrow("Adapter engine-only does not implement skill.run.");
    expect(() => assertWorkbenchAdapterOperationSupport(roots, [orchestrator]))
      .toThrow("Adapter engine-only is referenced but is not installed.");
    expect(() => assertWorkbenchAdapterOperationSupport([{
      invocation: { use: "engine-only" },
      operation: "grade.run" as const,
    }], [orchestrator, engineOnly])).not.toThrow();
  });

  test("normalizes engine cases and rejects unsupported case fields", () => {
    expect(normalizeWorkbenchEngineCase({
      id: "example",
      case: {
        version: 3,
        prompt: "Write ok.",
        environment: {
          dockerfile: "cases/example/environment/Dockerfile",
          workdir: "/app",
          network: {
            egress: "none",
          },
        },
      },
      files: {
        public: [{
          path: "prompt.txt",
          content: "ok",
        }],
        private: [{
          path: "test.sh",
          content: "echo 1",
          executable: true,
        }],
        source: [{
          path: "case.yaml",
          content: "version: 3\n",
        }],
      },
    }, "engine case")).toMatchObject({
      id: "example",
      case: {
        version: 3,
        prompt: "Write ok.",
        environment: {
          dockerfile: "cases/example/environment/Dockerfile",
          workdir: "/app",
          network: {
            egress: "none",
          },
        },
      },
      files: {
        public: [{
          path: "prompt.txt",
          kind: "text",
          encoding: "utf8",
          executable: false,
        }],
        private: [{
          path: "test.sh",
          executable: true,
        }],
        source: [{
          path: "case.yaml",
          kind: "text",
          encoding: "utf8",
        }],
      },
    });

    expect(() => normalizeWorkbenchEngineCase({
      id: "unexpected",
      case: { version: 3, prompt: "Write ok." },
      files: {},
      unexpected: true,
    }, "engine case")).toThrow("unsupported field");

    expect(() => normalizeWorkbenchEngineCase({
      id: "bad-network",
      case: {
        version: 3,
        prompt: "Write ok.",
        environment: {
          network: {
            egress: "private",
          },
        },
      },
      files: {},
    }, "engine case")).toThrow("egress must be none or open");
  });
});
