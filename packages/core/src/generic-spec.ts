import type {
  Json,
  WorkbenchAdapterInvocation,
  WorkbenchExecutionNetworkPolicy,
  WorkbenchExecutionResources,
  WorkbenchSpecValidation,
} from "@workbench-ai/workbench-contract";
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

export interface AuthoredBenchmarkSpec {
  version: 2;
  name: string;
  description: string;
  tasks: string;
  environment: WorkbenchRuntimeSpec;
  adapters: string[];
  score: WorkbenchAdapterInvocation;
}

export interface WorkbenchSubjectManifestSpec {
  version: 2;
  name: string;
  description?: string;
  adapters: string[];
  run: WorkbenchAdapterInvocation;
}

export interface ResolvedSubjectSpec extends WorkbenchSubjectManifestSpec {
  path: string;
}

export type WorkbenchCandidateManifestSpec = WorkbenchSubjectManifestSpec;
export type ResolvedCandidateSpec = ResolvedSubjectSpec;

export interface AuthoredOptimizerSpec {
  version: 2;
  name: string;
  description?: string;
  edits: string[];
  adapters: string[];
  improve: WorkbenchAdapterInvocation;
}

export interface WorkbenchResolvedSource {
  version: 2;
  benchmark: AuthoredBenchmarkSpec;
  subject: ResolvedSubjectSpec;
  optimizer?: AuthoredOptimizerSpec;
}

export interface GenericRunSpec {
  version: 2;
  name: string;
  description: string;
  benchmark: {
    name: string;
    description: string;
    tasks: string;
    environment: WorkbenchRuntimeSpec;
  };
  subject: {
    name: string;
    description?: string;
    path: string;
  };
  candidate: {
    name: string;
    description?: string;
    path: string;
  };
  optimizer?: {
    name: string;
    description?: string;
    edits: string[];
  };
  tasks: {
    path: string;
  };
  environment: WorkbenchRuntimeSpec;
  adapters: string[];
  improve?: WorkbenchAdapterInvocation;
  run: WorkbenchAdapterInvocation;
  score: WorkbenchAdapterInvocation;
  grade: WorkbenchAdapterInvocation;
}

export interface GenericTaskSpec {
  task: string;
  environment?: Partial<WorkbenchRuntimeSpec>;
  score?: WorkbenchAdapterInvocation;
}

export interface ResolvedTaskExecutionConfig {
  task: string;
  environment: WorkbenchRuntimeSpec;
  run: WorkbenchAdapterInvocation;
  score: WorkbenchAdapterInvocation;
  grade: WorkbenchAdapterInvocation;
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
  if (parsed.version !== 2) {
    throw new Error("Resolved Workbench source version must be 2.");
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
    { allowResolvedFields: true },
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
    version: 2,
    benchmark: benchmark!,
    subject: subject!,
    ...(optimizer ? { optimizer } : {}),
  });
}

export function resolveWorkbenchSourceFiles(args: {
  benchmarkSource: string;
  subjectSource: string;
  optimizerSource?: string | null;
  subjectPath?: string;
}): GenericRunSpec {
  return genericSpecFromAuthoredBundle(parseWorkbenchSourceFiles({
    benchmarkSource: args.benchmarkSource,
    subjectSource: args.subjectSource,
    optimizerSource: args.optimizerSource,
    subjectPath: args.subjectPath,
  }));
}

export function parseWorkbenchSourceFiles(args: {
  benchmarkSource: string;
  subjectSource?: string;
  candidateSource?: string;
  optimizerSource?: string | null;
  subjectPath?: string;
  candidatePath?: string;
}): WorkbenchResolvedSource {
  const errors: string[] = [];
  const benchmark = normalizeBenchmarkRecord(
    parseYamlRecord(args.benchmarkSource, BENCHMARK_SPEC_FILE),
    BENCHMARK_SPEC_FILE,
    errors,
  );
  const subject = normalizeSubjectRecord(
    parseYamlRecord(args.subjectSource ?? args.candidateSource ?? "", "subject YAML"),
    "subject YAML",
    errors,
    {
      subjectPath: args.subjectPath ?? args.candidatePath,
      allowResolvedFields: false,
    },
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
    version: 2,
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

export const isWorkbenchCandidateManifestPath = isWorkbenchSubjectManifestPath;

export function parseGenericTaskSpec(
  source: string,
  label = "task.yaml",
): GenericTaskSpec {
  const parsed = parseYamlRecord(source, label);
  const errors: string[] = [];
  rejectUnknownKeys(parsed, label, ["task", "instruction", "environment", "score"], errors);
  const task = readOptionalString(parsed.task, `${label}.task`, errors) ??
    readOptionalString(parsed.instruction, `${label}.instruction`, errors);
  const environment = parsed.environment === undefined
    ? undefined
    : normalizeRuntimeOverride(parsed.environment, `${label}.environment`, errors);
  const score = parsed.score === undefined
    ? undefined
    : normalizePhaseAdapter(parsed.score, `${label}.score`, errors);
  if (!task) {
    errors.push(`${label}.task or ${label}.instruction must be a non-empty string.`);
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return {
    task: task!,
    ...(environment ? { environment } : {}),
    ...(score ? { score } : {}),
  };
}

export function resolveTaskExecutionConfig(args: {
  spec: GenericRunSpec;
  task: GenericTaskSpec;
}): ResolvedTaskExecutionConfig {
  return {
    task: args.task.task,
    environment: mergeRuntime(args.spec.environment, args.task.environment),
    run: args.spec.run,
    score: args.task.score ?? args.spec.score,
    grade: args.task.score ?? args.spec.score,
  };
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
  return {
    version: 2,
    name: source.benchmark.name,
    description: source.benchmark.description,
    benchmark: {
      name: source.benchmark.name,
      description: source.benchmark.description,
      tasks: source.benchmark.tasks,
      environment: cloneJson(source.benchmark.environment),
    },
    subject: {
      name: source.subject.name,
      ...(source.subject.description ? { description: source.subject.description } : {}),
      path: source.subject.path,
    },
    candidate: {
      name: source.subject.name,
      ...(source.subject.description ? { description: source.subject.description } : {}),
      path: source.subject.path,
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
    tasks: {
      path: source.benchmark.tasks,
    },
    environment: cloneJson(source.benchmark.environment),
    adapters: [
      ...new Set([
        ...source.benchmark.adapters,
        ...source.subject.adapters,
        ...(source.optimizer?.adapters ?? []),
      ]),
    ],
    ...(source.optimizer ? { improve: cloneJson(source.optimizer.improve) } : {}),
    run: cloneJson(source.subject.run),
    score: cloneJson(source.benchmark.score),
    grade: cloneJson(source.benchmark.score),
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
    "tasks",
    "environment",
    "adapters",
    "score",
  ], errors);
  requireVersionTwo(record.version, label, errors);
  const name = readRequiredString(record.name, `${label}.name`, errors);
  const description = readRequiredString(record.description, `${label}.description`, errors);
  const tasks = normalizeWorkspaceLiteralPath(record.tasks, `${label}.tasks`, errors);
  const environment = normalizeRuntime(record.environment, `${label}.environment`, errors);
  const adapters = normalizeAdapterSources(record.adapters, `${label}.adapters`, errors);
  const score = normalizePhaseAdapter(record.score, `${label}.score`, errors);
  return name && description && tasks && environment && score
    ? {
        version: 2,
        name,
        description,
        tasks,
        environment,
        adapters,
        score,
      }
    : null;
}

function normalizeSubjectRecord(
  record: Record<string, unknown> | null,
  label: string,
  errors: string[],
  options: {
    subjectPath?: string;
    allowResolvedFields?: boolean;
  } = {},
): ResolvedSubjectSpec | null {
  if (!record) {
    return null;
  }
  rejectUnknownKeys(record, label, [
    "version",
    "name",
    "description",
    "adapters",
    "run",
    ...(options.allowResolvedFields === true ? ["path"] : []),
  ], errors);
  requireVersionTwo(record.version, label, errors);
  const name = readRequiredString(record.name, `${label}.name`, errors);
  const description = readOptionalString(record.description, `${label}.description`, errors);
  const subjectPath = options.subjectPath ??
    (options.allowResolvedFields === true
      ? normalizeWorkspaceLiteralPath(record.path, `${label}.path`, errors)
      : undefined);
  const adapters = normalizeAdapterSources(record.adapters, `${label}.adapters`, errors);
  const run = normalizePhaseAdapter(record.run, `${label}.run`, errors);
  if (!subjectPath) {
    errors.push("Subject files path is required in resolved source.");
  }
  return name && subjectPath && run
    ? {
        version: 2,
        name,
        ...(description ? { description } : {}),
        path: subjectPath,
        adapters,
        run,
      }
    : null;
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
  requireVersionTwo(record.version, label, errors);
  const name = readRequiredString(record.name, `${label}.name`, errors);
  const description = readOptionalString(record.description, `${label}.description`, errors);
  const edits = normalizeRelativePathList(record.edits, `${label}.edits`, errors);
  const adapters = normalizeAdapterSources(record.adapters, `${label}.adapters`, errors);
  const improve = normalizePhaseAdapter(record.improve, `${label}.improve`, errors);
  return name && edits.length > 0 && improve
    ? {
        version: 2,
        name,
        ...(description ? { description } : {}),
        edits,
        adapters,
        improve,
      }
    : null;
}

function requireVersionTwo(value: unknown, label: string, errors: string[]): void {
  if (value !== 2) {
    errors.push(`${label}.version must be 2.`);
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
  rejectUnknownKeys(network, label, ["egress", "allow"], errors);
  const egress = readOptionalString(network.egress, `${label}.egress`, errors) ?? "open";
  if (egress !== "none" && egress !== "open" && egress !== "allowlist") {
    errors.push(`${label}.egress must be none, open, or allowlist.`);
    return null;
  }
  const allow = network.allow === undefined
    ? undefined
    : normalizeNetworkAllowList(network.allow, `${label}.allow`, errors);
  if (egress !== "allowlist") {
    if (network.allow !== undefined) {
      errors.push(`${label}.allow is only supported when ${label}.egress is allowlist.`);
    }
    return { egress };
  }
  if (!allow || allow.length === 0) {
    errors.push(`${label}.allow must contain at least one host when ${label}.egress is allowlist.`);
  }
  return {
    egress,
    ...(allow && allow.length > 0 ? { allow } : {}),
  };
}

function normalizeNetworkAllowList(
  value: unknown,
  label: string,
  errors: string[],
): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array of hosts.`);
    return [];
  }
  return value.flatMap((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      errors.push(`${label}[${index}] must be a non-empty string.`);
      return [];
    }
    return [entry.trim()];
  });
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

function splitErrorMessage(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\n+/u).map((entry) => entry.trim()).filter(Boolean);
}

function cloneJson<T extends Json | object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
