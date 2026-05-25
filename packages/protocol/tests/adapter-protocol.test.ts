import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  adapterSlot,
  assertWorkbenchAdapterOperationResultOk,
  collectWorkbenchAdapterOperationIssues,
  collectWorkbenchAdapterOperationRequirements,
  collectWorkbenchAdapterAuthRequirements,
  defineAdapter,
  defineEngineResolver,
  defineEngineRunner,
  defineSubject,
  defineOptimizer,
  normalizeWorkbenchAdapterOperationRequest,
  normalizeWorkbenchAdapterOperationResult,
  normalizeWorkbenchEngineResolveResult,
  parseWorkbenchAdapterManifest,
  readWorkbenchAdapterOperationResult,
  runDefinedAdapter,
  runWorkbenchRuntimeOperationSequence,
  workbenchAdapterManifestFromDefinition,
  workbenchAdapterManifestSupportsOperation,
  workbenchAdapterOperationExecutor,
  withDefaultWorkbenchAdapterAuth,
} from "../src/index.ts";

describe("Workbench adapter protocol", () => {
  test("parses manifests and defaults auth through the public protocol package", () => {
    const manifest = parseWorkbenchAdapterManifest([
      "id: codex",
      "protocol: workbench.adapter.v3",
      "operations:",
      "  subject.run: {}",
      "  optimizer.improve: {}",
      "auth:",
      "  methods:",
      "    oauth:",
      "      files:",
      "        - path: .codex/auth.json",
      "",
    ].join("\n"));
    const invocation = withDefaultWorkbenchAdapterAuth({ use: "codex" }, [manifest]);

    expect(manifest.operations["subject.run"]?.command).toBe("workbench-adapter-codex");
    expect(manifest.operations["subject.run"]?.executor).toBe("sandbox");
    expect(workbenchAdapterManifestSupportsOperation(manifest, "optimizer.improve")).toBe(true);
    expect(invocation.auth).toBe("default");
    expect(collectWorkbenchAdapterAuthRequirements([invocation], [manifest])).toEqual([
      { adapterId: "codex", profile: "default" },
    ]);
  });

  test("parses operation executors and defaults to sandbox", () => {
    const manifest = parseWorkbenchAdapterManifest([
      "id: external-engine",
      "protocol: workbench.adapter.v3",
      "operations:",
      "  engine.resolve: {}",
      "  engine.run:",
      "    command: external-engine-adapter",
      "    executor: host",
      "",
    ].join("\n"));

    expect(workbenchAdapterOperationExecutor(manifest, "engine.resolve")).toBe("sandbox");
    expect(workbenchAdapterOperationExecutor(manifest, "engine.run")).toBe("host");
    expect(() => parseWorkbenchAdapterManifest([
      "id: invalid-executor",
      "protocol: workbench.adapter.v3",
      "operations:",
      "  engine.run:",
      "    executor: worker",
      "",
    ].join("\n"))).toThrow("executor must be sandbox or host");
  });

  test("normalizes adapter operation requests", () => {
    expect(normalizeWorkbenchAdapterOperationRequest({
      protocol: "workbench.adapter.v3",
      id: "exec_1",
      operation: "engine.run",
      invocation: {
        use: "command",
      },
      context: {
        subject: {
          prepare: { command: "cp -R input/subject/. ." },
        },
      },
      paths: {
        workspace: "/workspace",
        output: "/workspace/output",
        result: "/workspace/output/workbench-result.json",
        subject: "/workspace/input/subject",
        traces: "/workspace/input/traces",
        enginePrivate: "/workspace/private/engine",
      },
    })).toMatchObject({
      id: "exec_1",
      operation: "engine.run",
      invocation: {
        use: "command",
        with: {},
      },
      context: {
        subject: {
          prepare: { command: "cp -R input/subject/. ." },
        },
      },
      paths: {
        workspace: "/workspace",
        output: "/workspace/output",
        result: "/workspace/output/workbench-result.json",
        subject: "/workspace/input/subject",
        traces: "/workspace/input/traces",
        enginePrivate: "/workspace/private/engine",
      },
    });
  });

  test("rejects unsupported broad adapter path fields", () => {
    expect(() => normalizeWorkbenchAdapterOperationRequest({
      protocol: "workbench.adapter.v3",
      id: "exec_invalid_paths",
      operation: "engine.run",
      invocation: {
        use: "command",
      },
      paths: {
        workspace: "/workspace",
        output: "/workspace/output",
        result: "/workspace/output/workbench-result.json",
        subject: "/workspace/input/subject",
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
      subject: defineSubject(),
      engineRun: defineEngineRunner(),
      improve: defineOptimizer(),
    }));

    expect(manifest).toMatchObject({
      protocol: "workbench.adapter.v3",
      operations: {
        "engine.resolve": { command: "workbench-adapter-adapter" },
        "subject.run": { command: "workbench-adapter-adapter" },
        "engine.run": { command: "workbench-adapter-adapter" },
        "optimizer.improve": { command: "workbench-adapter-adapter" },
      },
    });
  });

  test("rejects invalid protocol strings and unknown operation names", () => {
    expect(() => parseWorkbenchAdapterManifest([
      "id: invalid-protocol",
      "protocol: workbench.adapter.invalid",
      "operations:",
      "  subject.run: {}",
      "",
    ].join("\n"))).toThrow("workbench.adapter.v3");
    expect(() => parseWorkbenchAdapterManifest([
      "id: invalid-operation",
      "protocol: workbench.adapter.v3",
      "operations:",
      "  unknown.run: {}",
      "",
    ].join("\n"))).toThrow("must be engine.resolve");
    expect(() => normalizeWorkbenchAdapterOperationRequest({
      protocol: "workbench.adapter.invalid",
      id: "exec_invalid_protocol",
      operation: "subject.run",
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
      operation: "engine.run",
      value: {
        score: 0.75,
        metrics: { accuracy: 0.75 },
      },
    }, "engine.run")).toMatchObject({
      protocol: "workbench.adapter-result.v1",
      operation: "engine.run",
      value: {
        score: 0.75,
        metrics: { accuracy: 0.75 },
      },
    });
  });

  test("posts runtime-control requests with the default no-timeout node client", async () => {
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
          operation: "subject.run",
          invocation: { use: "command" },
        }],
      }, {
        url: `http://127.0.0.1:${address.port}`,
        token: "runtime-token",
      });
      expect(result).toMatchObject({ ok: true, files: [] });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  test("rejects adapter operation results that explicitly report failure", () => {
    expect(() => assertWorkbenchAdapterOperationResultOk({
      protocol: "workbench.adapter-result.v1",
      operation: "engine.run",
      ok: false,
      summary: "engine rejected the workspace",
    }, "Adapter engine.run")).toThrow("Adapter engine.run returned ok false: engine rejected the workspace");
  });

  test("collects required operations through adapter slots", () => {
    const orchestrator = parseWorkbenchAdapterManifest([
      "id: orchestrator",
      "protocol: workbench.adapter.v3",
      "setup: []",
      "operations:",
      "  engine.run: {}",
      "slots:",
      "  judge:",
      "    path: /judge",
      "    operation: subject.run",
      "",
    ].join("\n"));
    const engineOnly = parseWorkbenchAdapterManifest([
      "id: engine-only",
      "protocol: workbench.adapter.v3",
      "setup: []",
      "operations:",
      "  engine.run: {}",
      "",
    ].join("\n"));
    const roots = [{
      invocation: {
        use: "orchestrator",
        with: {
          judge: { use: "engine-only" },
        },
      },
      operation: "engine.run" as const,
    }];

    expect(collectWorkbenchAdapterOperationRequirements(roots, [orchestrator, engineOnly]))
      .toMatchObject([
        { invocation: { use: "orchestrator" }, operation: "engine.run" },
        { invocation: { use: "engine-only" }, operation: "subject.run" },
      ]);
    expect(collectWorkbenchAdapterOperationIssues(roots, [orchestrator, engineOnly]))
      .toEqual(["Adapter engine-only does not implement subject.run."]);
  });

  test("normalizes engine-resolve results", () => {
    expect(normalizeWorkbenchEngineResolveResult({
      environment: {
        dockerfile: "tasks/example/environment/Dockerfile",
        workdir: "/app",
        network: {
          egress: "none",
        },
      },
      cases: [{
        id: "example",
        case: {
          version: 3,
          prompt: "Write ok.",
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
            path: "task.yaml",
            content: "version: 3\n",
          }],
        },
      }],
    })).toMatchObject({
      environment: {
        dockerfile: "tasks/example/environment/Dockerfile",
        workdir: "/app",
        network: {
          egress: "none",
        },
      },
      cases: [{
        id: "example",
        case: {
          version: 3,
          prompt: "Write ok.",
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
            path: "task.yaml",
            kind: "text",
            encoding: "utf8",
          }],
        },
      }],
    });

    expect(() => normalizeWorkbenchEngineResolveResult({
      cases: [{
        id: "unexpected",
        case: { version: 3, prompt: "Write ok." },
        files: {},
        unexpected: true,
      }],
    })).toThrow("unsupported fields: unexpected");

    expect(() => normalizeWorkbenchEngineResolveResult({
      environment: {
        network: {
          egress: "allowlist",
        },
      },
      cases: [],
    })).toThrow("environment.network.egress must be none or open");

    expect(() => normalizeWorkbenchEngineResolveResult({
      environment: {
        network: {
          egress: "open",
          allow: ["api.example.com"],
        },
      },
      cases: [],
    })).toThrow("environment.network includes unsupported fields: allow");
  });

  test("runs defined adapter handlers and writes operation results", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-adapter-handler-"));
    const outputRoot = path.join(root, "output");
    await fs.mkdir(outputRoot, { recursive: true });
    const requestPath = path.join(root, "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_handler",
      operation: "engine.run",
      invocation: {
        use: "handler-engine",
        with: {
          label: "handled",
          judge: {
            use: "codex",
            with: { model: "gpt-5.4-mini" },
          },
        },
      },
      paths: {
        workspace: root,
        output: outputRoot,
        result: path.join(outputRoot, "workbench-result.json"),
        subject: path.join(root, "input", "subject"),
        traces: path.join(root, "input", "traces"),
      },
    }, null, 2)}\n`);
    const adapter = defineAdapter({
      id: "handler-engine",
      slots: {
        judge: adapterSlot("/judge", "subject.run"),
      },
      engineRun: defineEngineRunner({
        handle(ctx) {
          expect(ctx.with.label).toBe("handled");
          expect(ctx.slot("judge")).toMatchObject({
            use: "codex",
            with: { model: "gpt-5.4-mini" },
          });
          return ctx.result({
            score: 1,
            summary: "handler wrote result",
          }, {
            summary: "handler completed",
            feedback: { slot: ctx.slot("judge")?.use ?? null },
          });
        },
      }),
    });

    await runDefinedAdapter(adapter, { requestPath });

    const result = await readWorkbenchAdapterOperationResult(outputRoot, "engine.run");
    expect(result).toMatchObject({
      protocol: "workbench.adapter-result.v1",
      operation: "engine.run",
      ok: true,
      summary: "handler completed",
      feedback: { slot: "codex" },
      value: {
        score: 1,
        summary: "handler wrote result",
      },
    });
  });
});
