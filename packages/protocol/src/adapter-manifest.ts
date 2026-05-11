import YAML from "yaml";

export interface WorkbenchAdapterManifest {
  id: string;
  protocol: "workbench.adapter.v1";
  setup: string[];
  command: string;
  auth?: WorkbenchAdapterAuthManifest;
  refs?: string[];
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

export function adapterCommandName(adapterId: string): string {
  return `workbench-adapter-${adapterId}`;
}

export function cloneWorkbenchAdapterManifest(
  manifest: WorkbenchAdapterManifest,
): WorkbenchAdapterManifest {
  return {
    ...manifest,
    setup: [...manifest.setup],
    ...(manifest.auth ? { auth: cloneJson(manifest.auth) as WorkbenchAdapterAuthManifest } : {}),
    ...(manifest.refs ? { refs: [...manifest.refs] } : {}),
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
  rejectUnknownManifestKeys(record, label, ["id", "protocol", "setup", "command", "auth", "refs"]);
  const id = readAdapterId(record.id, `${label}.id`);
  if (record.protocol !== "workbench.adapter.v1") {
    throw new Error(`${label}.protocol must be workbench.adapter.v1.`);
  }
  const command = typeof record.command === "string" && record.command.trim()
    ? record.command.trim()
    : adapterCommandName(id);
  const setup = record.setup === undefined
    ? []
    : readStringArray(record.setup, `${label}.setup`);
  const refs = record.refs === undefined
    ? undefined
    : readAdapterRefs(record.refs, `${label}.refs`);
  const auth = readAuth(record.auth, `${label}.auth`);
  return {
    id,
    protocol: "workbench.adapter.v1",
    setup,
    command,
    ...(auth ? { auth } : {}),
    ...(refs ? { refs } : {}),
  };
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

export function withDefaultWorkbenchAdapterAuthProfiles<T extends {
  improve?: WorkbenchAdapterInvocationLike;
  run: WorkbenchAdapterInvocationLike;
  grade: WorkbenchAdapterInvocationLike;
}>(
  spec: T,
  manifests: readonly WorkbenchAdapterManifest[] | Map<string, WorkbenchAdapterManifest>,
): T {
  const manifestById = manifestMap(manifests);
  const clone = cloneJson(spec);
  if (clone.improve) {
    clone.improve = withDefaultWorkbenchAdapterAuth(clone.improve, manifestById);
  }
  clone.run = withDefaultWorkbenchAdapterAuth(clone.run, manifestById);
  clone.grade = withDefaultWorkbenchAdapterAuth(clone.grade, manifestById);
  return clone;
}

export function withDefaultWorkbenchAdapterAuth<T extends WorkbenchAdapterInvocationLike>(
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
  if (!manifest?.refs?.length) {
    return invocation;
  }
  const config = invocationConfig(invocation);
  for (const pointer of manifest.refs) {
    const value = readJsonPointer(config, pointer);
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
      const parent = readJsonPointerParent(config, pointer);
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
  if (!manifest?.refs?.length) {
    return [];
  }
  const config = invocationConfig(invocation);
  return manifest.refs.flatMap((pointer) => {
    const value = readJsonPointer(config, pointer);
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

function readJsonPointer(root: unknown, pointer: string): unknown {
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
  const parent = readJsonPointer(
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

function readAdapterRefs(value: unknown, label: string): string[] {
  const refs = readStringArray(value, label);
  for (const ref of refs) {
    if (ref !== "" && !ref.startsWith("/")) {
      throw new Error(`${label} entries must be JSON pointers.`);
    }
  }
  return refs;
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
