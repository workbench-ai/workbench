import type {
  WorkbenchAdapterManifest,
} from "@workbench-ai/workbench-protocol";

export type WorkbenchBuiltInAdapterId = "codex" | "claude" | "pi" | "command" | "rubric";

const BUILT_IN_ADAPTER_MANIFESTS: Record<WorkbenchBuiltInAdapterId, WorkbenchAdapterManifest> = {
  codex: {
    id: "codex",
    protocol: "workbench.adapter.v1",
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
    setup: [
      builtInAdapterCommandSetup("pi"),
      "npm install --global @mariozechner/pi-coding-agent@0.70.2",
    ],
    command: adapterCommandName("pi"),
  },
  command: {
    id: "command",
    protocol: "workbench.adapter.v1",
    setup: [builtInAdapterCommandSetup("command")],
    command: adapterCommandName("command"),
  },
  rubric: {
    id: "rubric",
    protocol: "workbench.adapter.v1",
    setup: [builtInAdapterCommandSetup("rubric")],
    command: adapterCommandName("rubric"),
    refs: ["/judge"],
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
  const packageRunner = `/app/node_modules/@workbench-ai/workbench-built-in-adapters/dist/bin/${adapterId}.js`;
  const globalRunner = `/usr/local/lib/node_modules/@workbench-ai/workbench-built-in-adapters/dist/bin/${adapterId}.js`;
  const monorepoRunner = `/app/products/workbench/packages/built-in-adapters/src/bin/${adapterId}.ts`;
  return [
    `printf '%s\\n'`,
    "'#!/bin/sh'",
    `'if [ -f ${packageRunner} ]; then exec node ${packageRunner} "$@"; fi'`,
    `'if [ -f ${globalRunner} ]; then exec node ${globalRunner} "$@"; fi'`,
    `'if [ -f ${monorepoRunner} ]; then exec node --experimental-strip-types ${monorepoRunner} "$@"; fi'`,
    `'echo "Workbench built-in adapter ${adapterId} is unavailable." >&2'`,
    "'exit 127'",
    `> /usr/local/bin/${command}`,
    `&& chmod 755 /usr/local/bin/${command}`,
  ].join(" ");
}

function cloneManifest(manifest: WorkbenchAdapterManifest): WorkbenchAdapterManifest {
  return {
    ...manifest,
    setup: [...manifest.setup],
    ...(manifest.auth ? { auth: JSON.parse(JSON.stringify(manifest.auth)) as WorkbenchAdapterManifest["auth"] } : {}),
    ...(manifest.refs ? { refs: [...manifest.refs] } : {}),
  };
}
