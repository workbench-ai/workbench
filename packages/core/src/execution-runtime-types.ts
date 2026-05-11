import type {
  HostedWorkbenchEnvironmentVersion,
  HostedWorkbenchJob,
  Json,
  SurfaceSnapshotFile,
  WorkbenchExecutionPurpose,
} from "@workbench-ai/workbench-contract";

import type {
  GenericRunSpec,
} from "./generic-spec.ts";
import type {
  WorkbenchExecutionProgressTarget,
} from "./execution-events.ts";
import type {
  WorkbenchAdapterAuthBundle,
} from "./adapter-auth.ts";
import type {
  WorkbenchAdapterManifest,
} from "@workbench-ai/workbench-protocol";

export interface WorkbenchExecutionRuntimeInput {
  job: HostedWorkbenchJob;
  spec: GenericRunSpec;
  environmentVersion?: Pick<HostedWorkbenchEnvironmentVersion, "id" | "imageRef" | "sourceHash" | "spec">;
  environmentDockerfile?: string;
  baseFiles: readonly SurfaceSnapshotFile[];
  caseFiles: readonly SurfaceSnapshotFile[];
  traceFiles?: readonly SurfaceSnapshotFile[];
  runnerOutputFiles?: readonly SurfaceSnapshotFile[];
  now?: string;
  adapterAuthProfiles?: readonly WorkbenchAdapterAuthBundle[];
  adapterManifests?: readonly WorkbenchAdapterManifest[];
  adapterAuthRoot?: string;
  adapterAuthRequest?: Json;
  adapterAuthEnv?: Record<string, string>;
  progress?: WorkbenchExecutionProgressTarget;
  runtimeRegistry?: string;
  pullImages?: boolean;
  workdir?: string;
  workspaceRoot?: string;
}

export interface WorkbenchWorkloadPhaseCommand {
  kind: "optimizer" | "runner" | "grader";
  label: WorkbenchExecutionPurpose;
  command?: string;
  okExitCodes?: number[];
}
