import path from "node:path";

interface WorkbenchRuntimeAdapterInstallerFile {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
  executable?: boolean;
}

export interface WorkbenchRuntimeAdapterInstaller {
  id: string;
  source: string;
  install: readonly string[];
  files?: readonly WorkbenchRuntimeAdapterInstallerFile[];
}

export function composeRuntimeDockerfileWithAdapterInstallers(
  dockerfile: string,
  adapters: readonly WorkbenchRuntimeAdapterInstaller[],
): string {
  const installAdapters = adapters.filter((adapter) =>
    adapter.install.length > 0 || (adapter.files?.length ?? 0) > 0
  );
  if (installAdapters.length === 0) {
    return dockerfile;
  }
  const finalUser = readFinalDockerfileUser(dockerfile);
  const lines = [
    dockerfile.trimEnd(),
    "",
    "# Workbench adapter install commands. The eval Dockerfile owns case dependencies;",
    "# adapter manifests own adapter runtime dependencies.",
    "USER root",
  ];
  for (const adapter of installAdapters) {
    lines.push("");
    lines.push(`# Adapter: ${adapter.id} (${adapter.source})`);
    if ((adapter.files?.length ?? 0) > 0) {
      lines.push(...adapterSourceDockerfileLines(adapter));
      lines.push(`WORKDIR /opt/workbench-adapters/${adapter.id}`);
    }
    for (const command of adapter.install) {
      lines.push(`RUN ${command}`);
    }
  }
  if (finalUser) {
    lines.push("");
    lines.push(`# Restore eval runtime user.`);
    lines.push(`USER ${finalUser}`);
  }
  lines.push("WORKDIR /workspace", "");
  return lines.join("\n");
}

function readFinalDockerfileUser(dockerfile: string): string | null {
  let finalUser: string | null = null;
  for (const line of dockerfile.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^USER\s+(.+)$/iu.exec(trimmed);
    if (match?.[1]) {
      finalUser = match[1].trim();
    }
  }
  return finalUser;
}

function adapterSourceDockerfileLines(
  adapter: WorkbenchRuntimeAdapterInstaller,
): string[] {
  const root = `/opt/workbench-adapters/${adapter.id}`;
  const lines = [`RUN mkdir -p ${shellWord(root)}`];
  for (const file of adapter.files ?? []) {
    const destination = `${root}/${normalizeAdapterFilePath(file.path)}`;
    const encoded = file.encoding === "base64"
      ? file.content
      : Buffer.from(file.content, "utf8").toString("base64");
    lines.push(
      `RUN mkdir -p ${shellWord(path.posix.dirname(destination))} && printf '%s' ${shellWord(encoded)} | base64 -d > ${shellWord(destination)}${file.executable ? ` && chmod 755 ${shellWord(destination)}` : ""}`,
    );
  }
  return lines;
}

function normalizeAdapterFilePath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\/+/u, "").replace(/^\.?\//u, "");
}

function shellWord(value: string): string {
  return `'${value.replace(/'/gu, "'\"'\"'")}'`;
}
