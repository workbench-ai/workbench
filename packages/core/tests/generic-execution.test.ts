import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  applyWorkbenchSubjectPatch,
  compileWorkbenchExecutionGraph,
  collectSandboxAllocationScopeIssues,
  collectExecutionCapabilityScopeIssues,
  collectSandboxHandleScopeIssues,
  collectWorkbenchAdapterAuthRequirements,
  collectWorkbenchAdapterInvocations,
  collectWorkbenchExecutionIsolationIssues,
  createWorkbenchSandboxAllocation,
  createWorkbenchExecutionCapability,
  createWorkbenchExecutionJob,
  expectedWorkbenchRunJobCount,
  executeAdapterInCurrentSandboxRuntime,
  executeValidatedSandboxExecution,
  DOCKER_SANDBOX_BACKEND,
  planWorkbenchExecutionJobsForPurpose,
  parseWorkbenchAdapterManifest,
  resolveWorkbenchResolvedSourceYaml,
  validateWorkbenchRunEnvelope,
  validateWorkbenchResolvedSourceYaml,
  validateWorkbenchExecutionOutputPayloads,
  withDefaultWorkbenchAdapterAuthProfiles,
  type SurfaceSnapshotFile,
  type WorkbenchAdapterAuthBundle,
  type WorkbenchTaskBundle,
} from "../src/index.ts";

const require = createRequire(import.meta.url);

afterEach(() => {
  vi.unstubAllEnvs();
});

function compileTestExecutionGraph(
  input: Parameters<typeof compileWorkbenchExecutionGraph>[0],
) {
  return compileWorkbenchExecutionGraph({
    task: { version: 2, task: "Run the test task." },
    ...input,
  });
}

function taskBundle(
  id: string,
  task: string,
  publicFiles: readonly SurfaceSnapshotFile[] = [],
  testFiles: readonly SurfaceSnapshotFile[] = [],
): WorkbenchTaskBundle {
  return {
    id,
    task: { version: 2, task },
    publicFiles: publicFiles.map((file) => ({ ...file })),
    testFiles: testFiles.map((file) => ({ ...file })),
    sourceFiles: [...publicFiles, ...testFiles]
      .map((file) => ({ ...file }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

describe("generic sandbox execution contract", () => {
  test("parses split benchmark/subject/optimizer source without leaking runtime-specific role schemas", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());

    expect(spec.version).toBe(2);
    expect(spec.description).toBe("Exercise generic file-output execution with command running and rubric scoring.");
    expect(spec.improve).toEqual({
      use: "codex",
      with: {
        model: "gpt-5.4-mini",
      },
    });
    expect(spec.environment.dockerfile).toBe("environment/Dockerfile");
    expect(spec.run.use).toBe("command");
    expect(spec.score.use).toBe("rubric");
  });

  test("source spec validation is the split benchmark/subject/optimizer contract", () => {
    const validation = validateWorkbenchResolvedSourceYaml(genericSpec());
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());

    expect(validation.ok).toBe(true);
    expect(spec.improve?.use).toBe("codex");
    expect(spec.environment.dockerfile).toBe("environment/Dockerfile");
    expect(spec.run.with).toMatchObject({
      command: "python scripts/evaluate.py --run",
    });
    expect(spec.score.use).toBe("rubric");
    expect(spec.optimizer?.edits).toEqual(["prompt.md", "scripts/evaluate.py"]);
  });

  test("adapter manifest slots drive nested default auth without role-specific logic", () => {
    const spec = resolveWorkbenchResolvedSourceYaml([
      "version: 2",
      "benchmark:",
      "  version: 2",
      "  name: nested-auth",
      "  description: Exercise manifest-declared nested adapter auth.",
      "  tasks:",
      "    path: tasks",
      "  environment:",
      "    dockerfile: environment/Dockerfile",
      "  score:",
      "    use: command",
      "    with:",
      "      command: 'true'",
      "subject:",
      "  version: 2",
      "  name: nested-auth",
      "  description: Subject runner for nested auth.",
      "  files:",
      "    path: subjects/nested-auth/files",
      "  run:",
      "    use: orchestrator",
      "    with:",
      "      child:",
      "        use: secret-agent",
      "optimizer:",
      "  version: 2",
      "  name: nested-auth optimizer",
      "  edits:",
      "    - SKILL.md",
      "  improve:",
      "    use: command",
      "    with:",
      "      command: 'true'",
      "",
    ].join("\n"));
    const manifests = [
      {
        id: "orchestrator",
        protocol: "workbench.adapter.v2" as const,
        setup: [],
        operations: { "subject.run": { command: "workbench-adapter-orchestrator" } },
        slots: { child: { path: "/child", operation: "subject.run" as const } },
      },
      {
        id: "secret-agent",
        protocol: "workbench.adapter.v2" as const,
        setup: [],
        operations: { "subject.run": { command: "workbench-adapter-secret-agent" } },
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
      "version: 2",
      "benchmark:",
      "  version: 2",
      "  name: deployer-eval",
      "  description: Exercise multi-slot adapter auth defaults.",
      "  tasks:",
      "    path: tasks",
      "  environment:",
      "    dockerfile: environment/Dockerfile",
      "  score:",
      "    use: command",
      "    with:",
      "      command: 'true'",
      "subject:",
      "  version: 2",
      "  name: deployer-eval",
      "  description: Subject runner for deployer auth.",
      "  files:",
      "    path: subjects/deployer/files",
      "  run:",
      "    use: deployer",
      "optimizer:",
      "  version: 2",
      "  name: deployer-eval optimizer",
      "  edits:",
      "    - prompt.md",
      "  improve:",
      "    use: command",
      "    with:",
      "      command: 'true'",
      "",
    ].join("\n"));
    const manifests = [{
      id: "deployer",
      protocol: "workbench.adapter.v2" as const,
      setup: [],
      operations: { "subject.run": { command: "workbench-adapter-deployer" } },
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
      "protocol: workbench.adapter.v2",
      "operations:",
      "  subject.run: {}",
      "auth:",
      "  methods:",
      "    api-key:",
      "      envs:",
      "        - TYPO_AUTH_KEY",
      "",
    ].join("\n"))).toThrow("workbench.adapter.yaml.auth.methods.api-key includes unsupported field: envs.");

    expect(() => parseWorkbenchAdapterManifest([
      "id: typo-auth",
      "protocol: workbench.adapter.v2",
      "operations:",
      "  subject.run: {}",
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
      "protocol: workbench.adapter.v2",
      "operations:",
      "  subject.run: {}",
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
      "    path: subjects/generic-file-output-eval/files",
      "    path: /subjects/generic-file-output-eval/files",
    ));

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("resolved Workbench source.subject.files.path must be a relative path, not an absolute path.");
  });

  test("rejects globs in resolved subject file paths", () => {
    const rootValidation = validateWorkbenchResolvedSourceYaml(genericSpec().replace(
      "    path: subjects/generic-file-output-eval/files",
      "    path: subjects/**",
    ));
    const editsValidation = validateWorkbenchResolvedSourceYaml(genericSpec().replace(
      "    - scripts/evaluate.py",
      "    - scripts/evaluate?.py",
    ));

    expect(rootValidation.ok).toBe(false);
    expect(rootValidation.errors).toContain("resolved Workbench source.subject.files.path must be a literal path, not a glob.");
    expect(editsValidation.ok).toBe(false);
    expect(editsValidation.errors).toContain("optimizer YAML.edits[1] must be a literal path, not a glob.");
  });

  test("reports authored Dockerfile environment fields without internal adapter labels", () => {
    const validation = validateWorkbenchResolvedSourceYaml(genericSpec().replace(
      "    dockerfile: environment/Dockerfile",
      "    docker: environment/Dockerfile",
    ));

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("benchmark.yaml.environment includes unsupported field: docker.");
    expect(validation.errors).toContain("benchmark.yaml.environment.dockerfile must be a non-empty string.");
    expect(validation.errors.some((entry) => entry.includes(".with"))).toBe(false);
  });

  test("rejects environment dockerfile shorthand", () => {
    const validation = validateWorkbenchResolvedSourceYaml(genericSpec().replace(
      [
        "  environment:",
        "    dockerfile: environment/Dockerfile",
        "    resources:",
        "      cpu: 2",
        "      memoryGb: 4",
        "      timeoutMinutes: 20",
        "    network:",
        "      egress: none",
      ].join("\n"),
      "  environment: environment/Dockerfile",
    ));

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("benchmark.yaml.environment must be an object.");
  });

  test("treats command runner output fields as adapter-owned with data", () => {
    const yaml = genericSpec().replace(
      "      command: python scripts/evaluate.py --run",
      "      command: python scripts/evaluate.py --run\n      output: runner-output.json",
    );
    const validation = validateWorkbenchResolvedSourceYaml(yaml);
    const spec = resolveWorkbenchResolvedSourceYaml(yaml);

    expect(validation.ok).toBe(true);
    expect(spec.run.with).toMatchObject({ output: "runner-output.json" });
  });

  test("treats command environment fields as adapter-owned with data", () => {
    const yaml = genericSpec().replace(
      "      command: python scripts/evaluate.py --run",
      "      command: python scripts/evaluate.py --run\n      cwd: subject",
    );
    const validation = validateWorkbenchResolvedSourceYaml(yaml);
    const spec = resolveWorkbenchResolvedSourceYaml(yaml);

    expect(validation.ok).toBe(true);
    expect(spec.run.with).toMatchObject({ cwd: "subject" });
  });

  test("treats rubric fields as adapter-owned with data", () => {
    const yaml = genericSpec().replace(
      "      criteria:",
      "      unexpected: unsupported\n      criteria:",
    );
    const validation = validateWorkbenchResolvedSourceYaml(yaml);
    const spec = resolveWorkbenchResolvedSourceYaml(yaml);

    expect(validation.ok).toBe(true);
    expect(spec.score.with).toMatchObject({ unexpected: "unsupported" });
  });

  test("leaves rubric criterion semantics to the adapter", () => {
    const yaml = genericSpec().replace(
      [
        "        - id: correctness",
        "          description: Output satisfies the task requirements.",
        "          weight: 1",
      ].join("\n"),
      [
        "        - id: correctness",
        "          description: Output satisfies the task requirements.",
        "          weight: 1",
        "        - id: correctness",
        "          description: Duplicate criterion id.",
      ].join("\n"),
    );
    const validation = validateWorkbenchResolvedSourceYaml(yaml);
    const spec = resolveWorkbenchResolvedSourceYaml(yaml);

    expect(validation.ok).toBe(true);
    expect((spec.score.with as { criteria: unknown[] }).criteria).toHaveLength(2);
  });

  test("treats nested judge with data as adapter-owned with data", () => {
    const yaml = genericSpec().replace(
      "        with:\n          model: gpt-5.4-mini",
      "        with:\n          model: gpt-5.4-mini\n          temperature: 0.2",
    );
    const validation = validateWorkbenchResolvedSourceYaml(yaml);
    const spec = resolveWorkbenchResolvedSourceYaml(yaml);

    expect(validation.ok).toBe(true);
    expect(spec.score.with).toMatchObject({
      judge: { with: { temperature: 0.2 } },
    });
  });

  test("treats runner provider with data as adapter-owned with data", () => {
    const yaml = genericSpec()
      .replace(
        "  run:\n    use: command\n    with:\n      command: python scripts/evaluate.py --run",
        [
          "  run:",
          "    use: codex",
          "    with:",
          "      model: gpt-5.4-mini",
          "      temperature: 0.2",
        ].join("\n"),
      );
    const validation = validateWorkbenchResolvedSourceYaml(yaml);
    const spec = resolveWorkbenchResolvedSourceYaml(yaml);

    expect(validation.ok).toBe(true);
    expect(spec.run.with).toMatchObject({ temperature: 0.2 });
  });

  test("compiles improve and trial phases into generic sandbox executions", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      sampleIndex: 0,
      spec,
      workflow: "improve",
    });

    expect(graph.executions.map((execution) => execution.purpose)).toEqual(["improve", "trial"]);
    expect(graph.executions.map((execution) => execution.adapter.use)).toEqual(["codex", "command"]);
    expect(graph.executions[1]?.metadata.scoreAdapter).toMatchObject({ use: "rubric" });
    expect(graph.executions[0]?.outputs).toContainEqual({
      name: "subject_patch",
      schema: "workbench.subject_patch.v1",
      required: true,
    });
    expect(graph.executions[1]?.inputs.find((input) => input.name === "subject")?.writable).toBe(false);
    expect(graph.executions[1]?.inputs.map((input) => input.name)).toEqual(["subject", "task"]);
    expect(graph.executions[1]?.outputs).toContainEqual({
      name: "scorecard",
      schema: "workbench.scorecard.v1",
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
      subjectId: "subject_123",
      trialIndex: 0,
      sampleIndex: 0,
      caseId: "figma",
      spec,
      workflow: "eval",
    });

    expect(graph.executions.map((execution) => execution.purpose)).toEqual(["trial"]);
    expect(graph.executions[0]?.inputs.find((input) => input.name === "subject")?.ref)
      .toBe("workbench://benchmarks/project_123/subjects/subject_123");
    expect(graph.executions[0]?.inputs.find((input) => input.name === "task")?.ref)
      .toBe("workbench://benchmarks/project_123/tasks/figma");
  });

  test("uses one improve execution per improve trial across samples", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const firstSample = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      sampleIndex: 0,
      spec,
      workflow: "improve",
    });
    const secondSample = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      sampleIndex: 1,
      spec,
      workflow: "improve",
    });

    const firstOptimizer = firstSample.executions.find((execution) => execution.purpose === "improve");
    const secondOptimizer = secondSample.executions.find((execution) => execution.purpose === "improve");

    expect(firstOptimizer?.id).toBe(secondOptimizer?.id);
    expect(secondSample.nodes.find((node) => node.execution.purpose === "trial")?.dependsOn)
      .toEqual([firstOptimizer!.id]);
  });

  test("plans one generic durable trial job per sample", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const taskBundles = [taskBundle("task-001", "Run the generic task.")];
    const caseIds = taskBundles.map((bundle) => bundle.id);
    const optimizerJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      samples: 2,
      spec,
      workflow: "improve",
      purpose: "improve",
      caseIds,
      taskBundles,
      now: "2026-04-27T00:00:00.000Z",
    });
    const trialJobs = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      samples: 2,
      spec,
      workflow: "improve",
      purpose: "trial",
      caseIds,
      taskBundles,
      now: "2026-04-27T00:00:00.000Z",
    });

    expect(optimizerJobs).toHaveLength(1);
    expect(trialJobs).toHaveLength(2);
    expect([...optimizerJobs, ...trialJobs].every((job) => job.kind === "execute")).toBe(true);
    expect(trialJobs.every((job) => {
      const input = job.input as { dependsOn?: unknown };
      return Array.isArray(input.dependsOn) && input.dependsOn.length === 1;
    })).toBe(true);
  });

  test("plans from explicit task bundles without task package parsing", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const [job] = planWorkbenchExecutionJobsForPurpose({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      samples: 1,
      caseIds: ["task-a"],
      taskBundles: [taskBundle("task-a", "Run the alternate task.")],
      spec,
      workflow: "eval",
      purpose: "trial",
      now: "2026-04-27T00:00:00.000Z",
    });

    expect(job?.input).toMatchObject({
      caseId: "task-a",
    });
  });

  test("compiled executions satisfy sandbox isolation invariants", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      workflow: "improve",
    });

    expect(graph.executions.flatMap((execution) => collectWorkbenchExecutionIsolationIssues(execution))).toEqual([]);
  });

  test("execution capabilities are scoped to one execution input and output prefix", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      workflow: "eval",
    });
    const execution = graph.executions[0]!;
    const capability = createWorkbenchExecutionCapability(execution, {
      now: "2026-04-27T00:00:00.000Z",
    });

    expect(capability.executionId).toBe(execution.id);
    expect(capability.subject).toMatchObject({
      tenantId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
    });
    expect(capability.inputs.map((input) => input.name)).toEqual(["subject", "task"]);
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
      subjectId: "subject_123",
      trialIndex: 0,
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
      subjectId: "subject_123",
      trialIndex: 0,
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

  test("subject patch outputs cannot modify paths outside optimizer edits", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      workflow: "improve",
    });

    expect(() => validateWorkbenchExecutionOutputPayloads(graph.executions[0]!, {
      subject_patch: {
        files: [{
          path: "secrets.txt",
          kind: "text",
          encoding: "utf8",
          content: "leak",
          executable: false,
        }],
        fileChanges: ["secrets.txt"],
      },
    })).toThrow(/outside optimizer edits: secrets\.txt/u);
  });

  test("subject patch file entries default missing kind and encoding", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      workflow: "improve",
    });

    const output = validateWorkbenchExecutionOutputPayloads(graph.executions[0]!, {
      subject_patch: {
        files: [{
          path: "prompt.md",
          content: "updated prompt",
        }],
        fileChanges: ["prompt.md"],
      },
    });

    expect(output.subjectPatch?.files).toEqual([{
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
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      workflow: "eval",
    });
    const scorer = graph.executions.find((execution) => execution.purpose === "trial")!;
    const materialized: string[] = [];
    const result = await executeValidatedSandboxExecution({
      backend: {
        name: "test-backend",
        capabilities: {
          snapshots: false,
          interactiveExec: false,
          filesystemDiff: false,
          networkPolicy: ["none", "open", "allowlist"],
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
            scorecard: blobRef("runs/run_123/score.json"),
          },
        };
      },
      async destroySandbox() {
        return;
      },
    }, scorer, {
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
            summary: "scorer passed",
          };
        },
      },
    });

    expect(materialized).toEqual(["subject", "task"]);
    expect(result.payloads.scorecard?.score).toBe(0.75);
  });

  test("agent executions derive adapter auth requirements outside execution policy", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      workflow: "improve",
    });

    expect(graph.executions[0]!.policy).not.toHaveProperty("secrets");
    expect(collectWorkbenchAdapterAuthRequirements(
      [graph.executions[0]!.adapter],
      [{
        id: "codex",
        protocol: "workbench.adapter.v2",
        setup: [],
        operations: { "subject.improve": { command: "workbench-adapter-codex" } },
        auth: { methods: { oauth: { files: [{ path: ".codex/auth.json" }] } } },
      }],
    )).toEqual([{ adapterId: "codex", profile: "default" }]);
  });

  test("built-in adapter defaults use generic adapter auth bundles", async () => {
    const binRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-codex-adapter-"));
    const adapterPath = path.join(binRoot, "codex-adapter.mjs");
    await fs.writeFile(adapterPath, `import fs from "node:fs";
import path from "node:path";
const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, "utf8"));
const entry = request.auth?.self?.default;
if (entry?.method !== "oauth" || entry?.profile !== "default" || !entry?.filesRoot) process.exit(11);
if (request.auth?.adapters?.codex?.default?.filesRoot !== entry.filesRoot) process.exit(12);
const output = process.env.WORKBENCH_OUTPUT;
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "workbench-result.json"), JSON.stringify({
  protocol: "workbench.adapter-result.v1",
  operation: "subject.improve",
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
        protocol: "workbench.adapter.v2",
        setup: [],
        operations: { "subject.improve": { command: `node ${shellWord(adapterPath)}` } },
        auth: { methods: { oauth: { files: [{ path: ".codex/auth.json" }] } } },
      }],
    );
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      workflow: "improve",
    });
    const execution = graph.executions[0]!;
    const job = createWorkbenchExecutionJob({
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      execution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });

    const completed = await executeAdapterInCurrentSandboxRuntime({
      job,
      spec,
      adapterManifests: [{
        id: "codex",
        protocol: "workbench.adapter.v2",
        setup: [],
        operations: { "subject.improve": { command: `node ${shellWord(adapterPath)}` } },
        auth: { methods: { oauth: { files: [{ path: ".codex/auth.json" }] } } },
      }],
      adapterAuthProfiles: [{
        adapterId: "codex",
        profile: "default",
        method: "oauth",
        status: "connected",
        version: 2,
        files: [{
          path: ".codex/auth.json",
          content: "{}",
          encoding: "utf8",
        }],
        updatedAt: "2026-05-07T00:00:00.000Z",
      }],
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
      taskSourceFiles: [],
      taskBundles: [],
    }, execution, "2026-04-27T00:00:00.000Z", createWorkbenchExecutionCapability(execution, {
      now: "2026-04-27T00:00:00.000Z",
    }));

    expect(execution.adapter.auth).toBe("default");
    expect(completed.status).toBe("succeeded");
  });

  test("sandbox execution dispatches command improve adapters by operation result output", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      workflow: "improve",
    });
    const commandOptimizerExecution = {
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
      subjectId: "subject_123",
      execution: commandOptimizerExecution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });

    const commandManifest = await commandAdapterManifest();
    const completed = await executeAdapterInCurrentSandboxRuntime({
      job,
      spec,
      adapterManifests: [{
        id: "my-agent",
        protocol: "workbench.adapter.v2",
        setup: [],
        operations: { "subject.run": { command: "workbench-adapter-my-agent" } },
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
      taskSourceFiles: [],
      taskBundles: [],
    }, commandOptimizerExecution, "2026-04-27T00:00:00.000Z", createWorkbenchExecutionCapability(commandOptimizerExecution, {
      now: "2026-04-27T00:00:00.000Z",
    }));

    expect(completed.status).toBe("succeeded");
    expect((completed.output as { subjectPatch?: { fileChanges?: string[] } }).subjectPatch?.fileChanges)
      .toEqual(["prompt.md"]);
    expect((completed.output as { subjectPatch?: { files?: Array<{ kind?: string; executable?: boolean }> } }).subjectPatch?.files)
      .toContainEqual(expect.objectContaining({ kind: "text", executable: false }));
  });

  test("sandbox adapter runtime uses execution adapter with data as the authority", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const task = { version: 2 as const, task: "Run execution adapter output." };
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
    const taskBundles = [taskBundle("case-001", task.task, [publicFile], [testFile])];
    const taskSourceFiles = taskBundles[0]!.sourceFiles ?? [];
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      task,
      caseId: "case-001",
      workflow: "eval",
    });
    const execution = {
      ...graph.executions.find((entry) => entry.purpose === "trial")!,
      adapter: {
        use: "command",
        with: {
          command: "test -z \"${WORKBENCH_TASK_DIR:-}\" && test -z \"${WORKBENCH_TASK_ID:-}\" && test -f request.md && test ! -e tests/secret.txt && mkdir -p output && printf 'execution-adapter\\n' > output/runner-output.txt",
        },
      },
      metadata: {
        ...graph.executions.find((entry) => entry.purpose === "trial")!.metadata,
        scoreAdapter: {
          use: "command",
          with: {
            command: "test -f tests/secret.txt && test -f output/runner-output.txt && mkdir -p output && printf '%s\\n' '{\"protocol\":\"workbench.adapter-result.v1\",\"operation\":\"trial.score\",\"ok\":true,\"value\":{\"score\":1}}' > output/workbench-result.json",
          },
        },
      },
    };
    const job = createWorkbenchExecutionJob({
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      execution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });

    const commandManifest = await commandAdapterManifest();
    const completed = await executeAdapterInCurrentSandboxRuntime({
      job,
      spec,
      adapterManifests: [commandManifest],
      baseFiles: [{
        path: "prompt.md",
        kind: "text",
        encoding: "utf8",
        content: "base\n",
        executable: false,
      }],
      taskSourceFiles,
      taskBundles,
    }, execution, "2026-04-27T00:00:00.000Z", createWorkbenchExecutionCapability(execution, {
      now: "2026-04-27T00:00:00.000Z",
    }));

    expect(completed.status).toBe("succeeded");
    expect((completed.output as { fileChanges?: string[] }).fileChanges)
      .toContain("runner-output.txt");
  });

  test("sandbox adapter runtime fails an operation result that reports ok false", async () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const task = { version: 2 as const, task: "Reject ok false scorecards." };
    const taskBundles = [taskBundle("case-001", task.task)];
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      task,
      caseId: "case-001",
      workflow: "eval",
    });
    const trialExecution = graph.executions.find((entry) => entry.purpose === "trial")!;
    const execution = {
      ...trialExecution,
      adapter: {
        use: "command",
        with: {
          command: "mkdir -p output && printf 'runner\\n' > output/runner-output.txt",
        },
      },
      metadata: {
        ...trialExecution.metadata,
        scoreAdapter: {
          use: "command",
          with: {
            command: "mkdir -p output && printf '%s\\n' '{\"protocol\":\"workbench.adapter-result.v1\",\"operation\":\"trial.score\",\"ok\":false,\"summary\":\"scorer rejected the workspace\",\"value\":{\"score\":1}}' > output/workbench-result.json",
          },
        },
      },
    };
    const job = createWorkbenchExecutionJob({
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      execution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });

    const completed = await executeAdapterInCurrentSandboxRuntime({
      job,
      spec,
      adapterManifests: [await commandAdapterManifest()],
      baseFiles: [{
        path: "prompt.md",
        kind: "text",
        encoding: "utf8",
        content: "base\n",
        executable: false,
      }],
      taskSourceFiles: [],
      taskBundles,
    }, execution, "2026-04-27T00:00:00.000Z", createWorkbenchExecutionCapability(execution, {
      now: "2026-04-27T00:00:00.000Z",
    }));

    expect(completed.status).toBe("failed");
    expect(JSON.stringify(completed.output)).toContain("Adapter command trial.score returned ok false: scorer rejected the workspace");
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
if (request.auth?.adapters?.["my-agent"]?.default?.filesRoot !== root) process.exit(14);
if (fs.readFileSync(path.join(root, ".my-agent/config.json"), "utf8") !== "{\\"token\\":\\"file\\"}") process.exit(13);
fs.mkdirSync(process.env.WORKBENCH_OUTPUT, { recursive: true });
if (request.operation !== "subject.run") {
  fs.writeFileSync(path.join(process.env.WORKBENCH_OUTPUT, "workbench-result.json"), "{\\"protocol\\":\\"workbench.adapter-result.v1\\",\\"operation\\":\\"trial.score\\",\\"ok\\":true,\\"value\\":{\\"score\\":1}}\\n");
  process.exit(0);
}
fs.writeFileSync(path.join(process.env.WORKBENCH_OUTPUT, "runner-output.txt"), "authed\\n");
fs.writeFileSync(path.join(process.env.WORKBENCH_OUTPUT, "workbench-result.json"), "{\\"protocol\\":\\"workbench.adapter-result.v1\\",\\"operation\\":\\"subject.run\\",\\"ok\\":true}\\n");
`, { mode: 0o755 });
    vi.stubEnv("PATH", `${binRoot}:${process.env.PATH ?? ""}`);
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      task: { version: 2, task: "Use adapter auth." },
      caseId: "case-001",
      workflow: "eval",
    });
    const execution = {
      ...graph.executions.find((entry) => entry.purpose === "trial")!,
      adapter: {
        use: "my-agent",
        auth: "default",
        with: {},
      },
      metadata: {
        ...graph.executions.find((entry) => entry.purpose === "trial")!.metadata,
        scoreAdapter: {
          use: "command",
          with: { command: "mkdir -p output && printf '%s\\n' '{\"protocol\":\"workbench.adapter-result.v1\",\"operation\":\"trial.score\",\"ok\":true,\"value\":{\"score\":0.75}}' > output/workbench-result.json" },
        },
      },
    };
    const job = createWorkbenchExecutionJob({
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      execution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });
    const adapterAuthProfiles: WorkbenchAdapterAuthBundle[] = [{
      adapterId: "my-agent",
      profile: "default",
      method: "api-key",
      status: "connected",
      version: 2,
      files: [{
        path: ".my-agent/config.json",
        content: "{\"token\":\"file\"}",
        encoding: "utf8",
      }],
      env: [{ name: "MY_AGENT_API_KEY", value: "secret" }],
      updatedAt: "2026-04-27T00:00:00.000Z",
    }];

    const commandManifest = await commandAdapterManifest();
    const completed = await executeAdapterInCurrentSandboxRuntime({
      job,
      spec,
      adapterManifests: [commandManifest],
      adapterAuthProfiles,
      baseFiles: [{
        path: "prompt.md",
        kind: "text",
        encoding: "utf8",
        content: "base\n",
        executable: false,
      }],
      taskSourceFiles: [],
      taskBundles: [taskBundle("case-001", "Use adapter auth.")],
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
fs.mkdirSync(process.env.WORKBENCH_OUTPUT, { recursive: true });
if (request.operation !== "subject.run") {
  fs.writeFileSync(path.join(process.env.WORKBENCH_OUTPUT, "workbench-result.json"), "{\\"protocol\\":\\"workbench.adapter-result.v1\\",\\"operation\\":\\"trial.score\\",\\"ok\\":true,\\"value\\":{\\"score\\":1}}\\n");
  process.exit(0);
}
fs.writeFileSync(path.join(process.env.WORKBENCH_OUTPUT, "runner-output.txt"), "nested auth\\n");
fs.writeFileSync(path.join(process.env.WORKBENCH_OUTPUT, "workbench-result.json"), "{\\"protocol\\":\\"workbench.adapter-result.v1\\",\\"operation\\":\\"subject.run\\",\\"ok\\":true}\\n");
`, { mode: 0o755 });
    vi.stubEnv("PATH", `${binRoot}:${process.env.PATH ?? ""}`);
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      task: { version: 2, task: "Use nested adapter auth." },
      caseId: "case-001",
      workflow: "eval",
    });
    const execution = {
      ...graph.executions.find((entry) => entry.purpose === "trial")!,
      adapter: {
        use: "orchestrator",
        with: {
          child: {
            use: "secret-agent",
            auth: "default",
          },
        },
      },
      metadata: {
        ...graph.executions.find((entry) => entry.purpose === "trial")!.metadata,
        scoreAdapter: {
          use: "command",
          with: { command: "mkdir -p output && printf '%s\\n' '{\"protocol\":\"workbench.adapter-result.v1\",\"operation\":\"trial.score\",\"ok\":true,\"value\":{\"score\":0.75}}' > output/workbench-result.json" },
        },
      },
    };
    const job = createWorkbenchExecutionJob({
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      execution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });

    const commandManifest = await commandAdapterManifest();
    const completed = await executeAdapterInCurrentSandboxRuntime({
      job,
      spec,
      adapterManifests: [{
        id: "orchestrator",
        protocol: "workbench.adapter.v2",
        setup: [],
        operations: { "subject.run": { command: "workbench-adapter-orchestrator" } },
        slots: { child: { path: "/child", operation: "subject.run" as const } },
      }, {
        id: "secret-agent",
        protocol: "workbench.adapter.v2",
        setup: [],
        operations: { "subject.run": { command: "workbench-adapter-secret-agent" } },
        auth: { methods: { "api-key": { env: [{ name: "SECRET_AGENT_KEY" }] } } },
      }, commandManifest],
      adapterAuthProfiles: [{
        adapterId: "secret-agent",
        profile: "default",
        method: "api-key",
        status: "connected",
        version: 2,
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
      taskSourceFiles: [],
      taskBundles: [taskBundle("case-001", "Use nested adapter auth.")],
    }, execution, "2026-04-27T00:00:00.000Z", createWorkbenchExecutionCapability(execution, {
      now: "2026-04-27T00:00:00.000Z",
    }));

    expect(completed.status).toBe("succeeded");
    expect((completed.output as { fileChanges?: string[] }).fileChanges)
      .toContain("runner-output.txt");
  });

  test("agent improve adapter outputs only subject files covered by optimizer edits", async () => {
    const binRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-codex-improve-"));
    const adapterPath = path.join(binRoot, "codex-improve.mjs");
    await fs.writeFile(adapterPath, `import fs from "node:fs";
import path from "node:path";
const request = JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST, "utf8"));
if (request.invocation.use !== "codex" || request.operation !== "subject.improve") process.exit(11);
const output = process.env.WORKBENCH_OUTPUT;
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "workbench-result.json"), JSON.stringify({
  protocol: "workbench.adapter-result.v1",
  operation: "subject.improve",
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
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      workflow: "improve",
    });
    const execution = graph.executions.find((entry) => entry.purpose === "improve")!;
    const job = createWorkbenchExecutionJob({
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      execution,
      dependsOn: [],
      now: "2026-04-27T00:00:00.000Z",
    });

    const completed = await executeAdapterInCurrentSandboxRuntime({
      job,
      spec,
      adapterManifests: [{
        id: "codex",
        protocol: "workbench.adapter.v2",
        setup: [],
        operations: { "subject.improve": { command: `node ${shellWord(adapterPath)}` } },
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
      taskSourceFiles: [],
      taskBundles: [],
    }, execution, "2026-04-27T00:00:00.000Z", createWorkbenchExecutionCapability(execution, {
      now: "2026-04-27T00:00:00.000Z",
    }));

    const output = completed.output as {
      subjectPatch?: { fileChanges?: string[] };
      files?: Array<{ path: string }>;
      fileChanges?: string[];
    };
    expect(completed.status).toBe("succeeded");
    expect(output.subjectPatch?.fileChanges).toEqual(["prompt.md"]);
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

  test("sandbox allocations preserve allowlist egress policy", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpec());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      workflow: "eval",
    });
    const execution = {
      ...graph.executions.find((entry) => entry.purpose === "trial")!,
      policy: {
        ...graph.executions.find((entry) => entry.purpose === "trial")!.policy,
        network: {
          egress: "allowlist" as const,
          allow: ["api.openai.com"],
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
      egress: "allowlist",
      allow: ["api.openai.com"],
    });
    expect(collectSandboxAllocationScopeIssues(allocation, execution, { now: "2026-04-27T00:00:01.000Z" })).toEqual([]);
  });

  test("environment network defaults to open egress for all adapter phases", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpecWithoutEnvironmentNetwork());
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      workflow: "improve",
    });

    expect(graph.executions.map((execution) => execution.policy.network)).toEqual([
      { egress: "open" },
      { egress: "open" },
    ]);
  });

  test("explicit environment allowlist is preserved on execution policies", () => {
    const spec = resolveWorkbenchResolvedSourceYaml(genericSpecWithoutEnvironmentNetwork().replace(
      /environment:\n    dockerfile: environment\/Dockerfile/gu,
      [
        "environment:",
        "    dockerfile: environment/Dockerfile",
        "    network:",
        "      egress: allowlist",
        "      allow:",
        "        - api.example.com",
        "        - proxy.example.com:8443",
      ].join("\n"),
    ));
    const graph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      workflow: "eval",
    });

    expect(graph.executions.map((execution) => execution.policy.network)).toEqual([
      {
        egress: "allowlist",
        allow: ["api.example.com", "proxy.example.com:8443"],
      },
    ]);
  });

  test("rejects malformed authored allowlist policies", () => {
    const missingAllow = validateWorkbenchResolvedSourceYaml(genericSpecWithoutEnvironmentNetwork().replace(
      "environment:\n    dockerfile: environment/Dockerfile",
      "environment:\n    dockerfile: environment/Dockerfile\n    network:\n      egress: allowlist",
    ));
    const misplacedAllow = validateWorkbenchResolvedSourceYaml(genericSpecWithoutEnvironmentNetwork().replace(
      "environment:\n    dockerfile: environment/Dockerfile",
      "environment:\n    dockerfile: environment/Dockerfile\n    network:\n      egress: open\n      allow:\n        - api.example.com",
    ));

    expect(missingAllow.ok).toBe(false);
    expect(missingAllow.errors).toContain("benchmark.yaml.environment.network.allow must contain at least one host when benchmark.yaml.environment.network.egress is allowlist.");
    expect(misplacedAllow.ok).toBe(false);
    expect(misplacedAllow.errors).toContain("benchmark.yaml.environment.network.allow is only supported when benchmark.yaml.environment.network.egress is allowlist.");
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
      subjectId: "subject_123",
      trialIndex: 0,
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
          subjectId: "subject_123",
          execution,
          dependsOn: [],
          now: "2026-04-27T00:00:00.000Z",
        }),
        spec,
        baseFiles: [],
        taskSourceFiles: [],
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
          subjectId: "subject_123",
          execution,
          dependsOn: [],
          now: "2026-04-27T00:00:00.000Z",
        }),
        spec,
        baseFiles: [],
        taskSourceFiles: [],
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
          taskSourceFiles: SurfaceSnapshotFile[];
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
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      workflow: "eval",
    });
    const execution = graph.executions[0]!;
    const capability = createWorkbenchExecutionCapability(execution, {
      now: new Date().toISOString(),
    });
    const subjectFile: SurfaceSnapshotFile = {
      path: "prompt.md",
      kind: "text",
      encoding: "utf8",
      content: "subject\n",
      executable: false,
    };
    const validated = await validateSandboxAdapterRequest({
      jobInput: {
        job: createWorkbenchExecutionJob({
          projectId: "project_123",
          runId: "run_123",
          subjectId: "subject_123",
          execution,
          dependsOn: [],
          now: "2026-04-27T00:00:00.000Z",
        }),
        spec,
      },
      execution,
      capability,
      inputBundle: inputBundleForExecution(execution, {
        subject: [subjectFile],
      }),
    });

    expect(validated.jobInput.baseFiles).toEqual([subjectFile]);
    expect(validated.jobInput.taskSourceFiles).toEqual([]);
    expect(validated.jobInput.traceFiles).toEqual([]);
    expect(validated.jobInput.job.input?.archive).toBeUndefined();

    const proposeGraph = compileTestExecutionGraph({
      ownerUserId: "user_123",
      projectId: "project_123",
      runId: "run_123",
      subjectId: "subject_123",
      trialIndex: 0,
      spec,
      workflow: "improve",
    });
    const proposeExecution = proposeGraph.executions.find((entry) => entry.purpose === "improve")!;
    const traceFile: SurfaceSnapshotFile = {
      path: "manifest.json",
      kind: "text",
      encoding: "utf8",
      content: "{\"jobs\":[]}\n",
      executable: false,
    };
    const proposeCapability = createWorkbenchExecutionCapability(proposeExecution, {
      now: new Date().toISOString(),
    });
    const validatedPropose = await validateSandboxAdapterRequest({
      jobInput: {
        job: createWorkbenchExecutionJob({
          projectId: "project_123",
          runId: "run_123",
          subjectId: "subject_123",
          execution: proposeExecution,
          dependsOn: [],
          now: "2026-04-27T00:00:00.000Z",
        }),
        spec,
      },
      execution: proposeExecution,
      capability: proposeCapability,
      inputBundle: inputBundleForExecution(proposeExecution, {
        subject: [subjectFile],
        traces: [traceFile],
      }),
    });
    expect(validatedPropose.jobInput.traceFiles).toEqual([traceFile]);

    await expect(validateSandboxAdapterRequest({
      jobInput: {
        job: createWorkbenchExecutionJob({
          projectId: "project_123",
          runId: "run_123",
          subjectId: "subject_123",
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

  test("subject patch application preserves immutable files and updates optimizer edit paths", () => {
    const files = applyWorkbenchSubjectPatch({
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

  test("subject patch application rejects changes outside optimizer edits", () => {
    expect(() => applyWorkbenchSubjectPatch({
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
    })).toThrow(/outside optimizer edits: package\.json/u);

    expect(() => applyWorkbenchSubjectPatch({
      edits: ["SKILL.md"],
      baseFiles: [{
        path: "SKILL.md",
        kind: "text",
        encoding: "utf8",
        content: "base\n",
        executable: false,
      }],
      patch: {
        fileChanges: ["subjects/my-skill/files/SKILL.md"],
        files: [{
          path: "subjects/my-skill/files/SKILL.md",
          kind: "text",
          encoding: "utf8",
          content: "bad\n",
          executable: false,
        }],
      },
    })).toThrow(/outside optimizer edits: subjects\/my-skill\/files\/SKILL\.md/u);
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
    input: path.join(root, "input"),
    output: path.join(root, "output"),
    subject: path.join(root, "input", "subject"),
    task: path.join(root, "input", "task"),
    traces: path.join(root, "input", "traces"),
  };
}

function inputBundleForExecution(
  execution: Parameters<typeof createWorkbenchExecutionCapability>[0],
  data: {
    subject?: SurfaceSnapshotFile[];
    cases?: SurfaceSnapshotFile[];
    traces?: SurfaceSnapshotFile[];
  } = {},
) {
  return {
    inputs: execution.inputs.map((input) => {
      const key = input.name === "task"
        ? "cases"
        : input.name as "subject" | "traces";
      return {
        input,
        mountPath: input.mountPath,
        kind: "files",
        files: data[key] ?? [],
      };
    }),
  };
}

function genericSpec(): string {
  return [
    "version: 2",
    "benchmark:",
    "  version: 2",
    "  name: generic-file-output-eval",
    "  description: Exercise generic file-output execution with command running and rubric scoring.",
    "  tasks:",
    "    path: tasks",
    "  environment:",
    "    dockerfile: environment/Dockerfile",
    "    resources:",
    "      cpu: 2",
    "      memoryGb: 4",
    "      timeoutMinutes: 20",
    "    network:",
    "      egress: none",
    "  score:",
    "    use: rubric",
    "    with:",
    "      instructions: Score only from runner output.",
    "      judge:",
    "        use: codex",
    "        with:",
    "          model: gpt-5.4-mini",
    "      criteria:",
    "        - id: correctness",
    "          description: Output satisfies the task requirements.",
    "          weight: 1",
    "subject:",
    "  version: 2",
    "  name: generic-file-output-eval",
    "  description: Subject runner for the generic file-output benchmark.",
    "  files:",
    "    path: subjects/generic-file-output-eval/files",
    "  run:",
    "    use: command",
    "    with:",
    "      command: python scripts/evaluate.py --run",
    "optimizer:",
    "  version: 2",
    "  name: generic-file-output-optimizer",
    "  edits:",
    "    - prompt.md",
    "    - scripts/evaluate.py",
    "  improve:",
    "    use: codex",
    "    with:",
    "      model: gpt-5.4-mini",
  ].join("\n");
}

function genericSpecWithoutEnvironmentNetwork(): string {
  return genericSpec().replaceAll(
    "\n    network:\n      egress: none",
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
const result = spawnSync("sh", ["-lc", command], {
  cwd: request.paths.workspace,
  env: process.env,
  stdio: "inherit",
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
const resultPath = process.env.WORKBENCH_RESULT || request.paths.result || \`\${request.paths.output}/workbench-result.json\`;
if (!fs.existsSync(resultPath)) {
  if (request.operation === "subject.improve") {
    const files = (request.context?.optimizer?.edits || [])
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
    protocol: "workbench.adapter.v2" as const,
    setup: [],
    operations: {
      "subject.run": { command: `node ${shellWord(file)}` },
      "trial.score": { command: `node ${shellWord(file)}` },
      "subject.improve": { command: `node ${shellWord(file)}` },
    },
  };
}

function shellWord(value: string): string {
  return `'${value.replace(/'/gu, "'\"'\"'")}'`;
}
