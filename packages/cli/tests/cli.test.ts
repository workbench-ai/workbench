import { Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, test, vi } from "vitest";

import { normalizeWorkbenchSkillName } from "@workbench-ai/workbench-contract";
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

function stdoutJson<T = Record<string, unknown>>(result: { stdout: string }): T {
  return JSON.parse(result.stdout) as T;
}

const hasDocker = spawnSync("docker", ["info"], { encoding: "utf8" }).status === 0;
const dockerTest = hasDocker ? test : test.skip;
const tempRoots: string[] = [];

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
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

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })
  ));
});

describe("workbench skill-first CLI", () => {
  test("keeps default and command help on the final surface", async () => {
    const help = await invoke(["help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("workbench new");
    expect(help.stdout).toContain("workbench eval");
    expect(help.stdout).toContain("workbench improve");
    expect(help.stdout).toContain("workbench compare");
    expect(help.stdout).toContain("workbench publish");
    expect(help.stdout).toContain("workbench install");
    expect(help.stdout).toContain("workbench help --all");
    expect(help.stdout).not.toContain("workbench log");
    expect(help.stdout).not.toContain("workbench show");
    expect(help.stdout).not.toContain("workbench open");

    for (const command of ["compare", "diff", "open", "case", "agent"]) {
      const commandHelp = await invoke(["help", command]);
      expect(commandHelp.code).toBe(0);
      expect(commandHelp.stdout).toContain(`workbench ${command}`);
      expect(commandHelp.stdout).not.toBe(help.stdout);
    }

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
    const unknownTopLevel = await invoke(["legacy", "status", "--method", "api-key", "--json"]);
    expect(unknownTopLevel.code).toBe(2);
    expect(stdoutJson(unknownTopLevel)).toMatchObject({
      ok: false,
      code: "usage",
      message: expect.stringContaining("Unknown command: legacy"),
    });

    const caseListWrongFlag = await invoke(["case", "list", "--origin", "trace_1", "--json"]);
    expect(caseListWrongFlag.code).toBe(2);
    expect(stdoutJson(caseListWrongFlag)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --origin for workbench case.",
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

    const root = await makeTempRoot("workbench-cli-flag-kinds-");
    expect((await invoke(["new", root, "--json"])).code).toBe(0);
    const compare = await invoke(["compare", "--versions", "all", "--dir", root, "--json"]);
    expect(compare.code, compare.stdout || compare.stderr).toBe(0);
    expect(stdoutJson(compare)).toMatchObject({ schema: "workbench.cli.compare.v1", ok: true });
  });

  test("lists Workbench canonical install URLs through source snapshots without delegated output", async () => {
    const previousToken = process.env.WORKBENCH_API_TOKEN;
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configRoot = await makeTempRoot("workbench-cli-install-handle-config-");
    const configPath = path.join(configRoot, "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_API_TOKEN = "install-token";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer install-token");
      if (
        url.pathname === "/api/workbench/source/skills/alice/private-skill/releases/v007/source" ||
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
      return jsonResponse({ message: `Unexpected path ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const installed = await invoke([
        "install",
        "https://cloud.test/skills/alice/private-skill/releases/v007",
        "--list",
        "--json",
      ]);

      expect(installed.code).toBe(0);
      expect(stdoutJson(installed)).toMatchObject({
        schema: "workbench.cli.install.v1",
        ok: true,
        source: {
          kind: "workbench-cloud",
          owner: "alice",
          skill: "private-skill",
          versionId: "v007",
          installUrl: "https://cloud.test/skills/alice/private-skill",
          pinnedInstallUrl: "https://cloud.test/skills/alice/private-skill/releases/v007",
        },
        skills: ["private-skill"],
        fileCount: 1,
      });
      expect(installed.stdout).not.toContain("\u001b[");
      const handleInstall = await invoke([
        "install",
        "Alice/Private.Skill",
        "--list",
        "--json",
      ]);
      expect(handleInstall.code).toBe(0);
      expect(stdoutJson(handleInstall)).toMatchObject({
        source: {
          owner: "alice",
          skill: "private-skill",
          installUrl: "https://cloud.test/skills/alice/private-skill",
        },
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
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
    }
  }, 30_000);

  test("keeps sync plumbing available", async () => {
    const root = await makeTempRoot("workbench-cli-remotes-");
    expect((await invoke(["new", root, "--json"])).code).toBe(0);

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
    expect(stdoutJson<{ remotes: Array<{ name: string; sync: { status: string; lastError: { code: string } | null; nextCommand?: string } }> }>(status).remotes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "broken",
        sync: expect.objectContaining({
          status: "error",
          lastError: expect.objectContaining({ code: expect.any(String) }),
          nextCommand: "workbench sync broken",
        }),
      }),
    ]));
  });

  test("diff without a range compares current source to its parent", async () => {
    const root = await makeTempRoot("workbench-cli-diff-default-");
    expect((await invoke(["new", root, "--json"])).code).toBe(0);
    await fs.appendFile(path.join(root, "SKILL.md"), "\nDefault diff edit.\n");
    const diff = await invoke(["diff", "--dir", root, "--json"]);
    expect(diff.code, diff.stdout || diff.stderr).toBe(0);
    expect(stdoutJson<{ result: Array<{ path: string; status: string }> }>(diff).result)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: "SKILL.md", status: "modified" })]));
  });

  test("starts hosted eval through linked cloud remote and syncs queued run", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-eval-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousPoll = process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS;
    const previousTimeout = process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
    const configPath = path.join(root, "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS = "1";
    process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = "1000";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--json"])).code).toBe(0);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    const versionLog = await invoke(["log", "--versions", "--dir", root, "--json"]);
    const versionId = stdoutJson<{ entries: Array<{ id: string }> }>(versionLog).entries[0]!.id;
    const createdAt = "2026-06-11T00:00:00.000Z";
    const runningRun = {
      id: "run_cloud",
      kind: "eval",
      versionId,
      skillName: "primary",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "default",
      agentHash: "agent_cloud",
      status: "running",
      jobIds: ["job_cloud"],
      traceIds: [],
      createdAt,
    };
    const runningJob = {
      id: "job_cloud",
      runId: "run_cloud",
      kind: "eval",
      versionId,
      skillName: "primary",
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
      skillName: "primary",
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
    let remotePack = emptyObjectPack(createdAt);
    let started = false;
    let objectReadsAfterStart = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        if (started) {
          objectReadsAfterStart += 1;
          if (objectReadsAfterStart >= 2) {
            remotePack = {
              ...remotePack,
              runs: [succeededRun],
              jobs: [succeededJob],
              traces: [trace],
              artifacts: [artifact],
            };
          }
        }
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "PUT") {
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/runs" && method === "POST") {
        started = true;
        remotePack = {
          ...remotePack,
          runs: [runningRun],
          jobs: [runningJob],
        };
        return jsonResponse({
          skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" },
          runs: [runningRun],
        });
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const started = await invoke(["eval", "--cloud", "--dir", root, "--agents", "default", "--json"]);
      expect(started.code, started.stdout || started.stderr).toBe(0);
      expect(stdoutJson(started)).toMatchObject({
        schema: "workbench.cli.eval.v1",
        ok: true,
        result: [expect.objectContaining({ id: "run_cloud", status: "succeeded", traceIds: ["trace_cloud"] })],
        nextCommands: ["workbench publish"],
        cloud: expect.objectContaining({ remote: "cloud", skillId: "skill_cloud" }),
      });

      const runs = await invoke(["log", "--runs", "--dir", root, "--json"]);
      expect(runs.code, runs.stdout || runs.stderr).toBe(0);
      expect(stdoutJson<{ entries: Array<{ id: string; status: string }> }>(runs).entries)
        .toEqual(expect.arrayContaining([expect.objectContaining({ id: "run_cloud", status: "succeeded" })]));
      const stdout = await invoke(["show", "run_cloud:stdout.log", "--dir", root]);
      expect(stdout.code, stdout.stdout || stdout.stderr).toBe(0);
      expect(stdout.stdout).toContain("hosted done");
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousPoll === undefined) {
        delete process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS;
      } else {
        process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS = previousPoll;
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
    const previousPoll = process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS;
    const previousTimeout = process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
    const configPath = path.join(root, "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS = "1";
    process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = "1000";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "Alice.User",
    }));
    expect((await invoke(["new", root, "--json"])).code).toBe(0);
    const fileRemoteUrl = await writeFileRemoteNamedCloud(root, "workbench-cli-cloud-autolink-file-remote-");
    const ownerSlug = "alice-user";
    const skillName = normalizeTestHandlePart(path.basename(root));
    const versionId = stdoutJson<{ entries: Array<{ id: string }> }>(
      await invoke(["log", "--versions", "--dir", root, "--json"]),
    ).entries[0]!.id;
    const createdAt = "2026-06-11T00:00:00.000Z";
    const runningRun = {
      id: "run_autolink",
      kind: "eval",
      versionId,
      skillName: "primary",
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
      skillName: "primary",
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
      skillName: "primary",
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
    let remotePack = emptyObjectPack(createdAt);
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({
          skills: created ? [{ id: "skill_autolink", ownerSlug, name: skillName }] : [],
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
          if (objectReadsAfterStart >= 2) {
            remotePack = mergeObjectPacks(remotePack, {
              ...emptyObjectPack(createdAt),
              runs: [succeededRun],
              jobs: [succeededJob],
              traces: [trace],
            });
          }
        }
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_autolink/objects" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { objectPack?: ReturnType<typeof emptyObjectPack> };
        remotePack = mergeObjectPacks(remotePack, body.objectPack ?? emptyObjectPack(createdAt));
        return jsonResponse({ skill: { id: "skill_autolink", ownerSlug, name: skillName } });
      }
      if (url.pathname === "/api/workbench/skills/skill_autolink/runs" && method === "POST") {
        started = true;
        remotePack = mergeObjectPacks(remotePack, {
          ...emptyObjectPack(createdAt),
          runs: [runningRun],
        });
        return jsonResponse({ skill: { id: "skill_autolink", ownerSlug, name: skillName }, runs: [runningRun] });
      }
      if (url.pathname === `/api/workbench/source/skills/${ownerSlug}/${skillName}/source` && method === "GET") {
        expect(started).toBe(true);
        return jsonResponse({
          schema: "workbench.cloud.error.v1",
          code: "source_not_available",
          message: "No published source is available.",
          retryable: false,
          remediation: "Run workbench publish.",
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
        cloud: expect.objectContaining({
          remote: "cloud-1",
          skillId: "skill_autolink",
        }),
      });
      const remotesYaml = await fs.readFile(path.join(root, ".workbench", "remotes.yaml"), "utf8");
      expect(remotesYaml).toContain(fileRemoteUrl);
      expect(remotesYaml).toContain("cloud-1:");
      expect(remotesYaml).toContain(`https://cloud.test/skills/${ownerSlug}/${skillName}`);

      const install = await invoke(["install", `${ownerSlug}/${skillName}`, "--to", "local", "--json"]);
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
      if (previousPoll === undefined) {
        delete process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS;
      } else {
        process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS = previousPoll;
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
    const previousPoll = process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS;
    const previousTimeout = process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
    const configPath = path.join(root, "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS = "1";
    process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = "1000";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--json"])).code).toBe(0);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    const versionId = stdoutJson<{ entries: Array<{ id: string }> }>(
      await invoke(["log", "--versions", "--dir", root, "--json"]),
    ).entries[0]!.id;
    const createdAt = "2026-06-11T00:00:00.000Z";
    const runningRun = {
      id: "run_improve_cloud",
      kind: "improve",
      versionId,
      skillName: "primary",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "patcher",
      agentHash: "agent_cloud",
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
      versionId,
      skillName: "primary",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "patcher",
      agentHash: "agent_cloud",
      caseId: "current",
      sample: 0,
      status: "failed",
      artifactIds: [],
      traceIds: [],
      createdAt,
      finishedAt: "2026-06-11T00:00:02.000Z",
      error: "hosted improve failed",
    };
    let remotePack = emptyObjectPack(createdAt);
    let started = false;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        if (started) {
          remotePack = { ...remotePack, runs: [failedRun], jobs: [failedJob] };
        }
        return jsonResponse({ objectPack: remotePack });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "PUT") {
        return jsonResponse({ skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" } });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/improve" && method === "POST") {
        started = true;
        remotePack = { ...remotePack, runs: [runningRun] };
        return jsonResponse({
          skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" },
          runs: [runningRun],
        });
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
        remediation: "Run workbench show run_improve_cloud.",
      });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousPoll === undefined) {
        delete process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS;
      } else {
        process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS = previousPoll;
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
    const previousPoll = process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS;
    const previousTimeout = process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
    const configPath = path.join(root, "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS = "1";
    process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = "1000";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--json"])).code).toBe(0);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    const snapshot = stdoutJson<{
      result: { versions: Array<{ id: string; files: Array<{ path: string; content: string; kind?: string; encoding?: string; executable?: boolean }> }> };
    }>(await invoke(["open", "--dir", root, "--json"])).result;
    const baseVersion = snapshot.versions[0]!;
    const improvedVersionId = "v_cloud_improved";
    const improvedVersion = {
      id: improvedVersionId,
      hash: "hash_cloud_improved",
      message: "Hosted improvement",
      parentIds: [baseVersion.id],
      createdAt: "2026-06-11T00:00:02.000Z",
      files: baseVersion.files.map((file) =>
        file.path === "SKILL.md"
          ? { ...file, content: "# Hosted Improved Skill\n\nCloud promotion.\n" }
          : file
      ),
    };
    const createdAt = "2026-06-11T00:00:00.000Z";
    const runningRun = {
      id: "run_improve_success",
      kind: "improve",
      versionId: baseVersion.id,
      skillName: "primary",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "patcher",
      agentHash: "agent_cloud",
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
      skillName: "primary",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "patcher",
      agentHash: "agent_cloud",
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
      skillName: "primary",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "patcher",
      agentHash: "agent_cloud",
      createdAt: "2026-06-11T00:00:02.000Z",
      request: {},
      result: { status: "succeeded" },
      files: [],
    };
    let remotePack = emptyObjectPack(createdAt);
    let started = false;
    let objectReadsAfterStart = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        if (started) {
          objectReadsAfterStart += 1;
          if (objectReadsAfterStart >= 2) {
            remotePack = mergeObjectPacks(remotePack, {
              ...emptyObjectPack(createdAt),
              refs: { current: improvedVersionId },
              versions: [improvedVersion],
              runs: [succeededRun],
              jobs: [succeededJob],
              traces: [trace],
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
      if (url.pathname === "/api/workbench/skills/skill_cloud/improve" && method === "POST") {
        started = true;
        remotePack = mergeObjectPacks(remotePack, {
          ...emptyObjectPack(createdAt),
          runs: [runningRun],
        });
        return jsonResponse({
          skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" },
          runs: [runningRun],
        });
      }
      return jsonResponse({ message: `Unexpected ${method} ${url.pathname}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const improve = await invoke(["improve", "--cloud", "--dir", root, "--agents", "patcher", "--json"]);
      expect(improve.code, improve.stdout || improve.stderr).toBe(0);
      expect(stdoutJson(improve)).toMatchObject({
        schema: "workbench.cli.improve.v1",
        ok: true,
        nextCommands: ["workbench eval"],
        switchedVersionId: improvedVersionId,
      });
      await expect(fs.readFile(path.join(root, "SKILL.md"), "utf8"))
        .resolves.toContain("Hosted Improved Skill");
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousPoll === undefined) {
        delete process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS;
      } else {
        process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS = previousPoll;
      }
      if (previousTimeout === undefined) {
        delete process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
      } else {
        process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  test("hosted improve refuses to overwrite local edits made while cloud is running", async () => {
    const root = await makeTempRoot("workbench-cli-cloud-improve-conflict-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousPoll = process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS;
    const previousTimeout = process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS;
    const configPath = path.join(root, "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS = "1";
    process.env.WORKBENCH_CLOUD_RUN_TIMEOUT_MS = "1000";
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--json"])).code).toBe(0);
    await fs.writeFile(path.join(root, ".workbench", "remotes.yaml"), [
      "schema: workbench.remotes.v1",
      "remotes:",
      "  cloud:",
      "    url: https://cloud.test/skills/alice/cloud-skill",
      "    kind: workbench-cloud",
      "",
    ].join("\n"));
    const snapshot = stdoutJson<{
      result: { versions: Array<{ id: string; files: Array<{ path: string; content: string; kind?: string; encoding?: string; executable?: boolean }> }> };
    }>(await invoke(["open", "--dir", root, "--json"])).result;
    const baseVersion = snapshot.versions[0]!;
    const improvedVersionId = "v_cloud_conflict_improved";
    const localEdit = "Concurrent local edit while hosted improve runs.";
    const improvedVersion = {
      id: improvedVersionId,
      hash: "hash_cloud_conflict_improved",
      message: "Hosted improvement",
      parentIds: [baseVersion.id],
      createdAt: "2026-06-11T00:00:02.000Z",
      files: baseVersion.files.map((file) =>
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
      skillName: "primary",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "patcher",
      agentHash: "agent_cloud",
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
      skillName: "primary",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "patcher",
      agentHash: "agent_cloud",
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
      skillName: "primary",
      skillBundleHash: "bundle_cloud",
      evalHash: "eval_cloud",
      agentName: "patcher",
      agentHash: "agent_cloud",
      createdAt: "2026-06-11T00:00:02.000Z",
      request: {},
      result: { status: "succeeded" },
      files: [],
    };
    let remotePack = emptyObjectPack(createdAt);
    let started = false;
    let objectReadsAfterStart = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloud-token");
      if (url.pathname === "/api/workbench/skills" && method === "GET") {
        return jsonResponse({ skills: [{ id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" }] });
      }
      if (url.pathname === "/api/workbench/skills/skill_cloud/objects" && method === "GET") {
        if (started) {
          objectReadsAfterStart += 1;
          if (objectReadsAfterStart >= 2) {
            remotePack = mergeObjectPacks(remotePack, {
              ...emptyObjectPack(createdAt),
              refs: { current: improvedVersionId },
              versions: [improvedVersion],
              runs: [succeededRun],
              jobs: [succeededJob],
              traces: [trace],
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
      if (url.pathname === "/api/workbench/skills/skill_cloud/improve" && method === "POST") {
        started = true;
        remotePack = mergeObjectPacks(remotePack, {
          ...emptyObjectPack(createdAt),
          runs: [runningRun],
        });
        await fs.appendFile(path.join(root, "SKILL.md"), `\n${localEdit}\n`);
        return jsonResponse({
          skill: { id: "skill_cloud", ownerSlug: "alice", name: "cloud-skill" },
          runs: [runningRun],
        });
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
        remediation: `Review workbench diff, then run workbench switch ${improvedVersionId} when ready.`,
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
      if (previousPoll === undefined) {
        delete process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS;
      } else {
        process.env.WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS = previousPoll;
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
    const configPath = path.join(root, "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "cloud-token",
      username: "alice",
    }));
    expect((await invoke(["new", root, "--json"])).code).toBe(0);
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
      if (url.pathname === "/api/workbench/skills/skill_cloud/runs" && method === "POST") {
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
        remediation: "Run workbench log --runs.",
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
    const configPath = path.join(root, "config.json");
    process.env.WORKBENCH_CONFIG = configPath;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "publish-token",
      username: "Alice.User",
    }));
    try {
      expect((await invoke(["new", root, "--json"])).code).toBe(0);
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
      expect(stdoutJson<{ version: { id: string } }>(publish).version.id).not.toBe(originalVersionId);
      await expect(fs.access(path.join(root, ".workbench", "remotes.yaml"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("publish --as dry-run persists the linked cloud handle", async () => {
    const root = await makeTempRoot("workbench-cli-publish-as-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const configPath = path.join(root, "config.json");
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
      expect((await invoke(["new", root, "--json"])).code).toBe(0);
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
        installUrl: "https://cloud.test/skills/acme/earnings-prep",
      });
      const remotesYaml = await fs.readFile(path.join(root, ".workbench", "remotes.yaml"), "utf8");
      expect(remotesYaml).toContain(fileRemoteUrl);
      expect(remotesYaml).toContain("cloud-1:");
      expect(remotesYaml).toContain("https://cloud.test/skills/acme/earnings-prep");

      const second = await invoke(["publish", "--dry-run", "--dir", root, "--json"]);
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
        installUrl: "https://cloud.test/skills/acme/earnings-prep",
      });
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
    }
  });

  test("installs source snapshots only to explicit native targets", async () => {
    const root = await makeTempRoot("workbench-cli-install-native-");
    const configPath = path.join(root, "config.json");
    const codexHome = path.join(root, "codex-home");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.WORKBENCH_CONFIG = configPath;
    process.env.CODEX_HOME = codexHome;
    await fs.writeFile(configPath, JSON.stringify({
      schema: "workbench.cli.config.v1",
      baseUrl: "https://cloud.test",
      accessToken: "install-token",
    }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      schema: "workbench.source.snapshot.v1",
      owner: "alice",
      name: "private-skill",
      versionId: "v007",
      files: [{
        path: "SKILL.md",
        kind: "text",
        encoding: "utf8",
        executable: false,
        content: "# Private Skill\n",
      }],
    })));
    try {
      const installed = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--to", "codex", "--json"]);
      expect(installed.code).toBe(0);
      expect(stdoutJson(installed)).toMatchObject({
        schema: "workbench.cli.install.v1",
        ok: true,
        result: "installed",
        targets: [expect.objectContaining({
          agent: "codex",
          mode: "copy",
          previous: "none",
          destination: path.join(codexHome, "skills", "private-skill"),
        })],
        filesCopied: 1,
      });
      await expect(fs.readFile(path.join(codexHome, "skills", "private-skill", "SKILL.md"), "utf8")).resolves.toBe("# Private Skill\n");
    } finally {
      if (previousConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousConfig;
      }
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
    }
  });

  test("login start-only and wait emit one structured document per command", async () => {
    const root = await makeTempRoot("workbench-cli-login-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousDevice = process.env.WORKBENCH_DEVICE_AUTH;
    process.env.WORKBENCH_CONFIG = path.join(root, "config.json");
    process.env.WORKBENCH_DEVICE_AUTH = path.join(root, "device-auth.json");
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
      const start = await invoke(["login", "--base-url", "https://cloud.test", "--start-only", "--no-open", "--json"]);
      expect(start.code).toBe(0);
      expect(stdoutJson(start)).toMatchObject({
        schema: "workbench.cli.login.v1",
        ok: true,
        status: "authorization_pending",
        userCode: "ABCD-EFGH",
        resume: "workbench login --wait --timeout 120",
      });
      expect(start.stdout.trim().split("\n")[0]).toBe("{");

      const wait = await invoke(["login", "--base-url", "https://cloud.test", "--wait", "--timeout", "5", "--json"]);
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
    }
  });

  test("requires singular improve selectors when manifest defaults expand to sets", async () => {
    const root = await makeTempRoot("workbench-cli-improve-default-all-");
    await invoke(["new", root]);
    await fs.mkdir(path.join(root, "skills", "variant"), { recursive: true });
    await fs.writeFile(path.join(root, "skills", "variant", "SKILL.md"), "# Variant\n");
    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "default: all",
      "skills:",
      "  primary:",
      "    path: .",
      "  variant:",
      "    path: skills/variant",
      "",
    ].join("\n"));
    await fs.writeFile(path.join(root, ".workbench", "agents.yaml"), [
      "default: all",
      "agents:",
      "  default:",
      "    adapter: local",
      "    model: docker",
      "    with: {}",
      "  patcher:",
      "    adapter: command",
      "    with:",
      "      improveCommand: 'true'",
      "",
    ].join("\n"));

    const result = await invoke(["improve", "--dir", root, "--json"]);
    expect(result.code).toBe(2);
    expect(stdoutJson(result)).toMatchObject({
      ok: false,
      code: "usage",
      message: expect.stringContaining("requires exactly one skill and one agent"),
    });
  });

  test("lists the built-in no-skill baseline without an undefined location", async () => {
    const root = await makeTempRoot("workbench-cli-skills-none-");
    await invoke(["new", root]);
    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "default: all",
      "skills:",
      "  primary:",
      "    path: .",
      "  no-skill:",
      "    baseline: none",
      "",
    ].join("\n"));

    const result = await invoke(["open", "--json", "--dir", root]);

    expect(result.code).toBe(0);
    expect(stdoutJson<{ result: { skillSources: Array<{ name: string; kind: string }> } }>(result).result.skillSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "no-skill", kind: "none" }),
    ]));
    expect(result.stdout).not.toContain("undefined");
  });

  test("uploads adapter auth to Workbench Cloud when logged in", async () => {
    const root = await makeTempRoot("workbench-cli-remote-auth-");
    const configPath = path.join(root, "config.json");
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
        workbenchCloud: { status: "authenticated", sync: "uploaded" },
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

    expect((await invoke(["new", root])).code).toBe(0);
    expect((await invoke(["agent", "add", "codex", "--dir", root, "--adapter", "codex", "--model", "gpt-test"])).code).toBe(0);

    const agents = await invoke(["agent", "list", "--dir", root]);
    expect(agents.code).toBe(0);
    expect(agents.stdout).toContain("codex\tcodex\tgpt-test");
  });

  test("serializes concurrent project commands through the local project lock", async () => {
    const root = await makeTempRoot("workbench-cli-lock-");
    expect((await invoke(["new", root, "--json"])).code).toBe(0);
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
    expect(statusJson.worktree.latestVersionId).toBe(statusJson.project.currentVersionId);
    expect(stdoutJson<{ entries: Array<{ id: string }> }>(versions).entries.length).toBeGreaterThan(0);
    expect(stdoutJson<{ entries: unknown[] }>(runs).entries).toHaveLength(0);
    expect(stdoutJson(shown)).toMatchObject({
      result: {
      path: "SKILL.md",
      content: expect.stringContaining("Manual CLI concurrent edit."),
      },
    });
    await expect(fs.stat(path.join(root, ".workbench", "locks", "project.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("serves the inspection shell for local deep links", async () => {
    const root = await makeTempRoot("workbench-cli-open-");
    await invoke(["new", root]);
    const versions = await invoke(["log", "--versions", "--dir", root, "--json"]);
    const versionId = stdoutJson<{ entries: Array<{ id: string }> }>(versions).entries[0]!.id;
    const evidenceCreatedAt = "2026-06-10T19:00:00.000Z";
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
    await fs.mkdir(path.join(root, ".workbench", "objects", "run"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "job"), { recursive: true });
    await fs.mkdir(path.join(root, ".workbench", "objects", "trace"), { recursive: true });
    await fs.writeFile(path.join(root, ".workbench", "objects", "run", "run_evidence.json"), JSON.stringify({
      id: "run_evidence",
      kind: "eval",
      versionId,
      skillName: "primary",
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
      skillName: "primary",
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
      skillName: "primary",
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
      const response = await fetch(new URL("/compare/runs/run_example", server.url));
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
      const snapshot = await snapshotResponse.json() as { versions: Array<{ files: Array<{ path: string; content: string }> }> };
      expect(snapshot.versions[0]?.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "SKILL.md", content: "" }),
        expect.objectContaining({ path: ".workbench/eval.yaml", content: "" }),
      ]));
      const fileResponse = await fetch(new URL(`/api/versions/${versionId}/files/SKILL.md`, server.url));
      expect(fileResponse.status).toBe(200);
      const fileContent = await fileResponse.json() as { path: string; content: string };
      expect(fileContent.path).toBe("SKILL.md");
      expect(fileContent.content.length).toBeGreaterThan(0);
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

  test("login --wait requires an explicit timeout", async () => {
    const root = await makeTempRoot("workbench-cli-login-wait-timeout-");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "config.json"));
    const result = await invoke(["login", "--base-url", "https://cloud.test", "--wait", "--json"]);
    expect(result.code).toBe(2);
    expect(stdoutJson(result)).toMatchObject({
      ok: false,
      code: "usage",
      remediation: "Run workbench login --wait --timeout 120.",
    });
  });

  test("login --wait timeout validation is not masked by missing Cloud URL", async () => {
    const root = await makeTempRoot("workbench-cli-login-wait-timeout-no-url-");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "config.json"));
    vi.stubEnv("WORKBENCH_API_URL", undefined);
    const result = await invoke(["login", "--wait", "--json"]);
    expect(result.code).toBe(2);
    expect(stdoutJson(result)).toMatchObject({
      ok: false,
      code: "usage",
      message: "workbench login --wait requires --timeout N.",
      remediation: "Run workbench login --wait --timeout 120.",
    });
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
      subject: {
        verificationUri: "https://cloud.test/device",
        verificationUriComplete: "https://cloud.test/device?user_code=WXYZ-1234",
        userCode: "WXYZ-1234",
        expiresAt: expect.any(String),
      },
    });
    expect(json.stdout.trim().split("\n")[0]).toBe("{");
  }, 30_000);

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
    const configPath = path.join(root, "config.json");
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
      configRemoved: true,
      adapterAuthRetained: false,
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
      configRemoved: false,
      adapterAuthRetained: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("log --versions emits version summaries without file contents", async () => {
    const root = await makeTempRoot("workbench-cli-version-summary-");
    expect((await invoke(["new", root, "--json"])).code).toBe(0);
    const marker = "VERSIONS_JSON_CONTENT_MARKER";
    await fs.appendFile(path.join(root, "SKILL.md"), `\n${marker}\n`);

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

  test("install pre-validates all targets before writing any destination", async () => {
    const root = await makeTempRoot("workbench-cli-install-prevalidate-");
    const codexHome = path.join(root, "codex-home");
    const claudeHome = path.join(root, "claude-home");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "config.json"));
    vi.stubEnv("CODEX_HOME", codexHome);
    vi.stubEnv("CLAUDE_HOME", claudeHome);
    const claudeTarget = path.join(claudeHome, "skills", "private-skill");
    await fs.mkdir(claudeTarget, { recursive: true });
    await fs.writeFile(path.join(claudeTarget, "SKILL.md"), "# Different existing content\n");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      schema: "workbench.source.snapshot.v1",
      owner: "alice",
      name: "private-skill",
      versionId: "v007",
      files: [{ path: "SKILL.md", kind: "text", encoding: "utf8", executable: false, content: "# Private Skill\n" }],
    })));

    const conflicted = await invoke([
      "install",
      "https://cloud.test/skills/alice/private-skill",
      "--to",
      "codex",
      "--to",
      "claude",
      "--json",
    ]);
    expect(conflicted.code).toBe(1);
    expect(stdoutJson(conflicted)).toMatchObject({
      ok: false,
      code: "install_failed",
      subject: { destination: claudeTarget },
    });
    await expect(fs.stat(path.join(codexHome, "skills", "private-skill"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(path.join(claudeTarget, "SKILL.md"), "utf8")).resolves.toBe("# Different existing content\n");
  });

  test("install dry-run reports the planned copy without writing and rejects --copy", async () => {
    const root = await makeTempRoot("workbench-cli-install-dry-run-");
    const codexHome = path.join(root, "codex-home");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "config.json"));
    vi.stubEnv("CODEX_HOME", codexHome);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      schema: "workbench.source.snapshot.v1",
      owner: "alice",
      name: "private-skill",
      versionId: "v007",
      files: [{ path: "SKILL.md", kind: "text", encoding: "utf8", executable: false, content: "# Private Skill\n" }],
    })));

    const dryRun = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--to", "codex", "--dry-run", "--json"]);
    expect(dryRun.code).toBe(0);
    expect(stdoutJson(dryRun)).toMatchObject({
      schema: "workbench.cli.install.v1",
      ok: true,
      result: "installed",
      filesCopied: 1,
      dryRun: true,
      targets: [expect.objectContaining({ agent: "codex", previous: "none" })],
    });
    await expect(fs.stat(path.join(codexHome, "skills", "private-skill"))).rejects.toMatchObject({ code: "ENOENT" });

    const copyFlag = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--to", "codex", "--copy", "--json"]);
    expect(copyFlag.code).toBe(2);
    expect(stdoutJson(copyFlag)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --copy for workbench install.",
    });
  });

  test("install reports unchanged targets without rewriting identical content", async () => {
    const root = await makeTempRoot("workbench-cli-install-unchanged-");
    const codexHome = path.join(root, "codex-home");
    vi.stubEnv("WORKBENCH_CONFIG", path.join(root, "config.json"));
    vi.stubEnv("CODEX_HOME", codexHome);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      schema: "workbench.source.snapshot.v1",
      owner: "alice",
      name: "private-skill",
      versionId: "v007",
      files: [{ path: "SKILL.md", kind: "text", encoding: "utf8", executable: false, content: "# Private Skill\n" }],
    })));

    const first = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--to", "codex", "--json"]);
    expect(first.code).toBe(0);
    expect(stdoutJson(first)).toMatchObject({ result: "installed", filesCopied: 1 });

    const second = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--to", "codex", "--json"]);
    expect(second.code).toBe(0);
    expect(stdoutJson(second)).toMatchObject({
      result: "unchanged",
      filesCopied: 0,
      targets: [expect.objectContaining({ agent: "codex", previous: "unchanged" })],
    });
  });

  dockerTest("runs the local skill lifecycle through public commands", async () => {
    const root = await makeTempRoot("workbench-cli-skill-");

    expect((await invoke(["new", root])).code).toBe(0);

    const versions = await invoke(["log", "--versions", "--json", "--dir", root]);
    expect(versions.stderr).toBe("");
    const [version] = stdoutJson<{ entries: Array<{ id: string }> }>(versions).entries;
    expect(version.id).toMatch(/^v_[a-f0-9]{64}$/u);

    const evalResult = await invoke(["eval", "--dir", root, "--json"]);
    const runs = stdoutJson<{ result: Array<{ id: string; versionId: string; score?: number; jobIds: string[]; traceIds: string[] }> }>(evalResult).result;
    expect(runs).toHaveLength(1);
    expect(runs[0]?.versionId).toBe(version.id);
    expect(runs[0]?.score).toBeUndefined();
    expect(runs[0]?.jobIds).toHaveLength(1);
    expect(runs[0]?.traceIds).toHaveLength(1);
    const smokeSnapshot = stdoutJson<{
      result: {
        traces: Array<{ id: string; result: { score?: number; metrics?: { score?: number }; cases?: Array<{ metrics?: { score?: number } }> } }>;
      };
    }>(await invoke(["open", "--dir", root, "--json"])).result;
    const smokeTrace = smokeSnapshot.traces.find((trace) => runs[0]!.traceIds.includes(trace.id));
    expect(smokeTrace?.result.score).toBeUndefined();
    expect(smokeTrace?.result.metrics?.score).toBeUndefined();
    expect(smokeTrace?.result.cases?.[0]?.metrics?.score).toBeUndefined();
    const reusedEval = await invoke(["eval", "--dir", root, "--json"]);
    const reusedRuns = stdoutJson<{ result: Array<{ id: string }> }>(reusedEval).result;
    expect(reusedRuns[0]?.id).toBe(runs[0]?.id);
    const rerunEval = await invoke(["eval", "--dir", root, "--rerun", "--json"]);
    const rerunRuns = stdoutJson<{ result: Array<{ id: string; score?: number }> }>(rerunEval).result;
    expect(rerunRuns[0]?.id).not.toBe(runs[0]?.id);
    expect(rerunRuns[0]?.score).toBeUndefined();

    const prematureImprove = await invoke(["improve", "--dir", root, "--json"]);
    expect(prematureImprove.code).toBe(2);
    expect(prematureImprove.stderr).toBe("");
    expect(stdoutJson(prematureImprove)).toMatchObject({
      ok: false,
      code: "usage",
      message: expect.stringContaining("needs failed or reviewed trace evidence"),
    });

    await writeFailingCaseTest(root, "cli workflow failure");
    const failingEval = await invoke(["eval", "--dir", root, "--json"]);
    expect(failingEval.code).toBe(1);
    const failingEvalJson = stdoutJson<{
      ok: false;
      code: string;
      failedRuns: Array<{ runId: string; versionId: string; status: string; score: number; traceIds: string[] }>;
      nextCommands: string[];
    }>(failingEval);
    expect(failingEvalJson).toMatchObject({ ok: false, code: "eval_runs_failed", evidenceSaved: true });
    expect(failingEvalJson.nextCommands).toContain(`workbench show ${failingEvalJson.failedRuns[0]!.runId}`);
    const failedRuns = failingEvalJson.failedRuns;
    expect(failedRuns[0]?.status).toBe("failed");
    expect(failedRuns[0]?.score).toBe(0);
    const failedRun = failedRuns[0]!;
    const failingEvalHuman = await invoke(["eval", "--dir", root]);
    expect(failingEvalHuman.code).toBe(1);
    expect(failingEvalHuman.stdout).toContain(`next: workbench show ${failedRun.runId}`);
    expect(failingEvalHuman.stdout).not.toContain("workbench case add");
    expect(failingEvalHuman.stdout).not.toContain("workbench improve --agents");
    const failedStderr = await invoke(["show", `${failedRun.runId}:stderr.log`, "--dir", root]);
    expect(failedStderr.stdout).toContain("cli workflow failure");

    const defaultImprove = await invoke(["improve", "--dir", root, "--json"]);
    expect(defaultImprove.code).toBe(2);
    expect(defaultImprove.stderr).toBe("");
    expect(stdoutJson(defaultImprove)).toMatchObject({
      ok: false,
      code: "usage",
      message: expect.stringContaining("no skill-improvement adapter"),
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
    const patcherFailedRuns = stdoutJson<{ failedRuns: Array<{ versionId: string }> }>(patcherFailingEval).failedRuns;
    const patcherBaseVersionId = patcherFailedRuns[0]!.versionId;

    const improve = await invoke(["improve", "--dir", root, "--agents", "patcher", "--json"]);
    expect(improve.code).toBe(2);
    expect(stdoutJson(improve)).toMatchObject({
      ok: false,
      code: "usage",
      message: expect.stringContaining("Improve proof eval failed"),
    });

    const compare = await invoke(["compare", "--dir", root, "--agents", "patcher"]);
    expect(compare.stdout).toContain("version\tskill\tagent\tstatus\tscore\tcost");
    expect(compare.stdout).toContain(patcherBaseVersionId);
    expect(compare.stdout).toContain("\tfailed\t");
    expect(compare.stdout).toContain("\tn/a\t");
    const improveSnapshot = stdoutJson<{
      result: {
      refs: { current?: string };
      runs: Array<{ kind: string; agentName: string; status: string; outputVersionId?: string }>;
      };
    }>(await invoke(["open", "--dir", root, "--json"])).result;
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
      expect(stdoutJson(publish)).toMatchObject({
        ok: false,
        code: "auth_required",
        remediation: "Run workbench login.",
      });
    } finally {
      if (previousPublishConfig === undefined) {
        delete process.env.WORKBENCH_CONFIG;
      } else {
        process.env.WORKBENCH_CONFIG = previousPublishConfig;
      }
    }

    const trace = await invoke(["show", runs[0]!.id, "--dir", root, "--json"]);
    expect(stdoutJson<{ result: unknown[] }>(trace).result).toHaveLength(1);

    const snapshot = await invoke(["open", "--dir", root, "--json"]);
    const snapshotJson = stdoutJson<{
      result: {
        status: { initialized: boolean; currentVersionId?: string };
        refs: { current?: string };
        jobs: unknown[];
        artifacts: unknown[];
      };
    }>(snapshot).result;
    expect(snapshotJson.jobs).toHaveLength(5);
    expect(snapshotJson.artifacts.length).toBeGreaterThan(0);
    expect(snapshotJson).toMatchObject({
      status: {
        initialized: true,
      },
    });
    expect(snapshotJson.refs.current).toBe(snapshotJson.status.currentVersionId);

    const capturedCase = await invoke(["case", "add", runs[0]!.id, "--dir", root, "--json"]);
    expect(capturedCase.code, capturedCase.stdout || capturedCase.stderr).toBe(0);
    const capturedCaseJson = stdoutJson<{ result: { id: string; content: string } }>(capturedCase);
    const capturedCaseId = capturedCaseJson.result.id;
    expect(capturedCaseId).toMatch(/^case-\d{3}$/u);
    expect(capturedCaseJson.result.content).toContain(`sourceTraceId: ${runs[0]!.traceIds[0]}`);
    const caseList = await invoke(["case", "list", "--dir", root]);
    expect(caseList.stdout).toContain(capturedCaseId);
    const removedCase = await invoke(["case", "rm", capturedCaseId, "--dir", root, "--json"]);
    expect(removedCase.code, removedCase.stdout || removedCase.stderr).toBe(0);
    expect(stdoutJson(removedCase)).toMatchObject({ result: { removed: capturedCaseId } });

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
        workbenchCloud: {
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

function normalizeTestHandlePart(value: string): string {
  return normalizeWorkbenchSkillName(value) || "skill";
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
