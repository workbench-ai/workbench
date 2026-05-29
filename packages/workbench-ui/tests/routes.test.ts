import { describe, expect, test } from "vitest";

import {
  buildWorkbenchLocationHref,
  createEvaluationsRoute,
  createCandidateRoute,
  createCandidatesRoute,
  createBenchmarkRoute,
  parseWorkbenchLocation,
} from "../src/lib/routes";

describe("workbench location routes", () => {
  test("parses candidate routes under a hosted benchmark mount", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/candidates/candidate_123",
          search: "",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "candidate",
      candidateId: "candidate_123",
      view: "overview",
      filePath: null,
      directoryPath: null,
      previewMode: "rendered",
      dialog: null,
    });

    expect(
      buildWorkbenchLocationHref(
        createCandidateRoute({
          candidateId: "candidate_123",
          view: "overview",
        }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/candidates/candidate_123");
  });

  test("parses and serializes candidate index views under a hosted benchmark mount", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/candidates",
          search: "",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "candidates",
      view: "archive",
    });

    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/candidates",
          search: "?view=lineage",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "candidates",
      view: "lineage",
    });

    expect(
      buildWorkbenchLocationHref(
        createCandidatesRoute({ view: "archive" }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/candidates");

    expect(
      buildWorkbenchLocationHref(
        createCandidatesRoute({ view: "lineage" }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/candidates?view=lineage");
  });

  test("keeps root-mounted package routes unchanged", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/candidates/candidate_456/files",
          search: "?file=src%2Fprompt.md&dir=src&view=raw",
        },
        "/",
      ),
    ).toEqual({
      kind: "candidate",
      candidateId: "candidate_456",
      view: "files",
      filePath: "src/prompt.md",
      directoryPath: "src",
      previewMode: "raw",
      dialog: null,
    });
  });

  test("decodes candidate ids after a URL round trip", () => {
    expect(
      buildWorkbenchLocationHref(
        createCandidateRoute({
          candidateId: "Claude Opus A",
          view: "overview",
        }),
        "/",
      ),
    ).toBe("/candidates/Claude%20Opus%20A");

    expect(
      parseWorkbenchLocation(
        {
          pathname: "/candidates/Claude%20Opus%20A",
          search: "",
        },
        "/",
      ),
    ).toEqual({
      kind: "candidate",
      candidateId: "Claude Opus A",
      view: "overview",
      filePath: null,
      directoryPath: null,
      previewMode: "rendered",
      dialog: null,
    });
  });

  test("parses and serializes candidate manifest routes", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/candidates/candidate_123/manifest",
          search: "",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "candidate",
      candidateId: "candidate_123",
      view: "manifest",
      filePath: null,
      directoryPath: null,
      previewMode: "rendered",
      dialog: null,
    });

    expect(
      buildWorkbenchLocationHref(
        createCandidateRoute({
          candidateId: "candidate_123",
          view: "manifest",
        }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/candidates/candidate_123/manifest");
  });

  test("parses and serializes contextual candidate dialogs", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/candidates/candidate_123",
          search: "?evaluation=eval_456",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "candidate",
      candidateId: "candidate_123",
      view: "overview",
      filePath: null,
      directoryPath: null,
      previewMode: "rendered",
      dialog: { kind: "evaluation", evaluationId: "eval_456" },
    });

  });

  test("keeps candidate evaluation case state in the candidate route", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/candidates/candidate_123",
          search: "?evaluation=eval_456&case=case-001",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "candidate",
      candidateId: "candidate_123",
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
        createCandidateRoute({
          candidateId: "candidate_123",
          view: "overview",
          dialog: {
            kind: "evaluation",
            evaluationId: "eval_456",
            caseId: "case-001",
          },
        }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/candidates/candidate_123?evaluation=eval_456&case=case-001");
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

  test("evaluation detail paths are explicit not-found routes", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/evaluations/eval_123",
          search: "",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "not-found",
      pathname: "/evaluations/eval_123",
    });
  });

  test("unknown workspace paths are explicit not-found routes", () => {
    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/not-a-route",
          search: "",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "not-found",
      pathname: "/not-a-route",
    });

    expect(
      parseWorkbenchLocation(
        {
          pathname: "/benchmarks/alice/demo/candidates/candidate_123/unknown",
          search: "",
        },
        "/benchmarks/alice/demo",
      ),
    ).toEqual({
      kind: "not-found",
      pathname: "/candidates/candidate_123/unknown",
    });
  });

  test("serializes candidate files folder directory state", () => {
    expect(
      buildWorkbenchLocationHref(
        createCandidateRoute({
          candidateId: "candidate_files",
          view: "files",
          filePath: "src/prompt.md",
          directoryPath: "src",
        }),
        "/benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/candidates/candidate_files/files?file=src%2Fprompt.md&dir=src");
  });

  test("builds hrefs with the configured mount path", () => {
    expect(buildWorkbenchLocationHref(createBenchmarkRoute(), "/benchmarks/alice/demo")).toBe("/benchmarks/alice/demo");
    expect(
      buildWorkbenchLocationHref(
        createCandidatesRoute(),
        "benchmarks/alice/demo",
      ),
    ).toBe("/benchmarks/alice/demo/candidates");
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
        createCandidateRoute({
          candidateId: "candidate_files",
          view: "files",
          filePath: "src/prompt.md",
          directoryPath: "src",
          previewMode: "raw",
        }),
        "/benchmarks/alice/demo",
        { source: "cli" },
      ),
    ).toBe("/benchmarks/alice/demo/candidates/candidate_files/files?source=cli&file=src%2Fprompt.md&dir=src&view=raw");
  });
});
