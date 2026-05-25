export const codexWorkbenchProviderAuth = {
  apiKey: {
    envName: "OPENAI_API_KEY",
  },
  profile: {
    required: [".codex/auth.json"],
    optional: [],
  },
  harnessDefaults: {
    config: {
      sandbox_mode: "danger-full-access",
    },
  },
  toHarnessAuth(auth: { kind: "profile" | "api_key" | "bedrock"; root?: string }) {
    if (auth.kind === "api_key") {
      return {
        strategy: "secret_ref",
        ref: "OPENAI_API_KEY",
      };
    }
    if (auth.kind === "bedrock") {
      return null;
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
  ],
} as const;
