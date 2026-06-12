import { fileURLToPath } from "node:url";

import { normalizeWorkbenchSkillName, type WorkbenchRemoteKind } from "@workbench-ai/workbench-contract";

import { WorkbenchCodedError } from "./coded-errors.ts";

export type { WorkbenchRemoteKind };

export interface ParsedWorkbenchCloudRemoteUrl {
  kind: "workbench-cloud";
  url: string;
  baseUrl: string;
  owner: string;
  skill: string;
}

export interface ParsedWorkbenchFileRemoteUrl {
  kind: "file";
  url: string;
  path: string;
}

export type ParsedWorkbenchRemoteUrl = ParsedWorkbenchCloudRemoteUrl | ParsedWorkbenchFileRemoteUrl;

export function parseWorkbenchRemoteUrl(rawUrl: string): ParsedWorkbenchRemoteUrl {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new WorkbenchCodedError("remote_invalid_url", "Workbench remote URL must be non-empty.", {
      remediation: "Use publish for Workbench Cloud links or edit .workbench/remotes.yaml for plumbing file remotes.",
      exitCode: 2,
    });
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new WorkbenchCodedError("remote_invalid_url", `Invalid Workbench remote URL: ${trimmed}`, {
      remediation: "Use file:///absolute/path for local remotes or https://HOST/skills/OWNER/SKILL for Workbench Cloud remotes.",
      subject: { url: trimmed },
      exitCode: 2,
    });
  }

  if (url.protocol === "file:") {
    let filePath: string;
    try {
      filePath = fileURLToPath(url);
    } catch {
      throw new WorkbenchCodedError("remote_invalid_url", `Invalid file Workbench remote URL: ${trimmed}`, {
        remediation: "Use an absolute file URL such as file:///tmp/workbench-remote.",
        subject: { url: trimmed },
        exitCode: 2,
      });
    }
    if (!filePath.startsWith("/")) {
      throw new WorkbenchCodedError("remote_invalid_url", `File Workbench remote must use an absolute path: ${trimmed}`, {
        remediation: "Use file:///absolute/path for local Workbench remotes.",
        subject: { url: trimmed },
        exitCode: 2,
      });
    }
    return { kind: "file", url: url.toString(), path: filePath };
  }

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new WorkbenchCodedError("remote_unsupported_scheme", `Unsupported Workbench remote scheme: ${url.protocol.replace(/:$/u, "")}`, {
      remediation: "Use file:///absolute/path for local remotes or https://HOST/skills/OWNER/SKILL for Workbench Cloud remotes.",
      subject: { url: trimmed, scheme: url.protocol.replace(/:$/u, "") },
      exitCode: 2,
    });
  }

  const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  if (segments.length !== 3 || segments[0] !== "skills") {
    throw new WorkbenchCodedError("remote_invalid_skill_slug", `Workbench Cloud remote must use /skills/OWNER/SKILL: ${trimmed}`, {
      remediation: "Use publish for Workbench Cloud links or edit .workbench/remotes.yaml with https://HOST/skills/OWNER/SKILL.",
      subject: { url: trimmed },
      exitCode: 2,
    });
  }
  const owner = validateRemoteSlug(segments[1]!, "owner", trimmed);
  const skill = validateRemoteSlug(segments[2]!, "skill", trimmed);
  url.hash = "";
  url.search = "";
  url.pathname = `/skills/${encodeURIComponent(owner)}/${encodeURIComponent(skill)}`;
  return {
    kind: "workbench-cloud",
    url: url.toString().replace(/\/$/u, ""),
    baseUrl: url.origin,
    owner,
    skill,
  };
}

function validateRemoteSlug(value: string, label: "owner" | "skill", displayUrl: string): string {
  const normalized = normalizeWorkbenchSkillName(value);
  if (!normalized || normalized !== value) {
    throw new WorkbenchCodedError("remote_invalid_skill_slug", `Workbench Cloud remote ${label} must be a URL-safe slug: ${value}`, {
      remediation: "Use lowercase letters, numbers, and single hyphens in Workbench Cloud remote URLs.",
      subject: { url: displayUrl, segment: label, value },
      exitCode: 2,
    });
  }
  return normalized;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/u, "$1");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}
