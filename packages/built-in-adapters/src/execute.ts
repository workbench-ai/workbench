import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  EvalCaseResult,
  Json,
  SurfaceSnapshotFile,
  UsageSummary,
  WorkbenchCandidatePatch,
} from "@workbench-ai/workbench-contract";
import type {
  WorkbenchAdapterCommandRequest,
} from "@workbench-ai/workbench-core";

import {
  defaultWorkbenchAgentTurnExecutor,
  executeWorkbenchAgentTurn,
  type AgentProviderSpec,
  type WorkbenchAgentTurnExecutor,
  type WorkbenchAgentTurnResult,
} from "./agent-turn.ts";
import {
  isWorkbenchBuiltInAdapterId,
  type WorkbenchBuiltInAdapterId,
} from "./manifests.ts";
import { importWorkbenchRuntime } from "./runtime.ts";

export interface ExecuteWorkbenchBuiltInAdapterCommandOptions {
  adapterId?: string;
  requestPath?: string;
  outputRoot?: string;
  agentExecutor?: WorkbenchAgentTurnExecutor;
  adapterAuthRoot?: string;
  adapterAuthRequest?: Json;
  adapterAuthEnv?: Record<string, string>;
}

interface BuiltInAgentAdapterSpec {
  agent: AgentProviderSpec;
  instructions?: string;
}

interface BuiltInRubricAdapterSpec {
  judge: AgentProviderSpec;
  instructions?: string;
  criteria: RubricCriterionSpec[];
}

interface RubricCriterionSpec {
  id: string;
  description: string;
  weight?: number;
}

interface AdapterWorkload {
  job: { id: string };
  benchmark: {
    name: string;
    description: string;
  };
  candidate: {
    path: string;
  };
  optimizer: {
    edits: string[];
  };
  candidateId: string;
  trialIndex: number;
  sampleIndex: number;
  caseId: string;
  task?: {
    task: string;
  };
}

export async function executeWorkbenchBuiltInAdapterCommand(
  args: ExecuteWorkbenchBuiltInAdapterCommandOptions = {},
): Promise<void> {
  const runtime = await importWorkbenchRuntime();
  const request = await runtime.readWorkbenchAdapterCommandRequest(args.requestPath);
  const adapterId = args.adapterId ?? request.adapter.use;
  if (adapterId !== request.adapter.use) {
    throw new Error(`Adapter command ${adapterId} cannot execute request for ${request.adapter.use}.`);
  }
  if (!isWorkbenchBuiltInAdapterId(adapterId)) {
    throw new Error(`Unsupported built-in Workbench adapter: ${adapterId}.`);
  }
  if (args.outputRoot && args.outputRoot !== request.paths.output) {
    request.paths.output = args.outputRoot;
  }
  await runtime.ensureWorkbenchAdapterOutputDir(request);
  if (adapterId === "command") {
    await executeCommandAdapterRequest(request);
    return;
  }
  if (adapterId === "tests") {
    await executeTestsScorerRequest(request);
    return;
  }
  if (adapterId === "rubric") {
    if (request.execution.role !== "grader") {
      throw new Error(`Rubric adapter cannot handle ${request.execution.role} executions.`);
    }
    await writeRubricJudgeScorecard(
      request,
      workloadFromAdapterCommandRequest(request),
      builtInRubricSpecFromRequest(request),
      {
        agentExecutor: args.agentExecutor,
        adapterAuthRoot: args.adapterAuthRoot,
        adapterAuthRequest: args.adapterAuthRequest ?? request.auth,
        adapterAuthEnv: args.adapterAuthEnv,
      },
    );
    return;
  }
  if (isBuiltInAgentAdapterId(adapterId)) {
    const workload = workloadFromAdapterCommandRequest(request);
    const agent = builtInAgentSpecFromRequest(request);
    if (request.execution.purpose === "improve") {
      await writeAgentProposalOutput(request, workload, agent, {
        agentExecutor: args.agentExecutor,
        adapterAuthRoot: args.adapterAuthRoot,
        adapterAuthRequest: args.adapterAuthRequest ?? request.auth,
        adapterAuthEnv: args.adapterAuthEnv,
      });
      return;
    }
    if (request.execution.role === "runner") {
      await writeAgentRunnerOutput(request, workload, agent, {
        agentExecutor: args.agentExecutor,
        adapterAuthRoot: args.adapterAuthRoot,
        adapterAuthRequest: args.adapterAuthRequest ?? request.auth,
        adapterAuthEnv: args.adapterAuthEnv,
      });
      return;
    }
    throw new Error(`Agent adapter ${adapterId} cannot handle ${request.execution.purpose} executions.`);
  }
}

async function executeCommandAdapterRequest(
  request: WorkbenchAdapterCommandRequest,
): Promise<void> {
  const runtime = await importWorkbenchRuntime();
  const command = requiredAdapterCommandString(request, "command");
  await runAdapterShellCommand(command, request.paths.cwd ?? request.paths.workspace);
  await runtime.writeWorkbenchAdapterResultMetadata(request.paths.output, {
    ok: true,
  });
}

async function executeTestsScorerRequest(
  request: WorkbenchAdapterCommandRequest,
): Promise<void> {
  if (request.execution.role !== "grader") {
    throw new Error(`Tests adapter cannot handle ${request.execution.role} executions.`);
  }
  const runtime = await importWorkbenchRuntime();
  const testsRoot = request.paths.tests ?? path.join(request.paths.workspace, "tests");
  const logsRoot = request.paths.logs ?? path.join(request.paths.workspace, "logs");
  const verifierLogs = path.join(logsRoot, "verifier");
  await fs.mkdir(verifierLogs, { recursive: true });
  const script = await firstExistingFile([
    path.join(testsRoot, "test.sh"),
    path.join(testsRoot, "run.sh"),
  ]);
  if (!script) {
    throw new Error(`Tests scorer requires ${path.join(testsRoot, "test.sh")}.`);
  }
  await runAdapterShellCommand(`sh ${shellQuote(script)}`, request.paths.cwd ?? request.paths.workspace);
  const scorecard = await readTestsScorecard({
    outputRoot: request.paths.output,
    logsRoot,
    caseId: request.execution.caseId ?? "current",
  });
  await fs.mkdir(request.paths.output, { recursive: true });
  await fs.writeFile(
    path.join(request.paths.output, "scorecard.json"),
    `${JSON.stringify(scorecard, null, 2)}\n`,
  );
  await runtime.writeWorkbenchAdapterResultMetadata(request.paths.output, {
    ok: true,
    ...(typeof scorecard.summary === "string" ? { summary: scorecard.summary } : {}),
    feedback: {
      scorer: "tests",
    },
  });
}

async function runAdapterShellCommand(command: string, cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sh", ["-lc", command], {
      cwd,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        code === null
          ? `Command adapter exited from signal ${signal ?? "unknown"}.`
          : `Command adapter exited with status ${code}.`,
      ));
    });
  });
}

async function firstExistingFile(files: readonly string[]): Promise<string | null> {
  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isFile()) {
      return file;
    }
  }
  return null;
}

async function readTestsScorecard(args: {
  outputRoot: string;
  logsRoot: string;
  caseId: string;
}): Promise<Record<string, Json>> {
  const direct = await readOptionalJson(path.join(args.outputRoot, "scorecard.json"));
  if (direct) {
    return normalizeTestsScorecard(direct, args.caseId);
  }
  const rewardJson = await readOptionalJson(path.join(args.logsRoot, "verifier", "reward.json"));
  if (rewardJson) {
    return normalizeTestsScorecard(rewardJson, args.caseId);
  }
  const rewardText = await fs.readFile(path.join(args.logsRoot, "verifier", "reward.txt"), "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (rewardText !== null) {
    const score = Number.parseFloat(rewardText.trim());
    if (!Number.isFinite(score)) {
      throw new Error("Tests scorer reward.txt must contain a finite numeric reward.");
    }
    return normalizeTestsScorecard({ reward: score }, args.caseId);
  }
  throw new Error("Tests scorer did not find scorecard.json, /logs/verifier/reward.json, or /logs/verifier/reward.txt.");
}

async function readOptionalJson(filePath: string): Promise<Record<string, unknown> | null> {
  const source = await fs.readFile(filePath, "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (source === null) {
    return null;
  }
  const parsed = JSON.parse(source) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function normalizeTestsScorecard(
  record: Record<string, unknown>,
  caseId: string,
): Record<string, Json> {
  const rawScore = typeof record.score === "number"
    ? record.score
    : typeof record.reward === "number"
      ? record.reward
      : undefined;
  if (rawScore === undefined || !Number.isFinite(rawScore)) {
    throw new Error("Tests scorer reward must include a finite numeric score or reward.");
  }
  const metrics = normalizeTestsMetrics(record, rawScore);
  return {
    score: rawScore,
    metrics,
    cases: [{
      id: caseId,
      status: "completed",
      metrics,
    }] as unknown as Json,
    ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
    feedback: {
      reward: record as Json,
    },
  };
}

function normalizeTestsMetrics(record: Record<string, unknown>, score: number): Record<string, number> {
  const metrics: Record<string, number> = { score };
  const source = record.metrics && typeof record.metrics === "object" && !Array.isArray(record.metrics)
    ? record.metrics as Record<string, unknown>
    : record;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      metrics[key === "reward" ? "score" : key] = value;
    }
  }
  return metrics;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function workloadFromAdapterCommandRequest(
  request: WorkbenchAdapterCommandRequest,
): AdapterWorkload {
  const execution = request.execution;
  return {
    job: { id: execution.jobId ?? execution.id },
    benchmark: {
      name: request.benchmark?.name ?? "",
      description: request.benchmark?.description ?? "",
    },
    candidate: {
      path: request.candidate?.path ?? "",
    },
    optimizer: {
      edits: request.optimizer?.edits ?? [],
    },
    candidateId: execution.candidateId ?? "",
    trialIndex: execution.trialIndex ?? 0,
    sampleIndex: execution.sampleIndex ?? 0,
    caseId: execution.caseId ?? "",
    ...(request.task?.text ? { task: { task: request.task.text } } : {}),
  };
}

function isBuiltInAgentAdapterId(
  value: string,
): value is Extract<WorkbenchBuiltInAdapterId, "codex" | "claude" | "pi"> {
  return value === "codex" || value === "claude" || value === "pi";
}

function builtInAgentSpecFromRequest(
  request: WorkbenchAdapterCommandRequest,
): BuiltInAgentAdapterSpec {
  const config = adapterCommandConfigRecord(request);
  return {
    agent: agentProviderFromAdapterCommandRequest(request),
    ...(typeof config.instructions === "string" && config.instructions.length > 0
      ? { instructions: config.instructions }
      : {}),
  };
}

function builtInRubricSpecFromRequest(
  request: WorkbenchAdapterCommandRequest,
): BuiltInRubricAdapterSpec {
  const config = adapterCommandConfigRecord(request);
  return {
    judge: rubricJudgeProviderFromAdapterCommandRequest(request),
    ...(typeof config.instructions === "string" && config.instructions.length > 0
      ? { instructions: config.instructions }
      : {}),
    criteria: rubricCriteria(config.criteria, "adapter.with.criteria"),
  };
}

function agentProviderFromAdapterCommandRequest(
  request: WorkbenchAdapterCommandRequest,
): AgentProviderSpec {
  const config = adapterCommandConfigRecord(request);
  return {
    use: request.adapter.use,
    ...(typeof config.model === "string" && config.model.length > 0
      ? { model: config.model }
      : {}),
    ...(typeof config.effort === "string" && config.effort.length > 0
      ? { effort: config.effort }
      : {}),
  };
}

function rubricJudgeProviderFromAdapterCommandRequest(
  request: WorkbenchAdapterCommandRequest,
): AgentProviderSpec {
  const judge = jsonRecord(adapterCommandConfigRecord(request).judge);
  const use = typeof judge?.use === "string" && judge.use.length > 0
    ? judge.use
    : "";
  if (!use) {
    throw new Error("Rubric adapter requires adapter.with.judge.use.");
  }
  const config = jsonRecord(judge?.with) ?? {};
  return {
    use,
    ...(typeof config.model === "string" && config.model.length > 0
      ? { model: config.model }
      : {}),
    ...(typeof config.effort === "string" && config.effort.length > 0
      ? { effort: config.effort }
      : {}),
  };
}

function adapterCommandConfigRecord(
  request: WorkbenchAdapterCommandRequest,
): Record<string, Json> {
  return jsonRecord(request.adapter.with);
}

function requiredAdapterCommandString(
  request: WorkbenchAdapterCommandRequest,
  key: string,
): string {
  const value = adapterCommandConfigRecord(request)[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Adapter ${request.adapter.use} requires adapter.with.${key}.`);
  }
  return value;
}

async function writeAgentRunnerOutput(
  request: WorkbenchAdapterCommandRequest,
  workload: AdapterWorkload,
  runner: BuiltInAgentAdapterSpec,
  options: {
    agentExecutor?: WorkbenchAgentTurnExecutor;
    adapterAuthRoot?: string;
    adapterAuthRequest?: Json;
    adapterAuthEnv?: Record<string, string>;
  } = {},
): Promise<void> {
  if (request.execution.role !== "runner") {
    throw new Error("Agent runner results can only complete runner executions.");
  }
  const traceRoot = path.join(request.paths.output, ".workbench", "internal", "agent-runner");
  const agentResult = await executeWorkbenchAgentTurn(
    options.agentExecutor ?? defaultWorkbenchAgentTurnExecutor,
    {
      role: "runner",
      provider: runner.agent,
      adapterAuthRoot: options.adapterAuthRoot,
      adapterAuthRequest: options.adapterAuthRequest,
      adapterAuthEnv: options.adapterAuthEnv,
      workspaceRoot: request.paths.workspace,
      cwd: request.paths.cwd ?? request.paths.workspace,
      prompt: buildAgentRunnerPrompt(workload, runner),
      traceRoot,
      jobId: workload.job.id,
    },
  );
  const outputPath = path.join(request.paths.output, "runner-summary.md");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, agentResult.output);
  const trace: SurfaceSnapshotFile = {
    path: `.workbench/traces/${workload.job.id}/runner.json`,
    kind: "text",
    encoding: "utf8",
    executable: false,
    content: `${JSON.stringify({
      kind: "agent_runner",
      provider: runner.agent.use,
      candidateId: workload.candidateId,
      trialIndex: workload.trialIndex,
      sampleIndex: workload.sampleIndex,
      summary: agentResult.output,
      metadata: agentResult.metadata,
    }, null, 2)}\n`,
  };
  await writeSurfaceFiles(request.paths.output, [trace, ...agentResult.traceFiles]);
  const runtime = await importWorkbenchRuntime();
  const usage = runtime.assignUsageRole("runner", agentResult.usage);
  await runtime.writeWorkbenchAdapterResultMetadata(request.paths.output, {
    ok: true,
    ...(agentResult.output ? { summary: agentResult.output } : {}),
    feedback: {
      runner: "agent",
      agent: runner.agent.use,
      metadata: agentResult.metadata,
    },
    ...(usage ? { usage } : {}),
  });
}

function buildAgentRunnerPrompt(
  workload: AdapterWorkload,
  runner: BuiltInAgentAdapterSpec,
): string {
  return [
    ...(runner.instructions ? ["Instructions:", runner.instructions, ""] : []),
    "Context:",
    "- Candidate files are mounted at /workspace/input/candidate.",
    "- Subject files are also present in the task working directory.",
    ...(workload.task?.task ? ["Task:", workload.task.task, ""] : []),
    "- Public task files are already copied into the current working directory.",
    "- Verifier tests are not present while you run.",
    "- Mutate the current working directory to complete the task.",
    "- You may write inspection artifacts under /workspace/output.",
  ].join("\n");
}

async function writeAgentProposalOutput(
  request: WorkbenchAdapterCommandRequest,
  workload: AdapterWorkload,
  optimizer: BuiltInAgentAdapterSpec,
  options: {
    agentExecutor?: WorkbenchAgentTurnExecutor;
    adapterAuthRoot?: string;
    adapterAuthRequest?: Json;
    adapterAuthEnv?: Record<string, string>;
  },
): Promise<void> {
  if (request.execution.purpose !== "improve") {
    throw new Error("Agent proposal results can only complete improve executions.");
  }
  const traceRoot = path.join(request.paths.output, ".workbench", "internal", "agent-optimizer");
  const agentResult = await executeWorkbenchAgentTurn(
    options.agentExecutor ?? defaultWorkbenchAgentTurnExecutor,
    {
      role: "optimizer",
      provider: optimizer.agent,
      adapterAuthRoot: options.adapterAuthRoot,
      adapterAuthRequest: options.adapterAuthRequest,
      adapterAuthEnv: options.adapterAuthEnv,
      workspaceRoot: request.paths.workspace,
      cwd: request.paths.workspace,
      prompt: buildAgentOptimizerPrompt(workload),
      traceRoot,
      jobId: workload.job.id,
    },
  );
  const candidatePatch = normalizeCandidatePatchManifest(
    await readRequiredRuntimeResult(
      path.join(request.paths.output, "candidate_patch.json"),
      "candidate patch",
    ),
  );
  const changedCandidatePaths = candidatePatch.fileChanges.filter((filePath) =>
    isCandidateEditPath(filePath, workload.optimizer.edits),
  );
  if (changedCandidatePaths.length === 0) {
    throw new Error("Agent improve adapter completed without writing a change covered by optimizer edits to /workspace/output/candidate_patch.json.");
  }
  const trace: SurfaceSnapshotFile = {
    path: `.workbench/traces/${workload.job.id}/optimizer.json`,
    kind: "text",
    encoding: "utf8",
    executable: false,
    content: `${JSON.stringify({
      kind: "agent_optimizer",
      provider: optimizer.agent.use,
      candidateId: workload.candidateId,
      trialIndex: workload.trialIndex,
      changedPaths: changedCandidatePaths,
      summary: agentResult.output,
      metadata: agentResult.metadata,
    }, null, 2)}\n`,
  };
  await writeSurfaceFiles(request.paths.output, [trace, ...agentResult.traceFiles]);
  const runtime = await importWorkbenchRuntime();
  const usage = runtime.assignUsageRole("optimizer", agentResult.usage);
  await runtime.writeWorkbenchAdapterResultMetadata(request.paths.output, {
    ok: true,
    ...(agentResult.output ? { summary: agentResult.output } : {}),
    feedback: {
      optimizer: optimizer.agent.use,
      changedPaths: changedCandidatePaths,
      metadata: agentResult.metadata,
    },
    ...(usage ? { usage } : {}),
  });
}

function buildAgentOptimizerPrompt(workload: AdapterWorkload): string {
  return [
    "Benchmark:",
    workload.benchmark.description || workload.benchmark.name,
    "",
    "Context:",
    "- Candidate files are mounted at /workspace/input/candidate.",
    "- Prior run traces are mounted at /workspace/input/traces.",
    "- Use /workspace/input/traces as the source of truth for what happened in prior attempts.",
    "- Do not mutate /workspace/input.",
    "",
    "Editable candidate paths:",
    workload.optimizer.edits.map((entry) => `- ${entry}`).join("\n"),
    "",
    "Output:",
    "- Write /workspace/output/candidate_patch.json.",
    "- Include at least one changed candidate file covered by the optimizer edits list.",
    'Candidate patch manifest shape: {"files":[{"path":"relative/path","encoding":"utf8","content":"complete file contents","executable":false}],"fileChanges":["relative/path"],"summary":"..."}',
  ].join("\n");
}

async function writeRubricJudgeScorecard(
  request: WorkbenchAdapterCommandRequest,
  workload: AdapterWorkload,
  grader: BuiltInRubricAdapterSpec,
  options: {
    agentExecutor?: WorkbenchAgentTurnExecutor;
    adapterAuthRoot?: string;
    adapterAuthRequest?: Json;
    adapterAuthEnv?: Record<string, string>;
  } = {},
): Promise<void> {
  const agentExecutor = options.agentExecutor ?? defaultWorkbenchAgentTurnExecutor;
  const agentResult = await executeWorkbenchAgentTurn(agentExecutor, {
    role: "grader",
    provider: grader.judge,
    adapterAuthRoot: options.adapterAuthRoot,
    adapterAuthRequest: options.adapterAuthRequest,
    adapterAuthEnv: options.adapterAuthEnv,
    workspaceRoot: request.paths.workspace,
    cwd: request.paths.cwd ?? request.paths.workspace,
    prompt: buildRubricJudgePrompt(workload, grader),
    traceRoot: path.join(request.paths.output, ".workbench", "internal", "rubric-grader"),
    jobId: workload.job.id,
  });
  const runtime = await importWorkbenchRuntime();
  let usage = runtime.assignUsageRole("grader", agentResult.usage);
  let scorecardAgentResult = agentResult;
  let scorecard: Record<string, Json>;
  try {
    scorecard = normalizeRubricJudgeScorecard(agentResult.output, workload, grader, agentResult);
  } catch (error) {
    const repairError = error instanceof Error ? error.message : String(error);
    const repairResult = await executeWorkbenchAgentTurn(agentExecutor, {
      role: "grader",
      provider: grader.judge,
      adapterAuthRoot: options.adapterAuthRoot,
      adapterAuthRequest: options.adapterAuthRequest,
      adapterAuthEnv: options.adapterAuthEnv,
      workspaceRoot: request.paths.workspace,
      cwd: request.paths.workspace,
      prompt: buildRubricJudgeRepairPrompt({
        output: agentResult.output,
        error: repairError,
        workload,
        grader,
      }),
      traceRoot: path.join(request.paths.output, ".workbench", "internal", "rubric-grader-repair"),
      jobId: workload.job.id,
    });
    usage = runtime.mergeUsageSummaries([
      usage,
      runtime.assignUsageRole("grader", repairResult.usage),
    ]);
    scorecardAgentResult = {
      ...repairResult,
      ...(usage ? { usage } : {}),
      metadata: {
        ...repairResult.metadata,
        repair: {
          attempted: true,
          originalError: repairError,
          originalMetadata: agentResult.metadata,
        },
      },
    };
    scorecard = normalizeRubricJudgeScorecard(repairResult.output, workload, grader, scorecardAgentResult);
  }
  await fs.writeFile(
    path.join(request.paths.output, "scorecard.json"),
    `${JSON.stringify(scorecard, null, 2)}\n`,
  );
  await runtime.writeWorkbenchAdapterResultMetadata(request.paths.output, {
    ok: true,
    ...(typeof scorecard.summary === "string" ? { summary: scorecard.summary } : {}),
    feedback: {
      rubric: "judge",
      judge: grader.judge.use,
      metadata: scorecardAgentResult.metadata,
    },
    ...(usage ? { usage } : {}),
  });
}

function buildRubricJudgePrompt(
  workload: AdapterWorkload,
  grader: BuiltInRubricAdapterSpec,
): string {
  requireWorkloadTask(workload, "Rubric judge");
  return [
    ...(grader.instructions ? ["Instructions:", grader.instructions, ""] : []),
    ...(workload.task?.task ? ["Task:", workload.task.task, ""] : []),
    "Criteria:",
    JSON.stringify(grader.criteria, null, 2),
    "",
    "Context:",
    "- The subject already ran in this same working directory.",
    "- Public task files and subject outputs are available in the current working directory.",
    "- Verifier-only files are mounted at /tests when the task provides them.",
    "- Workbench will persist your JSON result to /workspace/output/scorecard.json.",
    "- Score only from the current working directory, /tests, and the criteria above.",
    "",
    "Output:",
    "Return only a JSON object. Do not wrap it in Markdown.",
    "The JSON object must include a finite numeric score and one result for every criterion id. Use this shape:",
    JSON.stringify({
      score: 0.0,
      summary: "short grading summary",
      criteria: [{
        criterion_id: "criterion id",
        score: 0.0,
        pass: false,
        rationale: "why this criterion received this score",
      }],
      feedback: {},
    }, null, 2),
    "Allowed criterion ids:",
    grader.criteria.map((criterion) => `- ${criterion.id}`).join("\n"),
    "Every criterion object must use one allowed criterion_id exactly and include a non-empty rationale string.",
  ].join("\n");
}

function buildRubricJudgeRepairPrompt(input: {
  output: string;
  error: string;
  workload: AdapterWorkload;
  grader: BuiltInRubricAdapterSpec;
}): string {
  return [
    "The previous Workbench rubric judge response was rejected by the scorecard parser.",
    "",
    `Parser error: ${input.error}`,
    "",
    "Convert the previous response into one valid JSON object. Return only JSON, with no Markdown.",
    "Preserve the prior scores, criteria, rationales, and feedback whenever they are present.",
    "If the previous response uses clear qualitative scoring, convert only these terms: perfect/full pass/pass = 1, fail/no credit = 0, partial = 0.5.",
    "If a required criterion is still not recoverable from the previous response, include that criterion with score 0, pass false, and rationale \"The judge response did not provide a recoverable score and rationale for this criterion.\"",
    "Do not invent file paths, log paths, or extra criterion ids.",
    "",
    "Required JSON shape:",
    JSON.stringify({
      score: 0.0,
      summary: "short grading summary",
      criteria: [{
        criterion_id: "criterion id",
        score: 0.0,
        pass: false,
        rationale: "why this criterion received this score",
      }],
      feedback: {},
    }, null, 2),
    "",
    "Allowed criterion ids:",
    input.grader.criteria.map((criterion) => `- ${criterion.id}`).join("\n"),
    "",
    "Previous response:",
    input.output,
  ].join("\n");
}

function normalizeRubricJudgeScorecard(
  output: string,
  workload: AdapterWorkload,
  grader: BuiltInRubricAdapterSpec,
  agentResult: WorkbenchAgentTurnResult,
): Record<string, Json> {
  const parsed = parseAgentJsonObject(output, "Rubric judge");
  const parsedCriteria = normalizeRubricJudgeCriteria(
    parsed.criteria ?? parsed.criteria_results,
    grader.criteria,
  );
  assertCompleteRubricCriteria(parsedCriteria, grader.criteria);
  const explicitScore = isBoundedScore(parsed.score) ? parsed.score : undefined;
  const criteria = parsedCriteria;
  const score = explicitScore ?? weightedCriteriaScore(criteria, grader.criteria);
  if (!isBoundedScore(score)) {
    throw new Error("Rubric judge output must include a score or criterion scores in the 0..1 range.");
  }
  const metrics: Record<string, number> = { score };
  for (const criterion of criteria) {
    metrics[`criterion__${criterion.criterion_id}`] = criterion.score;
  }
  const summary = typeof parsed.summary === "string" ? parsed.summary : undefined;
  const caseResult = rubricJudgeCaseResult({
    workload,
    score,
    criteria,
  });
  return {
    score,
    metrics,
    ...(summary ? { summary } : {}),
    cases: [caseResult] as unknown as Json,
    feedback: {
      judge: grader.judge.use,
      ...(parsed.feedback !== undefined ? { detail: parsed.feedback as Json } : {}),
      metadata: agentResult.metadata,
    },
  };
}

function rubricJudgeCaseResult(args: {
  workload: AdapterWorkload;
  score: number;
  criteria: NonNullable<EvalCaseResult["criteria"]>;
}): EvalCaseResult {
  return {
    id: args.workload.caseId,
    status: "completed",
    metrics: { score: args.score },
    criteria: args.criteria,
  };
}

function normalizeRubricJudgeCriteria(
  value: unknown,
  specCriteria: readonly RubricCriterionSpec[],
): NonNullable<EvalCaseResult["criteria"]> {
  if (!Array.isArray(value)) {
    return [];
  }
  const knownIds = new Set(specCriteria.map((criterion) => criterion.id));
  return value.flatMap((entry): NonNullable<EvalCaseResult["criteria"]> => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const criterionId =
      typeof record.criterion_id === "string"
        ? record.criterion_id
        : typeof record.id === "string"
          ? record.id
          : "";
    if (!criterionId || (knownIds.size > 0 && !knownIds.has(criterionId))) {
      return [];
    }
    const score = isBoundedScore(record.score) ? record.score : undefined;
    if (score === undefined) {
      return [];
    }
    const pass = typeof record.pass === "boolean" ? record.pass : score >= 0.5;
    const rationale = readCriterionRationale(record);
    if (!rationale) {
      return [];
    }
    return [{
      criterion_id: criterionId,
      label: typeof record.label === "string" ? record.label : criterionId,
      score,
      pass,
      rationale,
    }];
  });
}

function assertCompleteRubricCriteria(
  criteria: readonly NonNullable<EvalCaseResult["criteria"]>[number][],
  specCriteria: readonly RubricCriterionSpec[],
): void {
  const scoredIds = new Set(criteria.map((criterion) => criterion.criterion_id));
  const missing = specCriteria
    .map((criterion) => criterion.id)
    .filter((criterionId) => !scoredIds.has(criterionId));
  if (missing.length > 0) {
    throw new Error(`Rubric judge output must include a score and rationale for every criterion id. Missing: ${missing.join(", ")}.`);
  }
}

function readCriterionRationale(record: Record<string, unknown>): string | undefined {
  for (const key of ["rationale", "feedback", "reason", "explanation"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function rubricCriteria(value: unknown, label: string): RubricCriterionSpec[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const record = jsonRecord(entry);
    const id = record.id;
    const description = record.description;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`Spec must include ${label}[${index}].id.`);
    }
    if (seen.has(id)) {
      throw new Error(`${label}[${index}].id duplicates another rubric criterion id.`);
    }
    seen.add(id);
    if (typeof description !== "string" || description.length === 0) {
      throw new Error(`Spec must include ${label}[${index}].description.`);
    }
    return {
      id,
      description,
      ...(typeof record.weight === "number" ? { weight: record.weight } : {}),
    };
  });
}

function requireWorkloadTask(workload: AdapterWorkload, label: string): void {
  if (!workload.task) {
    throw new Error(`${label} workload is missing task text.`);
  }
}

async function readRequiredRuntimeResult(
  resultPath: string,
  label: string,
): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await fs.readFile(resultPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} manifest must be a JSON object: ${resultPath}`);
  }
  return parsed as Record<string, unknown>;
}

function normalizeCandidatePatchManifest(value: Record<string, unknown>): WorkbenchCandidatePatch {
  const files = Array.isArray(value.files)
    ? normalizeManifestSurfaceFiles(value.files)
    : [];
  if (!Array.isArray(value.fileChanges)) {
    throw new Error("candidate patch manifest must include fileChanges.");
  }
  const fileChanges = value.fileChanges
    .filter((entry): entry is string => typeof entry === "string")
    .map(normalizeRelativePath);
  if (fileChanges.length !== value.fileChanges.length) {
    throw new Error("candidate patch fileChanges must be relative path strings.");
  }
  return {
    files,
    fileChanges,
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(isJsonPayload(value.feedback) ? { feedback: value.feedback } : {}),
  };
}

function normalizeManifestSurfaceFiles(value: readonly unknown[]): SurfaceSnapshotFile[] {
  return value
    .flatMap((entry): SurfaceSnapshotFile[] => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }
      const record = entry as Record<string, unknown>;
      const filePath =
        typeof record.path === "string" && record.path.trim().length > 0
          ? normalizeRelativePath(record.path)
          : "";
      const content = typeof record.content === "string" ? record.content : undefined;
      const encoding = record.encoding === "base64" ? "base64" : "utf8";
      if (!filePath || content === undefined) {
        return [];
      }
      return [{
        path: filePath,
        kind: encoding === "base64" ? "binary" : "text",
        encoding,
        content,
        executable: record.executable === true,
      }];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function writeSurfaceFiles(
  root: string,
  files: readonly SurfaceSnapshotFile[],
): Promise<void> {
  for (const file of files) {
    const target = path.join(root, normalizeRelativePath(file.path));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const body = file.encoding === "base64"
      ? Buffer.from(file.content, "base64")
      : Buffer.from(file.content, "utf8");
    await fs.writeFile(target, body);
    if (file.executable) {
      await fs.chmod(target, 0o755).catch(() => undefined);
    }
  }
}

function isCandidateEditPath(filePath: string, edits: readonly string[]): boolean {
  const normalized = normalizeRelativePath(filePath);
  return edits.some((entry) => {
    const editPath = normalizeRelativePath(entry).replace(/\/+$/u, "");
    return normalized === editPath || normalized.startsWith(`${editPath}/`);
  });
}

function normalizeRelativePath(filePath: string): string {
  const normalized = filePath.replace(/\\/gu, "/").replace(/^\/+/u, "");
  return normalized.split("/").filter(Boolean).join("/");
}

function parseAgentJsonObject(output: string, label: string): Record<string, unknown> {
  const trimmed = output.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error(`${label} output must be a JSON object.`);
  }
  let parsed: unknown;
  const jsonText = trimmed.slice(start, end + 1);
  try {
    parsed = parseAgentJsonText(jsonText);
  } catch (error) {
    throw new Error(`${label} output must parse as a JSON object: ${error instanceof Error ? error.message : String(error)}.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} output must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseAgentJsonText(jsonText: string): unknown {
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const repaired = repairInvalidJsonStringEscapes(jsonText);
    if (repaired !== jsonText) {
      try {
        return JSON.parse(repaired);
      } catch {
        // Preserve the original parse error; it points at the model output.
      }
    }
    throw error;
  }
}

function repairInvalidJsonStringEscapes(jsonText: string): string {
  let repaired = "";
  let inString = false;
  let escaped = false;
  for (const char of jsonText) {
    if (!inString) {
      repaired += char;
      if (char === "\"") {
        inString = true;
      }
      continue;
    }
    if (escaped) {
      repaired += isJsonEscapeCharacter(char) ? char : `\\${char}`;
      escaped = false;
      continue;
    }
    repaired += char;
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = false;
    }
  }
  if (escaped) {
    repaired += "\\";
  }
  return repaired;
}

function isJsonEscapeCharacter(char: string): boolean {
  return char === "\""
    || char === "\\"
    || char === "/"
    || char === "b"
    || char === "f"
    || char === "n"
    || char === "r"
    || char === "t"
    || char === "u";
}

function isBoundedScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function weightedCriteriaScore(
  criteria: readonly NonNullable<EvalCaseResult["criteria"]>[number][],
  specCriteria: readonly RubricCriterionSpec[],
): number | undefined {
  if (criteria.length === 0) {
    return undefined;
  }
  const weights = new Map(specCriteria.map((criterion) => [criterion.id, criterion.weight ?? 1]));
  let numerator = 0;
  let denominator = 0;
  for (const criterion of criteria) {
    const weight = weights.get(criterion.criterion_id) ?? 1;
    numerator += criterion.score * weight;
    denominator += weight;
  }
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : undefined;
}

function jsonRecord(value: unknown): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json>
    : {};
}

function isJsonPayload(value: unknown): value is Json {
  return value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    (Array.isArray(value) && value.every(isJsonPayload)) ||
    (typeof value === "object" && value !== null && Object.values(value).every(isJsonPayload));
}
