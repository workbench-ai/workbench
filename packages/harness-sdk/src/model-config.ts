import type { JsonValue } from "@workbench-ai/flow-contracts";
import { z } from "zod";

export const harnessModelConfigJsonSchemaProperty: JsonValue = {
  type: "string",
  minLength: 1,
};

export const harnessModelConfigZodShape = {
  model: z.string().trim().min(1).optional(),
} as const;

export const sharedHarnessEffortValues = ["low", "medium", "high"] as const;

export const codexHarnessEffortValues = [
  "none",
  "minimal",
  ...sharedHarnessEffortValues,
  "xhigh",
] as const;

export function createHarnessEffortJsonSchemaProperty(
  values: readonly string[],
): JsonValue {
  return {
    enum: [...values],
  };
}

export function createHarnessEffortZodSchema<
  T extends readonly [string, ...string[]],
>(values: T): z.ZodOptional<z.ZodType<T[number]>> {
  const enumSchema = z.enum(values);
  return z
    .preprocess(
      (value) => (typeof value === "string" ? value.trim() : value),
      enumSchema,
    )
    .optional();
}

export function resolveHarnessConfiguredModel(config: { model?: string | null }): string | null {
  if (typeof config.model !== "string") {
    return null;
  }

  const model = config.model.trim();
  return model.length > 0 ? model : null;
}

export function resolveHarnessConfiguredEffort<
  T extends readonly string[],
>(
  config: { effort?: string | null },
  values: T,
): T[number] | null {
  if (typeof config.effort !== "string") {
    return null;
  }

  const effort = config.effort.trim();
  if (effort.length === 0 || !values.includes(effort as T[number])) {
    return null;
  }

  return effort as T[number];
}
