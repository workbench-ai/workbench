import { describe, expect, test } from "vitest";

import {
  buildWorkbenchLocationHref,
  createSubjectRoute,
  createSubjectsRoute,
  createRunRoute,
  createBenchmarkRoute,
  parseWorkbenchLocation,
} from "../src/lib/routes";

describe("workbench location routes", () => {
  test("parses subject routes under a hosted benchmark mount", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/subject/subject_123/evaluation",
          search: "",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "subject",
      subjectId: "subject_123",
      view: "evaluation",
      filePath: null,
      directoryPath: null,
      previewMode: "rendered",
      reviewCaseId: null,
      reviewTab: "overview",
      reviewRunId: null,
    });
  });

  test("keeps root-mounted package routes unchanged", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/subject/subject_456/files",
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
      reviewCaseId: null,
      reviewTab: "overview",
      reviewRunId: null,
    });
  });

  test("parses and serializes subject manifest routes", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/subject/subject_123/manifest",
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
      reviewCaseId: null,
      reviewTab: "overview",
      reviewRunId: null,
    });

    expect(
      buildWorkbenchLocationHref(
        createSubjectRoute({
          subjectId: "subject_123",
          view: "manifest",
        }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/subject/subject_123/manifest");
  });

  test("parses and serializes subject task review deep links", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/subject/subject_123/evaluation",
          search: "?task=task-001&tab=trace&run=run_123",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "subject",
      subjectId: "subject_123",
      view: "evaluation",
      filePath: null,
      directoryPath: null,
      previewMode: "rendered",
      reviewCaseId: "task-001",
      reviewTab: "trace",
      reviewRunId: "run_123",
    });

    expect(
      buildWorkbenchLocationHref(
        createSubjectRoute({
          subjectId: "subject_123",
          view: "evaluation",
          reviewCaseId: "task-001",
          reviewTab: "trace",
          reviewRunId: "run_123",
        }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/subject/subject_123/evaluation?task=task-001&tab=trace&run=run_123");
  });

  test("parses and serializes run routes under a hosted benchmark mount", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/runs/run_123",
          search: "",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "run",
      runId: "run_123",
    });

    expect(
      buildWorkbenchLocationHref(
        createRunRoute({ runId: "run_123" }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/runs/run_123");
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
    ).toBe("/benchmarks/alice/demo/subject/subject_files/files?file=src%2Fprompt.md&dir=src");
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
    ).toBe("/benchmarks/alice/demo/subject/subject_files/files?source=cli&file=src%2Fprompt.md&dir=src&view=raw");
  });
});
