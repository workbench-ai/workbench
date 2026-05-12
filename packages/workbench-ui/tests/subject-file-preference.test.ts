import { describe, expect, test } from "vitest";

import { pickDefaultSubjectFile } from "../src/lib/subject-file-preference";
import type { SubjectWorkspaceFileSummary } from "../src/types";

describe("subject file preference", () => {
  test("prefers the mounted skill file", () => {
    const files: SubjectWorkspaceFileSummary[] = [
      createFileSummary("helpers/extract.py"),
      createFileSummary("SKILL.md"),
    ];

    expect(pickDefaultSubjectFile(files, null)).toBe("SKILL.md");
  });

  test("falls back to stable mounted file ordering", () => {
    const files: SubjectWorkspaceFileSummary[] = [
      createFileSummary("workflow.yaml"),
      createFileSummary("README.md"),
      createFileSummary("scripts/run.py"),
    ];

    expect(pickDefaultSubjectFile(files, null)).toBe("README.md");
  });
});

function createFileSummary(path: string): SubjectWorkspaceFileSummary {
  return {
    path,
    old_path: null,
    status: "unchanged",
    mime_type: "text/plain",
    preview_kind: "text",
    additions: 0,
    deletions: 0,
  };
}
