import { describe, expect, test } from "vitest";

import {
  buildWorkbenchLocationHref,
  createEvaluationsRoute,
  createSubjectRoute,
  createSubjectsRoute,
  createBenchmarkRoute,
  parseWorkbenchLocation,
} from "../src/lib/routes";

describe("workbench location routes", () => {
  test("parses subject routes under a hosted benchmark mount", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/subjects/subject_123",
          search: "",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "subject",
      subjectId: "subject_123",
      view: "overview",
      filePath: null,
      directoryPath: null,
      previewMode: "rendered",
      dialog: null,
    });

    expect(
      buildWorkbenchLocationHref(
        createSubjectRoute({
          subjectId: "subject_123",
          view: "overview",
        }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/subjects/subject_123");
  });

  test("parses and serializes subject index views under a hosted benchmark mount", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/subjects",
          search: "",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "subjects",
      view: "archive",
    });

    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/subjects",
          search: "?view=lineage",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "subjects",
      view: "lineage",
    });

    expect(
      buildWorkbenchLocationHref(
        createSubjectsRoute({ view: "archive" }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/subjects");

    expect(
      buildWorkbenchLocationHref(
        createSubjectsRoute({ view: "lineage" }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/subjects?view=lineage");
  });

  test("keeps root-mounted package routes unchanged", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/subjects/subject_456/files",
          search: "?file=src%2Fprompt.md&dir=src&view=raw",
        },
        "/",
      ),
    ).toEqual({
      kind: "subject",
      subjectId: "subject_456",
      view: "files",
      filePath: "src/prompt.md",
      directoryPath: "src",
      previewMode: "raw",
      dialog: null,
    });
  });

  test("decodes subject ids after a URL round trip", () => {
    expect(
      buildWorkbenchLocationHref(
        createSubjectRoute({
          subjectId: "Claude Opus A",
          view: "overview",
        }),
        "/",
      ),
    ).toBe("/subjects/Claude%20Opus%20A");

    expect(
      parseWorkbenchLocation(
        {
          pathname: "/subjects/Claude%20Opus%20A",
          search: "",
        },
        "/",
      ),
    ).toEqual({
      kind: "subject",
      subjectId: "Claude Opus A",
      view: "overview",
      filePath: null,
      directoryPath: null,
      previewMode: "rendered",
      dialog: null,
    });
  });

  test("parses and serializes subject manifest routes", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/subjects/subject_123/manifest",
          search: "",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "subject",
      subjectId: "subject_123",
      view: "manifest",
      filePath: null,
      directoryPath: null,
      previewMode: "rendered",
      dialog: null,
    });

    expect(
      buildWorkbenchLocationHref(
        createSubjectRoute({
          subjectId: "subject_123",
          view: "manifest",
        }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/subjects/subject_123/manifest");
  });

  test("parses and serializes contextual subject dialogs", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/subjects/subject_123",
          search: "?evaluation=eval_456",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "subject",
      subjectId: "subject_123",
      view: "overview",
      filePath: null,
      directoryPath: null,
      previewMode: "rendered",
      dialog: { kind: "evaluation", evaluationId: "eval_456" },
    });

  });

  test("keeps subject evaluation case state in the subject route", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/subjects/subject_123",
          search: "?evaluation=eval_456&case=case-001",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "subject",
      subjectId: "subject_123",
      view: "overview",
      filePath: null,
      directoryPath: null,
      previewMode: "rendered",
      dialog: {
        kind: "evaluation",
        evaluationId: "eval_456",
        caseId: "case-001",
      },
    });

    expect(
      buildWorkbenchLocationHref(
        createSubjectRoute({
          subjectId: "subject_123",
          view: "overview",
          dialog: {
            kind: "evaluation",
            evaluationId: "eval_456",
            caseId: "case-001",
          },
        }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/subjects/subject_123?evaluation=eval_456&case=case-001");
  });

  test("parses and serializes evaluation index routes under a hosted benchmark mount", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/evaluations",
          search: "",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "evaluations",
      dialog: null,
    });

    expect(
      buildWorkbenchLocationHref(
        createEvaluationsRoute(),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/evaluations");
  });

  test("parses and serializes evaluation index dialogs", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/evaluations",
          search: "?evaluation=eval_123&case=case-001",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "evaluations",
      dialog: {
        kind: "evaluation",
        evaluationId: "eval_123",
        caseId: "case-001",
      },
    });

    expect(
      buildWorkbenchLocationHref(
        createEvaluationsRoute({
          dialog: {
            kind: "evaluation",
            evaluationId: "eval_123",
            caseId: "case-001",
          },
        }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/evaluations?evaluation=eval_123&case=case-001");
  });

  test("evaluation detail paths fall back to the benchmark route", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/evaluations/eval_123",
          search: "",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "benchmark",
    });
  });

  test("serializes subject files folder directory state", () => {
    expect(
      buildWorkbenchLocationHref(
        createSubjectRoute({
          subjectId: "subject_files",
          view: "files",
          filePath: "src/prompt.md",
          directoryPath: "src",
        }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/subjects/subject_files/files?file=src%2Fprompt.md&dir=src");
  });

  test("builds hrefs with the configured mount path", () => {
    expect(buildWorkbenchLocationHref(createBenchmarkRoute(), "/benchmarks/alice/demo")).toBe("/benchmarks/alice/demo");
    expect(
      buildWorkbenchLocationHref(
        createSubjectsRoute(),
        "benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/subjects");
  });

  test("preserves shell-owned query parameters while serializing workspace route state", () => {
    expect(
      buildWorkbenchLocationHref(
        createBenchmarkRoute(),
        "/benchmarks/alice/demo",
        { source: "cli" },
      ),
    ).toBe("/benchmarks/alice/demo?source=cli");

    expect(
      buildWorkbenchLocationHref(
        createSubjectRoute({
          subjectId: "subject_files",
          view: "files",
          filePath: "src/prompt.md",
          directoryPath: "src",
          previewMode: "raw",
        }),
        "/benchmarks/alice/demo",
        { source: "cli" },
      ),
    ).toBe("/benchmarks/alice/demo/subjects/subject_files/files?source=cli&file=src%2Fprompt.md&dir=src&view=raw");
  });
});
