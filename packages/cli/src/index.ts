import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import {
  addWorkbenchRemote,
  addWorkbenchAgent,
  compareWorkbench,
  createWorkbenchRunId,
  createWorkbenchRunSnapshotForRun,
  createWorkbenchAdapterAuthBundle,
  createWorkbenchReadOnlyInspectionSnapshot,
  diffWorkbenchVersions,
  initWorkbenchSkill,
  listWorkbenchAgents,
  listWorkbenchVersions,
  localWorkbenchAdapterAuthStore,
  parseWorkbenchAdapterAuthTarget,
  quoteShellArg,
  hasWorkbenchLocalHostedRunHandle,
  hasWorkbenchLocalRunCancellationRequest,
  prepareWorkbenchCloudEvalRequest,
  prepareWorkbenchCloudImproveRequest,
  previewWorkbenchEval,
  previewWorkbenchImprove,
  publishWorkbenchVersion,
  clearWorkbenchLocalHostedRunHandle,
  recordWorkbenchCloudInspectionSnapshot,
  recordWorkbenchCloudRunSnapshot,
  recordWorkbenchLocalHostedRunCancellation,
  recordWorkbenchLocalHostedRunFailure,
  recordWorkbenchLocalHostedRunHandle,
  requestLocalWorkbenchRunCancellation,
  resolveWorkbenchRunRetryPlan,
  removeWorkbenchAgent,
  showWorkbenchRef,
  switchWorkbenchVersion,
  syncWorkbenchRemote,
  workbenchStatus,
  workbenchJobEvidenceForSnapshot,
  workbenchProviderAuthSetupCommand,
  workbenchSkillImproveAdapterRemediation,
  workbenchSkillImproveCanUseQueuedAdapter,
  workbenchStatusSnapshot,
  workbenchAuthorEvalCaseCommand,
  WorkbenchCodedError,
  WORKBENCH_AUTHOR_EVAL_CASE_COMMAND,
  WorkbenchUserError,
  type Json,
  type SurfaceSnapshotFile,
  type WorkbenchAdapterAuthBundle,
  type WorkbenchAdapterAuthFile,
  type WorkbenchAdapterAuthStatusRecord,
  type WorkbenchAdapterAuthTarget,
  type WorkbenchArtifact,
  type WorkbenchComparison,
  type WorkbenchInspectionSnapshotEnvelope,
  type WorkbenchInspectionSnapshot,
  type WorkbenchJob,
  type WorkbenchEvalPreview,
  type WorkbenchImprovePreview,
  type WorkbenchLaunchReadiness,
  type WorkbenchOperationRequest,
  type WorkbenchPreparedCloudEvalRequest,
  type WorkbenchPreparedCloudImproveRequest,
  type WorkbenchMeasurementSummary,
  type WorkbenchRunSnapshot,
  type WorkbenchRunRetryPlan,
  type WorkbenchRun,
  type WorkbenchAgent,
  type WorkbenchExecutionTraceDetail,
  type WorkbenchRemote,
  type WorkbenchStatus,
  type WorkbenchStateNotice,
  type WorkbenchTrace,
  type WorkbenchVersion,
} from "@workbench-ai/workbench-core";
import { normalizeWorkbenchSkillName } from "@workbench-ai/workbench-contract";
import { emitError, emitResult } from "./output.js";
import {
  createProgressRenderer,
  formatProgressDuration,
  formatProgressSummary,
  runProgressSnapshotFromRuns,
  type ProgressEvidenceCounts,
  type WorkbenchProgressCommand,
  type WorkbenchProgressPhase,
} from "./progress.js";
import {
  installedInventoryToJson,
  installPackageFiles,
  installResultToJson,
  installSnapshotToSkillTargets,
  normalizeInstallSnapshotPath,
  observeCurrentInstalledSkillsInventory,
  readInstalledSkillsInventory,
  type WorkbenchInstallTargetResult,
  type WorkbenchInstallTargetsResult,
  type WorkbenchSkillAccessInventory,
  type WorkbenchInstalledSkill,
} from "./install-targets.js";
import {
  localWorkerErrorForRun,
  startPrivateLocalWorkbenchOperation,
} from "./local-worker-control.js";
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
  "  workbench new [DIR] [--from OWNER/SKILL] [--agent codex|claude|command|local] [--model MODEL] [--auth PROFILE] [--json]",
  "  workbench eval [--skills all|LIST] [--agents all|LIST] [-n N|--samples N] [--rerun] [--cloud] [--dry-run] [--json]",
  "  workbench improve [--skills LIST] [--agents LIST] [--budget N] [-n N|--samples N] [--cloud] [--dry-run] [--json]",
  "  workbench compare [--skills all|LIST] [--agents all|LIST] [--versions all|A..B|LIST] [--json]",
  "  workbench publish [VERSION] [--as OWNER/SKILL] [--private|--team|--public] [--dry-run] [--dir DIR] [--json]",
  "  workbench skills [--for codex|claude|all] [--global] [--dir DIR] [--json]",
  "  workbench install OWNER/SKILL [--for codex|claude|all] [--global] [--dir DIR] [--yes] [--dry-run] [--json]",
  "",
  "More:",
  "  workbench help --all",
].join("\n");

const HELP_ALL = [
  "Usage:",
  "  workbench                          # = workbench status",
  "  workbench new [DIR] [--from OWNER/SKILL] [--agent codex|claude|command|local] [--model MODEL] [--auth PROFILE] [--json]",
  "  workbench eval [--skills all|LIST] [--agents all|LIST] [-n N|--samples N] [--rerun] [--cloud] [--dry-run] [--json]",
  "  workbench compare [--skills all|LIST] [--agents all|LIST] [--versions all|A..B|LIST] [--json]",
  "  workbench improve [--skills LIST] [--agents LIST] [--budget N] [-n N|--samples N] [--cloud] [--dry-run] [--json]",
  "  workbench publish [VERSION] [--as OWNER/SKILL] [--private|--team|--public] [--dry-run] [--dir DIR] [--json]",
  "  workbench skills [--for codex|claude|all] [--global] [--dir DIR] [--json]",
  "  workbench install OWNER/SKILL [--for codex|claude|all] [--global] [--dir DIR] [--yes] [--dry-run] [--json]",
  "",
  "Inspect:",
  "  workbench status [--dir DIR] [--json]",
  "  workbench run watch RUN_ID [--dir DIR] [--json]",
  "  workbench run cancel RUN_ID [--dir DIR] [--json]",
  "  workbench run retry RUN_ID [--dir DIR] [--json]",
  "  workbench log [--runs|--versions] [--json]",
  "  workbench show REF[:PATH] [--json]",
  "  workbench diff [A..B] [--json]",
  "  workbench switch VERSION [--json]",
  "  workbench open [--host HOST] [--port PORT] [--no-open]",
  "",
  "Configure:",
  "  workbench agent add NAME --adapter X [--model M] [--with k=v]... | list | rm NAME [--json]",
  "",
  "Share and auth:",
  "  workbench login [PROVIDER] [--method METHOD] [--profile PROFILE] [--profile-root DIR] [--base-url URL] [--start-only|--wait] [--timeout N] [--no-open] [--local-only] [--json]",
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
    "  workbench new [DIR] [--from OWNER/SKILL] [--agent codex|claude|command|local] [--model MODEL] [--auth PROFILE] [--json]",
    "",
    "Creates a Workbench skill project. Use --from OWNER/SKILL to hydrate editable source from a published skill.",
    "",
    "Example:",
    "  workbench new earnings-prep",
  ].join("\n"),
  eval: [
    "Usage:",
    "  workbench eval [--skills all|LIST] [--agents all|LIST] [-n N|--samples N] [--rerun] [--cloud] [--dry-run] [--json]",
    "",
    "Runs eval jobs for the selected version, measured skills, and agents. Omitted selectors use manifest defaults.",
    "",
    "Example:",
    "  workbench eval -n 5",
  ].join("\n"),
  improve: [
    "Usage:",
    "  workbench improve [--skills LIST] [--agents LIST] [--budget N] [-n N|--samples N] [--cloud] [--dry-run] [--json]",
    "",
    "Creates one improved child version from evidence. The selected skills and agents must resolve to exactly one entry each.",
    "",
    "Example:",
    "  workbench improve --budget 1 -n 1",
  ].join("\n"),
  compare: [
    "Usage:",
    "  workbench compare [--skills all|LIST] [--agents all|LIST] [--versions all|A..B|LIST] [--json]",
    "",
    "Compares recorded eval evidence across selected skills, agents, and versions.",
    "",
    "Example:",
    "  workbench compare --agents all",
  ].join("\n"),
  install: [
    "Usage:",
    "  workbench install OWNER/SKILL [--for codex|claude|all] [--global] [--dir DIR] [--yes] [--dry-run] [--json]",
    "",
    "Installs a published agent skill package for Codex, Claude, or both. Use workbench skills to list accessible skills.",
    "",
    "Example:",
    "  workbench install test/workbench-smoke",
  ].join("\n"),
  skills: [
    "Usage:",
    "  workbench skills [--for codex|claude|all] [--global] [--dir DIR] [--json]",
    "",
    "Lists skills accessible to the current coding agent, or to Codex and Claude when --for all is supplied.",
    "",
    "Example:",
    "  workbench skills --for all",
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
    "  workbench logout [PROVIDER] [--json]",
    "",
    "With no provider, logs out of Workbench Cloud. With a provider such as codex or claude, removes local adapter auth.",
    "",
    "Example:",
    "  workbench logout claude",
  ].join("\n"),
  show: [
    "Usage:",
    "  workbench show REF [--json]",
    "  workbench show REF:PATH [--json]",
    "",
    "Shows a Workbench object, lists files for file-backed objects, or prints one file.",
    "",
    "Example:",
    "  workbench show run_abc12345:result.json",
  ].join("\n"),
  log: [
    "Usage:",
    "  workbench log [--runs|--versions] [--json]",
    "",
    "Shows one reverse-chronological timeline of versions and runs.",
    "",
    "Example:",
    "  workbench log --runs",
  ].join("\n"),
  run: [
    "Usage:",
    "  workbench run watch RUN_ID [--dir DIR] [--json]",
    "  workbench run cancel RUN_ID [--dir DIR] [--json]",
    "  workbench run retry RUN_ID [--dir DIR] [--json]",
    "",
    "Operates on an existing run. Watch follows progress, cancel requests cancellation, and retry starts a new full run from durable launch facts.",
    "",
    "Example:",
    "  workbench run watch run_abc12345",
  ].join("\n"),
  diff: [
    "Usage:",
    "  workbench diff [A..B] [--json]",
    "",
    "Shows changed files between two Workbench source versions.",
    "",
    "Example:",
    "  workbench diff 26059f9a..eac5699c",
  ].join("\n"),
  switch: [
    "Usage:",
    "  workbench switch VERSION [--json]",
    "",
    "Switches the working skill source to a recorded Workbench version.",
    "",
    "Example:",
    "  workbench switch 26059f9a",
  ].join("\n"),
  open: [
    "Usage:",
    "  workbench open [--host HOST] [--port PORT] [--no-open]",
    "",
    "Serves the local Workbench UI.",
    "",
    "Example:",
    "  workbench open --no-open",
  ].join("\n"),
  agent: [
    "Usage:",
    "  workbench agent list [--json]",
    "  workbench agent add NAME --adapter X [--model M] [--with k=v]... [--json]",
    "  workbench agent rm NAME [--json]",
    "",
    "Lists, adds, or removes eval agent configurations.",
    "",
    "Example:",
    "  workbench agent add claude --adapter claude --model sonnet",
  ].join("\n"),
  sync: [
    "Usage:",
    "  workbench sync [REMOTE] [--dry-run] [--dir DIR] [--json]",
    "",
    "Plumbing command: synchronizes local evidence and version objects with a Workbench remote.",
    "",
    "Example:",
    "  workbench sync cloud --dry-run",
  ].join("\n"),
  publish: [
    "Usage:",
    "  workbench publish [VERSION] [--as OWNER/SKILL] [--private|--team|--public] [--dry-run] [--dir DIR] [--json]",
    "",
    "Publishes installable skill source to Workbench Cloud. --as sets the linked OWNER/SKILL handle.",
    "",
    "Example:",
    "  workbench publish --as OWNER/SKILL --dry-run",
  ].join("\n"),
  login: [
    "Usage:",
    "  workbench login [PROVIDER] [--method METHOD] [--profile PROFILE] [--profile-root DIR] [--base-url URL] [--start-only|--wait] [--timeout N] [--no-open] [--local-only] [--json]",
    "  workbench logout [PROVIDER] [--json]",
    "",
    "Connects the CLI to Workbench Cloud or captures local adapter auth for a provider.",
    "Provider OAuth capture reads native provider state from DIR when --profile-root is supplied.",
    "Codex reads DIR/.codex/auth.json; Claude reads DIR/.claude.json plus CLAUDE_CODE_OAUTH_TOKEN from claude setup-token.",
    "",
    "Example:",
    "  workbench login --start-only --no-open",
  ].join("\n"),
};

type FlagKind = "boolean" | "string" | "positive-integer" | "port" | "repeat-string";

type FlagSpec = Readonly<Record<string, FlagKind>>;

const COMMON_FLAGS = {
  json: "boolean",
} as const satisfies FlagSpec;

const DIR_FLAG = {
  dir: "string",
} as const satisfies FlagSpec;

const PROJECT_FLAGS = {
  ...COMMON_FLAGS,
  ...DIR_FLAG,
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
    "dry-run": "boolean",
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
    "dry-run": "boolean",
    samples: "positive-integer",
    skills: "string",
  },
  install: { ...PROJECT_FLAGS, ...HELP_FLAG, "dry-run": "boolean", for: "string", global: "boolean", yes: "boolean" },
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
  new: { ...PROJECT_FLAGS, ...HELP_FLAG, agent: "string", auth: "string", from: "string", model: "string" },
  open: { ...DIR_FLAG, ...HELP_FLAG, host: "string", "no-open": "boolean", port: "port" },
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
  skills: { ...PROJECT_FLAGS, ...HELP_FLAG, for: "string", global: "boolean" },
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
  agent: {
    flags: {
      list: { ...PROJECT_FLAGS, ...HELP_FLAG },
      add: { ...PROJECT_FLAGS, ...HELP_FLAG, adapter: "string", model: "string", with: "repeat-string" },
      rm: { ...PROJECT_FLAGS, ...HELP_FLAG },
    },
  },
  run: {
    flags: {
      watch: { ...PROJECT_FLAGS, ...HELP_FLAG },
      cancel: { ...PROJECT_FLAGS, ...HELP_FLAG },
      retry: { ...PROJECT_FLAGS, ...HELP_FLAG },
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
    if (command === "skills") {
      return await handleSkills(parsed, io);
    }
    const core = await coreOptions(parsed);
    if (command === "new") {
      if (stringFlag(parsed, "from")) {
        return await handleNewFrom(parsed, io);
      }
      const status = await initWorkbenchSkill({
        dir: parsed.positionals[1] ?? dirFlag(parsed),
        agent: stringFlag(parsed, "agent"),
        model: stringFlag(parsed, "model"),
        auth: stringFlag(parsed, "auth"),
        adapterAuthStoreRoot: adapterAuthStoreRoot(),
      });
      const next = projectScopedNextCommand(status.root, WORKBENCH_AUTHOR_EVAL_CASE_COMMAND);
      return emitResult("workbench.cli.new.v1", {
        result: status as unknown as Json,
        defaultAgent: status.defaultAgentSelection as unknown as Json,
        setupCommands: status.defaultAgentSelection
          ? status.defaultAgentSelection.readiness.setupCommands as unknown as Json
          : undefined,
        next: next as Json,
      }, parsed, io, () => formatNewResult(status, next));
    }
    if (command === "status") {
      return await handleStatus(parsed, io);
    }
    if (command === "eval") {
      rejectExtraInput(parsed, {
        maxPositionals: 1,
        message: "workbench eval does not accept a VERSION argument.",
        remediation: "workbench eval",
      });
      if (parsed.flags["dry-run"] === true) {
        return await handleEvalDryRun(parsed, io);
      }
      if (parsed.flags.cloud === true) {
        return await handleCloudEval(parsed, io);
      }
      const request = evalOperationRequest(parsed);
      const started = await startPrivateLocalWorkbenchOperation({
        core,
        request,
      });
      const completed = await waitForLocalRunTerminal({
        command: "eval",
        core,
        initialSnapshot: started.snapshot,
        io,
        json: parsed.flags.json === true,
      });
      if (completed.detached) {
        return emitLocalDetach("workbench.cli.eval.v1", completed.snapshot, parsed, io);
      }
      const runs = [completed.run];
      const snapshot = completed.snapshot;
      const artifactIds = await artifactIdsByRunId(core, runs);
      const failedRuns = runs.filter((run) => run.status === "failed" || run.status === "canceled");
      const coverage = await evalCoverageSummaries(core, runs);
      const deltas = await evalDeltas(core, runs);
      if (failedRuns.length > 0) {
        return emitEvalFailure(snapshot, failedRuns, artifactIds, coverage, deltas, parsed, io);
      }
      const next = await evalSuccessNextCommand(core, runs);
      return emitResult("workbench.cli.eval.v1", {
        run: runSnapshotResultJson(snapshot),
        coverage: coverage as unknown as Json,
        deltas: deltas as unknown as Json,
        next: next as Json,
      }, parsed, io, () => [
        formatRunSnapshot(snapshot),
        ...formatEvalCoverageLines(coverage),
        ...formatEvalDeltaLines(deltas),
        ...(next ? [`next: ${next}`] : []),
      ].filter(Boolean).join("\n"));
    }
    if (command === "improve") {
      rejectExtraInput(parsed, {
        maxPositionals: 1,
        message: "workbench improve does not accept a VERSION argument.",
        remediation: "workbench improve",
      });
      if (parsed.flags["dry-run"] === true) {
        return await handleImproveDryRun(parsed, io);
      }
      if (parsed.flags.cloud === true) {
        return await handleCloudImprove(parsed, io);
      }
      const request = improveOperationRequest(parsed);
      const started = await startPrivateLocalWorkbenchOperation({
        core,
        request,
      });
      const completed = await waitForLocalRunTerminal({
        command: "improve",
        core,
        initialSnapshot: started.snapshot,
        io,
        json: parsed.flags.json === true,
      });
      if (completed.detached) {
        return emitLocalDetach("workbench.cli.improve.v1", completed.snapshot, parsed, io);
      }
      const improveResult = await localImproveResultFromRun(core, completed.run);
      const next = completed.run.status === "succeeded"
        ? improveResult.switched ? "workbench eval --rerun -n 5" : "workbench eval"
        : `workbench show ${completed.run.id}`;
      return emitImproveOutcome(parsed, io, completed.snapshot, improveResult, next);
    }
    if (command === "compare") {
      const comparison = await compareWorkbench({
        ...core,
        versions: stringFlag(parsed, "versions"),
        skills: stringFlag(parsed, "skills"),
        agents: stringFlag(parsed, "agents"),
      });
      return output(manifestOnly(comparison), parsed, io, () => formatComparison(comparison));
    }
    if (command === "switch") {
      const versionRef = requiredPositional(parsed, 1, "workbench switch requires VERSION.");
      const version = await switchWorkbenchVersion(versionRef, core);
      return output(versionSummary(version), parsed, io, () => `Switched to ${displayRef(version.id)}.`);
    }
    if (command === "diff") {
      const range = optionalPositional(parsed, 1) ?? await defaultDiffRange(core);
      const diffs = await diffWorkbenchVersions(range, core);
      return output(diffs, parsed, io, () => formatDiff(diffs));
    }
    if (command === "show") {
      return await handleShow(parsed, io);
    }
    if (command === "log") {
      return await handleLog(parsed, io);
    }
    if (command === "run") {
      return await handleRun(parsed, io);
    }
    if (command === "agent") {
      return await handleAgent(parsed, io);
    }
    if (command === "sync") {
      const beforeRuns = parsed.flags["dry-run"] === true
        ? undefined
        : await runEvidenceFingerprints(core).catch(() => undefined);
      if (parsed.flags["dry-run"] !== true) {
        writeCliProgress(parsed, io, `workbench sync: syncing ${optionalPositional(parsed, 1) ?? "default remote"}.`);
      }
      const syncDryRun = parsed.flags["dry-run"] === true;
      const result = await withProgressHeartbeat(
        io,
        syncDryRun ? "workbench sync: dry-run check" : "workbench sync: remote sync",
        async () => await syncWorkbenchRemote({
          ...core,
          remote: optionalPositional(parsed, 1),
          dryRun: syncDryRun,
        }),
        {
          hint: syncDryRun ? "No files have been written." : "Read commands remain available: workbench log --runs.",
          json: parsed.flags.json === true,
        },
      );
      const next = result.dryRun
        ? syncChanged(result) ? `workbench sync ${result.remote.name}` : null
        : await syncNextCommand(core, beforeRuns);
      const dryRunNote = result.dryRun && syncChanged(result)
        ? "Dry-run checked the remote without updating local sync status; run the next command to reconcile."
        : undefined;
      return emitResult("workbench.cli.sync.v1", {
        remote: result.remote as unknown as Json,
        status: result.dryRun ? "dry_run" : "synced",
        pushed: result.pushed,
        pulled: result.pulled,
        changed: syncChanged(result),
        publication: result.publication as unknown as Json,
        next: next as Json,
        ...(result.dryRun ? { dryRun: true } : {}),
        ...(dryRunNote ? { note: dryRunNote } : {}),
      }, parsed, io, () => [
        `${result.dryRun ? "Would sync" : "Synced"} ${result.remote.name}: pushed ${result.pushed}, pulled ${result.pulled}${result.upToDate && !result.dryRun ? " (up to date)" : ""}.`,
        ...(dryRunNote ? [dryRunNote] : []),
        ...(next ? [`next: ${next}`] : []),
      ].join("\n"));
    }
    if (command === "publish") {
      const visibility = parsePublishVisibilityFlags(parsed);
      const preview = parsed.flags["dry-run"] === true
        ? await previewPublishWithDerivedRemote(parsed, visibility)
        : undefined;
      if (preview) {
        const audience = publishAudience(preview.visibility);
        return emitResult("workbench.cli.publish.v1", {
          remote: preview.remote as unknown as Json,
          version: versionSummary(preview.version),
          visibility: audience,
          installHandle: preview.installHandle,
          dryRun: true,
          next: `workbench install ${preview.installHandle}`,
        }, parsed, io, () => [
          `Would publish ${displayRef(preview.version.id)} as ${preview.installHandle} (${audience}).`,
          `next: workbench install ${preview.installHandle}`,
        ].join("\n"));
      }
      let remote: string | undefined;
      let result: Awaited<ReturnType<typeof publishWorkbenchVersion>>;
      try {
        remote = await ensurePublishRemote(parsed);
        await assertPublishCloudAuth(parsed, remote);
        writeCliProgress(parsed, io, "workbench publish: preparing Cloud skill.");
        await writeAuthenticatedJsonProgress(parsed, io, remote, `workbench publish: checking ${optionalPositional(parsed, 1) ?? "current"} source publication.`);
        writeCliProgress(parsed, io, `workbench publish: checking ${optionalPositional(parsed, 1) ?? "current"} source publication.`);
        result = await withProgressHeartbeat(io, "workbench publish: remote publication check", async () => await publishWorkbenchVersion({
          ...core,
          version: optionalPositional(parsed, 1),
          remote,
          dryRun: parsed.flags["dry-run"] === true,
          visibility,
        }), { json: parsed.flags.json === true });
      } catch (error) {
        throw await publishErrorWithCliContext(error, parsed, remote);
      }
      const audience = publishAudience(result.visibility);
      return emitResult("workbench.cli.publish.v1", {
        remote: result.remote as unknown as Json,
        version: versionSummary(result.version),
        visibility: audience,
        installHandle: result.installHandle,
        ...(result.unchanged ? { unchanged: true } : {}),
        ...(result.dryRun ? { dryRun: true } : {}),
        next: `workbench install ${result.installHandle}`,
      }, parsed, io, () => [
        `${result.dryRun ? "Would publish" : result.unchanged ? "Already published" : "Published"} ${displayRef(result.version.id)} as ${result.installHandle} (${audience}).`,
        `next: workbench install ${result.installHandle}`,
      ].join("\n"));
    }
    if (command === "open") {
      // The browser server serves committed object state through a snapshot
      // path, so long-running commands do not block page loads.
      const server = await startWorkbenchOpenServer({
        dir: dirFlag(parsed),
        authToken: core.authToken,
        host: stringFlag(parsed, "host"),
        port: portFlag(parsed, "port"),
      });
      io.stdout.write(`Workbench: ${server.url}\nServing Workbench UI. Press Ctrl-C to stop.\n`);
      if (parsed.flags["no-open"] !== true) {
        await openBrowser(server.url).catch(() => undefined);
      }
      return await new Promise<never>(() => {});
    }
    throw new WorkbenchUserError(`Unknown command: ${command}\n\n${HELP}`);
  } catch (error) {
    const exitCode = emitError(error, parsed, io);
    scheduleProcessExitForDetachedCloud(error, io, exitCode);
    return exitCode;
  }
}

function scheduleProcessExitForDetachedCloud(error: unknown, io: CliIo, exitCode: number): void {
  if (!(error instanceof WorkbenchCodedError) || error.code !== "cloud_detached") {
    return;
  }
  if (io.stdout !== process.stdout || io.stderr !== process.stderr) {
    return;
  }
  if (process.env.VITEST_WORKER_ID || process.env.WORKBENCH_CLI_DISABLE_FORCE_EXIT === "1") {
    return;
  }
  setImmediate(() => process.exit(exitCode));
}

function formatNewResult(status: WorkbenchStatus, next: string | null): string {
  const selection = status.defaultAgentSelection;
  const agent = selection
    ? [
        `Default agent: ${selection.name}`,
        `adapter=${selection.adapter}`,
        ...(selection.model ? [`model=${selection.model}`] : []),
        ...(selection.auth ? [`auth=${selection.auth}`] : []),
        `readiness=${selection.readiness.state}`,
      ].join(" ")
    : undefined;
  return [
    `Created Workbench skill at ${status.root}.`,
    agent,
    ...(selection?.readiness.warnings ?? []),
    ...(selection?.readiness.setupCommands.length
      ? ["setup:", ...selection.readiness.setupCommands.map((command) => `  ${command}`)]
      : []),
    "Add eval cases under .workbench/cases before running eval.",
    ...(next ? [`next: ${next}`] : []),
  ].filter(Boolean).join("\n");
}

function formatNewFromResult(
  project: NewFromProjectResult,
  snapshot: WorkbenchInstallSourceSnapshot,
  hydratedPaths: readonly string[],
  next: string | null,
): string {
  const version = project.currentVersionId ? `Current version: ${displayRef(project.currentVersionId)}.` : undefined;
  const agent = project.defaultAgent ? `Default agent: ${project.defaultAgent}.` : undefined;
  return [
    `Created Workbench skill at ${project.root} from ${snapshot.owner}/${snapshot.name}.`,
    `Hydrated ${hydratedPaths.length} source ${hydratedPaths.length === 1 ? "file" : "files"} from ${snapshot.versionId}.`,
    version,
    agent,
    ...(next ? [`next: ${next}`] : []),
  ].filter(Boolean).join("\n");
}

interface NewFromProjectResult {
  root: string;
  initialized: true;
  currentVersionId?: string;
  defaultSkill?: string;
  defaultAgent?: string;
  createdPaths: readonly string[];
}

async function handleEvalDryRun(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const preview = await previewWorkbenchEval({
    ...(await coreOptions(parsed)),
    skill: stringFlag(parsed, "skills"),
    agent: stringFlag(parsed, "agents"),
    samples: intFlag(parsed, "samples"),
    rerun: parsed.flags.rerun === true,
    cloud: parsed.flags.cloud === true,
  });
  const readiness = parsed.flags.cloud === true
    ? await cloudDryRunReadiness("eval", parsed, preview)
    : preview.readiness;
  const plan = withPreviewReadiness(preview, readiness);
  const next = readiness.ready
    ? parsed.flags.cloud === true ? "workbench eval --cloud" : "workbench eval"
    : firstReadinessRemediation(readiness);
  return emitResult("workbench.cli.eval-plan.v1", {
    dryRun: true,
    plan: plan as unknown as Json,
    readiness: readiness as unknown as Json,
    next: next as Json,
  }, parsed, io, () => [
    `Would run eval ${plan.location}: version=${displayRef(plan.versionId)} eval=${plan.evalHash}`,
    `skills=${plan.skills.map((skill) => skill.name).join(",")} agents=${plan.agents.map((agent) => agent.name).join(",")}`,
    `cases=${plan.cases} samples=${plan.samples} cached=${plan.cachedRunIds.length}`,
    ...formatLaunchReadinessLines(readiness),
    "No files or Workbench state were written.",
    ...(next ? [`next: ${next}`] : []),
  ].join("\n"));
}

function evalOperationRequest(parsed: ParsedArgs, variant: "local" | "cloud" = "local"): WorkbenchOperationRequest {
  return {
    kind: "eval",
    variant,
    ...(stringFlag(parsed, "skills") ? { skill: stringFlag(parsed, "skills") } : {}),
    ...(stringFlag(parsed, "agents") ? { agent: stringFlag(parsed, "agents") } : {}),
    ...(intFlag(parsed, "samples") ? { samples: intFlag(parsed, "samples") } : {}),
    ...(parsed.flags.rerun === true ? { rerun: true } : {}),
  };
}

function improveOperationRequest(parsed: ParsedArgs, variant: "local" | "cloud" = "local"): WorkbenchOperationRequest {
  return {
    kind: "improve",
    variant,
    ...(stringFlag(parsed, "skills") ? { skill: stringFlag(parsed, "skills") } : {}),
    ...(stringFlag(parsed, "agents") ? { agent: stringFlag(parsed, "agents") } : {}),
    ...(intFlag(parsed, "samples") ? { samples: intFlag(parsed, "samples") } : {}),
    ...(intFlag(parsed, "budget") ? { budget: intFlag(parsed, "budget") } : {}),
  };
}

function retryOperationRequest(
  retryPlan: WorkbenchRunRetryPlan,
  variant: "local" | "cloud",
  retryOfRunId: string,
  runId?: string,
): WorkbenchOperationRequest {
  return {
    kind: retryPlan.kind,
    variant,
    ...(runId ? { runId } : {}),
    versionId: retryPlan.kind === "improve" ? retryPlan.baseVersionId : retryPlan.versionId,
    skill: retryPlan.skillName,
    agent: retryPlan.agentName,
    samples: retryPlan.samples,
    ...(retryPlan.kind === "eval" ? { rerun: true } : {}),
    ...(retryPlan.kind === "improve" ? { budget: retryPlan.budget } : {}),
    retryOfRunId,
  };
}

async function localRunStateForSnapshot(
  core: { dir?: string; authToken?: string },
  snapshot: WorkbenchRunSnapshot,
): Promise<{ run: WorkbenchRun; jobs: WorkbenchJob[] }> {
  const inspection = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const run = inspection.runs.find((entry) => entry.id === snapshot.id);
  if (!run) {
    throw new WorkbenchCodedError("run_not_found", `Run not found: ${snapshot.id}`, {
      remediation: "workbench sync cloud",
      subject: { runId: snapshot.id },
      exitCode: 1,
    });
  }
  return { run, jobs: jobsForRuns(inspection, [run.id]) };
}

interface LocalRunTerminalResult {
  snapshot: WorkbenchRunSnapshot;
  run: WorkbenchRun;
  jobs: WorkbenchJob[];
  detached: boolean;
}

async function waitForLocalRunTerminal(input: {
  command: WorkbenchProgressCommand;
  core: { dir?: string; authToken?: string };
  initialSnapshot: WorkbenchRunSnapshot;
  io: CliIo;
  json?: boolean;
}): Promise<LocalRunTerminalResult> {
  const renderer = createProgressRenderer({ stderr: input.io.stderr, json: input.json === true });
  const startedAtMs = Date.now();
  const deadline = Date.now() + (positiveIntEnv("WORKBENCH_RUN_WATCH_TIMEOUT_MS") ?? CLOUD_RUN_TIMEOUT_MS);
  let detached = false;
  const onSigint = (): void => {
    detached = true;
    input.io.stderr.write(`workbench ${input.command}: detaching from local run (${displayRef(input.initialSnapshot.id)}).\n`);
  };
  process.once("SIGINT", onSigint);
  try {
    while (true) {
      const inspection = await createWorkbenchReadOnlyInspectionSnapshot(input.core);
      const run = inspection.runs.find((entry) => entry.id === input.initialSnapshot.id);
      if (!run) {
        throw new WorkbenchCodedError("run_not_found", `Run not found: ${input.initialSnapshot.id}`, {
          remediation: "workbench log --runs",
          subject: { runId: input.initialSnapshot.id },
          exitCode: 1,
        });
      }
      const jobs = jobsForRuns(inspection, [run.id]);
      const runSnapshot = createWorkbenchRunSnapshotForRun(run, jobs);
      const terminal = isTerminalRun(run);
      renderer.render(runProgressSnapshotForInspection({
        command: input.command,
        location: "local",
        phase: localProgressPhaseForRun(run, jobs, terminal),
        runs: [run],
        snapshot: inspection,
        startedAtMs,
        next: runWatchNextCommand(run),
      }), { force: terminal || detached, command: input.command });
      if (detached) {
        return { snapshot: runSnapshot, run, jobs, detached: true };
      }
      if (terminal) {
        return { snapshot: runSnapshot, run, jobs, detached: false };
      }
      const workerError = await localWorkerErrorForRun(inspection.root, run.id);
      if (workerError) {
        throw workerError;
      }
      if (Date.now() >= deadline) {
        throw new WorkbenchCodedError("run_pending", `Run ${run.id} is still ${run.status}.`, {
          retryable: true,
          remediation: `workbench run watch ${run.id}`,
          subject: { runId: run.id, status: run.status },
          exitCode: 1,
        });
      }
      await sleep(LOCAL_PROGRESS_POLL_INTERVAL_MS);
    }
  } finally {
    process.off("SIGINT", onSigint);
  }
}

function runFromSnapshot(snapshot: WorkbenchRunSnapshot): WorkbenchRun {
  const [measurement] = snapshot.measurements;
  return {
    id: snapshot.id,
    kind: snapshot.kind,
    versionId: snapshot.plan.versionId ?? measurement?.versionId ?? "",
    skillName: snapshot.plan.skills[0] ?? measurement?.skillName ?? "",
    skillBundleHash: measurement?.skillBundleHash ?? "",
    evalHash: snapshot.plan.evalHash ?? measurement?.evalHash ?? "",
    agentName: snapshot.plan.agents[0] ?? measurement?.agentName ?? "",
    agentHash: measurement?.agentHash ?? "",
    status: snapshot.status,
    traceIds: [],
    createdAt: new Date().toISOString(),
    location: snapshot.variant,
    ...(snapshot.plan.samples !== undefined ? { requestedSamples: snapshot.plan.samples } : {}),
  };
}

function localProgressPhaseForRun(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
  terminal: boolean,
): WorkbenchProgressPhase {
  if (terminal) {
    return "complete";
  }
  if (run.kind !== "improve") {
    return "running";
  }
  return jobs.some((job) => job.caseId !== "current") ? "proof_eval" : "improving";
}

function emitLocalDetach(
  schema: string,
  snapshot: WorkbenchRunSnapshot,
  parsed: ParsedArgs,
  io: CliIo,
  extra: Record<string, Json | undefined> = {},
): number {
  const next = `workbench run watch ${snapshot.id}`;
  if (parsed.flags.json === true) {
    io.stdout.write(`${JSON.stringify({
      schema,
      ok: false,
      code: "local_detached",
      message: "Detached from local run; it is still running.",
      detached: true,
      ...extra,
      run: runSnapshotResultJson(snapshot),
      next,
    }, null, 2)}\n`);
    return 130;
  }
  io.stdout.write(`Detached from run ${displayRef(snapshot.id)}.\nnext: ${next}\n`);
  return 130;
}

function runSnapshotResultJson(snapshot: WorkbenchRunSnapshot): Json {
  const { next: _next, ...result } = snapshot as unknown as Record<string, unknown>;
  return result as Json;
}

async function localImproveResultFromRun(
  core: { dir?: string; authToken?: string },
  run: WorkbenchRun,
): Promise<{
  version?: WorkbenchVersion;
  switched: boolean;
  promoted: boolean;
  promotionReason?: string;
}> {
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const version = run.outputVersionId
    ? snapshot.versions.find((entry) => entry.id === run.outputVersionId)
    : undefined;
  const switched = Boolean(version && snapshot.refs.current === version.id);
  return {
    ...(version ? { version } : {}),
    switched,
    promoted: switched,
    promotionReason: switched
      ? "proof eval promoted the candidate"
      : run.status === "succeeded" && version
        ? "proof eval did not beat the incumbent"
        : run.error,
  };
}

function formatImproveRunResult(
  snapshot: WorkbenchRunSnapshot,
  result: Awaited<ReturnType<typeof localImproveResultFromRun>>,
): string {
  const candidate = result.version ? displayRef(result.version.id) : displayRef(snapshot.id);
  return [
    result.switched
      ? `Improved current -> ${candidate}.`
      : `Created candidate ${candidate}.`,
    formatRunSnapshot(snapshot),
    result.switched
      ? "Switched to improved version after proof eval; rerun eval with more samples before publishing."
      : `Did not switch${result.promotionReason ? `: ${result.promotionReason}` : "."}`,
  ].join("\n");
}

function emitImproveOutcome(
  parsed: ParsedArgs,
  io: CliIo,
  snapshot: WorkbenchRunSnapshot,
  result: Awaited<ReturnType<typeof localImproveResultFromRun>>,
  next: string,
): number {
  const succeeded = snapshot.status === "succeeded";
  const body = {
    run: runSnapshotResultJson(snapshot),
    ...(result.version ? { version: versionSummary(result.version) } : {}),
    switched: result.switched,
    promoted: result.promoted,
    ...(result.promotionReason ? { promotionReason: result.promotionReason } : {}),
    next: next as Json,
  };
  if (parsed.flags.json === true) {
    const message = snapshot.result?.error ?? result.promotionReason ?? "Improve run failed; evidence was saved.";
    const remediation = adapterAuthRemediationFromErrorMessage(message);
    io.stdout.write(`${JSON.stringify({
      schema: "workbench.cli.improve.v1",
      ok: succeeded,
      ...(!succeeded
        ? {
            code: snapshot.status === "canceled" ? "improve_canceled" : "improve_failed",
            message,
            ...(remediation ? { remediation } : {}),
            retryable: false,
            evidenceSaved: true,
          }
        : {}),
      ...body,
    }, null, 2)}\n`);
    return succeeded ? 0 : 1;
  }
  io.stdout.write(`${formatImproveRunResult(snapshot, result)}\nnext: ${next}\n`);
  return succeeded ? 0 : 1;
}

async function handleImproveDryRun(parsed: ParsedArgs, io: CliIo): Promise<number> {
  let preview: WorkbenchImprovePreview;
  try {
    preview = await previewWorkbenchImprove({
      ...(await coreOptions(parsed)),
      skill: stringFlag(parsed, "skills"),
      agent: stringFlag(parsed, "agents"),
      samples: intFlag(parsed, "samples"),
      budget: intFlag(parsed, "budget"),
      cloud: parsed.flags.cloud === true,
    });
  } catch (error) {
    throw parsed.flags.cloud === true ? await cloudImproveErrorWithHostedRemediation(error, parsed) : error;
  }
  const readiness = parsed.flags.cloud === true
    ? await cloudDryRunReadiness("improve", parsed, preview)
    : preview.readiness;
  const plan = withPreviewReadiness(preview, readiness);
  const next = readiness.ready
    ? parsed.flags.cloud === true ? "workbench improve --cloud" : "workbench improve"
    : firstReadinessRemediation(readiness);
  return emitResult("workbench.cli.improve-plan.v1", {
    dryRun: true,
    plan: plan as unknown as Json,
    readiness: readiness as unknown as Json,
    next: next as Json,
  }, parsed, io, () => [
    `Would run improve ${plan.location}: version=${displayRef(plan.versionId)} eval=${plan.evalHash}`,
    `skill=${plan.skill.name} agent=${plan.agent.name} evidence=${plan.evidenceCount}`,
    `proof_cases=${plan.proofCases} samples=${plan.samples} budget=${plan.budget}`,
    ...(plan.incumbentRunId ? [`incumbent=${displayRef(plan.incumbentRunId)} score=${plan.incumbentScore ?? "n/a"}`] : []),
    ...formatLaunchReadinessLines(readiness),
    "No files or Workbench state were written.",
    ...(next ? [`next: ${next}`] : []),
  ].join("\n"));
}

function withPreviewReadiness<T extends WorkbenchEvalPreview | WorkbenchImprovePreview>(
  preview: T,
  readiness: WorkbenchLaunchReadiness,
): T {
  const { adapterAuthTargets: _adapterAuthTargets, ...publicPreview } = preview;
  return {
    ...publicPreview,
    readiness,
  } as T;
}

function firstReadinessRemediation(readiness: WorkbenchLaunchReadiness): string | null {
  return readiness.issues.find((issue) => issue.remediation)?.remediation ?? null;
}

function formatLaunchReadinessLines(readiness: WorkbenchLaunchReadiness): string[] {
  if (readiness.ready) {
    return ["readiness=ready"];
  }
  const lines = ["readiness=blocked"];
  for (const issue of readiness.issues) {
    lines.push(`blocked: ${issue.message}`);
    if (issue.remediation) {
      lines.push(`setup: ${issue.remediation}`);
    }
  }
  return lines;
}

async function handleStatus(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const core = await coreOptions(parsed);
  const status = await workbenchStatusSnapshot(core);
  const auth = await workbenchCliAuthStatus();
  const machine = await workbenchMachineStatus(auth, core);
  const inspection = status.project.initialized
    ? await createWorkbenchReadOnlyInspectionSnapshot(core).catch(() => null)
    : null;
  const cliStatus = statusWithActiveRunProgress(
    await statusWithCausalNext(status, auth, core, machine, inspection),
    inspection,
  );
  return emitResult("workbench.status.v1", {
    project: cliStatus.project as Json,
    worktree: cliStatus.worktree as Json,
    runs: cliStatus.runs as Json,
    remotes: cliStatus.remotes as Json,
    auth: auth as unknown as Json,
    machine: machine as unknown as Json,
    next: cliStatus.next as Json,
  }, parsed, io, () => formatStatusSnapshot({ ...cliStatus, auth, machine }));
}

async function handleLog(parsed: ParsedArgs, io: CliIo): Promise<number> {
  if (parsed.flags.runs === true && parsed.flags.versions === true) {
    throw new WorkbenchCodedError("usage", "workbench log accepts only one of --runs or --versions.", {
      remediation: "workbench log --runs",
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
      remediation: "workbench log",
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
      ...(scoredRunValue(run) !== undefined ? { score: scoredRunValue(run) } : {}),
    })) : []),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return emitResult("workbench.cli.log.v1", {
    entries: entries as unknown as Json,
  }, parsed, io, () => entries.map(formatLogEntry).join("\n") || "No history.");
}

type WorkbenchLogEntry =
  | { kind: "version"; id: string; createdAt: string; message: string; fileCount: number }
  | { kind: "run"; id: string; createdAt: string; status: string; versionId: string; skillName: string; agentName: string; score?: number };

async function handleRun(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const subcommand = requiredPositional(parsed, 1, "workbench run requires watch|cancel|retry.");
  if (subcommand === "watch") {
    rejectExtraInput(parsed, {
      maxPositionals: 3,
      message: "workbench run watch accepts exactly one RUN_ID.",
      remediation: "workbench run watch RUN_ID",
    });
    return await handleRunWatch(parsed, io);
  }
  if (subcommand === "cancel") {
    rejectExtraInput(parsed, {
      maxPositionals: 3,
      message: "workbench run cancel accepts exactly one RUN_ID.",
      remediation: "workbench run cancel RUN_ID",
    });
    return await handleRunCancel(parsed, io);
  }
  if (subcommand === "retry") {
    rejectExtraInput(parsed, {
      maxPositionals: 3,
      message: "workbench run retry accepts exactly one RUN_ID.",
      remediation: "workbench run retry RUN_ID",
    });
    return await handleRunRetry(parsed, io);
  }
  throw new WorkbenchCodedError("usage", `Unsupported run command: ${subcommand}.`, {
    remediation: "workbench run watch RUN_ID",
    exitCode: 2,
  });
}

async function handleRunWatch(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const runRef = requiredPositional(parsed, 2, "workbench run watch requires RUN_ID.");
  const core = await coreOptions(parsed);
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const run = requiredRunByRef(snapshot, runRef);
  const localHostedHandle = (run.location ?? "local") === "cloud"
    ? await hasWorkbenchLocalHostedRunHandle({ ...core, runId: run.id })
    : false;
  if (isTerminalRun(run)) {
    const jobs = jobsForRuns(snapshot, [run.id]);
    const progress = runProgressSnapshotForInspection({
      command: "run watch",
      location: run.location ?? "local",
      phase: "complete",
      runs: [run],
      snapshot,
      startedAtMs: timestampMs(run.createdAt) ?? Date.now(),
      next: runWatchNextCommand(run),
    });
    const runSnapshot = createWorkbenchRunSnapshotForRun(run, jobs);
    return emitRunTerminalResult("workbench.cli.run-watch.v1", {
      run: runSnapshotResultJson(runSnapshot),
      next: runWatchNextCommand(run) as Json,
    }, parsed, io, () => formatRunWatchResult(run, jobs, progress), runWatchExitCode(run));
  }
  if (localHostedHandle) {
    return await handleLocalHostedRunWatch(parsed, io, core, run);
  }
  if ((run.location ?? "local") === "cloud") {
    return await handleCloudRunWatch(parsed, io, core, snapshot, run);
  }
  return await handleLocalRunWatch(parsed, io, core, run);
}

async function handleLocalRunWatch(
  parsed: ParsedArgs,
  io: CliIo,
  core: { dir?: string; authToken?: string },
  initialRun: WorkbenchRun,
): Promise<number> {
  const renderer = createProgressRenderer({ stderr: io.stderr, json: parsed.flags.json === true });
  const startedAtMs = timestampMs(initialRun.createdAt) ?? Date.now();
  const deadline = Date.now() + (positiveIntEnv("WORKBENCH_RUN_WATCH_TIMEOUT_MS") ?? CLOUD_RUN_TIMEOUT_MS);
  let run = initialRun;
  let jobs: WorkbenchJob[] = [];
  let progress: WorkbenchRunSnapshot | undefined;
  while (true) {
    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
    run = snapshot.runs.find((entry) => entry.id === run.id) ?? run;
    jobs = jobsForRuns(snapshot, [run.id]);
    progress = runProgressSnapshotForInspection({
      command: "run watch",
      location: "local",
      phase: "running",
      runs: [run],
      snapshot,
      startedAtMs,
      next: runWatchNextCommand(run),
    });
    renderer.render(progress, { force: isTerminalRun(run), command: "run watch" });
    if (isTerminalRun(run)) {
      const runSnapshot = createWorkbenchRunSnapshotForRun(run, jobs);
      return emitRunTerminalResult("workbench.cli.run-watch.v1", {
        run: runSnapshotResultJson(runSnapshot),
        next: runWatchNextCommand(run) as Json,
      }, parsed, io, () => formatRunWatchResult(run, jobs, progress), runWatchExitCode(run));
    }
    if (Date.now() >= deadline) {
      throw new WorkbenchCodedError("run_pending", `Run ${run.id} is still ${run.status}.`, {
        retryable: true,
        remediation: `workbench run watch ${run.id}`,
        subject: { runId: run.id, status: run.status },
        exitCode: 1,
      });
    }
    await sleep(LOCAL_PROGRESS_POLL_INTERVAL_MS);
  }
}

async function handleCloudRunWatch(
  parsed: ParsedArgs,
  io: CliIo,
  core: { dir?: string; authToken?: string },
  snapshot: WorkbenchInspectionSnapshot,
  run: WorkbenchRun,
): Promise<number> {
  const context = await cloudRunContext(core, snapshot, run);
  const renderer = createProgressRenderer({ stderr: io.stderr, json: parsed.flags.json === true });
  const interrupt = createCloudInterruptController("run watch", io);
  interrupt.setRunIds([run.id]);
  try {
    const completed = await waitForCloudRun({
      command: "run watch",
      core: context.core,
      interrupt,
      renderer,
      remote: context.remote,
      run: createWorkbenchRunSnapshotForRun(run, jobsForRuns(snapshot, [run.id])),
      source: context.source,
      skillId: context.skillId,
      initialSync: {
        remote: context.remote,
        pushed: 0,
        pulled: 0,
        upToDate: true,
      } as Awaited<ReturnType<typeof syncWorkbenchRemote>>,
      startedAtMs: timestampMs(run.createdAt) ?? Date.now(),
    });
    if (completed.detached) {
      return emitRunTerminalResult("workbench.cli.run-watch.v1", {
        run: runSnapshotResultJson(completed.run),
        detached: true,
        next: `workbench run watch ${run.id}`,
      }, parsed, io, () => `Detached from run ${displayRef(run.id)}.\nnext: workbench run watch ${run.id}`, 130);
    }
    const { run: watchedRun, jobs } = await localRunStateForSnapshot(context.core, completed.run);
    const latest = await createWorkbenchReadOnlyInspectionSnapshot(context.core);
    const progress = runProgressSnapshotForInspection({
      command: "run watch",
      location: watchedRun.location ?? "cloud",
      phase: "complete",
      runs: [watchedRun],
      snapshot: latest,
      startedAtMs: timestampMs(watchedRun.createdAt) ?? Date.now(),
      next: runWatchNextCommand(watchedRun),
    });
    const runSnapshot = createWorkbenchRunSnapshotForRun(watchedRun, jobs);
    return emitRunTerminalResult("workbench.cli.run-watch.v1", {
      run: runSnapshotResultJson(runSnapshot),
      next: runWatchNextCommand(watchedRun) as Json,
    }, parsed, io, () => formatRunWatchResult(watchedRun, jobs, progress), runWatchExitCode(watchedRun));
  } finally {
    interrupt.dispose();
  }
}

async function handleLocalHostedRunWatch(
  parsed: ParsedArgs,
  io: CliIo,
  core: { dir?: string; authToken?: string },
  initialRun: WorkbenchRun,
): Promise<number> {
  const renderer = createProgressRenderer({ stderr: io.stderr, json: parsed.flags.json === true });
  const startedAtMs = timestampMs(initialRun.createdAt) ?? Date.now();
  const deadline = Date.now() + (positiveIntEnv("WORKBENCH_RUN_WATCH_TIMEOUT_MS") ?? CLOUD_RUN_TIMEOUT_MS);
  let run = initialRun;
  while (true) {
    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
    run = snapshot.runs.find((entry) => entry.id === run.id) ?? run;
    const jobs = jobsForRuns(snapshot, [run.id]);
    const terminal = isTerminalRun(run);
    const progress = runProgressSnapshotForInspection({
      command: "run watch",
      location: "cloud",
      phase: terminal ? "complete" : "queued",
      runs: [run],
      snapshot,
      startedAtMs,
      next: runWatchNextCommand(run),
    });
    renderer.render(progress, { force: terminal, command: "run watch" });
    if (terminal) {
      const runSnapshot = createWorkbenchRunSnapshotForRun(run, jobs);
      return emitRunTerminalResult("workbench.cli.run-watch.v1", {
        run: runSnapshotResultJson(runSnapshot),
        next: runWatchNextCommand(run) as Json,
      }, parsed, io, () => formatRunWatchResult(run, jobs, progress), runWatchExitCode(run));
    }
    if (!await hasWorkbenchLocalHostedRunHandle({ ...core, runId: run.id })) {
      return await handleCloudRunWatch(parsed, io, core, snapshot, run);
    }
    if (Date.now() >= deadline) {
      throw new WorkbenchCodedError("run_pending", `Run ${run.id} is still waiting for Workbench Cloud to accept it.`, {
        retryable: true,
        remediation: `workbench run watch ${run.id}`,
        subject: { runId: run.id, status: run.status },
        exitCode: 1,
      });
    }
    await sleep(LOCAL_PROGRESS_POLL_INTERVAL_MS);
  }
}

async function handleRunCancel(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const runRef = requiredPositional(parsed, 2, "workbench run cancel requires RUN_ID.");
  const core = await coreOptions(parsed);
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const run = requiredRunByRef(snapshot, runRef);
  if (isTerminalRun(run)) {
    throw new WorkbenchCodedError("run_terminal", `Run ${run.id} is already ${run.status}.`, {
      remediation: `workbench show ${run.id}`,
      subject: { runId: run.id, status: run.status },
      exitCode: 2,
    });
  }
  if ((run.location ?? "local") === "cloud") {
    if (await hasWorkbenchLocalHostedRunHandle({ ...core, runId: run.id })) {
      const requested = await requestLocalWorkbenchRunCancellation({ ...core, runId: run.id, reason: "user_requested" });
      const canceledRun = await recordWorkbenchLocalHostedRunCancellation({
        ...core,
        run: requested.run,
        requestedAt: requested.requestedAt,
      });
      const runSnapshot = createWorkbenchRunSnapshotForRun(canceledRun, []);
      const next = runWatchNextCommand(canceledRun);
      return emitResult("workbench.cli.run-cancel.v1", {
        run: runSnapshotResultJson(runSnapshot),
        requestedAt: requested.requestedAt,
        next: next as Json,
      }, parsed, io, () => [
        `Canceled hosted run ${displayRef(canceledRun.id)} before Workbench Cloud accepted it.`,
        `next: ${next}`,
      ].join("\n"));
    }
    const context = await cloudRunContext(core, snapshot, run);
    const response = await apiRequest<{ run?: WorkbenchRun; jobs?: WorkbenchJob[] }>(
      `/api/workbench/skills/${encodeURIComponent(context.skillId)}/runs/${encodeURIComponent(run.id)}/cancel`,
      {
        method: "POST",
        body: {
          schema: "workbench.remote.run.cancel-request.v1",
          reason: "user_requested",
        },
      },
      context.source.baseUrl,
    );
    const canceledRun = response.run ?? run;
    const jobs = response.jobs ?? [];
    const runSnapshot = createWorkbenchRunSnapshotForRun(canceledRun, jobs);
    const next = runWatchNextCommand(canceledRun);
    return emitResult("workbench.cli.run-cancel.v1", {
      run: runSnapshotResultJson(runSnapshot),
      next: next as Json,
    }, parsed, io, () => [
      `Cancellation requested for ${displayRef(canceledRun.id)}.`,
      ...(next ? [`next: ${next}`] : []),
    ].join("\n"));
  }
  const result = await requestLocalWorkbenchRunCancellation({ ...core, runId: run.id, reason: "user_requested" });
  const runSnapshot = createWorkbenchRunSnapshotForRun(result.run, jobsForRuns(snapshot, [result.run.id]));
  return emitResult("workbench.cli.run-cancel.v1", {
    run: runSnapshotResultJson(runSnapshot),
    requestedAt: result.requestedAt,
    next: `workbench run watch ${result.run.id}`,
  }, parsed, io, () => [
    `Cancellation requested for ${displayRef(result.run.id)}.`,
    `next: workbench run watch ${result.run.id}`,
  ].join("\n"));
}

async function handleRunRetry(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const runRef = requiredPositional(parsed, 2, "workbench run retry requires RUN_ID.");
  const core = await coreOptions(parsed);
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const run = requiredRunByRef(snapshot, runRef);
  const retryPlan = resolveWorkbenchRunRetryPlan(snapshot, run);
  if (retryPlan.location === "cloud") {
    return await retryCloudRun(parsed, io, core, snapshot, run, retryPlan);
  }
  const request = retryOperationRequest(retryPlan, "local", run.id);
  const started = await startPrivateLocalWorkbenchOperation({
    core,
    request,
  });
  const completed = await waitForLocalRunTerminal({
    command: "run retry",
    core,
    initialSnapshot: started.snapshot,
    io,
    json: parsed.flags.json === true,
  });
  if (completed.detached) {
    return emitLocalDetach("workbench.cli.run-retry.v1", completed.snapshot, parsed, io, {
      retryOfRunId: run.id,
    });
  }
  return emitRetryResult(parsed, io, run, [completed.run], completed.snapshot);
}

async function retryCloudRun(
  parsed: ParsedArgs,
  io: CliIo,
  core: { dir?: string; authToken?: string },
  snapshot: WorkbenchInspectionSnapshot,
  run: WorkbenchRun,
  retryPlan: WorkbenchRunRetryPlan,
): Promise<number> {
  const remoteContext = await cloudRemoteRunContext(core, snapshot, run);
  const renderer = createProgressRenderer({ stderr: io.stderr, json: parsed.flags.json === true });
  const interrupt = createCloudInterruptController("run retry", io);
  const startedAtMs = Date.now();
  const renderCloudProgress = (
    phase: WorkbenchProgressPhase,
    runs: readonly WorkbenchRun[] = [],
    jobs: readonly WorkbenchJob[] = [],
  ): void => {
    renderer.render(runProgressSnapshotFromRuns({
      command: "run retry",
      location: "cloud",
      phase,
      runs,
      jobs,
      startedAtMs,
    }), { command: "run retry" });
  };
  const runId = createWorkbenchRunId();
  const prescheduledRun = createPrescheduledCloudRetryRun({
    remoteName: remoteContext.remote.name,
    retryOfRun: run,
    retryPlan,
    runId,
  });
  let prescheduledRunForCleanup: WorkbenchRun | null = prescheduledRun;
  try {
    interrupt.setRunIds([runId]);
    await recordWorkbenchLocalHostedRunHandle({ ...remoteContext.core, run: prescheduledRun });
    renderCloudProgress("queued", [prescheduledRun]);
    await abortIfLocalHostedRunCanceled("run retry", remoteContext.core, prescheduledRun);
    const syncBefore = await cloudPreScheduleStepWithLocalCancel(
      "run retry",
      interrupt,
      remoteContext.core,
      prescheduledRun,
      (signal) => withProgressHeartbeat(
        io,
        "workbench run retry: syncing with Workbench Cloud",
        async () => await syncWorkbenchRemote({ ...remoteContext.core, remote: remoteContext.remote.name, signal }),
        {
          hint: `Run ${displayRef(runId)} is waiting for Cloud acceptance; resume with workbench run watch ${runId} or cancel with workbench run cancel ${runId}.`,
          immediate: parsed.flags.json !== true,
          json: parsed.flags.json === true,
        },
      ),
    );
    await abortIfLocalHostedRunCanceled("run retry", remoteContext.core, prescheduledRun);
    const skillId = await cloudPreScheduleStep("run retry", interrupt, resolveCloudSkillId(remoteContext.source));
    await abortIfLocalHostedRunCanceled("run retry", remoteContext.core, prescheduledRun);
    const retryRequest = retryOperationRequest(retryPlan, "cloud", run.id, runId);
    const response = await cloudPreScheduleStep(
      "run retry",
      interrupt,
      withProgressHeartbeat(
        io,
        "workbench run retry: scheduling hosted run",
        async () => await apiRequest<WorkbenchRunSnapshot>(
          `/api/workbench/skills/${encodeURIComponent(skillId)}/workbench/operations`,
          {
            method: "POST",
            body: retryRequest,
          },
          remoteContext.source.baseUrl,
        ),
        {
          hint: `Run ${displayRef(runId)} is waiting for Cloud acceptance; resume with workbench run watch ${runId} or cancel with workbench run cancel ${runId}.`,
          immediate: parsed.flags.json !== true,
          json: parsed.flags.json === true,
        },
      ),
    );
    if (response.schema !== "workbench.run.v1" || !response.id) {
      throw new WorkbenchCodedError("cloud_run_missing", "Workbench Cloud did not return a retry run.", {
        retryable: true,
        remediation: `workbench run retry ${run.id}`,
        exitCode: 1,
      });
    }
    if (response.id !== runId) {
      throw new WorkbenchCodedError("cloud_run_id_mismatch", "Workbench Cloud returned a different run id for hosted retry.", {
        retryable: true,
        remediation: `workbench run watch ${runId}`,
        subject: { expectedRunId: runId, actualRunId: response.id, remote: remoteContext.remote.name, skillId },
        exitCode: 1,
      });
    }
    interrupt.setRunIds([response.id]);
    await cancelAcceptedCloudRunIfLocallyRequested({
      command: "run retry",
      core: remoteContext.core,
      remoteName: remoteContext.remote.name,
      source: remoteContext.source,
      skillId,
      run: response,
    });
    await recordWorkbenchCloudRunSnapshot({ ...remoteContext.core, remoteName: remoteContext.remote.name, run: response });
    await clearWorkbenchLocalHostedRunHandle({ ...remoteContext.core, runId });
    prescheduledRunForCleanup = null;
    const completed = await waitForCloudRun({
      command: "run retry",
      core: remoteContext.core,
      interrupt,
      renderer,
      remote: remoteContext.remote,
      run: response,
      source: remoteContext.source,
      skillId,
      initialSync: syncBefore,
      startedAtMs: runSnapshotStartedAtMs(response),
    });
    if (completed.detached) {
      return emitRunTerminalResult("workbench.cli.run-retry.v1", {
        retryOfRunId: run.id,
        run: runSnapshotResultJson(completed.run),
        detached: true,
        cloud: {
          remote: remoteContext.remote.name,
          url: remoteContext.remote.url,
          skillId,
          sync: {
            before: cloudSyncSummary(syncBefore),
            after: cloudSyncSummary(completed.sync),
          },
        },
        next: `workbench run watch ${completed.run.id}`,
      }, parsed, io, () => `Detached from retry ${displayRef(completed.run.id)}.\nnext: workbench run watch ${completed.run.id}`, 130);
    }
    const { run: retryRun, jobs } = await localRunStateForSnapshot(remoteContext.core, completed.run);
    const runSnapshot = createWorkbenchRunSnapshotForRun(retryRun, jobs);
    return emitRetryResult(parsed, io, run, [retryRun], runSnapshot, {
      remote: remoteContext.remote.name,
      url: remoteContext.remote.url,
      skillId,
      sync: {
        before: cloudSyncSummary(syncBefore),
        after: cloudSyncSummary(completed.sync),
      },
    });
  } catch (error) {
    if (
      prescheduledRunForCleanup &&
      !(error instanceof WorkbenchCodedError && (error.code === "cloud_canceled" || error.code === "cloud_detached"))
    ) {
      await recordWorkbenchLocalHostedRunFailure({
        ...remoteContext.core,
        run: prescheduledRunForCleanup,
        error: singleLine(errorMessage(error)),
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    interrupt.dispose();
  }
}

function requiredRunByRef(snapshot: WorkbenchInspectionSnapshot, ref: string): WorkbenchRun {
  const run = snapshotObjectByRef(snapshot.runs, ref, "run");
  if (!run) {
    throw new WorkbenchCodedError("run_not_found", `Run not found: ${ref}.`, {
      remediation: "workbench log --runs",
      subject: { ref },
      exitCode: 1,
    });
  }
  return run;
}

async function cloudRunContext(
  core: { dir?: string; authToken?: string },
  snapshot: WorkbenchInspectionSnapshot,
  run: WorkbenchRun,
): Promise<{
  core: { dir?: string; authToken?: string };
  remote: WorkbenchRemote;
  source: ParsedWorkbenchInstallSource;
  skillId: string;
}> {
  const context = await cloudRemoteRunContext(core, snapshot, run);
  return {
    ...context,
    skillId: await resolveCloudSkillId(context.source),
  };
}

async function cloudRemoteRunContext(
  core: { dir?: string; authToken?: string },
  snapshot: WorkbenchInspectionSnapshot,
  run: WorkbenchRun,
): Promise<{
  core: { dir?: string; authToken?: string };
  remote: WorkbenchRemote;
  source: ParsedWorkbenchInstallSource;
}> {
  const remote = run.remoteName
    ? snapshot.remotes.find((entry) => entry.name === run.remoteName)
    : preferredCloudRemote(snapshot.remotes);
  if (!remote) {
    throw new WorkbenchCodedError("remote_not_found", `Run ${run.id} was hosted, but no Workbench Cloud remote is linked locally.`, {
      remediation: "workbench sync cloud",
      subject: {
        runId: run.id,
        ...(run.remoteName ? { remoteName: run.remoteName } : {}),
      },
      exitCode: 1,
    });
  }
  const source = parseWorkbenchInstallSource(remote.url);
  if (!source) {
    throw new WorkbenchCodedError("remote_invalid_url", `Workbench remote is not a Cloud skill URL: ${remote.url}`, {
      remediation: "workbench publish",
      subject: { remote: remote.name, url: remote.url },
      exitCode: 2,
    });
  }
  const token = await workbenchCloudToken({ baseUrl: source.baseUrl });
  if (!token) {
    throw new WorkbenchCodedError("auth_required", `Run ${run.id} requires Workbench Cloud auth.`, {
      remediation: workbenchLoginRemediation(source.baseUrl),
      subject: { runId: run.id },
      exitCode: 1,
    });
  }
  return {
    core: { ...core, authToken: token },
    remote,
    source,
  };
}

function emitRetryResult(
  parsed: ParsedArgs,
  io: CliIo,
  oldRun: WorkbenchRun,
  runs: readonly WorkbenchRun[],
  runSnapshot: WorkbenchRunSnapshot,
  cloud?: Json,
): number {
  const code = runs.some((run) => run.status === "failed" || run.status === "canceled") ? 1 : 0;
  const first = runs[0];
  return emitRunTerminalResult("workbench.cli.run-retry.v1", {
    retryOfRunId: oldRun.id,
    run: runSnapshotResultJson(runSnapshot),
    ...(cloud ? { cloud } : {}),
    next: first ? runWatchNextCommand(first) as Json : "workbench log --runs",
  }, parsed, io, () => [
    `Retried ${displayRef(oldRun.id)}${first ? ` as ${displayRef(first.id)}` : ""}.`,
    ...runs.map(formatRun),
    ...(first ? [`next: ${runWatchNextCommand(first)}`] : []),
  ].join("\n"), code);
}

function emitRunTerminalResult(
  schema: string,
  body: Record<string, Json | undefined>,
  parsed: ParsedArgs,
  io: CliIo,
  text: () => string,
  code: number,
): number {
  if (parsed.flags.json === true) {
    io.stdout.write(`${JSON.stringify({ schema, ok: true, ...body }, null, 2)}\n`);
  } else {
    io.stdout.write(`${text()}\n`);
  }
  return code;
}

function runWatchExitCode(run: WorkbenchRun): number {
  return isTerminalRun(run) ? 0 : 1;
}

function runWatchNextCommand(run: WorkbenchRun): string {
  if (run.status === "queued" || run.status === "running") {
    return `workbench run watch ${run.id}`;
  }
  if (run.status === "failed" || run.status === "canceled") {
    return `workbench show ${run.id}`;
  }
  return "workbench compare";
}

function showRunNextCommand(run: WorkbenchRun): string | null {
  const next = runWatchNextCommand(run);
  return next === `workbench show ${run.id}` ? null : next;
}

function formatRunWatchResult(run: WorkbenchRun, jobs: readonly WorkbenchJob[], progress?: WorkbenchRunSnapshot): string {
  const failed = jobs.filter((job) => job.status === "failed").length;
  const canceled = jobs.filter((job) => job.status === "canceled").length;
  return [
    formatRun(run),
    ...(progress ? [`progress=${formatProgressSummary(progress)}`] : []),
    `jobs=${jobs.length} failed=${failed}${canceled > 0 ? ` canceled=${canceled}` : ""}`,
    `next: ${runWatchNextCommand(run)}`,
  ].join("\n");
}

function timestampMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function runSnapshotStartedAtMs(snapshot: WorkbenchRunSnapshot): number {
  return Date.now() - Math.max(0, snapshot.progress.elapsedMs);
}

async function handleShow(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const ref = requiredPositional(parsed, 1, "workbench show requires REF.");
  const core = await coreOptions(parsed);
  const evidenceSession = await showWorkbenchEvidenceSession(ref, core);
  if (evidenceSession) {
    return output(evidenceSession, parsed, io, () => formatSessionDetail(evidenceSession));
  }
  const session = await showLocalAgentSession(ref);
  if (session) {
    return output(session, parsed, io, () => formatSessionDetail(session));
  }
  const [objectRef, requestedPath] = splitShowRef(ref);
  if (requestedPath) {
    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
    const file = fileForSnapshotRef(snapshot, objectRef, requestedPath);
    if (file) {
      return output(file, parsed, io, () => formatShow(file));
    }
    const value = await showWorkbenchRef(ref, core);
    return output(value, parsed, io, () => formatShow(value));
  }
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const version = snapshotVersionByRef(snapshot, objectRef);
  if (version) {
    return output(fileListing("version", version.id, version.files), parsed, io, () => formatFileListing("version", version.id, version.files));
  }
  const selection = runOrJobEvidenceSelection(snapshot, objectRef);
  const details = evidenceDetailsForSelection(snapshot, selection);
  const evidenceFiles = evidenceFilesForSelection(snapshot, selection);
  if (selection.run || selection.jobs.length > 0 || details.length > 0 || evidenceFiles.length > 0) {
    const next = selection.run ? showRunNextCommand(selection.run) : null;
    const progress = selection.run
      ? runProgressSnapshotForInspection({
          command: "run watch",
          location: selection.run.location ?? "local",
          phase: progressPhaseForRun(selection.run),
          runs: [selection.run],
          snapshot,
          startedAtMs: timestampMs(selection.run.createdAt) ?? Date.now(),
          ...(next ? { next } : {}),
        })
      : undefined;
    const evidenceOwnerRef = selection.run?.id ?? (selection.jobs.length === 1 ? selection.jobs[0]!.id : objectRef);
    return output({
      ...(selection.run ? { run: runSummary(selection.run, []) } : {}),
      jobs: selection.jobs.map(jobEvidenceSummary),
      ...(progress ? { progress: progress as unknown as Json } : {}),
      failures: runFailureGroups(selection.jobs) as unknown as Json,
      details: details.map(evidenceDetailSummary),
      highlights: evidenceHighlights(evidenceFiles) as unknown as Json,
      files: evidenceFiles.map((file) => fileSummary(file, showFileRef(evidenceOwnerRef, file.path))),
      ...(next ? { next } : {}),
    }, parsed, io, () => selection.run
      ? formatRunEvidenceSummary(selection.run, selection.jobs, details, evidenceFiles, progress, next)
      : formatRunOrJobEvidence(selection.jobs, details, evidenceFiles, evidenceOwnerRef));
  }
  const trace = snapshotObjectByRef(snapshot.traces, objectRef, "trace");
  if (trace) {
    const files = trace.files.filter(isUserFacingTraceEvidenceFile);
    return output(fileListing("trace", trace.id, files), parsed, io, () => formatFileListing("trace", trace.id, files));
  }
  const artifact = snapshotObjectByRef(snapshot.artifacts, objectRef, "artifact");
  if (artifact) {
    return output(fileListing("artifact", artifact.id, artifact.files), parsed, io, () => formatFileListing("artifact", artifact.id, artifact.files));
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
    const config = parseWithFlags(parsed);
    validateAgentCommandConfig(config);
    const agent = await addWorkbenchAgent({
      ...(await coreOptions(parsed)),
      name,
      adapter,
      model: stringFlag(parsed, "model"),
      config,
    });
    return output(agent, parsed, io, () => `Configured agent ${formatAgent(agent)}.`);
  }
  if (subcommand === "rm") {
    const result = await removeWorkbenchAgent(requiredPositional(parsed, 2, "workbench agent rm requires NAME."), await coreOptions(parsed));
    return output(result, parsed, io, () => `Removed agent ${result.removed}.`);
  }
  throw new WorkbenchUserError(`Unsupported agent command: ${subcommand}`);
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
      remoteAdapterAuth: remote as unknown as Json,
    },
    parsed,
    io,
    () => `Connected ${formatAuthTarget(saved)} ${saved.method} auth v${saved.version}; remote provider auth: ${remote.sync}${remote.reason ? ` (${remote.reason})` : ""}.`,
  );
}

async function handleAdapterLogout(provider: string, parsed: ParsedArgs, io: CliIo): Promise<number> {
  const target = parseAuthTarget(provider, authProfileFlag(parsed));
  await localWorkbenchAdapterAuthStore(adapterAuthStoreRoot()).disconnect(target);
  const remote = await deleteAdapterConnectionRemote(target, parsed).catch((error: unknown) => {
    if (error instanceof WorkbenchCodedError && error.code === "auth_required") {
      return {
        status: "unknown" as const,
        sync: "skipped" as const,
        reason: "workbench_not_authenticated",
        remediation: "workbench login",
        workbenchCloud: { status: "not_authenticated" as const },
      };
    }
    throw error;
  });
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
      remoteAdapterAuth: remote as unknown as Json,
    },
    parsed,
    io,
    () => [
      `Disconnected ${formatAuthTarget(target)}; remote provider auth: ${remote.sync}${remote.reason ? ` (${remote.reason})` : ""}.`,
      `Native ${target.adapterId} CLI auth unchanged; remove native provider auth separately for clean-room validation when needed.`,
    ].join("\n"),
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
  if (kind === "positive-integer" || kind === "port") {
    const parsedValue = Number(value);
    if (kind === "positive-integer" && (!Number.isInteger(parsedValue) || parsedValue <= 0)) {
      throw new WorkbenchUserError(`--${name} must be a positive integer.`);
    }
    if (kind === "port" && (!Number.isInteger(parsedValue) || parsedValue < 0 || parsedValue > 65535)) {
      throw new WorkbenchUserError(
        `--${name} must be an integer between 0 and 65535.`,
      );
    }
  }
}

const CONFIG_SCHEMA = "workbench.cli.config.v1";
const DEFAULT_WORKBENCH_CLOUD_BASE_URL = "https://v2.workbench.ai";
const API_REQUEST_MAX_ATTEMPTS = 3;
const API_REQUEST_GZIP_THRESHOLD_BYTES = 1024 * 1024;
const CLOUD_RUN_TIMEOUT_MS = 30 * 60 * 1000;
const CLOUD_RUN_WAIT_MAX_MS = 25_000;
const CLOUD_RUN_WAIT_MIN_MS = 1_000;
const CLOUD_PROGRESS_RENDER_INTERVAL_MS = 1000;
const LOCAL_HOSTED_CANCEL_POLL_INTERVAL_MS = 250;
const LOGIN_WAIT_TIMEOUT_SECONDS = 120;

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
  const provider = optionalPositional(parsed, 1);
  if (provider) {
    if (parsed.positionals.length > 2) {
      throw new WorkbenchUserError("workbench login PROVIDER accepts only one provider argument.");
    }
    if (parsed.flags["start-only"] === true || parsed.flags.wait === true || parsed.flags.timeout !== undefined || parsed.flags["no-open"] === true) {
      throw new WorkbenchCodedError("usage", "Workbench Cloud login flags do not apply to provider login.", {
        remediation: `workbench login ${provider} --method ${authMethod(parsed, provider)}`,
        exitCode: 2,
      });
    }
    return await handleAdapterLogin(provider, parsed, io);
  }
  if (parsed.flags["start-only"] === true && parsed.flags.wait === true) {
    throw new WorkbenchCodedError("usage", "workbench login accepts only one of --start-only or --wait.", {
      remediation: "workbench login --start-only",
      exitCode: 2,
    });
  }
  const startOnly = parsed.flags["start-only"] === true ||
    (parsed.flags["no-open"] === true && parsed.flags.wait !== true && parsed.flags.timeout === undefined);
  const waitOnly = parsed.flags.wait === true;
  const timeoutSeconds = intFlag(parsed, "timeout");
  if (startOnly && timeoutSeconds !== undefined) {
    throw new WorkbenchCodedError("usage", "workbench login --timeout only applies with --wait.", {
      remediation: "workbench login --start-only",
      exitCode: 2,
    });
  }
  if (waitOnly && timeoutSeconds === undefined) {
    throw new WorkbenchCodedError("usage", "workbench login --wait requires --timeout N.", {
      remediation: `workbench login --wait --timeout ${LOGIN_WAIT_TIMEOUT_SECONDS}`,
      exitCode: 2,
    });
  }
  const config = await loadConfig();
  const explicitBaseUrl = stringFlag(parsed, "base-url");
  const pending = waitOnly ? await readPendingDeviceAuthorization(explicitBaseUrl) : null;
  const baseUrl = pending?.baseUrl ?? selectWorkbenchBaseUrl({
    explicitBaseUrl,
    configBaseUrl: config.baseUrl,
  });
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
      resume: `workbench login --wait --timeout ${LOGIN_WAIT_TIMEOUT_SECONDS}${parsed.flags.json === true ? " --json" : ""}`,
    }, parsed, io, () => `Open ${record.verification_uri_complete}\nCode: ${record.user_code}\nResume: workbench login --wait --timeout ${LOGIN_WAIT_TIMEOUT_SECONDS}`);
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
    token = await pollDeviceToken(baseUrl, record, timeoutSeconds, { json: parsed.flags.json === true });
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
  const adapterAuth = await uploadConnectedAdapterConnections(parsed);
  return emitResult("workbench.cli.login.v1", {
    status: "authenticated",
    baseUrl,
    ...(username ? { username } : {}),
    ...(token.expires_in !== undefined ? { expiresIn: token.expires_in } : {}),
    adapterAuth: adapterAuth as unknown as Json,
  }, parsed, io, () => [
    `Workbench Cloud: authenticated${username ? ` as ${username}` : ""}`,
    `Workbench API: ${baseUrl}`,
    formatAdapterAuthUploadSummary(adapterAuth),
  ].filter(Boolean).join("\n"));
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
  const tokenRemoved = tokenPresent;
  if (tokenPresent) {
    await writeConfig({ schema: CONFIG_SCHEMA, ...(baseUrl ? { baseUrl } : {}) });
  }
  return emitResult("workbench.cli.logout.v1", {
    ...(baseUrl ? { baseUrl } : {}),
    tokenPresent,
    revoke,
    tokenRemoved,
    adapterAuth: "unchanged",
  }, parsed, io, () => [
    `Logged out of Workbench${baseUrl ? ` (${baseUrl})` : ""}.`,
    `Token: ${tokenPresent ? "present" : "absent"}; revoke ${revoke}; token ${tokenRemoved ? "removed" : "unchanged"}.`,
    "Local adapter auth unchanged; run workbench logout PROVIDER to remove provider credentials.",
  ].join("\n"));
}

async function handleInstall(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const sourceInput = optionalPositional(parsed, 1);
  if (!sourceInput) {
    throw new WorkbenchCodedError("usage", "workbench install requires OWNER/SKILL or a Workbench Cloud skill URL.", {
      remediation: "workbench install OWNER/SKILL",
      exitCode: 2,
    });
  }
  rejectExtraInput(parsed, {
    maxPositionals: 2,
    message: "workbench install accepts one OWNER/SKILL or URL argument.",
    remediation: "workbench install OWNER/SKILL",
  });
  const source = await resolveWorkbenchInstallSourceInput(sourceInput);
  const workbenchSource = parseWorkbenchInstallSource(source);
  if (!workbenchSource) {
    throw new WorkbenchCodedError("usage", "workbench install requires a Workbench Cloud source URL.", {
      remediation: "workbench install OWNER/SKILL",
      exitCode: 2,
    });
  }
  const snapshot = await fetchWorkbenchInstallSourceSnapshot(workbenchSource, source);
  const sourceSummary = workbenchInstallSourceSummary(workbenchSource, snapshot);
  const result = await installSnapshotToSkillTargets({
    snapshot,
    overwrite: parsed.flags.yes === true,
    dryRun: parsed.flags["dry-run"] === true,
    requestedFor: stringFlag(parsed, "for"),
    global: parsed.flags.global === true,
    dir: dirFlag(parsed),
    provenance: {
      handle: `${workbenchSource.owner}/${workbenchSource.skill}`,
      versionId: snapshot.versionId,
      baseUrl: workbenchSource.baseUrl,
    },
  });
  return emitResult("workbench.cli.install.v2", {
    source: sourceSummary,
    ...installResultToJson(result),
    next: null,
    ...(parsed.flags["dry-run"] === true ? { dryRun: true } : {}),
  }, parsed, io, () => formatInstallOutcome(result, parsed.flags["dry-run"] === true));
}

async function handleSkills(parsed: ParsedArgs, io: CliIo): Promise<number> {
  rejectExtraInput(parsed, {
    maxPositionals: 1,
    message: "workbench skills does not accept positional arguments.",
    remediation: "workbench skills",
  });
  const inventory = await readInstalledSkillsInventory({
    requestedFor: stringFlag(parsed, "for"),
    global: parsed.flags.global === true,
    dir: dirFlag(parsed),
  });
  return emitResult("workbench.cli.skills.v1", installedInventoryToJson(inventory), parsed, io, () => formatInstalledInventory(inventory));
}

async function handleNewFrom(parsed: ParsedArgs, io: CliIo): Promise<number> {
  rejectExtraInput(parsed, {
    maxPositionals: 2,
    message: "workbench new --from accepts one destination directory.",
    remediation: "workbench new DIR --from OWNER/SKILL",
  });
  const destination = parsed.positionals[1] ?? dirFlag(parsed);
  if (!destination) {
    throw new WorkbenchCodedError("usage", "workbench new --from requires DIR.", {
      remediation: "workbench new DIR --from OWNER/SKILL",
      exitCode: 2,
    });
  }
  const sourceInput = requiredFlag(parsed, {
    flag: "from",
    usage: "workbench new --from requires OWNER/SKILL or a Workbench Cloud skill URL.",
    remediation: "workbench new DIR --from OWNER/SKILL",
  });
  const source = await resolveWorkbenchInstallSourceInput(sourceInput);
  const workbenchSource = parseWorkbenchInstallSource(source);
  if (!workbenchSource) {
    throw new WorkbenchCodedError("usage", "workbench new --from requires a Workbench Cloud source URL.", {
      remediation: "workbench new DIR --from OWNER/SKILL",
      exitCode: 2,
    });
  }
  const snapshot = await fetchWorkbenchInstallSourceSnapshot(workbenchSource, source);
  const status = await initWorkbenchSkill({
    dir: destination,
    agent: stringFlag(parsed, "agent"),
    model: stringFlag(parsed, "model"),
    auth: stringFlag(parsed, "auth"),
    adapterAuthStoreRoot: adapterAuthStoreRoot(),
  });
  const hydratedPaths = await hydrateWorkbenchProjectFromSource(status.root, snapshot);
  const hydratedStatus = await workbenchStatus({
    dir: status.root,
    adapterAuthStoreRoot: adapterAuthStoreRoot(),
  }).catch((error) => {
    if (error instanceof WorkbenchCodedError || error instanceof WorkbenchUserError) {
      return null;
    }
    throw error;
  });
  const versions = hydratedStatus ? [] : await listWorkbenchVersions({ dir: status.root });
  const project: NewFromProjectResult = {
    root: status.root,
    initialized: true,
    ...(hydratedStatus?.currentVersionId
      ? { currentVersionId: hydratedStatus.currentVersionId }
      : latestVersionIdByCreatedAt(versions) ? { currentVersionId: latestVersionIdByCreatedAt(versions) } : {}),
    ...(hydratedStatus?.defaultSkill ? { defaultSkill: hydratedStatus.defaultSkill } : {}),
    ...(hydratedStatus?.defaultAgent ? { defaultAgent: hydratedStatus.defaultAgent } : {}),
    createdPaths: status.createdPaths ?? [],
  };
  const hydratedSnapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: status.root });
  const next = snapshotHasAnyEvalCase(hydratedSnapshot)
    ? "workbench eval"
    : projectScopedNextCommand(status.root, authorEvalCaseCommand(hydratedSnapshot));
  return emitResult("workbench.cli.new.v1", {
    result: project as unknown as Json,
    source: workbenchInstallSourceSummary(workbenchSource, snapshot),
    hydratedPaths: hydratedPaths as unknown as Json,
    defaultAgent: project.defaultAgent as Json,
    next: next as Json,
  }, parsed, io, () => formatNewFromResult(project, snapshot, hydratedPaths, next));
}

function latestVersionIdByCreatedAt(versions: readonly WorkbenchVersion[]): string | undefined {
  return versions.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.id;
}

async function hydrateWorkbenchProjectFromSource(root: string, snapshot: WorkbenchInstallSourceSnapshot): Promise<string[]> {
  const files = snapshot.files
    .map((file): SurfaceSnapshotFile => ({
      path: normalizeInstallSnapshotPath(file.path),
      ...(file.kind ? { kind: file.kind } : {}),
      encoding: file.encoding === "base64" ? "base64" : "utf8",
      executable: file.executable === true,
      content: file.content,
    }))
    .filter((file) => isEditableWorkbenchSourcePath(file.path))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (!installPackageFiles(files).some((file) => file.path === "SKILL.md")) {
    throw new WorkbenchCodedError("install_failed", `Workbench source ${snapshot.owner}/${snapshot.name} does not contain SKILL.md.`, {
      subject: { source: `${snapshot.owner}/${snapshot.name}` },
      exitCode: 1,
    });
  }
  for (const file of files) {
    await writeSourceSnapshotFile(root, file);
  }
  return files.map((file) => file.path);
}

function isEditableWorkbenchSourcePath(filePath: string): boolean {
  const normalized = normalizeInstallSnapshotPath(filePath);
  if (!normalized.startsWith(".workbench/")) {
    return !normalized.startsWith(".agents/");
  }
  return normalized === ".workbench/eval.yaml" ||
    normalized === ".workbench/agents.yaml" ||
    normalized === ".workbench/skills.yaml" ||
    normalized.startsWith(".workbench/cases/") ||
    normalized.startsWith(".workbench/environment/");
}

async function writeSourceSnapshotFile(root: string, file: SurfaceSnapshotFile): Promise<void> {
  const filePath = path.join(root, file.path);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, file.encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content));
  if (file.executable) {
    await fs.chmod(filePath, 0o755);
  }
}

async function handleCloudEval(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const started = await startCloudExecution("eval", parsed, io);
  if (started.detached) {
    const next = cloudDetachedNextCommand(started.run);
    return emitCloudDetached("eval", {
      run: runSnapshotResultJson(started.run),
      next: next as Json,
      cloud: cloudExecutionSummary(started),
    }, parsed, io, () => [
      `Detached from hosted eval on ${started.remote.url}.`,
      formatRunSnapshot(started.run),
      ...(next ? [`next: ${next}`] : []),
    ].filter(Boolean).join("\n"));
  }
  const { run, jobs } = await localRunStateForSnapshot(started.core, started.run);
  const runs = [run];
  const snapshot = createWorkbenchRunSnapshotForRun(run, jobs);
  const artifactIds = await artifactIdsByRunId(started.core, runs);
  const failedRuns = runs.filter((entry) => entry.status === "failed" || entry.status === "canceled");
  const coverage = await evalCoverageSummaries(started.core, runs);
  const deltas = await evalDeltas(started.core, runs);
  if (failedRuns.length > 0) {
    return emitEvalFailure(snapshot, failedRuns, artifactIds, coverage, deltas, parsed, io);
  }
  const next = await evalSuccessNextCommand(started.core, runs);
  return emitResult("workbench.cli.eval.v1", {
    run: runSnapshotResultJson(snapshot),
    coverage: coverage as unknown as Json,
    deltas: deltas as unknown as Json,
    next: next as Json,
    cloud: cloudExecutionSummary(started),
  }, parsed, io, () => [
    `Completed hosted eval on ${started.remote.url}.`,
    formatRunSnapshot(snapshot),
    ...formatEvalCoverageLines(coverage),
    ...formatEvalDeltaLines(deltas),
    ...(next ? [`next: ${next}`] : []),
  ].filter(Boolean).join("\n"));
}

async function handleCloudImprove(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const started = await startCloudExecution("improve", parsed, io);
  if (started.detached) {
    const next = cloudDetachedNextCommand(started.run);
    return emitCloudDetached("improve", {
      run: runSnapshotResultJson(started.run),
      next: next as Json,
      cloud: cloudExecutionSummary(started),
    }, parsed, io, () => [
      `Detached from hosted improve on ${started.remote.url}.`,
      formatRunSnapshot(started.run),
      ...(next ? [`next: ${next}`] : []),
    ].filter(Boolean).join("\n"));
  }
  const { run, jobs } = await localRunStateForSnapshot(started.core, started.run);
  const snapshot = createWorkbenchRunSnapshotForRun(run, jobs);
  const runs = [run];
  const failedRuns = runs.filter((entry) => entry.status === "failed" || entry.status === "canceled");
  if (failedRuns.length > 0) {
    const first = failedRuns[0]!;
    throw new WorkbenchCodedError("improve_failed", "Hosted improve failed; evidence was saved.", {
      remediation: `workbench show ${first.id}`,
      subject: {
        runIds: failedRuns.map((run) => run.id),
        statuses: Object.fromEntries(failedRuns.map((run) => [run.id, run.status])),
      },
      exitCode: 1,
    });
  }
  const switchedVersion = await switchHostedImproveVersionIfPromoted(started);
  if (switchedVersion) {
    await syncWorkbenchRemote({ ...started.core, remote: started.remote.name });
  }
  const next = cloudImproveNextCommand(snapshot);
  return emitResult("workbench.cli.improve.v1", {
    run: runSnapshotResultJson(snapshot),
    ...(switchedVersion ? { version: versionSummary(switchedVersion) } : {}),
    switched: Boolean(switchedVersion),
    promoted: Boolean(switchedVersion),
    next: next as Json,
    cloud: cloudExecutionSummary(started),
  }, parsed, io, () => [
    `Completed hosted improve on ${started.remote.url}.`,
    formatRunSnapshot(snapshot),
    ...(switchedVersion ? [`Switched local source to ${displayRef(switchedVersion.id)}.`] : []),
    ...(next ? [`next: ${next}`] : []),
  ].filter(Boolean).join("\n"));
}

function emitCloudDetached(
  command: "eval" | "improve",
  body: Record<string, Json | undefined>,
  parsed: ParsedArgs,
  io: CliIo,
  text: () => string,
): number {
  const next = typeof body.next === "string" ? body.next : "workbench log --runs";
  if (parsed.flags.json === true) {
    io.stdout.write(`${JSON.stringify({
      schema: "workbench.cli.error.v1",
      ok: false,
      code: "cloud_detached",
      message: `Detached from hosted ${command}; the hosted run is still active.`,
      retryable: true,
      remediation: next,
      detached: true,
      ...body,
    }, null, 2)}\n`);
  } else {
    io.stdout.write(`${text()}\n`);
  }
  return 130;
}

interface StartedCloudExecution {
  core: { dir?: string; authToken?: string };
  remote: WorkbenchRemote;
  skillId: string;
  run: WorkbenchRunSnapshot;
  detached?: boolean;
  startVersionId?: string;
  source: ParsedWorkbenchInstallSource;
  sync: {
    before: { pushed: number; pulled: number; upToDate: boolean };
    after: { pushed: number; pulled: number; upToDate: boolean };
  };
}

function formatInstallOutcome(
  result: WorkbenchInstallTargetsResult,
  dryRun: boolean,
): string {
  const firstTarget = result.targets[0];
  if (!firstTarget) {
    return "No install targets resolved.";
  }
  const targetSummary = result.targets.length === 1
    ? `${firstTarget.target} ${result.scope}`
    : result.targets.map((target) => `${target.target} ${target.scope}`).join(", ");
  const perTargetSummary = result.targets.map(formatInstallTargetOutcome).join("; ");
  if (dryRun) {
    if (result.targets.every((target) => target.previous === "unchanged")) {
      return `Already installed ${result.skill} for ${targetSummary} (unchanged; dry run made no changes).`;
    }
    if (result.targets.some((target) => target.previous === "updated")) {
      return `Would update ${result.skill} for ${targetSummary} (${formatFileCount(result.filesCopied)}).`;
    }
    if (result.targets.some((target) => target.previous === "overwritten")) {
      return `Would overwrite ${result.skill} for ${targetSummary} (${formatFileCount(result.filesCopied)}).`;
    }
    return `Would install ${result.skill} for ${targetSummary} (${formatFileCount(result.filesCopied)}).`;
  }
  if (result.result === "unchanged") {
    return `Already installed ${result.skill} for ${targetSummary} (unchanged).`;
  }
  if (result.targets.length > 1 && new Set(result.targets.map((target) => target.result)).size > 1) {
    return `${sentenceVerb(result.result)} ${result.skill}: ${perTargetSummary}.`;
  }
  if (result.targets.some((target) => target.previous === "updated")) {
    return `Updated ${result.skill} for ${targetSummary} (${formatFileCount(result.filesCopied)}).`;
  }
  const detail = result.targets.some((target) => target.previous === "overwritten")
    ? `overwrote existing copy, ${formatFileCount(result.filesCopied)}`
    : formatFileCount(result.filesCopied);
  return `Installed ${result.skill} for ${targetSummary} (${detail}).`;
}

function formatInstallTargetOutcome(target: WorkbenchInstallTargetResult): string {
  const targetName = `${target.target} ${target.scope}`;
  if (target.result === "unchanged") {
    return `${targetName} unchanged`;
  }
  if (target.previous === "updated") {
    return `${targetName} updated (${formatFileCount(target.filesCopied)})`;
  }
  if (target.previous === "overwritten") {
    return `${targetName} overwritten (${formatFileCount(target.filesCopied)})`;
  }
  return `${targetName} installed (${formatFileCount(target.filesCopied)})`;
}

function sentenceVerb(result: WorkbenchInstallTargetsResult["result"]): string {
  return result === "planned" ? "Would install" : result === "unchanged" ? "Already installed" : "Installed";
}

function formatFileCount(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

async function startCloudExecution(command: "eval" | "improve", parsed: ParsedArgs, io: CliIo): Promise<StartedCloudExecution> {
  const root = dirFlag(parsed) ?? process.cwd();
  const startedAtMs = Date.now();
  const renderer = createProgressRenderer({ stderr: io.stderr, json: parsed.flags.json === true });
  const renderCloudProgress = (
    phase: WorkbenchProgressPhase,
    runs: readonly WorkbenchRun[] = [],
    jobs: readonly WorkbenchJob[] = [],
  ): void => {
    renderer.render(runProgressSnapshotFromRuns({
      command,
      location: "cloud",
      phase,
      runs,
      jobs,
      startedAtMs,
    }), { command });
  };
  const interrupt = createCloudInterruptController(command, io);
  let prescheduledRunForCleanup: WorkbenchRun | null = null;
  try {
    const link = await cloudPreScheduleStep(command, interrupt, cloudRemoteLinkTarget(root));
    const plannedRemote = link.existing ?? await cloudPreScheduleStep(
      command,
      interrupt,
      derivePublishCloudRemote(parsed, "workbench --cloud", link.name),
    );
    const plannedSource = parseWorkbenchInstallSource(plannedRemote.url);
    if (!plannedSource) {
      throw new WorkbenchCodedError("remote_invalid_url", `Workbench remote is not a Cloud skill URL: ${plannedRemote.url}`, {
        remediation: "workbench publish",
        subject: { remote: plannedRemote.name, url: plannedRemote.url },
        exitCode: 2,
      });
    }
    const token = await workbenchCloudToken({ baseUrl: plannedSource.baseUrl });
    if (!token) {
      throw new WorkbenchCodedError("auth_required", `workbench ${command} --cloud requires Workbench Cloud auth.`, {
        remediation: workbenchLoginRemediation(plannedSource.baseUrl),
        exitCode: 1,
      });
    }
    const core = { dir: root, authToken: token };
    const preparedImproveRequest = command === "improve"
      ? await cloudPreScheduleStep(command, interrupt, prepareWorkbenchCloudImproveRequest({
          ...core,
          skill: stringFlag(parsed, "skills"),
          agent: stringFlag(parsed, "agents"),
          samples: intFlag(parsed, "samples"),
          budget: intFlag(parsed, "budget"),
        }))
      : undefined;
    const preview = command === "eval"
      ? await cloudPreScheduleStepWithProgress(command, interrupt, previewWorkbenchEval({
          ...core,
          skill: stringFlag(parsed, "skills"),
          agent: stringFlag(parsed, "agents"),
          samples: intFlag(parsed, "samples"),
          rerun: parsed.flags.rerun === true,
          cloud: true,
        }), () => renderCloudProgress("preflight"))
      : await cloudPreScheduleStepWithProgress(command, interrupt, previewWorkbenchImprove({
          ...core,
          skill: stringFlag(parsed, "skills"),
          agent: stringFlag(parsed, "agents"),
          samples: intFlag(parsed, "samples"),
          budget: intFlag(parsed, "budget"),
          cloud: true,
        }), () => renderCloudProgress("preflight"));
    const runId = createWorkbenchRunId();
    const prescheduledRun = createPrescheduledCloudRun({
      command,
      remoteName: plannedRemote.name,
      runId,
      preview,
      rerun: parsed.flags.rerun === true,
    });
    prescheduledRunForCleanup = prescheduledRun;
    interrupt.setRunIds([runId]);
    await recordWorkbenchLocalHostedRunHandle({ dir: root, run: prescheduledRun });
    renderCloudProgress("queued", [prescheduledRun]);
    await abortIfLocalHostedRunCanceled(command, core, prescheduledRun);
    const remote = await cloudPreScheduleStepWithLocalCancel(
      command,
      interrupt,
      core,
      prescheduledRun,
      async () => await ensureCloudRemoteForExecution(root, parsed, () => renderCloudProgress("queued", [prescheduledRun])),
    );
    const source = parseWorkbenchInstallSource(remote.url);
    if (!source) {
      throw new WorkbenchCodedError("remote_invalid_url", `Workbench remote is not a Cloud skill URL: ${remote.url}`, {
        remediation: "workbench publish",
        subject: { remote: remote.name, url: remote.url },
        exitCode: 2,
      });
    }
    const requestWithoutRunId = command === "eval"
      ? await cloudPreScheduleStepWithProgress(command, interrupt, prepareWorkbenchCloudEvalRequest({
          ...core,
          skill: stringFlag(parsed, "skills"),
          agent: stringFlag(parsed, "agents"),
          samples: intFlag(parsed, "samples"),
          rerun: parsed.flags.rerun === true,
        }), () => renderCloudProgress("queued", [prescheduledRun]))
      : preparedImproveRequest!;
    if (requestWithoutRunId.versionId !== preview.versionId) {
      throw new WorkbenchCodedError("source_changed", `Source changed while preparing hosted ${command}.`, {
        remediation: `workbench ${command} --cloud`,
        subject: {
          plannedVersionId: preview.versionId,
          preparedVersionId: requestWithoutRunId.versionId,
        },
        exitCode: 1,
      });
    }
    const adapterAuthTargets = cloudAdapterAuthTargetsFromPreview(preview);
    if (adapterAuthTargets.length > 0) {
      await cloudPreScheduleStepWithProgress(command, interrupt, assertCloudAdapterAuthConnected({
        baseUrl: source.baseUrl,
        targets: adapterAuthTargets,
      }), () => renderCloudProgress("provider_auth", [prescheduledRun]));
    }
    const request = { ...requestWithoutRunId, runId };
    const syncBefore = await cloudPreScheduleStepWithLocalCancel(
      command,
      interrupt,
      core,
      prescheduledRun,
      (signal) => withProgressHeartbeat(
        io,
        `workbench ${command}: syncing with Workbench Cloud`,
        async () => await syncWorkbenchRemote({ ...core, remote: remote.name, signal }),
        {
          hint: `Run ${displayRef(runId)} is waiting for Cloud acceptance; resume with workbench run watch ${runId} or cancel with workbench run cancel ${runId}.`,
          immediate: parsed.flags.json !== true,
          json: parsed.flags.json === true,
        },
      ),
    );
    await abortIfLocalHostedRunCanceled(command, core, prescheduledRun);
    const skillId = await cloudPreScheduleStep(command, interrupt, resolveCloudSkillId(source));
    await abortIfLocalHostedRunCanceled(command, core, prescheduledRun);
    const response = await cloudPreScheduleStep(
      command,
      interrupt,
      withProgressHeartbeat(
        io,
        `workbench ${command}: scheduling hosted run`,
        async () => await apiRequest<WorkbenchRunSnapshot>(
          `/api/workbench/skills/${encodeURIComponent(skillId)}/workbench/operations`,
          { method: "POST", body: cloudExecutionRequestBody(command, request) },
          source.baseUrl,
        ),
        {
          hint: `Run ${displayRef(runId)} is waiting for Cloud acceptance; resume with workbench run watch ${runId} or cancel with workbench run cancel ${runId}.`,
          immediate: parsed.flags.json !== true,
          json: parsed.flags.json === true,
        },
      ),
    );
    if (response.schema !== "workbench.run.v1" || !response.id) {
      throw new WorkbenchCodedError("cloud_run_missing", `Workbench Cloud did not return a run for ${command}.`, {
        retryable: true,
        remediation: "workbench log --runs",
        subject: { remote: remote.name, skillId },
        exitCode: 1,
      });
    }
    if (response.id !== runId) {
      throw new WorkbenchCodedError("cloud_run_id_mismatch", `Workbench Cloud returned a different run id for hosted ${command}.`, {
        retryable: true,
        remediation: `workbench run watch ${runId}`,
        subject: { expectedRunId: runId, actualRunId: response.id, remote: remote.name, skillId },
        exitCode: 1,
      });
    }
    interrupt.setRunIds([response.id]);
    await cancelAcceptedCloudRunIfLocallyRequested({
      command,
      core,
      remoteName: remote.name,
      source,
      skillId,
      run: response,
    });
    await recordWorkbenchCloudRunSnapshot({ ...core, remoteName: remote.name, run: response });
    await clearWorkbenchLocalHostedRunHandle({ dir: root, runId });
    prescheduledRunForCleanup = null;
    const completed = await waitForCloudRun({
      command,
      core,
      interrupt,
      renderer,
      remote,
      run: response,
      source,
      skillId,
      initialSync: syncBefore,
      startedAtMs: runSnapshotStartedAtMs(response),
    });
    return {
      core,
      remote,
      skillId,
      run: completed.run,
      ...(completed.detached ? { detached: true } : {}),
      startVersionId: request.versionId,
      source,
      sync: {
        before: { pushed: syncBefore.pushed, pulled: syncBefore.pulled, upToDate: syncBefore.upToDate },
        after: { pushed: completed.sync.pushed, pulled: completed.sync.pulled, upToDate: completed.sync.upToDate },
      },
    };
  } catch (error) {
    if (
      prescheduledRunForCleanup &&
      !(error instanceof WorkbenchCodedError && (error.code === "cloud_canceled" || error.code === "cloud_detached"))
    ) {
      await recordWorkbenchLocalHostedRunFailure({
        dir: root,
        run: prescheduledRunForCleanup,
        error: singleLine(errorMessage(error)),
      }).catch(() => undefined);
    }
    throw command === "improve" ? await cloudImproveErrorWithHostedRemediation(error, parsed) : error;
  } finally {
    interrupt.dispose();
  }
}

async function cloudImproveErrorWithHostedRemediation(error: unknown, parsed: ParsedArgs): Promise<unknown> {
  if (!(error instanceof WorkbenchCodedError) || !error.remediation) {
    return error;
  }
  let remediation = error.remediation.replace(/(^|&&\s*)workbench improve(?!\s+--cloud)\b/gu, "$1workbench improve --cloud");
  if (remediation.includes("workbench improve --cloud") && !hasWorkbenchCloudLoginCommand(remediation)) {
    const config = await loadConfig();
    const baseUrl = optionalWorkbenchBaseUrl({
      explicitBaseUrl: stringFlag(parsed, "base-url"),
      configBaseUrl: config.baseUrl,
    });
    if (!await workbenchCloudToken({ baseUrl })) {
      remediation = `${workbenchLoginRemediation(baseUrl)} && ${remediation}`;
    }
  }
  if (remediation === error.remediation) {
    return error;
  }
  return new WorkbenchCodedError(error.code, error.message, {
    retryable: error.retryable,
    remediation,
    ...(error.subject ? { subject: error.subject } : {}),
    exitCode: error.exitCode,
  });
}

function hasWorkbenchCloudLoginCommand(command: string): boolean {
  return command.split("&&").some((part) => {
    const trimmed = part.trim();
    return trimmed === "workbench login" || /^workbench login\s+--/u.test(trimmed);
  });
}

interface CloudInterruptController {
  readonly signal: Promise<void>;
  readonly interrupted: boolean;
  readonly runIds: readonly string[];
  setRunIds(runIds: readonly string[]): void;
  dispose(): void;
}

function createCloudInterruptController(
  command: WorkbenchProgressCommand,
  io: CliIo,
): CloudInterruptController {
  let interrupted = false;
  let runIds: readonly string[] = [];
  let resolveSignal: () => void = () => undefined;
  const signal = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });
  const onSigint = (): void => {
    interrupted = true;
    if (runIds.length > 0) {
      io.stderr.write(`workbench ${command}: detaching from hosted run (${runIds.map(displayRef).join(", ")}).\n`);
    }
    resolveSignal();
  };
  process.once("SIGINT", onSigint);
  return {
    signal,
    get interrupted() {
      return interrupted;
    },
    get runIds() {
      return runIds;
    },
    setRunIds(nextRunIds: readonly string[]) {
      runIds = [...nextRunIds];
    },
    dispose() {
      process.off("SIGINT", onSigint);
    },
  };
}

async function cloudPreScheduleStep<T>(
  command: WorkbenchProgressCommand,
  interrupt: CloudInterruptController,
  step: Promise<T>,
): Promise<T> {
  if (interrupt.interrupted) {
    throw cloudInterruptedBeforeScheduleFinishedError(command, interrupt.runIds);
  }
  return await Promise.race([
    step,
    interrupt.signal.then(() => {
      throw cloudInterruptedBeforeScheduleFinishedError(command, interrupt.runIds);
    }),
  ]);
}

async function cloudPreScheduleStepWithLocalCancel<T>(
  command: WorkbenchProgressCommand,
  interrupt: CloudInterruptController,
  core: { dir?: string; authToken?: string },
  run: WorkbenchRun,
  step: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const abortController = new AbortController();
  let stopped = false;
  const cancelSignal = (async (): Promise<T> => {
    while (!stopped) {
      if (await hasWorkbenchLocalRunCancellationRequest({ ...core, runId: run.id })) {
        await abortIfLocalHostedRunCanceled(command, core, run);
      }
      await sleep(LOCAL_HOSTED_CANCEL_POLL_INTERVAL_MS);
    }
    return await new Promise<T>(() => undefined);
  })();
  try {
    return await Promise.race([
      cloudPreScheduleStep(command, interrupt, step(abortController.signal)),
      cancelSignal,
    ]);
  } finally {
    stopped = true;
    abortController.abort();
  }
}

async function cloudPreScheduleStepWithProgress<T>(
  command: WorkbenchProgressCommand,
  interrupt: CloudInterruptController,
  step: Promise<T>,
  renderProgress: () => void,
): Promise<T> {
  return await withCloudProgressRendering(
    cloudPreScheduleStep(command, interrupt, step),
    renderProgress,
  );
}

async function cancelAcceptedCloudRunIfLocallyRequested(input: {
  command: WorkbenchProgressCommand;
  core: { dir?: string; authToken?: string };
  remoteName: string;
  source: ParsedWorkbenchInstallSource;
  skillId: string;
  run: WorkbenchRunSnapshot;
}): Promise<void> {
  if (!await hasWorkbenchLocalRunCancellationRequest({ ...input.core, runId: input.run.id })) {
    return;
  }
  const response = await apiRequest<{ run?: WorkbenchRun; jobs?: WorkbenchJob[] }>(
    `/api/workbench/skills/${encodeURIComponent(input.skillId)}/runs/${encodeURIComponent(input.run.id)}/cancel`,
    {
      method: "POST",
      body: {
        schema: "workbench.remote.run.cancel-request.v1",
        reason: "user_requested",
      },
    },
    input.source.baseUrl,
  );
  const canceledRun = response.run;
  const jobs = response.jobs ?? [];
  if (canceledRun) {
    await recordWorkbenchCloudRunSnapshot({
      ...input.core,
      remoteName: input.remoteName,
      run: createWorkbenchRunSnapshotForRun(canceledRun, jobs),
    });
  }
  await clearWorkbenchLocalHostedRunHandle({ ...input.core, runId: input.run.id }).catch(() => undefined);
  throw new WorkbenchCodedError("cloud_canceled", `Hosted ${input.command} was canceled after Workbench Cloud accepted the run.`, {
    remediation: `workbench show ${input.run.id}`,
    subject: { runId: input.run.id, status: canceledRun?.status ?? "canceled" },
    exitCode: 130,
  });
}

async function withCloudProgressRendering<T>(
  step: Promise<T>,
  renderProgress: () => void,
): Promise<T> {
  renderProgress();
  const interval = setInterval(renderProgress, CLOUD_PROGRESS_RENDER_INTERVAL_MS);
  try {
    return await step;
  } finally {
    clearInterval(interval);
  }
}

async function abortIfLocalHostedRunCanceled(
  command: WorkbenchProgressCommand,
  core: { dir?: string; authToken?: string },
  run: WorkbenchRun,
): Promise<void> {
  if (!await hasWorkbenchLocalRunCancellationRequest({ ...core, runId: run.id })) {
    return;
  }
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const latestRun = snapshot.runs.find((entry) => entry.id === run.id) ?? run;
  let canceledRun = latestRun;
  if (await hasWorkbenchLocalHostedRunHandle({ ...core, runId: run.id })) {
    const requested = isTerminalRun(latestRun)
      ? { run: latestRun, requestedAt: latestRun.cancelRequestedAt ?? latestRun.finishedAt ?? new Date().toISOString() }
      : await requestLocalWorkbenchRunCancellation({ ...core, runId: run.id, reason: "user_requested" });
    canceledRun = await recordWorkbenchLocalHostedRunCancellation({
      ...core,
      run: requested.run,
      requestedAt: requested.requestedAt,
    });
  }
  throw new WorkbenchCodedError("cloud_canceled", `Hosted ${command} was canceled before Workbench Cloud accepted the run.`, {
    remediation: `workbench show ${canceledRun.id}`,
    subject: { runId: canceledRun.id, status: canceledRun.status },
    exitCode: 130,
  });
}

function cloudCanceledBeforeRunIdError(command: WorkbenchProgressCommand): WorkbenchCodedError {
  return new WorkbenchCodedError("cloud_canceled", `Hosted ${command} was canceled before Workbench Cloud returned a run id.`, {
    remediation: hostedCommandRemediation(command),
    exitCode: 130,
  });
}

function cloudInterruptedBeforeScheduleFinishedError(command: WorkbenchProgressCommand, runIds: readonly string[]): WorkbenchCodedError {
  const runId = runIds[0];
  if (!runId) {
    return cloudCanceledBeforeRunIdError(command);
  }
  return new WorkbenchCodedError("cloud_detached", `Detached from hosted ${command} before Workbench Cloud confirmed scheduling.`, {
    retryable: true,
    remediation: `workbench run watch ${runId}`,
    subject: { runId },
    exitCode: 130,
  });
}

function hostedCommandRemediation(command: WorkbenchProgressCommand): string {
  if (command === "eval" || command === "improve") {
    return `workbench ${command} --cloud`;
  }
  return "workbench log --runs";
}

async function assertCloudAdapterAuthConnected(input: {
  baseUrl: string;
  targets: readonly CloudAdapterAuthTarget[];
}): Promise<void> {
  const readiness = await cloudAdapterAuthReadiness(input);
  const issue = readiness.issues[0];
  if (!issue) {
    return;
  }
  throw new WorkbenchCodedError("adapter_auth_required", issue.message, {
    remediation: issue.remediation,
    subject: issue.subject as Record<string, Json> | undefined,
    exitCode: 1,
  });
}

async function cloudDryRunReadiness(
  command: "eval" | "improve",
  parsed: ParsedArgs,
  preview: WorkbenchEvalPreview | WorkbenchImprovePreview,
): Promise<WorkbenchLaunchReadiness> {
  const config = await loadConfig();
  const baseUrl = optionalWorkbenchBaseUrl({ configBaseUrl: config.baseUrl });
  const token = await workbenchCloudToken({ baseUrl });
  if (!token) {
    return {
      ready: false,
      issues: [{
        code: "auth_required",
        message: `workbench ${command} --dry-run --cloud requires Workbench Cloud auth.`,
        remediation: workbenchLoginRemediation(baseUrl),
      }],
    };
  }
  const targets = cloudAdapterAuthTargetsFromPreview(preview);
  return await cloudAdapterAuthReadiness({ baseUrl, targets });
}

function cloudAdapterAuthTargetsFromPreview(
  preview: WorkbenchEvalPreview | WorkbenchImprovePreview,
): CloudAdapterAuthTarget[] {
  return uniqueAdapterAuthTargets(preview.adapterAuthTargets
    .filter((target) => target.adapterId === "codex" || target.adapterId === "claude")
    .map(cloudAdapterAuthTargetFromWorkbench));
}

function cloudAdapterAuthTargetFromWorkbench(target: WorkbenchAdapterAuthTarget): CloudAdapterAuthTarget {
  return {
    adapterId: target.adapterId,
    profile: target.profile,
    ...(target.slot ? { slot: target.slot } : {}),
  };
}

async function cloudAdapterAuthReadiness(input: {
  baseUrl: string;
  targets: readonly CloudAdapterAuthTarget[];
}): Promise<WorkbenchLaunchReadiness> {
  const targets = uniqueAdapterAuthTargets(input.targets);
  if (targets.length === 0) {
    return { ready: true, issues: [] };
  }
  const statuses = await fetchCloudAdapterAuthStatuses(input.baseUrl);
  const issues = targets
    .filter((target) => !statuses.some((status) => adapterAuthStatusMatchesTarget(status, target)))
    .map((target) => ({
      code: "adapter_auth_required",
      message: `${formatCloudAdapterAuthTarget(target)} disconnected.`,
      remediation: workbenchProviderAuthSetupCommand(target.adapterId),
      subject: {
        adapterId: target.adapterId,
        profile: target.profile,
        ...(target.slot ? { slot: target.slot } : {}),
      } as Json,
    }));
  return { ready: issues.length === 0, issues };
}

interface CloudAdapterAuthTarget {
  adapterId: string;
  profile: string;
  slot?: string;
}

function uniqueAdapterAuthTargets(targets: readonly CloudAdapterAuthTarget[]): CloudAdapterAuthTarget[] {
  const byKey = new Map<string, CloudAdapterAuthTarget>();
  for (const target of targets) {
    byKey.set(adapterAuthTargetKey(target), target);
  }
  return [...byKey.values()].sort((left, right) => adapterAuthTargetKey(left).localeCompare(adapterAuthTargetKey(right)));
}

async function fetchCloudAdapterAuthStatuses(baseUrl: string): Promise<WorkbenchAdapterAuthStatusRecord[]> {
  const response = await apiRequest<{ adapters?: WorkbenchAdapterAuthStatusRecord[] }>(
    "/api/workbench/auth/adapters",
    {},
    baseUrl,
  );
  return response.adapters ?? [];
}

function adapterAuthStatusMatchesTarget(
  status: WorkbenchAdapterAuthStatusRecord,
  target: CloudAdapterAuthTarget,
): boolean {
  return status.status === "connected" &&
    status.adapterId === target.adapterId &&
    status.profile === target.profile &&
    (status.slot ?? undefined) === (target.slot ?? undefined);
}

function adapterAuthTargetKey(target: CloudAdapterAuthTarget): string {
  return `${target.adapterId}/${target.slot ?? "_"}/${target.profile}`;
}

function formatCloudAdapterAuthTarget(target: CloudAdapterAuthTarget): string {
  return `${target.adapterId}${target.slot ? `/${target.slot}` : ""}`;
}

async function waitForCloudRun(input: {
  command: WorkbenchProgressCommand;
  core: { dir?: string; authToken?: string };
  interrupt: CloudInterruptController;
  renderer: ReturnType<typeof createProgressRenderer>;
  remote: WorkbenchRemote;
  run: WorkbenchRunSnapshot;
  source: ParsedWorkbenchInstallSource;
  skillId: string;
  initialSync: Awaited<ReturnType<typeof syncWorkbenchRemote>>;
  startedAtMs: number;
}): Promise<{ run: WorkbenchRunSnapshot; sync: Awaited<ReturnType<typeof syncWorkbenchRemote>>; detached?: boolean }> {
  const runId = input.run.id;
  if (!runId) {
    throw new WorkbenchCodedError("cloud_run_missing", "Workbench Cloud did not return a run id.", {
      retryable: true,
      remediation: "workbench log --runs",
      exitCode: 1,
    });
  }
  let sync = input.initialSync;
  const timeoutMs = positiveIntEnv("WORKBENCH_CLOUD_RUN_TIMEOUT_MS") ?? CLOUD_RUN_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let envelope = await fetchCloudInspectionEnvelope(input.source.baseUrl, input.skillId);
  await recordWorkbenchCloudInspectionSnapshot({ ...input.core, remoteName: input.remote.name, snapshot: envelope.snapshot });
  let run = runForCloudInspectionEnvelope(envelope, runId) ?? runFromSnapshot(input.run);
  let jobs = jobsForRuns(envelope.snapshot, [runId]);
  let runSnapshot = input.run;
  const projectCurrentSnapshot = (phase: WorkbenchProgressPhase): WorkbenchRunSnapshot => {
    const projected = runProgressSnapshotForInspection({
      command: input.command,
      location: "cloud",
      phase,
      runs: [run],
      snapshot: envelope.snapshot,
      startedAtMs: input.startedAtMs,
    });
    runSnapshot = projected ?? runSnapshot;
    return runSnapshot;
  };
  const renderCurrentProgress = (): void => {
    input.renderer.render(projectCurrentSnapshot(cloudProgressPhase(input.command, [run], jobs)), { command: input.command });
  };
  const renderTerminalSyncProgress = (): void => {
    input.renderer.render(projectCurrentSnapshot("sync"), { command: input.command });
  };
  while (true) {
    input.renderer.render(projectCurrentSnapshot(cloudProgressPhase(input.command, [run], jobs)), { command: input.command });
    if (input.interrupt.interrupted) {
      return { run: runSnapshot, sync, detached: true };
    }
    if (isTerminalRun(run)) {
      const terminalSync = await Promise.race([
        withCloudProgressRendering(
          syncWorkbenchRemote({ ...input.core, remote: input.remote.name }),
          renderTerminalSyncProgress,
        ),
        input.interrupt.signal.then(() => null),
      ]);
      if (!terminalSync) {
        return { run: runSnapshot, sync, detached: true };
      }
      sync = terminalSync;
      if (input.interrupt.interrupted) {
        return { run: runSnapshot, sync, detached: true };
      }
      return { run: runSnapshot, sync };
    }
    if (Date.now() >= deadline) {
      throw new WorkbenchCodedError("cloud_run_pending", "Hosted Workbench run is still queued or running; no terminal result has been reported yet.", {
        retryable: true,
        remediation: `workbench run watch ${runId}`,
        subject: {
          runId,
          status: run.status,
          guidance: "Use the remediation command to resume hosted progress and refresh local evidence.",
        },
        exitCode: 1,
      });
    }
    const notice = await Promise.race([
      withCloudProgressRendering(
        fetchCloudInspectionNotice(
          input.source.baseUrl,
          input.skillId,
          envelope.cursor,
          cloudInspectionNoticeWaitTimeoutMs(deadline),
        ),
        renderCurrentProgress,
      ),
      input.interrupt.signal.then(() => null),
    ]);
    if (!notice) {
      return { run: runSnapshot, sync, detached: true };
    }
    if (input.interrupt.interrupted) {
      return { run: runSnapshot, sync, detached: true };
    }
    if (notice.type === "heartbeat" && notice.cursor === envelope.cursor) {
      continue;
    }
    envelope = await fetchCloudInspectionEnvelope(input.source.baseUrl, input.skillId);
    await recordWorkbenchCloudInspectionSnapshot({ ...input.core, remoteName: input.remote.name, snapshot: envelope.snapshot });
    run = runForCloudInspectionEnvelope(envelope, runId) ?? run;
    jobs = jobsForRuns(envelope.snapshot, [runId]);
  }
}

async function fetchCloudInspectionEnvelope(
  baseUrl: string,
  skillId: string,
): Promise<WorkbenchInspectionSnapshotEnvelope> {
  return await apiRequest<WorkbenchInspectionSnapshotEnvelope>(
    `/api/workbench/skills/${encodeURIComponent(skillId)}/workbench/snapshot`,
    {},
    baseUrl,
  );
}

async function fetchCloudInspectionNotice(
  baseUrl: string,
  skillId: string,
  cursor: string,
  timeoutMs: number,
): Promise<WorkbenchStateNotice> {
  return await apiRequest<WorkbenchStateNotice>(
    `/api/workbench/skills/${encodeURIComponent(skillId)}/workbench/state/wait?cursor=${encodeURIComponent(cursor)}&timeoutMs=${timeoutMs}`,
    {},
    baseUrl,
  );
}

function cloudInspectionNoticeWaitTimeoutMs(deadline: number): number {
  const remainingMs = deadline - Date.now();
  return Math.max(
    CLOUD_RUN_WAIT_MIN_MS,
    Math.min(CLOUD_RUN_WAIT_MAX_MS, Math.trunc(remainingMs)),
  );
}

function runForCloudInspectionEnvelope(
  envelope: WorkbenchInspectionSnapshotEnvelope,
  runId: string,
): WorkbenchRun | undefined {
  return envelope.snapshot.runs.find((run) => run.id === runId);
}

function jobsForRuns(snapshot: WorkbenchInspectionSnapshot, runIds: readonly string[]): WorkbenchJob[] {
  const selected = new Set(runIds);
  return snapshot.jobs.filter((job) => selected.has(job.runId));
}

function runProgressSnapshotForInspection(input: {
  command: WorkbenchProgressCommand;
  location: "local" | "cloud";
  phase: WorkbenchProgressPhase;
  runs: readonly WorkbenchRun[];
  snapshot: WorkbenchInspectionSnapshot;
  startedAtMs: number;
  evidence?: ProgressEvidenceCounts;
  next?: string;
}): WorkbenchRunSnapshot | undefined {
  const runIds = input.runs.map((run) => run.id);
  return runProgressSnapshotFromRuns({
    command: input.command,
    location: input.location,
    phase: input.phase,
    runs: input.runs,
    jobs: jobsForRuns(input.snapshot, runIds),
    evidence: {
      ...progressEvidenceCountsForRunIds(input.snapshot, runIds),
      ...(input.evidence ?? {}),
    },
    startedAtMs: input.startedAtMs,
    next: input.next,
  });
}

function progressEvidenceCountsForRunIds(
  snapshot: WorkbenchInspectionSnapshot,
  runIds: readonly string[],
  files?: readonly SurfaceSnapshotFile[],
  details?: readonly WorkbenchExecutionTraceDetail[],
): ProgressEvidenceCounts {
  const selected = new Set(runIds);
  const runs = snapshot.runs.filter((run) => selected.has(run.id));
  const jobs = snapshot.jobs.filter((job) => selected.has(job.runId));
  const artifactIds = new Set(jobs.flatMap((job) => job.artifactIds));
  const traceIds = new Set([
    ...runs.flatMap((run) => run.traceIds),
    ...jobs.flatMap((job) => job.traceIds),
  ]);
  const artifacts = snapshot.artifacts.filter((artifact) =>
    artifactIds.size > 0 ? artifactIds.has(artifact.id) : selected.has(artifact.runId)
  );
  const traces = snapshot.traces.filter((trace) =>
    traceIds.size > 0 ? traceIds.has(trace.id) : selected.has(trace.runId)
  );
  const resultFiles = files ? countResultFiles(files) : undefined;
  const fileSessionCount = files ? evidenceHighlights(files).filter((highlight) => highlight.kind === "agent_session").length : 0;
  const traceSessionCount = details
    ? details.reduce((sum, detail) =>
        sum + detail.executions.reduce((executionSum, execution) => executionSum + execution.sessions.length, 0), 0)
    : 0;
  return {
    ...(artifacts.length > 0 ? { artifacts: artifacts.length } : {}),
    ...(traces.length > 0 ? { traces: traces.length } : {}),
    ...(resultFiles && resultFiles > 0 ? { resultFiles } : {}),
    ...((fileSessionCount > 0 || traceSessionCount > 0) ? { sessions: Math.max(fileSessionCount, traceSessionCount) } : {}),
  };
}

function countResultFiles(files: readonly SurfaceSnapshotFile[]): number {
  return files.filter((file) => path.basename(file.path.replace(/\\/gu, "/")) === "result.json").length;
}

function cloudProgressPhase(
  command: WorkbenchProgressCommand,
  runs: readonly WorkbenchRun[],
  jobs: readonly WorkbenchJob[],
): WorkbenchProgressPhase {
  if (command === "eval" || (command !== "improve" && runs.every((run) => run.kind !== "improve"))) {
    return "running";
  }
  if (runs.length > 0 && runs.every((run) => run.status === "queued") && jobs.every((job) => job.status === "queued")) {
    return "running";
  }
  if (jobs.some((job) => job.caseId !== "current")) {
    return "proof_eval";
  }
  if (jobs.some((job) => job.caseId === "current" && job.status === "succeeded")) {
    return "applying_patch";
  }
  return "improving";
}

function isTerminalRun(run: WorkbenchRun): boolean {
  return run.status === "succeeded" || run.status === "failed" || run.status === "canceled";
}

function progressPhaseForRun(run: WorkbenchRun): WorkbenchProgressPhase {
  if (run.status === "queued") {
    return "queued";
  }
  return isTerminalRun(run) ? "complete" : "running";
}

async function switchHostedImproveVersionIfPromoted(started: StartedCloudExecution): Promise<WorkbenchVersion | undefined> {
  const outputVersionId = started.run.status === "succeeded" ? started.run.result?.improvedVersionId : undefined;
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
      remediation: `workbench switch ${outputVersionId}`,
      subject: {
        startedFrom: started.startVersionId,
        current: currentVersionId,
        hostedVersion: outputVersionId,
      },
      exitCode: 1,
    });
  }
  const version = await switchWorkbenchVersion(outputVersionId, started.core);
  return version;
}

async function fetchCloudObjectRefs(started: StartedCloudExecution): Promise<Record<string, string>> {
  const response = await apiRequest<{ objectPack?: { refs?: Record<string, string> } }>(
    `/api/workbench/skills/${encodeURIComponent(started.skillId)}/objects`,
    {},
    started.source.baseUrl,
  );
  return response.objectPack?.refs ?? {};
}

async function ensureCloudRemoteForExecution(
  root: string,
  parsed: ParsedArgs,
  renderProgress?: () => void,
): Promise<WorkbenchRemote> {
  const linked = await linkedCloudRemote(root);
  if (linked) {
    return linked;
  }
  const link = await cloudRemoteLinkTarget(root);
  let remote = await derivePublishCloudRemote(parsed, "workbench --cloud", link.name);
  const source = parseWorkbenchInstallSource(remote.url);
  if (!source) {
    throw new WorkbenchCodedError("remote_invalid_url", `Workbench remote is not a Cloud skill URL: ${remote.url}`, {
      remediation: "workbench publish",
      subject: { remote: remote.name, url: remote.url },
      exitCode: 2,
    });
  }
  const token = await workbenchCloudToken({ baseUrl: source.baseUrl });
  if (!token) {
    throw new WorkbenchCodedError("auth_required", "workbench --cloud requires Workbench Cloud auth.", {
      remediation: workbenchLoginRemediation(source.baseUrl),
      exitCode: 1,
    });
  }
  renderProgress?.();
  remote = await availableCloudRemoteForHostedAutoLink(remote);
  renderProgress?.();
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
  const skill = await getCloudSkillByHandle(source.baseUrl, source.owner, source.skill);
  if (!skill?.id) {
    throw new WorkbenchCodedError("remote_not_found", `Workbench Cloud skill not found: ${source.owner}/${source.skill}`, {
      remediation: "workbench publish",
      subject: { owner: source.owner, skill: source.skill },
      exitCode: 1,
    });
  }
  return skill.id;
}

function cloudExecutionRequestBody(
  command: "eval" | "improve",
  request: WorkbenchPreparedCloudEvalRequest | WorkbenchPreparedCloudImproveRequest,
): Record<string, Json | undefined> {
  const base = {
    kind: command,
    variant: "cloud",
    runId: request.runId,
    versionId: request.versionId,
    skill: request.skill,
    agent: request.agent,
    samples: request.samples,
  };
  if (command === "eval") {
    const evalRequest = request as WorkbenchPreparedCloudEvalRequest;
    return {
      ...base,
      ...(evalRequest.rerun === true ? { rerun: true } : {}),
    };
  }
  const improveRequest = request as WorkbenchPreparedCloudImproveRequest;
  return {
    ...base,
    budget: improveRequest.budget,
    evidenceTraceIds: improveRequest.evidenceTraceIds,
  };
}

function createPrescheduledCloudRun(input: {
  command: "eval" | "improve";
  remoteName: string;
  runId: string;
  preview: WorkbenchEvalPreview | WorkbenchImprovePreview;
  rerun?: boolean;
}): WorkbenchRun {
  const createdAt = new Date().toISOString();
  if (input.command === "eval") {
    const preview = input.preview as WorkbenchEvalPreview;
    if (preview.skills.length !== 1 || preview.agents.length !== 1) {
      throw new WorkbenchCodedError("cloud_selection_unsupported", "Hosted eval requires exactly one skill and one agent. Pass explicit skill and agent selectors.", {
        remediation: "workbench eval --cloud --skills SKILL --agents AGENT",
        exitCode: 2,
      });
    }
    const skill = preview.skills[0]!;
    const agent = preview.agents[0]!;
    return {
      id: input.runId,
      kind: "eval",
      versionId: preview.versionId,
      skillName: skill.name,
      skillBundleHash: skill.hash,
      evalHash: preview.evalHash,
      agentName: agent.name,
      agentHash: agent.hash,
      status: "queued",
      jobIds: [],
      traceIds: [],
      createdAt,
      location: "cloud",
      remoteName: input.remoteName,
      requestedSamples: preview.samples,
      operationPlan: {
        kind: "eval",
        variant: "cloud",
        versionId: preview.versionId,
        evalHash: preview.evalHash,
        skills: [skill.name],
        agents: [agent.name],
        samples: preview.samples,
        ...(input.rerun === true ? { rerun: true } : {}),
      },
      lastProgressAt: createdAt,
    };
  }
  const preview = input.preview as WorkbenchImprovePreview;
  return {
    id: input.runId,
    kind: "improve",
    versionId: preview.versionId,
    skillName: preview.skill.name,
    skillBundleHash: preview.skill.hash,
    evalHash: preview.evalHash,
    agentName: preview.agent.name,
    agentHash: preview.agent.hash,
    status: "queued",
    jobIds: [],
    traceIds: [],
    createdAt,
    location: "cloud",
    remoteName: input.remoteName,
    baseVersionId: preview.versionId,
    requestedSamples: preview.samples,
    requestedBudget: preview.budget,
    operationPlan: {
      kind: "improve",
      variant: "cloud",
      versionId: preview.versionId,
      evalHash: preview.evalHash,
      skills: [preview.skill.name],
      agents: [preview.agent.name],
      samples: preview.samples,
      budget: preview.budget,
    },
    lastProgressAt: createdAt,
  };
}

function createPrescheduledCloudRetryRun(input: {
  remoteName: string;
  retryOfRun: WorkbenchRun;
  retryPlan: WorkbenchRunRetryPlan;
  runId: string;
}): WorkbenchRun {
  const createdAt = new Date().toISOString();
  const versionId = input.retryPlan.kind === "improve"
    ? input.retryPlan.baseVersionId
    : input.retryPlan.versionId;
  return {
    id: input.runId,
    kind: input.retryPlan.kind,
    versionId,
    skillName: input.retryPlan.skillName,
    skillBundleHash: input.retryOfRun.skillBundleHash,
    evalHash: input.retryOfRun.evalHash,
    agentName: input.retryPlan.agentName,
    agentHash: input.retryOfRun.agentHash,
    status: "queued",
    jobIds: [],
    traceIds: [],
    createdAt,
    location: "cloud",
    remoteName: input.remoteName,
    retryOfRunId: input.retryOfRun.id,
    requestedSamples: input.retryPlan.samples,
    ...(input.retryPlan.kind === "improve"
      ? { baseVersionId: versionId, requestedBudget: input.retryPlan.budget }
      : {}),
    operationPlan: {
      kind: input.retryPlan.kind,
      variant: "cloud",
      versionId,
      evalHash: input.retryOfRun.evalHash,
      skills: [input.retryPlan.skillName],
      agents: [input.retryPlan.agentName],
      samples: input.retryPlan.samples,
      ...(input.retryPlan.kind === "eval" ? { rerun: true } : {}),
      ...(input.retryPlan.kind === "improve" ? { budget: input.retryPlan.budget } : {}),
      retryOfRunId: input.retryOfRun.id,
    },
    lastProgressAt: createdAt,
  };
}

function cloudImproveNextCommand(run: WorkbenchRunSnapshot): string | null {
  return cloudExecutionNextCommand(run, "workbench eval --rerun -n 5");
}

function cloudDetachedNextCommand(run: WorkbenchRunSnapshot): string | null {
  return cloudExecutionNextCommand(run, "workbench status");
}

function cloudExecutionNextCommand(run: WorkbenchRunSnapshot, successCommand: string): string | null {
  if (run.status === "queued" || run.status === "running" || run.status === "canceling") {
    return `workbench run watch ${displayRef(run.id)}`;
  }
  if (run.status === "failed" || run.status === "canceled") {
    return `workbench show ${displayRef(run.id)}`;
  }
  return successCommand;
}

function cloudExecutionSummary(started: StartedCloudExecution): Json {
  return {
    remote: started.remote.name,
    url: started.remote.url,
    skillId: started.skillId,
    runId: started.run.id,
    ...(started.detached ? { detached: true } : {}),
    sync: {
      before: cloudSyncSummary(started.sync.before),
      after: cloudSyncSummary(started.sync.after),
    },
  };
}

function cloudSyncSummary(sync: { pushed: number; pulled: number }): Json {
  return {
    status: "synced",
    pushed: sync.pushed,
    pulled: sync.pulled,
    changed: syncChanged(sync),
  };
}

function syncChanged(sync: { pushed: number; pulled: number }): boolean {
  return sync.pushed > 0 || sync.pulled > 0;
}

async function syncNextCommand(
  core: { dir?: string; authToken?: string },
  beforeRuns?: ReadonlyMap<string, string>,
): Promise<string | null> {
  if (beforeRuns) {
    const changedRun = await latestChangedRunAfterSync(core, beforeRuns);
    if (changedRun) {
      return `workbench show ${displayRef(changedRun.id)}`;
    }
  }
  const status = await workbenchStatusSnapshot(core);
  const auth = await workbenchCliAuthStatus();
  const cliStatus = await statusWithCausalNext(status, auth, core, {
    installedSkillCount: 0,
    targets: [],
    connectedProviders: [],
  });
  return cliStatus.next ?? null;
}

async function latestChangedRunAfterSync(
  core: { dir?: string; authToken?: string },
  beforeRuns: ReadonlyMap<string, string>,
): Promise<WorkbenchRun | null> {
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core).catch(() => null);
  const changedRuns = snapshot?.runs
    .filter((run) => beforeRuns.get(run.id) !== runEvidenceFingerprint(run))
    .sort((left, right) => runEvidenceTime(right).localeCompare(runEvidenceTime(left))) ?? [];
  return changedRuns[0] ?? null;
}

async function runEvidenceFingerprints(core: { dir?: string; authToken?: string }): Promise<Map<string, string>> {
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  return new Map(snapshot.runs.map((run) => [run.id, runEvidenceFingerprint(run)]));
}

function runEvidenceFingerprint(run: WorkbenchRun): string {
  return JSON.stringify({
    status: run.status,
    score: run.score,
    costUsd: run.costUsd,
    latencyMs: run.latencyMs,
    jobIds: run.jobIds ?? [],
    traceIds: run.traceIds,
    finishedAt: run.finishedAt,
    outputVersionId: run.outputVersionId,
    error: run.error,
  });
}

function runEvidenceTime(run: WorkbenchRun): string {
  return run.finishedAt ?? run.createdAt;
}

function writeCliProgress(parsed: ParsedArgs, io: CliIo, message: string, options: { json?: boolean } = {}): void {
  if (parsed.flags.json === true && options.json !== true) {
    return;
  }
  io.stderr.write(`${message}\n`);
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
  return {
    kind: "workbench-cloud",
    owner: snapshot.owner,
    skill: snapshot.name,
    versionId: snapshot.versionId,
    installHandle: `${snapshot.owner}/${snapshot.name}`,
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
    if (cloudError.code === "source_not_available" && token) {
      throw new WorkbenchCodedError(cloudError.code, `${cloudError.message} You are already logged in; verify the OWNER/SKILL handle or ask the owner for access.`, {
        retryable: false,
        ...(cloudError.subject ? { subject: { ...cloudError.subject, authenticated: true } } : { subject: { authenticated: true } }),
        exitCode: response.status === 400 ? 2 : 1,
      });
    }
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
      remediation: "workbench login",
      exitCode: 1,
    });
  }
  if (!response.ok) {
    const excerpt = readResponseError(text);
    throw new WorkbenchCodedError("install_failed", `Unable to download Workbench source ${displaySource}: ${response.status}${excerpt ? ` ${excerpt}` : response.statusText ? ` ${response.statusText}` : ""}`, {
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
    const code = (error as { code?: unknown })?.code;
    if (code === "ENOENT") {
      return null;
    }
    if (code === "EISDIR") {
      throw configPathDirectoryError(filePath);
    }
    throw error;
  }
}

async function writeConfig(config: WorkbenchConfig): Promise<void> {
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`).catch((error: unknown) => {
    if ((error as { code?: unknown })?.code === "EISDIR") {
      throw configPathDirectoryError(configPath());
    }
    throw error;
  });
}

function configPath(): string {
  return process.env.WORKBENCH_CONFIG?.trim() || path.join(os.homedir(), ".workbench", "config.json");
}

function configPathDirectoryError(filePath: string): WorkbenchCodedError {
  return new WorkbenchCodedError("usage", `WORKBENCH_CONFIG must point to a config file, not a directory: ${filePath}`, {
    remediation: "WORKBENCH_CONFIG=/path/to/config.json workbench status",
    subject: { env: "WORKBENCH_CONFIG", path: filePath },
    exitCode: 2,
  });
}

function deviceAuthPath(): string {
  return process.env.WORKBENCH_DEVICE_AUTH?.trim() || path.join(path.dirname(configPath()), "device-auth.json");
}

function selectWorkbenchBaseUrl(input: {
  explicitBaseUrl?: string;
  originBaseUrl?: string;
  configBaseUrl?: string;
} = {}): string {
  return optionalWorkbenchBaseUrl(input);
}

function optionalWorkbenchBaseUrl(input: {
  explicitBaseUrl?: string;
  originBaseUrl?: string;
  configBaseUrl?: string;
} = {}): string {
  const value =
    input.explicitBaseUrl ??
      input.originBaseUrl ??
      process.env.WORKBENCH_API_URL ??
      input.configBaseUrl ??
      DEFAULT_WORKBENCH_CLOUD_BASE_URL;
  return normalizeBaseUrl(value);
}

function workbenchLoginRemediation(baseUrl?: string): string {
  const normalized = baseUrl ? normalizeBaseUrl(baseUrl) : DEFAULT_WORKBENCH_CLOUD_BASE_URL;
  if (normalized === DEFAULT_WORKBENCH_CLOUD_BASE_URL) {
    return "workbench login";
  }
  return `workbench login --base-url ${normalized}`;
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
    if (isRetryableHttpStatus(response.status)) {
      throw deviceLoginUnavailableError("start", response.status, response.statusText, text);
    }
    const excerpt = readResponseError(text);
    throw new WorkbenchCodedError("login_denied", `Device login failed: ${response.status}${excerpt ? ` ${excerpt}` : response.statusText ? ` ${response.statusText}` : ""}`, {
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
  options: { json?: boolean } = {},
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
    if (isRetryableHttpStatus(response.status)) {
      throw deviceLoginUnavailableError("wait", response.status, response.statusText, text, options);
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
    remediation: loginWaitRemediation(options.json === true),
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

function deviceLoginUnavailableError(
  phase: "start" | "wait",
  status: number,
  statusText: string,
  text: string,
  options: { json?: boolean } = {},
): WorkbenchCodedError {
  const excerpt = readResponseError(text);
  const detail = `${status}${excerpt ? ` ${excerpt}` : statusText ? ` ${statusText}` : ""}`;
  const command = phase === "start"
    ? "workbench login --start-only --no-open"
    : loginWaitRemediation(options.json === true);
  return new WorkbenchCodedError("service_unavailable", `Workbench Cloud login is temporarily unavailable: ${detail}`, {
    retryable: true,
    remediation: command,
    exitCode: 1,
  });
}

function loginWaitRemediation(json: boolean): string {
  return `workbench login --wait --timeout ${LOGIN_WAIT_TIMEOUT_SECONDS}${json ? " --json" : ""}`;
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

async function readPendingDeviceAuthorization(baseUrl?: string): Promise<DeviceAuthorizationRecord | null> {
  const record = await readDeviceAuthorizationJson(deviceAuthPath());
  const expectedBaseUrl = baseUrl ? normalizeBaseUrl(baseUrl) : undefined;
  if (!record || (expectedBaseUrl && record.baseUrl !== expectedBaseUrl) || Date.parse(record.expiresAt) <= Date.now()) {
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
  const canRetry = isIdempotentApiRequestMethod(method);
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
      const excerpt = readResponseError(text);
      const requestError = new WorkbenchApiRequestError(
        response.status,
        `Request failed with status ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${excerpt ? `: ${excerpt}` : ""}.`,
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
      remediation: "workbench login",
    };
  }
  await apiRequest<{ ok: boolean; status: string }>(
    adapterConnectionApiPath(bundle),
    { method: "PUT", body: { bundle } },
  );
  return { status: "authenticated", sync: "uploaded" };
}

interface AdapterAuthUploadSummary {
  uploaded: Array<{ adapter: string; slot?: string; profile: string; version: number }>;
  skipped: Array<{ adapter: string; slot?: string; profile: string; reason: string }>;
}

async function uploadConnectedAdapterConnections(parsed: ParsedArgs): Promise<AdapterAuthUploadSummary> {
  const store = localWorkbenchAdapterAuthStore(adapterAuthStoreRoot());
  const uploaded: AdapterAuthUploadSummary["uploaded"] = [];
  const skipped: AdapterAuthUploadSummary["skipped"] = [];
  const statuses = await store.listStatus().catch(() => []);
  for (const status of statuses) {
    if (status.status !== "connected") {
      continue;
    }
    const target = {
      adapterId: status.adapterId,
      ...(status.slot ? { slot: status.slot } : {}),
      profile: status.profile,
    };
    const bundle = await store.get(target);
    if (!bundle) {
      skipped.push({
        adapter: status.adapterId,
        ...(status.slot ? { slot: status.slot } : {}),
        profile: status.profile,
        reason: "unavailable",
      });
      continue;
    }
    const remote = await uploadAdapterConnection(bundle, parsed);
    if (remote.sync === "uploaded") {
      uploaded.push({
        adapter: bundle.adapterId,
        ...(bundle.slot ? { slot: bundle.slot } : {}),
        profile: bundle.profile,
        version: bundle.version,
      });
    } else {
      skipped.push({
        adapter: bundle.adapterId,
        ...(bundle.slot ? { slot: bundle.slot } : {}),
        profile: bundle.profile,
        reason: remote.reason ?? "skipped",
      });
    }
  }
  return { uploaded, skipped };
}

function formatAdapterAuthUploadSummary(summary: AdapterAuthUploadSummary): string | null {
  if (summary.uploaded.length === 0 && summary.skipped.length === 0) {
    return null;
  }
  const uploaded = summary.uploaded.length > 0
    ? `uploaded ${summary.uploaded.map(formatAdapterAuthUploadTarget).join(", ")}`
    : "";
  const skipped = summary.skipped.length > 0
    ? `skipped ${summary.skipped.map((entry) => `${formatAdapterAuthUploadTarget(entry)} (${entry.reason})`).join(", ")}`
    : "";
  return `Provider auth: ${[uploaded, skipped].filter(Boolean).join("; ")}.`;
}

function formatAdapterAuthUploadTarget(target: { adapter: string; slot?: string; profile: string }): string {
  return `${target.adapter}${target.slot ? `/${target.slot}` : ""}/${target.profile}`;
}

async function deleteAdapterConnectionRemote(target: ReturnType<typeof parseWorkbenchAdapterAuthTarget>, parsed: ParsedArgs): Promise<{
  status: "disconnected" | "unchanged" | "unknown";
  sync: "deleted" | "skipped";
  reason?: string;
  remediation?: string;
  workbenchCloud: { status: "authenticated" | "not_authenticated" };
}> {
  const token = await workbenchCloudToken();
  if (parsed.flags["local-only"] === true) {
    return {
      status: "unchanged",
      sync: "skipped",
      reason: "local_only",
      workbenchCloud: { status: token ? "authenticated" : "not_authenticated" },
    };
  }
  if (!token) {
    return {
      status: "unknown",
      sync: "skipped",
      reason: "workbench_not_authenticated",
      remediation: "workbench login",
      workbenchCloud: { status: "not_authenticated" },
    };
  }
  await apiRequest<{ ok: boolean; status: string }>(
    adapterConnectionApiPath(target),
    { method: "DELETE" },
  );
  return { status: "disconnected", sync: "deleted", workbenchCloud: { status: "authenticated" } };
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
    return typeof error === "string" && error.trim() ? oneLineExcerpt(error) : null;
  } catch {
    if (/<(?:!doctype|html|head|body)\b/iu.test(text)) {
      return null;
    }
    return oneLineExcerpt(text);
  }
}

function oneLineExcerpt(text: string): string | null {
  const line = text.replace(/\s+/gu, " ").trim();
  if (!line) {
    return null;
  }
  return line.length > 180 ? `${line.slice(0, 177)}...` : line;
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
  return error instanceof WorkbenchApiRequestError && isRetryableHttpStatus(error.status);
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isIdempotentApiRequestMethod(method: string): boolean {
  return method === "GET" || method === "PUT" || method === "DELETE";
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
    return "oauth";
  }
  if (adapterId === "claude") {
    return "oauth";
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
        env: requiredEnvVars(
          ["OPENAI_API_KEY"],
          [],
          "OPENAI_API_KEY=... workbench login codex --method api-key",
        ),
      });
    }
    if (args.method === "oauth") {
      return createWorkbenchAdapterAuthBundle({
        target: args.target,
        method: args.method,
        files: [await requiredAuthFile(args.profileRoot, ".codex/auth.json", {
          provider: "Codex",
          remediation: codexOAuthRemediation(args.profileRoot),
        })],
      });
    }
  }
  if (adapterId === "claude") {
    if (args.method === "api-key") {
      return createWorkbenchAdapterAuthBundle({
        target: args.target,
        method: args.method,
        env: requiredEnvVars(
          ["ANTHROPIC_API_KEY"],
          [],
          "ANTHROPIC_API_KEY=... workbench login claude --method api-key",
        ),
      });
    }
    if (args.method === "oauth") {
      return createWorkbenchAdapterAuthBundle({
        target: args.target,
        method: args.method,
        files: await collectClaudeOAuthFiles(args.profileRoot),
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

function requiredEnvVars(
  required: readonly string[],
  optional: readonly string[] = [],
  remediation?: string,
): Record<string, string> {
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new WorkbenchCodedError("usage", `Missing required environment variable(s): ${missing.join(", ")}`, {
      ...(remediation ? { remediation } : {}),
      subject: { missingEnvVars: missing },
      exitCode: 2,
    });
  }
  return Object.fromEntries([...required, ...optional].flatMap((name) => {
    const value = process.env[name]?.trim();
    return value ? [[name, value]] : [];
  }));
}

async function requiredAuthFile(root: string, relativePath: string, guidance?: {
  provider: string;
  remediation: string;
}): Promise<WorkbenchAdapterAuthFile> {
  const file = await readAuthFile(root, relativePath);
  if (!file) {
    const absolute = path.join(root, relativePath);
    throw new WorkbenchCodedError("provider_oauth_missing", guidance
      ? `Missing ${guidance.provider} OAuth token file: ${absolute}`
      : `Missing auth file: ${absolute}`, {
      ...(guidance ? { remediation: guidance.remediation } : {}),
      subject: { path: absolute, relativePath },
      exitCode: 2,
    });
  }
  return file;
}

const CLAUDE_OAUTH_PROFILE_PATH = ".claude.json";
const CLAUDE_OAUTH_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";

async function collectClaudeOAuthFiles(root: string): Promise<WorkbenchAdapterAuthFile[]> {
  const [profile] = await optionalAuthFiles(root, [CLAUDE_OAUTH_PROFILE_PATH]);
  const envTokenRaw = process.env[CLAUDE_OAUTH_TOKEN_ENV]?.trim();
  const envToken = envTokenRaw ? parseClaudeOauthTokenEnv(envTokenRaw) : null;
  if (profile && envTokenRaw && !envToken) {
    throw new WorkbenchCodedError(
      "provider_oauth_invalid",
      claudeOAuthInvalidMessage(root),
      {
        remediation: claudeOAuthRemediation(root),
        subject: { env: CLAUDE_OAUTH_TOKEN_ENV },
        exitCode: 2,
      },
    );
  }
  if (profile && envToken) {
    return [
      profile,
      {
        path: ".claude/oauth-token",
        content: `${envToken}\n`,
        encoding: "utf8",
        mode: 0o600,
      },
    ];
  }
  throw new WorkbenchCodedError(
    "provider_oauth_missing",
    claudeOAuthMissingMessage(root),
    {
      remediation: claudeOAuthRemediation(root),
      subject: {
        ...(!profile ? {
          path: path.join(root, CLAUDE_OAUTH_PROFILE_PATH),
          relativePath: CLAUDE_OAUTH_PROFILE_PATH,
        } : {}),
        ...(!envToken ? { env: CLAUDE_OAUTH_TOKEN_ENV } : {}),
      },
      exitCode: 2,
    },
  );
}

function codexOAuthRemediation(profileRoot: string): string {
  const rootFlag = profileRootFlag(profileRoot);
  const codexHome = path.join(profileRoot, ".codex");
  const loginPrefix = rootFlag ? `mkdir -p ${shellQuote(codexHome)} && CODEX_HOME=${shellQuote(codexHome)} ` : "";
  return `${loginPrefix}codex login --device-auth && workbench login codex --method oauth${rootFlag}`;
}

function claudeOAuthRemediation(profileRoot: string): string {
  return `claude setup-token && CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth${profileRootFlag(profileRoot)}`;
}

function claudeOAuthMissingMessage(profileRoot: string): string {
  return `Claude OAuth capture requires Claude Code's profile and the OAuth token printed by claude setup-token. Run ${claudeOAuthRemediation(profileRoot)}.`;
}

function claudeOAuthInvalidMessage(profileRoot: string): string {
  return `${CLAUDE_OAUTH_TOKEN_ENV} must be the OAuth token printed by claude setup-token. Run ${claudeOAuthRemediation(profileRoot)}.`;
}

function profileRootFlag(profileRoot: string): string {
  return path.resolve(profileRoot) === path.resolve(os.homedir()) ? "" : ` --profile-root ${shellQuote(profileRoot)}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function parseClaudeOauthTokenEnv(value: string): string | null {
  const lines = value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\r/gu, "")
    .split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    const firstSegment = line?.match(/sk-ant-oat\d{2}-[A-Za-z0-9_-]*/iu)?.[0];
    if (!firstSegment) {
      continue;
    }
    const segments = [firstSegment];
    for (
      let continuationIndex = index + 1;
      continuationIndex < lines.length;
      continuationIndex += 1
    ) {
      const continuation = lines[continuationIndex]?.trim();
      if (!continuation || !/^[A-Za-z0-9_-]+$/u.test(continuation)) {
        break;
      }
      segments.push(continuation);
    }
    const token = segments.join("");
    return value.replace(/\s/gu, "") === token ? token : null;
  }
  return null;
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

async function showWorkbenchEvidenceSession(
  ref: string,
  core: { dir?: string; authToken?: string },
): Promise<LocalAgentSessionDetail | null> {
  if (!isAgentSessionRef(ref)) {
    return null;
  }
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core).catch((error: unknown) => {
    if (error instanceof WorkbenchUserError && /not initialized/u.test(error.message)) {
      return null;
    }
    throw error;
  });
  return snapshot ? evidenceSessionDetailForRef(snapshot, ref) : null;
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
  if (!isAgentSessionRef(ref)) {
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

function isAgentSessionRef(ref: string): boolean {
  return ref.startsWith("codex:") || ref.startsWith("claude:");
}

function evidenceSessionDetailForRef(snapshot: InspectionSnapshot, ref: string): LocalAgentSessionDetail | null {
  const jobs = snapshot.jobs
    .slice()
    .sort((left, right) =>
      (right.finishedAt ?? right.startedAt ?? right.createdAt).localeCompare(left.finishedAt ?? left.startedAt ?? left.createdAt) ||
      right.id.localeCompare(left.id)
    );
  for (const job of jobs) {
    const files = evidenceFilesForSelection(snapshot, { jobs: [job] });
    const sessionFile = files
      .filter((file) => file.encoding === "utf8" && path.basename(file.path.replace(/\\/gu, "/")) === "agent-session.json")
      .map((file) => ({ file, record: parseJsonRecord(file.content) }))
      .find((entry) => entry.record && agentSessionEvidenceRefMatches(entry.record, ref));
    if (!sessionFile?.record) {
      continue;
    }
    const source = agentSessionSource(ref);
    const run = snapshot.runs.find((entry) => entry.id === job.runId);
    const output = files.find((file) =>
      file.encoding === "utf8" &&
      path.basename(file.path.replace(/\\/gu, "/")) === "skill-summary.md" &&
      file.content.trim().length > 0
    );
    const updatedAt = job.finishedAt ?? job.startedAt ?? job.createdAt;
    const runLocation = run?.location === "cloud" ? "Hosted" : run?.location === "local" ? "Local" : "Agent";
    const title = [
      run?.kind ? `${runLocation} ${run.kind}` : `${runLocation} session`,
      `case ${job.caseId}`,
      `sample ${job.sample + 1}`,
      job.status,
    ].join(" ");
    const excerpts = [
      `Evidence file: ${sessionFile.file.path}`,
      `Run ${job.runId}; job ${job.id}; status ${job.status}.`,
      ...(output ? ["", "Agent output:", ...previewBlock(output.content, 1200, 12).split("\n")] : []),
    ];
    return {
      id: ref,
      source,
      path: sessionFile.file.path,
      updatedAt,
      bytes: surfaceFileByteLength(sessionFile.file),
      title,
      excerpts,
    };
  }
  return null;
}

function agentSessionSource(ref: string): LocalAgentSession["source"] {
  return ref.startsWith("claude:") ? "claude" : "codex";
}

function agentSessionEvidenceRefMatches(record: Record<string, unknown>, ref: string): boolean {
  const provider = typeof record.provider === "string" ? record.provider.trim() : "";
  const sessionId = typeof record.sessionId === "string" ? record.sessionId.trim() : "";
  const evidenceRef = typeof record.ref === "string" ? record.ref.trim() : "";
  return evidenceRef === ref ||
    Boolean(provider && sessionId && `${provider}:${sessionId}` === ref) ||
    Boolean(sessionId && ref.endsWith(`:${sessionId}`));
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

async function coreOptions(parsed: ParsedArgs): Promise<{ dir?: string; authToken?: string; adapterAuthStoreRoot?: string }> {
  return {
    dir: dirFlag(parsed),
    authToken: await workbenchCloudToken(),
    adapterAuthStoreRoot: adapterAuthStoreRoot(),
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

function portFlag(parsed: ParsedArgs, name: string): number | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 0 || parsedValue > 65535) {
    throw new WorkbenchUserError(`--${name} must be an integer between 0 and 65535.`);
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
      remediation: "workbench log --versions",
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
      remediation: "workbench publish --private",
      exitCode: 2,
    });
  }
  return selected[0];
}

async function previewPublishWithDerivedRemote(parsed: ParsedArgs, visibility: "private" | "internal" | "public" | undefined): Promise<{
  remote: WorkbenchRemote;
  version: WorkbenchVersion;
  visibility: "private" | "internal" | "public";
  installHandle: string;
} | undefined> {
  const root = path.resolve(dirFlag(parsed) ?? process.cwd());
  const reconciledSnapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
  const link = cloudRemoteLinkTargetFromRemotes(reconciledSnapshot.remotes);
  const remote = stringFlag(parsed, "as") || !link.existing
    ? await derivePublishCloudRemote(parsed, "workbench publish", link.name)
    : link.existing;
  const requestedVersion = optionalPositional(parsed, 1);
  const version = requestedVersion && requestedVersion !== "current"
    ? snapshotVersionByRef(reconciledSnapshot, requestedVersion)
    : snapshotVersionByRef(reconciledSnapshot, reconciledSnapshot.status.currentVersionId ?? reconciledSnapshot.refs.current ?? "");
  if (!version) {
    throw new WorkbenchCodedError("version_not_found", `Version not found: ${requestedVersion ?? "current"}`, {
      remediation: "workbench log --versions",
      subject: { version: requestedVersion ?? "current" },
      exitCode: 1,
    });
  }
  return {
    remote,
    version,
    visibility: visibility ??
      normalizePublishVisibility(reconciledSnapshot.refs["publication/visibility"]) ??
      "private",
    installHandle: installHandleFromCloudRemote(remote),
  };
}

function normalizePublishVisibility(value: string | undefined): "private" | "internal" | "public" | undefined {
  return value === "private" || value === "internal" || value === "public" ? value : undefined;
}

function publishAudience(visibility: "private" | "internal" | "public"): "private" | "team" | "public" {
  return visibility === "internal" ? "team" : visibility;
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
  await assertDerivedCloudHandleAvailable(remote, {
    code: "publish_handle_conflict",
  });
  const result = await addWorkbenchRemote(remote.name, remote.url, core);
  return result.remote.name;
}

async function assertPublishCloudAuth(parsed: ParsedArgs, remoteName: string | undefined): Promise<void> {
  const root = path.resolve(dirFlag(parsed) ?? process.cwd());
  const remotes = await inspectionRemotes(root);
  const remote = remoteName
    ? remotes.find((entry) => entry.name === remoteName)
    : preferredCloudRemote(remotes);
  const source = remote ? parseWorkbenchInstallSource(remote.url) : undefined;
  if (!source || await workbenchCloudToken({ baseUrl: source.baseUrl })) {
    return;
  }
  throw new WorkbenchCodedError("auth_required", "workbench publish requires Workbench Cloud auth.", {
    remediation: workbenchLoginRemediation(source.baseUrl),
    exitCode: 1,
  });
}

async function writeAuthenticatedJsonProgress(
  parsed: ParsedArgs,
  io: CliIo,
  remoteName: string | undefined,
  message: string,
): Promise<void> {
  if (parsed.flags.json !== true) {
    return;
  }
  const root = path.resolve(dirFlag(parsed) ?? process.cwd());
  const remote = remoteName
    ? (await inspectionRemotes(root)).find((entry) => entry.name === remoteName)
    : preferredCloudRemote(await inspectionRemotes(root));
  const source = remote ? parseWorkbenchInstallSource(remote.url) : undefined;
  if (!source || !await workbenchCloudToken({ baseUrl: source.baseUrl })) {
    return;
  }
  writeCliProgress(parsed, io, message, { json: true });
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
      remediation: "workbench publish",
      subject: { remote: remote.name, url: remote.url },
      exitCode: 2,
    });
  }
  return `${source.owner}/${source.skill}`;
}

async function assertDerivedCloudHandleAvailable(
  remote: WorkbenchRemote,
  options: { code: "publish_handle_conflict"; remediation?: string },
): Promise<void> {
  const source = parseWorkbenchInstallSource(remote.url);
  if (!source) {
    throw new WorkbenchCodedError("remote_invalid_url", `Workbench remote is not a Cloud skill URL: ${remote.url}`, {
      remediation: "workbench publish",
      subject: { remote: remote.name, url: remote.url },
      exitCode: 2,
    });
  }
  if (!await workbenchCloudToken({ baseUrl: source.baseUrl })) {
    return;
  }
  const existing = await getCloudSkillByHandle(source.baseUrl, source.owner, source.skill);
  if (!existing) {
    return;
  }
  const suggestedSkill = await firstAvailableCloudSkillName(source.baseUrl, source.owner, source.skill);
  const collisionResistantSkill = `${source.skill}-$(date +%s)`;
  throw new WorkbenchCodedError(options.code, `Cloud skill ${source.owner}/${source.skill} already exists; refusing to auto-link this local project to it.`, {
    remediation: options.remediation ?? `workbench publish --as ${source.owner}/${collisionResistantSkill}`,
    subject: {
      owner: source.owner,
      skill: source.skill,
      suggestedSkill,
      suggestedHandle: `${source.owner}/${collisionResistantSkill}`,
      url: `${source.baseUrl}/skills/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.skill)}`,
    },
    exitCode: 2,
  });
}

async function availableCloudRemoteForHostedAutoLink(remote: WorkbenchRemote): Promise<WorkbenchRemote> {
  const source = parseWorkbenchInstallSource(remote.url);
  if (!source) {
    throw new WorkbenchCodedError("remote_invalid_url", `Workbench remote is not a Cloud skill URL: ${remote.url}`, {
      remediation: "workbench publish",
      subject: { remote: remote.name, url: remote.url },
      exitCode: 2,
    });
  }
  const existing = await getCloudSkillByHandle(source.baseUrl, source.owner, source.skill);
  if (!existing) {
    return remote;
  }
  const skill = await firstAvailableCloudSkillName(source.baseUrl, source.owner, source.skill);
  return {
    ...remote,
    url: `${source.baseUrl}/skills/${encodeURIComponent(source.owner)}/${encodeURIComponent(skill)}`,
  };
}

async function getCloudSkillByHandle(
  baseUrl: string,
  owner: string,
  skill: string,
): Promise<{ id?: string; ownerSlug?: string; name?: string } | undefined> {
  const params = new URLSearchParams({ owner, name: skill });
  const listed = await apiRequest<{ skills?: Array<{ id?: string; ownerSlug?: string; name?: string }> }>(
    `/api/workbench/skills?${params.toString()}`,
    {},
    baseUrl,
  );
  return listed.skills?.find((entry) => entry.ownerSlug === owner && entry.name === skill);
}

async function firstAvailableCloudSkillName(
  baseUrl: string,
  owner: string,
  baseSkill: string,
): Promise<string> {
  for (let index = 2; ; index += 1) {
    const candidate = `${baseSkill}-${index}`;
    if (!await getCloudSkillByHandle(baseUrl, owner, candidate)) {
      return candidate;
    }
  }
}

async function publishErrorWithCliContext(error: unknown, parsed: ParsedArgs, remoteName: string | undefined): Promise<unknown> {
  if (!(error instanceof WorkbenchCodedError) || error.code !== "auth_required") {
    return error;
  }
  if (error.message.startsWith("workbench publish")) {
    return error;
  }
  return new WorkbenchCodedError("auth_required", "workbench publish requires Workbench Cloud auth.", {
    remediation: await publishAuthRemediation(parsed, remoteName, error.remediation),
    ...(error.subject ? { subject: error.subject } : {}),
    exitCode: error.exitCode,
  });
}

async function publishAuthRemediation(
  parsed: ParsedArgs,
  remoteName: string | undefined,
  fallback: string | undefined,
): Promise<string> {
  const root = path.resolve(dirFlag(parsed) ?? process.cwd());
  try {
    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
    const remote = remoteName
      ? snapshot.remotes.find((entry) => entry.name === remoteName)
      : cloudRemoteLinkTargetFromRemotes(snapshot.remotes).existing;
    const source = remote ? parseWorkbenchInstallSource(remote.url) : undefined;
    return workbenchLoginRemediation(source?.baseUrl);
  } catch {
    return fallback ?? "workbench login";
  }
}

function parseOwnerSkillHandle(input: string): { owner: string; skill: string } {
  const handle = normalizedOwnerSkillHandle(input);
  if (!handle) {
    throw new WorkbenchCodedError("usage", "workbench publish --as expects OWNER/SKILL.", {
      remediation: "workbench publish --as OWNER/SKILL",
      exitCode: 2,
    });
  }
  return handle;
}

function derivedOwnerSkillHandle(parsed: ParsedArgs, config: WorkbenchConfig, action: string): WorkbenchSkillHandle {
  const owner = config.username?.trim();
  if (!owner) {
    throw new WorkbenchCodedError("auth_required", `${action} needs a logged-in Workbench Cloud username before it can derive OWNER/SKILL.`, {
      remediation: "workbench login",
      exitCode: 1,
    });
  }
  const root = path.resolve(dirFlag(parsed) ?? process.cwd());
  const handle = normalizeOwnerSkillHandle(owner, path.basename(root));
  if (!handle.owner || !handle.skill) {
    throw new WorkbenchCodedError("usage", `${action} could not derive a valid OWNER/SKILL handle.`, {
      remediation: `${action} --as OWNER/SKILL`,
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
      remediation: "workbench install OWNER/SKILL",
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

function validateAgentCommandConfig(config: Record<string, Json>): void {
  for (const key of ["command", "improveCommand"]) {
    const value = config[key];
    if (typeof value !== "string") {
      continue;
    }
    const expanded = expandedRuntimeEnvPath(value);
    if (!expanded) {
      continue;
    }
    throw new WorkbenchCodedError("usage", `--with ${key}=... contains ${expanded.path}, which usually means the shell expanded a Workbench runtime variable before Workbench received it.`, {
      remediation: `Wrap the assignment in single quotes, for example --with '${key}=... >> "${expanded.replacement}"'.`,
      exitCode: 2,
    });
  }
}

function expandedRuntimeEnvPath(value: string): { path: string; replacement: string } | null {
  for (const entry of [
    { path: "/SKILL.md", replacement: "$SKILL_DIR/SKILL.md", pattern: /(^|[\s"'=])\/SKILL\.md(?=$|[\s"'])/u },
    { path: "/result.json", replacement: "$OUTPUT_DIR/result.json", pattern: /(^|[\s"'=])\/result\.json(?=$|[\s"'])/u },
  ]) {
    if (entry.pattern.test(value)) {
      return entry;
    }
  }
  return null;
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
  snapshot: WorkbenchRunSnapshot,
  failedRuns: readonly WorkbenchRun[],
  artifactIds: ReadonlyMap<string, readonly string[]>,
  coverage: readonly EvalCoverage[],
  deltas: readonly EvalDelta[],
  parsed: ParsedArgs,
  io: CliIo,
): number {
  const next = evalFailureNextCommand(failedRuns);
  if (parsed.flags.json === true) {
    io.stdout.write(`${JSON.stringify({
      schema: "workbench.cli.eval.v1",
      ok: false,
      code: "eval_runs_failed",
      message: "Eval failed; evidence was saved.",
      retryable: false,
      evidenceSaved: true,
      run: runSnapshotResultJson(snapshot),
      failedMeasurements: snapshot.measurements
        .filter((measurement) => measurement.status === "failed" || measurement.status === "canceled")
        .map((measurement) => measurementFailureSummary(measurement, artifactIds.get(measurement.runId) ?? [])),
      coverage: coverage as unknown as Json,
      deltas: deltas as unknown as Json,
      next,
    }, null, 2)}\n`);
    return 1;
  }
  io.stdout.write([
    "Eval failed; evidence was saved.",
    formatRunSnapshot(snapshot),
    ...formatEvalCoverageLines(coverage),
    ...formatEvalDeltaLines(deltas),
    ...(next ? [`next: ${next}`] : []),
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
    ...(run.location ? { location: run.location } : {}),
    ...(run.remoteName ? { remoteName: run.remoteName } : {}),
    ...(run.requestedSamples !== undefined ? { requestedSamples: run.requestedSamples } : {}),
    ...(run.requestedBudget !== undefined ? { requestedBudget: run.requestedBudget } : {}),
    ...(run.retryOfRunId ? { retryOfRunId: run.retryOfRunId } : {}),
    ...(run.cancelRequestedAt ? { cancelRequestedAt: run.cancelRequestedAt } : {}),
    ...(run.lastProgressAt ? { lastProgressAt: run.lastProgressAt } : {}),
    ...(scoredRunValue(run) !== undefined ? { score: scoredRunValue(run) } : {}),
    ...(run.latencyMs !== undefined ? { latencyMs: run.latencyMs } : {}),
    ...(run.error ? { error: run.error } : {}),
    ...(run.jobIds ? { jobIds: run.jobIds } : {}),
    traceIds: run.traceIds,
    artifactIds: [...artifactIds],
  };
}

function measurementFailureSummary(measurement: WorkbenchMeasurementSummary, artifactIds: readonly string[]): Json {
  return {
    runId: measurement.runId,
    agent: measurement.agentName,
    skill: measurement.skillName,
    status: measurement.status,
    versionId: measurement.versionId,
    ...(measurement.score !== undefined ? { score: measurement.score } : {}),
    ...(measurement.error ? { error: measurement.error } : {}),
    artifactIds: [...artifactIds],
  };
}

function evalFailureNextCommand(failedRuns: readonly WorkbenchRun[]): string | null {
  const authNext = failedRuns
    .map(adapterAuthRemediationFromRun)
    .find((command): command is string => Boolean(command));
  if (authNext) {
    return authNext;
  }
  const first = failedRuns[0];
  if (!first) {
    return "workbench log --runs";
  }
  return `workbench show ${displayRef(first.id)}`;
}

function adapterAuthRemediationFromRun(run: WorkbenchRun): string | null {
  return adapterAuthRemediationFromErrorMessage(run.error);
}

function adapterAuthRemediationFromErrorMessage(error: string | undefined): string | null {
  const adapterId = error?.match(/ADAPTER_AUTH_REQUIRED:\s*([a-z0-9-]+)/iu)?.[1];
  return adapterId ? workbenchProviderAuthSetupCommand(adapterId) : null;
}

function output(value: unknown, parsed: ParsedArgs, io: CliIo, text: () => string): number {
  return emitResult(commandSchema(parsed), { result: value as Json }, parsed, io, text);
}

function commandSchema(parsed: ParsedArgs): string {
  const command = parsed.positionals[0] ?? "result";
  const subcommand = parsed.positionals[1];
  const suffix = ["agent", "case", "run"].includes(command) && subcommand
    ? `${command}-${subcommand}`
    : command;
  return `workbench.cli.${suffix}.v1`;
}

async function withProgressHeartbeat<T>(
  io: CliIo,
  label: string,
  run: () => Promise<T>,
  options: { hint?: string; immediate?: boolean; json?: boolean } = {},
): Promise<T> {
  if (options.json === true) {
    return await run();
  }
  const startedAt = Date.now();
  let interval: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const writeProgress = (): void => {
    const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
    const hint = options.hint ? ` ${options.hint}` : "";
    io.stderr.write(`${label} still running (${elapsedSeconds}s).${hint}\n`);
  };
  if (options.immediate) {
    writeProgress();
    interval = setInterval(writeProgress, 10_000);
  } else {
    timeout = setTimeout(() => {
      writeProgress();
      interval = setInterval(writeProgress, 10_000);
    }, 5_000);
  }
  try {
    return await run();
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (interval) {
      clearInterval(interval);
    }
  }
}

const LOCAL_PROGRESS_POLL_INTERVAL_MS = 1_000;

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

interface WorkbenchMachineStatus {
  installedSkillCount: number;
  targets: Array<{ id: string; scope: string; roots: string[] }>;
  connectedProviders: Array<{ adapter: string; slot?: string; profile: string }>;
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

async function workbenchMachineStatus(auth: WorkbenchCliAuthStatus, core: { dir?: string } = {}): Promise<WorkbenchMachineStatus> {
  const inventory = await observeCurrentInstalledSkillsInventory({ dir: core.dir });
  return {
    installedSkillCount: inventory.skills.length,
    targets: inventory.targets.map((target) => ({
      id: target.id,
      scope: target.scope,
      roots: target.roots.map((root) => root.root),
    })),
    connectedProviders: auth.adapters
      .filter((entry) => entry.status === "connected")
      .map((entry) => ({
        adapter: entry.adapter,
        ...(entry.slot ? { slot: entry.slot } : {}),
        profile: entry.profile,
      })),
  };
}

type InspectionSnapshot = Awaited<ReturnType<typeof createWorkbenchReadOnlyInspectionSnapshot>>;

type WorkbenchStatusSnapshotForCli = Awaited<ReturnType<typeof workbenchStatusSnapshot>>;
type WorkbenchActiveRunStatusForCli = NonNullable<WorkbenchStatusSnapshotForCli["runs"]["activeRuns"]>[number] & {
  workDone?: number;
  workTotal?: number;
  scored?: number;
  canceled?: number;
  partialScore?: number;
  progress?: Json;
};
type WorkbenchStatusSnapshotWithProgress = Omit<WorkbenchStatusSnapshotForCli, "runs"> & {
  runs: Omit<WorkbenchStatusSnapshotForCli["runs"], "activeRuns"> & {
    activeRuns?: WorkbenchActiveRunStatusForCli[];
  };
};

function statusWithActiveRunProgress(
  status: WorkbenchStatusSnapshotForCli,
  snapshot: WorkbenchInspectionSnapshot | null,
): WorkbenchStatusSnapshotWithProgress {
  if (!snapshot || !status.runs.activeRuns?.length) {
    return status;
  }
  const runsById = new Map(snapshot.runs.map((run) => [run.id, run]));
  const activeRuns = status.runs.activeRuns.map((entry): WorkbenchActiveRunStatusForCli => {
    const run = runsById.get(entry.id);
    if (!run) {
      return entry;
    }
    const progress = runProgressSnapshotForInspection({
      command: "run watch",
      location: run.location ?? "local",
      phase: progressPhaseForRun(run),
      runs: [run],
      snapshot,
      startedAtMs: timestampMs(run.createdAt) ?? Date.now(),
      next: `workbench run watch ${run.id}`,
    });
    const runProgress = progress?.progress;
    return {
      ...entry,
      ...(runProgress ? { workDone: runProgress.completed, workTotal: runProgress.planned } : {}),
      failed: runProgress?.failed ?? 0,
      ...(runProgress?.scored !== undefined ? { scored: runProgress.scored } : {}),
      ...(runProgress?.canceled !== undefined ? { canceled: runProgress.canceled } : {}),
      ...(runProgress?.partialScore !== undefined ? { partialScore: runProgress.partialScore } : {}),
      ...(progress ? { progress: progress as unknown as Json } : {}),
    };
  });
  return {
    ...status,
    runs: {
      ...status.runs,
      activeRuns,
    },
  };
}

function scoredRunValue(run: WorkbenchRun): number | undefined {
  return typeof run.score === "number" ? run.score : undefined;
}

function scoredJobValue(job: WorkbenchJob): number | undefined {
  return typeof job.score === "number" ? job.score : undefined;
}

function scoredRunIsBelowPerfect(run: WorkbenchRun): boolean {
  const score = scoredRunValue(run);
  return score !== undefined && score < 1;
}

function snapshotHasWorkflowCase(snapshot: InspectionSnapshot): boolean {
  const currentVersion = snapshotVersionByRef(snapshot, snapshot.status.currentVersionId ?? snapshot.refs.current ?? "");
  return (currentVersion?.files ?? []).some((file) =>
    isEvalCaseFile(file) && !/\n\s*smoke:\s*true(?:\s|$)/u.test(`\n${file.content}`)
  );
}

function snapshotHasAnyEvalCase(snapshot: InspectionSnapshot): boolean {
  const currentVersion = snapshotVersionByRef(snapshot, snapshot.status.currentVersionId ?? snapshot.refs.current ?? "");
  return (currentVersion?.files ?? []).some(isEvalCaseFile);
}

function authorEvalCaseCommand(snapshot: InspectionSnapshot | null, caseIds: ReadonlySet<string> = new Set()): string {
  const currentVersion = snapshot ? snapshotVersionByRef(snapshot, snapshot.status.currentVersionId ?? snapshot.refs.current ?? "") : undefined;
  const existingCaseIds = new Set([...caseIds, ...(currentVersion?.files ?? []).flatMap((file) => {
    const match = isEvalCaseFile(file) ? file.path.match(/^\.workbench\/cases\/([^/]+)\/case\.ya?ml$/u) : null;
    return match?.[1] ? [match[1]] : [];
  })]);
  for (let index = 1; ; index += 1) {
    const id = `case-${String(index).padStart(3, "0")}`;
    if (!existingCaseIds.has(id)) {
      return workbenchAuthorEvalCaseCommand(id);
    }
  }
}

function projectScopedNextCommand(projectRoot: string, command: string): string {
  const cwd = path.resolve(process.cwd());
  const root = path.resolve(projectRoot);
  if (root === cwd) {
    return command;
  }
  const relative = path.relative(cwd, root);
  const target = relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : root;
  return `cd ${shellQuote(target || ".")} && ${command}`;
}

function isEvalCaseFile(file: SurfaceSnapshotFile): boolean {
  return file.encoding !== "base64" && /^\.workbench\/cases\/[^/]+\/case\.ya?ml$/u.test(file.path);
}

interface LiveEvalCaseSummary {
  any: boolean;
  workflow: boolean;
  caseIds: Set<string>;
}

async function liveEvalCaseSummary(root: string): Promise<LiveEvalCaseSummary> {
  const casesDir = path.join(root, ".workbench", "cases");
  const entries = await fs.readdir(casesDir, { withFileTypes: true }).catch(() => []);
  const caseIds = new Set<string>();
  let workflow = false;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const caseId = entry.name;
    const casePath = await firstExistingPath([
      path.join(casesDir, caseId, "case.yaml"),
      path.join(casesDir, caseId, "case.yml"),
    ]);
    if (!casePath) {
      continue;
    }
    caseIds.add(caseId);
    const content = await fs.readFile(casePath, "utf8").catch(() => "");
    if (!/\n\s*smoke:\s*true(?:\s|$)/u.test(`\n${content}`)) {
      workflow = true;
    }
  }
  return {
    any: caseIds.size > 0,
    workflow,
    caseIds,
  };
}

async function firstExistingPath(paths: readonly string[]): Promise<string | null> {
  for (const filePath of paths) {
    if (await fs.stat(filePath).then((stat) => stat.isFile(), () => false)) {
      return filePath;
    }
  }
  return null;
}

async function statusWithCausalNext(
  status: Awaited<ReturnType<typeof workbenchStatusSnapshot>>,
  auth: WorkbenchCliAuthStatus,
  core: { dir?: string; authToken?: string },
  machine: WorkbenchMachineStatus,
  inspection?: WorkbenchInspectionSnapshot | null,
): Promise<Awaited<ReturnType<typeof workbenchStatusSnapshot>>> {
  if (!status.project.initialized) {
    return {
      ...status,
      next: machine.installedSkillCount > 0 ? "workbench skills" : status.next,
    };
  }
  const snapshot = inspection ?? await createWorkbenchReadOnlyInspectionSnapshot(core).catch(() => null);
  const currentVersionId = status.project.currentVersionId ?? snapshot?.status.currentVersionId ?? snapshot?.refs.current;
  const lastRun = snapshot?.runs
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if ((lastRun?.status === "queued" || lastRun?.status === "running") && lastRun.id) {
    return { ...status, next: `workbench run watch ${displayRef(lastRun.id)}` };
  }
  if ((lastRun?.status === "failed" || lastRun?.status === "canceled") && lastRun.id) {
    return { ...status, next: `workbench show ${displayRef(lastRun.id)}` };
  }
  const failedRemote = status.remotes.find((remote) => remote.sync.status === "error");
  const liveCases = await liveEvalCaseSummary(status.project.root);
  const hasWorkflowCase = liveCases.workflow || (snapshot ? snapshotHasWorkflowCase(snapshot) : false);
  const hasAnyEvalCase = liveCases.any || (snapshot ? snapshotHasAnyEvalCase(snapshot) : false);
  const currentScoredEvalRuns = snapshot && currentVersionId
    ? latestScoredEvalRunsForVersion(snapshot, currentVersionId)
    : [];
  const hasCurrentScoredEvalRun = currentScoredEvalRuns.length > 0;
  const belowPerfectCurrentEvalRuns = currentScoredEvalRuns.filter(scoredRunIsBelowPerfect);
  const canPublish = hasWorkflowCase && hasCurrentScoredEvalRun && belowPerfectCurrentEvalRuns.length === 0;
  const promotedImproveVersionId = snapshot && currentVersionId
    ? latestUnsourcedPromotedImproveVersion(snapshot, currentVersionId)
    : undefined;
  if (promotedImproveVersionId) {
    return { ...status, next: `workbench switch ${displayRef(promotedImproveVersionId)}` };
  }
  const cloudAuthMissing = auth.workbenchCloud.status !== "authenticated";
  const cloudRemoteNeedsAuth = status.remotes.some((remote) =>
    remote.kind === "workbench-cloud" &&
    (remote.sync.status !== "up_to_date" || remote.publication.status === "unpublished")
  );
  if (failedRemote) {
    return { ...status, next: `workbench sync ${failedRemote.name}` };
  }
  if (!hasAnyEvalCase) {
    return { ...status, next: authorEvalCaseCommand(snapshot, liveCases.caseIds) };
  }
  if ((snapshot?.runs.length ?? status.runs.total) === 0) {
    return { ...status, next: "workbench eval" };
  }
  if (!hasCurrentScoredEvalRun) {
    return { ...status, next: postImproveProofEvalNextCommand(snapshot, currentVersionId) ?? "workbench eval" };
  }
  if (belowPerfectCurrentEvalRuns.length > 0) {
    return { ...status, next: belowPerfectEvalNextCommand(snapshot, belowPerfectCurrentEvalRuns) };
  }
  if (!hasWorkflowCase && hasCurrentScoredEvalRun) {
    return { ...status, next: "workbench compare" };
  }
  if (cloudAuthMissing && (canPublish || cloudRemoteNeedsAuth)) {
    return { ...status, next: "workbench login" };
  }
  const cloudRemote = status.remotes.find((remote) => remote.kind === "workbench-cloud");
  if (canPublish && !cloudRemote) {
    return { ...status, next: "workbench publish" };
  }
  const unpublishedCloudRemote = status.remotes.find((remote) =>
    remote.kind === "workbench-cloud" &&
    remote.publication.status === "unpublished" &&
    remote.sync.status === "up_to_date"
  );
  if (unpublishedCloudRemote) {
    return { ...status, next: "workbench publish" };
  }
  const stalePublishedCloudRemote = status.remotes.find((remote) =>
    remote.kind === "workbench-cloud" &&
    remote.publication.status === "published" &&
    remote.sync.status === "up_to_date" &&
    currentVersionId !== undefined &&
    remote.publication.versionId !== currentVersionId
  );
  if (canPublish && stalePublishedCloudRemote) {
    const publishedVersionId = stalePublishedCloudRemote.publication.versionId;
    if (snapshot && publishedVersionId && currentVersionId) {
      if (versionHasAncestor(snapshot, currentVersionId, publishedVersionId)) {
        return { ...status, next: "workbench publish" };
      }
      if (versionHasAncestor(snapshot, publishedVersionId, currentVersionId)) {
        return { ...status, next: `workbench switch ${displayRef(publishedVersionId)}` };
      }
    }
    return { ...status, next: "workbench publish" };
  }
  return {
    ...status,
    next: canPublish ? "workbench compare" : null,
  };
}

function latestScoredEvalRunsForVersion(
  snapshot: WorkbenchInspectionSnapshot,
  versionId: string,
): WorkbenchRun[] {
  const latestBySelection = new Map<string, WorkbenchRun>();
  for (const run of snapshot.runs) {
    if (run.kind !== "eval" || run.versionId !== versionId || scoredRunValue(run) === undefined) {
      continue;
    }
    const key = `${run.skillName}\0${run.agentName}\0${run.evalHash}`;
    const existing = latestBySelection.get(key);
    if (!existing || runEvidenceTime(run).localeCompare(runEvidenceTime(existing)) > 0) {
      latestBySelection.set(key, run);
    }
  }
  return [...latestBySelection.values()];
}

function belowPerfectEvalNextCommand(
  snapshot: WorkbenchInspectionSnapshot | null,
  runs: readonly WorkbenchRun[],
): string {
  const skillNames = new Set(runs.map((run) => run.skillName));
  const agentNames = new Set(runs.map((run) => run.agentName));
  if (skillNames.size !== 1 || agentNames.size !== 1) {
    return "workbench compare";
  }
  const skill = [...skillNames][0]!;
  const agentName = [...agentNames][0]!;
  if (skill !== "primary") {
    return "workbench compare";
  }
  const agent = snapshot?.agents.find((entry) => entry.agent.name === agentName)?.agent;
  if (!agent) {
    return "workbench compare";
  }
  return improveNextCommandForAgent(skill, agent);
}

function postImproveProofEvalNextCommand(
  snapshot: WorkbenchInspectionSnapshot | null,
  currentVersionId: string | undefined,
): string | undefined {
  if (!snapshot || !currentVersionId) {
    return undefined;
  }
  const latestImproveForCurrent = snapshot.runs
    .filter((run) =>
      run.kind === "improve" &&
      run.status === "succeeded" &&
      run.outputVersionId === currentVersionId
    )
    .sort((left, right) => runEvidenceTime(right).localeCompare(runEvidenceTime(left)))[0];
  return latestImproveForCurrent ? "workbench eval --rerun -n 5" : undefined;
}

function latestUnsourcedPromotedImproveVersion(
  snapshot: WorkbenchInspectionSnapshot,
  currentVersionId: string,
): string | undefined {
  const latestRuns = snapshot.runs
    .filter((run) => run.kind === "improve" && run.status === "succeeded" && Boolean(run.outputVersionId))
    .sort((left, right) => runEvidenceTime(right).localeCompare(runEvidenceTime(left)));
  for (const run of latestRuns) {
    const outputVersionId = run.outputVersionId;
    if (!outputVersionId || outputVersionId === currentVersionId) {
      continue;
    }
    if (!snapshot.versions.some((version) => version.id === outputVersionId)) {
      continue;
    }
    if (versionHasAncestor(snapshot, currentVersionId, outputVersionId)) {
      continue;
    }
    if (!remoteCurrentRefPromotesVersion(snapshot, outputVersionId) && !improveRunPromotedCandidate(snapshot, run)) {
      continue;
    }
    return outputVersionId;
  }
  return undefined;
}

function remoteCurrentRefPromotesVersion(snapshot: WorkbenchInspectionSnapshot, versionId: string): boolean {
  return Object.entries(snapshot.refs).some(([name, value]) =>
    name.startsWith("remotes/") &&
    name.endsWith("/current") &&
    value === versionId
  );
}

function improveRunPromotedCandidate(snapshot: WorkbenchInspectionSnapshot, run: WorkbenchRun): boolean {
  if (run.status !== "succeeded" || typeof run.score !== "number") {
    return false;
  }
  const outputVersion = run.outputVersionId
    ? snapshot.versions.find((version) => version.id === run.outputVersionId)
    : undefined;
  const incumbentVersionId = outputVersion?.parentIds[0] ?? run.versionId;
  const incumbent = snapshot.runs
    .filter((candidate) =>
      candidate.kind === "eval" &&
      candidate.status === "succeeded" &&
      candidate.versionId === incumbentVersionId &&
      candidate.skillName === run.skillName &&
      candidate.agentName === run.agentName &&
      candidate.evalHash === run.evalHash &&
      typeof candidate.score === "number"
    )
    .sort((left, right) => runEvidenceTime(right).localeCompare(runEvidenceTime(left)))[0];
  return !incumbent || run.score > incumbent.score!;
}

function versionHasAncestor(snapshot: WorkbenchInspectionSnapshot, versionId: string, ancestorId: string): boolean {
  if (versionId === ancestorId) {
    return true;
  }
  const parentsByChild = new Map<string, string[]>();
  for (const edge of snapshot.lineage) {
    const parents = parentsByChild.get(edge.childId) ?? [];
    parents.push(edge.parentId);
    parentsByChild.set(edge.childId, parents);
  }
  for (const version of snapshot.versions) {
    if (version.parentIds.length === 0) {
      continue;
    }
    const parents = parentsByChild.get(version.id) ?? [];
    for (const parentId of version.parentIds) {
      if (!parents.includes(parentId)) {
        parents.push(parentId);
      }
    }
    parentsByChild.set(version.id, parents);
  }
  const seen = new Set<string>();
  const stack = [...(parentsByChild.get(versionId) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (next === ancestorId) {
      return true;
    }
    if (seen.has(next)) {
      continue;
    }
    seen.add(next);
    stack.push(...(parentsByChild.get(next) ?? []));
  }
  return false;
}

function displayRef(id: string): string {
  return displayRefWithMinLength(id, 8);
}

function displayRefWithMinLength(id: string, minLength: number): string {
  const version = /^v_([0-9a-f]{8,})$/iu.exec(id);
  if (version?.[1]) {
    return version[1].slice(0, minLength);
  }
  const separator = id.indexOf("_");
  if (separator > 0 && separator < id.length - 1) {
    const prefix = id.slice(0, separator);
    const suffix = id.slice(separator + 1);
    return `${prefix}_${suffix.slice(0, minLength)}`;
  }
  return id.length > minLength ? id.slice(0, minLength) : id;
}

function displayRefsForIds(ids: readonly string[]): Map<string, string> {
  const uniqueIds = [...new Set(ids)];
  for (let length = 8; length <= 32; length += 1) {
    const refs = uniqueIds.map((id) => displayRefWithMinLength(id, length));
    if (new Set(refs).size === refs.length) {
      return new Map(uniqueIds.map((id, index) => [id, refs[index]!] as const));
    }
  }
  return new Map(uniqueIds.map((id) => [id, id] as const));
}

function shortenCommandRefs(command: string): string {
  return command.replace(/\b(?:v_[0-9a-f]{8,}|(?:run|job|trace|artifact)_[a-z0-9_-]+)/giu, (match) => displayRef(match));
}

function displayCandidateRefs(ids: readonly string[]): string[] {
  const uniqueIds = [...ids];
  for (let length = 8; length <= 32; length += 1) {
    const refs = uniqueIds.map((id) => id.length > length ? id.slice(0, length) : id);
    if (new Set(refs).size === refs.length) {
      return refs;
    }
  }
  return uniqueIds;
}

function snapshotVersionByRef(snapshot: InspectionSnapshot, ref: string): WorkbenchVersion | undefined {
  const requested = ref.trim();
  const normalized = requested === "current" ? snapshot.refs.current ?? "" : requested;
  if (!normalized) {
    return undefined;
  }
  const candidates = snapshot.versions.filter((version) => snapshotVersionRefMatches(version, normalized));
  if (candidates.length > 1) {
    throw new WorkbenchCodedError("ref_ambiguous", `Version ref is ambiguous: ${ref}. Candidates: ${displayCandidateRefs(candidates.map((version) => version.id)).join(", ")}.`, {
      subject: { ref, candidates: candidates.map((version) => version.id) },
      exitCode: 2,
    });
  }
  return candidates[0];
}

function snapshotVersionRefMatches(version: WorkbenchVersion, ref: string): boolean {
  const withoutVersionPrefix = ref.startsWith("v_") ? ref.slice(2) : ref;
  return version.id === ref ||
    version.hash === ref ||
    version.id.startsWith(ref) ||
    version.hash.startsWith(ref) ||
    version.hash.startsWith(withoutVersionPrefix) ||
    version.id.startsWith(`v_${withoutVersionPrefix}`);
}

function snapshotObjectByRef<T extends { id: string }>(
  entries: readonly T[],
  ref: string,
  kind: "run" | "job" | "trace" | "artifact",
): T | undefined {
  const normalized = ref.trim();
  if (!normalized) {
    return undefined;
  }
  const candidates = entries.filter((entry) => objectRefMatches(entry.id, normalized));
  if (candidates.length > 1) {
    throw new WorkbenchCodedError("ref_ambiguous", `${capitalize(kind)} ref is ambiguous: ${ref}. Candidates: ${displayCandidateRefs(candidates.map((entry) => entry.id)).slice(0, 8).join(", ")}.`, {
      subject: { ref, candidates: candidates.map((entry) => entry.id).slice(0, 20) },
      exitCode: 2,
    });
  }
  return candidates[0];
}

function objectRefMatches(id: string, ref: string): boolean {
  if (id === ref || id.startsWith(ref)) {
    return true;
  }
  if (ref.includes("_")) {
    return false;
  }
  const separator = id.indexOf("_");
  return separator > 0 && id.slice(separator + 1).startsWith(ref);
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

function runOrJobEvidenceSelection(snapshot: InspectionSnapshot, ref: string): {
  run?: WorkbenchRun;
  jobs: WorkbenchJob[];
} {
  const run = snapshotObjectByRef(snapshot.runs, ref, "run");
  const job = snapshotObjectByRef(snapshot.jobs, ref, "job");
  if (run && job) {
    throw new WorkbenchCodedError("ref_ambiguous", `Run/job ref is ambiguous: ${ref}. Candidates: ${displayCandidateRefs([run.id, job.id]).join(", ")}.`, {
      subject: { ref, candidates: [run.id, job.id] },
      exitCode: 2,
    });
  }
  if (run) {
    return {
      run,
      jobs: snapshot.jobs.filter((entry) => entry.runId === run.id),
    };
  }
  return job ? { jobs: [job] } : { jobs: [] };
}

function evidenceFilesForRunOrJob(snapshot: InspectionSnapshot, ref: string): SurfaceSnapshotFile[] {
  const selection = runOrJobEvidenceSelection(snapshot, ref);
  return evidenceFilesForSelection(snapshot, selection);
}

function evidenceFilesForSelection(
  snapshot: InspectionSnapshot,
  selection: {
    run?: WorkbenchRun;
    jobs: WorkbenchJob[];
  },
): SurfaceSnapshotFile[] {
  if (!selection.run && selection.jobs.length === 0) {
    return [];
  }
  const traceById = new Map(snapshot.traces.map((trace) => [trace.id, trace]));
  const artifactById = new Map(snapshot.artifacts.map((artifact) => [artifact.id, artifact]));
  const candidates: EvidenceFileCandidate[] = selection.jobs.flatMap((job) => [
    ...job.artifactIds.flatMap((artifactId): EvidenceFileCandidate[] => {
      const artifact = artifactById.get(artifactId);
      return artifact
        ? artifact.files.filter(isUserFacingEvidenceFile).map((file) => ({
            file: evidenceFileWithPath(
              file,
              `cases/${evidencePathSegment(job.caseId)}/jobs/${evidencePathSegment(job.id)}/${file.path}`,
            ),
            jobId: job.id,
            source: "artifact" as const,
          }))
        : [];
    }),
    ...job.traceIds.flatMap((traceId): EvidenceFileCandidate[] => {
      const trace = traceById.get(traceId);
      return trace
        ? trace.files.filter(isUserFacingTraceEvidenceFile).map((file) => ({
            file: evidenceFileWithPath(
              file,
              `cases/${evidencePathSegment(job.caseId)}/jobs/${evidencePathSegment(job.id)}/traces/${evidencePathSegment(trace.id)}/${file.path}`,
            ),
            jobId: job.id,
            source: "trace" as const,
          }))
        : [];
    }),
  ]);
  return canonicalEvidenceFiles(candidates);
}

interface EvidenceFileCandidate {
  file: SurfaceSnapshotFile;
  jobId: string;
  source: "artifact" | "trace";
}

function canonicalEvidenceFiles(candidates: readonly EvidenceFileCandidate[]): SurfaceSnapshotFile[] {
  const seen = new Set<string>();
  const sameJobArtifactFiles = new Set<string>();
  const files: SurfaceSnapshotFile[] = [];
  for (const candidate of candidates) {
    const file = candidate.file;
    if (seen.has(file.path)) {
      continue;
    }
    seen.add(file.path);
    const equivalentKey = sameJobEquivalentEvidenceKey(candidate);
    if (candidate.source === "trace" && sameJobArtifactFiles.has(equivalentKey)) {
      continue;
    }
    if (candidate.source === "artifact") {
      sameJobArtifactFiles.add(equivalentKey);
    }
    files.push(file);
  }
  return files;
}

function sameJobEquivalentEvidenceKey(candidate: EvidenceFileCandidate): string {
  const file = candidate.file;
  return [
    candidate.jobId,
    path.basename(file.path),
    file.kind ?? "text",
    file.encoding ?? "utf8",
    file.executable === true ? "1" : "0",
    file.content,
  ].join("\0");
}

function evidenceFileWithPath(file: SurfaceSnapshotFile, filePath: string): SurfaceSnapshotFile {
  return {
    ...file,
    path: filePath.replace(/\\/gu, "/").replace(/^\/+/u, ""),
  };
}

function isUserFacingEvidenceFile(file: SurfaceSnapshotFile): boolean {
  const normalized = file.path.replace(/\\/gu, "/").replace(/^\/+/u, "");
  return normalized.split("/").every((segment) => segment !== ".workbench");
}

function isUserFacingTraceEvidenceFile(file: SurfaceSnapshotFile): boolean {
  if (!isUserFacingEvidenceFile(file)) {
    return false;
  }
  const basename = path.basename(file.path.replace(/\\/gu, "/"));
  return basename !== "request.json" && basename !== "result.json" && basename !== "trace.json";
}

function evidencePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/gu, "-") || "_";
}

function formatRunOrJobEvidence(
  jobs: readonly WorkbenchJob[],
  details: readonly WorkbenchExecutionTraceDetail[],
  files: readonly SurfaceSnapshotFile[],
  ownerRef?: string,
): string {
  const jobRefs = displayRefsForIds([
    ...jobs.map((job) => job.id),
    ...details.flatMap((detail) => detail.executions.flatMap((execution) => execution.jobIds)),
  ]);
  const runRefs = displayRefsForIds([
    ...jobs.map((job) => job.runId),
    ...details.map((detail) => detail.runId),
  ]);
  const jobLines = jobs.length > 0 ? ["Jobs:", ...jobs.map((job) => formatJobEvidenceSummary(job, jobRefs))] : [];
  const detailLines = details.map((detail) => formatTraceDetail(detail, { jobRefs, runRefs })).filter(Boolean);
  const highlightLines = formatEvidenceHighlights(evidenceHighlights(files));
  const fileLines = files.length > 0 ? ["Files:", ...files.map((file) => ownerRef ? `workbench show ${quoteShellArg(showFileRef(ownerRef, file.path))}` : file.path)] : [];
  return [...jobLines, ...detailLines, ...highlightLines, ...fileLines].join("\n") || "No evidence.";
}

function formatRunEvidenceSummary(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
  details: readonly WorkbenchExecutionTraceDetail[],
  files: readonly SurfaceSnapshotFile[],
  progress?: WorkbenchRunSnapshot,
  next?: string | null,
): string {
  const failures = runFailureGroups(jobs);
  return [
    formatRun(run),
    `location=${run.location ?? "local"}${run.retryOfRunId ? ` retry_of=${displayRef(run.retryOfRunId)}` : ""}${run.outputVersionId ? ` output=${displayRef(run.outputVersionId)}` : ""}`,
    ...(progress ? [`Progress: ${formatProgressSummary(progress)}`] : []),
    ...(run.error ? [`error=${singleLine(run.error)}`] : []),
    ...(failures.length > 0
      ? ["Failures:", ...failures.map((failure) => `  ${failure.count} ${failure.status}: ${failure.cause}`)]
      : []),
    formatRunOrJobEvidence(jobs, details, files, run.id),
    ...(next ? [`next: ${next}`] : []),
  ].filter(Boolean).join("\n");
}

function runFailureGroups(jobs: readonly WorkbenchJob[]): Array<{ status: string; cause: string; count: number; jobIds: string[] }> {
  const groups = new Map<string, { status: string; cause: string; count: number; jobIds: string[] }>();
  for (const job of jobs) {
    if (job.status !== "failed" && job.status !== "canceled") {
      continue;
    }
    const cause = job.error ? singleLine(job.error).slice(0, 240) : job.status;
    const key = `${job.status}\0${cause}`;
    const group = groups.get(key) ?? { status: job.status, cause, count: 0, jobIds: [] };
    group.count += 1;
    group.jobIds.push(job.id);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => right.count - left.count || left.cause.localeCompare(right.cause));
}

type EvidenceHighlight =
  | { kind: "agent_output"; path: string; preview: string }
  | { kind: "agent_session"; path: string; provider?: string; ref?: string; sessionId?: string }
  | {
    kind: "rubric_scorecard";
    path: string;
    score?: number;
    summary?: string;
    criteria: Array<{ id?: string; score?: number; rationale?: string }>;
  };

function evidenceHighlights(files: readonly SurfaceSnapshotFile[]): EvidenceHighlight[] {
  const highlights: EvidenceHighlight[] = [];
  for (const file of files) {
    const basename = path.basename(file.path.replace(/\\/gu, "/"));
    if (file.encoding !== "utf8") {
      continue;
    }
    if (basename === "skill-summary.md" && file.content.trim()) {
      highlights.push({
        kind: "agent_output",
        path: file.path,
        preview: previewBlock(file.content, 1200, 12),
      });
      continue;
    }
    if (basename === "agent-session.json") {
      const record = parseJsonRecord(file.content);
      if (record) {
        const provider = typeof record.provider === "string" ? record.provider : undefined;
        const ref = typeof record.ref === "string" ? record.ref : undefined;
        const sessionId = typeof record.sessionId === "string" ? record.sessionId : undefined;
        if (provider || ref || sessionId) {
          highlights.push({ kind: "agent_session", path: file.path, provider, ref, sessionId });
        }
      }
      continue;
    }
    if (basename === "rubric-scorecard.json") {
      const record = parseJsonRecord(file.content);
      if (record) {
        const criteria = Array.isArray(record.criteria)
          ? record.criteria.flatMap((entry): EvidenceHighlightRubricCriterion[] => {
              const criterion = entry && typeof entry === "object" && !Array.isArray(entry)
                ? entry as Record<string, unknown>
                : null;
              if (!criterion) {
                return [];
              }
              return [{
                id: typeof criterion.id === "string" ? criterion.id : undefined,
                score: typeof criterion.score === "number" ? criterion.score : undefined,
                rationale: typeof criterion.rationale === "string" && criterion.rationale.trim()
                  ? singleLine(criterion.rationale)
                  : undefined,
              }];
            })
          : [];
        highlights.push({
          kind: "rubric_scorecard",
          path: file.path,
          score: typeof record.score === "number" ? record.score : undefined,
          summary: typeof record.summary === "string" && record.summary.trim() ? singleLine(record.summary) : undefined,
          criteria,
        });
      }
    }
  }
  return highlights;
}

type EvidenceHighlightRubricCriterion = Extract<EvidenceHighlight, { kind: "rubric_scorecard" }>["criteria"][number];

function formatEvidenceHighlights(highlights: readonly EvidenceHighlight[]): string[] {
  if (highlights.length === 0) {
    return [];
  }
  const lines: string[] = ["Evidence:"];
  for (const highlight of highlights) {
    if (highlight.kind === "agent_output") {
      lines.push(`Output ${highlight.path}:`);
      lines.push(...highlight.preview.split("\n").map((line) => `  ${line}`));
      continue;
    }
    if (highlight.kind === "agent_session") {
      lines.push(`Session ${highlight.path}: ${highlight.ref ?? highlight.sessionId ?? highlight.provider ?? "unknown"}`);
      continue;
    }
    const score = highlight.score === undefined ? "n/a" : highlight.score.toFixed(3);
    lines.push(`Rubric ${highlight.path}: score=${score}${highlight.summary ? ` summary=${highlight.summary}` : ""}`);
    for (const criterion of highlight.criteria) {
      lines.push(`  ${criterion.id ?? "criterion"} score=${criterion.score === undefined ? "n/a" : criterion.score.toFixed(3)}${criterion.rationale ? ` rationale=${criterion.rationale}` : ""}`);
    }
  }
  return lines;
}

function parseJsonRecord(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function previewBlock(content: string, maxChars: number, maxLines: number): string {
  const lines = content.trimEnd().split(/\r?\n/u).slice(0, maxLines);
  const preview = lines.join("\n");
  if (preview.length <= maxChars) {
    return preview;
  }
  return `${preview.slice(0, maxChars - 3).trimEnd()}...`;
}

function jobEvidenceSummary(job: WorkbenchJob): Json {
  return {
    id: job.id,
    runId: job.runId,
    caseId: job.caseId,
    sample: job.sample,
    status: job.status,
    ...(job.score !== undefined ? { score: job.score } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

function formatJobEvidenceSummary(job: WorkbenchJob, _refs: ReadonlyMap<string, string> = new Map()): string {
  return [
    job.id,
    `case=${job.caseId}`,
    `sample=${job.sample}`,
    job.status,
    job.score !== undefined ? `score=${job.score.toFixed(3)}` : undefined,
    job.error ? `error=${singleLine(job.error)}` : undefined,
  ].filter(Boolean).join("\t");
}

function evidenceDetailSummary(detail: WorkbenchExecutionTraceDetail): Json {
  return {
    runId: detail.runId,
    executions: detail.executions.map((execution) => ({
      id: execution.id,
      status: execution.status,
      jobIds: execution.jobIds,
      sessions: execution.sessions.map((session) => ({
        label: session.label,
      })),
      trace: {
        events: execution.trace.events.length,
        spans: execution.trace.spans.length,
        summaries: execution.trace.summaries.length,
      },
    })),
  };
}

function manifestOnly(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(manifestOnly) as Json;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.path === "string" && typeof record.content === "string") {
    return fileSummary(record as unknown as SurfaceSnapshotFile);
  }
  const out: Record<string, Json> = {};
  for (const [key, child] of Object.entries(record)) {
    if (child === undefined) {
      continue;
    }
    out[key] = manifestOnly(child);
  }
  return out as Json;
}

function formatLogEntry(entry: WorkbenchLogEntry): string {
  if (entry.kind === "version") {
    return `${entry.createdAt}\tversion\t${displayRef(entry.id)}\tfiles=${entry.fileCount}\t${entry.message}`;
  }
  const score = entry.score === undefined ? "n/a" : entry.score.toFixed(3);
  return `${entry.createdAt}\trun\t${displayRef(entry.id)}\t${entry.status}\tversion=${displayRef(entry.versionId)}\tskill=${entry.skillName}\tagent=${entry.agentName}\tscore=${score}`;
}

function splitShowRef(ref: string): [string, string | null] {
  const index = ref.indexOf(":");
  if (index === -1) {
    return [ref, null];
  }
  return [ref.slice(0, index), ref.slice(index + 1)];
}

function fileForSnapshotRef(
  snapshot: InspectionSnapshot,
  objectRef: string,
  requestedPath: string,
): unknown | null {
  const version = snapshotVersionByRef(snapshot, objectRef);
  if (version) {
    const file = version.files.find((entry) => entry.path === requestedPath);
    if (file) {
      return file;
    }
    throw new WorkbenchCodedError("ref_not_found", `File not found in ${version.id}: ${requestedPath}`, {
      remediation: `workbench show ${version.id}`,
      subject: { ref: version.id, path: requestedPath },
      exitCode: 1,
    });
  }
  const runOrJobFile = fileForRunOrJobSnapshotRef(snapshot, objectRef, requestedPath);
  if (runOrJobFile) {
    return runOrJobFile;
  }
  const trace = snapshotObjectByRef(snapshot.traces, objectRef, "trace");
  if (trace) {
    const file = trace.files.filter(isUserFacingTraceEvidenceFile).find((entry) => entry.path === requestedPath);
    if (file) {
      return file;
    }
    throw new WorkbenchCodedError("ref_not_found", `File not found in ${trace.id}: ${requestedPath}`, {
      remediation: `workbench show ${trace.id}`,
      subject: { ref: trace.id, path: requestedPath },
      exitCode: 1,
    });
  }
  const artifact = snapshotObjectByRef(snapshot.artifacts, objectRef, "artifact");
  if (artifact) {
    const file = artifact.files.find((entry) => entry.path === requestedPath);
    if (file) {
      return file;
    }
    throw new WorkbenchCodedError("ref_not_found", `File not found in ${artifact.id}: ${requestedPath}`, {
      remediation: `workbench show ${artifact.id}`,
      subject: { ref: artifact.id, path: requestedPath },
      exitCode: 1,
    });
  }
  return fileForRunOrJobSnapshotRef(snapshot, objectRef, requestedPath);
}

function fileForRunOrJobSnapshotRef(
  snapshot: InspectionSnapshot,
  objectRef: string,
  requestedPath: string,
): SurfaceSnapshotFile | null {
  const selection = runOrJobEvidenceSelection(snapshot, objectRef);
  if (!selection.run && selection.jobs.length === 0) {
    return null;
  }
  const files = evidenceFilesForRunOrJob(snapshot, objectRef);
  const file = findShowFile(files, requestedPath, objectRef);
  if (file) {
    return file;
  }
  throw new WorkbenchCodedError("ref_not_found", `File not found in ${objectRef}: ${requestedPath}`, {
    remediation: `workbench show ${objectRef}`,
    subject: { ref: objectRef, path: requestedPath },
    exitCode: 1,
  });
}

function evidenceDetailsForRunOrJob(snapshot: InspectionSnapshot, ref: string): WorkbenchExecutionTraceDetail[] {
  const selection = runOrJobEvidenceSelection(snapshot, ref);
  return evidenceDetailsForSelection(snapshot, selection);
}

function evidenceDetailsForSelection(
  snapshot: InspectionSnapshot,
  selection: {
    run?: WorkbenchRun;
    jobs: WorkbenchJob[];
  },
): WorkbenchExecutionTraceDetail[] {
  return selection.jobs.flatMap((entry) => {
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

function findShowFile(
  files: readonly SurfaceSnapshotFile[],
  requestedPath: string,
  objectRef: string,
): SurfaceSnapshotFile | null {
  const normalized = requestedPath.replace(/\\/gu, "/");
  const exact = files.filter((file) => file.path === normalized);
  if (exact.length === 1) {
    return exact[0]!;
  }
  const exactEquivalent = singleEquivalentShowFile(exact);
  if (exactEquivalent) {
    return exactEquivalent;
  }
  if (exact.length > 1) {
    throw ambiguousShowPath(objectRef, requestedPath, exact);
  }
  const suffixCandidates = files.filter((file) =>
    file.path.endsWith(`/${normalized}`) || path.basename(file.path) === normalized
  );
  if (suffixCandidates.length === 0) {
    return null;
  }
  const candidates = normalized === "stderr.log"
    ? suffixCandidates.filter((file) => file.content.length > 0)
    : suffixCandidates;
  if (candidates.length === 1) {
    return candidates[0]!;
  }
  if (candidates.length === 0 && suffixCandidates.length === 1) {
    return suffixCandidates[0]!;
  }
  throw ambiguousShowPath(objectRef, requestedPath, candidates.length > 0 ? candidates : suffixCandidates);
}

function singleEquivalentShowFile(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile | null {
  if (files.length <= 1) {
    return null;
  }
  const first = files[0]!;
  return files.every(
    (file) => file.kind === first.kind && file.encoding === first.encoding && file.content === first.content,
  )
    ? first
    : null;
}

function ambiguousShowPath(
  objectRef: string,
  requestedPath: string,
  candidates: readonly SurfaceSnapshotFile[],
): WorkbenchCodedError {
  const candidatePaths = candidates.map((file) => file.path);
  return new WorkbenchCodedError("ref_ambiguous", `File path is ambiguous in ${objectRef}: ${requestedPath}. Candidates: ${candidatePaths.join(", ")}.`, {
    remediation: `workbench show ${objectRef}`,
    subject: { ref: objectRef, path: requestedPath, candidates: candidatePaths },
    exitCode: 2,
  });
}

function fileListing(kind: "version" | "trace" | "artifact", id: string, files: readonly SurfaceSnapshotFile[]): Json {
  return {
    kind,
    id,
    fileCount: files.length,
    files: files.map((file) => fileSummary(file, showFileRef(id, file.path))),
  };
}

function formatFileListing(kind: "version" | "trace" | "artifact", id: string, files: readonly SurfaceSnapshotFile[]): string {
  return [
    `${kind}\t${displayRef(id)}\tfiles=${files.length}`,
    ...files.map((file) => `workbench show ${quoteShellArg(showFileRef(id, file.path))}`),
  ].join("\n");
}

function showFileRef(ownerRef: string, filePath: string): string {
  return `${ownerRef}:${filePath}`;
}

interface EvalCoverage {
  runId: string;
  skillName: string;
  agentName: string;
  cases: number;
  samples: number;
  jobs: number;
  succeeded: number;
  failed: number;
}

async function evalCoverageSummaries(
  core: { dir?: string; authToken?: string },
  runs: readonly WorkbenchRun[],
): Promise<EvalCoverage[]> {
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const runIds = new Set(runs.map((run) => run.id));
  const coverageByKey = new Map<string, EvalCoverage & { sampleKeys: Set<string>; caseIds: Set<string> }>();
  for (const job of snapshot.jobs) {
    if (!runIds.has(job.runId) || job.caseId === "current") {
      continue;
    }
    const key = [
      job.runId,
      job.skillName,
      job.skillBundleHash,
      job.evalHash,
      job.agentName,
      job.agentHash,
    ].join("\0");
    const current = coverageByKey.get(key) ?? {
      runId: job.runId,
      skillName: job.skillName,
      agentName: job.agentName,
      cases: 0,
      samples: 0,
      jobs: 0,
      succeeded: 0,
      failed: 0,
      sampleKeys: new Set<string>(),
      caseIds: new Set<string>(),
    };
    current.caseIds.add(job.caseId);
    current.sampleKeys.add(`${job.caseId}\0${job.sample}`);
    current.jobs += 1;
    if (job.status === "succeeded") {
      current.succeeded += 1;
    }
    if (job.status === "failed" || job.status === "canceled") {
      current.failed += 1;
    }
    coverageByKey.set(key, current);
  }
  return [...coverageByKey.values()].map((entry) => {
    const { sampleKeys, caseIds, ...coverage } = entry;
    return {
      ...coverage,
      cases: caseIds.size,
      samples: sampleKeys.size,
    };
  });
}

function formatEvalCoverageLines(coverage: readonly EvalCoverage[]): string[] {
  const includeRunLabels = coverage.length > 1;
  return coverage.map((entry) => formatEvalCoverage(entry, includeRunLabels));
}

function formatEvalCoverage(coverage: EvalCoverage, includeRunLabels = false): string {
  return [
    `coverage cases=${coverage.cases}`,
    `samples=${coverage.samples}`,
    `jobs=${coverage.jobs}`,
    coverage.failed > 0 ? `failed=${coverage.failed}` : undefined,
    includeRunLabels ? `run=${displayRef(coverage.runId)}` : undefined,
    includeRunLabels ? `skill=${coverage.skillName}` : undefined,
    includeRunLabels ? `agent=${coverage.agentName}` : undefined,
  ].filter(Boolean).join(" ");
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
    const score = scoredRunValue(run);
    const previous = snapshot.runs
      .filter((candidate) =>
        candidate.id !== run.id &&
        candidate.skillName === run.skillName &&
        candidate.agentName === run.agentName &&
        scoredRunValue(candidate) !== undefined &&
        candidate.createdAt < run.createdAt
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const previousScore = previous ? scoredRunValue(previous) : undefined;
    return {
      runId: run.id,
      versionId: run.versionId,
      skillName: run.skillName,
      agentName: run.agentName,
      ...(score !== undefined ? { score } : {}),
      ...(previousScore !== undefined ? { previousScore } : {}),
      ...(score !== undefined && previousScore !== undefined ? { delta: score - previousScore } : {}),
    };
  });
}

function formatEvalDeltaLines(deltas: readonly EvalDelta[]): string[] {
  const includeRunLabels = deltas.length > 1;
  return deltas
    .map((delta) => formatEvalDelta(delta, includeRunLabels))
    .filter((line) => line.length > 0);
}

function formatEvalDelta(delta: EvalDelta, includeRunLabels = false): string {
  if (delta.score === undefined) {
    return "";
  }
  const label = includeRunLabels ? `${delta.skillName}/${delta.agentName}` : delta.skillName;
  const score = delta.score.toFixed(3);
  if (delta.previousScore === undefined || delta.delta === undefined) {
    return `${label} ${displayRef(delta.versionId)} ${score}`;
  }
  const sign = delta.delta >= 0 ? "+" : "";
  return `${label} ${displayRef(delta.versionId)} ${score} (was ${delta.previousScore.toFixed(3)}, ${sign}${delta.delta.toFixed(3)})`;
}

async function evalSuccessNextCommand(
  core: { dir?: string; authToken?: string },
  runs: readonly WorkbenchRun[],
): Promise<string | null> {
  if (runs.length === 0) {
    return "workbench eval";
  }
  if (!runs.some((run) => scoredRunValue(run) !== undefined)) {
    return "workbench eval";
  }
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  if (runs.some(scoredRunIsBelowPerfect)) {
    if (postImproveValidationBeatsIncumbent(snapshot, runs)) {
      return await publishReadyNextCommand(core);
    }
    return belowPerfectEvalNextCommand(snapshot, runs);
  }
  if (!snapshotHasWorkflowCase(snapshot)) {
    return "workbench compare";
  }
  return await publishReadyNextCommand(core);
}

function improveNextCommandForAgent(skill: string, agent: WorkbenchAgent): string {
  if (!workbenchSkillImproveCanUseQueuedAdapter(agent)) {
    return workbenchSkillImproveAdapterRemediation(agent);
  }
  return `workbench improve --skills ${shellQuote(skill)} --agents ${shellQuote(agent.name)}`;
}

async function publishReadyNextCommand(core: { dir?: string; authToken?: string }): Promise<string> {
  const auth = await workbenchCliAuthStatus();
  if (auth.workbenchCloud.status !== "authenticated") {
    return "workbench login";
  }
  const status = await workbenchStatusSnapshot(core);
  return statusHasPublishedCurrentCloudSource(status) ? "workbench compare" : "workbench publish";
}

function postImproveValidationBeatsIncumbent(
  snapshot: WorkbenchInspectionSnapshot,
  runs: readonly WorkbenchRun[],
): boolean {
  const scoredRuns = runs.filter((run) =>
    run.kind === "eval" &&
    run.status === "succeeded" &&
    typeof run.score === "number"
  );
  if (scoredRuns.length === 0) {
    return false;
  }
  for (const run of scoredRuns) {
    const improveRun = snapshot.runs
      .filter((candidate) =>
        candidate.kind === "improve" &&
        candidate.status === "succeeded" &&
        candidate.outputVersionId === run.versionId &&
        candidate.skillName === run.skillName &&
        candidate.evalHash === run.evalHash &&
        candidate.agentName === run.agentName &&
        candidate.agentHash === run.agentHash
      )
      .sort((left, right) => runEvidenceTime(right).localeCompare(runEvidenceTime(left)))[0];
    if (!improveRun) {
      return false;
    }
    const incumbent = bestScoredEvalRunForSelection(snapshot, {
      versionId: improveRun.baseVersionId ?? improveRun.versionId,
      skillName: improveRun.skillName,
      skillBundleHash: improveRun.skillBundleHash,
      evalHash: improveRun.evalHash,
      agentName: improveRun.agentName,
      agentHash: improveRun.agentHash,
    });
    if (incumbent && run.score! <= incumbent.score) {
      return false;
    }
  }
  return true;
}

function bestScoredEvalRunForSelection(
  snapshot: WorkbenchInspectionSnapshot,
  args: {
    versionId: string;
    skillName: string;
    skillBundleHash: string;
    evalHash: string;
    agentName: string;
    agentHash: string;
  },
): { run: WorkbenchRun; score: number; samples: number } | null {
  const candidates = snapshot.runs
    .filter((run) =>
      run.kind === "eval" &&
      run.status === "succeeded" &&
      run.versionId === args.versionId &&
      run.skillName === args.skillName &&
      run.skillBundleHash === args.skillBundleHash &&
      run.evalHash === args.evalHash &&
      run.agentName === args.agentName &&
      run.agentHash === args.agentHash &&
      typeof run.score === "number"
    )
    .map((run) => ({
      run,
      score: run.score!,
      samples: new Set(snapshot.jobs
        .filter((job) => job.runId === run.id && job.caseId !== "current")
        .map((job) => `${job.caseId}\0${job.sample}`)).size || run.jobIds?.length || 0,
    }))
    .sort((left, right) =>
      right.samples - left.samples ||
      runEvidenceTime(right.run).localeCompare(runEvidenceTime(left.run))
    );
  return candidates[0] ?? null;
}

function statusHasPublishedCurrentCloudSource(status: Awaited<ReturnType<typeof workbenchStatusSnapshot>>): boolean {
  const currentVersionId = status.project.currentVersionId;
  return Boolean(currentVersionId && status.remotes.some((remote) =>
    remote.kind === "workbench-cloud" &&
    remote.publication.status === "published" &&
    remote.publication.versionId === currentVersionId
  ));
}

function formatStatusSnapshot(status: WorkbenchStatusSnapshotWithProgress & {
  auth?: WorkbenchCliAuthStatus;
  machine?: WorkbenchMachineStatus;
}): string {
  const lines = [
    `Root: ${status.project.root}`,
    `Initialized: ${status.project.initialized ? "yes" : "no"}`,
    `Installed skills: ${status.machine?.installedSkillCount ?? 0}`,
    `Connected providers: ${status.machine?.connectedProviders.length
      ? status.machine.connectedProviders.map((entry) => `${entry.adapter}/${entry.profile}`).join(", ")
      : "none"}`,
    ...(status.project.currentVersionId ? [`Current version: ${displayRef(status.project.currentVersionId)}`] : []),
    ...(status.project.defaultSkill ? [`Default skill: ${status.project.defaultSkill}`] : []),
    ...(status.project.defaultAgent ? [`Default agent: ${status.project.defaultAgent}`] : []),
    `Runs: ${status.runs.total}${status.runs.lastStatus ? ` (last ${status.runs.lastStatus})` : ""}`,
    ...((status.runs.activeRuns?.length ?? 0) > 0
      ? [
        "Active runs:",
        ...status.runs.activeRuns!.map(formatStatusActiveRun),
      ]
      : []),
    `Workbench Cloud: ${status.auth?.workbenchCloud.status ?? "not_authenticated"}${status.auth?.workbenchCloud.baseUrl ? ` ${status.auth.workbenchCloud.baseUrl}` : ""}`,
    ...(status.remotes.length > 0 ? ["Remotes:", ...status.remotes.flatMap((remote) => {
      const publication = remote.publication.status === "published"
        ? [
            "publication=published",
            remote.publication.visibility ? `visibility=${remote.publication.visibility}` : undefined,
            remote.publication.versionId ? `version=${displayRef(remote.publication.versionId)}` : undefined,
            remote.publication.installHandle ? `handle=${remote.publication.installHandle}` : undefined,
          ].filter(Boolean).join("\t")
        : "publication=unpublished";
      return [
        `  ${remote.name}\tkind=${remote.kind}\tsync=${remote.sync.status}\turl=${remote.url}\t${publication}`,
        ...(remote.sync.status === "error" && remote.sync.lastError
          ? [
            `    error[${remote.sync.lastError.code}]: ${remote.sync.lastError.message}`,
            ...(remote.sync.lastAttemptAt ? [`    last attempt: ${remote.sync.lastAttemptAt}`] : []),
          ]
          : []),
      ];
    })] : ["Remotes: none"]),
    ...(status.next ? [`next: ${shortenCommandRefs(status.next)}`] : []),
  ];
  return lines.join("\n");
}

function formatStatusActiveRun(run: WorkbenchActiveRunStatusForCli): string {
  return [
    `  ${displayRef(run.id)}`,
    run.kind,
    run.location,
    run.status,
    `skill=${run.skillName}`,
    `agent=${run.agentName}`,
    run.workTotal !== undefined && run.workDone !== undefined ? `work=${run.workDone}/${run.workTotal}` : undefined,
    run.scored !== undefined ? `scored=${run.scored}` : undefined,
    run.partialScore !== undefined ? `partial=${run.partialScore.toFixed(3)}` : undefined,
    `failed=${run.failed}`,
    run.canceled !== undefined && run.canceled > 0 ? `canceled=${run.canceled}` : undefined,
    `health=${run.health}`,
    `next=${run.next}`,
  ].filter(Boolean).join("\t");
}

function formatInstalledInventory(inventory: WorkbenchSkillAccessInventory): string {
  if (inventory.skills.length === 0) {
    return [
      `No skills accessible${inventory.scope === "global" ? " globally" : " in this folder"}.`,
      ...(inventory.next ? [`next: ${inventory.next}`] : []),
    ].filter(Boolean).join("\n");
  }
  const lines = [
    "name\tavailable to\tstatus\tsource",
    ...inventory.skills.map(formatInstalledSkill),
    ...(inventory.next ? [`next: ${inventory.next}`] : []),
  ];
  return lines.join("\n");
}

function formatInstalledSkill(skill: WorkbenchInstalledSkill): string {
  return [
    skill.name,
    skill.target,
    skill.status,
    skill.handle ?? "(no provenance)",
  ].join("\t");
}

function formatVersion(version: WorkbenchVersion): string {
  return `${displayRef(version.id)}\t${version.hash.slice(0, 12)}\t${version.message}`;
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
  const scoreValue = scoredRunValue(run);
  const score = scoreValue === undefined ? "n/a" : scoreValue.toFixed(3);
  const latency = run.latencyMs === undefined ? "n/a" : `${run.latencyMs}ms`;
  return `${displayRef(run.id)}\t${run.kind}\t${run.status}\tversion=${displayRef(run.versionId)}\tskill=${run.skillName}\tagent=${run.agentName}\tscore=${score}\tlatency=${latency}`;
}

function formatRunSnapshot(snapshot: WorkbenchRunSnapshot): string {
  const progress = snapshot.progress.planned > 0
    ? `${snapshot.progress.completed}/${snapshot.progress.planned}`
    : "n/a";
  const scoreValue = snapshot.result?.score ?? snapshot.progress.partialScore;
  const score = scoreValue === undefined ? "n/a" : scoreValue.toFixed(3);
  const cost = snapshot.progress.costUsd === undefined ? "n/a" : `$${snapshot.progress.costUsd.toFixed(4)}`;
  const header = [
    displayRef(snapshot.id),
    snapshot.kind,
    snapshot.status,
    `phase=${snapshot.phase}`,
    `progress=${progress}`,
    `scored=${snapshot.progress.scored}`,
    `failed=${snapshot.progress.failed}`,
    `canceled=${snapshot.progress.canceled}`,
    `score=${score}`,
    `cost=${cost}`,
  ].join("\t");
  const measurements = snapshot.measurements.length > 1
    ? snapshot.measurements.map((measurement) => {
        const measurementScore = measurement.score === undefined ? "n/a" : measurement.score.toFixed(3);
        const latency = measurement.latencyMs === undefined ? "n/a" : `${measurement.latencyMs}ms`;
        return [
          "  measurement",
          `run=${displayRef(measurement.runId)}`,
          `version=${displayRef(measurement.versionId)}`,
          `skill=${measurement.skillName}`,
          `agent=${measurement.agentName}`,
          measurement.status,
          `score=${measurementScore}`,
          `samples=${measurement.samples ?? "n/a"}`,
          `latency=${latency}`,
        ].join("\t");
      })
    : [];
  return [header, ...measurements].join("\n");
}

function formatJob(job: WorkbenchJob): string {
  const scoreValue = scoredJobValue(job);
  const score = scoreValue === undefined ? "n/a" : scoreValue.toFixed(3);
  const duration = job.durationMs === undefined ? "n/a" : `${job.durationMs}ms`;
  return `${displayRef(job.id)}\trun=${displayRef(job.runId)}\tcase=${job.caseId}\tsample=${job.sample}\t${job.status}\tscore=${score}\tduration=${duration}`;
}

function formatComparison(comparison: WorkbenchComparison): string {
  const lines = ["version\tskill\tagent\tstatus\tscore\tsamples\tcost\tavg latency\trun"];
  const evidenceCells = comparison.cells.filter((cell) => cell.runId || cell.status);
  for (const cell of evidenceCells) {
    lines.push([
      displayRef(cell.versionId),
      cell.skillName,
      `${cell.agentName}@${shortObjectId(cell.agentHash)}`,
      cell.status ?? "not-run",
      cell.score === undefined ? "n/a" : cell.score.toFixed(3),
      cell.samples === undefined ? "n/a" : String(cell.samples),
      cell.costUsd === undefined ? "n/a" : `$${cell.costUsd.toFixed(4)}`,
      cell.latencyMs === undefined ? "n/a" : `${cell.latencyMs}ms`,
      cell.runId ? displayRef(cell.runId) : "n/a",
    ].join("\t"));
  }
  return lines.length === 1 ? "No comparable runs." : lines.join("\n");
}

function formatDiff(entries: readonly { path: string; status: string; before?: string; after?: string }[]): string {
  if (entries.length === 0) {
    return "No diff.";
  }
  return entries.map(formatDiffEntry).join("\n");
}

function formatDiffEntry(entry: { path: string; status: string; before?: string; after?: string }): string {
  const before = entry.before ?? "";
  const after = entry.after ?? "";
  if (entry.status === "modified" || entry.status === "added" || entry.status === "removed") {
    return [
      `diff --workbench ${entry.path}`,
      `--- ${entry.status === "added" ? "/dev/null" : `a/${entry.path}`}`,
      `+++ ${entry.status === "removed" ? "/dev/null" : `b/${entry.path}`}`,
      ...unifiedLineDiff(before, after),
    ].join("\n");
  }
  return `${entry.status}\t${entry.path}`;
}

function unifiedLineDiff(before: string, after: string): string[] {
  const beforeLines = splitDiffLines(before);
  const afterLines = splitDiffLines(after);
  const table = longestCommonSubsequenceTable(beforeLines, afterLines);
  const lines: string[] = [];
  let left = 0;
  let right = 0;
  while (left < beforeLines.length && right < afterLines.length) {
    if (beforeLines[left] === afterLines[right]) {
      lines.push(` ${beforeLines[left]}`);
      left += 1;
      right += 1;
    } else if (table[left + 1]![right]! >= table[left]![right + 1]!) {
      lines.push(`-${beforeLines[left]}`);
      left += 1;
    } else {
      lines.push(`+${afterLines[right]}`);
      right += 1;
    }
  }
  while (left < beforeLines.length) {
    lines.push(`-${beforeLines[left]}`);
    left += 1;
  }
  while (right < afterLines.length) {
    lines.push(`+${afterLines[right]}`);
    right += 1;
  }
  return lines.length > 0 ? lines : [" "];
}

function splitDiffLines(value: string): string[] {
  const withoutFinalNewline = value.endsWith("\n") ? value.slice(0, -1) : value;
  return withoutFinalNewline ? withoutFinalNewline.split(/\r?\n/u) : [];
}

function longestCommonSubsequenceTable(left: readonly string[], right: readonly string[]): number[][] {
  const table = Array.from({ length: left.length + 1 }, () => Array.from({ length: right.length + 1 }, () => 0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i]![j] = left[i] === right[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

function shortObjectId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatTrace(trace: WorkbenchTrace): string {
  const result = asRecord(trace.result);
  const status = typeof result?.status === "string" ? result.status : undefined;
  const score = status === "succeeded" && typeof result?.score === "number" ? result.score.toFixed(3) : undefined;
  const error = typeof result?.error === "string" ? result.error.split(/\r?\n/u)[0] : undefined;
  const files = trace.files.slice(0, 5).map((file) => file.path).join(",");
  return [
    `${displayRef(trace.id)}\trun=${displayRef(trace.runId)}\tjob=${trace.jobId ? displayRef(trace.jobId) : "n/a"}\tversion=${displayRef(trace.versionId)}\tskill=${trace.skillName}\tagent=${trace.agentName}`,
    status ? `status=${status}` : undefined,
    score ? `score=${score}` : undefined,
    error ? `error=${error}` : undefined,
    `files=${trace.files.length}${files ? ` (${files}${trace.files.length > 5 ? ",..." : ""})` : ""}`,
  ].filter(Boolean).join("\t");
}

function traceSummary(trace: WorkbenchTrace): Json {
  const result = asRecord(trace.result);
  const status = typeof result?.status === "string" ? result.status : undefined;
  return {
    id: trace.id,
    runId: trace.runId,
    ...(trace.jobId ? { jobId: trace.jobId } : {}),
    versionId: trace.versionId,
    skillName: trace.skillName,
    agentName: trace.agentName,
    createdAt: trace.createdAt,
    ...(status ? { status } : {}),
    ...(status === "succeeded" && typeof result?.score === "number" ? { score: result.score } : {}),
    ...(typeof result?.error === "string" ? { error: singleLine(result.error) } : {}),
    fileCount: trace.files.length,
    files: trace.files.map((file) => fileSummary(file)),
  };
}

function formatTraceDetail(
  detail: WorkbenchExecutionTraceDetail,
  refs: {
    jobRefs?: ReadonlyMap<string, string>;
    runRefs?: ReadonlyMap<string, string>;
  } = {},
): string {
  return detail.executions.map((execution) => {
    const sessionLabels = execution.sessions.map((session) => session.label).join(",");
    return [
      `${formatExecutionEvidenceLabel(detail, execution)}\trun=${refs.runRefs?.get(detail.runId) ?? displayRef(detail.runId)}\tjobs=${execution.jobIds.map((id) => refs.jobRefs?.get(id) ?? displayRef(id)).join(",")}\tstatus=${execution.status}`,
      `events=${execution.trace.events.length}`,
      `spans=${execution.trace.spans.length}`,
      `summaries=${execution.trace.summaries.length}`,
      sessionLabels ? `sessions=${sessionLabels}` : undefined,
    ].filter(Boolean).join("\t");
  }).join("\n");
}

function formatExecutionEvidenceLabel(
  detail: WorkbenchExecutionTraceDetail,
  execution: WorkbenchExecutionTraceDetail["executions"][number],
): string {
  return execution.jobIds.length === 1 && execution.id === `job:${detail.runId}:${execution.jobIds[0]}`
    ? "evidence"
    : execution.id;
}

function formatArtifact(artifact: WorkbenchArtifact): string {
  return `${displayRef(artifact.id)}\trun=${displayRef(artifact.runId)}\tjob=${displayRef(artifact.jobId)}\t${artifact.kind}\tfiles=${artifact.files.length}`;
}

function artifactSummary(artifact: WorkbenchArtifact): Json {
  return {
    id: artifact.id,
    runId: artifact.runId,
    jobId: artifact.jobId,
    kind: artifact.kind,
    fileCount: artifact.files.length,
    files: artifact.files.map((file) => fileSummary(file)),
  };
}

function fileSummary(file: SurfaceSnapshotFile, ref?: string): Json {
  return {
    path: file.path,
    ...(ref ? { ref } : {}),
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
