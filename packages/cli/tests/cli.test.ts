import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";

import { rootUsage } from "../src/command-model";
import { composeRuntimeDockerfileWithAdapters } from "../src/adapter-project";
import { localBenchmarkFingerprint, localCandidateFingerprint, projectStateBenchmarkFingerprint } from "../src/benchmark-fingerprint";
import { startLocalWorkbenchDevServer } from "../src/dev-open-server";
import { runCli } from "../src/index";
import { exportLocalRuntimeBundle, importLocalRuntimeBundle, loadLocalArchive, readLocalJobs, saveLocalArchive, saveLocalJobs, upsertLocalRun } from "../src/local-archive";
import { readLocalProjectSource } from "../src/project-source";
import { packageRoot, productRoot } from "./test-paths";
import {
  engineResolveBindingForSpec,
  normalizeSurfaceFiles,
  workbenchRunExecutionFingerprint,
  workbenchRuntimeBundleFingerprint,
  type CandidateRecord,
  type EvaluationScorecard,
  type HostedWorkbenchJob,
  type RunSummary,
  type WorkbenchRuntimeBundle,
  type WorkbenchProjectState,
  type WorkbenchProjectStateImportResult,
} from "@workbench-ai/workbench-core";

const loopbackAvailable = await canBindLoopback();
const dockerAvailable = await canRunDocker();

function emptyRuntimeBundle(): WorkbenchRuntimeBundle {
  return {
    schema: "workbench.runtime.bundle.v1",
    activeId: null,
    candidates: [],
    candidateFiles: [],
    evaluations: [],
    runs: [],
    jobs: [],
    executionFiles: [],
    events: [],
  };
}

function emptyRuntimeStats(runtime = emptyRuntimeBundle()) {
  return {
    candidates: runtime.candidates.length,
    candidateFiles: runtime.candidateFiles.reduce((sum, group) => sum + group.files.length, 0),
    evaluations: runtime.evaluations.length,
    runs: runtime.runs.length,
    jobs: runtime.jobs.length,
    executionFiles: runtime.executionFiles.reduce((sum, group) => sum + group.files.length, 0),
    events: runtime.events.length,
    activeId: runtime.activeId,
  };
}

function projectStateFixture(input: {
  id?: string;
  owner?: string;
  name?: string;
  visibility?: "private" | "public";
  revisionId?: string;
  sourceFingerprint?: string;
  runtimeFingerprint?: string;
  files?: Array<{ path: string; content: string; executable?: boolean; encoding?: "utf8" | "base64" }>;
  runtime?: WorkbenchRuntimeBundle;
} = {}): WorkbenchProjectState {
  const owner = input.owner ?? "alice";
  const name = input.name ?? "demo";
  const files = (input.files ?? [
    { path: "benchmark.yaml", content: "version: 4\nname: demo\ndescription: Demo benchmark.\nengine:\n  use: workbench\n  with:\n    environment:\n      dockerfile: environment/Dockerfile\n    score:\n      use: command\n      with:\n        command: 'true'\n" },
  ]).map((file) => ({
    path: file.path,
    kind: file.encoding === "base64" ? "binary" as const : "text" as const,
    encoding: file.encoding ?? "utf8" as const,
    content: file.content,
    executable: file.executable === true,
  }));
  return {
    schema: "workbench.project.state.v1",
    project: {
      id: input.id ?? "wb_123456789abc",
      remote: `${owner}/${name}`,
      ownerUsername: owner,
      name,
      visibility: input.visibility ?? "public",
    },
    base: {
      sourceRevisionId: input.revisionId ?? "spec_0001",
      sourceFingerprint: input.sourceFingerprint ?? "fp_0001",
      runtimeFingerprint: input.runtimeFingerprint ?? "rt_0001",
    },
    source: {
      source: files.find((file) => file.path === "benchmark.yaml")?.content ?? files[0]?.content ?? "",
      files,
      candidateFiles: [],
      engineResolveFiles: [],
      engineResolveBinding: {
        engine: "workbench",
        resolver: {
          use: "workbench",
          withFingerprint: "resolver_fp",
        },
      },
      adapterFiles: [],
      dockerfile: "FROM node:22-alpine",
      runtimeDockerfile: "FROM node:22-alpine",
      runtimeFiles: [],
      network: "off",
      resources: {},
      revisionId: input.revisionId ?? "spec_0001",
      fingerprint: input.sourceFingerprint ?? "fp_0001",
    },
    runtime: input.runtime ?? emptyRuntimeBundle(),
  };
}

function projectStateImportFixture(input: {
  id?: string;
  owner?: string;
  name?: string;
  visibility?: "private" | "public";
  revisionId?: string;
  sourceFingerprint?: string;
  runtimeFingerprint?: string;
  changed?: boolean;
  sourceChanged?: boolean;
  runtimeChanged?: boolean;
  runtime?: WorkbenchRuntimeBundle;
} = {}): WorkbenchProjectStateImportResult {
  const state = projectStateFixture(input);
  return {
    changed: input.changed ?? input.sourceChanged ?? input.runtimeChanged ?? false,
    source: {
      changed: input.sourceChanged ?? false,
      revisionId: state.source.revisionId,
      fingerprint: state.source.fingerprint,
    },
    runtime: {
      changed: input.runtimeChanged ?? false,
      stats: emptyRuntimeStats(state.runtime),
    },
    state,
  };
}

function originFixture(input: {
  projectId?: string;
  remote?: string;
  baseUrl?: string;
  sourceRevisionId?: string;
  sourceFingerprint?: string;
  runtimeFingerprint?: string;
  linkedAt?: string;
} = {}) {
  return {
    baseUrl: input.baseUrl ?? "http://workbench.test",
    linkedAt: input.linkedAt ?? new Date(0).toISOString(),
    projectId: input.projectId ?? "wb_123456789abc",
    remote: input.remote ?? "alice/demo",
    runtimeFingerprint: input.runtimeFingerprint ?? "rt_0001",
    sourceFingerprint: input.sourceFingerprint ?? "fp_0001",
    sourceRevisionId: input.sourceRevisionId ?? "spec_0001",
  };
}

async function currentSourceFingerprint(workspace: string): Promise<string> {
  const io = createIo();
  expect(await runCli(["push", "--dir", workspace, "--dry-run", "--json"], io)).toBe(0);
  return (JSON.parse(io.stdoutText()) as { sourceFingerprint: string }).sourceFingerprint;
}

async function projectStateFixtureForWorkspace(
  workspace: string,
  input: Parameters<typeof projectStateFixture>[0] = {},
): Promise<WorkbenchProjectState> {
  const source = await readLocalProjectSource(workspace);
  return projectStateFixture({
    ...input,
    files: source.sourceFiles,
  });
}

function hostedRuntimeBundleFixture(input: {
  candidateId?: string;
  runId?: string;
  jobId?: string;
} = {}): WorkbenchRuntimeBundle {
  const candidateId = input.candidateId ?? "candidate_123";
  const runId = input.runId ?? "run_123";
  const jobId = input.jobId ?? "job_123";
  const createdAt = "2026-05-28T00:00:00.000Z";
  return {
    schema: "workbench.runtime.bundle.v1",
    activeId: candidateId,
    candidates: [{
      id: candidateId,
      name: "Skill",
      version: 1,
      ordinal: 1,
      benchmarkFingerprint: "benchmark-fp",
      candidateFingerprint: "candidate-fp",
      visibility: "public",
      createdAt,
      referenceIds: [],
      status: "evaluated",
      fileChanges: ["prompt.md"],
    }],
    candidateFiles: [{
      candidateId,
      files: [textFile("prompt.md", "remote hosted candidate\n")],
    }],
    evaluations: [],
    runs: [localRunSummary({
      id: runId,
      candidateId,
      outputCandidateId: candidateId,
      activeCandidateId: candidateId,
      finishedAt: "2026-05-28T00:00:03.000Z",
      durationMs: 3000,
      outcome: "ok",
    })],
    jobs: [{
      id: jobId,
      projectId: "wb_123456789abc",
      runId,
      candidateId,
      kind: "execute",
      status: "succeeded",
      attempt: 0,
      createdAt,
      updatedAt: "2026-05-28T00:00:03.000Z",
      startedAt: "2026-05-28T00:00:01.000Z",
      finishedAt: "2026-05-28T00:00:03.000Z",
      input: { execution: { purpose: "attempt" } },
      output: { ok: true },
    }],
    executionFiles: [{
      jobId,
      files: [textFile("workbench-result.json", "{\"score\":1}\n")],
    }],
    events: [{
      id: `evt_${runId}`,
      at: "2026-05-28T00:00:03.000Z",
      type: "run_finished",
      runId,
      candidateId,
      detail: { outcome: "ok" },
    }],
  };
}

function expectTargetOriginKeys(origin: Record<string, unknown>): void {
  expect(Object.keys(origin).sort()).toEqual([
    "baseUrl",
    "linkedAt",
    "projectId",
    "remote",
    "runtimeFingerprint",
    "sourceFingerprint",
    "sourceRevisionId",
  ]);
}

async function writeDockerNodeWorkbenchSpec(
  workspace: string,
  result: Record<string, unknown> = {
    score: 0.5,
    summary: "Starter local Workbench run completed.",
    fileChanges: ["prompt.md"],
  },
): Promise<void> {
  const runnerCommand = JSON.stringify("node run.js");
  const improveCommand = JSON.stringify("node -e \"process.exit(1)\"");
  const resultPayload = Buffer.from(JSON.stringify(result), "utf8").toString("base64");
  const scoreCommand = JSON.stringify(`node -e "const fs=require('fs'),path=require('path');const out='/workspace/output';fs.mkdirSync(out,{recursive:true});const result=JSON.parse(Buffer.from('${resultPayload}','base64').toString('utf8'));fs.writeFileSync(path.join(out,'workbench-result.json'),JSON.stringify({protocol:'workbench.adapter-result.v1',operation:'engine.run',ok:true,value:result},null,2));"`);
  await writeFile(path.join(workspace, "benchmark.yaml"), [
    "version: 4",
    "name: local-workbench",
    "description: Exercise the local command-based Workbench development path.",
    "engine:",
    "  use: workbench",
    "  with:",
    "    environment:",
    "      dockerfile: environment/Dockerfile",
    "    score:",
    "      use: command",
    "      with:",
    `        command: ${scoreCommand}`,
    "",
  ].join("\n"));
  await mkdir(path.join(workspace, "candidates", "current", "files"), { recursive: true });
  await writeFile(path.join(workspace, "candidates", "current", "candidate.yaml"), [
    "version: 4",
    "name: local-command-eval",
    "files:",
    "  path: files",
    "prepare:",
    "  command: sh input/candidate/prepare.sh",
    "defaultRun: main",
    "runs:",
    "  main:",
    "    name: Command",
    "    use: command",
    "    with:",
    `      command: ${runnerCommand}`,
    "improve:",
    "  edits:",
    "    - run.js",
    "  use: command",
    "  with:",
    `    command: ${improveCommand}`,
    "",
  ].join("\n"));
  await writeFile(path.join(workspace, "candidates", "current", "files", "prepare.sh"), "#!/usr/bin/env sh\nset -eu\ncp -R input/candidate/. .\n");
  await writeFile(path.join(workspace, "candidates", "current", "files", "run.js"), "const fs=require('fs'),path=require('path');const out='/workspace/output';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'runner-summary.md'),'runner completed\\n');\n");
}

async function appendCandidateAdapters(
  workspace: string,
  sources: readonly string[],
): Promise<void> {
  const specPath = commandCandidateSpecPath(workspace);
  const source = await readFile(specPath, "utf8");
  await writeFile(specPath, [
    source.trimEnd(),
    "adapters:",
    ...sources.map((entry) => `  - ${entry}`),
    "",
  ].join("\n"));
}

function commandCandidateSpecPath(workspace: string): string {
  return path.join(workspace, "candidates", "current", "candidate.yaml");
}

function commandImproveSpecPath(workspace: string): string {
  return commandCandidateSpecPath(workspace);
}

async function writeFakeCodexHome(
  codexHome: string,
  workspace: string,
): Promise<void> {
  const sessionDir = path.join(codexHome, "sessions", "2026", "05", "20");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    path.join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({
      id: "codex-thread-1",
      thread_name: "Inspect repo and run tests",
      updated_at: "2026-05-20T10:04:00.000Z",
    })}\n`,
  );
  await writeFile(
    path.join(sessionDir, "rollout-2026-05-20T10-00-00-codex.jsonl"),
    [
      {
        timestamp: "2026-05-20T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-thread-1",
          timestamp: "2026-05-20T10:00:00.000Z",
          cwd: workspace,
        },
      },
      {
        timestamp: "2026-05-20T10:01:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Inspect the repo and run the focused test." }],
        },
      },
      {
        timestamp: "2026-05-20T10:02:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "I will run the test." }],
        },
      },
      {
        timestamp: "2026-05-20T10:03:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "functions.exec_command",
          call_id: "call-codex-1",
          arguments: JSON.stringify({ cmd: "pnpm test", workdir: workspace }),
        },
      },
      {
        timestamp: "2026-05-20T10:04:00.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call-codex-1",
          command: ["/bin/sh", "-lc", "pnpm test"],
          cwd: workspace,
          result: { exit_code: 0 },
          aggregated_output: "tests passed",
        },
      },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
}

async function writeExtraFakeCodexSession(
  codexHome: string,
  workspace: string,
): Promise<void> {
  const sessionDir = path.join(codexHome, "sessions", "2026", "05", "20");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    path.join(sessionDir, "rollout-2026-05-20T10-05-00-codex.jsonl"),
    [
      {
        timestamp: "2026-05-20T10:05:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-thread-2",
          timestamp: "2026-05-20T10:05:00.000Z",
          cwd: workspace,
        },
      },
      {
        timestamp: "2026-05-20T10:06:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Inspect another local trace." }],
        },
      },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
}

async function writeFakeClaudeHome(
  claudeHome: string,
  workspace: string,
): Promise<void> {
  const projectRoot = path.join(claudeHome, ".claude", "projects", "-tmp-workspace");
  const sessionPath = path.join(projectRoot, "claude-session-1.jsonl");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    path.join(projectRoot, "sessions-index.json"),
    `${JSON.stringify({
      version: 1,
      originalPath: workspace,
      entries: [{
        sessionId: "claude-session-1",
        fullPath: sessionPath,
        firstPrompt: "Fix the failing test and validate lint.",
        summary: "Fix failing test",
        created: "2026-05-20T11:00:00.000Z",
        modified: "2026-05-20T11:03:00.000Z",
        projectPath: workspace,
      }],
    }, null, 2)}\n`,
  );
  await writeFile(
    sessionPath,
    [
      {
        type: "user",
        timestamp: "2026-05-20T11:00:00.000Z",
        sessionId: "claude-session-1",
        cwd: workspace,
        message: {
          role: "user",
          content: "Fix the failing test and validate lint.",
        },
      },
      {
        type: "assistant",
        timestamp: "2026-05-20T11:01:00.000Z",
        sessionId: "claude-session-1",
        cwd: workspace,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I will run lint first." },
            {
              type: "tool_use",
              id: "tool-claude-1",
              name: "Bash",
              input: { command: "pnpm lint", cwd: workspace },
            },
          ],
        },
      },
      {
        type: "user",
        timestamp: "2026-05-20T11:02:00.000Z",
        sessionId: "claude-session-1",
        cwd: workspace,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-claude-1",
              content: "lint passed",
            },
          ],
        },
      },
      {
        type: "assistant",
        timestamp: "2026-05-20T11:03:00.000Z",
        sessionId: "claude-session-1",
        cwd: workspace,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Lint passed." }],
        },
      },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
}

describe("workbench CLI", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("help advertises repo-like workflows and hosted placement flags", async () => {
    const io = createIo();
    const exitCode = await runCli(["--help"], io);

    expect(exitCode).toBe(0);
    expect(io.stdoutText()).toContain("workbench push [SOURCE] [--dir DIR]");
    expect(io.stdoutText()).toContain("workbench clone OWNER/BENCHMARK");
    expect(io.stdoutText()).toContain("workbench pull [--dir DIR]");
    expect(io.stdoutText()).toContain("workbench init");
    expect(io.stdoutText()).toContain("workbench check [SOURCE] [--dir DIR]");
    expect(io.stdoutText()).toContain("workbench eval --hosted [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK] [--candidate CANDIDATE_ID]");
    expect(io.stdoutText()).toContain("workbench improve [SOURCE] [--dir DIR] [--from CANDIDATE_ID]");
    expect(io.stdoutText()).toContain("workbench improve --hosted [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK] [--base CANDIDATE_ID]");
    expect(io.stdoutText()).toContain("workbench retry TARGET_ID [--dir DIR]");
    expect(io.stdoutText()).toContain("workbench adapters test ID|SOURCE");
    expect(io.stdoutText()).toContain("workbench open [SOURCE|OWNER/BENCHMARK|RUN_ID|CANDIDATE_ID]");
    expect(io.stdoutText()).toContain("workbench retry TARGET_ID [--dir DIR] [--hosted]");
    expect(io.stdoutText()).not.toContain("workbench cloud");
    expect(io.stdoutText()).not.toContain("workbench fetch");
    expect(io.stdoutText()).not.toContain("workbench remote");
    expect(io.stdoutText()).not.toContain("workbench sync");
    expect(io.stdoutText()).toContain("Workbench project containing benchmark.yaml plus candidates/<name>/candidate.yaml");
    expect(io.stdoutText()).toContain("Candidate manifests declare their files with files.path");
    expect(io.stdoutText()).toContain("WORKBENCH_API_URL");
    expect(io.stdoutText()).toContain("https://v2.workbench.ai");
  });

  test("version reports the package manifest version", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(packageRoot, "package.json"), "utf8"),
    ) as { version: string };
    const io = createIo();

    expect(await runCli(["--version"], io)).toBe(0);
    expect(io.stdoutText()).toBe(`workbench ${manifest.version}\n`);
  });

  test("command help is scoped for project and hosted commands", async () => {
    const openIo = createIo();
    expect(await runCli(["open", "--help"], openIo)).toBe(0);
    expect(openIo.stdoutText()).toContain("workbench open [SOURCE] [--dir DIR]");
    expect(openIo.stdoutText()).toContain("workbench open --hosted");
    expect(openIo.stdoutText()).toContain("--run RUN_ID");
    expect(openIo.stdoutText()).toContain("Workbench project containing benchmark.yaml plus candidates/<name>/candidate.yaml");
    expect(openIo.stdoutText()).toContain("Keep this command running while using the local web view");
    const evalIo = createIo();
    expect(await runCli(["eval", "--help"], evalIo)).toBe(0);
    expect(evalIo.stdoutText()).toContain("workbench eval --hosted");
    expect(evalIo.stdoutText()).toContain("Stopping this command does not cancel the hosted run");
    const retryIo = createIo();
    expect(await runCli(["retry", "--help"], retryIo)).toBe(0);
    expect(retryIo.stdoutText()).toContain("workbench retry TARGET_ID");
    expect(retryIo.stdoutText()).toContain("workbench retry --hosted TARGET_ID");
    const adapterTestIo = createIo();
    expect(await runCli(["adapters", "test", "--help"], adapterTestIo)).toBe(0);
    expect(adapterTestIo.stdoutText()).toContain("workbench adapters test ID|SOURCE");
    expect(adapterTestIo.stdoutText()).toContain("replay");
    const loginIo = createIo();
    expect(await runCli(["login", "--help"], loginIo)).toBe(0);
    expect(loginIo.stdoutText()).not.toContain("Bare project commands target the current directory.");
    const cloudIo = createIo();
    expect(await runCli(["cloud", "--help"], cloudIo)).toBe(2);
    expect(cloudIo.stderrText()).toContain("Unknown command: cloud");
    const fetchIo = createIo();
    expect(await runCli(["fetch", "--help"], fetchIo)).toBe(2);
    expect(fetchIo.stderrText()).toContain("Unknown command: fetch");
    const remoteIo = createIo();
    expect(await runCli(["remote", "--help"], remoteIo)).toBe(2);
    expect(remoteIo.stderrText()).toContain("Unknown command: remote");
  });

  test("agent-facing command help includes concrete examples", async () => {
    const commands = [
      ["traces", "show", "--help"],
      ["auth", "connect", "--help"],
      ["adapters", "create", "--help"],
      ["eval", "--help"],
      ["improve", "--help"],
      ["open", "--help"],
    ];

    for (const command of commands) {
      const io = createIo();
      expect(await runCli(command, io)).toBe(0);
      expect(io.stdoutText()).toContain("Examples:");
      expect(io.stdoutText()).toContain(`workbench ${command.filter((part) => part !== "--help").join(" ")}`);
    }
  });

  test("local run controls validate before project source resolution", async () => {
    const evalIo = createIo();
    expect(await runCli([
      "eval",
      "--dir",
      path.join(os.tmpdir(), "workbench-missing-project"),
      "--samples",
      "0",
      "--json",
    ], evalIo)).toBe(2);
    expect(JSON.parse(evalIo.stdoutText())).toMatchObject({
      ok: false,
      error: "--samples must be a positive integer.",
    });

    const improveIo = createIo();
    expect(await runCli([
      "improve",
      "--dir",
      path.join(os.tmpdir(), "workbench-missing-project"),
      "--budget",
      "0",
      "--json",
    ], improveIo)).toBe(2);
    expect(JSON.parse(improveIo.stdoutText())).toMatchObject({
      ok: false,
      error: "--budget must be a positive integer.",
    });
  });

  test("check resolves built-in adapter commands without package-manager PATH entries", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-stripped-path-check-"));
    expect(await runCli(["init", workspace, "--skill", "path-check", "--agent", "codex", "--json"], createIo())).toBe(0);
    vi.stubEnv("PATH", "/usr/bin:/bin");

    const io = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], io)).toBe(0);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      ok: true,
      errors: [],
    });
  });

  test("traces collect recovers local Codex and Claude sessions as stdout JSON digests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-traces-"));
    const workspace = path.join(root, "workspace");
    const codexHome = path.join(root, "codex-home");
    const claudeHome = path.join(root, "claude-home");
    await mkdir(workspace, { recursive: true });
    await writeFakeCodexHome(codexHome, workspace);
    await writeFakeClaudeHome(claudeHome, workspace);
    vi.stubEnv("CODEX_HOME", codexHome);
    vi.stubEnv("AGENT_RUNTIME_CLAUDE_HOME", claudeHome);

    const io = createIo();
    const cwd = process.cwd();
    try {
      process.chdir(root);
      expect(await runCli([
        "traces",
        "collect",
        "--providers",
        "codex,claude",
        "--workspace",
        workspace,
        "--limit",
        "10",
        "--json",
      ], io)).toBe(0);
    } finally {
      process.chdir(cwd);
    }

    const summary = JSON.parse(io.stdoutText()) as {
      ok: boolean;
      traceCount: number;
      limitPerProvider: number;
      limitedProviders: string[];
      providers: Record<string, number>;
      traces: Array<{
        provider: string;
        goal: string;
        source: { path: string };
        artifacts: { commands: string[] };
        timeline: Array<{ type: string }>;
      }>;
    };
    expect(summary.ok).toBe(true);
    expect(summary.traceCount).toBe(2);
    expect(summary.limitPerProvider).toBe(10);
    expect(summary.limitedProviders).toEqual([]);
    expect(summary.providers.codex).toBe(1);
    expect(summary.providers.claude).toBe(1);
    expect(summary.traces).toHaveLength(2);
    await expect(stat(path.join(root, ".workbench", "local-traces"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const codexDigest = summary.traces.find((digest) => digest.provider === "codex");
    const claudeDigest = summary.traces.find((digest) => digest.provider === "claude");
    expect(codexDigest).toBeTruthy();
    expect(claudeDigest).toBeTruthy();
    if (!codexDigest || !claudeDigest) {
      throw new Error("Expected both Codex and Claude trace digests.");
    }
    expect(codexDigest.provider).toBe("codex");
    expect(codexDigest.goal).toContain("Inspect the repo");
    expect(codexDigest.source.path).toContain("rollout-2026-05-20T10-00-00-codex.jsonl");
    expect(codexDigest.artifacts.commands.join("\n")).toContain("pnpm test");
    expect(codexDigest.timeline.some((entry) => entry.type === "tool")).toBe(true);
    expect(claudeDigest.provider).toBe("claude");
    expect(claudeDigest.goal).toContain("Fix the failing test");
    expect(claudeDigest.artifacts.commands.join("\n")).toContain("pnpm lint");
    expect(claudeDigest.timeline.some((entry) => entry.type === "assistant")).toBe(true);

    await rm(root, { recursive: true, force: true });
  });

  test("traces collect reports providers capped by the limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-traces-limit-"));
    const workspace = path.join(root, "workspace");
    const codexHome = path.join(root, "codex-home");
    await mkdir(workspace, { recursive: true });
    await writeFakeCodexHome(codexHome, workspace);
    await writeExtraFakeCodexSession(codexHome, workspace);
    vi.stubEnv("CODEX_HOME", codexHome);

    const jsonIo = createIo();
    expect(await runCli([
      "traces",
      "collect",
      "--providers",
      "codex",
      "--workspace",
      workspace,
      "--limit",
      "1",
      "--json",
    ], jsonIo)).toBe(0);
    const summary = JSON.parse(jsonIo.stdoutText()) as {
      traceCount: number;
      limitPerProvider: number;
      limitedProviders: string[];
    };
    expect(summary.traceCount).toBe(1);
    expect(summary.limitPerProvider).toBe(1);
    expect(summary.limitedProviders).toEqual(["codex"]);

    const textIo = createIo();
    expect(await runCli([
      "traces",
      "collect",
      "--providers",
      "codex",
      "--workspace",
      workspace,
      "--limit",
      "1",
    ], textIo)).toBe(0);
    expect(textIo.stdoutText()).toContain(
      "Limited to latest 1 trace per provider; more matching traces exist for codex. Rerun with --limit N to include more.",
    );

    await rm(root, { recursive: true, force: true });
  });

  test("traces show resolves exact ids without a list limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-traces-show-"));
    const workspace = path.join(root, "workspace");
    const codexHome = path.join(root, "codex-home");
    await mkdir(workspace, { recursive: true });
    await writeFakeCodexHome(codexHome, workspace);
    await writeExtraFakeCodexSession(codexHome, workspace);
    vi.stubEnv("CODEX_HOME", codexHome);

    const wideListIo = createIo();
    expect(await runCli([
      "traces",
      "list",
      "--providers",
      "codex",
      "--workspace",
      workspace,
      "--limit",
      "2",
      "--json",
    ], wideListIo)).toBe(0);
    const wideList = JSON.parse(wideListIo.stdoutText()) as {
      traces: Array<{ traceId: string; goal?: string }>;
    };
    const olderTrace = wideList.traces.find((trace) => trace.goal?.includes("Inspect the repo"));
    expect(olderTrace).toBeTruthy();
    if (!olderTrace) {
      throw new Error("Expected older Codex trace.");
    }

    const narrowListIo = createIo();
    expect(await runCli([
      "traces",
      "list",
      "--providers",
      "codex",
      "--workspace",
      workspace,
      "--limit",
      "1",
      "--json",
    ], narrowListIo)).toBe(0);
    const narrowList = JSON.parse(narrowListIo.stdoutText()) as {
      traces: Array<{ traceId: string }>;
    };
    expect(narrowList.traces.some((trace) => trace.traceId === olderTrace.traceId)).toBe(false);

    const showIo = createIo();
    expect(await runCli([
      "traces",
      "show",
      olderTrace.traceId,
      "--providers",
      "codex",
      "--workspace",
      workspace,
      "--json",
    ], showIo)).toBe(0);
    const showSummary = JSON.parse(showIo.stdoutText()) as {
      ok: boolean;
      trace: { traceId: string; goal?: string };
    };
    expect(showSummary.ok).toBe(true);
    expect(showSummary).not.toHaveProperty("limitPerProvider");
    expect(showSummary.trace.traceId).toBe(olderTrace.traceId);
    expect(showSummary.trace.goal).toContain("Inspect the repo");

    const limitIo = createIo();
    expect(await runCli([
      "traces",
      "show",
      olderTrace.traceId,
      "--providers",
      "codex",
      "--workspace",
      workspace,
      "--limit",
      "1",
    ], limitIo)).toBe(2);
    const limitOutput = `${limitIo.stdoutText()}${limitIo.stderrText()}`;
    expect(limitOutput).toContain("Unsupported flag: --limit");
    expect(limitOutput).toContain("workbench traces show TRACE_ID");
    expect(limitOutput).not.toContain("workbench init [DIR]");

    await rm(root, { recursive: true, force: true });
  });

  test("traces list and show provide trace triage without full batch payloads", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-traces-triage-"));
    const workspace = path.join(root, "workspace");
    const codexHome = path.join(root, "codex-home");
    const claudeHome = path.join(root, "claude-home");
    await mkdir(workspace, { recursive: true });
    await writeFakeCodexHome(codexHome, workspace);
    await writeFakeClaudeHome(claudeHome, workspace);
    vi.stubEnv("CODEX_HOME", codexHome);
    vi.stubEnv("AGENT_RUNTIME_CLAUDE_HOME", claudeHome);

    const listIo = createIo();
    expect(await runCli([
      "traces",
      "list",
      "--workspace",
      workspace,
      "--limit",
      "1",
      "--json",
    ], listIo)).toBe(0);
    const listSummary = JSON.parse(listIo.stdoutText()) as {
      ok: boolean;
      traceCount: number;
      limitPerProvider: number;
      limitedProviders: string[];
      traces: Array<{
        provider: string;
        traceId: string;
        goal?: string;
        timeline?: unknown;
        counts: { toolEvents: number };
        artifacts: { commands: string[] };
      }>;
    };
    expect(listSummary.ok).toBe(true);
    expect(listSummary.traceCount).toBe(2);
    expect(listSummary.limitPerProvider).toBe(1);
    expect(listSummary.limitedProviders).toEqual([]);
    expect(listSummary.traces).toHaveLength(2);
    expect(listSummary.traces[0]).not.toHaveProperty("timeline");
    const codexItem = listSummary.traces.find((trace) => trace.provider === "codex");
    expect(codexItem?.goal).toContain("Inspect the repo");
    expect(codexItem?.artifacts.commands.join("\n")).toContain("pnpm test");

    const textIo = createIo();
    expect(await runCli([
      "traces",
      "list",
      "--providers",
      "codex",
      "--workspace",
      workspace,
      "--limit",
      "1",
    ], textIo)).toBe(0);
    expect(textIo.stdoutText()).toContain("Run `workbench traces show TRACE_ID --json`");

    if (!codexItem) {
      throw new Error("Expected Codex trace list item.");
    }
    const showIo = createIo();
    expect(await runCli([
      "traces",
      "show",
      codexItem.traceId,
      "--providers",
      "codex,claude",
      "--workspace",
      workspace,
      "--json",
    ], showIo)).toBe(0);
    const showSummary = JSON.parse(showIo.stdoutText()) as {
      ok: boolean;
      trace: {
        traceId: string;
        provider: string;
        timeline: Array<{ type: string }>;
      };
    };
    expect(showSummary.ok).toBe(true);
    expect(showSummary.trace.traceId).toBe(codexItem.traceId);
    expect(showSummary.trace.provider).toBe("codex");
    expect(showSummary.trace.timeline.some((entry) => entry.type === "tool")).toBe(true);

    await rm(root, { recursive: true, force: true });
  });

  test("traces collect rejects string flags without values", async () => {
    const io = createIo();
    expect(await runCli(["traces", "collect", "--providers"], io)).toBe(2);
    expect(io.stderrText()).toContain("--providers requires a value.");
  });

  test("rejects invalid hosted flags", async () => {
    const watchIo = createIo();
    expect(await runCli(["eval", "--hosted", "--interval-ms", "10", "--json"], watchIo)).toBe(2);
    expect(watchIo.stdoutText()).toContain("--interval-ms and --timeout-ms require --watch");
  });

  test("hosted dry-runs do not require remote benchmark lookup", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-hosted-dry-run-"));
    expect(await runCli(["init", workspace, "--skill", "dry-run", "--agent", "codex", "--json"], createIo())).toBe(0);
    const localSourceIo = createIo();
    expect(await runCli(["check", "--dir", workspace, "candidates/current", "--json"], localSourceIo)).toBe(0);
    expect(JSON.parse(localSourceIo.stdoutText())).toMatchObject({ ok: true });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const evalIo = createIo();
    expect(await runCli([
      "eval",
      "--hosted",
      "--dir",
      workspace,
      "--benchmark",
      "owner/name",
      "--dry-run",
      "--json",
    ], evalIo)).toBe(0);
    expect(JSON.parse(evalIo.stdoutText())).toMatchObject({
      ok: true,
      dryRun: true,
      projectRef: "owner/name",
      request: {
        workflow: "eval",
        samples: 1,
      },
    });
    const nestedSourceIo = createIo();
    expect(await runCli([
      "eval",
      "--hosted",
      "--dir",
      workspace,
      "candidates/current",
      "--benchmark",
      "owner/name",
      "--dry-run",
      "--json",
    ], nestedSourceIo)).toBe(0);
    expect(JSON.parse(nestedSourceIo.stdoutText())).toMatchObject({
      ok: true,
      dryRun: true,
      projectRef: "owner/name",
      dir: workspace,
      request: {
        workflow: "eval",
        samples: 1,
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("hosted benchmark refs do not accept pruned tag syntax", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-hosted-ref-"));
    expect(await runCli(["init", workspace, "--skill", "ref", "--agent", "codex", "--json"], createIo())).toBe(0);

    const io = createIo();
    expect(await runCli([
      "eval",
      "--hosted",
      "--dir",
      workspace,
      "--benchmark",
      "owner/name@v1",
      "--dry-run",
      "--json",
    ], io)).toBe(2);
    expect(io.stdoutText()).toContain("Benchmark refs must use OWNER/BENCHMARK.");
  });

  test("keeps command docs aligned with the public CLI registry", async () => {
    const commandLines = rootUsage
      .split("\nExamples:")[0]!
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("workbench ") && !line.includes("<command>"));
    const cliDocs = await readFile(path.join(productRoot, "docs", "cli.md"), "utf8");
    const spec = await readFile(path.join(productRoot, "SPEC.md"), "utf8");

    for (const command of commandLines) {
      expect(cliDocs).toContain(command);
    }
    expect(spec).toContain("workbench eval [SOURCE] [--dir DIR] [--candidate CANDIDATE_ID]");
    expect(spec).toContain("workbench eval --hosted [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK] [--candidate CANDIDATE_ID]");
    expect(spec).not.toContain("workbench eval --hosted [SOURCE] [--dir DIR] [--benchmark OWNER/BENCHMARK] [--base CANDIDATE_ID]");
    expect(spec).toContain("workbench candidates list|show|files|preview");
    expect(spec).toContain("candidates/<name>/candidate.yaml");
  });

  test("keeps public onboarding, skill metadata, and eval prompts aligned with current hosted paths", async () => {
    const webRoot = path.resolve(productRoot, "..", "workbench-cloud");
    const [
      getStartedSection,
      startTabs,
      cliDocs,
      skill,
      manifestRaw,
      agentYaml,
      skillEvalsRaw,
    ] = await Promise.all([
      readFile(path.join(webRoot, "components", "get-started-section.tsx"), "utf8"),
      readFile(path.join(webRoot, "components", "workbench-start-tabs.tsx"), "utf8"),
      readFile(path.join(productRoot, "docs", "cli.md"), "utf8"),
      readFile(path.join(productRoot, "skills", "workbench", "SKILL.md"), "utf8"),
      readFile(path.join(productRoot, "skills.json"), "utf8"),
      readFile(path.join(productRoot, "skills", "workbench", "agents", "openai.yaml"), "utf8"),
      readFile(path.join(productRoot, "skills", "workbench", "evals", "evals.json"), "utf8"),
    ]);
    const manifest = JSON.parse(manifestRaw) as {
      skills: Array<{ useCases: string[] }>;
    };
    const skillEvals = JSON.parse(skillEvalsRaw) as {
      evals: Array<{
        id: string;
        expected_output: string;
        assertions: Array<{ value?: string }>;
      }>;
    };
    const installEval = skillEvals.evals.find((entry) => entry.id === "install-or-verify-cli");

    const onboardingSource = `${getStartedSection}\n${startTabs}`;
    expect(onboardingSource).toContain("npx skills add workbench-ai/workbench");
    expect(onboardingSource).toContain("npm install -g @workbench-ai/workbench");
    expect(onboardingSource).toContain("workbench --version");
    expect(onboardingSource).toContain("workbench clone official/three-statement-demo");
    expect(onboardingSource).toContain("workbench check");
    expect(onboardingSource).toContain("workbench push");
    expect(onboardingSource).toContain("workbench improve --hosted candidates/current");
    expect(onboardingSource).toContain("--budget 1 --samples 1 --watch");
    expect(onboardingSource).not.toContain("workbench eval candidates/current --samples 1");
    expect(onboardingSource).not.toContain("workbench cloud");
    expect(onboardingSource).not.toContain("workbench auth connect codex --method oauth");
    expect(onboardingSource).not.toContain("workbench whoami --json # provider status");
    expect(cliDocs).toContain("workbench init [DIR] --skill NAME --agent ADAPTER");
    expect(cliDocs).toContain("workbench clone official/three-statement-demo");
    expect(cliDocs).not.toContain("workbench eval candidates/current --samples 1");
    expect(cliDocs).toContain("workbench improve --budget 1 --samples 1");
    expect(cliDocs).toContain("workbench improve --hosted candidates/current --budget 1 --samples 1 --watch");
    expect(cliDocs).toContain("For hosted eval, use `--candidate CANDIDATE_ID`");
    expect(cliDocs).toContain("workbench improve --hosted candidates/codex --base CANDIDATE_ID --budget 1 --samples 1 --watch");
    expect(cliDocs).toContain("workbench push");
    expect(cliDocs).not.toContain("--tag");
    expect(cliDocs).not.toContain("workbench cloud");
    expect(cliDocs).not.toContain("workbench fetch");
    expect(cliDocs).not.toContain("workbench remote");
    expect(cliDocs).toContain("candidate files are declared explicitly with `files: { path: files }`");
    expect(skill).toContain("workbench init --skill my-eval --agent codex");
    expect(skill).toContain("workbench clone official/three-statement-demo");
    expect(skill).not.toContain("workbench eval candidates/current --samples 1");
    expect(skill).toContain("workbench improve --budget 1 --samples 1");
    expect(skill).toContain("workbench improve --hosted candidates/current --budget 1 --samples 1 --watch");
    expect(skill).toContain("For hosted eval, pass `--candidate CANDIDATE_ID`");
    expect(skill).toContain("workbench improve --hosted candidates/codex --base candidate_123 --budget 1 --samples 1 --watch");
    expect(skill).not.toContain("@v1");
    expect(skill).not.toContain("workbench cloud");
    expect(skill).not.toContain("workbench fetch");
    expect(skill).toContain("candidates/<name>/candidate.yaml");
    expect(skill).toContain("workbench open --json --no-open");
    expect(skillEvalsRaw).not.toContain("workbench cloud");
    expect(skillEvalsRaw).not.toContain("cloud candidates");
    expect(skillEvalsRaw).not.toContain("Sync snapshots");
    expect(skillEvalsRaw).not.toContain("hosted candidate snapshot");
    expect(agentYaml).toContain("official/three-statement-demo");
    expect(agentYaml).toContain("workbench check");
    expect(agentYaml).not.toContain("run a local eval");
    expect(agentYaml).toContain("push the checkout");
    expect(manifest.skills[0]?.useCases.join("\n")).toContain("workbench init --skill NAME --agent ADAPTER");
    expect(manifest.skills[0]?.useCases.join("\n")).toContain("official/three-statement-demo");
    expect(manifest.skills[0]?.useCases.join("\n")).toContain("embedded browser");
    expect(manifest.skills[0]?.useCases.join("\n")).toContain("workbench open --json --no-open");
    expect(installEval?.expected_output).toContain("installs the published package");
    expect(installEval?.assertions.some((assertion) => assertion.value?.includes("@workbench-ai/workbench"))).toBe(true);
    expect(skillEvalsRaw).toContain("opens or returns the Workbench Cloud benchmark URL");
    expect(skillEvalsRaw).toContain("opens or returns the resulting candidate URL");
    expect(skillEvalsRaw).toContain("opens or returns the read-only local Workbench URL");
  });

  test("local source development uses Docker and fails closed without templates", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-local-"));
    const initIo = createIo();
    const validateIo = createIo();
    const runIo = createIo();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    expect(await runCli(["init", workspace, "--command", "local-command-eval", "--json"], initIo)).toBe(0);
    await writeDockerNodeWorkbenchSpec(workspace);
    expect(await runCli(["check", "--dir", workspace, "--json"], validateIo)).toBe(0);
    const fileValidateIo = createIo();
    expect(await runCli(["check", commandCandidateSpecPath(workspace), "--json"], fileValidateIo)).toBe(0);
    const validation = JSON.parse(validateIo.stdoutText()) as {
      plan?: {
        benchmarkName?: string;
        benchmarkDescription?: string;
        source?: { files?: number; dockerfile?: string };
        candidate?: { filesPath?: string; files?: number; selectedRunId?: string; runCount?: number; improve?: { edits?: string[] } };
        tasks?: { source?: { use?: string }; path?: string; cases?: number; files?: number };
        environment?: {
          network?: { egress?: string };
          resources?: { cpu?: number; memoryGb?: number; timeoutMinutes?: number };
        };
        adapters?: {
          improve?: { use?: string };
          run?: { use?: string; command?: string };
          engine?: { use?: string; command?: string };
        };
      };
    };
    expect(validation.plan?.benchmarkName).toBe("local-workbench");
    expect(validation.plan?.benchmarkDescription).toBe("Exercise the local command-based Workbench development path.");
    expect(validation.plan?.source?.dockerfile).toBe("environment/Dockerfile");
    expect(validation.plan?.candidate).toMatchObject({
      filesPath: "candidates/current/files",
      files: 2,
      selectedRunId: "main",
      runCount: 1,
    });
    expect(validation.plan?.engine).toMatchObject({
      resolver: { use: "workbench" },
      path: "tasks",
      cases: 1,
    });
    expect(validation.plan?.environment?.network?.egress).toBe("open");
    expect(validation.plan?.environment?.resources?.timeoutMinutes).toBe(20);
    expect(validation.plan?.adapters?.improve?.use).toBe("command");
    expect(validation.plan?.adapters?.run?.use).toBe("command");
    expect(validation.plan?.adapters?.run?.command).toBe("node run.js");
    expect(validation.plan?.adapters?.engine?.use).toBe("workbench");
    const baseId = await seedLocalCandidate(workspace);
    expect(await runCli([
      "improve",
      commandCandidateSpecPath(workspace),
      "--from",
      baseId,
      "--budget",
      "1",
      "--samples",
      "2",
      "--json",
    ], runIo)).toBe(1);

    const run = JSON.parse(runIo.stdoutText()) as {
      ok?: boolean;
      error?: string;
      completedJobCount?: number;
      failedJobCount?: number;
      activeCandidateId?: string | null;
      localView?: { command?: string; note?: string };
    };
    if (run.error) {
      expect(run.ok).toBe(false);
      expect(run.error).toMatch(/docker/i);
    } else {
      expect(run.ok).toBe(false);
      expect(run.completedJobCount).toBe(0);
      expect(run.failedJobCount).toBe(1);
      expect(run.activeCandidateId).toBe(baseId);
      expect(run.localView?.command).toContain("workbench open --dir");
      expect(run.localView?.command).toContain("--run");
      expect(run.localView?.note).toContain("Keep this command running while using the local web view");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  test("local improve defaults to the evaluated active candidate", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-local-improve-active-"));
    expect(await runCli(["init", workspace, "--command", "local-command-eval", "--json"], createIo())).toBe(0);
    await writeDockerNodeWorkbenchSpec(workspace);
    const projectSource = await readLocalProjectSource(workspace);
    const benchmarkFingerprint = localBenchmarkFingerprint(projectSource);
    const executionFingerprint = workbenchRunExecutionFingerprint({
      sourceYaml: projectSource.specSource,
      adapterFiles: normalizeSurfaceFiles(projectSource.adapterFiles),
    });
    const activeId = "candidate_active_001";
    const authoredId = "candidate_authored_001";
    const activeCandidate: CandidateRecord = {
      id: activeId,
      version: 1,
      ordinal: 1,
      benchmarkFingerprint,
      candidateFingerprint: "active-candidate-fingerprint",
      visibility: "private",
      createdAt: "2026-05-29T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: ["run.js"],
    };
    const authoredCandidate: CandidateRecord = {
      ...activeCandidate,
      id: authoredId,
      version: 2,
      ordinal: 2,
      candidateFingerprint: localCandidateFingerprint(projectSource),
      createdAt: "2026-05-29T00:01:00.000Z",
    };
    await saveLocalArchive(workspace, {
      activeId,
      candidates: [activeCandidate, authoredCandidate],
      candidateFiles: {
        [activeId]: [textFile("run.js", "console.log('active')\n")],
        [authoredId]: [textFile("run.js", "console.log('authored')\n")],
      },
      evaluations: [],
      runs: [localRunSummary({
        id: "run_active_reuse",
        workflow: "improve",
        benchmarkFingerprint,
        candidateId: activeId,
        candidateRunId: projectSource.spec.candidate.selectedRunId,
        candidateRunName: projectSource.spec.candidate.selectedRunName,
        executionFingerprint,
        budget: 1,
        samples: 1,
        status: "finished",
        outcome: "ok",
        outputCandidateId: activeId,
        activeCandidateId: activeId,
        finishedAt: "2026-05-29T00:02:00.000Z",
      })],
      events: [],
    });

    const io = createIo();
    expect(await runCli(["improve", "--dir", workspace, "--budget", "1", "--samples", "1", "--json"], io)).toBe(0);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      ok: true,
      reused: true,
      runId: "run_active_reuse",
      outputCandidateId: activeId,
      activeCandidateId: activeId,
    });
    expect((await loadLocalArchive(workspace)).activeId).toBe(activeId);
  });

  test("check reports binary environment egress and rejects legacy allowlist", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-cli-network-"));
    expect(await runCli(["init", workspace, "--command", "local-command-eval", "--json"], createIo())).toBe(0);
    await writeDockerNodeWorkbenchSpec(workspace);
    const benchmarkPath = path.join(workspace, "benchmark.yaml");
    const authored = await readFile(benchmarkPath, "utf8");
    await writeFile(benchmarkPath, authored.replace(
      "      dockerfile: environment/Dockerfile",
      "      dockerfile: environment/Dockerfile\n      network:\n        egress: none",
    ));

    const noEgressIo = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], noEgressIo)).toBe(0);
    const noEgress = JSON.parse(noEgressIo.stdoutText()) as {
      plan?: { environment?: { network?: { egress?: string } } };
    };
    expect(noEgress.plan?.environment?.network?.egress).toBe("none");

    await writeFile(benchmarkPath, (await readFile(benchmarkPath, "utf8")).replace(
      "        egress: none",
      "        egress: allowlist",
    ));
    const allowlistIo = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], allowlistIo)).toBe(1);
    expect(allowlistIo.stdoutText()).toContain("benchmark.yaml.engine.with.environment.network.egress must be none or open.");
  });

  test.skipIf(!loopbackAvailable)("local dev browser server exposes source and archive DTOs", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-dev-open-"));
    const assetsRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-dev-open-assets-"));
    expect(await runCli(["init", workspace, "--command", "local-command-eval", "--json"], createIo())).toBe(0);
    await writeFile(path.join(workspace, "README.md"), "local root note that should not sync\n");
    await mkdir(path.join(workspace, "docs"), { recursive: true });
    await writeFile(path.join(workspace, "docs", "notes.md"), "local docs that should not sync\n");
    const candidateId = await seedLocalCandidate(workspace, {
      meta: {
        source: {
          files: [textFile("candidates/command/candidate.yaml", "version: 4\nname: local-command-eval\nfiles:\n  path: files\nruns:\n  command:\n    name: Command\n    use: command\n")],
        },
      },
    });
    const snapshotWithCandidate = await loadLocalArchive(workspace);
    await saveLocalArchive(workspace, {
      ...snapshotWithCandidate,
      activeId: "local_draft_001",
      candidates: [
        ...snapshotWithCandidate.candidates,
        {
          id: "local_draft_001",
          version: snapshotWithCandidate.candidates.length + 1,
          ordinal: snapshotWithCandidate.candidates.length + 1,
          benchmarkFingerprint: await localSeedBenchmarkFingerprint(workspace),
          candidateFingerprint: "local-draft-fingerprint",
          visibility: "private",
          createdAt: "2026-04-28T00:01:00.000Z",
          referenceIds: [],
          status: "agent_error",
          fileChanges: ["SKILL.md"],
        },
      ],
      candidateFiles: {
        ...snapshotWithCandidate.candidateFiles,
        local_draft_001: [textFile("SKILL.md", "local draft\n")],
      },
    });
    await writeFile(path.join(assetsRoot, "client.js"), "console.log('dev-open-test');\n");
    await writeFile(path.join(assetsRoot, "client.css"), "body { margin: 0; }\n");
    const server = await startLocalWorkbenchDevServer({
      workspace,
      host: "127.0.0.1",
      port: 0,
      assetsRoot,
    });
    try {
      const snapshot = await fetchJson<{
        workspaceRoot: string;
        activeId: string | null;
        summaries: Array<{ id: string; metrics?: unknown }>;
        evaluations: unknown[];
      }>(`${server.url}api/snapshot`);
      expect(snapshot.workspaceRoot).toBe(path.resolve(workspace));
      expect(snapshot.activeId).toBeNull();
      expect(snapshot.summaries.map((summary) => summary.id)).toEqual([candidateId]);
      expect(snapshot.summaries[0]).not.toHaveProperty("metrics");
      expect(snapshot.evaluations).toEqual([]);

      const spec = await fetchJson<{
        path: string;
        exists: boolean;
        spec: { benchmark: { name: string } } | null;
      }>(`${server.url}api/spec`);
      expect(spec.path).toBe("benchmark.yaml");
      expect(spec.exists).toBe(true);
      expect(spec.spec?.benchmark.name).toBe("local-command-eval");

      const sourceFiles = await fetchJson<Array<{ path: string }>>(`${server.url}api/source/files`);
      const sourcePaths = sourceFiles.map((file) => file.path).sort();
      expect(sourcePaths).toContain("task-001/tests/required-output.txt");
      expect(sourcePaths).toContain("task-001/task.yaml");
      expect(sourcePaths).not.toContain("benchmark.yaml");
      expect(sourcePaths).not.toContain("environment/Dockerfile");
      expect(sourcePaths).not.toContain("candidates/current/candidate.yaml");
      expect(sourcePaths).not.toContain("candidates/current/files/run.js");
      expect(sourcePaths).not.toContain("README.md");
      expect(sourcePaths).not.toContain("docs/notes.md");

      const candidateFiles = await fetchJson<Array<{ path: string; status: string }>>(
        `${server.url}api/candidate/files?id=${encodeURIComponent(candidateId)}`,
      );
      expect(candidateFiles).toEqual([
        expect.objectContaining({ path: "prompt.md", status: "added" }),
      ]);

      const preview = await fetchJson<{ path: string; source: { content: string } | null }>(
        `${server.url}api/candidate/preview?id=${encodeURIComponent(candidateId)}&path=prompt.md`,
      );
      expect(preview.path).toBe("prompt.md");
      expect(preview.source?.content).toBe("seeded candidate\n");

      const mutation = await fetch(`${server.url}api/spec`, { method: "PUT" });
      expect(mutation.status).toBe(405);
      expect(await mutation.json()).toEqual({ message: "Workbench local open is read-only." });
    } finally {
      await server.close();
    }
  });

  test.skipIf(!loopbackAvailable)("local dev browser server distinguishes document and API 404s", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-dev-open-status-"));
    const assetsRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-dev-open-status-assets-"));
    await writeFile(path.join(assetsRoot, "client.js"), "console.log('dev-open-status-test');\n");
    await writeFile(path.join(assetsRoot, "client.css"), "body { margin: 0; }\n");
    const server = await startLocalWorkbenchDevServer({
      workspace,
      host: "127.0.0.1",
      port: 0,
      assetsRoot,
    });
    try {
      const overview = await fetch(new URL("/", server.url));
      expect(overview.status).toBe(200);
      expect(overview.headers.get("content-type")).toContain("text/html");

      const candidate = await fetch(new URL("/candidates/candidate_123", server.url));
      expect(candidate.status).toBe(200);
      expect(candidate.headers.get("content-type")).toContain("text/html");

      const encodedCandidateView = await fetch(new URL("/candidates/candidate_123/%66iles", server.url));
      expect(encodedCandidateView.status).toBe(200);
      expect(encodedCandidateView.headers.get("content-type")).toContain("text/html");

      const missingDocument = await fetch(new URL("/sdfsdfds", server.url));
      expect(missingDocument.status).toBe(404);
      expect(missingDocument.headers.get("content-type")).toContain("text/html");
      expect(await missingDocument.text()).toContain("<title>Workbench Local</title>");

      const missingCandidateView = await fetch(new URL("/candidates/candidate_123/unknown", server.url));
      expect(missingCandidateView.status).toBe(404);
      expect(missingCandidateView.headers.get("content-type")).toContain("text/html");

      const missingApi = await fetch(new URL("/api/does-not-exist", server.url));
      expect(missingApi.status).toBe(404);
      expect(missingApi.headers.get("content-type")).toContain("application/json");
      expect(await missingApi.json()).toEqual({
        message: "Unknown Workbench local API route: /api/does-not-exist",
      });
    } finally {
      await server.close();
    }
  });

  test("local archive upserts in-progress runs before terminal records", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-local-runs-"));
    const startedAt = "2026-05-27T00:00:00.000Z";
    const runningRun = localRunSummary({
      id: "run_local_test",
      status: "running",
      startedAt,
      attemptsExecuted: 0,
    });
    const finishedRun = localRunSummary({
      id: runningRun.id,
      status: "finished",
      startedAt,
      finishedAt: "2026-05-27T00:00:10.000Z",
      durationMs: 10_000,
      outcome: "ok",
      attemptsExecuted: 1,
    });

    await saveLocalArchive(workspace, {
      activeId: null,
      candidates: [],
      candidateFiles: {},
      evaluations: [],
      runs: [],
      events: [],
    });
    let archive = await loadLocalArchive(workspace);
    archive = upsertLocalRun(archive, runningRun, [{
      id: "event_started",
      at: startedAt,
      type: "run_started",
      runId: runningRun.id,
    }]);
    await saveLocalArchive(workspace, archive);

    expect((await loadLocalArchive(workspace)).runs).toMatchObject([{
      id: runningRun.id,
      status: "running",
      attemptsExecuted: 0,
    }]);

    archive = upsertLocalRun(await loadLocalArchive(workspace), finishedRun, [{
      id: "event_finished",
      at: finishedRun.finishedAt!,
      type: "run_finished",
      runId: runningRun.id,
    }]);
    await saveLocalArchive(workspace, archive);

    const persisted = await loadLocalArchive(workspace);
    expect(persisted.runs).toHaveLength(1);
    expect(persisted.runs[0]).toMatchObject({
      id: runningRun.id,
      status: "finished",
      outcome: "ok",
      attemptsExecuted: 1,
    });
    expect(persisted.events.map((event) => event.type)).toEqual(["run_started", "run_finished"]);
  });

  test.skipIf(!loopbackAvailable)("local dev browser server exposes archived job executions, traces, and execution files", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-dev-open-jobs-"));
    const assetsRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-dev-open-assets-"));
    await writeFile(path.join(assetsRoot, "client.js"), "console.log('dev-open-test');\n");
    await writeFile(path.join(assetsRoot, "client.css"), "body { margin: 0; }\n");
    const candidateId = await seedLocalCandidate(workspace, {
      eval: {
        candidate: { id: "candidate_seeded_001", kind: "candidate" },
        status: "completed",
        sampleCount: 1,
        completedSampleCount: 1,
        errorSampleCount: 0,
        metrics: { score: metricStats(1) },
        cases: [{ id: "case-001", sampleCount: 1, metrics: { score: metricStats(1) } }],
        samples: [{
          id: "case-001__sample_001",
          index: 0,
          candidate: { id: "candidate_seeded_001", kind: "candidate" },
          status: "completed",
          metrics: { score: 1 },
          cases: [{
            id: "case-001",
            status: "completed",
            metrics: { score: 1 },
            feedback: { summary: "seeded" },
          }],
        }],
      },
    });
    await saveLocalJobs(workspace, [
      localExecutionJob({
        id: "job_attempt",
        candidateId,
        purpose: "attempt",
        output: {
          ok: true,
          summary: "Attempt wrote a result.",
          result: { score: 1, summary: "attempt passed" },
          files: [
            textFile("workbench-result.json", "{\"protocol\":\"workbench.adapter-result.v1\",\"operation\":\"engine.run\",\"ok\":true,\"value\":{\"score\":1,\"summary\":\"attempt passed\"}}\n"),
            textFile("attempt-summary.md", "Attempt wrote a result.\n"),
            textFile(".workbench/traces/job_attempt/runner/session/trace.json", JSON.stringify({
              trace_id: "seeded-attempt",
              spans: [{
                id: "turn",
                parent_id: null,
                attempt_number: 1,
                stage_id: "workbench-attempt",
                stage_run_index: 1,
                kind: "turn",
                title: "Live attempt turn",
                status: "completed",
                started_at: "2026-04-28T00:00:00.000Z",
                ended_at: "2026-04-28T00:00:01.000Z",
                attributes: { source: "trace-json" },
              }],
              events: [{
                id: "message",
                span_id: "turn",
                attempt_number: 1,
                stage_id: "workbench-attempt",
                stage_run_index: 1,
                kind: "message",
                at: "2026-04-28T00:00:00.500Z",
                message: "real trace event",
                attributes: {},
              }],
              summaries: [{
                attempt_number: 1,
                stage_id: "workbench-attempt",
                stage_run_index: 1,
                status: "completed",
                started_at: "2026-04-28T00:00:00.000Z",
                ended_at: "2026-04-28T00:00:01.000Z",
                duration_ms: 1000,
                tool_call_count: 1,
                input_tokens: null,
                output_tokens: null,
                usage: null,
                final_output_present: true,
                error_message: null,
              }],
            }, null, 2)),
            textFile(".workbench/traces/job_attempt/engine/rubric/criteria/accuracy/judge/session/trace.json", JSON.stringify({
              trace_id: "seeded-accuracy-judge",
              spans: [{
                id: "accuracy-judge",
                parent_id: null,
                attempt_number: 1,
                stage_id: "workbench-attempt",
                stage_run_index: 1,
                kind: "turn",
                title: "Judge criterion accuracy",
                status: "completed",
                started_at: "2026-04-28T00:00:02.000Z",
                ended_at: "2026-04-28T00:00:03.000Z",
                attributes: { source: "accuracy-judge-trace-json" },
              }],
              events: [{
                id: "accuracy-judge-message",
                span_id: "accuracy-judge",
                attempt_number: 1,
                stage_id: "workbench-attempt",
                stage_run_index: 1,
                kind: "message",
                at: "2026-04-28T00:00:02.500Z",
                message: "accuracy judge trace event",
                attributes: {},
              }],
              summaries: [{
                attempt_number: 1,
                stage_id: "workbench-attempt",
                stage_run_index: 1,
                status: "completed",
                started_at: "2026-04-28T00:00:02.000Z",
                ended_at: "2026-04-28T00:00:03.000Z",
                duration_ms: 1000,
                tool_call_count: 1,
                input_tokens: null,
                output_tokens: null,
                usage: null,
                final_output_present: true,
                error_message: null,
              }],
            }, null, 2)),
            textFile(".workbench/traces/job_attempt/engine/rubric/criteria/style/judge/session/trace.json", JSON.stringify({
              trace_id: "seeded-style-judge",
              spans: [{
                id: "style-judge",
                parent_id: null,
                attempt_number: 1,
                stage_id: "workbench-attempt",
                stage_run_index: 1,
                kind: "turn",
                title: "Judge criterion style",
                status: "completed",
                started_at: "2026-04-28T00:00:04.000Z",
                ended_at: "2026-04-28T00:00:05.000Z",
                attributes: { source: "style-judge-trace-json" },
              }],
              events: [{
                id: "style-judge-message",
                span_id: "style-judge",
                attempt_number: 1,
                stage_id: "workbench-attempt",
                stage_run_index: 1,
                kind: "message",
                at: "2026-04-28T00:00:04.500Z",
                message: "style judge trace event",
                attributes: {},
              }],
              summaries: [{
                attempt_number: 1,
                stage_id: "workbench-attempt",
                stage_run_index: 1,
                status: "completed",
                started_at: "2026-04-28T00:00:04.000Z",
                ended_at: "2026-04-28T00:00:05.000Z",
                duration_ms: 1000,
                tool_call_count: 1,
                input_tokens: null,
                output_tokens: null,
                usage: null,
                final_output_present: true,
                error_message: null,
              }],
            }, null, 2)),
          ],
        },
      }),
    ]);
    const archivedJobs = await readLocalJobs(workspace);
    const archivedAttemptFiles = (archivedJobs.find((job) => job.id === "job_attempt")?.output as {
      files?: Array<{ path?: string }>;
    } | undefined)?.files ?? [];
    expect(archivedAttemptFiles.some((file) =>
      file.path === ".workbench/traces/job_attempt/runner/session/trace.json"
    )).toBe(true);

    const server = await startLocalWorkbenchDevServer({
      workspace,
      host: "127.0.0.1",
      port: 0,
      assetsRoot,
    });
    try {
      const review = await fetchJson<{
        executions: Array<{ kind: string; role: string; jobIds: string[] }>;
      }>(`${server.url}api/case-review?id=${encodeURIComponent(candidateId)}&run=run_seeded&case=case-001`);
      expect(review.executions.map((execution) => execution.kind)).toEqual(["attempt"]);
      expect(review.executions[0]?.role).toBe("engine");
      expect(review.executions[0]?.jobIds).toEqual(["job_attempt"]);

      const traces = await fetchJson<{
        executions: Array<{
          kind: string;
          role: string;
          jobIds: string[];
          sessions: Array<{
            label: string;
            role: string;
            kind: string;
            sourcePath: string | null;
            trace: {
              spans: Array<{ title: string; stage_id: string | null; stage_run_index: number | null; attributes: Record<string, unknown> }>;
              events: Array<{ message: string; stage_id: string | null; stage_run_index: number | null }>;
            };
          }>;
          trace: {
            spans: Array<{ title: string; stage_id: string | null; stage_run_index: number | null; attributes: Record<string, unknown> }>;
            events: Array<{ message: string; stage_id: string | null; stage_run_index: number | null }>;
          };
        }>;
      }>(`${server.url}api/traces?run=run_seeded&job=job_attempt`);
      expect(traces.executions.map((execution) => execution.kind)).toEqual(["attempt"]);
      expect(traces.executions[0]?.jobIds).toEqual(["job_attempt"]);
      expect(traces.executions[0]?.sessions.map((session) => session.label)).toEqual([
        "Candidate run",
        "Accuracy judge",
        "Style judge",
      ]);
      expect(traces.executions[0]?.sessions.map((session) => session.role)).toEqual([
        "runner",
        "engine",
        "engine",
      ]);
      expect(traces.executions[0]?.sessions.map((session) => session.kind)).toEqual([
        "runner",
        "judge",
        "judge",
      ]);
      expect(traces.executions[0]?.sessions[1]?.sourcePath).toBe(".workbench/traces/job_attempt/engine/rubric/criteria/accuracy/judge/session/trace.json");
      expect(traces.executions[0]?.sessions[1]?.trace.spans.map((span) => span.stage_id)).toEqual(["workbench-attempt"]);
      expect(traces.executions[0]?.trace.spans.map((span) => span.title)).toEqual(expect.arrayContaining([
        "Engine job job_attempt",
        "Live attempt turn",
        "Judge criterion accuracy",
        "Judge criterion style",
      ]));
      expect(traces.executions[0]?.trace.events.map((event) => event.message)).toContain("Engine job completed.");
      expect(traces.executions[0]?.trace.events.map((event) => event.message)).toContain("real trace event");
      expect(traces.executions[0]?.trace.events.map((event) => event.message)).toContain("accuracy judge trace event");
      expect(traces.executions[0]?.trace.events.map((event) => event.message)).toContain("style judge trace event");
      expect(traces.executions[0]?.trace.spans.map((span) => span.stage_id)).toEqual(["attempt", "attempt", "attempt", "attempt"]);
      expect(traces.executions[0]?.trace.spans.map((span) => span.stage_run_index)).toEqual([null, null, null, null]);

      const files = await fetchJson<Array<{ path: string }>>(
        `${server.url}api/execution/files?run=run_seeded&id=job_attempt`,
      );
      expect(files.map((file) => file.path)).toEqual(["attempt-summary.md"]);
    } finally {
      await server.close();
    }
  });

  test("local open rejects missing flag values before starting the server", async () => {
    const io = createIo();
    expect(await runCli(["open", "--host"], io)).toBe(2);
    expect(io.stderrText()).toContain("--host requires a value.");
  });

  test("init writes explicit benchmark and candidate YAML", async () => {
    const skillWorkspace = await mkdtemp(path.join(os.tmpdir(), "workbench-init-skill-"));
    const commandWorkspace = await mkdtemp(path.join(os.tmpdir(), "workbench-init-command-"));
    const customAgentWorkspace = await mkdtemp(path.join(os.tmpdir(), "workbench-init-custom-agent-"));

    expect(await runCli(["init", skillWorkspace, "--skill", "invoice-review", "--agent", "codex", "--json"], createIo())).toBe(0);
    expect(await runCli(["init", commandWorkspace, "--command", "command-eval", "--json"], createIo())).toBe(0);
    expect(await runCli(["init", customAgentWorkspace, "--skill", "custom-agent-skill", "--agent", "my-agent", "--json"], createIo())).toBe(0);

    const skillBenchmark = await readFile(path.join(skillWorkspace, "benchmark.yaml"), "utf8");
    const skillCandidate = await readFile(path.join(skillWorkspace, "candidates", "current", "candidate.yaml"), "utf8");
    expect(skillBenchmark).toContain("version: 4");
    expect(skillBenchmark).toContain("description: \"Evaluate the invoice-review skill across representative tasks.\"");
    expect(skillBenchmark).toContain("engine:\n  use: workbench");
    expect(skillBenchmark).not.toContain("use: path");
    expect(skillBenchmark).toContain("environment:\n      dockerfile: environment/Dockerfile");
    expect(skillBenchmark).toContain("judge:\n          use: codex\n          with:\n            model: gpt-5.5");
    expect(skillCandidate).toContain("runs:\n  main:");
    expect(skillCandidate).toContain("use: codex\n    with:\n      model: gpt-5.5");
    expect(skillCandidate).toContain("prepare:\n  command: sh input/candidate/prepare.sh");
    expect(skillCandidate).toContain("improve:\n  edits:\n    - SKILL.md\n  use: codex\n  with:\n    model: gpt-5.5");
    expect(await readFile(path.join(skillWorkspace, "candidates", "current", "files", "SKILL.md"), "utf8")).toContain("name: invoice-review");
    expect(await readFile(path.join(skillWorkspace, "candidates", "current", "files", "prepare.sh"), "utf8")).toContain("cp -R input/candidate/. .");
    expect(await readFile(path.join(skillWorkspace, "tasks", "task-001", "tests", "rubric.md"), "utf8")).toContain("Reward complete");
    const skillDockerfile = await readFile(path.join(skillWorkspace, "environment", "Dockerfile"), "utf8");
    expect(skillDockerfile).toContain("ca-certificates");
    expect(skillDockerfile).not.toContain("npm install --global @openai/codex");

    const commandBenchmark = await readFile(path.join(commandWorkspace, "benchmark.yaml"), "utf8");
    const commandCandidate = await readFile(path.join(commandWorkspace, "candidates", "current", "candidate.yaml"), "utf8");
    expect(commandBenchmark).toContain("version: 4");
    expect(commandBenchmark).toContain("description: \"Evaluate the command-eval command implementation across representative tasks.\"");
    expect(commandCandidate).toContain("runs:\n  main:");
    expect(commandCandidate).toContain("use: command");
    expect(commandCandidate).toContain("prepare:\n  command: sh input/candidate/prepare.sh");
    expect(commandBenchmark).toContain("score:\n      use: tests");
    expect(await readFile(path.join(commandWorkspace, "candidates", "current", "files", "run.js"), "utf8")).toContain("command candidate ran");
    expect(await readFile(path.join(commandWorkspace, "candidates", "current", "files", "prepare.sh"), "utf8")).toContain("cp -R input/candidate/. .");
    expect(await readFile(path.join(commandWorkspace, "tasks", "task-001", "tests", "required-output.txt"), "utf8")).toContain("command candidate ran");
    expect(await readFile(path.join(commandWorkspace, "environment", "Dockerfile"), "utf8")).toContain("ca-certificates");

    await expect(readFile(path.join(customAgentWorkspace, "candidates", "current", "candidate.yaml"), "utf8"))
      .resolves.toContain("use: my-agent");
    await expect(readFile(path.join(customAgentWorkspace, "candidates", "current", "candidate.yaml"), "utf8"))
      .resolves.not.toContain("model: gpt-5.5");

    for (const workspace of [skillWorkspace, commandWorkspace]) {
      const checkIo = createIo();
      expect(await runCli(["check", "--dir", workspace, "--json"], checkIo)).toBe(0);
      expect(JSON.parse(checkIo.stdoutText())).toMatchObject({ ok: true });
    }
  });

  test("init renderer delegates authored examples to the template pack", async () => {
    const scaffoldRenderer = await readFile(path.join(packageRoot, "src", "init-scaffold.ts"), "utf8");
    const templatePack = await readFile(path.join(packageRoot, "src", "init-template-pack.ts"), "utf8");

    expect(scaffoldRenderer).not.toContain("use: rubric");
    expect(scaffoldRenderer).not.toContain("engine:");
    expect(scaffoldRenderer).not.toContain("tasks/task-001");
    expect(templatePack).toContain("use: rubric");
    expect(templatePack).toContain("parallelism: 2");
  });

  test("init rejects ambiguous or incomplete scaffold flags", async () => {
    const missingScaffoldKind = createIo();
    expect(await runCli(["init", "--json"], missingScaffoldKind)).toBe(2);
    expect(missingScaffoldKind.stdoutText()).toContain("Specify exactly one of --skill NAME or --command NAME.");

    const missingName = createIo();
    expect(await runCli(["init", "--skill", "--agent", "codex", "--json"], missingName)).toBe(2);
    expect(missingName.stdoutText()).toContain("Missing NAME for --skill.");

    const ambiguousScaffold = createIo();
    expect(await runCli(["init", "--skill", "invoice-review", "--command", "command-eval", "--agent", "codex", "--json"], ambiguousScaffold)).toBe(2);
    expect(ambiguousScaffold.stdoutText()).toContain("Specify exactly one of --skill NAME or --command NAME.");

    const removedInitFlag = createIo();
    const removedFlagName = `--${"pipe"}${"line"}`;
    expect(await runCli(["init", removedFlagName, "removed-eval", "--json"], removedInitFlag)).toBe(2);
    expect(removedInitFlag.stdoutText()).toContain(`Unsupported flag: ${removedFlagName}.`);

    const commandAgent = createIo();
    expect(await runCli(["init", "--command", "command-eval", "--agent", "codex", "--json"], commandAgent)).toBe(2);
    expect(commandAgent.stdoutText()).toContain("--agent applies only to --skill.");
  });

  test("check resolves explicit Workbench engine task paths through engine.resolve", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-explicit-path-source-"));
    expect(await runCli(["init", workspace, "--command", "command-eval", "--json"], createIo())).toBe(0);
    const benchmarkPath = path.join(workspace, "benchmark.yaml");
    await mkdir(path.join(workspace, "alt-tasks", "case-001", "tests"), { recursive: true });
    await writeFile(path.join(workspace, "alt-tasks", "case-001", "task.yaml"), "version: 3\ntask: Say hello from the alternate task directory.\n");
    await writeFile(path.join(workspace, "alt-tasks", "case-001", "tests", "required-output.txt"), "command candidate ran\n");
    await writeFile(
      benchmarkPath,
      (await readFile(benchmarkPath, "utf8")).replace(
        "    environment:",
        "    tasks:\n      path: alt-tasks\n    environment:",
      ),
    );

    const io = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], io)).toBe(0);
    expect(JSON.parse(io.stdoutText()).plan.engine).toMatchObject({
      resolver: { use: "workbench" },
      path: "alt-tasks",
      cases: 1,
    });
  });

  test("check accepts benchmark.yaml as a source path", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-benchmark-source-path-"));
    expect(await runCli(["init", workspace, "--command", "command-eval", "--json"], createIo())).toBe(0);

    const io = createIo();
    expect(await runCli(["check", path.join(workspace, "benchmark.yaml"), "--json"], io)).toBe(0);
    expect(path.basename(JSON.parse(io.stdoutText()).specPath)).toBe("benchmark.yaml");
  });

  test("adapters scaffold and resolve benchmark-contained adapter sources", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-adapter-source-"));

    expect(await runCli(["init", workspace, "--command", "adapter-eval", "--json"], createIo())).toBe(0);
    expect(await runCli(["adapters", "create", "adapters/my-agent", "--dir", workspace, "--json"], createIo())).toBe(0);
    await appendCandidateAdapters(workspace, ["../../adapters/my-agent"]);

    const listIo = createIo();
    expect(await runCli(["adapters", "list", "--dir", workspace, "--json"], listIo)).toBe(0);
    expect(JSON.parse(listIo.stdoutText()).adapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "my-agent",
          declaredSource: "adapters/my-agent",
          resolvedSource: "adapters/my-agent",
          stability: "local",
          installed: true,
        }),
      ]),
    );

    const inspectIo = createIo();
    expect(await runCli(["adapters", "inspect", "my-agent", "--dir", workspace, "--json"], inspectIo)).toBe(0);
    expect(JSON.parse(inspectIo.stdoutText())).toMatchObject({
      ok: true,
      adapter: {
        id: "my-agent",
        declaredSource: "adapters/my-agent",
        resolvedSource: "adapters/my-agent",
        stability: "local",
        operations: {
          "candidate.run": "workbench-adapter-my-agent",
        },
      },
    });

    const checkIo = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], checkIo)).toBe(0);
    expect(JSON.parse(checkIo.stdoutText())).toMatchObject({
      ok: true,
      plan: {
        source: {
          files: 12,
        },
      },
    });
    expect(JSON.parse(checkIo.stdoutText()).plan.source).toMatchObject({
      files: 12,
    });

    const manifestPath = path.join(workspace, "adapters", "my-agent", "workbench.adapter.yaml");
    await writeFile(
      manifestPath,
      (await readFile(manifestPath, "utf8")).replace("  - npm install --global .", "  - npm install --global .\n  - echo refreshed"),
    );
    const refreshedCheckIo = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], refreshedCheckIo)).toBe(0);
  });

  test("project-declared adapter sources can override default catalog ids", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-adapter-override-"));

    expect(await runCli(["init", workspace, "--command", "adapter-eval", "--json"], createIo())).toBe(0);
    expect(await runCli(["adapters", "create", "adapters/codex", "--dir", workspace, "--json"], createIo())).toBe(0);
    await appendCandidateAdapters(workspace, ["../../adapters/codex"]);

    const listIo = createIo();
    expect(await runCli(["adapters", "list", "--dir", workspace, "--json"], listIo)).toBe(0);
    const listed = JSON.parse(listIo.stdoutText()) as {
      adapters: Array<{ id: string; kind: string; installed: boolean; overridesDefault?: boolean }>;
    };
    const codexEntries = listed.adapters.filter((adapter) => adapter.id === "codex");
    expect(codexEntries).toHaveLength(1);
    expect(codexEntries[0]).toMatchObject({
      id: "codex",
      kind: "path",
      installed: true,
      overridesDefault: true,
    });

    const inspectIo = createIo();
    expect(await runCli(["adapters", "inspect", "codex", "--dir", workspace, "--json"], inspectIo)).toBe(0);
    expect(JSON.parse(inspectIo.stdoutText())).toMatchObject({
      ok: true,
      adapter: {
        id: "codex",
        kind: "path",
        declaredSource: "adapters/codex",
        overridesDefault: true,
      },
    });
  });

  test("duplicate custom adapter ids are still rejected", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-adapter-conflict-"));

    expect(await runCli(["init", workspace, "--command", "adapter-eval", "--json"], createIo())).toBe(0);
    await mkdir(path.join(workspace, "adapters", "left"), { recursive: true });
    await mkdir(path.join(workspace, "adapters", "right"), { recursive: true });
    for (const source of ["left", "right"]) {
      await writeFile(path.join(workspace, "adapters", source, "workbench.adapter.yaml"), [
        "id: duplicate",
        "protocol: workbench.adapter.v3",
        "setup: []",
        "operations:",
        `  candidate.run: { command: "node ${source}.mjs" }`,
        "",
      ].join("\n"));
      await writeFile(path.join(workspace, "adapters", source, `${source}.mjs`), "");
    }
    await appendCandidateAdapters(workspace, ["../../adapters/left", "../../adapters/right"]);

    const checkIo = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], checkIo)).toBe(1);
    expect(checkIo.stdoutText()).toContain("Adapter id duplicate is provided by both adapters/left and adapters/right");

    const listIo = createIo();
    expect(await runCli(["adapters", "list", "--dir", workspace, "--json"], listIo)).toBe(1);
    expect(listIo.stdoutText()).toContain("Adapter id duplicate is provided by both adapters/left and adapters/right");
  });

  test("adapters test validates manifests and replays a request fixture", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-adapter-test-"));

    expect(await runCli(["init", workspace, "--command", "adapter-eval", "--json"], createIo())).toBe(0);
    expect(await runCli(["adapters", "create", "adapters/my-agent", "--dir", workspace, "--json"], createIo())).toBe(0);

    const manifestOnlyIo = createIo();
    expect(await runCli(["adapters", "test", "adapters/my-agent", "--dir", workspace, "--json"], manifestOnlyIo)).toBe(0);
    expect(JSON.parse(manifestOnlyIo.stdoutText())).toMatchObject({
      ok: true,
      mode: "manifest",
      adapter: { id: "my-agent" },
    });

    const adapterRoot = path.join(workspace, "adapters", "attempt");
    await mkdir(adapterRoot, { recursive: true });
    await writeFile(path.join(adapterRoot, "workbench.adapter.yaml"), [
      "id: attempt",
      "protocol: workbench.adapter.v3",
      "setup: []",
      "operations:",
      "  engine.run: { command: \"node adapter.mjs\" }",
      "",
    ].join("\n"));
    await writeFile(path.join(adapterRoot, "adapter.mjs"), [
      "import fs from 'node:fs';",
      "import path from 'node:path';",
      "const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, 'utf8'));",
      "if (request.operation !== 'engine.run') process.exit(3);",
      "const output = process.env.WORKBENCH_OUTPUT;",
      "fs.mkdirSync(output, { recursive: true });",
      "fs.writeFileSync(path.join(output, 'workbench-result.json'), JSON.stringify({ protocol: 'workbench.adapter-result.v1', operation: 'engine.run', ok: true, value: { score: 1, summary: 'ok' } }));",
      "",
    ].join("\n"));
    const requestPath = path.join(workspace, "attempt-request.json");
    await writeFile(requestPath, `${JSON.stringify({
      protocol: "workbench.adapter.v3",
      id: "exec_adapter_test",
      operation: "engine.run",
      invocation: {
        use: "attempt",
        with: {},
      },
      paths: {
        workspace,
        output: "/workspace/output",
        result: "/workspace/output/workbench-result.json",
      },
    }, null, 2)}\n`);

    const replayIo = createIo();
    expect(await runCli([
      "adapters",
      "test",
      "adapters/attempt",
      "--dir",
      workspace,
      "--request",
      "attempt-request.json",
      "--output",
      "attempt-output",
      "--json",
    ], replayIo)).toBe(0);
    expect(JSON.parse(replayIo.stdoutText())).toMatchObject({
      ok: true,
      mode: "replay",
      replay: {
        operation: "engine.run",
        outputs: ["workbench-result.json"],
      },
    });
    await expect(readFile(path.join(workspace, "attempt-output", "workbench-result.json"), "utf8")).resolves.toContain("ok");
  });

  test("checked-in echo adapter example replays its request fixture", async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), "workbench-echo-adapter-output-"));
    const io = createIo();

    expect(await runCli([
      "adapters",
      "test",
      "examples/adapters/echo",
      "--dir",
      productRoot,
      "--request",
      "examples/adapters/echo/requests/score.json",
      "--output",
      output,
      "--json",
    ], io)).toBe(0);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      ok: true,
      mode: "replay",
      adapter: {
        id: "echo",
        auth: expect.any(Object),
        slots: {
          judge: expect.any(Object),
        },
      },
      replay: {
        operation: "engine.run",
        outputs: ["workbench-result.json"],
      },
    });
    await expect(readFile(path.join(output, "workbench-result.json"), "utf8")).resolves.toContain("echo accepted");
  });

  test("push sends authored Dockerfile source separately from composed adapter runtime", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-adapter-push-"));
    expect(await runCli(["init", workspace, "--command", "adapter-eval", "--json"], createIo())).toBe(0);
    expect(await runCli(["adapters", "create", "adapters/my-agent", "--dir", workspace, "--json"], createIo())).toBe(0);
    await appendCandidateAdapters(workspace, ["../../adapters/my-agent"]);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (url === "http://workbench.test/api/workbench/benchmarks/state" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as WorkbenchProjectState;
        return Response.json(projectStateImportFixture({
          id: "wb_123456789abc",
          owner: "alice",
          name: "adapter-eval",
          visibility: "private",
          sourceChanged: true,
          changed: true,
          runtime: body.runtime,
        }), { status: 201 });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    expect(await runCli(["push", "--dir", workspace, "--visibility", "private", "--json"], createIo())).toBe(0);

    const body = JSON.parse(String(requests[0]?.init?.body)) as {
      source: {
        dockerfile?: string;
        runtimeDockerfile?: string;
        adapterFiles?: Array<{ path: string }>;
      };
    };
    expect(body.source.dockerfile).toContain("FROM");
    expect(body.source.dockerfile).not.toContain("Workbench adapter setup");
    expect(body.source.runtimeDockerfile).toContain("Workbench adapter setup");
    expect(body.source.runtimeDockerfile).toContain("npm install --global .");
    expect(body.source.adapterFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "adapters/my-agent/workbench.adapter.yaml" }),
        expect.objectContaining({ path: "adapters/my-agent/adapter.mjs" }),
      ]),
    );
  });

  test("adapter setup does not synthesize fallback binaries for command strings", async () => {
    const dockerfile = await composeRuntimeDockerfileWithAdapters("FROM node:22-bookworm-slim\n", [{
      source: "adapters/string-command",
      declaredSource: "adapters/string-command",
      kind: "path",
      stability: "local",
      manifest: {
        id: "string-command",
        protocol: "workbench.adapter.v3",
        setup: ["npm install --global ."],
        operations: {
          "candidate.run": { command: "node /opt/workbench-adapters/string-command/adapter.mjs --mode workbench" },
        },
      },
      files: [{
        path: "adapter.mjs",
        content: "#!/usr/bin/env node\n",
        executable: true,
      }],
      contentHash: "content",
      manifestHash: "manifest",
    }]);

    expect(dockerfile).toContain("RUN npm install --global .");
    expect(dockerfile).not.toContain("command -v");
    expect(dockerfile).not.toContain("ln -sf");
  });

  test("check fails when declared nested adapter refs are unresolved", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-adapter-nested-ref-"));
    expect(await runCli(["init", workspace, "--command", "adapter-eval", "--json"], createIo())).toBe(0);
    expect(await runCli(["adapters", "create", "adapters/orchestrator", "--dir", workspace, "--json"], createIo())).toBe(0);
    await writeFile(path.join(workspace, "adapters", "orchestrator", "workbench.adapter.yaml"), [
      "id: orchestrator",
      "protocol: workbench.adapter.v3",
      "setup:",
      "  - npm install --global .",
      "operations:",
      "  candidate.run: {}",
      "slots:",
      "  child:",
      "    path: /child",
      "    operation: candidate.run",
      "",
    ].join("\n"));
    const specPath = commandCandidateSpecPath(workspace);
    const specSource = await readFile(specPath, "utf8");
    await writeFile(specPath, specSource.replace(
      /runs:\n  main:\n    name: Command\n    use: command\n    with:\n      command: .+/u,
      "runs:\n  main:\n    name: Orchestrator\n    use: orchestrator\n    with:\n      child:\n        use: secret-agent",
    ) + "adapters:\n  - ../../adapters/orchestrator\n");

    const checkIo = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], checkIo)).toBe(1);
    expect(checkIo.stdoutText()).toContain("secret-agent");
  });

  test("check validates required adapter operations for top-level and slot invocations", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-adapter-operation-support-"));
    expect(await runCli(["init", workspace, "--command", "adapter-eval", "--json"], createIo())).toBe(0);

    const runAdapterRoot = path.join(workspace, "adapters", "score-only-runner");
    await mkdir(runAdapterRoot, { recursive: true });
    await writeFile(path.join(runAdapterRoot, "workbench.adapter.yaml"), [
      "id: score-only-runner",
      "protocol: workbench.adapter.v3",
      "setup: []",
      "operations:",
      "  engine.run: {}",
      "",
    ].join("\n"));
    const candidatePath = commandCandidateSpecPath(workspace);
    await writeFile(
      candidatePath,
      (await readFile(candidatePath, "utf8")).replace(
        /runs:\n  main:\n    name: Command\n    use: command\n    with:\n      command: .+/u,
        "runs:\n  main:\n    name: Score-only runner\n    use: score-only-runner\n    with: {}",
      ) + "adapters:\n  - ../../adapters/score-only-runner\n",
    );

    const topLevelIo = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], topLevelIo)).toBe(1);
    expect(topLevelIo.stdoutText()).toContain("Adapter score-only-runner does not implement candidate.run.");

    const slotWorkspace = await mkdtemp(path.join(os.tmpdir(), "workbench-adapter-slot-operation-support-"));
    expect(await runCli(["init", slotWorkspace, "--command", "adapter-eval", "--json"], createIo())).toBe(0);
    const orchestratorRoot = path.join(slotWorkspace, "adapters", "orchestrator");
    const engineOnlyRoot = path.join(slotWorkspace, "adapters", "engine-only");
    await mkdir(orchestratorRoot, { recursive: true });
    await mkdir(engineOnlyRoot, { recursive: true });
    await writeFile(path.join(orchestratorRoot, "workbench.adapter.yaml"), [
      "id: orchestrator",
      "protocol: workbench.adapter.v3",
      "setup: []",
      "operations:",
      "  engine.run: {}",
      "slots:",
      "  judge:",
      "    path: /judge",
      "    operation: candidate.run",
      "",
    ].join("\n"));
    await writeFile(path.join(engineOnlyRoot, "workbench.adapter.yaml"), [
      "id: engine-only",
      "protocol: workbench.adapter.v3",
      "setup: []",
      "operations:",
      "  engine.run: {}",
      "",
    ].join("\n"));
    const benchmarkPath = path.join(slotWorkspace, "benchmark.yaml");
    await writeFile(
      benchmarkPath,
      (await readFile(benchmarkPath, "utf8")).replace(
        "    score:\n      use: tests",
        "    score:\n      use: orchestrator\n      with:\n        judge:\n          use: engine-only",
      ) + "adapters:\n  - adapters/orchestrator\n  - adapters/engine-only\n",
    );

    const slotIo = createIo();
    expect(await runCli(["check", "--dir", slotWorkspace, "--json"], slotIo)).toBe(1);
    expect(slotIo.stdoutText()).toContain("Adapter engine-only does not implement candidate.run.");
  });

  test("check validates engine-resolve adapter slot operations before resolving cases", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-engine-resolve-slot-operation-support-"));
    expect(await runCli(["init", workspace, "--command", "adapter-eval", "--json"], createIo())).toBe(0);
    const engineResolveRoot = path.join(workspace, "adapters", "task-orchestrator");
    const engineOnlyRoot = path.join(workspace, "adapters", "engine-only");
    await mkdir(engineResolveRoot, { recursive: true });
    await mkdir(engineOnlyRoot, { recursive: true });
    await writeFile(path.join(engineResolveRoot, "workbench.adapter.yaml"), [
      "id: task-orchestrator",
      "protocol: workbench.adapter.v3",
      "setup: []",
      "operations:",
      "  engine.resolve: {}",
      "  engine.run: {}",
      "slots:",
      "  resolver:",
      "    path: /resolver",
      "    operation: candidate.run",
      "",
    ].join("\n"));
    await writeFile(path.join(engineOnlyRoot, "workbench.adapter.yaml"), [
      "id: engine-only",
      "protocol: workbench.adapter.v3",
      "setup: []",
      "operations:",
      "  engine.run: {}",
      "",
    ].join("\n"));
    const benchmarkPath = path.join(workspace, "benchmark.yaml");
    await writeFile(
      benchmarkPath,
      (await readFile(benchmarkPath, "utf8")).replace(
        "engine:\n  use: workbench\n  with:",
        "engine:\n  use: task-orchestrator\n  with:\n    resolver:\n      use: engine-only",
      ) + "adapters:\n  - adapters/task-orchestrator\n  - adapters/engine-only\n",
    );

    const checkIo = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], checkIo)).toBe(1);
    expect(checkIo.stdoutText()).toContain("Adapter engine-only does not implement candidate.run.");
  });

  test("adapters list resolves npm package manifests directly from YAML", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-adapter-npm-"));
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-adapter-package-"));
    await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
      name: "@workbench-test/npm-adapter",
      version: "1.2.3",
      type: "module",
      bin: {
        "workbench-adapter-npm-agent": "./adapter.mjs",
      },
      files: [
        "adapter.mjs",
        "workbench.adapter.yaml",
      ],
    }, null, 2)}\n`);
    await writeFile(path.join(packageRoot, "workbench.adapter.yaml"), [
      "id: npm-agent",
      "protocol: workbench.adapter.v3",
      "setup:",
      "  - npm install --global .",
      "operations:",
      "  candidate.run: {}",
      "auth:",
      "  methods:",
      "    api-key:",
      "      env:",
      "        - name: NPM_AGENT_API_KEY",
      "",
    ].join("\n"));
    await writeFile(path.join(packageRoot, "adapter.mjs"), "#!/usr/bin/env node\n");

    expect(await runCli(["init", workspace, "--command", "adapter-eval", "--json"], createIo())).toBe(0);
    const specPath = commandCandidateSpecPath(workspace);
    await writeFile(
      specPath,
      `${await readFile(specPath, "utf8")}adapters:\n  - npm:${packageRoot}\n`,
    );
    const listIo = createIo();
    expect(await runCli(["adapters", "list", "--dir", workspace, "--json"], listIo)).toBe(0);
    expect(JSON.parse(listIo.stdoutText()).adapters).toEqual(expect.arrayContaining([
      expect.objectContaining({
          id: "npm-agent",
          declaredSource: `npm:${packageRoot}`,
          resolvedSource: "npm:@workbench-test/npm-adapter@1.2.3",
          kind: "npm",
          stability: "floating",
          installed: true,
        }),
    ]));
    const inspectIo = createIo();
    expect(await runCli(["adapters", "inspect", "npm-agent", "--dir", workspace, "--json"], inspectIo)).toBe(0);
    expect(JSON.parse(inspectIo.stdoutText())).toMatchObject({
      ok: true,
      adapter: {
        id: "npm-agent",
        declaredSource: `npm:${packageRoot}`,
        resolvedSource: "npm:@workbench-test/npm-adapter@1.2.3",
        stability: "floating",
      },
    });
    const checkIo = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], checkIo)).toBe(0);
    expect(JSON.parse(checkIo.stdoutText()).plan.adapters.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "npm-agent",
        declaredSource: `npm:${packageRoot}`,
        resolvedSource: "npm:@workbench-test/npm-adapter@1.2.3",
        stability: "floating",
      }),
    ]));
    const spec = await readFile(commandCandidateSpecPath(workspace), "utf8");
    expect(spec).toContain(`npm:${packageRoot}`);
  });

  test("check rejects root task fixtures outside supported task package directories", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-task-layout-"));
    expect(await runCli(["init", workspace, "--command", "command-eval", "--json"], createIo())).toBe(0);
    await writeFile(path.join(workspace, "tasks", "task-001", "rubric.md"), "unsupported root rubric\n");

    const io = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], io)).toBe(1);
    expect(io.stdoutText()).toContain("unsupported file outside task.yaml");
  });

  test("local improve requires sandbox configuration before execution", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-local-metric-"));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    expect(await runCli(["init", workspace, "--command", "local-command-eval", "--json"], createIo())).toBe(0);
    await writeDockerNodeWorkbenchSpec(workspace);
    const baseId = await seedLocalCandidate(workspace);
    const runIo = createIo();
    expect(await runCli([
      "improve",
      commandCandidateSpecPath(workspace),
      "--from",
      baseId,
      "--budget",
      "1",
      "--samples",
      "1",
    ], runIo)).toBe(1);

    const output = `${runIo.stdoutText()}\n${runIo.stderrText()}`;
    expect(output).toMatch(/score: n\/a|docker/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("candidate text output summarizes evaluation scores without candidate-owned metrics", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-metric-summary-"));
    vi.stubGlobal("fetch", vi.fn());

    expect(await runCli(["init", workspace, "--command", "local-command-eval", "--json"], createIo())).toBe(0);
    await writeDockerNodeWorkbenchSpec(workspace, {
      score: 0.5,
      metrics: {
        score: 0.5,
        accuracy: 0.75,
      },
      summary: "Metric summary run completed.",
      fileChanges: ["prompt.md"],
    });
    await seedLocalCandidate(workspace, {
      eval: candidateEvaluation({
        score: 0.5,
        accuracy: 0.75,
      }),
    });

    const listIo = createIo();
    expect(await runCli(["candidates", "list", "--dir", workspace], listIo)).toBe(0);
    expect(listIo.stdoutText()).toContain("evaluation 0.50");
    expect(listIo.stdoutText()).not.toContain("metrics");
    expect(listIo.stdoutText()).not.toContain("\tscore 0.5");

    const showIo = createIo();
    expect(await runCli(["candidates", "show", "--dir", workspace], showIo)).toBe(0);
    expect(showIo.stdoutText()).toContain("evaluation\tscore: 0.50, accuracy: 0.75");
    expect(showIo.stdoutText()).not.toContain("metrics");
  });

  test.skipIf(!dockerAvailable)("external host engines resolve cases, own shared/separate/no-grader child sandboxes, and persist summaries", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-external-host-engine-"));

    await mkdir(path.join(workspace, "adapters", "external-host-engine"), { recursive: true });
    await mkdir(path.join(workspace, "environment"), { recursive: true });
    await mkdir(path.join(workspace, "candidates", "external", "files"), { recursive: true });
    await writeFile(path.join(workspace, "environment", "Dockerfile"), "FROM node:22-bookworm-slim\n");
    await writeFile(path.join(workspace, "benchmark.yaml"), [
      "version: 4",
      "name: external-host-engine-regression",
      "description: Minimal external host engine regression.",
      "engine:",
      "  use: external-host-engine",
      "adapters:",
      "  - adapters/external-host-engine",
      "",
    ].join("\n"));
    await writeFile(path.join(workspace, "candidates", "external", "candidate.yaml"), [
      "version: 4",
      "name: external-candidate",
      "files:",
      "  path: files",
      "defaultRun: external",
      "runs:",
      "  external:",
      "    name: External host engine",
      "    use: external-host-engine",
      "adapters:",
      "  - ../../adapters/external-host-engine",
      "",
    ].join("\n"));
    await writeFile(path.join(workspace, "candidates", "external", "files", "answer.txt"), "external-answer\n");
    await writeFile(path.join(workspace, "adapters", "external-host-engine", "workbench.adapter.yaml"), [
      "id: external-host-engine",
      "protocol: workbench.adapter.v3",
      "setup:",
      "  - npm install --global .",
      "operations:",
      "  engine.resolve: { command: \"node adapter.mjs\" }",
      "  engine.run: { command: \"node adapter.mjs\", executor: host }",
      "  candidate.run: {}",
      "",
    ].join("\n"));
    await writeFile(path.join(workspace, "adapters", "external-host-engine", "package.json"), `${JSON.stringify({
      name: "@local/external-host-engine-workbench-adapter",
      version: "0.0.0",
      type: "module",
      private: true,
      bin: {
        "workbench-adapter-external-host-engine": "./adapter.mjs",
      },
    }, null, 2)}\n`);
    await writeFile(path.join(workspace, "adapters", "external-host-engine", "adapter.mjs"), `#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

async function runRuntimeControlSequence(sequence) {
  const url = process.env.WORKBENCH_RUNTIME_CONTROL_URL;
  const token = process.env.WORKBENCH_RUNTIME_CONTROL_TOKEN;
  if (!url || !token) {
    throw new Error("runtime-control is required for external host engine.run");
  }
  const response = await fetch(new URL("/v1/operation-sequence", url), {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify(sequence),
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "runtime-control sequence failed");
  }
  return payload;
}

async function readSurfaceFiles(root, relativeDir = "") {
  if (!root) return [];
  const entries = await fs.readdir(path.join(root, relativeDir), { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.normalize(path.join(relativeDir, entry.name).replace(/\\\\/g, "/"));
    const fullPath = path.join(root, relativePath);
    if (entry.isDirectory()) {
      files.push(...await readSurfaceFiles(root, relativePath));
      continue;
    }
    if (!entry.isFile()) continue;
    const body = await fs.readFile(fullPath);
    const text = body.toString("utf8");
    const isUtf8 = Buffer.from(text, "utf8").equals(body);
    const stat = await fs.stat(fullPath);
    files.push({
      path: relativePath,
      kind: isUtf8 ? "text" : "binary",
      encoding: isUtf8 ? "utf8" : "base64",
      content: isUtf8 ? text : body.toString("base64"),
      executable: (stat.mode & 0o111) !== 0,
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function writeSurfaceFiles(root, files) {
  for (const file of files || []) {
    const target = path.join(root, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.encoding === "base64" ? Buffer.from(file.content, "base64") : file.content);
    if (file.executable) {
      await fs.chmod(target, 0o755).catch(() => {});
    }
  }
}

function publicOutputFiles(files) {
  return (files || []).filter((file) => {
    const normalized = String(file.path || "").replace(/\\\\/g, "/").replace(/^\\/+/, "");
    return normalized &&
      normalized !== "workbench-result.json" &&
      normalized !== "sandbox-environment.json" &&
      normalized !== "sandbox_error.log" &&
      normalized !== "exit_code" &&
      !normalized.startsWith(".workbench/");
  });
}

const requestPath = process.env.WORKBENCH_ADAPTER_REQUEST;
const request = JSON.parse(await fs.readFile(requestPath, "utf8"));
const output = process.env.WORKBENCH_OUTPUT ?? request.paths.output;
const resultPath = process.env.WORKBENCH_RESULT ?? request.paths.result ?? path.join(output, "workbench-result.json");
await fs.mkdir(output, { recursive: true });

let value;
if (request.operation === "engine.resolve") {
  value = {
      environment: {
        dockerfile: "environment/Dockerfile",
        resources: { timeoutMinutes: 9 },
        network: { egress: "open" },
      },
      cases: ["shared", "separate", "runner-only"].map((topology) => ({
        id: "case-" + topology,
        case: { version: 3, prompt: "Return the external answer using " + topology + " topology." },
        files: {
          public: [
            { path: "case-note.txt", kind: "text", encoding: "utf8", executable: false, content: "public external case " + topology + "\\n" },
            { path: "topology.txt", kind: "text", encoding: "utf8", executable: false, content: topology + "\\n" },
          ],
          private: [{ path: "secret.txt", kind: "text", encoding: "utf8", executable: false, content: "private external verifier " + topology + "\\n" }],
        },
      })),
    };
} else if (request.operation === "candidate.run") {
  if ("enginePrivate" in request.paths) {
    throw new Error("candidate.run must not receive enginePrivate paths");
  }
  try {
    await fs.readFile(path.join(request.paths.workspace, "private", "engine", "secret.txt"), "utf8");
    throw new Error("private file leaked into candidate run");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const caseNote = await fs.readFile(path.join(request.paths.case, "case-note.txt"), "utf8");
  try {
    await fs.readFile(path.join(request.paths.workspace, "case-note.txt"), "utf8");
    throw new Error("case file leaked into workspace root");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const answer = await fs.readFile(path.join(request.paths.candidate, "answer.txt"), "utf8");
  await fs.writeFile(path.join(output, "candidate-output.txt"), answer);
  value = { artifact: "candidate-output.txt", exact: answer.trim() === "external-answer" && caseNote.includes("public external case") ? 1 : 0 };
} else if (request.operation === "engine.run") {
  if (!request.paths.enginePrivate) {
    throw new Error("engine.run must receive enginePrivate paths");
  }
  await fs.readFile(path.join(request.paths.enginePrivate, "secret.txt"), "utf8");
  if (request.invocation?.with?.mode === "grade") {
    const candidateOutput = await fs.readFile(path.join(output, "candidate-output.txt"), "utf8");
    const exact = candidateOutput.trim() === "external-answer" ? 1 : 0;
    const criteria = [{
      criterion_id: "exact",
      label: "Exact match",
      score: exact,
      pass: exact === 1,
      rationale: exact === 1 ? "Candidate output matched the external verifier expectation." : "Candidate output did not match the external verifier expectation.",
    }];
    value = {
      score: exact,
      metrics: { exact },
      cases: [{
        id: request.context?.attempt?.caseId ?? "case-001",
        status: "completed",
        metrics: { score: exact, exact },
        criteria,
      }],
      summary: "external host engine graded delegated candidate output",
      };
    } else {
      const candidate = request.context?.candidate?.run;
      if (!candidate) {
        throw new Error("engine.run request context.candidate.run is required");
      }
      const topology = String(request.context?.attempt?.caseId ?? "").replace(/^case-/, "") || "separate";
      const candidateInput = await readSurfaceFiles(request.paths.candidate);
      const caseInput = await readSurfaceFiles(request.paths.case);
      const enginePrivateInput = await readSurfaceFiles(request.paths.enginePrivate);
      const candidateInvocation = {
        use: candidate.use,
        with: candidate.with ?? {},
        ...(candidate.command ? { command: candidate.command } : {}),
      };
      const gradeInvocation = {
        use: request.invocation.use,
        with: { mode: "grade" },
        command: "workbench-adapter-external-host-engine",
      };
      if (topology === "shared") {
        const shared = await runRuntimeControlSequence({
          inputs: {
            candidate: candidateInput,
            case: caseInput,
            enginePrivate: enginePrivateInput,
          },
          operations: [{
            label: "external-runner",
            operation: "candidate.run",
            invocation: candidateInvocation,
          }, {
            label: "external-grader",
            operation: "engine.run",
            invocation: gradeInvocation,
          }],
        });
        await writeSurfaceFiles(output, publicOutputFiles(shared.files));
        value = {
          ...shared.result,
          summary: "external host engine used one shared child sandbox",
          feedback: {
            ...(shared.result?.feedback ?? {}),
            topology,
            sequenceCount: 1,
            grader: true,
          },
        };
      } else if (topology === "separate") {
        const runner = await runRuntimeControlSequence({
          inputs: {
            candidate: candidateInput,
            case: caseInput,
          },
          operations: [{
            label: "external-runner",
            operation: "candidate.run",
            invocation: candidateInvocation,
          }],
        });
        const runnerFiles = publicOutputFiles(runner.files);
        const grader = await runRuntimeControlSequence({
          inputs: {
            candidate: candidateInput,
            case: caseInput,
            enginePrivate: enginePrivateInput,
            output: runnerFiles,
          },
          operations: [{
            label: "external-grader",
            operation: "engine.run",
            invocation: gradeInvocation,
          }],
        });
        await writeSurfaceFiles(output, [...runnerFiles, ...publicOutputFiles(grader.files)]);
        value = {
          ...grader.result,
          summary: "external host engine used separate child sandboxes",
          feedback: {
            ...(grader.result?.feedback ?? {}),
            topology,
            sequenceCount: 2,
            grader: true,
          },
        };
      } else if (topology === "runner-only") {
        const runner = await runRuntimeControlSequence({
          inputs: {
            candidate: candidateInput,
            case: caseInput,
          },
          operations: [{
            label: "external-runner",
            operation: "candidate.run",
            invocation: candidateInvocation,
          }],
        });
        await writeSurfaceFiles(output, publicOutputFiles(runner.files));
        const candidateValue = runner.operationResults?.find((result) => result.operation === "candidate.run")?.value ?? {};
        const exact = candidateValue.exact === 1 ? 1 : 0;
        value = {
          score: exact,
          metrics: { exact },
          cases: [{
            id: request.context?.attempt?.caseId ?? "case-runner-only",
            status: "completed",
            metrics: { score: exact, exact },
          }],
          summary: "external host engine used a runner-only child sandbox",
          feedback: {
            topology,
            sequenceCount: 1,
            grader: false,
          },
        };
      } else {
        throw new Error("unsupported topology " + topology);
      }
    }
} else {
  throw new Error("unsupported operation " + request.operation);
}

await fs.writeFile(resultPath, JSON.stringify({
  protocol: "workbench.adapter-result.v1",
  operation: request.operation,
  ok: true,
  value,
}, null, 2) + "\\n");
`);

    const checkIo = createIo();
    const checkExitCode = await runCli(["check", "--dir", workspace, "--json"], checkIo);
    expect(checkExitCode, checkIo.stdoutText()).toBe(0);
    const check = JSON.parse(checkIo.stdoutText()) as { plan?: { engine?: { cases?: number; resolver?: { use?: string } } } };
    expect(check.plan?.engine).toMatchObject({
      cases: 3,
      resolver: { use: "external-host-engine" },
    });
    expect(JSON.parse(checkIo.stdoutText()).plan?.environment).toMatchObject({
      resources: { timeoutMinutes: 9 },
      network: { egress: "open" },
    });

    const evalIo = createIo();
    expect(
      await runCli(["eval", "--dir", workspace, "--samples", "1", "--json"], evalIo),
      `${evalIo.stdoutText()}\n${evalIo.stderrText()}`,
    ).toBe(0);
    const evalResult = JSON.parse(evalIo.stdoutText()) as {
      ok?: boolean;
      evaluation?: {
        metrics?: Record<string, { mean?: number }>;
      };
    };
    expect(evalResult.ok).toBe(true);
    expect(evalResult.evaluation?.metrics?.score?.mean).toBe(1);
    expect(evalResult.evaluation?.metrics?.exact?.mean).toBe(1);

    const archive = await loadLocalArchive(workspace);
    expect(archive.candidates[0]).not.toHaveProperty("metrics");
    expect(archive.candidates[0]?.eval?.metrics?.score.mean).toBe(1);
    expect(archive.candidates[0]?.eval?.metrics?.exact.mean).toBe(1);
    const sampleCases = archive.candidates[0]?.eval?.samples[0]?.cases ?? [];
    expect(sampleCases.map((sampleCase) => sampleCase.id).sort()).toEqual([
      "case-runner-only",
      "case-separate",
      "case-shared",
    ]);
    for (const sampleCase of sampleCases) {
      expect(sampleCase).toMatchObject({
        metrics: { score: 1, exact: 1 },
      });
    }
    expect(sampleCases.find((sampleCase) => sampleCase.id === "case-separate")).toMatchObject({
      criteria: [{
        criterion_id: "exact",
        score: 1,
        pass: true,
      }],
    });
    expect(sampleCases.find((sampleCase) => sampleCase.id === "case-runner-only")?.criteria ?? []).toEqual([]);
    const run = archive.runs.find((entry) => entry.workflow === "eval") as (typeof archive.runs)[number] & { score?: unknown };
    expect(run).toMatchObject({
      workflow: "eval",
      outcome: "ok",
      engineRun: "external-host-engine",
    });
    expect(run.score).toBeUndefined();
  });

  test("rejects zero-budget local runs before executing work", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-local-budget-"));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect(await runCli(["init", workspace, "--command", "local-command-eval", "--json"], createIo())).toBe(0);
    await writeDockerNodeWorkbenchSpec(workspace);
    const io = createIo();
    const exitCode = await runCli(["improve", "--dir", workspace, "--budget", "0", "--json"], io);

    expect(exitCode).toBe(2);
    expect(io.stdoutText()).toContain("--budget must be a positive integer.");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("rejects oversized local runs before executing work", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-local-budget-max-"));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect(await runCli(["init", workspace, "--command", "local-command-eval", "--json"], createIo())).toBe(0);
    await writeDockerNodeWorkbenchSpec(workspace);
    const io = createIo();
    const exitCode = await runCli(["improve", "--dir", workspace, "--budget", "21", "--json"], io);

    expect(exitCode).toBe(2);
    expect(io.stdoutText()).toContain("Run budget cannot exceed 20.");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("keeps skill guidance on benchmark Dockerfile runtime", async () => {
    const skill = await readFile(path.join(productRoot, "skills", "workbench", "SKILL.md"), "utf8");
    const manifest = await readFile(path.join(productRoot, "skills.json"), "utf8");

    expect(skill).toContain("engine.with.environment.dockerfile");
    expect(skill).toContain("ca-certificates");
    expect(manifest).toContain("Dockerfile");
    expect(manifest).toContain("\"state\": \"published\"");
    expect(manifest).toContain("\"workbench-ai/workbench\"");
  });

  test("assembles installable skill assets from authored sources", async () => {
    const { syncSkillAssets } = await import(pathToFileURL(path.join(productRoot, "scripts", "sync-skill-assets.mjs")).href) as {
      syncSkillAssets: (args: {
        sourceRepoRoot: string;
        sourceSkillRoot: string;
        targetSkillRoot: string;
      }) => Promise<void>;
    };
    const assembledRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-skill-sync-"));

    await syncSkillAssets({
      sourceRepoRoot: productRoot,
      sourceSkillRoot: path.join(productRoot, "skills", "workbench"),
      targetSkillRoot: assembledRoot,
    });

    const generatedTree = await readTextTree(assembledRoot);
    expect(generatedTree).toHaveProperty("SKILL.md");
    expect(generatedTree).not.toHaveProperty("skill.assets.json");
    const generatedSkill = await readFile(path.join(assembledRoot, "SKILL.md"), "utf8");
    expect(generatedSkill).toContain("workbench push");
    expect(generatedSkill).toContain("engine.with.environment.dockerfile");
    expect(generatedSkill).toContain("ca-certificates");
    expect(generatedSkill).toContain("engine.with.score: { use: tests }");
  });

  test("keeps eval authoring guidance routed through the Workbench skill", async () => {
    const skill = await readFile(path.join(productRoot, "skills", "workbench", "SKILL.md"), "utf8");
    const evalReadme = await readFile(path.join(productRoot, "docs", "evals", "README.md"), "utf8");
    const fileOutputGuide = await readFile(path.join(productRoot, "docs", "evals", "from-file-outputs.md"), "utf8");
    const skillEvals = await readFile(path.join(productRoot, "skills", "workbench", "evals", "evals.json"), "utf8");

    expect(skill).toContain("references/docs/evals/README.md");
    expect(skill).toContain("from-existing-workflow.md");
    expect(skill).toContain("from-file-outputs.md");
    expect(evalReadme).toContain("Existing workflow");
    expect(evalReadme).toContain("File-output cases");
    expect(skill).toContain("Default to `engine.with.score: { use: rubric");
    expect(fileOutputGuide).toContain("Do not write a custom scoring helper just because a case produces binary files");
    expect(fileOutputGuide).toContain(".docx");
    expect(fileOutputGuide).toContain(".xlsx");
    expect(fileOutputGuide).toContain(".pdf");
    expect(fileOutputGuide).toContain(".pptx");
    await expect(stat(path.join(productRoot, "docs", "evals", "templates"))).rejects.toBeTruthy();
    expect(skillEvals).toContain("existing-workflow-eval-authoring");
    expect(skillEvals).toContain("file-output-case-eval-authoring");
  });

  test("command help exits before network or auth side effects", async () => {
    const io = createIo();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const exitCode = await runCli(["login", "--help"], io);

    expect(exitCode).toBe(0);
    expect(io.stdoutText()).toContain("workbench login");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("adapter auth connect stores default profile bundles for local status", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-auth-home-"));
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-codex-auth-project-"));
    const profileRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-codex-profile-"));
    vi.stubEnv("HOME", home);
    await mkdir(path.join(profileRoot, ".codex"), { recursive: true });
    await writeFile(path.join(profileRoot, ".codex", "auth.json"), JSON.stringify({ token: "test" }));
    expect(await runCli(["init", workspace, "--skill", "codex-auth", "--agent", "codex", "--json"], createIo())).toBe(0);

    const connectIo = createIo();
    const connectExitCode = await runCli([
      "auth",
      "connect",
      "codex",
      "--dir",
      workspace,
      "--profile-root",
      profileRoot,
      "--local-only",
      "--json",
    ], connectIo);

    expect(connectExitCode).toBe(0);
    expect(JSON.parse(connectIo.stdoutText())).toMatchObject({
      ok: true,
      adapter: "codex",
      method: "oauth",
      status: "connected",
      remote: {
        status: "skipped",
        reason: "local_only",
      },
    });

    const statusIo = createIo();
    expect(await runCli(["whoami", "--dir", workspace, "--json"], statusIo)).toBe(0);
    const status = JSON.parse(statusIo.stdoutText()) as { adapterAuth: Array<{ adapter: string; local: { status: string; method?: string } }> };
    expect(status.adapterAuth).toContainEqual(expect.objectContaining({
      adapter: "codex",
      local: expect.objectContaining({ status: "connected", method: "oauth" }),
    }));
  });

  test("adapter auth connect stores manifest-declared api-key bundles", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-adapter-auth-home-"));
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-adapter-auth-project-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("MY_AGENT_API_KEY", "test-adapter-key");

    expect(await runCli(["init", workspace, "--command", "adapter-eval", "--json"], createIo())).toBe(0);
    expect(await runCli(["adapters", "create", "adapters/my-agent", "--dir", workspace, "--json"], createIo())).toBe(0);
    const manifestPath = path.join(workspace, "adapters", "my-agent", "workbench.adapter.yaml");
    await writeFile(manifestPath, [
      "id: my-agent",
      "protocol: workbench.adapter.v3",
      "setup:",
      "  - npm install --global .",
      "operations:",
      "  candidate.run: {}",
      "auth:",
      "  methods:",
      "    api-key:",
      "      env:",
      "        - name: MY_AGENT_API_KEY",
      "",
    ].join("\n"));
    await appendCandidateAdapters(workspace, ["../../adapters/my-agent"]);

    const connectIo = createIo();
    expect(await runCli([
      "auth",
      "connect",
      "my-agent",
      "--dir",
      workspace,
      "--method",
      "api-key",
      "--local-only",
      "--json",
    ], connectIo)).toBe(0);
    expect(JSON.parse(connectIo.stdoutText())).toMatchObject({
      ok: true,
      adapter: "my-agent",
      profile: "default",
      method: "api-key",
      status: "connected",
    });

    const statusIo = createIo();
    expect(await runCli(["whoami", "--dir", workspace, "--json"], statusIo)).toBe(0);
    const status = JSON.parse(statusIo.stdoutText()) as {
      adapterStatuses: Array<{ adapterId: string; status: string; method?: string }>;
    };
    expect(status.adapterStatuses).toContainEqual(expect.objectContaining({
      adapterId: "my-agent",
      status: "connected",
      method: "api-key",
    }));
  });

  test("adapter auth connect stores manifest-declared profile files and command env", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-adapter-auth-home-"));
    const profileRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-adapter-profile-"));
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-adapter-profile-project-"));
    vi.stubEnv("HOME", home);

    expect(await runCli(["init", workspace, "--command", "adapter-eval", "--json"], createIo())).toBe(0);
    expect(await runCli(["adapters", "create", "adapters/my-agent", "--dir", workspace, "--json"], createIo())).toBe(0);
    await mkdir(path.join(profileRoot, ".my-agent"), { recursive: true });
    await writeFile(path.join(profileRoot, ".my-agent", "config.json"), JSON.stringify({ token: "profile-token" }));
    const manifestPath = path.join(workspace, "adapters", "my-agent", "workbench.adapter.yaml");
    await writeFile(manifestPath, [
      "id: my-agent",
      "protocol: workbench.adapter.v3",
      "setup:",
      "  - npm install --global .",
      "operations:",
      "  candidate.run: {}",
      "auth:",
      "  methods:",
      "    profile:",
      "      files:",
      "        - path: .my-agent/config.json",
      "    oauth:",
      "      command: node -e 'console.log(JSON.stringify({env:{MY_AGENT_TOKEN:\"cmd-token\"}}))'",
      "",
    ].join("\n"));
    await appendCandidateAdapters(workspace, ["../../adapters/my-agent"]);

    const profileIo = createIo();
    expect(await runCli([
      "auth",
      "connect",
      "my-agent",
      "--dir",
      workspace,
      "--method",
      "profile",
      "--profile-root",
      profileRoot,
      "--profile",
      "dev",
      "--local-only",
      "--json",
    ], profileIo)).toBe(0);

    const commandIo = createIo();
    expect(await runCli([
      "auth",
      "connect",
      "my-agent",
      "--dir",
      workspace,
      "--method",
      "oauth",
      "--local-only",
      "--json",
    ], commandIo)).toBe(0);

    const profileRecord = JSON.parse(
      await readFile(path.join(home, ".workbench", "adapter-auth", "my-agent_____dev.json"), "utf8"),
    ) as { bundle?: { files?: Array<{ path: string; content: string }> } };
    expect(profileRecord.bundle?.files).toContainEqual(expect.objectContaining({
      path: ".my-agent/config.json",
      content: JSON.stringify({ token: "profile-token" }),
    }));
    const commandRecord = JSON.parse(
      await readFile(path.join(home, ".workbench", "adapter-auth", "my-agent_____default.json"), "utf8"),
    ) as { bundle?: { env?: Array<{ name: string; value: string }> } };
    expect(commandRecord.bundle?.env).toContainEqual({
      name: "MY_AGENT_TOKEN",
      value: "cmd-token",
    });
  });

  test("whoami shows hosted adapter auth for project-required default profiles", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-hosted-auth-status-home-"));
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-hosted-auth-status-project-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    await mkdir(path.join(home, ".workbench"), { recursive: true });
    await writeFile(path.join(home, ".workbench", "workbench.json"), JSON.stringify({
      baseUrl: "http://workbench.test",
      accessToken: "test-token",
    }));
    expect(await runCli(["init", workspace, "--command", "adapter-eval", "--json"], createIo())).toBe(0);
    expect(await runCli(["adapters", "create", "adapters/my-agent", "--dir", workspace, "--json"], createIo())).toBe(0);
    const manifestPath = path.join(workspace, "adapters", "my-agent", "workbench.adapter.yaml");
    await writeFile(manifestPath, [
      "id: my-agent",
      "protocol: workbench.adapter.v3",
      "setup:",
      "  - npm install --global .",
      "operations:",
      "  candidate.run: {}",
      "auth:",
      "  methods:",
      "    api-key:",
      "      env:",
      "        - name: MY_AGENT_API_KEY",
      "",
    ].join("\n"));
    await appendCandidateAdapters(workspace, ["../../adapters/my-agent"]);
    const specPath = commandCandidateSpecPath(workspace);
    const specSource = await readFile(specPath, "utf8");
    await writeFile(specPath, specSource.replace(
      /runs:\n  main:\n    name: Command\n    use: command\n    with:\n      command: .+/u,
      "runs:\n  main:\n    name: My agent\n    use: my-agent",
    ));

    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "http://workbench.test/api/workbench/auth/adapters") {
        return Response.json({
          ok: true,
          adapters: [{
            adapterId: "my-agent",
            profile: "default",
            status: "connected",
            version: 1,
            method: "api-key",
          }],
        });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const statusIo = createIo();
    expect(await runCli(["whoami", "--dir", workspace, "--json"], statusIo)).toBe(0);
    expect(JSON.parse(statusIo.stdoutText()).adapterAuth).toContainEqual(expect.objectContaining({
      adapter: "my-agent",
      profile: "default",
      local: expect.objectContaining({ status: "disconnected" }),
      hosted: expect.objectContaining({ status: "connected", method: "api-key" }),
    }));
  });

  test("whoami treats server-rejected CLI tokens as unauthenticated", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-stale-auth-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    await mkdir(path.join(home, ".workbench"), { recursive: true });
    await writeFile(path.join(home, ".workbench", "workbench.json"), JSON.stringify({
      baseUrl: "http://workbench.test",
      accessToken: "stale-token",
    }));
    const fetch = vi.fn(async (url: string) => {
      if (url === "http://workbench.test/api/workbench/profile") {
        return Response.json({ profile: null }, { status: 401 });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetch);

    const statusIo = createIo();
    expect(await runCli(["whoami", "--json"], statusIo)).toBe(0);

    expect(JSON.parse(statusIo.stdoutText())).toMatchObject({
      workbench: {
        baseUrl: "http://workbench.test",
        authenticated: false,
        username: null,
      },
      hostedAuth: {
        adapters: [],
        error: "not_authenticated",
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("whoami follows manifest-declared nested adapter refs", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-nested-auth-status-home-"));
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-nested-auth-status-project-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    await mkdir(path.join(home, ".workbench"), { recursive: true });
    await writeFile(path.join(home, ".workbench", "workbench.json"), JSON.stringify({
      baseUrl: "http://workbench.test",
      accessToken: "test-token",
    }));
    expect(await runCli(["init", workspace, "--command", "adapter-eval", "--json"], createIo())).toBe(0);
    expect(await runCli(["adapters", "create", "adapters/orchestrator", "--dir", workspace, "--json"], createIo())).toBe(0);
    expect(await runCli(["adapters", "create", "adapters/secret-agent", "--dir", workspace, "--json"], createIo())).toBe(0);
    await writeFile(path.join(workspace, "adapters", "orchestrator", "workbench.adapter.yaml"), [
      "id: orchestrator",
      "protocol: workbench.adapter.v3",
      "setup:",
      "  - npm install --global .",
      "operations:",
      "  candidate.run: {}",
      "slots:",
      "  child:",
      "    path: /child",
      "    operation: candidate.run",
      "",
    ].join("\n"));
    await writeFile(path.join(workspace, "adapters", "secret-agent", "workbench.adapter.yaml"), [
      "id: secret-agent",
      "protocol: workbench.adapter.v3",
      "setup:",
      "  - npm install --global .",
      "operations:",
      "  candidate.run: {}",
      "auth:",
      "  methods:",
      "    api-key:",
      "      env:",
      "        - name: SECRET_AGENT_KEY",
      "",
    ].join("\n"));
    await appendCandidateAdapters(workspace, ["../../adapters/orchestrator", "../../adapters/secret-agent"]);
    const specPath = commandCandidateSpecPath(workspace);
    const specSource = await readFile(specPath, "utf8");
    await writeFile(specPath, specSource.replace(
      /runs:\n  main:\n    name: Command\n    use: command\n    with:\n      command: .+/u,
      "runs:\n  main:\n    name: Orchestrator\n    use: orchestrator\n    with:\n      child:\n        use: secret-agent",
    ));

    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "http://workbench.test/api/workbench/auth/adapters") {
        return Response.json({
          ok: true,
          adapters: [{
            adapterId: "secret-agent",
            profile: "default",
            status: "connected",
            version: 1,
            method: "api-key",
          }],
        });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const statusIo = createIo();
    expect(await runCli(["whoami", "--dir", workspace, "--json"], statusIo)).toBe(0);
    expect(JSON.parse(statusIo.stdoutText()).adapterAuth).toContainEqual(expect.objectContaining({
      adapter: "secret-agent",
      profile: "default",
      local: expect.objectContaining({ status: "disconnected" }),
      hosted: expect.objectContaining({ status: "connected", method: "api-key" }),
    }));
  });

  test("whoami expands default profiles for manifest-declared auth slots", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-slot-auth-status-home-"));
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-slot-auth-status-project-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    await mkdir(path.join(home, ".workbench"), { recursive: true });
    await writeFile(path.join(home, ".workbench", "workbench.json"), JSON.stringify({
      baseUrl: "http://workbench.test",
      accessToken: "test-token",
    }));
    expect(await runCli(["init", workspace, "--command", "slot-eval", "--json"], createIo())).toBe(0);
    expect(await runCli(["adapters", "create", "adapters/deployer", "--dir", workspace, "--json"], createIo())).toBe(0);
    await writeFile(path.join(workspace, "adapters", "deployer", "workbench.adapter.yaml"), [
      "id: deployer",
      "protocol: workbench.adapter.v3",
      "setup:",
      "  - npm install --global .",
      "operations:",
      "  candidate.run: {}",
      "auth:",
      "  slots:",
      "    github:",
      "      methods:",
      "        oauth:",
      "          command: deployer auth github --json",
      "    llm:",
      "      methods:",
      "        api-key:",
      "          env:",
      "            - name: DEPLOYER_LLM_API_KEY",
      "",
    ].join("\n"));
    await appendCandidateAdapters(workspace, ["../../adapters/deployer"]);
    const specPath = commandCandidateSpecPath(workspace);
    const specSource = await readFile(specPath, "utf8");
    await writeFile(specPath, specSource.replace(
      /runs:\n  main:\n    name: Command\n    use: command\n    with:\n      command: .+/u,
      "runs:\n  main:\n    name: Deployer\n    use: deployer",
    ));

    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "http://workbench.test/api/workbench/auth/adapters") {
        return Response.json({ ok: true, adapters: [] });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const statusIo = createIo();
    expect(await runCli(["whoami", "--dir", workspace, "--json"], statusIo)).toBe(0);
    const status = JSON.parse(statusIo.stdoutText()) as {
      adapterAuth: Array<{ adapter: string; slot?: string; profile: string }>;
    };
    expect(status.adapterAuth).toEqual(expect.arrayContaining([
      expect.objectContaining({ adapter: "deployer", slot: "github", profile: "default" }),
      expect.objectContaining({ adapter: "deployer", slot: "llm", profile: "default" }),
    ]));
  });

  test("adapter auth connect accepts Claude Code OAuth profile files", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-auth-home-"));
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-claude-auth-project-"));
    const profileRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-claude-profile-"));
    vi.stubEnv("HOME", home);
    await mkdir(path.join(profileRoot, ".claude"), { recursive: true });
    await writeFile(path.join(profileRoot, ".claude.json"), JSON.stringify({
      oauthAccount: {
        emailAddress: "user@example.com",
      },
    }));
    await writeFile(path.join(profileRoot, ".claude", "oauth-token"), "sk-ant-oat01-test_token\n");
    expect(await runCli(["init", workspace, "--skill", "claude-auth", "--agent", "claude", "--json"], createIo())).toBe(0);

    const connectIo = createIo();
    const connectExitCode = await runCli([
      "auth",
      "connect",
      "claude",
      "--dir",
      workspace,
      "--profile-root",
      profileRoot,
      "--local-only",
      "--json",
    ], connectIo);

    expect(connectExitCode).toBe(0);
    expect(JSON.parse(connectIo.stdoutText())).toMatchObject({
      ok: true,
      adapter: "claude",
      method: "oauth",
      status: "connected",
      remote: {
        status: "skipped",
        reason: "local_only",
      },
    });

    const statusIo = createIo();
    expect(await runCli(["whoami", "--dir", workspace, "--json"], statusIo)).toBe(0);
    const status = JSON.parse(statusIo.stdoutText()) as { adapterAuth: Array<{ adapter: string; local: { status: string; method?: string } }> };
    expect(status.adapterAuth).toContainEqual(expect.objectContaining({
      adapter: "claude",
      local: expect.objectContaining({ status: "connected", method: "oauth" }),
    }));
  });

  test("adapter auth connect allows optional Claude OAuth companion files to be absent", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-auth-home-"));
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-claude-auth-project-"));
    const profileRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-claude-profile-"));
    vi.stubEnv("HOME", home);
    await writeFile(path.join(profileRoot, ".claude.json"), JSON.stringify({
      oauthAccount: {
        emailAddress: "user@example.com",
      },
    }));
    expect(await runCli(["init", workspace, "--skill", "claude-auth", "--agent", "claude", "--json"], createIo())).toBe(0);

    const connectIo = createIo();
    const connectExitCode = await runCli([
      "auth",
      "connect",
      "claude",
      "--dir",
      workspace,
      "--profile-root",
      profileRoot,
      "--local-only",
      "--json",
    ], connectIo);

    expect(connectExitCode).toBe(0);
    expect(JSON.parse(connectIo.stdoutText())).toMatchObject({
      ok: true,
      adapter: "claude",
      method: "oauth",
      status: "connected",
    });
  });

  test("adapter auth connect stores Codex API key auth", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-auth-home-"));
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-codex-auth-project-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("OPENAI_API_KEY", "sk-test-codex");
    expect(await runCli(["init", workspace, "--skill", "codex-auth", "--agent", "codex", "--json"], createIo())).toBe(0);

    const connectIo = createIo();
    const connectExitCode = await runCli([
      "auth",
      "connect",
      "codex",
      "--dir",
      workspace,
      "--method",
      "api-key",
      "--local-only",
      "--json",
    ], connectIo);

    expect(connectExitCode).toBe(0);
    expect(JSON.parse(connectIo.stdoutText())).toMatchObject({
      ok: true,
      adapter: "codex",
      method: "api-key",
      status: "connected",
    });

    const statusIo = createIo();
    expect(await runCli(["whoami", "--dir", workspace, "--json"], statusIo)).toBe(0);
    const status = JSON.parse(statusIo.stdoutText()) as { adapterAuth: Array<{ adapter: string; local: { status: string; method?: string } }> };
    expect(status.adapterAuth).toContainEqual(expect.objectContaining({
      adapter: "codex",
      local: expect.objectContaining({ status: "connected", method: "api-key" }),
    }));
  });

  test("adapter auth connect stores Claude API key auth", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-auth-home-"));
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-claude-auth-project-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-api03-test");
    expect(await runCli(["init", workspace, "--skill", "claude-auth", "--agent", "claude", "--json"], createIo())).toBe(0);

    const connectIo = createIo();
    const connectExitCode = await runCli([
      "auth",
      "connect",
      "claude",
      "--dir",
      workspace,
      "--method",
      "api-key",
      "--local-only",
      "--json",
    ], connectIo);

    expect(connectExitCode).toBe(0);
    expect(JSON.parse(connectIo.stdoutText())).toMatchObject({
      ok: true,
      adapter: "claude",
      method: "api-key",
      status: "connected",
    });
  });

  test("adapter auth connect stores Claude Bedrock auth", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-auth-home-"));
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-claude-auth-project-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("CLAUDE_CODE_USE_BEDROCK", "1");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIATEST");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("ANTHROPIC_MODEL", "us.anthropic.claude-sonnet-4-5-20250929-v1:0");
    expect(await runCli(["init", workspace, "--skill", "claude-auth", "--agent", "claude", "--json"], createIo())).toBe(0);

    const connectIo = createIo();
    const connectExitCode = await runCli([
      "auth",
      "connect",
      "claude",
      "--dir",
      workspace,
      "--method",
      "bedrock",
      "--local-only",
      "--json",
    ], connectIo);

    expect(connectExitCode).toBe(0);
    expect(JSON.parse(connectIo.stdoutText())).toMatchObject({
      ok: true,
      adapter: "claude",
      method: "bedrock",
      status: "connected",
    });
  });

  test("adapter auth connect stores Claude Bedrock bearer-token auth", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-auth-home-"));
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-claude-auth-project-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("CLAUDE_CODE_USE_BEDROCK", "1");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
    vi.stubEnv("AWS_PROFILE", "");
    vi.stubEnv("AWS_BEARER_TOKEN_BEDROCK", "bedrock-bearer-token");
    vi.stubEnv("AWS_REGION", "us-east-1");
    expect(await runCli(["init", workspace, "--skill", "claude-auth", "--agent", "claude", "--json"], createIo())).toBe(0);

    const connectIo = createIo();
    const connectExitCode = await runCli([
      "auth",
      "connect",
      "claude",
      "--dir",
      workspace,
      "--method",
      "bedrock",
      "--local-only",
      "--json",
    ], connectIo);

    expect(connectExitCode).toBe(0);
    expect(JSON.parse(connectIo.stdoutText())).toMatchObject({
      ok: true,
      adapter: "claude",
      method: "bedrock",
      status: "connected",
    });

    const authFiles = await readdir(path.join(home, ".workbench", "adapter-auth"));
    const record = JSON.parse(await readFile(
      path.join(home, ".workbench", "adapter-auth", authFiles.find((file) => file.startsWith("claude__"))!),
      "utf8",
    )) as { bundle?: { env?: Array<{ name: string; value: string }> } };
    expect(record.bundle?.env).toEqual(expect.arrayContaining([
      { name: "CLAUDE_CODE_USE_BEDROCK", value: "1" },
      { name: "AWS_BEARER_TOKEN_BEDROCK", value: "bedrock-bearer-token" },
      { name: "AWS_REGION", value: "us-east-1" },
    ]));
    expect(record.bundle?.env?.some((entry) => entry.name === "AWS_ACCESS_KEY_ID")).toBe(false);
    expect(record.bundle?.env?.some((entry) => entry.name === "AWS_SECRET_ACCESS_KEY")).toBe(false);
  });

  test("pushes hosted benchmarks through the configured API", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-push-cli-"));
    expect(await runCli(["init", root, "--command", "demo", "--json"], createIo())).toBe(0);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (url === "http://workbench.test/api/workbench/benchmarks/state" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as WorkbenchProjectState;
        expect(body.project.visibility).toBe("public");
        return Response.json(projectStateImportFixture({
          id: "wb_123456789abc",
          name: "demo",
          owner: "alice",
          revisionId: "spec_0001",
          sourceFingerprint: "fp_0001",
          changed: true,
          sourceChanged: true,
          runtime: body.runtime,
        }), { status: 201 });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli(["push", "--dir", root], io);

    expect(exitCode).toBe(0);
    expect(io.stdoutText()).toContain("Pushed alice/demo (wb_123456789abc)");
    expect(io.stdoutText()).toContain("Open benchmark: http://workbench.test/benchmarks/alice/demo");
    const createdOrigin = JSON.parse(await readFile(path.join(root, ".workbench", "origin.json"), "utf8"));
    expectTargetOriginKeys(createdOrigin);
    expect(createdOrigin).toMatchObject({
      projectId: "wb_123456789abc",
      remote: "alice/demo",
      baseUrl: "http://workbench.test",
      sourceRevisionId: "spec_0001",
      sourceFingerprint: "fp_0001",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://workbench.test/api/workbench/benchmarks/state");
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      schema: "workbench.project.state.v1",
      source: {
        source: expect.stringContaining("name: demo"),
        dockerfile: expect.stringContaining("FROM"),
        runtimeDockerfile: expect.stringContaining("FROM"),
        candidateFiles: expect.arrayContaining([
          expect.objectContaining({ path: "prepare.sh" }),
          expect.objectContaining({ path: "run.js" }),
        ]),
        engineResolveFiles: expect.arrayContaining([
          expect.objectContaining({ path: "task-001/task.yaml" }),
          expect.objectContaining({ path: "task-001/tests/required-output.txt" }),
        ]),
        network: "off",
        resources: {},
      },
      runtime: emptyRuntimeBundle(),
    });
  });

  test("does not write origins before source-first push succeeds", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-push-failed-create-"));
    expect(await runCli(["init", root, "--command", "demo", "--json"], createIo())).toBe(0);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "http://workbench.test/api/workbench/benchmarks/state") {
        return Response.json({ error: "benchmark name already exists" }, { status: 400 });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli(["push", "--dir", root], io);

    expect(exitCode).toBe(1);
    expect(io.stderrText()).toContain("benchmark name already exists");
    await expect(readFile(path.join(root, ".workbench", "origin.json"), "utf8"))
      .rejects
      .toMatchObject({ code: "ENOENT" });
  });

  test("clones public benchmarks by owner and benchmark name", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-clone-public-home-"));
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-clone-public-"));
    const output = path.join(root, "downloaded");
    vi.stubEnv("HOME", home);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "http://workbench.test/api/workbench/public/benchmarks/alice/demo/state") {
        return Response.json(projectStateFixture({
          id: "wb_123456789abc",
          owner: "alice",
          name: "demo",
          revisionId: "spec_0001",
          sourceFingerprint: "fp_0001",
          files: [
            { path: "benchmark.yaml", content: "version: 4\nname: demo\ndescription: Demo benchmark.\nengine:\n  use: workbench\n  with:\n    environment:\n      dockerfile: environment/Dockerfile\n    score:\n      use: command\n      with:\n        command: 'true'\n" },
            { path: "candidates/command/candidate.yaml", content: "version: 4\nname: demo\nfiles:\n  path: files\nprepare:\n  command: sh input/candidate/prepare.sh\ndefaultRun: command\nruns:\n  command:\n    name: Command\n    use: command\n    with:\n      command: node run.js\n" },
            { path: "candidates/command/files/prepare.sh", content: "#!/usr/bin/env sh\nset -eu\ncp -R input/candidate/. .\n" },
            { path: "candidates/command/files/run.js", content: "console.log('ok')\n" },
            { path: "environment/Dockerfile", content: "FROM node:22-alpine\n" },
            { path: "tasks/case-a/task.yaml", content: "version: 3\ntask: test\n" },
          ],
        }));
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli(["clone", "alice/demo", output, "--json"], io);

    expect(exitCode).toBe(0);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      ok: true,
      outputDir: output,
      files: 6,
      origin: {
        projectId: "wb_123456789abc",
        remote: "alice/demo",
        baseUrl: "http://workbench.test",
        sourceRevisionId: "spec_0001",
        sourceFingerprint: expect.any(String),
      },
    });
    const clonedOrigin = JSON.parse(await readFile(path.join(output, ".workbench", "origin.json"), "utf8"));
    expectTargetOriginKeys(clonedOrigin);
    expect(clonedOrigin).toMatchObject({
      projectId: "wb_123456789abc",
      remote: "alice/demo",
      baseUrl: "http://workbench.test",
    });
    expect(requests).toEqual([
      "GET http://workbench.test/api/workbench/public/benchmarks/alice/demo/state",
    ]);
  });

  test("clone then pull treats runtime candidate files as canonical surface files", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-clone-pull-runtime-home-"));
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-clone-pull-runtime-"));
    const output = path.join(root, "downloaded");
    vi.stubEnv("HOME", home);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const runtime: WorkbenchRuntimeBundle = {
      schema: "workbench.runtime.bundle.v1",
      activeId: "candidate_1",
      candidates: [{
        id: "candidate_1",
        version: 1,
        ordinal: 1,
        benchmarkFingerprint: "benchmark",
        candidateFingerprint: "candidate",
        visibility: "public",
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "evaluated",
        referenceIds: [],
        fileChanges: [],
      } as CandidateRecord],
      candidateFiles: [{
        candidateId: "candidate_1",
        files: [
          {
            path: "run.js",
            encoding: "utf8",
            kind: "text",
            content: "console.log('ok')\n",
            executable: false,
          },
        ],
      }],
      evaluations: [],
      runs: [],
      jobs: [{
        output: {
          files: [],
          ok: true,
        },
        input: {
          execution: {
            purpose: "attempt",
          },
        },
        id: "job_1",
        runId: "run_1",
        candidateId: "candidate_1",
        projectId: "wb_123456789abc",
        kind: "execution",
        status: "finished",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
      } as HostedWorkbenchJob],
      executionFiles: [],
      events: [],
    };
    const sourceFiles = [
      { path: "benchmark.yaml", content: "version: 4\nname: demo\ndescription: Demo benchmark.\nengine:\n  use: workbench\n  with:\n    environment:\n      dockerfile: environment/Dockerfile\n    score:\n      use: command\n      with:\n        command: 'true'\n" },
      { path: "candidates/command/candidate.yaml", content: "version: 4\nname: demo\nfiles:\n  path: files\ndefaultRun: command\nruns:\n  command:\n    name: Command\n    use: command\n    with:\n      command: node run.js\n" },
      { path: "candidates/command/files/run.js", content: "console.log('ok')\n" },
      { path: "environment/Dockerfile", content: "FROM node:22-alpine\n" },
      { path: "tasks/case-a/task.yaml", content: "version: 3\ntask: test\n" },
    ];
    const sourceRoot = path.join(root, "source");
    for (const file of sourceFiles) {
      await mkdir(path.dirname(path.join(sourceRoot, file.path)), { recursive: true });
      await writeFile(path.join(sourceRoot, file.path), file.content);
    }
    const sourceFingerprint = await currentSourceFingerprint(sourceRoot);
    const state = projectStateFixture({
      id: "wb_123456789abc",
      owner: "alice",
      name: "demo",
      revisionId: "spec_0001",
      sourceFingerprint,
      runtime,
      files: sourceFiles,
    });
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "http://workbench.test/api/workbench/public/benchmarks/alice/demo/state") {
        return Response.json(state);
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    expect(await runCli(["clone", "alice/demo", output, "--json"], createIo())).toBe(0);

    const io = createIo();
    expect(await runCli(["pull", "--dir", output, "--json"], io), io.stderrText() || io.stdoutText()).toBe(0);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      ok: true,
      runtime: {
        candidates: 1,
        candidateFiles: 1,
      },
    });
    expect(requests).toEqual([
      "GET http://workbench.test/api/workbench/public/benchmarks/alice/demo/state",
      "GET http://workbench.test/api/workbench/public/benchmarks/alice/demo/state",
    ]);
  });

  test("runtime import is idempotent for hosted-enriched copies of the same facts", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-runtime-idempotent-"));
    const candidateId = "candidate_same";
    const runId = "run_same";
    const evaluationId = "eval_same";
    const jobId = "job_same";
    const candidate: CandidateRecord = {
      id: candidateId,
      name: "Skill",
      version: 1,
      ordinal: 1,
      benchmarkFingerprint: "benchmark-fp",
      candidateFingerprint: "candidate-fp",
      visibility: "private",
      createdAt: "2026-05-28T00:00:00.000Z",
      referenceIds: [],
      status: "running",
      fileChanges: ["prompt.md"],
      eval: {
        metrics: { score: 0.5 },
        samples: [],
      } as unknown as CandidateRecord["eval"],
    };
    const evaluation = {
      id: evaluationId,
      runId,
      benchmarkFingerprint: candidate.benchmarkFingerprint,
      candidateFingerprint: candidate.candidateFingerprint,
      candidateId,
      candidateName: "Skill",
      candidateVersion: 1,
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:01.000Z",
      status: "running",
      sampleCount: 1,
      completedSampleCount: 0,
      errorSampleCount: 0,
      evaluation: {
        id: evaluationId,
        runId,
        benchmarkFingerprint: candidate.benchmarkFingerprint,
        candidateFingerprint: candidate.candidateFingerprint,
        candidateId,
        candidateVersion: 1,
        samples: [],
      },
    } as unknown as EvaluationScorecard;
    const run = localRunSummary({
      id: runId,
      benchmarkFingerprint: candidate.benchmarkFingerprint,
      candidateId,
      outputCandidateId: candidateId,
      activeCandidateId: candidateId,
      status: "running",
    });
    const job = {
      id: jobId,
      projectId: "local",
      runId,
      candidateId,
      kind: "execute",
      status: "running",
      attempt: 1,
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:01.000Z",
      startedAt: "2026-05-28T00:00:00.000Z",
      input: { execution: { purpose: "attempt" } },
      output: { ok: true, files: [textFile("transient.txt", "local\n")] },
    } as unknown as HostedWorkbenchJob;
    await saveLocalArchive(workspace, {
      activeId: candidateId,
      candidates: [candidate],
      candidateFiles: {
        [candidateId]: [textFile("prompt.md", "candidate\n")],
      },
      evaluations: [evaluation],
      runs: [run],
      events: [],
    });
    await saveLocalJobs(workspace, [job]);

    const hostedBundle: WorkbenchRuntimeBundle = {
      schema: "workbench.runtime.bundle.v1",
      activeId: candidateId,
      candidates: [{
        ...candidate,
        version: 3,
        ordinal: 3,
        visibility: "public",
        createdAt: "2026-05-28T00:02:00.000Z",
        status: "evaluated",
        fileChanges: ["hosted-rollup.md"],
      }],
      candidateFiles: [{
        candidateId,
        files: [textFile("prompt.md", "candidate\n")],
      }],
      evaluations: [{
        ...evaluation,
        updatedAt: "2026-05-28T00:00:03.000Z",
        status: "completed",
        completedSampleCount: 1,
        metrics: { score: { mean: 1, count: 1 } },
      } as unknown as EvaluationScorecard],
      runs: [{
        ...run,
        status: "finished",
        outcome: "ok",
        attemptsExecuted: 1,
        completedJobCount: 1,
        failedJobCount: 0,
        finishedAt: "2026-05-28T00:00:03.000Z",
      }],
      jobs: [{
        ...job,
        projectId: "wb_123456789abc",
        status: "succeeded",
        updatedAt: "2026-05-28T00:00:03.000Z",
        finishedAt: "2026-05-28T00:00:03.000Z",
        output: { ok: true },
      }],
      executionFiles: [{
        jobId,
        files: [textFile("workbench-result.json", "{\"score\":1}\n")],
      }],
      events: [],
    };

    await expect(importLocalRuntimeBundle(workspace, hostedBundle, "benchmark-fp")).resolves.toMatchObject({
      stats: { activeId: candidateId, candidates: 1, evaluations: 1, runs: 1, jobs: 1 },
    });
    await expect(importLocalRuntimeBundle(workspace, hostedBundle, "benchmark-fp")).resolves.toMatchObject({
      stats: { activeId: candidateId, candidates: 1, evaluations: 1, runs: 1, jobs: 1 },
    });
    const archive = await loadLocalArchive(workspace);
    expect(archive.activeId).toBe(candidateId);
    expect(archive.candidates[0]?.status).toBe("evaluated");
    expect(archive.evaluations[0]?.status).toBe("completed");
    expect(archive.runs[0]?.status).toBe("finished");
  });

  test("runtime import clears incompatible active instead of selecting the latest compatible candidate", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-runtime-active-fingerprint-"));
    const oldCandidate: CandidateRecord = {
      id: "candidate_old",
      name: "Skill",
      version: 1,
      ordinal: 1,
      benchmarkFingerprint: "old-benchmark",
      candidateFingerprint: "old-candidate",
      visibility: "private",
      createdAt: "2026-05-28T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
    };
    const currentCandidate: CandidateRecord = {
      ...oldCandidate,
      id: "candidate_current",
      version: 2,
      ordinal: 2,
      benchmarkFingerprint: "current-benchmark",
      candidateFingerprint: "current-candidate",
      createdAt: "2026-05-28T00:01:00.000Z",
    };

    await saveLocalArchive(workspace, {
      activeId: oldCandidate.id,
      candidates: [oldCandidate],
      candidateFiles: {
        [oldCandidate.id]: [textFile("prompt.md", "old\n")],
      },
      evaluations: [],
      runs: [],
      events: [],
    });

    const bundle: WorkbenchRuntimeBundle = {
      schema: "workbench.runtime.bundle.v1",
      activeId: oldCandidate.id,
      candidates: [oldCandidate, currentCandidate],
      candidateFiles: [
        { candidateId: oldCandidate.id, files: [textFile("prompt.md", "old\n")] },
        { candidateId: currentCandidate.id, files: [textFile("prompt.md", "current\n")] },
      ],
      evaluations: [],
      runs: [],
      jobs: [],
      executionFiles: [],
      events: [],
    };

    await expect(importLocalRuntimeBundle(workspace, bundle, "current-benchmark")).resolves.toMatchObject({
      stats: { activeId: null },
    });
    const archive = await loadLocalArchive(workspace);
    expect(archive.activeId).toBeNull();
  });

  test("local runtime archive permits historical evaluation benchmark fingerprints", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-runtime-historical-eval-"));
    const candidate: CandidateRecord = {
      id: "candidate_same",
      name: "Skill",
      version: 1,
      ordinal: 1,
      benchmarkFingerprint: "current-benchmark",
      candidateFingerprint: "candidate-fp",
      visibility: "private",
      createdAt: "2026-05-28T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
    };
    const evaluation = {
      id: "eval_historical",
      runId: "run_historical",
      benchmarkFingerprint: "historical-benchmark",
      candidateFingerprint: candidate.candidateFingerprint,
      candidateId: candidate.id,
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:01.000Z",
      status: "completed",
      sampleCount: 1,
      completedSampleCount: 1,
      errorSampleCount: 0,
    } as EvaluationScorecard;

    await saveLocalArchive(workspace, {
      activeId: null,
      candidates: [candidate],
      candidateFiles: {
        [candidate.id]: [textFile("prompt.md", "candidate\n")],
      },
      evaluations: [evaluation],
      runs: [],
      events: [],
    });

    await expect(loadLocalArchive(workspace)).resolves.toMatchObject({
      candidates: [{ benchmarkFingerprint: "current-benchmark" }],
      evaluations: [{ benchmarkFingerprint: "historical-benchmark" }],
    });
  });

  test("runtime import restores active from explicit run state instead of latest candidate order", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-runtime-active-run-fact-"));
    const incumbent: CandidateRecord = {
      id: "candidate_incumbent",
      name: "Skill",
      version: 1,
      ordinal: 1,
      benchmarkFingerprint: "benchmark",
      candidateFingerprint: "candidate-incumbent",
      visibility: "private",
      createdAt: "2026-05-28T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
    };
    const newerCandidate: CandidateRecord = {
      ...incumbent,
      id: "candidate_newer",
      version: 2,
      ordinal: 2,
      candidateFingerprint: "candidate-newer",
      createdAt: "2026-05-28T00:02:00.000Z",
    };

    const bundle: WorkbenchRuntimeBundle = {
      schema: "workbench.runtime.bundle.v1",
      activeId: null,
      candidates: [incumbent, newerCandidate],
      candidateFiles: [
        { candidateId: incumbent.id, files: [textFile("prompt.md", "incumbent\n")] },
        { candidateId: newerCandidate.id, files: [textFile("prompt.md", "newer\n")] },
      ],
      evaluations: [],
      runs: [
        localRunSummary({
          id: "run_incumbent_eval",
          benchmarkFingerprint: "benchmark",
          candidateId: incumbent.id,
          outputCandidateId: incumbent.id,
          activeCandidateId: incumbent.id,
          finishedAt: "2026-05-28T00:01:00.000Z",
          outcome: "ok",
        }),
        localRunSummary({
          id: "run_newer_improve",
          workflow: "improve",
          benchmarkFingerprint: "benchmark",
          candidateId: newerCandidate.id,
          outputCandidateId: newerCandidate.id,
          activeCandidateId: incumbent.id,
          finishedAt: "2026-05-28T00:03:00.000Z",
          outcome: "ok",
        }),
      ],
      jobs: [],
      executionFiles: [],
      events: [],
    };

    await expect(importLocalRuntimeBundle(workspace, bundle, "benchmark")).resolves.toMatchObject({
      stats: { activeId: incumbent.id },
    });
    const archive = await loadLocalArchive(workspace);
    expect(archive.activeId).toBe(incumbent.id);
  });

  test("pull dry-run reports the same explicit active normalization that pull applies", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-pull-dry-run-active-"));
    expect(await runCli(["init", workspace, "--command", "dry-run-active", "--json"], createIo())).toBe(0);
    const source = await readLocalProjectSource(workspace);
    await writeFile(
      path.join(workspace, ".workbench", "origin.json"),
      JSON.stringify(originFixture(), null, 2),
    );
    const state = projectStateFixture({
      id: "wb_123456789abc",
      owner: "alice",
      name: "demo",
      files: source.sourceFiles,
    });
    state.source = {
      source: source.specSource,
      files: source.sourceFiles,
      candidateFiles: source.candidateFiles,
      engineResolveFiles: source.engineResolveFiles,
      engineResolveBinding: engineResolveBindingForSpec(source.spec),
      adapterFiles: source.adapterFiles,
      dockerfile: source.dockerfile,
      runtimeDockerfile: source.runtimeDockerfile,
      runtimeFiles: source.dockerfileFiles,
      network: source.spec.environment.network?.egress === "open" ? "on" : "off",
      resources: source.spec.environment.resources ?? {},
      revisionId: state.source.revisionId,
      fingerprint: state.source.fingerprint,
    };
    const benchmarkFingerprint = projectStateBenchmarkFingerprint(state.source);
    const incumbent: CandidateRecord = {
      id: "candidate_incumbent",
      name: "Skill",
      version: 1,
      ordinal: 1,
      benchmarkFingerprint,
      candidateFingerprint: "candidate-incumbent",
      visibility: "public",
      createdAt: "2026-05-28T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: [],
    };
    const newer: CandidateRecord = {
      ...incumbent,
      id: "candidate_newer",
      version: 2,
      ordinal: 2,
      candidateFingerprint: "candidate-newer",
      createdAt: "2026-05-28T00:01:00.000Z",
    };
    state.runtime = {
      schema: "workbench.runtime.bundle.v1",
      activeId: null,
      candidates: [incumbent, newer],
      candidateFiles: [],
      evaluations: [],
      runs: [
        localRunSummary({
          id: "run_newer_improve",
          workflow: "improve",
          benchmarkFingerprint,
          candidateId: newer.id,
          outputCandidateId: newer.id,
          activeCandidateId: incumbent.id,
          finishedAt: "2026-05-28T00:02:00.000Z",
          outcome: "ok",
        }),
      ],
      jobs: [],
      executionFiles: [],
      events: [],
    };

    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "http://workbench.test/api/workbench/public/benchmarks/alice/demo/state") {
        return Response.json(state);
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    expect(await runCli(["pull", "--dir", workspace, "--dry-run", "--json"], io)).toBe(0);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      ok: true,
      dryRun: true,
      runtime: {
        activeId: incumbent.id,
      },
    });
  });

  test("cloned origins do not track local writable mode when the signed-in user owns the benchmark", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-clone-owned-home-"));
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-clone-owned-"));
    const output = path.join(root, "downloaded");
    vi.stubEnv("HOME", home);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    await mkdir(path.join(home, ".workbench"), { recursive: true });
    await writeFile(path.join(home, ".workbench", "workbench.json"), JSON.stringify({
      baseUrl: "http://workbench.test",
      accessToken: "test-token",
    }));
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "http://workbench.test/api/workbench/public/benchmarks/alice/demo/state") {
        return Response.json(projectStateFixture({
          id: "wb_123456789abc",
          owner: "alice",
          name: "demo",
          revisionId: "spec_0001",
          sourceFingerprint: "fp_0001",
          files: [
            { path: "benchmark.yaml", content: "version: 4\nname: demo\ndescription: Demo benchmark.\nengine:\n  use: workbench\n  with:\n    environment:\n      dockerfile: environment/Dockerfile\n    score:\n      use: command\n      with:\n        command: 'true'\n" },
            { path: "candidates/command/candidate.yaml", content: "version: 4\nname: demo\nfiles:\n  path: files\ndefaultRun: command\nruns:\n  command:\n    name: Command\n    use: command\n    with:\n      command: node run.js\n" },
            { path: "candidates/command/files/run.js", content: "console.log('ok')\n" },
            { path: "environment/Dockerfile", content: "FROM node:22-alpine\n" },
            { path: "tasks/case-a/task.yaml", content: "version: 3\ntask: test\n" },
          ],
        }));
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli(["clone", "alice/demo", output, "--json"], io);

    expect(exitCode).toBe(0);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      ok: true,
      origin: {
        remote: "alice/demo",
        projectId: "wb_123456789abc",
      },
    });
    const origin = JSON.parse(await readFile(path.join(output, ".workbench", "origin.json"), "utf8"));
    expectTargetOriginKeys(origin);
    expect(origin).toMatchObject({
      remote: "alice/demo",
    });
    expect(origin).not.toHaveProperty("writable");
    expect(requests).toEqual([
      "GET http://workbench.test/api/workbench/public/benchmarks/alice/demo/state",
    ]);
  });

  test("push fails when the remembered remote cannot be updated", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-readonly-push-home-"));
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-readonly-push-"));
    vi.stubEnv("HOME", home);
    expect(await runCli(["init", root, "--command", "demo", "--json"], createIo())).toBe(0);
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify(originFixture({
        projectId: "wb_123456789abc",
        remote: "alice/demo",
      })),
      "utf8",
    );
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/state" && init?.method === "PUT") {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli(["push", "--dir", root, "--visibility", "private", "--json"], io);

    expect(exitCode).toBe(1);
    expect(`${io.stdoutText()}\n${io.stderrText()}`).toContain("not found");
    const origin = JSON.parse(await readFile(path.join(root, ".workbench", "origin.json"), "utf8"));
    expect(origin).toMatchObject({
      remote: "alice/demo",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/state",
      method: "PUT",
    });
  });

  test("push updates the origin when the server accepts the source write", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-readonly-owner-push-home-"));
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-readonly-owner-push-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    await mkdir(path.join(home, ".workbench"), { recursive: true });
    await writeFile(path.join(home, ".workbench", "workbench.json"), JSON.stringify({
      baseUrl: "http://workbench.test",
      accessToken: "test-token",
    }));
    expect(await runCli(["init", root, "--command", "demo", "--json"], createIo())).toBe(0);
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify(originFixture({
        projectId: "wb_officialdemo",
        remote: "official/demo",
      })),
      "utf8",
    );
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_officialdemo/state" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as WorkbenchProjectState;
        return Response.json(projectStateImportFixture({
          id: "wb_officialdemo",
          owner: "official",
          name: "demo",
          revisionId: "spec_0002",
          sourceFingerprint: "fp_official",
          changed: false,
          runtime: body.runtime,
        }));
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli(["push", "--dir", root, "--json"], io);

    expect(exitCode).toBe(0);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      ok: true,
      action: "update",
      changed: false,
      origin: {
        projectId: "wb_officialdemo",
        remote: "official/demo",
        sourceRevisionId: "spec_0002",
        sourceFingerprint: "fp_official",
      },
      urls: {
        benchmark: "http://workbench.test/benchmarks/official/demo",
      },
    });
    const origin = JSON.parse(await readFile(path.join(root, ".workbench", "origin.json"), "utf8"));
    expectTargetOriginKeys(origin);
    expect(origin).toMatchObject({
      remote: "official/demo",
    });
    expect(origin).not.toHaveProperty("writable");
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "PUT http://workbench.test/api/workbench/benchmarks/wb_officialdemo/state",
    ]);
  });

  test("push lets hosted benchmark identity enforce name conflicts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-push-name-conflict-"));
    expect(await runCli(["init", root, "--command", "demo", "--json"], createIo())).toBe(0);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify(originFixture({
        projectId: "demo",
        remote: "alice/demo",
      })),
      "utf8",
    );
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "http://workbench.test/api/workbench/benchmarks/demo/state" && init?.method === "PUT") {
        return Response.json({ error: "Benchmark name already exists: demo." }, { status: 400 });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli([
      "push",
      "--dir",
      root,
    ], io);

    expect(exitCode).toBe(1);
    expect(io.stderrText()).toContain("Benchmark name already exists: demo.");
    expect(requests).toEqual([
      "PUT http://workbench.test/api/workbench/benchmarks/demo/state",
    ]);
  });

  test("push surfaces hosted immutable-name errors", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-push-rename-conflict-"));
    expect(await runCli(["init", root, "--command", "renamed-benchmark", "--json"], createIo())).toBe(0);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify(originFixture({
        projectId: "wb_123456789abc",
        remote: "alice/original-benchmark",
      })),
      "utf8",
    );
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/state" && init?.method === "PUT") {
        return Response.json(
          { error: "Benchmark name cannot be changed from original-benchmark to renamed-benchmark." },
          { status: 400 },
        );
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli([
      "push",
      "--dir",
      root,
    ], io);

    expect(exitCode).toBe(1);
    expect(io.stderrText()).toContain("Benchmark name cannot be changed from original-benchmark to renamed-benchmark.");
    expect(requests).toEqual([
      "PUT http://workbench.test/api/workbench/benchmarks/wb_123456789abc/state",
    ]);
  });

  test("pull downloads hosted benchmark source state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-source-pull-cli-"));
    await mkdir(path.join(root, "candidates", "command", "files"), { recursive: true });
    await mkdir(path.join(root, "tasks", "previous-case"), { recursive: true });
    await mkdir(path.join(root, "environment"), { recursive: true });
    await writeFile(path.join(root, "benchmark.yaml"), [
      "version: 4",
      "name: demo",
      "description: Previous benchmark state",
      "engine:",
      "  use: workbench",
      "  with:",
      "    environment:",
      "      dockerfile: environment/Dockerfile",
      "    score:",
      "      use: command",
      "      with:",
      "        command: printf '{\"protocol\":\"workbench.adapter-result.v1\",\"operation\":\"engine.run\",\"ok\":true,\"value\":{\"score\":1}}' > /workspace/output/workbench-result.json",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "candidates", "command", "candidate.yaml"), [
      "version: 4",
      "name: demo",
      "files:",
      "  path: files",
      "prepare:",
      "  command: sh input/candidate/prepare.sh",
      "defaultRun: command",
      "runs:",
      "  command:",
      "    name: Command",
      "    use: command",
      "    with:",
      "      command: node previous.js",
      "improve:",
      "  edits:",
      "    - previous.js",
      "  use: command",
      "  with:",
      "    command: printf '\\n// improved\\n' >> previous.js",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "candidates", "command", "files", "prepare.sh"), "#!/usr/bin/env sh\nset -eu\ncp -R input/candidate/. .\n");
    await writeFile(path.join(root, "candidates", "command", "files", "previous.js"), "console.log('previous')\n");
    await writeFile(path.join(root, "tasks", "previous-case", "task.yaml"), "version: 3\ntask: previous\n");
    await writeFile(path.join(root, "environment", "Dockerfile"), "FROM node:22-alpine\n");
    await writeFile(path.join(root, "notes.md"), "local note\n");
    const baseFingerprintIo = createIo();
    expect(await runCli(["push", "--dir", root, "--dry-run", "--json"], baseFingerprintIo)).toBe(0);
    const baseFingerprint = JSON.parse(baseFingerprintIo.stdoutText()) as {
      sourceFingerprint: string;
      runtimeFingerprint: string;
    };
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify(originFixture({
        projectId: "wb_123456789abc",
        remote: "alice/demo",
        sourceRevisionId: "spec_previous",
        sourceFingerprint: baseFingerprint.sourceFingerprint,
        runtimeFingerprint: baseFingerprint.runtimeFingerprint,
      })),
      "utf8",
    );
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "http://workbench.test/api/workbench/public/benchmarks/alice/demo/state") {
        return Response.json(projectStateFixture({
          id: "wb_123456789abc",
          owner: "alice",
          name: "demo",
          revisionId: "spec_0002",
          sourceFingerprint: "fp_0002",
          files: [
            { path: "benchmark.yaml", content: "version: 4\nname: demo\ndescription: New benchmark.\nengine:\n  use: workbench\n  with:\n    environment:\n      dockerfile: environment/Dockerfile\n    score:\n      use: command\n      with:\n        command: 'true'\n" },
            { path: "candidates/command/candidate.yaml", content: "version: 4\nname: demo\nfiles:\n  path: files\nprepare:\n  command: sh input/candidate/prepare.sh\ndefaultRun: command\nruns:\n  command:\n    name: Command\n    use: command\n    with:\n      command: ./run.sh\nimprove:\n  edits:\n    - run.sh\n  use: command\n  with:\n    command: printf '\\n# improved\\n' >> run.sh\n" },
            { path: "candidates/command/files/prepare.sh", content: "#!/usr/bin/env sh\nset -eu\ncp -R input/candidate/. .\n", executable: true },
            { path: "candidates/command/files/run.sh", content: "echo ok\n", executable: true },
            { path: "tasks/case-a/task.yaml", content: "version: 3\ntask: test\n" },
            { path: "environment/Dockerfile", content: "FROM node:22-alpine\n" },
          ],
        }));
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli([
      "pull",
      "--dir",
      root,
    ], io);

    expect(exitCode).toBe(0);
    expect(io.stdoutText()).toContain("Pulled 6 source file(s)");
    expect(requests).toEqual([
      "GET http://workbench.test/api/workbench/public/benchmarks/alice/demo/state",
    ]);
    expect(await readTextTree(root)).toMatchObject({
      "benchmark.yaml": "file\nversion: 4\nname: demo\ndescription: New benchmark.\nengine:\n  use: workbench\n  with:\n    environment:\n      dockerfile: environment/Dockerfile\n    score:\n      use: command\n      with:\n        command: 'true'\n",
      "candidates/command/candidate.yaml": "file\nversion: 4\nname: demo\nfiles:\n  path: files\nprepare:\n  command: sh input/candidate/prepare.sh\ndefaultRun: command\nruns:\n  command:\n    name: Command\n    use: command\n    with:\n      command: ./run.sh\nimprove:\n  edits:\n    - run.sh\n  use: command\n  with:\n    command: printf '\\n# improved\\n' >> run.sh\n",
      "candidates/command/files/prepare.sh": "executable\n#!/usr/bin/env sh\nset -eu\ncp -R input/candidate/. .\n",
      "candidates/command/files/run.sh": "executable\necho ok\n",
      "environment/Dockerfile": "file\nFROM node:22-alpine\n",
      "notes.md": "file\nlocal note\n",
      "tasks/case-a/task.yaml": "file\nversion: 3\ntask: test\n",
    });
    await expect(readFile(path.join(root, "candidates", "command", "files", "previous.js"), "utf8"))
      .rejects
      .toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(root, "tasks", "previous-case", "task.yaml"), "utf8"))
      .rejects
      .toMatchObject({ code: "ENOENT" });
    const pulledOrigin = JSON.parse(await readFile(path.join(root, ".workbench", "origin.json"), "utf8"));
    expectTargetOriginKeys(pulledOrigin);
    expect(pulledOrigin).toMatchObject({
      projectId: "wb_123456789abc",
      remote: "alice/demo",
      baseUrl: "http://workbench.test",
      sourceRevisionId: "spec_0002",
      sourceFingerprint: "fp_0002",
    });
  });

  test("prints route-native Workbench Cloud URLs without opening a browser when requested", async () => {
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/invoice-review") {
        return Response.json({
          benchmark: {
            id: "wb_invoice0001",
            ownerUsername: "alice",
            name: "invoice-review",
          },
        });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const projectIo = createIo();
    expect(await runCli(["open", "--hosted", "--benchmark", "wb_123456789abc", "--json", "--no-open"], projectIo)).toBe(0);
    expect(JSON.parse(projectIo.stdoutText())).toMatchObject({
      ok: true,
      url: "http://workbench.test/benchmarks/alice/demo",
    });

    const candidateIo = createIo();
    expect(await runCli(["open", "--hosted", "candidate_abc123", "--benchmark", "wb_123456789abc", "--json", "--no-open"], candidateIo)).toBe(0);
    expect(JSON.parse(candidateIo.stdoutText())).toMatchObject({
      ok: true,
      url: "http://workbench.test/benchmarks/alice/demo/candidates/candidate_abc123",
    });

    const runIo = createIo();
    expect(await runCli(["open", "--hosted", "run_abc123", "--benchmark", "wb_123456789abc", "--json", "--no-open"], runIo)).toBe(0);
    expect(JSON.parse(runIo.stdoutText())).toMatchObject({
      ok: true,
      url: "http://workbench.test/benchmarks/alice/demo",
    });

    const originRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-open-origin-"));
    await mkdir(path.join(originRoot, ".workbench"), { recursive: true });
    await writeFile(
      path.join(originRoot, ".workbench", "origin.json"),
      JSON.stringify(originFixture({
        projectId: "wb_aaaaaaaaaaaa",
        remote: "alice/origin-project",
      })),
      "utf8",
    );
    const explicitIdIo = createIo();
    expect(await runCli([
      "open",
      "--hosted",
      "--dir",
      originRoot,
      "--benchmark",
      "wb_123456789abc",
      "--json",
      "--no-open",
    ], explicitIdIo)).toBe(0);
    expect(JSON.parse(explicitIdIo.stdoutText())).toMatchObject({
      ok: true,
      url: "http://workbench.test/benchmarks/alice/demo",
    });

    const directProjectIo = createIo();
    expect(await runCli(["open", "--hosted", "invoice-review", "--json", "--no-open"], directProjectIo)).toBe(0);
    expect(JSON.parse(directProjectIo.stdoutText())).toMatchObject({
      ok: true,
      url: "http://workbench.test/benchmarks/alice/invoice-review",
    });
    expect(requests).toEqual([
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
      "GET http://workbench.test/api/workbench/benchmarks/invoice-review",
    ]);
  });

  test("rejects legacy owner/project origin files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-legacy-origin-"));
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify({
        ...originFixture({
          projectId: "wb_aaaaaaaaaaaa",
          remote: "alice/legacy-project",
        }),
        owner: "alice",
        project: "legacy-project",
      }),
      "utf8",
    );

    const io = createIo();
    const exitCode = await runCli(["open", "--hosted", "--dir", root, "--json", "--no-open"], io);

    expect(exitCode).toBe(2);
    expect(io.stdoutText()).toContain("Workbench origin is malformed");
  });

  test("starts hosted workflows through hosted lifecycle flags", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-hosted-workflow-source-"));
    expect(await runCli(["init", workspace, "--command", "workflow-source", "--json"], createIo())).toBe(0);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc" && (init?.method ?? "GET") === "GET") {
        requests.push({ url, body: null });
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/candidates") {
        requests.push({ url, body: null });
        return Response.json({
          candidates: [{
            id: "candidate_123",
            status: "evaluated",
            eval: { metric: 1 },
          }],
        });
      }
      const body = JSON.parse(String(init?.body));
      requests.push({ url, body });
      return Response.json({
        run: {
          id: `run_${requests.length}`,
          workflow: body.workflow,
          status: "queued",
          candidateId: null,
          jobCount: 1,
        },
      }, { status: 201 });
    });

    const improveIo = createIo();
    expect(await runCli([
      "improve",
      "--hosted",
      commandCandidateSpecPath(workspace),
      "--base",
      "candidate_123",
      "--benchmark",
      "wb_123456789abc",
      "--budget",
      "2",
      "--samples",
      "3",
    ], improveIo)).toBe(0);
    expect(await runCli([
      "eval",
      "--hosted",
      commandCandidateSpecPath(workspace),
      "--benchmark",
      "wb_123456789abc",
      "--candidate",
      "candidate_123",
      "--samples",
      "2",
    ], createIo())).toBe(0);
    expect(improveIo.stdoutText()).toContain("Open benchmark: http://workbench.test/benchmarks/alice/demo");

    expect(requests.map((request) => request.url)).toEqual([
      "http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
      "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/candidates",
      "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs",
      "http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
      "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs",
    ]);
    expect(requests[2]?.body).toMatchObject({
      workflow: "improve",
      budget: 2,
      samples: 3,
      candidateId: "candidate_123",
      sourceYaml: expect.stringContaining("improve:"),
    });
    expect(requests[2]?.body).not.toHaveProperty("candidateSource");
    expect(requests[2]?.body).not.toHaveProperty("candidateFiles");
    expect(requests[4]?.body).toMatchObject({
      workflow: "eval",
      samples: 2,
      candidateId: "candidate_123",
      sourceYaml: expect.stringContaining("runs:"),
    });
    expect(requests[4]?.body).not.toHaveProperty("candidateSource");
    expect(requests[4]?.body).not.toHaveProperty("candidateFiles");
  });

  test("rejects hosted eval --base and accepts --candidate for existing candidates", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-hosted-eval-candidate-"));
    expect(await runCli(["init", workspace, "--command", "local-command-eval", "--json"], createIo())).toBe(0);

    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc" && (init?.method ?? "GET") === "GET") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return Response.json({
          run: {
            id: "run_existing_candidate",
            workflow: "eval",
            status: "queued",
            candidateId: body.candidateId,
            jobCount: 1,
          },
        }, { status: 201 });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const rejected = createIo();
    expect(await runCli([
      "eval",
      "--hosted",
      "--dir",
      workspace,
      "--benchmark",
      "wb_123456789abc",
      "--base",
      "candidate_v3",
      "--json",
    ], rejected)).toBe(2);
    expect(rejected.stdoutText()).toContain("Unsupported flag: --base.");

    const accepted = createIo();
    expect(await runCli([
      "eval",
      "--hosted",
      "--dir",
      workspace,
      "--benchmark",
      "wb_123456789abc",
      "--candidate",
      "candidate_v3",
      "--json",
    ], accepted)).toBe(0);
    expect(JSON.parse(accepted.stdoutText())).toMatchObject({
      candidateId: "candidate_v3",
    });
  });

  test("treats hosted eval positional YAML as source, not candidate id", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-eval-source-"));
    expect(await runCli(["init", workspace, "--command", "local-command-eval", "--json"], createIo())).toBe(0);

    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc" && (init?.method ?? "GET") === "GET") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
          },
        });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli([
      "eval",
      "--hosted",
      commandCandidateSpecPath(workspace),
      "--benchmark",
      "wb_123456789abc",
      "--dry-run",
      "--json",
    ], io);

    expect(exitCode).toBe(0);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      dir: workspace,
      request: {
        workflow: "eval",
        samples: 1,
      },
    });
    expect(JSON.parse(io.stdoutText()).request).not.toHaveProperty("candidateId");
  });

  test("reports candidate run id when the hosted server reuses an eval", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-hosted-eval-reuse-output-"));
    expect(await runCli(["init", workspace, "--command", "local-command-eval", "--json"], createIo())).toBe(0);

    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: Array<{ method: string; url: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({ method, url });
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc" && method === "GET") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs" && method === "POST") {
        const body = JSON.parse(String(init?.body));
        return Response.json({
          reused: true,
          run: {
            id: "run_existing",
            workflow: "eval",
            status: "finished",
            outcome: "ok",
            candidateId: body.candidateId,
            outputCandidateId: body.candidateId,
            candidateRunId: "main",
            jobCount: 1,
            completedJobCount: 1,
            failedJobCount: 0,
          },
        }, { status: 200 });
      }
      return Response.json({ error: `unexpected ${method} ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli([
      "eval",
      "--hosted",
      "--dir",
      workspace,
      "--benchmark",
      "wb_123456789abc",
      "--candidate",
      "candidate_v3",
      "--json",
    ], io);

    expect(exitCode).toBe(0);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      reused: true,
      runId: "run_existing",
      candidateId: "candidate_v3",
      candidateRunId: "main",
    });
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
      "POST http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs",
    ]);
  });

  test("starts hosted runs immediately without waiting for environment builds", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-hosted-env-wait-"));
    expect(await runCli(["init", workspace, "--command", "local-command-eval", "--json"], createIo())).toBe(0);
    await writeDockerNodeWorkbenchSpec(workspace);

    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc" && (init?.method ?? "GET") === "GET") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "local-workbench",
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks") {
        return Response.json({
          benchmarks: [
            { id: "wb_123456789abc", name: "local-workbench" },
          ],
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs" && init?.method === "POST") {
        return Response.json({
          run: {
            id: "run_123",
            workflow: "eval",
            status: "queued",
            candidateId: null,
            jobCount: 1,
          },
        }, { status: 201 });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli([
      "eval",
      "--hosted",
      "--dir",
      workspace,
      "--benchmark",
      "wb_123456789abc",
    ], io);

    expect(exitCode).toBe(0);
    expect(requests.at(-1)).toBe("POST http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs");
    expect(requests[0]).toBe("GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc");
    expect(requests.filter((r) => r === "POST http://workbench.test/api/workbench/environments")).toEqual([]);
  });

  test("retries failed hosted eval runs from recorded candidate and samples", async () => {
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({
        method,
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc" && method === "GET") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs/run_failed" && method === "GET") {
        return Response.json({
          run: {
            id: "run_failed",
            workflow: "eval",
            status: "finished",
            outcome: "error",
            candidateId: "candidate_failed",
            outputCandidateId: "candidate_failed",
            samples: 2,
            failedJobCount: 1,
            input: {
              sourceYaml: "version: 4\nname: demo\ncandidate:\n  name: Skill\n  selectedRunId: claude-haiku-45\n",
            },
          },
          jobs: [{
            id: "job_failed",
            runId: "run_failed",
            status: "failed",
            candidateId: "candidate_failed",
            input: {
              execution: {
                purpose: "attempt",
                metadata: {
                  caseId: "case-a",
                  sampleIndex: 1,
                },
              },
            },
            error: "adapter auth missing",
          }],
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs" && method === "POST") {
        return Response.json({
          run: {
            id: "run_retry",
            workflow: "eval",
            status: "queued",
            candidateId: "candidate_failed",
            outputCandidateId: "candidate_failed",
            jobCount: 1,
          },
        }, { status: 201 });
      }
      return Response.json({ error: `unexpected ${method} ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli([
      "retry",
      "--hosted",
      "run_failed",
      "--benchmark",
      "wb_123456789abc",
      "--json",
    ], io);

    expect(exitCode).toBe(0);
    expect(requests.at(-1)).toMatchObject({
      method: "POST",
      url: "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs",
      body: {
        workflow: "eval",
        samples: 2,
        candidateId: "candidate_failed",
        sourceYaml: "version: 4\nname: demo\ncandidate:\n  name: Skill\n  selectedRunId: claude-haiku-45\n",
        preserveActive: true,
        selectedSamples: [{ caseId: "case-a", sampleIndex: 1 }],
      },
    });
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      ok: true,
      retried: {
        id: "run_failed",
        kind: "run",
        workflow: "eval",
      },
      runId: "run_retry",
    });
  });

  test("retries failed hosted evaluations using full run detail for recorded source", async () => {
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    const sourceYaml = "version: 4\nname: demo\ncandidate:\n  name: Skill\n  selectedRunId: claude-haiku-45\n";
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({
        method,
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc" && method === "GET") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/workbench/snapshot" && method === "GET") {
        return Response.json({
          evaluations: [{
            id: "eval_failed",
            runId: "run_failed",
            candidateId: "candidate_failed",
            status: "error",
            sampleCount: 2,
            errorSampleCount: 1,
          }],
          runs: [{
            id: "run_failed",
            workflow: "eval",
            status: "finished",
            outcome: "error",
            samples: 2,
          }],
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs/run_failed" && method === "GET") {
        return Response.json({
          run: {
            id: "run_failed",
            workflow: "eval",
            status: "finished",
            outcome: "error",
            candidateId: "candidate_failed",
            samples: 2,
            failedJobCount: 1,
            input: { sourceYaml },
          },
          jobs: [],
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs" && method === "POST") {
        return Response.json({
          run: {
            id: "run_retry",
            workflow: "eval",
            status: "queued",
            candidateId: "candidate_failed",
            outputCandidateId: "candidate_failed",
            jobCount: 1,
          },
        }, { status: 201 });
      }
      return Response.json({ error: `unexpected ${method} ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli([
      "retry",
      "--hosted",
      "eval_failed",
      "--benchmark",
      "wb_123456789abc",
      "--json",
    ], io);

    expect(exitCode).toBe(0);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc/workbench/snapshot",
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs/run_failed",
      "POST http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs",
    ]);
    expect(requests.at(-1)?.body).toEqual({
      workflow: "eval",
      samples: 2,
      candidateId: "candidate_failed",
      sourceYaml,
      preserveActive: true,
    });
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      ok: true,
      retried: {
        id: "eval_failed",
        kind: "evaluation",
        workflow: "eval",
      },
      runId: "run_retry",
    });
  });

  test("reuses an evaluated active candidate before hosted improve", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-hosted-improve-active-"));
    expect(await runCli(["init", workspace, "--command", "local-command-eval", "--json"], createIo())).toBe(0);

    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc" && (init?.method ?? "GET") === "GET") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
            activeCandidateId: "candidate_active",
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/candidates") {
        return Response.json({
          candidates: [{
            id: "candidate_active",
            status: "evaluated",
            eval: { metric: 1 },
          }],
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return Response.json({
          run: {
            id: "run_improve",
            workflow: body.workflow,
            status: "queued",
            candidateId: body.candidateId,
            jobCount: 1,
          },
        }, { status: 201 });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli([
      "improve",
      "--hosted",
      commandCandidateSpecPath(workspace),
      "--benchmark",
      "wb_123456789abc",
      "--json",
    ], io);

    expect(exitCode).toBe(0);
    expect(requests.map((request) => request.url)).toEqual([
      "http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
      "http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
      "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/candidates",
      "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs",
    ]);
    expect(requests.at(-1)?.body).toMatchObject({
      workflow: "improve",
      candidateId: "candidate_active",
      sourceYaml: expect.stringContaining("improve:"),
    });
    expect(requests.at(-1)?.body).not.toHaveProperty("candidateSource");
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      id: "run_improve",
      workflow: "improve",
      candidateId: "candidate_active",
    });
  });

  test("imports prerequisite hosted eval state before queueing hosted improve", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-hosted-improve-parent-import-"));
    expect(await runCli(["init", workspace, "--command", "hosted-improve-parent-import", "--json"], createIo())).toBe(0);
    const sourceFingerprint = await currentSourceFingerprint(workspace);
    await mkdir(path.join(workspace, ".workbench"), { recursive: true });
    await writeFile(
      path.join(workspace, ".workbench", "origin.json"),
      JSON.stringify(originFixture({
        remote: "alice/hosted-improve-parent-import",
        sourceFingerprint,
        runtimeFingerprint: "rt_old",
      })),
      "utf8",
    );
    const state = await projectStateFixtureForWorkspace(workspace, {
      id: "wb_123456789abc",
      owner: "alice",
      name: "hosted-improve-parent-import",
      sourceFingerprint,
      runtimeFingerprint: "rt_parent",
      runtime: hostedRuntimeBundleFixture({
        candidateId: "candidate_parent",
        runId: "run_parent_eval",
        jobId: "job_parent_eval",
      }),
    });
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({
        method,
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc" && method === "GET") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "hosted-improve-parent-import",
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs" && method === "POST") {
        const body = JSON.parse(String(init?.body));
        if (body.workflow === "eval") {
          return Response.json({
            run: {
              id: "run_parent_eval",
              workflow: "eval",
              status: "queued",
              candidateId: null,
              jobCount: 1,
            },
          }, { status: 201 });
        }
        return Response.json({
          run: {
            id: "run_improve",
            workflow: "improve",
            status: "queued",
            candidateId: body.candidateId,
            jobCount: 1,
          },
        }, { status: 201 });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs/run_parent_eval") {
        return Response.json({
          run: {
            id: "run_parent_eval",
            workflow: "eval",
            status: "finished",
            outcome: "ok",
            candidateId: "candidate_parent",
            outputCandidateId: "candidate_parent",
            failedJobCount: 0,
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/state") {
        return Response.json(state);
      }
      return Response.json({ error: `unexpected ${method} ${url}` }, { status: 500 });
    });

    const io = createIo();
    expect(await runCli([
      "improve",
      "--hosted",
      "--dir",
      workspace,
      "--json",
    ], io)).toBe(0);

    expect(JSON.parse(io.stdoutText())).toMatchObject({
      id: "run_improve",
      workflow: "improve",
      candidateId: "candidate_parent",
    });
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
      "POST http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs",
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs/run_parent_eval",
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc/state",
      "POST http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs",
    ]);
    expect((await loadLocalArchive(workspace)).runs.map((run) => run.id)).toContain("run_parent_eval");
    const origin = JSON.parse(await readFile(path.join(workspace, ".workbench", "origin.json"), "utf8"));
    expect(origin.runtimeFingerprint).toBe("rt_parent");
  });

  test("surfaces hosted server improve reuse against the recorded base candidate", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-hosted-improve-reuse-base-"));
    expect(await runCli(["init", workspace, "--command", "local-command-eval", "--json"], createIo())).toBe(0);

    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({
        method,
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc" && method === "GET") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/candidates" && method === "GET") {
        return Response.json({
          candidates: [
            { id: "candidate_v1", status: "evaluated", eval: { metric: 0.5 } },
            { id: "candidate_v2", status: "evaluated", eval: { metric: 0.8 } },
          ],
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs" && method === "POST") {
        const body = JSON.parse(String(init?.body));
        if (body.candidateId === "candidate_v1") {
          return Response.json({
            reused: true,
            run: {
              id: "run_v1_to_v2",
              workflow: "improve",
              status: "finished",
              outcome: "ok",
              candidateId: "candidate_v2",
              activeCandidateId: "candidate_v2",
              outputCandidateId: "candidate_v2",
              candidateRunId: "main",
              budget: 1,
              samples: 1,
              jobCount: 1,
              completedJobCount: 1,
              failedJobCount: 0,
            },
          }, { status: 200 });
        }
        return Response.json({
          run: {
            id: "run_v2_to_v3",
            workflow: "improve",
            status: "queued",
            candidateId: body.candidateId,
            outputCandidateId: "candidate_v3",
            candidateRunId: "main",
            jobCount: 1,
          },
        }, { status: 201 });
      }
      return Response.json({ error: `unexpected ${method} ${url}` }, { status: 500 });
    });

    const reuseIo = createIo();
    expect(await runCli([
      "improve",
      "--hosted",
      commandCandidateSpecPath(workspace),
      "--benchmark",
      "wb_123456789abc",
      "--base",
      "candidate_v1",
      "--json",
    ], reuseIo)).toBe(0);
    expect(JSON.parse(reuseIo.stdoutText())).toMatchObject({
      reused: true,
      runId: "run_v1_to_v2",
      candidateId: "candidate_v2",
      candidateRunId: "main",
      outputCandidateId: "candidate_v2",
    });
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc/candidates",
      "POST http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs",
    ]);

    requests.length = 0;
    const nextIo = createIo();
    expect(await runCli([
      "improve",
      "--hosted",
      commandCandidateSpecPath(workspace),
      "--benchmark",
      "wb_123456789abc",
      "--base",
      "candidate_v2",
      "--json",
    ], nextIo)).toBe(0);

    expect(requests.at(-1)).toMatchObject({
      method: "POST",
      url: "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs",
      body: {
        workflow: "improve",
        candidateId: "candidate_v2",
      },
    });
    expect(JSON.parse(nextIo.stdoutText())).toMatchObject({
      id: "run_v2_to_v3",
      workflow: "improve",
      candidateId: "candidate_v2",
    });
  });

  test("logs in through the Workbench device flow and sends the issued bearer token", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "workbench-cloud-home-"));
    vi.stubEnv("HOME", home);
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "http://workbench.test/api/oauth/device/code") {
        return Response.json({
          device_code: "device-1",
          user_code: "ABCDEFGH",
          verification_uri: "http://workbench.test/cli-login",
          verification_uri_complete: "http://workbench.test/cli-login?user_code=ABCDEFGH",
          expires_in: 60,
          interval: 0,
        });
      }
      if (url === "http://workbench.test/api/oauth/token") {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          device_code: "device-1",
        });
        return Response.json({
          access_token: "access-1",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (url === "http://workbench.test/api/workbench/profile") {
        expect(init?.headers).toMatchObject({
          authorization: "Bearer access-1",
        });
        return Response.json({ profile: { username: "alice" } });
      }
      if (url === "http://workbench.test/api/workbench/auth/adapters") {
        expect(init?.headers).toMatchObject({
          authorization: "Bearer access-1",
        });
        return Response.json({ adapters: [] });
      }
      return new Response("not found", { status: 404 });
    });

    const loginIo = createIo();
    const loginExitCode = await runCli(
      ["login", "--base-url", "http://workbench.test", "--no-open"],
      loginIo,
    );
    expect(loginExitCode).toBe(0);
    expect(loginIo.stdoutText()).toContain("http://workbench.test/cli-login?user_code=ABCDEFGH");

    const whoamiIo = createIo();
    const whoamiExitCode = await runCli(["whoami", "--json"], whoamiIo);
    expect(whoamiExitCode).toBe(0);
    expect(JSON.parse(whoamiIo.stdoutText())).toMatchObject({
      workbench: {
        authenticated: true,
        username: "alice",
      },
    });
  });

  test("push uploads candidate directories as utf8 snapshots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-cloud-cli-"));
    expect(await runCli(["init", root, "--command", "push-command-eval", "--json"], createIo())).toBe(0);
    await writeFile(path.join(root, "candidates", "current", "files", "notes.txt"), "case notes\n");
    await mkdir(path.join(root, "candidates", "current", "files", "__pycache__"));
    await writeFile(path.join(root, "candidates", "current", "files", "__pycache__", "run.cpython-314.pyc"), "bytecode\n");
    await writeFile(path.join(root, "candidates", "current", "files", ".DS_Store"), "finder metadata\n");
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify(originFixture({
        projectId: "wb_123456789abc",
        remote: "alice/push-command-eval",
      })),
      "utf8",
    );
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const bodies: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.body) {
        bodies[url] = JSON.parse(String(init.body));
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/state") {
        const body = JSON.parse(String(init?.body)) as WorkbenchProjectState;
        return Response.json(projectStateImportFixture({
          id: "wb_123456789abc",
          owner: "alice",
          name: "push-command-eval",
          revisionId: "spec_0001",
          changed: true,
          sourceChanged: true,
          runtime: body.runtime,
        }));
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/publish" && init?.method === "DELETE") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            name: "push-command-eval",
            ownerUsername: "alice",
            currentSpecVersionId: "spec_0001",
          },
        });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli(
      ["push", "--dir", root, "--visibility", "private"],
      io,
    );

    expect(exitCode).toBe(0);
    expect(io.stdoutText()).toContain("Pushed alice/push-command-eval (wb_123456789abc).");
    expect(bodies["http://workbench.test/api/workbench/benchmarks/wb_123456789abc/state"]).toMatchObject({
      source: {
        candidateFiles: expect.arrayContaining([
          expect.objectContaining({ path: "notes.txt", content: "case notes\n" }),
          expect.objectContaining({ path: "prepare.sh", content: expect.stringContaining("cp -R input/candidate/. .") }),
          expect.objectContaining({ path: "run.js", content: expect.stringContaining("command candidate ran") }),
        ]),
      },
    });
  });

  test("push dry-run validates the declared Dockerfile source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-push-missing-dockerfile-"));
    expect(await runCli(["init", root, "--command", "push-command-eval", "--json"], createIo())).toBe(0);
    await rm(path.join(root, "environment", "Dockerfile"));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const io = createIo();
    const exitCode = await runCli(
      ["push", "--dir", root, "--dry-run"],
      io,
    );

    expect(exitCode).toBe(2);
    expect(io.stderrText()).toContain("Dockerfile not found:");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("push dry-run reports the local runtime fingerprint for linked updates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-push-dry-run-runtime-fp-"));
    expect(await runCli(["init", root, "--command", "push-command-eval", "--json"], createIo())).toBe(0);
    const sourceFingerprint = await currentSourceFingerprint(root);
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify(originFixture({
        sourceFingerprint,
        runtimeFingerprint: "rt_remote_base",
      }), null, 2),
      "utf8",
    );
    const candidateId = await seedLocalCandidate(root);
    const source = await readLocalProjectSource(root);
    const runtime = await exportLocalRuntimeBundle(root, {
      currentBenchmarkFingerprint: localBenchmarkFingerprint(source),
    });
    const expectedRuntimeFingerprint = workbenchRuntimeBundleFingerprint(runtime);
    expect(expectedRuntimeFingerprint).not.toBe("rt_remote_base");

    const requests: string[] = [];
    let fetchAttempts = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      fetchAttempts += 1;
      if (fetchAttempts === 1) {
        throw new TypeError("fetch failed: socket hang up");
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
            visibility: "public",
            snapshots: {
              candidate: { files: [{ path: "large.txt", contentRedacted: true }] },
            },
          },
        });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    expect(await runCli(["push", "--dir", root, "--dry-run", "--json"], io)).toBe(0);
    const output = JSON.parse(io.stdoutText());
    expect(output).toMatchObject({
      ok: true,
      dryRun: true,
      action: "update",
      benchmark: {
        id: "wb_123456789abc",
        ownerUsername: "alice",
        name: "demo",
        visibility: "public",
      },
      runtime: {
        activeId: candidateId,
      },
      runtimeFingerprint: expectedRuntimeFingerprint,
    });
    expect(output.benchmark).not.toHaveProperty("snapshots");
    expect(requests).toEqual([
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
    ]);
  });

  test("push dry-run validates access to the linked remote before reporting an update", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-push-dry-run-auth-"));
    expect(await runCli(["init", root, "--command", "push-command-eval", "--json"], createIo())).toBe(0);
    const sourceFingerprint = await currentSourceFingerprint(root);
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify(originFixture({
        remote: "test/demo",
        sourceFingerprint,
      }), null, 2),
      "utf8",
    );
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc") {
        return Response.json(
          { error: "Workbench benchmark not found: wb_123456789abc" },
          { status: 404 },
        );
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    expect(await runCli(["push", "--dir", root, "--dry-run"], io)).toBe(1);
    expect(io.stderrText()).toContain("Workbench benchmark not found: wb_123456789abc");
  });

  test("push uploads binary snapshots without utf8 corruption", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-binary-cli-"));
    expect(await runCli(["init", root, "--command", "binary-command-eval", "--json"], createIo())).toBe(0);
    const fileBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]);
    await writeFile(path.join(root, "tasks", "task-001", "tests", "golden.docx"), fileBytes);
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify(originFixture({
        projectId: "wb_123456789abc",
        remote: "alice/binary-command-eval",
      })),
      "utf8",
    );
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const bodies: Record<string, { source?: { engineResolveFiles?: unknown[] } }> = {};
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.body) {
        bodies[url] = JSON.parse(String(init.body));
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/state") {
        const body = JSON.parse(String(init?.body)) as WorkbenchProjectState;
        return Response.json(projectStateImportFixture({
          id: "wb_123456789abc",
          owner: "alice",
          name: "binary-command-eval",
          revisionId: "spec_0001",
          changed: true,
          sourceChanged: true,
          runtime: body.runtime,
        }));
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/publish" && init?.method === "DELETE") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            name: "binary-command-eval",
            ownerUsername: "alice",
            currentSpecVersionId: "spec_0001",
          },
        });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli(
      ["push", "--dir", root, "--visibility", "private"],
      io,
    );

    expect(exitCode).toBe(0);
    expect(bodies["http://workbench.test/api/workbench/benchmarks/wb_123456789abc/state"]?.source?.engineResolveFiles).toContainEqual(expect.objectContaining({
      path: "task-001/tests/golden.docx",
      content: fileBytes.toString("base64"),
      encoding: "base64",
    }));
  });

  test("watches queued runs until the hosted worker finishes them", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-watch-hosted-eval-"));
    expect(await runCli(["init", workspace, "--command", "watch-hosted-eval", "--json"], createIo())).toBe(0);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    let polls = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/workbench/benchmarks/wb_123456789abc")) {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
          },
        });
      }
      if (url.endsWith("/api/workbench/benchmarks/wb_123456789abc/runs") && init?.method === "POST") {
        return Response.json({
          run: {
            id: "run_123",
            workflow: "eval",
            status: "queued",
            candidateId: null,
            jobCount: 1,
          },
        }, { status: 201 });
      }
      polls += 1;
      return Response.json({
        run: {
          id: "run_123",
          status: polls === 1 ? "queued" : "finished",
          candidateId: polls === 1 ? null : "candidate_123",
        },
      });
    });

    const io = createIo();
    const exitCode = await runCli([
      "eval",
      "--hosted",
      "--dir",
      workspace,
      "--benchmark",
      "wb_123456789abc",
      "--watch",
      "--interval-ms",
      "1",
    ], io);

    expect(exitCode).toBe(0);
    expect(polls).toBe(2);
    expect(io.stdoutText()).toContain("Run run_123 reached finished; candidate candidate_123");
    expect(io.stdoutText()).toContain("Open evaluation: http://workbench.test/benchmarks/alice/demo/candidates/candidate_123?evaluation=eval_run_123_candidate_123");
  });

  test("imports terminal hosted project state into the linked local project after watch", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-hosted-state-import-"));
    expect(await runCli(["init", workspace, "--command", "hosted-state-import", "--json"], createIo())).toBe(0);
    const sourceFingerprint = await currentSourceFingerprint(workspace);
    await mkdir(path.join(workspace, ".workbench"), { recursive: true });
    await writeFile(
      path.join(workspace, ".workbench", "origin.json"),
      JSON.stringify(originFixture({
        remote: "alice/hosted-state-import",
        sourceFingerprint,
        runtimeFingerprint: "rt_old",
      })),
      "utf8",
    );
    const state = await projectStateFixtureForWorkspace(workspace, {
      id: "wb_123456789abc",
      owner: "alice",
      name: "hosted-state-import",
      sourceFingerprint,
      runtimeFingerprint: "rt_imported",
      runtime: hostedRuntimeBundleFixture({ runId: "run_123" }),
    });
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs" && init?.method === "POST") {
        return Response.json({
          run: {
            id: "run_123",
            workflow: "eval",
            status: "queued",
            candidateId: null,
            jobCount: 1,
          },
        }, { status: 201 });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs/run_123") {
        return Response.json({
          run: {
            id: "run_123",
            workflow: "eval",
            status: "finished",
            outcome: "ok",
            candidateId: "candidate_123",
            outputCandidateId: "candidate_123",
            jobCount: 1,
            completedJobCount: 1,
            failedJobCount: 0,
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/state") {
        return Response.json(state);
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli([
      "eval",
      "--hosted",
      "--dir",
      workspace,
      "--watch",
      "--interval-ms",
      "1",
      "--json",
    ], io);

    expect(exitCode).toBe(0);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      id: "run_123",
      status: "finished",
      candidateId: "candidate_123",
    });
    expect(requests).toContain("GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc/state");
    const archive = await loadLocalArchive(workspace);
    expect(archive.runs.map((run) => run.id)).toContain("run_123");
    expect(archive.candidates.map((candidate) => candidate.id)).toContain("candidate_123");
    expect((await readLocalJobs(workspace)).map((job) => job.id)).toContain("job_123");
    const origin = JSON.parse(await readFile(path.join(workspace, ".workbench", "origin.json"), "utf8"));
    expectTargetOriginKeys(origin);
    expect(origin).toMatchObject({
      remote: "alice/hosted-state-import",
      runtimeFingerprint: "rt_imported",
      sourceFingerprint,
    });
  });

  test("imports reused terminal hosted project state into the linked local project", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-hosted-reuse-state-import-"));
    expect(await runCli(["init", workspace, "--command", "hosted-reuse-state-import", "--json"], createIo())).toBe(0);
    const sourceFingerprint = await currentSourceFingerprint(workspace);
    await mkdir(path.join(workspace, ".workbench"), { recursive: true });
    await writeFile(
      path.join(workspace, ".workbench", "origin.json"),
      JSON.stringify(originFixture({
        remote: "alice/hosted-reuse-state-import",
        sourceFingerprint,
        runtimeFingerprint: "rt_old",
      })),
      "utf8",
    );
    const state = await projectStateFixtureForWorkspace(workspace, {
      id: "wb_123456789abc",
      owner: "alice",
      name: "hosted-reuse-state-import",
      sourceFingerprint,
      runtimeFingerprint: "rt_reused",
      runtime: hostedRuntimeBundleFixture({ runId: "run_existing" }),
    });
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs" && init?.method === "POST") {
        return Response.json({
          reused: true,
          run: {
            id: "run_existing",
            workflow: "eval",
            status: "finished",
            outcome: "ok",
            candidateId: "candidate_123",
            outputCandidateId: "candidate_123",
            jobCount: 1,
            completedJobCount: 1,
            failedJobCount: 0,
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/state") {
        return Response.json(state);
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    expect(await runCli([
      "eval",
      "--hosted",
      "--dir",
      workspace,
      "--json",
    ], io)).toBe(0);

    expect(JSON.parse(io.stdoutText())).toMatchObject({
      reused: true,
      runId: "run_existing",
      candidateId: "candidate_123",
    });
    expect((await loadLocalArchive(workspace)).runs.map((run) => run.id)).toContain("run_existing");
  });

  test("leaves local state untouched when terminal hosted import would overwrite dirty source", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-hosted-state-dirty-"));
    expect(await runCli(["init", workspace, "--command", "hosted-state-dirty", "--json"], createIo())).toBe(0);
    await mkdir(path.join(workspace, ".workbench"), { recursive: true });
    await writeFile(
      path.join(workspace, ".workbench", "origin.json"),
      JSON.stringify(originFixture({
        remote: "alice/hosted-state-dirty",
        sourceFingerprint: "fp_previous",
        runtimeFingerprint: "rt_old",
      })),
      "utf8",
    );
    const state = await projectStateFixtureForWorkspace(workspace, {
      id: "wb_123456789abc",
      owner: "alice",
      name: "hosted-state-dirty",
      sourceFingerprint: "fp_previous",
      runtimeFingerprint: "rt_imported",
      runtime: hostedRuntimeBundleFixture({ runId: "run_dirty" }),
    });
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs" && init?.method === "POST") {
        return Response.json({
          run: {
            id: "run_dirty",
            workflow: "eval",
            status: "queued",
            candidateId: null,
            jobCount: 1,
          },
        }, { status: 201 });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs/run_dirty") {
        return Response.json({
          run: {
            id: "run_dirty",
            workflow: "eval",
            status: "finished",
            outcome: "ok",
            candidateId: "candidate_123",
            failedJobCount: 0,
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/state") {
        return Response.json(state);
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    expect(await runCli([
      "eval",
      "--hosted",
      "--dir",
      workspace,
      "--watch",
      "--interval-ms",
      "1",
      "--json",
    ], io)).toBe(0);

    expect(io.stderrText()).toContain("Hosted run finished, but local project state was not updated");
    expect(io.stderrText()).toContain("Local source changed since the last pull or push");
    expect((await loadLocalArchive(workspace)).runs).toEqual([]);
    const origin = JSON.parse(await readFile(path.join(workspace, ".workbench", "origin.json"), "utf8"));
    expect(origin.runtimeFingerprint).toBe("rt_old");
  });

  test("does not import terminal hosted state for an explicit different benchmark", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-hosted-state-other-"));
    expect(await runCli(["init", workspace, "--command", "hosted-state-other", "--json"], createIo())).toBe(0);
    const sourceFingerprint = await currentSourceFingerprint(workspace);
    await mkdir(path.join(workspace, ".workbench"), { recursive: true });
    await writeFile(
      path.join(workspace, ".workbench", "origin.json"),
      JSON.stringify(originFixture({
        remote: "alice/hosted-state-other",
        sourceFingerprint,
        runtimeFingerprint: "rt_old",
      })),
      "utf8",
    );
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    let stateRequestCount = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_abcdef123456") {
        return Response.json({
          benchmark: {
            id: "wb_abcdef123456",
            ownerUsername: "alice",
            name: "other",
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_abcdef123456/runs" && init?.method === "POST") {
        return Response.json({
          run: {
            id: "run_other",
            workflow: "eval",
            status: "queued",
            candidateId: null,
            jobCount: 1,
          },
        }, { status: 201 });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_abcdef123456/runs/run_other") {
        return Response.json({
          run: {
            id: "run_other",
            workflow: "eval",
            status: "finished",
            outcome: "ok",
            candidateId: "candidate_other",
            failedJobCount: 0,
          },
        });
      }
      if (url.endsWith("/state")) {
        stateRequestCount += 1;
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    expect(await runCli([
      "eval",
      "--hosted",
      "--dir",
      workspace,
      "--benchmark",
      "wb_abcdef123456",
      "--watch",
      "--interval-ms",
      "1",
      "--json",
    ], io)).toBe(0);

    expect(stateRequestCount).toBe(0);
    expect((await loadLocalArchive(workspace)).runs).toEqual([]);
  });

  test("rejects decimal run controls instead of truncating them", async () => {
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const io = createIo();
    const exitCode = await runCli([
      "improve",
      "--hosted",
      "--benchmark",
      "wb_123456789abc",
      "--samples",
      "1.5",
    ], io);

    expect(exitCode).toBe(2);
    expect(io.stderrText()).toContain("--samples must be a positive integer.");
    expect(fetch).not.toHaveBeenCalled();
  });
});

async function seedLocalCandidate(
  workspace: string,
  options: {
    eval?: CandidateRecord["eval"];
    meta?: CandidateRecord["meta"];
  } = {},
): Promise<string> {
  const candidateId = "candidate_seeded_001";
  const benchmarkFingerprint = await localSeedBenchmarkFingerprint(workspace);
  await saveLocalArchive(workspace, {
    activeId: candidateId,
    candidates: [{
      id: candidateId,
      version: 1,
      ordinal: 1,
      benchmarkFingerprint,
      candidateFingerprint: "seeded-candidate-fingerprint",
      visibility: "private",
      createdAt: "2026-04-28T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: ["prompt.md"],
      ...(options.eval ? { eval: options.eval } : {}),
      ...(options.meta ? { meta: options.meta } : {}),
    }],
    candidateFiles: {
      [candidateId]: [{
        path: "prompt.md",
        kind: "text",
        encoding: "utf8",
        executable: false,
        content: "seeded candidate\n",
      }],
    },
    evaluations: [],
    runs: [],
    events: [],
  });
  return candidateId;
}

async function localSeedBenchmarkFingerprint(workspace: string): Promise<string> {
  const projectSource = await readLocalProjectSource(workspace).catch(() => null);
  return projectSource ? localBenchmarkFingerprint(projectSource) : "5555555555555555555555555555555555555555555555555555555555555555";
}

function localExecutionJob(args: {
  id: string;
  candidateId: string;
  purpose: "attempt";
  output: Record<string, unknown>;
}): HostedWorkbenchJob {
  const createdAt = "2026-04-28T00:00:00.000Z";
  const finishedAt = "2026-04-28T00:00:01.000Z";
  return {
    id: args.id,
    projectId: "local",
    runId: "run_seeded",
    candidateId: args.candidateId,
    kind: "execute",
    status: "succeeded",
    attempt: 1,
    createdAt,
    startedAt: createdAt,
    finishedAt,
    updatedAt: finishedAt,
    input: {
      execution: {
        id: `exec_${args.id}`,
        purpose: args.purpose,
      },
      candidateId: args.candidateId,
      attemptIndex: 0,
      sampleIndex: 0,
      caseId: "case-001",
    },
    output: args.output,
  };
}

function textFile(pathName: string, content: string) {
  return {
    path: pathName,
    kind: "text" as const,
    encoding: "utf8" as const,
    executable: false,
    content,
  };
}

function metricStats(value: number) {
  return {
    count: 1,
    mean: value,
    variance: 0,
    stddev: 0,
    min: value,
    max: value,
  };
}

function candidateEvaluation(metrics: Record<string, number>): CandidateRecord["eval"] {
  return {
    candidate: { id: "candidate_seeded_001", kind: "candidate" },
    status: "completed",
    sampleCount: 1,
    completedSampleCount: 1,
    errorSampleCount: 0,
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([key, value]) => [key, metricStats(value)]),
    ),
    samples: [],
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return await response.json() as T;
}

async function canBindLoopback(): Promise<boolean> {
  const server = createServer((_request, response) => {
    response.writeHead(204);
    response.end();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.listen(0, "127.0.0.1", onListening);
    });
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "EPERM" || error.code === "EACCES")
    ) {
      return false;
    }
    throw error;
  } finally {
    await new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function canRunDocker(): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    execFile("docker", ["info"], { timeout: 5_000 }, (error) => {
      resolve(!error);
    });
  });
}

function localRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "run_local_test",
    workflow: "eval",
    benchmarkFingerprint: "benchmark",
    status: "finished",
    startedAt: "2026-05-27T00:00:00.000Z",
    improver: "none",
    engineRun: "command",
    strategy: "direct",
    budget: 1,
    repairBudget: 0,
    attemptsRequested: 1,
    attemptsExecuted: 1,
    samples: 1,
    ...overrides,
  };
}

function createIo() {
  let stdout = "";
  let stderr = "";
  return {
    stdin: process.stdin,
    stdout: new Writable({
      write(chunk, _encoding, callback) {
        stdout += String(chunk);
        callback();
      },
    }),
    stderr: new Writable({
      write(chunk, _encoding, callback) {
        stderr += String(chunk);
        callback();
      },
    }),
    stdoutText: () => stdout,
    stderrText: () => stderr,
  };
}

async function readTextTree(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const fileStat = await stat(absolutePath);
      files[relativePath] = `${fileStat.mode & 0o111 ? "executable" : "file"}\n${await readFile(absolutePath, "utf8")}`;
    }
  }

  await walk(root);
  return Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
}
