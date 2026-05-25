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

export const BENCHMARK_SPEC_FILE = "benchmark.yaml";

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

export interface WorkbenchSubjectPrepareSpec {
  command: string;
}

export interface AuthoredBenchmarkSpec {
  version: 3;
  name: string;
  description: string;
  adapters: string[];
  engine: WorkbenchAdapterInvocation;
}

export interface WorkbenchSubjectManifestSpec {
  version: 3;
  name: string;
  description?: string;
  files: WorkbenchPathRef;
  prepare?: WorkbenchSubjectPrepareSpec;
  adapters: string[];
  run: WorkbenchAdapterInvocation;
}

export type ResolvedSubjectSpec = WorkbenchSubjectManifestSpec;

export interface AuthoredOptimizerSpec {
  version: 3;
  name: string;
  description?: string;
  edits: string[];
  adapters: string[];
  improve: WorkbenchAdapterInvocation;
}

export interface WorkbenchResolvedSource {
  version: 3;
  benchmark: AuthoredBenchmarkSpec;
  subject: ResolvedSubjectSpec;
  optimizer?: AuthoredOptimizerSpec;
}

export interface GenericRunSpec {
  version: 3;
  name: string;
  description: string;
  benchmark: {
    name: string;
    description: string;
    engine: WorkbenchAdapterInvocation;
  };
  subject: {
    name: string;
    description?: string;
    files: WorkbenchPathRef;
    prepare?: WorkbenchSubjectPrepareSpec;
  };
  optimizer?: {
    name: string;
    description?: string;
    edits: string[];
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
    errors.push("Resolved Workbench source cannot be empty.");
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
  const parsed = parseYamlRecord(source, "resolved Workbench source");
  const errors: string[] = [];
  rejectUnknownKeys(parsed, "resolved Workbench source", [
    "version",
    "benchmark",
    "subject",
    "optimizer",
  ], errors);
  if (parsed.version !== 3) {
    throw new Error("Resolved Workbench source version must be 3.");
  }
  const benchmark = normalizeBenchmarkRecord(
    readRequiredRecord(parsed.benchmark, "resolved Workbench source.benchmark", errors),
    "benchmark.yaml",
    errors,
  );
  const subject = normalizeSubjectRecord(
    readRequiredRecord(parsed.subject, "resolved Workbench source.subject", errors),
    "resolved Workbench source.subject",
    errors,
  );
  const optimizer = parsed.optimizer === undefined
    ? undefined
    : normalizeOptimizerRecord(
      readRequiredRecord(parsed.optimizer, "resolved Workbench source.optimizer", errors),
      "optimizer YAML",
      errors,
    );
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return genericSpecFromAuthoredBundle({
    version: 3,
    benchmark: benchmark!,
    subject: subject!,
    ...(optimizer ? { optimizer } : {}),
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
    engine: spec.benchmark.engine.use,
    resolver: {
      use: resolver.use,
      withFingerprint: fingerprintJson(resolver.with ?? {}),
    },
  };
}

export function resolveWorkbenchSourceFiles(args: {
  benchmarkSource: string;
  subjectSource: string;
  optimizerSource?: string | null;
}): GenericRunSpec {
  return genericSpecFromAuthoredBundle(parseWorkbenchSourceFiles({
    benchmarkSource: args.benchmarkSource,
    subjectSource: args.subjectSource,
    optimizerSource: args.optimizerSource,
  }));
}

export function parseWorkbenchSourceFiles(args: {
  benchmarkSource: string;
  subjectSource?: string;
  optimizerSource?: string | null;
}): WorkbenchResolvedSource {
  const errors: string[] = [];
  const benchmark = normalizeBenchmarkRecord(
    parseYamlRecord(args.benchmarkSource, BENCHMARK_SPEC_FILE),
    BENCHMARK_SPEC_FILE,
    errors,
  );
  const subject = normalizeSubjectRecord(
    parseYamlRecord(args.subjectSource ?? "", "subject YAML"),
    "subject YAML",
    errors,
  );
  const optimizer = args.optimizerSource?.trim()
    ? normalizeOptimizerRecord(
      parseYamlRecord(args.optimizerSource, "optimizer YAML"),
      "optimizer YAML",
      errors,
    )
    : undefined;
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return {
    version: 3,
    benchmark: benchmark!,
    subject: subject!,
    ...(optimizer ? { optimizer } : {}),
  };
}

export function serializeWorkbenchResolvedSourceYaml(
  source: WorkbenchResolvedSource,
): string {
  return YAML.stringify(source).trimEnd() + "\n";
}

export function isWorkbenchSubjectManifestPath(filePath: string): boolean {
  return /^subjects\/[^/]+\/subject\.ya?ml$/iu.test(
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
  const engineRuntime = engineRuntimeFromConfig(source.benchmark.engine);
  const engineRun = cloneEngineInvocation(source.benchmark.engine);
  const engineResolve = cloneEngineInvocation(source.benchmark.engine);
  return {
    version: 3,
    name: source.benchmark.name,
    description: source.benchmark.description,
    benchmark: {
      name: source.benchmark.name,
      description: source.benchmark.description,
      engine: cloneJson(source.benchmark.engine),
    },
    subject: {
      name: source.subject.name,
      ...(source.subject.description ? { description: source.subject.description } : {}),
      files: cloneJson(source.subject.files),
      ...(source.subject.prepare ? { prepare: cloneJson(source.subject.prepare) } : {}),
    },
    ...(source.optimizer
      ? {
          optimizer: {
            name: source.optimizer.name,
            ...(source.optimizer.description ? { description: source.optimizer.description } : {}),
            edits: [...source.optimizer.edits],
          },
        }
      : {}),
    environment: cloneJson(engineRuntime),
    adapters: [
      ...new Set([
        ...source.benchmark.adapters,
        ...source.subject.adapters,
        ...(source.optimizer?.adapters ?? []),
      ]),
    ],
    engine: cloneJson(source.benchmark.engine),
    engineResolve: cloneJson(engineResolve),
    ...(source.optimizer ? { improve: cloneJson(source.optimizer.improve) } : {}),
    run: cloneJson(source.subject.run),
    engineRun: cloneJson(engineRun),
  };
}

function normalizeBenchmarkRecord(
  record: Record<string, unknown> | null,
  label: string,
  errors: string[],
): AuthoredBenchmarkSpec | null {
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
  requireVersionThree(record.version, label, errors);
  const name = readRequiredString(record.name, `${label}.name`, errors);
  const description = readRequiredString(record.description, `${label}.description`, errors);
  const adapters = normalizeAdapterSources(record.adapters, `${label}.adapters`, errors);
  const engine = normalizePhaseAdapter(record.engine, `${label}.engine`, errors);
  if (engine) {
    normalizeEngineRuntimeConfig(engine, `${label}.engine.with`, errors);
  }
  return name && description && engine
    ? {
        version: 3,
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

function normalizeSubjectRecord(
  record: Record<string, unknown> | null,
  label: string,
  errors: string[],
): ResolvedSubjectSpec | null {
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
    "run",
  ], errors);
  requireVersionThree(record.version, label, errors);
  const name = readRequiredString(record.name, `${label}.name`, errors);
  const description = readOptionalString(record.description, `${label}.description`, errors);
  const files = normalizePathRef(record.files, `${label}.files`, errors);
  const prepare = normalizeSubjectPrepare(record.prepare, `${label}.prepare`, errors);
  const adapters = normalizeAdapterSources(record.adapters, `${label}.adapters`, errors);
  const run = normalizePhaseAdapter(record.run, `${label}.run`, errors);
  return name && files && run
    ? {
        version: 3,
        name,
        ...(description ? { description } : {}),
        files,
        ...(prepare ? { prepare } : {}),
        adapters,
        run,
      }
    : null;
}

function normalizeSubjectPrepare(
  value: unknown,
  label: string,
  errors: string[],
): WorkbenchSubjectPrepareSpec | undefined {
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

function normalizeOptimizerRecord(
  record: Record<string, unknown> | null,
  label: string,
  errors: string[],
): AuthoredOptimizerSpec | null {
  if (!record) {
    return null;
  }
  rejectUnknownKeys(record, label, [
    "version",
    "name",
    "description",
    "edits",
    "adapters",
    "improve",
  ], errors);
  requireVersionThree(record.version, label, errors);
  const name = readRequiredString(record.name, `${label}.name`, errors);
  const description = readOptionalString(record.description, `${label}.description`, errors);
  const edits = normalizeRelativePathList(record.edits, `${label}.edits`, errors);
  const adapters = normalizeAdapterSources(record.adapters, `${label}.adapters`, errors);
  const improve = normalizePhaseAdapter(record.improve, `${label}.improve`, errors);
  return name && edits.length > 0 && improve
    ? {
        version: 3,
        name,
        ...(description ? { description } : {}),
        edits,
        adapters,
        improve,
      }
    : null;
}

function requireVersionThree(value: unknown, label: string, errors: string[]): void {
  if (value !== 3) {
    errors.push(`${label}.version must be 3.`);
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
  return {
    use: engine.use,
    with: cloneJson(engine.with ?? {}),
    ...(engine.auth !== undefined ? { auth: cloneJson(engine.auth) } : {}),
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
