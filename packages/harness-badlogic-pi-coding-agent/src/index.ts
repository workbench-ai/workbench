import {
  defineHarnessProvider,
  type HarnessReadinessCheckArgs,
  type HarnessProvider,
} from "@workbench-ai/flow-harness-sdk";
import { PiCodingAgentHarnessAdapter } from "./adapter.js";
import {
  piCodingAgentHarnessDefinitionBase,
  piCodingAgentHarnessManifest,
} from "./manifest.js";
import {
  PiHarnessAuthSchema,
  PiHarnessConfigSchema,
} from "./schemas.js";

export { PiCodingAgentHarnessAdapter } from "./adapter.js";
export {
  ensurePiAuthReady,
  getPiHarnessAuth,
  resolvePiApiKeyAuth,
  resolvePiProfileAgentDir,
  resolvePiProfileAuth,
  stagePiProfileAuth,
  writePiApiKeyAuth,
} from "./auth.js";
export {
  buildPiInteractiveCommand,
  buildPiRpcCommand,
  normalizePiStringEnv,
  parsePiModel,
  quoteShellArg,
  resolvePiConfiguredEffort,
  resolvePiConfiguredModel,
  type PiResolvedModel,
} from "./cli.js";
export {
  buildPiEnv,
  getPiAgentDir,
  resolvePiSessionFile,
  stagePiHome,
  type StagedPiHome,
} from "./home.js";
export {
  piCodingAgentHarnessManifest,
} from "./manifest.js";
export {
  classifyPiStderr,
  createPiHarnessEvent,
  createPiNormalizationState,
  createPiStderrHarnessEvent,
  normalizePiEvent,
  redactPiEvent,
  resetPiTurnState,
  type PiNormalizationState,
} from "./normalize.js";
export { piTraceReplayer } from "./replay.js";
export type {
  PiAgentEvent,
  PiAssistantMessage,
  PiAssistantMessageEvent,
  PiMessage,
  PiRpcResponse,
  PiRpcState,
  PiToolResultMessage,
  PiUserMessage,
} from "./rpc.js";
export {
  isJsonObject,
  parsePiRpcLine,
} from "./rpc.js";
export {
  PiHarnessAuthSchema,
  PiHarnessConfigSchema,
  PiHarnessEffortSchema,
  piHarnessEffortValues,
  piModelJsonSchemaProperty,
  piEffortJsonSchemaProperty,
  type PiHarnessAuth,
  type PiHarnessConfig,
  type PiHarnessEffort,
} from "./schemas.js";

export const piCodingAgentHarnessProvider = piCodingAgentHarness();

export function createPiCodingAgentHarnessDefinition(options: {
  executable?: string;
} = {}) {
  return {
    ...piCodingAgentHarnessDefinitionBase,
    async checkReadiness(args: HarnessReadinessCheckArgs) {
      await PiCodingAgentHarnessAdapter.ensureAuthReady(
        args.plan,
        args.repoRoot,
        args.flowHome,
      );
      PiCodingAgentHarnessAdapter.validateConfiguredEffort(args.plan);
      return {
        availability_errors: [],
      };
    },
    create() {
      return new PiCodingAgentHarnessAdapter(
        options.executable?.trim() || "pi",
      );
    },
  };
}

export const piCodingAgentHarnessDefinition = createPiCodingAgentHarnessDefinition();

export function piCodingAgentHarness(options: {
  executable?: string;
} = {}): HarnessProvider {
  const definition = createPiCodingAgentHarnessDefinition(options);
  return defineHarnessProvider({
    manifest: piCodingAgentHarnessManifest,
    schemas: {
      auth: definition.auth,
      config: definition.config,
    },
    checkReadiness: definition.checkReadiness,
    create: definition.create,
  });
}
