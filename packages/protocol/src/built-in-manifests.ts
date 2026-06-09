import type {
  WorkbenchAdapterManifest,
} from "./adapter-manifest.ts";
import {
  cloneWorkbenchAdapterManifest,
} from "./adapter-manifest.ts";
import {
  adapterSlot,
  defineAdapter,
  defineSkillRunner,
  defineEngineResolver,
  defineEngineRunner,
  defineImprover,
  workbenchAdapterManifestFromDefinition,
} from "./adapter-definition.ts";

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
      skillRun: defineSkillRunner(),
      improve: defineImprover(),
      install: [
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
      skillRun: defineSkillRunner(),
      improve: defineImprover(),
      install: [
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
      skillRun: defineSkillRunner(),
      engineRun: defineEngineRunner(),
      improve: defineImprover(),
    }),
    rubric: defineAdapter({
      id: "rubric",
      engineRun: defineEngineRunner(),
      slots: {
        judge: adapterSlot("/judge", "skill.run"),
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
