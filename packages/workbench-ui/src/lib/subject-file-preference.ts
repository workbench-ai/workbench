import type {
  SubjectWorkspaceFileSummary,
  AuthoredWorkbenchSourceDocument,
} from "../types";

export function pickDefaultSubjectFile(
  files: readonly SubjectWorkspaceFileSummary[],
  _specDocument: AuthoredWorkbenchSourceDocument | null,
): string | null {
  if (files.length === 0) {
    return null;
  }

  return files
    .map((entry) => entry.path)
    .sort(compareSubjectFilePreference)[0] ?? null;
}

function compareSubjectFilePreference(
  left: string,
  right: string,
): number {
  const order = scoreSubjectFilePreference(left) - scoreSubjectFilePreference(right);
  if (order !== 0) {
    return order;
  }
  return left.localeCompare(right);
}

function scoreSubjectFilePreference(path: string): number {
  if (isSkillFile(path)) {
    return 0;
  }
  if (path.endsWith(".md")) {
    return 1;
  }
  if (path.endsWith(".yaml") || path.endsWith(".yml")) {
    return 2;
  }
  return 3;
}

function isSkillFile(path: string): boolean {
  return path.endsWith("/SKILL.md") || path === "SKILL.md";
}
