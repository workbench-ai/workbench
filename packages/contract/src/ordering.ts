import type { WorkbenchSkillVersion, WorkbenchVersion } from "./index.js";

export function compareWorkbenchNaturalText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

export function compareWorkbenchVersions(left: WorkbenchVersion, right: WorkbenchVersion): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function workbenchSkillVersionIdentity(version: WorkbenchSkillVersion | undefined): string {
  return version?.projectVersionId ?? version?.id ?? "";
}
