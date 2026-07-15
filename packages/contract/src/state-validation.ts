import type {
  Json,
  WorkbenchAgent,
  WorkbenchArtifact,
  WorkbenchEvalCaseSnapshot,
  WorkbenchEvalSnapshot,
  WorkbenchExecutionEventBatch,
  WorkbenchJob,
  WorkbenchLineageEdge,
  WorkbenchProjectState,
  WorkbenchRemote,
  WorkbenchRun,
  WorkbenchSkillBundleSnapshot,
  WorkbenchSkillSource,
  WorkbenchTrace,
  WorkbenchVersion,
} from "./index.js";
import { normalizeWorkbenchSourcePath } from "./source-path.js";

export class WorkbenchStateValidationError extends Error {}

export function parseWorkbenchProjectState(value: unknown): WorkbenchProjectState {
  const record = readRequiredRecord(value, "state");
  if (record.schema !== "workbench.skill.state.v1") {
    throw new WorkbenchStateValidationError("Expected Workbench skill state schema workbench.skill.state.v1.");
  }
  return {
    schema: "workbench.skill.state.v1",
    root: readRequiredString(record.root, "root"),
    refs: readStringMap(record.refs, "refs"),
    remotes: readWorkbenchRemotes(record.remotes),
    versions: readStateArray<WorkbenchVersion>(record.versions, "versions", validateStateVersion),
    skillSources: readStateArray<WorkbenchSkillSource>(record.skillSources, "skillSources", validateStateSkillSource),
    skillBundles: readStateArray<WorkbenchSkillBundleSnapshot>(record.skillBundles, "skillBundles", validateStateSkillBundle),
    evals: readStateArray<WorkbenchEvalSnapshot>(record.evals, "evals", validateStateEvalSnapshot),
    agents: readStateArray<WorkbenchAgent>(record.agents, "agents", validateStateAgent),
    runs: readStateArray<WorkbenchRun>(record.runs, "runs", validateStateRun),
    jobs: readStateArray<WorkbenchJob>(record.jobs, "jobs", validateStateJob),
    traces: readStateArray<WorkbenchTrace>(record.traces, "traces", validateStateTrace),
    executionEvents: readStateArray<WorkbenchExecutionEventBatch>(record.executionEvents, "executionEvents", validateStateExecutionEventBatch),
    artifacts: readStateArray<WorkbenchArtifact>(record.artifacts, "artifacts", validateStateArtifact),
    lineage: readStateArray<WorkbenchLineageEdge>(record.lineage, "lineage", validateStateLineageEdge),
  };
}

function readStringMap(value: unknown, pathLabel: string): Record<string, string> {
  const record = readRequiredRecord(value, pathLabel);
  for (const [key, entry] of Object.entries(record)) {
    readRequiredString(entry, `${pathLabel}.${key}`);
  }
  return record as Record<string, string>;
}

function readWorkbenchRemotes(value: unknown): Record<string, WorkbenchRemote> {
  const record = readRequiredRecord(value, "remotes");
  for (const [name, entry] of Object.entries(record)) {
    const remote = readRequiredRecord(entry, `remotes.${name}`);
    readRequiredString(remote.name, `remotes.${name}.name`);
    readRequiredString(remote.url, `remotes.${name}.url`);
    const kind = readRequiredString(remote.kind, `remotes.${name}.kind`);
    if (kind !== "workbench-cloud" && kind !== "file") {
      throw new WorkbenchStateValidationError(`Workbench state field remotes.${name}.kind must be workbench-cloud or file.`);
    }
  }
  return record as Record<string, WorkbenchRemote>;
}

export function isWorkbenchJson(value: unknown): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isWorkbenchJson);
  }
  return Boolean(value && typeof value === "object" && Object.values(value).every(isWorkbenchJson));
}

function readStateArray<T>(value: unknown, pathLabel: string, validate: (entry: unknown, index: number) => void): T[] {
  const values = readRequiredArray(value, pathLabel);
  values.forEach(validate);
  return values as T[];
}

function validateStateVersion(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `versions[${index}]`);
  readRequiredString(record.id, `versions[${index}].id`);
  readRequiredString(record.hash, `versions[${index}].hash`);
  readRequiredString(record.message, `versions[${index}].message`);
  readStringArray(record.parentIds, `versions[${index}].parentIds`);
  readRequiredString(record.createdAt, `versions[${index}].createdAt`);
  validateStateSurfaceFiles(record.files, `versions[${index}].files`);
}

function validateStateEvalSnapshot(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `evals[${index}]`);
  readRequiredString(record.hash, `evals[${index}].hash`);
  validateStateSurfaceFiles(record.files, `evals[${index}].files`);
  readStateArray<WorkbenchEvalCaseSnapshot>(record.cases, `evals[${index}].cases`, (entry, caseIndex) =>
    validateStateEvalCaseSnapshot(entry, index, caseIndex)
  );
  readRequiredNumber(record.caseCount, `evals[${index}].caseCount`);
  readRequiredString(record.createdAt, `evals[${index}].createdAt`);
  readRequiredString(record.updatedAt, `evals[${index}].updatedAt`);
  validateStateGradePlan(record.grade, `evals[${index}].grade`);
  readRequiredArray(record.gradeAdapters, `evals[${index}].gradeAdapters`).forEach((entry, adapterIndex) => {
    validateStateGradeAdapterOption(entry, `evals[${index}].gradeAdapters[${adapterIndex}]`);
  });
}

function validateStateEvalCaseSnapshot(value: unknown, evalIndex: number, caseIndex: number): void {
  const pathLabel = `evals[${evalIndex}].cases[${caseIndex}]`;
  const record = readRequiredRecord(value, pathLabel);
  readRequiredString(record.id, `${pathLabel}.id`);
  readRequiredString(record.path, `${pathLabel}.path`);
  for (const key of ["description", "command"]) {
    if (record[key] !== undefined) {
      readRequiredString(record[key], `${pathLabel}.${key}`);
    }
  }
  validateStateGradePlan(record.grade, `${pathLabel}.grade`);
  validateStateSurfaceFiles(record.files, `${pathLabel}.files`);
}

function validateStateGradePlan(value: unknown, pathLabel: string): void {
  const record = readRequiredRecord(value, pathLabel);
  readRequiredString(record.adapter, `${pathLabel}.adapter`);
  const adapterSource = readRequiredString(record.adapterSource, `${pathLabel}.adapterSource`);
  if (adapterSource !== "eval" && adapterSource !== "case") {
    throw new WorkbenchStateValidationError(`${pathLabel}.adapterSource must be eval or case.`);
  }
  readRequiredString(record.label, `${pathLabel}.label`);
  readRequiredString(record.summary, `${pathLabel}.summary`);
  readRequiredArray(record.sources, `${pathLabel}.sources`).forEach((entry, index) => {
    const source = readRequiredRecord(entry, `${pathLabel}.sources[${index}]`);
    readRequiredString(source.path, `${pathLabel}.sources[${index}].path`);
    readRequiredString(source.role, `${pathLabel}.sources[${index}].role`);
    if (source.note !== undefined) {
      readRequiredString(source.note, `${pathLabel}.sources[${index}].note`);
    }
  });
  readRequiredArray(record.display, `${pathLabel}.display`).forEach((entry, index) => {
    validateStateGradePlanDisplayBlock(entry, `${pathLabel}.display[${index}]`);
  });
  readRequiredArray(record.authoring, `${pathLabel}.authoring`).forEach((entry, index) => {
    validateStateGradePlanAuthoringControl(entry, `${pathLabel}.authoring[${index}]`);
  });
}

function validateStateGradeAdapterOption(value: unknown, pathLabel: string): void {
  const record = readRequiredRecord(value, pathLabel);
  readRequiredString(record.adapter, `${pathLabel}.adapter`);
  readRequiredString(record.label, `${pathLabel}.label`);
  readRequiredArray(record.authoring, `${pathLabel}.authoring`).forEach((entry, index) => {
    validateStateGradePlanAuthoringControl(entry, `${pathLabel}.authoring[${index}]`);
  });
}

function validateStateGradePlanDisplayBlock(value: unknown, pathLabel: string): void {
  const record = readRequiredRecord(value, pathLabel);
  const kind = readRequiredString(record.kind, `${pathLabel}.kind`);
  if (record.title !== undefined) {
    readRequiredString(record.title, `${pathLabel}.title`);
  }
  if (kind === "text") {
    readRequiredString(record.text, `${pathLabel}.text`);
    return;
  }
  if (kind === "key_value") {
    readRequiredArray(record.items, `${pathLabel}.items`).forEach((entry, index) => {
      const item = readRequiredRecord(entry, `${pathLabel}.items[${index}]`);
      readRequiredString(item.label, `${pathLabel}.items[${index}].label`);
      readRequiredString(item.value, `${pathLabel}.items[${index}].value`);
    });
    return;
  }
  if (kind === "list") {
    readRequiredArray(record.items, `${pathLabel}.items`).forEach((entry, index) => {
      const item = readRequiredRecord(entry, `${pathLabel}.items[${index}]`);
      readRequiredString(item.label, `${pathLabel}.items[${index}].label`);
      for (const key of ["description", "meta"]) {
        if (item[key] !== undefined) {
          readRequiredString(item[key], `${pathLabel}.items[${index}].${key}`);
        }
      }
    });
    return;
  }
  if (kind === "files") {
    readRequiredArray(record.files, `${pathLabel}.files`).forEach((entry, index) => {
      const file = readRequiredRecord(entry, `${pathLabel}.files[${index}]`);
      readRequiredString(file.path, `${pathLabel}.files[${index}].path`);
      if (file.role !== undefined) {
        readRequiredString(file.role, `${pathLabel}.files[${index}].role`);
      }
    });
    return;
  }
  throw new WorkbenchStateValidationError(`${pathLabel}.kind is unsupported: ${kind}`);
}

function validateStateGradePlanAuthoringControl(value: unknown, pathLabel: string): void {
  const { kind, record } = readStateGradePlanAuthoringField(value, pathLabel);
  if (kind === "notice") {
    readRequiredString(record.message, `${pathLabel}.message`);
    return;
  }
  if (kind === "text") {
    validateStateGradePlanAuthoringText(record, pathLabel);
    return;
  }
  if (kind === "list") {
    if (record.itemLabel !== undefined) {
      readRequiredString(record.itemLabel, `${pathLabel}.itemLabel`);
    }
    if (record.minItems !== undefined) {
      readRequiredNumber(record.minItems, `${pathLabel}.minItems`);
    }
    if (record.maxItems !== undefined) {
      readRequiredNumber(record.maxItems, `${pathLabel}.maxItems`);
    }
    readRequiredArray(record.fields, `${pathLabel}.fields`).forEach((entry, index) => {
      validateStateGradePlanAuthoringListField(entry, `${pathLabel}.fields[${index}]`);
    });
    if (record.defaultItems !== undefined) {
      readRequiredArray(record.defaultItems, `${pathLabel}.defaultItems`).forEach((entry, index) => {
        readRequiredRecord(entry, `${pathLabel}.defaultItems[${index}]`);
      });
    }
    return;
  }
  if (kind === "choice") {
    validateStateGradePlanAuthoringChoice(record, pathLabel);
    return;
  }
  if (kind === "file") {
    readRequiredString(record.path, `${pathLabel}.path`);
    if (record.language !== undefined) {
      readRequiredString(record.language, `${pathLabel}.language`);
    }
    if (record.defaultValue !== undefined) {
      readRequiredString(record.defaultValue, `${pathLabel}.defaultValue`);
    }
    if (record.executable !== undefined) {
      readRequiredBoolean(record.executable, `${pathLabel}.executable`);
    }
    return;
  }
  throw new WorkbenchStateValidationError(`${pathLabel}.kind is unsupported: ${kind}`);
}

function validateStateGradePlanAuthoringListField(value: unknown, pathLabel: string): void {
  const { kind, record } = readStateGradePlanAuthoringField(value, pathLabel);
  if (kind === "text") {
    validateStateGradePlanAuthoringText(record, pathLabel);
    return;
  }
  if (kind === "number") {
    for (const key of ["defaultValue", "min", "max", "step"]) {
      if (record[key] !== undefined) {
        readRequiredNumber(record[key], `${pathLabel}.${key}`);
      }
    }
    return;
  }
  if (kind === "choice") {
    validateStateGradePlanAuthoringChoice(record, pathLabel);
    return;
  }
  throw new WorkbenchStateValidationError(`${pathLabel}.kind is unsupported: ${kind}`);
}

function readStateGradePlanAuthoringField(value: unknown, pathLabel: string) {
  const record = readRequiredRecord(value, pathLabel);
  const kind = readRequiredString(record.kind, `${pathLabel}.kind`);
  readRequiredString(record.name, `${pathLabel}.name`);
  readRequiredString(record.label, `${pathLabel}.label`);
  if (record.description !== undefined) {
    readRequiredString(record.description, `${pathLabel}.description`);
  }
  if (record.required !== undefined) {
    readRequiredBoolean(record.required, `${pathLabel}.required`);
  }
  return { kind, record };
}

function validateStateGradePlanAuthoringText(record: Record<string, unknown>, pathLabel: string): void {
  if (record.placeholder !== undefined) {
    readRequiredString(record.placeholder, `${pathLabel}.placeholder`);
  }
  if (record.defaultValue !== undefined) {
    readRequiredString(record.defaultValue, `${pathLabel}.defaultValue`);
  }
  if (record.multiline !== undefined) {
    readRequiredBoolean(record.multiline, `${pathLabel}.multiline`);
  }
}

function validateStateGradePlanAuthoringChoice(record: Record<string, unknown>, pathLabel: string): void {
  validateStateGradePlanAuthoringOptions(record.options, `${pathLabel}.options`);
  if (record.defaultValue !== undefined) {
    readRequiredString(record.defaultValue, `${pathLabel}.defaultValue`);
  }
}

function validateStateGradePlanAuthoringOptions(value: unknown, pathLabel: string): void {
  readRequiredArray(value, pathLabel).forEach((entry, index) => {
    const option = readRequiredRecord(entry, `${pathLabel}[${index}]`);
    readRequiredString(option.value, `${pathLabel}[${index}].value`);
    readRequiredString(option.label, `${pathLabel}[${index}].label`);
    if (option.description !== undefined) {
      readRequiredString(option.description, `${pathLabel}[${index}].description`);
    }
  });
}

function validateStateSkillSource(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `skillSources[${index}]`);
  readRequiredString(record.name, `skillSources[${index}].name`);
  readRequiredString(record.kind, `skillSources[${index}].kind`);
  for (const key of ["path", "from", "ref", "resolvedRef", "hash"]) {
    if (record[key] !== undefined) {
      readRequiredString(record[key], `skillSources[${index}].${key}`);
    }
  }
  if (record.includes !== undefined) {
    readRequiredArray(record.includes, `skillSources[${index}].includes`)
      .forEach((entry, includeIndex) => validateStateSkillInclude(entry, `skillSources[${index}].includes[${includeIndex}]`));
  }
}

function validateStateSkillInclude(value: unknown, pathLabel: string): void {
  const record = readRequiredRecord(value, pathLabel);
  readRequiredString(record.name, `${pathLabel}.name`);
  readRequiredString(record.kind, `${pathLabel}.kind`);
  for (const key of ["path", "from", "ref", "resolvedRef", "hash"]) {
    if (record[key] !== undefined) {
      readRequiredString(record[key], `${pathLabel}.${key}`);
    }
  }
  if (record.files !== undefined) {
    validateStateSurfaceFiles(record.files, `${pathLabel}.files`);
  }
}

function validateStateSkillBundle(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `skillBundles[${index}]`);
  readRequiredString(record.hash, `skillBundles[${index}].hash`);
  readRequiredString(record.skillName, `skillBundles[${index}].skillName`);
  readRequiredString(record.entryName, `skillBundles[${index}].entryName`);
  validateStateSkillSource(record.source, index);
  validateStateSurfaceFiles(record.files, `skillBundles[${index}].files`);
  readRequiredArray(record.includedSkills, `skillBundles[${index}].includedSkills`)
    .forEach((entry, includeIndex) => validateStateSkillInclude(entry, `skillBundles[${index}].includedSkills[${includeIndex}]`));
  readRequiredString(record.createdAt, `skillBundles[${index}].createdAt`);
}

function validateStateAgent(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `agents[${index}]`);
  readRequiredString(record.name, `agents[${index}].name`);
  readRequiredString(record.adapter, `agents[${index}].adapter`);
  if (record.model !== undefined) {
    readRequiredString(record.model, `agents[${index}].model`);
  }
  readJsonRecord(record.config, `agents[${index}].config`);
}

function validateStateRun(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `runs[${index}]`);
  for (const key of ["id", "kind", "versionId", "skillName", "skillBundleHash", "evalHash", "agentName", "agentHash", "status", "createdAt"]) {
    readRequiredString(record[key], `runs[${index}].${key}`);
  }
  if (record.operationPlan !== undefined) {
    validateStateRunOperationPlan(record.operationPlan, `runs[${index}].operationPlan`);
  }
  readStringArray(record.jobIds, `runs[${index}].jobIds`);
  readStringArray(record.traceIds, `runs[${index}].traceIds`);
  for (const key of ["finishedAt", "parentRunId", "location", "remoteName", "baseVersionId", "retryOfRunId", "cancelRequestedAt", "lastProgressAt", "outputVersionId", "error"]) {
    if (record[key] !== undefined) {
      readRequiredString(record[key], `runs[${index}].${key}`);
    }
  }
  if (record.location !== undefined && record.location !== "local" && record.location !== "cloud") {
    throw new WorkbenchStateValidationError(`Workbench state field runs[${index}].location must be local or cloud.`);
  }
  if (record.requestedSamples !== undefined) {
    readRequiredNumber(record.requestedSamples, `runs[${index}].requestedSamples`);
  }
  if (record.requestedBudget !== undefined) {
    readRequiredNumber(record.requestedBudget, `runs[${index}].requestedBudget`);
  }
}

function validateStateRunOperationPlan(value: unknown, pathLabel: string): void {
  const record = readRequiredRecord(value, pathLabel);
  readRequiredString(record.kind, `${pathLabel}.kind`);
  if (!isWorkbenchRunKind(record.kind)) {
    throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel}.kind must be run, grade, eval, or improve.`);
  }
  readRequiredString(record.variant, `${pathLabel}.variant`);
  if (record.variant !== "local" && record.variant !== "cloud") {
    throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel}.variant must be local or cloud.`);
  }
  if (record.versionId !== undefined) {
    readRequiredString(record.versionId, `${pathLabel}.versionId`);
  }
  if (record.evalHash !== undefined) {
    readRequiredString(record.evalHash, `${pathLabel}.evalHash`);
  }
  readStringArray(record.skills, `${pathLabel}.skills`);
  readStringArray(record.agents, `${pathLabel}.agents`);
  if (record.caseIds !== undefined) {
    readStringArray(record.caseIds, `${pathLabel}.caseIds`);
  }
  if (record.samples !== undefined) {
    readRequiredNumber(record.samples, `${pathLabel}.samples`);
  }
  if (record.budget !== undefined) {
    readRequiredNumber(record.budget, `${pathLabel}.budget`);
  }
  if (record.rerun !== undefined && typeof record.rerun !== "boolean") {
    throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel}.rerun must be a boolean.`);
  }
  if (record.retryOfRunId !== undefined) {
    readRequiredString(record.retryOfRunId, `${pathLabel}.retryOfRunId`);
  }
}

function isWorkbenchRunKind(value: unknown): boolean {
  return value === "run" || value === "grade" || value === "eval" || value === "improve";
}

function validateStateJob(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `jobs[${index}]`);
  for (const key of ["id", "runId", "kind", "role", "inputHash", "versionId", "skillName", "skillBundleHash", "evalHash", "agentName", "agentHash", "caseId", "status", "createdAt"]) {
    readRequiredString(record[key], `jobs[${index}].${key}`);
  }
  readRequiredNumber(record.sample, `jobs[${index}].sample`);
  if (record.durationMs !== undefined) {
    readRequiredNumber(record.durationMs, `jobs[${index}].durationMs`);
  }
  readStringArray(record.artifactIds, `jobs[${index}].artifactIds`);
  readStringArray(record.traceIds, `jobs[${index}].traceIds`);
  for (const key of ["command", "startedAt", "finishedAt", "error"]) {
    if (record[key] !== undefined) {
      readRequiredString(record[key], `jobs[${index}].${key}`);
    }
  }
}

function validateStateTrace(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `traces[${index}]`);
  for (const key of ["id", "runId", "versionId", "skillName", "skillBundleHash", "agentName", "createdAt"]) {
    readRequiredString(record[key], `traces[${index}].${key}`);
  }
  if (record.jobId !== undefined) {
    readRequiredString(record.jobId, `traces[${index}].jobId`);
  }
  readRequiredJson(record.request, `traces[${index}].request`);
  readRequiredJson(record.result, `traces[${index}].result`);
  validateStateSurfaceFiles(record.files, `traces[${index}].files`);
}

function validateStateExecutionEventBatch(value: unknown, index: number): void {
  const pathLabel = `executionEvents[${index}]`;
  const record = readRequiredRecord(value, pathLabel);
  for (const key of ["projectId", "runId", "jobId", "executionId", "emittedAt"]) {
    readRequiredString(record[key], `${pathLabel}.${key}`);
  }
  for (const key of ["attempt", "seqStart", "seqEnd"]) {
    readRequiredNumber(record[key], `${pathLabel}.${key}`);
  }
  readRequiredArray(record.events, `${pathLabel}.events`)
    .forEach((entry, eventIndex) => validateStateExecutionEvent(entry, `${pathLabel}.events[${eventIndex}]`));
}

function validateStateExecutionEvent(value: unknown, pathLabel: string): void {
  const record = readRequiredRecord(value, pathLabel);
  readRequiredNumber(record.seq, `${pathLabel}.seq`);
  readRequiredString(record.at, `${pathLabel}.at`);
  const source = readRequiredString(record.source, `${pathLabel}.source`);
  if (source !== "sandbox" && source !== "adapter" && source !== "command") {
    throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel}.source must be sandbox, adapter, or command.`);
  }
  if (record.role !== undefined) {
    const role = readRequiredString(record.role, `${pathLabel}.role`);
    if (role !== "improver" && role !== "runner" && role !== "engine") {
      throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel}.role must be improver, runner, or engine.`);
    }
  }
  const schema = readRequiredString(record.schema, `${pathLabel}.schema`);
  if (schema !== "workbench.execution.step.v1" && schema !== "workbench.trace.delta.v1") {
    throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel}.schema must be a supported execution event schema.`);
  }
  readRequiredJson(record.payload, `${pathLabel}.payload`);
}

function validateStateArtifact(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `artifacts[${index}]`);
  for (const key of ["id", "runId", "jobId", "createdAt"]) {
    readRequiredString(record[key], `artifacts[${index}].${key}`);
  }
  validateStateSurfaceFiles(record.files, `artifacts[${index}].files`);
}

function validateStateLineageEdge(value: unknown, index: number): void {
  const record = readRequiredRecord(value, `lineage[${index}]`);
  for (const key of ["parentId", "childId", "reason", "createdAt"]) {
    readRequiredString(record[key], `lineage[${index}].${key}`);
  }
  if (!["version", "improve"].includes(record.reason as string)) {
    throw new WorkbenchStateValidationError(`Workbench state field lineage[${index}].reason must be version or improve.`);
  }
  if (record.runId !== undefined) {
    readRequiredString(record.runId, `lineage[${index}].runId`);
  }
  if (record.message !== undefined) {
    readRequiredString(record.message, `lineage[${index}].message`);
  }
}

function validateStateSurfaceFiles(value: unknown, pathLabel: string): void {
  readRequiredArray(value, pathLabel).forEach((entry, index) => {
    const record = readRequiredRecord(entry, `${pathLabel}[${index}]`);
    const filePath = readRequiredString(record.path, `${pathLabel}[${index}].path`);
    try {
      normalizeWorkbenchSourcePath(filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel}[${index}].path is invalid: ${message}`);
    }
    readRequiredStringContent(record.content, `${pathLabel}[${index}].content`);
    if (record.kind !== undefined && record.kind !== "text" && record.kind !== "binary") {
      throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel}[${index}].kind must be text or binary.`);
    }
    if (record.encoding !== undefined && record.encoding !== "utf8" && record.encoding !== "base64") {
      throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel}[${index}].encoding must be utf8 or base64.`);
    }
    if (record.executable !== undefined) {
      readRequiredBoolean(record.executable, `${pathLabel}[${index}].executable`);
    }
  });
}

function readJsonRecord(value: unknown, pathLabel: string): Record<string, Json> {
  const record = readRequiredRecord(value, pathLabel);
  for (const [key, entry] of Object.entries(record)) {
    readRequiredJson(entry, `${pathLabel}.${key}`);
  }
  return record as Record<string, Json>;
}

function readRequiredJson(value: unknown, pathLabel: string): Json {
  if (!isWorkbenchJson(value)) {
    throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel} must be JSON.`);
  }
  return value;
}

function readStringArray(value: unknown, pathLabel: string): string[] {
  return readRequiredArray(value, pathLabel).map((entry, index) =>
    readRequiredString(entry, `${pathLabel}[${index}]`)
  );
}

function readRequiredArray(value: unknown, pathLabel: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel} must be an array.`);
  }
  return value;
}

function readRequiredRecord(value: unknown, pathLabel: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown, pathLabel: string): string {
  if (typeof value !== "string" || !value) {
    throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel} must be a non-empty string.`);
  }
  return value;
}

function readRequiredStringContent(value: unknown, pathLabel: string): string {
  if (typeof value !== "string") {
    throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel} must be a string.`);
  }
  return value;
}

function readRequiredNumber(value: unknown, pathLabel: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel} must be a finite number.`);
  }
  return value;
}

function readRequiredBoolean(value: unknown, pathLabel: string): boolean {
  if (typeof value !== "boolean") {
    throw new WorkbenchStateValidationError(`Workbench state field ${pathLabel} must be a boolean.`);
  }
  return value;
}
