import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import {
  addWorkbenchCase,
  addWorkbenchRemote,
  addWorkbenchAgent,
  checkWorkbenchSkill,
  compareWorkbench,
  createWorkbenchAdapterAuthBundle,
  createWorkbenchReadOnlyInspectionSnapshot,
  diffWorkbenchVersions,
  evalWorkbenchSkill,
  filesForWorkbenchRef,
  improveWorkbenchSkill,
  initWorkbenchSkill,
  listWorkbenchCases,
  listWorkbenchRemotes,
  listWorkbenchAgents,
  listWorkbenchVersions,
  localWorkbenchAdapterAuthStore,
  parseWorkbenchAdapterAuthTarget,
  publishWorkbenchVersion,
  removeWorkbenchCase,
  removeWorkbenchAgent,
  removeWorkbenchRemote,
  setDefaultWorkbenchAgent,
  showWorkbenchCase,
  showWorkbenchRef,
  switchWorkbenchVersion,
  syncWorkbenchRemote,
  workbenchJobEvidenceForSnapshot,
  workbenchStatusSnapshot,
  WorkbenchCodedError,
  WorkbenchUserError,
  type Json,
  type SurfaceSnapshotFile,
  type WorkbenchAdapterAuthBundle,
  type WorkbenchAdapterAuthFile,
  type WorkbenchAdapterAuthStatusRecord,
  type WorkbenchArtifact,
  type WorkbenchComparison,
  type WorkbenchJob,
  type WorkbenchRun,
  type WorkbenchAgent,
  type WorkbenchExecutionTraceDetail,
  type WorkbenchTrace,
  type WorkbenchVersion,
} from "@workbench-ai/workbench-core";
import { emitError, emitResult } from "./output.js";
import {
  installSnapshotToTargets,
  installTargetsToJson,
  normalizeInstallSnapshotPath,
  resolveInstallTargets,
  supportedInstallTargets,
} from "./install-targets.js";
import { startWorkbenchOpenServer } from "./open-server.js";

export interface CliIo {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
}

const require = createRequire(import.meta.url);

const HELP = [
  "Usage:",
  "  workbench <command> [options]",
  "",
  "Primary loop:",
  "  workbench init [DIR] [--json]",
  "  workbench check [--dir DIR] [--json]",
  "  workbench eval [VERSION] [--skills all|LIST] [--agents all|LIST] [--samples N] [--rerun] [--json]",
  "  workbench compare [--skills all|LIST] [--agents all|LIST] [--versions all|A..B|LIST] [--json]",
  "  workbench improve [VERSION] [--skill SKILL] [--agent AGENT] [--budget N] [--samples N] [--json]",
  "",
  "Inspect:",
  "  workbench status [--dir DIR] [--json]",
  "  workbench versions [--dir DIR] [--json]",
  "  workbench switch VERSION [--dir DIR] [--json]",
  "  workbench diff [A..B] [--dir DIR] [--json]",
  "  workbench show REF[:PATH] [--json]",
  "  workbench files REF [--json]",
  "  workbench list runs|jobs|traces|artifacts|sessions [--json]",
  "  workbench trace RUN_ID|JOB_ID|TRACE_ID [--json]",
  "  workbench open [--host HOST] [--port PORT] [--no-open] [--json]",
  "",
  "Configure:",
  "  workbench agent list|add|show|default|remove ...",
  "  workbench skills list",
  "  workbench case list|add|show|remove ...",
  "",
  "Share and auth:",
  "  workbench remote add --name NAME --url URL [--replace] [--dry-run] [--dir DIR] [--json]",
  "  workbench remote list [--dir DIR] [--json]",
  "  workbench remote remove NAME [--dir DIR] [--json]",
  "  workbench sync [REMOTE] [--dry-run] [--dir DIR] [--json]",
  "  workbench publish [VERSION] [--remote REMOTE] [--visibility private|internal|public] [--dry-run] [--dir DIR] [--json]",
  "  workbench install --source SOURCE [--agent codex|claude]... [--local] [--yes] [--list] [--dry-run] [--json]",
  "  workbench auth status [ADAPTER[/SLOT]] [--profile PROFILE] [--json]",
  "  workbench auth connect ADAPTER[/SLOT] [--method METHOD] [--profile PROFILE] [--profile-root DIR] [--local-only] [--json]",
  "  workbench auth disconnect ADAPTER[/SLOT] [--profile PROFILE] [--local-only] [--json]",
  "  workbench login [--base-url URL] [--start-only|--wait] [--timeout N] [--no-open] [--json]",
  "  workbench logout [--json]",
  "",
  "Remote URLs:",
  "  https://HOST/skills/OWNER/SKILL  Workbench Cloud skill remote",
  "  file:///absolute/path            local file remote",
  "",
  "Examples:",
  "  workbench init ./earnings-prep",
  "  workbench check --dir ./earnings-prep",
  "  workbench eval --agents default --samples 1",
  "  workbench compare",
  "  workbench status --json",
  "  workbench remote add --name origin --url https://v2.workbench.ai/skills/acme/earnings-prep",
  "  workbench publish --remote origin --visibility public --json",
  "  workbench install --source https://v2.workbench.ai/skills/acme/earnings-prep --agent codex --yes",
  "",
  "Environment:",
  "  CODEX_HOME and CLAUDE_HOME override read-only session discovery roots.",
  "  WORKBENCH_API_URL selects a Workbench Cloud API base URL for login, auth, and HTTP remotes.",
  "  WORKBENCH_API_TOKEN supplies a Workbench Cloud token without a login (WORKBENCH_SMOKE_BEARER_TOKEN is a fallback).",
  "  WORKBENCH_CONFIG overrides the CLI config path (default ~/.workbench/config.json).",
  "  WORKBENCH_DEVICE_AUTH overrides the pending device login record path.",
  "  WORKBENCH_ADAPTER_AUTH_STORE overrides the local adapter auth store directory.",
].join("\n");

const COMMAND_HELP: Record<string, string> = {
  auth: [
    "Usage:",
    "  workbench auth status [ADAPTER[/SLOT]] [--profile PROFILE] [--json]",
    "  workbench auth connect ADAPTER[/SLOT] [--method api-key|oauth|bedrock] [--profile PROFILE] [--profile-root DIR] [--local-only] [--json]",
    "  workbench auth disconnect ADAPTER[/SLOT] [--profile PROFILE] [--local-only] [--json]",
    "",
    "Stores adapter credentials locally and uploads them to Workbench Cloud when logged in unless --local-only is passed. Codex supports oauth and api-key. Claude supports oauth, api-key, and bedrock.",
    "",
    "Examples:",
    "  workbench auth status --json",
    "  workbench auth connect codex --method api-key",
    "  workbench auth disconnect codex --json",
  ].join("\n"),
  eval: [
    "Usage:",
    "  workbench eval [VERSION] [--skills all|LIST] [--agents all|LIST] [--samples N] [--rerun] [--json]",
    "",
    "Runs eval jobs for the selected version, measured skills, and agents. Omitted selectors use manifest defaults.",
  ].join("\n"),
  improve: [
    "Usage:",
    "  workbench improve [VERSION] [--skill SKILL] [--agent AGENT] [--budget N] [--samples N] [--json]",
    "",
    "Creates one improved child version from evidence. Pass singular --skill and --agent when defaults expand to multiple entries.",
  ].join("\n"),
  install: [
    "Usage:",
    "  workbench install --source SOURCE [--agent codex|claude]... [--local] [--yes] [--list] [--dry-run] [--json]",
    "",
    "Installs published Workbench Cloud source into explicit local agent targets.",
    "",
    "Example:",
    "  workbench install --source https://v2.workbench.ai/skills/acme/earnings-prep --agent codex --yes",
  ].join("\n"),
  remote: [
    "Usage:",
    "  workbench remote add --name NAME --url URL [--replace] [--dry-run] [--dir DIR] [--json]",
    "  workbench remote list [--dir DIR] [--json]",
    "  workbench remote remove NAME [--dir DIR] [--json]",
    "",
    "Remotes exchange Workbench object packs. Only Workbench Cloud remotes can publish installable source.",
    "",
    "Examples:",
    "  workbench remote add --name origin --url https://v2.workbench.ai/skills/acme/earnings-prep",
    "  workbench remote add --name scratch --url file:///tmp/earnings-prep-remote --replace",
  ].join("\n"),
  status: [
    "Usage:",
    "  workbench status [--dir DIR] [--json]",
    "",
    "Reports project, worktree, run, per-remote sync/publication, and auth state. --json emits the workbench.status.v1 dashboard.",
    "",
    "Example:",
    "  workbench status --json",
  ].join("\n"),
  logout: [
    "Usage:",
    "  workbench logout [--json]",
    "",
    "Revokes and removes the local Workbench Cloud token. Reports whether the token was revoked and whether local adapter auth records remain.",
    "",
    "Example:",
    "  workbench logout --json",
  ].join("\n"),
  show: [
    "Usage:",
    "  workbench show REF [--json]",
    "  workbench show REF:PATH [--json]",
    "",
    "Shows a Workbench object or a file inside a version, trace, or artifact.",
  ].join("\n"),
  list: [
    "Usage:",
    "  workbench list runs|jobs|traces|artifacts|sessions [--json]",
    "",
    "Lists Workbench evidence or read-only native Codex/Claude session files.",
  ].join("\n"),
  versions: [
    "Usage:",
    "  workbench versions [--json]",
    "",
    "Lists Workbench skill versions.",
  ].join("\n"),
  switch: [
    "Usage:",
    "  workbench switch VERSION [--json]",
    "",
    "Switches the working skill source to a recorded Workbench version.",
  ].join("\n"),
  sync: [
    "Usage:",
    "  workbench sync [REMOTE] [--dry-run] [--dir DIR] [--json]",
    "",
    "Synchronizes local evidence and version objects with a Workbench remote. --dry-run reports what would be exchanged.",
    "",
    "Examples:",
    "  workbench sync origin --json",
    "  workbench sync origin --dry-run --json",
  ].join("\n"),
  publish: [
    "Usage:",
    "  workbench publish [VERSION] [--remote REMOTE] [--visibility private|internal|public] [--dry-run] [--dir DIR] [--json]",
    "",
    "Publishes installable skill source from the selected version to a Workbench Cloud remote.",
    "",
    "Examples:",
    "  workbench publish --remote origin --visibility private --json",
    "  workbench publish <version-id> --remote origin --dry-run --json",
  ].join("\n"),
  login: [
    "Usage:",
    "  workbench login [--base-url URL] [--start-only|--wait] [--timeout N] [--no-open] [--json]",
    "  workbench logout [--json]",
    "",
    "Connects the CLI to Workbench Cloud with the device login flow.",
    "",
    "Examples:",
    "  workbench login --start-only --json",
    "  workbench login --wait --timeout 120 --json",
  ].join("\n"),
};

const BOOLEAN_FLAGS = new Set([
  "help",
  "dry-run",
  "json",
  "local",
  "local-only",
  "list",
  "no-open",
  "start-only",
  "replace",
  "rerun",
  "wait",
  "yes",
]);

type FlagKind = "boolean" | "string" | "positive-integer" | "repeat-string";

const FLAG_DEFINITIONS: Record<string, FlagKind> = {
  adapter: "string",
  "base-url": "string",
  budget: "positive-integer",
  dir: "string",
  from: "string",
  "dry-run": "boolean",
  help: "boolean",
  host: "string",
  json: "boolean",
  local: "boolean",
  "local-only": "boolean",
  list: "boolean",
  method: "string",
  model: "string",
  name: "string",
  "no-open": "boolean",
  port: "positive-integer",
  profile: "string",
  "profile-root": "string",
  remote: "string",
  replace: "boolean",
  rerun: "boolean",
  samples: "positive-integer",
  source: "string",
  "start-only": "boolean",
  agent: "string",
  agents: "string",
  skill: "string",
  skills: "string",
  version: "boolean",
  versions: "string",
  visibility: "string",
  timeout: "positive-integer",
  url: "string",
  wait: "boolean",
  with: "repeat-string",
  yes: "boolean",
};

const COMMAND_FLAGS: Record<string, readonly string[]> = {
  check: ["dir", "json"],
  compare: ["agents", "dir", "json", "skills", "versions"],
  diff: ["dir", "json"],
  eval: ["agents", "dir", "json", "rerun", "samples", "skills"],
  files: ["dir", "json"],
  improve: ["agent", "budget", "dir", "json", "samples", "skill"],
  init: ["dir", "json"],
  install: ["agent", "dry-run", "json", "list", "local", "source", "yes"],
  list: ["dir", "json"],
  login: ["base-url", "json", "no-open", "start-only", "timeout", "wait"],
  logout: ["json"],
  open: ["dir", "host", "json", "no-open", "port"],
  publish: ["dir", "dry-run", "json", "remote", "visibility"],
  show: ["dir", "json"],
  status: ["dir", "json"],
  switch: ["dir", "json"],
  sync: ["dir", "dry-run", "json"],
  trace: ["dir", "json"],
  versions: ["dir", "json"],
};

interface SubcommandFlagSpec {
  defaultSubcommand?: string;
  flags: Record<string, readonly string[]>;
}

const SUBCOMMAND_FLAGS: Record<string, SubcommandFlagSpec> = {
  auth: {
    defaultSubcommand: "status",
    flags: {
      status: ["json", "profile"],
      connect: ["json", "local-only", "method", "profile", "profile-root"],
      disconnect: ["json", "local-only", "profile"],
    },
  },
  case: {
    flags: {
      list: ["dir", "json"],
      add: ["dir", "from", "json"],
      show: ["dir", "json"],
      remove: ["dir", "json"],
    },
  },
  remote: {
    flags: {
      add: ["dir", "dry-run", "json", "name", "replace", "url"],
      list: ["dir", "json"],
      remove: ["dir", "json"],
    },
  },
  skills: {
    flags: {
      list: ["dir", "json"],
    },
  },
  agent: {
    flags: {
      list: ["dir", "json"],
      add: ["adapter", "dir", "json", "model", "with"],
      show: ["dir", "json"],
      default: ["dir", "json"],
      remove: ["dir", "json"],
    },
  },
};

export async function runCli(argv: readonly string[], io: CliIo = {
  stdout: process.stdout,
  stderr: process.stderr,
}): Promise<number> {
  const parsed = parseArgs(argv);
  const command = parsed.positionals[0];
  try {
    if (command === "--version" || command === "-v" || command === "version" || parsed.flags.version === true) {
      io.stdout.write(`workbench ${getCliVersion()}\n`);
      return 0;
    }
    if (!command || command === "help" || command === "--help" || command === "-h") {
      const helpCommand = command === "help" ? optionalPositional(parsed, 1) : undefined;
      io.stdout.write(`${helpCommand ? commandHelp(helpCommand) : HELP}\n`);
      return 0;
    }
    if (parsed.flags.help === true) {
      io.stdout.write(`${commandHelp(command)}\n`);
      return 0;
    }
    validateCommandFlags(parsed, command);
    if (command === "login") {
      return await handleLogin(parsed, io);
    }
    if (command === "logout") {
      return await handleLogout(parsed, io);
    }
    if (command === "install") {
      return await handleInstall(parsed, io);
    }
    const core = await coreOptions(parsed);
    if (command === "init") {
      const status = await initWorkbenchSkill({ dir: parsed.positionals[1] ?? dirFlag(parsed) });
      return output(status, parsed, io, () => `Initialized Workbench skill at ${status.root}.`);
    }
    if (command === "status") {
      const status = await workbenchStatusSnapshot(core);
      const auth = await workbenchCliAuthStatus();
      return emitResult("workbench.status.v1", {
        project: status.project as Json,
        worktree: status.worktree as Json,
        runs: status.runs as Json,
        remotes: status.remotes as Json,
        auth: auth as unknown as Json,
        next: status.next as Json,
      }, parsed, io, () => formatStatusSnapshot({ ...status, auth }));
    }
    if (command === "check") {
      const result = await checkWorkbenchSkill(core);
      return output(result, parsed, io, () => formatCheck(result));
    }
    if (command === "eval") {
      const runs = await evalWorkbenchSkill({
        ...core,
        version: optionalPositional(parsed, 1),
        skill: stringFlag(parsed, "skills"),
        agent: stringFlag(parsed, "agents"),
        samples: intFlag(parsed, "samples"),
        rerun: parsed.flags.rerun === true,
      });
      const artifactIds = await artifactIdsByRunId(core, runs);
      const failedRuns = runs.filter((run) => run.status === "failed" || run.status === "canceled");
      if (failedRuns.length > 0) {
        return emitEvalFailure(runs, failedRuns, artifactIds, parsed, io);
      }
      return output(runs.map((run) => runSummary(run, artifactIds.get(run.id) ?? [])), parsed, io, () => runs.map(formatRun).join("\n"));
    }
    if (command === "improve") {
      const result = await improveWorkbenchSkill({
        ...core,
        version: optionalPositional(parsed, 1),
        skill: stringFlag(parsed, "skill"),
        agent: stringFlag(parsed, "agent"),
        budget: intFlag(parsed, "budget"),
        samples: intFlag(parsed, "samples"),
      });
      return output({
        ...result,
        version: versionSummary(result.version),
      } as unknown as Json, parsed, io, () => formatImproveResult(result));
    }
    if (command === "compare") {
      const comparison = await compareWorkbench({
        ...core,
        versions: stringFlag(parsed, "versions"),
        skills: stringFlag(parsed, "skills"),
        agents: stringFlag(parsed, "agents"),
      });
      return output(comparison, parsed, io, () => formatComparison(comparison));
    }
    if (command === "versions") {
      const versions = await listWorkbenchVersions(core);
      return output(versions.map(versionSummary), parsed, io, () => versions.map(formatVersion).join("\n") || "No versions.");
    }
    if (command === "switch") {
      const versionRef = requiredPositional(parsed, 1, "workbench switch requires VERSION.");
      const version = await switchWorkbenchVersion(versionRef, core);
      return output(versionSummary(version), parsed, io, () => `Switched to ${version.id}.`);
    }
    if (command === "diff") {
      const range = requiredPositional(parsed, 1, "workbench diff requires A..B.");
      const diffs = await diffWorkbenchVersions(range, core);
      return output(diffs, parsed, io, () => diffs.map((entry) => `${entry.status}\t${entry.path}`).join("\n") || "No diff.");
    }
    if (command === "show") {
      const ref = requiredPositional(parsed, 1, "workbench show requires REF.");
      const session = await showLocalAgentSession(ref);
      if (session) {
        return output(session, parsed, io, () => formatSessionDetail(session));
      }
      const value = await showWorkbenchRef(ref, core);
      return output(value, parsed, io, () => formatShow(value));
    }
    if (command === "files") {
      const ref = requiredPositional(parsed, 1, "workbench files requires REF.");
      const files = await filesForWorkbenchRef(ref, core);
      return output(files.map(fileSummary), parsed, io, () => files.map((file) => file.path).join("\n") || "No files.");
    }
    if (command === "list") {
      return await handleList(parsed, io);
    }
    if (command === "trace") {
      const ref = optionalPositional(parsed, 1);
      if (!ref) {
        throw new WorkbenchCodedError("usage", "workbench trace requires RUN_ID, JOB_ID, or TRACE_ID.", {
          remediation: "Run workbench list runs --json or workbench list traces --json.",
          exitCode: 2,
        });
      }
      const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
      const run = snapshot.runs.find((entry) => entry.id === ref);
      const job = snapshot.jobs.find((entry) => entry.id === ref);
      const traces = run
        ? snapshot.traces.filter((trace) => run.traceIds.includes(trace.id))
        : job
          ? snapshot.traces.filter((trace) => job.traceIds.includes(trace.id))
        : snapshot.traces.filter((trace) => trace.id === ref);
      if (traces.length === 0) {
        const jobs = run
          ? snapshot.jobs.filter((entry) => entry.runId === run.id)
          : job ? [job] : [];
        const details = jobs.flatMap((entry) => {
          const detail = workbenchJobEvidenceForSnapshot(snapshot, {
            runId: entry.runId,
            jobId: entry.id,
          });
          return detail ? [detail] : [];
        }).filter((detail) =>
          detail.executions.some((execution) =>
            execution.sessions.length > 0 ||
            execution.trace.spans.length > 0 ||
            execution.trace.events.length > 0 ||
            execution.trace.summaries.length > 0
          )
        );
        if (details.length > 0) {
          return output(details, parsed, io, () => details.map(formatTraceDetail).join("\n"));
        }
        throw new WorkbenchCodedError("ref_not_found", `Trace not found: ${ref}`, {
          remediation: "Run workbench list runs --json, workbench list jobs --json, or workbench list traces --json.",
          subject: { ref },
          exitCode: 1,
        });
      }
      return output(traces, parsed, io, () => traces.map(formatTrace).join("\n"));
    }
    if (command === "agent") {
      return await handleAgent(parsed, io);
    }
    if (command === "skills") {
      return await handleSkills(parsed, io);
    }
    if (command === "case") {
      return await handleCase(parsed, io);
    }
    if (command === "remote") {
      return await handleRemote(parsed, io);
    }
    if (command === "sync") {
      const result = await syncWorkbenchRemote({
        ...core,
        remote: optionalPositional(parsed, 1),
        dryRun: parsed.flags["dry-run"] === true,
      });
      return emitResult("workbench.cli.sync.v1", {
        remote: result.remote as unknown as Json,
        pushed: result.pushed,
        pulled: result.pulled,
        upToDate: result.upToDate,
        publication: result.publication as unknown as Json,
        ...(result.dryRun ? { dryRun: true } : {}),
      }, parsed, io, () => `${result.dryRun ? "Would sync" : "Synced"} ${result.remote.name}: pushed ${result.pushed}, pulled ${result.pulled}${result.upToDate ? " (up to date)" : ""}.`);
    }
    if (command === "publish") {
      const result = await publishWorkbenchVersion({
        ...core,
        version: optionalPositional(parsed, 1),
        remote: stringFlag(parsed, "remote"),
        dryRun: parsed.flags["dry-run"] === true,
        visibility: parsePublishVisibility(stringFlag(parsed, "visibility")),
      });
      return emitResult("workbench.cli.publish.v1", {
        remote: result.remote as unknown as Json,
        version: versionSummary(result.version),
        visibility: result.visibility,
        installUrl: result.installUrl,
        pinnedInstallUrl: result.pinnedInstallUrl,
        ...(result.dryRun ? { dryRun: true } : {}),
      }, parsed, io, () => [
        `${result.dryRun ? "Would publish" : "Published"} ${result.version.id} to remote ${result.remote.name}.`,
        `Visibility: ${result.visibility}`,
        `Install: ${result.installUrl}`,
        `Pinned: ${result.pinnedInstallUrl}`,
      ].join("\n"));
    }
    if (command === "auth") {
      return await handleAuth(parsed, io);
    }
    if (command === "open") {
      if (parsed.flags.json === true) {
        const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
        return output(snapshot, parsed, io, () => "Read-only Workbench inspection data is available with --json.");
      }
      // The browser server serves committed object state through a read-only
      // snapshot path, so long-running commands do not block page loads.
      const server = await startWorkbenchOpenServer({
        dir: dirFlag(parsed),
        authToken: core.authToken,
        host: stringFlag(parsed, "host"),
        port: intFlag(parsed, "port"),
      });
      io.stdout.write(`Workbench: ${server.url}\n`);
      if (parsed.flags["no-open"] !== true) {
        await openBrowser(server.url).catch(() => undefined);
      }
      return await new Promise<never>(() => {});
    }
    throw new WorkbenchUserError(`Unknown command: ${command}\n\n${HELP}`);
  } catch (error) {
    return emitError(error, parsed, io);
  }
}

async function handleList(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const kind = requiredPositional(parsed, 1, "workbench list requires runs|jobs|traces|artifacts|sessions.");
  if (kind === "sessions") {
    const sessions = await listLocalAgentSessions();
    return output(sessions, parsed, io, () => sessions.map(formatSession).join("\n") || "No local sessions.");
  }
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(await coreOptions(parsed));
  if (kind === "runs") {
    return output(snapshot.runs, parsed, io, () => snapshot.runs.map(formatRun).join("\n") || "No runs.");
  }
  if (kind === "jobs") {
    return output(snapshot.jobs, parsed, io, () => snapshot.jobs.map(formatJob).join("\n") || "No jobs.");
  }
  if (kind === "traces") {
    return output(snapshot.traces.map(traceSummary), parsed, io, () => snapshot.traces.map(formatTrace).join("\n") || "No traces.");
  }
  if (kind === "artifacts") {
    return output(snapshot.artifacts.map(artifactSummary), parsed, io, () => snapshot.artifacts.map(formatArtifact).join("\n") || "No artifacts.");
  }
  throw new WorkbenchUserError(`Unsupported list target: ${kind}`);
}

async function handleAgent(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const subcommand = requiredPositional(parsed, 1, "workbench agent requires list|add|show|default|remove.");
  if (subcommand === "list") {
    const agents = await listWorkbenchAgents(await coreOptions(parsed));
    return output(agents, parsed, io, () => agents.map(formatAgent).join("\n") || "No agents.");
  }
  if (subcommand === "add") {
    const name = requiredPositional(parsed, 2, "workbench agent add requires NAME.");
    const adapter = stringFlag(parsed, "adapter");
    if (!adapter) {
      throw new WorkbenchUserError("workbench agent add requires --adapter ADAPTER.");
    }
    const agent = await addWorkbenchAgent({
      ...(await coreOptions(parsed)),
      name,
      adapter,
      model: stringFlag(parsed, "model"),
      config: parseWithFlags(parsed),
    });
    return output(agent, parsed, io, () => `Added agent ${formatAgent(agent)}.`);
  }
  if (subcommand === "show") {
    const name = requiredPositional(parsed, 2, "workbench agent show requires NAME.");
    const agent = (await listWorkbenchAgents(await coreOptions(parsed))).find((entry) => entry.name === name);
    if (!agent) {
      throw new WorkbenchCodedError("ref_not_found", `Agent not found: ${name}`, {
        remediation: "Run workbench agent list.",
        subject: { agent: name },
        exitCode: 1,
      });
    }
    return output(agent, parsed, io, () => formatAgent(agent));
  }
  if (subcommand === "default") {
    const result = await setDefaultWorkbenchAgent(requiredPositional(parsed, 2, "workbench agent default requires NAME."), await coreOptions(parsed));
    return output(result, parsed, io, () => `Default agent: ${result.defaultAgent}`);
  }
  if (subcommand === "remove") {
    const result = await removeWorkbenchAgent(requiredPositional(parsed, 2, "workbench agent remove requires NAME."), await coreOptions(parsed));
    return output(result, parsed, io, () => `Removed agent ${result.removed}.`);
  }
  throw new WorkbenchUserError(`Unsupported agent command: ${subcommand}`);
}

async function handleSkills(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const subcommand = requiredPositional(parsed, 1, "workbench skills requires list.");
  if (subcommand !== "list") {
    throw new WorkbenchUserError(`Unsupported skills command: ${subcommand}`);
  }
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(await coreOptions(parsed));
  return output(snapshot.skillSources, parsed, io, () =>
    snapshot.skillSources.map((source) => {
      const where = source.kind === "remote"
        ? `${source.from}${source.ref ? `#${source.ref}` : ""}`
        : source.kind === "none"
          ? "baseline:none"
          : source.path;
      return `${source.name}\t${source.kind}\t${where}\tincludes=${source.includes?.length ?? 0}`;
    }).join("\n") || "No skills."
  );
}

async function handleCase(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const subcommand = requiredPositional(parsed, 1, "workbench case requires list|add|show|remove.");
  if (subcommand === "list") {
    const cases = await listWorkbenchCases(await coreOptions(parsed));
    return output(cases, parsed, io, () => cases.map((entry) => `${entry.id}\t${entry.path}`).join("\n") || "No cases.");
  }
  if (subcommand === "add") {
    const record = await addWorkbenchCase({ ...(await coreOptions(parsed)), fromTraceId: stringFlag(parsed, "from") });
    return output(record, parsed, io, () => `Added case ${record.id}.`);
  }
  if (subcommand === "show") {
    const record = await showWorkbenchCase(requiredPositional(parsed, 2, "workbench case show requires CASE_ID."), await coreOptions(parsed));
    return output(record, parsed, io, () => record.content);
  }
  if (subcommand === "remove") {
    const result = await removeWorkbenchCase(requiredPositional(parsed, 2, "workbench case remove requires CASE_ID."), await coreOptions(parsed));
    return output(result, parsed, io, () => `Removed case ${result.removed}.`);
  }
  throw new WorkbenchUserError(`Unsupported case command: ${subcommand}`);
}

async function handleRemote(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const subcommand = requiredPositional(parsed, 1, "workbench remote requires add|list|remove.");
  if (subcommand === "add") {
    const name = requiredFlag(parsed, {
      flag: "name",
      usage: "workbench remote add requires --name NAME.",
      remediation: "Run workbench remote add --name origin --url https://HOST/skills/OWNER/SKILL.",
    });
    const url = requiredFlag(parsed, {
      flag: "url",
      usage: "workbench remote add requires --url URL.",
      remediation: `Run workbench remote add --name ${name} --url https://HOST/skills/OWNER/SKILL.`,
    });
    rejectExtraInput(parsed, {
      maxPositionals: 2,
      message: "workbench remote add accepts --name NAME and --url URL, not positional NAME or URL.",
      remediation: "Run workbench remote add --name origin --url https://HOST/skills/OWNER/SKILL.",
    });
    const result = await addWorkbenchRemote(
      name,
      url,
      {
        ...(await coreOptions(parsed)),
        replace: parsed.flags.replace === true,
        dryRun: parsed.flags["dry-run"] === true,
      },
    );
    return emitResult("workbench.cli.remote-add.v1", {
      remote: result.remote as unknown as Json,
      operation: result.operation,
      ...(result.dryRun ? { dryRun: true } : {}),
    }, parsed, io, () => `${result.dryRun ? "Would update" : "Remote"} ${result.remote.name}: ${result.operation}\t${result.remote.kind}\t${result.remote.url}`);
  }
  if (subcommand === "list") {
    const remotes = await listWorkbenchRemotes(await coreOptions(parsed));
    return emitResult("workbench.cli.remote-list.v1", {
      remotes: remotes as unknown as Json,
    }, parsed, io, () => remotes.map((remote) => `${remote.name}\t${remote.kind}\t${remote.url}`).join("\n") || "No remotes.");
  }
  if (subcommand === "remove") {
    const result = await removeWorkbenchRemote(
      requiredPositional(parsed, 2, "workbench remote remove requires NAME."),
      await coreOptions(parsed),
    );
    return emitResult("workbench.cli.remote-remove.v1", {
      remote: result.remote,
      removed: result.removed,
    }, parsed, io, () => result.removed ? `Removed remote ${result.remote}.` : `Remote ${result.remote} was not configured.`);
  }
  throw new WorkbenchUserError(`Unsupported remote command: ${subcommand}`);
}

async function handleAuth(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const subcommand = optionalPositional(parsed, 1) ?? "status";
  if (subcommand === "status") {
    const targetRaw = optionalPositional(parsed, 2);
    const profile = authProfileFlag(parsed);
    const store = localWorkbenchAdapterAuthStore(adapterAuthStoreRoot());
    const cliAuth = await workbenchCliAuthStatus();
    if (targetRaw) {
      const status = await store.status(parseAuthTarget(targetRaw, profile));
      return emitResult("workbench.cli.auth-status.v1", {
        workbenchCloud: cliAuth.workbenchCloud as unknown as Json,
        adapters: [authStatusRecordToJson(status)],
      }, parsed, io, () => [
        formatWorkbenchCloudAuthStatus(cliAuth.workbenchCloud),
        "Adapter auth:",
        formatAuthStatusRecord(status),
      ].join("\n"));
    }
    const statuses = await store.listStatus();
    const required = await requiredAgentAuthStatuses(parsed, statuses);
    return emitResult(
      "workbench.cli.auth-status.v1",
      {
        workbenchCloud: cliAuth.workbenchCloud as unknown as Json,
        adapters: cliAuth.adapters as unknown as Json,
        required: required as unknown as Json,
      },
      parsed,
      io,
      () => formatAuthStatusList(cliAuth.workbenchCloud, statuses, required),
    );
  }
  if (subcommand === "connect") {
    const targetRaw = requiredPositional(parsed, 2, "workbench auth connect requires ADAPTER[/SLOT].");
    const target = parseAuthTarget(targetRaw, authProfileFlag(parsed));
    const method = authMethod(parsed, target.adapterId);
    const bundle = await collectAdapterAuthBundle({
      target,
      method,
      profileRoot: path.resolve(stringFlag(parsed, "profile-root") ?? os.homedir()),
    });
    const saved = await localWorkbenchAdapterAuthStore(adapterAuthStoreRoot()).put(bundle);
    const remote = await uploadAdapterConnection(saved, parsed);
    return emitResult(
      "workbench.cli.auth-connect.v1",
      {
        localAdapter: {
          adapter: saved.adapterId,
          ...(saved.slot ? { slot: saved.slot } : {}),
          profile: saved.profile,
          method: saved.method,
          status: saved.status,
          version: saved.version,
          updatedAt: saved.updatedAt,
        } as unknown as Json,
        workbenchCloud: remote as unknown as Json,
      },
      parsed,
      io,
      () => `Connected ${formatAuthTarget(saved)} ${saved.method} auth v${saved.version}; Workbench Cloud: ${remote.sync}${remote.reason ? ` (${remote.reason})` : ""}.`,
    );
  }
  if (subcommand === "disconnect") {
    const targetRaw = requiredPositional(parsed, 2, "workbench auth disconnect requires ADAPTER[/SLOT].");
    const target = parseAuthTarget(targetRaw, authProfileFlag(parsed));
    await localWorkbenchAdapterAuthStore(adapterAuthStoreRoot()).disconnect(target);
    const remote = await deleteAdapterConnectionRemote(target, parsed);
    return emitResult(
      "workbench.cli.auth-disconnect.v1",
      {
        localAdapter: {
          adapter: target.adapterId,
          ...(target.slot ? { slot: target.slot } : {}),
          profile: target.profile,
          status: "disconnected",
        } as unknown as Json,
        workbenchCloud: remote as unknown as Json,
      },
      parsed,
      io,
      () => `Disconnected ${formatAuthTarget(target)}; Workbench Cloud: ${remote.sync}${remote.reason ? ` (${remote.reason})` : ""}.`,
    );
  }
  throw new WorkbenchUserError(`Unsupported auth command: ${subcommand}`);
}

function getCliVersion(): string {
  const manifest = require("../package.json") as { version?: unknown };
  return typeof manifest.version === "string" ? manifest.version : "unknown";
}

function commandHelp(command: string): string {
  return COMMAND_HELP[command] ?? HELP;
}

function validateCommandFlags(parsed: ParsedArgs, command: string | undefined): void {
  if (!command) {
    return;
  }
  const allowed = allowedFlagsForCommand(parsed, command);
  if (!allowed) {
    return;
  }
  const allowedSet = new Set(allowed);
  for (const [name, value] of Object.entries(parsed.flags)) {
    if (!allowedSet.has(name) && name !== "help" && name !== "version") {
      throw new WorkbenchUserError(`Unsupported flag --${name} for workbench ${command}.`);
    }
    validateFlagValue(name, value, command === "install" && (name === "agent" || name === "skill"));
  }
}

function allowedFlagsForCommand(parsed: ParsedArgs, command: string): readonly string[] | undefined {
  const subcommands = SUBCOMMAND_FLAGS[command];
  if (!subcommands) {
    return COMMAND_FLAGS[command];
  }
  const subcommand = parsed.positionals[1] ?? subcommands.defaultSubcommand;
  return subcommand ? subcommands.flags[subcommand] ?? ["json"] : ["json"];
}

function validateFlagValue(
  name: string,
  value: string | boolean | string[],
  repeatString = false,
): void {
  const kind = FLAG_DEFINITIONS[name];
  if (!kind) {
    return;
  }
  if (repeatString) {
    if (Array.isArray(value)) {
      if (value.some((entry) => !entry.trim())) {
        throw new WorkbenchUserError(`--${name} requires a non-empty value.`);
      }
      return;
    }
    if (typeof value === "string" && value.trim()) {
      return;
    }
    throw new WorkbenchUserError(`--${name} requires a non-empty value.`);
  }
  if (kind === "boolean") {
    if (value !== true) {
      throw new WorkbenchUserError(`--${name} does not accept a value.`);
    }
    return;
  }
  if (kind === "repeat-string") {
    if (!Array.isArray(value) || value.some((entry) => !entry.trim())) {
      throw new WorkbenchUserError(`--${name} requires a non-empty value.`);
    }
    return;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkbenchUserError(`--${name} requires a value.`);
  }
  if (kind === "positive-integer") {
    const parsedValue = Number(value);
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      throw new WorkbenchUserError(`--${name} must be a positive integer.`);
    }
  }
}

const CONFIG_SCHEMA = "workbench.cli.config.v1";
const API_REQUEST_MAX_ATTEMPTS = 3;
const API_REQUEST_GZIP_THRESHOLD_BYTES = 1024 * 1024;

interface WorkbenchConfig {
  schema: typeof CONFIG_SCHEMA;
  baseUrl?: string;
  accessToken?: string;
  username?: string;
}

interface DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval?: number;
}

interface DeviceAuthorizationRecord {
  schema: "workbench.cli.device-auth.v1";
  baseUrl: string;
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expiresAt: string;
  interval?: number;
}

interface DeviceToken {
  access_token: string;
  expires_in?: number;
}

async function handleLogin(parsed: ParsedArgs, io: CliIo): Promise<number> {
  if (parsed.positionals.length > 1) {
    throw new WorkbenchUserError("workbench login accepts no positional arguments.");
  }
  if (parsed.flags["start-only"] === true && parsed.flags.wait === true) {
    throw new WorkbenchCodedError("usage", "workbench login accepts only one of --start-only or --wait.", {
      remediation: "Run workbench login --start-only or workbench login --wait --timeout 120.",
      exitCode: 2,
    });
  }
  const startOnly = parsed.flags["start-only"] === true;
  const waitOnly = parsed.flags.wait === true;
  const timeoutSeconds = intFlag(parsed, "timeout");
  if (startOnly && timeoutSeconds !== undefined) {
    throw new WorkbenchCodedError("usage", "workbench login --timeout only applies with --wait.", {
      remediation: "Run workbench login --start-only, then workbench login --wait --timeout 120.",
      exitCode: 2,
    });
  }
  if (waitOnly && timeoutSeconds === undefined) {
    throw new WorkbenchCodedError("usage", "workbench login --wait requires --timeout N.", {
      remediation: "Run workbench login --wait --timeout 120.",
      exitCode: 2,
    });
  }
  const config = await loadConfig();
  const baseUrl = selectWorkbenchBaseUrl({
    explicitBaseUrl: stringFlag(parsed, "base-url"),
    configBaseUrl: config.baseUrl,
  });
  const pending = waitOnly ? await readPendingDeviceAuthorization(baseUrl) : null;
  const record = pending ?? await startDeviceAuthorization(baseUrl);
  const freshAuthorization = pending === null;
  if (startOnly) {
    await writePendingDeviceAuthorization(record);
    if (parsed.flags["no-open"] !== true) {
      await openBrowser(record.verification_uri_complete).catch(() => undefined);
    }
    return emitResult("workbench.cli.login.v1", {
      status: "authorization_pending",
      baseUrl,
      verificationUri: record.verification_uri,
      verificationUriComplete: record.verification_uri_complete,
      userCode: record.user_code,
      expiresAt: record.expiresAt,
      resume: "workbench login --wait --timeout 120",
    }, parsed, io, () => `Open ${record.verification_uri_complete}\nCode: ${record.user_code}\nResume: workbench login --wait --timeout 120`);
  }
  await writePendingDeviceAuthorization(record);
  if (freshAuthorization && !parsed.flags.json) {
    io.stdout.write(`Open ${record.verification_uri_complete}\nCode: ${record.user_code}\n`);
  }
  if (!waitOnly && parsed.flags["no-open"] !== true) {
    await openBrowser(record.verification_uri_complete).catch(() => undefined);
  }
  let token: DeviceToken;
  try {
    token = await pollDeviceToken(baseUrl, record, timeoutSeconds);
  } catch (error) {
    const denied = error instanceof WorkbenchCodedError && error.code === "login_denied";
    const expired = Date.parse(record.expiresAt) <= Date.now();
    if (denied || expired) {
      await clearPendingDeviceAuthorization();
    }
    throw error;
  }
  const username = await fetchWorkbenchUsername(baseUrl, token.access_token).catch(() => undefined);
  await writeConfig({
    schema: CONFIG_SCHEMA,
    baseUrl,
    accessToken: token.access_token,
    ...(username ? { username } : {}),
  });
  await clearPendingDeviceAuthorization();
  return emitResult("workbench.cli.login.v1", {
    status: "authenticated",
    baseUrl,
    ...(username ? { username } : {}),
    ...(token.expires_in !== undefined ? { expiresIn: token.expires_in } : {}),
  }, parsed, io, () => `Workbench Cloud: authenticated${username ? ` as ${username}` : ""}\nWorkbench API: ${baseUrl}`);
}

async function handleLogout(parsed: ParsedArgs, io: CliIo): Promise<number> {
  if (parsed.positionals.length > 1) {
    throw new WorkbenchUserError("workbench logout accepts no positional arguments.");
  }
  const config = await loadConfig();
  const baseUrl = optionalWorkbenchBaseUrl({ configBaseUrl: config.baseUrl });
  const tokenPresent = Boolean(config.accessToken);
  if (tokenPresent && !baseUrl) {
    throw new WorkbenchUserError("Missing Workbench API URL. Set WORKBENCH_API_URL or run `workbench login --base-url URL`.");
  }
  let revoke: "revoked" | "failed" | "skipped" = "skipped";
  if (config.accessToken && baseUrl) {
    try {
      const response = await fetch(`${baseUrl}/api/oauth/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: config.accessToken }),
      });
      revoke = response.ok ? "revoked" : "failed";
    } catch {
      revoke = "failed";
    }
  }
  const configRemoved = tokenPresent;
  if (tokenPresent) {
    await writeConfig({ schema: CONFIG_SCHEMA, ...(baseUrl ? { baseUrl } : {}) });
  }
  const adapterStatuses = await localWorkbenchAdapterAuthStore(adapterAuthStoreRoot()).listStatus().catch(() => []);
  const adapterAuthRetained = adapterStatuses.length > 0;
  return emitResult("workbench.cli.logout.v1", {
    ...(baseUrl ? { baseUrl } : {}),
    tokenPresent,
    revoke,
    configRemoved,
    adapterAuthRetained,
  }, parsed, io, () => [
    `Logged out of Workbench${baseUrl ? ` (${baseUrl})` : ""}.`,
    `Token: ${tokenPresent ? "present" : "absent"}; revoke ${revoke}; config ${configRemoved ? "removed" : "unchanged"}.`,
    adapterAuthRetained
      ? "Local adapter auth records were retained; run workbench auth disconnect ADAPTER to remove them."
      : "No local adapter auth records remain.",
  ].join("\n"));
}

async function handleInstall(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const source = requiredFlag(parsed, {
    flag: "source",
    usage: "workbench install requires --source SOURCE.",
    remediation: "Run workbench install --source https://HOST/skills/OWNER/SKILL --agent codex.",
  });
  rejectExtraInput(parsed, {
    maxPositionals: 1,
    message: "workbench install accepts --source SOURCE, not positional SOURCE.",
    remediation: "Run workbench install --source https://HOST/skills/OWNER/SKILL --agent codex.",
  });
  if (parsed.flags.list !== true && stringsFlag(parsed, "agent").length === 0 && parsed.flags.local !== true) {
    throw new WorkbenchCodedError("install_target_required", "workbench install requires an explicit target.", {
      remediation: "Run workbench install --source SOURCE --agent codex, workbench install --source SOURCE --agent claude, or workbench install --source SOURCE --local.",
      exitCode: 2,
    });
  }
  const workbenchSource = parseWorkbenchInstallSource(source);
  if (!workbenchSource) {
    throw new WorkbenchCodedError("usage", "workbench install requires a Workbench Cloud source URL.", {
      remediation: "Run workbench install --source https://HOST/skills/OWNER/SKILL --agent codex.",
      exitCode: 2,
    });
  }
  const snapshot = await fetchWorkbenchInstallSourceSnapshot(workbenchSource, source);
  const sourceSummary = workbenchInstallSourceSummary(workbenchSource, snapshot);
  if (parsed.flags.list === true) {
    return emitResult("workbench.cli.install.v1", {
      source: sourceSummary,
      skills: [snapshot.name],
      fileCount: snapshot.files.length,
      targets: installTargetsToJson(supportedInstallTargets()),
    }, parsed, io, () => [
      `${snapshot.name}\t${snapshot.versionId}\tfiles=${snapshot.files.length}`,
      "Targets:",
      ...supportedInstallTargets().map((target) => `  ${target.agent}\t${target.destination}`),
    ].join("\n"));
  }
  const targets = resolveInstallTargets({
    agents: stringsFlag(parsed, "agent"),
    local: parsed.flags.local === true,
    skillName: snapshot.name,
  });
  const result = await installSnapshotToTargets({
    snapshot,
    targets,
    overwrite: parsed.flags.yes === true,
    dryRun: parsed.flags["dry-run"] === true,
  });
  return emitResult("workbench.cli.install.v1", {
    source: sourceSummary,
    result: result.result,
    targets: result.targets as unknown as Json,
    filesCopied: result.filesCopied,
    ...(parsed.flags["dry-run"] === true ? { dryRun: true } : {}),
  }, parsed, io, () => [
    parsed.flags["dry-run"] === true
      ? `Would install ${snapshot.name}: filesCopied=${result.filesCopied}`
      : `Installed ${snapshot.name}: ${result.result}`,
    ...result.targets.map((target) => `  ${target.agent}\t${target.previous}\t${target.destination}`),
  ].join("\n"));
}

interface ParsedWorkbenchInstallSource {
  baseUrl: string;
  owner: string;
  skill: string;
  version?: string;
}

interface WorkbenchInstallSourceSnapshot {
  schema: "workbench.source.snapshot.v1";
  owner: string;
  name: string;
  versionId: string;
  files: WorkbenchInstallSourceFile[];
}

interface WorkbenchInstallSourceFile {
  path: string;
  kind?: "text" | "binary";
  encoding?: "utf8" | "base64";
  executable?: boolean;
  content: string;
}

function workbenchInstallSourceSummary(
  source: ParsedWorkbenchInstallSource,
  snapshot: WorkbenchInstallSourceSnapshot,
): Json {
  const installUrl = `${source.baseUrl}/skills/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.skill)}`;
  return {
    kind: "workbench-cloud",
    owner: snapshot.owner,
    skill: snapshot.name,
    versionId: snapshot.versionId,
    installUrl,
    pinnedInstallUrl: `${installUrl}/releases/${encodeURIComponent(snapshot.versionId)}`,
  };
}

function parseWorkbenchInstallSource(source: string): ParsedWorkbenchInstallSource | undefined {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  if (segments[0] !== "skills") {
    return undefined;
  }
  if (!segments[1] || !segments[2]) {
    throw new WorkbenchUserError(`Invalid Workbench skill URL: ${source}`);
  }
  if (segments.length === 3) {
    return {
      baseUrl: url.origin,
      owner: segments[1],
      skill: segments[2],
    };
  }
  if (segments.length === 5 && segments[3] === "releases" && segments[4]) {
    return {
      baseUrl: url.origin,
      owner: segments[1],
      skill: segments[2],
      version: segments[4],
    };
  }
  throw new WorkbenchUserError(`Invalid Workbench skill URL: ${source}`);
}

async function fetchWorkbenchInstallSourceSnapshot(
  source: ParsedWorkbenchInstallSource,
  displaySource: string,
): Promise<WorkbenchInstallSourceSnapshot> {
  const token = await workbenchCloudToken({ baseUrl: source.baseUrl });
  const apiPath = source.version
    ? `/api/workbench/source/skills/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.skill)}/releases/${encodeURIComponent(source.version)}/source`
    : `/api/workbench/source/skills/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.skill)}/source`;
  const response = await fetch(`${source.baseUrl}${apiPath}`, {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await response.text();
  const cloudError = parseWorkbenchCloudErrorBody(text);
  if (cloudError) {
    throw new WorkbenchCodedError(cloudError.code, cloudError.message, {
      retryable: cloudError.retryable,
      ...(cloudError.remediation ? { remediation: cloudError.remediation } : {}),
      ...(cloudError.subject ? { subject: cloudError.subject } : {}),
      exitCode: response.status === 400 ? 2 : 1,
    });
  }
  if (response.status === 401) {
    throw new WorkbenchCodedError("auth_required", token
      ? `Workbench Cloud rejected the provided token while installing ${displaySource}.`
      : `Authentication is required to install ${displaySource}.`, {
      remediation: `Run workbench login --base-url ${source.baseUrl}.`,
      exitCode: 1,
    });
  }
  if (!response.ok) {
    throw new WorkbenchCodedError("install_failed", `Unable to download Workbench source ${displaySource}: ${response.status} ${readResponseError(text) ?? response.statusText}`, {
      subject: { source: displaySource, status: response.status },
      exitCode: 1,
    });
  }
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) as unknown : null;
  } catch {
    throw new WorkbenchCodedError("install_failed", `Workbench source ${displaySource} did not return JSON.`, {
      subject: { source: displaySource },
      exitCode: 1,
    });
  }
  const snapshot = parseWorkbenchInstallSourceSnapshot(parsed, displaySource);
  if (source.version && snapshot.versionId !== source.version) {
    throw new WorkbenchCodedError("install_failed", `Workbench source ${displaySource} resolved ${snapshot.versionId} instead of requested release ${source.version}.`, {
      subject: { source: displaySource, resolvedVersionId: snapshot.versionId, requestedVersionId: source.version },
      exitCode: 1,
    });
  }
  return snapshot;
}

function parseWorkbenchInstallSourceSnapshot(value: unknown, displaySource: string): WorkbenchInstallSourceSnapshot {
  const record = asRecord(value);
  if (record?.schema !== "workbench.source.snapshot.v1") {
    throw new WorkbenchCodedError("install_failed", `Workbench source ${displaySource} did not return a source snapshot.`, {
      subject: { source: displaySource },
      exitCode: 1,
    });
  }
  const owner = typeof record.owner === "string" ? record.owner : "";
  const name = typeof record.name === "string" ? record.name : "";
  const versionId = typeof record.versionId === "string" ? record.versionId : "";
  const files = Array.isArray(record.files) ? record.files.map((entry) => parseWorkbenchInstallSourceFile(entry, displaySource)) : [];
  if (!owner || !name || !versionId || files.length === 0) {
    throw new WorkbenchCodedError("install_failed", `Workbench source ${displaySource} returned an incomplete source snapshot.`, {
      subject: { source: displaySource },
      exitCode: 1,
    });
  }
  return {
    schema: "workbench.source.snapshot.v1",
    owner,
    name,
    versionId,
    files,
  };
}

function parseWorkbenchInstallSourceFile(value: unknown, displaySource: string): WorkbenchInstallSourceFile {
  const record = asRecord(value);
  if (!record) {
    throw new WorkbenchCodedError("install_failed", `Workbench source ${displaySource} returned an invalid file entry.`, {
      subject: { source: displaySource },
      exitCode: 1,
    });
  }
  const filePath = typeof record?.path === "string" ? record.path : "";
  const content = typeof record?.content === "string" ? record.content : undefined;
  if (!filePath || content === undefined) {
    throw new WorkbenchCodedError("install_failed", `Workbench source ${displaySource} returned an invalid file entry.`, {
      subject: { source: displaySource },
      exitCode: 1,
    });
  }
  return {
    path: normalizeInstallSnapshotPath(filePath),
    ...(record.kind === "text" || record.kind === "binary" ? { kind: record.kind } : {}),
    encoding: record.encoding === "base64" ? "base64" : "utf8",
    executable: record.executable === true,
    content,
  };
}

async function loadConfig(): Promise<WorkbenchConfig> {
  const parsed = await readConfigJson(configPath()) ?? {};
  return {
    schema: CONFIG_SCHEMA,
    ...(typeof parsed.baseUrl === "string" ? { baseUrl: normalizeBaseUrl(parsed.baseUrl) } : {}),
    ...(typeof parsed.accessToken === "string" ? { accessToken: parsed.accessToken } : {}),
    ...(typeof parsed.username === "string" ? { username: parsed.username } : {}),
  };
}

// Single resolver for the Workbench Cloud token used by every authenticated
// path: config accessToken first, then WORKBENCH_API_TOKEN, then
// WORKBENCH_SMOKE_BEARER_TOKEN. When a target base URL is known, the config
// token is only used if the config base URL matches it.
async function workbenchCloudToken(options: { baseUrl?: string } = {}): Promise<string | undefined> {
  const config = await loadConfig();
  const configToken = config.accessToken &&
      (!options.baseUrl || !config.baseUrl || normalizeBaseUrl(config.baseUrl) === normalizeBaseUrl(options.baseUrl))
    ? config.accessToken
    : undefined;
  return configToken ?? workbenchCloudEnvToken();
}

function workbenchCloudEnvToken(): string | undefined {
  return process.env.WORKBENCH_API_TOKEN?.trim() || process.env.WORKBENCH_SMOKE_BEARER_TOKEN?.trim() || undefined;
}

async function readConfigJson(filePath: string): Promise<Partial<WorkbenchConfig> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<WorkbenchConfig>;
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeConfig(config: WorkbenchConfig): Promise<void> {
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`);
}

function configPath(): string {
  return process.env.WORKBENCH_CONFIG?.trim() || path.join(os.homedir(), ".workbench", "config.json");
}

function deviceAuthPath(): string {
  return process.env.WORKBENCH_DEVICE_AUTH?.trim() || path.join(path.dirname(configPath()), "device-auth.json");
}

function selectWorkbenchBaseUrl(input: {
  explicitBaseUrl?: string;
  originBaseUrl?: string;
  configBaseUrl?: string;
} = {}): string {
  const baseUrl = optionalWorkbenchBaseUrl(input);
  if (!baseUrl) {
    throw new WorkbenchUserError("Missing Workbench API URL. Pass --base-url URL, set WORKBENCH_API_URL, or run `workbench login --base-url URL`.");
  }
  return baseUrl;
}

function optionalWorkbenchBaseUrl(input: {
  explicitBaseUrl?: string;
  originBaseUrl?: string;
  configBaseUrl?: string;
} = {}): string | undefined {
  const value =
    input.explicitBaseUrl ??
      input.originBaseUrl ??
      process.env.WORKBENCH_API_URL ??
      input.configBaseUrl;
  return value ? normalizeBaseUrl(value) : undefined;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

async function requestDeviceAuthorization(baseUrl: string): Promise<DeviceAuthorization> {
  const response = await fetch(`${baseUrl}/api/oauth/device/code`, { method: "POST" });
  const text = await response.text();
  const cloudError = parseWorkbenchCloudErrorBody(text);
  if (cloudError) {
    throw new WorkbenchCodedError(cloudError.code, cloudError.message, {
      retryable: cloudError.retryable,
      ...(cloudError.remediation ? { remediation: cloudError.remediation } : {}),
      ...(cloudError.subject ? { subject: cloudError.subject } : {}),
      exitCode: 1,
    });
  }
  if (!response.ok) {
    throw new WorkbenchCodedError("login_denied", `Device login failed: ${readResponseError(text) ?? response.statusText}`, {
      exitCode: 1,
    });
  }
  return JSON.parse(text) as DeviceAuthorization;
}

async function startDeviceAuthorization(baseUrl: string): Promise<DeviceAuthorizationRecord> {
  const authorization = await requestDeviceAuthorization(baseUrl);
  return {
    schema: "workbench.cli.device-auth.v1",
    baseUrl,
    device_code: authorization.device_code,
    user_code: authorization.user_code,
    verification_uri: authorization.verification_uri,
    verification_uri_complete: authorization.verification_uri_complete,
    expiresAt: new Date(Date.now() + Math.max(1, authorization.expires_in) * 1000).toISOString(),
    ...(authorization.interval !== undefined ? { interval: authorization.interval } : {}),
  };
}

async function pollDeviceToken(
  baseUrl: string,
  authorization: DeviceAuthorizationRecord,
  timeoutSeconds: number | undefined,
): Promise<DeviceToken> {
  const expiresAtMs = Date.parse(authorization.expiresAt);
  const expiryDeadline = Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 15 * 60 * 1000;
  const timeoutDeadline = timeoutSeconds ? Date.now() + timeoutSeconds * 1000 : Number.POSITIVE_INFINITY;
  const deadline = Math.min(expiryDeadline, timeoutDeadline);
  let intervalMs = Math.max(1, authorization.interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: authorization.device_code,
      }),
    });
    const text = await response.text();
    if (response.ok) {
      return JSON.parse(text) as DeviceToken;
    }
    const error = readResponseError(text) ?? "authorization_pending";
    if (error === "slow_down") {
      intervalMs += 5000;
    } else if (error !== "authorization_pending") {
      throw new WorkbenchCodedError("login_denied", `Device login failed: ${error}`, {
        exitCode: 1,
      });
    }
    await sleep(intervalMs);
  }
  throw new WorkbenchCodedError("login_pending", "Device login is still waiting for browser authorization.", {
    retryable: true,
    remediation: "Authorize the device in the browser, then run workbench login --wait --timeout 120.",
    subject: {
      retryAfterSeconds: Math.max(1, Math.ceil(intervalMs / 1000)),
      verificationUri: authorization.verification_uri,
      verificationUriComplete: authorization.verification_uri_complete,
      userCode: authorization.user_code,
      expiresAt: authorization.expiresAt,
    },
    exitCode: 1,
  });
}

async function fetchWorkbenchUsername(baseUrl: string, accessToken: string): Promise<string | undefined> {
  const response = await fetch(`${baseUrl}/api/workbench/profile`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    return undefined;
  }
  const record = asRecord(await response.json() as unknown);
  const profile = asRecord(record?.profile);
  return typeof profile?.username === "string" ? profile.username : undefined;
}

async function readPendingDeviceAuthorization(baseUrl: string): Promise<DeviceAuthorizationRecord | null> {
  const record = await readDeviceAuthorizationJson(deviceAuthPath());
  if (!record || record.baseUrl !== baseUrl || Date.parse(record.expiresAt) <= Date.now()) {
    return null;
  }
  return record;
}

async function writePendingDeviceAuthorization(record: DeviceAuthorizationRecord): Promise<void> {
  await fs.mkdir(path.dirname(deviceAuthPath()), { recursive: true });
  await fs.writeFile(deviceAuthPath(), `${JSON.stringify(record, null, 2)}\n`);
}

async function clearPendingDeviceAuthorization(): Promise<void> {
  await fs.rm(deviceAuthPath(), { force: true });
}

async function readDeviceAuthorizationJson(filePath: string): Promise<DeviceAuthorizationRecord | null> {
  try {
    const record = asRecord(JSON.parse(await fs.readFile(filePath, "utf8")) as unknown);
    if (
      record?.schema !== "workbench.cli.device-auth.v1" ||
      typeof record.baseUrl !== "string" ||
      typeof record.device_code !== "string" ||
      typeof record.user_code !== "string" ||
      typeof record.verification_uri !== "string" ||
      typeof record.verification_uri_complete !== "string" ||
      typeof record.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(record.expiresAt))
    ) {
      return null;
    }
    return {
      schema: "workbench.cli.device-auth.v1",
      baseUrl: record.baseUrl,
      device_code: record.device_code,
      user_code: record.user_code,
      verification_uri: record.verification_uri,
      verification_uri_complete: record.verification_uri_complete,
      expiresAt: record.expiresAt,
      ...(typeof record.interval === "number" ? { interval: record.interval } : {}),
    };
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function apiRequest<T>(
  apiPath: string,
  options: { method?: string; body?: unknown } = {},
  baseUrlOverride?: string,
): Promise<T> {
  const config = await loadConfig();
  const baseUrl = baseUrlOverride !== undefined
    ? normalizeBaseUrl(baseUrlOverride)
    : selectWorkbenchBaseUrl({ configBaseUrl: config.baseUrl });
  const token = await workbenchCloudToken({ baseUrl });
  const method = options.method ?? "GET";
  const canRetry = method === "GET";
  const requestBody = encodeJsonRequestBody(options.body);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= API_REQUEST_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${apiPath}`, {
        method,
        headers: {
          ...requestBody.headers,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: requestBody.body,
      });
    } catch (error) {
      lastError = error;
      if (canRetry && attempt < API_REQUEST_MAX_ATTEMPTS && isTransientFetchError(error)) {
        await sleep(250 * attempt);
        continue;
      }
      throw error;
    }
    if (!response.ok) {
      const text = await response.text();
      const cloudError = parseWorkbenchCloudErrorBody(text);
      if (cloudError) {
        const requestError = new WorkbenchCodedError(cloudError.code, cloudError.message, {
          retryable: cloudError.retryable,
          ...(cloudError.remediation ? { remediation: cloudError.remediation } : {}),
          ...(cloudError.subject ? { subject: cloudError.subject } : {}),
          exitCode: response.status === 400 ? 2 : 1,
        });
        lastError = requestError;
        if (canRetry && attempt < API_REQUEST_MAX_ATTEMPTS && cloudError.retryable) {
          await sleep(250 * attempt);
          continue;
        }
        throw requestError;
      }
      const requestError = new WorkbenchApiRequestError(
        response.status,
        readResponseError(text) ?? `Request failed with status ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
        text,
      );
      lastError = requestError;
      if (canRetry && attempt < API_REQUEST_MAX_ATTEMPTS && isTransientApiRequestError(requestError)) {
        await sleep(250 * attempt);
        continue;
      }
      throw requestError;
    }
    return await response.json() as T;
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Workbench API request failed."));
}

function encodeJsonRequestBody(body: unknown): {
  body?: Buffer | string;
  headers: Record<string, string>;
} {
  if (body == null) {
    return { headers: { "content-type": "application/json" } };
  }
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) < API_REQUEST_GZIP_THRESHOLD_BYTES) {
    return { body: text, headers: { "content-type": "application/json" } };
  }
  return {
    body: gzipSync(text),
    headers: {
      "content-encoding": "gzip",
      "content-type": "application/json",
    },
  };
}

async function uploadAdapterConnection(bundle: WorkbenchAdapterAuthBundle, parsed: ParsedArgs): Promise<{
  status: "authenticated" | "not_authenticated";
  sync: "uploaded" | "skipped";
  reason?: string;
  remediation?: string;
}> {
  const token = await workbenchCloudToken();
  if (parsed.flags["local-only"] === true) {
    return {
      status: token ? "authenticated" : "not_authenticated",
      sync: "skipped",
      reason: "local_only",
    };
  }
  if (!token) {
    return {
      status: "not_authenticated",
      sync: "skipped",
      reason: "not_authenticated",
      remediation: "Run workbench login.",
    };
  }
  await apiRequest<{ ok: boolean; status: string }>(
    adapterConnectionApiPath(bundle),
    { method: "PUT", body: { bundle } },
  );
  return { status: "authenticated", sync: "uploaded" };
}

async function deleteAdapterConnectionRemote(target: ReturnType<typeof parseWorkbenchAdapterAuthTarget>, parsed: ParsedArgs): Promise<{
  status: "authenticated" | "not_authenticated";
  sync: "deleted" | "skipped";
  reason?: string;
  remediation?: string;
}> {
  const token = await workbenchCloudToken();
  if (parsed.flags["local-only"] === true) {
    return {
      status: token ? "authenticated" : "not_authenticated",
      sync: "skipped",
      reason: "local_only",
    };
  }
  if (!token) {
    return {
      status: "not_authenticated",
      sync: "skipped",
      reason: "not_authenticated",
      remediation: "Run workbench login.",
    };
  }
  await apiRequest<{ ok: boolean; status: string }>(
    adapterConnectionApiPath(target),
    { method: "DELETE" },
  );
  return { status: "authenticated", sync: "deleted" };
}

function adapterConnectionApiPath(target: {
  adapterId: string;
  slot?: string;
  profile: string;
}): string {
  const params = new URLSearchParams({ profile: target.profile });
  if (target.slot) {
    params.set("slot", target.slot);
  }
  return `/api/workbench/auth/adapters/${encodeURIComponent(target.adapterId)}?${params.toString()}`;
}

class WorkbenchApiRequestError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, message: string, body: string) {
    super(message);
    this.name = "WorkbenchApiRequestError";
    this.status = status;
    this.body = body;
  }
}

function readResponseError(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    const record = asRecord(parsed);
    const error = record?.error ?? record?.message;
    return typeof error === "string" && error.trim() ? error : null;
  } catch {
    return text.trim() || null;
  }
}

function parseWorkbenchCloudErrorBody(text: string): {
  code: string;
  message: string;
  retryable: boolean;
  remediation?: string;
  subject?: Record<string, Json>;
} | null {
  try {
    const record = asRecord(JSON.parse(text) as unknown);
    if (record?.schema !== "workbench.cloud.error.v1" || typeof record.code !== "string" || typeof record.message !== "string") {
      return null;
    }
    const subject = asRecord(record.subject);
    return {
      code: record.code,
      message: record.message,
      retryable: record.retryable === true,
      ...(typeof record.remediation === "string" ? { remediation: record.remediation } : {}),
      ...(subject ? { subject: subject as Record<string, Json> } : {}),
    };
  } catch {
    return null;
  }
}

function isTransientFetchError(error: unknown): boolean {
  return /(?:fetch failed|socket hang up|ECONNRESET|EPIPE|UND_ERR_SOCKET|terminated)/iu.test(errorMessage(error));
}

function isTransientApiRequestError(error: unknown): boolean {
  return error instanceof WorkbenchApiRequestError && (error.status === 429 || error.status >= 500);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openBrowser(url: string): Promise<void> {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function adapterAuthStoreRoot(): string | undefined {
  return process.env.WORKBENCH_ADAPTER_AUTH_STORE?.trim() || undefined;
}

function parseAuthTarget(targetRaw: string, profile: string): ReturnType<typeof parseWorkbenchAdapterAuthTarget> {
  try {
    return parseWorkbenchAdapterAuthTarget(targetRaw, profile);
  } catch (error) {
    throw new WorkbenchUserError(error instanceof Error ? error.message : String(error));
  }
}

function authProfileFlag(parsed: ParsedArgs): string {
  const profile = stringFlag(parsed, "profile") ?? "default";
  if (!/^[a-z][a-z0-9-]*$/u.test(profile)) {
    throw new WorkbenchUserError("--profile must be a lowercase identifier.");
  }
  return profile;
}

function authMethod(parsed: ParsedArgs, adapterId: string): string {
  const explicit = stringFlag(parsed, "method");
  if (explicit) {
    return explicit;
  }
  if (adapterId === "codex") {
    return process.env.OPENAI_API_KEY ? "api-key" : "oauth";
  }
  if (adapterId === "claude") {
    return process.env.ANTHROPIC_API_KEY ? "api-key" : "oauth";
  }
  return "env";
}

async function collectAdapterAuthBundle(args: {
  target: ReturnType<typeof parseWorkbenchAdapterAuthTarget>;
  method: string;
  profileRoot: string;
}): Promise<WorkbenchAdapterAuthBundle> {
  const adapterId = args.target.adapterId;
  if (adapterId === "codex") {
    if (args.method === "api-key") {
      return createWorkbenchAdapterAuthBundle({
        target: args.target,
        method: args.method,
        env: requiredEnvVars(["OPENAI_API_KEY"]),
      });
    }
    if (args.method === "oauth") {
      return createWorkbenchAdapterAuthBundle({
        target: args.target,
        method: args.method,
        files: [await requiredAuthFile(args.profileRoot, ".codex/auth.json")],
      });
    }
  }
  if (adapterId === "claude") {
    if (args.method === "api-key") {
      return createWorkbenchAdapterAuthBundle({
        target: args.target,
        method: args.method,
        env: requiredEnvVars(["ANTHROPIC_API_KEY"]),
      });
    }
    if (args.method === "oauth") {
      return createWorkbenchAdapterAuthBundle({
        target: args.target,
        method: args.method,
        files: [
          await requiredAuthFile(args.profileRoot, ".claude.json"),
          ...await optionalAuthFiles(args.profileRoot, [
            ".claude/oauth-token",
            ".claude/.credentials.json",
          ]),
        ],
      });
    }
    if (args.method === "bedrock") {
      return createWorkbenchAdapterAuthBundle({
        target: args.target,
        method: args.method,
        env: requiredEnvVars(["CLAUDE_CODE_USE_BEDROCK", "AWS_REGION"], [
          "AWS_ACCESS_KEY_ID",
          "AWS_SECRET_ACCESS_KEY",
          "AWS_SESSION_TOKEN",
          "AWS_DEFAULT_REGION",
          "AWS_BEARER_TOKEN_BEDROCK",
          "ANTHROPIC_MODEL",
          "ANTHROPIC_SMALL_FAST_MODEL",
        ]),
      });
    }
  }
  throw new WorkbenchUserError(`Adapter ${adapterId} does not support local ${args.method} auth capture in this CLI.`);
}

function requiredEnvVars(required: readonly string[], optional: readonly string[] = []): Record<string, string> {
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new WorkbenchUserError(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
  return Object.fromEntries([...required, ...optional].flatMap((name) => {
    const value = process.env[name]?.trim();
    return value ? [[name, value]] : [];
  }));
}

async function requiredAuthFile(root: string, relativePath: string): Promise<WorkbenchAdapterAuthFile> {
  const file = await readAuthFile(root, relativePath);
  if (!file) {
    throw new WorkbenchUserError(`Missing auth file: ${path.join(root, relativePath)}`);
  }
  return file;
}

async function optionalAuthFiles(root: string, paths: readonly string[]): Promise<WorkbenchAdapterAuthFile[]> {
  const files: Array<WorkbenchAdapterAuthFile | null> = await Promise.all(paths.map((entry) => readAuthFile(root, entry)));
  return files.filter((entry: WorkbenchAdapterAuthFile | null): entry is WorkbenchAdapterAuthFile => Boolean(entry));
}

async function readAuthFile(root: string, relativePath: string): Promise<WorkbenchAdapterAuthFile | null> {
  const absolute = path.join(root, relativePath);
  const content = await fs.readFile(absolute, "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  });
  return content === null
    ? null
    : { path: relativePath, content, encoding: "utf8" };
}

async function requiredAgentAuthStatuses(
  parsed: ParsedArgs,
  statuses: readonly WorkbenchAdapterAuthStatusRecord[],
): Promise<Array<{ agent: string; adapter: string; local: "connected" | "missing" }>> {
  const statusMap = new Map(statuses.map((entry) => [
    `${entry.adapterId}/${entry.slot ?? "_"}/${entry.profile}`,
    entry,
  ]));
  const agents = await listWorkbenchAgents({ dir: dirFlag(parsed) }).catch(() => []);
  return await Promise.all(agents
    .filter((agent) => ["codex", "claude"].includes(agent.adapter.trim().toLowerCase()))
    .map(async (agent) => {
      const target = parseAuthTarget(agent.adapter.trim().toLowerCase(), "default");
      const local = statusMap.get(`${target.adapterId}/${target.slot ?? "_"}/${target.profile}`) ??
        await localWorkbenchAdapterAuthStore(adapterAuthStoreRoot()).status(target);
      return {
        agent: agent.name,
        adapter: agent.adapter,
        local: local.status === "connected" ? "connected" as const : "missing" as const,
      };
    }));
}

function formatAuthStatusRecord(status: WorkbenchAdapterAuthStatusRecord): string {
  return `${formatAuthTarget(status)}\t${status.status}${status.method ? `\t${status.method}` : ""}${status.reason ? `\t${status.reason}` : ""}`;
}

function authStatusRecordToJson(status: WorkbenchAdapterAuthStatusRecord): Json {
  return {
    adapter: status.adapterId,
    ...(status.slot ? { slot: status.slot } : {}),
    profile: status.profile,
    status: status.status,
    ...(status.method ? { method: status.method } : {}),
    ...(status.updatedAt ? { updatedAt: status.updatedAt } : {}),
  };
}

function formatWorkbenchCloudAuthStatus(status: WorkbenchCliAuthStatus["workbenchCloud"]): string {
  return `Workbench Cloud: ${status.status}${status.baseUrl ? `\tbaseUrl=${status.baseUrl}` : ""}${status.username ? `\tuser=${status.username}` : ""}`;
}

function formatAuthStatusList(
  workbenchCloud: WorkbenchCliAuthStatus["workbenchCloud"],
  statuses: readonly WorkbenchAdapterAuthStatusRecord[],
  required: readonly { agent: string; adapter: string; local: "connected" | "missing" }[],
): string {
  const lines = [
    formatWorkbenchCloudAuthStatus(workbenchCloud),
    "",
    ...(statuses.length > 0
      ? ["Adapter auth:", ...statuses.map(formatAuthStatusRecord)]
      : ["No local adapter auth records."]),
    ...(required.length > 0
      ? ["", "Required by agents:", ...required.map((entry) => `${entry.agent}\t${entry.adapter}\t${entry.local}`)]
      : []),
  ];
  return lines.join("\n");
}

function formatAuthTarget(target: { adapterId: string; slot?: string; profile: string }): string {
  return `${target.adapterId}${target.slot ? `/${target.slot}` : ""}${target.profile === "default" ? "" : ` profile ${target.profile}`}`;
}

interface LocalAgentSession {
  id: string;
  source: "codex" | "claude";
  path: string;
  updatedAt: string;
  bytes: number;
  title?: string;
}

interface LocalAgentSessionDetail extends LocalAgentSession {
  excerpts: string[];
}

async function listLocalAgentSessions(): Promise<LocalAgentSession[]> {
  const [codex, claude] = await Promise.all([
    discoverSessionFiles("codex", [
      path.join(process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex"), "sessions"),
      path.join(process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex"), "archived_sessions"),
    ]),
    discoverSessionFiles("claude", [
      path.join(process.env.CLAUDE_HOME?.trim() || path.join(os.homedir(), ".claude"), "projects"),
    ]),
  ]);
  return [...codex, ...claude]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 50);
}

async function showLocalAgentSession(ref: string): Promise<LocalAgentSessionDetail | null> {
  if (!ref.startsWith("codex:") && !ref.startsWith("claude:")) {
    return null;
  }
  const sessions = await listLocalAgentSessions();
  const session = sessions.find((entry) => entry.id === ref);
  if (!session) {
    throw new WorkbenchCodedError("ref_not_found", `Session not found: ${ref}`, { exitCode: 1 });
  }
  return {
    ...session,
    excerpts: await readSessionExcerpts(session.path),
  };
}

async function discoverSessionFiles(source: LocalAgentSession["source"], roots: readonly string[]): Promise<LocalAgentSession[]> {
  const files = (await Promise.all(roots.map((root) => findSessionJsonlFiles(root, 0)))).flat();
  return (await Promise.all(files.map(async (filePath) => {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      return null;
    }
    const title = await readSessionTitle(filePath).catch(() => undefined);
    return {
      id: `${source}:${path.basename(filePath).replace(/\.jsonl$/u, "")}`,
      source,
      path: filePath,
      updatedAt: stat.mtime.toISOString(),
      bytes: stat.size,
      ...(title ? { title } : {}),
    };
  }))).filter((entry): entry is LocalAgentSession => Boolean(entry));
}

async function findSessionJsonlFiles(root: string, depth: number): Promise<string[]> {
  if (depth > 6) {
    return [];
  }
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findSessionJsonlFiles(absolute, depth + 1));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(absolute);
    }
    if (files.length >= 300) {
      break;
    }
  }
  return files;
}

async function readSessionTitle(filePath: string): Promise<string | undefined> {
  const source = await fs.readFile(filePath, "utf8");
  for (const line of source.split(/\r?\n/u).slice(0, 50)) {
    if (!line.trim()) {
      continue;
    }
    const record = asRecord(JSON.parse(line) as unknown);
    const text = firstString(record, ["title", "summary", "message", "prompt", "cwd"]);
    if (text) {
      return text.length > 100 ? `${text.slice(0, 97)}...` : text;
    }
  }
  return undefined;
}

async function readSessionExcerpts(filePath: string): Promise<string[]> {
  const source = await fs.readFile(filePath, "utf8");
  const excerpts: string[] = [];
  for (const line of source.split(/\r?\n/u).slice(0, 200)) {
    if (!line.trim()) {
      continue;
    }
    let text: string | undefined;
    try {
      text = sessionTextFromRecord(asRecord(JSON.parse(line) as unknown));
    } catch {
      continue;
    }
    if (text) {
      excerpts.push(text.length > 240 ? `${text.slice(0, 237)}...` : text);
    }
    if (excerpts.length >= 12) {
      break;
    }
  }
  return excerpts;
}

function sessionTextFromRecord(record: Record<string, unknown> | null): string | undefined {
  const direct = firstString(record, ["title", "summary", "message", "prompt", "cwd", "text"]);
  if (direct) {
    return direct;
  }
  const content = record?.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const text = content.flatMap((entry) => {
      const part = asRecord(entry);
      return typeof part?.text === "string" ? [part.text.trim()] : [];
    }).filter(Boolean).join("\n");
    return text || undefined;
  }
  const message = asRecord(record?.message);
  return firstString(message, ["content", "text"]);
}

function firstString(record: Record<string, unknown> | null, keys: readonly string[]): string | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "-h") {
      addFlag(flags, "help", true);
      continue;
    }
    if (arg === "-v") {
      addFlag(flags, "version", true);
      continue;
    }
    if (!arg.startsWith("--") || arg === "--") {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const value = eq === -1 ? argv[index + 1] : arg.slice(eq + 1);
    if (eq === -1 && BOOLEAN_FLAGS.has(name)) {
      addFlag(flags, name, true);
    } else if (eq === -1 && value && !value.startsWith("-")) {
      index += 1;
      addFlag(flags, name, value);
    } else {
      addFlag(flags, name, eq === -1 ? true : value ?? true);
    }
  }
  return { positionals, flags };
}

function addFlag(flags: Record<string, string | boolean | string[]>, name: string, value: string | boolean): void {
  if (name === "with") {
    const existing = flags[name];
    flags[name] = Array.isArray(existing)
      ? [...existing, String(value)]
      : existing === undefined
        ? [String(value)]
        : [String(existing), String(value)];
    return;
  }
  if (name === "agent" || name === "skill") {
    const existing = flags[name];
    flags[name] = Array.isArray(existing)
      ? [...existing, String(value)]
      : existing === undefined
        ? String(value)
        : [String(existing), String(value)];
    return;
  }
  flags[name] = value;
}

function dirFlag(parsed: ParsedArgs): string | undefined {
  return stringFlag(parsed, "dir");
}

async function coreOptions(parsed: ParsedArgs): Promise<{ dir?: string; authToken?: string }> {
  return {
    dir: dirFlag(parsed),
    authToken: await workbenchCloudToken(),
  };
}

function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : undefined;
}

function stringsFlag(parsed: ParsedArgs, name: string): string[] {
  const value = parsed.flags[name];
  return Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
}

function intFlag(parsed: ParsedArgs, name: string): number | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new WorkbenchUserError(`--${name} must be a positive integer.`);
  }
  return parsedValue;
}

function optionalPositional(parsed: ParsedArgs, index: number): string | undefined {
  return parsed.positionals[index];
}

function requiredPositional(parsed: ParsedArgs, index: number, message: string): string {
  const value = parsed.positionals[index];
  if (!value) {
    throw new WorkbenchUserError(message);
  }
  return value;
}

function requiredFlag(
  parsed: ParsedArgs,
  input: {
    flag: string;
    usage: string;
    remediation: string;
  },
): string {
  const flagValue = stringFlag(parsed, input.flag);
  if (!flagValue) {
    throw new WorkbenchCodedError("usage", input.usage, {
      remediation: input.remediation,
      exitCode: 2,
    });
  }
  return flagValue;
}

function rejectExtraInput(
  parsed: ParsedArgs,
  input: { maxPositionals: number; message: string; remediation: string },
): void {
  if (parsed.positionals.length <= input.maxPositionals) {
    return;
  }
  throw new WorkbenchCodedError("usage", input.message, {
    remediation: input.remediation,
    exitCode: 2,
  });
}

function parsePublishVisibility(value: string | undefined): "private" | "internal" | "public" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "private" || value === "internal" || value === "public") {
    return value;
  }
  throw new WorkbenchUserError("workbench publish --visibility must be private, internal, or public.");
}

function parseWithFlags(parsed: ParsedArgs): Record<string, Json> {
  const raw = parsed.flags.with;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return Object.fromEntries(values.map((entry) => {
    const eq = entry.indexOf("=");
    if (eq === -1) {
      return [entry, true];
    }
    return [entry.slice(0, eq), parseScalar(entry.slice(eq + 1))];
  }));
}

function parseScalar(value: string): Json {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return Number(value);
  }
  return value;
}

async function artifactIdsByRunId(
  core: { dir?: string; authToken?: string },
  runs: readonly WorkbenchRun[],
): Promise<Map<string, string[]>> {
  const runIds = new Set(runs.map((run) => run.id));
  const byRun = new Map([...runIds].map((runId) => [runId, [] as string[]]));
  if (runIds.size === 0) {
    return byRun;
  }
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  for (const job of snapshot.jobs) {
    if (!runIds.has(job.runId)) {
      continue;
    }
    const current = byRun.get(job.runId) ?? [];
    byRun.set(job.runId, [...new Set([...current, ...job.artifactIds])]);
  }
  return byRun;
}

function emitEvalFailure(
  runs: readonly WorkbenchRun[],
  failedRuns: readonly WorkbenchRun[],
  artifactIds: ReadonlyMap<string, readonly string[]>,
  parsed: ParsedArgs,
  io: CliIo,
): number {
  const nextCommands = evalFailureNextCommands(failedRuns);
  if (parsed.flags.json === true) {
    io.stdout.write(`${JSON.stringify({
      schema: "workbench.cli.eval.v1",
      ok: false,
      code: "eval_runs_failed",
      message: "Eval failed; evidence was saved.",
      retryable: false,
      evidenceSaved: true,
      runs: runs.map((run) => runFailureSummary(run, artifactIds.get(run.id) ?? [])),
      failedRuns: failedRuns.map((run) => runFailureSummary(run, artifactIds.get(run.id) ?? [])),
      nextCommands,
    }, null, 2)}\n`);
    return 1;
  }
  io.stdout.write([
    "Eval failed; evidence was saved.",
    ...failedRuns.map(formatRun),
    ...(nextCommands.length > 0 ? ["next:", ...nextCommands.map((command) => `  ${command}`)] : []),
  ].join("\n") + "\n");
  return 1;
}

function runSummary(run: WorkbenchRun, artifactIds: readonly string[]): Json {
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    versionId: run.versionId,
    skillName: run.skillName,
    agentName: run.agentName,
    ...(run.score !== undefined ? { score: run.score } : {}),
    ...(run.latencyMs !== undefined ? { latencyMs: run.latencyMs } : {}),
    ...(run.error ? { error: run.error } : {}),
    ...(run.jobIds ? { jobIds: run.jobIds } : {}),
    traceIds: run.traceIds,
    artifactIds: [...artifactIds],
  };
}

function runFailureSummary(run: WorkbenchRun, artifactIds: readonly string[]): Json {
  return {
    runId: run.id,
    agent: run.agentName,
    skill: run.skillName,
    status: run.status,
    versionId: run.versionId,
    ...(run.score !== undefined ? { score: run.score } : {}),
    ...(run.error ? { error: run.error } : {}),
    traceIds: run.traceIds,
    artifactIds: [...artifactIds],
  };
}

function evalFailureNextCommands(failedRuns: readonly WorkbenchRun[]): string[] {
  const first = failedRuns[0];
  if (!first) {
    return ["workbench compare --versions all"];
  }
  const traceId = first.traceIds[0];
  return [
    "workbench compare --versions all",
    `workbench trace ${first.id}`,
    ...(traceId ? [`workbench show ${traceId}:stderr.log`] : []),
    `workbench improve --agent ${first.agentName} --budget 1 --samples 1`,
  ];
}

function output(value: unknown, parsed: ParsedArgs, io: CliIo, text: () => string): number {
  return emitResult(commandSchema(parsed), { result: value as Json }, parsed, io, text);
}

function commandSchema(parsed: ParsedArgs): string {
  const command = parsed.positionals[0] ?? "result";
  const subcommand = parsed.positionals[1];
  const suffix = ["auth", "remote", "agent", "case", "skills"].includes(command) && subcommand
    ? `${command}-${subcommand}`
    : command;
  return `workbench.cli.${suffix}.v1`;
}

interface WorkbenchCliAuthStatus {
  workbenchCloud: {
    status: "authenticated" | "not_authenticated";
    baseUrl?: string;
    username?: string;
  };
  adapters: Array<{
    adapter: string;
    slot?: string;
    profile: string;
    status: string;
    method?: string;
    updatedAt?: string;
  }>;
}

async function workbenchCliAuthStatus(): Promise<WorkbenchCliAuthStatus> {
  const config = await loadConfig();
  const adapterStatuses = await localWorkbenchAdapterAuthStore(adapterAuthStoreRoot()).listStatus().catch(() => []);
  const baseUrl = optionalWorkbenchBaseUrl({ configBaseUrl: config.baseUrl });
  return {
    workbenchCloud: {
      status: config.accessToken || workbenchCloudEnvToken() ? "authenticated" : "not_authenticated",
      ...(baseUrl ? { baseUrl } : {}),
      ...(config.accessToken && config.username ? { username: config.username } : {}),
    },
    adapters: adapterStatuses.map((status) => ({
      adapter: status.adapterId,
      ...(status.slot ? { slot: status.slot } : {}),
      profile: status.profile,
      status: status.status,
      ...(status.method ? { method: status.method } : {}),
      ...(status.updatedAt ? { updatedAt: status.updatedAt } : {}),
    })),
  };
}

function formatStatusSnapshot(status: Awaited<ReturnType<typeof workbenchStatusSnapshot>> & {
  auth?: WorkbenchCliAuthStatus;
}): string {
  const lines = [
    `Root: ${status.project.root}`,
    `Initialized: ${status.project.initialized ? "yes" : "no"}`,
    ...(status.project.currentVersionId ? [`Current version: ${status.project.currentVersionId}`] : []),
    ...(status.project.defaultSkill ? [`Default skill: ${status.project.defaultSkill}`] : []),
    ...(status.project.defaultAgent ? [`Default agent: ${status.project.defaultAgent}`] : []),
    `Runs: ${status.runs.total}${status.runs.lastStatus ? ` (last ${status.runs.lastStatus})` : ""}`,
    `Workbench Cloud: ${status.auth?.workbenchCloud.status ?? "not_authenticated"}${status.auth?.workbenchCloud.baseUrl ? ` ${status.auth.workbenchCloud.baseUrl}` : ""}`,
    ...(status.remotes.length > 0 ? ["Remotes:", ...status.remotes.flatMap((remote) => {
      const publication = remote.publication.status === "published"
        ? [
            "publication=published",
            remote.publication.visibility ? `visibility=${remote.publication.visibility}` : undefined,
            remote.publication.versionId ? `version=${remote.publication.versionId}` : undefined,
            remote.publication.installUrl ? `install=${remote.publication.installUrl}` : undefined,
            remote.publication.pinnedInstallUrl ? `pinned=${remote.publication.pinnedInstallUrl}` : undefined,
          ].filter(Boolean).join("\t")
        : "publication=unpublished";
      return [
        `  ${remote.name}\tkind=${remote.kind}\tsync=${remote.sync.status}\turl=${remote.url}\t${publication}`,
        ...(remote.sync.status === "error" && remote.sync.lastError
          ? [
            `    error[${remote.sync.lastError.code}]: ${remote.sync.lastError.message}`,
            ...(remote.sync.lastAttemptAt ? [`    last attempt: ${remote.sync.lastAttemptAt}`] : []),
            ...(remote.sync.nextCommand ? [`    next: ${remote.sync.nextCommand}`] : []),
          ]
          : []),
      ];
    })] : ["Remotes: none"]),
    ...(status.next.length > 0 ? ["Next:", ...status.next.map((command) => `  ${command}`)] : []),
  ];
  return lines.join("\n");
}

function formatCheck(result: Awaited<ReturnType<typeof checkWorkbenchSkill>>): string {
  return [
    "Workbench skill is valid.",
    `Cases: ${result.cases} (${result.plan.source.smokeCaseCount} smoke)`,
    `Skills: ${result.skills}`,
    `Agents: ${result.agents}`,
    `Skill files: ${result.plan.source.skillFiles}`,
    `Eval files: ${result.plan.source.evalFiles}`,
    "",
    "Skill plan:",
    ...result.plan.skills.map((skill) =>
      [
        skill.name,
        `bundle=${skill.bundleHash.slice(0, 12)}`,
        `files=${skill.fileCount}`,
        `includes=${skill.includedSkillCount}`,
      ].join("\t")
    ),
    "",
    "Agent plan:",
    ...result.plan.agents.map((agent) =>
      [
        agent.name,
        agent.adapter,
        agent.model,
        agent.providerBacked ? "provider-eval" : "local-eval",
        `network=${agent.network.egress}`,
        `cpu=${agent.resources.cpu}`,
        `memoryGb=${agent.resources.memoryGb}`,
        `timeout=${agent.resources.timeoutMinutes}m`,
        `image=${agent.image}`,
        agent.auth ? `auth=${agent.auth}` : undefined,
      ].filter(Boolean).join("\t")
    ),
  ].join("\n");
}

function formatVersion(version: WorkbenchVersion): string {
  return `${version.id}\t${version.hash.slice(0, 12)}\t${version.message}`;
}

function versionSummary(version: WorkbenchVersion): Json {
  return {
    id: version.id,
    hash: version.hash,
    message: version.message,
    parentIds: version.parentIds,
    createdAt: version.createdAt,
    fileCount: version.files.length,
  };
}

function formatAgent(agent: WorkbenchAgent): string {
  return `${agent.name}\t${agent.adapter}${agent.model ? `\t${agent.model}` : ""}`;
}

function formatRun(run: WorkbenchRun): string {
  const score = run.score === undefined ? "n/a" : run.score.toFixed(3);
  const latency = run.latencyMs === undefined ? "n/a" : `${run.latencyMs}ms`;
  return `${run.id}\t${run.kind}\t${run.status}\tversion=${run.versionId}\tskill=${run.skillName}\tagent=${run.agentName}\tscore=${score}\tlatency=${latency}`;
}

function formatImproveResult(result: Awaited<ReturnType<typeof improveWorkbenchSkill>>): string {
  return [
    `Improved ${result.version.parentIds[0] ?? "current"} -> ${result.version.id}. ${formatRun(result.run)}`,
    result.switched
      ? "Switched to improved version."
      : `Did not switch: ${result.promotionReason}`,
  ].join("\n");
}

function formatJob(job: WorkbenchJob): string {
  const score = job.score === undefined ? "n/a" : job.score.toFixed(3);
  const duration = job.durationMs === undefined ? "n/a" : `${job.durationMs}ms`;
  return `${job.id}\trun=${job.runId}\tcase=${job.caseId}\tsample=${job.sample}\t${job.status}\tscore=${score}\tduration=${duration}`;
}

function formatComparison(comparison: WorkbenchComparison): string {
  const lines = ["version\tskill\tagent\tstatus\tscore\tcost\tlatency\trun"];
  for (const cell of comparison.cells) {
    lines.push([
      cell.versionId,
      cell.skillName,
      `${cell.agentName}@${shortObjectId(cell.agentHash)}`,
      cell.status ?? "not-run",
      cell.score === undefined ? "n/a" : cell.score.toFixed(3),
      cell.costUsd === undefined ? "n/a" : `$${cell.costUsd.toFixed(4)}`,
      cell.latencyMs === undefined ? "n/a" : `${cell.latencyMs}ms`,
      cell.runId ?? "n/a",
    ].join("\t"));
  }
  return lines.join("\n");
}

function shortObjectId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}

function formatTrace(trace: WorkbenchTrace): string {
  const result = asRecord(trace.result);
  const status = typeof result?.status === "string" ? result.status : undefined;
  const score = typeof result?.score === "number" ? result.score.toFixed(3) : undefined;
  const error = typeof result?.error === "string" ? result.error.split(/\r?\n/u)[0] : undefined;
  const files = trace.files.slice(0, 5).map((file) => file.path).join(",");
  return [
    `${trace.id}\trun=${trace.runId}\tjob=${trace.jobId ?? "n/a"}\tversion=${trace.versionId}\tskill=${trace.skillName}\tagent=${trace.agentName}`,
    status ? `status=${status}` : undefined,
    score ? `score=${score}` : undefined,
    error ? `error=${error}` : undefined,
    `files=${trace.files.length}${files ? ` (${files}${trace.files.length > 5 ? ",..." : ""})` : ""}`,
  ].filter(Boolean).join("\t");
}

function traceSummary(trace: WorkbenchTrace): Json {
  const result = asRecord(trace.result);
  return {
    id: trace.id,
    runId: trace.runId,
    ...(trace.jobId ? { jobId: trace.jobId } : {}),
    versionId: trace.versionId,
    skillName: trace.skillName,
    agentName: trace.agentName,
    createdAt: trace.createdAt,
    ...(typeof result?.status === "string" ? { status: result.status } : {}),
    ...(typeof result?.score === "number" ? { score: result.score } : {}),
    ...(typeof result?.error === "string" ? { error: singleLine(result.error) } : {}),
    fileCount: trace.files.length,
    files: trace.files.map(fileSummary),
  };
}

function formatTraceDetail(detail: WorkbenchExecutionTraceDetail): string {
  return detail.executions.map((execution) => {
    const sessionLabels = execution.sessions.map((session) => session.label).join(",");
    return [
      `${execution.id}\trun=${detail.runId}\tjobs=${execution.jobIds.join(",")}\tstatus=${execution.status}`,
      `events=${execution.trace.events.length}`,
      `spans=${execution.trace.spans.length}`,
      `summaries=${execution.trace.summaries.length}`,
      sessionLabels ? `sessions=${sessionLabels}` : undefined,
    ].filter(Boolean).join("\t");
  }).join("\n");
}

function formatArtifact(artifact: WorkbenchArtifact): string {
  return `${artifact.id}\trun=${artifact.runId}\tjob=${artifact.jobId}\t${artifact.kind}\tfiles=${artifact.files.length}`;
}

function artifactSummary(artifact: WorkbenchArtifact): Json {
  return {
    id: artifact.id,
    runId: artifact.runId,
    jobId: artifact.jobId,
    kind: artifact.kind,
    fileCount: artifact.files.length,
    files: artifact.files.map(fileSummary),
  };
}

function fileSummary(file: SurfaceSnapshotFile): Json {
  return {
    path: file.path,
    ...(file.kind ? { kind: file.kind } : {}),
    ...(file.encoding ? { encoding: file.encoding } : {}),
    ...(file.executable !== undefined ? { executable: file.executable } : {}),
    bytes: surfaceFileByteLength(file),
  };
}

function surfaceFileByteLength(file: SurfaceSnapshotFile): number {
  return file.encoding === "base64"
    ? Buffer.byteLength(file.content, "base64")
    : Buffer.byteLength(file.content, "utf8");
}

function formatSession(session: LocalAgentSession): string {
  return `${session.id}\t${session.source}\t${session.updatedAt}\t${session.bytes}b\t${session.path}${session.title ? `\t${session.title}` : ""}`;
}

function formatSessionDetail(session: LocalAgentSessionDetail): string {
  return [
    `${session.id}\t${session.source}\t${session.updatedAt}\t${session.bytes}b`,
    session.path,
    ...(session.title ? [`Title: ${session.title}`] : []),
    ...(session.excerpts.length > 0
      ? ["", ...session.excerpts.map((excerpt, index) => `${index + 1}. ${excerpt}`)]
      : []),
  ].join("\n");
}

function formatShow(value: unknown): string {
  if (isSurfaceFile(value)) {
    return value.content;
  }
  return JSON.stringify(value, null, 2);
}

function isSurfaceFile(value: unknown): value is SurfaceSnapshotFile {
  return Boolean(value && typeof value === "object" && "content" in value && typeof (value as { content?: unknown }).content === "string");
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
