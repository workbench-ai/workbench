import type { SubjectWorkspaceFileSummary } from "../types";

const PREVIEW_KIND_RANK: Record<SubjectWorkspaceFileSummary["preview_kind"], number> = {
  pdf: 0,
  markdown: 1,
  image: 2,
  table: 3,
  spreadsheet: 4,
  text: 5,
  unsupported: 6,
};

export function orderSubjectFiles(
  files: ReadonlyArray<SubjectWorkspaceFileSummary>,
): SubjectWorkspaceFileSummary[] {
  return [...files].sort((left, right) => {
    const rankDelta = rankSubjectFile(left) - rankSubjectFile(right);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return left.path.localeCompare(right.path);
  });
}

function rankSubjectFile(file: SubjectWorkspaceFileSummary): number {
  const path = file.path.toLowerCase();
  let rank = PREVIEW_KIND_RANK[file.preview_kind];

  if (path.endsWith("/skill.md") || path === "skill.md") {
    rank -= 4;
  }
  if (path.endsWith(".yaml") || path.endsWith(".yml")) {
    rank -= 1;
  }
  if (path.endsWith(".pdf")) {
    rank -= 2;
  }
  return rank;
}
