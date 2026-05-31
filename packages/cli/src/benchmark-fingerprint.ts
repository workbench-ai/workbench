import {
  engineResolveBindingForSpec,
  workbenchBenchmarkContentFingerprint,
  workbenchCandidateContentFingerprint,
  type SurfaceSnapshotFile,
  type WorkbenchProjectStateSource,
} from "@workbench-ai/workbench-core";

import {
  remoteEngineResolveFiles,
  type RemoteFile,
  type LocalProjectSource,
} from "./project-source.js";

export function localBenchmarkFingerprint(project: LocalProjectSource): string {
  return workbenchBenchmarkContentFingerprint({
    sourceYaml: project.specSource,
    engineResolveFiles: remoteEngineResolveFiles(project).map(toSurfaceFile),
    engineResolveBinding: engineResolveBindingForSpec(project.spec),
    adapterFiles: project.adapterFiles.map(toSurfaceFile),
    adapterManifests: project.adapters.map((adapter) => adapter.manifest),
    runtimeFiles: project.dockerfileFiles.map(toSurfaceFile),
    resources: project.spec.environment.resources ?? {},
    network: project.spec.environment.network?.egress === "open" ? "on" : "off",
  });
}

export function projectStateBenchmarkFingerprint(source: WorkbenchProjectStateSource): string {
  return workbenchBenchmarkContentFingerprint({
    sourceYaml: source.source,
    engineResolveFiles: source.engineResolveFiles,
    engineResolveBinding: source.engineResolveBinding,
    adapterFiles: source.adapterFiles,
    runtimeFiles: source.runtimeFiles,
    resources: source.resources,
    network: source.network,
  });
}

export function localCandidateFingerprint(project: LocalProjectSource): string {
  return workbenchCandidateContentFingerprint({
    sourceYaml: project.specSource,
    candidateFiles: project.candidateFiles.map(toSurfaceFile),
    adapterFiles: project.adapterFiles.map(toSurfaceFile),
    adapterManifests: project.adapters.map((adapter) => adapter.manifest),
  });
}

function toSurfaceFile(file: RemoteFile | SurfaceSnapshotFile): SurfaceSnapshotFile {
  return {
    path: file.path,
    kind: "kind" in file ? file.kind : file.encoding === "base64" ? "binary" : "text",
    encoding: file.encoding ?? "utf8",
    content: file.content,
    executable: file.executable === true,
  };
}
