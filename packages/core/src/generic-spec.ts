import { createHash } from "node:crypto";
import {
  isWorkbenchExecutionNetworkEgress,
  type EngineResolveBinding,
  type Json,
  type SurfaceSnapshotFile,
  type WorkbenchAdapterInvocation,
  type WorkbenchExecutionNetworkPolicy,
  type WorkbenchExecutionResources,
  type WorkbenchSpecValidation,
} from "@workbench-ai/workbench-contract";
import type {
  WorkbenchEngineCase,
  WorkbenchEngineCaseSpec,
} from "@workbench-ai/workbench-protocol";
import YAML from "yaml";

export const EVAL_SPEC_FILE = "eval.yaml";
export const SKILL_SPEC_FILE = "skill.yaml";

export interface WorkbenchRuntimeSpec {
  dockerfile: string;
  workdir?: string;
  resources?: {
    cpu?: number;
    memoryGb?: number;
    diskGb?: number;
    timeoutMinutes?: number;
  };
  network?: WorkbenchExecutionNetworkPolicy;
}

export interface WorkbenchPathRef {
  path: string;
}

export interface WorkbenchSkillPrepareSpec {
  command: string;
}

export interface AuthoredEvalSpec {
  version: 4;
  name: string;
  description: string;
  adapters: string[];
  engine: WorkbenchAdapterInvocation;
}

export interface WorkbenchSkillAgentSpec extends WorkbenchAdapterInvocation {
  name: string;
}

export interface WorkbenchCaseSelector {
  all?: true;
  split?: string;
}

export interface WorkbenchSelectionSpec {
  metric: string;
  cases?: WorkbenchCaseSelector;
}

export interface WorkbenchSkillImproveSpec extends WorkbenchAdapterInvocation {
  edits: string[];
  optimizeOn?: WorkbenchCaseSelector;
  selectBy?: WorkbenchSelectionSpec;
}

export interface WorkbenchSkillManifestSpec {
  version: 4;
  name: string;
  description?: string;
  files: WorkbenchPathRef;
  prepare?: WorkbenchSkillPrepareSpec;
  adapters: string[];
  defaultAgent?: string;
  agents: Record<string, WorkbenchSkillAgentSpec>;
  improve?: WorkbenchSkillImproveSpec;
}

export interface ResolvedSkillSpec extends WorkbenchSkillManifestSpec {
  selectedAgentId: string;
}

export interface WorkbenchResolvedSource {
  version: 4;
  eval: AuthoredEvalSpec;
  skill: ResolvedSkillSpec;
}

export interface GenericRunSpec {
  version: 4;
  name: string;
  description: string;
  eval: {
    name: string;
    description: string;
    engine: WorkbenchAdapterInvocation;
  };
  skill: {
    name: string;
    description?: string;
    files: WorkbenchPathRef;
    prepare?: WorkbenchSkillPrepareSpec;
    defaultAgent: string;
    selectedAgentId: string;
    selectedAgentName: string;
    agents: Record<string, WorkbenchSkillAgentSpec>;
    improve?: {
      edits: string[];
      optimizeOn?: WorkbenchCaseSelector;
      selectBy?: WorkbenchSelectionSpec;
    };
  };
  environment: WorkbenchRuntimeSpec;
  adapters: string[];
  engine: WorkbenchAdapterInvocation;
  engineResolve: WorkbenchAdapterInvocation;
  improve?: WorkbenchAdapterInvocation;
  run: WorkbenchAdapterInvocation;
  engineRun: WorkbenchAdapterInvocation;
}

export type GenericEngineCaseSpec = WorkbenchEngineCaseSpec;
export type { WorkbenchEngineCase } from "@workbench-ai/workbench-protocol";

export interface ResolvedEngineCaseExecutionConfig {
  prompt: string;
  environment: WorkbenchRuntimeSpec;
  run: WorkbenchAdapterInvocation;
}

interface WorkbenchAdapterEnvelopeSpec {
  use: string;
  with?: Record<string, Json>;
  auth?: Json;
}

export const DEFAULT_EXECUTION_RESOURCES: WorkbenchExecutionResources = {
  cpu: 2,
  memoryGb: 4,
  diskGb: 10,
  timeoutMinutes: 20,
};

export function validateWorkbenchResolvedSourceYaml(
  source: string,
): WorkbenchSpecValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const trimmed = source.trim();
  if (!trimmed) {
    errors.push("Resolved Workbench spec cannot be empty.");
  }
  if (trimmed) {
    try {
      resolveWorkbenchResolvedSourceYaml(source);
    } catch (error) {
      errors.push(...splitErrorMessage(error));
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function resolveWorkbenchResolvedSourceYaml(
  source: string,
): GenericRunSpec {
  const parsed = parseYamlRecord(source, "resolved Workbench spec");
  const errors: string[] = [];
  rejectUnknownKeys(parsed, "resolved Workbench spec", [
    "version",
    "eval",
    "skill",
  ], errors);
  if (parsed.version !== 4) {
    throw new Error("Resolved Workbench spec version must be 4.");
  }
  const evalSpec = normalizeEvalRecord(
    readRequiredRecord(parsed.eval, EVAL_SPEC_FILE, errors),
    EVAL_SPEC_FILE,
    "resolved",
    errors,
  );
  const skill = normalizeSkillRecord(
    readRequiredRecord(parsed.skill, "resolved Workbench spec.skill", errors),
    "resolved Workbench spec.skill",
    "resolved",
    errors,
  );
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return genericSpecFromAuthoredBundle({
    version: 4,
    eval: evalSpec!,
    skill: skill!,
  });
}

export function engineResolveBindingForSourceYaml(
  source: string,
): EngineResolveBinding {
  return engineResolveBindingForSpec(resolveWorkbenchResolvedSourceYaml(source));
}

export function engineResolveBindingForSpec(
  spec: GenericRunSpec,
): EngineResolveBinding {
  const resolver = engineResolveInvocationForSpec(spec);
  return {
    engine: spec.eval.engine.use,
    resolver: {
      use: resolver.use,
      withFingerprint: fingerprintJson(resolver.with ?? {}),
    },
  };
}

export function resolveWorkbenchSourceFiles(args: {
  evalSource: string;
  skillSource: string;
  selectedAgentId?: string | null;
}): GenericRunSpec {
  return genericSpecFromAuthoredBundle(parseWorkbenchSourceFiles({
    evalSource: args.evalSource,
    skillSource: args.skillSource,
    selectedAgentId: args.selectedAgentId,
  }));
}

export function parseWorkbenchSourceFiles(args: {
  evalSource: string;
  skillSource?: string;
  selectedAgentId?: string | null;
}): WorkbenchResolvedSource {
  const errors: string[] = [];
  const evalSpec = normalizeEvalRecord(
    parseYamlRecord(args.evalSource, EVAL_SPEC_FILE),
    EVAL_SPEC_FILE,
    "authored",
    errors,
  );
  const skill = normalizeSkillRecord(
    parseYamlRecord(args.skillSource ?? "", "skill YAML"),
    "skill YAML",
    "authored",
    errors,
    args.selectedAgentId ?? undefined,
  );
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return {
    version: 4,
    eval: evalSpec!,
    skill: skill!,
  };
}

export function serializeWorkbenchResolvedSourceYaml(
  source: WorkbenchResolvedSource,
): string {
  return YAML.stringify(source).trimEnd() + "\n";
}

export function isWorkbenchSkillManifestPath(filePath: string): boolean {
  return /^skills\/[^/]+\/skill\.ya?ml$/iu.test(
    filePath.replace(/\\/gu, "/").replace(/^\/+/u, "").replace(/^(?:\.\/)+/u, ""),
  );
}

export function resolveEngineCaseExecutionConfig(args: {
  spec: GenericRunSpec;
  engineCase: GenericEngineCaseSpec;
}): ResolvedEngineCaseExecutionConfig {
  return {
    prompt: args.engineCase.prompt,
    environment: mergeRuntime(args.spec.environment, args.engineCase.environment),
    run: args.spec.run,
  };
}

export function engineResolveInvocationForSpec(spec: GenericRunSpec): WorkbenchAdapterInvocation {
  return spec.engineResolve;
}

export function engineCaseFilesForRuntimeInput(args: {
  spec: GenericRunSpec;
  engineCase: WorkbenchEngineCase;
}): SurfaceSnapshotFile[] {
  void args.spec;
  return engineCasePublicFiles(args.engineCase);
}

export function engineCasePublicFiles(
  engineCase: WorkbenchEngineCase,
): SurfaceSnapshotFile[] {
  return (engineCase.files.public ?? [])
    .map((file) => ({ ...file }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function engineCasePrivateFiles(
  engineCase: WorkbenchEngineCase,
): SurfaceSnapshotFile[] {
  return (engineCase.files.private ?? [])
    .map((file) => ({ ...file }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function runtimeResources(
  runtime: WorkbenchRuntimeSpec,
): WorkbenchExecutionResources {
  const resources = runtime.resources ?? {};
  return {
    cpu: readPositiveNumber(resources.cpu, DEFAULT_EXECUTION_RESOURCES.cpu),
    memoryGb: readPositiveNumber(
      resources.memoryGb,
      DEFAULT_EXECUTION_RESOURCES.memoryGb,
    ),
    diskGb: readPositiveNumber(
      resources.diskGb,
      DEFAULT_EXECUTION_RESOURCES.diskGb,
    ),
    timeoutMinutes: readPositiveNumber(
      resources.timeoutMinutes,
      DEFAULT_EXECUTION_RESOURCES.timeoutMinutes,
    ),
  };
}

export function runtimeNetwork(
  runtime: WorkbenchRuntimeSpec,
): WorkbenchExecutionNetworkPolicy {
  return runtime.network ?? { egress: "open" };
}

export function runtimeSandboxRef(runtime: WorkbenchRuntimeSpec): string {
  return `dockerfile://${runtime.dockerfile}`;
}

function genericSpecFromAuthoredBundle(
  source: WorkbenchResolvedSource,
): GenericRunSpec {
  const engineRuntime = engineRuntimeFromConfig(source.eval.engine);
  const engineRun = cloneEngineInvocation(source.eval.engine);
  const engineResolve = cloneEngineInvocation(source.eval.engine);
  const skill = source.skill;
  const selectedAgent = skill.agents[skill.selectedAgentId];
  if (!selectedAgent) {
    throw new Error(`Skill agent not found: ${skill.selectedAgentId}`);
  }
  return {
    version: 4,
    name: source.eval.name,
    description: source.eval.description,
    eval: {
      name: source.eval.name,
      description: source.eval.description,
      engine: cloneJson(source.eval.engine),
    },
    skill: {
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
      files: cloneJson(skill.files),
      ...(skill.prepare ? { prepare: cloneJson(skill.prepare) } : {}),
      defaultAgent: skill.defaultAgent ?? skill.selectedAgentId,
      selectedAgentId: skill.selectedAgentId,
      selectedAgentName: selectedAgent.name,
      agents: cloneJson(skill.agents),
      ...(skill.improve
        ? {
            improve: {
              edits: [...skill.improve.edits],
              ...(skill.improve.optimizeOn ? { optimizeOn: cloneJson(skill.improve.optimizeOn) } : {}),
              ...(skill.improve.selectBy ? { selectBy: cloneJson(skill.improve.selectBy) } : {}),
            },
          }
        : {}),
    },
    environment: cloneJson(engineRuntime),
    adapters: [
      ...new Set([
        ...source.eval.adapters,
        ...skill.adapters,
      ]),
    ],
    engine: cloneJson(source.eval.engine),
    engineResolve: cloneJson(engineResolve),
    ...(skill.improve ? { improve: clonePhaseAdapter(skill.improve) } : {}),
    run: clonePhaseAdapter(selectedAgent),
    engineRun: cloneJson(engineRun),
  };
}

function normalizeEvalRecord(
  record: Record<string, unknown> | null,
  label: string,
  mode: "authored" | "resolved",
  errors: string[],
): AuthoredEvalSpec | null {
  if (!record) {
    return null;
  }
  rejectUnknownKeys(record, label, [
    "version",
    "name",
    "description",
    "adapters",
    "engine",
  ], errors);
  requireSpecVersion(record.version, label, mode === "authored" ? 1 : 4, errors);
  const name = readRequiredString(record.name, `${label}.name`, errors);
  const description = readRequiredString(record.description, `${label}.description`, errors);
  const adapters = normalizeAdapterSources(record.adapters, `${label}.adapters`, errors);
  const engine = normalizePhaseAdapter(record.engine, `${label}.engine`, errors);
  if (engine) {
    normalizeEngineRuntimeConfig(engine, `${label}.engine.with`, errors);
  }
  return name && description && engine
    ? {
        version: 4,
        name,
        description,
        adapters,
        engine,
      }
    : null;
}

function normalizeEngineRuntimeConfig(
  engine: WorkbenchAdapterInvocation,
  label: string,
  errors: string[],
): void {
  const config = engine.with && typeof engine.with === "object" && !Array.isArray(engine.with)
    ? engine.with as Record<string, Json>
    : {};
  if (config.environment !== undefined) {
    const environment = normalizeRuntime(config.environment, `${label}.environment`, errors);
    if (environment) {
      config.environment = environment as unknown as Json;
      engine.with = config;
    }
  }
}

function normalizeSkillRecord(
  record: Record<string, unknown> | null,
  label: string,
  mode: "authored" | "resolved",
  errors: string[],
  selectedAgentId?: string,
): ResolvedSkillSpec | null {
  if (!record) {
    return null;
  }
  rejectUnknownKeys(record, label, [
    "version",
    "name",
    "description",
    "files",
    "prepare",
    "adapters",
    "defaultAgent",
    "agents",
    ...(mode === "resolved" ? ["selectedAgentId"] : []),
    "improve",
  ], errors);
  requireSpecVersion(record.version, label, mode === "authored" ? 1 : 4, errors);
  const name = readRequiredString(record.name, `${label}.name`, errors);
  const description = readOptionalString(record.description, `${label}.description`, errors);
  const files = normalizePathRef(record.files, `${label}.files`, errors);
  const prepare = normalizeSkillPrepare(record.prepare, `${label}.prepare`, errors);
  const adapters = normalizeAdapterSources(record.adapters, `${label}.adapters`, errors);
  const agents = normalizeSkillAgents(
    record.agents,
    `${label}.agents`,
    errors,
  );
  const defaultAgent = readOptionalString(
    record.defaultAgent,
    `${label}.defaultAgent`,
    errors,
  );
  const embeddedSelectedAgent = mode === "resolved"
    ? readOptionalString(record.selectedAgentId, `${label}.selectedAgentId`, errors)
    : undefined;
  const selected = selectedAgentId ?? embeddedSelectedAgent ?? defaultAgent ?? Object.keys(agents).sort()[0];
  if (selected && !agents[selected]) {
    errors.push(`${label}.${mode === "authored" ? "defaultAgent" : "selectedAgentId"} references unknown agent ${selected}.`);
  }
  const improve = normalizeSkillImprove(record.improve, `${label}.improve`, errors);
  return name && files && selected && Object.keys(agents).length > 0
    ? {
        version: 4,
        name,
        ...(description ? { description } : {}),
        files,
        ...(prepare ? { prepare } : {}),
        adapters,
        ...(defaultAgent ? { defaultAgent } : {}),
        agents,
        ...(improve ? { improve } : {}),
        selectedAgentId: selected,
      }
    : null;
}

function normalizeSkillPrepare(
  value: unknown,
  label: string,
  errors: string[],
): WorkbenchSkillPrepareSpec | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = readRequiredRecord(value, label, errors);
  if (!record) {
    return undefined;
  }
  rejectUnknownKeys(record, label, ["command"], errors);
  const command = readRequiredString(record.command, `${label}.command`, errors);
  return command ? { command } : undefined;
}

function normalizeSkillAgents(
  value: unknown,
  label: string,
  errors: string[],
): Record<string, WorkbenchSkillAgentSpec> {
  const record = readRequiredRecord(value, label, errors);
  if (!record) {
    return {};
  }
  const agents: Record<string, WorkbenchSkillAgentSpec> = {};
  for (const [agentId, agentValue] of Object.entries(record).sort(([left], [right]) => left.localeCompare(right))) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(agentId)) {
      errors.push(`${label}.${agentId} must use letters, numbers, dots, underscores, or dashes.`);
      continue;
    }
    const agentRecord = readRequiredRecord(agentValue, `${label}.${agentId}`, errors);
    if (!agentRecord) {
      continue;
    }
    rejectUnknownKeys(agentRecord, `${label}.${agentId}`, ["name", "use", "with", "auth"], errors);
    const name = readRequiredString(agentRecord.name, `${label}.${agentId}.name`, errors);
    const invocation = normalizePhaseAdapter(adapterRecordFrom(agentRecord), `${label}.${agentId}`, errors);
    if (name && invocation) {
      agents[agentId] = {
        name,
        ...invocation,
      };
    }
  }
  if (Object.keys(agents).length === 0) {
    errors.push(`${label} must declare at least one agent.`);
  }
  return agents;
}

function normalizeSkillImprove(
  value: unknown,
  label: string,
  errors: string[],
): WorkbenchSkillImproveSpec | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = readRequiredRecord(value, label, errors);
  if (!record) {
    return undefined;
  }
  rejectUnknownKeys(record, label, ["edits", "use", "with", "auth", "optimizeOn", "selectBy"], errors);
  const edits = normalizeRelativePathList(record.edits, `${label}.edits`, errors);
  const invocation = normalizePhaseAdapter(adapterRecordFrom(record), label, errors);
  const optimizeOn = normalizeCaseSelector(record.optimizeOn, `${label}.optimizeOn`, errors);
  const selectBy = normalizeSelectionSpec(record.selectBy, `${label}.selectBy`, errors);
  return edits.length > 0 && invocation
    ? {
        ...invocation,
        edits,
        ...(optimizeOn ? { optimizeOn } : {}),
        ...(selectBy ? { selectBy } : {}),
      }
    : undefined;
}

function normalizeSelectionSpec(
  value: unknown,
  label: string,
  errors: string[],
): WorkbenchSelectionSpec | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = readRequiredRecord(value, label, errors);
  if (!record) {
    return undefined;
  }
  rejectUnknownKeys(record, label, ["metric", "cases"], errors);
  const metric = readRequiredString(record.metric, `${label}.metric`, errors);
  const cases = normalizeCaseSelector(record.cases, `${label}.cases`, errors);
  return metric
    ? {
        metric,
        ...(cases ? { cases } : {}),
      }
    : undefined;
}

function normalizeCaseSelector(
  value: unknown,
  label: string,
  errors: string[],
): WorkbenchCaseSelector | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = readRequiredRecord(value, label, errors);
  if (!record) {
    return undefined;
  }
  rejectUnknownKeys(record, label, ["all", "split"], errors);
  const hasAll = Object.prototype.hasOwnProperty.call(record, "all");
  const hasSplit = Object.prototype.hasOwnProperty.call(record, "split");
  if (hasAll && hasSplit) {
    errors.push(`${label} must specify either all or split, not both.`);
    return undefined;
  }
  if (!hasAll && !hasSplit) {
    errors.push(`${label} must specify all: true or split.`);
    return undefined;
  }
  if (hasAll) {
    if (record.all !== true) {
      errors.push(`${label}.all must be true when provided.`);
      return undefined;
    }
    return { all: true };
  }
  const split = readRequiredString(record.split, `${label}.split`, errors);
  return split ? { split } : undefined;
}

function adapterRecordFrom(record: Record<string, unknown>): Record<string, unknown> {
  return {
    use: record.use,
    ...(record.with !== undefined ? { with: record.with } : {}),
    ...(record.auth !== undefined ? { auth: record.auth } : {}),
  };
}

function requireSpecVersion(value: unknown, label: string, version: 1 | 4, errors: string[]): void {
  if (value !== version) {
    errors.push(`${label}.version must be ${version}.`);
  }
}

function normalizeRuntime(
  value: unknown,
  label: string,
  errors: string[],
): WorkbenchRuntimeSpec | null {
  const record = readRequiredRecord(value, label, errors);
  if (!record) {
    return null;
  }
  rejectUnknownKeys(record, label, ["dockerfile", "workdir", "resources", "network"], errors);
  const dockerfile = normalizeWorkspaceLiteralPath(
    record.dockerfile,
    `${label}.dockerfile`,
    errors,
  );
  const runtime: WorkbenchRuntimeSpec = {
    dockerfile: dockerfile ?? "environment/Dockerfile",
  };
  const workdir = readOptionalString(record.workdir, `${label}.workdir`, errors);
  if (workdir) {
    runtime.workdir = workdir;
  }
  if (record.resources !== undefined) {
    const resources = readRequiredRecord(record.resources, `${label}.resources`, errors);
    if (resources) {
      rejectUnknownKeys(resources, `${label}.resources`, [
        "cpu",
        "memoryGb",
        "diskGb",
        "timeoutMinutes",
      ], errors);
      readOptionalPositiveNumber(resources.cpu, `${label}.resources.cpu`, errors);
      readOptionalPositiveNumber(resources.memoryGb, `${label}.resources.memoryGb`, errors);
      readOptionalPositiveNumber(resources.diskGb, `${label}.resources.diskGb`, errors);
      readOptionalPositiveNumber(resources.timeoutMinutes, `${label}.resources.timeoutMinutes`, errors);
      runtime.resources = resources as WorkbenchRuntimeSpec["resources"];
    }
  }
  if (record.network !== undefined) {
    const network = readRequiredRecord(record.network, `${label}.network`, errors);
    if (network) {
      const normalized = normalizeNetworkConfig(network, `${label}.network`, errors);
      if (normalized) {
        runtime.network = normalized;
      }
    }
  }
  return runtime;
}

function normalizeRuntimeOverride(
  value: unknown,
  label: string,
  errors: string[],
): Partial<WorkbenchRuntimeSpec> | null {
  const record = readRequiredRecord(value, label, errors);
  if (!record) {
    return null;
  }
  rejectUnknownKeys(record, label, ["dockerfile", "workdir", "resources", "network"], errors);
  const runtime: Partial<WorkbenchRuntimeSpec> = {};
  if (record.dockerfile !== undefined) {
    const dockerfile = normalizeWorkspaceLiteralPath(record.dockerfile, `${label}.dockerfile`, errors);
    if (dockerfile) {
      runtime.dockerfile = dockerfile;
    }
  }
  const workdir = readOptionalString(record.workdir, `${label}.workdir`, errors);
  if (workdir) {
    runtime.workdir = workdir;
  }
  if (record.resources !== undefined) {
    const resources = readRequiredRecord(record.resources, `${label}.resources`, errors);
    if (resources) {
      rejectUnknownKeys(resources, `${label}.resources`, [
        "cpu",
        "memoryGb",
        "diskGb",
        "timeoutMinutes",
      ], errors);
      readOptionalPositiveNumber(resources.cpu, `${label}.resources.cpu`, errors);
      readOptionalPositiveNumber(resources.memoryGb, `${label}.resources.memoryGb`, errors);
      readOptionalPositiveNumber(resources.diskGb, `${label}.resources.diskGb`, errors);
      readOptionalPositiveNumber(resources.timeoutMinutes, `${label}.resources.timeoutMinutes`, errors);
      runtime.resources = resources as WorkbenchRuntimeSpec["resources"];
    }
  }
  if (record.network !== undefined) {
    const network = readRequiredRecord(record.network, `${label}.network`, errors);
    if (network) {
      const normalized = normalizeNetworkConfig(network, `${label}.network`, errors);
      if (normalized) {
        runtime.network = normalized;
      }
    }
  }
  return Object.keys(runtime).length > 0 ? runtime : null;
}

function engineRuntimeFromConfig(engine: WorkbenchAdapterInvocation): WorkbenchRuntimeSpec {
  const config = engine.with && typeof engine.with === "object" && !Array.isArray(engine.with)
    ? engine.with as Record<string, Json>
    : {};
  const environment = config.environment;
  if (environment && typeof environment === "object" && !Array.isArray(environment)) {
    const record = environment as Record<string, Json>;
    return {
      dockerfile: typeof record.dockerfile === "string" && record.dockerfile.trim()
        ? record.dockerfile
        : "environment/Dockerfile",
      ...(typeof record.workdir === "string" && record.workdir.trim() ? { workdir: record.workdir } : {}),
      ...(record.resources && typeof record.resources === "object" && !Array.isArray(record.resources)
        ? { resources: record.resources as WorkbenchRuntimeSpec["resources"] }
        : {}),
      ...(record.network && typeof record.network === "object" && !Array.isArray(record.network)
        ? { network: record.network as unknown as WorkbenchRuntimeSpec["network"] }
        : {}),
    };
  }
  return {
    dockerfile: "environment/Dockerfile",
    network: { egress: "open" },
    resources: {
      cpu: DEFAULT_EXECUTION_RESOURCES.cpu,
      memoryGb: DEFAULT_EXECUTION_RESOURCES.memoryGb,
      diskGb: DEFAULT_EXECUTION_RESOURCES.diskGb,
      timeoutMinutes: DEFAULT_EXECUTION_RESOURCES.timeoutMinutes,
    },
  };
}

function cloneEngineInvocation(engine: WorkbenchAdapterInvocation): WorkbenchAdapterInvocation {
  return clonePhaseAdapter(engine);
}

function clonePhaseAdapter(adapter: WorkbenchAdapterInvocation): WorkbenchAdapterInvocation {
  return {
    use: adapter.use,
    with: cloneJson(adapter.with ?? {}),
    ...(adapter.auth !== undefined ? { auth: cloneJson(adapter.auth) } : {}),
  };
}

function mergeRuntime(
  base: WorkbenchRuntimeSpec,
  override: Partial<WorkbenchRuntimeSpec> | undefined,
): WorkbenchRuntimeSpec {
  if (!override) {
    return cloneJson(base);
  }
  return {
    ...cloneJson(base),
    ...cloneJson(override),
    resources: {
      ...(base.resources ?? {}),
      ...(override.resources ?? {}),
    },
    network: override.network ?? base.network,
  };
}

function normalizeAdapterSources(
  value: unknown,
  label: string,
  errors: string[],
): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array of adapter sources.`);
    return [];
  }
  const sources = value.flatMap((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      errors.push(`${label}[${index}] must be a non-empty string.`);
      return [];
    }
    return [entry.trim()];
  });
  return [...new Set(sources)];
}

function normalizeNetworkConfig(
  network: Record<string, unknown>,
  label: string,
  errors: string[],
): WorkbenchExecutionNetworkPolicy | null {
  rejectUnknownKeys(network, label, ["egress"], errors);
  const egress = readOptionalString(network.egress, `${label}.egress`, errors) ?? "open";
  if (!isWorkbenchExecutionNetworkEgress(egress)) {
    errors.push(`${label}.egress must be none or open.`);
    return null;
  }
  return { egress };
}

function normalizePhaseAdapter(
  value: unknown,
  label: string,
  errors: string[],
): WorkbenchAdapterInvocation | null {
  const spec = readAdapterRecord(value, label, errors);
  if (!spec) {
    return null;
  }
  return {
    use: spec.use,
    with: readJsonRecord(spec.with ?? {}),
    ...(spec.auth !== undefined ? { auth: spec.auth } : {}),
  };
}

function normalizeWorkspaceLiteralPath(
  value: unknown,
  label: string,
  errors: string[],
): string | null {
  const raw = readRequiredString(value, label, errors);
  if (!raw) {
    return null;
  }
  return normalizeLiteralPathString(raw, label, errors);
}

function normalizePathRef(
  value: unknown,
  label: string,
  errors: string[],
): WorkbenchPathRef | null {
  const record = readRequiredRecord(value, label, errors);
  if (!record) {
    return null;
  }
  rejectUnknownKeys(record, label, ["path"], errors);
  const refPath = normalizeWorkspaceLiteralPath(record.path, `${label}.path`, errors);
  return refPath ? { path: refPath } : null;
}

function normalizeRelativePathList(
  value: unknown,
  label: string,
  errors: string[],
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label} must include at least one path.`);
    return [];
  }
  const paths = value.flatMap((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      errors.push(`${label}[${index}] must be a non-empty string.`);
      return [];
    }
    const normalized = normalizeLiteralPathString(entry, `${label}[${index}]`, errors);
    return normalized ? [normalized] : [];
  });
  return [...new Set(paths)];
}

function normalizeLiteralPathString(
  value: string,
  label: string,
  errors: string[],
): string | null {
  const trimmed = value.trim();
  if (/^(?:\/|[A-Za-z]:[\\/])/u.test(trimmed)) {
    errors.push(`${label} must be a relative path, not an absolute path.`);
    return null;
  }
  const normalized = trimmed.replace(/\\/gu, "/");
  if (!normalized || normalized.includes("\0")) {
    errors.push(`${label} must be a non-empty relative path.`);
    return null;
  }
  if (/[*?]/u.test(normalized)) {
    errors.push(`${label} must be a literal path, not a glob.`);
    return null;
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === "." || part === "")) {
    errors.push(`${label} must not contain empty, '.', or '..' path segments.`);
    return null;
  }
  return normalized;
}

function parseYamlRecord(source: string, label = "YAML"): Record<string, unknown> {
  const document = YAML.parseDocument(source, { prettyErrors: true });
  if (document.errors.length > 0) {
    throw new Error(document.errors.map((error) => `${label}: ${error.message}`).join("\n"));
  }
  const parsed = document.toJS();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a YAML object.`);
  }
  return parsed as Record<string, unknown>;
}

function readAdapterRecord(
  value: unknown,
  label: string,
  errors: string[],
): WorkbenchAdapterEnvelopeSpec | undefined {
  const record = readRequiredRecord(value, label, errors);
  if (!record) {
    return undefined;
  }
  rejectUnknownKeys(record, label, ["use", "with", "auth"], errors);
  const use = readRequiredString(record.use, `${label}.use`, errors);
  const config = record.with === undefined
    ? {}
    : readRequiredRecord(record.with, `${label}.with`, errors);
  return use
    ? {
      use,
      ...(config ? { with: config as Record<string, Json> } : {}),
      ...(record.auth !== undefined && isJson(record.auth) ? { auth: record.auth } : {}),
    }
    : undefined;
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  label: string,
  allowed: readonly string[],
  errors: string[],
): void {
  const extras = Object.keys(record).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    errors.push(`${label} includes unsupported ${extras.length === 1 ? "field" : "fields"}: ${extras.join(", ")}.`);
  }
}

function readRequiredRecord(
  value: unknown,
  label: string,
  errors: string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object.`);
    return null;
  }
  return value as Record<string, unknown>;
}

function readRequiredString(
  value: unknown,
  label: string,
  errors: string[],
): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${label} must be a non-empty string.`);
    return null;
  }
  return value.trim();
}

function readOptionalString(
  value: unknown,
  label: string,
  errors: string[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${label} must be a non-empty string when provided.`);
    return undefined;
  }
  return value.trim();
}

function readOptionalPositiveNumber(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push(`${label} must be a positive number.`);
  }
}

function readPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function readJsonRecord(value: unknown): Json {
  if (!isJson(value)) {
    return {};
  }
  return value;
}

function isJson(value: unknown): value is Json {
  if (value === null) {
    return true;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return Number.isFinite(value as number) || typeof value !== "number";
  }
  if (Array.isArray(value)) {
    return value.every(isJson);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isJson);
  }
  return false;
}

function fingerprintJson(value: Json): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalJson(value)))
    .digest("hex");
}

function canonicalJson(value: Json): Json {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

function splitErrorMessage(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\n+/u).map((entry) => entry.trim()).filter(Boolean);
}

function cloneJson<T extends Json | object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
