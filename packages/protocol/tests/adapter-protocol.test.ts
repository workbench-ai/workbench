import { describe, expect, test } from "vitest";

import {
  collectWorkbenchAdapterAuthRequirements,
  normalizeWorkbenchAdapterCommandRequest,
  parseWorkbenchAdapterManifest,
  withDefaultWorkbenchAdapterAuth,
} from "../src/index.ts";

describe("Workbench adapter protocol", () => {
  test("parses manifests and defaults auth through the public protocol package", () => {
    const manifest = parseWorkbenchAdapterManifest([
      "id: codex",
      "protocol: workbench.adapter.v1",
      "auth:",
      "  methods:",
      "    oauth:",
      "      files:",
      "        - path: .codex/auth.json",
      "",
    ].join("\n"));
    const invocation = withDefaultWorkbenchAdapterAuth({ use: "codex" }, [manifest]);

    expect(manifest.command).toBe("workbench-adapter-codex");
    expect(invocation.auth).toBe("default");
    expect(collectWorkbenchAdapterAuthRequirements([invocation], [manifest])).toEqual([
      { adapterId: "codex", profile: "default" },
    ]);
  });

  test("normalizes adapter command requests", () => {
    expect(normalizeWorkbenchAdapterCommandRequest({
      protocol: "workbench.adapter.v1",
      execution: {
        id: "exec_1",
        purpose: "run-task",
      },
      adapter: {
        use: "command",
      },
      paths: {
        workspace: "/workspace",
        output: "/workspace/output",
      },
    })).toMatchObject({
      execution: {
        id: "exec_1",
        role: "runner",
      },
      adapter: {
        use: "command",
        with: {},
      },
      paths: {
        workspace: "/workspace",
        output: "/workspace/output",
      },
    });
  });
});
