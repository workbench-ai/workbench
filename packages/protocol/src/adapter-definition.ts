import { promises as fs } from "node:fs";

import type {
  Json,
} from "@workbench-ai/workbench-contract";

import type {
  WorkbenchAdapterAuthManifest,
  WorkbenchAdapterInvocationLike,
  WorkbenchAdapterManifest,
  WorkbenchAdapterOperation,
  WorkbenchAdapterOperationManifest,
  WorkbenchAdapterSlotManifest,
} from "./adapter-manifest.ts";
import {
  adapterCommandName,
} from "./adapter-manifest.ts";
import {
  WORKBENCH_ADAPTER_RESULT_PROTOCOL,
  ensureWorkbenchAdapterOutputDir,
  readWorkbenchAdapterOperationRequest,
  workbenchAdapterOperationResultPath,
  writeWorkbenchAdapterOperationResult,
  type WorkbenchAdapterOperationRequest,
  type WorkbenchAdapterOperationResult,
  type WorkbenchAdapterOperationResultValue,
} from "./adapter-protocol.ts";

export interface WorkbenchAdapterDefinition<TContext = unknown> {
  id: string;
  setup?: string[];
  auth?: WorkbenchAdapterAuthManifest;
  tasks?: WorkbenchAdapterOperationDefinition<TContext>;
  run?: WorkbenchAdapterOperationDefinition<TContext>;
  score?: WorkbenchAdapterOperationDefinition<TContext>;
  improve?: WorkbenchAdapterOperationDefinition<TContext>;
  slots?: Record<string, WorkbenchAdapterSlotManifest>;
}

export interface WorkbenchAdapterOperationDefinition<TContext = unknown> {
  command?: string;
  handle?: WorkbenchAdapterOperationHandler<TContext>;
}

export interface WorkbenchAdapterHandlerContext<TContext = unknown> {
  request: WorkbenchAdapterOperationRequest;
  operation: WorkbenchAdapterOperation;
  invocation: WorkbenchAdapterOperationRequest["invocation"];
  with: Record<string, Json>;
  paths: WorkbenchAdapterOperationRequest["paths"];
  runtime: TContext;
  slot(name: string): WorkbenchAdapterInvocationLike | null;
  result<TValue extends WorkbenchAdapterOperationResultValue>(
    value: TValue,
    metadata?: Omit<WorkbenchAdapterOperationResult<TValue>, "protocol" | "operation" | "value">,
  ): WorkbenchAdapterOperationResult<TValue>;
}

export type WorkbenchAdapterOperationHandler<TContext = unknown> = (
  context: WorkbenchAdapterHandlerContext<TContext>,
) => WorkbenchAdapterHandlerReturn | Promise<WorkbenchAdapterHandlerReturn>;

export type WorkbenchAdapterHandlerReturn =
  | WorkbenchAdapterOperationResult
  | WorkbenchAdapterOperationResultValue
  | undefined
  | void;

export interface RunDefinedWorkbenchAdapterOptions<TContext = unknown> {
  requestPath?: string;
  outputRoot?: string;
  runtime?: TContext;
}

export function defineAdapter<TContext = unknown>(
  definition: WorkbenchAdapterDefinition<TContext>,
): WorkbenchAdapterDefinition<TContext> {
  return definition;
}

export function defineTaskSource<TContext = unknown>(
  definition: WorkbenchAdapterOperationDefinition<TContext> = {},
): WorkbenchAdapterOperationDefinition<TContext> {
  return definition;
}

export function defineRunner<TContext = unknown>(
  definition: WorkbenchAdapterOperationDefinition<TContext> = {},
): WorkbenchAdapterOperationDefinition<TContext> {
  return definition;
}

export function defineScorer<TContext = unknown>(
  definition: WorkbenchAdapterOperationDefinition<TContext> = {},
): WorkbenchAdapterOperationDefinition<TContext> {
  return definition;
}

export function defineOptimizer<TContext = unknown>(
  definition: WorkbenchAdapterOperationDefinition<TContext> = {},
): WorkbenchAdapterOperationDefinition<TContext> {
  return definition;
}

export function adapterSlot(
  path: string,
  operation: WorkbenchAdapterOperation,
): WorkbenchAdapterSlotManifest {
  return { path, operation };
}

export function workbenchAdapterManifestFromDefinition(
  definition: WorkbenchAdapterDefinition,
): WorkbenchAdapterManifest {
  const operations: WorkbenchAdapterManifest["operations"] = {};
  addOperation(operations, definition.id, "tasks.resolve", definition.tasks);
  addOperation(operations, definition.id, "subject.run", definition.run);
  addOperation(operations, definition.id, "trial.score", definition.score);
  addOperation(operations, definition.id, "subject.improve", definition.improve);
  if (Object.keys(operations).length === 0) {
    throw new Error(`Adapter ${definition.id} must define at least one operation.`);
  }
  return {
    id: definition.id,
    protocol: "workbench.adapter.v2",
    operations,
    setup: definition.setup ? [...definition.setup] : [],
    ...(definition.auth ? { auth: cloneJson(definition.auth) } : {}),
    ...(definition.slots ? { slots: cloneJson(definition.slots) } : {}),
  };
}

export async function runDefinedAdapter<TContext = unknown>(
  definition: WorkbenchAdapterDefinition<TContext>,
  options: RunDefinedWorkbenchAdapterOptions<TContext> = {},
): Promise<WorkbenchAdapterOperationResult | null> {
  let request = await readWorkbenchAdapterOperationRequest(options.requestPath);
  if (request.invocation.use !== definition.id) {
    throw new Error(`Adapter ${definition.id} cannot execute request for ${request.invocation.use}.`);
  }
  if (options.outputRoot && options.outputRoot !== request.paths.output) {
    request = {
      ...request,
      paths: {
        ...request.paths,
        output: options.outputRoot,
        result: workbenchAdapterOperationResultPath(options.outputRoot),
      },
    };
  }
  await ensureWorkbenchAdapterOutputDir(request);
  const operationDefinition = operationDefinitionForRequest(definition, request.operation);
  if (!operationDefinition) {
    throw new Error(`Adapter ${definition.id} does not implement ${request.operation}.`);
  }
  if (!operationDefinition.handle) {
    throw new Error(`Adapter ${definition.id} ${request.operation} does not define a handler.`);
  }
  const handlerResult = await operationDefinition.handle(adapterHandlerContext({
    definition,
    request,
    runtime: options.runtime as TContext,
  }));
  if (await fileExists(request.paths.result)) {
    return null;
  }
  const result = normalizeHandlerResult(request.operation, handlerResult);
  await writeWorkbenchAdapterOperationResult(request.paths.output, result);
  return result;
}

export function operationDefinitionForRequest<TContext = unknown>(
  definition: WorkbenchAdapterDefinition<TContext>,
  operation: WorkbenchAdapterOperation,
): WorkbenchAdapterOperationDefinition<TContext> | undefined {
  if (operation === "tasks.resolve") {
    return definition.tasks;
  }
  if (operation === "subject.run") {
    return definition.run;
  }
  if (operation === "trial.score") {
    return definition.score;
  }
  if (operation === "subject.improve") {
    return definition.improve;
  }
  return undefined;
}

export function adapterResult<TValue extends WorkbenchAdapterOperationResultValue>(
  operation: WorkbenchAdapterOperation,
  value: TValue,
  metadata: Omit<WorkbenchAdapterOperationResult<TValue>, "protocol" | "operation" | "value"> = {},
): WorkbenchAdapterOperationResult<TValue> {
  return {
    protocol: WORKBENCH_ADAPTER_RESULT_PROTOCOL,
    operation,
    ok: true,
    ...metadata,
    value,
  };
}

export function adapterSlotInvocation(
  request: WorkbenchAdapterOperationRequest,
  slots: Record<string, WorkbenchAdapterSlotManifest> | undefined,
  name: string,
): WorkbenchAdapterInvocationLike | null {
  const slot = slots?.[name];
  if (!slot) {
    return null;
  }
  const value = jsonPointerValue(adapterWithRecord(request), slot.path);
  return isInvocationLike(value) ? value : null;
}

function addOperation(
  operations: Partial<Record<WorkbenchAdapterOperation, WorkbenchAdapterOperationManifest>>,
  adapterId: string,
  operation: WorkbenchAdapterOperation,
  definition: WorkbenchAdapterOperationDefinition | undefined,
): void {
  if (!definition) {
    return;
  }
  operations[operation] = {
    command: definition.command ?? adapterCommandName(adapterId),
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function adapterHandlerContext<TContext>(args: {
  definition: WorkbenchAdapterDefinition<TContext>;
  request: WorkbenchAdapterOperationRequest;
  runtime: TContext;
}): WorkbenchAdapterHandlerContext<TContext> {
  return {
    request: args.request,
    operation: args.request.operation,
    invocation: args.request.invocation,
    with: adapterWithRecord(args.request),
    paths: args.request.paths,
    runtime: args.runtime,
    slot: (name) => adapterSlotInvocation(args.request, args.definition.slots, name),
    result: (value, metadata = {}) => adapterResult(args.request.operation, value, metadata),
  };
}

function normalizeHandlerResult(
  operation: WorkbenchAdapterOperation,
  result: WorkbenchAdapterHandlerReturn,
): WorkbenchAdapterOperationResult {
  if (isOperationResult(result)) {
    return result;
  }
  return adapterResult(operation, result === undefined ? null : result);
}

function isOperationResult(value: unknown): value is WorkbenchAdapterOperationResult {
  return !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { protocol?: unknown }).protocol === WORKBENCH_ADAPTER_RESULT_PROTOCOL &&
    typeof (value as { operation?: unknown }).operation === "string";
}

function adapterWithRecord(request: WorkbenchAdapterOperationRequest): Record<string, Json> {
  const value = request.invocation.with;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json>
    : {};
}

function jsonPointerValue(root: unknown, pointer: string): unknown {
  if (pointer === "") {
    return root;
  }
  let current = root;
  for (const rawPart of pointer.slice(1).split("/")) {
    const part = rawPart.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isInvocationLike(value: unknown): value is WorkbenchAdapterInvocationLike {
  return !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { use?: unknown }).use === "string" &&
    ((value as { use: string }).use.length > 0);
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then((stat) => stat.isFile(), () => false);
}
