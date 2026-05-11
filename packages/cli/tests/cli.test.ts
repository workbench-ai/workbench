import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";

import { rootUsage } from "../src/command-model";
import { composeRuntimeDockerfileWithAdapters } from "../src/adapter-project";
import { localBenchmarkFingerprint } from "../src/benchmark-fingerprint";
import { startLocalWorkbenchDevServer } from "../src/dev-open-server";
import { runCli } from "../src/index";
import { saveLocalArchive, saveLocalJobs } from "../src/local-archive";
import { readLocalProjectSource } from "../src/project-source";
import { packageRoot, productRoot } from "./test-paths";
import type {
  CandidateRecord,
  HostedWorkbenchJob,
} from "@workbench-ai/workbench-core";

const loopbackAvailable = await canBindLoopback();

async function writeDockerNodeWorkbenchSpec(
  workspace: string,
  scorecard: Record<string, unknown> = {
    score: 0.5,
    summary: "Starter local Workbench run completed.",
    fileChanges: ["prompt.md"],
  },
): Promise<void> {
  const runnerCommand = JSON.stringify("node -e \"const fs=require('fs'),path=require('path');const out='/workspace/output';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'runner-summary.md'),'runner completed\\n');\"");
  const optimizerCommand = JSON.stringify("node -e \"process.exit(1)\"");
  const scorecardPayload = Buffer.from(JSON.stringify(scorecard), "utf8").toString("base64");
  const graderCommand = JSON.stringify(`node -e "const fs=require('fs'),path=require('path');const out='/workspace/output';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'scorecard.json'),Buffer.from('${scorecardPayload}','base64').toString('utf8'));"`);
  await writeFile(path.join(workspace, "benchmark.yaml"), [
    "version: 1",
    "name: local-workbench",
    "description: Exercise the local command-based Workbench development path.",
    "tasks: tasks",
    "environment:",
    "  dockerfile: environment/Dockerfile",
    "grade:",
    "  use: command",
    "  with:",
    `    command: ${graderCommand}`,
    "",
  ].join("\n"));
  await mkdir(path.join(workspace, "candidates", "command", "files"), { recursive: true });
  await mkdir(path.join(workspace, "optimizers"), { recursive: true });
  await writeFile(path.join(workspace, "candidates", "command", "candidate.yaml"), [
    "version: 1",
    "name: local-command-eval",
    "run:",
    "  use: command",
    "  with:",
    `    command: ${runnerCommand}`,
    "",
  ].join("\n"));
  await writeFile(path.join(workspace, "candidates", "command", "files", "run.js"), "console.log('local command candidate');\n");
  await writeFile(path.join(workspace, "optimizers", "command.yaml"), [
    "version: 1",
    "name: local-command-eval optimizer",
    "description: Improve candidate command files for local-command-eval.",
    "edits:",
    "  - run.js",
    "improve:",
    "  use: command",
    "  with:",
    `    command: ${optimizerCommand}`,
    "",
  ].join("\n"));
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
  return path.join(workspace, "candidates", "command", "candidate.yaml");
}

function commandOptimizerSpecPath(workspace: string): string {
  return path.join(workspace, "optimizers", "command.yaml");
}

describe("workbench CLI", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("help advertises local-first workflows and hosted cloud commands", async () => {
    const io = createIo();
    const exitCode = await runCli(["--help"], io);

    expect(exitCode).toBe(0);
    expect(io.stdoutText()).toContain("workbench push [SOURCE] [--dir DIR]");
    expect(io.stdoutText()).toContain("workbench clone OWNER/BENCHMARK[@REF]");
    expect(io.stdoutText()).toContain("workbench cloud fork OWNER/BENCHMARK[@REF]");
    expect(io.stdoutText()).toContain("workbench cloud star OWNER/BENCHMARK");
    expect(io.stdoutText()).toContain("workbench init");
    expect(io.stdoutText()).toContain("workbench check [SOURCE] [--dir DIR]");
    expect(io.stdoutText()).toContain("workbench improve [SOURCE] [--dir DIR] [--from CANDIDATE_ID]");
    expect(io.stdoutText()).toContain("workbench open [SOURCE] [--dir DIR]");
    expect(io.stdoutText()).toContain("workbench cloud benchmarks|runs|candidates");
    expect(io.stdoutText()).toContain("Workbench project containing benchmark.yaml plus candidates/<name>/candidate.yaml");
    expect(io.stdoutText()).toContain("Candidate files live beside the candidate manifest");
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

  test("command help is scoped for local and cloud commands", async () => {
    const cloudIo = createIo();
    expect(await runCli(["cloud", "--help"], cloudIo)).toBe(0);
    expect(cloudIo.stdoutText()).toContain("workbench cloud <command>");
    expect(cloudIo.stdoutText()).toContain("workbench cloud open");
    expect(cloudIo.stdoutText()).toContain("workbench cloud fork OWNER/BENCHMARK[@REF]");
    const forkIo = createIo();
    expect(await runCli(["cloud", "fork", "--help"], forkIo)).toBe(0);
    expect(forkIo.stdoutText()).toContain("workbench cloud fork OWNER/BENCHMARK[@REF]");
    const starIo = createIo();
    expect(await runCli(["cloud", "star", "--help"], starIo)).toBe(0);
    expect(starIo.stdoutText()).toContain("workbench cloud star OWNER/BENCHMARK");
    const openIo = createIo();
    expect(await runCli(["open", "--help"], openIo)).toBe(0);
    expect(openIo.stdoutText()).toContain("workbench open [SOURCE] [--dir DIR]");
    expect(openIo.stdoutText()).toContain("Workbench project containing benchmark.yaml plus candidates/<name>/candidate.yaml");
    expect(openIo.stdoutText()).toContain("Keep this command running while using the local web view");
    const evalIo = createIo();
    expect(await runCli(["cloud", "eval", "--help"], evalIo)).toBe(0);
    expect(evalIo.stdoutText()).toContain("Stopping this command does not cancel the hosted run");
    const deleteIo = createIo();
    expect(await runCli(["cloud", "benchmarks", "delete", "--help"], deleteIo)).toBe(0);
    expect(deleteIo.stdoutText()).toContain("workbench cloud benchmarks delete OWNER/BENCHMARK");
    expect(deleteIo.stdoutText()).toContain("--dry-run");
    const loginIo = createIo();
    expect(await runCli(["login", "--help"], loginIo)).toBe(0);
    expect(loginIo.stdoutText()).not.toContain("Bare project commands target the current directory.");
  });

  test("keeps command docs aligned with the public CLI registry", async () => {
    const commandLines = rootUsage
      .split("\nExamples:")[0]!
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("workbench ") && !line.includes("<command>"));
    const docs = await Promise.all([
      readFile(path.join(productRoot, "docs", "cli.md"), "utf8"),
      readFile(path.join(productRoot, "SPEC.md"), "utf8"),
    ]);

    for (const command of commandLines) {
      for (const source of docs) {
        expect(source).toContain(command);
      }
    }
  });

  test("keeps public onboarding, skill metadata, and eval prompts aligned with current hosted paths", async () => {
    const webRoot = path.resolve(productRoot, "..", "workbench-cloud");
    const [
      getStartedPage,
      startTabs,
      cliDocs,
      skill,
      manifestRaw,
      agentYaml,
      skillEvalsRaw,
    ] = await Promise.all([
      readFile(path.join(webRoot, "components", "get-started-page.tsx"), "utf8"),
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

    const onboardingSource = `${getStartedPage}\n${startTabs}`;
    expect(onboardingSource).toContain("npx skills add workbench-ai/workbench");
    expect(onboardingSource).toContain("npm install -g @workbench-ai/workbench");
    expect(onboardingSource).toContain("workbench --version");
    expect(onboardingSource).toContain("workbench init --skill <benchmark-name> --agent codex");
    expect(onboardingSource).toContain("workbench eval candidates/codex --samples 1 --json");
    expect(onboardingSource).toContain("workbench cloud eval candidates/codex --samples 1 --watch --json");
    expect(onboardingSource).toContain("workbench open --json --no-open");
    expect(cliDocs).toContain("workbench init --skill invoice-review --agent codex");
    expect(cliDocs).toContain("workbench improve --budget 1 --samples 1");
    expect(cliDocs).toContain("workbench cloud improve candidates/codex --base cand_123 --optimizer optimizers/codex.yaml --budget 1 --samples 1 --watch");
    expect(cliDocs).toContain("workbench push --tag v1");
    expect(cliDocs).toContain("candidate.yaml does not declare a benchmark or path");
    expect(cliDocs).not.toContain("Paths are relative to the YAML file that declares them, or absolute.");
    expect(cliDocs).not.toContain("Agent Browser Workflow");
    expect(skill).toContain("workbench init --skill my-eval --agent codex");
    expect(skill).toContain("workbench improve --budget 1 --samples 1");
    expect(skill).toContain("workbench cloud improve candidates/codex --base cand_123 --optimizer optimizers/codex.yaml --budget 1 --samples 1 --watch");
    expect(skill).toContain("Candidate manifests do not declare a benchmark or path.");
    expect(skill).not.toContain("Paths are relative to the YAML file that declares them, or absolute.");
    expect(skill).toContain("workbench open --json --no-open");
    expect(agentYaml).toContain("install @workbench-ai/workbench");
    expect(agentYaml).toContain("workbench open --json --no-open");
    expect(agentYaml).toContain("workbench cloud eval");
    expect(agentYaml).toContain("ca-certificates");
    expect(manifest.skills[0]?.useCases.join("\n")).toContain("workbench init --skill NAME --agent ADAPTER");
    expect(manifest.skills[0]?.useCases.join("\n")).toContain("embedded browser");
    expect(manifest.skills[0]?.useCases.join("\n")).toContain("workbench open --json --no-open");
    expect(installEval?.expected_output).toContain("installs the published package");
    expect(installEval?.assertions.some((assertion) => assertion.value?.includes("@workbench-ai/workbench"))).toBe(true);
    expect(skillEvalsRaw).toContain("opens or returns the Workbench Cloud benchmark URL");
    expect(skillEvalsRaw).toContain("opens or returns the resulting candidate URL");
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
        candidate?: { path?: string; files?: number };
        optimizer?: { edits?: string[] };
        tasks?: { path?: string; cases?: number; files?: number };
        environment?: {
          network?: { egress?: string };
          resources?: { cpu?: number; memoryGb?: number; timeoutMinutes?: number };
        };
        adapters?: {
          improve?: { use?: string };
          run?: { use?: string; command?: string };
          grade?: { use?: string; command?: string };
        };
      };
    };
    expect(validation.plan?.benchmarkName).toBe("local-workbench");
    expect(validation.plan?.benchmarkDescription).toBe("Exercise the local command-based Workbench development path.");
    expect(validation.plan?.source?.dockerfile).toBe("environment/Dockerfile");
    expect(validation.plan?.candidate).toMatchObject({
      path: "candidates/command/files",
      files: 1,
    });
    expect(validation.plan?.optimizer).toMatchObject({
      edits: ["run.js"],
    });
    expect(validation.plan?.tasks).toMatchObject({
      path: "tasks",
      cases: 1,
    });
    expect(validation.plan?.environment?.network?.egress).toBe("open");
    expect(validation.plan?.environment?.resources?.timeoutMinutes).toBe(20);
    expect(validation.plan?.adapters?.improve?.use).toBe("command");
    expect(validation.plan?.adapters?.run?.use).toBe("command");
    expect(validation.plan?.adapters?.run?.command).toContain("/workspace/output");
    expect(validation.plan?.adapters?.grade?.use).toBe("command");
    const baseId = await seedLocalCandidate(workspace);
    expect(await runCli([
      "improve",
      commandCandidateSpecPath(workspace),
      "--optimizer",
      commandOptimizerSpecPath(workspace),
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
      expect(run.localView?.note).toContain("Keep this command running while using the local web view");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  test.skipIf(!loopbackAvailable)("local dev browser server exposes source and archive DTOs", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-dev-open-"));
    const assetsRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-dev-open-assets-"));
    expect(await runCli(["init", workspace, "--command", "local-command-eval", "--json"], createIo())).toBe(0);
    await writeFile(path.join(workspace, "README.md"), "local root note that should not sync\n");
    await mkdir(path.join(workspace, "docs"), { recursive: true });
    await writeFile(path.join(workspace, "docs", "notes.md"), "local docs that should not sync\n");
    const candidateId = await seedLocalCandidate(workspace, {
      metrics: { score: 0.75 },
      meta: {
        source: {
          files: [textFile("candidates/command/candidate.yaml", "version: 1\nname: local-command-eval\n")],
        },
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
        summaries: Array<{ id: string; metrics?: Record<string, number> }>;
      }>(`${server.url}api/snapshot`);
      expect(snapshot.workspaceRoot).toBe(path.resolve(workspace));
      expect(snapshot.activeId).toBe(candidateId);
      expect(snapshot.summaries[0]?.metrics?.score).toBe(0.75);

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
      expect(sourcePaths).toContain("task-001/expected/required-output.txt");
      expect(sourcePaths).not.toContain("task-001/task.yaml");
      expect(sourcePaths).not.toContain("benchmark.yaml");
      expect(sourcePaths).not.toContain("environment/Dockerfile");
      expect(sourcePaths).not.toContain("candidates/command/candidate.yaml");
      expect(sourcePaths).not.toContain("optimizers/command.yaml");
      expect(sourcePaths).not.toContain("candidates/command/files/run.js");
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

  test.skipIf(!loopbackAvailable)("local dev browser server exposes archived job phases, traces, and execution files", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-dev-open-jobs-"));
    const assetsRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-dev-open-assets-"));
    await writeFile(path.join(assetsRoot, "client.js"), "console.log('dev-open-test');\n");
    await writeFile(path.join(assetsRoot, "client.css"), "body { margin: 0; }\n");
    const candidateId = await seedLocalCandidate(workspace, {
      metrics: { score: 1 },
      eval: {
        subject: { id: "cand_seeded_001", kind: "candidate" },
        status: "completed",
        sampleCount: 1,
        completedSampleCount: 1,
        errorSampleCount: 0,
        metrics: { score: metricStats(1) },
        cases: [{ id: "case-001", sampleCount: 1, metrics: { score: metricStats(1) } }],
        samples: [{
          id: "case-001__sample_001",
          index: 0,
          subject: { id: "cand_seeded_001", kind: "candidate" },
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
        id: "job_run",
        candidateId,
        purpose: "run-task",
        output: {
          ok: true,
          summary: "Runner produced durable output.",
          files: [
            textFile("runner-summary.md", "Runner produced durable output.\n"),
            textFile(".workbench/traces/job_run/runner/agent-result.json", "{\"sessionId\":\"sess_run\",\"eventCount\":3}\n"),
            textFile(".workbench/traces/job_run/runner/session/trace.json", JSON.stringify({
              trace_id: "seeded-runner",
              spans: [{
                id: "turn",
                parent_id: null,
                attempt_number: 1,
                stage_id: "workbench-runner",
                stage_run_index: 1,
                kind: "turn",
                title: "Live runner turn",
                status: "completed",
                started_at: "2026-04-28T00:00:00.000Z",
                ended_at: "2026-04-28T00:00:01.000Z",
                attributes: { source: "trace-json" },
              }],
              events: [{
                id: "message",
                span_id: "turn",
                attempt_number: 1,
                stage_id: "workbench-runner",
                stage_run_index: 1,
                kind: "message",
                at: "2026-04-28T00:00:00.500Z",
                message: "real trace event",
                attributes: {},
              }],
              summaries: [{
                attempt_number: 1,
                stage_id: "workbench-runner",
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
          ],
        },
      }),
      localExecutionJob({
        id: "job_grade",
        candidateId,
        purpose: "grade-task",
        output: {
          ok: true,
          scorecard: { score: 1, summary: "grader passed" },
          files: [
            textFile("scorecard.json", "{\"score\":1,\"summary\":\"grader passed\"}\n"),
            textFile(".workbench/traces/job_grade/grader/agent-result.json", "{\"sessionId\":\"sess_grade\",\"eventCount\":4}\n"),
          ],
        },
      }),
    ]);

    const server = await startLocalWorkbenchDevServer({
      workspace,
      host: "127.0.0.1",
      port: 0,
      assetsRoot,
    });
    try {
      const review = await fetchJson<{
        phases: Array<{ phase: string; role: string; jobIds: string[] }>;
      }>(`${server.url}api/task-review?id=${encodeURIComponent(candidateId)}&task=case-001`);
      expect(review.phases.map((phase) => phase.phase)).toEqual(["run-task", "grade-task"]);
      expect(review.phases[1]?.role).toBe("grader");
      expect(review.phases[1]?.jobIds).toEqual(["job_grade"]);

      const traces = await fetchJson<{
        phases: Array<{
          phase: string;
          role: string;
          jobIds: string[];
          trace: {
            spans: Array<{ title: string; stage_id: string | null; stage_run_index: number | null; attributes: Record<string, unknown> }>;
            events: Array<{ message: string; stage_id: string | null; stage_run_index: number | null }>;
          };
        }>;
      }>(`${server.url}api/traces?run=run_seeded`);
      expect(traces.phases.map((phase) => phase.phase)).toEqual(["run-task", "grade-task"]);
      expect(traces.phases[0]?.trace.spans.map((span) => span.title)).toEqual(["Live runner turn"]);
      expect(traces.phases[0]?.trace.events.map((event) => event.message)).toContain("real trace event");
      expect(traces.phases[0]?.trace.spans.map((span) => span.stage_id)).toEqual(["run-task"]);
      expect(traces.phases[0]?.trace.spans.map((span) => span.stage_run_index)).toEqual([null]);
      expect(traces.phases[1]?.trace.spans).toHaveLength(1);
      expect(traces.phases[1]?.trace.spans.map((span) => span.attributes.job_id)).toEqual([
        "job_grade",
      ]);
      expect(traces.phases[1]?.trace.spans.map((span) => span.stage_id)).toEqual(["grade-task"]);
      expect(traces.phases[1]?.trace.spans.map((span) => span.stage_run_index)).toEqual([null]);
      expect(traces.phases[1]?.trace.events.length).toBeGreaterThan(0);

      const files = await fetchJson<Array<{ path: string }>>(
        `${server.url}api/execution/files?run=run_seeded&id=job_run`,
      );
      expect(files.map((file) => file.path)).toEqual(["runner-summary.md"]);
    } finally {
      await server.close();
    }
  });

  test("local open rejects missing flag values before starting the server", async () => {
    const io = createIo();
    expect(await runCli(["open", "--host"], io)).toBe(2);
    expect(io.stderrText()).toContain("--host requires a value.");
  });

  test("init writes explicit benchmark, candidate, and optimizer YAML", async () => {
    const skillWorkspace = await mkdtemp(path.join(os.tmpdir(), "workbench-init-skill-"));
    const pipelineWorkspace = await mkdtemp(path.join(os.tmpdir(), "workbench-init-pipeline-"));
    const commandWorkspace = await mkdtemp(path.join(os.tmpdir(), "workbench-init-command-"));
    const customAgentWorkspace = await mkdtemp(path.join(os.tmpdir(), "workbench-init-custom-agent-"));

    expect(await runCli(["init", skillWorkspace, "--skill", "invoice-review", "--agent", "codex", "--json"], createIo())).toBe(0);
    expect(await runCli(["init", pipelineWorkspace, "--pipeline", "report-pipeline", "--agent", "claude", "--json"], createIo())).toBe(0);
    expect(await runCli(["init", commandWorkspace, "--command", "command-eval", "--json"], createIo())).toBe(0);
    expect(await runCli(["init", customAgentWorkspace, "--skill", "custom-agent-skill", "--agent", "my-agent", "--json"], createIo())).toBe(0);

    const skillBenchmark = await readFile(path.join(skillWorkspace, "benchmark.yaml"), "utf8");
    const skillCandidate = await readFile(path.join(skillWorkspace, "candidates", "codex", "candidate.yaml"), "utf8");
    const skillOptimizer = await readFile(path.join(skillWorkspace, "optimizers", "codex.yaml"), "utf8");
    expect(skillBenchmark).toContain("version: 1");
    expect(skillBenchmark).toContain("description: \"Evaluate the invoice-review skill across representative tasks.\"");
    expect(skillBenchmark).toContain("tasks: tasks");
    expect(skillBenchmark).toContain("environment:\n  dockerfile: environment/Dockerfile");
    expect(skillCandidate).not.toContain("benchmark:");
    expect(skillCandidate).not.toContain("path:");
    expect(skillCandidate).toContain("run:\n  use: codex");
    expect(skillOptimizer).toContain("edits:\n  - SKILL.md");
    expect(skillOptimizer).not.toMatch(new RegExp("object" + "ive:"));
    expect(skillCandidate).not.toContain("promptFile");
    expect(await readFile(path.join(skillWorkspace, "candidates", "codex", "files", "SKILL.md"), "utf8")).toContain("name: invoice-review");
    expect(await readFile(path.join(skillWorkspace, "tasks", "task-001", "expected", "rubric.md"), "utf8")).toContain("Reward complete");
    const skillDockerfile = await readFile(path.join(skillWorkspace, "environment", "Dockerfile"), "utf8");
    expect(skillDockerfile).toContain("ca-certificates");
    expect(skillDockerfile).not.toContain("npm install --global @openai/codex");
    await expect(stat(path.join(skillWorkspace, "tasks", "task-001", "input"))).rejects.toBeTruthy();
    await expect(stat(path.join(skillWorkspace, "tasks", "task-001", "rubric.md"))).rejects.toBeTruthy();

    const pipelineBenchmark = await readFile(path.join(pipelineWorkspace, "benchmark.yaml"), "utf8");
    const pipelineCandidate = await readFile(path.join(pipelineWorkspace, "candidates", "claude", "candidate.yaml"), "utf8");
    expect(pipelineBenchmark).toContain("version: 1");
    expect(pipelineBenchmark).toContain("description: \"Evaluate the report-pipeline pipeline across representative tasks.\"");
    expect(pipelineCandidate).not.toContain("benchmark:");
    expect(pipelineCandidate).not.toContain("path:");
    expect(pipelineCandidate).toContain("run:\n  use: claude");
    expect(pipelineCandidate).not.toContain("  kind:");
    expect(pipelineCandidate).not.toContain("defaults:");
    expect(await readFile(path.join(pipelineWorkspace, "candidates", "claude", "files", "pipeline.yaml"), "utf8")).toContain("metadata:");
    expect(await readFile(path.join(pipelineWorkspace, "tasks", "task-001", "expected", "rubric.md"), "utf8")).toContain("Reward pipeline runs");
    const pipelineDockerfile = await readFile(path.join(pipelineWorkspace, "environment", "Dockerfile"), "utf8");
    expect(pipelineDockerfile).toContain("ca-certificates");
    expect(pipelineDockerfile).not.toContain("npm install --global @anthropic-ai/claude-code");
    await expect(stat(path.join(pipelineWorkspace, "tasks", "task-001", "input"))).rejects.toBeTruthy();

    const commandBenchmark = await readFile(path.join(commandWorkspace, "benchmark.yaml"), "utf8");
    const commandCandidate = await readFile(path.join(commandWorkspace, "candidates", "command", "candidate.yaml"), "utf8");
    expect(commandBenchmark).toContain("version: 1");
    expect(commandBenchmark).toContain("description: \"Evaluate the command-eval command implementation across representative tasks.\"");
    expect(commandCandidate).not.toContain("benchmark:");
    expect(commandCandidate).not.toContain("path:");
    expect(commandCandidate).not.toContain("environment:");
    expect(commandCandidate).toContain("run:\n  use: command");
    expect(commandBenchmark).toContain("grade:\n  use: command");
    expect(commandCandidate).not.toContain("  kind:");
    expect(commandCandidate).not.toContain("defaults:");
    expect(await readFile(path.join(commandWorkspace, "candidates", "command", "files", "run.js"), "utf8")).toContain("command candidate ran");
    expect(await readFile(path.join(commandWorkspace, "tasks", "task-001", "expected", "required-output.txt"), "utf8")).toContain("command candidate ran");
    expect(await readFile(path.join(commandWorkspace, "environment", "Dockerfile"), "utf8")).toContain("ca-certificates");
    await expect(stat(path.join(commandWorkspace, "tasks", "task-001", "input"))).rejects.toBeTruthy();

    await expect(readFile(path.join(customAgentWorkspace, "candidates", "my-agent", "candidate.yaml"), "utf8"))
      .resolves.toContain("run:\n  use: my-agent");

    for (const workspace of [skillWorkspace, pipelineWorkspace, commandWorkspace]) {
      const checkIo = createIo();
      expect(await runCli(["check", "--dir", workspace, "--json"], checkIo)).toBe(0);
      expect(JSON.parse(checkIo.stdoutText())).toMatchObject({ ok: true });
    }
  });

  test("init rejects ambiguous or incomplete scaffold flags", async () => {
    const missingScaffoldKind = createIo();
    expect(await runCli(["init", "--json"], missingScaffoldKind)).toBe(2);
    expect(missingScaffoldKind.stdoutText()).toContain("Specify exactly one of --skill NAME, --pipeline NAME, or --command NAME.");

    const missingName = createIo();
    expect(await runCli(["init", "--skill", "--agent", "codex", "--json"], missingName)).toBe(2);
    expect(missingName.stdoutText()).toContain("Missing NAME for --skill.");

    const ambiguousScaffold = createIo();
    expect(await runCli(["init", "--skill", "invoice-review", "--pipeline", "report-pipeline", "--agent", "codex", "--json"], ambiguousScaffold)).toBe(2);
    expect(ambiguousScaffold.stdoutText()).toContain("Specify exactly one of --skill NAME, --pipeline NAME, or --command NAME.");

    const missingAgent = createIo();
    expect(await runCli(["init", "--pipeline", "pipeline-eval", "--json"], missingAgent)).toBe(2);
    expect(missingAgent.stdoutText()).toContain("--agent is required for --pipeline");

    const commandAgent = createIo();
    expect(await runCli(["init", "--command", "command-eval", "--agent", "codex", "--json"], commandAgent)).toBe(2);
    expect(commandAgent.stdoutText()).toContain("--agent applies only to --skill and --pipeline.");
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
        command: "workbench-adapter-my-agent",
      },
    });

    const checkIo = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], checkIo)).toBe(0);
    expect(JSON.parse(checkIo.stdoutText())).toMatchObject({
      ok: true,
      plan: {
        source: {
          files: 11,
        },
      },
    });
    expect(JSON.parse(checkIo.stdoutText()).plan.source).toMatchObject({
      files: 11,
    });

    const manifestPath = path.join(workspace, "adapters", "my-agent", "workbench.adapter.yaml");
    await writeFile(
      manifestPath,
      (await readFile(manifestPath, "utf8")).replace("  - npm install --global .", "  - npm install --global .\n  - echo refreshed"),
    );
    const refreshedCheckIo = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], refreshedCheckIo)).toBe(0);
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
      if (url === "http://workbench.test/api/workbench/benchmarks") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            name: "adapter-eval",
            ownerUsername: "alice",
          },
        }, { status: 201 });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    expect(await runCli(["push", "--dir", workspace, "--visibility", "private", "--json"], createIo())).toBe(0);

    const body = JSON.parse(String(requests[0]?.init?.body)) as {
      dockerfile?: string;
      runtimeDockerfile?: string;
      adapterFiles?: Array<{ path: string }>;
    };
    expect(body.dockerfile).toContain("FROM");
    expect(body.dockerfile).not.toContain("Workbench adapter setup");
    expect(body.runtimeDockerfile).toContain("Workbench adapter setup");
    expect(body.runtimeDockerfile).toContain("npm install --global .");
    expect(body.adapterFiles).toEqual(
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
        protocol: "workbench.adapter.v1",
        setup: ["npm install --global ."],
        command: "node /opt/workbench-adapters/string-command/adapter.mjs --mode workbench",
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
      "protocol: workbench.adapter.v1",
      "setup:",
      "  - npm install --global .",
      "command: workbench-adapter-orchestrator",
      "refs:",
      "  - /child",
      "",
    ].join("\n"));
    const specPath = commandCandidateSpecPath(workspace);
    const specSource = await readFile(specPath, "utf8");
    await writeFile(specPath, specSource.replace(
      /run:\n  use: command\n  with:\n    command: .+/u,
      "run:\n  use: orchestrator\n  with:\n    child:\n      use: secret-agent",
    ) + "adapters:\n  - ../../adapters/orchestrator\n");

    const checkIo = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], checkIo)).toBe(1);
    expect(checkIo.stdoutText()).toContain("secret-agent");
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
      "protocol: workbench.adapter.v1",
      "setup:",
      "  - npm install --global .",
      "command: workbench-adapter-npm-agent",
      "auth:",
      "  methods:",
      "    api-key:",
      "      env:",
      "        - NPM_AGENT_API_KEY",
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

  test("check rejects root task fixtures outside task.yaml, input, and expected", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-task-layout-"));
    expect(await runCli(["init", workspace, "--command", "command-eval", "--json"], createIo())).toBe(0);
    await writeFile(path.join(workspace, "tasks", "task-001", "rubric.md"), "unsupported root rubric\n");

    const io = createIo();
    expect(await runCli(["check", "--dir", workspace, "--json"], io)).toBe(1);
    expect(io.stdoutText()).toContain("outside task.yaml, input/, or expected/");
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
      "--optimizer",
      commandOptimizerSpecPath(workspace),
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

  test("candidate text output summarizes emitted metrics without score-only labels", async () => {
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
      metrics: {
        score: 0.5,
        accuracy: 0.75,
      },
    });

    const listIo = createIo();
    expect(await runCli(["candidates", "list", "--dir", workspace], listIo)).toBe(0);
    expect(listIo.stdoutText()).toContain("metrics score: 0.50, accuracy: 0.75");
    expect(listIo.stdoutText()).not.toContain("\tscore 0.5");
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

    expect(skill).toContain("benchmark.environment.dockerfile");
    expect(skill).toContain("ca-certificates");
    expect(manifest).toContain("Dockerfile");
    expect(manifest).toContain("\"state\": \"published\"");
    expect(manifest).toContain("\"workbench-ai/workbench\"");
  });

  test("keeps generated skill mirror synced with authored assets", async () => {
    const { syncSkillAssets } = await import(pathToFileURL(path.join(productRoot, "scripts", "sync-skill-assets.mjs")).href) as {
      syncSkillAssets: (args: {
        sourceRepoRoot: string;
        sourceSkillRoot: string;
        targetSkillRoot: string;
      }) => Promise<void>;
    };
    const generatedRoot = path.join(productRoot, ".agents", "skills", "workbench");
    const expectedRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-skill-sync-"));

    await syncSkillAssets({
      sourceRepoRoot: productRoot,
      sourceSkillRoot: path.join(productRoot, "skills", "workbench"),
      targetSkillRoot: expectedRoot,
    });

    expect(await readTextTree(generatedRoot)).toEqual(await readTextTree(expectedRoot));
    const generatedSkill = await readFile(path.join(generatedRoot, "SKILL.md"), "utf8");
    expect(generatedSkill).toContain("workbench push");
    expect(generatedSkill).not.toContain("workbench launch");
    expect(generatedSkill).not.toContain("Paths are relative to the YAML file that declares them, or absolute.");
    expect(generatedSkill).toContain("benchmark.environment.dockerfile");
    expect(generatedSkill).toContain("ca-certificates");
    expect(generatedSkill).toContain("/workspace/output/scorecard.json");
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
    expect(evalReadme).toContain("File-output tasks");
    expect(skill).toContain("Default to `grade: use: rubric`");
    expect(fileOutputGuide).toContain("Do not write a custom grader just because a task produces binary files");
    expect(fileOutputGuide).toContain(".docx");
    expect(fileOutputGuide).toContain(".xlsx");
    expect(fileOutputGuide).toContain(".pdf");
    expect(fileOutputGuide).toContain(".pptx");
    await expect(stat(path.join(productRoot, "docs", "evals", "templates"))).rejects.toBeTruthy();
    expect(skillEvals).toContain("existing-workflow-eval-authoring");
    expect(skillEvals).toContain("file-output-task-eval-authoring");
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

  test("adapter auth connect stores built-in profile bundles for local status", async () => {
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
      "protocol: workbench.adapter.v1",
      "setup:",
      "  - npm install --global .",
      "command: workbench-adapter-my-agent",
      "auth:",
      "  methods:",
      "    api-key:",
      "      env:",
      "        - MY_AGENT_API_KEY",
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
      "protocol: workbench.adapter.v1",
      "setup:",
      "  - npm install --global .",
      "command: workbench-adapter-my-agent",
      "auth:",
      "  methods:",
      "    profile:",
      "      files:",
      "        - .my-agent/config.json",
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
      "protocol: workbench.adapter.v1",
      "setup:",
      "  - npm install --global .",
      "command: workbench-adapter-my-agent",
      "auth:",
      "  methods:",
      "    api-key:",
      "      env:",
      "        - MY_AGENT_API_KEY",
      "",
    ].join("\n"));
    await appendCandidateAdapters(workspace, ["../../adapters/my-agent"]);
    const specPath = commandCandidateSpecPath(workspace);
    const specSource = await readFile(specPath, "utf8");
    await writeFile(specPath, specSource.replace(
      /run:\n  use: command\n  with:\n    command: .+/u,
      "run:\n  use: my-agent",
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
      "protocol: workbench.adapter.v1",
      "setup:",
      "  - npm install --global .",
      "command: workbench-adapter-orchestrator",
      "refs:",
      "  - /child",
      "",
    ].join("\n"));
    await writeFile(path.join(workspace, "adapters", "secret-agent", "workbench.adapter.yaml"), [
      "id: secret-agent",
      "protocol: workbench.adapter.v1",
      "setup:",
      "  - npm install --global .",
      "command: workbench-adapter-secret-agent",
      "auth:",
      "  methods:",
      "    api-key:",
      "      env:",
      "        - SECRET_AGENT_KEY",
      "",
    ].join("\n"));
    await appendCandidateAdapters(workspace, ["../../adapters/orchestrator", "../../adapters/secret-agent"]);
    const specPath = commandCandidateSpecPath(workspace);
    const specSource = await readFile(specPath, "utf8");
    await writeFile(specPath, specSource.replace(
      /run:\n  use: command\n  with:\n    command: .+/u,
      "run:\n  use: orchestrator\n  with:\n    child:\n      use: secret-agent",
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
      "protocol: workbench.adapter.v1",
      "setup:",
      "  - npm install --global .",
      "command: workbench-adapter-deployer",
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
      "            - DEPLOYER_LLM_API_KEY",
      "",
    ].join("\n"));
    await appendCandidateAdapters(workspace, ["../../adapters/deployer"]);
    const specPath = commandCandidateSpecPath(workspace);
    const specSource = await readFile(specPath, "utf8");
    await writeFile(specPath, specSource.replace(
      /run:\n  use: command\n  with:\n    command: .+/u,
      "run:\n  use: deployer",
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
      if (url === "http://workbench.test/api/workbench/benchmarks") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            name: "demo",
            ownerUsername: "alice",
            currentSpecVersionId: "spec_0001",
            sourceFingerprint: "fp_0001",
          },
        }, { status: 201 });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/publish" && init?.method === "PUT") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            name: "demo",
            ownerUsername: "alice",
            currentSpecVersionId: "spec_0001",
            sourceFingerprint: "fp_0001",
          },
        });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli(["push", "--dir", root], io);

    expect(exitCode).toBe(0);
    expect(io.stdoutText()).toContain("Pushed alice/demo (wb_123456789abc)");
    expect(io.stdoutText()).toContain("Open benchmark: http://workbench.test/benchmarks/alice/demo");
    expect(JSON.parse(await readFile(path.join(root, ".workbench", "origin.json"), "utf8"))).toMatchObject({
      projectId: "wb_123456789abc",
      owner: "alice",
      project: "demo",
      baseUrl: "http://workbench.test",
      writable: true,
      sourceRevisionId: "spec_0001",
      sourceFingerprint: "fp_0001",
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("http://workbench.test/api/workbench/benchmarks");
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      source: expect.stringContaining("name: demo"),
      dockerfile: expect.stringContaining("FROM"),
      runtimeDockerfile: expect.stringContaining("FROM"),
      candidateFiles: [
        expect.objectContaining({ path: "run.js" }),
      ],
      taskFiles: expect.arrayContaining([
        expect.objectContaining({ path: "task-001/task.yaml" }),
        expect.objectContaining({ path: "task-001/expected/required-output.txt" }),
      ]),
      network: "off",
      resources: {},
    });
  });

  test("does not write origins before source-first push succeeds", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-push-failed-create-"));
    expect(await runCli(["init", root, "--command", "demo", "--json"], createIo())).toBe(0);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "http://workbench.test/api/workbench/benchmarks") {
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
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-clone-public-"));
    const output = path.join(root, "downloaded");
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "http://workbench.test/api/workbench/public/benchmarks/alice/demo") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
            currentSpecVersionId: "spec_0001",
            sourceFingerprint: "fp_0001",
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/public/benchmarks/alice/demo/source") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
            currentSpecVersionId: "spec_0001",
            sourceFingerprint: "fp_0001",
          },
          files: [
            { path: "benchmark.yaml", content: "version: 1\nname: demo\ndescription: Demo benchmark.\ntasks: tasks\nenvironment:\n  dockerfile: environment/Dockerfile\ngrade:\n  use: command\n  with:\n    command: 'true'\n" },
            { path: "candidates/command/candidate.yaml", content: "version: 1\nname: demo\nrun:\n  use: command\n  with:\n    command: node /workspace/input/candidate/run.js\n" },
            { path: "candidates/command/files/run.js", content: "console.log('ok')\n" },
          ],
        });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli(["clone", "alice/demo", output, "--json"], io);

    expect(exitCode).toBe(0);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      ok: true,
      outputDir: output,
      files: 3,
      origin: {
        projectId: "wb_123456789abc",
        owner: "alice",
        project: "demo",
        baseUrl: "http://workbench.test",
        writable: false,
        sourceRevisionId: "spec_0001",
        sourceFingerprint: "fp_0001",
      },
    });
    expect(JSON.parse(await readFile(path.join(output, ".workbench", "origin.json"), "utf8"))).toMatchObject({
      projectId: "wb_123456789abc",
      owner: "alice",
      project: "demo",
      baseUrl: "http://workbench.test",
      writable: false,
    });
    expect(requests).toEqual([
      "GET http://workbench.test/api/workbench/public/benchmarks/alice/demo",
      "GET http://workbench.test/api/workbench/public/benchmarks/alice/demo/source",
    ]);
  });

  test("push refuses read-only public clone origins", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-readonly-push-"));
    expect(await runCli(["init", root, "--command", "demo", "--json"], createIo())).toBe(0);
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify({
        projectId: "wb_123456789abc",
        owner: "alice",
        project: "demo",
        baseUrl: "http://workbench.test",
        writable: false,
        linkedAt: new Date(0).toISOString(),
      }),
      "utf8",
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const io = createIo();
    const exitCode = await runCli(["push", "--dir", root], io);

    expect(exitCode).toBe(2);
    expect(io.stderrText()).toContain("Cannot push to a read-only benchmark clone");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("fork materializes a writable local checkout with upstream metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-fork-cli-"));
    const output = path.join(root, "demo-fork");
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      if (url === "http://workbench.test/api/workbench/public/benchmarks/alice/demo/fork" && init?.method === "POST") {
        return Response.json({
          benchmark: {
            id: "wb_fork12345678",
            ownerUsername: "bob",
            name: "demo-fork",
            currentSpecVersionId: "spec_0001",
            sourceFingerprint: "fp_fork",
            forkedFrom: {
              projectId: "wb_123456789abc",
              ownerUsername: "alice",
              benchmarkName: "demo",
              sourceRevisionId: "spec_0001",
            },
          },
        }, { status: 201 });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_fork12345678/source") {
        return Response.json({
          benchmark: {
            id: "wb_fork12345678",
            ownerUsername: "bob",
            name: "demo-fork",
            currentSpecVersionId: "spec_0001",
            sourceFingerprint: "fp_fork",
          },
          files: [
            { path: "benchmark.yaml", content: "version: 1\nname: demo-fork\ndescription: Fork benchmark.\ntasks: tasks\nenvironment:\n  dockerfile: environment/Dockerfile\ngrade:\n  use: command\n  with:\n    command: 'true'\n" },
            { path: "candidates/command/candidate.yaml", content: "version: 1\nname: demo-fork\nrun:\n  use: command\n  with:\n    command: node /workspace/input/candidate/run.js\n" },
            { path: "candidates/command/files/run.js", content: "console.log('fork')\n" },
            { path: "tasks/case-a/task.yaml", content: "task: fork\n" },
            { path: "environment/Dockerfile", content: "FROM node:22-alpine\n" },
          ],
        });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli(["cloud", "fork", "alice/demo", output, "--json"], io);

    expect(exitCode).toBe(0);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      ok: true,
      outputDir: output,
      files: 5,
      origin: {
        projectId: "wb_fork12345678",
        owner: "bob",
        project: "demo-fork",
        writable: true,
        sourceRevisionId: "spec_0001",
        sourceFingerprint: "fp_fork",
        upstream: {
          owner: "alice",
          project: "demo",
          projectId: "wb_123456789abc",
          sourceRevisionId: "spec_0001",
        },
      },
      urls: {
        benchmark: "http://workbench.test/benchmarks/bob/demo-fork",
      },
    });
    expect(await readFile(path.join(output, "benchmark.yaml"), "utf8")).toContain("name: demo-fork");
    expect(JSON.parse(await readFile(path.join(output, ".workbench", "origin.json"), "utf8"))).toMatchObject({
      writable: true,
      upstream: {
        owner: "alice",
        project: "demo",
      },
    });
    expect(requests).toEqual([
      {
        url: "http://workbench.test/api/workbench/public/benchmarks/alice/demo/fork",
        method: "POST",
        body: { name: output },
      },
      {
        url: "http://workbench.test/api/workbench/benchmarks/wb_fork12345678/source",
        method: "GET",
      },
    ]);
  });

  test("push lets hosted benchmark identity enforce name conflicts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-push-name-conflict-"));
    expect(await runCli(["init", root, "--command", "demo", "--json"], createIo())).toBe(0);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify({
        projectId: "demo",
        owner: "alice",
        project: "demo",
        baseUrl: "http://workbench.test",
        writable: true,
        linkedAt: new Date(0).toISOString(),
      }),
      "utf8",
    );
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "http://workbench.test/api/workbench/benchmarks/demo/source" && init?.method === "PUT") {
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
      "PUT http://workbench.test/api/workbench/benchmarks/demo/source",
    ]);
  });

  test("push surfaces hosted immutable-name errors", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-push-rename-conflict-"));
    expect(await runCli(["init", root, "--command", "renamed-benchmark", "--json"], createIo())).toBe(0);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify({
        projectId: "wb_123456789abc",
        owner: "alice",
        project: "original-benchmark",
        baseUrl: "http://workbench.test",
        writable: true,
        linkedAt: new Date(0).toISOString(),
      }),
      "utf8",
    );
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/source" && init?.method === "PUT") {
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
      "PUT http://workbench.test/api/workbench/benchmarks/wb_123456789abc/source",
    ]);
  });

  test("pull downloads hosted benchmark source state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-source-pull-cli-"));
    await mkdir(path.join(root, "candidates", "command", "files"), { recursive: true });
    await mkdir(path.join(root, "optimizers"), { recursive: true });
    await mkdir(path.join(root, "tasks", "old-case"), { recursive: true });
    await mkdir(path.join(root, "environment"), { recursive: true });
    await writeFile(path.join(root, "benchmark.yaml"), [
      "version: 1",
      "name: demo",
      "description: Old benchmark state",
      "tasks: tasks",
      "environment:",
      "  dockerfile: environment/Dockerfile",
      "grade:",
      "  use: command",
      "  with:",
      "    command: printf '{\"score\":1}' > /workspace/output/scorecard.json",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "candidates", "command", "candidate.yaml"), [
      "version: 1",
      "name: demo",
      "run:",
      "  use: command",
      "  with:",
      "    command: node /workspace/input/candidate/old.js",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "optimizers", "command.yaml"), [
      "version: 1",
      "name: demo optimizer",
      "edits:",
      "  - old.js",
      "improve:",
      "  use: command",
      "  with:",
      "    command: cp -R /workspace/input/candidate/. /workspace/output/",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "candidates", "command", "files", "old.js"), "console.log('old')\n");
    await writeFile(path.join(root, "tasks", "old-case", "task.yaml"), "task: old\n");
    await writeFile(path.join(root, "environment", "Dockerfile"), "FROM node:22-alpine\n");
    await writeFile(path.join(root, "notes.md"), "local note\n");
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify({
        projectId: "wb_123456789abc",
        owner: "alice",
        project: "demo",
        baseUrl: "http://workbench.test",
        writable: true,
        sourceRevisionId: "spec_old",
        sourceFingerprint: "fp_old",
        linkedAt: new Date(0).toISOString(),
      }),
      "utf8",
    );
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/source") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
            currentSpecVersionId: "spec_0002",
            sourceFingerprint: "fp_0002",
          },
          files: [
            { path: "benchmark.yaml", content: "version: 1\nname: demo\ndescription: New benchmark.\ntasks: tasks\nenvironment:\n  dockerfile: environment/Dockerfile\ngrade:\n  use: command\n  with:\n    command: 'true'\n" },
            { path: "candidates/command/candidate.yaml", content: "version: 1\nname: demo\nrun:\n  use: command\n  with:\n    command: ./run.sh\n" },
            { path: "optimizers/command.yaml", content: "version: 1\nname: demo optimizer\nedits:\n  - run.sh\nimprove:\n  use: command\n  with:\n    command: cp -R /workspace/input/candidate/. /workspace/output/\n" },
            { path: "candidates/command/files/run.sh", content: "echo ok\n", executable: true },
            { path: "tasks/case-a/task.yaml", content: "task: test\n" },
            { path: "environment/Dockerfile", content: "FROM node:22-alpine\n" },
          ],
        });
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
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc/source",
    ]);
    expect(await readTextTree(root)).toMatchObject({
      "benchmark.yaml": "file\nversion: 1\nname: demo\ndescription: New benchmark.\ntasks: tasks\nenvironment:\n  dockerfile: environment/Dockerfile\ngrade:\n  use: command\n  with:\n    command: 'true'\n",
      "candidates/command/candidate.yaml": "file\nversion: 1\nname: demo\nrun:\n  use: command\n  with:\n    command: ./run.sh\n",
      "candidates/command/files/run.sh": "executable\necho ok\n",
      "optimizers/command.yaml": "file\nversion: 1\nname: demo optimizer\nedits:\n  - run.sh\nimprove:\n  use: command\n  with:\n    command: cp -R /workspace/input/candidate/. /workspace/output/\n",
      "environment/Dockerfile": "file\nFROM node:22-alpine\n",
      "notes.md": "file\nlocal note\n",
      "tasks/case-a/task.yaml": "file\ntask: test\n",
    });
    await expect(readFile(path.join(root, "candidates", "command", "files", "old.js"), "utf8"))
      .rejects
      .toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(root, "tasks", "old-case", "task.yaml"), "utf8"))
      .rejects
      .toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(path.join(root, ".workbench", "origin.json"), "utf8"))).toMatchObject({
      projectId: "wb_123456789abc",
      owner: "alice",
      project: "demo",
      baseUrl: "http://workbench.test",
      writable: true,
      sourceRevisionId: "spec_0002",
      sourceFingerprint: "fp_0002",
    });
  });

  test("deletes hosted benchmarks through the documented benchmark command", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-project-delete-"));
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify({
        projectId: "wb_123456789abc",
        owner: "alice",
        project: "demo",
        baseUrl: "http://workbench.test",
        writable: true,
        linkedAt: new Date(0).toISOString(),
      }),
      "utf8",
    );
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (
        url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc" &&
        (init?.method ?? "GET") === "GET"
      ) {
        return Response.json({
          benchmark: { id: "wb_123456789abc", name: "demo" },
        });
      }
      if (
        url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc" &&
        init?.method === "DELETE"
      ) {
        return Response.json({ deleted: true });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const dryRunIo = createIo();
    expect(await runCli([
      "cloud", "benchmarks", "delete", "--dir", root, "--dry-run", "--json"], dryRunIo)).toBe(0);
    expect(JSON.parse(dryRunIo.stdoutText())).toMatchObject({
      ok: true,
      dryRun: true,
      projectId: "wb_123456789abc",
      projectName: "demo",
    });
    expect(requests).toEqual([
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
    ]);
    expect(await readFile(path.join(root, ".workbench", "origin.json"), "utf8")).toContain("wb_123456789abc");

    const deleteIo = createIo();
    expect(await runCli([
      "cloud", "benchmarks", "delete", "--dir", root, "--json"], deleteIo)).toBe(0);
    expect(JSON.parse(deleteIo.stdoutText())).toMatchObject({
      ok: true,
      deleted: true,
      projectId: "wb_123456789abc",
      projectName: "demo",
      originRemoved: true,
    });
    expect(requests).toEqual([
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
      "GET http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
      "DELETE http://workbench.test/api/workbench/benchmarks/wb_123456789abc",
    ]);
    await expect(readFile(path.join(root, ".workbench", "origin.json"), "utf8"))
      .rejects
      .toMatchObject({ code: "ENOENT" });
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
    expect(await runCli(["cloud", "open", "--benchmark", "wb_123456789abc", "--json", "--no-open"], projectIo)).toBe(0);
    expect(JSON.parse(projectIo.stdoutText())).toMatchObject({
      ok: true,
      url: "http://workbench.test/benchmarks/alice/demo",
    });

    const candidateIo = createIo();
    expect(await runCli(["cloud", "open", "cand_abc123", "--benchmark", "wb_123456789abc", "--json", "--no-open"], candidateIo)).toBe(0);
    expect(JSON.parse(candidateIo.stdoutText())).toMatchObject({
      ok: true,
      url: "http://workbench.test/benchmarks/alice/demo/candidate/cand_abc123/evaluation",
    });

    const runIo = createIo();
    expect(await runCli(["cloud", "open", "run_abc123", "--benchmark", "wb_123456789abc", "--json", "--no-open"], runIo)).toBe(0);
    expect(JSON.parse(runIo.stdoutText())).toMatchObject({
      ok: true,
      url: "http://workbench.test/benchmarks/alice/demo/runs/run_abc123",
    });

    const originRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-open-origin-"));
    await mkdir(path.join(originRoot, ".workbench"), { recursive: true });
    await writeFile(
      path.join(originRoot, ".workbench", "origin.json"),
      JSON.stringify({
        projectId: "wb_aaaaaaaaaaaa",
        owner: "alice",
        project: "origin-project",
        baseUrl: "http://workbench.test",
        writable: true,
        linkedAt: new Date(0).toISOString(),
      }),
      "utf8",
    );
    const explicitIdIo = createIo();
    expect(await runCli([
      "cloud",
      "open",
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
    expect(await runCli(["cloud", "open", "invoice-review", "--json", "--no-open"], directProjectIo)).toBe(0);
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

  test("starts hosted workflows through cloud commands", async () => {
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
            id: "cand_123",
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
      "cloud",
      "improve",
      commandCandidateSpecPath(workspace),
      "--optimizer",
      commandOptimizerSpecPath(workspace),
      "--base",
      "cand_123",
      "--benchmark",
      "wb_123456789abc",
      "--budget",
      "2",
      "--samples",
      "3",
    ], improveIo)).toBe(0);
    expect(await runCli([
      "cloud",
      "eval",
      commandCandidateSpecPath(workspace),
      "--benchmark",
      "wb_123456789abc",
      "--base",
      "cand_123",
      "--samples",
      "2",
    ], createIo())).toBe(0);
    expect(improveIo.stdoutText()).toContain("Open run: http://workbench.test/benchmarks/alice/demo/runs/run_3");

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
      candidateId: "cand_123",
      optimizerSource: expect.stringContaining("improve:"),
    });
    expect(requests[4]?.body).toMatchObject({
      workflow: "eval",
      samples: 2,
      candidateId: "cand_123",
      candidateSource: expect.stringContaining("run:"),
      candidateFiles: expect.arrayContaining([
        expect.objectContaining({ path: "run.js" }),
      ]),
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
      "cloud",
      "eval",
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
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/source" && init?.method === "PUT") {
        return Response.json({
          changed: false,
          benchmark: { currentSpecVersionId: "spec_0001" },
          version: { id: "envv_custom", status: "building" },
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
      "cloud",
      "eval",
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

  test("watches hosted runs without an implicit timeout", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "workbench-watch-"));
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    let now = 0;
    let polls = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs/run_123") {
        polls += 1;
        now += 11 * 60 * 1000;
        return Response.json({
          run: {
            id: "run_123",
            workflow: "eval",
            status: polls < 2 ? "running" : "finished",
            outcome: "ok",
            candidateId: "cand_123",
            completedJobCount: 1,
            failedJobCount: 0,
            jobCount: 1,
            trialsExecuted: 1,
            samples: 1,
          },
        });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli([
      "cloud",
      "watch",
      "run_123",
      "--dir",
      workspace,
      "--benchmark",
      "wb_123456789abc",
      "--interval-ms",
      "1",
      "--json",
    ], io);

    expect(exitCode).toBe(0);
    expect(polls).toBe(2);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      id: "run_123",
      status: "finished",
      candidateId: "cand_123",
      urls: {
        run: "http://workbench.test/benchmarks/alice/demo/runs/run_123",
        candidateEvaluation: "http://workbench.test/benchmarks/alice/demo/candidate/cand_123/evaluation",
      },
    });
  });

  test("shows and cancels hosted runs with resource URLs", async () => {
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc" && (init?.method ?? "GET") === "GET") {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
          },
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs/run_123" && (init?.method ?? "GET") === "GET") {
        return Response.json({
          run: {
            id: "run_123",
            workflow: "eval",
            status: "running",
            candidateId: "cand_123",
            samples: 1,
            trialsExecuted: 0,
            trialsRequested: 0,
            completedJobCount: 1,
            failedJobCount: 1,
            jobCount: 2,
            durationMs: 1500,
          },
          jobs: [
            {
              id: "job_run",
              runId: "run_123",
              status: "succeeded",
              candidateId: "cand_123",
              input: { execution: { purpose: "run-task" } },
              output: { usage: { total: { costUsd: 0.01 } } },
            },
            {
              id: "job_grade",
              runId: "run_123",
              status: "failed",
              candidateId: "cand_123",
              input: { execution: { purpose: "grade-task" } },
              error: "grader failed",
            },
          ],
        });
      }
      if (url === "http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs/run_123" && init?.method === "DELETE") {
        return Response.json({
          run: {
            id: "run_123",
            workflow: "eval",
            status: "finished",
            outcome: "cancelled",
            candidateId: "cand_123",
            completedJobCount: 2,
            failedJobCount: 0,
            jobCount: 2,
          },
        });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const showIo = createIo();
    expect(await runCli(["cloud", "runs", "show", "run_123", "--benchmark", "wb_123456789abc", "--json"], showIo)).toBe(0);
    expect(JSON.parse(showIo.stdoutText())).toMatchObject({
      run: {
        id: "run_123",
        urls: {
          run: "http://workbench.test/benchmarks/alice/demo/runs/run_123",
          candidateEvaluation: "http://workbench.test/benchmarks/alice/demo/candidate/cand_123/evaluation",
        },
      },
      urls: {
        run: "http://workbench.test/benchmarks/alice/demo/runs/run_123",
      },
    });

    const cancelIo = createIo();
    expect(await runCli(["cloud", "runs", "cancel", "run_123", "--benchmark", "wb_123456789abc"], cancelIo)).toBe(0);
    expect(cancelIo.stdoutText()).toContain("Cancelled run run_123");
    expect(cancelIo.stdoutText()).toContain("Open run: http://workbench.test/benchmarks/alice/demo/runs/run_123");
    expect(requests).toContain("DELETE http://workbench.test/api/workbench/benchmarks/wb_123456789abc/runs/run_123");
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
      if (
        url === "http://workbench.test/api/workbench/benchmarks" ||
        url === "http://workbench.test/api/workbench/public/benchmarks"
      ) {
        expect(init?.headers).toMatchObject({
          authorization: "Bearer access-1",
        });
        return Response.json({ benchmarks: [] });
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

    const listIo = createIo();
    const listExitCode = await runCli(["cloud", "benchmarks", "list"], listIo);
    expect(listExitCode).toBe(0);
    expect(listIo.stdoutText()).toContain("No hosted Workbench benchmarks.");
  });

  test("push uploads candidate directories as utf8 snapshots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-cloud-cli-"));
    expect(await runCli(["init", root, "--command", "push-command-eval", "--json"], createIo())).toBe(0);
    await writeFile(path.join(root, "candidates", "command", "files", "notes.txt"), "case notes\n");
    await mkdir(path.join(root, "candidates", "command", "files", "__pycache__"));
    await writeFile(path.join(root, "candidates", "command", "files", "__pycache__", "run.cpython-314.pyc"), "bytecode\n");
    await writeFile(path.join(root, "candidates", "command", "files", ".DS_Store"), "finder metadata\n");
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify({
        projectId: "wb_123456789abc",
        owner: "alice",
        project: "push-command-eval",
        baseUrl: "http://workbench.test",
        writable: true,
        linkedAt: new Date(0).toISOString(),
      }),
      "utf8",
    );
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const bodies: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      bodies[url] = JSON.parse(String(init?.body));
      return Response.json({
        changed: true,
        benchmark: {
          id: "wb_123456789abc",
          name: "push-command-eval",
          ownerUsername: "alice",
          currentSpecVersionId: "spec_0001",
        },
        version: { id: "envv_custom", status: "building" },
      });
    });

    const io = createIo();
    const exitCode = await runCli(
      ["push", "--dir", root, "--visibility", "private"],
      io,
    );

    expect(exitCode).toBe(0);
    expect(io.stdoutText()).toContain("Pushed alice/push-command-eval (wb_123456789abc).");
    expect(bodies["http://workbench.test/api/workbench/benchmarks/wb_123456789abc/source"]).toMatchObject({
      candidateFiles: [
        { path: "notes.txt", content: "case notes\n" },
        { path: "run.js", content: expect.stringContaining("command candidate ran") },
      ],
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

  test("push uploads binary snapshots without utf8 corruption", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-binary-cli-"));
    expect(await runCli(["init", root, "--command", "binary-command-eval", "--json"], createIo())).toBe(0);
    const fileBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]);
    await writeFile(path.join(root, "tasks", "task-001", "expected", "golden.docx"), fileBytes);
    await mkdir(path.join(root, ".workbench"), { recursive: true });
    await writeFile(
      path.join(root, ".workbench", "origin.json"),
      JSON.stringify({
        projectId: "wb_123456789abc",
        owner: "alice",
        project: "binary-command-eval",
        baseUrl: "http://workbench.test",
        writable: true,
        linkedAt: new Date(0).toISOString(),
      }),
      "utf8",
    );
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const bodies: Record<string, { taskFiles?: unknown[] }> = {};
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      bodies[url] = JSON.parse(String(init?.body));
      return Response.json({
        changed: true,
        benchmark: {
          id: "wb_123456789abc",
          name: "binary-command-eval",
          ownerUsername: "alice",
          currentSpecVersionId: "spec_0001",
        },
        version: { id: "envv_custom", status: "building" },
      });
    });

    const io = createIo();
    const exitCode = await runCli(
      ["push", "--dir", root, "--visibility", "private"],
      io,
    );

    expect(exitCode).toBe(0);
    expect(bodies["http://workbench.test/api/workbench/benchmarks/wb_123456789abc/source"]?.taskFiles).toContainEqual({
      path: "task-001/expected/golden.docx",
      content: fileBytes.toString("base64"),
      encoding: "base64",
    });
  });

  test("exports binary candidate files from base64 snapshots", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "workbench-export-cli-"));
    const fileBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]);
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    vi.stubGlobal("fetch", async () =>
      Response.json({
        files: [
          {
            path: "best.docx",
            content: fileBytes.toString("base64"),
            encoding: "base64",
          },
          {
            path: "eval-summary.md",
            content: "# Summary\n",
          },
        ],
      })
    );

    const io = createIo();
    const exitCode = await runCli([
      "cloud",
      "candidates",
      "pull",
      "cand_123",
      "--benchmark",
      "wb_123456789abc",
      "--out",
      outputDir,
    ], io);

    expect(exitCode).toBe(0);
    expect(await readFile(path.join(outputDir, "best.docx"))).toEqual(fileBytes);
    expect(await readFile(path.join(outputDir, "eval-summary.md"), "utf8")).toBe("# Summary\n");
  });

  test("watches queued runs until the hosted worker finishes them", async () => {
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    let polls = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
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
      polls += 1;
      return Response.json({
        run: {
          id: "run_123",
          status: polls === 1 ? "queued" : "finished",
          candidateId: polls === 1 ? null : "cand_123",
        },
      });
    });

    const io = createIo();
    const exitCode = await runCli([
      "cloud",
      "watch",
      "run_123",
      "--benchmark",
      "wb_123456789abc",
      "--interval-ms",
      "1",
    ], io);

    expect(exitCode).toBe(0);
    expect(polls).toBe(2);
    expect(io.stdoutText()).toContain("Run run_123 reached finished; candidate cand_123");
    expect(io.stdoutText()).toContain("Open run: http://workbench.test/benchmarks/alice/demo/runs/run_123");
    expect(io.stdoutText()).toContain("Open evaluation: http://workbench.test/benchmarks/alice/demo/candidate/cand_123/evaluation");
  });

  test("returns a failing exit code when a watched hosted run finishes with failed jobs", async () => {
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
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
      return Response.json({
        run: {
          id: "run_failed",
          status: "finished",
          outcome: "error",
          candidateId: null,
          jobCount: 3,
          completedJobCount: 0,
          failedJobCount: 1,
        },
      });
    });

    const io = createIo();
    const exitCode = await runCli([
      "cloud",
      "watch",
      "run_failed",
      "--benchmark",
      "wb_123456789abc",
      "--interval-ms",
      "1",
      "--json",
    ], io);

    expect(exitCode).toBe(1);
    const run = JSON.parse(io.stdoutText()) as { id: string; outcome: string; failedJobCount: number };
    expect(run.id).toBe("run_failed");
    expect(run.outcome).toBe("error");
    expect(run.failedJobCount).toBe(1);
  });

  test("prints the first failed hosted job error after watch", async () => {
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/workbench/benchmarks/wb_123456789abc/runs/run_failed")) {
        return Response.json({
          run: {
            id: "run_failed",
            status: "finished",
            outcome: "error",
            candidateId: null,
            jobCount: 1,
            completedJobCount: 0,
            failedJobCount: 1,
          },
        });
      }
      if (url.endsWith("/api/workbench/benchmarks/wb_123456789abc")) {
        return Response.json({
          benchmark: {
            id: "wb_123456789abc",
            ownerUsername: "alice",
            name: "demo",
            jobs: [
              {
                id: "job_failed",
                runId: "run_failed",
                status: "failed",
                error: "ADAPTER_AUTH_REQUIRED: claude session invalidated: invalid OAuth token.",
              },
            ],
          },
        });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 500 });
    });

    const io = createIo();
    const exitCode = await runCli([
      "cloud",
      "watch",
      "run_failed",
      "--benchmark",
      "wb_123456789abc",
      "--interval-ms",
      "1",
    ], io);

    expect(exitCode).toBe(1);
    expect(io.stdoutText()).toContain("First failed job job_failed");
    expect(io.stdoutText()).toContain("invalid OAuth token");
  });

  test("rejects decimal run controls instead of truncating them", async () => {
    vi.stubEnv("WORKBENCH_API_URL", "http://workbench.test");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const io = createIo();
    const exitCode = await runCli([
      "cloud",
      "improve",
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
    metrics?: Record<string, number>;
    eval?: CandidateRecord["eval"];
    meta?: CandidateRecord["meta"];
  } = {},
): Promise<string> {
  const candidateId = "cand_seeded_001";
  const benchmarkFingerprint = await localSeedBenchmarkFingerprint(workspace);
  await saveLocalArchive(workspace, {
    activeId: candidateId,
    candidates: [{
      id: candidateId,
      ordinal: 0,
      benchmarkFingerprint,
      candidateFingerprint: "seeded-candidate-fingerprint",
      createdAt: "2026-04-28T00:00:00.000Z",
      referenceIds: [],
      status: "evaluated",
      fileChanges: ["prompt.md"],
      ...(options.metrics ? { metrics: options.metrics } : {}),
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
  purpose: "run-task" | "grade-task";
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
      trialIndex: 0,
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
