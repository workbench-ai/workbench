import { describe, expect, test } from "vitest";

import { pickDefaultCandidateFile } from "../src/lib/candidate-file-preference";
import type { CandidateWorkspaceFileSummary } from "../src/types";

describe("candidate file preference", () => {
  test("prefers the mounted skill file", () => {
    const files: CandidateWorkspaceFileSummary[] = [
      createFileSummary("helpers/extract.py"),
      createFileSummary("SKILL.md"),
    ];

    expect(pickDefaultCandidateFile(files)).toBe("SKILL.md");
  });

  test("falls back to stable mounted file ordering", () => {
    const files: CandidateWorkspaceFileSummary[] = [
      createFileSummary("workflow.yaml"),
      createFileSummary("README.md"),
      createFileSummary("scripts/run.py"),
    ];

    expect(pickDefaultCandidateFile(files)).toBe("README.md");
  });
});

function createFileSummary(path: string): CandidateWorkspaceFileSummary {
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
