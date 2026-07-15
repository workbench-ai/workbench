import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  applyWorkbenchEvalPatch,
  createWorkbenchReadOnlyInspectionSnapshot,
  currentWorkbenchEvalSnapshot,
  hashFiles,
  reconcileCurrentWorkbenchVersion,
} from "@workbench-ai/workbench-core";
import type { SurfaceSnapshotFile } from "@workbench-ai/workbench-contract";

import {
  renderWorkbenchCliReference,
  renderWorkbenchHelp,
  renderWorkbenchHelpAll,
  WORKBENCH_COMMAND_SURFACE,
} from "../src/command-surface.ts";
import { runCli } from "../src/index.ts";
import { bindWorkbenchRemoteTarget } from "../src/remote-targets.ts";

class MemoryWritable extends Writable {
  value = "";
  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.value += String(chunk);
    callback();
  }
}

async function invoke(args: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout = new MemoryWritable();
  const stderr = new MemoryWritable();
  const code = await runCli(args, {
    stdout,
    stderr,
    ...(stdin === undefined ? {} : { stdin: Readable.from([stdin]) }),
  });
  return { code, stdout: stdout.value, stderr: stderr.value };
}

function output<T>(result: { stdout: string }): T {
  return JSON.parse(result.stdout) as T;
}

const temporaryRoots: string[] = [];
const originalConfig = process.env.WORKBENCH_CONFIG;
const OPERATION_ID = "op_11111111111111111111111111111111";
const DRAFT_ID = "draft_11111111111111111111111111111111";

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (originalConfig === undefined) delete process.env.WORKBENCH_CONFIG;
  else process.env.WORKBENCH_CONFIG = originalConfig;
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Source lifecycle", () => {
  test("reads a review patch from the separated stdin sentinel", async () => {
    await configureCloud();
    await bindSource();
    const patch = {
      schema: "workbench.source.review-patch.v1",
      expectedVersion: 1,
      mutation: { kind: "keep", workflowId: "workflow_1" },
    };
    let requestBody: unknown;
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push(String(url));
      if (init?.method !== "PATCH") return jsonResponse({ analysis: { sourceId: "source_1" } });
      requestBody = JSON.parse(String(init?.body));
      return jsonResponse({ review: {} });
    }));

    const result = await invoke(["source", "review", "source_1", "analysis_1", "--input", "-", "--json"], JSON.stringify(patch));

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(requestBody).toEqual(patch);
    expect(requests).toEqual([
      expect.stringMatching(/^https:\/\/bound\.test\/.+namespace=acme$/u),
      "https://bound.test/api/workbench/sources/analyses/analysis_1/review?namespace=acme",
    ]);
  });

  test("omits optional Map unless it is explicitly requested", async () => {
    await configureCloud();
    await bindSource();
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ operation: operation({ id: OPERATION_ID, status: "queued" }) });
    }));

    expect((await invoke(["source", "analyze", "source_1", "--record-offset", "250", "--record-limit", "100", "--json"])).code).toBe(0);
    expect((await invoke(["source", "analyze", "source_1", "--record-offset", "250", "--record-limit", "100", "--map", "--json"])).code).toBe(0);
    expect(bodies).toEqual([
      expect.objectContaining({ map: "omit", selection: { kind: "window", recordOffset: 250, recordLimit: 100 } }),
      expect.objectContaining({ map: "include", selection: { kind: "window", recordOffset: 250, recordLimit: 100 } }),
    ]);
  });

  test("drills from taxonomy and insights through workflow occurrences to exact evidence", async () => {
    await configureCloud();
    await bindSource();
    await fs.writeFile(path.join(process.env.HOME!, ".workbench", "sources", "source_1", "checkpoint.json"), "not valid checkpoint json");
    const analysis = { sourceId: "source_1", workflowCount: 15, insightCount: 3, occurrenceCount: 15 };
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input)); requests.push(url);
      if (url.pathname.endsWith("/evidence/cite_1")) return jsonResponse({ schema: "workbench.source.evidence.v1", evidence: { citation: { id: "cite_1", recordId: "record_1", recordBodyHash: "a".repeat(64), segmentId: "segment_1", start: 0, end: 11, quoteHash: "b".repeat(64) }, segment: { id: "segment_1", text: "hello world and context" }, quote: "hello world" }, capabilities: {} });
      if (url.pathname.endsWith("/occurrences")) return jsonResponse({ schema: "workbench.source.occurrence-lookup.v1", analysis, occurrences: { items: [{ id: "occ_1", summary: "Review invoice", workflowId: "workflow_1", citationIds: ["cite_1"] }], nextCursor: "occ-next" }, capabilities: {} });
      if (url.searchParams.get("view") === "insights") return jsonResponse({ schema: "workbench.source.analysis-view.v1", view: "insights", analysis, insights: { items: [{ id: "insight_1", statement: "Reviews need clearer checks", implication: "Add explicit criteria", workflowCount: 1, supportingCitationCount: 1, contradictingCitationCount: 0, representativeWorkflowIds: ["workflow_1"], representativeSupportingCitationIds: ["cite_1"], representativeContradictingCitationIds: [] }] }, capabilities: {} });
      return jsonResponse({ schema: "workbench.source.analysis-view.v1", view: "workflows", analysis, tree: { node: { kind: "category", id: "category_1", name: "Finance", description: "Finance workflows", occurrenceCount: 1, childCount: 1 }, ancestors: [], children: { items: [{ kind: "workflow", id: "workflow_1", parentId: "category_1", name: "Review invoice", description: "Checks an invoice", occurrenceCount: 1, representativeCitationIds: ["cite_1"] }], nextCursor: "node-next" } }, occurrences: { items: [] }, review: {}, reviewItems: { items: [] }, capabilities: {} });
    }));

    expect((await invoke(["source", "show", "source_1", "--analysis", "analysis_1", "--node", "category_1"])).stdout).toMatch(/citations=cite_1[\s\S]+--page nodes --node category_1 --cursor node-next/u);
    expect((await invoke(["source", "show", "source_1", "--analysis", "analysis_1", "--insight", "insight_1"])).stdout).toContain("supporting=cite_1");
    const occurrences = output<{ next: string; occurrences: { items: Array<{ citationIds: string[] }> } }>(await invoke(["source", "show", "source_1", "--analysis", "analysis_1", "--workflow", "workflow_1", "--json"]));
    expect({ citations: occurrences.occurrences.items[0]?.citationIds, next: occurrences.next }).toEqual({ citations: ["cite_1"], next: expect.stringContaining("--workflow workflow_1 --cursor occ-next") });
    const evidence = await invoke(["source", "evidence", "source_1", "analysis_1", "cite_1"]);
    expect(evidence.stdout).toContain("Exact quote:\nhello world");
    expect(evidence.stdout).not.toContain("Immutable segment");
    expect([requests.every((url) => url.origin === "https://bound.test" && url.searchParams.get("namespace") === "acme"), requests.map((url) => `${url.pathname}?${url.searchParams}`).some((url) => url.includes("page=nodes") && url.includes("nodeId=category_1")), requests.some((url) => url.searchParams.get("insightId") === "insight_1"), requests.some((url) => url.pathname.endsWith("/occurrences") && url.searchParams.get("workflowId") === "workflow_1"), requests.some((url) => url.pathname.endsWith("/evidence/cite_1"))]).toEqual([true, true, true, true, true]);
  });

  test.each([
    [["source", "show", "source_1", "--view", "workflows", "--json"], /Unsupported flag --view/u],
    [["source", "show", "source_1", "--node", "workflow_1", "--json"], /require --analysis/u],
    [["source", "show", "source_1", "--analysis", "analysis_1", "--node", "workflow_1", "--insight", "insight_1", "--json"], /mutually exclusive/u],
    [["source", "show", "source_1", "--analysis", "analysis_1", "--node", "workflow_1", "--page", "insights", "--json"], /--node requires --page nodes/u],
  ])("rejects invalid Source exploration grammar: %s", async (args, message) => {
    const result = await invoke(args); expect(result.code).toBe(2); expect(output<{ message: string }>(result).message).toMatch(message);
  });

  test("retries local cleanup after a remote delete has already succeeded", async () => {
    const home = await temporaryRoot();
    vi.stubEnv("HOME", home);
    await configureCloud();
    const bindingRoot = path.join(home, ".workbench", "sources", "source_1");
    await fs.mkdir(bindingRoot, { recursive: true });
    await fs.writeFile(path.join(bindingRoot, "binding.json"), JSON.stringify({ schema: "workbench.source-binding.v2", sourceId: "source_1", baseUrl: "https://cloud.test", adapterId: "codex" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("already deleted", { status: 404 })));

    const firstRetry = await invoke(["source", "delete", "source_1", "--yes", "--json"]);
    expect(firstRetry.code).toBe(0);
    await expect(fs.stat(bindingRoot)).rejects.toMatchObject({ code: "ENOENT" });
    const secondRetry = await invoke(["source", "delete", "source_1", "--yes", "--json"]);
    expect(secondRetry.code).toBe(0);
  });

  test("deletes through the exact namespace and endpoint stored by the local binding", async () => {
    const home = await temporaryRoot();
    vi.stubEnv("HOME", home);
    await configureCloud();
    const bindingRoot = path.join(home, ".workbench", "sources", "source_1");
    await fs.mkdir(bindingRoot, { recursive: true });
    await fs.writeFile(path.join(bindingRoot, "binding.json"), JSON.stringify({ schema: "workbench.source-binding.v2", sourceId: "source_1", baseUrl: "https://bound.test", namespace: "acme", adapterId: "codex" }));
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => { requests.push(String(url)); return jsonResponse({ deleted: true }); }));

    expect((await invoke(["source", "delete", "source_1", "--yes", "--json"])).code).toBe(0);
    expect(requests).toEqual(["https://bound.test/api/workbench/sources/source_1?namespace=acme"]);
    await expect(fs.stat(bindingRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("hard-cut CLI inventory", () => {
  test("teaches only Sources, Evals, Skills, and generic operations", async () => {
    expect(WORKBENCH_COMMAND_SURFACE.commands.map((entry) => entry.id)).toEqual(["source", "eval", "skill", "open", "watch", "retry", "cancel", "login", "logout", "help", "version"]);
    expect([renderWorkbenchHelp(), renderWorkbenchHelpAll(), renderWorkbenchCliReference()]
      .every((rendered) => ["source", "eval", "skill"].every((noun) => rendered.includes(`workbench ${noun}`)))).toBe(true);
    expect(renderWorkbenchHelpAll()).toContain("workbench eval run");
    expect(renderWorkbenchHelpAll()).toContain("workbench source evidence SOURCE_ID ANALYSIS_ID CITATION_ID");
    expect(renderWorkbenchHelpAll()).toContain("--node NODE_ID|--insight INSIGHT_ID|--workflow WORKFLOW_ID");
    expect(renderWorkbenchHelpAll()).toContain("--confirm --max-cost USD --preflight-token TOKEN");
  });

  test("rejects an undeclared command through the ordinary parser path", async () => {
    const result = await invoke(["definitely-not-a-command", "--json"]);
    expect(result.code).toBe(2);
    expect(output<{ ok: boolean; code: string }>(result)).toMatchObject({ ok: false, code: "usage" });
    expect((await invoke(["eval", "grade", "--samples", "2", "--json"])).code).toBe(2);
  });
});

describe("nested Skill and Eval commands", () => {
  test("creates a Skill and exposes its current Eval through nested nouns", async () => {
    const parent = await temporaryRoot();
    const project = path.join(parent, "invoice-skill");
    const created = await invoke(["skill", "new", project, "--agent", "local", "--json"]);
    expect(created.code).toBe(0);
    expect(output<{ schema: string }>(created).schema).toBe("workbench.cli.skill-new.v1");
    expect(await fs.readFile(path.join(project, "SKILL.md"), "utf8")).toContain("invoice-skill");

    const shown = await invoke(["skill", "show", "--dir", project, "--json"]);
    expect(shown.code).toBe(0);
    expect(output<{ schema: string; ok: boolean }>(shown)).toMatchObject({
      schema: "workbench.cli.skill-show.v1",
      ok: true,
    });

    expect(output<{ schema: string; ok: boolean }>(await invoke(["eval", "list", "--dir", project, "--json"]))).toMatchObject({
      schema: "workbench.cli.eval-list.v1",
      ok: true,
    });
    expect(output<{ remediation: string }>(await invoke(["eval", "run", "--agents", "missing", "--dry-run", "--dir", project, "--json"])).remediation).toBe("workbench eval run --agents default");
    const { id } = await reconcileCurrentWorkbenchVersion({ dir: project });
    expect(output<{ next: string }>(await invoke(["skill", "switch", id!, "--dry-run", "--dir", project, "--json"])).next).toMatch(/^workbench skill switch /u);
  });

  test("uses noun-qualified schemas for Skill state and Eval authoring", async () => {
    const parent = await temporaryRoot();
    const project = path.join(parent, "invoice-skill");
    expect((await invoke(["skill", "new", project, "--agent", "local", "--json"])).code).toBe(0);

    const cases = [
      { args: ["skill", "versions", "--dir", project, "--json"], schema: "workbench.cli.skill-versions.v1" },
      { args: ["eval", "results", "--dir", project, "--json"], schema: "workbench.cli.eval-results.v1" },
      { args: ["eval", "run", "--dry-run", "--dir", project, "--json"], schema: "workbench.cli.eval-run-plan.v1" },
      { args: ["eval", "grade", "--dry-run", "--dir", project, "--json"], schema: "workbench.cli.eval-grade-plan.v1" },
      { args: ["eval", "case", "draft", "schema-check", "--dir", project, "--json"], schema: "workbench.cli.eval-case-draft.v1" },
    ] as const;

    for (const entry of cases) {
      const result = await invoke([...entry.args]);
      expect(result.code, `${entry.args.join(" ")}\n${result.stderr}`).toBe(0);
      expect(output<{ schema: string }>(result).schema).toBe(entry.schema);
    }
  });

  test("recovers an interrupted transaction and applies an immutable Eval draft without running it", async () => {
    const parent = await temporaryRoot();
    const project = path.join(parent, "invoice-skill");
    expect((await invoke(["skill", "new", project, "--agent", "local", "--json"])).code).toBe(0);
    await configureCloud();
    await bindSource();
    await bindWorkbenchRemoteTarget("operation", OPERATION_ID, { baseUrl: "https://bound.test", namespace: "acme" }, process.env.HOME);

    const baseFiles = await currentEvalFiles(project);
    const patch = {
      schema: "workbench.eval.patch.v1" as const,
      changes: [{
        kind: "put" as const,
        file: { path: "cases/source-draft/case.yaml", content: "id: source-draft\nprompt: Review this invoice.\n" },
      }],
    };
    const expectedFiles = [
      ...baseFiles.filter((file) => file.path !== patch.changes[0].file.path),
      patch.changes[0].file,
    ].sort((left, right) => left.path.localeCompare(right.path));
    const expectedResultHash = hashFiles(expectedFiles);
    const expected = applyWorkbenchEvalPatch({
      baseFiles,
      baseHash: hashFiles(baseFiles),
      expectedResultHash,
      patch,
    });
    const draft = {
      schema: "workbench.eval-draft.v1",
      id: DRAFT_ID,
      sourceId: "source_1",
      snapshotId: "snapshot_1",
      analysisId: "analysis_1",
      reviewVersion: 1,
      reviewHash: "a".repeat(64),
      workflows: [{ id: "workflow_1", name: "Review invoice", description: "Checks invoice details.", citationIds: ["citation_1"] }],
      evidence: [{ citationId: "citation_1", quote: "The user checks invoice details." }],
      objective: "Verify invoice review.",
      destination: { kind: "local", skillName: "invoice-skill" },
      baseHash: hashFiles(baseFiles),
      expectedResultHash: expected.resultHash,
      patch,
      rationale: "Turns reviewed evidence into an explicit case.",
      citationIds: ["citation_1"],
      status: "ready",
      usage: { inputTokens: 10, outputTokens: 5, modelCalls: 1, costUsd: 0.01 },
      createdAt: "2026-07-14T00:00:00.000Z",
    } as const;

    const workbenchRoot = path.join(project, ".workbench");
    const transactionRoot = path.join(workbenchRoot, ".eval-apply-interrupted");
    await fs.mkdir(path.join(transactionRoot, "backup"), { recursive: true });
    await fs.mkdir(path.join(transactionRoot, "new"), { recursive: true });
    await fs.rename(path.join(workbenchRoot, "cases"), path.join(transactionRoot, "backup", "cases"));
    await fs.mkdir(path.join(workbenchRoot, "cases", "crash-state"), { recursive: true });
    await fs.writeFile(path.join(workbenchRoot, "cases", "crash-state", "case.yaml"), "id: crash-state\n");
    await fs.writeFile(path.join(transactionRoot, "transaction.json"), JSON.stringify({
      schema: "workbench.eval-apply-transaction.v1",
      planned: ["cases"],
    }));

    let servedDraft: unknown = { ...draft, destination: { ...draft.destination, skillName: "different-skill" } };
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url).includes("/operations/")) return jsonResponse({ operation: operation({ id: OPERATION_ID, status: "succeeded", resultId: DRAFT_ID, kind: "eval.draft" }) });
      if (String(url).includes("/sources/source_1")) return jsonResponse({ deleted: true });
      if (init?.method === "DELETE") return jsonResponse({ draft: { ...draft, status: "discarded", discarded: { actor: "user_1", at: "2026-07-14T00:02:00.000Z" } } });
      if ((init?.method ?? "GET") === "POST") {
        return jsonResponse({ draft: { ...draft, status: "applied", applied: { resultHash: expected.resultHash, actor: "user_1", at: "2026-07-14T00:01:00.000Z" } } });
      }
      return jsonResponse({ draft: servedDraft });
    }));

    expect(output<{ next: string }>(await invoke(["watch", OPERATION_ID, "--json"])).next).toBe(`workbench eval apply ${DRAFT_ID} --yes`);
    expect((await invoke(["source", "delete", "source_1", "--yes", "--json"])).code).toBe(0);

    const mismatched = await invoke(["eval", "apply", DRAFT_ID, "--dir", project, "--yes", "--json"]);
    expect(mismatched.code).toBe(2);
    expect(output<{ message: string }>(mismatched).message).toMatch(/targets Skill different-skill/u);
    await expect(fs.stat(path.join(workbenchRoot, "cases", "source-draft", "case.yaml")))
      .rejects.toMatchObject({ code: "ENOENT" });

    servedDraft = {
      ...draft,
      baseHash: "e".repeat(64),
      expectedResultHash: "f".repeat(64),
    };
    const stale = await invoke(["eval", "apply", DRAFT_ID, "--dir", project, "--yes", "--json"]);
    expect(stale.code).not.toBe(0);
    expect(output<{ message: string }>(stale).message).toMatch(/Eval base changed/u);
    await expect(fs.stat(path.join(workbenchRoot, "cases", "source-draft", "case.yaml")))
      .rejects.toMatchObject({ code: "ENOENT" });

    servedDraft = {
      ...draft,
      patch: { schema: "workbench.eval.patch.v1", changes: [{ kind: "delete", path: "eval.yaml" }] },
      expectedResultHash: hashFiles(baseFiles.filter((file) => file.path !== "eval.yaml")),
    };
    const invalid = await invoke(["eval", "apply", DRAFT_ID, "--dir", project, "--yes", "--json"]);
    expect(invalid.code).not.toBe(0);
    expect(output<{ message: string }>(invalid).message).toMatch(/eval\.yaml grade\.adapter/u);
    expect(await fs.readFile(path.join(workbenchRoot, "eval.yaml"), "utf8")).toContain("grade:");

    servedDraft = draft;
    const applied = await invoke(["eval", "apply", DRAFT_ID, "--dir", project, "--yes", "--json"]);
    expect(applied.code).toBe(0);
    expect(await fs.readFile(path.join(workbenchRoot, "cases", "source-draft", "case.yaml"), "utf8"))
      .toContain("Review this invoice");
    expect(await fs.readdir(workbenchRoot)).not.toContain(".eval-apply-interrupted");
    expect((await fs.readdir(workbenchRoot)).some((entry) => entry.startsWith(".eval-apply-"))).toBe(false);
    const draftRequests = requests.filter((request) => request.includes(`/eval-drafts/${DRAFT_ID}`));
    expect(draftRequests).toHaveLength(5);
    expect(draftRequests[4]).toContain(`/eval-drafts/${DRAFT_ID}/apply`);
    expect(output<{ alreadyApplied: boolean }>(applied).alreadyApplied).toBe(false);
    const discarded = await invoke(["eval", "discard", DRAFT_ID, "--yes", "--json"]);
    expect(output<{ draft: { status: string } }>(discarded).draft.status).toBe("discarded");
    expect(requests.at(-1)).toBe(`DELETE https://bound.test/api/workbench/eval-drafts/${DRAFT_ID}?namespace=acme`);
  });
});

describe("model preflight and generic operations", () => {
  test("requires an explicit Eval draft cap without generating an executable confirmation", async () => {
    const parent = await temporaryRoot();
    const project = path.join(parent, "invoice skill");
    expect((await invoke(["skill", "new", project, "--agent", "local", "--json"])).code).toBe(0);
    await configureCloud();
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/sources/analyses/analysis_1")) {
        return jsonResponse({ analysis: { sourceId: "source_1", snapshotId: "snapshot_1" } });
      }
      return jsonResponse({ preflight: modelPreflight("eval.draft", "draft-token") });
    });
    vi.stubGlobal("fetch", fetchMock);

    const blankObjective = await invoke([
      "eval", "draft", "--source", "source_1", "--analysis", "analysis_1", "--review-version", "1",
      "--review-hash", "a".repeat(64), "--workflows", "workflow_1", "--objective", " \t ",
      "--destination", "local", "--dir", project, "--json",
    ]);
    expect(blankObjective.code).toBe(2);
    expect(output<{ message: string }>(blankObjective).message).toBe("--objective requires a value.");
    expect(fetchMock).not.toHaveBeenCalled();

    const result = await invoke([
      "eval", "draft",
      "--source", "source_1",
      "--analysis", "analysis_1",
      "--review-version", "1",
      "--review-hash", "a".repeat(64),
      "--workflows", "workflow_1",
      "--objective", "Judge invoice reconciliation.",
      "--destination", "local",
      "--dir", project,
      "--json",
    ]);

    expect(result.code, result.stderr).toBe(0);
    const reviewed = output<{ next: null; preflight: { token: string } }>(result);
    expect(reviewed.next).toBeNull();
    expect(reviewed.preflight.token).toBe("draft-token");
  });

  test("confirms the exact reviewed input without requesting a fresh preflight", async () => {
    await configureCloud();
    const preflight = modelPreflight("source.analyze", "reviewed-token");
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      const body = init?.body ? JSON.parse(String(init.body)) as { authorization?: unknown } : {};
      return jsonResponse(body.authorization ? {
        operation: operation({ id: OPERATION_ID, status: "queued" }),
      } : { preflight });
    }));

    expect((await invoke(["source", "analyze", "source_1", "--namespace", "acme", "--json"])).code).toBe(2);
    const reviewed = await invoke(["source", "analyze", "source_1", "--record-limit", "100", "--namespace", "acme", "--json"]);
    expect(reviewed.code).toBe(0);
    const reviewedBody = output<{ next: null; preflight: { token: string } }>(reviewed);
    expect(reviewedBody.next).toBeNull();
    expect(reviewedBody.preflight.token).toBe("reviewed-token");
    expect(JSON.parse(String(requests[0]!.init?.body))).toMatchObject({ map: "omit" });

    const human = await invoke(["source", "analyze", "source_1", "--record-limit", "100", "--namespace", "acme"]);
    expect(human.stdout).toContain("absolute safety ceiling");
    expect(human.stdout).toContain("Choose an explicit cap after review");
    expect(human.stdout).toContain("No executable confirmation command is generated");
    expect(human.stdout).toContain("analysis-model");
    expect(human.stdout).toContain("cloud");

    requests.length = 0;
    const confirmed = await invoke([
      "source", "analyze", "source_1", "--namespace", "acme", "--confirm", "--max-cost", "0.5",
      "--record-limit", "100",
      "--preflight-token", "reviewed-token", "--json",
    ]);
    expect(confirmed.code).toBe(0);
    expect(requests).toHaveLength(1);
    expect(JSON.parse(String(requests[0]!.init?.body))).toMatchObject({
      map: "omit",
      authorization: { token: "reviewed-token", maximumCostUsd: 0.5 },
    });
    expect(output<{ next: string }>(confirmed).next).toBe(`workbench watch ${OPERATION_ID}`);
  });

  test("watches, retries, and cancels generic operations with namespace continuity", async () => {
    await configureCloud();
    await bindSource();
    await bindWorkbenchRemoteTarget("operation", OPERATION_ID, { baseUrl: "https://bound.test", namespace: "acme" }, process.env.HOME);
    const requests: Array<{ method: string; url: string; authorization: string | null }> = [];
    let exhausted = false, putBody: unknown;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({ method, url: String(url), authorization: new Headers(init?.headers).get("authorization") });
      if (method === "POST") return jsonResponse(exhausted ? { preflight: modelPreflight("source.analyze", "raised-token") } : { operation: operation({ id: OPERATION_ID, status: "queued" }) });
      if (method === "PUT") { putBody = JSON.parse(String(init?.body)); return jsonResponse({ operation: operation({ id: OPERATION_ID, status: "queued" }) }); }
      if (method === "DELETE") return jsonResponse({ operation: operation({ id: OPERATION_ID, status: "canceled" }) });
      return jsonResponse({ operation: operation({ id: OPERATION_ID, status: "succeeded", resultId: "analysis_1" }) });
    }));

    const watched = await invoke(["watch", OPERATION_ID, "--json"]);
    expect(watched.code).toBe(0);
    expect(output<{ next: string }>(watched).next).toBe("workbench source show source_1 --analysis analysis_1 --namespace acme");

    const retried = await invoke(["retry", OPERATION_ID, "--json"]);
    expect(retried.code).toBe(0);
    expect(output<{ next: string }>(retried).next).toBe(`workbench watch ${OPERATION_ID}`);

    exhausted = true;
    expect(output<{ preflight: { token: string } }>(await invoke(["retry", OPERATION_ID, "--json"])).preflight.token).toBe("raised-token");
    const raised = await invoke(["retry", OPERATION_ID, "--confirm", "--max-cost", "0.6", "--preflight-token", "raised-token", "--json"]);
    expect([raised.code, putBody]).toEqual([0, { token: "raised-token", maximumCostUsd: 0.6 }]);

    const canceled = await invoke(["cancel", OPERATION_ID, "--json"]);
    expect(canceled.code).toBe(0);
    expect(output<{ next: string }>(canceled).next).toBe(`workbench watch ${OPERATION_ID}`);
    expect(requests.every((entry) => entry.url.startsWith("https://bound.test/") && entry.url.endsWith("?namespace=acme"))).toBe(true);
    expect(requests.every((entry) => entry.authorization === null)).toBe(true);
    expect(requests.map((entry) => entry.method)).toEqual(["GET", "GET", "POST", "GET", "POST", "GET", "PUT", "GET", "DELETE"]);
    await expect(bindWorkbenchRemoteTarget("operation", OPERATION_ID, { baseUrl: "https://other.test" }, process.env.HOME)).rejects.toThrow(/another backend/u);
    const calls = requests.length, binding = path.join(process.env.HOME!, ".workbench", "remote-targets", "operation", `${OPERATION_ID}.json`);
    await fs.writeFile(binding, "{");
    expect((await invoke(["watch", OPERATION_ID, "--json"])).code).toBe(1);
    expect((await invoke(["watch", "run_missing", "--json"])).code).not.toBe(0);
    expect(requests).toHaveLength(calls);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-cli-hard-cut-"));
  temporaryRoots.push(root);
  return root;
}

async function configureCloud(): Promise<void> {
  const root = await temporaryRoot();
  const config = path.join(root, "config.json");
  await fs.writeFile(config, `${JSON.stringify({ baseUrl: "https://cloud.test", accessToken: "token" })}\n`);
  process.env.WORKBENCH_CONFIG = config;
}

async function bindSource(sourceId = "source_1", baseUrl = "https://bound.test", namespace = "acme"): Promise<void> {
  const home = await temporaryRoot();
  vi.stubEnv("HOME", home);
  const root = path.join(home, ".workbench", "sources", sourceId);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "binding.json"), JSON.stringify({ schema: "workbench.source-binding.v2", sourceId, baseUrl, namespace, adapterId: "codex" }));
}

async function currentEvalFiles(project: string): Promise<SurfaceSnapshotFile[]> {
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: project });
  return (currentWorkbenchEvalSnapshot(snapshot)?.files ?? []).flatMap((file) => {
    const relative = file.path.replace(/^\.workbench\//u, "");
    return relative === "eval.yaml" || relative.startsWith("cases/") || relative.startsWith("environment/")
      ? [{ ...file, path: relative }]
      : [];
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function operation(overrides: { id: string; status: "queued" | "succeeded" | "canceled"; resultId?: string; kind?: "source.analyze" | "eval.draft" }) {
  const kind = overrides.kind ?? "source.analyze";
  return {
    schema: "workbench.operation.v1",
    id: overrides.id,
    owner: kind === "source.analyze" ? "source" : "eval",
    kind,
    targetId: "source_1",
    status: overrides.status,
    ...(overrides.resultId ? { resultId: overrides.resultId } : {}),
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:01.000Z",
  };
}

function modelPreflight(kind: "source.analyze" | "eval.draft", token: string) {
  return {
    schema: "workbench.model-preflight.v1", token, kind, model: kind === "source.analyze" ? "analysis-model" : "draft-model", locality: "cloud", egress: "evidence", egressDescription: "selected evidence",
    ...(kind === "source.analyze" ? { map: "omit" } : {}), scope: { description: kind === "source.analyze" ? "one Source" : "one Eval draft", itemCount: 1, byteCount: 42 },
    maximumInputTokens: 10, maximumOutputTokens: 5, firstAttemptMaximumModelCalls: 1, firstAttemptMaximumCostUsd: 0.25, maximumModelCalls: 2, maximumRetries: 1, maximumAuthorizedCostUsd: 0.75, maximumExecutionSeconds: 7_200, expiresAt: "2026-07-15T01:00:00.000Z",
  };
}
