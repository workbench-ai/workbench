import type {
  WorkbenchAdapterManifest,
} from "@workbench-ai/workbench-protocol";
import {
  adapterSlot,
  defineAdapter,
  defineEngineResolver,
  defineSubject,
  defineOptimizer,
  defineEngineRunner,
  workbenchAdapterManifestFromDefinition,
} from "@workbench-ai/workbench-protocol";

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

const BUILT_IN_ADAPTER_MANIFESTS: Record<WorkbenchBuiltInAdapterId, WorkbenchAdapterManifest> = Object.fromEntries(
  Object.entries({
    workbench: defineAdapter({
      id: "workbench",
      engineResolve: defineEngineResolver(),
      engineRun: defineEngineRunner({ executor: "host" }),
      slots: {
        score: adapterSlot("/score", "engine.run"),
      },
    }),
    codex: defineAdapter({
      id: "codex",
      subject: defineSubject(),
      improve: defineOptimizer(),
      setup: [
        "npm install --global @openai/codex@0.125.0",
      ],
      auth: {
        methods: {
          oauth: { files: [{ path: ".codex/auth.json" }] },
          "api-key": { env: [{ name: "OPENAI_API_KEY" }] },
        },
      },
    }),
    claude: defineAdapter({
      id: "claude",
      subject: defineSubject(),
      improve: defineOptimizer(),
      setup: [
        "npm install --global @anthropic-ai/claude-code@2.1.119",
      ],
      auth: {
        methods: {
          oauth: {
            files: [
              { path: ".claude.json" },
              { path: ".claude/oauth-token", required: false },
              { path: ".claude/.credentials.json", required: false },
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
    }),
    command: defineAdapter({
      id: "command",
      subject: defineSubject(),
      engineRun: defineEngineRunner(),
      improve: defineOptimizer(),
    }),
    rubric: defineAdapter({
      id: "rubric",
      engineRun: defineEngineRunner(),
      slots: {
        judge: adapterSlot("/judge", "subject.run"),
      },
    }),
    tests: defineAdapter({
      id: "tests",
      engineRun: defineEngineRunner(),
    }),
  }).map(([id, definition]) => [id, workbenchAdapterManifestFromDefinition(definition)])
) as Record<WorkbenchBuiltInAdapterId, WorkbenchAdapterManifest>;

export function builtinWorkbenchAdapterManifest(id: string): WorkbenchAdapterManifest | null {
  return isWorkbenchBuiltInAdapterId(id)
    ? cloneManifest(BUILT_IN_ADAPTER_MANIFESTS[id])
    : null;
}

export function builtinWorkbenchAdapterManifests(): WorkbenchAdapterManifest[] {
  return Object.keys(BUILT_IN_ADAPTER_MANIFESTS)
    .sort()
    .map((id) => cloneManifest(BUILT_IN_ADAPTER_MANIFESTS[id as WorkbenchBuiltInAdapterId]));
}

export function isWorkbenchBuiltInAdapterId(id: string): id is WorkbenchBuiltInAdapterId {
  return Object.prototype.hasOwnProperty.call(BUILT_IN_ADAPTER_MANIFESTS, id);
}

export function adapterCommandName(adapterId: string): string {
  return `workbench-adapter-${adapterId}`;
}

function cloneManifest(manifest: WorkbenchAdapterManifest): WorkbenchAdapterManifest {
  return {
    ...manifest,
    operations: JSON.parse(JSON.stringify(manifest.operations)) as WorkbenchAdapterManifest["operations"],
    setup: [...manifest.setup],
    ...(manifest.auth ? { auth: JSON.parse(JSON.stringify(manifest.auth)) as WorkbenchAdapterManifest["auth"] } : {}),
    ...(manifest.slots ? { slots: JSON.parse(JSON.stringify(manifest.slots)) as WorkbenchAdapterManifest["slots"] } : {}),
  };
}
