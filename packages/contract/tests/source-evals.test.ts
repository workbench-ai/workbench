import { describe, expect, test } from "vitest";

import {
  parseWorkbenchEvalDraftRequest,
  parseWorkbenchEvalDraft,
  parseWorkbenchEvalPatch,
  parseWorkbenchOperation,
  parseWorkbenchSourceAnalyzeRequest,
  parseWorkbenchSourceCreateRequest,
  parseWorkbenchSourceOccurrenceQuery,
  parseWorkbenchSourceAnalysisViewQuery,
  parseWorkbenchSourceDetailQuery,
  parseWorkbenchSourceRecordPagePayload,
  parseWorkbenchSourceReviewPatch,
  parseWorkbenchSourceInsight,
  parseWorkbenchSourceWorkflowNode,
  parseWorkbenchSourceWorkflowOccurrence,
  parseWorkbenchSourceSyncCommitRequest,
  parseWorkbenchSourceSyncBatch,
  WorkbenchContractValidationError,
  workbenchSourceRecordPageCanonicalJson,
  workbenchSourceSyncEventCanonicalJson,
} from "../src/index.js";

const HASH = "a".repeat(64);

describe("Source and Eval draft contracts", () => {
  test("accepts a provider-neutral evidence page and canonicalizes it", () => {
    expect(parseWorkbenchSourceCreateRequest({
      schema: "workbench.source.create.v1",
      name: "Synthetic workflow evidence",
    })).toEqual({ schema: "workbench.source.create.v1", name: "Synthetic workflow evidence" });
    expect(() => parseWorkbenchSourceCreateRequest({
      schema: "workbench.source.create.v1",
      name: "Synthetic workflow evidence",
      adapterId: "adapter-specific-leak",
    })).toThrow(WorkbenchContractValidationError);
    const page = parseWorkbenchSourceRecordPagePayload({
      kind: "segments",
      segments: [{
        id: "segment_1",
        text: "Invoice review\nConfirm the payment total.",
        presentation: [
          { kind: "field", label: "Invoice review", value: "Confirm the payment total." },
        ],
      }],
    });

    expect(workbenchSourceRecordPageCanonicalJson(page)).toBe(JSON.stringify(page));
    expect(JSON.stringify(page)).not.toMatch(/provider|adapter|trace|session|message|span/iu);
  });

  test("accepts only bounded ordered sync-event batches", () => {
    const events = [
      ...Array.from({ length: 6 }, (_, index) => ({
        kind: "page",
      recordId: `record_${index}`,
      claimedPageHash: index.toString(16).padStart(64, "0"),
      payload: segmentPage(`Evidence ${index}`),
      })),
      { kind: "record", record: { id: "record_z", bodyHash: "b".repeat(64) } },
      { kind: "finish" },
    ];
    const batch = parseWorkbenchSourceSyncBatch({ schema: "workbench.source.sync-batch.v1", sequence: 20, events });
    expect(batch.events.map((event) => event.kind)).toEqual(["page", "page", "page", "page", "page", "page", "record", "finish"]);
    expect(workbenchSourceSyncEventCanonicalJson(batch.events[6]!)).toBe(JSON.stringify(events[6]));
    expect(() => parseWorkbenchSourceSyncBatch({ schema: "workbench.source.sync-batch.v1", sequence: 0, events: [] }))
      .toThrow(/at least one/u);
    expect(() => parseWorkbenchSourceSyncBatch({ schema: "workbench.source.sync-batch.v1", sequence: 0, events: [...events, { kind: "finish" }] }))
      .toThrow(/exceeds 8/u);
    expect(() => parseWorkbenchSourceSyncBatch({ schema: "workbench.source.sync-batch.v1", sequence: 0, events: [{ kind: "finish" }, events[0]] }))
      .toThrow(/final event/u);
    expect(() => parseWorkbenchSourceSyncBatch({ schema: "workbench.source.sync-batch.v1", sequence: 0, events: [events[6], events[6]] }))
      .toThrow(/duplicate record ids/u);
  });

  test.each([
    ["hidden presentation text", segmentPage("Visible", { kind: "text", text: "Hidden" }), /must occur in segment text/u],
    ["adapter-specific manifest fields", { kind: "manifest", segmentPageHashes: [HASH], segmentCount: 1, textBytes: 1, provider: "anything" }, /unsupported field provider/u],
    ["oversized segments", segmentPage("x".repeat(24 * 1024 + 1)), /24576 bytes/u],
    ["hidden link targets", segmentPage("Workbench", { kind: "link", label: "Workbench", href: "https://example.com" }), /must occur in segment text/u],
    ["hidden attachment metadata", segmentPage("report.pdf application/pdf", { kind: "attachment", label: "report.pdf", mediaType: "application/pdf", size: 42 }), /must occur in segment text/u],
    ["hidden code languages", segmentPage("const x = 1", { kind: "code", text: "const x = 1", language: "typescript" }), /must occur in segment text/u],
    ["unknown page kinds", { kind: "unknown" }, WorkbenchContractValidationError],
  ])("rejects %s", (_case, value, error) => {
    expect(() => parseWorkbenchSourceRecordPagePayload(value)).toThrow(error);
  });

  test("accepts one bounded record root and rejects inconsistent aggregate metadata", () => {
    const segmentHashes = Array.from({ length: 8_192 }, (_, index) => index.toString(16).padStart(64, "0"));
    const root = parseWorkbenchSourceRecordPagePayload({
      kind: "manifest",
      segmentPageHashes: segmentHashes,
      segmentCount: segmentHashes.length,
      textBytes: segmentHashes.length,
    });
    expect(root).toMatchObject({ kind: "manifest", segmentCount: 8_192, textBytes: 8_192 });
    expect(Buffer.byteLength(workbenchSourceRecordPageCanonicalJson(root), "utf8")).toBeLessThan(1024 * 1024);
    expect(() => parseWorkbenchSourceRecordPagePayload({ ...root, segmentCount: 1 })).toThrow(/page capacity/u);
    expect(() => parseWorkbenchSourceRecordPagePayload({ ...root, segmentPageHashes: [...segmentHashes, HASH] })).toThrow(/8192 items/u);
  });

  test("assigns each opaque cursor to an explicit bounded collection", () => {
    expect(parseWorkbenchSourceDetailQuery({ page: "records", cursor: "next", limit: 25 }).page).toBe("records");
    expect(parseWorkbenchSourceAnalysisViewQuery({ view: "workflows", page: "occurrences", cursor: "next", limit: 25 }).page)
      .toBe("occurrences");
    expect(() => parseWorkbenchSourceAnalysisViewQuery({ view: "workflows", page: "insights", cursor: "next", limit: 25 }))
      .toThrow(/does not belong/u);
    expect(() => parseWorkbenchSourceDetailQuery({ page: "records", limit: 257 })).toThrow(/must not exceed/u);
    expect(parseWorkbenchSourceOccurrenceQuery({ workflowId: "workflow_1", limit: 25 }).workflowId).toBe("workflow_1");
    expect(parseWorkbenchSourceOccurrenceQuery({ unassigned: true, limit: 25 }).unassigned).toBe(true);
    expect(() => parseWorkbenchSourceOccurrenceQuery({ workflowId: "workflow_1", search: "invoice", limit: 25 }))
      .toThrow(/mutually exclusive/u);
    expect(parseWorkbenchSourceAnalysisViewQuery({ view: "review", page: "review", decision: "kept", limit: 25 }).decision)
      .toBe("kept");
    expect(() => parseWorkbenchSourceAnalysisViewQuery({ view: "review", page: "review", decision: "unreviewed", limit: 25 }))
      .toThrow(/kept or dismissed/u);
    expect(() => parseWorkbenchSourceAnalysisViewQuery({ view: "review", page: "review", limit: 25 }))
      .toThrow(/decision filter/u);
  });

  test("accepts exactly one review mutation", () => {
    const patch = parseWorkbenchSourceReviewPatch({
      schema: "workbench.source.review-patch.v1",
      expectedVersion: 3,
      mutation: { kind: "keep", workflowId: "workflow_1" },
    });
    expect(patch.mutation.kind).toBe("keep");
    expect(() => parseWorkbenchSourceReviewPatch({
      ...patch,
      mutations: [patch.mutation],
    })).toThrow(/unsupported field mutations/u);
    expect(() => parseWorkbenchSourceReviewPatch({
      ...patch,
      mutation: { kind: "keep", workflowId: "workflow_1", item: { kind: "workflow", id: "workflow_1" } },
    })).toThrow(/unsupported field item/u);
  });

  test("validates coverage totals and bounded model authorization", () => {
    expect(parseWorkbenchSourceSyncCommitRequest({
      schema: "workbench.source.sync-commit.v1",
      coverage: {
        records: 1,
        segments: 2,
        bytes: 20,
        omittedItems: 1,
        omittedBytes: 4,
        omissions: [{ reason: "unsupported binary", items: 1, bytes: 4 }],
      },
    }).coverage.omittedItems).toBe(1);
    expect(() => parseWorkbenchSourceSyncCommitRequest({
      schema: "workbench.source.sync-commit.v1",
      coverage: { records: 1, segments: 2, bytes: 20, omittedItems: 2, omittedBytes: 4, omissions: [] },
    })).toThrow(/totals/u);
    expect(parseWorkbenchSourceAnalyzeRequest({
      schema: "workbench.source.analyze-request.v1",
      selection: { kind: "window", recordOffset: 0, recordLimit: 10 },
      map: "omit",
      authorization: { token: "signed-token", maximumCostUsd: 12.5 },
    }).selection).toEqual({ kind: "window", recordOffset: 0, recordLimit: 10 });
    expect(parseWorkbenchOperation(operation(
      { completed: 1, total: 2, message: "Identifying workflows" },
      { inputTokens: 10, outputTokens: 4, modelCalls: 1, costUsd: 0.02 },
    )).usage?.costUsd).toBe(0.02);
    expect(parseWorkbenchOperation({ ...operation({ completed: 1, total: 2 }), status: "failed", failureCode: "authorization_exhausted" }).failureCode).toBe("authorization_exhausted");
    expect(() => parseWorkbenchOperation({ ...operation({ completed: 1, total: 2 }), failureCode: "guess" })).toThrow(/failure code/u);
    expect(() => parseWorkbenchOperation(operation({ completed: 2, total: 1 }))).toThrow(/must not exceed/u);
  });

  test("limits Eval drafts to canonical Eval files and kept workflow ids", () => {
    const request = parseWorkbenchEvalDraftRequest({
      schema: "workbench.eval-draft.request.v1",
      sourceId: "source_1",
      snapshotId: "snapshot_1",
      analysisId: "analysis_1",
      reviewVersion: 2,
      reviewHash: HASH,
      workflowIds: ["workflow_1"],
      objective: "The agent produces a correct invoice summary.",
      destination: { kind: "local", skillName: "invoice-skill" },
      baseFiles: [{ path: "eval.yaml", content: "grade:\n  with: tests\n" }],
    });
    expect(request.destination.kind).toBe("local");
    expect(() => parseWorkbenchEvalDraftRequest({ ...request, destination: { kind: "local", skillName: "invoice-skill", baseHash: HASH } }))
      .toThrow(/unsupported field baseHash/u);
    expect(() => parseWorkbenchEvalDraftRequest({ ...request, destination: { kind: "hosted", owner: "acme", skill: "invoice", baseHash: HASH }, baseFiles: undefined }))
      .toThrow(/unsupported field baseHash/u);
    expect(() => parseWorkbenchEvalDraftRequest({ ...request, destination: { kind: "local", skillName: "invoice-skill", evalId: "eval_1" } }))
      .toThrow(/unsupported field evalId/u);
    expect(parseWorkbenchEvalDraftRequest({
      ...request,
      destination: { kind: "hosted", owner: "acme", skill: "invoice" },
      baseFiles: undefined,
    }).destination).toEqual({ kind: "hosted", owner: "acme", skill: "invoice" });
    expect(() => parseWorkbenchEvalPatch({
      schema: "workbench.eval.patch.v1",
      changes: [{ kind: "put", file: { path: "../SKILL.md", content: "bad" } }],
    })).toThrow(/unsafe/u);
    expect(() => parseWorkbenchEvalDraftRequest({ ...request, workflowIds: [] })).toThrow(/at least one workflow/u);
    expect(() => parseWorkbenchEvalDraftRequest({ ...request, objective: " \t\n" })).toThrow(/non-whitespace/u);
    expect(() => parseWorkbenchEvalPatch({
      schema: "workbench.eval.patch.v1",
      changes: [{ kind: "put", file: { path: "environment/blob", kind: "binary", encoding: "base64", content: "not base64" } }],
    })).toThrow(/canonical base64/u);
  });

  test("strictly bounds model-produced workflows, insights, and Eval evidence", () => {
    expect(parseWorkbenchSourceWorkflowOccurrence({
      id: "occurrence_1",
      summary: "The user reviews an invoice.",
      citationIds: ["citation_1"],
      workflowId: "workflow_1",
    }).citationIds).toEqual(["citation_1"]);
    expect(parseWorkbenchSourceWorkflowNode({
      kind: "workflow",
      id: "workflow_1",
      parentId: "category_1",
      name: "Review invoice",
      description: "Checks invoice details.",
      occurrenceCount: 1,
      representativeCitationIds: ["citation_1"],
    }).kind).toBe("workflow");
    expect(() => parseWorkbenchSourceInsight({
      id: "insight_1",
      statement: "Review is repetitive.",
      implication: "Automate checks.",
      workflowCount: 0,
      supportingCitationCount: 1,
      contradictingCitationCount: 0,
      representativeWorkflowIds: ["workflow_1"],
      representativeSupportingCitationIds: ["citation_1"],
      representativeContradictingCitationIds: [],
    })).toThrow(/exceed workflowCount/u);
    const draft = {
      schema: "workbench.eval-draft.v1",
      id: "draft_1",
      sourceId: "source_1",
      snapshotId: "snapshot_1",
      analysisId: "analysis_1",
      reviewVersion: 1,
      reviewHash: HASH,
      workflows: [{
        id: "workflow_1",
        name: "Review invoice",
        description: "Checks invoice details.",
        citationIds: ["citation_1"],
      }],
      evidence: [{ citationId: "citation_1", quote: "The user checks the invoice totals." }],
      objective: "Test invoice review.",
      destination: { kind: "local", skillName: "invoice" },
      baseHash: HASH,
      expectedResultHash: HASH,
      patch: { schema: "workbench.eval.patch.v1", changes: [] },
      rationale: "Covers the reviewed workflow.",
      citationIds: ["citation_1"],
      status: "ready",
      usage: { inputTokens: 1, outputTokens: 1, modelCalls: 1 },
      createdAt: "2026-07-14T00:00:00.000Z",
    };
    expect(parseWorkbenchEvalDraft(draft).id).toBe("draft_1");
    expect(() => parseWorkbenchEvalDraft({ ...draft, objective: " \t\n" })).toThrow(/non-whitespace/u);
    expect(parseWorkbenchEvalDraft({ ...draft, status: "discarded", discarded: { actor: "user_1", at: "2026-07-14T01:00:00.000Z" } }).status).toBe("discarded");
    expect(() => parseWorkbenchEvalDraft({ ...draft, status: "discarded" })).toThrow(/status and metadata must agree/u);
    expect(() => parseWorkbenchEvalDraft({ ...draft, evidence: [{ citationId: "citation_2", quote: "Other evidence." }] }))
      .toThrow(/unreviewed id citation_1/u);
  });
});

function segmentPage(text: string, presentation?: Record<string, unknown>) {
  return { kind: "segments", segments: [{ id: "segment_1", text, ...(presentation ? { presentation: [presentation] } : {}) }] };
}

function operation(progress: Record<string, unknown>, usage?: Record<string, unknown>) {
  return {
    schema: "workbench.operation.v1", id: "operation_1", owner: "source", kind: "source.analyze", targetId: "source_1", status: "running",
    progress, ...(usage ? { usage } : {}),
    createdAt: "2026-07-14T00:00:00.000Z", updatedAt: "2026-07-14T00:00:01.000Z",
  };
}
