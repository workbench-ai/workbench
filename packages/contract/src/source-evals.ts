import type { SurfaceSnapshotFile } from "./index.js";

/** A caller-supplied Workbench payload violated the public wire contract. */
export class WorkbenchContractValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbenchContractValidationError";
  }
}

export const WORKBENCH_SOURCE_LIMITS = {
  idCharacters: 256,
  labelCharacters: 512,
  segmentTextBytes: 24 * 1024,
  pageBytes: 1024 * 1024,
  cursorBytes: 128 * 1024 * 1024,
  cursorJsonNodes: 5_000_000,
  syncEventsPerBatch: 8,
  segmentsPerPage: 256,
  segmentPagesPerRecord: 8_192,
  presentationBlocksPerSegment: 64,
  evalPatchChanges: 512,
  evalBaseFiles: 2_048,
  evalBaseBytes: 16 * 1024 * 1024,
  representativeIds: 16,
  reviewEvidenceIds: 256,
  taxonomyDepth: 16,
  recordLookupIds: 256,
  analysisWindowRecords: 100_000,
} as const;

export type WorkbenchSourceEvidenceBlock =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string; language?: string }
  | { kind: "field"; label: string; value: string }
  | { kind: "link"; label: string; href: string }
  | { kind: "attachment"; label: string; mediaType?: string; size?: number };

export interface WorkbenchSourceEvidenceSegment {
  id: string;
  text: string;
  presentation?: WorkbenchSourceEvidenceBlock[];
}

export type WorkbenchSourceRecordPagePayload =
  | { kind: "segments"; segments: WorkbenchSourceEvidenceSegment[] }
  | { kind: "manifest"; segmentPageHashes: string[]; segmentCount: number; textBytes: number };

export interface WorkbenchSourceRecordEntry {
  id: string;
  bodyHash: string;
  label?: string;
  occurredAt?: string;
}

export interface WorkbenchSourceRecordRef extends WorkbenchSourceRecordEntry {
  segmentCount: number;
  textBytes: number;
}

export interface WorkbenchSourceLargestRecord {
  recordOffset: number;
  record: WorkbenchSourceRecordRef;
}

export interface WorkbenchSourceRecordLookupRequest {
  schema: "workbench.source.record-lookup.v1";
  ids: string[];
}

export interface WorkbenchSourceRecordLookupResponse {
  schema: "workbench.source.record-lookup-result.v1";
  records: WorkbenchSourceRecordRef[];
}

export type WorkbenchSourceSyncEvent =
  | { kind: "page"; recordId: string; claimedPageHash: string; payload: WorkbenchSourceRecordPagePayload }
  | { kind: "record"; record: WorkbenchSourceRecordEntry }
  | { kind: "finish" };

export interface WorkbenchSourceSyncBatch {
  schema: "workbench.source.sync-batch.v1";
  sequence: number;
  events: WorkbenchSourceSyncEvent[];
}

export interface WorkbenchSourceSyncSession {
  schema: "workbench.source.sync-session.v1";
  id: string;
  sourceId: string;
  baseSnapshotId?: string;
  nextSequence: number;
  prefixHash?: string;
  status: "open" | "committed" | "aborted";
}

export interface WorkbenchSourceSyncCommitRequest {
  schema: "workbench.source.sync-commit.v1";
  coverage: WorkbenchSourceSyncCoverage;
}

export type WorkbenchSourceSyncCommitResponse =
  | {
      schema: "workbench.source.sync-commit-progress.v1";
      processedRecords: number;
      totalRecords: number;
    }
  | {
      schema: "workbench.source.sync-commit-result.v1";
      source: WorkbenchSource;
      snapshot: WorkbenchEvidenceSnapshot;
    };

export interface WorkbenchSourceCreateRequest {
  schema: "workbench.source.create.v1";
  name: string;
}

export interface WorkbenchSourceSyncCoverage {
  records: number;
  segments: number;
  bytes: number;
  omittedItems: number;
  omittedBytes: number;
  omissions: Array<{ reason: string; items: number; bytes: number }>;
}

export interface WorkbenchEvidenceSnapshot {
  schema: "workbench.source.evidence-snapshot.v1";
  id: string;
  sourceId: string;
  recordCount: number;
  coverage: WorkbenchSourceSyncCoverage;
  createdAt: string;
}

export interface WorkbenchSource {
  schema: "workbench.source.v1";
  id: string;
  namespaceId: string;
  name: string;
  currentSnapshotId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchSourceAnalysisSummary {
  id: string;
  snapshotId: string;
  coverage: WorkbenchSourceAnalysisCoverage;
  workflowCount: number;
  insightCount: number;
  createdAt: string;
}

export interface WorkbenchSourceSummary {
  source: WorkbenchSource;
  lastSuccessfulSyncAt?: string;
  recordCount: number;
  syncCoverage?: WorkbenchSourceSyncCoverage;
  latestAnalysis?: WorkbenchSourceAnalysisSummary;
}

export interface WorkbenchSourceListResponse {
  schema: "workbench.source.list.v1";
  sources: WorkbenchSourcePage<WorkbenchSourceSummary>;
  capabilities: WorkbenchProductCapabilities;
}

export interface WorkbenchSourceDetailResponse {
  schema: "workbench.source.detail.v1";
  source: WorkbenchSourceSummary;
  analyses: WorkbenchSourcePage<WorkbenchSourceAnalysisSummary>;
  records: WorkbenchSourcePage<WorkbenchSourceRecordRef>;
  largestRecords: WorkbenchSourceLargestRecord[];
  capabilities: WorkbenchProductCapabilities;
}

export interface WorkbenchSourceDetailQuery {
  page: "analyses" | "records";
  cursor?: string;
  limit: number;
}

export interface WorkbenchSourceCitation {
  id: string;
  recordId: string;
  recordBodyHash: string;
  segmentId: string;
  start: number;
  end: number;
  quoteHash: string;
}

export interface WorkbenchSourceWorkflowOccurrence {
  id: string;
  summary: string;
  citationIds: string[];
  workflowId?: string;
}

export type WorkbenchSourceWorkflowNode =
  | {
      kind: "category";
      id: string;
      parentId?: string;
      name: string;
      description: string;
      occurrenceCount: number;
      childCount: number;
    }
  | {
      kind: "workflow";
      id: string;
      parentId: string;
      name: string;
      description: string;
      occurrenceCount: number;
      representativeCitationIds: string[];
    };

export interface WorkbenchSourceInsight {
  id: string;
  statement: string;
  implication: string;
  workflowCount: number;
  supportingCitationCount: number;
  contradictingCitationCount: number;
  representativeWorkflowIds: string[];
  representativeSupportingCitationIds: string[];
  representativeContradictingCitationIds: string[];
}

export interface WorkbenchSourceAnalysisCoverage {
  recordOffset: number;
  selectedRecords: number;
  selectedSegments: number;
  selectedBytes: number;
  analyzedSegments: number;
  analyzedBytes: number;
  partial: boolean;
  nextRecordOffset?: number;
  remainingRecords: number;
  omissions: Array<{ reason: string; items: number; bytes: number }>;
}

export interface WorkbenchModelUsage {
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  costUsd?: number;
}

export interface WorkbenchSourceAnalysis {
  schema: "workbench.source.analysis.v1";
  id: string;
  sourceId: string;
  snapshotId: string;
  rootNodeId: string;
  workflowCount: number;
  categoryCount: number;
  occurrenceCount: number;
  insightCount: number;
  unassignedOccurrenceCount: number;
  selection: WorkbenchSourceAnalyzeRequest["selection"];
  coverage: WorkbenchSourceAnalysisCoverage;
  usage: WorkbenchModelUsage;
  provenance: { model: string; revision?: string; promptHash: string };
  mapState: "unavailable" | "pending" | "ready" | "failed";
  createdAt: string;
}

export interface WorkbenchSourcePage<T> {
  items: T[];
  nextCursor?: string;
}

export interface WorkbenchSourceEvidenceContext {
  citation: WorkbenchSourceCitation;
  segment: WorkbenchSourceEvidenceSegment;
  quote: string;
}

export interface WorkbenchSourceWorkflowTreePage {
  /** Root, selected category, or selected workflow leaf. */
  node: WorkbenchSourceWorkflowNode;
  /** Root-to-parent category path; bounded by taxonomyDepth. */
  ancestors: Array<Extract<WorkbenchSourceWorkflowNode, { kind: "category" }>>;
  /** Direct children only. Empty for a workflow leaf. */
  children: WorkbenchSourcePage<WorkbenchSourceWorkflowNode>;
}

export type WorkbenchSourceAnalysisViewQuery =
  | {
      view: "workflows";
      page: "nodes";
      cursor?: string;
      limit: number;
      nodeId?: string;
    }
  | {
      view: "workflows";
      page: "occurrences";
      cursor?: string;
      limit: number;
    }
  | {
      view: "insights";
      page: "insights";
      cursor?: string;
      limit: number;
      insightId?: string;
    }
  | {
      view: "review";
      page: "review";
      cursor?: string;
      limit: number;
      decision: "kept" | "dismissed";
    };

export type WorkbenchSourceAnalysisViewResponse =
  | {
      schema: "workbench.source.analysis-view.v1";
      view: "workflows";
      analysis: WorkbenchSourceAnalysis;
      tree: WorkbenchSourceWorkflowTreePage;
      occurrences: WorkbenchSourcePage<WorkbenchSourceWorkflowOccurrence>;
      review: WorkbenchSourceAnalysisReview;
      reviewItems: WorkbenchSourcePage<WorkbenchSourceReviewItemState>;
      capabilities: WorkbenchProductCapabilities;
    }
  | {
      schema: "workbench.source.analysis-view.v1";
      view: "insights";
      analysis: WorkbenchSourceAnalysis;
      insights: WorkbenchSourcePage<WorkbenchSourceInsight>;
      capabilities: WorkbenchProductCapabilities;
    }
  | {
      schema: "workbench.source.analysis-view.v1";
      view: "review";
      analysis: WorkbenchSourceAnalysis;
      review: WorkbenchSourceAnalysisReview;
      reviewItems: WorkbenchSourcePage<WorkbenchSourceReviewItemState>;
      workflows: WorkbenchSourceWorkflowNode[];
      capabilities: WorkbenchProductCapabilities;
    };

export interface WorkbenchSourceMapProjection {
  schema: "workbench.source.map-projection.v1";
  analysisId: string;
  projectionRevision: string;
  pointCount: number;
}

/** Durable projection coordinates. Workflow assignment remains Analysis state. */
export interface WorkbenchSourceProjectionPoint {
  occurrenceId: string;
  x: number;
  y: number;
}

/** Bounded read DTO derived from projection coordinates and immutable occurrence assignment. */
export interface WorkbenchSourceMapPoint {
  occurrenceId: string;
  workflowId?: string;
  workflowPathIds?: string[];
  x: number;
  y: number;
}

export interface WorkbenchSourceMapResponse {
  schema: "workbench.source.map.v1";
  analysis: WorkbenchSourceAnalysis;
  projection?: WorkbenchSourceMapProjection;
  points: WorkbenchSourcePage<WorkbenchSourceMapPoint>;
  capabilities: WorkbenchProductCapabilities;
}

export interface WorkbenchSourceEvidenceResponse {
  schema: "workbench.source.evidence.v1";
  evidence: WorkbenchSourceEvidenceContext;
  capabilities: WorkbenchProductCapabilities;
}

export interface WorkbenchSourceOccurrenceQuery {
  ids?: string[];
  search?: string;
  workflowId?: string;
  unassigned?: true;
  cursor?: string;
  limit: number;
}

export interface WorkbenchSourceOccurrenceLookupResponse {
  schema: "workbench.source.occurrence-lookup.v1";
  analysis: WorkbenchSourceAnalysis;
  occurrences: WorkbenchSourcePage<WorkbenchSourceWorkflowOccurrence>;
  capabilities: WorkbenchProductCapabilities;
}

export type WorkbenchSourceReviewDecisionValue = "unreviewed" | "kept" | "dismissed";
export interface WorkbenchSourceAnalysisReview {
  schema: "workbench.source.analysis-review.v1";
  analysisId: string;
  version: number;
  hash: string;
  workflowCount: number;
  keptWorkflowCount: number;
  dismissedWorkflowCount: number;
  updatedBy: string;
  updatedAt: string;
}

export interface WorkbenchSourceReviewItemState {
  workflowId: string;
  decision: WorkbenchSourceReviewDecisionValue;
}

export interface WorkbenchSourceReviewMutation {
  kind: "keep" | "dismiss";
  workflowId: string;
}

export interface WorkbenchSourceReviewPatch {
  schema: "workbench.source.review-patch.v1";
  expectedVersion: number;
  mutation: WorkbenchSourceReviewMutation;
}

export interface WorkbenchModelAuthorization {
  token: string;
  maximumCostUsd: number;
}

export interface WorkbenchSourceAnalyzeRequest {
  schema: "workbench.source.analyze-request.v1";
  snapshotId?: string;
  selection: { kind: "all" } | { kind: "window"; recordOffset: number; recordLimit: number };
  map: "include" | "omit";
  authorization?: WorkbenchModelAuthorization;
}

export type WorkbenchModelOperationKind = "source.analyze" | "eval.draft";
export interface WorkbenchModelPreflight {
  schema: "workbench.model-preflight.v1";
  token: string;
  kind: WorkbenchModelOperationKind;
  model: string;
  revision?: string;
  locality: string;
  egress: "none" | "evidence" | "summaries";
  egressDescription: string;
  /** Explicit presentation projection choice for Source analysis preflights. */
  map?: "include" | "omit";
  scope: {
    description: string;
    itemCount: number;
    byteCount: number;
    partial?: boolean;
    window?: { offset: number; selected: number; remaining: number; nextOffset?: number };
  };
  maximumInputTokens: number;
  maximumOutputTokens: number;
  presentation?: {
    kind: "map";
    model: string;
    revision?: string;
    locality: string;
    egress: "none" | "summaries";
    egressDescription: string;
    maximumInputTokens: number;
    maximumOutputTokens: number;
    maximumCostUsd: number;
  };
  /** Deterministic ceiling for one complete attempt, before any retry. */
  firstAttemptMaximumModelCalls: number;
  /** Deterministic cost ceiling for one complete attempt, before any retry. */
  firstAttemptMaximumCostUsd: number;
  maximumModelCalls: number;
  maximumRetries: number;
  /** Absolute authorization ceiling including every permitted retry. */
  maximumAuthorizedCostUsd: number;
  currentAuthorizedCostUsd?: number;
  /** Maximum wall-clock authorization lifetime after confirmation. */
  maximumExecutionSeconds: number;
  expiresAt: string;
}

export interface WorkbenchOperation {
  schema: "workbench.operation.v1";
  id: string;
  owner: "source" | "eval";
  kind: WorkbenchModelOperationKind;
  targetId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  progress?: { completed: number; total: number; message?: string };
  /** Actual metered model usage; absent until the operation has made a model call. */
  usage?: WorkbenchModelUsage;
  resultId?: string;
  /** Machine-readable terminal reason used when a larger reviewed cap can resume the same operation. */
  failureCode?: "authorization_exhausted";
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchProductCapabilities {
  sources: {
    read: boolean;
    create: boolean;
    sync: boolean;
    analyze: boolean;
    fullAnalysis: boolean;
    review: boolean;
    map: boolean;
    delete: boolean;
  };
  evals: { draft: boolean; hostedApply: boolean };
}

export type WorkbenchEvalPatchChange =
  | { kind: "put"; file: SurfaceSnapshotFile }
  | { kind: "delete"; path: string };

export interface WorkbenchEvalPatch {
  schema: "workbench.eval.patch.v1";
  changes: WorkbenchEvalPatchChange[];
}

export type WorkbenchEvalDraftDestination =
  | { kind: "local"; skillName: string }
  | { kind: "hosted"; owner: string; skill: string; evalId?: string };

export interface WorkbenchEvalDraftRequest {
  schema: "workbench.eval-draft.request.v1";
  sourceId: string;
  snapshotId: string;
  analysisId: string;
  reviewVersion: number;
  reviewHash: string;
  workflowIds: string[];
  objective: string;
  destination: WorkbenchEvalDraftDestination;
  baseFiles?: SurfaceSnapshotFile[];
  authorization?: WorkbenchModelAuthorization;
}

export interface WorkbenchEvalDraft {
  schema: "workbench.eval-draft.v1";
  id: string;
  sourceId: string;
  snapshotId: string;
  analysisId: string;
  reviewVersion: number;
  reviewHash: string;
  workflows: WorkbenchEvalDraftWorkflow[];
  evidence: WorkbenchEvalDraftEvidence[];
  objective: string;
  destination: WorkbenchEvalDraftDestination;
  baseHash: string;
  expectedResultHash: string;
  patch: WorkbenchEvalPatch;
  rationale: string;
  citationIds: string[];
  status: "ready" | "applied" | "discarded";
  usage: WorkbenchModelUsage;
  createdAt: string;
  applied?: { resultHash: string; actor: string; at: string };
  discarded?: { actor: string; at: string };
}

export interface WorkbenchEvalDraftWorkflow {
  id: string;
  name: string;
  description: string;
  citationIds: string[];
}

export interface WorkbenchEvalDraftEvidence {
  citationId: string;
  quote: string;
}

export interface WorkbenchEvalDraftResponse {
  schema: "workbench.eval-draft.detail.v1";
  draft: WorkbenchEvalDraft;
  capabilities: WorkbenchProductCapabilities;
}

export interface WorkbenchEvalDraftApplyRequest {
  schema: "workbench.eval-draft.apply.v1";
  expectedBaseHash: string;
  resultHash?: string;
}

export function parseWorkbenchSourceRecordPagePayload(value: unknown): WorkbenchSourceRecordPagePayload {
  const record = exactRecord(value, "Source record page", ["kind", "segments", "segmentPageHashes", "segmentCount", "textBytes"]);
  let payload: WorkbenchSourceRecordPagePayload;
  if (record.kind === "segments") {
    exactKeys(record, "Source segment page", ["kind", "segments"]);
    const segments = boundedArray(record.segments, "Source segment page segments", WORKBENCH_SOURCE_LIMITS.segmentsPerPage)
      .map(parseEvidenceSegment);
    if (segments.length === 0) fail("Source segment page must not be empty.");
    if (new Set(segments.map((segment) => segment.id)).size !== segments.length) fail("Source segment ids must be unique within a page.");
    payload = { kind: "segments", segments };
  } else if (record.kind === "manifest") {
    exactKeys(record, "Source manifest page", ["kind", "segmentPageHashes", "segmentCount", "textBytes"]);
    const segmentPageHashes = boundedArray(record.segmentPageHashes, "Source manifest page hashes", WORKBENCH_SOURCE_LIMITS.segmentPagesPerRecord)
      .map((hash) => readHash(hash, "Source segment page hash"));
    if (segmentPageHashes.length === 0) fail("Source manifest page must not be empty.");
    if (new Set(segmentPageHashes).size !== segmentPageHashes.length) fail("Source manifest segment page hashes must be unique.");
    const segmentCount = readPositiveInteger(record.segmentCount, "Source manifest segment count");
    if (segmentCount < segmentPageHashes.length || segmentCount > segmentPageHashes.length * WORKBENCH_SOURCE_LIMITS.segmentsPerPage) {
      fail("Source manifest segment count is outside its bounded page capacity.");
    }
    payload = {
      kind: "manifest",
      segmentPageHashes,
      segmentCount,
      textBytes: readPositiveInteger(record.textBytes, "Source manifest text bytes"),
    };
  } else {
    fail("Source record page kind must be segments or manifest.");
  }
  if (utf8Bytes(workbenchSourceRecordPageCanonicalJson(payload)) > WORKBENCH_SOURCE_LIMITS.pageBytes) {
    fail(`Source record page exceeds ${WORKBENCH_SOURCE_LIMITS.pageBytes} bytes.`);
  }
  return payload;
}

export function workbenchSourceRecordPageCanonicalJson(value: WorkbenchSourceRecordPagePayload): string {
  return JSON.stringify(value.kind === "segments"
    ? { kind: "segments", segments: value.segments.map((segment) => ({
        id: segment.id,
        text: segment.text,
        ...(segment.presentation ? { presentation: segment.presentation.map((block) => ({ ...block })) } : {}),
      })) }
    : {
        kind: "manifest",
        segmentPageHashes: [...value.segmentPageHashes],
        segmentCount: value.segmentCount,
        textBytes: value.textBytes,
      });
}

export function parseWorkbenchSourceDetailQuery(value: unknown): WorkbenchSourceDetailQuery {
  const record = exactRecord(value, "Source detail query", ["page", "cursor", "limit"]);
  if (record.page !== "analyses" && record.page !== "records") fail("Source detail page must be analyses or records.");
  return {
    page: record.page,
    ...(record.cursor === undefined ? {} : { cursor: readString(record.cursor, "Source detail cursor", 1, 8_192) }),
    limit: readBoundedPositiveInteger(record.limit, "Source detail limit", WORKBENCH_SOURCE_LIMITS.segmentsPerPage),
  };
}

export function parseWorkbenchSourceAnalysisViewQuery(value: unknown): WorkbenchSourceAnalysisViewQuery {
  const record = exactRecord(value, "Source analysis view query", ["view", "page", "cursor", "limit", "nodeId", "insightId", "decision"]);
  if (record.view !== "workflows" && record.view !== "insights" && record.view !== "review") {
    fail("Source analysis view must be workflows, insights, or review.");
  }
  const validPage = (record.view === "review" && record.page === "review")
    || (record.view === "workflows" && (record.page === "nodes" || record.page === "occurrences"))
    || (record.view === "insights" && record.page === "insights");
  if (!validPage) fail("Source analysis page does not belong to the requested view.");
  if (record.page !== "review" && record.decision !== undefined) {
    fail("Source review filters require page=review.");
  }
  if (record.nodeId !== undefined && !(record.view === "workflows" && record.page === "nodes")) {
    fail("Source taxonomy nodeId requires view=workflows&page=nodes.");
  }
  if (record.decision !== undefined && record.decision !== "kept" && record.decision !== "dismissed") {
    fail("Source review decision must be kept or dismissed; unreviewed state is read with its immutable Analysis item.");
  }
  if (record.view !== "insights" && record.insightId !== undefined) fail("Only Source insight views accept an insightId.");
  if (record.page === "review" && record.decision === undefined) {
    fail("Source review pages require a kept or dismissed decision filter.");
  }
  const common = {
    view: record.view,
    page: record.page,
    ...(record.cursor === undefined ? {} : { cursor: readString(record.cursor, "Source analysis cursor", 1, 8_192) }),
    limit: readBoundedPositiveInteger(record.limit, "Source analysis limit", WORKBENCH_SOURCE_LIMITS.segmentsPerPage),
    ...(record.nodeId === undefined ? {} : { nodeId: readId(record.nodeId, "Source taxonomy node id") }),
    ...(record.insightId === undefined ? {} : { insightId: readId(record.insightId, "Source insight id") }),
  };
  if (record.page === "review") {
    return {
      ...common,
      page: "review",
      decision: record.decision as "kept" | "dismissed",
    } as WorkbenchSourceAnalysisViewQuery;
  }
  return common as WorkbenchSourceAnalysisViewQuery;
}

export function parseWorkbenchSourceOccurrenceQuery(value: unknown): WorkbenchSourceOccurrenceQuery {
  const record = exactRecord(value, "Source occurrence query", ["ids", "search", "workflowId", "unassigned", "cursor", "limit"]);
  const ids = record.ids === undefined
    ? undefined
    : readUniqueIds(record.ids, "Source occurrence ids", WORKBENCH_SOURCE_LIMITS.representativeIds);
  const workflowId = record.workflowId === undefined ? undefined : readId(record.workflowId, "Source occurrence workflow id");
  if (record.unassigned !== undefined && record.unassigned !== true) fail("Source occurrence unassigned filter must be true when present.");
  if ([ids !== undefined, record.search !== undefined, workflowId !== undefined, record.unassigned === true].filter(Boolean).length > 1) {
    fail("Source occurrence ids, search, workflowId, and unassigned filters are mutually exclusive.");
  }
  return {
    ...(ids ? { ids } : {}),
    ...(record.search === undefined ? {} : { search: readString(record.search, "Source occurrence search", 1, 512, true) }),
    ...(workflowId === undefined ? {} : { workflowId }),
    ...(record.unassigned === true ? { unassigned: true as const } : {}),
    ...(record.cursor === undefined ? {} : { cursor: readString(record.cursor, "Source occurrence cursor", 1, 8_192) }),
    limit: readBoundedPositiveInteger(record.limit, "Source occurrence limit", WORKBENCH_SOURCE_LIMITS.segmentsPerPage),
  };
}

export function parseWorkbenchSourceWorkflowOccurrence(value: unknown): WorkbenchSourceWorkflowOccurrence {
  const record = exactRecord(value, "Source workflow occurrence", ["id", "summary", "citationIds", "workflowId"]);
  const citationIds = readUniqueIds(record.citationIds, "Source occurrence citation ids", WORKBENCH_SOURCE_LIMITS.representativeIds);
  if (citationIds.length === 0) fail("Source workflow occurrence requires at least one citation.");
  return {
    id: readId(record.id, "Source occurrence id"),
    summary: readString(record.summary, "Source occurrence summary", 1, 8_192, true),
    citationIds,
    ...(record.workflowId === undefined ? {} : { workflowId: readId(record.workflowId, "Source occurrence workflow id") }),
  };
}

export function parseWorkbenchSourceWorkflowNode(value: unknown): WorkbenchSourceWorkflowNode {
  const record = exactRecord(value, "Source workflow node", [
    "kind", "id", "parentId", "name", "description", "occurrenceCount", "childCount", "representativeCitationIds",
  ]);
  const common = {
    id: readId(record.id, "Source workflow node id"),
    name: readLabel(record.name, "Source workflow node name"),
    description: readString(record.description, "Source workflow node description", 1, 8_192, true),
    occurrenceCount: readNonnegativeInteger(record.occurrenceCount, "Source workflow occurrence count"),
  };
  if (record.kind === "category") {
    exactKeys(record, "Source workflow category", ["kind", "id", "parentId", "name", "description", "occurrenceCount", "childCount"]);
    return {
      kind: "category",
      ...common,
      ...(record.parentId === undefined ? {} : { parentId: readId(record.parentId, "Source workflow parent id") }),
      childCount: readNonnegativeInteger(record.childCount, "Source workflow child count"),
    };
  }
  if (record.kind === "workflow") {
    exactKeys(record, "Source workflow leaf", ["kind", "id", "parentId", "name", "description", "occurrenceCount", "representativeCitationIds"]);
    const representativeCitationIds = readUniqueIds(record.representativeCitationIds, "Source workflow representative citation ids", WORKBENCH_SOURCE_LIMITS.representativeIds);
    if (common.occurrenceCount === 0 || representativeCitationIds.length === 0) fail("A Source workflow leaf requires occurrences and representative citations.");
    return {
      kind: "workflow",
      ...common,
      parentId: readId(record.parentId, "Source workflow parent id"),
      representativeCitationIds,
    };
  }
  return fail("Source workflow node kind must be category or workflow.");
}

export function parseWorkbenchSourceInsight(value: unknown): WorkbenchSourceInsight {
  const record = exactRecord(value, "Source insight", [
    "id", "statement", "implication", "workflowCount", "supportingCitationCount", "contradictingCitationCount",
    "representativeWorkflowIds", "representativeSupportingCitationIds", "representativeContradictingCitationIds",
  ]);
  const workflowCount = readNonnegativeInteger(record.workflowCount, "Source insight workflow count");
  const supportingCitationCount = readNonnegativeInteger(record.supportingCitationCount, "Source insight supporting citation count");
  const contradictingCitationCount = readNonnegativeInteger(record.contradictingCitationCount, "Source insight contradicting citation count");
  const representativeWorkflowIds = readUniqueIds(record.representativeWorkflowIds, "Source insight representative workflow ids", WORKBENCH_SOURCE_LIMITS.representativeIds);
  const representativeSupportingCitationIds = readUniqueIds(record.representativeSupportingCitationIds, "Source insight representative supporting citation ids", WORKBENCH_SOURCE_LIMITS.representativeIds);
  const representativeContradictingCitationIds = readUniqueIds(record.representativeContradictingCitationIds, "Source insight representative contradicting citation ids", WORKBENCH_SOURCE_LIMITS.representativeIds);
  if (representativeWorkflowIds.length > workflowCount) fail("Source insight representative workflows exceed workflowCount.");
  if (representativeSupportingCitationIds.length > supportingCitationCount) fail("Source insight representative supporting citations exceed supportingCitationCount.");
  if (representativeContradictingCitationIds.length > contradictingCitationCount) fail("Source insight representative contradicting citations exceed contradictingCitationCount.");
  return {
    id: readId(record.id, "Source insight id"),
    statement: readString(record.statement, "Source insight statement", 1, 8_192, true),
    implication: readString(record.implication, "Source insight implication", 1, 8_192, true),
    workflowCount,
    supportingCitationCount,
    contradictingCitationCount,
    representativeWorkflowIds,
    representativeSupportingCitationIds,
    representativeContradictingCitationIds,
  };
}

export function parseWorkbenchSourceCreateRequest(value: unknown): WorkbenchSourceCreateRequest {
  const record = exactRecord(value, "Source create request", ["schema", "name"]);
  if (record.schema !== "workbench.source.create.v1") fail("Unsupported Source create schema.");
  return {
    schema: record.schema,
    name: readLabel(record.name, "Source name"),
  };
}

export function parseWorkbenchSourceSyncCommitRequest(value: unknown): WorkbenchSourceSyncCommitRequest {
  const record = exactRecord(value, "Source sync commit request", ["schema", "coverage"]);
  if (record.schema !== "workbench.source.sync-commit.v1") fail("Unsupported Source sync commit schema.");
  return {
    schema: record.schema,
    coverage: parseWorkbenchSourceSyncCoverage(record.coverage),
  };
}

export function parseWorkbenchSourceSyncBatch(value: unknown): WorkbenchSourceSyncBatch {
  const record = exactRecord(value, "Source sync batch", ["schema", "sequence", "events"]);
  if (record.schema !== "workbench.source.sync-batch.v1") fail("Unsupported Source sync batch schema.");
  const events = boundedArray(record.events, "Source sync events", WORKBENCH_SOURCE_LIMITS.syncEventsPerBatch).map(parseSourceSyncEvent);
  if (events.length === 0) fail("Source sync batch must contain at least one event.");
  if (events.some((event, index) => event.kind === "finish" && index !== events.length - 1)) {
    fail("Source sync finish must be the final event.");
  }
  const recordIds = events.flatMap((event) => event.kind === "record" ? [event.record.id] : []);
  if (new Set(recordIds).size !== recordIds.length) fail("Source sync batch contains duplicate record ids.");
  return {
    schema: record.schema,
    sequence: readNonnegativeInteger(record.sequence, "Source sync sequence"),
    events,
  };
}

export function workbenchSourceSyncEventCanonicalJson(event: WorkbenchSourceSyncEvent): string {
  if (event.kind === "page") {
    return `{"kind":"page","recordId":${JSON.stringify(event.recordId)},"claimedPageHash":"${event.claimedPageHash}","payload":${workbenchSourceRecordPageCanonicalJson(event.payload)}}`;
  }
  return JSON.stringify(event.kind === "record"
    ? { kind: event.kind, record: {
        id: event.record.id,
        bodyHash: event.record.bodyHash,
        ...(event.record.label ? { label: event.record.label } : {}),
        ...(event.record.occurredAt ? { occurredAt: event.record.occurredAt } : {}),
      } }
    : { kind: event.kind });
}

export function parseWorkbenchSourceRecordLookupRequest(value: unknown): WorkbenchSourceRecordLookupRequest {
  const record = exactRecord(value, "Source record lookup", ["schema", "ids"]);
  if (record.schema !== "workbench.source.record-lookup.v1") fail("Unsupported Source record lookup schema.");
  return {
    schema: record.schema,
    ids: readUniqueIds(record.ids, "Source record lookup ids", WORKBENCH_SOURCE_LIMITS.recordLookupIds),
  };
}

export function parseWorkbenchSourceReviewPatch(value: unknown): WorkbenchSourceReviewPatch {
  const record = exactRecord(value, "Source review patch", ["schema", "expectedVersion", "mutation"]);
  if (record.schema !== "workbench.source.review-patch.v1") fail("Unsupported Source review patch schema.");
  return {
    schema: record.schema,
    expectedVersion: readNonnegativeInteger(record.expectedVersion, "Source review version"),
    mutation: parseReviewMutation(record.mutation),
  };
}

export function parseWorkbenchModelAuthorization(value: unknown): WorkbenchModelAuthorization {
  const record = exactRecord(value, "Model authorization", ["token", "maximumCostUsd"]);
  return {
    token: readString(record.token, "Model authorization token", 1, 8_192),
    maximumCostUsd: readNonnegativeNumber(record.maximumCostUsd, "Model maximum cost"),
  };
}

export function parseWorkbenchOperation(value: unknown): WorkbenchOperation {
  const record = exactRecord(value, "Workbench operation", [
    "schema", "id", "owner", "kind", "targetId", "status", "progress", "usage", "resultId", "failureCode", "error", "createdAt", "updatedAt",
  ]);
  if (record.schema !== "workbench.operation.v1") fail("Unsupported Workbench operation schema.");
  if (record.owner !== "source" && record.owner !== "eval") fail("Workbench operation owner must be source or eval.");
  const kind = parseModelOperationKind(record.kind);
  if (record.status !== "queued" && record.status !== "running" && record.status !== "succeeded" && record.status !== "failed" && record.status !== "canceled") {
    fail("Workbench operation status is invalid.");
  }
  if (record.failureCode !== undefined && record.status !== "failed") fail("Workbench operation failure code requires failed status.");
  let progress: WorkbenchOperation["progress"];
  if (record.progress !== undefined) {
    const progressRecord = exactRecord(record.progress, "Workbench operation progress", ["completed", "total", "message"]);
    const completed = readNonnegativeInteger(progressRecord.completed, "Workbench operation completed progress");
    const total = readNonnegativeInteger(progressRecord.total, "Workbench operation total progress");
    if (completed > total) fail("Workbench operation completed progress must not exceed total progress.");
    progress = {
      completed,
      total,
      ...(progressRecord.message === undefined ? {} : { message: readString(progressRecord.message, "Workbench operation progress message", 1, 2_048, true) }),
    };
  }
  return {
    schema: record.schema,
    id: readId(record.id, "Workbench operation id"),
    owner: record.owner,
    kind,
    targetId: readId(record.targetId, "Workbench operation target id"),
    status: record.status,
    ...(progress ? { progress } : {}),
    ...(record.usage === undefined ? {} : { usage: parseSourceAnalysisUsage(record.usage) }),
    ...(record.resultId === undefined ? {} : { resultId: readId(record.resultId, "Workbench operation result id") }),
    ...(record.failureCode === undefined ? {} : {
      failureCode: record.failureCode === "authorization_exhausted"
        ? record.failureCode
        : fail("Workbench operation failure code is invalid."),
    }),
    ...(record.error === undefined ? {} : { error: readString(record.error, "Workbench operation error", 1, 16_384, true) }),
    createdAt: readIsoDate(record.createdAt, "Workbench operation createdAt"),
    updatedAt: readIsoDate(record.updatedAt, "Workbench operation updatedAt"),
  };
}

export function parseWorkbenchSourceAnalyzeRequest(value: unknown): WorkbenchSourceAnalyzeRequest {
  const record = exactRecord(value, "Source analyze request", ["schema", "snapshotId", "selection", "map", "authorization"]);
  if (record.schema !== "workbench.source.analyze-request.v1") fail("Unsupported Source analyze request schema.");
  const selectionKind = exactRecord(record.selection, "Source analysis selection", ["kind", "recordOffset", "recordLimit"]).kind;
  let selection: WorkbenchSourceAnalyzeRequest["selection"];
  if (selectionKind === "all") {
    exactRecord(record.selection, "entire Source analysis selection", ["kind"]);
    selection = { kind: "all" };
  } else if (selectionKind === "window") {
    const selectionRecord = exactRecord(record.selection, "Source analysis record window", ["kind", "recordOffset", "recordLimit"]);
    const recordOffset = readNonnegativeInteger(selectionRecord.recordOffset, "Source selection record offset");
    const recordLimit = readBoundedPositiveInteger(selectionRecord.recordLimit, "Source selection record limit", WORKBENCH_SOURCE_LIMITS.analysisWindowRecords);
    selection = { kind: "window", recordOffset, recordLimit };
  } else {
    fail("Source analysis selection kind must be all or window.");
  }
  if (record.map !== "include" && record.map !== "omit") fail("Source analysis map choice must be include or omit.");
  return {
    schema: record.schema,
    ...(record.snapshotId === undefined ? {} : { snapshotId: readId(record.snapshotId, "Source snapshot id") }),
    selection,
    map: record.map,
    ...(record.authorization === undefined ? {} : { authorization: parseWorkbenchModelAuthorization(record.authorization) }),
  };
}

export function parseWorkbenchEvalPatch(value: unknown): WorkbenchEvalPatch {
  const record = exactRecord(value, "Eval patch", ["schema", "changes"]);
  if (record.schema !== "workbench.eval.patch.v1") fail("Unsupported Eval patch schema.");
  const changes = boundedArray(record.changes, "Eval patch changes", WORKBENCH_SOURCE_LIMITS.evalPatchChanges).map((entry) => {
    const change = exactRecord(entry, "Eval patch change", ["kind", "file", "path"]);
    if (change.kind === "put") {
      exactKeys(change, "Eval patch put", ["kind", "file"]);
      return { kind: "put", file: parseEvalFile(change.file) } as const;
    }
    if (change.kind === "delete") {
      exactKeys(change, "Eval patch delete", ["kind", "path"]);
      return { kind: "delete", path: normalizeWorkbenchEvalPath(change.path) } as const;
    }
    return fail("Eval patch change kind must be put or delete.");
  });
  const paths = changes.map((change) => change.kind === "put" ? change.file.path : change.path);
  if (new Set(paths).size !== paths.length) fail("Eval patch paths must be unique.");
  const totalBytes = changes.reduce((total, change) => total + (change.kind === "put" ? utf8Bytes(change.file.content) : 0), 0);
  if (totalBytes > WORKBENCH_SOURCE_LIMITS.evalBaseBytes) fail(`Eval patch content exceeds ${WORKBENCH_SOURCE_LIMITS.evalBaseBytes} bytes.`);
  return { schema: record.schema, changes };
}

export function parseWorkbenchEvalDraftRequest(value: unknown): WorkbenchEvalDraftRequest {
  const record = exactRecord(value, "Eval draft request", [
    "schema", "sourceId", "snapshotId", "analysisId", "reviewVersion", "reviewHash", "workflowIds",
    "objective", "destination", "baseFiles", "authorization",
  ]);
  if (record.schema !== "workbench.eval-draft.request.v1") fail("Unsupported Eval draft request schema.");
  const workflowIds = readUniqueIds(record.workflowIds, "Eval draft workflow ids", WORKBENCH_SOURCE_LIMITS.reviewEvidenceIds);
  if (workflowIds.length === 0) fail("Eval draft requires at least one workflow id.");
  const destination = parseEvalDestination(record.destination);
  const baseFiles = record.baseFiles === undefined
    ? undefined
    : boundedArray(record.baseFiles, "Eval draft base files", WORKBENCH_SOURCE_LIMITS.evalBaseFiles).map(parseEvalFile);
  if (destination.kind === "local" && !baseFiles) fail("Local Eval draft requires baseFiles.");
  if (baseFiles) {
    if (new Set(baseFiles.map((file) => file.path)).size !== baseFiles.length) fail("Eval draft base file paths must be unique.");
    if (baseFiles.reduce((total, file) => total + utf8Bytes(file.content), 0) > WORKBENCH_SOURCE_LIMITS.evalBaseBytes) {
      fail(`Eval draft base files exceed ${WORKBENCH_SOURCE_LIMITS.evalBaseBytes} bytes.`);
    }
  }
  return {
    schema: record.schema,
    sourceId: readId(record.sourceId, "Source id"),
    snapshotId: readId(record.snapshotId, "Source snapshot id"),
    analysisId: readId(record.analysisId, "Source analysis id"),
    reviewVersion: readNonnegativeInteger(record.reviewVersion, "Source review version"),
    reviewHash: readHash(record.reviewHash, "Source review hash"),
    workflowIds,
    objective: readNonblankString(record.objective, "Eval draft objective", 8_192, true),
    destination,
    ...(baseFiles ? { baseFiles } : {}),
    ...(record.authorization === undefined ? {} : { authorization: parseWorkbenchModelAuthorization(record.authorization) }),
  };
}

export function parseWorkbenchEvalDraft(value: unknown): WorkbenchEvalDraft {
  const record = exactRecord(value, "Eval draft", [
    "schema", "id", "sourceId", "snapshotId", "analysisId", "reviewVersion", "reviewHash", "workflows", "evidence",
    "objective", "destination", "baseHash", "expectedResultHash", "patch", "rationale", "citationIds", "status", "usage", "createdAt", "applied", "discarded",
  ]);
  if (record.schema !== "workbench.eval-draft.v1") fail("Unsupported Eval draft schema.");
  const workflows = boundedArray(record.workflows, "Eval draft workflows", WORKBENCH_SOURCE_LIMITS.reviewEvidenceIds).map((value) => {
    const item = exactRecord(value, "Eval draft workflow", ["id", "name", "description", "citationIds"]);
    const citationIds = readUniqueIds(item.citationIds, "Eval draft workflow citation ids", WORKBENCH_SOURCE_LIMITS.representativeIds);
    if (citationIds.length === 0) fail("Eval draft workflow requires cited evidence.");
    return {
      id: readId(item.id, "Eval draft workflow id"),
      name: readLabel(item.name, "Eval draft workflow name"),
      description: readString(item.description, "Eval draft workflow description", 1, 8_192, true),
      citationIds,
    };
  });
  const evidence = boundedArray(record.evidence, "Eval draft evidence", WORKBENCH_SOURCE_LIMITS.reviewEvidenceIds).map((value) => {
    const item = exactRecord(value, "Eval draft evidence excerpt", ["citationId", "quote"]);
    return {
      citationId: readId(item.citationId, "Eval draft evidence citation id"),
      quote: readString(item.quote, "Eval draft evidence quote", 1, WORKBENCH_SOURCE_LIMITS.segmentTextBytes, true),
    };
  });
  const citationIds = readUniqueIds(record.citationIds, "Eval draft citation ids", WORKBENCH_SOURCE_LIMITS.reviewEvidenceIds);
  if (workflows.length === 0) fail("Eval draft requires at least one workflow.");
  if (citationIds.length === 0) fail("Eval draft requires at least one cited evidence excerpt.");
  if (new Set(workflows.map((item) => item.id)).size !== workflows.length || new Set(evidence.map((item) => item.citationId)).size !== evidence.length) {
    fail("Eval draft reviewed items and evidence must have unique ids.");
  }
  const evidenceIds = evidence.map((item) => item.citationId);
  requireIdSubset(workflows.flatMap((item) => item.citationIds), evidenceIds, "Eval draft workflow citations");
  requireIdSubset(citationIds, evidenceIds, "Eval draft citations");
  if (record.status !== "ready" && record.status !== "applied" && record.status !== "discarded") fail("Eval draft status must be ready, applied, or discarded.");
  const applied = record.applied === undefined ? undefined : parseEvalDraftApplied(record.applied);
  const discarded = record.discarded === undefined ? undefined : parseEvalDraftDiscarded(record.discarded);
  if ((record.status === "applied") !== Boolean(applied)) fail("Applied Eval draft status and metadata must agree.");
  if ((record.status === "discarded") !== Boolean(discarded)) fail("Discarded Eval draft status and metadata must agree.");
  const destination = parseEvalDestination(record.destination);
  const baseHash = readHash(record.baseHash, "Eval draft base hash");
  return {
    schema: record.schema,
    id: readId(record.id, "Eval draft id"),
    sourceId: readId(record.sourceId, "Eval draft Source id"),
    snapshotId: readId(record.snapshotId, "Eval draft snapshot id"),
    analysisId: readId(record.analysisId, "Eval draft analysis id"),
    reviewVersion: readNonnegativeInteger(record.reviewVersion, "Eval draft review version"),
    reviewHash: readHash(record.reviewHash, "Eval draft review hash"),
    workflows,
    evidence,
    objective: readNonblankString(record.objective, "Eval draft objective", 8_192, true),
    destination,
    baseHash,
    expectedResultHash: readHash(record.expectedResultHash, "Eval draft result hash"),
    patch: parseWorkbenchEvalPatch(record.patch),
    rationale: readString(record.rationale, "Eval draft rationale", 1, 16_384, true),
    citationIds,
    status: record.status,
    usage: parseSourceAnalysisUsage(record.usage),
    createdAt: readIsoDate(record.createdAt, "Eval draft createdAt"),
    ...(applied ? { applied } : {}),
    ...(discarded ? { discarded } : {}),
  };
}

export function parseWorkbenchEvalDraftApplyRequest(value: unknown): WorkbenchEvalDraftApplyRequest {
  const record = exactRecord(value, "Eval draft apply request", ["schema", "expectedBaseHash", "resultHash"]);
  if (record.schema !== "workbench.eval-draft.apply.v1") fail("Unsupported Eval draft apply schema.");
  return {
    schema: record.schema,
    expectedBaseHash: readHash(record.expectedBaseHash, "Eval apply base hash"),
    ...(record.resultHash === undefined ? {} : { resultHash: readHash(record.resultHash, "Eval apply result hash") }),
  };
}

function parseEvidenceSegment(value: unknown): WorkbenchSourceEvidenceSegment {
  const record = exactRecord(value, "Source evidence segment", ["id", "text", "presentation"]);
  const text = readString(record.text, "Source segment text", 1, WORKBENCH_SOURCE_LIMITS.segmentTextBytes, true);
  const presentation = record.presentation === undefined
    ? undefined
    : boundedArray(record.presentation, "Source presentation blocks", WORKBENCH_SOURCE_LIMITS.presentationBlocksPerSegment)
      .map((block) => parseEvidenceBlock(block, text));
  return { id: readId(record.id, "Source segment id"), text, ...(presentation ? { presentation } : {}) };
}

function parseEvidenceBlock(value: unknown, segmentText: string): WorkbenchSourceEvidenceBlock {
  const block = exactRecord(value, "Source evidence block", ["kind", "text", "language", "label", "value", "href", "mediaType", "size"]);
  if (block.kind === "text" || block.kind === "code") {
    exactKeys(block, `Source ${block.kind} block`, block.kind === "text" ? ["kind", "text"] : ["kind", "text", "language"]);
    const text = readString(block.text, `Source ${block.kind} text`, 1, WORKBENCH_SOURCE_LIMITS.segmentTextBytes, true);
    requireVisible(segmentText, text);
    if (block.kind === "text") return { kind: "text", text };
    const language = block.language === undefined ? undefined : readLabel(block.language, "Source code language");
    if (language) requireVisible(segmentText, language);
    return { kind: "code", text, ...(language ? { language } : {}) };
  }
  if (block.kind === "field") {
    exactKeys(block, "Source field block", ["kind", "label", "value"]);
    const label = readLabel(block.label, "Source field label");
    const fieldValue = readLabel(block.value, "Source field value");
    requireVisible(segmentText, label, fieldValue);
    return { kind: "field", label, value: fieldValue };
  }
  if (block.kind === "link") {
    exactKeys(block, "Source link block", ["kind", "label", "href"]);
    const label = readLabel(block.label, "Source link label");
    const href = readString(block.href, "Source link href", 1, 2_048);
    if (!/^(?:https?:|mailto:)/u.test(href)) fail("Source link href must use https, http, or mailto.");
    requireVisible(segmentText, label, href);
    return { kind: "link", label, href };
  }
  if (block.kind === "attachment") {
    exactKeys(block, "Source attachment block", ["kind", "label", "mediaType", "size"]);
    const label = readLabel(block.label, "Source attachment label");
    const mediaType = block.mediaType === undefined ? undefined : readString(block.mediaType, "Source media type", 1, 128);
    const size = block.size === undefined ? undefined : readNonnegativeInteger(block.size, "Source attachment size");
    requireVisible(segmentText, label, ...(mediaType ? [mediaType] : []), ...(size === undefined ? [] : [String(size)]));
    return {
      kind: "attachment",
      label,
      ...(mediaType ? { mediaType } : {}),
      ...(size === undefined ? {} : { size }),
    };
  }
  return fail("Unsupported Source evidence block kind.");
}

function parseSourceRecordEntry(value: unknown): WorkbenchSourceRecordEntry {
  const record = exactRecord(value, "Source record entry", ["id", "bodyHash", "label", "occurredAt"]);
  return {
    id: readId(record.id, "Source record id"),
    bodyHash: readHash(record.bodyHash, "Source record body hash"),
    ...(record.label === undefined ? {} : { label: readLabel(record.label, "Source record label") }),
    ...(record.occurredAt === undefined ? {} : { occurredAt: readIsoDate(record.occurredAt, "Source record occurredAt") }),
  };
}

function parseSourceSyncEvent(value: unknown): WorkbenchSourceSyncEvent {
  const event = exactRecord(value, "Source sync event", ["kind", "recordId", "claimedPageHash", "payload", "record"]);
  if (event.kind === "page") {
    exactKeys(event, "Source page event", ["kind", "recordId", "claimedPageHash", "payload"]);
    return {
      kind: event.kind,
      recordId: readId(event.recordId, "Source record id"),
      claimedPageHash: readHash(event.claimedPageHash, "Source claimed page hash"),
      payload: parseWorkbenchSourceRecordPagePayload(event.payload),
    };
  }
  if (event.kind === "record") {
    exactKeys(event, "Source record event", ["kind", "record"]);
    return { kind: event.kind, record: parseSourceRecordEntry(event.record) };
  }
  if (event.kind === "finish") {
    exactKeys(event, "Source finish event", ["kind"]);
    return { kind: event.kind };
  }
  return fail("Source sync event kind must be page, record, or finish.");
}

export function parseWorkbenchSourceSyncCoverage(value: unknown): WorkbenchSourceSyncCoverage {
  const record = exactRecord(value, "Source sync coverage", ["records", "segments", "bytes", "omittedItems", "omittedBytes", "omissions"]);
  const omissions = boundedArray(record.omissions, "Source sync omissions", 64).map((entry) => {
    const omission = exactRecord(entry, "Source sync omission", ["reason", "items", "bytes"]);
    return {
      reason: readString(omission.reason, "Source omission reason", 1, WORKBENCH_SOURCE_LIMITS.labelCharacters, true),
      items: readNonnegativeInteger(omission.items, "Source omission items"),
      bytes: readNonnegativeInteger(omission.bytes, "Source omission bytes"),
    };
  });
  const result: WorkbenchSourceSyncCoverage = {
    records: readNonnegativeInteger(record.records, "Source coverage records"),
    segments: readNonnegativeInteger(record.segments, "Source coverage segments"),
    bytes: readNonnegativeInteger(record.bytes, "Source coverage bytes"),
    omittedItems: readNonnegativeInteger(record.omittedItems, "Source coverage omitted items"),
    omittedBytes: readNonnegativeInteger(record.omittedBytes, "Source coverage omitted bytes"),
    omissions,
  };
  if (omissions.reduce((total, item) => total + item.items, 0) !== result.omittedItems ||
      omissions.reduce((total, item) => total + item.bytes, 0) !== result.omittedBytes) {
    fail("Source omission totals do not match their reasons.");
  }
  return result;
}

function parseReviewMutation(value: unknown): WorkbenchSourceReviewMutation {
  const record = exactRecord(value, "Source review mutation", ["kind", "workflowId"]);
  if (record.kind === "keep" || record.kind === "dismiss") {
    return { kind: record.kind, workflowId: readId(record.workflowId, "Source review workflow id") };
  }
  return fail("Unsupported Source review mutation kind.");
}

function parseEvalFile(value: unknown): SurfaceSnapshotFile {
  const record = exactRecord(value, "Eval patch file", ["path", "kind", "encoding", "content", "executable"]);
  const filePath = normalizeWorkbenchEvalPath(record.path);
  const content = readString(record.content, "Eval patch file content", 0, WORKBENCH_SOURCE_LIMITS.pageBytes, true);
  if (record.kind !== undefined && record.kind !== "text" && record.kind !== "binary") fail("Eval patch file kind is invalid.");
  if (record.encoding !== undefined && record.encoding !== "utf8" && record.encoding !== "base64") fail("Eval patch file encoding is invalid.");
  if (record.executable !== undefined && typeof record.executable !== "boolean") fail("Eval patch executable must be boolean.");
  if (record.kind === "binary" && record.encoding !== "base64") fail("Binary Eval patch files must use base64 encoding.");
  if (record.encoding === "base64" && record.kind !== "binary") fail("Base64 Eval patch files must declare binary kind.");
  if (record.kind === "text" && record.encoding === "base64") fail("Text Eval patch files cannot use base64 encoding.");
  if (record.encoding === "base64" && !canonicalBase64(content)) fail("Eval patch file content must be canonical base64.");
  return {
    path: filePath,
    content,
    ...(record.kind === undefined ? {} : { kind: record.kind }),
    ...(record.encoding === undefined ? {} : { encoding: record.encoding }),
    ...(record.executable === undefined ? {} : { executable: record.executable }),
  };
}

function canonicalBase64(value: string): boolean {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return false;
  try {
    return btoa(atob(value)) === value;
  } catch {
    return false;
  }
}

function parseEvalDestination(value: unknown): WorkbenchEvalDraftDestination {
  const record = exactRecord(value, "Eval draft destination", ["kind", "skillName", "owner", "skill", "evalId"]);
  if (record.kind === "local") {
    exactKeys(record, "Local Eval destination", ["kind", "skillName"]);
    return {
      kind: "local",
      skillName: readId(record.skillName, "Local Skill name"),
    };
  }
  if (record.kind === "hosted") {
    exactKeys(record, "Hosted Eval destination", ["kind", "owner", "skill", "evalId"]);
    return {
      kind: "hosted",
      owner: readId(record.owner, "Hosted owner"),
      skill: readId(record.skill, "Hosted Skill"),
      ...(record.evalId === undefined ? {} : { evalId: readId(record.evalId, "Hosted Eval id") }),
    };
  }
  return fail("Eval destination kind must be local or hosted.");
}

function parseSourceAnalysisUsage(value: unknown): WorkbenchModelUsage {
  const record = exactRecord(value, "Source analysis usage", ["inputTokens", "outputTokens", "modelCalls", "costUsd"]);
  return {
    inputTokens: readNonnegativeInteger(record.inputTokens, "Source analysis input tokens"),
    outputTokens: readNonnegativeInteger(record.outputTokens, "Source analysis output tokens"),
    modelCalls: readNonnegativeInteger(record.modelCalls, "Source analysis model calls"),
    ...(record.costUsd === undefined ? {} : { costUsd: readNonnegativeNumber(record.costUsd, "Source analysis cost") }),
  };
}

function parseModelOperationKind(value: unknown): WorkbenchModelOperationKind {
  if (value !== "source.analyze" && value !== "eval.draft") {
    return fail("Workbench model operation kind is invalid.");
  }
  return value;
}

function parseEvalDraftApplied(value: unknown): NonNullable<WorkbenchEvalDraft["applied"]> {
  const record = exactRecord(value, "Eval draft applied metadata", ["resultHash", "actor", "at"]);
  return {
    resultHash: readHash(record.resultHash, "Eval draft applied result hash"),
    actor: readId(record.actor, "Eval draft applied actor"),
    at: readIsoDate(record.at, "Eval draft applied timestamp"),
  };
}

function parseEvalDraftDiscarded(value: unknown): NonNullable<WorkbenchEvalDraft["discarded"]> {
  const record = exactRecord(value, "Eval draft discarded metadata", ["actor", "at"]);
  return { actor: readId(record.actor, "Eval draft discarded actor"), at: readIsoDate(record.at, "Eval draft discarded at") };
}

function requireIdSubset(values: readonly string[], allowed: readonly string[] | undefined, label: string): void {
  if (!allowed) return;
  const set = new Set(allowed);
  const outside = values.find((value) => !set.has(value));
  if (outside) fail(`${label} contain unreviewed id ${outside}.`);
}

export function normalizeWorkbenchEvalPath(value: unknown): string {
  const filePath = readString(value, "Eval patch path", 1, 512).replace(/\\/gu, "/");
  if (filePath.startsWith("/") || filePath.split("/").some((part) => !part || part === "." || part === "..")) fail("Eval patch path is unsafe.");
  if (filePath !== "eval.yaml" && !filePath.startsWith("cases/") && !filePath.startsWith("environment/")) {
    fail("Eval patch may change only eval.yaml, cases/, or environment/.");
  }
  return filePath;
}

function exactRecord(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  const record = value as Record<string, unknown>;
  exactKeys(record, label, keys);
  return record;
}

function exactKeys(record: Record<string, unknown>, label: string, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  const extra = Object.keys(record).find((key) => !allowedKeys.has(key));
  if (extra) fail(`${label} contains unsupported field ${extra}.`);
}

function boundedArray(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  if (value.length > maximum) fail(`${label} exceeds ${maximum} items.`);
  return value;
}

function readId(value: unknown, label: string): string {
  const result = readString(value, label, 1, WORKBENCH_SOURCE_LIMITS.idCharacters);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(result)) fail(`${label} is invalid.`);
  return result;
}

function readLabel(value: unknown, label: string): string {
  return readString(value, label, 1, WORKBENCH_SOURCE_LIMITS.labelCharacters, true);
}

function readHash(value: unknown, label: string): string {
  const result = readString(value, label, 64, 64);
  if (!/^[a-f0-9]{64}$/u.test(result)) fail(`${label} must be a lowercase SHA-256 hash.`);
  return result;
}

function readString(value: unknown, label: string, minimum: number, maximum: number, bytes = false): string {
  if (typeof value !== "string" || value.length < minimum || (bytes ? utf8Bytes(value) : value.length) > maximum) {
    fail(`${label} must contain between ${minimum} and ${maximum} ${bytes ? "bytes" : "characters"}.`);
  }
  return value;
}

function readNonblankString(value: unknown, label: string, maximum: number, bytes = false): string {
  const result = readString(value, label, 1, maximum, bytes);
  if (result.trim().length === 0) fail(`${label} must contain non-whitespace text.`);
  return result;
}

function readNonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`${label} must be a nonnegative safe integer.`);
  return value as number;
}

function readPositiveInteger(value: unknown, label: string): number {
  const result = readNonnegativeInteger(value, label);
  if (result === 0) fail(`${label} must be positive.`);
  return result;
}

function readBoundedPositiveInteger(value: unknown, label: string, maximum: number): number {
  const result = readPositiveInteger(value, label);
  if (result > maximum) fail(`${label} must not exceed ${maximum}.`);
  return result;
}

function readNonnegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${label} must be a nonnegative number.`);
  return value;
}

function readUniqueIds(value: unknown, label: string, maximum: number): string[] {
  const ids = boundedArray(value, label, maximum).map((entry) => readId(entry, label));
  if (new Set(ids).size !== ids.length) fail(`${label} must be unique.`);
  return ids;
}

function readIsoDate(value: unknown, label: string): string {
  const result = readString(value, label, 1, 64);
  if (!Number.isFinite(Date.parse(result))) fail(`${label} must be an ISO timestamp.`);
  return result;
}

function requireVisible(segmentText: string, ...values: string[]): void {
  if (values.some((value) => !segmentText.includes(value))) fail("Source presentation strings must occur in segment text.");
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function fail(message: string): never {
  throw new WorkbenchContractValidationError(message);
}
