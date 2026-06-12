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
  compareWorkbench,
  createWorkbenchAdapterAuthBundle,
  createWorkbenchReadOnlyInspectionSnapshot,
  diffWorkbenchVersions,
  evalWorkbenchSkill,
  improveWorkbenchSkill,
  initWorkbenchSkill,
  listWorkbenchCases,
  listWorkbenchAgents,
  listWorkbenchVersions,
  localWorkbenchAdapterAuthStore,
  parseWorkbenchAdapterAuthTarget,
  publishWorkbenchVersion,
  removeWorkbenchCase,
  removeWorkbenchAgent,
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
  type WorkbenchRemote,
  type WorkbenchTrace,
  type WorkbenchVersion,
} from "@workbench-ai/workbench-core";
import { normalizeWorkbenchSkillName } from "@workbench-ai/workbench-contract";
import { emitError, emitResult } from "./output.js";
import {
  installSnapshotToTargets,
  installTargetsToJson,
  normalizeInstallSnapshotPath,
  resolveInstallTargets,
  supportedInstallTargets,
  type WorkbenchInstallTargetName,
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

interface WorkbenchSkillHandle {
  owner: string;
  skill: string;
}

const require = createRequire(import.meta.url);

const HELP = [
  "Usage:",
  "  workbench [--json]",
  "  workbench <command> [options]",
  "",
  "Bare workbench prints project status and the next useful command.",
  "",
  "Taught commands:",
  "  workbench new [DIR] [--json]",
  "  workbench eval [VERSION] [--skills all|LIST] [--agents all|LIST] [-n N|--samples N] [--rerun] [--cloud] [--json]",
  "  workbench improve [VERSION] [--skills LIST] [--agents LIST] [--budget N] [-n N|--samples N] [--cloud] [--json]",
  "  workbench compare [--skills all|LIST] [--agents all|LIST] [--versions all|A..B|LIST] [--json]",
  "  workbench publish [VERSION] [--as OWNER/SKILL] [--private|--team|--public] [--dry-run] [--json]",
  "  workbench install HANDLE_OR_URL [--to codex|claude|local]... [--yes] [--list] [--dry-run] [--json]",
  "",
  "More:",
  "  workbench help --all",
].join("\n");

const HELP_ALL = [
  "Usage:",
  "  workbench                          # = workbench status",
  "  workbench new [DIR] [--json]",
  "  workbench eval [VERSION] [--skills all|LIST] [--agents all|LIST] [-n N|--samples N] [--rerun] [--cloud] [--json]",
  "  workbench compare [--skills all|LIST] [--agents all|LIST] [--versions all|A..B|LIST] [--json]",
  "  workbench improve [VERSION] [--skills LIST] [--agents LIST] [--budget N] [-n N|--samples N] [--cloud] [--json]",
  "  workbench publish [VERSION] [--as OWNER/SKILL] [--private|--team|--public] [--dry-run] [--json]",
  "  workbench install HANDLE_OR_URL [--to codex|claude|local]... [--yes] [--list] [--dry-run] [--json]",
  "",
  "Inspect:",
  "  workbench status [--dir DIR] [--json]",
  "  workbench log [--runs|--versions] [--json]",
  "  workbench show REF[:PATH] [--json]",
  "  workbench diff [A..B] [--json]",
  "  workbench switch VERSION [--json]",
  "  workbench open [--host HOST] [--port PORT] [--no-open] [--json]",
  "",
  "Configure:",
  "  workbench case add [RUN_ID] | list | rm ID [--json]",
  "  workbench agent add NAME --adapter X [--model M] [--with k=v]... | list | rm NAME [--json]",
  "",
  "Share and auth:",
  "  workbench login [PROVIDER] [--method METHOD] [--profile P] [--base-url URL] [--start-only|--wait] [--timeout N] [--no-open] [--local-only] [--json]",
  "  workbench logout [PROVIDER] [--json]",
  "  workbench sync [REMOTE] [--dry-run] [--json]",
  "",
  "Remote URLs:",
  "  https://HOST/skills/OWNER/SKILL  Workbench Cloud skill remote",
  "  file:///absolute/path            local file remote for plumbing sync",
].join("\n");

const COMMAND_HELP: Record<string, string> = {
  new: [
    "Usage:",
    "  workbench new [DIR] [--json]",
    "",
    "Creates a Workbench skill project.",
  ].join("\n"),
  eval: [
    "Usage:",
    "  workbench eval [VERSION] [--skills all|LIST] [--agents all|LIST] [-n N|--samples N] [--rerun] [--cloud] [--json]",
    "",
    "Runs eval jobs for the selected version, measured skills, and agents. Omitted selectors use manifest defaults.",
  ].join("\n"),
  improve: [
    "Usage:",
    "  workbench improve [VERSION] [--skills LIST] [--agents LIST] [--budget N] [-n N|--samples N] [--cloud] [--json]",
    "",
    "Creates one improved child version from evidence. The selected skills and agents must resolve to exactly one entry each.",
  ].join("\n"),
  compare: [
    "Usage:",
    "  workbench compare [--skills all|LIST] [--agents all|LIST] [--versions all|A..B|LIST] [--json]",
    "",
    "Compares recorded eval evidence across selected skills, agents, and versions.",
  ].join("\n"),
  install: [
    "Usage:",
    "  workbench install HANDLE_OR_URL [--to codex|claude|local]... [--yes] [--list] [--dry-run] [--json]",
    "",
    "Installs published Workbench Cloud source into local agent targets.",
    "",
    "Example:",
    "  workbench install acme/earnings-prep --to codex --yes",
  ].join("\n"),
  status: [
    "Usage:",
    "  workbench status [--dir DIR] [--json]",
    "",
    "Reports project, worktree, run, per-remote sync/publication, and auth state. --json emits the workbench.status.v1 dashboard.",
  ].join("\n"),
  logout: [
    "Usage:",
    "  workbench logout [PROVIDER] [--json]",
    "",
    "With no provider, logs out of Workbench Cloud. With a provider such as codex or claude, removes local adapter auth.",
  ].join("\n"),
  show: [
    "Usage:",
    "  workbench show REF [--json]",
    "  workbench show REF:PATH [--json]",
    "",
    "Shows a Workbench object, lists files for file-backed objects, or prints one file.",
  ].join("\n"),
  log: [
    "Usage:",
    "  workbench log [--runs|--versions] [--json]",
    "",
    "Shows one reverse-chronological timeline of versions and runs.",
  ].join("\n"),
  diff: [
    "Usage:",
    "  workbench diff [A..B] [--json]",
    "",
    "Shows changed files between two Workbench source versions.",
  ].join("\n"),
  switch: [
    "Usage:",
    "  workbench switch VERSION [--json]",
    "",
    "Switches the working skill source to a recorded Workbench version.",
  ].join("\n"),
  open: [
    "Usage:",
    "  workbench open [--host HOST] [--port PORT] [--no-open] [--json]",
    "",
    "Serves or emits the read-only Workbench inspection snapshot.",
  ].join("\n"),
  case: [
    "Usage:",
    "  workbench case list [--json]",
    "  workbench case add [RUN_ID] [--json]",
    "  workbench case rm ID [--json]",
    "",
    "Lists cases, creates a draft case, or removes a case.",
  ].join("\n"),
  agent: [
    "Usage:",
    "  workbench agent list [--json]",
    "  workbench agent add NAME --adapter X [--model M] [--with k=v]... [--json]",
    "  workbench agent rm NAME [--json]",
    "",
    "Lists, adds, or removes eval agent configurations.",
  ].join("\n"),
  sync: [
    "Usage:",
    "  workbench sync [REMOTE] [--dry-run] [--dir DIR] [--json]",
    "",
    "Plumbing command: synchronizes local evidence and version objects with a Workbench remote.",
  ].join("\n"),
  publish: [
    "Usage:",
    "  workbench publish [VERSION] [--as OWNER/SKILL] [--private|--team|--public] [--dry-run] [--dir DIR] [--json]",
    "",
    "Publishes installable skill source to Workbench Cloud. --as sets the linked OWNER/SKILL handle.",
  ].join("\n"),
  login: [
    "Usage:",
    "  workbench login [PROVIDER] [--method METHOD] [--profile P] [--base-url URL] [--start-only|--wait] [--timeout N] [--no-open] [--local-only] [--json]",
    "  workbench logout [PROVIDER] [--json]",
    "",
    "Connects the CLI to Workbench Cloud or captures local adapter auth for a provider.",
  ].join("\n"),
};

type FlagKind = "boolean" | "string" | "positive-integer" | "repeat-string";

type FlagSpec = Readonly<Record<string, FlagKind>>;

const COMMON_FLAGS = {
  json: "boolean",
} as const satisfies FlagSpec;

const PROJECT_FLAGS = {
  ...COMMON_FLAGS,
  dir: "string",
} as const satisfies FlagSpec;

const HELP_FLAG = {
  help: "boolean",
} as const satisfies FlagSpec;

const VERSION_FLAG = {
  version: "boolean",
} as const satisfies FlagSpec;

const COMMAND_FLAGS: Record<string, FlagSpec> = {
  compare: { ...PROJECT_FLAGS, ...HELP_FLAG, agents: "string", skills: "string", versions: "string" },
  diff: { ...PROJECT_FLAGS, ...HELP_FLAG },
  eval: {
    ...PROJECT_FLAGS,
    ...HELP_FLAG,
    agents: "string",
    cloud: "boolean",
    rerun: "boolean",
    samples: "positive-integer",
    skills: "string",
  },
  help: { ...COMMON_FLAGS, ...HELP_FLAG, all: "boolean" },
  improve: {
    ...PROJECT_FLAGS,
    ...HELP_FLAG,
    agents: "string",
    budget: "positive-integer",
    cloud: "boolean",
    samples: "positive-integer",
    skills: "string",
  },
  install: { ...COMMON_FLAGS, ...HELP_FLAG, "dry-run": "boolean", list: "boolean", to: "repeat-string", yes: "boolean" },
  log: { ...PROJECT_FLAGS, ...HELP_FLAG, runs: "boolean", versions: "boolean" },
  login: {
    ...COMMON_FLAGS,
    ...HELP_FLAG,
    "base-url": "string",
    "local-only": "boolean",
    method: "string",
    "no-open": "boolean",
    profile: "string",
    "profile-root": "string",
    "start-only": "boolean",
    timeout: "positive-integer",
    wait: "boolean",
  },
  logout: { ...COMMON_FLAGS, ...HELP_FLAG },
  new: { ...PROJECT_FLAGS, ...HELP_FLAG },
  open: { ...PROJECT_FLAGS, ...HELP_FLAG, host: "string", "no-open": "boolean", port: "positive-integer" },
  publish: {
    ...PROJECT_FLAGS,
    ...HELP_FLAG,
    as: "string",
    "dry-run": "boolean",
    private: "boolean",
    public: "boolean",
    team: "boolean",
  },
  show: { ...PROJECT_FLAGS, ...HELP_FLAG },
  status: { ...PROJECT_FLAGS, ...HELP_FLAG },
  switch: { ...PROJECT_FLAGS, ...HELP_FLAG },
  sync: { ...PROJECT_FLAGS, ...HELP_FLAG, "dry-run": "boolean" },
  version: { ...COMMON_FLAGS, ...VERSION_FLAG },
};

interface SubcommandFlagSpec {
  defaultSubcommand?: string;
  flags: Record<string, FlagSpec>;
}

const SUBCOMMAND_FLAGS: Record<string, SubcommandFlagSpec> = {
  case: {
    flags: {
      list: { ...PROJECT_FLAGS, ...HELP_FLAG },
      add: { ...PROJECT_FLAGS, ...HELP_FLAG },
      rm: { ...PROJECT_FLAGS, ...HELP_FLAG },
    },
  },
  agent: {
    flags: {
      list: { ...PROJECT_FLAGS, ...HELP_FLAG },
      add: { ...PROJECT_FLAGS, ...HELP_FLAG, adapter: "string", model: "string", with: "repeat-string" },
      rm: { ...PROJECT_FLAGS, ...HELP_FLAG },
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
    validateCommandFlags(parsed, command);
    if (command === "version" || parsed.flags.version === true) {
      io.stdout.write(`workbench ${getCliVersion()}\n`);
      return 0;
    }
    if (command === "help") {
      const helpCommand = command === "help" ? optionalPositional(parsed, 1) : undefined;
      io.stdout.write(`${parsed.flags.all === true ? HELP_ALL : helpCommand ? commandHelp(helpCommand) : HELP}\n`);
      return 0;
    }
    if (parsed.flags.help === true) {
      io.stdout.write(`${command ? commandHelp(command) : HELP}\n`);
      return 0;
    }
    if (!command) {
      return await handleStatus(parsed, io);
    }
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
    if (command === "new") {
      const status = await initWorkbenchSkill({ dir: parsed.positionals[1] ?? dirFlag(parsed) });
      return output(status, parsed, io, () => `Created Workbench skill at ${status.root}.\nnext: edit SKILL.md, then run workbench eval`);
    }
    if (command === "status") {
      return await handleStatus(parsed, io);
    }
    if (command === "eval") {
      if (parsed.flags.cloud === true) {
        return await handleCloudEval(parsed, io);
      }
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
      const deltas = await evalDeltas(core, runs);
      const nextCommands = evalSuccessNextCommands(runs);
      return emitResult("workbench.cli.eval.v1", {
        result: runs.map((run) => runSummary(run, artifactIds.get(run.id) ?? [])),
        deltas: deltas as unknown as Json,
        nextCommands: nextCommands as unknown as Json,
      }, parsed, io, () => [
        runs.map(formatRun).join("\n"),
        ...deltas.map(formatEvalDelta),
        ...(nextCommands[0] ? [`next: ${nextCommands[0]}`] : []),
      ].filter(Boolean).join("\n"));
    }
    if (command === "improve") {
      if (parsed.flags.cloud === true) {
        return await handleCloudImprove(parsed, io);
      }
      const result = await improveWorkbenchSkill({
        ...core,
        version: optionalPositional(parsed, 1),
        skill: stringFlag(parsed, "skills"),
        agent: stringFlag(parsed, "agents"),
        budget: intFlag(parsed, "budget"),
        samples: intFlag(parsed, "samples"),
      });
      return output({
        ...result,
        version: versionSummary(result.version),
      } as unknown as Json, parsed, io, () => `${formatImproveResult(result)}\nnext: workbench eval`);
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
    if (command === "switch") {
      const versionRef = requiredPositional(parsed, 1, "workbench switch requires VERSION.");
      const version = await switchWorkbenchVersion(versionRef, core);
      return output(versionSummary(version), parsed, io, () => `Switched to ${version.id}.`);
    }
    if (command === "diff") {
      const range = optionalPositional(parsed, 1) ?? await defaultDiffRange(core);
      const diffs = await diffWorkbenchVersions(range, core);
      return output(diffs, parsed, io, () => diffs.map((entry) => `${entry.status}\t${entry.path}`).join("\n") || "No diff.");
    }
    if (command === "show") {
      return await handleShow(parsed, io);
    }
    if (command === "log") {
      return await handleLog(parsed, io);
    }
    if (command === "agent") {
      return await handleAgent(parsed, io);
    }
    if (command === "case") {
      return await handleCase(parsed, io);
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
      const preview = parsed.flags["dry-run"] === true && !stringFlag(parsed, "as")
        ? await previewPublishWithDerivedRemote(parsed)
        : undefined;
      if (preview) {
        return emitResult("workbench.cli.publish.v1", {
          remote: preview.remote as unknown as Json,
          version: versionSummary(preview.version),
          visibility: preview.visibility,
          installHandle: preview.installHandle,
          installUrl: preview.installUrl,
          pinnedInstallUrl: preview.pinnedInstallUrl,
          dryRun: true,
        }, parsed, io, () => [
          `Would publish ${preview.version.id} to remote ${preview.remote.name}.`,
          `Visibility: ${preview.visibility}`,
          `Install: ${preview.installUrl}`,
          `Pinned: ${preview.pinnedInstallUrl}`,
          `next: workbench install ${preview.installHandle}`,
        ].join("\n"));
      }
      const remote = await ensurePublishRemote(parsed);
      const result = await publishWorkbenchVersion({
        ...core,
        version: optionalPositional(parsed, 1),
        remote,
        dryRun: parsed.flags["dry-run"] === true,
        visibility: parsePublishVisibilityFlags(parsed),
      });
      return emitResult("workbench.cli.publish.v1", {
        remote: result.remote as unknown as Json,
        version: versionSummary(result.version),
        visibility: result.visibility,
        installHandle: result.installHandle,
        installUrl: result.installUrl,
        pinnedInstallUrl: result.pinnedInstallUrl,
        ...(result.dryRun ? { dryRun: true } : {}),
      }, parsed, io, () => [
        `${result.dryRun ? "Would publish" : "Published"} ${result.version.id} to remote ${result.remote.name}.`,
        `Visibility: ${result.visibility}`,
        `Install: ${result.installUrl}`,
        `Pinned: ${result.pinnedInstallUrl}`,
        `next: workbench install ${result.installHandle}`,
      ].join("\n"));
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

async function handleStatus(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const status = await workbenchStatusSnapshot(await coreOptions(parsed));
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

async function handleLog(parsed: ParsedArgs, io: CliIo): Promise<number> {
  if (parsed.flags.runs === true && parsed.flags.versions === true) {
    throw new WorkbenchCodedError("usage", "workbench log accepts only one of --runs or --versions.", {
      remediation: "Run workbench log --runs or workbench log --versions.",
      exitCode: 2,
    });
  }
  if (parsed.positionals.length > 1) {
    if (parsed.flags.runs === true) {
      throw new WorkbenchUserError("--runs does not accept a value.");
    }
    if (parsed.flags.versions === true) {
      throw new WorkbenchUserError("--versions does not accept a value.");
    }
    rejectExtraInput(parsed, {
      maxPositionals: 1,
      message: "workbench log does not accept refs or paths.",
      remediation: "Run workbench log, workbench log --runs, or workbench log --versions.",
    });
  }
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(await coreOptions(parsed));
  const includeRuns = parsed.flags.versions !== true;
  const includeVersions = parsed.flags.runs !== true;
  const entries: WorkbenchLogEntry[] = [
    ...(includeVersions ? snapshot.versions.map((version) => ({
      kind: "version" as const,
      id: version.id,
      createdAt: version.createdAt,
      message: version.message,
      fileCount: version.files.length,
    })) : []),
    ...(includeRuns ? snapshot.runs.map((run) => ({
      kind: "run" as const,
      id: run.id,
      createdAt: run.createdAt,
      status: run.status,
      versionId: run.versionId,
      skillName: run.skillName,
      agentName: run.agentName,
      ...(run.score !== undefined ? { score: run.score } : {}),
    })) : []),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return emitResult("workbench.cli.log.v1", {
    entries: entries as unknown as Json,
  }, parsed, io, () => entries.map(formatLogEntry).join("\n") || "No history.");
}

type WorkbenchLogEntry =
  | { kind: "version"; id: string; createdAt: string; message: string; fileCount: number }
  | { kind: "run"; id: string; createdAt: string; status: string; versionId: string; skillName: string; agentName: string; score?: number };

async function handleShow(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const ref = requiredPositional(parsed, 1, "workbench show requires REF.");
  const session = await showLocalAgentSession(ref);
  if (session) {
    return output(session, parsed, io, () => formatSessionDetail(session));
  }
  const core = await coreOptions(parsed);
  const [objectRef, requestedPath] = splitShowRef(ref);
  if (requestedPath) {
    const runOrJobFile = await fileForRunOrJobRef(core, objectRef, requestedPath);
    if (runOrJobFile) {
      return output(runOrJobFile, parsed, io, () => formatShow(runOrJobFile));
    }
    const value = await showWorkbenchRef(ref, core);
    return output(value, parsed, io, () => formatShow(value));
  }
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const version = snapshot.versions.find((entry) => entry.id === objectRef);
  if (version) {
    return output(fileListing("version", version.id, version.files), parsed, io, () => formatFileListing("version", version.id, version.files));
  }
  const trace = snapshot.traces.find((entry) => entry.id === objectRef);
  if (trace) {
    return output(fileListing("trace", trace.id, trace.files), parsed, io, () => formatFileListing("trace", trace.id, trace.files));
  }
  const artifact = snapshot.artifacts.find((entry) => entry.id === objectRef);
  if (artifact) {
    return output(fileListing("artifact", artifact.id, artifact.files), parsed, io, () => formatFileListing("artifact", artifact.id, artifact.files));
  }
  const details = evidenceDetailsForRunOrJob(snapshot, objectRef);
  if (details.length > 0) {
    return output(details, parsed, io, () => details.map(formatTraceDetail).join("\n"));
  }
  const value = await showWorkbenchRef(ref, core);
  return output(value, parsed, io, () => formatShow(value));
}

async function handleAgent(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const subcommand = requiredPositional(parsed, 1, "workbench agent requires list|add|rm.");
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
  if (subcommand === "rm") {
    const result = await removeWorkbenchAgent(requiredPositional(parsed, 2, "workbench agent rm requires NAME."), await coreOptions(parsed));
    return output(result, parsed, io, () => `Removed agent ${result.removed}.`);
  }
  throw new WorkbenchUserError(`Unsupported agent command: ${subcommand}`);
}

async function handleCase(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const subcommand = requiredPositional(parsed, 1, "workbench case requires list|add|rm.");
  if (subcommand === "list") {
    const cases = await listWorkbenchCases(await coreOptions(parsed));
    return output(cases, parsed, io, () => cases.map((entry) => `${entry.id}\t${entry.path}`).join("\n") || "No cases.");
  }
  if (subcommand === "add") {
    const core = await coreOptions(parsed);
    const sourceRef = optionalPositional(parsed, 2);
    const record = await addWorkbenchCase({ ...core, fromTraceId: sourceRef ? await traceIdForCaseSource(core, sourceRef) : undefined });
    return output(record, parsed, io, () => `Added case ${record.id}.`);
  }
  if (subcommand === "rm") {
    const result = await removeWorkbenchCase(requiredPositional(parsed, 2, "workbench case rm requires CASE_ID."), await coreOptions(parsed));
    return output(result, parsed, io, () => `Removed case ${result.removed}.`);
  }
  throw new WorkbenchUserError(`Unsupported case command: ${subcommand}`);
}

async function handleAdapterLogin(provider: string, parsed: ParsedArgs, io: CliIo): Promise<number> {
  const target = parseAuthTarget(provider, authProfileFlag(parsed));
  const method = authMethod(parsed, target.adapterId);
  const bundle = await collectAdapterAuthBundle({
    target,
    method,
    profileRoot: path.resolve(stringFlag(parsed, "profile-root") ?? os.homedir()),
  });
  const saved = await localWorkbenchAdapterAuthStore(adapterAuthStoreRoot()).put(bundle);
  const remote = await uploadAdapterConnection(saved, parsed);
  return emitResult(
    "workbench.cli.login.v1",
    {
      provider: saved.adapterId,
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

async function handleAdapterLogout(provider: string, parsed: ParsedArgs, io: CliIo): Promise<number> {
  const target = parseAuthTarget(provider, authProfileFlag(parsed));
  await localWorkbenchAdapterAuthStore(adapterAuthStoreRoot()).disconnect(target);
  const remote = await deleteAdapterConnectionRemote(target, parsed);
  return emitResult(
    "workbench.cli.logout.v1",
    {
      provider: target.adapterId,
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

function getCliVersion(): string {
  const manifest = require("../package.json") as { version?: unknown };
  return typeof manifest.version === "string" ? manifest.version : "unknown";
}

function commandHelp(command: string): string {
  return COMMAND_HELP[command] ?? HELP;
}

function validateCommandFlags(parsed: ParsedArgs, command: string | undefined): void {
  const effectiveCommand = command ?? (parsed.flags.version === true ? "version" : "status");
  const allowed = allowedFlagsForCommand(parsed, effectiveCommand);
  if (!allowed) {
    return;
  }
  const allowedSet = new Set(Object.keys(allowed));
  for (const [name, value] of Object.entries(parsed.flags)) {
    if (!allowedSet.has(name)) {
      throw new WorkbenchUserError(`Unsupported flag --${name} for workbench ${effectiveCommand}.`);
    }
    validateFlagValue(name, value, allowed[name]);
  }
}

function allowedFlagsForCommand(parsed: ParsedArgs, command: string): FlagSpec | undefined {
  const subcommands = SUBCOMMAND_FLAGS[command];
  if (!subcommands) {
    return COMMAND_FLAGS[command];
  }
  const subcommand = parsed.positionals[1] ?? subcommands.defaultSubcommand;
  return subcommand ? subcommands.flags[subcommand] ?? { ...COMMON_FLAGS, ...HELP_FLAG } : { ...COMMON_FLAGS, ...HELP_FLAG };
}

function validateFlagValue(
  name: string,
  value: string | boolean | string[],
  kind: FlagKind | undefined,
): void {
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
const DEFAULT_WORKBENCH_CLOUD_BASE_URL = "https://v2.workbench.ai";
const API_REQUEST_MAX_ATTEMPTS = 3;
const API_REQUEST_GZIP_THRESHOLD_BYTES = 1024 * 1024;
const CLOUD_RUN_TIMEOUT_MS = 30 * 60 * 1000;
const CLOUD_RUN_POLL_INTERVAL_MS = 3000;

interface WorkbenchConfig {
  schema: typeof CONFIG_SCHEMA;
  baseUrl?: string;
  accessToken?: string;
  username?: string;
  installTargets?: WorkbenchInstallTargetName[];
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
  const provider = optionalPositional(parsed, 1);
  if (provider) {
    if (parsed.positionals.length > 2) {
      throw new WorkbenchUserError("workbench login PROVIDER accepts only one provider argument.");
    }
    if (parsed.flags["start-only"] === true || parsed.flags.wait === true || parsed.flags.timeout !== undefined || parsed.flags["no-open"] === true) {
      throw new WorkbenchCodedError("usage", "Workbench Cloud login flags do not apply to provider login.", {
        remediation: `Run workbench login ${provider} --method ${authMethod(parsed, provider)}.`,
        exitCode: 2,
      });
    }
    return await handleAdapterLogin(provider, parsed, io);
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
  const provider = optionalPositional(parsed, 1);
  if (provider) {
    if (parsed.positionals.length > 2) {
      throw new WorkbenchUserError("workbench logout PROVIDER accepts only one provider argument.");
    }
    return await handleAdapterLogout(provider, parsed, io);
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
      ? "Local adapter auth records were retained; run workbench logout PROVIDER to remove them."
      : "No local adapter auth records remain.",
  ].join("\n"));
}

async function handleInstall(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const sourceInput = requiredPositional(parsed, 1, "workbench install requires HANDLE_OR_URL.");
  rejectExtraInput(parsed, {
    maxPositionals: 2,
    message: "workbench install accepts one HANDLE_OR_URL argument.",
    remediation: "Run workbench install OWNER/SKILL --to codex.",
  });
  const source = await resolveWorkbenchInstallSourceInput(sourceInput);
  const workbenchSource = parseWorkbenchInstallSource(source);
  if (!workbenchSource) {
    throw new WorkbenchCodedError("usage", "workbench install requires a Workbench Cloud source URL.", {
      remediation: "Run workbench install OWNER/SKILL --to codex.",
      exitCode: 2,
    });
  }
  const snapshot = await fetchWorkbenchInstallSourceSnapshot(workbenchSource, source);
  const sourceSummary = workbenchInstallSourceSummary(workbenchSource, snapshot);
  const config = await loadConfig();
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
  const toTargets = stringsFlag(parsed, "to");
  const selectedTargets = toTargets.length > 0 ? normalizeInstallTargetNames(toTargets) : await defaultInstallTargetNames(config);
  const targets = resolveInstallTargets({
    agents: selectedTargets.filter((target) => target !== "local"),
    local: selectedTargets.some((target) => target === "local"),
    skillName: snapshot.name,
  });
  const result = await installSnapshotToTargets({
    snapshot,
    targets,
    overwrite: parsed.flags.yes === true,
    dryRun: parsed.flags["dry-run"] === true,
  });
  if (toTargets.length > 0 && parsed.flags["dry-run"] !== true) {
    await writeConfig({ ...config, installTargets: selectedTargets });
  }
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

async function handleCloudEval(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const started = await startCloudExecution("eval", parsed);
  const artifactIds = await artifactIdsByRunId(started.core, started.runs);
  const failedRuns = started.runs.filter((run) => run.status === "failed" || run.status === "canceled");
  if (failedRuns.length > 0) {
    return emitEvalFailure(started.runs, failedRuns, artifactIds, parsed, io);
  }
  const deltas = await evalDeltas(started.core, started.runs);
  const nextCommands = cloudEvalNextCommands(started.runs);
  return emitResult("workbench.cli.eval.v1", {
    result: started.runs.map((run) => runSummary(run, artifactIds.get(run.id) ?? [])),
    deltas: deltas as unknown as Json,
    nextCommands: nextCommands as unknown as Json,
    cloud: cloudExecutionSummary(started),
  }, parsed, io, () => [
    `Completed hosted eval on ${started.remote.url}.`,
    started.runs.map(formatRun).join("\n"),
    ...deltas.map(formatEvalDelta),
    ...(nextCommands[0] ? [`next: ${nextCommands[0]}`] : []),
  ].filter(Boolean).join("\n"));
}

async function handleCloudImprove(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const started = await startCloudExecution("improve", parsed);
  const artifactIds = await artifactIdsByRunId(started.core, started.runs);
  const failedRuns = started.runs.filter((run) => run.status === "failed" || run.status === "canceled");
  if (failedRuns.length > 0) {
    const first = failedRuns[0]!;
    throw new WorkbenchCodedError("improve_failed", "Hosted improve failed; evidence was saved.", {
      remediation: `Run workbench show ${first.id}.`,
      subject: {
        runIds: failedRuns.map((run) => run.id),
        statuses: Object.fromEntries(failedRuns.map((run) => [run.id, run.status])),
      },
      exitCode: 1,
    });
  }
  const switchedVersionId = await switchHostedImproveVersionIfPromoted(started);
  const nextCommands = cloudImproveNextCommands(started.runs);
  return emitResult("workbench.cli.improve.v1", {
    result: started.runs.map((run) => runSummary(run, artifactIds.get(run.id) ?? [])),
    nextCommands: nextCommands as unknown as Json,
    cloud: cloudExecutionSummary(started),
    ...(switchedVersionId ? { switchedVersionId } : {}),
  }, parsed, io, () => [
    `Completed hosted improve on ${started.remote.url}.`,
    started.runs.map(formatRun).join("\n"),
    ...(switchedVersionId ? [`Switched local source to ${switchedVersionId}.`] : []),
    ...(nextCommands[0] ? [`next: ${nextCommands[0]}`] : []),
  ].filter(Boolean).join("\n"));
}

interface StartedCloudExecution {
  core: { dir?: string; authToken?: string };
  remote: WorkbenchRemote;
  skillId: string;
  runs: WorkbenchRun[];
  startVersionId?: string;
  source: ParsedWorkbenchInstallSource;
  sync: {
    before: { pushed: number; pulled: number; upToDate: boolean };
    after: { pushed: number; pulled: number; upToDate: boolean };
  };
}

async function defaultInstallTargetNames(config: WorkbenchConfig): Promise<WorkbenchInstallTargetName[]> {
  if (config.installTargets && config.installTargets.length > 0) {
    return config.installTargets;
  }
  const detected: WorkbenchInstallTargetName[] = [];
  for (const target of supportedInstallTargets()) {
    if (target.agent === "local") {
      continue;
    }
    const home = path.dirname(path.dirname(target.destination));
    if (await pathExists(home)) {
      detected.push(target.agent);
    }
  }
  return detected.length > 0 ? detected : ["local"];
}

function normalizeInstallTargetNames(values: readonly string[]): WorkbenchInstallTargetName[] {
  const normalized: WorkbenchInstallTargetName[] = [];
  for (const value of values) {
    const target = value.trim().toLowerCase();
    if (target !== "codex" && target !== "claude" && target !== "local") {
      throw new WorkbenchCodedError("usage", `Unsupported install target: ${value}`, {
        remediation: "Use --to codex, --to claude, or --to local.",
        exitCode: 2,
      });
    }
    normalized.push(target);
  }
  return [...new Set(normalized)];
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function startCloudExecution(command: "eval" | "improve", parsed: ParsedArgs): Promise<StartedCloudExecution> {
  const root = dirFlag(parsed) ?? process.cwd();
  const remote = await ensureCloudRemoteForExecution(root, parsed);
  const source = parseWorkbenchInstallSource(remote.url);
  if (!source) {
    throw new WorkbenchCodedError("remote_invalid_url", `Workbench remote is not a Cloud skill URL: ${remote.url}`, {
      remediation: "Run workbench publish to recreate the Workbench Cloud link.",
      subject: { remote: remote.name, url: remote.url },
      exitCode: 2,
    });
  }
  const token = await workbenchCloudToken({ baseUrl: source.baseUrl });
  if (!token) {
    throw new WorkbenchCodedError("auth_required", `workbench ${command} --cloud requires Workbench Cloud auth.`, {
      remediation: `Run workbench login --base-url ${source.baseUrl}.`,
      exitCode: 1,
    });
  }
  const core = { dir: root, authToken: token };
  const syncBefore = await syncWorkbenchRemote({ ...core, remote: remote.name });
  const startSnapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const skillId = await resolveCloudSkillId(source);
  const response = await apiRequest<{ runs?: WorkbenchRun[] }>(
    `/api/workbench/skills/${encodeURIComponent(skillId)}${command === "improve" ? "/improve" : "/runs"}`,
    { method: "POST", body: cloudExecutionRequestBody(command, parsed) },
    source.baseUrl,
  );
  const runs = response.runs ?? [];
  if (runs.length === 0) {
    throw new WorkbenchCodedError("cloud_run_missing", `Workbench Cloud did not return a run for ${command}.`, {
      retryable: true,
      remediation: "Run workbench log --runs.",
      subject: { remote: remote.name, skillId },
      exitCode: 1,
    });
  }
  const initialSyncAfter = await syncWorkbenchRemote({ ...core, remote: remote.name });
  const completed = await waitForCloudRuns({
    core,
    remote,
    runs,
    initialSync: initialSyncAfter,
  });
  return {
    core,
    remote,
    skillId,
    runs: completed.runs,
    startVersionId: startSnapshot.status.currentVersionId ?? startSnapshot.refs.current,
    source,
    sync: {
      before: { pushed: syncBefore.pushed, pulled: syncBefore.pulled, upToDate: syncBefore.upToDate },
      after: { pushed: completed.sync.pushed, pulled: completed.sync.pulled, upToDate: completed.sync.upToDate },
    },
  };
}

async function waitForCloudRuns(input: {
  core: { dir?: string; authToken?: string };
  remote: WorkbenchRemote;
  runs: readonly WorkbenchRun[];
  initialSync: Awaited<ReturnType<typeof syncWorkbenchRemote>>;
}): Promise<{ runs: WorkbenchRun[]; sync: Awaited<ReturnType<typeof syncWorkbenchRemote>> }> {
  const runIds = input.runs
    .map((run) => run.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (runIds.length === 0 || runIds.length !== input.runs.length) {
    throw new WorkbenchCodedError("cloud_run_missing", "Workbench Cloud did not return a run id.", {
      retryable: true,
      remediation: "Run workbench log --runs.",
      exitCode: 1,
    });
  }
  let sync = input.initialSync;
  const timeoutMs = positiveIntEnv("WORKBENCH_CLOUD_RUN_TIMEOUT_MS") ?? CLOUD_RUN_TIMEOUT_MS;
  const pollIntervalMs = positiveIntEnv("WORKBENCH_CLOUD_RUN_POLL_INTERVAL_MS") ?? CLOUD_RUN_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(input.core);
    const runs = runIds
      .map((id) => snapshot.runs.find((entry) => entry.id === id))
      .filter((run): run is WorkbenchRun => Boolean(run));
    if (runs.length === runIds.length && runs.every(isTerminalRun)) {
      return { runs, sync };
    }
    if (Date.now() >= deadline) {
      throw new WorkbenchCodedError("cloud_run_pending", "Hosted Workbench run is still running.", {
        retryable: true,
        remediation: runIds[0] ? `Run workbench show ${runIds[0]}.` : "Run workbench log --runs.",
        subject: {
          runIds,
          statuses: Object.fromEntries(runs.map((run) => [run.id, run.status])),
        },
        exitCode: 1,
      });
    }
    await sleep(pollIntervalMs);
    sync = await syncWorkbenchRemote({ ...input.core, remote: input.remote.name });
  }
}

function isTerminalRun(run: WorkbenchRun): boolean {
  return run.status === "succeeded" || run.status === "failed" || run.status === "canceled";
}

async function switchHostedImproveVersionIfPromoted(started: StartedCloudExecution): Promise<string | undefined> {
  const outputVersionId = started.runs.find((run) => run.status === "succeeded" && run.outputVersionId)?.outputVersionId;
  if (!outputVersionId) {
    return undefined;
  }
  const refs = await fetchCloudObjectRefs(started);
  if (refs.current !== outputVersionId) {
    return undefined;
  }
  await listWorkbenchVersions(started.core);
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(started.core);
  const currentVersionId = snapshot.status.currentVersionId ?? snapshot.refs.current;
  if (started.startVersionId && currentVersionId && currentVersionId !== started.startVersionId) {
    throw new WorkbenchCodedError("worktree_changed", "Local source changed while hosted improve was running; refusing to overwrite it.", {
      remediation: `Review workbench diff, then run workbench switch ${outputVersionId} when ready.`,
      subject: {
        startedFrom: started.startVersionId,
        current: currentVersionId,
        hostedVersion: outputVersionId,
      },
      exitCode: 1,
    });
  }
  const version = await switchWorkbenchVersion(outputVersionId, started.core);
  return version.id;
}

async function fetchCloudObjectRefs(started: StartedCloudExecution): Promise<Record<string, string>> {
  const response = await apiRequest<{ objectPack?: { refs?: Record<string, string> } }>(
    `/api/workbench/skills/${encodeURIComponent(started.skillId)}/objects`,
    {},
    started.source.baseUrl,
  );
  return response.objectPack?.refs ?? {};
}

async function ensureCloudRemoteForExecution(root: string, parsed: ParsedArgs): Promise<WorkbenchRemote> {
  const linked = await linkedCloudRemote(root);
  if (linked) {
    return linked;
  }
  const link = await cloudRemoteLinkTarget(root);
  const remote = await derivePublishCloudRemote(parsed, "workbench --cloud", link.name);
  const source = parseWorkbenchInstallSource(remote.url);
  if (!source) {
    throw new WorkbenchCodedError("remote_invalid_url", `Workbench remote is not a Cloud skill URL: ${remote.url}`, {
      remediation: "Run workbench publish to recreate the Workbench Cloud link.",
      subject: { remote: remote.name, url: remote.url },
      exitCode: 2,
    });
  }
  const token = await workbenchCloudToken({ baseUrl: source.baseUrl });
  if (!token) {
    throw new WorkbenchCodedError("auth_required", "workbench --cloud requires Workbench Cloud auth.", {
      remediation: `Run workbench login --base-url ${source.baseUrl}.`,
      exitCode: 1,
    });
  }
  const result = await addWorkbenchRemote(remote.name, remote.url, {
    dir: root,
    authToken: token,
    replace: link.replace,
  });
  return result.remote;
}

async function linkedCloudRemote(root: string): Promise<WorkbenchRemote | null> {
  return preferredCloudRemote(await inspectionRemotes(root)) ?? null;
}

async function inspectionRemotes(root: string): Promise<WorkbenchRemote[]> {
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root }).catch((error) => {
    if (error instanceof WorkbenchCodedError || error instanceof WorkbenchUserError) {
      return null;
    }
    throw error;
  });
  return snapshot?.remotes ?? [];
}

interface CloudRemoteLinkTarget {
  name: string;
  replace: boolean;
  existing?: WorkbenchRemote;
}

async function cloudRemoteLinkTarget(root: string): Promise<CloudRemoteLinkTarget> {
  return cloudRemoteLinkTargetFromRemotes(await inspectionRemotes(root));
}

function cloudRemoteLinkTargetFromRemotes(remotes: readonly WorkbenchRemote[]): CloudRemoteLinkTarget {
  const existing = preferredCloudRemote(remotes);
  if (existing) {
    return { name: existing.name, replace: true, existing };
  }
  return { name: availableCloudRemoteName(remotes), replace: false };
}

function preferredCloudRemote(remotes: readonly WorkbenchRemote[]): WorkbenchRemote | undefined {
  const cloudRemotes = remotes.filter((remote) => remote.kind === "workbench-cloud");
  return cloudRemotes.find((remote) => remote.name === "cloud") ?? cloudRemotes[0];
}

function availableCloudRemoteName(remotes: readonly WorkbenchRemote[]): string {
  const names = new Set(remotes.map((remote) => remote.name));
  if (!names.has("cloud")) {
    return "cloud";
  }
  for (let index = 1; ; index += 1) {
    const name = `cloud-${index}`;
    if (!names.has(name)) {
      return name;
    }
  }
}

async function resolveCloudSkillId(source: ParsedWorkbenchInstallSource): Promise<string> {
  const listed = await apiRequest<{ skills?: Array<{ id?: string; ownerSlug?: string; name?: string }> }>(
    "/api/workbench/skills",
    {},
    source.baseUrl,
  );
  const skill = listed.skills?.find((entry) => entry.ownerSlug === source.owner && entry.name === source.skill);
  if (!skill?.id) {
    throw new WorkbenchCodedError("remote_not_found", `Workbench Cloud skill not found: ${source.owner}/${source.skill}`, {
      remediation: "Run workbench publish.",
      subject: { owner: source.owner, skill: source.skill },
      exitCode: 1,
    });
  }
  return skill.id;
}

function cloudExecutionRequestBody(command: "eval" | "improve", parsed: ParsedArgs): Record<string, Json | undefined> {
  return {
    version: optionalPositional(parsed, 1),
    skill: stringFlag(parsed, "skills"),
    agent: stringFlag(parsed, "agents"),
    samples: intFlag(parsed, "samples"),
    ...(command === "improve" ? { budget: intFlag(parsed, "budget") } : {}),
  };
}

function cloudEvalNextCommands(runs: readonly WorkbenchRun[]): string[] {
  return cloudExecutionNextCommands(runs, "workbench publish");
}

function cloudImproveNextCommands(runs: readonly WorkbenchRun[]): string[] {
  return cloudExecutionNextCommands(runs, "workbench eval");
}

function cloudExecutionNextCommands(runs: readonly WorkbenchRun[], successCommand: string): string[] {
  const first = runs[0];
  if (!first) {
    return ["workbench log --runs"];
  }
  if (first.status === "running" || first.status === "failed" || first.status === "canceled") {
    return [`workbench show ${first.id}`];
  }
  return [successCommand];
}

function cloudExecutionSummary(started: StartedCloudExecution): Json {
  return {
    remote: started.remote.name,
    url: started.remote.url,
    skillId: started.skillId,
    sync: started.sync as unknown as Json,
  };
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
    ...(Array.isArray(parsed.installTargets) ? { installTargets: normalizeInstallTargetNames(parsed.installTargets.flatMap((entry) => typeof entry === "string" ? [entry] : [])) } : {}),
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
  body?: ArrayBuffer | string;
  headers: Record<string, string>;
} {
  if (body == null) {
    return { headers: { "content-type": "application/json" } };
  }
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) < API_REQUEST_GZIP_THRESHOLD_BYTES) {
    return { body: text, headers: { "content-type": "application/json" } };
  }
  const compressed = gzipSync(text);
  const compressedBody = new ArrayBuffer(compressed.byteLength);
  new Uint8Array(compressedBody).set(compressed);
  return {
    body: compressedBody,
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

function positiveIntEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
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
    if (arg === "-n") {
      const value = argv[index + 1];
      if (value && !value.startsWith("-")) {
        index += 1;
        addFlag(flags, "samples", value);
      } else {
        addFlag(flags, "samples", true);
      }
      continue;
    }
    if (!arg.startsWith("--") || arg === "--") {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const value = eq === -1 ? argv[index + 1] : arg.slice(eq + 1);
    const flagSpec = flagSpecForParsedPrefix(positionals, flags);
    const kind = flagSpec?.[name];
    if (eq === -1 && kind === "boolean") {
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

function flagSpecForParsedPrefix(
  positionals: readonly string[],
  flags: Record<string, string | boolean | string[]>,
): FlagSpec | undefined {
  const command = positionals[0] ?? (flags.version === true ? "version" : "status");
  return allowedFlagsForCommand({ positionals: [...positionals], flags: {} }, command);
}

function addFlag(flags: Record<string, string | boolean | string[]>, name: string, value: string | boolean): void {
  if (name === "with" || name === "to") {
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

async function defaultDiffRange(core: { dir?: string; authToken?: string }): Promise<string> {
  await listWorkbenchVersions(core);
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const currentId = snapshot.status.currentVersionId ?? snapshot.refs.current;
  const current = snapshot.versions.find((version) => version.id === currentId);
  if (!current) {
    throw new WorkbenchCodedError("version_not_found", "Current Workbench version was not found.", {
      remediation: "Run workbench log --versions.",
      exitCode: 1,
    });
  }
  const parent = current.parentIds[0];
  return parent ? `${parent}..${current.id}` : `${current.id}..${current.id}`;
}

function parsePublishVisibilityFlags(parsed: ParsedArgs): "private" | "internal" | "public" | undefined {
  const selected = [
    parsed.flags.private === true ? "private" as const : undefined,
    parsed.flags.team === true ? "internal" as const : undefined,
    parsed.flags.public === true ? "public" as const : undefined,
  ].filter((value): value is "private" | "internal" | "public" => Boolean(value));
  if (selected.length > 1) {
    throw new WorkbenchCodedError("usage", "workbench publish accepts only one visibility flag.", {
      remediation: "Run workbench publish --private, workbench publish --team, or workbench publish --public.",
      exitCode: 2,
    });
  }
  return selected[0];
}

async function previewPublishWithDerivedRemote(parsed: ParsedArgs): Promise<{
  remote: WorkbenchRemote;
  version: WorkbenchVersion;
  visibility: "private" | "internal" | "public";
  installHandle: string;
  installUrl: string;
  pinnedInstallUrl: string;
} | undefined> {
  const root = path.resolve(dirFlag(parsed) ?? process.cwd());
  const core = await coreOptions(parsed);
  await listWorkbenchVersions(core);
  const reconciledSnapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
  const link = cloudRemoteLinkTargetFromRemotes(reconciledSnapshot.remotes);
  if (link.existing) {
    return undefined;
  }
  const remote = await derivePublishCloudRemote(parsed, "workbench publish", link.name);
  const requestedVersion = optionalPositional(parsed, 1);
  const versionId = requestedVersion && requestedVersion !== "current"
    ? requestedVersion
    : reconciledSnapshot.status.currentVersionId ?? reconciledSnapshot.refs.current;
  const version = reconciledSnapshot.versions.find((entry) => entry.id === versionId);
  if (!version) {
    throw new WorkbenchCodedError("version_not_found", `Version not found: ${requestedVersion ?? "current"}`, {
      remediation: "Run workbench log --versions.",
      subject: { version: requestedVersion ?? "current" },
      exitCode: 1,
    });
  }
  return {
    remote,
    version,
    visibility: parsePublishVisibilityFlags(parsed) ?? "private",
    installHandle: installHandleFromCloudRemote(remote),
    installUrl: remote.url,
    pinnedInstallUrl: `${remote.url}/releases/${encodeURIComponent(version.id)}`,
  };
}

async function ensurePublishRemote(parsed: ParsedArgs): Promise<string | undefined> {
  const core = await coreOptions(parsed);
  const root = path.resolve(dirFlag(parsed) ?? process.cwd());
  const link = await cloudRemoteLinkTarget(root);
  const override = stringFlag(parsed, "as");
  if (override) {
    const remote = await derivePublishCloudRemote(parsed, "workbench publish", link.name);
    const result = await addWorkbenchRemote(remote.name, remote.url, { ...core, replace: link.replace });
    return result.remote.name;
  }
  if (link.existing) {
    return link.existing.name;
  }
  const remote = await derivePublishCloudRemote(parsed, "workbench publish", link.name);
  const result = await addWorkbenchRemote(remote.name, remote.url, core);
  return result.remote.name;
}

async function derivePublishCloudRemote(parsed: ParsedArgs, action = "workbench publish", name = "cloud"): Promise<WorkbenchRemote> {
  const config = await loadConfig();
  const baseUrl = optionalWorkbenchBaseUrl({ configBaseUrl: config.baseUrl }) ?? DEFAULT_WORKBENCH_CLOUD_BASE_URL;
  const override = stringFlag(parsed, "as");
  const handle = override ? parseOwnerSkillHandle(override) : derivedOwnerSkillHandle(parsed, config, action);
  const url = `${baseUrl}/skills/${encodeURIComponent(handle.owner)}/${encodeURIComponent(handle.skill)}`;
  return { name, kind: "workbench-cloud", url };
}

function installHandleFromCloudRemote(remote: WorkbenchRemote): string {
  const source = parseWorkbenchInstallSource(remote.url);
  if (!source) {
    throw new WorkbenchCodedError("remote_invalid_url", `Workbench remote is not a Cloud skill URL: ${remote.url}`, {
      remediation: "Run workbench publish to recreate the Workbench Cloud link.",
      subject: { remote: remote.name, url: remote.url },
      exitCode: 2,
    });
  }
  return `${source.owner}/${source.skill}`;
}

function parseOwnerSkillHandle(input: string): { owner: string; skill: string } {
  const handle = normalizedOwnerSkillHandle(input);
  if (!handle) {
    throw new WorkbenchCodedError("usage", "workbench publish --as expects OWNER/SKILL.", {
      remediation: "Run workbench publish --as OWNER/SKILL.",
      exitCode: 2,
    });
  }
  return handle;
}

function derivedOwnerSkillHandle(parsed: ParsedArgs, config: WorkbenchConfig, action: string): WorkbenchSkillHandle {
  const owner = config.username?.trim();
  if (!owner) {
    throw new WorkbenchCodedError("auth_required", `${action} needs a logged-in Workbench Cloud username before it can derive OWNER/SKILL.`, {
      remediation: "Run workbench login.",
      exitCode: 1,
    });
  }
  const root = path.resolve(dirFlag(parsed) ?? process.cwd());
  const handle = normalizeOwnerSkillHandle(owner, path.basename(root));
  if (!handle.owner || !handle.skill) {
    throw new WorkbenchCodedError("usage", `${action} could not derive a valid OWNER/SKILL handle.`, {
      remediation: `Run ${action} --as OWNER/SKILL.`,
      subject: { owner, skill: path.basename(root) },
      exitCode: 2,
    });
  }
  return handle;
}

async function resolveWorkbenchInstallSourceInput(input: string): Promise<string> {
  if (/^https?:\/\//u.test(input)) {
    return input;
  }
  const handle = normalizedOwnerSkillHandle(input);
  if (!handle) {
    throw new WorkbenchCodedError("usage", "workbench install expects OWNER/SKILL or a Workbench Cloud skill URL.", {
      remediation: "Run workbench install OWNER/SKILL --to codex.",
      exitCode: 2,
    });
  }
  const config = await loadConfig();
  const baseUrl = optionalWorkbenchBaseUrl({ configBaseUrl: config.baseUrl }) ?? DEFAULT_WORKBENCH_CLOUD_BASE_URL;
  return `${baseUrl}/skills/${encodeURIComponent(handle.owner)}/${encodeURIComponent(handle.skill)}`;
}

function normalizedOwnerSkillHandle(value: string): WorkbenchSkillHandle | null {
  const parts = value.trim().split("/");
  if (parts.length !== 2) {
    return null;
  }
  const handle = normalizeOwnerSkillHandle(parts[0] ?? "", parts[1] ?? "");
  return handle.owner && handle.skill ? handle : null;
}

function normalizeOwnerSkillHandle(owner: string, skill: string): WorkbenchSkillHandle {
  return {
    owner: normalizeWorkbenchSkillName(owner),
    skill: normalizeWorkbenchSkillName(skill),
  };
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
    ...(nextCommands[0] ? [`next: ${nextCommands[0]}`] : []),
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
    return ["workbench log --runs"];
  }
  return [
    `workbench show ${first.id}`,
    `workbench show ${first.id}:stderr.log`,
    `workbench case add ${first.id}`,
    `workbench improve --agents ${first.agentName} --budget 1 -n 1`,
  ];
}

function output(value: unknown, parsed: ParsedArgs, io: CliIo, text: () => string): number {
  return emitResult(commandSchema(parsed), { result: value as Json }, parsed, io, text);
}

function commandSchema(parsed: ParsedArgs): string {
  const command = parsed.positionals[0] ?? "result";
  const subcommand = parsed.positionals[1];
  const suffix = ["agent", "case"].includes(command) && subcommand
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

type InspectionSnapshot = Awaited<ReturnType<typeof createWorkbenchReadOnlyInspectionSnapshot>>;

function formatLogEntry(entry: WorkbenchLogEntry): string {
  if (entry.kind === "version") {
    return `${entry.createdAt}\tversion\t${entry.id}\tfiles=${entry.fileCount}\t${entry.message}`;
  }
  const score = entry.score === undefined ? "n/a" : entry.score.toFixed(3);
  return `${entry.createdAt}\trun\t${entry.id}\t${entry.status}\tversion=${entry.versionId}\tskill=${entry.skillName}\tagent=${entry.agentName}\tscore=${score}`;
}

function splitShowRef(ref: string): [string, string | null] {
  const index = ref.indexOf(":");
  if (index === -1) {
    return [ref, null];
  }
  return [ref.slice(0, index), ref.slice(index + 1)];
}

async function fileForRunOrJobRef(
  core: { dir?: string; authToken?: string },
  objectRef: string,
  requestedPath: string,
): Promise<SurfaceSnapshotFile | null> {
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const run = snapshot.runs.find((entry) => entry.id === objectRef);
  const job = snapshot.jobs.find((entry) => entry.id === objectRef);
  if (!run && !job) {
    return null;
  }
  const traceIds = run?.traceIds ?? job?.traceIds ?? [];
  const traces = snapshot.traces.filter((trace) => traceIds.includes(trace.id));
  for (const trace of traces) {
    const file = findShowFile(trace.files, requestedPath);
    if (file) {
      return file;
    }
  }
  throw new WorkbenchCodedError("ref_not_found", `File not found in ${objectRef}: ${requestedPath}`, {
    remediation: `Run workbench show ${objectRef}.`,
    subject: { ref: objectRef, path: requestedPath },
    exitCode: 1,
  });
}

function evidenceDetailsForRunOrJob(snapshot: InspectionSnapshot, ref: string): WorkbenchExecutionTraceDetail[] {
  const run = snapshot.runs.find((entry) => entry.id === ref);
  const job = snapshot.jobs.find((entry) => entry.id === ref);
  const jobs = run
    ? snapshot.jobs.filter((entry) => entry.runId === run.id)
    : job ? [job] : [];
  return jobs.flatMap((entry) => {
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
}

function findShowFile(files: readonly SurfaceSnapshotFile[], requestedPath: string): SurfaceSnapshotFile | null {
  const normalized = requestedPath.replace(/\\/gu, "/");
  return files.find((file) => file.path === normalized) ??
    files.find((file) => file.path.endsWith(`/${normalized}`)) ??
    files.find((file) => path.basename(file.path) === normalized) ??
    null;
}

function fileListing(kind: "version" | "trace" | "artifact", id: string, files: readonly SurfaceSnapshotFile[]): Json {
  return {
    kind,
    id,
    fileCount: files.length,
    files: files.map(fileSummary),
  };
}

function formatFileListing(kind: "version" | "trace" | "artifact", id: string, files: readonly SurfaceSnapshotFile[]): string {
  return [`${kind}\t${id}\tfiles=${files.length}`, ...files.map((file) => file.path)].join("\n");
}

async function traceIdForCaseSource(core: { dir?: string; authToken?: string }, ref: string): Promise<string> {
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const trace = snapshot.traces.find((entry) => entry.id === ref);
  if (trace) {
    return trace.id;
  }
  const run = snapshot.runs.find((entry) => entry.id === ref);
  const job = snapshot.jobs.find((entry) => entry.id === ref);
  const traceId = run?.traceIds[0] ?? job?.traceIds[0];
  if (traceId) {
    return traceId;
  }
  throw new WorkbenchCodedError("ref_not_found", `Run, job, or trace not found: ${ref}`, {
    remediation: "Run workbench log, then workbench case add RUN_ID.",
    subject: { ref },
    exitCode: 1,
  });
}

interface EvalDelta {
  runId: string;
  versionId: string;
  skillName: string;
  agentName: string;
  score?: number;
  previousScore?: number;
  delta?: number;
}

async function evalDeltas(
  core: { dir?: string; authToken?: string },
  runs: readonly WorkbenchRun[],
): Promise<EvalDelta[]> {
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  return runs.map((run) => {
    const previous = snapshot.runs
      .filter((candidate) =>
        candidate.id !== run.id &&
        candidate.skillName === run.skillName &&
        candidate.agentName === run.agentName &&
        typeof candidate.score === "number" &&
        candidate.createdAt < run.createdAt
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    return {
      runId: run.id,
      versionId: run.versionId,
      skillName: run.skillName,
      agentName: run.agentName,
      ...(run.score !== undefined ? { score: run.score } : {}),
      ...(previous?.score !== undefined ? { previousScore: previous.score } : {}),
      ...(run.score !== undefined && previous?.score !== undefined ? { delta: run.score - previous.score } : {}),
    };
  });
}

function formatEvalDelta(delta: EvalDelta): string {
  const score = delta.score === undefined ? "n/a" : delta.score.toFixed(3);
  if (delta.previousScore === undefined || delta.delta === undefined) {
    return `${delta.skillName} ${delta.versionId} ${score} (was n/a)`;
  }
  const sign = delta.delta >= 0 ? "+" : "";
  return `${delta.skillName} ${delta.versionId} ${score} (was ${delta.previousScore.toFixed(3)}, ${sign}${delta.delta.toFixed(3)})`;
}

function evalSuccessNextCommands(runs: readonly WorkbenchRun[]): string[] {
  return runs.length > 0 ? ["workbench publish"] : ["workbench eval"];
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
    ...(status.next[0] ? [`next: ${status.next[0]}`] : []),
  ];
  return lines.join("\n");
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
