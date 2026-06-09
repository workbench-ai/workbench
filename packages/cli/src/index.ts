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
  createWorkbenchInspectionSnapshot,
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
  setDefaultWorkbenchAgent,
  showWorkbenchCase,
  showWorkbenchRef,
  switchWorkbenchVersion,
  syncWorkbenchRemote,
  workbenchStatus,
  WorkbenchUserError,
  type Json,
  type SurfaceSnapshotFile,
  type WorkbenchAdapterAuthBundle,
  type WorkbenchAdapterAuthFile,
  type WorkbenchAdapterAuthStatusRecord,
  type WorkbenchArtifact,
  type WorkbenchCaseSampleSelection,
  type WorkbenchComparison,
  type WorkbenchJob,
  type WorkbenchProjectState,
  type WorkbenchRun,
  type WorkbenchAgent,
  type WorkbenchTrace,
  type WorkbenchVersion,
} from "@workbench-ai/workbench-core";
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
  "Skill lifecycle:",
  "  workbench init [DIR] [--json]",
  "  workbench status [--dir DIR] [--json]",
  "  workbench check [--dir DIR] [--json]",
  "  workbench versions [--dir DIR] [--json]",
  "  workbench switch VERSION [--dir DIR] [--json]",
  "  workbench diff [A..B] [--dir DIR] [--json]",
  "  workbench sync [REMOTE] [--dir DIR] [--json]",
  "",
  "Evaluate and improve:",
  "  workbench eval [VERSION] [--skill SKILL|all] [--agent AGENT|all] [--samples N] [--rerun] [--json]",
  "  workbench improve [VERSION] [--skill primary] [--agent AGENT] [--budget N] [--samples N] [--json]",
  "  workbench compare [--skills all|LIST] [--agents all|LIST] [--versions all|A..B|LIST] [--json]",
  "  workbench retry RUN_ID [--json]",
  "",
  "Evidence:",
  "  workbench show REF[:PATH] [--json]",
  "  workbench files REF [--json]",
  "  workbench list runs|jobs|traces|artifacts|sessions|remotes [--json]",
  "  workbench trace RUN_ID|JOB_ID|TRACE_ID [--json]",
  "",
  "Configuration and sync:",
  "  workbench agent list|add|show|default|remove ...",
  "  workbench skills list",
  "  workbench case list|add|show|remove ...",
  "  workbench remote add origin URL",
  "  workbench remote list",
  "  workbench auth status [ADAPTER[/SLOT]] [--profile PROFILE] [--json]",
  "  workbench auth connect ADAPTER[/SLOT] [--method METHOD] [--profile PROFILE] [--profile-root DIR] [--local-only] [--json]",
  "  workbench auth disconnect ADAPTER[/SLOT] [--profile PROFILE] [--local-only] [--json]",
  "  workbench login [--base-url URL] [--no-open] [--json]",
  "  workbench logout [--json]",
  "  workbench publish [VERSION] [--visibility private|public] [--json]",
  "  workbench open [--host HOST] [--port PORT] [--no-open] [--json]",
  "",
  "Examples:",
  "  workbench init ./earnings-prep",
  "  workbench eval --agent default --samples 1",
  "  workbench versions",
  "  workbench switch v001",
  "  workbench retry run_000002 --json",
  "  workbench show trace_job_000002:stderr.log",
  "  workbench auth connect codex --method api-key",
  "  workbench publish --visibility public",
  "",
  "Environment:",
  "  CODEX_HOME and CLAUDE_HOME override read-only session discovery roots.",
  "  WORKBENCH_API_URL selects a Workbench Cloud API base URL for login, auth, and HTTP remotes.",
].join("\n");

const COMMAND_HELP: Record<string, string> = {
  auth: [
    "Usage:",
    "  workbench auth status [ADAPTER[/SLOT]] [--profile PROFILE] [--json]",
    "  workbench auth connect ADAPTER[/SLOT] [--method api-key|oauth|bedrock] [--profile PROFILE] [--profile-root DIR] [--local-only] [--json]",
    "  workbench auth disconnect ADAPTER[/SLOT] [--profile PROFILE] [--local-only] [--json]",
    "",
    "Stores adapter credentials locally and uploads them to Workbench Cloud when logged in unless --local-only is passed. Codex supports oauth and api-key. Claude supports oauth, api-key, and bedrock.",
  ].join("\n"),
  eval: [
    "Usage:",
    "  workbench eval [VERSION] [--skill SKILL|all] [--agent AGENT|all] [--samples N] [--rerun] [--json]",
    "",
    "Runs local eval jobs for the selected version, skill, and agent.",
  ].join("\n"),
  improve: [
    "Usage:",
    "  workbench improve [VERSION] [--agent AGENT] [--budget N] [--samples N] [--json]",
    "",
    "Creates an improved child version from evidence and switches to it when it beats the incumbent.",
  ].join("\n"),
  retry: [
    "Usage:",
    "  workbench retry RUN_ID [--json]",
    "",
    "Retries failed jobs from a prior run by replaying only their case/sample pairs locally.",
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
    "  workbench list runs|jobs|traces|artifacts|sessions|remotes [--json]",
    "",
    "Lists Workbench evidence, remotes, or read-only native Codex/Claude session files.",
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
    "  workbench sync [REMOTE] [--json]",
    "",
    "Synchronizes local evidence and version objects with a Workbench remote.",
  ].join("\n"),
  publish: [
    "Usage:",
    "  workbench publish [VERSION] [--visibility private|public] [--json]",
    "",
    "Publishes installable skill source from the selected version to a Workbench source remote.",
  ].join("\n"),
  login: [
    "Usage:",
    "  workbench login [--base-url URL] [--no-open] [--json]",
    "  workbench logout [--json]",
    "",
    "Connects the CLI to Workbench Cloud with the device login flow.",
  ].join("\n"),
};

const BOOLEAN_FLAGS = new Set([
  "help",
  "json",
  "local-only",
  "no-open",
  "rerun",
]);

type FlagKind = "boolean" | "string" | "positive-integer" | "repeat-string";

const FLAG_DEFINITIONS: Record<string, FlagKind> = {
  adapter: "string",
  "base-url": "string",
  budget: "positive-integer",
  dir: "string",
  from: "string",
  help: "boolean",
  host: "string",
  json: "boolean",
  "local-only": "boolean",
  method: "string",
  model: "string",
  "no-open": "boolean",
  port: "positive-integer",
  profile: "string",
  "profile-root": "string",
  rerun: "boolean",
  samples: "positive-integer",
  agent: "string",
  agents: "string",
  skill: "string",
  skills: "string",
  version: "boolean",
  versions: "string",
  visibility: "string",
  with: "repeat-string",
};

const COMMAND_FLAGS: Record<string, readonly string[]> = {
  check: ["dir", "json"],
  compare: ["agents", "dir", "json", "skills", "versions"],
  diff: ["dir", "json"],
  eval: ["agent", "dir", "json", "rerun", "samples", "skill"],
  files: ["dir", "json"],
  improve: ["agent", "budget", "dir", "json", "samples", "skill"],
  init: ["dir", "json"],
  list: ["dir", "json"],
  login: ["base-url", "json", "no-open"],
  logout: ["json"],
  open: ["dir", "host", "json", "no-open", "port"],
  publish: ["dir", "json", "visibility"],
  retry: ["dir", "json"],
  show: ["dir", "json"],
  status: ["dir", "json"],
  switch: ["dir", "json"],
  sync: ["dir", "json"],
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
      add: ["dir", "json"],
      list: ["dir", "json"],
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
    const core = await coreOptions(parsed);
    if (command === "login") {
      return await handleLogin(parsed, io);
    }
    if (command === "logout") {
      return await handleLogout(parsed, io);
    }
    if (command === "init") {
      const status = await initWorkbenchSkill({ dir: parsed.positionals[1] ?? dirFlag(parsed) });
      return output(status, parsed, io, () => `Initialized Workbench skill at ${status.root}.`);
    }
    if (command === "status") {
      const status = await workbenchStatus(core);
      return output(status, parsed, io, () => formatStatus(status));
    }
    if (command === "check") {
      const result = await checkWorkbenchSkill(core);
      return output(result, parsed, io, () => formatCheck(result));
    }
    if (command === "eval") {
      const runs = await evalWorkbenchSkill({
        ...core,
        version: optionalPositional(parsed, 1),
        skill: stringFlag(parsed, "skill"),
        agent: stringFlag(parsed, "agent"),
        samples: intFlag(parsed, "samples"),
        rerun: parsed.flags.rerun === true,
      });
      const code = output(runs, parsed, io, () => runs.map(formatRun).join("\n"));
      return runs.some((run) => run.status === "failed" || run.status === "canceled") ? 1 : code;
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
      return output(result, parsed, io, () => formatImproveResult(result));
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
    if (command === "retry") {
      const runId = requiredPositional(parsed, 1, "workbench retry requires RUN_ID.");
      const snapshot = await createWorkbenchInspectionSnapshot(core);
      const run = snapshot.runs.find((entry) => entry.id === runId);
      if (!run) {
        throw new WorkbenchUserError(`Run not found: ${runId}`);
      }
      const retrySelection = retrySamplesForFailedJobs(snapshot.jobs, run);
      const retry = await evalWorkbenchSkill({
        ...core,
        version: run.versionId,
        skill: run.skillName,
        agent: run.agentName,
        kind: "retry",
        parentRunId: run.id,
        samples: retrySelection.samples,
        selectedSamples: retrySelection.selectedSamples,
      });
      const code = output(retry, parsed, io, () => retry.map(formatRun).join("\n"));
      return retry.some((entry) => entry.status === "failed" || entry.status === "canceled") ? 1 : code;
    }
    if (command === "versions") {
      const versions = await listWorkbenchVersions(core);
      return output(versions, parsed, io, () => versions.map(formatVersion).join("\n") || "No versions.");
    }
    if (command === "switch") {
      const versionRef = requiredPositional(parsed, 1, "workbench switch requires VERSION.");
      const version = await switchWorkbenchVersion(versionRef, core);
      return output(version, parsed, io, () => `Switched to ${version.id}.`);
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
      return output(files, parsed, io, () => files.map((file) => file.path).join("\n") || "No files.");
    }
    if (command === "list") {
      return await handleList(parsed, io);
    }
    if (command === "trace") {
      const ref = requiredPositional(parsed, 1, "workbench trace requires RUN_ID or TRACE_ID.");
      const snapshot = await createWorkbenchInspectionSnapshot(core);
      const run = snapshot.runs.find((entry) => entry.id === ref);
      const job = snapshot.jobs.find((entry) => entry.id === ref);
      const traces = run
        ? snapshot.traces.filter((trace) => run.traceIds.includes(trace.id))
        : job
          ? snapshot.traces.filter((trace) => job.traceIds.includes(trace.id))
        : snapshot.traces.filter((trace) => trace.id === ref);
      if (traces.length === 0) {
        throw new WorkbenchUserError(`Trace not found: ${ref}`);
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
      });
      return output(result, parsed, io, () => `Synced ${result.remote.name}: pushed ${result.pushed}, pulled ${result.pulled}.`);
    }
    if (command === "publish") {
      const result = await publishWorkbenchVersion({
        ...core,
        version: optionalPositional(parsed, 1),
        visibility: parsePublishVisibility(stringFlag(parsed, "visibility")),
      });
      return output(result, parsed, io, () => `Published ${result.version.id} to ${result.installUrl}.`);
    }
    if (command === "auth") {
      return await handleAuth(parsed, io);
    }
    if (command === "open") {
      const snapshot = await createWorkbenchInspectionSnapshot(core);
      if (parsed.flags.json !== true) {
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
        await new Promise(() => {});
      }
      return output(snapshot, parsed, io, () => "Read-only Workbench inspection data is available with --json.");
    }
    throw new WorkbenchUserError(`Unknown command: ${command}\n\n${HELP}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (parsed.flags.json === true) {
      io.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
      return error instanceof WorkbenchUserError ? 2 : 1;
    }
    io.stderr.write(`${message}\n`);
    return error instanceof WorkbenchUserError ? 2 : 1;
  }
}

async function handleList(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const kind = requiredPositional(parsed, 1, "workbench list requires runs|jobs|traces|artifacts|sessions|remotes.");
  if (kind === "sessions") {
    const sessions = await listLocalAgentSessions();
    return output(sessions, parsed, io, () => sessions.map(formatSession).join("\n") || "No local sessions.");
  }
  const snapshot = await createWorkbenchInspectionSnapshot(await coreOptions(parsed));
  if (kind === "runs") {
    return output(snapshot.runs, parsed, io, () => snapshot.runs.map(formatRun).join("\n") || "No runs.");
  }
  if (kind === "jobs") {
    return output(snapshot.jobs, parsed, io, () => snapshot.jobs.map(formatJob).join("\n") || "No jobs.");
  }
  if (kind === "traces") {
    return output(snapshot.traces, parsed, io, () => snapshot.traces.map(formatTrace).join("\n") || "No traces.");
  }
  if (kind === "artifacts") {
    return output(snapshot.artifacts, parsed, io, () => snapshot.artifacts.map(formatArtifact).join("\n") || "No artifacts.");
  }
  if (kind === "remotes") {
    return output(snapshot.remotes, parsed, io, () => snapshot.remotes.map((remote) => `${remote.name}\t${remote.url}`).join("\n") || "No remotes.");
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
      throw new WorkbenchUserError(`Agent not found: ${name}`);
    }
    return output(agent, parsed, io, () => formatAgent(agent));
  }
  if (subcommand === "default") {
    const agent = await setDefaultWorkbenchAgent(requiredPositional(parsed, 2, "workbench agent default requires NAME."), await coreOptions(parsed));
    return output(agent, parsed, io, () => `Default agent: ${agent.name}`);
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
  const snapshot = await createWorkbenchInspectionSnapshot(await coreOptions(parsed));
  return output(snapshot.skillSources, parsed, io, () =>
    snapshot.skillSources.map((source) => {
      const where = source.kind === "remote" ? `${source.from}${source.ref ? `#${source.ref}` : ""}` : source.path;
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
  const subcommand = requiredPositional(parsed, 1, "workbench remote requires add|list.");
  if (subcommand === "add") {
    const remote = await addWorkbenchRemote(
      requiredPositional(parsed, 2, "workbench remote add requires NAME."),
      requiredPositional(parsed, 3, "workbench remote add requires URL."),
      await coreOptions(parsed),
    );
    return output(remote, parsed, io, () => `Added remote ${remote.name}\t${remote.url}`);
  }
  if (subcommand === "list") {
    const remotes = await listWorkbenchRemotes(await coreOptions(parsed));
    return output(remotes, parsed, io, () => remotes.map((remote) => `${remote.name}\t${remote.url}`).join("\n") || "No remotes.");
  }
  throw new WorkbenchUserError(`Unsupported remote command: ${subcommand}`);
}

async function handleAuth(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const subcommand = optionalPositional(parsed, 1) ?? "status";
  if (subcommand === "status") {
    const targetRaw = optionalPositional(parsed, 2);
    const profile = authProfileFlag(parsed);
    const store = localWorkbenchAdapterAuthStore(adapterAuthStoreRoot());
    if (targetRaw) {
      const status = await store.status(parseAuthTarget(targetRaw, profile));
      return output({ ok: true, command: "status", status }, parsed, io, () => formatAuthStatusRecord(status));
    }
    const statuses = await store.listStatus();
    const required = await requiredAgentAuthStatuses(parsed, statuses);
    return output(
      { ok: true, command: "status", adapterStatuses: statuses, required },
      parsed,
      io,
      () => formatAuthStatusList(statuses, required),
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
    return output(
      {
        ok: true,
        command: "connect",
        adapter: saved.adapterId,
        ...(saved.slot ? { slot: saved.slot } : {}),
        profile: saved.profile,
        method: saved.method,
        status: saved.status,
        version: saved.version,
        updatedAt: saved.updatedAt,
        remote,
      },
      parsed,
      io,
      () => `Connected ${formatAuthTarget(saved)} ${saved.method} auth v${saved.version}; remote: ${remote.status}${remote.reason ? ` (${remote.reason})` : ""}.`,
    );
  }
  if (subcommand === "disconnect") {
    const targetRaw = requiredPositional(parsed, 2, "workbench auth disconnect requires ADAPTER[/SLOT].");
    const target = parseAuthTarget(targetRaw, authProfileFlag(parsed));
    await localWorkbenchAdapterAuthStore(adapterAuthStoreRoot()).disconnect(target);
    const remote = await deleteAdapterConnectionRemote(target, parsed);
    return output(
      {
        ok: true,
        command: "disconnect",
        adapter: target.adapterId,
        ...(target.slot ? { slot: target.slot } : {}),
        profile: target.profile,
        status: "disconnected",
        remote,
      },
      parsed,
      io,
      () => `Disconnected ${formatAuthTarget(target)}; remote: ${remote.status}${remote.reason ? ` (${remote.reason})` : ""}.`,
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
    validateFlagValue(name, value);
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

function validateFlagValue(name: string, value: string | boolean | string[]): void {
  const kind = FLAG_DEFINITIONS[name];
  if (!kind) {
    return;
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
}

interface DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
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
  const config = await loadConfig();
  const baseUrl = selectWorkbenchBaseUrl({
    explicitBaseUrl: stringFlag(parsed, "base-url"),
    configBaseUrl: config.baseUrl,
  });
  const authorization = await requestDeviceAuthorization(baseUrl);
  if (parsed.flags.json === true) {
    io.stdout.write(`${JSON.stringify({ ok: true, status: "authorization_pending", ...authorization }, null, 2)}\n`);
  } else {
    io.stdout.write(`Open ${authorization.verification_uri_complete}\nCode: ${authorization.user_code}\n`);
  }
  if (parsed.flags["no-open"] !== true) {
    await openBrowser(authorization.verification_uri_complete).catch(() => undefined);
  }
  const token = await pollDeviceToken(baseUrl, authorization);
  await writeConfig({ schema: CONFIG_SCHEMA, baseUrl, accessToken: token.access_token });
  if (parsed.flags.json === true) {
    io.stdout.write(`${JSON.stringify({ ok: true, baseUrl, expiresIn: token.expires_in ?? null }, null, 2)}\n`);
  } else {
    io.stdout.write(`Workbench API: ${baseUrl}\n`);
  }
  return 0;
}

async function handleLogout(parsed: ParsedArgs, io: CliIo): Promise<number> {
  if (parsed.positionals.length > 1) {
    throw new WorkbenchUserError("workbench logout accepts no positional arguments.");
  }
  const config = await loadConfig();
  const baseUrl = optionalWorkbenchBaseUrl({ configBaseUrl: config.baseUrl });
  if (config.accessToken && !baseUrl) {
    throw new WorkbenchUserError("Missing Workbench API URL. Set WORKBENCH_API_URL or run `workbench login --base-url URL`.");
  }
  if (config.accessToken && baseUrl) {
    await fetch(`${baseUrl}/api/oauth/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: config.accessToken }),
    }).catch(() => undefined);
  }
  await writeConfig({ schema: CONFIG_SCHEMA, ...(baseUrl ? { baseUrl } : {}) });
  return output({ ok: true, ...(baseUrl ? { baseUrl } : {}) }, parsed, io, () => "Logged out of Workbench.");
}

async function loadConfig(): Promise<WorkbenchConfig> {
  const parsed = await readConfigJson(configPath()) ?? {};
  return {
    schema: CONFIG_SCHEMA,
    ...(typeof parsed.baseUrl === "string" ? { baseUrl: normalizeBaseUrl(parsed.baseUrl) } : {}),
    ...(typeof parsed.accessToken === "string" ? { accessToken: parsed.accessToken } : {}),
  };
}

async function workbenchRemoteAuthToken(): Promise<string | undefined> {
  const config = await loadConfig();
  return config.accessToken ?? process.env.WORKBENCH_API_TOKEN?.trim() ?? undefined;
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
  if (!response.ok) {
    throw new WorkbenchUserError(`Device login failed: ${readResponseError(await response.text()) ?? response.statusText}`);
  }
  return await response.json() as DeviceAuthorization;
}

async function pollDeviceToken(baseUrl: string, authorization: DeviceAuthorization): Promise<DeviceToken> {
  const deadline = Date.now() + Math.max(1, authorization.expires_in) * 1000;
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
      throw new WorkbenchUserError(`Device login failed: ${error}`);
    }
    await sleep(intervalMs);
  }
  throw new WorkbenchUserError("Device login timed out before authorization completed.");
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
          ...(config.accessToken ? { authorization: `Bearer ${config.accessToken}` } : {}),
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

async function uploadAdapterConnection(bundle: WorkbenchAdapterAuthBundle, parsed: ParsedArgs): Promise<{ status: string; reason?: string }> {
  if (parsed.flags["local-only"] === true) {
    return { status: "skipped", reason: "local_only" };
  }
  const config = await loadConfig();
  if (!config.accessToken) {
    return { status: "skipped", reason: "not_authenticated" };
  }
  await apiRequest<{ ok: boolean; status: string }>(
    adapterConnectionApiPath(bundle),
    { method: "PUT", body: { bundle } },
  );
  return { status: "connected" };
}

async function deleteAdapterConnectionRemote(target: ReturnType<typeof parseWorkbenchAdapterAuthTarget>, parsed: ParsedArgs): Promise<{ status: string; reason?: string }> {
  if (parsed.flags["local-only"] === true) {
    return { status: "skipped", reason: "local_only" };
  }
  const config = await loadConfig();
  if (!config.accessToken) {
    return { status: "skipped", reason: "not_authenticated" };
  }
  await apiRequest<{ ok: boolean; status: string }>(
    adapterConnectionApiPath(target),
    { method: "DELETE" },
  );
  return { status: "disconnected" };
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

function retrySamplesForFailedJobs(
  jobs: readonly WorkbenchJob[],
  run: WorkbenchRun,
): { samples: number; selectedSamples: WorkbenchCaseSampleSelection[] } {
  if (run.status === "running") {
    throw new WorkbenchUserError(`Run ${run.id} is still running; wait for it to finish before retrying.`);
  }
  const failed = jobs
    .filter((job) => job.runId === run.id && job.status !== "succeeded")
    .map((job) => ({ caseId: job.caseId, sample: job.sample }));
  if (failed.length === 0) {
    throw new WorkbenchUserError(`Run ${run.id} has no failed jobs to retry; use workbench eval to intentionally run it again.`);
  }
  const byKey = new Map<string, WorkbenchCaseSampleSelection>();
  for (const sample of failed) {
    byKey.set(`${sample.caseId}:${sample.sample}`, sample);
  }
  const selectedSamples = [...byKey.values()].sort((left, right) =>
    left.caseId.localeCompare(right.caseId) || left.sample - right.sample
  );
  return {
    samples: Math.max(1, ...selectedSamples.map((entry) => entry.sample + 1)),
    selectedSamples,
  };
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
  const files = await Promise.all(paths.map((entry) => readAuthFile(root, entry)));
  return files.filter((entry): entry is WorkbenchAdapterAuthFile => Boolean(entry));
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
): Promise<Array<{ agent: string; adapter: string; local: WorkbenchAdapterAuthStatusRecord }>> {
  const statusMap = new Map(statuses.map((entry) => [
    `${entry.adapterId}/${entry.slot ?? "_"}/${entry.profile}`,
    entry,
  ]));
  const agents = await listWorkbenchAgents({ dir: dirFlag(parsed) }).catch(() => []);
  return await Promise.all(agents
    .filter((agent) => ["codex", "claude"].includes(agent.adapter.trim().toLowerCase()))
    .map(async (agent) => {
      const target = parseAuthTarget(agent.adapter.trim().toLowerCase(), "default");
      return {
        agent: agent.name,
        adapter: agent.adapter,
        local: statusMap.get(`${target.adapterId}/${target.slot ?? "_"}/${target.profile}`) ??
          await localWorkbenchAdapterAuthStore(adapterAuthStoreRoot()).status(target),
      };
    }));
}

function formatAuthStatusRecord(status: WorkbenchAdapterAuthStatusRecord): string {
  return `${formatAuthTarget(status)}\t${status.status}${status.method ? `\t${status.method}` : ""}${status.reason ? `\t${status.reason}` : ""}`;
}

function formatAuthStatusList(
  statuses: readonly WorkbenchAdapterAuthStatusRecord[],
  required: readonly { agent: string; adapter: string; local: WorkbenchAdapterAuthStatusRecord }[],
): string {
  const lines = [
    ...(statuses.length > 0
      ? ["Adapter auth:", ...statuses.map(formatAuthStatusRecord)]
      : ["No local adapter auth records."]),
    ...(required.length > 0
      ? ["", "Required by agents:", ...required.map((entry) => `${entry.agent}\t${entry.adapter}\t${entry.local.status}${entry.local.method ? `\t${entry.local.method}` : ""}`)]
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
    throw new WorkbenchUserError(`Session not found: ${ref}`);
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
  flags[name] = value;
}

function dirFlag(parsed: ParsedArgs): string | undefined {
  return stringFlag(parsed, "dir");
}

async function coreOptions(parsed: ParsedArgs): Promise<{ dir?: string; authToken?: string }> {
  return {
    dir: dirFlag(parsed),
    authToken: await workbenchRemoteAuthToken(),
  };
}

function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : undefined;
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

function parsePublishVisibility(value: string | undefined): "private" | "public" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "private" || value === "public") {
    return value;
  }
  throw new WorkbenchUserError("workbench publish --visibility must be private or public.");
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

function output(value: unknown, parsed: ParsedArgs, io: CliIo, text: () => string): number {
  if (parsed.flags.json === true) {
    io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    io.stdout.write(`${text()}\n`);
  }
  return 0;
}

function formatStatus(status: Awaited<ReturnType<typeof workbenchStatus>>): string {
  if (!status.initialized) {
    return `Workbench: not initialized\nRoot: ${status.root}`;
  }
  return [
    `Root: ${status.root}`,
    `Current version: ${status.currentVersionId ?? "none"}`,
    `Unversioned changes: ${status.hasUnversionedChanges ? "yes" : "no"}`,
    `Default skill: ${status.defaultSkill ?? "none"}`,
    `Default agent: ${status.defaultAgent ?? "none"}`,
    `Versions: ${status.versionCount}`,
    `Skills: ${status.skillCount}`,
    `Agents: ${status.agentCount}`,
    `Runs: ${status.runCount}`,
    `Remotes: ${status.remoteCount}`,
    ...(status.pendingSyncCount ? [`Pending sync: ${status.pendingSyncCount}`] : []),
    ...(status.lastScore !== undefined ? [`Last score: ${status.lastScore}`] : []),
    ...(status.automationReadiness ? [`Automation readiness: ${status.automationReadiness.label} - ${status.automationReadiness.reason}`] : []),
  ].join("\n");
}

function formatCheck(result: Awaited<ReturnType<typeof checkWorkbenchSkill>>): string {
  return [
    "Workbench skill is valid.",
    `Cases: ${result.cases} (${result.plan.source.smokeCaseCount} smoke)`,
    `Skills: ${result.skills}`,
    `Agents: ${result.agents}`,
    `Skill files: ${result.plan.source.skillFiles}`,
    `Eval files: ${result.plan.source.evalFiles}`,
    `Readiness: ${result.plan.readiness.label} - ${result.plan.readiness.reason}`,
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

function formatJob(job: { id: string; runId: string; status: string; caseId: string; sample: number; score?: number; durationMs?: number }): string {
  const score = job.score === undefined ? "n/a" : job.score.toFixed(3);
  const duration = job.durationMs === undefined ? "n/a" : `${job.durationMs}ms`;
  return `${job.id}\trun=${job.runId}\tcase=${job.caseId}\tsample=${job.sample}\t${job.status}\tscore=${score}\tduration=${duration}`;
}

function formatComparison(comparison: WorkbenchComparison): string {
  const lines = ["version\tskill\tagent\tscore\treadiness\tcost\tlatency\trun"];
  for (const cell of comparison.cells) {
    lines.push([
      cell.versionId,
      cell.skillName,
      cell.agentName,
      cell.score === undefined ? "n/a" : cell.score.toFixed(3),
      cell.automationReadiness?.label ?? "n/a",
      cell.costUsd === undefined ? "n/a" : `$${cell.costUsd.toFixed(4)}`,
      cell.latencyMs === undefined ? "n/a" : `${cell.latencyMs}ms`,
      cell.runId ?? "n/a",
    ].join("\t"));
  }
  return lines.join("\n");
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

function formatArtifact(artifact: WorkbenchArtifact): string {
  return `${artifact.id}\trun=${artifact.runId}\tjob=${artifact.jobId}\t${artifact.kind}\tfiles=${artifact.files.length}`;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
