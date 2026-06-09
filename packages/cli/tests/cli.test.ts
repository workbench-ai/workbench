import { Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

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
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })
  ));
});

describe("workbench skill-first CLI", () => {
  test("rejects unsupported and context-invalid flags before handlers run", async () => {
    const unsupportedEvalFlag = await invoke(["eval", "--preview", "--eval", "alice/unsupported", "--json"]);
    expect(unsupportedEvalFlag.code).toBe(2);
    expect(JSON.parse(unsupportedEvalFlag.stdout)).toMatchObject({
      ok: false,
      error: "Unsupported flag --preview for workbench eval.",
    });

    const unsupportedProfileFlag = await invoke(["improve", "--profile", "main", "--json"]);
    expect(unsupportedProfileFlag.code).toBe(2);
    expect(JSON.parse(unsupportedProfileFlag.stdout)).toMatchObject({
      ok: false,
      error: "Unsupported flag --profile for workbench improve.",
    });

    const valuedBoolean = await invoke(["eval", "--preview=false", "--json"]);
    expect(valuedBoolean.code).toBe(2);
    expect(JSON.parse(valuedBoolean.stdout)).toMatchObject({
      ok: false,
      error: "Unsupported flag --preview for workbench eval.",
    });

    const staleInitFlag = await invoke(["init", await makeTempRoot("workbench-init-stale-"), "--remote", "old", "--json"]);
    expect(staleInitFlag.code).toBe(2);
    expect(JSON.parse(staleInitFlag.stdout)).toMatchObject({
      ok: false,
      error: "Unsupported flag --remote for workbench init.",
    });
  });

  test("rejects flags that belong to a different subcommand", async () => {
    const authStatusMethod = await invoke(["auth", "status", "--method", "api-key", "--json"]);
    expect(authStatusMethod.code).toBe(2);
    expect(JSON.parse(authStatusMethod.stdout)).toMatchObject({
      ok: false,
      error: "Unsupported flag --method for workbench auth.",
    });

    const caseListFrom = await invoke(["case", "list", "--from", "trace_1", "--json"]);
    expect(caseListFrom.code).toBe(2);
    expect(JSON.parse(caseListFrom.stdout)).toMatchObject({
      ok: false,
      error: "Unsupported flag --from for workbench case.",
    });

    const agentListAdapter = await invoke(["agent", "list", "--adapter", "codex", "--json"]);
    expect(agentListAdapter.code).toBe(2);
    expect(JSON.parse(agentListAdapter.stdout)).toMatchObject({
      ok: false,
      error: "Unsupported flag --adapter for workbench agent.",
    });

    const agentMissingSubcommandAdapter = await invoke(["agent", "--adapter", "codex", "--json"]);
    expect(agentMissingSubcommandAdapter.code).toBe(2);
    expect(JSON.parse(agentMissingSubcommandAdapter.stdout)).toMatchObject({
      ok: false,
      error: "Unsupported flag --adapter for workbench agent.",
    });

    const agentUnknownSubcommandAdapter = await invoke(["agent", "bogus", "--adapter", "codex", "--json"]);
    expect(agentUnknownSubcommandAdapter.code).toBe(2);
    expect(JSON.parse(agentUnknownSubcommandAdapter.stdout)).toMatchObject({
      ok: false,
      error: "Unsupported flag --adapter for workbench agent.",
    });
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
      const connect = await invoke(["auth", "connect", "codex", "--method", "api-key", "--json"]);
      expect(connect.code).toBe(0);
      expect(JSON.parse(connect.stdout)).toMatchObject({
        adapter: "codex",
        method: "api-key",
        remote: { status: "connected" },
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

  test("reports provider-backed agents as supported eval modes", async () => {
    const root = await makeTempRoot("workbench-cli-provider-check-");

    expect((await invoke(["init", root])).code).toBe(0);
    expect((await invoke(["agent", "add", "codex", "--dir", root, "--adapter", "codex", "--model", "gpt-test"])).code).toBe(0);

    const check = await invoke(["check", "--dir", root]);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain("codex\tcodex\tgpt-test\tprovider-eval");
    expect(check.stdout).not.toContain("provider-bridge-pending");

    expect((await invoke(["agent", "add", "unknown", "--dir", root, "--adapter", "unknown"])).code).toBe(0);
    const unsupported = await invoke(["check", "--dir", root, "--json"]);
    expect(unsupported.code).toBe(2);
    expect(JSON.parse(unsupported.stdout)).toMatchObject({
      ok: false,
      error: expect.stringContaining("unsupported skill eval adapter unknown"),
    });
  });

  test("serves the inspection shell for local deep links", async () => {
    const root = await makeTempRoot("workbench-cli-open-");
    await invoke(["init", root]);
    const versions = await invoke(["versions", "--dir", root, "--json"]);
    const versionId = (JSON.parse(versions.stdout) as Array<{ id: string }>)[0]!.id;
    const server = await startWorkbenchOpenServer({ dir: root, host: "0.0.0.0" });
    try {
      expect(server.url.startsWith("http://127.0.0.1:")).toBe(true);
      expect(server.url.endsWith("/")).toBe(true);
      const response = await fetch(new URL("/runs/run_000001", server.url));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      await expect(response.text()).resolves.toContain("<div id=\"root\"></div>");
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
      const missingApi = await fetch(new URL("/api/missing", server.url));
      expect(missingApi.status).toBe(404);
      expect(missingApi.headers.get("content-type")).toContain("application/json");
      await expect(missingApi.json()).resolves.toMatchObject({ message: "Not found" });
    } finally {
      await server.close();
    }
  });

  dockerTest("runs the local skill lifecycle through public commands", async () => {
    const root = await makeTempRoot("workbench-cli-skill-");

    expect((await invoke(["init", root])).code).toBe(0);
    const check = await invoke(["check", "--dir", root]);
    expect(check.stdout).toContain("Agent plan:");
    expect(check.stdout).toContain("default\tlocal");

    const versions = await invoke(["versions", "--json", "--dir", root]);
    expect(versions.stderr).toBe("");
    const [version] = JSON.parse(versions.stdout) as Array<{ id: string }>;
    expect(version.id).toBe("v001");

    const evalResult = await invoke(["eval", "--dir", root, "--json"]);
    const runs = JSON.parse(evalResult.stdout) as Array<{ id: string; versionId: string; score?: number; jobIds: string[]; traceIds: string[] }>;
    expect(runs).toHaveLength(1);
    expect(runs[0]?.versionId).toBe("v001");
    expect(runs[0]?.score).toBeUndefined();
    expect(runs[0]?.jobIds).toHaveLength(1);
    expect(runs[0]?.traceIds).toHaveLength(1);
    const smokeTraceResult = await invoke(["trace", runs[0]!.id, "--dir", root, "--json"]);
    const smokeTraces = JSON.parse(smokeTraceResult.stdout) as Array<{ result: { score?: number; metrics?: { score?: number }; cases?: Array<{ metrics?: { score?: number } }> } }>;
    expect(smokeTraces[0]?.result.score).toBeUndefined();
    expect(smokeTraces[0]?.result.metrics?.score).toBeUndefined();
    expect(smokeTraces[0]?.result.cases?.[0]?.metrics?.score).toBeUndefined();
    const reusedEval = await invoke(["eval", "--dir", root, "--json"]);
    const reusedRuns = JSON.parse(reusedEval.stdout) as Array<{ id: string }>;
    expect(reusedRuns[0]?.id).toBe(runs[0]?.id);
    const rerunEval = await invoke(["eval", "--dir", root, "--rerun", "--json"]);
    const rerunRuns = JSON.parse(rerunEval.stdout) as Array<{ id: string; score?: number }>;
    expect(rerunRuns[0]?.id).not.toBe(runs[0]?.id);
    expect(rerunRuns[0]?.score).toBeUndefined();

    const prematureImprove = await invoke(["improve", "--dir", root, "--json"]);
    expect(prematureImprove.code).toBe(2);
    expect(prematureImprove.stderr).toBe("");
    expect(JSON.parse(prematureImprove.stdout)).toMatchObject({
      ok: false,
      error: expect.stringContaining("needs failed or reviewed trace evidence"),
    });

    await writeFailingCaseTest(root, "cli workflow failure");
    const failingEval = await invoke(["eval", "--dir", root, "--json"]);
    expect(failingEval.code).toBe(1);
    const failedRuns = JSON.parse(failingEval.stdout) as Array<{ id: string; versionId: string; status: string; score: number; traceIds: string[] }>;
    expect(failedRuns[0]?.status).toBe("failed");
    expect(failedRuns[0]?.score).toBe(0);
    const failedRun = failedRuns[0]!;
    const failedTraceId = failedRun.traceIds[0]!;
    const failedStderr = await invoke(["show", `${failedTraceId}:stderr.log`, "--dir", root]);
    expect(failedStderr.stdout).toContain("cli workflow failure");

    const defaultImprove = await invoke(["improve", "--dir", root, "--json"]);
    expect(defaultImprove.code).toBe(2);
    expect(defaultImprove.stderr).toBe("");
    expect(JSON.parse(defaultImprove.stdout)).toMatchObject({
      ok: false,
      error: expect.stringContaining("no skill-improvement adapter"),
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
    expect((await invoke(["agent", "default", "patcher", "--dir", root])).code).toBe(0);
    const patcherFailingEval = await invoke(["eval", "--dir", root, "--agent", "patcher", "--json"]);
    expect(patcherFailingEval.code).toBe(1);
    const patcherFailedRuns = JSON.parse(patcherFailingEval.stdout) as Array<{ versionId: string }>;
    const patcherBaseVersionId = patcherFailedRuns[0]!.versionId;

    const improve = await invoke(["improve", "--dir", root, "--agent", "patcher", "--json"]);
    expect(improve.code).toBe(0);
    const improved = JSON.parse(improve.stdout) as {
      version: { id: string; parentIds: string[] };
      switched: boolean;
      promoted: boolean;
      promotionReason: string;
    };
    expect(improved.version.parentIds).toEqual([patcherBaseVersionId]);
    expect(improved.switched).toBe(false);
    expect(improved.promoted).toBe(false);
    expect(improved.promotionReason).toContain("finished failed");

    const retry = await invoke(["retry", failedRun.id, "--dir", root, "--json"]);
    expect(retry.code).toBe(1);
    const retryRuns = JSON.parse(retry.stdout) as Array<{ parentRunId?: string; status: string; jobIds: string[] }>;
    expect(retryRuns[0]?.parentRunId).toBe(failedRun.id);
    expect(retryRuns[0]?.jobIds).toHaveLength(1);

    const compare = await invoke(["compare", "--dir", root]);
    expect(compare.stdout).toContain("version\tskill\tagent\tscore\treadiness\tcost");
    expect(compare.stdout).toContain(improved.version.id);
    expect(compare.stdout).toContain("\tn/a\t");

    const remote = await makeTempRoot("workbench-cli-remote-");
    const remoteAdd = await invoke(["remote", "add", "origin", remote, "--dir", root, "--json"]);
    expect(remoteAdd.code).toBe(0);
    expect(JSON.parse(remoteAdd.stdout)).toMatchObject({ name: "origin", url: remote, type: "workbench" });
    const sync = await invoke(["sync", "--dir", root, "--json"]);
    expect(sync.code).toBe(0);
    expect(JSON.parse(sync.stdout)).toMatchObject({
      remote: { name: "origin", type: "workbench" },
      pushed: expect.any(Number),
      pulled: expect.any(Number),
    });
    const publish = await invoke(["publish", improved.version.id, "--dir", root, "--visibility", "public", "--json"]);
    expect(publish.code).toBe(0);
    expect(JSON.parse(publish.stdout)).toMatchObject({
      visibility: "public",
      version: { id: improved.version.id },
      installUrl: path.join(remote, "source"),
      pinnedInstallUrl: `${remote}/releases/${improved.version.id}`,
    });
    expect(await fs.readFile(path.join(remote, "source", "SKILL.md"), "utf8")).toContain("Command-backed improvement from CLI trace evidence.");
    await expect(fs.stat(path.join(remote, "source", ".workbench", "objects"))).rejects.toThrow();

    const trace = await invoke(["trace", runs[0]!.id, "--dir", root, "--json"]);
    expect(JSON.parse(trace.stdout)).toHaveLength(1);

    const jobs = await invoke(["list", "jobs", "--dir", root, "--json"]);
    expect(JSON.parse(jobs.stdout)).toHaveLength(6);

    const artifacts = await invoke(["list", "artifacts", "--dir", root, "--json"]);
    expect(JSON.parse(artifacts.stdout).length).toBeGreaterThan(0);

    const snapshot = await invoke(["open", "--dir", root, "--json"]);
    const snapshotJson = JSON.parse(snapshot.stdout) as { status: { initialized: boolean; currentVersionId?: string }; refs: { current?: string } };
    expect(snapshotJson).toMatchObject({
      status: {
        initialized: true,
      },
    });
    expect(snapshotJson.refs.current).toBe(snapshotJson.status.currentVersionId);

    expect((await invoke(["--version"])).stdout).toContain("workbench ");
    expect((await invoke(["eval", "--help"])).stdout).toContain("workbench eval");
    const oldSaveJson = await invoke(["save", "old", "--json"]);
    expect(oldSaveJson.code).toBe(2);
    expect(oldSaveJson.stderr).toBe("");
    expect(JSON.parse(oldSaveJson.stdout)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Unknown command: save"),
    });

      const authRoot = await makeTempRoot("workbench-cli-auth-");
    const previousConfig = process.env.WORKBENCH_CONFIG;
    const previousAuthStore = process.env.WORKBENCH_ADAPTER_AUTH_STORE;
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.WORKBENCH_CONFIG = path.join(authRoot, "missing-config.json");
    process.env.WORKBENCH_ADAPTER_AUTH_STORE = authRoot;
    process.env.OPENAI_API_KEY = "test-openai-key";
    try {
      const connect = await invoke(["auth", "connect", "codex", "--method", "api-key", "--json"]);
      expect(connect.code).toBe(0);
      expect(JSON.parse(connect.stdout)).toMatchObject({
        adapter: "codex",
        method: "api-key",
        status: "connected",
        remote: {
          status: "skipped",
          reason: "not_authenticated",
        },
      });
      const auth = await invoke(["auth", "status", "codex", "--json"]);
      expect(JSON.parse(auth.stdout)).toMatchObject({
        ok: true,
        command: "status",
        status: {
          adapterId: "codex",
          profile: "default",
          status: "connected",
          method: "api-key",
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
      const sessions = await invoke(["list", "sessions", "--json"]);
      expect(JSON.parse(sessions.stdout)).toEqual([
        expect.objectContaining({
          id: "codex:session-test",
          source: "codex",
          title: "Review recurring workflow eval",
        }),
      ]);
      const sessionDetail = await invoke(["show", "codex:session-test", "--json"]);
      expect(JSON.parse(sessionDetail.stdout)).toMatchObject({
        id: "codex:session-test",
        source: "codex",
        excerpts: expect.arrayContaining(["Review recurring workflow eval"]),
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
