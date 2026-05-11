import type {
  HarnessExecutionPlan,
  HarnessManifest,
} from "@workbench-ai/flow-harness-sdk";
import { createCliHarnessManifest } from "@workbench-ai/flow-harness-sdk";
import { PiHarnessAuthSchema, PiHarnessConfigSchema } from "./schemas.js";

export const piCodingAgentHarnessDefinitionBase = {
  id: "badlogic/pi-coding-agent",
  displayName: "Pi Coding Agent",
  auth: PiHarnessAuthSchema,
  config: PiHarnessConfigSchema,
  defaults: {
    auth: {
      strategy: "secret_ref" as const,
      ref: "OPENAI_API_KEY",
    },
    model: "openai/gpt-5.4",
    config: {},
  },
  capabilities: {
    supports_resume: true,
    supports_interrupt: true,
    required_runtime_capabilities: ["shell_execution", "dotenv_secrets"],
  },
  supportedWorkspaceModes: ["managed", "project"] as const,
};

export const piCodingAgentHarnessManifest: HarnessManifest =
  createCliHarnessManifest(piCodingAgentHarnessDefinitionBase);

export function getPiHarness(
  plan: HarnessExecutionPlan,
): NonNullable<HarnessExecutionPlan["harness"]> {
  const harness = plan.harness;
  if (!harness) {
    throw new Error(
      `Expected ${piCodingAgentHarnessManifest.id} harness, received no harness configuration.`,
    );
  }
  if (harness.id !== piCodingAgentHarnessManifest.id) {
    throw new Error(
      `Expected ${piCodingAgentHarnessManifest.id} harness, received ${harness.id}.`,
    );
  }
  return harness;
}
