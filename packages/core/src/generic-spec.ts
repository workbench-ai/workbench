import type {
  Json,
  SurfaceSnapshotFile,
  WorkbenchAdapterInvocation,
  WorkbenchExecutionNetworkPolicy,
  WorkbenchExecutionResources,
} from "@workbench-ai/workbench-contract";
import type {
  WorkbenchEngineCase,
  WorkbenchEngineCaseSpec,
} from "@workbench-ai/workbench-protocol";

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

interface WorkbenchPathRef {
  path: string;
}

interface WorkbenchSkillPrepareSpec {
  command: string;
}

interface WorkbenchSkillAgentSpec extends WorkbenchAdapterInvocation {
  name: string;
}

interface WorkbenchCaseSelector {
  all?: true;
  split?: string;
}

interface WorkbenchSelectionSpec {
  metric: string;
  cases?: WorkbenchCaseSelector;
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
  gradeRun: WorkbenchAdapterInvocation;
}

export type GenericEngineCaseSpec = WorkbenchEngineCaseSpec;
export type { WorkbenchEngineCase } from "@workbench-ai/workbench-protocol";

interface ResolvedEngineCaseExecutionConfig {
  prompt: string;
  environment: WorkbenchRuntimeSpec;
  run: WorkbenchAdapterInvocation;
}

const DEFAULT_EXECUTION_RESOURCES: WorkbenchExecutionResources = {
  cpu: 2,
  memoryGb: 4,
  diskGb: 10,
  timeoutMinutes: 20,
};

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

export function engineCaseFilesForRuntimeInput(args: {
  spec: GenericRunSpec;
  engineCase: WorkbenchEngineCase;
}): SurfaceSnapshotFile[] {
  void args.spec;
  return engineCasePublicFiles(args.engineCase);
}

function engineCasePublicFiles(
  engineCase: WorkbenchEngineCase,
): SurfaceSnapshotFile[] {
  return (engineCase.files.public ?? [])
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

function readPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function cloneJson<T extends Json | object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
