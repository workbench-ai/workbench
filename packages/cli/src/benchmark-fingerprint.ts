import { createHash } from "node:crypto";

import type { SurfaceSnapshotFile } from "@workbench-ai/workbench-core";

import type { LocalProjectSource } from "./project-source.js";

export function localBenchmarkFingerprint(project: LocalProjectSource): string {
  return benchmarkFingerprintForFiles([
    textFile("benchmark.yaml", project.benchmarkSource),
    ...prefixFiles(project.taskSourceFiles.map(toSurfaceFile), project.taskFingerprintPath),
    ...benchmarkDockerfileFiles(project),
    ...benchmarkAdapterFiles(project),
  ]);
}

export function localSubjectFingerprint(project: LocalProjectSource): string {
  const hash = createHash("sha256");
  hash.update("workbench-subject-v1\0");
  hash.update(project.subjectSource);
  hash.update("\0runner\0");
  hash.update(JSON.stringify(project.spec.run));
  hashSurfaceFiles(hash, project.subjectFiles);
  return hash.digest("hex");
}

export function benchmarkFingerprintForFiles(
  files: readonly SurfaceSnapshotFile[],
): string {
  const hash = createHash("sha256");
  hash.update("workbench-benchmark-fingerprint-v1\0");
  for (const file of files
    .map((entry) => ({ ...entry, path: normalizeLocalPath(entry.path) }))
    .sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.encoding ?? "utf8");
    hash.update("\0");
    hash.update(file.executable ? "1" : "0");
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function benchmarkDockerfileFiles(project: LocalProjectSource): SurfaceSnapshotFile[] {
  const dockerfilePath = normalizeLocalPath(project.spec.environment.dockerfile);
  return project.dockerfileFiles.filter(
    (file) => normalizeLocalPath(file.path) === dockerfilePath,
  ).map(toSurfaceFile);
}

function benchmarkAdapterFiles(project: LocalProjectSource): SurfaceSnapshotFile[] {
  const roots = project.benchmarkAdapterSources.map(normalizeLocalPath);
  const adapterIdRoots = project.benchmarkAdapterIds.map((id) =>
    normalizeLocalPath(`adapters/${id}`)
  );
  const allRoots = [...roots, ...adapterIdRoots];
  if (allRoots.length === 0) {
    return [];
  }
  return project.adapterFiles.filter((file) =>
    allRoots.some((root) => isWithinLocalPath(file.path, root)),
  ).map(toSurfaceFile);
}

function hashSurfaceFiles(
  hash: ReturnType<typeof createHash>,
  files: readonly {
    path: string;
    content: string;
    encoding?: "utf8" | "base64";
    executable?: boolean;
  }[],
): void {
  for (const file of files.slice().sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update("\0file\0");
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.encoding ?? "utf8");
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
    hash.update(file.executable ? "1" : "0");
  }
}

function prefixFiles(
  files: readonly SurfaceSnapshotFile[],
  rootPath: string,
): SurfaceSnapshotFile[] {
  const root = normalizeLocalPath(rootPath);
  return files.map((file) => {
    const filePath = normalizeLocalPath(file.path);
    return {
      ...file,
      path: isWithinLocalPath(filePath, root) ? filePath : `${root}/${filePath}`,
    };
  });
}

function textFile(filePath: string, content: string): SurfaceSnapshotFile {
  return {
    path: filePath,
    kind: "text",
    encoding: "utf8",
    content,
    executable: false,
  };
}

function toSurfaceFile(file: {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
  executable?: boolean;
}): SurfaceSnapshotFile {
  return {
    path: file.path,
    kind: "text",
    encoding: file.encoding ?? "utf8",
    content: file.content,
    executable: file.executable ?? false,
  };
}

function isWithinLocalPath(filePath: string, rootPath: string): boolean {
  const normalizedFile = normalizeLocalPath(filePath);
  const normalizedRoot = normalizeLocalPath(rootPath);
  return normalizedFile === normalizedRoot ||
    normalizedFile.startsWith(`${normalizedRoot}/`);
}

function normalizeLocalPath(value: string): string {
  return value
    .replace(/\\/gu, "/")
    .replace(/^\/+/u, "")
    .replace(/\/+/gu, "/")
    .replace(/^(?:\.\/)+/u, "");
}
