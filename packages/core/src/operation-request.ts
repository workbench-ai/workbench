import type {
  WorkbenchOperationPlanSummary,
  WorkbenchOperationRequest,
  WorkbenchOperationStep,
  WorkbenchOperationTarget,
  WorkbenchOperationVariant,
  WorkbenchRunKind,
} from "@workbench-ai/workbench-contract";

import { WorkbenchUserError } from "./coded-errors.ts";

export function parseWorkbenchOperationRequest(
  value: unknown,
  variant: WorkbenchOperationVariant,
): WorkbenchOperationRequest {
  const body = readRecord(value, "Operation request");
  if (body.kind !== "eval" && body.kind !== "improve") {
    throw new WorkbenchUserError("Operation kind must be eval or improve.");
  }
  const common = {
    variant,
    ...optionalStringField(body, "runId"),
    ...optionalStringField(body, "evalHash"),
    ...optionalPositiveIntegerField(body, "samples"),
    ...optionalStringField(body, "retryOfRunId"),
  };
  if (body.kind === "improve") {
    return {
      kind: "improve",
      ...common,
      ...(body.target !== undefined ? { target: readOperationTarget(body.target, "target") } : {}),
      ...optionalStringField(body, "versionId"),
      ...optionalPositiveIntegerField(body, "budget"),
      ...(body.evidenceTraceIds !== undefined
        ? { evidenceTraceIds: readStringArray(body.evidenceTraceIds, "evidenceTraceIds") }
        : {}),
    };
  }
  const caseIds = body.caseIds === undefined ? [] : readStringArray(body.caseIds, "caseIds");
  if (variant === "local" && caseIds.length === 0) {
    throw new WorkbenchUserError("Eval operations must include at least one case.");
  }
  return {
    kind: "eval",
    ...common,
    caseIds,
    targets: readOperationTargets(body.targets, variant),
    steps: readOperationSteps(body.steps),
    ...optionalBooleanField(body, "rerun"),
    ...optionalStringField(body, "gradeOfRunId"),
  };
}

export function normalizeWorkbenchOperationRequest(
  request: WorkbenchOperationRequest,
): WorkbenchOperationRequest {
  const samples = positiveIntegerOrUndefined(request.samples);
  if (request.kind === "improve") {
    const budget = positiveIntegerOrUndefined(request.budget);
    return {
      kind: "improve",
      variant: request.variant,
      ...(request.runId ? { runId: request.runId } : {}),
      ...(request.target ? { target: copyWorkbenchOperationTarget(request.target) } : {}),
      ...(request.versionId ? { versionId: request.versionId } : {}),
      ...(request.evalHash ? { evalHash: request.evalHash } : {}),
      samples: samples ?? 1,
      budget: budget ?? 1,
      ...(request.evidenceTraceIds?.length ? { evidenceTraceIds: [...request.evidenceTraceIds] } : {}),
      ...(request.retryOfRunId ? { retryOfRunId: request.retryOfRunId } : {}),
    };
  }
  return {
    kind: "eval",
    variant: request.variant,
    ...(request.runId ? { runId: request.runId } : {}),
    caseIds: uniqueStrings([...request.caseIds]),
    targets: request.targets.map(copyWorkbenchOperationTarget),
    steps: normalizeWorkbenchOperationSteps(request.steps),
    ...(request.evalHash ? { evalHash: request.evalHash } : {}),
    samples: samples ?? 1,
    ...(request.rerun === true ? { rerun: true } : {}),
    ...(request.gradeOfRunId ? { gradeOfRunId: request.gradeOfRunId } : {}),
    ...(request.retryOfRunId ? { retryOfRunId: request.retryOfRunId } : {}),
  };
}

export function createWorkbenchOperationPlanSummary(input: {
  kind: WorkbenchRunKind;
  variant: WorkbenchOperationVariant;
  targets?: readonly WorkbenchOperationTarget[];
  steps?: readonly WorkbenchOperationStep[];
  versionId: string;
  evalHash: string;
  skillName?: string;
  agentName?: string;
  skillNames?: readonly string[];
  agentNames?: readonly string[];
  caseIds?: readonly string[];
  samples?: number;
  rerun?: boolean;
  budget?: number;
  gradeOfRunId?: string;
  retryOfRunId?: string;
}): WorkbenchOperationPlanSummary {
  return {
    kind: input.kind,
    variant: input.variant,
    ...(input.targets?.length ? { targets: input.targets.map(copyWorkbenchOperationTarget) } : {}),
    ...(input.steps?.length ? { steps: [...input.steps] } : {}),
    versionId: input.versionId,
    evalHash: input.evalHash,
    skills: uniqueStrings([...(input.skillNames ?? []), ...(input.skillName ? [input.skillName] : [])]),
    agents: uniqueStrings([...(input.agentNames ?? []), ...(input.agentName ? [input.agentName] : [])]),
    ...((input.caseIds?.length ?? 0) > 0 ? { caseIds: uniqueStrings([...(input.caseIds ?? [])]) } : {}),
    ...(input.samples !== undefined ? { samples: input.samples } : {}),
    ...(input.rerun === true ? { rerun: true } : {}),
    ...(input.budget !== undefined ? { budget: input.budget } : {}),
    ...(input.gradeOfRunId ? { gradeOfRunId: input.gradeOfRunId } : {}),
    ...(input.retryOfRunId ? { retryOfRunId: input.retryOfRunId } : {}),
  };
}

export function copyWorkbenchOperationPlanSummary(
  plan: WorkbenchOperationPlanSummary,
): WorkbenchOperationPlanSummary {
  return {
    ...plan,
    ...(plan.targets ? { targets: plan.targets.map(copyWorkbenchOperationTarget) } : {}),
    ...(plan.steps ? { steps: [...plan.steps] } : {}),
    skills: [...plan.skills],
    agents: [...plan.agents],
    ...(plan.caseIds ? { caseIds: [...plan.caseIds] } : {}),
  };
}

export function copyWorkbenchOperationTarget(
  target: WorkbenchOperationTarget,
): WorkbenchOperationTarget {
  return {
    ...(target.skill ? { skill: target.skill } : {}),
    ...(target.versionId ? { versionId: target.versionId } : {}),
    ...(target.agent ? { agent: target.agent } : {}),
  };
}

export function workbenchOperationTargetSkillSelector(
  targets: readonly WorkbenchOperationTarget[],
): string | undefined {
  const skills = uniqueStrings(targets.flatMap((target) => target.skill ? [target.skill] : []));
  return skills.length > 0 ? skills.join(",") : undefined;
}

export function workbenchOperationTargetAgentSelector(
  targets: readonly WorkbenchOperationTarget[],
): string | undefined {
  const agents = uniqueStrings(targets.flatMap((target) => target.agent ? [target.agent] : []));
  return agents.length > 0 ? agents.join(",") : undefined;
}

export function workbenchOperationTargetVersionId(
  targets: readonly WorkbenchOperationTarget[],
): string | undefined {
  const versions = uniqueStrings(targets.flatMap((target) => target.versionId ? [target.versionId] : []));
  return versions.length === 1 ? versions[0] : undefined;
}

export function workbenchOperationTargetsFromPlan(
  plan: Pick<WorkbenchOperationPlanSummary, "agents" | "skills" | "versionId">,
): WorkbenchOperationTarget[] {
  const agents = plan.agents.length > 0 ? plan.agents : [undefined];
  return agents.map((agent, index) => ({
    ...(plan.skills[index] ? { skill: plan.skills[index] } : plan.skills[0] ? { skill: plan.skills[0] } : {}),
    ...(plan.versionId ? { versionId: plan.versionId } : {}),
    ...(agent ? { agent } : {}),
  }));
}

export function workbenchOperationTargetFromPlan(
  plan: Pick<WorkbenchOperationPlanSummary, "agents" | "skills" | "versionId">,
): WorkbenchOperationTarget | undefined {
  return workbenchOperationTargetsFromPlan(plan)[0];
}

export function normalizeWorkbenchOperationSteps(steps: readonly WorkbenchOperationStep[]): WorkbenchOperationStep[] {
  const result: WorkbenchOperationStep[] = [];
  for (const step of steps) {
    if (step !== "run" && step !== "grade") {
      throw new WorkbenchUserError("Eval operation steps must include only run or grade.");
    }
    if (!result.includes(step)) {
      result.push(step);
    }
  }
  if (result.length === 0) {
    throw new WorkbenchUserError("Eval operation steps must include run or grade.");
  }
  return result;
}

function positiveIntegerOrUndefined(value: number | undefined): number | undefined {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : undefined;
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkbenchUserError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readOperationTargets(value: unknown, variant: WorkbenchOperationVariant): WorkbenchOperationTarget[] {
  if (!Array.isArray(value)) {
    throw new WorkbenchUserError("Eval operation targets must be an array.");
  }
  if (variant === "cloud" && value.length !== 1) {
    throw new WorkbenchUserError("Eval operation targets must include exactly one target.");
  }
  if (value.length === 0) {
    throw new WorkbenchUserError("Eval operation targets must include at least one configuration.");
  }
  return value.map((entry, index) => readOperationTarget(entry, `targets[${index}]`));
}

function readOperationTarget(value: unknown, label: string): WorkbenchOperationTarget {
  const target = readRecord(value, label);
  return {
    ...optionalStringField(target, "skill", `${label}.skill`),
    ...optionalStringField(target, "versionId", `${label}.versionId`),
    ...optionalStringField(target, "agent", `${label}.agent`),
  };
}

function readOperationSteps(value: unknown): WorkbenchOperationStep[] {
  if (!Array.isArray(value)) {
    throw new WorkbenchUserError("Eval operation steps must be an array.");
  }
  return normalizeWorkbenchOperationSteps(value.map((entry, index) => {
    if (entry !== "run" && entry !== "grade") {
      throw new WorkbenchUserError(`Eval operation steps[${index}] must be run or grade.`);
    }
    return entry;
  }));
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new WorkbenchUserError(`${label} must be a string array.`);
  }
  return uniqueStrings(value.map((entry, index) => readString(entry, `${label}[${index}]`)));
}

function optionalStringField(
  record: Record<string, unknown>,
  field: string,
  label = field,
): Record<string, string> {
  return record[field] === undefined ? {} : { [field]: readString(record[field], label) };
}

function optionalPositiveIntegerField(
  record: Record<string, unknown>,
  field: string,
): Record<string, number> {
  if (record[field] === undefined) {
    return {};
  }
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new WorkbenchUserError(`${field} must be a positive integer.`);
  }
  return { [field]: value };
}

function optionalBooleanField(
  record: Record<string, unknown>,
  field: string,
): Record<string, boolean> {
  if (record[field] === undefined) {
    return {};
  }
  if (typeof record[field] !== "boolean") {
    throw new WorkbenchUserError(`${field} must be a boolean.`);
  }
  return { [field]: record[field] } as Record<string, boolean>;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkbenchUserError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
