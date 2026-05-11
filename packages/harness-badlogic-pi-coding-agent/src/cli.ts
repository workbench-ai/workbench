import type { HarnessExecutionPlan } from "@workbench-ai/harness-sdk";
import { resolveHarnessConfiguredEffort, resolveHarnessConfiguredModel } from "@workbench-ai/harness-sdk";
import {
  getPiHarness,
  piCodingAgentHarnessManifest,
} from "./manifest.js";
import { piHarnessEffortValues } from "./schemas.js";

export interface PiResolvedModel {
  full: string;
  provider: string;
  modelId: string;
}

export function resolvePiConfiguredModel(plan: HarnessExecutionPlan): PiResolvedModel {
  const harness = getPiHarness(plan);
  const rawModel =
    resolveHarnessConfiguredModel(harness) ??
    piCodingAgentHarnessManifest.defaults.model;
  if (!rawModel) {
    throw new Error("Pi requires a resolved model.");
  }
  return parsePiModel(rawModel);
}

export function parsePiModel(rawModel: string): PiResolvedModel {
  const model = rawModel.trim();
  const slashIndex = model.indexOf("/");
  if (slashIndex <= 0 || slashIndex === model.length - 1) {
    throw new Error(
      `Pi model "${rawModel}" must use "<provider>/<model-id>" form.`,
    );
  }
  return {
    full: model,
    provider: model.slice(0, slashIndex),
    modelId: model.slice(slashIndex + 1),
  };
}

export function resolvePiConfiguredEffort(
  plan: HarnessExecutionPlan,
): string | null {
  return resolveHarnessConfiguredEffort(getPiHarness(plan), piHarnessEffortValues);
}

export function buildPiRpcCommand(
  executable: string,
  model: PiResolvedModel,
  effort: string | null,
  sessionFile: string,
): string {
  return buildPiCommand(executable, model, effort, sessionFile, {
    rpc: true,
    prompt: null,
  });
}

export function buildPiInteractiveCommand(
  executable: string,
  model: PiResolvedModel,
  effort: string | null,
  sessionFile: string,
  prompt: string | null,
): string {
  return buildPiCommand(executable, model, effort, sessionFile, {
    rpc: false,
    prompt,
  });
}

export function normalizePiStringEnv(
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      next[key] = value;
    }
  }
  return next;
}

export function quoteShellArg(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replace(/'/gu, `'\"'\"'`)}'`;
}

function buildPiCommand(
  executable: string,
  model: PiResolvedModel,
  effort: string | null,
  sessionFile: string,
  options: {
    rpc: boolean;
    prompt: string | null;
  },
): string {
  const args = [
    "--session",
    sessionFile,
    "--provider",
    model.provider,
    "--model",
    model.modelId,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
  ];

  if (options.rpc) {
    args.unshift("rpc");
    args.unshift("--mode");
  }
  if (effort) {
    args.push("--thinking", effort);
  }
  if (options.prompt && options.prompt.trim().length > 0) {
    args.push(options.prompt);
  }

  return `${executable.trim()} ${args.map(quoteShellArg).join(" ")}`;
}
