#!/usr/bin/env node
const fs = require("node:fs");

const requestPath = process.argv[2] || "/workbench-execution/request.json";
const responsePath = process.argv[3] || "/workbench-execution/response.json";
const stagePath = responsePath.replace(/response\.json$/u, "stage.log");

function markStage(stage) {
  try {
    fs.appendFileSync(stagePath, `${new Date().toISOString()} ${stage}\n`);
  } catch {
    // Stage logging is diagnostic only; response writing below remains authoritative.
  }
}

async function main() {
  try {
    markStage("start");
    const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    markStage("request-read");
    const validated = await validateSandboxAdapterRequest(request);
    removeRequestFile(requestPath);
    markStage("request-removed");
    const runtimeImport = process.env.WORKBENCH_RUNTIME_IMPORT || "../src/index.ts";
    const {
      executeAdapterInCurrentSandboxRuntime,
    } = await import(runtimeImport);
    markStage("runtime-imported");
    const startedAt = typeof request.startedAt === "string" ? request.startedAt : new Date().toISOString();
    const completedJob = await executeAdapterInCurrentSandboxRuntime(
      {
        ...validated.jobInput,
        now: startedAt,
        workspaceRoot: workspaceRootFromEnvironment(),
        pullImages: false,
        runtimeRegistry: "",
      },
      validated.execution,
      startedAt,
      validated.capability,
    );
    markStage("adapter-completed");
    fs.writeFileSync(responsePath, `${JSON.stringify({ ok: true, job: completedJob }, null, 2)}\n`);
  } catch (error) {
    markStage("failed");
    fs.writeFileSync(responsePath, `${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

function workspaceRootFromEnvironment() {
  const value = typeof process.env.WORKBENCH_WORKSPACE_ROOT === "string"
    ? process.env.WORKBENCH_WORKSPACE_ROOT.trim()
    : "";
  return isSafeWorkspaceRoot(value) ? value : "/workspace";
}

function isSafeWorkspaceRoot(value) {
  return value.startsWith("/")
    && value !== "/"
    && !value.startsWith("/workbench-runtime")
    && !value.startsWith("/workbench-execution")
    && value !== "/tests"
    && value !== "/logs"
    && !/[\0\r\n:]/u.test(value);
}

async function validateSandboxAdapterRequest(request) {
  const jobInput = request?.jobInput;
  const jobExecution = jobInput?.job?.input?.execution;
  const execution = request?.execution ?? jobExecution;
  if (!jobInput || typeof jobInput !== "object" || !jobInput.job || typeof jobInput.job !== "object") {
    throw new Error("Sandbox adapter request must include jobInput.job.");
  }
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
    throw new Error("Sandbox adapter request must include execution.");
  }
  if (!jobExecution || typeof jobExecution !== "object" || Array.isArray(jobExecution)) {
    throw new Error("Sandbox adapter request must include jobInput.job.input.execution.");
  }
  const mismatch = collectExecutionMismatchIssues(jobExecution, execution);
  if (mismatch.length > 0) {
    throw new Error(`Sandbox adapter request execution mismatch:\n${mismatch.join("\n")}`);
  }
  if (!request.capability || typeof request.capability !== "object" || Array.isArray(request.capability)) {
    throw new Error("Sandbox adapter request must include capability.");
  }
  const runtimeImport = process.env.WORKBENCH_RUNTIME_IMPORT || "../src/index.ts";
  const {
    collectExecutionCapabilityScopeIssues,
  } = await import(runtimeImport);
  const issues = collectExecutionCapabilityScopeIssues(request.capability, execution, {
    now: new Date().toISOString(),
  });
  if (issues.length > 0) {
    throw new Error(`Sandbox adapter request capability failed validation:\n${issues.join("\n")}`);
  }
  const inputBundle = validateInputBundle(request.inputBundle, request.capability, execution);
  const runtimeInputs = runtimeInputsFromInputBundle(inputBundle);
  const jobInputWithExecution = {
    ...jobInput,
    ...runtimeInputs,
    job: {
      ...jobInput.job,
      input: {
        ...(jobInput.job.input && typeof jobInput.job.input === "object" && !Array.isArray(jobInput.job.input)
          ? jobInput.job.input
          : {}),
        execution,
      },
    },
  };
  return {
    jobInput: jobInputWithExecution,
    execution,
    capability: request.capability,
  };
}

function validateInputBundle(bundle, capability, execution) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw new Error("Sandbox adapter request must include inputBundle.");
  }
  if (!Array.isArray(bundle.inputs)) {
    throw new Error("Sandbox adapter inputBundle.inputs must be an array.");
  }
  const expected = new Map((capability.inputs || []).map((input) => [capabilityInputKey(input), input]));
  const seen = new Set();
  const inputs = [];
  for (const entry of bundle.inputs) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Sandbox adapter inputBundle inputs must be objects.");
    }
    const input = entry.input;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Sandbox adapter inputBundle input entry must include input.");
    }
    const key = capabilityInputKey(input);
    if (!expected.has(key)) {
      throw new Error(`Sandbox adapter input bundle entry ${input.name || "<unknown>"} is outside the execution capability.`);
    }
    if (seen.has(key)) {
      throw new Error(`Sandbox adapter input bundle entry ${input.name || "<unknown>"} is duplicated.`);
    }
    seen.add(key);
    if (entry.mountPath !== input.mountPath) {
      throw new Error(`Sandbox adapter input bundle entry ${input.name || "<unknown>"} mountPath does not match capability.`);
    }
    if (entry.kind === "files") {
      if (!Array.isArray(entry.files) || !entry.files.every(isSurfaceSnapshotFile)) {
        throw new Error(`Sandbox adapter input bundle entry ${input.name || "<unknown>"} must include files.`);
      }
      inputs.push({
        input,
        mountPath: entry.mountPath,
        kind: "files",
        files: entry.files.map((file) => ({ ...file })),
      });
    } else if (entry.kind === "json") {
      if (!isJson(entry.json)) {
        throw new Error(`Sandbox adapter input bundle entry ${input.name || "<unknown>"} must include JSON.`);
      }
      inputs.push({
        input,
        mountPath: entry.mountPath,
        kind: "json",
        json: entry.json,
      });
    } else {
      throw new Error(`Sandbox adapter input bundle entry ${input.name || "<unknown>"} has unsupported kind ${entry.kind || "<missing>"}.`);
    }
  }
  if (seen.size !== expected.size) {
    const missing = [...expected.values()]
      .filter((input) => !seen.has(capabilityInputKey(input)))
      .map((input) => input.name)
      .join(", ");
    throw new Error(`Sandbox adapter input bundle is missing declared capability inputs${missing ? `: ${missing}` : ""}.`);
  }
  const executionInputKeys = new Set((execution.inputs || []).map(capabilityInputKey));
  for (const input of expected.values()) {
    if (!executionInputKeys.has(capabilityInputKey(input))) {
      throw new Error(`Sandbox adapter capability input ${input.name || "<unknown>"} is not declared by the execution.`);
    }
  }
  return { inputs };
}

function runtimeInputsFromInputBundle(bundle) {
  const filesByName = new Map();
  for (const entry of bundle.inputs) {
    if (entry.kind === "files") {
      filesByName.set(entry.input.name, entry.files);
    }
  }
  return {
    baseFiles: filesByName.get("subject") || [],
    taskSourceFiles: filesByName.get("task") || [],
    runnerOutputFiles: filesByName.get("runner-output") || [],
    traceFiles: filesByName.get("traces") || [],
  };
}

function removeRequestFile(filePath) {
  fs.rmSync(filePath, { force: true });
}

function capabilityInputKey(input) {
  return stableJson({
    name: input?.name ?? null,
    ref: input?.ref ?? null,
    mountPath: input?.mountPath ?? null,
    writable: input?.writable ?? null,
  });
}

function isSurfaceSnapshotFile(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof value.path === "string"
    && (value.kind === "text" || value.kind === "binary")
    && (value.encoding === "utf8" || value.encoding === "base64")
    && typeof value.content === "string"
    && typeof value.executable === "boolean";
}

function isJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJson);
  }
  if (value && typeof value === "object") {
    return Object.values(value).every(isJson);
  }
  return false;
}

function collectExecutionMismatchIssues(jobExecution, execution) {
  const issues = [];
  for (const key of ["id", "projectId", "runId", "subjectId", "purpose"]) {
    if ((jobExecution[key] ?? null) !== (execution[key] ?? null)) {
      issues.push(`job execution ${key} does not match request execution ${key}.`);
    }
  }
  for (const key of ["adapter", "sandbox", "inputs", "outputs", "policy", "metadata"]) {
    if (stableJson(jobExecution[key] ?? null) !== stableJson(execution[key] ?? null)) {
      issues.push(`job execution ${key} does not match request execution ${key}.`);
    }
  }
  return issues;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

if (require.main === module) {
  void main();
}

module.exports = {
  validateSandboxAdapterRequest,
};
