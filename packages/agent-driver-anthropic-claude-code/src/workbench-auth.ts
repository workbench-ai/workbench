import { spawn } from "node:child_process";

export const CLAUDE_CODE_OAUTH_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";

export interface ClaudeWorkbenchProviderAuthEnvVar {
  name: string;
  value: string;
}

export interface ClaudeWorkbenchBedrockEnvCollection {
  entries: ClaudeWorkbenchProviderAuthEnvVar[];
  missing: string[];
}

export interface ClaudeWorkbenchBedrockConnectEnvOptions {
  env?: Record<string, string | undefined>;
  flags?: Record<string, string | undefined>;
  runCommand?: (
    command: string,
    args: readonly string[],
    env: Record<string, string | undefined>,
  ) => Promise<string>;
}

export const claudeWorkbenchProviderAuth = {
  apiKey: {
    envName: "ANTHROPIC_API_KEY",
  },
  profile: {
    required: [".claude.json"],
    optional: [".claude/oauth-token", ".claude/.credentials.json"],
    alternatives: [[".claude/oauth-token", ".claude/.credentials.json"]],
  },
  oauthToken: {
    envName: CLAUDE_CODE_OAUTH_TOKEN_ENV,
    relativePath: ".claude/oauth-token",
    parse: parseClaudeSetupTokenOutput,
    setup: {
      command: "claude",
      args: ["setup-token"],
      prompt:
        "Claude Code needs a portable OAuth token for Workbench sandboxes. Starting `claude setup-token`.",
      envDenylist: [CLAUDE_CODE_OAUTH_TOKEN_ENV],
    },
  },
  envAuth: {
    bedrock: {
      envAllowlist: [
        "CLAUDE_CODE_USE_BEDROCK",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "AWS_REGION",
        "AWS_DEFAULT_REGION",
        "AWS_BEARER_TOKEN_BEDROCK",
        "ANTHROPIC_MODEL",
        "ANTHROPIC_SMALL_FAST_MODEL",
      ],
      collect: collectClaudeWorkbenchBedrockEnv,
      collectFromConnectEnvironment: collectClaudeWorkbenchBedrockConnectEnv,
    },
  },
  harnessDefaults: {
    config: {
      max_turns: 64,
      permission_mode: "bypassPermissions",
    },
  },
  toHarnessAuth(auth: {
    kind: "profile" | "api_key" | "bedrock";
    root?: string;
  }) {
    if (auth.kind === "api_key") {
      return {
        strategy: "secret_ref",
        ref: "ANTHROPIC_API_KEY",
      };
    }
    if (auth.kind === "bedrock") {
      return {
        strategy: "bedrock_env",
      };
    }
    if (!auth.root) {
      return null;
    }
    return {
      strategy: "profile_path",
      path: auth.root,
    };
  },
  staleErrorPatterns: [
    /not logged in/iu,
    /login required/iu,
    /authentication required/iu,
    /failed to authenticate/iu,
    /authentication_error/iu,
    /api error:\s*401/iu,
    /invalid.*session/iu,
    /invalid bearer token/iu,
    /session.*expired/iu,
    /oauth.*expired/iu,
    /unauthorized/iu,
    /claude_code_oauth_token/iu,
  ],
} as const;

export function collectClaudeWorkbenchBedrockEnv(
  env: Record<string, string | undefined>,
): ClaudeWorkbenchBedrockEnvCollection {
  const usesBearerToken = Boolean(env.AWS_BEARER_TOKEN_BEDROCK?.trim());
  const required = usesBearerToken
    ? []
    : (["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] as const);
  const missing: string[] = required.filter((name) => !env[name]?.trim());
  const region = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim();
  if (!region) {
    missing.push("AWS_REGION");
  }
  const entries: ClaudeWorkbenchProviderAuthEnvVar[] = [
    {
      name: "CLAUDE_CODE_USE_BEDROCK",
      value: "1",
    },
  ];
  for (const name of claudeWorkbenchProviderAuth.envAuth.bedrock.envAllowlist) {
    if (name === "CLAUDE_CODE_USE_BEDROCK") {
      continue;
    }
    const value = env[name]?.trim();
    if (value) {
      entries.push({ name, value });
    }
  }
  if (!entries.some((entry) => entry.name === "AWS_REGION") && region) {
    entries.push({ name: "AWS_REGION", value: region });
  }
  return { entries, missing };
}

export async function collectClaudeWorkbenchBedrockConnectEnv({
  env = process.env,
  flags = {},
  runCommand = runCommandCapture,
}: ClaudeWorkbenchBedrockConnectEnvOptions = {}): Promise<
  Record<string, string | undefined>
> {
  const profile = flags["aws-profile"] ?? env.AWS_PROFILE;
  const region =
    flags["aws-region"] ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
  const direct: Record<string, string | undefined> = {
    CLAUDE_CODE_USE_BEDROCK: "1",
    AWS_ACCESS_KEY_ID: env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: env.AWS_SECRET_ACCESS_KEY,
    AWS_SESSION_TOKEN: env.AWS_SESSION_TOKEN,
    AWS_REGION: region,
    AWS_DEFAULT_REGION: env.AWS_DEFAULT_REGION,
    AWS_BEARER_TOKEN_BEDROCK: env.AWS_BEARER_TOKEN_BEDROCK,
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
    ANTHROPIC_SMALL_FAST_MODEL: env.ANTHROPIC_SMALL_FAST_MODEL,
  };
  if (
    direct.AWS_BEARER_TOKEN_BEDROCK ||
    (direct.AWS_ACCESS_KEY_ID && direct.AWS_SECRET_ACCESS_KEY)
  ) {
    return direct;
  }
  if (!profile) {
    return direct;
  }
  const profileRegion = region
    ? undefined
    : await exportAwsProfileRegion(profile, env, runCommand);
  return {
    ...direct,
    ...(await exportAwsProfileCredentials(profile, env, runCommand)),
    AWS_REGION: region ?? profileRegion,
  };
}

async function exportAwsProfileCredentials(
  profile: string,
  env: Record<string, string | undefined>,
  runCommand: NonNullable<
    ClaudeWorkbenchBedrockConnectEnvOptions["runCommand"]
  >,
): Promise<Record<string, string>> {
  const output = await runCommand(
    "aws",
    [
      "configure",
      "export-credentials",
      "--format",
      "env-no-export",
      "--profile",
      profile,
    ],
    env,
  );
  const exported: Record<string, string> = {};
  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (match) {
      exported[match[1]!] = match[2]!;
    }
  }
  return exported;
}

async function exportAwsProfileRegion(
  profile: string,
  env: Record<string, string | undefined>,
  runCommand: NonNullable<
    ClaudeWorkbenchBedrockConnectEnvOptions["runCommand"]
  >,
): Promise<string | undefined> {
  const output = await runCommand(
    "aws",
    ["configure", "get", "region", "--profile", profile],
    env,
  ).catch(() => "");
  const region = output.trim();
  return region.length > 0 ? region : undefined;
}

async function runCommandCapture(
  command: string,
  args: readonly string[],
  env: Record<string, string | undefined>,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${
            code ?? "null"
          } signal ${signal ?? "null"}${
            stderr.trim() ? `: ${stderr.trim()}` : ""
          }.`,
        ),
      );
    });
  });
}

export function parseClaudeSetupTokenOutput(output: string): string | null {
  const lines = output
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\r/gu, "")
    .split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    const firstSegment = line?.match(/sk-ant-oat\d{2}-[A-Za-z0-9_-]*/iu)?.[0];
    if (!firstSegment) {
      continue;
    }
    const segments = [firstSegment];
    for (
      let continuationIndex = index + 1;
      continuationIndex < lines.length;
      continuationIndex += 1
    ) {
      const continuation = lines[continuationIndex]?.trim();
      if (!continuation || !/^[A-Za-z0-9_-]+$/u.test(continuation)) {
        break;
      }
      segments.push(continuation);
    }
    return segments.join("");
  }
  return null;
}
