import type {
  WorkbenchInspectionSnapshot,
  WorkbenchVersion,
} from "@workbench-ai/workbench-contract";

export function defaultSourceVersion(
  snapshot: WorkbenchInspectionSnapshot,
  explicitVersionId?: string | null,
): WorkbenchVersion | null {
  const selectedId = defaultSourceVersionId(snapshot, explicitVersionId);
  return selectedId
    ? snapshot.versions.find((version) => version.id === selectedId) ?? null
    : null;
}

export function defaultSourceVersionId(
  snapshot: WorkbenchInspectionSnapshot,
  explicitVersionId?: string | null,
): string | null {
  const ids = [
    explicitVersionId,
    snapshot.status.currentVersionId,
    publishedVersionId(snapshot),
    orderedVersions(snapshot)[0]?.id,
    snapshot.versions[0]?.id,
  ];
  for (const id of ids) {
    if (id && snapshot.versions.some((version) => version.id === id)) {
      return id;
    }
  }
  return null;
}

export function orderedVersions(snapshot: WorkbenchInspectionSnapshot): WorkbenchVersion[] {
  return [...snapshot.versions].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id)
  );
}

export function publishedVersionId(snapshot: WorkbenchInspectionSnapshot): string | null {
  return snapshot.publication?.currentVersionId ?? snapshot.refs["publication/current-version"] ?? null;
}
