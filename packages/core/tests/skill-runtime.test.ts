import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  addWorkbenchAgent,
  addWorkbenchRemote,
  buildWorkbenchComparisonFromState,
  checkWorkbenchSkill,
  compareWorkbench,
  createWorkbenchExecutionCapability,
  createWorkbenchInspectionSnapshotFromState,
  createWorkbenchSandboxAllocation,
  createWorkbenchSkillEvalRuntimeInput,
  createWorkbenchSkillImproveRuntimeInput,
  createWorkbenchInspectionSnapshot,
  createWorkbenchReadOnlyInspectionSnapshot,
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
  importObjectPack,
  initWorkbenchSkill,
  readWorkbenchSkillRunOutputUsage,
  readWorkbenchSkillTraceResultsCostUsd,
  requiredWorkbenchAdapterAuthTargetsForRuntimeInput,
  listWorkbenchVersions,
  publishWorkbenchVersion,
  removeWorkbenchAgent,
  setDefaultWorkbenchAgent,
  showWorkbenchRef,
  switchWorkbenchVersion,
  syncWorkbenchRemote,
  type Json,
  type SandboxPlane,
  type WorkbenchProjectState,
  type WorkbenchExecutionRuntimeInput,
  type WorkbenchTrace,
  withWorkbenchProjectLock,
  workbenchImprovementEvidenceTraces,
  workbenchImprovementEvidenceTracesForVersion,
  workbenchExecutionEventBatchId,
  workbenchJobEvidenceForSnapshot,
  workbenchStatus,
  workbenchStatusSnapshot,
} from "../src/index.ts";

const hasDocker = spawnSync("docker", ["info"], { encoding: "utf8" }).status === 0;
const dockerTest = hasDocker ? test : test.skip;
const tempRoots: string[] = [];

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function exists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then(() => true, () => false);
}

function stubFetchHeader(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (!headers) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (Array.isArray(headers)) {
    return headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  }
  const value = (headers as Record<string, string | undefined>)[name] ??
    (headers as Record<string, string | undefined>)[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}

function parseStubFetchJson(init: RequestInit | undefined): Record<string, unknown> {
  const body = init?.body;
  const buffer = Buffer.isBuffer(body)
    ? body
    : typeof body === "string"
      ? Buffer.from(body)
      : body instanceof ArrayBuffer
        ? Buffer.from(body)
      : body instanceof Uint8Array
        ? Buffer.from(body)
        : Buffer.from(String(body ?? ""));
  const text = stubFetchHeader(init, "content-encoding") === "gzip"
    ? gunzipSync(buffer).toString("utf8")
    : buffer.toString("utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  ));
});

describe("skill-first Workbench runtime", () => {
  dockerTest("versions, evaluates, improves, compares, and switches a skill with Docker jobs", async () => {
    const root = await makeTempRoot("workbench-skill-runtime-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await writePassingCaseTest(root);

    const runs = await evalWorkbenchSkill({ dir: root });
    const initial = (await listWorkbenchVersions({ dir: root })).find((version) => version.id === runs[0]?.versionId)!;
    await expect(improveWorkbenchSkill({ dir: root, budget: 1 })).rejects.toThrow(/needs scored below-perfect, failed, or reviewed eval evidence/u);
    await addWorkbenchAgent({
      dir: root,
      name: "patcher",
      adapter: "command",
      config: {
        improveCommand: "printf '\\nCommand-backed improvement from trace evidence.\\n' >> \"$SKILL_DIR/SKILL.md\"",
      },
    });
    await expect(improveWorkbenchSkill({ dir: root, agent: "patcher", budget: 1 })).rejects.toThrow(/needs scored below-perfect, failed, or reviewed eval evidence/u);
    await writeFailingCaseTest(root, "missing workflow-specific output");
    const defaultFailingRuns = await evalWorkbenchSkill({ dir: root });
    await expect(improveWorkbenchSkill({ dir: root, budget: 1 })).rejects.toThrow(/no skill-improvement adapter/u);
    const failingRuns = await evalWorkbenchSkill({ dir: root, agent: "patcher" });
    await expect(improveWorkbenchSkill({ dir: root, agent: "patcher", budget: 1 }))
      .rejects.toThrow(/Improve proof eval failed/u);
    const snapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    const proofRun = snapshot.runs.find((run) => run.kind === "improve" && run.agentName === "patcher");
    const improvedVersion = snapshot.versions.find((version) => version.id === proofRun?.outputVersionId);
    if (!proofRun || !improvedVersion) {
      throw new Error("Expected failed improve proof run and candidate version.");
    }
    const diff = await diffWorkbenchVersions(`${initial.id}..${improvedVersion.id}`, { dir: root });

    expect(initial.id).toMatch(/^v_[a-f0-9]{64}$/u);
    expect(runs[0]).toMatchObject({ versionId: initial.id, status: "succeeded" });
    expect(runs[0]?.score).toBe(1);
    expect(runs[0]?.costUsd).toBeUndefined();
    expect(runs[0]?.jobIds).toHaveLength(1);
    const runTrace = snapshot.traces.find((trace) => trace.runId === runs[0]?.id);
    expect((runTrace?.result as Record<string, unknown> | undefined)?.score).toBe(1);
    expect(((runTrace?.result as { metrics?: Record<string, unknown> } | undefined)?.metrics)?.score).toBe(1);
    expect(((runTrace?.result as { cases?: Array<{ metrics?: Record<string, unknown> }> } | undefined)?.cases?.[0]?.metrics)?.score).toBe(1);
    const runExecution = (runTrace?.request as { execution?: {
      id?: string;
      versionId?: string;
      inputs?: Array<{ name?: string; ref?: string }>;
      metadata?: Record<string, unknown>;
    } } | undefined)?.execution;
    expect(runExecution?.id).toContain("case_case_001");
    expect(runExecution?.versionId).toBe(initial.id);
    expect(runExecution?.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "skills", ref: `workbench://skills/local/versions/${initial.id}` }),
      expect.objectContaining({ name: "case", ref: "workbench://skills/local/cases/case-001" }),
    ]));
    expect(runExecution?.metadata).toMatchObject({
      skillEval: true,
      skillName: "primary",
      agentName: "default",
      executionAdapter: "command",
    });
    expect(defaultFailingRuns[0]).toMatchObject({ status: "failed" });
    expect(failingRuns[0]).toMatchObject({ agentName: "patcher", status: "failed" });
    expect(proofRun).toMatchObject({ status: "failed", outputVersionId: improvedVersion.id });
    expect(improvedVersion.parentIds).toEqual([failingRuns[0]!.versionId]);
    expect(improvedVersion.id).not.toBe(failingRuns[0]!.versionId);
    expect(await fs.readFile(path.join(root, "SKILL.md"), "utf8")).not.toContain("Workbench Improvement Notes");
    const improvedSkill = improvedVersion.files.find((file) => file.path === "SKILL.md")?.content ?? "";
    expect(improvedSkill).toContain("Command-backed improvement from trace evidence.");
    expect(improvedSkill).not.toContain("Workbench Improvement Notes");
    expect(diff.map((entry) => entry.path)).toContain("SKILL.md");
    expect(snapshot.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ runId: runs[0]?.id, caseId: "case-001", status: "succeeded" }),
    ]));
    expect(snapshot.artifacts.length).toBeGreaterThan(0);
    expect(snapshot.lineage).toEqual(expect.arrayContaining([
      expect.objectContaining({ parentId: failingRuns[0]!.versionId, childId: improvedVersion.id, reason: "improve" }),
    ]));

    await switchWorkbenchVersion(initial.id, { dir: root });
    expect((await workbenchStatus({ dir: root })).currentVersionId).toBe(initial.id);
  }, 60_000);

  dockerTest("rejects improve when the selected agent has no improvement adapter", async () => {
    const root = await makeTempRoot("workbench-improve-agent-requirement-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await writeFailingCaseTest(root, "selected agent cannot improve");
    const [failingRun] = await evalWorkbenchSkill({ dir: root, agent: "default" });

    await expect(improveWorkbenchSkill({
      dir: root,
      agent: "default",
    })).rejects.toThrow(/Agent default cannot run improve because it has no skill-improvement adapter/u);

    const snapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    expect(failingRun).toMatchObject({ agentName: "default", status: "failed" });
    expect(snapshot.runs.some((run) => run.kind === "improve")).toBe(false);
    expect(snapshot.status.currentVersionId).toBe(failingRun?.versionId);
  }, 60_000);

  dockerTest("preserves command-provided Workbench result payloads in sandbox evals", async () => {
    const root = await makeTempRoot("workbench-command-result-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await addWorkbenchAgent({
      dir: root,
      name: "scored-command",
      adapter: "command",
      config: {
        command: nodeCommand([
          "const fs = require('node:fs');",
          "const path = require('node:path');",
          "const caseId = process.env.WORKBENCH_CASE_ID || 'missing-case-id';",
          "fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });",
          "fs.writeFileSync(path.join(process.env.OUTPUT_DIR, 'workbench-result.json'), JSON.stringify({",
          "  protocol: 'workbench.adapter-result.v1',",
          "  operation: 'engine.run',",
          "  ok: true,",
          "  value: {",
          "    score: 0.42,",
          "    summary: 'command result preserved',",
          "    feedback: { review: 'command review preserved' },",
          "    cases: [{ id: caseId, status: 'completed', metrics: { score: 0.42 } }],",
          "  },",
          "  summary: 'command result preserved',",
          "}, null, 2) + '\\n');",
        ]),
      },
    });
    await writeFailingCaseTest(root, "case should be measured, not treated as smoke");

    const [run] = await evalWorkbenchSkill({ dir: root, agent: "scored-command", rerun: true });
    const snapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    const trace = snapshot.traces.find((entry) => entry.runId === run?.id);

    expect(run).toMatchObject({
      status: "succeeded",
      score: 0.42,
    });
    expect(trace?.result).toMatchObject({
      score: 0.42,
      summary: "command result preserved",
      feedback: { review: "command review preserved" },
      cases: [
        expect.objectContaining({
          id: "case-001",
          status: "completed",
          metrics: { score: 0.42 },
        }),
      ],
    });
  }, 60_000);

  dockerTest("lets OUTPUT_DIR result.json mark an exit-zero shell test as failed evidence", async () => {
    const root = await makeTempRoot("workbench-public-result-status-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await fs.mkdir(path.join(root, ".workbench", "cases", "case-001", "tests"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "case.yaml"), [
      "version: 1",
      "id: case-001",
      "prompt: Exercise a workflow-specific result payload.",
      "command: sh \"$CASE_DIR/tests/test.sh\"",
      "",
    ].join("\n"));
    await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), [
      "#!/bin/sh",
      "set -eu",
      "mkdir -p \"$OUTPUT_DIR\"",
      "printf '{\"ok\":false,\"score\":0,\"message\":\"missing marker\"}\\n' > \"$OUTPUT_DIR/result.json\"",
      "exit 0",
      "",
    ].join("\n"));
    await fs.chmod(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), 0o755);

    const [run] = await evalWorkbenchSkill({ dir: root, rerun: true });
    const snapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    const trace = snapshot.traces.find((entry) => entry.runId === run?.id);

    expect(run).toMatchObject({
      status: "failed",
      score: 0,
      error: "missing marker",
    });
    expect(trace?.result).toMatchObject({
      status: "failed",
      score: 0,
      summary: "missing marker",
      cases: [
        expect.objectContaining({
          id: "case-001",
          status: "error",
          metrics: { score: 0 },
        }),
      ],
    });
    expect(workbenchImprovementEvidenceTraces(snapshot.traces).map((entry) => entry.id)).toContain(trace?.id);
  }, 60_000);

  dockerTest("read-only inspection exposes active local eval state while the eval is running", async () => {
    const root = await makeTempRoot("workbench-active-eval-snapshot-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await addWorkbenchAgent({
      dir: root,
      name: "slow-command",
      adapter: "command",
      config: {
        command: nodeCommand([
          "const fs = require('node:fs');",
          "const path = require('node:path');",
          "const caseId = process.env.WORKBENCH_CASE_ID || 'case-001';",
          "setTimeout(() => {",
          "  fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });",
          "  fs.writeFileSync(path.join(process.env.OUTPUT_DIR, 'workbench-result.json'), JSON.stringify({",
          "    protocol: 'workbench.adapter-result.v1',",
          "    operation: 'engine.run',",
          "    ok: true,",
          "    value: {",
          "      score: 0.8,",
          "      summary: 'slow command completed',",
          "      cases: [{ id: caseId, status: 'completed', metrics: { score: 0.8 } }],",
          "    },",
          "  }, null, 2) + '\\n');",
          "}, 3000);",
        ]),
      },
    });
    await writeFailingCaseTest(root, "slow case should be measured by command result");

    const evalPromise = evalWorkbenchSkill({ dir: root, agent: "slow-command", rerun: true });
    let observed = false;
    try {
      const observedState = await waitForValue(async () => {
        const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
        const run = snapshot.runs.find((entry) =>
          entry.agentName === "slow-command" && entry.status === "running"
        );
        if (!run) {
          return null;
        }
        const jobs = snapshot.jobs.filter((job) => job.runId === run.id);
        return jobs.some((job) => job.status === "queued" || job.status === "running")
          ? { snapshot, run, jobs }
          : null;
      }, 10_000);
      observed = true;
      expect(observedState.run.jobIds).toHaveLength(1);
      expect(observedState.jobs[0]?.status).toMatch(/queued|running/u);
      expect(observedState.snapshot.status.runCount).toBeGreaterThan(0);
    } finally {
      if (!observed) {
        await evalPromise.catch(() => undefined);
      }
    }
    const [run] = await evalPromise;
    expect(run).toMatchObject({ agentName: "slow-command", status: "succeeded" });
  }, 90_000);

  dockerTest("compares active, no-skill, and dummy-skill configurations through real eval runs", async () => {
    const root = await makeTempRoot("workbench-skill-comparison-baselines-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await fs.mkdir(path.join(root, "baselines", "dummy-skill"), { recursive: true });
    await fs.writeFile(path.join(root, "baselines", "dummy-skill", "SKILL.md"), "# Dummy skill\n\nDo not use the active skill workflow.\n");
    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "default: all",
      "skills:",
      "  primary:",
      "    path: .",
      "  no-skill:",
      "    baseline: none",
      "  dummy-skill:",
      "    path: baselines/dummy-skill",
      "",
    ].join("\n"));
    await writeFailingCaseTest(root, "comparison probe should be measured");
    await addWorkbenchAgent({
      dir: root,
      name: "skill-probe",
      adapter: "command",
      config: {
        command: nodeCommand([
          "const fs = require('node:fs');",
          "const path = require('node:path');",
          "const caseId = process.env.WORKBENCH_CASE_ID || 'case-001';",
          "const skillName = path.basename(process.env.SKILL_DIR);",
          "const skillPath = path.join(process.env.SKILL_DIR, 'SKILL.md');",
          "let score = 0.1;",
          "let summary = 'no skill baseline';",
          "if (fs.existsSync(skillPath)) {",
          "  const skill = fs.readFileSync(skillPath, 'utf8');",
          "  if (skill.includes('Dummy skill')) {",
          "    score = 0.3;",
          "    summary = 'dummy skill baseline';",
          "  } else {",
          "    score = 0.9;",
          "    summary = 'active skill workflow';",
          "  }",
          "}",
          "fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });",
          "fs.writeFileSync(path.join(process.env.OUTPUT_DIR, 'workbench-result.json'), JSON.stringify({",
          "  protocol: 'workbench.adapter-result.v1',",
          "  operation: 'engine.run',",
          "  ok: true,",
          "  value: {",
          "    score,",
          "    summary,",
          "    feedback: { review: `${skillName}: ${summary}` },",
          "    cases: [{ id: caseId, status: 'completed', metrics: { score } }],",
          "  },",
          "  summary,",
          "}, null, 2) + '\\n');",
        ]),
      },
    });
    await setDefaultWorkbenchAgent("skill-probe", { dir: root });

    const runs = await evalWorkbenchSkill({
      dir: root,
      skill: "all",
      agent: "skill-probe",
      rerun: true,
    });
    const runVersionIds = [...new Set(runs.map((run) => run.versionId))];
    const runScoreBySkill = new Map(runs.map((run) => [run.skillName, run.score]));
    const comparison = await compareWorkbench({
      dir: root,
      versions: runVersionIds[0],
      skills: "all",
      agents: "skill-probe",
    });
    const snapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    const version = (await listWorkbenchVersions({ dir: root })).find((entry) => entry.id === runVersionIds[0]);
    const noSkillBundle = comparison.skills.find((skill) => skill.skillName === "no-skill");
    const primaryBundle = comparison.skills.find((skill) => skill.skillName === "primary");
    const scoreBySkill = new Map(comparison.cells.map((cell) => [cell.skillName, cell.score]));
    const snapshotScoreBySkill = new Map(snapshot.comparison?.cells.map((cell) => [cell.skillName, cell.score]));

    expect(runs).toHaveLength(3);
    expect(runVersionIds).toHaveLength(1);
    expect(version?.files.map((file) => file.path)).toContain("baselines/dummy-skill/SKILL.md");
    expect(version?.files.map((file) => file.path)).not.toContain("baselines/no-skill/README.md");
    expect(runs.map((run) => run.skillName).sort()).toEqual(["dummy-skill", "no-skill", "primary"]);
    expect(runScoreBySkill).toEqual(new Map([
      ["dummy-skill", 0.3],
      ["no-skill", 0.1],
      ["primary", 0.9],
    ]));
    expect(comparison.skills.map((skill) => skill.skillName).sort()).toEqual(["dummy-skill", "no-skill", "primary"]);
    expect(noSkillBundle).toMatchObject({
      source: { name: "no-skill", kind: "none" },
      files: [],
    });
    expect(primaryBundle?.files.map((file) => file.path)).not.toContain("primary/baselines/dummy-skill/SKILL.md");
    expect(comparison.cells.map((cell) => cell.skillName).sort()).toEqual(["dummy-skill", "no-skill", "primary"]);
    expect(scoreBySkill).toEqual(new Map([
      ["dummy-skill", 0.3],
      ["no-skill", 0.1],
      ["primary", 0.9],
    ]));
    expect(snapshot.comparison?.versions.map((version) => version.id)).toEqual(runVersionIds);
    expect(snapshot.comparison?.cells.map((cell) => cell.skillName).sort()).toEqual(["dummy-skill", "no-skill", "primary"]);
    expect(snapshotScoreBySkill).toEqual(new Map([
      ["dummy-skill", 0.3],
      ["no-skill", 0.1],
      ["primary", 0.9],
    ]));
  }, 60_000);

  dockerTest("bare compare uses the current version and manifest default agent", async () => {
    const root = await makeTempRoot("workbench-compare-default-agent-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await writePassingCaseTest(root);
    await addWorkbenchAgent({
      dir: root,
      name: "default",
      adapter: "command",
      config: { command: scoreCommand(0.4) },
    });
    await setDefaultWorkbenchAgent("default", { dir: root });
    const [defaultRun] = await evalWorkbenchSkill({ dir: root, agent: "default", rerun: true });

    await addWorkbenchAgent({
      dir: root,
      name: "patcher",
      adapter: "command",
      config: { command: scoreCommand(0.9) },
    });
    await setDefaultWorkbenchAgent("patcher", { dir: root });
    const [patcherRun] = await evalWorkbenchSkill({ dir: root, agent: "patcher", rerun: true });

    const comparison = await compareWorkbench({ dir: root });

    expect(defaultRun?.agentName).toBe("default");
    expect(comparison.versions.map((version) => version.id)).toEqual([patcherRun?.versionId]);
    expect(comparison.agents.map((agent) => agent.agent.name)).toEqual(["patcher"]);
    expect(comparison.cells).toHaveLength(1);
    expect(comparison.cells[0]).toMatchObject({
      runId: patcherRun?.id,
      agentName: "patcher",
      score: 0.9,
    });

    const broadened = await compareWorkbench({ dir: root, versions: "all", agents: "all" });
    expect(broadened.cells.map((cell) => cell.agentName)).toEqual(
      expect.arrayContaining(["default", "patcher"]),
    );
  }, 60_000);

  dockerTest("compare prefers higher-sample scored evidence over a later smaller rerun", async () => {
    const root = await makeTempRoot("workbench-compare-samples-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await writePassingCaseTest(root);
    await addWorkbenchAgent({
      dir: root,
      name: "default",
      adapter: "command",
      config: { command: scoreCommand(0.8) },
    });
    await setDefaultWorkbenchAgent("default", { dir: root });

    const [fiveSampleRun] = await evalWorkbenchSkill({ dir: root, agent: "default", samples: 5, rerun: true });
    const [oneSampleRun] = await evalWorkbenchSkill({ dir: root, agent: "default", samples: 1, rerun: true });
    const comparison = await compareWorkbench({ dir: root });
    const [cell] = comparison.cells;

    expect(fiveSampleRun?.id).toBeTruthy();
    expect(oneSampleRun?.id).toBeTruthy();
    expect(fiveSampleRun?.versionId).toBe(oneSampleRun?.versionId);
    expect(cell).toMatchObject({
      runId: fiveSampleRun?.id,
      score: 0.8,
      samples: 5,
    });
    if (fiveSampleRun?.latencyMs !== undefined) {
      expect(cell?.latencyMs).toBe(Math.round(fiveSampleRun.latencyMs / 5));
    }
  }, 60_000);

  dockerTest("compare fills unrun cells for valid selected versions when recorded evidence exists", async () => {
    const root = await makeTempRoot("workbench-compare-selected-matrix-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await writePassingCaseTest(root);
    const [initialRun] = await evalWorkbenchSkill({ dir: root });
    const initialVersionId = initialRun?.versionId;
    if (!initialRun || !initialVersionId) {
      throw new Error("Expected the initial eval to record a run.");
    }

    await fs.appendFile(path.join(root, "SKILL.md"), "\nCurrent source edit without an eval run.\n");
    const comparison = await compareWorkbench({ dir: root, versions: `${initialVersionId}..current` });
    const currentVersionId = comparison.versions.find((version) => version.id !== initialVersionId)?.id;
    if (!currentVersionId) {
      throw new Error("Expected compare to reconcile a second selected version.");
    }
    const initialCell = comparison.cells.find((cell) => cell.versionId === initialVersionId);
    const currentCell = comparison.cells.find((cell) => cell.versionId === currentVersionId);

    expect(comparison.versions.map((version) => version.id)).toEqual([initialVersionId, currentVersionId]);
    expect(initialCell).toMatchObject({
      versionId: initialVersionId,
      agentName: "default",
      runId: initialRun.id,
      status: "succeeded",
    });
    expect(currentCell).toMatchObject({
      versionId: currentVersionId,
      agentName: "default",
    });
    expect(currentCell?.runId).toBeUndefined();
    expect(currentCell?.status).toBeUndefined();
  }, 60_000);

  dockerTest("runs explicit version evals from the selected version source snapshot", async () => {
    const root = await makeTempRoot("workbench-selected-version-eval-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await writePassingCaseTest(root);
    const initialRuns = await evalWorkbenchSkill({ dir: root });
    const initial = (await listWorkbenchVersions({ dir: root })).find((version) => version.id === initialRuns[0]?.versionId)!;
    expect(initialRuns[0]).toMatchObject({ versionId: initial.id, status: "succeeded" });

    await writeFailingCaseTest(root, "current case should not be used by v001");
    const currentRuns = await evalWorkbenchSkill({ dir: root, rerun: true });
    expect(currentRuns[0]).toMatchObject({ status: "failed" });

    const selectedRuns = await evalWorkbenchSkill({ dir: root, version: initial.id, rerun: true });
    expect(selectedRuns[0]).toMatchObject({ versionId: initial.id, status: "succeeded" });

    await fs.appendFile(path.join(root, "SKILL.md"), "\nDirty edit before explicit-version eval.\n");
    const dirtySelectedRuns = await evalWorkbenchSkill({ dir: root, version: initial.id, rerun: true });
    const dirtyCurrentVersion = (await listWorkbenchVersions({ dir: root }))
      .find((version) => version.files.some((file) =>
        file.path === "SKILL.md" && file.content.includes("Dirty edit before explicit-version eval.")
      ));
    expect(dirtySelectedRuns[0]).toMatchObject({ versionId: initial.id, status: "succeeded" });
    expect(dirtyCurrentVersion?.files.find((file) => file.path === "SKILL.md")?.content).toContain("Dirty edit before explicit-version eval.");
  }, 60_000);

  dockerTest("does not reuse eval runs when the same-name agent hash differs", async () => {
    const root = await makeTempRoot("workbench-agent-hash-reuse-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await writePassingCaseTest(root);
    const [firstRun] = await evalWorkbenchSkill({ dir: root });
    expect(firstRun).toBeDefined();

    const runPath = path.join(root, ".workbench", "objects", "run", `${firstRun!.id}.json`);
    const storedRun = JSON.parse(await fs.readFile(runPath, "utf8")) as WorkbenchProjectState["runs"][number];
    await fs.writeFile(runPath, `${JSON.stringify({ ...storedRun, agentHash: "stale_agent_hash" }, null, 2)}\n`);

    const [secondRun] = await evalWorkbenchSkill({ dir: root });
    expect(secondRun?.id).not.toBe(firstRun!.id);
    expect(secondRun?.agentHash).not.toBe("stale_agent_hash");
  }, 60_000);

  test("fails on corrupt Workbench objects instead of starting from empty history", async () => {
    const root = await makeTempRoot("workbench-corrupt-state-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    const initial = (await listWorkbenchVersions({ dir: root }))[0]!;
    const versionPath = path.join(root, ".workbench", "objects", "version", `${initial.id}.json`);
    const validVersion = await fs.readFile(versionPath, "utf8");

    await fs.writeFile(versionPath, "{not json");
    await expect(workbenchStatus({ dir: root })).rejects.toThrow(/JSON/u);
    await fs.writeFile(versionPath, validVersion);

    const malformedCases: Array<[string, string, Record<string, unknown>, RegExp]> = [
      ["version", path.join(root, ".workbench", "objects", "version", `${initial.id}.json`), { id: "v_bad" }, /versions\[0\]\.hash/u],
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
    await expect(workbenchStatus({ dir: root })).rejects.toThrow(/schema workbench\.remotes\.v1/u);
  });

  test("show and files reconcile manual edits before resolving current", async () => {
    const root = await makeTempRoot("workbench-show-files-current-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    const initial = await workbenchStatus({ dir: root });
    expect(initial.currentVersionId).toMatch(/^v_[a-f0-9]{64}$/u);

    await fs.appendFile(path.join(root, "SKILL.md"), "\nManual command-boundary edit.\n");

    const shown = await showWorkbenchRef("current:SKILL.md", { dir: root }) as { path?: string; content?: string };
    const files = await filesForWorkbenchRef("current", { dir: root });
    const status = await workbenchStatus({ dir: root });

    expect(status.currentVersionId).toMatch(/^v_[a-f0-9]{64}$/u);
    expect(status.currentVersionId).not.toBe(initial.currentVersionId);
    expect(shown.path).toBe("SKILL.md");
    expect(shown.content).toContain("Manual command-boundary edit.");
    expect(files.find((file) => file.path === "SKILL.md")?.content).toContain("Manual command-boundary edit.");
  });

  test("remote configuration is local metadata, not versioned skill source", async () => {
    const root = await makeTempRoot("workbench-remote-config-source-");
    const remote = await makeTempRoot("workbench-remote-config-source-remote-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    const workbenchGitignore = await fs.readFile(path.join(root, ".workbench", ".gitignore"), "utf8");
    expect(workbenchGitignore).toContain("/.gitignore");
    expect(workbenchGitignore).toContain("/remotes.yaml");
    await expect(fs.stat(path.join(root, ".workbench", "environment", "Dockerfile"))).rejects.toThrow(/ENOENT/u);
    const before = await workbenchStatus({ dir: root });

    await fs.mkdir(path.join(root, ".agents", "skills", "local-dummy"), { recursive: true });
    await fs.writeFile(path.join(root, ".agents", "skills", "local-dummy", "SKILL.md"), "# Local dummy\n");
    const afterLocalAgentState = await workbenchStatus({ dir: root });
    const localAgentStateVersion = await showWorkbenchRef("current", { dir: root }) as { files?: Array<{ path: string }> };

    expect(afterLocalAgentState.currentVersionId).toBe(before.currentVersionId);
    expect(afterLocalAgentState.currentSkillHash).toBe(before.currentSkillHash);
    expect(localAgentStateVersion.files?.map((file) => file.path)).not.toContain(".agents/skills/local-dummy/SKILL.md");

    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: root });

    const after = await workbenchStatus({ dir: root });
    const versions = await listWorkbenchVersions({ dir: root });
    expect(after.currentVersionId).toBe(before.currentVersionId);
    expect(after.currentSkillHash).toBe(before.currentSkillHash);
    expect(after.versionCount).toBe(before.versionCount);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.files.map((file) => file.path)).not.toContain(".workbench/remotes.yaml");
  });

  test("switching versions preserves local remote configuration", async () => {
    const root = await makeTempRoot("workbench-switch-remotes-");
    const remote = await makeTempRoot("workbench-switch-remotes-remote-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: root });
    await fs.appendFile(path.join(root, "SKILL.md"), "\nManual branch edit.\n");
    const edited = await workbenchStatus({ dir: root });
    expect(edited.currentVersionId).toMatch(/^v_[a-f0-9]{64}$/u);
    const initialVersion = (await listWorkbenchVersions({ dir: root }))[0]!;
    expect(edited.currentVersionId).not.toBe(initialVersion.id);
    const versionPath = path.join(root, ".workbench", "objects", "version", `${initialVersion.id}.json`);
    const version = JSON.parse(await fs.readFile(versionPath, "utf8")) as { files: Array<{ path: string; content: string }> };
    version.files.push(
      { path: ".workbench/remotes.yaml", content: "stale: file:///tmp/stale\n" },
      { path: ".workbench/locks/project.lock", content: "{\"pid\":1}\n" },
    );
    await fs.writeFile(versionPath, `${JSON.stringify(version, null, 2)}\n`);

    await switchWorkbenchVersion(initialVersion.id, { dir: root });

    const remotes = await fs.readFile(path.join(root, ".workbench", "remotes.yaml"), "utf8");
    const status = await workbenchStatus({ dir: root });
    expect(remotes).toContain("origin:");
    expect(remotes).not.toContain("stale:");
    expect(await exists(path.join(root, ".workbench", "locks", "project.lock"))).toBe(false);
    expect(status.currentVersionId).toBe(initialVersion.id);
    expect(status.remoteCount).toBe(1);
  });

  test("project commands recreate the local metadata ignore guard before lock writes", async () => {
    const root = await makeTempRoot("workbench-local-ignore-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await fs.rm(path.join(root, ".workbench", ".gitignore"), { force: true });

    await checkWorkbenchSkill({ dir: root });

    const ignore = await fs.readFile(path.join(root, ".workbench", ".gitignore"), "utf8");
    expect(ignore).toContain("/remotes.yaml\n");
    expect(ignore).toContain("/objects/\n");
    expect(ignore).toContain("/refs/\n");
    expect(ignore).toContain("/sync/\n");
    expect(ignore).toContain("/tmp/\n");
    expect(ignore).toContain("/logs/\n");
    expect(ignore).toContain("/locks/\n");
    expect(await exists(path.join(root, ".workbench", "locks", "project.lock"))).toBe(false);
  });

  test("file remotes reject installable source publication", async () => {
    const root = await makeTempRoot("workbench-file-publish-reject-");
    const remote = await makeTempRoot("workbench-file-publish-reject-remote-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: root });

    await expect(publishWorkbenchVersion({ dir: root })).rejects.toMatchObject({
      code: "publish_failed",
      subject: { remote: "origin", kind: "file" },
    });
    await expect(fs.stat(path.join(remote, "source"))).rejects.toThrow(/ENOENT/u);
  });

  test("serializes concurrent project commands and keeps object state intact", async () => {
    const root = await makeTempRoot("workbench-project-lock-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await fs.appendFile(path.join(root, "SKILL.md"), "\nManual concurrent edit.\n");

    let active = 0;
    let maxActive = 0;
    await Promise.all(Array.from({ length: 4 }, async () =>
      withWorkbenchProjectLock(root, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
      })
    ));

    const [status, versions, snapshot, shown] = await Promise.all([
      workbenchStatus({ dir: root }),
      listWorkbenchVersions({ dir: root }),
      createWorkbenchInspectionSnapshot({ dir: root }),
      showWorkbenchRef("current:SKILL.md", { dir: root }) as Promise<{ content?: string }>,
    ]);

    expect(maxActive).toBe(1);
    expect(status.currentVersionId).toMatch(/^v_[a-f0-9]{64}$/u);
    expect(status.versionCount).toBe(2);
    expect(versions.map((version) => version.id)).toHaveLength(2);
    expect(snapshot.versions.map((version) => version.id)).toHaveLength(2);
    expect(shown.content).toContain("Manual concurrent edit.");
    expect(await exists(path.join(root, ".workbench", "locks", "project.lock"))).toBe(false);
  });

  test("recovers previous object state after an interrupted directory swap", async () => {
    const root = await makeTempRoot("workbench-object-recover-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    const objects = path.join(root, ".workbench", "objects");
    const previous = path.join(root, ".workbench", "tmp", "objects.previous");
    await fs.rm(previous, { recursive: true, force: true });
    await fs.rename(objects, previous);

    const status = await workbenchStatus({ dir: root });

    expect(status.versionCount).toBe(1);
    expect(await exists(objects)).toBe(true);
    expect(await exists(previous)).toBe(false);
  });

  test("discards stale previous refs when current refs already exist", async () => {
    const root = await makeTempRoot("workbench-refs-recover-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    const currentRef = (await listWorkbenchVersions({ dir: root }))[0]!.id;
    const previous = path.join(root, ".workbench", "tmp", "refs.previous");
    await fs.rm(previous, { recursive: true, force: true });
    await fs.mkdir(previous, { recursive: true });
    await fs.writeFile(path.join(previous, "current"), "v_stale\n");

    const status = await workbenchStatus({ dir: root });

    expect(status.currentVersionId).toBe(currentRef);
    expect(await exists(path.join(root, ".workbench", "refs"))).toBe(true);
    expect(await exists(previous)).toBe(false);
  });

  test("explicit-version improve reconciles manual edits before resolving the base version", async () => {
    const root = await makeTempRoot("workbench-improve-explicit-dirty-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    const initial = (await listWorkbenchVersions({ dir: root }))[0]!;

    await fs.appendFile(path.join(root, "SKILL.md"), "\nDirty edit before explicit-version improve.\n");
    await expect(improveWorkbenchSkill({ dir: root, version: initial.id })).rejects.toThrow(/No eval cases found/u);

    const dirtyCurrentVersion = (await listWorkbenchVersions({ dir: root }))
      .find((version) => version.files.some((file) =>
        file.path === "SKILL.md" && file.content.includes("Dirty edit before explicit-version improve.")
      ));
    expect(dirtyCurrentVersion?.files.find((file) => file.path === "SKILL.md")?.content).toContain("Dirty edit before explicit-version improve.");
  });

  test("keeps local current refs out of ordinary remote sync", async () => {
    const root = await makeTempRoot("workbench-ref-sync-");
    const remote = await makeTempRoot("workbench-ref-sync-remote-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: root });
    await syncWorkbenchRemote({ dir: root });
    const before = await workbenchStatus({ dir: root });
    expect(before.currentVersionId).toBeDefined();

    const remoteRefsPath = path.join(remote, "refs.json");
    const remoteRefs = JSON.parse(await fs.readFile(remoteRefsPath, "utf8")) as Record<string, string>;
    await fs.writeFile(remoteRefsPath, `${JSON.stringify({ ...remoteRefs, current: "v_remote_fake" }, null, 2)}\n`);

    await syncWorkbenchRemote({ dir: root });
    const after = await workbenchStatus({ dir: root });
    expect(after.currentVersionId).toBe(before.currentVersionId);
    expect(JSON.parse(await fs.readFile(remoteRefsPath, "utf8"))).not.toHaveProperty("current");
    const snapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    expect(snapshot.refs.current).toBe(before.currentVersionId);
    expect(snapshot.refs["remotes/origin/current"]).toBeUndefined();
  });

  dockerTest("syncs independent evidenced copies without sequential id collisions", async () => {
    const localRoot = await makeTempRoot("workbench-evidenced-local-");
    const peerRoot = await makeTempRoot("workbench-evidenced-peer-");
    const remote = await makeTempRoot("workbench-unevidenced-remote-");
    await initWorkbenchSkill({ dir: localRoot, agent: "local" });
    await initWorkbenchSkill({ dir: peerRoot, agent: "local" });
    await writePassingCaseTest(localRoot);
    await writePassingCaseTest(peerRoot);
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: localRoot });
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: peerRoot });

    const [localRun] = await evalWorkbenchSkill({ dir: localRoot });
    const [peerRun] = await evalWorkbenchSkill({ dir: peerRoot });
    expect(localRun?.id).not.toBe(peerRun?.id);

    await syncWorkbenchRemote({ dir: localRoot });
    await syncWorkbenchRemote({ dir: peerRoot });
    await syncWorkbenchRemote({ dir: localRoot });

    const snapshot = await createWorkbenchInspectionSnapshot({ dir: localRoot });
    expect(snapshot.runs.map((run) => run.id)).toEqual(expect.arrayContaining([localRun!.id, peerRun!.id]));
    expect(new Set(snapshot.versions.map((version) => version.id)).size).toBe(snapshot.versions.length);
  }, 60_000);

  test("preserves historical agent snapshots by hash", async () => {
    const root = await makeTempRoot("workbench-agent-snapshots-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
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

  test("keeps agent manifest writes canonical around reserved names and defaults", async () => {
    const root = await makeTempRoot("workbench-agent-manifest-canonical-");
    await initWorkbenchSkill({ dir: root, agent: "local" });

    await expect(addWorkbenchAgent({
      dir: root,
      name: "all",
      adapter: "command",
      config: { command: "true" },
    })).rejects.toThrow(/reserved agent name "all"/u);
    await expect(removeWorkbenchAgent("default", { dir: root })).rejects.toThrow(/Cannot remove the last agent/u);

    await addWorkbenchAgent({
      dir: root,
      name: "patcher",
      adapter: "command",
      config: { command: "true" },
    });
    await expect(setDefaultWorkbenchAgent("all", { dir: root })).resolves.toEqual({ defaultAgent: "all" });

    const source = await fs.readFile(path.join(root, ".workbench", "agents.yaml"), "utf8");
    expect(source).toContain("default: all");
    expect(source).toContain("patcher:");
  });

  test("builds persisted comparison cells by exact agent hash", () => {
    const oldAgent = { name: "default", adapter: "command", config: { command: "old" } };
    const newAgent = { name: "default", adapter: "command", config: { command: "new" } };
    const oldAgentHash = hashJson(oldAgent);
    const newAgentHash = hashJson(newAgent);
    const source = { name: "primary", kind: "local" as const, path: "." };
    const state: WorkbenchProjectState = {
      schema: "workbench.skill.state.v1",
      root: "/tmp/comparison-agent-hash",
      refs: { current: "v001" },
      remotes: {},
      versions: [{
        id: "v001",
        hash: "version_hash",
        message: "Initial",
        parentIds: [],
        createdAt: "2026-06-09T00:00:00.000Z",
        files: [],
      }],
      skillSources: [source],
      skillBundles: [{
        hash: "bundle_hash",
        skillName: "primary",
        entryName: "primary",
        source,
        files: [],
        includedSkills: [],
        createdAt: "2026-06-09T00:00:00.000Z",
      }],
      evals: [evalFixture()],
      agents: [oldAgent, newAgent],
      runs: [{
        id: "run_old",
        kind: "eval",
        versionId: "v001",
        skillName: "primary",
        skillBundleHash: "bundle_hash",
        evalHash: "eval_hash",
        agentName: "default",
        agentHash: oldAgentHash,
        status: "succeeded",
        score: 0.1,
        traceIds: [],
        createdAt: "2026-06-09T00:01:00.000Z",
      }, {
        id: "run_new",
        kind: "eval",
        versionId: "v001",
        skillName: "primary",
        skillBundleHash: "bundle_hash",
        evalHash: "eval_hash",
        agentName: "default",
        agentHash: newAgentHash,
        status: "succeeded",
        score: 0.9,
        traceIds: [],
        createdAt: "2026-06-09T00:02:00.000Z",
      }],
      jobs: [],
      traces: [],
      executionEvents: [],
      artifacts: [],
      lineage: [],
    };

    const comparison = buildWorkbenchComparisonFromState(state);

    expect(comparison.agents.map((agent) => agent.hash).sort()).toEqual([newAgentHash, oldAgentHash].sort());
    expect(comparison.cells.find((cell) => cell.agentHash === oldAgentHash)).toMatchObject({
      agentName: "default",
      runId: "run_old",
      score: 0.1,
    });
    expect(comparison.cells.find((cell) => cell.agentHash === newAgentHash)).toMatchObject({
      agentName: "default",
      runId: "run_new",
      score: 0.9,
    });
  });

  test("keeps failed scored runs in persisted comparison cells", () => {
    const agent = { name: "codex", adapter: "codex", model: "gpt-5.4-mini", config: { auth: "default" } };
    const agentHash = hashJson(agent);
    const source = { name: "primary", kind: "local" as const, path: "." };
    const state: WorkbenchProjectState = {
      schema: "workbench.skill.state.v1",
      root: "/tmp/comparison-failed-run",
      refs: { current: "v001" },
      remotes: {},
      versions: [{
        id: "v001",
        hash: "version_hash",
        message: "Initial",
        parentIds: [],
        createdAt: "2026-06-09T00:00:00.000Z",
        files: [],
      }],
      skillSources: [source],
      skillBundles: [{
        hash: "bundle_hash",
        skillName: "primary",
        entryName: "primary",
        source,
        files: [],
        includedSkills: [],
        createdAt: "2026-06-09T00:00:00.000Z",
      }],
      evals: [evalFixture()],
      agents: [agent],
      runs: [{
        id: "run_failed",
        kind: "eval",
        versionId: "v001",
        skillName: "primary",
        skillBundleHash: "bundle_hash",
        evalHash: "eval_hash",
        agentName: "codex",
        agentHash,
        status: "failed",
        score: 1,
        error: "ADAPTER_AUTH_REQUIRED: codex disconnected",
        traceIds: [],
        createdAt: "2026-06-09T00:01:00.000Z",
      }],
      jobs: [],
      traces: [],
      executionEvents: [],
      artifacts: [],
      lineage: [],
    };

    const comparison = buildWorkbenchComparisonFromState(state);

    expect(comparison.cells).toHaveLength(1);
    expect(comparison.cells[0]).toMatchObject({
      agentName: "codex",
      runId: "run_failed",
      status: "failed",
      score: 1,
      error: "ADAPTER_AUTH_REQUIRED: codex disconnected",
    });
  });

  test("keeps failed unscored runs in persisted comparison cells", () => {
    const agent = { name: "codex", adapter: "codex", model: "gpt-5.4-mini", config: { auth: "default" } };
    const agentHash = hashJson(agent);
    const source = { name: "primary", kind: "local" as const, path: "." };
    const state: WorkbenchProjectState = {
      schema: "workbench.skill.state.v1",
      root: "/tmp/comparison-failed-unscored-run",
      refs: { current: "v001" },
      remotes: {},
      versions: [{
        id: "v001",
        hash: "version_hash",
        message: "Initial",
        parentIds: [],
        createdAt: "2026-06-09T00:00:00.000Z",
        files: [],
      }],
      skillSources: [source],
      skillBundles: [{
        hash: "bundle_hash",
        skillName: "primary",
        entryName: "primary",
        source,
        files: [],
        includedSkills: [],
        createdAt: "2026-06-09T00:00:00.000Z",
      }],
      evals: [evalFixture()],
      agents: [agent],
      runs: [{
        id: "run_failed_unscored",
        kind: "eval",
        versionId: "v001",
        skillName: "primary",
        skillBundleHash: "bundle_hash",
        evalHash: "eval_hash",
        agentName: "codex",
        agentHash,
        status: "failed",
        error: "ADAPTER_AUTH_REQUIRED: codex disconnected",
        traceIds: [],
        createdAt: "2026-06-09T00:01:00.000Z",
      }],
      jobs: [],
      traces: [],
      executionEvents: [],
      artifacts: [],
      lineage: [],
    };

    const comparison = buildWorkbenchComparisonFromState(state);

    expect(comparison.cells).toHaveLength(1);
    expect(comparison.cells[0]).toMatchObject({
      agentName: "codex",
      runId: "run_failed_unscored",
      status: "failed",
      error: "ADAPTER_AUTH_REQUIRED: codex disconnected",
    });
    expect(comparison.cells[0]?.score).toBeUndefined();
  });

  test("keeps scored terminal evidence ahead of newer active unscored runs", () => {
    const agent = { name: "default", adapter: "command", config: { command: "true" } };
    const agentHash = hashJson(agent);
    const source = { name: "primary", kind: "local" as const, path: "." };
    const state: WorkbenchProjectState = {
      schema: "workbench.skill.state.v1",
      root: "/tmp/comparison-active-unscored-run",
      refs: { current: "v001" },
      remotes: {},
      versions: [{
        id: "v001",
        hash: "version_hash",
        message: "Initial",
        parentIds: [],
        createdAt: "2026-06-09T00:00:00.000Z",
        files: [],
      }],
      skillSources: [source],
      skillBundles: [{
        hash: "bundle_hash",
        skillName: "primary",
        entryName: "primary",
        source,
        files: [],
        includedSkills: [],
        createdAt: "2026-06-09T00:00:00.000Z",
      }],
      evals: [evalFixture()],
      agents: [agent],
      runs: [{
        id: "run_scored",
        kind: "eval",
        versionId: "v001",
        skillName: "primary",
        skillBundleHash: "bundle_hash",
        evalHash: "eval_hash",
        agentName: "default",
        agentHash,
        status: "failed",
        score: 0.5,
        traceIds: [],
        createdAt: "2026-06-09T00:01:00.000Z",
      }, {
        id: "run_running",
        kind: "eval",
        versionId: "v001",
        skillName: "primary",
        skillBundleHash: "bundle_hash",
        evalHash: "eval_hash",
        agentName: "default",
        agentHash,
        status: "running",
        traceIds: [],
        createdAt: "2026-06-09T00:02:00.000Z",
      }],
      jobs: [],
      traces: [],
      executionEvents: [],
      artifacts: [],
      lineage: [],
    };

    const comparison = buildWorkbenchComparisonFromState(state);

    expect(comparison.cells).toHaveLength(1);
    expect(comparison.cells[0]).toMatchObject({
      agentName: "default",
      runId: "run_scored",
      status: "failed",
      score: 0.5,
    });
  });

  test("comparison ignores invalid historical manifests that have no recorded evidence", () => {
    const agent = { name: "patcher", adapter: "command", config: { command: "true" } };
    const agentHash = hashJson(agent);
    const source = { name: "primary", kind: "local" as const, path: "." };
    const state: WorkbenchProjectState = {
      schema: "workbench.skill.state.v1",
      root: "/tmp/comparison-invalid-history",
      refs: { current: "v002" },
      remotes: {},
      versions: [{
        id: "v001",
        hash: "version_hash_bad",
        message: "Broken agent edit",
        parentIds: [],
        createdAt: "2026-06-09T00:00:00.000Z",
        files: [textFixture(".workbench/agents.yaml", [
          "default: patcher",
          "agents:",
          "  patcher:",
          "    adapter: command",
          "    with:",
          "      command: true",
          "  patcher:",
          "    adapter: command",
          "    with:",
          "      command: true",
          "",
        ].join("\n"))],
      }, {
        id: "v002",
        hash: "version_hash_good",
        message: "Fixed",
        parentIds: ["v001"],
        createdAt: "2026-06-09T00:10:00.000Z",
        files: [textFixture(".workbench/agents.yaml", [
          "default: patcher",
          "agents:",
          "  patcher:",
          "    adapter: command",
          "    with:",
          "      command: true",
          "",
        ].join("\n"))],
      }],
      skillSources: [source],
      skillBundles: [{
        hash: "bundle_hash",
        skillName: "primary",
        entryName: "primary",
        source,
        files: [],
        includedSkills: [],
        createdAt: "2026-06-09T00:00:00.000Z",
      }],
      evals: [evalFixture()],
      agents: [agent],
      runs: [{
        id: "run_good",
        kind: "eval",
        versionId: "v002",
        skillName: "primary",
        skillBundleHash: "bundle_hash",
        evalHash: "eval_hash",
        agentName: "patcher",
        agentHash,
        status: "succeeded",
        score: 1,
        traceIds: [],
        createdAt: "2026-06-09T00:11:00.000Z",
      }],
      jobs: [],
      traces: [],
      executionEvents: [],
      artifacts: [],
      lineage: [],
    };

    const comparison = buildWorkbenchComparisonFromState(state, { versions: "all", agents: "all" });

    expect(comparison.cells.map((cell) => cell.versionId)).not.toContain("v001");
    expect(comparison.cells).toEqual(expect.arrayContaining([expect.objectContaining({
      versionId: "v002",
      agentName: "patcher",
      runId: "run_good",
      score: 1,
    })]));
  });

  test("scopes persisted comparison agents to the selected version source", () => {
    const oldAgent = { name: "old-agent", adapter: "codex", model: "old-model", config: { auth: "default" } };
    const sparkAgent = { name: "gpt-5.4-mini", adapter: "codex", model: "gpt-5.4-mini", config: { auth: "default" } };
    const oldAgentHash = hashJson(oldAgent);
    const sparkAgentHash = hashJson(sparkAgent);
    const source = { name: "primary", kind: "local" as const, path: "." };
    const state: WorkbenchProjectState = {
      schema: "workbench.skill.state.v1",
      root: "/tmp/comparison-version-agents",
      refs: { current: "v002" },
      remotes: {},
      versions: [{
        id: "v001",
        hash: "version_hash_001",
        message: "Initial",
        parentIds: [],
        createdAt: "2026-06-09T00:00:00.000Z",
        files: [textFixture(".workbench/agents.yaml", [
          "default: old-agent",
          "agents:",
          "  old-agent:",
          "    adapter: codex",
          "    model: old-model",
          "    with:",
          "      auth: default",
          "",
        ].join("\n"))],
      }, {
        id: "v002",
        hash: "version_hash_002",
        message: "Spark",
        parentIds: ["v001"],
        createdAt: "2026-06-09T00:10:00.000Z",
        files: [textFixture(".workbench/agents.yaml", [
          "default: gpt-5.4-mini",
          "agents:",
          "  gpt-5.4-mini:",
          "    adapter: codex",
          "    model: gpt-5.4-mini",
          "    with:",
          "      auth: default",
          "",
        ].join("\n"))],
      }],
      skillSources: [source],
      skillBundles: [{
        hash: "bundle_hash",
        skillName: "primary",
        entryName: "primary",
        source,
        files: [],
        includedSkills: [],
        createdAt: "2026-06-09T00:00:00.000Z",
      }],
      evals: [evalFixture()],
      agents: [oldAgent, sparkAgent],
      runs: [{
        id: "run_old",
        kind: "eval",
        versionId: "v001",
        skillName: "primary",
        skillBundleHash: "bundle_hash",
        evalHash: "eval_hash",
        agentName: "old-agent",
        agentHash: oldAgentHash,
        status: "succeeded",
        score: 0.1,
        traceIds: [],
        createdAt: "2026-06-09T00:01:00.000Z",
      }],
      jobs: [],
      traces: [],
      executionEvents: [],
      artifacts: [],
      lineage: [],
    };

    const comparison = buildWorkbenchComparisonFromState(state, { versions: "v002" });

    expect(comparison.agents.map((agent) => agent.hash)).toEqual([sparkAgentHash]);
    expect(comparison.cells).toHaveLength(1);
    expect(comparison.cells[0]).toMatchObject({
      versionId: "v002",
      agentName: "gpt-5.4-mini",
      agentHash: sparkAgentHash,
    });
  });

  test("skips historical versions that cannot define explicit compare axes", async () => {
    const root = await makeTempRoot("workbench-compare-axis-history-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    const initial = (await listWorkbenchVersions({ dir: root }))[0]!;
    await addWorkbenchAgent({
      dir: root,
      name: "patcher",
      adapter: "command",
      config: {
        command: "true",
      },
    });
    const versionsAfterAgent = await listWorkbenchVersions({ dir: root });
    const patcherVersion = versionsAfterAgent.find((version) => version.id !== initial.id);
    if (!patcherVersion) {
      throw new Error("Expected agent change to create a source version.");
    }

    const comparison = await compareWorkbench({ dir: root, versions: "all", agents: "patcher" });

    expect(comparison.versions.map((version) => version.id)).toEqual([patcherVersion.id]);
    expect(comparison.agents.map((agent) => agent.agent.name)).toEqual(["patcher"]);
    expect(comparison.cells).toHaveLength(1);
    expect(comparison.cells[0]).toMatchObject({
      versionId: patcherVersion.id,
      agentName: "patcher",
    });
    expect(comparison.cells[0]?.runId).toBeUndefined();
  });

  test("status records automatic versions locally without syncing them", async () => {
    const root = await makeTempRoot("workbench-status-sync-");
    const remote = await makeTempRoot("workbench-status-sync-remote-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: root });
    await syncWorkbenchRemote({ dir: root });

    await fs.writeFile(path.join(root, "SKILL.md"), "# Skill\n\nEdited from status.\n");
    const status = await workbenchStatus({ dir: root });

    expect(status.currentVersionId).toBeTruthy();
    await expect(fs.stat(path.join(remote, "objects", "version", `${status.currentVersionId}.json`))).rejects.toMatchObject({ code: "ENOENT" });
    await syncWorkbenchRemote({ dir: root });
    await expect(fs.stat(path.join(remote, "objects", "version", `${status.currentVersionId}.json`))).resolves.toBeTruthy();
  });

  test("rejects unpinned remote skill sources", async () => {
    const root = await makeTempRoot("workbench-unpinned-skill-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "default: upstream",
      "skills:",
      "  upstream:",
      "    from: github:anthropics/skills//skills/frontend-design",
      "",
    ].join("\n"));

    await expect(checkWorkbenchSkill({ dir: root })).rejects.toThrow(/explicit ref/u);
  });

  test("accepts only the built-in none baseline for no-skill comparisons", async () => {
    const root = await makeTempRoot("workbench-none-baseline-source-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "default: no-skill",
      "skills:",
      "  no-skill:",
      "    baseline: empty",
      "",
    ].join("\n"));

    await expect(checkWorkbenchSkill({ dir: root })).rejects.toThrow(/baseline must be none/u);

    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "default: no-skill",
      "skills:",
      "  no-skill:",
      "    baseline: none",
      "    includes:",
      "      - name: helper",
      "        path: helpers/helper",
      "",
    ].join("\n"));

    await expect(checkWorkbenchSkill({ dir: root })).rejects.toThrow(/baseline skills cannot define includes/u);
  });

  test("requires canonical top-level skill defaults for explicit skill manifests", async () => {
    const root = await makeTempRoot("workbench-skill-default-required-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "skills:",
      "  primary:",
      "    path: .",
      "",
    ].join("\n"));

    await expect(workbenchStatus({ dir: root })).rejects.toThrow(/must define top-level default/u);

    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "default: all",
      "skills:",
      "  primary:",
      "    path: .",
      "  variant:",
      "    path: skills/variant",
      "",
    ].join("\n"));
    await fs.mkdir(path.join(root, "skills", "variant"), { recursive: true });
    await fs.writeFile(path.join(root, "skills", "variant", "SKILL.md"), "# Variant\n");

    const checked = await checkWorkbenchSkill({ dir: root });
    expect(checked.skills).toBe(2);
    expect((await workbenchStatus({ dir: root })).defaultSkill).toBe("all");
  });

  test("reserves all as a selector name for skills and agents", async () => {
    const root = await makeTempRoot("workbench-all-selector-reserved-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "default: all",
      "skills:",
      "  all:",
      "    path: .",
      "",
    ].join("\n"));

    await expect(workbenchStatus({ dir: root })).rejects.toThrow(/reserved skill name "all"/u);

    await fs.rm(path.join(root, ".workbench", "skills.yaml"));
    await fs.writeFile(path.join(root, ".workbench", "agents.yaml"), [
      "default: all",
      "agents:",
      "  all:",
      "    adapter: local",
      "    model: docker",
      "    with: {}",
      "",
    ].join("\n"));

    await expect(workbenchStatus({ dir: root })).rejects.toThrow(/reserved agent name "all"/u);
  });

  test("resolves Workbench Cloud source URLs as pinned remote skill sources", async () => {
    const root = await makeTempRoot("workbench-cloud-source-skill-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "default: cloud",
      "skills:",
      "  cloud:",
      "    from: https://cloud.test/skills/alice/cloud-skill",
      "    ref: v003",
      "",
    ].join("\n"));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/api/workbench/source/skills/alice/cloud-skill/releases/v003/source") {
        return Response.json({
          schema: "workbench.source.snapshot.v1",
          owner: "alice",
          name: "cloud-skill",
          versionId: "v003",
          files: [
            {
              path: "SKILL.md",
              kind: "text",
              encoding: "utf8",
              executable: false,
              content: "# Cloud Skill\n",
            },
            {
              path: ".workbench/eval.yaml",
              kind: "text",
              encoding: "utf8",
              executable: false,
              content: "version: 1\n",
            },
          ],
        });
      }
      throw new Error(`Unexpected source fetch ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const checked = await checkWorkbenchSkill({ dir: root, skill: "cloud" });

    expect(checked.ok).toBe(true);
    expect(checked.plan.skills[0]?.fileCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://cloud.test/api/workbench/source/skills/alice/cloud-skill/releases/v003/source"),
      expect.any(Object),
    );
  });

  test("rejects unsafe Workbench source snapshot file paths", async () => {
    const root = await makeTempRoot("workbench-unsafe-cloud-source-skill-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "default: cloud",
      "skills:",
      "  cloud:",
      "    from: https://cloud.test/skills/alice/cloud-skill",
      "    ref: v003",
      "",
    ].join("\n"));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/api/workbench/source/skills/alice/cloud-skill/releases/v003/source") {
        return Response.json({
          schema: "workbench.source.snapshot.v1",
          owner: "alice",
          name: "cloud-skill",
          versionId: "v003",
          files: [{
            path: "../../state",
            kind: "text",
            encoding: "utf8",
            executable: false,
            content: "bad",
          }],
        });
      }
      throw new Error(`Unexpected source fetch ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkWorkbenchSkill({ dir: root, skill: "cloud" })).rejects.toThrow(/unsafe file path/u);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("uses the command auth token when resolving private Workbench skill URLs", async () => {
    const root = await makeTempRoot("workbench-private-cloud-source-skill-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "default: private_cloud",
      "skills:",
      "  private_cloud:",
      "    from: https://cloud.test/skills/alice/private-skill",
      "    ref: v007",
      "",
    ].join("\n"));
    const seenAuthHeaders: Array<string | null> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      seenAuthHeaders.push(new Headers(init?.headers).get("authorization"));
      if (url.pathname === "/api/workbench/source/skills/alice/private-skill/releases/v007/source") {
        return Response.json({
          schema: "workbench.source.snapshot.v1",
          owner: "alice",
          name: "private-skill",
          versionId: "v007",
          files: [{
            path: "SKILL.md",
            kind: "text",
            encoding: "utf8",
            executable: false,
            content: "# Private Cloud Skill\n",
          }],
        });
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
    expect(seenAuthHeaders).toEqual(["Bearer private-token"]);
  });

  test("fails on missing or incomplete agent files instead of creating implicit agents", async () => {
    const root = await makeTempRoot("workbench-agent-required-");
    await initWorkbenchSkill({ dir: root, agent: "local" });

    await fs.rm(path.join(root, ".workbench", "agents.yaml"), { force: true });
    await expect(workbenchStatus({ dir: root })).rejects.toThrow(/Missing \.workbench\/agents\.yaml/u);

    await fs.writeFile(path.join(root, ".workbench", "agents.yaml"), "default: default\nagents: {}\n");
    await expect(workbenchStatus({ dir: root })).rejects.toThrow(/No agents configured/u);

    await fs.writeFile(path.join(root, ".workbench", "agents.yaml"), "agents:\n  broken:\n    with: {}\n");
    await expect(workbenchStatus({ dir: root })).rejects.toThrow(/Agent broken .* must define a non-empty adapter/u);
  });

  test("reports zero eval cases without inflating project readiness", async () => {
    const root = await makeTempRoot("workbench-zero-cases-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
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
      testTrace("trace_smoke_failed", { request: { smoke: true, caseId: "case-smoke" }, result: { status: "failed", score: 0, error: "smoke failure" } }),
      testTrace("trace_passed", { request: { caseId: "case-pass" }, result: { status: "succeeded", score: 1 } }),
      testTrace("trace_low_score_passed", { request: { caseId: "case-low-score" }, result: { status: "succeeded", score: 0.4 } }),
      testTrace("trace_failed", { request: { caseId: "case-fail" }, result: { status: "failed", score: 0, error: "workflow failure" } }),
      testTrace("trace_auth_failed", { request: { caseId: "case-auth" }, result: { status: "failed", error: "ADAPTER_AUTH_REQUIRED: codex disconnected. Next: codex login --device-auth && workbench login codex --method oauth." } }),
      testTrace("trace_runtime_error", { request: { caseId: "case-runtime" }, result: { status: "error", error: "Runtime-control step host exited with status 1." } }),
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

    expect(qualified.map((trace) => trace.id)).toEqual([
      "trace_smoke_failed",
      "trace_low_score_passed",
      "trace_failed",
      "trace_reviewed",
      "trace_case_failed",
    ]);
    expect(JSON.parse(traceIndex?.content ?? "{}")).toMatchObject({
      traces: [
        expect.objectContaining({ id: "trace_smoke_failed" }),
        expect.objectContaining({ id: "trace_low_score_passed" }),
        expect.objectContaining({ id: "trace_failed" }),
        expect.objectContaining({ id: "trace_reviewed" }),
        expect.objectContaining({ id: "trace_case_failed" }),
      ],
    });
    expect(input.traceFiles?.some((file) => file.path.startsWith("trace_smoke_failed/"))).toBe(true);
    expect(input.traceFiles?.some((file) => file.path.startsWith("trace_passed/"))).toBe(false);
    expect(input.traceFiles?.some((file) => file.path.startsWith("trace_low_score_passed/"))).toBe(true);
    expect(input.traceFiles?.some((file) => file.path.startsWith("trace_auth_failed/"))).toBe(false);
    expect(input.traceFiles?.some((file) => file.path.startsWith("trace_runtime_error/"))).toBe(false);
  });

  test("keeps all qualifying improve evidence traces for worker input", () => {
    const qualified = workbenchImprovementEvidenceTraces(
      Array.from({ length: 25 }, (_entry, index) =>
        testTrace(`trace_${String(index + 1).padStart(2, "0")}`, {
          request: { caseId: `case-${index + 1}` },
          result: { status: "failed", score: 0, error: `failure ${index + 1}` },
        })
      ),
    );
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
    const traceIndex = JSON.parse(input.traceFiles?.find((file) => file.path === "index.json")?.content ?? "{}") as {
      traces?: Array<{ id: string }>;
    };

    expect(qualified).toHaveLength(25);
    expect(traceIndex.traces).toHaveLength(25);
    expect(traceIndex.traces?.at(0)?.id).toBe("trace_01");
    expect(traceIndex.traces?.at(-1)?.id).toBe("trace_25");
  });

  test("scopes improve evidence to the selected version lineage and only filters by agent when requested", () => {
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
      refs: { current: "v003" },
      remotes: {},
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
        testTrace("trace_ancestor", { runId: "run_ancestor", jobId: "job_ancestor", versionId: "v001", result: { status: "failed", score: 0, error: "ancestor failure" } }),
        testTrace("trace_sibling", { runId: "run_sibling", jobId: "job_sibling", versionId: "v002", result: { status: "failed", score: 0, error: "sibling failure" } }),
        testTrace("trace_wrong_agent", { runId: "run_wrong_agent", jobId: "job_wrong_agent", versionId: "v003", result: { status: "failed", score: 0, error: "wrong agent failure" } }),
        testTrace("trace_orphan", { runId: "missing_run", jobId: "missing_job", versionId: "v001", result: { status: "failed", score: 0, error: "orphan failure" } }),
      ],
      executionEvents: [],
      artifacts: [],
      lineage: [
        { parentId: "v001", childId: "v002", reason: "version", createdAt: "2026-06-08T00:00:00.000Z" },
        { parentId: "v001", childId: "v003", reason: "version", createdAt: "2026-06-08T00:00:00.000Z" },
      ],
    };

    expect(workbenchImprovementEvidenceTracesForVersion(state, {
      versionId: "v003",
      skillName: "primary",
    }).map((trace) => trace.id)).toEqual(["trace_ancestor", "trace_wrong_agent", "trace_orphan"]);
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

  test("job evidence exposes live trace event batches before terminal trace files exist", () => {
    const state = createQueuedEvalState();
    const at = "2026-06-08T00:00:00.000Z";
    const agentHash = hashJson(state.agents[0]!);
    const evalHash = state.evals[0]!.hash;
    state.runs.push({
      id: "run_live",
      kind: "eval",
      versionId: "v001",
      skillName: "primary",
      skillBundleHash: "bundle_hash",
      evalHash,
      agentName: "default",
      agentHash,
      status: "running",
      jobIds: ["job_live"],
      traceIds: [],
      createdAt: at,
    });
    state.jobs.push({
      id: "job_live",
      runId: "run_live",
      kind: "eval",
      versionId: "v001",
      skillName: "primary",
      skillBundleHash: "bundle_hash",
      evalHash,
      agentName: "default",
      agentHash,
      caseId: "case-001",
      sample: 0,
      status: "running",
      artifactIds: [],
      traceIds: [],
      createdAt: at,
      startedAt: at,
    });
    state.executionEvents.push({
      projectId: state.root,
      runId: "run_live",
      jobId: "job_live",
      executionId: "exec_live",
      attempt: 1,
      seqStart: 1,
      seqEnd: 1,
      emittedAt: at,
      events: [{
        seq: 1,
        at,
        source: "adapter",
        role: "engine",
        schema: "workbench.trace.delta.v1",
        payload: {
          trace_id: "trace_live",
          spans: [{
            id: "turn_1",
            parent_id: null,
            attempt_number: 1,
            stage_id: null,
            stage_run_index: null,
            kind: "turn",
            title: "Skill run",
            status: "running",
            started_at: at,
            ended_at: null,
            attributes: { adapter: "codex" },
          }],
          events: [{
            id: "event_1",
            span_id: "turn_1",
            attempt_number: 1,
            stage_id: null,
            stage_run_index: null,
            kind: "message",
            at,
            message: "Starting adapter turn",
            attributes: {},
          }],
          summaries: [],
        } satisfies Json,
      }],
    });

    const snapshot = createWorkbenchInspectionSnapshotFromState({ state });
    const evidence = workbenchJobEvidenceForSnapshot(snapshot, { runId: "run_live", jobId: "job_live" });

    expect(evidence?.executions[0]?.sessions).toHaveLength(1);
    expect(evidence?.executions[0]?.sessions[0]).toMatchObject({
      id: "job_live:live-progress",
      label: "Live trace",
      kind: "progress",
      sourcePath: null,
      metadata: { progress_batches: 1 },
    });
    expect(evidence?.executions[0]?.trace.spans).toEqual([
      expect.objectContaining({ id: "turn_1", title: "Skill run", status: "running" }),
    ]);
    expect(evidence?.executions[0]?.trace.events).toEqual([
      expect.objectContaining({ id: "event_1", span_id: "turn_1", message: "Starting adapter turn" }),
    ]);
    expect(evidence?.executions[0]?.trace.summaries).toEqual([
      expect.objectContaining({ status: "running" }),
    ]);
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

  dockerTest("syncs object-pack evidence through file remotes without Git refs", async () => {
    const temp = await makeTempRoot("workbench-object-sync-");
    const remote = path.join(temp, "remote");
    const root = path.join(temp, "source");
    await initWorkbenchSkill({ dir: root, agent: "local" });
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
    await fs.appendFile(path.join(root, "SKILL.md"), "\nCommand-backed sync improvement.\n");
    await writeFailingCaseTest(root, "sync workflow failure");
    const [candidateRun] = await evalWorkbenchSkill({ dir: root, rerun: true });
    const candidateVersionId = candidateRun?.versionId;
    if (!candidateVersionId) {
      throw new Error("Expected edited skill eval to record a candidate version.");
    }
    const remoteUrl = pathToFileURL(remote).toString();
    await addWorkbenchRemote("origin", remoteUrl, { dir: root });

    const synced = await syncWorkbenchRemote({ dir: root });
    expect(synced.remote).toMatchObject({ name: "origin", url: remoteUrl, kind: "file" });
    expect(synced.pushed).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(await fs.readFile(path.join(remote, "manifest.json"), "utf8"))).toMatchObject({
      schema: "workbench.object-pack.v1",
    });
    expect(await fs.readdir(path.join(remote, "objects", "version"))).toEqual(expect.arrayContaining([
      `${initial.id}.json`,
      `${candidateVersionId}.json`,
    ]));
    expect(await fs.readdir(path.join(remote, "objects", "job"))).not.toHaveLength(0);
    expect(await fs.readdir(path.join(remote, "objects", "artifact"))).not.toHaveLength(0);
    expect(await fs.readFile(path.join(remote, "indexes", "measurements.jsonl"), "utf8")).toContain("run_");

    const portableRoot = path.join(temp, "portable");
    await initWorkbenchSkill({ dir: portableRoot, agent: "local" });
    await addWorkbenchRemote("origin", remoteUrl, { dir: portableRoot });
    const pulled = await syncWorkbenchRemote({ dir: portableRoot });
    const portableSnapshot = await createWorkbenchInspectionSnapshot({ dir: portableRoot });
    expect(pulled.pulled).toBeGreaterThanOrEqual(0);
    expect(portableSnapshot.versions.map((version) => version.id)).toEqual(expect.arrayContaining([initial.id, candidateVersionId]));
    expect(portableSnapshot.runs.length).toBeGreaterThan(0);
    expect(portableSnapshot.jobs.length).toBeGreaterThan(0);
    expect(portableSnapshot.artifacts.length).toBeGreaterThan(0);
    expect(portableSnapshot.publication).toBeUndefined();

    await switchWorkbenchVersion(candidateVersionId, { dir: portableRoot });
    expect(await fs.readFile(path.join(portableRoot, "SKILL.md"), "utf8")).toContain("Command-backed sync improvement.");

    const portableSkillPath = path.join(portableRoot, "SKILL.md");
    const portableSkill = await fs.readFile(portableSkillPath, "utf8");
    await fs.writeFile(portableSkillPath, `${portableSkill}\nLocal manual edit.\n`);
    const manualStatus = await workbenchStatus({ dir: portableRoot });
    expect(manualStatus.currentVersionId).not.toBe(candidateVersionId);
    expect(await fs.readFile(portableSkillPath, "utf8")).toContain("Local manual edit.");
    await switchWorkbenchVersion(candidateVersionId, { dir: portableRoot });
    expect(await fs.readFile(portableSkillPath, "utf8")).not.toContain("Local manual edit.");
  }, 60_000);

  test("file remote sync ignores publication refs", async () => {
    const temp = await makeTempRoot("workbench-publication-ref-");
    const remote = path.join(temp, "remote");
    const root = path.join(temp, "source");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: root });
    await syncWorkbenchRemote({ dir: root });
    const currentVersionId = (await workbenchStatus({ dir: root })).currentVersionId!;

    await fs.writeFile(path.join(remote, "refs.json"), JSON.stringify({
      current: currentVersionId,
      published: currentVersionId,
    }, null, 2));
    await syncWorkbenchRemote({ dir: root });

    const snapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    expect(snapshot.refs.published).toBeUndefined();
    expect(snapshot.refs[`releases/${currentVersionId}`]).toBeUndefined();
    expect(snapshot.publication).toBeUndefined();
  });

  test("sync accepts same skill bundle hash with different creation metadata", async () => {
    const bundle = {
      hash: "bundle_hash",
      skillName: "primary",
      entryName: "primary",
      source: { name: "primary", kind: "local" as const, path: "." },
      includedSkills: [],
      files: [{
        path: "primary/SKILL.md",
        kind: "text" as const,
        encoding: "utf8" as const,
        content: "# Skill\n",
        executable: false,
      }],
      createdAt: "2026-06-09T00:00:00.000Z",
    };
    const state: WorkbenchProjectState = {
      schema: "workbench.skill.state.v1",
      root: "/local/skill",
      refs: {},
      remotes: {},
      versions: [],
      skillSources: [],
      skillBundles: [bundle],
      evals: [],
      agents: [],
      runs: [],
      jobs: [],
      traces: [],
      executionEvents: [],
      artifacts: [],
      lineage: [],
    };
    const remotePack = exportObjectPack({
      ...state,
      skillBundles: [{
        ...bundle,
        createdAt: "2026-06-09T01:00:00.000Z",
      }],
    });

    expect(() => importObjectPack(state, remotePack)).not.toThrow();
    expect(state.skillBundles).toHaveLength(1);
    expect(state.skillBundles[0]?.createdAt).toBe("2026-06-09T00:00:00.000Z");
  });

  test("sync accepts same eval hash with different modified metadata", async () => {
    const evalFiles = [{
      path: "eval.yaml",
      kind: "text" as const,
      encoding: "utf8" as const,
      content: "version: 1\nname: eval\n",
      executable: false,
    }, {
      path: "cases/case-001/case.yaml",
      kind: "text" as const,
      encoding: "utf8" as const,
      content: "version: 1\nid: case-001\n",
      executable: false,
    }];
    const evalSnapshot = evalFixture({
      hash: hashFiles(evalFiles),
      files: evalFiles,
      caseCount: 0,
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
    });
    const state: WorkbenchProjectState = {
      schema: "workbench.skill.state.v1",
      root: "/local/skill",
      refs: {},
      remotes: {},
      versions: [],
      skillSources: [],
      skillBundles: [],
      evals: [evalSnapshot],
      agents: [],
      runs: [],
      jobs: [],
      traces: [],
      executionEvents: [],
      artifacts: [],
      lineage: [],
    };
    const remotePack = exportObjectPack({
      ...state,
      evals: [{
        ...evalSnapshot,
        caseCount: 1,
        createdAt: "2026-06-09T01:00:00.000Z",
        updatedAt: "2026-06-09T01:00:00.000Z",
        scoreAdapter: "tests",
      }],
    });

    expect(() => importObjectPack(state, remotePack)).not.toThrow();
    expect(state.evals).toHaveLength(1);
    expect(state.evals[0]?.caseCount).toBe(1);
    expect(state.evals[0]?.scoreAdapter).toBe("tests");
    expect(state.evals[0]?.createdAt).toBe("2026-06-09T00:00:00.000Z");
    expect(state.evals[0]?.updatedAt).toBe("2026-06-09T01:00:00.000Z");
  });

  test("sync rejects stale same-hash eval files instead of repairing object identity", async () => {
    const evalFiles = [{
      path: "eval.yaml",
      kind: "text" as const,
      encoding: "utf8" as const,
      content: "version: 1\nname: eval\n",
      executable: false,
    }, {
      path: "environment/Dockerfile",
      kind: "text" as const,
      encoding: "utf8" as const,
      content: "FROM alpine\n",
      executable: false,
    }];
    const evalHash = hashFiles(evalFiles);
    const state: WorkbenchProjectState = {
      schema: "workbench.skill.state.v1",
      root: "/local/skill",
      refs: {},
      remotes: {},
      versions: [],
      skillSources: [],
      skillBundles: [],
      evals: [evalFixture({
        hash: evalHash,
        files: evalFiles.filter((file) => file.path !== "environment/Dockerfile"),
        caseCount: 0,
      })],
      agents: [],
      runs: [],
      jobs: [],
      traces: [],
      executionEvents: [],
      artifacts: [],
      lineage: [],
    };
    const remotePack = exportObjectPack({
      ...state,
      evals: [{
        hash: evalHash,
        files: evalFiles,
        caseCount: 0,
        createdAt: "2026-06-09T00:00:00.000Z",
        updatedAt: "2026-06-09T00:00:00.000Z",
        scoreAdapter: "tests",
      }],
    });

    expect(() => importObjectPack(state, remotePack)).toThrow("files do not match its object id");
  });

  test("sync rejects eval objects whose files do not match their hash", async () => {
    const evalFiles = [{
      path: "eval.yaml",
      kind: "text" as const,
      encoding: "utf8" as const,
      content: "cases: []\n",
      executable: false,
    }];
    const evalSnapshot = evalFixture({
      hash: "eval_hash_1",
      files: evalFiles,
      caseCount: 3,
      updatedAt: "2026-06-09T00:00:00.000Z",
    });
    const state: WorkbenchProjectState = {
      schema: "workbench.skill.state.v1",
      root: "/local/skill",
      refs: {},
      remotes: {},
      versions: [],
      skillSources: [],
      skillBundles: [],
      evals: [evalSnapshot],
      agents: [],
      runs: [],
      jobs: [],
      traces: [],
      executionEvents: [],
      artifacts: [],
      lineage: [],
    };
    const remotePack = exportObjectPack({
      ...state,
      evals: [{
        ...evalSnapshot,
        updatedAt: "2026-06-09T01:00:00.000Z",
      }],
    });

    expect(() => importObjectPack(state, remotePack)).toThrow("files do not match its object id");
  });

  test("rejects object packs missing required object arrays", () => {
    const state: WorkbenchProjectState = {
      schema: "workbench.skill.state.v1",
      root: "/local/skill",
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
      executionEvents: [],
      artifacts: [],
      lineage: [],
    };
    for (const field of ["jobs", "artifacts", "versions", "lineage"]) {
      const pack = exportObjectPack(state) as unknown as Record<string, unknown>;
      delete pack[field];
      expect(() => importObjectPack(state, pack as unknown as Parameters<typeof importObjectPack>[1]))
        .toThrow("Unsupported Workbench object pack.");
    }
  });

  test("fails check when a case.yaml is malformed", async () => {
    const root = await makeTempRoot("workbench-broken-case-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    const caseDir = path.join(root, ".workbench", "cases", "broken");
    await fs.mkdir(caseDir, { recursive: true });
    await fs.writeFile(path.join(caseDir, "case.yaml"), "id: [unterminated\ncommand: 'echo ok\n");

    await expect(checkWorkbenchSkill({ dir: root })).rejects.toThrow(/invalid case YAML/u);
  });

  test("fails check when a case.yaml is not a mapping", async () => {
    const root = await makeTempRoot("workbench-non-mapping-case-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    const caseDir = path.join(root, ".workbench", "cases", "listy");
    await fs.mkdir(caseDir, { recursive: true });
    await fs.writeFile(path.join(caseDir, "case.yaml"), "- not\n- a\n- mapping\n");

    await expect(checkWorkbenchSkill({ dir: root })).rejects.toThrow(/case YAML must be a mapping/u);
  });

  test("HTTP sync writes only missing objects for remote-present skill bundles", async () => {
    const root = await makeTempRoot("workbench-http-delta-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    const bundle = {
      hash: hashJson({ bundle: "same-content" }),
      skillName: "primary",
      entryName: "primary",
      source: { name: "primary", kind: "local" as const, path: "." },
      includedSkills: [],
      files: [{
        path: "primary/SKILL.md",
        kind: "text" as const,
        encoding: "utf8" as const,
        content: "# Skill\n",
        executable: false,
      }],
      createdAt: "2026-06-09T00:00:00.000Z",
    };
    const eventBatch: WorkbenchProjectState["executionEvents"][number] = {
      projectId: "local",
      runId: "run_event",
      jobId: "job_event",
      executionId: "exec_event",
      attempt: 1,
      seqStart: 1,
      seqEnd: 1,
      emittedAt: "2026-06-09T00:00:00.000Z",
      events: [{
        seq: 1,
        at: "2026-06-09T00:00:00.000Z",
        source: "adapter",
        role: "runner",
        schema: "workbench.execution.step.v1",
        payload: { step: "skill.run", status: "started" },
      }],
    };
    await fs.mkdir(path.join(root, ".workbench", "objects", "skill-bundle"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".workbench", "objects", "skill-bundle", `${bundle.hash}.json`),
      `${JSON.stringify(bundle, null, 2)}\n`,
    );
    await fs.mkdir(path.join(root, ".workbench", "objects", "execution-event"), { recursive: true });
    await fs.writeFile(
      path.join(
        root,
        ".workbench",
        "objects",
        "execution-event",
        `${workbenchExecutionEventBatchId(eventBatch)}.json`,
      ),
      `${JSON.stringify(eventBatch, null, 2)}\n`,
    );
    const remotePack = exportObjectPack({
      schema: "workbench.skill.state.v1",
      root: "/cloud/skill",
      refs: {},
      remotes: {},
      versions: [],
      skillSources: [],
      skillBundles: [{
        ...bundle,
        createdAt: "2026-06-09T01:00:00.000Z",
      }],
      evals: [],
      agents: [],
      runs: [],
      jobs: [],
      traces: [],
      executionEvents: [eventBatch],
      artifacts: [],
      lineage: [],
    });
    const putPacks: Array<ReturnType<typeof exportObjectPack>> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return Response.json({ skills: [{ id: "skill_http", ownerSlug: "alice", name: "http-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_http/objects" && method === "GET") {
        return Response.json({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_http/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack: ReturnType<typeof exportObjectPack> };
        putPacks.push(body.objectPack);
        if (body.objectPack.skillBundles.some((entry) => entry.hash === bundle.hash)) {
          return Response.json({
            message: `Workbench object conflict for skill bundle ${bundle.hash}`,
          }, { status: 400 });
        }
        if (body.objectPack.executionEvents.some((entry) =>
          workbenchExecutionEventBatchId(entry) === workbenchExecutionEventBatchId(eventBatch)
        )) {
          return Response.json({
            message: `Workbench object conflict for execution event batch ${workbenchExecutionEventBatchId(eventBatch)}`,
          }, { status: 400 });
        }
        return Response.json({ skill: { id: "skill_http" } });
      }
      throw new Error(`Unexpected fetch ${method} ${url.pathname}`);
    }));

    await addWorkbenchRemote("origin", "https://cloud.test/skills/alice/http-skill", {
      dir: root,
      authToken: "test-token",
    });
    await syncWorkbenchRemote({ dir: root, authToken: "test-token" });

    expect(putPacks.length).toBeGreaterThan(0);
    expect(putPacks.every((pack) =>
      pack.skillBundles.every((entry) => entry.hash !== bundle.hash)
    )).toBe(true);
    expect(putPacks.every((pack) =>
      pack.executionEvents.every((entry) =>
        workbenchExecutionEventBatchId(entry) !== workbenchExecutionEventBatchId(eventBatch)
      )
    )).toBe(true);
  });

  test("HTTP sync treats remote-present lifecycle ids as Cloud-owned", async () => {
    const root = await makeTempRoot("workbench-http-lifecycle-delta-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    const run: WorkbenchProjectState["runs"][number] = {
      id: "run_delta",
      kind: "eval",
      versionId: "v001",
      skillName: "primary",
      skillBundleHash: "bundle_delta",
      evalHash: "eval_delta",
      agentName: "default",
      agentHash: "agent_delta",
      status: "succeeded",
      score: 1,
      jobIds: ["job_delta"],
      traceIds: ["trace_delta"],
      createdAt: "2026-06-09T00:00:00.000Z",
      finishedAt: "2026-06-09T00:00:01.000Z",
    };
    const job: WorkbenchProjectState["jobs"][number] = {
      id: "job_delta",
      runId: run.id,
      kind: run.kind,
      versionId: run.versionId,
      skillName: run.skillName,
      skillBundleHash: run.skillBundleHash,
      evalHash: run.evalHash,
      agentName: run.agentName,
      agentHash: run.agentHash,
      caseId: "case-001",
      sample: 0,
      status: "succeeded",
      score: 1,
      artifactIds: [],
      traceIds: ["trace_delta"],
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
    };
    await fs.mkdir(path.join(root, ".workbench", "objects", "run"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "job"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "objects", "run", `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`);
    await fs.writeFile(path.join(root, ".workbench", "objects", "job", `${job.id}.json`), `${JSON.stringify(job, null, 2)}\n`);
    const remoteRun: WorkbenchProjectState["runs"][number] = {
      id: run.id,
      kind: run.kind,
      versionId: run.versionId,
      skillName: run.skillName,
      skillBundleHash: run.skillBundleHash,
      evalHash: run.evalHash,
      agentName: run.agentName,
      agentHash: run.agentHash,
      status: "running",
      jobIds: ["job_delta"],
      traceIds: [],
      createdAt: run.createdAt,
    };
    const remoteJob: WorkbenchProjectState["jobs"][number] = {
      id: job.id,
      runId: job.runId,
      kind: job.kind,
      versionId: job.versionId,
      skillName: job.skillName,
      skillBundleHash: job.skillBundleHash,
      evalHash: job.evalHash,
      agentName: job.agentName,
      agentHash: job.agentHash,
      caseId: job.caseId,
      sample: job.sample,
      status: "running",
      artifactIds: [],
      traceIds: [],
      createdAt: job.createdAt,
    };
    const remotePack = exportObjectPack({
      schema: "workbench.skill.state.v1",
      root: "/cloud/skill",
      refs: {},
      remotes: {},
      versions: [],
      skillSources: [],
      skillBundles: [],
      evals: [],
      agents: [],
      runs: [remoteRun],
      jobs: [remoteJob],
      traces: [],
      executionEvents: [],
      artifacts: [],
      lineage: [],
    });
    const putPacks: Array<ReturnType<typeof exportObjectPack>> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return Response.json({ skills: [{ id: "skill_http", ownerSlug: "alice", name: "http-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_http/objects" && method === "GET") {
        return Response.json({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_http/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack: ReturnType<typeof exportObjectPack> };
        putPacks.push(body.objectPack);
        return Response.json({ skill: { id: "skill_http" } });
      }
      throw new Error(`Unexpected fetch ${method} ${url.pathname}`);
    }));

    await addWorkbenchRemote("origin", "https://cloud.test/skills/alice/http-skill", {
      dir: root,
      authToken: "test-token",
    });
    await syncWorkbenchRemote({ dir: root, authToken: "test-token" });

    expect(putPacks.length).toBeGreaterThan(0);
    expect(putPacks.every((pack) =>
      pack.runs.every((entry) => entry.id !== run.id) &&
      pack.jobs.every((entry) => entry.id !== job.id)
    )).toBe(true);
    const after = await createWorkbenchInspectionSnapshot({ dir: root });
    expect(after.runs.find((entry) => entry.id === run.id)).toMatchObject({
      status: "running",
      traceIds: [],
    });
    expect(after.jobs.find((entry) => entry.id === job.id)).toMatchObject({
      status: "running",
      traceIds: [],
    });
  });

  test("syncs and publishes through an HTTP Workbench remote", async () => {
    const root = await makeTempRoot("workbench-http-remote-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await addWorkbenchRemote("origin", "https://cloud.test/skills/alice/http-skill", { dir: root });
    let storedState: WorkbenchProjectState | null = null;
    let visibility = "private";
    const putBodies: Array<{ objectPack: ReturnType<typeof exportObjectPack>; publishVersionId?: string; visibility?: "private" | "internal" | "public" }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = init?.method ?? "GET";
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return Response.json({
          skills: storedState
            ? [{ id: "skill_http", ownerSlug: "alice", name: "http-skill" }]
            : [],
        });
      }
      if (url.pathname === "/api/workbench/skills" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { name?: string; ownerSlug?: string; state: WorkbenchProjectState };
        expect(body.name).toBe("http-skill");
        expect(body.ownerSlug).toBe("alice");
        expect(body.state.remotes).toEqual({});
        expect(Object.keys(body.state.refs).filter((name) => name.startsWith("remotes/"))).toEqual([]);
        expect(body.state.refs.published).toBeUndefined();
        storedState = body.state;
        return Response.json({
          skill: { id: "skill_http", ownerSlug: "alice", name: "http-skill" },
        }, { status: 201 });
      }
      if (url.pathname === "/api/workbench/skills/skill_http/objects" && method === "GET") {
        if (!storedState) {
          return Response.json({ message: "not found" }, { status: 404 });
        }
        return Response.json({ state: storedState, objectPack: exportObjectPack(storedState) });
      }
      if (url.pathname === "/api/workbench/skills/skill_http/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack: ReturnType<typeof exportObjectPack>; publishVersionId?: string; visibility?: "private" | "internal" | "public" };
        putBodies.push(body);
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
          executionEvents: [],
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
          nextState.refs["publication/install-handle"] = "alice/http-skill";
          visibility = body.visibility ?? visibility;
        }
        storedState = nextState;
        return Response.json({ skill: { id: "skill_http", visibility } });
      }
      throw new Error(`Unexpected fetch ${method} ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const synced = await syncWorkbenchRemote({ dir: root, authToken: "test-token" });
    expect(synced.pushed).toBeGreaterThan(0);
    const currentVersionId = (await workbenchStatus({ dir: root })).currentVersionId!;
    expect(storedState?.versions.map((version) => version.id)).toEqual([currentVersionId]);
    const syncedSnapshot = await createWorkbenchInspectionSnapshot({ dir: root, authToken: "test-token" });
    expect(syncedSnapshot.refs.current).toBe(currentVersionId);
    expect(syncedSnapshot.refs["remotes/origin/current"]).toBeUndefined();
    expect(storedState?.refs.current).toBeUndefined();
    expect(storedState?.refs["remotes/origin/current"]).toBeUndefined();
    const statusAfterSync = await workbenchStatusSnapshot({ dir: root, authToken: "test-token" });
    expect(statusAfterSync.next).toBeNull();

    const published = await publishWorkbenchVersion({
      dir: root,
      visibility: "private",
      authToken: "test-token",
    });
    expect(published.version.id).toBe(currentVersionId);
    expect(published.visibility).toBe("private");
    expect(published.installHandle).toBe("alice/http-skill");
    expect(published).not.toHaveProperty("installUrl");
    expect(published).not.toHaveProperty("pinnedInstallUrl");
    const privatePublishPut = [...putBodies].reverse()
      .find((body) => body.publishVersionId === currentVersionId && body.visibility === "private");
    expect(privatePublishPut?.objectPack.versions).toHaveLength(0);
    expect(privatePublishPut?.objectPack.skillBundles).toHaveLength(0);
    expect(privatePublishPut?.objectPack.runs).toHaveLength(0);
    expect(visibility).toBe("private");
    expect(storedState?.refs.published).toBe(currentVersionId);
    expect(storedState?.refs[`releases/${currentVersionId}`]).toBe(currentVersionId);
    expect(storedState?.refs["publication/install-handle"]).toBe("alice/http-skill");
    const privateSnapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    expect(privateSnapshot.publication).toMatchObject({
      versionId: currentVersionId,
      installHandle: "alice/http-skill",
    });
    expect(privateSnapshot.refs["remotes/origin/published"]).toBe(currentVersionId);
    expect(privateSnapshot.refs[`remotes/origin/releases/${currentVersionId}`]).toBe(currentVersionId);
    expect(privateSnapshot.refs["remotes/origin/publication/install-handle"])
      .toBe("alice/http-skill");

    const publicPublished = await publishWorkbenchVersion({
      dir: root,
      visibility: "public",
      authToken: "test-token",
    });
    expect(publicPublished.visibility).toBe("public");
    expect(publicPublished.installHandle).toBe("alice/http-skill");
    expect(publicPublished).not.toHaveProperty("installUrl");
    expect(publicPublished).not.toHaveProperty("pinnedInstallUrl");
    expect(visibility).toBe("public");
    const publicPublicationSnapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    expect(publicPublicationSnapshot.publication).toMatchObject({
      versionId: currentVersionId,
      installHandle: "alice/http-skill",
    });
    expect(publicPublicationSnapshot.refs["remotes/origin/publication/install-handle"])
      .toBe("alice/http-skill");
    expect(publicPublicationSnapshot.refs["publication/visibility"]).toBe("public");
    expect(publicPublicationSnapshot.refs["remotes/origin/publication/visibility"]).toBe("public");

    const barePublished = await publishWorkbenchVersion({
      dir: root,
      authToken: "test-token",
    });
    expect(barePublished.visibility).toBe("public");
    const barePublishPut = [...putBodies].reverse()
      .find((body) => body.publishVersionId === currentVersionId);
    expect(barePublishPut?.visibility).toBe("public");
    expect(visibility).toBe("public");
    const statusAfterPublish = await workbenchStatusSnapshot({ dir: root, authToken: "test-token" });
    expect(statusAfterPublish.next).toBeNull();
  });

  test("retries retryable HTTP Workbench object writes", async () => {
    const root = await makeTempRoot("workbench-http-retry-put-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await addWorkbenchRemote("origin", "https://cloud.test/skills/alice/http-skill", { dir: root });
    let putCalls = 0;
    let storedState: WorkbenchProjectState = {
      schema: "workbench.skill.state.v1",
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
      executionEvents: [],
      artifacts: [],
      lineage: [],
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return Response.json({ skills: [{ id: "skill_http", ownerSlug: "alice", name: "http-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_http/objects" && method === "GET") {
        return Response.json({ objectPack: exportObjectPack(storedState) });
      }
      if (url.pathname === "/api/workbench/skills/skill_http/objects" && method === "PUT") {
        putCalls += 1;
        if (putCalls === 1) {
          return Response.json({
            schema: "workbench.cloud.error.v1",
            code: "service_unavailable",
            message: "Workbench backend is temporarily unavailable.",
            retryable: true,
          }, { status: 503 });
        }
        const body = JSON.parse(String(init?.body)) as { objectPack: ReturnType<typeof exportObjectPack> };
        storedState = {
          ...storedState,
          refs: { ...storedState.refs, ...body.objectPack.refs },
          versions: [...storedState.versions, ...body.objectPack.versions],
          skillSources: [...storedState.skillSources, ...body.objectPack.skillSources],
          skillBundles: [...storedState.skillBundles, ...body.objectPack.skillBundles],
        };
        return Response.json({ skill: { id: "skill_http" } });
      }
      throw new Error(`Unexpected fetch ${method} ${url.pathname}`);
    }));

    const synced = await syncWorkbenchRemote({ dir: root, authToken: "test-token" });
    expect(synced.pushed).toBeGreaterThan(0);
    expect(putCalls).toBe(2);
    expect(storedState.versions).toHaveLength(1);
  });

  test("resolves HTTP Workbench owner remotes by exact namespace", async () => {
    const root = await makeTempRoot("workbench-http-remote-exact-owner-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await addWorkbenchRemote("origin", "https://cloud.test/skills/me/http-skill", { dir: root });
    let storedState: WorkbenchProjectState | null = null;
    let createdOwnerSlug: string | undefined;
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = init?.method ?? "GET";
      paths.push(`${method} ${url.pathname}`);
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return Response.json({
          skills: [{ id: "skill_alice", ownerSlug: "alice", name: "http-skill" }],
        });
      }
      if (url.pathname === "/api/workbench/skills" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { ownerSlug?: string; state: WorkbenchProjectState };
        createdOwnerSlug = body.ownerSlug;
        storedState = body.state;
        return Response.json({
          skill: { id: "skill_me", ownerSlug: "me", name: "http-skill" },
        }, { status: 201 });
      }
      if (url.pathname === "/api/workbench/skills/skill_me/objects" && method === "GET") {
        const state = storedState ?? {
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
          executionEvents: [],
          artifacts: [],
          lineage: [],
        };
        return Response.json({ state, objectPack: exportObjectPack(state) });
      }
      if (url.pathname === "/api/workbench/skills/skill_me/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack: ReturnType<typeof exportObjectPack> };
        const nextState = storedState!;
        for (const version of body.objectPack.versions) {
          nextState.versions = nextState.versions.filter((entry) => entry.id !== version.id).concat(version);
        }
        nextState.refs = { ...nextState.refs, ...body.objectPack.refs };
        storedState = nextState;
        return Response.json({ skill: { id: "skill_me" } });
      }
      throw new Error(`Unexpected fetch ${method} ${url.pathname}`);
    }));

    await syncWorkbenchRemote({ dir: root, authToken: "test-token" });

    expect(createdOwnerSlug).toBe("me");
    expect(paths).not.toContain("GET /api/workbench/skills/skill_alice/objects");
    expect(paths).not.toContain("PUT /api/workbench/skills/skill_alice/objects");
  });

  test("gzips large HTTP remote object-pack writes", async () => {
    const root = await makeTempRoot("workbench-http-remote-gzip-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await fs.writeFile(path.join(root, "large-source.txt"), "x".repeat(1024 * 1024 + 1));
    await addWorkbenchRemote("origin", "https://cloud.test/skills/alice/large-http-skill", { dir: root });
    const encodings: string[] = [];
    let putObjectPackVersionCount = 0;

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return Response.json({ skills: [] });
      }
      if (url.pathname === "/api/workbench/skills" && method === "POST") {
        const body = parseStubFetchJson(init);
        encodings.push(stubFetchHeader(init, "content-encoding") || "identity");
        expect((body.state as WorkbenchProjectState).versions.some((version) =>
          version.files.some((file) => file.path === "large-source.txt")
        )).toBe(true);
        return Response.json({
          skill: { id: "skill_large", ownerSlug: "alice", name: "large-http-skill" },
        }, { status: 201 });
      }
      if (url.pathname === "/api/workbench/skills/skill_large/objects" && method === "PUT") {
        const body = parseStubFetchJson(init) as { objectPack: ReturnType<typeof exportObjectPack> };
        encodings.push(stubFetchHeader(init, "content-encoding") || "identity");
        putObjectPackVersionCount = body.objectPack.versions.length;
        return Response.json({ skill: { id: "skill_large" } });
      }
      throw new Error(`Unexpected fetch ${method} ${url.pathname}`);
    }));

    await syncWorkbenchRemote({ dir: root, authToken: "test-token" });

    expect(encodings).toEqual(["gzip", "gzip"]);
    expect(putObjectPackVersionCount).toBeGreaterThan(0);
  });

  dockerTest("detects divergent remote objects and records pending sync failures", async () => {
    const root = await makeTempRoot("workbench-sync-conflict-");
    const remote = await makeTempRoot("workbench-sync-conflict-remote-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await writePassingCaseTest(root);
    await evalWorkbenchSkill({ dir: root });
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: root });
    await syncWorkbenchRemote({ dir: root });
    const currentVersionId = (await workbenchStatus({ dir: root })).currentVersionId!;

    const versionPath = path.join(remote, "objects", "version", `${currentVersionId}.json`);
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
    await initWorkbenchSkill({ dir: root, agent: "local" });
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

    await expect(improveWorkbenchSkill({ dir: root, agent: "patcher" }))
      .rejects.toThrow(/Improve proof eval failed/u);
    const skill = await fs.readFile(path.join(root, "SKILL.md"), "utf8");
    const snapshot = await createWorkbenchInspectionSnapshot({ dir: root });
    const proofRun = snapshot.runs.find((run) => run.kind === "improve" && run.agentName === "patcher");
    const improvedVersion = snapshot.versions.find((version) => version.id === proofRun?.outputVersionId);
    if (!proofRun || !improvedVersion) {
      throw new Error("Expected failed improve proof run and candidate version.");
    }
    const improvedSkill = improvedVersion.files.find((file) => file.path === "SKILL.md")?.content ?? "";
    const diff = await diffWorkbenchVersions(`${failingRun!.versionId}..${improvedVersion.id}`, { dir: root });
    const improveTrace = snapshot.traces.find((trace) => trace.runId === proofRun.id);

    expect(improvedVersion.parentIds).toEqual([failingRun!.versionId]);
    expect(proofRun).toMatchObject({ status: "failed", outputVersionId: improvedVersion.id });
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
      outputVersionId: improvedVersion.id,
    });
  }, 60_000);

  test("runs runtime-control operation sequences in the current runtime", async () => {
    const createdAt = new Date().toISOString();
    const progressBatches: WorkbenchProjectState["executionEvents"] = [];
    const skillCommand = nodeCommand([
      "const fs = require('node:fs');",
      "if (process.env.WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS !== '60000') throw new Error(`unexpected timeout env ${process.env.WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS}`);",
      "const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, 'utf8'));",
      "process.stdout.write('runner visible stdout\\n');",
      "process.stdout.write('__WORKBENCH_PROGRESS__' + JSON.stringify({",
      "  url: request.progress.target.url,",
      "  body: {",
      "    schema: 'workbench.remote.job.progress.v1',",
      "    leaseToken: request.progress.target.token,",
      "    batch: {",
      "      projectId: request.progress.projectId,",
      "      runId: request.progress.runId,",
      "      jobId: request.progress.jobId,",
      "      executionId: request.progress.executionId,",
      "      attempt: request.progress.attempt,",
      "      seqStart: 1,",
      "      seqEnd: 1,",
      "      emittedAt: '2026-06-09T00:00:00.000Z',",
      "      events: [{",
      "        seq: 1,",
      "        at: '2026-06-09T00:00:00.000Z',",
      "        source: 'adapter',",
      "        role: 'runner',",
      "        schema: 'workbench.execution.step.v1',",
      "        payload: { step: 'skill.run', status: 'started' },",
      "      }],",
      "    },",
      "  },",
      "}) + '\\n');",
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
      "if (process.env.WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS !== '60000') throw new Error(`unexpected timeout env ${process.env.WORKBENCH_RUNTIME_CONTROL_TIMEOUT_MS}`);",
      "const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, 'utf8'));",
      "if (request.paths.skill.endsWith('/input/skills/primary') === false) throw new Error('skill path not staged');",
      "process.stdout.write('score visible stdout\\n');",
      "process.stdout.write('__WORKBENCH_PROGRESS__' + JSON.stringify({",
      "  url: request.progress.target.url,",
      "  body: {",
      "    schema: 'workbench.remote.job.progress.v1',",
      "    leaseToken: request.progress.target.token,",
      "    batch: {",
      "      projectId: request.progress.projectId,",
      "      runId: request.progress.runId,",
      "      jobId: request.progress.jobId,",
      "      executionId: request.progress.executionId,",
      "      attempt: request.progress.attempt,",
      "      seqStart: 1,",
      "      seqEnd: 1,",
      "      emittedAt: '2026-06-09T00:00:00.000Z',",
      "      events: [{",
      "        seq: 1,",
      "        at: '2026-06-09T00:00:00.000Z',",
      "        source: 'adapter',",
      "        role: 'engine',",
      "        schema: 'workbench.execution.step.v1',",
      "        payload: { step: 'engine.run', status: 'started' },",
      "      }],",
      "    },",
      "  },",
      "}) + '\\n');",
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
      adapter: { use: "command", with: {} },
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
          engine: { use: "command", with: {} },
        },
        skill: {
          name: "skill",
          files: { path: "." },
          agents: {
            default: { name: "default", use: "command", with: {} },
          },
        },
        environment: {
          dockerfile: "docker://workbench/workbench-node-22:envv_node_22",
          resources: { cpu: 1, memoryGb: 1, diskGb: 1, timeoutMinutes: 1 },
          network: { egress: "none" },
        },
        adapters: ["command"],
        engine: { use: "command", with: {} },
        engineResolve: { use: "command", with: {} },
        run: { use: "command", with: {} },
        engineRun: { use: "command", with: {} },
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
      progress: {
        url: "http://127.0.0.1/.workbench/progress/job_runtime_control",
        token: "progress-token",
        ownerUserId: "local",
        transport: "stdout",
        appendBatch: async (batch) => {
          progressBatches.push(batch);
        },
      },
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
    expect(progressBatches).toHaveLength(2);
    expect(progressBatches.map((batch) => batch.executionId)).toEqual([
      "exec_runtime_control:runner:0",
      "exec_runtime_control:score:1",
    ]);
    const runnerStdout = output.files?.find((file) =>
      file.path === ".workbench/traces/job_runtime_control/runner/stdout.log"
    )?.content ?? "";
    const scoreStdout = output.files?.find((file) =>
      file.path === ".workbench/traces/job_runtime_control/score/stdout.log"
    )?.content ?? "";
    expect(runnerStdout).toContain("runner visible stdout");
    expect(scoreStdout).toContain("score visible stdout");
    expect(`${runnerStdout}${scoreStdout}`).not.toContain("__WORKBENCH_PROGRESS__");
    expect(`${runnerStdout}${scoreStdout}`).not.toContain("progress-token");
  });

  test("records contextual evidence for failed runtime-control steps", async () => {
    const createdAt = new Date().toISOString();
    const failingCommand = nodeCommand([
      "console.error('node:internal/modules/run_main:123');",
      "console.error('    triggerUncaughtException(');",
      "console.error('    ^');",
      "console.error('');",
      "console.error('Error: Workbench runtime-control request timed out after 1234ms.');",
      "console.error('    at runtimeControlTimeoutError (file:///workspace/runtime-control.js:122:12)');",
      "process.exit(1);",
    ]);
    const execution = {
      id: "exec_runtime_control_failure",
      projectId: "local",
      runId: "run_runtime_control_failure",
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
        id: "job_runtime_control_failure",
        projectId: "local",
        runId: "run_runtime_control_failure",
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
      baseFiles: [textFixture("primary/SKILL.md", "# Runtime Control Skill\n")],
      engineResolveFiles: [textFixture("prompt.md", "Public case.\n")],
      engineCases: [runtimeControlCase()],
      runtimeControlOperation: {
        prepare: true,
        operations: [
          {
            label: "runner",
            operation: "skill.run",
            invocation: {
              use: "codex",
              with: { model: "gpt-5.4-mini" },
              command: failingCommand,
            },
          },
        ],
      },
    }, execution, createdAt);
    const output = completed.output as {
      ok?: boolean;
      error?: string;
      files?: Array<{ path: string; content: string }>;
    };
    const errorFile = output.files?.find((file) =>
      file.path === ".workbench/traces/job_runtime_control_failure/runner/error.json"
    );
    const stderrFile = output.files?.find((file) => file.path === "stderr.log");

    expect(completed.status).toBe("failed");
    expect(completed.error).toBe("Runtime-control step runner (skill.run via codex model gpt-5.4-mini) timed out after 1234ms.");
    expect(output.ok).toBe(false);
    expect(output.error).toBe(completed.error);
    expect(stderrFile?.content).toContain(completed.error);
    expect(output.files?.map((file) => file.path)).toEqual(expect.arrayContaining([
      "stderr.log",
      "stdout.log",
      ".workbench/traces/job_runtime_control_failure/runner/request.json",
      ".workbench/traces/job_runtime_control_failure/runner/stdout.log",
      ".workbench/traces/job_runtime_control_failure/runner/stderr.log",
      ".workbench/traces/job_runtime_control_failure/runner/error.json",
    ]));
    expect(JSON.parse(errorFile?.content ?? "{}")).toMatchObject({
      label: "runner",
      operation: "skill.run",
      adapter: "codex",
      model: "gpt-5.4-mini",
      status: 1,
      error: "Runtime-control step runner (skill.run via codex model gpt-5.4-mini) timed out after 1234ms.",
    });
  });

  test("summarizes plain provider Error lines before Node uncaught frames", async () => {
    const createdAt = new Date().toISOString();
    const failingCommand = nodeCommand([
      "console.error('node:internal/modules/run_main:123');",
      "console.error('    triggerUncaughtException(');",
      "console.error('    ^');",
      "console.error('');",
      "console.error('Error: Quota exceeded. Check your plan and billing details.');",
      "console.error('    at CodexHarnessAdapter.handleLine (file:///workspace/index.js:1030:45)');",
      "process.exit(1);",
    ]);
    const execution = {
      id: "exec_runtime_control_plain_error",
      projectId: "local",
      runId: "run_runtime_control_plain_error",
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
        id: "job_runtime_control_plain_error",
        projectId: "local",
        runId: "run_runtime_control_plain_error",
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
      baseFiles: [textFixture("primary/SKILL.md", "# Runtime Control Skill\n")],
      engineResolveFiles: [textFixture("prompt.md", "Public case.\n")],
      engineCases: [runtimeControlCase()],
      runtimeControlOperation: {
        prepare: true,
        operations: [
          {
            label: "runner",
            operation: "skill.run",
            invocation: {
              use: "codex",
              with: { model: "gpt-5.4-mini" },
              command: failingCommand,
            },
          },
        ],
      },
    }, execution, createdAt);
    const output = completed.output as {
      ok?: boolean;
      error?: string;
      files?: Array<{ path: string; content: string }>;
    };
    const stderrFile = output.files?.find((file) => file.path === "stderr.log");

    expect(completed.status).toBe("failed");
    expect(completed.error).toBe("Runtime-control step runner (skill.run via codex model gpt-5.4-mini) exited with status 1: Error: Quota exceeded. Check your plan and billing details.");
    expect(completed.error).not.toContain("triggerUncaughtException");
    expect(output.ok).toBe(false);
    expect(output.error).toBe(completed.error);
    expect(stderrFile?.content).toContain(completed.error);
    expect(stderrFile?.content).not.toContain("triggerUncaughtException");
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

  test("closes dangling runtime-control callback sockets when host adapters fail", async () => {
    const createdAt = new Date().toISOString();
    const childScript = [
      "const fs = require('node:fs');",
      "const http = require('node:http');",
      "const marker = `${process.env.WORKBENCH_OUTPUT}/callback-started.txt`;",
      "const endpoint = new URL('/v1/operation-sequence', process.env.WORKBENCH_RUNTIME_CONTROL_URL);",
      "const body = JSON.stringify({ operations: [{ label: 'skill', operation: 'skill.run', invocation: { use: 'command', with: {} } }] });",
      "const outgoing = http.request(endpoint, {",
      "  method: 'POST',",
      "  headers: { authorization: `Bearer ${process.env.WORKBENCH_RUNTIME_CONTROL_TOKEN}`, 'content-type': 'application/json' }",
      "});",
      "outgoing.on('socket', () => fs.writeFileSync(marker, 'ready\\n'));",
      "outgoing.on('error', () => process.exit(0));",
      "outgoing.write(body.slice(0, Math.max(1, body.length - 1)));",
      "setTimeout(() => process.exit(0), 5000);",
    ].join("\n");
    const hostCommand = nodeCommand([
      "const fs = require('node:fs');",
      "const { spawn } = require('node:child_process');",
      "const marker = `${process.env.WORKBENCH_OUTPUT}/callback-started.txt`;",
      `const childScript = ${JSON.stringify(childScript)};`,
      "const child = spawn(process.execPath, ['-e', childScript], { detached: true, stdio: 'ignore', env: process.env });",
      "child.unref();",
      "const waitUntil = Date.now() + 5000;",
      "const sab = new SharedArrayBuffer(4);",
      "const view = new Int32Array(sab);",
      "while (!fs.existsSync(marker) && Date.now() < waitUntil) Atomics.wait(view, 0, 0, 50);",
      "console.error('host failed with dangling callback');",
      "process.exit(42);",
    ]);
    const execution = {
      id: "exec_host_runtime_control_dangling",
      projectId: "local",
      runId: "run_host_runtime_control_dangling",
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
        id: "job_host_runtime_control_dangling",
        projectId: "local",
        runId: "run_host_runtime_control_dangling",
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
      createSandboxPlaneForBackend: (_backend, runtimeArgs) => fakeRuntimeControlPlane(runtimeArgs, []),
    });
    const output = completed.output as {
      ok?: boolean;
      error?: string;
      files?: Array<{ path: string; content: string }>;
    };

    expect(completed.status).toBe("failed");
    expect(completed.error).toContain("Runtime-control step host (engine.run via host-engine) exited with status 42: host failed with dangling callback");
    expect(output.ok).toBe(false);
    expect(output.files?.map((file) => file.path)).toEqual(expect.arrayContaining([
      "stderr.log",
      "stdout.log",
      "callback-started.txt",
      ".workbench/traces/job_host_runtime_control_dangling/host/stderr.log",
      ".workbench/traces/job_host_runtime_control_dangling/host/error.json",
    ]));
  }, 10_000);

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

  test("plans provider-backed agent execution through direct score adapters", () => {
    const createdAt = new Date().toISOString();
    const input = createWorkbenchSkillEvalRuntimeInput({
      ownerUserId: "local",
      projectId: "local",
      runId: "run_provider",
      jobId: "job_provider",
      versionId: "v001",
      evalHash: "eval_hash",
      evalSnapshot: evalFixture({
        hash: "eval_hash",
        files: [
          textFixture("eval.yaml", "version: 1\nname: provider\ndescription: Provider eval.\n"),
        ],
      }),
      agent: {
        name: "codex",
        adapter: "codex",
        model: "gpt-5.4-mini",
        config: {
          auth: "default",
          instructions: "Run the skill against the case.",
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
      auth: "default",
      with: {
        model: "gpt-5.4-mini",
        instructions: "Run the skill against the case.",
      },
    });
    expect(input.spec.run.with).not.toHaveProperty("network");
    expect(input.spec.environment.network).toEqual({ egress: "open" });
    expect(input.spec.engineRun).toMatchObject({
      use: "tests",
    });
    expect(input.adapterManifests?.map((manifest) => manifest.id).sort()).toEqual(["codex", "tests"]);
    expect(input.environmentDockerfile).toContain("npm install --global @openai/codex@0.125.0");
    expect(input.environmentVersion?.sourceHash).toBeDefined();
    expect(input.environmentVersion?.spec.network).toBe("on");
    expect(input.engineCases[0]?.case.prompt).toBe("Produce a concise result.");
    expect(input.engineResolveFiles.map((file) => file.path)).toEqual(["fixture.txt"]);
    expect(input.engineCases[0]?.files.private?.map((file) => file.path)).toEqual(["test.sh"]);
    expect(requiredWorkbenchAdapterAuthTargetsForRuntimeInput(input)).toEqual([
      { adapterId: "codex", profile: "default" },
    ]);
    expect(requiredWorkbenchAdapterAuthTargetsForRuntimeInput({
      ...input,
      runtimeControlOperation: {
        operations: [{
          label: "host",
          operation: "engine.run",
          invocation: {
            use: "tests",
            with: input.spec.engineRun.with,
          },
        }],
      },
    })).toEqual([
      { adapterId: "codex", profile: "default" },
    ]);
    const claudeInput = createWorkbenchSkillEvalRuntimeInput({
      ownerUserId: "local",
      projectId: "local",
      runId: "run_provider_claude",
      jobId: "job_provider_claude",
      versionId: "v001",
      evalHash: "eval_hash",
      evalSnapshot: evalFixture({
        hash: "eval_hash",
        files: [
          textFixture("eval.yaml", "version: 1\nname: provider\ndescription: Provider eval.\n"),
        ],
      }),
      agent: {
        name: "claude",
        adapter: "claude",
        model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        config: { auth: "default" },
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
    expect(requiredWorkbenchAdapterAuthTargetsForRuntimeInput({
      ...claudeInput,
      runtimeControlOperation: {
        operations: [{
          label: "host",
          operation: "engine.run",
          invocation: {
            use: "tests",
            with: claudeInput.spec.engineRun.with,
          },
        }],
      },
    })).toEqual([
      { adapterId: "claude", profile: "default" },
    ]);
    expect(execution?.adapter?.use).toBe("tests");
    expect(execution?.metadata).toMatchObject({
      skillEval: true,
      agentName: "codex",
      agentAdapter: "codex",
      executionAdapter: "codex",
    });
  });

  test("plans explicit later eval samples for multi-sample runs", () => {
    const createdAt = new Date().toISOString();
    for (const sample of [1, 4]) {
      const input = createWorkbenchSkillEvalRuntimeInput({
        ownerUserId: "local",
        projectId: "local",
        runId: `run_sample_${sample}`,
        jobId: `job_sample_${sample}`,
        versionId: "v001",
        evalHash: "eval_hash",
        evalSnapshot: evalFixture({
          hash: "eval_hash",
          files: [
            textFixture("eval.yaml", "version: 1\nname: samples\ndescription: Multi-sample eval.\nscore:\n  adapter: tests\n"),
          ],
        }),
        agent: {
          name: "default",
          adapter: "local",
          config: {},
        },
        skillName: "primary",
        skillBundleHash: "skill_bundle_hash",
        versionFiles: [textFixture("SKILL.md", "# Sample Skill\n")],
        runtimeCase: {
          id: "case-001",
          path: "case-001",
          content: "version: 1\nid: case-001\nprompt: Exercise sample planning.\n",
          files: [
            textFixture("case.yaml", "version: 1\nid: case-001\nprompt: Exercise sample planning.\n"),
            textFixture("tests/test.sh", "exit 0\n"),
          ],
        },
        sample,
        createdAt,
      });
      const execution = (input.job.input as { execution?: { metadata?: { sampleIndex?: number } } }).execution;
      expect(execution?.metadata?.sampleIndex).toBe(sample);
      expect(input.job.input).toMatchObject({ sampleIndex: sample });
    }
  });

  dockerTest("persists multi-sample eval jobs without racing state commits", async () => {
    const root = await makeTempRoot("workbench-samples-persist-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await writePassingCaseTest(root);

    const [run] = await evalWorkbenchSkill({ dir: root, samples: 5 });

    expect(run?.status).toBe("succeeded");
    expect(run?.jobIds).toHaveLength(5);
    expect(run?.traceIds).toHaveLength(5);
    await expect(listWorkbenchVersions({ dir: root })).resolves.toHaveLength(2);
  }, 15_000);

  test("rejects provider-backed skill eval agents with explicit isolated network", () => {
    expect(() => createWorkbenchSkillEvalRuntimeInput({
      ownerUserId: "local",
      projectId: "local",
      runId: "run_provider_isolated",
      jobId: "job_provider_isolated",
      versionId: "v001",
      evalHash: "eval_hash",
      evalSnapshot: evalFixture({
        hash: "eval_hash",
        files: [
          textFixture("eval.yaml", "version: 1\nname: provider\ndescription: Provider eval.\n"),
        ],
      }),
      agent: {
        name: "codex",
        adapter: "codex",
        model: "gpt-5.4-mini",
        config: {
          auth: "default",
          network: "off",
        },
      },
      skillName: "primary",
      skillBundleHash: "skill_bundle_hash",
      versionFiles: [textFixture("primary/SKILL.md", "# Provider Skill\n")],
      runtimeCase: {
        id: "case-001",
        path: "case-001",
        content: "version: 1\nid: case-001\nprompt: Produce a concise result.\n",
        files: [
          textFixture("case.yaml", "version: 1\nid: case-001\nprompt: Produce a concise result.\n"),
        ],
      },
      sample: 0,
      createdAt: new Date().toISOString(),
    })).toThrow("requires network egress");
  });

  test("plans provider-backed rubric scoring from the skill eval spec", () => {
    const input = createWorkbenchSkillEvalRuntimeInput({
      ownerUserId: "local",
      projectId: "local",
      runId: "run_rubric",
      jobId: "job_rubric",
      versionId: "v001",
      evalHash: "eval_hash",
      evalSnapshot: evalFixture({
        hash: "eval_hash",
        scoreAdapter: "rubric",
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
      }),
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
    });
    expect(input.adapterManifests?.map((manifest) => manifest.id).sort()).toEqual(["claude", "rubric"]);
    expect(input.environmentDockerfile).toContain("FROM workbench/workbench-node-22:envv_node_22");
    expect(input.environmentDockerfile).toContain("ca-certificates");
    expect(input.environmentDockerfile).toContain("npm install --global @anthropic-ai/claude-code@2.1.119");
    expect(input.environmentVersion?.sourceHash).toBeDefined();
    expect(input.spec.environment.dockerfile).toMatch(/^dockerfile:\/\//u);
    expect(input.engineCases[0]?.case.prompt).toBe("Produce a concise result.");
    expect(input.engineCases[0]?.case.prompt).not.toContain("rubric");
    expect(input.engineCases[0]?.case.prompt).not.toContain("Writes a reviewable output");
    expect(input.engineCases[0]?.files.private?.map((file) => file.path)).toEqual([]);
  });

  dockerTest("fails provider-backed skill evals through adapter auth when disconnected", async () => {
    const root = await makeTempRoot("workbench-skill-adapter-");
    await initWorkbenchSkill({ dir: root, agent: "local" });
    await writePassingCaseTest(root);
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
      engine: { use: "command", with: {} },
    },
    skill: {
      name: "skill",
      files: { path: "." },
      agents: {
        default: { name: "default", use: "command", with: {} },
      },
    },
    environment: {
      dockerfile: "docker://workbench/workbench-node-22:envv_node_22",
      resources: { cpu: 1, memoryGb: 1, diskGb: 1, timeoutMinutes: 1 },
      network: { egress: "none" },
    },
    adapters: ["command"],
    engine: { use: "command", with: {} },
    engineResolve: { use: "command", with: {} },
    run: { use: "command", with: {} },
    engineRun: { use: "command", with: {} },
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
    result: { status: "failed", score: 0, error: "failed" },
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

function evalFixture(
  overrides: Partial<WorkbenchProjectState["evals"][number]> = {},
): WorkbenchProjectState["evals"][number] {
  return {
    hash: "eval_hash",
    files: [],
    caseCount: 1,
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    scoreAdapter: "tests",
    ...overrides,
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
    refs: { current: "v001" },
    remotes: {},
    versions: [{
      id: "v001",
      hash: "version_hash",
      message: "initial",
      parentIds: [],
      createdAt: "2026-06-08T00:00:00.000Z",
      files: versionFiles,
    }],
    evals: [evalFixture({
      hash: hashFiles(evalFiles),
      files: evalFiles,
    })],
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
    executionEvents: [],
    artifacts: [],
    lineage: [],
  };
}

async function writeFailingCaseTest(root: string, message: string): Promise<void> {
  await fs.mkdir(path.join(root, ".workbench", "cases", "case-001", "tests"), { recursive: true });
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
    `printf '{"ok":false,"score":0,"metrics":{"score":0},"message":%s}\\n' ${shellQuote(JSON.stringify(message))} > "$OUTPUT_DIR/result.json"`,
    "exit 0",
    "",
  ].join("\n"));
  await fs.chmod(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), 0o755);
}

async function writePassingCaseTest(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".workbench", "cases", "case-001", "tests"), { recursive: true });
  await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "case.yaml"), [
    "version: 1",
    "id: case-001",
    "prompt: Exercise a workflow-specific success path.",
    "rubric:",
    "  - Captures workflow-specific success evidence.",
    "command: sh \"$CASE_DIR/tests/test.sh\"",
    "",
  ].join("\n"));
  await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), [
    "#!/bin/sh",
    "set -eu",
    "mkdir -p \"$OUTPUT_DIR\"",
    "printf '{\"ok\":true,\"score\":1,\"metrics\":{\"score\":1}}\\n' > \"$OUTPUT_DIR/result.json\"",
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

function scoreCommand(score: number): string {
  return nodeCommand([
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });",
    `fs.writeFileSync(path.join(process.env.OUTPUT_DIR, 'result.json'), ${JSON.stringify(JSON.stringify({ ok: true, score }) + "\n")});`,
  ]);
}

async function waitForValue<T>(
  read: () => Promise<T | null | undefined>,
  timeoutMs: number,
): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await read();
      if (value !== null && value !== undefined) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for expected value.${suffix}`);
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
