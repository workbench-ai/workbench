import YAML from "yaml";

export const WORKBENCH_ADAPTER_MANIFEST_PROTOCOL = "workbench.adapter-manifest.v1";

export interface WorkbenchAdapterManifest {
  id: string;
  protocol: typeof WORKBENCH_ADAPTER_MANIFEST_PROTOCOL;
  operations: Partial<Record<WorkbenchAdapterOperation, WorkbenchAdapterOperationManifest>>;
  install: string[];
  auth?: WorkbenchAdapterAuthManifest;
  slots?: Record<string, WorkbenchAdapterSlotManifest>;
}

export type WorkbenchPrimitiveAdapterOperation =
  | "engine.resolve"
  | "engine.run"
  | "skill.run"
  | "skill.improve";

export type WorkbenchAdapterOperation = WorkbenchPrimitiveAdapterOperation;
export type WorkbenchAdapterOperationExecutor = "sandbox" | "host";

export interface WorkbenchAdapterOperationManifest {
  command: string;
  executor?: WorkbenchAdapterOperationExecutor;
}

export interface WorkbenchAdapterSlotManifest {
  path: string;
  operation: WorkbenchAdapterOperation;
}

export interface WorkbenchAdapterAuthManifest {
  methods?: Record<string, WorkbenchAdapterAuthMethodManifest>;
  slots?: Record<string, {
    methods?: Record<string, WorkbenchAdapterAuthMethodManifest>;
  }>;
}

export interface WorkbenchAdapterAuthFileManifest {
  path: string;
  required?: boolean;
}

export interface WorkbenchAdapterAuthEnvManifest {
  name: string;
  required?: boolean;
}

export interface WorkbenchAdapterAuthMethodManifest {
  env?: WorkbenchAdapterAuthEnvManifest[];
  files?: WorkbenchAdapterAuthFileManifest[];
  command?: string;
}

export interface WorkbenchAdapterInvocationLike {
  use: string;
  auth?: unknown;
  with?: unknown;
}

export interface WorkbenchAdapterAuthRequirement {
  adapterId: string;
  slot?: string;
  profile: string;
}

export interface WorkbenchAdapterOperationRequirement {
  invocation: WorkbenchAdapterInvocationLike;
  operation: WorkbenchAdapterOperation;
}

export function adapterCommandName(adapterId: string): string {
  return `workbench-adapter-${adapterId}`;
}

function workbenchAdapterManifestSupportsOperation(
  manifest: WorkbenchAdapterManifest,
  operation: WorkbenchAdapterOperation,
): boolean {
  return manifest.operations[normalizeWorkbenchAdapterOperation(operation, "adapter operation")] !== undefined;
}

export function workbenchAdapterOperationCommand(
  manifest: WorkbenchAdapterManifest,
  operation: WorkbenchAdapterOperation,
): string {
  const normalizedOperation = normalizeWorkbenchAdapterOperation(operation, "adapter operation");
  const operationManifest = manifest.operations[normalizedOperation];
  if (!operationManifest) {
    throw new Error(`Adapter ${manifest.id} does not implement ${normalizedOperation}.`);
  }
  return operationManifest.command;
}

export function workbenchAdapterOperationExecutor(
  manifest: WorkbenchAdapterManifest,
  operation: WorkbenchAdapterOperation,
): WorkbenchAdapterOperationExecutor {
  const normalizedOperation = normalizeWorkbenchAdapterOperation(operation, "adapter operation");
  const operationManifest = manifest.operations[normalizedOperation];
  if (!operationManifest) {
    throw new Error(`Adapter ${manifest.id} does not implement ${normalizedOperation}.`);
  }
  return operationManifest.executor ?? "sandbox";
}

export function cloneWorkbenchAdapterManifest(
  manifest: WorkbenchAdapterManifest,
): WorkbenchAdapterManifest {
  return {
    ...manifest,
    operations: cloneJson(manifest.operations),
    install: [...manifest.install],
    ...(manifest.auth ? { auth: cloneJson(manifest.auth) as WorkbenchAdapterAuthManifest } : {}),
    ...(manifest.slots ? { slots: cloneJson(manifest.slots) as Record<string, WorkbenchAdapterSlotManifest> } : {}),
  };
}

export function parseWorkbenchAdapterManifest(
  source: string,
  label = "workbench.adapter.yaml",
): WorkbenchAdapterManifest {
  const parsed = YAML.parse(source);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a YAML object.`);
  }
  const record = parsed as Record<string, unknown>;
  rejectUnknownManifestKeys(record, label, ["id", "protocol", "operations", "install", "auth", "slots"]);
  const id = readAdapterId(record.id, `${label}.id`);
  if (record.protocol !== WORKBENCH_ADAPTER_MANIFEST_PROTOCOL) {
    throw new Error(`${label}.protocol must be ${WORKBENCH_ADAPTER_MANIFEST_PROTOCOL}.`);
  }
  const install = record.install === undefined
    ? []
    : readStringArray(record.install, `${label}.install`);
  const operations = readAdapterOperations(record.operations, `${label}.operations`, id);
  const slots = record.slots === undefined
    ? undefined
    : readAdapterSlots(record.slots, `${label}.slots`);
  const auth = readAuth(record.auth, `${label}.auth`);
  return {
    id,
    protocol: WORKBENCH_ADAPTER_MANIFEST_PROTOCOL,
    operations,
    install,
    ...(auth ? { auth } : {}),
    ...(slots ? { slots } : {}),
  };
}

function readAdapterOperations(
  value: unknown,
  label: string,
  adapterId: string,
): WorkbenchAdapterManifest["operations"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const operations: WorkbenchAdapterManifest["operations"] = {};
  for (const [operation, rawConfig] of Object.entries(value as Record<string, unknown>).sort()) {
    const normalizedOperation = readAdapterOperation(operation, `${label}.${operation}`);
    if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
      throw new Error(`${label}.${operation} must be an object.`);
    }
    const config = rawConfig as Record<string, unknown>;
    rejectUnknownManifestKeys(config, `${label}.${operation}`, ["command", "executor"]);
    if (operations[normalizedOperation]) {
      throw new Error(`${label} declares ${normalizedOperation} more than once.`);
    }
    operations[normalizedOperation] = {
      command: config.command === undefined
        ? adapterCommandName(adapterId)
        : readNonEmptyString(config.command, `${label}.${operation}.command`),
      executor: readOperationExecutor(config.executor, `${label}.${operation}.executor`),
    };
  }
  if (Object.keys(operations).length === 0) {
    throw new Error(`${label} must declare at least one operation.`);
  }
  return operations;
}

function readOperationExecutor(
  value: unknown,
  label: string,
): WorkbenchAdapterOperationExecutor {
  if (value === undefined) {
    return "sandbox";
  }
  if (value === "sandbox" || value === "host") {
    return value;
  }
  throw new Error(`${label} must be sandbox or host.`);
}

function readAdapterSlots(
  value: unknown,
  label: string,
): Record<string, WorkbenchAdapterSlotManifest> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const slots: Record<string, WorkbenchAdapterSlotManifest> = {};
  for (const [slot, rawConfig] of Object.entries(value as Record<string, unknown>).sort()) {
    if (!/^[a-z][a-z0-9-]*$/u.test(slot)) {
      throw new Error(`${label} keys must be lowercase adapter slot names.`);
    }
    if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
      throw new Error(`${label}.${slot} must be an object.`);
    }
    const config = rawConfig as Record<string, unknown>;
    rejectUnknownManifestKeys(config, `${label}.${slot}`, ["path", "operation"]);
    const slotPath = readJsonPointer(config.path, `${label}.${slot}.path`);
    slots[slot] = {
      path: slotPath,
      operation: readAdapterOperation(config.operation, `${label}.${slot}.operation`),
    };
  }
  if (Object.keys(slots).length === 0) {
    throw new Error(`${label} must include at least one slot.`);
  }
  return slots;
}

export function workbenchAdapterManifestRequiresAuth(
  manifest: WorkbenchAdapterManifest,
): boolean {
  return defaultWorkbenchAdapterAuthForManifest(manifest) !== undefined;
}

export function collectWorkbenchAdapterInvocations(
  roots: readonly WorkbenchAdapterInvocationLike[],
  manifests: readonly WorkbenchAdapterManifest[] | Map<string, WorkbenchAdapterManifest>,
): WorkbenchAdapterInvocationLike[] {
  const manifestById = manifestMap(manifests);
  const collected: WorkbenchAdapterInvocationLike[] = [];
  const queue = roots.map((root) => normalizeInvocationLike(root)).filter(isInvocationLike);
  while (queue.length > 0) {
    const invocation = queue.shift()!;
    collected.push(invocation);
    queue.push(...nestedWorkbenchAdapterInvocations(invocation, manifestById));
  }
  return collected;
}

function collectWorkbenchAdapterOperationRequirements(
  roots: readonly WorkbenchAdapterOperationRequirement[],
  manifests: readonly WorkbenchAdapterManifest[] | Map<string, WorkbenchAdapterManifest>,
): WorkbenchAdapterOperationRequirement[] {
  const manifestById = manifestMap(manifests);
  const collected: WorkbenchAdapterOperationRequirement[] = [];
  const queue = roots.flatMap((root) => {
    const invocation = normalizeInvocationLike(root.invocation);
    return invocation ? [{
      invocation,
      operation: normalizeWorkbenchAdapterOperation(root.operation, "adapter operation requirement"),
    }] : [];
  });
  while (queue.length > 0) {
    const requirement = queue.shift()!;
    collected.push(requirement);
    const manifest = manifestById.get(requirement.invocation.use);
    const slots = manifest?.slots ? Object.values(manifest.slots) : [];
    if (slots.length === 0) {
      continue;
    }
    const config = invocationConfig(requirement.invocation);
    for (const slot of slots) {
      const value = readJsonPointerValue(config, slot.path);
      if (Array.isArray(value)) {
        for (const entry of value) {
          const nested = normalizeInvocationLike(entry);
          if (nested) {
            queue.push({ invocation: nested, operation: slot.operation });
          }
        }
        continue;
      }
      const nested = normalizeInvocationLike(value);
      if (nested) {
        queue.push({ invocation: nested, operation: slot.operation });
      }
    }
  }
  return collected;
}

function collectWorkbenchAdapterOperationIssues(
  roots: readonly WorkbenchAdapterOperationRequirement[],
  manifests: readonly WorkbenchAdapterManifest[] | Map<string, WorkbenchAdapterManifest>,
): string[] {
  const manifestById = manifestMap(manifests);
  const issues = new Map<string, string>();
  for (const requirement of collectWorkbenchAdapterOperationRequirements(roots, manifestById)) {
    const manifest = manifestById.get(requirement.invocation.use);
    const key = `${requirement.invocation.use}:${requirement.operation}`;
    if (!manifest) {
      issues.set(key, `Adapter ${requirement.invocation.use} is referenced but is not installed.`);
      continue;
    }
    if (!workbenchAdapterManifestSupportsOperation(manifest, requirement.operation)) {
      issues.set(key, `Adapter ${requirement.invocation.use} does not implement ${requirement.operation}.`);
    }
  }
  return [...issues.values()];
}

export function assertWorkbenchAdapterOperationSupport(
  roots: readonly WorkbenchAdapterOperationRequirement[],
  manifests: readonly WorkbenchAdapterManifest[] | Map<string, WorkbenchAdapterManifest>,
): void {
  const issues = collectWorkbenchAdapterOperationIssues(roots, manifests);
  if (issues.length > 0) {
    throw new Error(issues.join("\n"));
  }
}

export function collectWorkbenchAdapterAuthRequirements(
  roots: readonly WorkbenchAdapterInvocationLike[],
  manifests: readonly WorkbenchAdapterManifest[] | Map<string, WorkbenchAdapterManifest>,
): WorkbenchAdapterAuthRequirement[] {
  const manifestById = manifestMap(manifests);
  const targets = new Map<string, WorkbenchAdapterAuthRequirement>();
  for (const invocation of collectWorkbenchAdapterInvocations(roots, manifestById)) {
    const manifest = manifestById.get(invocation.use);
    const requirements = adapterAuthRequirementsForInvocation(invocation, manifest);
    if (requirements.length === 0) {
      continue;
    }
    for (const target of requirements) {
      targets.set(adapterAuthRequirementKey(target), target);
    }
  }
  return [...targets.values()];
}

export function withDefaultWorkbenchAdapterAuthProfiles<T extends Record<string, unknown>>(
  spec: T,
  manifests: readonly WorkbenchAdapterManifest[] | Map<string, WorkbenchAdapterManifest>,
): T {
  const manifestById = manifestMap(manifests);
  const clone = cloneJson(spec) as Record<string, unknown>;
  applyInvocationDefault(clone, "engine", manifestById);
  applyInvocationDefault(clone, "run", manifestById);
  applyInvocationDefault(clone, "improve", manifestById);
  return clone as T;
}

function applyInvocationDefault(
  record: Record<string, unknown>,
  key: string,
  manifestById: Map<string, WorkbenchAdapterManifest>,
): void {
  const invocation = normalizeInvocationLike(record[key]);
  if (invocation) {
    record[key] = withDefaultWorkbenchAdapterAuth(invocation, manifestById);
  }
}

function withDefaultWorkbenchAdapterAuth<T extends WorkbenchAdapterInvocationLike>(
  invocation: T,
  manifests: readonly WorkbenchAdapterManifest[] | Map<string, WorkbenchAdapterManifest>,
): T {
  return applyDefaultWorkbenchAdapterAuth(
    cloneJson(invocation),
    manifestMap(manifests),
  ) as T;
}

function applyDefaultWorkbenchAdapterAuth<T extends WorkbenchAdapterInvocationLike>(
  invocation: T,
  manifestById: Map<string, WorkbenchAdapterManifest>,
): T {
  const manifest = manifestById.get(invocation.use);
  if (manifest && invocation.auth === undefined) {
    const defaultAuth = defaultWorkbenchAdapterAuthForManifest(manifest);
    if (defaultAuth !== undefined) {
      (invocation as WorkbenchAdapterInvocationLike).auth = defaultAuth;
    }
  }
  const slots = manifest?.slots ? Object.values(manifest.slots) : [];
  if (slots.length === 0) {
    return invocation;
  }
  const config = invocationConfig(invocation);
  for (const slot of slots) {
    const value = readJsonPointerValue(config, slot.path);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const nested = normalizeInvocationLike(value[index]);
        if (nested) {
          value[index] = applyDefaultWorkbenchAdapterAuth(nested, manifestById);
        }
      }
      continue;
    }
    const nested = normalizeInvocationLike(value);
    if (nested) {
      const parent = readJsonPointerParent(config, slot.path);
      if (parent) {
        const withDefaults = applyDefaultWorkbenchAdapterAuth(nested, manifestById);
        if (Array.isArray(parent.container) && typeof parent.key === "number") {
          parent.container[parent.key] = withDefaults;
        } else if (!Array.isArray(parent.container) && typeof parent.key === "string") {
          parent.container[parent.key] = withDefaults;
        }
      }
    }
  }
  return invocation;
}

function nestedWorkbenchAdapterInvocations(
  invocation: WorkbenchAdapterInvocationLike,
  manifestById: Map<string, WorkbenchAdapterManifest>,
): WorkbenchAdapterInvocationLike[] {
  const manifest = manifestById.get(invocation.use);
  const slots = manifest?.slots ? Object.values(manifest.slots) : [];
  if (slots.length === 0) {
    return [];
  }
  const config = invocationConfig(invocation);
  return slots.flatMap((slot) => {
    const value = readJsonPointerValue(config, slot.path);
    if (Array.isArray(value)) {
      return value.map((entry) => normalizeInvocationLike(entry)).filter(isInvocationLike);
    }
    const nested = normalizeInvocationLike(value);
    return nested ? [nested] : [];
  });
}

function manifestMap(
  manifests: readonly WorkbenchAdapterManifest[] | Map<string, WorkbenchAdapterManifest>,
): Map<string, WorkbenchAdapterManifest> {
  return manifests instanceof Map
    ? manifests
    : new Map(manifests.map((manifest) => [manifest.id, manifest]));
}

function invocationConfig(invocation: WorkbenchAdapterInvocationLike): unknown {
  return invocation.with;
}

function defaultWorkbenchAdapterAuthForManifest(
  manifest: WorkbenchAdapterManifest,
): string | Record<string, string> | undefined {
  const auth = manifest.auth;
  if (!auth) {
    return undefined;
  }
  if (auth.methods && Object.keys(auth.methods).length > 0) {
    return "default";
  }
  const slotNames = adapterAuthSlotNames(auth);
  if (slotNames.length === 0) {
    return undefined;
  }
  return Object.fromEntries(slotNames.map((slot) => [slot, "default"]));
}

function adapterAuthRequirementsForInvocation(
  invocation: WorkbenchAdapterInvocationLike,
  manifest: WorkbenchAdapterManifest | undefined,
): WorkbenchAdapterAuthRequirement[] {
  const auth = invocation.auth;
  if (typeof auth === "string") {
    const slotTargets: WorkbenchAdapterAuthRequirement[] = adapterAuthSlotNames(manifest?.auth).map((slot) => ({
      adapterId: invocation.use,
      slot,
      profile: auth,
    }));
    return manifest?.auth?.methods && Object.keys(manifest.auth.methods).length > 0
      ? [{ adapterId: invocation.use, profile: auth }, ...slotTargets]
      : slotTargets.length > 0
        ? slotTargets
        : [{ adapterId: invocation.use, profile: auth }];
  }
  if (auth && typeof auth === "object" && !Array.isArray(auth)) {
    return Object.entries(auth)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([slot, profile]) => ({
        adapterId: invocation.use,
        slot,
        profile,
      }));
  }
  if (!manifest || !workbenchAdapterManifestRequiresAuth(manifest)) {
    return [];
  }
  const defaultAuth = defaultWorkbenchAdapterAuthForManifest(manifest);
  if (typeof defaultAuth === "string") {
    return [{ adapterId: invocation.use, profile: defaultAuth }];
  }
  if (defaultAuth && typeof defaultAuth === "object") {
    return Object.entries(defaultAuth).map(([slot, profile]) => ({
      adapterId: invocation.use,
      slot,
      profile,
    }));
  }
  return [];
}

function adapterAuthSlotNames(
  auth: WorkbenchAdapterAuthManifest | undefined,
): string[] {
  return auth?.slots ? Object.keys(auth.slots).sort() : [];
}

function adapterAuthRequirementKey(target: WorkbenchAdapterAuthRequirement): string {
  return `${target.adapterId}/${target.slot ?? "_"}/${target.profile}`;
}

function normalizeInvocationLike(value: unknown): WorkbenchAdapterInvocationLike | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.use !== "string" || record.use.length === 0) {
    return null;
  }
  return record as unknown as WorkbenchAdapterInvocationLike;
}

function isInvocationLike(
  value: WorkbenchAdapterInvocationLike | null,
): value is WorkbenchAdapterInvocationLike {
  return value !== null;
}

function readJsonPointerValue(root: unknown, pointer: string): unknown {
  if (pointer === "") {
    return root;
  }
  if (!pointer.startsWith("/")) {
    return undefined;
  }
  let current = root;
  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = decodeJsonPointerSegment(rawSegment);
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function readJsonPointerParent(
  root: unknown,
  pointer: string,
): { container: Record<string, unknown> | unknown[]; key: string | number } | null {
  if (!pointer.startsWith("/") || pointer === "") {
    return null;
  }
  const rawSegments = pointer.slice(1).split("/");
  const last = decodeJsonPointerSegment(rawSegments.pop()!);
  const parent = readJsonPointerValue(
    root,
    rawSegments.length === 0 ? "" : `/${rawSegments.join("/")}`,
  );
  if (Array.isArray(parent)) {
    const index = Number(last);
    return Number.isInteger(index) && index >= 0 && index < parent.length
      ? { container: parent, key: index }
      : null;
  }
  if (parent && typeof parent === "object") {
    return { container: parent as Record<string, unknown>, key: last };
  }
  return null;
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/gu, "/").replace(/~0/gu, "~");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readAdapterId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]*$/u.test(value)) {
    throw new Error(`${label} must be a lowercase adapter id.`);
  }
  return value;
}

function rejectUnknownManifestKeys(
  record: Record<string, unknown>,
  label: string,
  allowed: readonly string[],
): void {
  const extras = Object.keys(record).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new Error(`${label} includes unsupported ${extras.length === 1 ? "field" : "fields"}: ${extras.join(", ")}.`);
  }
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.trim().length > 0)) {
    throw new Error(`${label} must be a list of non-empty strings.`);
  }
  return value.map((entry) => entry.trim());
}

function readAdapterOperation(value: unknown, label: string): WorkbenchAdapterOperation {
  return normalizeWorkbenchAdapterOperation(value, label);
}

export function normalizeWorkbenchAdapterOperation(
  value: unknown,
  label: string,
): WorkbenchAdapterOperation {
  if (
    value === "engine.resolve" ||
    value === "engine.run" ||
    value === "skill.run" ||
    value === "skill.improve"
  ) {
    return value;
  }
  throw new Error(`${label} must be engine.resolve, engine.run, skill.run, or skill.improve.`);
}

function readJsonPointer(value: unknown, label: string): string {
  const pointer = readNonEmptyString(value, label);
  if (pointer !== "" && !pointer.startsWith("/")) {
    throw new Error(`${label} must be a JSON pointer.`);
  }
  return pointer;
}

function readAuth(value: unknown, label: string): WorkbenchAdapterManifest["auth"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  rejectUnknownManifestKeys(record, label, ["methods", "slots"]);
  const methods = record.methods === undefined
    ? undefined
    : readAuthMethods(record.methods, `${label}.methods`);
  const slots = record.slots === undefined
    ? undefined
    : readAuthSlots(record.slots, `${label}.slots`);
  if (methods && slots) {
    throw new Error(`${label} must use either methods or slots, not both.`);
  }
  if (!methods && !slots) {
    throw new Error(`${label} must declare methods or slots.`);
  }
  return {
    ...(methods ? { methods } : {}),
    ...(slots ? { slots } : {}),
  };
}

function readAuthSlots(
  value: unknown,
  label: string,
): NonNullable<WorkbenchAdapterAuthManifest["slots"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const slots: NonNullable<WorkbenchAdapterAuthManifest["slots"]> = {};
  for (const [slot, config] of Object.entries(value as Record<string, unknown>).sort()) {
    if (!/^[a-z][a-z0-9-]*$/u.test(slot)) {
      throw new Error(`${label} keys must be lowercase auth slot names.`);
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(`${label}.${slot} must be an object.`);
    }
    const record = config as Record<string, unknown>;
    rejectUnknownManifestKeys(record, `${label}.${slot}`, ["methods"]);
    const methods = readAuthMethods(
      record.methods,
      `${label}.${slot}.methods`,
    );
    slots[slot] = { methods };
  }
  if (Object.keys(slots).length === 0) {
    throw new Error(`${label} must include at least one slot.`);
  }
  return slots;
}

function readAuthMethods(
  value: unknown,
  label: string,
): Record<string, WorkbenchAdapterAuthMethodManifest> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const methods: Record<string, WorkbenchAdapterAuthMethodManifest> = {};
  for (const [method, config] of Object.entries(value as Record<string, unknown>).sort()) {
    if (!/^[a-z][a-z0-9-]*$/u.test(method)) {
      throw new Error(`${label} keys must be lowercase auth method names.`);
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(`${label}.${method} must be an object.`);
    }
    methods[method] = readAuthMethod(config as Record<string, unknown>, `${label}.${method}`);
  }
  if (Object.keys(methods).length === 0) {
    throw new Error(`${label} must include at least one method.`);
  }
  return methods;
}

function readAuthMethod(
  record: Record<string, unknown>,
  label: string,
): WorkbenchAdapterAuthMethodManifest {
  rejectUnknownManifestKeys(record, label, ["env", "files", "command"]);
  const env = record.env === undefined
    ? undefined
    : readAuthEnv(record.env, `${label}.env`);
  const files = record.files === undefined
    ? undefined
    : readAuthFiles(record.files, `${label}.files`);
  const command = record.command === undefined
    ? undefined
    : readNonEmptyString(record.command, `${label}.command`);
  if (!env && !files && !command) {
    throw new Error(`${label} must declare env, files, or command.`);
  }
  return {
    ...(env ? { env } : {}),
    ...(files ? { files } : {}),
    ...(command ? { command } : {}),
  };
}

function readAuthFiles(
  value: unknown,
  label: string,
): WorkbenchAdapterAuthFileManifest[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty list.`);
  }
  return value.map((entry, index) => {
    if (typeof entry === "string") {
      return { path: readAuthFilePath(entry, `${label}[${index}]`) };
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label}[${index}] must be a file path or object.`);
    }
    const record = entry as Record<string, unknown>;
    rejectUnknownManifestKeys(record, `${label}[${index}]`, ["path", "required"]);
    return {
      path: readAuthFilePath(record.path, `${label}[${index}].path`),
      ...readRequiredFlag(record.required, `${label}[${index}].required`),
    };
  });
}

function readAuthEnv(
  value: unknown,
  label: string,
): WorkbenchAdapterAuthEnvManifest[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty list.`);
  }
  return value.map((entry, index) => {
    if (typeof entry === "string") {
      return { name: readAuthEnvName(entry, `${label}[${index}]`) };
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label}[${index}] must be an env name or object.`);
    }
    const record = entry as Record<string, unknown>;
    rejectUnknownManifestKeys(record, `${label}[${index}]`, ["name", "required"]);
    return {
      name: readAuthEnvName(record.name, `${label}[${index}].name`),
      ...readRequiredFlag(record.required, `${label}[${index}].required`),
    };
  });
}

function readRequiredFlag(value: unknown, label: string): { required?: false } {
  if (value === undefined || value === true) {
    return {};
  }
  if (value === false) {
    return { required: false };
  }
  throw new Error(`${label} must be a boolean.`);
}

function readAuthEnvName(value: unknown, label: string): string {
  const name = readNonEmptyString(value, label);
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(name)) {
    throw new Error(`${label} must be an environment variable name.`);
  }
  return name;
}

function readAuthFilePath(value: unknown, label: string): string {
  const filePath = readNonEmptyString(value, label).replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (!filePath || filePath.split("/").some((part) => part === "." || part === ".." || part === "")) {
    throw new Error(`${label} must be a safe relative file path.`);
  }
  return filePath;
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}
