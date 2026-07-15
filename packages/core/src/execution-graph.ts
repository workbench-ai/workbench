import type {
  Json,
  WorkbenchExecutionOutputContract,
  WorkbenchExecutionPolicy,
  WorkbenchExecutionSpec,
  WorkbenchExecutionPurpose,
} from "@workbench-ai/workbench-contract";

import {
  resolveEngineCaseExecutionConfig,
  runtimeNetwork,
  runtimeResources,
  runtimeSandboxRef,
  type GenericRunSpec,
  type GenericEngineCaseSpec,
  type WorkbenchRuntimeSpec,
} from "./generic-spec.ts";

export interface CompileExecutionGraphInput {
  ownerUserId: string;
  projectId: string;
  runId: string;
  versionId: string;
  attemptIndex: number;
  sampleIndex?: number;
  caseId?: string;
  engineCase?: GenericEngineCaseSpec;
  spec: GenericRunSpec;
  workflow?: "eval" | "improve";
  skillRef?: string;
  caseRef?: string;
  environmentRef?: string;
  metadata?: Record<string, Json>;
}

interface WorkbenchExecutionGraph {
  nodes: WorkbenchExecutionGraphNode[];
  executions: WorkbenchExecutionSpec[];
}

interface WorkbenchExecutionGraphNode {
  execution: WorkbenchExecutionSpec;
  dependsOn: string[];
}

export function compileWorkbenchExecutionGraph(input: CompileExecutionGraphInput): WorkbenchExecutionGraph {
  const workflow = input.workflow ?? "improve";
  const sampleIndex = input.sampleIndex ?? 0;
  const caseId = input.caseId ?? "current";
  const skillRef = input.skillRef ?? `workbench://skills/${input.projectId}/versions/${input.versionId}`;
  const caseRef = input.caseRef ?? `workbench://skills/${input.projectId}/cases/${caseId}`;
  if (!input.engineCase) {
    throw new Error("Execution graph compilation requires an engine case.");
  }
  const engineCase = input.engineCase;
  const executionConfig = resolveEngineCaseExecutionConfig({
    spec: input.spec,
    engineCase,
  });

  const nodes: WorkbenchExecutionGraphNode[] = [];
  const executions: WorkbenchExecutionSpec[] = [];
  const improveExecutionId = executionId(input, "improve", "current", 0);
  const runAdapter = executionConfig.run;
  if (workflow === "improve") {
    if (!input.spec.skill.improve || !input.spec.improve) {
      throw new Error("Skill improve configuration is required for improve execution graphs.");
    }
    pushExecution(nodes, executions, createExecution({
      input,
      purpose: "improve",
      adapter: input.spec.improve,
      inputs: [
        inputRef("skill", skillRef, "/workspace", true),
        inputRef("traces", `workbench://skills/${input.projectId}/runs/${input.runId}/traces`, "/workspace/input/traces", false),
      ],
      outputs: [outputContract("skill_patch", "workbench.skill_patch.v1")],
      metadata: {
        ...(input.metadata ?? {}),
        attemptIndex: input.attemptIndex,
        sampleIndex: 0,
        caseId: "current",
        eval: input.spec.eval.name,
        edits: input.spec.skill.improve.edits,
      },
      runtime: input.spec.environment,
      idOverride: improveExecutionId,
    }), []);
    return { nodes, executions };
  }

  const attemptExecutionId = executionId(input, "attempt", caseId, sampleIndex);
  pushExecution(nodes, executions, createExecution({
    input,
    purpose: "attempt",
    adapter: runAdapter,
    inputs: [
      inputRef("skills", skillRef, "/workspace/input/skills", false),
      inputRef("case", caseRef, "/workspace/input/case", false),
    ],
    outputs: [outputContract("result", "workbench.result.v1")],
    metadata: {
      ...(input.metadata ?? {}),
      attemptIndex: input.attemptIndex,
      sampleIndex,
      caseId,
      engineCase: engineCase as unknown as Json,
      ...(executionConfig.environment.workdir ? { workdir: executionConfig.environment.workdir } : {}),
    },
    runtime: executionConfig.environment,
    idOverride: attemptExecutionId,
  }), []);

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
    versionId: args.input.versionId,
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
    `attempt_${String(input.attemptIndex).padStart(3, "0")}`,
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
