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
  subjectId: string;
  trialIndex: number;
  sampleIndex?: number;
  caseId?: string;
  task?: GenericTaskSpec;
  spec: GenericRunSpec;
  workflow?: "eval" | "improve";
  subjectRef?: string;
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
  const subjectRef = input.subjectRef ?? `workbench://benchmarks/${input.projectId}/subjects/${input.subjectId}`;
  const taskRef = input.taskRef ?? `workbench://benchmarks/${input.projectId}/tasks/${caseId}`;
  if (!input.task) {
    throw new Error("Execution graph compilation requires a task bundle.");
  }
  const task = input.task;
  const executionConfig = resolveTaskExecutionConfig({
    spec: input.spec,
    task,
  });

  const nodes: WorkbenchExecutionGraphNode[] = [];
  const executions: WorkbenchExecutionSpec[] = [];
  const optimizerExecutionId = executionId(input, "improve", "current", 0);
  const optimizerOutputRef = `execution://${optimizerExecutionId}/subject_patch`;
  const runnerAdapter = executionConfig.run;
  const scorerAdapter = executionConfig.score;
  if (workflow === "improve") {
    if (!input.spec.optimizer || !input.spec.improve) {
      throw new Error("Optimizer YAML is required for improve execution graphs.");
    }
    pushExecution(nodes, executions, createExecution({
      input,
      purpose: "improve",
      adapter: input.spec.improve,
      inputs: [
        inputRef("subject", subjectRef, "/workspace/input/subject", false),
        inputRef("traces", `workbench://benchmarks/${input.projectId}/runs/${input.runId}/traces`, "/workspace/input/traces", false),
      ],
      outputs: [outputContract("subject_patch", "workbench.subject_patch.v1")],
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

  const runSubjectRef = workflow === "improve" ? optimizerOutputRef : subjectRef;
  const trialExecutionId = executionId(input, "trial", caseId, sampleIndex);
  pushExecution(nodes, executions, createExecution({
    input,
    purpose: "trial",
    adapter: runnerAdapter,
    inputs: [
      inputRef("subject", runSubjectRef, "/workspace/input/subject", false),
      inputRef("task", taskRef, "/workspace/input/task", false),
    ],
    outputs: [outputContract("scorecard", "workbench.scorecard.v1")],
    metadata: {
      trialIndex: input.trialIndex,
      sampleIndex,
      caseId,
      task: task as unknown as Json,
      scoreAdapter: scorerAdapter as unknown as Json,
      ...(executionConfig.environment.workdir ? { workdir: executionConfig.environment.workdir } : {}),
    },
    runtime: executionConfig.environment,
    idOverride: trialExecutionId,
  }), workflow === "improve" ? [optimizerExecutionId] : []);

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
    subjectId: args.input.subjectId,
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
