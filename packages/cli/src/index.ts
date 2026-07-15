import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import {
  addWorkbenchRemote,
  adapterAuthRemediationFromError,
  assertWorkbenchLaunchReadinessReady,
  addWorkbenchAgent,
  resultsWorkbench,
  createWorkbenchRunId,
  createWorkbenchEvalSnapshotFromEvalFiles,
  createWorkbenchRunSnapshotForRun,
  createWorkbenchAdapterAuthBundle,
  createWorkbenchReadOnlyInspectionSnapshot,
  currentWorkbenchEvalSnapshot,
  currentWorkbenchSkillName,
  clearDeletedWorkbenchCloudProjectLocalState,
  copyWorkbenchOperationTarget,
  diffWorkbenchVersions,
  createNewWorkbenchSkillProject,
  initExistingWorkbenchSkillProject,
  initializeHydratedWorkbenchSkillProject,
  listWorkbenchAgents,
  listWorkbenchVersions,
  localWorkbenchAdapterAuthStore,
  parseWorkbenchAdapterAuthTarget,
  quoteShellArg,
  hasWorkbenchLocalRunCancellationRequest,
  prepareWorkbenchCloudEvalRequest,
  prepareWorkbenchCloudImproveRequest,
  previewWorkbenchEval,
  previewWorkbenchImprove,
  publishWorkbenchVersion,
  requestWorkbenchCloudJson,
  clearWorkbenchPendingCloudOperation,
  recordWorkbenchCloudInspectionSnapshot,
  recordWorkbenchCloudRunSnapshot,
  readWorkbenchPendingCloudOperation,
  recordWorkbenchPendingCloudOperation,
  reconcileCurrentWorkbenchVersion,
  requestLocalWorkbenchRunCancellation,
  requestWorkbenchPendingCloudOperationCancellation,
  resolveWorkbenchRunRetryRequest,
  resolveWorkbenchObjectByRef,
  removeWorkbenchAgent,
  showWorkbenchRef,
  sleep,
  switchWorkbenchVersion,
  syncWorkbenchRemote,
  unpublishWorkbenchVersion,
  workbenchJobEvidenceForSnapshot,
  workbenchProviderAuthSetupCommand,
  workbenchOperationCliEquivalent,
  workbenchRunResultsCliEquivalent,
  workbenchRunFromSnapshot,
  workbenchRunTransitionCliEquivalent,
  workbenchAuthorEvalCaseCommand,
  workbenchDraftEvalCaseFiles,
  workbenchAdapterAuthTargetIdentity,
  writeWorkbenchEvaluationGradeSourceFiles,
  applyWorkbenchEvalPatch,
  writeFileAtomically,
  codedErrorFromUnknown,
  WorkbenchCodedError,
  WORKBENCH_AUTHOR_EVAL_CASE_COMMAND,
  WorkbenchUserError,
  type WorkbenchAdapterAuthBundle,
  type WorkbenchAdapterAuthFile,
  type WorkbenchAdapterAuthStatusRecord,
  type WorkbenchAdapterAuthTarget,
  type WorkbenchSwitchResult,
  type WorkbenchEvalPreview,
  type WorkbenchImprovePreview,
  type WorkbenchLaunchReadiness,
  type WorkbenchLaunchReadinessIssue,
  type WorkbenchPendingCloudOperation,
} from "@workbench-ai/workbench-core";
import {
  codexAuthJsonHasUsableToken,
  codexDeviceAuthLoginCommand,
} from "@workbench-ai/agent-driver-openai-codex";
import { builtinWorkbenchSourceProducers } from "@workbench-ai/workbench-built-in-adapters";
import {
  buildWorkbenchRunEvidenceView,
  buildWorkbenchJobReport,
  isWorkbenchRunStatusTerminal,
  isWorkbenchPackageSourcePath,
  normalizeWorkbenchSkillName,
  normalizeWorkbenchCommandRemediation,
  parseWorkbenchEvalDraft,
  parseWorkbenchCloudErrorBody,
  parseWorkbenchOperation,
  parseWorkbenchSourceReviewPatch,
  workbenchPublishedSkillVersionRefMatches,
  workbenchJobReportMetricBreakdown,
  workbenchJobScore,
  workbenchSampleCoverageTotal,
  workbenchTraceProjection,
  type Json,
  type SurfaceSnapshotFile,
  type WorkbenchAgent,
  type WorkbenchEvalSnapshot,
  type WorkbenchExecutionTraceDetail,
  type WorkbenchInspectionSnapshot,
  type WorkbenchInspectionSnapshotEnvelope,
  type WorkbenchSkillPackageSnapshot,
  type WorkbenchJob,
  type WorkbenchJobReport,
  type WorkbenchJobRole,
  type WorkbenchReportMetricKind,
  type WorkbenchMeasurementSummary,
  type WorkbenchModelAuthorization,
  type WorkbenchOperationRequest,
  type WorkbenchRemote,
  type WorkbenchResults,
  type WorkbenchRun,
  type WorkbenchRunKind,
  type WorkbenchRunSnapshot,
  type WorkbenchStateNotice,
  type WorkbenchStatus,
  type WorkbenchTrace,
  type WorkbenchVersion,
  type WorkbenchRunEvidenceMeasurementResult,
  type WorkbenchRunEvidenceJobGroupResult,
  type WorkbenchRunEvidenceCaseResult,
  type WorkbenchRunEvidenceJob,
  type WorkbenchRunEvidenceView,
  type WorkbenchSampleCoverage,
  type WorkbenchEvalDraftApplyRequest,
  type WorkbenchEvalDraftRequest,
  type WorkbenchModelPreflight,
  type WorkbenchOperation,
  type WorkbenchSourceAnalysisViewResponse,
  type WorkbenchSourceAnalysisReview,
  type WorkbenchSourceAnalyzeRequest,
  type WorkbenchSourceCreateRequest,
  type WorkbenchSourceDetailResponse,
  type WorkbenchSourceEvidenceResponse,
  type WorkbenchSourceListResponse,
  type WorkbenchSourceOccurrenceLookupResponse,
  type WorkbenchSourceWorkflowNode,
  type WorkbenchSourceWorkflowOccurrence,
} from "@workbench-ai/workbench-contract";
import { emitError, emitResult, jsonValue, type CliIo, type JsonSerializable } from "./output.js";
import { asRecord, pathExists, positiveIntEnv } from "./runtime-utils.js";
import {
  formatCostUsd,
  humanFormatOptions,
  PLAIN_HUMAN_FORMAT,
  renderTable,
  styleStatus,
  type HumanFormatOptions,
} from "./human-format.js";
import {
  createProgressRenderer,
  formatProgressSummary,
  runProgressSnapshotFromRuns,
  workbenchOperationInvocation,
  type ProgressEvidenceCounts,
  type WorkbenchProgressCommand,
  type WorkbenchProgressPhase,
} from "./progress.js";
import {
  installedInventoryToJson,
  installPackageFiles,
  installResultToJson,
  installSnapshotToSkillTarget,
  normalizeInstallSnapshotPath,
  readInstalledSkillsInventory,
  type WorkbenchInstallResult,
  type WorkbenchSkillAccessInventory,
} from "./install-targets.js";
import {
  conciseExternalSkillsFailureReason,
  runExternalSkillInstall,
  type ExternalSkillInstallResult,
} from "./external-skills.js";
import {
  localWorkerErrorForRun,
  startPrivateLocalWorkbenchOperation,
} from "./local-worker-control.js";
import { startWorkbenchOpenServer } from "./open-server.js";
import {
  bindLocalWorkbenchSource,
  readOptionalLocalWorkbenchSourceBinding,
  removeLocalWorkbenchSourceBinding,
  syncLocalWorkbenchSource,
} from "./sources.js";
import {
  bindWorkbenchRemoteTarget,
  readOptionalWorkbenchRemoteTarget,
  normalizeWorkbenchBackendUrl,
  type WorkbenchRemoteTarget,
  type WorkbenchRemoteTargetKind,
} from "./remote-targets.js";
import {
  allowedFlagsForWorkbenchCommand,
  renderWorkbenchCommandHelp,
  renderWorkbenchHelp,
  renderWorkbenchHelpAll,
  type FlagKind,
  type FlagSpec,
} from "./command-surface.js";

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
}

interface CliCoreOptions {
  dir?: string;
  authToken?: string;
  adapterAuthStoreRoot?: string;
  homeDir?: string;
  env?: Record<string, string | undefined>;
}

interface WorkbenchSkillHandle {
  owner: string;
  skill: string;
}

const require = createRequire(import.meta.url);
const EDITOR_COMMAND = "${EDITOR:-vi}";

export async function runCli(argv: readonly string[], io: CliIo = {
  stdout: process.stdout,
  stderr: process.stderr,
}): Promise<number> {
  const parsed = parseArgs(normalizeCliArgv(argv));
  const command = parsed.positionals[0];
  try {
    validateCommandFlags(parsed, command);
    if (command === "version" || parsed.flags.version === true) {
      io.stdout.write(`workbench ${getCliVersion()}\n`);
      return 0;
    }
    if (command === "help") {
      const helpCommand = command === "help" ? optionalPositional(parsed, 1) : undefined;
      io.stdout.write(`${parsed.flags.all === true ? renderWorkbenchHelpAll() : helpCommand ? renderWorkbenchCommandHelp(helpCommand) : renderWorkbenchHelp()}\n`);
      return 0;
    }
    if (parsed.flags.help === true) {
      io.stdout.write(`${command ? renderWorkbenchCommandHelp(command) : renderWorkbenchHelp()}\n`);
      return 0;
    }
    if (!command) {
      io.stdout.write(`${renderWorkbenchHelp()}\n`);
      return 0;
    }
    if (command === "source") {
      return await handleSource(parsed, io);
    }
    if (command === "eval" && optionalPositional(parsed, 1) === "draft") {
      return await handleEvalDraft(parsed, io);
    }
    if (command === "eval" && optionalPositional(parsed, 1) === "apply") {
      return await handleEvalApply(parsed, io);
    }
    if (command === "eval" && optionalPositional(parsed, 1) === "discard") {
      return await handleEvalDiscard(parsed, io);
    }
    const action = optionalPositional(parsed, 1);
    if ((command === "eval" || command === "skill") && !action) {
      throw new WorkbenchUserError(`workbench ${command} requires a command.`);
    }
    if (command === "login") {
      return await handleLogin(parsed, io);
    }
    if (command === "logout") {
      return await handleLogout(parsed, io);
    }
    if (command === "skill" && action === "install") {
      return await handleInstall(parsed, io);
    }
    if (command === "skill" && action === "list") {
      return await handleSkills(parsed, io);
    }
    if (command === "skill" && action === "clone") {
      return await handleClone(parsed, io);
    }
    if (command === "skill" && action === "delete") {
      return await handleDelete(parsed, io);
    }
    if (command === "skill" && action === "new") {
      rejectExtraInput(parsed, {
        maxPositionals: 3,
        message: "workbench skill new accepts one destination directory.",
        remediation: "workbench skill new DIR",
      });
      const destination = requiredPositional(parsed, 2, "workbench skill new requires a directory.", "workbench skill new DIR");
      const status = await createNewWorkbenchSkillProject({
        dir: destination,
        agent: stringFlag(parsed, "agent"),
        model: stringFlag(parsed, "model"),
        auth: stringFlag(parsed, "auth"),
        adapterAuthStoreRoot: adapterAuthStoreRoot(),
      });
      const next = newProjectNextCommand(status.root);
      return emitResult("workbench.cli.skill-new.v1", {
        result: status,
        defaultAgent: status.defaultAgentSelection,
        setupCommands: status.defaultAgentSelection
          ? status.defaultAgentSelection.readiness.setupCommands
          : undefined,
        next: next,
      }, parsed, io, () => formatProjectSetupResult(status, next, "Created Workbench skill at"));
    }
    if (command === "skill" && action === "init") {
      rejectExtraInput(parsed, {
        maxPositionals: 2,
        message: "workbench skill init does not accept a directory argument.",
        remediation: "workbench skill init",
      });
      const status = await initExistingWorkbenchSkillProject({
        dir: process.cwd(),
        agent: stringFlag(parsed, "agent"),
        model: stringFlag(parsed, "model"),
        auth: stringFlag(parsed, "auth"),
        adapterAuthStoreRoot: adapterAuthStoreRoot(),
      });
      const next = newProjectNextCommand(status.root);
      return emitResult("workbench.cli.skill-init.v1", {
        result: status,
        defaultAgent: status.defaultAgentSelection,
        setupCommands: status.defaultAgentSelection
          ? status.defaultAgentSelection.readiness.setupCommands
          : undefined,
        next: next,
      }, parsed, io, () => formatProjectSetupResult(status, next, "Initialized Workbench controls at"));
    }
    const core = await coreOptions(parsed);
    if (command === "eval" && action === "case") {
      return await handleCase(parsed, io);
    }
    if (command === "eval" && action === "grader") {
      return await handleEvalGrader(parsed, io);
    }
    if (command === "eval" && (action === "run" || action === "grade")) {
      const evalCommand = action;
      rejectExtraInput(parsed, {
        maxPositionals: 2,
        message: `workbench eval ${evalCommand} does not accept a VERSION argument.`,
        remediation: `workbench eval ${evalCommand}`,
      });
      if (parsed.flags["dry-run"] === true) {
        return await handleEvalDryRun(parsed, io, evalCommand);
      }
      if (parsed.flags.cloud === true) {
        return await handleCloudEvalLike(evalCommand, parsed, io);
      }
      const request = evalOperationRequest(parsed, "local", evalCommand);
      await assertLocalEvalLaunchReadiness(core, request);
      const started = await startPrivateLocalWorkbenchOperation({
        core,
        request,
      });
      const completed = await waitForLocalRunTerminal({
        command: evalCommand,
        core,
        initialSnapshot: started.snapshot,
        io,
        json: parsed.flags.json === true,
      });
      if (completed.detached) {
        return emitLocalDetach(`workbench.cli.eval-${evalCommand}.v1`, completed.snapshot, parsed, io);
      }
      const runs = [completed.run];
      const snapshot = completed.snapshot;
      const artifactIds = await artifactIdsByRunId(core, runs);
      const failedRuns = runs.filter((run) => run.status === "failed" || run.status === "canceled");
      const coverage = await evalCoverageSummaries(core, runs);
      const deltas = await evalDeltas(core, runs);
      if (failedRuns.length > 0) {
        return emitEvalFailure(evalCommand, snapshot, failedRuns, artifactIds, coverage, deltas, parsed, io);
      }
      const next = evalCommand === "run"
        ? operationTransitionNextCommand("grade", parsed, false)
        : await evalSuccessNextCommand(core, runs);
      return emitResult(`workbench.cli.eval-${evalCommand}.v1`, {
        run: runSnapshotResultJson(snapshot),
        coverage: coverage,
        deltas: deltas,
        next: next,
      }, parsed, io, () => [
        formatRunSnapshot(snapshot),
        ...formatEvalCoverageLines(coverage),
        ...formatEvalDeltaLines(deltas),
        ...formatCompletedJobReferenceLines(evalCommand, completed.jobs),
        ...formatRerunGuidanceLines(evalCommand, parsed.flags.rerun === true),
        ...(next ? [`next: ${next}`] : []),
      ].filter(Boolean).join("\n"));
    }
    if (command === "skill" && action === "improve") {
      rejectExtraInput(parsed, {
        maxPositionals: 2,
        message: "workbench skill improve does not accept a VERSION argument.",
        remediation: "workbench skill improve",
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
        return emitLocalDetach("workbench.cli.skill-improve.v1", completed.snapshot, parsed, io);
      }
      const improveResult = await localImproveResultFromRun(core, completed.run);
      const next = completed.run.status === "succeeded"
        ? improveResult.switched ? "workbench eval run --rerun -n 5" : "workbench eval run"
        : `workbench eval show ${completed.run.id}`;
      return emitImproveOutcome(parsed, io, completed.snapshot, improveResult, next);
    }
    if (command === "eval" && action === "results") {
      rejectExtraInput(parsed, {
        maxPositionals: 2,
        message: "workbench eval results does not accept refs or paths.",
        remediation: "workbench eval results --eval current",
      });
      const results = await resultsWorkbench({
        ...core,
        projectVersions: "all",
        resultVersions: stringFlag(parsed, "versions"),
        agents: stringFlag(parsed, "agents"),
        eval: stringFlag(parsed, "eval"),
      });
      const next = resultsNextCommand(results);
      return emitResult("workbench.cli.eval-results.v1", {
        result: resultsManifest(results),
        next: next,
      }, parsed, io, (format) => formatResults(results, format));
    }
    if (command === "eval" && action === "list") {
      rejectExtraInput(parsed, {
        maxPositionals: 2,
        message: "workbench eval list does not accept refs or paths.",
        remediation: "workbench eval list",
      });
      const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
      return emitResult("workbench.cli.eval-list.v1", {
        evalVersions: snapshot.evalVersions.map(evalVersionManifest),
      }, parsed, io, (format) => formatEvalVersions(snapshot.evalVersions, format));
    }
    if (command === "skill" && action === "switch") {
      const versionRef = requiredPositional(parsed, 2, "workbench skill switch requires VERSION.", "workbench skill switch VERSION");
      rejectExtraInput(parsed, {
        maxPositionals: 3,
        message: "workbench skill switch accepts one VERSION argument.",
        remediation: "workbench skill switch VERSION",
      });
      const result = await switchWorkbenchVersion(versionRef, {
        ...core,
        dryRun: parsed.flags["dry-run"] === true,
        overwrite: parsed.flags.yes === true,
      });
      const next = switchNextCommand(parsed, versionRef, result);
      return emitResult("workbench.cli.skill-switch.v1", {
        version: versionSummary(result.version),
        changes: result.changes,
        dryRun: result.dryRun,
        requiresOverwrite: result.requiresOverwrite,
        unchanged: result.unchanged,
        next: next,
      }, parsed, io, () => formatSwitchResult(result, next));
    }
    if (command === "skill" && action === "versions") {
      rejectExtraInput(parsed, {
        maxPositionals: 2,
        message: "workbench skill versions does not accept refs or paths.",
        remediation: "workbench skill versions",
      });
      const versions = await listWorkbenchVersions(core);
      return emitResult("workbench.cli.skill-versions.v1", {
        versions: versions.map(versionSummary),
      }, parsed, io, (format) => formatVersions(versions, format));
    }
    if (command === "skill" && action === "diff") {
      const range = optionalPositional(parsed, 2) ?? "current";
      const diffs = await diffWorkbenchVersions(range, core);
      return output(diffs, parsed, io, () => formatDiff(diffs));
    }
    if ((command === "skill" || command === "eval") && action === "show") {
      return await handleShow(parsed, io);
    }
    if (command === "watch") {
      return await handleRunWatch(parsed, io);
    }
    if (command === "cancel") {
      return await handleRunCancel(parsed, io);
    }
    if (command === "retry") {
      return await handleRunRetry(parsed, io);
    }
    if (command === "eval" && action === "agent") {
      return await handleAgent(parsed, io);
    }
    if (command === "skill" && action === "sync") {
      const beforeRuns = parsed.flags["dry-run"] === true
        ? undefined
        : await runEvidenceFingerprints(core).catch(() => undefined);
      if (parsed.flags["dry-run"] !== true) {
        writeCliProgress(parsed, io, `workbench skill sync: syncing ${optionalPositional(parsed, 2) ?? "default remote"}.`);
      }
      const syncDryRun = parsed.flags["dry-run"] === true;
      const result = await withProgressHeartbeat(
        io,
        syncDryRun ? "workbench skill sync: dry-run check" : "workbench skill sync: remote sync",
        async () => await syncWorkbenchRemote({
          ...core,
          remote: optionalPositional(parsed, 2),
          dryRun: syncDryRun,
        }),
        {
          hint: syncDryRun ? "No files have been written." : "Read commands remain available: workbench eval results.",
          json: parsed.flags.json === true,
        },
      );
      const next = result.dryRun
        ? syncChanged(result) ? `workbench skill sync ${result.remote.name}` : null
        : await syncNextCommand(core, beforeRuns);
      const dryRunNote = result.dryRun && syncChanged(result)
        ? "Dry-run checked the remote without updating local sync status; run the next command to reconcile."
        : undefined;
      return emitResult("workbench.cli.skill-sync.v1", {
        remote: result.remote,
        status: result.dryRun ? "dry_run" : "synced",
        pushed: result.pushed,
        pulled: result.pulled,
        changed: syncChanged(result),
        publication: result.publication,
        next: next,
        ...(result.dryRun ? { dryRun: true } : {}),
        ...(dryRunNote ? { note: dryRunNote } : {}),
      }, parsed, io, () => [
        `${result.dryRun ? "Would sync" : "Synced"} ${result.remote.name}: pushed ${result.pushed}, pulled ${result.pulled}${result.upToDate && !result.dryRun ? " (up to date)" : ""}.`,
        ...(dryRunNote ? [dryRunNote] : []),
        ...(next ? [`next: ${next}`] : []),
      ].join("\n"));
    }
    if (command === "skill" && action === "publish") {
      const visibility = parsePublishVisibilityFlags(parsed);
      const preview = parsed.flags["dry-run"] === true
        ? await previewPublishWithDerivedRemote(parsed, visibility)
        : undefined;
      if (preview) {
        const audience = publishAudience(preview.visibility);
        const next = publishNextCommand(parsed);
        const installCommand = `workbench skill install ${preview.installHandle}`;
        return emitResult("workbench.cli.skill-publish.v1", {
          remote: preview.remote,
          version: versionSummary(preview.version),
          visibility: audience,
          installHandle: preview.installHandle,
          dryRun: true,
          installCommand,
          next,
        }, parsed, io, () => [
          `Would publish ${displayRef(preview.version.id)} as ${preview.installHandle} (${audience}).`,
          "Dry run made no changes.",
          `after publish: ${installCommand}`,
          `next: ${next}`,
        ].join("\n"));
      }
      let remote: string | undefined;
      let result: Awaited<ReturnType<typeof publishWorkbenchVersion>>;
      try {
        remote = await ensurePublishRemote(parsed);
        await assertPublishCloudAuth(parsed, remote);
        writeCliProgress(parsed, io, "workbench skill publish: preparing Cloud skill.");
        writeCliProgress(parsed, io, `workbench skill publish: checking ${publishVersionInput(parsed) ?? "current"} source publication.`);
        result = await withProgressHeartbeat(io, "workbench skill publish: remote publication check", async () => await publishWorkbenchVersion({
          ...core,
          version: publishVersionInput(parsed),
          remote,
          dryRun: parsed.flags["dry-run"] === true,
          visibility,
        }), { json: parsed.flags.json === true });
      } catch (error) {
        throw await publishErrorWithCliContext(error, parsed, remote);
      }
      const audience = publishAudience(result.visibility);
      const installCommand = `workbench skill install ${result.installHandle}`;
      const next = result.dryRun ? publishNextCommand(parsed) : installCommand;
      return emitResult("workbench.cli.skill-publish.v1", {
        remote: result.remote,
        version: versionSummary(result.version),
        visibility: audience,
        installHandle: result.installHandle,
        installCommand,
        ...(result.unchanged ? { unchanged: true } : {}),
        ...(result.dryRun ? { dryRun: true } : {}),
        next,
      }, parsed, io, () => [
        `${result.dryRun ? "Would publish" : result.unchanged ? "Already published" : "Published"} ${displayRef(result.version.id)} as ${result.installHandle} (${audience}).`,
        ...(result.dryRun ? ["Dry run made no changes.", `after publish: ${installCommand}`] : []),
        `next: ${next}`,
      ].join("\n"));
    }
    if (command === "skill" && action === "unpublish") {
      const versionRef = requiredPositional(parsed, 2, "workbench skill unpublish requires VERSION.", "workbench skill unpublish VERSION");
      rejectExtraInput(parsed, {
        maxPositionals: 3,
        message: "workbench skill unpublish accepts one VERSION argument.",
        remediation: "workbench skill unpublish VERSION",
      });
      const dryRun = parsed.flags["dry-run"] === true;
      const remote = await ensurePublishRemote(parsed);
      await assertPublishCloudAuth(parsed, remote);
      writeCliProgress(parsed, io, `workbench skill unpublish: checking exact source availability for ${versionRef}.`);
      const result = await withProgressHeartbeat(io, dryRun ? "workbench skill unpublish: dry-run check" : "workbench skill unpublish: remote publication update", async () => await unpublishWorkbenchVersion({
        ...core,
        version: versionRef,
        remote,
        dryRun,
      }), { json: parsed.flags.json === true });
      const next = result.dryRun
        ? projectScopedNextCommand(core.dir ?? process.cwd(), `workbench skill unpublish ${result.version.id}`)
        : result.currentVersionId ? `workbench skill install ${result.installHandle ?? "OWNER/SKILL"}@${result.currentVersionId}` : null;
      return emitResult("workbench.cli.skill-unpublish.v1", {
        remote: result.remote,
        version: versionSummary(result.version),
        installHandle: result.installHandle ?? null,
        visibility: result.visibility ? publishAudience(result.visibility) : null,
        currentVersionId: result.currentVersionId ?? null,
        publishedVersionIds: result.publishedVersionIds,
        ...(result.dryRun ? { dryRun: true } : {}),
        next,
      }, parsed, io, () => [
        `${result.dryRun ? "Would unpublish" : "Unpublished"} ${displayRef(result.version.id)}${result.installHandle ? ` from ${result.installHandle}` : ""}.`,
        ...(result.dryRun ? ["Dry run made no changes."] : []),
        ...(result.currentVersionId ? [`Current published version: ${displayRef(result.currentVersionId)}.`] : []),
        ...(next ? [`next: ${next}`] : []),
      ].join("\n"));
    }
    if (command === "open") {
      // The browser server serves committed object state through a snapshot
      // path, so long-running commands do not block page loads.
      const server = await startWorkbenchOpenServer({
        dir: dirFlag(parsed),
        authToken: core.authToken,
        homeDir: process.env.HOME,
        host: stringFlag(parsed, "host"),
        port: portFlag(parsed, "port"),
      });
      const stopped = waitForOpenServerStop(server);
      io.stdout.write(`Workbench: ${server.url}\nServing Workbench UI. Press Ctrl-C to stop.\n`);
      if (parsed.flags["no-open"] !== true) {
        await Promise.race([
          openBrowser(server.url).catch(() => undefined),
          stopped,
        ]);
      }
      return await stopped;
    }
    throw new WorkbenchUserError(`Unknown command: ${command}\n\n${renderWorkbenchHelp()}`);
  } catch (error) {
    const exitCode = emitError(error, parsed, io);
    return exitCode;
  }
}

function normalizeCliArgv(argv: readonly string[]): readonly string[] {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

async function waitForOpenServerStop(server: { close(): Promise<void> }): Promise<number> {
  return await new Promise<number>((resolve) => {
    let closed = false;
    const stop = (code: number) => {
      if (closed) {
        return;
      }
      closed = true;
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      void server.close().finally(() => resolve(code));
    };
    const onSignal = () => stop(0);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}

function formatProjectSetupResult(
  status: WorkbenchStatus,
  next: string | null,
  heading: string,
): string {
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
    `${heading} ${status.root}.`,
    agent,
    ...(selection?.readiness.warnings ?? []),
    "Add eval cases under .workbench/cases before running eval.",
    ...newProjectSetupLines(selection),
    ...(next ? [`next: ${next}`] : []),
  ].filter(Boolean).join("\n");
}

function newProjectSetupLines(selection: WorkbenchStatus["defaultAgentSelection"]): string[] {
  if (!selection?.readiness.setupCommands.length) {
    return [];
  }
  return [
    ...(selection.kind === "provider" ? ["Provider setup is still required before provider-backed eval."] : []),
    ...setupCommandBlock(selection.readiness.setupCommands),
  ];
}

function setupCommandBlock(commands: readonly string[]): string[] {
  return commands.length > 0
    ? ["setup:", ...commands.map((command) => `  ${command}`)]
    : [];
}

function newProjectNextCommand(projectRoot: string): string {
  return projectScopedNextCommand(projectRoot, WORKBENCH_AUTHOR_EVAL_CASE_COMMAND);
}

function formatCloneResult(
  project: CloneProjectResult,
  snapshot: WorkbenchSkillPackageSnapshot,
  hydratedPaths: readonly string[],
  next: string | null,
): string {
  const version = project.currentVersionId ? `Current version: ${displayRef(project.currentVersionId)}.` : undefined;
  const agent = project.defaultAgent ? `Default agent: ${project.defaultAgent}.` : undefined;
  return [
    `Cloned Workbench Skill to ${project.root} from ${snapshot.owner}/${snapshot.name}.`,
    `Hydrated ${hydratedPaths.length} package ${hydratedPaths.length === 1 ? "file" : "files"} from ${snapshot.versionId}.`,
    "Initialized fresh local Workbench runtime state; the original project's runtime state was not copied.",
    version,
    agent,
    ...(next ? [`next: ${next}`] : []),
  ].filter(Boolean).join("\n");
}

interface CloneProjectResult {
  root: string;
  initialized: true;
  currentVersionId?: string;
  defaultAgent?: string;
  runtimeState: {
    initialized: "fresh";
    copiedFromPackage: false;
  };
}

async function handleEvalDryRun(parsed: ParsedArgs, io: CliIo, command: "run" | "grade"): Promise<number> {
  const preview = await previewWorkbenchEval({
    ...(await coreOptions(parsed)),
    skill: stringFlag(parsed, "versions"),
    agent: stringFlag(parsed, "agents"),
    caseIds: stringListFlag(parsed, "cases"),
    samples: intFlag(parsed, "samples"),
    kind: command,
    rerun: parsed.flags.rerun === true,
    cloud: parsed.flags.cloud === true,
  });
  const readiness = parsed.flags.cloud === true
    ? await cloudDryRunReadiness(command, parsed, preview)
    : preview.readiness;
  const plan = withPreviewReadiness(preview, readiness);
  const next = readiness.ready
    ? operationNextCommand(command, parsed, parsed.flags.cloud === true)
    : readinessNextCommand(command, readiness);
  return emitResult(`workbench.cli.eval-${command}-plan.v1`, {
    dryRun: true,
    plan: plan,
    readiness: readiness,
    next: next,
  }, parsed, io, () => [
    `Would run ${command} ${plan.location}: version=${displayRef(plan.versionId)} eval=${plan.evalHash}`,
    `versions=${plan.skills.map((skill) => skill.name).join(",")} agents=${plan.agents.map((agent) => agent.name).join(",")}`,
    `cases=${plan.cases} samples=${plan.samples} cached=${previewCachedCount(plan)}`,
    ...formatLaunchReadinessLines(readiness),
    "No files or Workbench state were written.",
    ...(next ? [`next: ${next}`] : []),
  ].join("\n"));
}

function previewCachedCount(plan: WorkbenchEvalPreview): number {
  return plan.cachedJobIds.length > 0 ? plan.cachedJobIds.length : plan.cachedRunIds.length;
}

function evalOperationRequest(
  parsed: ParsedArgs,
  variant: "local" | "cloud" = "local",
  kind: "run" | "grade" | "eval" = "eval",
): WorkbenchOperationRequest {
  const skill = stringFlag(parsed, "versions");
  const agent = stringFlag(parsed, "agents");
  const caseIds = stringListFlag(parsed, "cases") ?? [];
  const steps = kind === "run"
    ? ["run"] as const
    : kind === "grade"
      ? ["grade"] as const
      : ["run", "grade"] as const;
  return {
    kind: "eval",
    variant,
    caseIds,
    targets: [{
      ...(skill ? { skill } : {}),
      ...(agent ? { agent } : {}),
    }],
    steps,
    ...(intFlag(parsed, "samples") ? { samples: intFlag(parsed, "samples") } : {}),
    ...(parsed.flags.rerun === true ? { rerun: true } : {}),
  };
}

async function assertLocalEvalLaunchReadiness(
  core: CliCoreOptions,
  request: WorkbenchOperationRequest,
): Promise<void> {
  if (request.kind !== "eval") {
    return;
  }
  const skill = request.targets.flatMap((target) => target.skill ? [target.skill] : []).join(",") || undefined;
  const agent = request.targets.flatMap((target) => target.agent ? [target.agent] : []).join(",") || undefined;
  const preview = await previewWorkbenchEval({
    ...core,
    skill,
    agent,
    caseIds: request.caseIds,
    samples: request.samples,
    kind: request.steps.includes("grade") && !request.steps.includes("run")
      ? "grade"
      : request.steps.includes("grade")
        ? "eval"
        : "run",
    rerun: request.rerun,
    cloud: false,
  });
  assertWorkbenchLaunchReadinessReady(preview.readiness);
}

function improveOperationRequest(parsed: ParsedArgs, variant: "local" | "cloud" = "local"): WorkbenchOperationRequest {
  const skill = stringFlag(parsed, "versions");
  const agent = stringFlag(parsed, "agents");
  return {
    kind: "improve",
    variant,
    ...(skill || agent ? {
      target: {
        ...(skill ? { skill } : {}),
        ...(agent ? { agent } : {}),
      },
    } : {}),
    ...(intFlag(parsed, "samples") ? { samples: intFlag(parsed, "samples") } : {}),
    ...(intFlag(parsed, "budget") ? { budget: intFlag(parsed, "budget") } : {}),
  };
}

async function localRunStateForSnapshot(
  core: { dir?: string; authToken?: string },
  snapshot: WorkbenchRunSnapshot,
): Promise<{ run: WorkbenchRun; jobs: WorkbenchJob[]; traces: WorkbenchTrace[] }> {
  const inspection = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const run = inspection.runs.find((entry) => entry.id === snapshot.id);
  if (!run) {
    throw new WorkbenchCodedError("run_not_found", `Run not found: ${snapshot.id}`, {
      remediation: "workbench skill sync cloud",
      subject: { runId: snapshot.id },
      exitCode: 1,
    });
  }
  return { run, jobs: jobsForRuns(inspection, [run.id]), traces: inspection.traces };
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
  const suppressAlreadyTerminalJsonProgress =
    input.json === true && isWorkbenchRunStatusTerminal(input.initialSnapshot.status);
  let detached = false;
  const onSigint = (): void => {
    detached = true;
    input.io.stderr.write(`${workbenchOperationInvocation(input.command)}: detaching from local run (${displayRef(input.initialSnapshot.id)}).\n`);
  };
  process.once("SIGINT", onSigint);
  try {
    while (true) {
      const inspection = await createWorkbenchReadOnlyInspectionSnapshot(input.core);
      const run = inspection.runs.find((entry) => entry.id === input.initialSnapshot.id);
      if (!run) {
        throw new WorkbenchCodedError("run_not_found", `Run not found: ${input.initialSnapshot.id}`, {
          remediation: "workbench eval results",
          subject: { runId: input.initialSnapshot.id },
          exitCode: 1,
        });
      }
      const jobs = jobsForRuns(inspection, [run.id]);
      const baseRunSnapshot = createWorkbenchRunSnapshotForRun(run, jobs, { traces: inspection.traces });
      const terminal = isWorkbenchRunStatusTerminal(run.status);
      const progressNext = terminal && input.command === "eval" && run.status === "succeeded"
        ? await evalSuccessNextCommand(input.core, [run])
        : showRunNextCommand(run);
      const progressSnapshot = runProgressSnapshotForInspection({
        command: input.command,
        location: "local",
        phase: localProgressPhaseForRun(run, jobs, terminal),
        runs: [run],
        snapshot: inspection,
        startedAtMs,
        next: progressNext ?? undefined,
      });
      if (!(suppressAlreadyTerminalJsonProgress && terminal)) {
        renderer.render(progressSnapshot, { force: terminal || detached, command: input.command });
      }
      const runSnapshot = progressSnapshot ?? baseRunSnapshot;
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
          remediation: `workbench watch ${run.id}`,
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

function localProgressPhaseForRun(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
  terminal: boolean,
): WorkbenchProgressPhase {
  if (terminal) {
    return "complete";
  }
  if (run.status === "canceling") {
    return "canceling";
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
  const next = `workbench watch ${snapshot.id}`;
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

function runSnapshotResultJson(snapshot: WorkbenchRunSnapshot): Omit<WorkbenchRunSnapshot, "next"> {
  const { next: _next, ...result } = snapshot;
  return result;
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
    ...(typeof snapshot.result?.score === "number" ? { outputScore: snapshot.result.score } : {}),
    next: next,
  };
  if (parsed.flags.json === true) {
    const message = snapshot.result?.error ?? result.promotionReason ?? "Improve run failed; evidence was saved.";
    const remediation = adapterAuthRemediationFromError(message);
    io.stdout.write(`${JSON.stringify({
      schema: "workbench.cli.skill-improve.v1",
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
      skill: stringFlag(parsed, "versions"),
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
    ? operationNextCommand("improve", parsed, parsed.flags.cloud === true)
    : readinessNextCommand("improve", readiness);
  return emitResult("workbench.cli.skill-improve-plan.v1", {
    dryRun: true,
    plan: plan,
    readiness: readiness,
    next: next,
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

function readinessNextCommand(
  command: "run" | "grade" | "eval" | "improve",
  readiness: WorkbenchLaunchReadiness,
): string | null {
  for (const issue of readinessIssuesForNext(readiness.issues)) {
    if (issue.code === "plan_required" && issue.remediation) {
      return issue.remediation;
    }
    const setupCommand = readinessIssueSetupCommands(issue)[0];
    if (setupCommand) {
      return setupCommand;
    }
    for (const chunk of commandChainParts(issue.remediation)) {
      if (isWorkbenchOperationCommand(chunk, command)) {
        continue;
      }
      if (chunk) {
        return chunk;
      }
    }
  }
  return readiness.issues.find((issue) => issue.remediation)?.remediation ?? null;
}

function readinessIssuesForNext(
  issues: readonly WorkbenchLaunchReadinessIssue[],
): WorkbenchLaunchReadinessIssue[] {
  return [...issues].sort((left, right) =>
    readinessIssueNextPriority(left) - readinessIssueNextPriority(right)
  );
}

function readinessIssueNextPriority(issue: WorkbenchLaunchReadinessIssue): number {
  if (issue.code === "no_eval_cases" || issue.code === "draft_case_prompt" || issue.code === "draft_case_grade") {
    return 0;
  }
  if (issue.code === "adapter_auth_required" || issue.code === "provider_oauth_missing") {
    return 1;
  }
  if (issue.code === "auth_required") {
    return 2;
  }
  if (issue.code === "plan_required") {
    return 3;
  }
  return 4;
}

function commandChainParts(command: string | undefined): string[] {
  return command?.split(/\s+&&\s+/u).map((part) => part.trim()).filter(Boolean) ?? [];
}

function readinessIssueSetupCommands(issue: WorkbenchLaunchReadinessIssue): string[] {
  const subject = issue.subject && typeof issue.subject === "object" && !Array.isArray(issue.subject)
    ? issue.subject as Record<string, Json>
    : {};
  const commands = subject.setupCommands;
  return Array.isArray(commands) ? commands.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

function isWorkbenchOperationCommand(value: string, command: "run" | "grade" | "eval" | "improve"): boolean {
  const invocation = workbenchOperationInvocation(command);
  return value === invocation || value.startsWith(`${invocation} `);
}

function operationNextCommand(command: "run" | "grade" | "eval" | "improve", parsed: ParsedArgs, cloud: boolean): string {
  return workbenchOperationCliEquivalent(operationRequestFromParsed(command, parsed, cloud));
}

function operationTransitionNextCommand(command: "grade" | "eval", parsed: ParsedArgs, cloud: boolean): string {
  const request = operationRequestFromParsed(command, parsed, cloud);
  if (request.kind !== "eval") {
    return workbenchOperationCliEquivalent(request);
  }
  const steps = command === "grade" ? ["grade"] as const : ["run", "grade"] as const;
  return workbenchOperationCliEquivalent({
    kind: "eval",
    variant: request.variant,
    caseIds: request.caseIds,
    targets: request.targets,
    steps,
    ...(request.samples !== undefined ? { samples: request.samples } : {}),
  });
}

function operationRequestFromParsed(
  command: "run" | "grade" | "eval" | "improve",
  parsed: ParsedArgs,
  cloud: boolean,
): WorkbenchOperationRequest {
  const variant = cloud ? "cloud" : "local";
  return command === "improve"
    ? improveOperationRequest(parsed, variant)
    : evalOperationRequest(parsed, variant, command);
}

function formatLaunchReadinessLines(readiness: WorkbenchLaunchReadiness): string[] {
  if (readiness.ready) {
    return ["readiness=ready"];
  }
  const lines = ["readiness=blocked"];
  for (const issue of readiness.issues) {
    lines.push(`blocked: ${issue.message}`);
    const setupCommands = readinessIssueSetupCommands(issue);
    if (setupCommands.length > 0) {
      lines.push(...setupCommands.map((command) => `setup: ${command}`));
    } else if (issue.remediation) {
      lines.push(`setup: ${issue.remediation}`);
    }
  }
  return lines;
}

async function handleSource(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const action = requiredPositional(parsed, 1, "workbench source requires a command.");
  if (action === "add") {
    const name = requiredPositional(parsed, 2, "workbench source add requires NAME.");
    const adapterId = stringFlag(parsed, "adapter");
    const producerIds = builtinWorkbenchSourceProducers().map((producer) => producer.id).sort();
    if (!adapterId || !producerIds.includes(adapterId)) throw new WorkbenchUserError(`--adapter must name an installed Source producer (${producerIds.join(", ")}).`);
    rejectExtraInput(parsed, { maxPositionals: 3, message: "source add accepts one name.", remediation: "workbench source add NAME --adapter ID" });
    const namespace = stringFlag(parsed, "namespace");
    const config = await loadConfig();
    const baseUrl = selectWorkbenchBaseUrl({ configBaseUrl: config.baseUrl });
    const body: WorkbenchSourceCreateRequest = { schema: "workbench.source.create.v1", name };
    const result = await apiRequest<WorkbenchSourceDetailResponse>(`/api/workbench/sources${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`, { method: "POST", body }, baseUrl);
    try {
      await bindLocalWorkbenchSource({ source: result.source.source, baseUrl, ...(namespace ? { namespace } : {}), adapterId, homeDir: localSourceHomeDir() });
    } catch (error) {
      await apiRequest(
        `/api/workbench/sources/${encodeURIComponent(result.source.source.id)}${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`,
        { method: "DELETE" },
        baseUrl,
      ).catch(() => undefined);
      throw error;
    }
    const next = `workbench source sync ${result.source.source.id}`;
    return emitResult("workbench.cli.source-add.v1", { source: result.source, next }, parsed, io, () => `Added Source ${result.source.source.name} (${result.source.source.id}).\nnext: ${next}`);
  }
  if (action === "list") {
    rejectExtraInput(parsed, { maxPositionals: 2, message: "source list accepts no arguments.", remediation: "workbench source list" });
    const query = new URLSearchParams();
    for (const key of ["namespace", "cursor", "limit"] as const) {
      const value = key === "limit" ? intFlag(parsed, key)?.toString() : stringFlag(parsed, key);
      if (value) query.set(key, value);
    }
    const result = await apiRequest<WorkbenchSourceListResponse>(`/api/workbench/sources${query.size ? `?${query}` : ""}`);
    const next = result.sources.nextCursor ? `workbench source list --cursor ${quoteShellArg(result.sources.nextCursor)}${stringFlag(parsed, "namespace") ? ` --namespace ${quoteShellArg(stringFlag(parsed, "namespace")!)}` : ""}` : null;
    return emitResult("workbench.cli.source-list.v1", { ...result, next }, parsed, io, () => [
      ...result.sources.items.map(({ source, recordCount, latestAnalysis }) => `${source.id}\t${source.name}\trecords=${recordCount}\tanalysis=${latestAnalysis ? "ready" : "none"}`),
      ...(next ? [`next: ${next}`] : []),
    ].join("\n") || "No Sources.");
  }
  if (action === "show") {
    const sourceId = requiredPositional(parsed, 2, "workbench source show requires SOURCE_ID.");
    rejectExtraInput(parsed, { maxPositionals: 3, message: "source show accepts one Source id.", remediation: "workbench source show SOURCE_ID" });
    const target = await sourceCommandTarget(sourceId, parsed);
    const analysisId = stringFlag(parsed, "analysis");
    const cursor = stringFlag(parsed, "cursor");
    const limit = intFlag(parsed, "limit") ?? 50;
    const requestedPage = stringFlag(parsed, "page");
    const selectors = ([
      ["node", "nodeId", "nodes"], ["insight", "insightId", "insights"], ["workflow", "workflowId", "occurrences"],
    ] as const).flatMap(([flag, query, page]) => { const value = stringFlag(parsed, flag); return value ? [{ flag, query, page, value }] : []; });
    if (selectors.length > 1) throw new WorkbenchUserError("--node, --insight, and --workflow are mutually exclusive.");
    const selector = selectors[0], decision = stringFlag(parsed, "decision");
    if (!analysisId && (selector || decision)) throw new WorkbenchUserError("--node, --insight, --workflow, and --decision require --analysis.");
    if (analysisId) {
      const page = requestedPage ?? selector?.page ?? (decision ? "review" : "nodes");
      if (page !== "nodes" && page !== "occurrences" && page !== "insights" && page !== "review") throw new WorkbenchUserError("--page with --analysis must be nodes, occurrences, insights, or review.");
      if (selector && page !== selector.page) throw new WorkbenchUserError(`--${selector.flag} requires --page ${selector.page}.`);
      if (decision && page !== "review") throw new WorkbenchUserError("--decision requires --page review.");
      if (page === "review" && decision && decision !== "kept" && decision !== "dismissed") throw new WorkbenchUserError("--decision must be kept or dismissed.");
      if (selector?.flag === "workflow") {
        const workflowId = selector.value;
        const query = new URLSearchParams({ workflowId, limit: String(limit), ...(cursor ? { cursor } : {}) });
        const result = await targetApiRequest<WorkbenchSourceOccurrenceLookupResponse>(target, `/api/workbench/sources/analyses/${encodeURIComponent(analysisId)}/occurrences?${query}`);
        if (result.analysis.sourceId !== sourceId) throw new WorkbenchUserError(`Analysis ${analysisId} does not belong to Source ${sourceId}.`);
        const next = result.occurrences.nextCursor ? `workbench source show ${sourceId} --analysis ${analysisId} --workflow ${quoteShellArg(workflowId)} --cursor ${quoteShellArg(result.occurrences.nextCursor)} --limit ${limit}${sourceNamespaceFlag(target)}` : null;
        return emitResult("workbench.cli.source-occurrences.v1", { ...result, next }, parsed, io, () => [`Analysis ${analysisId}: workflow=${workflowId} occurrences=${result.analysis.occurrenceCount}.`, ...result.occurrences.items.map(formatSourceOccurrence), ...(next ? [`next: ${next}`] : [])].join("\n"));
      }
      const view = page === "insights" ? "insights" : page === "review" ? "review" : "workflows";
      const query = new URLSearchParams({ view, page, limit: String(limit) });
      if (page === "review") query.set("decision", decision ?? "kept");
      if (selector) query.set(selector.query, selector.value);
      if (cursor) query.set("cursor", cursor);
      const result = await targetApiRequest<WorkbenchSourceAnalysisViewResponse>(target, `/api/workbench/sources/analyses/${encodeURIComponent(analysisId)}?${query}`);
      if (result.analysis.sourceId !== sourceId) throw new WorkbenchUserError(`Analysis ${analysisId} does not belong to Source ${sourceId}.`);
      const nextCursor = result.view === "workflows" ? (page === "nodes" ? result.tree.children.nextCursor : result.occurrences.nextCursor) : result.view === "insights" ? result.insights.nextCursor : result.reviewItems.nextCursor;
      const selectorFlag = selector ? ` --${selector.flag} ${quoteShellArg(selector.value)}` : "";
      const next = nextCursor
        ? `workbench source show ${sourceId} --analysis ${analysisId} --page ${page}${selectorFlag}${page === "review" ? ` --decision ${decision ?? "kept"}` : ""} --cursor ${quoteShellArg(nextCursor)} --limit ${limit}${sourceNamespaceFlag(target)}`
        : null;
      return emitResult("workbench.cli.source-analysis.v1", { ...result, next }, parsed, io, () => [
        `Analysis ${analysisId}: workflows=${result.analysis.workflowCount} insights=${result.analysis.insightCount} occurrences=${result.analysis.occurrenceCount}.`,
        ...(result.view === "workflows" ? [
          ...(selector?.flag === "node" ? [formatSourceWorkflowNode(result.tree.node)] : []),
          ...result.tree.children.items.map(formatSourceWorkflowNode),
          ...result.occurrences.items.map(formatSourceOccurrence),
        ] : result.view === "insights"
          ? result.insights.items.map((item) => `insight\t${item.id}\t${item.statement}\tworkflows=${item.workflowCount}\tsupporting=${item.representativeSupportingCitationIds.join(",") || "none"}\tcontradicting=${item.representativeContradictingCitationIds.join(",") || "none"}`)
          : result.reviewItems.items.map((item) => `review\t${item.workflowId}\t${result.workflows.find((workflow) => workflow.id === item.workflowId)?.name ?? "unknown workflow"}\t${item.decision}`)),
        ...(next ? [`next: ${next}`] : []),
      ].join("\n"));
    }
    const page = requestedPage ?? "analyses";
    if (page !== "analyses" && page !== "records") throw new WorkbenchUserError("--page must be analyses or records.");
    const query = new URLSearchParams({ page, limit: String(limit) });
    if (cursor) query.set("cursor", cursor);
    const result = await targetApiRequest<WorkbenchSourceDetailResponse>(target, `/api/workbench/sources/${encodeURIComponent(sourceId)}?${query}`);
    const nextCursor = (page === "records" ? result.records : result.analyses).nextCursor;
    const next = nextCursor ? `workbench source show ${sourceId} --page ${page} --cursor ${quoteShellArg(nextCursor)} --limit ${limit}${sourceNamespaceFlag(target)}` : null;
    return emitResult("workbench.cli.source-show.v1", { ...result, next }, parsed, io, () => [
      `${result.source.source.name} (${sourceId}) records=${result.source.recordCount}.`,
      ...(page === "records"
        ? result.records.items.map((record) => `record\t${record.id}\t${record.label ?? ""}\tsegments=${record.segmentCount}\tbytes=${record.textBytes}`)
        : result.analyses.items.map((analysis) => `analysis\t${analysis.id}\trecords=${analysis.coverage.recordOffset + 1}-${analysis.coverage.recordOffset + analysis.coverage.selectedRecords}\tworkflows=${analysis.workflowCount}\tinsights=${analysis.insightCount}`)),
      ...(next ? [`next: ${next}`] : []),
    ].join("\n"));
  }
  if (action === "evidence") {
    const sourceId = requiredPositional(parsed, 2, "workbench source evidence requires SOURCE_ID, ANALYSIS_ID, and CITATION_ID.");
    const analysisId = requiredPositional(parsed, 3, "workbench source evidence requires ANALYSIS_ID and CITATION_ID.");
    const citationId = requiredPositional(parsed, 4, "workbench source evidence requires CITATION_ID.");
    rejectExtraInput(parsed, { maxPositionals: 5, message: "source evidence accepts one Source, Analysis, and citation id.", remediation: "workbench source evidence SOURCE_ID ANALYSIS_ID CITATION_ID" });
    const target = await sourceCommandTarget(sourceId, parsed);
    await requireSourceAnalysis(target, analysisId);
    const result = await targetApiRequest<WorkbenchSourceEvidenceResponse>(target, `/api/workbench/sources/analyses/${encodeURIComponent(analysisId)}/evidence/${encodeURIComponent(citationId)}`);
    return emitResult("workbench.cli.source-evidence.v1", { ...result }, parsed, io, () => [`Citation ${result.evidence.citation.id}: record=${result.evidence.citation.recordId} segment=${result.evidence.citation.segmentId} offsets=${result.evidence.citation.start}-${result.evidence.citation.end}.`, "", "Exact quote:", result.evidence.quote].join("\n"));
  }
  if (action === "sync") {
    const sourceId = requiredPositional(parsed, 2, "workbench source sync requires SOURCE_ID.");
    rejectExtraInput(parsed, { maxPositionals: 3, message: "source sync accepts one Source id.", remediation: "workbench source sync SOURCE_ID" });
    const startedAt = Date.now();
    let lastProgressAt = 0;
    let lastPhase = "";
    const result = await syncLocalWorkbenchSource({ sourceId, homeDir: localSourceHomeDir(), env: process.env, producers: builtinWorkbenchSourceProducers(), request: apiRequest, onProgress(progress) {
      const now = Date.now();
      if (progress.phase === lastPhase && now - lastProgressAt < 15_000) return;
      lastPhase = progress.phase; lastProgressAt = now;
      io.stderr.write(parsed.flags.json === true
        ? `${JSON.stringify({ schema: "workbench.cli.source-sync-progress.v1", sourceId, ...progress, elapsedMs: now - startedAt })}\n`
        : `workbench source sync: ${progress.phase}, records=${progress.records.toLocaleString()}, events=${progress.events.toLocaleString()}, evidence pages=${progress.uploadedPages.toLocaleString()} changed.\n`);
    } });
    const next = `workbench source show ${sourceId}${result.namespace ? ` --namespace ${quoteShellArg(result.namespace)}` : ""}`;
    return emitResult("workbench.cli.source-sync.v1", { ...result, next }, parsed, io, () => `Synced ${result.records} records to ${result.snapshot.id}; changed pages=${result.uploadedPages}, omitted=${result.coverage.omittedItems}.\nnext: ${next}`);
  }
  if (action === "analyze") {
    const sourceId = requiredPositional(parsed, 2, "workbench source analyze requires SOURCE_ID.");
    rejectExtraInput(parsed, { maxPositionals: 3, message: "source analyze accepts one Source id.", remediation: "workbench source analyze SOURCE_ID" });
    const snapshotId = stringFlag(parsed, "snapshot");
    const recordLimit = intFlag(parsed, "record-limit");
    const allRecords = parsed.flags["all-records"] === true;
    if (Boolean(recordLimit) === allRecords) throw new WorkbenchUserError("source analyze requires exactly one of --record-limit N or --all-records.");
    const recordOffset = intFlag(parsed, "record-offset", 0) ?? 0;
    if (recordOffset < 0 || (allRecords && recordOffset !== 0)) throw new WorkbenchUserError("--record-offset must be nonnegative and is available only with --record-limit.");
    const map = parsed.flags.map === true ? "include" : "omit";
    const selection: WorkbenchSourceAnalyzeRequest["selection"] = allRecords
      ? { kind: "all" }
      : { kind: "window", recordOffset, recordLimit: recordLimit! };
    const request: WorkbenchSourceAnalyzeRequest = { schema: "workbench.source.analyze-request.v1", ...(snapshotId ? { snapshotId } : {}), selection, map };
    const target = await sourceCommandTarget(sourceId, parsed);
    return await modelCommand(parsed, io, target, `/api/workbench/sources/${encodeURIComponent(sourceId)}/analyses`, "POST", request, "workbench.cli.source-analyze.v1", "source.analyze");
  }
  if (action === "review") {
    const sourceId = requiredPositional(parsed, 2, "workbench source review requires SOURCE_ID and ANALYSIS_ID.");
    const analysisId = requiredPositional(parsed, 3, "workbench source review requires ANALYSIS_ID.");
    rejectExtraInput(parsed, { maxPositionals: 4, message: "source review accepts one Source and Analysis id.", remediation: "workbench source review SOURCE_ID ANALYSIS_ID --input PATH|-" });
    const input = stringFlag(parsed, "input");
    if (!input) throw new WorkbenchUserError("source review requires --input PATH|-.");
    const patch = parseWorkbenchSourceReviewPatch(JSON.parse(await readCommandInput(input, io.stdin ?? process.stdin)) as unknown);
    const target = await sourceCommandTarget(sourceId, parsed);
    await requireSourceAnalysis(target, analysisId);
    const result = await targetApiRequest<{ review: WorkbenchSourceAnalysisReview }>(target, `/api/workbench/sources/analyses/${encodeURIComponent(analysisId)}/review`, { method: "PATCH", body: patch });
    return emitResult("workbench.cli.source-review.v1", result, parsed, io, () => `Updated review for ${analysisId}.`);
  }
  if (action === "delete") {
    const sourceId = requiredPositional(parsed, 2, "workbench source delete requires SOURCE_ID.");
    if (parsed.flags.yes !== true) throw new WorkbenchUserError("source delete requires --yes.");
    const target = await sourceCommandTarget(sourceId, parsed);
    try {
      await targetApiRequest(target, `/api/workbench/sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
    } catch (error) {
      if (!isRemoteNotFound(error)) throw error;
    }
    await removeLocalWorkbenchSourceBinding(sourceId, localSourceHomeDir());
    return emitResult("workbench.cli.source-delete.v1", { sourceId, deleted: true }, parsed, io, () => `Deleted Source ${sourceId}.`);
  }
  throw new WorkbenchUserError(`Unknown Source command: ${action}.`);
}

async function handleEvalDraft(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const sourceId = requiredFlag(parsed, "source");
  const analysisId = requiredFlag(parsed, "analysis");
  const reviewVersion = intFlag(parsed, "review-version");
  if (!reviewVersion) throw new WorkbenchUserError("eval draft requires --review-version N.");
  const workflowIds = requiredListFlag(parsed, "workflows");
  const objective = requiredFlag(parsed, "objective");
  const destinationInput = requiredFlag(parsed, "destination");
  const target = await sourceCommandTarget(sourceId, parsed);
  const analysis = await requireSourceAnalysis(target, analysisId);
  let destination: WorkbenchEvalDraftRequest["destination"];
  let baseFiles: SurfaceSnapshotFile[] | undefined;
  if (destinationInput === "local") {
    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(await coreOptions(parsed));
    baseFiles = canonicalEvalFiles(currentWorkbenchEvalSnapshot(snapshot)?.files ?? []);
    const skillName = currentWorkbenchSkillName(snapshot);
    if (!skillName) throw new WorkbenchUserError("The current SKILL.md must declare a name before drafting a local Eval.");
    destination = { kind: "local", skillName };
  } else {
    const [owner, skill, evalId, extra] = destinationInput.split("/");
    if (!owner || !skill || extra) throw new WorkbenchUserError("--destination must be local or OWNER/SKILL[/EVAL].");
    destination = { kind: "hosted", owner, skill, ...(evalId ? { evalId } : {}) };
  }
  const request: WorkbenchEvalDraftRequest = {
    schema: "workbench.eval-draft.request.v1", sourceId, snapshotId: analysis.analysis.snapshotId, analysisId, reviewVersion,
    reviewHash: requiredFlag(parsed, "review-hash"), workflowIds, objective, destination, ...(baseFiles ? { baseFiles } : {}),
  };
  return await modelCommand(parsed, io, target, "/api/workbench/eval-drafts", "POST", request, "workbench.cli.eval-draft.v1", "eval.draft");
}

async function handleEvalApply(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const draftId = requiredPositional(parsed, 2, "workbench eval apply requires DRAFT_ID.");
  if (parsed.flags.yes !== true) throw new WorkbenchUserError("eval apply requires --yes.");
  const resolved = await remoteCommandTarget("eval-draft", draftId), target = resolved.target;
  const route = `/api/workbench/eval-drafts/${encodeURIComponent(draftId)}`;
  const response = await targetApiRequest<{ draft: unknown }>(target, route);
  const draft = parseWorkbenchEvalDraft(response.draft);
  if (draft.id !== draftId) throw new Error(`Eval draft ${draftId} returned another draft.`);
  if (!resolved.bound) await pinRemoteObject("eval-draft", draftId, target);
  if (draft.status === "discarded") throw new WorkbenchUserError(`Eval draft ${draft.id} was discarded and cannot be applied.`);
  let resultHash: string | undefined;
  let alreadyApplied = draft.status === "applied";
  if (draft.destination.kind === "local") {
    const options = await coreOptions(parsed);
    await recoverEvalApplyTransactionsForProject(path.resolve(options.dir ?? process.cwd()));
    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(options);
    const skillName = currentWorkbenchSkillName(snapshot);
    if (!skillName || draft.destination.skillName !== skillName) {
      throw new WorkbenchUserError(`Eval draft ${draft.id} targets Skill ${draft.destination.skillName}, not this checkout${skillName ? ` (${skillName})` : ""}.`);
    }
    const before = canonicalEvalFiles(currentWorkbenchEvalSnapshot(snapshot)?.files ?? []);
    const result = applyWorkbenchEvalPatch({ baseFiles: before, baseHash: draft.baseHash, expectedResultHash: draft.expectedResultHash, patch: draft.patch });
    resultHash = result.resultHash;
    alreadyApplied ||= result.alreadyApplied;
    if (!result.alreadyApplied) {
      createWorkbenchEvalSnapshotFromEvalFiles(result.files);
      await writeEvalFiles(snapshot.root, result.files);
    }
  }
  const body: WorkbenchEvalDraftApplyRequest = { schema: "workbench.eval-draft.apply.v1", expectedBaseHash: draft.baseHash, ...(resultHash ? { resultHash } : {}) };
  const applied = await targetApiRequest<{ draft: unknown }>(target, `${route}/apply`, { method: "POST", body });
  const appliedDraft = parseWorkbenchEvalDraft(applied.draft);
  if (appliedDraft.id !== draftId) throw new Error(`Eval draft ${draftId} returned another draft.`);
  return emitResult("workbench.cli.eval-apply.v1", { draft: appliedDraft, alreadyApplied }, parsed, io, () => `${alreadyApplied ? "Already applied" : "Applied"} Eval draft ${draftId}. The Eval was not run.`);
}

async function handleEvalDiscard(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const draftId = requiredPositional(parsed, 2, "workbench eval discard requires DRAFT_ID.");
  if (parsed.flags.yes !== true) throw new WorkbenchUserError("eval discard requires --yes.");
  const resolved = await remoteCommandTarget("eval-draft", draftId), target = resolved.target;
  const route = `/api/workbench/eval-drafts/${encodeURIComponent(draftId)}`;
  const existing = parseWorkbenchEvalDraft((await targetApiRequest<{ draft: unknown }>(target, route)).draft);
  if (existing.id !== draftId) throw new Error(`Eval draft ${draftId} returned another draft.`);
  if (!resolved.bound) await pinRemoteObject("eval-draft", draftId, target);
  const response = await targetApiRequest<{ draft: unknown }>(target, route, { method: "DELETE" });
  const draft = parseWorkbenchEvalDraft(response.draft);
  if (draft.id !== draftId) throw new Error(`Eval draft ${draftId} returned another draft.`);
  return emitResult("workbench.cli.eval-discard.v1", { draft }, parsed, io, () => `Discarded Eval draft ${draftId}. Its immutable proposal remains inspectable.`);
}

async function modelCommand<T extends object>(parsed: ParsedArgs, io: CliIo, target: SourceCommandTarget, route: string, method: "POST" | "PATCH", request: T, schema: string, kind: WorkbenchOperation["kind"]): Promise<number> {
  const authorization = modelAuthorizationFromFlags(parsed);
  const first = await targetApiRequest<{ preflight?: WorkbenchModelPreflight; operation?: WorkbenchOperation }>(target, route, {
    method,
    body: { ...request, ...(authorization ? { authorization } : {}) },
  });
  return await finishModelCommand(parsed, io, target, schema, kind, first);
}

async function finishModelCommand(parsed: ParsedArgs, io: CliIo, target: SourceCommandTarget, schema: string, kind: WorkbenchOperation["kind"], first: { preflight?: WorkbenchModelPreflight; operation?: WorkbenchOperation }): Promise<number> {
  if (first.operation) return operationResult(assertSourceOperation(target, parseWorkbenchOperation(first.operation), kind), target, schema, parsed, io);
  const preflight = first.preflight;
  if (!preflight) throw new Error("Operation returned neither preflight nor operation.");
  if (preflight.kind === "source.analyze" && (preflight.map !== "include" && preflight.map !== "omit")) {
    throw new Error("Source analysis preflight did not disclose the Map choice.");
  }
  return emitResult(`${schema}-preflight`, { preflight, next: null }, parsed, io, () => formatCliPreflight(preflight));
}

function modelAuthorizationFromFlags(parsed: ParsedArgs): WorkbenchModelAuthorization | undefined {
  const token = stringFlag(parsed, "preflight-token");
  if (token === undefined) {
    if (parsed.flags.confirm === true || stringFlag(parsed, "max-cost") !== undefined) {
      throw new WorkbenchUserError("--confirm and --max-cost require the short-lived token returned by a preflight.");
    }
    return undefined;
  }
  if (!token || parsed.flags.confirm !== true) {
    throw new WorkbenchUserError("Confirmation requires --confirm, --max-cost, and --preflight-token from one reviewed preflight.");
  }
  const callerCeiling = Number(stringFlag(parsed, "max-cost"));
  if (!Number.isFinite(callerCeiling) || callerCeiling < 0) throw new WorkbenchUserError("--max-cost must be a nonnegative number.");
  return { token, maximumCostUsd: callerCeiling };
}

function formatCliPreflight(preflight: WorkbenchModelPreflight): string {
  return [
    `${modelOperationLabel(preflight.kind)}: ${preflight.scope.description}; model=${preflight.model}${preflight.revision ? `@${preflight.revision}` : ""}; locality=${preflight.locality}; egress=${preflight.egress} (${preflight.egressDescription})${preflight.kind === "source.analyze" ? `; map=${preflight.map}` : ""}.`,
    ...(preflight.presentation ? [`Map: ${preflight.presentation.model}${preflight.presentation.revision ? `@${preflight.presentation.revision}` : ""}; locality=${preflight.presentation.locality}; egress=${preflight.presentation.egress} (${preflight.presentation.egressDescription}); token ceiling=${preflight.presentation.maximumInputTokens}+${preflight.presentation.maximumOutputTokens}; maximum contribution<=${formatCostUsd(preflight.presentation.maximumCostUsd)}.`] : []),
    `First attempt: calls<=${preflight.firstAttemptMaximumModelCalls}; cost ceiling<=${formatCostUsd(preflight.firstAttemptMaximumCostUsd)}.`,
    `Retry-inclusive authorization: token ceiling=${preflight.maximumInputTokens}+${preflight.maximumOutputTokens}; calls<=${preflight.maximumModelCalls}; retries<=${preflight.maximumRetries}; execution<=${formatDurationSeconds(preflight.maximumExecutionSeconds)}; absolute safety ceiling<=${formatCostUsd(preflight.maximumAuthorizedCostUsd)}.`,
    ...(preflight.scope.window ? [`Window: offset=${preflight.scope.window.offset}; selected=${preflight.scope.window.selected}; remaining=${preflight.scope.window.remaining}${preflight.scope.window.nextOffset === undefined ? "" : `; next offset=${preflight.scope.window.nextOffset}`}.`] : []),
    `Choose an explicit cap after review. Rerun the same command with --confirm --max-cost USD --preflight-token ${preflight.token}. No executable confirmation command is generated. A lower cap may stop without publishing; a later higher cap resumes the same operation.`,
  ].join("\n");
}

function formatDurationSeconds(seconds: number): string {
  if (seconds < 3_600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.ceil(seconds / 3_600)}h`;
  return `${Math.ceil(seconds / 86_400)}d`;
}

function modelOperationLabel(kind: WorkbenchOperation["kind"]): string {
  if (kind === "source.analyze") return "Source analysis";
  return "Eval draft";
}

async function operationResult(operation: WorkbenchOperation, target: WorkbenchRemoteTarget, schema: string, parsed: ParsedArgs, io: CliIo): Promise<number> {
  await pinRemoteObject("operation", operation.id, target);
  const next = `workbench watch ${operation.id}`;
  return emitResult(schema, { operation, next }, parsed, io, () => `Started ${modelOperationLabel(operation.kind)} (${operation.id}).\nnext: ${next}`);
}

function requiredFlag(parsed: ParsedArgs, name: string): string {
  const value = stringFlag(parsed, name);
  if (!value?.trim()) throw new WorkbenchUserError(`--${name} is required.`);
  return value;
}

function requiredListFlag(parsed: ParsedArgs, name: string): string[] {
  const value = stringListFlag(parsed, name);
  if (!value?.length) throw new WorkbenchUserError(`--${name} is required.`);
  return value;
}

interface SourceCommandTarget extends WorkbenchRemoteTarget { sourceId: string }

async function sourceCommandTarget(sourceId: string, parsed: ParsedArgs): Promise<SourceCommandTarget> {
  const binding = await readOptionalLocalWorkbenchSourceBinding(sourceId, localSourceHomeDir());
  const requestedNamespace = stringFlag(parsed, "namespace");
  if (binding && requestedNamespace !== undefined && requestedNamespace !== binding.namespace) {
    throw new WorkbenchUserError(`Source ${sourceId} is bound to ${binding.namespace ? `namespace ${binding.namespace}` : "the personal namespace"}; omit --namespace or use its bound namespace.`);
  }
  if (binding) return { sourceId, baseUrl: binding.baseUrl, ...(binding.namespace ? { namespace: binding.namespace } : {}) };
  const config = await loadConfig();
  return { sourceId, baseUrl: selectWorkbenchBaseUrl({ configBaseUrl: config.baseUrl }), ...(requestedNamespace ? { namespace: requestedNamespace } : {}) };
}

async function remoteCommandTarget(kind: WorkbenchRemoteTargetKind, id: string): Promise<{ target: WorkbenchRemoteTarget; bound: boolean }> {
  const binding = await readOptionalWorkbenchRemoteTarget(kind, id, localSourceHomeDir());
  if (binding) return { target: binding, bound: true };
  const config = await loadConfig();
  return { target: { baseUrl: selectWorkbenchBaseUrl({ configBaseUrl: config.baseUrl }) }, bound: false };
}

async function pinRemoteObject(kind: WorkbenchRemoteTargetKind, id: string, target: WorkbenchRemoteTarget): Promise<void> {
  try { await bindWorkbenchRemoteTarget(kind, id, target, localSourceHomeDir()); }
  catch (error) {
    const command = kind === "operation" ? `workbench watch ${id}` : `workbench eval apply ${id} --yes`;
    throw new WorkbenchCodedError("remote_binding_failed", `${kind === "operation" ? "Operation" : "Eval draft"} ${id} exists at ${target.baseUrl}, but its backend binding could not be saved: ${error instanceof Error ? error.message : String(error)}`, { retryable: true, remediation: `WORKBENCH_API_URL=${quoteShellArg(target.baseUrl)} ${command}`, subject: { kind, id, baseUrl: target.baseUrl }, exitCode: 1 });
  }
}

function targetApiPath(apiPath: string, target: WorkbenchRemoteTarget): string {
  return target.namespace ? `${apiPath}${apiPath.includes("?") ? "&" : "?"}namespace=${encodeURIComponent(target.namespace)}` : apiPath;
}

async function targetApiRequest<T>(target: WorkbenchRemoteTarget, apiPath: string, options?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  return await apiRequest<T>(targetApiPath(apiPath, target), options, target.baseUrl);
}

function sourceNamespaceFlag(target: WorkbenchRemoteTarget): string { return target.namespace ? ` --namespace ${quoteShellArg(target.namespace)}` : ""; }

function assertSourceTarget(target: SourceCommandTarget, actualSourceId: string, subject: string): void {
  if (actualSourceId !== target.sourceId) throw new WorkbenchUserError(`${subject} does not belong to Source ${target.sourceId}.`);
}

function assertSourceOperation(target: SourceCommandTarget, operation: WorkbenchOperation, kind: WorkbenchOperation["kind"]): WorkbenchOperation {
  assertSourceTarget(target, operation.targetId, `Operation ${operation.id}`);
  if (operation.kind !== kind || operation.owner !== (kind === "source.analyze" ? "source" : "eval")) throw new Error(`Operation ${operation.id} has the wrong kind or owner.`);
  return operation;
}

async function requireSourceAnalysis(target: SourceCommandTarget, analysisId: string): Promise<WorkbenchSourceAnalysisViewResponse> {
  const result = await targetApiRequest<WorkbenchSourceAnalysisViewResponse>(target, `/api/workbench/sources/analyses/${encodeURIComponent(analysisId)}?view=review&page=review&decision=kept&limit=1`);
  assertSourceTarget(target, result.analysis.sourceId, `Analysis ${analysisId}`);
  return result;
}

function formatSourceWorkflowNode(node: WorkbenchSourceWorkflowNode): string { return `${node.kind}\t${node.id}\t${node.name}\toccurrences=${node.occurrenceCount}${node.kind === "workflow" ? `\tcitations=${node.representativeCitationIds.join(",")}` : ""}`; }
function formatSourceOccurrence(occurrence: WorkbenchSourceWorkflowOccurrence): string { return `occurrence\t${occurrence.id}\t${occurrence.summary}\tworkflow=${occurrence.workflowId ?? "unassigned"}\tcitations=${occurrence.citationIds.join(",")}`; }

function isRemoteNotFound(error: unknown): boolean {
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "";
  const message = error instanceof Error ? error.message : "";
  return /not[_-]?found/iu.test(code) || /status 404\b/iu.test(message);
}

function localSourceHomeDir(): string | undefined {
  return process.env.HOME?.trim() || undefined;
}

async function readCommandInput(input: string, stdin: NodeJS.ReadableStream): Promise<string> {
  if (input !== "-") {
    const filePath = path.resolve(input);
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_COMMAND_INPUT_BYTES) throw new WorkbenchUserError(`Command input exceeds ${MAX_COMMAND_INPUT_BYTES} bytes.`);
    const content = await fs.readFile(filePath);
    if (content.byteLength > MAX_COMMAND_INPUT_BYTES) throw new WorkbenchUserError(`Command input exceeds ${MAX_COMMAND_INPUT_BYTES} bytes.`);
    return content.toString("utf8");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_COMMAND_INPUT_BYTES) throw new WorkbenchUserError(`Command input exceeds ${MAX_COMMAND_INPUT_BYTES} bytes.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function canonicalEvalFiles(files: readonly SurfaceSnapshotFile[]): SurfaceSnapshotFile[] {
  return files.flatMap((file) => {
    const relative = file.path.replace(/^\.workbench\//u, "");
    return relative === "eval.yaml" || relative.startsWith("cases/") || relative.startsWith("environment/") ? [{ ...file, path: relative }] : [];
  }).sort((left, right) => left.path.localeCompare(right.path));
}

async function writeEvalFiles(projectRoot: string, after: readonly SurfaceSnapshotFile[]): Promise<void> {
  const root = path.join(projectRoot, ".workbench");
  await assertRealEvalRoot(root);
  await recoverEvalApplyTransactions(root);
  for (const component of EVAL_APPLY_COMPONENTS) {
    const stat = await fs.lstat(path.join(root, component)).catch((error) => (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : Promise.reject(error));
    if (stat?.isSymbolicLink()) throw new WorkbenchUserError(`Refusing to replace symlinked Eval path .workbench/${component}.`);
    if (stat && (component === "eval.yaml" ? !stat.isFile() : !stat.isDirectory())) {
      throw new WorkbenchUserError(`Eval path .workbench/${component} has the wrong file type.`);
    }
  }
  const transactionRoot = await fs.mkdtemp(path.join(root, ".eval-apply-"));
  const stagedRoot = path.join(transactionRoot, "new");
  const backupRoot = path.join(transactionRoot, "backup");
  let planned: string[] = [];
  let preserveTransaction = false;
  try {
    await fs.mkdir(backupRoot, { recursive: true });
    for (const file of after) {
      const target = path.join(stagedRoot, file.path);
      await writeFileAtomically(target, file.encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content));
      await fs.chmod(target, file.executable === true ? 0o755 : 0o644);
    }
    planned = (await Promise.all(EVAL_APPLY_COMPONENTS.map(async (component) => await pathExists(path.join(stagedRoot, component)) ? component : undefined)))
      .filter((component): component is typeof EVAL_APPLY_COMPONENTS[number] => component !== undefined);
    await writeFileAtomically(path.join(transactionRoot, "transaction.json"), Buffer.from(JSON.stringify({
      schema: "workbench.eval-apply-transaction.v1",
      planned,
    })));
    for (const component of EVAL_APPLY_COMPONENTS) {
      const target = path.join(root, component);
      const backup = path.join(backupRoot, component);
      const staged = path.join(stagedRoot, component);
      if (await pathExists(target)) {
        await fs.rename(target, backup);
      }
      if (await pathExists(staged)) {
        await fs.rename(staged, target);
      }
    }
  } catch (error) {
    try {
      await rollbackEvalApplyTransaction(root, transactionRoot, planned);
    } catch (rollbackError) {
      preserveTransaction = true;
      throw new AggregateError(
        [error, rollbackError],
        `Eval apply failed and rollback was incomplete. Recovery data is preserved at ${transactionRoot}.`,
      );
    }
    throw error;
  } finally {
    if (!preserveTransaction) await fs.rm(transactionRoot, { recursive: true, force: true });
  }
}

const EVAL_APPLY_COMPONENTS = ["eval.yaml", "cases", "environment"] as const;

async function recoverEvalApplyTransactionsForProject(projectRoot: string): Promise<void> {
  const root = path.join(projectRoot, ".workbench");
  await assertRealEvalRoot(root);
  await recoverEvalApplyTransactions(root);
}

async function assertRealEvalRoot(root: string): Promise<void> {
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new WorkbenchUserError(".workbench must be a real directory before applying an Eval draft.");
}

async function recoverEvalApplyTransactions(root: string): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(".eval-apply-")) continue;
    const transactionRoot = path.join(root, entry.name);
    const marker = await fs.readFile(path.join(transactionRoot, "transaction.json"), "utf8")
      .then((value) => JSON.parse(value) as { schema?: unknown; planned?: unknown }, () => undefined);
    if (!marker) {
      const backupEntries = await fs.readdir(path.join(transactionRoot, "backup")).catch(() => []);
      if (backupEntries.length > 0) throw new WorkbenchUserError(`Incomplete Eval recovery data requires manual inspection at ${transactionRoot}.`);
      await fs.rm(transactionRoot, { recursive: true, force: true });
      continue;
    }
    if (marker.schema !== "workbench.eval-apply-transaction.v1" || !Array.isArray(marker.planned) || marker.planned.some((component) => typeof component !== "string" || !(EVAL_APPLY_COMPONENTS as readonly string[]).includes(component))) {
      throw new WorkbenchUserError(`Invalid Eval recovery marker at ${transactionRoot}.`);
    }
    await rollbackEvalApplyTransaction(root, transactionRoot, marker.planned as string[]);
    await fs.rm(transactionRoot, { recursive: true, force: true });
  }
}

async function rollbackEvalApplyTransaction(root: string, transactionRoot: string, planned: readonly string[]): Promise<void> {
  const stagedRoot = path.join(transactionRoot, "new");
  const backupRoot = path.join(transactionRoot, "backup");
  for (const component of [...EVAL_APPLY_COMPONENTS].reverse()) {
    const target = path.join(root, component);
    const backup = path.join(backupRoot, component);
    if (await pathExists(backup)) {
      await fs.rm(target, { recursive: true, force: true });
      await fs.rename(backup, target);
    } else if (planned.includes(component) && !await pathExists(path.join(stagedRoot, component))) {
      await fs.rm(target, { recursive: true, force: true });
    }
  }
}

async function operationApiRequest(id: string, target: WorkbenchRemoteTarget, method = "GET", body?: unknown): Promise<WorkbenchOperation> {
  const response = await targetApiRequest<unknown>(target, `/api/workbench/operations/${encodeURIComponent(id)}`, { method, ...(body === undefined ? {} : { body }) });
  const envelope = asRecord(response);
  if (!envelope || Object.keys(envelope).length !== 1 || !("operation" in envelope)) {
    throw new Error(`Operation ${id} returned an invalid response.`);
  }
  const operation = parseWorkbenchOperation(envelope.operation);
  if (operation.id !== id) throw new Error(`Operation ${id} returned another operation.`);
  await pinRemoteObject("operation", id, target);
  return operation;
}

async function optionalCloudOperation(id: string): Promise<{ operation: WorkbenchOperation; target: WorkbenchRemoteTarget } | null> {
  const resolved = await remoteCommandTarget("operation", id);
  if (!resolved.bound && !/^op_[a-f0-9]{32}$/u.test(id)) return null;
  return { operation: await operationApiRequest(id, resolved.target), target: resolved.target };
}

async function watchCloudOperation(id: string, target: WorkbenchRemoteTarget, operation: WorkbenchOperation, parsed: ParsedArgs, io: CliIo): Promise<number> {
  const deadline = Date.now() + (positiveIntEnv("WORKBENCH_RUN_WATCH_TIMEOUT_MS") ?? CLOUD_RUN_TIMEOUT_MS);
  while (!new Set(["succeeded", "failed", "canceled"]).has(operation.status) && Date.now() < deadline) {
    await sleep(LOCAL_PROGRESS_POLL_INTERVAL_MS);
    operation = await operationApiRequest(id, target);
  }
  if (!new Set(["succeeded", "failed", "canceled"]).has(operation.status)) {
    throw new WorkbenchCodedError("operation_pending", `Operation ${id} is still ${operation.status}.`, { retryable: true, remediation: `workbench watch ${id}`, exitCode: 1 });
  }
  if (operation.status === "succeeded" && operation.kind === "eval.draft" && operation.resultId) {
    await pinRemoteObject("eval-draft", operation.resultId, target);
  }
  const next = operation.status === "succeeded" && operation.resultId
    ? operation.kind === "eval.draft"
      ? `workbench eval apply ${operation.resultId} --yes`
      : operation.kind === "source.analyze"
        ? `workbench source show ${operation.targetId} --analysis ${operation.resultId}${sourceNamespaceFlag(target)}`
        : null
    : null;
  return emitResult("workbench.cli.operation-watch.v1", { operation, next }, parsed, io, () => `Operation ${id}: ${operation.status}.${operation.resultId ? ` result=${operation.resultId}` : ""}${next ? `\nnext: ${next}` : ""}`, { ok: operation.status === "succeeded", exitCode: operation.status === "succeeded" ? 0 : 1 });
}

async function handleRunWatch(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const runRef = requiredPositional(parsed, 1, "workbench watch requires RUN_ID.", "workbench watch RUN_ID");
  const cloud = await optionalCloudOperation(runRef);
  if (cloud) return await watchCloudOperation(runRef, cloud.target, cloud.operation, parsed, io);
  const core = await coreOptions(parsed);
  const pending = await readWorkbenchPendingCloudOperation({ ...core, operationId: runRef });
  if (pending) {
    return await handlePendingCloudOperationWatch(parsed, io, core, pending);
  }
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const run = requiredRunByRef(snapshot, runRef);
  if (isWorkbenchRunStatusTerminal(run.status)) {
    const jobs = jobsForRuns(snapshot, [run.id]);
    const progress = runProgressSnapshotForInspection({
      command: "watch",
      location: run.location ?? "local",
      phase: "complete",
      runs: [run],
      snapshot,
      startedAtMs: timestampMs(run.createdAt) ?? Date.now(),
      next: showRunNextCommand(run) ?? undefined,
    });
    const runSnapshot = createWorkbenchRunSnapshotForRun(run, jobs, { traces: snapshot.traces });
    const next = showRunNextCommand(run);
    return emitRunTerminalResult("workbench.cli.run-watch.v1", {
      run: runSnapshotResultJson(runSnapshot),
      next: next,
    }, parsed, io, () => formatRunWatchResult(run, jobs, progress, next), runWatchExitCode(run));
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
      command: "watch",
      location: "local",
      phase: "running",
      runs: [run],
      snapshot,
      startedAtMs,
      next: showRunNextCommand(run) ?? undefined,
    });
    renderer.render(progress, { force: isWorkbenchRunStatusTerminal(run.status), command: "watch" });
    if (isWorkbenchRunStatusTerminal(run.status)) {
      const runSnapshot = createWorkbenchRunSnapshotForRun(run, jobs, { traces: snapshot.traces });
      const next = showRunNextCommand(run);
      return emitRunTerminalResult("workbench.cli.run-watch.v1", {
        run: runSnapshotResultJson(runSnapshot),
        next: next,
      }, parsed, io, () => formatRunWatchResult(run, jobs, progress, next), runWatchExitCode(run));
    }
    if (Date.now() >= deadline) {
      throw new WorkbenchCodedError("run_pending", `Run ${run.id} is still ${run.status}.`, {
        retryable: true,
        remediation: `workbench watch ${run.id}`,
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
  const interrupt = createCloudInterruptController("watch", io);
  interrupt.setRunId(run.id);
  try {
    const completed = await waitForCloudRun({
      command: "watch",
      core: context.core,
      interrupt,
      renderer,
      remote: context.remote,
      run: createWorkbenchRunSnapshotForRun(run, jobsForRuns(snapshot, [run.id]), { traces: snapshot.traces }),
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
        next: `workbench watch ${run.id}`,
      }, parsed, io, () => `Detached from run ${displayRef(run.id)}.\nnext: workbench watch ${run.id}`, 130);
    }
    const { run: watchedRun, jobs, traces } = await localRunStateForSnapshot(context.core, completed.run);
    const latest = await createWorkbenchReadOnlyInspectionSnapshot(context.core);
    const progress = runProgressSnapshotForInspection({
      command: "watch",
      location: watchedRun.location ?? "cloud",
      phase: "complete",
      runs: [watchedRun],
      snapshot: latest,
      startedAtMs: timestampMs(watchedRun.createdAt) ?? Date.now(),
      next: showRunNextCommand(watchedRun) ?? undefined,
    });
    const runSnapshot = createWorkbenchRunSnapshotForRun(watchedRun, jobs, { traces: traces.length > 0 ? traces : latest.traces });
    const next = showRunNextCommand(watchedRun);
    return emitRunTerminalResult("workbench.cli.run-watch.v1", {
      run: runSnapshotResultJson(runSnapshot),
      next: next,
    }, parsed, io, () => formatRunWatchResult(watchedRun, jobs, progress, next), runWatchExitCode(watchedRun));
  } finally {
    interrupt.dispose();
  }
}

async function handlePendingCloudOperationWatch(
  parsed: ParsedArgs,
  io: CliIo,
  core: { dir?: string; authToken?: string },
  operation: WorkbenchPendingCloudOperation,
): Promise<number> {
  const deadline = Date.now() + (positiveIntEnv("WORKBENCH_RUN_WATCH_TIMEOUT_MS") ?? CLOUD_RUN_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (await hasWorkbenchLocalRunCancellationRequest({ ...core, runId: operation.id })) {
      await clearWorkbenchPendingCloudOperation({ ...core, operationId: operation.id });
      throw new WorkbenchCodedError("cloud_canceled", `Hosted ${operation.command} was canceled before Workbench Cloud accepted it.`, {
        subject: { operationId: operation.id },
        exitCode: 130,
      });
    }
    if (!await readWorkbenchPendingCloudOperation({ ...core, operationId: operation.id })) {
      const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
      if (snapshot.runs.some((run) => run.id === operation.id)) {
        return await handleRunWatch(parsed, io);
      }
    }
    await sleep(LOCAL_PROGRESS_POLL_INTERVAL_MS);
  }
  throw new WorkbenchCodedError("run_pending", `Operation ${operation.id} is still waiting for Workbench Cloud acceptance.`, {
    retryable: true,
    remediation: `workbench watch ${operation.id}`,
    subject: { operationId: operation.id },
    exitCode: 1,
  });
}

async function handleRunCancel(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const runRef = requiredPositional(parsed, 1, "workbench cancel requires RUN_ID.", "workbench cancel RUN_ID");
  const cloud = await optionalCloudOperation(runRef);
  if (cloud) return await operationResult(await operationApiRequest(runRef, cloud.target, "DELETE"), cloud.target, "workbench.cli.operation-cancel.v1", parsed, io);
  const core = await coreOptions(parsed);
  const pending = await readWorkbenchPendingCloudOperation({ ...core, operationId: runRef });
  if (pending) {
    const requested = await requestWorkbenchPendingCloudOperationCancellation({
      ...core,
      operationId: pending.id,
      reason: "user_requested",
    });
    return emitResult("workbench.cli.pending-cloud-operation-cancel.v1", {
      operationId: pending.id,
      command: pending.command,
      requestedAt: requested.requestedAt,
      next: `workbench watch ${pending.id}`,
    }, parsed, io, () => [
      `Cancellation requested for pending Cloud operation ${displayRef(pending.id)}.`,
      `next: workbench watch ${pending.id}`,
    ].join("\n"));
  }
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const run = requiredRunByRef(snapshot, runRef);
  if (isWorkbenchRunStatusTerminal(run.status)) {
    throw new WorkbenchCodedError("run_terminal", `Run ${run.id} is already ${run.status}.`, {
      remediation: `workbench eval show ${run.id}`,
      subject: { runId: run.id, status: run.status },
      exitCode: 2,
    });
  }
  if ((run.location ?? "local") === "cloud") {
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
      next: next,
    }, parsed, io, () => [
      `Cancellation requested for ${displayRef(canceledRun.id)}.`,
      ...(next ? [`next: ${next}`] : []),
    ].join("\n"));
  }
  const result = await requestLocalWorkbenchRunCancellation({ ...core, runId: run.id, reason: "user_requested" });
  const runSnapshot = createWorkbenchRunSnapshotForRun(result.run, jobsForRuns(snapshot, [result.run.id]), {
    traces: snapshot.traces,
  });
  return emitResult("workbench.cli.run-cancel.v1", {
    run: runSnapshotResultJson(runSnapshot),
    requestedAt: result.requestedAt,
    next: `workbench watch ${result.run.id}`,
  }, parsed, io, () => [
    `Cancellation requested for ${displayRef(result.run.id)}.`,
    `next: workbench watch ${result.run.id}`,
  ].join("\n"));
}

async function handleRunRetry(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const runRef = requiredPositional(parsed, 1, "workbench retry requires RUN_ID.", "workbench retry RUN_ID");
  const authorization = modelAuthorizationFromFlags(parsed);
  const cloud = await optionalCloudOperation(runRef);
  if (cloud) {
    if (authorization) return await operationResult(await operationApiRequest(runRef, cloud.target, "PUT", authorization), cloud.target, "workbench.cli.operation-retry.v1", parsed, io);
    const response = await targetApiRequest<{ operation?: unknown; preflight?: WorkbenchModelPreflight }>(cloud.target, `/api/workbench/operations/${encodeURIComponent(runRef)}`, { method: "POST" });
    if (response.operation) {
      const operation = parseWorkbenchOperation(response.operation);
      if (operation.id !== runRef) throw new Error(`Operation ${runRef} returned another operation.`);
      return await operationResult(operation, cloud.target, "workbench.cli.operation-retry.v1", parsed, io);
    }
    if (response.preflight) return emitResult("workbench.cli.operation-retry-preflight.v1", { preflight: response.preflight, next: null }, parsed, io, () => formatCliPreflight(response.preflight!));
    throw new Error(`Operation ${runRef} returned an invalid retry response.`);
  }
  if (authorization) throw new WorkbenchUserError("Model authorization flags require a model operation id.");
  const core = await coreOptions(parsed);
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const run = requiredRunByRef(snapshot, runRef);
  const request = resolveWorkbenchRunRetryRequest(snapshot, run);
  if (request.variant === "cloud") {
    return await retryCloudRun(parsed, io, core, snapshot, run, request);
  }
  const started = await startPrivateLocalWorkbenchOperation({
    core,
    request,
  });
  const completed = await waitForLocalRunTerminal({
    command: "retry",
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
  retryRequest: WorkbenchOperationRequest,
): Promise<number> {
  const remoteContext = await cloudRemoteRunContext(core, snapshot, run);
  const renderer = createProgressRenderer({ stderr: io.stderr, json: parsed.flags.json === true });
  const interrupt = createCloudInterruptController("retry", io);
  const startedAtMs = Date.now();
  const renderCloudProgress = (
    phase: WorkbenchProgressPhase,
    runs: readonly WorkbenchRun[] = [],
    jobs: readonly WorkbenchJob[] = [],
  ): void => {
    if (parsed.flags.json === true) {
      return;
    }
    renderer.render(runProgressSnapshotFromRuns({
      command: "retry",
      location: "cloud",
      phase,
      runs,
      jobs,
      startedAtMs,
      next: null,
    }), { command: "retry" });
  };
  const runId = createWorkbenchRunId();
  const pendingOperation: WorkbenchPendingCloudOperation = {
    schema: "workbench.pending-cloud-operation.v1",
    id: runId,
    command: "retry",
    remoteName: remoteContext.remote.name,
    createdAt: new Date().toISOString(),
    retryOfRunId: run.id,
  };
  try {
    const remoteRetryRequest = workbenchOperationRequestWithRunId(retryRequest, runId);
    const { run: response, skillId, syncBefore } = await acceptHostedOperation({
      command: "retry",
      core: remoteContext.core,
      interrupt,
      io,
      json: parsed.flags.json === true,
      pendingOperation,
      renderPreflight: () => renderCloudProgress("preflight"),
      prepare: async () => ({
        remote: remoteContext.remote,
        source: remoteContext.source,
        request: remoteRetryRequest,
      }),
      missingRunMessage: "Workbench Cloud did not return a retry run.",
      missingRunRemediation: `workbench retry ${run.id}`,
    });
    const completed = await waitForCloudRun({
      command: "retry",
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
        next: `workbench watch ${completed.run.id}`,
      }, parsed, io, () => `Detached from retry ${displayRef(completed.run.id)}.\nnext: workbench watch ${completed.run.id}`, 130);
    }
    const { run: retryRun, jobs, traces } = await localRunStateForSnapshot(remoteContext.core, completed.run);
    const runSnapshot = createWorkbenchRunSnapshotForRun(retryRun, jobs, { traces });
    return emitRetryResult(parsed, io, run, [retryRun], runSnapshot, {
      remote: remoteContext.remote.name,
      url: remoteContext.remote.url,
      skillId,
      sync: {
        before: cloudSyncSummary(syncBefore),
        after: cloudSyncSummary(completed.sync),
      },
    });
  } finally {
    interrupt.dispose();
  }
}

type HostedOperationCommand = WorkbenchRunKind | "retry";

async function acceptHostedOperation(input: {
  command: HostedOperationCommand;
  core: { dir?: string; authToken?: string };
  interrupt: ReturnType<typeof createCloudInterruptController>;
  io: CliIo;
  json: boolean;
  pendingOperation: WorkbenchPendingCloudOperation;
  renderPreflight: () => void;
  prepare: () => Promise<{
    remote: WorkbenchRemote;
    source: ParsedWorkbenchInstallSource;
    request: WorkbenchOperationRequest;
  }>;
  missingRunMessage: string;
  missingRunRemediation: string;
  missingRunSubject?: (context: { remote: WorkbenchRemote; skillId: string }) => Record<string, Json>;
}): Promise<{
  run: WorkbenchRunSnapshot;
  remote: WorkbenchRemote;
  source: ParsedWorkbenchInstallSource;
  skillId: string;
  syncBefore: Awaited<ReturnType<typeof syncWorkbenchRemote>>;
}> {
  const runId = input.pendingOperation.id;
  try {
    input.interrupt.setRunId(runId);
    await recordWorkbenchPendingCloudOperation({ ...input.core, operation: input.pendingOperation });
    input.renderPreflight();
    await abortIfPendingCloudOperationCanceled(input.core, input.pendingOperation);
    const prepared = await input.prepare();
    const syncBefore = await cloudPreScheduleStepWithLocalCancel(
      input.command,
      input.interrupt,
      input.core,
      input.pendingOperation,
      (signal) => withProgressHeartbeat(
        input.io,
        `${workbenchOperationInvocation(input.command)}: syncing with Workbench Cloud`,
        async () => await syncWorkbenchRemote({ ...input.core, remote: prepared.remote.name, signal }),
        {
          hint: `Run ${displayRef(runId)} is waiting for Cloud acceptance; resume with workbench watch ${runId} or cancel with workbench cancel ${runId}.`,
          immediate: !input.json,
          json: input.json,
        },
      ),
    );
    await abortIfPendingCloudOperationCanceled(input.core, input.pendingOperation);
    const skillId = await cloudPreScheduleStep(
      input.command,
      input.interrupt,
      async (signal) => await resolveCloudSkillId(prepared.source, signal),
    );
    await abortIfPendingCloudOperationCanceled(input.core, input.pendingOperation);
    const response = await cloudPreScheduleStep(
      input.command,
      input.interrupt,
      async (signal) => await withProgressHeartbeat(
        input.io,
        `${workbenchOperationInvocation(input.command)}: scheduling hosted run`,
        async () => await apiRequest<WorkbenchRunSnapshot>(
          `/api/workbench/skills/${encodeURIComponent(skillId)}/workbench/operations`,
          { method: "POST", body: prepared.request, signal },
          prepared.source.baseUrl,
        ),
        {
          hint: `Run ${displayRef(runId)} is waiting for Cloud acceptance; resume with workbench watch ${runId} or cancel with workbench cancel ${runId}.`,
          immediate: !input.json,
          json: input.json,
        },
      ),
    );
    if (response.schema !== "workbench.run.v1" || !response.id) {
      throw new WorkbenchCodedError("cloud_run_missing", input.missingRunMessage, {
        retryable: true,
        remediation: input.missingRunRemediation,
        ...(input.missingRunSubject ? { subject: input.missingRunSubject({ remote: prepared.remote, skillId }) } : {}),
        exitCode: 1,
      });
    }
    if (response.id !== runId) {
      throw new WorkbenchCodedError(
        "cloud_run_id_mismatch",
        `Workbench Cloud returned a different run id for hosted ${input.command}.`,
        {
          retryable: true,
          remediation: `workbench watch ${runId}`,
          subject: { expectedRunId: runId, actualRunId: response.id, remote: prepared.remote.name, skillId },
          exitCode: 1,
        },
      );
    }
    input.interrupt.setRunId(response.id);
    await cancelAcceptedCloudRunIfLocallyRequested({
      command: input.command,
      core: input.core,
      remoteName: prepared.remote.name,
      source: prepared.source,
      skillId,
      run: response,
    });
    await recordWorkbenchCloudRunSnapshot({ ...input.core, remoteName: prepared.remote.name, run: response });
    await clearWorkbenchPendingCloudOperation({ ...input.core, operationId: runId });
    return { ...prepared, run: response, skillId, syncBefore };
  } catch (error) {
    if (error instanceof WorkbenchCodedError && (error.code === "cloud_canceled" || error.code === "cloud_detached")) {
      throw error;
    }
    const contextualError = hostedRunErrorWithContext(error, runId);
    await clearWorkbenchPendingCloudOperation({ ...input.core, operationId: runId }).catch(() => undefined);
    throw contextualError;
  }
}

function requiredRunByRef(snapshot: WorkbenchInspectionSnapshot, ref: string): WorkbenchRun {
  const run = resolveWorkbenchObjectByRef(snapshot.runs, ref, "run");
  if (!run) {
    throw new WorkbenchCodedError("run_not_found", `Run not found: ${ref}.`, {
      remediation: "workbench eval results",
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
      remediation: "workbench skill sync cloud",
      subject: {
        runId: run.id,
        ...(run.remoteName ? { remoteName: run.remoteName } : {}),
      },
      exitCode: 1,
    });
  }
  const source = requiredWorkbenchCloudRemoteSource(remote);
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
    next: first ? runWatchNextCommand(first) : "workbench eval results",
  }, parsed, io, () => [
    `Retried ${displayRef(oldRun.id)}${first ? ` as ${displayRef(first.id)}` : ""}.`,
    formatRunSnapshot(runSnapshot),
    ...(first ? [`next: ${runWatchNextCommand(first)}`] : []),
  ].join("\n"), code);
}

function emitRunTerminalResult<Body extends Record<string, unknown>>(
  schema: string,
  body: JsonSerializable<Body>,
  parsed: ParsedArgs,
  io: CliIo,
  text: (format: HumanFormatOptions) => string,
  code: number,
): number {
  if (parsed.flags.json === true) {
    io.stdout.write(`${JSON.stringify({ schema, ok: true, ...body }, null, 2)}\n`);
  } else {
    io.stdout.write(`${text(humanFormatOptions(io.stdout))}\n`);
  }
  return code;
}

function runWatchExitCode(run: WorkbenchRun): number {
  return isWorkbenchRunStatusTerminal(run.status) ? 0 : 1;
}

function runWatchNextCommand(run: WorkbenchRun): string | null {
  if (run.status === "queued" || run.status === "running" || run.status === "canceling") {
    return `workbench watch ${run.id}`;
  }
  if (run.status === "failed" || run.status === "canceled") {
    return terminalRunRepairCommand(run) ?? `workbench eval show ${run.id}`;
  }
  if (run.kind === "run") {
    return workbenchRunTransitionCliEquivalent(run, "grade");
  }
  return run.kind === "improve" ? workbenchRunTransitionCliEquivalent(run, "eval", {
    rerun: true,
    samples: 5,
  }) : workbenchRunResultsCliEquivalent(run);
}

function showRunNextCommand(run: WorkbenchRun): string | null {
  const next = runWatchNextCommand(run);
  return next === `workbench eval show ${run.id}` ? null : next;
}

function terminalRunRepairCommand(run: WorkbenchRun): string | null {
  const message = run.error?.trim();
  if (!message) {
    return null;
  }
  const match = /\bNext:\s*(.+?)(?:\.\s|$)/u.exec(message);
  const command = match?.[1]?.trim();
  if (!command || !normalizeWorkbenchCommandRemediation(command)) {
    return null;
  }
  return command;
}

async function postAgentAddSetupCommands(
  agent: WorkbenchAgent,
  core: CliCoreOptions,
): Promise<string[]> {
  const adapter = agent.adapter.trim().toLowerCase();
  const agentSelector = quoteShellArg(agent.name);
  const isImprover = agent.name === "improver";
  const evalCommand = `workbench eval run --agents ${agentSelector}${isImprover ? " --rerun" : ""}`;
  const commands = new Set<string>();
  const preview = await previewWorkbenchEval({
    ...core,
    agent: agent.name,
    rerun: isImprover,
  }).catch(() => null);
  const agentReadinessIssues = preview?.readiness.issues.filter(agentAddReadinessIssue) ?? [];
  if (agentReadinessIssues.length > 0) {
    for (const issue of readinessIssuesForNext(agentReadinessIssues)) {
      for (const setupCommand of readinessIssueSetupCommands(issue)) {
        commands.add(setupCommand);
      }
      for (const chunk of commandChainParts(issue.remediation)) {
        if (isWorkbenchOperationCommand(chunk, "eval")) {
          continue;
        }
        commands.add(chunk);
      }
    }
  } else if (!preview && (adapter === "codex" || adapter === "claude")) {
    commands.add(workbenchProviderAuthSetupCommand(adapter));
  }
  commands.add(evalCommand);
  if (isImprover) {
    commands.add(`workbench skill improve --agents ${agentSelector}`);
  }
  return [...commands];
}

function agentAddReadinessIssue(issue: WorkbenchLaunchReadinessIssue): boolean {
  return issue.code === "adapter_auth_required" ||
    issue.code === "provider_oauth_missing" ||
    issue.code === "auth_required";
}

function formatRunWatchResult(
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
  progress?: WorkbenchRunSnapshot,
  next: string | null = showRunNextCommand(run),
): string {
  const failed = jobs.filter((job) => job.status === "failed").length;
  const canceled = jobs.filter((job) => job.status === "canceled").length;
  return [
    progress ? formatRunSnapshot(progress) : formatRun(run),
    ...(progress ? [`progress=${formatProgressSummary(progress)}`] : []),
    `jobs=${jobs.length} failed=${failed}${canceled > 0 ? ` canceled=${canceled}` : ""}`,
    ...(next ? [`next: ${next}`] : []),
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
  const ref = optionalPositional(parsed, 2) ?? "current";
  const core = await coreOptions(parsed);
  const [objectRef, requestedPath] = splitShowRef(ref);
  const traceSnapshot = requestedPath ? null : await optionalInspectionSnapshot(parsed);
  if (!requestedPath) {
    const snapshotTrace = resolveWorkbenchObjectByRef(traceSnapshot?.traces ?? [], objectRef, "trace");
    if (snapshotTrace) {
      return output(traceRecordDetail(snapshotTrace), parsed, io, () => formatTraceRecordDetail(snapshotTrace));
    }
  }
  if (requestedPath) {
    if (objectRef === "current") {
      throw new WorkbenchCodedError("usage", `Use a path directly for live project files: workbench skill show ${requestedPath}`, {
        remediation: `workbench skill show ${quoteShellArg(requestedPath)}`,
        subject: { ref, path: requestedPath },
        exitCode: 2,
      });
    }
    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
    const file = fileForSnapshotRef(snapshot, objectRef, requestedPath);
    if (file) {
      return output(file, parsed, io, () => formatShow(file));
    }
    const value = await showWorkbenchRef(ref, core);
    return output(value, parsed, io, () => formatShow(value));
  }
  const snapshot = traceSnapshot ?? await createWorkbenchReadOnlyInspectionSnapshot(core);
  const version = snapshotVersionByRef(snapshot, objectRef);
  if (version) {
    return output(fileListing("version", version.id, version.files), parsed, io, () => formatFileListing("version", version.id, version.files));
  }
  const evalSnapshot = snapshotEvalByRef(snapshot, objectRef);
  if (evalSnapshot) {
    return output(fileListing("eval", objectRef, evalSnapshot.files), parsed, io, () => formatFileListing("eval", objectRef, evalSnapshot.files));
  }
  const selection = runOrJobEvidenceSelection(snapshot, objectRef);
  const details = evidenceDetailsForSelection(snapshot, selection);
  const evidenceFiles = evidenceFilesForSelection(snapshot, selection);
  if (selection.run || selection.jobs.length > 0 || details.length > 0 || evidenceFiles.length > 0) {
    const next = selection.run ? showRunNextCommand(selection.run) : null;
    const progress = selection.run
      ? runProgressSnapshotForInspection({
          command: "watch",
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
      ...(selection.run ? { run: runSummary(selection.run, [], selection.jobs, snapshot.traces) } : {}),
      jobs: selection.jobs.map(jobEvidenceSummary),
      ...(progress ? { progress: progress } : {}),
      failures: runFailureGroups(selection.jobs, ["failed"]),
      cancellations: runFailureGroups(selection.jobs, ["canceled"]),
      details: details.map((detail) => evidenceDetailSummary(detail, new Map(selection.jobs.map((job) => [job.id, job])))),
      highlights: evidenceHighlights(evidenceFiles),
      files: evidenceFiles.map((file) => fileSummary(file, showFileRef(evidenceOwnerRef, file.path))),
      ...(next ? { next } : {}),
    }, parsed, io, () => selection.run
      ? formatRunEvidenceSummary(snapshot, selection.run, selection.jobs, details, evidenceFiles, progress, next)
      : formatRunOrJobEvidence(snapshot, selection.jobs, details, evidenceFiles, evidenceOwnerRef));
  }
  const trace = resolveWorkbenchObjectByRef(snapshot.traces, objectRef, "trace");
  if (trace) {
    return output(traceRecordDetail(trace), parsed, io, () => formatTraceRecordDetail(trace));
  }
  const artifact = resolveWorkbenchObjectByRef(snapshot.artifacts, objectRef, "artifact");
  if (artifact) {
    return output(fileListing("artifact", artifact.id, artifact.files), parsed, io, () => formatFileListing("artifact", artifact.id, artifact.files));
  }
  const value = await showWorkbenchRef(ref, core);
  return output(value, parsed, io, () => formatShow(value));
}

async function handleAgent(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const subcommand = requiredPositional(parsed, 2, "workbench eval agent requires list|add|rm.");
  if (subcommand === "list") {
    const agents = await listWorkbenchAgents(await coreOptions(parsed));
    return output(agents, parsed, io, (format) => formatAgents(agents, format));
  }
  if (subcommand === "add") {
    const name = requiredPositional(parsed, 3, "workbench eval agent add requires NAME.", "workbench eval agent add NAME --adapter ADAPTER");
    const adapter = stringFlag(parsed, "adapter");
    if (!adapter) {
      throw new WorkbenchUserError("workbench eval agent add requires --adapter ADAPTER.");
    }
    const config = parseWithFlags(parsed);
    validateAgentCommandConfig(config);
    const core = await coreOptions(parsed);
    const agent = await addWorkbenchAgent({
      ...core,
      name,
      adapter,
      model: stringFlag(parsed, "model"),
      config,
    });
    const setupCommands = await postAgentAddSetupCommands(agent, core);
    const next = setupCommands[0] ?? null;
    return output({
      agent: agent,
      setupCommands: setupCommands,
      next: next,
    }, parsed, io, () => [
      `Configured agent ${formatAgentInline(agent)}.`,
      ...setupCommandBlock(setupCommands),
      ...(next ? [`next: ${next}`] : []),
    ].join("\n"));
  }
  if (subcommand === "rm") {
    const result = await removeWorkbenchAgent(
      requiredPositional(parsed, 3, "workbench eval agent rm requires NAME.", "workbench eval agent rm NAME"),
      await coreOptions(parsed),
    );
    return output(result, parsed, io, () => `Removed agent ${result.removed}.`);
  }
  throw new WorkbenchUserError(`Unsupported agent command: ${subcommand}`);
}

async function handleAdapterLogin(provider: string, parsed: ParsedArgs, io: CliIo): Promise<number> {
  const target = parseAuthTarget(provider, authProfileFlag(parsed));
  const method = authMethod(parsed, target.adapterId);
  const store = localWorkbenchAdapterAuthStore(adapterAuthStoreRoot());
  const login = await collectOrReuseAdapterAuthBundle({
    target,
    method,
    profileRoot: path.resolve(stringFlag(parsed, "profile-root") ?? os.homedir()),
    store,
  });
  const saved = login.reused ? login.bundle : await store.put(login.bundle);
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
        ...(login.reused ? { reused: true } : {}),
      },
      remoteAdapterAuth: remote,
    },
    parsed,
    io,
    () => `${login.reused ? "Using existing" : "Connected"} ${formatAuthTarget(saved)} ${saved.method} auth v${saved.version}; remote provider auth: ${remote.sync}${remote.reason ? ` (${remote.reason})` : ""}.`,
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
      },
      remoteAdapterAuth: remote,
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

function validateCommandFlags(parsed: ParsedArgs, command: string | undefined): void {
  const effectiveCommand = command ?? (parsed.flags.version === true ? "version" : "status");
  const allowed = allowedFlagsForWorkbenchCommand(parsed.positionals, effectiveCommand);
  if (!allowed) {
    return;
  }
  const allowedSet = new Set(Object.keys(allowed));
  for (const [name, value] of Object.entries(parsed.flags)) {
    if (!allowedSet.has(name)) {
      throw unsupportedFlagError(effectiveCommand, name);
    }
    validateFlagValue(name, value, allowed[name]);
  }
}

function unsupportedFlagError(command: string, name: string): WorkbenchCodedError {
  return new WorkbenchCodedError("usage", `Unsupported flag --${name} for workbench ${command}.`, {
    exitCode: 2,
  });
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
  if (kind === "nonnegative-integer" || kind === "positive-integer" || kind === "port") {
    const parsedValue = Number(value);
    if (kind === "nonnegative-integer" && (!Number.isInteger(parsedValue) || parsedValue < 0)) {
      throw new WorkbenchUserError(`--${name} must be a nonnegative integer.`);
    }
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
const DEFAULT_WORKBENCH_CLOUD_BASE_URL = "https://workbench.ai";
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
    adapterAuth: adapterAuth,
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
  const baseUrl = selectWorkbenchBaseUrl({ configBaseUrl: config.baseUrl });
  const tokenPresent = Boolean(config.accessToken);
  let revoke: "revoked" | "failed" | "skipped" = "skipped";
  if (config.accessToken) {
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
    await writeConfig({ schema: CONFIG_SCHEMA, baseUrl });
  }
  return emitResult("workbench.cli.logout.v1", {
    baseUrl,
    tokenPresent,
    revoke,
    tokenRemoved,
    adapterAuth: "unchanged",
  }, parsed, io, () => [
    `Logged out of Workbench (${baseUrl}).`,
    `Token: ${tokenPresent ? "present" : "absent"}; revoke ${revoke}; token ${tokenRemoved ? "removed" : "unchanged"}.`,
    "Local adapter auth unchanged; run workbench logout PROVIDER to remove provider credentials.",
  ].join("\n"));
}

async function handleInstall(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const { sourceInput, passthroughArgs } = installCommandInput(parsed);
  if (isExplicitExternalInstallSource(sourceInput)) {
    return await handleExternalSkillInstall(parsed, io, {
      sourceInput,
      passthroughArgs,
    });
  }
  const source = await resolveWorkbenchCloudSkillUrl(sourceInput, "workbench skill install", "workbench skill install OWNER/SKILL");
  const workbenchSource = parseWorkbenchInstallSource(source);
  if (!workbenchSource) {
    throw new WorkbenchCodedError("usage", "workbench skill install expects OWNER/SKILL, a Workbench Cloud skill URL, or an explicit external source.", {
      remediation: "workbench skill install OWNER/SKILL",
      exitCode: 2,
    });
  }
  const snapshot = await fetchWorkbenchSkillPackage(workbenchSource, source, {
    packageVersionNotFoundRemediation: installCurrentPublishedPackageCommand(workbenchSource, sourceInput, parsed),
  });
  if (passthroughArgs.length > 0) {
    throw new WorkbenchCodedError("usage", "External skills options do not apply to Workbench skill packages.", {
      exitCode: 2,
    });
  }
  const sourceSummary = workbenchInstallSourceSummary(snapshot);
  const result = await installSnapshotToSkillTarget({
    snapshot,
    overwrite: parsed.flags.yes === true,
    dryRun: parsed.flags["dry-run"] === true,
    target: stringFlag(parsed, "target"),
    scope: stringFlag(parsed, "scope"),
    dir: dirFlag(parsed),
    sourceForRemediation: workbenchInstallSourceArgument(workbenchSource),
    provenance: {
      handle: `${workbenchSource.owner}/${workbenchSource.skill}`,
      versionId: snapshot.versionId,
      baseUrl: workbenchSource.baseUrl,
    },
  });
  const dryRun = parsed.flags["dry-run"] === true;
  const next = result.remediation ??
    (dryRun ? installDryRunNextCommand(parsed, sourceInput, result) : "workbench skill list");
  const blockedDryRun = dryRun && result.result === "blocked";
  return emitResult("workbench.cli.skill-install.v3", {
    mode: "workbench",
    source: sourceSummary,
    ...installResultToJson(result),
    next: next,
    ...(dryRun ? { dryRun: true } : {}),
  }, parsed, io, () => formatInstallOutcome(result, dryRun, next), {
    ok: !blockedDryRun,
    exitCode: blockedDryRun ? 1 : 0,
  });
}

interface InstallCommandInput {
  sourceInput: string;
  passthroughArgs: string[];
}

interface ExternalSkillInstallContext {
  sourceInput: string;
  passthroughArgs: string[];
}

function installCommandInput(parsed: ParsedArgs): InstallCommandInput {
  const separatorIndex = parsed.positionals.indexOf("--", 2);
  const workbenchPositionals = separatorIndex === -1
    ? parsed.positionals
    : parsed.positionals.slice(0, separatorIndex);
  if (workbenchPositionals.length > 3) {
    throw new WorkbenchCodedError("usage", "workbench skill install accepts one source.", {
      remediation: "workbench skill install OWNER/SKILL",
      exitCode: 2,
    });
  }
  const sourceInput = workbenchPositionals[2];
  if (!sourceInput) {
    throw new WorkbenchCodedError("usage", "workbench skill install requires SOURCE.", {
      remediation: "workbench skill install OWNER/SKILL",
      exitCode: 2,
    });
  }
  return {
    sourceInput,
    passthroughArgs: separatorIndex === -1 ? [] : parsed.positionals.slice(separatorIndex + 1),
  };
}

async function handleExternalSkillInstall(
  parsed: ParsedArgs,
  io: CliIo,
  context: ExternalSkillInstallContext,
): Promise<number> {
  const dryRun = parsed.flags["dry-run"] === true;
  const execution = externalSkillInstallExecution(parsed, context.passthroughArgs);
  const result = await runExternalSkillInstall({
    source: context.sourceInput,
    args: execution.args,
    dryRun,
    cwd: execution.cwd,
    env: process.env,
  });
  if (result.exitCode !== 0) {
    throw externalSkillInstallFailedError(result, context);
  }
  const next = dryRun ? result.delegatedCommandText : "workbench skill list";
  return emitResult("workbench.cli.skill-install.v3", {
    mode: "external",
    source: {
      kind: "external-agent-skill",
      input: context.sourceInput,
    },
    result: dryRun ? "planned" : "installed",
    delegatedTool: result.delegatedTool,
    delegatedCommand: result.delegatedCommand,
    delegatedCommandText: result.delegatedCommandText,
    exitCode: result.exitCode,
    cwd: result.cwd,
    next: next,
    ...(result.stdout ? { stdout: result.stdout } : {}),
    ...(result.stderr ? { stderr: result.stderr } : {}),
    ...(dryRun ? { dryRun: true } : {}),
  }, parsed, io, () => formatExternalSkillInstallOutcome(result, next));
}

function externalSkillInstallExecution(
  parsed: ParsedArgs,
  passthroughArgs: readonly string[],
): { args: string[]; cwd: string } {
  const scope = externalSkillInstallScope(parsed);
  const args: string[] = [];
  if (scope === "global") {
    args.push("--global");
  }
  args.push(...externalSkillInstallTargetArgs(parsed));
  if (parsed.flags.yes === true) {
    args.push("--yes");
  }
  args.push(...passthroughArgs);
  return {
    args,
    cwd: path.resolve(dirFlag(parsed) ?? process.cwd()),
  };
}

function externalSkillInstallScope(parsed: ParsedArgs): "folder" | "global" {
  const scope = stringFlag(parsed, "scope");
  if (!scope) {
    return "folder";
  }
  if (scope === "folder" || scope === "global") {
    return scope;
  }
  throw new WorkbenchCodedError("usage", "workbench skill list/install --scope expects folder or global.", {
    remediation: "workbench skill list --scope global",
    subject: { scope },
    exitCode: 2,
  });
}

function externalSkillInstallTargetArgs(parsed: ParsedArgs): string[] {
  const target = stringFlag(parsed, "target");
  if (!target) {
    return [];
  }
  if (target === "codex") {
    return ["--agent", "codex"];
  }
  if (target === "claude") {
    return ["--agent", "claude-code"];
  }
  throw new WorkbenchCodedError("usage", "workbench skill list/install --target expects codex or claude.", {
    remediation: "workbench skill list --target codex",
    subject: { target },
    exitCode: 2,
  });
}

function externalSkillInstallFailedError(
  result: ExternalSkillInstallResult,
  context: ExternalSkillInstallContext,
): WorkbenchCodedError {
  const reason = conciseExternalSkillsFailureReason(result);
  const message = reason
    ? `External Agent Skill install failed. ${reason}`
    : "External Agent Skill install failed.";
  return new WorkbenchCodedError("external_install_failed", message, {
    remediation: result.delegatedCommandText,
    subject: {
      mode: "external",
      source: context.sourceInput,
      delegatedTool: result.delegatedTool,
      delegatedCommand: result.delegatedCommand,
      delegatedCommandText: result.delegatedCommandText,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      cwd: result.cwd,
    },
    exitCode: result.exitCode || 1,
  });
}

function formatExternalSkillInstallOutcome(
  result: ExternalSkillInstallResult,
  next: string,
): string {
  return [
    result.dryRun
      ? "Would install external Agent Skill (dry run made no changes)."
      : "Installed external Agent Skill.",
    result.dryRun ? `run directly: ${next}` : `next: ${next}`,
  ].join("\n");
}

function isExplicitExternalInstallSource(input: string): boolean {
  const source = input.trim();
  if (!source) {
    return false;
  }
  if (source === "." || source.startsWith("./") || source.startsWith("../") || source.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(source)) {
    return true;
  }
  if (/^(?:github:|gitlab:|git@|ssh:\/\/|file:\/\/)/iu.test(source)) {
    return true;
  }
  if (/\.git(?:$|[/?#])/iu.test(source)) {
    return true;
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(source) && !/^https?:\/\//iu.test(source)) {
    return true;
  }
  if (/^https?:\/\//iu.test(source)) {
    try {
      const url = new URL(source);
      const host = url.hostname.toLowerCase();
      if (host === "github.com" || host.endsWith(".github.com") || host === "gitlab.com" || host.endsWith(".gitlab.com")) {
        return true;
      }
      return !isPlausibleWorkbenchSkillPath(url.pathname);
    } catch {
      return true;
    }
  }
  const parts = source.split("/").filter(Boolean);
  return parts.length > 2;
}

function isPlausibleWorkbenchSkillPath(pathname: string): boolean {
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  return segments.length === 3 && segments[0] === "skills" && Boolean(segments[1]) && Boolean(segments[2]) ||
    segments.length === 5 && segments[0] === "skills" && Boolean(segments[1]) && Boolean(segments[2]) &&
      segments[3] === "versions" && Boolean(segments[4]);
}

function installDryRunNextCommand(
  parsed: ParsedArgs,
  sourceInput: string,
  result: WorkbenchInstallResult,
): string | null {
  if (result.result !== "planned") {
    return null;
  }
  const parts = ["workbench skill install", quoteShellArg(sourceInput)];
  const target = stringFlag(parsed, "target");
  const scope = stringFlag(parsed, "scope");
  const dir = dirFlag(parsed);
  if (target) {
    parts.push("--target", quoteShellArg(target));
  }
  if (scope) {
    parts.push("--scope", quoteShellArg(scope));
  }
  if (dir) {
    parts.push("--dir", quoteShellArg(dir));
  }
  if (parsed.flags.yes === true) {
    parts.push("--yes");
  }
  return parts.join(" ");
}

async function handleDelete(parsed: ParsedArgs, io: CliIo): Promise<number> {
  rejectExtraInput(parsed, {
    maxPositionals: 3,
    message: "workbench skill delete accepts one OWNER/SKILL or URL argument.",
    remediation: "workbench skill delete OWNER/SKILL --dry-run",
  });
  const sourceInput = requiredPositional(
    parsed,
    2,
    "workbench skill delete requires OWNER/SKILL or a Workbench Cloud skill URL.",
    "workbench skill delete OWNER/SKILL --dry-run",
  );
  const sourceUrl = await resolveWorkbenchCloudSkillUrl(
    sourceInput,
    "workbench skill delete",
    "workbench skill delete OWNER/SKILL --dry-run",
  );
  const source = parseWorkbenchInstallSource(sourceUrl);
  if (!source) {
    throw new WorkbenchCodedError("usage", "workbench skill delete requires a Workbench Cloud skill URL.", {
      remediation: "workbench skill delete OWNER/SKILL --dry-run",
      exitCode: 2,
    });
  }
  const handle = `${source.owner}/${source.skill}`;
  if (source.version) {
    throw new WorkbenchCodedError("usage", "workbench skill delete removes an entire Cloud skill project, not one published version.", {
      remediation: `workbench skill unpublish ${source.version}`,
      subject: { handle, version: source.version },
      exitCode: 2,
    });
  }
  if (!await workbenchCloudToken({ baseUrl: source.baseUrl })) {
    throw new WorkbenchCodedError("auth_required", "workbench skill delete requires Workbench Cloud auth.", {
      remediation: workbenchLoginRemediation(source.baseUrl),
      subject: { handle, baseUrl: source.baseUrl },
      exitCode: 1,
    });
  }
  const skill = await getCloudSkillByHandle(source.baseUrl, source.owner, source.skill);
  if (!skill?.id) {
    throw new WorkbenchCodedError("remote_not_found", `Workbench Cloud skill not found: ${handle}.`, {
      remediation: "workbench skill publish --as OWNER/SKILL",
      subject: { handle, baseUrl: source.baseUrl },
      exitCode: 1,
    });
  }
  const dryRun = parsed.flags["dry-run"] === true;
  const next = dryRun ? `workbench skill delete ${handle} --yes` : null;
  if (dryRun) {
    return emitResult("workbench.cli.skill-delete.v1", {
      handle,
      skillId: skill.id,
      baseUrl: source.baseUrl,
      dryRun: true,
      next,
    }, parsed, io, () => [
      `Would delete Workbench Cloud skill project ${handle}.`,
      "Dry run made no changes.",
      `next: ${next}`,
    ].join("\n"));
  }
  if (parsed.flags.yes !== true) {
    throw new WorkbenchCodedError("confirmation_required", `Deleting Workbench Cloud skill project ${handle} requires --yes.`, {
      remediation: `workbench skill delete ${handle} --yes`,
      subject: { handle, skillId: skill.id, baseUrl: source.baseUrl },
      exitCode: 2,
    });
  }
  writeCliProgress(parsed, io, `workbench skill delete: deleting Cloud skill project ${handle}.`);
  await apiRequest<{ ok: boolean }>(
    `/api/workbench/skills/${encodeURIComponent(skill.id)}`,
    { method: "DELETE" },
    source.baseUrl,
  );
  const localState = await clearDeletedWorkbenchCloudProjectLocalState({
    ...(parsed.flags.dir ? { dir: String(parsed.flags.dir) } : {}),
    baseUrl: source.baseUrl,
    handle,
  });
  return emitResult("workbench.cli.skill-delete.v1", {
    handle,
    skillId: skill.id,
    baseUrl: source.baseUrl,
    deleted: true,
    localState: localState,
    next: null,
  }, parsed, io, () => [
    `Deleted Workbench Cloud skill project ${handle}.`,
    "Published packages, hosted runs, and synced objects for that Cloud project are no longer available.",
    ...(localState.removedRemotes.length > 0 || localState.clearedPublication
      ? [`Cleared local publication state for ${handle}.`]
      : []),
  ].join("\n"));
}

async function handleSkills(parsed: ParsedArgs, io: CliIo): Promise<number> {
  rejectExtraInput(parsed, {
    maxPositionals: 2,
    message: "workbench skill list does not accept positional arguments.",
    remediation: "workbench skill list",
  });
  const inventory = await readInstalledSkillsInventory({
    target: stringFlag(parsed, "target"),
    scope: stringFlag(parsed, "scope"),
    dir: dirFlag(parsed),
  });
  return emitResult("workbench.cli.skill-list.v2", installedInventoryToJson(inventory), parsed, io, (format) => formatInstalledInventory(inventory, format));
}

async function handleCase(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const subcommand = requiredPositional(parsed, 2, "workbench eval case requires draft.");
  if (subcommand !== "draft") {
    throw new WorkbenchCodedError("usage", `Unsupported case command: ${subcommand}`, {
      remediation: "workbench eval case draft [CASE_ID]",
      exitCode: 2,
    });
  }
  rejectExtraInput(parsed, {
    maxPositionals: 4,
    message: "workbench eval case draft accepts at most one case id.",
    remediation: "workbench eval case draft case-001",
  });
  const core = await coreOptions(parsed);
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const evalSnapshot = snapshot.evals[0];
  if (!evalSnapshot) {
    throw new WorkbenchCodedError("eval_not_configured", "No evaluation is configured.", {
      remediation: "workbench skill init",
      exitCode: 2,
    });
  }
  const caseId = optionalPositional(parsed, 3) ?? nextEvalCaseId(snapshot);
  assertDraftCaseId(caseId);
  const grader = stringFlag(parsed, "grader");
  const files = workbenchDraftEvalCaseFiles(caseId, {
    defaultGrade: evalSnapshot.grade,
    ...(grader ? { grade: { adapter: grader } } : {}),
  });
  for (const file of files) {
    const target = path.join(snapshot.root, file.path);
    if (await pathExists(target)) {
      throw new WorkbenchCodedError("case_exists", `Eval case file already exists: ${file.path}`, {
        remediation: `workbench eval case draft ${nextEvalCaseId(snapshot, new Set([caseId]))}`,
        subject: { caseId, path: file.path },
        exitCode: 2,
      });
    }
  }
  for (const file of files) {
    const target = path.join(snapshot.root, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, "utf8");
    if (file.executable) {
      await fs.chmod(target, 0o755);
    }
  }
  const editFiles = draftCaseEditFiles(files);
  const next = draftCaseEditCommand(editFiles);
  const harnessPath = caseDraftHarnessPath(files);
  return emitResult("workbench.cli.eval-case-draft.v1", {
    caseId,
    files: files.map((file) => file.path),
    editFiles: editFiles.map((file) => file.path),
    ...(harnessPath ? { harnessPath } : {}),
    next,
  }, parsed, io, () => [
    `Drafted eval case ${caseId}.`,
    ...files.map((file) => `  ${file.path}`),
    `next: ${next}`,
  ].join("\n"));
}

async function handleEvalGrader(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const action = optionalPositional(parsed, 2);
  if (action === undefined) {
    rejectExtraInput(parsed, {
      maxPositionals: 2,
      message: "workbench eval grader does not accept extra arguments.",
      remediation: "workbench eval grader",
    });
    const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(await coreOptions(parsed));
    const evalSnapshot = snapshot.evals[0];
    if (!evalSnapshot) {
      throw new WorkbenchCodedError("eval_not_configured", "No evaluation is configured.", {
        remediation: "workbench skill init",
        exitCode: 2,
      });
    }
    return emitResult("workbench.cli.eval-grader.v1", {
      path: "eval.yaml",
      evaluationHash: evalSnapshot.hash,
      grader: evalDefaultGraderManifest(evalSnapshot),
      next: "workbench eval run",
    }, parsed, io, () => formatEvalDefaultGrader(evalSnapshot));
  }
  if (action !== "set") {
    throw new WorkbenchCodedError("usage", `Unsupported eval grader command: ${action}`, {
      remediation: "workbench eval grader | workbench eval grader set ADAPTER",
      exitCode: 2,
    });
  }
  rejectExtraInput(parsed, {
    maxPositionals: 4,
    message: "workbench eval grader set accepts one adapter.",
    remediation: "workbench eval grader set tests",
  });
  const adapter = requiredPositional(
    parsed,
    3,
    "workbench eval grader set requires an adapter.",
    "workbench eval grader set tests",
  ).trim().toLowerCase();
  const authoring = await readEvalGraderAuthoringFlags(parsed);
  const core = await coreOptions(parsed);
  const files = await writeWorkbenchEvaluationGradeSourceFiles({
    ...core,
    mutation: {
      adapter,
      ...(authoring ? { authoring } : {}),
    },
  });
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const evalSnapshot = snapshot.evals[0];
  const writtenPath = files[0]?.path.replace(/^\.workbench\//u, "") ?? "eval.yaml";
  return emitResult("workbench.cli.eval-grader.v1", {
    path: writtenPath,
    evaluationHash: evalSnapshot?.hash,
    ...(evalSnapshot ? { grader: evalDefaultGraderManifest(evalSnapshot) } : {}),
    next: "workbench eval run",
  }, parsed, io, () => [
    `Set default grader to ${evalSnapshot?.grade.label ?? adapter}.`,
    `  ${writtenPath}`,
    ...(evalSnapshot ? [`Hash: ${evalSnapshot.hash}`] : []),
    "next: workbench eval run",
  ].join("\n"));
}

async function readEvalGraderAuthoringFlags(parsed: ParsedArgs): Promise<Record<string, Json> | undefined> {
  const authoringJson = stringFlag(parsed, "authoring-json");
  const authoringFile = stringFlag(parsed, "authoring-file");
  const authoringPairs = repeatStringFlag(parsed, "authoring");
  const sourceCount = [
    authoringJson,
    authoringFile,
    authoringPairs && authoringPairs.length > 0 ? authoringPairs : undefined,
  ].filter(Boolean).length;
  if (sourceCount > 1) {
    throw new WorkbenchCodedError("usage", "Use only one eval grader authoring source.", {
      remediation: "Use --authoring, --authoring-json, or --authoring-file.",
      exitCode: 2,
    });
  }
  if (authoringJson !== undefined) {
    return parseAuthoringJsonRecord(authoringJson, "--authoring-json");
  }
  if (authoringFile !== undefined) {
    const filePath = path.resolve(authoringFile);
    return parseAuthoringJsonRecord(await fs.readFile(filePath, "utf8"), authoringFile);
  }
  if (!authoringPairs || authoringPairs.length === 0) {
    return undefined;
  }
  return Object.fromEntries(authoringPairs.map((entry) => {
    const eq = entry.indexOf("=");
    if (eq === -1) {
      throw new WorkbenchCodedError("usage", `Eval grader authoring entry must be name=value: ${entry}`, {
        remediation: "workbench eval grader set command --authoring 'command=...'",
        exitCode: 2,
      });
    }
    return [entry.slice(0, eq), parseScalar(entry.slice(eq + 1))];
  }));
}

function parseAuthoringJsonRecord(source: string, label: string): Record<string, Json> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    throw new WorkbenchUserError(`${label} must be a JSON object: ${error instanceof Error ? error.message : String(error)}`);
  }
  const record = asRecord(parsed);
  if (!record) {
    throw new WorkbenchUserError(`${label} must be a JSON object.`);
  }
  return record as Record<string, Json>;
}

function formatEvalDefaultGrader(evalSnapshot: WorkbenchEvalSnapshot): string {
  const grade = evalSnapshot.grade;
  return [
    `Default grader: ${grade.label}`,
    `Summary: ${grade.summary}`,
    `Adapter: ${grade.adapter}`,
    `Source: ${grade.sources.map((source) => source.path).join(", ") || "eval.yaml"}`,
  ].join("\n");
}

function evalDefaultGraderManifest(evalSnapshot: WorkbenchEvalSnapshot) {
  const grade = evalSnapshot.grade;
  return {
    adapter: grade.adapter,
    adapterSource: grade.adapterSource,
    label: grade.label,
    summary: grade.summary,
    sources: grade.sources,
    display: grade.display,
  };
}

function draftCaseEditFiles(
  files: readonly SurfaceSnapshotFile[],
): SurfaceSnapshotFile[] {
  return [...files];
}

function draftCaseEditCommand(files: readonly SurfaceSnapshotFile[]): string {
  return [EDITOR_COMMAND, ...files.map((file) => file.path)].join(" ");
}

function caseDraftHarnessPath(files: readonly SurfaceSnapshotFile[]): string | undefined {
  return files.find((file) => isDraftCaseHarnessPath(file.path))?.path;
}

function isDraftCaseHarnessPath(filePath: string): boolean {
  return filePath.endsWith("/tests/test.sh");
}

function assertDraftCaseId(caseId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(caseId)) {
    throw new WorkbenchCodedError("usage", "workbench eval case draft expects a path-safe case id.", {
      remediation: "workbench eval case draft case-001",
      subject: { caseId },
      exitCode: 2,
    });
  }
}

async function handleClone(parsed: ParsedArgs, io: CliIo): Promise<number> {
  rejectExtraInput(parsed, {
    maxPositionals: 4,
    message: "workbench skill clone accepts one source and one destination directory.",
    remediation: "workbench skill clone OWNER/SKILL[@VERSION]|URL DIR",
  });
  const sourceInput = requiredPositional(
    parsed,
    2,
    "workbench skill clone requires OWNER/SKILL or a Workbench Cloud skill URL.",
    "workbench skill clone OWNER/SKILL[@VERSION] DIR",
  );
  const destination = requiredPositional(
    parsed,
    3,
    "workbench skill clone requires a destination directory.",
    "workbench skill clone OWNER/SKILL[@VERSION] DIR",
  );
  const source = await resolveWorkbenchCloudSkillUrl(
    sourceInput,
    "workbench skill clone",
    "workbench skill clone OWNER/SKILL[@VERSION] DIR",
  );
  const workbenchSource = parseWorkbenchInstallSource(source);
  if (!workbenchSource) {
    throw new WorkbenchCodedError("usage", "workbench skill clone requires a Workbench Cloud skill URL.", {
      remediation: "workbench skill clone OWNER/SKILL[@VERSION]|URL DIR",
      exitCode: 2,
    });
  }
  const snapshot = await fetchWorkbenchSkillPackage(workbenchSource, source, {
    packageVersionNotFoundRemediation: cloneCurrentPublishedPackageCommand(workbenchSource, sourceInput, destination),
  });
  const packageFiles = editableWorkbenchSkillFiles(snapshot);
  const authStoreRoot = adapterAuthStoreRoot();
  const root = await prepareCloneDestination(destination);
  const hydratedPaths = await hydrateWorkbenchProjectFromPackage(root, packageFiles);
  const hydratedStatus = await initializeHydratedWorkbenchSkillProject({ dir: root, adapterAuthStoreRoot: authStoreRoot });
  const project: CloneProjectResult = {
    root: hydratedStatus.root,
    initialized: true,
    runtimeState: {
      initialized: "fresh",
      copiedFromPackage: false,
    },
    ...(hydratedStatus.currentVersionId ? { currentVersionId: hydratedStatus.currentVersionId } : {}),
    ...(hydratedStatus.defaultAgent ? { defaultAgent: hydratedStatus.defaultAgent } : {}),
  };
  const hydratedSnapshot = await createWorkbenchReadOnlyInspectionSnapshot({ dir: root });
  const next = snapshotHasAnyEvalCase(hydratedSnapshot)
    ? "workbench eval run"
    : projectScopedNextCommand(root, authorEvalCaseCommand(hydratedSnapshot));
  return emitResult("workbench.cli.skill-clone.v1", {
    result: project,
    source: workbenchInstallSourceSummary(snapshot),
    hydratedPaths: hydratedPaths,
    defaultAgent: project.defaultAgent,
    next: next,
  }, parsed, io, () => formatCloneResult(project, snapshot, hydratedPaths, next));
}

async function prepareCloneDestination(destination: string): Promise<string> {
  const root = path.resolve(destination);
  try {
    const entries = await fs.readdir(root);
    if (entries.length > 0) {
      throw new WorkbenchCodedError("usage", `Directory is not empty: ${root}`, {
        remediation: "workbench skill clone OWNER/SKILL[@VERSION]|URL DIR",
        subject: { root },
        exitCode: 2,
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  await fs.mkdir(root, { recursive: true });
  return root;
}

function editableWorkbenchSkillFiles(snapshot: WorkbenchSkillPackageSnapshot): SurfaceSnapshotFile[] {
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
    throw new WorkbenchCodedError("install_failed", `Workbench skill package ${snapshot.owner}/${snapshot.name} does not contain SKILL.md.`, {
      subject: { source: `${snapshot.owner}/${snapshot.name}` },
      exitCode: 1,
    });
  }
  return files;
}

async function hydrateWorkbenchProjectFromPackage(root: string, files: readonly SurfaceSnapshotFile[]): Promise<string[]> {
  for (const file of files) {
    await writePackageSnapshotFile(root, file);
  }
  return files.map((file) => file.path);
}

function isEditableWorkbenchSourcePath(filePath: string): boolean {
  return isWorkbenchPackageSourcePath(normalizeInstallSnapshotPath(filePath));
}

async function writePackageSnapshotFile(root: string, file: SurfaceSnapshotFile): Promise<void> {
  const filePath = path.join(root, file.path);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, file.encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content));
  if (file.executable) {
    await fs.chmod(filePath, 0o755);
  }
}

async function handleCloudEvalLike(command: "run" | "grade", parsed: ParsedArgs, io: CliIo): Promise<number> {
  const started = await startCloudExecution(command, parsed, io);
  if (started.detached) {
    const next = cloudDetachedNextCommand(started.run);
    return emitCloudDetached(command, {
      run: runSnapshotResultJson(started.run),
      next: next,
      cloud: cloudExecutionSummary(started),
    }, parsed, io, () => [
      `Detached from hosted ${command} on ${started.remote.url}.`,
      formatRunSnapshot(started.run),
      ...(next ? [`next: ${next}`] : []),
    ].filter(Boolean).join("\n"));
  }
  const { run, jobs, traces } = await localRunStateForSnapshot(started.core, started.run);
  const runs = [run];
  const snapshot = createWorkbenchRunSnapshotForRun(run, jobs, { traces });
  const artifactIds = await artifactIdsByRunId(started.core, runs);
  const failedRuns = runs.filter((entry) => entry.status === "failed" || entry.status === "canceled");
  const coverage = await evalCoverageSummaries(started.core, runs);
  const deltas = await evalDeltas(started.core, runs);
  if (failedRuns.length > 0) {
    return emitEvalFailure(command, snapshot, failedRuns, artifactIds, coverage, deltas, parsed, io);
  }
  const next = command === "run"
    ? operationTransitionNextCommand("grade", parsed, parsed.flags.cloud === true)
    : await evalSuccessNextCommand(started.core, runs);
  return emitResult(`workbench.cli.eval-${command}.v1`, {
    run: runSnapshotResultJson(snapshot),
    coverage: coverage,
    deltas: deltas,
    next: next,
    cloud: cloudExecutionSummary(started),
  }, parsed, io, () => [
    `Completed hosted ${command} on ${started.remote.url}.`,
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
      next: next,
      cloud: cloudExecutionSummary(started),
    }, parsed, io, () => [
      `Detached from hosted improve on ${started.remote.url}.`,
      formatRunSnapshot(started.run),
      ...(next ? [`next: ${next}`] : []),
    ].filter(Boolean).join("\n"));
  }
  const { run, jobs, traces } = await localRunStateForSnapshot(started.core, started.run);
  const snapshot = createWorkbenchRunSnapshotForRun(run, jobs, { traces });
  const runs = [run];
  const failedRuns = runs.filter((entry) => entry.status === "failed" || entry.status === "canceled");
  if (failedRuns.length > 0) {
    const first = failedRuns[0]!;
    throw new WorkbenchCodedError("improve_failed", "Hosted improve failed; evidence was saved.", {
      remediation: `workbench eval show ${first.id}`,
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
  return emitResult("workbench.cli.skill-improve.v1", {
    run: runSnapshotResultJson(snapshot),
    ...(switchedVersion ? { version: versionSummary(switchedVersion) } : {}),
    switched: Boolean(switchedVersion),
    promoted: Boolean(switchedVersion),
    next: next,
    cloud: cloudExecutionSummary(started),
  }, parsed, io, () => [
    `Completed hosted improve on ${started.remote.url}.`,
    formatRunSnapshot(snapshot),
    ...(switchedVersion ? [`Switched local source to ${displayRef(switchedVersion.id)}.`] : []),
    ...(next ? [`next: ${next}`] : []),
  ].filter(Boolean).join("\n"));
}

function emitCloudDetached<Body extends Record<string, unknown>>(
  command: WorkbenchRunKind,
  body: JsonSerializable<Body> & { next?: string | null },
  parsed: ParsedArgs,
  io: CliIo,
  text: (format: HumanFormatOptions) => string,
): number {
  const next = typeof body.next === "string" ? body.next : "workbench eval results";
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
    io.stdout.write(`${text(humanFormatOptions(io.stdout))}\n`);
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
  result: WorkbenchInstallResult,
  dryRun: boolean,
  next: string | null = null,
): string {
  const targetSummary = `${result.target} ${result.scope}`;
  if (dryRun) {
    const nextLine = next ? `\nnext: ${next}` : "";
    if (result.previous === "unchanged") {
      return result.metadataChanged
        ? `Would update install metadata for ${result.skill} on ${targetSummary} (package files unchanged; dry run made no changes).${nextLine}`
        : `Already installed ${result.skill} for ${targetSummary} (unchanged; dry run made no changes).`;
    }
    if (result.previous === "updated") {
      return `Would update ${result.skill} for ${targetSummary} (dry run made no changes).${nextLine}`;
    }
    if (result.previous === "modified" || result.previous === "unmanaged") {
      return result.requiresOverwrite
        ? `Would require --yes to overwrite ${result.skill} for ${targetSummary} (dry run made no changes).${nextLine}`
        : `Would overwrite ${result.skill} for ${targetSummary} (dry run made no changes).${nextLine}`;
    }
    return `Would install ${result.skill} for ${targetSummary} (dry run made no changes).${nextLine}`;
  }
  if (result.result === "unchanged") {
    const nextLine = next ? `\nnext: ${next}` : "";
    return `Already installed ${result.skill} for ${targetSummary} (unchanged).${nextLine}`;
  }
  const nextLine = next ? `\nnext: ${next}` : "";
  if (result.previous === "unchanged" && result.metadataChanged) {
    return `Updated install metadata for ${result.skill} on ${targetSummary} (package files unchanged).${nextLine}`;
  }
  if (result.previous === "updated") {
    return `Updated ${result.skill} for ${targetSummary} (${formatFileCount(result.filesCopied)}).${nextLine}`;
  }
  const detail = result.previous === "modified" || result.previous === "unmanaged"
    ? `overwrote ${result.previous} copy, ${formatFileCount(result.filesCopied)}`
    : formatFileCount(result.filesCopied);
  return `Installed ${result.skill} for ${targetSummary} (${detail}).${nextLine}`;
}

function formatFileCount(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

async function startCloudExecution(command: WorkbenchRunKind, parsed: ParsedArgs, io: CliIo): Promise<StartedCloudExecution> {
  const root = dirFlag(parsed) ?? process.cwd();
  const startedAtMs = Date.now();
  const renderer = createProgressRenderer({ stderr: io.stderr, json: parsed.flags.json === true });
  const renderCloudProgress = (
    phase: WorkbenchProgressPhase,
    runs: readonly WorkbenchRun[] = [],
    jobs: readonly WorkbenchJob[] = [],
  ): void => {
    if (parsed.flags.json === true) {
      return;
    }
    renderer.render(runProgressSnapshotFromRuns({
      command,
      location: "cloud",
      phase,
      runs,
      jobs,
      startedAtMs,
      next: null,
    }), { command });
  };
  const interrupt = createCloudInterruptController(command, io);
  try {
    const link = await cloudPreScheduleStep(command, interrupt, cloudRemoteLinkTarget(root));
    const plannedRemote = link.existing ?? await cloudPreScheduleStep(
      command,
      interrupt,
      derivePublishCloudRemote(parsed, `${workbenchOperationInvocation(command)} --cloud`, link.name),
    );
    const plannedSource = requiredWorkbenchCloudRemoteSource(plannedRemote);
    const token = await workbenchCloudToken({ baseUrl: plannedSource.baseUrl });
    if (!token) {
      throw new WorkbenchCodedError("auth_required", `${workbenchOperationInvocation(command)} --cloud requires Workbench Cloud auth.`, {
        remediation: workbenchLoginRemediation(plannedSource.baseUrl),
        exitCode: 1,
      });
    }
    const core = { dir: root, authToken: token };
    const preparedImproveRequest = command === "improve"
      ? await cloudPreScheduleStep(command, interrupt, prepareWorkbenchCloudImproveRequest({
          ...core,
          skill: stringFlag(parsed, "versions"),
          agent: stringFlag(parsed, "agents"),
          samples: intFlag(parsed, "samples"),
          budget: intFlag(parsed, "budget"),
        }))
      : undefined;
    const preview = command !== "improve"
      ? await cloudPreScheduleStepWithProgress(command, interrupt, previewWorkbenchEval({
          ...core,
          skill: stringFlag(parsed, "versions"),
          agent: stringFlag(parsed, "agents"),
          caseIds: stringListFlag(parsed, "cases"),
          samples: intFlag(parsed, "samples"),
          kind: command,
          rerun: parsed.flags.rerun === true,
          cloud: true,
        }), () => renderCloudProgress("preflight"))
      : await cloudPreScheduleStepWithProgress(command, interrupt, previewWorkbenchImprove({
          ...core,
          skill: stringFlag(parsed, "versions"),
          agent: stringFlag(parsed, "agents"),
          samples: intFlag(parsed, "samples"),
          budget: intFlag(parsed, "budget"),
          cloud: true,
        }), () => renderCloudProgress("preflight"));
    assertWorkbenchLaunchReadinessReady(preview.readiness);
    const adapterAuthTargets = cloudAdapterAuthTargetsFromPreview(preview);
    if (adapterAuthTargets.length > 0) {
      await cloudPreScheduleStepWithProgress(command, interrupt, async (signal) => await assertCloudAdapterAuthConnected({
        baseUrl: plannedSource.baseUrl,
        targets: adapterAuthTargets,
        signal,
      }), () => renderCloudProgress("provider_auth"));
    }
    const config = await loadConfig();
    const targetReadiness = await cloudPreScheduleStep(command, interrupt, cloudHostedOperationRemoteReadiness({
      command,
      config,
      remote: plannedRemote,
      linked: Boolean(link.existing),
    }));
    assertWorkbenchLaunchReadinessReady(targetReadiness);
    const runId = createWorkbenchRunId();
    const pendingOperation: WorkbenchPendingCloudOperation = {
      schema: "workbench.pending-cloud-operation.v1",
      id: runId,
      command,
      remoteName: plannedRemote.name,
      createdAt: new Date().toISOString(),
    };
    let preparedVersionId: string | undefined;
    const { remote, source, run: response, skillId, syncBefore } = await acceptHostedOperation({
      command,
      core,
      interrupt,
      io,
      json: parsed.flags.json === true,
      pendingOperation,
      renderPreflight: () => renderCloudProgress("preflight"),
      prepare: async () => {
        const remote = await cloudPreScheduleStepWithLocalCancel(
          command,
          interrupt,
          core,
          pendingOperation,
          async (signal) => await ensureCloudRemoteForExecution(root, parsed, () => renderCloudProgress("preflight"), signal),
        );
        const source = requiredWorkbenchCloudRemoteSource(remote);
        const requestWithoutRunId = command !== "improve"
          ? await cloudPreScheduleStepWithProgress(command, interrupt, prepareWorkbenchCloudEvalRequest({
              ...core,
              skill: stringFlag(parsed, "versions"),
              agent: stringFlag(parsed, "agents"),
              caseIds: stringListFlag(parsed, "cases"),
              samples: intFlag(parsed, "samples"),
              kind: command,
              rerun: parsed.flags.rerun === true,
            }), () => renderCloudProgress("preflight"))
          : preparedImproveRequest!;
        preparedVersionId = cloudOperationVersionId(requestWithoutRunId);
        if (preparedVersionId !== preview.versionId) {
          throw new WorkbenchCodedError("source_changed", `Source changed while preparing hosted ${command}.`, {
            remediation: `${workbenchOperationInvocation(command)} --cloud`,
            subject: {
              ...(preview.versionId !== undefined ? { plannedVersionId: preview.versionId } : {}),
              ...(preparedVersionId !== undefined ? { preparedVersionId } : {}),
            },
            exitCode: 1,
          });
        }
        return { remote, source, request: { ...requestWithoutRunId, runId } };
      },
      missingRunMessage: `Workbench Cloud did not return a run for ${command}.`,
      missingRunRemediation: "workbench eval results",
      missingRunSubject: ({ remote, skillId }) => ({ remote: remote.name, skillId }),
    });
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
	      ...(preparedVersionId !== undefined ? { startVersionId: preparedVersionId } : {}),
	      source,
	      sync: {
        before: { pushed: syncBefore.pushed, pulled: syncBefore.pulled, upToDate: syncBefore.upToDate },
        after: { pushed: completed.sync.pushed, pulled: completed.sync.pulled, upToDate: completed.sync.upToDate },
      },
    };
  } catch (error) {
    throw command === "improve" ? await cloudImproveErrorWithHostedRemediation(error, parsed) : error;
  } finally {
    interrupt.dispose();
  }
}

function hostedRunErrorWithContext(error: unknown, runId: string): WorkbenchCodedError {
  const coded = codedErrorFromUnknown(error);
  return new WorkbenchCodedError(coded.code, coded.message, {
    retryable: coded.retryable,
    ...(coded.remediation ? { remediation: coded.remediation } : {}),
    subject: {
      ...(coded.subject ?? {}),
      correlationRunId: runId,
    },
    exitCode: coded.exitCode,
  });
}

async function cloudImproveErrorWithHostedRemediation(error: unknown, parsed: ParsedArgs): Promise<unknown> {
  if (!(error instanceof WorkbenchCodedError) || !error.remediation) {
    return error;
  }
  let remediation = error.remediation.replace(/(^|&&\s*)workbench skill improve(?!\s+--cloud)\b/gu, "$1workbench skill improve --cloud");
  if (remediation.includes("workbench skill improve --cloud") && !hasWorkbenchCloudLoginCommand(remediation)) {
    const config = await loadConfig();
    const baseUrl = selectWorkbenchBaseUrl({
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
  readonly runId: string | undefined;
  setRunId(runId: string): void;
  dispose(): void;
}

function createCloudInterruptController(
  command: WorkbenchProgressCommand,
  io: CliIo,
): CloudInterruptController {
  let interrupted = false;
  let runId: string | undefined;
  let resolveSignal: () => void = () => undefined;
  const signal = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });
  const onSigint = (): void => {
    interrupted = true;
    if (runId) {
      io.stderr.write(`${workbenchOperationInvocation(command)}: detaching from hosted run (${displayRef(runId)}).\n`);
    }
    resolveSignal();
  };
  process.once("SIGINT", onSigint);
  return {
    signal,
    get interrupted() {
      return interrupted;
    },
    get runId() {
      return runId;
    },
    setRunId(nextRunId: string) {
      runId = nextRunId;
    },
    dispose() {
      process.off("SIGINT", onSigint);
    },
  };
}

async function cloudPreScheduleStep<T>(
  command: WorkbenchProgressCommand,
  interrupt: CloudInterruptController,
  step: Promise<T> | ((signal: AbortSignal) => Promise<T>),
): Promise<T> {
  if (interrupt.interrupted) {
    throw cloudInterruptedBeforeScheduleFinishedError(command, interrupt.runId);
  }
  const abortController = new AbortController();
  const stepPromise = typeof step === "function" ? step(abortController.signal) : step;
  return await Promise.race([
    stepPromise,
    interrupt.signal.then(() => {
      abortController.abort();
      throw cloudInterruptedBeforeScheduleFinishedError(command, interrupt.runId);
    }),
  ]).finally(() => {
    if (interrupt.interrupted) {
      abortController.abort();
    }
  });
}

async function cloudPreScheduleStepWithLocalCancel<T>(
  command: WorkbenchProgressCommand,
  interrupt: CloudInterruptController,
  core: { dir?: string; authToken?: string },
  operation: WorkbenchPendingCloudOperation,
  step: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const abortController = new AbortController();
  let stopped = false;
  const cancelSignal = (async (): Promise<T> => {
    while (!stopped) {
      if (await hasWorkbenchLocalRunCancellationRequest({ ...core, runId: operation.id })) {
        await abortIfPendingCloudOperationCanceled(core, operation);
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
  step: Promise<T> | ((signal: AbortSignal) => Promise<T>),
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
  await clearWorkbenchPendingCloudOperation({ ...input.core, operationId: input.run.id }).catch(() => undefined);
  throw new WorkbenchCodedError("cloud_canceled", `Hosted ${input.command} was canceled after Workbench Cloud accepted the run.`, {
    remediation: `workbench eval show ${input.run.id}`,
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

async function abortIfPendingCloudOperationCanceled(
  core: { dir?: string; authToken?: string },
  operation: WorkbenchPendingCloudOperation,
): Promise<void> {
  if (!await hasWorkbenchLocalRunCancellationRequest({ ...core, runId: operation.id })) {
    return;
  }
  await clearWorkbenchPendingCloudOperation({ ...core, operationId: operation.id });
  throw new WorkbenchCodedError("cloud_canceled", `Hosted ${operation.command} was canceled before Workbench Cloud accepted it.`, {
    subject: { operationId: operation.id },
    exitCode: 130,
  });
}

function cloudCanceledBeforeRunIdError(command: WorkbenchProgressCommand): WorkbenchCodedError {
  return new WorkbenchCodedError("cloud_canceled", `Hosted ${command} was canceled before Workbench Cloud returned a run id.`, {
    remediation: hostedCommandRemediation(command),
    exitCode: 130,
  });
}

function cloudInterruptedBeforeScheduleFinishedError(command: WorkbenchProgressCommand, runId: string | undefined): WorkbenchCodedError {
  if (!runId) {
    return cloudCanceledBeforeRunIdError(command);
  }
  return new WorkbenchCodedError("cloud_detached", `Detached from hosted ${command} before Workbench Cloud confirmed scheduling.`, {
    retryable: true,
    remediation: `workbench watch ${runId}`,
    subject: { runId },
    exitCode: 130,
  });
}

function hostedCommandRemediation(command: WorkbenchProgressCommand): string {
  if (command === "run" || command === "grade" || command === "eval" || command === "improve") {
    return `${workbenchOperationInvocation(command)} --cloud`;
  }
  return "workbench eval results";
}

async function assertCloudAdapterAuthConnected(input: {
  baseUrl: string;
  targets: readonly CloudAdapterAuthTarget[];
  signal?: AbortSignal;
}): Promise<void> {
  const readiness = await cloudAdapterAuthReadiness(input);
  assertWorkbenchLaunchReadinessReady(readiness);
}

async function cloudDryRunReadiness(
  command: WorkbenchRunKind,
  parsed: ParsedArgs,
  preview: WorkbenchEvalPreview | WorkbenchImprovePreview,
): Promise<WorkbenchLaunchReadiness> {
  const config = await loadConfig();
  const baseUrl = selectWorkbenchBaseUrl({ configBaseUrl: config.baseUrl });
  const token = await workbenchCloudToken();
  if (!token) {
    return mergeLaunchReadiness(readinessFromLaunchIssues([{
        code: "auth_required",
        message: `${workbenchOperationInvocation(command)} --dry-run --cloud requires Workbench Cloud auth.`,
        remediation: workbenchLoginRemediation(baseUrl),
      }]), preview.readiness);
  }
  if (preview.readiness.issues.some((issue) => issue.code === "improve_adapter_required")) {
    return preview.readiness;
  }
  const targets = cloudAdapterAuthTargetsFromPreview(preview);
  const targetReadiness = await cloudHostedOperationTargetReadiness({ command, parsed, config });
  const adapterReadiness = await cloudAdapterAuthReadiness({ baseUrl, targets });
  return mergeLaunchReadiness(targetReadiness, adapterReadiness, preview.readiness);
}

async function cloudHostedOperationTargetReadiness(input: {
  command: WorkbenchRunKind;
  parsed: ParsedArgs;
  config: WorkbenchConfig;
}): Promise<WorkbenchLaunchReadiness> {
  const root = path.resolve(dirFlag(input.parsed) ?? process.cwd());
  let remote: WorkbenchRemote;
  let linked = false;
  try {
    const link = await cloudRemoteLinkTarget(root);
    linked = Boolean(link.existing);
    remote = link.existing ?? await derivePublishCloudRemote(input.parsed, `${workbenchOperationInvocation(input.command)} --cloud`, link.name);
  } catch (error) {
    if (error instanceof WorkbenchCodedError) {
      return readinessFromLaunchIssues([readinessIssueFromCodedError(error)]);
    }
    throw error;
  }

  return await cloudHostedOperationRemoteReadiness({
    command: input.command,
    config: input.config,
    remote,
    linked,
  });
}

async function cloudHostedOperationRemoteReadiness(input: {
  command: WorkbenchRunKind;
  config: WorkbenchConfig;
  remote: WorkbenchRemote;
  linked: boolean;
}): Promise<WorkbenchLaunchReadiness> {
  const source = parseWorkbenchInstallSource(input.remote.url);
  if (!source) {
    return readinessFromLaunchIssues([{
      code: "remote_invalid_url",
      message: `Workbench remote is not a Cloud skill URL: ${input.remote.url}`,
      remediation: "workbench skill publish",
      subject: { remote: input.remote.name, url: input.remote.url },
    }]);
  }

  const personalOwner = input.config.username ? normalizeWorkbenchSkillName(input.config.username) : "";
  const isPersonalOwner = source.owner === personalOwner;
  if (!input.linked && isPersonalOwner) {
    return readinessFromLaunchIssues([personalHostedOperationPlanIssue(input.command, source.owner, input.remote.name)]);
  }

  const existing = await getCloudSkillByHandle(source.baseUrl, source.owner, source.skill);
  if (existing) {
    if (existing.ownerKind !== "organization") {
      return readinessFromLaunchIssues([personalHostedOperationPlanIssue(input.command, source.owner, input.remote.name)]);
    }
    return await cloudOrganizationHostedOperationReadiness(source.baseUrl, existing.ownerSlug ?? source.owner);
  }

  if (isPersonalOwner) {
    return readinessFromLaunchIssues([personalHostedOperationPlanIssue(input.command, source.owner, input.remote.name)]);
  }
  return await cloudOrganizationHostedOperationReadiness(source.baseUrl, source.owner);
}

async function cloudOrganizationHostedOperationReadiness(
  baseUrl: string,
  organizationSlug: string,
): Promise<WorkbenchLaunchReadiness> {
  try {
    await apiRequest<{ organization?: unknown }>(
      `/api/workbench/organizations/${encodeURIComponent(organizationSlug)}`,
      {},
      baseUrl,
    );
    return readinessFromLaunchIssues([]);
  } catch (error) {
    if (error instanceof WorkbenchCodedError) {
      return readinessFromLaunchIssues([readinessIssueFromCodedError(error)]);
    }
    throw error;
  }
}

function readinessIssueFromCodedError(error: WorkbenchCodedError): WorkbenchLaunchReadinessIssue {
  return {
    code: error.code,
    message: error.message,
    ...(error.remediation ? { remediation: error.remediation } : {}),
    ...(error.subject ? { subject: error.subject } : {}),
  };
}

function personalHostedOperationPlanIssue(
  command: WorkbenchRunKind,
  owner: string,
  remoteName: string,
): WorkbenchLaunchReadinessIssue {
  return {
    code: "plan_required",
    message: `A Team or Enterprise organization plan is required to run hosted ${command} operations for ${owner}.`,
    remediation: `workbench skill publish --as ORG/SKILL && ${command === "eval" ? "workbench eval run" : "workbench skill improve"} --cloud`,
    subject: {
      owner,
      remote: remoteName,
      ownerKind: "user",
      requirement: "Publish under an organization-owned skill with an active Team or Enterprise plan, then rerun the hosted command.",
    },
  };
}

function mergeLaunchReadiness(...readinesses: readonly WorkbenchLaunchReadiness[]): WorkbenchLaunchReadiness {
  return readinessFromLaunchIssues(readinesses.flatMap((readiness) => readiness.issues));
}

function readinessFromLaunchIssues(issues: readonly WorkbenchLaunchReadinessIssue[]): WorkbenchLaunchReadiness {
  const sorted = readinessIssuesForNext(issues);
  return {
    ready: sorted.length === 0,
    issues: sorted,
  };
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
  signal?: AbortSignal;
}): Promise<WorkbenchLaunchReadiness> {
  const targets = uniqueAdapterAuthTargets(input.targets);
  if (targets.length === 0) {
    return { ready: true, issues: [] };
  }
  const statuses = await fetchCloudAdapterAuthStatuses(input.baseUrl, input.signal);
  const issues = targets
    .filter((target) => !statuses.some((status) => adapterAuthStatusMatchesTarget(status, target)))
    .map((target) => ({
      code: "adapter_auth_required",
      message: `${target.adapterId}${target.slot ? `/${target.slot}` : ""} disconnected.`,
      remediation: workbenchProviderAuthSetupCommand(target.adapterId),
      subject: {
        adapterId: target.adapterId,
        profile: target.profile,
        ...(target.slot ? { slot: target.slot } : {}),
        setupCommands: [workbenchProviderAuthSetupCommand(target.adapterId)],
      },
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
    byKey.set(workbenchAdapterAuthTargetIdentity(target), target);
  }
  return [...byKey.values()].sort((left, right) => workbenchAdapterAuthTargetIdentity(left).localeCompare(workbenchAdapterAuthTargetIdentity(right)));
}

async function fetchCloudAdapterAuthStatuses(baseUrl: string, signal?: AbortSignal): Promise<WorkbenchAdapterAuthStatusRecord[]> {
  const response = await apiRequest<{ adapters?: WorkbenchAdapterAuthStatusRecord[] }>(
    "/api/workbench/auth/adapters",
    { signal },
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
      remediation: "workbench eval results",
      exitCode: 1,
    });
  }
  let sync = input.initialSync;
  const timeoutMs = positiveIntEnv("WORKBENCH_CLOUD_RUN_TIMEOUT_MS") ?? CLOUD_RUN_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let runSnapshot = input.run;
  const initialEnvelope = await cloudInterruptibleStep(
    input.interrupt,
    async (signal) => await fetchCloudInspectionEnvelope(input.source.baseUrl, input.skillId, signal),
  );
  if (!initialEnvelope) {
    return { run: runSnapshot, sync, detached: true };
  }
  let envelope = initialEnvelope;
  let liveCursor = envelope.cursor;
  await recordWorkbenchCloudInspectionSnapshot({ ...input.core, remoteName: input.remote.name, snapshot: envelope.snapshot });
  let run = runForCloudInspectionEnvelope(envelope, runId) ?? workbenchRunFromSnapshot(input.run);
  let jobs = jobsForRuns(envelope.snapshot, [runId]);
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
    if (isWorkbenchRunStatusTerminal(run.status)) {
      const terminalSync = await cloudInterruptibleStep(
        input.interrupt,
        async (signal) => await withCloudProgressRendering(
          syncWorkbenchRemote({ ...input.core, remote: input.remote.name, signal }),
          renderTerminalSyncProgress,
        ),
      );
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
        remediation: `workbench watch ${runId}`,
        subject: {
          runId,
          status: run.status,
          guidance: "Use the remediation command to resume hosted progress and refresh local evidence.",
        },
        exitCode: 1,
      });
    }
    const notice = await cloudInterruptibleStep(
      input.interrupt,
      async (signal) => await withCloudProgressRendering(
        fetchCloudInspectionNotice(
          input.source.baseUrl,
          input.skillId,
          liveCursor,
          cloudInspectionNoticeWaitTimeoutMs(deadline),
          signal,
        ),
        renderCurrentProgress,
      ),
    );
    if (!notice) {
      return { run: runSnapshot, sync, detached: true };
    }
    if (input.interrupt.interrupted) {
      return { run: runSnapshot, sync, detached: true };
    }
    liveCursor = notice.cursor || liveCursor;
    if (notice.type === "heartbeat" || notice.type === "progress") {
      continue;
    }
    const nextEnvelope = await cloudInterruptibleStep(
      input.interrupt,
      async (signal) => await fetchCloudInspectionEnvelope(input.source.baseUrl, input.skillId, signal),
    );
    if (!nextEnvelope) {
      return { run: runSnapshot, sync, detached: true };
    }
    envelope = nextEnvelope;
    liveCursor = envelope.cursor;
    await recordWorkbenchCloudInspectionSnapshot({ ...input.core, remoteName: input.remote.name, snapshot: envelope.snapshot });
    run = runForCloudInspectionEnvelope(envelope, runId) ?? run;
    jobs = jobsForRuns(envelope.snapshot, [runId]);
  }
}

async function fetchCloudInspectionEnvelope(
  baseUrl: string,
  skillId: string,
  signal?: AbortSignal,
): Promise<WorkbenchInspectionSnapshotEnvelope> {
  return await apiRequest<WorkbenchInspectionSnapshotEnvelope>(
    `/api/workbench/skills/${encodeURIComponent(skillId)}/workbench/snapshot`,
    { signal },
    baseUrl,
  );
}

async function fetchCloudInspectionNotice(
  baseUrl: string,
  skillId: string,
  cursor: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<WorkbenchStateNotice> {
  return await apiRequest<WorkbenchStateNotice>(
    `/api/workbench/skills/${encodeURIComponent(skillId)}/workbench/state/wait?cursor=${encodeURIComponent(cursor)}&timeoutMs=${timeoutMs}`,
    { signal },
    baseUrl,
  );
}

async function cloudInterruptibleStep<T>(
  interrupt: CloudInterruptController,
  step: (signal: AbortSignal) => Promise<T>,
): Promise<T | null> {
  const abortController = new AbortController();
  const interrupted = { interrupted: true } as const;
  const stepPromise = step(abortController.signal);
  try {
    const result = await Promise.race<T | typeof interrupted>([
      stepPromise,
      interrupt.signal.then(() => {
        abortController.abort();
        return interrupted;
      }),
    ]);
    if (result === interrupted) {
      return null;
    }
    return result as T;
  } catch (error) {
    if (interrupt.interrupted && abortController.signal.aborted && isAbortError(error)) {
      return null;
    }
    throw error;
  } finally {
    if (interrupt.interrupted) {
      abortController.abort();
    }
  }
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
  const selectedJobIds = new Set(snapshot.runs
    .filter((run) => selected.has(run.id))
    .flatMap((run) => run.jobIds));
  return snapshot.jobs.filter((job) => selectedJobIds.has(job.id));
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
    traces: input.snapshot.traces,
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
  const jobIds = new Set(runs.flatMap((run) => run.jobIds));
  const jobs = snapshot.jobs.filter((job) => jobIds.has(job.id));
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
  const traceSessionCount = details
    ? details.reduce((sum, detail) =>
        sum + detail.executions.reduce((executionSum, execution) => executionSum + execution.sessions.length, 0), 0)
    : 0;
  return {
    ...(artifacts.length > 0 ? { artifacts: artifacts.length } : {}),
    ...(traces.length > 0 ? { traces: traces.length } : {}),
    ...(resultFiles && resultFiles > 0 ? { resultFiles } : {}),
    ...(traceSessionCount > 0 ? { sessions: traceSessionCount } : {}),
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

function progressPhaseForRun(run: WorkbenchRun): WorkbenchProgressPhase {
  if (run.status === "queued") {
    return "queued";
  }
  return isWorkbenchRunStatusTerminal(run.status) ? "complete" : "running";
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
  await reconcileCurrentWorkbenchVersion(started.core);
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(started.core);
  const currentVersionId = snapshot.refs.current;
  if (started.startVersionId && currentVersionId && currentVersionId !== started.startVersionId) {
    throw new WorkbenchCodedError("worktree_changed", "Local source changed while hosted improve was running; refusing to overwrite it.", {
      remediation: `workbench skill switch ${outputVersionId}`,
      subject: {
        startedFrom: started.startVersionId,
        current: currentVersionId,
        hostedVersion: outputVersionId,
      },
      exitCode: 1,
    });
  }
  const result = await switchWorkbenchVersion(outputVersionId, started.core);
  return result.version;
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
  signal?: AbortSignal,
): Promise<WorkbenchRemote> {
  const linked = await linkedCloudRemote(root);
  if (linked) {
    return linked;
  }
  const link = await cloudRemoteLinkTarget(root);
  let remote = await derivePublishCloudRemote(parsed, "workbench skill publish", link.name);
  const source = requiredWorkbenchCloudRemoteSource(remote);
  const token = await workbenchCloudToken({ baseUrl: source.baseUrl });
  if (!token) {
    throw new WorkbenchCodedError("auth_required", "Hosted execution requires Workbench Cloud auth.", {
      remediation: workbenchLoginRemediation(source.baseUrl),
      exitCode: 1,
    });
  }
  renderProgress?.();
  remote = await availableCloudRemoteForHostedAutoLink(remote, signal);
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

async function resolveCloudSkillId(source: ParsedWorkbenchInstallSource, signal?: AbortSignal): Promise<string> {
  const skill = await getCloudSkillByHandle(source.baseUrl, source.owner, source.skill, signal);
  if (!skill?.id) {
    throw new WorkbenchCodedError("remote_not_found", `Workbench Cloud skill not found: ${source.owner}/${source.skill}`, {
      remediation: "workbench skill publish",
      subject: { owner: source.owner, skill: source.skill },
      exitCode: 1,
    });
  }
  return skill.id;
}

function cloudOperationVersionId(request: WorkbenchOperationRequest): string | undefined {
  if (request.kind === "improve") {
    return request.versionId ?? request.target?.versionId;
  }
  const versions = [...new Set(request.targets.flatMap((target) => target.versionId ? [target.versionId] : []))];
  return versions.length === 1 ? versions[0] : undefined;
}

function workbenchOperationRequestWithRunId(request: WorkbenchOperationRequest, runId: string): WorkbenchOperationRequest {
  if (request.kind === "eval") {
    return {
      ...request,
      runId,
      caseIds: [...request.caseIds],
      targets: request.targets.map(copyWorkbenchOperationTarget),
      steps: [...request.steps],
    };
  }
  return {
    ...request,
    runId,
    ...(request.target ? { target: copyWorkbenchOperationTarget(request.target) } : {}),
    ...(request.evidenceTraceIds ? { evidenceTraceIds: [...request.evidenceTraceIds] } : {}),
  };
}

function cloudImproveNextCommand(run: WorkbenchRunSnapshot): string | null {
  return cloudExecutionNextCommand(run, "workbench eval run --rerun -n 5");
}

function cloudDetachedNextCommand(run: WorkbenchRunSnapshot): string | null {
  return cloudExecutionNextCommand(run, "workbench skill show");
}

function cloudExecutionNextCommand(run: WorkbenchRunSnapshot, successCommand: string): string | null {
  if (run.status === "queued" || run.status === "running" || run.status === "canceling") {
    return `workbench watch ${displayRef(run.id)}`;
  }
  if (run.status === "failed" || run.status === "canceled") {
    return null;
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
  if (!beforeRuns) {
    return null;
  }
  const changedRun = await latestChangedRunAfterSync(core, beforeRuns);
  return changedRun ? `workbench eval show ${displayRef(changedRun.id)}` : null;
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
    jobIds: run.jobIds,
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

function workbenchInstallSourceSummary(
  snapshot: WorkbenchSkillPackageSnapshot,
): Json {
  return {
    kind: "workbench-cloud",
    owner: snapshot.owner,
    skill: snapshot.name,
    versionId: snapshot.versionId,
    installHandle: `${snapshot.owner}/${snapshot.name}`,
  };
}

function workbenchInstallSourceArgument(source: ParsedWorkbenchInstallSource): string {
  const handle = `${source.owner}/${source.skill}`;
  return source.version ? `${handle}@${source.version}` : handle;
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
  if (segments.length === 5 && segments[3] === "versions" && segments[4]) {
    return {
      baseUrl: url.origin,
      owner: segments[1],
      skill: segments[2],
      version: segments[4],
    };
  }
  throw new WorkbenchUserError(`Invalid Workbench skill URL: ${source}`);
}

function requiredWorkbenchCloudRemoteSource(remote: WorkbenchRemote): ParsedWorkbenchInstallSource {
  const source = parseWorkbenchInstallSource(remote.url);
  if (!source) {
    throw new WorkbenchCodedError("remote_invalid_url", `Workbench remote is not a Cloud skill URL: ${remote.url}`, {
      remediation: "workbench skill publish",
      subject: { remote: remote.name, url: remote.url },
      exitCode: 2,
    });
  }
  return source;
}

async function fetchWorkbenchSkillPackage(
  source: ParsedWorkbenchInstallSource,
  displaySource: string,
  options: { packageVersionNotFoundRemediation?: string } = {},
): Promise<WorkbenchSkillPackageSnapshot> {
  const token = await workbenchCloudToken({ baseUrl: source.baseUrl });
  const apiPath = source.version
    ? `/api/workbench/skills/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.skill)}/versions/${encodeURIComponent(source.version)}/package`
    : `/api/workbench/skills/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.skill)}/package`;
  const response = await fetch(`${source.baseUrl}${apiPath}`, {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await response.text();
  const cloudError = parseWorkbenchCloudErrorBody(text);
  if (cloudError) {
    if (
      cloudError.code === "skill_package_not_available" &&
      !token &&
      cloudError.remediation === "workbench login"
    ) {
      const sourceHandle = workbenchInstallSourceArgument(source);
      throw new WorkbenchCodedError("auth_required", `Log in to check access to Workbench skill package ${sourceHandle}. It may be private, team-only, or missing.`, {
        retryable: false,
        remediation: cloudError.remediation,
        subject: {
          ...(cloudError.subject ?? {}),
          source: sourceHandle,
          owner: source.owner,
          skill: source.skill,
          authenticated: false,
          originalCode: cloudError.code,
        },
        exitCode: 1,
      });
    }
    if (cloudError.code === "skill_package_not_available" && token) {
      throw new WorkbenchCodedError(cloudError.code, `${cloudError.message} You are already logged in; verify the OWNER/SKILL handle or ask the owner for access.`, {
        retryable: false,
        ...(cloudError.subject ? { subject: { ...cloudError.subject, authenticated: true } } : { subject: { authenticated: true } }),
        exitCode: response.status === 400 ? 2 : 1,
      });
    }
    const remediation = cloudError.code === "skill_package_version_not_found" && source.version
      ? options.packageVersionNotFoundRemediation ?? cloudError.remediation
      : cloudError.remediation;
    throw new WorkbenchCodedError(cloudError.code, cloudError.message, {
      retryable: cloudError.retryable,
      ...(remediation ? { remediation } : {}),
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
    throw new WorkbenchCodedError("install_failed", `Unable to download Workbench skill package ${displaySource}: ${response.status}${excerpt ? ` ${excerpt}` : response.statusText ? ` ${response.statusText}` : ""}`, {
      subject: { source: displaySource, status: response.status },
      exitCode: 1,
    });
  }
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) as unknown : null;
  } catch {
    throw new WorkbenchCodedError("install_failed", `Workbench skill package ${displaySource} did not return JSON.`, {
      subject: { source: displaySource },
      exitCode: 1,
    });
  }
  const snapshot = parseWorkbenchSkillPackage(parsed, displaySource);
  if (source.version && !workbenchPublishedSkillVersionRefMatches(snapshot.versionId, source.version)) {
    throw new WorkbenchCodedError("install_failed", `Workbench skill package ${displaySource} resolved ${snapshot.versionId} instead of requested version ${source.version}.`, {
      subject: { source: displaySource, resolvedVersionId: snapshot.versionId, requestedVersionId: source.version },
      exitCode: 1,
    });
  }
  return snapshot;
}

function parseWorkbenchSkillPackage(value: unknown, displaySource: string): WorkbenchSkillPackageSnapshot {
  const record = asRecord(value);
  if (record?.schema !== "workbench.skill-package.snapshot.v1") {
    throw new WorkbenchCodedError("install_failed", `Workbench skill ${displaySource} did not return a skill package.`, {
      subject: { source: displaySource },
      exitCode: 1,
    });
  }
  const owner = typeof record.owner === "string" ? record.owner : "";
  const name = typeof record.name === "string" ? record.name : "";
  const versionId = typeof record.versionId === "string" ? record.versionId : "";
  const files = Array.isArray(record.files) ? record.files.map((entry) => parseWorkbenchSkillPackageFile(entry, displaySource)) : [];
  if (!owner || !name || !versionId || files.length === 0) {
    throw new WorkbenchCodedError("install_failed", `Workbench skill ${displaySource} returned an incomplete skill package.`, {
      subject: { source: displaySource },
      exitCode: 1,
    });
  }
  return {
    schema: "workbench.skill-package.snapshot.v1",
    owner,
    name,
    versionId,
    files,
  };
}

function parseWorkbenchSkillPackageFile(value: unknown, displaySource: string): WorkbenchSkillPackageSnapshot["files"][number] {
  const record = asRecord(value);
  if (!record) {
    throw new WorkbenchCodedError("install_failed", `Workbench skill package ${displaySource} returned an invalid file entry.`, {
      subject: { source: displaySource },
      exitCode: 1,
    });
  }
  const filePath = typeof record?.path === "string" ? record.path : "";
  const content = typeof record?.content === "string" ? record.content : undefined;
  if (!filePath || content === undefined) {
    throw new WorkbenchCodedError("install_failed", `Workbench skill package ${displaySource} returned an invalid file entry.`, {
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
// path. When a target base URL is known, the config token is only used if the
// config base URL matches it.
async function workbenchCloudToken(options: { baseUrl?: string } = {}): Promise<string | undefined> {
  const config = await loadConfig();
  const configToken = config.accessToken &&
      (!options.baseUrl || (config.baseUrl && normalizeBaseUrl(config.baseUrl) === normalizeBaseUrl(options.baseUrl)))
    ? config.accessToken
    : undefined;
  return configToken ?? workbenchCloudEnvToken();
}

function workbenchCloudEnvToken(): string | undefined {
  return process.env.WORKBENCH_API_TOKEN?.trim() || undefined;
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
    remediation: "WORKBENCH_CONFIG=/path/to/config.json workbench skill list",
    subject: { env: "WORKBENCH_CONFIG", path: filePath },
    exitCode: 2,
  });
}

function deviceAuthPath(): string {
  return path.join(path.dirname(configPath()), "device-auth.json");
}

function selectWorkbenchBaseUrl(input: {
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
  return normalizeWorkbenchBackendUrl(value);
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
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  baseUrlOverride?: string,
): Promise<T> {
  const config = await loadConfig();
  const baseUrl = baseUrlOverride !== undefined
    ? normalizeBaseUrl(baseUrlOverride)
    : selectWorkbenchBaseUrl({ configBaseUrl: config.baseUrl });
  const token = await workbenchCloudToken(baseUrlOverride === undefined ? {} : { baseUrl });
  return await requestWorkbenchCloudJson<T>(baseUrl, apiPath, {
    method: options.method,
    body: options.body,
    signal: options.signal,
    token,
    mapTransportError: (error) => error instanceof Error ? error : new Error(String(error)),
    mapHttpError: ({ status, statusText, text, cloudError }) => {
      if (cloudError) {
        return new WorkbenchCodedError(cloudError.code, cloudError.message, {
          retryable: cloudError.retryable,
          ...(cloudError.remediation ? { remediation: cloudError.remediation } : {}),
          ...(cloudError.subject ? { subject: cloudError.subject } : {}),
          exitCode: status === 400 ? 2 : 1,
        });
      }
      const excerpt = readResponseError(text);
      return new Error(
        `Request failed with status ${status}${statusText ? ` ${statusText}` : ""}${excerpt ? `: ${excerpt}` : ""}.`,
      );
    },
  });
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

function installCurrentPublishedPackageCommand(source: ParsedWorkbenchInstallSource, input: string, parsed: ParsedArgs): string {
  const parts = ["workbench", "skill", "install", currentPublishedInstallSourceArgument(source, input)];
  appendInstallTargetFlags(parts, parsed);
  return parts.join(" ");
}

function cloneCurrentPublishedPackageCommand(source: ParsedWorkbenchInstallSource, input: string, destination: string): string {
  return `workbench skill clone ${currentPublishedInstallSourceArgument(source, input)} ${quoteShellArg(destination)}`;
}

function currentPublishedInstallSourceArgument(source: ParsedWorkbenchInstallSource, input: string): string {
  if (/^https?:\/\//u.test(input)) {
    return `${source.baseUrl}/skills/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.skill)}`;
  }
  return `${source.owner}/${source.skill}`;
}

function appendInstallTargetFlags(parts: string[], parsed: ParsedArgs): void {
  const target = stringFlag(parsed, "target");
  if (target) {
    parts.push("--target", target);
  }
  const scope = stringFlag(parsed, "scope");
  if (scope) {
    parts.push("--scope", scope);
  }
  const dir = stringFlag(parsed, "dir");
  if (dir) {
    parts.push("--dir", quoteShellArg(dir));
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted|abort/iu.test(error.message));
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
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
        files: [await requiredCodexOAuthFile(args.profileRoot)],
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

async function collectOrReuseAdapterAuthBundle(args: {
  target: ReturnType<typeof parseWorkbenchAdapterAuthTarget>;
  method: string;
  profileRoot: string;
  store: ReturnType<typeof localWorkbenchAdapterAuthStore>;
}): Promise<{ bundle: WorkbenchAdapterAuthBundle; reused: boolean }> {
  try {
    return {
      bundle: await collectAdapterAuthBundle(args),
      reused: false,
    };
  } catch (error) {
    if (error instanceof WorkbenchCodedError && error.code === "provider_oauth_missing") {
      const existing = await args.store.get(args.target).catch(() => null);
      if (existing?.method === args.method) {
        return { bundle: existing, reused: true };
      }
    }
    throw error;
  }
}

async function requiredCodexOAuthFile(root: string): Promise<WorkbenchAdapterAuthFile> {
  const relativePath = ".codex/auth.json";
  const guidance = {
    provider: "Codex",
    remediation: codexOAuthRemediation(root),
    setupCommands: codexOAuthSetupCommands(root),
  };
  const file = await requiredAuthFile(root, relativePath, guidance);
  if (codexAuthJsonHasUsableToken(file.content)) {
    return file;
  }
  const absolute = path.join(root, relativePath);
  throw new WorkbenchCodedError(
    "provider_oauth_invalid",
    `Codex OAuth token file is present but does not contain a usable token: ${absolute}`,
    {
      remediation: guidance.remediation,
      subject: {
        path: absolute,
        relativePath,
        setupCommands: guidance.setupCommands,
      },
      exitCode: 2,
    },
  );
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
  setupCommands?: string[];
}): Promise<WorkbenchAdapterAuthFile> {
  const file = await readAuthFile(root, relativePath);
  if (!file) {
    const absolute = path.join(root, relativePath);
    throw new WorkbenchCodedError("provider_oauth_missing", guidance
      ? `Missing ${guidance.provider} OAuth token file: ${absolute}`
      : `Missing auth file: ${absolute}`, {
      ...(guidance ? { remediation: guidance.remediation } : {}),
      subject: {
        path: absolute,
        relativePath,
        ...(guidance?.setupCommands?.length ? { setupCommands: guidance.setupCommands } : {}),
      },
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
        subject: { env: CLAUDE_OAUTH_TOKEN_ENV, setupCommands: claudeOAuthSetupCommands(root) },
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
        setupCommands: claudeOAuthSetupCommands(root),
      },
      exitCode: 2,
    },
  );
}

function codexOAuthRemediation(profileRoot: string): string {
  const rootFlag = profileRootFlag(profileRoot);
  if (!rootFlag) {
    return codexDeviceAuthLoginCommand();
  }
  return codexDeviceAuthLoginCommand({ profileRoot });
}

function codexOAuthSetupCommands(profileRoot: string): string[] {
  const rootFlag = profileRootFlag(profileRoot);
  if (!rootFlag) {
    return [
      "codex login --device-auth",
      "workbench login codex --method oauth",
    ];
  }
  return [
    codexDeviceAuthLoginCommand({ profileRoot }),
    `workbench login codex --method oauth${rootFlag}`,
  ];
}

function claudeOAuthRemediation(profileRoot: string): string {
  return claudeOAuthSetupCommands(profileRoot)[0]!;
}

function claudeOAuthSetupCommands(profileRoot: string): string[] {
  return [
    "claude setup-token",
    `CLAUDE_CODE_OAUTH_TOKEN=... workbench login claude --method oauth${profileRootFlag(profileRoot)}`,
  ];
}

function claudeOAuthMissingMessage(profileRoot: string): string {
  return `Claude OAuth capture requires Claude Code's profile and the OAuth token printed by claude setup-token. Run claude setup-token first, then capture it with ${claudeOAuthSetupCommands(profileRoot)[1]}.`;
}

function claudeOAuthInvalidMessage(profileRoot: string): string {
  return `${CLAUDE_OAUTH_TOKEN_ENV} must be the OAuth token printed by claude setup-token. Run claude setup-token first, then capture it with ${claudeOAuthSetupCommands(profileRoot)[1]}.`;
}

function profileRootFlag(profileRoot: string): string {
  return path.resolve(profileRoot) === path.resolve(os.homedir()) ? "" : ` --profile-root ${quoteShellArg(profileRoot)}`;
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

function formatAuthTarget(target: { adapterId: string; slot?: string; profile: string }): string {
  return `${target.adapterId}${target.slot ? `/${target.slot}` : ""}${target.profile === "default" ? "" : ` profile ${target.profile}`}`;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  let positionalOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (positionalOnly) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--") {
      positionals.push(arg);
      positionalOnly = true;
      continue;
    }
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
    if (!arg.startsWith("--")) {
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
    } else if (eq === -1 && value && (!value.startsWith("-") || (value === "-" && kind === "string"))) {
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
  return allowedFlagsForWorkbenchCommand(positionals, command);
}

function addFlag(flags: Record<string, string | boolean | string[]>, name: string, value: string | boolean): void {
  if (name === "with" || name === "tag" || name === "authoring") {
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

async function coreOptions(parsed: ParsedArgs): Promise<CliCoreOptions> {
  return {
    dir: dirFlag(parsed),
    authToken: await workbenchCloudToken(),
    adapterAuthStoreRoot: adapterAuthStoreRoot(),
    homeDir: process.env.HOME,
    env: process.env,
  };
}

function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : undefined;
}

function stringListFlag(parsed: ParsedArgs, name: string): string[] | undefined {
  const value = stringFlag(parsed, name);
  if (value === undefined) {
    return undefined;
  }
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) {
    throw new WorkbenchUserError(`--${name} must include at least one value.`);
  }
  return [...new Set(entries)];
}

function repeatStringFlag(parsed: ParsedArgs, name: string): string[] | undefined {
  const value = parsed.flags[name];
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return undefined;
}

function intFlag(parsed: ParsedArgs, name: string, minimum = 1): number | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < minimum) {
    throw new WorkbenchUserError(`--${name} must be a ${minimum ? "positive" : "nonnegative"} safe integer.`);
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

async function optionalInspectionSnapshot(parsed: ParsedArgs): Promise<WorkbenchInspectionSnapshot | null> {
  try {
    return await createWorkbenchReadOnlyInspectionSnapshot(await coreOptions(parsed));
  } catch {
    return null;
  }
}

function optionalPositional(parsed: ParsedArgs, index: number): string | undefined {
  return parsed.positionals[index];
}

function requiredPositional(parsed: ParsedArgs, index: number, message: string, remediation?: string): string {
  const value = parsed.positionals[index];
  if (!value) {
    if (remediation) {
      throw new WorkbenchCodedError("usage", message, {
        remediation,
        exitCode: 2,
      });
    }
    throw new WorkbenchUserError(message);
  }
  return value;
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

function parsePublishVisibilityFlags(parsed: ParsedArgs): "private" | "internal" | "public" | undefined {
  const selected = [
    parsed.flags.private === true ? "private" as const : undefined,
    parsed.flags.team === true ? "internal" as const : undefined,
    parsed.flags.public === true ? "public" as const : undefined,
  ].filter((value): value is "private" | "internal" | "public" => Boolean(value));
  if (selected.length > 1) {
    throw new WorkbenchCodedError("usage", "workbench skill publish accepts only one visibility flag.", {
      remediation: "workbench skill publish --private",
      exitCode: 2,
    });
  }
  return selected[0];
}

function publishVersionInput(parsed: ParsedArgs): string | undefined {
  return optionalPositional(parsed, 2);
}

function publishNextCommand(parsed: ParsedArgs): string {
  const parts = ["workbench", "skill", "publish"];
  const version = publishVersionInput(parsed);
  if (version) {
    parts.push(quoteShellArg(version));
  }
  const handle = stringFlag(parsed, "as");
  if (handle) {
    parts.push("--as", quoteShellArg(handle));
  }
  if (parsed.flags.private === true) {
    parts.push("--private");
  } else if (parsed.flags.team === true) {
    parts.push("--team");
  } else if (parsed.flags.public === true) {
    parts.push("--public");
  }
  const dir = dirFlag(parsed);
  if (dir) {
    parts.push("--dir", quoteShellArg(dir));
  }
  return parts.join(" ");
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
    ? await derivePublishCloudRemote(parsed, "workbench skill publish", link.name)
    : link.existing;
  await assertPublishCloudAuthForRemote(remote);
  const requestedVersion = publishVersionInput(parsed);
  const version = requestedVersion && requestedVersion !== "current"
    ? snapshotVersionByRef(reconciledSnapshot, requestedVersion)
    : snapshotVersionByRef(reconciledSnapshot, reconciledSnapshot.status.currentVersionId ?? reconciledSnapshot.refs.current ?? "");
  if (!version) {
    throw new WorkbenchCodedError("version_not_found", `Version not found: ${requestedVersion ?? "current"}`, {
      remediation: "workbench skill versions",
      subject: { version: requestedVersion ?? "current" },
      exitCode: 1,
    });
  }
  const selectedVisibility = visibility ??
    normalizePublishVisibility(reconciledSnapshot.refs["publication/visibility"]) ??
    "private";
  await assertTeamPublishPreviewAllowed(remote, selectedVisibility);
  return {
    remote,
    version,
    visibility: selectedVisibility,
    installHandle: installHandleFromCloudRemote(remote),
  };
}

async function assertTeamPublishPreviewAllowed(
  remote: WorkbenchRemote,
  visibility: "private" | "internal" | "public",
): Promise<void> {
  if (visibility !== "internal") {
    return;
  }
  const source = parseWorkbenchInstallSource(remote.url);
  if (!source) {
    return;
  }
  const config = await loadConfig();
  const personalOwner = config.username ? normalizeWorkbenchSkillName(config.username) : "";
  if (source.owner === personalOwner) {
    throw teamVisibilityRequiresOrganizationError(source);
  }
  const existing = await getCloudSkillByHandle(source.baseUrl, source.owner, source.skill);
  if (existing?.ownerKind === "organization") {
    return;
  }
  if (existing?.ownerKind === "user") {
    throw teamVisibilityRequiresOrganizationError(source);
  }
  const organizationReadiness = await cloudOrganizationHostedOperationReadiness(source.baseUrl, source.owner);
  if (!organizationReadiness.ready) {
    throw teamVisibilityRequiresOrganizationError(source);
  }
}

function teamVisibilityRequiresOrganizationError(source: ParsedWorkbenchInstallSource): WorkbenchCodedError {
  return new WorkbenchCodedError("validation_failed", "Team skill visibility requires an organization-owned skill.", {
    remediation: "workbench skill publish --as ORG/SKILL --team",
    subject: {
      owner: source.owner,
      skill: source.skill,
      visibility: "team",
      requirement: "Publish under an organization-owned skill to use team visibility.",
    },
    exitCode: 1,
  });
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
    const remote = await derivePublishCloudRemote(parsed, "workbench skill publish", link.name);
    const result = await addWorkbenchRemote(remote.name, remote.url, { ...core, replace: link.replace });
    return result.remote.name;
  }
  if (link.existing) {
    return link.existing.name;
  }
  const remote = await derivePublishCloudRemote(parsed, "workbench skill publish", link.name);
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
  throw publishCloudAuthRequired(source.baseUrl);
}

async function assertPublishCloudAuthForRemote(remote: WorkbenchRemote): Promise<void> {
  const source = parseWorkbenchInstallSource(remote.url);
  if (!source || await workbenchCloudToken({ baseUrl: source.baseUrl })) {
    return;
  }
  throw publishCloudAuthRequired(source.baseUrl);
}

function publishCloudAuthRequired(baseUrl: string): WorkbenchCodedError {
  return new WorkbenchCodedError("auth_required", "workbench skill publish requires Workbench Cloud auth.", {
    remediation: workbenchLoginRemediation(baseUrl),
    exitCode: 1,
  });
}

async function derivePublishCloudRemote(parsed: ParsedArgs, action = "workbench skill publish", name = "cloud"): Promise<WorkbenchRemote> {
  const config = await loadConfig();
  const baseUrl = selectWorkbenchBaseUrl({ configBaseUrl: config.baseUrl });
  const override = stringFlag(parsed, "as");
  const handle = override ? parseOwnerSkillHandle(override) : derivedOwnerSkillHandle(parsed, config, action);
  const url = `${baseUrl}/skills/${encodeURIComponent(handle.owner)}/${encodeURIComponent(handle.skill)}`;
  return { name, kind: "workbench-cloud", url };
}

function installHandleFromCloudRemote(remote: WorkbenchRemote): string {
  const source = requiredWorkbenchCloudRemoteSource(remote);
  return `${source.owner}/${source.skill}`;
}

async function assertDerivedCloudHandleAvailable(
  remote: WorkbenchRemote,
  options: { code: "publish_handle_conflict"; remediation?: string },
): Promise<void> {
  const source = requiredWorkbenchCloudRemoteSource(remote);
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
    remediation: options.remediation ?? `workbench skill publish --as ${source.owner}/${collisionResistantSkill}`,
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

async function availableCloudRemoteForHostedAutoLink(remote: WorkbenchRemote, signal?: AbortSignal): Promise<WorkbenchRemote> {
  const source = requiredWorkbenchCloudRemoteSource(remote);
  const existing = await getCloudSkillByHandle(source.baseUrl, source.owner, source.skill, signal);
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
  signal?: AbortSignal,
): Promise<{ id?: string; ownerSlug?: string; ownerKind?: "user" | "organization"; name?: string } | undefined> {
  const params = new URLSearchParams({ owner, name: skill });
  const listed = await apiRequest<{ skills?: Array<{ id?: string; ownerSlug?: string; ownerKind?: "user" | "organization"; name?: string }> }>(
    `/api/workbench/skills?${params.toString()}`,
    { signal },
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
  if (error.message.startsWith("workbench skill publish")) {
    return error;
  }
  return new WorkbenchCodedError("auth_required", "workbench skill publish requires Workbench Cloud auth.", {
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
    throw new WorkbenchCodedError("usage", "workbench skill publish --as expects OWNER/SKILL.", {
      remediation: "workbench skill publish --as OWNER/SKILL",
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

async function resolveWorkbenchCloudSkillUrl(
  input: string,
  action: string,
  remediation: string,
): Promise<string> {
  if (/^https?:\/\//u.test(input)) {
    return input;
  }
  const parsed = parseOwnerSkillSourceSpec(input);
  const handle = parsed?.handle;
  if (!handle) {
    throw new WorkbenchCodedError("usage", `${action} expects OWNER/SKILL or a Workbench Cloud skill URL.`, {
      remediation,
      exitCode: 2,
    });
  }
  const config = await loadConfig();
  const baseUrl = selectWorkbenchBaseUrl({ configBaseUrl: config.baseUrl });
  const basePath = `${baseUrl}/skills/${encodeURIComponent(handle.owner)}/${encodeURIComponent(handle.skill)}`;
  return parsed.version ? `${basePath}/versions/${encodeURIComponent(parsed.version)}` : basePath;
}

function parseOwnerSkillSourceSpec(value: string): { handle: WorkbenchSkillHandle; version?: string } | null {
  const trimmed = value.trim();
  const atIndex = trimmed.lastIndexOf("@");
  const handleText = atIndex === -1 ? trimmed : trimmed.slice(0, atIndex);
  const version = atIndex === -1 ? undefined : trimmed.slice(atIndex + 1);
  if (version !== undefined && !version) {
    return null;
  }
  const handle = normalizedOwnerSkillHandle(handleText);
  return handle ? { handle, ...(version ? { version } : {}) } : null;
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
  const byRun = new Map(runs.map((run) => [run.id, [] as string[]]));
  if (runs.length === 0) {
    return byRun;
  }
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const jobsById = new Map(snapshot.jobs.map((job) => [job.id, job]));
  for (const run of runs) {
    byRun.set(run.id, [...new Set(run.jobIds.flatMap((jobId) => jobsById.get(jobId)?.artifactIds ?? []))]);
  }
  return byRun;
}

function emitEvalFailure(
  command: "run" | "grade",
  snapshot: WorkbenchRunSnapshot,
  failedRuns: readonly WorkbenchRun[],
  artifactIds: ReadonlyMap<string, readonly string[]>,
  coverage: readonly EvalCoverage[],
  deltas: readonly EvalDelta[],
  parsed: ParsedArgs,
  io: CliIo,
): number {
  const next = evalFailureNextCommand(failedRuns);
  const failedMeasurements = snapshot.measurements
    .filter((measurement) => measurement.status === "failed")
    .map((measurement) => measurementFailureSummary(measurement, artifactIds.get(measurement.runId) ?? []));
  const canceledMeasurements = snapshot.measurements
    .filter((measurement) => measurement.status === "canceled")
    .map((measurement) => measurementFailureSummary(measurement, artifactIds.get(measurement.runId) ?? []));
  const canceledOnly = failedMeasurements.length === 0 && canceledMeasurements.length > 0;
  const code = canceledOnly ? "eval_canceled" : "eval_runs_failed";
  const message = canceledOnly ? "Eval canceled; evidence was saved." : "Eval failed; evidence was saved.";
  if (parsed.flags.json === true) {
    io.stdout.write(`${JSON.stringify({
      schema: `workbench.cli.eval-${command}.v1`,
      ok: false,
      code,
      message,
      retryable: false,
      evidenceSaved: true,
      run: runSnapshotResultJson(snapshot),
      ...(failedMeasurements.length > 0 ? { failedMeasurements } : {}),
      ...(canceledMeasurements.length > 0 ? { canceledMeasurements } : {}),
      coverage: coverage,
      deltas: deltas,
      next,
    }, null, 2)}\n`);
    return 1;
  }
  io.stdout.write([
    message,
    formatRunSnapshot(snapshot),
    ...formatEvalCoverageLines(coverage),
    ...formatEvalDeltaLines(deltas),
    ...(next ? [`next: ${next}`] : []),
  ].join("\n") + "\n");
  return 1;
}

function runSummary(
  run: WorkbenchRun,
  artifactIds: readonly string[],
  jobs: readonly WorkbenchJob[] = [],
  traces: readonly WorkbenchTrace[] = [],
) {
  const score = scoredRunValue(run, jobs);
  const report = jobs.length > 0
    ? buildWorkbenchJobReport(jobs, traces, { now: run.finishedAt ?? new Date().toISOString() })
    : undefined;
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
    ...(score !== undefined ? { score } : {}),
    ...(report ? { report: report } : {}),
    ...(run.error ? { error: run.error } : {}),
    jobIds: run.jobIds,
    traceIds: run.traceIds,
    artifactIds: [...artifactIds],
  };
}

function measurementFailureSummary(measurement: WorkbenchMeasurementSummary, artifactIds: readonly string[]) {
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
    return "workbench eval results";
  }
  return `workbench eval show ${displayRef(first.id)}`;
}

function adapterAuthRemediationFromRun(run: WorkbenchRun): string | null {
  return adapterAuthRemediationFromError(run.error);
}

function output(value: unknown, parsed: ParsedArgs, io: CliIo, text: (format: HumanFormatOptions) => string): number {
  return emitResult(commandSchema(parsed), { result: jsonValue(value) }, parsed, io, text);
}

function commandSchema(parsed: ParsedArgs): string {
  const command = parsed.positionals[0] ?? "result";
  const subcommand = parsed.positionals[1];
  const suffix = ["source", "eval", "skill"].includes(command) && subcommand
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
const MAX_COMMAND_INPUT_BYTES = 16 * 1024 * 1024;

type InspectionSnapshot = Awaited<ReturnType<typeof createWorkbenchReadOnlyInspectionSnapshot>>;

function scoredRunValue(run: WorkbenchRun, jobs: readonly WorkbenchJob[] = []): number | undefined {
  if (run.status === "canceled") {
    return undefined;
  }
  const referencedJobIds = new Set(run.jobIds);
  const scores = jobs
    .filter((job) => referencedJobIds.has(job.id) && job.role === "grade")
    .map(workbenchJobScore)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  if (scores.length === 0) {
    return undefined;
  }
  return Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(3));
}

function snapshotHasAnyEvalCase(snapshot: InspectionSnapshot, evalHash?: string): boolean {
  return snapshotEvalCases(snapshot, evalHash).length > 0;
}

function snapshotEvalCases(
  snapshot: InspectionSnapshot,
  evalHash?: string,
): WorkbenchInspectionSnapshot["evals"][number]["cases"] {
  const selected = evalHash
    ? snapshot.evals.find((evalSnapshot) => evalSnapshot.hash === evalHash)
    : snapshot.evals
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.hash.localeCompare(left.hash))[0];
  return selected?.cases ?? [];
}

function authorEvalCaseCommand(snapshot: InspectionSnapshot | null, caseIds: ReadonlySet<string> = new Set()): string {
  return workbenchAuthorEvalCaseCommand(nextEvalCaseId(snapshot, caseIds));
}

function nextEvalCaseId(snapshot: InspectionSnapshot | null, caseIds: ReadonlySet<string> = new Set()): string {
  const existingCaseIds = new Set([
    ...caseIds,
    ...(snapshot ? snapshotEvalCases(snapshot).flatMap((evalCase) => [
      evalCase.id,
      path.basename(path.dirname(evalCase.path)),
    ]) : []),
  ]);
  for (let index = 1; ; index += 1) {
    const id = `case-${String(index).padStart(3, "0")}`;
    if (!existingCaseIds.has(id)) {
      return id;
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
  return `cd ${quoteShellArg(target || ".")} && ${command}`;
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
  const normalized = requested === "current"
    ? snapshot.status.currentVersionId ?? snapshot.refs.current ?? ""
    : requested;
  if (!normalized) {
    return undefined;
  }
  const candidates = snapshot.versions.filter((version) =>
    !(version.id === "current" && requested !== "current") &&
    snapshotVersionRefMatches(version, normalized)
  );
  if (candidates.length > 1) {
    throw new WorkbenchCodedError("ref_ambiguous", `Version ref is ambiguous: ${ref}. Candidates: ${displayCandidateRefs(candidates.map((version) => version.id)).join(", ")}.`, {
      subject: { ref, candidates: candidates.map((version) => version.id) },
      exitCode: 2,
    });
  }
  return candidates[0];
}

function snapshotResultVersionsByRef(
  snapshot: InspectionSnapshot,
  ref: string,
): WorkbenchResults["skillVersions"][number][] {
  const requested = ref.trim();
  const normalized = requested === "current" ? snapshot.refs.current ?? "" : requested;
  if (!normalized || !snapshot.results) {
    return [];
  }
  return snapshot.results.skillVersions.filter((version) =>
    resultVersionRefMatches(version, normalized)
  );
}

function resultVersionRefMatches(version: WorkbenchResults["skillVersions"][number], ref: string): boolean {
  const candidates = [version.id, version.projectVersionId]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return candidates.some((candidate) =>
    candidate === ref ||
    candidate.startsWith(ref) ||
    (candidate.startsWith("v_") && (candidate.slice(2) === ref || candidate.slice(2).startsWith(ref)))
  );
}

function snapshotEvalByRef(snapshot: InspectionSnapshot, ref: string): InspectionSnapshot["evals"][number] | undefined {
  const requested = ref.trim();
  if (!requested) {
    return undefined;
  }
  const candidates = snapshot.evalVersions.filter((version) =>
    version.id === requested ||
    version.label.toLowerCase() === requested.toLowerCase() ||
    version.hash === requested ||
    version.hash.startsWith(requested)
  );
  if (candidates.length > 1) {
    throw new WorkbenchCodedError("ref_ambiguous", `Eval version ref is ambiguous: ${ref}. Candidates: ${displayCandidateRefs(candidates.map((entry) => entry.id)).join(", ")}.`, {
      subject: { ref, candidates: candidates.map((entry) => entry.id) },
      exitCode: 2,
    });
  }
  const hash = candidates[0]?.hash;
  return hash ? snapshot.evals.find((entry) => entry.hash === hash) : undefined;
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

function runOrJobEvidenceSelection(snapshot: InspectionSnapshot, ref: string): {
  run?: WorkbenchRun;
  jobs: WorkbenchJob[];
} {
  const run = resolveWorkbenchObjectByRef(snapshot.runs, ref, "run");
  const job = resolveWorkbenchObjectByRef(snapshot.jobs, ref, "job");
  if (run && job) {
    throw new WorkbenchCodedError("ref_ambiguous", `Run/job ref is ambiguous: ${ref}. Candidates: ${displayCandidateRefs([run.id, job.id]).join(", ")}.`, {
      subject: { ref, candidates: [run.id, job.id] },
      exitCode: 2,
    });
  }
  if (run) {
    const runJobIds = new Set(run.jobIds);
    return {
      run,
      jobs: orderRunEvidenceJobs(
        snapshot.jobs.filter((entry) => runJobIds.has(entry.id)),
        run,
      ),
    };
  }
  return job ? { jobs: [job] } : { jobs: [] };
}

function orderRunEvidenceJobs(jobs: readonly WorkbenchJob[], run: WorkbenchRun): WorkbenchJob[] {
  const runJobOrder = new Map(run.jobIds.map((jobId, index) => [jobId, index]));
  return [...jobs].sort((left, right) =>
    (runJobOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (runJobOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
    left.caseId.localeCompare(right.caseId) ||
    left.sample - right.sample ||
    roleSortValue(left.role) - roleSortValue(right.role) ||
    left.id.localeCompare(right.id)
  );
}

function roleSortValue(role: WorkbenchJob["role"]): number {
  if (role === "run") {
    return 0;
  }
  if (role === "grade") {
    return 1;
  }
  return 2;
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
  snapshot: WorkbenchInspectionSnapshot,
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
  const evidenceJobs = evidenceJobsForSelection(snapshot, jobs);
  const jobLines = evidenceJobs.length > 0
    ? ["Jobs:", ...evidenceJobs.map(formatJobEvidenceSummary)]
    : [];
  const detailLines = details.map((detail) => formatTraceDetail(detail, { jobRefs, runRefs })).filter(Boolean);
  const highlightLines = formatEvidenceHighlights(evidenceHighlights(files));
  const fileLines = files.length > 0 ? ["Files:", ...files.map((file) => ownerRef ? `workbench eval show ${quoteShellArg(showFileRef(ownerRef, file.path))}` : file.path)] : [];
  return [...jobLines, ...detailLines, ...highlightLines, ...fileLines].join("\n") || "No evidence.";
}

function formatRunEvidenceSummary(
  snapshot: WorkbenchInspectionSnapshot,
  run: WorkbenchRun,
  jobs: readonly WorkbenchJob[],
  details: readonly WorkbenchExecutionTraceDetail[],
  files: readonly SurfaceSnapshotFile[],
  progress?: WorkbenchRunSnapshot,
  next?: string | null,
): string {
  const failures = runFailureGroups(jobs, ["failed"]);
  const cancellations = runFailureGroups(jobs, ["canceled"]);
  const evidence = buildWorkbenchRunEvidenceView(snapshot, run);
  return [
    progress ? formatRunSnapshot(progress) : formatRun(run),
    `location=${run.location ?? "local"}${run.retryOfRunId ? ` retry_of=${displayRef(run.retryOfRunId)}` : ""}${run.outputVersionId ? ` output=${displayRef(run.outputVersionId)}` : ""}`,
    ...(progress ? [`Progress: ${formatProgressSummary(progress)}`] : []),
    ...(run.error ? [`error=${singleLine(run.error)}`] : []),
    ...(failures.length > 0
      ? ["Failures:", ...failures.map((failure) => `  ${failure.count} ${failure.status}: ${failure.cause}`)]
      : []),
    ...(cancellations.length > 0
      ? ["Canceled:", ...cancellations.map((failure) => `  ${failure.count}: ${failure.cause}`)]
      : []),
    ...(evidence ? formatRunEvidenceView(evidence) : []),
    formatRunOrJobEvidence(snapshot, jobs, details, files, run.id),
    ...(next ? [`next: ${next}`] : []),
  ].filter(Boolean).join("\n");
}

function formatRunEvidenceView(evidence: WorkbenchRunEvidenceView): string[] {
  return [
    ...(evidence.measurements.length > 0
      ? ["Measurements:", ...evidence.measurements.map(formatEvidenceMeasurementResult)]
      : []),
    ...(evidence.jobGroups.length > 0
      ? ["Job groups:", ...evidence.jobGroups.map(formatEvidenceJobGroupResult)]
      : []),
    ...(evidence.cases.length > 0
      ? ["Case results:", ...evidence.cases.map(formatEvidenceCaseResult)]
      : []),
  ];
}

function formatEvidenceMeasurementResult(measurement: WorkbenchRunEvidenceMeasurementResult): string {
  return [
    "  ",
    measurement.agentLabel,
    `skill=${measurement.skillLabel}`,
    `agent=${measurement.agentName}`,
    `model=${formatEvidenceModel(measurement)}`,
    measurement.status,
    `coverage=${formatCoverageCli(measurement.coverage)}`,
    `quality=${formatQualityCli(measurement.score)}`,
    ...formatReportMetricCliParts(measurement.report),
    measurement.errors.length > 0 ? `error=${singleLine(measurement.errors[0]!)}` : undefined,
  ].filter(Boolean).join("\t");
}

function formatEvidenceJobGroupResult(group: WorkbenchRunEvidenceJobGroupResult): string {
  return [
    "  ",
    group.agentLabel,
    `skill=${group.skillLabel}`,
    `agent=${group.agentName}`,
    `model=${formatEvidenceModel(group)}`,
    group.status,
    `jobs=${group.succeededJobs}/${group.totalJobs}`,
    `latency=${formatReportLatencyCli(group.report, { includePerSample: false })}`,
    `cost=${formatReportCostCli(group.report, { includePerSample: false })}`,
    group.errors.length > 0 ? `error=${singleLine(group.errors[0]!)}`
      : undefined,
  ].filter(Boolean).join("\t");
}

function formatEvidenceCaseResult(result: WorkbenchRunEvidenceCaseResult): string {
  return [
    "  ",
    result.caseId,
    `sample=${humanSampleNumber(result.sample)}`,
    `skill=${result.skillLabel}`,
    `agent=${result.agentLabel}`,
    `model=${formatEvidenceModel(result)}`,
    `status=${result.status}`,
    `run=${formatEvidencePhase(result.run)}`,
    `grade=${formatEvidencePhase(result.grade)}`,
    `quality=${formatQualityCli(result.score)}`,
    ...formatReportMetricCliParts(result.report),
    result.dependencyReason ? `dependency=${singleLine(result.dependencyReason)}` : undefined,
    result.error ? `error=${singleLine(result.error)}` : undefined,
    `show=workbench eval show ${result.selectedJobId}`,
  ].filter(Boolean).join("\t");
}

function evidenceJobsForSelection(
  snapshot: WorkbenchInspectionSnapshot,
  jobs: readonly WorkbenchJob[],
): WorkbenchRunEvidenceJob[] {
  const selectedJobIds = new Set(jobs.map((job) => job.id));
  const evidenceJobs = new Map<string, WorkbenchRunEvidenceJob>();
  for (const run of snapshot.runs.filter((entry) => entry.jobIds.some((jobId) => selectedJobIds.has(jobId)))) {
    const evidence = buildWorkbenchRunEvidenceView(snapshot, run);
    for (const evidenceJob of evidence?.jobs ?? []) {
      if (selectedJobIds.has(evidenceJob.jobId)) {
        evidenceJobs.set(evidenceJob.jobId, evidenceJob);
      }
    }
  }
  return jobs.flatMap((job) => {
    const evidenceJob = evidenceJobs.get(job.id);
    return evidenceJob ? [evidenceJob] : [];
  });
}

function formatJobEvidenceSummary(
  job: WorkbenchRunEvidenceJob,
): string {
  return [
    "  ",
    job.jobId,
    `role=${job.role}`,
    `case=${job.caseId}`,
    `sample=${humanSampleNumber(job.sample)}`,
    `skill=${job.skillLabel}`,
    `agent=${job.agentLabel}`,
    `model=${formatEvidenceModel(job)}`,
    job.status,
    `score=${formatOptionalScore(job.score)}`,
    `duration=${formatOptionalDuration(job.durationMs)}`,
    job.dependencies.length > 0 ? `depends=${job.dependencies.map(formatEvidenceDependency).join(",")}` : undefined,
    job.error ? `error=${singleLine(job.error)}` : undefined,
  ].filter(Boolean).join("\t");
}

function formatEvidenceDependency(dependency: WorkbenchRunEvidenceJob["dependencies"][number]): string {
  return dependency.jobId ? `${dependency.name}:${dependency.jobId}` : dependency.name;
}

function formatEvidencePhase(phase: WorkbenchRunEvidenceCaseResult["run"]): string {
  if (!phase) {
    return "n/a";
  }
  return [
    phase.status,
    phase.jobId,
    phase.dependencyReason ? `dependency=${singleLine(phase.dependencyReason)}` : undefined,
  ].filter(Boolean).join("/");
}

function formatEvidenceModel(entry: Pick<WorkbenchRunEvidenceJob, "adapter" | "model">): string {
  return entry.model ? `${entry.adapter}/${entry.model}` : entry.adapter;
}

function formatOptionalScore(score: number | undefined): string {
  return score === undefined ? "n/a" : score.toFixed(3);
}

function formatOptionalDuration(durationMs: number | undefined): string {
  return durationMs === undefined ? "n/a" : `${durationMs}ms`;
}

function formatReportMetricCliParts(report: WorkbenchJobReport | undefined): string[] {
  return [
    `latency=${formatReportLatencyCli(report, { includeContext: true })}`,
    `cost=${formatReportCostCli(report, { includeContext: true })}`,
  ];
}

function formatReportLatencyCli(
  report: WorkbenchJobReport | undefined,
  options: ReportMetricCliOptions = {},
): string {
  return formatReportMetricCli(report, "latency", formatOptionalDuration, options);
}

function formatReportCostCli(
  report: WorkbenchJobReport | undefined,
  options: ReportMetricCliOptions = {},
): string {
  return formatReportMetricCli(report, "cost", formatCostUsd, options);
}

type ReportMetricCliOptions = {
  includeContext?: boolean;
  includePerSample?: boolean;
};

type ReportMetricValueKind = "perSample" | "total";

function formatReportMetricCli(
  report: WorkbenchJobReport | undefined,
  metric: WorkbenchReportMetricKind,
  formatter: (value: number) => string,
  options: ReportMetricCliOptions = {},
): string {
  const includePerSample = options.includePerSample ?? true;
  const breakdown = workbenchJobReportMetricBreakdown(report, metric);
  const valueKind: ReportMetricValueKind = includePerSample && (
    breakdown.primary?.value.perSample !== undefined ||
    breakdown.details.some((detail) => detail.value.perSample !== undefined)
  )
    ? "perSample"
    : "total";
  const primary = formatReportMetricCliValue(breakdown.primary?.value, valueKind, formatter)
    ?? (valueKind === "perSample" ? formatReportMetricCliValue(breakdown.primary?.value, "total", formatter) : undefined)
    ?? "n/a";
  if (!options.includeContext) {
    return primary;
  }
  const details = breakdown.details.flatMap((detail): string[] => {
    const value = formatReportMetricCliValue(detail.value, valueKind, formatter)
      ?? (valueKind === "perSample" ? formatReportMetricCliValue(detail.value, "total", formatter) : undefined);
    return value ? [`${detail.label} ${value}`] : [];
  });
  return [primary, ...details].join("; ");
}

function formatReportMetricCliValue(
  value: { perSample?: number; total?: number } | undefined,
  kind: ReportMetricValueKind,
  formatter: (value: number) => string,
): string | undefined {
  const numeric = kind === "perSample" ? value?.perSample : value?.total;
  if (numeric === undefined) {
    return undefined;
  }
  return kind === "perSample" ? `${formatter(numeric)}/sample` : `${formatter(numeric)} total`;
}

function formatCoverageCli(coverage: WorkbenchSampleCoverage | undefined): string {
  if (!coverage || !Number.isFinite(coverage.planned) || coverage.planned <= 0) {
    return "n/a";
  }
  return `${coverage.completed}/${coverage.planned} samples`;
}

function formatQualityCli(score: number | undefined): string {
  return score === undefined ? "n/a" : `score ${score.toFixed(3)}`;
}

function runFailureGroups(
  jobs: readonly WorkbenchJob[],
  statuses: readonly WorkbenchJob["status"][] = ["failed", "canceled"],
): Array<{ status: string; cause: string; count: number; jobIds: string[] }> {
  const includedStatuses = new Set(statuses);
  const groups = new Map<string, { status: string; cause: string; count: number; jobIds: string[] }>();
  for (const job of jobs) {
    if (!includedStatuses.has(job.status)) {
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

type EvidenceHighlight = { kind: "agent_output"; path: string; preview: string };

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
    }
  }
  return highlights;
}

function formatEvidenceHighlights(highlights: readonly EvidenceHighlight[]): string[] {
  if (highlights.length === 0) {
    return [];
  }
  const lines: string[] = ["Evidence:"];
  for (const highlight of highlights) {
    lines.push(`Output ${highlight.path}:`);
    lines.push(...highlight.preview.split("\n").map((line) => `  ${line}`));
  }
  return lines;
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
  const score = workbenchJobScore(job);
  return {
    id: job.id,
    runId: job.runId,
    role: job.role,
    caseId: job.caseId,
    sample: humanSampleNumber(job.sample),
    status: job.status,
    ...(score !== undefined ? { score } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

function evidenceDetailSummary(detail: WorkbenchExecutionTraceDetail, jobsById: ReadonlyMap<string, WorkbenchJob> = new Map()): Json {
  return {
    runId: detail.runId,
    executions: detail.executions.map((execution) => ({
      id: execution.id,
      kind: execution.kind,
      role: execution.role,
      jobRoles: [...new Set(execution.jobIds
        .map((jobId) => jobsById.get(jobId)?.role)
        .filter((role): role is WorkbenchJobRole => typeof role === "string"))],
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

function resultsManifest(results: WorkbenchResults) {
  return {
    skillVersions: results.skillVersions.map((version) => ({
      ...version,
      ...(version.files
        ? {
            files: version.files.map((file) =>
              fileSummary(file, showFileRef(version.projectVersionId ?? version.id, file.path))
            ),
          }
        : {}),
    })),
    evalVersions: results.evalVersions.map(evalVersionManifest),
    agentVersions: results.agentVersions.map((agent) => ({ ...agent })),
    cells: results.cells.map((cell) => ({ ...cell })),
  };
}

function evalVersionManifest(version: WorkbenchResults["evalVersions"][number]): WorkbenchResults["evalVersions"][number] {
  return { ...version };
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
    const file = findShowFile(version.files, requestedPath, objectRef);
    if (file) {
      return file;
    }
    const resultVersionFile = fileForResultVersionSnapshotRef(snapshot, objectRef, requestedPath);
    if (resultVersionFile) {
      return resultVersionFile;
    }
    throw new WorkbenchCodedError("ref_not_found", `File not found in ${version.id}: ${requestedPath}`, {
      remediation: `workbench skill show ${version.id}`,
      subject: { ref: version.id, path: requestedPath },
      exitCode: 1,
    });
  }
  const resultVersionFile = fileForResultVersionSnapshotRef(snapshot, objectRef, requestedPath);
  if (resultVersionFile) {
    return resultVersionFile;
  }
  const evalSnapshot = snapshotEvalByRef(snapshot, objectRef);
  if (evalSnapshot) {
    const file = findShowFile(evalSnapshot.files, requestedPath, objectRef);
    if (file) {
      return file;
    }
    throw new WorkbenchCodedError("ref_not_found", `File not found in ${objectRef}: ${requestedPath}`, {
      remediation: `workbench eval show ${objectRef}`,
      subject: { ref: objectRef, path: requestedPath },
      exitCode: 1,
    });
  }
  const runOrJobFile = fileForRunOrJobSnapshotRef(snapshot, objectRef, requestedPath);
  if (runOrJobFile) {
    return runOrJobFile;
  }
  const trace = resolveWorkbenchObjectByRef(snapshot.traces, objectRef, "trace");
  if (trace) {
    const file = trace.files.filter(isUserFacingTraceEvidenceFile).find((entry) => entry.path === requestedPath);
    if (file) {
      return file;
    }
    throw new WorkbenchCodedError("ref_not_found", `File not found in ${trace.id}: ${requestedPath}`, {
      remediation: `workbench eval show ${trace.id}`,
      subject: { ref: trace.id, path: requestedPath },
      exitCode: 1,
    });
  }
  const artifact = resolveWorkbenchObjectByRef(snapshot.artifacts, objectRef, "artifact");
  if (artifact) {
    const file = artifact.files.find((entry) => entry.path === requestedPath);
    if (file) {
      return file;
    }
    throw new WorkbenchCodedError("ref_not_found", `File not found in ${artifact.id}: ${requestedPath}`, {
      remediation: `workbench eval show ${artifact.id}`,
      subject: { ref: artifact.id, path: requestedPath },
      exitCode: 1,
    });
  }
  return fileForRunOrJobSnapshotRef(snapshot, objectRef, requestedPath);
}

function fileForResultVersionSnapshotRef(
  snapshot: InspectionSnapshot,
  objectRef: string,
  requestedPath: string,
): SurfaceSnapshotFile | null {
  const candidates = snapshotResultVersionsByRef(snapshot, objectRef);
  if (candidates.length === 0) {
    return null;
  }
  const matches = candidates.flatMap((version) => {
    const file = version.files ? findShowFile(version.files, requestedPath, objectRef) : null;
    return file ? [{ version, file }] : [];
  });
  if (matches.length === 1) {
    return matches[0]!.file;
  }
  if (matches.length > 1) {
    throw new WorkbenchCodedError("ref_ambiguous", `Result version file ref is ambiguous: ${objectRef}:${requestedPath}. Candidates: ${displayCandidateRefs(matches.map((match) => match.version.id)).join(", ")}.`, {
      subject: { ref: objectRef, path: requestedPath, candidates: matches.map((match) => match.version.id) },
      exitCode: 2,
    });
  }
  const version = candidates[0]!;
  throw new WorkbenchCodedError("ref_not_found", `File not found in ${version.id}: ${requestedPath}`, {
    remediation: `workbench skill show ${version.projectVersionId ?? version.id}`,
    subject: { ref: version.id, path: requestedPath },
    exitCode: 1,
  });
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
    remediation: `workbench eval show ${objectRef}`,
    subject: { ref: objectRef, path: requestedPath },
    exitCode: 1,
  });
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
  const normalizedBase = path.basename(normalized);
  const suffixCandidates = files.filter((file) =>
    file.path.endsWith(`/${normalized}`) ||
    file.path === normalizedBase ||
    path.basename(file.path) === normalizedBase
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
  const candidateRefs = candidatePaths.map((candidatePath) => showFileRef(objectRef, candidatePath));
  return new WorkbenchCodedError("ref_ambiguous", `File path is ambiguous in ${objectRef}: ${requestedPath}. Candidates: ${candidatePaths.join(", ")}.`, {
    remediation: candidateRefs[0] ? `workbench eval show ${quoteShellArg(candidateRefs[0])}` : `workbench eval show ${objectRef}`,
    subject: {
      ref: objectRef,
      path: requestedPath,
      candidates: candidatePaths,
      candidateRefs,
      candidateCommands: candidateRefs.map((candidateRef) => `workbench eval show ${quoteShellArg(candidateRef)}`),
    },
    exitCode: 2,
  });
}

function fileListing(kind: "version" | "eval" | "trace" | "artifact", id: string, files: readonly SurfaceSnapshotFile[]): Json {
  return {
    kind,
    id,
    fileCount: files.length,
    files: files.map((file) => fileSummary(file, showFileRef(id, file.path))),
  };
}

function formatFileListing(kind: "version" | "eval" | "trace" | "artifact", id: string, files: readonly SurfaceSnapshotFile[]): string {
  return [
    `${kind}\t${displayRef(id)}\tfiles=${files.length}`,
    ...files.map((file) => `${kind === "version" ? "workbench skill show" : "workbench eval show"} ${quoteShellArg(showFileRef(id, file.path))}`),
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
  canceled: number;
}

async function evalCoverageSummaries(
  core: { dir?: string; authToken?: string },
  runs: readonly WorkbenchRun[],
): Promise<EvalCoverage[]> {
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  const coverageByKey = new Map<string, EvalCoverage & { sampleKeys: Set<string>; caseIds: Set<string> }>();
  for (const run of runs) {
    const runJobIds = new Set(run.jobIds);
    const seenJobIds = new Set<string>();
    for (const job of snapshot.jobs) {
      if (!runJobIds.has(job.id) || job.caseId === "current" || seenJobIds.has(job.id)) {
        continue;
      }
      seenJobIds.add(job.id);
      const key = [
        run.id,
        job.skillName,
        job.skillBundleHash,
        run.evalHash,
        job.agentName,
        job.agentHash,
      ].join("\0");
      const current = coverageByKey.get(key) ?? {
        runId: run.id,
        skillName: job.skillName,
        agentName: job.agentName,
        cases: 0,
        samples: 0,
        jobs: 0,
        succeeded: 0,
        failed: 0,
        canceled: 0,
        sampleKeys: new Set<string>(),
        caseIds: new Set<string>(),
      };
      current.caseIds.add(job.caseId);
      current.sampleKeys.add(`${job.caseId}\0${job.sample}`);
      current.jobs += 1;
      if (job.status === "succeeded") {
        current.succeeded += 1;
      }
      if (job.status === "failed") {
        current.failed += 1;
      }
      if (job.status === "canceled") {
        current.canceled += 1;
      }
      coverageByKey.set(key, current);
    }
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

function formatCompletedJobReferenceLines(
  command: WorkbenchProgressCommand,
  jobs: readonly WorkbenchJob[],
): string[] {
  if (command !== "grade") {
    return [];
  }
  return jobs
    .filter((job) => job.role === "grade")
    .sort((left, right) =>
      left.caseId.localeCompare(right.caseId) ||
      left.sample - right.sample ||
      left.id.localeCompare(right.id)
    )
    .map((job) => `grade job: ${job.id}\tcase=${job.caseId}\tshow=workbench eval show ${job.id}`);
}

function formatRerunGuidanceLines(command: WorkbenchProgressCommand, rerun: boolean): string[] {
  if (command !== "grade" || !rerun) {
    return [];
  }
  return ["rerun: fresh grade judgment recorded; repeat without --rerun to reuse this judgment."];
}

function formatEvalCoverage(coverage: EvalCoverage, includeRunLabels = false): string {
  return [
    `coverage cases=${coverage.cases}`,
    `samples=${coverage.samples}`,
    `jobs=${coverage.jobs}`,
    coverage.failed > 0 ? `failed=${coverage.failed}` : undefined,
    coverage.canceled > 0 ? `canceled=${coverage.canceled}` : undefined,
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
    const score = scoredRunValue(run, snapshot.jobs);
    const previous = snapshot.runs
      .filter((candidate) =>
        candidate.id !== run.id &&
        candidate.skillName === run.skillName &&
        candidate.agentName === run.agentName &&
        scoredRunValue(candidate, snapshot.jobs) !== undefined &&
        candidate.createdAt < run.createdAt
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const previousScore = previous ? scoredRunValue(previous, snapshot.jobs) : undefined;
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
    return "workbench eval run";
  }
  const snapshot = await createWorkbenchReadOnlyInspectionSnapshot(core);
  if (!runs.some((run) => scoredRunValue(run, snapshot.jobs) !== undefined)) {
    return "workbench eval run";
  }
  return "workbench eval results";
}

function formatInstalledInventory(
  inventory: WorkbenchSkillAccessInventory,
  format: HumanFormatOptions = PLAIN_HUMAN_FORMAT,
): string {
  if (inventory.skills.length === 0) {
    const scopeText = inventory.scopes.length === 1
      ? inventory.scopes[0] === "global" ? " globally" : " in this folder"
      : "";
    return [
      `No skills accessible${scopeText}.`,
      "hint: workbench skill list scans configured Codex/Claude skill roots and the current Workbench project only; for an arbitrary sibling SKILL.md, cd there and run workbench skill init or use shell search.",
      ...(inventory.next ? [`next: ${inventory.next}`] : []),
    ].filter(Boolean).join("\n");
  }
  const lines = [
    renderTable(inventory.skills, [
      { header: "name", cell: (skill) => skill.name },
      { header: "target", cell: (skill) => skill.target },
      { header: "scope", cell: (skill) => skill.scope },
      { header: "status", cell: (skill, options) => styleStatus(skill.status, options) },
      { header: "source", cell: (skill) => skill.handle ?? "(no provenance)" },
    ], format),
    ...(inventory.next ? [`next: ${inventory.next}`] : []),
  ];
  return lines.join("\n");
}

function formatVersions(versions: readonly WorkbenchVersion[], format: HumanFormatOptions): string {
  if (versions.length === 0) {
    return "No versions.";
  }
  return renderTable(versions, [
    { header: "version", cell: (version) => displayRef(version.id) },
    { header: "hash", cell: (version) => version.hash.slice(0, 12) },
    { header: "message", cell: (version) => version.message },
  ], format);
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

function switchNextCommand(
  parsed: ParsedArgs,
  versionRef: string,
  result: WorkbenchSwitchResult,
): string | null {
  if (!result.dryRun) {
    return null;
  }
  return switchApplyCommand(parsed, versionRef, result.requiresOverwrite);
}

function switchApplyCommand(parsed: ParsedArgs, versionRef: string, includeYes: boolean): string {
  const args = ["workbench", "skill", "switch", quoteShellArg(versionRef)];
  if (includeYes) {
    args.push("--yes");
  }
  const dir = dirFlag(parsed);
  if (dir) {
    args.push("--dir", quoteShellArg(dir));
  }
  return args.join(" ");
}

function formatSwitchResult(result: WorkbenchSwitchResult, next: string | null): string {
  const action = result.dryRun
    ? `Would switch to ${displayRef(result.version.id)} (dry run made no changes).`
    : `Switched to ${displayRef(result.version.id)}.`;
  return [
    action,
    formatSwitchChangeSummary(result),
    result.requiresOverwrite
      ? result.dryRun
        ? "Would require --yes because local package source has unsaved edits."
        : "Overwrote modified local package source because --yes was provided."
      : undefined,
    ...(next ? [`next: ${next}`] : []),
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatSwitchChangeSummary(result: WorkbenchSwitchResult): string {
  if (result.unchanged) {
    return "Package source already matches the target version.";
  }
  const parts = [
    `${result.changes.added.length} added`,
    `${result.changes.changed.length} changed`,
    `${result.changes.removed.length} removed`,
  ];
  return `Package source changes: ${parts.join(", ")}.`;
}

function formatAgents(agents: readonly WorkbenchAgent[], format: HumanFormatOptions): string {
  if (agents.length === 0) {
    return "No agents.";
  }
  return renderTable(agents, [
    { header: "name", cell: (agent) => agent.name },
    { header: "adapter", cell: (agent) => agent.adapter },
    { header: "model", cell: (agent) => agent.model ?? "n/a" },
  ], format);
}

function formatAgentInline(agent: WorkbenchAgent): string {
  return [
    agent.name,
    `adapter=${agent.adapter}`,
    agent.model ? `model=${agent.model}` : undefined,
  ].filter(Boolean).join(" ");
}

function formatRun(run: WorkbenchRun): string {
  const scoreValue = scoredRunValue(run);
  const score = scoreValue === undefined ? "n/a" : scoreValue.toFixed(3);
  return [
    displayRef(run.id),
    run.kind,
    run.status,
    `version=${displayRef(run.versionId)}`,
    `skill=${run.skillName}`,
    `agent=${run.agentName}`,
    `score=${score}`,
  ].join("\t");
}

function formatRunSnapshot(snapshot: WorkbenchRunSnapshot): string {
  const progress = snapshot.progress.planned > 0
    ? `${snapshot.progress.completed}/${snapshot.progress.planned}`
    : "n/a";
  const scoreValue = snapshot.result?.score ?? snapshot.progress.partialScore;
  const header = [
    displayRef(snapshot.id),
    snapshot.kind,
    snapshot.status,
    `phase=${snapshot.phase}`,
    `progress=${progress}`,
    `scored=${snapshot.progress.scored}`,
    `failed=${snapshot.progress.failed}`,
    `canceled=${snapshot.progress.canceled}`,
    `quality=${formatQualityCli(scoreValue)}`,
    `coverage=${formatRunSnapshotCoverage(snapshot)}`,
    `latency=${formatReportLatencyCli(snapshot.report)}`,
    `cost=${formatReportCostCli(snapshot.report)}`,
    `wall_time=${formatOptionalDuration(snapshot.progress.elapsedMs)}`,
  ].join("\t");
  const measurements = snapshot.measurements.length > 1
    ? snapshot.measurements.map((measurement) => {
        return [
          "  measurement",
          `run=${displayRef(measurement.runId)}`,
          `version=${displayRef(measurement.versionId)}`,
          `skill=${measurement.skillName}`,
          `agent=${measurement.agentName}`,
          measurement.status,
          `quality=${formatQualityCli(measurement.score)}`,
          `coverage=${formatMeasurementSummaryCoverage(measurement)}`,
          ...formatReportMetricCliParts(measurement.report),
        ].join("\t");
      })
    : [];
  return [header, ...measurements].join("\n");
}

function formatRunSnapshotCoverage(snapshot: WorkbenchRunSnapshot): string {
  return formatCoverageCli(workbenchSampleCoverageTotal(snapshot.measurements.map((measurement) => measurement.coverage)));
}

function formatMeasurementSummaryCoverage(measurement: WorkbenchMeasurementSummary): string {
  return formatCoverageCli(measurement.coverage);
}

function humanSampleNumber(sample: number): number {
  return sample + 1;
}

function formatEvalVersions(
  evalVersions: readonly WorkbenchResults["evalVersions"][number][],
  format: HumanFormatOptions = PLAIN_HUMAN_FORMAT,
): string {
  if (evalVersions.length === 0) {
    return "No eval versions.";
  }
  return renderTable(evalVersions, [
    { header: "eval", cell: (version) => version.label },
    { header: "ref", cell: (version) => version.id },
    { header: "cases", align: "right", cell: (version) => String(version.caseCount) },
    { header: "grade", cell: (version) => version.gradeAdapter },
    { header: "runs", align: "right", cell: (version) => String(version.runCount) },
    { header: "quality", cell: (version) => formatQualityCli(version.latestQuality) },
    { header: "current", cell: (version) => version.current ? "yes" : "" },
    { header: "updated", cell: (version) => version.updatedAt },
  ], format);
}

function formatResults(
  results: WorkbenchResults,
  format: HumanFormatOptions = PLAIN_HUMAN_FORMAT,
): string {
  const evidenceCells = results.cells.filter((cell) => cell.runId || cell.status);
  const missingCurrent = currentResultVersionsWithoutEvidence(results);
  const hiddenUnrun = historicalResultVersionsWithoutEvidence(results);
  const hiddenUnrunCells = partialResultCellsWithoutEvidence(results, [
    ...missingCurrent,
    ...hiddenUnrun,
  ]);
  const next = resultsNextCommand(results);
  const lines = formatResultEvidenceSections(results, evidenceCells, format);
  if (missingCurrent.length > 0) {
    lines.push(`Current version has no recorded results: ${formatResultVersionList(missingCurrent)}.`);
  }
  if (hiddenUnrun.length > 0) {
    lines.push(`Unrun versions omitted from table: ${formatResultVersionList(hiddenUnrun)}.`);
  }
  if (hiddenUnrunCells.length > 0) {
    lines.push(`Unrun result cells omitted from table: ${formatResultCellList(results, hiddenUnrunCells)}.`);
  }
  if (next) {
    lines.push(`next: ${next}`);
  }
  return lines.join("\n");
}

function formatResultEvidenceSections(
  results: WorkbenchResults,
  evidenceCells: readonly WorkbenchResults["cells"][number][],
  format: HumanFormatOptions,
): string[] {
  if (results.evalVersions.length > 1) {
    return results.evalVersions.flatMap((evalVersion, index) => {
      const cells = evidenceCells.filter((cell) => cell.evalVersionId === evalVersion.id);
      return [
        ...(index > 0 ? [""] : []),
        formatResultEvalHeader(evalVersion),
        cells.length > 0 ? formatResultCellTable(results, cells, format) : "No results for this eval.",
      ];
    });
  }
  const evalVersion = results.evalVersions[0];
  return [
    ...(evalVersion ? [formatResultEvalHeader(evalVersion)] : []),
    evidenceCells.length === 0 ? "No results." : formatResultCellTable(results, evidenceCells, format),
  ];
}

function formatResultCellTable(
  results: WorkbenchResults,
  cells: readonly WorkbenchResults["cells"][number][],
  format: HumanFormatOptions,
): string {
  return renderTable(cells, [
    { header: "version", cell: (cell) => formatResultVersion(results, cell) },
    { header: "eval", cell: (cell) => formatResultEval(results, cell) },
    { header: "agent", cell: (cell) => formatResultAgent(results, cell) },
    { header: "status", cell: (cell, options) => styleStatus(cell.status ?? "unknown", options) },
    {
      header: "quality",
      cell: (cell) => formatQualityCli(cell.quality),
    },
    {
      header: "coverage",
      cell: (cell) => formatCoverageCli(cell.coverage),
    },
    {
      header: "latency",
      cell: (cell) => formatReportLatencyCli(cell.report),
    },
    {
      header: "cost",
      cell: (cell) => formatReportCostCli(cell.report),
    },
    { header: "run", cell: (cell) => cell.runId ? displayRef(cell.runId) : "n/a" },
  ], format);
}

function formatResultEvalHeader(evalVersion: WorkbenchResults["evalVersions"][number]): string {
  return [
    `Evaluation: ${formatResultEvalLabel(evalVersion)}`,
    formatEvalCaseCountCli(evalVersion.caseCount),
    evalVersion.gradeAdapter,
    evalVersion.latestQuality !== undefined ? `latest ${formatQualityCli(evalVersion.latestQuality)}` : undefined,
  ].filter(Boolean).join("\t");
}

function formatEvalCaseCountCli(caseCount: number): string {
  return `${caseCount} ${caseCount === 1 ? "case" : "cases"}`;
}

function resultsNextCommand(results: WorkbenchResults): string | null {
  return currentResultVersionsWithoutEvidence(results).length > 0 ? "workbench eval run" : null;
}

function currentResultVersionsWithoutEvidence(results: WorkbenchResults): WorkbenchResults["skillVersions"] {
  return results.skillVersions.filter((version) =>
    version.current &&
    !results.cells.some((cell) => cell.skillVersionId === version.id && (cell.runId || cell.status))
  );
}

function historicalResultVersionsWithoutEvidence(results: WorkbenchResults): WorkbenchResults["skillVersions"] {
  return results.skillVersions.filter((version) =>
    !version.current &&
    results.cells.some((cell) => cell.skillVersionId === version.id) &&
    !results.cells.some((cell) => cell.skillVersionId === version.id && (cell.runId || cell.status))
  );
}

function partialResultCellsWithoutEvidence(
  results: WorkbenchResults,
  versionLevelOmissions: readonly WorkbenchResults["skillVersions"][number][],
): WorkbenchResults["cells"] {
  const omittedVersionIds = new Set(versionLevelOmissions.map((version) => version.id));
  return results.cells.filter((cell) =>
    !cell.runId &&
    !cell.status &&
    !omittedVersionIds.has(cell.skillVersionId) &&
    results.cells.some((entry) => entry.skillVersionId === cell.skillVersionId && (entry.runId || entry.status))
  );
}

function formatResultCellList(
  results: WorkbenchResults,
  cells: readonly WorkbenchResults["cells"][number][],
): string {
  const labels = cells.map((cell) => `${formatResultVersion(results, cell)} + ${formatResultEval(results, cell)} + ${formatResultAgent(results, cell)}`);
  const shown = labels.slice(0, 6);
  const extra = labels.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} and ${extra} more` : shown.join(", ");
}

function formatResultVersionList(versions: WorkbenchResults["skillVersions"]): string {
  return versions.map((version) => version.label).join(", ");
}

function formatResultVersion(
  results: WorkbenchResults,
  cell: WorkbenchResults["cells"][number],
): string {
  const version = results.skillVersions.find((entry) => entry.id === cell.skillVersionId);
  if (!version) {
    return displayRef(cell.skillVersionId);
  }
  return `${version.label}${version.current ? " · Current" : ""}`;
}

function formatResultEval(
  results: WorkbenchResults,
  cell: WorkbenchResults["cells"][number],
): string {
  const version = results.evalVersions.find((entry) => entry.id === cell.evalVersionId);
  return version ? formatResultEvalLabel(version) : cell.evalVersionId;
}

function formatResultEvalLabel(version: WorkbenchResults["evalVersions"][number]): string {
  return `${version.label}${version.current ? " current" : ""}`;
}

function formatResultAgent(results: WorkbenchResults, cell: WorkbenchResults["cells"][number]): string {
  const agent = results.agentVersions.find((entry) => entry.id === cell.agentVersionId);
  return agent?.label ?? displayRef(cell.agentVersionId);
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

function traceRecordDetail(trace: WorkbenchTrace) {
  const files = trace.files.filter(isUserFacingTraceEvidenceFile);
  const projection = workbenchTraceProjection(trace);
  return {
    ...(traceSummary(trace) as Record<string, Json>),
    ...(trace.source ? { source: trace.source } : {}),
    ...(trace.status ? { status: trace.status } : {}),
    ...(trace.links ? { links: trace.links } : {}),
    ...(projection.prompt ? { prompt: projection.prompt } : {}),
    ...(projection.output ? { output: projection.output } : {}),
    files: files.map((file) => fileSummary(file, showFileRef(trace.id, file.path))),
    next: "workbench eval results",
  };
}

function formatTraceRecordDetail(trace: WorkbenchTrace): string {
  const files = trace.files.filter(isUserFacingTraceEvidenceFile);
  const projection = workbenchTraceProjection(trace);
  const next = "workbench eval results";
  return [
    `${displayRef(trace.id)}\tstatus=${projection.lifecycleStatus}`,
    `run=${displayRef(trace.runId)}\tjob=${trace.jobId ? displayRef(trace.jobId) : "n/a"}\tversion=${displayRef(trace.versionId)}\tskill=${trace.skillName}\tagent=${trace.agentName}`,
    ...(trace.source?.adapterId || trace.source?.sessionId || trace.source?.turnId
      ? [`source=${[trace.source.adapterId, trace.source.sessionId, trace.source.turnId].filter(Boolean).join("/")}`]
      : []),
    ...(projection.prompt ? ["", "Input:", ...previewBlock(projection.prompt, 1200, 12).split("\n")] : []),
    ...(projection.output ? ["", "Output:", ...previewBlock(projection.output, 1200, 12).split("\n")] : []),
    "",
    `files=${files.length}`,
    ...files.slice(0, 10).map((file) => `  ${showFileRef(trace.id, file.path)}`),
    ...(files.length > 10 ? [`  ... ${files.length - 10} more`] : []),
    `next: ${next}`,
  ].join("\n");
}

function traceSummary(trace: WorkbenchTrace) {
  const result = asRecord(trace.result);
  const projection = workbenchTraceProjection(trace);
  const status = trace.status || typeof result?.status === "string" ? projection.lifecycleStatus : undefined;
  return {
    id: trace.id,
    runId: trace.runId,
    ...(trace.jobId ? { jobId: trace.jobId } : {}),
    versionId: trace.versionId,
    skillName: trace.skillName,
    agentName: trace.agentName,
    createdAt: trace.createdAt,
    ...(trace.updatedAt ? { updatedAt: trace.updatedAt } : {}),
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
      `${formatExecutionEvidenceLabel(detail, execution)}\trun=${refs.runRefs?.get(detail.runId) ?? displayRef(detail.runId)}\tjobs=${execution.jobIds.join(",")}\tstatus=${execution.status}`,
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
