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
export const CANDIDATE_SPEC_FILE = "candidate.yaml";

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

export interface WorkbenchCandidatePrepareSpec {
  command: string;
}

export interface AuthoredBenchmarkSpec {
  version: 4;
  name: string;
  description: string;
  adapters: string[];
  engine: WorkbenchAdapterInvocation;
}

export interface WorkbenchCandidateRunSpec extends WorkbenchAdapterInvocation {
  name: string;
}

export interface WorkbenchCandidateImproveSpec extends WorkbenchAdapterInvocation {
  edits: string[];
}

export interface WorkbenchCandidateManifestSpec {
  version: 4;
  name: string;
  description?: string;
  files: WorkbenchPathRef;
  prepare?: WorkbenchCandidatePrepareSpec;
  adapters: string[];
  defaultRun?: string;
  runs: Record<string, WorkbenchCandidateRunSpec>;
  improve?: WorkbenchCandidateImproveSpec;
}

export interface ResolvedCandidateSpec extends WorkbenchCandidateManifestSpec {
  selectedRunId: string;
}

export interface WorkbenchResolvedSource {
  version: 4;
  benchmark: AuthoredBenchmarkSpec;
  candidate: ResolvedCandidateSpec;
}

export interface GenericRunSpec {
  version: 4;
  name: string;
  description: string;
  benchmark: {
    name: string;
    description: string;
    engine: WorkbenchAdapterInvocation;
  };
  candidate: {
    name: string;
    description?: string;
    files: WorkbenchPathRef;
    prepare?: WorkbenchCandidatePrepareSpec;
    defaultRun: string;
    selectedRunId: string;
    selectedRunName: string;
    runs: Record<string, WorkbenchCandidateRunSpec>;
    improve?: {
      edits: string[];
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
    "candidate",
  ], errors);
  if (parsed.version !== 4) {
    throw new Error("Resolved Workbench source version must be 4.");
  }
  const benchmark = normalizeBenchmarkRecord(
    readRequiredRecord(parsed.benchmark, "resolved Workbench source.benchmark", errors),
    "benchmark.yaml",
    errors,
  );
  const candidate = normalizeCandidateRecord(
    readRequiredRecord(parsed.candidate, "resolved Workbench source.candidate", errors),
    "resolved Workbench source.candidate",
    errors,
  );
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return genericSpecFromAuthoredBundle({
    version: 4,
    benchmark: benchmark!,
    candidate: candidate!,
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
  candidateSource: string;
  runId?: string | null;
}): GenericRunSpec {
  return genericSpecFromAuthoredBundle(parseWorkbenchSourceFiles({
    benchmarkSource: args.benchmarkSource,
    candidateSource: args.candidateSource,
    runId: args.runId,
  }));
}

export function parseWorkbenchSourceFiles(args: {
  benchmarkSource: string;
  candidateSource?: string;
  runId?: string | null;
}): WorkbenchResolvedSource {
  const errors: string[] = [];
  const benchmark = normalizeBenchmarkRecord(
    parseYamlRecord(args.benchmarkSource, BENCHMARK_SPEC_FILE),
    BENCHMARK_SPEC_FILE,
    errors,
  );
  const candidate = normalizeCandidateRecord(
    parseYamlRecord(args.candidateSource ?? "", "candidate YAML"),
    "candidate YAML",
    errors,
    args.runId ?? undefined,
  );
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return {
    version: 4,
    benchmark: benchmark!,
    candidate: candidate!,
  };
}

export function serializeWorkbenchResolvedSourceYaml(
  source: WorkbenchResolvedSource,
): string {
  return YAML.stringify(source).trimEnd() + "\n";
}

export function isWorkbenchCandidateManifestPath(filePath: string): boolean {
  return /^candidates\/[^/]+\/candidate\.ya?ml$/iu.test(
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
  const candidate = source.candidate;
  const selectedRun = candidate.runs[candidate.selectedRunId];
  if (!selectedRun) {
    throw new Error(`Candidate run not found: ${candidate.selectedRunId}`);
  }
  return {
    version: 4,
    name: source.benchmark.name,
    description: source.benchmark.description,
    benchmark: {
      name: source.benchmark.name,
      description: source.benchmark.description,
      engine: cloneJson(source.benchmark.engine),
    },
    candidate: {
      name: candidate.name,
      ...(candidate.description ? { description: candidate.description } : {}),
      files: cloneJson(candidate.files),
      ...(candidate.prepare ? { prepare: cloneJson(candidate.prepare) } : {}),
      defaultRun: candidate.defaultRun ?? candidate.selectedRunId,
      selectedRunId: candidate.selectedRunId,
      selectedRunName: selectedRun.name,
      runs: cloneJson(candidate.runs),
      ...(candidate.improve
        ? {
            improve: {
              edits: [...candidate.improve.edits],
            },
          }
        : {}),
    },
    environment: cloneJson(engineRuntime),
    adapters: [
      ...new Set([
        ...source.benchmark.adapters,
        ...candidate.adapters,
      ]),
    ],
    engine: cloneJson(source.benchmark.engine),
    engineResolve: cloneJson(engineResolve),
    ...(candidate.improve ? { improve: clonePhaseAdapter(candidate.improve) } : {}),
    run: clonePhaseAdapter(selectedRun),
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
  requireVersionFour(record.version, label, errors);
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

function normalizeCandidateRecord(
  record: Record<string, unknown> | null,
  label: string,
  errors: string[],
  selectedRunId?: string,
): ResolvedCandidateSpec | null {
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
    "defaultRun",
    "runs",
    "improve",
    "selectedRunId",
  ], errors);
  requireVersionFour(record.version, label, errors);
  const name = readRequiredString(record.name, `${label}.name`, errors);
  const description = readOptionalString(record.description, `${label}.description`, errors);
  const files = normalizePathRef(record.files, `${label}.files`, errors);
  const prepare = normalizeCandidatePrepare(record.prepare, `${label}.prepare`, errors);
  const adapters = normalizeAdapterSources(record.adapters, `${label}.adapters`, errors);
  const runs = normalizeCandidateRuns(record.runs, `${label}.runs`, errors);
  const defaultRun = readOptionalString(record.defaultRun, `${label}.defaultRun`, errors);
  const embeddedSelectedRun = readOptionalString(record.selectedRunId, `${label}.selectedRunId`, errors);
  const selected = selectedRunId ?? embeddedSelectedRun ?? defaultRun ?? Object.keys(runs).sort()[0];
  if (selected && !runs[selected]) {
    errors.push(`${label}.selectedRunId references unknown run ${selected}.`);
  }
  const improve = normalizeCandidateImprove(record.improve, `${label}.improve`, errors);
  return name && files && selected && Object.keys(runs).length > 0
    ? {
        version: 4,
        name,
        ...(description ? { description } : {}),
        files,
        ...(prepare ? { prepare } : {}),
        adapters,
        ...(defaultRun ? { defaultRun } : {}),
        runs,
        ...(improve ? { improve } : {}),
        selectedRunId: selected,
      }
    : null;
}

function normalizeCandidatePrepare(
  value: unknown,
  label: string,
  errors: string[],
): WorkbenchCandidatePrepareSpec | undefined {
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

function normalizeCandidateRuns(
  value: unknown,
  label: string,
  errors: string[],
): Record<string, WorkbenchCandidateRunSpec> {
  const record = readRequiredRecord(value, label, errors);
  if (!record) {
    return {};
  }
  const runs: Record<string, WorkbenchCandidateRunSpec> = {};
  for (const [runId, runValue] of Object.entries(record).sort(([left], [right]) => left.localeCompare(right))) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(runId)) {
      errors.push(`${label}.${runId} must use letters, numbers, dots, underscores, or dashes.`);
      continue;
    }
    const runRecord = readRequiredRecord(runValue, `${label}.${runId}`, errors);
    if (!runRecord) {
      continue;
    }
    rejectUnknownKeys(runRecord, `${label}.${runId}`, ["name", "use", "with", "auth"], errors);
    const name = readRequiredString(runRecord.name, `${label}.${runId}.name`, errors);
    const invocation = normalizePhaseAdapter(adapterRecordFrom(runRecord), `${label}.${runId}`, errors);
    if (name && invocation) {
      runs[runId] = {
        name,
        ...invocation,
      };
    }
  }
  if (Object.keys(runs).length === 0) {
    errors.push(`${label} must declare at least one run.`);
  }
  return runs;
}

function normalizeCandidateImprove(
  value: unknown,
  label: string,
  errors: string[],
): WorkbenchCandidateImproveSpec | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = readRequiredRecord(value, label, errors);
  if (!record) {
    return undefined;
  }
  rejectUnknownKeys(record, label, ["edits", "use", "with", "auth"], errors);
  const edits = normalizeRelativePathList(record.edits, `${label}.edits`, errors);
  const invocation = normalizePhaseAdapter(adapterRecordFrom(record), label, errors);
  return edits.length > 0 && invocation
    ? {
        ...invocation,
        edits,
      }
    : undefined;
}

function adapterRecordFrom(record: Record<string, unknown>): Record<string, unknown> {
  return {
    use: record.use,
    ...(record.with !== undefined ? { with: record.with } : {}),
    ...(record.auth !== undefined ? { auth: record.auth } : {}),
  };
}

function requireVersionFour(value: unknown, label: string, errors: string[]): void {
  if (value !== 4) {
    errors.push(`${label}.version must be 4.`);
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
