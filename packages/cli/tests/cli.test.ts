import { Writable } from "node:stream";
import { spawn, spawnSync } from "node:child_process";
import { get } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  normalizeWorkbenchSkillName,
  workbenchCaseFileOwnerId,
} from "@workbench-ai/workbench-contract";
import {
  addWorkbenchRemote,
  createWorkbenchVersionRuntimeSnapshot,
  createWorkbenchReadOnlyInspectionSnapshot,
  hashFiles,
  hashJson,
  prepareWorkbenchCloudEvalRequest,
  recordWorkbenchLocalHostedRunHandle,
  withWorkbenchProjectLock,
  workbenchStatus,
  WORKBENCH_AUTHOR_EVAL_CASE_COMMAND,
  type WorkbenchJob,
  type WorkbenchPreparedCloudEvalRequest,
  type WorkbenchRun,
} from "@workbench-ai/workbench-core";
import { runCli } from "../src/index.ts";
import { startWorkbenchOpenServer } from "../src/open-server.ts";

class MemoryWritable extends Writable {
  value = "";

  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.value += String(chunk);
    callback();
  }
}

async function invoke(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout = new MemoryWritable();
  const stderr = new MemoryWritable();
  const code = await runCli(args, { stdout, stderr });
  return { code, stdout: stdout.value, stderr: stderr.value };
}

async function invokeChild(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn("pnpm", [
    "exec",
    "tsx",
    "--eval",
    "import { runCli } from './src/index.ts'; void (async () => { process.exitCode = await runCli(process.argv.slice(1)); })();",
    "--",
    ...args,
  ], {
    cwd: path.join(import.meta.dirname, ".."),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  return {
    code,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function stdoutJson<T = Record<string, unknown>>(result: { stdout: string }): T {
  return JSON.parse(result.stdout) as T;
}

function stderrJsonLines<T = Record<string, unknown>>(result: { stderr: string }): T[] {
  return result.stderr.trim()
    ? result.stderr.trim().split("\n").map((line) => JSON.parse(line) as T)
    : [];
}

function runSnapshotFixture(run: WorkbenchRun, jobs: readonly WorkbenchJob[] = []): Record<string, unknown> {
  const runJobs = jobs.filter((job) => job.runId === run.id && job.caseId !== "current");
  const completed = runJobs.filter((job) =>
    job.status === "succeeded" || job.status === "failed" || job.status === "canceled"
  );
  const scored = runJobs.filter((job) => typeof job.score === "number");
  return {
    schema: "workbench.run.v1",
    id: run.id,
    kind: run.kind,
    variant: run.location ?? "cloud",
    status: run.status,
    phase: run.status === "queued"
      ? "queued"
      : run.status === "running"
        ? run.kind === "improve" ? "improving" : "running"
        : "complete",
    plan: {
      kind: run.kind === "improve" ? "improve" : "eval",
      variant: run.location ?? "cloud",
      versionId: run.versionId,
      evalHash: run.evalHash,
      skills: [run.skillName],
      agents: [run.agentName],
      ...(run.requestedSamples !== undefined ? { samples: run.requestedSamples } : {}),
      ...(run.requestedBudget !== undefined ? { budget: run.requestedBudget } : {}),
      ...(run.retryOfRunId ? { retryOfRunId: run.retryOfRunId } : {}),
    },
    progress: {
      planned: runJobs.length || run.jobIds?.length || 0,
      completed: completed.length,
      scored: scored.length,
      failed: runJobs.filter((job) => job.status === "failed").length,
      canceled: runJobs.filter((job) => job.status === "canceled").length,
      ...(run.status !== "succeeded" && run.score !== undefined ? { partialScore: run.score } : {}),
      evidenceCount: run.traceIds.length + (run.jobIds?.length ?? 0),
      ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
      elapsedMs: 0,
      lastProgressAt: run.lastProgressAt ?? run.finishedAt ?? run.createdAt,
    },
    measurements: [{
      versionId: run.versionId,
      skillName: run.skillName,
      skillBundleHash: run.skillBundleHash,
      evalHash: run.evalHash,
      agentName: run.agentName,
      agentHash: run.agentHash,
      runId: run.id,
      status: run.status,
      ...(run.score !== undefined ? { score: run.score } : {}),
      ...(run.requestedSamples !== undefined ? { samples: run.requestedSamples } : {}),
      ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
      ...(run.latencyMs !== undefined ? { latencyMs: run.latencyMs } : {}),
      ...(run.error ? { error: run.error } : {}),
    }],
    ...(run.score !== undefined || run.outputVersionId || run.error ? {
      result: {
        ...(run.score !== undefined ? { score: run.score } : {}),
        ...(run.outputVersionId ? { improvedVersionId: run.outputVersionId } : {}),
        ...(run.error ? { error: run.error } : {}),
      },
    } : {}),
    ...(run.retryOfRunId ? { retryOfRunId: run.retryOfRunId } : {}),
    route: {
      kind: "run",
      runId: run.id,
      source: run.kind === "eval" ? "evaluation" : "runs",
      evaluationId: run.evalHash,
    },
    cliEquivalent: run.kind === "improve" ? "workbench improve --cloud" : "workbench eval --cloud",
    next: run.status === "queued" || run.status === "running"
      ? `workbench run watch ${run.id}`
      : run.status === "failed" || run.status === "canceled"
        ? `workbench show ${run.id}`
        : run.kind === "improve" ? "workbench eval --rerun -n 5" : "workbench results",
  };
}

function requestRunId(body: Record<string, unknown>): string {
  expect(body.runId).toEqual(expect.stringMatching(/^run_/u));
  return body.runId as string;
}

function withRunId<T extends { id: string }>(run: T, runId: string): T {
  return { ...run, id: runId };
}

function withJobRunId<T extends { runId: string }>(job: T, runId: string): T {
  return { ...job, runId };
}

function withTraceRunId<T extends { runId: string }>(trace: T, runId: string): T {
  return { ...trace, runId };
}

function expectedLocalSkillLabel(root: string, ordinal: number): string {
  return `${path.basename(root).toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, "") || "skill"} v${ordinal}`;
}

const hasDocker = spawnSync("docker", ["info"], { encoding: "utf8" }).status === 0;
const dockerTest = hasDocker ? test : test.skip;
const tempRoots: string[] = [];
const privateSkillMarkdown = [
  "---",
  "name: private-skill",
  "description: Private skill fixture.",
  "---",
  "# Private Skill",
  "",
].join("\n");
const updatedPrivateSkillMarkdown = [
  "---",
  "name: private-skill",
  "description: Private skill fixture.",
  "---",
  "# Private Skill",
  "",
  "Updated release.",
  "",
].join("\n");

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function expectNoInstallFanout(homeRoot: string): Promise<void> {
  for (const directoryName of [".claude", ".qwen", ".trae", ".continue", ".codeium", ".tabnine"]) {
    await expect(fs.stat(path.join(homeRoot, directoryName))).rejects.toMatchObject({ code: "ENOENT" });
  }
}

function stubNoCurrentSkillAccessAgent(): void {
  for (const key of [
    "WORKBENCH_CURRENT_AGENT",
    "CODEX_SHELL",
    "CODEX_THREAD_ID",
    "CODEX_HOME",
    "CODEX_CI",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
  ]) {
    vi.stubEnv(key, "");
  }
}

async function writeFileRemoteNamedCloud(root: string, prefix: string): Promise<string> {
  const remoteRoot = await makeTempRoot(prefix);
  const remoteUrl = pathToFileURL(remoteRoot).toString();
  await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
    "schema: workbench.remotes.v1",
    "remotes:",
    "  cloud:",
    `    url: ${remoteUrl}`,
    "    kind: file",
    "",
  ].join("\n"));
  return remoteUrl;
}

async function writeRef(root: string, name: string, value: string): Promise<void> {
  const refPath = path.join(root, ".workbench", "refs", ...name.split("/"));
  await fs.mkdir(path.dirname(refPath), { recursive: true });
  await fs.writeFile(refPath, `${value}\n`);
}

async function currentVersionIdFor(root: string): Promise<string> {
  const status = await workbenchStatus({ dir: root });
  if (!status.currentVersionId) {
    throw new Error(`Expected current version id for ${root}.`);
  }
  return status.currentVersionId;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  ));
});

describe("workbench skill-first CLI", () => {
  test("keeps default and command help on the final surface", async () => {
    const help = await invoke(["help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("workbench new");
    expect(help.stdout).toContain("workbench eval");
    expect(help.stdout).toContain("workbench improve");
    expect(help.stdout).toContain("workbench results");
    expect(help.stdout).toContain("workbench publish");
    expect(help.stdout).toContain("workbench publish [VERSION] [--as OWNER/SKILL] [--private|--team|--public] [--dry-run] [--dir DIR] [--json]");
    expect(help.stdout).toContain("workbench install");
    expect(help.stdout).toContain("Taught lifecycle commands:");
    expect(help.stdout).not.toContain("Taught commands:");
    expect(help.stdout).toContain("Other common commands:");
    expect(help.stdout).toContain("workbench install OWNER/SKILL[@VERSION]|URL");
    expect(help.stdout).toContain("workbench clone OWNER/SKILL[@VERSION]|URL DIR");
    expect(help.stdout).toContain("workbench run watch RUN_ID");
    expect(help.stdout).toContain("workbench run cancel RUN_ID");
    expect(help.stdout).toContain("workbench run retry RUN_ID");
    expect(help.stdout).toContain("workbench help --all");
    expect(help.stdout).not.toContain("workbench log");
    expect(help.stdout).not.toContain("workbench show");
    expect(help.stdout).not.toContain("workbench open");

    for (const command of ["results", "diff", "open", "agent"]) {
      const commandHelp = await invoke(["help", command]);
      expect(commandHelp.code).toBe(0);
      expect(commandHelp.stdout).toContain(`workbench ${command}`);
      expect(commandHelp.stdout).not.toBe(help.stdout);
    }
    const loginHelp = await invoke(["login", "--help"]);
    expect(loginHelp.code).toBe(0);
    expect(loginHelp.stdout).toContain("--profile-root DIR");
    expect(loginHelp.stdout).toContain("Codex reads DIR/.codex/auth.json");
    expect(loginHelp.stdout).toContain("Claude reads DIR/.claude.json plus CLAUDE_CODE_OAUTH_TOKEN");

    const deletedSourceFlag = `--${"source"}`;
    const helpWithDeletedFlag = await invoke(["help", deletedSourceFlag, "old", "--json"]);
    expect(helpWithDeletedFlag.code).toBe(2);
    expect(stdoutJson(helpWithDeletedFlag)).toMatchObject({
      ok: false,
      code: "usage",
      message: `Unsupported flag ${deletedSourceFlag} for workbench help.`,
    });

    const commandHelpWithDeletedFlag = await invoke(["eval", "--help", deletedSourceFlag, "old", "--json"]);
    expect(commandHelpWithDeletedFlag.code).toBe(2);
    expect(stdoutJson(commandHelpWithDeletedFlag)).toMatchObject({
      ok: false,
      code: "usage",
      message: `Unsupported flag ${deletedSourceFlag} for workbench eval.`,
    });

    const helpWithUnknownFlag = await invoke(["help", "--bogus", "--json"]);
    expect(helpWithUnknownFlag.code).toBe(2);
    expect(stdoutJson(helpWithUnknownFlag)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --bogus for workbench help.",
    });

    const allHelp = await invoke(["help", "--all"]);
    expect(allHelp.stdout).toContain("workbench run watch RUN_ID");
    expect(allHelp.stdout).toContain("workbench run cancel RUN_ID");
    expect(allHelp.stdout).toContain("workbench run retry RUN_ID");
    const runHelp = await invoke(["run", "--help"]);
    expect(runHelp.stdout).toContain("workbench run watch RUN_ID");
  });

  test("status in a fresh directory suggests initializing the current directory", async () => {
    vi.stubEnv("HOME", await makeTempRoot("workbench-cli-fresh-status-home-"));
    stubNoCurrentSkillAccessAgent();
    const root = await makeTempRoot("workbench-cli-fresh-status-");
    const status = await invoke(["status", "--dir", root, "--json"]);
    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(stdoutJson(status)).toMatchObject({
      project: { initialized: false },
      machine: {
        installedSkillCount: 0,
        targets: [],
      },
      next: "workbench new .",
    });
    const human = await invoke(["status", "--dir", root]);
    expect(human.code, human.stdout || human.stderr).toBe(0);
    expect(human.stdout).toContain("next: workbench new .");
  });

  test("human list commands render aligned tables", async () => {
    const root = await makeTempRoot("workbench-cli-human-tables-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);

    const versions = await invoke(["versions", "--dir", root]);
    expect(versions.code, versions.stdout || versions.stderr).toBe(0);
    expect(versions.stdout).toMatch(/^version\s+hash\s+message/mu);
    expect(versions.stdout).not.toContain("\t");

    const agents = await invoke(["agent", "list", "--dir", root]);
    expect(agents.code, agents.stdout || agents.stderr).toBe(0);
    expect(agents.stdout).toMatch(/^name\s+adapter\s+model/mu);
    expect(agents.stdout).toMatch(/\bdefault\s+local\s+docker\b/u);
    expect(agents.stdout).not.toContain("\t");

    const log = await invoke(["log", "--dir", root]);
    expect(log.code, log.stdout || log.stderr).toBe(0);
    expect(log.stdout).toMatch(/^created\s+kind\s+ref\s+status\s+version\s+skill\s+agent\s+score\s+detail/mu);
    expect(log.stdout).not.toContain("\t");
  });

  test("eval dry-run previews the selected plan without creating run evidence", async () => {
    const root = await makeTempRoot("workbench-cli-eval-dry-run-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    const currentVersionId = await currentVersionIdFor(root);

    const dryRun = await invoke(["eval", "--dry-run", "--dir", root, "--json"]);
    expect(dryRun.code, dryRun.stdout || dryRun.stderr).toBe(0);
    expect(stdoutJson(dryRun)).toMatchObject({
      schema: "workbench.cli.eval-plan.v1",
      ok: true,
      dryRun: true,
      plan: {
        dryRun: true,
        location: "local",
        versionId: currentVersionId,
        cases: 1,
        samples: 1,
        cachedRunIds: [],
        readiness: {
          ready: true,
          issues: [],
        },
      },
      readiness: {
        ready: true,
        issues: [],
      },
      next: "workbench eval",
    });

    const runs = await invoke(["log", "--runs", "--dir", root, "--json"]);
    expect(stdoutJson<{ entries: unknown[] }>(runs).entries).toEqual([]);

    const seeded = await seedFailedImproveEvidence(root);
    const evaluatedRunId = "run_seed_default";
    const evaluatedVersionId = seeded.prepared.versionId;
    const cachedLocalDryRun = await invoke(["eval", "--dry-run", "--dir", root, "--json"]);
    expect(cachedLocalDryRun.code, cachedLocalDryRun.stdout || cachedLocalDryRun.stderr).toBe(0);
    expect(stdoutJson(cachedLocalDryRun)).toMatchObject({
      plan: {
        location: "local",
        cachedRunIds: [evaluatedRunId],
      },
    });

    vi.stubEnv("WORKBENCH_CONFIG", path.join(await makeTempRoot("workbench-cli-cloud-cache-config-"), "config.json"));
    vi.stubEnv("WORKBENCH_API_TOKEN", "");
    vi.stubEnv("WORKBENCH_SMOKE_BEARER_TOKEN", "");
    const hostedDryRun = await invoke(["eval", "--dry-run", "--cloud", "--dir", root, "--json"]);
    expect(hostedDryRun.code, hostedDryRun.stdout || hostedDryRun.stderr).toBe(0);
    expect(stdoutJson(hostedDryRun)).toMatchObject({
      plan: {
        location: "cloud",
        cachedRunIds: [],
      },
      readiness: {
        ready: false,
        issues: [expect.objectContaining({ code: "auth_required" })],
      },
    });

    await fs.appendFile(path.join(root, "SKILL.md"), "\nDirty dry-run source.\n");
    const dirtyDryRun = await invoke(["eval", "--dry-run", "--dir", root, "--json"]);
    expect(dirtyDryRun.code, dirtyDryRun.stdout || dirtyDryRun.stderr).toBe(0);
    const dirtyPlan = stdoutJson<{
      plan: {
        versionId: string;
        sourceState?: string;
        wouldCreateVersionId?: string;
      };
    }>(dirtyDryRun).plan;
    expect(dirtyPlan.versionId).not.toBe(currentVersionId);
    expect(dirtyPlan).toMatchObject({
      sourceState: "would_create",
      wouldCreateVersionId: dirtyPlan.versionId,
    });
    const snapshotAfterDryRun = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
    expect(snapshotAfterDryRun.refs.current).toBe(evaluatedVersionId);
    expect(snapshotAfterDryRun.versions.some((version) => version.id === dirtyPlan.versionId)).toBe(false);
  });

  test("below-perfect evidence with a non-improvement agent teaches improver setup", async () => {
    const root = await makeTempRoot("workbench-cli-eval-improve-next-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await seedFailedImproveEvidence(root, "default", { status: "succeeded", score: 0.5 });

    const status = await invoke(["status", "--dir", root, "--json"]);

    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(status).next)
      .toBe("workbench agent add improver --adapter codex --model gpt-5.4-mini --with auth=default");
    const human = await invoke(["status", "--dir", root]);
    expect(human.code, human.stdout || human.stderr).toBe(0);
    expect(human.stdout).toContain("next: workbench agent add improver --adapter codex");
    expect(human.stdout).not.toContain("next: workbench improve\n");

    const added = await invoke(["agent", "add", "improver", "--dir", root, "--adapter", "codex", "--model", "gpt-5.4-mini", "--json"]);
    expect(added.code, added.stdout || added.stderr).toBe(0);
    expect(stdoutJson(added)).toMatchObject({
      result: {
        agent: {
          name: "improver",
          adapter: "codex",
          model: "gpt-5.4-mini",
        },
        setupCommands: [
          "codex login --device-auth",
          "workbench login codex --method oauth",
          "workbench eval --agents 'improver' --rerun",
          "workbench improve --agents 'improver'",
        ],
        next: "codex login --device-auth",
      },
    });
    const statusAfterAdd = await invoke(["status", "--dir", root, "--json"]);
    expect(stdoutJson<{ next: string | null }>(statusAfterAdd).next)
      .toBe("workbench eval --agents 'improver' --rerun");
  });

  test("explicit below-perfect local eval does not pivot to generated default provider agent", async () => {
    const root = await makeTempRoot("workbench-cli-eval-explicit-agent-next-");
    expect((await invoke(["new", root, "--agent", "codex", "--json"])).code).toBe(0);
    expect((await invoke(["agent", "add", "harness", "--dir", root, "--adapter", "local"])).code).toBe(0);
    await fs.mkdir(path.join(root, ".workbench", "cases", "case-001", "tests"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "case.yaml"), [
      "version: 1",
      "id: case-001",
      "prompt: Exercise the workflow happy path.",
      "rubric:",
      "  - Captures workflow-specific success evidence.",
      "command: sh \"$CASE_DIR/tests/test.sh\"",
      "",
    ].join("\n"));
    await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), [
      "#!/bin/sh",
      "set -eu",
      "mkdir -p \"$OUTPUT_DIR\"",
      "printf '{\"ok\":true,\"score\":0.5,\"metrics\":{\"score\":0.5}}\\n' > \"$OUTPUT_DIR/result.json\"",
      "",
    ].join("\n"));
    await fs.chmod(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), 0o755);

    const evaluated = await invoke(["eval", "--agents", "harness", "--rerun", "--dir", root, "--json"]);

    expect(evaluated.code, evaluated.stdout || evaluated.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(evaluated).next)
      .toBe("workbench agent add improver --adapter codex --model gpt-5.4-mini --with auth=default");
  });

  test("below-perfect smoke eval teaches improver setup instead of authoring another case", async () => {
    const root = await makeTempRoot("workbench-cli-eval-smoke-improve-next-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await fs.mkdir(path.join(root, ".workbench", "cases", "case-001", "tests"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "case.yaml"), [
      "version: 1",
      "id: case-001",
      "smoke: true",
      "prompt: Smoke check.",
      "command: sh \"$CASE_DIR/tests/test.sh\"",
      "",
    ].join("\n"));
    await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), [
      "#!/bin/sh",
      "set -eu",
      "mkdir -p \"$OUTPUT_DIR\"",
      "printf '{\"ok\":true,\"score\":0.5,\"metrics\":{\"score\":0.5}}\\n' > \"$OUTPUT_DIR/result.json\"",
      "",
    ].join("\n"));
    await fs.chmod(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), 0o755);

    const evaluated = await invoke(["eval", "--dir", root, "--json"]);

    expect(evaluated.code, evaluated.stdout || evaluated.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(evaluated).next)
      .toBe("workbench agent add improver --adapter codex --model gpt-5.4-mini --with auth=default");
    const status = await invoke(["status", "--dir", root, "--json"]);
    expect(stdoutJson<{ next: string | null }>(status).next)
      .toBe("workbench agent add improver --adapter codex --model gpt-5.4-mini --with auth=default");
    const human = await invoke(["eval", "--dir", root]);
    expect(human.stdout).toContain("next: workbench agent add improver --adapter codex");
    expect(human.stdout).not.toContain("case-002");
  });

  test("status and run operations use the existing-run surface", async () => {
    const root = await makeTempRoot("workbench-cli-run-ops-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const currentVersionId = await currentVersionIdFor(root);
    await fs.mkdir(path.join(root, ".workbench", "objects", "run"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "job"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "objects", "run", "run_active.json"), JSON.stringify({
      id: "run_active",
      kind: "eval",
      versionId: currentVersionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "running",
      location: "local",
      requestedSamples: 1,
      jobIds: ["job_active_done", "job_active_running"],
      traceIds: [],
      createdAt: "2026-06-11T00:00:00.000Z",
      lastProgressAt: "2026-06-11T00:00:01.000Z",
    }));
    await fs.writeFile(path.join(root, ".workbench", "objects", "job", "job_active_done.json"), JSON.stringify({
      id: "job_active_done",
      runId: "run_active",
      kind: "eval",
      versionId: currentVersionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      caseId: "case-001",
      sample: 0,
      status: "succeeded",
      score: 1,
      artifactIds: [],
      traceIds: [],
      createdAt: "2026-06-11T00:00:01.000Z",
      finishedAt: "2026-06-11T00:00:02.000Z",
    }));
    await fs.writeFile(path.join(root, ".workbench", "objects", "job", "job_active_running.json"), JSON.stringify({
      id: "job_active_running",
      runId: "run_active",
      kind: "eval",
      versionId: currentVersionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      caseId: "case-001",
      sample: 1,
      status: "running",
      artifactIds: [],
      traceIds: [],
      createdAt: "2026-06-11T00:00:03.000Z",
      startedAt: "2026-06-11T00:00:03.000Z",
    }));
    await fs.writeFile(path.join(root, ".workbench", "objects", "run", "run_done.json"), JSON.stringify({
      id: "run_done",
      kind: "eval",
      versionId: currentVersionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "succeeded",
      location: "cloud",
      score: 1,
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-10T00:00:00.000Z",
      finishedAt: "2026-06-10T00:00:01.000Z",
    }));

    const status = await invoke(["status", "--dir", root, "--json"]);
    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(stdoutJson(status)).toMatchObject({
      runs: {
        activeRuns: [
          expect.objectContaining({
            id: "run_active",
            next: "workbench run watch run_active",
            workDone: 1,
            workTotal: 2,
            scored: 1,
            partialScore: 1,
            progress: expect.objectContaining({
              schema: "workbench.run.v1",
              progress: expect.objectContaining({ completed: 1, scored: 1, partialScore: 1 }),
            }),
          }),
        ],
      },
      next: "workbench run watch run_active",
    });

    const lockRoot = path.join(root, ".workbench", "locks", "project.lock");
    await fs.mkdir(lockRoot, { recursive: true });
    await fs.writeFile(path.join(lockRoot, "owner.json"), JSON.stringify({
      schema: "workbench.project-lock.v1",
      pid: process.pid,
      hostname: os.hostname(),
      startedAt: new Date().toISOString(),
    }));
    const cancel = await invoke(["run", "cancel", "run_active", "--dir", root, "--json"]);
    expect(cancel.code, cancel.stdout || cancel.stderr).toBe(0);
    const cancelJson = stdoutJson(cancel);
    expect(cancelJson).toMatchObject({
      schema: "workbench.cli.run-cancel.v1",
      ok: true,
      run: {
        schema: "workbench.run.v1",
        id: "run_active",
        kind: "eval",
        variant: "local",
        status: "canceling",
        plan: expect.objectContaining({
          kind: "eval",
          variant: "local",
          versionId: currentVersionId,
          samples: 1,
        }),
        progress: expect.objectContaining({
          planned: 2,
          completed: 1,
          scored: 1,
        }),
        measurements: [
          expect.objectContaining({
            runId: "run_active",
            status: "running",
            samples: 2,
          }),
        ],
      },
      next: "workbench run watch run_active",
    });
    expect(cancelJson).not.toHaveProperty("result");
    expect(cancelJson).not.toHaveProperty("progress");
    expect(cancelJson).not.toHaveProperty("jobs");
    await expect(fs.access(path.join(root, ".workbench", "tmp", "cancel", "run_active.json")))
      .resolves.toBeUndefined();
    const cancelingStatus = await invoke(["status", "--dir", root, "--json"]);
    expect(cancelingStatus.code, cancelingStatus.stdout || cancelingStatus.stderr).toBe(0);
    expect(stdoutJson<{ runs: { activeRuns?: Array<{ id: string; status: string }> } }>(cancelingStatus).runs.activeRuns)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: "run_active", status: "canceling" })]));
    await fs.rm(lockRoot, { recursive: true, force: true });

    const watch = await invoke(["run", "watch", "run_done", "--dir", root, "--json"]);
    expect(watch.code, watch.stdout || watch.stderr).toBe(0);
    const watchJson = stdoutJson(watch);
    expect(watchJson).toMatchObject({
      schema: "workbench.cli.run-watch.v1",
      ok: true,
      run: {
        schema: "workbench.run.v1",
        id: "run_done",
        kind: "eval",
        variant: "cloud",
        status: "succeeded",
        plan: expect.objectContaining({
          kind: "eval",
          variant: "cloud",
          versionId: currentVersionId,
        }),
        measurements: [
          expect.objectContaining({
            runId: "run_done",
            status: "succeeded",
          }),
        ],
      },
      next: "workbench results",
    });
    expect(watchJson).not.toHaveProperty("result");
    expect(watchJson).not.toHaveProperty("progress");
    expect(watchJson).not.toHaveProperty("jobs");

    const retryRoot = await makeTempRoot("workbench-cli-run-retry-snapshot-");
    expect((await invoke(["new", retryRoot, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(retryRoot);
    const initial = await invoke(["eval", "--dir", retryRoot, "--json"]);
    expect(initial.code, initial.stdout || initial.stderr).toBe(0);
    const initialRun = stdoutJson(initial).run as Record<string, unknown>;
    const retryOfRunId = String(initialRun.id);
    const retry = await invoke(["run", "retry", retryOfRunId, "--dir", retryRoot, "--json"]);
    expect(retry.code, retry.stdout || retry.stderr).toBe(0);
    const retryJson = stdoutJson(retry);
    expect(retryJson).toMatchObject({
      schema: "workbench.cli.run-retry.v1",
      ok: true,
      retryOfRunId,
      run: {
        schema: "workbench.run.v1",
        kind: "eval",
        variant: "local",
        status: "succeeded",
        retryOfRunId,
        plan: expect.objectContaining({
          kind: "eval",
          variant: "local",
          samples: 1,
          retryOfRunId,
        }),
        measurements: [
          expect.objectContaining({
            status: "succeeded",
            samples: 1,
          }),
        ],
      },
      next: "workbench results",
    });
    const retryRun = retryJson.run as Record<string, unknown>;
    expect(retryRun.id).not.toBe(retryOfRunId);
    expect(retryJson).not.toHaveProperty("result");
    expect(retryJson).not.toHaveProperty("progress");
    expect(retryJson).not.toHaveProperty("jobs");
  });

  test("run watch and retry preserve non-default agent context in results next", async () => {
    const root = await makeTempRoot("workbench-cli-run-context-next-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    expect((await invoke(["agent", "add", "strict", "--adapter", "local", "--dir", root, "--json"])).code).toBe(0);

    const evaluated = await invoke(["eval", "--agents", "strict", "-n", "2", "--dir", root, "--json"]);
    expect(evaluated.code, evaluated.stdout || evaluated.stderr).toBe(0);
    const evaluatedRunId = stdoutJson<{ run: { id: string } }>(evaluated).run.id;

    const watched = await invoke(["run", "watch", evaluatedRunId, "--dir", root, "--json"]);
    expect(watched.code, watched.stdout || watched.stderr).toBe(0);
    expect(stdoutJson<{ next: string }>(watched).next).toBe("workbench results --agents 'strict'");

    const shown = await invoke(["show", evaluatedRunId, "--dir", root]);
    expect(shown.code, shown.stdout || shown.stderr).toBe(0);
    expect(shown.stdout).toContain("sample=1");
    expect(shown.stdout).toContain("sample=2");
    expect(shown.stdout).not.toContain("sample=0");

    const bareResults = await invoke(["results", "--dir", root]);
    expect(bareResults.code, bareResults.stdout || bareResults.stderr).toBe(0);
    expect(bareResults.stdout).toContain("No results.");

    const contextualResults = await invoke(["results", "--agents", "strict", "--dir", root]);
    expect(contextualResults.code, contextualResults.stdout || contextualResults.stderr).toBe(0);
    expect(contextualResults.stdout).toContain(expectedLocalSkillLabel(root, 1));
    expect(contextualResults.stdout).toMatch(/^version\s+agent\s+status\s+quality\s+samples\s+cost\s+latency\s+run/mu);
    expect(contextualResults.stdout).toMatch(/\bstrict\s+succeeded\b/u);

    const resultsJson = await invoke(["results", "--versions", "all", "--agents", "all", "--dir", root, "--json"]);
    expect(resultsJson.code, resultsJson.stdout || resultsJson.stderr).toBe(0);
    const resultsPayload = stdoutJson<{
      result: {
        versions: Array<{
          id: string;
          projectVersionId?: string;
          files?: Array<{ path: string; ref?: string; content?: string }>;
        }>;
      };
    }>(resultsJson);
    const resultVersion = resultsPayload.result.versions.find((version) =>
      version.files?.some((file) => file.path.endsWith("SKILL.md"))
    );
    const resultFile = resultVersion?.files?.find((file) => file.path.endsWith("SKILL.md"));
    expect(resultVersion).toBeTruthy();
    expect(resultFile).toMatchObject({
      path: expect.stringMatching(/SKILL\.md$/u),
      ref: expect.any(String),
    });
    expect(resultFile).not.toHaveProperty("content");
    const shownByPath = await invoke(["show", `${resultVersion!.id}:${resultFile!.path}`, "--dir", root, "--json"]);
    expect(shownByPath.code, shownByPath.stdout || shownByPath.stderr).toBe(0);
    expect(stdoutJson<{ result: { content: string } }>(shownByPath).result.content).toContain("#");
    const shownByRef = await invoke(["show", resultFile!.ref!, "--dir", root, "--json"]);
    expect(shownByRef.code, shownByRef.stdout || shownByRef.stderr).toBe(0);
    expect(stdoutJson<{ result: { content: string } }>(shownByRef).result.content).toContain("#");

    const retried = await invoke(["run", "retry", evaluatedRunId, "--dir", root, "--json"]);
    expect(retried.code, retried.stdout || retried.stderr).toBe(0);
    expect(stdoutJson<{ next: string }>(retried).next).toBe("workbench results --agents 'strict'");
  });

  test("terminal run summaries preserve multi-agent measurement context", async () => {
    const root = await makeTempRoot("workbench-cli-run-multi-agent-summary-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    expect((await invoke(["agent", "add", "strict", "--adapter", "local", "--dir", root, "--json"])).code).toBe(0);

    const evaluated = await invoke(["eval", "--agents", "all", "-n", "2", "--dir", root, "--json"]);
    expect(evaluated.code, evaluated.stdout || evaluated.stderr).toBe(0);
    const evaluatedJson = stdoutJson<{ run: { id: string; measurements: Array<{ agentName: string }> }; next: string }>(evaluated);
    expect(evaluatedJson.run.measurements.map((measurement) => measurement.agentName).sort()).toEqual(["default", "strict"]);

    const watched = await invoke(["run", "watch", evaluatedJson.run.id, "--dir", root]);
    expect(watched.code, watched.stdout || watched.stderr).toBe(0);
    expect(watched.stdout).toContain("measurement");
    expect(watched.stdout).toContain("agent=default");
    expect(watched.stdout).toContain("agent=strict");
    expect(watched.stdout).toContain("next: workbench results --agents 'default,strict'");

    const shown = await invoke(["show", evaluatedJson.run.id, "--dir", root]);
    expect(shown.code, shown.stdout || shown.stderr).toBe(0);
    expect(shown.stdout).toContain("agent=default");
    expect(shown.stdout).toContain("agent=strict");
    expect(shown.stdout).toContain("next: workbench results --agents 'default,strict'");

    const logRuns = await invoke(["log", "--runs", "--dir", root]);
    expect(logRuns.code, logRuns.stdout || logRuns.stderr).toBe(0);
    expect(logRuns.stdout).toMatch(/\bcurrent\s+default,strict\s+1\.000\b/u);

    const retried = await invoke(["run", "retry", evaluatedJson.run.id, "--dir", root, "--json"]);
    expect(retried.code, retried.stdout || retried.stderr).toBe(0);
    expect(stdoutJson<{ next: string; run: { measurements: Array<{ agentName: string }> } }>(retried)).toMatchObject({
      next: "workbench results --agents 'default,strict'",
      run: {
        measurements: expect.arrayContaining([
          expect.objectContaining({ agentName: "default" }),
          expect.objectContaining({ agentName: "strict" }),
        ]),
      },
    });
  });

  test("results preserve canceled run status when a canceled run has failed jobs", async () => {
    const root = await makeTempRoot("workbench-cli-results-canceled-status-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    expect((await invoke(["eval", "--dir", root, "--json"])).code).toBe(0);
    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
    const versionId = snapshot.status.currentVersionId;
    const bundle = snapshot.skillBundles.find((entry) => entry.skillName === "current");
    const agent = snapshot.agents[0];
    const evalSnapshot = snapshot.evals[0];
    if (!versionId || !bundle || !agent || !evalSnapshot) {
      throw new Error("Expected new local project to expose version, bundle, agent, and eval snapshots.");
    }
    const createdAt = "2026-06-19T00:00:00.000Z";
    const run: WorkbenchRun = {
      id: "run_canceled_mixed",
      kind: "eval",
      versionId,
      skillName: bundle.skillName,
      skillBundleHash: bundle.hash,
      evalHash: evalSnapshot.hash,
      agentName: agent.agent.name,
      agentHash: agent.hash,
      status: "canceled",
      score: 0,
      jobIds: ["job_canceled_mixed_failed", "job_canceled_mixed_canceled"],
      traceIds: [],
      createdAt,
      finishedAt: "2026-06-19T00:00:02.000Z",
      location: "local",
      requestedSamples: 2,
      operationPlan: {
        kind: "eval",
        variant: "local",
        versionId,
        evalHash: evalSnapshot.hash,
        skills: [bundle.skillName],
        agents: [agent.agent.name],
        samples: 2,
      },
    };
    const failedJob: WorkbenchJob = {
      id: "job_canceled_mixed_failed",
      runId: run.id,
      kind: "eval",
      versionId,
      skillName: bundle.skillName,
      skillBundleHash: bundle.hash,
      evalHash: evalSnapshot.hash,
      agentName: agent.agent.name,
      agentHash: agent.hash,
      caseId: "case-001",
      sample: 0,
      status: "failed",
      score: 0,
      artifactIds: [],
      traceIds: [],
      createdAt,
      startedAt: createdAt,
      finishedAt: "2026-06-19T00:00:01.000Z",
      durationMs: 1000,
      error: "case failed before cancellation",
    };
    const canceledJob: WorkbenchJob = {
      ...failedJob,
      id: "job_canceled_mixed_canceled",
      sample: 1,
      status: "canceled",
      score: undefined,
      finishedAt: "2026-06-19T00:00:02.000Z",
      error: "canceled by user",
    };
    await fs.mkdir(path.join(root, ".workbench", "objects", "run"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "job"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "objects", "run", `${run.id}.json`), JSON.stringify(run));
    await fs.writeFile(path.join(root, ".workbench", "objects", "job", `${failedJob.id}.json`), JSON.stringify(failedJob));
    await fs.writeFile(path.join(root, ".workbench", "objects", "job", `${canceledJob.id}.json`), JSON.stringify(canceledJob));

    const results = await invoke(["results", "--dir", root, "--json"]);

    expect(results.code, results.stdout || results.stderr).toBe(0);
    expect(stdoutJson<{ result: { cells: Array<{ runId?: string; status?: string }> } }>(results).result.cells)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ runId: run.id, status: "canceled" }),
      ]));
    const human = await invoke(["results", "--dir", root]);
    expect(human.code, human.stdout || human.stderr).toBe(0);
    expect(human.stdout).toMatch(/\bcanceled\s+0\.000\b/u);
  });

  test("rejects unsupported and context-invalid flags before handlers run", async () => {
    const unsupportedEvalFlag = await invoke(["eval", "--preview", "--eval", "alice/unsupported", "--json"]);
    expect(unsupportedEvalFlag.code).toBe(2);
    expect(stdoutJson(unsupportedEvalFlag)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --preview for workbench eval.",
    });

    const unsupportedProfileFlag = await invoke(["improve", "--profile", "main", "--json"]);
    expect(unsupportedProfileFlag.code).toBe(2);
    expect(stdoutJson(unsupportedProfileFlag)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --profile for workbench improve.",
    });

    const valuedBoolean = await invoke(["eval", "--preview=false", "--json"]);
    expect(valuedBoolean.code).toBe(2);
    expect(stdoutJson(valuedBoolean)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --preview for workbench eval.",
    });

    const staleSourceFlag = `--${"source"}`;
    const bareStaleFlag = await invoke([staleSourceFlag, "alice/old", "--json"]);
    expect(bareStaleFlag.code).toBe(2);
    expect(stdoutJson(bareStaleFlag)).toMatchObject({
      ok: false,
      code: "usage",
      message: `Unsupported flag ${staleSourceFlag} for workbench status.`,
    });

    const deletedSingularAgentFlag = `--${"agent"}`;
    const bareDeletedSingularFlag = await invoke([deletedSingularAgentFlag, "codex", "--json"]);
    expect(bareDeletedSingularFlag.code).toBe(2);
    expect(stdoutJson(bareDeletedSingularFlag)).toMatchObject({
      ok: false,
      code: "usage",
      message: `Unsupported flag ${deletedSingularAgentFlag} for workbench status.`,
    });

    const unknownCommand = await invoke(["bogus", "--json"]);
    expect(unknownCommand.code).toBe(2);
    expect(unknownCommand.stderr).toBe("");
    expect(stdoutJson(unknownCommand)).toMatchObject({
      ok: false,
      code: "usage",
      message: expect.stringContaining("Unknown command: bogus"),
    });
  });

  test("rejects flags that belong to a different subcommand", async () => {
    const unknownTopLevel = await invoke(["unknown", "status", "--method", "api-key", "--json"]);
    expect(unknownTopLevel.code).toBe(2);
    expect(stdoutJson(unknownTopLevel)).toMatchObject({
      ok: false,
      code: "usage",
      message: expect.stringContaining("Unknown command: unknown"),
    });

    const deletedCaseCommand = await invoke(["case", "add", "run_1", "--json"]);
    expect(deletedCaseCommand.code).toBe(2);
    expect(stdoutJson(deletedCaseCommand)).toMatchObject({
      ok: false,
      code: "usage",
      message: expect.stringContaining("Unsupported case command: add"),
    });

    const agentListAdapter = await invoke(["agent", "list", "--adapter", "codex", "--json"]);
    expect(agentListAdapter.code).toBe(2);
    expect(stdoutJson(agentListAdapter)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --adapter for workbench agent.",
    });

    const agentMissingSubcommandAdapter = await invoke(["agent", "--adapter", "codex", "--json"]);
    expect(agentMissingSubcommandAdapter.code).toBe(2);
    expect(stdoutJson(agentMissingSubcommandAdapter)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --adapter for workbench agent.",
    });

    const agentUnknownSubcommandAdapter = await invoke(["agent", "bogus", "--adapter", "codex", "--json"]);
    expect(agentUnknownSubcommandAdapter.code).toBe(2);
    expect(stdoutJson(agentUnknownSubcommandAdapter)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --adapter for workbench agent.",
    });
  });

  test("validates flag value kinds per command", async () => {
    const valuedLogVersions = await invoke(["log", "--versions", "v019", "--json"]);
    expect(valuedLogVersions.code).toBe(2);
    expect(stdoutJson(valuedLogVersions)).toMatchObject({
      ok: false,
      code: "usage",
      message: "--versions does not accept a value.",
    });

    const valuedLogRuns = await invoke(["log", "--runs", "v019", "--json"]);
    expect(valuedLogRuns.code).toBe(2);
    expect(stdoutJson(valuedLogRuns)).toMatchObject({
      ok: false,
      code: "usage",
      message: "--runs does not accept a value.",
    });

    const missingSamples = await invoke(["eval", "-n", "--json"]);
    expect(missingSamples.code).toBe(2);
    expect(stdoutJson(missingSamples)).toMatchObject({
      ok: false,
      code: "usage",
      message: "--samples requires a value.",
    });

    const invalidPort = await invoke(["open", "--port", "65536"]);
    expect(invalidPort.code).toBe(2);
    expect(invalidPort.stderr).toContain("--port must be an integer between 0 and 65535.");

    const root = await makeTempRoot("workbench-cli-flag-kinds-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const results = await invoke(["results", "--versions", "all", "--dir", root, "--json"]);
    expect(results.code, results.stdout || results.stderr).toBe(0);
    expect(stdoutJson(results)).toMatchObject({ schema: "workbench.cli.results.v1", ok: true });
  });

  test("new is a strict create command", async () => {
    const root = await makeTempRoot("workbench-cli-new-strict-");
    const created = await invoke(["new", root, "--agent", "local", "--json"]);
    expect(created.code).toBe(0);
    expect(stdoutJson(created)).toMatchObject({
      result: {
        createdPaths: [
          "SKILL.md",
          ".workbench/eval.yaml",
          ".workbench/agents.yaml",
          ".workbench/.gitignore",
        ],
        defaultAgentSelection: {
          adapter: "local",
          kind: "deterministic",
          readiness: { state: "deterministic" },
        },
      },
    });
    await expect(fs.access(path.join(root, ".workbench", "cases", "case-001", "case.yaml")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(path.join(root, ".workbench", "eval.yaml"), "utf8"))
      .resolves.toContain("adapter: tests");

    const duplicate = await invoke(["new", root, "--agent", "local", "--json"]);
    expect(duplicate.code).toBe(2);
    expect(stdoutJson(duplicate)).toMatchObject({
      ok: false,
      code: "already_initialized",
      message: expect.stringContaining("Workbench project already exists"),
      remediation: `cd ${root} && workbench`,
    });

    const existingSkillRoot = await makeTempRoot("workbench-cli-new-existing-skill-");
    await fs.writeFile(path.join(existingSkillRoot, "SKILL.md"), privateSkillMarkdown);
    const existingSkill = await invoke(["new", existingSkillRoot, "--agent", "local", "--json"]);
    expect(existingSkill.code).toBe(2);
    expect(stdoutJson(existingSkill)).toMatchObject({
      ok: false,
      code: "usage",
      message: `Directory already contains SKILL.md: ${existingSkillRoot}`,
      remediation: `cd ${existingSkillRoot} && workbench init`,
    });
  });

  test("init adopts an existing skill directory without rewriting SKILL.md", async () => {
    const root = await makeTempRoot("workbench-cli-init-existing-");
    const previousCwd = process.cwd();
    await fs.writeFile(path.join(root, "SKILL.md"), privateSkillMarkdown);
    const realRoot = await fs.realpath(root);
    const before = await fs.readFile(path.join(root, "SKILL.md"), "utf8");
    process.chdir(root);
    try {
      const initialized = await invoke(["init", "--agent", "local", "--json"]);
      expect(initialized.code, initialized.stdout || initialized.stderr).toBe(0);
      expect(stdoutJson(initialized)).toMatchObject({
        schema: "workbench.cli.init.v1",
        ok: true,
        result: {
          root: realRoot,
          initialized: true,
          createdPaths: [
            ".workbench/eval.yaml",
            ".workbench/agents.yaml",
            ".workbench/.gitignore",
          ],
          defaultAgentSelection: {
            adapter: "local",
            kind: "deterministic",
          },
        },
      });
      await expect(fs.readFile(path.join(root, "SKILL.md"), "utf8")).resolves.toBe(before);
      await expect(fs.access(path.join(root, ".workbench", "cases"))).resolves.toBeUndefined();

      const duplicate = await invoke(["init", "--agent", "local", "--json"]);
      expect(duplicate.code).toBe(2);
      expect(stdoutJson(duplicate)).toMatchObject({
        ok: false,
        code: "already_initialized",
        remediation: "workbench status",
      });
    } finally {
      process.chdir(previousCwd);
    }

    const missingRoot = await makeTempRoot("workbench-cli-init-missing-skill-");
    process.chdir(missingRoot);
    try {
      const missing = await invoke(["init", "--json"]);
      expect(missing.code).toBe(2);
      expect(stdoutJson(missing)).toMatchObject({
        ok: false,
        code: "usage",
        message: expect.stringContaining("SKILL.md"),
        remediation: "workbench new DIR",
      });
    } finally {
      process.chdir(previousCwd);
    }

    const pathArg = await invoke(["init", root, "--json"]);
    expect(pathArg.code).toBe(2);
    expect(stdoutJson(pathArg)).toMatchObject({
      ok: false,
      code: "usage",
      message: "workbench init does not accept a directory argument.",
      remediation: "workbench init",
    });
  });

  test("removed source and skill-target grammar is rejected through generic usage paths", async () => {
    const root = path.join(await makeTempRoot("workbench-cli-removed-grammar-parent-"), "skill");

    const newFrom = await invoke(["new", root, "--from", "alice/private-skill", "--json"]);
    expect(newFrom.code).toBe(2);
    expect(stdoutJson(newFrom)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --from for workbench new.",
    });

    const newDirFlag = await invoke(["new", "--dir", root, "--json"]);
    expect(newDirFlag.code).toBe(2);
    expect(stdoutJson(newDirFlag)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --dir for workbench new.",
    });

    const newMissingDir = await invoke(["new", "--json"]);
    expect(newMissingDir.code).toBe(2);
    expect(stdoutJson(newMissingDir)).toMatchObject({
      ok: false,
      code: "usage",
      message: "workbench new requires a directory.",
      remediation: "workbench new DIR",
    });

    const skillsScan = await invoke(["skills", "scan", "--json"]);
    expect(skillsScan.code).toBe(2);
    expect(stdoutJson(skillsScan)).toMatchObject({
      ok: false,
      code: "usage",
      message: "workbench skills does not accept positional arguments.",
    });

    const skillsGlobal = await invoke(["skills", "--global", "--json"]);
    expect(skillsGlobal.code).toBe(2);
    expect(stdoutJson(skillsGlobal)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --global for workbench skills.",
    });

    const installFor = await invoke(["install", "alice/private-skill", "--for", "codex", "--json"]);
    expect(installFor.code).toBe(2);
    expect(stdoutJson(installFor)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --for for workbench install.",
    });

    const targetAll = await invoke(["skills", "--target", "all", "--json"]);
    expect(targetAll.code).toBe(2);
    expect(stdoutJson(targetAll)).toMatchObject({
      ok: false,
      code: "usage",
      message: "workbench skills/install --target expects codex or claude.",
      subject: { target: "all" },
    });
  });

  test("clone hydrates editable package source and authored Workbench controls", async () => {
    const root = path.join(await makeTempRoot("workbench-cli-clone-parent-"), "private-skill");
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "source-token",
    }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      schema: "workbench.source.snapshot.v1",
      owner: "alice",
      name: "private-skill",
      versionId: "v010",
      files: [
        {
          path: "SKILL.md",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: privateSkillMarkdown,
        },
        {
          path: "references/guide.md",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "Editable reference source.\n",
        },
        {
          path: "scripts/run.sh",
          kind: "text",
          encoding: "utf8",
          executable: true,
          content: "#!/bin/sh\nprintf 'editable source\\n'\n",
        },
        {
          path: ".workbench/eval.yaml",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "schema: workbench.eval.v1\nscorer:\n  adapter: tests\n",
        },
        {
          path: ".workbench/agents.yaml",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "schema: workbench.agents.v1\ndefault: default\nagents:\n  default:\n    adapter: local\n",
        },
        {
          path: ".workbench/versions.yaml",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "schema: workbench.versions.v1\n",
        },
        {
          path: ".workbench/cases/case-001/case.yaml",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "version: 1\nid: case-001\ncommand: true\n",
        },
        {
          path: ".workbench/environment/Dockerfile",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "FROM alpine:3.20\n",
        },
        {
          path: ".workbench/objects/version/runtime.json",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "{}\n",
        },
        {
          path: ".workbench/refs/current",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "v_old\n",
        },
        {
          path: ".agents/skills/pollution/SKILL.md",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "---\nname: pollution\n---\n# Pollution\n",
        },
      ],
    })));

    const created = await invoke(["clone", "alice/private-skill", root, "--json"]);
    expect(created.code, created.stdout || created.stderr).toBe(0);
    expect(stdoutJson(created)).toMatchObject({
      schema: "workbench.cli.clone.v1",
      ok: true,
      source: {
        kind: "workbench-cloud",
        owner: "alice",
        skill: "private-skill",
        versionId: "v010",
      },
      hydratedPaths: expect.arrayContaining([
        "SKILL.md",
        "references/guide.md",
        "scripts/run.sh",
        ".workbench/eval.yaml",
        ".workbench/agents.yaml",
        ".workbench/versions.yaml",
        ".workbench/cases/case-001/case.yaml",
        ".workbench/environment/Dockerfile",
      ]),
      next: "workbench eval",
    });
    expect(stdoutJson(created)).not.toHaveProperty("setupCommands");
    expect(stdoutJson<{ result: { currentVersionId?: string } }>(created).result.currentVersionId).toEqual(expect.any(String));
    const hydratedPaths = stdoutJson<{ hydratedPaths: string[] }>(created).hydratedPaths;
    expect(hydratedPaths).not.toContain(".workbench/objects/version/runtime.json");
    expect(hydratedPaths).not.toContain(".workbench/refs/current");
    expect(hydratedPaths).not.toContain(".agents/skills/pollution/SKILL.md");
    await expect(fs.readFile(path.join(root, "references", "guide.md"), "utf8"))
      .resolves.toContain("Editable reference source.");
    await expect(fs.readFile(path.join(root, ".workbench", "cases", "case-001", "case.yaml"), "utf8"))
      .resolves.toContain("id: case-001");
    await expect(fs.access(path.join(root, ".workbench", "objects", "version", "runtime.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(path.join(root, ".workbench", "refs", "current"), "utf8"))
      .resolves.not.toBe("v_old\n");
    await expect(fs.access(path.join(root, ".agents", "skills", "pollution", "SKILL.md")))
      .rejects.toMatchObject({ code: "ENOENT" });
    const agentObjectFiles = await fs.readdir(path.join(root, ".workbench", "objects", "agent"));
    const clonedAgents = await Promise.all(agentObjectFiles.map(async (file) =>
      JSON.parse(await fs.readFile(path.join(root, ".workbench", "objects", "agent", file), "utf8")) as { name: string; adapter: string }
    ));
    expect(clonedAgents).toEqual([{ name: "default", adapter: "local", config: {} }]);
    await expect(fs.readdir(path.join(root, ".workbench", "objects", "version")))
      .resolves.toHaveLength(1);
    const showCurrent = await invoke(["show", "current", "--dir", root, "--json"]);
    expect(showCurrent.code, showCurrent.stdout || showCurrent.stderr).toBe(0);
    const showCurrentPaths = stdoutJson<{ result: { files: Array<{ path: string }> } }>(showCurrent)
      .result.files.map((file) => file.path);
    expect(showCurrentPaths).toEqual(expect.arrayContaining([
      "SKILL.md",
      "references/guide.md",
      "scripts/run.sh",
      ".workbench/cases/case-001/case.yaml",
    ]));
    const hydratedStatus = await invoke(["status", "--dir", root, "--json"]);
    expect(hydratedStatus.code, hydratedStatus.stdout || hydratedStatus.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(hydratedStatus).next).toBe("workbench eval");
  });

  test("clone with published smoke cases points to eval", async () => {
    const root = path.join(await makeTempRoot("workbench-cli-clone-smoke-parent-"), "smoke");
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "source-token",
    }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      schema: "workbench.source.snapshot.v1",
      owner: "test",
      name: "workbench-smoke",
      versionId: "v010",
      files: [
        {
          path: "SKILL.md",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: [
            "---",
            "name: workbench-smoke",
            "description: Smoke fixture.",
            "---",
            "# Smoke",
            "",
          ].join("\n"),
        },
        {
          path: ".workbench/eval.yaml",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "schema: workbench.eval.v1\nscorer:\n  adapter: tests\n",
        },
        {
          path: ".workbench/agents.yaml",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "schema: workbench.agents.v1\ndefault: default\nagents:\n  default:\n    adapter: local\n",
        },
        {
          path: ".workbench/cases/case-001/case.yaml",
          content: "version: 1\nid: case-001\nsmoke: true\ncommand: true\n",
        },
      ],
    })));

    const created = await invoke(["clone", "test/workbench-smoke", root, "--json"]);

    expect(created.code, created.stdout || created.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(created).next).toBe("workbench eval");
    const status = await invoke(["status", "--dir", root, "--json"]);
    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(status).next).toBe("workbench eval");
  });

  test("new defaults to provider-backed Codex and supports explicit provider/local selection", async () => {
    const authRoot = await makeTempRoot("workbench-cli-new-provider-auth-");
    vi.stubEnv("WORKBENCH_ADAPTER_AUTH_STORE", authRoot);
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const root = await makeTempRoot("workbench-cli-new-provider-default-");
    const created = await invoke(["new", root, "--json"]);
    expect(created.code, created.stdout || created.stderr).toBe(0);
    const createdJson = stdoutJson<{
      result: {
        createdPaths: string[];
        defaultAgentSelection: {
          adapter: string;
          model: string;
          auth: string;
          kind: string;
          reason: string;
          readiness: { state: string; setupCommands: string[] };
        };
      };
      next: string | null;
      setupCommands: string[];
    }>(created);
    expect(createdJson.result.createdPaths).toEqual([
      "SKILL.md",
      ".workbench/eval.yaml",
      ".workbench/agents.yaml",
      ".workbench/.gitignore",
    ]);
    expect(createdJson.result.defaultAgentSelection).toMatchObject({
      adapter: "codex",
      model: "gpt-5.4-mini",
      auth: "default",
      kind: "provider",
    });
    expect(createdJson.result.defaultAgentSelection.reason).toMatch(/codex|product_default/u);
    expect(WORKBENCH_AUTHOR_EVAL_CASE_COMMAND).toBe("workbench case draft 'case-001'");
    expect(createdJson.result.defaultAgentSelection.readiness.setupCommands.length).toBeGreaterThan(0);
    expect(createdJson.next).toContain(WORKBENCH_AUTHOR_EVAL_CASE_COMMAND);
    expect(createdJson.next).not.toContain("codex login --device-auth");
    expect(createdJson.setupCommands.every((command) => typeof command === "string")).toBe(true);
    const newStatus = await invoke(["status", "--dir", root, "--json"]);
    expect(newStatus.code, newStatus.stdout || newStatus.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(newStatus).next).toBe(WORKBENCH_AUTHOR_EVAL_CASE_COMMAND);
    await expect(fs.access(path.join(root, ".workbench", "cases", "case-001", "case.yaml")))
      .rejects.toMatchObject({ code: "ENOENT" });
    const authorCase = await invoke(["case", "draft", "case-001", "--dir", root, "--json"]);
    expect(authorCase.code, authorCase.stdout || authorCase.stderr).toBe(0);
    expect(stdoutJson(authorCase)).toMatchObject({
      schema: "workbench.cli.case-draft.v1",
      ok: true,
      caseId: "case-001",
      files: [
        ".workbench/cases/case-001/case.yaml",
        ".workbench/cases/case-001/tests/test.sh",
      ],
      next: "${EDITOR:-vi} .workbench/cases/case-001/case.yaml",
    });
    await expect(fs.readFile(path.join(root, ".workbench", "cases", "case-001", "case.yaml"), "utf8"))
      .resolves.toContain("command: sh \"$CASE_DIR/tests/test.sh\"");
    await expect(fs.readFile(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), "utf8"))
      .resolves.toContain("$OUTPUT_DIR/result.json");
    const duplicateCase = await invoke(["case", "draft", "case-001", "--dir", root, "--json"]);
    expect(duplicateCase.code).toBe(2);
    expect(stdoutJson(duplicateCase)).toMatchObject({
      ok: false,
      code: "case_exists",
      remediation: "workbench case draft case-002",
    });
    await fs.rm(path.join(root, ".workbench", "cases", "case-001"), { recursive: true, force: true });
    await writePassingCaseTest(root);
    const caseStatus = await invoke(["status", "--dir", root, "--json"]);
    expect(caseStatus.code, caseStatus.stdout || caseStatus.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(caseStatus).next).toBe("workbench eval");
    await expect(fs.readFile(path.join(root, ".workbench", "eval.yaml"), "utf8"))
      .resolves.toContain("adapter: rubric");
    await expect(fs.readFile(path.join(root, ".workbench", "agents.yaml"), "utf8"))
      .resolves.toContain("adapter: codex");

    const nativeCodexHome = await makeTempRoot("workbench-cli-native-codex-home-");
    await fs.mkdir(path.join(nativeCodexHome, ".codex"), { recursive: true });
    await fs.writeFile(path.join(nativeCodexHome, ".codex", "auth.json"), "{}\n", "utf8");
    vi.stubEnv("HOME", nativeCodexHome);
    const nativeCodexRoot = await makeTempRoot("workbench-cli-native-codex-new-");
    const nativeCodex = await invoke(["new", nativeCodexRoot, "--json"]);
    expect(nativeCodex.code, nativeCodex.stdout || nativeCodex.stderr).toBe(0);
    expect(stdoutJson(nativeCodex)).toMatchObject({
      result: {
        defaultAgentSelection: {
          adapter: "codex",
          readiness: {
            state: "partial",
            workbenchProviderAuth: "missing",
            nativeAuth: "present",
            setupCommands: ["workbench login codex --method oauth"],
          },
        },
      },
    });

    const connectedCodexProfileRoot = await makeTempRoot("workbench-cli-connected-codex-profile-");
    await fs.mkdir(path.join(connectedCodexProfileRoot, ".codex"), { recursive: true });
    await fs.writeFile(path.join(connectedCodexProfileRoot, ".codex", "auth.json"), "{}\n", "utf8");
    const connectedCodexLogin = await invoke(["login", "codex", "--profile-root", connectedCodexProfileRoot, "--json"]);
    expect(connectedCodexLogin.code, connectedCodexLogin.stdout || connectedCodexLogin.stderr).toBe(0);
    const connectedCodexHome = await makeTempRoot("workbench-cli-connected-codex-home-");
    vi.stubEnv("HOME", connectedCodexHome);
    const connectedCodexRoot = await makeTempRoot("workbench-cli-connected-codex-new-");
    const connectedCodex = await invoke(["new", connectedCodexRoot, "--json"]);
    expect(connectedCodex.code, connectedCodex.stdout || connectedCodex.stderr).toBe(0);
    const connectedCodexJson = stdoutJson<{
      result: {
        defaultAgentSelection: {
          adapter: string;
          readiness: {
            workbenchProviderAuth: string;
            nativeAuth: string;
            setupCommands: string[];
          };
        };
      };
    }>(connectedCodex);
    expect(connectedCodexJson.result.defaultAgentSelection).toMatchObject({
      adapter: "codex",
      readiness: {
        workbenchProviderAuth: "connected",
        nativeAuth: "not_required",
      },
    });
    expect(connectedCodexJson.result.defaultAgentSelection.readiness.setupCommands)
      .not.toContain("codex login --device-auth");
    expect(connectedCodexJson.result.defaultAgentSelection.readiness.setupCommands)
      .not.toContain("workbench login codex --method oauth");

    const connectedClaudeProfileRoot = await makeTempRoot("workbench-cli-connected-claude-profile-");
    await fs.writeFile(path.join(connectedClaudeProfileRoot, ".claude.json"), "{}", "utf8");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "sk-ant-oat01-test");
    const connectedClaudeLogin = await invoke(["login", "claude", "--profile-root", connectedClaudeProfileRoot, "--json"]);
    expect(connectedClaudeLogin.code, connectedClaudeLogin.stdout || connectedClaudeLogin.stderr).toBe(0);
    const connectedClaudeHome = await makeTempRoot("workbench-cli-connected-claude-home-");
    vi.stubEnv("HOME", connectedClaudeHome);
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    const connectedClaudeRoot = await makeTempRoot("workbench-cli-connected-claude-new-");
    const connectedClaude = await invoke(["new", connectedClaudeRoot, "--agent", "claude", "--json"]);
    expect(connectedClaude.code, connectedClaude.stdout || connectedClaude.stderr).toBe(0);
    const connectedClaudeJson = stdoutJson<{
      result: {
        defaultAgentSelection: {
          readiness: {
            workbenchProviderAuth: string;
            nativeAuth: string;
            setupCommands: string[];
          };
        };
      };
    }>(connectedClaude);
    expect(connectedClaudeJson.result.defaultAgentSelection.readiness).toMatchObject({
      workbenchProviderAuth: "connected",
      nativeAuth: "not_required",
    });
    expect(connectedClaudeJson.result.defaultAgentSelection.readiness.setupCommands)
      .not.toContain("claude setup-token");
    expect(connectedClaudeJson.result.defaultAgentSelection.readiness.setupCommands.join("\n"))
      .not.toContain("workbench login claude --method oauth");

    const claudeRoot = await makeTempRoot("workbench-cli-new-provider-claude-");
    const claude = await invoke(["new", claudeRoot, "--agent", "claude", "--model", "opus", "--auth", "team", "--json"]);
    expect(claude.code, claude.stdout || claude.stderr).toBe(0);
    expect(stdoutJson(claude)).toMatchObject({
      result: {
        defaultAgentSelection: {
          adapter: "claude",
          model: "opus",
          auth: "team",
          reason: "explicit_agent",
        },
      },
    });
    await expect(fs.readFile(path.join(claudeRoot, ".workbench", "eval.yaml"), "utf8"))
      .resolves.toContain("adapter: rubric");
    await expect(fs.readFile(path.join(claudeRoot, ".workbench", "agents.yaml"), "utf8"))
      .resolves.toContain("auth: team");

    const invalid = await invoke(["new", await makeTempRoot("workbench-cli-new-invalid-local-"), "--agent", "local", "--model", "sonnet", "--json"]);
    expect(invalid.code).toBe(2);
    expect(stdoutJson(invalid)).toMatchObject({
      ok: false,
      code: "usage",
      remediation: "workbench new --agent local",
    });
  });

  test("config path and no-case remediation stay actionable", async () => {
    const configDir = await makeTempRoot("workbench-cli-config-dir-");
    vi.stubEnv("WORKBENCH_CONFIG", configDir);
    const badConfig = await invoke(["status", "--json"]);
    expect(badConfig.code).toBe(2);
    expect(stdoutJson(badConfig)).toMatchObject({
      ok: false,
      code: "usage",
      message: `WORKBENCH_CONFIG must point to a config file, not a directory: ${configDir}`,
      remediation: "WORKBENCH_CONFIG=/path/to/config.json workbench status",
      subject: { env: "WORKBENCH_CONFIG", path: configDir },
    });

    vi.stubEnv("WORKBENCH_CONFIG", path.join(await makeTempRoot("workbench-cli-config-file-"), "config.json"));
    vi.stubEnv("WORKBENCH_ADAPTER_AUTH_STORE", await makeTempRoot("workbench-cli-empty-adapter-auth-"));
    const root = await makeTempRoot("workbench-cli-no-case-remediation-");
    expect((await invoke(["new", root, "--agent", "codex", "--json"])).code).toBe(0);
    const evalDryRun = await invoke(["eval", "--dry-run", "--dir", root, "--json"]);
    expect(evalDryRun.code, evalDryRun.stdout || evalDryRun.stderr).toBe(0);
    expect(stdoutJson(evalDryRun)).toMatchObject({
      ok: true,
      dryRun: true,
      plan: {
        cases: 0,
        readiness: {
          ready: false,
          issues: [
            {
              code: "no_eval_cases",
              remediation: WORKBENCH_AUTHOR_EVAL_CASE_COMMAND,
            },
            {
              code: "adapter_auth_required",
              remediation: "codex login --device-auth",
              subject: {
                setupCommands: [
                  "codex login --device-auth",
                  "workbench login codex --method oauth",
                ],
              },
            },
          ],
        },
      },
      next: WORKBENCH_AUTHOR_EVAL_CASE_COMMAND,
    });
    const improve = await invoke(["improve", "--dir", root, "--json"]);
    expect(improve.code).toBe(2);
    const improveJson = stdoutJson<{ remediation: string }>(improve);
    expect(improveJson).toMatchObject({
      ok: false,
      code: "no_eval_cases",
      remediation: WORKBENCH_AUTHOR_EVAL_CASE_COMMAND,
      subject: { directory: ".workbench/cases" },
    });
    const authorCase = await invoke(["case", "draft", "case-001", "--dir", root, "--json"]);
    expect(authorCase.code, authorCase.stdout || authorCase.stderr).toBe(0);
    await expect(fs.readFile(path.join(root, ".workbench", "cases", "case-001", "case.yaml"), "utf8"))
      .resolves.toContain("command: sh \"$CASE_DIR/tests/test.sh\"");
    const testStat = await fs.stat(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"));
    expect(testStat.mode & 0o111).not.toBe(0);
  });

  dockerTest("draft case placeholders fail until authored", async () => {
    const root = await makeTempRoot("workbench-cli-draft-case-placeholder-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const authorCase = await invoke(["case", "draft", "case-001", "--dir", root, "--json"]);
    expect(authorCase.code, authorCase.stdout || authorCase.stderr).toBe(0);

    const evalResult = await invoke(["eval", "--dir", root, "--json"]);

    expect(evalResult.code, evalResult.stdout || evalResult.stderr).toBe(1);
    const body = stdoutJson<{ failedMeasurements: Array<{ runId: string; status: string; score?: number }> }>(evalResult);
    expect(body).toMatchObject({
      ok: false,
      code: "eval_runs_failed",
      evidenceSaved: true,
      failedMeasurements: [{
        status: "failed",
        score: 0,
      }],
    });
    const stderr = await invoke(["show", `${body.failedMeasurements[0]!.runId}:stderr.log`, "--dir", root]);
    expect(stderr.stdout).toContain("Draft case case-001 still contains placeholder assertions.");
  });

  dockerTest("local cases without a command or test script fail with actionable evidence", async () => {
    const root = await makeTempRoot("workbench-cli-local-case-shape-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await fs.mkdir(path.join(root, ".workbench", "cases", "case-001"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "case.yaml"), [
      "version: 1",
      "id: case-001",
      "prompt: Check deterministic local scoring.",
      "rubric:",
      "  - Captures the local case authoring shape.",
      "",
    ].join("\n"));

    const result = await invoke(["eval", "--dir", root, "--json"]);
    expect(result.code, result.stdout || result.stderr).toBe(1);
    expect(stderrJsonLines(result)).toContainEqual(expect.objectContaining({
      schema: "workbench.run.v1",
      kind: "eval",
      phase: "complete",
      variant: "local",
      progress: expect.objectContaining({
        completed: 1,
        planned: 1,
        failed: 1,
      }),
    }));
    expect(stdoutJson(result)).toMatchObject({
      ok: false,
      code: "eval_runs_failed",
      evidenceSaved: true,
      failedMeasurements: [{
        status: "failed",
        error: "Workbench case must define top-level command or include tests/test.sh.",
      }],
    });
  });

  test("zero-score command results are failed evidence", async () => {
    const root = await makeTempRoot("workbench-cli-zero-score-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await fs.mkdir(path.join(root, ".workbench", "cases", "case-001"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "case.yaml"), [
      "version: 1",
      "id: case-001",
      "command: node -e \"const fs=require('node:fs'); const path=require('node:path'); fs.writeFileSync(path.join(process.env.OUTPUT_DIR, 'result.json'), JSON.stringify({ok:true, score:0, message:'known bad'}) + '\\n')\"",
      "",
    ].join("\n"));

    const evalResult = await invoke(["eval", "--dir", root, "--json"]);
    expect(evalResult.code, evalResult.stdout || evalResult.stderr).toBe(1);
    expect(stdoutJson(evalResult)).toMatchObject({
      ok: false,
      code: "eval_runs_failed",
      failedMeasurements: [expect.objectContaining({
        status: "failed",
        score: 0,
        error: "known bad",
      })],
    });
    expect(stdoutJson<{ next: string | null }>(evalResult).next).toMatch(/^workbench show /u);

    const status = await invoke(["status", "--dir", root, "--json"]);
    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(status).next).toMatch(/^workbench show /u);
  });

  test("provider api-key login refuses to record auth without credentials", async () => {
    const authRoot = await makeTempRoot("workbench-cli-missing-provider-auth-");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(authRoot, "config.json"));
    vi.stubEnv("WORKBENCH_ADAPTER_AUTH_STORE", authRoot);
    vi.stubEnv("OPENAI_API_KEY", "");

    const connect = await invoke(["login", "codex", "--method", "api-key", "--json"]);
    expect(connect.code).toBe(2);
    expect(stdoutJson(connect)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Missing required environment variable(s): OPENAI_API_KEY",
      remediation: "OPENAI_API_KEY=... workbench login codex --method api-key",
      subject: { missingEnvVars: ["OPENAI_API_KEY"] },
    });

    const status = await invoke(["status", "--dir", authRoot, "--json"]);
    expect(stdoutJson<{ auth: { adapters: unknown[] } }>(status).auth.adapters).toEqual([]);
  });

  test("provider login defaults to OAuth and teaches token generation", async () => {
    const authRoot = await makeTempRoot("workbench-cli-oauth-provider-auth-");
    const codexProfileRoot = await makeTempRoot("workbench-cli-codex-profile-");
    const claudeProfileRoot = await makeTempRoot("workbench-cli-claude-profile-");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(authRoot, "config.json"));
    vi.stubEnv("WORKBENCH_ADAPTER_AUTH_STORE", authRoot);
    vi.stubEnv("OPENAI_API_KEY", "should-not-select-api-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "should-not-select-api-key");

    const codex = await invoke(["login", "codex", "--profile-root", codexProfileRoot, "--json"]);
    expect(codex.code).toBe(2);
    expect(stdoutJson(codex)).toMatchObject({
      ok: false,
      code: "provider_oauth_missing",
      remediation: `mkdir -p '${path.join(codexProfileRoot, ".codex")}' && CODEX_HOME='${path.join(codexProfileRoot, ".codex")}' codex login --device-auth`,
      subject: {
        relativePath: ".codex/auth.json",
        setupCommands: [
          `mkdir -p '${path.join(codexProfileRoot, ".codex")}' && CODEX_HOME='${path.join(codexProfileRoot, ".codex")}' codex login --device-auth`,
          `workbench login codex --method oauth --profile-root '${codexProfileRoot}'`,
        ],
      },
    });

    const claudeEmpty = await invoke(["login", "claude", "--profile-root", claudeProfileRoot, "--json"]);
    expect(claudeEmpty.code).toBe(2);
    expect(stdoutJson(claudeEmpty)).toMatchObject({
      ok: false,
      code: "provider_oauth_missing",
      message: `Claude OAuth capture requires Claude Code's profile and the OAuth token printed by claude setup-token. Run claude setup-token first, then capture it with CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth --profile-root '${claudeProfileRoot}'.`,
      remediation: "claude setup-token",
      subject: {
        relativePath: ".claude.json",
        env: "CLAUDE_CODE_OAUTH_TOKEN",
        setupCommands: [
          "claude setup-token",
          `CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth --profile-root '${claudeProfileRoot}'`,
        ],
      },
    });

    await fs.writeFile(path.join(claudeProfileRoot, ".claude.json"), "{}", "utf8");
    const claudeProfileOnly = await invoke(["login", "claude", "--profile-root", claudeProfileRoot, "--json"]);
    expect(claudeProfileOnly.code).toBe(2);
    expect(stdoutJson(claudeProfileOnly)).toMatchObject({
      ok: false,
      code: "provider_oauth_missing",
      message: `Claude OAuth capture requires Claude Code's profile and the OAuth token printed by claude setup-token. Run claude setup-token first, then capture it with CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth --profile-root '${claudeProfileRoot}'.`,
      remediation: "claude setup-token",
      subject: {
        env: "CLAUDE_CODE_OAUTH_TOKEN",
        setupCommands: [
          "claude setup-token",
          `CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth --profile-root '${claudeProfileRoot}'`,
        ],
      },
    });

    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "bogus");
    const claudeInvalidToken = await invoke(["login", "claude", "--profile-root", claudeProfileRoot, "--json"]);
    expect(claudeInvalidToken.code).toBe(2);
    expect(stdoutJson(claudeInvalidToken)).toMatchObject({
      ok: false,
      code: "provider_oauth_invalid",
      message: `CLAUDE_CODE_OAUTH_TOKEN must be the OAuth token printed by claude setup-token. Run claude setup-token first, then capture it with CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth --profile-root '${claudeProfileRoot}'.`,
      remediation: "claude setup-token",
      subject: {
        env: "CLAUDE_CODE_OAUTH_TOKEN",
        setupCommands: [
          "claude setup-token",
          `CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth --profile-root '${claudeProfileRoot}'`,
        ],
      },
    });

    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "sk-ant-oat01-test");
    const claudeCaptured = await invoke(["login", "claude", "--profile-root", claudeProfileRoot, "--json"]);
    expect(claudeCaptured.code, claudeCaptured.stdout || claudeCaptured.stderr).toBe(0);
    expect(stdoutJson(claudeCaptured)).toMatchObject({
      ok: true,
      provider: "claude",
      localAdapter: {
        adapter: "claude",
        method: "oauth",
        status: "connected",
      },
    });

    const status = await invoke(["status", "--dir", authRoot, "--json"]);
    expect(stdoutJson<{ auth: { adapters: Array<{ adapter: string; status: string }> } }>(status).auth.adapters)
      .toEqual([expect.objectContaining({ adapter: "claude", status: "connected" })]);

    const projectRoot = await makeTempRoot("workbench-cli-provider-status-");
    expect((await invoke(["new", projectRoot, "--agent", "claude", "--json"])).code).toBe(0);
    const humanStatus = await invoke(["status", "--dir", projectRoot]);
    expect(humanStatus.code, humanStatus.stdout || humanStatus.stderr).toBe(0);
    expect(humanStatus.stdout).toContain("Connected providers: claude/default");
  });

  test("provider eval auth preflight preserves OAuth token-generation guidance without evidence", async () => {
    const authRoot = await makeTempRoot("workbench-cli-eval-provider-auth-");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(authRoot, "config.json"));
    vi.stubEnv("WORKBENCH_ADAPTER_AUTH_STORE", authRoot);
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");

    const codexRoot = await makeTempRoot("workbench-cli-eval-codex-auth-");
    expect((await invoke(["new", codexRoot, "--agent", "codex", "--json"])).code).toBe(0);
    await writePassingCaseTest(codexRoot);
    const codexDryRun = await invoke(["eval", "--dry-run", "--dir", codexRoot, "--json"]);
    expect(codexDryRun.code, codexDryRun.stdout || codexDryRun.stderr).toBe(0);
    expect(stdoutJson(codexDryRun)).toMatchObject({
      ok: true,
      plan: {
        location: "local",
        cases: 1,
        samples: 1,
        readiness: {
          ready: false,
          issues: [
            {
              code: "adapter_auth_required",
              remediation: "codex login --device-auth",
              subject: {
                setupCommands: [
                  "codex login --device-auth",
                  "workbench login codex --method oauth",
                ],
              },
            },
          ],
        },
      },
      readiness: {
        ready: false,
        issues: [
          {
            code: "adapter_auth_required",
            remediation: "codex login --device-auth",
            subject: {
              setupCommands: [
                "codex login --device-auth",
                "workbench login codex --method oauth",
              ],
            },
          },
        ],
      },
      next: "codex login --device-auth",
    });
    expect(stdoutJson<{ entries: unknown[] }>(await invoke(["log", "--runs", "--dir", codexRoot, "--json"])).entries).toEqual([]);

    const codexResult = await invoke(["eval", "--dir", codexRoot, "--json"]);
    expect(codexResult.code, codexResult.stdout || codexResult.stderr).toBe(1);
    expect(stderrJsonLines(codexResult)).toEqual([]);
    expect(stdoutJson(codexResult)).toMatchObject({
      ok: false,
      code: "adapter_auth_required",
      remediation: "codex login --device-auth",
    });
    expect(stdoutJson<{ entries: unknown[] }>(await invoke(["log", "--runs", "--dir", codexRoot, "--json"])).entries).toEqual([]);
    const codexRetry = await invoke(["eval", "--dir", codexRoot, "--json"]);
    expect(codexRetry.code, codexRetry.stdout || codexRetry.stderr).toBe(1);
    expect(stdoutJson(codexRetry)).toMatchObject({
      ok: false,
      code: "adapter_auth_required",
      remediation: "codex login --device-auth",
    });

    const claudeRoot = await makeTempRoot("workbench-cli-eval-claude-auth-");
    expect((await invoke(["new", claudeRoot, "--agent", "claude", "--json"])).code).toBe(0);
    await writePassingCaseTest(claudeRoot);
    const claudeResult = await invoke(["eval", "--dir", claudeRoot, "--json"]);
    expect(claudeResult.code, claudeResult.stdout || claudeResult.stderr).toBe(1);
    expect(stderrJsonLines(claudeResult)).toEqual([]);
    expect(stdoutJson(claudeResult)).toMatchObject({
      ok: false,
      code: "adapter_auth_required",
      remediation: "claude setup-token",
    });
    expect(stdoutJson<{ entries: unknown[] }>(await invoke(["log", "--runs", "--dir", claudeRoot, "--json"])).entries).toEqual([]);
  });

  test("provider improve auth failures surface login remediation directly", async () => {
    const authRoot = await makeTempRoot("workbench-cli-improve-provider-auth-");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(authRoot, "config.json"));
    vi.stubEnv("WORKBENCH_ADAPTER_AUTH_STORE", authRoot);
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const root = await makeTempRoot("workbench-cli-improve-codex-auth-");
    expect((await invoke(["new", root, "--agent", "codex", "--json"])).code).toBe(0);
    await seedFailedImproveEvidence(root, "default");

    const improved = await invoke(["improve", "--dir", root, "--json"]);
    expect(improved.code, improved.stdout || improved.stderr).toBe(1);
    expect(stdoutJson(improved)).toMatchObject({
      ok: false,
      code: "improve_failed",
      remediation: "codex login --device-auth",
    });
  });

  test("installs Workbench source snapshots from URL and owner/name handles without delegated output", async () => {
    const previousToken = process.env.WORKBENCH_API_TOKEN;
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousHome = process.env.HOME;
    const configRoot = await makeTempRoot("workbench-cli-install-handle-config-");
    const homeRoot = await makeTempRoot("workbench-cli-install-handle-home-");
    const configPath = path.join(configRoot, "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_API_TOKEN = "install-token";
    process.env.HOME = homeRoot;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
    }));
    const fullPinnedVersionId = "v_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer install-token");
      if (url.pathname === "/api/workbench/source/skills/alice/private-skill/versions/abcdef12/source") {
        return jsonResponse({
          schema: "workbench.source.snapshot.v1",
          owner: "alice",
          name: "private-skill",
          versionId: fullPinnedVersionId,
          files: [{
            path: "SKILL.md",
            kind: "text",
            encoding: "utf8",
            executable: false,
            content: [
              "---",
              "name: private-skill",
              "description: Private skill pinned fixture.",
              "---",
              "# Private Skill",
              "",
            ].join("\n"),
          }],
        });
      }
      if (
        url.pathname === "/api/workbench/source/skills/alice/private-skill/versions/v007/source" ||
        url.pathname === "/api/workbench/source/skills/alice/private-skill/source"
      ) {
        return jsonResponse({
          schema: "workbench.source.snapshot.v1",
          owner: "alice",
          name: "private-skill",
          versionId: "v007",
          files: [{
            path: "SKILL.md",
            kind: "text",
            encoding: "utf8",
            executable: false,
            content: [
              "---",
              "name: private-skill",
              "description: Private skill fixture.",
              "---",
              "# Private Skill",
              "",
            ].join("\n"),
          }],
        });
      }
      if (url.pathname === "/api/workbench/source/skills/alice/private-skill/versions/missing/source") {
        return jsonResponse({
          schema: "workbench.cloud.error.v1",
          code: "source_version_not_found",
          message: "Published source version not found: missing.",
          retryable: false,
          remediation: "workbench publish",
        }, 404);
      }
      if (url.pathname === "/api/workbench/source/skills/alice/missing-skill/source") {
        return jsonResponse({
          schema: "workbench.cloud.error.v1",
          code: "source_not_available",
          message: "No published source is available.",
          retryable: false,
          remediation: "workbench login",
        }, 404);
      }
      return jsonResponse({ message: `Unexpected path ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const installed = await invoke([
        "install",
        "https://cloud.test/skills/alice/private-skill/versions/v007",
        "--target",
        "codex",
        "--scope",
        "global",
        "--dry-run",
        "--json",
      ]);

      expect(installed.code).toBe(0);
      expect(stdoutJson(installed)).toMatchObject({
        schema: "workbench.cli.install.v3",
        ok: true,
        source: {
          kind: "workbench-cloud",
          owner: "alice",
          skill: "private-skill",
          versionId: "v007",
          installHandle: "alice/private-skill",
        },
        result: "planned",
        dryRun: true,
        filesCopied: 0,
        targets: [expect.objectContaining({
          target: "codex",
          scope: "global",
          root: path.join(homeRoot, ".agents", "skills"),
          destination: path.join(homeRoot, ".agents", "skills", "private-skill"),
          previous: "none",
          filesCopied: 0,
        })],
      });
      expect(installed.stdout).not.toContain("\u001b[");
      const handleInstall = await invoke([
        "install",
        "Alice/Private.Skill",
        "--target",
        "codex",
        "--scope",
        "global",
        "--dry-run",
        "--json",
      ]);
      expect(handleInstall.code).toBe(0);
      expect(stdoutJson(handleInstall)).toMatchObject({
        source: {
          owner: "alice",
          skill: "private-skill",
          installHandle: "alice/private-skill",
        },
      });
      const handleVersionInstall = await invoke([
        "install",
        "Alice/Private.Skill@v007",
        "--target",
        "codex",
        "--scope",
        "global",
        "--dry-run",
        "--json",
      ]);
      expect(handleVersionInstall.code).toBe(0);
      expect(stdoutJson(handleVersionInstall)).toMatchObject({
        source: {
          owner: "alice",
          skill: "private-skill",
          versionId: "v007",
          installHandle: "alice/private-skill",
        },
      });
      const handleShortVersionInstall = await invoke([
        "install",
        "Alice/Private.Skill@abcdef12",
        "--target",
        "codex",
        "--scope",
        "global",
        "--dry-run",
        "--json",
      ]);
      expect(handleShortVersionInstall.code).toBe(0);
      expect(stdoutJson(handleShortVersionInstall)).toMatchObject({
        source: {
          owner: "alice",
          skill: "private-skill",
          versionId: fullPinnedVersionId,
          installHandle: "alice/private-skill",
        },
      });
      const missingVersion = await invoke([
        "install",
        "alice/private-skill@missing",
        "--target",
        "codex",
        "--scope",
        "global",
        "--json",
      ]);
      expect(missingVersion.code, missingVersion.stdout || missingVersion.stderr).toBe(1);
      expect(stdoutJson(missingVersion)).toMatchObject({
        ok: false,
        code: "source_version_not_found",
        remediation: "workbench install alice/private-skill --target codex --scope global",
      });
      const missingVersionCloneRoot = path.join(await makeTempRoot("workbench-cli-clone-missing-version-parent-"), "clone");
      const missingVersionClone = await invoke([
        "clone",
        "https://cloud.test/skills/alice/private-skill/versions/missing",
        missingVersionCloneRoot,
        "--json",
      ]);
      expect(missingVersionClone.code, missingVersionClone.stdout || missingVersionClone.stderr).toBe(1);
      expect(stdoutJson(missingVersionClone)).toMatchObject({
        ok: false,
        code: "source_version_not_found",
        remediation: `workbench clone https://cloud.test/skills/alice/private-skill '${missingVersionCloneRoot}'`,
      });
      const cloneRoot = path.join(await makeTempRoot("workbench-cli-clone-short-ref-parent-"), "clone");
      const clonedShortVersion = await invoke([
        "clone",
        "Alice/Private.Skill@abcdef12",
        cloneRoot,
        "--json",
      ]);
      expect(clonedShortVersion.code, clonedShortVersion.stdout || clonedShortVersion.stderr).toBe(0);
      expect(stdoutJson(clonedShortVersion)).toMatchObject({
        source: {
          owner: "alice",
          skill: "private-skill",
          versionId: fullPinnedVersionId,
          installHandle: "alice/private-skill",
        },
      });
      const missing = await invoke([
        "install",
        "alice/missing-skill",
        "--target",
        "codex",
        "--scope",
        "global",
        "--dry-run",
        "--json",
      ]);
      expect(missing.code, missing.stdout || missing.stderr).toBe(1);
      const missingJson = stdoutJson(missing);
      expect(missingJson).toMatchObject({
        ok: false,
        code: "source_not_available",
        message: "No published source is available. You are already logged in; verify the OWNER/SKILL handle or ask the owner for access.",
        subject: { authenticated: true },
      });
      expect(missingJson).not.toHaveProperty("remediation");
      expect(fetchMock).toHaveBeenCalledTimes(8);
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousToken === undefined) {
        delete process.env.WORKBENCH_API_TOKEN;
      } else {
        process.env.WORKBENCH_API_TOKEN = previousToken;
      }
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }
  }, 30_000);

  test("keeps sync plumbing available", async () => {
    const root = await makeTempRoot("workbench-cli-remotes-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);

    const badRoot = await makeTempRoot("workbench-cli-bad-remote-");
    const badFile = path.join(badRoot, "not-a-directory");
    await fs.writeFile(badFile, "not a directory");
    const badRemoteUrl = pathToFileURL(badFile).toString();
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  broken:",
      `    url: ${badRemoteUrl}`,
      "    kind: file",
      "",
    ].join("\n"));
    const brokenSync = await invoke(["sync", "broken", "--dir", root, "--json"]);
    expect(brokenSync.code).toBe(1);
    expect(stdoutJson(brokenSync)).toMatchObject({ ok: false, code: "sync_failed" });
    const status = await invoke(["status", "--dir", root, "--json"]);
    expect(status.code).toBe(0);
    const statusJson = stdoutJson<{ next: string | null; remotes: Array<{ name: string; sync: { status: string; lastError: { code: string } | null } }> }>(status);
    expect(statusJson.next).toBe("workbench sync broken");
    expect(statusJson.remotes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "broken",
        sync: expect.objectContaining({
          status: "error",
          lastError: expect.objectContaining({ code: expect.any(String) }),
        }),
      }),
    ]));
    expect(JSON.stringify(statusJson.remotes)).not.toContain("nextCommand");
  });

  test("sync json reports final status and whether objects changed", async () => {
    const root = await makeTempRoot("workbench-cli-sync-json-");
    const remote = await makeTempRoot("workbench-cli-sync-json-remote-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await addWorkbenchRemote("origin", pathToFileURL(remote).toString(), { dir: root });

    const first = await invoke(["sync", "origin", "--dir", root, "--json"]);
    expect(first.code, first.stdout || first.stderr).toBe(0);
    const firstJson = stdoutJson<{
      status: string;
      changed: boolean;
      pushed: number;
      pulled: number;
      upToDate?: boolean;
    }>(first);
    expect(firstJson).toMatchObject({
      schema: "workbench.cli.sync.v1",
      ok: true,
      status: "synced",
      changed: true,
      pulled: 0,
    });
    expect(firstJson.pushed).toBeGreaterThan(0);
    expect(firstJson.upToDate).toBeUndefined();

    const second = await invoke(["sync", "origin", "--dir", root, "--json"]);
    expect(second.code, second.stdout || second.stderr).toBe(0);
    expect(stdoutJson(second)).toMatchObject({
      schema: "workbench.cli.sync.v1",
      ok: true,
      status: "synced",
      changed: false,
      pushed: 0,
      pulled: 0,
    });

    const versionId = stdoutJson<{ entries: Array<{ id: string }> }>(
      await invoke(["log", "--versions", "--dir", root, "--json"]),
    ).entries[0]!.id;
    await fs.mkdir(path.join(root, ".workbench", "objects", "run"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "objects", "run", "run_sync_queued.json"), JSON.stringify({
      id: "run_sync_queued",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "queued",
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-11T00:00:00.000Z",
    }));
    const dryRunActive = await invoke(["sync", "origin", "--dir", root, "--dry-run", "--json"]);
    expect(dryRunActive.code, dryRunActive.stdout || dryRunActive.stderr).toBe(0);
    expect(stdoutJson(dryRunActive)).toMatchObject({
      schema: "workbench.cli.sync.v1",
      ok: true,
      status: "dry_run",
      changed: true,
      dryRun: true,
      next: "workbench sync origin",
      note: "Dry-run checked the remote without updating local sync status; run the next command to reconcile.",
    });
    const dryRunActiveHuman = await invoke(["sync", "origin", "--dir", root, "--dry-run"]);
    expect(dryRunActiveHuman.code, dryRunActiveHuman.stdout || dryRunActiveHuman.stderr).toBe(0);
    expect(dryRunActiveHuman.stdout).toContain("Dry-run checked the remote without updating local sync status");
    expect(dryRunActiveHuman.stdout).not.toContain("(up to date)");
    const active = await invoke(["sync", "origin", "--dir", root, "--json"]);
    expect(active.code, active.stdout || active.stderr).toBe(0);
    expect(stdoutJson(active)).toMatchObject({
      schema: "workbench.cli.sync.v1",
      ok: true,
      next: "workbench run watch run_sync_que",
    });
    const activeHuman = await invoke(["sync", "origin", "--dir", root]);
    expect(activeHuman.code, activeHuman.stdout || activeHuman.stderr).toBe(0);
    expect(activeHuman.stdout).toContain("next: workbench run watch run_sync_que");
  });

  test("diff without a range compares current source to its parent", async () => {
    const root = await makeTempRoot("workbench-cli-diff-default-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await fs.appendFile(path.join(root, "SKILL.md"), "\nDefault diff edit.\n");
    const diff = await invoke(["diff", "--dir", root, "--json"]);
    expect(diff.code, diff.stdout || diff.stderr).toBe(0);
    expect(stdoutJson<{ result: Array<{ path: string; status: string }> }>(diff).result)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: "SKILL.md", status: "modified" })]));
    const human = await invoke(["diff", "--dir", root]);
    expect(human.code, human.stdout || human.stderr).toBe(0);
    expect(human.stdout).toContain("diff --workbench SKILL.md");
    expect(human.stdout).toContain("--- a/SKILL.md");
    expect(human.stdout).toContain("+++ b/SKILL.md");
    expect(human.stdout).toContain("+Default diff edit.");
  });

  test("invalid version selections include a recovery command", async () => {
    const root = await makeTempRoot("workbench-cli-invalid-version-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);

    const results = await invoke(["results", "--versions", "deadbeef..badc0de", "--dir", root, "--json"]);
    expect(results.code, results.stdout || results.stderr).toBe(2);
    expect(stdoutJson(results)).toMatchObject({
      ok: false,
      code: "usage",
      message: expect.stringContaining("Version not found: deadbeef..badc0de."),
      remediation: "workbench results --versions current",
      subject: { configuredVersions: ["current"] },
    });
  });

  test("versions lists immutable source versions", async () => {
    const root = await makeTempRoot("workbench-cli-versions-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const currentVersionId = await currentVersionIdFor(root);

    const result = await invoke(["versions", "--dir", root, "--json"]);
    expect(result.code, result.stdout || result.stderr).toBe(0);
    expect(stdoutJson<{ schema: string; versions: Array<{ id: string; fileCount: number }> }>(result))
      .toMatchObject({
        schema: "workbench.cli.versions.v1",
        versions: [expect.objectContaining({
          id: currentVersionId,
          fileCount: expect.any(Number),
        })],
      });
  });

  test("status switches forward instead of publishing when current source is older than the published Cloud version", async () => {
    const root = await makeTempRoot("workbench-cli-status-published-descendant-");
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "status-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    const evalResult = await invoke(["eval", "--dir", root, "--json"]);
    expect(evalResult.code, evalResult.stdout || evalResult.stderr).toBe(0);
    const evalJson = stdoutJson<{ run: { plan: { versionId: string }; next?: string }; next: string | null }>(evalResult);
    expect(evalJson).toHaveProperty("next");
    expect(evalJson.run).not.toHaveProperty("next");
    const baseVersionId = evalJson.run.plan.versionId;

    await fs.appendFile(path.join(root, "SKILL.md"), "\nPublished descendant edit.\n");
    const descendantVersionId = await currentVersionIdFor(root);
    expect(descendantVersionId).not.toBe(baseVersionId);
    expect((await invoke(["switch", baseVersionId, "--dir", root])).code).toBe(0);

    const remoteUrl = "https://cloud.test/skills/alice/lineage-skill";
    await addWorkbenchRemote("cloud", remoteUrl, { dir: root });
    const publishedAt = "2026-06-11T00:00:00.000Z";
    await fs.mkdir(path.join(root, ".workbench", "sync"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "sync", "cloud.json"), JSON.stringify({
      schema: "workbench.remote-sync-state.v1",
      remote: "cloud",
      url: remoteUrl,
      status: "synced",
      lastSyncedAt: publishedAt,
      lastAttemptAt: publishedAt,
      lastError: null,
    }, null, 2));
    await writeRef(root, "remotes/cloud/publication/current-version", descendantVersionId);
    await writeRef(root, `remotes/cloud/publication/versions/${descendantVersionId}`, descendantVersionId);
    await writeRef(root, "remotes/cloud/publication/visibility", "private");
    await writeRef(root, "remotes/cloud/publication/install-handle", "alice/lineage-skill");

    const status = await invoke(["status", "--dir", root, "--json"]);
    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(status).next).toBe(`workbench switch ${shortTestRef(descendantVersionId)}`);
  });

  test("status reports the source-matched version after reverting an edit", async () => {
    const root = await makeTempRoot("workbench-cli-status-reverted-source-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    const baseVersionId = await currentVersionIdFor(root);
    const baseSkill = await fs.readFile(path.join(root, "SKILL.md"), "utf8");

    await fs.appendFile(path.join(root, "SKILL.md"), "\nTemporary slow-path edit.\n");
    const evalResult = await invoke(["eval", "--dir", root, "--json"]);
    expect(evalResult.code, evalResult.stdout || evalResult.stderr).toBe(0);
    const editedVersionId = stdoutJson<{ run: { plan: { versionId: string } } }>(evalResult).run.plan.versionId;
    expect(editedVersionId).not.toBe(baseVersionId);

    await fs.writeFile(path.join(root, "SKILL.md"), baseSkill);
    const status = await invoke(["status", "--dir", root, "--json"]);
    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(stdoutJson<{ project: { currentVersionId: string }; worktree: { latestVersionId: string } }>(status))
      .toMatchObject({
        project: { currentVersionId: baseVersionId },
        worktree: { latestVersionId: baseVersionId },
      });
  });

  test("published-current source does not keep recommending publish or install", async () => {
    const root = await makeTempRoot("workbench-cli-status-published-current-");
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "status-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    const firstEval = await invoke(["eval", "--dir", root, "--json"]);
    expect(firstEval.code, firstEval.stdout || firstEval.stderr).toBe(0);
    const currentVersionId = stdoutJson<{ run: { plan: { versionId: string } }; next: string | null }>(firstEval).run.plan.versionId;

    const remoteUrl = "https://cloud.test/skills/alice/current-skill";
    await addWorkbenchRemote("cloud", remoteUrl, { dir: root });
    const publishedAt = "2026-06-11T00:00:00.000Z";
    await fs.mkdir(path.join(root, ".workbench", "sync"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "sync", "cloud.json"), JSON.stringify({
      schema: "workbench.remote-sync-state.v1",
      remote: "cloud",
      url: remoteUrl,
      status: "synced",
      lastSyncedAt: publishedAt,
      lastAttemptAt: publishedAt,
      lastError: null,
    }, null, 2));
    await writeRef(root, "remotes/cloud/publication/current-version", currentVersionId);
    await writeRef(root, `remotes/cloud/publication/versions/${currentVersionId}`, currentVersionId);
    await writeRef(root, "remotes/cloud/publication/visibility", "private");
    await writeRef(root, "remotes/cloud/publication/install-handle", "alice/published-skill");

    const rerun = await invoke(["eval", "--rerun", "--dir", root, "--json"]);
    expect(rerun.code, rerun.stdout || rerun.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(rerun).next).toBe("workbench results");

    const status = await invoke(["status", "--dir", root, "--json"]);
    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(status).next).toBe("workbench results");
  });

  test("logged-out Cloud status reports auth_required before local changes or stale failed runs", async () => {
    const root = await makeTempRoot("workbench-cli-status-cloud-auth-required-");
    const configRoot = await makeTempRoot("workbench-cli-status-cloud-auth-required-config-");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(configRoot, "missing-config.json"));
    vi.stubEnv("WORKBENCH_API_TOKEN", "");
    vi.stubEnv("WORKBENCH_SMOKE_BEARER_TOKEN", "");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    const evalResult = await invoke(["eval", "--dir", root, "--json"]);
    expect(evalResult.code, evalResult.stdout || evalResult.stderr).toBe(0);
    const currentVersionId = stdoutJson<{ run: { plan: { versionId: string } } }>(evalResult).run.plan.versionId;

    const remoteUrl = "https://cloud.test/skills/alice/status-skill";
    await addWorkbenchRemote("cloud", remoteUrl, { dir: root });
    const syncedAt = "2026-06-11T00:00:00.000Z";
    await fs.mkdir(path.join(root, ".workbench", "sync"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "sync", "cloud.json"), JSON.stringify({
      schema: "workbench.remote-sync-state.v1",
      remote: "cloud",
      url: remoteUrl,
      status: "error",
      lastSyncedAt: null,
      lastAttemptAt: syncedAt,
      lastError: {
        code: "auth_required",
        message: "Authentication is required.",
      },
    }, null, 2));
    await writeRef(root, "remotes/cloud/publication/current-version", currentVersionId);
    await writeRef(root, `remotes/cloud/publication/versions/${currentVersionId}`, currentVersionId);
    await writeRef(root, "remotes/cloud/publication/visibility", "private");
    await writeRef(root, "remotes/cloud/publication/install-handle", "alice/status-skill");
    await recordWorkbenchLocalHostedRunHandle({
      dir: root,
      run: {
        id: "run_stale_failed_cloud",
        kind: "eval",
        versionId: currentVersionId,
        skillName: "current",
        skillBundleHash: "bundle_stale_failed_cloud",
        evalHash: "eval_stale_failed_cloud",
        agentName: "default",
        agentHash: "agent_stale_failed_cloud",
        status: "failed",
        jobIds: [],
        traceIds: [],
        createdAt: "9999-01-01T00:00:00.000Z",
        finishedAt: "9999-01-01T00:00:01.000Z",
        location: "cloud",
        remoteName: "cloud",
        requestedSamples: 1,
        error: "Older failed hosted run.",
      },
    });
    await fs.appendFile(path.join(root, "SKILL.md"), "\nLogged out edit.\n");

    const status = await invoke(["status", "--dir", root, "--json"]);

    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(stdoutJson<{
      next: string | null;
      remotes: Array<{ name: string; sync: { status: string; lastError: { code: string; message: string } | null } }>;
    }>(status)).toMatchObject({
      next: "workbench login",
      remotes: [expect.objectContaining({
        name: "cloud",
        sync: expect.objectContaining({
          status: "auth_required",
          lastError: {
            code: "auth_required",
            message: "Log in to reconcile Workbench Cloud sync state.",
          },
        }),
      })],
    });
    const human = await invoke(["status", "--dir", root]);
    expect(human.stdout).toContain("sync=auth_required");
    expect(human.stdout).toContain("next: workbench login");
  });

  test("status recommends eval before login when the current version has no scored proof", async () => {
    const root = await makeTempRoot("workbench-cli-status-current-proof-");
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "missing-config.json");
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    vi.stubEnv("WORKBENCH_API_TOKEN", "");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);

    const firstStatus = await invoke(["status", "--dir", root, "--json"]);
    expect(firstStatus.code, firstStatus.stdout || firstStatus.stderr).toBe(0);
    const firstVersionId = stdoutJson<{ project: { currentVersionId: string } }>(firstStatus).project.currentVersionId;

    await fs.mkdir(path.join(root, ".workbench", "objects", "run"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "objects", "run", "run_historical.json"), JSON.stringify({
      id: "run_historical",
      kind: "eval",
      versionId: firstVersionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "succeeded",
      score: 1,
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-11T00:00:00.000Z",
    }));

    await writePassingCaseTest(root, "case-002");
    const currentVersionId = await currentVersionIdFor(root);
    const status = await invoke(["status", "--dir", root, "--json"]);

    expect(status.code, status.stdout || status.stderr).toBe(0);
    const statusJson = stdoutJson<{ project: { currentVersionId: string }; next: string | null }>(status);
    expect(currentVersionId).not.toBe(firstVersionId);
    expect(statusJson.project.currentVersionId).not.toBe(firstVersionId);
    expect(statusJson.next).toBe("workbench eval");
  });

  test("status routes below-perfect current evidence to executable improve setup before cloud login or publish", async () => {
    const root = await makeTempRoot("workbench-cli-status-below-perfect-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/partial-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    await writePassingCaseTest(root);
    const currentVersionId = await currentVersionIdFor(root);
    await fs.mkdir(path.join(root, ".workbench", "objects", "run"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "objects", "run", "run_partial.json"), JSON.stringify({
      id: "run_partial",
      kind: "eval",
      versionId: currentVersionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "succeeded",
      score: 0.5,
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-11T00:00:00.000Z",
      finishedAt: "2026-06-11T00:00:01.000Z",
    }));

    vi.stubEnv("WORKBENCH_CONFIG", path.join(await makeTempRoot("workbench-cli-missing-config-"), "missing.json"));
    vi.stubEnv("WORKBENCH_API_TOKEN", "");
    const unauthenticatedStatus = await invoke(["status", "--dir", root, "--json"]);

    expect(unauthenticatedStatus.code, unauthenticatedStatus.stdout || unauthenticatedStatus.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(unauthenticatedStatus).next)
      .toBe("workbench agent add improver --adapter codex --model gpt-5.4-mini --with auth=default");

    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    const authenticatedStatus = await invoke(["status", "--dir", root, "--json"]);

    expect(authenticatedStatus.code, authenticatedStatus.stdout || authenticatedStatus.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(authenticatedStatus).next)
      .toBe("workbench agent add improver --adapter codex --model gpt-5.4-mini --with auth=default");
  });

  dockerTest("status preserves the higher-sample rerun guidance after a promoted one-sample improve", async () => {
    const root = await makeTempRoot("workbench-cli-status-post-improve-");
    const marker = "Improved by status guidance.";
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writeSkillDependentCaseTest(root, marker);
    const added = await invoke([
      "agent",
      "add",
      "patcher",
      "--dir",
      root,
      "--adapter",
      "command",
      "--with",
      `improveCommand=printf '\\n${marker}\\n' >> "$SKILL_DIR/SKILL.md"`,
    ]);
    expect(added.code, added.stdout || added.stderr).toBe(0);

    const failingEval = await invoke(["eval", "--dir", root, "--agents", "patcher", "--json"]);
    expect(failingEval.code, failingEval.stdout || failingEval.stderr).toBe(1);
    const improve = await invoke(["improve", "--dir", root, "--agents", "patcher", "--budget", "1", "-n", "1", "--json"]);
    expect(improve.code, improve.stdout || improve.stderr).toBe(0);
    expect(stdoutJson<{ next: string; switched: boolean }>(improve))
      .toMatchObject({ switched: true, next: "workbench eval --rerun -n 5" });

    const status = await invoke(["status", "--dir", root, "--json"]);
    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(status).next).toBe("workbench eval --rerun -n 5");
  }, 60_000);

  dockerTest("status does not suggest switching a tied improve candidate", async () => {
    const root = await makeTempRoot("workbench-cli-status-tied-improve-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await fs.mkdir(path.join(root, ".workbench", "cases", "case-001", "tests"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "case.yaml"), [
      "version: 1",
      "id: case-001",
      "prompt: Exercise a tied improvement candidate.",
      "command: sh \"$CASE_DIR/tests/test.sh\"",
      "",
    ].join("\n"));
    await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), [
      "#!/bin/sh",
      "set -eu",
      "mkdir -p \"$OUTPUT_DIR\"",
      "printf '{\"ok\":true,\"score\":0.5,\"metrics\":{\"score\":0.5}}\\n' > \"$OUTPUT_DIR/result.json\"",
      "",
    ].join("\n"));
    await fs.chmod(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), 0o755);
    const added = await invoke([
      "agent",
      "add",
      "patcher",
      "--dir",
      root,
      "--adapter",
      "command",
      "--with",
      "improveCommand=printf '\\nTied candidate.\\n' >> \"$SKILL_DIR/SKILL.md\"",
    ]);
    expect(added.code, added.stdout || added.stderr).toBe(0);

    const evalResult = await invoke(["eval", "--dir", root, "--agents", "patcher", "--json"]);
    expect(evalResult.code, evalResult.stdout || evalResult.stderr).toBe(0);
    const improve = await invoke(["improve", "--dir", root, "--agents", "patcher"]);
    expect(improve.code, improve.stdout || improve.stderr).toBe(0);
    expect(improve.stdout).toContain("Created candidate");
    expect(improve.stdout).toContain("Did not switch:");
    expect(improve.stdout).not.toContain("Improved ");

    const status = await invoke(["status", "--dir", root, "--json"]);
    expect(status.code, status.stdout || status.stderr).toBe(0);
    const next = stdoutJson<{ next: string | null }>(status).next;
    expect(next).toBe("workbench improve --versions 'current' --agents 'patcher'");
    expect(next).not.toMatch(/^workbench switch\b/u);
  }, 60_000);

  test("status suggests results after a successful smoke eval", async () => {
    const root = await makeTempRoot("workbench-cli-status-smoke-case-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await fs.mkdir(path.join(root, ".workbench", "cases", "case-001"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "case.yaml"), [
      "version: 1",
      "id: case-001",
      "smoke: true",
      "command: \"true\"",
      "",
    ].join("\n"));

    await currentVersionIdFor(root);
    const preEvalStatus = await invoke(["status", "--dir", root, "--json"]);
    expect(preEvalStatus.code, preEvalStatus.stdout || preEvalStatus.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(preEvalStatus).next).toBe("workbench eval");

    const evalResult = await invoke(["eval", "--dir", root, "--json"]);
    expect(evalResult.code, evalResult.stdout || evalResult.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(evalResult).next).toBe("workbench results");
    const status = await invoke(["status", "--dir", root, "--json"]);
    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(status).next).toBe("workbench results");
  });

  test("eval JSON terminal progress uses the final publish-ready next command", async () => {
    const root = await makeTempRoot("workbench-cli-eval-progress-next-");
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "command", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);

    const result = await invoke(["eval", "--dir", root, "--json"]);

    expect(result.code, result.stdout || result.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(result).next).toBe("workbench publish");
    const progress = stderrJsonLines<{ phase: string; next?: string }>(result);
    expect(progress.find((entry) => entry.phase === "complete")).toMatchObject({
      next: "workbench publish",
    });
  });

  test("status points at a running run before generic next steps", async () => {
    const root = await makeTempRoot("workbench-cli-status-running-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const versionId = stdoutJson<{ entries: Array<{ id: string }> }>(
      await invoke(["log", "--versions", "--dir", root, "--json"]),
    ).entries[0]!.id;

    await fs.mkdir(path.join(root, ".workbench", "objects", "run"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "objects", "run", "run_live.json"), JSON.stringify({
      id: "run_live",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "running",
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-11T00:00:00.000Z",
    }));

    const status = await invoke(["status", "--dir", root, "--json"]);
    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(status).next).toBe("workbench run watch run_live");
  });

  test("status points at a queued run before generic next steps", async () => {
    const root = await makeTempRoot("workbench-cli-status-queued-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const versionId = stdoutJson<{ entries: Array<{ id: string }> }>(
      await invoke(["log", "--versions", "--dir", root, "--json"]),
    ).entries[0]!.id;

    await fs.mkdir(path.join(root, ".workbench", "objects", "run"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "objects", "run", "run_queued.json"), JSON.stringify({
      id: "run_queued",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "queued",
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-11T00:00:00.000Z",
    }));

    const status = await invoke(["status", "--dir", root, "--json"]);
    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(status).next).toBe("workbench run watch run_queued");
  });

  test("show resolves canonical run evidence before internal or trace duplicates", async () => {
    const root = await makeTempRoot("workbench-cli-show-canonical-evidence-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const versionId = stdoutJson<{ entries: Array<{ id: string }> }>(
      await invoke(["log", "--versions", "--dir", root, "--json"]),
    ).entries[0]!.id;
    const createdAt = "2026-06-11T00:00:00.000Z";

    await fs.mkdir(path.join(root, ".workbench", "objects", "run"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "job"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "trace"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "artifact"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "objects", "run", "run_surface.json"), JSON.stringify({
      id: "run_surface",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "succeeded",
      score: 1,
      requestedSamples: 5,
      latencyMs: 4219,
      jobIds: ["job_surface"],
      traceIds: ["trace_job_surface"],
      createdAt,
      finishedAt: createdAt,
    }));
    await fs.writeFile(path.join(root, ".workbench", "objects", "job", "job_surface.json"), JSON.stringify({
      id: "job_surface",
      runId: "run_surface",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      caseId: "case-001",
      sample: 0,
      status: "succeeded",
      score: 1,
      artifactIds: ["artifact_surface"],
      traceIds: ["trace_job_surface"],
      createdAt,
      startedAt: createdAt,
      finishedAt: createdAt,
      durationMs: 0,
    }));
    await fs.writeFile(path.join(root, ".workbench", "objects", "artifact", "artifact_surface.json"), JSON.stringify({
      id: "artifact_surface",
      runId: "run_surface",
      jobId: "job_surface",
      kind: "directory",
      path: "artifacts/job_surface",
      createdAt,
      files: [
        { path: "result.json", kind: "text", encoding: "utf8", content: "user result\n" },
        { path: "skill-summary.md", kind: "text", encoding: "utf8", content: "Provider answer line one.\nProvider answer line two.\n" },
        { path: "agent-session.json", kind: "text", encoding: "utf8", content: `${JSON.stringify({ schema: "workbench.agent.session.v1", provider: "codex", sessionId: "session-surface", ref: "codex:session-surface" }, null, 2)}\n` },
        { path: "rubric-scorecard.json", kind: "text", encoding: "utf8", content: `${JSON.stringify({ schema: "workbench.engine.rubric.evidence.v1", safeForImprover: true, score: 0.75, summary: "Useful answer.", criteria: [{ id: "accuracy", score: 0.5, rationale: "Missed one fact." }] }, null, 2)}\n` },
      ],
    }));
    await fs.writeFile(path.join(root, ".workbench", "objects", "trace", "trace_job_surface.json"), JSON.stringify({
      id: "trace_job_surface",
      runId: "run_surface",
      jobId: "job_surface",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      createdAt,
      request: {},
      result: { status: "succeeded" },
      files: [
        { path: "result.json", kind: "text", encoding: "utf8", content: "user result\n" },
        { path: "stderr.log", kind: "text", encoding: "utf8", content: "trace stderr\n" },
        { path: ".workbench/traces/job_surface/engine/result.json", kind: "text", encoding: "utf8", content: "internal result\n" },
      ],
    }));

    const shown = await invoke(["show", "run_surface:result.json", "--dir", root]);
    expect(shown.code, shown.stdout || shown.stderr).toBe(0);
    expect(shown.stdout).toBe("user result\n\n");

    const jobListing = stdoutJson<{ result: { jobs: Array<{ id: string }>; files: Array<{ path: string }> } }>(
      await invoke(["show", "job_surface", "--dir", root, "--json"]),
    );
    expect(jobListing.result.jobs).toEqual([expect.objectContaining({ id: "job_surface" })]);
    expect(jobListing.result.files.map((file) => file.path)).toContain("cases/case-001/jobs/job_surface/result.json");
    const jobStderr = await invoke(["show", "job_surface:stderr.log", "--dir", root]);
    expect(jobStderr.code, jobStderr.stdout || jobStderr.stderr).toBe(0);
    expect(jobStderr.stdout).toBe("trace stderr\n\n");
    const longJobId = "job_mqf3nijg_c3170a076e647cc9";
    await fs.writeFile(path.join(root, ".workbench", "objects", "job", `${longJobId}.json`), JSON.stringify({
      id: longJobId,
      runId: "run_surface",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      caseId: "case-001",
      sample: 0,
      status: "succeeded",
      score: 1,
      artifactIds: [],
      traceIds: [],
      createdAt,
      startedAt: createdAt,
      finishedAt: createdAt,
      durationMs: 0,
    }));
    const longJobHuman = await invoke(["show", "job_mqf3nijg_c", "--dir", root]);
    expect(longJobHuman.code, longJobHuman.stdout || longJobHuman.stderr).toBe(0);
    expect(longJobHuman.stdout).toContain(longJobId);
    expect(longJobHuman.stdout).not.toContain("job_mqf3nijg\tcase=");
    const traceListing = await invoke(["show", "trace_job_surface", "--dir", root]);
    expect(traceListing.code, traceListing.stdout || traceListing.stderr).toBe(0);
    expect(traceListing.stdout).toContain("trace\ttrace_job");
    expect(traceListing.stdout).toContain("workbench show 'trace_job_surface:stderr.log'");
    await fs.writeFile(path.join(root, ".workbench", "objects", "trace", "trace_job_orphan.json"), JSON.stringify({
      id: "trace_job_orphan",
      runId: "run_surface",
      jobId: "job_orphan",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      createdAt,
      request: {},
      result: { status: "failed", error: "orphan trace" },
      files: [{ path: "stderr.log", kind: "text", encoding: "utf8", content: "orphan stderr\n" }],
    }));
    const orphanJob = await invoke(["show", "job_orphan", "--dir", root, "--json"]);
    expect(orphanJob.code).toBe(1);
    expect(stdoutJson(orphanJob)).toMatchObject({
      code: "ref_not_found",
      message: "Workbench object not found: job_orphan",
    });
    const orphanJobFile = await invoke(["show", "job_orphan:stderr.log", "--dir", root, "--json"]);
    expect(orphanJobFile.code).toBe(1);
    expect(stdoutJson(orphanJobFile)).toMatchObject({
      code: "ref_not_found",
      message: "Workbench object not found: job_orphan",
    });

    const listing = stdoutJson<{ result: { progress: { schema: string; progress: { planned: number; completed: number; scored: number; evidenceCount: number; costUsd?: number } }; highlights: Array<{ kind: string; preview?: string; ref?: string; score?: number }>; files: Array<{ path: string; ref?: string }> } }>(
      await invoke(["show", "run_surface", "--dir", root, "--json"]),
    );
    expect(listing.result.progress).toMatchObject({
      schema: "workbench.run.v1",
      progress: {
        planned: 2,
        completed: 2,
        scored: 2,
        evidenceCount: 2,
      },
    });
    const paths = listing.result.files.map((file) => file.path);
    expect(paths).toContain("cases/case-001/jobs/job_surface/result.json");
    expect(paths).toContain("cases/case-001/jobs/job_surface/skill-summary.md");
    expect(listing.result.files).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "cases/case-001/jobs/job_surface/result.json",
        ref: "run_surface:cases/case-001/jobs/job_surface/result.json",
      }),
    ]));
    expect(listing.result.highlights).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "agent_output", preview: expect.stringContaining("Provider answer line one.") }),
      expect.objectContaining({ kind: "agent_session", ref: "codex:session-surface" }),
      expect.objectContaining({ kind: "rubric_scorecard", score: 0.75 }),
    ]));
    const session = await invoke(["show", "codex:session-surface", "--dir", root, "--json"]);
    expect(session.code, session.stdout || session.stderr).toBe(0);
    expect(stdoutJson<{ result: { id: string; path: string; excerpts: string[] } }>(session)).toMatchObject({
      result: {
        id: "codex:session-surface",
        path: "cases/case-001/jobs/job_surface/agent-session.json",
        excerpts: expect.arrayContaining([
          "Evidence file: cases/case-001/jobs/job_surface/agent-session.json",
          expect.stringContaining("Run run_surface; job job_surface; status succeeded."),
          expect.stringContaining("Provider answer line one."),
        ]),
      },
    });
    expect(paths.filter((entry) => entry.endsWith("/result.json"))).toEqual([
      "cases/case-001/jobs/job_surface/result.json",
    ]);
    expect(paths.some((entry) => entry.includes(".workbench"))).toBe(false);
    expect(paths.some((entry) => entry.includes("/traces/") && entry.endsWith("/result.json"))).toBe(false);
    const human = await invoke(["show", "run_surface", "--dir", root]);
    expect(human.code, human.stdout || human.stderr).toBe(0);
    expect(human.stdout).toContain("\ttotal_latency=4219ms\tavg_latency=844ms");
    expect(human.stdout).not.toContain("\tlatency=4219ms");
    expect(human.stdout).toContain("Progress: complete, work 2/2 complete, scored 2, failed 0");
    expect(human.stdout).toContain("evidence 2");
    expect(human.stdout).toContain("evidence\trun=run_surface\tjobs=job_surface\tstatus=succeeded");
    expect(human.stdout).toContain("Output cases/case-001/jobs/job_surface/skill-summary.md:");
    expect(human.stdout).toContain("Provider answer line one.");
    expect(human.stdout).toContain("Session cases/case-001/jobs/job_surface/agent-session.json: codex:session-surface");
    expect(human.stdout).toContain("Rubric cases/case-001/jobs/job_surface/rubric-scorecard.json: score=0.750 summary=Useful answer.");
    expect(human.stdout).toContain("workbench show 'run_surface:cases/case-001/jobs/job_surface/result.json'");
    expect(human.stdout).not.toContain("job:run_surface:job_surface");
  });

  test("show keeps genuinely distinct run evidence suffixes ambiguous", async () => {
    const root = await makeTempRoot("workbench-cli-show-distinct-evidence-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const versionId = stdoutJson<{ entries: Array<{ id: string }> }>(
      await invoke(["log", "--versions", "--dir", root, "--json"]),
    ).entries[0]!.id;
    const createdAt = "2026-06-11T00:00:00.000Z";

    await fs.mkdir(path.join(root, ".workbench", "objects", "run"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "job"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "artifact"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "objects", "run", "run_distinct.json"), JSON.stringify({
      id: "run_distinct",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "failed",
      score: 0,
      jobIds: ["job_one", "job_two"],
      traceIds: [],
      createdAt,
      finishedAt: createdAt,
    }));
    for (const [jobId, caseId, artifactId, content] of [
      ["job_one", "case-one", "artifact_one", "one\n"],
      ["job_two", "case-two", "artifact_two", "two\n"],
    ] as const) {
      await fs.writeFile(path.join(root, ".workbench", "objects", "job", `${jobId}.json`), JSON.stringify({
        id: jobId,
        runId: "run_distinct",
        kind: "eval",
        versionId,
        skillName: "current",
        skillBundleHash: "bundle_hash",
        evalHash: "eval_hash",
        agentName: "default",
        agentHash: "agent_hash",
        caseId,
        sample: 0,
        status: "failed",
        artifactIds: [artifactId],
        traceIds: [],
        createdAt,
        finishedAt: createdAt,
      }));
      await fs.writeFile(path.join(root, ".workbench", "objects", "artifact", `${artifactId}.json`), JSON.stringify({
        id: artifactId,
        runId: "run_distinct",
        jobId,
        kind: "directory",
        path: `artifacts/${jobId}`,
        createdAt,
        files: [{ path: "result.json", kind: "text", encoding: "utf8", content }],
      }));
    }

    const ambiguous = await invoke(["show", "run_distinct:result.json", "--dir", root, "--json"]);
    expect(ambiguous.code).toBe(2);
    expect(stdoutJson<{ code: string; subject: { candidates: string[] } }>(ambiguous)).toMatchObject({
      code: "ref_ambiguous",
      subject: {
        candidates: [
          "cases/case-one/jobs/job_one/result.json",
          "cases/case-two/jobs/job_two/result.json",
        ],
      },
    });
  });

  test("show prints unique job refs and keeps empty multi-job stderr ambiguous", async () => {
    const root = await makeTempRoot("workbench-cli-show-unique-job-refs-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const versionId = stdoutJson<{ entries: Array<{ id: string }> }>(
      await invoke(["log", "--versions", "--dir", root, "--json"]),
    ).entries[0]!.id;
    const createdAt = "2026-06-11T00:00:00.000Z";
    const jobIds = ["job_mqcadtt1aaaa1111", "job_mqcadtt1bbbb2222"];

    await fs.mkdir(path.join(root, ".workbench", "objects", "run"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "job"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "artifact"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "objects", "run", "run_same_prefix.json"), JSON.stringify({
      id: "run_same_prefix",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "succeeded",
      score: 1,
      jobIds,
      traceIds: [],
      createdAt,
      finishedAt: createdAt,
    }));
    for (const [index, jobId] of jobIds.entries()) {
      const artifactId = `artifact_same_prefix_${index}`;
      await fs.writeFile(path.join(root, ".workbench", "objects", "job", `${jobId}.json`), JSON.stringify({
        id: jobId,
        runId: "run_same_prefix",
        kind: "eval",
        versionId,
        skillName: "current",
        skillBundleHash: "bundle_hash",
        evalHash: "eval_hash",
        agentName: "default",
        agentHash: "agent_hash",
        caseId: `case-${index + 1}`,
        sample: 0,
        status: "succeeded",
        score: 1,
        artifactIds: [artifactId],
        traceIds: [],
        createdAt,
        finishedAt: createdAt,
      }));
      await fs.writeFile(path.join(root, ".workbench", "objects", "artifact", `${artifactId}.json`), JSON.stringify({
        id: artifactId,
        runId: "run_same_prefix",
        jobId,
        kind: "directory",
        path: `artifacts/${jobId}`,
        createdAt,
        files: [
          { path: "stderr.log", kind: "text", encoding: "utf8", content: "" },
        ],
      }));
    }

    const human = await invoke(["show", "run_same_prefix", "--dir", root]);
    expect(human.code, human.stdout || human.stderr).toBe(0);
    expect(human.stdout).toContain("job_mqcadtt1aaaa1111\tcase=case-1");
    expect(human.stdout).toContain("job_mqcadtt1bbbb2222\tcase=case-2");

    const ambiguous = await invoke(["show", "run_same_prefix:stderr.log", "--dir", root, "--json"]);
    expect(ambiguous.code).toBe(2);
    expect(stdoutJson<{ code: string; subject: { candidates: string[] } }>(ambiguous)).toMatchObject({
      code: "ref_ambiguous",
      subject: {
        candidates: [
          "cases/case-1/jobs/job_mqcadtt1aaaa1111/stderr.log",
          "cases/case-2/jobs/job_mqcadtt1bbbb2222/stderr.log",
        ],
      },
    });
  });

  test("show surfaces job errors even when evidence files are empty or absent", async () => {
    const root = await makeTempRoot("workbench-cli-show-job-errors-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const versionId = stdoutJson<{ entries: Array<{ id: string }> }>(
      await invoke(["log", "--versions", "--dir", root, "--json"]),
    ).entries[0]!.id;
    const createdAt = "2026-06-11T00:00:00.000Z";
    await fs.mkdir(path.join(root, ".workbench", "objects", "run"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "job"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "objects", "run", "run_failed.json"), JSON.stringify({
      id: "run_failed",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "failed",
      jobIds: ["job_failed"],
      traceIds: [],
      createdAt,
      finishedAt: createdAt,
    }));
    await fs.writeFile(path.join(root, ".workbench", "objects", "job", "job_failed.json"), JSON.stringify({
      id: "job_failed",
      runId: "run_failed",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      caseId: "case-001",
      sample: 0,
      status: "failed",
      artifactIds: [],
      traceIds: [],
      createdAt,
      finishedAt: createdAt,
      error: "Command exited with status 1",
    }));

    const human = await invoke(["show", "run_failed", "--dir", root]);
    expect(human.code, human.stdout || human.stderr).toBe(0);
    expect(human.stdout).toContain("Jobs:");
    expect(human.stdout).toContain("job_failed");
    expect(human.stdout).toContain("error=Command exited with status 1");

    const json = stdoutJson<{ result: { jobs: Array<{ error?: string }> } }>(
      await invoke(["show", "run_failed", "--dir", root, "--json"]),
    );
    expect(json.result.jobs[0]?.error).toBe("Command exited with status 1");
  });

  test("ambiguous object refs print distinguishable candidate prefixes", async () => {
    const root = await makeTempRoot("workbench-cli-show-ambiguous-prefixes-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const versionId = stdoutJson<{ entries: Array<{ id: string }> }>(
      await invoke(["log", "--versions", "--dir", root, "--json"]),
    ).entries[0]!.id;
    const createdAt = "2026-06-11T00:00:00.000Z";
    await fs.mkdir(path.join(root, ".workbench", "objects", "trace"), { recursive: true });
    for (const id of ["trace_job_mqc40bva_0be9d19c52d0ae97", "trace_job_mqc41ekt_f69360702908b5cf"]) {
      await fs.writeFile(path.join(root, ".workbench", "objects", "trace", `${id}.json`), JSON.stringify({
        id,
        runId: "run_prefix",
        jobId: id.replace(/^trace_/u, ""),
        versionId,
        skillName: "current",
        skillBundleHash: "bundle_hash",
        evalHash: "eval_hash",
        agentName: "default",
        agentHash: "agent_hash",
        createdAt,
        request: {},
        result: { status: "failed" },
        files: [],
      }));
    }

    const ambiguous = await invoke(["show", "trace_job_mqc4", "--dir", root, "--json"]);
    expect(ambiguous.code).toBe(2);
    const body = stdoutJson<{ message: string; subject: { candidates: string[] } }>(ambiguous);
    expect(body.subject.candidates).toEqual([
      "trace_job_mqc40bva_0be9d19c52d0ae97",
      "trace_job_mqc41ekt_f69360702908b5cf",
    ]);
    expect(body.message).toContain("trace_job_mqc40");
    expect(body.message).toContain("trace_job_mqc41");
    expect(body.message).not.toContain("Candidates: trace_job_mqc4, trace_job_mqc4");
  });

  test("cloud dry-run previews the plan and reports missing Workbench Cloud auth readiness", async () => {
    const configRoot = await makeTempRoot("workbench-cli-cloud-dry-run-auth-");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(configRoot, "config.json"));
    vi.stubEnv("WORKBENCH_API_TOKEN", "");
    vi.stubEnv("WORKBENCH_SMOKE_BEARER_TOKEN", "");
    vi.stubEnv("WORKBENCH_API_URL", "https://cloud.test");
    const root = await makeTempRoot("workbench-cli-cloud-dry-run-project-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);

    const dryRun = await invoke(["eval", "--dry-run", "--cloud", "--dir", root, "--json"]);

    expect(dryRun.code, dryRun.stdout || dryRun.stderr).toBe(0);
    expect(stdoutJson(dryRun)).toMatchObject({
      ok: true,
      plan: {
        location: "cloud",
        cases: 1,
        samples: 1,
        readiness: {
          ready: false,
          issues: [
            {
              code: "auth_required",
              remediation: "workbench login --base-url https://cloud.test",
            },
          ],
        },
      },
      readiness: {
        ready: false,
        issues: [
          {
            code: "auth_required",
            remediation: "workbench login --base-url https://cloud.test",
          },
        ],
      },
      next: "workbench login --base-url https://cloud.test",
    });
    expect(stdoutJson<{ entries: unknown[] }>(await invoke(["log", "--runs", "--dir", root, "--json"])).entries).toEqual([]);
  });

  test("cloud dry-run previews edited case source and reports personal hosted plan readiness", async () => {
    const configRoot = await makeTempRoot("workbench-cli-cloud-dry-run-edited-config-");
    const configPath = path.join(configRoot, "config.json");
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    vi.stubEnv("WORKBENCH_API_TOKEN", "");
    vi.stubEnv("WORKBENCH_SMOKE_BEARER_TOKEN", "");
    vi.stubEnv("WORKBENCH_API_URL", "https://cloud.test");
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    const root = await makeTempRoot("workbench-cli-cloud-dry-run-edited-project-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    await currentVersionIdFor(root);
    await fs.appendFile(
      path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"),
      "printf 'edited hosted dry-run case source\\n'\n",
    );

    const dryRun = await invoke(["eval", "--dry-run", "--cloud", "--dir", root, "--json"]);

    expect(dryRun.code, dryRun.stdout || dryRun.stderr).toBe(0);
    expect(stdoutJson(dryRun)).toMatchObject({
      ok: true,
      plan: {
        location: "cloud",
        sourceState: "would_create",
        readiness: {
          ready: false,
          issues: [
            {
              code: "plan_required",
              remediation: "workbench publish --as ORG/SKILL && workbench eval --cloud",
              subject: {
                owner: "alice",
                remote: "cloud",
                ownerKind: "user",
                requirement: "Publish under an organization-owned skill with an active Team or Enterprise plan, then rerun the hosted command.",
              },
            },
          ],
        },
      },
      readiness: {
        ready: false,
        issues: [
          {
            code: "plan_required",
            remediation: "workbench publish --as ORG/SKILL && workbench eval --cloud",
            subject: {
              owner: "alice",
              remote: "cloud",
              ownerKind: "user",
              requirement: "Publish under an organization-owned skill with an active Team or Enterprise plan, then rerun the hosted command.",
            },
          },
        ],
      },
      next: "workbench publish --as ORG/SKILL",
    });
    const dryRunJson = stdoutJson<{
      readiness: { issues: Array<{ code: string; remediation?: string }> };
      plan: { readiness: { issues: Array<{ code: string; remediation?: string }> } };
    }>(dryRun);
    expect(dryRunJson.plan.readiness.issues.find((issue) => issue.code === "plan_required")?.remediation)
      .toBe("workbench publish --as ORG/SKILL && workbench eval --cloud");
    expect(dryRunJson.readiness.issues.find((issue) => issue.code === "plan_required")?.remediation)
      .toBe("workbench publish --as ORG/SKILL && workbench eval --cloud");
    expect(stdoutJson(dryRun).plan).not.toHaveProperty("adapterAuthTargets");
    expect(stdoutJson<{ entries: unknown[] }>(await invoke(["log", "--runs", "--dir", root, "--json"])).entries).toEqual([]);
  });

  test("hosted improve dry-run preserves setup remediation and selected agent", async () => {
    const configRoot = await makeTempRoot("workbench-cli-cloud-improve-dry-run-combined-config-");
    const configPath = path.join(configRoot, "config.json");
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    vi.stubEnv("WORKBENCH_API_TOKEN", "");
    vi.stubEnv("WORKBENCH_SMOKE_BEARER_TOKEN", "");
    vi.stubEnv("WORKBENCH_API_URL", "https://cloud.test");
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    const root = await makeTempRoot("workbench-cli-cloud-improve-dry-run-combined-project-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const added = await invoke([
      "agent",
      "add",
      "improver",
      "--dir",
      root,
      "--adapter",
      "codex",
      "--model",
      "gpt-5.4-mini",
    ]);
    expect(added.code, added.stdout || added.stderr).toBe(0);
    await seedFailedImproveEvidence(root, "improver");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/api/workbench/auth/adapters") {
        return jsonResponse({ adapters: [] });
      }
      return jsonResponse({ message: `Unexpected ${url.pathname}` }, 500);
    }));

    const dryRun = await invoke(["improve", "--agents", "improver", "--cloud", "--dry-run", "--dir", root, "--json"]);

    expect(dryRun.code, dryRun.stdout || dryRun.stderr).toBe(0);
    const body = stdoutJson<{
      readiness: { ready: boolean; issues: Array<{ code: string; remediation?: string; subject?: Record<string, unknown> }> };
      next: string | null;
    }>(dryRun);
    expect(body.readiness).toMatchObject({
      ready: false,
      issues: [
        {
          code: "adapter_auth_required",
          remediation: "codex login --device-auth",
          subject: {
            setupCommands: [
              "codex login --device-auth",
              "workbench login codex --method oauth",
            ],
          },
        },
        {
          code: "plan_required",
          remediation: "workbench publish --as ORG/SKILL && workbench improve --cloud",
          subject: {
            owner: "alice",
            remote: "cloud",
            ownerKind: "user",
            requirement: "Publish under an organization-owned skill with an active Team or Enterprise plan, then rerun the hosted command.",
          },
        },
      ],
    });
    expect(body.readiness.issues.find((issue) => issue.code === "plan_required")?.remediation)
      .toBe("workbench publish --as ORG/SKILL && workbench improve --cloud");
    expect(body.next).toBe("codex login --device-auth");
  });

  test("cloud dry-run reports ready for an explicitly linked organization skill", async () => {
    const configRoot = await makeTempRoot("workbench-cli-cloud-dry-run-org-config-");
    const configPath = path.join(configRoot, "config.json");
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    vi.stubEnv("WORKBENCH_API_TOKEN", "");
    vi.stubEnv("WORKBENCH_SMOKE_BEARER_TOKEN", "");
    vi.stubEnv("WORKBENCH_API_URL", "https://cloud.test");
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    const root = await makeTempRoot("workbench-cli-cloud-dry-run-org-project-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/acme/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/api/workbench/skills") {
        expect(url.searchParams.get("owner")).toBe("acme");
        expect(url.searchParams.get("name")).toBe("cloud-skill");
        return jsonResponse({
          skills: [{
            id: "skill_org",
            ownerSlug: "acme",
            ownerKind: "organization",
            name: "cloud-skill",
          }],
        });
      }
      if (url.pathname === "/api/workbench/organizations/acme") {
        return jsonResponse({ organization: { organization: { namespace: { slug: "acme" } } } });
      }
      return jsonResponse({ message: `Unexpected ${url.pathname}` }, 500);
    }));

    const dryRun = await invoke(["eval", "--dry-run", "--cloud", "--dir", root, "--json"]);

    expect(dryRun.code, dryRun.stdout || dryRun.stderr).toBe(0);
    expect(stdoutJson(dryRun)).toMatchObject({
      ok: true,
      plan: {
        location: "cloud",
        readiness: {
          ready: true,
          issues: [],
        },
      },
      readiness: {
        ready: true,
        issues: [],
      },
      next: "workbench eval --cloud",
    });
    expect(stdoutJson(dryRun).plan).not.toHaveProperty("adapterAuthTargets");
    expect(stdoutJson<{ entries: unknown[] }>(await invoke(["log", "--runs", "--dir", root, "--json"])).entries).toEqual([]);
  });

  test("hosted eval creates the local watch handle before Cloud auto-link work", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-autolink-early-handle-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    let localHandleVisibleDuringAutoLink = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/api/workbench/skills") {
        const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
        localHandleVisibleDuringAutoLink = snapshot.runs.some((run) =>
          run.kind === "eval" &&
          run.location === "cloud" &&
          run.remoteName === "cloud" &&
          run.status === "queued"
        );
        return jsonResponse({ message: "forced auto-link failure" }, 500);
      }
      return jsonResponse({ message: `Unexpected ${url.pathname}` }, 500);
    }));
    try {
      const result = await invoke(["eval", "--cloud", "--dir", root, "--json"]);
      expect(result.code, result.stdout || result.stderr).toBe(1);
      expect(localHandleVisibleDuringAutoLink).toBe(true);
      const progress = stderrJsonLines<{ id: string; schema: string; status: string; phase: string; variant: string }>(result);
      expect(progress).toHaveLength(1);
      expect(stdoutJson(result)).toMatchObject({
        ok: false,
        runId: progress[0]!.id,
        subject: {
          runId: progress[0]!.id,
        },
      });
      expect(progress[0]).toMatchObject({
        schema: "workbench.run.v1",
        status: "running",
        phase: "planning",
        variant: "cloud",
      });
      const runs = await invoke(["log", "--runs", "--dir", root, "--json"]);
      expect(stdoutJson<{ entries: Array<{ id: string; status: string }> }>(runs).entries)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({
            id: progress[0]!.id,
            status: "failed",
          }),
        ]));
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("hosted eval human wait reports run transitions without per-poll sync chatter", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-human-progress-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousTimeout = process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = "1000";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    const versionId = await currentVersionIdFor(root);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    const createdAt = "2026-06-11T00:00:00.000Z";
    const runningRun = {
      id: "run_cloud",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "default",
      agentHash: "agent_cloud",
      status: "running",
      jobIds: ["job_cloud"],
      traceIds: [],
      createdAt,
    };
    const succeededRun = { ...runningRun, status: "succeeded", score: 1, traceIds: ["trace_cloud"], finishedAt: createdAt };
    const runningJob = {
      id: "job_cloud",
      runId: "run_cloud",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "default",
      agentHash: "agent_cloud",
      caseId: "case-001",
      sample: 0,
      status: "queued",
      artifactIds: [],
      traceIds: [],
      createdAt,
    };
    const succeededJob = { ...runningJob, status: "succeeded", score: 1, traceIds: ["trace_cloud"], finishedAt: createdAt };
    const trace = {
      id: "trace_cloud",
      runId: "run_cloud",
      jobId: "job_cloud",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "default",
      agentHash: "agent_cloud",
      createdAt,
      request: {},
      result: { status: "succeeded" },
      files: [{ path: "stdout.log", kind: "text", encoding: "utf8", content: "hosted done\n" }],
    };
    let hostedRunId = runningRun.id;
    let remotePack = emptyObjectPack(createdAt);
    let started = false;
    let objectReadsAfterStart = 0;
    let inspectionReadsAfterStart = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/snapshot" && method === "GET") {
        inspectionReadsAfterStart += started ? 1 : 0;
        const terminal = inspectionReadsAfterStart >= 2;
        return jsonResponse(cloudInspectionEnvelope(`cloud:${inspectionReadsAfterStart}`, {
          ...remotePack,
          runs: [withRunId(terminal ? succeededRun : runningRun, hostedRunId)],
          jobs: [withJobRunId(terminal ? succeededJob : runningJob, hostedRunId)],
          traces: terminal ? [withTraceRunId(trace, hostedRunId)] : [],
        }));
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/state/wait" && method === "GET") {
        expect(url.searchParams.get("timeoutMs")).toBe("1000");
        return jsonResponse({
          schema: "workbench.state.notice.v1",
          type: "changed",
          cursor: `cloud:${inspectionReadsAfterStart + 1}`,
        });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        if (started) {
          objectReadsAfterStart += 1;
          remotePack = {
            ...remotePack,
            runs: [withRunId(succeededRun, hostedRunId)],
            jobs: [withJobRunId(succeededJob, hostedRunId)],
            traces: [withTraceRunId(trace, hostedRunId)],
          };
        }
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack?: ReturnType<typeof emptyObjectPack> };
        expect(body.objectPack?.runs ?? []).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ location: "cloud", status: "queued" }),
        ]));
        remotePack = mergeObjectPacks(remotePack, body.objectPack ?? emptyObjectPack(createdAt));
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/operations" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({ versionId, agent: "default", samples: 1 });
        expect(body).not.toHaveProperty("evalHash");
        expect(body).not.toHaveProperty("skillBundleHash");
        expect(body).not.toHaveProperty("agentHash");
        hostedRunId = requestRunId(body);
        started = true;
        remotePack = { ...remotePack, runs: [withRunId(runningRun, hostedRunId)], jobs: [withJobRunId(runningJob, hostedRunId)] };
        return jsonResponse(runSnapshotFixture(withRunId(runningRun, hostedRunId), [withJobRunId(runningJob, hostedRunId)]));
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    }));
    try {
      const result = await invoke(["eval", "--cloud", "--dir", root, "--agents", "default"]);
      expect(result.code, result.stdout || result.stderr).toBe(0);
      expect(result.stdout).toContain("Completed hosted eval");
      const queuedIndex = result.stderr.indexOf("workbench eval: preparing Workbench Cloud run");
      const syncIndex = result.stderr.indexOf("workbench eval: syncing with Workbench Cloud still running");
      expect(queuedIndex).toBeGreaterThanOrEqual(0);
      expect(syncIndex).toBeGreaterThan(queuedIndex);
      expect(result.stderr).not.toContain("waiting for a hosted worker");
      expect(result.stderr).toContain(`resume with workbench run watch ${hostedRunId}`);
      expect(result.stderr).toContain("workbench eval: sync with Workbench Cloud");
      expect(result.stderr.match(/workbench eval: running, work 0\/1 complete, failed 0, (?:evidence \d+, )?elapsed \d+s\./gu)).toHaveLength(1);
      expect(result.stderr.match(/workbench eval: complete, work 1\/1 complete, scored 1, failed 0, (?:evidence \d+, )?elapsed \d+s\./gu)).toHaveLength(1);
      expect(result.stderr).not.toContain("synced cloud while waiting");
      expect(objectReadsAfterStart).toBe(1);
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousTimeout === undefined) {
        delete process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
      } else {
        process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  test("hosted eval detaches with a local run handle when SIGINT lands before scheduling finishes", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-pre-schedule-cancel-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await fs.mkdir(path.join(root, ".workbench", "cases", "case-001"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "case.yaml"), [
      "version: 1",
      "id: case-001",
      "command: node -e \"const fs=require('node:fs'); const path=require('node:path'); fs.writeFileSync(path.join(process.env.OUTPUT_DIR, 'result.json'), JSON.stringify({ok:true, score:0, message:'hosted improve eligibility failure'}) + '\\n')\"",
      "",
    ].join("\n"));
    const failedEval = await invoke(["eval", "--dir", root, "--json"]);
    expect(failedEval.code, failedEval.stdout || failedEval.stderr).toBe(1);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    let signalScheduled = false;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        if (!signalScheduled) {
          signalScheduled = true;
          setTimeout(() => process.emit("SIGINT"), 0);
        }
        return await new Promise<Response>(() => {});
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const detached = await invoke(["eval", "--cloud", "--dir", root, "--agents", "default"]);
      expect(detached.code, detached.stdout || detached.stderr).toBe(130);
      expect(detached.stdout).toBe("");
      expect(detached.stderr).toContain("workbench eval: preparing Workbench Cloud run");
      expect(detached.stderr).not.toContain("waiting for a hosted worker");
      expect(detached.stderr).toContain("error[cloud_detached]: Detached from hosted eval before Workbench Cloud confirmed scheduling.");
      expect(detached.stderr).toContain("next: workbench run watch run_");
      expect(fetchMock).not.toHaveBeenCalledWith(
        expect.stringContaining("/api/workbench/skills/skill_cloud/workbench/operations"),
        expect.anything(),
      );
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("hosted pre-accept run handles cancel locally before Cloud knows the id", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-preaccept-cancel-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const versionId = await currentVersionIdFor(root);
    const run: WorkbenchRun = {
      id: "run_preaccept_cancel",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_preaccept",
      evalHash: "eval_preaccept",
      agentName: "default",
      agentHash: "agent_preaccept",
      status: "queued",
      jobIds: [],
      traceIds: [],
      createdAt: "2026-06-16T00:00:00.000Z",
      location: "cloud",
      remoteName: "cloud",
      requestedSamples: 1,
      operationPlan: {
        kind: "eval",
        variant: "cloud",
        versionId,
        evalHash: "eval_preaccept",
        skills: ["current"],
        agents: ["default"],
        samples: 1,
      },
    };
    await recordWorkbenchLocalHostedRunHandle({ dir: root, run });
    const fetchMock = vi.fn(async () => jsonResponse({ message: "unexpected network call" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    const canceled = await invoke(["run", "cancel", run.id, "--dir", root, "--json"]);
    expect(canceled.code, canceled.stdout || canceled.stderr).toBe(0);
    expect(stdoutJson(canceled)).toMatchObject({
      schema: "workbench.cli.run-cancel.v1",
      ok: true,
      run: { id: run.id, status: "canceled" },
      next: `workbench show ${run.id}`,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const canceledAgain = await invoke(["run", "cancel", run.id, "--dir", root, "--json"]);
    expect(canceledAgain.code, canceledAgain.stdout || canceledAgain.stderr).toBe(2);
    expect(stdoutJson(canceledAgain)).toMatchObject({
      ok: false,
      code: "run_terminal",
      remediation: `workbench show ${run.id}`,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const watched = await invoke(["run", "watch", run.id, "--dir", root, "--json"]);
    expect(watched.code, watched.stdout || watched.stderr).toBe(0);
    expect(stdoutJson(watched)).toMatchObject({
      schema: "workbench.cli.run-watch.v1",
      ok: true,
      run: { id: run.id, status: "canceled" },
      next: null,
    });
    const watchedHuman = await invoke(["run", "watch", run.id, "--dir", root]);
    expect(watchedHuman.code, watchedHuman.stdout || watchedHuman.stderr).toBe(0);
    expect(watchedHuman.stdout).not.toContain(`next: workbench show ${run.id}`);
  });

  test("hosted pre-accept run retry creates a local watch handle before network work", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-preaccept-retry-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await addWorkbenchRemote("cloud", "https://cloud.test/skills/alice/cloud-skill", { dir: root });
    const versionId = await currentVersionIdFor(root);
    const createdAt = "2026-06-16T00:00:00.000Z";
    const canceledRun: WorkbenchRun = {
      id: "run_preaccept_retry",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_preaccept",
      evalHash: "eval_preaccept",
      agentName: "default",
      agentHash: "agent_preaccept",
      status: "canceled",
      jobIds: [],
      traceIds: [],
      createdAt,
      finishedAt: "2026-06-16T00:00:01.000Z",
      location: "cloud",
      remoteName: "cloud",
      requestedSamples: 1,
      operationPlan: {
        kind: "eval",
        variant: "cloud",
        versionId,
        evalHash: "eval_preaccept",
        skills: ["current"],
        agents: ["default"],
        samples: 1,
      },
    };
    await recordWorkbenchLocalHostedRunHandle({ dir: root, run: canceledRun });

    let retryRunId = "";
    let created = false;
    let remotePack = emptyObjectPack(createdAt);
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push(`${method} ${url.pathname}`);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({
          skills: created ? [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] : [],
        });
      }
      if (url.pathname === "/api/workbench/skills" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { ownerSlug?: string; name?: string };
        expect(body).toMatchObject({ ownerSlug: "alice", name: "cloud-skill" });
        created = true;
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } }, 201);
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack?: ReturnType<typeof emptyObjectPack> };
        remotePack = mergeObjectPacks(remotePack, body.objectPack ?? emptyObjectPack(createdAt));
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/operations" && method === "POST") {
        expect(created).toBe(true);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          kind: "eval",
          variant: "cloud",
          versionId,
          skill: "current",
          agent: "default",
          samples: 1,
          rerun: true,
          retryOfRunId: canceledRun.id,
        });
        expect(typeof body.runId).toBe("string");
        retryRunId = String(body.runId);
        const retryJobId = "job_preaccept_retry_again";
        const retryRun: WorkbenchRun = {
          ...canceledRun,
          id: retryRunId,
          status: "succeeded",
          jobIds: [retryJobId],
          traceIds: [],
          retryOfRunId: canceledRun.id,
          createdAt: "2026-06-16T00:00:02.000Z",
          finishedAt: "2026-06-16T00:00:03.000Z",
        };
        const retryJob: WorkbenchJob = {
          id: retryJobId,
          runId: retryRunId,
          kind: "eval",
          versionId,
          skillName: "current",
          skillBundleHash: "bundle_preaccept",
          evalHash: "eval_preaccept",
          agentName: "default",
          agentHash: "agent_preaccept",
          caseId: "case-001",
          sample: 0,
          status: "succeeded",
          score: 1,
          artifactIds: [],
          traceIds: [],
          createdAt: "2026-06-16T00:00:02.000Z",
          finishedAt: "2026-06-16T00:00:03.000Z",
        };
        remotePack = mergeObjectPacks(remotePack, {
          ...emptyObjectPack(createdAt),
          runs: [retryRun],
          jobs: [retryJob],
        });
        return jsonResponse(runSnapshotFixture(retryRun, [retryJob]));
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/snapshot" && method === "GET") {
        return jsonResponse(cloudInspectionEnvelope("cloud:retry", remotePack));
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        return jsonResponse({ objectPack: remotePack });
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const retried = await invoke(["run", "retry", canceledRun.id, "--dir", root, "--json"]);
      expect(retried.code, retried.stdout || retried.stderr).toBe(0);
      expect(stdoutJson(retried)).toMatchObject({
        schema: "workbench.cli.run-retry.v1",
        ok: true,
        retryOfRunId: canceledRun.id,
        run: { status: "succeeded" },
        cloud: { skillId: "skill_cloud" },
        next: "workbench results",
      });
      expect(stdoutJson(retried).run.id).toBe(retryRunId);
      const progress = stderrJsonLines<{ schema: string; id: string; status: string; phase: string; variant: string }>(retried);
      expect(progress[0]).toMatchObject({
        schema: "workbench.run.v1",
        id: retryRunId,
        status: "running",
        phase: "planning",
        variant: "cloud",
      });
      expect(calls.indexOf("POST /api/workbench/skills")).toBeGreaterThan(calls.indexOf("GET /api/workbench/skills"));
      expect(calls.indexOf("POST /api/workbench/skills/skill_cloud/workbench/operations"))
        .toBeGreaterThan(calls.indexOf("POST /api/workbench/skills"));
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("hosted pre-accept run retry error JSON includes the local retry run id", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-preaccept-retry-error-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await addWorkbenchRemote("cloud", "https://cloud.test/skills/alice/cloud-skill", { dir: root });
    const versionId = await currentVersionIdFor(root);
    const createdAt = "2026-06-16T00:00:00.000Z";
    const retryOfRun: WorkbenchRun = {
      id: "run_preaccept_retry_error",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_preaccept",
      evalHash: "eval_preaccept",
      agentName: "default",
      agentHash: "agent_preaccept",
      status: "canceled",
      jobIds: [],
      traceIds: [],
      createdAt,
      finishedAt: "2026-06-16T00:00:01.000Z",
      location: "cloud",
      remoteName: "cloud",
      requestedSamples: 1,
      operationPlan: {
        kind: "eval",
        variant: "cloud",
        versionId,
        evalHash: "eval_preaccept",
        skills: ["current"],
        agents: ["default"],
        samples: 1,
      },
    };
    await recordWorkbenchLocalHostedRunHandle({ dir: root, run: retryOfRun });
    let remotePack = emptyObjectPack(createdAt);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack?: ReturnType<typeof emptyObjectPack> };
        remotePack = mergeObjectPacks(remotePack, body.objectPack ?? emptyObjectPack(createdAt));
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/operations" && method === "POST") {
        return jsonResponse({
          schema: "workbench.cloud.error.v1",
          code: "plan_required",
          message: "Hosted Workbench eval requires an organization-owned skill under an active Team or Enterprise plan.",
          retryable: false,
          remediation: "workbench publish --as ORG/SKILL && workbench eval --cloud",
          subject: {
            owner: "alice",
            ownerKind: "user",
            requirement: "Publish under an organization-owned skill with an active Team or Enterprise plan, then rerun the hosted command.",
          },
        }, 402);
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    }));
    try {
      const retried = await invoke(["run", "retry", retryOfRun.id, "--dir", root, "--json"]);
      expect(retried.code, retried.stdout || retried.stderr).toBe(1);
      const progress = stderrJsonLines<{ id: string; schema: string; status: string; phase: string; variant: string }>(retried);
      expect(progress[0]).toMatchObject({
        schema: "workbench.run.v1",
        status: "running",
        phase: "planning",
        variant: "cloud",
      });
      const retriedJson = stdoutJson(retried);
      expect(retriedJson).toMatchObject({
        ok: false,
        code: "plan_required",
        remediation: "workbench publish --as ORG/SKILL && workbench eval --cloud",
        runId: progress[0]!.id,
        subject: {
          owner: "alice",
          ownerKind: "user",
          requirement: "Publish under an organization-owned skill with an active Team or Enterprise plan, then rerun the hosted command.",
          runId: progress[0]!.id,
        },
      });
      const shown = await invoke(["show", progress[0]!.id, "--dir", root, "--json"]);
      expect(shown.code, shown.stdout || shown.stderr).toBe(0);
      expect(stdoutJson(shown)).toMatchObject({
        result: {
          run: expect.objectContaining({
            status: "failed",
            error: expect.stringContaining("Next: workbench publish --as ORG/SKILL && workbench eval --cloud."),
          }),
        },
      });
      const watched = await invoke(["run", "watch", progress[0]!.id, "--dir", root, "--json"]);
      expect(watched.code, watched.stdout || watched.stderr).toBe(0);
      expect(stdoutJson(watched)).toMatchObject({
        schema: "workbench.cli.run-watch.v1",
        ok: true,
        run: { id: progress[0]!.id, status: "failed" },
        next: "workbench publish --as ORG/SKILL && workbench eval --cloud",
      });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("hosted retry forwards local cancellation that lands while Cloud accepts the run", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-retry-cancel-during-accept-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await addWorkbenchRemote("cloud", "https://cloud.test/skills/alice/cloud-skill", { dir: root });
    const versionId = await currentVersionIdFor(root);
    const createdAt = "2026-06-16T00:00:00.000Z";
    const canceledRun: WorkbenchRun = {
      id: "run_retry_cancel_source",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_preaccept",
      evalHash: "eval_preaccept",
      agentName: "default",
      agentHash: "agent_preaccept",
      status: "canceled",
      jobIds: [],
      traceIds: [],
      createdAt,
      finishedAt: "2026-06-16T00:00:01.000Z",
      location: "cloud",
      remoteName: "cloud",
      requestedSamples: 1,
      operationPlan: {
        kind: "eval",
        variant: "cloud",
        versionId,
        evalHash: "eval_preaccept",
        skills: ["current"],
        agents: ["default"],
        samples: 1,
      },
    };
    await recordWorkbenchLocalHostedRunHandle({ dir: root, run: canceledRun });

    let retryRunId = "";
    let releaseOperation!: () => void;
    const operationReleased = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    let operationStarted = false;
    let cloudCancelCalled = false;
    let remotePack = emptyObjectPack(createdAt);
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack?: ReturnType<typeof emptyObjectPack> };
        remotePack = mergeObjectPacks(remotePack, body.objectPack ?? emptyObjectPack(createdAt));
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/operations" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        retryRunId = String(body.runId);
        operationStarted = true;
        await operationReleased;
        const retryJobId = "job_retry_cancel_accept";
        const {
          finishedAt: _finishedAt,
          cancelRequestedAt: _cancelRequestedAt,
          error: _error,
          ...acceptedRunBase
        } = canceledRun;
        const acceptedRun: WorkbenchRun = {
          ...acceptedRunBase,
          id: retryRunId,
          status: "queued",
          jobIds: [retryJobId],
          retryOfRunId: canceledRun.id,
          createdAt: "2026-06-16T00:00:02.000Z",
        };
        const acceptedJob: WorkbenchJob = {
          id: retryJobId,
          runId: retryRunId,
          kind: "eval",
          versionId,
          skillName: "current",
          skillBundleHash: "bundle_preaccept",
          evalHash: "eval_preaccept",
          agentName: "default",
          agentHash: "agent_preaccept",
          caseId: "case-001",
          sample: 0,
          status: "queued",
          artifactIds: [],
          traceIds: [],
          createdAt: "2026-06-16T00:00:02.000Z",
        };
        return jsonResponse(runSnapshotFixture(acceptedRun, [acceptedJob]));
      }
      if (url.pathname === `/api/workbench/skills/skill_cloud/runs/${retryRunId}/cancel` && method === "POST") {
        cloudCancelCalled = true;
        const canceledRetryRun: WorkbenchRun = {
          ...canceledRun,
          id: retryRunId,
          status: "canceled",
          jobIds: ["job_retry_cancel_accept"],
          retryOfRunId: canceledRun.id,
          createdAt: "2026-06-16T00:00:02.000Z",
          finishedAt: "2026-06-16T00:00:03.000Z",
          cancelRequestedAt: "2026-06-16T00:00:03.000Z",
          error: "cancelled",
        };
        const canceledJob: WorkbenchJob = {
          id: "job_retry_cancel_accept",
          runId: retryRunId,
          kind: "eval",
          versionId,
          skillName: "current",
          skillBundleHash: "bundle_preaccept",
          evalHash: "eval_preaccept",
          agentName: "default",
          agentHash: "agent_preaccept",
          caseId: "case-001",
          sample: 0,
          status: "canceled",
          artifactIds: [],
          traceIds: [],
          createdAt: "2026-06-16T00:00:02.000Z",
          finishedAt: "2026-06-16T00:00:03.000Z",
          error: "cancelled",
        };
        remotePack = mergeObjectPacks(remotePack, {
          ...emptyObjectPack(createdAt),
          runs: [canceledRetryRun],
          jobs: [canceledJob],
        });
        return jsonResponse({
          schema: "workbench.remote.run.cancel-response.v1",
          run: canceledRetryRun,
          jobs: [canceledJob],
        });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/snapshot" && method === "GET") {
        return jsonResponse(cloudInspectionEnvelope("cloud:retry", remotePack));
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const running = invoke(["run", "retry", canceledRun.id, "--dir", root, "--json"]);
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (operationStarted && retryRunId) {
          break;
        }
        await delay(10);
      }
      expect(retryRunId).toMatch(/^run_/u);

      const canceled = await invoke(["run", "cancel", retryRunId, "--dir", root, "--json"]);
      expect(canceled.code, canceled.stdout || canceled.stderr).toBe(0);
      expect(stdoutJson(canceled)).toMatchObject({
        schema: "workbench.cli.run-cancel.v1",
        ok: true,
        run: { id: retryRunId, status: "canceled" },
      });

      releaseOperation();
      const stopped = await running;
      expect(stopped.code, stopped.stdout || stopped.stderr).toBe(130);
      expect(stdoutJson(stopped)).toMatchObject({
        ok: false,
        code: "cloud_canceled",
        remediation: `workbench show ${retryRunId}`,
      });
      expect(cloudCancelCalled).toBe(true);

      const watched = await invoke(["run", "watch", retryRunId, "--dir", root, "--json"]);
      expect(watched.code, watched.stdout || watched.stderr).toBe(0);
      expect(stdoutJson(watched)).toMatchObject({
        schema: "workbench.cli.run-watch.v1",
        ok: true,
        run: { id: retryRunId, status: "canceled" },
        next: null,
      });
    } finally {
      releaseOperation();
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("hosted eval stops before scheduling when a local handle is canceled during sync", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-preaccept-cancel-during-sync-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    const createdAt = "2026-06-16T00:00:00.000Z";
    let releaseObjectRead!: () => void;
    const objectReadReleased = new Promise<void>((resolve) => {
      releaseObjectRead = resolve;
    });
    let objectReadStarted = false;
    let operationsCalled = false;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        objectReadStarted = true;
        await Promise.race([
          objectReadReleased,
          new Promise<void>((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("The operation was aborted.");
              error.name = "AbortError";
              reject(error);
            }, { once: true });
          }),
        ]);
        return jsonResponse({ objectPack: emptyObjectPack(createdAt) });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "PUT") {
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/operations" && method === "POST") {
        operationsCalled = true;
        return jsonResponse({ message: "scheduled after cancellation" }, 500);
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const running = invoke(["eval", "--cloud", "--dir", root, "--agents", "default", "--json"]);
      let hostedRunId: string | undefined;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
        hostedRunId = snapshot.runs.find((entry) =>
          entry.location === "cloud" && entry.status === "queued"
        )?.id;
        if (hostedRunId && objectReadStarted) {
          break;
        }
        await delay(10);
      }
      expect(hostedRunId).toMatch(/^run_/u);
      await delay(5_250);
      const canceled = await invoke(["run", "cancel", hostedRunId!, "--dir", root, "--json"]);
      expect(canceled.code, canceled.stdout || canceled.stderr).toBe(0);
      const stoppedStartedAt = Date.now();
      const stopped = await running;
      expect(Date.now() - stoppedStartedAt).toBeLessThan(5_000);
      expect(stopped.code, stopped.stdout || stopped.stderr).toBe(130);
      expect(stdoutJson(stopped)).toMatchObject({
        ok: false,
        code: "cloud_canceled",
        remediation: `workbench show ${hostedRunId}`,
      });
      expect(stopped.stderr).not.toContain("still running");
      for (const line of stopped.stderr.trim().split("\n").filter(Boolean)) {
        expect(JSON.parse(line)).toMatchObject({ schema: "workbench.run.v1" });
      }
      expect(operationsCalled).toBe(false);
      const status = await invoke(["status", "--dir", root, "--json"]);
      expect(status.code, status.stdout || status.stderr).toBe(0);
      const remoteSync = stdoutJson<{ remotes: Array<{ name: string; sync: { status: string; lastError: unknown } }> }>(status)
        .remotes.find((remote) => remote.name === "cloud")?.sync;
      expect(remoteSync).toBeTruthy();
      expect(remoteSync?.status).not.toBe("error");
      expect(JSON.stringify(remoteSync)).not.toContain("aborted");
    } finally {
      releaseObjectRead();
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("hosted improve validates local improve eligibility before syncing source", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-improve-local-validation-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    await seedFailedImproveEvidence(root);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      return jsonResponse({ message: `Unexpected ${url.pathname}` }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const dryRun = await invoke(["improve", "--dry-run", "--cloud", "--dir", root, "--json"]);
      expect(dryRun.code, dryRun.stdout || dryRun.stderr).toBe(0);
      expect(stdoutJson(dryRun)).toMatchObject({
        ok: true,
        schema: "workbench.cli.improve-plan.v1",
        readiness: {
          ready: false,
          issues: [
            {
              code: "improve_adapter_required",
              message: expect.stringContaining("Agent default cannot run improve because it has no skill-improvement adapter."),
              remediation: "workbench agent add improver --adapter codex --model gpt-5.4-mini --with auth=default",
              subject: {
                agent: "default",
                setupCommands: [
                  "workbench agent add improver --adapter codex --model gpt-5.4-mini --with auth=default",
                  "codex login --device-auth",
                  "workbench login codex --method oauth",
                  "workbench eval --agents improver --rerun",
                  "workbench improve --agents improver",
                ],
              },
            },
          ],
        },
        next: "workbench agent add improver --adapter codex --model gpt-5.4-mini --with auth=default",
      });
      const improved = await invoke(["improve", "--cloud", "--dir", root, "--json"]);
      expect(improved.code, improved.stdout || improved.stderr).toBe(2);
      expect(stdoutJson(improved)).toMatchObject({
        ok: false,
        code: "usage",
        message: expect.stringContaining("Agent default cannot run improve because it has no skill-improvement adapter."),
        remediation: "workbench agent add improver --adapter codex --model gpt-5.4-mini --with auth=default",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("hosted improve dry-run includes Workbench login when Cloud auth is missing", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-improve-login-remediation-");
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "missing-config.json");
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    vi.stubEnv("WORKBENCH_API_TOKEN", "");
    vi.stubEnv("WORKBENCH_SMOKE_BEARER_TOKEN", "");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await seedFailedImproveEvidence(root);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return jsonResponse({ message: `Unexpected fetch ${url}` }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const dryRun = await invoke(["improve", "--dry-run", "--cloud", "--dir", root, "--json"]);

    expect(dryRun.code, dryRun.stdout || dryRun.stderr).toBe(0);
    expect(stdoutJson(dryRun)).toMatchObject({
      ok: true,
      schema: "workbench.cli.improve-plan.v1",
      readiness: {
        ready: false,
        issues: [
          {
            code: "auth_required",
            remediation: "workbench login",
          },
          {
            code: "improve_adapter_required",
            remediation: "workbench agent add improver --adapter codex --model gpt-5.4-mini --with auth=default",
          },
        ],
      },
      next: "workbench login",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("hosted auth remediation keeps production login bare", async () => {
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousApiToken = process.env.WORKBENCH_API_TOKEN;
    const previousSmokeToken = process.env.WORKBENCH_SMOKE_BEARER_TOKEN;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "missing-config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_API_TOKEN = "";
    process.env.WORKBENCH_SMOKE_BEARER_TOKEN = "";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return jsonResponse({ message: `Unexpected fetch ${url}` }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const cases = [
        {
          prefix: "workbench-cli-cloud-auth-prod-",
          remoteUrl: "https://v2.workbench.ai/skills/test/prod-skill",
          expected: "workbench login",
        },
        {
          prefix: "workbench-cli-cloud-auth-custom-",
          remoteUrl: "https://cloud.test/skills/alice/cloud-skill",
          expected: "workbench login --base-url https://cloud.test",
        },
      ];
      for (const item of cases) {
        const root = await makeTempRoot(item.prefix);
        expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
        await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
          "schema: workbench.remotes.v1",
          "remotes:",
          "  cloud:",
          `    url: ${item.remoteUrl}`,
          "    kind: workbench-cloud",
          "",
        ].join("\n"));
        const result = await invoke(["eval", "--cloud", "--dir", root, "--json"]);
        expect(result.code, result.stdout || result.stderr).toBe(1);
        expect(result.stderr).toBe("");
        expect(stdoutJson(result)).toMatchObject({
          ok: false,
          code: "auth_required",
          remediation: item.expected,
        });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousApiToken === undefined) {
        delete process.env.WORKBENCH_API_TOKEN;
      } else {
        process.env.WORKBENCH_API_TOKEN = previousApiToken;
      }
      if (previousSmokeToken === undefined) {
        delete process.env.WORKBENCH_SMOKE_BEARER_TOKEN;
      } else {
        process.env.WORKBENCH_SMOKE_BEARER_TOKEN = previousSmokeToken;
      }
    }
  });

  test("hosted improve validates evidence before auto-link progress", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-improve-evidence-preflight-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    const agentAdd = await invoke([
      "agent",
      "add",
      "patcher",
      "--dir",
      root,
      "--adapter",
      "command",
      "--with",
      "improveCommand=printf improved >> \"$SKILL_DIR/SKILL.md\"",
    ]);
    expect(agentAdd.code, agentAdd.stdout || agentAdd.stderr).toBe(0);
    const fetchMock = vi.fn(async () => jsonResponse({ message: "unexpected cloud call" }, 500));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const improved = await invoke(["improve", "--cloud", "--dir", root, "--agents", "patcher", "--json"]);
      expect(improved.code, improved.stdout || improved.stderr).toBe(2);
      expect(stdoutJson(improved)).toMatchObject({
        ok: false,
        code: "improve_evidence_required",
        remediation: "workbench eval --agents 'patcher'",
      });
      expect(improved.stderr).not.toContain("workbench improve: preflight");
      expect(fetchMock).not.toHaveBeenCalled();
      await expect(fs.access(path.join(root, ".workbench", "remotes.yaml")))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("improve dry-run reroutes stale current eval evidence to eval instead of another case", async () => {
    const root = await makeTempRoot("workbench-cli-improve-stale-eval-evidence-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    try {
      expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
      await writePassingCaseTest(root, "case-001");
      const agentAdd = await invoke([
        "agent",
        "add",
        "improver",
        "--dir",
        root,
        "--adapter",
        "command",
        "--with",
        "improveCommand=printf improved >> \"$SKILL_DIR/SKILL.md\"",
      ]);
      expect(agentAdd.code, agentAdd.stdout || agentAdd.stderr).toBe(0);

      const perfectEval = await invoke(["eval", "--dir", root, "--agents", "improver", "--json"]);
      expect(perfectEval.code, perfectEval.stdout || perfectEval.stderr).toBe(0);
      const prematureImprove = await invoke(["improve", "--dir", root, "--agents", "improver", "--dry-run", "--json"]);
      expect(stdoutJson(prematureImprove)).toMatchObject({
        ok: false,
        code: "improve_evidence_required",
        remediation: "workbench case draft 'case-002'",
      });

      await writePassingCaseTest(root, "case-002");
      const staleImprove = await invoke(["improve", "--dir", root, "--agents", "improver", "--cloud", "--dry-run", "--json"]);
      expect(staleImprove.code, staleImprove.stdout || staleImprove.stderr).toBe(2);
      expect(stdoutJson(staleImprove)).toMatchObject({
        ok: false,
        code: "improve_evidence_required",
        remediation: "workbench eval --agents 'improver'",
      });
      expect(staleImprove.stdout).not.toContain("case-003");
      const evalPlan = await invoke(["eval", "--dir", root, "--agents", "improver", "--dry-run", "--json"]);
      expect(stdoutJson<{ next: string | null }>(evalPlan).next).toBe("workbench eval --agents 'improver'");
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("improve dry-run ignores stale below-perfect evidence after selected agent has perfect current eval", async () => {
    const root = await makeTempRoot("workbench-cli-improve-perfect-current-evidence-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const agentAdd = await invoke([
      "agent",
      "add",
      "improver",
      "--dir",
      root,
      "--adapter",
      "command",
      "--with",
      "improveCommand=printf improved >> \"$SKILL_DIR/SKILL.md\"",
    ]);
    expect(agentAdd.code, agentAdd.stdout || agentAdd.stderr).toBe(0);
    await seedFailedImproveEvidence(root, "improver", { status: "succeeded", score: 0.5 });

    const beforePerfect = await invoke(["improve", "--dir", root, "--agents", "improver", "--dry-run", "--json"]);
    expect(beforePerfect.code, beforePerfect.stdout || beforePerfect.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(beforePerfect).next).toBe("workbench improve --agents 'improver'");

    const perfectEval = await invoke(["eval", "--dir", root, "--agents", "improver", "--rerun", "--json"]);
    expect(perfectEval.code, perfectEval.stdout || perfectEval.stderr).toBe(0);
    expect(stdoutJson<{ run: { result: { score?: number } } }>(perfectEval).run.result.score).toBe(1);

    const afterPerfect = await invoke(["improve", "--dir", root, "--agents", "improver", "--dry-run", "--json"]);
    expect(afterPerfect.code, afterPerfect.stdout || afterPerfect.stderr).toBe(2);
    expect(stdoutJson(afterPerfect)).toMatchObject({
      ok: false,
      code: "improve_evidence_required",
      remediation: "workbench case draft 'case-002'",
    });
    expect(afterPerfect.stdout).not.toContain("workbench improve --agents");
  });

  test("perfect-only default evidence teaches case drafting before adapter setup", async () => {
    const root = await makeTempRoot("workbench-cli-perfect-default-improve-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);

    const evaluated = await invoke(["eval", "--dir", root, "--json"]);
    expect(evaluated.code, evaluated.stdout || evaluated.stderr).toBe(0);
    const improved = await invoke(["improve", "--dir", root, "--json"]);

    expect(improved.code).toBe(2);
    expect(stdoutJson(improved)).toMatchObject({
      ok: false,
      code: "improve_evidence_required",
      remediation: "workbench case draft 'case-002'",
    });
    expect(improved.stdout).not.toContain("workbench agent add improver");
  });

  test("publish with a linked cloud remote keeps command-specific auth remediation", async () => {
    const root = await makeTempRoot("workbench-cli-publish-linked-auth-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousApiToken = process.env.WORKBENCH_API_TOKEN;
    const previousSmokeToken = process.env.WORKBENCH_SMOKE_BEARER_TOKEN;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "missing-config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_API_TOKEN = "";
    process.env.WORKBENCH_SMOKE_BEARER_TOKEN = "";
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      return jsonResponse({
        schema: "workbench.cloud.error.v1",
        code: "auth_required",
        message: "Authentication is required.",
        retryable: false,
        remediation: "workbench login",
      }, 401);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
      await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
        "schema: workbench.remotes.v1",
        "remotes:",
        "  cloud:",
        "    url: https://cloud.test/skills/alice/cloud-skill",
        "    kind: workbench-cloud",
        "",
      ].join("\n"));
      const publish = await invoke(["publish", "--dir", root, "--json"]);
      expect(publish.code, publish.stdout || publish.stderr).toBe(1);
      expect(publish.stdout.trim().startsWith("{")).toBe(true);
      expect(publish.stdout).not.toContain("workbench publish:");
      expect(publish.stderr).toBe("");
      expect(stdoutJson(publish)).toMatchObject({
        ok: false,
        code: "auth_required",
        message: "workbench publish requires Workbench Cloud auth.",
        remediation: "workbench login --base-url https://cloud.test",
      });
      const publishHuman = await invoke(["publish", "--dir", root]);
      expect(publishHuman.code, publishHuman.stdout || publishHuman.stderr).toBe(1);
      expect(publishHuman.stderr).not.toContain("workbench publish: preparing Cloud skill.");
      expect(publishHuman.stderr).not.toContain("workbench publish: publishing current source.");
      expect(publishHuman.stderr).not.toContain("workbench publish: checking current source publication.");
      const publishHumanOutput = `${publishHuman.stdout}${publishHuman.stderr}`;
      expect(publishHumanOutput).toContain("error[auth_required]: workbench publish requires Workbench Cloud auth.");
      expect(publishHumanOutput).toContain("next: workbench login --base-url https://cloud.test");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousApiToken === undefined) {
        delete process.env.WORKBENCH_API_TOKEN;
      } else {
        process.env.WORKBENCH_API_TOKEN = previousApiToken;
      }
      if (previousSmokeToken === undefined) {
        delete process.env.WORKBENCH_SMOKE_BEARER_TOKEN;
      } else {
        process.env.WORKBENCH_SMOKE_BEARER_TOKEN = previousSmokeToken;
      }
    }
  });

  test("publish rejects conflicting visibility flags before progress or remote work", async () => {
    const root = await makeTempRoot("workbench-cli-publish-flags-");
    const fetchMock = vi.fn(async () => jsonResponse({ message: "unexpected fetch" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    const publish = await invoke(["publish", "--public", "--team", "--dir", root, "--json"]);

    expect(publish.code, publish.stdout || publish.stderr).toBe(2);
    expect(publish.stderr).toBe("");
    expect(publish.stdout).not.toContain("workbench publish:");
    expect(stdoutJson(publish)).toMatchObject({
      ok: false,
      code: "usage",
      message: "workbench publish accepts only one visibility flag.",
      remediation: "workbench publish --private",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("hosted execution preflights selected provider auth before syncing source", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-provider-auth-preflight-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    const added = await invoke(["agent", "add", "codex", "--dir", root, "--adapter", "codex", "--model", "gpt-5.4-mini"]);
    expect(added.code, added.stdout || added.stderr).toBe(0);
    await seedFailedImproveEvidence(root, "codex");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/api/workbench/auth/adapters") {
        return jsonResponse({ adapters: [] });
      }
      return jsonResponse({ message: `Unexpected ${url.pathname}` }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const improved = await invoke(["improve", "--cloud", "--dir", root, "--agents", "codex", "--json"]);
      expect(improved.code, improved.stdout || improved.stderr).toBe(1);
      expect(stdoutJson(improved)).toMatchObject({
        ok: false,
        code: "adapter_auth_required",
        message: "codex disconnected.",
        remediation: "codex login --device-auth",
      });
      const progress = stderrJsonLines<{ id: string; schema: string; status: string; phase: string; variant: string }>(improved);
      expect(progress).toHaveLength(1);
      expect(progress[0]).toMatchObject({
        schema: "workbench.run.v1",
        status: "running",
        phase: "planning",
        variant: "cloud",
      });
      const runs = await invoke(["log", "--runs", "--dir", root, "--json"]);
      expect(stdoutJson<{ entries: Array<{ id: string; status: string }> }>(runs).entries)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({
            id: progress[0]!.id,
            status: "failed",
          }),
        ]));
      const shown = await invoke(["show", progress[0]!.id, "--dir", root]);
      expect(shown.code, shown.stdout || shown.stderr).toBe(0);
      expect(shown.stdout).toContain("Progress: complete");
      expect(shown.stdout).not.toContain("failed 0");
      expect(shown.stdout).toContain("codex disconnected.");
      expect(improved.stderr).not.toContain("workbench cloud:");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("starts hosted eval through linked cloud remote and syncs queued rerun", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-eval-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousTimeout = process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = "1000";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    const versionId = await currentVersionIdFor(root);
    const createdAt = "2026-06-11T00:00:00.000Z";
    const runningRun = {
      id: "run_cloud",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "default",
      agentHash: "agent_cloud",
      status: "running",
      jobIds: ["job_cloud"],
      traceIds: [],
      createdAt,
    };
    const queuedRun = {
      ...runningRun,
      status: "queued",
    };
    const runningJob = {
      id: "job_cloud",
      runId: "run_cloud",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "default",
      agentHash: "agent_cloud",
      caseId: "case-001",
      sample: 0,
      status: "queued",
      artifactIds: [],
      traceIds: [],
      createdAt,
    };
    const finishedAt = "2026-06-11T00:00:02.000Z";
    const succeededRun = {
      ...runningRun,
      status: "succeeded",
      traceIds: ["trace_cloud"],
      latencyMs: 2000,
      finishedAt,
    };
    const succeededJob = {
      ...runningJob,
      status: "succeeded",
      traceIds: ["trace_cloud"],
      artifactIds: ["artifact_cloud"],
      startedAt: createdAt,
      finishedAt,
      durationMs: 2000,
    };
    const trace = {
      id: "trace_cloud",
      runId: "run_cloud",
      jobId: "job_cloud",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "default",
      agentHash: "agent_cloud",
      createdAt: finishedAt,
      request: {},
      result: { status: "succeeded" },
      files: [{ path: "stdout.log", kind: "text", encoding: "utf8", content: "hosted done\n" }],
    };
    const artifact = {
      id: "artifact_cloud",
      runId: "run_cloud",
      jobId: "job_cloud",
      kind: "output",
      path: "artifacts/job_cloud",
      createdAt: finishedAt,
      files: [{ path: "result.txt", kind: "text", encoding: "utf8", content: "ok\n" }],
    };
    let hostedRunId = runningRun.id;
    let remotePack = emptyObjectPack(createdAt);
    let started = false;
    let objectReadsAfterStart = 0;
    let inspectionReadsAfterStart = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/snapshot" && method === "GET") {
        inspectionReadsAfterStart += started ? 1 : 0;
        const terminal = inspectionReadsAfterStart >= 2;
        return jsonResponse(cloudInspectionEnvelope(`cloud:${inspectionReadsAfterStart}`, {
          ...remotePack,
          runs: [withRunId(terminal ? succeededRun : runningRun, hostedRunId)],
          jobs: [withJobRunId(terminal ? succeededJob : runningJob, hostedRunId)],
          traces: terminal ? [withTraceRunId(trace, hostedRunId)] : [],
          artifacts: terminal ? [withTraceRunId(artifact, hostedRunId)] : [],
        }));
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/state/wait" && method === "GET") {
        return jsonResponse({
          schema: "workbench.state.notice.v1",
          type: "changed",
          cursor: `cloud:${inspectionReadsAfterStart + 1}`,
        });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        if (started) {
          objectReadsAfterStart += 1;
          if (objectReadsAfterStart >= 1) {
            remotePack = {
              ...remotePack,
              runs: [withRunId(succeededRun, hostedRunId)],
              jobs: [withJobRunId(succeededJob, hostedRunId)],
              traces: [withTraceRunId(trace, hostedRunId)],
              artifacts: [withTraceRunId(artifact, hostedRunId)],
            };
          }
        }
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack?: ReturnType<typeof emptyObjectPack> };
        remotePack = mergeObjectPacks(remotePack, body.objectPack ?? emptyObjectPack(createdAt));
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/operations" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({ versionId, agent: "default", samples: 1, rerun: true });
        expect(body).not.toHaveProperty("evalHash");
        expect(body).not.toHaveProperty("skillBundleHash");
        expect(body).not.toHaveProperty("agentHash");
        hostedRunId = requestRunId(body);
        started = true;
        remotePack = {
          ...remotePack,
          runs: [withRunId(runningRun, hostedRunId)],
          jobs: [withJobRunId(runningJob, hostedRunId)],
        };
        return jsonResponse(runSnapshotFixture(withRunId(queuedRun, hostedRunId), [withJobRunId(runningJob, hostedRunId)]));
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const started = await invoke(["eval", "--cloud", "--rerun", "--dir", root, "--agents", "default", "--json"]);
      expect(started.code, started.stdout || started.stderr).toBe(0);
      const startedJson = stdoutJson<{ cloud: { runId: string }; run: { id: string; status: string; measurements: unknown[] } }>(started);
      expect(startedJson).toMatchObject({
        schema: "workbench.cli.eval.v1",
        ok: true,
        run: expect.objectContaining({ id: hostedRunId, status: "succeeded" }),
        next: "workbench eval",
        cloud: expect.objectContaining({ remote: "cloud", skillId: "skill_cloud" }),
      });
      expect(startedJson.run.measurements).toHaveLength(1);
      expect(startedJson.cloud.runId).toBe(hostedRunId);
      expect(started.stderr).not.toContain("workbench cloud:");
      expect(stderrJsonLines(started)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          schema: "workbench.run.v1",
          kind: "eval",
          phase: "running",
          variant: "cloud",
          id: hostedRunId,
        }),
        expect.objectContaining({
          schema: "workbench.run.v1",
          kind: "eval",
          phase: "complete",
          variant: "cloud",
          id: hostedRunId,
        }),
        expect.objectContaining({
          schema: "workbench.run.v1",
          kind: "eval",
          phase: "syncing",
          variant: "cloud",
          id: hostedRunId,
        }),
      ]));

      const runs = await invoke(["log", "--runs", "--dir", root, "--json"]);
      expect(runs.code, runs.stdout || runs.stderr).toBe(0);
      expect(stdoutJson<{ entries: Array<{ id: string; status: string }> }>(runs).entries)
        .toEqual(expect.arrayContaining([expect.objectContaining({ id: hostedRunId, status: "succeeded" })]));
      const stdout = await invoke(["show", `${hostedRunId}:stdout.log`, "--dir", root]);
      expect(stdout.code, stdout.stdout || stdout.stderr).toBe(0);
      expect(stdout.stdout).toContain("hosted done");
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousTimeout === undefined) {
        delete process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
      } else {
        process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  test("hosted eval timeout points to run watch for freshness", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-timeout-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousTimeout = process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = "1";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    const versionId = await currentVersionIdFor(root);
    const createdAt = "2026-06-11T00:00:00.000Z";
    const runningRun = {
      id: "run_pending",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "default",
      agentHash: "agent_cloud",
      status: "running",
      jobIds: ["job_pending"],
      traceIds: [],
      createdAt,
    };
    const runningJob = {
      id: "job_pending",
      runId: "run_pending",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "default",
      agentHash: "agent_cloud",
      caseId: "case-001",
      sample: 0,
      status: "queued",
      artifactIds: [],
      traceIds: [],
      createdAt,
    };
    let hostedRunId = runningRun.id;
    let remotePack = emptyObjectPack(createdAt);
    let started = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/snapshot" && method === "GET") {
        return jsonResponse(cloudInspectionEnvelope("cloud:pending", {
          ...remotePack,
          runs: [withRunId(runningRun, hostedRunId)],
          jobs: [withJobRunId(runningJob, hostedRunId)],
        }));
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/state/wait" && method === "GET") {
        return jsonResponse({
          schema: "workbench.state.notice.v1",
          type: "heartbeat",
          cursor: "cloud:pending",
        });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack?: ReturnType<typeof emptyObjectPack> };
        remotePack = mergeObjectPacks(remotePack, body.objectPack ?? emptyObjectPack(createdAt));
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/operations" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({ versionId, agent: "default", samples: 1 });
        hostedRunId = requestRunId(body);
        started = true;
        remotePack = mergeObjectPacks(remotePack, {
          ...emptyObjectPack(createdAt),
          runs: [withRunId(runningRun, hostedRunId)],
          jobs: [withJobRunId(runningJob, hostedRunId)],
        });
        return jsonResponse(runSnapshotFixture(withRunId(runningRun, hostedRunId), [withJobRunId(runningJob, hostedRunId)]));
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    }));
    try {
      const result = await invoke(["eval", "--cloud", "--dir", root, "--agents", "default", "--json"]);
      expect(started).toBe(true);
      expect(result.code, result.stdout || result.stderr).toBe(1);
      expect(stdoutJson(result)).toMatchObject({
        ok: false,
        code: "cloud_run_pending",
        remediation: `workbench run watch ${hostedRunId}`,
        subject: {
          runId: hostedRunId,
          status: "running",
        },
      });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousTimeout === undefined) {
        delete process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
      } else {
        process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  test("hosted eval can detach with pending run ids on SIGINT", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-detach-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousTimeout = process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = "2000";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    const versionId = await currentVersionIdFor(root);
    const createdAt = "2026-06-11T00:00:00.000Z";
    const runningRun = {
      id: "run_detach",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "default",
      agentHash: "agent_cloud",
      status: "running",
      jobIds: ["job_detach"],
      traceIds: [],
      createdAt,
    };
    const succeededRun = {
      ...runningRun,
      status: "succeeded",
      score: 1,
      traceIds: ["trace_detach"],
      finishedAt: createdAt,
    };
    const runningJob = {
      id: "job_detach",
      runId: "run_detach",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "default",
      agentHash: "agent_cloud",
      caseId: "case-001",
      sample: 0,
      status: "queued",
      artifactIds: [],
      traceIds: [],
      createdAt,
    };
    const succeededJob = {
      ...runningJob,
      status: "succeeded",
      score: 1,
      traceIds: ["trace_detach"],
      finishedAt: createdAt,
    };
    let hostedRunId = runningRun.id;
    let remotePack = emptyObjectPack(createdAt);
    let started = false;
    let signalScheduled = false;
    let waitRequestAborted = false;
    let inspectionReadsAfterStart = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/snapshot" && method === "GET") {
        inspectionReadsAfterStart += started ? 1 : 0;
        return jsonResponse(cloudInspectionEnvelope(`cloud:${inspectionReadsAfterStart}`, {
          ...remotePack,
          runs: [withRunId(runningRun, hostedRunId)],
          jobs: [withJobRunId(runningJob, hostedRunId)],
        }));
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/state/wait" && method === "GET") {
        const signal = init?.signal as AbortSignal | undefined;
        expect(signal).toBeTruthy();
        const pendingWait = new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            waitRequestAborted = true;
            const error = new Error("This operation was aborted.");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
        if (!signalScheduled) {
          signalScheduled = true;
          setTimeout(() => process.emit("SIGINT"), 0);
        }
        return await pendingWait;
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack?: ReturnType<typeof emptyObjectPack> };
        remotePack = mergeObjectPacks(remotePack, body.objectPack ?? emptyObjectPack(createdAt));
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/operations" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({ versionId, agent: "default", samples: 1 });
        expect(body).not.toHaveProperty("evalHash");
        expect(body).not.toHaveProperty("skillBundleHash");
        expect(body).not.toHaveProperty("agentHash");
        hostedRunId = requestRunId(body);
        started = true;
        remotePack = {
          ...remotePack,
          runs: [withRunId(runningRun, hostedRunId)],
          jobs: [withJobRunId(runningJob, hostedRunId)],
        };
        return jsonResponse(runSnapshotFixture(withRunId(runningRun, hostedRunId), [withJobRunId(runningJob, hostedRunId)]));
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const detached = await invoke(["eval", "--cloud", "--dir", root, "--agents", "default", "--json"]);
      expect(detached.code, detached.stdout || detached.stderr).toBe(130);
      expect(stdoutJson(detached)).toMatchObject({
        schema: "workbench.cli.error.v1",
        ok: false,
        code: "cloud_detached",
        detached: true,
        run: expect.objectContaining({ id: hostedRunId, status: "running" }),
        next: `workbench run watch ${hostedRunId.slice(0, 12)}`,
        cloud: expect.objectContaining({
          detached: true,
          runId: hostedRunId,
        }),
      });
      expect(detached.stderr).not.toContain("workbench cloud:");
      expect(detached.stderr).toContain(`workbench eval: detaching from hosted run (${hostedRunId.slice(0, 12)}).`);
      expect(waitRequestAborted).toBe(true);
      const shown = await invoke(["show", hostedRunId, "--dir", root, "--json"]);
      expect(shown.code, shown.stdout || shown.stderr).toBe(0);
      expect(stdoutJson(shown)).toMatchObject({
        ok: true,
        result: expect.objectContaining({
          details: [
            expect.objectContaining({
              runId: hostedRunId,
              executions: [
                expect.objectContaining({
                  status: "queued",
                  jobIds: ["job_detach"],
                }),
              ],
            }),
          ],
        }),
      });
      remotePack = {
        ...remotePack,
        runs: [withRunId(succeededRun, hostedRunId)],
        jobs: [withJobRunId(succeededJob, hostedRunId)],
      };
      const synced = await invoke(["sync", "cloud", "--dir", root, "--json"]);
      expect(synced.code, synced.stdout || synced.stderr).toBe(0);
      expect(stdoutJson(synced)).toMatchObject({
        schema: "workbench.cli.sync.v1",
        ok: true,
        next: `workbench show ${hostedRunId.slice(0, 12)}`,
      });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousTimeout === undefined) {
        delete process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
      } else {
        process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  test("hosted eval auto-links an unpublished cloud skill", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-autolink-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousTimeout = process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = "1000";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "Alice.User",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    const fileRemoteUrl = await writeFileRemoteNamedCloud(root, "workbench-cli-cloud-autolink-file-remote-");
    const ownerSlug = "alice-user";
    const baseSkillName = normalizeTestHandlePart(path.basename(root));
    const skillName = `${baseSkillName}-2`;
    const versionId = await currentVersionIdFor(root);
    const createdAt = "2026-06-11T00:00:00.000Z";
    const runningRun = {
      id: "run_autolink",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_autolink",
      evalHash: "eval_autolink",
      agentName: "default",
      agentHash: "agent_autolink",
      status: "running",
      jobIds: ["job_autolink"],
      traceIds: [],
      createdAt,
    };
    const succeededRun = {
      ...runningRun,
      status: "succeeded",
      traceIds: ["trace_autolink"],
      finishedAt: "2026-06-11T00:00:02.000Z",
    };
    const succeededJob = {
      id: "job_autolink",
      runId: "run_autolink",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_autolink",
      evalHash: "eval_autolink",
      agentName: "default",
      agentHash: "agent_autolink",
      caseId: "case-001",
      sample: 0,
      status: "succeeded",
      score: 1,
      artifactIds: [],
      traceIds: ["trace_autolink"],
      createdAt,
      finishedAt: "2026-06-11T00:00:02.000Z",
    };
    const trace = {
      id: "trace_autolink",
      runId: "run_autolink",
      jobId: "job_autolink",
      versionId,
      skillName: "current",
      skillBundleHash: "bundle_autolink",
      evalHash: "eval_autolink",
      agentName: "default",
      agentHash: "agent_autolink",
      createdAt: "2026-06-11T00:00:02.000Z",
      request: {},
      result: { status: "succeeded" },
      files: [],
    };
    let created = false;
    let started = false;
    let objectReadsAfterStart = 0;
    let inspectionReadsAfterStart = 0;
    let hostedRunId = runningRun.id;
    let remotePack = emptyObjectPack(createdAt);
    const skillLookupUrls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        skillLookupUrls.push(`${url.pathname}${url.search}`);
        return jsonResponse({
          skills: [
            { id: "skill_existing", ownerSlug, name: baseSkillName },
            ...(created ? [{ id: "skill_autolink", ownerSlug, name: skillName }] : []),
          ],
        });
      }
      if (url.pathname === "/api/workbench/skills" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { ownerSlug?: string; name?: string; state?: { refs?: Record<string, string> } };
        expect(body.ownerSlug).toBe(ownerSlug);
        expect(body.name).toBe(skillName);
        expect(body.state?.refs?.published).toBeUndefined();
        created = true;
        return jsonResponse({ skill: { id: "skill_autolink", ownerSlug, name: skillName } }, 201);
      }
      if (url.pathname === "/api/workbench/skills/skill_autolink/objects" && method === "GET") {
        if (started) {
          objectReadsAfterStart += 1;
          if (objectReadsAfterStart >= 1) {
            remotePack = mergeObjectPacks(remotePack, {
              ...emptyObjectPack(createdAt),
              runs: [withRunId(succeededRun, hostedRunId)],
              jobs: [withJobRunId(succeededJob, hostedRunId)],
              traces: [withTraceRunId(trace, hostedRunId)],
            });
          }
        }
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_autolink/workbench/snapshot" && method === "GET") {
        inspectionReadsAfterStart += started ? 1 : 0;
        const terminal = inspectionReadsAfterStart >= 2;
        return jsonResponse(cloudInspectionEnvelope(`cloud:${inspectionReadsAfterStart}`, {
          ...remotePack,
          runs: [withRunId(terminal ? succeededRun : runningRun, hostedRunId)],
          jobs: terminal ? [withJobRunId(succeededJob, hostedRunId)] : [],
          traces: terminal ? [withTraceRunId(trace, hostedRunId)] : [],
        }, `/skills/${ownerSlug}/${skillName}`));
      }
      if (url.pathname === "/api/workbench/skills/skill_autolink/workbench/state/wait" && method === "GET") {
        return jsonResponse({
          schema: "workbench.state.notice.v1",
          type: "changed",
          cursor: `cloud:${inspectionReadsAfterStart + 1}`,
        });
      }
      if (url.pathname === "/api/workbench/skills/skill_autolink/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack?: ReturnType<typeof emptyObjectPack> };
        remotePack = mergeObjectPacks(remotePack, body.objectPack ?? emptyObjectPack(createdAt));
        return jsonResponse({ skill: { id: "skill_autolink", ownerSlug, name: skillName } });
      }
      if (url.pathname === "/api/workbench/skills/skill_autolink/workbench/operations" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({ versionId, samples: 1 });
        expect(body).not.toHaveProperty("agent");
        expect(body).not.toHaveProperty("evalHash");
        expect(body).not.toHaveProperty("skillBundleHash");
        expect(body).not.toHaveProperty("agentHash");
        hostedRunId = requestRunId(body);
        started = true;
        remotePack = mergeObjectPacks(remotePack, {
          ...emptyObjectPack(createdAt),
          runs: [withRunId(runningRun, hostedRunId)],
        });
        return jsonResponse(runSnapshotFixture(withRunId(runningRun, hostedRunId)));
      }
      if (url.pathname === `/api/workbench/source/skills/${ownerSlug}/${skillName}/source` && method === "GET") {
        expect(started).toBe(true);
        return jsonResponse({
          schema: "workbench.cloud.error.v1",
          code: "source_not_available",
          message: "No published source is available.",
          retryable: false,
          remediation: "workbench publish",
        }, 404);
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const evalResult = await invoke(["eval", "--cloud", "--dir", root, "--json"]);
      expect(evalResult.code, evalResult.stdout || evalResult.stderr).toBe(0);
      expect(stdoutJson(evalResult)).toMatchObject({
        ok: true,
        run: expect.objectContaining({ id: hostedRunId, status: "succeeded" }),
        cloud: expect.objectContaining({
          remote: "cloud-1",
          skillId: "skill_autolink",
        }),
      });
      const remotesYaml = await fs.readFile(path.join(root, ".workbench", "remotes.yaml"), "utf8");
      expect(remotesYaml).toContain(fileRemoteUrl);
      expect(remotesYaml).toContain("cloud-1:");
      expect(remotesYaml).toContain(`https://cloud.test/skills/${ownerSlug}/${skillName}`);
      expect(skillLookupUrls.length).toBeGreaterThan(0);
      expect(skillLookupUrls.every((entry) =>
        entry.startsWith("/api/workbench/skills?") &&
        entry.includes(`owner=${encodeURIComponent(ownerSlug)}`) &&
        entry.includes("name=")
      )).toBe(true);

      const install = await invoke(["install", `${ownerSlug}/${skillName}`, "--json"]);
      expect(install.code).toBe(1);
      expect(stdoutJson(install)).toMatchObject({
        ok: false,
        code: "source_not_available",
      });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousTimeout === undefined) {
        delete process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
      } else {
        process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  test("hosted improve failures exit nonzero after terminal sync", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-improve-fail-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousTimeout = process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = "1000";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    await addCommandImproveAgent(root);
    const { prepared } = await seedFailedImproveEvidence(root, "patcher");
    const createdAt = "2026-06-11T00:00:00.000Z";
    const runningRun = {
      id: "run_improve_cloud",
      kind: "improve",
      versionId: prepared.versionId,
      skillName: prepared.skill,
      skillBundleHash: prepared.skillBundleHash,
      evalHash: prepared.evalHash,
      agentName: prepared.agent,
      agentHash: prepared.agentHash,
      status: "running",
      jobIds: ["job_improve_cloud"],
      traceIds: [],
      createdAt,
    };
    const failedRun = {
      ...runningRun,
      status: "failed",
      finishedAt: "2026-06-11T00:00:02.000Z",
      error: "hosted improve failed",
    };
    const failedJob = {
      id: "job_improve_cloud",
      runId: "run_improve_cloud",
      kind: "improve",
      versionId: prepared.versionId,
      skillName: prepared.skill,
      skillBundleHash: prepared.skillBundleHash,
      evalHash: prepared.evalHash,
      agentName: prepared.agent,
      agentHash: prepared.agentHash,
      caseId: "current",
      sample: 0,
      status: "failed",
      artifactIds: [],
      traceIds: [],
      createdAt,
      finishedAt: "2026-06-11T00:00:02.000Z",
      error: "hosted improve failed",
    };
    let hostedRunId = runningRun.id;
    let remotePack = emptyObjectPack(createdAt);
    let started = false;
    let inspectionReadsAfterStart = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        if (started) {
          remotePack = { ...remotePack, runs: [withRunId(failedRun, hostedRunId)], jobs: [withJobRunId(failedJob, hostedRunId)] };
        }
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/snapshot" && method === "GET") {
        inspectionReadsAfterStart += started ? 1 : 0;
        const terminal = inspectionReadsAfterStart >= 2;
        return jsonResponse(cloudInspectionEnvelope(`cloud:${inspectionReadsAfterStart}`, {
          ...remotePack,
          runs: [withRunId(terminal ? failedRun : runningRun, hostedRunId)],
          jobs: terminal ? [withJobRunId(failedJob, hostedRunId)] : [],
        }));
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/state/wait" && method === "GET") {
        return jsonResponse({
          schema: "workbench.state.notice.v1",
          type: "changed",
          cursor: `cloud:${inspectionReadsAfterStart + 1}`,
        });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "PUT") {
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/operations" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          versionId: prepared.versionId,
          agent: "patcher",
          samples: 1,
          budget: 1,
        });
        expect(body).not.toHaveProperty("evalHash");
        expect(body).not.toHaveProperty("skillBundleHash");
        expect(body).not.toHaveProperty("agentHash");
        expect(body).not.toHaveProperty("evidenceTraceIds");
        hostedRunId = requestRunId(body);
        started = true;
        remotePack = { ...remotePack, runs: [withRunId(runningRun, hostedRunId)] };
        return jsonResponse(runSnapshotFixture(withRunId(runningRun, hostedRunId)));
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const improve = await invoke(["improve", "--cloud", "--dir", root, "--agents", "patcher", "--json"]);
      expect(improve.code).toBe(1);
      expect(stdoutJson(improve)).toMatchObject({
        ok: false,
        code: "improve_failed",
        remediation: `workbench show ${hostedRunId}`,
      });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousTimeout === undefined) {
        delete process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
      } else {
        process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  test("hosted improve switches local source when cloud promotes the output version", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-improve-success-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousTimeout = process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = "1000";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    await addCommandImproveAgent(root);
    const { prepared } = await seedFailedImproveEvidence(root, "patcher");
    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
    const baseVersion = snapshot.versions.find((version) => version.id === prepared.versionId) ?? snapshot.versions[0]!;
    const skillFile = stdoutJson<{ result: { path: string; content: string; kind?: string; encoding?: string; executable?: boolean } }>(
      await invoke(["show", `${baseVersion.id}:SKILL.md`, "--dir", root, "--json"]),
    ).result;
    const improvedVersionId = "v_cloud_improved";
    const improvedFiles = [skillFile, ...baseVersion.files.filter((file) => file.path !== "SKILL.md").map((file) => ({ ...file }))].map((file) =>
      file.path === "SKILL.md"
        ? { ...file, content: "# Hosted Improved Skill\n\nCloud promotion.\n" }
        : file
    );
    const improvedVersion = {
      id: improvedVersionId,
      hash: hashFiles(improvedFiles),
      message: "Hosted improvement",
      parentIds: [baseVersion.id],
      createdAt: "2026-06-11T00:00:02.000Z",
      files: improvedFiles,
    };
    const createdAt = "2026-06-11T00:00:00.000Z";
    const runningRun = {
      id: "run_improve_success",
      kind: "improve",
      versionId: baseVersion.id,
      skillName: prepared.skill,
      skillBundleHash: prepared.skillBundleHash,
      evalHash: prepared.evalHash,
      agentName: prepared.agent,
      agentHash: prepared.agentHash,
      status: "running",
      outputVersionId: improvedVersionId,
      jobIds: ["job_improve_success"],
      traceIds: [],
      createdAt,
    };
    const succeededRun = {
      ...runningRun,
      status: "succeeded",
      score: 1,
      traceIds: ["trace_improve_success"],
      finishedAt: "2026-06-11T00:00:02.000Z",
    };
    const succeededJob = {
      id: "job_improve_success",
      runId: "run_improve_success",
      kind: "improve",
      versionId: baseVersion.id,
      skillName: prepared.skill,
      skillBundleHash: prepared.skillBundleHash,
      evalHash: prepared.evalHash,
      agentName: prepared.agent,
      agentHash: prepared.agentHash,
      caseId: "current",
      sample: 0,
      status: "succeeded",
      score: 1,
      artifactIds: [],
      traceIds: ["trace_improve_success"],
      createdAt,
      finishedAt: "2026-06-11T00:00:02.000Z",
    };
    const trace = {
      id: "trace_improve_success",
      runId: "run_improve_success",
      jobId: "job_improve_success",
      versionId: baseVersion.id,
      skillName: prepared.skill,
      skillBundleHash: prepared.skillBundleHash,
      evalHash: prepared.evalHash,
      agentName: prepared.agent,
      agentHash: prepared.agentHash,
      createdAt: "2026-06-11T00:00:02.000Z",
      request: {},
      result: { status: "succeeded" },
      files: [],
    };
    const publishedRefs = {
      "publication/current-version": baseVersion.id,
      [`publication/versions/${baseVersion.id}`]: baseVersion.id,
      "publication/install-handle": "alice/cloud-skill",
      "publication/visibility": "public",
    };
    let hostedRunId = runningRun.id;
    let remotePack = { ...emptyObjectPack(createdAt), refs: publishedRefs };
    let started = false;
    let objectReadsAfterStart = 0;
    let inspectionReadsAfterStart = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/snapshot" && method === "GET") {
        inspectionReadsAfterStart += started ? 1 : 0;
        const terminal = inspectionReadsAfterStart >= 2;
        return jsonResponse(cloudInspectionEnvelope(`cloud:${inspectionReadsAfterStart}`, {
          ...remotePack,
          runs: [withRunId(terminal ? succeededRun : runningRun, hostedRunId)],
          jobs: terminal ? [withJobRunId(succeededJob, hostedRunId)] : [],
          traces: terminal ? [withTraceRunId(trace, hostedRunId)] : [],
        }));
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/state/wait" && method === "GET") {
        return jsonResponse({
          schema: "workbench.state.notice.v1",
          type: "changed",
          cursor: `cloud:${inspectionReadsAfterStart + 1}`,
        });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        if (started) {
          objectReadsAfterStart += 1;
          if (objectReadsAfterStart >= 1) {
            remotePack = mergeObjectPacks(remotePack, {
              ...emptyObjectPack(createdAt),
              refs: { current: improvedVersionId },
              versions: [improvedVersion],
              runs: [withRunId(succeededRun, hostedRunId)],
              jobs: [withJobRunId(succeededJob, hostedRunId)],
              traces: [withTraceRunId(trace, hostedRunId)],
            });
          }
        }
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack?: ReturnType<typeof emptyObjectPack> };
        remotePack = mergeObjectPacks(remotePack, body.objectPack ?? emptyObjectPack(createdAt));
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/operations" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          versionId: prepared.versionId,
          agent: "patcher",
          samples: 1,
          budget: 1,
        });
        expect(body).not.toHaveProperty("evalHash");
        expect(body).not.toHaveProperty("skillBundleHash");
        expect(body).not.toHaveProperty("agentHash");
        expect(body).not.toHaveProperty("evidenceTraceIds");
        hostedRunId = requestRunId(body);
        started = true;
        remotePack = mergeObjectPacks(remotePack, {
          ...emptyObjectPack(createdAt),
          runs: [withRunId(runningRun, hostedRunId)],
        });
        return jsonResponse(runSnapshotFixture(withRunId(runningRun, hostedRunId)));
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const improve = await invoke(["improve", "--cloud", "--dir", root, "--agents", "patcher", "--json"]);
      expect(improve.code, improve.stdout || improve.stderr).toBe(0);
      const improveJson = stdoutJson<{ run: { measurements: unknown[] } }>(improve);
      expect(improveJson).toMatchObject({
        schema: "workbench.cli.improve.v1",
        ok: true,
        next: "workbench eval --rerun -n 5",
        switched: true,
        promoted: true,
        version: { id: improvedVersionId },
        run: { id: hostedRunId },
        cloud: {
          skillId: "skill_cloud",
          sync: {
            before: expect.objectContaining({ status: "synced", changed: expect.any(Boolean) }),
            after: expect.objectContaining({ status: "synced", changed: expect.any(Boolean) }),
          },
        },
      });
      expect(improveJson.run.measurements).toHaveLength(1);
      await expect(fs.readFile(path.join(root, "SKILL.md"), "utf8"))
        .resolves.toContain("Hosted Improved Skill");
      const syncDryRun = await invoke(["sync", "cloud", "--dry-run", "--dir", root, "--json"]);
      expect(syncDryRun.code, syncDryRun.stdout || syncDryRun.stderr).toBe(0);
      expect(stdoutJson(syncDryRun)).toMatchObject({
        pushed: 0,
        pulled: 0,
        changed: false,
        next: null,
      });
      await writePassingCaseTest(root);
      const status = await invoke(["status", "--dir", root, "--json"]);
      expect(status.code, status.stdout || status.stderr).toBe(0);
      expect(stdoutJson<{ next: string | null; remotes: Array<{ publication: { currentVersionId?: string } }> }>(status))
        .toMatchObject({
          next: "workbench eval --rerun -n 5",
          remotes: [
            expect.objectContaining({
              sync: expect.objectContaining({ status: "up_to_date" }),
              publication: expect.objectContaining({ currentVersionId: baseVersion.id }),
            }),
          ],
        });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousTimeout === undefined) {
        delete process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
      } else {
        process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  test("status points detached hosted improve output at switch before publish", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-improve-detached-status-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    await addCommandImproveAgent(root);
    const { prepared } = await seedFailedImproveEvidence(root, "patcher");
    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
    const baseVersion = snapshot.versions.find((version) => version.id === prepared.versionId) ?? snapshot.versions[0]!;
    const skillFile = stdoutJson<{ result: { path: string; content: string; kind?: string; encoding?: string; executable?: boolean } }>(
      await invoke(["show", `${baseVersion.id}:SKILL.md`, "--dir", root, "--json"]),
    ).result;
    const improvedVersionId = "v_cbd027340000000000000000000000000000000000000000000000000000000000";
    const improvedVersion = {
      id: improvedVersionId,
      hash: "cbd027340000000000000000000000000000000000000000000000000000000000",
      message: "Hosted improvement",
      parentIds: [baseVersion.id],
      createdAt: "2026-06-11T00:00:02.000Z",
      files: [skillFile, ...baseVersion.files.filter((file) => file.path !== "SKILL.md").map((file) => ({ ...file }))].map((file) =>
        file.path === "SKILL.md"
          ? { ...file, content: `${file.content}\nIMPROVED_MARKER\n` }
          : file
      ),
    };
    const createdAt = "2026-06-11T00:00:00.000Z";
    const evalRun = {
      id: "run_detached_eval",
      kind: "eval",
      versionId: baseVersion.id,
      skillName: prepared.skill,
      skillBundleHash: prepared.skillBundleHash,
      evalHash: prepared.evalHash,
      agentName: prepared.agent,
      agentHash: prepared.agentHash,
      status: "succeeded",
      score: 1,
      jobIds: ["job_detached_eval"],
      traceIds: ["trace_detached_eval"],
      createdAt,
      finishedAt: "2026-06-11T00:00:01.000Z",
    };
    const evalJob = {
      id: "job_detached_eval",
      runId: evalRun.id,
      kind: "eval",
      versionId: baseVersion.id,
      skillName: prepared.skill,
      skillBundleHash: prepared.skillBundleHash,
      evalHash: prepared.evalHash,
      agentName: prepared.agent,
      agentHash: prepared.agentHash,
      caseId: "case-001",
      sample: 0,
      status: "succeeded",
      score: 1,
      artifactIds: [],
      traceIds: ["trace_detached_eval"],
      createdAt,
      finishedAt: "2026-06-11T00:00:01.000Z",
    };
    const evalTrace = {
      id: "trace_detached_eval",
      runId: evalRun.id,
      jobId: evalJob.id,
      versionId: baseVersion.id,
      skillName: prepared.skill,
      skillBundleHash: prepared.skillBundleHash,
      evalHash: prepared.evalHash,
      agentName: prepared.agent,
      agentHash: prepared.agentHash,
      createdAt,
      request: {},
      result: { status: "succeeded", score: 1 },
      files: [],
    };
    const improveRun = {
      id: "run_detached_improve",
      kind: "improve",
      versionId: baseVersion.id,
      skillName: prepared.skill,
      skillBundleHash: prepared.skillBundleHash,
      evalHash: prepared.evalHash,
      agentName: prepared.agent,
      agentHash: prepared.agentHash,
      status: "succeeded",
      score: 1,
      outputVersionId: improvedVersionId,
      jobIds: ["job_detached_improve"],
      traceIds: ["trace_detached_improve"],
      createdAt: "2026-06-11T00:00:02.000Z",
      finishedAt: "2026-06-11T00:00:03.000Z",
    };
    const improveJob = {
      id: "job_detached_improve",
      runId: improveRun.id,
      kind: "improve",
      versionId: baseVersion.id,
      skillName: prepared.skill,
      skillBundleHash: prepared.skillBundleHash,
      evalHash: prepared.evalHash,
      agentName: prepared.agent,
      agentHash: prepared.agentHash,
      caseId: "current",
      sample: 0,
      status: "succeeded",
      score: 1,
      artifactIds: [],
      traceIds: ["trace_detached_improve"],
      createdAt: "2026-06-11T00:00:02.000Z",
      finishedAt: "2026-06-11T00:00:03.000Z",
    };
    const improveTrace = {
      id: "trace_detached_improve",
      runId: improveRun.id,
      jobId: improveJob.id,
      versionId: baseVersion.id,
      skillName: prepared.skill,
      skillBundleHash: prepared.skillBundleHash,
      evalHash: prepared.evalHash,
      agentName: prepared.agent,
      agentHash: prepared.agentHash,
      createdAt: "2026-06-11T00:00:03.000Z",
      request: {},
      result: { status: "succeeded", score: 1 },
      files: [],
    };
    const remotePack = mergeObjectPacks(emptyObjectPack(createdAt), {
      ...emptyObjectPack(createdAt),
      refs: {
        current: improvedVersionId,
        "publication/current-version": baseVersion.id,
        [`publication/versions/${baseVersion.id}`]: baseVersion.id,
        "publication/install-handle": "alice/cloud-skill",
        "publication/visibility": "public",
      },
      versions: [improvedVersion],
      runs: [evalRun, improveRun],
      jobs: [evalJob, improveJob],
      traces: [evalTrace, improveTrace],
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "PUT") {
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } });
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    }));
    try {
      const synced = await invoke(["sync", "cloud", "--dir", root, "--json"]);
      expect(synced.code, synced.stdout || synced.stderr).toBe(0);
      expect(stdoutJson(synced)).toMatchObject({
        ok: true,
      });
      expect(stdoutJson<{ next: string | null }>(synced).next).toMatch(/^workbench show run_/u);
      await expect(fs.readFile(path.join(root, "SKILL.md"), "utf8"))
        .resolves.not.toContain("IMPROVED_MARKER");
      const candidate = await invoke(["show", `${improvedVersionId}:SKILL.md`, "--dir", root, "--json"]);
      expect(candidate.code, candidate.stdout || candidate.stderr).toBe(0);
      expect(stdoutJson<{ result: { content: string } }>(candidate).result.content).toContain("IMPROVED_MARKER");
      const status = await invoke(["status", "--dir", root, "--json"]);
      expect(status.code, status.stdout || status.stderr).toBe(0);
      expect(stdoutJson<{ project: { currentVersionId?: string }; next: string | null }>(status))
        .toMatchObject({
          project: { currentVersionId: baseVersion.id },
          next: "workbench switch cbd02734",
        });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("hosted improve refuses to overwrite local edits made while cloud is running", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-improve-conflict-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousTimeout = process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = "1000";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    await addCommandImproveAgent(root);
    const { prepared } = await seedFailedImproveEvidence(root, "patcher");
    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
    const baseVersion = snapshot.versions.find((version) => version.id === prepared.versionId) ?? snapshot.versions[0]!;
    const skillFile = stdoutJson<{ result: { path: string; content: string; kind?: string; encoding?: string; executable?: boolean } }>(
      await invoke(["show", `${baseVersion.id}:SKILL.md`, "--dir", root, "--json"]),
    ).result;
    const improvedVersionId = "v_cloud_conflict_improved";
    const localEdit = "Concurrent local edit while hosted improve runs.";
    const improvedVersion = {
      id: improvedVersionId,
      hash: "hash_cloud_conflict_improved",
      message: "Hosted improvement",
      parentIds: [baseVersion.id],
      createdAt: "2026-06-11T00:00:02.000Z",
      files: [skillFile, ...baseVersion.files.filter((file) => file.path !== "SKILL.md").map((file) => ({
        path: file.path,
        kind: file.kind,
        encoding: file.encoding,
        executable: file.executable,
        content: "",
      }))].map((file) =>
        file.path === "SKILL.md"
          ? { ...file, content: "# Hosted Improved Skill\n\nCloud promotion.\n" }
          : file
      ),
    };
    const createdAt = "2026-06-11T00:00:00.000Z";
    const runningRun = {
      id: "run_improve_conflict",
      kind: "improve",
      versionId: baseVersion.id,
      skillName: prepared.skill,
      skillBundleHash: prepared.skillBundleHash,
      evalHash: prepared.evalHash,
      agentName: prepared.agent,
      agentHash: prepared.agentHash,
      status: "running",
      outputVersionId: improvedVersionId,
      jobIds: ["job_improve_conflict"],
      traceIds: [],
      createdAt,
    };
    const succeededRun = {
      ...runningRun,
      status: "succeeded",
      score: 1,
      traceIds: ["trace_improve_conflict"],
      finishedAt: "2026-06-11T00:00:02.000Z",
    };
    const succeededJob = {
      id: "job_improve_conflict",
      runId: "run_improve_conflict",
      kind: "improve",
      versionId: baseVersion.id,
      skillName: prepared.skill,
      skillBundleHash: prepared.skillBundleHash,
      evalHash: prepared.evalHash,
      agentName: prepared.agent,
      agentHash: prepared.agentHash,
      caseId: "current",
      sample: 0,
      status: "succeeded",
      score: 1,
      artifactIds: [],
      traceIds: ["trace_improve_conflict"],
      createdAt,
      finishedAt: "2026-06-11T00:00:02.000Z",
    };
    const trace = {
      id: "trace_improve_conflict",
      runId: "run_improve_conflict",
      jobId: "job_improve_conflict",
      versionId: baseVersion.id,
      skillName: prepared.skill,
      skillBundleHash: prepared.skillBundleHash,
      evalHash: prepared.evalHash,
      agentName: prepared.agent,
      agentHash: prepared.agentHash,
      createdAt: "2026-06-11T00:00:02.000Z",
      request: {},
      result: { status: "succeeded" },
      files: [],
    };
    let hostedRunId = runningRun.id;
    let remotePack = emptyObjectPack(createdAt);
    let started = false;
    let objectReadsAfterStart = 0;
    let inspectionReadsAfterStart = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/snapshot" && method === "GET") {
        inspectionReadsAfterStart += started ? 1 : 0;
        const terminal = inspectionReadsAfterStart >= 2;
        return jsonResponse(cloudInspectionEnvelope(`cloud:${inspectionReadsAfterStart}`, {
          ...remotePack,
          runs: [withRunId(terminal ? succeededRun : runningRun, hostedRunId)],
          jobs: terminal ? [withJobRunId(succeededJob, hostedRunId)] : [],
          traces: terminal ? [withTraceRunId(trace, hostedRunId)] : [],
        }));
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/state/wait" && method === "GET") {
        return jsonResponse({
          schema: "workbench.state.notice.v1",
          type: "changed",
          cursor: `cloud:${inspectionReadsAfterStart + 1}`,
        });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        if (started) {
          objectReadsAfterStart += 1;
          if (objectReadsAfterStart >= 1) {
            remotePack = mergeObjectPacks(remotePack, {
              ...emptyObjectPack(createdAt),
              refs: { current: improvedVersionId },
              versions: [improvedVersion],
              runs: [withRunId(succeededRun, hostedRunId)],
              jobs: [withJobRunId(succeededJob, hostedRunId)],
              traces: [withTraceRunId(trace, hostedRunId)],
            });
          }
        }
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack?: ReturnType<typeof emptyObjectPack> };
        remotePack = mergeObjectPacks(remotePack, body.objectPack ?? emptyObjectPack(createdAt));
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/operations" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          versionId: prepared.versionId,
          agent: "patcher",
          samples: 1,
          budget: 1,
        });
        expect(body).not.toHaveProperty("evalHash");
        expect(body).not.toHaveProperty("skillBundleHash");
        expect(body).not.toHaveProperty("agentHash");
        expect(body).not.toHaveProperty("evidenceTraceIds");
        hostedRunId = requestRunId(body);
        started = true;
        remotePack = mergeObjectPacks(remotePack, {
          ...emptyObjectPack(createdAt),
          runs: [withRunId(runningRun, hostedRunId)],
        });
        await fs.appendFile(path.join(root, "SKILL.md"), `\n${localEdit}\n`);
        return jsonResponse(runSnapshotFixture(withRunId(runningRun, hostedRunId)));
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const improve = await invoke(["improve", "--cloud", "--dir", root, "--agents", "patcher", "--json"]);
      expect(improve.code).toBe(1);
      expect(stdoutJson(improve)).toMatchObject({
        ok: false,
        code: "worktree_changed",
        remediation: `workbench switch ${improvedVersionId}`,
        subject: {
          startedFrom: baseVersion.id,
          hostedVersion: improvedVersionId,
        },
      });
      const skillSource = await fs.readFile(path.join(root, "SKILL.md"), "utf8");
      expect(skillSource).toContain(localEdit);
      expect(skillSource).not.toContain("Hosted Improved Skill");
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousTimeout === undefined) {
        delete process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
      } else {
        process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  test("hosted eval fails when cloud omits run ids", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-missing-run-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    await writePassingCaseTest(root);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    const remotePack = emptyObjectPack("2026-06-11T00:00:00.000Z");
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "PUT") {
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/workbench/operations" && method === "POST") {
        return jsonResponse({
          skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" },
          runs: [],
        });
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const evalResult = await invoke(["eval", "--cloud", "--dir", root, "--json"]);
      expect(evalResult.code).toBe(1);
      expect(stdoutJson(evalResult)).toMatchObject({
        ok: false,
        code: "cloud_run_missing",
        remediation: "workbench log --runs",
      });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("publish dry-run previews derived cloud remote without mutating remotes", async () => {
    const root = await makeTempRoot("workbench-cli-publish-dry-run-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "publish-token",
      username: "Alice.User",
    }));
    try {
      expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
      const installHandle = `alice-user/${normalizeTestHandlePart(path.basename(root))}`;
      const originalVersionId = stdoutJson<{ entries: Array<{ id: string }> }>(
        await invoke(["log", "--versions", "--dir", root, "--json"]),
      ).entries[0]!.id;
      await fs.appendFile(path.join(root, "SKILL.md"), "\nDry-run publish edit.\n");
      const publish = await invoke(["publish", "--dry-run", "--public", "--dir", root, "--json"]);
      expect(publish.code, publish.stdout || publish.stderr).toBe(0);
      expect(stdoutJson(publish)).toMatchObject({
        schema: "workbench.cli.publish.v1",
        ok: true,
        dryRun: true,
        remote: expect.objectContaining({
          name: "cloud",
          kind: "workbench-cloud",
          url: expect.stringMatching(/^https:\/\/cloud\.test\/skills\/alice-user\/workbench-cli-publish-dry-run-[a-z0-9]+$/u),
        }),
        visibility: "public",
        installHandle,
      });
      expect(stdoutJson<{ version: { id: string } }>(publish).version.id).toBe(originalVersionId);
      const publishHuman = await invoke(["publish", "--dry-run", "--public", "--dir", root]);
      expect(publishHuman.code, publishHuman.stdout || publishHuman.stderr).toBe(0);
      expect(publishHuman.stdout).toContain(`Would publish ${shortTestRef(originalVersionId)} as ${installHandle} (public).`);
      expect(publishHuman.stdout).toContain(`next: workbench install ${installHandle}`);
      expect(publishHuman.stdout).not.toContain("to remote");
      expect(publishHuman.stdout).not.toContain("Install:");
      expect(publishHuman.stdout).not.toContain("Pinned:");
      expect(publishHuman.stdout).not.toContain("https://");
      const team = await invoke(["publish", "--dry-run", "--team", "--dir", root, "--json"]);
      expect(team.code, team.stdout || team.stderr).toBe(1);
      expect(stdoutJson(team)).toMatchObject({
        schema: "workbench.cli.error.v1",
        ok: false,
        code: "validation_failed",
        message: "Team source visibility requires an organization-owned skill.",
        remediation: "workbench publish --as ORG/SKILL --team",
        subject: {
          owner: "alice-user",
          visibility: "team",
          requirement: "Publish under an organization-owned skill to use team visibility.",
        },
      });
      const teamHuman = await invoke(["publish", "--dry-run", "--team", "--dir", root]);
      expect(teamHuman.code, teamHuman.stdout || teamHuman.stderr).toBe(1);
      const teamHumanOutput = teamHuman.stdout + teamHuman.stderr;
      expect(teamHumanOutput).toContain("Team source visibility requires an organization-owned skill.");
      expect(teamHumanOutput).toContain("next: workbench publish --as ORG/SKILL --team");
      await expect(fs.access(path.join(root, ".workbench", "remotes.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("publish dry-run reports missing Cloud auth before previewing install", async () => {
    const root = await makeTempRoot("workbench-cli-publish-dry-run-auth-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousApiToken = process.env.WORKBENCH_API_TOKEN;
    const previousSmokeToken = process.env.WORKBENCH_SMOKE_BEARER_TOKEN;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_API_TOKEN = "";
    process.env.WORKBENCH_SMOKE_BEARER_TOKEN = "";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      username: "alice",
    }));
    const fetchMock = vi.fn(async () => jsonResponse({ message: "unexpected network call" }, 500));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);

      const publish = await invoke(["publish", "--dry-run", "--dir", root, "--json"]);

      expect(publish.code, publish.stdout || publish.stderr).toBe(1);
      expect(stdoutJson(publish)).toMatchObject({
        ok: false,
        code: "auth_required",
        message: "workbench publish requires Workbench Cloud auth.",
        remediation: "workbench login --base-url https://cloud.test",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      await expect(fs.access(path.join(root, ".workbench", "remotes.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousApiToken === undefined) {
        delete process.env.WORKBENCH_API_TOKEN;
      } else {
        process.env.WORKBENCH_API_TOKEN = previousApiToken;
      }
      if (previousSmokeToken === undefined) {
        delete process.env.WORKBENCH_SMOKE_BEARER_TOKEN;
      } else {
        process.env.WORKBENCH_SMOKE_BEARER_TOKEN = previousSmokeToken;
      }
    }
  });

  test("publish --as dry-run does not persist the linked cloud handle", async () => {
    const root = await makeTempRoot("workbench-cli-publish-as-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "publish-token",
      username: "alice",
    }));
    let created = false;
    let remotePack = emptyObjectPack("2026-06-11T00:00:00.000Z");
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer publish-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({
          skills: created ? [{ id: "skill_as", ownerSlug: "acme", name: "earnings-prep" }] : [],
        });
      }
      if (url.pathname === "/api/workbench/skills" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { ownerSlug?: string; name?: string; state?: { refs?: Record<string, string> } };
        expect(body.ownerSlug).toBe("acme");
        expect(body.name).toBe("earnings-prep");
        expect(body.state?.refs?.published).toBeUndefined();
        created = true;
        return jsonResponse({ skill: { id: "skill_as", ownerSlug: "acme", name: "earnings-prep" } }, 201);
      }
      if (url.pathname === "/api/workbench/skills/skill_as/objects" && method === "GET") {
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_as/objects" && method === "PUT") {
        remotePack = JSON.parse(String(init?.body)).objectPack as ReturnType<typeof emptyObjectPack>;
        return jsonResponse({ skill: { id: "skill_as", ownerSlug: "acme", name: "earnings-prep" } });
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
      const fileRemoteUrl = await writeFileRemoteNamedCloud(root, "workbench-cli-publish-as-file-remote-");
      const first = await invoke(["publish", "--as", "Acme/Earnings.Prep", "--dry-run", "--dir", root, "--json"]);
      expect(first.code, first.stdout || first.stderr).toBe(0);
      expect(stdoutJson(first)).toMatchObject({
        schema: "workbench.cli.publish.v1",
        ok: true,
        dryRun: true,
        remote: expect.objectContaining({
          name: "cloud-1",
          url: "https://cloud.test/skills/acme/earnings-prep",
        }),
        installHandle: "acme/earnings-prep",
      });
      expect(stdoutJson(first)).not.toHaveProperty("installUrl");
      expect(stdoutJson(first)).not.toHaveProperty("pinnedInstallUrl");
      const remotesYaml = await fs.readFile(path.join(root, ".workbench", "remotes.yaml"), "utf8");
      expect(remotesYaml).toContain(fileRemoteUrl);
      expect(remotesYaml).not.toContain("cloud-1:");
      expect(remotesYaml).not.toContain("https://cloud.test/skills/acme/earnings-prep");

      const second = await invoke(["publish", "--as", "Acme/Earnings.Prep", "--dry-run", "--dir", root, "--json"]);
      expect(second.code, second.stdout || second.stderr).toBe(0);
      expect(stdoutJson(second)).toMatchObject({
        schema: "workbench.cli.publish.v1",
        ok: true,
        dryRun: true,
        remote: expect.objectContaining({
          name: "cloud-1",
          url: "https://cloud.test/skills/acme/earnings-prep",
        }),
        installHandle: "acme/earnings-prep",
      });
      expect(stdoutJson(second)).not.toHaveProperty("installUrl");
      expect(stdoutJson(second)).not.toHaveProperty("pinnedInstallUrl");
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("publish refuses to auto-link an existing derived cloud handle", async () => {
    const root = await makeTempRoot("workbench-cli-publish-derived-conflict-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "publish-token",
      username: "Alice.User",
    }));
    try {
      expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
      const derivedSkill = normalizeTestHandlePart(path.basename(root));
      const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        const method = (init?.method ?? "GET").toUpperCase();
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer publish-token");
        if (url.pathname === "/api/workbench/skills" && method === "GET") {
          return jsonResponse({
            skills: [{ id: "skill_existing", ownerSlug: "alice-user", name: derivedSkill }],
          });
        }
        return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
      });
      vi.stubGlobal("fetch", fetchMock);

      const publish = await invoke(["publish", "--dir", root, "--json"]);
      expect(publish.code, publish.stdout || publish.stderr).toBe(2);
      expect(publish.stderr).toBe("");
      expect(stdoutJson(publish)).toMatchObject({
        ok: false,
        code: "publish_handle_conflict",
        message: `Cloud skill alice-user/${derivedSkill} already exists; refusing to auto-link this local project to it.`,
        remediation: `workbench publish --as alice-user/${derivedSkill}-$(date +%s)`,
        subject: {
          suggestedSkill: `${derivedSkill}-2`,
          suggestedHandle: `alice-user/${derivedSkill}-$(date +%s)`,
        },
      });
      const lookupUrls = fetchMock.mock.calls.map(([input]) =>
        new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url)
      );
      expect(lookupUrls.map((url) => `${url.pathname}${url.search}`)).toEqual([
        `/api/workbench/skills?owner=alice-user&name=${encodeURIComponent(derivedSkill)}`,
        `/api/workbench/skills?owner=alice-user&name=${encodeURIComponent(`${derivedSkill}-2`)}`,
      ]);
      await expect(fs.access(path.join(root, ".workbench", "remotes.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("publish --team translates Cloud internal visibility wording", async () => {
    const root = await makeTempRoot("workbench-cli-publish-team-wording-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "publish-token",
      username: "alice",
    }));
    let created = false;
    const remotePack = emptyObjectPack("2026-06-11T00:00:00.000Z");
    try {
      expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
      const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        const method = (init?.method ?? "GET").toUpperCase();
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer publish-token");
        if (url.pathname === "/api/workbench/skills" && method === "GET") {
          return jsonResponse({
            skills: created ? [{ id: "skill_team", ownerSlug: "alice", name: "team-wording" }] : [],
          });
        }
        if (url.pathname === "/api/workbench/skills" && method === "POST") {
          created = true;
          return jsonResponse({ skill: { id: "skill_team", ownerSlug: "alice", name: "team-wording" } }, 201);
        }
        if (url.pathname === "/api/workbench/skills/skill_team/objects" && method === "GET") {
          return jsonResponse({ objectPack: remotePack });
        }
        if (url.pathname === "/api/workbench/skills/skill_team/objects" && method === "PUT") {
          const body = JSON.parse(String(init?.body)) as { publishVersionId?: string; visibility?: string };
          if (body.publishVersionId && body.visibility === "internal") {
            return jsonResponse({
              schema: "workbench.cloud.error.v1",
              code: "validation_failed",
              message: "internal source visibility requires an organization-owned skill.",
              retryable: false,
              remediation: "workbench publish --as ORG/SKILL --team",
              subject: {
                owner: "alice",
                ownerKind: "user",
                visibility: "internal",
                requirement: "Publish under an organization-owned skill to use team visibility.",
              },
            }, 400);
          }
          return jsonResponse({ skill: { id: "skill_team", ownerSlug: "alice", name: "team-wording" } });
        }
        return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
      });
      vi.stubGlobal("fetch", fetchMock);

      const publish = await invoke(["publish", "--as", "alice/team-wording", "--team", "--dir", root, "--json"]);

      expect(publish.code, publish.stdout || publish.stderr).toBe(2);
      const body = stdoutJson(publish);
      expect(body).toMatchObject({
        ok: false,
        code: "validation_failed",
        message: "Team source visibility requires an organization-owned skill.",
        remediation: "workbench publish --as ORG/SKILL --team",
        subject: {
          owner: "alice",
          ownerKind: "user",
          visibility: "team",
          requirement: "Publish under an organization-owned skill to use team visibility.",
        },
      });
      expect(publish.stdout).not.toContain("internal source visibility requires");
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("publish --json keeps human progress off stderr", async () => {
    const root = await makeTempRoot("workbench-cli-publish-progress-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "publish-token",
      username: "alice",
    }));
    let created = false;
    let remotePack = emptyObjectPack("2026-06-11T00:00:00.000Z");
    let publishRequests = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer publish-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({
          skills: created ? [{ id: "skill_progress", ownerSlug: "alice", name: "progress-skill" }] : [],
        });
      }
      if (url.pathname === "/api/workbench/skills" && method === "POST") {
        created = true;
        return jsonResponse({ skill: { id: "skill_progress", ownerSlug: "alice", name: "progress-skill" } }, 201);
      }
      if (url.pathname === "/api/workbench/skills/skill_progress/objects" && method === "GET") {
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_progress/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as {
          objectPack?: ReturnType<typeof emptyObjectPack>;
          publishVersionId?: string;
          visibility?: string;
        };
        if (body.publishVersionId) {
          publishRequests += 1;
          remotePack = mergeObjectPacks(remotePack, {
            ...emptyObjectPack("2026-06-11T00:00:00.000Z"),
            refs: {
              "publication/current-version": body.publishVersionId,
              [`publication/versions/${body.publishVersionId}`]: body.publishVersionId,
              "publication/install-handle": "alice/progress-skill",
              "publication/visibility": body.visibility ?? "private",
            },
          });
        } else {
          remotePack = mergeObjectPacks(remotePack, body.objectPack ?? emptyObjectPack("2026-06-11T00:00:00.000Z"));
        }
        return jsonResponse({ skill: { id: "skill_progress", ownerSlug: "alice", name: "progress-skill" } });
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
      const publish = await invoke(["publish", "--as", "alice/progress-skill", "--dir", root, "--json"]);
      expect(publish.code, publish.stdout || publish.stderr).toBe(0);
      expect(publish.stdout).not.toContain("workbench publish:");
      expect(publish.stderr).toBe("");
      expect(stdoutJson(publish)).toMatchObject({
        schema: "workbench.cli.publish.v1",
        ok: true,
        installHandle: "alice/progress-skill",
      });
      expect(publishRequests).toBe(1);
      const publishHuman = await invoke(["publish", "--dir", root]);
      expect(publishHuman.code, publishHuman.stdout || publishHuman.stderr).toBe(0);
      expect(publishHuman.stdout).toContain("Already published ");
      expect(publishHuman.stdout).toContain("next: workbench install alice/progress-skill");
      expect(publishHuman.stdout).not.toContain("Install URL:");
      expect(publishHuman.stdout).not.toContain("Pinned release URL:");
      expect(publishHuman.stdout).not.toContain("https://cloud.test/skills/alice/progress-skill");
      expect(publishRequests).toBe(1);
      const currentVersionId = stdoutJson<{ version: { id: string } }>(publish).version.id;
      const unpublishCurrent = await invoke(["unpublish", currentVersionId, "--dir", root]);
      expect(unpublishCurrent.code, unpublishCurrent.stdout || unpublishCurrent.stderr).toBe(1);
      expect(unpublishCurrent.stderr).toContain(`workbench unpublish: checking exact source availability for ${currentVersionId}.`);
      expect(unpublishCurrent.stderr).toContain("error[published_version_current]");
      expect(unpublishCurrent.stderr).not.toContain("removing exact source availability");
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("installs source snapshots to an explicit Codex global target", async () => {
    const root = await makeTempRoot("workbench-cli-install-canonical-");
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousHome = process.env.HOME;
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.HOME = root;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "install-token",
    }));
    let publishedVersionId = "v007";
    let publishedMarkdown = privateSkillMarkdown;
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      schema: "workbench.source.snapshot.v1",
      owner: "alice",
      name: "private-skill",
      versionId: publishedVersionId,
      files: [
        {
          path: "SKILL.md",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: publishedMarkdown,
        },
        {
          path: "references/guide.md",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "Use this private skill carefully.\n",
        },
        {
          path: "scripts/run.sh",
          kind: "text",
          encoding: "utf8",
          executable: true,
          content: "#!/bin/sh\nprintf 'private skill\\n'\n",
        },
        {
          path: ".workbench/eval.yaml",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "schema: workbench.eval.v1\n",
        },
        {
          path: ".workbench/cases/case-001/case.yaml",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "id: case-001\n",
        },
        {
          path: ".workbench/objects/version/runtime.json",
          kind: "text",
          encoding: "utf8",
          executable: false,
          content: "{}\n",
        },
      ],
    })));
    try {
      const installed = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--target", "codex", "--scope", "global", "--json"]);
      expect(installed.code).toBe(0);
      expect(stdoutJson(installed)).toMatchObject({
        schema: "workbench.cli.install.v3",
        ok: true,
        result: "installed",
        next: "workbench skills",
        filesCopied: 3,
        scope: "global",
        targets: [expect.objectContaining({
          target: "codex",
          root: path.join(root, ".agents", "skills"),
          previous: "none",
          destination: path.join(root, ".agents", "skills", "private-skill"),
          filesCopied: 3,
        })],
      });
      await expect(fs.readFile(path.join(root, ".agents", "skills", "private-skill", "SKILL.md"), "utf8")).resolves.toBe(privateSkillMarkdown);
      await expect(fs.readFile(path.join(root, ".agents", "skills", "private-skill", "references", "guide.md"), "utf8"))
        .resolves.toContain("Use this private skill carefully.");
      await expect(fs.access(path.join(root, ".agents", "skills", "private-skill", "scripts", "run.sh")))
        .resolves.toBeUndefined();
      await expect(fs.access(path.join(root, ".agents", "skills", "private-skill", ".workbench", "eval.yaml")))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.access(path.join(root, ".agents", "skills", "private-skill", ".workbench", "objects", "version", "runtime.json")))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.readFile(path.join(root, ".agents", "skills", ".workbench-installs.json"), "utf8"))
        .resolves.toContain("\"private-skill\"");
      await expectNoInstallFanout(root);
      publishedVersionId = "v008";
      publishedMarkdown = updatedPrivateSkillMarkdown;
      const updated = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--target", "codex", "--scope", "global", "--json"]);
      expect(updated.code, updated.stdout || updated.stderr).toBe(0);
      expect(stdoutJson(updated)).toMatchObject({
        schema: "workbench.cli.install.v3",
        ok: true,
        result: "installed",
        next: "workbench skills",
        filesCopied: 3,
        targets: [expect.objectContaining({ previous: "updated", filesCopied: 3 })],
      });
      await expect(fs.readFile(path.join(root, ".agents", "skills", "private-skill", "SKILL.md"), "utf8")).resolves.toBe(updatedPrivateSkillMarkdown);
      await expect(fs.readFile(path.join(root, ".agents", "skills", ".workbench-installs.json"), "utf8"))
        .resolves.toContain("\"v008\"");
      const repeatedHuman = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--target", "codex", "--scope", "global", "--yes"]);
      expect(repeatedHuman.code, repeatedHuman.stdout || repeatedHuman.stderr).toBe(0);
      expect(repeatedHuman.stdout).toContain("next: workbench skills");
      await expectNoInstallFanout(root);
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }
  });

  test("install names the target directory by the published handle when frontmatter differs", async () => {
    const root = await makeTempRoot("workbench-cli-install-identity-");
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousHome = process.env.HOME;
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.HOME = root;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "install-token",
    }));
    const brandedMarkdown = [
      "---",
      "name: branded-skill",
      "description: Frontmatter identity differs from the handle.",
      "---",
      "# Branded Skill",
      "",
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      schema: "workbench.source.snapshot.v1",
      owner: "alice",
      name: "private-skill",
      versionId: "v008",
      files: [{
        path: "SKILL.md",
        kind: "text",
        encoding: "utf8",
        executable: false,
        content: brandedMarkdown,
      }],
    })));
    try {
      const installed = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--target", "codex", "--scope", "global", "--json"]);
      expect(installed.code).toBe(0);
      expect(stdoutJson(installed)).toMatchObject({
        schema: "workbench.cli.install.v3",
      ok: true,
      result: "installed",
      next: "workbench skills",
      skill: "private-skill",
        targets: [expect.objectContaining({
          target: "codex",
          destination: path.join(root, ".agents", "skills", "private-skill"),
        })],
      });
      await expect(fs.readFile(path.join(root, ".agents", "skills", "private-skill", "SKILL.md"), "utf8")).resolves.toBe(brandedMarkdown);
      const provenance = JSON.parse(await fs.readFile(path.join(root, ".agents", "skills", ".workbench-installs.json"), "utf8")) as {
        skills: Record<string, { handle: string }>;
      };
      expect(provenance.skills["private-skill"]).toMatchObject({ handle: "alice/private-skill" });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }
  });

  test("explicit install commands write Codex and Claude targets separately", async () => {
    const homeRoot = await makeTempRoot("workbench-cli-install-all-home-");
    const claudeRoot = await makeTempRoot("workbench-cli-install-all-claude-");
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    vi.stubEnv("HOME", homeRoot);
    vi.stubEnv("CLAUDE_CONFIG_DIR", claudeRoot);
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    vi.stubEnv("CODEX_HOME", "");
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "install-token",
    }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      schema: "workbench.source.snapshot.v1",
      owner: "alice",
      name: "private-skill",
      versionId: "v009",
      files: [{
        path: "SKILL.md",
        kind: "text",
        encoding: "utf8",
        executable: false,
        content: privateSkillMarkdown,
      }],
    })));

    const codexInstall = await invoke(["install", "alice/private-skill", "--target", "codex", "--scope", "global", "--json"]);
    expect(codexInstall.code, codexInstall.stdout || codexInstall.stderr).toBe(0);
    expect(stdoutJson(codexInstall)).toMatchObject({
      schema: "workbench.cli.install.v3",
      ok: true,
      result: "installed",
      next: "workbench skills",
      target: "codex",
      scope: "global",
      filesCopied: 1,
      targets: [expect.objectContaining({
        target: "codex",
        root: path.join(homeRoot, ".agents", "skills"),
        destination: path.join(homeRoot, ".agents", "skills", "private-skill"),
        filesCopied: 1,
      })],
    });
    expect(stdoutJson(codexInstall)).not.toHaveProperty("for");

    const claudeInstall = await invoke(["install", "alice/private-skill", "--target", "claude", "--scope", "global", "--json"]);
    expect(claudeInstall.code, claudeInstall.stdout || claudeInstall.stderr).toBe(0);
    expect(stdoutJson(claudeInstall)).toMatchObject({
      schema: "workbench.cli.install.v3",
      ok: true,
      result: "installed",
      next: "workbench skills",
      target: "claude",
      scope: "global",
      filesCopied: 1,
      targets: [expect.objectContaining({
        target: "claude",
        root: path.join(claudeRoot, "skills"),
        destination: path.join(claudeRoot, "skills", "private-skill"),
        filesCopied: 1,
      })],
    });
    expect(stdoutJson(claudeInstall)).not.toHaveProperty("for");
    await expect(fs.readFile(path.join(homeRoot, ".agents", "skills", "private-skill", "SKILL.md"), "utf8"))
      .resolves.toBe(privateSkillMarkdown);
    await expect(fs.readFile(path.join(claudeRoot, "skills", "private-skill", "SKILL.md"), "utf8"))
      .resolves.toBe(privateSkillMarkdown);
    await expectNoInstallFanout(homeRoot);

    const inventory = await invoke(["skills", "--scope", "global", "--json"]);
    expect(inventory.code, inventory.stdout || inventory.stderr).toBe(0);
    expect(stdoutJson<{ skills: Array<{ target: string; name: string; status: string }> }>(inventory).skills)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ target: "codex", name: "private-skill", status: "current" }),
        expect.objectContaining({ target: "claude", name: "private-skill", status: "current" }),
      ]));
  });

  test("install without target writes only the detected current folder target", async () => {
    const root = await makeTempRoot("workbench-cli-install-all-mixed-");
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    const previousCwd = process.cwd();
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    vi.stubEnv("WORKBENCH_CURRENT_AGENT", "codex");
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "install-token",
    }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      schema: "workbench.source.snapshot.v1",
      owner: "alice",
      name: "private-skill",
      versionId: "v009",
      files: [{
        path: "SKILL.md",
        kind: "text",
        encoding: "utf8",
        executable: false,
        content: privateSkillMarkdown,
      }],
    })));

    process.chdir(root);
    try {
      const detected = await invoke(["install", "alice/private-skill", "--json"]);
      expect(detected.code, detected.stdout || detected.stderr).toBe(0);
      expect(stdoutJson(detected)).toMatchObject({
        schema: "workbench.cli.install.v3",
        result: "installed",
        target: "codex",
        scope: "folder",
        currentAgent: "codex",
        targets: [expect.objectContaining({ target: "codex", result: "installed", filesCopied: 1 })],
      });
      await expect(fs.readFile(path.join(root, ".agents", "skills", "private-skill", "SKILL.md"), "utf8"))
        .resolves.toBe(privateSkillMarkdown);
      await expect(fs.access(path.join(root, ".claude", "skills", "private-skill", "SKILL.md")))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("login no-open and wait emit one structured document per command", async () => {
    const root = await makeTempRoot("workbench-cli-login-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousDevice = process.env.WORKBENCH_DEVICE_AUTH;
    const previousAdapterAuth = process.env.WORKBENCH_ADAPTER_AUTH_STORE;
    process.env.WORKBENCH_CONFIG = path.join(root, "config.json");
    process.env.WORKBENCH_DEVICE_AUTH = path.join(root, "device-auth.json");
    process.env.WORKBENCH_ADAPTER_AUTH_STORE = path.join(root, "auth-store");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/api/oauth/device/code") {
        return jsonResponse({
          device_code: "device-1",
          user_code: "ABCD-EFGH",
          verification_uri: "https://cloud.test/device",
          verification_uri_complete: "https://cloud.test/device?user_code=ABCD-EFGH",
          expires_in: 120,
          interval: 1,
        });
      }
      if (url.pathname === "/api/oauth/token") {
        return jsonResponse({ access_token: "token-1", expires_in: 3600 });
      }
      if (url.pathname === "/api/workbench/profile") {
        return jsonResponse({ profile: { username: "alice" } });
      }
      return jsonResponse({ message: `Unexpected path ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const start = await invoke(["login", "--base-url", "https://cloud.test", "--no-open", "--json"]);
      expect(start.code).toBe(0);
      expect(stdoutJson(start)).toMatchObject({
        schema: "workbench.cli.login.v1",
        ok: true,
        status: "authorization_pending",
        userCode: "ABCD-EFGH",
        resume: "workbench login --wait --timeout 120 --json",
      });
      expect(start.stdout.trim().split("\n")[0]).toBe("{");

      const wait = await invoke(["login", "--wait", "--timeout", "120", "--json"]);
      expect(wait.code).toBe(0);
      expect(stdoutJson(wait)).toMatchObject({
        schema: "workbench.cli.login.v1",
        ok: true,
        status: "authenticated",
        baseUrl: "https://cloud.test",
        username: "alice",
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousDevice === undefined) {
        delete process.env.WORKBENCH_DEVICE_AUTH;
      } else {
        process.env.WORKBENCH_DEVICE_AUTH = previousDevice;
      }
      if (previousAdapterAuth === undefined) {
        delete process.env.WORKBENCH_ADAPTER_AUTH_STORE;
      } else {
        process.env.WORKBENCH_ADAPTER_AUTH_STORE = previousAdapterAuth;
      }
    }
  });

  test("cloud login uploads already connected local provider auth", async () => {
    const root = await makeTempRoot("workbench-cli-login-provider-sync-");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "config.json"));
    vi.stubEnv("WORKBENCH_DEVICE_AUTH", path.join(root, "device-auth.json"));
    vi.stubEnv("WORKBENCH_ADAPTER_AUTH_STORE", path.join(root, "auth-store"));
    vi.stubEnv("WORKBENCH_API_TOKEN", undefined);
    vi.stubEnv("WORKBENCH_SMOKE_BEARER_TOKEN", undefined);
    vi.stubEnv("WORKBENCH_API_URL", undefined);
    vi.stubEnv("OPENAI_API_KEY", "sk-test-before-cloud");

    const provider = await invoke(["login", "codex", "--method", "api-key", "--json"]);
    expect(provider.code, provider.stdout || provider.stderr).toBe(0);
    expect(stdoutJson(provider)).toMatchObject({
      remoteAdapterAuth: {
        sync: "skipped",
        reason: "not_authenticated",
      },
    });

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/api/oauth/device/code") {
        return jsonResponse({
          device_code: "device-1",
          user_code: "SYNC-0001",
          verification_uri: "https://cloud.test/device",
          verification_uri_complete: "https://cloud.test/device?user_code=SYNC-0001",
          expires_in: 120,
          interval: 1,
        });
      }
      if (url.pathname === "/api/oauth/token") {
        return jsonResponse({ access_token: "cloud-token", expires_in: 3600 });
      }
      if (url.pathname === "/api/workbench/profile") {
        return jsonResponse({ profile: { username: "alice" } });
      }
      if (url.pathname === "/api/workbench/auth/adapters/codex") {
        expect(url.searchParams.get("profile")).toBe("default");
        expect(init?.method).toBe("PUT");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
        const body = JSON.parse(String(init?.body)) as { bundle?: { adapterId?: string; method?: string } };
        expect(body.bundle).toMatchObject({ adapterId: "codex", method: "api-key" });
        return jsonResponse({ ok: true, status: "uploaded" });
      }
      return jsonResponse({ message: `Unexpected path ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const login = await invoke(["login", "--base-url", "https://cloud.test", "--wait", "--timeout", "120", "--json"]);
    expect(login.code, login.stdout || login.stderr).toBe(0);
    expect(stdoutJson(login)).toMatchObject({
      schema: "workbench.cli.login.v1",
      ok: true,
      status: "authenticated",
      adapterAuth: {
        uploaded: [expect.objectContaining({ adapter: "codex", profile: "default" })],
        skipped: [],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("requires singular improve selectors when manifest defaults expand to sets", async () => {
    const root = await makeTempRoot("workbench-cli-improve-default-all-");
    await invoke(["new", root, "--agent", "local"]);
    await fs.mkdir(path.join(root, "skills", "variant"), { recursive: true });
    await fs.writeFile(path.join(root, "skills", "variant", "SKILL.md"), "# Variant\n");
    await fs.writeFile(path.join(root, ".workbench", "versions.yaml"), [
      "default: all",
      "versions:",
      "  current:",
      "    source: local:.",
      "  variant:",
      "    source: local:skills/variant",
      "",
    ].join("\n"));
    await fs.writeFile(path.join(root, ".workbench", "agents.yaml"), [
      "default: all",
      "agents:",
      "  default:",
      "    adapter: local",
      "    model: docker",
      "    with: {}",
      "  strict:",
      "    adapter: command",
      "    with:",
      "      improveCommand: 'true'",
      "",
    ].join("\n"));

    const result = await invoke(["improve", "--dir", root, "--json"]);
    expect(result.code).toBe(2);
    const error = stdoutJson<{ message: string; remediation?: string; subject?: { configuredVersions?: string[]; configuredAgents?: string[]; improvementCapableAgents?: string[] } }>(result);
    expect(error).toMatchObject({
      ok: false,
      code: "usage",
      message: expect.stringContaining("requires exactly one version and one eval agent"),
      subject: {
        configuredVersions: expect.arrayContaining(["current", "variant"]),
        configuredAgents: expect.arrayContaining(["default", "strict"]),
        improvementCapableAgents: ["strict"],
      },
    });
    expect(error.message).toContain("Configured versions: current, variant.");
    expect(error.message).toContain("Configured agents: default, strict.");
    expect(error.message).toContain("Improvement-capable agents: strict.");
    expect(error.remediation).toBe("workbench improve --versions current --agents strict");
    expect(error.message).not.toContain("AGENT");
    expect(error.remediation).not.toContain("AGENT");
  });

  test("eval selector errors include remediation and configured agents", async () => {
    const root = await makeTempRoot("workbench-cli-eval-selector-");
    await invoke(["new", root, "--agent", "local"]);

    const result = await invoke(["eval", "--dir", root, "--agents", "missing", "--json"]);

    expect(result.code).toBe(2);
    expect(stdoutJson(result)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Agent not found: missing. Configured agents: default.",
      remediation: "workbench eval --agents default",
      subject: { configuredAgents: ["default"] },
    });
  });

  test("results selector errors include command-shaped remediation", async () => {
    const root = await makeTempRoot("workbench-cli-results-selector-");
    await invoke(["new", root, "--agent", "local"]);

    const result = await invoke(["results", "--dir", root, "--agents", "missing", "--json"]);

    expect(result.code).toBe(2);
    expect(stdoutJson(result)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Agent not found: missing. Configured agents: default.",
      remediation: "workbench results --agents default",
      subject: { configuredAgents: ["default"] },
    });
  });

  test("improve selector errors include command-shaped remediation", async () => {
    const root = await makeTempRoot("workbench-cli-improve-selector-");
    await invoke(["new", root, "--agent", "local"]);
    expect((await invoke([
      "agent",
      "add",
      "patcher",
      "--dir",
      root,
      "--adapter",
      "command",
      "--with",
      "improveCommand=printf improved >> \"$SKILL_DIR/SKILL.md\"",
    ])).code).toBe(0);

    const result = await invoke(["improve", "--dir", root, "--agents", "missing", "--json"]);

    expect(result.code).toBe(2);
    expect(stdoutJson(result)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Agent not found: missing. Configured agents: default, patcher.",
      remediation: "workbench improve --agents patcher",
      subject: { configuredAgents: ["default", "patcher"] },
    });
  });

  test("lists the built-in no-skill baseline without an undefined location", async () => {
    const root = await makeTempRoot("workbench-cli-skills-none-");
    await invoke(["new", root, "--agent", "local"]);
    await fs.writeFile(path.join(root, ".workbench", "versions.yaml"), [
      "default: all",
      "versions:",
      "  current:",
      "    source: local:.",
      "  no-skill:",
      "    source: none",
      "",
    ].join("\n"));

    const result = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });

    expect(result.skillSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "no-skill", kind: "none" }),
    ]));
    expect(JSON.stringify(result)).not.toContain("undefined");
  });

  test("rejects the deleted open json shortcut", async () => {
    const root = await makeTempRoot("workbench-cli-open-json-");
    await invoke(["new", root, "--agent", "local"]);

    const result = await invoke(["open", "--json", "--dir", root]);

    expect(result.code).toBe(2);
    expect(stdoutJson(result)).toMatchObject({
      ok: false,
      message: "Unsupported flag --json for workbench open.",
    });
  });

  test("open stops cleanly on Ctrl-C", async () => {
    const root = await makeTempRoot("workbench-cli-open-stop-");
    await invoke(["new", root, "--agent", "local"]);

    let stdout = "";
    let signaled = false;
    const stdoutStream = new Writable({
      write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        stdout += String(chunk);
        if (!signaled && stdout.includes("Press Ctrl-C to stop")) {
          signaled = true;
          setImmediate(() => process.emit("SIGINT", "SIGINT"));
        }
        callback();
      },
    });
    const stderr = new MemoryWritable();
    const code = await runCli(["open", "--no-open", "--port", "0", "--dir", root], {
      stdout: stdoutStream,
      stderr,
    });

    expect(code).toBe(0);
    expect(stdout).toContain("Press Ctrl-C to stop");
    expect(stderr.value).toBe("");
  });

  test("open child process exits 0 on one Ctrl-C with an active state stream", async () => {
    const root = await makeTempRoot("workbench-cli-open-child-stop-");
    await invoke(["new", root, "--agent", "local"]);

    const child = spawn(path.join(import.meta.dirname, "../node_modules/.bin/tsx"), [
      path.join(import.meta.dirname, "../src/workbench.ts"),
      "open",
      "--no-open",
      "--port",
      "0",
      "--dir",
      root,
    ], {
      cwd: path.join(import.meta.dirname, ".."),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let streamRequest: ReturnType<typeof get> | undefined;
    let signaled = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      const output = Buffer.concat(stdout).toString("utf8");
      const url = /^Workbench: (http:\/\/[^\s]+)/mu.exec(output)?.[1];
      if (!url || signaled) {
        return;
      }
      signaled = true;
      streamRequest = get(new URL("/api/state/stream", url));
      streamRequest.on("error", () => undefined);
      setTimeout(() => child.kill("SIGINT"), 50);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const code = await Promise.race([
      new Promise<number>((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (exitCode) => resolve(exitCode ?? 1));
      }),
      new Promise<number>((resolve) => {
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve(-1);
        }, 5_000);
      }),
    ]);
    streamRequest?.destroy();

    expect(Buffer.concat(stdout).toString("utf8")).toContain("Press Ctrl-C to stop");
    expect(Buffer.concat(stderr).toString("utf8")).toBe("");
    expect(code).toBe(0);
  });

  test("open server close terminates active browser state streams", async () => {
    const root = await makeTempRoot("workbench-cli-open-stream-close-");
    await invoke(["new", root, "--agent", "local"]);
    const server = await startWorkbenchOpenServer({ dir: root, port: 0 });
    const request = get(new URL("/api/state/stream", server.url));
    request.on("error", () => undefined);
    try {
      await new Promise<void>((resolve, reject) => {
        request.once("response", () => resolve());
        request.once("error", reject);
      });
      const result = await Promise.race([
        server.close().then(() => "closed" as const),
        delay(1_000).then(() => "timeout" as const),
      ]);
      expect(result).toBe("closed");
    } finally {
      request.destroy();
    }
  });

  dockerTest("reports compact sample coverage and routes publish-ready status through login", async () => {
    const root = await makeTempRoot("workbench-cli-coverage-status-");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "missing-config.json"));
    vi.stubEnv("WORKBENCH_API_TOKEN", "");
    expect((await invoke(["new", root, "--agent", "local"])).code).toBe(0);
    await writePassingCaseTest(root);

    const evalResult = await invoke(["eval", "-n", "5", "--dir", root]);

    expect(evalResult.code, evalResult.stdout || evalResult.stderr).toBe(0);
    expect(evalResult.stdout).toContain("coverage cases=1 samples=5 jobs=5");
    expect(evalResult.stdout).toContain("next: workbench login");

    const status = await invoke(["status", "--dir", root, "--json"]);

    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(stdoutJson<{ next: string | null }>(status).next).toBe("workbench login");
  }, 60_000);

  dockerTest("local eval detaches on SIGINT and resumes through run watch", async () => {
    const root = await makeTempRoot("workbench-cli-local-detach-");
    expect((await invoke(["new", root, "--agent", "local"])).code).toBe(0);
    await writeSleepingPassingCaseTest(root, 3);

    const signal = setTimeout(() => process.emit("SIGINT"), 750);
    const detached = await invoke(["eval", "--dir", root, "--json"]);
    clearTimeout(signal);

    expect(detached.code, detached.stdout || detached.stderr).toBe(130);
    expect(detached.stderr).toContain("detaching from local run");
    const detachedJson = stdoutJson<{ code: string; detached: boolean; run: { id: string; status: string }; next: string }>(detached);
    expect(detachedJson).toMatchObject({
      ok: false,
      code: "local_detached",
      detached: true,
      next: `workbench run watch ${detachedJson.run.id}`,
    });

    const watched = await invoke(["run", "watch", detachedJson.run.id, "--dir", root, "--json"]);
    expect(watched.code, watched.stdout || watched.stderr).toBe(0);
    expect(stdoutJson<{ run: { id: string; status: string } }>(watched)).toMatchObject({
      run: { id: detachedJson.run.id, status: "succeeded" },
    });
  }, 60_000);

  dockerTest("run cancel interrupts active local sandbox work", async () => {
    const root = await makeTempRoot("workbench-cli-local-cancel-live-");
    expect((await invoke(["new", root, "--agent", "local"])).code).toBe(0);
    await writeSleepingPassingCaseTest(root, 30);

    const runningEval = invokeChild(["eval", "--dir", root, "--json"]);
    let runId: string | undefined;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root }).catch(() => null);
      const activeRun = snapshot?.runs.find((run) =>
        run.status === "queued" || run.status === "running" || run.status === "canceling"
      );
      if (activeRun) {
        runId = activeRun.id;
        break;
      }
      await delay(100);
    }
    expect(runId).toBeTruthy();

    const cancelStartedAt = Date.now();
    const cancel = await invoke(["run", "cancel", runId!, "--dir", root, "--json"]);
    expect(cancel.code, cancel.stdout || cancel.stderr).toBe(0);
    expect(Date.now() - cancelStartedAt).toBeLessThan(2_000);
    expect(stdoutJson<{ run: { status: string } }>(cancel).run.status).toBe("canceling");

    const watchStartedAt = Date.now();
    const watched = await invoke(["run", "watch", runId!, "--dir", root, "--json"]);
    expect(watched.code, watched.stdout || watched.stderr).toBe(0);
    expect(Date.now() - watchStartedAt).toBeLessThan(12_000);
    expect(stdoutJson<{ run: { id: string; status: string }; ok: boolean }>(watched)).toMatchObject({
      ok: true,
      run: { id: runId, status: "canceled" },
    });

    const shown = await invoke(["show", runId!, "--dir", root]);
    expect(shown.code, shown.stdout || shown.stderr).toBe(0);
    expect(shown.stdout).toContain("Canceled:");
    expect(shown.stdout).not.toContain("Failures:\n  1 canceled:");
    const shownJson = await invoke(["show", runId!, "--dir", root, "--json"]);
    expect(shownJson.code, shownJson.stdout || shownJson.stderr).toBe(0);
    expect(stdoutJson<{
      result: {
        failures: unknown[];
        cancellations: Array<{ status: string; count: number }>;
      };
    }>(shownJson)).toMatchObject({
      result: {
        failures: [],
        cancellations: [expect.objectContaining({ status: "canceled", count: 1 })],
      },
    });

    const evalResult = await runningEval;
    expect(evalResult.code, evalResult.stdout || evalResult.stderr).toBe(1);
    const evalJson = stdoutJson<{
      code: string;
      message: string;
      failedMeasurements?: unknown[];
      canceledMeasurements?: Array<{ status: string }>;
      coverage: Array<{ failed: number; canceled: number }>;
      run: { status: string };
    }>(evalResult);
    expect(evalJson).toMatchObject({
      code: "eval_canceled",
      message: "Eval canceled; evidence was saved.",
      run: { status: "canceled" },
      canceledMeasurements: [expect.objectContaining({ status: "canceled" })],
      coverage: [expect.objectContaining({ failed: 0, canceled: 1 })],
    });
    expect(evalJson.failedMeasurements).toBeUndefined();

    const humanRoot = await makeTempRoot("workbench-cli-local-cancel-human-");
    expect((await invoke(["new", humanRoot, "--agent", "local"])).code).toBe(0);
    await writeSleepingPassingCaseTest(humanRoot, 30);
    const runningHumanEval = invokeChild(["eval", "--dir", humanRoot]);
    let humanRunId: string | undefined;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: humanRoot }).catch(() => null);
      const activeRun = snapshot?.runs.find((run) =>
        run.status === "queued" || run.status === "running" || run.status === "canceling"
      );
      if (activeRun) {
        humanRunId = activeRun.id;
        break;
      }
      await delay(100);
    }
    expect(humanRunId).toBeTruthy();
    expect((await invoke(["run", "cancel", humanRunId!, "--dir", humanRoot, "--json"])).code).toBe(0);
    expect((await invoke(["run", "watch", humanRunId!, "--dir", humanRoot, "--json"])).code).toBe(0);
    const humanEvalResult = await runningHumanEval;
    expect(humanEvalResult.code, humanEvalResult.stdout || humanEvalResult.stderr).toBe(1);
    expect(humanEvalResult.stdout).toContain("Eval canceled; evidence was saved.");
    expect(humanEvalResult.stdout).toContain("coverage cases=1 samples=1 jobs=1 canceled=1");
    expect(humanEvalResult.stdout).not.toContain("coverage cases=1 samples=1 jobs=1 failed=1");
  }, 90_000);

  dockerTest("failed multi-agent eval reports labeled coverage for every measurement", async () => {
    const root = await makeTempRoot("workbench-cli-failed-multi-coverage-");
    expect((await invoke(["new", root, "--agent", "local"])).code).toBe(0);
    await writePassingCaseTest(root);
    await fs.writeFile(path.join(root, ".workbench", "agents.yaml"), [
      "default: all",
      "agents:",
      "  failer:",
      "    adapter: command",
      "    with:",
      `      command: ${JSON.stringify(evalResultCommand({ ok: false, score: 0, message: "agent failed", exitCode: 1 }))}`,
      "  passer:",
      "    adapter: command",
      "    with:",
      `      command: ${JSON.stringify(evalResultCommand({ ok: true, score: 1, message: "agent passed", exitCode: 0 }))}`,
      "",
    ].join("\n"));

    const result = await invoke(["eval", "--dir", root, "--agents", "all", "-n", "5"]);

    expect(result.code, result.stdout || result.stderr).toBe(1);
    expect(result.stdout).toContain("Eval failed; evidence was saved.");
    expect(result.stdout).toContain("agent=failer");
    expect(result.stdout).toContain("agent=passer");
    expect(result.stdout).toContain("coverage cases=1 samples=5 jobs=5 failed=5");
    expect(result.stdout).toContain("coverage cases=1 samples=5 jobs=5 run=");
    expect(result.stdout).toContain("measurement\trun=");
    expect(result.stdout).toContain("skill=current\tagent=failer\tfailed");
    expect(result.stdout).toContain("skill=current\tagent=passer\tsucceeded");

    const json = await invoke(["eval", "--dir", root, "--agents", "all", "-n", "5", "--rerun", "--json"]);
    const parsed = stdoutJson<{
      coverage: Array<{ agentName: string; samples: number; jobs: number; failed: number }>;
      failedMeasurements: Array<{ agent: string; error?: string }>;
    }>(json);
    expect(json.code, json.stdout || json.stderr).toBe(1);
    expect(parsed.coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentName: "failer", samples: 5, jobs: 5, failed: 5 }),
      expect.objectContaining({ agentName: "passer", samples: 5, jobs: 5, failed: 0 }),
    ]));
    expect(parsed.failedMeasurements).toEqual(expect.arrayContaining([
      expect.objectContaining({ agent: "failer", error: "agent failed (5 jobs)" }),
    ]));
  }, 60_000);

  test("uploads adapter auth to Workbench Cloud when logged in", async () => {
    const root = await makeTempRoot("workbench-cli-remote-auth-");
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    const authRoot = path.join(root, "auth-store");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousAuthStore = process.env.WORKBENCH_ADAPTER_AUTH_STORE;
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_ADAPTER_AUTH_STORE = authRoot;
    process.env.OPENAI_API_KEY = "test-openai-key";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "test-token",
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe("https://cloud.test/api/workbench/auth/adapters/codex?profile=default");
      expect(init?.method).toBe("PUT");
      expect((init?.headers as Record<string, string> | undefined)?.authorization).toBe("Bearer test-token");
      return jsonResponse({ ok: true, status: "connected" });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const connect = await invoke(["login", "codex", "--method", "api-key", "--json"]);
      expect(connect.code).toBe(0);
      expect(stdoutJson(connect)).toMatchObject({
        schema: "workbench.cli.login.v1",
        ok: true,
        provider: "codex",
        localAdapter: {
          adapter: "codex",
          method: "api-key",
          status: "connected",
        },
        remoteAdapterAuth: { status: "authenticated", sync: "uploaded" },
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousAuthStore === undefined) {
        delete process.env.WORKBENCH_ADAPTER_AUTH_STORE;
      } else {
        process.env.WORKBENCH_ADAPTER_AUTH_STORE = previousAuthStore;
      }
      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey;
      }
    }
  });

  test("adds provider-backed agents through the remaining agent surface", async () => {
    const root = await makeTempRoot("workbench-cli-provider-check-");

    expect((await invoke(["new", root, "--agent", "local"])).code).toBe(0);
    expect((await invoke(["agent", "add", "codex", "--dir", root, "--adapter", "codex", "--model", "gpt-test"])).code).toBe(0);

    const agents = await invoke(["agent", "list", "--dir", root]);
    expect(agents.code).toBe(0);
    expect(agents.stdout).toMatch(/^name\s+adapter\s+model/mu);
    expect(agents.stdout).toMatch(/\bcodex\s+codex\s+gpt-test\b/u);
  });

  test("agent command config rejects likely shell-expanded runtime paths", async () => {
    const root = await makeTempRoot("workbench-cli-agent-expanded-env-");
    expect((await invoke(["new", root, "--agent", "local"])).code).toBe(0);

    const result = await invoke([
      "agent",
      "add",
      "patcher",
      "--dir",
      root,
      "--adapter",
      "command",
      "--with",
      "improveCommand=printf '\\nPatch.\\n' >> \"/SKILL.md\"",
      "--json",
    ]);

    expect(result.code, result.stdout || result.stderr).toBe(2);
    expect(stdoutJson(result)).toMatchObject({
      ok: false,
      code: "usage",
      message: expect.stringContaining("--with improveCommand=... contains /SKILL.md"),
      remediation: expect.stringContaining("--with 'improveCommand=... >> \"$SKILL_DIR/SKILL.md\"'"),
    });
  });

  test("read commands return committed state without reconciling source edits", async () => {
    const root = await makeTempRoot("workbench-cli-lock-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const initialStatus = await invoke(["status", "--dir", root, "--json"]);
    const initialVersionId = stdoutJson<{ project: { currentVersionId: string } }>(initialStatus).project.currentVersionId;
    await fs.appendFile(path.join(root, "SKILL.md"), "\nManual CLI concurrent edit.\n");

    const [status, versions, runs, shown] = await Promise.all([
      invoke(["status", "--dir", root, "--json"]),
      invoke(["log", "--versions", "--dir", root, "--json"]),
      invoke(["log", "--runs", "--dir", root, "--json"]),
      invoke(["show", "current:SKILL.md", "--dir", root, "--json"]),
    ]);

    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(versions.code, versions.stdout || versions.stderr).toBe(0);
    expect(runs.code, runs.stdout || runs.stderr).toBe(0);
    expect(shown.code, shown.stdout || shown.stderr).toBe(0);
    const statusJson = stdoutJson<{ project: { currentVersionId: string }; worktree: { latestVersionId: string } }>(status);
    expect(statusJson.project.currentVersionId).toMatch(/^v_[a-f0-9]{64}$/u);
    expect(statusJson.project.currentVersionId).toBe(initialVersionId);
    expect(statusJson.worktree.latestVersionId).toBe(statusJson.project.currentVersionId);
    expect(stdoutJson<{ entries: Array<{ id: string }> }>(versions).entries.length).toBeGreaterThan(0);
    expect(stdoutJson<{ entries: unknown[] }>(runs).entries).toHaveLength(0);
    expect(stdoutJson(shown)).toMatchObject({
      result: {
      path: "SKILL.md",
      content: expect.not.stringContaining("Manual CLI concurrent edit."),
      },
    });
    await expect(fs.stat(path.join(root, ".workbench", "locks", "project.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("keeps read commands available while a project command holds the local lock", async () => {
    const root = await makeTempRoot("workbench-cli-read-lock-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);

    let releaseLock!: () => void;
    let holdingLock!: Promise<void>;
    const lockReady = new Promise<void>((resolve, reject) => {
      holdingLock = withWorkbenchProjectLock(root, async () => {
        resolve();
        await new Promise<void>((release) => {
          releaseLock = release;
        });
      });
      holdingLock.catch(reject);
    });
    await lockReady;

    const readInvocation = Promise.all([
      invoke(["log", "--runs", "--dir", root, "--json"]),
      invoke(["status", "--dir", root, "--json"]),
      invoke(["show", "current:SKILL.md", "--dir", root, "--json"]),
    ]);
    let readResult: Awaited<typeof readInvocation> | "timed-out" = "timed-out";
    try {
      readResult = await Promise.race([
        readInvocation,
        new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 1_000)),
      ]);
    } finally {
      releaseLock();
      await holdingLock;
      await readInvocation.catch(() => undefined);
    }

    expect(readResult).not.toBe("timed-out");
    if (readResult !== "timed-out") {
      const [logResult, statusResult, showResult] = readResult;
      expect(logResult.code, logResult.stdout || logResult.stderr).toBe(0);
      expect(statusResult.code, statusResult.stdout || statusResult.stderr).toBe(0);
      expect(showResult.code, showResult.stdout || showResult.stderr).toBe(0);
      expect(stdoutJson<{ entries: unknown[] }>(logResult).entries).toHaveLength(0);
      expect(stdoutJson<{ project: { initialized: boolean } }>(statusResult).project.initialized).toBe(true);
      expect(stdoutJson(showResult)).toMatchObject({
        result: {
          path: "SKILL.md",
          content: expect.stringContaining("# "),
        },
      });
    }
  });

  test("serves the inspection shell for local deep links", async () => {
    const root = await makeTempRoot("workbench-cli-open-");
    await invoke(["new", root, "--agent", "local"]);
    const versions = await invoke(["log", "--versions", "--dir", root, "--json"]);
    const versionId = stdoutJson<{ entries: Array<{ id: string }> }>(versions).entries[0]!.id;
    const evidenceCreatedAt = "2026-06-10T19:00:00.000Z";
    const caseFile = {
      path: "cases/case-001/case.yaml",
      kind: "text",
      encoding: "utf8",
      content: "version: 1\nid: case-001\ncommand: ./tests/test.sh\n",
    };
    const evidenceTrace = {
      trace_id: "fixture-trace",
      spans: [{
        id: "stage",
        parent_id: null,
        attempt_number: 1,
        stage_id: "eval",
        stage_run_index: null,
        kind: "stage",
        title: "Eval",
        status: "failed",
        started_at: evidenceCreatedAt,
        ended_at: "2026-06-10T19:00:01.000Z",
        attributes: {},
      }],
      events: [{
        id: "event",
        span_id: "stage",
        attempt_number: 1,
        stage_id: "eval",
        stage_run_index: null,
        kind: "error",
        at: "2026-06-10T19:00:01.000Z",
        message: "fixture failure",
        attributes: {},
      }],
      summaries: [{
        attempt_number: 1,
        stage_id: "eval",
        stage_run_index: null,
        status: "failed",
        started_at: evidenceCreatedAt,
        ended_at: "2026-06-10T19:00:01.000Z",
        duration_ms: 1000,
        tool_call_count: 0,
        input_tokens: null,
        output_tokens: null,
        usage: null,
        final_output_present: false,
        error_message: "fixture failure",
      }],
    };
    await fs.mkdir(path.join(root, ".workbench", "objects", "eval"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "run"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "job"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "trace"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "objects", "eval", "eval_hash.json"), JSON.stringify({
      hash: "eval_hash",
      files: [caseFile],
      cases: [{
        id: "case-001",
        path: "cases/case-001/case.yaml",
        command: "./tests/test.sh",
        files: [caseFile],
      }],
      caseCount: 1,
      createdAt: evidenceCreatedAt,
      updatedAt: evidenceCreatedAt,
      scoreAdapter: "tests",
    }));
    await fs.writeFile(path.join(root, ".workbench", "objects", "run", "run_evidence.json"), JSON.stringify({
      id: "run_evidence",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "skill_bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      status: "failed",
      score: 0,
      latencyMs: 1000,
      jobIds: ["job_evidence"],
      traceIds: ["trace_evidence"],
      createdAt: evidenceCreatedAt,
      finishedAt: "2026-06-10T19:00:01.000Z",
      error: "fixture failure",
    }));
    await fs.writeFile(path.join(root, ".workbench", "objects", "job", "job_evidence.json"), JSON.stringify({
      id: "job_evidence",
      runId: "run_evidence",
      kind: "eval",
      versionId,
      skillName: "current",
      skillBundleHash: "skill_bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      caseId: "case-001",
      sample: 0,
      status: "failed",
      score: 0,
      artifactIds: [],
      traceIds: ["trace_evidence"],
      createdAt: evidenceCreatedAt,
      startedAt: evidenceCreatedAt,
      finishedAt: "2026-06-10T19:00:01.000Z",
      durationMs: 1000,
      error: "fixture failure",
    }));
    await fs.writeFile(path.join(root, ".workbench", "objects", "trace", "trace_evidence.json"), JSON.stringify({
      id: "trace_evidence",
      runId: "run_evidence",
      jobId: "job_evidence",
      versionId,
      skillName: "current",
      skillBundleHash: "skill_bundle_hash",
      evalHash: "eval_hash",
      agentName: "default",
      agentHash: "agent_hash",
      createdAt: evidenceCreatedAt,
      request: { fixture: true },
      result: { ok: false },
      files: [{
        path: ".workbench/traces/job_evidence/engine/trace.json",
        kind: "text",
        encoding: "utf8",
        content: JSON.stringify(evidenceTrace),
      }],
    }));
    const server = await startWorkbenchOpenServer({ dir: root, host: "0.0.0.0" });
    try {
      expect(server.url.startsWith("http://127.0.0.1:")).toBe(true);
      expect(server.url.endsWith("/")).toBe(true);
      const response = await fetch(new URL("/evaluation/runs/run_example", server.url));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      await expect(response.text()).resolves.toContain("<div id=\"root\"></div>");
      const clientResponse = await fetch(new URL("/client.js", server.url));
      expect(clientResponse.status).toBe(200);
      const client = await clientResponse.text();
      expect(client).not.toContain("Billing");
      expect(client).not.toContain("Sign out");
      expect(client).not.toContain("Workbench account navigation");
      expect(client).not.toContain("Workbench Skills");
      const snapshotResponse = await fetch(new URL("/api/snapshot", server.url));
      expect(snapshotResponse.status).toBe(200);
      const envelope = await snapshotResponse.json() as {
        schema: string;
        cursor: string;
        snapshot: {
          versions: Array<{ files: Array<{ path: string; content: string }> }>;
          evals: Array<{ hash: string; cases: Array<{ id: string; path: string; files: Array<{ path: string; content: string }> }> }>;
        };
      };
      expect(envelope.schema).toBe("workbench.inspection.snapshot-envelope.v1");
      expect(envelope.cursor).toMatch(/^local:/u);
      const snapshot = envelope.snapshot;
      expect(snapshot.versions[0]?.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "SKILL.md", content: "" }),
        expect.objectContaining({ path: ".workbench/eval.yaml", content: "" }),
      ]));
      const evalSnapshot = snapshot.evals.find((entry) => entry.cases.some((evalCase) => evalCase.id === "case-001"));
      const evalCase = evalSnapshot?.cases.find((entry) => entry.id === "case-001");
      expect(evalCase?.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "cases/case-001/case.yaml", content: "" }),
      ]));
      const waitResponse = await fetch(new URL(`/api/state/wait?cursor=${encodeURIComponent(envelope.cursor)}&timeoutMs=1000`, server.url));
      expect(waitResponse.status).toBe(200);
      await expect(waitResponse.json()).resolves.toMatchObject({
        schema: "workbench.state.notice.v1",
        type: "heartbeat",
        cursor: envelope.cursor,
      });
      const fileResponse = await fetch(new URL(`/api/versions/${versionId}/files/SKILL.md`, server.url));
      expect(fileResponse.status).toBe(200);
      const fileContent = await fileResponse.json() as { path: string; content: string };
      expect(fileContent.path).toBe("SKILL.md");
      expect(fileContent.content.length).toBeGreaterThan(0);
      const evalHash = evalSnapshot?.hash;
      if (!evalHash) {
        throw new Error("Expected an evaluation hash in the inspection snapshot.");
      }
      const caseOwnerId = encodeURIComponent(workbenchCaseFileOwnerId(evalHash, "case-001"));
      const caseFilePath = "cases/case-001/case.yaml".split("/").map(encodeURIComponent).join("/");
      const caseFileResponse = await fetch(new URL(`/api/cases/${caseOwnerId}/files/${caseFilePath}`, server.url));
      expect(caseFileResponse.status).toBe(200);
      const caseFileContent = await caseFileResponse.json() as { path: string; content: string };
      expect(caseFileContent.path).toBe("cases/case-001/case.yaml");
      expect(caseFileContent.content).toContain("id: case-001");
      const evidenceResponse = await fetch(new URL("/api/jobs/job_evidence/evidence?run=run_evidence", server.url));
      expect(evidenceResponse.status).toBe(200);
      const evidence = await evidenceResponse.json() as {
        runId: string;
        executions: Array<{
          jobIds: string[];
          sessions: Array<{ label: string }>;
          trace: { events: Array<{ message: string }> };
        }>;
      };
      expect(evidence.runId).toBe("run_evidence");
      expect(evidence.executions[0]?.jobIds).toEqual(["job_evidence"]);
      expect(evidence.executions[0]?.sessions[0]?.label).toBe("Engine");
      expect(evidence.executions[0]?.trace.events[0]?.message).toBe("fixture failure");
      const missingEvidence = await fetch(new URL("/api/jobs/job_missing/evidence?run=run_evidence", server.url));
      expect(missingEvidence.status).toBe(404);
      const missingApi = await fetch(new URL("/api/missing", server.url));
      expect(missingApi.status).toBe(404);
      expect(missingApi.headers.get("content-type")).toContain("application/json");
      await expect(missingApi.json()).resolves.toMatchObject({ message: "Not found" });
    } finally {
      await server.close();
    }
  });

  dockerTest("open operation starts a worker-backed local run before completion", async () => {
    const root = await makeTempRoot("workbench-cli-open-operation-");
    expect((await invoke(["new", root, "--agent", "local"])).code).toBe(0);
    await writeSleepingPassingCaseTest(root, 2);
    const server = await startWorkbenchOpenServer({ dir: root });
    try {
      const startedAt = Date.now();
      const response = await fetch(new URL("/api/operations", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "eval" }),
      });
      const elapsedMs = Date.now() - startedAt;
      expect(response.status).toBe(200);
      expect(elapsedMs).toBeLessThan(1_750);
      const started = await response.json() as { schema: string; id: string; status: string; next?: string };
      expect(started).toMatchObject({
        schema: "workbench.run.v1",
        status: "running",
      });
      expect(started.id).toMatch(/^run_/u);

      const status = await invoke(["status", "--dir", root, "--json"]);
      expect(status.code, status.stdout || status.stderr).toBe(0);
      expect(stdoutJson<{ runs: { activeRuns?: Array<{ id: string }> } }>(status).runs.activeRuns)
        .toEqual(expect.arrayContaining([expect.objectContaining({ id: started.id })]));

      const watched = await invoke(["run", "watch", started.id, "--dir", root, "--json"]);
      expect(watched.code, watched.stdout || watched.stderr).toBe(0);
      expect(stdoutJson<{ run: { id: string; status: string } }>(watched).run)
        .toMatchObject({ id: started.id, status: "succeeded" });
    } finally {
      await server.close();
    }
  }, 60_000);

  test("login --wait requires an explicit timeout before loading pending auth", async () => {
    const root = await makeTempRoot("workbench-cli-login-wait-pending-");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "config.json"));
    vi.stubEnv("WORKBENCH_DEVICE_AUTH", path.join(root, "device-auth.json"));
    await fs.writeFile(path.join(root, "device-auth.json"), JSON.stringify({
      schema: "workbench.cli.device-auth.v1",
      baseUrl: "https://cloud.test",
      device_code: "device-pending",
      user_code: "WAIT-1234",
      verification_uri: "https://cloud.test/device",
      verification_uri_complete: "https://cloud.test/device?user_code=WAIT-1234",
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      interval: 1,
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await invoke(["login", "--wait", "--json"]);
    expect(result.code).toBe(2);
    expect(stdoutJson(result)).toMatchObject({
      ok: false,
      code: "usage",
      message: "workbench login --wait requires --timeout N.",
      remediation: "workbench login --wait --timeout 120",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("login --wait fresh start exposes verification info while authorization is pending", async () => {
    const root = await makeTempRoot("workbench-cli-login-wait-fresh-");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "config.json"));
    vi.stubEnv("WORKBENCH_DEVICE_AUTH", path.join(root, "device-auth.json"));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/api/oauth/device/code") {
        return jsonResponse({
          device_code: "device-fresh",
          user_code: "WXYZ-1234",
          verification_uri: "https://cloud.test/device",
          verification_uri_complete: "https://cloud.test/device?user_code=WXYZ-1234",
          expires_in: 120,
          interval: 1,
        });
      }
      if (url.pathname === "/api/oauth/token") {
        return jsonResponse({ error: "authorization_pending" }, 400);
      }
      return jsonResponse({ message: `Unexpected path ${url.pathname}` }, 404);
    }));

    const text = await invoke(["login", "--base-url", "https://cloud.test", "--wait", "--timeout", "1"]);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain("Open https://cloud.test/device?user_code=WXYZ-1234");
    expect(text.stdout).toContain("Code: WXYZ-1234");
    expect(text.stderr).toContain("error[login_pending]");

    await fs.rm(path.join(root, "device-auth.json"), { force: true });
    const json = await invoke(["login", "--base-url", "https://cloud.test", "--wait", "--timeout", "1", "--json"]);
    expect(json.code).toBe(1);
    expect(stdoutJson(json)).toMatchObject({
      ok: false,
      code: "login_pending",
      retryable: true,
      remediation: "workbench login --wait --timeout 120 --json",
      subject: {
        verificationUri: "https://cloud.test/device",
        verificationUriComplete: "https://cloud.test/device?user_code=WXYZ-1234",
        userCode: "WXYZ-1234",
        expiresAt: expect.any(String),
      },
    });
    expect(json.stdout.trim().split("\n")[0]).toBe("{");
  }, 30_000);

  test("login start classifies transient Cloud failures as retryable service_unavailable", async () => {
    const root = await makeTempRoot("workbench-cli-login-start-503-");
    const devicePath = path.join(root, "device-auth.json");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "config.json"));
    vi.stubEnv("WORKBENCH_DEVICE_AUTH", devicePath);
    const fetchMock = vi.fn(async () => new Response("<html><body>Bad Gateway</body></html>", {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "content-type": "text/html" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(["login", "--base-url", "https://cloud.test", "--start-only", "--no-open", "--json"]);
    expect(result.code).toBe(1);
    expect(stdoutJson(result)).toMatchObject({
      ok: false,
      code: "service_unavailable",
      message: expect.stringContaining("502 Bad Gateway"),
      retryable: true,
      remediation: "workbench login --start-only --no-open",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(fs.stat(devicePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("login wait keeps pending auth and classifies transient token failures as service_unavailable", async () => {
    const root = await makeTempRoot("workbench-cli-login-wait-503-");
    const devicePath = path.join(root, "device-auth.json");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "config.json"));
    vi.stubEnv("WORKBENCH_DEVICE_AUTH", devicePath);
    await fs.writeFile(devicePath, JSON.stringify({
      schema: "workbench.cli.device-auth.v1",
      baseUrl: "https://cloud.test",
      device_code: "device-pending",
      user_code: "WAIT-503",
      verification_uri: "https://cloud.test/device",
      verification_uri_complete: "https://cloud.test/device?user_code=WAIT-503",
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      interval: 1,
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      expect(url.pathname).toBe("/api/oauth/token");
      return new Response("temporary gateway failure", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "content-type": "text/plain" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(["login", "--wait", "--timeout", "5", "--json"]);
    expect(result.code).toBe(1);
    expect(stdoutJson(result)).toMatchObject({
      ok: false,
      code: "service_unavailable",
      message: expect.stringContaining("503 temporary gateway failure"),
      retryable: true,
      remediation: "workbench login --wait --timeout 120 --json",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await fs.readFile(devicePath, "utf8"))).toMatchObject({ device_code: "device-pending" });
  });

  test("login denial clears the pending device authorization so the next login starts fresh", async () => {
    const root = await makeTempRoot("workbench-cli-login-denied-");
    const devicePath = path.join(root, "device-auth.json");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "config.json"));
    vi.stubEnv("WORKBENCH_DEVICE_AUTH", devicePath);
    let deviceCodeRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/api/oauth/device/code") {
        deviceCodeRequests += 1;
        return jsonResponse({
          device_code: `device-${deviceCodeRequests}`,
          user_code: "DENY-0001",
          verification_uri: "https://cloud.test/device",
          verification_uri_complete: "https://cloud.test/device?user_code=DENY-0001",
          expires_in: 120,
          interval: 1,
        });
      }
      if (url.pathname === "/api/oauth/token") {
        return jsonResponse({ error: "access_denied" }, 400);
      }
      return jsonResponse({ message: `Unexpected path ${url.pathname}` }, 404);
    }));

    const denied = await invoke(["login", "--base-url", "https://cloud.test", "--wait", "--timeout", "5", "--json"]);
    expect(denied.code).toBe(1);
    expect(stdoutJson(denied)).toMatchObject({ ok: false, code: "login_denied" });
    await expect(fs.stat(devicePath)).rejects.toMatchObject({ code: "ENOENT" });

    const restart = await invoke(["login", "--base-url", "https://cloud.test", "--start-only", "--no-open", "--json"]);
    expect(restart.code).toBe(0);
    expect(stdoutJson(restart)).toMatchObject({ ok: true, status: "authorization_pending" });
    expect(deviceCodeRequests).toBe(2);
  }, 30_000);

  test("logout emits the workbench.cli.logout.v1 envelope with and without a token", async () => {
    const root = await makeTempRoot("workbench-cli-logout-");
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    vi.stubEnv("WORKBENCH_ADAPTER_AUTH_STORE", path.join(root, "auth-store"));
    vi.stubEnv("WORKBENCH_API_TOKEN", undefined);
    vi.stubEnv("WORKBENCH_SMOKE_BEARER_TOKEN", undefined);
    vi.stubEnv("WORKBENCH_API_URL", undefined);
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "logout-token",
      username: "alice",
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe("https://cloud.test/api/oauth/revoke");
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const withToken = await invoke(["logout", "--json"]);
    expect(withToken.code).toBe(0);
    expect(stdoutJson(withToken)).toEqual({
      schema: "workbench.cli.logout.v1",
      ok: true,
      baseUrl: "https://cloud.test",
      tokenPresent: true,
      revoke: "revoked",
      tokenRemoved: true,
      adapterAuth: "unchanged",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await fs.readFile(configPath, "utf8"))).not.toHaveProperty("accessToken");

    const withoutToken = await invoke(["logout", "--json"]);
    expect(withoutToken.code).toBe(0);
    expect(stdoutJson(withoutToken)).toEqual({
      schema: "workbench.cli.logout.v1",
      ok: true,
      baseUrl: "https://cloud.test",
      tokenPresent: false,
      revoke: "skipped",
      tokenRemoved: false,
      adapterAuth: "unchanged",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("provider logout keeps local disconnect successful when remote auth is gone", async () => {
    const root = await makeTempRoot("workbench-cli-provider-logout-auth-");
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    vi.stubEnv("WORKBENCH_ADAPTER_AUTH_STORE", path.join(root, "auth-store"));
    vi.stubEnv("WORKBENCH_API_TOKEN", undefined);
    vi.stubEnv("WORKBENCH_SMOKE_BEARER_TOKEN", undefined);
    vi.stubEnv("WORKBENCH_API_URL", undefined);
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "stale-token",
      username: "alice",
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe("https://cloud.test/api/workbench/auth/adapters/codex?profile=default");
      expect(init?.method).toBe("DELETE");
      return jsonResponse({
        schema: "workbench.cloud.error.v1",
        code: "auth_required",
        message: "Authentication is required.",
        retryable: false,
        remediation: "workbench login",
      }, 401);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(["logout", "codex", "--json"]);

    expect(result.code, result.stdout || result.stderr).toBe(0);
    expect(stdoutJson(result)).toMatchObject({
      schema: "workbench.cli.logout.v1",
      ok: true,
      provider: "codex",
      localAdapter: { adapter: "codex", profile: "default", status: "disconnected" },
      remoteAdapterAuth: {
        status: "unknown",
        sync: "skipped",
        reason: "workbench_not_authenticated",
        remediation: "workbench login",
        workbenchCloud: { status: "not_authenticated" },
      },
    });
  });

  test("provider logout reports remote provider disconnection after successful Cloud deletion", async () => {
    const root = await makeTempRoot("workbench-cli-provider-logout-deleted-");
    const configPath = path.join(await makeTempRoot("workbench-cli-config-"), "config.json");
    vi.stubEnv("WORKBENCH_CONFIG", configPath);
    vi.stubEnv("WORKBENCH_ADAPTER_AUTH_STORE", path.join(root, "auth-store"));
    vi.stubEnv("WORKBENCH_API_TOKEN", undefined);
    vi.stubEnv("WORKBENCH_SMOKE_BEARER_TOKEN", undefined);
    vi.stubEnv("WORKBENCH_API_URL", undefined);
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "token",
      username: "alice",
    }));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe("https://cloud.test/api/workbench/auth/adapters/codex?profile=default");
      expect(init?.method).toBe("DELETE");
      return jsonResponse({ ok: true, status: "deleted" });
    }));

    const result = await invoke(["logout", "codex", "--json"]);

    expect(result.code, result.stdout || result.stderr).toBe(0);
    expect(stdoutJson(result)).toMatchObject({
      schema: "workbench.cli.logout.v1",
      ok: true,
      provider: "codex",
      localAdapter: { adapter: "codex", profile: "default", status: "disconnected" },
      remoteAdapterAuth: {
        status: "disconnected",
        sync: "deleted",
        workbenchCloud: { status: "authenticated" },
      },
    });
    expect(stdoutJson(result)).not.toMatchObject({
      remoteAdapterAuth: { status: "authenticated" },
    });
  });

  test("log --versions emits version summaries without file contents", async () => {
    const root = await makeTempRoot("workbench-cli-version-summary-");
    expect((await invoke(["new", root, "--agent", "local", "--json"])).code).toBe(0);
    const marker = "VERSIONS_JSON_CONTENT_MARKER";
    await fs.appendFile(path.join(root, "SKILL.md"), `\n${marker}\n`);

    const inspection = await invoke(["versions", "--dir", root, "--json"]);
    expect(inspection.code, inspection.stdout || inspection.stderr).toBe(0);
    expect(stdoutJson<{ versions: Array<Record<string, unknown>> }>(inspection).versions).toHaveLength(1);
    expect(inspection.stdout).not.toContain(marker);

    const versions = await invoke(["log", "--versions", "--dir", root, "--json"]);
    expect(versions.code).toBe(0);
    const result = stdoutJson<{ entries: Array<Record<string, unknown>> }>(versions).entries;
    expect(result.length).toBeGreaterThan(0);
    for (const version of result) {
      expect(version).toMatchObject({
        kind: "version",
        id: expect.any(String),
        message: expect.any(String),
        createdAt: expect.any(String),
        fileCount: expect.any(Number),
      });
      expect(version).not.toHaveProperty("files");
    }
    expect(versions.stdout).not.toContain(marker);
  });

  test("install refuses to overwrite a changed target skill without --yes", async () => {
    const root = await makeTempRoot("workbench-cli-install-prevalidate-");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "config.json"));
    vi.stubEnv("HOME", root);
    const destination = path.join(root, ".agents", "skills", "private-skill");
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(destination, "SKILL.md"), "# Different existing content\n");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      schema: "workbench.source.snapshot.v1",
      owner: "alice",
      name: "private-skill",
      versionId: "v007",
      files: [{ path: "SKILL.md", kind: "text", encoding: "utf8", executable: false, content: privateSkillMarkdown }],
    })));

    const conflicted = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--target", "codex", "--scope", "global", "--json"]);
    expect(conflicted.code).toBe(1);
    expect(stdoutJson(conflicted)).toMatchObject({
      ok: false,
      code: "install_failed",
      message: `Skill destination has unmanaged content: ${destination}`,
      subject: { destination, status: "unmanaged", target: "codex" },
    });
    const pinned = await invoke(["install", "alice/private-skill@v007", "--target", "codex", "--scope", "global", "--json"]);
    expect(pinned.code).toBe(1);
    expect(stdoutJson(pinned)).toMatchObject({
      ok: false,
      code: "install_failed",
      remediation: "workbench install alice/private-skill@v007 --target codex --scope global --yes",
    });
    await expect(fs.readFile(path.join(destination, "SKILL.md"), "utf8")).resolves.toBe("# Different existing content\n");
    await expect(fs.stat(path.join(root, ".agents", "skills", ".workbench-installs.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("install dry-run reports the planned target copy without writing and rejects deleted flags", async () => {
    const root = await makeTempRoot("workbench-cli-install-dry-run-");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "config.json"));
    vi.stubEnv("HOME", root);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      schema: "workbench.source.snapshot.v1",
      owner: "alice",
      name: "private-skill",
      versionId: "v007",
      files: [{ path: "SKILL.md", kind: "text", encoding: "utf8", executable: false, content: privateSkillMarkdown }],
    })));

    const dryRun = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--target", "codex", "--scope", "global", "--dry-run", "--json"]);
    expect(dryRun.code).toBe(0);
    expect(stdoutJson(dryRun)).toMatchObject({
      schema: "workbench.cli.install.v3",
      ok: true,
      result: "planned",
      next: null,
      filesCopied: 0,
      dryRun: true,
      scope: "global",
      targets: [expect.objectContaining({
        target: "codex",
        previous: "none",
        destination: path.join(root, ".agents", "skills", "private-skill"),
        filesCopied: 0,
      })],
    });
    await expect(fs.stat(path.join(root, ".agents", "skills", "private-skill"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(root, ".agents", "skills", ".workbench-installs.json"))).rejects.toMatchObject({ code: "ENOENT" });

    const dryRunHuman = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--target", "codex", "--scope", "global", "--dry-run"]);
    expect(dryRunHuman.code, dryRunHuman.stdout || dryRunHuman.stderr).toBe(0);
    expect(dryRunHuman.stdout).toContain("Would install private-skill for codex global (dry run made no changes).");
    expect(dryRunHuman.stdout).not.toContain("machine\t");
    expect(dryRunHuman.stdout).not.toContain("\tnone\t");

    const copyFlag = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--target", "codex", "--scope", "global", "--copy", "--json"]);
    expect(copyFlag.code).toBe(2);
    expect(stdoutJson(copyFlag)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --copy for workbench install.",
    });

    const deletedToFlag = `--${"to"}`;
    const toFlag = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--target", "codex", "--scope", "global", deletedToFlag, "codex", "--json"]);
    expect(toFlag.code).toBe(2);
    expect(stdoutJson(toFlag)).toMatchObject({
      ok: false,
      code: "usage",
      message: `Unsupported flag ${deletedToFlag} for workbench install.`,
    });
  });

  test("install reports unchanged target content without rewriting files", async () => {
    const root = await makeTempRoot("workbench-cli-install-unchanged-");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "config.json"));
    vi.stubEnv("HOME", root);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      schema: "workbench.source.snapshot.v1",
      owner: "alice",
      name: "private-skill",
      versionId: "v007",
      files: [{ path: "SKILL.md", kind: "text", encoding: "utf8", executable: false, content: privateSkillMarkdown }],
    })));

    const first = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--target", "codex", "--scope", "global", "--json"]);
    expect(first.code).toBe(0);
    expect(stdoutJson(first)).toMatchObject({ result: "installed", filesCopied: 1 });
    const installedPath = path.join(root, ".agents", "skills", "private-skill", "SKILL.md");
    const ledgerPath = path.join(root, ".agents", "skills", ".workbench-installs.json");
    await expect(fs.readFile(installedPath, "utf8")).resolves.toBe(privateSkillMarkdown);
    const ledgerAfterFirstInstall = await fs.readFile(ledgerPath, "utf8");

    const second = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--target", "codex", "--scope", "global", "--json"]);
    expect(second.code).toBe(0);
    expect(stdoutJson(second)).toMatchObject({
      result: "unchanged",
      filesCopied: 0,
      targets: [expect.objectContaining({
        previous: "unchanged",
        destination: path.join(root, ".agents", "skills", "private-skill"),
      })],
    });
    await expect(fs.readFile(ledgerPath, "utf8")).resolves.toBe(ledgerAfterFirstInstall);
    const dryRun = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--target", "codex", "--scope", "global", "--dry-run", "--json"]);
    expect(dryRun.code, dryRun.stdout || dryRun.stderr).toBe(0);
    expect(stdoutJson(dryRun)).toMatchObject({
      result: "planned",
      filesCopied: 0,
      dryRun: true,
      targets: [expect.objectContaining({
        previous: "unchanged",
        destination: path.join(root, ".agents", "skills", "private-skill"),
      })],
    });
    const dryRunHuman = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--target", "codex", "--scope", "global", "--dry-run"]);
    expect(dryRunHuman.code, dryRunHuman.stdout || dryRunHuman.stderr).toBe(0);
    expect(dryRunHuman.stdout).toContain("Already installed private-skill for codex global (unchanged; dry run made no changes).");
    expect(dryRunHuman.stdout).not.toContain("Would install private-skill");
    await expect(fs.readFile(installedPath, "utf8")).resolves.toBe(privateSkillMarkdown);
    await expectNoInstallFanout(root);
  });

  test("skills inventories target status without writing", async () => {
    const root = await makeTempRoot("workbench-cli-install-inventory-");
    const cwdRoot = await makeTempRoot("workbench-cli-install-inventory-cwd-");
    const previousCwd = process.cwd();
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "config.json"));
    vi.stubEnv("HOME", root);
    stubNoCurrentSkillAccessAgent();
    await fs.writeFile(path.join(root, "config.json"), JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "install-token",
    }));
    const fetchMock = vi.fn(async () => jsonResponse({
      schema: "workbench.source.snapshot.v1",
      owner: "alice",
      name: "private-skill",
      versionId: "v007",
      files: [{
        path: "SKILL.md",
        kind: "text",
        encoding: "utf8",
        executable: false,
        content: privateSkillMarkdown,
      }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    await fs.mkdir(path.join(cwdRoot, ".agents", "skills", "help-skill"), { recursive: true });
    await fs.writeFile(path.join(cwdRoot, ".agents", "skills", "help-skill", "SKILL.md"), [
      "---",
      "name: help-skill",
      "description: CWD-local pollution fixture.",
      "---",
      "# Help",
      "",
    ].join("\n"));
    process.chdir(cwdRoot);
    try {
      const bareInstall = await invoke(["install", "--json"]);
      expect(bareInstall.code).toBe(2);
      expect(stdoutJson(bareInstall)).toMatchObject({
        ok: false,
        code: "usage",
        message: "workbench install requires OWNER/SKILL or a Workbench Cloud skill URL.",
        remediation: "workbench install OWNER/SKILL",
      });

      const bareSkills = await invoke(["skills", "--json"]);
      expect(bareSkills.code, bareSkills.stdout || bareSkills.stderr).toBe(0);
      expect(stdoutJson(bareSkills)).toMatchObject({
        schema: "workbench.cli.skills.v2",
        ok: true,
        scopes: ["folder", "global"],
        targets: expect.arrayContaining([
          expect.objectContaining({ id: "codex", scope: "folder" }),
          expect.objectContaining({ id: "codex", scope: "global" }),
          expect.objectContaining({ id: "claude", scope: "folder" }),
          expect.objectContaining({ id: "claude", scope: "global" }),
        ]),
        skills: [expect.objectContaining({ target: "codex", scope: "folder", name: "help-skill", status: "unmanaged" })],
        next: null,
      });

      const empty = await invoke(["skills", "--target", "codex", "--scope", "global", "--json"]);
      expect(empty.code).toBe(0);
      expect(stdoutJson(empty)).toMatchObject({
        schema: "workbench.cli.skills.v2",
        ok: true,
        scope: "global",
        targets: [expect.objectContaining({
          id: "codex",
          writeRoot: path.join(root, ".agents", "skills"),
        })],
        skills: [],
        next: null,
      });

      const folder = await invoke(["skills", "--target", "codex", "--dir", cwdRoot, "--json"]);
      expect(folder.code).toBe(0);
      expect(stdoutJson<{ skills: Array<{ name: string; status: string; target: string }> }>(folder).skills)
        .toEqual([expect.objectContaining({ target: "codex", name: "help-skill", status: "unmanaged" })]);
      const folderHuman = await invoke(["skills", "--target", "codex", "--dir", cwdRoot]);
      expect(folderHuman.code, folderHuman.stdout || folderHuman.stderr).toBe(0);
      expect(folderHuman.stdout).toMatch(/^name\s+target\s+scope\s+status\s+source/mu);
      expect(folderHuman.stdout).toMatch(/\bhelp-skill\s+codex\s+folder\s+unmanaged\s+\(no provenance\)/u);

      const installed = await invoke(["install", "alice/private-skill", "--target", "codex", "--scope", "global", "--json"]);
      expect(installed.code, installed.stdout || installed.stderr).toBe(0);

      vi.stubGlobal("fetch", vi.fn(async () => {
        throw new Error("offline");
      }));
      const current = await invoke(["skills", "--target", "codex", "--scope", "global", "--json"]);
      expect(current.code).toBe(0);
      expect(stdoutJson<{ skills: Array<{ name: string; status: string; versionId?: string; handle?: string }>; next: string | null }>(current))
        .toMatchObject({
          skills: [expect.objectContaining({
            name: "private-skill",
            status: "current",
            versionId: "v007",
            handle: "alice/private-skill",
          })],
          next: null,
      });

      const installedSkillPath = path.join(root, ".agents", "skills", "private-skill");
      process.chdir(installedSkillPath);
      const initializedInstalledSkill = await invoke(["init", "--agent", "local", "--json"]);
      process.chdir(cwdRoot);
      expect(initializedInstalledSkill.code, initializedInstalledSkill.stdout || initializedInstalledSkill.stderr).toBe(0);
      const currentAfterInit = await invoke(["skills", "--target", "codex", "--scope", "global", "--json"]);
      expect(currentAfterInit.code).toBe(0);
      expect(stdoutJson<{ skills: Array<{ name: string; status: string; workbenchProject?: boolean }> }>(currentAfterInit).skills)
        .toEqual([expect.objectContaining({
          name: "private-skill",
          status: "current",
          workbenchProject: true,
        })]);

      await fs.appendFile(path.join(installedSkillPath, "SKILL.md"), "\nLocal edit.\n");
      await fs.mkdir(path.join(root, ".agents", "skills", "unmanaged-skill"), { recursive: true });
      await fs.writeFile(path.join(root, ".agents", "skills", "unmanaged-skill", "SKILL.md"), [
        "---",
        "name: unmanaged-skill",
        "description: Unmanaged fixture.",
        "---",
        "# Unmanaged",
        "",
      ].join("\n"));
      await fs.mkdir(path.join(root, ".agents", "skills", "unmanaged-skill", ".workbench"), { recursive: true });
      await fs.writeFile(
        path.join(root, ".agents", "skills", "unmanaged-skill", ".workbench", "eval.yaml"),
        "schema: workbench.eval.v1\n",
      );
      await fs.writeFile(
        path.join(root, ".agents", "skills", "unmanaged-skill", ".workbench", "agents.yaml"),
        "schema: workbench.agents.v1\ndefault: default\nagents:\n  default:\n    adapter: local\n",
      );
      const changed = await invoke(["skills", "--target", "codex", "--scope", "global", "--json"]);
      expect(stdoutJson<{ skills: Array<{ name: string; status: string; workbenchProject?: boolean }> }>(changed).skills)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ name: "private-skill", status: "modified" }),
          expect.objectContaining({ name: "unmanaged-skill", status: "project", workbenchProject: true }),
        ]));
      vi.stubGlobal("fetch", fetchMock);
      const dryRunModified = await invoke(["install", "alice/private-skill", "--target", "codex", "--scope", "global", "--dry-run", "--json"]);
      expect(dryRunModified.code, dryRunModified.stdout || dryRunModified.stderr).toBe(0);
      expect(stdoutJson(dryRunModified)).toMatchObject({
        ok: true,
        result: "blocked",
        requiresOverwrite: true,
        remediation: "workbench install alice/private-skill --target codex --scope global --yes",
        next: "workbench install alice/private-skill --target codex --scope global --yes",
        filesCopied: 0,
        targets: [expect.objectContaining({
          previous: "modified",
          result: "blocked",
          requiresOverwrite: true,
          remediation: "workbench install alice/private-skill --target codex --scope global --yes",
          filesCopied: 0,
        })],
      });
      await expect(fs.readFile(path.join(root, ".agents", "skills", "private-skill", "SKILL.md"), "utf8"))
        .resolves.toContain("Local edit.");
      const dryRunModifiedHuman = await invoke(["install", "alice/private-skill", "--target", "codex", "--scope", "global", "--dry-run"]);
      expect(dryRunModifiedHuman.code, dryRunModifiedHuman.stdout || dryRunModifiedHuman.stderr).toBe(0);
      expect(dryRunModifiedHuman.stdout).toContain("Would require --yes to overwrite private-skill for codex global (dry run made no changes).");
      expect(dryRunModifiedHuman.stdout).toContain("next: workbench install alice/private-skill --target codex --scope global --yes");
      const realOverwrite = await invoke(["install", "alice/private-skill", "--target", "codex", "--scope", "global", "--json"]);
      expect(realOverwrite.code).toBe(1);
      expect(stdoutJson(realOverwrite)).toMatchObject({
        ok: false,
        code: "install_failed",
        message: `Skill destination has modified content: ${path.join(root, ".agents", "skills", "private-skill")}`,
        remediation: "workbench install alice/private-skill --target codex --scope global --yes",
        subject: {
          destination: path.join(root, ".agents", "skills", "private-skill"),
          status: "modified",
          target: "codex",
        },
      });
      const folderInstall = await invoke(["install", "alice/private-skill", "--target", "codex", "--dir", cwdRoot, "--json"]);
      expect(folderInstall.code, folderInstall.stdout || folderInstall.stderr).toBe(0);
      await fs.appendFile(path.join(cwdRoot, ".agents", "skills", "private-skill", "SKILL.md"), "\nFolder-local edit.\n");
      const folderOverwrite = await invoke(["install", "alice/private-skill", "--target", "codex", "--dir", cwdRoot, "--json"]);
      expect(folderOverwrite.code).toBe(1);
      expect(stdoutJson(folderOverwrite)).toMatchObject({
        ok: false,
        code: "install_failed",
        message: `Skill destination has modified content: ${path.join(cwdRoot, ".agents", "skills", "private-skill")}`,
        remediation: `workbench install alice/private-skill --target codex --dir ${cwdRoot} --yes`,
        subject: {
          destination: path.join(cwdRoot, ".agents", "skills", "private-skill"),
          status: "modified",
          target: "codex",
        },
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  dockerTest("runs the local skill lifecycle through public commands", async () => {
    const root = await makeTempRoot("workbench-cli-skill-");
    vi.stubEnv("WORKBENCH_ADAPTER_AUTH_STORE", await makeTempRoot("workbench-cli-empty-adapter-auth-"));

    const created = await invoke(["new", root, "--agent", "local"]);
    expect(created.code, created.stdout || created.stderr).toBe(0);
    expect(created.stdout).toContain("Default agent: default adapter=local model=docker readiness=deterministic");
    await expect(fs.access(path.join(root, ".workbench", "cases", "case-001", "case.yaml")))
      .rejects.toMatchObject({ code: "ENOENT" });

    await writePassingCaseTest(root);
    const version = { id: await currentVersionIdFor(root) };
    expect(version.id).toMatch(/^v_[a-f0-9]{64}$/u);
    const versions = await invoke(["log", "--versions", "--json", "--dir", root]);
    expect(versions.stderr).toBe("");
    expect(stdoutJson<{ entries: Array<{ id: string }> }>(versions).entries)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: version.id })]));

    const evalResult = await invoke(["eval", "--dir", root, "--json"]);
    const run = stdoutJson<{
      run: {
        id: string;
        plan: { versionId?: string };
        progress: { planned: number; completed: number; evidenceCount?: number };
        measurements: Array<{ runId: string; score?: number }>;
        result?: { score?: number };
      };
    }>(evalResult).run;
    expect(run.id).toMatch(/^run_/u);
    expect(run.plan.versionId).toBe(version.id);
    expect(run.result?.score).toBe(1);
    expect(run.progress.planned).toBe(1);
    expect(run.progress.completed).toBe(1);
    expect(run.progress.evidenceCount).toBeGreaterThanOrEqual(1);
    expect(run.measurements).toHaveLength(1);
    expect(run.measurements[0]?.score).toBe(1);
    const inspection = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
    const runTrace = inspection.traces.find((trace) => trace.runId === run.id);
    const runResult = runTrace?.result as { score?: number; metrics?: { score?: number }; cases?: Array<{ metrics?: { score?: number } }> } | undefined;
    expect(runResult?.score).toBe(1);
    expect(runResult?.metrics?.score).toBe(1);
    expect(runResult?.cases?.[0]?.metrics?.score).toBe(1);
    const reusedEval = await invoke(["eval", "--dir", root, "--json"]);
    const reusedRun = stdoutJson<{ run: { id: string } }>(reusedEval).run;
    expect(reusedRun.id).toBe(run.id);
    const rerunEval = await invoke(["eval", "--dir", root, "--rerun", "--json"]);
    const rerunRun = stdoutJson<{ run: { id: string; result?: { score?: number } } }>(rerunEval).run;
    expect(rerunRun.id).not.toBe(run.id);
    expect(rerunRun.result?.score).toBe(1);
    const prematureImprove = await invoke(["improve", "--dir", root, "--json"]);
    expect(prematureImprove.code).toBe(2);
    expect(prematureImprove.stderr).toBe("");
    expect(stdoutJson(prematureImprove)).toMatchObject({
      ok: false,
      code: "improve_evidence_required",
      remediation: "workbench case draft 'case-002'",
    });

    await writeFailingCaseTest(root, "cli workflow failure");
    const failingEval = await invoke(["eval", "--dir", root, "--json"]);
    expect(failingEval.code).toBe(1);
    const failingEvalJson = stdoutJson<{
      ok: false;
      code: string;
      failedMeasurements: Array<{ runId: string; versionId: string; status: string; score?: number; traceIds: string[] }>;
      next: string;
    }>(failingEval);
    expect(failingEvalJson).toMatchObject({ ok: false, code: "eval_runs_failed", evidenceSaved: true });
    expect(failingEvalJson.next).toBe(`workbench show ${shortTestRef(failingEvalJson.failedMeasurements[0]!.runId)}`);
    const failedMeasurements = failingEvalJson.failedMeasurements;
    expect(failedMeasurements[0]?.status).toBe("failed");
    expect(failedMeasurements[0]?.score).toBe(0);
    const failedRun = failedMeasurements[0]!;
    const failingEvalHuman = await invoke(["eval", "--dir", root]);
    expect(failingEvalHuman.code).toBe(1);
    expect(failingEvalHuman.stdout).toContain(`next: workbench show ${shortTestRef(failedRun.runId)}`);
    expect(failingEvalHuman.stdout).not.toContain("workbench case add");
    expect(failingEvalHuman.stdout).not.toContain("workbench improve --agents");
    const failedRunListing = await invoke(["show", failedRun.runId, "--dir", root, "--json"]);
    const failedRunFiles = stdoutJson<{ result: { files: Array<{ path: string }> } }>(failedRunListing).result.files;
    expect(failedRunFiles.some((file) =>
      /cases\/case-001\/jobs\/job_[^/]+\/stderr\.log$/u.test(file.path)
    )).toBe(true);
    expect(failedRunFiles.some((file) =>
      /cases\/case-001\/jobs\/job_[^/]+\/traces\/trace_[^/]+\/stderr\.log$/u.test(file.path)
    )).toBe(false);
    const failedStderr = await invoke(["show", `${failedRun.runId}:stderr.log`, "--dir", root]);
    expect(failedStderr.stdout).toContain("cli workflow failure");

    const defaultImproveDryRun = await invoke(["improve", "--dry-run", "--dir", root, "--json"]);
    expect(defaultImproveDryRun.code, defaultImproveDryRun.stdout || defaultImproveDryRun.stderr).toBe(0);
    expect(stdoutJson(defaultImproveDryRun)).toMatchObject({
      ok: true,
      schema: "workbench.cli.improve-plan.v1",
      readiness: {
        ready: false,
        issues: [{
          code: "improve_adapter_required",
          message: expect.stringContaining("Agent default cannot run improve because it has no skill-improvement adapter"),
          remediation: "workbench agent add improver --adapter codex --model gpt-5.4-mini --with auth=default",
          subject: {
            agent: "default",
            setupCommands: [
              "workbench agent add improver --adapter codex --model gpt-5.4-mini --with auth=default",
              "codex login --device-auth",
              "workbench login codex --method oauth",
              "workbench eval --agents improver --rerun",
              "workbench improve --agents improver",
            ],
          },
        }],
      },
      next: "workbench agent add improver --adapter codex --model gpt-5.4-mini --with auth=default",
    });

    const defaultImprove = await invoke(["improve", "--dir", root, "--json"]);
    expect(defaultImprove.code).toBe(2);
    expect(defaultImprove.stderr).toBe("");
    expect(stdoutJson(defaultImprove)).toMatchObject({
      ok: false,
      code: "usage",
      message: expect.stringContaining("Agent default cannot run improve because it has no skill-improvement adapter"),
      remediation: "workbench agent add improver --adapter codex --model gpt-5.4-mini --with auth=default",
    });

    const agentAdd = await invoke([
      "agent",
      "add",
      "patcher",
      "--dir",
      root,
      "--adapter",
      "command",
      "--with",
      "improveCommand=printf '\\nCommand-backed improvement from CLI trace evidence.\\n' >> \"$SKILL_DIR/SKILL.md\"",
    ]);
    expect(agentAdd.code).toBe(0);
    const patcherFailingEval = await invoke(["eval", "--dir", root, "--agents", "patcher", "--json"]);
    expect(patcherFailingEval.code).toBe(1);
    const patcherFailedMeasurements = stdoutJson<{ failedMeasurements: Array<{ versionId: string }> }>(patcherFailingEval).failedMeasurements;
    const patcherBaseVersionId = patcherFailedMeasurements[0]!.versionId;

    const improve = await invoke(["improve", "--dir", root, "--agents", "patcher", "--json"]);
    expect(improve.code).toBe(1);
    const improveError = stdoutJson<{ code: string; message: string; remediation?: string }>(improve);
    const improveProgress = stderrJsonLines(improve);
    expect(improveProgress).toContainEqual(expect.objectContaining({
      schema: "workbench.run.v1",
      kind: "improve",
      phase: "improving",
      variant: "local",
    }));
    expect(improveProgress).toContainEqual(expect.objectContaining({
      schema: "workbench.run.v1",
      kind: "improve",
      phase: "complete",
      variant: "local",
      progress: expect.objectContaining({
        planned: 1,
        completed: 1,
        evidenceCount: expect.any(Number),
      }),
    }));
    if (improveProgress.some((entry) => entry.phase === "proof")) {
      expect(improveProgress).toContainEqual(expect.objectContaining({
        schema: "workbench.run.v1",
        kind: "improve",
        phase: "proof",
        variant: "local",
        progress: expect.objectContaining({ planned: 1 }),
        result: expect.objectContaining({ improvedVersionId: expect.stringMatching(/^v_/u) }),
      }));
    }
    expect(improveError).toMatchObject({
      ok: false,
      code: "improve_failed",
      message: expect.any(String),
    });

    const results = await invoke(["results", "--dir", root, "--agents", "patcher"]);
    expect(results.stdout).toMatch(/^version\s+agent\s+status\s+quality\s+samples\s+cost\s+latency\s+run/mu);
    expect(results.stdout).toMatch(/\bpatcher\s+failed\b/u);
    expect(results.stdout).toContain(expectedLocalSkillLabel(root, 1));
    expect(results.stdout).toContain(expectedLocalSkillLabel(root, 2));
    expect(results.stdout).toMatch(/\bfailed\s+0\.000\b/u);
    const resultsJson = await invoke(["results", "--dir", root, "--agents", "patcher", "--json"]);
    const resultsPayload = stdoutJson<{ result: { cells: Array<Record<string, unknown>> } }>(resultsJson);
    expect(resultsPayload.result.cells[0]).toHaveProperty("skillVersionId");
    expect(resultsPayload.result.cells[0]).toHaveProperty("evaluationId");
    expect(resultsPayload.result.cells[0]).toHaveProperty("agentVersionId");
    expect(resultsPayload.result.cells[0]).not.toHaveProperty("skillName");
    expect(resultsPayload.result.cells[0]).not.toHaveProperty("skillBundleHash");
    const observerAdd = await invoke(["agent", "add", "observer", "--dir", root, "--adapter", "command"]);
    expect(observerAdd.code, observerAdd.stdout || observerAdd.stderr).toBe(0);
    const allAgentsResults = await invoke(["results", "--dir", root, "--agents", "all"]);
    expect(allAgentsResults.code, allAgentsResults.stdout || allAgentsResults.stderr).toBe(0);
    expect(allAgentsResults.stdout).not.toMatch(/\bnot-run\b/u);
    expect(allAgentsResults.stdout).not.toContain("observer@");
    expect(allAgentsResults.stdout).toContain(expectedLocalSkillLabel(root, 1));
    expect(allAgentsResults.stdout).toContain(expectedLocalSkillLabel(root, 4));
    const improveSnapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
    const improveRun = [...improveSnapshot.runs].reverse()
      .find((run) => run.kind === "improve" && run.agentName === "patcher");
    if (!improveRun?.outputVersionId) {
      throw new Error("Expected failed improve run to retain its candidate version.");
    }
    expect(improveRun.status).toBe("failed");
    expect(improveSnapshot.refs.current).not.toBe(improveRun.outputVersionId);
    const candidateVersionId = improveRun.outputVersionId;

    const previousPublishConfig = process.env.WORKBENCH_CONFIG;
    process.env.WORKBENCH_CONFIG = path.join(root, "missing-publish-config.json");
    try {
      const publish = await invoke(["publish", candidateVersionId, "--dir", root, "--public", "--json"]);
      expect(publish.code).toBe(1);
      expect(publish.stdout.trim().startsWith("{")).toBe(true);
      expect(publish.stdout).not.toContain("workbench publish:");
      expect(publish.stderr).toBe("");
      expect(stdoutJson(publish)).toMatchObject({
        ok: false,
        code: "auth_required",
        remediation: "workbench login",
      });
    } finally {
      if (previousPublishConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousPublishConfig;
      }
    }

    const trace = await invoke(["show", run.id, "--dir", root, "--json"]);
    expect(stdoutJson<{ result: { details: unknown[]; files: Array<{ path: string }> } }>(trace).result.details).toHaveLength(1);
    expect(stdoutJson<{ result: { details: unknown[]; files: Array<{ path: string }> } }>(trace).result.files
      .some((file) => /\/result\.json$/u.test(file.path))).toBe(true);

    const snapshotJson = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
    expect(snapshotJson.jobs).toHaveLength(6);
    expect(snapshotJson.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: improveRun.id,
        kind: "improve",
        caseId: "current",
        status: "succeeded",
      }),
    ]));
    expect(snapshotJson.artifacts.length).toBeGreaterThan(0);
    expect(snapshotJson).toMatchObject({
      status: {
        initialized: true,
      },
    });
    expect(snapshotJson.refs.current).toBe(snapshotJson.status.currentVersionId);

    const caseAdd = await invoke(["case", "add", run.id, "--dir", root, "--json"]);
    expect(caseAdd.code).not.toBe(0);
    expect(stdoutJson(caseAdd)).toMatchObject({ ok: false, message: expect.stringContaining("Unsupported case command: add") });
    const removedCase = await invoke(["case", "rm", "case-001", "--json"]);
    expect(removedCase.code).not.toBe(0);
    expect(stdoutJson(removedCase)).toMatchObject({ ok: false, message: expect.stringContaining("Unsupported case command: rm") });

    expect((await invoke(["--version"])).stdout).toContain("workbench ");
    expect((await invoke(["eval", "--help"])).stdout).toContain("workbench eval");

    const authRoot = await makeTempRoot("workbench-cli-auth-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousAuthStore = process.env.WORKBENCH_ADAPTER_AUTH_STORE;
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.WORKBENCH_CONFIG = path.join(authRoot, "missing-config.json");
    process.env.WORKBENCH_ADAPTER_AUTH_STORE = authRoot;
    process.env.OPENAI_API_KEY = "test-openai-key";
    try {
      const connect = await invoke(["login", "codex", "--method", "api-key", "--json"]);
      expect(connect.code).toBe(0);
      expect(stdoutJson(connect)).toMatchObject({
        provider: "codex",
        localAdapter: {
          adapter: "codex",
          method: "api-key",
          status: "connected",
        },
        remoteAdapterAuth: {
          status: "not_authenticated",
          sync: "skipped",
          reason: "not_authenticated",
        },
      });
      const auth = await invoke(["status", "--dir", root, "--json"]);
      expect(stdoutJson(auth)).toMatchObject({
        ok: true,
        auth: {
          workbenchCloud: { status: "not_authenticated" },
          adapters: [expect.objectContaining({
            adapter: "codex",
            profile: "default",
            status: "connected",
            method: "api-key",
          })],
        },
      });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousAuthStore === undefined) {
        delete process.env.WORKBENCH_ADAPTER_AUTH_STORE;
      } else {
        process.env.WORKBENCH_ADAPTER_AUTH_STORE = previousAuthStore;
      }
      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey;
      }
    }

      const codexHome = await makeTempRoot("workbench-cli-codex-home-");
      const claudeHome = await makeTempRoot("workbench-cli-claude-home-");
    const previousCodexHome = process.env.CODEX_HOME;
    const previousClaudeHome = process.env.CLAUDE_HOME;
    process.env.CODEX_HOME = codexHome;
    process.env.CLAUDE_HOME = claudeHome;
    try {
      const sessionDir = path.join(codexHome, "sessions", "2026", "06", "07");
      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(path.join(sessionDir, "session-test.jsonl"), `${JSON.stringify({ title: "Review recurring workflow eval" })}\n`);
      const sessionDetail = await invoke(["show", "codex:session-test", "--json"]);
      expect(stdoutJson(sessionDetail)).toMatchObject({
        result: {
        id: "codex:session-test",
        source: "codex",
        excerpts: expect.arrayContaining(["Review recurring workflow eval"]),
        },
      });
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
      if (previousClaudeHome === undefined) {
        delete process.env.CLAUDE_HOME;
      } else {
        process.env.CLAUDE_HOME = previousClaudeHome;
      }
    }
  }, 60_000);
});

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
    `printf '{"ok":false,"message":%s}\\n' ${shellQuote(JSON.stringify(message))} > "$OUTPUT_DIR/result.json"`,
    "exit 2",
    "",
  ].join("\n"));
  await fs.chmod(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), 0o755);
}

async function writeSkillDependentCaseTest(root: string, marker: string): Promise<void> {
  await fs.mkdir(path.join(root, ".workbench", "cases", "case-001", "tests"), { recursive: true });
  await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "case.yaml"), [
    "version: 1",
    "id: case-001",
    "prompt: Exercise an improvement that changes the skill package.",
    "rubric:",
    "  - The skill source contains the expected improvement marker.",
    "command: sh \"$CASE_DIR/tests/test.sh\"",
    "",
  ].join("\n"));
  await fs.writeFile(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), [
    "#!/bin/sh",
    "set -eu",
    "mkdir -p \"$OUTPUT_DIR\"",
    `if grep -q ${shellQuote(marker)} "$SKILL_DIR/SKILL.md"; then`,
    "  printf '{\"ok\":true,\"score\":1,\"metrics\":{\"score\":1}}\\n' > \"$OUTPUT_DIR/result.json\"",
    "else",
    `  printf '%s\\n' ${shellQuote(`Missing ${marker}`)} >&2`,
    `  printf '{"ok":false,"score":0,"message":%s}\\n' ${shellQuote(JSON.stringify(`Missing ${marker}`))} > "$OUTPUT_DIR/result.json"`,
    "  exit 2",
    "fi",
    "",
  ].join("\n"));
  await fs.chmod(path.join(root, ".workbench", "cases", "case-001", "tests", "test.sh"), 0o755);
}

async function addCommandImproveAgent(root: string): Promise<void> {
  const added = await invoke([
    "agent",
    "add",
    "patcher",
    "--dir",
    root,
    "--adapter",
    "command",
    "--with",
    "improveCommand=printf '\\nCommand-backed hosted improvement.\\n' >> \"$SKILL_DIR/SKILL.md\"",
  ]);
  expect(added.code, added.stdout || added.stderr).toBe(0);
}

async function seedFailedImproveEvidence(
  root: string,
  agent = "default",
  options: {
    status?: "failed" | "succeeded";
    score?: number;
    error?: string;
  } = {},
): Promise<{
  prepared: WorkbenchPreparedCloudEvalRequest & {
    evalHash: string;
    skill: string;
    skillBundleHash: string;
    agent: string;
    agentHash: string;
  };
  traceId: string;
}> {
  await writePassingCaseTest(root);
  const request = await prepareWorkbenchCloudEvalRequest({ dir: root, agent });
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
  const version = snapshot.versions.find((entry) => entry.id === request.versionId) ?? snapshot.versions[0];
  if (!version) {
    throw new Error("Expected seeded version.");
  }
  const runtime = await createWorkbenchVersionRuntimeSnapshot(version, { agent });
  const skillBundle = runtime.skillBundles[0];
  const selectedAgent = runtime.selectedAgents[0];
  if (!skillBundle || !selectedAgent) {
    throw new Error("Expected seeded skill bundle and agent.");
  }
  const prepared = {
    ...request,
    evalHash: runtime.evalSnapshot.hash,
    skill: skillBundle.skillName,
    skillBundleHash: skillBundle.hash,
    agent: selectedAgent.name,
    agentHash: hashJson(selectedAgent),
  };
  const createdAt = "2026-06-10T19:00:00.000Z";
  const finishedAt = "2026-06-10T19:00:01.000Z";
  const runId = `run_seed_${agent}`;
  const jobId = `job_seed_${agent}`;
  const traceId = `trace_seed_${agent}`;
  const status = options.status ?? "failed";
  const score = options.score ?? 0;
  const error = options.error ?? (status === "failed" ? "seeded hosted improve evidence" : undefined);
  await fs.mkdir(path.join(root, ".workbench", "objects", "run"), { recursive: true });
  await fs.mkdir(path.join(root, ".workbench", "objects", "job"), { recursive: true });
  await fs.mkdir(path.join(root, ".workbench", "objects", "trace"), { recursive: true });
  await fs.writeFile(path.join(root, ".workbench", "objects", "run", `${runId}.json`), JSON.stringify({
    id: runId,
    kind: "eval",
    versionId: prepared.versionId,
    skillName: prepared.skill,
    skillBundleHash: prepared.skillBundleHash,
    evalHash: prepared.evalHash,
    agentName: prepared.agent,
    agentHash: prepared.agentHash,
    status,
    score,
    jobIds: [jobId],
    traceIds: [traceId],
    createdAt,
    finishedAt,
    ...(error ? { error } : {}),
  }));
  await fs.writeFile(path.join(root, ".workbench", "objects", "job", `${jobId}.json`), JSON.stringify({
    id: jobId,
    runId,
    kind: "eval",
    versionId: prepared.versionId,
    skillName: prepared.skill,
    skillBundleHash: prepared.skillBundleHash,
    evalHash: prepared.evalHash,
    agentName: prepared.agent,
    agentHash: prepared.agentHash,
    caseId: "case-001",
    sample: 0,
    status,
    score,
    artifactIds: [],
    traceIds: [traceId],
    createdAt,
    startedAt: createdAt,
    finishedAt,
    ...(error ? { error } : {}),
  }));
  await fs.writeFile(path.join(root, ".workbench", "objects", "trace", `${traceId}.json`), JSON.stringify({
    id: traceId,
    runId,
    jobId,
    versionId: prepared.versionId,
    skillName: prepared.skill,
    skillBundleHash: prepared.skillBundleHash,
    evalHash: prepared.evalHash,
    agentName: prepared.agent,
    agentHash: prepared.agentHash,
    createdAt,
    request: { caseId: "case-001" },
    result: { status, score, ...(error ? { error } : {}) },
    files: [{ path: "stderr.log", kind: "text", encoding: "utf8", executable: false, content: `${error ?? "seeded hosted improve evidence"}\n` }],
  }));
  return { prepared, traceId };
}

async function writePassingCaseTest(root: string, caseId = "case-001"): Promise<void> {
  await fs.mkdir(path.join(root, ".workbench", "cases", caseId, "tests"), { recursive: true });
  await fs.writeFile(path.join(root, ".workbench", "cases", caseId, "case.yaml"), [
    "version: 1",
    `id: ${caseId}`,
    "prompt: Exercise the workflow happy path.",
    "rubric:",
    "  - Captures workflow-specific success evidence.",
    "command: sh \"$CASE_DIR/tests/test.sh\"",
    "",
  ].join("\n"));
  await fs.writeFile(path.join(root, ".workbench", "cases", caseId, "tests", "test.sh"), [
    "#!/bin/sh",
    "set -eu",
    "mkdir -p \"$OUTPUT_DIR\"",
    "printf '{\"ok\":true,\"score\":1,\"metrics\":{\"score\":1}}\\n' > \"$OUTPUT_DIR/result.json\"",
    "",
  ].join("\n"));
  await fs.chmod(path.join(root, ".workbench", "cases", caseId, "tests", "test.sh"), 0o755);
}

async function writeSleepingPassingCaseTest(root: string, seconds: number, caseId = "case-001"): Promise<void> {
  await writePassingCaseTest(root, caseId);
  await fs.writeFile(path.join(root, ".workbench", "cases", caseId, "tests", "test.sh"), [
    "#!/bin/sh",
    "set -eu",
    `sleep ${seconds}`,
    "mkdir -p \"$OUTPUT_DIR\"",
    "printf '{\"ok\":true,\"score\":1,\"metrics\":{\"score\":1}}\\n' > \"$OUTPUT_DIR/result.json\"",
    "",
  ].join("\n"));
  await fs.chmod(path.join(root, ".workbench", "cases", caseId, "tests", "test.sh"), 0o755);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function nodeCommand(lines: readonly string[]): string {
  return `node -e ${shellQuote(lines.join("\n"))}`;
}

function evalResultCommand(input: {
  ok: boolean;
  score: number;
  message: string;
  exitCode: number;
}): string {
  return nodeCommand([
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });",
    `fs.writeFileSync(path.join(process.env.OUTPUT_DIR, 'result.json'), ${JSON.stringify(JSON.stringify({
      ok: input.ok,
      score: input.score,
      message: input.message,
    }) + "\n")});`,
    `process.exit(${input.exitCode});`,
  ]);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyObjectPack(createdAt: string): Record<string, unknown> {
  return {
    schema: "workbench.object-pack.v1",
    createdAt,
    refs: {},
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
}

function cloudInspectionEnvelope(
  cursor: string,
  objectPack: Record<string, unknown>,
  root = "/skills/alice/cloud-skill",
): Record<string, unknown> {
  const refs = objectPack.refs && typeof objectPack.refs === "object" && !Array.isArray(objectPack.refs)
    ? objectPack.refs as Record<string, string>
    : {};
  const versions = arrayValue(objectPack.versions);
  const runs = arrayValue(objectPack.runs);
  return {
    schema: "workbench.inspection.snapshot-envelope.v1",
    cursor,
    snapshot: {
      root,
      status: {
        root,
        initialized: true,
        currentVersionId: refs.current,
        versionCount: versions.length,
        runCount: runs.length,
        remoteCount: 0,
      },
      refs,
      versions,
      skillSources: arrayValue(objectPack.skillSources),
      skillBundles: arrayValue(objectPack.skillBundles),
      evals: arrayValue(objectPack.evals),
      agents: arrayValue(objectPack.agents),
      runs,
      jobs: arrayValue(objectPack.jobs),
      traces: arrayValue(objectPack.traces),
      executionEvents: arrayValue(objectPack.executionEvents),
      artifacts: arrayValue(objectPack.artifacts),
      lineage: arrayValue(objectPack.lineage),
      remotes: {},
    },
  };
}

function normalizeTestHandlePart(value: string): string {
  return normalizeWorkbenchSkillName(value) || "skill";
}

function shortTestRef(id: string): string {
  const version = /^v_([0-9a-f]{8,})$/iu.exec(id);
  if (version?.[1]) {
    return version[1].slice(0, 8);
  }
  const separator = id.indexOf("_");
  if (separator > 0 && separator < id.length - 1) {
    return `${id.slice(0, separator)}_${id.slice(separator + 1, separator + 9)}`;
  }
  return id.length > 8 ? id.slice(0, 8) : id;
}

function mergeObjectPacks(
  left: ReturnType<typeof emptyObjectPack>,
  right: ReturnType<typeof emptyObjectPack>,
): ReturnType<typeof emptyObjectPack> {
  return {
    ...left,
    refs: { ...(left.refs as Record<string, string>), ...(right.refs as Record<string, string>) },
    versions: mergeById(left.versions, right.versions),
    skillSources: mergeById(left.skillSources, right.skillSources, "name"),
    skillBundles: mergeById(left.skillBundles, right.skillBundles, "hash"),
    evals: mergeById(left.evals, right.evals, "hash"),
    agents: [...(left.agents as unknown[]), ...(right.agents as unknown[])],
    runs: mergeById(left.runs, right.runs),
    jobs: mergeById(left.jobs, right.jobs),
    traces: mergeById(left.traces, right.traces),
    executionEvents: mergeById(left.executionEvents, right.executionEvents, "id"),
    artifacts: mergeById(left.artifacts, right.artifacts),
    lineage: [...(left.lineage as unknown[]), ...(right.lineage as unknown[])],
  };
}

function mergeById(
  left: unknown,
  right: unknown,
  key = "id",
): unknown[] {
  const entries = new Map<string, unknown>();
  for (const entry of [...arrayValue(left), ...arrayValue(right)]) {
    const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
    const id = record?.[key];
    entries.set(typeof id === "string" ? id : JSON.stringify(entry), entry);
  }
  return [...entries.values()];
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
