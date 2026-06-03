import { describe, expect, test } from "vitest";

import {
  buildWorkbenchLocationHref,
  createBenchmarkRoute,
  createCandidateRoute,
  createCandidatesRoute,
  createEvaluationCaseRoute,
  createEvaluationRoute,
  createEvaluationsRoute,
  parseWorkbenchLocation,
} from "../src/lib/routes";

const base = "/benchmarks/alice/demo";
const route = (pathname: string, search = "") =>
  parseWorkbenchLocation({ pathname: `${base}${pathname}`, search }, base);

describe("workbench location routes", () => {
  test("makes benchmark tabs directly addressable", () => {
    expect(route("/manifest", "?benchmarkFingerprint=abc123")).toMatchObject({
      kind: "benchmark",
      benchmarkFingerprint: "abc123",
      benchmarkView: "manifest",
    });
    expect(route("/files", "?file=tasks%2Fcase%2Ftask.yaml&dir=tasks%2Fcase&view=raw")).toMatchObject({
      kind: "benchmark",
      benchmarkView: "files",
      benchmarkFilePath: "tasks/case/task.yaml",
      benchmarkDirectoryPath: "tasks/case",
      benchmarkPreviewMode: "raw",
    });

    expect(buildWorkbenchLocationHref(createBenchmarkRoute({ benchmarkView: "manifest" }), base))
      .toBe(`${base}/manifest`);
    expect(buildWorkbenchLocationHref(createBenchmarkRoute({
      benchmarkView: "files",
      benchmarkFilePath: "tasks/case/task.yaml",
      benchmarkDirectoryPath: "tasks/case",
      benchmarkPreviewMode: "raw",
      benchmarkFingerprint: "abc123",
    }), base)).toBe(`${base}/files?benchmarkFingerprint=abc123&file=tasks%2Fcase%2Ftask.yaml&dir=tasks%2Fcase&view=raw`);
  });

  test("uses path segments for candidate index tabs and preserves benchmark context", () => {
    const benchmark = {
      benchmarkFingerprint: "abc123",
      benchmarkView: "files" as const,
      benchmarkFilePath: "tasks/case/task.yaml",
      benchmarkDirectoryPath: null,
      benchmarkPreviewMode: "raw" as const,
    };

    expect(route("/candidates/lineage", "?benchmarkFingerprint=abc123&benchmark=files&benchmarkFile=tasks%2Fcase%2Ftask.yaml&benchmarkView=raw"))
      .toMatchObject({ kind: "candidates", ...benchmark, view: "lineage" });
    expect(buildWorkbenchLocationHref(createCandidatesRoute({ view: "lineage", benchmark }), base))
      .toBe(`${base}/candidates/lineage?benchmarkFingerprint=abc123&benchmark=files&benchmarkFile=tasks%2Fcase%2Ftask.yaml&benchmarkView=raw`);
    expect(buildWorkbenchLocationHref(createCandidateRoute({
      candidateId: "candidate_files",
      view: "files",
      filePath: "src/prompt.md",
      directoryPath: "src",
      previewMode: "raw",
      benchmark,
    }), base)).toBe(`${base}/candidates/candidate_files/files?benchmarkFingerprint=abc123&benchmark=files&benchmarkFile=tasks%2Fcase%2Ftask.yaml&benchmarkView=raw&file=src%2Fprompt.md&dir=src&view=raw`);
  });

  test("uses first-class routes for evaluation details and cases", () => {
    const benchmark = { benchmarkView: "manifest" as const };

    expect(route("/evaluations/eval_123", "?benchmark=manifest"))
      .toMatchObject({
        kind: "evaluation",
        benchmarkView: "manifest",
        evaluationId: "eval_123",
        caseId: null,
        caseTab: "score",
      });
    expect(route("/evaluations/eval_123/cases/case-001/attempts", "?benchmark=manifest"))
      .toMatchObject({
        kind: "evaluation",
        evaluationId: "eval_123",
        caseId: "case-001",
        caseTab: "attempts",
      });
    expect(route("/evaluations/eval_123/cases/case-001/files", "?file=candidate-summary.md&view=raw"))
      .toMatchObject({
        kind: "evaluation",
        evaluationId: "eval_123",
        caseId: "case-001",
        caseTab: "files",
        caseFilePath: "candidate-summary.md",
        casePreviewMode: "raw",
      });

    expect(buildWorkbenchLocationHref(createEvaluationsRoute({ benchmark }), base))
      .toBe(`${base}/evaluations?benchmark=manifest`);
    expect(buildWorkbenchLocationHref(createEvaluationRoute({
      evaluationId: "eval_123",
      benchmark,
    }), base)).toBe(`${base}/evaluations/eval_123?benchmark=manifest`);
    expect(buildWorkbenchLocationHref(createEvaluationCaseRoute({
      evaluationId: "eval_123",
      caseId: "case-001",
      caseTab: "files",
      caseFilePath: "candidate-summary.md",
      casePreviewMode: "raw",
      benchmark,
    }), base)).toBe(`${base}/evaluations/eval_123/cases/case-001/files?benchmark=manifest&file=candidate-summary.md&view=raw`);
  });
});
