import type { CandidateWorkspaceFileSummary } from "../types";

export function pickDefaultCandidateFile(
  files: readonly CandidateWorkspaceFileSummary[],
): string | null {
  if (files.length === 0) {
    return null;
  }

  return files
    .map((entry) => entry.path)
    .sort(compareCandidateFilePreference)[0] ?? null;
}

function compareCandidateFilePreference(
  left: string,
  right: string,
): number {
  const order = scoreCandidateFilePreference(left) - scoreCandidateFilePreference(right);
  if (order !== 0) {
    return order;
  }
  return left.localeCompare(right);
}

function scoreCandidateFilePreference(path: string): number {
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
