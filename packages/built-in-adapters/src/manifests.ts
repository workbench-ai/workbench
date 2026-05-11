import type {
  WorkbenchAdapterManifest,
} from "@workbench-ai/workbench-protocol";

export type WorkbenchBuiltInAdapterId = "codex" | "claude" | "pi" | "command" | "rubric" | "tests" | "harbor";

const BUILT_IN_ADAPTER_MANIFESTS: Record<WorkbenchBuiltInAdapterId, WorkbenchAdapterManifest> = {
  codex: {
    id: "codex",
    protocol: "workbench.adapter.v1",
    capabilities: ["runner", "optimizer"],
    setup: [
      builtInAdapterCommandSetup("codex"),
      "npm install --global @openai/codex@0.125.0",
    ],
    command: adapterCommandName("codex"),
    auth: {
      methods: {
        oauth: { files: [{ path: ".codex/auth.json" }] },
        "api-key": { env: [{ name: "OPENAI_API_KEY" }] },
      },
    },
  },
  claude: {
    id: "claude",
    protocol: "workbench.adapter.v1",
    capabilities: ["runner", "optimizer"],
    setup: [
      builtInAdapterCommandSetup("claude"),
      "npm install --global @anthropic-ai/claude-code@2.1.119",
    ],
    command: adapterCommandName("claude"),
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
  },
  pi: {
    id: "pi",
    protocol: "workbench.adapter.v1",
    capabilities: ["runner", "optimizer"],
    setup: [
      builtInAdapterCommandSetup("pi"),
      "npm install --global @mariozechner/pi-coding-agent@0.70.2",
    ],
    command: adapterCommandName("pi"),
  },
  command: {
    id: "command",
    protocol: "workbench.adapter.v1",
    capabilities: ["runner", "scorer", "optimizer"],
    setup: [builtInAdapterCommandSetup("command")],
    command: adapterCommandName("command"),
  },
  rubric: {
    id: "rubric",
    protocol: "workbench.adapter.v1",
    capabilities: ["scorer"],
    setup: [builtInAdapterCommandSetup("rubric")],
    command: adapterCommandName("rubric"),
    refs: ["/judge"],
  },
  tests: {
    id: "tests",
    protocol: "workbench.adapter.v1",
    capabilities: ["scorer"],
    setup: [builtInAdapterCommandSetup("tests")],
    command: adapterCommandName("tests"),
  },
  harbor: {
    id: "harbor",
    protocol: "workbench.adapter.v1",
    capabilities: ["task-source"],
    setup: [],
    command: adapterCommandName("harbor"),
  },
};

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
    ...(manifest.capabilities ? { capabilities: [...manifest.capabilities] } : {}),
    setup: [...manifest.setup],
    ...(manifest.auth ? { auth: JSON.parse(JSON.stringify(manifest.auth)) as WorkbenchAdapterManifest["auth"] } : {}),
    ...(manifest.refs ? { refs: [...manifest.refs] } : {}),
  };
}
