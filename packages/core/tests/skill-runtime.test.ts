import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  addWorkbenchCase,
  addWorkbenchAgent,
  addWorkbenchRemote,
  checkWorkbenchSkill,
  compareWorkbench,
  createWorkbenchExecutionCapability,
  createWorkbenchSandboxAllocation,
  createWorkbenchSkillEvalRuntimeInput,
  createWorkbenchSkillImproveRuntimeInput,
  createWorkbenchInspectionSnapshot,
  diffWorkbenchVersions,
  DOCKER_SANDBOX_BACKEND,
  executeQueuedWorkbenchSkillEvalJob,
  executeWorkbenchExecutionJob,
  executeRuntimeControlOperationSequenceInCurrentRuntime,
  evalWorkbenchProjectState,
  evalWorkbenchSkill,
  exportObjectPack,
  filesForWorkbenchRef,
  hashFiles,
  hashJson,
  improveWorkbenchSkill,
  initWorkbenchSkill,
  readWorkbenchSkillRunOutputUsage,
  readWorkbenchSkillTraceResultsCostUsd,
  listWorkbenchVersions,
  publishWorkbenchVersion,
  setDefaultWorkbenchAgent,
  showWorkbenchRef,
  switchWorkbenchVersion,
  syncWorkbenchRemote,
  type Json,
  type SandboxPlane,
  type WorkbenchProjectState,
  type WorkbenchExecutionRuntimeInput,
  type WorkbenchTrace,
  workbenchImprovementEvidenceTraces,
  workbenchImprovementEvidenceTracesForVersion,
  workbenchStatus,
} from "../src/index.ts";

const hasDocker = spawnSync("docker", ["info"], { encoding: "utf8" }).status === 0;
const dockerTest = hasDocker ? test : test.skip;
const tempRoots: string[] = [];

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })
  ));
});

describe("skill-first Workbench runtime", () => {
  dockerTest("versions, evaluates, improves, compares, and switches a skill with Docker jobs", async () => {
    const root = await makeTempRoot("workbench-skill-runtime-");
    await initWorkbenchSkill({ dir: root });

    const initial = (await listWorkbenchVersions({ dir: root }))[0]!;
    const runs = await evalWorkbenchSkill({ dir: root });
    await expect(improveWorkbenchSkill({ dir: root, budget: 1 })).rejects.toThrow(/needs failed or reviewed trace evidence/u);
    await writeFailingCaseTest(root, "missing workflow-specific output");
    const defaultFailingRuns = await evalWorkbenchSkill({ dir: root });
    await expect(improveWorkbenchSkill({ dir: root, budget: 1 })).rejects.toThrow(/no skill-improvement adapter/u);
    await addWorkbenchAgent({
      dir: root,
      name: "patcher",
      adapter: "command",
      config: {
        improveCommand: "printf '\\nCommand-backed improvement from trace evidence.\\n' >> \"$SKILL_DIR/SKILL.md\"",
      },
    });
    const failingRuns = await evalWorkbenchSkill({ dir: root, agent: "patcher" });
    const improved = await improveWorkbenchSkill({ dir: root, agent: "patcher", budget: 1 });
    const diff = await diffWorkbenchVersions(`${initial.id}..${improved.version.id}`, { dir: root });
    const comparison = await compareWorkbench({ dir: root });
    const snapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    const traceCase = await addWorkbenchCase({ dir: root, fromTraceId: failingRuns[0]!.traceIds[0] });

    expect(initial.id).toBe("v001");
    expect(runs[0]).toMatchObject({ versionId: "v001", status: "succeeded" });
    expect(runs[0]?.score).toBeUndefined();
    expect(runs[0]?.costUsd).toBeUndefined();
    expect(runs[0]?.jobIds).toHaveLength(1);
    const smokeTrace = snapshot.traces.find((trace) => trace.runId === runs[0]?.id);
    expect((smokeTrace?.result as Record<string, unknown> | undefined)?.score).toBeUndefined();
    expect(((smokeTrace?.result as { metrics?: Record<string, unknown> } | undefined)?.metrics)?.score).toBeUndefined();
    expect(((smokeTrace?.result as { cases?: Array<{ metrics?: Record<string, unknown> }> } | undefined)?.cases?.[0]?.metrics)?.score).toBeUndefined();
    const smokeExecution = (smokeTrace?.request as { execution?: {
      id?: string;
      versionId?: string;
      inputs?: Array<{ name?: string; ref?: string }>;
      metadata?: Record<string, unknown>;
    } } | undefined)?.execution;
    expect(smokeExecution?.id).toContain("case_case_001");
    expect(smokeExecution?.versionId).toBe("v001");
    expect(smokeExecution?.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "skills", ref: "workbench://skills/local/versions/v001" }),
      expect.objectContaining({ name: "case", ref: "workbench://skills/local/cases/case-001" }),
    ]));
    expect(smokeExecution?.metadata).toMatchObject({
      skillEval: true,
      skillName: "primary",
      agentName: "default",
      executionAdapter: "command",
      smoke: true,
    });
    expect(defaultFailingRuns[0]).toMatchObject({ status: "failed", score: 0 });
    expect(failingRuns[0]).toMatchObject({ agentName: "patcher", status: "failed", score: 0 });
    expect(improved.version.parentIds).toEqual([failingRuns[0]!.versionId]);
    expect(improved.version.id).not.toBe(failingRuns[0]!.versionId);
    expect(improved.switched).toBe(false);
    expect(improved.promoted).toBe(false);
    expect(improved.promotionReason).toContain("finished failed");
    expect(await fs.readFile(path.join(root, "SKILL.md"), "utf8")).not.toContain("Workbench Improvement Notes");
    const improvedSkill = improved.version.files.find((file) => file.path === "SKILL.md")?.content ?? "";
    expect(improvedSkill).toContain("Command-backed improvement from trace evidence.");
    expect(improvedSkill).not.toContain("Workbench Improvement Notes");
    expect(diff.map((entry) => entry.path)).toContain("SKILL.md");
    expect(comparison.cells.some((cell) => cell.versionId === improved.version.id && typeof cell.score === "number")).toBe(true);
    expect(comparison.cells.some((cell) => cell.versionId === improved.version.id && cell.costUsd === undefined)).toBe(true);
    expect(comparison.cells.some((cell) => cell.versionId === improved.version.id && cell.automationReadiness?.label === "Assist")).toBe(true);
    expect(traceCase.content).toContain("sourceTraceId");
    expect(await fs.readFile(path.join(root, ".workbench", "cases", traceCase.id, "trace", "result.json"), "utf8")).toContain("missing workflow-specific output");
    expect(await fs.readFile(path.join(root, ".workbench", "cases", traceCase.id, "tests", "test.sh"), "utf8")).toContain("needs expert acceptance criteria");
    expect(snapshot.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ runId: runs[0]?.id, caseId: "case-001", status: "succeeded" }),
    ]));
    expect(snapshot.status.automationReadiness?.label).toBe("Assist");
    expect(snapshot.artifacts.length).toBeGreaterThan(0);
    expect(snapshot.lineage).toEqual(expect.arrayContaining([
      expect.objectContaining({ parentId: failingRuns[0]!.versionId, childId: improved.version.id, reason: "improve" }),
    ]));

    await switchWorkbenchVersion("v001", { dir: root });
    expect((await workbenchStatus({ dir: root })).currentVersionId).toBe("v001");
  }, 60_000);

  dockerTest("runs explicit version evals from the selected version source snapshot", async () => {
    const root = await makeTempRoot("workbench-selected-version-eval-");
    await initWorkbenchSkill({ dir: root });
    const initial = (await listWorkbenchVersions({ dir: root }))[0]!;
    const initialRuns = await evalWorkbenchSkill({ dir: root });
    expect(initialRuns[0]).toMatchObject({ versionId: initial.id, status: "succeeded" });

    await writeFailingCaseTest(root, "current case should not be used by v001");
    const currentRuns = await evalWorkbenchSkill({ dir: root, rerun: true });
    expect(currentRuns[0]).toMatchObject({ status: "failed" });

    const selectedRuns = await evalWorkbenchSkill({ dir: root, version: initial.id, rerun: true });
    expect(selectedRuns[0]).toMatchObject({ versionId: initial.id, status: "succeeded" });

    await fs.appendFile(path.join(root, "SKILL.md"), "\nDirty edit before explicit-version eval.\n");
    const dirtySelectedRuns = await evalWorkbenchSkill({ dir: root, version: initial.id, rerun: true });
    const dirtyCurrentVersion = JSON.parse(
      await fs.readFile(path.join(root, ".workbench", "objects", "version", "v003.json"), "utf8"),
    ) as WorkbenchProjectState["versions"][number];
    expect(dirtySelectedRuns[0]).toMatchObject({ versionId: initial.id, status: "succeeded" });
    expect(dirtyCurrentVersion.files.find((file) => file.path === "SKILL.md")?.content).toContain("Dirty edit before explicit-version eval.");
  }, 60_000);

  dockerTest("does not reuse eval runs when the same-name agent hash differs", async () => {
    const root = await makeTempRoot("workbench-agent-hash-reuse-");
    await initWorkbenchSkill({ dir: root });
    const [firstRun] = await evalWorkbenchSkill({ dir: root });
    expect(firstRun).toBeDefined();

    const runPath = path.join(root, ".workbench", "objects", "run", `${firstRun!.id}.json`);
    const storedRun = JSON.parse(await fs.readFile(runPath, "utf8")) as WorkbenchProjectState["runs"][number];
    await fs.writeFile(runPath, `${JSON.stringify({ ...storedRun, agentHash: "stale_agent_hash" }, null, 2)}\n`);

    const [secondRun] = await evalWorkbenchSkill({ dir: root });
    expect(secondRun?.id).not.toBe(firstRun!.id);
    expect(secondRun?.agentHash).not.toBe("stale_agent_hash");
  });

  test("fails on corrupt Workbench objects instead of starting from empty history", async () => {
    const root = await makeTempRoot("workbench-corrupt-state-");
    await initWorkbenchSkill({ dir: root });
    const versionPath = path.join(root, ".workbench", "objects", "version", "v001.json");
    const validVersion = await fs.readFile(versionPath, "utf8");

    await fs.writeFile(versionPath, "{not json");
    await expect(workbenchStatus({ dir: root })).rejects.toThrow(/JSON/u);
    await fs.writeFile(versionPath, validVersion);

    const malformedCases: Array<[string, string, Record<string, unknown>, RegExp]> = [
      ["version", path.join(root, ".workbench", "objects", "version", "v001.json"), { id: "v_bad" }, /versions\[0\]\.hash/u],
      ["eval", path.join(root, ".workbench", "objects", "eval", "eval_bad.json"), { hash: "eval_bad" }, /evals\[\d+\]\.files/u],
      ["agent", path.join(root, ".workbench", "objects", "agent", "bad.json"), { name: "bad" }, /agents\[\d+\]\.adapter/u],
      ["run", path.join(root, ".workbench", "objects", "run", "run_bad.json"), { id: "run_bad" }, /runs\[\d+\]\.kind/u],
      ["job", path.join(root, ".workbench", "objects", "job", "job_bad.json"), { id: "job_bad" }, /jobs\[\d+\]\.runId/u],
      ["trace", path.join(root, ".workbench", "objects", "trace", "trace_bad.json"), { id: "trace_bad" }, /traces\[\d+\]\.runId/u],
      ["artifact", path.join(root, ".workbench", "objects", "artifact", "artifact_bad.json"), { id: "artifact_bad" }, /artifacts\[\d+\]\.runId/u],
      ["lineage", path.join(root, ".workbench", "objects", "lineage", "bad.json"), { parentId: "v001" }, /lineage\[\d+\]\.childId/u],
    ];
    for (const [label, filePath, value, expected] of malformedCases) {
      const previous = await fs.readFile(filePath, "utf8").catch(() => null);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
      await expect(workbenchStatus({ dir: root }), label).rejects.toThrow(expected);
      if (previous === null) {
        await fs.rm(filePath, { force: true });
      } else {
        await fs.writeFile(filePath, previous);
      }
    }

    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), "origin: {}\n");
    await expect(workbenchStatus({ dir: root })).rejects.toThrow(/remote origin must be a non-empty URL/u);
  });

  test("show and files reconcile manual edits before resolving current", async () => {
    const root = await makeTempRoot("workbench-show-files-current-");
    await initWorkbenchSkill({ dir: root });
    const initial = await workbenchStatus({ dir: root });
    expect(initial.currentVersionId).toBe("v001");

    await fs.appendFile(path.join(root, "SKILL.md"), "\nManual command-boundary edit.\n");

    const shown = await showWorkbenchRef("current:SKILL.md", { dir: root }) as { path?: string; content?: string };
    const files = await filesForWorkbenchRef("current", { dir: root });
    const status = await workbenchStatus({ dir: root });

    expect(status.currentVersionId).toBe("v002");
    expect(shown.path).toBe("SKILL.md");
    expect(shown.content).toContain("Manual command-boundary edit.");
    expect(files.find((file) => file.path === "SKILL.md")?.content).toContain("Manual command-boundary edit.");
  });

  test("explicit-version improve reconciles manual edits before resolving the base version", async () => {
    const root = await makeTempRoot("workbench-improve-explicit-dirty-");
    await initWorkbenchSkill({ dir: root });
    const initial = (await listWorkbenchVersions({ dir: root }))[0]!;

    await fs.appendFile(path.join(root, "SKILL.md"), "\nDirty edit before explicit-version improve.\n");
    await expect(improveWorkbenchSkill({ dir: root, version: initial.id })).rejects.toThrow(/needs failed or reviewed trace evidence/u);

    const dirtyCurrentVersion = JSON.parse(
      await fs.readFile(path.join(root, ".workbench", "objects", "version", "v002.json"), "utf8"),
    ) as WorkbenchProjectState["versions"][number];
    expect(dirtyCurrentVersion.files.find((file) => file.path === "SKILL.md")?.content).toContain("Dirty edit before explicit-version improve.");
  });

  test("preserves local current refs when syncing remote refs", async () => {
    const root = await makeTempRoot("workbench-ref-sync-");
    const remote = await makeTempRoot("workbench-ref-sync-remote-");
    await initWorkbenchSkill({ dir: root });
    await addWorkbenchRemote("origin", remote, { dir: root });
    await syncWorkbenchRemote({ dir: root });
    const before = await workbenchStatus({ dir: root });
    expect(before.currentVersionId).toBeDefined();

    const remoteRefsPath = path.join(remote, "refs.json");
    const remoteRefs = JSON.parse(await fs.readFile(remoteRefsPath, "utf8")) as Record<string, string>;
    await fs.writeFile(remoteRefsPath, `${JSON.stringify({ ...remoteRefs, current: "v001" }, null, 2)}\n`);

    await syncWorkbenchRemote({ dir: root });
    const after = await workbenchStatus({ dir: root });
    expect(after.currentVersionId).toBe(before.currentVersionId);
    expect(JSON.parse(await fs.readFile(remoteRefsPath, "utf8"))).toMatchObject({
      current: before.currentVersionId,
    });
  });

  dockerTest("keeps evidenced local objects when a remote has only a divergent bootstrap object", async () => {
    const localRoot = await makeTempRoot("workbench-evidenced-local-");
    const remoteProject = await makeTempRoot("workbench-unevidenced-remote-project-");
    const remote = await makeTempRoot("workbench-unevidenced-remote-");
    await initWorkbenchSkill({ dir: remoteProject });
    const remoteVersionPath = path.join(remoteProject, ".workbench", "objects", "version", "v001.json");
    const remoteVersion = JSON.parse(await fs.readFile(remoteVersionPath, "utf8")) as { hash: string; files: Array<{ path: string; content: string }> };
    remoteVersion.hash = "remote_bootstrap_hash";
    remoteVersion.files = remoteVersion.files.map((file) =>
      file.path === "SKILL.md" ? { ...file, content: "# Remote Bootstrap\n" } : file
    );
    await fs.writeFile(remoteVersionPath, `${JSON.stringify(remoteVersion, null, 2)}\n`);
    await addWorkbenchRemote("origin", remote, { dir: remoteProject });
    await syncWorkbenchRemote({ dir: remoteProject });

    await initWorkbenchSkill({ dir: localRoot });
    const localSkill = await fs.readFile(path.join(localRoot, "SKILL.md"), "utf8");
    await evalWorkbenchSkill({ dir: localRoot });
    await addWorkbenchRemote("origin", remote, { dir: localRoot });
    await expect(syncWorkbenchRemote({ dir: localRoot })).resolves.toMatchObject({
      remote: { name: "origin" },
    });
    const syncedRemoteVersion = JSON.parse(await fs.readFile(path.join(remote, "objects", "version", "v001.json"), "utf8")) as { files: Array<{ path: string; content: string }> };
    expect(syncedRemoteVersion.files.find((file) => file.path === "SKILL.md")?.content).toBe(localSkill);
  });

  test("preserves historical agent snapshots by hash", async () => {
    const root = await makeTempRoot("workbench-agent-snapshots-");
    await initWorkbenchSkill({ dir: root });
    const agentObjectDir = path.join(root, ".workbench", "objects", "agent");
    const initialAgents = await fs.readdir(agentObjectDir);

    await addWorkbenchAgent({
      dir: root,
      name: "default",
      adapter: "command",
      config: { command: "true" },
    });

    const updatedAgents = await fs.readdir(agentObjectDir);
    expect(updatedAgents.length).toBeGreaterThan(initialAgents.length);
    expect(await fs.readFile(path.join(root, ".workbench", "agents.yaml"), "utf8")).toContain("adapter: command");
  });

  test("status post-syncs automatic versions created by read-only inspection", async () => {
    const root = await makeTempRoot("workbench-status-sync-");
    const remote = await makeTempRoot("workbench-status-sync-remote-");
    await initWorkbenchSkill({ dir: root });
    await addWorkbenchRemote("origin", `file://${remote}`, { dir: root });
    await syncWorkbenchRemote({ dir: root });

    await fs.writeFile(path.join(root, "SKILL.md"), "# Skill\n\nEdited from status.\n");
    const status = await workbenchStatus({ dir: root });

    expect(status.currentVersionId).toBeTruthy();
    await expect(fs.stat(path.join(remote, "objects", "version", `${status.currentVersionId}.json`))).resolves.toBeTruthy();
  });

  test("rejects unpinned remote skill sources", async () => {
    const root = await makeTempRoot("workbench-unpinned-skill-");
    await initWorkbenchSkill({ dir: root });
    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "skills:",
      "  upstream:",
      "    from: github:anthropics/skills//skills/frontend-design",
      "",
    ].join("\n"));

    await expect(checkWorkbenchSkill({ dir: root })).rejects.toThrow(/explicit ref/u);
  });

  test("resolves Workbench Cloud source URLs as pinned remote skill sources", async () => {
    const root = await makeTempRoot("workbench-cloud-source-skill-");
    await initWorkbenchSkill({ dir: root });
    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "skills:",
      "  cloud:",
      "    from: https://cloud.test/api/workbench/public/skills/alice/cloud-skill/source",
      "    ref: v003",
      "",
    ].join("\n"));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/api/workbench/public/skills/alice/cloud-skill/releases/v003/source") {
        return Response.json({
          schema: "workbench.source.manifest.v1",
          owner: "alice",
          name: "cloud-skill",
          versionId: "v003",
          files: [
            { path: "SKILL.md", kind: "text", encoding: "utf8", executable: false },
            { path: ".workbench/eval.yaml", kind: "text", encoding: "utf8", executable: false },
          ],
        });
      }
      if (url.pathname === "/api/workbench/public/skills/alice/cloud-skill/releases/v003/source/SKILL.md") {
        return new Response("# Cloud Skill\n");
      }
      throw new Error(`Unexpected source fetch ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const checked = await checkWorkbenchSkill({ dir: root, skill: "cloud" });

    expect(checked.ok).toBe(true);
    expect(checked.plan.skills[0]?.fileCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://cloud.test/api/workbench/public/skills/alice/cloud-skill/releases/v003/source"),
      expect.any(Object),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      new URL("https://cloud.test/api/workbench/public/skills/alice/cloud-skill/releases/v003/source/.workbench/eval.yaml"),
      expect.any(Object),
    );
  });

  test("uses the command auth token when resolving private Workbench source URLs", async () => {
    const root = await makeTempRoot("workbench-private-cloud-source-skill-");
    await initWorkbenchSkill({ dir: root });
    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "skills:",
      "  private_cloud:",
      "    from: https://cloud.test/api/workbench/skills/skill_private/source",
      "    ref: v007",
      "",
    ].join("\n"));
    const seenAuthHeaders: Array<string | null> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      seenAuthHeaders.push(new Headers(init?.headers).get("authorization"));
      if (url.pathname === "/api/workbench/skills/skill_private/releases/v007/source") {
        return Response.json({
          schema: "workbench.source.manifest.v1",
          owner: "alice",
          name: "private-skill",
          versionId: "v007",
          files: [{ path: "SKILL.md", kind: "text", encoding: "utf8", executable: false }],
        });
      }
      if (url.pathname === "/api/workbench/skills/skill_private/releases/v007/source/SKILL.md") {
        return new Response("# Private Cloud Skill\n");
      }
      throw new Error(`Unexpected source fetch ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const checked = await checkWorkbenchSkill({
      dir: root,
      skill: "private_cloud",
      authToken: "private-token",
    });

    expect(checked.ok).toBe(true);
    expect(seenAuthHeaders).toEqual(["Bearer private-token", "Bearer private-token"]);
  });

  test("fails on missing or incomplete agent files instead of creating implicit agents", async () => {
    const root = await makeTempRoot("workbench-agent-required-");
    await initWorkbenchSkill({ dir: root });

    await fs.rm(path.join(root, ".workbench", "agents.yaml"), { force: true });
    await expect(workbenchStatus({ dir: root })).rejects.toThrow(/Missing \.workbench\/agents\.yaml/u);

    await fs.writeFile(path.join(root, ".workbench", "agents.yaml"), "default: default\nagents: {}\n");
    await expect(workbenchStatus({ dir: root })).rejects.toThrow(/No agents configured/u);

    await fs.writeFile(path.join(root, ".workbench", "agents.yaml"), "agents:\n  broken:\n    with: {}\n");
    await expect(workbenchStatus({ dir: root })).rejects.toThrow(/Agent broken .* must define a non-empty adapter/u);
  });

  test("reports zero eval cases without inflating project readiness", async () => {
    const root = await makeTempRoot("workbench-zero-cases-");
    await initWorkbenchSkill({ dir: root });
    await fs.rm(path.join(root, ".workbench", "cases"), { recursive: true, force: true });

    const check = await checkWorkbenchSkill({ dir: root });

    expect(check.cases).toBe(0);
    expect(check.plan.source.caseCount).toBe(0);
  });

  test("bounds skill improve trace inputs to structured and small text evidence", () => {
    const input = createWorkbenchSkillImproveRuntimeInput({
      ownerUserId: "user_123",
      projectId: "skill_123",
      runId: "run_123",
      jobId: "job_123",
      baseVersionId: "v001",
      evalHash: "eval_123",
      agent: {
        name: "claude",
        adapter: "claude",
        model: "claude-test",
        config: {
          timeoutMinutes: 10,
        },
      },
      baseFiles: [
        {
          path: "SKILL.md",
          kind: "text",
          encoding: "utf8",
          content: "---\nname: test\n---\n",
          executable: false,
        },
      ],
      traces: [
        {
          id: "trace_big",
          runId: "run_old",
          jobId: "job_old",
          versionId: "v001",
          agentName: "claude",
          createdAt: "2026-06-08T00:00:00.000Z",
          request: { caseId: "case-001" },
          result: { status: "failed", error: "needs better formulas" },
          files: [
            {
              path: "three_statement_model.xlsx",
              kind: "binary",
              encoding: "base64",
              content: "UEsDBAo=",
              executable: false,
            },
            {
              path: ".workbench/traces/job_old/host/result.json",
              kind: "text",
              encoding: "utf8",
              content: "large structured duplicate",
              executable: false,
            },
            {
              path: "stdout.log",
              kind: "text",
              encoding: "utf8",
              content: "x".repeat(40_000),
              executable: false,
            },
            {
          path: "summary.md",
              kind: "text",
              encoding: "utf8",
              content: "model summary",
              executable: false,
            },
          ],
          skillName: "primary",
          skillBundleHash: "skill_bundle_hash",
        } satisfies WorkbenchTrace,
      ],
      createdAt: "2026-06-08T00:00:00.000Z",
    });

    const traceFiles = input.traceFiles ?? [];
    const paths = traceFiles.map((file) => file.path);
    expect(paths).toContain("trace_big/request.json");
    expect(paths).toContain("trace_big/result.json");
    expect(paths).toContain("trace_big/files/stdout.log");
    expect(paths).toContain("trace_big/files/summary.md");
    expect(paths).not.toContain("trace_big/files/three_statement_model.xlsx");
    expect(paths).not.toContain("trace_big/files/.workbench/traces/job_old/host/result.json");
    const stdout = traceFiles.find((file) => file.path === "trace_big/files/stdout.log");
    expect(stdout?.kind).toBe("text");
    expect(stdout?.content.length).toBeLessThan(33_000);
    expect(stdout?.content).toContain("[truncated]");
  });

  test("qualifies improve evidence before building worker trace inputs", () => {
    const traces: WorkbenchTrace[] = [
      testTrace("trace_smoke_failed", { request: { smoke: true, caseId: "case-smoke" }, result: { status: "failed", error: "smoke failure" } }),
      testTrace("trace_passed", { request: { caseId: "case-pass" }, result: { status: "succeeded", score: 1 } }),
      testTrace("trace_low_score_passed", { request: { caseId: "case-low-score" }, result: { status: "succeeded", score: 0.4 } }),
      testTrace("trace_failed", { request: { caseId: "case-fail" }, result: { status: "failed", score: 0, error: "workflow failure" } }),
      testTrace("trace_reviewed", { request: { caseId: "case-review" }, result: { status: "succeeded", score: 1, feedback: { review: "Needs clearer citation." } } }),
      testTrace("trace_case_failed", { request: { caseId: "case-structured" }, result: { status: "succeeded", cases: [{ id: "step-1", status: "failed" }] } }),
    ];
    const qualified = workbenchImprovementEvidenceTraces(traces);
    const input = createWorkbenchSkillImproveRuntimeInput({
      ownerUserId: "user_123",
      projectId: "skill_123",
      runId: "run_123",
      jobId: "job_123",
      baseVersionId: "v001",
      evalHash: "eval_123",
      agent: {
        name: "patcher",
        adapter: "command",
        config: { improveCommand: "printf improved > SKILL.md" },
      },
      baseFiles: [{
        path: "SKILL.md",
        kind: "text",
        encoding: "utf8",
        content: "# Skill\n",
        executable: false,
      }],
      traces: qualified,
      createdAt: "2026-06-08T00:00:00.000Z",
    });
    const traceIndex = input.traceFiles?.find((file) => file.path === "index.json");

    expect(qualified.map((trace) => trace.id)).toEqual(["trace_failed", "trace_reviewed", "trace_case_failed"]);
    expect(JSON.parse(traceIndex?.content ?? "{}")).toMatchObject({
      traces: [
        expect.objectContaining({ id: "trace_failed" }),
        expect.objectContaining({ id: "trace_reviewed" }),
        expect.objectContaining({ id: "trace_case_failed" }),
      ],
    });
    expect(input.traceFiles?.some((file) => file.path.startsWith("trace_smoke_failed/"))).toBe(false);
    expect(input.traceFiles?.some((file) => file.path.startsWith("trace_passed/"))).toBe(false);
    expect(input.traceFiles?.some((file) => file.path.startsWith("trace_low_score_passed/"))).toBe(false);
  });

  test("scopes improve evidence to the selected version lineage and agent hash", () => {
    const agent = {
      name: "patcher",
      adapter: "command",
      model: "docker",
      config: { improveCommand: "printf improved > SKILL.md" },
    };
    const agentHash = hashJson(agent);
    const state: WorkbenchProjectState = {
      schema: "workbench.skill.state.v1",
      root: "/tmp/lineage-evidence",
      currentVersionId: "v003",
      refs: { current: "v003" },
      remotes: {},
      defaultSkill: "primary",
      defaultAgent: "patcher",
      versions: [
        versionFixture("v001", []),
        versionFixture("v002", ["v001"]),
        versionFixture("v003", ["v001"]),
      ],
      evals: [],
      skillSources: [],
      skillBundles: [],
      agents: [agent],
      runs: [
        runFixture("run_ancestor", "v001", agentHash),
        runFixture("run_sibling", "v002", agentHash),
        runFixture("run_wrong_agent", "v003", "different_agent_hash"),
      ],
      jobs: [
        jobFixture("job_ancestor", "run_ancestor", "v001", agentHash),
        jobFixture("job_sibling", "run_sibling", "v002", agentHash),
        jobFixture("job_wrong_agent", "run_wrong_agent", "v003", "different_agent_hash"),
      ],
      traces: [
        testTrace("trace_ancestor", { runId: "run_ancestor", jobId: "job_ancestor", versionId: "v001" }),
        testTrace("trace_sibling", { runId: "run_sibling", jobId: "job_sibling", versionId: "v002" }),
        testTrace("trace_wrong_agent", { runId: "run_wrong_agent", jobId: "job_wrong_agent", versionId: "v003" }),
        testTrace("trace_orphan", { runId: "missing_run", jobId: "missing_job", versionId: "v001" }),
      ],
      artifacts: [],
      lineage: [
        { parentId: "v001", childId: "v002", reason: "version", createdAt: "2026-06-08T00:00:00.000Z" },
        { parentId: "v001", childId: "v003", reason: "version", createdAt: "2026-06-08T00:00:00.000Z" },
      ],
    };

    expect(workbenchImprovementEvidenceTracesForVersion(state, {
      versionId: "v003",
      skillName: "primary",
      agent,
    }).map((trace) => trace.id)).toEqual(["trace_ancestor"]);
    expect(workbenchImprovementEvidenceTracesForVersion(state, {
      versionId: "v003",
      skillName: "primary",
      agent,
      traceIds: ["trace_sibling"],
    })).toEqual([]);
  });

  dockerTest("rejects queued eval execution when same-name agent hash has changed", async () => {
    const state = createQueuedEvalState();
    const evaluated = await evalWorkbenchProjectState(state, { agent: "default" });
    const run = evaluated.runs[0]!;
    const job = evaluated.state.jobs.find((entry) => entry.id === run.jobIds[0]);
    expect(job).toBeDefined();

    const changedState: WorkbenchProjectState = {
      ...evaluated.state,
      agents: [{
        name: "default",
        adapter: "local",
        model: "docker",
        config: { network: "on" },
      }],
    };

    await expect(executeQueuedWorkbenchSkillEvalJob({
      kind: "workbench.skill.eval.job.v1",
      runId: run.id,
      jobId: job!.id,
      artifactId: job!.artifactIds[0],
      traceId: job!.traceIds[0],
      versionId: run.versionId,
      evalHash: run.evalHash,
      agentName: run.agentName,
      caseId: job!.caseId,
      sample: job!.sample,
      state: changedState,
    })).rejects.toThrow(/Agent not found: default/u);
  });

  test("rejects queued eval execution when the exact eval hash is missing", async () => {
    const state = createQueuedEvalState();
    state.runs.push({
      id: "run_queued",
      kind: "eval",
      versionId: "v001",
      skillName: "primary",
      skillBundleHash: "bundle_hash",
      evalHash: "missing_eval_hash",
      agentName: "default",
      agentHash: hashJson(state.agents[0]!),
      status: "running",
      traceIds: ["trace_queued"],
      jobIds: ["job_queued"],
      createdAt: "2026-06-08T00:00:00.000Z",
    });
    state.jobs.push({
      id: "job_queued",
      runId: "run_queued",
      kind: "eval",
      versionId: "v001",
      skillName: "primary",
      skillBundleHash: "bundle_hash",
      evalHash: "missing_eval_hash",
      agentName: "default",
      agentHash: hashJson(state.agents[0]!),
      caseId: "case-001",
      sample: 0,
      status: "queued",
      artifactIds: ["artifact_queued"],
      traceIds: ["trace_queued"],
      createdAt: "2026-06-08T00:00:00.000Z",
    });

    await expect(executeQueuedWorkbenchSkillEvalJob({
      kind: "workbench.skill.eval.job.v1",
      runId: "run_queued",
      jobId: "job_queued",
      artifactId: "artifact_queued",
      traceId: "trace_queued",
      versionId: "v001",
      evalHash: "missing_eval_hash",
      agentName: "default",
      caseId: "case-001",
      sample: 0,
      state,
    })).rejects.toThrow(/Eval snapshot not found: missing_eval_hash/u);
  });

  test("normalizes runtime usage and cost for skill run materialization", () => {
    const usage = readWorkbenchSkillRunOutputUsage({
      result: {
        score: 1,
        usage: {
          engine: {
            provider: "test",
            totalTokens: 3,
            costUsd: 0.03,
            costSource: "provider",
          },
        },
      },
      usage: {
        runner: {
          provider: "test",
          totalTokens: 2,
          costUsd: 0.02,
          costSource: "provider",
        },
      },
    });

    expect(usage).toMatchObject({
      total: { costUsd: 0.05 },
      runner: { costUsd: 0.02 },
      engine: { costUsd: 0.03 },
    });
    expect(readWorkbenchSkillTraceResultsCostUsd([{ usage }])).toBe(0.05);
  });

  test("keeps sandbox capabilities valid across agent plus execution time", () => {
    const now = "2026-06-08T06:00:00.000Z";
    const execution = {
      id: "exec_sandbox_ttl",
      projectId: "skill_123",
      runId: "run_123",
      versionId: "v001",
      purpose: "improve",
      adapter: { use: "codex", with: {} },
      sandbox: { kind: "oci", ref: "docker://workbench/custom:latest" },
      inputs: [],
      outputs: [],
      policy: {
        tenantId: "tenant_123",
        resources: { cpu: 1, memoryGb: 2, diskGb: 10, timeoutMinutes: 10 },
        network: { egress: "none" },
      },
      metadata: {},
    } as Parameters<typeof createWorkbenchExecutionCapability>[0];

    const capability = createWorkbenchExecutionCapability(execution, { now });
    const allocation = createWorkbenchSandboxAllocation(execution, {
      backend: DOCKER_SANDBOX_BACKEND,
      now,
    });

    expect(Date.parse(capability.expiresAt) - Date.parse(now)).toBe(25 * 60_000);
    expect(Date.parse(allocation.expiresAt) - Date.parse(now)).toBe(25 * 60_000);
  });

  dockerTest("syncs object-pack evidence and publishes installable source without Git refs", async () => {
    const temp = await makeTempRoot("workbench-object-sync-");
    const remote = path.join(temp, "remote");
    const root = path.join(temp, "source");
    await initWorkbenchSkill({ dir: root });
    await fs.mkdir(path.join(root, "assets"), { recursive: true });
    const binaryAsset = Buffer.from([0, 255, 1, 2, 3, 0, 128]);
    await fs.writeFile(path.join(root, "assets", "template.bin"), binaryAsset);
    await fs.mkdir(path.join(root, "assets", "objects"), { recursive: true });
    await fs.writeFile(path.join(root, "assets", "objects", "schema.json"), "{\"ok\":true}\n");
    const caseRoot = path.join(root, ".workbench", "cases", "case-002");
    await fs.mkdir(path.join(caseRoot, "tests"), { recursive: true });
    await fs.writeFile(
      path.join(caseRoot, "case.yaml"),
      [
        "version: 1",
        "id: case-002",
        "prompt: Create an earnings prep note for GOOGL.",
        "command: sh \"$CASE_DIR/tests/test.sh\"",
        "rubric:",
        "  - Cites the key evidence.",
        "",
      ].join("\n"),
    );
    await fs.writeFile(path.join(caseRoot, "tests", "test.sh"), [
      "#!/bin/sh",
      "set -eu",
      "test -f \"$SKILL_DIR/SKILL.md\"",
      "mkdir -p \"$OUTPUT_DIR\"",
      "printf 'GOOGL\\n' > \"$OUTPUT_DIR/result.txt\"",
      "",
    ].join("\n"));
    await fs.chmod(path.join(caseRoot, "tests", "test.sh"), 0o755);
    await addWorkbenchAgent({
      dir: root,
      name: "codex",
      adapter: "codex",
      model: "gpt-5.4-mini",
    });
    await setDefaultWorkbenchAgent("default", { dir: root });
    const initial = (await listWorkbenchVersions({ dir: root }))[0]!;
    await evalWorkbenchSkill({ dir: root });
    await writeFailingCaseTest(root, "sync workflow failure");
    await addWorkbenchAgent({
      dir: root,
      name: "patcher",
      adapter: "command",
      config: {
        improveCommand: "printf '\\nCommand-backed sync improvement.\\n' >> \"$SKILL_DIR/SKILL.md\"",
      },
    });
    await evalWorkbenchSkill({ dir: root, agent: "patcher" });
    const improved = await improveWorkbenchSkill({ dir: root, agent: "patcher" });
    await addWorkbenchRemote("origin", remote, { dir: root });

    const synced = await syncWorkbenchRemote({ dir: root });
    expect(synced.remote).toMatchObject({ name: "origin", url: remote, type: "workbench" });
    expect(synced.pushed).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(await fs.readFile(path.join(remote, "manifest.json"), "utf8"))).toMatchObject({
      schema: "workbench.object-pack.v1",
    });
    expect(await fs.readdir(path.join(remote, "objects", "version"))).toEqual(expect.arrayContaining([
      `${initial.id}.json`,
      `${improved.version.id}.json`,
    ]));
    expect(await fs.readdir(path.join(remote, "objects", "job"))).not.toHaveLength(0);
    expect(await fs.readdir(path.join(remote, "objects", "artifact"))).not.toHaveLength(0);
    expect(await fs.readFile(path.join(remote, "indexes", "measurements.jsonl"), "utf8")).toContain("run_");

    const published = await publishWorkbenchVersion({
      dir: root,
      version: improved.version.id,
      visibility: "public",
    });
    expect(published).toMatchObject({
      visibility: "public",
      installUrl: path.join(remote, "source"),
      pinnedInstallUrl: `${remote}/releases/${improved.version.id}`,
    });
    expect(await fs.readFile(path.join(remote, "source", "SKILL.md"), "utf8")).toContain("Command-backed sync improvement.");
    expect(await fs.readFile(path.join(remote, "source", "assets", "template.bin"))).toEqual(binaryAsset);
    expect(await fs.readFile(path.join(remote, "source", "assets", "objects", "schema.json"), "utf8")).toContain("\"ok\"");
    expect(await fs.readFile(path.join(remote, "source", ".workbench", "cases", "case-002", "case.yaml"), "utf8")).toContain("GOOGL");
    await expect(fs.stat(path.join(remote, "source", ".workbench", "objects"))).rejects.toThrow(/ENOENT/u);
    expect(await fs.readFile(path.join(remote, "releases", improved.version.id, "SKILL.md"), "utf8")).toContain("Command-backed sync improvement.");
    const publishedRefs = JSON.parse(await fs.readFile(path.join(remote, "refs.json"), "utf8")) as Record<string, string>;
    expect(publishedRefs.published).toBe(improved.version.id);
    expect(publishedRefs[`releases/${improved.version.id}`]).toBe(improved.version.id);

    const portableRoot = path.join(temp, "portable");
    await initWorkbenchSkill({ dir: portableRoot });
    await addWorkbenchRemote("origin", remote, { dir: portableRoot });
    const pulled = await syncWorkbenchRemote({ dir: portableRoot });
    const refsAfterPortableSync = JSON.parse(await fs.readFile(path.join(remote, "refs.json"), "utf8")) as Record<string, string>;
    expect(refsAfterPortableSync.published).toBe(improved.version.id);
    expect(refsAfterPortableSync[`releases/${improved.version.id}`]).toBe(improved.version.id);
    const portableSnapshot = await createWorkbenchInspectionSnapshot({ dir: portableRoot });
    expect(pulled.pulled).toBeGreaterThanOrEqual(0);
    expect(portableSnapshot.versions.map((version) => version.id)).toEqual(expect.arrayContaining([initial.id, improved.version.id]));
    expect(portableSnapshot.runs.length).toBeGreaterThan(0);
    expect(portableSnapshot.jobs.length).toBeGreaterThan(0);
    expect(portableSnapshot.artifacts.length).toBeGreaterThan(0);
    expect(portableSnapshot.publication).toMatchObject({
      versionId: improved.version.id,
      installUrl: path.join(remote, "source"),
      pinnedInstallUrl: `${remote}/releases/${improved.version.id}`,
    });

    await switchWorkbenchVersion(improved.version.id, { dir: portableRoot });
    expect(await fs.readFile(path.join(portableRoot, "SKILL.md"), "utf8")).toContain("Command-backed sync improvement.");

    const portableSkillPath = path.join(portableRoot, "SKILL.md");
    const portableSkill = await fs.readFile(portableSkillPath, "utf8");
    await fs.writeFile(portableSkillPath, `${portableSkill}\nLocal manual edit.\n`);
    const manualStatus = await workbenchStatus({ dir: portableRoot });
    expect(manualStatus.currentVersionId).not.toBe(improved.version.id);
    expect(await fs.readFile(portableSkillPath, "utf8")).toContain("Local manual edit.");
    await switchWorkbenchVersion(improved.version.id, { dir: portableRoot });
    expect(await fs.readFile(portableSkillPath, "utf8")).not.toContain("Local manual edit.");
  }, 60_000);

  test("does not show publication metadata without a matching release ref", async () => {
    const temp = await makeTempRoot("workbench-publication-ref-");
    const remote = path.join(temp, "remote");
    const root = path.join(temp, "source");
    await initWorkbenchSkill({ dir: root });
    await addWorkbenchRemote("origin", remote, { dir: root });
    await syncWorkbenchRemote({ dir: root });

    await fs.writeFile(path.join(remote, "refs.json"), JSON.stringify({
      current: "v001",
      published: "v001",
    }, null, 2));
    await syncWorkbenchRemote({ dir: root });

    const snapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    expect(snapshot.refs.published).toBe("v001");
    expect(snapshot.refs["releases/v001"]).toBeUndefined();
    expect(snapshot.publication).toBeUndefined();
  });

  test("syncs and publishes through an HTTP Workbench remote", async () => {
    const root = await makeTempRoot("workbench-http-remote-");
    await initWorkbenchSkill({ dir: root });
    await addWorkbenchRemote("origin", "https://cloud.test/skills/alice/http-skill", { dir: root });
    let storedState: WorkbenchProjectState | null = null;
    let visibility = "private";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = init?.method ?? "GET";
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return Response.json({
          skills: storedState
            ? [{ id: "skill_http", ownerUsername: "alice", name: "http-skill" }]
            : [],
        });
      }
      if (url.pathname === "/api/workbench/skills" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { state: WorkbenchProjectState };
        storedState = body.state;
        return Response.json({
          skill: { id: "skill_http", ownerUsername: "alice", name: "http-skill" },
        }, { status: 201 });
      }
      if (url.pathname === "/api/workbench/skills/skill_http/state" && method === "GET") {
        if (!storedState) {
          return Response.json({ message: "not found" }, { status: 404 });
        }
        return Response.json({ state: storedState, objectPack: exportObjectPack(storedState) });
      }
      if (url.pathname === "/api/workbench/skills/skill_http/state" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack: ReturnType<typeof exportObjectPack>; publishVersionId?: string; visibility?: "private" | "public" };
        const nextState = storedState ?? {
          schema: "workbench.skill.state.v1" as const,
          root: "/cloud/http-skill",
          refs: {},
          remotes: {},
          versions: [],
          skillSources: [],
          skillBundles: [],
          evals: [],
          agents: [],
          runs: [],
          jobs: [],
          traces: [],
          artifacts: [],
          lineage: [],
        };
        for (const version of body.objectPack.versions) {
          nextState.versions = nextState.versions.filter((entry) => entry.id !== version.id).concat(version);
        }
        nextState.refs = { ...nextState.refs, ...body.objectPack.refs };
        if (body.publishVersionId) {
          nextState.refs.published = body.publishVersionId;
          nextState.refs[`releases/${body.publishVersionId}`] = body.publishVersionId;
          visibility = body.visibility ?? visibility;
        }
        nextState.currentVersionId = nextState.refs.current;
        storedState = nextState;
        return Response.json({ skill: { id: "skill_http", visibility } });
      }
      throw new Error(`Unexpected fetch ${method} ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const synced = await syncWorkbenchRemote({ dir: root, authToken: "test-token" });
    expect(synced.pushed).toBeGreaterThan(0);
    expect(storedState?.versions.map((version) => version.id)).toEqual(["v001", "v002"]);

    const published = await publishWorkbenchVersion({
      dir: root,
      visibility: "private",
      authToken: "test-token",
    });
    expect(published.version.id).toBe("v002");
    expect(published.visibility).toBe("private");
    expect(published.installUrl).toBe("https://cloud.test/api/workbench/skills/skill_http/source");
    expect(published.pinnedInstallUrl).toBe("https://cloud.test/api/workbench/skills/skill_http/releases/v002/source");
    expect(visibility).toBe("private");
    expect(storedState?.refs.published).toBe("v002");
    expect(storedState?.refs["releases/v002"]).toBe("v002");
    expect(storedState?.refs["publication/install-url"]).toBe("https://cloud.test/api/workbench/skills/skill_http/source");
    const privateSnapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    expect(privateSnapshot.publication).toMatchObject({
      versionId: "v002",
      installUrl: "https://cloud.test/api/workbench/skills/skill_http/source",
      pinnedInstallUrl: "https://cloud.test/api/workbench/skills/skill_http/releases/v002/source",
    });

    const publicPublished = await publishWorkbenchVersion({
      dir: root,
      visibility: "public",
      authToken: "test-token",
    });
    expect(publicPublished.installUrl).toBe("https://cloud.test/api/workbench/public/skills/alice/http-skill/source");
    expect(publicPublished.pinnedInstallUrl).toBe("https://cloud.test/api/workbench/public/skills/alice/http-skill/releases/v002/source");
    const publicSnapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    expect(publicSnapshot.publication).toMatchObject({
      versionId: "v002",
      installUrl: "https://cloud.test/api/workbench/public/skills/alice/http-skill/source",
      pinnedInstallUrl: "https://cloud.test/api/workbench/public/skills/alice/http-skill/releases/v002/source",
    });
  });

  dockerTest("detects divergent remote objects and records pending sync failures", async () => {
    const root = await makeTempRoot("workbench-sync-conflict-");
    const remote = await makeTempRoot("workbench-sync-conflict-remote-");
    await initWorkbenchSkill({ dir: root });
    await evalWorkbenchSkill({ dir: root });
    await addWorkbenchRemote("origin", `file://${remote}`, { dir: root });
    await syncWorkbenchRemote({ dir: root });

    const versionPath = path.join(remote, "objects", "version", "v001.json");
    const remoteVersion = JSON.parse(await fs.readFile(versionPath, "utf8")) as { hash: string; files: Array<{ path: string; content: string }> };
    await fs.writeFile(versionPath, `${JSON.stringify({
      ...remoteVersion,
      hash: "divergent_hash",
      files: remoteVersion.files.map((file) =>
        file.path === "SKILL.md" ? { ...file, content: `${file.content}\nDivergent remote edit.\n` } : file
      ),
    }, null, 2)}\n`);

    await expect(syncWorkbenchRemote({ dir: root })).rejects.toThrow(/object conflict/u);
    const status = await workbenchStatus({ dir: root });
    expect(status.pendingSyncCount).toBe(1);
  });

  dockerTest("runs command-backed improve through a bounded skill patch", async () => {
    const root = await makeTempRoot("workbench-command-improve-");
    await initWorkbenchSkill({ dir: root });
    await addWorkbenchAgent({
      dir: root,
      name: "patcher",
      adapter: "command",
      config: {
        improveCommand: "printf '\\nCommand-backed improvement from trace evidence.\\n' >> \"$SKILL_DIR/SKILL.md\"",
        network: "on",
      },
    });
    await setDefaultWorkbenchAgent("patcher", { dir: root });
    await writeFailingCaseTest(root, "command improve failure");
    const [failingRun] = await evalWorkbenchSkill({ dir: root, agent: "patcher" });

    const improved = await improveWorkbenchSkill({ dir: root, agent: "patcher" });
    const skill = await fs.readFile(path.join(root, "SKILL.md"), "utf8");
    const improvedSkill = improved.version.files.find((file) => file.path === "SKILL.md")?.content ?? "";
    const diff = await diffWorkbenchVersions(`${failingRun!.versionId}..${improved.version.id}`, { dir: root });
    const snapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    const improveTrace = snapshot.traces.find((trace) => trace.runId === improved.run.id);

    expect(improved.version.parentIds).toEqual([failingRun!.versionId]);
    expect(improved.switched).toBe(false);
    expect(improved.promoted).toBe(false);
    expect(skill).not.toContain("Command-backed improvement from trace evidence.");
    expect(improvedSkill).toContain("Command-backed improvement from trace evidence.");
    expect(skill).not.toContain("Workbench Improvement Notes");
    expect(diff).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "SKILL.md", status: "modified" }),
    ]));
    expect(improveTrace?.request).toMatchObject({
      improvementMode: "command",
      improvementFileChanges: ["SKILL.md"],
    });
    expect(improveTrace?.result).toMatchObject({
      improvementMode: "command",
      outputVersionId: improved.version.id,
    });
  }, 60_000);

  test("runs runtime-control operation sequences in the current runtime", async () => {
    const createdAt = new Date().toISOString();
    const skillCommand = nodeCommand([
      "const fs = require('node:fs');",
      "fs.writeFileSync(`${process.env.WORKBENCH_OUTPUT}/skill.txt`, 'skill output\\n');",
      "fs.writeFileSync(process.env.WORKBENCH_RESULT, JSON.stringify({",
      "  protocol: 'workbench.adapter-result.v1',",
      "  operation: 'skill.run',",
      "  ok: true,",
      "  usage: { total: { provider: 'test', totalTokens: 2, costUsd: 0.02, costSource: 'provider' } }",
      "}, null, 2) + '\\n');",
    ]);
    const engineCommand = nodeCommand([
      "const fs = require('node:fs');",
      "const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, 'utf8'));",
      "if (request.paths.skill.endsWith('/input/skills/primary') === false) throw new Error('skill path not staged');",
      "fs.writeFileSync(`${process.env.WORKBENCH_OUTPUT}/score.txt`, 'score output\\n');",
      "fs.writeFileSync(process.env.WORKBENCH_RESULT, JSON.stringify({",
      "  protocol: 'workbench.adapter-result.v1',",
      "  operation: 'engine.run',",
      "  ok: true,",
      "  value: { score: 1, metrics: { score: 1 }, summary: 'runtime control scored' },",
      "  summary: 'runtime control scored',",
      "  usage: { total: { provider: 'test', totalTokens: 3, costUsd: 0.03, costSource: 'provider' } }",
      "}, null, 2) + '\\n');",
    ]);
    const execution = {
      id: "exec_runtime_control",
      projectId: "local",
      runId: "run_runtime_control",
      versionId: "v001",
      purpose: "attempt" as const,
      adapter: { use: "workbench", with: {} },
      sandbox: { kind: "oci" as const, ref: "docker://workbench/workbench-node-22:envv_node_22" },
      inputs: [],
      outputs: [{ name: "result", schema: "workbench.result.v1" as const, required: true }],
      policy: {
        tenantId: "local",
        resources: { cpu: 1, memoryGb: 1, diskGb: 1, timeoutMinutes: 1 },
        network: { egress: "none" as const },
      },
      metadata: { caseId: "case-001" },
    };
    const completed = await executeRuntimeControlOperationSequenceInCurrentRuntime({
      job: {
        id: "job_runtime_control",
        projectId: "local",
        runId: "run_runtime_control",
        kind: "execute",
        status: "queued",
        attempt: 0,
        createdAt,
        updatedAt: createdAt,
        input: {
          execution,
          versionId: "v001",
          attemptIndex: 0,
          sampleIndex: 0,
          caseId: "case-001",
        },
      },
      spec: {
        version: 4,
        name: "Runtime control eval",
        description: "Runtime control eval.",
        eval: {
          name: "Runtime control eval",
          description: "Runtime control eval.",
          engine: { use: "workbench", with: {} },
        },
        skill: {
          name: "skill",
          files: { path: "." },
          defaultAgent: "default",
          selectedAgentId: "default",
          selectedAgentName: "default",
          agents: {
            default: { name: "default", use: "command", with: {} },
          },
        },
        environment: {
          dockerfile: "docker://workbench/workbench-node-22:envv_node_22",
          resources: { cpu: 1, memoryGb: 1, diskGb: 1, timeoutMinutes: 1 },
          network: { egress: "none" },
        },
        adapters: ["command", "workbench"],
        engine: { use: "workbench", with: {} },
        engineResolve: { use: "workbench", with: {} },
        run: { use: "command", with: {} },
        engineRun: { use: "workbench", with: {} },
      },
      baseFiles: [textFixture("primary/SKILL.md", "# Runtime Control Skill\n")],
      engineResolveFiles: [textFixture("prompt.md", "Public case.\n")],
      engineCases: [{
        id: "case-001",
        case: { version: 3, prompt: "Run skill and score." },
        files: {
          public: [textFixture("prompt.md", "Public case.\n")],
          private: [textFixture("secret.txt", "hidden\n")],
          source: [textFixture("prompt.md", "Public case.\n")],
        },
      }],
      runtimeControlOperation: {
        prepare: true,
        operations: [
          { label: "runner", operation: "skill.run", invocation: { use: "command", command: skillCommand } },
          { label: "score", operation: "engine.run", invocation: { use: "command", command: engineCommand } },
        ],
      },
    }, execution, createdAt);
    const output = completed.output as {
      ok?: boolean;
      files?: Array<{ path: string; content: string }>;
      operationResults?: Array<{ operation: string }>;
      result?: { score?: number };
      usage?: { runner?: { costUsd?: number }; engine?: { costUsd?: number } };
    };

    expect(completed.status).toBe("succeeded");
    expect(output.ok).toBe(true);
    expect(output.result?.score).toBe(1);
    expect(output.operationResults?.map((result) => result.operation)).toEqual(["skill.run", "engine.run"]);
    expect(output.usage?.runner?.costUsd).toBe(0.02);
    expect(output.usage?.engine?.costUsd).toBe(0.03);
    expect(output.files?.map((file) => file.path)).toEqual(expect.arrayContaining([
      "skill.txt",
      "score.txt",
      ".workbench/traces/job_runtime_control/runner/request.json",
      ".workbench/traces/job_runtime_control/runner/result.json",
      ".workbench/traces/job_runtime_control/score/request.json",
      ".workbench/traces/job_runtime_control/score/result.json",
    ]));
  });

  test("serves runtime-control callbacks for host adapter execution", async () => {
    const createdAt = new Date().toISOString();
    const childRequests: WorkbenchExecutionRuntimeInput[] = [];
    const hostCommand = nodeCommand([
      "const fs = require('node:fs');",
      "const http = require('node:http');",
      "function postRuntimeControl(request) {",
      "  const body = JSON.stringify(request);",
      "  const endpoint = new URL('/v1/operation-sequence', process.env.WORKBENCH_RUNTIME_CONTROL_URL);",
      "  return new Promise((resolve, reject) => {",
      "    const outgoing = http.request(endpoint, {",
      "      method: 'POST',",
      "      headers: { authorization: `Bearer ${process.env.WORKBENCH_RUNTIME_CONTROL_TOKEN}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }",
      "    }, (incoming) => {",
      "      const chunks = [];",
      "      incoming.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));",
      "      incoming.on('end', () => {",
      "        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');",
      "        if (incoming.statusCode < 200 || incoming.statusCode >= 300) reject(new Error(payload && payload.error || `runtime-control ${incoming.statusCode}`));",
      "        else resolve(payload);",
      "      });",
      "    });",
      "    outgoing.on('error', reject);",
      "    outgoing.end(body);",
      "  });",
      "}",
      "(async () => {",
      "  const child = await postRuntimeControl({",
      "    operations: [{ label: 'skill', operation: 'skill.run', invocation: { use: 'command', with: {} } }]",
      "  });",
      "  fs.writeFileSync(process.env.WORKBENCH_RESULT, JSON.stringify({",
      "    protocol: 'workbench.adapter-result.v1',",
      "    operation: 'engine.run',",
      "    ok: child.ok,",
      "    value: child.result || { score: 0 },",
      "    feedback: { childOperationResults: child.operationResults.length },",
      "    usage: child.usage",
      "  }, null, 2) + '\\n');",
      "})().catch((error) => { console.error(error && error.stack || String(error)); process.exit(1); });",
    ]);
    const execution = {
      id: "exec_host_runtime_control",
      projectId: "local",
      runId: "run_host_runtime_control",
      versionId: "v001",
      purpose: "attempt" as const,
      adapter: { use: "host-engine", with: {} },
      sandbox: { kind: "oci" as const, ref: "docker://workbench/workbench-node-22:envv_node_22" },
      inputs: [
        { name: "skills", ref: "workbench://skills/local/versions/v001", mountPath: "/workspace/input/skills", writable: false },
        { name: "case", ref: "workbench://skills/local/cases/case-001", mountPath: "/workspace/input/case", writable: false },
      ],
      outputs: [{ name: "result", schema: "workbench.result.v1" as const, required: true }],
      policy: {
        tenantId: "local",
        resources: { cpu: 1, memoryGb: 1, diskGb: 1, timeoutMinutes: 1 },
        network: { egress: "none" as const },
      },
      metadata: { caseId: "case-001" },
    };
    const completed = await executeWorkbenchExecutionJob({
      job: {
        id: "job_host_runtime_control",
        projectId: "local",
        runId: "run_host_runtime_control",
        kind: "execute",
        status: "queued",
        attempt: 0,
        createdAt,
        updatedAt: createdAt,
        input: {
          execution,
          versionId: "v001",
          attemptIndex: 0,
          sampleIndex: 0,
          caseId: "case-001",
        },
      },
      spec: runtimeControlSpec(),
      baseFiles: [textFixture("primary/SKILL.md", "# Host Runtime Control Skill\n")],
      engineResolveFiles: [textFixture("prompt.md", "Public case.\n")],
      engineCases: [runtimeControlCase()],
      adapterManifests: [{
        id: "host-engine",
        protocol: "workbench.adapter-manifest.v1",
        install: [],
        operations: {
          "engine.run": { command: hostCommand, executor: "host" },
        },
      }],
    }, {
      sandboxBackend: "fake",
      createSandboxPlaneForBackend: (_backend, runtimeArgs) =>
        fakeRuntimeControlPlane(runtimeArgs, childRequests),
    });
    const output = completed.output as {
      ok?: boolean;
      operationResults?: Array<{ operation: string }>;
      result?: { score?: number };
      usage?: { runner?: { costUsd?: number } };
    };

    expect(completed.status).toBe("succeeded");
    expect(output.ok).toBe(true);
    expect(output.result?.score).toBe(0.9);
    expect(output.operationResults?.map((result) => result.operation)).toEqual(["engine.run"]);
    expect(output.usage?.runner?.costUsd).toBe(0.07);
    expect(childRequests).toHaveLength(1);
    expect(childRequests[0]?.runtimeControlOperation?.operations).toEqual([
      expect.objectContaining({ operation: "skill.run" }),
    ]);
    expect(childRequests[0]?.job.id).toMatch(/^job_host_runtime_control:runtime:/u);
    expect((childRequests[0]?.job.input as { execution?: { metadata?: Record<string, unknown> } }).execution?.metadata).toMatchObject({
      runtimeControl: true,
      caseId: "case-001",
    });
  });

  test("fails sandbox completions that omit the completed job payload", async () => {
    const createdAt = new Date().toISOString();
    const execution = {
      id: "exec_missing_completed_job",
      projectId: "local",
      runId: "run_missing_completed_job",
      versionId: "v001",
      purpose: "attempt" as const,
      adapter: { use: "command", with: {} },
      sandbox: { kind: "oci" as const, ref: "docker://workbench/workbench-node-22:envv_node_22" },
      inputs: [
        { name: "skills", ref: "workbench://skills/local/versions/v001", mountPath: "/workspace/input/skills", writable: false },
        { name: "case", ref: "workbench://skills/local/cases/case-001", mountPath: "/workspace/input/case", writable: false },
      ],
      outputs: [{ name: "result", schema: "workbench.result.v1" as const, required: true }],
      policy: {
        tenantId: "local",
        resources: { cpu: 1, memoryGb: 1, diskGb: 1, timeoutMinutes: 1 },
        network: { egress: "none" as const },
      },
      metadata: { caseId: "case-001" },
    };
    const completed = await executeWorkbenchExecutionJob({
      job: {
        id: "job_missing_completed_job",
        projectId: "local",
        runId: "run_missing_completed_job",
        kind: "execute",
        status: "queued",
        attempt: 0,
        createdAt,
        updatedAt: createdAt,
        input: {
          execution,
          versionId: "v001",
          attemptIndex: 0,
          sampleIndex: 0,
          caseId: "case-001",
        },
      },
      spec: runtimeControlSpec(),
      baseFiles: [textFixture("primary/SKILL.md", "# Missing Completed Job Skill\n")],
      engineResolveFiles: [textFixture("prompt.md", "Public case.\n")],
      engineCases: [runtimeControlCase()],
      adapterManifests: [],
    }, {
      sandboxBackend: "fake",
      createSandboxPlaneForBackend: () => successfulPlaneWithoutCompletedJob(),
    });

    expect(completed.status).toBe("failed");
    expect(completed.error).toContain("succeeded without returning a completed job");
    expect((completed.output as { ok?: boolean }).ok).toBe(false);
  });

  dockerTest("runs built-in command runtime-control improve in the Docker sandbox", async () => {
    const createdAt = new Date().toISOString();
    const improveCommand = "printf '# Runtime Control Skill\\n\\nImproved in Docker.\\n' > SKILL.md";
    const execution = {
      id: "exec_runtime_control_improve",
      projectId: "local",
      runId: "run_runtime_control_improve",
      versionId: "v001",
      purpose: "improve" as const,
      adapter: { use: "command", with: { command: improveCommand } },
      sandbox: { kind: "oci" as const, ref: "docker://workbench/workbench-node-22:envv_node_22" },
      inputs: [
        { name: "skill", ref: "workbench://skills/local/versions/v001", mountPath: "/workspace", writable: true },
        { name: "traces", ref: "workbench://skills/local/runs/run_runtime_control_improve/traces", mountPath: "/workspace/input/traces", writable: false },
      ],
      outputs: [{ name: "skill_patch", schema: "workbench.skill_patch.v1" as const, required: true }],
      policy: {
        tenantId: "local",
        resources: { cpu: 1, memoryGb: 1, diskGb: 1, timeoutMinutes: 1 },
        network: { egress: "none" as const },
      },
      metadata: { caseId: "current", edits: ["SKILL.md"] },
    };
    const baseSpec = runtimeControlSpec();
    const completed = await executeWorkbenchExecutionJob({
      job: {
        id: "job_runtime_control_improve",
        projectId: "local",
        runId: "run_runtime_control_improve",
        kind: "execute",
        status: "queued",
        attempt: 0,
        createdAt,
        updatedAt: createdAt,
        input: {
          execution,
          versionId: "v001",
          attemptIndex: 0,
          sampleIndex: 0,
          caseId: "current",
        },
      },
      spec: {
        ...baseSpec,
        skill: {
          ...baseSpec.skill,
          improve: { edits: ["SKILL.md"] },
        },
        improve: { use: "command", with: { command: improveCommand } },
      },
      baseFiles: [textFixture("SKILL.md", "# Runtime Control Skill\n")],
      engineResolveFiles: [],
      engineCases: [runtimeControlCase()],
      adapterManifests: [{
        id: "command",
        protocol: "workbench.adapter-manifest.v1",
        install: [],
        operations: {
          "skill.run": { command: "workbench-adapter-command" },
          "skill.improve": { command: "workbench-adapter-command" },
        },
      }],
      runtimeControlOperation: {
        prepare: true,
        operations: [
          { label: "improve", operation: "skill.improve", invocation: { use: "command", with: { command: improveCommand } } },
        ],
      },
    }, { sandboxBackend: "docker" });
    const output = completed.output as {
      skillPatch?: { fileChanges?: string[] };
      operationResults?: Array<{ operation: string }>;
    };

    if (completed.status !== "succeeded") {
      throw new Error(JSON.stringify(completed, null, 2));
    }
    expect(output.operationResults?.map((result) => result.operation)).toEqual(["skill.improve"]);
    expect(output.skillPatch?.fileChanges).toEqual(["SKILL.md"]);
  }, 60_000);

  test("plans provider-backed agent execution through the Workbench engine", () => {
    const createdAt = new Date().toISOString();
    const input = createWorkbenchSkillEvalRuntimeInput({
      ownerUserId: "local",
      projectId: "local",
      runId: "run_provider",
      jobId: "job_provider",
      versionId: "v001",
      evalHash: "eval_hash",
      evalSnapshot: {
        hash: "eval_hash",
        caseCount: 1,
        files: [
          textFixture("eval.yaml", "version: 1\nname: provider\ndescription: Provider eval.\n"),
        ],
      },
      agent: {
        name: "codex",
        adapter: "codex",
        model: "gpt-5.4-mini",
        config: {
          instructions: "Run the skill against the case.",
          network: true,
        },
      },
      skillName: "primary",
      skillBundleHash: "skill_bundle_hash",
      versionFiles: [textFixture("primary/SKILL.md", "# Provider Skill\n")],
      runtimeCase: {
        id: "case-001",
        path: "case-001",
        content: [
          "version: 1",
          "id: case-001",
          "prompt: Produce a concise result.",
          "",
        ].join("\n"),
        files: [
          textFixture("case.yaml", "version: 1\nid: case-001\nprompt: Produce a concise result.\n"),
          textFixture("tests/test.sh", "test -f \"$SKILL_DIR/SKILL.md\"\n"),
          textFixture("fixture.txt", "public fixture\n"),
        ],
      },
      sample: 0,
      createdAt,
      environmentDockerfile: "FROM node:22-bookworm-slim\nRUN npm install --global vitest@3.2.4\n",
    });
    const execution = (input.job.input as { execution?: {
      adapter?: { use?: string; with?: Record<string, unknown> };
      metadata?: Record<string, unknown>;
    } }).execution;

    expect(input.spec.run).toMatchObject({
      use: "codex",
      with: {
        model: "gpt-5.4-mini",
        instructions: "Run the skill against the case.",
      },
    });
    expect(input.spec.run.with).not.toHaveProperty("network");
    expect(input.spec.engineRun).toMatchObject({
      use: "workbench",
      with: {
        score: { use: "tests" },
        grading: { isolation: "separate" },
      },
    });
    expect(input.adapterManifests?.map((manifest) => manifest.id).sort()).toEqual(["codex", "tests", "workbench"]);
    expect(input.environmentDockerfile).toContain("npm install --global @openai/codex@0.125.0");
    expect(input.environmentVersion?.sourceHash).toBeDefined();
    expect(input.engineResolveFiles.map((file) => file.path)).toEqual(["fixture.txt"]);
    expect(input.engineCases[0]?.files.private?.map((file) => file.path)).toEqual(["test.sh"]);
    expect(execution?.adapter?.use).toBe("workbench");
    expect(execution?.metadata).toMatchObject({
      skillEval: true,
      agentName: "codex",
      agentAdapter: "codex",
      executionAdapter: "codex",
    });
  });

  test("plans provider-backed rubric scoring from the skill eval spec", () => {
    const input = createWorkbenchSkillEvalRuntimeInput({
      ownerUserId: "local",
      projectId: "local",
      runId: "run_rubric",
      jobId: "job_rubric",
      versionId: "v001",
      evalHash: "eval_hash",
      evalSnapshot: {
        hash: "eval_hash",
        caseCount: 1,
        files: [
          textFixture("eval.yaml", [
            "version: 1",
            "name: provider",
            "description: Provider eval.",
            "score:",
            "  adapter: rubric",
            "",
          ].join("\n")),
        ],
      },
      agent: {
        name: "claude",
        adapter: "claude",
        model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        config: {
          effort: "medium",
        },
      },
      skillName: "primary",
      skillBundleHash: "skill_bundle_hash",
      versionFiles: [textFixture("primary/SKILL.md", "# Provider Skill\n")],
      runtimeCase: {
        id: "case-001",
        path: "case-001",
        content: [
          "version: 1",
          "id: case-001",
          "prompt: Produce a concise result.",
          "rubric:",
          "  - Uses the case evidence.",
          "  - Writes a reviewable output.",
          "",
        ].join("\n"),
        files: [
          textFixture("case.yaml", [
            "version: 1",
            "id: case-001",
            "prompt: Produce a concise result.",
            "rubric:",
            "  - Uses the case evidence.",
            "  - Writes a reviewable output.",
            "",
          ].join("\n")),
          textFixture("fixture.txt", "public fixture\n"),
        ],
      },
      sample: 0,
      createdAt: new Date().toISOString(),
    });

    expect(input.spec.engineRun).toMatchObject({
      use: "workbench",
      with: {
        score: {
          use: "rubric",
          with: {
            judge: {
              use: "claude",
              with: {
                model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
                effort: "medium",
              },
            },
            criteria: [
              { id: "criterion-001", description: "Uses the case evidence." },
              { id: "criterion-002", description: "Writes a reviewable output." },
            ],
          },
        },
        grading: { isolation: "separate" },
      },
    });
    expect(input.adapterManifests?.map((manifest) => manifest.id).sort()).toEqual(["claude", "rubric", "workbench"]);
    expect(input.engineCases[0]?.files.private?.map((file) => file.path)).toEqual([]);
  });

  dockerTest("fails provider-backed skill evals through adapter auth when disconnected", async () => {
    const root = await makeTempRoot("workbench-skill-adapter-");
    await initWorkbenchSkill({ dir: root });
    await addWorkbenchAgent({
      dir: root,
      name: "codex",
      adapter: "codex",
      model: "gpt-5.4-mini",
      config: { auth: `missing-${Date.now()}` },
    });
    await setDefaultWorkbenchAgent("codex", { dir: root });
    const runs = await evalWorkbenchSkill({ dir: root });
    const snapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    const trace = snapshot.traces.find((entry) => entry.runId === runs[0]?.id);

    expect(runs[0]).toMatchObject({ agentName: "codex", status: "failed" });
    expect(trace?.request).toMatchObject({
      agent: expect.objectContaining({ adapter: "codex" }),
      skillName: "primary",
    });
    expect(trace?.result).toMatchObject({
      status: "failed",
      error: expect.stringContaining("ADAPTER_AUTH_REQUIRED: codex disconnected"),
    });
  }, 30_000);
});

function runtimeControlSpec() {
  return {
    version: 4,
    name: "Runtime control eval",
    description: "Runtime control eval.",
    eval: {
      name: "Runtime control eval",
      description: "Runtime control eval.",
      engine: { use: "workbench", with: {} },
    },
    skill: {
      name: "skill",
      files: { path: "." },
      defaultAgent: "default",
      selectedAgentId: "default",
      selectedAgentName: "default",
      agents: {
        default: { name: "default", use: "command", with: {} },
      },
    },
    environment: {
      dockerfile: "docker://workbench/workbench-node-22:envv_node_22",
      resources: { cpu: 1, memoryGb: 1, diskGb: 1, timeoutMinutes: 1 },
      network: { egress: "none" },
    },
    adapters: ["command", "workbench"],
    engine: { use: "workbench", with: {} },
    engineResolve: { use: "workbench", with: {} },
    run: { use: "command", with: {} },
    engineRun: { use: "workbench", with: {} },
  };
}

function runtimeControlCase() {
  return {
    id: "case-001",
    case: { version: 3, prompt: "Run skill and score." },
    files: {
      public: [textFixture("prompt.md", "Public case.\n")],
      private: [textFixture("secret.txt", "hidden\n")],
      source: [textFixture("prompt.md", "Public case.\n")],
    },
  };
}

function fakeRuntimeControlPlane(
  runtimeArgs: WorkbenchExecutionRuntimeInput,
  childRequests: WorkbenchExecutionRuntimeInput[],
): SandboxPlane {
  childRequests.push(runtimeArgs);
  const startedAt = new Date().toISOString();
  return {
    backend: {
      name: "fake",
      capabilities: {
        snapshots: true,
        interactiveExec: false,
        filesystemDiff: false,
        networkPolicy: ["none"],
        fileCapabilities: true,
      },
    },
    async createSandbox(request) {
      return {
        sandboxId: request.allocation.sandboxId,
        lifecycleId: request.allocation.lifecycleId,
        backend: request.allocation.backend,
        executionId: request.execution.id,
        template: request.execution.sandbox,
      };
    },
    async exec(request) {
      const finishedAt = new Date().toISOString();
      return {
        executionId: request.execution.id,
        status: "succeeded",
        startedAt,
        finishedAt,
        outputs: {},
        metadata: {
          completedJob: {
            ...runtimeArgs.job,
            status: "succeeded",
            attempt: 1,
            startedAt,
            finishedAt,
            updatedAt: finishedAt,
            output: {
              ok: true,
              files: [textFixture("child.txt", "child output\n")],
              fileChanges: ["child.txt"],
              operationResults: [{
                protocol: "workbench.adapter-result.v1",
                operation: "skill.run",
                ok: true,
                usage: {
                  total: {
                    provider: "test",
                    totalTokens: 7,
                    costUsd: 0.07,
                    costSource: "provider",
                  },
                },
              }],
              result: {
                score: 0.9,
                metrics: { score: 0.9 },
                summary: "fake child scored",
              },
              usage: {
                runner: {
                  provider: "test",
                  totalTokens: 7,
                  costUsd: 0.07,
                  costSource: "provider",
                },
              },
            },
          } as unknown as Json,
        },
      };
    },
    async destroySandbox() {
      return undefined;
    },
  };
}

function successfulPlaneWithoutCompletedJob(): SandboxPlane {
  const startedAt = new Date().toISOString();
  return {
    backend: {
      name: "fake",
      capabilities: {
        snapshots: true,
        interactiveExec: false,
        filesystemDiff: false,
        networkPolicy: ["none"],
        fileCapabilities: true,
      },
    },
    async createSandbox(request) {
      return {
        sandboxId: request.allocation.sandboxId,
        lifecycleId: request.allocation.lifecycleId,
        backend: request.allocation.backend,
        executionId: request.execution.id,
        template: request.execution.sandbox,
      };
    },
    async exec(request, options) {
      const resultRef = await options.fileStore.publishJson(
        request.capability,
        "result",
        {
          score: 1,
          metrics: { score: 1 },
          summary: "Sandbox output exists without a completed job.",
        },
      );
      return {
        executionId: request.execution.id,
        status: "succeeded",
        startedAt,
        finishedAt: new Date().toISOString(),
        outputs: {
          result: resultRef,
        },
        metadata: {},
      };
    },
    async destroySandbox() {
      return undefined;
    },
  };
}

function testTrace(
  id: string,
  overrides: Partial<WorkbenchTrace> = {},
): WorkbenchTrace {
  return {
    id,
    runId: "run_old",
    jobId: `job_${id}`,
    versionId: "v001",
    skillName: "primary",
    skillBundleHash: "bundle_hash",
    agentName: "patcher",
    createdAt: "2026-06-08T00:00:00.000Z",
    request: { caseId: "case-001" },
    result: { status: "failed", error: "failed" },
    files: [],
    ...overrides,
  };
}

function versionFixture(id: string, parentIds: string[]): WorkbenchProjectState["versions"][number] {
  return {
    id,
    hash: `hash_${id}`,
    message: id,
    parentIds,
    createdAt: `2026-06-08T00:00:0${parentIds.length}.000Z`,
    files: [textFixture("SKILL.md", `# ${id}\n`)],
  };
}

function runFixture(id: string, versionId: string, agentHash: string): WorkbenchProjectState["runs"][number] {
  return {
    id,
    kind: "eval",
    versionId,
    skillName: "primary",
    skillBundleHash: `bundle_${versionId}`,
    evalHash: "eval_hash",
    agentName: "patcher",
    agentHash,
    status: "failed",
    score: 0,
    traceIds: [`trace_${id}`],
    jobIds: [`job_${id}`],
    createdAt: "2026-06-08T00:00:00.000Z",
    finishedAt: "2026-06-08T00:00:01.000Z",
  };
}

function jobFixture(
  id: string,
  runId: string,
  versionId: string,
  agentHash: string,
): WorkbenchProjectState["jobs"][number] {
  return {
    id,
    runId,
    kind: "eval",
    versionId,
    skillName: "primary",
    skillBundleHash: `bundle_${versionId}`,
    evalHash: "eval_hash",
    agentName: "patcher",
    agentHash,
    caseId: "case-001",
    sample: 0,
    status: "failed",
    score: 0,
    artifactIds: [],
    traceIds: [`trace_${id}`],
    createdAt: "2026-06-08T00:00:00.000Z",
    finishedAt: "2026-06-08T00:00:01.000Z",
  };
}

function createQueuedEvalState(): WorkbenchProjectState {
  const agentSource = "default: default\nagents:\n  default:\n    adapter: local\n    model: docker\n    with: {}\n";
  const evalFiles = [
    textFixture("eval.yaml", "version: 1\nname: queued-eval\nscore:\n  adapter: tests\n"),
    textFixture("cases/case-001/case.yaml", "version: 1\nid: case-001\ncommand: sh \"$CASE_DIR/tests/test.sh\"\n"),
    {
      ...textFixture("cases/case-001/tests/test.sh", "#!/bin/sh\nset -eu\nmkdir -p \"$OUTPUT_DIR\"\nprintf '{\"ok\":true,\"score\":1,\"metrics\":{\"score\":1}}\\n' > \"$OUTPUT_DIR/result.json\"\n"),
      executable: true,
    },
  ];
  const versionFiles = [
    textFixture("SKILL.md", "# Skill\n"),
    textFixture(".workbench/agents.yaml", agentSource),
    ...evalFiles.map((file) => ({
      ...file,
      path: `.workbench/${file.path}`,
    })),
  ];
  const bundleFiles = [textFixture("SKILL.md", "# Skill\n")];
  const source = {
    name: "primary",
    kind: "local" as const,
    path: ".",
    hash: "source_hash",
  };
  const agent = {
    name: "default",
    adapter: "local" as const,
    model: "docker",
    config: {},
  };
  return {
    schema: "workbench.skill.state.v1",
    root: "/tmp/queued-eval",
    currentVersionId: "v001",
    refs: { current: "v001" },
    remotes: {},
    defaultSkill: "primary",
    defaultAgent: "default",
    versions: [{
      id: "v001",
      hash: "version_hash",
      message: "initial",
      parentIds: [],
      createdAt: "2026-06-08T00:00:00.000Z",
      files: versionFiles,
    }],
    evals: [{
      hash: hashFiles(evalFiles),
      caseCount: 1,
      files: evalFiles,
    }],
    skillSources: [source],
    skillBundles: [{
      hash: "bundle_hash",
      skillName: "primary",
      entryName: "primary",
      source,
      files: bundleFiles.map((file) => ({ ...file, path: `primary/${file.path}` })),
      includedSkills: [],
      createdAt: "2026-06-08T00:00:00.000Z",
    }],
    agents: [agent],
    runs: [],
    jobs: [],
    traces: [],
    artifacts: [],
    lineage: [],
  };
}

async function writeFailingCaseTest(root: string, message: string): Promise<void> {
  await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "case.yaml"), [
    "version: 1",
    "id: case-001",
    "prompt: Exercise a workflow-specific failure path.",
    "rubric:",
    "  - Captures workflow-specific failure evidence.",
    "command: sh \"$CASE_DIR/tests/test.sh\"",
    "",
  ].join("\n"));
  await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), [
    "#!/bin/sh",
    "set -eu",
    "mkdir -p \"$OUTPUT_DIR\"",
    `printf '%s\\n' ${shellQuote(message)} >&2`,
    `printf '{"ok":false,"message":%s}\\n' ${shellQuote(JSON.stringify(message))} > "$OUTPUT_DIR/result.json"`,
    "exit 2",
    "",
  ].join("\n"));
  await fs.chmod(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), 0o755);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function nodeCommand(lines: readonly string[]): string {
  return `node -e ${shellQuote(lines.join("\n"))}`;
}

function textFixture(filePath: string, content: string): {
  path: string;
  kind: "text";
  encoding: "utf8";
  executable: false;
  content: string;
} {
  return {
    path: filePath,
    kind: "text",
    encoding: "utf8",
    executable: false,
    content,
  };
}
