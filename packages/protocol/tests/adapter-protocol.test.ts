import { describe, expect, test } from "vitest";

import {
  WORKBENCH_ADAPTER_MANIFEST_PROTOCOL,
  WORKBENCH_ADAPTER_PROTOCOL,
  adapterCommandName,
  adapterResult,
  parseWorkbenchAdapterManifest,
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

  test("uses install commands in adapter manifests without legacy aliases", () => {
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
      `${["set", "up"].join("")}: []`,
      "operations:",
      "  skill.run:",
      "    command: workbench-adapter-command",
      "",
    ].join("\n"))).toThrow(new RegExp(`unsupported field: ${["set", "up"].join("")}`, "u"));
  });
});
