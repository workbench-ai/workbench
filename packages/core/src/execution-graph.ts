import type {
  Json,
  WorkbenchExecutionOutputContract,
  WorkbenchExecutionPolicy,
  WorkbenchExecutionSpec,
  WorkbenchExecutionPurpose,
} from "@workbench-ai/workbench-contract";

import {
  resolveTaskExecutionConfig,
  runtimeNetwork,
  runtimeResources,
  runtimeSandboxRef,
  type GenericRunSpec,
  type GenericTaskSpec,
  type WorkbenchRuntimeSpec,
} from "./generic-spec.ts";

export interface CompileExecutionGraphInput {
  ownerUserId: string;
  projectId: string;
  runId: string;
  candidateId: string;
  trialIndex: number;
  sampleIndex?: number;
  caseId?: string;
  task?: GenericTaskSpec;
  spec: GenericRunSpec;
  workflow?: "eval" | "improve";
  candidateRef?: string;
  taskRef?: string;
  environmentRef?: string;
}

export interface WorkbenchExecutionGraph {
  nodes: WorkbenchExecutionGraphNode[];
  executions: WorkbenchExecutionSpec[];
}

export interface WorkbenchExecutionGraphNode {
  execution: WorkbenchExecutionSpec;
  dependsOn: string[];
}

export function compileWorkbenchExecutionGraph(input: CompileExecutionGraphInput): WorkbenchExecutionGraph {
  const workflow = input.workflow ?? "improve";
  const sampleIndex = input.sampleIndex ?? 0;
  const caseId = input.caseId ?? "current";
  const candidateRef = input.candidateRef ?? `workbench://benchmarks/${input.projectId}/candidates/${input.candidateId}`;
  const taskRef = input.taskRef ?? `workbench://benchmarks/${input.projectId}/tasks/${caseId}`;
  if (!input.task) {
    throw new Error("Execution graph compilation requires a parsed task.yaml.");
  }
  const task = input.task;
  const executionConfig = resolveTaskExecutionConfig({
    spec: input.spec,
    task,
  });

  const nodes: WorkbenchExecutionGraphNode[] = [];
  const executions: WorkbenchExecutionSpec[] = [];
  const optimizerExecutionId = executionId(input, "improve", "current", 0);
  const optimizerOutputRef = `execution://${optimizerExecutionId}/candidate_patch`;
  const runnerAdapter = executionConfig.run;
  const graderAdapter = executionConfig.grade;
  if (workflow === "improve") {
    if (!input.spec.optimizer || !input.spec.improve) {
      throw new Error("Optimizer YAML is required for improve execution graphs.");
    }
    pushExecution(nodes, executions, createExecution({
      input,
      purpose: "improve",
      adapter: input.spec.improve,
      inputs: [
        inputRef("candidate", candidateRef, "/workspace/input/candidate", false),
        inputRef("traces", `workbench://benchmarks/${input.projectId}/runs/${input.runId}/traces`, "/workspace/input/traces", false),
      ],
      outputs: [outputContract("candidate_patch", "workbench.candidate_patch.v1")],
      metadata: {
        trialIndex: input.trialIndex,
        sampleIndex: 0,
        caseId: "current",
        benchmark: input.spec.benchmark.name,
        edits: input.spec.optimizer.edits,
      },
      runtime: input.spec.environment,
      idOverride: optimizerExecutionId,
    }), []);
  }

  const runCandidateRef = workflow === "improve" ? optimizerOutputRef : candidateRef;
  const runnerExecutionId = executionId(input, "run-task", caseId, sampleIndex);
  const runnerOutputRef = `execution://${runnerExecutionId}/runner-output`;
  pushExecution(nodes, executions, createExecution({
    input,
    purpose: "run-task",
    adapter: runnerAdapter,
    inputs: [
      inputRef("candidate", runCandidateRef, "/workspace/input/candidate", false),
      inputRef("task", taskRef, "/workspace/input/task", false),
    ],
    outputs: [],
    metadata: {
      trialIndex: input.trialIndex,
      sampleIndex,
      caseId,
      task: executionConfig.task,
    },
    runtime: executionConfig.environment,
    idOverride: runnerExecutionId,
  }), workflow === "improve" ? [optimizerExecutionId] : []);

  const gradeInputs = [
    inputRef("task", taskRef, "/workspace/input/task", false),
    inputRef("runner-output", runnerOutputRef, "/workspace/input/runner-output", false),
  ];
  const gradeOutputs = [outputContract("scorecard", "workbench.scorecard.v1")];
  const gradeBaseMetadata = {
    trialIndex: input.trialIndex,
    sampleIndex,
    caseId,
    task: executionConfig.task,
  };
  pushExecution(nodes, executions, createExecution({
    input,
    purpose: "grade-task",
    adapter: graderAdapter,
    inputs: gradeInputs,
    outputs: gradeOutputs,
    metadata: gradeBaseMetadata,
    runtime: executionConfig.environment,
  }), [runnerExecutionId]);

  return { nodes, executions };
}

function pushExecution(
  nodes: WorkbenchExecutionGraphNode[],
  executions: WorkbenchExecutionSpec[],
  execution: WorkbenchExecutionSpec,
  dependsOn: string[],
): void {
  nodes.push({
    execution,
    dependsOn,
  });
  executions.push(execution);
}

function createExecution(args: {
  input: CompileExecutionGraphInput;
  purpose: WorkbenchExecutionPurpose;
  adapter: WorkbenchExecutionSpec["adapter"];
  inputs: WorkbenchExecutionSpec["inputs"];
  outputs: WorkbenchExecutionOutputContract[];
  metadata: Record<string, Json>;
  runtime: WorkbenchRuntimeSpec;
  idOverride?: string;
}): WorkbenchExecutionSpec {
  return {
    id: args.idOverride ?? executionId(
      args.input,
      args.purpose,
      args.input.caseId ?? "current",
      args.input.sampleIndex ?? 0,
    ),
    projectId: args.input.projectId,
    runId: args.input.runId,
    candidateId: args.input.candidateId,
    purpose: args.purpose,
    adapter: args.adapter,
    sandbox: args.input.environmentRef
      ? {
          kind: "oci",
          ref: args.input.environmentRef,
        }
      : {
          kind: "oci",
          ref: runtimeSandboxRef(args.runtime),
        },
    inputs: args.inputs,
    outputs: args.outputs,
    policy: executionPolicy(args.input.ownerUserId, args.runtime),
    metadata: args.metadata,
  };
}

function executionPolicy(
  tenantId: string,
  runtime: WorkbenchRuntimeSpec,
): WorkbenchExecutionPolicy {
  return {
    tenantId,
    resources: runtimeResources(runtime),
    network: runtimeNetwork(runtime),
  };
}

function executionId(
  input: CompileExecutionGraphInput,
  purpose: WorkbenchExecutionPurpose,
  caseId: string,
  sampleIndex: number,
  suffix?: string,
): string {
  const caseKey = caseId.replace(/[^a-z0-9_]/giu, "_");
  const parts = [
    "exec",
    input.runId.replace(/[^a-z0-9_]/giu, "_"),
    `trial_${String(input.trialIndex).padStart(3, "0")}`,
    `case_${caseKey}`,
    `sample_${String(sampleIndex).padStart(3, "0")}`,
    purpose,
  ];
  if (suffix) {
    parts.push(suffix.replace(/[^a-z0-9_]/giu, "_"));
  }
  return parts.join("_");
}

function inputRef(
  name: string,
  ref: string,
  mountPath: string,
  writable: boolean,
): WorkbenchExecutionSpec["inputs"][number] {
  return { name, ref, mountPath, writable };
}

function outputContract(
  name: string,
  schema: WorkbenchExecutionOutputContract["schema"],
  required = true,
): WorkbenchExecutionOutputContract {
  return { name, schema, required };
}
