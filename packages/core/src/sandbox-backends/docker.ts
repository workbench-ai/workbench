import {
  WORKBENCH_EXECUTION_NETWORK_EGRESS_VALUES,
  type RemoteWorkbenchJob,
  type Json,
  type WorkbenchExecutionSpec,
} from "@workbench-ai/workbench-contract";
import {
  createHash,
} from "node:crypto";
import {
  createWriteStream,
  existsSync,
} from "node:fs";
import path from "node:path";
import {
  fileURLToPath,
} from "node:url";

import {
  createSandboxAdapterRequest,
  executionResultFromCompletedSandboxJob,
} from "../sandbox-inputs.ts";
import {
  persistWorkbenchAdapterAuthUpdates,
} from "../adapter-auth-updates.ts";
import type {
  WorkbenchExecutionRuntimeInput,
} from "../execution-runtime-types.ts";
import {
  type SandboxBackendDescriptor,
  type SandboxCreateRequest,
  type SandboxExecutionFileStore,
  type SandboxHandle,
  type SandboxPlane,
} from "../sandbox-plane.ts";
import {
  abortSignalOrUndefined,
  asRuntimeRecord,
  importNodeModule,
  nodeBuiltin,
} from "../runtime-utils.ts";
import {
  createWorkbenchProgressStdoutParser,
  publishWorkbenchProgressStdoutEnvelope,
  type WorkbenchExecutionProgressTarget,
} from "../execution-events.ts";
import {
  resolveSandboxTemplateImage,
} from "./template-images.ts";
import {
  DOCKER_SANDBOX_BACKEND,
} from "./names.ts";

const BUILT_IN_ENVIRONMENT_IMAGES: Record<string, string> = {
  "workbench/workbench-node-22:envv_node_22": "products/workbench/environments/node-22/Dockerfile",
  "workbench/workbench-python-3.12:envv_python_3_12": "products/workbench/environments/python-3.12/Dockerfile",
  "workbench/workbench-libreoffice-python:envv_libreoffice_python": "products/workbench/environments/libreoffice-python/Dockerfile",
  "workbench/workbench-libreoffice-agent:envv_libreoffice_agent": "products/workbench/environments/libreoffice-agent/Dockerfile",
};

const DOCKER_RUNTIME_MOUNT = "/workbench-runtime";
const DOCKER_DEFAULT_WORKSPACE = "/workspace";
const mutableDockerTemplateImageBuilds = new Map<string, Promise<string>>();
let dockerAvailabilityCheck: Promise<void> | undefined;

type DockerRuntimePayload = {
  mounts: readonly DockerRuntimeMount[];
  runnerPath: string;
  runtimeImport: string;
  builtInDockerfileRoot: string;
};

type DockerRuntimeMount = {
  source: string;
  target: string;
};

interface DockerSandboxUser {
  uid: number;
  gid: number;
}

export function createDockerSandboxBackendDescriptor(
): SandboxBackendDescriptor {
  return {
    name: DOCKER_SANDBOX_BACKEND,
    version: "1",
    capabilities: {
      snapshots: true,
      interactiveExec: false,
      filesystemDiff: false,
      networkPolicy: WORKBENCH_EXECUTION_NETWORK_EGRESS_VALUES,
      fileCapabilities: true,
    },
  };
}

export function createDockerSandboxPlane(
  args: WorkbenchExecutionRuntimeInput,
  startedAt: string,
  fileStore: SandboxExecutionFileStore,
): SandboxPlane {
  return {
    backend: createDockerSandboxBackendDescriptor(),
    async prepareEnvironment(execution) {
      const [{ execFile }, { promisify }] = await Promise.all([
        importNodeModule<typeof import("node:child_process")>(nodeBuiltin("child_process")),
        importNodeModule<typeof import("node:util")>(nodeBuiltin("util")),
      ]);
      const execFileAsync = promisify(execFile);
      await assertDockerSandboxAvailable(execFileAsync);
      const templateImage = await prepareDockerTemplateImage(execution, args, execFileAsync);
      await ensureDockerExecutionImage(templateImage, execFileAsync);
      return {
        backend: DOCKER_SANDBOX_BACKEND,
        kind: execution.sandbox.kind,
        ref: execution.sandbox.ref,
        metadata: {
          templateImage,
        },
      };
    },
    async createSandbox(request) {
      const metadata = await prepareDockerSandboxWorkspace(args, request, startedAt);
      return {
        sandboxId: request.allocation.sandboxId,
        lifecycleId: request.allocation.lifecycleId,
        backend: request.allocation.backend,
        executionId: request.execution.id,
        template: request.allocation.template,
        metadata: {
          allocation: request.allocation as unknown as Json,
          ...metadata,
        },
      };
    },
    async exec(request, options) {
      const completedJob = await runDockerSandboxExecution(args, request.sandbox, request.execution, options.signal);
      return await executionResultFromCompletedSandboxJob({
        completedJob,
        execution: request.execution,
        startedAt,
        backend: DOCKER_SANDBOX_BACKEND,
        allocation: request.allocation,
        capability: request.capability,
        handle: request.sandbox,
        fileStore,
      });
    },
    async destroySandbox(sandbox) {
      await destroyDockerSandbox(sandbox);
    },
  };
}

async function prepareDockerTemplateImage(
  execution: WorkbenchExecutionSpec,
  args: WorkbenchExecutionRuntimeInput,
  execFileAsync: (file: string, args: string[], options?: Record<string, unknown>) => Promise<unknown>,
): Promise<string> {
  const ref = execution.sandbox.ref;
  if (execution.sandbox.kind !== "oci" || !ref.startsWith("dockerfile://")) {
    return resolveSandboxTemplateImage(execution, args);
  }
  const dockerfile = args.environmentDockerfile?.trim();
  if (!dockerfile) {
    throw new Error(`Execution ${execution.id} uses ${ref}, but the claimed job input omitted environmentDockerfile.`);
  }
  const [fs, os, path] = await Promise.all([
    importNodeModule<typeof import("node:fs/promises")>(nodeBuiltin("fs/promises")),
    importNodeModule<typeof import("node:os")>(nodeBuiltin("os")),
    importNodeModule<typeof import("node:path")>(nodeBuiltin("path")),
  ]);
  const sourceHash = args.environmentVersion?.sourceHash?.trim() || createHash("sha256").update(dockerfile).digest("hex");
  const image = `workbench/sandbox-${safeDockerImageSegment(args.environmentVersion?.id ?? "env")}:${sourceHash.slice(0, 16)}`;
  const pending = mutableDockerTemplateImageBuilds.get(image);
  if (pending) {
    return await pending;
  }
  const build = (async () => {
    const imageExists = await execFileAsync("docker", ["image", "inspect", image], { maxBuffer: 1024 * 1024 })
      .then(() => true, () => false);
    if (imageExists) {
      return image;
    }
    const contextRoot = path.join(args.workdir ?? os.tmpdir(), "workbench-docker-environments", sourceHash.slice(0, 32));
    const dockerfilePath = path.join(contextRoot, "Dockerfile");
    await fs.rm(contextRoot, { recursive: true, force: true }).catch(() => undefined);
    await fs.mkdir(contextRoot, { recursive: true });
    await fs.writeFile(dockerfilePath, `${dockerfile}\n`, { mode: 0o600 });
    await execFileAsync("docker", ["build", "-t", image, "-f", dockerfilePath, contextRoot], { maxBuffer: 20 * 1024 * 1024 });
    return image;
  })();
  mutableDockerTemplateImageBuilds.set(image, build);
  try {
    return await build;
  } finally {
    if (mutableDockerTemplateImageBuilds.get(image) === build) {
      mutableDockerTemplateImageBuilds.delete(image);
    }
  }
}

async function prepareDockerSandboxWorkspace(
  args: WorkbenchExecutionRuntimeInput,
  request: SandboxCreateRequest,
  startedAt: string,
): Promise<Record<string, Json>> {
  const [{ execFile }, fs, os, path, { promisify }] = await Promise.all([
    importNodeModule<typeof import("node:child_process")>(nodeBuiltin("child_process")),
    importNodeModule<typeof import("node:fs/promises")>(nodeBuiltin("fs/promises")),
    importNodeModule<typeof import("node:os")>(nodeBuiltin("os")),
    importNodeModule<typeof import("node:path")>(nodeBuiltin("path")),
    importNodeModule<typeof import("node:util")>(nodeBuiltin("util")),
  ]);
  const execFileAsync = promisify(execFile);
  await assertDockerSandboxAvailable(execFileAsync);
  const sandboxUser = dockerSandboxUser();
  const workdir = args.workdir ?? os.tmpdir();
  const sandboxRoot = path.join(workdir, "workbench-docker", request.allocation.sandboxId);
  const requestPath = path.join(sandboxRoot, "request.json");
  const responsePath = path.join(sandboxRoot, "response.json");
  const stdoutPath = path.join(sandboxRoot, "stdout.log");
  const stderrPath = path.join(sandboxRoot, "stderr.log");
  await fs.rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(sandboxRoot, { recursive: true });
  await alignDockerSandboxPath(fs, sandboxRoot, sandboxUser, 0o700, 0o777);
  await fs.writeFile(requestPath, `${JSON.stringify(createSandboxAdapterRequest(args, request, startedAt), null, 2)}\n`, { mode: 0o600 });
  await alignDockerSandboxPath(fs, requestPath, sandboxUser, 0o600, 0o644);

  const environmentMetadata = asRuntimeRecord(request.environment.metadata);
  const image = typeof environmentMetadata.templateImage === "string"
    ? environmentMetadata.templateImage
    : await prepareDockerTemplateImage(request.execution, args, execFileAsync);
  const network = dockerNetworkConfigForExecution(request.execution);
  const runtimePayload = await prepareDockerRuntimePayload(workdir, execFileAsync, fs, path);
  return {
    root: sandboxRoot,
    request: requestPath,
    response: responsePath,
    stdout: stdoutPath,
    stderr: stderrPath,
    templateImage: image,
    containerName: dockerContainerName(request.allocation.sandboxId),
    runtimeMounts: runtimePayload.mounts as unknown as Json,
    runnerPath: runtimePayload.runnerPath,
    runtimeImport: runtimePayload.runtimeImport,
    sandboxUid: sandboxUser.uid,
    sandboxGid: sandboxUser.gid,
    network: network as unknown as Json,
    ...(args.progress ? { progressTarget: args.progress as unknown as Json } : {}),
  };
}

async function assertDockerSandboxAvailable(
  execFileAsync: (file: string, args: string[], options?: Record<string, unknown>) => Promise<unknown>,
): Promise<void> {
  dockerAvailabilityCheck ??= execFileAsync("docker", ["info", "--format", "{{json .ServerVersion}}"], { maxBuffer: 1024 * 1024 })
    .then(() => undefined)
    .catch((error: unknown) => {
      dockerAvailabilityCheck = undefined;
      throw new Error(`Docker sandbox unavailable: Docker must be installed and running before Workbench can execute this eval. ${dockerUnavailableDetail(error)}`);
    });
  await dockerAvailabilityCheck;
}

function dockerUnavailableDetail(error: unknown): string {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof record.code === "string" ? record.code : "";
  if (code === "ENOENT") {
    return "The docker CLI was not found on PATH.";
  }
  const stderr = bufferLikeToString(record.stderr).trim();
  if (stderr) {
    return stderr.split(/\r?\n/u)[0] ?? stderr;
  }
  const stdout = bufferLikeToString(record.stdout).trim();
  if (stdout) {
    return stdout.split(/\r?\n/u)[0] ?? stdout;
  }
  return error instanceof Error ? error.message : String(error);
}

function bufferLikeToString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  return "";
}

async function runDockerSandboxExecution(
  args: WorkbenchExecutionRuntimeInput,
  sandbox: SandboxHandle,
  execution: WorkbenchExecutionSpec,
  signal?: AbortSignal,
): Promise<RemoteWorkbenchJob> {
  const metadata = asRuntimeRecord(sandbox.metadata);
  const root = readRequiredMetadataString(metadata, "root", DOCKER_SANDBOX_BACKEND);
  const responsePath = readRequiredMetadataString(metadata, "response", DOCKER_SANDBOX_BACKEND);
  const stdoutPath = readRequiredMetadataString(metadata, "stdout", DOCKER_SANDBOX_BACKEND);
  const stderrPath = readRequiredMetadataString(metadata, "stderr", DOCKER_SANDBOX_BACKEND);
  const image = readRequiredMetadataString(metadata, "templateImage", DOCKER_SANDBOX_BACKEND);
  const containerName = readRequiredMetadataString(metadata, "containerName", DOCKER_SANDBOX_BACKEND);
  const runtimeMounts = readDockerRuntimeMounts(metadata.runtimeMounts);
  const runnerPath = readRequiredMetadataString(metadata, "runnerPath", DOCKER_SANDBOX_BACKEND);
  const runtimeImport = readRequiredMetadataString(metadata, "runtimeImport", DOCKER_SANDBOX_BACKEND);
  const sandboxUid = readRequiredMetadataNumber(metadata, "sandboxUid", DOCKER_SANDBOX_BACKEND);
  const sandboxGid = readRequiredMetadataNumber(metadata, "sandboxGid", DOCKER_SANDBOX_BACKEND);
  const progressTarget = args.progress ?? readOptionalProgressTarget(metadata.progressTarget);
  const network = asRuntimeRecord(metadata.network);
  const resources = execution.policy.resources;
  const tmpfsSize = dockerSize(resources.diskGb);
  const memorySize = dockerSize(resources.memoryGb);
  const workspaceRoot = dockerExecutionWorkspaceRoot(execution);
  const [{ execFile, spawn }, fs, { promisify }] = await Promise.all([
    importNodeModule<typeof import("node:child_process")>(nodeBuiltin("child_process")),
    importNodeModule<typeof import("node:fs/promises")>(nodeBuiltin("fs/promises")),
    importNodeModule<typeof import("node:util")>(nodeBuiltin("util")),
  ]);
  const execFileAsync = promisify(execFile);
  await execFileAsync("docker", ["rm", "-f", containerName], { maxBuffer: 1024 * 1024 }).catch(() => undefined);
  const tmpfsArgs = [
    tmpfsDockerArg(DOCKER_DEFAULT_WORKSPACE, sandboxUid, sandboxGid, tmpfsSize),
    ...(workspaceRoot !== DOCKER_DEFAULT_WORKSPACE
      ? [tmpfsDockerArg(workspaceRoot, sandboxUid, sandboxGid, tmpfsSize)]
      : []),
  ].flatMap((entry) => ["--tmpfs", entry]);
  const dockerArgs = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--network",
    typeof network.mode === "string" ? network.mode : "none",
    "--cpus",
    dockerCpu(resources.cpu),
    "--memory",
    memorySize,
    "--memory-swap",
    memorySize,
    "--user",
    `${sandboxUid}:${sandboxGid}`,
    ...tmpfsArgs,
    "--workdir",
    DOCKER_RUNTIME_MOUNT,
    "-v",
    `${root}:/workbench-execution`,
    ...dockerRuntimeMountArgs(runtimeMounts),
    "--env",
    "HOME=/tmp",
    "--env",
    "USER=workbench",
    "--env",
    `PATH=${DOCKER_RUNTIME_MOUNT}/node_modules/.bin:/usr/local/bin:/usr/bin:/bin`,
    "--env",
    `WORKBENCH_WORKSPACE_ROOT=${workspaceRoot}`,
    "--env",
    `WORKBENCH_RUNTIME_IMPORT=${runtimeImport}`,
    image,
    "node",
    runnerPath,
    "/workbench-execution/request.json",
    "/workbench-execution/response.json",
  ];
  const timeoutMs = Math.max(60_000, execution.policy.resources.timeoutMinutes * 60_000 + 30_000);
  let dockerError: string | null = null;
  try {
    await runDockerSandboxProcess(spawn, dockerArgs, {
      stdoutPath,
      stderrPath,
      timeoutMs,
      progressTarget,
      signal,
      containerName,
    });
  } catch (error) {
    dockerError = error instanceof Error ? error.stack ?? error.message : String(error);
  }
  const responseText = await fs.readFile(responsePath, "utf8").catch(async (error: unknown) => {
    const [stdout, stderr] = await Promise.all([
      fs.readFile(stdoutPath, "utf8").catch(() => ""),
      fs.readFile(stderrPath, "utf8").catch(() => ""),
    ]);
    const details = [
      dockerError ? `Docker error: ${dockerError}` : null,
      stdout.trim() ? `stdout: ${stdout.trim().slice(0, 4000)}` : null,
      stderr.trim() ? `stderr: ${stderr.trim().slice(0, 4000)}` : null,
    ].filter((entry): entry is string => Boolean(entry)).join(" ");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Docker sandbox exited without a response: ${message}${details ? `. ${details}` : ""}`);
  });
  const response = JSON.parse(responseText);
  if (!response.ok) {
    throw new Error(typeof response.error === "string" ? response.error : "Sandbox adapter runner failed.");
  }
  if (!response.job || typeof response.job !== "object") {
    throw new Error("Sandbox adapter runner response omitted job.");
  }
  await persistWorkbenchAdapterAuthUpdates(args, response.adapterAuthProfiles);
  return response.job as RemoteWorkbenchJob;
}

function dockerRuntimeMountArgs(mounts: readonly DockerRuntimeMount[]): string[] {
  return [
    "--tmpfs",
    `${DOCKER_RUNTIME_MOUNT}:rw,nosuid,nodev,size=16m,mode=755`,
    ...mounts.flatMap((mount) => [
      "--mount",
      `type=bind,source=${mount.source},target=${dockerRuntimeMountTarget(mount.target)},readonly`,
    ]),
  ];
}

function dockerRuntimeMountTarget(target: string): string {
  const relativeTarget = target.replace(/^\/+|\/+$/gu, "");
  return relativeTarget
    ? `${DOCKER_RUNTIME_MOUNT}/${relativeTarget}`
    : DOCKER_RUNTIME_MOUNT;
}

function tmpfsDockerArg(pathname: string, uid: number, gid: number, size: string): string {
  return `${pathname}:rw,exec,uid=${uid},gid=${gid},mode=1777,size=${size}`;
}

function dockerExecutionWorkspaceRoot(execution: WorkbenchExecutionSpec): string {
  const metadata = asRuntimeRecord(execution.metadata);
  const workdir = typeof metadata.workdir === "string" ? metadata.workdir.trim() : "";
  if (!workdir || workdir === DOCKER_DEFAULT_WORKSPACE) {
    return DOCKER_DEFAULT_WORKSPACE;
  }
  if (!isSafeDockerWorkspaceRoot(workdir)) {
    return DOCKER_DEFAULT_WORKSPACE;
  }
  return workdir;
}

function isSafeDockerWorkspaceRoot(value: string): boolean {
  return value.startsWith("/") &&
    value !== "/" &&
    value !== DOCKER_RUNTIME_MOUNT &&
    value !== "/workbench-execution" &&
    !value.startsWith(`${DOCKER_RUNTIME_MOUNT}/`) &&
    !value.startsWith("/workbench-execution/") &&
    !/[\0\r\n:]/u.test(value);
}

async function destroyDockerSandbox(sandbox: SandboxHandle): Promise<void> {
  const metadata = asRuntimeRecord(sandbox.metadata);
  const root = typeof metadata.root === "string" ? metadata.root : null;
  const containerName = typeof metadata.containerName === "string" ? metadata.containerName : null;
  const [{ execFile }, fs, { promisify }] = await Promise.all([
    importNodeModule<typeof import("node:child_process")>(nodeBuiltin("child_process")),
    importNodeModule<typeof import("node:fs/promises")>(nodeBuiltin("fs/promises")),
    importNodeModule<typeof import("node:util")>(nodeBuiltin("util")),
  ]);
  const execFileAsync = promisify(execFile);
  if (containerName) {
    await execFileAsync("docker", ["rm", "-f", containerName], { maxBuffer: 1024 * 1024 }).catch(() => undefined);
  }
  if (root) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runDockerSandboxProcess(
  spawn: typeof import("node:child_process").spawn,
  args: string[],
  options: {
    stdoutPath: string;
    stderrPath: string;
    timeoutMs: number;
    progressTarget?: WorkbenchExecutionProgressTarget;
    signal?: AbortSignal;
    containerName?: string;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const signal = abortSignalOrUndefined(options.signal);
    let settled = false;
    let timedOut = false;
    let aborted = false;
    const progressPublishes: Promise<void>[] = [];
    const progressParser = createWorkbenchProgressStdoutParser((envelope) => {
      progressPublishes.push(
        publishWorkbenchProgressStdoutEnvelope(envelope, options.progressTarget)
          .catch(() => undefined),
      );
    });
    const stdout = createWriteStream(options.stdoutPath);
    const stderr = createWriteStream(options.stderrPath);
    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const removeContainer = (): void => {
      if (!options.containerName) {
        return;
      }
      const remover = spawn("docker", ["rm", "-f", options.containerName], {
        stdio: "ignore",
      });
      remover.on("error", () => undefined);
    };
    if (signal?.aborted) {
      aborted = true;
      removeContainer();
      child.kill("SIGTERM");
    }
    const abort = () => {
      aborted = true;
      removeContainer();
      child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      removeContainer();
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout.write(chunk);
      progressParser.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.write(chunk);
    });

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      progressParser.flush();
      const stdoutClosed = new Promise<void>((closeResolve) => stdout.end(closeResolve));
      const stderrClosed = new Promise<void>((closeResolve) => stderr.end(closeResolve));
      Promise.allSettled([...progressPublishes, stdoutClosed, stderrClosed]).then(() => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    };

    child.on("error", (error) => finish(error));
    child.on("exit", (code, signal) => {
      if (timedOut) {
        finish(new Error(`Docker sandbox timed out after ${options.timeoutMs}ms.`));
        return;
      }
      if (aborted) {
        finish(new Error("Run cancellation requested."));
        return;
      }
      if (code === 0) {
        finish();
        return;
      }
      finish(new Error(
        code === null
          ? `Docker sandbox exited from signal ${signal ?? "unknown"}.`
          : `Docker sandbox exited with code ${code}.`,
      ));
    });
  });
}

function dockerNetworkConfigForExecution(execution: WorkbenchExecutionSpec): Record<string, Json> {
  switch (execution.policy.network.egress) {
    case "none":
      return { mode: "none", egress: "none" };
    case "open":
      return { mode: "bridge", egress: "open" };
    default:
      throw new Error(`Unsupported Docker network egress policy ${String(execution.policy.network.egress)}.`);
  }
}

function dockerContainerName(sandboxId: string): string {
  return `workbench-sandbox-${sandboxId}`.replace(/[^a-z0-9_.-]+/giu, "-").slice(0, 120);
}

function dockerCpu(value: number): string {
  return String(value);
}

function dockerSize(gib: number): string {
  return `${Math.ceil(gib * 1024)}m`;
}

function safeDockerImageSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80) || "env";
}

async function prepareDockerRuntimePayload(
  workdir: string,
  execFileAsync: (file: string, args: string[], options?: Record<string, unknown>) => Promise<unknown>,
  fs: typeof import("node:fs/promises"),
  path: typeof import("node:path"),
): Promise<DockerRuntimePayload> {
  const configured = process.env.WORKBENCH_DOCKER_RUNTIME_ROOT?.trim();
  if (configured) {
    return monorepoDockerPayload(configured);
  }
  const runtimeImage = process.env.WORKBENCH_DOCKER_RUNTIME_IMAGE?.trim();
  if (!runtimeImage) {
    return resolveLocalDockerRuntimePayload();
  }
  const runtimeImageId = await dockerImageId(runtimeImage, execFileAsync);
  const cacheRoot = path.join(workdir, "workbench-docker-runtime", `${safeCacheSegment(runtimeImage)}-${safeCacheSegment(runtimeImageId).slice(0, 24)}`);
  const marker = path.join(cacheRoot, ".workbench-core-ready");
  try {
    await fs.access(marker);
    return monorepoDockerPayload(cacheRoot);
  } catch {
    // Rebuild the cache below.
  }
  const tmpRoot = `${cacheRoot}.tmp-${Date.now().toString(36)}`;
  const containerName = `workbench-core-${Date.now().toString(36)}`.replace(/[^a-z0-9_.-]+/giu, "-");
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(tmpRoot, { recursive: true });
  try {
    await execFileAsync("docker", ["rm", "-f", containerName], { maxBuffer: 1024 * 1024 }).catch(() => undefined);
    await execFileAsync("docker", ["create", "--name", containerName, runtimeImage, "true"], { maxBuffer: 5 * 1024 * 1024 });
    await execFileAsync("docker", ["cp", `${containerName}:/app/.`, tmpRoot], { maxBuffer: 20 * 1024 * 1024 });
    await fs.writeFile(path.join(tmpRoot, ".workbench-core-ready"), `${runtimeImage}\n${runtimeImageId}\n`);
    await fs.rm(cacheRoot, { recursive: true, force: true }).catch(() => undefined);
    await fs.rename(tmpRoot, cacheRoot);
    return monorepoDockerPayload(cacheRoot);
  } finally {
    await execFileAsync("docker", ["rm", "-f", containerName], { maxBuffer: 1024 * 1024 }).catch(() => undefined);
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function dockerImageId(
  image: string,
  execFileAsync: (file: string, args: string[], options?: Record<string, unknown>) => Promise<unknown>,
): Promise<string> {
  const result = await execFileAsync("docker", ["image", "inspect", image, "--format", "{{.Id}}"], { maxBuffer: 1024 * 1024 }) as { stdout?: string | Buffer };
  const id = typeof result.stdout === "string" ? result.stdout.trim() : result.stdout?.toString("utf8").trim();
  if (!id) {
    throw new Error(`Docker image ${image} did not report an image id.`);
  }
  return id;
}

function safeCacheSegment(value: string): string {
  return value.replace(/[^a-z0-9_.-]+/giu, "-");
}

async function ensureDockerExecutionImage(
  image: string,
  execFileAsync: (file: string, args: string[], options?: Record<string, unknown>) => Promise<unknown>,
): Promise<void> {
  const imageExists = await execFileAsync("docker", ["image", "inspect", image], { maxBuffer: 1024 * 1024 })
    .then(() => true, () => false);
  if (imageExists) {
    return;
  }

  const builtInDockerfile = localBuiltInDockerfileForImage(image);
  if (builtInDockerfile) {
    await execFileAsync("docker", [
      "build",
      "-t",
      image,
      "-f",
      builtInDockerfile,
      path.dirname(builtInDockerfile),
    ], { maxBuffer: 20 * 1024 * 1024 });
    return;
  }

  await execFileAsync("docker", ["pull", image], { maxBuffer: 20 * 1024 * 1024 });
}

function localBuiltInDockerfileForImage(image: string): string | null {
  if (hasRegistryHost(image)) {
    return null;
  }
  const dockerfile = BUILT_IN_ENVIRONMENT_IMAGES[image];
  if (!dockerfile) {
    return null;
  }
  return path.join(resolveLocalDockerRuntimePayload().builtInDockerfileRoot, dockerfile.replace(/^products\/workbench\/environments\//u, ""));
}

function hasRegistryHost(image: string): boolean {
  const first = image.split("/")[0] ?? "";
  return first === "localhost" || first.includes(".") || first.includes(":");
}

function resolveLocalDockerRuntimePayload(): DockerRuntimePayload {
  const monorepoRoot = findDockerMonorepoRoot();
  if (monorepoRoot) {
    return monorepoDockerPayload(monorepoRoot);
  }
  const packagePayload = findInstalledPackageDockerPayload();
  if (packagePayload) {
    return packagePayload;
  }
  throw new Error(`Could not resolve Workbench runtime payload from ${process.cwd()}. Run from the monorepo checkout or install the published @workbench-ai/workbench package.`);
}

function monorepoDockerPayload(root: string): DockerRuntimePayload {
  return {
    mounts: monorepoDockerRuntimeMounts(root),
    runnerPath: `${DOCKER_RUNTIME_MOUNT}/products/workbench/packages/core/worker/sandbox-adapter-runner.cjs`,
    runtimeImport: `${DOCKER_RUNTIME_MOUNT}/products/workbench/packages/core/dist/index.js`,
    builtInDockerfileRoot: path.join(root, "products/workbench/environments"),
  };
}

function monorepoDockerRuntimeMounts(root: string): DockerRuntimeMount[] {
  return [
    ...requiredDockerRuntimeMounts(root, [
      ["products/workbench/packages/core", "products/workbench/packages/core"],
      ["products/workbench/packages/contract", "products/workbench/packages/contract"],
      ["products/workbench/packages/protocol", "products/workbench/packages/protocol"],
      ["products/workbench/packages/built-in-adapters", "products/workbench/packages/built-in-adapters"],
      ["products/agent-drivers", "products/agent-drivers"],
      ["products/workbench/environments", "products/workbench/environments"],
    ]),
    ...optionalDockerRuntimeMounts(root, [
      ["node_modules", "node_modules"],
    ]),
  ];
}

function findInstalledPackageDockerPayload(): DockerRuntimePayload | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(moduleDir, "../..");
  const nodeModulesRoot = findAncestorNamed(packageRoot, "node_modules");
  if (!nodeModulesRoot) {
    return null;
  }
  if (
    existsSync(path.join(packageRoot, "worker/sandbox-adapter-runner.cjs")) &&
    existsSync(path.join(packageRoot, "dist/index.js")) &&
    existsSync(path.join(packageRoot, "environments/node-22/Dockerfile"))
  ) {
    return {
      mounts: [{ source: nodeModulesRoot, target: "node_modules" }],
      runnerPath: `${DOCKER_RUNTIME_MOUNT}/node_modules/@workbench-ai/workbench-core/worker/sandbox-adapter-runner.cjs`,
      runtimeImport: `${DOCKER_RUNTIME_MOUNT}/node_modules/@workbench-ai/workbench-core/dist/index.js`,
      builtInDockerfileRoot: path.join(packageRoot, "environments"),
    };
  }
  return null;
}

function requiredDockerRuntimeMounts(
  root: string,
  entries: readonly (readonly [string, string])[],
): DockerRuntimeMount[] {
  return entries.map(([source, target]) => {
    const absoluteSource = path.join(root, source);
    if (!existsSync(absoluteSource)) {
      throw new Error(`Docker sandbox runtime is missing ${source}.`);
    }
    return { source: absoluteSource, target };
  });
}

function optionalDockerRuntimeMounts(
  root: string,
  entries: readonly (readonly [string, string])[],
): DockerRuntimeMount[] {
  return entries.flatMap(([source, target]) => {
    const absoluteSource = path.join(root, source);
    return existsSync(absoluteSource) ? [{ source: absoluteSource, target }] : [];
  });
}

function findAncestorNamed(start: string, name: string): string | null {
  let current = start;
  for (;;) {
    if (path.basename(current) === name) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function findDockerMonorepoRoot(): string | null {
  const configured = process.env.WORKBENCH_DOCKER_SOURCE_ROOT?.trim();
  if (configured) {
    return configured;
  }
  const cwd = process.cwd();
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const roots = [
    cwd,
    path.resolve(cwd, ".."),
    path.resolve(cwd, "../.."),
    path.resolve(cwd, "../../.."),
    path.resolve(moduleDir, "../../../../../.."),
  ];
  for (const root of roots) {
    if (
      existsSync(path.join(root, "products/workbench/packages/core/worker/sandbox-adapter-runner.cjs")) &&
      existsSync(path.join(root, "products/workbench/packages/core/dist/index.js"))
    ) {
      return root;
    }
  }
  return null;
}

function readRequiredMetadataString(metadata: Record<string, unknown>, key: string, backend: string): string {
  const value = metadata[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${backend} sandbox metadata is missing ${key}.`);
  }
  return value;
}

function readRequiredMetadataNumber(metadata: Record<string, unknown>, key: string, backend: string): number {
  const value = metadata[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${backend} sandbox metadata is missing ${key}.`);
  }
  return value;
}

function readDockerRuntimeMounts(
  value: unknown,
): DockerRuntimeMount[] {
  if (!Array.isArray(value)) {
    throw new Error(`${DOCKER_SANDBOX_BACKEND} sandbox metadata is missing runtime mounts.`);
  }
  const mounts = value.flatMap((entry): DockerRuntimeMount[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.source !== "string" || typeof record.target !== "string") {
      return [];
    }
    if (!isSafeDockerRuntimeMountTarget(record.target)) {
      return [];
    }
    return [{ source: record.source, target: record.target }];
  });
  if (mounts.length === 0) {
    throw new Error(`${DOCKER_SANDBOX_BACKEND} sandbox metadata is missing runtime mounts.`);
  }
  return mounts;
}

function isSafeDockerRuntimeMountTarget(target: string): boolean {
  if (target === "") {
    return true;
  }
  return !target.startsWith("/") &&
    !target.split("/").includes("..") &&
    !/[\0\r\n:,]/u.test(target);
}

function readOptionalProgressTarget(
  value: unknown,
): WorkbenchExecutionProgressTarget | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string" || typeof record.token !== "string") {
    return undefined;
  }
  return {
    url: record.url,
    token: record.token,
    ...(typeof record.ownerUserId === "string" ? { ownerUserId: record.ownerUserId } : {}),
    ...(typeof record.flushWindowMs === "number" ? { flushWindowMs: record.flushWindowMs } : {}),
    ...(record.transport === "stdout" || record.transport === "both" || record.transport === "http"
      ? { transport: record.transport }
      : {}),
  };
}

function dockerSandboxUser(): DockerSandboxUser {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const gid = typeof process.getgid === "function" ? process.getgid() : null;
  if (typeof uid === "number" && Number.isInteger(uid) && uid > 0) {
    return {
      uid,
      gid: typeof gid === "number" && Number.isInteger(gid) && gid >= 0 ? gid : uid,
    };
  }
  return { uid: 1000, gid: 1000 };
}

async function alignDockerSandboxPath(
  fs: typeof import("node:fs/promises"),
  targetPath: string,
  user: DockerSandboxUser,
  privateMode: number,
  fallbackMode: number,
): Promise<void> {
  await fs.chmod(targetPath, privateMode).catch(() => undefined);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (currentUid === user.uid) {
    return;
  }
  await fs.chown(targetPath, user.uid, user.gid).catch(async () => {
    await fs.chmod(targetPath, fallbackMode).catch(() => undefined);
  });
}
