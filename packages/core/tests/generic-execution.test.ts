import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  applyWorkbenchCandidatePatch,
  compileWorkbenchExecutionGraph,
  collectSandboxAllocationScopeIssues,
  collectExecutionCapabilityScopeIssues,
  collectSandboxHandleScopeIssues,
  collectWorkbenchAdapterAuthRequirements,
  collectWorkbenchAdapterInvocations,
  collectWorkbenchExecutionIsolationIssues,
  createWorkbenchSandboxAllocation,
  createDockerSandboxBackendDescriptor,
  createWorkbenchAdapterAuthBundle,
  createWorkbenchExecutionCapability,
  createWorkbenchExecutionJob,
  expectedWorkbenchRunJobCount,
  executeAdapterInCurrentRuntime,
  executeWorkbenchExecutionJob,
  engineResolveInvocationForSpec,
  executeValidatedSandboxExecution,
  DOCKER_SANDBOX_BACKEND,
  planWorkbenchExecutionJobsForPurpose,
  parseWorkbenchAdapterManifest,
  resolveWorkbenchResolvedSourceYaml,
  validateWorkbenchRunEnvelope,
  validateWorkbenchResolvedSourceYaml,
  validateWorkbenchExecutionOutputPayloads,
  workbenchExecutionExecutorForRuntimeInput,
  withDefaultWorkbenchAdapterAuthProfiles,
  type SurfaceSnapshotFile,
  type WorkbenchAdapterAuthBundle,
  type WorkbenchEngineCase,
} from "../src/index.ts";

const require = createRequire(import.meta.url);

afterEach(() => {
  vi.unstubAllEnvs();
});

function compileTestExecutionGraph(
  input: Parameters<typeof compileWorkbenchExecutionGraph>[0],
) {
  return compileWorkbenchExecutionGraph({
    engineCase: { version: 3, prompt: "Run the test task." },
    ...input,
  });
}

function engineCase(
  id: string,
  task: string,
  publicFiles: readonly SurfaceSnapshotFile[] = [],
  privateFiles: readonly SurfaceSnapshotFile[] = [],
): WorkbenchEngineCase {
  return {
    id,
    case: { version: 3, prompt: task },
    files: {
      public: publicFiles.map((file) => ({ ...file })),
      private: privateFiles.map((file) => ({ ...file })),
    },
  };
}

describe("generic sandbox execution contract", () => {
  test("parses split benchmark/candidate source without leaking runtime-specific role schemas", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());

    expect(spec.version).toBe(4);
    expect(spec.description).toBe("Exercise generic file-output execution with command running and rubric scoring.");
    expect(spec.improve).toEqual({
      use: "codex",
      with: {
        model: "gpt-5.4-mini",
      },
    });
    expect(spec.environment.dockerfile).toBe("environment/Dockerfile");
    expect(spec.candidate.prepare).toEqual({ command: "cp -R input/candidate/. ." });
    expect(spec.run.use).toBe("command");
    expect(spec.engineRun.use).toBe("workbench");
    expect(spec.engineRun.with).toMatchObject({ score: { use: "rubric" } });
    expect(engineResolveInvocationForSpec(spec).use).toBe("workbench");
  });

  test("docker sandbox keeps the binary network policy contract for local execution", () => {
    expect(createDockerSandboxBackendDescriptor().capabilities.networkPolicy)
      .toEqual(["none", "open"]);
  });

  test("source spec validation is the split benchmark/candidate contract", () => {
    const validation = validateWorkbenchResolvedSourceYaml(genericSpec());
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());

    expect(validation.ok).toBe(true);
    expect(spec.improve?.use).toBe("codex");
    expect(spec.environment.dockerfile).toBe("environment/Dockerfile");
    expect(spec.run.with).toMatchObject({
      command: "python scripts/evaluate.py --run",
    });
    expect(spec.candidate.prepare?.command).toBe("cp -R input/candidate/. .");
    expect(spec.engineRun.use).toBe("workbench");
    expect(spec.engineRun.with).toMatchObject({ score: { use: "rubric" } });
    expect(spec.candidate.improve?.edits).toEqual(["prompt.md", "scripts/evaluate.py"]);
  });

  test("parses explicit improve optimize and selection policy without case-set magic", () => {
    const source = genericSpec().replace(
      "    with:\n      model: gpt-5.4-mini",
      [
        "    with:",
        "      model: gpt-5.4-mini",
        "    optimizeOn:",
        "      split: train",
        "    selectBy:",
        "      metric: score",
        "      cases:",
        "        split: validation",
      ].join("\n"),
    );

    const spec = resolveWorkbenchResolvedSourceYaml(source);
    const validation = validateWorkbenchResolvedSourceYaml(source);
    const invalid = validateWorkbenchResolvedSourceYaml(source.replace(
      "    optimizeOn:\n      split: train",
      "    optimizeOn:\n      all: true\n      split: train",
    ));
    const staleSurface = validateWorkbenchResolvedSourceYaml(source.replace(
      "    optimizeOn:\n      split: train",
      "    caseSets:\n      train:\n        split: train",
    ));
    const missingMetric = validateWorkbenchResolvedSourceYaml(source.replace(
      "      metric: score\n",
      "",
    ));

    expect(validation.ok).toBe(true);
    expect(spec.candidate.improve?.optimizeOn).toEqual({ split: "train" });
    expect(spec.candidate.improve?.selectBy).toEqual({
      metric: "score",
      cases: { split: "validation" },
    });
    expect(spec.improve).toEqual({
      use: "codex",
      with: { model: "gpt-5.4-mini" },
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.join("\n")).toContain("resolved Workbench source.candidate.improve.optimizeOn must specify either all or split, not both.");
    expect(staleSurface.ok).toBe(false);
    expect(staleSurface.errors.join("\n")).toContain("resolved Workbench source.candidate.improve includes unsupported field: caseSets.");
    expect(missingMetric.ok).toBe(false);
    expect(missingMetric.errors.join("\n")).toContain("resolved Workbench source.candidate.improve.selectBy.metric must be a non-empty string.");
  });

  test("rejects unsupported adapter envelope fields", () => {
    const yaml = genericSpec().replace(
      "    use: workbench",
      "    id: invalid-engine\n    use: workbench\n    weight: 1",
    );
    const validation = validateWorkbenchResolvedSourceYaml(yaml);

    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toContain("benchmark.yaml.engine includes unsupported fields: id, weight.");
  });

  test("adapter manifest slots drive nested default auth without role-specific logic", () => {
    const spec = resolveWorkbenchResolvedSourceYaml([
      "version: 4",
      "benchmark:",
      "  version: 4",
      "  name: nested-auth",
      "  description: Exercise manifest-declared nested adapter auth.",
      "  engine:",
      "    use: workbench",
      "    with:",
      "      environment:",
      "        dockerfile: environment/Dockerfile",
      "      score:",
      "        use: command",
      "        with:",
      "          command: 'true'",
      "candidate:",
      "  version: 4",
      "  name: nested-auth",
      "  description: Candidate runner for nested auth.",
      "  files:",
      "    path: candidates/nested-auth/files",
      "  defaultRun: orchestrator",
      "  runs:",
      "    orchestrator:",
      "      name: Orchestrator",
      "      use: orchestrator",
      "      with:",
      "        child:",
      "          use: secret-agent",
      "  improve:",
      "    edits:",
      "      - SKILL.md",
      "    use: command",
      "    with:",
      "      command: 'true'",
      "",
    ].join("\n"));
    const manifests = [
      {
        id: "orchestrator",
        protocol: "workbench.adapter.v3" as const,
        setup: [],
        operations: { "candidate.run": { command: "workbench-adapter-orchestrator" } },
        slots: { child: { path: "/child", operation: "candidate.run" as const } },
      },
      {
        id: "secret-agent",
        protocol: "workbench.adapter.v3" as const,
        setup: [],
        operations: { "candidate.run": { command: "workbench-adapter-secret-agent" } },
        auth: { methods: { "api-key": { env: [{ name: "SECRET_AGENT_KEY" }] } } },
      },
    ];

    const withDefaults = withDefaultWorkbenchAdapterAuthProfiles(spec, manifests);
    const invocations = collectWorkbenchAdapterInvocations([withDefaults.run], manifests);

    expect(invocations.map((invocation) => invocation.use)).toEqual(["orchestrator", "secret-agent"]);
    expect((withDefaults.run.with as { child: { auth?: unknown } }).child.auth).toBe("default");
  });

  test("defaults multi-slot adapter auth to each declared slot", () => {
    const spec = resolveWorkbenchResolvedSourceYaml([
      "version: 4",
      "benchmark:",
      "  version: 4",
      "  name: deployer-eval",
      "  description: Exercise multi-slot adapter auth defaults.",
      "  engine:",
      "    use: workbench",
      "    with:",
      "      environment:",
      "        dockerfile: environment/Dockerfile",
      "      score:",
      "        use: command",
      "        with:",
      "          command: 'true'",
      "candidate:",
      "  version: 4",
      "  name: deployer-eval",
      "  description: Candidate runner for deployer auth.",
      "  files:",
      "    path: candidates/deployer/files",
      "  defaultRun: deployer",
      "  runs:",
      "    deployer:",
      "      name: Deployer",
      "      use: deployer",
      "  improve:",
      "    edits:",
      "      - prompt.md",
      "    use: command",
      "    with:",
      "      command: 'true'",
      "",
    ].join("\n"));
    const manifests = [{
      id: "deployer",
      protocol: "workbench.adapter.v3" as const,
      setup: [],
      operations: { "candidate.run": { command: "workbench-adapter-deployer" } },
      auth: {
        slots: {
          github: { methods: { oauth: { command: "deployer auth github --json" } } },
          llm: { methods: { "api-key": { env: [{ name: "DEPLOYER_LLM_API_KEY" }] } } },
        },
      },
    }];

    const withDefaults = withDefaultWorkbenchAdapterAuthProfiles(spec, manifests);
    expect(withDefaults.run.auth).toEqual({
      github: "default",
      llm: "default",
    });
    expect(collectWorkbenchAdapterAuthRequirements([withDefaults.run], manifests)).toEqual([
      { adapterId: "deployer", slot: "github", profile: "default" },
      { adapterId: "deployer", slot: "llm", profile: "default" },
    ]);
  });

  test("rejects unknown nested adapter auth manifest fields", () => {
    expect(() => parseWorkbenchAdapterManifest([
      "id: typo-auth",
      "protocol: workbench.adapter.v3",
      "operations:",
      "  candidate.run: {}",
      "auth:",
      "  methods:",
      "    api-key:",
      "      envs:",
      "        - TYPO_AUTH_KEY",
      "",
    ].join("\n"))).toThrow("workbench.adapter.yaml.auth.methods.api-key includes unsupported field: envs.");

    expect(() => parseWorkbenchAdapterManifest([
      "id: typo-auth",
      "protocol: workbench.adapter.v3",
      "operations:",
      "  candidate.run: {}",
      "auth:",
      "  slots:",
      "    github:",
      "      method:",
      "        oauth:",
      "          command: typo auth --json",
      "",
    ].join("\n"))).toThrow("workbench.adapter.yaml.auth.slots.github includes unsupported field: method.");

    expect(() => parseWorkbenchAdapterManifest([
      "id: typo-auth",
      "protocol: workbench.adapter.v3",
      "operations:",
      "  candidate.run: {}",
      "auth:",
      "  methods:",
      "    api-key:",
      "      env:",
      "        - name: TYPO_AUTH_KEY",
      "          optional: true",
      "",
    ].join("\n"))).toThrow("workbench.adapter.yaml.auth.methods.api-key.env[0] includes unsupported field: optional.");
  });

  test("rejects absolute resolved paths instead of normalizing them", () => {
    const validation = validateWorkbenchResolvedSourceYaml(genericSpec().replace(
      "    path: candidates/generic-file-output-eval/files",
      "    path: /candidates/generic-file-output-eval/files",
    ));

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("resolved Workbench source.candidate.files.path must be a relative path, not an absolute path.");
  });

  test("rejects globs in resolved candidate file paths", () => {
    const rootValidation = validateWorkbenchResolvedSourceYaml(genericSpec().replace(
      "    path: candidates/generic-file-output-eval/files",
      "    path: candidates/**",
    ));
    const editsValidation = validateWorkbenchResolvedSourceYaml(genericSpec().replace(
      "    - scripts/evaluate.py",
      "    - scripts/evaluate?.py",
    ));

    expect(rootValidation.ok).toBe(false);
    expect(rootValidation.errors).toContain("resolved Workbench source.candidate.files.path must be a literal path, not a glob.");
    expect(editsValidation.ok).toBe(false);
    expect(editsValidation.errors).toContain("resolved Workbench source.candidate.improve.edits[1] must be a literal path, not a glob.");
  });

  test("reports authored Dockerfile environment fields without internal adapter labels", () => {
    const validation = validateWorkbenchResolvedSourceYaml(genericSpec().replace(
      "    dockerfile: environment/Dockerfile",
      "    docker: environment/Dockerfile",
    ));

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("benchmark.yaml.engine.with.environment includes unsupported field: docker.");
    expect(validation.errors).toContain("benchmark.yaml.engine.with.environment.dockerfile must be a non-empty string.");
  });

  test("rejects environment dockerfile shorthand", () => {
    const validation = validateWorkbenchResolvedSourceYaml(genericSpec().replace(
      [
        "      environment:",
        "        dockerfile: environment/Dockerfile",
        "        resources:",
        "          cpu: 2",
        "          memoryGb: 4",
        "          timeoutMinutes: 20",
        "        network:",
        "          egress: none",
      ].join("\n"),
      "      environment: environment/Dockerfile",
    ));

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("benchmark.yaml.engine.with.environment must be an object.");
  });

  test("treats command runner output fields as adapter-owned with data", () => {
    const yaml = genericSpec().replace(
      "        command: python scripts/evaluate.py --run",
      "        command: python scripts/evaluate.py --run\n        output: runner-output.json",
    );
    const validation = validateWorkbenchResolvedSourceYaml(yaml);
    const spec = resolveWorkbenchResolvedSourceYaml(yaml);

    expect(validation.ok).toBe(true);
    expect(spec.run.with).toMatchObject({ output: "runner-output.json" });
  });

  test("treats command environment fields as adapter-owned with data", () => {
    const yaml = genericSpec().replace(
      "        command: python scripts/evaluate.py --run",
      "        command: python scripts/evaluate.py --run\n        cwd: candidate",
    );
    const validation = validateWorkbenchResolvedSourceYaml(yaml);
    const spec = resolveWorkbenchResolvedSourceYaml(yaml);

    expect(validation.ok).toBe(true);
    expect(spec.run.with).toMatchObject({ cwd: "candidate" });
  });

  test("treats rubric fields as adapter-owned with data", () => {
    const yaml = genericSpec().replace(
      "          criteria:",
      "          unexpected: unsupported\n          criteria:",
    );
    const validation = validateWorkbenchResolvedSourceYaml(yaml);
    const spec = resolveWorkbenchResolvedSourceYaml(yaml);
    const score = scoreConfig(spec);

    expect(validation.ok).toBe(true);
    expect(score.with).toMatchObject({ unexpected: "unsupported" });
  });

  test("leaves rubric criterion semantics to the adapter", () => {
    const yaml = genericSpec().replace(
      [
        "            - id: correctness",
        "              description: Output satisfies the task requirements.",
        "              weight: 1",
      ].join("\n"),
      [
        "            - id: correctness",
        "              description: Output satisfies the task requirements.",
        "              weight: 1",
        "            - id: correctness",
        "              description: Duplicate criterion id.",
      ].join("\n"),
    );
    const validation = validateWorkbenchResolvedSourceYaml(yaml);
    const spec = resolveWorkbenchResolvedSourceYaml(yaml);
    const score = scoreConfig(spec);

    expect(validation.ok).toBe(true);
    expect((score.with as { criteria: unknown[] }).criteria).toHaveLength(2);
  });

  test("treats nested judge with data as adapter-owned with data", () => {
    const yaml = genericSpec().replace(
      "            with:\n              model: gpt-5.4-mini",
      "            with:\n              model: gpt-5.4-mini\n              temperature: 0.2",
    );
    const validation = validateWorkbenchResolvedSourceYaml(yaml);
    const spec = resolveWorkbenchResolvedSourceYaml(yaml);
    const score = scoreConfig(spec);

    expect(validation.ok).toBe(true);
    expect(score.with).toMatchObject({
      judge: { with: { temperature: 0.2 } },
    });
  });

  test("treats runner provider with data as adapter-owned with data", () => {
    const yaml = genericSpec()
      .replace(
        "  runs:\n    command:\n      name: Command\n      use: command\n      with:\n        command: python scripts/evaluate.py --run",
        [
          "  runs:",
          "    command:",
          "      name: Codex",
          "      use: codex",
          "      with:",
          "        model: gpt-5.4-mini",
          "        temperature: 0.2",
        ].join("\n"),
      );
    const validation = validateWorkbenchResolvedSourceYaml(yaml);
    const spec = resolveWorkbenchResolvedSourceYaml(yaml);

    expect(validation.ok).toBe(true);
    expect(spec.run.with).toMatchObject({ temperature: 0.2 });
  });

  test("compiles improve and attempt steps into generic sandbox executions", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      sampleIndex: 0,
      spec,
      workflow: "improve",
    });

    expect(graph.executions.map((execution) => execution.purpose)).toEqual(["improve", "attempt"]);
    expect(graph.executions.map((execution) => execution.adapter.use)).toEqual(["codex", "workbench"]);
    expect(graph.executions[1]?.metadata.engineCase).toMatchObject({ prompt: "Run the test task." });
    expect(graph.executions[0]?.outputs).toContainEqual({
      name: "candidate_patch",
      schema: "workbench.candidate_patch.v1",
      required: true,
    });
    expect(graph.executions[0]?.inputs.find((input) => input.name === "candidate")).toMatchObject({
      mountPath: "/workspace",
      writable: true,
    });
    expect(graph.executions[0]?.inputs.find((input) => input.name === "traces")).toMatchObject({
      mountPath: "/workspace/input/traces",
      writable: false,
    });
    expect(graph.executions[1]?.inputs.find((input) => input.name === "candidate")?.writable).toBe(false);
    expect(graph.executions[1]?.inputs.map((input) => input.name)).toEqual(["candidate", "case"]);
    expect(graph.executions[1]?.outputs).toContainEqual({
      name: "result",
      schema: "workbench.result.v1",
      required: true,
    });
    expect(graph.nodes.map((node) => node.dependsOn)).toEqual([
      [],
      [graph.executions[0]!.id],
    ]);
  });

  test("compiles eval workflow without an improve execution", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      sampleIndex: 0,
      caseId: "figma",
      spec,
      workflow: "eval",
    });

    expect(graph.executions.map((execution) => execution.purpose)).toEqual(["attempt"]);
    expect(graph.executions[0]?.inputs.find((input) => input.name === "candidate")?.ref)
      .toBe("workbench://benchmarks/project_123/candidates/candidate_123");
    expect(graph.executions[0]?.inputs.find((input) => input.name === "case")?.ref)
      .toBe("workbench://benchmarks/project_123/engine-cases/figma");
  });

  test("uses one improve execution per improve attempt across samples", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const firstSample = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      sampleIndex: 0,
      spec,
      workflow: "improve",
    });
    const secondSample = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      sampleIndex: 1,
      spec,
      workflow: "improve",
    });

    const firstImprover = firstSample.executions.find((execution) => execution.purpose === "improve");
    const secondImprover = secondSample.executions.find((execution) => execution.purpose === "improve");

    expect(firstImprover?.id).toBe(secondImprover?.id);
    expect(secondSample.nodes.find((node) => node.execution.purpose === "attempt")?.dependsOn)
      .toEqual([firstImprover!.id]);
  });

  test("plans one generic durable attempt job per sample", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const engineCases = [engineCase("task-001", "Run the generic task.")];
    const caseIds = engineCases.map((bundle) => bundle.id);
    const improverJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      samples: 2,
      spec,
      workflow: "improve",
      purpose: "improve",
      caseIds,
      engineCases,
      now: "2026-04-27T00:00:00.000Z",
    });
    const attemptJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      samples: 2,
      spec,
      workflow: "improve",
      purpose: "attempt",
      caseIds,
      engineCases,
      now: "2026-04-27T00:00:00.000Z",
    });

    expect(improverJobs).toHaveLength(1);
    expect(attemptJobs).toHaveLength(2);
    expect([...improverJobs, ...attemptJobs].every((job) => job.kind === "execute")).toBe(true);
    expect(attemptJobs.every((job) => {
      const input = job.input as { dependsOn?: unknown };
      return Array.isArray(input.dependsOn) && input.dependsOn.length === 1;
    })).toBe(true);
  });

  test("plans from resolved engine cases without task package parsing", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const [job] = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      samples: 1,
      caseIds: ["task-a"],
      engineCases: [engineCase("task-a", "Run the alternate task.")],
      spec,
      workflow: "eval",
      purpose: "attempt",
      now: "2026-04-27T00:00:00.000Z",
    });

    expect(job?.input).toMatchObject({
      caseId: "task-a",
    });
  });

  test("plans selected case sample pairs for repair and top-up runs", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const jobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      samples: 3,
      caseIds: ["task-a", "task-b"],
      sampleIndexesByCase: new Map([
        ["task-a", [2]],
        ["task-b", [0, 2]],
      ]),
      engineCases: [
        engineCase("task-a", "Run task A."),
        engineCase("task-b", "Run task B."),
      ],
      spec,
      workflow: "eval",
      purpose: "attempt",
      now: "2026-04-27T00:00:00.000Z",
    });

    expect(jobs.map((job) => {
      const input = job.input as { caseId?: string; sampleIndex?: number };
      return `${input.caseId}:${input.sampleIndex}`;
    })).toEqual(["task-a:2", "task-b:0", "task-b:2"]);
  });

  test("compiled executions satisfy sandbox isolation invariants", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "improve",
    });

    expect(graph.executions.flatMap((execution) => collectWorkbenchExecutionIsolationIssues(execution))).toEqual([]);
  });

  test("runtime-control child executions do not require durable output contracts", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "eval",
    });
    const attempt = graph.executions.find((execution) => execution.purpose === "attempt")!;
    const withoutOutputs = {
      ...attempt,
      outputs: [],
    };

    expect(collectWorkbenchExecutionIsolationIssues(withoutOutputs))
      .toContain(`Execution ${attempt.id} missing required output result for purpose attempt.`);
    expect(collectWorkbenchExecutionIsolationIssues({
      ...withoutOutputs,
      id: `${attempt.id}:runtime:test`,
      metadata: {
        ...attempt.metadata,
        runtimeControl: true,
      },
    })).toEqual([]);
  });

  test("execution capabilities are scoped to one execution input and output prefix", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "eval",
    });
    const execution = graph.executions[0]!;
    const capability = createWorkbenchExecutionCapability(execution, {
      now: "2026-04-27T00:00:00.000Z",
    });

    expect(capability.executionId).toBe(execution.id);
    expect(capability.candidate).toMatchObject({
      tenantId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
    });
    expect(capability.inputs.map((input) => input.name)).toEqual(["candidate", "case"]);
    expect(capability.outputPrefix).toBe(`executions/${execution.id}/outputs/`);
    expect(collectExecutionCapabilityScopeIssues(capability, execution, { now: "2026-04-27T00:00:01.000Z" })).toEqual([]);

    expect(collectExecutionCapabilityScopeIssues({
      ...capability,
      outputPrefix: "executions/other/outputs/",
    }, execution)).toContain(`Capability output prefix must be scoped under executions/${execution.id}/.`);
    expect(collectExecutionCapabilityScopeIssues({
      ...capability,
      network: { egress: "open" },
    }, execution)).toContain(`Capability network policy does not match execution ${execution.id}.`);
    expect(collectExecutionCapabilityScopeIssues({
      ...capability,
      expiresAt: "2026-04-26T00:00:00.000Z",
    }, execution, { now: "2026-04-27T00:00:00.000Z" })).toContain(`Capability is expired for execution ${execution.id}.`);
  });

  test("sandbox allocations are scoped to one execution lifecycle", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "eval",
    });
    const execution = graph.executions[0]!;
    const allocation = createWorkbenchSandboxAllocation(execution, {
      backend: "custom-backend",
      runnerId: "runner_1",
      now: "2026-04-27T00:00:00.000Z",
    });

    expect(allocation.executionId).toBe(execution.id);
    const executionIdPath = execution.id.replace(/[^a-z0-9_]/giu, "_");
    expect(allocation.sandboxId).toMatch(new RegExp(`^sbx_${executionIdPath}_[a-f0-9]{12}$`, "u"));
    expect(allocation.lifecycleId).toContain(executionIdPath);
    expect(allocation.template).toEqual(execution.sandbox);
    expect(allocation.network).toEqual(execution.policy.network);
    expect(collectSandboxAllocationScopeIssues(allocation, execution, { now: "2026-04-27T00:00:01.000Z" })).toEqual([]);

    expect(collectSandboxAllocationScopeIssues({
      ...allocation,
      network: { egress: "open" },
    }, execution, { now: "2026-04-27T00:00:01.000Z" })).toContain(`Sandbox allocation network policy does not match execution ${execution.id}.`);

    const retryAllocation = createWorkbenchSandboxAllocation(execution, {
      backend: "custom-backend",
      runnerId: "runner_1",
      now: "2026-04-27T00:00:00.000Z",
    });
    expect(retryAllocation.executionId).toBe(allocation.executionId);
    expect(retryAllocation.sandboxId).not.toBe(allocation.sandboxId);
    expect(retryAllocation.lifecycleId).not.toBe(allocation.lifecycleId);
  });

  test("sandbox handles are scoped to their allocation and execution", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "eval",
    });
    const execution = graph.executions[0]!;
    const allocation = createWorkbenchSandboxAllocation(execution, {
      backend: "custom-backend",
      runnerId: "runner_1",
      now: "2026-04-27T00:00:00.000Z",
    });
    const handle = {
      sandboxId: allocation.sandboxId,
      lifecycleId: allocation.lifecycleId,
      backend: allocation.backend,
      executionId: execution.id,
      template: allocation.template,
    };

    expect(collectSandboxHandleScopeIssues(handle, allocation, execution)).toEqual([]);
    expect(collectSandboxHandleScopeIssues({
      ...handle,
      lifecycleId: "lc_other",
    }, allocation, execution)).toContain(`Sandbox handle lifecycle id does not match allocation ${allocation.lifecycleId}.`);
  });

  test("candidate patch outputs cannot modify paths outside improve edits", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "improve",
    });

    expect(() => validateWorkbenchExecutionOutputPayloads(graph.executions[0]!, {
      candidate_patch: {
        files: [{
          path: "secrets.txt",
          kind: "text",
          encoding: "utf8",
          content: "leak",
          executable: false,
        }],
        fileChanges: ["secrets.txt"],
      },
    })).toThrow(/outside improve edits: secrets\.txt/u);
  });

  test("candidate patch file entries default missing kind and encoding", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "improve",
    });

    const output = validateWorkbenchExecutionOutputPayloads(graph.executions[0]!, {
      candidate_patch: {
        files: [{
          path: "prompt.md",
          content: "updated prompt",
        }],
        fileChanges: ["prompt.md"],
      },
    });

    expect(output.candidatePatch?.files).toEqual([{
      path: "prompt.md",
      kind: "text",
      encoding: "utf8",
      content: "updated prompt",
      executable: false,
    }]);
  });

  test("sandbox execution wrapper materializes inputs and validates returned payloads", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "eval",
    });
    const engine = graph.executions.find((execution) => execution.purpose === "attempt")!;
    const materialized: string[] = [];
    const result = await executeValidatedSandboxExecution({
      backend: {
        name: "test-backend",
        capabilities: {
          snapshots: false,
          interactiveExec: false,
          filesystemDiff: false,
          networkPolicy: ["none", "open"],
          fileCapabilities: true,
        },
      },
      async createSandbox(request) {
        return {
          sandboxId: request.allocation.sandboxId,
          lifecycleId: request.allocation.lifecycleId,
          backend: request.allocation.backend,
          executionId: request.execution.id,
          template: request.allocation.template,
        };
      },
      async exec(request) {
        return {
          executionId: request.execution.id,
          status: "succeeded",
          startedAt: "2026-04-27T00:00:00.000Z",
          finishedAt: "2026-04-27T00:00:01.000Z",
          outputs: {
            result: blobRef("runs/run_123/score.json"),
          },
        };
      },
      async destroySandbox() {
        return;
      },
    }, engine, {
      fileStore: {
        async materializeInputs(execution) {
          materialized.push(...execution.inputs.map((input) => input.name));
          return execution.inputs.map((input) => ({
            input,
            mountPath: input.mountPath,
            kind: "files" as const,
            files: [],
          }));
        },
        async publishJson(_capability, outputName, payload) {
          return blobRef(`executions/test/outputs/${outputName}.json`, payload);
        },
        async readJson() {
          return {
            score: 0.75,
            summary: "engine passed",
          };
        },
      },
    });

    expect(materialized).toEqual(["candidate", "case"]);
    expect(result.payloads.result?.score).toBe(0.75);
  });

  test("sandbox execution wrapper rejects unsupported backend egress before allocation", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "eval",
    });
    const engine = graph.executions.find((execution) => execution.purpose === "attempt")!;
    let materialized = false;

    await expect(executeValidatedSandboxExecution({
      backend: {
        name: "open-only-backend",
        capabilities: {
          snapshots: false,
          interactiveExec: false,
          filesystemDiff: false,
          networkPolicy: ["open"],
          fileCapabilities: true,
        },
      },
      async createSandbox() {
        throw new Error("createSandbox should not be called");
      },
      async exec() {
        throw new Error("exec should not be called");
      },
      async destroySandbox() {
        throw new Error("destroySandbox should not be called");
      },
    }, engine, {
      fileStore: {
        async materializeInputs() {
          materialized = true;
          return [];
        },
        async publishJson(_capability, outputName, payload) {
          return blobRef(`executions/test/outputs/${outputName}.json`, payload);
        },
        async readJson() {
          return {};
        },
      },
    })).rejects.toThrow("Sandbox backend open-only-backend does not support network egress none");
    expect(materialized).toBe(false);
  });

  test("agent executions derive adapter auth requirements outside execution policy", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "improve",
    });

    expect(graph.executions[0]!.policy).not.toHaveProperty("secrets");
    expect(collectWorkbenchAdapterAuthRequirements(
      [graph.executions[0]!.adapter],
      [{
        id: "codex",
        protocol: "workbench.adapter.v3",
        setup: [],
        operations: { "candidate.improve": { command: "workbench-adapter-codex" } },
        auth: { methods: { oauth: { files: [{ path: ".codex/auth.json" }] } } },
      }],
    )).toEqual([{ adapterId: "codex", profile: "default" }]);
  });

  test("rejects adapter auth env vars that can alter the runtime process", () => {
    const target = {
      adapterId: "codex",
      profile: "default",
    };

    expect(() =>
      createWorkbenchAdapterAuthBundle({
        target,
        method: "api-key",
        env: {
          OPENAI_API_KEY: "sk-test",
        },
      }),
    ).not.toThrow();

    for (const name of ["NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_AUDIT", "WORKBENCH_OUTPUT"]) {
      expect(() =>
        createWorkbenchAdapterAuthBundle({
          target,
          method: "api-key",
          env: {
            [name]: "malicious",
          },
        }),
      ).toThrow(/reserved/u);
    }
  });

  test("built-in adapter defaults use generic adapter auth bundles", async () => {
    const binRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-codex-adapter-"));
    const adapterPath = path.join(binRoot, "codex-adapter.mjs");
    await fs.writeFile(adapterPath, `import fs from "node:fs";
import path from "node:path";
const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, "utf8"));
const entry = request.auth?.self?.default;
if (entry?.method !== "oauth" || entry?.profile !== "default" || !entry?.filesRoot) process.exit(11);
if (request.auth?.adapters?.codex) process.exit(12);
fs.writeFileSync(path.join(entry.filesRoot, ".codex", "auth.json"), "{\\"refreshed\\":true}\\n");
const output = process.env.WORKBENCH_OUTPUT;
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "workbench-result.json"), JSON.stringify({
  protocol: "workbench.adapter-result.v1",
  operation: "candidate.improve",
  ok: true,
  value: {
    files: [{ path: "prompt.md", encoding: "utf8", content: "changed\\n", executable: false }],
    fileChanges: ["prompt.md"]
  }
}, null, 2));
`);
    const spec = withDefaultWorkbenchAdapterAuthProfiles(
      resolveWorkbenchResolvedSourceYaml(genericSpec()),
      [{
        id: "codex",
        protocol: "workbench.adapter.v3",
        setup: [],
        operations: { "candidate.improve": { command: `node ${shellWord(adapterPath)}` } },
        auth: { methods: { oauth: { files: [{ path: ".codex/auth.json" }] } } },
      }],
    );
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "improve",
    });
    const execution = graph.executions[0]!;
    const job = createWorkbenchExecutionJob({
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      execution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });

    const adapterAuthUpdates: WorkbenchAdapterAuthBundle[] = [];
    const completed = await executeAdapterInCurrentRuntime({
      job,
      spec,
      adapterManifests: [{
        id: "codex",
        protocol: "workbench.adapter.v3",
        setup: [],
        operations: { "candidate.improve": { command: `node ${shellWord(adapterPath)}` } },
        auth: { methods: { oauth: { files: [{ path: ".codex/auth.json" }] } } },
      }],
      adapterAuthProfiles: [{
        adapterId: "codex",
        profile: "default",
        method: "oauth",
        status: "connected",
        version: 3,
        files: [{
          path: ".codex/auth.json",
          content: "{}",
          encoding: "utf8",
        }],
        updatedAt: "2026-05-07T00:00:00.000Z",
      }],
      adapterAuthUpdateSink: async (updates) => {
        adapterAuthUpdates.push(...updates);
      },
      baseFiles: [{
        path: "prompt.md",
        kind: "text",
        encoding: "utf8",
        content: "base\n",
        executable: false,
      }, {
        path: "scripts/evaluate.py",
        kind: "text",
        encoding: "utf8",
        content: "print('eval')\n",
        executable: false,
      }],
      engineResolveFiles: [],
      engineCases: [],
    }, execution, "2026-04-27T00:00:00.000Z", createWorkbenchExecutionCapability(execution, {
      now: "2026-04-27T00:00:00.000Z",
    }));

    expect(execution.adapter.auth).toBe("default");
    expect(completed.status).toBe("succeeded");
    expect(adapterAuthUpdates).toHaveLength(1);
    expect(adapterAuthUpdates[0]!.files[0]!.content).toBe("{\"refreshed\":true}\n");
  });

  test("sandbox execution dispatches command improve adapters by operation result output", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "improve",
    });
    const commandImproverExecution = {
      ...graph.executions[0]!,
      adapter: {
        use: "command",
        with: {
          command: "node -e \"const fs=require('fs');const current=fs.readFileSync('prompt.md','utf8');const next=current+'\\nCommand improve edit.\\n';fs.writeFileSync('prompt.md',next);\"",
        },
      },
      policy: {
        ...graph.executions[0]!.policy,
        network: { egress: "open" },
      },
    };
    const job = createWorkbenchExecutionJob({
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      execution: commandImproverExecution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });

    const commandManifest = await commandAdapterManifest();
    const completed = await executeAdapterInCurrentRuntime({
      job,
      spec,
      adapterManifests: [{
        id: "my-agent",
        protocol: "workbench.adapter.v3",
        setup: [],
        operations: { "candidate.run": { command: "workbench-adapter-my-agent" } },
        auth: {
          methods: {
            "api-key": {
              env: [{ name: "MY_AGENT_API_KEY" }],
              files: [{ path: ".my-agent/config.json" }],
            },
          },
        },
      }, commandManifest],
      baseFiles: [{
        path: "prompt.md",
        kind: "text",
        encoding: "utf8",
        content: "base\n",
        executable: false,
      }],
      engineResolveFiles: [],
      engineCases: [],
    }, commandImproverExecution, "2026-04-27T00:00:00.000Z", createWorkbenchExecutionCapability(commandImproverExecution, {
      now: "2026-04-27T00:00:00.000Z",
    }));

    expect(completed.status).toBe("succeeded");
    expect((completed.output as { candidatePatch?: { fileChanges?: string[] } }).candidatePatch?.fileChanges)
      .toEqual(["prompt.md"]);
    expect((completed.output as { candidatePatch?: { files?: Array<{ kind?: string; executable?: boolean }> } }).candidatePatch?.files)
      .toContainEqual(expect.objectContaining({ kind: "text", executable: false }));
  });

  test("sandbox adapter runtime uses execution adapter with data as the authority", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const task = { version: 3 as const, task: "Run execution adapter output." };
    const runCommand = "node -e 'const fs=require(\"fs\");const path=require(\"path\");const r=JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST,\"utf8\"));if (\"enginePrivate\" in r.paths) process.exit(33);if (r.paths.candidate!==path.join(r.paths.workspace,\"input\",\"candidate\")) process.exit(34);if (r.paths.case!==path.join(r.paths.workspace,\"input\",\"case\")) process.exit(35);if (!fs.existsSync(path.join(r.paths.case,\"request.md\"))) process.exit(36);if (fs.existsSync(path.join(r.paths.case,\"secret.txt\"))) process.exit(37);if (fs.existsSync(path.join(r.paths.workspace,\"request.md\"))) process.exit(38);if (fs.existsSync(path.join(r.paths.workspace,\"private\",\"engine\",\"secret.txt\"))) process.exit(39);fs.mkdirSync(r.paths.output,{recursive:true});fs.writeFileSync(path.join(r.paths.output,\"runner-output.txt\"),\"execution-adapter\\n\");' && test -z \"${WORKBENCH_TASK_DIR:-}\" && test -z \"${WORKBENCH_TASK_ID:-}\"";
    const runtimeSpec = {
      ...spec,
      candidate: {
        ...spec.candidate,
        prepare: {
          command: "test -z \"${WORKBENCH_ADAPTER_REQUEST:-}\" && test -z \"${WORKBENCH_RESULT:-}\" && test -n \"${WORKBENCH_OUTPUT:-}\" && test ! -e private/engine/secret.txt && cp -R input/candidate/. .",
        },
      },
      run: {
        use: "command",
        with: { command: runCommand },
      },
    };
    const publicFile = {
      path: "request.md",
      kind: "text" as const,
      encoding: "utf8" as const,
      executable: false,
      content: "public request\n",
    };
    const testFile = {
      path: "secret.txt",
      kind: "text" as const,
      encoding: "utf8" as const,
      executable: false,
      content: "hidden\n",
    };
    const engineCases = [engineCase("case-001", task.task, [publicFile], [testFile])];
    const engineResolveFiles = engineCases[0]!.files.public ?? [];
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec: runtimeSpec,
      task,
      caseId: "case-001",
      workflow: "eval",
    });
    const execution = {
      ...graph.executions.find((entry) => entry.purpose === "attempt")!,
      adapter: {
        use: "command",
        with: {
          command: "node -e 'const fs=require(\"fs\");const path=require(\"path\");const r=JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST,\"utf8\"));if (r.paths.candidate!==path.join(r.paths.workspace,\"input\",\"candidate\")) process.exit(40);if (r.paths.case!==path.join(r.paths.workspace,\"input\",\"case\")) process.exit(41);if (r.paths.enginePrivate!==path.join(r.paths.workspace,\"private\",\"engine\")) process.exit(42);if (!fs.existsSync(path.join(r.paths.enginePrivate,\"secret.txt\"))) process.exit(43);if (!fs.existsSync(path.join(r.paths.case,\"request.md\"))) process.exit(44);if (fs.existsSync(path.join(r.paths.workspace,\"request.md\"))) process.exit(45);fs.mkdirSync(r.paths.output,{recursive:true});fs.writeFileSync(path.join(r.paths.output,\"runner-output.txt\"),\"runner\\n\");fs.writeFileSync(path.join(r.paths.output,\"workbench-result.json\"),JSON.stringify({protocol:\"workbench.adapter-result.v1\",operation:\"engine.run\",ok:true,value:{score:1}}));'",
        },
      },
    };
    const job = createWorkbenchExecutionJob({
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      execution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });

    const commandManifest = await commandAdapterManifest();
    const completed = await executeAdapterInCurrentRuntime({
      job,
      spec: runtimeSpec,
      adapterManifests: [commandManifest],
      baseFiles: [{
        path: "prompt.md",
        kind: "text",
        encoding: "utf8",
        content: "base\n",
        executable: false,
      }],
      engineResolveFiles,
      engineCases,
    }, execution, "2026-04-27T00:00:00.000Z", createWorkbenchExecutionCapability(execution, {
      now: "2026-04-27T00:00:00.000Z",
    }));

    expect(completed.status).toBe("succeeded");
    expect((completed.output as { fileChanges?: string[] }).fileChanges)
      .toContain("runner-output.txt");
  });

  test("host executor runs the adapter locally without sandbox allocation or candidate prepare", async () => {
    const adapterSource = `import fs from "node:fs";
import path from "node:path";
const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, "utf8"));
if (request.operation !== "engine.run") process.exit(11);
if (request.invocation?.use !== "host-engine") process.exit(12);
if (process.cwd() !== process.env.WORKBENCH_ADAPTER_ROOT) process.exit(18);
if (fs.existsSync(path.join(request.paths.workspace, "prepare-ran"))) process.exit(13);
if (!fs.existsSync(path.join(request.paths.candidate, "prompt.md"))) process.exit(14);
if (!fs.existsSync(path.join(request.paths.case, "request.md"))) process.exit(15);
if (fs.existsSync(path.join(request.paths.case, "secret.txt"))) process.exit(16);
if (!fs.existsSync(path.join(request.paths.enginePrivate, "secret.txt"))) process.exit(17);
fs.mkdirSync(request.paths.output, { recursive: true });
fs.writeFileSync(path.join(request.paths.output, "workbench-result.json"), JSON.stringify({
  protocol: "workbench.adapter-result.v1",
  operation: "engine.run",
  ok: true,
  value: { score: 0.87, summary: "host engine passed" }
}, null, 2));
`;
    const baseSpec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const spec = {
      ...baseSpec,
      candidate: {
        ...baseSpec.candidate,
        prepare: {
          command: "printf prepare-ran > prepare-ran && exit 42",
        },
      },
      engineRun: {
        use: "host-engine",
      },
    };
    const publicFile = {
      path: "request.md",
      kind: "text" as const,
      encoding: "utf8" as const,
      executable: false,
      content: "public request\n",
    };
    const privateFile = {
      path: "secret.txt",
      kind: "text" as const,
      encoding: "utf8" as const,
      executable: false,
      content: "private verifier data\n",
    };
    const engineCases = [engineCase("case-001", "Run with host executor.", [publicFile], [privateFile])];
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      caseId: "case-001",
      workflow: "eval",
    });
    const execution = graph.executions.find((entry) => entry.purpose === "attempt")!;
    const job = createWorkbenchExecutionJob({
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      execution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });
    const hostEngineManifest = {
      id: "host-engine",
      protocol: "workbench.adapter.v3" as const,
      setup: [],
      operations: {
        "engine.run": {
          command: "node adapter.mjs",
          executor: "host" as const,
        },
      },
    };
    const jobInput = {
      job,
      spec,
      adapterManifests: [hostEngineManifest],
      adapterFiles: [{
        path: "adapters/host-engine/workbench.adapter.yaml",
        kind: "text" as const,
        encoding: "utf8" as const,
        content: [
          "id: host-engine",
          "protocol: workbench.adapter.v3",
          "operations:",
          "  engine.run:",
          "    command: node adapter.mjs",
          "    executor: host",
          "",
        ].join("\n"),
        executable: false,
      }, {
        path: "adapters/host-engine/adapter.mjs",
        kind: "text" as const,
        encoding: "utf8" as const,
        content: adapterSource,
        executable: false,
      }],
      baseFiles: [{
        path: "prompt.md",
        kind: "text" as const,
        encoding: "utf8" as const,
        content: "base\n",
        executable: false,
      }],
      engineResolveFiles: [publicFile],
      engineCases,
    };
    let sandboxPlaneRequested = false;

    expect(workbenchExecutionExecutorForRuntimeInput(jobInput)).toBe("host");
    const completed = await executeWorkbenchExecutionJob(jobInput, {
      sandboxProvider: DOCKER_SANDBOX_BACKEND,
      createSandboxPlaneForProvider() {
        sandboxPlaneRequested = true;
        throw new Error("sandbox plane should not be created for host executor");
      },
    });

    expect(sandboxPlaneRequested).toBe(false);
    expect(completed.status).toBe("succeeded");
    expect((completed.output as { result?: { score?: number; summary?: string } }).result)
      .toMatchObject({ score: 0.87, summary: "host engine passed" });
  });

  test("host executor resolves runtime-local adapter binaries outside project PATH", async () => {
    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-host-runtime-bin-"));
    const previousCwd = process.cwd();
    try {
      const binRoot = path.join(runtimeRoot, "node_modules", ".bin");
      const adapterPath = path.join(binRoot, "workbench-adapter-test-host");
      await fs.mkdir(binRoot, { recursive: true });
      await fs.writeFile(adapterPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, "utf8"));
if (request.operation !== "engine.run") process.exit(21);
if (request.invocation?.use !== "host-engine") process.exit(22);
fs.mkdirSync(request.paths.output, { recursive: true });
fs.writeFileSync(request.paths.result, JSON.stringify({
  protocol: "workbench.adapter-result.v1",
  operation: "engine.run",
  ok: true,
  value: { score: 0.91, summary: "runtime bin resolved" }
}, null, 2));
`);
      await fs.chmod(adapterPath, 0o755);
      process.chdir(runtimeRoot);
      vi.stubEnv("PATH", "/usr/bin:/bin");

      const baseSpec = resolveWorkbenchResolvedSourceYaml(genericSpec());
      const spec = {
        ...baseSpec,
        engineRun: {
          use: "host-engine",
        },
      };
      const engineCases = [engineCase("case-001", "Run with runtime-local host adapter.")];
      const graph = compileTestExecutionGraph({
        ownerUserId: "user_123",
        projectId: "project_123",
        runId: "run_123",
        candidateId: "candidate_123",
        attemptIndex: 0,
        spec,
        caseId: "case-001",
        workflow: "eval",
      });
      const execution = graph.executions.find((entry) => entry.purpose === "attempt")!;
      const job = createWorkbenchExecutionJob({
        projectId: "project_123",
        runId: "run_123",
        candidateId: "candidate_123",
        execution,
        dependsOn: [],
        now: "2026-04-27T00:00:00.000Z",
      });
      const hostEngineManifest = {
        id: "host-engine",
        protocol: "workbench.adapter.v3" as const,
        setup: [],
        operations: {
          "engine.run": {
            command: "workbench-adapter-test-host",
            executor: "host" as const,
          },
        },
      };

      const completed = await executeWorkbenchExecutionJob({
        job,
        spec,
        adapterManifests: [hostEngineManifest],
        baseFiles: [{
          path: "prompt.md",
          kind: "text" as const,
          encoding: "utf8" as const,
          content: "base\n",
          executable: false,
        }],
        engineResolveFiles: [],
        engineCases,
      }, {
        sandboxProvider: DOCKER_SANDBOX_BACKEND,
        createSandboxPlaneForProvider() {
          throw new Error("sandbox plane should not be created for host executor");
        },
      });

      expect(completed.status).toBe("succeeded");
      expect((completed.output as { result?: { score?: number; summary?: string } }).result)
        .toMatchObject({ score: 0.91, summary: "runtime bin resolved" });
    } finally {
      process.chdir(previousCwd);
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("runtime-control explicit empty inputs override parent case defaults", async () => {
    const adapterSource = `import fs from "node:fs";
import path from "node:path";
const response = await fetch(new URL("/v1/operation-sequence", process.env.WORKBENCH_RUNTIME_CONTROL_URL), {
  method: "POST",
  headers: {
    authorization: \`Bearer \${process.env.WORKBENCH_RUNTIME_CONTROL_TOKEN}\`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    inputs: { enginePrivate: [] },
    operations: [{
      operation: "engine.run",
      invocation: {
        use: "command",
        with: { command: "true" },
      },
    }],
  }),
});
if (!response.ok) throw new Error(await response.text());
const result = await response.json();
if (!result.ok) throw new Error(result.error || "runtime-control failed");
const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, "utf8"));
fs.mkdirSync(request.paths.output, { recursive: true });
fs.writeFileSync(path.join(request.paths.output, "workbench-result.json"), JSON.stringify({
  protocol: "workbench.adapter-result.v1",
  operation: "engine.run",
  ok: true,
  value: { score: 1 }
}, null, 2));
`;
    const baseSpec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const spec = {
      ...baseSpec,
      engineRun: {
        use: "host-engine",
      },
    };
    const publicFile = {
      path: "request.md",
      kind: "text" as const,
      encoding: "utf8" as const,
      executable: false,
      content: "public request\n",
    };
    const privateFile = {
      path: "secret.txt",
      kind: "text" as const,
      encoding: "utf8" as const,
      executable: false,
      content: "private verifier data\n",
    };
    const engineCases = [engineCase("case-001", "Run with explicit empty private input.", [publicFile], [privateFile])];
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      caseId: "case-001",
      workflow: "eval",
    });
    const execution = graph.executions.find((entry) => entry.purpose === "attempt")!;
    const job = createWorkbenchExecutionJob({
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      execution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });
    const hostEngineManifest = {
      id: "host-engine",
      protocol: "workbench.adapter.v3" as const,
      setup: [],
      operations: {
        "engine.run": {
          command: "node adapter.mjs",
          executor: "host" as const,
        },
      },
    };
    let childPrivateFiles: readonly SurfaceSnapshotFile[] | undefined;
    let childOutputs: unknown;

    const completed = await executeWorkbenchExecutionJob({
      job,
      spec,
      adapterManifests: [hostEngineManifest, await commandAdapterManifest()],
      adapterFiles: [{
        path: "adapters/host-engine/workbench.adapter.yaml",
        kind: "text" as const,
        encoding: "utf8" as const,
        content: [
          "id: host-engine",
          "protocol: workbench.adapter.v3",
          "operations:",
          "  engine.run:",
          "    command: node adapter.mjs",
          "    executor: host",
          "",
        ].join("\n"),
        executable: false,
      }, {
        path: "adapters/host-engine/adapter.mjs",
        kind: "text" as const,
        encoding: "utf8" as const,
        content: adapterSource,
        executable: false,
      }],
      baseFiles: [{
        path: "prompt.md",
        kind: "text" as const,
        encoding: "utf8" as const,
        content: "base\n",
        executable: false,
      }],
      engineResolveFiles: [publicFile],
      engineCases,
    }, {
      sandboxProvider: DOCKER_SANDBOX_BACKEND,
      createSandboxPlaneForProvider(_provider, runtimeArgs, startedAt) {
        childPrivateFiles = runtimeArgs.engineCases[0]?.files.private ?? [];
        return {
          backend: {
            name: "test-sandbox",
            capabilities: {
              snapshots: false,
              interactiveExec: false,
              filesystemDiff: false,
              networkPolicy: ["none", "open"],
              fileCapabilities: true,
            },
          },
          async prepareEnvironment(childExecution) {
            childOutputs = childExecution.outputs;
            return {
              backend: "test-sandbox",
              kind: childExecution.sandbox.kind,
              ref: childExecution.sandbox.ref,
            };
          },
          async createSandbox(request) {
            return {
              executionId: request.execution.id,
              sandboxId: request.allocation.sandboxId,
              lifecycleId: request.allocation.lifecycleId,
              backend: request.allocation.backend,
              template: { ...request.allocation.template },
            };
          },
          async exec(request) {
            return {
              executionId: request.execution.id,
              status: "succeeded" as const,
              startedAt,
              finishedAt: startedAt,
              outputs: {},
              metadata: {
                completedJob: {
                  ...runtimeArgs.job,
                  status: "succeeded",
                  startedAt,
                  finishedAt: startedAt,
                  updatedAt: startedAt,
                  output: {
                    ok: true,
                    files: [],
                    fileChanges: [],
                    result: { score: 1 },
                    operationResults: [{
                      protocol: "workbench.adapter-result.v1",
                      operation: "engine.run",
                      ok: true,
                      value: { score: 1 },
                    }],
                  },
                },
              },
            };
          },
          async destroySandbox() {
            return undefined;
          },
        };
      },
    });

    expect(completed.status).toBe("succeeded");
    expect(childPrivateFiles).toEqual([]);
    expect(childOutputs).toEqual([]);
  });

  test("sandbox adapter runtime fails an operation result that reports ok false", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const runtimeSpec = {
      ...spec,
      run: {
        use: "command",
        with: {
          command: "mkdir -p output && printf 'runner\\n' > output/runner-output.txt",
        },
      },
    };
    const task = { version: 3 as const, task: "Reject ok false results." };
    const engineCases = [engineCase("case-001", task.task)];
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec: runtimeSpec,
      task,
      caseId: "case-001",
      workflow: "eval",
    });
    const attemptExecution = graph.executions.find((entry) => entry.purpose === "attempt")!;
    const execution = {
      ...attemptExecution,
      adapter: {
        use: "command",
        with: {
          command: "mkdir -p output && printf '%s\\n' '{\"protocol\":\"workbench.adapter-result.v1\",\"operation\":\"engine.run\",\"ok\":false,\"summary\":\"engine rejected the workspace\",\"value\":{\"score\":1}}' > output/workbench-result.json",
        },
      },
    };
    const job = createWorkbenchExecutionJob({
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      execution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });

    const completed = await executeAdapterInCurrentRuntime({
      job,
      spec: runtimeSpec,
      adapterManifests: [await commandAdapterManifest()],
      baseFiles: [{
        path: "prompt.md",
        kind: "text",
        encoding: "utf8",
        content: "base\n",
        executable: false,
      }],
      engineResolveFiles: [],
      engineCases,
    }, execution, "2026-04-27T00:00:00.000Z", createWorkbenchExecutionCapability(execution, {
      now: "2026-04-27T00:00:00.000Z",
    }));

    expect(completed.status).toBe("failed");
    expect(JSON.stringify(completed.output)).toContain("Adapter command engine.run returned ok false: engine rejected the workspace");
  });

  test("sandbox adapter runtime materializes generic adapter auth", async () => {
    const binRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-adapter-auth-bin-"));
    const adapterPath = path.join(binRoot, "workbench-adapter-my-agent");
    await fs.writeFile(adapterPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, "utf8"));
if (process.env.MY_AGENT_API_KEY !== "secret") process.exit(11);
const root = request.auth?.self?.default?.filesRoot;
if (!root) process.exit(12);
if (request.auth?.adapters?.["my-agent"]) process.exit(14);
if (fs.readFileSync(path.join(root, ".my-agent/config.json"), "utf8") !== "{\\"token\\":\\"file\\"}") process.exit(13);
fs.mkdirSync(process.env.WORKBENCH_OUTPUT, { recursive: true });
if (request.operation !== "candidate.run") {
  fs.writeFileSync(path.join(process.env.WORKBENCH_OUTPUT, "runner-output.txt"), "authed\\n");
  fs.writeFileSync(path.join(process.env.WORKBENCH_OUTPUT, "workbench-result.json"), "{\\"protocol\\":\\"workbench.adapter-result.v1\\",\\"operation\\":\\"engine.run\\",\\"ok\\":true,\\"value\\":{\\"score\\":1}}\\n");
  process.exit(0);
}
fs.writeFileSync(path.join(process.env.WORKBENCH_OUTPUT, "runner-output.txt"), "authed\\n");
fs.writeFileSync(path.join(process.env.WORKBENCH_OUTPUT, "workbench-result.json"), "{\\"protocol\\":\\"workbench.adapter-result.v1\\",\\"operation\\":\\"candidate.run\\",\\"ok\\":true}\\n");
`, { mode: 0o755 });
    vi.stubEnv("PATH", `${binRoot}:${process.env.PATH ?? ""}`);
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const runtimeSpec = {
      ...spec,
      run: {
        use: "command",
        with: {
          command: "mkdir -p output && printf 'authed\\n' > output/runner-output.txt",
        },
      },
    };
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec: runtimeSpec,
      engineCase: { version: 3, prompt: "Use adapter auth." },
      caseId: "case-001",
      workflow: "eval",
    });
    const execution = {
      ...graph.executions.find((entry) => entry.purpose === "attempt")!,
      adapter: {
        use: "my-agent",
        auth: "default",
        with: {},
      },
    };
    const job = createWorkbenchExecutionJob({
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      execution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });
    const adapterAuthProfiles: WorkbenchAdapterAuthBundle[] = [{
      adapterId: "my-agent",
      profile: "default",
      method: "api-key",
      status: "connected",
      version: 3,
      files: [{
        path: ".my-agent/config.json",
        content: "{\"token\":\"file\"}",
        encoding: "utf8",
      }],
      env: [{ name: "MY_AGENT_API_KEY", value: "secret" }],
      updatedAt: "2026-04-27T00:00:00.000Z",
    }];

    const commandManifest = await commandAdapterManifest();
    const completed = await executeAdapterInCurrentRuntime({
      job,
      spec: runtimeSpec,
      adapterManifests: [commandManifest],
      adapterAuthProfiles,
      baseFiles: [{
        path: "prompt.md",
        kind: "text",
        encoding: "utf8",
        content: "base\n",
        executable: false,
      }],
      engineResolveFiles: [],
      engineCases: [engineCase("case-001", "Use adapter auth.")],
    }, execution, "2026-04-27T00:00:00.000Z", createWorkbenchExecutionCapability(execution, {
      now: "2026-04-27T00:00:00.000Z",
    }));

    expect(completed.status).toBe("succeeded");
    expect((completed.output as { fileChanges?: string[] }).fileChanges)
      .toContain("runner-output.txt");
  });

  test("sandbox adapter runtime namespaces nested adapter auth", async () => {
    const binRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-nested-adapter-auth-bin-"));
    const adapterPath = path.join(binRoot, "workbench-adapter-orchestrator");
    await fs.writeFile(adapterPath, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, "utf8"));
if (process.env.SECRET_AGENT_KEY !== "nested-secret") process.exit(11);
if (request.auth?.default) process.exit(12);
if (request.auth?.adapters?.["secret-agent"]?.default?.env?.SECRET_AGENT_KEY !== "materialized") process.exit(13);
if (request.auth?.self?.default?.env?.SECRET_AGENT_KEY) process.exit(14);
fs.mkdirSync(process.env.WORKBENCH_OUTPUT, { recursive: true });
if (request.operation !== "candidate.run") {
  fs.writeFileSync(path.join(process.env.WORKBENCH_OUTPUT, "runner-output.txt"), "nested auth\\n");
  fs.writeFileSync(path.join(process.env.WORKBENCH_OUTPUT, "workbench-result.json"), "{\\"protocol\\":\\"workbench.adapter-result.v1\\",\\"operation\\":\\"engine.run\\",\\"ok\\":true,\\"value\\":{\\"score\\":1}}\\n");
  process.exit(0);
}
fs.writeFileSync(path.join(process.env.WORKBENCH_OUTPUT, "runner-output.txt"), "nested auth\\n");
fs.writeFileSync(path.join(process.env.WORKBENCH_OUTPUT, "workbench-result.json"), "{\\"protocol\\":\\"workbench.adapter-result.v1\\",\\"operation\\":\\"candidate.run\\",\\"ok\\":true}\\n");
    `, { mode: 0o755 });
    vi.stubEnv("PATH", `${binRoot}:${process.env.PATH ?? ""}`);
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const runtimeSpec = {
      ...spec,
      run: {
        use: "command",
        with: {
          command: "mkdir -p output && printf 'nested auth\\n' > output/runner-output.txt",
        },
      },
    };
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec: runtimeSpec,
      engineCase: { version: 3, prompt: "Use nested adapter auth." },
      caseId: "case-001",
      workflow: "eval",
    });
    const execution = {
      ...graph.executions.find((entry) => entry.purpose === "attempt")!,
      adapter: {
        use: "orchestrator",
        with: {
          child: {
            use: "secret-agent",
            auth: "default",
          },
        },
      },
    };
    const job = createWorkbenchExecutionJob({
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      execution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });

    const commandManifest = await commandAdapterManifest();
    const completed = await executeAdapterInCurrentRuntime({
      job,
      spec: runtimeSpec,
      adapterManifests: [{
        id: "orchestrator",
        protocol: "workbench.adapter.v3",
        setup: [],
        operations: { "engine.run": { command: "workbench-adapter-orchestrator" } },
        slots: { child: { path: "/child", operation: "engine.run" as const } },
      }, {
        id: "secret-agent",
        protocol: "workbench.adapter.v3",
        setup: [],
        operations: { "engine.run": { command: "workbench-adapter-secret-agent" } },
        auth: { methods: { "api-key": { env: [{ name: "SECRET_AGENT_KEY" }] } } },
      }, commandManifest],
      adapterAuthProfiles: [{
        adapterId: "secret-agent",
        profile: "default",
        method: "api-key",
        status: "connected",
        version: 3,
        files: [],
        env: [{ name: "SECRET_AGENT_KEY", value: "nested-secret" }],
        updatedAt: "2026-04-27T00:00:00.000Z",
      }],
      baseFiles: [{
        path: "prompt.md",
        kind: "text",
        encoding: "utf8",
        content: "base\n",
        executable: false,
      }],
      engineResolveFiles: [],
      engineCases: [engineCase("case-001", "Use nested adapter auth.")],
    }, execution, "2026-04-27T00:00:00.000Z", createWorkbenchExecutionCapability(execution, {
      now: "2026-04-27T00:00:00.000Z",
    }));

    expect(completed.status).toBe("succeeded");
    expect((completed.output as { fileChanges?: string[] }).fileChanges)
      .toContain("runner-output.txt");
  });

  test("agent improve adapter outputs only candidate files covered by improve edits", async () => {
    const binRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-codex-improve-"));
    const adapterPath = path.join(binRoot, "codex-improve.mjs");
    await fs.writeFile(adapterPath, `import fs from "node:fs";
import path from "node:path";
const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, "utf8"));
if (request.invocation.use !== "codex" || request.operation !== "candidate.improve") process.exit(11);
const output = process.env.WORKBENCH_OUTPUT;
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "workbench-result.json"), JSON.stringify({
  protocol: "workbench.adapter-result.v1",
  operation: "candidate.improve",
  ok: true,
  value: {
    files: [{ path: "prompt.md", encoding: "utf8", content: "changed\\n", executable: false }],
    fileChanges: ["prompt.md"]
  }
}, null, 2));
`);
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "improve",
    });
    const execution = graph.executions.find((entry) => entry.purpose === "improve")!;
    const job = createWorkbenchExecutionJob({
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      execution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });

    const completed = await executeAdapterInCurrentRuntime({
      job,
      spec,
      adapterManifests: [{
        id: "codex",
        protocol: "workbench.adapter.v3",
        setup: [],
        operations: { "candidate.improve": { command: `node ${shellWord(adapterPath)}` } },
      }],
      baseFiles: [
        {
          path: "prompt.md",
          kind: "text",
          encoding: "utf8",
          content: "base\n",
          executable: false,
        },
        {
          path: "scripts/evaluate.py",
          kind: "text",
          encoding: "utf8",
          content: "print('eval')\n",
          executable: false,
        },
      ],
      engineResolveFiles: [],
      engineCases: [],
    }, execution, "2026-04-27T00:00:00.000Z", createWorkbenchExecutionCapability(execution, {
      now: "2026-04-27T00:00:00.000Z",
    }));

    const output = completed.output as {
      candidatePatch?: { fileChanges?: string[] };
      files?: Array<{ path: string }>;
      fileChanges?: string[];
    };
    expect(completed.status).toBe("succeeded");
    expect(output.candidatePatch?.fileChanges).toEqual(["prompt.md"]);
    expect(output.fileChanges).toEqual(["prompt.md"]);
    expect(output.files?.map((file) => file.path).sort()).toEqual(["prompt.md", "scripts/evaluate.py"]);
  });

  test("run envelope budget limits are shared across local and hosted planning", () => {
    expect(expectedWorkbenchRunJobCount({
      workflow: "improve",
      budget: 2,
      samples: 3,
      caseCount: 1,
    })).toBe(8);
    expect(validateWorkbenchRunEnvelope({
      workflow: "improve",
      budget: 2,
      samples: 3,
      caseCount: 1,
    })).toBeNull();
    expect(validateWorkbenchRunEnvelope({
      workflow: "improve",
      budget: 21,
      samples: 1,
      caseCount: 1,
    })).toBe("Run budget cannot exceed 20.");
    expect(validateWorkbenchRunEnvelope({
      workflow: "eval",
      budget: 1,
      samples: 41,
      caseCount: 1,
    })).toBeNull();
  });

  test("sandbox allocations preserve disabled egress policy", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "eval",
    });
    const execution = {
      ...graph.executions.find((entry) => entry.purpose === "attempt")!,
      policy: {
        ...graph.executions.find((entry) => entry.purpose === "attempt")!.policy,
        network: {
          egress: "none" as const,
        },
      },
    };
    const allocation = createWorkbenchSandboxAllocation(execution, {
      backend: "custom-backend",
      runnerId: "runner_1",
      now: "2026-04-27T00:00:00.000Z",
    });

    expect(allocation.backend).toBe("custom-backend");
    expect(allocation.network).toEqual({
      egress: "none",
    });
    expect(collectSandboxAllocationScopeIssues(allocation, execution, { now: "2026-04-27T00:00:01.000Z" })).toEqual([]);
  });

  test("environment network defaults to open egress for all adapter steps", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpecWithoutEnvironmentNetwork());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "improve",
    });

    expect(graph.executions.map((execution) => execution.policy.network)).toEqual([
      { egress: "open" },
      { egress: "open" },
    ]);
  });

  test("explicit environment disabled egress is preserved on execution policies", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpecWithoutEnvironmentNetwork().replace(
      /environment:\n        dockerfile: environment\/Dockerfile/gu,
      [
        "environment:",
        "        dockerfile: environment/Dockerfile",
        "        network:",
        "          egress: none",
      ].join("\n"),
    ));
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "eval",
    });

    expect(graph.executions.map((execution) => execution.policy.network)).toEqual([
      { egress: "none" },
    ]);
  });

  test("rejects non-binary authored network policies", () => {
    const allowlist = validateWorkbenchResolvedSourceYaml(genericSpecWithoutEnvironmentNetwork().replace(
      "environment:\n        dockerfile: environment/Dockerfile",
      "environment:\n        dockerfile: environment/Dockerfile\n        network:\n          egress: allowlist",
    ));
    const allowField = validateWorkbenchResolvedSourceYaml(genericSpecWithoutEnvironmentNetwork().replace(
      "environment:\n        dockerfile: environment/Dockerfile",
      "environment:\n        dockerfile: environment/Dockerfile\n        network:\n          egress: open\n          allow:\n            - api.example.com",
    ));

    expect(allowlist.ok).toBe(false);
    expect(allowlist.errors).toContain("benchmark.yaml.engine.with.environment.network.egress must be none or open.");
    expect(allowField.ok).toBe(false);
    expect(allowField.errors).toContain("benchmark.yaml.engine.with.environment.network includes unsupported field: allow.");
  });

  test("sandbox adapter runner rejects tampered execution capabilities before adapter dispatch", async () => {
    const { validateSandboxAdapterRequest } = require("../worker/sandbox-adapter-runner.cjs") as {
      validateSandboxAdapterRequest(request: unknown): Promise<unknown>;
    };
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "eval",
    });
    const execution = graph.executions[0]!;
    const capability = createWorkbenchExecutionCapability(execution, {
      now: new Date().toISOString(),
    });

    await expect(validateSandboxAdapterRequest({
      jobInput: {
        job: createWorkbenchExecutionJob({
          projectId: "project_123",
          runId: "run_123",
          candidateId: "candidate_123",
          execution,
          dependsOn: [],
          now: "2026-04-27T00:00:00.000Z",
        }),
        spec,
        baseFiles: [],
        engineResolveFiles: [],
      },
      execution,
      capability: {
        ...capability,
        outputPrefix: "executions/other/outputs/",
      },
    })).rejects.toThrow(/Capability output prefix must be scoped/u);

    await expect(validateSandboxAdapterRequest({
      jobInput: {
        job: createWorkbenchExecutionJob({
          projectId: "project_123",
          runId: "run_123",
          candidateId: "candidate_123",
          execution,
          dependsOn: [],
          now: "2026-04-27T00:00:00.000Z",
        }),
        spec,
        baseFiles: [],
        engineResolveFiles: [],
      },
      execution: {
        ...execution,
        policy: {
          ...execution.policy,
          network: { egress: "open" },
        },
      },
      capability,
    })).rejects.toThrow(/job execution policy does not match request execution policy/u);
  });

  test("sandbox adapter runner reconstructs runtime inputs only from the capability input bundle", async () => {
    const { validateSandboxAdapterRequest } = require("../worker/sandbox-adapter-runner.cjs") as {
      validateSandboxAdapterRequest(request: unknown): Promise<{
        jobInput: {
          baseFiles: SurfaceSnapshotFile[];
          engineResolveFiles: SurfaceSnapshotFile[];
          traceFiles: SurfaceSnapshotFile[];
          job: { input?: Record<string, unknown> };
        };
      }>;
    };
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "eval",
    });
    const execution = graph.executions[0]!;
    const capability = createWorkbenchExecutionCapability(execution, {
      now: new Date().toISOString(),
    });
    const candidateFile: SurfaceSnapshotFile = {
      path: "prompt.md",
      kind: "text",
      encoding: "utf8",
      content: "candidate\n",
      executable: false,
    };
    const caseFile: SurfaceSnapshotFile = {
      path: "task.yaml",
      kind: "text",
      encoding: "utf8",
      content: "version: 3\ntask: Run the case.\n",
      executable: false,
    };
    const validated = await validateSandboxAdapterRequest({
      jobInput: {
        job: createWorkbenchExecutionJob({
          projectId: "project_123",
          runId: "run_123",
          candidateId: "candidate_123",
          execution,
          dependsOn: [],
          now: "2026-04-27T00:00:00.000Z",
        }),
        spec,
      },
      execution,
      capability,
      inputBundle: inputBundleForExecution(execution, {
        candidate: [candidateFile],
        case: [caseFile],
      }),
    });

    expect(validated.jobInput.baseFiles).toEqual([candidateFile]);
    expect(validated.jobInput.engineResolveFiles).toEqual([caseFile]);
    expect(validated.jobInput.traceFiles).toEqual([]);
    expect(validated.jobInput.job.input?.archive).toBeUndefined();

    const improveGraph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      candidateId: "candidate_123",
      attemptIndex: 0,
      spec,
      workflow: "improve",
    });
    const improveExecution = improveGraph.executions.find((entry) => entry.purpose === "improve")!;
    const traceFile: SurfaceSnapshotFile = {
      path: "index.json",
      kind: "text",
      encoding: "utf8",
      content: "{\"schema\":\"workbench.optimizer-traces.v1\",\"executions\":[]}\n",
      executable: false,
    };
    const improveCapability = createWorkbenchExecutionCapability(improveExecution, {
      now: new Date().toISOString(),
    });
    const validatedImprove = await validateSandboxAdapterRequest({
      jobInput: {
        job: createWorkbenchExecutionJob({
          projectId: "project_123",
          runId: "run_123",
          candidateId: "candidate_123",
          execution: improveExecution,
          dependsOn: [],
          now: "2026-04-27T00:00:00.000Z",
        }),
        spec,
      },
      execution: improveExecution,
      capability: improveCapability,
      inputBundle: inputBundleForExecution(improveExecution, {
        candidate: [candidateFile],
        traces: [traceFile],
      }),
    });
    expect(validatedImprove.jobInput.traceFiles).toEqual([traceFile]);

    await expect(validateSandboxAdapterRequest({
      jobInput: {
        job: createWorkbenchExecutionJob({
          projectId: "project_123",
          runId: "run_123",
          candidateId: "candidate_123",
          execution,
          dependsOn: [],
          now: "2026-04-27T00:00:00.000Z",
        }),
        spec,
      },
      execution,
      capability,
      inputBundle: {
        inputs: [
          ...inputBundleForExecution(execution).inputs,
          {
            input: {
              name: "other",
              ref: "workbench://benchmarks/project_123/other",
              mountPath: "/workspace/input/other",
              writable: false,
            },
            mountPath: "/workspace/input/other",
            kind: "files",
            files: [],
          },
        ],
      },
    })).rejects.toThrow(/outside the execution capability/u);
  });

  test("candidate patch application preserves immutable files and updates improver edit paths", () => {
    const files = applyWorkbenchCandidatePatch({
      edits: ["prompt.md", "scripts"],
      baseFiles: [{
        path: "prompt.md",
        kind: "text",
        encoding: "utf8",
        content: "base\n",
        executable: false,
      }, {
        path: "README.md",
        kind: "text",
        encoding: "utf8",
        content: "unchanged\n",
        executable: false,
      }],
      patch: {
        fileChanges: ["prompt.md", "scripts/evaluate.py"],
        files: [{
          path: "prompt.md",
          kind: "text",
          encoding: "utf8",
          content: "improved\n",
          executable: false,
        }, {
          path: "scripts/evaluate.py",
          kind: "text",
          encoding: "utf8",
          content: "print('ok')\n",
          executable: true,
        }],
      },
    });

    expect(files.map((file) => file.path)).toEqual(["prompt.md", "README.md", "scripts/evaluate.py"]);
    expect(files.find((file) => file.path === "prompt.md")?.content).toBe("improved\n");
    expect(files.find((file) => file.path === "README.md")?.content).toBe("unchanged\n");
  });

  test("candidate patch application rejects changes outside improve edits", () => {
    expect(() => applyWorkbenchCandidatePatch({
      edits: ["prompt.md"],
      baseFiles: [],
      patch: {
        fileChanges: ["package.json"],
        files: [{
          path: "package.json",
          kind: "text",
          encoding: "utf8",
          content: "{}\n",
          executable: false,
        }],
      },
    })).toThrow(/outside improve edits: package\.json/u);

    expect(() => applyWorkbenchCandidatePatch({
      edits: ["SKILL.md"],
      baseFiles: [{
        path: "SKILL.md",
        kind: "text",
        encoding: "utf8",
        content: "base\n",
        executable: false,
      }],
      patch: {
        fileChanges: ["candidates/my-skill/files/SKILL.md"],
        files: [{
          path: "candidates/my-skill/files/SKILL.md",
          kind: "text",
          encoding: "utf8",
          content: "bad\n",
          executable: false,
        }],
      },
    })).toThrow(/outside improve edits: candidates\/my-skill\/files\/SKILL\.md/u);
  });
});

function blobRef(key: string, payload: unknown = {}) {
  const body = JSON.stringify(payload);
  return {
    bucket: "test-workbench-blobs",
    key,
    byteLength: Buffer.byteLength(body, "utf8"),
    sha256: "0".repeat(64),
  };
}

function adapterCommandPaths(root: string) {
  return {
    workspace: root,
    output: path.join(root, "output"),
    result: path.join(root, "output", "workbench-result.json"),
    candidate: path.join(root, "input", "candidate"),
    case: path.join(root, "input", "case"),
    traces: path.join(root, "input", "traces"),
  };
}

function inputBundleForExecution(
  execution: Parameters<typeof createWorkbenchExecutionCapability>[0],
  data: {
    candidate?: SurfaceSnapshotFile[];
    case?: SurfaceSnapshotFile[];
    traces?: SurfaceSnapshotFile[];
  } = {},
) {
  return {
    inputs: execution.inputs.map((input) => {
      const key = input.name === "case"
        ? "case"
        : input.name as "candidate" | "traces";
      return {
        input,
        mountPath: input.mountPath,
        kind: "files",
        files: data[key] ?? [],
      };
    }),
  };
}

function scoreConfig(
  spec: ReturnType<typeof resolveWorkbenchResolvedSourceYaml>,
): { use: string; with: Record<string, unknown> } {
  const score = (spec.engineRun.with as { score?: { use?: string; with?: Record<string, unknown> } }).score;
  if (!score?.use || !score.with) {
    throw new Error("Test spec is missing engine.with.score.");
  }
  return { use: score.use, with: score.with };
}

function genericSpec(): string {
  return [
    "version: 4",
    "benchmark:",
    "  version: 4",
    "  name: generic-file-output-eval",
    "  description: Exercise generic file-output execution with command running and rubric scoring.",
    "  engine:",
    "    use: workbench",
    "    with:",
    "      environment:",
    "        dockerfile: environment/Dockerfile",
    "        resources:",
    "          cpu: 2",
    "          memoryGb: 4",
    "          timeoutMinutes: 20",
    "        network:",
    "          egress: none",
    "      score:",
    "        use: rubric",
    "        with:",
    "          instructions: Score only from runner output.",
    "          judge:",
    "            use: codex",
    "            with:",
    "              model: gpt-5.4-mini",
    "          criteria:",
    "            - id: correctness",
    "              description: Output satisfies the task requirements.",
    "              weight: 1",
    "candidate:",
    "  version: 4",
    "  name: generic-file-output-eval",
    "  description: Candidate runner for the generic file-output benchmark.",
    "  files:",
    "    path: candidates/generic-file-output-eval/files",
    "  prepare:",
    "    command: cp -R input/candidate/. .",
    "  defaultRun: command",
    "  runs:",
    "    command:",
    "      name: Command",
    "      use: command",
    "      with:",
    "        command: python scripts/evaluate.py --run",
    "  improve:",
    "    edits:",
    "      - prompt.md",
    "      - scripts/evaluate.py",
    "    use: codex",
    "    with:",
    "      model: gpt-5.4-mini",
  ].join("\n");
}

function genericSpecWithoutEnvironmentNetwork(): string {
  return genericSpec().replaceAll(
    "\n        network:\n          egress: none",
    "",
  );
}

async function commandAdapterManifest() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-command-adapter-"));
  const file = path.join(root, "command.mjs");
  await fs.writeFile(file, `
import { spawnSync } from "node:child_process";
import fs from "node:fs";
const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, "utf8"));
const command = request.invocation?.with?.command;
if (typeof command !== "string" || command.length === 0) {
  throw new Error("command adapter requires invocation.with.command");
}
const result = spawnSync("sh", ["-c", command], {
  cwd: request.paths.workspace,
  env: process.env,
  stdio: "inherit",
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
const resultPath = process.env.WORKBENCH_RESULT || request.paths.result || \`\${request.paths.output}/workbench-result.json\`;
if (!fs.existsSync(resultPath)) {
  if (request.operation === "candidate.improve") {
    const files = (request.context?.improve?.edits || [])
      .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
      .map((filePath) => ({
        path: filePath,
        kind: "text",
        encoding: "utf8",
        content: fs.readFileSync(filePath, "utf8"),
        executable: false
      }));
    fs.writeFileSync(resultPath, JSON.stringify({
      protocol: "workbench.adapter-result.v1",
      operation: request.operation,
      ok: true,
      value: {
        files,
        fileChanges: files.map((file) => file.path)
      }
    }, null, 2) + "\\n");
    process.exit(0);
  }
  fs.writeFileSync(resultPath, JSON.stringify({
    protocol: "workbench.adapter-result.v1",
    operation: request.operation,
    ok: true
  }, null, 2) + "\\n");
}
`);
  return {
    id: "command",
    protocol: "workbench.adapter.v3" as const,
    setup: [],
    operations: {
      "candidate.run": { command: `node ${shellWord(file)}` },
      "engine.run": { command: `node ${shellWord(file)}` },
      "candidate.improve": { command: `node ${shellWord(file)}` },
    },
  };
}

function shellWord(value: string): string {
  return `'${value.replace(/'/gu, "'\"'\"'")}'`;
}
