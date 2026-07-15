import { describe, expect, test } from "vitest";

import type { WorkbenchEvalPatch } from "@workbench-ai/workbench-contract";
import {
  applyWorkbenchEvalPatch,
  hashFiles,
  WorkbenchEvalPatchConflictError,
} from "../src/index.js";

describe("Eval patch application", () => {
  const base = [{ path: "eval.yaml", content: "grade:\n  with: tests\n" }];
  const patch: WorkbenchEvalPatch = {
    schema: "workbench.eval.patch.v1",
    changes: [{ kind: "put", file: { path: "cases/invoice/case.yaml", content: "prompt: Review invoice\n" } }],
  };
  const result = [...base, patch.changes[0]!.kind === "put" ? patch.changes[0]!.file : never()]
    .sort((left, right) => left.path.localeCompare(right.path));

  test("applies once and recognizes an already-applied retry", () => {
    const applied = applyWorkbenchEvalPatch({
      baseFiles: base,
      baseHash: hashFiles(base),
      expectedResultHash: hashFiles(result),
      patch,
    });
    expect(applied.files).toEqual(result);
    expect(applied.alreadyApplied).toBe(false);
    expect(applyWorkbenchEvalPatch({
      baseFiles: applied.files,
      baseHash: hashFiles(base),
      expectedResultHash: applied.resultHash,
      patch,
    }).alreadyApplied).toBe(true);
  });

  test("rejects stale bases and unexpected result hashes", () => {
    expect(() => applyWorkbenchEvalPatch({
      baseFiles: base,
      baseHash: "0".repeat(64),
      expectedResultHash: hashFiles(result),
      patch,
    })).toThrow(WorkbenchEvalPatchConflictError);
    expect(() => applyWorkbenchEvalPatch({
      baseFiles: base,
      baseHash: hashFiles(base),
      expectedResultHash: "f".repeat(64),
      patch,
    })).toThrow(/result hash mismatch/u);
  });
});

function never(): never {
  throw new Error("unreachable");
}
