#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  formatWorkflowValidationDiagnostics,
  validateWorkflowSourceYamlDetailed,
  validateWorkflowSources,
  type WorkflowCollectionValidationResult,
  type WorkflowSourceValidationDetailedResult,
  type WorkflowValidationSourceInput,
} from "./index.js";

export interface WorkflowValidatorCliIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

export interface WorkflowValidatorCliReport {
  mode: "single" | "collection";
  target_path: string;
  workflow_root: string | null;
  files: WorkflowSourceValidationDetailedResult[];
  diagnostics: WorkflowCollectionValidationResult["diagnostics"];
  valid: boolean;
}

export async function runWorkflowValidatorCli(
  args: readonly string[],
  io: WorkflowValidatorCliIo = defaultWorkflowValidatorCliIo,
): Promise<number> {
  const parsedArgs = parseWorkflowValidatorCliArgs(args);
  if (!parsedArgs.ok) {
    io.stderr(`${parsedArgs.error}\n${workflowValidatorUsage}`);
    return 2;
  }

  try {
    const report = await buildWorkflowValidatorCliReport(parsedArgs.targetPath);
    const output = parsedArgs.json ? JSON.stringify(report, null, 2) : formatWorkflowValidatorCliReport(report);
    io.stdout(`${output}\n`);
    return report.valid ? 0 : 1;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export async function buildWorkflowValidatorCliReport(targetPath: string): Promise<WorkflowValidatorCliReport> {
  const resolvedTarget = path.resolve(targetPath);
  const stat = await fs.stat(resolvedTarget);

  if (stat.isFile()) {
    const sourceYaml = await fs.readFile(resolvedTarget, "utf8");
    const result = validateWorkflowSourceYamlDetailed(sourceYaml, { filePath: resolvedTarget });
    return {
      mode: "single",
      target_path: resolvedTarget,
      workflow_root: null,
      files: [result],
      diagnostics: result.diagnostics.filter((diagnostic) => diagnostic.source === "collection"),
      valid: result.valid,
    };
  }

  if (!stat.isDirectory()) {
    throw new Error(`Unsupported validation target: ${resolvedTarget}`);
  }

  const workflowRoot = await resolveWorkflowValidatorDirectory(resolvedTarget);
  const filePaths = await listWorkflowYamlFiles(workflowRoot);
  if (filePaths.length === 0) {
    throw new Error(`No workflow YAML files found under ${workflowRoot}`);
  }

  const inputs: WorkflowValidationSourceInput[] = await Promise.all(
    filePaths.map(async (filePath) => ({
      file_path: filePath,
      source_yaml: await fs.readFile(filePath, "utf8"),
    })),
  );
  const result = validateWorkflowSources(inputs);
  return {
    mode: "collection",
    target_path: resolvedTarget,
    workflow_root: workflowRoot,
    files: result.files,
    diagnostics: result.diagnostics,
    valid: result.valid,
  };
}

export function formatWorkflowValidatorCliReport(report: WorkflowValidatorCliReport): string {
  const lines: string[] = [];
  const validFiles = report.files.filter((file) => file.valid).length;
  const invalidFiles = report.files.length - validFiles;

  lines.push(`Target: ${report.target_path}`);
  if (report.workflow_root) {
    lines.push(`Workflow root: ${report.workflow_root}`);
  }
  lines.push(`Result: ${report.valid ? "valid" : "invalid"}`);
  lines.push(`Files: ${report.files.length} total, ${validFiles} valid, ${invalidFiles} invalid`);

  for (const file of report.files) {
    const label = file.valid ? "VALID" : "INVALID";
    const workflowIdSuffix = file.workflow_id ? ` (${file.workflow_id})` : "";
    lines.push(`${label} ${file.file_path ?? "<inline>"}${workflowIdSuffix}`);
    if (!file.valid) {
      for (const diagnostic of file.diagnostics) {
        lines.push(`  - [${diagnostic.source}] ${formatWorkflowValidationDiagnostics([diagnostic])}`);
      }
    }
  }

  return lines.join("\n");
}

const defaultWorkflowValidatorCliIo: WorkflowValidatorCliIo = {
  stdout(message: string) {
    process.stdout.write(message);
  },
  stderr(message: string) {
    process.stderr.write(message);
  },
};

const workflowValidatorUsage = "Usage: flow-workflow-validator [target-path] [--json]";

function parseWorkflowValidatorCliArgs(
  args: readonly string[],
): { ok: true; targetPath: string; json: boolean } | { ok: false; error: string } {
  let json = false;
  let targetPath = ".";
  let positionalArgs = 0;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg.startsWith("-")) {
      return {
        ok: false,
        error: `Unknown option: ${arg}`,
      };
    }

    positionalArgs += 1;
    if (positionalArgs > 1) {
      return {
        ok: false,
        error: "Expected at most one target path.",
      };
    }

    targetPath = arg;
  }

  return {
    ok: true,
    targetPath,
    json,
  };
}

async function resolveWorkflowValidatorDirectory(targetPath: string): Promise<string> {
  const nestedWorkflowRoot = path.join(targetPath, ".flow", "workflows");
  if (await isDirectory(nestedWorkflowRoot)) {
    return nestedWorkflowRoot;
  }

  return targetPath;
}

async function listWorkflowYamlFiles(workflowRoot: string): Promise<string[]> {
  return (await fs.readdir(workflowRoot))
    .filter((entry) => entry.endsWith(".yaml"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => path.join(workflowRoot, entry));
}

async function isDirectory(candidatePath: string): Promise<boolean> {
  try {
    return (await fs.stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await runWorkflowValidatorCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
