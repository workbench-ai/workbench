import { promises as fs } from "node:fs";
import path from "node:path";

import type { JsonValue } from "@workbench-ai/flow-contracts";

import { collectHarnessProviderConformanceIssues } from "./conformance.js";
import type {
  ActiveHarnessSession,
  HarnessAdapter,
  HarnessExecutionPlan,
  HarnessProvider,
  HarnessSessionMode,
  StartSessionArgs,
} from "./index.js";

type BehaviorIssueHookResult = Promise<string[] | void> | string[] | void;

export interface HarnessBehaviorContractArgs {
  provider: HarnessProvider<unknown>;
  repoRoot: string;
  flowHome: string;
  executionId: string;
  ownerId: string;
  workspacePath: string;
  stageSessionPath: string;
  prompt: string;
  attemptNumber?: number;
  stageId?: string;
  stageRunIndex?: number;
  ownerStageId?: string;
  sessionMode?: HarnessSessionMode;
  persistedSession?: Record<string, JsonValue> | null;
  plan?: HarnessExecutionPlan;
  exerciseReadiness?: boolean;
  exerciseStartSession?: boolean;
  validateSession?: (session: ActiveHarnessSession<unknown>) => BehaviorIssueHookResult;
}

interface ContractContext {
  plan: HarnessExecutionPlan;
  attemptNumber: number;
  stageId: string;
  stageRunIndex: number;
  ownerStageId: string;
  sessionMode: HarnessSessionMode;
  persistedSession: Record<string, JsonValue> | null;
}

export async function collectHarnessProviderBehaviorContractIssues(args: HarnessBehaviorContractArgs): Promise<string[]> {
  const context = createContractContext(args);
  const issues = collectHarnessProviderConformanceIssues(args.provider);

  await Promise.all([args.repoRoot, args.flowHome, args.workspacePath, args.stageSessionPath].map(ensureDir));
  await seedDefaultSecretRefEnv(context.plan, args.repoRoot);

  if (args.exerciseReadiness ?? true) {
    await maybeExerciseReadiness(args, context.plan, issues);
  }

  const adapter = createAdapter(args.provider, issues);
  if (!adapter) {
    return issues;
  }

  validateAdapterBasics(args.provider, adapter, context.plan, issues);
  const sessionBaseArgs = createSessionBaseArgs(args, context);

  if (args.exerciseStartSession ?? true) {
    const session = await captureAsyncIssue(issues, "startSession", () =>
      adapter.startSession({ ...sessionBaseArgs, sessionMode: context.sessionMode }),
    );
    if (session) {
      try {
        validateStartedSession(session, args.provider.manifest.id, context, issues);
        await pushHookIssues(issues, args.validateSession?.(session));
      } finally {
        await captureAsyncIssue(issues, "closeSession threw after contract startSession check", () =>
          adapter.closeSession(session, context.plan.harness.cancel),
        );
      }
    }
  }

  return issues;
}

function createContractContext(args: HarnessBehaviorContractArgs): ContractContext {
  const stageId = args.stageId ?? "stage";
  return {
    plan: args.plan ?? createDefaultBehaviorPlan(args.provider),
    attemptNumber: args.attemptNumber ?? 1,
    stageId,
    stageRunIndex: args.stageRunIndex ?? 0,
    ownerStageId: args.ownerStageId ?? stageId,
    sessionMode: args.sessionMode ?? "fresh",
    persistedSession: args.persistedSession ?? null,
  };
}

function createSessionBaseArgs(
  args: HarnessBehaviorContractArgs,
  context: ContractContext,
): StartSessionArgs {
  return {
    repoRoot: args.repoRoot,
    flowHome: args.flowHome,
    plan: context.plan,
    ownerId: args.ownerId,
    executionId: args.executionId,
    attemptNumber: context.attemptNumber,
    stageId: context.stageId,
    stageRunIndex: context.stageRunIndex,
    workspacePath: args.workspacePath,
    ownerStageId: context.ownerStageId,
    sessionMode: context.sessionMode,
    stageSessionPath: args.stageSessionPath,
    persistedSession: context.persistedSession,
  };
}

async function maybeExerciseReadiness(args: HarnessBehaviorContractArgs, plan: HarnessExecutionPlan, issues: string[]): Promise<void> {
  const checkReadiness = args.provider.checkReadiness;
  if (typeof checkReadiness !== "function") {
    return;
  }

  const readiness = await captureAsyncIssue(issues, "provider.checkReadiness", () =>
    checkReadiness({ repoRoot: args.repoRoot, flowHome: args.flowHome, plan }),
  );
  if (!readiness) {
    return;
  }
  if (!Array.isArray(readiness.availability_errors)) {
    issues.push("provider.checkReadiness(args) must return { availability_errors: string[] }.");
    return;
  }
  if (readiness.availability_errors.length > 0) {
    issues.push(`provider.checkReadiness returned availability errors: ${readiness.availability_errors.join("; ")}`);
  }
}

function createAdapter(provider: HarnessProvider<unknown>, issues: string[]): HarnessAdapter<unknown> | null {
  try {
    const adapter = provider.create();
    if (!adapter || typeof adapter !== "object") {
      issues.push("provider.create must return a harness adapter object.");
      return null;
    }
    return adapter;
  } catch (error) {
    issues.push(`provider.create threw: ${formatError(error)}`);
    return null;
  }
}

function validateAdapterBasics(provider: HarnessProvider<unknown>, adapter: HarnessAdapter<unknown>, plan: HarnessExecutionPlan, issues: string[]): void {
  if (adapter.manifest.id !== provider.manifest.id) {
    issues.push(`adapter.manifest.id (${JSON.stringify(adapter.manifest.id)}) must match provider.manifest.id (${JSON.stringify(provider.manifest.id)}).`);
  }

  let ignoredEntries: string[];
  try {
    ignoredEntries = adapter.getManagedWorkspaceIgnoreEntries(plan);
  } catch (error) {
    issues.push(`adapter.getManagedWorkspaceIgnoreEntries threw: ${formatError(error)}`);
    return;
  }
  if (!Array.isArray(ignoredEntries)) {
    issues.push("adapter.getManagedWorkspaceIgnoreEntries(plan) must return an array.");
  } else if (ignoredEntries.some((value) => typeof value !== "string")) {
    issues.push("adapter.getManagedWorkspaceIgnoreEntries(plan) must return only strings.");
  }
}

function createDefaultBehaviorPlan(
  provider: HarnessProvider<unknown>,
): HarnessExecutionPlan {
  const { defaults, id, supported_workspace_modes: workspaceModes } = provider.manifest;
  const harness: HarnessExecutionPlan["harness"] = {
    id,
    auth: normalizeHarnessAuth(defaults.auth),
    turn_timeout_ms: defaults.turn_timeout_ms ?? 3_600_000,
    stall_timeout_ms: defaults.stall_timeout_ms ?? 300_000,
    config: normalizeJsonRecord(defaults.config),
    retry: { max_retries: 0, base_delay_ms: 1_000, max_backoff_ms: 5_000 },
    cancel: { graceful_timeout_ms: 2_000, hard_kill_timeout_ms: 1_000 },
  };
  if (defaults.model) {
    harness.model = defaults.model;
  }
  if (defaults.effort) {
    harness.effort = defaults.effort;
  }

  return {
    workspace: { mode: workspaceModes[0] ?? "managed", prune_ttl_seconds: 604_800 },
    harness,
  };
}

async function seedDefaultSecretRefEnv(plan: HarnessExecutionPlan, repoRoot: string): Promise<void> {
  const auth = plan.harness.auth;
  if (!isJsonRecord(auth) || auth.strategy !== "secret_ref") {
    return;
  }

  const ref = typeof auth.ref === "string" ? auth.ref.trim() : "";
  if (!ref) {
    return;
  }
  const value = `FLOW_TEST_${ref.toUpperCase().replace(/[^A-Z0-9_]+/gu, "_")}`;
  await fs.writeFile(path.join(repoRoot, ".env"), `${ref}=${value}\n`, "utf8");
}

function validateStartedSession(session: ActiveHarnessSession<unknown>, expectedHarnessId: string, context: ContractContext, issues: string[]): void {
  if (!session || typeof session !== "object") {
    issues.push("adapter.startSession(args) must return an ActiveHarnessSession object.");
    return;
  }
  if (session.ownerStageId !== context.ownerStageId) {
    issues.push(`startSession returned ownerStageId ${JSON.stringify(session.ownerStageId)} instead of ${JSON.stringify(context.ownerStageId)}.`);
  }
  if (!session.session || typeof session.session !== "object") {
    issues.push("startSession must return session.session metadata.");
    return;
  }

  for (const [field, actual, expected] of [
    ["harness_id", session.session.harness_id, expectedHarnessId],
    ["attempt_number", session.session.attempt_number, context.attemptNumber],
    ["stage_id", session.session.stage_id, context.stageId],
    ["stage_run_index", session.session.stage_run_index, context.stageRunIndex],
  ] as const) {
    if (actual !== expected) {
      issues.push(`startSession returned ${field} ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}.`);
    }
  }
  if (!session.session.harness_session || typeof session.session.harness_session !== "object") {
    issues.push("startSession must return session.harness_session as an object.");
  }
}

async function pushHookIssues(issues: string[], result: BehaviorIssueHookResult | undefined): Promise<void> {
  const additionalIssues = await result;
  if (Array.isArray(additionalIssues)) {
    issues.push(...additionalIssues);
  }
}

async function captureAsyncIssue<T>(issues: string[], label: string, action: () => Promise<T>): Promise<T | null> {
  try {
    return await action();
  } catch (error) {
    issues.push(`${label}: ${formatError(error)}`);
    return null;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeHarnessAuth(value: unknown): Record<string, JsonValue> {
  return isJsonRecord(value) ? value : {};
}

function normalizeJsonRecord(value: unknown): Record<string, JsonValue> {
  return isJsonRecord(value) ? { ...value } : {};
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function ensureDir(targetPath: string): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true });
}
