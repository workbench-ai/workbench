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
  defineScorer,
  normalizeWorkbenchAdapterOperationRequest,
  normalizeWorkbenchAdapterOperationResult,
  normalizeWorkbenchTaskSourceResult,
  parseWorkbenchAdapterManifest,
  readWorkbenchAdapterOperationResult,
  runDefinedAdapter,
  workbenchAdapterManifestSupportsOperation,
  withDefaultWorkbenchAdapterAuth,
} from "../src/index.ts";

describe("Workbench adapter protocol", () => {
  test("parses manifests and defaults auth through the public protocol package", () => {
    const manifest = parseWorkbenchAdapterManifest([
      "id: codex",
      "protocol: workbench.adapter.v2",
      "operations:",
      "  subject.run: {}",
      "  subject.improve: {}",
      "auth:",
      "  methods:",
      "    oauth:",
      "      files:",
      "        - path: .codex/auth.json",
      "",
    ].join("\n"));
    const invocation = withDefaultWorkbenchAdapterAuth({ use: "codex" }, [manifest]);

    expect(manifest.operations["subject.run"]?.command).toBe("workbench-adapter-codex");
    expect(workbenchAdapterManifestSupportsOperation(manifest, "subject.improve")).toBe(true);
    expect(invocation.auth).toBe("default");
    expect(collectWorkbenchAdapterAuthRequirements([invocation], [manifest])).toEqual([
      { adapterId: "codex", profile: "default" },
    ]);
  });

  test("normalizes adapter operation requests", () => {
    expect(normalizeWorkbenchAdapterOperationRequest({
      protocol: "workbench.adapter.v2",
      id: "exec_1",
      operation: "trial.score",
      invocation: {
        use: "command",
      },
      paths: {
        workspace: "/workspace",
        output: "/workspace/output",
        result: "/workspace/output/workbench-result.json",
      },
    })).toMatchObject({
      id: "exec_1",
      operation: "trial.score",
      invocation: {
        use: "command",
        with: {},
      },
      paths: {
        workspace: "/workspace",
        output: "/workspace/output",
        result: "/workspace/output/workbench-result.json",
      },
    });
  });

  test("normalizes adapter operation results", () => {
    expect(normalizeWorkbenchAdapterOperationResult({
      protocol: "workbench.adapter-result.v1",
      operation: "trial.score",
      value: {
        score: 0.75,
        metrics: { accuracy: 0.75 },
      },
    }, "trial.score")).toMatchObject({
      protocol: "workbench.adapter-result.v1",
      operation: "trial.score",
      value: {
        score: 0.75,
        metrics: { accuracy: 0.75 },
      },
    });
  });

  test("rejects adapter operation results that explicitly report failure", () => {
    expect(() => assertWorkbenchAdapterOperationResultOk({
      protocol: "workbench.adapter-result.v1",
      operation: "trial.score",
      ok: false,
      summary: "scorer rejected the workspace",
    }, "Adapter trial.score")).toThrow("Adapter trial.score returned ok false: scorer rejected the workspace");
  });

  test("collects required operations through adapter slots", () => {
    const orchestrator = parseWorkbenchAdapterManifest([
      "id: orchestrator",
      "protocol: workbench.adapter.v2",
      "setup: []",
      "operations:",
      "  trial.score: {}",
      "slots:",
      "  judge:",
      "    path: /judge",
      "    operation: subject.run",
      "",
    ].join("\n"));
    const scorerOnly = parseWorkbenchAdapterManifest([
      "id: scorer-only",
      "protocol: workbench.adapter.v2",
      "setup: []",
      "operations:",
      "  trial.score: {}",
      "",
    ].join("\n"));
    const roots = [{
      invocation: {
        use: "orchestrator",
        with: {
          judge: { use: "scorer-only" },
        },
      },
      operation: "trial.score" as const,
    }];

    expect(collectWorkbenchAdapterOperationRequirements(roots, [orchestrator, scorerOnly]))
      .toMatchObject([
        { invocation: { use: "orchestrator" }, operation: "trial.score" },
        { invocation: { use: "scorer-only" }, operation: "subject.run" },
      ]);
    expect(collectWorkbenchAdapterOperationIssues(roots, [orchestrator, scorerOnly]))
      .toEqual(["Adapter scorer-only does not implement subject.run."]);
  });

  test("normalizes task-source results", () => {
    expect(normalizeWorkbenchTaskSourceResult({
      environment: {
        dockerfile: "harbor/example/environment/Dockerfile",
        workdir: "/app",
      },
      tasks: [{
        id: "example",
        task: {
          version: 2,
          task: "Write ok.",
        },
        publicFiles: [{
          path: "prompt.txt",
          content: "ok",
        }],
        testFiles: [{
          path: "test.sh",
          content: "echo 1",
          executable: true,
        }],
      }],
    })).toMatchObject({
      environment: {
        dockerfile: "harbor/example/environment/Dockerfile",
        workdir: "/app",
      },
      tasks: [{
        id: "example",
        task: {
          version: 2,
          task: "Write ok.",
        },
        publicFiles: [{
          path: "prompt.txt",
          kind: "text",
          encoding: "utf8",
          executable: false,
        }],
        testFiles: [{
          path: "test.sh",
          executable: true,
        }],
      }],
    });
  });

  test("runs defined adapter handlers and writes operation results", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-adapter-handler-"));
    const outputRoot = path.join(root, "output");
    await fs.mkdir(outputRoot, { recursive: true });
    const requestPath = path.join(root, "request.json");
    await fs.writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v2",
      id: "exec_handler",
      operation: "trial.score",
      invocation: {
        use: "handler-scorer",
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
      },
    }, null, 2)}\n`);
    const adapter = defineAdapter({
      id: "handler-scorer",
      slots: {
        judge: adapterSlot("/judge", "subject.run"),
      },
      score: defineScorer({
        handle(ctx) {
          expect(ctx.with.label).toBe("handled");
          expect(ctx.slot("judge")).toMatchObject({
            use: "codex",
            with: { model: "gpt-5.4-mini" },
          });
          return ctx.result({
            score: 1,
            summary: "handler wrote scorecard",
          }, {
            summary: "handler completed",
            feedback: { slot: ctx.slot("judge")?.use ?? null },
          });
        },
      }),
    });

    await runDefinedAdapter(adapter, { requestPath });

    const result = await readWorkbenchAdapterOperationResult(outputRoot, "trial.score");
    expect(result).toMatchObject({
      protocol: "workbench.adapter-result.v1",
      operation: "trial.score",
      ok: true,
      summary: "handler completed",
      feedback: { slot: "codex" },
      value: {
        score: 1,
        summary: "handler wrote scorecard",
      },
    });
  });
});
