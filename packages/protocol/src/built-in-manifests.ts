import type {
  WorkbenchAdapterManifest,
  WorkbenchAdapterOperationManifest,
} from "./adapter-manifest.ts";
import {
  WORKBENCH_ADAPTER_MANIFEST_PROTOCOL,
  cloneWorkbenchAdapterManifest,
} from "./adapter-manifest.ts";

export type WorkbenchPublicBuiltInAdapterId =
  | "workbench"
  | "codex"
  | "claude"
  | "command";

export type WorkbenchEngineHelperAdapterId =
  | "rubric"
  | "tests";

export type WorkbenchBuiltInAdapterId =
  | WorkbenchPublicBuiltInAdapterId
  | WorkbenchEngineHelperAdapterId;

const sandboxOperation = (command: string): WorkbenchAdapterOperationManifest => ({
  command,
  executor: "sandbox",
});

const BUILT_IN_ADAPTER_MANIFESTS = {
  workbench: {
    id: "workbench",
    protocol: WORKBENCH_ADAPTER_MANIFEST_PROTOCOL,
    install: [],
    operations: {
      "engine.resolve": sandboxOperation("workbench-adapter-workbench"),
    },
  },
  codex: {
    id: "codex",
    protocol: WORKBENCH_ADAPTER_MANIFEST_PROTOCOL,
    operations: {
      "skill.run": sandboxOperation("workbench-adapter-codex"),
      "skill.improve": sandboxOperation("workbench-adapter-codex"),
    },
    install: [
      "npm install --global @openai/codex@0.125.0",
    ],
    auth: {
      methods: {
        oauth: { files: [{ path: ".codex/auth.json" }] },
        "api-key": { env: [{ name: "OPENAI_API_KEY" }] },
      },
    },
  },
  claude: {
    id: "claude",
    protocol: WORKBENCH_ADAPTER_MANIFEST_PROTOCOL,
    operations: {
      "skill.run": sandboxOperation("workbench-adapter-claude"),
      "skill.improve": sandboxOperation("workbench-adapter-claude"),
    },
    install: [
      "npm install --global @anthropic-ai/claude-code@2.1.119",
    ],
    auth: {
      methods: {
        oauth: {
          files: [
            { path: ".claude.json" },
            { path: ".claude/oauth-token" },
          ],
        },
        "api-key": { env: [{ name: "ANTHROPIC_API_KEY" }] },
        bedrock: {
          env: [
            { name: "CLAUDE_CODE_USE_BEDROCK" },
            { name: "AWS_ACCESS_KEY_ID", required: false },
            { name: "AWS_SECRET_ACCESS_KEY", required: false },
            { name: "AWS_SESSION_TOKEN", required: false },
            { name: "AWS_REGION" },
            { name: "AWS_DEFAULT_REGION", required: false },
            { name: "AWS_BEARER_TOKEN_BEDROCK", required: false },
            { name: "ANTHROPIC_MODEL", required: false },
            { name: "ANTHROPIC_SMALL_FAST_MODEL", required: false },
          ],
        },
      },
    },
  },
  command: {
    id: "command",
    protocol: WORKBENCH_ADAPTER_MANIFEST_PROTOCOL,
    install: [],
    operations: {
      "skill.run": sandboxOperation("workbench-adapter-command"),
      "grade.run": sandboxOperation("workbench-adapter-command"),
      "skill.improve": sandboxOperation("workbench-adapter-command"),
    },
  },
  rubric: {
    id: "rubric",
    protocol: WORKBENCH_ADAPTER_MANIFEST_PROTOCOL,
    install: [],
    operations: {
      "grade.run": sandboxOperation("workbench-adapter-rubric"),
    },
    slots: {
      judge: { path: "/judge", operation: "skill.run" },
    },
  },
  tests: {
    id: "tests",
    protocol: WORKBENCH_ADAPTER_MANIFEST_PROTOCOL,
    install: [],
    operations: {
      "grade.run": sandboxOperation("workbench-adapter-tests"),
    },
  },
} as const satisfies Record<WorkbenchBuiltInAdapterId, WorkbenchAdapterManifest>;

export function builtinWorkbenchAdapterManifest(id: string): WorkbenchAdapterManifest | null {
  return isWorkbenchBuiltInAdapterId(id)
    ? cloneWorkbenchAdapterManifest(BUILT_IN_ADAPTER_MANIFESTS[id])
    : null;
}

export function builtinWorkbenchAdapterManifests(): WorkbenchAdapterManifest[] {
  return Object.keys(BUILT_IN_ADAPTER_MANIFESTS)
    .sort()
    .map((id) => cloneWorkbenchAdapterManifest(BUILT_IN_ADAPTER_MANIFESTS[id as WorkbenchBuiltInAdapterId]));
}

export function isWorkbenchBuiltInAdapterId(id: string): id is WorkbenchBuiltInAdapterId {
  return Object.prototype.hasOwnProperty.call(BUILT_IN_ADAPTER_MANIFESTS, id);
}
