import type { JsonValue } from "@workbench-ai/flow-contracts";
import {
  createHarnessEffortZodSchema,
  createHarnessEffortJsonSchemaProperty,
} from "@workbench-ai/flow-harness-sdk";
import { z } from "zod";

export const piHarnessEffortValues = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export const piModelJsonSchemaProperty: JsonValue = {
  type: "string",
  minLength: 1,
  pattern: "^[^/]+/.+$",
};

export const piEffortJsonSchemaProperty = createHarnessEffortJsonSchemaProperty(
  piHarnessEffortValues,
);

const PiSecretRefAuthSchema = z
  .object({
    strategy: z.literal("secret_ref"),
    ref: z.string().trim().min(1),
  })
  .strict();

const PiProfilePathAuthSchema = z
  .object({
    strategy: z.literal("profile_path"),
    path: z.string().trim().min(1),
  })
  .strict();

export const PiHarnessAuthSchema = z.discriminatedUnion("strategy", [
  PiSecretRefAuthSchema,
  PiProfilePathAuthSchema,
]);

export const PiHarnessConfigSchema = z.object({}).strict();

export const PiHarnessEffortSchema = createHarnessEffortZodSchema(
  piHarnessEffortValues,
);

export type PiHarnessAuth = z.infer<typeof PiHarnessAuthSchema>;
export type PiHarnessConfig = z.infer<typeof PiHarnessConfigSchema>;
export type PiHarnessEffort = z.infer<typeof PiHarnessEffortSchema>;
