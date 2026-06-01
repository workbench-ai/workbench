import type {
  EvalCaseResult,
  Json,
  SurfaceSnapshotFile,
  WorkbenchCandidatePatch,
  WorkbenchExecutionOutputContract,
  WorkbenchExecutionSpec,
  WorkbenchResult,
} from "@workbench-ai/workbench-contract";

import { normalizeUsageSummary } from "./execution-usage.ts";
import { isJsonPayload } from "./runtime-utils.ts";

export interface WorkbenchExecutionOutputPayloads {
  candidatePatch?: WorkbenchCandidatePatch;
  result?: WorkbenchResult;
}

export function validateWorkbenchExecutionOutputPayloads(
  execution: WorkbenchExecutionSpec,
  payloads: Record<string, Json>,
): WorkbenchExecutionOutputPayloads {
  const issues: string[] = [];
  const declaredOutputs = new Map(execution.outputs.map((output) => [output.name, output]));
  for (const output of execution.outputs) {
    if (output.required && !(output.name in payloads)) {
      issues.push(`Execution ${execution.id} did not produce required output ${output.name}.`);
    }
  }
  for (const outputName of Object.keys(payloads)) {
    if (!declaredOutputs.has(outputName)) {
      issues.push(`Execution ${execution.id} produced undeclared output ${outputName}.`);
    }
  }

  const validated: WorkbenchExecutionOutputPayloads = {};
  for (const [name, payload] of Object.entries(payloads)) {
    const contract = declaredOutputs.get(name);
    if (!contract) {
      continue;
    }
    switch (contract.schema) {
      case "workbench.candidate_patch.v1":
        validated.candidatePatch = normalizeCandidatePatch(payload, execution, contract, issues);
        break;
      case "workbench.result.v1":
        validated.result = normalizeResult(payload, execution, contract, issues);
        break;
      default:
        break;
    }
  }

  if (issues.length > 0) {
    throw new Error(issues.join("\n"));
  }
  return validated;
}

export function collectWorkbenchExecutionIsolationIssues(execution: WorkbenchExecutionSpec): string[] {
  const issues: string[] = [];
  if (!execution.policy.tenantId.trim()) {
    issues.push(`Execution ${execution.id} must include a non-empty tenant id.`);
  }
  if (!execution.projectId.trim()) {
    issues.push(`Execution ${execution.id} must include a project id.`);
  }
  if (!execution.runId.trim()) {
    issues.push(`Execution ${execution.id} must include a run id.`);
  }
  if (!execution.sandbox.ref.trim()) {
    issues.push(`Execution ${execution.id} must include a sandbox template ref.`);
  }
  if (execution.sandbox.kind !== "oci" && execution.sandbox.kind !== "snapshot") {
    issues.push(`Execution ${execution.id} has unsupported sandbox kind ${execution.sandbox.kind}.`);
  }

  const inputNames = new Set<string>();
  const mountPaths = new Set<string>();
  const expectedInputs = expectedInputsForPurpose(execution.purpose);
  for (const input of execution.inputs) {
    if (!input.name.trim()) {
      issues.push(`Execution ${execution.id} has an input with an empty name.`);
    }
    if (inputNames.has(input.name)) {
      issues.push(`Execution ${execution.id} declares duplicate input ${input.name}.`);
    }
    inputNames.add(input.name);
    if (!input.ref.trim()) {
      issues.push(`Execution ${execution.id} input ${input.name} must include a ref.`);
    }
    if (!expectedInputs.has(input.name)) {
      issues.push(`Execution ${execution.id} declares unsupported input ${input.name} for purpose ${execution.purpose}.`);
    }
    const expectedMountPath = expectedInputMountPath(execution.purpose, input.name);
    if (input.mountPath !== expectedMountPath) {
      issues.push(`Execution ${execution.id} input ${input.name} must mount at ${expectedMountPath}.`);
    }
    if (mountPaths.has(input.mountPath)) {
      issues.push(`Execution ${execution.id} declares duplicate mount path ${input.mountPath}.`);
    }
    mountPaths.add(input.mountPath);
    const expectedWritable = expectedInputWritable(execution.purpose, input.name);
    if (input.writable !== expectedWritable) {
      issues.push(
        expectedWritable
          ? `Execution ${execution.id} input ${input.name} must be writable.`
          : `Execution ${execution.id} input ${input.name} must be read-only.`,
      );
    }
  }
  for (const expectedInput of expectedInputs) {
    if (!inputNames.has(expectedInput)) {
      issues.push(`Execution ${execution.id} missing required input ${expectedInput} for purpose ${execution.purpose}.`);
    }
  }

  const outputNames = new Set<string>();
  const expectedOutput = expectedOutputForPurpose(execution.purpose);
  const isRuntimeControlExecution = execution.metadata.runtimeControl === true;
  for (const output of execution.outputs) {
    if (outputNames.has(output.name)) {
      issues.push(`Execution ${execution.id} declares duplicate output ${output.name}.`);
    }
    outputNames.add(output.name);
    if (expectedOutput === null) {
      issues.push(`Execution ${execution.id} cannot declare outputs for purpose ${execution.purpose}.`);
    } else if (output.name !== expectedOutput) {
      issues.push(`Execution ${execution.id} output for purpose ${execution.purpose} must be named ${expectedOutput}.`);
    }
    if (!outputAllowedForPurpose(execution.purpose, output)) {
      issues.push(`Execution ${execution.id} cannot declare ${output.schema} for purpose ${execution.purpose}.`);
    }
  }
  if (expectedOutput !== null && !outputNames.has(expectedOutput) && !isRuntimeControlExecution) {
    issues.push(`Execution ${execution.id} missing required output ${expectedOutput} for purpose ${execution.purpose}.`);
  }

  const resources = execution.policy.resources;
  for (const [name, value] of Object.entries(resources)) {
    if (!Number.isFinite(value) || value <= 0) {
      issues.push(`Execution ${execution.id} policy.resources.${name} must be a positive number.`);
    }
  }

  return issues;
}

function expectedInputsForPurpose(purpose: WorkbenchExecutionSpec["purpose"]): ReadonlySet<string> {
  if (purpose === "improve") {
    return new Set(["candidate", "traces"]);
  }
  if (purpose === "attempt") {
    return new Set(["candidate", "case"]);
  }
  return new Set();
}

function expectedInputMountPath(
  purpose: WorkbenchExecutionSpec["purpose"],
  name: string,
): string {
  if (purpose === "improve" && name === "candidate") {
    return "/workspace";
  }
  return `/workspace/input/${name}`;
}

function expectedInputWritable(
  purpose: WorkbenchExecutionSpec["purpose"],
  name: string,
): boolean {
  return purpose === "improve" && name === "candidate";
}

function expectedOutputForPurpose(purpose: WorkbenchExecutionSpec["purpose"]): string | null {
  if (purpose === "improve") {
    return "candidate_patch";
  }
  if (purpose === "attempt") {
    return "result";
  }
  return null;
}

export function assertWorkbenchExecutionIsolation(execution: WorkbenchExecutionSpec): void {
  const issues = collectWorkbenchExecutionIsolationIssues(execution);
  if (issues.length > 0) {
    throw new Error(issues.join("\n"));
  }
}

function outputAllowedForPurpose(
  purpose: WorkbenchExecutionSpec["purpose"],
  output: WorkbenchExecutionOutputContract,
): boolean {
  if (purpose === "improve") {
    return output.schema === "workbench.candidate_patch.v1";
  }
  if (purpose === "attempt") {
    return output.schema === "workbench.result.v1";
  }
  return false;
}

function normalizeCandidatePatch(
  value: Json,
  execution: WorkbenchExecutionSpec,
  contract: WorkbenchExecutionOutputContract,
  issues: string[],
): WorkbenchCandidatePatch {
  const record = readRecord(value, contract.name, issues);
  const files = normalizeSnapshotFiles(record?.files, `${contract.name}.files`, issues);
  const fileChanges = normalizeStringArray(record?.fileChanges, `${contract.name}.fileChanges`, issues);
  const edits = normalizeMetadataStringArray(execution.metadata.edits);
  if (edits.length === 0) {
    issues.push(`Execution ${execution.id} candidate patch validation requires metadata.edits.`);
  }
  for (const file of files) {
    if (!isAllowedEditPath(file.path, edits)) {
      issues.push(`${contract.name}.files contains path outside improve edits: ${file.path}.`);
    }
  }
  for (const fileChange of fileChanges) {
    if (!isSafeRelativePath(fileChange)) {
      issues.push(`${contract.name}.fileChanges contains unsafe path ${fileChange}.`);
    } else if (!isAllowedEditPath(fileChange, edits)) {
      issues.push(`${contract.name}.fileChanges contains path outside improve edits: ${fileChange}.`);
    }
  }
  return {
    files,
    fileChanges,
    ...(typeof record?.summary === "string" ? { summary: record.summary } : {}),
    ...(isJsonPayload(record?.feedback) ? { feedback: record.feedback } : {}),
  };
}

function normalizeResult(
  value: Json,
  execution: WorkbenchExecutionSpec,
  contract: WorkbenchExecutionOutputContract,
  issues: string[],
): WorkbenchResult {
  void execution;
  const record = readRecord(value, contract.name, issues);
  const score = readFiniteNumber(record?.score, `${contract.name}.score`, issues);
  const usage = normalizeUsageSummary(record?.usage);
  return {
    score: score ?? 0,
    ...(record?.metrics !== undefined ? { metrics: normalizeNumberRecord(record.metrics, `${contract.name}.metrics`, issues) } : {}),
    ...(record?.cases !== undefined ? { cases: normalizeCaseResults(record.cases, `${contract.name}.cases`, issues) } : {}),
    ...(usage ? { usage } : {}),
    ...(typeof record?.summary === "string" ? { summary: record.summary } : {}),
    ...(isJsonPayload(record?.feedback) ? { feedback: record.feedback } : {}),
  };
}

function normalizeSnapshotFiles(value: unknown, label: string, issues: string[]): SurfaceSnapshotFile[] {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array.`);
    return [];
  }
  return value.flatMap((entry, index): SurfaceSnapshotFile[] => {
    const itemLabel = `${label}[${index}]`;
    const record = readRecord(entry, itemLabel, issues);
    if (!record) {
      return [];
    }
    const filePath = readSafePath(record.path, `${itemLabel}.path`, issues);
    const encoding = record.encoding === "base64" ? "base64" : "utf8";
    const kind = record.kind === "text" || record.kind === "binary"
      ? record.kind
      : encoding === "base64" ? "binary" : "text";
    if (typeof record.content !== "string") {
      issues.push(`${itemLabel}.content must be a string.`);
    }
    if (!filePath || typeof record.content !== "string") {
      return [];
    }
    return [{
      path: filePath,
      kind,
      encoding,
      content: record.content,
      executable: record.executable === true,
    }];
  });
}

function normalizeCaseResults(value: unknown, label: string, issues: string[]): EvalCaseResult[] {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array.`);
    return [];
  }
  return value.flatMap((entry, index): EvalCaseResult[] => {
    const itemLabel = `${label}[${index}]`;
    const record = readRecord(entry, itemLabel, issues);
    const id = readNonEmptyString(record?.id, `${itemLabel}.id`, issues);
    if (!record || !id) {
      return [];
    }
    const status = record.status === undefined || record.status === "completed" || record.status === "error"
      ? record.status
      : null;
    if (status === null) {
      issues.push(`${itemLabel}.status must be completed or error.`);
    }
    const criteria = record.criteria === undefined
      ? undefined
      : normalizeCaseCriteria(record.criteria, `${itemLabel}.criteria`, issues);
    return [{
      id,
      ...(typeof record.label === "string" ? { label: record.label } : {}),
      ...(typeof record.split === "string" ? { split: record.split } : {}),
      ...(status ? { status } : {}),
      ...(record.durationMs !== undefined ? { durationMs: readFiniteNumber(record.durationMs, `${itemLabel}.durationMs`, issues) ?? 0 } : {}),
      metrics: normalizeNumberRecord(record.metrics ?? {}, `${itemLabel}.metrics`, issues),
      ...(isJsonPayload(record.source) && record.source && typeof record.source === "object" && !Array.isArray(record.source)
        ? { source: record.source as Record<string, Json> }
        : {}),
      ...(isJsonPayload(record.feedback) ? { feedback: record.feedback } : {}),
      ...(criteria && criteria.length > 0 ? { criteria } : {}),
    }];
  });
}

function normalizeCaseCriteria(
  value: unknown,
  label: string,
  issues: string[],
): NonNullable<EvalCaseResult["criteria"]> {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array.`);
    return [];
  }
  return value.flatMap((entry, index): NonNullable<EvalCaseResult["criteria"]> => {
    const itemLabel = `${label}[${index}]`;
    const record = readRecord(entry, itemLabel, issues);
    const criterionId = readNonEmptyString(record?.criterion_id, `${itemLabel}.criterion_id`, issues);
    const score = readFiniteNumber(record?.score, `${itemLabel}.score`, issues);
    if (!record || !criterionId || score === null) {
      return [];
    }
    const pass = typeof record.pass === "boolean" ? record.pass : null;
    if (pass === null) {
      issues.push(`${itemLabel}.pass must be a boolean.`);
      return [];
    }
    const errors = record.errors === undefined
      ? []
      : Array.isArray(record.errors)
        ? record.errors.filter((error): error is string => typeof error === "string")
        : null;
    if (errors === null) {
      issues.push(`${itemLabel}.errors must be an array when provided.`);
    }
    const rationale = typeof record.rationale === "string" && record.rationale.trim().length > 0
      ? record.rationale.trim()
      : undefined;
    return [{
      criterion_id: criterionId,
      label: typeof record.label === "string" ? record.label : criterionId,
      score,
      pass,
      ...(errors && errors.length > 0 ? { errors } : {}),
      ...(rationale ? { rationale } : {}),
    }];
  });
}

function normalizeNumberRecord(value: unknown, label: string, issues: string[]): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(`${label} must be an object.`);
    return {};
  }
  const output: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    const numericValue = readFiniteNumber(entry, `${label}.${key}`, issues);
    if (numericValue !== null) {
      output[key] = numericValue;
    }
  }
  return output;
}

function normalizeStringArray(value: unknown, label: string, issues: string[]): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array.`);
    return [];
  }
  return value.flatMap((entry, index): string[] => {
    const normalized = readNonEmptyString(entry, `${label}[${index}]`, issues);
    return normalized ? [normalized] : [];
  });
}

function normalizeMetadataStringArray(value: Json | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => normalizeRelativePath(entry));
}

function readRecord(value: unknown, label: string, issues: string[]): Record<string, Json> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(`${label} must be an object.`);
    return null;
  }
  return value as Record<string, Json>;
}

function readNonEmptyString(value: unknown, label: string, issues: string[]): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${label} must be a non-empty string.`);
    return null;
  }
  return value;
}

function readSafePath(value: unknown, label: string, issues: string[]): string | null {
  const filePath = readNonEmptyString(value, label, issues);
  if (!filePath) {
    return null;
  }
  const normalized = normalizeRelativePath(filePath);
  if (!isSafeRelativePath(normalized)) {
    issues.push(`${label} must be a safe relative path.`);
    return null;
  }
  return normalized;
}

function readFiniteNumber(value: unknown, label: string, issues: string[]): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${label} must be a finite number.`);
    return null;
  }
  return value;
}

function isAllowedEditPath(filePath: string, edits: string[]): boolean {
  const normalizedPath = normalizeRelativePath(filePath);
  return edits.some((entry) => {
    const normalizedEditPath = normalizeRelativePath(entry).replace(/\/+$/u, "");
    return normalizedPath === normalizedEditPath || normalizedPath.startsWith(`${normalizedEditPath}/`);
  });
}

function isSafeRelativePath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  return normalized.length > 0
    && !normalized.startsWith("/")
    && !normalized.split("/").includes("..");
}

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/gu, "/").replace(/^\.\/+/u, "").replace(/\/+/gu, "/");
}
