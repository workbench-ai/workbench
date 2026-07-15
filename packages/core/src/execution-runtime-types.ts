import type {
  RemoteWorkbenchEnvironmentVersion,
  WorkbenchExecutionJob,
  Json,
  SurfaceSnapshotFile,
} from "@workbench-ai/workbench-contract";

import type {
  GenericRunSpec,
  WorkbenchEngineCase,
} from "./generic-spec.ts";
import type {
  WorkbenchExecutionProgressTarget,
} from "./execution-events.ts";
import type {
  WorkbenchAdapterAuthBundle,
} from "./adapter-auth.ts";
import type {
  WorkbenchAdapterManifest,
  WorkbenchRuntimeControlOperationSequenceRequest,
} from "@workbench-ai/workbench-protocol";

export interface WorkbenchExecutionRuntimeInput {
  job: WorkbenchExecutionJob;
  spec: GenericRunSpec;
  environmentVersion?: Pick<RemoteWorkbenchEnvironmentVersion, "id" | "imageRef" | "sourceHash" | "spec">;
  environmentDockerfile?: string;
  baseFiles: readonly SurfaceSnapshotFile[];
  engineResolveFiles: readonly SurfaceSnapshotFile[];
  engineCases: readonly WorkbenchEngineCase[];
  adapterFiles?: readonly SurfaceSnapshotFile[];
  traceFiles?: readonly SurfaceSnapshotFile[];
  now?: string;
  adapterAuthProfiles?: readonly WorkbenchAdapterAuthBundle[];
  adapterAuthUpdateSink?: (profiles: readonly WorkbenchAdapterAuthBundle[]) => Promise<void>;
  adapterManifests?: readonly WorkbenchAdapterManifest[];
  adapterAuthRoot?: string;
  adapterAuthRequest?: Json;
  adapterAuthEnv?: Record<string, string>;
  adapterRuntimeEnv?: Record<string, string>;
  progress?: WorkbenchExecutionProgressTarget;
  runtimeRegistry?: string;
  pullImages?: boolean;
  workdir?: string;
  workspaceRoot?: string;
  runtimeControlOperation?: WorkbenchRuntimeControlOperationSequenceRequest;
}
