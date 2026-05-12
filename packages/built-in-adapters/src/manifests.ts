import type {
  WorkbenchAdapterManifest,
} from "@workbench-ai/workbench-protocol";
import {
  adapterSlot,
  defineAdapter,
  defineOptimizer,
  defineRunner,
  defineScorer,
  defineTaskSource,
  workbenchAdapterManifestFromDefinition,
} from "@workbench-ai/workbench-protocol";

export type WorkbenchBuiltInAdapterId =
  | "codex"
  | "claude"
  | "pi"
  | "command"
  | "rubric"
  | "tests"
  | "path"
  | "harbor";

const BUILT_IN_ADAPTER_MANIFESTS: Record<WorkbenchBuiltInAdapterId, WorkbenchAdapterManifest> = Object.fromEntries(
  Object.entries({
    codex: defineAdapter({
      id: "codex",
      run: defineRunner(),
      improve: defineOptimizer(),
      setup: [
        builtInAdapterCommandSetup("codex"),
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
      run: defineRunner(),
      improve: defineOptimizer(),
      setup: [
        builtInAdapterCommandSetup("claude"),
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
    pi: defineAdapter({
      id: "pi",
      run: defineRunner(),
      improve: defineOptimizer(),
      setup: [
        builtInAdapterCommandSetup("pi"),
        "npm install --global @mariozechner/pi-coding-agent@0.70.2",
      ],
    }),
    command: defineAdapter({
      id: "command",
      run: defineRunner(),
      score: defineScorer(),
      improve: defineOptimizer(),
      setup: [builtInAdapterCommandSetup("command")],
    }),
    rubric: defineAdapter({
      id: "rubric",
      score: defineScorer(),
      setup: [builtInAdapterCommandSetup("rubric")],
      slots: {
        judge: adapterSlot("/judge", "subject.run"),
      },
    }),
    tests: defineAdapter({
      id: "tests",
      score: defineScorer(),
      setup: [builtInAdapterCommandSetup("tests")],
    }),
    path: defineAdapter({
      id: "path",
      tasks: defineTaskSource(),
      setup: [],
    }),
    harbor: defineAdapter({
      id: "harbor",
      tasks: defineTaskSource(),
      setup: [],
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

function builtInAdapterCommandSetup(adapterId: WorkbenchBuiltInAdapterId): string {
  const command = adapterCommandName(adapterId);
  const workbenchRuntimePackageRunner = `/workbench-runtime/node_modules/@workbench-ai/workbench-built-in-adapters/dist/bin/${adapterId}.js`;
  const workbenchRuntimeSourceRunner = `/workbench-runtime/products/workbench/packages/built-in-adapters/src/bin/${adapterId}.ts`;
  const cloudRuntimePackageRunner = `/app/node_modules/@workbench-ai/workbench-built-in-adapters/dist/bin/${adapterId}.js`;
  const cloudRuntimeDistRunner = `/app/products/workbench/packages/built-in-adapters/dist/bin/${adapterId}.js`;
  const cloudRuntimeSourceRunner = `/app/products/workbench/packages/built-in-adapters/src/bin/${adapterId}.ts`;
  const globalRunner = `/usr/local/lib/node_modules/@workbench-ai/workbench-built-in-adapters/dist/bin/${adapterId}.js`;
  return [
    `printf '%s\\n'`,
    "'#!/bin/sh'",
    `'if [ -f ${workbenchRuntimePackageRunner} ]; then exec node ${workbenchRuntimePackageRunner} "$@"; fi'`,
    `'if [ -f ${cloudRuntimePackageRunner} ]; then exec node ${cloudRuntimePackageRunner} "$@"; fi'`,
    `'if [ -f ${cloudRuntimeDistRunner} ]; then exec node ${cloudRuntimeDistRunner} "$@"; fi'`,
    `'if [ -f ${globalRunner} ]; then exec node ${globalRunner} "$@"; fi'`,
    `'if [ -f ${workbenchRuntimeSourceRunner} ]; then exec node --experimental-strip-types ${workbenchRuntimeSourceRunner} "$@"; fi'`,
    `'if [ -f ${cloudRuntimeSourceRunner} ]; then exec node --experimental-strip-types ${cloudRuntimeSourceRunner} "$@"; fi'`,
    `'echo "Workbench built-in adapter ${adapterId} is unavailable." >&2'`,
    "'exit 127'",
    `> /usr/local/bin/${command}`,
    `&& chmod 755 /usr/local/bin/${command}`,
  ].join(" ");
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
