import {
  workbenchOperationStepsForRunKind,
  type WorkbenchCaseRunKind,
  type WorkbenchOperationStep,
} from "@workbench-ai/workbench-contract";

export interface WorkbenchOperationGraphCase {
  id: string;
  path: string;
  gradableTargetIndexes: readonly number[];
}

export interface WorkbenchOperationGraphSampleSelection {
  caseId: string;
  sample: number;
}

export interface WorkbenchOperationGraphNode {
  id: string;
  role: "run" | "grade";
  targetIndex: number;
  caseId: string;
  sample: number;
  dependencies: readonly string[];
}

export interface WorkbenchOperationGraph {
  kind: WorkbenchCaseRunKind;
  steps: readonly WorkbenchOperationStep[];
  nodes: readonly WorkbenchOperationGraphNode[];
}

export function planWorkbenchOperationGraph(input: {
  kind: WorkbenchCaseRunKind;
  targetCount: number;
  cases: readonly WorkbenchOperationGraphCase[];
  samples: number;
  selectedSamples?: readonly WorkbenchOperationGraphSampleSelection[];
}): WorkbenchOperationGraph {
  const steps = workbenchOperationStepsForRunKind(input.kind);
  const sampleCount = Math.max(1, Math.floor(input.samples));
  const nodes: WorkbenchOperationGraphNode[] = [];
  for (let targetIndex = 0; targetIndex < input.targetCount; targetIndex += 1) {
    for (const runtimeCase of input.cases) {
      for (const sample of sampleIndexes(runtimeCase, sampleCount, input.selectedSamples)) {
        const cellId = `${targetIndex}:${runtimeCase.id}:${sample}`;
        const runId = `${cellId}:run`;
        if (steps.includes("run")) {
          nodes.push({ id: runId, role: "run", targetIndex, caseId: runtimeCase.id, sample, dependencies: [] });
        }
        if (steps.includes("grade") && runtimeCase.gradableTargetIndexes.includes(targetIndex)) {
          nodes.push({
            id: `${cellId}:grade`,
            role: "grade",
            targetIndex,
            caseId: runtimeCase.id,
            sample,
            dependencies: steps.includes("run") ? [runId] : [],
          });
        }
      }
    }
  }
  return { kind: input.kind, steps, nodes };
}

function sampleIndexes(
  runtimeCase: WorkbenchOperationGraphCase,
  samples: number,
  selected: readonly WorkbenchOperationGraphSampleSelection[] | undefined,
): number[] {
  const explicit = selected
    ?.filter((entry) => entry.caseId === runtimeCase.id || entry.caseId === runtimeCase.path)
    .map((entry) => entry.sample);
  for (const sample of explicit ?? []) {
    if (!Number.isInteger(sample) || sample < 0) {
      throw new Error(`Eval sample index must be a non-negative integer: ${sample}`);
    }
  }
  return explicit && explicit.length > 0
    ? [...new Set(explicit)].sort((left, right) => left - right)
    : Array.from({ length: samples }, (_, index) => index);
}
