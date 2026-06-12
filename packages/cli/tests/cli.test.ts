import { Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })
  ));
});

describe("workbench skill-first CLI", () => {
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

    const staleEvalSkillFlag = await invoke(["eval", "--skill", "primary", "--json"]);
    expect(staleEvalSkillFlag.code).toBe(2);
    expect(stdoutJson(staleEvalSkillFlag)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --skill for workbench eval.",
    });

    const staleEvalAgentFlag = await invoke(["eval", "--agent", "default", "--json"]);
    expect(staleEvalAgentFlag.code).toBe(2);
    expect(stdoutJson(staleEvalAgentFlag)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --agent for workbench eval.",
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
    const authStatusMethod = await invoke(["auth", "status", "--method", "api-key", "--json"]);
    expect(authStatusMethod.code).toBe(2);
    expect(stdoutJson(authStatusMethod)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --method for workbench auth.",
    });

    const caseListFrom = await invoke(["case", "list", "--from", "trace_1", "--json"]);
    expect(caseListFrom.code).toBe(2);
    expect(stdoutJson(caseListFrom)).toMatchObject({
      ok: false,
      code: "usage",
      message: "Unsupported flag --from for workbench case.",
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

  test("lists Workbench canonical install URLs through source snapshots without delegated output", async () => {
    const previousToken = process.env.WORKBENCH_API_TOKEN;
    process.env.WORKBENCH_API_TOKEN = "install-token";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer install-token");
      if (url.pathname === "/api/workbench/source/skills/alice/private-skill/releases/v007/source") {
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
        "--source",
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
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      if (previousToken === undefined) {
        delete process.env.WORKBENCH_API_TOKEN;
      } else {
        process.env.WORKBENCH_API_TOKEN = previousToken;
      }
    }
  }, 30_000);

  test("validates remotes at add time and tracks per-remote sync errors in status", async () => {
    const root = await makeTempRoot("workbench-cli-remotes-");
    expect((await invoke(["init", root, "--json"])).code).toBe(0);

    const positionalRemote = await invoke(["remote", "add", "cloud", "not-a-url", "--dir", root, "--json"]);
    expect(positionalRemote.code).toBe(2);
    expect(stdoutJson(positionalRemote)).toMatchObject({
      ok: false,
      code: "usage",
      message: "workbench remote add requires --name NAME.",
    });

    const invalidUrl = await invoke(["remote", "add", "--name", "cloud", "--url", "not-a-url", "--dir", root, "--json"]);
    expect(invalidUrl.code).toBe(2);
    expect(stdoutJson(invalidUrl)).toMatchObject({ ok: false, code: "remote_invalid_url" });

    const invalidScheme = await invoke(["remote", "add", "--name", "cloud", "--url", "ftp://example.test/x", "--dir", root, "--json"]);
    expect(invalidScheme.code).toBe(2);
    expect(stdoutJson(invalidScheme)).toMatchObject({ ok: false, code: "remote_unsupported_scheme" });

    const invalidSlug = await invoke(["remote", "add", "--name", "cloud", "--url", "https://cloud.test/skills/test/bad%20slug", "--dir", root, "--json"]);
    expect(invalidSlug.code).toBe(2);
    expect(stdoutJson(invalidSlug)).toMatchObject({ ok: false, code: "remote_invalid_skill_slug" });

    const cloudDryRun = await invoke(["remote", "add", "--name", "cloud", "--url", "https://cloud.test/skills/test/example", "--dry-run", "--dir", root, "--json"]);
    expect(cloudDryRun.code).toBe(0);
    expect(stdoutJson(cloudDryRun)).toMatchObject({
      remote: { name: "cloud", kind: "workbench-cloud", url: "https://cloud.test/skills/test/example" },
      operation: "added",
      dryRun: true,
    });

    const fileRemote = await makeTempRoot("workbench-cli-file-remote-");
    const fileRemoteUrl = pathToFileURL(fileRemote).toString();
    const added = await invoke(["remote", "add", "--name", "origin", "--url", fileRemoteUrl, "--dir", root, "--json"]);
    expect(added.code).toBe(0);
    expect(stdoutJson(added)).toMatchObject({ remote: { name: "origin", kind: "file", url: fileRemoteUrl }, operation: "added" });

    const unchanged = await invoke(["remote", "add", "--name", "origin", "--url", fileRemoteUrl, "--dir", root, "--json"]);
    expect(unchanged.code).toBe(0);
    expect(stdoutJson(unchanged)).toMatchObject({ operation: "unchanged" });

    const otherRemote = await makeTempRoot("workbench-cli-file-remote-other-");
    const otherRemoteUrl = pathToFileURL(otherRemote).toString();
    const conflict = await invoke(["remote", "add", "--name", "origin", "--url", otherRemoteUrl, "--dir", root, "--json"]);
    expect(conflict.code).toBe(1);
    expect(stdoutJson(conflict)).toMatchObject({ ok: false, code: "remote_name_conflict" });

    const replaced = await invoke(["remote", "add", "--name", "origin", "--url", otherRemoteUrl, "--replace", "--dir", root, "--json"]);
    expect(replaced.code).toBe(0);
    expect(stdoutJson(replaced)).toMatchObject({ operation: "replaced", remote: { url: otherRemoteUrl } });

    const badRoot = await makeTempRoot("workbench-cli-bad-remote-");
    const badFile = path.join(badRoot, "not-a-directory");
    await fs.writeFile(badFile, "not a directory");
    const badRemoteUrl = pathToFileURL(badFile).toString();
    expect((await invoke(["remote", "add", "--name", "broken", "--url", badRemoteUrl, "--dir", root, "--json"])).code).toBe(0);
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

    const removed = await invoke(["remote", "remove", "origin", "--dir", root, "--json"]);
    expect(removed.code).toBe(0);
    expect(stdoutJson(removed)).toMatchObject({ remote: "origin", removed: true });
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
      const positionalInstall = await invoke(["install", "https://cloud.test/skills/alice/private-skill", "--json"]);
      expect(positionalInstall.code).toBe(2);
      expect(stdoutJson(positionalInstall)).toMatchObject({
        ok: false,
        code: "usage",
        message: "workbench install requires --source SOURCE.",
      });

      const missingTarget = await invoke(["install", "--source", "https://cloud.test/skills/alice/private-skill", "--json"]);
      expect(missingTarget.code).toBe(2);
      expect(stdoutJson(missingTarget)).toMatchObject({ ok: false, code: "install_target_required" });

      const installed = await invoke(["install", "--source", "https://cloud.test/skills/alice/private-skill", "--agent", "codex", "--json"]);
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
    await invoke(["init", root]);
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
    await invoke(["init", root]);
    await fs.writeFile(path.join(root, ".workbench", "skills.yaml"), [
      "default: all",
      "skills:",
      "  primary:",
      "    path: .",
      "  no-skill:",
      "    baseline: none",
      "",
    ].join("\n"));

    const result = await invoke(["skills", "list", "--dir", root]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("no-skill\tnone\tbaseline:none\tincludes=0");
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
      const connect = await invoke(["auth", "connect", "codex", "--method", "api-key", "--json"]);
      expect(connect.code).toBe(0);
      expect(stdoutJson(connect)).toMatchObject({
        schema: "workbench.cli.auth-connect.v1",
        ok: true,
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
    expect(stdoutJson(unsupported)).toMatchObject({
      ok: false,
      code: "usage",
      message: expect.stringContaining("unsupported skill eval adapter unknown"),
    });
  });

  test("serializes concurrent project commands through the local project lock", async () => {
    const root = await makeTempRoot("workbench-cli-lock-");
    expect((await invoke(["init", root, "--json"])).code).toBe(0);
    await fs.appendFile(path.join(root, "SKILL.md"), "\nManual CLI concurrent edit.\n");

    const [status, versions, runs, shown] = await Promise.all([
      invoke(["status", "--dir", root, "--json"]),
      invoke(["versions", "--dir", root, "--json"]),
      invoke(["list", "runs", "--dir", root, "--json"]),
      invoke(["show", "current:SKILL.md", "--dir", root, "--json"]),
    ]);

    expect(status.code, status.stdout || status.stderr).toBe(0);
    expect(versions.code, versions.stdout || versions.stderr).toBe(0);
    expect(runs.code, runs.stdout || runs.stderr).toBe(0);
    expect(shown.code, shown.stdout || shown.stderr).toBe(0);
    const statusJson = stdoutJson<{ project: { currentVersionId: string }; worktree: { latestVersionId: string } }>(status);
    expect(statusJson.project.currentVersionId).toMatch(/^v_[a-f0-9]{64}$/u);
    expect(statusJson.worktree.latestVersionId).toBe(statusJson.project.currentVersionId);
    expect(stdoutJson<{ result: Array<{ id: string }> }>(versions).result.map((version) => version.id)).toHaveLength(2);
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
    await invoke(["init", root]);
    const versions = await invoke(["versions", "--dir", root, "--json"]);
    const versionId = stdoutJson<{ result: Array<{ id: string }> }>(versions).result[0]!.id;
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

  test("versions --json emits version summaries without file contents", async () => {
    const root = await makeTempRoot("workbench-cli-version-summary-");
    expect((await invoke(["init", root, "--json"])).code).toBe(0);
    const marker = "VERSIONS_JSON_CONTENT_MARKER";
    await fs.appendFile(path.join(root, "SKILL.md"), `\n${marker}\n`);

    const versions = await invoke(["versions", "--dir", root, "--json"]);
    expect(versions.code).toBe(0);
    const result = stdoutJson<{ result: Array<Record<string, unknown>> }>(versions).result;
    expect(result.length).toBeGreaterThan(0);
    for (const version of result) {
      expect(version).toMatchObject({
        id: expect.any(String),
        hash: expect.any(String),
        message: expect.any(String),
        parentIds: expect.any(Array),
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
      "--source",
      "https://cloud.test/skills/alice/private-skill",
      "--agent",
      "codex",
      "--agent",
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

    const dryRun = await invoke(["install", "--source", "https://cloud.test/skills/alice/private-skill", "--agent", "codex", "--dry-run", "--json"]);
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

    const copyFlag = await invoke(["install", "--source", "https://cloud.test/skills/alice/private-skill", "--agent", "codex", "--copy", "--json"]);
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

    const first = await invoke(["install", "--source", "https://cloud.test/skills/alice/private-skill", "--agent", "codex", "--json"]);
    expect(first.code).toBe(0);
    expect(stdoutJson(first)).toMatchObject({ result: "installed", filesCopied: 1 });

    const second = await invoke(["install", "--source", "https://cloud.test/skills/alice/private-skill", "--agent", "codex", "--json"]);
    expect(second.code).toBe(0);
    expect(stdoutJson(second)).toMatchObject({
      result: "unchanged",
      filesCopied: 0,
      targets: [expect.objectContaining({ agent: "codex", previous: "unchanged" })],
    });
  });

  dockerTest("runs the local skill lifecycle through public commands", async () => {
    const root = await makeTempRoot("workbench-cli-skill-");

    expect((await invoke(["init", root])).code).toBe(0);
    const check = await invoke(["check", "--dir", root]);
    expect(check.stdout).toContain("Agent plan:");
    expect(check.stdout).toContain("default\tlocal");

    const versions = await invoke(["versions", "--json", "--dir", root]);
    expect(versions.stderr).toBe("");
    const [version] = stdoutJson<{ result: Array<{ id: string }> }>(versions).result;
    expect(version.id).toMatch(/^v_[a-f0-9]{64}$/u);

    const evalResult = await invoke(["eval", "--dir", root, "--json"]);
    const runs = stdoutJson<{ result: Array<{ id: string; versionId: string; score?: number; jobIds: string[]; traceIds: string[] }> }>(evalResult).result;
    expect(runs).toHaveLength(1);
    expect(runs[0]?.versionId).toBe(version.id);
    expect(runs[0]?.score).toBeUndefined();
    expect(runs[0]?.jobIds).toHaveLength(1);
    expect(runs[0]?.traceIds).toHaveLength(1);
    const smokeTraceResult = await invoke(["trace", runs[0]!.id, "--dir", root, "--json"]);
    const smokeTraces = stdoutJson<{ result: Array<{ result: { score?: number; metrics?: { score?: number }; cases?: Array<{ metrics?: { score?: number } }> } }> }>(smokeTraceResult).result;
    expect(smokeTraces[0]?.result.score).toBeUndefined();
    expect(smokeTraces[0]?.result.metrics?.score).toBeUndefined();
    expect(smokeTraces[0]?.result.cases?.[0]?.metrics?.score).toBeUndefined();
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
    expect(failingEvalJson.nextCommands).toContain("workbench compare --versions all");
    const failedRuns = failingEvalJson.failedRuns;
    expect(failedRuns[0]?.status).toBe("failed");
    expect(failedRuns[0]?.score).toBe(0);
    const failedRun = failedRuns[0]!;
    const failedTraceId = failedRun.traceIds[0]!;
    const failedStderr = await invoke(["show", `${failedTraceId}:stderr.log`, "--dir", root]);
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
    expect((await invoke(["agent", "default", "patcher", "--dir", root])).code).toBe(0);
    const patcherFailingEval = await invoke(["eval", "--dir", root, "--agents", "patcher", "--json"]);
    expect(patcherFailingEval.code).toBe(1);
    const patcherFailedRuns = stdoutJson<{ failedRuns: Array<{ versionId: string }> }>(patcherFailingEval).failedRuns;
    const patcherBaseVersionId = patcherFailedRuns[0]!.versionId;

    const improve = await invoke(["improve", "--dir", root, "--agent", "patcher", "--json"]);
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

    const remote = await makeTempRoot("workbench-cli-remote-");
    const remoteUrl = pathToFileURL(remote).toString();
    const remoteAdd = await invoke(["remote", "add", "--name", "cloud", "--url", remoteUrl, "--dir", root, "--json"]);
    expect(remoteAdd.code).toBe(0);
    expect(stdoutJson(remoteAdd)).toMatchObject({ remote: { name: "cloud", url: remoteUrl, kind: "file" }, operation: "added" });
    const sync = await invoke(["sync", "--dir", root, "--json"]);
    expect(sync.code).toBe(0);
    expect(stdoutJson(sync)).toMatchObject({
      remote: { name: "cloud", kind: "file" },
      pushed: expect.any(Number),
      pulled: expect.any(Number),
      upToDate: expect.any(Boolean),
    });
    const publish = await invoke(["publish", candidateVersionId, "--dir", root, "--visibility", "public", "--json"]);
    expect(publish.code).toBe(1);
    expect(stdoutJson(publish)).toMatchObject({
      ok: false,
      code: "publish_failed",
      message: "Remote cloud is a file remote; only Workbench Cloud remotes can publish installable source.",
      subject: { remote: "cloud", kind: "file", url: remoteUrl },
    });
    await expect(fs.stat(path.join(remote, "source"))).rejects.toThrow();

    const trace = await invoke(["trace", runs[0]!.id, "--dir", root, "--json"]);
    expect(stdoutJson<{ result: unknown[] }>(trace).result).toHaveLength(1);

    const jobs = await invoke(["list", "jobs", "--dir", root, "--json"]);
    expect(stdoutJson<{ result: unknown[] }>(jobs).result).toHaveLength(5);

    const artifacts = await invoke(["list", "artifacts", "--dir", root, "--json"]);
    expect(stdoutJson<{ result: unknown[] }>(artifacts).result.length).toBeGreaterThan(0);

    const snapshot = await invoke(["open", "--dir", root, "--json"]);
    const snapshotJson = stdoutJson<{ result: { status: { initialized: boolean; currentVersionId?: string }; refs: { current?: string } } }>(snapshot).result;
    expect(snapshotJson).toMatchObject({
      status: {
        initialized: true,
      },
    });
    expect(snapshotJson.refs.current).toBe(snapshotJson.status.currentVersionId);

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
      const connect = await invoke(["auth", "connect", "codex", "--method", "api-key", "--json"]);
      expect(connect.code).toBe(0);
      expect(stdoutJson(connect)).toMatchObject({
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
      const auth = await invoke(["auth", "status", "codex", "--json"]);
      expect(stdoutJson(auth)).toMatchObject({
        ok: true,
        workbenchCloud: { status: "not_authenticated" },
        adapters: [expect.objectContaining({
          adapter: "codex",
          profile: "default",
          status: "connected",
          method: "api-key",
        })],
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
      expect(stdoutJson<{ result: unknown[] }>(sessions).result).toEqual([
        expect.objectContaining({
          id: "codex:session-test",
          source: "codex",
          title: "Review recurring workflow eval",
        }),
      ]);
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
